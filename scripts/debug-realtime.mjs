/**
 * Debug realtime: log SEMUA postgres_changes raw di channel session:{token}
 * lalu trigger insert participants & selections via API.
 *
 *   node --env-file=.env scripts/debug-realtime.mjs [baseURL]
 */
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  try {
    return { status: res.status, json: await res.json() };
  } catch {
    return { status: res.status, json: null };
  }
}

const created = await api("/api/sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ items: [{ name: "Debug", price: 10000 }] }),
});
const token = created.json.token;
const sessionId = created.json.id;
console.log("session:", token, sessionId);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const channel = client.channel(`session:${token}`);

let sawPart = false;
let sawSel = false;

channel
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "participants" },
    (payload) => {
      sawPart = true;
      console.log("[RAW] participants INSERT:", JSON.stringify(payload.new));
    }
  )
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "selections" },
    (payload) => {
      sawSel = true;
      console.log("[RAW] selections INSERT:", JSON.stringify(payload.new));
    }
  )
  .subscribe((status) => {
    console.log("subscribe status:", status);
    if (status !== "SUBSCRIBED") return;
    (async () => {
      await new Promise((r) => setTimeout(r, 1000));

      const p = await api(`/api/sessions/${token}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Debugger" }),
      });
      console.log("join status:", p.status);
      await new Promise((r) => setTimeout(r, 3000));

      const c = await api(`/api/sessions/${token}/items/${created.json.items[0].id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId: p.json.id, selected: true }),
      });
      console.log("claim status:", c.status);
      await new Promise((r) => setTimeout(r, 3000));

      console.log("RESULT sawPart =", sawPart, "sawSel =", sawSel);
      process.exit(0);
    })();
  });
