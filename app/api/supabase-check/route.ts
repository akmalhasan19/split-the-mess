import { NextResponse } from "next/server";

function mask(value: string | undefined): string {
  if (!value) return "missing";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)} (len=${value.length})`;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const configured = Boolean(url && anonKey);

  let reachable: boolean | null = null;
  let detail = "not-checked";

  if (configured) {
    try {
      // Lightweight read check: auth endpoint must answer even without data.
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: anonKey as string },
        cache: "no-store",
      });
      reachable = res.ok;
      detail = `auth /health -> HTTP ${res.status}`;
    } catch (error) {
      reachable = false;
      detail = error instanceof Error ? error.message : "fetch failed";
    }
  }

  return NextResponse.json(
    {
      ok: configured && reachable !== false,
      configured,
      url: mask(url),
      anonKey: mask(anonKey),
      serviceRoleKey: mask(serviceKey),
      reachable,
      detail,
    },
    { status: configured && reachable === false ? 503 : 200 }
  );
}
