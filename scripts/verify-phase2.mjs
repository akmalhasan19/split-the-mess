/**
 * E2E Fase 2 — Task 2.4: validasi tanpa login (RLS anon) + token & expiry.
 *
 * Simulasi 5 user membuka link yang sama tanpa login: join, claim item,
 * baca ulang, lalu admin finalize. Semua request memakai API routes yang
 * berjalan dengan anon key + RLS (bukan service role), jadi error RLS akan
 * muncul di sini bila policy salah.
 *
 * Pemakaian:
 *   node scripts/verify-phase2.mjs [baseURL]
 *   default baseURL: http://localhost:3000
 *
 * Checks:
 *   1. Token 8 char, alphabet tanpa karakter ambigu (Task 1.3 / 2.4).
 *   2. expires_at ± 7 hari dari created_at (logika awal expiry).
 *   3. 5 user join + claim tanpa login, tanpa error RLS (4xx/5xx).
 *   4. Semua selections terbaca ulang oleh semua user (read anon).
 *   5. Finalize sukses → settlements berjumlah tepat grand total (diff 0).
 *   6. Sesi finalized menolak PATCH (409) dan toggle (409).
 *   7. Token asal (tidak ada) → 404.
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* body bukan JSON */
  }
  return { status: res.status, json };
}

const USERS = ["Andi", "Bunga", "Citra", "Dimas", "Eka"];

async function main() {
  console.log(`Verify Phase 2 (Task 2.4) → ${BASE}\n`);

  // Buat sesi: 5 item, pajak+service−diskon tidak habis dibagi rata agar
  // smart rounding diuji ikut.
  const items = [
    { name: "Pizza Pepperoni", price: 85000 },
    { name: "Cheeseburger", price: 45000 },
    { name: "Iced Latte", price: 30000 },
    { name: "Fried Chicken", price: 60000 },
    { name: "Garlic Bread", price: 25000 },
  ];
  const created = await api("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items,
      participants: [],
      tax: 38500,
      service_charge: 35000,
      discount: 25000,
      payer_bca: "BCA: 1234567890 a.n. Akmal",
    }),
  });
  check("POST /api/sessions → 201", created.status === 201);
  const token = created.json?.token;
  if (!token) {
    console.log("Gagal membuat sesi — verifikasi dihentikan.");
    process.exit(1);
  }

  // 1. Token: 8 char, hanya alphabet aman.
  check(
    "Token 8 char tanpa karakter ambigu",
    /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(token),
    token
  );

  // 2. Expiry 7 hari.
  const createdAt = new Date(created.json.created_at ?? Date.now());
  const expiresAt = new Date(created.json.expires_at);
  const days = (expiresAt - createdAt) / 86_400_000;
  // created_at tak dikembalikan di response 201? fallback: bandingkan dgn now.
  const daysFromNow = (expiresAt - Date.now()) / 86_400_000;
  check(
    "Expiry ± 7 hari",
    Math.abs(days - 7) < 0.01 || (daysFromNow > 6.99 && daysFromNow < 7.01),
    `expires_at=${created.json.expires_at}`
  );

  // 3. 5 user join tanpa login.
  const participantIds = [];
  for (const name of USERS) {
    const joined = await api(`/api/sessions/${token}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    check(`Join tanpa login: ${name} → 201`, joined.status === 201);
    if (joined.json?.id) participantIds.push(joined.json.id);
  }
  check("5 peserta terdaftar", participantIds.length === 5);

  // 4. Semua user claim item (rotasi: user i mengklaim item i dan i+1).
  const { items: itemRows } = created.json;
  let toggleFailures = 0;
  for (let i = 0; i < USERS.length; i++) {
    const targets = [i, (i + 1) % itemRows.length];
    for (const t of targets) {
      const r = await api(`/api/sessions/${token}/items/${itemRows[t].id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantId: participantIds[i],
          selected: true,
        }),
      });
      if (r.status !== 200) toggleFailures++;
    }
  }
  check(
    "10 toggle claim tanpa error RLS (5 user × 2 item)",
    toggleFailures === 0,
    `${toggleFailures} gagal`
  );

  // 5. Baca ulang: semua user melihat selections yang sama.
  const detail = await api(`/api/sessions/${token}`);
  check("GET detail sesi → 200", detail.status === 200);
  const totalSelections = (detail.json?.items ?? []).reduce(
    (a, i) => a + i.selections.length,
    0
  );
  check(
    "Selections terbaca ulang (10 klaim)",
    totalSelections === 10,
    `${totalSelections}/10`
  );

  // 6. Finalize → settlements pas grand total.
  const finalized = await api(`/api/sessions/${token}/finalize`, {
    method: "POST",
  });
  check("Finalize → 200", finalized.status === 200, finalized.json?.error);
  const totals = finalized.json?.totals;
  if (totals) {
    check(
      "Settlements pas 100% (diff 0)",
      totals.diff === 0,
      `total=${totals.grandTotal} settled=${totals.settledTotal}`
    );
  }
  const afterFinal = await api(`/api/sessions/${token}`);
  const settlements = afterFinal.json?.settlements ?? [];
  check(
    "Settlements per orang tersimpan (5)",
    settlements.length === 5,
    `${settlements.length}/5`
  );

  // 7. Setelah finalized: PATCH & toggle ditolak 409.
  const patchAfter = await api(`/api/sessions/${token}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tax: 1 }),
  });
  check("PATCH setelah finalized → 409", patchAfter.status === 409);
  const toggleAfter = await api(
    `/api/sessions/${token}/items/${itemRows[0].id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        participantId: participantIds[0],
        selected: false,
      }),
    }
  );
  check("Toggle setelah finalized → 409", toggleAfter.status === 409);

  // 8. Token tidak dikenal → 404 (tanpa bocor info).
  const unknown = await api("/api/sessions/zz999999");
  check("Token asal → 404", unknown.status === 404);

  console.log(
    `\nSelesai: ${pass} pass, ${fail} fail ${fail === 0 ? "✔" : "✘"}`
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
