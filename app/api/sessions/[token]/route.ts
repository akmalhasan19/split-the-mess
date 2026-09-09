/**
 * GET /api/sessions/[token] — detail sesi untuk UI (Task 1.3).
 *
 * Response 200:
 * {
 *   session: {...fields struk + status + payer info},
 *   items: [...dengan selections: [participantId]],
 *   participants: [...],
 *   settlements?: [...]   // hanya bila status finalized
 * }
 */
import { NextResponse } from "next/server";

import {
  FinalizedSessionError,
  getSessionByToken,
  getSettlements,
  loadSessionData,
  mapApiError,
  type SelectionRow,
} from "@/lib/api/sessions";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const session = await getSessionByToken(token);
    if (!session) {
      return NextResponse.json(
        { error: `Sesi "${token}" tidak ditemukan atau sudah expired.` },
        { status: 404 }
      );
    }

    const { items, participants, selections } = await loadSessionData(
      session.id
    );

    const selectionsByItem: Record<string, string[]> = {};
    for (const sel of selections as SelectionRow[]) {
      (selectionsByItem[sel.item_id] ??= []).push(sel.participant_id);
    }

    let settlements: unknown = undefined;
    if (session.status === "finalized") {
      settlements = await getSettlements(session.id);
    }

    return NextResponse.json({
      session,
      items: items.map((item) => ({
        ...item,
        selections: selectionsByItem[item.id] ?? [],
      })),
      participants,
      settlements,
    });
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * PATCH /api/sessions/[token] — edit pajak / service / diskon / info bayar
 * (Task 2.2 sekarang; dipakai UI admin minimal Fase 1).
 * Body (semua opsional): { tax?, service_charge?, discount?, payer_bca?,
 * payer_qris_url?, receipt_image_url? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const session = await getSessionByToken(token);
    if (!session) {
      return NextResponse.json(
        { error: `Sesi "${token}" tidak ditemukan atau sudah expired.` },
        { status: 404 }
      );
    }
    if (session.status !== "draft") throw new FinalizedSessionError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body harus JSON valid." },
        { status: 400 }
      );
    }
    const b = (body ?? {}) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    for (const field of ["tax", "service_charge", "discount"] as const) {
      if (b[field] !== undefined) {
        const n = Number(b[field]);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: `${field} harus angka ≥ 0.` },
            { status: 400 }
          );
        }
        updates[field] = Math.round(n);
      }
    }
    for (const field of [
      "payer_bca",
      "payer_qris_url",
      "receipt_image_url",
    ] as const) {
      if (b[field] !== undefined) {
        if (typeof b[field] !== "string") {
          return NextResponse.json(
            { error: `${field} harus string.` },
            { status: 400 }
          );
        }
        updates[field] = (b[field] as string).trim() || null;
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "Tidak ada field yang diubah." },
        { status: 400 }
      );
    }

    // Tulis via service role sesuai konvensi skema (policy anon pada tabel
    // sessions hanya read; API route memvalidasi draft + whitelist field).
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("sessions")
      .update(updates)
      .eq("id", session.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, session: data });
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
