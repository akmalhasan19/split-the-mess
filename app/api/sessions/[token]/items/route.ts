/**
 * POST /api/sessions/[token]/items — tambah item ke sesi draft.
 *
 * Body: { name, price, qty? }
 * - 201 → item row
 */
import { NextResponse, type NextRequest } from "next/server";

import { mapApiError, requireDraftSession } from "@/lib/api/sessions";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const session = await requireDraftSession(token);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body harus JSON valid." },
        { status: 400 }
      );
    }
    const b = (body ?? {}) as {
      name?: unknown;
      price?: unknown;
      qty?: unknown;
    };

    const name = typeof b.name === "string" ? b.name.trim() : "";
    const price = Number(b.price);
    const qty = Number.isFinite(Number(b.qty))
      ? Math.round(Number(b.qty ?? 1))
      : NaN;

    if (!name) {
      return NextResponse.json({ error: "name wajib diisi." }, { status: 400 });
    }
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json(
        { error: "price harus angka ≥ 0." },
        { status: 400 }
      );
    }
    if (!Number.isInteger(qty) || qty < 1) {
      return NextResponse.json(
        { error: "qty harus integer ≥ 1." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("items")
      .insert({
        session_id: session.id,
        name: name.slice(0, 80),
        price: Math.round(price),
        qty,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
