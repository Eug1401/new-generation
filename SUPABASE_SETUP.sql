
-- New Generation · setup Supabase semplice
-- Esegui questo script in Supabase > SQL Editor.

create table if not exists public.app_state (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "public can read tournament" on public.app_state;
drop policy if exists "authenticated admin can insert tournament" on public.app_state;
drop policy if exists "authenticated admin can update tournament" on public.app_state;
drop policy if exists "authenticated admin can delete tournament" on public.app_state;

-- Tutti possono leggere la riga pubblica del torneo.
create policy "public can read tournament"
on public.app_state
for select
to anon, authenticated
using (id = 'main');

-- Solo utenti autenticati Supabase possono creare/aggiornare/eliminare i dati.
create policy "authenticated admin can insert tournament"
on public.app_state
for insert
to authenticated
with check (id = 'main');

create policy "authenticated admin can update tournament"
on public.app_state
for update
to authenticated
using (id = 'main')
with check (id = 'main');

create policy "authenticated admin can delete tournament"
on public.app_state
for delete
to authenticated
using (id = 'main');

insert into public.app_state (id, data)
values ('main', '{"rules":{"name":"New Generation"},"teams":[],"matches":[]}'::jsonb)
on conflict (id) do nothing;

-- Realtime: abilita gli aggiornamenti live lato pubblico.
alter table public.app_state replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;
end $$;


-- ============================================================
-- Legacy: bucket Supabase Storage "team-photos"
-- ============================================================
-- Le versioni precedenti potevano usare un bucket Storage pubblico. Dalla
-- v126.16 il flusso Foto usa esclusivamente la Edge Function team-photos,
-- Cloudinary e public.team_photos. Questo setup non crea né rende pubblico
-- alcun bucket e non modifica eventuali file legacy già presenti.
-- Dopo aver verificato che non servano più, bucket e policy legacy possono
-- essere rimossi manualmente dal progetto Supabase.

-- ============================================================
-- v126.16: metadati dedicati alla galleria Foto Cloudinary
-- ============================================================
-- Questa tabella NON contiene e NON referenzia le immagini degli articoli.
-- Viene letta/scritta esclusivamente dalla Edge Function team-photos tramite
-- SUPABASE_SERVICE_ROLE_KEY; il frontend non accede direttamente alla tabella.
create extension if not exists pgcrypto;

create table if not exists public.team_photos (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  team_id text not null,
  original_url text not null,
  download_url text not null,
  thumb_url text not null,
  medium_url text not null,
  large_url text not null,
  version bigint not null default 0,
  format text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes bigint not null check (bytes > 0),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  original_name text not null,
  title text not null default '',
  description text not null default '',
  caption text not null default '',
  alt_text text not null default '',
  album text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_photos_gallery_scope check (public_id like 'squadra/%')
);

create index if not exists team_photos_team_order_idx
  on public.team_photos (team_id, display_order, created_at desc);

alter table public.team_photos enable row level security;
-- Nessuna policy diretta: la service role della Edge Function bypassa RLS.
-- La lettura pubblica passa dalla funzione, che restituisce solo il perimetro squadra/.
