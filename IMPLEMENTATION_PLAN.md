# Implementation Plan — Split The Mess V2

> Sumber ide: `split_the_mess.md`
> Stack: **Next.js + Supabase** | WA: **Hybrid bertahap (Baileys MVP → Cloud API)** | OCR: **Manual dulu, OCR belakangan**
> Cara pakai: centang `- [ ]` → `- [x]` setiap selesai. Selesaikan berurutan: `0 → 1 → 2 → 3 → 4 → 6 → 5 → 7`.

---

## Legend Status

- `- [ ]` = belum mulai
- `- [x]` = selesai
- Prioritas MVP: Fase 0, 1, 2, 3, 4, 6 dulu. Fase 5 (OCR) dan 7 (Hardening/Migrasi) belakangan.

---

- [x] **Fase 0: Scaffolding & Foundasi** — SELESAI 2026-09-09 (`verify-phase0` 38/38; `npm run build` sukses; `tsc` bersih; Supabase LIVE: auth 200 + bucket `receipts` + roundtrip OK).
  - [x] **Task 0.1: Init repo & Next.js App**
    - [x] Init Next.js (App Router) + TypeScript di root repo
    - [x] Install & konfigurasi Tailwind CSS + shadcn/ui
    - [x] Setup ESLint + Prettier + `npm run dev` jalan tanpa error
    - [x] Buat struktur folder: `/app/s/[token]`, `/lib/split-engine`, `/lib/whatsapp`, `/lib/supabase`
  - [x] **Task 0.2: Setup Supabase project** — LIVE terverifikasi 2026-09-09 (auth health 200; bucket `receipts` public dibuat; roundtrip upload/download/delete OK).
    - [x] Buat project Supabase baru
    - [x] Simpan `NEXT_PUBLIC_SUPABASE_URL` & `ANON_KEY` & `SERVICE_ROLE_KEY` ke `.env.local`
    - [x] Buat Storage bucket `receipts` (public read untuk MVP, private bila perlu) — via `GET /api/storage-check` (auto-create + roundtrip test)
    - [x] Verifikasi koneksi read/write dari Next.js ke Supabase — via `GET /api/supabase-check` & `/api/storage-check`
  - [x] **Task 0.3: Setup deploy & CI dasar** — SELESAI 2026-09-09. Production `https://split-the-mess.vercel.app` live: `/` + `/api/health` + `/api/supabase-check` + `/api/storage-check` semua OK. Fix: Framework Preset Vercel `Other` → `Next.js` (build sebelumnya hijau tapi output tidak di-serve → 404 platform di semua route).
    - [x] Deploy awal ke Vercel (preview) berhasil
    - [ ] Cek layout di in-app browser WhatsApp (mobile, tidak pecah) — layout mobile-first siap; butuh cek manual user dari HP.
    - [x] Buat file SQL migration awal (kosong / placeholder)

- [x] **Fase 1: Core Split Engine + Session Manual** — SELESAI 2026-09-09 (Vitest 21/21; migrasi live: 5 tabel + RLS semua PASS via `scripts/db-push.mjs`; E2E API 15/15 (`scripts/verify-phase1-api.mjs` pada `next start`); UI admin terverifikasi via browser: finalize contoh proposal pas Rp398.500, diff 0).
  - [x] **Task 1.1: Implementasi `split-engine.ts`** — `lib/split-engine/index.ts` pure functions.
    - [x] Implementasi `calcProportional(items, selections, tax, service, discount)`
    - [x] Implementasi `smartRounding` (largest remainder agar sum == total struk)
    - [x] Handle edge: item tanpa pemilih, 1 item dimakan berdua, diskon > pajak
    - [x] Buat unit test dengan Vitest (target 15+ kasus) — 21 kasus di `lib/split-engine/index.test.ts` (K1–K21)
  - [x] **Task 1.2: Skema DB inti (Supabase Postgres)** — `supabase/migrations/0001_phase1_core_schema.sql` (idempotent) + apply live via `scripts/db-push.mjs` (SUPABASE_DB_URL). RLS: read saat sesi live, write hanya saat draft; settlement ditulis service role.
    - [x] Buat tabel `sessions (id, token unique, receipt_image_url, subtotal, tax, service_charge, discount, payer_bca, payer_qris_url, status, raw_ocr_json)` + `expires_at` 7 hari
    - [x] Buat tabel `items (id, session_id, name, price, qty)`
    - [x] Buat tabel `participants (id, session_id, display_name)`
    - [x] Buat tabel `selections (item_id, participant_id)` many-to-many
    - [x] Buat tabel `settlements (session_id, participant_id, amount_subtotal, amount_tax, amount_service, amount_discount, amount_final, is_paid)`
  - [x] **Task 1.3: API session manual** — helper bersama di `lib/api/sessions.ts`; finalize diimplement per-token (`/api/sessions/[token]/finalize`) agar konsisten dengan link publik.
    - [x] `POST /api/sessions` — buat sesi + generate token (nanoid 8 char, alphabet tanpa karakter ambigu; via service role)
    - [x] `POST /api/sessions/[token]/finalize` — kalkulasi final + simpan settlements (tolak 400 bila ada item tanpa pemilih; 409 bila finalized)
    - [x] `GET /api/sessions/[token]` — ambil detail sesi untuk UI (items + selections + participants + settlements)
    - [x] Tambahan: `PATCH /api/sessions/[token]` (edit pajak/service/diskon/bayar), `POST .../items`, `POST .../participants`, `PATCH .../items/[itemId]` (toggle seleksi, upsert onConflict)
  - [x] **Task 1.4: UI Admin minimal (validasi matematika)** — `/admin` (buat sesi) + `/admin/[token]` (tabel centang, tambah item/peserta, edit pajak, Selesai & Hitung, hasil final + copy BCA).
    - [x] Form buat sesi + tambah item manual (nama + harga)
    - [x] Form pajak / service / diskon + info pembayaran (BCA/QRIS)
    - [x] Tabel centang siapa makan apa + tombol Hitung
    - [x] Verifikasi contoh proposal (Pizza 85k, dst total 350k) hasilnya pas 100% — 6 item subtotal 350.000 + pajak 38.500 + service 35.000 − diskon 25.000 = 398.500; settlements berjumlah tepat 398.500 (diff 0), dicek via API E2E dan lewat UI browser

- [x] **Fase 2: Web App Aesthetic Mobile-First (Peserta View)** — SELESAI 2026-09-09 (`scripts/verify-phase2.mjs` 18/18; regresi `verify-phase1-api` 15/15; Vitest 21/21; `npm run build` sukses; UI peserta/admin/hasil terverifikasi via browser preview).
  - [x] **Task 2.1: Halaman peserta `/s/[token]`** — `app/s/[token]/page.tsx`; nama via localStorage (`useSyncExternalStore`), claim/unclaim optimistic + rollback + toast.
    - [x] Card daftar menu (nama, harga, avatar pemilih live)
    - [x] Input nama sekali (simpan di localStorage)
    - [x] Tap untuk claim / unclaim item (optimistic UI)
    - [x] State loading skeleton + empty state + error state
  - [x] **Task 2.2: Halaman admin `/s/[token]/admin`** — komponen bersama `components/sessions/SessionAdminView.tsx` (dipakai juga `/admin/[token]`, refactor Task 1.4). Fix: PATCH sesi pindah ke service role sesuai konvensi RLS Fase 1 (sebelumnya 500 karena policy anon `sessions` hanya read). Upload QRIS: `POST /api/sessions/[token]/qris` → Storage `receipts` (png/jpg/webp ≤2MB) + simpan URL publik.
    - [x] Edit pajak / service / diskon
    - [x] Edit info pembayaran (BCA, QRIS URL/image)
    - [x] Tombol `Selesai & Hitung` + konfirmasi
  - [x] **Task 2.3: Halaman hasil `/s/[token]/result`** — rincian per orang (makanan + pajak/service − diskon), copy BCA (clipboard API + fallback), QRIS image/link, empty state draft.
    - [x] Tampilkan rincian per orang + total presisi struk
    - [x] Tombol copy nomor rekening + buka link QRIS
    - [x] Optimasi mobile: button min 44px, font besar, ringan untuk in-app browser WA
  - [x] **Task 2.4: Validasi tanpa login** — E2E `scripts/verify-phase2.mjs` 18/18 PASS.
    - [x] 5 user buka link sama tanpa login tanpa error RLS
    - [x] Token tidak mudah ditebak + expiry 7 hari (logika awal)

- [x] **Fase 3: Realtime Sync (Supabase Realtime)** — SELESAI 2026-09-09 (`scripts/verify-phase3.mjs` 13/13; regresi Fase 1 15/15; regresi Fase 2 18/18; Vitest 21/21; ESLint 0 warning; `npm run build` sukses).
  - [x] **Task 3.1: Aktifkan Realtime**
    - [x] Enable Realtime untuk `selections` & `participants` — migrasi `0002_phase3_realtime.sql` live di Supabase (`selections`, `participants`, `sessions` di `supabase_realtime`)
    - [x] Subscribe channel `session:{token}` di client — `lib/hooks/use-session-realtime.ts` (dipakai di `/s/[token]` dan view admin)
    - [x] Upsert `selections` dengan `onConflict(item_id, participant_id)` — dioptimasi pada `PATCH /api/sessions/[token]/items/[itemId]`
  - [x] **Task 3.2: UX realtime**
    - [x] Optimistic update + rollback saat gagal — di `/s/[token]/page.tsx` (`toggleItem` dengan pending map & toast rollback)
    - [x] Presence siapa online (Supabase presence) — channel presence tracking `{ name }` & status indicator live
    - [x] Debounce / throttle update agar tidak spam — throttle 120ms di `use-session-realtime.ts`
  - [x] **Task 3.3: RLS & keamanan link**
    - [x] Buat RLS policy anon read/write berbasis token sesi — `0001_phase1_core_schema.sql` (enforce draft & live session di database level)
    - [x] Validasi token di Edge Function / API route bila perlu — validasi paralel di route `[itemId]` dan `requireDraftSession`
    - [x] Test: HP A centang → HP B muncul <1 detik tanpa refresh — verified via `verify-phase3.mjs` (INSERT selections ~538 ms, DELETE ~512 ms, finalize update ~919 ms)

- [ ] **Fase 4: WhatsApp Bot MVP (Baileys)**
  - [ ] **Task 4.1: Setup service `bot/`**
    - [ ] Init service Node + Baileys terpisah dari Next.js (untuk VPS/Railway/Fly.io)
    - [ ] QR auth + session persistent + auto-reconnect
    - [ ] Upload gambar struk ke Supabase Storage `receipts`
  - [ ] **Task 4.2: Abstraksi `WhatsappAdapter`**
    - [ ] Buat interface `sendText(), sendSummary(), parseCommand()`
    - [ ] Implementasi `BaileysAdapter` (sekarang)
    - [ ] Siapkan stub `CloudApiAdapter` (untuk Fase 7)
  - [ ] **Task 4.3: Command grup**
    - [ ] Deteksi `/split` + gambar di `messages.upsert`
    - [ ] Balas template: Struk diterima + Total + link `https://.../s/[token]`
    - [ ] Command `/link`, `/hasil`, `/help`
    - [ ] Kirim ringkasan final + BCA/QRIS ke grup saat sesi finalized (webhook)
  - [ ] **Task 4.4: Validasi end-to-end MVP**
    - [ ] Kirim foto + `/split` di grup → bot balas link
    - [ ] Selesaikan pilih di web → bot kirim ringkasan ke grup

- [ ] **Fase 5: OCR & Smart Parsing (Setelah MVP Stabil)**
  - [ ] **Task 5.1: API OCR**
    - [ ] Buat `POST /api/ocr` terima `receipt_image_url`
    - [ ] Integrasi provider trial (Google Vision / Veryfi / Textract)
    - [ ] Normalisasi output ke `{items[], tax, service, discount, total}` + simpan `raw_ocr_json`
  - [ ] **Task 5.2: Human-in-the-loop UI**
    - [ ] Tampilkan `Hasil Scan - koreksi jika salah` di admin
    - [ ] Fallback ke input manual jika confidence rendah
    - [ ] Test 10 struk warteg/cafe Indonesia, target akurasi >85% setelah koreksi 1 menit

- [ ] **Fase 6: Settlement, Status Bayar & Reminder Halus**
  - [ ] **Task 6.1: Status pembayaran**
    - [ ] Tombol `Saya Sudah Bayar` di result page → update `settlements.is_paid`
    - [ ] Realtime status lunas/belum di admin view
    - [ ] Tampilkan QRIS image + tombol copy BCA
  - [ ] **Task 6.2: Reminder bot**
    - [ ] Command `/tagih` mention hanya yang belum bayar (bahasa halus)
    - [ ] Cron max 1 reminder/hari, anti-spam
    - [ ] Opsi reminder private chat bila nomor tersedia

- [ ] **Fase 7: Hardening, Testing & Migrasi WA Resmi**
  - [ ] **Task 7.1: Testing**
    - [ ] E2E Playwright: buat sesi → pilih → finalize → ringkasan
    - [ ] Load test realtime 20 user bersamaan
    - [ ] Unit test split-engine tetap hijau
  - [ ] **Task 7.2: Security & housekeeping**
    - [ ] Rate-limit bot + API
    - [ ] Validasi token nanoid + expiry sesi 7 hari
    - [ ] Hapus / blokir upload sensitif nyasar (mis. KTP)
    - [ ] Backup Supabase + env production
  - [ ] **Task 7.3: Migrasi WA resmi**
    - [ ] Implementasi `CloudApiAdapter` (Meta WhatsApp Business)
    - [ ] Feature-flag `WA_PROVIDER=baileys|cloud`
    - [ ] Deploy final: Web di Vercel, Bot di Fly.io/Railway + supervisor QR re-auth
    - [ ] Rekam demo 60 detik: grup WA → web live 2 HP → ringkasan balik ke WA

---

## Catatan Progress

- Mulai dari: Fase 0
- Urutan saran: `0 → 1 → 2 → 3 → 4 → 6 → 5 → 7`
- Update file ini setiap selesai task: `- [ ]` → `- [x]`
- Fase 1 selesai 2026-09-09. Cara verifikasi ulang: `npm test` (unit), `node scripts/db-push.mjs --verify-only` (skema, butuh SUPABASE_DB_URL), jalankan `npm run build && npm start` lalu `node scripts/verify-phase1-api.mjs http://localhost:3000` (E2E).
- Fase 2 selesai 2026-09-09. Cara verifikasi ulang: `npm test` (unit), `npm run build && npm start` lalu `node scripts/verify-phase2.mjs http://localhost:3000` (E2E 5 user tanpa login) dan `node scripts/verify-phase1-api.mjs http://localhost:3000` (regresi). Catatan port: dev/start di mesin ini memakai port acak — cek output `Local:` di log lalu sesuaikan baseURL. `lib/api/types.ts` = DTO bersama UI; `components/sessions/SessionAdminView.tsx` dipakai `/admin/[token]` & `/s/[token]/admin`.
- Fase 3 selesai 2026-09-09. Cara verifikasi ulang: `node --env-file=.env scripts/db-push.mjs --verify-only` (skema + publication `supabase_realtime`), `npm test` (unit), `npm run build && npm start` lalu `node --env-file=.env scripts/verify-phase3.mjs http://localhost:3000` (E2E Realtime: websocket anon, claim/unclaim <1s, presence join, isolasi sesi, update saat finalize).
