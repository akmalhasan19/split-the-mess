/**
 * POST /api/sessions — buat sesi baru + item + peserta awal (Task 1.3).
 *
 * Body:
 * {
 *   items: [{ name, price, qty? }],           // wajib, ≥ 1 item
 *   participants?: string[],                  // opsional, default ["Admin"]
 *   tax?, service_charge?, discount?: number, // nominal rupiah ≥ 0
 *   payer_bca?: string, payer_qris_url?: string, receipt_image_url?: string
 * }
 *
 * Response 201: { id, token, expires_at }
 * Token = nanoid 8 char (alphabet tanpa karakter ambigu).
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  mapApiError,
  newSessionToken,
  type ItemRow,
  type ParticipantRow,
  type SessionRow,
} from "@/lib/api/sessions";
import { createServiceClient } from "@/lib/supabase/server";

interface IncomingItem {
  name?: unknown;
  price?: unknown;
  qty?: unknown;
}

function asFiniteInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

function parsePayload(body: unknown):
  | {
      items: { name: string; price: number; qty: number }[];
      participants: string[];
      tax: number;
      service_charge: number;
      discount: number;
      payer_bca: string | null;
      payer_qris_url: string | null;
      receipt_image_url: string | null;
    }
  | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Body harus JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.items) || b.items.length === 0) {
    return { error: "Minimal 1 item (items: [{ name, price }])." };
  }
  const items: { name: string; price: number; qty: number }[] = [];
  for (const raw of b.items as IncomingItem[]) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const price = asFiniteInt(raw?.price);
    const qtyRaw = asFiniteInt(raw?.qty ?? 1);
    if (!name) return { error: "Setiap item butuh name." };
    if (price === null || price < 0)
      return { error: `Harga item "${name}" harus angka ≥ 0.` };
    if (qtyRaw === null || qtyRaw < 1)
      return { error: `Qty item "${name}" harus ≥ 1.` };
    items.push({ name: name.slice(0, 80), price, qty: qtyRaw });
  }

  const participantsRaw = Array.isArray(b.participants)
    ? (b.participants as unknown[])
    : ["Admin"];
  const participants: string[] = [];
  for (const p of participantsRaw) {
    if (typeof p !== "string" || !p.trim())
      return { error: "Nama peserta tidak boleh kosong." };
    const name = p.trim().slice(0, 40);
    if (!participants.includes(name)) participants.push(name);
  }

  const num = (v: unknown, label: string): number | string => {
    const n = asFiniteInt(v ?? 0);
    if (n === null || n < 0) return `${label} harus angka ≥ 0.`;
    return n;
  };
  const tax = num(b.tax, "tax");
  if (typeof tax === "string") return { error: tax };
  const service_charge = num(b.service_charge, "service_charge");
  if (typeof service_charge === "string") return { error: service_charge };
  const discount = num(b.discount, "discount");
  if (typeof discount === "string") return { error: discount };

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  return {
    items,
    participants,
    tax,
    service_charge,
    discount,
    payer_bca: str(b.payer_bca),
    payer_qris_url: str(b.payer_qris_url),
    receipt_image_url: str(b.receipt_image_url),
  };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body harus JSON valid." },
      { status: 400 }
    );
  }

  const parsed = parsePayload(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    // Sesi dibuat via service role: RLS sengaja tidak memberi INSERT anon
    // pada tabel sessions (hanya API route server yang boleh membuat sesi).
    const supabase = createServiceClient();
    const token = newSessionToken();

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        token,
        receipt_image_url: parsed.receipt_image_url,
        subtotal: parsed.items.reduce((a, i) => a + i.price, 0),
        tax: parsed.tax,
        service_charge: parsed.service_charge,
        discount: parsed.discount,
        payer_bca: parsed.payer_bca,
        payer_qris_url: parsed.payer_qris_url,
        status: "draft",
      })
      .select()
      .single();
    if (sessionError) throw sessionError;
    const created = session as SessionRow;

    const itemRows = parsed.items.map((i) => ({
      session_id: created.id,
      name: i.name,
      price: i.price,
      qty: i.qty,
    }));
    const { data: itemData, error: itemsError } = await supabase
      .from("items")
      .insert(itemRows)
      .select();
    if (itemsError) throw itemsError;

    const participantRows = parsed.participants.map((display_name) => ({
      session_id: created.id,
      display_name,
    }));
    const { data: participantData, error: participantsError } = await supabase
      .from("participants")
      .insert(participantRows)
      .select();
    if (participantsError) throw participantsError;

    return NextResponse.json(
      {
        id: created.id,
        token: created.token,
        expires_at: created.expires_at,
        items: (itemData ?? []) as ItemRow[],
        participants: (participantData ?? []) as ParticipantRow[],
      },
      { status: 201 }
    );
  } catch (error) {
    const mapped = mapApiError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
