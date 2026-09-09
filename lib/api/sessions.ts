/**
 * Helper API Fase 1 — dipakai bersama oleh route /api/sessions*.
 *
 * Konvensi:
 * - Client anon (RLS) dipakai untuk operasi peserta: baca sesi, tambah
 *   peserta/item, toggle seleksi.
 * - Service role dipakai untuk finalize (menulis settlements + update status
 *   sesi) dan baca settlements.
 * - Error khusus: SessionNotFoundError (404), FinalizedSessionError (409).
 */
import { randomBytes } from "node:crypto";
import { customAlphabet } from "nanoid";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { calcProportional, SplitEngineError } from "@/lib/split-engine";

// Alphabet tanpa karakter mudah tertukar (0/O, 1/l/I) agar token tidak
// mudah salah ketik & tidak mudah ditebak (8 char → 62^8-ish entropi).
const TOKEN_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const generateToken = customAlphabet(TOKEN_ALPHABET, 8);

export class SessionNotFoundError extends Error {
  constructor(token: string) {
    super(`Sesi dengan token "${token}" tidak ditemukan atau sudah expired.`);
    this.name = "SessionNotFoundError";
  }
}

export class FinalizedSessionError extends Error {
  constructor(message = "Sesi sudah finalized.") {
    super(message);
    this.name = "FinalizedSessionError";
  }
}

export type SessionRow = {
  id: string;
  token: string;
  receipt_image_url: string | null;
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  payer_bca: string | null;
  payer_qris_url: string | null;
  status: "draft" | "finalized" | "cancelled";
  raw_ocr_json: unknown;
  created_at: string;
  expires_at: string;
};

export type ItemRow = {
  id: string;
  session_id: string;
  name: string;
  price: number;
  qty: number;
};

export type ParticipantRow = {
  id: string;
  session_id: string;
  display_name: string;
};

export type SelectionRow = { item_id: string; participant_id: string };

export type SettlementRow = {
  session_id: string;
  participant_id: string;
  amount_subtotal: number;
  amount_tax: number;
  amount_service: number;
  amount_discount: number;
  amount_final: number;
  is_paid: boolean;
};

/** Token sesi baru (8 char, tanpa karakter ambigu). */
export function newSessionToken(): string {
  return generateToken();
}

/** Token acak internal (tanpa kebutuhan keterbacaan). */
export function newInternalId(): string {
  return randomBytes(12).toString("hex");
}

/** Baca satu sesi berdasarkan token (anon + RLS → otomatis cek expiry). */
export async function getSessionByToken(
  token: string
): Promise<SessionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow) ?? null;
}

/** Sesi harus ada & masih draft, else throw error terpetakan. */
export async function requireDraftSession(token: string): Promise<SessionRow> {
  const session = await getSessionByToken(token);
  if (!session) throw new SessionNotFoundError(token);
  if (session.status !== "draft") throw new FinalizedSessionError();
  return session;
}

export function mapApiError(error: unknown): {
  status: number;
  body: { error: string };
} {
  if (error instanceof SessionNotFoundError)
    return { status: 404, body: { error: error.message } };
  if (error instanceof FinalizedSessionError)
    return { status: 409, body: { error: error.message } };
  if (error instanceof SplitEngineError)
    return { status: 400, body: { error: `Split engine: ${error.message}` } };

  // Error Supabase/PostgREST datang sebagai plain object, bukan instance Error.
  const asRecord = error as { message?: unknown; code?: unknown } | null;
  const message =
    (error instanceof Error && error.message) ||
    (typeof asRecord?.message === "string" && asRecord.message) ||
    "Internal error";
  const code = typeof asRecord?.code === "string" ? asRecord.code : undefined;

  // 23505 = unique violation; 42501 = RLS violation (seharusnya tidak terjadi
  // dari kode server — log untuk debug).
  if (code === "23505") {
    return { status: 409, body: { error: "Data duplikat." } };
  }
  if (message === "Internal error" || (code && code !== "23505")) {
    console.error("[api] unexpected db error:", error);
  }
  return { status: 500, body: { error: message } };
}

// ---------------------------------------------------------------
// Finalize: kalkulasi + simpan settlements + set status finalized.
// ---------------------------------------------------------------

export interface FinalizeResult {
  sessionId: string;
  token: string;
  settlements: Array<{
    participantId: string;
    displayName: string;
    amountSubtotal: number;
    amountTax: number;
    amountService: number;
    amountDiscount: number;
    amountFinal: number;
  }>;
  totals: {
    subtotal: number;
    claimedSubtotal: number;
    unclaimedSubtotal: number;
    tax: number;
    service: number;
    discount: number;
    grandTotal: number;
    settledTotal: number;
    diff: number;
  };
  unclaimedItems: Array<{ id: string; name: string; price: number }>;
}

/** Muat items + participants + selections (RLS) untuk satu sesi. */
export async function loadSessionData(sessionId: string): Promise<{
  items: ItemRow[];
  participants: ParticipantRow[];
  selections: SelectionRow[];
}> {
  const supabase = await createClient();
  const itemsRes = await supabase
    .from("items")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at");
  if (itemsRes.error) throw itemsRes.error;
  const participantsRes = await supabase
    .from("participants")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at");
  if (participantsRes.error) throw participantsRes.error;

  const items = (itemsRes.data ?? []) as ItemRow[];
  const itemIds = items.map((i) => i.id);
  const selectionsRes =
    itemIds.length > 0
      ? await supabase
          .from("selections")
          .select("item_id, participant_id")
          .in("item_id", itemIds)
      : { data: [], error: null };
  if (selectionsRes.error) throw selectionsRes.error;

  return {
    items,
    participants: (participantsRes.data ?? []) as ParticipantRow[],
    selections: (selectionsRes.data ?? []) as SelectionRow[],
  };
}

/**
 * Finalize sesi: hitung ulang dari data live, simpan settlements (service
 * role), set status finalized. Idempotent pada level hasil — menimpa
 * settlements lama bila dijalankan ulang.
 */
export async function finalizeSession(token: string): Promise<FinalizeResult> {
  const session = await requireDraftSession(token);
  const { items, participants, selections } = await loadSessionData(session.id);

  if (items.length === 0) {
    throw new SplitEngineError("tidak ada item untuk dihitung");
  }
  if (participants.length === 0) {
    throw new SplitEngineError("tidak ada peserta terdaftar");
  }

  const selectionsMap: Record<string, string[]> = {};
  for (const sel of selections) {
    (selectionsMap[sel.item_id] ??= []).push(sel.participant_id);
  }

  const result = calcProportional(
    items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    selectionsMap,
    session.tax,
    session.service_charge,
    session.discount,
    {
      participants: participants.map((p) => ({
        id: p.id,
        displayName: p.display_name,
      })),
    }
  );

  if (!result.isFullyClaimed) {
    const names = result.unclaimedItems.map((u) => u.name).join(", ");
    throw new SplitEngineError(
      `masih ada item tanpa pemilih: ${names}. Centang dulu sebelum finalize.`
    );
  }

  const admin = createServiceClient();
  const rows = result.settlements.map((s) => ({
    session_id: session.id,
    participant_id: s.participantId,
    amount_subtotal: s.amountSubtotal,
    amount_tax: s.amountTax,
    amount_service: s.amountService,
    amount_discount: s.amountDiscount,
    amount_final: s.amountFinal,
    is_paid: false,
  }));

  const { error } = await admin
    .from("settlements")
    .upsert(rows, { onConflict: "session_id,participant_id" });
  if (error) throw error;

  const { error: statusError } = await admin
    .from("sessions")
    .update({ status: "finalized" })
    .eq("id", session.id);
  if (statusError) throw statusError;

  return {
    sessionId: session.id,
    token: session.token,
    settlements: result.settlements.map((s) => ({
      participantId: s.participantId,
      displayName: s.displayName,
      amountSubtotal: s.amountSubtotal,
      amountTax: s.amountTax,
      amountService: s.amountService,
      amountDiscount: s.amountDiscount,
      amountFinal: s.amountFinal,
    })),
    totals: result.totals,
    unclaimedItems: result.unclaimedItems,
  };
}

/** Ambil hasil final (settlements) untuk sesi — service role read. */
export async function getSettlements(sessionId: string) {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("settlements")
    .select("*, participants(display_name)")
    .eq("session_id", sessionId)
    .order("amount_final", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
