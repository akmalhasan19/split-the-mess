/**
 * POST /api/sessions/[token]/participants — join sesi dengan nama
 * (Task 1.4 sekarang; dipakai ulang UI peserta di Fase 2).
 *
 * Body: { displayName }
 * - 201 → { id, displayName }
 * - 409 → nama sudah dipakai di sesi ini
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
    const displayName =
      typeof (body as { displayName?: unknown })?.displayName === "string"
        ? (body as { displayName: string }).displayName.trim()
        : "";

    if (!displayName) {
      return NextResponse.json(
        { error: "displayName wajib diisi." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("participants")
      .insert({
        session_id: session.id,
        display_name: displayName.slice(0, 40),
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json(
      { id: data.id, displayName: data.display_name },
      { status: 201 }
    );
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
