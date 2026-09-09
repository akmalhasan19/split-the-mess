/**
 * POST /api/sessions/[token]/finalize — kalkulasi final + simpan settlements
 * (Task 1.3). Menolak bila masih ada item tanpa pemilih (400, berisi daftar
 * item yang belum diklaim) atau sesi bukan draft (409).
 */
import { NextResponse } from "next/server";

import { finalizeSession, mapApiError } from "@/lib/api/sessions";
import { SplitEngineError } from "@/lib/split-engine";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const result = await finalizeSession(token);
    return NextResponse.json({
      ok: true,
      token: result.token,
      settlements: result.settlements,
      totals: result.totals,
    });
  } catch (error) {
    // Pesan "masih ada item tanpa pemilih" lebih cocok 400 (perbaiki input)
    // daripada 500.
    if (error instanceof SplitEngineError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
