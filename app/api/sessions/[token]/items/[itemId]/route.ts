/**
 * PATCH /api/sessions/[token]/items/[itemId] — toggle pemilih pada satu item
 * (Task 1.4 sekarang; dipakai ulang UI peserta Fase 2 dengan optimistic UI).
 *
 * Body: { participantId, selected: boolean }
 * - 200 → { ok: true, selected, selections: [participantId, ...] }
 *
 * Catatan RLS: menulis via client anon — policy `selections_write_draft`
 * menolak bila sesi finalized/expired.
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  mapApiError,
  requireDraftSession,
  type SelectionRow,
} from "@/lib/api/sessions";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; itemId: string }> }
) {
  const { token, itemId } = await params;
  try {
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
      participantId?: unknown;
      selected?: unknown;
    };

    const participantId =
      typeof b.participantId === "string" ? b.participantId : "";
    const selected = b.selected === true;
    if (!participantId) {
      return NextResponse.json(
        { error: "participantId wajib diisi." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Validasi silang secara paralel: sesi harus draft, item & peserta milik sesi ini.
    const [session, { data: item }, { data: participant }] = await Promise.all([
      requireDraftSession(token),
      supabase
        .from("items")
        .select("id, session_id")
        .eq("id", itemId)
        .maybeSingle(),
      supabase
        .from("participants")
        .select("id, session_id")
        .eq("id", participantId)
        .maybeSingle(),
    ]);

    if (!item || item.session_id !== session.id) {
      return NextResponse.json(
        { error: "Item tidak ditemukan." },
        { status: 404 }
      );
    }
    if (!participant || participant.session_id !== session.id) {
      return NextResponse.json(
        { error: "Peserta tidak ditemukan." },
        { status: 404 }
      );
    }

    if (selected) {
      const { error } = await supabase
        .from("selections")
        .upsert(
          { item_id: itemId, participant_id: participantId },
          { onConflict: "item_id,participant_id" }
        );
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("selections")
        .delete()
        .eq("item_id", itemId)
        .eq("participant_id", participantId);
      if (error) throw error;
    }

    const { data: current } = await supabase
      .from("selections")
      .select("participant_id")
      .eq("item_id", itemId);
    const selections = (
      (current ?? []) as Pick<SelectionRow, "participant_id">[]
    ).map((r) => r.participant_id);

    return NextResponse.json({ ok: true, selected, selections });
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
