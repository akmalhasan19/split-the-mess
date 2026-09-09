/**
 * POST /api/sessions/[token]/qris — upload gambar QRIS ke Supabase Storage
 * bucket `receipts` (Task 2.2).
 *
 * - Multipart form-data, field `file` (png/jpeg/webp, maks 2 MB).
 * - Path file: `qris/{token}/{timestamp}.{ext}` (folder per sesi).
 * - Simpan URL publik ke `sessions.payer_qris_url` (hanya saat draft).
 * - Baca sesi via anon (RLS), tulis sessions via service role sesuai
 *   konvensi skema Fase 1.
 */
import { NextResponse, type NextRequest } from "next/server";

import { mapApiError, requireDraftSession } from "@/lib/api/sessions";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "receipts";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    // Validasi sesi masih ada & draft (RLS anon read).
    const session = await requireDraftSession(token);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Body harus multipart/form-data dengan field `file`." },
        { status: 400 }
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Field `file` wajib diisi." },
        { status: 400 }
      );
    }
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Format harus PNG, JPG, atau WebP." },
        { status: 415 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Ukuran maksimal 2 MB." },
        { status: 413 }
      );
    }

    const supabase = createServiceClient();
    const path = `qris/${token}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = data.publicUrl;

    const { error: updateError } = await supabase
      .from("sessions")
      .update({ payer_qris_url: publicUrl })
      .eq("id", session.id);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, url: publicUrl, path });
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
