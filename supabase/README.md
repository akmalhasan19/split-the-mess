# Split The Mess — Phase 0 notes

## Cara jalan lokal

1. Copy `.env.example` → `.env.local`, isi kredensial Supabase (Task 0.2).
2. `npm install`
3. `npm run dev` → buka http://localhost:3000
4. Cek `/api/health` (harus `{ ok: true }`).

## Verifikasi Supabase (butuh .env.local valid)

- `GET /api/supabase-check` → `configured: true`, `reachable: true`.
- `GET /api/storage-check` → memastikan bucket `receipts` ada + roundtrip
  write/read/delete sukses.

## Deploy preview (Task 0.3)

- Import repo ke Vercel → framework Next.js → env yang sama seperti .env.local.
- Cek di in-app browser WhatsApp (Android/iOS): layout max-w-md, tombol ≥44px.
