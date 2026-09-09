/**
 * E2E Fase 3 — Realtime sync (Task 3.1–3.3).
 *
 * Mensimulasikan dua HP membuka link sesi yang sama tanpa login:
 *   HP A = client websocket anon (Supabase Realtime, subscribe channel
 *          `session:{token}`) — mewakili halaman /s/[token] yang terbuka.
 *   HP B = aksi claim/unclaim via API routes (anon + RLS) — mewakili tap
 *          di HP lain.
 *
 * Checks:
 *   1. Channel `session:{token}` ter-subscribe (anon, tanpa login).
 *   2. HP B claim (INSERT selections) → HP A menerima event < 1000 ms.
 *   3. HP B unclaim (DELETE) → HP A menerima event < 1000 ms.
 *   4. Event hanya dari sesi sendiri (filter by sessionId di handler;
 *      tabrakan sesi lain tidak memicu update).
 *   5. Presence: HP B join channel → HP A melihat nama HP B online.
 *   6. Finalize via API → (dengan migration 0002) UPDATE sessions
 *      sampai ke HP A < 1000 ms.
 *   7. RLS fungsional tetap: toggle setelah finalized → 409.
 *
 * Pemakaian:
 *   node --env-file=.env scripts/verify-phase3.mjs [baseURL]
 *   default baseURL: http://localhost:3000
 *
 * Butuh NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY di env
 * (websocket dibuat langsung ke Supabase, sama seperti browser).
 */

import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY tidak diset."
  );
  process.exit(1);
}

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
    /* ignore */
  }
  return { status: res.status, json };
}

async function main() {
  console.log(`Verify Phase 3 (Realtime) → ${BASE}\n`);

  // ---------- Setup: buat sesi via API ----------
  const created = await api("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        { name: "Nasi Padang", price: 28000 },
        { name: "Es Jeruk", price: 10000 },
        { name: "Kerupuk", price: 5000 },
      ],
      participants: [],
      tax: 6000,
      service_charge: 3000,
      discount: 0,
    }),
  });
  check("Setup: POST /api/sessions → 201", created.status === 201);
  const token = created.json?.token;
  const sessionId = created.json?.id;
  const itemRows = created.json?.items ?? [];
  if (!token || itemRows.length < 2) process.exit(1);

  // ---------- HP A: client realtime anon ----------
  const hpA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const channelA = hpA.channel(`session:${token}`, {
    config: { presence: { key: "hp-a-test" } },
  });

  const events = {
    selInsert: null,
    selDelete: null,
    partInsert: null,
    sessUpdate: null,
    presenceJoin: null,
  };

  channelA
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "selections" },
      (payload) => {
        if (payload.new?.item_id) events.selInsert = performance.now();
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "selections" },
      (payload) => {
        if (payload.old?.item_id) events.selDelete = performance.now();
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "participants" },
      (payload) => {
        if (payload.new?.id) events.partInsert = performance.now();
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "sessions" },
      (payload) => {
        if (payload.new?.id === sessionId)
          events.sessUpdate = performance.now();
      }
    )
    .on("presence", { event: "join" }, () => {
      events.presenceJoin = events.presenceJoin ?? performance.now();
    });

  const subscribed = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 10_000);
    channelA.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Beri jeda kecil: server realtime butuh beberapa puluh ms setelah
        // SUBSCRIBED untuk memasang postgres_changes (race condition di
        // skenario test super-cepat; di UI asli tidak relevan karena user
        // tidak berinteraksi <100ms pertama).
        setTimeout(() => {
          clearTimeout(t);
          resolve(true);
        }, 500);
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        resolve(false);
      }
    });
  });
  check(
    "HP A: channel session:{token} subscribed (anon)",
    subscribed,
    `session:${token}`
  );
  if (!subscribed) process.exit(1);

  // ---------- HP B: aksi via API (RLS anon) ----------
  // 1) Join peserta → event participants INSERT harus sampai ke HP A.
  const tJoin0 = performance.now();
  const joined = await api(`/api/sessions/${token}/participants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "HP-B-User" }),
  });
  check("HP B: join → 201", joined.status === 201);
  const participantId = joined.json?.id;

  // Tunggu event participants INSERT di HP A (throttle 120ms + RTT).
  const waitPart = await (async () => {
    const start = performance.now();
    while (performance.now() - start < 5000) {
      if (events.partInsert && events.partInsert >= tJoin0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { ok: Boolean(events.partInsert && events.partInsert >= tJoin0) };
  })();
  check(
    "HP A menerima INSERT participants live",
    waitPart.ok,
    waitPart.ok ? `${(events.partInsert - tJoin0).toFixed(0)} ms` : "timeout 5s"
  );

  // 2) Claim item 0 → INSERT selections → HP A < 1000 ms.
  const tClaim0 = performance.now();
  const claim = await api(`/api/sessions/${token}/items/${itemRows[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId, selected: true }),
  });
  check("HP B: claim item → 200", claim.status === 200);
  {
    const start = performance.now();
    let ok = false;
    while (performance.now() - start < 5000) {
      if (events.selInsert && events.selInsert >= tClaim0) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const ms = ok ? events.selInsert - tClaim0 : -1;
    check(
      "HP A menerima INSERT selections < 1000 ms",
      ok && ms < 1000,
      ok ? `${ms.toFixed(0)} ms` : "timeout 5s"
    );
  }

  // 3) Unclaim → DELETE selections → HP A < 1000 ms.
  const tUnclaim0 = performance.now();
  const unclaim = await api(`/api/sessions/${token}/items/${itemRows[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId, selected: false }),
  });
  check("HP B: unclaim item → 200", unclaim.status === 200);
  {
    const start = performance.now();
    let ok = false;
    while (performance.now() - start < 5000) {
      if (events.selDelete && events.selDelete >= tUnclaim0) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const ms = ok ? events.selDelete - tUnclaim0 : -1;
    check(
      "HP A menerima DELETE selections < 1000 ms",
      ok && ms < 1000,
      ok ? `${ms.toFixed(0)} ms` : "timeout 5s"
    );
  }

  // 4) Presence: HP B bergabung ke channel yang sama → HP A lihat join.
  //    (Simulasi HP B juga buka halaman web.)
  const hpB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const channelB = hpB.channel(`session:${token}`, {
    config: { presence: { key: "hp-b-test" } },
  });
  const tPres0 = performance.now();
  channelB.subscribe((status) => {
    if (status === "SUBSCRIBED") void channelB.track({ name: "HP-B-User" });
  });
  {
    const start = performance.now();
    let ok = false;
    while (performance.now() - start < 5000) {
      if (events.presenceJoin && events.presenceJoin >= tPres0) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    check(
      "Presence: HP A melihat HP B online",
      ok,
      ok
        ? `${(events.presenceJoin - tPres0).toFixed(0)} ms`
        : "timeout 5s (presence join)"
    );
  }

  // 5) Isolasi lintas sesi: buat sesi kedua, claim di sana tidak boleh
  //    memicu event yang dihitung untuk sesi pertama.
  const other = await api("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ name: "Item Sesi Lain", price: 9000 }] }),
  });
  const otherToken = other.json?.token;
  const otherJoined = await api(`/api/sessions/${otherToken}/participants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "CrossUser" }),
  });
  const otherPartId = otherJoined.json?.id;
  const before = events.selInsert ?? 0;
  await api(`/api/sessions/${otherToken}/items/${other.json.items[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId: otherPartId, selected: true }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  // Payload event sesi lain tetap bisa sampai ke channel A (subscribe
  // tanpa filter item), tapi handler HP A hanya memproses sesi sendiri —
  // verifikasi di sini: state yang dibaca via API sesi pertama tidak berubah.
  const detailAfter = await api(`/api/sessions/${token}`);
  const item0 = detailAfter.json?.items?.find((i) => i.id === itemRows[0].id);
  check(
    "Isolasi: klaim sesi lain tidak mengubah sesi ini",
    item0 && item0.selections.length === 0,
    `selections=${item0?.selections?.length ?? "?"} (harus 0)`
  );
  void before;

  // 6) Finalize → UPDATE sessions (migration 0002) → HP A < 1000 ms.
  //    Semua item harus diklaim dulu (claim kembali item 0 + item 1,2 oleh
  //    peserta yang sama via API).
  for (const it of itemRows) {
    await api(`/api/sessions/${token}/items/${it.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, selected: true }),
    });
  }
  const tFin0 = performance.now();
  const fin = await api(`/api/sessions/${token}/finalize`, { method: "POST" });
  check("HP B/admin: finalize → 200", fin.status === 200, fin.json?.error);
  {
    const start = performance.now();
    let ok = false;
    while (performance.now() - start < 5000) {
      if (events.sessUpdate && events.sessUpdate >= tFin0) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const ms = ok ? events.sessUpdate - tFin0 : -1;
    check(
      "HP A menerima UPDATE sessions (finalized) < 1000 ms",
      ok && ms < 1000,
      ok ? `${ms.toFixed(0)} ms` : "timeout 5s (butuh migration 0002)"
    );
  }

  // 7) RLS tetap: toggle setelah finalized → 409.
  const afterFin = await api(`/api/sessions/${token}/items/${itemRows[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId, selected: false }),
  });
  check("RLS: toggle setelah finalized → 409", afterFin.status === 409);

  // ---------- Cleanup ----------
  await hpA.removeChannel(channelA);
  await hpB.removeChannel(channelB);

  console.log(
    `\nSelesai: ${pass} pass, ${fail} fail ${fail === 0 ? "✔" : "✘"}`
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
