-- ============================================================
-- Split The Mess — Phase 3: Realtime publication (Task 3.1)
--
-- Memastikan tabel peserta-view masuk publication supabase_realtime:
--   - selections    : INSERT/DELETE (claim/unclaim live)
--   - participants  : INSERT     (peserta baru gabung live)
--   - sessions      : UPDATE     (status draft → finalized live)
--
-- Idempotent (duplicate_object diabaikan). Aman dijalankan berulang via
-- scripts/db-push.mjs (butuh SUPABASE_DB_URL).
--
-- Catatan RLS realtime: postgres_changes menghormati RLS — anon hanya
-- menerima baris yang boleh dibaca (policy Fase 1: sesi masih hidup).
-- Catatan DELETE selections: payload `old` cukup berisi PK
-- (item_id, participant_id) — tidak perlu REPLICA IDENTITY FULL.
-- ============================================================

do $$ begin
  alter publication supabase_realtime add table public.selections;
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.participants;
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.sessions;
exception
  when duplicate_object then null;
end $$;
