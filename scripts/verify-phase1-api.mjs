/**
 * E2E verify Fase 1 — jalankan terhadap dev server yang hidup.
 *
 *   node scripts/verify-phase1-api.mjs [baseUrl]
 *   default baseUrl: http://localhost:3000
 *
 * Skenario (validasi matematika Task 1.4, contoh proposal):
 * - 6 item, subtotal 350.000: Pizza 85.000, Burger 45.000, Latte 30.000,
 *   Ayam 60.000, Nasi 35.000, Seafood 95.000
 * - tax 11% = 38.500, service 10% = 35.000, diskon 25.000
 * - grand total = 398.500 → settlements harus tepat 398.500 (100%)
 * - cek juga: finalize ditolak saat ada item tanpa pemilih (400),
 *   sesi finalized menolak PATCH & toggle (409), GET 404 untuk token hantu.
 */
import { strict as assert } from "node:assert";

const BASE = process.argv[2] ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`
  );
};

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const rupiah = (n) => "Rp" + n.toLocaleString("id-ID");

async function main() {
  // 1) Buat sesi -----------------------------------------------
  const items = [
    { name: "Pizza Pepperoni", price: 85000 },
    { name: "Cheeseburger", price: 45000 },
    { name: "Iced Latte", price: 30000 },
    { name: "Fried Chicken", price: 60000 },
    { name: "Nasi Goreng", price: 35000 },
    { name: "Seafood Platter", price: 95000 },
  ];
  const created = await api("POST", "/api/sessions", {
    items,
    participants: [],
    tax: 38500,
    service_charge: 35000,
    discount: 25000,
    payer_bca: "1234567890 a.n. Akmal",
  });
  check(
    "POST /api/sessions → 201",
    created.status === 201,
    created.status === 201
      ? `token=${created.json.token}`
      : JSON.stringify(created.json)
  );
  if (created.status !== 201) process.exit(1);
  const token = created.json.token;
  check("token 8 char", /^[2-9a-hj-km-np-z]{8}$/.test(token), token);

  // 2) 5 peserta join ------------------------------------------
  const names = ["Akmal", "Rizky", "Dimas", "Nadia", "Fajar"];
  const participants = [];
  for (const name of names) {
    const r = await api("POST", `/api/sessions/${token}/participants`, {
      displayName: name,
    });
    if (r.status !== 201) {
      check(`join ${name}`, false, JSON.stringify(r.json));
      process.exit(1);
    }
    participants.push(r.json);
  }
  check("5 peserta join → 201", true);
  const dup = await api("POST", `/api/sessions/${token}/participants`, {
    displayName: "Akmal",
  });
  check("join nama duplikat → 409", dup.status === 409, `got ${dup.status}`);

  const pid = Object.fromEntries(
    participants.map((p) => [p.displayName, p.id])
  );

  // 3) Toggle seleksi ------------------------------------------
  const sel = async (itemId, participantId, selected) =>
    api("PATCH", `/api/sessions/${token}/items/${itemId}`, {
      participantId,
      selected,
    });

  const itemsNow = await api("GET", `/api/sessions/${token}`);
  const idOf = (name) => itemsNow.json.items.find((i) => i.name === name)?.id;

  const toggles = [
    ["Pizza Pepperoni", ["Akmal", "Fajar"]],
    ["Cheeseburger", ["Rizky"]],
    ["Iced Latte", ["Dimas", "Nadia"]],
    ["Fried Chicken", ["Nadia"]],
    ["Nasi Goreng", ["Akmal", "Rizky", "Dimas", "Nadia", "Fajar"]],
    ["Seafood Platter", ["Fajar"]],
  ];
  for (const [itemName, who] of toggles) {
    const itemId = idOf(itemName);
    for (const person of who) {
      const r = await sel(itemId, pid[person], true);
      if (r.status !== 200) {
        check(`select ${itemName} → ${person}`, false, JSON.stringify(r.json));
        process.exit(1);
      }
    }
  }
  check("seleksi 6 item × peserta OK", true);

  // 4) Finalize DITOLAK saat masih ada item tanpa pemilih ------
  const itemIdSeafood = idOf("Seafood Platter");
  // unclaim dulu Seafood (hanya dimakan Fajar) untuk uji 400
  await sel(itemIdSeafood, pid["Fajar"], false);
  const early = await api("POST", `/api/sessions/${token}/finalize`);
  check(
    "finalize saat ada item tanpa pemilih → 400",
    early.status === 400 && /tanpa pemilih/i.test(early.json.error ?? ""),
    JSON.stringify(early.json)
  );
  // claim lagi
  await sel(itemIdSeafood, pid["Fajar"], true);

  // 5) Finalize → 200 + settlements pas 398.500 ----------------
  const fin = await api("POST", `/api/sessions/${token}/finalize`);
  check(
    "finalize → 200",
    fin.status === 200,
    JSON.stringify(fin.json).slice(0, 200)
  );
  if (fin.status !== 200) process.exit(1);

  const total = fin.json.totals;
  check(
    "grandTotal == 398.500",
    total.grandTotal === 398500,
    rupiah(total.grandTotal)
  );
  check(
    "settledTotal == grandTotal (100%)",
    total.settledTotal === total.grandTotal,
    `diff=${total.diff}`
  );
  check("diff == 0", total.diff === 0);

  const byName = Object.fromEntries(
    fin.json.settlements.map((s) => [s.displayName, s.amountFinal])
  );
  console.log("\n  Rincian final (per orang):");
  for (const name of names) {
    console.log(`   ${name.padEnd(6)}: ${rupiah(byName[name] ?? 0)}`);
  }
  console.log(
    `   ${"-".repeat(24)}\n   TOTAL   : ${rupiah(total.settledTotal)}\n`
  );

  // 6) Sesi finalized: PATCH & toggle ditolak 409, duplikat-finalize 409
  const patchAfter = await api("PATCH", `/api/sessions/${token}`, { tax: 0 });
  check(
    "PATCH setelah finalized → 409",
    patchAfter.status === 409,
    `got ${patchAfter.status}`
  );
  const toggleAfter = await sel(idOf("Nasi Goreng"), pid["Akmal"], false);
  check(
    "toggle setelah finalized → 409",
    toggleAfter.status === 409,
    `got ${toggleAfter.status}`
  );
  const reFinal = await api("POST", `/api/sessions/${token}/finalize`);
  check(
    "finalize ulang → 409",
    reFinal.status === 409,
    `got ${reFinal.status}`
  );

  // 7) GET sesi finalized menyertakan settlements; token hantu → 404
  const detail = await api("GET", `/api/sessions/${token}`);
  check(
    "GET menyertakan settlements",
    Array.isArray(detail.json.settlements) &&
      detail.json.settlements.length === 5,
    `rows=${detail.json.settlements?.length}`
  );
  const ghost = await api("GET", "/api/sessions/zzzzzzzz");
  check("GET token hantu → 404", ghost.status === 404, `got ${ghost.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
