
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
-- v90: bucket Storage per le foto squadre
-- ============================================================
-- Esegui questo blocco UNA VOLTA, dopo aver applicato il resto dello script.
-- Crea un bucket pubblico chiamato 'team-photos' dove ogni file ha:
--   - path: team-photos/<teamId>/<timestamp>_<filename>
--   - public read (chiunque può scaricare/visualizzare)
--   - write solo da utenti autenticati (admin)

-- Crea il bucket (se non esiste già)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-photos',
  'team-photos',
  true,                                  -- public read
  10485760,                              -- 10 MB per file (limite per evitare bombe nel free tier 1GB totale)
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- Policy: chiunque può leggere (download / visualizzazione foto)
drop policy if exists "team-photos public read" on storage.objects;
create policy "team-photos public read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'team-photos');

-- Policy: solo admin autenticati possono caricare
drop policy if exists "team-photos admin upload" on storage.objects;
create policy "team-photos admin upload"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'team-photos');

-- Policy: solo admin autenticati possono cancellare
drop policy if exists "team-photos admin delete" on storage.objects;
create policy "team-photos admin delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'team-photos');
