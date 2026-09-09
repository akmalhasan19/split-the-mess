/**
 * Bentuk DTO yang dikembalikan GET /api/sessions/[token] — dipakai bersama
 * oleh UI admin (/admin/[token]) dan UI peserta (/s/[token], Fase 2).
 *
 * Sengaja dipisah dari lib/api/sessions.ts (server-only: import crypto &
 * supabase server) agar boleh di-import client components.
 */

export interface SessionDto {
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
}

export interface ItemDto {
  id: string;
  session_id: string;
  name: string;
  price: number;
  qty: number;
  created_at?: string;
  /** participantId yang mengklaim item ini. */
  selections: string[];
}

export interface ParticipantDto {
  id: string;
  session_id: string;
  display_name: string;
  created_at?: string;
}

export interface SettlementDto {
  session_id: string;
  participant_id: string;
  amount_subtotal: number;
  amount_tax: number;
  amount_service: number;
  amount_discount: number;
  amount_final: number;
  is_paid: boolean;
  created_at?: string;
  participants: { display_name: string } | null;
}

export interface SessionDetailDto {
  session: SessionDto;
  items: ItemDto[];
  participants: ParticipantDto[];
  settlements?: SettlementDto[];
}
