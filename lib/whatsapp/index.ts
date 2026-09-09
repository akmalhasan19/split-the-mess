/**
 * WhatsApp adapter placeholder (implementasi Baileys di Fase 4).
 * Struktur ini mengunci kontrak: Baileys dulu, Cloud API belakangan.
 */
export interface WhatsappAdapter {
  sendText(to: string, message: string): Promise<void>;
}
