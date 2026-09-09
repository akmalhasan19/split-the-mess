-- ============================================================
-- Split The Mess — Phase 1: Core schema (Task 1.2)
-- Tabel: sessions, items, participants, selections, settlements
--
-- Idempotent: aman dijalankan berulang (IF NOT EXISTS / DROP POLICY dulu).
-- RLS: aktif di semua tabel. Default-deny; policy eksplisit di bawah.
--   - Baca: sesi masih hidup (belum lewat expiry 7 hari).
--   - Tulis (items/participants/selections): sesi masih hidup + status draft.
--   - sessions/settlements ditulis via service role (API routes), jadi
--     policy anon hanya untuk read.
-- ============================================================

-- Tipe status sesi (draft → finalized; cancelled cadangan).
do $$ begin
  create type public.session_status as enum ('draft', 'finalized', 'cancelled');
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- sessions: 1 sesi = 1 struk.
-- ------------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  -- token unik nanoid 8 char untuk link /s/[token] (Task 1.3).
  token text not null unique,
  receipt_image_url text,
  -- Semua nominal rupiah integer (bilangan bulat).
  subtotal integer not null default 0 check (subtotal >= 0),
  tax integer not null default 0 check (tax >= 0),
  service_charge integer not null default 0 check (service_charge >= 0),
  discount integer not null default 0 check (discount >= 0),
  payer_bca text,
  payer_qris_url text,
  status public.session_status not null default 'draft',
  -- Simpan JSON mentah OCR (dipakai Fase 5, diisi null untuk input manual).
  raw_ocr_json jsonb,
  created_at timestamptz not null default now(),
  -- Expiry 7 hari (logika awal, Task 2.4 / 7.2 menegaskan validasinya).
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- ------------------------------------------------------------
-- items: item struk. price = total baris (harga satuan × qty).
-- ------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  price integer not null check (price >= 0),
  qty integer not null default 1 check (qty >= 1),
  created_at timestamptz not null default now()
);
create index if not exists items_session_id_idx on public.items (session_id);

-- ------------------------------------------------------------
-- participants: peserta sesi (tanpa login — Task 2.4).
-- ------------------------------------------------------------
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  created_at timestamptz not null default now(),
  -- Satu nama sekali per sesi (Fase 3: upsert onConflict).
  unique (session_id, display_name)
);
create index if not exists participants_session_id_idx
  on public.participants (session_id);

-- ------------------------------------------------------------
-- selections: many-to-many item ↔ peserta (centang siapa makan apa).
-- ------------------------------------------------------------
create table if not exists public.selections (
  item_id uuid not null references public.items (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, participant_id)
);
create index if not exists selections_participant_id_idx
  on public.selections (participant_id);

-- ------------------------------------------------------------
-- settlements: hasil kalkulasi final per peserta (Task 1.3 finalize).
-- ------------------------------------------------------------
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  amount_subtotal integer not null default 0,
  amount_tax integer not null default 0,
  amount_service integer not null default 0,
  -- Selalu positif; dikurangkan dari amount_final.
  amount_discount integer not null default 0 check (amount_discount >= 0),
  amount_final integer not null default 0,
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  -- Satu baris hasil per peserta per sesi (re-finalize menimpa).
  unique (session_id, participant_id)
);
create index if not exists settlements_session_id_idx
  on public.settlements (session_id);

-- ============================================================
-- HELPER & RLS
-- ============================================================

-- Sesi masih hidup = belum lewat expires_at.
create or replace function public.session_is_live(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.expires_at > now()
  );
$$;

alter table public.sessions enable row level security;
alter table public.items enable row level security;
alter table public.participants enable row level security;
alter table public.selections enable row level security;
alter table public.settlements enable row level security;

-- sessions: anon boleh baca sesi yang masih hidup.
drop policy if exists sessions_read_live on public.sessions;
create policy sessions_read_live on public.sessions
  for select to anon
  using (expires_at > now());

-- items: baca bila sesi hidup; tulis (insert/update/delete) bila sesi draft.
drop policy if exists items_read_live on public.items;
create policy items_read_live on public.items
  for select to anon
  using (public.session_is_live(session_id));

drop policy if exists items_write_draft on public.items;
create policy items_write_draft on public.items
  for all to anon
  using (
    public.session_is_live(session_id)
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.status = 'draft'
    )
  )
  with check (
    public.session_is_live(session_id)
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.status = 'draft'
    )
  );

-- participants: sama seperti items.
drop policy if exists participants_read_live on public.participants;
create policy participants_read_live on public.participants
  for select to anon
  using (public.session_is_live(session_id));

drop policy if exists participants_write_draft on public.participants;
create policy participants_write_draft on public.participants
  for all to anon
  using (
    public.session_is_live(session_id)
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.status = 'draft'
    )
  )
  with check (
    public.session_is_live(session_id)
    and exists (
      select 1 from public.sessions s
      where s.id = session_id and s.status = 'draft'
    )
  );

-- selections: keamanan diturunkan dari item & peserta terkait.
drop policy if exists selections_read_live on public.selections;
create policy selections_read_live on public.selections
  for select to anon
  using (
    exists (
      select 1
      from public.items i
      join public.participants p on p.id = selections.participant_id
      where i.id = selections.item_id
        and public.session_is_live(i.session_id)
        and p.session_id = i.session_id
    )
  );

drop policy if exists selections_write_draft on public.selections;
create policy selections_write_draft on public.selections
  for all to anon
  using (
    exists (
      select 1
      from public.items i
      join public.participants p on p.id = selections.participant_id
      join public.sessions s on s.id = i.session_id
      where i.id = selections.item_id
        and p.session_id = i.session_id
        and s.status = 'draft'
        and s.expires_at > now()
    )
  )
  with check (
    exists (
      select 1
      from public.items i
      join public.participants p on p.id = selections.participant_id
      join public.sessions s on s.id = i.session_id
      where i.id = selections.item_id
        and p.session_id = i.session_id
        and s.status = 'draft'
        and s.expires_at > now()
    )
  );

-- settlements: read-only untuk anon (ditulis service role saat finalize).
drop policy if exists settlements_read_live on public.settlements;
create policy settlements_read_live on public.settlements
  for select to anon
  using (public.session_is_live(session_id));

-- ------------------------------------------------------------
-- Realtime (dipakai Fase 3, aktifkan sekarang agar tidak lupa).
-- ------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.selections;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.participants;
exception when duplicate_object then null;
end $$;
