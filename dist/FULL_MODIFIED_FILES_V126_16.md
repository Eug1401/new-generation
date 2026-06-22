# Codice completo dei file sorgente modificati — v126.16

Radice progetto: `/mnt/data/ng-work/new-generation-main`

I file sotto sono riportati integralmente. `dist/` è generato automaticamente dal build e non viene duplicato in questa appendice.

## `/mnt/data/ng-work/new-generation-main/CLOUDINARY_SUPABASE_SETUP.md`

````markdown
# Setup galleria Foto: Cloudinary + Supabase Edge Function (v126.16)

La galleria Foto è un flusso autonomo rispetto alle immagini degli articoli:

```text
frontend Foto → team-photos → Cloudinary cartella squadra/<teamId>
                           ↘ tabella public.team_photos
```

Gli articoli, i relativi URL immagine e il loro caricamento non vengono usati né modificati.

## 1. Database

Esegui `SUPABASE_SETUP.sql` nel SQL Editor. La sezione v126.16 crea `public.team_photos`, che conserva `public_id`, URL originale, URL delle preview, formato, dimensioni, byte, MIME type, nome originale, titolo, descrizione, didascalia, alt, album, ordine e date.

Il browser non accede direttamente alla tabella. La Edge Function usa la service role; RLS resta attivo senza policy pubbliche.

## 2. Secrets della Edge Function

Configura in Supabase:

```env
CLOUDINARY_CLOUD_NAME=dc17izhac
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>
CLOUDINARY_TEAM_FOLDER=squadra
CLOUDINARY_SECTION_TAG=foto-squadra
SUPABASE_URL=<url-progetto>
SUPABASE_ANON_KEY=<anon-o-legacy-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PHOTO_ALLOWED_ORIGINS=https://dominio-produzione.example,https://dominio-preview.example
```

Per sviluppo aggiungi esplicitamente l'origine locale usata, per esempio `http://localhost:4173`. Non inserire mai `CLOUDINARY_API_SECRET` o `SUPABASE_SERVICE_ROLE_KEY` nel frontend.

## 3. Autenticazione e CORS

`supabase/functions/team-photos/config.toml` usa `verify_jwt = false` per permettere alla preflight `OPTIONS` e alle letture pubbliche di raggiungere la funzione. La funzione valida manualmente il vero access token Supabase per `POST`, `PUT`, `PATCH` e `DELETE`.

Il frontend non usa più la chiave pubblicabile come token utente. Per le operazioni amministrative legge `session.access_token`; per il `FormData` non imposta manualmente `Content-Type`, così il browser genera il boundary corretto.

## 4. Deploy

```bash
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy team-photos
```

Verifica che il dominio pubblicato utilizzi HTTPS e che `assets/js/supabase-config.js` punti allo stesso progetto Supabase, senza URL `localhost` in produzione.

## 5. Endpoint

```text
GET    /team-photos                         lista galleria
GET    /team-photos?action=detail&photoId=  dettaglio
GET    /team-photos?action=download&photoId= download originale
POST   /team-photos                         upload file/files multipart (admin)
POST   /team-photos?action=zip              ZIP originali selezionati
PATCH  /team-photos                         modifica metadati (admin)
PUT    /team-photos                         sostituzione sicura (admin)
DELETE /team-photos                         eliminazione verificata (admin)
OPTIONS /team-photos                        preflight senza autenticazione
```

## 6. Limiti e formati

- JPEG, PNG, WebP;
- 10 MB per file;
- 20 file e 80 MB per batch;
- validazione di MIME, estensione, firma binaria e decodifica lato client;
- validazione di MIME, estensione e firma binaria lato funzione;
- upload multiplo parzialmente completabile: ogni file ha esito autonomo e le sole foto fallite possono essere riprovate.

## 7. Originali, preview e ZIP

Cloudinary conserva l'originale senza trasformazioni distruttive. La galleria usa derivate `thumb`, `medium` e `large`; download singolo e ZIP passano dalla Edge Function e contengono esclusivamente originali appartenenti alla galleria Foto. Lo ZIP non viene più costruito nel browser e non può includere immagini degli articoli.

## 8. Diagnostica

La funzione registra metodo, azione, status, codice errore e durata senza token o segreti. Il frontend distingue autenticazione, rete/CORS, mixed content, timeout, validazione, Cloudinary, database e ZIP incompleto.
````

## `/mnt/data/ng-work/new-generation-main/SUPABASE_SETUP.sql`

````sql

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
````

## `/mnt/data/ng-work/new-generation-main/admin-articles.html`

````html
<!doctype html>
<html lang="it" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#070b12">
  <meta name="color-scheme" content="dark">
  <link rel="preconnect" href="https://mcksxqtgibkazxnkdfra.supabase.co" crossorigin>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="dns-prefetch" href="https://mcksxqtgibkazxnkdfra.supabase.co">
  <link rel="dns-prefetch" href="https://cdn.jsdelivr.net">
  <title>New Generation · Articoli</title>
  <link rel="stylesheet" href="assets/css/styles.css?v=v126-15-hotfix">
</head>
<body>
  <a class="skip-link" href="#main-content">Vai al contenuto principale</a>
  <div class="shell">
    <header class="site-header">
      <div class="brand"><div data-brand-logo><div class="logo"><span></span></div></div><div><h1 data-brand-title>New Generation · Articoli</h1><p data-brand-subtitle>Crea e gestisci le news pubbliche del torneo.</p></div></div>
      <div class="actions"><button class="btn primary" id="simulateTournamentBtn" type="button">Simula</button><button class="btn danger" id="resetAllBtn" type="button">Reset</button></div>
    </header>
    <nav class="admin-nav" aria-label="Navigazione amministrazione">
      <a href="admin.html">Dashboard</a><a href="admin-rules.html">Regole &amp; calendario</a><a href="admin-groups.html">Gironi</a><a href="admin-teams.html">Squadre</a><a href="admin-players.html">Giocatori</a><a href="admin-matches.html">Partite &amp; referti</a><a href="admin-articles.html" class="active">Articoli</a><a href="admin-photos.html">Foto</a><a href="admin-reports.html">Report &amp; PDF</a>
    </nav>
    <main id="main-content" tabindex="-1">
      <section class="article-admin-layout">
        <article class="card pad article-editor-card" aria-labelledby="articleFormTitle">
          <div class="section-title article-editor-heading">
            <div><span class="article-kicker">Redazione</span><h2 id="articleFormTitle">Nuovo articolo</h2><p id="articleFormHint">Compila i campi principali, controlla l’anteprima e scegli se pubblicare o salvare come bozza.</p></div>
            <span class="pill"><strong id="articleCount">0</strong>&nbsp;articoli</span>
          </div>
          <form id="articleForm" class="article-editor-form" novalidate>
            <input type="hidden" id="articleId">
            <section class="article-form-section" aria-labelledby="articleMainFieldsTitle">
              <div class="article-form-section-head"><span>1</span><div><h3 id="articleMainFieldsTitle">Informazioni principali</h3><p>Titolo, sottotitolo e riepilogo visibile nelle card.</p></div></div>
              <div class="form-grid">
                <div class="field-full"><label for="articleTitle">Titolo <span aria-hidden="true">*</span></label><input id="articleTitle" maxlength="160" autocomplete="off" placeholder="Es. Pubblicato il calendario ufficiale" required><small><span id="articleTitleCount">0</span>/160 caratteri</small></div>
                <div class="field-full"><label for="articleSubtitle">Sottotitolo</label><input id="articleSubtitle" maxlength="240" autocomplete="off" placeholder="Una frase che completa il titolo"><small><span id="articleSubtitleCount">0</span>/240 caratteri</small></div>
                <div class="field-full"><label for="articleExcerpt">Estratto</label><textarea id="articleExcerpt" rows="3" maxlength="420" placeholder="Breve anteprima per la lista; se vuoto verrà ricavato dal contenuto."></textarea><small><span id="articleExcerptCount">0</span>/420 caratteri</small></div>
                <div><label for="articleAuthor">Autore</label><input id="articleAuthor" maxlength="100" value="Redazione New Generation" autocomplete="name"></div>
                <div><label for="articleCategory">Categoria</label><input id="articleCategory" maxlength="80" value="Aggiornamenti" list="articleCategorySuggestions" autocomplete="off"><datalist id="articleCategorySuggestions"></datalist></div>
                <div class="field-full"><label for="articleTags">Tag</label><input id="articleTags" maxlength="260" placeholder="torneo, calendario, risultati"><small>Separali con una virgola. Massimo 12 tag.</small></div>
              </div>
            </section>

            <section class="article-form-section" aria-labelledby="articleContentTitle">
              <div class="article-form-section-head"><span>2</span><div><h3 id="articleContentTitle">Contenuto</h3><p>Formattazione essenziale e sicura, riprodotta allo stesso modo sul sito pubblico.</p></div></div>
              <div class="article-editor-toolbar" role="toolbar" aria-label="Formattazione articolo">
                <button class="btn small" type="button" data-article-format="heading">Titolo paragrafo</button>
                <button class="btn small" type="button" data-article-format="bold"><strong>Grassetto</strong></button>
                <button class="btn small" type="button" data-article-format="italic"><em>Corsivo</em></button>
                <button class="btn small" type="button" data-article-format="list">Elenco</button>
                <button class="btn small" type="button" data-article-format="quote">Citazione</button>
                <button class="btn small" type="button" data-article-format="link">Collegamento</button>
              </div>
              <label for="articleBody">Testo completo <span aria-hidden="true">*</span></label>
              <textarea id="articleBody" rows="16" maxlength="40000" spellcheck="true" placeholder="Scrivi il comunicato, la news o il racconto della giornata…" required></textarea>
              <div class="article-editor-help"><span><span id="articleBodyCount">0</span>/40.000 caratteri</span><span>Supportati: titoli con ##, elenchi con -, citazioni con &gt;, **grassetto**, *corsivo* e [testo](https://…).</span></div>
            </section>

            <section class="article-form-section" aria-labelledby="articleImageTitle">
              <div class="article-form-section-head"><span>3</span><div><h3 id="articleImageTitle">Immagine principale</h3><p>JPG, PNG o WebP; massimo 12 MB. L’immagine viene ottimizzata prima del salvataggio.</p></div></div>
              <div class="article-image-editor">
                <div id="articleImagePreview" class="image-preview article-image-preview"><div class="article-image article-placeholder small"><span>NG</span><small>NEWS</small></div><span class="muted">Nessuna immagine selezionata.</span></div>
                <div class="form-grid">
                  <div class="field-full"><label for="articleImage">Scegli immagine</label><input id="articleImage" type="file" accept="image/jpeg,image/png,image/webp"></div>
                  <div class="field-full"><label for="articleImageAlt">Testo alternativo</label><input id="articleImageAlt" maxlength="220" placeholder="Descrivi ciò che mostra l’immagine"></div>
                  <div class="field-full"><label for="articleImageCaption">Didascalia</label><input id="articleImageCaption" maxlength="280" placeholder="Informazione o credito fotografico"></div>
                  <div class="field-full row-actions"><button class="btn" id="removeArticleImageBtn" type="button">Rimuovi immagine</button></div>
                </div>
              </div>
            </section>

            <section class="article-form-section" aria-labelledby="articlePublishTitle">
              <div class="article-form-section-head"><span>4</span><div><h3 id="articlePublishTitle">Pubblicazione e indirizzo</h3><p>Le bozze non sono visibili al pubblico. Gli articoli programmati appaiono alla data indicata.</p></div></div>
              <div class="form-grid">
                <div><label for="articleStatus">Stato</label><select id="articleStatus"><option value="published">Pubblicato</option><option value="draft">Bozza</option><option value="scheduled">Programmato</option></select></div>
                <div><label for="articlePublishedAt">Data di pubblicazione</label><input id="articlePublishedAt" type="datetime-local"></div>
                <div class="field-full"><label for="articleSlug">Slug</label><div class="article-slug-field"><span aria-hidden="true">#article=</span><input id="articleSlug" maxlength="90" placeholder="calendario-ufficiale"></div><small>Viene generato dal titolo e resta modificabile.</small></div>
              </div>
            </section>

            <details class="article-form-section article-seo-section">
              <summary>SEO e condivisione opzionali</summary>
              <div class="form-grid margin-top">
                <div class="field-full"><label for="articleSeoTitle">Titolo SEO</label><input id="articleSeoTitle" maxlength="70" placeholder="Se vuoto viene usato il titolo dell’articolo"></div>
                <div class="field-full"><label for="articleSeoDescription">Descrizione SEO</label><textarea id="articleSeoDescription" rows="3" maxlength="180" placeholder="Breve descrizione per motori di ricerca e condivisione"></textarea></div>
              </div>
            </details>

            <div id="articleFormErrors" class="article-form-errors" role="alert" aria-live="assertive"></div>
            <div class="article-editor-actions">
              <button class="btn" id="articlePreviewBtn" type="button">Anteprima</button>
              <button class="btn primary" id="articleSubmitBtn" type="submit">Salva articolo</button>
              <button class="btn" id="cancelEditArticleBtn" type="button" hidden>Annulla modifica</button>
            </div>
          </form>
          <div id="articleMsg" class="margin-top" aria-live="polite"></div>
        </article>

        <article class="card pad article-library-card" aria-labelledby="articleLibraryTitle">
          <div class="section-title">
            <div><span class="article-kicker">Archivio</span><h2 id="articleLibraryTitle">Gestione articoli</h2><p>Cerca, filtra, visualizza in anteprima, modifica o elimina gli articoli.</p></div>
          </div>
          <div class="article-admin-toolbar">
            <label class="article-search-field"><span>Cerca</span><input id="adminArticleSearch" type="search" placeholder="Titolo, autore, categoria o testo"></label>
            <label><span>Stato</span><select id="adminArticleStatusFilter"><option value="all">Tutti</option><option value="published">Pubblicati</option><option value="draft">Bozze</option><option value="scheduled">Programmati</option></select></label>
            <label><span>Categoria</span><select id="adminArticleCategoryFilter"><option value="all">Tutte</option></select></label>
          </div>
          <div id="adminArticleSummary" class="article-library-summary" aria-live="polite"></div>
          <div id="adminArticlesList"></div>
        </article>
      </section>
    </main>
  </div>

  <div class="modal article-preview-modal" id="articlePreviewModal" role="dialog" aria-modal="true" aria-labelledby="articlePreviewModalTitle">
    <div class="modal-content article-modal-content">
      <div class="article-modal-toolbar"><div><span class="article-kicker">Anteprima</span><h2 id="articlePreviewModalTitle">Anteprima articolo</h2></div><div class="row-actions"><button class="btn danger" id="deleteArticleFromPreviewBtn" type="button" hidden>Elimina articolo</button><button class="btn article-modal-close" id="closeArticlePreviewModal" type="button">Chiudi</button></div></div>
      <div id="articlePreviewModalBody"></div>
    </div>
  </div>

  <div class="ng-confirm-overlay" id="deleteArticleDialog" role="dialog" aria-modal="true" aria-labelledby="deleteArticleDialogTitle" aria-describedby="deleteArticleDialogText" hidden>
    <div class="ng-confirm-card article-delete-card">
      <span class="article-kicker">Conferma eliminazione</span>
      <h2 id="deleteArticleDialogTitle">Eliminare l’articolo?</h2>
      <p id="deleteArticleDialogText">Questa operazione è irreversibile.</p>
      <div id="deleteArticleDialogMsg" aria-live="assertive"></div>
      <div class="row-actions"><button class="btn" id="cancelDeleteArticleBtn" type="button">Annulla</button><button class="btn danger" id="confirmDeleteArticleBtn" type="button">Elimina articolo</button></div>
    </div>
  </div>

  <script defer src="assets/js/store.js?v=v125-ui-stable"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script defer src="assets/js/supabase-config.js?v=v125-ui-stable"></script>
  <script defer src="assets/js/supabase-sync.js?v=v126-15-sync"></script>
  <script defer src="assets/js/ui.js?v=v126-16-article-detail"></script>
  <script defer src="assets/js/ux-a11y.js?v=v126-16-overlay"></script>
  <script defer src="assets/js/admin-common.js?v=v126-15-common"></script><script defer src="assets/js/admin-simulation.js?v=v126-15-wizard"></script>
  <script defer src="assets/js/admin-articles.js?v=v126-16-article-detail"></script>
</body>
</html>
````

## `/mnt/data/ng-work/new-generation-main/admin-photos.html`

````html
<!doctype html><html lang="it" class="no-js"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#070b12"><meta name="color-scheme" content="dark"><link rel="preconnect" href="https://mcksxqtgibkazxnkdfra.supabase.co" crossorigin><link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin><link rel="preconnect" href="https://res.cloudinary.com" crossorigin><link rel="dns-prefetch" href="https://res.cloudinary.com"><link rel="dns-prefetch" href="https://mcksxqtgibkazxnkdfra.supabase.co"><link rel="dns-prefetch" href="https://cdn.jsdelivr.net"><title>New Generation · Foto squadre</title><link rel="stylesheet" href="assets/css/styles.css?v=v126-16-photo-article"></head><body><a class="skip-link" href="#main-content">Vai al contenuto principale</a><div class="shell"><header class="site-header"><div class="brand"><div data-brand-logo><div class="logo"><span></span></div></div><div><h1 data-brand-title>New Generation · Foto squadre</h1><p data-brand-subtitle>Carica e gestisci le foto di ogni squadra del torneo.</p></div></div><div class="actions"><button class="btn primary" id="simulateTournamentBtn" type="button">Simula</button><button class="btn danger" id="resetAllBtn" type="button">Reset</button></div></header><nav class="admin-nav" aria-label="Navigazione amministrazione"><a href="admin.html" class="">Dashboard</a><a href="admin-rules.html" class="">Regole &amp; calendario</a><a href="admin-groups.html" class="">Gironi</a><a href="admin-teams.html" class="">Squadre</a><a href="admin-players.html" class="">Giocatori</a><a href="admin-matches.html" class="">Partite &amp; referti</a><a href="admin-articles.html" class="">Articoli</a><a href="admin-photos.html" class="active">Foto</a><a href="admin-reports.html" class="">Report &amp; PDF</a></nav><main id="main-content" tabindex="-1">
<div class="grid photos-admin-grid">
  <article class="card pad span-4 photos-sidebar">
    <div class="section-title"><div><h2>Squadre</h2><p>Seleziona una squadra per gestire le sue foto.</p></div></div>
    <div id="photosTeamList"></div>
  </article>
  <article class="card pad span-8 photos-workspace" id="photosWorkspace">
    <div class="section-title"><div><h2 id="photosTitle">Foto squadra</h2><p id="photosSubtitle">Scegli una squadra a sinistra per iniziare.</p></div><span class="pill"><strong id="photosCount">0</strong>&nbsp;foto</span></div>
    <div id="photosUploadArea" hidden>
      <form id="photosUploadForm">
        <div id="photosDropZone" class="photos-dropzone">
          <input id="photosFileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
          <div class="dropzone-content">
            <div class="dropzone-icon">📷</div>
            <div class="dropzone-text"><strong>Trascina qui le foto</strong><small>oppure <button type="button" id="photosDropTrigger" class="link-btn">scegli dal dispositivo</button></small></div>
            <small class="dropzone-hint">Originale conservato · max 10 MB · JPG, PNG o WebP · max 20 file / 80 MB</small>
          </div>
        </div>
        <div id="photosUploadProgress"></div>
      </form>
      <div id="photosMsg"></div>
    </div>
    <div id="photosGrid" class="photos-grid"></div>
  </article>
</div>
</main></div><script defer src="assets/js/store.js?v=v125-ui-stable"></script><script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script defer src="assets/js/supabase-config.js?v=v125-ui-stable"></script><script defer src="assets/js/supabase-sync.js?v=v125-ui-stable"></script><script defer src="assets/js/ui.js?v=v126-16-article-detail"></script><script defer src="assets/js/ux-a11y.js?v=v126-16-overlay"></script><script defer src="assets/js/photos.js?v=v126-16-photo-network"></script><script defer src="assets/js/photo-runtime.js?v=v126-16-viewer"></script><script defer src="assets/js/admin-common.js?v=v126-15-common"></script><script defer src="assets/js/admin-simulation.js?v=v126-15-wizard"></script><script defer src="assets/js/admin-photos.js?v=v126-16-photo-admin"></script></body></html>
````

## `/mnt/data/ng-work/new-generation-main/index.html`

````html
<!doctype html><html lang="it" class="no-js"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#070b12"><meta name="color-scheme" content="dark"><link rel="preconnect" href="https://mcksxqtgibkazxnkdfra.supabase.co" crossorigin><link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin><link rel="preconnect" href="https://res.cloudinary.com" crossorigin><link rel="dns-prefetch" href="https://res.cloudinary.com"><link rel="dns-prefetch" href="https://mcksxqtgibkazxnkdfra.supabase.co"><link rel="dns-prefetch" href="https://cdn.jsdelivr.net"><title>New Generation</title><link rel="stylesheet" href="assets/css/styles.css?v=v126-16-photo-article"></head><body class="public-page"><a class="skip-link" href="#main-content">Vai al contenuto principale</a><div class="shell"><header class="site-header"><div class="brand"><div data-brand-logo><div class="logo"><span></span></div></div><div><h1 data-brand-title>New Generation</h1><p data-brand-subtitle>Risultati, squadre, giocatori e dettagli partite.</p></div></div><div class="actions"><span class="pill pill-live"><span class="pill-live-dot"></span>Aggiornamento automatico</span></div></header><nav class="tabs" aria-label="Sezioni del sito"><button class="tab-btn active" data-tab="home">Panoramica</button><button class="tab-btn" data-tab="teams">Squadre</button><button class="tab-btn" data-tab="players">Giocatori</button><button class="tab-btn" data-tab="matches">Partite</button><button class="tab-btn" data-tab="bracket">Tabellone</button><button class="tab-btn" data-tab="articles">Articoli</button><button class="tab-btn" data-tab="photos">Foto</button><button class="tab-btn" data-tab="search">Ricerca</button></nav><main id="main-content" tabindex="-1"><section id="home" class="tab-panel active"><div class="grid"><article class="card pad span-7"><div class="section-title"><div><h2>Classifica squadre</h2><p>Nei tornei con gironi puoi scegliere il girone dal menu.</p></div></div><div id="publicStandingsMenu"></div><div id="publicStandings" class="table-wrap"></div></article><article class="card pad span-5"><h2>Marcatori</h2><div id="publicPlayersMini" class="table-wrap"></div></article></div></section><section id="teams" class="tab-panel"><article class="card pad"><h2>Squadre e roster</h2><div id="publicTeams" class="team-card-grid"></div></article></section><section id="players" class="tab-panel"><article class="card pad"><div class="section-title"><div><h2>Giocatori</h2><p>Senza filtro vedi la Top 10 marcatori. Se scegli una squadra vedi le statistiche complete di tutti i giocatori.</p></div></div><div class="filters"><div><label>Squadra</label><select id="publicPlayerTeamFilter"></select></div></div><div id="publicPlayers" class="table-wrap"></div></article></section><section id="matches" class="tab-panel"><article class="card pad public-matches-shell"><div class="section-title public-matches-title"><div><h2>Partite</h2><p class="muted">Scegli fase, giornata o squadra con pulsanti grandi: le partite filtrate appaiono subito sotto.</p></div></div><div id="publicMatchFilterBar" class="match-filter-toolbar" aria-label="Filtri partite"></div><div class="filters native-match-filters" aria-hidden="true"><div><label>Fase</label><select id="publicPhaseFilter" tabindex="-1"></select></div><div><label>Giornata / turno</label><select id="publicRoundFilter" tabindex="-1"></select></div><div><label>Squadra</label><select id="publicTeamFilter" tabindex="-1"></select></div></div><div id="publicMatches" class="stack public-match-list"></div></article></section><section id="bracket" class="tab-panel"><article class="card pad"><h2>Tabellone</h2><p class="muted">Per i tornei con eliminazione diretta, qui vedi il tabellone con placeholder e squadre reali appena disponibili.</p><div id="publicBracket"></div></article></section><section id="articles" class="tab-panel"><article class="card pad article-public-section"><div class="section-title"><div><span class="article-kicker">Magazine</span><h2>Articoli</h2><p>News, comunicati e approfondimenti ufficiali del torneo.</p></div><span class="pill"><strong id="publicArticleCount">0</strong>&nbsp;articoli</span></div><div class="article-public-toolbar"><label class="article-search-field"><span>Cerca negli articoli</span><input id="publicArticleSearch" type="search" placeholder="Titolo, autore, categoria o contenuto" autocomplete="off"></label><label><span>Categoria</span><select id="publicArticleCategory"><option value="all">Tutte le categorie</option></select></label><button class="btn" id="clearArticleFilters" type="button">Azzera filtri</button></div><div id="publicArticleStatus" class="article-library-summary" aria-live="polite"></div><div id="publicArticles"></div></article></section><section id="photos" class="tab-panel"><article class="card pad photos-public-card"><div class="section-title"><div><h2>Foto squadre</h2><p>Sfoglia le foto del torneo squadra per squadra. Tocca una foto per ingrandirla, oppure scaricale tutte in un file ZIP.</p></div><button class="btn primary" id="publicPhotosDownloadAllBtn" type="button" hidden>Scarica tutte ZIP</button></div><div id="publicPhotosTeamBar" class="photos-team-bar" hidden></div><select id="publicPhotosTeamFilter" hidden></select><div id="publicPhotosGrid" class="photos-grid"></div></article></section><section id="search" class="tab-panel"><article class="card pad"><h2>Ricerca</h2><input id="globalSearch" type="search" autocomplete="off" aria-label="Cerca nel torneo" placeholder="Cerca squadra, giocatore o partita..."><div id="searchResults" class="stack margin-top"></div></article></section></main></div><div class="modal" id="matchModal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="matchModalTitle"><div class="modal-content public-match-modal-content"><div class="section-title match-modal-toolbar"><div class="match-modal-heading"><h2 id="matchModalTitle">Dettaglio partita</h2></div><button class="btn danger match-modal-close" id="closeModal" type="button" aria-label="Chiudi dettaglio partita">Chiudi</button></div><div id="matchModalBody"></div></div></div><script defer src="assets/js/store.js?v=v125-ui-stable"></script><script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script defer src="assets/js/supabase-config.js?v=v125-ui-stable"></script><script defer src="assets/js/supabase-sync.js?v=v125-ui-stable"></script><script defer src="assets/js/ui.js?v=v126-16-article-detail"></script><script defer src="assets/js/ux-a11y.js?v=v126-16-overlay"></script><script defer src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script><script defer src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js"></script><script defer src="assets/js/photos.js?v=v126-16-photo-network"></script><script defer src="assets/js/photo-runtime.js?v=v126-16-viewer"></script><script defer src="assets/js/public.js?v=v126-16-photo-article"></script></body></html>
````

## `/mnt/data/ng-work/new-generation-main/package.json`

````json
{
  "name": "new-generation-tournament",
  "version": "1.26.16",
  "private": true,
  "description": "Sito statico per la gestione e la pubblicazione di un torneo.",
  "scripts": {
    "lint": "node tools/validate-project.mjs --lint",
    "test": "node tools/validate-project.mjs",
    "build": "node tools/build-static.mjs",
    "test:ui": "node tools/test-ui-stability.mjs",
    "test:articles": "node tools/test-ui-stability.mjs --articles-only",
    "test:simulation": "node tools/test-simulation.mjs",
    "test:photos": "node tools/test-photo-system.mjs",
    "test:edge": "tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck tools/edge-function-test-globals.d.ts supabase/functions/team-photos/index.ts"
  }
}
````

## `/mnt/data/ng-work/new-generation-main/package-lock.json`

````json
{
  "name": "new-generation-tournament",
  "version": "1.26.16",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "new-generation-tournament",
      "version": "1.26.16"
    }
  }
}
````

## `/mnt/data/ng-work/new-generation-main/assets/css/styles.css`

````css
:root{--bg:#070604;--panel:#14110b;--panel2:#0d0b07;--line:rgba(218,172,54,.26);--text:#fff8e7;--muted:#c8b889;--primary:#d7a42d;--blue:#f7dc78;--gold:#d7a42d;--gold-soft:#f7dc78;--gold-deep:#a37c1f;--gold-ink:#1a1408;--danger:#e5535f;--yellow:#ffd76a;--radius:22px;--shadow:0 22px 70px rgba(0,0,0,.4);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0,rgba(215,164,45,.18),transparent 32rem),radial-gradient(circle at 88% 5%,rgba(247,220,120,.10),transparent 34rem),linear-gradient(135deg,#050403 0%,#11100c 46%,#050403 100%);color:var(--text)}.shell{width:min(1450px,calc(100% - 28px));margin:auto;padding:22px 0 60px}header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:16px;border:1px solid var(--line);border-radius:28px;background:rgba(10,15,25,.86);backdrop-filter:blur(18px);box-shadow:var(--shadow);position:relative;z-index:1}.brand{display:flex;gap:14px;align-items:center}.brand h1{margin:0;font-size:clamp(1.4rem,2vw,2rem);letter-spacing:-.04em}.brand p,.muted{color:var(--muted)}.logo{width:56px;height:56px;position:relative;display:grid;place-items:center;filter:drop-shadow(0 0 18px rgba(215,164,45,.35))}.logo:before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,var(--primary),var(--blue));clip-path:polygon(50% 0,92% 20%,100% 60%,70% 100%,30% 100%,0 60%,8% 20%)}.logo:after{content:"";position:absolute;inset:7px;background:#0a1120;clip-path:polygon(50% 5%,85% 22%,92% 58%,68% 91%,32% 91%,8% 58%,15% 22%)}.logo span{z-index:1;width:24px;height:24px;border-radius:50%;border:2px solid white;background:radial-gradient(circle at 35% 28%,#fff,#dff7ff 42%,#f7dc78 43%,#152238 70%)}.actions,.row-actions{display:flex;gap:10px;flex-wrap:wrap}.btn{border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.06);color:var(--text);border-radius:999px;padding:11px 14px;min-height:42px;cursor:pointer;font-weight:800}.btn:hover{transform:translateY(-1px)}.btn.primary{background:linear-gradient(135deg,var(--primary),#f4d878);color:#1a1408;border:0}.btn.danger{background:rgba(255,93,121,.14);color:#ffdbe1;border-color:rgba(255,93,121,.35)}.btn.small{font-size:.86rem;padding:8px 11px;min-height:34px}.tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:20px 0;padding:8px;border:1px solid var(--line);border-radius:26px;background:rgba(255,255,255,.045)}.tab-btn{border:0;background:transparent;color:var(--muted);border-radius:999px;padding:12px;font-weight:900;cursor:pointer}.tab-btn.active{background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408}.tab-panel{display:none}.tab-panel.active{display:block}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.card{border:1px solid var(--line);background:rgba(16,24,39,.88);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}.pad{padding:18px}.span-12{grid-column:span 12}.span-8{grid-column:span 8}.span-7{grid-column:span 7}.span-6{grid-column:span 6}.span-5{grid-column:span 5}.span-4{grid-column:span 4}.section-title{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px}.section-title h2,.section-title h3{margin:0;letter-spacing:-.03em}.section-title p{margin:5px 0 0;color:var(--muted)}label{display:block;margin:0 0 7px;color:#e8dcb2;font-size:.86rem;font-weight:800}input,select,textarea{width:100%;border:1px solid rgba(255,255,255,.13);border-radius:14px;background:rgba(5,8,14,.75);color:var(--text);padding:12px;outline:0;font:inherit}input:focus,select:focus,textarea:focus{border-color:rgba(215,164,45,.7);box-shadow:0 0 0 4px rgba(215,164,45,.1)}.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}.field-full{grid-column:1/-1}.stack{display:grid;gap:11px}.empty{padding:18px;border:1px dashed rgba(255,255,255,.18);border-radius:16px;background:rgba(255,255,255,.035);color:var(--muted);text-align:center}.message{margin-top:12px;padding:12px;border-radius:14px}.message.ok{background:rgba(215,164,45,.12);border:1px solid rgba(215,164,45,.28)}.message.error{background:rgba(255,93,121,.13);border:1px solid rgba(255,93,121,.35)}.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.06);padding:6px 10px;border-radius:999px;font-size:.82rem;font-weight:850}.stat-strip{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.stat{padding:14px;border-radius:18px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1)}.stat strong{font-size:1.45rem;display:block}.stat span{color:var(--muted);font-size:.82rem}.team-logo,.team-logo-fallback{width:54px;height:54px;border-radius:16px;object-fit:contain;display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408;font-weight:950}.team-logo.big,.team-logo-fallback.big{width:82px;height:82px;border-radius:24px;font-size:1.25rem}.team-row,.player-row,.event-row,.match-card{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.045);border-radius:18px;padding:14px}.team-row{display:grid;grid-template-columns:auto 1fr auto;gap:13px;align-items:center}.player-row{display:grid;grid-template-columns:1fr auto;gap:12px}.team-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}.team-card{border:1px solid rgba(255,255,255,.1);border-radius:22px;background:rgba(255,255,255,.045);padding:16px}.player-chip-list{display:flex;flex-wrap:wrap;gap:8px}.player-chip{border:1px solid rgba(215,164,45,.2);background:rgba(215,164,45,.1);color:#fff8e7;padding:7px 9px;border-radius:999px;font-size:.83rem}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:680px}th,td{padding:12px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;white-space:nowrap}th{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;background:rgba(255,255,255,.035)}.rank{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408;font-weight:950}.match-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.score-badge{display:inline-flex;justify-content:center;min-width:78px;border-radius:999px;padding:8px 13px;background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408;font-weight:950}.event-lines p{margin:7px 0;color:#e8dcb2}.event-forms-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.goal-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.summary-grid span{display:grid;gap:3px;padding:12px;border-radius:16px;background:rgba(255,255,255,.05)}.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px}.clickable{cursor:pointer}.clickable:hover{border-color:rgba(215,164,45,.4)}.modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;padding:18px;z-index:99}.modal.open{display:flex}.modal-content{width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:24px;padding:18px;box-shadow:var(--shadow)}.mobile-only-note{display:none}.margin-top{margin-top:12px}@media(max-width:980px){.span-4,.span-5,.span-6,.span-7,.span-8{grid-column:span 12}.stat-strip{grid-template-columns:repeat(3,1fr)}header{position:static}}@media(max-width:720px){.shell{width:min(100% - 16px,1450px);padding-top:8px}header{flex-direction:column;align-items:stretch}.brand{align-items:flex-start}.actions .btn{flex:1}.form-grid,.event-forms-grid,.goal-row,.team-row,.player-row{grid-template-columns:1fr}.section-title{display:block}.stat-strip{grid-template-columns:repeat(2,1fr)}.tabs{grid-template-columns:1fr;border-radius:20px}.btn{width:100%}.row-actions{display:grid;grid-template-columns:1fr 1fr}.match-top{display:grid}.mobile-only-note{display:block}.team-logo.big,.team-logo-fallback.big{width:64px;height:64px}.card{border-radius:18px}.pad{padding:14px}body{font-size:15px}}

/* === New Generation v19 multi-page admin === */
.admin-nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0;padding:8px;border:1px solid var(--line);border-radius:24px;background:rgba(255,255,255,.04)}
.admin-nav a{display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;text-decoration:none;color:var(--muted);font-weight:850;border-radius:18px;padding:12px 10px;border:1px solid transparent;background:transparent}
.admin-nav a.active,.admin-nav a:hover{color:#1a1408;background:linear-gradient(135deg,var(--primary),var(--blue));border-color:transparent}
.page-hero{display:grid;grid-template-columns:1.5fr .8fr;gap:18px;align-items:center;margin:18px 0}
.quick-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
.quick-card{display:block;text-decoration:none;color:var(--text);padding:18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.05);transition:.18s ease}
.quick-card:hover{transform:translateY(-2px);border-color:rgba(215,164,45,.45)}
.quick-card strong{display:block;font-size:1.1rem;margin-bottom:6px}.quick-card span{color:var(--muted)}
.help-box{border:1px dashed rgba(215,164,45,.35);background:rgba(215,164,45,.06);padding:14px;border-radius:18px;color:#fff8e7}
.split-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.split-actions .btn{width:auto}.danger-zone{border-color:rgba(255,82,113,.28);background:rgba(255,82,113,.07)}
.print-page .site-header,.print-page .admin-nav,.print-page .actions,.print-page .no-print{display:none!important}.print-report{max-width:1100px;margin:0 auto;padding:26px}.print-cover{border:1px solid var(--line);border-radius:28px;padding:24px;background:linear-gradient(135deg,rgba(215,164,45,.16),rgba(247,220,120,.12)),rgba(15,22,34,.92);margin-bottom:18px}.print-cover h1{font-size:2.1rem;margin:0 0 8px}.print-section{break-inside:avoid;margin:16px 0}.print-table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:18px;border:1px solid var(--line);background:rgba(255,255,255,.04)}.print-table th,.print-table td{white-space:normal}.print-match{break-inside:avoid;margin:10px 0}
@media(max-width:820px){.page-hero{grid-template-columns:1fr}.admin-nav{grid-template-columns:1fr 1fr}.split-actions .btn{width:100%}}
@media(max-width:520px){.admin-nav{grid-template-columns:1fr}.quick-grid{grid-template-columns:1fr}}
@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{background:#080b12!important;color:#f6f8ff!important}.shell{width:100%;padding:0}.site-header,.admin-nav,.tabs,.no-print,.actions button,.actions a{display:none!important}.card,.match-card,.team-card,.stat{box-shadow:none!important;break-inside:avoid}.print-report{padding:0}.print-cover,.card,.match-card{border-color:rgba(255,255,255,.18)!important}table{min-width:0!important;font-size:10pt}th,td{padding:8px!important}.stat-strip{grid-template-columns:repeat(3,1fr)!important}.btn{display:none!important}}

/* === Nexora v8 essential PDF reports === */
.print-page body,.print-page{background:#080b12!important;color:var(--text)}
.pdf-hero{border:1px solid rgba(255,255,255,.16);border-radius:28px;padding:22px;margin-bottom:16px;background:linear-gradient(135deg,rgba(215,164,45,.16),rgba(247,220,120,.14)),rgba(13,20,33,.96);box-shadow:0 18px 50px rgba(0,0,0,.28)}
.pdf-brand-row{display:flex;align-items:center;justify-content:space-between;gap:18px}.pdf-brand-row h1{margin:0;font-size:1.9rem;letter-spacing:-.04em}.pdf-brand-row p{margin:5px 0 0;color:var(--muted)}.pdf-meta{text-align:right;display:grid;gap:4px}.pdf-meta span{font-weight:950}.pdf-meta small{color:var(--muted)}
.pdf-info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.pdf-info-grid span{display:grid;gap:4px;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:12px;background:rgba(255,255,255,.055);font-size:.92rem}.pdf-info-grid strong{color:#fff8e7;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}
.pdf-card{border:1px solid rgba(255,255,255,.14);border-radius:24px;padding:18px;background:rgba(16,24,39,.92);box-shadow:0 16px 45px rgba(0,0,0,.22);break-inside:avoid}.pdf-section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px}.pdf-section-title h2{margin:0;letter-spacing:-.03em}.pdf-section-title p{margin:0;color:var(--muted)}
.pdf-table{width:100%;min-width:0;border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:18px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035)}.pdf-table th,.pdf-table td{white-space:normal;border-bottom:1px solid rgba(255,255,255,.08);padding:9px 10px}.pdf-table th{font-size:.68rem;color:#c8b889;text-transform:uppercase;letter-spacing:.08em;background:rgba(255,255,255,.055)}.pdf-table tr:last-child td{border-bottom:0}.pdf-table.compact{font-size:.88rem}.pdf-table.compact td{line-height:1.25}.standings-report-table th:nth-child(1),.standings-report-table td:nth-child(1){width:44px;text-align:center}.standings-report-table th:nth-child(n+3),.standings-report-table td:nth-child(n+3){text-align:center;width:58px}.calendar-report-table th:nth-child(1),.calendar-report-table td:nth-child(1){width:150px}.calendar-report-table th:nth-child(3),.calendar-report-table td:nth-child(3){width:140px}.calendar-report-table th:nth-child(4),.calendar-report-table td:nth-child(4){width:150px}.calendar-report-table th:nth-child(5),.calendar-report-table td:nth-child(5){width:105px;text-align:center}
.pdf-rank{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408;font-weight:950}.pdf-pill{display:inline-flex;border:1px solid rgba(215,164,45,.24);background:rgba(215,164,45,.1);color:#fff8e7;border-radius:999px;padding:4px 8px;font-size:.76rem;font-weight:850}.pdf-status{display:inline-flex;justify-content:center;min-width:82px;border-radius:999px;padding:6px 9px;font-weight:900}.pdf-status.done{background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408}.pdf-status.todo{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#dce7f7}
@media print{.pdf-hero,.pdf-card{box-shadow:none!important}.pdf-hero{padding:18px!important;margin-bottom:12px!important}.pdf-brand-row h1{font-size:20pt!important}.pdf-info-grid{grid-template-columns:repeat(4,1fr)!important}.pdf-info-grid span{padding:8px!important}.pdf-card{padding:12px!important;border-radius:18px!important}.pdf-section-title{margin-bottom:8px!important}.pdf-section-title h2{font-size:15pt!important}.pdf-section-title p{font-size:9pt!important}.pdf-table{font-size:8.8pt!important}.pdf-table th,.pdf-table td{padding:6px 7px!important}.calendar-report-table th:nth-child(1),.calendar-report-table td:nth-child(1){width:120px}.calendar-report-table th:nth-child(3),.calendar-report-table td:nth-child(3){width:105px}.calendar-report-table th:nth-child(4),.calendar-report-table td:nth-child(4){width:120px}.calendar-report-table th:nth-child(5),.calendar-report-table td:nth-child(5){width:88px}.logo{width:44px!important;height:44px!important}.logo span{width:19px!important;height:19px!important}}
@media(max-width:720px){.pdf-brand-row{display:grid}.pdf-meta{text-align:left}.pdf-info-grid{grid-template-columns:1fr 1fr}.pdf-section-title{display:block}.pdf-table{font-size:.78rem}}


/* Referto partita: salvataggio unico marcatori/cartellini */
.report-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
.event-report-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.event-panel{border:1px solid rgba(255,255,255,.1);border-radius:20px;background:rgba(255,255,255,.04);padding:16px}
.section-title.compact{margin-bottom:12px;align-items:flex-start}
.section-title.compact h3{margin:0}.section-title.compact p{margin:4px 0 0;color:var(--muted)}
.event-draft-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(0,0,0,.16)}
.card-draft-row{grid-template-columns:1fr 150px auto}
.sticky-save-panel{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;padding:14px;border:1px solid rgba(215,164,45,.2);border-radius:18px;background:rgba(215,164,45,.08)}
@media (max-width:860px){.event-report-grid{grid-template-columns:1fr}.event-draft-row,.card-draft-row{grid-template-columns:1fr}.sticky-save-panel .btn{width:100%}}

/* v12 - Referto più user friendly: aggiunta evento singolo + contatori live */
.quick-add-bar{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:rgba(255,255,255,.045)}
.quick-add-bar.card-add-bar{grid-template-columns:1fr 150px auto}
.live-counters{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
.counter-card{padding:13px;border-radius:18px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.03));min-width:0}
.counter-card span,.counter-card small{display:block;color:var(--muted);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.counter-card strong{display:block;font-size:1.6rem;line-height:1.1;color:var(--text);margin:4px 0}
.event-item{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(0,0,0,.18)}
.event-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:12px;background:rgba(255,255,255,.075)}
@media (max-width:980px){.live-counters{grid-template-columns:repeat(2,1fr)}.quick-add-bar,.quick-add-bar.card-add-bar{grid-template-columns:1fr}.quick-add-bar .btn{width:100%}.event-item{grid-template-columns:auto 1fr}.event-item .btn,.event-item .pill{grid-column:2}}
@media (max-width:520px){.live-counters{grid-template-columns:1fr}.event-item{grid-template-columns:1fr}.event-icon{display:none}.event-item .btn,.event-item .pill{grid-column:auto;width:100%;justify-content:center}}

/* Bracket / tabellone */
.bracket-wrapper{display:grid;gap:18px}.bracket-block{border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:16px;background:rgba(255,255,255,.035)}.bracket-scroll{overflow-x:auto;padding-bottom:8px}.bracket-grid{display:flex;gap:18px;align-items:stretch;min-width:max-content}.bracket-round{min-width:230px;display:flex;flex-direction:column;gap:12px}.bracket-round h4{margin:0;color:#fff8e7;letter-spacing:-.02em}.bracket-matches{display:grid;gap:14px;align-content:space-around;height:100%}.bracket-match{position:relative;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:12px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.035));box-shadow:0 10px 28px rgba(0,0,0,.18)}.bracket-match:after{content:"";position:absolute;right:-18px;top:50%;width:18px;height:1px;background:rgba(215,164,45,.32)}.bracket-round:last-child .bracket-match:after{display:none}.bracket-meta{display:inline-flex;margin-bottom:8px;font-size:.72rem;color:var(--muted)}.bracket-team{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px;border:1px solid rgba(255,255,255,.08);background:rgba(5,8,14,.46)}.bracket-team:first-of-type{border-radius:12px 12px 0 0}.bracket-team:nth-of-type(2){border-radius:0 0 12px 12px}.bracket-team span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bracket-team strong{font-variant-numeric:tabular-nums}.bracket-team.winner{background:linear-gradient(135deg,rgba(215,164,45,.22),rgba(247,220,120,.14));border-color:rgba(215,164,45,.38);color:#fff8e7}.bracket-match small{display:block;margin-top:8px;color:var(--muted)}.bracket-wrapper.compact .bracket-round{min-width:190px}.pdf-round-title{margin:12px 0 8px;font-size:1rem}.bracket-report-table th:nth-child(1),.bracket-report-table td:nth-child(1){width:35px;text-align:center}.bracket-report-table th:nth-child(4),.bracket-report-table td:nth-child(4),.bracket-report-table th:nth-child(5),.bracket-report-table td:nth-child(5){width:95px;text-align:center}.league-split-only,.league-split-config{display:none}
@media(max-width:720px){.bracket-block{padding:12px}.bracket-round{min-width:205px}.bracket-grid{gap:12px}.bracket-match:after{display:none}}
@media print{.bracket-wrapper{display:block}.bracket-block{break-inside:avoid}.bracket-grid{display:flex!important;gap:10px!important}.bracket-round{min-width:150px!important}.bracket-match{padding:7px!important;border-radius:10px!important}.bracket-team{padding:5px 6px!important;font-size:8pt!important}.bracket-meta,.bracket-match small{font-size:7pt!important}}
.team-inline{display:inline-flex;align-items:center;gap:9px;min-width:0}.team-inline h3{margin:0}.team-inline .team-logo,.team-inline .team-logo-fallback,.bracket-team .team-logo,.bracket-team .team-logo-fallback{width:32px;height:32px;border-radius:10px;flex:0 0 auto}.team-logo-fallback{position:relative;background:linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.16);color:transparent;overflow:hidden}.match-teams{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 8px}.bracket-team{justify-content:flex-start}.bracket-team strong{margin-left:auto}.team-logo-preview{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.035)}.competition-row{display:grid;grid-template-columns:1.5fr .7fr .7fr auto;gap:10px;align-items:end;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.035);margin-bottom:10px}.supercup-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:720px){.competition-row,.supercup-grid{grid-template-columns:1fr}.team-inline .team-logo,.team-inline .team-logo-fallback{width:28px;height:28px}.match-teams{display:grid;grid-template-columns:1fr;gap:8px}.match-teams>.muted{text-align:center}}


/* === New Generation v19 brand refresh ===
   Palette ricavata dal nuovo logo: nero profondo, oro caldo, crema e bianco.
   Mantiene tutte le feature della v18 ma aggiorna atmosfera, leggibilità e PDF. */
:root{
  --bg:#070604;
  --panel:#14110b;
  --panel2:#0d0b07;
  --line:rgba(218,172,54,.26);
  --text:#fff8e7;
  --muted:#c8b889;
  --primary:#d7a42d;
  --blue:#f7dc78;
  --danger:#e5535f;
  --yellow:#ffd76a;
  --radius:22px;
  --shadow:0 26px 80px rgba(0,0,0,.46);
  font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
body{
  background:
    radial-gradient(circle at 12% 0,rgba(215,164,45,.23),transparent 30rem),
    radial-gradient(circle at 90% 6%,rgba(255,215,106,.13),transparent 34rem),
    linear-gradient(135deg,#050403 0%,#11100c 46%,#050403 100%);
  color:var(--text);
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;opacity:.38;
  background-image:linear-gradient(rgba(215,164,45,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(215,164,45,.055) 1px,transparent 1px);
  background-size:52px 52px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.75),transparent 78%);
}
.shell{position:relative;z-index:1}
header,.site-header{
  background:linear-gradient(135deg,rgba(9,8,5,.96),rgba(23,18,9,.92));
  border-color:rgba(215,164,45,.38);
  box-shadow:0 22px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,236,168,.08);
}
.brand h1{
  text-transform:uppercase;letter-spacing:.035em;font-weight:950;
  text-shadow:0 1px 0 rgba(255,255,255,.06),0 0 22px rgba(215,164,45,.18);
}
.brand p,.muted{color:var(--muted)}
.logo{
  width:66px;height:66px;border-radius:50%;overflow:hidden;
  background:url('../brand/new-generation-logo.jpg') center/cover no-repeat;
  border:2px solid #d7a42d;
  box-shadow:0 0 0 4px rgba(0,0,0,.55),0 0 28px rgba(215,164,45,.38);
  filter:none;flex:0 0 auto;
}
.logo:before,.logo:after,.logo span{display:none!important}
.btn{
  border-color:rgba(215,164,45,.26);background:rgba(255,246,218,.06);color:var(--text);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
}
.btn.primary,.tab-btn.active,.admin-nav a.active,.admin-nav a:hover{
  background:linear-gradient(135deg,#b98218,#f2d26f 52%,#d7a42d);
  color:#161006;border-color:rgba(255,222,125,.35);
  box-shadow:0 12px 30px rgba(215,164,45,.24);
}
.btn.danger{background:rgba(229,83,95,.14);border-color:rgba(229,83,95,.42);color:#ffe2e4}
.tabs,.admin-nav{
  border-color:rgba(215,164,45,.24);
  background:linear-gradient(180deg,rgba(255,246,218,.055),rgba(255,246,218,.025));
}
.tab-btn,.admin-nav a{color:#d7c99a}
.card,.modal-content{
  background:linear-gradient(180deg,rgba(24,20,12,.94),rgba(14,12,8,.92));
  border-color:rgba(215,164,45,.24);
  box-shadow:0 22px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,236,168,.06);
}
.card h2,.card h3,.section-title h2,.section-title h3{color:#fff8e7}
input,select,textarea{
  background:rgba(4,4,3,.78);border-color:rgba(215,164,45,.25);color:var(--text);
}
input:focus,select:focus,textarea:focus{border-color:rgba(242,210,111,.78);box-shadow:0 0 0 4px rgba(215,164,45,.13)}
th{background:rgba(215,164,45,.09);color:#f0d68a}td{border-bottom-color:rgba(215,164,45,.12)}
.rank,.score-badge{background:linear-gradient(135deg,#b98218,#f4db78);color:#141008}
.stat{background:linear-gradient(180deg,rgba(255,246,218,.08),rgba(255,246,218,.035));border-color:rgba(215,164,45,.22)}
.stat strong{color:#ffe9a5}.pill{border-color:rgba(215,164,45,.28);background:rgba(215,164,45,.11);color:#ffe9a5}
.team-card,.team-row,.player-row,.event-row,.match-card,.quick-card{background:linear-gradient(180deg,rgba(255,246,218,.065),rgba(255,246,218,.025));border-color:rgba(215,164,45,.2)}
.quick-card:hover,.clickable:hover{border-color:rgba(242,210,111,.62);box-shadow:0 18px 45px rgba(215,164,45,.12)}
.player-chip{border-color:rgba(215,164,45,.35);background:rgba(215,164,45,.13);color:#fff1b8}.help-box{border-color:rgba(215,164,45,.42);background:rgba(215,164,45,.08);color:#fff0bd}.message.ok{background:rgba(215,164,45,.12);border-color:rgba(215,164,45,.35)}
.team-logo{border:1px solid rgba(215,164,45,.45);box-shadow:0 7px 20px rgba(0,0,0,.24)}
.team-logo-fallback{
  background:rgba(255,255,255,.045);color:var(--text);position:relative;border:1px solid rgba(255,225,133,.24);
}
.bracket-round{border-color:rgba(215,164,45,.25);background:rgba(0,0,0,.12)}
.bracket-match{border-color:rgba(215,164,45,.24);background:rgba(255,246,218,.045)}
.bracket-team.winner{background:rgba(215,164,45,.16);border-color:rgba(242,210,111,.52)}
.pdf-hero,.print-cover{background:linear-gradient(135deg,rgba(215,164,45,.18),rgba(0,0,0,.18)),rgba(16,13,8,.95);border-color:rgba(215,164,45,.35)}
.pdf-card{background:linear-gradient(180deg,rgba(22,18,11,.96),rgba(10,9,6,.94));border-color:rgba(215,164,45,.26)}
.pdf-table th{background:rgba(215,164,45,.12);color:#f3d778}.pdf-rank,.pdf-status.done{background:linear-gradient(135deg,#b98218,#f4db78);color:#161006}.pdf-status.todo{background:rgba(255,255,255,.08);color:#d9c895}
@media(max-width:720px){.logo{width:58px;height:58px}.brand h1{font-size:1.35rem;line-height:1.1}.brand{gap:12px}.admin-nav a,.tab-btn{min-height:46px}.card{border-radius:18px}}


/* Supabase shared backend UI */
.sync-status{
  position:fixed;
  right:16px;
  bottom:16px;
  z-index:9999;
  max-width:min(420px, calc(100vw - 32px));
  padding:12px 16px;
  border-radius:18px;
  border:1px solid rgba(197,151,55,.42);
  background:rgba(10,10,10,.92);
  color:#f8efcf;
  box-shadow:0 18px 48px rgba(0,0,0,.34);
  font-size:.92rem;
  backdrop-filter: blur(16px);
}
.sync-status:empty{display:none;}
.sync-status[data-type="ok"]{border-color:rgba(197,151,55,.55);}
.sync-status[data-type="warn"]{border-color:rgba(255,210,96,.65);}
.sync-status[data-type="error"]{border-color:rgba(255,95,122,.65); color:#ffd6df;}
.login-overlay{
  position:fixed;
  inset:0;
  z-index:9998;
  display:grid;
  place-items:center;
  padding:20px;
  background:radial-gradient(circle at top, rgba(197,151,55,.22), rgba(0,0,0,.88) 44%), rgba(0,0,0,.82);
  backdrop-filter: blur(10px);
}
.login-card{
  width:min(480px,100%);
  display:grid;
  gap:12px;
  padding:24px;
  border-radius:28px;
  border:1px solid rgba(197,151,55,.38);
  background:linear-gradient(180deg, rgba(20,18,13,.96), rgba(5,5,5,.96));
  box-shadow:0 30px 90px rgba(0,0,0,.52);
}
.mini-brand{margin-bottom:6px;}
.small-text{font-size:.86rem;}
@media(max-width:640px){
  .sync-status{left:10px;right:10px;bottom:10px;}
  .login-card{padding:18px;border-radius:22px;}
}

/* Articles / news section */
.article-list{display:grid;gap:16px;}
.article-card{
  display:grid;
  grid-template-columns:minmax(180px,260px) 1fr;
  gap:18px;
  align-items:stretch;
  padding:14px;
  border:1px solid rgba(215,164,45,.22);
  border-radius:24px;
  background:linear-gradient(135deg,rgba(255,246,218,.075),rgba(255,246,218,.025));
  box-shadow:0 18px 46px rgba(0,0,0,.20);
  overflow:hidden;
}
.article-media{min-height:170px;display:flex;}
.article-image{
  width:100%;
  min-height:170px;
  height:100%;
  object-fit:cover;
  border-radius:18px;
  border:1px solid rgba(215,164,45,.30);
  background:#0a0906;
  box-shadow:inset 0 1px 0 rgba(255,246,218,.08);
}
.article-image.small{width:150px;height:104px;min-height:104px;flex:0 0 auto;}
.article-placeholder{
  display:grid;
  place-items:center;
  background:radial-gradient(circle at 50% 30%,rgba(245,215,128,.28),transparent 38%),linear-gradient(135deg,#070604,#20180a 62%,#c9962a);
  color:#ffeba7;
  font-weight:950;
  letter-spacing:.1em;
}
.article-content{display:flex;flex-direction:column;gap:10px;min-width:0;}
.article-content h3{margin:0;font-size:clamp(1.15rem,2vw,1.55rem);letter-spacing:-.03em;}
.article-content p{margin:0;color:#e8dcc4;line-height:1.55;}
.article-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#bda970;font-size:.88rem;}
.image-preview{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px;border:1px dashed rgba(215,164,45,.28);border-radius:18px;background:rgba(255,246,218,.035);}
@media(max-width:780px){
  .article-card{grid-template-columns:1fr;padding:12px;border-radius:20px;}
  .article-media{min-height:190px;}
  .article-image{min-height:190px;}
}

.weekday-grid{display:grid;grid-template-columns:repeat(7,minmax(72px,1fr));gap:10px;margin-top:8px}
.weekday-grid label{display:flex;align-items:center;justify-content:center;gap:7px;padding:10px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.045);cursor:pointer;font-weight:800;color:var(--text)}
.weekday-grid input{width:auto;accent-color:var(--gold)}
.advisor-card{border:1px solid rgba(196,155,70,.35);background:linear-gradient(135deg,rgba(196,155,70,.12),rgba(255,255,255,.035));border-radius:18px;padding:14px;display:grid;gap:8px}
.advisor-card strong{color:var(--gold)}
@media(max-width:760px){.weekday-grid{grid-template-columns:repeat(2,1fr)}.weekday-grid label{justify-content:flex-start}}

/* v24 - pausa programmata torneo giornaliero */
.pause-settings-box {
  border: 1px solid rgba(201, 154, 58, .35);
  background: linear-gradient(135deg, rgba(201,154,58,.12), rgba(255,255,255,.03));
  border-radius: 18px;
  padding: 16px;
}
.compact-form {
  margin-top: 12px;
}
.pause-card {
  border-color: rgba(201,154,58,.45);
  background: linear-gradient(135deg, rgba(201,154,58,.18), rgba(18,18,18,.82));
}
.pause-card .score-badge {
  background: linear-gradient(135deg, var(--gold), #f4d879);
  color: #0d0d0d;
}

/* v25: tabellone mobile e referto più guidato */
.mobile-bracket-view{display:none}.bracket-mobile-hint{margin:6px 0 12px}.bracket-list-round{border:1px solid rgba(215,164,45,.22);border-radius:18px;padding:12px;background:rgba(255,246,218,.035);margin-bottom:12px}.bracket-list-round h4{margin:0 0 10px;color:var(--gold)}.bracket-list-match{border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(0,0,0,.18);padding:10px;margin-top:10px}.bracket-list-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);font-size:.82rem}.bracket-list-meta strong{color:var(--text);font-variant-numeric:tabular-nums}.bracket-list-teams{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin:8px 0;font-weight:800}.bracket-list-teams span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bracket-list-teams em{font-style:normal;color:var(--muted);font-size:.8rem}.bracket-list-teams .winner{color:var(--gold);text-shadow:0 0 18px rgba(215,164,45,.25)}.event-picker-grid{grid-template-columns:1fr 1fr 1.3fr auto auto}.event-picker-grid input,.event-picker-grid select{min-width:0}.score-note{color:var(--muted);font-size:.85rem;margin-top:8px}
@media(max-width:720px){.desktop-bracket-view{display:none}.mobile-bracket-view{display:block}.bracket-block{overflow:hidden}.bracket-wrapper{gap:12px}.bracket-list-teams{grid-template-columns:1fr;gap:5px}.bracket-list-teams em{text-align:center}.event-picker-grid,.quick-add-bar,.card-add-bar{display:grid!important;grid-template-columns:1fr!important}.event-picker-grid .btn{width:100%}.live-counters{grid-template-columns:repeat(2,1fr)!important}.report-head{display:grid!important;gap:10px}.sticky-save-panel{display:grid!important;grid-template-columns:1fr!important}}


/* Classifiche per girone */
.compact-filters{margin:0 0 14px}
.group-standings-menu{align-items:end}
.group-standing-block{margin-bottom:18px}
.group-standing-block:last-child{margin-bottom:0}
.mini-section-title{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:6px 0 10px}
.mini-section-title h3{margin:0;font-size:1rem}

/* Manual group editor */
.toolbar.wrap{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.file-btn{cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.group-builder{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.group-column{border:1px solid rgba(215,164,45,.22);border-radius:22px;padding:14px;background:linear-gradient(180deg,rgba(255,246,218,.06),rgba(255,246,218,.025))}.group-column.ok{border-color:rgba(85,220,150,.36)}.group-column.warn{border-color:rgba(255,215,106,.46)}.group-column.over{border-color:rgba(229,83,95,.62)}.group-column-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.group-column-head h3{margin:0}.group-team-row{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;padding:10px;border:1px solid rgba(215,164,45,.16);border-radius:16px;background:rgba(0,0,0,.14)}.group-team-row select{margin-top:5px}.tiny-label{font-size:.75rem;color:var(--muted);margin-top:4px}.empty.small{padding:12px;font-size:.9rem}.health-line{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;border:1px solid rgba(215,164,45,.18);background:rgba(255,255,255,.035)}.health-line.ok{border-color:rgba(85,220,150,.32)}.health-line.warn{border-color:rgba(255,215,106,.42)}.health-line.error{border-color:rgba(229,83,95,.55)}.help-box.warn{border-color:rgba(255,215,106,.55);background:rgba(255,215,106,.09)}
@media(max-width:760px){.toolbar.wrap .btn,.file-btn{width:100%}.group-builder{grid-template-columns:1fr}}
.integrity-group{margin-top:10px;border:1px solid rgba(215,164,45,.18);border-radius:16px;padding:10px 12px;background:rgba(255,255,255,.035)}
.integrity-group summary{cursor:pointer;color:var(--gold-2)}
.integrity-group ul{margin:10px 0 0 18px;padding:0}.integrity-group li{margin:6px 0}.error-text{color:#ff8e99}.warn-text{color:#ffd56a}
.integrity-snapshot{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.integrity-snapshot span{border:1px solid rgba(215,164,45,.2);border-radius:999px;padding:6px 10px;background:rgba(0,0,0,.12)}
.message.warn{border-color:rgba(255,213,106,.58);background:rgba(255,213,106,.09)}

/* v15: stabilità loghi, ricerca squadra e mobile polish */
.search-team-result{align-items:center;grid-template-columns:auto minmax(0,1fr) auto}
.search-team-result .row-actions{justify-content:flex-end}
.team-logo{background:transparent;border:1px solid rgba(255,255,255,.12)}
.team-logo-fallback span{display:none}
@media(max-width:720px){
  .search-team-result{grid-template-columns:1fr;text-align:left}
  .search-team-result .team-logo,.search-team-result .team-logo-fallback{width:62px;height:62px}
  .search-team-result .row-actions{display:grid;grid-template-columns:1fr;width:100%}
  .search-team-result .btn{width:100%}
  .tabs{position:sticky;top:0;z-index:8;background:rgba(7,11,18,.95);backdrop-filter:blur(14px);padding:6px;border-radius:18px;max-height:58vh;overflow:auto}
  input,select,textarea{font-size:16px}
  .table-wrap{border-radius:16px;border:1px solid rgba(255,255,255,.08)}
  table{min-width:620px}
  .team-card-grid{grid-template-columns:1fr}
  .brand p{font-size:.9rem}
}
@media(max-width:420px){
  .stat-strip{grid-template-columns:1fr 1fr}
  .stat{padding:12px}
  .stat strong{font-size:1.22rem}
  .match-card,.team-card,.player-row,.team-row{padding:12px;border-radius:16px}
}

/* v16: articolo sempre visibile anche se immagine assente o non decodificabile */
.article-media{position:relative;min-width:0;}
.article-placeholder{min-height:170px;width:100%;border-radius:18px;border:1px solid rgba(215,164,45,.30);box-shadow:inset 0 1px 0 rgba(255,246,218,.08);}
.article-placeholder span{display:grid;place-items:center;width:68px;height:68px;border-radius:999px;background:rgba(0,0,0,.34);border:1px solid rgba(255,235,176,.34);font-size:1.25rem;}
.article-placeholder small{margin-top:8px;font-size:.68rem;letter-spacing:.18em;color:#ffe8a0;opacity:.85;}
.article-card img.article-image{display:block;aspect-ratio:16/10;}
.article-image[loading="lazy"]{content-visibility:auto;}
@media(max-width:780px){.article-placeholder{min-height:190px}.article-placeholder span{width:62px;height:62px}}


/* v17: mobile navigation tipo app, compatta e non invasiva */
.public-page{--mobile-nav-height:74px;}
.mobile-bottom-nav,.mobile-nav-sheet{display:none;}
@media(max-width:720px){
  .public-page .shell{padding-bottom:calc(var(--mobile-nav-height) + env(safe-area-inset-bottom) + 20px);}
  .public-page header{position:relative;top:auto;border-radius:22px;padding:13px;margin-bottom:12px;}
  .public-page .brand{align-items:center;}
  .public-page .brand p{display:none;}
  .public-page .actions{display:grid;grid-template-columns:1fr;gap:8px;}
  .public-page .actions .pill{justify-content:center;font-size:.76rem;padding:5px 8px;}
  .public-page > .shell > .tabs{display:none!important;}
  .mobile-bottom-nav{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:10px;right:10px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:80;min-height:var(--mobile-nav-height);padding:8px;border:1px solid rgba(255,235,176,.22);border-radius:24px;background:rgba(8,8,8,.90);box-shadow:0 18px 55px rgba(0,0,0,.55);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);}
  .mobile-nav-item{appearance:none;border:0;background:transparent;color:#d7c99a;border-radius:18px;display:grid;place-items:center;gap:2px;padding:7px 4px;font:inherit;font-size:.69rem;font-weight:850;line-height:1;min-width:0;}
  .mobile-nav-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:999px;font-size:1rem;background:rgba(255,255,255,.055);color:#ffe9a8;}
  .mobile-nav-item.active{color:#0d0d0d;background:linear-gradient(135deg,var(--gold,#c99a3a),#ffe9a8);box-shadow:0 10px 28px rgba(201,154,58,.23);}
  .mobile-nav-item.active .mobile-nav-icon{background:rgba(0,0,0,.12);color:#0d0d0d;}
  .mobile-nav-sheet{display:block;position:fixed;inset:0;z-index:90;opacity:0;pointer-events:none;transition:opacity .18s ease;}
  .mobile-nav-sheet.open{opacity:1;pointer-events:auto;}
  .mobile-nav-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.58);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
  .mobile-nav-panel{position:absolute;left:10px;right:10px;bottom:calc(92px + env(safe-area-inset-bottom));border:1px solid rgba(255,235,176,.22);border-radius:28px;background:linear-gradient(180deg,rgba(20,20,20,.98),rgba(10,10,10,.98));box-shadow:0 20px 70px rgba(0,0,0,.62);padding:10px 12px 14px;transform:translateY(18px);transition:transform .18s ease;}
  .mobile-nav-sheet.open .mobile-nav-panel{transform:translateY(0);}
  .mobile-sheet-handle{width:42px;height:4px;border-radius:999px;background:rgba(255,235,176,.35);margin:2px auto 10px;}
  .mobile-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;color:#ffe9a8;}
  .mobile-sheet-head .btn{width:auto;min-height:34px;padding:7px 12px;}
  .mobile-sheet-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
  .mobile-sheet-item{border:1px solid rgba(255,235,176,.18);background:rgba(255,255,255,.045);color:var(--text);border-radius:18px;padding:13px 8px;display:grid;place-items:center;gap:6px;font:inherit;min-height:82px;}
  .mobile-sheet-item span{font-size:1.35rem;color:#ffe9a8;}
  .mobile-sheet-item strong{font-size:.78rem;}
  .public-page .card{scroll-margin-top:12px;}
}
@media(max-width:380px){
  .mobile-bottom-nav{left:6px;right:6px;border-radius:20px;padding:6px;}
  .mobile-nav-item{font-size:.64rem;padding:6px 2px;}
  .mobile-nav-icon{width:26px;height:26px;font-size:.94rem;}
  .mobile-sheet-grid{grid-template-columns:1fr 1fr;}
}
@media(prefers-reduced-motion:reduce){.mobile-nav-sheet,.mobile-nav-panel{transition:none!important}.public-page *{scroll-behavior:auto!important}}


/* v18: card articoli stile giornalistico sportivo, responsive e stabile */
.article-list{
  display:grid;
  gap:18px;
}
.article-card.sports-news-card,
.article-card{
  display:grid;
  grid-template-columns:minmax(260px, 38%) minmax(0, 1fr);
  grid-template-areas:"media content";
  gap:0;
  align-items:stretch;
  padding:0;
  min-height:236px;
  overflow:hidden;
  border:1px solid rgba(215,164,45,.26);
  border-radius:28px;
  background:
    radial-gradient(circle at 90% -10%, rgba(215,164,45,.22), transparent 34%),
    linear-gradient(135deg, rgba(22,20,13,.96), rgba(6,6,5,.98) 58%, rgba(0,0,0,.96));
  box-shadow:0 22px 60px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,246,218,.08);
}
.article-media{
  grid-area:media;
  position:relative;
  display:block;
  min-height:236px;
  width:100%;
  overflow:hidden;
  background:#090806;
  isolation:isolate;
}
.article-image,
.article-card img.article-image,
.article-placeholder{
  width:100%;
  height:100%;
  min-height:236px;
  aspect-ratio:16 / 10;
  object-fit:cover;
  border:0;
  border-radius:0;
  background:#090806;
  box-shadow:none;
}
.article-card img.article-image{
  display:block;
  transition:transform .35s ease, filter .35s ease;
}
.article-card:hover img.article-image{
  transform:scale(1.035);
  filter:saturate(1.08) contrast(1.04);
}
.article-placeholder{
  display:grid;
  place-items:center;
  background:
    radial-gradient(circle at 50% 30%,rgba(245,215,128,.28),transparent 38%),
    linear-gradient(135deg,#070604,#20180a 62%,#c9962a);
  color:#ffeba7;
}
.article-placeholder span{
  display:grid;
  place-items:center;
  width:76px;
  height:76px;
  border-radius:999px;
  background:rgba(0,0,0,.36);
  border:1px solid rgba(255,235,176,.42);
  font-size:1.35rem;
  font-weight:950;
  letter-spacing:.08em;
}
.article-placeholder small{margin-top:8px;font-size:.68rem;letter-spacing:.18em;color:#ffe8a0;opacity:.85;}
.article-media-shade{
  position:absolute;
  inset:auto 0 0 0;
  height:42%;
  background:linear-gradient(180deg, transparent, rgba(0,0,0,.62));
  pointer-events:none;
  z-index:1;
}
.article-kicker{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:28px;
  padding:6px 11px;
  border-radius:999px;
  border:1px solid rgba(255,235,176,.30);
  background:linear-gradient(135deg, rgba(201,154,58,.95), rgba(255,232,154,.86));
  color:#12100a;
  font-size:.72rem;
  font-weight:950;
  letter-spacing:.06em;
  text-transform:uppercase;
  box-shadow:0 10px 26px rgba(0,0,0,.22);
}
.media-kicker{
  position:absolute;
  left:14px;
  bottom:14px;
  z-index:2;
}
.article-content{
  grid-area:content;
  display:flex;
  flex-direction:column;
  justify-content:center;
  gap:12px;
  min-width:0;
  padding:24px 26px;
}
.article-meta{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  color:#cdbd87;
  font-size:.88rem;
}
.article-meta time{font-variant-numeric:tabular-nums;}
.article-content h3{
  margin:0;
  max-width:18ch;
  font-size:clamp(1.55rem, 3vw, 2.45rem);
  line-height:.98;
  letter-spacing:-.055em;
  text-wrap:balance;
  color:#fff7df;
}
.article-content p{
  margin:0;
  max-width:64ch;
  color:#e7dcc3;
  line-height:1.55;
  font-size:1rem;
  display:-webkit-box;
  -webkit-line-clamp:4;
  -webkit-box-orient:vertical;
  overflow:hidden;
}
.article-actions{
  margin-top:6px;
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}
.article-image.small{
  width:160px;
  height:104px;
  min-height:104px;
  aspect-ratio:16 / 10;
  border-radius:16px;
  border:1px solid rgba(215,164,45,.28);
}
.image-preview .article-placeholder.small,
.article-placeholder.small{
  width:160px;
  height:104px;
  min-height:104px;
  aspect-ratio:16 / 10;
  border-radius:16px;
}
@media(max-width:900px){
  .article-card.sports-news-card,
  .article-card{
    grid-template-columns:1fr;
    grid-template-areas:"media" "content";
    min-height:0;
    border-radius:24px;
  }
  .article-media,
  .article-image,
  .article-card img.article-image,
  .article-placeholder{
    min-height:0;
    height:auto;
    aspect-ratio:16 / 9;
  }
  .article-card img.article-image,
  .article-placeholder{height:100%;}
  .article-content{padding:18px;gap:10px;}
  .article-content h3{max-width:100%;font-size:clamp(1.45rem,7vw,2.05rem);line-height:1.02;}
  .article-content p{-webkit-line-clamp:5;font-size:.96rem;}
  .article-actions{display:grid;grid-template-columns:1fr 1fr;width:100%;}
  .article-actions .btn{width:100%;}
}
@media(max-width:520px){
  .article-list{gap:14px;}
  .article-card.sports-news-card,
  .article-card{border-radius:22px;}
  .article-media{aspect-ratio:16 / 10;}
  .article-content{padding:15px;}
  .article-meta{font-size:.78rem;gap:8px;}
  .article-kicker{font-size:.66rem;min-height:25px;padding:5px 9px;}
  .media-kicker{left:12px;bottom:12px;}
  .article-content h3{font-size:1.55rem;}
  .article-content p{font-size:.92rem;-webkit-line-clamp:4;}
}
@media(prefers-reduced-motion:reduce){.article-card img.article-image{transition:none}.article-card:hover img.article-image{transform:none}}


/* v19: articoli robusti, senza caratteri strani, layout giornalistico side-by-side anche su mobile */
.article-list{display:grid;gap:18px;}
.article-card.sports-news-card,.article-card{
  display:grid!important;
  grid-template-columns:clamp(140px, 34vw, 430px) minmax(0,1fr)!important;
  grid-template-areas:"media content"!important;
  align-items:stretch!important;
  min-height:220px!important;
  padding:0!important;
  overflow:hidden!important;
  border-radius:28px!important;
  border:1px solid rgba(215,164,45,.30)!important;
  background:linear-gradient(135deg,rgba(18,17,12,.98),rgba(5,5,4,.98) 62%,rgba(24,18,7,.96))!important;
  box-shadow:0 22px 60px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,246,218,.08)!important;
}
.article-media{grid-area:media!important;position:relative!important;display:block!important;overflow:hidden!important;min-height:220px!important;height:100%!important;background:#080705!important;}
.article-image,.article-card img.article-image,.article-placeholder{display:block!important;width:100%!important;height:100%!important;min-height:220px!important;aspect-ratio:auto!important;object-fit:cover!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#080705!important;}
.article-placeholder{display:grid!important;place-items:center!important;align-content:center!important;background:radial-gradient(circle at 50% 25%,rgba(255,222,124,.25),transparent 38%),linear-gradient(135deg,#080705,#211706 72%,#b98723)!important;color:#ffe8a0!important;}
.article-placeholder span{display:grid!important;place-items:center!important;width:72px!important;height:72px!important;border-radius:999px!important;background:rgba(0,0,0,.38)!important;border:1px solid rgba(255,235,176,.42)!important;font-size:1.25rem!important;font-weight:950!important;letter-spacing:.08em!important;}
.article-content{grid-area:content!important;display:flex!important;flex-direction:column!important;justify-content:center!important;min-width:0!important;padding:24px 26px!important;gap:11px!important;}
.article-meta{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important;color:#cdbd87!important;font-size:.88rem!important;}
.article-content h3{margin:0!important;max-width:24ch!important;color:#fff7df!important;font-size:clamp(1.45rem,2.6vw,2.35rem)!important;line-height:1.02!important;letter-spacing:-.045em!important;text-wrap:balance!important;}
.article-content p{margin:0!important;max-width:62ch!important;color:#e7dcc3!important;line-height:1.5!important;font-size:1rem!important;display:-webkit-box!important;-webkit-line-clamp:4!important;-webkit-box-orient:vertical!important;overflow:hidden!important;}
.article-media-shade{position:absolute!important;inset:auto 0 0 0!important;height:40%!important;background:linear-gradient(180deg,transparent,rgba(0,0,0,.62))!important;pointer-events:none!important;z-index:1!important;}
.media-kicker{position:absolute!important;left:14px!important;bottom:14px!important;z-index:2!important;}
.article-actions{margin-top:8px!important;display:flex!important;gap:10px!important;flex-wrap:wrap!important;}
@media(max-width:700px){
  .article-list{gap:12px!important;}
  .article-card.sports-news-card,.article-card{
    grid-template-columns:minmax(116px,38%) minmax(0,1fr)!important;
    min-height:148px!important;
    border-radius:20px!important;
  }
  .article-media,.article-image,.article-card img.article-image,.article-placeholder{min-height:148px!important;height:100%!important;}
  .article-content{padding:12px 13px!important;gap:7px!important;justify-content:center!important;}
  .article-meta{font-size:.72rem!important;gap:6px!important;}
  .article-kicker{font-size:.58rem!important;min-height:22px!important;padding:4px 8px!important;}
  .media-kicker{left:8px!important;bottom:8px!important;}
  .article-content h3{font-size:1.05rem!important;line-height:1.06!important;letter-spacing:-.035em!important;max-width:100%!important;}
  .article-content p{font-size:.82rem!important;line-height:1.35!important;-webkit-line-clamp:3!important;}
  .article-actions{display:grid!important;grid-template-columns:1fr 1fr!important;width:100%!important;gap:6px!important;}
  .article-actions .btn{width:100%!important;min-height:38px!important;}
}
@media(max-width:380px){
  .article-card.sports-news-card,.article-card{grid-template-columns:108px minmax(0,1fr)!important;}
  .article-content{padding:10px!important;}
  .article-content p{-webkit-line-clamp:2!important;}
}

/* v20: reset senza demo + scelta recap PDF */
.ng-modal-backdrop{
  position:fixed;
  inset:0;
  z-index:9999;
  display:none;
  align-items:center;
  justify-content:center;
  padding:22px;
  background:rgba(0,0,0,.72);
  backdrop-filter:blur(12px);
}
.ng-modal-backdrop.show{display:flex;}
.ng-modal{
  width:min(560px,100%);
  border:1px solid rgba(215,164,45,.38)!important;
  background:linear-gradient(145deg,rgba(21,20,14,.98),rgba(5,5,4,.98) 72%,rgba(34,25,9,.96))!important;
  box-shadow:0 30px 90px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,246,218,.08);
}
.ng-modal h2{margin:.35rem 0 .45rem;font-size:clamp(1.8rem,4vw,2.45rem);letter-spacing:-.04em;}
.danger-pill{border-color:rgba(255,103,103,.42)!important;color:#ffd3d3!important;background:rgba(120,28,42,.22)!important;}
.reset-choice-grid{display:grid;grid-template-columns:1fr;gap:10px;margin-top:18px;}
.reset-choice-grid .btn{justify-content:center;min-height:48px;}
@media(min-width:720px){.reset-choice-grid{grid-template-columns:1.4fr 1fr auto;align-items:center;}.reset-choice-grid .btn{min-height:44px;}}

/* v21: backup completo su reset + interfaccia ripristino */
.reset-modal{max-width:760px;width:min(760px,calc(100vw - 28px));}
.reset-export-panel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0;}
.check-card{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid rgba(214,176,72,.28);border-radius:18px;background:linear-gradient(135deg,rgba(255,225,126,.08),rgba(255,255,255,.03));cursor:pointer;}
.check-card input{width:20px;height:20px;margin-top:2px;accent-color:#d6b048;flex:0 0 auto;}
.check-card strong{display:block;color:var(--text);font-size:1rem;line-height:1.2;}
.check-card small{display:block;color:var(--muted);margin-top:4px;line-height:1.35;}
.confirm-card{margin-top:10px;border-color:rgba(239,68,68,.45);background:rgba(125,33,41,.16);}
.backup-panel{margin-top:22px;}
.backup-import-card{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(260px,.85fr);gap:16px;align-items:stretch;}
.backup-drop{border:1px dashed rgba(214,176,72,.45);border-radius:22px;padding:18px;background:linear-gradient(145deg,rgba(255,225,126,.07),rgba(255,255,255,.025));}
.backup-drop input[type=file]{width:100%;margin-top:12px;}
.backup-preview{border:1px solid rgba(214,176,72,.25);border-radius:22px;padding:18px;background:rgba(0,0,0,.18);min-height:132px;}
.backup-preview .mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px;}
.backup-preview .mini-grid span{display:block;border:1px solid rgba(214,176,72,.18);border-radius:14px;padding:10px;background:rgba(255,255,255,.035);}
.backup-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;}
@media (max-width:760px){.reset-export-panel,.backup-import-card{grid-template-columns:1fr}.reset-choice-grid{grid-template-columns:1fr}.backup-preview .mini-grid{grid-template-columns:1fr}.check-card{border-radius:16px;padding:12px}}


/* v23 - Lettura completa articoli: modal accessibile e responsive */
.article-card[role="button"]{cursor:pointer;outline:none;}
.article-card[role="button"]:focus-visible{box-shadow:0 0 0 3px rgba(255,218,112,.42),0 16px 40px rgba(0,0,0,.24)!important;}
.article-read-btn{align-self:flex-start;}
body.modal-open{overflow:hidden;}
.article-modal{position:fixed!important;inset:0!important;z-index:9999!important;display:none;align-items:center;justify-content:center;padding:clamp(12px,3vw,28px);background:rgba(0,0,0,.72);backdrop-filter:blur(10px);}
.article-modal.open{display:flex!important;}
.article-modal-content{width:min(1120px,100%);max-height:min(92vh,900px);overflow:auto;border-radius:28px;border:1px solid rgba(215,164,45,.42);background:linear-gradient(145deg,#070603 0%,#131009 55%,#211707 100%);box-shadow:0 30px 90px rgba(0,0,0,.55);padding:0;color:#fff7df;}
.article-modal-toolbar{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid rgba(215,164,45,.24);background:rgba(9,8,4,.92);backdrop-filter:blur(12px);}
.article-modal-toolbar h2{margin:6px 0 0;font-size:clamp(1.05rem,2vw,1.45rem);letter-spacing:-.035em;max-width:60ch;}
.article-detail{display:grid;grid-template-columns:minmax(320px,.9fr) minmax(0,1.1fr);min-height:420px;}
.article-detail-hero{position:relative;overflow:hidden;background:#080705;min-height:420px;}
.article-detail-hero .article-image,.article-detail-hero img.article-image,.article-detail-hero .article-placeholder{width:100%;height:100%;min-height:420px;object-fit:cover;border-radius:0;display:block;}
.article-detail-body{padding:clamp(22px,4vw,44px);display:flex;flex-direction:column;gap:16px;}
.article-detail-body h2{margin:0;color:#fff7df;font-size:clamp(2rem,4vw,4rem);line-height:.98;letter-spacing:-.06em;text-wrap:balance;}
.article-full-text{color:#efe5cd;font-size:clamp(1rem,1.25vw,1.13rem);line-height:1.72;white-space:normal;overflow-wrap:anywhere;}
.article-full-text br{content:"";display:block;margin:.45em 0;}
@media(max-width:760px){
  .article-modal{align-items:stretch;padding:0;}
  .article-modal-content{width:100%;height:100dvh;max-height:none;border-radius:0;border:0;}
  .article-modal-toolbar{padding:14px 14px calc(12px + env(safe-area-inset-top,0px));align-items:flex-start;}
  .article-modal-toolbar .btn{min-height:42px;white-space:nowrap;}
  .article-detail{grid-template-columns:42vw minmax(0,1fr);min-height:0;}
  .article-detail-hero{min-height:170px;height:auto;}
  .article-detail-hero .article-image,.article-detail-hero img.article-image,.article-detail-hero .article-placeholder{min-height:170px;height:100%;}
  .article-detail-body{padding:14px 14px 32px;gap:10px;}
  .article-detail-body h2{font-size:clamp(1.25rem,7vw,2rem);line-height:1.02;}
  .article-full-text{font-size:.98rem;line-height:1.58;}
}
@media(max-width:430px){
  .article-detail{grid-template-columns:38vw minmax(0,1fr);}
  .article-detail-hero,.article-detail-hero .article-image,.article-detail-hero img.article-image,.article-detail-hero .article-placeholder{min-height:150px;}
  .article-modal-toolbar h2{font-size:1rem;}
}

/* v24 - Lettura articolo: foto editoriale nitida, non croppata e non ingrandita oltre la sorgente */
.article-modal-content{background:linear-gradient(145deg,#050402 0%,#100d07 58%,#1b1306 100%)!important;}
.article-detail-editorial{display:grid!important;grid-template-columns:minmax(340px,.92fr) minmax(0,1.08fr)!important;min-height:420px!important;}
.article-detail-editorial .article-detail-hero{
  position:relative!important;
  isolation:isolate!important;
  overflow:hidden!important;
  display:grid!important;
  place-items:center!important;
  min-height:420px!important;
  padding:clamp(12px,2vw,24px)!important;
  background:#060503!important;
}
.article-detail-backdrop-img{
  position:absolute!important;
  inset:-28px!important;
  width:calc(100% + 56px)!important;
  height:calc(100% + 56px)!important;
  object-fit:cover!important;
  filter:blur(24px) saturate(.92) brightness(.55)!important;
  transform:scale(1.04)!important;
  opacity:.56!important;
  z-index:0!important;
  pointer-events:none!important;
}
.article-detail-frame{
  position:relative!important;
  z-index:2!important;
  width:100%!important;
  height:100%!important;
  min-height:320px!important;
  display:flex!important;
  align-items:center!important;
  justify-content:center!important;
  padding:clamp(8px,1.6vw,18px)!important;
  border-radius:24px!important;
  border:1px solid rgba(255,226,143,.20)!important;
  background:linear-gradient(180deg,rgba(0,0,0,.30),rgba(0,0,0,.54))!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 22px 60px rgba(0,0,0,.36)!important;
}
.article-detail-frame img.article-image,
.article-detail-frame .article-image:not(.article-placeholder){
  display:block!important;
  width:auto!important;
  height:auto!important;
  min-width:0!important;
  min-height:0!important;
  max-width:min(100%,var(--article-natural-w,100%))!important;
  max-height:min(70vh,var(--article-natural-h,70vh))!important;
  object-fit:contain!important;
  border-radius:18px!important;
  border:1px solid rgba(255,235,176,.18)!important;
  background:rgba(0,0,0,.28)!important;
  box-shadow:0 18px 50px rgba(0,0,0,.48)!important;
  transform:none!important;
}
.article-detail-frame .article-placeholder{
  width:100%!important;
  height:100%!important;
  min-height:320px!important;
  border-radius:18px!important;
}
.article-detail-editorial .article-media-shade{display:none!important;}
.article-detail-editorial .media-kicker{z-index:3!important;left:clamp(18px,3vw,32px)!important;top:clamp(18px,3vw,32px)!important;bottom:auto!important;}
@media(max-width:760px){
  .article-detail-editorial{grid-template-columns:44vw minmax(0,1fr)!important;min-height:0!important;}
  .article-detail-editorial .article-detail-hero{min-height:210px!important;padding:8px!important;}
  .article-detail-frame{min-height:178px!important;border-radius:18px!important;padding:7px!important;}
  .article-detail-frame img.article-image,
  .article-detail-frame .article-image:not(.article-placeholder){max-height:34vh!important;border-radius:14px!important;}
  .article-detail-frame .article-placeholder{min-height:178px!important;border-radius:14px!important;}
  .article-detail-backdrop-img{filter:blur(18px) saturate(.9) brightness(.52)!important;opacity:.60!important;}
  .article-detail-editorial .media-kicker{left:12px!important;top:12px!important;}
}
@media(max-width:430px){
  .article-detail-editorial{grid-template-columns:40vw minmax(0,1fr)!important;}
  .article-detail-editorial .article-detail-hero{min-height:178px!important;}
  .article-detail-frame{min-height:148px!important;padding:6px!important;}
  .article-detail-frame .article-placeholder{min-height:148px!important;}
  .article-detail-frame img.article-image,
  .article-detail-frame .article-image:not(.article-placeholder){max-height:30vh!important;}
}

/* v25 - Disclosure UI: squadre/roster come pulsanti espandibili, responsive e accessibili */
.team-card-grid{display:block!important;}
.team-disclosure-list{display:grid;gap:12px;width:100%;}
.ng-disclosure{
  border:1px solid rgba(215,164,45,.24);
  border-radius:22px;
  background:linear-gradient(135deg,rgba(255,246,218,.065),rgba(255,246,218,.022));
  overflow:hidden;
  box-shadow:0 16px 40px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,246,218,.045);
}
.ng-disclosure[open]{border-color:rgba(242,210,111,.62);box-shadow:0 22px 60px rgba(0,0,0,.28),0 0 0 1px rgba(242,210,111,.10) inset;}
.ng-disclosure-summary{
  list-style:none;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:14px 16px;
  min-height:72px;
  user-select:none;
}
.ng-disclosure-summary::-webkit-details-marker{display:none;}
.ng-disclosure-summary:focus-visible{outline:3px solid rgba(242,210,111,.45);outline-offset:3px;border-radius:20px;}
.disclosure-main{display:flex;align-items:center;gap:13px;min-width:0;}
.disclosure-main strong{display:block;font-size:1.02rem;line-height:1.12;color:#fff8e7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(520px,62vw);}
.disclosure-main small{display:block;color:var(--muted);font-weight:750;margin-top:4px;line-height:1.25;}
.disclosure-action{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;border:1px solid rgba(215,164,45,.34);background:rgba(215,164,45,.12);color:#ffe9a5;border-radius:999px;padding:8px 12px;font-size:.82rem;font-weight:950;text-transform:uppercase;letter-spacing:.05em;}
.disclosure-action:after{content:"▾";font-size:.9rem;transition:transform .18s ease;}
.ng-disclosure[open] .disclosure-action:after{transform:rotate(180deg);}
.ng-disclosure-body{padding:0 16px 16px;border-top:1px solid rgba(215,164,45,.18);animation:ngDisclosureIn .18s ease-out;}
@keyframes ngDisclosureIn{from{opacity:.55;transform:translateY(-4px)}to{opacity:1;transform:none}}
.team-profile-body{display:grid;gap:14px;}
.team-profile-hero{display:flex;gap:14px;align-items:center;padding-top:16px;}
.team-profile-hero h3{margin:0;font-size:clamp(1.35rem,2.4vw,2rem);letter-spacing:-.04em;}
.team-profile-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}
.team-profile-meta span{display:block;border:1px solid rgba(215,164,45,.22);border-radius:16px;padding:12px;background:rgba(0,0,0,.14);color:#fff2c4;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.team-profile-meta strong{display:block;color:#bfa45d;text-transform:uppercase;font-size:.72rem;letter-spacing:.08em;margin-bottom:4px;}
.team-profile-meta.compact-meta{margin-top:14px;}
.team-profile-section{border:1px solid rgba(215,164,45,.18);border-radius:18px;background:rgba(255,255,255,.026);padding:14px;}
.team-profile-section h4{margin:0 0 10px;font-size:.88rem;text-transform:uppercase;letter-spacing:.09em;color:#f2d26f;}
.roster-clean-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;}
.roster-clean-list li{border:1px solid rgba(215,164,45,.18);border-radius:14px;padding:10px 12px;background:rgba(0,0,0,.16);color:#fff8e7;min-width:0;}
.roster-clean-list li span{color:var(--muted);font-weight:800;}
.person-avatar{display:grid;place-items:center;width:40px;height:40px;border-radius:14px;background:linear-gradient(135deg,#b98218,#f2d26f);color:#161006;font-weight:950;flex:0 0 auto;}
.admin-disclosure-list .ng-disclosure-body,.admin-player-list .ng-disclosure-body{padding-top:16px;}
.public-page #teams .card>h2{margin-bottom:6px;}
.public-page #teams .card>h2:after{content:"Tocca una squadra per aprire roster, staff e PDF.";display:block;margin-top:7px;font-size:.95rem;font-weight:650;color:var(--muted);letter-spacing:0;text-transform:none;}
.quick-grid{gap:14px;}
.quick-card{position:relative;overflow:hidden;}
.quick-card:after{content:"›";position:absolute;right:18px;top:18px;width:28px;height:28px;border-radius:999px;display:grid;place-items:center;background:rgba(215,164,45,.13);color:#ffe9a5;font-weight:950;}
@media(max-width:760px){
  .ng-disclosure{border-radius:18px;}
  .ng-disclosure-summary{padding:12px;min-height:66px;gap:10px;}
  .disclosure-main{gap:10px;}
  .disclosure-main strong{max-width:46vw;font-size:.98rem;}
  .disclosure-main small{font-size:.78rem;}
  .disclosure-action{padding:7px 9px;font-size:.68rem;letter-spacing:.035em;}
  .ng-disclosure-body{padding:0 12px 12px;}
  .team-profile-hero{align-items:flex-start;}
  .team-profile-meta{grid-template-columns:1fr;}
  .roster-clean-list{grid-template-columns:1fr;}
  .admin-player-list .row-actions,.admin-disclosure-list .row-actions{grid-template-columns:1fr;}
}
@media(max-width:420px){
  .disclosure-main strong{max-width:40vw;}
  .team-logo,.team-logo-fallback{width:46px;height:46px;border-radius:14px;}
  .team-logo.big,.team-logo-fallback.big{width:64px;height:64px;border-radius:20px;}
}

/* v26 - Workflow UI: gestione per squadra e per partita con progressive disclosure */
.admin-flow-page{align-items:start;}
.flow-sidebar,.flow-middle,.flow-editor,.flow-workspace{position:relative;}
.flow-sidebar{position:sticky;top:112px;max-height:calc(100vh - 132px);overflow:auto;}
.flow-list{display:grid;gap:10px;}
.flow-pick-btn,.match-pick-btn{
  width:100%;border:1px solid rgba(215,164,45,.22);border-radius:20px;background:linear-gradient(135deg,rgba(255,246,218,.06),rgba(255,246,218,.018));
  color:var(--text);text-align:left;cursor:pointer;display:grid;align-items:center;gap:12px;padding:12px;transition:transform .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease;
}
.flow-pick-btn{grid-template-columns:auto minmax(0,1fr) auto;}
.flow-pick-btn strong,.match-pick-btn strong{display:block;color:#fff8e7;line-height:1.15;overflow:hidden;text-overflow:ellipsis;}
.flow-pick-btn small,.match-pick-btn small{display:block;color:var(--muted);font-weight:750;line-height:1.25;margin-top:4px;}
.flow-pick-btn em,.match-pick-btn em{font-style:normal;justify-self:end;border:1px solid rgba(215,164,45,.30);background:rgba(215,164,45,.10);color:#ffe9a5;border-radius:999px;padding:7px 10px;font-size:.72rem;font-weight:950;text-transform:uppercase;letter-spacing:.05em;}
.flow-pick-btn:hover,.match-pick-btn:hover{transform:translateY(-1px);border-color:rgba(242,210,111,.58);box-shadow:0 16px 36px rgba(0,0,0,.20);}
.flow-pick-btn.active,.match-pick-btn.active{border-color:rgba(242,210,111,.76);background:linear-gradient(135deg,rgba(215,164,45,.25),rgba(255,246,218,.06));box-shadow:0 18px 46px rgba(215,164,45,.12),0 0 0 1px rgba(255,230,150,.12) inset;}
.flow-pick-btn.active em,.match-pick-btn.active em{background:linear-gradient(135deg,#b98218,#f2d26f);color:#151006;border-color:transparent;}
.flow-workspace-head{border:1px solid rgba(215,164,45,.20);border-radius:24px;padding:16px;background:radial-gradient(circle at 0 0,rgba(215,164,45,.18),transparent 55%),rgba(0,0,0,.14);}
.flow-workspace-head h2{margin:.35rem 0 0;font-size:clamp(1.5rem,3vw,2.3rem);letter-spacing:-.045em;}
.flow-accordion{display:grid;gap:12px;}
.match-pick-list{display:grid;gap:10px;}
.match-pick-btn{grid-template-columns:1fr;min-height:104px;}
.match-pick-round{display:inline-flex;width:max-content;border-radius:999px;padding:5px 9px;background:rgba(215,164,45,.14);border:1px solid rgba(215,164,45,.24);color:#ffe9a5;font-size:.72rem;font-weight:950;text-transform:uppercase;letter-spacing:.06em;}
.match-pick-btn strong span{color:var(--muted);font-weight:900;}
.match-pick-btn em{justify-self:start;margin-top:2px;}
.flow-editor .match-card{border:0;background:transparent;padding:0;box-shadow:none;}
.flow-editor .match-card>h3{font-size:clamp(1.25rem,2vw,1.7rem);letter-spacing:-.035em;margin:.55rem 0;}
.flow-editor .match-card>.muted{font-size:.94rem;}
.flow-editor .event-report-grid{grid-template-columns:1fr!important;}
.flow-editor .live-counters{grid-template-columns:repeat(2,minmax(0,1fr));}
.flow-editor .counter-card{min-height:92px;}
.flow-editor .sticky-save-panel{position:sticky;bottom:14px;z-index:4;background:linear-gradient(135deg,rgba(20,17,11,.96),rgba(9,8,5,.95));border:1px solid rgba(242,210,111,.24);border-radius:20px;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.35);}
.event-panel{border:1px solid rgba(215,164,45,.18);border-radius:20px;background:rgba(0,0,0,.12);padding:14px;}
.event-picker-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;}
.event-picker-grid .btn{align-self:end;}
@media(max-width:1180px){
  .match-flow-page .span-4{grid-column:span 12;}
  .match-flow-page{grid-template-columns:repeat(12,1fr);}
  .flow-sidebar{position:relative;top:auto;max-height:none;}
  .match-flow-page .flow-list{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));}
  .match-pick-list{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));}
  .flow-editor .event-report-grid{grid-template-columns:1fr 1fr!important;}
}
@media(max-width:980px){
  .admin-flow-page .span-4,.admin-flow-page .span-8{grid-column:span 12;}
  .flow-sidebar{position:relative;top:auto;max-height:none;}
  .flow-list{grid-template-columns:repeat(auto-fill,minmax(230px,1fr));}
}
@media(max-width:720px){
  .flow-list,.match-pick-list{grid-template-columns:1fr!important;}
  .flow-pick-btn{grid-template-columns:auto minmax(0,1fr);}
  .flow-pick-btn em{grid-column:2;justify-self:start;}
  .flow-workspace-head{padding:12px;border-radius:20px;}
  .flow-workspace-head .team-profile-hero{display:grid;grid-template-columns:auto 1fr;align-items:center;}
  .flow-editor .live-counters{grid-template-columns:repeat(2,1fr)!important;}
  .flow-editor .event-report-grid{grid-template-columns:1fr!important;}
  .event-picker-grid{grid-template-columns:1fr!important;}
  .flow-editor .sticky-save-panel .btn{width:100%;}
}
@media(max-width:420px){
  .flow-pick-btn,.match-pick-btn{border-radius:17px;padding:10px;}
  .flow-pick-btn small,.match-pick-btn small{font-size:.76rem;}
  .match-pick-btn{min-height:96px;}
}

/* v27 - Team detail, drag gironi e match task sheets */
.standings-team-row{cursor:pointer;transition:background .16s ease,transform .16s ease;}
.standings-team-row:hover,.standings-team-row:focus{background:rgba(215,164,45,.12);outline:2px solid rgba(242,210,111,.35);outline-offset:-2px;}
.team-modal-content{max-width:min(1120px,94vw);max-height:90vh;overflow:auto;padding:0;border:1px solid rgba(242,210,111,.26);background:radial-gradient(circle at top left,rgba(215,164,45,.20),transparent 42%),linear-gradient(135deg,#111007,#050504);}
.team-modal-toolbar,.match-task-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 20px;border-bottom:1px solid rgba(215,164,45,.20);position:sticky;top:0;z-index:5;background:linear-gradient(180deg,rgba(15,13,8,.98),rgba(15,13,8,.92));backdrop-filter:blur(14px);}
.pro-team-sheet{padding:20px;}
.pro-team-hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;align-items:center;padding:18px;border:1px solid rgba(242,210,111,.22);border-radius:28px;background:radial-gradient(circle at 0 0,rgba(215,164,45,.28),transparent 45%),rgba(255,246,218,.04);box-shadow:0 26px 70px rgba(0,0,0,.30);}
.pro-team-logo .team-logo.big,.pro-team-logo .team-logo-fallback.big{width:96px;height:96px;border-radius:26px;}
.pro-team-title h2{margin:.35rem 0 .25rem;font-size:clamp(2rem,5vw,4.2rem);line-height:.92;letter-spacing:-.07em;text-transform:uppercase;}
.pro-team-title p{margin:0;color:var(--muted);font-weight:800;}
.team-sheet-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0;}
.team-sheet-kpis>div{border:1px solid rgba(215,164,45,.20);border-radius:22px;padding:14px;background:linear-gradient(135deg,rgba(255,246,218,.05),rgba(255,246,218,.015));}
.team-sheet-kpis strong{display:block;color:#ffe9a5;font-size:clamp(1.5rem,4vw,2.6rem);line-height:1;}
.team-sheet-kpis span{color:var(--muted);font-weight:900;text-transform:uppercase;font-size:.72rem;letter-spacing:.07em;}
.team-sheet-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.team-sheet-panel{border:1px solid rgba(215,164,45,.18);border-radius:24px;background:rgba(0,0,0,.14);padding:16px;}
.team-sheet-panel h3{margin:0 0 12px;color:#fff8e7;letter-spacing:-.03em;}
.staff-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.staff-cards>div,.team-leader-row,.team-form-row{border:1px solid rgba(215,164,45,.14);border-radius:18px;padding:12px;background:rgba(255,246,218,.04);}
.staff-cards span,.staff-cards small{display:block;color:var(--muted);font-weight:850;font-size:.78rem;}
.staff-cards strong{display:block;margin:5px 0;color:#fff8e7;}
.team-leader-row,.team-form-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;}
.team-leader-row span,.team-form-row span,.team-form-row em{color:var(--muted);font-style:normal;font-weight:850;font-size:.84rem;}
.team-detail-roster{grid-template-columns:repeat(2,minmax(0,1fr));}
.team-detail-roster li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;}
.team-detail-roster li em{grid-column:1/-1;color:var(--muted);font-style:normal;font-size:.78rem;font-weight:800;}
.group-team-row.draggable-team{cursor:grab;touch-action:none;align-items:center;}
.group-team-row.draggable-team.dragging{opacity:.5;transform:scale(.98);}
.group-team-row.draggable-team.picked{border-color:rgba(242,210,111,.72);box-shadow:0 0 0 2px rgba(215,164,45,.18) inset,0 16px 30px rgba(215,164,45,.12);}
.group-column.drop-active{background:linear-gradient(135deg,rgba(215,164,45,.18),rgba(255,246,218,.04));border-color:rgba(242,210,111,.72);}
.group-drop-btn{width:100%;margin:10px 0;}
.group-drop-btn:disabled{opacity:.45;cursor:not-allowed;}
.match-task-content{max-width:min(980px,94vw);max-height:92vh;overflow:auto;padding:0;background:radial-gradient(circle at top right,rgba(215,164,45,.16),transparent 42%),linear-gradient(135deg,#121008,#060504);border:1px solid rgba(242,210,111,.25);}
#matchTaskBody{padding:18px;}
.match-command-center{display:grid;gap:14px;}
.match-command-hero{border:1px solid rgba(215,164,45,.22);border-radius:24px;padding:16px;background:radial-gradient(circle at 0 0,rgba(215,164,45,.22),transparent 50%),rgba(0,0,0,.14);}
.match-command-hero h3{font-size:clamp(1.4rem,3vw,2.2rem);letter-spacing:-.05em;margin:.55rem 0 .25rem;line-height:1.05;}
.match-command-hero h3 span{color:var(--muted);font-size:.75em;}
.match-action-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.match-action-card{border:1px solid rgba(215,164,45,.20);border-radius:22px;background:linear-gradient(135deg,rgba(255,246,218,.06),rgba(255,246,218,.015));color:var(--text);padding:16px;text-align:left;cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease;min-height:138px;}
.match-action-card span{font-size:1.6rem;display:block;margin-bottom:10px;}
.match-action-card strong{display:block;color:#fff8e7;font-size:1.05rem;margin-bottom:6px;}
.match-action-card small{color:var(--muted);font-weight:800;line-height:1.3;}
.match-action-card:hover,.match-action-card:focus{transform:translateY(-2px);border-color:rgba(242,210,111,.68);outline:none;background:linear-gradient(135deg,rgba(215,164,45,.20),rgba(255,246,218,.04));}
.match-action-card:disabled{opacity:.45;cursor:not-allowed;transform:none;}
.hidden-event-cache{display:none!important;}
.match-task-panel-body{background:rgba(255,246,218,.035);}
@media(max-width:820px){
  .team-modal-content,.match-task-content{width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;border-radius:0;}
  .team-modal-toolbar,.match-task-toolbar{padding:14px;padding-top:calc(14px + env(safe-area-inset-top));}
  .pro-team-sheet,#matchTaskBody{padding:14px;padding-bottom:calc(90px + env(safe-area-inset-bottom));}
  .pro-team-hero{grid-template-columns:auto 1fr;gap:12px;border-radius:22px;padding:13px;}
  .pro-team-logo .team-logo.big,.pro-team-logo .team-logo-fallback.big{width:72px;height:72px;border-radius:20px;}
  .team-sheet-kpis{grid-template-columns:repeat(2,1fr);gap:10px;}
  .team-sheet-grid{grid-template-columns:1fr;}
  .staff-cards{grid-template-columns:1fr;}
  .team-detail-roster{grid-template-columns:1fr;}
  .match-action-grid{grid-template-columns:1fr;}
  .match-action-card{min-height:104px;display:grid;grid-template-columns:auto 1fr;gap:0 12px;align-items:center;}
  .match-action-card span{grid-row:1/3;margin:0;}
  .match-action-card strong,.match-action-card small{margin:0;}
}

/* v28 - Mobile-first sheets: articoli con foto sopra e schermate operative dedicate */
@media(max-width:820px){
  .article-detail-editorial{display:flex!important;flex-direction:column!important;min-height:0!important;}
  .article-detail-editorial .article-detail-hero{width:100%!important;min-height:0!important;height:auto!important;max-height:none!important;padding:12px!important;}
  .article-detail-frame{width:100%!important;min-height:0!important;aspect-ratio:16/10!important;height:auto!important;border-radius:20px!important;padding:8px!important;}
  .article-detail-frame img.article-image,
  .article-detail-frame .article-image:not(.article-placeholder){width:100%!important;height:100%!important;max-width:100%!important;max-height:none!important;object-fit:contain!important;border-radius:16px!important;}
  .article-detail-frame .article-placeholder{width:100%!important;min-height:220px!important;aspect-ratio:16/10!important;}
  .article-detail-body{padding:16px 16px calc(100px + env(safe-area-inset-bottom,0px))!important;}
  .article-detail-body h2{font-size:clamp(1.7rem,9vw,2.7rem)!important;line-height:1!important;}
  .article-full-text{font-size:1.05rem!important;line-height:1.72!important;}
  .article-detail-backdrop-img{opacity:.45!important;filter:blur(22px) brightness(.45)!important;}
  .article-modal-toolbar{position:sticky!important;top:0!important;}
  .article-modal-toolbar h2{display:none!important;}
}
@media(max-width:430px){
  .article-detail-frame{aspect-ratio:16/11!important;}
  .article-detail-frame .article-placeholder{min-height:190px!important;}
}
.admin-players-modal{position:fixed!important;inset:0!important;z-index:9998!important;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);padding:clamp(12px,3vw,28px);}
.admin-players-modal.open{display:flex!important;}
.admin-players-content{width:min(1120px,100%);max-height:min(92vh,900px);overflow:auto;padding:0;border:1px solid rgba(242,210,111,.25);background:radial-gradient(circle at top left,rgba(215,164,45,.18),transparent 45%),linear-gradient(135deg,#111007,#050504);}
#playersTeamModalBody{padding:18px;}
@media(max-width:820px){
  .admin-players-modal{align-items:stretch;padding:0;}
  .admin-players-content{width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;border-radius:0;border:0;}
  #playersTeamModalBody{padding:14px;padding-bottom:calc(92px + env(safe-area-inset-bottom,0px));}
  .flow-accordion .ng-disclosure-body{padding:14px;}
  .flow-pick-btn{min-height:76px;}
  .match-task-content{width:100vw!important;height:100dvh!important;max-width:100vw!important;max-height:100dvh!important;border-radius:0!important;border:0!important;}
  .match-task-toolbar{position:sticky!important;top:0!important;}
  .match-command-center,.report-complete-form,.match-edit-form{max-width:100%;}
  .event-picker-grid{grid-template-columns:1fr!important;}
  .sticky-save-panel{position:sticky;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:6;background:rgba(8,7,4,.92);border:1px solid rgba(242,210,111,.20);border-radius:20px;padding:10px;backdrop-filter:blur(12px);}
}

/* v29 - Popup workflow stabile e drag gironi safe su mobile */
.match-list-modal{position:fixed!important;inset:0!important;z-index:9997!important;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);padding:clamp(12px,3vw,28px)}
.match-list-modal.open{display:flex!important}
.match-list-content{width:min(920px,100%);max-height:min(88vh,820px);overflow:auto;padding:0;border:1px solid rgba(242,210,111,.25);background:radial-gradient(circle at top left,rgba(215,164,45,.18),transparent 45%),linear-gradient(135deg,#111007,#050504)}
#matchListBody{padding:18px;display:grid;gap:10px}
.selected-team-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;border:1px solid rgba(215,164,45,.18);border-radius:20px;background:rgba(255,246,218,.045);padding:14px}
.selected-team-summary strong,.selected-team-summary small{display:block}.selected-team-summary small{color:var(--muted);font-weight:800;margin-top:2px}
.match-task-toolbar h2{margin:0;font-size:clamp(1.15rem,2.6vw,1.7rem);letter-spacing:-.035em;line-height:1.05;max-width:70ch}
.report-head.clean{display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid rgba(215,164,45,.18);border-radius:20px;background:rgba(255,246,218,.04);padding:14px 16px;margin-bottom:14px}.report-head.clean h3{margin:0 0 4px}.report-head.clean p{margin:0}
.sticky-save-panel{align-items:center}.sticky-save-panel .btn{min-height:48px}
.group-team-row.draggable-team{touch-action:pan-y;user-select:none}.group-team-row.draggable-team.touch-fallback{cursor:default;touch-action:pan-y}.group-team-row.draggable-team.touch-fallback select,.group-team-row.draggable-team.touch-fallback button{touch-action:manipulation}
@media(max-width:820px){
  .match-list-modal{align-items:stretch;padding:0}.match-list-content{width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;border-radius:0;border:0}.match-list-content .match-task-toolbar{position:sticky;top:0}.match-list-content #matchListBody{padding:14px;padding-bottom:calc(92px + env(safe-area-inset-bottom,0px))}
  .selected-team-summary{grid-template-columns:auto 1fr;border-radius:18px}.selected-team-summary .btn{grid-column:1/-1;width:100%}
  .match-task-toolbar h2{font-size:1.15rem;line-height:1.1}.match-task-toolbar .btn{min-height:42px;padding-inline:16px}
  .match-task-content #matchTaskBody{padding-top:14px!important}.match-command-hero{padding:13px;border-radius:20px}.match-command-hero h3{font-size:1.55rem}.match-command-hero p{font-size:.92rem}.report-head.clean{display:grid;grid-template-columns:1fr auto;padding:12px;border-radius:18px}.report-head.clean h3{font-size:1.35rem}
  .event-panel.match-task-panel-body{border-radius:20px}.sticky-save-panel{grid-template-columns:1fr!important;bottom:calc(8px + env(safe-area-inset-bottom,0px))!important}.group-team-row.draggable-team{touch-action:pan-y!important;cursor:default}.group-team-row.draggable-team[draggable="true"]{touch-action:pan-y!important}.group-drop-zone{min-height:68px}.group-drop-btn{min-height:44px}
}

/* v30 - Match modal return + mobile group move sheet */
.group-move-modal{position:fixed!important;inset:0!important;z-index:10001!important;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);padding:clamp(12px,3vw,28px)}
.group-move-modal.open{display:flex!important}
.group-move-content{width:min(640px,100%);max-height:min(88vh,760px);overflow:auto;padding:0;border:1px solid rgba(242,210,111,.25);background:radial-gradient(circle at top right,rgba(215,164,45,.18),transparent 42%),linear-gradient(135deg,#121008,#050504)}
.group-move-body{padding:18px;display:grid;gap:14px}.group-move-actions{display:grid;gap:10px}.match-action-card.compact{min-height:70px;text-align:left}.match-action-card.compact small{display:block;margin-top:5px}.danger-soft{border-color:rgba(229,83,95,.45)!important;background:rgba(229,83,95,.08)!important}
#closeMatchTaskModal::after{content:''}.match-task-modal .match-task-toolbar{gap:10px}.match-task-modal .btn.danger{min-width:120px}
@media(max-width:820px){
  .group-move-modal{align-items:stretch;padding:0}.group-move-content{width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;border:0;border-radius:0}.group-move-body{padding:14px;padding-bottom:calc(96px + env(safe-area-inset-bottom,0px))}.group-move-actions{grid-template-columns:1fr}.match-action-card.compact{min-height:76px;border-radius:20px}
  .group-team-row.touch-fallback{grid-template-columns:auto minmax(0,1fr) auto!important}.group-team-row.touch-fallback select{display:none}.group-team-row.touch-fallback .tiny-label::after{content:' · usa Sposta';color:var(--gold-2)}
}

/* v31 - azioni referto nel solo pannello cartellini */
.action-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.action-row .btn{flex:1 1 180px}
@media(max-width:720px){.action-row{display:grid;grid-template-columns:1fr}.action-row .btn{width:100%}}

/* v32 · single contextual save for match workflow */
.inline-note{
  border:1px solid rgba(214,170,58,.32);
  background:linear-gradient(135deg,rgba(214,170,58,.12),rgba(255,255,255,.03));
  color:var(--muted,#d8d0b6);
  border-radius:16px;
  padding:12px 14px;
  line-height:1.45;
  font-weight:700;
}
.draft-status{
  display:inline-flex;
  margin-top:10px;
  color:#f1d36b;
  font-weight:900;
  letter-spacing:.02em;
}
.match-context-savebar{
  margin-top:18px;
  padding:16px;
  border:1px solid rgba(214,170,58,.34);
  border-radius:24px;
  background:linear-gradient(180deg,rgba(214,170,58,.16),rgba(255,255,255,.04));
  display:grid;
  grid-template-columns:minmax(180px,1fr) minmax(160px,.75fr);
  gap:12px;
  align-items:center;
  box-shadow:0 18px 45px rgba(0,0,0,.26);
}
.match-context-savebar .btn{min-height:52px;font-size:1rem;border-radius:18px}
.match-context-savebar small{
  grid-column:1/-1;
  color:var(--muted,#d8d0b6);
  font-weight:800;
  letter-spacing:.01em;
}
@media (max-width: 720px){
  .match-context-savebar{
    position:sticky;
    bottom:calc(10px + env(safe-area-inset-bottom));
    z-index:20;
    grid-template-columns:1fr;
    padding:12px;
    border-radius:22px;
    backdrop-filter:blur(14px);
  }
  .match-context-savebar .btn{width:100%;min-height:56px}
}

/* v34 - referto: un solo salvataggio contestuale, nessuna action bar fissa */
.match-context-savebar{
  position:static!important;
  bottom:auto!important;
  z-index:auto!important;
  margin-top:14px!important;
}
.match-context-savebar-head{
  grid-column:1/-1;
  display:grid;
  gap:4px;
  padding:2px 2px 4px;
}
.match-context-savebar-head strong{
  color:#fff8e7;
  font-size:1.05rem;
  letter-spacing:-.02em;
}
.match-context-savebar-head small,.match-context-help{
  color:var(--muted,#d8d0b6);
  font-weight:800;
}
@media(max-width:720px){
  .match-context-savebar{
    position:static!important;
    bottom:auto!important;
    z-index:auto!important;
    backdrop-filter:none!important;
    margin-top:10px!important;
  }
}


/* v35: stato partita semanticamente chiaro */
.match-status-badge{font-variant-numeric:tabular-nums;letter-spacing:.01em;border:1px solid transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.score-badge.match-status-badge.is-played,.match-status-badge.is-played{background:linear-gradient(135deg,#d7a42d,#f4d878)!important;color:#03140c!important;border-color:rgba(215,164,45,.45)!important}
.score-badge.match-status-badge.is-pending,.match-status-badge.is-pending{background:linear-gradient(135deg,#991b1b,#dc2626)!important;color:#fff!important;border-color:rgba(248,113,113,.65)!important;text-shadow:0 1px 1px rgba(0,0,0,.28)!important}
.match-pick-btn .match-status-badge{justify-self:end;align-self:center;padding:7px 11px;border-radius:999px;font-size:.82rem;font-style:normal;font-weight:950;white-space:nowrap}
@media(max-width:720px){.match-pick-btn .match-status-badge{justify-self:start}.score-badge.match-status-badge{min-width:0;width:max-content;max-width:100%}}

/* v40 - Public match detail: sport-app inspired clean dialog */
.public-match-modal .modal-content{
  width:min(980px,calc(100vw - 28px));
  max-height:min(92vh,900px);
  overflow:auto;
  padding:0;
  border-radius:30px;
  border:1px solid rgba(242,210,111,.34);
  background:radial-gradient(circle at top left,rgba(242,210,111,.22),transparent 36%),linear-gradient(150deg,#090907 0%,#15130b 54%,#070707 100%);
}
.public-match-modal .section-title{
  position:sticky;
  top:0;
  z-index:3;
  padding:18px 22px;
  margin:0;
  align-items:center;
  background:linear-gradient(180deg,rgba(7,7,7,.96),rgba(7,7,7,.72));
  backdrop-filter:blur(14px);
  border-bottom:1px solid rgba(242,210,111,.16);
}
.public-match-modal .section-title h2{font-size:clamp(1.15rem,2.2vw,1.75rem);}
.public-match-modal #matchModalBody{padding:22px;}
.public-match-detail-card{display:grid;gap:18px;}
.public-match-hero{
  position:relative;
  overflow:hidden;
  border:1px solid rgba(242,210,111,.28);
  border-radius:28px;
  padding:20px;
  background:
    radial-gradient(circle at 50% -20%,rgba(255,238,138,.25),transparent 34%),
    linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025));
  box-shadow:0 24px 70px rgba(0,0,0,.32);
}
.public-match-hero:before{content:"";position:absolute;inset:auto -10% -45% -10%;height:62%;background:radial-gradient(ellipse at center,rgba(215,164,45,.18),transparent 64%);pointer-events:none;}
.public-match-hero-top{display:flex;justify-content:space-between;gap:12px;align-items:center;position:relative;z-index:1;}
.public-scoreboard{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center;margin:26px 0 20px;position:relative;z-index:1;}
.public-score-team{display:grid;gap:10px;justify-items:center;text-align:center;min-width:0;}
.public-score-team .team-logo,.public-score-team .team-logo-fallback{width:72px;height:72px;border-radius:22px;box-shadow:0 14px 35px rgba(0,0,0,.35);}
.public-score-team strong{font-size:clamp(1.15rem,2.5vw,2rem);letter-spacing:-.04em;line-height:1.05;max-width:100%;overflow-wrap:anywhere;}
.public-score-center{display:grid;grid-template-columns:auto auto auto;gap:12px;align-items:center;padding:15px 20px;border-radius:26px;background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 0 0 1px rgba(242,210,111,.08);}
.public-score-center span{font-size:clamp(2.4rem,5.2vw,4.4rem);font-weight:950;line-height:.9;font-variant-numeric:tabular-nums;color:#fff7d8;}
.public-score-center em{font-style:normal;text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;color:#d7c58e;font-weight:950;align-self:center;}
.public-match-meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;position:relative;z-index:1;}
.public-match-meta-grid span{display:grid;gap:4px;padding:13px 14px;border-radius:18px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08);}
.public-match-meta-grid small{text-transform:uppercase;letter-spacing:.09em;color:#bda85f;font-weight:950;font-size:.7rem;}
.public-match-meta-grid strong{color:#fff;font-size:.95rem;}
.public-match-panels{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
.public-match-panel{border:1px solid rgba(242,210,111,.20);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));padding:16px;min-height:130px;}
.public-match-panel .panel-title{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.public-match-panel .panel-title>span{width:38px;height:38px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);}
.public-match-panel h3{margin:0;font-size:1rem;letter-spacing:-.02em;}
.public-match-event-item{display:flex;gap:10px;align-items:center;padding:10px;border-radius:16px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.06);margin-top:8px;}
.event-dot{width:32px;height:32px;border-radius:12px;display:grid;place-items:center;font-size:.95rem;background:rgba(215,164,45,.14);color:#ccffed;}
.event-dot.yellow{background:rgba(255,209,102,.18);color:#ffe8a3;}
.event-dot.red{background:rgba(220,38,38,.20);color:#ffc7c7;}
.public-match-event-item strong{display:block;}
.public-match-event-item small{display:block;color:var(--muted);margin-top:2px;font-weight:800;}
.public-match-empty{border:1px dashed rgba(255,255,255,.14);border-radius:16px;padding:13px;color:var(--muted);background:rgba(0,0,0,.18);font-weight:800;}
.match-card.clickable{transition:transform .16s ease,border-color .16s ease,background .16s ease;}
.match-card.clickable:hover{transform:translateY(-1px);background:linear-gradient(180deg,rgba(255,246,218,.09),rgba(255,246,218,.035));}
@media(max-width:720px){
  .public-match-modal{align-items:stretch;padding:0;}
  .public-match-modal .modal-content{width:100vw;height:100dvh;max-height:none;border-radius:0;border:0;}
  .public-match-modal .section-title{padding:14px 14px;padding-top:calc(14px + env(safe-area-inset-top));}
  .public-match-modal #matchModalBody{padding:14px;padding-bottom:calc(22px + env(safe-area-inset-bottom));}
  .public-match-hero{border-radius:22px;padding:15px;}
  .public-match-hero-top{align-items:flex-start;}
  .public-scoreboard{grid-template-columns:1fr;gap:12px;margin:18px 0;}
  .public-score-center{grid-template-columns:auto auto auto;justify-content:center;order:2;width:100%;}
  .public-score-home{order:1;}
  .public-score-away{order:3;}
  .public-score-team{grid-template-columns:auto 1fr;justify-items:start;text-align:left;width:100%;padding:10px;border-radius:18px;background:rgba(0,0,0,.20);border:1px solid rgba(255,255,255,.06);}
  .public-score-team .team-logo,.public-score-team .team-logo-fallback{width:54px;height:54px;border-radius:17px;}
  .public-score-team strong{font-size:1.35rem;}
  .public-match-meta-grid,.public-match-panels{grid-template-columns:1fr;}
}

/* v41: dettaglio partita anche nel tabellone pubblico */
.bracket-detail-trigger{cursor:pointer;transition:transform .18s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease}
.bracket-detail-trigger:hover,.bracket-detail-trigger:focus-visible{transform:translateY(-1px);border-color:rgba(242,210,111,.62);box-shadow:0 18px 42px rgba(0,0,0,.32),0 0 0 1px rgba(242,210,111,.16);outline:none;background:linear-gradient(180deg,rgba(255,246,218,.09),rgba(255,246,218,.045))}
.bracket-match-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.bracket-match-head .bracket-meta{margin-bottom:0}.bracket-open-hint{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#111;background:linear-gradient(135deg,var(--gold),#fff385);border-radius:999px;padding:4px 8px;font-weight:900}.bracket-list-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px}.bracket-list-footer small{margin:0}.bracket-list-footer span{font-size:.72rem;font-weight:900;border-radius:999px;padding:4px 8px;background:rgba(242,210,111,.16);color:var(--gold)}
@media(max-width:720px){.bracket-detail-trigger:hover{transform:none}.bracket-open-hint{display:none}.bracket-list-footer{align-items:flex-start;flex-direction:column;gap:6px}}


/* v42 - Squadra preferita locale */
.favorite-team-home{border-color:rgba(255,224,112,.35);background:radial-gradient(circle at top left,rgba(255,224,112,.16),transparent 42%),linear-gradient(135deg,rgba(27,23,8,.95),rgba(8,8,6,.96));}
.favorite-empty-card,.favorite-team-dashboard{display:grid;gap:16px;}
.favorite-empty-card{grid-template-columns:minmax(0,1fr) auto;align-items:center;}
.favorite-team-hero{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;}
.favorite-team-hero h2{margin:2px 0 4px;font-size:clamp(1.7rem,4vw,2.8rem);}
.favorite-team-hero p{margin:0;color:var(--muted);font-weight:800;}
.favorite-remove{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-size:1.5rem;font-weight:900;cursor:pointer;}
.favorite-remove:hover{border-color:rgba(255,107,107,.8);background:rgba(255,107,107,.18);}
.favorite-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.favorite-kpis span{display:grid;gap:3px;padding:14px;border-radius:18px;border:1px solid rgba(255,224,112,.18);background:rgba(255,255,255,.045);color:var(--muted);font-weight:900;text-transform:uppercase;font-size:.78rem;letter-spacing:.04em;}
.favorite-kpis strong{color:#fff;font-size:1.55rem;line-height:1;}
.favorite-team-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.favorite-team-grid>div{display:grid;gap:6px;padding:14px;border-radius:20px;background:rgba(0,0,0,.24);border:1px solid rgba(255,224,112,.16);}
.favorite-team-grid span{color:var(--gold-2);font-weight:950;text-transform:uppercase;font-size:.76rem;letter-spacing:.08em;}
.favorite-team-grid small{color:var(--muted);font-weight:800;}
.favorite-team-btn.active{background:linear-gradient(135deg,#fff176,#d7a42d);color:#171006;border-color:transparent;box-shadow:0 0 0 3px rgba(255,224,112,.12);}
.favorite-team-btn{white-space:nowrap;}
.is-favorite-team{box-shadow:inset 4px 0 0 rgba(255,224,112,.95),0 0 0 1px rgba(255,224,112,.24)!important;background:linear-gradient(90deg,rgba(255,224,112,.12),rgba(255,255,255,.02))!important;}
tr.is-favorite-team td:first-child{position:relative;}
tr.is-favorite-team td:first-child:before{content:'★';position:absolute;left:5px;top:50%;transform:translateY(-50%);color:#ffe070;font-size:.8rem;}
.is-favorite-match{outline:2px solid rgba(255,224,112,.45);box-shadow:0 0 0 5px rgba(255,224,112,.08)!important;}
.is-favorite-match:before{content:'★ La tua squadra';display:inline-flex;align-self:flex-start;margin:0 0 8px;padding:6px 10px;border-radius:999px;background:rgba(255,224,112,.16);color:#ffe070;border:1px solid rgba(255,224,112,.32);font-weight:950;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;}
.disclosure-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
.favorite-hero-action{margin-top:12px;}
@media (max-width: 720px){
  .favorite-empty-card{grid-template-columns:1fr;}
  .favorite-team-hero{grid-template-columns:auto minmax(0,1fr);}
  .favorite-remove{grid-column:1/-1;width:100%;}
  .favorite-kpis,.favorite-team-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
  .disclosure-actions{width:100%;justify-content:flex-start;}
  .favorite-team-btn{min-height:42px;}
}


/* v43 · Simulazione torneo */
.simulation-modal{max-width:640px;width:min(94vw,640px)}
.site-header .actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
#simulateTournamentBtn{box-shadow:0 10px 26px rgba(214,167,79,.22)}
@media (max-width:760px){
  .site-header .actions{width:100%;justify-content:stretch;display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .site-header .actions .btn{width:100%}
  .simulation-modal{width:100%;max-width:none;height:auto;max-height:92vh;overflow:auto;border-radius:24px 24px 0 0;margin-top:auto}
}

/* v44 - Admin giocatori: zona sicura per svuotare il roster */
.roster-danger-zone{
  margin-top:14px;
  padding:14px;
  border:1px solid rgba(185,28,28,.28);
  background:linear-gradient(135deg,rgba(185,28,28,.08),rgba(255,255,255,.04));
  border-radius:18px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}
.roster-danger-zone strong{display:block;font-size:.95rem;color:#fff;}
.roster-danger-zone small{display:block;margin-top:3px;color:rgba(255,255,255,.66);line-height:1.35;}
.roster-danger-zone .btn{white-space:nowrap;}
.roster-danger-zone .btn:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(1);}
@media (max-width:720px){
  .roster-danger-zone{align-items:stretch;flex-direction:column;}
  .roster-danger-zone .btn{width:100%;min-height:46px;}
}

/* v46 - clear report buttons inside the match picker */
.match-pick-row{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:10px;
  align-items:stretch;
}
.match-pick-row .match-pick-btn{width:100%;height:100%;}
.match-clear-mini{
  align-self:center;
  white-space:nowrap;
  min-width:92px;
}
.match-clear-mini:disabled{
  opacity:.42;
  cursor:not-allowed;
  filter:grayscale(.45);
  transform:none!important;
}
@media(max-width:720px){
  .match-pick-row{grid-template-columns:1fr;gap:8px;}
  .match-clear-mini{width:100%;min-height:42px;}
}

.admin-danger-zone{
  margin-top:14px;
  padding:12px;
  border:1px solid rgba(173,28,28,.24);
  border-radius:18px;
  background:linear-gradient(180deg,rgba(173,28,28,.08),rgba(173,28,28,.03));
  display:grid;
  gap:8px;
}
.admin-danger-zone small{
  color:var(--muted);
  line-height:1.35;
}
.btn.block{width:100%;justify-content:center;}
@media(max-width:760px){
  .admin-danger-zone{border-radius:16px;margin-top:12px;}
  .admin-danger-zone .btn{min-height:46px;}
}

/* v48 - gestione partita: azione finale unica, nessun pulsante pulisci nel pannello */
.match-context-savebar:has(.match-save-only){
  grid-template-columns:1fr!important;
}
.match-context-savebar .match-save-only{
  width:100%;
  max-width:560px;
  justify-self:center;
}
@media(max-width:720px){
  .match-context-savebar .match-save-only{max-width:none;justify-self:stretch;}
}

/* v49 · Contrasto bottone Apri scheda squadra preferita */
.favorite-team-home [data-team-detail],
.favorite-team-home .row-actions [data-team-detail].btn,
.favorite-team-home .row-actions [data-team-detail].btn.primary{
  color:#fff!important;
  background:linear-gradient(135deg,rgba(215,164,45,.34),rgba(16,13,7,.86))!important;
  border:1px solid rgba(255,224,112,.66)!important;
  text-shadow:0 1px 2px rgba(0,0,0,.72);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 0 0 1px rgba(255,224,112,.10),0 12px 30px rgba(0,0,0,.24)!important;
}
.favorite-team-home [data-team-detail]:hover,
.favorite-team-home .row-actions [data-team-detail].btn:hover{
  background:linear-gradient(135deg,rgba(255,224,112,.28),rgba(34,26,10,.94))!important;
  color:#fff!important;
}
.favorite-team-home [data-team-detail]:focus-visible{
  outline:3px solid rgba(255,255,255,.82);
  outline-offset:3px;
}

/* v50 - Favorite team responsive hardening */
.favorite-team-home,
.favorite-team-home *{box-sizing:border-box;}
.favorite-team-dashboard{min-width:0;overflow:hidden;}
.favorite-team-hero{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;}
.favorite-team-hero > div{min-width:0;}
.favorite-team-hero h2,
.favorite-team-hero p{overflow-wrap:anywhere;word-break:normal;}
.favorite-team-home .row-actions{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  align-items:stretch;
}
.favorite-team-home .row-actions .btn{
  width:100%;
  min-width:0;
  min-height:52px;
  padding-inline:16px;
  white-space:normal;
  line-height:1.15;
  text-align:center;
}
.favorite-team-home .btn,
.favorite-team-btn{overflow-wrap:anywhere;}
.favorite-team-grid > div{min-width:0;}
.favorite-team-grid strong,
.favorite-team-grid small{overflow-wrap:anywhere;}
.favorite-team-btn{
  max-width:100%;
  min-width:0;
  justify-content:center;
  text-align:center;
  white-space:normal;
  line-height:1.08;
}
.disclosure-actions{
  min-width:0;
  flex:0 1 auto;
}
.disclosure-actions .favorite-team-btn{
  flex:0 1 150px;
}
.ng-disclosure-summary{
  gap:12px;
}
.ng-disclosure-summary .disclosure-main,
.ng-disclosure-summary .disclosure-main > span{
  min-width:0;
}
.ng-disclosure-summary .disclosure-main strong,
.ng-disclosure-summary .disclosure-main small{
  overflow-wrap:anywhere;
}
.search-team-result .row-actions{
  min-width:0;
  flex-wrap:wrap;
}
.search-team-result .favorite-team-btn,
.search-team-result .btn{
  min-width:0;
  white-space:normal;
}
@media (max-width: 720px){
  .favorite-team-home{padding:14px!important;border-radius:22px;}
  .favorite-empty-card{grid-template-columns:1fr;gap:14px;}
  .favorite-empty-card .btn{width:100%;min-height:50px;}
  .favorite-team-hero{
    grid-template-columns:auto minmax(0,1fr);
    gap:12px;
    align-items:start;
  }
  .favorite-team-hero .team-logo.big,
  .favorite-team-hero .team-logo-fallback.big{
    width:58px;
    height:58px;
    border-radius:18px;
  }
  .favorite-team-hero h2{font-size:clamp(1.35rem,7vw,2rem);line-height:1.05;}
  .favorite-team-hero p{font-size:.9rem;line-height:1.35;}
  .favorite-remove{
    grid-column:1/-1;
    width:100%;
    min-height:44px;
    font-size:1rem;
  }
  .favorite-remove::before{content:'Rimuovi preferita';font-size:.9rem;margin-right:8px;}
  .favorite-kpis{
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:10px;
  }
  .favorite-kpis span{padding:12px;border-radius:17px;font-size:.7rem;}
  .favorite-kpis strong{font-size:1.35rem;}
  .favorite-team-grid{
    grid-template-columns:1fr;
    gap:10px;
  }
  .favorite-team-grid > div{padding:13px;border-radius:18px;}
  .favorite-team-home .row-actions{
    grid-template-columns:1fr;
    gap:10px;
  }
  .favorite-team-home .row-actions .btn{
    min-height:50px;
    font-size:.95rem;
  }
  .ng-disclosure-summary{
    display:grid!important;
    grid-template-columns:1fr!important;
    align-items:stretch!important;
    padding:12px!important;
  }
  .ng-disclosure-summary .disclosure-main{
    width:100%;
    display:grid;
    grid-template-columns:auto minmax(0,1fr);
    align-items:center;
  }
  .disclosure-actions{
    width:100%;
    display:grid!important;
    grid-template-columns:1fr 1fr;
    gap:8px;
    justify-content:stretch!important;
  }
  .disclosure-actions .favorite-team-btn,
  .disclosure-actions .disclosure-action{
    width:100%;
    min-height:44px;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    text-align:center;
    padding:10px 12px;
  }
  .search-team-result .row-actions{
    display:grid!important;
    grid-template-columns:1fr!important;
    width:100%;
    gap:8px;
  }
  .search-team-result .row-actions .btn,
  .search-team-result .row-actions .favorite-team-btn{
    width:100%;
    min-height:44px;
  }
}
@media (max-width: 420px){
  .favorite-team-home{padding:12px!important;}
  .favorite-kpis{grid-template-columns:1fr 1fr;}
  .disclosure-actions{grid-template-columns:1fr;}
}
@media (min-width: 721px) and (max-width: 1040px){
  .favorite-team-home .row-actions{grid-template-columns:1fr 1fr;}
  .disclosure-actions{justify-content:flex-start;}
}

/* v51 - Mobile-first public matches redesign */
.public-matches-shell{position:relative;overflow:visible;}
.public-matches-title{align-items:center;}
.native-match-filters{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important;padding:0!important;margin:-1px!important;}
.match-filter-toolbar{display:grid;gap:12px;margin:16px 0 18px;}
.match-filter-buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
.filter-chip-btn{appearance:none;border:1px solid rgba(215,164,45,.28);background:linear-gradient(180deg,rgba(255,246,218,.075),rgba(255,246,218,.03));color:var(--text);border-radius:18px;padding:12px 14px;min-height:66px;text-align:left;display:grid;gap:4px;cursor:pointer;box-shadow:inset 0 1px rgba(255,255,255,.05);}
.filter-chip-btn span{font-size:.72rem;text-transform:uppercase;letter-spacing:.11em;color:var(--muted);font-weight:950;}
.filter-chip-btn strong{font-size:.98rem;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.filter-chip-btn.active{border-color:rgba(255,218,104,.72);background:linear-gradient(135deg,rgba(255,218,104,.22),rgba(255,246,218,.06));box-shadow:0 10px 28px rgba(255,218,104,.08);}
.match-filter-resultbar{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-weight:900;font-size:.9rem;}
.public-match-list{gap:12px;}
.public-fixture-card{padding:14px 16px;display:grid;gap:13px;}
.match-card-head{display:flex;justify-content:space-between;gap:10px;align-items:center;}
.fixture-scoreline{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;padding:10px;border-radius:20px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.06);}
.fixture-team{display:flex;align-items:center;gap:10px;min-width:0;}
.fixture-team.away{justify-content:flex-end;text-align:right;}
.fixture-team strong{font-size:clamp(1rem,2vw,1.35rem);line-height:1.05;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fixture-center{min-width:72px;display:grid;place-items:center;text-align:center;padding:8px 10px;border-radius:16px;background:linear-gradient(180deg,rgba(255,218,104,.16),rgba(255,218,104,.04));border:1px solid rgba(255,218,104,.25);}
.fixture-center strong{font-size:1.08rem;line-height:1;color:#fff9d6;}
.fixture-center small{text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-size:.62rem;font-weight:950;margin-top:4px;}
.fixture-meta-row{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:.9rem;}
.fixture-meta-row span{padding:7px 9px;border:1px solid rgba(255,255,255,.07);border-radius:999px;background:rgba(255,255,255,.035);}
.fixture-events{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;color:#e8dcb2;font-size:.88rem;}
.fixture-events span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:14px;background:rgba(255,255,255,.04);padding:8px 10px;border:1px solid rgba(255,255,255,.06);}
.public-match-modal .modal-content{width:min(900px,calc(100vw - 24px));padding:0;border-radius:30px;background:linear-gradient(180deg,rgba(24,26,18,.97),rgba(5,7,6,.98));border-color:rgba(215,164,45,.3);}
.public-match-modal .section-title{padding:18px 20px;margin:0;border-bottom:1px solid rgba(215,164,45,.2);}
.public-match-detail-card{display:grid;gap:16px;padding:18px;}
.public-scoreboard{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:14px;}
.public-score-team{min-width:0;display:grid;justify-items:center;text-align:center;gap:8px;}
.public-score-team strong{font-size:clamp(1.2rem,4vw,2rem);line-height:1.05;overflow-wrap:anywhere;}
.public-score-center{display:grid;grid-template-columns:auto auto auto;gap:9px;align-items:center;justify-content:center;min-width:112px;padding:12px 16px;border-radius:20px;background:linear-gradient(135deg,rgba(255,218,104,.2),rgba(255,255,255,.04));border:1px solid rgba(255,218,104,.25);}
.public-score-center span{font-size:clamp(1.5rem,6vw,2.6rem);font-weight:950;color:#fff7c7;}
.public-score-center em{font-style:normal;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-size:.75rem;font-weight:950;}
.filter-sheet-modal{position:fixed;inset:0;z-index:140;background:rgba(0,0,0,.72);display:none;align-items:end;justify-content:center;padding:14px;}
.filter-sheet-modal.open{display:flex;}
.filter-sheet-panel{width:min(720px,100%);max-height:min(78vh,680px);overflow:auto;background:linear-gradient(180deg,rgba(24,26,18,.98),rgba(5,7,6,.99));border:1px solid rgba(215,164,45,.32);border-radius:28px;padding:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);}
.filter-sheet-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:14px;}
.filter-sheet-head h2{margin:4px 0 0;letter-spacing:-.03em;}
.filter-sheet-options{display:grid;gap:9px;}
.filter-option{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);color:var(--text);border-radius:18px;padding:13px 14px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;text-align:left;cursor:pointer;min-height:54px;}
.filter-option strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.filter-option em{font-style:normal;font-size:.72rem;font-weight:950;text-transform:uppercase;letter-spacing:.08em;color:#ffed9b;}
.filter-option.active{border-color:rgba(255,218,104,.75);background:linear-gradient(135deg,rgba(255,218,104,.18),rgba(255,255,255,.05));}
@media(max-width:720px){
  .public-matches-title h2{font-size:1.65rem;}
  .match-filter-buttons{grid-template-columns:1fr;}
  .filter-chip-btn{min-height:56px;border-radius:17px;padding:11px 13px;}
  .match-filter-resultbar{align-items:stretch;flex-direction:column;}
  .match-filter-resultbar .btn{width:100%;}
  .public-fixture-card{padding:12px;border-radius:20px;}
  .match-card-head{align-items:flex-start;}
  .match-card-head .pill{max-width:62%;white-space:normal;line-height:1.2;}
  .fixture-scoreline{grid-template-columns:minmax(0,1fr) 66px minmax(0,1fr);gap:8px;padding:9px;border-radius:18px;}
  .fixture-team{display:grid;justify-items:start;gap:6px;}
  .fixture-team.away{justify-items:end;}
  .fixture-team .team-logo,.fixture-team .team-logo-fallback{width:38px;height:38px;border-radius:12px;}
  .fixture-team strong{font-size:.98rem;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
  .fixture-center{min-width:0;padding:8px 6px;border-radius:14px;}
  .fixture-center strong{font-size:.95rem;}
  .fixture-center small{font-size:.55rem;}
  .fixture-meta-row{display:grid;grid-template-columns:1fr;gap:6px;font-size:.84rem;}
  .fixture-events{grid-template-columns:1fr;}
  .public-match-modal{padding:0;align-items:stretch;}
  .public-match-modal .modal-content{width:100%;height:100vh;max-height:100vh;border-radius:0;overflow:auto;}
  .public-match-modal .section-title{position:sticky;top:0;z-index:2;background:rgba(10,10,8,.96);backdrop-filter:blur(14px);padding:14px;}
  .public-match-detail-card{padding:14px;gap:14px;}
  .public-match-hero{border-radius:22px;padding:14px;}
  .public-scoreboard{grid-template-columns:minmax(0,1fr) 88px minmax(0,1fr);gap:8px;}
  .public-score-team .team-logo,.public-score-team .team-logo-fallback{width:50px;height:50px;border-radius:15px;}
  .public-score-team strong{font-size:1.02rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .public-score-center{grid-template-columns:1fr;padding:9px 6px;min-width:0;gap:2px;}
  .public-score-center span{font-size:1.45rem;line-height:1;}
  .public-score-center em{font-size:.58rem;}
  .public-match-meta-grid{grid-template-columns:1fr;}
  .public-match-panels{grid-template-columns:1fr;}
  .filter-sheet-modal{align-items:stretch;padding:0;}
  .filter-sheet-panel{width:100%;max-height:100vh;height:100vh;border-radius:0;padding:16px 14px 24px;}
  .filter-sheet-head{position:sticky;top:0;z-index:2;background:linear-gradient(180deg,rgba(18,18,12,.98),rgba(18,18,12,.92));padding-bottom:12px;}
  .filter-option{min-height:58px;border-radius:18px;}
}

/* v52 - Full site senior review: sports UX, cockpit and performance polish */
:root{--ng-success:#21d07a;--ng-danger:#d82135;--ng-blue:#7cc7ff;}
.card,.match-card,.quick-card,.team-disclosure,.article-card{content-visibility:auto;contain-intrinsic-size:1px 260px;}
.public-match-center{display:grid;gap:12px;margin:12px 0 16px;}
.match-center-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px;border:1px solid rgba(215,164,45,.24);border-radius:24px;background:radial-gradient(circle at 15% 0%,rgba(255,218,104,.18),transparent 34%),linear-gradient(135deg,rgba(255,255,255,.065),rgba(255,255,255,.025));box-shadow:0 20px 60px rgba(0,0,0,.18);}
.match-center-hero h3{margin:4px 0 5px;font-size:clamp(1.15rem,2.5vw,1.9rem);letter-spacing:-.04em;}
.match-center-hero p{margin:0;color:var(--muted);font-weight:800;}
.match-center-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;min-width:270px;}
.match-center-kpis span{display:grid;gap:2px;text-align:center;border-radius:18px;border:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.22);padding:10px 12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-size:.68rem;font-weight:950;}
.match-center-kpis strong{font-size:1.45rem;color:#fff;letter-spacing:-.04em;}
.match-preset-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;}
.match-preset{appearance:none;border:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.022));color:var(--text);border-radius:19px;padding:11px 12px;display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"icon title" "icon sub";gap:1px 9px;align-items:center;text-align:left;cursor:pointer;min-height:58px;transition:transform .16s ease,border-color .16s ease,background .16s ease;}
.match-preset:hover,.match-preset:focus-visible{transform:translateY(-1px);border-color:rgba(255,218,104,.58);outline:none;}
.match-preset.active{background:linear-gradient(135deg,rgba(255,218,104,.22),rgba(255,255,255,.04));border-color:rgba(255,218,104,.72);}
.match-preset span{grid-area:icon;width:34px;height:34px;display:grid;place-items:center;border-radius:13px;background:rgba(255,218,104,.13);font-weight:950;color:#fff5c8;}
.match-preset strong{grid-area:title;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.match-preset small{grid-area:sub;color:var(--muted);font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.public-match-actions{display:grid;grid-template-columns:minmax(0,260px);justify-content:center;margin-top:2px;}
.public-match-detail-card{scroll-padding-bottom:24px;}
.public-score-team{min-width:0;}
.public-score-team strong{max-width:100%;}
.fixture-center,.public-score-center{box-shadow:inset 0 1px rgba(255,255,255,.08);}
.match-status-badge.is-played{background:rgba(33,208,122,.16)!important;border-color:rgba(33,208,122,.5)!important;color:#bfffe0!important;}
.match-status-badge.is-pending{background:rgba(216,33,53,.19)!important;border-color:rgba(216,33,53,.55)!important;color:#ffd2d6!important;}
.admin-cockpit{display:grid;gap:14px;}
.admin-cockpit-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding:16px;border:1px solid rgba(215,164,45,.22);border-radius:24px;background:linear-gradient(135deg,rgba(255,218,104,.12),rgba(255,255,255,.035));}
.admin-cockpit-head h3{margin:5px 0 5px;font-size:1.35rem;}
.admin-cockpit-head p{margin:0;}.admin-cockpit-head>strong{font-size:2.2rem;color:#fff3b8;letter-spacing:-.06em;}
.admin-cockpit-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
.admin-cockpit-grid a{display:grid;gap:6px;text-decoration:none;color:var(--text);border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);border-radius:20px;padding:14px;min-height:112px;}
.admin-cockpit-grid a:hover,.admin-cockpit-grid a:focus-visible{border-color:rgba(255,218,104,.5);outline:none;background:rgba(255,218,104,.07);}
.admin-cockpit-grid span{text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-size:.72rem;font-weight:950;}.admin-cockpit-grid strong{font-size:1.18rem;line-height:1.1;}.admin-cockpit-grid small{color:var(--muted);font-weight:800;}
@media(max-width:900px){.match-center-hero{grid-template-columns:1fr}.match-center-kpis{min-width:0}.match-preset-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-cockpit-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
@media(max-width:720px){
  .public-match-center{margin-top:10px;}
  .match-center-hero{border-radius:20px;padding:13px;}
  .match-center-kpis{grid-template-columns:repeat(3,minmax(0,1fr));}
  .match-center-kpis span{padding:9px 6px;font-size:.58rem;border-radius:15px;}
  .match-center-kpis strong{font-size:1.1rem;}
  .match-preset-grid{grid-template-columns:1fr 1fr;gap:8px;}
  .match-preset{min-height:55px;border-radius:16px;padding:9px 10px;}
  .match-preset span{width:30px;height:30px;border-radius:11px;}
  .public-match-actions{grid-template-columns:1fr;}
  .public-scoreboard{grid-template-columns:minmax(0,1fr) 78px minmax(0,1fr)!important;align-items:start;}
  .public-score-team{justify-items:center;gap:7px;}
  .public-score-team strong{font-size:.95rem!important;line-height:1.05;min-height:2.1em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .public-score-center{position:sticky;top:72px;z-index:1;background:linear-gradient(135deg,rgba(255,218,104,.22),rgba(255,255,255,.06));}
  .admin-cockpit-head{align-items:flex-start;}.admin-cockpit-head>strong{font-size:1.8rem;}.admin-cockpit-grid{grid-template-columns:1fr;}.admin-cockpit-grid a{min-height:92px;}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important;}}


/* v54 - Rifinitura responsive richieste finali */
.match-center-eyebrow{
  display:inline-flex;
  margin:8px 0 2px;
  color:#fff7d8;
  font-weight:950;
  text-transform:uppercase;
  letter-spacing:.08em;
  font-size:.72rem;
  opacity:.9;
}
.match-center-kpis{
  grid-template-columns:repeat(2,minmax(112px,1fr));
}
.disclosure-actions{
  display:grid!important;
  grid-template-columns:1fr!important;
  gap:10px!important;
  width:min(180px,28vw);
  min-width:150px;
  align-items:stretch!important;
}
.disclosure-actions .favorite-team-btn,
.disclosure-actions .disclosure-action{
  width:100%!important;
  min-height:44px!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  padding:10px 14px!important;
  border-radius:999px!important;
  font-size:.82rem!important;
  font-weight:950!important;
  letter-spacing:.04em!important;
  text-transform:none!important;
  line-height:1.1!important;
  text-align:center!important;
  box-sizing:border-box!important;
  white-space:normal!important;
}
.disclosure-actions .disclosure-action{
  border:1px solid rgba(214,170,58,.55)!important;
  background:rgba(214,170,58,.13)!important;
  color:#fff8e7!important;
}
@media(max-width:760px){
  .match-center-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}
  .disclosure-actions{width:100%;min-width:0;grid-column:1/-1;grid-template-columns:repeat(2,minmax(0,1fr))!important;}
  .ng-disclosure-summary{grid-template-columns:1fr!important;}
}

/* v55 - Loghi reali nella selezione squadra partite */
.filter-option-media{width:38px;height:38px;display:grid;place-items:center;flex:0 0 38px;min-width:38px;}
.filter-option-media .team-logo,.filter-option-media .team-logo-fallback{width:34px;height:34px;border-radius:10px;object-fit:contain;background:rgba(0,0,0,.22);box-shadow:0 6px 16px rgba(0,0,0,.18);}
.filter-option-emoji{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:rgba(255,255,255,.08);font-size:1rem;}
.filter-option strong{align-self:center;}
@media(max-width:720px){
  .filter-option{min-height:64px;padding:12px 14px;}
  .filter-option-media{width:42px;height:42px;min-width:42px;}
  .filter-option-media .team-logo,.filter-option-media .team-logo-fallback,.filter-option-emoji{width:40px;height:40px;border-radius:12px;}
}


/* v56 - Match center spacing + mobile QA hardening */
.match-center-label-row{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:10px 12px;
  margin:0 0 10px;
}
.match-center-label-row .article-kicker,
.match-center-label-row .match-center-eyebrow{
  margin:0!important;
  flex:0 0 auto;
  line-height:1;
}
.match-center-label-row .match-center-eyebrow{
  padding-top:1px;
  max-width:100%;
}
.match-center-hero h3{
  clear:both;
}
@media(max-width:720px){
  .match-center-label-row{
    gap:8px;
    margin-bottom:12px;
  }
  .match-center-label-row .article-kicker{
    font-size:.68rem;
    padding:8px 13px;
  }
  .match-center-label-row .match-center-eyebrow{
    display:block;
    width:100%;
    font-size:.62rem;
    letter-spacing:.075em;
    line-height:1.25;
  }
  .match-center-hero h3{
    margin-top:2px;
    line-height:1.05;
  }
  .match-center-hero p{
    line-height:1.35;
  }
  .match-preset,
  .filter-option,
  .disclosure-actions .favorite-team-btn,
  .disclosure-actions .disclosure-action,
  .public-match-actions .btn{
    min-height:48px;
  }
  .public-match-modal .section-title,
  .filter-sheet-head{
    padding-left:max(14px,env(safe-area-inset-left));
    padding-right:max(14px,env(safe-area-inset-right));
  }
  .public-scoreboard,
  .fixture-card,
  .team-favorite-card,
  .public-match-card{
    max-width:100%;
    overflow:hidden;
  }
}
@media(max-width:430px){
  .match-center-hero{
    padding:12px;
  }
  .match-preset-grid{
    grid-template-columns:1fr;
  }
  .match-center-kpis{
    grid-template-columns:1fr 1fr;
  }
  .public-scoreboard{
    grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr)!important;
    gap:6px!important;
  }
}


/* v59 staff cleanup toolbar */
.section-toolbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:0 0 1rem;padding:1rem 1.1rem;border:1px solid rgba(214,181,82,.35);border-radius:1.25rem;background:rgba(255,255,255,.035)}
.section-toolbar strong{display:block;color:var(--text);font-weight:900;letter-spacing:.04em}
.section-toolbar small{display:block;color:var(--muted);margin-top:.2rem;line-height:1.35}
.danger-toolbar{border-color:rgba(255,83,83,.35);background:linear-gradient(135deg,rgba(255,83,83,.08),rgba(255,255,255,.025))}
@media (max-width:720px){.section-toolbar{align-items:stretch;flex-direction:column}.section-toolbar .btn{width:100%}.admin-team-disclosure .row-actions{display:grid;grid-template-columns:1fr;gap:.7rem}.admin-team-disclosure .row-actions .btn{width:100%}}


/* === v62 branding & customization === */
:root{
  --brand-primary:#fff45a;
  --brand-accent:#d2a63a;
  --brand-surface:#17170f;
  --brand-radius:24px;
  --primary:var(--brand-primary);
  --yellow:var(--brand-primary);
  --radius:var(--brand-radius);
}
body{background:radial-gradient(circle at 8% 0, color-mix(in srgb,var(--brand-primary) 18%, transparent), transparent 34rem),radial-gradient(circle at 88% 0, color-mix(in srgb,var(--brand-accent) 16%, transparent), transparent 34rem),#050504;}
.card,.modal-content,.ng-modal,.team-row,.match-card,.ng-disclosure{border-radius:var(--brand-radius)}
.brand-logo-img{width:56px;height:56px;border-radius:16px;object-fit:contain;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);padding:4px;filter:drop-shadow(0 0 16px color-mix(in srgb,var(--brand-primary) 35%, transparent));}
.brand-logo-img.big{width:76px;height:76px;border-radius:22px;}
.custom-preview-card{border:1px solid rgba(255,255,255,.14);border-radius:var(--brand-radius);padding:1.25rem;background:linear-gradient(135deg,color-mix(in srgb,var(--brand-primary) 16%, transparent),rgba(255,255,255,.035)),var(--brand-surface);box-shadow:0 24px 80px rgba(0,0,0,.28)}
.brand-preview{display:flex;gap:1rem;align-items:center;margin-bottom:1rem}.brand-preview h2{margin:.35rem 0 .2rem}.brand-preview p{margin:0;color:var(--muted)}
.preview-match{display:grid;gap:.3rem;border:1px solid color-mix(in srgb,var(--brand-accent) 45%, transparent);border-radius:calc(var(--brand-radius) - 6px);padding:1rem;background:rgba(0,0,0,.25);margin-bottom:1rem}.preview-match span{color:var(--brand-primary);font-weight:900;text-transform:uppercase;letter-spacing:.12em;font-size:.78rem}.preview-match strong{font-size:1.35rem}.preview-match small{color:var(--muted)}
input[type="color"]{height:48px;padding:6px;cursor:pointer}.custom-preview-card .btn{width:auto}
@media(max-width:720px){.brand-preview{align-items:flex-start}.custom-preview-card .row-actions{grid-template-columns:1fr}.brand-logo-img{width:54px;height:54px}}

/* v63 - report buttons senior UX */
.report-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;min-width:min(100%,760px);}
.report-pdf-btn{height:auto;min-height:64px;border-radius:18px;display:grid;align-content:center;justify-items:start;text-align:left;gap:2px;white-space:normal;}
.report-pdf-btn strong{font-size:.95rem;line-height:1.1;}
.report-pdf-btn small{font-size:.72rem;line-height:1.2;font-weight:850;opacity:.82;}
.report-pdf-btn:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(1);transform:none;}
.report-pdf-btn:disabled:hover{transform:none;}
@media(max-width:720px){.report-actions{grid-template-columns:1fr}.report-pdf-btn{width:100%;min-height:58px}}


/* v64 - mobile first polish for public match detail modal */
.public-match-modal .match-modal-toolbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}
.public-match-modal .match-modal-heading{min-width:0;flex:1 1 auto;}
.public-match-modal .match-modal-heading h2{margin:0;letter-spacing:-.04em;line-height:1.02;}
.public-match-modal .match-modal-close{
  flex:0 0 auto;
  width:auto;
  min-width:104px;
  padding:10px 16px;
  min-height:44px;
  box-shadow:0 10px 24px rgba(0,0,0,.18);
}
.public-match-modal .public-match-hero-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;}
.public-match-modal .public-match-hero-top .pill{
  flex:1 1 auto;
  min-width:0;
  white-space:normal;
  line-height:1.2;
  padding:10px 14px;
  border-radius:20px;
  font-size:.95rem;
  font-weight:900;
}
.public-match-modal .public-match-hero-top .match-status-badge{
  flex:0 0 auto;
  align-self:flex-start;
  white-space:nowrap;
}
.public-match-modal .public-scoreboard{gap:14px;}
.public-match-modal .public-score-team{
  padding:14px 12px;
  border-radius:22px;
  border:1px solid rgba(255,255,255,.07);
  background:rgba(0,0,0,.22);
}
.public-match-modal .public-score-team strong{
  display:block;
  max-width:100%;
  white-space:normal;
  overflow-wrap:anywhere;
  text-wrap:balance;
}
.public-match-modal .public-score-center{
  min-width:132px;
  align-self:stretch;
}
.public-match-modal .public-match-meta-grid strong{
  white-space:normal;
  overflow-wrap:anywhere;
}
.public-match-modal .public-match-panel h3{
  line-height:1.15;
  overflow-wrap:anywhere;
}
.public-match-modal .public-match-event-item strong,
.public-match-modal .public-match-event-item small,
.public-match-modal .public-match-empty{
  overflow-wrap:anywhere;
}
.public-match-modal .public-match-actions{
  grid-template-columns:minmax(0,320px);
}

@media(max-width:720px){
  .public-match-modal .section-title.match-modal-toolbar{
    display:flex!important;
    align-items:center!important;
    justify-content:space-between!important;
    gap:10px;
    flex-wrap:nowrap;
    margin-bottom:0;
  }
  .public-match-modal .match-modal-heading h2{
    font-size:1.28rem;
  }
  .public-match-modal .match-modal-close{
    width:auto!important;
    min-width:auto;
    padding:10px 14px;
    border-radius:16px;
    white-space:nowrap;
  }
  .public-match-modal #matchModalBody{
    padding:12px;
    padding-bottom:calc(22px + env(safe-area-inset-bottom));
  }
  .public-match-modal .public-match-detail-card{
    gap:12px;
    padding:0;
  }
  .public-match-modal .public-match-hero{
    padding:12px;
    border-radius:20px;
  }
  .public-match-modal .public-match-hero-top{
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    gap:10px;
    align-items:start;
  }
  .public-match-modal .public-match-hero-top .pill{
    font-size:.92rem;
    padding:10px 12px;
    border-radius:18px;
  }
  .public-match-modal .public-match-hero-top .match-status-badge{
    justify-self:end;
    font-size:.82rem;
    padding:8px 11px;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) 74px minmax(0,1fr)!important;
    gap:8px!important;
    margin:14px 0 16px!important;
  }
  .public-match-modal .public-score-team{
    grid-template-columns:1fr;
    justify-items:center;
    text-align:center;
    gap:6px;
    padding:10px 8px;
    border-radius:18px;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    width:48px;
    height:48px;
    border-radius:14px;
  }
  .public-match-modal .public-score-team strong{
    font-size:.96rem!important;
    line-height:1.12;
    display:block!important;
    -webkit-line-clamp:unset!important;
  }
  .public-match-modal .public-score-center{
    min-width:0;
    padding:10px 6px;
    border-radius:18px;
    gap:2px;
    align-self:center;
  }
  .public-match-modal .public-score-center span{
    font-size:1.4rem;
    line-height:1;
  }
  .public-match-modal .public-score-center em{
    font-size:.6rem;
    letter-spacing:.12em;
  }
  .public-match-modal .public-match-meta-grid span{
    padding:12px;
    border-radius:16px;
  }
  .public-match-modal .public-match-meta-grid strong{
    font-size:.98rem;
    line-height:1.2;
  }
  .public-match-modal .public-match-panel{
    min-height:0;
    padding:14px;
    border-radius:20px;
  }
  .public-match-modal .public-match-panel .panel-title>span{
    width:34px;
    height:34px;
    border-radius:12px;
  }
  .public-match-modal .public-match-panel h3{
    font-size:.98rem;
  }
  .public-match-modal .public-match-event-item{
    align-items:flex-start;
    padding:10px;
    border-radius:14px;
  }
  .public-match-modal .event-dot{
    width:30px;
    height:30px;
    border-radius:10px;
    flex:0 0 auto;
  }
  .public-match-modal .public-match-actions{
    grid-template-columns:1fr;
    position:sticky;
    bottom:0;
    padding-top:6px;
    background:linear-gradient(180deg,transparent,rgba(5,7,6,.96) 36%);
  }
  .public-match-modal .public-match-actions .btn{
    width:100%;
  }
}

@media(max-width:420px){
  .public-match-modal .match-modal-heading h2{
    font-size:1.16rem;
  }
  .public-match-modal .public-match-hero-top{
    grid-template-columns:1fr;
  }
  .public-match-modal .public-match-hero-top .match-status-badge{
    justify-self:start;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:1fr!important;
    gap:10px!important;
  }
  .public-match-modal .public-score-home{order:1;}
  .public-match-modal .public-score-center{
    order:2;
    grid-template-columns:auto auto auto;
    justify-content:center;
    padding:12px;
  }
  .public-match-modal .public-score-away{order:3;}
  .public-match-modal .public-score-team{
    grid-template-columns:auto 1fr;
    gap:8px 10px;
    justify-items:start;
    text-align:left;
    padding:10px 12px;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    grid-row:1 / span 2;
  }
  .public-match-modal .public-score-team strong{
    font-size:1rem!important;
  }
}


/* v65 - true one-line mobile match strip */
.public-match-modal .match-modal-toolbar{
  min-height:72px;
}
.public-match-modal .public-match-hero-top{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) auto!important;
  align-items:center!important;
  gap:10px!important;
}
.public-match-modal .public-match-hero-top .pill{
  min-width:0!important;
  max-width:100%!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
}
.public-match-modal .public-match-hero-top .match-status-badge{
  justify-self:end!important;
  align-self:center!important;
  white-space:nowrap!important;
}
.public-match-modal .public-scoreboard{
  display:grid!important;
  grid-template-columns:minmax(0,1fr) clamp(62px,18vw,92px) minmax(0,1fr)!important;
  align-items:center!important;
  gap:8px!important;
}
.public-match-modal .public-score-team{
  min-width:0!important;
  width:100%!important;
  display:grid!important;
  grid-template-columns:auto minmax(0,1fr)!important;
  align-items:center!important;
  justify-items:stretch!important;
  text-align:left!important;
  gap:8px!important;
}
.public-match-modal .public-score-away{
  grid-template-columns:minmax(0,1fr) auto!important;
  text-align:right!important;
}
.public-match-modal .public-score-away .team-logo,
.public-match-modal .public-score-away .team-logo-fallback{
  order:2;
}
.public-match-modal .public-score-team strong{
  min-width:0!important;
  display:block!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  -webkit-line-clamp:unset!important;
  -webkit-box-orient:initial!important;
  text-wrap:nowrap!important;
}
.public-match-modal .public-score-center{
  min-width:0!important;
  width:100%!important;
  display:grid!important;
  grid-template-columns:auto auto auto!important;
  justify-content:center!important;
  align-items:center!important;
  align-self:center!important;
  gap:3px!important;
}
.public-match-modal .public-score-center span{
  white-space:nowrap!important;
}

@media(max-width:720px){
  .public-match-modal .section-title.match-modal-toolbar{
    min-height:70px;
  }
  .public-match-modal .match-modal-heading h2{
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .public-match-modal .public-match-hero{
    padding:12px!important;
  }
  .public-match-modal .public-match-hero-top{
    grid-template-columns:minmax(0,1fr) auto!important;
  }
  .public-match-modal .public-match-hero-top .pill{
    font-size:clamp(.78rem,3.35vw,.92rem)!important;
    padding:9px 11px!important;
  }
  .public-match-modal .public-match-hero-top .match-status-badge{
    font-size:clamp(.72rem,3vw,.82rem)!important;
    padding:8px 10px!important;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) clamp(58px,17vw,76px) minmax(0,1fr)!important;
    gap:7px!important;
    margin:14px 0!important;
  }
  .public-match-modal .public-score-team{
    grid-template-columns:auto minmax(0,1fr)!important;
    padding:9px 8px!important;
    border-radius:17px!important;
    gap:7px!important;
  }
  .public-match-modal .public-score-away{
    grid-template-columns:minmax(0,1fr) auto!important;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    width:42px!important;
    height:42px!important;
    border-radius:13px!important;
  }
  .public-match-modal .public-score-team strong{
    font-size:clamp(.82rem,3.5vw,1rem)!important;
    line-height:1.05!important;
  }
  .public-match-modal .public-score-center{
    grid-template-columns:auto auto auto!important;
    padding:10px 5px!important;
    border-radius:16px!important;
    gap:2px!important;
  }
  .public-match-modal .public-score-center span{
    font-size:clamp(1.02rem,5vw,1.35rem)!important;
    line-height:1!important;
  }
  .public-match-modal .public-score-center em{
    font-size:clamp(.48rem,2.1vw,.58rem)!important;
    letter-spacing:.1em!important;
  }
}

@media(max-width:420px){
  .public-match-modal .public-match-hero-top{
    grid-template-columns:minmax(0,1fr) auto!important;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) 58px minmax(0,1fr)!important;
    gap:6px!important;
  }
  .public-match-modal .public-score-home,
  .public-match-modal .public-score-center,
  .public-match-modal .public-score-away{
    order:initial!important;
  }
  .public-match-modal .public-score-center{
    grid-template-columns:auto auto auto!important;
    padding:9px 4px!important;
  }
  .public-match-modal .public-score-team{
    grid-template-columns:auto minmax(0,1fr)!important;
    padding:8px 7px!important;
    gap:6px!important;
  }
  .public-match-modal .public-score-away{
    grid-template-columns:minmax(0,1fr) auto!important;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    width:38px!important;
    height:38px!important;
    border-radius:12px!important;
    grid-row:auto!important;
  }
  .public-match-modal .public-score-team strong{
    font-size:.88rem!important;
  }
}

@media(max-width:360px){
  .public-match-modal #matchModalBody{
    padding-left:9px!important;
    padding-right:9px!important;
  }
  .public-match-modal .public-match-hero{
    padding:9px!important;
    border-radius:18px!important;
  }
  .public-match-modal .public-match-hero-top{
    gap:7px!important;
  }
  .public-match-modal .public-match-hero-top .pill{
    font-size:.72rem!important;
    padding:8px 9px!important;
  }
  .public-match-modal .public-match-hero-top .match-status-badge{
    font-size:.68rem!important;
    padding:7px 8px!important;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) 52px minmax(0,1fr)!important;
    gap:5px!important;
  }
  .public-match-modal .public-score-team{
    padding:7px 6px!important;
    gap:5px!important;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    width:32px!important;
    height:32px!important;
    border-radius:10px!important;
  }
  .public-match-modal .public-score-team strong{
    font-size:.78rem!important;
  }
  .public-match-modal .public-score-center{
    padding:8px 3px!important;
  }
  .public-match-modal .public-score-center span{
    font-size:1rem!important;
  }
  .public-match-modal .public-score-center em{
    font-size:.44rem!important;
  }
}


/* v66 - score-safe UI: risultati a due cifre senza rotture layout */
:root{
  --ng-score-slot:clamp(5.4rem,22vw,7.6rem);
  --ng-score-slot-compact:clamp(4.9rem,21vw,6.6rem);
  --ng-score-digit:2ch;
}
.fixture-center,
.public-score-center,
.bracket-list-meta strong,
.bracket-team strong,
.score-badge{
  font-variant-numeric:tabular-nums!important;
  font-feature-settings:"tnum" 1!important;
  white-space:nowrap!important;
}
.fixture-center,
.public-score-center{
  overflow:hidden!important;
  box-sizing:border-box!important;
}
.fixture-center{
  min-width:var(--ng-score-slot-compact)!important;
  width:var(--ng-score-slot-compact)!important;
  max-width:var(--ng-score-slot-compact)!important;
  padding-left:clamp(5px,1.8vw,10px)!important;
  padding-right:clamp(5px,1.8vw,10px)!important;
}
.fixture-center strong{
  max-width:100%!important;
  white-space:nowrap!important;
  font-size:clamp(.86rem,2.8vw,1.08rem)!important;
  letter-spacing:-.02em!important;
}
.fixture-scoreline{
  grid-template-columns:minmax(0,1fr) var(--ng-score-slot-compact) minmax(0,1fr)!important;
}
.fixture-team{min-width:0!important;}
.fixture-team strong{
  min-width:0!important;
  max-width:100%!important;
}
.public-match-modal .public-scoreboard{
  grid-template-columns:minmax(0,1fr) var(--ng-score-slot) minmax(0,1fr)!important;
}
.public-match-modal .public-score-center{
  min-width:var(--ng-score-slot)!important;
  width:var(--ng-score-slot)!important;
  max-width:var(--ng-score-slot)!important;
  grid-template-columns:minmax(var(--ng-score-digit),auto) auto minmax(var(--ng-score-digit),auto)!important;
  padding-inline:clamp(5px,1.8vw,14px)!important;
  gap:clamp(2px,.8vw,6px)!important;
}
.public-match-modal .public-score-center span{
  min-width:var(--ng-score-digit)!important;
  text-align:center!important;
  letter-spacing:-.045em!important;
  font-size:clamp(1.04rem,5.2vw,2.25rem)!important;
}
.public-match-modal .public-score-center em{
  min-width:1.35em!important;
  text-align:center!important;
  letter-spacing:.06em!important;
}
.bracket-team{
  display:grid!important;
  grid-template-columns:auto minmax(0,1fr) minmax(2.6ch,auto)!important;
  align-items:center!important;
}
.bracket-team span{
  min-width:0!important;
}
.bracket-team strong{
  justify-self:end!important;
  min-width:2.6ch!important;
  text-align:right!important;
  margin-left:0!important;
}
.bracket-list-meta strong{
  min-width:5.4ch!important;
  text-align:center!important;
  padding:.25rem .45rem!important;
  border-radius:999px!important;
  background:rgba(0,0,0,.22)!important;
}
.bracket-list-teams{
  grid-template-columns:minmax(0,1fr) minmax(2.4rem,auto) minmax(0,1fr)!important;
}
.bracket-list-teams em{
  min-width:2.4rem!important;
  text-align:center!important;
}

@media(max-width:720px){
  :root{
    --ng-score-slot:clamp(5.15rem,24vw,6.4rem);
    --ng-score-slot-compact:clamp(4.75rem,23vw,6rem);
  }
  .fixture-scoreline{
    grid-template-columns:minmax(0,1fr) var(--ng-score-slot-compact) minmax(0,1fr)!important;
    gap:6px!important;
  }
  .fixture-center{
    min-width:var(--ng-score-slot-compact)!important;
    width:var(--ng-score-slot-compact)!important;
    max-width:var(--ng-score-slot-compact)!important;
    padding:8px 5px!important;
  }
  .fixture-center strong{
    font-size:clamp(.82rem,3.4vw,1rem)!important;
  }
  .fixture-center small{
    font-size:clamp(.48rem,1.9vw,.55rem)!important;
    letter-spacing:.07em!important;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) var(--ng-score-slot) minmax(0,1fr)!important;
    gap:6px!important;
  }
  .public-match-modal .public-score-center{
    min-width:var(--ng-score-slot)!important;
    width:var(--ng-score-slot)!important;
    max-width:var(--ng-score-slot)!important;
    padding:9px 5px!important;
  }
  .public-match-modal .public-score-center span{
    font-size:clamp(1rem,5vw,1.28rem)!important;
  }
  .bracket-list-teams{
    grid-template-columns:minmax(0,1fr) minmax(2.4rem,auto) minmax(0,1fr)!important;
    gap:6px!important;
  }
}

@media(max-width:420px){
  :root{
    --ng-score-slot:5.05rem;
    --ng-score-slot-compact:4.65rem;
  }
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) var(--ng-score-slot) minmax(0,1fr)!important;
  }
  .public-match-modal .public-score-center span{
    font-size:1.08rem!important;
  }
  .public-match-modal .public-score-center em{
    font-size:.52rem!important;
  }
}

@media(max-width:360px){
  :root{
    --ng-score-slot:4.75rem;
    --ng-score-slot-compact:4.35rem;
  }
  .fixture-scoreline,
  .public-match-modal .public-scoreboard{
    gap:4px!important;
  }
  .fixture-center strong{
    font-size:.78rem!important;
  }
  .public-match-modal .public-score-center span{
    font-size:.98rem!important;
  }
  .public-match-modal .public-score-center em{
    font-size:.46rem!important;
  }
}


/* v67 - score separator cleanup: only dash between goals */
.fixture-center.is-played strong,
.public-score-center.is-played span{font-variant-numeric:tabular-nums;}
.fixture-center{grid-template-columns:1fr;gap:0!important;}
.fixture-center small{display:none!important;}
.public-match-modal .public-score-center{align-items:center;}
.public-match-modal .public-score-center em{
  font-size:1.1rem!important;
  font-weight:950!important;
  letter-spacing:0!important;
  color:#fff0b8!important;
  text-transform:none!important;
  line-height:1;
}
.public-match-modal .public-score-center.is-pending em{
  font-size:.72rem!important;
  letter-spacing:.12em!important;
  text-transform:uppercase!important;
}
@media(max-width:720px){
  .public-match-modal .public-score-center em{font-size:1rem!important;}
  .public-match-modal .public-score-center.is-pending em{font-size:.62rem!important;}
}

/* v72 - public selection persistence + admin standings criteria ordering */
.standings-criteria-box{border:1px solid rgba(215,164,45,.20);border-radius:22px;padding:14px;background:linear-gradient(135deg,rgba(255,246,218,.055),rgba(255,246,218,.018));}
.standings-criteria-editor{display:grid;gap:9px;margin-top:10px;}
.ranking-criterion-row{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:10px;background:rgba(0,0,0,.20);cursor:grab;transition:transform .16s ease,border-color .16s ease,background .16s ease;}
.ranking-criterion-row.dragging{opacity:.55;transform:scale(.985);}
.ranking-criterion-row.drop-active{border-color:rgba(242,210,111,.78);background:linear-gradient(135deg,rgba(215,164,45,.18),rgba(255,246,218,.04));}
.criterion-rank{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,var(--brand-primary),var(--brand-accent));color:#151006;font-weight:950;font-variant-numeric:tabular-nums;}
.criterion-rank.big{width:48px;height:48px;border-radius:16px;font-size:1.15rem;}
.criterion-handle{width:38px;height:38px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:var(--text);font-weight:950;cursor:grab;}
.ranking-criterion-row strong,.ranking-criterion-row small{display:block;min-width:0;}
.ranking-criterion-row small{color:var(--muted);font-weight:800;margin-top:2px;}
.criterion-actions{display:flex;gap:6px;}
.criterion-actions .btn{width:auto;min-width:42px;padding-inline:11px;}
.match-action-card.active{border-color:rgba(242,210,111,.72);background:linear-gradient(135deg,rgba(215,164,45,.22),rgba(255,246,218,.05));}
@media(max-width:720px){
  .standings-criteria-box{padding:12px;border-radius:20px;}
  .ranking-criterion-row{grid-template-columns:auto minmax(0,1fr) auto;gap:8px;cursor:default;}
  .ranking-criterion-row .criterion-handle{grid-column:3;grid-row:1;width:42px;height:42px;}
  .ranking-criterion-row>div:not(.criterion-actions){grid-column:2;}
  .criterion-actions{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;}
  .criterion-actions .btn{width:100%;}
}

/* ============================================================ */
/* v82: aggiunte successive (Live, Rigori, Jersey, Notifiche)   */
/* ============================================================ */

/* Stato Live (arancione, lampeggiante) - badge */
.score-badge.match-status-badge.is-live,
.match-status-badge.is-live{
  background:linear-gradient(135deg,#f97316,#fb923c,#fdba74)!important;
  color:#1a0a00!important;
  border-color:rgba(251,146,60,.7)!important;
  text-shadow:0 1px 1px rgba(0,0,0,.18)!important;
  animation:ngLivePulse 1.6s ease-in-out infinite;
  position:relative;
}
@keyframes ngLivePulse{
  0%,100%{box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 0 0 0 rgba(249,115,22,.55)}
  50%{box-shadow:inset 0 0 0 1px rgba(255,255,255,.32),0 0 0 8px rgba(249,115,22,0)}
}
@keyframes ngLiveDot{0%,100%{opacity:1}50%{opacity:.3}}
.fixture-center.is-live strong,
.public-score-center.is-live span,
.public-score-center.is-live em{ color:#fb923c!important; }
.is-live-card{
  border-color:rgba(251,146,60,.55)!important;
  box-shadow:0 0 0 1px rgba(251,146,60,.45),0 8px 24px -10px rgba(249,115,22,.4)!important;
}
.is-live-card::before{
  content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(120% 60% at 50% -20%,rgba(251,146,60,.18),transparent 60%);
}
.match-status-badge.is-live::after{
  content:'';display:inline-block;width:6px;height:6px;border-radius:50%;
  background:#dc2626;margin-left:6px;vertical-align:middle;
  animation:ngLiveDot 1s ease-in-out infinite;
}

/* Indicatore connessione realtime (pillola in basso a sinistra) */
.ng-realtime-indicator{
  position:fixed;bottom:14px;left:14px;z-index:60;
  display:inline-flex;align-items:center;gap:6px;
  padding:5px 10px;border-radius:999px;
  background:rgba(15,15,12,.78);backdrop-filter:blur(6px);
  border:1px solid rgba(255,255,255,.08);
  font-size:.74rem;font-weight:700;color:#bfffe0;
  pointer-events:none;opacity:.85;
}
.ng-realtime-indicator[data-state="off"]{color:#ffd2d6;border-color:rgba(216,33,53,.45)}
.ng-realtime-indicator[data-state="reconnecting"]{color:#fbd38d;border-color:rgba(251,146,60,.45)}
.ng-realtime-indicator .ng-rt-dot{
  width:7px;height:7px;border-radius:50%;background:#d7a42d;
  box-shadow:0 0 8px rgba(215,164,45,.7);
  animation:ngLiveDot 1.6s ease-in-out infinite;
}
.ng-realtime-indicator[data-state="off"] .ng-rt-dot{background:#dc2626;box-shadow:0 0 6px rgba(220,38,38,.6)}
.ng-realtime-indicator[data-state="reconnecting"] .ng-rt-dot{background:#fb923c;box-shadow:0 0 6px rgba(251,146,60,.6)}

/* Numero maglia */
.jersey-number{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:32px;height:32px;padding:0 8px;
  border-radius:8px;background:linear-gradient(135deg,#fff45a,#d2a63a);
  color:#1a1300;font-weight:950;font-size:.95rem;
  font-variant-numeric:tabular-nums;letter-spacing:.02em;
  border:1px solid rgba(255,255,255,.18);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.18);
}
.jersey-number.small{min-width:24px;height:24px;font-size:.78rem;padding:0 6px;border-radius:6px}
.jersey-number.empty{background:linear-gradient(135deg,#3a3528,#1f1c14);color:#8c7f5a;border-color:rgba(255,255,255,.06)}
.player-edit-form .jersey-number-field input{font-variant-numeric:tabular-nums;font-weight:800}
.public-roster-row .jersey-cell{min-width:42px;text-align:center}
.roster-li-with-num{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.roster-li-with-num .jersey-number{flex:0 0 auto}
.roster-li-with-num strong{flex:1 1 auto;min-width:120px}
.roster-li-with-num span{font-size:.78rem;color:rgba(255,255,255,.55)}
.roster-li-with-num em{font-size:.8rem;color:#fbe98a;font-style:normal;font-weight:700}

/* Toggle Live nel form info partita */
.check-card.live-toggle{
  display:flex;align-items:flex-start;gap:10px;
  padding:12px 14px;border-radius:14px;
  background:rgba(249,115,22,.06);
  border:1px solid rgba(249,115,22,.22);
  transition:background .2s,border-color .2s;
  cursor:pointer;
}
.check-card.live-toggle.is-active{
  background:linear-gradient(135deg,rgba(249,115,22,.18),rgba(251,146,60,.08));
  border-color:rgba(251,146,60,.55);
}
.check-card.live-toggle input[type="checkbox"]{margin-top:3px;accent-color:#f97316;transform:scale(1.15)}
.check-card.live-toggle strong{display:block;color:#fdba74;font-weight:900;letter-spacing:.01em}
.check-card.live-toggle small{display:block;color:rgba(255,255,255,.66);font-size:.78rem;margin-top:3px;line-height:1.35}
.check-card.live-toggle input[disabled]{opacity:.4;cursor:not-allowed}

/* Rigori KO */
.bracket-penalty-row,.fixture-penalty-row{
  display:flex;align-items:center;justify-content:center;gap:8px;
  margin:6px 0 0;padding:5px 10px;border-radius:999px;
  background:linear-gradient(135deg,rgba(255,244,90,.14),rgba(210,166,58,.18));
  border:1px solid rgba(255,244,90,.32);
  font-size:.78rem;color:#ffe98a;letter-spacing:.04em;
}
.bracket-penalty-row span,.fixture-penalty-row span{
  text-transform:uppercase;font-weight:800;color:#fff45a;
}
.bracket-penalty-row strong,.fixture-penalty-row strong{
  font-variant-numeric:tabular-nums;font-weight:950;color:#fff;
}
.bracket-list-match .bracket-penalty-row,.bracket-match .bracket-penalty-row{margin:4px 8px 0}
.fixture-penalty-row{margin:8px 14px 0;align-self:center;max-width:fit-content}
.penalty-fields-block{
  display:grid;grid-template-columns:1fr 1fr;gap:10px;
  padding:12px 14px;border-radius:14px;
  background:rgba(255,244,90,.06);
  border:1px solid rgba(255,244,90,.22);
  grid-column:1/-1;
}
.penalty-fields-block .penalty-header{
  grid-column:1/-1;display:flex;align-items:center;gap:8px;
  margin-bottom:4px;
}
.penalty-fields-block .penalty-header strong{
  color:#fff45a;font-weight:900;letter-spacing:.02em;
}
.penalty-fields-block .penalty-header small{
  color:rgba(255,255,255,.65);font-size:.78rem;
}
.penalty-fields-block label{font-size:.85rem;color:rgba(255,244,90,.8)}
.penalty-fields-block input{
  font-variant-numeric:tabular-nums;font-weight:900;text-align:center;
  font-size:1.05rem;
}
.match-penalty-status{
  padding:10px 14px;border-radius:14px;margin:0 0 4px;font-size:.88rem;font-weight:700;letter-spacing:.01em;
}
.match-penalty-status.ok{
  background:linear-gradient(135deg,rgba(215,164,45,.14),rgba(215,164,45,.06));
  border:1px solid rgba(215,164,45,.45);
  color:#f4d878;
}
.match-penalty-status.warn{
  background:linear-gradient(135deg,rgba(249,115,22,.16),rgba(251,146,60,.08));
  border:1px solid rgba(251,146,60,.5);
  color:#fdba74;
}
.match-penalty-status strong{color:#fff}
.public-penalty-block{
  display:flex;flex-direction:column;align-items:center;gap:6px;
  margin:10px auto 0;padding:10px 20px;border-radius:16px;
  background:linear-gradient(135deg,rgba(255,244,90,.16),rgba(210,166,58,.1));
  border:1px solid rgba(255,244,90,.32);
  max-width:fit-content;
}
.public-penalty-head{
  display:flex;align-items:center;gap:14px;
  font-variant-numeric:tabular-nums;
}
.public-penalty-head span{
  text-transform:uppercase;font-size:.78rem;color:#fff45a;font-weight:800;letter-spacing:.08em;
}
.public-penalty-head strong{
  font-size:1.5rem;font-weight:950;color:#fff;letter-spacing:-.02em;
}
.public-penalty-winner{
  font-size:.82rem;color:#fbe98a;text-align:center;
}

/* Pill "aggiornamento automatico" + banner live nella home pubblica */
.pill.pill-live{
  display:inline-flex;align-items:center;gap:6px;
  background:linear-gradient(135deg,rgba(215,164,45,.18),rgba(215,164,45,.08));
  border:1px solid rgba(215,164,45,.45);
  color:#f4d878;
}
.pill-live-dot{
  width:7px;height:7px;border-radius:50%;background:#d7a42d;
  box-shadow:0 0 8px rgba(215,164,45,.7);
  animation:ngLiveDot 1.6s ease-in-out infinite;
  display:inline-block;
}
.live-strip-home{
  background:linear-gradient(135deg,rgba(249,115,22,.1),rgba(251,146,60,.04));
  border:1px solid rgba(251,146,60,.4);
}
.live-strip-head{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;
}
.live-strip-head h2{margin:0;color:#fdba74;font-size:1.15rem;letter-spacing:-.01em;}
.live-strip-head .muted{font-size:.78rem;color:rgba(255,255,255,.55);}
.live-strip-dot{
  width:11px;height:11px;border-radius:50%;background:#dc2626;
  box-shadow:0 0 0 0 rgba(220,38,38,.6);
  animation:ngLivePulse 1.6s ease-in-out infinite;
}
.live-strip-grid{
  display:grid;gap:12px;
  grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
}
.live-strip-card{
  display:flex;flex-direction:column;gap:10px;
  padding:14px;border-radius:18px;cursor:pointer;
  background:rgba(15,15,12,.55);
  border:1px solid rgba(251,146,60,.4);
  transition:transform .15s,border-color .15s,box-shadow .15s;
}
.live-strip-card:hover,.live-strip-card:focus{
  transform:translateY(-1px);
  border-color:rgba(251,146,60,.7);
  box-shadow:0 8px 24px -10px rgba(249,115,22,.4);
  outline:none;
}
.live-strip-meta{
  display:flex;align-items:center;gap:10px;justify-content:space-between;
  flex-wrap:wrap;
}
.live-strip-meta small{color:rgba(255,255,255,.6);font-size:.75rem;}
.live-strip-teams{
  display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;
}
.live-strip-team{
  display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;
}
.live-strip-team strong{font-size:.85rem;color:#fff;}
.live-strip-score{
  font-variant-numeric:tabular-nums;font-size:1.8rem;font-weight:950;color:#fb923c;
  letter-spacing:-.02em;text-shadow:0 0 12px rgba(249,115,22,.25);
}
.live-strip-footer{
  display:flex;justify-content:space-between;gap:10px;
  font-size:.74rem;color:rgba(255,255,255,.55);
}
@media (max-width:480px){
  .live-strip-grid{grid-template-columns:1fr;}
}

/* Notifiche pop-up partite live */
.ng-live-notif-container{
  position:fixed;top:14px;right:14px;z-index:9999;
  display:flex;flex-direction:column;gap:10px;
  max-width:340px;width:calc(100vw - 28px);
  pointer-events:none;
}
.ng-live-notif{
  position:relative;pointer-events:auto;
  display:flex;flex-direction:column;gap:8px;
  padding:12px 14px 12px 14px;border-radius:16px;
  background:linear-gradient(135deg,rgba(15,15,12,.96),rgba(20,15,8,.96));
  border:1px solid rgba(251,146,60,.55);
  box-shadow:0 10px 30px -8px rgba(249,115,22,.45),0 4px 12px rgba(0,0,0,.4);
  color:#fff;cursor:pointer;
  transform:translateX(120%) scale(.96);opacity:0;
  transition:transform .32s cubic-bezier(.2,.9,.3,1.2),opacity .25s ease;
}
.ng-live-notif.is-in{transform:translateX(0) scale(1);opacity:1}
.ng-live-notif.is-out{transform:translateX(120%) scale(.96);opacity:0}
.ng-live-notif:hover{border-color:rgba(251,146,60,.8)}
.ng-live-notif-close{
  position:absolute;top:4px;right:8px;
  background:transparent;border:0;color:rgba(255,255,255,.55);
  font-size:1.2rem;line-height:1;padding:4px 6px;cursor:pointer;border-radius:6px;
}
.ng-live-notif-close:hover{color:#fff;background:rgba(255,255,255,.08)}
.ng-live-notif-head{display:flex;align-items:center;gap:8px;font-size:.74rem;padding-right:22px}
.ng-live-notif-badge{
  background:linear-gradient(135deg,#dc2626,#f97316);color:#fff;
  font-weight:900;padding:2px 7px;border-radius:8px;letter-spacing:.04em;font-size:.7rem;
  animation:ngLiveDot 1.4s ease-in-out infinite;
}
.ng-live-notif-scorer{color:#fdba74;font-weight:700;letter-spacing:.01em}
.ng-live-notif-body{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center}
.ng-live-notif-team{
  display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;min-width:0;
}
.ng-live-notif-team strong{
  font-size:.78rem;color:#fff;font-weight:700;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;
}
.ng-live-notif-team .team-logo,.ng-live-notif-team img{width:28px;height:28px}
.ng-live-notif-score{
  font-variant-numeric:tabular-nums;font-size:1.4rem;font-weight:950;
  color:#fb923c;letter-spacing:-.02em;padding:0 4px;
}
.ng-live-notif-hint{font-size:.7rem;color:rgba(255,255,255,.5);text-align:center;letter-spacing:.04em;margin-top:2px}
@media(max-width:480px){
  .ng-live-notif-container{max-width:none;left:14px;right:14px;width:auto}
  .ng-live-notif-score{font-size:1.2rem}
}

/* v82: nuova savebar admin con azioni separate Live/Salva tutto */
.match-context-savebar-actions{
  display:flex;flex-wrap:wrap;gap:10px;align-items:stretch;margin:8px 0 4px;
}
.match-context-savebar-actions .btn{flex:1 1 180px;min-height:44px;font-weight:800}
.match-context-savebar.is-live-mode{
  border-color:rgba(251,146,60,.5)!important;
  background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(15,15,12,.4))!important;
}
.live-update-btn{
  background:linear-gradient(135deg,#f97316,#fb923c)!important;
  color:#1a0a00!important;
  border-color:rgba(251,146,60,.7)!important;
  font-weight:900!important;
  text-shadow:0 1px 1px rgba(255,255,255,.18)!important;
}
.live-update-btn:hover{
  background:linear-gradient(135deg,#fb923c,#fdba74)!important;
  transform:translateY(-1px);
}
.match-context-savebar.is-live-mode .match-save-only{
  background:linear-gradient(135deg,#d7a42d,#f4d878)!important;
  color:#03140c!important;
}

/* v82: indicatore Live in scheda squadra */
.team-form-row.is-live-row{
  background:linear-gradient(135deg,rgba(249,115,22,.12),rgba(15,15,12,.4));
  border-color:rgba(251,146,60,.4)!important;
}
.team-form-live{
  color:#fdba74!important;font-weight:900;font-style:normal;
  animation:ngLiveDot 1.6s ease-in-out infinite;
  font-variant-numeric:tabular-nums;
}

/* ============================================================ */
/* v82 - Miglioramenti mobile: form, modali, touch target, scroll */
/* ============================================================ */
@media(max-width:720px){
  /* Modali: full-screen, scroll esterno per evitare double-scroll */
  .modal{padding:8px;}
  .modal-content{max-height:calc(100vh - 16px);border-radius:18px;padding:14px;}
  .public-match-modal .modal-content,.team-modal .team-modal-content{padding:12px}
  .match-task-toolbar,.team-modal-toolbar{flex-wrap:wrap;gap:8px}
  .match-task-toolbar h2,.team-modal-toolbar h2{font-size:1.05rem;margin:0}
  /* Bottoni nelle toolbar dei modali ridotti */
  .match-task-toolbar .btn,.team-modal-toolbar .btn{padding:8px 12px;min-height:40px;font-size:.85rem}

  /* Touch target generale: tutti i bottoni almeno 44px alti su mobile per accessibilità */
  .btn{min-height:44px}
  .btn.small{min-height:38px}
  
  /* Filtri partite: stack verticale */
  .public-match-filters{flex-direction:column;align-items:stretch;gap:8px}
  .public-match-filters .match-filter-row{flex-wrap:wrap;gap:6px}
  .public-match-filters .match-filter-row .btn{flex:1 1 auto;min-width:auto;font-size:.78rem;padding:6px 8px}
  
  /* Match cards: layout vertical su mobile */
  .public-fixture-card .fixture-scoreline{grid-template-columns:1fr;gap:6px;text-align:center}
  .public-fixture-card .fixture-center{order:2}
  .public-fixture-card .fixture-team.home{order:1}
  .public-fixture-card .fixture-team.away{order:3}
  .fixture-meta-row,.fixture-events{flex-direction:column;align-items:flex-start;gap:5px;font-size:.78rem}
  
  /* Notifiche live: padding ridotto */
  .ng-live-notif-container{top:10px;left:10px;right:10px;max-width:none}
  .ng-live-notif{padding:10px 12px}
  .ng-live-notif-score{font-size:1.2rem}
  
  /* Banner live strip mobile: 1 colonna */
  .live-strip-card{padding:12px}
  .live-strip-score{font-size:1.5rem}
  
  /* Tabelle: scroll orizzontale chiaro */
  .table-wrap{margin-inline:-4px;overflow-x:auto;-webkit-overflow-scrolling:touch}
  table{min-width:580px}
  
  /* Admin form: input full-width, label leggibili */
  .form-grid{gap:10px}
  .form-grid input,.form-grid select,.form-grid textarea{padding:11px}
  
  /* Match command center admin: bottoni full-width */
  .match-command-center .match-action-grid{grid-template-columns:1fr;gap:8px}
  .match-action-card{padding:14px;text-align:left}
  .match-action-card span{font-size:1.6rem}
  
  /* Match savebar admin: bottoni stack su mobile */
  .match-context-savebar-actions{flex-direction:column}
  .match-context-savebar-actions .btn{flex:1 1 auto;width:100%}
  
  /* Team grid */
  .team-card-grid{grid-template-columns:1fr;gap:10px}
  
  /* Stats grid */
  .stat-strip{grid-template-columns:repeat(2,1fr);gap:8px}
  .stat{padding:10px}
  .stat strong{font-size:1.2rem}
  
  /* Schedute squadra mobile */
  .team-sheet-grid{grid-template-columns:1fr;gap:12px}
  .pro-team-hero{flex-direction:column;align-items:center;text-align:center;gap:10px}
  .pro-team-logo{width:80px;height:80px}
  .team-sheet-kpis{grid-template-columns:repeat(2,1fr);gap:8px}
  
  /* Hero team detail: tag su mobile */
  .pro-team-title{align-items:center}
  
  /* Public scoreboard nel modale partita */
  .public-scoreboard{gap:6px}
  .public-score-team{min-width:0}
  .public-score-team strong{font-size:.85rem}
  .public-score-center{padding:0 4px}
  .public-score-center span{font-size:1.6rem}
  
  /* Roster lista */
  .roster-li-with-num{flex-wrap:wrap}
  .roster-li-with-num em{flex:1 1 100%;font-size:.75rem;margin-top:2px}
  
  /* Articoli */
  .article-card{padding:12px}
  
  /* Penalty fields admin */
  .penalty-fields-block{grid-template-columns:1fr;gap:8px;padding:10px}
  
  /* Search results */
  #searchResults .team-row{grid-template-columns:auto 1fr;gap:8px}
  #searchResults .team-row .row-actions{grid-column:1/-1;display:flex;gap:6px}
  #searchResults .player-row{flex-direction:column;align-items:flex-start;gap:6px}
}

/* Touch target ottimizzato per dita: tutti gli elementi cliccabili minimo 36x36 */
@media(max-width:480px){
  .match-pick-btn{padding:12px 10px}
  .pill{padding:5px 9px;font-size:.74rem}
  .ng-live-notif-team strong{font-size:.72rem;max-width:90px}
  .stat strong{font-size:1.1rem}
  .stat span{font-size:.72rem}
  /* Modale partita: header compatto */
  .public-match-modal .public-match-hero-top{flex-wrap:wrap;gap:6px}
  .public-match-modal .public-match-meta-grid{grid-template-columns:1fr;gap:6px}
  .public-match-modal .public-match-panels{grid-template-columns:1fr;gap:8px}
}

/* Migliora hover/focus per touch device */
@media(hover:none){
  .btn:hover,.match-action-card:hover,.team-card:hover,.live-strip-card:hover{transform:none}
  .clickable:active,.match-card.clickable:active{transform:scale(0.98)}
}

/* v84: classifica live - righe squadre in partita marcate */
.standings-table tr.is-live-row,
.standings-table tr.standings-team-row.is-live-row{
  background:linear-gradient(135deg, rgba(249,115,22,.10), rgba(15,15,12,.4)) !important;
  border-left: 3px solid #fb923c !important;
  position: relative;
}
.standings-table tr.is-live-row td,
.standings-table tr.standings-team-row.is-live-row td{
  color: #fdba74;
  font-weight: 800;
}
.standings-table tr.is-live-row td:first-child .rank,
.standings-table tr.standings-team-row.is-live-row td:first-child .rank{
  background: linear-gradient(135deg,#f97316,#fb923c) !important;
  color: #1a0a00;
}
.standings-table tr.is-live-row td strong,
.standings-table tr.standings-team-row.is-live-row td strong{
  color: #fff;
}
.standings-live-dot{
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #dc2626;
  box-shadow: 0 0 8px rgba(220,38,38,.65);
  margin-left: 8px;
  vertical-align: middle;
  animation: ngLivePulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

/* =====================================================================
   v86 - UI spacing fixes: jersey numbers, flag, button centering
   ===================================================================== */

/* ---- Roster con due colonne strutturate (jersey + nome/info) ---- */
.roster-li-with-num{
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255,255,255,.025);
  border: 1px solid rgba(255,255,255,.06);
  margin-bottom: 6px;
}
.roster-li-with-num .roster-num-col{
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.roster-li-with-num .roster-name-col{
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0; /* permette il troncamento del nome */
  overflow: hidden;
}
.roster-li-with-num .roster-name-col strong{
  font-size: .92rem;
  line-height: 1.25;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roster-li-with-num .roster-meta{
  font-size: .74rem;
  color: rgba(255,255,255,.55);
  letter-spacing: .02em;
  font-weight: 600;
}

/* Cellulare: stesso layout ma con padding più piccolo */
@media (max-width: 480px){
  .roster-li-with-num{
    padding: 8px 10px;
    gap: 10px;
    grid-template-columns: 36px 1fr;
  }
  .roster-li-with-num .roster-name-col strong{font-size: .88rem;}
  .roster-li-with-num .roster-meta{font-size: .7rem;}
}

/* ---- Spacing generale per pill, badge, flag ---- */
/* Tutte le pill devono avere un po' di respiro intorno ai testi adiacenti */
.team-inline{
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.team-inline strong, .team-inline .team-name{
  margin-left: 2px;
}
.team-inline .team-logo, .team-inline img{
  flex-shrink: 0;
  margin-right: 2px;
}
.pill + .pill{ margin-left: 6px; }
.badge + .badge{ margin-left: 6px; }
.fixture-team strong{ margin-left: 6px; }

/* Match cards: distanza fra logo squadra e nome */
.fixture-team .team-logo, .public-score-team .team-logo,
.fixture-team img, .public-score-team img{
  margin-right: 8px;
  flex-shrink: 0;
}

/* Standings: dot live ben distanziato */
.standings-table .standings-live-dot{ margin-left: 10px !important; }
.standings-table .team-inline{ gap: 12px; }

/* Live strip: team logo distanziato */
.live-strip-team .team-logo, .live-strip-team img{
  margin-bottom: 4px;
}

/* Score row pubblico: distanza fra logo e nome */
.public-score-team{
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Notifiche live: padding interno aumentato */
.ng-live-notif-team strong{ margin-top: 4px; }

/* ---- CENTRATURA BOTTONI NELLE CARD ---- */
/* Match action grid (admin): bottoni centrati nelle card */
.match-action-card{
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.match-action-card span{ margin-bottom: 6px; }
.match-action-card strong, .match-action-card small{ display: block; }

/* Public match modal: bottone Condividi centrato */
.public-match-actions{
  display: flex;
  justify-content: center;
  margin: 16px auto 8px;
  width: 100%;
}
.public-match-actions .btn{
  min-width: 200px;
  max-width: 100%;
}
.live-share-note{
  display: block;
  text-align: center;
  padding: 10px 14px;
  background: rgba(249,115,22,.08);
  border: 1px dashed rgba(251,146,60,.35);
  border-radius: 10px;
  color: #fdba74;
  font-size: .82rem;
}

/* Team detail: bottone Chiudi / Download centrato nella toolbar */
.team-modal-toolbar{
  align-items: center;
}
.team-modal-actions{
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

/* Public match toolbar bottoni */
.match-task-toolbar, .public-match-modal .match-task-toolbar{
  align-items: center;
}

/* Article cards: read more centrato */
.article-card .btn, .article-card-actions{
  display: flex;
  justify-content: center;
  margin-top: 10px;
}

/* Empty state bottoni centrati */
.empty .btn, .empty-state .btn{
  display: block;
  margin: 12px auto 0;
}

/* Stat strip: padding interno e centratura del contenuto */
.stat{
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4px;
  padding: 14px 10px;
}

/* Form-row label/input spacing */
.form-grid label{ margin-bottom: 6px; display: block; }

/* Generic: bottoni dentro empty/info cards centrati */
.public-empty-card .btn,
.info-card .btn{
  display: block;
  margin-left: auto;
  margin-right: auto;
  margin-top: 12px;
}

/* Action row dentro card: i bottoni distanti almeno 8px fra loro */
.action-row, .card-actions, .row-actions{
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

/* Sezione "Ultime partite" nella scheda squadra */
.team-form-row{
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
}
.team-form-row > span:first-child{
  font-size: .75rem;
  color: rgba(255,255,255,.5);
  font-weight: 700;
  letter-spacing: .04em;
}
.team-form-row strong{
  font-size: .9rem;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-form-row em{
  font-style: normal;
  font-weight: 800;
  color: #fbe98a;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 480px){
  .team-form-row{
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
  }
  .team-form-row > span:first-child{
    grid-column: 1 / -1;
    font-size: .68rem;
  }
}

/* =====================================================================
   v90 - Sezione Foto squadre (admin + pubblico)
   ===================================================================== */
.team-button-list{display:flex;flex-direction:column;gap:6px;max-height:480px;overflow-y:auto}
.team-pick-btn{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025);color:#fff;cursor:pointer;text-align:left;transition:background .15s,border-color .15s}
.team-pick-btn:hover{background:rgba(251,146,60,.08);border-color:rgba(251,146,60,.3)}
.team-pick-btn.active{background:linear-gradient(135deg,rgba(215,164,45,.15),rgba(215,164,45,.05));border-color:rgba(215,164,45,.5);color:#f4d878}
.team-pick-btn .team-logo,.team-pick-btn img{width:28px;height:28px;border-radius:6px;object-fit:contain}
.team-pick-name{font-weight:700;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-pick-meta{font-size:.72rem;color:rgba(255,255,255,.55);font-weight:600;letter-spacing:.04em}
.team-pick-btn.active .team-pick-meta{color:rgba(158,255,216,.7)}

.photos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.photo-thumb{position:relative;margin:0;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);transition:transform .15s,border-color .15s,box-shadow .15s}
.photo-thumb:hover{transform:translateY(-2px);border-color:rgba(255,235,176,.35);box-shadow:0 8px 20px -8px rgba(0,0,0,.5)}
.photo-thumb img{display:block;width:100%;height:160px;object-fit:cover;background:#0a0a0a}
.photo-thumb figcaption{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;font-size:.74rem;color:rgba(255,255,255,.65);background:rgba(15,15,12,.6)}
.photo-thumb figcaption span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.photo-thumb figcaption small{font-size:.7rem;color:rgba(255,255,255,.45);font-variant-numeric:tabular-nums}
.photo-delete-btn{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;background:rgba(220,38,38,.9);color:#fff;border:0;font-size:1rem;font-weight:900;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.photo-delete-btn:hover{background:#dc2626;transform:scale(1.1)}
.photo-download-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:rgba(215,164,45,.18);color:#f4d878;text-decoration:none;font-size:.9rem;flex-shrink:0;transition:background .15s}
.photo-download-btn:hover{background:rgba(215,164,45,.35);color:#fff}
.photo-thumb.public{cursor:default}
.photo-thumb.public img{cursor:zoom-in}

@media (max-width:480px){
  .photos-grid{grid-template-columns:repeat(2,1fr);gap:8px}
  .photo-thumb img{height:120px}
  .team-pick-btn{padding:8px 10px}
}

/* =====================================================================
   v91 - Sezione Foto UI ottimizzata (admin + pubblico, mobile + desktop)
   ===================================================================== */

/* ---- Layout admin: sidebar + workspace ---- */
.photos-admin-grid{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}
.photos-sidebar{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto}
.photos-workspace{position:relative;min-width:0}

/* ---- Sidebar squadre admin ---- */
.team-list-summary{margin-bottom:12px;display:flex;justify-content:center}
.team-list-summary .pill{font-size:.8rem;padding:6px 12px;background:linear-gradient(135deg,rgba(215,164,45,.12),rgba(215,164,45,.04));border:1px solid rgba(215,164,45,.25);color:#f4d878}
.team-pick-grid{display:flex;flex-direction:column;gap:6px}
.team-pick-btn{display:grid;grid-template-columns:32px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025);color:#fff;cursor:pointer;text-align:left;transition:background .15s,border-color .15s,transform .1s;width:100%}
.team-pick-btn:hover{background:rgba(251,146,60,.08);border-color:rgba(251,146,60,.3)}
.team-pick-btn:active{transform:scale(.98)}
.team-pick-btn.active{background:linear-gradient(135deg,rgba(215,164,45,.15),rgba(215,164,45,.05));border-color:rgba(215,164,45,.5);color:#f4d878}
.team-pick-btn.has-photos .team-pick-meta{color:#fdba74;font-weight:700}
.team-pick-btn.active.has-photos .team-pick-meta{color:#f4d878}
.team-pick-btn .team-logo,.team-pick-btn img{width:28px;height:28px;border-radius:6px;object-fit:contain;flex-shrink:0}
.team-pick-name{font-weight:700;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:2px}
.team-pick-meta{font-size:.72rem;color:rgba(255,255,255,.5);font-weight:600;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}

/* ---- Drop zone admin ---- */
.photos-dropzone{position:relative;border:2px dashed rgba(255,235,176,.25);border-radius:14px;padding:24px 16px;text-align:center;background:rgba(255,235,176,.03);transition:transform .2s ease,background-color .2s ease,border-color .2s ease,box-shadow .2s ease;cursor:default;margin-bottom:12px}
.photos-dropzone.is-drag-over{border-color:#fbe98a;background:rgba(255,235,176,.12);transform:scale(1.01)}
.dropzone-content{display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.dropzone-icon{font-size:2.2rem;line-height:1;opacity:.85}
.dropzone-text{display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:auto}
.dropzone-text strong{font-size:1rem;color:#fff}
.dropzone-text small{color:rgba(255,255,255,.6);font-size:.85rem}
.dropzone-hint{color:rgba(255,255,255,.45);font-size:.72rem;letter-spacing:.02em;pointer-events:none}
.link-btn{background:none;border:0;color:#fbe98a;cursor:pointer;font-weight:700;font-size:inherit;padding:0;text-decoration:underline;font-family:inherit}
.link-btn:hover{color:#fff}

/* ---- Upload progress list ---- */
.upload-list{display:flex;flex-direction:column;gap:8px;margin:12px 0}
.upload-item{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
.upload-item-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.82rem;margin-bottom:6px}
.upload-item-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;color:#fff}
.upload-item-size{font-size:.72rem;color:rgba(255,255,255,.5);flex-shrink:0;font-variant-numeric:tabular-nums}
.upload-item-bar{height:6px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;margin-bottom:6px}
.upload-item-fill{height:100%;width:0%;background:linear-gradient(90deg,#fbe98a,#d7a42d);transition:width .25s;border-radius:4px}
.upload-item-fill.ok{background:linear-gradient(90deg,#d7a42d,#f4d878)}
.upload-item-fill.fail{background:linear-gradient(90deg,#dc2626,#f97316)}
.upload-item-status{font-size:.72rem;color:rgba(255,255,255,.5);display:block}
.upload-item-status.ok{color:#f4d878}
.upload-item-status.fail{color:#fca5a5}

/* ---- Photos grid + thumb (admin + pubblico) ---- */
.photos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-top:12px}
.photo-thumb{position:relative;margin:0;border-radius:12px;overflow:hidden;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);transition:transform .15s,border-color .15s,box-shadow .15s}
.photo-thumb:hover{transform:translateY(-2px);border-color:rgba(255,235,176,.4);box-shadow:0 8px 20px -8px rgba(0,0,0,.6)}
.photo-thumb.is-selected{border-color:#d7a42d;box-shadow:0 0 0 2px rgba(215,164,45,.3),0 8px 20px -8px rgba(0,0,0,.6)}
.photo-img-wrap{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:#0a0a0a}
.photo-img-wrap img{display:block;width:100%;height:100%;object-fit:cover;cursor:zoom-in;transition:transform .25s}
.photo-thumb:hover .photo-img-wrap img{transform:scale(1.05)}
.photo-overlay{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:flex-end;gap:6px;padding:8px;background:linear-gradient(180deg,rgba(0,0,0,.4) 0%,transparent 40%);opacity:0;transition:opacity .15s;pointer-events:none}
.photo-thumb:hover .photo-overlay,.photo-thumb.is-selected .photo-overlay{opacity:1}
.photo-action-btn{width:32px;height:32px;border-radius:50%;background:rgba(15,15,12,.85);color:#fff;border:1px solid rgba(255,255,255,.15);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.95rem;line-height:1;pointer-events:auto;transition:background .15s,transform .1s}
.photo-action-btn:hover{background:#fbe98a;color:#1a0a00;border-color:#fbe98a}
.photo-action-btn:active{transform:scale(.92)}
.photo-action-btn.photo-select{background:rgba(215,164,45,.2);color:#f4d878;border-color:rgba(215,164,45,.4)}
.photo-thumb.is-selected .photo-action-btn.photo-select{background:#d7a42d;color:#053a1f;border-color:#d7a42d}
.photo-thumb figcaption{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;font-size:.74rem;background:rgba(15,15,12,.85)}
.photo-thumb figcaption .photo-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-weight:600;flex:1;min-width:0}
.photo-thumb figcaption small{font-size:.7rem;color:rgba(255,255,255,.5);font-variant-numeric:tabular-nums;flex-shrink:0}
.photo-delete-btn{position:absolute;top:6px;left:6px;width:28px;height:28px;border-radius:50%;background:rgba(220,38,38,.92);color:#fff;border:0;font-size:1rem;font-weight:900;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.5);opacity:0;transition:opacity .15s,transform .1s}
.photo-thumb:hover .photo-delete-btn{opacity:1}
.photo-delete-btn:hover{background:#dc2626;transform:scale(1.1)}
.photo-delete-btn:active{transform:scale(.95)}
.photo-download-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:rgba(215,164,45,.18);color:#f4d878;text-decoration:none;font-size:.95rem;flex-shrink:0;transition:background .15s}
.photo-download-btn:hover{background:#d7a42d;color:#053a1f}

/* Mobile: gli overlay sono sempre visibili (no hover su touch) */
@media (hover:none){
  .photo-overlay{opacity:.9}
  .photo-delete-btn{opacity:.9}
}

/* ---- Bulk actions bar admin ---- */
.photos-bulk-bar{position:sticky;bottom:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;margin-top:16px;background:linear-gradient(180deg,rgba(15,15,12,.7) 0%,rgba(15,15,12,.95) 50%);backdrop-filter:blur(10px);border-top:1px solid rgba(215,164,45,.3);border-radius:12px;box-shadow:0 -4px 16px rgba(0,0,0,.4);z-index:10}
.photos-bulk-bar .bulk-info{color:#f4d878;font-size:.9rem}
.photos-bulk-bar .bulk-info strong{font-size:1.1rem;font-weight:800}
.photos-bulk-bar .bulk-actions{display:flex;gap:8px;flex-wrap:wrap}

/* ---- Empty state ---- */
.photos-empty{padding:32px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;color:rgba(255,255,255,.7)}
.photos-empty .empty-icon{font-size:3rem;opacity:.5;line-height:1}
.photos-empty small{color:rgba(255,255,255,.4);font-size:.8rem;max-width:300px;margin-top:4px}

/* =====================================================================
   Lato pubblico: pillole squadra + grid + bottone scarica
   ===================================================================== */
.photos-public-card .section-title{flex-wrap:wrap;gap:12px}
.photos-public-card .section-title > button{margin-left:auto}
#publicPhotosDownloadAllBtn{display:inline-flex;align-items:center;gap:6px;font-size:.88rem;padding:8px 16px;min-height:40px}
#publicPhotosDownloadAllBtn .dl-icon{font-size:1rem}
.photos-team-bar{display:flex;gap:8px;padding:8px 4px 12px;margin:8px 0 16px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;border-bottom:1px solid rgba(255,255,255,.06)}
.photos-team-bar::-webkit-scrollbar{height:4px}
.photos-team-bar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:2px}
.photos-team-pill{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:.86rem;flex-shrink:0;scroll-snap-align:start;transition:transform .15s ease,background-color .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease;font-weight:600}
.photos-team-pill:hover{background:rgba(255,235,176,.1);border-color:rgba(255,235,176,.3)}
.photos-team-pill:active{transform:scale(.96)}
.photos-team-pill.active{background:linear-gradient(135deg,#fbe98a,#fdba74);color:#1a0a00;border-color:#fbe98a;font-weight:700;box-shadow:0 2px 8px rgba(251,146,60,.3)}
.photos-team-pill .team-logo,.photos-team-pill img{width:22px;height:22px;border-radius:4px;object-fit:contain;flex-shrink:0}
.photos-team-name{font-weight:600;white-space:nowrap}
.photos-team-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:rgba(0,0,0,.25);font-size:.72rem;font-weight:800;font-variant-numeric:tabular-nums}
.photos-team-pill.active .photos-team-count{background:rgba(0,0,0,.18);color:#1a0a00}

/* =====================================================================
   Lightbox full-screen (admin + pubblico)
   ===================================================================== */
.photos-lightbox{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.94);display:none;flex-direction:column;align-items:center;justify-content:center;animation:lbFadeIn .2s ease}
.photos-lightbox.open{display:flex}
@keyframes lbFadeIn{from{opacity:0}to{opacity:1}}
.lightbox-close{position:absolute;top:16px;right:16px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;border:0;font-size:1.6rem;line-height:1;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .1s}
.lightbox-close:hover{background:rgba(255,255,255,.2)}
.lightbox-close:active{transform:scale(.92)}
.lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);width:54px;height:54px;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;border:0;font-size:2rem;line-height:1;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;transition:background .15s}
.lightbox-nav:hover{background:rgba(255,255,255,.2)}
.lightbox-prev{left:16px}
.lightbox-next{right:16px}
.lightbox-stage{flex:1;display:flex;align-items:center;justify-content:center;width:100%;max-width:100vw;padding:24px;overflow:hidden}
.lightbox-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.5);user-select:none;-webkit-user-drag:none}
.lightbox-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 24px;background:rgba(15,15,12,.7);width:100%;max-width:900px;border-radius:12px;margin:0 16px 16px;backdrop-filter:blur(10px)}
.lightbox-meta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.lightbox-name{color:#fff;font-weight:700;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lightbox-counter{color:rgba(255,255,255,.55);font-size:.78rem;font-variant-numeric:tabular-nums}
.lightbox-download{flex-shrink:0;text-decoration:none}

/* Spinner per download zip */
.spinner-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#fff;animation:spinPulse 1s ease-in-out infinite;margin-right:6px;vertical-align:middle}
@keyframes spinPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}

/* =====================================================================
   RESPONSIVE: tablet e cellulare
   ===================================================================== */
@media (max-width:900px){
  .photos-admin-grid{grid-template-columns:1fr;gap:12px}
  .photos-sidebar{position:relative;top:0;max-height:none;order:0}
  .photos-sidebar .team-pick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;max-height:none}
  .team-pick-btn{grid-template-columns:24px 1fr;padding:8px 10px}
  .team-pick-btn .team-pick-meta{grid-column:1/-1;text-align:right;margin-top:2px}
  .photos-workspace{order:1}
}
@media (max-width:600px){
  .photos-grid{grid-template-columns:repeat(2,1fr);gap:8px}
  .photos-dropzone{padding:18px 12px}
  .dropzone-icon{font-size:1.8rem}
  .dropzone-text strong{font-size:.9rem}
  .photo-thumb figcaption{padding:6px 8px;font-size:.7rem}
  .photo-thumb figcaption small{display:none}
  .photos-bulk-bar{flex-direction:column;gap:8px;align-items:stretch;text-align:center;padding:10px}
  .photos-bulk-bar .bulk-actions{justify-content:center}
  .photos-public-card .section-title{flex-direction:column;align-items:flex-start}
  .photos-public-card .section-title > button{margin-left:0;width:100%;justify-content:center}
  .photos-team-pill{font-size:.8rem;padding:7px 12px}
  .photos-team-pill .team-logo,.photos-team-pill img{width:20px;height:20px}
}
@media (max-width:380px){
  .photos-grid{gap:6px}
  .photo-img-wrap{aspect-ratio:1/1}
}

/* Lightbox responsive */
@media (max-width:600px){
  .lightbox-close{top:10px;right:10px;width:40px;height:40px;font-size:1.4rem}
  .lightbox-nav{width:44px;height:44px;font-size:1.6rem}
  .lightbox-prev{left:8px}
  .lightbox-next{right:8px}
  .lightbox-stage{padding:12px}
  .lightbox-bar{margin:0 8px 8px;padding:10px 14px;gap:10px;flex-direction:column;align-items:stretch}
  .lightbox-bar .lightbox-meta{text-align:center}
  .lightbox-download{align-self:center;min-width:140px;text-align:center}
}

/* =====================================================================
   v92 - Micro-interazioni e polish UI foto
   ===================================================================== */

/* ---- Fade-in elegante delle thumb (skeleton + load) ---- */
/* Animazione di entrata ridotta: prima fino a 500ms di delay accumulato
   facevano percepire la griglia come "lenta a comparire" anche quando le
   immagini erano già pronte. Ora 180ms massimi e durata più contenuta. */
.photo-thumb{opacity:0;animation:thumbEnter .22s ease-out forwards;animation-delay:var(--enter-delay,0ms)}
@keyframes thumbEnter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.photo-img-wrap{background:linear-gradient(135deg,#0a0a0a 25%,#1a1a1a 50%,#0a0a0a 75%);background-size:200% 200%;animation:skeleton 1.5s ease-in-out infinite}
/* Le immagini partono visibili - il fade arriva solo se le marchiamo .is-loading.
   In questo modo evitiamo il dead-lock di lazy-loading + opacity:0. */
.photo-img-wrap img{opacity:1;transition:opacity .25s ease}
.photo-img-wrap img.is-loading{opacity:0}
.photo-img-wrap img.loaded{opacity:1}
/* FIX: il JS aggiunge `.is-loaded` al .photo-thumb (NON `.loaded` all'img),
   quindi lo shimmer scheletro deve fermarsi quando il PARENT è is-loaded.
   Senza questo fix lo shimmer continuava a girare indefinitamente dietro
   ogni foto, dando l'impressione che stessero ancora caricando. */
.photo-thumb.is-loaded .photo-img-wrap{animation:none;background:#0a0a0a}
.photo-img-wrap:has(img.loaded){animation:none;background:#0a0a0a}
@keyframes skeleton{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}

/* ---- Lightbox: animazione open + zoom toggle ---- */
.photos-lightbox.open .lightbox-img{animation:lbImgEnter .3s cubic-bezier(0.16,1,0.3,1)}
@keyframes lbImgEnter{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
.lightbox-img{transition:transform .3s cubic-bezier(0.16,1,0.3,1);cursor:zoom-in;will-change:transform}
.lightbox-img.is-zoomed{transform:scale(2);cursor:zoom-out;max-width:none;max-height:none}
.lightbox-nav{opacity:.7;transition:opacity .15s,background .15s,transform .12s}
.lightbox-nav:hover{opacity:1;transform:translateY(-50%) scale(1.08)}
.lightbox-close{transition:transform .15s,background .15s}
.lightbox-close:hover{transform:rotate(90deg) scale(1.1)}

/* Hint per la prima foto del lightbox: pulsing dot sulle frecce */
.photos-lightbox.open .lightbox-nav::after{content:'';position:absolute;top:50%;left:50%;width:100%;height:100%;border-radius:50%;background:rgba(255,255,255,.2);transform:translate(-50%,-50%) scale(1);opacity:0;animation:navHint 2s ease-out 1}
@keyframes navHint{0%{opacity:.5;transform:translate(-50%,-50%) scale(.8)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}

/* ---- Pillole squadra pubbliche: indicator animato ---- */
.photos-team-pill{position:relative;overflow:hidden}
.photos-team-pill::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(251,233,138,.4),rgba(251,146,60,.4));opacity:0;transition:opacity .25s;pointer-events:none}
.photos-team-pill.active::before{opacity:0}
.photos-team-pill:active{transform:scale(.94)}

/* ---- Drop zone: pulsa quando vuoto, "respira" leggermente ---- */
.photos-dropzone{animation:dzBreathe 4s ease-in-out infinite}
.photos-dropzone:hover{animation:none}
.photos-dropzone.is-drag-over{animation:dzPulse .5s ease-in-out infinite}
@keyframes dzBreathe{0%,100%{border-color:rgba(255,235,176,.25)}50%{border-color:rgba(255,235,176,.4)}}
@keyframes dzPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
.dropzone-icon{transition:transform .25s}
.photos-dropzone:hover .dropzone-icon{transform:scale(1.1) rotate(-5deg)}
.photos-dropzone.is-drag-over .dropzone-icon{transform:scale(1.3) rotate(8deg)}

/* ---- Bulk bar: slide-up animato ---- */
.photos-bulk-bar{animation:bulkSlideUp .25s ease-out}
@keyframes bulkSlideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}

/* ---- Team pick btn admin: pulsa il counter quando aggiorni foto ---- */
.team-pick-btn .team-pick-meta{transition:color .2s,transform .2s}
.team-pick-btn:hover .team-pick-meta{transform:scale(1.05)}

/* ---- Photo overlay buttons più "ricchi" ---- */
.photo-action-btn{backdrop-filter:blur(8px);box-shadow:0 2px 8px rgba(0,0,0,.4)}
.photo-action-btn:hover{transform:scale(1.12);box-shadow:0 4px 14px rgba(251,233,138,.4)}
.photo-thumb.is-selected{animation:thumbSelected .35s ease-out}
@keyframes thumbSelected{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}

/* ---- Delete button: rotate al hover ---- */
.photo-delete-btn{transition:opacity .15s,transform .2s,background .15s}
.photo-thumb:hover .photo-delete-btn:hover{transform:scale(1.15) rotate(90deg)}

/* ---- Download button thumbnail: bounce su hover ---- */
.photo-download-btn{transition:background .15s,color .15s,transform .15s}
.photo-download-btn:hover{transform:translateY(-1px)}
.photo-download-btn:active{transform:translateY(1px)}

/* ---- Bottone "Scarica tutte ZIP" lato pubblico: gradient animato hover ---- */
#publicPhotosDownloadAllBtn{position:relative;overflow:hidden;transition:transform .15s,box-shadow .2s}
#publicPhotosDownloadAllBtn:not(:disabled):hover{transform:translateY(-2px);box-shadow:0 8px 20px -6px rgba(251,146,60,.5)}
#publicPhotosDownloadAllBtn:not(:disabled):active{transform:translateY(0)}
#publicPhotosDownloadAllBtn::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);transition:left .6s}
#publicPhotosDownloadAllBtn:not(:disabled):hover::before{left:100%}

/* ---- Confirm dialog custom ---- */
.ng-confirm-overlay{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s}
.ng-confirm-overlay.open{opacity:1}
.ng-confirm-card{background:linear-gradient(180deg,#1a1a18,#0f0f0e);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:28px 24px 20px;max-width:380px;width:100%;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,.6);transform:scale(.9) translateY(20px);transition:transform .25s cubic-bezier(0.16,1,0.3,1)}
.ng-confirm-overlay.open .ng-confirm-card{transform:scale(1) translateY(0)}
.ng-confirm-icon{font-size:2.4rem;line-height:1;margin-bottom:8px}
.ng-confirm-title{margin:0 0 8px;color:#fff;font-size:1.1rem;font-weight:800}
.ng-confirm-text{margin:0 0 22px;color:rgba(255,255,255,.65);font-size:.88rem;line-height:1.4}
.ng-confirm-actions{display:flex;gap:10px;justify-content:center}
.ng-confirm-actions .btn{min-width:110px;justify-content:center}

@media (max-width:480px){
  .ng-confirm-card{padding:24px 18px 16px}
  .ng-confirm-actions{flex-direction:column-reverse;gap:8px}
  .ng-confirm-actions .btn{width:100%}
}

/* ---- Section title con gradient sottile dietro ---- */
.photos-public-card .section-title h2,
.photos-workspace .section-title h2{background:linear-gradient(135deg,#fbe98a 0%,#fdba74 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;display:inline-flex;align-items:center;gap:8px}
.photos-workspace .section-title h2 .team-logo,
.photos-workspace .section-title h2 img{-webkit-text-fill-color:initial}

/* ---- Empty state icon più viva ---- */
.photos-empty .empty-icon{animation:emptyBob 3s ease-in-out infinite}
@keyframes emptyBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}

/* ---- Upload item: shimmer durante caricamento ---- */
.upload-item-fill:not(.ok):not(.fail){position:relative;overflow:hidden}
.upload-item-fill:not(.ok):not(.fail)::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);animation:shimmer 1.2s linear infinite}
@keyframes shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}

/* Counter pillola: bounce quando cambia */
.photos-team-count{transition:transform .2s}
.photos-team-pill:hover .photos-team-count{transform:scale(1.1)}

/* Riduzioni motion per chi le preferisce */
@media (prefers-reduced-motion: reduce){
  .photo-thumb,.photos-bulk-bar,.photos-dropzone,
  .lightbox-img,.lightbox-nav,.lightbox-close,
  .ng-confirm-card,.empty-icon,
  .upload-item-fill::after,
  .photos-lightbox.open .lightbox-img{
    animation:none!important;
    transition:none!important;
  }
}

/* =====================================================================
   v93 - Site-wide polish & micro-interactions
   Solo CSS, nessuna modifica alla logica del sito.
   ===================================================================== */

/* ---------- Scrollbar globale coerente al tema ---------- */
*{scrollbar-width:thin;scrollbar-color:rgba(215,164,45,.35) transparent}
*::-webkit-scrollbar{width:10px;height:10px}
*::-webkit-scrollbar-track{background:transparent}
*::-webkit-scrollbar-thumb{background:linear-gradient(180deg,rgba(215,164,45,.3),rgba(215,164,45,.18));border-radius:10px;border:2px solid transparent;background-clip:padding-box}
*::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,rgba(242,210,111,.5),rgba(215,164,45,.35));background-clip:padding-box}

/* ---------- Bottoni: micro-animazioni ---------- */
.btn{
  position:relative;
  overflow:hidden;
  transition:background .15s,border-color .15s,color .15s,transform .12s cubic-bezier(0.16,1,0.3,1),box-shadow .2s;
  -webkit-tap-highlight-color:transparent;
}
.btn:not(:disabled):hover{transform:translateY(-1px)}
.btn:not(:disabled):active{transform:translateY(0) scale(.985)}
.btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(242,210,111,.45),0 0 0 4px rgba(0,0,0,.6)}
.btn.primary:not(:disabled):hover{box-shadow:0 14px 30px -8px rgba(215,164,45,.55),inset 0 1px 0 rgba(255,255,255,.18)}
.btn.danger:not(:disabled):hover{box-shadow:0 12px 28px -8px rgba(229,83,95,.45)}
.btn:disabled{opacity:.5;cursor:not-allowed}

/* Ripple effect sui bottoni primary */
.btn.primary::after{
  content:'';position:absolute;top:50%;left:50%;width:0;height:0;border-radius:50%;
  background:rgba(255,255,255,.5);
  transform:translate(-50%,-50%);
  transition:width .55s ease-out,height .55s ease-out,opacity .55s ease-out;
  opacity:0;pointer-events:none;
}
.btn.primary:active::after{width:300px;height:300px;opacity:0;transition:0s}

/* ---------- Card hover lift ---------- */
.card{
  transition:transform .25s cubic-bezier(0.16,1,0.3,1),border-color .2s,box-shadow .25s;
}
.card:not(.no-hover):hover{
  transform:translateY(-2px);
  border-color:rgba(242,210,111,.35);
  box-shadow:0 26px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,236,168,.1);
}

/* ---------- Tab / Admin nav: indicator animato ---------- */
.tabs,.admin-nav{position:relative}
.tab-btn,.admin-nav a{
  position:relative;
  transition:color .2s,background .2s;
}
.tab-btn::after,.admin-nav a::after{
  content:'';
  position:absolute;
  left:50%;bottom:-1px;
  width:0;height:3px;
  background:linear-gradient(90deg,#b98218,#f4db78);
  border-radius:3px 3px 0 0;
  transform:translateX(-50%);
  transition:width .25s cubic-bezier(0.16,1,0.3,1);
}
.tab-btn:hover::after,.admin-nav a:hover::after{width:35%}
.tab-btn.active::after,.admin-nav a.active::after{width:70%}
.admin-nav a.active::after,.tab-btn.active::after{
  background:linear-gradient(90deg,#fbe98a,#fdba74)
}

/* ---------- Input/select/textarea focus state ---------- */
input,select,textarea{
  transition:border-color .18s,box-shadow .18s,background .15s;
}
input:hover:not(:disabled):not(:focus),
select:hover:not(:disabled):not(:focus),
textarea:hover:not(:disabled):not(:focus){
  border-color:rgba(215,164,45,.45);
  background:rgba(8,8,6,.85);
}
input:focus,select:focus,textarea:focus{
  outline:none;
  box-shadow:0 0 0 4px rgba(215,164,45,.18),0 0 14px -4px rgba(242,210,111,.3)!important;
}

/* ---------- Pill live: rendiamo il dot più "vivo" ---------- */
.pill-live-dot{
  filter:drop-shadow(0 0 4px rgba(220,38,38,.7));
}

/* ---------- Standings table: row hover + smooth ---------- */
.standings-table tbody tr{
  transition:background .15s,transform .12s;
}
.standings-table tbody tr:not(.is-live-row):hover{
  background:rgba(242,210,111,.06);
}
.standings-table .standings-team-row{cursor:pointer;position:relative}
.standings-table .standings-team-row:hover{
  background:rgba(242,210,111,.08)!important;
}
.standings-table .standings-team-row::after{
  content:'→';
  position:absolute;right:8px;top:50%;
  transform:translateY(-50%) translateX(-4px);
  color:rgba(242,210,111,.5);
  opacity:0;
  transition:opacity .15s,transform .2s;
  pointer-events:none;
  font-size:.85rem;
}
.standings-table .standings-team-row:hover::after{
  opacity:1;
  transform:translateY(-50%) translateX(0);
}

/* ---------- Match card: hover effect ---------- */
.match-card,.fixture-card,.public-match-card{
  transition:transform .2s cubic-bezier(0.16,1,0.3,1),border-color .2s,box-shadow .25s;
}
.match-card:hover,.fixture-card:hover,.public-match-card:hover{
  transform:translateY(-2px);
  border-color:rgba(242,210,111,.32);
  box-shadow:0 14px 30px -10px rgba(0,0,0,.5);
}

/* ---------- Notifiche e messaggi: slide-in ---------- */
.message{
  animation:msgSlideIn .3s cubic-bezier(0.16,1,0.3,1);
}
@keyframes msgSlideIn{
  from{opacity:0;transform:translateY(-8px)}
  to{opacity:1;transform:translateY(0)}
}

/* ---------- Banner globale top: slide ---------- */
.ng-banner,.banner,.ng-quiet-banner{
  animation:bannerSlide .3s cubic-bezier(0.16,1,0.3,1);
}
@keyframes bannerSlide{
  from{opacity:0;transform:translateY(-100%)}
  to{opacity:1;transform:translateY(0)}
}

/* ---------- Modal: backdrop blur + smoother open ---------- */
.modal{
  backdrop-filter:blur(6px);
  -webkit-backdrop-filter:blur(6px);
  animation:modalFade .2s ease;
}
@keyframes modalFade{from{opacity:0}to{opacity:1}}
.modal-content{
  animation:modalScale .28s cubic-bezier(0.16,1,0.3,1);
}
@keyframes modalScale{
  from{opacity:0;transform:scale(.92) translateY(20px)}
  to{opacity:1;transform:scale(1) translateY(0)}
}

/* ---------- Mobile bottom nav: shimmer on active ---------- */
.mobile-nav-item{
  transition:color .2s,transform .12s;
  -webkit-tap-highlight-color:transparent;
}
.mobile-nav-item:active{transform:scale(.92)}
.mobile-nav-item .mobile-nav-icon{
  transition:transform .25s cubic-bezier(0.16,1,0.3,1);
}
.mobile-nav-item.active .mobile-nav-icon{
  transform:scale(1.15);
}
.mobile-nav-item.active::before{
  content:'';
  position:absolute;
  top:6px;left:50%;
  width:6px;height:6px;border-radius:50%;
  background:linear-gradient(135deg,#fbe98a,#fdba74);
  transform:translateX(-50%);
  box-shadow:0 0 8px rgba(251,233,138,.7);
  animation:dotPop .35s cubic-bezier(0.16,1,0.3,1);
}
@keyframes dotPop{
  from{opacity:0;transform:translateX(-50%) scale(0)}
  to{opacity:1;transform:translateX(-50%) scale(1)}
}

/* ---------- Logo header: subtle glow pulsing ---------- */
.brand .logo{
  animation:logoBreathe 4s ease-in-out infinite;
}
@keyframes logoBreathe{
  0%,100%{box-shadow:0 0 0 4px rgba(0,0,0,.55),0 0 28px rgba(215,164,45,.38)}
  50%{box-shadow:0 0 0 4px rgba(0,0,0,.55),0 0 38px rgba(242,210,111,.55)}
}

/* ---------- Player/team rows: hover ---------- */
.team-row,.player-row,.article-card,.fixture-row,.ng-disclosure{
  transition:transform .2s cubic-bezier(0.16,1,0.3,1),border-color .2s,background .15s;
}
.team-row:hover,.player-row:hover,.fixture-row:hover{
  transform:translateY(-1px);
  border-color:rgba(242,210,111,.3);
}

/* ---------- Article cards: image zoom on hover ---------- */
.article-card{overflow:hidden}
.article-card .article-image,.article-card img{
  transition:transform .35s cubic-bezier(0.16,1,0.3,1);
}
.article-card:hover .article-image,.article-card:hover img{
  transform:scale(1.04);
}

/* ---------- Disclosure toggle (espandi/comprimi) ---------- */
.ng-disclosure summary,details summary{
  cursor:pointer;
  transition:background .15s;
}
.ng-disclosure summary:hover,details summary:hover{
  background:rgba(242,210,111,.06);
}

/* ---------- Stats grid pop-in al render ---------- */
.stats-grid .stat{
  animation:statPop .4s cubic-bezier(0.16,1,0.3,1);
  animation-fill-mode:both;
}
.stats-grid .stat:nth-child(1){animation-delay:0ms}
.stats-grid .stat:nth-child(2){animation-delay:60ms}
.stats-grid .stat:nth-child(3){animation-delay:120ms}
.stats-grid .stat:nth-child(4){animation-delay:180ms}
.stats-grid .stat:nth-child(5){animation-delay:240ms}
.stats-grid .stat:nth-child(6){animation-delay:300ms}
@keyframes statPop{
  from{opacity:0;transform:translateY(10px) scale(.96)}
  to{opacity:1;transform:translateY(0) scale(1)}
}

/* ---------- Rank badge: gradient lucido ---------- */
.rank{
  transition:transform .2s,box-shadow .2s;
}
.standings-team-row:hover .rank{
  transform:scale(1.08);
  box-shadow:0 4px 12px rgba(215,164,45,.4);
}

/* ---------- Live row in classifica: pulse molto leggero ---------- */
.standings-table tr.is-live-row{
  animation:liveRowGlow 3s ease-in-out infinite;
}
@keyframes liveRowGlow{
  0%,100%{box-shadow:inset 3px 0 0 #fb923c}
  50%{box-shadow:inset 4px 0 0 #fdba74,inset 0 0 30px -10px rgba(251,146,60,.2)}
}

/* ---------- Score badge: pop quando cambia ---------- */
.score-badge{
  transition:transform .15s;
}
.score-badge:hover{transform:scale(1.05)}

/* ---------- Match modal Condividi btn ---------- */
.public-match-actions .btn.primary{
  position:relative;
}

/* ---------- Loading skeleton globale ---------- */
.skeleton{
  background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.09) 50%,rgba(255,255,255,.04) 75%);
  background-size:200% 100%;
  animation:skeletonGlobal 1.4s ease-in-out infinite;
  border-radius:8px;
}
@keyframes skeletonGlobal{
  from{background-position:200% 0}
  to{background-position:-200% 0}
}

/* ---------- Filter bar bottons (match filter toolbar) ---------- */
.match-filter-toolbar .btn,.match-filter-toolbar button{
  transition:transform .15s ease,background-color .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease;
}

/* ---------- Quiet banner che notifica realtime updates ---------- */
.ng-quiet-banner{
  background:linear-gradient(135deg,rgba(215,164,45,.12),rgba(15,15,12,.85))!important;
  border-color:rgba(215,164,45,.3)!important;
  backdrop-filter:blur(8px);
}

/* ---------- Player stats table: row alternance subtle ---------- */
.player-stats-table tbody tr,
.president-stats-table tbody tr{
  transition:background .12s;
}
.player-stats-table tbody tr:hover,
.president-stats-table tbody tr:hover{
  background:rgba(242,210,111,.06);
}

/* ---------- Goal/card icons in match details: bounce ---------- */
.goal-row,.card-row{
  transition:transform .15s,background .12s;
}
.goal-row:hover,.card-row:hover{
  transform:translateX(2px);
  background:rgba(242,210,111,.05);
}

/* ---------- Search input ---------- */
#globalSearch{
  transition:transform .2s ease,background-color .2s ease,border-color .2s ease,box-shadow .2s ease;
}
#globalSearch:focus{
  background:rgba(15,15,12,.95);
}

/* ---------- Brackets nodes ---------- */
.bracket-node,.bracket-match{
  transition:transform .2s,border-color .2s,box-shadow .2s;
}
.bracket-node:hover,.bracket-match:hover{
  transform:scale(1.03);
  border-color:rgba(242,210,111,.4);
  box-shadow:0 8px 20px -8px rgba(0,0,0,.5);
  z-index:1;
}

/* ---------- Brand title gradient (subtile) ---------- */
.brand h1{
  background:linear-gradient(135deg,#fff8e7 0%,#fdba74 70%,#fbe98a 100%);
  -webkit-background-clip:text;
  background-clip:text;
  -webkit-text-fill-color:transparent;
}

/* ---------- Tab/nav transition smooth ---------- */
.tab-panel{
  animation:tabFadeIn .3s ease;
}
@keyframes tabFadeIn{
  from{opacity:0;transform:translateY(6px)}
  to{opacity:1;transform:translateY(0)}
}

/* ---------- Form fields gentle scale on focus (mobile) ---------- */
@media (max-width:600px){
  input:focus,select:focus,textarea:focus{
    transform:scale(1.005);
  }
}

/* ---------- Mobile: scrollbar più discreta ---------- */
@media (max-width:600px){
  *::-webkit-scrollbar{width:4px;height:4px}
}

/* ---------- Quick-card hover (home pubblica) ---------- */
.quick-card{
  transition:transform .2s,border-color .2s,box-shadow .25s;
}
.quick-card:hover{
  transform:translateY(-3px);
  border-color:rgba(242,210,111,.4);
  box-shadow:0 18px 40px -12px rgba(0,0,0,.5);
}

/* ---------- Date/time pills in match cards ---------- */
.match-meta,.match-status,.match-time{
  transition:background .15s;
}

/* ---------- Empty states sitewide: bobbing icon ---------- */
.empty .empty-icon,.empty-state .empty-icon{
  animation:emptyBob 3s ease-in-out infinite;
}

/* ---------- Footer (se presente) ---------- */
footer,.site-footer{
  transition:background .2s;
}

/* ---------- Section title icon (se presenti emoji nei titoli) ---------- */
.section-title h2,.section-title h3{
  transition:color .15s;
}

/* ---------- Selettori radio/checkbox custom ---------- */
input[type="checkbox"]:focus-visible,
input[type="radio"]:focus-visible{
  outline:none;
  box-shadow:0 0 0 3px rgba(242,210,111,.4);
}

/* ---------- Tabs: bottom nav mobile: ripple light ---------- */
.mobile-nav-item::after{
  content:'';
  position:absolute;
  inset:0;
  background:radial-gradient(circle,rgba(255,255,255,.15) 0%,transparent 60%);
  opacity:0;
  border-radius:inherit;
  pointer-events:none;
  transition:opacity .2s;
}
.mobile-nav-item:active::after{opacity:1;transition:0s}

/* ---------- Tooltip per buttons accessibility (title attribute) ---------- */
[title]:hover{cursor:help}
.btn[title]:hover,[data-team-pick][title]:hover,[data-photo-open][title]:hover,[data-delete-photo][title]:hover{cursor:pointer}

/* ---------- Selezione testo color custom ---------- */
::selection{
  background:rgba(242,210,111,.3);
  color:#fff;
}
::-moz-selection{
  background:rgba(242,210,111,.3);
  color:#fff;
}

/* ---------- Match-action-card (admin command center): pop-in ---------- */
.match-action-card{
  transition:transform .2s,border-color .2s,box-shadow .2s;
}
.match-action-card:hover{
  transform:translateY(-3px) scale(1.02);
  border-color:rgba(242,210,111,.5);
  box-shadow:0 16px 36px -10px rgba(0,0,0,.5);
}

/* ---------- Spinner globale ---------- */
.ng-spinner{
  display:inline-block;
  width:18px;height:18px;
  border:2px solid rgba(255,255,255,.15);
  border-top-color:#fbe98a;
  border-radius:50%;
  animation:spinG 0.75s linear infinite;
}
@keyframes spinG{to{transform:rotate(360deg)}}

/* ---------- Notification button (live notif) animazione ---------- */
.ng-live-notif{
  animation:notifPop .35s cubic-bezier(0.16,1,0.3,1);
}
@keyframes notifPop{
  from{opacity:0;transform:translateX(100%) scale(.9)}
  to{opacity:1;transform:translateX(0) scale(1)}
}

/* ---------- Riduzioni motion ---------- */
@media (prefers-reduced-motion: reduce){
  .btn,.card,.tab-btn,.admin-nav a,
  .standings-team-row,.match-card,.fixture-card,.public-match-card,
  .mobile-nav-item,.brand .logo,
  .stats-grid .stat,.bracket-node,.bracket-match,
  .quick-card,.match-action-card,
  .ng-banner,.banner,.message,
  .modal,.modal-content,.tab-panel,
  .empty .empty-icon,.empty-state .empty-icon,
  .article-card .article-image,
  .standings-table tr.is-live-row{
    animation:none!important;
    transition:none!important;
  }
  .btn:hover,.card:hover{transform:none!important}
}

/* =====================================================================
   v94 - Upload panel batch admin (preview thumbnail + cancel + parallelo)
   ===================================================================== */
.upload-panel{
  margin:12px 0;
  border-radius:14px;
  background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.08);
  padding:12px;
  animation:msgSlideIn .3s cubic-bezier(0.16,1,0.3,1);
}
.upload-panel-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  padding:0 4px 10px;
  border-bottom:1px solid rgba(255,255,255,.06);
  margin-bottom:10px;
  flex-wrap:wrap;
}
.upload-panel-info{
  font-size:.86rem;
  color:rgba(255,255,255,.75);
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.upload-panel-info strong{
  color:#fbe98a;
  font-size:1.02rem;
}
.upload-panel-skipped{
  color:rgba(252,165,165,.85);
  background:rgba(229,83,95,.15);
  padding:2px 8px;
  border-radius:6px;
  font-size:.7rem;
  margin-left:6px;
}
.upload-list{
  display:flex;
  flex-direction:column;
  gap:8px;
  max-height:420px;
  overflow-y:auto;
  padding-right:4px;
}

/* Upload item con thumbnail preview */
.upload-item{
  display:grid;
  grid-template-columns:48px 1fr 32px;
  gap:10px;
  align-items:center;
  padding:10px;
  border-radius:10px;
  background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.06);
  transition:background .2s,opacity .25s,transform .15s;
}
.upload-item.is-cancelled{
  opacity:.5;
  transform:scale(.98);
}
.upload-item-preview{
  width:48px;
  height:48px;
  border-radius:8px;
  overflow:hidden;
  background:#0a0a0a;
  display:flex;
  align-items:center;
  justify-content:center;
}
.upload-item-preview img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}
.upload-item-body{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:5px;
}
.upload-item-head{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  font-size:.82rem;
}
.upload-item-name{
  font-weight:600;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  flex:1;
  min-width:0;
  color:#fff;
}
.upload-item-size{
  font-size:.72rem;
  color:rgba(255,255,255,.5);
  flex-shrink:0;
  font-variant-numeric:tabular-nums;
}
.upload-item-bar{
  height:5px;
  background:rgba(255,255,255,.06);
  border-radius:4px;
  overflow:hidden;
}
.upload-item-fill{
  height:100%;
  width:0%;
  background:linear-gradient(90deg,#fbe98a,#d7a42d);
  transition:width .3s cubic-bezier(0.16,1,0.3,1);
  border-radius:4px;
  position:relative;
  overflow:hidden;
}
.upload-item-fill.ok{background:linear-gradient(90deg,#d7a42d,#f4d878)}
.upload-item-fill.fail{background:linear-gradient(90deg,#dc2626,#f97316)}
.upload-item-fill.cancel{background:rgba(255,255,255,.2)}
.upload-item-fill:not(.ok):not(.fail):not(.cancel)::after{
  content:'';
  position:absolute;
  inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);
  animation:shimmer 1.2s linear infinite;
}
.upload-item-status{
  font-size:.72rem;
  color:rgba(255,255,255,.55);
  display:block;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.upload-item-status.ok{color:#f4d878}
.upload-item-status.fail{color:#fca5a5}
.upload-item-status.cancel{color:rgba(255,255,255,.55)}
.upload-item-cancel{
  width:28px;
  height:28px;
  border-radius:50%;
  background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.1);
  color:rgba(255,255,255,.7);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:1rem;
  font-weight:700;
  line-height:1;
  transition:background .15s,color .15s,transform .15s;
  align-self:center;
}
.upload-item-cancel:hover{
  background:rgba(229,83,95,.25);
  color:#fff;
  border-color:rgba(229,83,95,.6);
  transform:scale(1.1);
}
.upload-item-cancel:active{transform:scale(.92)}

/* Mobile responsive */
@media (max-width:600px){
  .upload-item{
    grid-template-columns:40px 1fr 26px;
    gap:8px;
    padding:8px;
  }
  .upload-item-preview{
    width:40px;
    height:40px;
  }
  .upload-item-cancel{
    width:26px;
    height:26px;
    font-size:.9rem;
  }
  .upload-panel-head{
    flex-direction:column;
    align-items:stretch;
  }
  .upload-panel-head .btn{
    width:100%;
    justify-content:center;
  }
  .upload-list{
    max-height:60vh;
  }
}

/* =====================================================================
   v95 - Staging panel (preview prima upload) + concurrency 5
   ===================================================================== */
.staging-panel{
  border:1.5px solid rgba(251,233,138,.35);
  background:linear-gradient(180deg,rgba(251,233,138,.06),rgba(15,15,12,.85));
}
.staging-panel .upload-panel-info strong{
  font-size:1.1rem;
}
.upload-panel-actions{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}

/* Staging grid: thumbnail GRANDI per controllo visivo */
.staging-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(130px,1fr));
  gap:10px;
  max-height:420px;
  overflow-y:auto;
  padding:4px;
}

.staging-thumb{
  position:relative;
  margin:0;
  border-radius:10px;
  overflow:hidden;
  background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.1);
  transition:transform .15s,border-color .2s,box-shadow .2s;
  animation:thumbEnter .3s ease-out;
}
.staging-thumb:hover{
  transform:translateY(-2px);
  border-color:rgba(251,233,138,.5);
  box-shadow:0 8px 18px -6px rgba(0,0,0,.5);
}
.staging-thumb-img{
  width:100%;
  aspect-ratio:1/1;
  overflow:hidden;
  background:#0a0a0a;
}
.staging-thumb-img img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}
.staging-thumb figcaption{
  padding:6px 8px;
  display:flex;
  flex-direction:column;
  gap:1px;
  background:rgba(15,15,12,.75);
}
.staging-thumb-name{
  font-size:.72rem;
  font-weight:600;
  color:#fff;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.staging-thumb figcaption small{
  font-size:.66rem;
  color:rgba(255,255,255,.5);
  font-variant-numeric:tabular-nums;
}
.staging-thumb-remove{
  position:absolute;
  top:5px;right:5px;
  width:24px;height:24px;
  border-radius:50%;
  background:rgba(15,15,12,.85);
  color:#fff;
  border:1px solid rgba(255,255,255,.15);
  font-size:.95rem;
  font-weight:700;
  line-height:1;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  backdrop-filter:blur(8px);
  transition:background .15s,transform .15s,color .15s;
  opacity:0;
}
.staging-thumb:hover .staging-thumb-remove{opacity:1}
.staging-thumb-remove:hover{
  background:#dc2626;
  border-color:#dc2626;
  transform:scale(1.1) rotate(90deg);
}
@media (hover:none){
  .staging-thumb-remove{opacity:.9}
}

/* Mobile responsive */
@media (max-width:600px){
  .staging-grid{
    grid-template-columns:repeat(auto-fill,minmax(100px,1fr));
    gap:8px;
  }
  .staging-thumb-remove{
    width:26px;height:26px;
    opacity:.9;
  }
  .upload-panel-actions{
    width:100%;
  }
  .upload-panel-actions .btn{
    flex:1;
  }
  .staging-thumb-name{font-size:.68rem}
}

/* =====================================================================
   v97 - Preview thumbnail nel menù squadra (pillole pubbliche + sidebar admin)
   ===================================================================== */

/* Pillole pubbliche con anteprima foto */
.photos-team-pill .photos-team-preview{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:32px;
  height:32px;
  border-radius:6px;
  overflow:hidden;
  flex-shrink:0;
  background:#0a0a0a;
  border:1px solid rgba(255,255,255,.1);
}
.photos-team-pill .photos-team-preview img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}
.photos-team-pill.active .photos-team-preview{
  border-color:rgba(0,0,0,.2);
}

/* Sidebar admin con anteprima foto squadra */
.team-pick-btn .team-pick-preview{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:36px;
  height:36px;
  border-radius:7px;
  overflow:hidden;
  background:#0a0a0a;
  border:1px solid rgba(255,255,255,.08);
  flex-shrink:0;
}
.team-pick-btn .team-pick-preview img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block;
}
.team-pick-btn.active .team-pick-preview{
  border-color:rgba(215,164,45,.3);
}

@media (max-width:600px){
  .photos-team-pill .photos-team-preview{
    width:28px;
    height:28px;
  }
  .team-pick-btn .team-pick-preview{
    width:32px;
    height:32px;
  }
}

/* =====================================================================
   v99 - Photo thumb polish (fallback elegante + grid migliorata)
   ===================================================================== */

/* Fallback per immagini non caricate: nasconde il bordo rotto e mostra placeholder */
.photo-broken-fallback{
  position:absolute;
  inset:0;
  display:none;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:8px;
  background:linear-gradient(180deg,rgba(36,36,32,.95),rgba(15,15,12,.95));
  color:rgba(255,255,255,.4);
  text-align:center;
  padding:8px;
  pointer-events:none;
}
.photo-broken-icon{
  font-size:2rem;
  opacity:.5;
  filter:grayscale(1);
}
.photo-broken-text{
  font-size:.7rem;
  font-weight:600;
  letter-spacing:.02em;
  text-transform:uppercase;
  color:rgba(255,255,255,.4);
}
.photo-thumb.is-broken .photo-img-wrap img{display:none}
.photo-thumb.is-broken .photo-broken-fallback{display:flex}
.photo-thumb.is-broken{border-color:rgba(255,255,255,.05)}
.photo-thumb.is-broken:hover{transform:none;box-shadow:none}

/* Polish v99: griglia foto pubblica più morbida ed elegante */
.photo-thumb.public{
  border-radius:14px;
  background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.08);
  overflow:hidden;
  transition:transform .25s cubic-bezier(0.16,1,0.3,1),border-color .2s,box-shadow .25s;
}
.photo-thumb.public:hover{
  transform:translateY(-3px);
  border-color:rgba(251,233,138,.45);
  box-shadow:0 14px 30px -10px rgba(0,0,0,.6),0 0 0 1px rgba(251,233,138,.15) inset;
}

/* Wrap immagine: rimuovo lo skeleton-shimmer (era pulsante anche dopo caricamento) */
.photo-thumb.public .photo-img-wrap{
  background:#0a0a0a;
  animation:none;
}
.photo-thumb.public .photo-img-wrap::before{
  /* Sottile gradiente in alto per migliorare la leggibilità in caso di foto chiare */
  content:'';
  position:absolute;
  top:0;left:0;right:0;height:30%;
  background:linear-gradient(180deg,rgba(0,0,0,.25),transparent);
  pointer-events:none;
  z-index:1;
}

/* Figcaption più pulita: nome con peso giusto + spazio */
.photo-thumb.public figcaption{
  background:rgba(12,12,10,.92);
  padding:10px 12px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  border-top:1px solid rgba(255,255,255,.04);
}
.photo-thumb.public .photo-name{
  font-size:.78rem;
  font-weight:600;
  color:rgba(255,255,255,.85);
  letter-spacing:.01em;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  flex:1;
  min-width:0;
}
.photo-thumb.public .photo-download-btn{
  width:30px;
  height:30px;
  border-radius:8px;
  background:rgba(215,164,45,.14);
  color:#f4d878;
  border:1px solid rgba(215,164,45,.25);
  font-size:.95rem;
  font-weight:700;
  flex-shrink:0;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  text-decoration:none;
  transition:background .15s,color .15s,border-color .15s,transform .15s;
}
.photo-thumb.public .photo-download-btn:hover{
  background:#d7a42d;
  color:#053a1f;
  border-color:#d7a42d;
  transform:translateY(-1px);
}
.photo-thumb.public .photo-download-btn:active{transform:translateY(0)}

/* Mobile: caption più stretta */
@media (max-width:600px){
  .photo-thumb.public figcaption{padding:8px 10px}
  .photo-thumb.public .photo-name{font-size:.72rem}
  .photo-thumb.public .photo-download-btn{width:28px;height:28px;font-size:.88rem}
}

/* =====================================================================
   v100 - Smart loading: 3-dot spinner + retry intelligente
   ===================================================================== */

/* Status overlay (loading + error): comune */
.photo-status{
  position:absolute;
  inset:0;
  display:none;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:10px;
  text-align:center;
  padding:12px;
  background:linear-gradient(180deg,rgba(36,36,32,.92),rgba(15,15,12,.95));
  z-index:2;
  pointer-events:none;
}
.photo-status-text{
  font-size:.72rem;
  font-weight:600;
  letter-spacing:.02em;
  color:rgba(255,255,255,.55);
  text-transform:uppercase;
}

/* LOADING state — visibile mentre l'immagine carica o è in retry */
.photo-thumb.is-loading .photo-status-loading{
  display:flex;
}
.photo-thumb.is-loading .photo-img-wrap img{
  opacity:0;
}
.photo-thumb.is-loading{
  pointer-events:auto;
}
.photo-thumb.is-loaded .photo-img-wrap img{
  opacity:1;
  transition:opacity .3s ease;
}

/* Tre puntini animati che pulsano in sequenza */
.photo-status-dots{
  display:inline-flex;
  gap:6px;
  align-items:center;
  justify-content:center;
}
.photo-status-dots span{
  width:8px;
  height:8px;
  border-radius:50%;
  background:#fbe98a;
  display:block;
  animation:dotPulse 1.2s ease-in-out infinite;
  box-shadow:0 0 8px rgba(251,233,138,.5);
}
.photo-status-dots span:nth-child(2){animation-delay:.2s}
.photo-status-dots span:nth-child(3){animation-delay:.4s}
@keyframes dotPulse{
  0%,80%,100%{transform:scale(.7);opacity:.4}
  40%{transform:scale(1.1);opacity:1}
}

/* ERROR state — solo dopo tutti i retry falliti */
.photo-thumb.is-broken .photo-img-wrap img{display:none}
.photo-thumb.is-broken .photo-status-error{display:flex;pointer-events:auto}
.photo-thumb.is-broken{
  border-color:rgba(255,255,255,.05);
}
.photo-thumb.is-broken:hover{
  transform:none;
  box-shadow:none;
}
.photo-status-icon{
  font-size:2rem;
  opacity:.4;
  filter:grayscale(1);
  line-height:1;
}
.photo-status-retry{
  background:rgba(251,233,138,.12);
  border:1px solid rgba(251,233,138,.35);
  color:#fbe98a;
  font-size:.72rem;
  font-weight:700;
  letter-spacing:.04em;
  text-transform:uppercase;
  padding:5px 14px;
  border-radius:8px;
  cursor:pointer;
  pointer-events:auto;
  transition:background .15s,color .15s,transform .15s;
  margin-top:2px;
}
.photo-status-retry:hover{
  background:#fbe98a;
  color:#1a0a00;
  border-color:#fbe98a;
  transform:translateY(-1px);
}
.photo-status-retry:active{transform:translateY(0)}

/* Quando l'immagine carica correttamente, niente più skeleton/loader */
.photo-thumb.is-loaded .photo-status-loading,
.photo-thumb.is-loaded .photo-status-error{
  display:none;
}

/* Nascondo i vecchi fallback v99 (rimangono nel DOM solo per retrocompat ma non più usati) */
.photo-broken-fallback{display:none!important}

/* Mobile responsive */
@media (max-width:600px){
  .photo-status-text{font-size:.66rem}
  .photo-status-icon{font-size:1.6rem}
  .photo-status-retry{font-size:.66rem;padding:4px 10px}
  .photo-status-dots span{width:6px;height:6px}
}

/* Dettaglio partita pubblico: su mobile mostra solo i loghi nel confronto squadre. */
@media (max-width:720px){
  .public-match-modal .public-scoreboard{
    grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
    align-items:center;
  }
  .public-match-modal .public-score-team{
    justify-content:center;
    text-align:center;
    padding-inline:0;
  }
  .public-match-modal .public-score-team strong{
    display:none!important;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    margin-inline:auto;
  }
}

/* v107: dettaglio partita mobile - solo loghi squadra centrati */
@media(max-width:720px){
  .public-match-modal .public-score-team,
  .public-match-modal .public-score-away{
    grid-template-columns:1fr!important;
    justify-items:center!important;
    justify-content:center!important;
    align-items:center!important;
    text-align:center!important;
  }
  .public-match-modal .public-score-team strong{
    display:none!important;
  }
  .public-match-modal .public-score-team .team-logo,
  .public-match-modal .public-score-team .team-logo-fallback{
    order:initial!important;
    grid-row:auto!important;
    margin-inline:auto!important;
    justify-self:center!important;
  }
}


/* v108 - Articoli: layout unificato, anteprime coerenti e immagini verticali/orizzontali */
:root{
  --article-thumb-desktop-w: 320px;
  --article-thumb-desktop-h: 210px;
  --article-thumb-mobile-w: clamp(118px, 38vw, 172px);
  --article-thumb-mobile-h: 154px;
}
#publicArticles .article-list,
#searchResults .article-list,
#adminArticlesList .article-list,
.article-list{
  display:grid!important;
  gap:16px!important;
  width:100%!important;
}
.article-card.sports-news-card,
.article-card.sports-news-card.admin-news-card,
#searchResults .article-card.sports-news-card{
  display:grid!important;
  grid-template-columns:minmax(240px,var(--article-thumb-desktop-w)) minmax(0,1fr)!important;
  grid-template-areas:"media content"!important;
  align-items:center!important;
  min-height:var(--article-thumb-desktop-h)!important;
  max-width:100%!important;
  padding:0!important;
  overflow:hidden!important;
  border-radius:26px!important;
  border:1px solid rgba(255,226,143,.28)!important;
  background:
    radial-gradient(circle at 0% 0%,rgba(255,226,143,.16),transparent 34%),
    linear-gradient(135deg,rgba(20,18,12,.98),rgba(7,7,5,.98) 66%,rgba(32,22,8,.96))!important;
  box-shadow:0 20px 54px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,246,218,.08)!important;
  content-visibility:auto;
  contain-intrinsic-size:1px 230px;
}
.article-card.sports-news-card:hover,
.article-card.sports-news-card:focus-visible{
  border-color:rgba(255,226,143,.54)!important;
  box-shadow:0 24px 70px rgba(0,0,0,.40),0 0 0 1px rgba(255,226,143,.10) inset!important;
}
.article-card.sports-news-card .article-media,
#adminArticlesList .article-media,
#publicArticles .article-media,
#searchResults .article-media{
  grid-area:media!important;
  position:relative!important;
  display:grid!important;
  place-items:center!important;
  width:100%!important;
  height:var(--article-thumb-desktop-h)!important;
  min-height:var(--article-thumb-desktop-h)!important;
  aspect-ratio:auto!important;
  overflow:hidden!important;
  isolation:isolate!important;
  background:
    radial-gradient(circle at 50% 45%,rgba(255,226,143,.15),transparent 44%),
    linear-gradient(135deg,#070604,#181207 70%,#2d210c)!important;
}
.article-card.sports-news-card .article-image,
.article-card.sports-news-card img.article-image,
.article-card.sports-news-card .article-placeholder,
#articleImagePreview .article-image{
  display:block!important;
  width:100%!important;
  height:100%!important;
  min-height:0!important;
  aspect-ratio:auto!important;
  border:0!important;
  border-radius:0!important;
  box-shadow:none!important;
  background:transparent!important;
}
.article-card.sports-news-card img.article-image{
  object-fit:contain!important;
  object-position:center center!important;
  padding:0!important;
  transform:none!important;
  filter:none!important;
}
.article-card.sports-news-card:hover img.article-image{
  transform:none!important;
  filter:saturate(1.05) contrast(1.03)!important;
}
.article-card.sports-news-card .article-placeholder{
  display:grid!important;
  place-items:center!important;
  align-content:center!important;
  background:
    radial-gradient(circle at 50% 28%,rgba(255,231,150,.25),transparent 40%),
    linear-gradient(135deg,#080705,#231706 70%,#ba8d2c)!important;
}
.article-card.sports-news-card .article-media-shade{
  position:absolute!important;
  inset:auto 0 0 0!important;
  height:46%!important;
  background:linear-gradient(180deg,transparent,rgba(0,0,0,.70))!important;
  pointer-events:none!important;
  z-index:1!important;
}
.article-card.sports-news-card .media-kicker{
  position:absolute!important;
  left:14px!important;
  bottom:14px!important;
  z-index:2!important;
}
.article-card.sports-news-card .article-content{
  grid-area:content!important;
  min-width:0!important;
  display:flex!important;
  flex-direction:column!important;
  justify-content:center!important;
  gap:10px!important;
  padding:22px 24px!important;
}
.article-card.sports-news-card .article-content h3{
  max-width:100%!important;
  margin:0!important;
  color:#fff7df!important;
  font-size:clamp(1.35rem,2.4vw,2.05rem)!important;
  line-height:1.04!important;
  letter-spacing:-.045em!important;
  text-wrap:balance!important;
  display:-webkit-box!important;
  -webkit-line-clamp:2!important;
  -webkit-box-orient:vertical!important;
  overflow:hidden!important;
}
.article-card.sports-news-card .article-content p{
  max-width:68ch!important;
  margin:0!important;
  color:#e7dcc3!important;
  font-size:.98rem!important;
  line-height:1.5!important;
  display:-webkit-box!important;
  -webkit-line-clamp:3!important;
  -webkit-box-orient:vertical!important;
  overflow:hidden!important;
}
.article-card.sports-news-card .article-actions,
.article-admin-actions{
  margin-top:6px!important;
  display:flex!important;
  gap:10px!important;
  flex-wrap:wrap!important;
}
.article-card.sports-news-card.admin-news-card .article-actions .btn{
  min-width:108px!important;
}
.image-preview{
  align-items:center!important;
  min-height:132px!important;
}
#articleImagePreview .article-image.small,
#articleImagePreview img.article-image.small,
.image-preview .article-placeholder.small,
.article-placeholder.small{
  width:176px!important;
  height:112px!important;
  min-height:112px!important;
  aspect-ratio:16/10!important;
  object-fit:contain!important;
  border-radius:18px!important;
  border:1px solid rgba(255,226,143,.28)!important;
  background:linear-gradient(135deg,#070604,#181207 70%,#2d210c)!important;
}
#articleImagePreview .article-placeholder.small,
.image-preview .article-placeholder.small{
  display:grid!important;
  place-items:center!important;
  align-content:center!important;
}
@media(max-width:760px){
  .article-card.sports-news-card,
  .article-card.sports-news-card.admin-news-card,
  #searchResults .article-card.sports-news-card{
    grid-template-columns:var(--article-thumb-mobile-w) minmax(0,1fr)!important;
    min-height:var(--article-thumb-mobile-h)!important;
    border-radius:22px!important;
  }
  .article-card.sports-news-card .article-media,
  #adminArticlesList .article-media,
  #publicArticles .article-media,
  #searchResults .article-media{
    height:var(--article-thumb-mobile-h)!important;
    min-height:var(--article-thumb-mobile-h)!important;
  }
  .article-card.sports-news-card .article-content{
    padding:13px 14px!important;
    gap:7px!important;
  }
  .article-card.sports-news-card .article-meta{
    font-size:.72rem!important;
    gap:6px!important;
  }
  .article-card.sports-news-card .article-kicker{
    min-height:22px!important;
    padding:4px 8px!important;
    font-size:.58rem!important;
  }
  .article-card.sports-news-card .media-kicker{
    left:8px!important;
    bottom:8px!important;
  }
  .article-card.sports-news-card .article-content h3{
    font-size:1.08rem!important;
    line-height:1.08!important;
    -webkit-line-clamp:2!important;
  }
  .article-card.sports-news-card .article-content p{
    font-size:.82rem!important;
    line-height:1.35!important;
    -webkit-line-clamp:2!important;
  }
  .article-card.sports-news-card .article-actions,
  .article-admin-actions{
    display:grid!important;
    grid-template-columns:1fr!important;
    gap:7px!important;
    width:100%!important;
  }
  .article-card.sports-news-card .article-actions .btn,
  .article-admin-actions .btn{
    width:100%!important;
    min-height:38px!important;
  }
}
@media(max-width:420px){
  :root{--article-thumb-mobile-w:108px;--article-thumb-mobile-h:142px;}
  .article-card.sports-news-card .article-content{padding:10px 11px!important;}
  .article-card.sports-news-card .article-content h3{font-size:1rem!important;}
  .article-card.sports-news-card .article-content p{-webkit-line-clamp:2!important;}
  .article-card.sports-news-card .article-meta time{display:none!important;}
}

/* V111 · scheda squadra: statistiche per fase */
.team-phase-panel{grid-column:1/-1;}
.team-phase-table-wrap{width:100%;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.16);}
.team-phase-table{width:100%;border-collapse:collapse;min-width:650px;}
.team-phase-table th,.team-phase-table td{padding:10px 9px;border-bottom:1px solid rgba(255,255,255,.08);text-align:center;white-space:nowrap;}
.team-phase-table th:first-child,.team-phase-table td:first-child{text-align:left;min-width:220px;}
.team-phase-table th{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gold);background:rgba(215,164,45,.08);}
.team-phase-table td strong{display:block;color:var(--text);}
.team-phase-table tbody tr:last-child td{border-bottom:0;}
.team-phase-live{display:inline-flex;margin-left:8px;padding:2px 7px;border-radius:999px;background:rgba(239,68,68,.14);color:#fecaca;font-size:.68rem;font-weight:800;vertical-align:middle;}
.team-phase-table-wrap .muted.small{margin:8px 10px 10px;font-size:.78rem;}
.team-sheet-kpis{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));}
@media(max-width:720px){.team-phase-table{min-width:560px}.team-phase-table th,.team-phase-table td{padding:8px 7px;font-size:.82rem}.team-phase-table th:first-child,.team-phase-table td:first-child{min-width:170px}.team-phase-live{display:flex;width:max-content;margin:4px 0 0}}

/* v122-mobile-polish: leggibilità generale + report più editoriali */
body{line-height:1.5}
.muted,.section-title p,.brand p{color:#b7c4d8}
.table-wrap,.team-phase-table-wrap{background:rgba(4,8,14,.24);border-radius:18px}
.table-wrap table th,.team-phase-table th{position:sticky;top:0;z-index:2;background:rgba(20,18,14,.92);backdrop-filter:blur(10px)}
.table-wrap td,.team-phase-table td{vertical-align:middle}
.card,.team-card,.match-card,.player-row,.team-row,.article-card,.modal-content{box-shadow:0 18px 52px rgba(0,0,0,.22)}
.public-match-card,.match-card,.fixture-card{line-height:1.45}
.match-card strong,.team-row strong,.player-row strong,.article-card strong{letter-spacing:-.01em}
.report-mini-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:0 0 16px}
.report-mini-card{border:1px solid rgba(215,164,45,.26);border-radius:18px;padding:14px 15px;background:linear-gradient(180deg,rgba(255,248,230,.07),rgba(255,248,230,.03));display:grid;gap:4px}
.report-mini-card.accent{background:linear-gradient(180deg,rgba(215,164,45,.16),rgba(255,248,230,.06));border-color:rgba(215,164,45,.4)}
.report-mini-card span{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#d6bf87;font-weight:800}
.report-mini-card strong{font-size:1.05rem;letter-spacing:-.03em}
.report-mini-card small{color:#b7c4d8;font-size:.8rem;line-height:1.35}
.report-note{margin:0 0 14px;padding:12px 14px;border-radius:16px;border:1px solid rgba(215,164,45,.26);background:rgba(255,248,230,.06);color:#d9c895;line-height:1.45}
.report-note.warning{background:rgba(215,164,45,.1);border-color:rgba(215,164,45,.42)}
.report-card-upgrade{display:grid;gap:14px}
.pdf-kicker{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#f0d98b;margin-bottom:6px}
.report-section-head{align-items:flex-start}
.report-section-head h2{margin-top:2px}
.report-hero-upgrade{position:relative;overflow:hidden}
.report-hero-upgrade:after{content:"";position:absolute;inset:auto -80px -80px auto;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(255,219,120,.18),transparent 68%);pointer-events:none}
.report-info-grid-upgrade span{min-height:72px;align-content:center}
.pdf-table td strong{color:#fff7df}
.pdf-round-title{padding-left:2px;color:#f0d98b}
.print-report .empty{background:rgba(255,248,230,.04);border-color:rgba(215,164,45,.2)}
@media(max-width:860px){.report-mini-grid{grid-template-columns:1fr 1fr}.report-mini-card strong{font-size:1rem}}
@media(max-width:640px){.report-mini-grid{grid-template-columns:1fr}.table-wrap table th,.team-phase-table th{position:static}.pdf-info-grid.report-info-grid-upgrade{grid-template-columns:1fr 1fr}.report-note{font-size:.9rem}}
@media print{.report-mini-grid{grid-template-columns:repeat(2,1fr)!important;gap:8px!important}.report-mini-card{padding:10px 11px!important;border-radius:12px!important}.report-note{padding:9px 10px!important;border-radius:12px!important;font-size:8.8pt!important}.pdf-kicker{font-size:7pt!important}.report-info-grid-upgrade span{min-height:auto!important}}

/* v122-mobile-polish: schermate mobili più stabili e meno chiusure involontarie */
.modal,.ng-modal-backdrop,.mobile-nav-sheet,.match-filter-sheet{overscroll-behavior:contain;touch-action:manipulation;}
.modal.open,.ng-modal-backdrop.show{touch-action:none;}
.modal-content,.ng-modal,.mobile-nav-panel,.match-filter-panel{overscroll-behavior:contain;touch-action:auto;}
body.modal-open,body.mobile-nav-open{overflow:hidden!important;}
button,.btn,.tab-btn,.match-action-card,.flow-pick-btn,.match-pick-btn,.mobile-nav-item,.mobile-sheet-item{touch-action:manipulation;-webkit-tap-highlight-color:rgba(242,210,111,.18);}
input,select,textarea{font-size:16px;}
.match-task-toolbar,.team-modal-toolbar,.article-modal-toolbar,.mobile-sheet-head{z-index:20;}
.match-task-toolbar .btn.danger,.team-modal-toolbar .btn.danger,.article-modal-toolbar .btn.danger,.match-modal-close{box-shadow:0 0 0 1px rgba(255,255,255,.08),0 10px 28px rgba(0,0,0,.28);}
.match-task-modal,.match-list-modal,.admin-players-modal,.group-move-modal,.modal{cursor:default;}
.match-task-modal::after,.match-list-modal::after,.admin-players-modal::after,.group-move-modal::after,.modal.open::after{content:"";position:absolute;inset:0;pointer-events:none;}
@media(max-width:820px){
  .match-task-content,.match-list-content,.admin-players-content,.team-modal-content,.article-modal-content,.public-match-modal-content{height:100dvh!important;max-height:100dvh!important;overflow:auto!important;-webkit-overflow-scrolling:touch;}
  .match-task-toolbar,.team-modal-toolbar,.article-modal-toolbar,.match-modal-toolbar,.mobile-sheet-head{position:sticky!important;top:0!important;background:rgba(10,8,5,.96);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(242,210,111,.18);}
  .match-task-toolbar,.team-modal-toolbar,.article-modal-toolbar,.match-modal-toolbar{padding-top:calc(12px + env(safe-area-inset-top,0px))!important;}
  #matchTaskBody,#matchListBody,#playersTeamModalBody,#teamModalBody,#articleModalBody,#matchModalBody{padding-bottom:calc(104px + env(safe-area-inset-bottom,0px))!important;}
  .report-complete-form input,.report-complete-form select,.match-edit-form input,.match-edit-form select{min-height:48px;}
  .event-picker-grid .btn,.quick-add-bar .btn,.sticky-save-panel .btn{min-height:50px;}
  .sticky-save-panel{box-shadow:0 -16px 38px rgba(0,0,0,.35);}
  .mobile-nav-backdrop,.modal{user-select:none;}
  .modal-content,.ng-modal,.mobile-nav-panel{user-select:auto;}
}

/* v119 team reports refresh */
.report-team-sheet-upgrade .pro-team-hero{align-items:center;gap:18px}
.report-team-sheet-upgrade .pro-team-title p{max-width:720px}
.team-leader-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.team-leader-card{border:1px solid rgba(215,164,45,.16);border-radius:18px;padding:12px 13px;background:linear-gradient(180deg,rgba(255,246,218,.06),rgba(255,246,218,.02));display:grid;gap:4px}
.team-leader-card span{font-size:.73rem;text-transform:uppercase;letter-spacing:.08em;color:#d6bf87;font-weight:900}
.team-leader-card strong{font-size:1rem;color:#fff7df;letter-spacing:-.02em}
.team-leader-card small{color:var(--muted);font-weight:800;line-height:1.35}
.team-roster-panel-full{grid-column:1 / -1}
.team-roster-table-wrap{width:100%;overflow:auto;border-radius:18px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18)}
.team-roster-table{width:100%;border-collapse:collapse;min-width:620px}
.team-roster-table th,.team-roster-table td{padding:10px 9px;border-bottom:1px solid rgba(255,255,255,.08);text-align:center;white-space:nowrap}
.team-roster-table th:nth-child(2),.team-roster-table td:nth-child(2){text-align:left;min-width:230px}
.team-roster-table th{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gold);background:rgba(215,164,45,.08)}
.team-roster-table td strong{display:block;color:var(--text)}
.team-roster-table td small{display:block;color:var(--muted);font-size:.78rem;font-weight:700;margin-top:2px}
.team-roster-table tbody tr:last-child td{border-bottom:0}
@media(max-width:720px){.team-leader-grid{grid-template-columns:1fr 1fr}.team-roster-table{min-width:560px}}
@media(max-width:560px){.team-leader-grid{grid-template-columns:1fr}}

/* v122-mobile-polish: interfaccia mobile più stabile, app-like e senza sfarfallii */
:root{--ng-app-vh:1vh;--ng-bottom-nav-h:74px;--ng-safe-bottom:env(safe-area-inset-bottom,0px);}
html{overscroll-behavior-y:none;scroll-behavior:auto;-webkit-text-size-adjust:100%;}
body{min-height:calc(var(--ng-app-vh,1vh) * 100);overscroll-behavior-y:none;-webkit-tap-highlight-color:transparent;}
img,.team-logo,.team-logo-fallback,.article-image{backface-visibility:hidden;transform:translateZ(0);}
.tab-panel{min-height:48vh;contain:layout paint;}
.tab-panel:not(.active){display:none!important;visibility:hidden!important;content-visibility:hidden!important;}
.tab-panel.active{display:block!important;visibility:visible!important;content-visibility:visible!important;}
button,.btn,.tab-btn,[role="button"],summary{touch-action:manipulation;-webkit-user-select:none;user-select:none;}
input,select,textarea{touch-action:manipulation;-webkit-user-select:text;user-select:text;}
.public-page .card,.public-page .match-card,.public-page .team-card,.public-page .article-card,.public-page .ng-disclosure,.public-page .team-row,.public-page .player-row{transition:border-color .14s ease,background-color .14s ease,transform .14s ease;}
.public-page .card:active,.public-page .match-card.clickable:active,.public-page .team-row:active,.public-page .article-card:active,.public-page .ng-disclosure-summary:active{transform:scale(.992);}
.modal,.filter-sheet-modal,.mobile-nav-sheet{overscroll-behavior:contain;}
.modal-content,.filter-sheet-panel,.mobile-nav-panel{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
@media(max-width:820px){
  body.public-page{background-attachment:fixed;padding-bottom:calc(var(--ng-bottom-nav-h) + var(--ng-safe-bottom));}
  body.public-page .shell{width:100%;padding:8px 10px calc(var(--ng-bottom-nav-h) + 20px + var(--ng-safe-bottom));}
  body.public-page header{position:sticky;top:0;z-index:50;margin:0 0 10px;border-radius:0 0 24px 24px;background:rgba(8,10,9,.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 12px 32px rgba(0,0,0,.28);}
  body.public-page .tabs{display:none!important;}
  .mobile-bottom-nav{position:fixed;left:8px;right:8px;bottom:calc(8px + var(--ng-safe-bottom));height:var(--ng-bottom-nav-h);z-index:90;display:grid!important;grid-template-columns:repeat(5,1fr);gap:4px;padding:7px;border:1px solid rgba(215,164,45,.28);border-radius:24px;background:rgba(8,9,7,.94);box-shadow:0 18px 54px rgba(0,0,0,.48);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transform:translateZ(0);}
  .mobile-nav-item{min-width:0;min-height:56px;border:0;border-radius:18px;background:transparent;color:#d6caa8;display:grid;place-items:center;gap:1px;font-weight:900;font-size:.68rem;line-height:1;}
  .mobile-nav-item.active{background:linear-gradient(135deg,#b98218,#f4db78);color:#130e06;box-shadow:0 8px 22px rgba(215,164,45,.23);}
  .mobile-nav-icon{font-size:1.1rem;line-height:1;}
  .mobile-nav-sheet{position:fixed;inset:0;z-index:100;display:none;align-items:flex-end;background:rgba(0,0,0,.38);}
  .mobile-nav-sheet.open{display:flex;}
  .mobile-nav-backdrop{position:absolute;inset:0;}
  .mobile-nav-panel{position:relative;width:100%;max-height:72vh;padding:10px 14px calc(18px + var(--ng-safe-bottom));border-radius:26px 26px 0 0;border:1px solid rgba(215,164,45,.25);background:rgba(13,12,9,.98);box-shadow:0 -18px 50px rgba(0,0,0,.45);animation:ngSheetIn .16s ease-out;}
  .mobile-sheet-handle{width:44px;height:5px;border-radius:999px;background:rgba(255,255,255,.22);margin:0 auto 10px;}
  .mobile-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}
  .mobile-sheet-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .mobile-sheet-item{min-height:74px;border:1px solid rgba(215,164,45,.18);border-radius:20px;background:rgba(255,246,218,.06);color:var(--text);display:grid;place-items:center;gap:5px;font-weight:900;}
  .mobile-sheet-item span{font-size:1.3rem;}
  .grid{gap:12px;}
  .card,.team-card,.match-card,.article-card,.ng-disclosure,.team-row,.player-row{border-radius:20px;box-shadow:0 12px 32px rgba(0,0,0,.22);}
  .pad{padding:14px;}
  .stat-strip{grid-template-columns:repeat(2,1fr)!important;gap:8px;}
  .stat{min-height:82px;display:grid;align-content:center;}
  .table-wrap{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
  .table-wrap::-webkit-scrollbar,.team-phase-table-wrap::-webkit-scrollbar,.team-roster-table-wrap::-webkit-scrollbar{display:none;}
  .match-filter-toolbar{position:sticky;top:88px;z-index:25;background:rgba(7,8,6,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:20px;padding:8px;margin:-4px -4px 12px;border:1px solid rgba(215,164,45,.14);}
  .public-match-list,.stack{gap:10px;}
  .public-fixture-card,.public-match-card{min-height:172px;contain:layout paint;}
  .fixture-scoreline{min-height:72px;}
  .fixture-team .team-logo,.fixture-team .team-logo-fallback{flex:0 0 42px;width:42px;height:42px;border-radius:14px;}
  .modal.open{display:flex!important;align-items:stretch;justify-content:stretch;padding:0;background:rgba(0,0,0,.72);}
  .modal-content,.public-match-modal-content,.team-modal-content,.article-modal-content{width:100%!important;height:calc(var(--ng-app-vh,1vh) * 100)!important;max-height:calc(var(--ng-app-vh,1vh) * 100)!important;border-radius:0!important;border:0!important;padding:0!important;overflow:auto!important;background:rgba(9,10,8,.98)!important;animation:ngModalIn .16s ease-out;}
  .match-modal-toolbar,.team-modal-toolbar,.article-modal-toolbar{position:sticky!important;top:0!important;z-index:40;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 12px!important;background:rgba(9,10,8,.96)!important;border-bottom:1px solid rgba(215,164,45,.18);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}
  #matchModalBody,#teamModalBody,#articleModalBody{padding:14px 12px calc(var(--ng-bottom-nav-h) + 28px + var(--ng-safe-bottom))!important;}
  .team-modal .pro-team-sheet,.article-modal .article-detail,.public-match-detail-card{padding:0!important;}
  .filter-sheet-modal{position:fixed;inset:0;z-index:105;display:none;align-items:flex-end;background:rgba(0,0,0,.42);}
  .filter-sheet-modal.open{display:flex;}
  .filter-sheet-panel{width:100%;max-height:78vh;border-radius:26px 26px 0 0;background:rgba(12,11,8,.98);border:1px solid rgba(215,164,45,.24);padding:10px 14px calc(18px + var(--ng-safe-bottom));box-shadow:0 -18px 52px rgba(0,0,0,.45);animation:ngSheetIn .16s ease-out;}
  .filter-sheet-options{max-height:54vh;overflow:auto;-webkit-overflow-scrolling:touch;padding-right:2px;}
  .filter-option{min-height:58px;}
  .team-card-grid{grid-template-columns:1fr;}
  .team-disclosure-list{display:grid;gap:10px;}
  .ng-disclosure-summary{min-height:72px;}
  .photos-grid,.articles-grid{contain:layout paint;}
  .article-card.sports-news-card{min-height:154px;}
  .article-image{background-color:#15120a;}
  .content-visibility-reset,.card,.match-card,.quick-card,.team-disclosure,.article-card{content-visibility:visible!important;contain-intrinsic-size:auto!important;}
}
@keyframes ngSheetIn{from{transform:translate3d(0,18px,0);opacity:.86}to{transform:translate3d(0,0,0);opacity:1}}
@keyframes ngModalIn{from{transform:translate3d(0,10px,0);opacity:.92}to{transform:translate3d(0,0,0);opacity:1}}
@media(max-width:820px) and (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}

/* v122-mobile-polish: consistenza mobile anche lato admin */
@media(max-width:820px){
  body:not(.public-page) .shell{width:100%;padding:8px 10px calc(24px + env(safe-area-inset-bottom,0px));}
  body:not(.public-page) header.site-header{position:sticky;top:0;z-index:55;border-radius:0 0 24px 24px;background:rgba(8,10,9,.94);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
  .admin-nav{position:sticky;top:78px;z-index:45;display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:8px;margin:10px 0;border-radius:18px;background:rgba(8,9,7,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}
  .admin-nav::-webkit-scrollbar{display:none;}
  .admin-nav a{flex:0 0 auto;min-height:42px;display:inline-flex;align-items:center;justify-content:center;padding:10px 13px;border-radius:999px;white-space:nowrap;}
  .admin-nav a.active{background:linear-gradient(135deg,#b98218,#f4db78);color:#130e06;}
  .form-grid{grid-template-columns:1fr!important;}
  .filters{grid-template-columns:1fr!important;}
  input,select,textarea{min-height:48px;}
  .row-actions{grid-template-columns:1fr!important;display:grid;}
  .row-actions .btn,.actions .btn{width:100%;}
  .event-forms-grid{grid-template-columns:1fr!important;}
  .match-card,.team-row,.player-row,.event-row{contain:layout paint;}
}

/* v122-mobile-polish: ulteriore stabilità app-like e meno layout shift */
@media(max-width:820px){
  html,body{overscroll-behavior-y:none;scroll-behavior:auto!important;}
  body.public-page{min-height:calc(var(--ng-app-vh,1vh)*100);background-attachment:scroll!important;}
  .public-page .tab-panel:not(.active){display:none!important;visibility:hidden!important;pointer-events:none!important;}
  .public-page .tab-panel.active{display:block!important;animation:none!important;min-height:calc((var(--ng-app-vh,1vh)*100) - var(--ng-bottom-nav-h,74px) - 140px);}
  .public-page .grid,.public-match-list,#publicTeams,#publicPlayers,#publicBracket,#publicArticles,#searchResults,.photos-grid{overflow-anchor:none;contain:layout paint;}
  .public-page .card,.public-page .match-card,.public-page .team-card,.public-page .article-card,.public-page .public-match-card,.public-page .team-row,.public-page .player-row{backface-visibility:hidden;transform:translateZ(0);will-change:auto;}
  .public-page img,.team-logo,.team-logo-fallback,.article-image,.photo-thumb-img{backface-visibility:hidden;transform:translateZ(0);}
  .public-page .modal,.public-page .mobile-nav-sheet,.public-page .filter-sheet-modal{height:calc(var(--ng-app-vh,1vh)*100)!important;min-height:calc(var(--ng-app-vh,1vh)*100)!important;}
  .public-page .modal-content,.public-page .team-modal-content,.public-page .article-modal-content,.public-page .public-match-modal-content{max-height:calc((var(--ng-app-vh,1vh)*100) - 18px)!important;}
  .mobile-nav-sheet{transition:none!important;}
  .mobile-nav-panel{animation:none!important;transition:none!important;transform:translateY(0)!important;}
  .filter-sheet-panel{animation:none!important;transition:none!important;}
  .mobile-nav-item:active,.tab-btn:active,.btn:active{transform:scale(.985)!important;}
  .public-page input,.public-page select,.public-page textarea{font-size:16px!important;}
  .ng-live-notif-container{top:calc(10px + env(safe-area-inset-top));right:8px;left:8px;}
  .ng-live-notif{width:100%;}
}

/* === v124 · stabilità layout, responsive e accessibilità === */
:root{
  color-scheme:dark;
  --focus-ring:0 0 0 3px rgba(7,11,18,.94),0 0 0 6px rgba(255,224,112,.92);
  --control-height:44px;
}
html{min-width:0;scrollbar-gutter:stable;scroll-padding-top:118px;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{min-width:0;line-height:1.5;overflow-wrap:break-word}
body.modal-open,body.mobile-nav-open{overflow:hidden;overscroll-behavior:none}
.shell,main,section,article,.grid,.card,.section-title,.brand,.actions,.row-actions,.table-wrap{min-width:0}
.skip-link{position:fixed;z-index:20000;top:8px;left:8px;transform:translateY(-160%);padding:10px 14px;border-radius:12px;background:#fff;color:#080b10;font-weight:900;text-decoration:none;box-shadow:0 10px 30px rgba(0,0,0,.38);transition:transform .16s ease}
.skip-link:focus{transform:translateY(0)}
header,.site-header{min-height:90px}
.brand{max-width:100%}
.brand>div:last-child{min-width:0}
.brand h1,.brand p{overflow-wrap:anywhere}
[data-brand-logo]{display:grid;place-items:center;inline-size:56px;block-size:56px;min-inline-size:56px;min-block-size:56px;flex:0 0 56px}
.brand-logo-img{display:block;width:56px;height:56px;object-fit:contain;border-radius:16px}
.brand-logo-img.big{width:82px;height:82px}
img{max-width:100%;height:auto}
.team-logo,.team-logo-fallback{flex:0 0 auto;aspect-ratio:1/1}
.article-image{display:block;max-width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;background:rgba(255,255,255,.035)}
.article-detail-frame .article-image{width:100%;height:100%;object-fit:contain}
button,input,select,textarea{font:inherit}
.btn,.tab-btn,.admin-nav a,.quick-card,.clickable,.match-filter-toolbar button,#globalSearch,.photos-dropzone,.photos-team-pill{
  transition-property:transform,background-color,border-color,color,box-shadow,opacity;
  transition-duration:.16s;
  transition-timing-function:ease;
}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:var(--control-height);line-height:1.15;touch-action:manipulation}
.btn:active{transform:translateY(0) scale(.985)}
.btn:disabled,.btn[aria-disabled="true"]{cursor:not-allowed;opacity:.55;transform:none;filter:saturate(.6)}
input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),select,textarea{min-height:var(--control-height)}
textarea{resize:vertical;min-height:112px}
input::placeholder,textarea::placeholder{color:rgba(212,222,239,.66)}
:where(a,button,input,select,textarea,summary,[tabindex]):focus{outline:none}
:where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{box-shadow:var(--focus-ring)!important;outline:none!important}
.admin-nav a:focus-visible,.quick-card:focus-visible{border-color:rgba(255,224,112,.9)!important}
.admin-nav{grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.tabs{grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.tab-btn[aria-selected="true"]{background:linear-gradient(135deg,var(--primary),var(--blue));color:#1a1408}
.table-wrap{max-width:100%;overflow:auto;overscroll-behavior-inline:contain;scrollbar-gutter:stable both-edges;border-radius:inherit}
.table-wrap:focus-visible{box-shadow:inset 0 0 0 3px rgba(255,224,112,.68)!important}
table{max-width:none}
th,td{overflow-wrap:normal}
.modal,.ng-modal-backdrop,.filter-sheet-modal,.mobile-nav-sheet,.ng-confirm-overlay{overscroll-behavior:contain}
.modal{overflow-y:auto;align-items:flex-start;padding-top:max(18px,env(safe-area-inset-top));padding-bottom:max(18px,env(safe-area-inset-bottom))}
.modal-content,.ng-modal,.filter-sheet-panel,.ng-confirm-card{width:min(100%,760px);max-width:calc(100vw - 24px);max-height:calc(100dvh - 36px);overflow:auto;overscroll-behavior:contain}
.modal-content>*,.ng-modal>*{min-width:0}
.message,[id$="Msg"]{min-height:0}
.message:empty,[id$="Msg"]:empty{display:none}
[aria-busy="true"]{cursor:progress}

@media (hover:none){
  .btn:hover,.quick-card:hover,.clickable:hover,.bracket-node:hover,.bracket-match:hover,.goal-row:hover,.card-row:hover{transform:none}
}
@media(max-width:720px){
  html{scroll-padding-top:16px}
  header,.site-header{min-height:0}
  .brand{align-items:center}
  [data-brand-logo]{inline-size:48px;block-size:48px;min-inline-size:48px;min-block-size:48px;flex-basis:48px}
  .brand-logo-img,.logo{width:48px;height:48px}
  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),select,textarea{font-size:16px}
  .admin-nav{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .admin-nav a{min-height:48px;padding:10px 8px}
  .section-title{display:grid;gap:10px}
  .section-title>.btn,.section-title>.actions{width:100%}
  .row-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
  .row-actions>.btn{width:100%}
  .modal{padding-inline:8px}
  .modal-content,.ng-modal,.filter-sheet-panel,.ng-confirm-card{max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:18px}
}
@media(max-width:420px){
  .shell{width:calc(100% - 12px)}
  .admin-nav{grid-template-columns:1fr}
  .row-actions{grid-template-columns:1fr}
  .actions{display:grid;grid-template-columns:1fr;width:100%}
  .actions>.btn{width:100%}
  .pill{max-width:100%;white-space:normal;text-align:center}
}
@media screen and (max-width:480px){
  .print-page .shell{width:100%;padding:0}
  .print-report{width:100%;min-width:0;padding:12px}
  .print-report .pdf-section,.print-report .print-section{max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto!important}
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
@media(prefers-contrast:more){
  :root{--line:rgba(255,255,255,.28);--muted:#c3ccda}
  .card,input,select,textarea,.btn,.admin-nav,.tabs{border-width:2px}
}
.error-page-card{max-width:760px;margin:clamp(42px,10vh,120px) auto;text-align:center;padding:clamp(24px,5vw,52px)}
.error-page-card h2{font-size:clamp(2rem,7vw,4.5rem);margin:.5em 0 .25em;letter-spacing:-.05em}
.error-page-card .row-actions{justify-content:center;margin-top:24px}
.error-page-card .btn{text-decoration:none}
input[type="checkbox"],input[type="radio"]{inline-size:24px;block-size:24px;min-inline-size:24px;min-block-size:24px;accent-color:var(--primary);cursor:pointer}
input[type="range"]{min-height:32px;cursor:pointer}
input[type="color"]{min-height:44px;padding:4px;cursor:pointer}
@media screen and (max-width:480px){
  .print-page .pdf-table{width:100%!important;min-width:0!important;table-layout:fixed!important}
  .print-page .pdf-table th,.print-page .pdf-table td{white-space:normal!important;overflow-wrap:anywhere!important;padding:4px!important;font-size:.64rem!important}
}
@media screen and (max-width:480px){
  .print-page .calendar-report-table th,.print-page .calendar-report-table td,
  .print-page .standings-report-table th,.print-page .standings-report-table td{width:auto!important;min-width:0!important}
}
.help-box a{display:inline-flex;align-items:center;min-height:24px;color:inherit;font-weight:800;text-underline-offset:3px}

/* === v125 · overlay e controlli a dimensione stabile === */
body.ng-overlay-open{
  overflow:hidden!important;
  overscroll-behavior:none!important;
}
.modal,.ng-modal-backdrop,.filter-sheet-modal,.mobile-nav-sheet,.ng-confirm-overlay,.photos-lightbox{
  isolation:isolate;
}
.ng-modal.card:hover,.modal-content.card:hover,.ng-confirm-card:hover{
  transform:none!important;
}
.ng-confirm-overlay:not(.open):not(.is-closing){pointer-events:none}
.ng-confirm-overlay.is-closing{pointer-events:none}
.message{animation:none}

.btn.is-loading{
  position:relative;
  overflow:hidden;
  white-space:nowrap;
  pointer-events:none;
}
.btn.is-loading .ng-btn-original{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:inherit;
  visibility:hidden;
}
.btn.is-loading .ng-btn-busy-layer{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:inherit;
  pointer-events:none;
}
.ng-btn-spinner{
  inline-size:1em;
  block-size:1em;
  flex:0 0 1em;
  border:2px solid currentColor;
  border-inline-end-color:transparent;
  border-radius:50%;
  animation:ngControlSpin .72s linear infinite;
}
.btn.is-success .ng-btn-spinner,.btn.is-error .ng-btn-spinner{display:none}
@keyframes ngControlSpin{to{transform:rotate(1turn)}}

@media(prefers-reduced-motion:reduce){
  .ng-btn-spinner{animation-duration:1.2s!important}
}

/* Apertura deterministica dei dialoghi amministrativi: solo opacity/transform. */
.ng-modal-backdrop.show{animation:ngAdminBackdropIn .16s ease-out both}
.ng-modal-backdrop.show .ng-modal{animation:ngAdminDialogIn .2s cubic-bezier(.16,1,.3,1) both}
@keyframes ngAdminBackdropIn{from{opacity:0}to{opacity:1}}
@keyframes ngAdminDialogIn{from{opacity:0;transform:translate3d(0,12px,0) scale(.985)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}

/* =====================================================================
   v126 — Consolidation layer: gold polish, layout stability, accessibility
   Single authoritative source for: navigation flow, focus rings, target sizes,
   reduced motion, scrollbar gutter, image dimensions, palette enforcement.
   Lives at the end so it wins specificity ties; uses minimal !important.
   ===================================================================== */

/* --- Layout stability --------------------------------------------------- */
html { scrollbar-gutter: stable both-edges; }
html, body { overflow-x: hidden; }
img, svg, video { max-width: 100%; height: auto; }
img:not([width]):not([height]) { aspect-ratio: auto; }
.team-logo, .team-logo-fallback,
.photo-img-wrap, .person-avatar { contain: layout style; }
main { min-height: 60vh; } /* prevents footer jump while content loads */

/* --- Navigation: NEVER sticky/fixed on page-level scroll --------------- */
header.site-header,
.site-header,
.tabs,
.admin-nav,
.flow-sidebar,
.photos-sidebar,
.photos-bulk-bar,
.public-score-center {
  position: static !important;
  top: auto !important;
  bottom: auto !important;
  max-height: none !important;
}
/* Sticky table headers stay (standard table affordance) */

/* Mobile bottom nav: hide entirely. Top tabs already provide navigation,
   and a fixed bottom bar violates the "no overlay during scroll" rule. */
.mobile-bottom-nav,
.mobile-nav-sheet { display: none !important; }

/* Make main .tabs comfortably scrollable horizontally on small screens
   instead of growing tall + sticky. */
@media (max-width: 720px) {
  .tabs {
    display: flex !important;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 8px;
    padding: 8px;
    scrollbar-width: thin;
    -webkit-overflow-scrolling: touch;
  }
  .tabs .tab-btn { flex: 0 0 auto; min-width: 130px; }
  .admin-nav {
    display: flex !important;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 8px;
    padding: 8px;
    scrollbar-width: thin;
  }
  .admin-nav a { flex: 0 0 auto; min-width: 150px; }
}

/* --- Palette enforcement: gold/black/anthracite/white ----------------- */
.tab-btn.active,
.admin-nav a.active,
.admin-nav a:hover,
.btn.primary,
.score-badge,
.rank,
.pdf-rank,
.team-logo,
.team-logo-fallback {
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-soft) 100%);
  color: var(--gold-ink);
}
.btn.primary { border: 0; }
.btn.primary:hover { box-shadow: 0 8px 24px rgba(215,164,45,.25); }
.tab-btn { color: var(--muted); transition: color .15s ease, background .15s ease; }
.tab-btn:hover { color: var(--text); background: rgba(215,164,45,.08); }

.pill,
.player-chip,
.pdf-pill {
  border: 1px solid rgba(215,164,45,.30);
  background: rgba(215,164,45,.08);
  color: var(--text);
}
.pill-live { background: rgba(229,83,95,.10); border-color: rgba(229,83,95,.32); color: #ffd7da; }
.pill-live-dot { background: var(--danger); }

.card { background: linear-gradient(180deg, rgba(20,17,11,.92), rgba(13,11,7,.92)); border-color: var(--line); }
.help-box { border-color: rgba(215,164,45,.35); background: rgba(215,164,45,.07); color: var(--text); }
.empty { border-color: rgba(215,164,45,.22); background: rgba(215,164,45,.04); color: var(--muted); }

/* Inputs: gold focus */
input, select, textarea {
  background: rgba(5,4,2,.78);
  border-color: rgba(215,164,45,.22);
  color: var(--text);
}
input:focus, select:focus, textarea:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 4px rgba(215,164,45,.18);
}

/* Buttons: neutral default + gold accent on hover */
.btn {
  background: rgba(255,248,231,.05);
  border-color: rgba(215,164,45,.22);
  color: var(--text);
  transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .12s ease;
}
.btn:hover:not(.primary):not(.danger) {
  border-color: var(--gold);
  color: var(--gold-soft);
  background: rgba(215,164,45,.10);
  transform: none; /* override the old translateY hover that caused jitter */
}

.btn.danger {
  background: rgba(229,83,95,.12);
  border-color: rgba(229,83,95,.35);
  color: #ffd7da;
}
.btn.danger:hover { background: rgba(229,83,95,.22); border-color: rgba(229,83,95,.55); }

/* Messages */
.message.ok { background: rgba(215,164,45,.12); border: 1px solid rgba(215,164,45,.32); color: var(--text); }
.message.error { background: rgba(229,83,95,.13); border: 1px solid rgba(229,83,95,.38); color: #ffd7da; }

/* Borders / accents: gold instead of cyan in legacy rules */
.clickable:hover { border-color: var(--gold) !important; }

/* --- Accessibility: focus ring -------------------------------------- */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 3px;
  border-radius: 6px;
}
a:focus-visible, button:focus-visible, .tab-btn:focus-visible,
.admin-nav a:focus-visible, .quick-card:focus-visible {
  outline-color: var(--gold-soft);
  box-shadow: 0 0 0 4px rgba(215,164,45,.25);
}

/* --- Touch target sizes ---------------------------------------------- */
.btn, .tab-btn, .admin-nav a,
button:not(.upload-item-cancel):not(.lightbox-close):not(.photo-action-btn) {
  min-height: 42px;
}
@media (max-width: 720px) {
  .btn, .tab-btn, .admin-nav a { min-height: 44px; }
}

/* --- Skip link (visible on focus) ------------------------------------ */
.skip-link {
  position: fixed;
  z-index: 20000;
  top: 8px; left: 8px;
  transform: translateY(-160%);
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--gold);
  color: var(--gold-ink);
  font-weight: 900;
  text-decoration: none;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
  transition: transform .16s ease;
}
.skip-link:focus { transform: translateY(0); outline: 2px solid var(--gold-ink); }

/* --- Selection ------------------------------------------------------- */
::selection { background: rgba(215,164,45,.45); color: var(--gold-ink); }

/* --- Scrollbar styling (WebKit) ------------------------------------- */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: rgba(255,248,231,.03); }
::-webkit-scrollbar-thumb { background: rgba(215,164,45,.28); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(215,164,45,.48); }

/* --- Reduced motion: strong override -------------------------------- */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .btn:hover, .quick-card:hover { transform: none !important; }
}

/* --- Visual stability for dynamic content --------------------------- */
.tab-panel { min-height: 1px; } /* avoid full-collapse during empty state */
.team-logo, .team-logo-fallback { flex: 0 0 auto; }
table { table-layout: auto; }

/* --- Print refinements ---------------------------------------------- */
@media print {
  body { background: #fff !important; color: #111 !important; }
  .card, .pdf-card, .pdf-hero { box-shadow: none !important; border-color: rgba(0,0,0,.18) !important; }
}

/* --- Body grid overlay (legacy v19) tuned down ---------------------- */
body::before { opacity: .22 !important; }

/* --- Mobile shell adjustments --------------------------------------- */
@media (max-width: 720px) {
  .shell { padding-top: 12px; padding-bottom: 40px; }
  .site-header { border-radius: 22px; padding: 14px; gap: 12px; }
  .brand h1 { font-size: 1.2rem; }
  .brand p { font-size: .82rem; }
  .card { border-radius: 18px; }
  h2 { font-size: 1.2rem; }
  /* Modals: full-screen on small viewports for better touch UX */
  .modal { padding: 0; }
  .modal-content { max-height: 100dvh; height: 100dvh; width: 100vw; border-radius: 0; }
}

/* --- Pill-live red dot animation safety ------------------------------ */
.pill-live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  display: inline-block; flex: 0 0 auto;
}

/* --- Logo refresh: gold concentric mark ------------------------------ */
.logo:before {
  background: linear-gradient(135deg, var(--gold), var(--gold-soft));
}
.logo:after {
  background: #0a0805;
}
.logo span {
  background: radial-gradient(circle at 35% 28%, #fff, #fff3c8 42%, var(--gold) 43%, var(--gold-deep) 70%);
  border-color: #fff;
}
.logo { filter: drop-shadow(0 0 18px rgba(215,164,45,.4)); }

/* --- Tabs container border refinement ------------------------------- */
.tabs {
  border-color: rgba(215,164,45,.20);
  background: rgba(20,17,11,.55);
}

/* --- Site-header refinement ----------------------------------------- */
.site-header {
  background: linear-gradient(135deg, rgba(15,12,7,.94), rgba(22,18,10,.92));
  border-color: rgba(215,164,45,.30);
  box-shadow: 0 22px 60px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,236,168,.08);
}

/* --- Stat cards: gold inflection ------------------------------------ */
.stat strong { color: var(--gold-soft); }
.stat { border-color: rgba(215,164,45,.18); background: rgba(215,164,45,.04); }

/* --- Table headers ------------------------------------------------- */
th { background: rgba(215,164,45,.06); color: var(--gold-soft); }

/* End of v126 consolidation layer */

/* =====================================================================
   v126.1 — Match-state visualization consolidation
   Single authoritative source for the THREE match states the project
   actually supports (store.js: matchStatusInfo / hasScore / isLive):

     status === 'live'                      → key 'live',    label "Live",       class .is-live
     status === 'played' OR has score       → key 'played',  label "Giocata",    class .is-played
     status === 'scheduled' (or unknown)    → key 'pending', label "Da giocare", class .is-pending

   No new states are introduced. All other JS status values
   (admin-photos.js 'done'/'failed'/'cancelled', admin-groups.js 'ok'/'over')
   belong to unrelated domains (upload jobs, group capacity) and are out
   of scope here.

   Goals of this block:
   - resolve the .is-played conflict (gold v35 vs legacy green at line ~1627)
   - replace the semantically-wrong RED .is-pending with a neutral gold-tinted style
   - harmonize .is-live across badge / card / row / score-center
   - guarantee consistent rendering across: match list, match modal,
     bracket, standings live-row, mobile views
   ===================================================================== */

/* ---- .is-played (Giocata) ------------------------------------------- */
/* Authoritative gold style — overrides the legacy green block. */
.match-status-badge.is-played,
.score-badge.match-status-badge.is-played {
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-soft) 100%) !important;
  color: var(--gold-ink) !important;
  border: 1px solid rgba(215,164,45,.55) !important;
  text-shadow: none !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.12) !important;
}
.fixture-center.is-played,
.public-score-center.is-played {
  background: linear-gradient(180deg, rgba(215,164,45,.22), rgba(215,164,45,.06)) !important;
  border-color: rgba(215,164,45,.42) !important;
}
.fixture-center.is-played strong,
.public-score-center.is-played span { color: #fff3c8 !important; }
.public-score-center.is-played em   { color: var(--gold-soft) !important; }

/* ---- .is-pending (Da giocare) — NEUTRAL, NOT RED -------------------- */
/* Pending is a normal future state, not an error. Soft cream-on-bronze. */
.match-status-badge.is-pending,
.score-badge.match-status-badge.is-pending {
  background: rgba(255,248,231,.06) !important;
  color: var(--muted) !important;
  border: 1px solid rgba(215,164,45,.30) !important;
  text-shadow: none !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.04) !important;
  font-weight: 800 !important;
}
.fixture-center.is-pending,
.public-score-center.is-pending {
  background: rgba(255,248,231,.04) !important;
  border-color: rgba(215,164,45,.22) !important;
}
.fixture-center.is-pending strong,
.public-score-center.is-pending span { color: var(--muted) !important; }
.public-score-center.is-pending em   { color: var(--muted) !important; }

/* ---- .is-live (Live) — distinct alert color, brand-aware ------------- */
/* Live keeps its high-visibility red-amber identity (international
   broadcast convention) but harmonized toward the project's --danger
   anchor so the page never shows orange/cyan/green outside the palette. */
.match-status-badge.is-live,
.score-badge.match-status-badge.is-live {
  background: linear-gradient(135deg, #d23044 0%, #f06a4d 100%) !important;
  color: #fff !important;
  border: 1px solid rgba(229,83,95,.7) !important;
  text-shadow: 0 1px 1px rgba(0,0,0,.32) !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.16) !important;
  font-weight: 900 !important;
  letter-spacing: .02em;
}
/* Pulse + dot kept — these come from earlier blocks and already animate.
   Disabled gracefully by the global prefers-reduced-motion override above. */

.is-live-card {
  border-color: rgba(229,83,95,.55) !important;
  box-shadow: 0 0 0 1px rgba(229,83,95,.40), 0 8px 24px -10px rgba(229,83,95,.4) !important;
}
.is-live-card::before {
  background: radial-gradient(120% 60% at 50% -20%, rgba(229,83,95,.18), transparent 60%) !important;
}
.fixture-center.is-live,
.public-score-center.is-live {
  background: linear-gradient(180deg, rgba(229,83,95,.22), rgba(229,83,95,.06)) !important;
  border-color: rgba(229,83,95,.45) !important;
}
.fixture-center.is-live strong,
.public-score-center.is-live span,
.public-score-center.is-live em { color: #ffd7da !important; }

/* Standings: row of a team currently playing live — keep red accent
   coherent with the live badge instead of the previous green/cyan. */
.standings-live-dot,
.pill-live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #e5535f;
  box-shadow: 0 0 0 3px rgba(229,83,95,.20);
  display: inline-block; flex: 0 0 auto;
  animation: ngLiveDot 1s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .standings-live-dot,
  .pill-live-dot,
  .match-status-badge.is-live::after,
  .match-status-badge.is-live { animation: none !important; }
}

/* ---- Touch target & mobile readability of status badges ------------- */
.match-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 6px 12px;
  white-space: nowrap;
  font-weight: 900;
  letter-spacing: .01em;
}
@media (max-width: 720px) {
  .match-status-badge {
    font-size: .80rem;
    padding: 5px 10px;
    min-height: 26px;
  }
  .match-card-head { flex-wrap: wrap; gap: 8px; }
}

/* ---- No layout-shift when the status changes ------------------------ */
/* Badge keeps a min-width so live↔played↔pending swaps don't reflow. */
.match-status-badge { min-width: 84px; }
@media (max-width: 720px) { .match-status-badge { min-width: 76px; } }

/* End of v126.1 match-state consolidation */

/* =====================================================================
   v126.2 — Live badge visibility upgrade
   Goal: make the "Live" badge unmistakable and broadcast-grade across
   every component that surfaces it (badge, card, strip, dot, modal hero,
   pick button). Uses a saturated broadcast-red that contrasts strongly
   with the gold/black/cream base palette and stays readable on both
   dark cards and gold accents. No new states, no logic changes.
   ===================================================================== */

:root {
  --live-red-1: #ff1744;   /* primary saturated red */
  --live-red-2: #ff4d6d;   /* highlight pink-red for gradient sheen */
  --live-red-3: #c4001d;   /* deep red for borders / shadows */
  --live-glow:  rgba(255,23,68,.55);
}

/* ---- Core badge: solid saturated red, white text, glow ring --------- */
.match-status-badge.is-live,
.score-badge.match-status-badge.is-live {
  background: linear-gradient(135deg, var(--live-red-1) 0%, var(--live-red-2) 100%) !important;
  color: #ffffff !important;
  border: 1px solid var(--live-red-3) !important;
  font-weight: 900 !important;
  letter-spacing: .06em !important;
  text-transform: uppercase !important;
  text-shadow: 0 1px 1px rgba(0,0,0,.45) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.25),
    inset 0 -1px 0 rgba(0,0,0,.18),
    0 0 0 1px rgba(255,255,255,.10),
    0 4px 14px -2px var(--live-glow) !important;
  padding: 6px 14px !important;
  position: relative;
  z-index: 1;
}

/* Outer pulsing halo around the badge */
@keyframes ngLiveHalo {
  0%   { box-shadow:
          inset 0 1px 0 rgba(255,255,255,.25),
          inset 0 -1px 0 rgba(0,0,0,.18),
          0 0 0 1px rgba(255,255,255,.10),
          0 0 0 0   var(--live-glow),
          0 4px 14px -2px var(--live-glow); }
  70%  { box-shadow:
          inset 0 1px 0 rgba(255,255,255,.25),
          inset 0 -1px 0 rgba(0,0,0,.18),
          0 0 0 1px rgba(255,255,255,.10),
          0 0 0 10px rgba(255,23,68,0),
          0 4px 14px -2px var(--live-glow); }
  100% { box-shadow:
          inset 0 1px 0 rgba(255,255,255,.25),
          inset 0 -1px 0 rgba(0,0,0,.18),
          0 0 0 1px rgba(255,255,255,.10),
          0 0 0 0 rgba(255,23,68,0),
          0 4px 14px -2px var(--live-glow); }
}
.match-status-badge.is-live,
.score-badge.match-status-badge.is-live {
  animation: ngLiveHalo 1.8s ease-out infinite;
}

/* Inner blinking dot — bigger, brighter, with its own glow */
.match-status-badge.is-live::after {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
  margin-left: 8px;
  vertical-align: middle;
  box-shadow: 0 0 0 2px rgba(255,255,255,.35), 0 0 6px rgba(255,255,255,.6);
  animation: ngLiveDot 1s ease-in-out infinite;
}
@keyframes ngLiveDot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .35; transform: scale(.85); }
}

/* ---- Live card (match-card.is-live-card) ---------------------------- */
.is-live-card {
  border-color: var(--live-red-1) !important;
  background-image:
    linear-gradient(180deg, rgba(255,23,68,.08), rgba(255,23,68,0) 60%),
    linear-gradient(180deg, rgba(20,17,11,.92), rgba(13,11,7,.92));
  box-shadow:
    0 0 0 1px var(--live-red-3),
    0 12px 28px -10px var(--live-glow),
    inset 0 0 0 1px rgba(255,255,255,.04) !important;
}
.is-live-card::before {
  background: radial-gradient(140% 70% at 50% -20%, rgba(255,23,68,.28), transparent 60%) !important;
}

/* ---- Score-center & fixture-center on live matches ------------------- */
.fixture-center.is-live,
.public-score-center.is-live {
  background: linear-gradient(180deg, rgba(255,23,68,.22), rgba(255,23,68,.06)) !important;
  border-color: var(--live-red-1) !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 0 12px -4px var(--live-glow) !important;
}
.fixture-center.is-live strong,
.public-score-center.is-live span,
.public-score-center.is-live em {
  color: #ffe1e6 !important;
  text-shadow: 0 0 12px rgba(255,23,68,.45);
}

/* ---- Live strip (homepage live ticker) ------------------------------- */
.live-strip-home {
  background: linear-gradient(135deg, rgba(255,23,68,.12), rgba(255,77,109,.04)) !important;
  border: 1px solid var(--live-red-1) !important;
  box-shadow: 0 0 0 1px rgba(255,23,68,.18), 0 12px 32px -16px var(--live-glow) !important;
}
.live-strip-head h2 {
  color: #ff8a9c !important;
  text-shadow: 0 0 14px rgba(255,23,68,.25);
}
.live-strip-dot {
  width: 12px; height: 12px;
  background: var(--live-red-1) !important;
  box-shadow: 0 0 0 4px rgba(255,23,68,.22), 0 0 10px rgba(255,23,68,.5);
  animation: ngLiveHalo 1.6s ease-out infinite;
}
.live-strip-card {
  border-color: rgba(255,23,68,.45) !important;
  background: linear-gradient(180deg, rgba(35,10,15,.55), rgba(20,17,11,.55)) !important;
}
.live-strip-card:hover,
.live-strip-card:focus {
  border-color: var(--live-red-1) !important;
  box-shadow: 0 10px 26px -10px var(--live-glow) !important;
}
.live-strip-score {
  color: #ff4d6d !important;
  text-shadow: 0 0 14px rgba(255,23,68,.35) !important;
}
.live-strip-team strong { color: #fff !important; }

/* ---- Standings live row + live dot indicator ------------------------ */
.standings-live-dot,
.pill-live-dot {
  width: 9px; height: 9px;
  background: var(--live-red-1) !important;
  box-shadow: 0 0 0 3px rgba(255,23,68,.22), 0 0 8px rgba(255,23,68,.5);
}
.standings-table tr.is-live-row,
.standings-table tr.standings-team-row.is-live-row {
  background: linear-gradient(90deg, rgba(255,23,68,.14), rgba(255,23,68,.04) 60%, transparent) !important;
  border-left: 3px solid var(--live-red-1);
}
.standings-table tr.is-live-row td strong,
.standings-table tr.standings-team-row.is-live-row td strong {
  color: #ffd3da !important;
}
.standings-table tr.is-live-row td:first-child .rank,
.standings-table tr.standings-team-row.is-live-row td:first-child .rank {
  background: linear-gradient(135deg, var(--live-red-1), var(--live-red-2)) !important;
  color: #fff !important;
}

/* ---- Pill-live (header connection indicator: keep red identity) ----- */
.pill-live {
  background: rgba(255,23,68,.10) !important;
  border-color: var(--live-red-1) !important;
  color: #ffd3da !important;
}

/* ---- Reduced motion --------------------------------------------------*/
@media (prefers-reduced-motion: reduce) {
  .match-status-badge.is-live,
  .score-badge.match-status-badge.is-live,
  .live-strip-dot,
  .standings-live-dot,
  .pill-live-dot,
  .match-status-badge.is-live::after { animation: none !important; }
  /* Keep the red color + dot, just stop the pulse. The badge stays
     fully readable and clearly distinct from played/pending. */
}

/* ---- Mobile readability of live badge -------------------------------- */
@media (max-width: 720px) {
  .match-status-badge.is-live,
  .score-badge.match-status-badge.is-live {
    padding: 5px 11px !important;
    font-size: .78rem !important;
    letter-spacing: .05em !important;
  }
  .match-status-badge.is-live::after {
    width: 7px; height: 7px; margin-left: 6px;
  }
}

/* End of v126.2 live badge visibility upgrade */

/* =====================================================================
   v126.3 — "Giocata" (.is-played) → forest green
   Tonalità scelta: verde foresta → smeraldo. Coppia classica con l'oro
   del brand (livree premio, motorsport, orologeria). Distinta dall'oro
   (che resta riservato a "vincitore" nel bracket e ad accenti brand),
   semanticamente leggibile come "completato/positivo".
   Palette: #0d7a3e (deep) → #22c55e (sheen) — bordo #054d24, testo cream-mint.
   Nessuna logica modificata; nessuno stato introdotto.
   ===================================================================== */

:root {
  --played-green-1: #0d7a3e;   /* deep forest */
  --played-green-2: #22c55e;   /* emerald sheen */
  --played-green-3: #054d24;   /* deep border */
  --played-mint:    #d6ffe5;   /* cream-mint text */
}

/* ---- Badge ----------------------------------------------------------- */
.match-status-badge.is-played,
.score-badge.match-status-badge.is-played {
  background: linear-gradient(135deg, var(--played-green-1) 0%, var(--played-green-2) 100%) !important;
  color: #ffffff !important;
  border: 1px solid var(--played-green-3) !important;
  text-shadow: 0 1px 1px rgba(0,0,0,.35) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.20),
    inset 0 -1px 0 rgba(0,0,0,.18),
    0 0 0 1px rgba(255,255,255,.08),
    0 3px 10px -2px rgba(13,122,62,.45) !important;
  font-weight: 900 !important;
  letter-spacing: .02em !important;
}

/* ---- Score-center / fixture-center on played matches ---------------- */
.fixture-center.is-played,
.public-score-center.is-played {
  background: linear-gradient(180deg, rgba(34,197,94,.20), rgba(13,122,62,.08)) !important;
  border-color: rgba(13,122,62,.55) !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.06), 0 0 10px -4px rgba(13,122,62,.4) !important;
}
.fixture-center.is-played strong,
.public-score-center.is-played span {
  color: var(--played-mint) !important;
  text-shadow: 0 0 10px rgba(13,122,62,.35);
}
.public-score-center.is-played em {
  color: #b4f0c8 !important;
}

/* ---- PDF / print: .pdf-status.done condivide la stessa semantica ---- */
.pdf-status.done {
  background: linear-gradient(135deg, var(--played-green-1), var(--played-green-2)) !important;
  color: #ffffff !important;
  border: 1px solid var(--played-green-3) !important;
  text-shadow: 0 1px 1px rgba(0,0,0,.25);
}

/* ---- NOTE: .bracket-team.winner resta ORO ---------------------------
   Il "vincitore" nel bracket è un concetto diverso da "partita giocata":
   l'oro segnala il trofeo / l'avanzamento, il verde segnala la chiusura
   del referto. Mantenerli distinti aiuta la lettura del bracket.
   ===================================================================== */

/* ---- Reduced motion: il verde è già statico, nulla da disattivare --- */

/* ---- Mobile readability --------------------------------------------- */
@media (max-width: 720px) {
  .match-status-badge.is-played,
  .score-badge.match-status-badge.is-played {
    padding: 5px 11px !important;
    font-size: .78rem !important;
  }
}

/* End of v126.3 played-green */

/* =====================================================================
   v126.4 — Mobile bottom nav restore + focus-ring scoping + fluidity
   Three concrete fixes:

   1) GOLD BORDER AT OPEN
      Causa: il layer v126 aveva
          :focus-visible { outline: 2px solid var(--gold); }
      che si applicava ANCHE a <main id="main-content" tabindex="-1">
      quando lo skip-link o un focus programmatico vi atterravano sopra.
      Fix: scope di :focus-visible ai soli elementi realmente
      interattivi (a/button/input/select/textarea/summary e
      [tabindex] diversi da -1). main, section, article, .shell e
      .tab-panel non possono più ricevere il bordo oro.

   2) MOBILE BOTTOM NAV
      Causa: in v126 era stato disabilitato globalmente con
          .mobile-bottom-nav, .mobile-nav-sheet { display:none !important }
      Fix: ripristinato come fixed-bottom SOLO su mobile (≤720px),
      con safe-area-inset-bottom, padding di compensazione sul body,
      indicatore realtime spostato sopra di esso. Su desktop resta
      nascosto (le tabs top sono la nav primaria).

   3) FLUIDITÀ
      - transizioni scoped a opacity/transform/background-color/border-color
      - aspect-ratio riservato per loghi squadra (no layout shift)
      - tab-panel con contain:layout style (no reflow globale al cambio)
      - update live: i singoli match-card cambiano solo background del badge,
        non si ricostruisce il layout (gestito già da CSS, qui rafforzato)
   ===================================================================== */

/* ===================== 1) FOCUS RING SCOPING ========================== */

/* Reset del :focus-visible globale del layer v126 (cause del bordo oro) */
:focus-visible {
  outline: none;
  box-shadow: none;
}

/* Riapplicato SOLO su elementi realmente interattivi.
   [tabindex="-1"] è ESCLUSO esplicitamente: è il pattern per i target
   di skip-link e per i contenitori focusable solo programmaticamente. */
a:focus-visible,
button:focus-visible,
[role="button"]:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[role="tab"]:focus-visible,
[role="dialog"] > button:focus-visible,
.tab-btn:focus-visible,
.admin-nav a:focus-visible,
.quick-card:focus-visible,
.mobile-nav-item:focus-visible,
.mobile-sheet-item:focus-visible,
[tabindex]:not([tabindex="-1"]):focus-visible {
  outline: 2px solid var(--gold) !important;
  outline-offset: 3px !important;
  border-radius: 6px;
  box-shadow: 0 0 0 4px rgba(215,164,45,.18) !important;
}

/* Garantisce che i contenitori strutturali NON possano mai mostrare
   un bordo focus, anche se ricevono focus programmaticamente. */
main,
main:focus,
main:focus-visible,
section:focus,
section:focus-visible,
article:focus,
article:focus-visible,
.shell,
.shell:focus,
.shell:focus-visible,
.tab-panel,
.tab-panel:focus,
.tab-panel:focus-visible,
.modal-content,
.modal-content:focus,
.modal-content:focus-visible,
[tabindex="-1"]:focus,
[tabindex="-1"]:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  border-color: var(--line);
}

/* Eccezione: input/select/textarea hanno il loro stile focus dedicato */
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: none !important;
  border-color: var(--gold) !important;
  box-shadow: 0 0 0 4px rgba(215,164,45,.18) !important;
}

/* ===================== 2) MOBILE BOTTOM NAV ============================ */

/* Su desktop nascondi la bottom-nav (le tabs sono la nav primaria) */
.mobile-bottom-nav,
.mobile-nav-sheet { display: none; }

/* Mobile: riattivata, fixed con safe-area */
@media (max-width: 720px) {

  /* Nasconde le tabs top per evitare nav duplicata (UX coerente con
     il design originale del progetto). Resta accessibile via
     bottom-nav che usa gli stessi data-tab. */
  body.public-page .tabs { display: none !important; }

  /* La bottom-nav DEVE esistere — appended via public.js setupMobileNavigation() */
  .mobile-bottom-nav {
    display: grid !important;
    grid-template-columns: repeat(5, 1fr);
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    z-index: 90;
    gap: 4px;
    padding: 6px;
    margin: 0;
    border: 1px solid rgba(215,164,45,.32);
    border-radius: 22px;
    background: rgba(10,8,5,.94);
    box-shadow: 0 18px 50px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,236,168,.08);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    transform: translateZ(0);  /* GPU layer → no flicker durante scroll */
  }

  .mobile-nav-item {
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: transparent;
    border: 0;
    color: var(--muted);
    padding: 8px 4px;
    min-height: 52px;
    font-size: .66rem;
    font-weight: 800;
    line-height: 1.1;
    border-radius: 14px;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
    -webkit-tap-highlight-color: transparent;
    text-align: center;
  }
  .mobile-nav-icon {
    font-size: 1.15rem;
    line-height: 1;
    display: inline-block;
    width: 1.15rem;
    text-align: center;
  }
  .mobile-nav-item:active { background: rgba(215,164,45,.10); }
  .mobile-nav-item.active {
    color: var(--gold-ink);
    background: linear-gradient(135deg, var(--gold), var(--gold-soft));
    box-shadow: 0 4px 14px -4px rgba(215,164,45,.45);
  }
  .mobile-nav-item.active .mobile-nav-icon { color: var(--gold-ink); }

  /* Spazio per non far coprire l'ultima sezione dalla bottom-nav */
  body.public-page {
    padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  }
  body.public-page .shell { padding-bottom: 8px; }

  /* "Altro" sheet che si apre dal bottom nav */
  .mobile-nav-sheet {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 100;
    align-items: flex-end;
    background: rgba(0,0,0,.55);
    -webkit-tap-highlight-color: transparent;
  }
  .mobile-nav-sheet.open {
    display: flex !important;
  }
  .mobile-nav-backdrop {
    position: absolute;
    inset: 0;
    cursor: pointer;
  }
  .mobile-nav-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    background: var(--panel);
    border: 1px solid var(--line);
    border-bottom: 0;
    border-radius: 24px 24px 0 0;
    padding: 14px 16px calc(20px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -22px 60px rgba(0,0,0,.55);
    animation: ngSheetIn .18s ease-out;
  }
  @keyframes ngSheetIn {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .mobile-sheet-handle {
    width: 40px; height: 4px;
    background: rgba(255,248,231,.28);
    border-radius: 4px;
    margin: 0 auto 12px;
  }
  .mobile-sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .mobile-sheet-head strong {
    font-size: 1rem;
    color: var(--text);
  }
  .mobile-sheet-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .mobile-sheet-item {
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(255,248,231,.04);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 16px 8px;
    border-radius: 16px;
    cursor: pointer;
    min-height: 84px;
    font-size: .8rem;
    font-weight: 700;
    transition: background-color .15s ease, border-color .15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .mobile-sheet-item:active {
    background: rgba(215,164,45,.10);
    border-color: rgba(215,164,45,.45);
  }
  .mobile-sheet-item span:first-child {
    font-size: 1.4rem;
    line-height: 1;
  }
  .mobile-sheet-item strong {
    font-size: .82rem;
    color: var(--text);
  }

  /* L'indicatore realtime (.ng-realtime-indicator) deve salire sopra
     la bottom-nav per non sovrapporsi a essa. */
  .ng-realtime-indicator {
    bottom: calc(76px + env(safe-area-inset-bottom, 0px)) !important;
    left: 12px !important;
  }
}

/* Su tablet/landscape stretto continuano a esistere le tabs top:
   nasconde la bottom-nav sopra 720px in modo deterministico. */
@media (min-width: 721px) {
  .mobile-bottom-nav,
  .mobile-nav-sheet { display: none !important; }
}

/* ===================== 3) FLUIDITÀ UI ================================== */

/* Aspect-ratio riservato per i loghi → no layout shift al loro caricamento */
.team-logo,
.team-logo-fallback {
  aspect-ratio: 1 / 1;
  width: 54px;
  height: auto;
}
.team-logo.big,
.team-logo-fallback.big {
  aspect-ratio: 1 / 1;
  width: 82px;
  height: auto;
}
.team-inline .team-logo,
.team-inline .team-logo-fallback,
.bracket-team .team-logo,
.bracket-team .team-logo-fallback {
  width: 32px;
  height: auto;
  aspect-ratio: 1 / 1;
}

/* Contain il reflow dei tab-panel — il cambio di .active non ricalcola
   il layout fuori dal pannello attivo */
.tab-panel { contain: layout style; }

/* Transizioni scoped (mai "all"). Le proprietà animate sono solo:
   opacity, transform, background-color, border-color, box-shadow, color */
.btn, .pill, .card, .clickable, .quick-card, .match-card,
.tab-btn, .admin-nav a, .mobile-nav-item, .mobile-sheet-item,
.team-card, .article-card {
  transition:
    background-color .15s ease,
    border-color .15s ease,
    color .15s ease,
    box-shadow .15s ease,
    opacity .15s ease;
}

/* No transform su hover di nessun elemento → no layout-jitter.
   Le micro-elevazioni residue (es. .quick-card:hover translateY) restano
   ma sono molto piccole e disattivate da prefers-reduced-motion sopra. */

/* Match-card: il bordo cambia stato (live/played/pending) senza spostare
   il contenuto perché il bordo è 1px sempre. */
.match-card { border-width: 1px; }

/* Tabelle: header su sfondo opaco per evitare flicker dello sticky
   (lo sticky resta solo dentro modali / table-wrap, comportamento
   standard non page-level). */
table th { background-color: rgba(20,17,11,.92); }

/* Skeleton/placeholder: dimensioni coerenti col contenuto finale */
.empty { min-height: 60px; }

/* Immagini lazy-loaded (foto squadre): aspect-ratio riservato */
.photo-img-wrap {
  aspect-ratio: 4 / 3;
  background: rgba(255,248,231,.04);
}
.photo-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Posizione di scroll: tab-panel changes don't auto-reset (managed by JS)
   ma garantiamo che il browser non aggiunga scroll-padding strani */
html { scroll-padding-top: 12px; }

/* Bottom-nav: assicura che gli aggiornamenti live (badge che pulsano)
   non causino flicker sui suoi elementi (GPU layer) */
.mobile-bottom-nav,
.mobile-nav-item.active { will-change: auto; }

/* End of v126.4 mobile nav + focus + fluidity */

/* v126.4 — reduced motion for the new mobile sheet */
@media (prefers-reduced-motion: reduce) {
  .mobile-nav-panel { animation: none !important; }
}

/* v126.5 — icon weight normalization for monochrome glyphs in mobile nav.
   ⬢ (matches), ▥ (bracket), ✦ (articles) hanno metriche diverse fra font:
   bilanciamo il peso visivo affinché l'oro renda uniforme su tutti. */
.mobile-nav-icon {
  font-family: system-ui, -apple-system, "Segoe UI Symbol", "Apple Symbols", sans-serif;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.15rem;
}
.mobile-nav-item.active .mobile-nav-icon {
  text-shadow: 0 1px 0 rgba(255,255,255,.18);
}

/* =====================================================================
   v126.12 — Dimensioni stabili per gli stemmi web.
   Lo stemma reale è applicato al wrapper tramite la classe ng-tl-{id};
   le iniziali vengono montate soltanto quando la squadra non ha uno
   stemma configurato. Nessun fallback o elemento decorativo viene quindi
   sovrapposto a uno stemma reale.
   ===================================================================== */

.team-logo-wrap {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 54px;
  height: 54px;
  aspect-ratio: 1 / 1;
  border-radius: 16px;
  overflow: hidden;
  flex: 0 0 auto;
  isolation: isolate;
}
.team-logo-wrap.big { width: 82px; height: 82px; border-radius: 24px; }

/* Compatibilità con eventuali <img> legacy; il fallback esiste solo senza stemma. */
.team-logo-wrap .team-logo,
.team-logo-wrap .team-logo-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  margin: 0;
}
.team-logo-wrap .team-logo-fallback {
  z-index: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-soft) 100%);
  color: var(--gold-ink);
  font-weight: 950;
  font-size: 1rem;
  letter-spacing: -.02em;
  text-shadow: 0 1px 0 rgba(255,255,255,.18);
}
.team-logo-wrap.big .team-logo-fallback { font-size: 1.45rem; }
.team-logo-wrap .team-logo {
  z-index: 1;
  object-fit: contain;
  object-position: center;
  max-width: 100%;
  max-height: 100%;
  background: transparent;
}

/* Standalone fallback (squadra senza logo) — stessa dimensione e stile */
.team-logo-fallback:not(.team-logo-wrap .team-logo-fallback) {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 54px;
  height: 54px;
  aspect-ratio: 1 / 1;
  border-radius: 16px;
  flex: 0 0 auto;
  background: linear-gradient(135deg, var(--gold) 0%, var(--gold-soft) 100%);
  color: var(--gold-ink);
  font-weight: 950;
  font-size: 1rem;
  letter-spacing: -.02em;
  text-shadow: 0 1px 0 rgba(255,255,255,.18);
}
.team-logo-fallback.big:not(.team-logo-wrap .team-logo-fallback) {
  width: 82px;
  height: 82px;
  border-radius: 24px;
  font-size: 1.45rem;
}

/* Loghi inline nelle righe di classifica e nel bracket: stessa scala */
.team-inline .team-logo-wrap,
.bracket-team .team-logo-wrap {
  width: 32px;
  height: 32px;
  border-radius: 9px;
}
.team-inline .team-logo-wrap .team-logo-fallback,
.bracket-team .team-logo-wrap .team-logo-fallback {
  font-size: .72rem;
}
.team-inline .team-logo-fallback:not(.team-logo-wrap .team-logo-fallback),
.bracket-team .team-logo-fallback:not(.team-logo-wrap .team-logo-fallback) {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  font-size: .72rem;
}

/* Reduced motion: img caricamento sempre istantaneo (nessuna transizione
   d'opacità che possa generare flash al swap) */
.team-logo-wrap .team-logo {
  transition: opacity .12s ease;
}
@media (prefers-reduced-motion: reduce) {
  .team-logo-wrap .team-logo { transition: none !important; }
}

/* ===================================================================== */
/*  Fluidità desktop: rendering ottimizzato                              */
/* ===================================================================== */

/* Off-screen tab-panel: niente costo di reflow/paint quando non visibile.
   Su Chromium/Edge/Safari recenti questo fa una differenza misurabile. */
.tab-panel:not(.active) {
  content-visibility: auto;
  contain-intrinsic-size: 1px 800px;
}

/* Match card: stable rendering envelope.
   contain: layout style limita il reflow al singolo card quando lo state
   change tocca solo quella card; paint resta corretto perché l'overflow
   visible è necessario per il glow live. */
.match-card.public-fixture-card {
  contain: layout style;
}

/* End of v126.6 stable logo + desktop fluidity */

/* =====================================================================
   v126.10 — Reset dialog (fasi visibili)
   ===================================================================== */
.reset-modal .reset-steps {
  margin: 8px 0 12px;
  padding-left: 22px;
  font-size: 0.88rem;
  line-height: 1.55;
}
.reset-modal .reset-steps li { margin-bottom: 2px; }
.reset-modal .reset-steps li strong { color: var(--text); }

.reset-phase-box { margin: 10px 0 4px; min-height: 0; }
.reset-phase-box:empty { display: none; }
.reset-phase {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
  font-weight: 800;
  font-size: 0.9rem;
  border: 1px solid var(--line);
  background: rgba(255,248,231,.05);
  color: var(--text);
}
.reset-phase::before {
  content: '';
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 0 3px rgba(215,164,45,.22);
  flex: 0 0 auto;
  animation: ngResetPulse 1.4s ease-in-out infinite;
}
@keyframes ngResetPulse {
  0%,100% { opacity: 1; transform: scale(1); }
  50%     { opacity: .5; transform: scale(.85); }
}
.reset-phase.reset-phase-error {
  background: rgba(229,83,95,.10);
  border-color: rgba(229,83,95,.50);
  color: #ffd3da;
}
.reset-phase.reset-phase-error::before {
  background: var(--danger);
  box-shadow: 0 0 0 3px rgba(229,83,95,.25);
  animation: none;
}
.reset-phase.reset-phase-ok {
  background: rgba(34,197,94,.10);
  border-color: rgba(13,122,62,.45);
  color: #d6ffe5;
}
.reset-phase.reset-phase-ok::before {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,.25);
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .reset-phase::before { animation: none !important; }
}

/* Pulsanti reset: layout grid responsivo */
.reset-modal .reset-choice-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.reset-modal .reset-choice-grid .btn { flex: 1 1 auto; min-width: 140px; }

/* =====================================================================
   v126.12 — Stemmi web integri e senza sovrapposizioni
   I data-URL restano in <style id="ngTeamLogos">. Lo stemma è contenuto
   integralmente nel box, senza ritagli, maschere o elementi sovrapposti.
   Il fallback con iniziali viene montato soltanto quando manca lo stemma.
   ===================================================================== */
.team-logo-wrap {
  background-color: transparent;
  background-size: contain;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 0 !important;
  overflow: visible !important;
  pointer-events: none;
}
.team-logo-fallback::before,
.team-logo-fallback::after,
.team-logo-fallback span::before,
.team-logo-fallback span::after {
  content: none;
  display: none;
}

/* =====================================================================
   v126.11 — Scroll fix per rotella mouse desktop
   Rimuovo content-visibility:auto dalle tab inattive (introdotto in v126.6
   per perf). Con `.tab-panel{display:none}` + `.tab-panel.active{display:block}`
   già nel base CSS, content-visibility è ridondante e poteva falsare lo
   stimato scrollHeight della pagina su alcuni browser causando scroll a
   "scatti" o aree non scorribili con la rotella.
   ===================================================================== */
.tab-panel:not(.active) {
  content-visibility: visible;            /* override v126.6 */
  contain-intrinsic-size: auto;            /* override v126.6 */
}
/* End v126.11 */

/* v126.13 · Sezione Articoli professionale, responsive e retrocompatibile */
.article-admin-layout{
  display:grid;
  grid-template-columns:minmax(0,.94fr) minmax(420px,1.06fr);
  gap:22px;
  align-items:start;
}
.article-editor-card,.article-library-card,.article-public-section{min-width:0;overflow:hidden;}
.article-editor-heading{align-items:flex-start;}
.article-editor-heading h2[data-unsaved="true"]::after{content:' · modifiche non salvate';color:#f6c453;font-size:.72rem;font-weight:800;letter-spacing:.01em;}
.article-editor-form{display:grid;gap:18px;}
.article-form-section{
  min-width:0;
  padding:18px;
  border:1px solid rgba(255,226,143,.14);
  border-radius:20px;
  background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(0,0,0,.16));
}
.article-form-section-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;}
.article-form-section-head>span{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border-radius:10px;background:rgba(215,164,45,.18);border:1px solid rgba(255,226,143,.28);color:#ffe38b;font-weight:900;}
.article-form-section-head h3{margin:0;color:#fff7df;font-size:1.02rem;}
.article-form-section-head p{margin:4px 0 0;color:var(--muted);font-size:.84rem;line-height:1.4;}
.article-form-section label{font-weight:800;color:#f6edd8;}
.article-form-section small{display:block;margin-top:6px;color:var(--muted);line-height:1.35;}
.article-form-section input[aria-invalid="true"],.article-form-section textarea[aria-invalid="true"],.article-form-section select[aria-invalid="true"]{border-color:#fb7185!important;box-shadow:0 0 0 3px rgba(251,113,133,.14)!important;}
.article-editor-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;padding:10px;border-radius:14px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06);}
.article-editor-toolbar .btn{min-height:40px;}
.article-editor-help{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:8px;color:var(--muted);font-size:.76rem;line-height:1.4;}
.article-image-editor{display:grid;grid-template-columns:minmax(210px,.78fr) minmax(0,1.22fr);gap:18px;align-items:start;}
.article-image-preview{display:flex!important;flex-direction:column;align-items:stretch!important;gap:9px!important;min-height:0!important;padding:10px;border-radius:18px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.07);}
.article-image-preview .article-image.small{width:100%!important;height:auto!important;min-height:180px!important;aspect-ratio:16/10!important;object-fit:contain!important;border-radius:13px!important;background:#090806!important;}
.article-image-preview[aria-busy="true"]{opacity:.65;pointer-events:none;}
.article-slug-field{display:flex;align-items:center;min-width:0;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(0,0,0,.22);overflow:hidden;}
.article-slug-field>span{padding:0 0 0 12px;color:#cdbd87;font-size:.82rem;white-space:nowrap;}
.article-slug-field input{border:0!important;background:transparent!important;box-shadow:none!important;min-width:0;width:100%;}
.article-seo-section summary{cursor:pointer;font-weight:900;color:#ffe8a8;}
.article-editor-actions{position:sticky;bottom:10px;z-index:8;display:flex;gap:10px;flex-wrap:wrap;padding:12px;border-radius:16px;background:rgba(8,8,6,.92);border:1px solid rgba(255,226,143,.2);box-shadow:0 14px 36px rgba(0,0,0,.3);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);}
.article-editor-actions .btn{min-height:46px;}
.article-editor-actions .btn.primary{flex:1 1 180px;}
.article-form-errors:empty{display:none;}
.article-form-errors ul{margin:8px 0 0;padding-left:20px;}
.article-admin-toolbar,.article-public-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) minmax(150px,.4fr) minmax(130px,.32fr);gap:12px;align-items:end;margin:14px 0 12px;}
.article-admin-toolbar label,.article-public-toolbar label{display:grid;gap:6px;min-width:0;color:#d9ccb0;font-size:.78rem;font-weight:800;}
.article-public-toolbar{grid-template-columns:minmax(240px,1fr) minmax(180px,.42fr) auto;}
.article-public-toolbar .btn{min-height:var(--control-height);}
.article-library-summary{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 16px;min-height:30px;}
.article-library-summary>span{display:inline-flex;align-items:center;gap:5px;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#cfc4ad;font-size:.76rem;}
.article-library-summary strong{color:#fff1bc;}

/* Card condivisa: una sola struttura responsive per pubblico e admin. */
.article-list{display:grid!important;gap:18px!important;width:100%!important;}
.article-card.sports-news-card,.article-card.sports-news-card.admin-news-card,#searchResults .article-card.sports-news-card{
  display:block!important;
  min-height:0!important;
  padding:0!important;
  overflow:hidden!important;
  border-radius:24px!important;
  border:1px solid rgba(255,226,143,.18)!important;
  background:linear-gradient(145deg,rgba(21,19,13,.98),rgba(7,7,5,.98))!important;
  box-shadow:0 16px 42px rgba(0,0,0,.28)!important;
  content-visibility:auto;
  contain-intrinsic-size:1px 250px;
}
.article-card.sports-news-card:hover,.article-card.sports-news-card:focus-within{border-color:rgba(255,226,143,.42)!important;box-shadow:0 20px 54px rgba(0,0,0,.34)!important;}
.article-card-main{display:grid!important;grid-template-columns:minmax(230px,300px) minmax(0,1fr)!important;min-width:0;color:inherit;text-decoration:none;}
a.article-card-main{cursor:pointer;}
.article-card-main:focus-visible{box-shadow:inset 0 0 0 3px rgba(255,224,112,.7)!important;outline:0;}
.article-card.sports-news-card .article-media,#adminArticlesList .article-media,#publicArticles .article-media,#searchResults .article-media{
  position:relative!important;
  display:grid!important;
  place-items:center!important;
  width:100%!important;
  min-height:220px!important;
  height:100%!important;
  aspect-ratio:auto!important;
  overflow:hidden!important;
  isolation:isolate!important;
  background:linear-gradient(135deg,#090806,#241b0a)!important;
}
.article-card.sports-news-card .article-media::after{content:'';position:absolute;inset:auto 0 0;height:38%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.72));pointer-events:none;z-index:1;}
.article-card.sports-news-card .article-image,.article-card.sports-news-card img.article-image,.article-card.sports-news-card .article-placeholder{
  display:block!important;width:100%!important;height:100%!important;min-height:220px!important;aspect-ratio:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;background:#0b0905!important;
}
.article-card.sports-news-card img.article-image{object-fit:cover!important;object-position:center!important;transform:none!important;filter:none!important;}
.article-card.sports-news-card:hover img.article-image{transform:none!important;filter:saturate(1.03) contrast(1.02)!important;}
.article-card.sports-news-card .article-placeholder{display:grid!important;place-items:center!important;align-content:center!important;background:radial-gradient(circle at 50% 28%,rgba(255,231,150,.24),transparent 42%),linear-gradient(135deg,#080705,#2c1f08)!important;}
.article-placeholder span{font-size:clamp(1.5rem,5vw,3rem);font-weight:950;color:#ffe28a;letter-spacing:-.06em;}
.article-placeholder small{color:#cfa943;font-weight:900;letter-spacing:.18em;}
.article-card.sports-news-card .media-kicker{position:absolute!important;left:14px!important;bottom:14px!important;z-index:2!important;max-width:calc(100% - 28px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.article-card.sports-news-card .article-content{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:9px!important;min-width:0!important;padding:22px 24px!important;}
.article-card.sports-news-card .article-meta{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;font-size:.76rem!important;color:#c8b98e!important;}
.article-card.sports-news-card .article-content h3{display:block!important;overflow:visible!important;max-width:100%!important;margin:0!important;color:#fff7df!important;font-size:clamp(1.35rem,2.2vw,1.9rem)!important;line-height:1.08!important;letter-spacing:-.035em!important;text-wrap:balance!important;overflow-wrap:anywhere!important;}
.article-card-subtitle{margin:0!important;color:#f0dfac!important;font-size:.95rem!important;line-height:1.4!important;font-weight:750;display:block!important;overflow:visible!important;}
.article-card-excerpt{margin:0!important;color:#d9d0bc!important;font-size:.92rem!important;line-height:1.55!important;display:-webkit-box!important;-webkit-line-clamp:3!important;-webkit-box-orient:vertical!important;overflow:hidden!important;overflow-wrap:anywhere!important;}
.article-open-label{display:inline-flex;align-items:center;gap:8px;margin-top:3px;color:#ffe28a;font-size:.82rem;font-weight:900;}
.article-open-label span{font-size:1.1em;}
.article-admin-actions{display:flex!important;justify-content:flex-end!important;gap:9px!important;flex-wrap:wrap!important;margin:0!important;padding:12px 16px!important;border-top:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.18);}
.article-admin-actions .btn{min-width:104px;min-height:42px;margin:0!important;}
.article-status{display:inline-flex;align-items:center;min-height:24px;padding:4px 8px;border-radius:999px;border:1px solid currentColor;font-size:.64rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;}
.article-status.status-published{color:#86efac;background:rgba(34,197,94,.09);}
.article-status.status-draft{color:#cbd5e1;background:rgba(148,163,184,.09);}
.article-status.status-scheduled{color:#93c5fd;background:rgba(59,130,246,.09);}
.article-author{overflow-wrap:anywhere;}
.article-empty{display:grid;gap:6px;place-items:center;text-align:center;min-height:180px;}
.article-empty strong{font-size:1.05rem;color:#fff0b8;}
.article-empty span{color:var(--muted);}

/* Dettaglio editoriale: una sola immagine, colonna di lettura confortevole. */
.article-modal-content{width:min(1080px,calc(100vw - 32px))!important;max-width:1080px!important;}
.article-modal-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;position:sticky;top:0;z-index:20;padding:14px 18px;background:rgba(9,9,7,.96);border-bottom:1px solid rgba(255,226,143,.14);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}
.article-modal-toolbar h2{margin:3px 0 0;max-width:54ch;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.article-detail.article-detail-editorial{display:block!important;min-height:0!important;background:#0b0a07;}
.article-preview-banner{padding:10px 18px;background:#5b3b07;color:#fff0bd;border-bottom:1px solid rgba(255,226,143,.22);font-size:.82rem;font-weight:900;text-align:center;}
.article-detail-header{max-width:820px;margin:0 auto;padding:clamp(28px,5vw,62px) clamp(18px,5vw,56px) clamp(20px,3vw,34px);}
.article-detail-header h1{margin:14px 0 0;color:#fff8e5;font-size:clamp(2.1rem,6vw,4.8rem);line-height:.98;letter-spacing:-.055em;text-wrap:balance;overflow-wrap:anywhere;}
.article-detail-subtitle{max-width:62ch;margin:18px 0 0;color:#ead8a7;font-size:clamp(1.05rem,2vw,1.35rem);line-height:1.5;font-weight:650;}
.article-detail-media{display:grid;place-items:center;max-width:980px;margin:0 auto;padding:0 clamp(12px,3vw,28px);}
.article-detail-media .article-image{display:block!important;width:100%!important;height:auto!important;max-height:min(72vh,760px)!important;min-height:0!important;aspect-ratio:auto!important;object-fit:contain!important;object-position:center!important;border-radius:20px!important;background:#050504!important;box-shadow:0 18px 52px rgba(0,0,0,.35);}
.article-detail-media .article-placeholder{min-height:340px!important;aspect-ratio:16/9!important;}
.article-detail-media figcaption{width:min(100%,780px);padding:10px 4px 0;color:#a99b7c;font-size:.78rem;line-height:1.45;text-align:center;}
.article-detail-body{display:block!important;max-width:760px;margin:0 auto;padding:clamp(28px,5vw,58px) clamp(18px,5vw,48px) clamp(48px,7vw,82px)!important;}
.article-full-text{color:#eee6d6!important;font-size:clamp(1.02rem,1.35vw,1.14rem)!important;line-height:1.78!important;overflow-wrap:anywhere;word-break:normal;}
.article-full-text p{margin:0 0 1.25em;}
.article-full-text h3,.article-full-text h4{margin:1.75em 0 .65em;color:#fff4cf;line-height:1.2;letter-spacing:-.02em;}
.article-full-text h3{font-size:1.55em;}.article-full-text h4{font-size:1.25em;}
.article-full-text ul,.article-full-text ol{margin:0 0 1.4em;padding-left:1.35em;}
.article-full-text li+li{margin-top:.45em;}
.article-full-text blockquote{margin:1.5em 0;padding:16px 18px;border-left:4px solid #d7a42d;border-radius:0 14px 14px 0;background:rgba(215,164,45,.08);color:#f5e5b8;font-style:italic;}
.article-full-text a{color:#ffe28a;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere;}
.article-inline-figure{margin:2em auto;max-width:100%;}
.article-inline-figure img{display:block;max-width:100%;height:auto;margin:auto;border-radius:16px;}
.article-inline-figure figcaption{margin-top:8px;color:var(--muted);font-size:.78rem;text-align:center;}
.article-tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:30px;}
.article-tags span{padding:7px 10px;border-radius:999px;background:rgba(215,164,45,.1);border:1px solid rgba(255,226,143,.16);color:#f3d879;font-size:.78rem;font-weight:800;}
.article-detail-footer{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);color:#9f947b;font-size:.74rem;}
.article-unavailable{min-height:360px;display:grid;place-items:center;align-content:center;gap:8px;text-align:center;padding:24px;}

.article-delete-card{width:min(520px,calc(100vw - 28px));}
#deleteArticleDialog[hidden]{display:none!important;}
#deleteArticleDialog.show,#deleteArticleDialog.open{display:grid!important;opacity:1;pointer-events:auto;}
#deleteArticleDialog.show .ng-confirm-card,#deleteArticleDialog.open .ng-confirm-card{transform:scale(1) translateY(0);}
.article-delete-card h2{margin:10px 0 6px;}
.article-delete-card .row-actions{justify-content:flex-end;margin-top:18px;}

@media(max-width:1050px){
  .article-admin-layout{grid-template-columns:1fr;}
  .article-editor-card{order:1}.article-library-card{order:2}
}
@media(max-width:760px){
  .article-admin-layout{gap:14px;}
  .article-form-section{padding:14px;border-radius:17px;}
  .article-image-editor{grid-template-columns:1fr;}
  .article-image-preview .article-image.small{min-height:210px!important;}
  .article-editor-toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));}
  .article-editor-toolbar .btn{width:100%;white-space:normal;}
  .article-editor-actions{bottom:calc(10px + env(safe-area-inset-bottom,0px));display:grid;grid-template-columns:1fr 1fr;}
  .article-editor-actions .btn.primary{grid-column:1/-1;order:-1;}
  .article-admin-toolbar,.article-public-toolbar{grid-template-columns:1fr!important;align-items:stretch;}
  .article-public-toolbar .btn{width:100%;}
  .article-card-main{grid-template-columns:1fr!important;}
  .article-card.sports-news-card .article-media,#adminArticlesList .article-media,#publicArticles .article-media,#searchResults .article-media{height:auto!important;min-height:0!important;aspect-ratio:16/9!important;}
  .article-card.sports-news-card .article-image,.article-card.sports-news-card img.article-image,.article-card.sports-news-card .article-placeholder{height:100%!important;min-height:0!important;aspect-ratio:16/9!important;}
  .article-card.sports-news-card .article-content{padding:17px 16px 18px!important;gap:8px!important;}
  .article-card.sports-news-card .article-content h3{font-size:clamp(1.25rem,6.5vw,1.7rem)!important;line-height:1.08!important;}
  .article-card-subtitle{font-size:.92rem!important;}
  .article-card-excerpt{font-size:.9rem!important;-webkit-line-clamp:4!important;}
  .article-admin-actions{display:grid!important;grid-template-columns:1fr 1fr!important;padding:12px!important;}
  .article-admin-actions .btn{width:100%;min-width:0!important;min-height:44px!important;}
  .article-admin-actions .btn.danger{grid-column:1/-1;}
  .article-modal-content{width:100%!important;max-width:100%!important;height:100dvh!important;max-height:100dvh!important;border-radius:0!important;}
  .article-modal-toolbar{padding:calc(12px + env(safe-area-inset-top,0px)) 12px 11px!important;align-items:flex-start;}
  .article-modal-toolbar .row-actions{display:grid;grid-template-columns:auto auto;gap:7px;}
  .article-modal-toolbar .btn{min-height:42px;padding-inline:11px;}
  .article-modal-toolbar h2{max-width:42vw;}
  .article-detail-header{padding:26px 16px 18px;}
  .article-detail-header h1{font-size:clamp(2rem,11vw,3.2rem);}
  .article-detail-media{padding:0 10px;}
  .article-detail-media .article-image{max-height:68vh!important;border-radius:16px!important;}
  .article-detail-media .article-placeholder{min-height:220px!important;}
  .article-detail-body{padding:28px 17px calc(100px + env(safe-area-inset-bottom,0px))!important;}
  .article-full-text{font-size:1.04rem!important;line-height:1.72!important;}
  .article-library-summary{margin-bottom:12px;}
}
@media(max-width:420px){
  .article-editor-toolbar{grid-template-columns:1fr;}
  .article-editor-actions{grid-template-columns:1fr;}
  .article-editor-actions .btn.primary{grid-column:auto;}
  .article-admin-actions{grid-template-columns:1fr!important;}
  .article-admin-actions .btn.danger{grid-column:auto;}
  .article-modal-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;}
  .article-modal-toolbar .row-actions{grid-template-columns:1fr;}
  #copyArticleLink{display:none;}
  .article-modal-toolbar h2{max-width:62vw;}
}
@media(prefers-reduced-motion:reduce){
  .article-card.sports-news-card,.article-card.sports-news-card img.article-image,.article-modal-content{transition:none!important;animation:none!important;}
}

/* Le vecchie card assegnavano media e contenuto ad aree della griglia esterna.
   Nel componente v126.13 la griglia appartiene a .article-card-main: neutralizziamo
   le aree legacy per evitare tracce implicite sui display stretti. */
.article-card.sports-news-card .article-card-main > .article-content,
.article-card.sports-news-card .article-card-main > .article-media,
#publicArticles .article-card-main > .article-media,
#adminArticlesList .article-card-main > .article-media,
#searchResults .article-card-main > .article-media{grid-area:auto!important;}

/* Altezza editoriale stabile su tablet e desktop: evita che il vecchio 100%
   risolva l'altezza della traccia rispetto al viewport o a contenuti molto lunghi. */
@media(min-width:761px){
  .article-card.sports-news-card .article-card-main > .article-media,
  #publicArticles .article-card-main > .article-media,
  #adminArticlesList .article-card-main > .article-media,
  #searchResults .article-card-main > .article-media{
    height:clamp(220px,24vw,300px)!important;
    min-height:220px!important;
    align-self:start!important;
  }
}

/* v126.14 · Procedura guidata Simula torneo */
.simulation-modal.simulation-wizard{max-width:900px;width:min(96vw,900px);max-height:min(92vh,920px);overflow:auto;overscroll-behavior:contain}
.simulation-wizard-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
.simulation-wizard-head h2{margin:.45rem 0 0}
.simulation-stepper{list-style:none;margin:0 0 24px;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.simulation-stepper li{position:relative;display:grid;justify-items:center;gap:6px;color:var(--muted);text-align:center;font-weight:850;font-size:.76rem}
.simulation-stepper li:before{content:"";position:absolute;top:17px;left:-50%;width:100%;height:2px;background:rgba(255,255,255,.12);z-index:0}
.simulation-stepper li:first-child:before{display:none}
.simulation-stepper li span{position:relative;z-index:1;display:grid;place-items:center;width:34px;height:34px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:var(--surface);color:#fff}
.simulation-stepper li.active span,.simulation-stepper li.done span{border-color:var(--gold);background:linear-gradient(135deg,var(--gold-2),var(--gold));color:#171006;box-shadow:0 0 0 4px rgba(214,167,79,.12)}
.simulation-stepper li.done:before,.simulation-stepper li.active:before{background:rgba(214,167,79,.6)}
.simulation-step-copy{margin-bottom:18px}
.simulation-step-copy h3{font-size:clamp(1.25rem,3vw,1.75rem);margin:10px 0 6px}
.simulation-step-copy p{margin:0;color:var(--muted);line-height:1.55}
.simulation-choice-grid,.simulation-format-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0 18px}
.simulation-format-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.simulation-choice{display:block;min-width:0;cursor:pointer}
.simulation-choice input{position:absolute;opacity:0;pointer-events:none}
.simulation-choice>span{display:grid;gap:6px;min-height:112px;padding:18px;border-radius:20px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.035);transition:border-color .18s ease,background .18s ease,transform .18s ease}
.simulation-choice strong{font-size:1.02rem;color:#fff}
.simulation-choice small{color:var(--muted);line-height:1.45}
.simulation-choice input:checked+span{border-color:var(--gold);background:linear-gradient(145deg,rgba(214,167,79,.18),rgba(255,255,255,.05));box-shadow:0 0 0 3px rgba(214,167,79,.09)}
.simulation-choice input:focus-visible+span{outline:3px solid var(--gold-2);outline-offset:3px}
.simulation-choice:hover>span{transform:translateY(-1px);border-color:rgba(214,167,79,.55)}
.simulation-choice.is-disabled{cursor:not-allowed;opacity:.48}
.simulation-choice.is-disabled>span{transform:none}
.simulation-team-picker{border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:14px;margin:0 0 16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.simulation-team-picker legend{padding:0 8px;color:var(--gold-2);font-weight:900}
.simulation-team-picker label{display:block;cursor:pointer}
.simulation-team-picker label>input{position:absolute;opacity:0}
.simulation-team-picker label>span{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;column-gap:10px;align-items:center;padding:10px;border-radius:14px;border:1px solid transparent;background:rgba(255,255,255,.035)}
.simulation-team-picker .team-logo-wrap{grid-row:1/3}
.simulation-team-picker label>span small{color:var(--muted)}
.simulation-team-picker input:checked+span{border-color:rgba(214,167,79,.72);background:rgba(214,167,79,.12)}
.simulation-team-picker input:focus-visible+span{outline:3px solid var(--gold-2);outline-offset:2px}
.simulation-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 18px}
.simulation-summary>div{min-width:0;padding:13px 14px;border:1px solid rgba(255,255,255,.11);border-radius:16px;background:rgba(255,255,255,.035)}
.simulation-summary dt{color:var(--gold-2);font-size:.72rem;font-weight:950;text-transform:uppercase;letter-spacing:.06em}
.simulation-summary dd{margin:5px 0 0;color:#fff;font-weight:800;overflow-wrap:anywhere}
.simulation-summary.compact{margin-top:18px}
.simulation-confirmations{display:grid;gap:10px}
.simulation-wizard-actions{position:sticky;bottom:-20px;display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;margin:22px -4px -4px;padding:16px 4px 4px;background:linear-gradient(180deg,transparent 0,var(--surface) 30%)}
.simulation-progress-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.simulation-progress-list li{display:grid;grid-template-columns:32px minmax(0,1fr);grid-template-rows:auto auto;column-gap:10px;padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.025)}
.simulation-progress-list li>span{grid-row:1/3;display:grid;place-items:center;font-size:1.1rem;color:var(--muted)}
.simulation-progress-list li strong{color:#fff}
.simulation-progress-list li small{color:var(--muted)}
.simulation-progress-list li.active{border-color:rgba(214,167,79,.72);background:rgba(214,167,79,.1)}
.simulation-progress-list li.active>span,.simulation-progress-list li.done>span{color:var(--gold-2)}
.simulation-progress-list li.done{border-color:rgba(72,187,120,.36)}
.simulation-success{text-align:center;padding:18px 0 4px}
.simulation-success-icon{display:grid;place-items:center;width:72px;height:72px;margin:0 auto 14px;border-radius:999px;background:rgba(72,187,120,.16);border:1px solid rgba(72,187,120,.58);color:#8df0b4;font-size:2rem;font-weight:950}
.simulation-success h3{font-size:clamp(1.45rem,4vw,2.15rem);margin:12px 0 6px}
.simulation-success p{color:var(--muted)}
@media (prefers-reduced-motion:reduce){.simulation-choice>span{transition:none}}
@media (max-width:760px){
  .simulation-modal.simulation-wizard{width:100%;max-width:none;max-height:94vh;height:auto;border-radius:24px 24px 0 0;margin-top:auto;padding:18px}
  .simulation-wizard-head{align-items:center}
  .simulation-stepper{gap:2px}
  .simulation-stepper li small{font-size:.62rem}
  .simulation-stepper li span{width:30px;height:30px}
  .simulation-stepper li:before{top:15px}
  .simulation-choice-grid,.simulation-format-grid,.simulation-team-picker,.simulation-summary{grid-template-columns:1fr}
  .simulation-choice>span{min-height:0}
  .simulation-wizard-actions{grid-template-columns:1fr 1fr;bottom:-18px}
  .simulation-wizard-actions>span{display:none}
  .simulation-wizard-actions .btn{width:100%;min-height:46px}
  #simulationExecuteBtn{grid-column:1/-1}
}

/* =====================================================================
   v126.16 — Foto affidabili + dettaglio articolo editoriale
   ===================================================================== */
/* Foto: anteprima locale, metadati e visualizzatore accessibile. */
.photos-dropzone.is-busy{opacity:.7;pointer-events:none}
.upload-panel{display:grid;gap:12px;margin-top:14px;padding:14px;border:1px solid rgba(255,226,143,.18);border-radius:18px;background:rgba(255,255,255,.035)}
.upload-panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.upload-panel-info{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;color:#f1e6c5}
.upload-panel-info small,.upload-panel-rules{color:var(--muted)}
.upload-panel-actions{display:flex;gap:8px;flex-wrap:wrap}
.upload-list{display:grid;gap:10px}
.upload-item{display:grid;grid-template-columns:64px minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px;border-radius:14px;background:rgba(0,0,0,.2)}
.upload-item-preview{width:64px;height:54px;border-radius:10px;overflow:hidden;background:#050504}
.upload-item-preview img{width:100%;height:100%;object-fit:contain}
.upload-item-body{min-width:0;display:grid;gap:7px}
.upload-item-head{display:flex;justify-content:space-between;gap:10px;min-width:0}
.upload-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750}
.upload-item-size,.upload-item-status{color:var(--muted);font-size:.76rem}
.upload-item-status.ok{color:#8fe3a1}.upload-item-status.fail{color:#ff9e9e}.upload-item-status.cancel{color:#e5c477}
.upload-item-bar{height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
.upload-item-fill{height:100%;width:0;border-radius:inherit;background:#d7a42d;transition:width .18s ease}
.upload-item-fill.ok{background:#39a85a}.upload-item-fill.fail{background:#c84b4b}.upload-item-fill.cancel{background:#a58138}
.upload-item-cancel,.staging-thumb-remove{display:grid;place-items:center;width:34px;height:34px;border:0;border-radius:50%;background:rgba(180,50,50,.25);color:#fff;cursor:pointer}
.staging-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px}
.staging-thumb{position:relative;margin:0;min-width:0;padding:8px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(0,0,0,.22)}
.staging-thumb-img{display:grid;place-items:center;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:#050504}
.staging-thumb-img img{width:100%;height:100%;object-fit:contain}
.staging-thumb figcaption{display:grid;gap:3px;padding:8px 2px 2px}
.staging-thumb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;font-weight:800}
.staging-thumb figcaption small{color:var(--muted);font-size:.68rem}
.staging-thumb-remove{position:absolute;top:4px;right:4px;width:30px;height:30px}
.photo-metadata-modal{z-index:10020}
.photo-metadata-content{width:min(720px,calc(100vw - 24px));max-height:min(92vh,820px);overflow:auto}
.photo-metadata-form{padding:20px}
.photo-metadata-actions{display:flex;justify-content:flex-end;gap:10px}
.lightbox-zoom-controls{display:flex;align-items:center;gap:7px;flex-shrink:0}
.lightbox-zoom-controls [data-viewer-zoom-label]{min-width:44px;color:#fff;text-align:center;font-size:.76rem;font-variant-numeric:tabular-nums}
.photos-lightbox .lightbox-img{touch-action:none;transform-origin:center center;cursor:zoom-in}
.photos-lightbox .lightbox-img.is-zoomed{cursor:grab;max-width:100%;max-height:100%}
.photos-lightbox .lightbox-img.is-zoomed:active{cursor:grabbing}
.photos-lightbox .lightbox-stage{touch-action:none}
#publicPhotosStatus{margin:10px 0}
.photo-overlay{flex-wrap:wrap}
.photo-overlay .photo-action-btn{display:grid;place-items:center;text-decoration:none}

/* Articoli: pagina editoriale lineare, immagine autonoma e nessun placeholder nel dettaglio. */
.article-detail.article-detail-editorial{overflow-x:hidden;background:#0b0a07!important}
.article-detail-nav{max-width:980px;margin:0 auto;padding:20px clamp(18px,4vw,42px) 0}
.article-back-link{appearance:none;border:0;background:transparent;color:#f0d477;font:inherit;font-size:.88rem;font-weight:850;cursor:pointer;padding:9px 0;text-decoration:none;text-underline-offset:4px}
.article-back-link:hover{text-decoration:underline}.article-back-link:focus-visible{outline:3px solid #f0d477;outline-offset:4px;border-radius:5px}
.article-detail-category{display:inline-flex;padding:7px 11px;border:1px solid rgba(255,226,143,.22);border-radius:999px;background:rgba(215,164,45,.1);color:#f1d472;font-size:.73rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase}
.article-detail-meta{display:flex;flex-wrap:wrap;align-items:center;gap:7px 14px;margin-top:20px;color:#aaa087;font-size:.79rem;line-height:1.45}
.article-detail-meta > *{position:relative}
.article-detail-meta > *+*::before{content:'•';position:absolute;left:-9px;color:#6f654e}
.article-detail-meta .article-status::before{display:none}
.article-detail-author{color:#d8c699;font-weight:750}
.article-detail-header{max-width:840px!important;padding-top:clamp(24px,4vw,48px)!important}
.article-detail-header h1{max-width:18ch;margin-top:18px!important}
.article-detail-subtitle{max-width:65ch!important}
.article-detail-media{position:relative;max-width:1040px!important;padding:0 clamp(12px,3vw,30px)!important}
.article-image-open{position:relative;display:grid;place-items:center;width:100%;padding:0;border:0;border-radius:22px;background:#050504;color:inherit;cursor:zoom-in;overflow:hidden}
.article-image-open:focus-visible{outline:3px solid #f1d472;outline-offset:5px}
.article-image-open .article-image{width:100%!important;height:auto!important;max-height:min(76vh,820px)!important;object-fit:contain!important;object-position:center!important;border-radius:20px!important}
.article-detail-media.is-portrait .article-image-open{width:min(100%,650px);margin-inline:auto}
.article-detail-media.is-square .article-image-open{width:min(100%,780px);margin-inline:auto}
.article-image-open-hint{position:absolute;right:14px;bottom:14px;padding:8px 11px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(0,0,0,.7);color:#fff;font-size:.75rem;font-weight:850;backdrop-filter:blur(8px);opacity:.92}
.article-detail-media figcaption{max-width:780px!important;padding:12px 8px 0!important;font-size:.84rem!important;line-height:1.55!important}
.article-detail.no-image .article-detail-header{padding-bottom:clamp(18px,3vw,30px)!important}
.article-detail-body{max-width:74ch!important}
.article-detail-end-nav{margin-top:32px;padding-top:10px}
.article-detail-footer:empty{display:none}

.article-image-viewer{position:fixed;inset:0;z-index:10050;display:none;grid-template-rows:auto minmax(0,1fr);background:rgba(0,0,0,.96);color:#fff}
.article-image-viewer.open{display:grid}
.article-image-viewer-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;background:rgba(12,12,10,.92);border-bottom:1px solid rgba(255,255,255,.1)}
.article-image-viewer-zoom{display:flex;align-items:center;gap:8px}
.article-image-viewer-toolbar button{min-width:42px;min-height:42px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font:inherit;font-weight:800;cursor:pointer}
.article-image-viewer-close{font-size:1.45rem}
.article-image-viewer-stage{display:grid;place-items:center;min-height:0;overflow:hidden;padding:16px;touch-action:none}
.article-image-viewer-stage img{display:block;max-width:100%;max-height:100%;object-fit:contain;transform-origin:center;transition:transform .16s ease;user-select:none;touch-action:none}
.article-image-viewer-stage img.is-zoomed{cursor:grab}.article-image-viewer-stage img.is-zoomed:active{cursor:grabbing}

@media(max-width:760px){
  .upload-item{grid-template-columns:52px minmax(0,1fr) auto;gap:8px}.upload-item-preview{width:52px;height:48px}
  .upload-panel-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.upload-panel-actions .btn{width:100%}
  .staging-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lightbox-zoom-controls{justify-content:center;flex-wrap:wrap}.lightbox-bar{max-height:35vh;overflow:auto}
  .article-detail-nav{padding:14px 16px 0}.article-detail-header{padding:22px 16px 18px!important}.article-detail-header h1{max-width:none!important}
  .article-detail-meta{gap:6px 12px}.article-detail-media{padding-inline:10px!important}.article-image-open{border-radius:16px}.article-image-open .article-image{max-height:70vh!important;border-radius:15px!important}
  .article-image-open-hint{right:9px;bottom:9px}.article-detail-body{padding-inline:17px!important}
  .article-image-viewer-zoom [data-article-viewer-reset]{display:none}.article-image-viewer-stage{padding:8px}
}
@media(max-width:420px){
  .staging-grid{grid-template-columns:1fr}.photo-metadata-actions{display:grid;grid-template-columns:1fr}.photo-metadata-actions .btn{width:100%}
  .article-detail-meta > *+*::before{display:none}.article-detail-meta{display:grid;gap:4px}
  .article-image-open-hint{font-size:.68rem;padding:6px 9px}
}
@media(prefers-reduced-motion:reduce){
  .upload-item-fill,.article-image-viewer-stage img{transition:none!important}.article-image-viewer{scroll-behavior:auto}
}

/* v126.16.1 · Rifiniture accessibilità Foto/Articoli */
.photo-thumb.public[role="button"]:focus-visible{outline:3px solid #f1d472;outline-offset:4px}
.article-image-viewer-stage{padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}
@media(max-width:760px){.article-image-viewer-stage{padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}}
````

## `/mnt/data/ng-work/new-generation-main/assets/js/admin-articles.js`

````javascript
(function(){
  const store=window.NexoraStore, UI=window.NexoraUI, Admin=window.NexoraAdmin;
  const $=UI.$;
  const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp']);
  const MAX_IMAGE_BYTES=12*1024*1024;
  const MAX_IMAGE_EDGE=1600;
  let editingId='';
  let currentImage='';
  let baselineSignature='';
  let slugTouched=false;
  let deleteArticleId='';
  let deleteArticleTrigger=null;
  let previewTrigger=null;
  let previewArticleId='';
  let suppressDirty=false;

  function allArticles(){return store.selectors.allArticles(Admin.state());}
  function refreshPublicCache(snapshot){try{store.save('public',snapshot);}catch(_){} }
  function articleById(id){return store.selectors.articleById(Admin.state(),id,{includeDrafts:true});}
  function toLocalDateTime(value){
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }
  function fromLocalDateTime(value){
    if(!value)return '';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'':date.toISOString();
  }
  function parseTags(value){return [...new Set(String(value||'').split(',').map(v=>v.trim()).filter(Boolean))].slice(0,12);}
  function uniqueSlug(value,id=''){
    const base=store.articleSlug(value||$('#articleTitle')?.value||'articolo');
    const used=new Set(allArticles().filter(a=>a.id!==id).map(a=>a.slug));
    let slug=base,n=2;
    while(used.has(slug))slug=`${base.slice(0,Math.max(1,86-String(n).length))}-${n++}`;
    return slug;
  }
  function formSnapshot(){
    return {
      id:editingId,
      title:$('#articleTitle')?.value.trim()||'',
      subtitle:$('#articleSubtitle')?.value.trim()||'',
      excerpt:$('#articleExcerpt')?.value.trim()||'',
      author:$('#articleAuthor')?.value.trim()||'',
      category:$('#articleCategory')?.value.trim()||'',
      tags:parseTags($('#articleTags')?.value),
      body:$('#articleBody')?.value.trim()||'',
      image:currentImage||'',
      imageAlt:$('#articleImageAlt')?.value.trim()||'',
      imageCaption:$('#articleImageCaption')?.value.trim()||'',
      status:$('#articleStatus')?.value||'published',
      publishedAt:fromLocalDateTime($('#articlePublishedAt')?.value||''),
      slug:uniqueSlug($('#articleSlug')?.value||$('#articleTitle')?.value||'articolo',editingId),
      seoTitle:$('#articleSeoTitle')?.value.trim()||'',
      seoDescription:$('#articleSeoDescription')?.value.trim()||''
    };
  }
  function snapshotSignature(){return JSON.stringify(formSnapshot());}
  function isDirty(){return Boolean(baselineSignature&&snapshotSignature()!==baselineSignature);}
  function setBaseline(){baselineSignature=snapshotSignature();updateDirtyState();}
  function updateDirtyState(){
    const dirty=isDirty();
    const submit=$('#articleSubmitBtn');
    if(submit)submit.dataset.unsaved=dirty?'true':'false';
    const title=$('#articleFormTitle');
    if(title)title.dataset.unsaved=dirty?'true':'false';
  }
  function updateCounters(){
    const pairs=[['#articleTitle','#articleTitleCount'],['#articleSubtitle','#articleSubtitleCount'],['#articleExcerpt','#articleExcerptCount'],['#articleBody','#articleBodyCount']];
    pairs.forEach(([field,count])=>{const a=$(field),b=$(count);if(a&&b)b.textContent=String(a.value.length);});
  }
  function setFormMode(article=null){
    const title=$('#articleFormTitle'),hint=$('#articleFormHint'),submit=$('#articleSubmitBtn'),cancel=$('#cancelEditArticleBtn');
    if(title)title.textContent=article?'Modifica articolo':'Nuovo articolo';
    if(hint)hint.textContent=article?'Aggiorna i contenuti, controlla l’anteprima e salva senza perdere i dati esistenti.':'Compila i campi principali, controlla l’anteprima e scegli se pubblicare o salvare come bozza.';
    if(submit)submit.textContent=article?'Salva modifiche':'Salva articolo';
    if(cancel)cancel.hidden=!article;
  }
  function previewMarkup(image,title,alt=''){
    if(!image)return '<div class="article-image article-placeholder small"><span>NG</span><small>NEWS</small></div><span class="muted">Nessuna immagine selezionata.</span>';
    return `<img class="article-image small" src="${UI.esc(image)}" alt="${UI.esc(alt||`Anteprima immagine ${title||'articolo'}`)}"><span class="muted">Anteprima reale dell’immagine salvata.</span>`;
  }
  function refreshImagePreview(){
    const box=$('#articleImagePreview');
    if(box)box.innerHTML=previewMarkup(currentImage,$('#articleTitle')?.value,$('#articleImageAlt')?.value);
  }
  function clearValidation(){
    ['articleTitle','articleBody','articlePublishedAt','articleSlug'].forEach(id=>$('#'+id)?.removeAttribute('aria-invalid'));
    const box=$('#articleFormErrors');if(box)box.innerHTML='';
  }
  function showValidation(errors){
    clearValidation();
    if(!errors.length)return true;
    const box=$('#articleFormErrors');
    if(box)box.innerHTML=`<div class="message error"><strong>Controlla questi campi:</strong><ul>${errors.map(e=>`<li>${UI.esc(e.message)}</li>`).join('')}</ul></div>`;
    errors.forEach(e=>$('#'+e.field)?.setAttribute('aria-invalid','true'));
    $('#'+errors[0].field)?.focus();
    return false;
  }
  function validateArticle(data){
    const errors=[];
    if(!data.title)errors.push({field:'articleTitle',message:'Il titolo è obbligatorio.'});
    if(!data.body)errors.push({field:'articleBody',message:'Il testo completo è obbligatorio.'});
    if(data.status==='scheduled'&&!data.publishedAt)errors.push({field:'articlePublishedAt',message:'Indica la data per un articolo programmato.'});
    if(data.status==='scheduled'&&data.publishedAt&&Date.parse(data.publishedAt)<=Date.now())errors.push({field:'articlePublishedAt',message:'La pubblicazione programmata deve essere nel futuro.'});
    if(!data.slug)errors.push({field:'articleSlug',message:'Lo slug non può essere vuoto.'});
    return errors;
  }
  function resetForm({force=false}={}){
    if(!force&&isDirty()&&!window.confirm('Abbandonare le modifiche non salvate?'))return false;
    suppressDirty=true;
    editingId='';currentImage='';slugTouched=false;
    $('#articleForm')?.reset();
    $('#articleId').value='';
    $('#articleAuthor').value='Redazione New Generation';
    $('#articleCategory').value='Aggiornamenti';
    $('#articleStatus').value='published';
    $('#articlePublishedAt').value=toLocalDateTime(new Date().toISOString());
    $('#articleImage').value='';
    refreshImagePreview();
    clearValidation();
    setFormMode(null);
    updateCounters();
    suppressDirty=false;
    setBaseline();
    return true;
  }
  function fillForm(article){
    if(!article)return;
    if(isDirty()&&!window.confirm('Aprire un altro articolo e abbandonare le modifiche non salvate?'))return;
    suppressDirty=true;
    editingId=article.id;currentImage=article.image||'';slugTouched=true;
    $('#articleId').value=article.id;
    $('#articleTitle').value=article.title||'';
    $('#articleSubtitle').value=article.subtitle||'';
    $('#articleExcerpt').value=article.excerpt||'';
    $('#articleAuthor').value=article.author||'Redazione New Generation';
    $('#articleCategory').value=article.category||'Aggiornamenti';
    $('#articleTags').value=(article.tags||[]).join(', ');
    $('#articleBody').value=article.body||'';
    $('#articleImageAlt').value=article.imageAlt||'';
    $('#articleImageCaption').value=article.imageCaption||'';
    $('#articleStatus').value=article.status||'published';
    $('#articlePublishedAt').value=toLocalDateTime(article.publishedAt||article.updatedAt||article.createdAt);
    $('#articleSlug').value=article.slug||store.articleSlug(article.title);
    $('#articleSeoTitle').value=article.seoTitle||'';
    $('#articleSeoDescription').value=article.seoDescription||'';
    $('#articleImage').value='';
    refreshImagePreview();
    clearValidation();
    setFormMode(article);
    updateCounters();
    suppressDirty=false;
    setBaseline();
    $('#articleFormTitle')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function filteredArticles(){
    const query=String($('#adminArticleSearch')?.value||'').trim().toLocaleLowerCase('it');
    const status=$('#adminArticleStatusFilter')?.value||'all';
    const category=$('#adminArticleCategoryFilter')?.value||'all';
    return allArticles().filter(article=>{
      if(status!=='all'&&article.status!==status)return false;
      if(category!=='all'&&article.category!==category)return false;
      if(!query)return true;
      return [article.title,article.subtitle,article.excerpt,article.body,article.author,article.category,(article.tags||[]).join(' ')].join(' ').toLocaleLowerCase('it').includes(query);
    });
  }
  function renderCategoryOptions(){
    const categories=store.selectors.articleCategories(Admin.state(),{includeDrafts:true});
    const filter=$('#adminArticleCategoryFilter'),current=filter?.value||'all';
    if(filter){filter.innerHTML='<option value="all">Tutte</option>'+categories.map(c=>`<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('');filter.value=categories.includes(current)?current:'all';}
    const datalist=$('#articleCategorySuggestions');if(datalist)datalist.innerHTML=categories.map(c=>`<option value="${UI.esc(c)}"></option>`).join('');
  }
  function render(){
    const list=allArticles();
    if(editingId&&!list.some(a=>a.id===editingId)){
      resetForm({force:true});
      Admin.flash('#articleMsg','L’articolo che stavi modificando non è più disponibile.','error');
    }
    renderCategoryOptions();
    const visible=filteredArticles();
    $('#articleCount').textContent=String(list.length);
    $('#adminArticlesList').innerHTML=UI.articleList(visible,true);
    const published=list.filter(a=>a.status==='published').length,drafts=list.filter(a=>a.status==='draft').length,scheduled=list.filter(a=>a.status==='scheduled').length;
    const summary=$('#adminArticleSummary');
    if(summary)summary.innerHTML=`<span><strong>${visible.length}</strong> visualizzati</span><span><strong>${published}</strong> pubblicati</span><span><strong>${drafts}</strong> bozze</span><span><strong>${scheduled}</strong> programmati</span>`;
  }
  function imageFromFile(file){
    return new Promise((resolve,reject)=>{
      if(!file){resolve('');return;}
      if(!IMAGE_TYPES.has(file.type)){reject(new Error('Formato non valido. Usa JPG, PNG o WebP.'));return;}
      if(file.size>MAX_IMAGE_BYTES){reject(new Error('L’immagine supera il limite di 12 MB.'));return;}
      const url=URL.createObjectURL(file);
      const image=new Image();
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Il file non contiene un’immagine leggibile.'));};
      image.onload=()=>{
        try{
          if(!image.naturalWidth||!image.naturalHeight)throw new Error('Risoluzione immagine non valida.');
          const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(image.naturalWidth,image.naturalHeight));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          const context=canvas.getContext('2d',{alpha:file.type!=='image/jpeg'});
          if(!context)throw new Error('Ottimizzazione immagine non disponibile.');
          context.drawImage(image,0,0,canvas.width,canvas.height);
          const outputType=file.type==='image/png'?'image/png':file.type==='image/webp'?'image/webp':'image/jpeg';
          const data=canvas.toDataURL(outputType,outputType==='image/png'?undefined:.84);
          URL.revokeObjectURL(url);
          resolve(data);
        }catch(error){URL.revokeObjectURL(url);reject(error);}
      };
      image.src=url;
    });
  }
  async function waitForRemote(state,{timeout=10000}={}){
    const cfg=window.NEW_GENERATION_SUPABASE||{};
    if(!cfg.ENABLED)return {online:false,ok:true};
    if(typeof window.NG_FORCE_REMOTE_SAVE!=='function')throw new Error('Servizio di sincronizzazione non disponibile. Ricarica la pagina e riprova.');
    let timer;
    try{
      const result=await Promise.race([
        window.NG_FORCE_REMOTE_SAVE(state),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('La sincronizzazione online non ha risposto in tempo.')),timeout);})
      ]);
      if(result!==true)throw new Error('Il backend non ha confermato l’operazione. Verifica la sessione amministratore e riprova.');
      return {online:true,ok:true};
    }finally{clearTimeout(timer);}
  }
  function syncOverlayLock(){
    const open=Boolean($('#articlePreviewModal')?.classList.contains('open')||$('#deleteArticleDialog')?.classList.contains('show'));
    document.body.classList.toggle('ng-overlay-open',open);
  }
  function restoreTrigger(trigger){
    requestAnimationFrame(()=>{if(trigger&&document.contains(trigger))trigger.focus?.({preventScroll:true});});
  }
  function openPreview(article,trigger=null){
    const modal=$('#articlePreviewModal');
    if(!modal)return;
    previewTrigger=trigger||document.activeElement;
    previewArticleId=articleById(article?.id)?.id||'';
    $('#articlePreviewModalTitle').textContent=article.title||'Anteprima articolo';
    const previewBody=$('#articlePreviewModalBody');
    previewBody.innerHTML=UI.articleDetail(article,{preview:true});
    UI.prepareArticleDetail?.(previewBody,{onBack:()=>closePreview()});
    const remove=$('#deleteArticleFromPreviewBtn');
    if(remove){remove.hidden=!previewArticleId;remove.dataset.deleteArticlePreview=previewArticleId;}
    modal.classList.add('open');syncOverlayLock();
    requestAnimationFrame(()=>$('#closeArticlePreviewModal')?.focus());
  }
  function closePreview(){
    const trigger=previewTrigger;previewTrigger=null;previewArticleId='';
    const remove=$('#deleteArticleFromPreviewBtn');if(remove){remove.hidden=true;remove.dataset.deleteArticlePreview='';}
    $('#articlePreviewModal')?.classList.remove('open');syncOverlayLock();restoreTrigger(trigger);
  }
  function openDeleteDialog(id,trigger=null){
    const normalizedId=String(id||'').trim();
    const article=articleById(normalizedId);
    if(!normalizedId||!article){Admin.flash('#articleMsg','Impossibile eliminare: identificativo articolo non valido.','error');return false;}
    deleteArticleId=normalizedId;deleteArticleTrigger=trigger||document.activeElement;
    const dialog=$('#deleteArticleDialog');
    $('#deleteArticleDialogText').textContent=`Stai per eliminare “${article.title}”. L’operazione è irreversibile e l’articolo verrà rimosso anche dal sito pubblico.`;
    $('#deleteArticleDialogMsg').innerHTML='';
    dialog.hidden=false;dialog.classList.add('show','open');syncOverlayLock();
    requestAnimationFrame(()=>$('#cancelDeleteArticleBtn')?.focus());
    return true;
  }
  function closeDeleteDialog(){
    const trigger=deleteArticleTrigger;deleteArticleTrigger=null;
    const dialog=$('#deleteArticleDialog');dialog.classList.remove('show','open');dialog.hidden=true;dialog.removeAttribute('aria-busy');deleteArticleId='';syncOverlayLock();restoreTrigger(trigger);
  }
  async function deleteArticlePersisted(id){
    const previous=Admin.state();
    const article=store.selectors.articleById(previous,id,{includeDrafts:true});
    if(!article)throw new Error('L’articolo non esiste più o è già stato eliminato.');
    const next=window.structuredClone?structuredClone(previous):JSON.parse(JSON.stringify(previous));
    next.articles=(next.articles||[]).filter(item=>String(item.id)!==String(id));
    if(next.articles.length===(previous.articles||[]).length)throw new Error('Identificativo articolo non valido.');
    store.alignState(next);
    const remote=await waitForRemote(next);
    if(remote.online&&typeof window.NG_VERIFY_REMOTE_ARTICLE_ABSENT==='function'){
      const verified=await window.NG_VERIFY_REMOTE_ARTICLE_ABSENT(id);
      if(!verified)throw new Error('Il backend non ha confermato la cancellazione dell’articolo.');
    }
    try{
      const saved=remote.online&&typeof window.NG_SAVE_LOCAL_AFTER_REMOTE==='function'?window.NG_SAVE_LOCAL_AFTER_REMOTE(next):store.save('admin',next);
      refreshPublicCache(saved);
      return {article,saved,remote};
    }catch(error){
      if(remote.online&&typeof window.NG_FORCE_REMOTE_SAVE==='function'){
        try{await window.NG_FORCE_REMOTE_SAVE(previous);}catch(rollbackError){console.error('[Articoli] rollback remoto non riuscito',rollbackError);}
      }
      throw error;
    }
  }
  function applyFormat(type){
    const textarea=$('#articleBody');if(!textarea)return;
    const start=textarea.selectionStart,end=textarea.selectionEnd,selected=textarea.value.slice(start,end);
    const lineStart=textarea.value.lastIndexOf('\n',Math.max(0,start-1))+1;
    let replacement=selected,cursorOffset=0;
    if(type==='heading'){replacement=`## ${selected||'Titolo paragrafo'}`;cursorOffset=selected?replacement.length:3;}
    if(type==='bold'){replacement=`**${selected||'testo in grassetto'}**`;cursorOffset=selected?replacement.length:2;}
    if(type==='italic'){replacement=`*${selected||'testo in corsivo'}*`;cursorOffset=selected?replacement.length:1;}
    if(type==='list'){
      const block=selected||'prima voce\nseconda voce';replacement=block.split('\n').map(line=>`- ${line.replace(/^[-*]\s+/,'')}`).join('\n');cursorOffset=replacement.length;
    }
    if(type==='quote'){replacement=`> ${selected||'citazione'}`;cursorOffset=selected?replacement.length:2;}
    if(type==='link'){
      const label=selected||'testo del collegamento';replacement=`[${label}](https://)`;cursorOffset=replacement.length-1;
    }
    const replaceStart=['heading','list','quote'].includes(type)&&start===end?lineStart:start;
    textarea.setRangeText(replacement,replaceStart,end,'end');
    if(!selected&&cursorOffset)textarea.setSelectionRange(replaceStart+cursorOffset,replaceStart+cursorOffset+(type==='link'?0:Math.max(0,replacement.length-cursorOffset-(type==='bold'?2:type==='italic'?1:0))));
    textarea.focus();textarea.dispatchEvent(new Event('input',{bubbles:true}));
  }

  $('#articleImage')?.addEventListener('change',async event=>{
    const input=event.currentTarget,file=input.files?.[0];
    if(!file)return;
    const preview=$('#articleImagePreview');
    preview?.setAttribute('aria-busy','true');
    try{
      currentImage=await imageFromFile(file);
      if(!$('#articleImageAlt').value.trim())$('#articleImageAlt').value=`Immagine principale dell’articolo ${$('#articleTitle').value.trim()||'senza titolo'}`;
      refreshImagePreview();updateDirtyState();
      Admin.flash('#articleMsg',`Immagine ottimizzata: ${file.name}.`);
    }catch(error){input.value='';Admin.flash('#articleMsg',error.message||String(error),'error');}
    finally{preview?.removeAttribute('aria-busy');}
  });
  $('#removeArticleImageBtn')?.addEventListener('click',()=>{currentImage='';$('#articleImage').value='';refreshImagePreview();updateDirtyState();});
  $('#articlePreviewBtn')?.addEventListener('click',event=>{
    const data=formSnapshot(),errors=validateArticle(data);
    if(!showValidation(errors))return;
    const existing=editingId?articleById(editingId):null;
    openPreview({...existing,...data,id:editingId||'preview',createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()},event.currentTarget);
  });
  $('#closeArticlePreviewModal')?.addEventListener('click',closePreview);
  $('#deleteArticleFromPreviewBtn')?.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    if(previewArticleId)openDeleteDialog(previewArticleId,event.currentTarget);
  });
  $('#articlePreviewModal')?.addEventListener('click',event=>{if(event.target.id==='articlePreviewModal')closePreview();});
  $('#cancelEditArticleBtn')?.addEventListener('click',()=>resetForm());
  $('#articleTitle')?.addEventListener('input',()=>{if(!slugTouched)$('#articleSlug').value=store.articleSlug($('#articleTitle').value);});
  $('#articleSlug')?.addEventListener('input',event=>{slugTouched=true;event.currentTarget.value=store.articleSlug(event.currentTarget.value);});
  $('#articleStatus')?.addEventListener('change',event=>{
    if(event.currentTarget.value!=='draft'&&!$('#articlePublishedAt').value)$('#articlePublishedAt').value=toLocalDateTime(new Date().toISOString());
  });
  $('#articleImageAlt')?.addEventListener('input',refreshImagePreview);
  document.querySelectorAll('[data-article-format]').forEach(button=>button.addEventListener('click',()=>applyFormat(button.dataset.articleFormat)));
  $('#articleForm')?.addEventListener('input',()=>{updateCounters();if(!suppressDirty)updateDirtyState();});
  $('#articleForm')?.addEventListener('change',()=>{if(!suppressDirty)updateDirtyState();});
  ['#adminArticleSearch','#adminArticleStatusFilter','#adminArticleCategoryFilter'].forEach(selector=>$(selector)?.addEventListener(selector==='#adminArticleSearch'?'input':'change',render));

  $('#articleForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const data=formSnapshot(),errors=validateArticle(data);
    if(!showValidation(errors))return;
    const button=$('#articleSubmitBtn');
    if(window.NGInteractive?.isButtonBusy(button))return;
    window.NGInteractive?.setButtonBusy(button,true,'Salvataggio…');
    const now=new Date().toISOString(),existing=editingId?articleById(editingId):null;
    if(data.status==='published'&&!data.publishedAt)data.publishedAt=existing?.publishedAt||now;
    try{
      const saved=Admin.commit(state=>{
        state.articles=Array.isArray(state.articles)?state.articles:[];
        if(editingId){
          const target=state.articles.find(article=>article.id===editingId);
          if(!target)throw new Error('Articolo non più disponibile.');
          Object.assign(target,data,{id:target.id,createdAt:target.createdAt||now,updatedAt:now});
        }else{
          state.articles.unshift({...data,id:store.uid('article'),createdAt:now,updatedAt:now});
        }
      });
      refreshPublicCache(saved);
      render();
      try{
        const remote=await waitForRemote(saved);
        Admin.flash('#articleMsg',remote.online?'Articolo salvato e sincronizzato online.':'Articolo salvato.');
      }catch(error){
        Admin.flash('#articleMsg','Articolo salvato nel browser; sincronizzazione online ancora in attesa. I dati inseriti non sono stati persi.','error');
      }
      resetForm({force:true});
    }catch(error){Admin.flash('#articleMsg',error.message||String(error),'error');}
    finally{window.NGInteractive?.setButtonBusy(button,false);}
  });

  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-edit-article],[data-preview-article],[data-delete-article]');
    if(!action)return;
    event.preventDefault();event.stopPropagation();
    if(action.matches('[data-edit-article]')){fillForm(articleById(action.dataset.editArticle));return;}
    if(action.matches('[data-preview-article]')){const article=articleById(action.dataset.previewArticle);if(article)openPreview(article,action);return;}
    openDeleteDialog(action.dataset.deleteArticle,action);
  });
  $('#cancelDeleteArticleBtn')?.addEventListener('click',closeDeleteDialog);
  $('#deleteArticleDialog')?.addEventListener('click',event=>{if(event.target.id==='deleteArticleDialog')closeDeleteDialog();});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if($('#deleteArticleDialog')?.classList.contains('show')){event.preventDefault();closeDeleteDialog();return;}
    if($('#articlePreviewModal')?.classList.contains('open')){event.preventDefault();closePreview();}
  });
  $('#confirmDeleteArticleBtn')?.addEventListener('click',async event=>{
    event.preventDefault();event.stopPropagation();
    const id=String(deleteArticleId||'').trim(),article=articleById(id);
    if(!id||!article){$('#deleteArticleDialogMsg').innerHTML='<div class="message error">Articolo non disponibile o identificativo non valido.</div>';return;}
    const button=$('#confirmDeleteArticleBtn');if(window.NGInteractive?.isButtonBusy(button))return;
    window.NGInteractive?.setButtonBusy(button,true,'Eliminazione…');
    $('#deleteArticleDialog')?.setAttribute('aria-busy','true');
    try{
      const result=await deleteArticlePersisted(id);
      render();
      if(editingId===id)resetForm({force:true});
      const previewWasOpen=previewArticleId===id&&$('#articlePreviewModal')?.classList.contains('open');
      closeDeleteDialog();
      if(previewWasOpen)closePreview();
      Admin.flash('#articleMsg',`Articolo “${result.article.title}” eliminato e sincronizzato.`);
      console.info('[Articoli]',{action:'delete',articleId:id,remote:result.remote.online?'confirmed':'offline-local'});
    }catch(error){
      console.warn('[Articoli] eliminazione fallita',{articleId:id,error:String(error?.message||error)});
      $('#deleteArticleDialogMsg').innerHTML=`<div class="message error">${UI.esc(error.message||String(error))} L’articolo non è stato rimosso e puoi riprovare.</div>`;
    }finally{
      $('#deleteArticleDialog')?.removeAttribute('aria-busy');
      window.NGInteractive?.setButtonBusy(button,false);
    }
  });

  window.addEventListener('beforeunload',event=>{if(!isDirty())return;event.preventDefault();event.returnValue='';});
  window.NexoraAdminRefresh=function(){render();};
  window.addEventListener('ng:admin-state-loaded',render);
  resetForm({force:true});
  render();
})();
````

## `/mnt/data/ng-work/new-generation-main/assets/js/admin-photos.js`

````javascript
// =============================================================
// New Generation — admin-photos.js (v126.16 rete/upload affidabile)
// =============================================================
// Funzionalità:
//   - Drag&drop area per upload
//   - Preview con thumbnail prima dell'upload
//   - Originali invariati con stato per ogni file e retry selettivo
//   - Grid con selezione multipla e eliminazione batch
//   - Lightbox full-screen con navigazione frecce
//   - Mobile-first responsive
// =============================================================
(function(){
  const A = window.NexoraAdmin;
  const UI = window.NexoraUI;
  const store = window.NexoraStore;
  const Photos = window.NexoraPhotos;
  if(!A || !UI || !store || !Photos){ console.error('Dipendenze mancanti per admin-photos'); return; }

  let selectedTeam = '';
  let selectedPhotos = new Set();       // path delle foto selezionate (batch delete)
  let lightboxIndex = -1;               // indice della foto aperta nel lightbox
  let lastLightboxTrigger = null;
  let uploadInProgress = false;
  let stagedFiles = [];
  let activeJobsRef = [];
  let failedJobs = [];
  const activeUploadControllers = new Map();
  let editingPhotoPath = '';
  let editorTrigger = null;

  // Loader robusto immagini foto (desktop + mobile + refresh realtime)
  // ------------------------------------------------------------
  // Su mobile il problema più frequente è un errore temporaneo della thumbnail
  // o una richiesta lazy/stalled dopo refresh realtime. Il lightbox funziona perché
  // usa l'originale, quindi per dispositivi touch/schermi piccoli diamo priorità
  // all'originale e usiamo la thumbnail solo come alternativa. Il loader non si
  // affida a complete da solo: complete può essere true anche per immagini rotte.
  function attachSmartImageRetry(img, opts={}){
    if(!img) return;
    if(window.NGPhotoEngine){
      window.NGPhotoEngine.load(img, opts);
      return;
    }
    // Fallback minimo se photo-runtime.js non viene caricato.
    const thumb = img.closest('.photo-thumb');
    const primary = img.dataset.src || img.dataset.previewSrc || '';
    const original = img.dataset.fallbackSrc || img.dataset.originalSrc || primary;
    function mark(cls){
      if(!thumb) return;
      thumb.classList.remove('is-loading','is-loaded','is-broken');
      thumb.classList.add(cls);
    }
    mark('is-loading');
    img.onload = () => {
      if(img.naturalWidth > 0 || img.naturalHeight > 0) mark('is-loaded');
      else if(img.src !== original) img.src = original;
      else mark('is-broken');
    };
    img.onerror = () => {
      if(original && img.src !== original) img.src = original;
      else mark('is-broken');
    };
    img.src = primary || original;
  }

  // -------------------- Confirm Modal --------------------
  // Sostituto del confirm() nativo con UI custom e backdrop blur
  function confirmDialog(opts){
    if(document.querySelector('.ng-confirm-overlay')) return Promise.resolve(false);
    return new Promise(resolve => {
      const previousFocus=document.activeElement;
      const overlay = document.createElement('div');
      const titleId = `ng-confirm-title-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      overlay.className = 'ng-confirm-overlay';
      overlay.setAttribute('aria-hidden','true');
      overlay.innerHTML = `<div class="ng-confirm-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="ng-confirm-icon" aria-hidden="true">${opts.icon || '⚠️'}</div>
        <h3 class="ng-confirm-title" id="${titleId}">${UI.esc(opts.title || 'Sei sicuro?')}</h3>
        <p class="ng-confirm-text">${UI.esc(opts.text || '')}</p>
        <div class="ng-confirm-actions">
          <button type="button" class="btn ng-confirm-cancel">${UI.esc(opts.cancelLabel || 'Annulla')}</button>
          <button type="button" class="btn ${opts.danger?'danger':'primary'} ng-confirm-ok">${UI.esc(opts.okLabel || 'Conferma')}</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.getBoundingClientRect();
      overlay.setAttribute('aria-hidden','false');
      overlay.classList.add('open');
      requestAnimationFrame(()=>overlay.querySelector('.ng-confirm-cancel')?.focus());
      let settled = false, removed = false;
      function finishRemoval(){
        if(removed)return;
        removed=true;
        overlay.remove();
      }
      function removeAfterTransition(){
        // Alcuni motori possono lasciare animation.finished in sospeso quando
        // una transizione viene interrotta da aperture/chiusure molto rapide.
        // Il fallback mantiene la modale idempotente e impedisce overlay residui.
        const fallback=setTimeout(finishRemoval,450);
        requestAnimationFrame(()=>{
          const card=overlay.querySelector('.ng-confirm-card');
          const animations = typeof overlay.getAnimations === 'function'
            ? [...overlay.getAnimations(),...(card?.getAnimations?.()||[])]
            : [];
          if(!animations.length){clearTimeout(fallback);finishRemoval();return;}
          Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{clearTimeout(fallback);finishRemoval();});
        });
      }
      function onKeydown(event){
        if(event.key==='Escape'){event.preventDefault();close(false);return;}
        if(event.key!=='Tab')return;
        const focusable=[...overlay.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
        if(!focusable.length)return;
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
      function close(result){
        if(settled) return;
        settled = true;
        document.removeEventListener('keydown',onKeydown);
        overlay.classList.add('is-closing');
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden','true');
        removeAfterTransition();
        requestAnimationFrame(()=>previousFocus&&document.contains(previousFocus)&&previousFocus.focus?.({preventScroll:true}));
        resolve(result);
      }
      document.addEventListener('keydown',onKeydown);
      overlay.addEventListener('click', e=>{
        if(e.target === overlay || e.target.closest('.ng-confirm-cancel')) close(false);
        else if(e.target.closest('.ng-confirm-ok')) close(true);
      });
    });
  }

  function render(){
    const s = A.state();
    renderTeamSelector(s);
    if(selectedTeam && !s.teams.find(t=>t.id===selectedTeam)) selectedTeam = '';
    selectedPhotos = new Set([...selectedPhotos].filter(path => {
      // Tieni solo path che esistono ancora
      const photoMap = Photos.getTeamPhotoMap ? Photos.getTeamPhotoMap(s) : (s.teamPhotos || {});
      const photos = photoMap?.[selectedTeam] || [];
      return photos.some(p => p.path === path || p.publicId === path || p.id === path);
    }));
    renderWorkspace(s);
    renderBulkActions();
    UI.applySiteTheme?.(s);
  }

  // -------------------- Sidebar squadre --------------------
  function renderTeamSelector(s){
    const wrap = UI.$('#photosTeamList');
    if(!wrap) return;
    if(!s.teams.length){
      wrap.innerHTML = '<div class="empty small">Aggiungi prima delle squadre nella sezione "Squadre".</div>';
      return;
    }
    // Calcolo totale foto + dimensione bucket
    const photoMap = Photos.getTeamPhotoMap ? Photos.getTeamPhotoMap(s) : (s.teamPhotos || {});
    const totalPhotos = Object.values(photoMap||{}).reduce((sum,arr)=>sum+(arr?.length||0), 0);
    const totalBytes = Object.values(photoMap||{}).flat().reduce((sum,p)=>sum+(p?.size||0), 0);

    wrap.innerHTML = `<div class="team-list-summary">
      <span class="pill">📷 ${totalPhotos} foto · ${formatSize(totalBytes)}</span>
    </div>
    <div class="team-pick-grid">${s.teams.map(t=>{
      const count = (photoMap?.[t.id]||[]).length;
      const active = t.id===selectedTeam ? ' active' : '';
      const hasPhotos = count > 0 ? ' has-photos' : '';
      return `<button type="button" class="team-pick-btn${active}${hasPhotos}" data-team-pick="${UI.esc(t.id)}">
        ${UI.logo(t,false)}
        <span class="team-pick-name">${UI.esc(t.name)}</span>
        <span class="team-pick-meta">${count > 0 ? count+' foto' : 'Nessuna'}</span>
      </button>`;
    }).join('')}</div>`;
  }

  // -------------------- Workspace --------------------
  function renderWorkspace(s){
    const title = UI.$('#photosTitle');
    const subtitle = UI.$('#photosSubtitle');
    const count = UI.$('#photosCount');
    const uploadArea = UI.$('#photosUploadArea');
    const grid = UI.$('#photosGrid');
    if(!title || !uploadArea || !grid) return;

    if(!selectedTeam){
      title.textContent = 'Foto squadra';
      subtitle.textContent = 'Scegli una squadra a sinistra per iniziare.';
      if(count) count.textContent = '0';
      uploadArea.hidden = true;
      grid.innerHTML = '<div class="empty">Nessuna squadra selezionata.</div>';
      return;
    }
    const team = s.teams.find(t=>t.id===selectedTeam);
    if(!team) return;
    const photos = Photos.listTeamPhotos(s, team.id);
    title.innerHTML = `${UI.logo(team,false)} ${UI.esc(team.name)}`;
    subtitle.textContent = photos.length
      ? `${photos.length} foto · ${formatSize(photos.reduce((s,p)=>s+(p.size||0),0))}`
      : 'Nessuna foto caricata: trascina i file qui sotto o usa il pulsante.';
    if(count) count.textContent = String(photos.length);
    uploadArea.hidden = false;

    if(!photos.length){
      grid.innerHTML = '<div class="empty photos-empty"><div class="empty-icon">📷</div><div>Nessuna foto caricata per questa squadra.</div><small>Carica la prima foto usando il pulsante sopra o trascinando i file nell\'area di upload.</small></div>';
      grid.dataset.renderKey = '';
      return;
    }

    // Rendering idempotente: vedi commento esteso in public.js renderPhotos.
    // Riduce drasticamente il flicker e le richieste HTTP duplicate quando
    // arrivano update remoti che non toccano le foto.
    const renderKey = team.id + '|' + photos.map(p=>p.path).join(',') + '|sel:' + Array.from(selectedPhotos).sort().join(',');
    if(grid.dataset.renderKey === renderKey){
      const byPath = new Map();
      grid.querySelectorAll('.photo-thumb[data-photo-path]').forEach(el => byPath.set(el.dataset.photoPath, el));
      photos.forEach((p, i) => {
        const el = byPath.get(p.path);
        if(!el) return;
        el.dataset.photoIndex = i;
        const img = el.querySelector('img[data-src]');
        const nextSrc = p.thumbUrl || p.url || '';
        const nextFallback = p.originalUrl || p.url || '';
        if(img){
          img.dataset.photoOpen = i;
          const changed = img.dataset.src !== nextSrc || img.dataset.fallbackSrc !== nextFallback;
          if(changed){
            img.dataset.src = nextSrc;
            img.dataset.fallbackSrc = nextFallback;
            img.dataset.previewSrc = nextSrc;
            img.dataset.originalSrc = nextFallback;
            img.dataset.photoVersion = String(p.ts || p.path || i);
          }
          attachSmartImageRetry(img, {force: changed || el.classList.contains('is-broken')});
        }
      });
      return;
    }

    const prevKey = grid.dataset.renderKey || '';
    const prevTeamId = prevKey.split('|')[0];
    const sameTeam = prevTeamId === team.id && prevKey !== '';
    const existingByPath = new Map();
    if(sameTeam){
      grid.querySelectorAll('.photo-thumb[data-photo-path]').forEach(el => {
        existingByPath.set(el.dataset.photoPath, el);
      });
    }

    function buildAdminThumb(p, i){
      const isSelected = selectedPhotos.has(p.path);
      const loadStrategy = i < 6 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
      const imgSrc = UI.esc(p.thumbUrl||p.url);
      const fallbackSrc = UI.esc(p.originalUrl||p.url);
      const thumbPathAttr = p.thumbPath ? ` data-thumb-path="${UI.esc(p.thumbPath)}"` : '';
      const fig = document.createElement('figure');
      fig.className = 'photo-thumb admin is-loading' + (isSelected ? ' is-selected' : '');
      fig.dataset.photoPath = p.path;
      fig.dataset.photoIndex = i;
      fig.style.setProperty('--enter-delay', Math.min(i*12, 150) + 'ms');
      fig.innerHTML = `
        <div class="photo-img-wrap">
          <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-photo-managed="1" data-src="${imgSrc}" data-fallback-src="${fallbackSrc}" data-preview-src="${imgSrc}" data-original-src="${fallbackSrc}" data-photo-version="${UI.esc(String(p.ts||p.path||i))}"${thumbPathAttr} data-retries="0" alt="" ${loadStrategy} decoding="async" data-photo-open="${i}" />
          <div class="photo-status photo-status-loading" aria-hidden="true">
            <span class="photo-status-dots"><span></span><span></span><span></span></span>
            <span class="photo-status-text">Recupero dati, attendere…</span>
          </div>
          <div class="photo-status photo-status-error" aria-hidden="true">
            <span class="photo-status-icon">📷</span>
            <span class="photo-status-text">Foto non disponibile</span>
            <button type="button" class="photo-status-retry" data-photo-retry aria-label="Riprova caricamento">Riprova</button>
          </div>
          <div class="photo-overlay">
            <button type="button" class="photo-action-btn photo-zoom" data-photo-open="${i}" aria-label="Visualizza foto originale" title="Visualizza">🔍</button>
            <button type="button" class="photo-action-btn photo-select" data-photo-select="${UI.esc(p.path)}" aria-label="Seleziona" title="Seleziona">${isSelected?'✓':'○'}</button>
            <button type="button" class="photo-action-btn" data-photo-edit="${UI.esc(p.path)}" aria-label="Modifica metadati" title="Modifica metadati">✎</button>
            <button type="button" class="photo-action-btn" data-photo-replace="${UI.esc(p.path)}" aria-label="Sostituisci originale" title="Sostituisci originale">↻</button>
            <a class="photo-action-btn" href="${UI.esc(Photos.originalDownloadUrl(p))}" download="${UI.esc(p.name)}" data-admin-photo-download aria-label="Scarica originale" title="Scarica originale">⬇</a>
          </div>
        </div>
        <figcaption>
          <span class="photo-name" title="${UI.esc(p.name)}">${UI.esc(p.title||p.name)}</span>
          <small>${p.width&&p.height?`${p.width}×${p.height} · `:''}${formatSize(p.size)}</small>
        </figcaption>
        <button type="button" class="photo-delete-btn" data-delete-photo="${UI.esc(p.path)}" aria-label="Elimina foto" title="Elimina">×</button>`;
      return fig;
    }

    if(!sameTeam || existingByPath.size === 0){
      const frag = document.createDocumentFragment();
      photos.forEach((p,i) => frag.appendChild(buildAdminThumb(p, i)));
      grid.innerHTML = '';
      grid.appendChild(frag);
    } else {
      // Diff in-place SENZA innerHTML='' (preserva nodi e img in caricamento)
      existingByPath.forEach((el, path) => {
        if(!photos.find(p => p.path === path)) el.remove();
      });
      photos.forEach((p, i) => {
        let el = existingByPath.get(p.path);
        const refNode = grid.children[i] || null;
        if(el){
          if(refNode !== el) grid.insertBefore(el, refNode);
          el.dataset.photoIndex = i;
          const img = el.querySelector('img[data-src]');
          const nextSrc = p.thumbUrl || p.url || '';
          const nextFallback = p.originalUrl || p.url || '';
          if(img){
            img.dataset.photoOpen = i;
            const changed = img.dataset.src !== nextSrc || img.dataset.fallbackSrc !== nextFallback;
            if(changed){
              img.dataset.src = nextSrc;
              img.dataset.fallbackSrc = nextFallback;
              img.dataset.previewSrc = nextSrc;
              img.dataset.originalSrc = nextFallback;
              img.dataset.photoVersion = String(p.ts || p.path || i);
            }
            attachSmartImageRetry(img, {force: changed || el.classList.contains('is-broken')});
          }
          // Aggiorna stato selezione senza distruggere
          const isSelected = selectedPhotos.has(p.path);
          el.classList.toggle('is-selected', isSelected);
          const selBtn = el.querySelector('[data-photo-select]');
          if(selBtn) selBtn.textContent = isSelected ? '✓' : '○';
        } else {
          el = buildAdminThumb(p, i);
          grid.insertBefore(el, refNode);
        }
      });
    }
    grid.dataset.renderKey = renderKey;
    // Smart retry per immagini lente/errori transitori
    grid.querySelectorAll('img[data-src]').forEach(img => attachSmartImageRetry(img));
  }

  function renderBulkActions(){
    let bar = UI.$('#photosBulkBar');
    if(!selectedTeam){ if(bar) bar.remove(); return; }
    if(!bar){
      bar = document.createElement('div');
      bar.id = 'photosBulkBar';
      bar.className = 'photos-bulk-bar';
      const ws = UI.$('#photosWorkspace');
      if(ws) ws.appendChild(bar);
    }
    if(selectedPhotos.size === 0){
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML = `<div class="bulk-info"><strong>${selectedPhotos.size}</strong> foto selezionate</div>
      <div class="bulk-actions">
        <button type="button" class="btn small" id="photosBulkDeselect">Deseleziona tutte</button>
        <button type="button" class="btn small primary" id="photosBulkDownload">⬇ ZIP originali</button>
        <button type="button" class="btn small danger" id="photosBulkDelete">🗑 Elimina selezionate</button>
      </div>`;
  }

  function formatSize(bytes){
    bytes = Number(bytes)||0;
    if(bytes < 1024) return bytes+' B';
    if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
    return (bytes/1024/1024).toFixed(2)+' MB';
  }

  // -------------------- Drag & drop + staging --------------------
  function setupDragDrop(){
    const dropZone = UI.$('#photosDropZone');
    if(!dropZone || dropZone.dataset.bound === '1') return;
    dropZone.dataset.bound = '1';
    ['dragenter','dragover'].forEach(eventName=>{
      dropZone.addEventListener(eventName,event=>{
        event.preventDefault();event.stopPropagation();
        if(!uploadInProgress)dropZone.classList.add('is-drag-over');
      });
    });
    ['dragleave','drop'].forEach(eventName=>{
      dropZone.addEventListener(eventName,event=>{
        event.preventDefault();event.stopPropagation();dropZone.classList.remove('is-drag-over');
      });
    });
    dropZone.addEventListener('drop',event=>{
      if(uploadInProgress){flashMsg('Attendi il completamento del batch corrente.','warn');return;}
      const files=Array.from(event.dataTransfer?.files||[]);
      if(!selectedTeam){flashMsg('Seleziona prima una squadra.','warn');return;}
      uploadFiles(files).catch(error=>flashMsg(Photos.userMessage(error),'error'));
    });
  }

  const UPLOAD_CONCURRENCY = 3;

  function fileFingerprint(file){
    return [String(file?.name||'').toLocaleLowerCase('it'),Number(file?.size||0),Number(file?.lastModified||0)].join('|');
  }

  function setUploadUiBusy(busy){
    uploadInProgress=Boolean(busy);
    const input=UI.$('#photosFileInput');if(input)input.disabled=uploadInProgress;
    const drop=UI.$('#photosDropZone');
    if(drop){drop.classList.toggle('is-busy',uploadInProgress);drop.setAttribute('aria-busy',String(uploadInProgress));}
    const confirm=UI.$('#photosStagingConfirmBtn');if(confirm)confirm.disabled=uploadInProgress;
    const add=UI.$('#photosStagingAddBtn');if(add)add.disabled=uploadInProgress;
  }

  async function uploadFiles(rawFiles){
    if(!selectedTeam){flashMsg('Seleziona prima una squadra.','warn');return;}
    if(uploadInProgress){flashMsg('È già in corso un caricamento.','warn');return;}
    const incoming=Array.from(rawFiles||[]).filter(Boolean);
    if(!incoming.length)return;

    const limits=Photos.config||{};
    const maxFiles=Number(limits.MAX_BATCH_FILES||20);
    const maxBatchSize=Number(limits.MAX_BATCH_SIZE||80*1024*1024);
    if(stagedFiles.length+incoming.length>maxFiles){
      flashMsg(`Puoi preparare al massimo ${maxFiles} foto per batch.`,'error');return;
    }
    const totalBytes=stagedFiles.reduce((sum,item)=>sum+item.file.size,0)+incoming.reduce((sum,file)=>sum+(file.size||0),0);
    if(totalBytes>maxBatchSize){flashMsg('Il batch supera il limite totale di 80 MB.','error');return;}

    const state=A.state();
    const existing=Photos.listTeamPhotos(state,selectedTeam);
    const knownNames=new Set(existing.map(photo=>String(photo.originalName||photo.name||'').toLocaleLowerCase('it')));
    const knownFingerprints=new Set(stagedFiles.map(item=>fileFingerprint(item.file)));
    const unique=[];
    let duplicateCount=0;
    incoming.forEach(file=>{
      const fingerprint=fileFingerprint(file);
      const sameName=knownNames.has(String(file.name||'').toLocaleLowerCase('it'));
      if(knownFingerprints.has(fingerprint)||sameName){duplicateCount++;return;}
      knownFingerprints.add(fingerprint);unique.push(file);
    });
    if(!unique.length){flashMsg('Nessun file nuovo da aggiungere: i file selezionati sono duplicati.','warn');return;}

    flashMsg(`Validazione di ${unique.length} ${unique.length===1?'foto':'foto'} in corso…`,'info');
    const results=await Photos.validateBatch(unique);
    const invalid=results.filter(result=>!result.ok);
    results.filter(result=>result.ok).forEach(result=>{
      stagedFiles.push({
        id:'staged_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
        file:result.file,
        meta:result.meta,
        blobUrl:URL.createObjectURL(result.file)
      });
    });
    const input=UI.$('#photosFileInput');if(input)input.value='';
    renderStagingPanel({duplicateCount,invalid});
    if(invalid.length||duplicateCount){
      const first=invalid[0]?.error;
      const parts=[];
      if(duplicateCount)parts.push(`${duplicateCount} duplicate`);
      if(invalid.length)parts.push(`${invalid.length} non valide${first?`: ${Photos.userMessage(first)}`:''}`);
      flashMsg(`Selezione parziale: ${parts.join(' · ')}.`,'warn');
    }else flashMsg(`${results.length} ${results.length===1?'foto pronta':'foto pronte'} per l’upload.`,'ok');
  }

  function renderStagingPanel(summary={}){
    const progressEl=UI.$('#photosUploadProgress');
    if(!progressEl)return;
    if(!stagedFiles.length){progressEl.innerHTML='';return;}
    const totalSize=stagedFiles.reduce((sum,item)=>sum+item.file.size,0);
    const ignored=(summary.duplicateCount||0)+(summary.invalid?.length||0);
    progressEl.innerHTML=`
      <div class="upload-panel staging-panel" aria-label="Anteprima locale foto selezionate">
        <div class="upload-panel-head">
          <div class="upload-panel-info">
            <strong>${stagedFiles.length}</strong> ${stagedFiles.length===1?'foto pronta':'foto pronte'} · <span>${formatSize(totalSize)}</span>
            ${ignored?`<small class="upload-panel-skipped">${ignored} ignorate</small>`:''}
          </div>
          <div class="upload-panel-actions">
            <button type="button" class="btn small" id="photosStagingClearBtn">Svuota</button>
            <button type="button" class="btn small" id="photosStagingAddBtn">+ Aggiungi</button>
            <button type="button" class="btn small primary" id="photosStagingConfirmBtn">⬆ Carica ${stagedFiles.length}</button>
          </div>
        </div>
        <p class="upload-panel-rules">JPEG, PNG o WebP · massimo 10 MB per file · massimo 20 file / 80 MB per batch.</p>
        <div class="staging-grid">
          ${stagedFiles.map(item=>`
            <figure class="staging-thumb" data-staging-id="${item.id}">
              <div class="staging-thumb-img"><img src="${item.blobUrl}" alt="Anteprima locale di ${UI.esc(item.file.name)}" loading="lazy"></div>
              <figcaption>
                <span class="staging-thumb-name" title="${UI.esc(item.file.name)}">${UI.esc(item.file.name)}</span>
                <small>${item.meta?.width||0}×${item.meta?.height||0} · ${formatSize(item.file.size)} · non ancora caricata</small>
              </figcaption>
              <button type="button" class="staging-thumb-remove" data-remove-staged="${item.id}" aria-label="Rimuovi ${UI.esc(item.file.name)}" title="Rimuovi">×</button>
            </figure>`).join('')}
        </div>
      </div>`;
  }

  function removeStagedFile(id){
    if(uploadInProgress)return;
    const index=stagedFiles.findIndex(item=>item.id===id);
    if(index<0)return;
    const [item]=stagedFiles.splice(index,1);
    if(item.blobUrl)URL.revokeObjectURL(item.blobUrl);
    renderStagingPanel();
  }

  function clearStaging(){
    if(uploadInProgress)return;
    stagedFiles.forEach(item=>item.blobUrl&&URL.revokeObjectURL(item.blobUrl));
    stagedFiles=[];
    renderStagingPanel();
  }

  async function confirmAndUpload(){
    if(uploadInProgress)return;
    if(!stagedFiles.length){flashMsg('Niente da caricare.','warn');return;}
    if(!selectedTeam){flashMsg('Seleziona prima una squadra.','warn');return;}
    const teamId=selectedTeam;
    const jobs=stagedFiles.map(item=>({...item,teamId,status:'queued',metaResult:null,error:null}));
    stagedFiles=[];
    await runUploadJobs(jobs);
  }

  async function runUploadJobs(jobs){
    if(!jobs.length)return;
    setUploadUiBusy(true);
    failedJobs=[];
    activeJobsRef=jobs;
    renderUploadPanel(jobs);
    const startedAt=Date.now();
    let cursor=0;
    const uploaded=[];

    async function worker(){
      while(cursor<jobs.length){
        const index=cursor++;
        const job=jobs[index];
        if(job.status==='cancelled')continue;
        const controller=new AbortController();
        activeUploadControllers.set(job.id,controller);
        try{
          job.status='uploading';
          updateJobRow(job,20,'Invio originale al backend…');
          const photo=await Photos.uploadTeamPhoto(job.teamId,job.file,{signal:controller.signal,altText:job.file.name});
          job.status='done';job.metaResult=photo;uploaded.push(photo);
          updateJobRow(job,100,`✓ Cloudinary + database (${formatSize(photo.size)})`,'ok');
          if(job.blobUrl){URL.revokeObjectURL(job.blobUrl);job.blobUrl='';}
        }catch(error){
          job.error=error;
          if(error?.code==='REQUEST_ABORTED'||controller.signal.aborted||job.status==='cancelled'){
            job.status='cancelled';updateJobRow(job,100,'Annullato','cancel');
          }else{
            job.status='failed';updateJobRow(job,100,'✗ '+Photos.userMessage(error),'fail');
          }
        }finally{activeUploadControllers.delete(job.id);}
      }
    }

    await Promise.all(Array.from({length:Math.min(UPLOAD_CONCURRENCY,jobs.length)},worker));
    if(uploaded.length){
      try{await Photos.refreshAll({force:true});}catch(error){safeConsoleWarn('refresh dopo upload',error);}
    }
    failedJobs=jobs.filter(job=>job.status==='failed');
    activeJobsRef=jobs;
    setUploadUiBusy(false);
    const ok=jobs.filter(job=>job.status==='done').length;
    const fail=failedJobs.length;
    const cancelled=jobs.filter(job=>job.status==='cancelled').length;
    const parts=[`${ok}/${jobs.length} caricate`];
    if(fail)parts.push(`${fail} fallite`);
    if(cancelled)parts.push(`${cancelled} annullate`);
    parts.push(`${((Date.now()-startedAt)/1000).toFixed(1)}s`);
    flashMsg(parts.join(' · '),fail||cancelled?'warn':'ok');
    finalizeUploadPanel(jobs);
    render();
  }

  function safeConsoleWarn(phase,error){
    console.warn('[Foto]',{phase,error:String(error?.message||error)});
  }

  async function retryFailedUploads(){
    if(uploadInProgress||!failedJobs.length)return;
    const retry=failedJobs.map(job=>({...job,status:'queued',error:null}));
    failedJobs=[];
    await runUploadJobs(retry);
  }

  function cancelAllUploads(){
    if(!uploadInProgress)return;
    activeJobsRef.forEach(job=>{
      if(job.status==='queued'){job.status='cancelled';updateJobRow(job,100,'Annullato','cancel');}
      activeUploadControllers.get(job.id)?.abort();
    });
    flashMsg('Annullamento degli upload in corso…','warn');
  }

  function cancelSingleUpload(jobId){
    const job=activeJobsRef.find(item=>item.id===jobId);
    if(!job||['done','failed','cancelled'].includes(job.status))return;
    job.status='cancelled';
    activeUploadControllers.get(jobId)?.abort();
    updateJobRow(job,100,'Annullato','cancel');
  }

  function renderUploadPanel(jobs){
    const progressEl=UI.$('#photosUploadProgress');
    if(!progressEl)return;
    const totalSize=jobs.reduce((sum,job)=>sum+job.file.size,0);
    progressEl.innerHTML=`
      <div class="upload-panel" aria-live="polite">
        <div class="upload-panel-head">
          <div class="upload-panel-info"><strong>${jobs.length}</strong> in upload · <span>${formatSize(totalSize)}</span> · originali Cloudinary · ${UPLOAD_CONCURRENCY} richieste parallele</div>
          <div class="upload-panel-actions">
            <button type="button" class="btn small primary" id="photosRetryFailedBtn" hidden>Riprova fallite</button>
            <button type="button" class="btn small danger" id="photosCancelAllBtn">Annulla tutto</button>
          </div>
        </div>
        <div class="upload-list">
          ${jobs.map(job=>`
            <div class="upload-item" data-job-id="${job.id}">
              <div class="upload-item-preview"><img src="${job.blobUrl}" alt="" loading="lazy"></div>
              <div class="upload-item-body">
                <div class="upload-item-head"><span class="upload-item-name">${UI.esc(job.file.name)}</span><span class="upload-item-size">${formatSize(job.file.size)}</span></div>
                <div class="upload-item-bar"><div class="upload-item-fill" style="width:0%"></div></div>
                <small class="upload-item-status">In coda…</small>
              </div>
              <button type="button" class="upload-item-cancel" data-cancel-job="${job.id}" aria-label="Annulla ${UI.esc(job.file.name)}" title="Annulla">×</button>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function updateJobRow(job,percent,status,kind){
    const row=document.querySelector(`[data-job-id="${job.id}"]`);
    if(!row)return;
    const fill=row.querySelector('.upload-item-fill');
    const statusEl=row.querySelector('.upload-item-status');
    if(fill){fill.style.width=percent+'%';['ok','fail','cancel'].forEach(name=>fill.classList.toggle(name,kind===name));}
    if(statusEl){statusEl.textContent=status;['ok','fail','cancel'].forEach(name=>statusEl.classList.toggle(name,kind===name));}
    if(['ok','fail','cancel'].includes(kind))row.querySelector('.upload-item-cancel')?.setAttribute('hidden','');
  }

  function finalizeUploadPanel(jobs){
    const cancel=UI.$('#photosCancelAllBtn');if(cancel)cancel.hidden=true;
    const retry=UI.$('#photosRetryFailedBtn');if(retry)retry.hidden=!failedJobs.length;
    if(!failedJobs.length){
      setTimeout(()=>{const panel=UI.$('#photosUploadProgress');if(panel&&!panel.querySelector('.upload-item-status.fail'))panel.innerHTML='';},6000);
    }
    jobs.filter(job=>job.status==='cancelled'&&job.blobUrl).forEach(job=>{URL.revokeObjectURL(job.blobUrl);job.blobUrl='';});
  }

  // -------------------- Delete single + bulk --------------------
  async function deletePhoto(path){
    try{
      await Photos.deleteTeamPhoto(selectedTeam, path);
      selectedPhotos.delete(path);
      try{ await Photos.refreshAll?.({force:true}); }catch(_){ }
      flashMsg('Foto eliminata.', 'ok');
      render();
    }catch(err){
      flashMsg(Photos.userMessage(err), 'error');
    }
  }

  async function deleteBulk(){
    const paths = [...selectedPhotos];
    if(!paths.length) return;
    const confirmed = await confirmDialog({
      icon: '🗑️',
      title: `Eliminare ${paths.length} foto?`,
      text: 'L\'operazione non è reversibile.',
      okLabel: `Elimina ${paths.length}`,
      cancelLabel: 'Annulla',
      danger: true
    });
    if(!confirmed) return;
    let ok = 0;
    const failedPaths=[];
    for(const path of paths){
      try{ await Photos.deleteTeamPhoto(selectedTeam, path); ok++; }
      catch(_){ failedPaths.push(path); }
    }
    try{ await Photos.refreshAll?.({force:true}); }catch(_){ }
    selectedPhotos=new Set(failedPaths);
    flashMsg(`Eliminate ${ok} foto${failedPaths.length?', '+failedPaths.length+' non eliminate e ancora selezionate':''}.`, failedPaths.length?'warn':'ok');
    render();
  }

  async function downloadBulk(){
    const paths=[...selectedPhotos];
    if(!paths.length)return;
    const team=A.state().teams.find(item=>item.id===selectedTeam);
    const photos=Photos.listTeamPhotos(A.state(),selectedTeam).filter(photo=>paths.includes(photo.path)||paths.includes(photo.publicId)||paths.includes(photo.id));
    const button=UI.$('#photosBulkDownload');
    if(!team||!photos.length)return;
    if(button)button.disabled=true;
    try{
      await Photos.downloadSelectedAsZip(photos,team.id,team.name);
      flashMsg(`ZIP creato con ${photos.length} originali.`,'ok');
    }catch(error){flashMsg(Photos.userMessage(error),'error');}
    finally{if(button)button.disabled=false;}
  }

  function photoByPath(path){
    return Photos.listTeamPhotos(A.state(),selectedTeam).find(photo=>[photo.path,photo.publicId,photo.id].includes(path));
  }

  function ensurePhotoEditor(){
    if(UI.$('#photoMetadataModal'))return;
    const modal=document.createElement('div');
    modal.id='photoMetadataModal';
    modal.className='modal photo-metadata-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`<div class="modal-content photo-metadata-content" role="dialog" aria-modal="true" aria-labelledby="photoMetadataTitle">
      <div class="article-modal-toolbar"><div><span class="article-kicker">Galleria Foto</span><h2 id="photoMetadataTitle">Modifica metadati</h2></div><button type="button" class="btn danger" data-close-photo-editor>Chiudi</button></div>
      <form id="photoMetadataForm" class="form-grid photo-metadata-form">
        <div class="field-full"><label for="photoMetaTitle">Titolo</label><input id="photoMetaTitle" name="title" maxlength="160"></div>
        <div class="field-full"><label for="photoMetaDescription">Descrizione</label><textarea id="photoMetaDescription" name="description" rows="4" maxlength="2000"></textarea></div>
        <div class="field-full"><label for="photoMetaCaption">Didascalia</label><textarea id="photoMetaCaption" name="caption" rows="3" maxlength="1000"></textarea></div>
        <div class="field-full"><label for="photoMetaAlt">Testo alternativo</label><input id="photoMetaAlt" name="altText" maxlength="300"></div>
        <div><label for="photoMetaAlbum">Album / categoria</label><input id="photoMetaAlbum" name="album" maxlength="120"></div>
        <div><label for="photoMetaOrder">Ordine</label><input id="photoMetaOrder" name="order" type="number" step="1"></div>
        <div class="field-full photo-metadata-actions"><button type="button" class="btn" data-close-photo-editor>Annulla</button><button type="submit" class="btn primary" id="photoMetadataSave">Salva metadati</button></div>
        <div class="field-full" id="photoMetadataMsg" aria-live="polite"></div>
      </form>
    </div>`;
    document.body.appendChild(modal);
  }

  function openPhotoEditor(path,trigger){
    const photo=photoByPath(path);if(!photo)return;
    ensurePhotoEditor();editingPhotoPath=path;editorTrigger=trigger||null;
    const modal=UI.$('#photoMetadataModal');
    modal.querySelector('#photoMetaTitle').value=photo.title||'';
    modal.querySelector('#photoMetaDescription').value=photo.description||'';
    modal.querySelector('#photoMetaCaption').value=photo.caption||'';
    modal.querySelector('#photoMetaAlt').value=photo.altText||photo.name||'';
    modal.querySelector('#photoMetaAlbum').value=photo.album||'';
    modal.querySelector('#photoMetaOrder').value=String(photo.order||0);
    modal.querySelector('#photoMetadataMsg').innerHTML='';
    modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('ng-overlay-open');
    requestAnimationFrame(()=>modal.querySelector('#photoMetaTitle')?.focus());
  }

  function closePhotoEditor(){
    const modal=UI.$('#photoMetadataModal');if(!modal)return;
    modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.classList.remove('ng-overlay-open');
    const trigger=editorTrigger;editingPhotoPath='';editorTrigger=null;requestAnimationFrame(()=>trigger?.focus?.());
  }

  async function savePhotoMetadata(form){
    const button=UI.$('#photoMetadataSave');if(button)button.disabled=true;
    const msg=UI.$('#photoMetadataMsg');
    try{
      const data=new FormData(form);
      await Photos.updatePhotoMetadata(editingPhotoPath,{
        title:data.get('title'),description:data.get('description'),caption:data.get('caption'),altText:data.get('altText'),album:data.get('album'),order:data.get('order')
      });
      try{await Photos.refreshAll({force:true});}catch(_){ }
      closePhotoEditor();flashMsg('Metadati aggiornati senza ricaricare l’originale.','ok');render();
    }catch(error){if(msg)msg.innerHTML=`<div class="message error">${UI.esc(Photos.userMessage(error))}</div>`;}
    finally{if(button)button.disabled=false;}
  }

  async function replacePhoto(path,trigger){
    const photo=photoByPath(path);if(!photo)return;
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;
      const confirmed=await confirmDialog({icon:'↻',title:'Sostituire la foto?',text:'La vecchia risorsa sarà eliminata solo dopo il salvataggio completo della nuova.',okLabel:'Sostituisci',cancelLabel:'Annulla'});
      if(!confirmed)return;
      if(trigger)trigger.disabled=true;
      try{
        await Photos.validateImageFile(file);
        const result=await Photos.replaceTeamPhoto(selectedTeam,photo,file,{title:photo.title,description:photo.description,caption:photo.caption,altText:photo.altText,album:photo.album,order:photo.order});
        try{await Photos.refreshAll({force:true});}catch(_){ }
        flashMsg(result.warning||'Foto sostituita; galleria e cache aggiornate.',result.warning?'warn':'ok');render();
      }catch(error){flashMsg(Photos.userMessage(error),'error');}
      finally{if(trigger)trigger.disabled=false;}
    },{once:true});
    input.click();
  }

  // -------------------- Lightbox --------------------
  let adminPhotoViewer=null;
  function ensureLightbox(){
    let lb=UI.$('#photosLightbox');
    if(!lb){
      lb=document.createElement('div');
      lb.id='photosLightbox';
      lb.className='photos-lightbox';
      lb.setAttribute('aria-hidden','true');
      lb.setAttribute('role','dialog');
      lb.setAttribute('aria-modal','true');
      lb.setAttribute('aria-label','Visualizzatore fotografie amministrazione');
      lb.innerHTML=`
        <button type="button" class="lightbox-close" aria-label="Chiudi visualizzatore">×</button>
        <button type="button" class="lightbox-nav lightbox-prev" aria-label="Foto precedente">‹</button>
        <button type="button" class="lightbox-nav lightbox-next" aria-label="Foto successiva">›</button>
        <div class="lightbox-stage"><img class="lightbox-img" alt="" draggable="false"></div>
        <div class="lightbox-bar">
          <div class="lightbox-meta"><span class="lightbox-name"></span><small class="lightbox-counter"></small></div>
          <a class="lightbox-download btn small" download href="#">⬇ Originale</a>
        </div>`;
      document.body.appendChild(lb);
    }
    if(!adminPhotoViewer){
      adminPhotoViewer=window.NGImageViewer?.bind(lb,{
        onClose:()=>{lightboxIndex=-1;lastLightboxTrigger=null;},
        onPrevious:()=>navLightbox(-1),
        onNext:()=>navLightbox(1)
      });
    }
    return lb;
  }
  function openLightbox(idx,trigger=null){
    ensureLightbox();
    lightboxIndex=idx;
    lastLightboxTrigger=trigger||document.activeElement;
    updateLightboxContent();
    adminPhotoViewer?.open(lastLightboxTrigger);
  }
  function closeLightbox(){
    if(adminPhotoViewer)adminPhotoViewer.close();
    else {const lb=UI.$('#photosLightbox');if(lb){lb.classList.remove('open');lb.setAttribute('aria-hidden','true');}}
    lightboxIndex=-1;
  }
  function navLightbox(delta){
    const photos=Photos.listTeamPhotos(A.state(),selectedTeam);
    if(!photos.length)return;
    lightboxIndex=(lightboxIndex+delta+photos.length)%photos.length;
    updateLightboxContent();
  }
  function updateLightboxContent(){
    const photos=Photos.listTeamPhotos(A.state(),selectedTeam);
    const p=photos[lightboxIndex];
    if(!p)return closeLightbox();
    ensureLightbox();
    const dimensions=p.width&&p.height?`${p.width}×${p.height} · `:'';
    const sizeInfo=p.originalSize?formatSize(p.originalSize)+' originale':formatSize(p.size);
    adminPhotoViewer?.setContent({
      preview:p.thumbUrl||p.url,
      large:p.largeUrl||p.originalUrl||p.url,
      alt:p.altText||p.title||p.name,
      name:p.title||p.name,
      counter:`${lightboxIndex+1} / ${photos.length} · ${dimensions}${sizeInfo}`,
      downloadUrl:Photos.originalDownloadUrl(p),
      downloadName:p.originalName||p.name
    });
  }

  // -------------------- Event handlers --------------------
  document.addEventListener('click', e => {
    const teamBtn = e.target.closest('[data-team-pick]');
    if(teamBtn){
      if(uploadInProgress){flashMsg('Completa o annulla il caricamento prima di cambiare squadra.','warn');return;}
      if(selectedTeam!==teamBtn.dataset.teamPick&&stagedFiles.length){clearStaging();flashMsg('La selezione locale è stata svuotata per evitare upload nella squadra sbagliata.','warn');}
      selectedTeam=teamBtn.dataset.teamPick;
      selectedPhotos.clear();
      render();
      return;
    }
    const retryBtn = e.target.closest('[data-photo-retry]');
    if(retryBtn){
      e.stopPropagation();
      const thumb = retryBtn.closest('.photo-thumb');
      const img = thumb?.querySelector('img[data-src]');
      if(img && thumb){
        attachSmartImageRetry(img, {force:true});
      }
      return;
    }
    const openBtn = e.target.closest('[data-photo-open]');
    if(openBtn){
      const idx = Number(openBtn.dataset.photoOpen);
      if(!Number.isNaN(idx)) openLightbox(idx,openBtn);
      return;
    }
    const editBtn=e.target.closest('[data-photo-edit]');
    if(editBtn){e.preventDefault();e.stopPropagation();openPhotoEditor(editBtn.dataset.photoEdit,editBtn);return;}
    const replaceBtn=e.target.closest('[data-photo-replace]');
    if(replaceBtn){e.preventDefault();e.stopPropagation();replacePhoto(replaceBtn.dataset.photoReplace,replaceBtn);return;}
    if(e.target.closest('[data-close-photo-editor]')){e.preventDefault();closePhotoEditor();return;}
    const selectBtn = e.target.closest('[data-photo-select]');
    if(selectBtn){
      e.stopPropagation();
      const path = selectBtn.dataset.photoSelect;
      if(selectedPhotos.has(path)) selectedPhotos.delete(path);
      else selectedPhotos.add(path);
      render();
      return;
    }
    const delBtn = e.target.closest('[data-delete-photo]');
    if(delBtn){
      e.stopPropagation();
      const path = delBtn.dataset.deletePhoto;
      confirmDialog({
        icon: '🗑️',
        title: 'Eliminare questa foto?',
        text: 'L\'operazione non è reversibile.',
        okLabel: 'Elimina',
        cancelLabel: 'Annulla',
        danger: true
      }).then(ok => { if(ok) deletePhoto(path); });
      return;
    }
    if(e.target.id === 'photosBulkDeselect'){ selectedPhotos.clear(); render(); return; }
    if(e.target.id === 'photosBulkDownload'){ downloadBulk(); return; }
    if(e.target.id === 'photosBulkDelete'){ deleteBulk(); return; }
    if(e.target.id === 'photosRetryFailedBtn'){ retryFailedUploads().catch(error=>flashMsg(Photos.userMessage(error),'error')); return; }
    if(e.target.id === 'photosCancelAllBtn'){ cancelAllUploads(); return; }
    if(e.target.id === 'photosStagingConfirmBtn'){ confirmAndUpload(); return; }
    if(e.target.id === 'photosStagingClearBtn'){ clearStaging(); return; }
    if(e.target.id === 'photosStagingAddBtn'){ UI.$('#photosFileInput')?.click(); return; }
    const removeStagedBtn = e.target.closest('[data-remove-staged]');
    if(removeStagedBtn){ removeStagedFile(removeStagedBtn.dataset.removeStaged); return; }
    const cancelBtn = e.target.closest('[data-cancel-job]');
    if(cancelBtn){ cancelSingleUpload(cancelBtn.dataset.cancelJob); return; }
    if(e.target.id === 'photosDropTrigger'){
      UI.$('#photosFileInput')?.click();
      return;
    }
  });

  document.addEventListener('click',e=>{if(e.target?.id==='photoMetadataModal')closePhotoEditor();});
  document.addEventListener('keydown',e=>{
    const modal=UI.$('#photoMetadataModal');
    if(!modal?.classList.contains('open'))return;
    if(e.key==='Escape'){e.preventDefault();closePhotoEditor();return;}
    if(e.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });

  document.addEventListener('submit', e => {
    if(e.target.id==='photoMetadataForm'){e.preventDefault();savePhotoMetadata(e.target);return;}
    if(e.target.id !== 'photosUploadForm') return;
    e.preventDefault();
    const fileInput = UI.$('#photosFileInput');
    const files = Array.from(fileInput?.files||[]);
    if(!files.length){ flashMsg('Seleziona almeno una foto.', 'warn'); return; }
    uploadFiles(files);
  });

  document.addEventListener('change', e => {
    if(e.target?.id === 'photosFileInput'){
      const files = Array.from(e.target.files || []);
      if(files.length && selectedTeam) uploadFiles(files).catch(error=>flashMsg(Photos.userMessage(error),'error'));
    }
  });

  function flashMsg(text, type='ok'){
    const el = UI.$('#photosMsg');
    if(el){
      el.innerHTML = `<div class="message ${type}">${UI.esc(text)}</div>`;
      // Auto-clear dopo 4s
      setTimeout(()=>{ if(el.innerHTML.includes(text)) el.innerHTML = ''; }, 4000);
    }
  }

  // -------------------- Realtime listener --------------------
  window.addEventListener('pagehide',()=>{
    stagedFiles.forEach(item=>item.blobUrl&&URL.revokeObjectURL(item.blobUrl));
    activeJobsRef.forEach(job=>job.blobUrl&&URL.revokeObjectURL(job.blobUrl));
    activeUploadControllers.forEach(controller=>controller.abort());
  });

  window.addEventListener('ng:admin-state-loaded', () => render());
  window.addEventListener('ng:cloudinary-photos-updated', () => render());

  // -------------------- Boot --------------------
  function boot(){
    A.initGlobalActions?.();
    setupDragDrop();
    Photos.refreshAll?.({force:true}).catch(err=>flashMsg(Photos.userMessage(err),'warn'));
    render();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
````

## `/mnt/data/ng-work/new-generation-main/assets/js/photo-runtime.js`

````javascript
// =============================================================
// New Generation — PhotoRuntime v105
// Gestione immagini foto riscritta da zero.
// Obiettivi:
//   1) mai mostrare "Foto non disponibile" se l'originale è caricabile;
//   2) DOM stabile durante refresh realtime;
//   3) caricamento veloce e controllato su mobile/desktop;
//   4) download sempre dall'originale.
// =============================================================
(function(){
  'use strict';

  const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const MAX_ACTIVE_DESKTOP = 4;
  const MAX_ACTIVE_MOBILE = 2;
  const NEAR_VIEWPORT_MARGIN = '900px 0px';
  const FIRST_EAGER_COUNT = 6;
  const PREVIEW_TIMEOUT_MS = 15000;
  const ORIGINAL_TIMEOUT_MS = 45000;

  const queue = [];
  const states = new WeakMap();
  let active = 0;
  let io = null;

  function isMobileLike(){
    try{ return window.matchMedia('(max-width: 760px), (pointer: coarse)').matches; }
    catch(_){ return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
  }

  function maxActive(){ return isMobileLike() ? MAX_ACTIVE_MOBILE : MAX_ACTIVE_DESKTOP; }

  function escUrl(url){ return String(url || '').trim(); }

  function normalizeUrl(url){
    url = escUrl(url);
    if(!url) return '';
    // Supabase public URLs sono versionate dal path unico dell'upload. Non aggiungo
    // cache-buster casuali: evitano cache utile e possono creare corse su mobile.
    return url;
  }

  function stableCacheBustedUrl(url, version){
    url = escUrl(url);
    if(!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'ng_photo_v=' + encodeURIComponent(version || Date.now());
  }

  function candidatesFor(img){
    const preview = normalizeUrl(img.dataset.previewSrc || img.dataset.src || img.dataset.photoPreview || '');
    const original = normalizeUrl(img.dataset.originalSrc || img.dataset.fallbackSrc || img.dataset.photoOriginal || '');
    const version = img.dataset.photoVersion || img.closest('.photo-thumb')?.dataset.photoVersion || '';
    const out = [];

    // Griglia: preview prima per velocità, originale come fonte definitiva.
    // Se la preview manca o fallisce, l'originale viene caricato nello stesso <img>.
    if(preview) out.push({url: preview, kind: 'preview', timeout: PREVIEW_TIMEOUT_MS});
    if(original && original !== preview) out.push({url: original, kind: 'original', timeout: ORIGINAL_TIMEOUT_MS});

    // Ultimo tentativo stabile: stessa risorsa originale con query versionata,
    // utile se il browser/mobile conserva una risposta fallita/stale.
    if(original){
      const busted = stableCacheBustedUrl(original, version || img.dataset.photoPath || img.dataset.photoId || 'original');
      if(!out.some(c => c.url === busted)) out.push({url: busted, kind: 'original-cache-refresh', timeout: ORIGINAL_TIMEOUT_MS});
    }

    return out;
  }

  function signatureFor(img){
    return candidatesFor(img).map(c => c.url).join('|');
  }

  function cardFor(img){ return img.closest('.photo-thumb'); }

  function mark(card, status){
    if(!card) return;
    card.classList.remove('is-loading','is-loaded','is-broken');
    if(status === 'loading') card.classList.add('is-loading');
    if(status === 'loaded') card.classList.add('is-loaded');
    if(status === 'broken') card.classList.add('is-broken');
  }

  function clearImgHandlers(img){
    img.onload = null;
    img.onerror = null;
  }

  function finalizeLoaded(img, state){
    if(states.get(img) !== state) return;
    clearTimeout(state.timer);
    clearImgHandlers(img);
    mark(cardFor(img), 'loaded');
    img.dataset.photoLoaded = '1';
    img.dataset.photoLoadedSrc = img.currentSrc || img.src || '';
    img.classList.remove('is-loading');
    img.removeAttribute('aria-busy');
    active = Math.max(0, active - 1);
    pump();
  }

  function tryNext(img, state){
    if(states.get(img) !== state) return;
    clearTimeout(state.timer);
    clearImgHandlers(img);

    const candidate = state.candidates[state.index++];
    if(!candidate){
      mark(cardFor(img), 'broken');
      img.dataset.photoLoaded = '0';
      img.removeAttribute('aria-busy');
      active = Math.max(0, active - 1);
      pump();
      return;
    }

    img.dataset.photoActiveKind = candidate.kind;
    img.onload = function(){
      if(states.get(img) !== state) return;
      if(img.naturalWidth > 0 || img.naturalHeight > 0) finalizeLoaded(img, state);
      else tryNext(img, state);
    };
    img.onerror = function(){ tryNext(img, state); };
    state.timer = setTimeout(() => tryNext(img, state), candidate.timeout);

    // Impostare src solo dopo handler evita l'evento perso da cache/refresh.
    if(img.src !== candidate.url) img.src = candidate.url;
    else {
      // Se è già la stessa src e il browser l'ha completata in cache, rivaluto.
      requestAnimationFrame(() => {
        if(states.get(img) !== state) return;
        if(img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0)) finalizeLoaded(img, state);
      });
    }
  }

  function start(img){
    const current = states.get(img);
    if(!current || current.started) return;
    current.started = true;
    active++;
    mark(cardFor(img), 'loading');
    img.classList.add('is-loading');
    img.setAttribute('aria-busy','true');
    img.decoding = 'async';
    img.loading = current.priority ? 'eager' : 'lazy';
    if(current.priority && 'fetchPriority' in img) img.fetchPriority = 'high';
    tryNext(img, current);
  }

  function enqueue(img, priority){
    const st = states.get(img);
    if(!st || st.queued || st.started) return;
    st.queued = true;
    if(priority) queue.unshift(img);
    else queue.push(img);
    pump();
  }

  function pump(){
    while(active < maxActive() && queue.length){
      const img = queue.shift();
      const st = states.get(img);
      if(!st || st.started) continue;
      st.queued = false;
      start(img);
    }
  }

  function observeOrQueue(img, priority){
    if(priority){ enqueue(img, true); return; }
    if(!('IntersectionObserver' in window)){
      enqueue(img, false);
      return;
    }
    if(!io){
      io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if(!entry.isIntersecting) return;
          io.unobserve(entry.target);
          enqueue(entry.target, false);
        });
      }, { root: null, rootMargin: NEAR_VIEWPORT_MARGIN, threshold: 0.01 });
    }
    io.observe(img);
  }

  function load(img, opts={}){
    if(!img) return;
    const card = cardFor(img);
    const force = !!opts.force;
    const priorityIndex = Number.isFinite(opts.priorityIndex) ? opts.priorityIndex : Number(img.dataset.photoPriorityIndex || img.dataset.photoOpen || img.dataset.photoIndex || 9999);
    const priority = !!opts.priority || priorityIndex < FIRST_EAGER_COUNT;
    const sig = signatureFor(img);

    const old = states.get(img);
    if(old && old.signature === sig && !force){
      if(card && card.classList.contains('is-broken')) return load(img, {force:true, priority:true});
      return;
    }

    if(old){
      clearTimeout(old.timer);
      clearImgHandlers(img);
      old.cancelled = true;
      if(old.started) active = Math.max(0, active - 1);
      try{ if(io) io.unobserve(img); }catch(_){}
    }

    const candidates = candidatesFor(img);
    img.dataset.photoSignature = sig;
    img.dataset.photoLoaded = '0';
    if(!img.src || img.src === window.location.href) img.src = TRANSPARENT_PIXEL;
    mark(card, 'loading');

    const state = {
      signature: sig,
      candidates,
      index: 0,
      timer: null,
      started: false,
      queued: false,
      priority
    };
    states.set(img, state);

    if(!candidates.length){
      mark(card, 'broken');
      return;
    }

    observeOrQueue(img, priority);
  }

  function refreshGrid(root){
    const scope = root || document;
    scope.querySelectorAll('img[data-photo-managed="1"], img[data-src][data-fallback-src]').forEach((img, idx) => {
      load(img, { priorityIndex: idx });
    });
  }

  function retryFromButton(button){
    const card = button?.closest?.('.photo-thumb');
    const img = card?.querySelector?.('img[data-photo-managed="1"], img[data-src][data-fallback-src]');
    if(img) load(img, {force:true, priority:true});
  }

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshGrid(document);
  });
  window.addEventListener('online', () => refreshGrid(document));

  window.NGPhotoEngine = { load, refreshGrid, retryFromButton, version: 'v126.16' };

  // Visualizzatore condiviso da galleria pubblica, galleria admin e dettaglio articolo.
  // Gestisce focus, Escape, zoom, pan, wheel e pinch senza modificare gli URL sorgente.
  function bindImageViewer(root,{onClose,onPrevious,onNext}={}){
    if(!root) return null;
    if(root._ngViewerApi) return root._ngViewerApi;
    const image=root.querySelector('.lightbox-img');
    const stage=root.querySelector('.lightbox-stage');
    const closeButton=root.querySelector('.lightbox-close');
    const pointers=new Map();
    let scale=1,x=0,y=0,dragStart=null,pinchStart=null,loadToken=0,lastTrigger=null;

    function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
    function apply(){
      if(!image)return;
      if(scale<=1){x=0;y=0;}
      image.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
      image.classList.toggle('is-zoomed',scale>1.01);
      image.setAttribute('data-zoom',scale.toFixed(2));
      const label=root.querySelector('[data-viewer-zoom-label]');
      if(label)label.textContent=Math.round(scale*100)+'%';
    }
    function setScale(next,originX=0,originY=0){
      const previous=scale;
      scale=clamp(next,1,4);
      if(previous!==scale&&previous>0&&scale>1){
        const ratio=scale/previous;
        x=originX-(originX-x)*ratio;
        y=originY-(originY-y)*ratio;
      }
      apply();
    }
    function reset(){scale=1;x=0;y=0;dragStart=null;pinchStart=null;pointers.clear();apply();}
    function ensureControls(){
      const bar=root.querySelector('.lightbox-bar');
      if(!bar||bar.querySelector('.lightbox-zoom-controls'))return;
      const controls=document.createElement('div');
      controls.className='lightbox-zoom-controls';
      controls.setAttribute('aria-label','Controlli zoom');
      controls.innerHTML='<button type="button" class="btn small" data-viewer-zoom-out aria-label="Riduci zoom">−</button><span data-viewer-zoom-label aria-live="polite">100%</span><button type="button" class="btn small" data-viewer-zoom-in aria-label="Aumenta zoom">+</button><button type="button" class="btn small" data-viewer-reset aria-label="Ripristina zoom">100%</button>';
      bar.insertBefore(controls,bar.querySelector('.lightbox-download')||null);
    }
    ensureControls();

    function open(trigger){
      lastTrigger=trigger||document.activeElement;
      reset();
      root.classList.add('open');
      root.setAttribute('aria-hidden','false');
      document.body.classList.add('ng-overlay-open');
      requestAnimationFrame(()=>closeButton?.focus?.());
    }
    function close(){
      if(!root.classList.contains('open'))return;
      root.classList.remove('open');
      root.setAttribute('aria-hidden','true');
      document.body.classList.remove('ng-overlay-open');
      reset();
      loadToken++;
      const trigger=lastTrigger;lastTrigger=null;
      requestAnimationFrame(()=>trigger&&document.contains(trigger)&&trigger.focus?.({preventScroll:true}));
      onClose?.();
    }
    function setContent({preview='',large='',alt='',name='',counter='',downloadUrl='',downloadName=''}={}){
      const token=++loadToken;
      reset();
      if(image){
        image.alt=alt||name||'Fotografia';
        image.src=preview||large||'';
        if(large&&large!==preview){
          const preloader=new Image();
          preloader.onload=()=>{if(token===loadToken&&root.classList.contains('open'))image.src=large;};
          preloader.src=large;
        }
      }
      const nameEl=root.querySelector('.lightbox-name');if(nameEl)nameEl.textContent=name||'';
      const counterEl=root.querySelector('.lightbox-counter');if(counterEl)counterEl.textContent=counter||'';
      const download=root.querySelector('.lightbox-download');
      if(download){download.href=downloadUrl||large||preview||'#';download.setAttribute('download',downloadName||name||'foto');}
    }

    root.addEventListener('click',event=>{
      if(event.target.closest('[data-viewer-zoom-in]')){setScale(scale+.5);return;}
      if(event.target.closest('[data-viewer-zoom-out]')){setScale(scale-.5);return;}
      if(event.target.closest('[data-viewer-reset]')){reset();return;}
      if(event.target.closest('.lightbox-close')){close();return;}
      if(event.target.closest('.lightbox-prev')){reset();onPrevious?.();return;}
      if(event.target.closest('.lightbox-next')){reset();onNext?.();return;}
      if(event.target===root||(event.target===stage&&scale<=1.01))close();
    });
    image?.addEventListener('dblclick',event=>{event.preventDefault();setScale(scale>1?1:2,event.offsetX,event.offsetY);});
    stage?.addEventListener('wheel',event=>{
      if(!root.classList.contains('open'))return;
      event.preventDefault();
      const rect=stage.getBoundingClientRect();
      setScale(scale+(event.deltaY<0?.35:-.35),event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2);
    },{passive:false});
    image?.addEventListener('pointerdown',event=>{
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      image.setPointerCapture?.(event.pointerId);
      if(pointers.size===1&&scale>1)dragStart={px:event.clientX,py:event.clientY,x,y};
      if(pointers.size===2){const values=[...pointers.values()];pinchStart={distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y),scale};}
    });
    image?.addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2&&pinchStart){const values=[...pointers.values()];const distance=Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y);setScale(pinchStart.scale*(distance/Math.max(1,pinchStart.distance)));return;}
      if(dragStart&&scale>1){x=dragStart.x+(event.clientX-dragStart.px);y=dragStart.y+(event.clientY-dragStart.py);apply();}
    });
    function pointerEnd(event){pointers.delete(event.pointerId);dragStart=null;if(pointers.size<2)pinchStart=null;}
    image?.addEventListener('pointerup',pointerEnd);image?.addEventListener('pointercancel',pointerEnd);
    document.addEventListener('keydown',event=>{
      if(!root.classList.contains('open'))return;
      if(event.key==='Tab'){
        const focusable=[...root.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
        if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      }else if(event.key==='Escape'){event.preventDefault();close();}
      else if(event.key==='ArrowLeft'){event.preventDefault();reset();onPrevious?.();}
      else if(event.key==='ArrowRight'){event.preventDefault();reset();onNext?.();}
      else if(event.key==='+'||event.key==='='){event.preventDefault();setScale(scale+.5);}
      else if(event.key==='-'){event.preventDefault();setScale(scale-.5);}
      else if(event.key==='0'){event.preventDefault();reset();}
    });
    const api={open,close,reset,setContent,get scale(){return scale;}};
    root._ngViewerApi=api;
    return api;
  }

  window.NGImageViewer={bind:bindImageViewer,version:'v126.16'};
})();
````

## `/mnt/data/ng-work/new-generation-main/assets/js/photos.js`

````javascript
// =============================================================
// New Generation — Foto squadre via Cloudinary + Supabase Edge Function
// v126.16-photo-network
// =============================================================
// Flusso esclusivo galleria Foto. Non usa endpoint, modelli o cartelle Articoli.
// - GET pubblico senza header non semplici: niente preflight inutile.
// - Upload/modifica/eliminazione con access token della sessione admin.
// - Timeout, abort, errori strutturati e messaggi distinti.
// - Originali e ZIP scaricati dalla Edge Function, non via fetch CORS Cloudinary.
// =============================================================
(function(){
  'use strict';

  const DEFAULT_SECTION = 'foto-squadra';
  const DEFAULT_FOLDER = 'squadra';
  const DEFAULT_FUNCTION = 'team-photos';
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_BATCH_FILES = 20;
  const MAX_BATCH_SIZE = 80 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 120 * 1000 * 1000;
  const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp']);
  const ALLOWED_EXTENSIONS = new Set(['jpg','jpeg','png','webp']);
  const REQUEST_TIMEOUT_MS = 45000;
  const UPLOAD_TIMEOUT_MS = 75000;
  const ZIP_TIMEOUT_MS = 120000;

  const cfg = Object.assign({
    CLOUD_NAME: 'dc17izhac',
    FOLDER: DEFAULT_FOLDER,
    SECTION: DEFAULT_SECTION,
    EDGE_FUNCTION: DEFAULT_FUNCTION,
    FUNCTION_URL: ''
  }, window.NEW_GENERATION_CLOUDINARY || {});

  const supabaseCfg = window.NEW_GENERATION_SUPABASE || {};
  const cache = {
    loaded: false,
    loading: null,
    loadedAt: 0,
    photos: [],
    byTeam: Object.create(null),
    error: null
  };

  class PhotoError extends Error{
    constructor(message,{code='PHOTO_ERROR',kind='unknown',status=0,phase='',details=null,cause=null}={}){
      super(message);
      this.name='PhotoError';
      this.code=code;
      this.kind=kind;
      this.status=Number(status)||0;
      this.phase=phase;
      this.details=details;
      if(cause)this.cause=cause;
    }
  }

  function now(){ return Date.now(); }
  function isConfigured(){ return Boolean((cfg.FUNCTION_URL || supabaseCfg.URL) && cfg.EDGE_FUNCTION); }
  function functionUrl(action=''){
    const base = cfg.FUNCTION_URL
      ? String(cfg.FUNCTION_URL).replace(/\/$/,'')
      : String(supabaseCfg.URL || '').replace(/\/$/,'') + '/functions/v1/' + encodeURIComponent(cfg.EDGE_FUNCTION || DEFAULT_FUNCTION);
    if(!action) return base;
    return base + (base.includes('?')?'&':'?') + 'action=' + encodeURIComponent(action);
  }
  function assertTransportConfig(){
    if(!isConfigured()) throw new PhotoError('Servizio Foto non configurato.',{code:'CONFIG_MISSING',kind:'config',phase:'config'});
    const url=functionUrl();
    if(window.location?.protocol==='https:' && /^http:\/\//i.test(url)){
      throw new PhotoError('Configurazione non valida: una pagina HTTPS non può chiamare un endpoint HTTP.',{code:'MIXED_CONTENT',kind:'config',phase:'config'});
    }
    try{ new URL(url); }catch(error){
      throw new PhotoError('URL della Edge Function Foto non valido.',{code:'INVALID_URL',kind:'config',phase:'config',cause:error});
    }
  }
  function dispatch(){
    window.dispatchEvent(new CustomEvent('ng:cloudinary-photos-updated',{
      detail:{loaded:cache.loaded,error:cache.error,loadedAt:cache.loadedAt}
    }));
  }
  function normalizePhoto(photo){
    const out=Object.assign({},photo||{});
    out.id=out.publicId||out.path||out.id||'';
    out.dbId=out.dbId||out.db_id||'';
    out.publicId=out.publicId||out.public_id||out.path||out.id||'';
    out.path=out.path||out.publicId||out.id;
    out.teamId=out.teamId||out.team_id||'';
    out.name=out.name||out.originalName||out.original_name||out.filename||String(out.path||'foto').split('/').pop();
    out.originalName=out.originalName||out.original_name||out.name;
    out.title=out.title||'';
    out.description=out.description||'';
    out.caption=out.caption||'';
    out.altText=out.altText||out.alt_text||'';
    out.album=out.album||'';
    out.order=Number(out.order??out.display_order??0)||0;
    out.version=Number(out.version||0)||0;
    out.format=out.format||'';
    out.mimeType=out.mimeType||out.mime_type||'';
    out.width=Number(out.width||0)||0;
    out.height=Number(out.height||0)||0;
    out.size=Number(out.size||out.bytes||0);
    out.originalSize=Number(out.originalSize||out.bytes||out.size||0);
    out.ts=Number(out.ts||out.createdAtMs||Date.parse(out.createdAt||out.created_at||'')||0)||now();
    out.createdAt=out.createdAt||out.created_at||'';
    out.updatedAt=out.updatedAt||out.updated_at||out.createdAt;
    out.thumbUrl=out.thumbUrl||out.thumb_url||out.previewUrl||out.preview_url||out.url||'';
    out.mediumUrl=out.mediumUrl||out.medium_url||out.thumbUrl||'';
    out.largeUrl=out.largeUrl||out.large_url||out.mediumUrl||out.originalUrl||'';
    out.originalUrl=out.originalUrl||out.original_url||out.largeUrl||out.url||'';
    out.downloadUrl=out.downloadUrl||out.download_url||out.originalUrl;
    out.url=out.thumbUrl||out.mediumUrl||out.largeUrl||out.originalUrl||out.url||'';
    out.previewUrl=out.previewUrl||out.thumbUrl||out.url;
    out.hasOriginal=Boolean(out.originalUrl);
    out.hasThumb=Boolean(out.thumbUrl);
    return out;
  }
  function setCache(list){
    const photos=Array.isArray(list)?list.map(normalizePhoto).filter(photo=>photo.path&&(photo.thumbUrl||photo.originalUrl||photo.url)):[];
    photos.sort((a,b)=>(a.order||0)-(b.order||0)||(b.ts||0)-(a.ts||0));
    const byTeam=Object.create(null);
    photos.forEach(photo=>{
      const teamId=String(photo.teamId||'').trim();
      if(!teamId)return;
      if(!byTeam[teamId])byTeam[teamId]=[];
      byTeam[teamId].push(photo);
    });
    cache.loaded=true;
    cache.error=null;
    cache.loadedAt=now();
    cache.photos=photos;
    cache.byTeam=byTeam;
  }
  function legacyListFromState(state,teamId){
    const map=state?.teamPhotos||{};
    const rows=Array.isArray(map[teamId])?map[teamId]:[];
    return rows.map(normalizePhoto);
  }
  function invalidateCache(){
    cache.loaded=false;
    cache.loadedAt=0;
  }
  function safeLog(level,event,data={}){
    const payload={scope:'team-photos',event,...data};
    delete payload.token;
    delete payload.authorization;
    const fn=console[level]||console.info;
    fn.call(console,'[Foto]',payload);
  }
  function combineSignals(external,timeoutMs){
    const controller=new AbortController();
    let timedOut=false;
    const abort=()=>controller.abort(external?.reason);
    if(external){
      if(external.aborted)abort();
      else external.addEventListener('abort',abort,{once:true});
    }
    const timer=setTimeout(()=>{timedOut=true;controller.abort(new DOMException('Timeout','TimeoutError'));},timeoutMs);
    return {signal:controller.signal,timedOut:()=>timedOut,cleanup:()=>{clearTimeout(timer);external?.removeEventListener?.('abort',abort);}};
  }
  async function sessionToken(){
    const client=window.NG_SUPABASE_CLIENT;
    if(!client?.auth?.getSession){
      throw new PhotoError('Servizio di autenticazione non disponibile. Ricarica la pagina.',{code:'AUTH_SERVICE_MISSING',kind:'auth',phase:'auth'});
    }
    const {data,error}=await client.auth.getSession();
    if(error)throw new PhotoError(error.message||'Impossibile leggere la sessione.',{code:'AUTH_SESSION_ERROR',kind:'auth',phase:'auth',cause:error});
    const token=data?.session?.access_token||'';
    if(!token)throw new PhotoError('Sessione amministratore scaduta. Accedi di nuovo.',{code:'AUTH_REQUIRED',kind:'auth',status:401,phase:'auth'});
    return token;
  }
  function errorKind(status,code){
    if(status===401||status===403||/^AUTH_|ORIGIN_/.test(code))return 'auth';
    if(status===408||status===504||/TIMEOUT/.test(code))return 'timeout';
    if(status===413||/TOO_LARGE/.test(code))return 'size';
    if(status===415||/UNSUPPORTED|CORRUPT|EMPTY_FILE/.test(code))return 'validation';
    if(/CLOUDINARY/.test(code))return 'cloudinary';
    if(/^DB_/.test(code))return 'database';
    if(status>=500)return 'server';
    return 'http';
  }
  async function parseResponse(response){
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    const text=await response.text();
    if(!text)return null;
    if(type.includes('application/json')){
      try{return JSON.parse(text);}catch(_){return {message:'Risposta JSON non valida dal backend.'};}
    }
    if(type.includes('text/html'))return {message:'Il proxy ha restituito HTML invece di JSON.',rawType:'html'};
    try{return JSON.parse(text);}catch(_){return {message:text.slice(0,500),rawType:type||'text'};}
  }
  async function apiRequest({method='GET',action='',params=null,body=null,admin=false,signal=null,timeout=REQUEST_TIMEOUT_MS,phase='request',expect='json'}={}){
    assertTransportConfig();
    const url=new URL(functionUrl(action));
    Object.entries(params||{}).forEach(([key,value])=>{if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));});
    const headers={};
    if(admin)headers.Authorization='Bearer '+await sessionToken();
    if(body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body!=='string'){
      headers['Content-Type']='application/json';
      body=JSON.stringify(body);
    }
    const controlled=combineSignals(signal,timeout);
    const started=performance.now();
    try{
      const response=await fetch(url.toString(),{method,headers,body,signal:controlled.signal,cache:'no-store',redirect:'error'});
      if(expect==='blob'){
        if(!response.ok){
          const data=await parseResponse(response);
          const code=String(data?.code||`HTTP_${response.status}`);
          throw new PhotoError(data?.message||data?.error||`Errore HTTP ${response.status}.`,{code,kind:errorKind(response.status,code),status:response.status,phase,details:data});
        }
        safeLog('info','request-ok',{method,phase,status:response.status,durationMs:Math.round(performance.now()-started)});
        return {response,blob:await response.blob()};
      }
      const data=await parseResponse(response);
      if(!response.ok){
        const code=String(data?.code||`HTTP_${response.status}`);
        throw new PhotoError(data?.message||data?.error||`Errore HTTP ${response.status}.`,{code,kind:errorKind(response.status,code),status:response.status,phase,details:data});
      }
      safeLog('info','request-ok',{method,phase,status:response.status,durationMs:Math.round(performance.now()-started)});
      return data||{};
    }catch(error){
      if(error instanceof PhotoError)throw error;
      const aborted=controlled.signal.aborted;
      if(aborted && controlled.timedOut()){
        throw new PhotoError('Il server Foto non ha risposto entro il tempo previsto.',{code:'REQUEST_TIMEOUT',kind:'timeout',status:504,phase,cause:error});
      }
      if(aborted){
        throw new PhotoError('Caricamento interrotto.',{code:'REQUEST_ABORTED',kind:'aborted',phase,cause:error});
      }
      const mixed=window.location?.protocol==='https:'&&/^http:\/\//i.test(url.toString());
      throw new PhotoError(mixed?'Richiesta bloccata per mixed content.':'Server Foto non raggiungibile o richiesta bloccata da CORS/preflight.',{
        code:mixed?'MIXED_CONTENT':'NETWORK_ERROR',kind:mixed?'config':'network',phase,cause:error
      });
    }finally{
      controlled.cleanup();
    }
  }
  function userMessage(error){
    const err=error instanceof PhotoError?error:new PhotoError(error?.message||String(error));
    const byCode={
      AUTH_REQUIRED:'Sessione scaduta: effettua nuovamente l’accesso amministratore.',
      AUTH_SERVICE_MISSING:'Autenticazione non disponibile: ricarica la pagina.',
      ORIGIN_NOT_ALLOWED:'Il dominio del sito non è autorizzato dalla configurazione CORS Foto.',
      NETWORK_ERROR:'Server Foto non raggiungibile. Controlla connessione, CORS e disponibilità della Edge Function.',
      MIXED_CONTENT:'Configurazione bloccata: la pagina HTTPS sta chiamando un endpoint HTTP.',
      REQUEST_TIMEOUT:'Timeout: il caricamento non è stato confermato dal backend.',
      REQUEST_ABORTED:'Caricamento interrotto.',
      FILE_TOO_LARGE:'La foto supera il limite di 10 MB.',
      BATCH_TOO_LARGE:'Il batch supera il numero o il peso massimo consentito.',
      UNSUPPORTED_TYPE:'Formato non supportato. Usa JPEG, PNG o WebP.',
      UNSUPPORTED_EXTENSION:'Estensione non supportata. Usa JPG, JPEG, PNG o WebP.',
      CORRUPT_FILE:'Il file è corrotto o non corrisponde al formato dichiarato.',
      EMPTY_FILE:'Il file selezionato è vuoto.',
      CLOUDINARY_CONFIG:'Cloudinary non è configurato sul backend.',
      CLOUDINARY_UPLOAD:'Cloudinary ha rifiutato il caricamento.',
      CLOUDINARY_TIMEOUT:'Cloudinary non ha risposto entro il tempo previsto.',
      DB_SAVE_FAILED:'La foto è stata annullata perché i metadati non sono stati salvati nel database.',
      DB_READ_FAILED:'Il database dei metadati Foto non è raggiungibile.',
      ZIP_INCOMPLETE:'ZIP non creato: almeno un originale non è disponibile.',
      ZIP_TOO_LARGE:'La selezione supera il limite ZIP di 150 MB. Riduci il numero di foto.',
      INVALID_DIMENSIONS:'La risoluzione della foto non è valida o supera 120 megapixel.',
      ORIGINAL_UNAVAILABLE:'Il file originale non è disponibile.'
    };
    return byCode[err.code]||err.message||'Operazione Foto non riuscita.';
  }

  async function apiGet(params={}){
    return apiRequest({method:'GET',params:{folder:cfg.FOLDER||DEFAULT_FOLDER,...params},phase:'gallery-read'});
  }
  async function refreshAll(opts={}){
    if(cache.loading&&!opts.force)return cache.loading;
    if(cache.loaded&&!opts.force&&now()-cache.loadedAt<15000)return cache.photos;
    cache.loading=(async()=>{
      try{
        const data=await apiGet({});
        setCache(data.photos||[]);
        dispatch();
        return cache.photos;
      }catch(error){
        cache.error=error;
        dispatch();
        throw error;
      }finally{cache.loading=null;}
    })();
    return cache.loading;
  }
  async function fetchTeamPhotos(teamId,opts={}){
    if(!teamId)return [];
    if(cache.loaded&&!opts.force&&cache.byTeam[teamId])return cache.byTeam[teamId].slice();
    if(opts.teamOnly){
      const data=await apiGet({teamId});
      const rows=(data.photos||[]).map(normalizePhoto);
      cache.byTeam[teamId]=rows;
      rows.forEach(photo=>{cache.photos=[photo].concat(cache.photos.filter(item=>item.path!==photo.path));});
      cache.loaded=true;cache.loadedAt=now();cache.error=null;dispatch();
      return rows.slice();
    }
    await refreshAll({force:!!opts.force});
    return (cache.byTeam[teamId]||[]).slice();
  }
  function getTeamPhotoMap(state){return cache.loaded?cache.byTeam:(state?.teamPhotos||{});}
  function listTeamPhotos(state,teamId){return cache.loaded?(cache.byTeam[teamId]||[]).slice():legacyListFromState(state,teamId);}
  function status(){return {loaded:cache.loaded,loading:!!cache.loading,error:cache.error,loadedAt:cache.loadedAt};}

  function extension(name){return String(name||'').split('.').pop()?.toLowerCase()||'';}
  async function sniffFile(file){
    const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    const png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a;
    const chars=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
    const webp=chars(0,4)==='RIFF'&&chars(8,12)==='WEBP';
    return {jpeg,png,webp};
  }
  function decodeDimensions(file){
    if('createImageBitmap' in window){
      return createImageBitmap(file).then(bitmap=>{const result={width:bitmap.width,height:bitmap.height};bitmap.close?.();return result;});
    }
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);const image=new Image();
      image.onload=()=>{const result={width:image.naturalWidth,height:image.naturalHeight};URL.revokeObjectURL(url);resolve(result);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('decode failed'));};
      image.src=url;
    });
  }
  async function validateImageFile(file){
    if(!(file instanceof File))throw new PhotoError('File mancante.',{code:'FILE_MISSING',kind:'validation',phase:'validation'});
    if(!file.size)throw new PhotoError('Il file è vuoto.',{code:'EMPTY_FILE',kind:'validation',phase:'validation'});
    if(file.size>MAX_FILE_SIZE)throw new PhotoError('La foto supera il limite di 10 MB.',{code:'FILE_TOO_LARGE',kind:'size',status:413,phase:'validation'});
    if(!ALLOWED_TYPES.has(file.type))throw new PhotoError('Formato non supportato. Usa JPEG, PNG o WebP.',{code:'UNSUPPORTED_TYPE',kind:'validation',status:415,phase:'validation'});
    if(!ALLOWED_EXTENSIONS.has(extension(file.name)))throw new PhotoError('Estensione non supportata.',{code:'UNSUPPORTED_EXTENSION',kind:'validation',status:415,phase:'validation'});
    const signature=await sniffFile(file);
    const matches=(file.type==='image/jpeg'&&signature.jpeg)||(file.type==='image/png'&&signature.png)||(file.type==='image/webp'&&signature.webp);
    if(!matches)throw new PhotoError('Il file è corrotto o non corrisponde al formato dichiarato.',{code:'CORRUPT_FILE',kind:'validation',status:415,phase:'validation'});
    let dimensions;
    try{dimensions=await decodeDimensions(file);}catch(error){throw new PhotoError('Il file non contiene un’immagine leggibile.',{code:'CORRUPT_FILE',kind:'validation',status:415,phase:'validation',cause:error});}
    if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>MAX_IMAGE_PIXELS){
      throw new PhotoError('Risoluzione immagine non valida o eccessiva.',{code:'INVALID_DIMENSIONS',kind:'validation',status:415,phase:'validation'});
    }
    return {...dimensions,type:file.type,size:file.size,name:file.name};
  }
  async function validateBatch(files){
    const rows=Array.from(files||[]);
    if(rows.length>MAX_BATCH_FILES)throw new PhotoError(`Puoi selezionare al massimo ${MAX_BATCH_FILES} foto.`,{code:'BATCH_TOO_LARGE',kind:'size',status:413,phase:'validation'});
    if(rows.reduce((sum,file)=>sum+(file?.size||0),0)>MAX_BATCH_SIZE)throw new PhotoError('Il batch supera il limite totale di 80 MB.',{code:'BATCH_TOO_LARGE',kind:'size',status:413,phase:'validation'});
    const results=[];
    for(const file of rows){
      try{results.push({file,ok:true,meta:await validateImageFile(file)});}
      catch(error){results.push({file,ok:false,error});}
    }
    return results;
  }

  async function uploadTeamPhoto(teamId,file,opts={}){
    if(!teamId)throw new PhotoError('Squadra mancante.',{code:'TEAM_MISSING',kind:'validation',phase:'validation'});
    await validateImageFile(file);
    const fd=new FormData();
    fd.append('file',file,file.name||'photo.jpg');
    fd.append('teamId',teamId);
    fd.append('folder',cfg.FOLDER||DEFAULT_FOLDER);
    fd.append('section',cfg.SECTION||DEFAULT_SECTION);
    ['title','description','caption','altText','album','order'].forEach(key=>{if(opts[key]!==undefined&&opts[key]!==null)fd.append(key,String(opts[key]));});
    const data=await apiRequest({method:'POST',body:fd,admin:true,signal:opts.signal,timeout:UPLOAD_TIMEOUT_MS,phase:'upload'});
    const photo=normalizePhoto(data.photo||(data.created||[])[0]);
    if(!photo.path){
      const failed=data.failed?.[0];
      throw new PhotoError(failed?.message||'Il backend non ha confermato il caricamento.',{code:failed?.code||'UPLOAD_NOT_CONFIRMED',kind:errorKind(failed?.status||500,failed?.code||''),status:failed?.status||500,phase:'upload',details:data});
    }
    if(!cache.byTeam[teamId])cache.byTeam[teamId]=[];
    cache.byTeam[teamId]=[photo].concat(cache.byTeam[teamId].filter(item=>item.path!==photo.path));
    cache.photos=[photo].concat(cache.photos.filter(item=>item.path!==photo.path));
    cache.loaded=true;cache.loadedAt=now();cache.error=null;dispatch();
    return photo;
  }
  async function updatePhotoMetadata(photoOrId,metadata={}){
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    if(!photoId)throw new PhotoError('Identificativo foto mancante.',{code:'PHOTO_ID_MISSING',kind:'validation',phase:'metadata'});
    const data=await apiRequest({method:'PATCH',admin:true,body:{photoId,...metadata},phase:'metadata'});
    const photo=normalizePhoto(data.photo);
    cache.photos=cache.photos.map(item=>item.path===photoId?photo:item);
    Object.keys(cache.byTeam).forEach(teamId=>{cache.byTeam[teamId]=(cache.byTeam[teamId]||[]).map(item=>item.path===photoId?photo:item);});
    cache.loadedAt=now();dispatch();
    return photo;
  }
  async function replaceTeamPhoto(teamId,photoOrId,file,metadata={},opts={}){
    await validateImageFile(file);
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    const fd=new FormData();
    fd.append('file',file,file.name||'photo.jpg');fd.append('photoId',photoId);fd.append('teamId',teamId||'');
    ['title','description','caption','altText','album','order'].forEach(key=>{if(metadata[key]!==undefined&&metadata[key]!==null)fd.append(key,String(metadata[key]));});
    const data=await apiRequest({method:'PUT',body:fd,admin:true,signal:opts.signal,timeout:UPLOAD_TIMEOUT_MS,phase:'replace'});
    const photo=normalizePhoto(data.photo);
    cache.photos=cache.photos.map(item=>item.path===photoId?photo:item);
    Object.keys(cache.byTeam).forEach(id=>{cache.byTeam[id]=(cache.byTeam[id]||[]).filter(item=>item.path!==photoId);});
    if(!cache.byTeam[photo.teamId])cache.byTeam[photo.teamId]=[];
    cache.byTeam[photo.teamId].unshift(photo);
    cache.loadedAt=now();dispatch();
    return {photo,warning:data.warning||''};
  }
  async function deleteTeamPhoto(teamId,photoOrId){
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    if(!photoId)throw new PhotoError('Identificativo foto mancante.',{code:'PHOTO_ID_MISSING',kind:'validation',phase:'delete'});
    await apiRequest({method:'DELETE',admin:true,body:{photoId,teamId,folder:cfg.FOLDER||DEFAULT_FOLDER},phase:'delete'});
    cache.photos=cache.photos.filter(photo=>![photo.path,photo.publicId,photo.id].includes(photoId));
    Object.keys(cache.byTeam).forEach(id=>{cache.byTeam[id]=(cache.byTeam[id]||[]).filter(photo=>![photo.path,photo.publicId,photo.id].includes(photoId));});
    cache.loadedAt=now();dispatch();
    return true;
  }

  function publicUrl(path){
    if(!path)return '';
    if(/^https?:\/\//i.test(path))return path;
    return `https://res.cloudinary.com/${cfg.CLOUD_NAME}/image/upload/${path}`;
  }
  function originalDownloadUrl(photoOrId){
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    const url=new URL(functionUrl('download'));
    url.searchParams.set('photoId',photoId||'');
    return url.toString();
  }
  function downloadOriginal(photo){
    if(!photo)return;
    const anchor=document.createElement('a');
    anchor.href=originalDownloadUrl(photo);
    anchor.rel='noopener';
    anchor.download=String(photo.name||'foto');
    document.body.appendChild(anchor);anchor.click();anchor.remove();
  }
  function safeFileName(name){return String(name||'foto').replace(/[\\/:*?"<>|]+/g,'_').slice(0,120);}
  async function downloadSelectedAsZip(photos,teamId,teamName,{signal}={}){
    const rows=Array.from(photos||[]).map(normalizePhoto).filter(photo=>photo.path);
    if(!rows.length)throw new PhotoError('Nessuna foto selezionata.',{code:'ZIP_EMPTY',kind:'validation',phase:'zip'});
    const {response,blob}=await apiRequest({method:'POST',action:'zip',body:{ids:rows.map(photo=>photo.publicId||photo.path),teamId,teamName},signal,timeout:ZIP_TIMEOUT_MS,phase:'zip',expect:'blob'});
    const disposition=response.headers.get('content-disposition')||'';
    const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename=encoded?decodeURIComponent(encoded):safeFileName(`${teamName||'foto-squadra'}-originali.zip`);
    const objectUrl=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),2000);
  }
  async function downloadAllAsZip(state,teamId,teamName){
    let photos=listTeamPhotos(state,teamId);
    if(!photos.length)photos=await fetchTeamPhotos(teamId,{force:true,teamOnly:true});
    return downloadSelectedAsZip(photos,teamId,teamName);
  }
  function compressImage(file){return Promise.resolve(file);}

  window.NexoraPhotos={
    version:'v126.16-photo-network',
    config:{...cfg,MAX_FILE_SIZE,MAX_BATCH_FILES,MAX_BATCH_SIZE,ALLOWED_TYPES:[...ALLOWED_TYPES]},
    PhotoError,
    status,
    userMessage,
    invalidateCache,
    refreshAll,
    fetchTeamPhotos,
    getTeamPhotoMap,
    listTeamPhotos,
    validateImageFile,
    validateBatch,
    uploadTeamPhoto,
    updatePhotoMetadata,
    replaceTeamPhoto,
    deleteTeamPhoto,
    publicUrl,
    originalDownloadUrl,
    downloadOriginal,
    compressImage,
    downloadSelectedAsZip,
    downloadAllAsZip
  };
})();
````

## `/mnt/data/ng-work/new-generation-main/assets/js/public.js`

````javascript
(function(){
  const store=window.NexoraStore, UI=window.NexoraUI, $=UI.$;
  let state=store.load('public'); let phaseFilter='', roundFilter='', teamFilter='', statusFilter='', playerTeamFilter='', standingsGroup='all', articleSearch='', articleCategory='all';
  const FAVORITE_TEAM_KEY='new-generation-public-favorite-team-v1';
  let favoriteTeamId=loadFavoriteTeamId();
  const BRAND_LOGO='assets/brand/new-generation-logo-transparent.png';
  // v126.9: palette editoriale bianco/oro (vedi admin-reports.js per il
  // razionale). Coerente con tutti gli altri PDF del sito.
  const PDF_COLORS={bg:[253,251,247],ink:[22,18,8],muted:[120,105,72],gold:[184,134,28],gold2:[253,239,200],paper:[253,251,247],line:[222,210,176]};
  const PUBLIC_ACTIVE_TAB_KEY='new-generation-public-active-tab-v1';
  const PUBLIC_FILTERS_KEY='new-generation-public-filter-state-v1';
  const PUBLIC_TABS=new Set(['home','teams','players','matches','bracket','articles','photos','search']);
  let applyingTabHistory=false;
  let openArticleId='', lastArticleHtml='', articleListScrollY=0, articleSearchTimer=null;
  const baseDocumentTitle=document.title||'New Generation';
  function safeSessionGet(key){try{return sessionStorage.getItem(key)||'';}catch(_){return '';}}
  function safeSessionSet(key,value){try{sessionStorage.setItem(key,value);}catch(_){}}
  function articleKeyFromHash(){
    try{
      const raw=decodeURIComponent(String(location.hash||'').replace(/^#/,''));
      return raw.startsWith('article=')?raw.slice(8):'';
    }catch(_){return '';}
  }
  function tabFromHash(){
    try{
      if(articleKeyFromHash())return 'articles';
      const raw=decodeURIComponent(String(location.hash||'').replace(/^#(?:tab=)?/,''));
      return PUBLIC_TABS.has(raw)?raw:'';
    }catch(_){return '';}
  }
  function writeTabHash(tab,{replace=false}={}){
    if(!PUBLIC_TABS.has(tab))return;
    const next='#'+encodeURIComponent(tab);
    try{
      if(location.hash===next)return;
      const method=replace?'replaceState':'pushState';
      history[method]({tab},'',next);
    }catch(_){try{location.hash=next;}catch(__){}}
  }
  function persistPublicFilters(){
    try{sessionStorage.setItem(PUBLIC_FILTERS_KEY,JSON.stringify({phaseFilter,roundFilter,teamFilter,statusFilter,playerTeamFilter,standingsGroup,articleSearch,articleCategory,search:$('#globalSearch')?.value||''}));}catch(_){}
  }
  function restorePublicFilters(){
    try{
      const raw=sessionStorage.getItem(PUBLIC_FILTERS_KEY);
      if(!raw)return;
      const data=JSON.parse(raw)||{};
      phaseFilter=String(data.phaseFilter||'');
      roundFilter=String(data.roundFilter||'');
      teamFilter=String(data.teamFilter||'');
      statusFilter=String(data.statusFilter||'');
      playerTeamFilter=String(data.playerTeamFilter||'');
      standingsGroup=String(data.standingsGroup||'all')||'all';
      articleSearch=String(data.articleSearch||'').slice(0,120);
      articleCategory=String(data.articleCategory||'all')||'all';
      const search=$('#globalSearch'); if(search&&data.search)search.value=String(data.search).slice(0,100);
      const articleSearchInput=$('#publicArticleSearch');if(articleSearchInput)articleSearchInput.value=articleSearch;
    }catch(_){}
  }
  function activePublicTab(){
    const current=document.querySelector('.tab-panel.active')?.id||'';
    return PUBLIC_TABS.has(current)?current:'home';
  }
  const MOBILE_APP_QUERY='(max-width: 820px)';
  function isMobileAppView(){return window.matchMedia&&window.matchMedia(MOBILE_APP_QUERY).matches;}
  function updateAppViewportVars(){
    try{document.documentElement.style.setProperty('--ng-app-vh', `${window.innerHeight*0.01}px`);}catch(_){ }
  }
  function renderTabSection(tab){
    const target=PUBLIC_TABS.has(tab)?tab:'home';
    if(target==='home')renderHome();
    else if(target==='teams')renderTeams();
    else if(target==='players')renderPlayers();
    else if(target==='matches')renderMatches();
    else if(target==='bracket')renderBracket();
    else if(target==='articles')renderArticles();
    else if(target==='photos')renderPhotos();
    else if(target==='search')renderSearch();
  }
  function renderAllSections(){renderHome();renderTeams();renderPlayers();renderMatches();renderBracket();renderArticles();renderPhotos();renderSearch();}
  function htmlSignature(html){
    const s=String(html||'');
    let h=0;
    for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;
    return `${s.length}:${h}`;
  }
  function setHtmlStable(target,html){
    const el=typeof target==='string'?$(target):target;
    if(!el)return false;
    const next=String(html||'');
    const sig=htmlSignature(next);
    if(el.dataset.ngHtmlSig===sig && el.__ngLastHtml===next)return false;
    el.__ngLastHtml=next;
    el.dataset.ngHtmlSig=sig;
    el.innerHTML=next;
    return true;
  }
  function setPublicTab(tab,{persist=true,scroll=false}={}){
    const target=PUBLIC_TABS.has(tab)?tab:'home';
    UI.$$('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===target));
    UI.$$('.tab-panel').forEach(x=>x.classList.toggle('active',x.id===target));
    if(persist) safeSessionSet(PUBLIC_ACTIVE_TAB_KEY,target);
    document.dispatchEvent(new CustomEvent('ng:tab-changed',{detail:{tab:target,restored:!persist}}));
    if(scroll) window.scrollTo({top:0,behavior:'auto'});
  }
  function restorePublicTab(){
    const fromHash=tabFromHash();
    const saved=safeSessionGet(PUBLIC_ACTIVE_TAB_KEY);
    const target=fromHash||(saved&&PUBLIC_TABS.has(saved)?saved:activePublicTab());
    setPublicTab(target,{persist:false,scroll:false});
    safeSessionSet(PUBLIC_ACTIVE_TAB_KEY,target);
    if(!fromHash)writeTabHash(target,{replace:true});
  }
  document.addEventListener('ng:tab-changed',e=>{
    const tab=e.detail?.tab;
    if(applyingTabHistory||e.detail?.restored||!PUBLIC_TABS.has(tab))return;
    safeSessionSet(PUBLIC_ACTIVE_TAB_KEY,tab);
    writeTabHash(tab);
  });
  window.addEventListener('hashchange',()=>{
    const articleKey=articleKeyFromHash();
    if(articleKey){
      applyingTabHistory=true;
      try{if(activePublicTab()!=='articles')setPublicTab('articles',{persist:true,scroll:false});showArticle(articleKey,null,{updateHistory:false,restoreScroll:false});}finally{applyingTabHistory=false;}
      return;
    }
    if(openArticleId)closeArticleModal({updateHistory:false,restoreScroll:true});
    const tab=tabFromHash();
    if(!tab||tab===activePublicTab())return;
    applyingTabHistory=true;
    try{setPublicTab(tab,{persist:true,scroll:false});}finally{applyingTabHistory=false;}
  });
  function save(){store.save('public',state);} 
  function loadFavoriteTeamId(){try{return localStorage.getItem(FAVORITE_TEAM_KEY)||'';}catch(_){return '';}}
  function persistFavoriteTeamId(){try{favoriteTeamId?localStorage.setItem(FAVORITE_TEAM_KEY,favoriteTeamId):localStorage.removeItem(FAVORITE_TEAM_KEY);}catch(_){}}
  function sanitizeFavoriteTeam(){if(favoriteTeamId&&!store.getTeam(state,favoriteTeamId)){favoriteTeamId='';persistFavoriteTeamId();}}
  function setFavoriteTeam(teamId){favoriteTeamId=teamId||'';persistFavoriteTeamId();render();}
  function clearFavoriteTeam(){favoriteTeamId='';persistFavoriteTeamId();render();}
  function isFavoriteTeam(teamId){return !!favoriteTeamId&&teamId===favoriteTeamId;}
  function favoriteButton(teamId,label='Segui squadra'){
    const fav=isFavoriteTeam(teamId);
    return `<button class="btn small favorite-team-btn ${fav?'active':''}" type="button" data-favorite-team="${UI.esc(teamId)}" aria-pressed="${fav?'true':'false'}">${fav?'★ Preferita':'☆ '+UI.esc(label)}</button>`;
  }
  function teamFilterOptions(selected){return '<option value="">Tutte le squadre</option>'+state.teams.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${UI.esc(t.name)}</option>`).join('');}
  function localTodayIso(){const d=new Date();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${d.getFullYear()}-${m}-${day}`;}
  function isMatchPlayed(m){return store.hasScore(state,m)||m.status==='played';}
  function isTodayMatch(m){return !!m.date&&String(m.date)===localTodayIso();}
  function filteredMatches(){return state.matches.filter(m=>(!phaseFilter||m.phase===phaseFilter)&&(!roundFilter||m.round===roundFilter)&&(!teamFilter||m.homeTeamId===teamFilter||m.awayTeamId===teamFilter)&&(!statusFilter||statusFilter==='all'||(statusFilter==='played'&&isMatchPlayed(m))||(statusFilter==='pending'&&!isMatchPlayed(m))||(statusFilter==='today'&&isTodayMatch(m))||(statusFilter==='favorite'&&favoriteTeamId&&(m.homeTeamId===favoriteTeamId||m.awayTeamId===favoriteTeamId))));}
  function filteredPlayerStats(){let rows=store.selectors.playerStats(state);if(playerTeamFilter)return rows.filter(p=>p.teamId===playerTeamFilter);return rows.filter(p=>p.goals>0).slice(0,10);}
  function renderFilters(){
    const phases=store.selectors.phases(state);
    setHtmlStable('#publicPhaseFilter','<option value="">Tutte le fasi</option>'+phases.map(p=>`<option value="${p}" ${p===phaseFilter?'selected':''}>${UI.esc(store.PHASE_LABELS[p]||p)}</option>`).join(''));
    const rounds=store.selectors.rounds(state);
    setHtmlStable('#publicRoundFilter','<option value="">Tutte le giornate/turni</option>'+rounds.map(r=>`<option value="${UI.esc(r)}" ${r===roundFilter?'selected':''}>${UI.esc(r)}</option>`).join(''));
    setHtmlStable('#publicTeamFilter',teamFilterOptions(teamFilter));
    renderMatchFilterToolbar();
  }

  function activeFilterLabel(type){
    if(type==='phase')return phaseFilter?(store.PHASE_LABELS[phaseFilter]||phaseFilter):'Tutte le fasi';
    if(type==='round')return roundFilter||'Tutte le giornate';
    if(type==='team'){const t=teamFilter?store.getTeam(state,teamFilter):null;return t?t.name:'Tutte le squadre';}
    return '';
  }
  function renderMatchFilterToolbar(){
    const bar=$('#publicMatchFilterBar'); if(!bar)return;
    const count=filteredMatches().length;
    setHtmlStable(bar,`<div class="match-filter-buttons">
      <button class="filter-chip-btn ${phaseFilter?'active':''}" type="button" data-open-match-filter="phase"><span>Fase</span><strong>${UI.esc(activeFilterLabel('phase'))}</strong></button>
      <button class="filter-chip-btn ${roundFilter?'active':''}" type="button" data-open-match-filter="round"><span>Giornata</span><strong>${UI.esc(activeFilterLabel('round'))}</strong></button>
      <button class="filter-chip-btn ${teamFilter?'active':''}" type="button" data-open-match-filter="team"><span>Squadra</span><strong>${UI.esc(activeFilterLabel('team'))}</strong></button>
    </div><div class="match-filter-resultbar"><span>${count} ${count===1?'partita':'partite'}</span>${phaseFilter||roundFilter||teamFilter||statusFilter?'<button class="btn small" type="button" data-clear-match-filters>Reset filtri</button>':''}</div>`);
  }

  function ensureMatchFilterSheet(){
    let modal=$('#matchFilterSheet');
    if(modal)return modal;
    modal=document.createElement('div');modal.id='matchFilterSheet';modal.className='filter-sheet-modal';modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="filter-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="matchFilterTitle"><div class="filter-sheet-head"><div><span class="article-kicker">Filtra partite</span><h2 id="matchFilterTitle">Scegli filtro</h2></div><button class="btn danger small" type="button" data-close-match-filter>Chiudi</button></div><div id="matchFilterOptions" class="filter-sheet-options"></div></div>';
    document.body.appendChild(modal);return modal;
  }
  function openMatchFilterSheet(type){
    const modal=ensureMatchFilterSheet();const title=$('#matchFilterTitle');const box=$('#matchFilterOptions');
    const make=(value,label,active=false,icon='')=>`<button class="filter-option ${active?'active':''}" type="button" data-filter-type="${UI.esc(type)}" data-filter-value="${UI.esc(value)}"><span class="filter-option-media">${icon}</span><strong>${UI.esc(label)}</strong>${active?'<em>Attivo</em>':''}</button>`;
    let html='';
    if(type==='phase'){title.textContent='Scegli fase';html+=make('', 'Tutte le fasi', !phaseFilter, '<span class="filter-option-emoji">🏆</span>');store.selectors.phases(state).forEach(p=>html+=make(p,store.PHASE_LABELS[p]||p,p===phaseFilter,'<span class="filter-option-emoji">🏁</span>'));}
    if(type==='round'){title.textContent='Scegli giornata / turno';html+=make('', 'Tutte le giornate', !roundFilter, '<span class="filter-option-emoji">📅</span>');store.selectors.rounds(state).forEach(r=>html+=make(r,r,r===roundFilter,'<span class="filter-option-emoji">🗓️</span>'));}
    if(type==='team'){
      title.textContent='Scegli squadra';
      html+=make('', 'Tutte le squadre', !teamFilter, '<span class="filter-option-emoji">👥</span>');
      if(favoriteTeamId&&store.getTeam(state,favoriteTeamId)){
        const favTeam=store.getTeam(state,favoriteTeamId);
        html+=make(favoriteTeamId,'★ '+favTeam.name,teamFilter===favoriteTeamId,UI.logo(favTeam,false));
      }
      state.teams.forEach(t=>html+=make(t.id,t.name,t.id===teamFilter,UI.logo(t,false)));
    }
    box.innerHTML=html;modal.classList.add('open');modal.setAttribute('aria-hidden','false');
  }
  function closeMatchFilterSheet(){const modal=$('#matchFilterSheet');if(!modal)return;modal.classList.remove('open');modal.setAttribute('aria-hidden','true');}
  function setMatchFilter(type,value){if(type==='phase'){phaseFilter=value;roundFilter='';}else if(type==='round'){roundFilter=value;}else if(type==='team'){teamFilter=value;}persistPublicFilters();closeMatchFilterSheet();renderMatches();}
  function renderPlayerFilter(){const el=$('#publicPlayerTeamFilter');if(!el)return;if(playerTeamFilter&&!state.teams.some(t=>t.id===playerTeamFilter))playerTeamFilter='';setHtmlStable(el,teamFilterOptions(playerTeamFilter));}

  function favoriteTeamHomeMarkup(){
    const team=favoriteTeamId?store.getTeam(state,favoriteTeamId):null;
    if(!team){
      return `<div class="favorite-empty-card"><div><span class="article-kicker">Squadra preferita</span><h2>Scegli la tua squadra</h2><p class="muted">Salvala su questo dispositivo: la vedrai in evidenza in classifica, partite e tabellone.</p></div><button class="btn primary" type="button" data-open-teams-tab>Vai alle squadre</button></div>`;
    }
    const rec=teamRecord(team.id);
    const matches=(state.matches||[]).filter(m=>m.homeTeamId===team.id||m.awayTeamId===team.id);
    const last=matches.filter(m=>store.hasScore(state,m)||m.status==='played').slice(-1)[0];
    const next=matches.filter(m=>!(store.hasScore(state,m)||m.status==='played')).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))||String(a.time||'99:99').localeCompare(String(b.time||'99:99')))[0];
    const compactMatch=m=>{if(!m)return '<span class="muted">Non disponibile</span>';const home=store.teamName(state,m.homeTeamId,m.homeLabel),away=store.teamName(state,m.awayTeamId,m.awayLabel);return `<strong>${UI.esc(home)} vs ${UI.esc(away)}</strong><small>${UI.esc(UI.fmtDate(m))} · ${UI.esc(m.field||'Campo da definire')}${store.hasScore(state,m)?' · '+UI.esc(store.scoreText(state,m)):''}</small>`;};
    return `<div class="favorite-team-dashboard">
      <div class="favorite-team-hero">${UI.logo(team,true)}<div><span class="article-kicker">La tua squadra</span><h2>${UI.esc(team.name)}</h2><p>${team.president?.name?`Presidente: ${UI.esc(team.president.name)}`:'Presidente non inserito'}${team.coach?.name?` · Allenatore: ${UI.esc(team.coach.name)}`:''}</p></div><button class="favorite-remove" type="button" data-clear-favorite aria-label="Rimuovi squadra preferita">×</button></div>
      <div class="favorite-kpis"><span><strong>${rec.points||0}</strong>Punti</span><span><strong>${rec.played||0}</strong>PG</span><span><strong>${rec.goalsFor||0}</strong>GF</span><span><strong>${rec.diff>0?'+':''}${rec.diff||0}</strong>DR</span></div>
      <div class="favorite-team-grid"><div><span>Prossima</span>${compactMatch(next)}</div><div><span>Ultima</span>${compactMatch(last)}</div></div>
      <div class="row-actions"><button class="btn primary" type="button" data-team-detail="${UI.esc(team.id)}">Apri scheda</button><button class="btn" type="button" data-filter-favorite-matches="${UI.esc(team.id)}">Mostra partite</button></div>
    </div>`;
  }
  function renderFavoriteHome(){
    const grid=$('#home .grid'); if(!grid)return;
    let slot=$('#favoriteTeamHome');
    if(!slot){slot=document.createElement('article');slot.id='favoriteTeamHome';slot.className='card pad span-12 favorite-team-home';grid.prepend(slot);}
    setHtmlStable(slot,favoriteTeamHomeMarkup());
  }

  function liveMatchesHomeMarkup(){
    const live=(state.matches||[]).filter(m=>m.status==='live'&&m.homeTeamId&&m.awayTeamId);
    if(!live.length)return '';
    return `<div class="live-strip-head"><span class="live-strip-dot" aria-hidden="true"></span><h2>Partite in corso</h2><span class="muted">Aggiornamento automatico in tempo reale</span></div>
      <div class="live-strip-grid">${live.map(m=>{
        const homeT=store.getTeam(state,m.homeTeamId), awayT=store.getTeam(state,m.awayTeamId);
        const home=store.teamName(state,m.homeTeamId,m.homeLabel), away=store.teamName(state,m.awayTeamId,m.awayLabel);
        const sc=store.matchGoals(state,m);
        return `<article class="live-strip-card is-live-card" data-match-detail="${UI.esc(m.id)}" role="button" tabindex="0">
          <div class="live-strip-meta"><span class="score-badge match-status-badge is-live">🔴 Live</span><small>${UI.esc(store.PHASE_LABELS[m.phase]||m.phase)} · ${UI.esc(m.round)}</small></div>
          <div class="live-strip-teams">
            <div class="live-strip-team">${UI.logo(homeT,false)}<strong>${UI.esc(home)}</strong></div>
            <div class="live-strip-score">${sc.home} - ${sc.away}</div>
            <div class="live-strip-team">${UI.logo(awayT,false)}<strong>${UI.esc(away)}</strong></div>
          </div>
          <div class="live-strip-footer"><small>📍 ${UI.esc(m.field||'Campo')}</small><small>🕒 ${UI.esc(UI.fmtDate(m))}</small></div>
        </article>`;
      }).join('')}</div>`;
  }
  let _lastLiveHomeHtml = '';
  function renderLiveHome(){
    const grid=$('#home .grid'); if(!grid)return;
    let slot=$('#liveStripHome');
    const html=liveMatchesHomeMarkup();
    if(!html){
      if(slot){slot.remove();_lastLiveHomeHtml='';}
      return;
    }
    if(!slot){
      slot=document.createElement('article');
      slot.id='liveStripHome';
      slot.className='card pad span-12 live-strip-home';
      grid.prepend(slot);
    }
    // Aggiorna il DOM solo se il markup è diverso: evita riflow inutili
    if(html !== _lastLiveHomeHtml){
      setHtmlStable(slot,html);
      _lastLiveHomeHtml=html;
    }
  }
  function decorateFavoriteUI(){
    sanitizeFavoriteTeam();
    document.querySelectorAll('.is-favorite-team,.is-favorite-match').forEach(el=>el.classList.remove('is-favorite-team','is-favorite-match'));
    if(!favoriteTeamId)return;
    document.querySelectorAll(`[data-team-detail="${CSS.escape(favoriteTeamId)}"], [data-team-id="${CSS.escape(favoriteTeamId)}"]`).forEach(el=>el.classList.add('is-favorite-team'));
    document.querySelectorAll('[data-match-detail]').forEach(el=>{const m=state.matches.find(x=>x.id===el.dataset.matchDetail);if(m&&(m.homeTeamId===favoriteTeamId||m.awayTeamId===favoriteTeamId))el.classList.add('is-favorite-match');});
  }
  function renderHome(){
    document.title=UI.siteTitle?UI.siteTitle(state):(state.rules.name||'New Generation');
    const titleEl=$('#publicTitle');if(titleEl)titleEl.textContent=state.rules.name||'New Generation';
    const summaryEl=$('#publicSummary');if(summaryEl)setHtmlStable(summaryEl,UI.rulesSummary(state));
    const statsEl=$('#publicStats');if(statsEl)setHtmlStable(statsEl,UI.statsGrid(store.selectors.stats(state)));
    renderLiveHome();renderFavoriteHome();
    const standingsMenu=$('#publicStandingsMenu');
    if(standingsMenu)setHtmlStable(standingsMenu,store.selectors.hasGroupStage(state)?UI.groupStandingsSelector(state,standingsGroup,'publicGroupStandingsFilter'):'');
    setHtmlStable('#publicStandings',store.selectors.hasGroupStage(state)?UI.groupStandingsTables(state,standingsGroup,{includeLive:true}):UI.standingsTable((store.selectors.officialStandings?store.selectors.officialStandings(state,{includeLive:true}):store.selectors.calculateStandings(state,undefined,{includeLive:true})),state));
    setHtmlStable('#publicPlayersMini',UI.playerStatsTable(store.selectors.playerStats(state).filter(p=>p.goals>0).slice(0,10))+(state.rules.isKingsLeague?'<div class="mini-section-title margin-top"><h3>Presidenti marcatori</h3></div>'+UI.presidentStatsTable(store.selectors.presidentScorers(state).slice(0,10)):''));
    decorateFavoriteUI();
  }
  function renderTeams(){ setHtmlStable('#publicTeams',UI.teamGrid(state).replaceAll('data-favorite-placeholder="','data-favorite-team="')); decorateFavoriteUI(); }
  function renderPlayers(){ resetFiltersForNewState(); persistPublicFilters(); renderPlayerFilter(); setHtmlStable('#publicPlayers',UI.playerStatsTable(filteredPlayerStats())); }
  function renderPublicMatchCenter(){const slot=document.getElementById('publicMatchCenter');if(slot)slot.remove();}
  function renderMatches(){const slot=document.getElementById('publicMatchCenter');if(slot)slot.remove();resetFiltersForNewState();persistPublicFilters();renderFilters();setHtmlStable('#publicMatches',UI.matchList(state,filteredMatches(),true));decorateFavoriteUI();}
  function renderBracket(){const el=$('#publicBracket');if(el)setHtmlStable(el,UI.bracketMarkup(state));decorateFavoriteUI();}
  function renderArticles(){
    const all=store.selectors.articles(state);
    const categories=store.selectors.articleCategories(state);
    if(articleCategory!=='all'&&!categories.includes(articleCategory))articleCategory='all';
    const select=$('#publicArticleCategory');
    if(select){
      const options='<option value="all">Tutte le categorie</option>'+categories.map(category=>`<option value="${UI.esc(category)}">${UI.esc(category)}</option>`).join('');
      setHtmlStable(select,options);select.value=articleCategory;
    }
    const input=$('#publicArticleSearch');if(input&&input.value!==articleSearch)input.value=articleSearch;
    const query=articleSearch.trim().toLocaleLowerCase('it');
    const visible=all.filter(article=>{
      if(articleCategory!=='all'&&article.category!==articleCategory)return false;
      if(!query)return true;
      return [article.title,article.subtitle,article.excerpt,article.body,article.author,article.category,(article.tags||[]).join(' ')].join(' ').toLocaleLowerCase('it').includes(query);
    });
    const count=$('#publicArticleCount');if(count)count.textContent=String(all.length);
    const status=$('#publicArticleStatus');if(status)status.innerHTML=`<span><strong>${visible.length}</strong> risultati</span>${articleCategory!=='all'?`<span>Categoria: <strong>${UI.esc(articleCategory)}</strong></span>`:''}${query?`<span>Ricerca: <strong>${UI.esc(articleSearch.trim())}</strong></span>`:''}`;
    const el=$('#publicArticles');if(el)setHtmlStable(el,UI.articleList(visible,false));
  }


  // ---- Sezione Foto squadre (lato pubblico) ----
  let photosSelectedTeam = '';
  let publicLightboxIndex = -1;

  // Loader robusto immagini foto (desktop + mobile + refresh realtime)
  // ------------------------------------------------------------
  // Su mobile il problema più frequente è un errore temporaneo della thumbnail
  // o una richiesta lazy/stalled dopo refresh realtime. Il lightbox funziona perché
  // usa l'originale, quindi per dispositivi touch/schermi piccoli diamo priorità
  // all'originale e usiamo la thumbnail solo come alternativa. Il loader non si
  // affida a complete da solo: complete può essere true anche per immagini rotte.
  function attachSmartImageRetry(img, opts={}){
    if(!img) return;
    if(window.NGPhotoEngine){
      window.NGPhotoEngine.load(img, opts);
      return;
    }
    // Fallback minimo se photo-runtime.js non viene caricato.
    const thumb = img.closest('.photo-thumb');
    const primary = img.dataset.src || img.dataset.previewSrc || '';
    const original = img.dataset.fallbackSrc || img.dataset.originalSrc || primary;
    function mark(cls){
      if(!thumb) return;
      thumb.classList.remove('is-loading','is-loaded','is-broken');
      thumb.classList.add(cls);
    }
    mark('is-loading');
    img.onload = () => {
      if(img.naturalWidth > 0 || img.naturalHeight > 0) mark('is-loaded');
      else if(img.src !== original) img.src = original;
      else mark('is-broken');
    };
    img.onerror = () => {
      if(original && img.src !== original) img.src = original;
      else mark('is-broken');
    };
    img.src = primary || original;
  }

  // Reset manuale al click su "Riprova": riparte dalla thumb originale
  document.addEventListener('click', e => {
    const download = e.target.closest('[data-photo-download]');
    if(download){ e.stopPropagation(); return; }
    const btn = e.target.closest('[data-photo-retry]');
    if(!btn) return;
    e.stopPropagation();
    const thumb = btn.closest('.photo-thumb');
    const img = thumb?.querySelector('img[data-src]');
    if(!img || !thumb) return;
    img.dataset.retries = '0';
    delete img.dataset.triedFallback;
    thumb.classList.remove('is-broken','is-loaded');
    thumb.classList.add('is-loading');
    attachSmartImageRetry(img, {force:true});
  });

  function renderPhotos(){
    const grid = $('#publicPhotosGrid');
    const dlBtn = $('#publicPhotosDownloadAllBtn');
    const teamBar = $('#publicPhotosTeamBar');
    const legacySel = $('#publicPhotosTeamFilter');
    if(legacySel) legacySel.hidden = true; // nascondo il vecchio select, uso pillole

    if(!grid || !teamBar) return;

    const Photos = window.NexoraPhotos;
    const photoStatus = Photos?.status?.() || {loaded:false, loading:false};
    const photosMap = Photos?.getTeamPhotoMap ? Photos.getTeamPhotoMap(state) : (state.teamPhotos || {});
    const teamsWithPhotos = (state.teams||[]).filter(t => Array.isArray(photosMap[t.id]) && photosMap[t.id].length>0);

    if(!photoStatus.loaded && Photos?.refreshAll){
      Photos.refreshAll().catch(()=>{});
      teamBar.innerHTML = '';
      teamBar.hidden = true;
      grid.innerHTML = '<div class="empty photos-empty"><div class="empty-icon">📷</div><div>Caricamento foto squadra…</div><small>Recupero immagini da Cloudinary.</small></div>';
      if(dlBtn) dlBtn.hidden = true;
      return;
    }

    if(!teamsWithPhotos.length){
      teamBar.innerHTML = '';
      teamBar.hidden = true;
      const err = photoStatus.error ? '<small>Cloudinary: '+UI.esc(photoStatus.error.message||photoStatus.error)+'</small>' : '<small>L\'admin caricherà presto le foto del torneo.</small>';
      grid.innerHTML = '<div class="empty photos-empty"><div class="empty-icon">📷</div><div>Nessuna foto pubblicata.</div>'+err+'</div>';
      if(dlBtn) dlBtn.hidden = true;
      photosSelectedTeam = '';
      return;
    }

    teamBar.hidden = false;
    if(photosSelectedTeam && !teamsWithPhotos.find(t=>t.id===photosSelectedTeam)) photosSelectedTeam = '';
    if(!photosSelectedTeam) photosSelectedTeam = teamsWithPhotos[0].id;

    // Pillole squadra scroll orizzontale (mobile-friendly).
    // Mostro il LOGO della squadra (più identificativo per riconoscerla a colpo d'occhio).
    teamBar.innerHTML = teamsWithPhotos.map(t=>{
      const count = (photosMap[t.id]||[]).length;
      const active = t.id===photosSelectedTeam ? ' active' : '';
      return `<button type="button" class="photos-team-pill${active}" data-photos-team="${UI.esc(t.id)}">
        ${UI.logo(t,false)}
        <span class="photos-team-name">${UI.esc(t.name)}</span>
        <span class="photos-team-count">${count}</span>
      </button>`;
    }).join('');
    // Scroll into view della pillola attiva (utile su mobile con tante squadre)
    requestAnimationFrame(()=>{
      const activePill = teamBar.querySelector('.photos-team-pill.active');
      if(activePill) activePill.scrollIntoView({behavior:'auto', inline:'center', block:'nearest'});
    });

    const team = teamsWithPhotos.find(t=>t.id===photosSelectedTeam);
    const photos = window.NexoraPhotos ? window.NexoraPhotos.listTeamPhotos(state, team.id) : [];

    if(!photos.length){
      grid.innerHTML = '<div class="empty">Nessuna foto per questa squadra.</div>';
      grid.dataset.renderKey = '';
      if(dlBtn) dlBtn.hidden = true;
      return;
    }

    // ============================================================
    // RENDERING IDEMPOTENTE (fix: refresh lento)
    // ------------------------------------------------------------
    // Prima della fix, ad ogni cambio di state arrivato via Supabase
    // (anche update non legati alle foto, es. goal in una partita)
    // facevamo grid.innerHTML = ... ricreando da zero TUTTI gli <img>.
    // Il browser abortiva le richieste in volo e ne faceva partire di
    // nuove → al refresh la fetch dello state da Supabase arrivava
    // 100-500ms dopo il primo render, causando un aborto+restart di
    // tutte le richieste immagine, raddoppiando il tempo percepito.
    //
    // Soluzione: confronto i path delle foto già renderizzate con
    // quelli nuovi. Se sono gli stessi (caso comune!), NON tocco il
    // DOM e gli <img> in caricamento continuano indisturbati.
    // Se cambia solo un sottoinsieme (es. una foto aggiunta o
    // rimossa), faccio un diff minimale invece di nuke+rebuild.
    // ============================================================
    const renderKey = team.id + '|' + photos.map(p=>p.path).join(',');
    if(grid.dataset.renderKey === renderKey){
      // Identico: non ricreo il DOM, ma sincronizzo comunque gli URL e
      // riavvio solo le card rimaste in errore dopo refresh/realtime.
      const byPath = new Map();
      grid.querySelectorAll('.photo-thumb[data-photo-path]').forEach(el => byPath.set(el.dataset.photoPath, el));
      photos.forEach((p, i) => {
        const el = byPath.get(p.path);
        if(!el) return;
        el.dataset.publicPhotoOpen = i;
        const img = el.querySelector('img[data-src]');
        const nextSrc = p.thumbUrl || p.url || '';
        const nextFallback = p.originalUrl || p.url || '';
        if(img){
          const changed = img.dataset.src !== nextSrc || img.dataset.fallbackSrc !== nextFallback;
          if(changed){
            img.dataset.src = nextSrc;
            img.dataset.fallbackSrc = nextFallback;
            img.dataset.previewSrc = nextSrc;
            img.dataset.originalSrc = nextFallback;
            img.dataset.photoVersion = String(p.ts || p.path || i);
          }
          attachSmartImageRetry(img, {force: changed || el.classList.contains('is-broken')});
        }
        const dl = el.querySelector('.photo-download-btn');
        if(dl) dl.href = Photos.originalDownloadUrl(p);
      });
      if(dlBtn){
        dlBtn.hidden = false;
        dlBtn.disabled = false;
        dlBtn.innerHTML = `<span class="dl-icon">⬇</span> Scarica tutte <strong>(${photos.length})</strong> ZIP`;
      }
      return;
    }
    // Se cambia solo la squadra selezionata, nuke+rebuild è giusto
    // (foto completamente diverse). Se cambia la lista nella STESSA
    // squadra, provo l'update incrementale.
    const prevKey = grid.dataset.renderKey || '';
    const prevTeamId = prevKey.split('|')[0];
    const sameTeam = prevTeamId === team.id && prevKey !== '';
    const existingByPath = new Map();
    if(sameTeam){
      grid.querySelectorAll('.photo-thumb[data-photo-path]').forEach(el => {
        existingByPath.set(el.dataset.photoPath, el);
      });
    }

    function buildThumb(p, i){
      const loadStrategy = i < 6 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
      const imgSrc = UI.esc(p.thumbUrl||p.url);
      const fallbackSrc = UI.esc(p.originalUrl||p.url);
      const thumbPathAttr = p.thumbPath ? ` data-thumb-path="${UI.esc(p.thumbPath)}"` : '';
      const fig = document.createElement('figure');
      fig.className = 'photo-thumb public is-loading';
      fig.dataset.publicPhotoOpen = i;
      fig.dataset.photoPath = p.path;
      fig.tabIndex = 0;
      fig.setAttribute('role','button');
      fig.setAttribute('aria-label',`Apri fotografia ${p.title||p.name||i+1}`);
      // Solo le foto nuove (non già nel DOM) hanno l'animazione di entrata.
      // Le foto già caricate non rifanno il fade-in: percepito come "istantaneo".
      fig.style.setProperty('--enter-delay', Math.min(i*15, 180) + 'ms');
      fig.innerHTML = `
      <div class="photo-img-wrap">
        <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-photo-managed="1" data-src="${imgSrc}" data-fallback-src="${fallbackSrc}" data-preview-src="${imgSrc}" data-original-src="${fallbackSrc}" data-photo-version="${UI.esc(String(p.ts||p.path||i))}"${thumbPathAttr} data-retries="0" alt="${UI.esc(p.altText||p.title||p.name||'Fotografia squadra')}" ${loadStrategy} decoding="async" />
        <div class="photo-status photo-status-loading" aria-hidden="true">
          <span class="photo-status-dots"><span></span><span></span><span></span></span>
          <span class="photo-status-text">Recupero dati, attendere…</span>
        </div>
        <div class="photo-status photo-status-error" aria-hidden="true">
          <span class="photo-status-icon">📷</span>
          <span class="photo-status-text">Foto non disponibile</span>
          <button type="button" class="photo-status-retry" data-photo-retry aria-label="Riprova caricamento">Riprova</button>
        </div>
      </div>
      <figcaption>
        <span class="photo-name" title="${UI.esc(p.name)}">${UI.esc(p.name)}</span>
        <a href="${UI.esc(Photos.originalDownloadUrl(p))}" download="${UI.esc(p.originalName||p.name)}" class="photo-download-btn" aria-label="Scarica foto" title="Scarica originale" data-photo-download>⬇</a>
      </figcaption>`;
      return fig;
    }

    if(!sameTeam || existingByPath.size === 0){
      // Cambio squadra o griglia vuota: build full ma con DocumentFragment
      // (più veloce e meno reflow rispetto a innerHTML)
      const frag = document.createDocumentFragment();
      photos.forEach((p, i) => frag.appendChild(buildThumb(p, i)));
      grid.innerHTML = '';
      grid.appendChild(frag);
    } else {
      // Stessa squadra, lista parzialmente cambiata: diff in-place SENZA
      // rimuovere tutti i nodi (così l'animazione di entrata NON ri-parte
      // sui thumb già visibili).
      const stillUsed = new Set();
      // 1. Rimuovo i mancanti
      existingByPath.forEach((el, path) => {
        if(!photos.find(p => p.path === path)) el.remove();
      });
      // 2. Posiziono ogni foto al posto giusto, inserendo i nuovi
      photos.forEach((p, i) => {
        let el = existingByPath.get(p.path);
        const refNode = grid.children[i] || null;
        if(el){
          stillUsed.add(p.path);
          if(refNode !== el){
            grid.insertBefore(el, refNode);
          }
          el.dataset.publicPhotoOpen = i;
          const exImg = el.querySelector('img[data-src]');
          const nextSrc = p.thumbUrl || p.url || '';
          const nextFallback = p.originalUrl || p.url || '';
          if(exImg){
            const changed = exImg.dataset.src !== nextSrc || exImg.dataset.fallbackSrc !== nextFallback;
            if(changed){
              exImg.dataset.src = nextSrc;
              exImg.dataset.fallbackSrc = nextFallback;
              exImg.dataset.previewSrc = nextSrc;
              exImg.dataset.originalSrc = nextFallback;
              exImg.dataset.photoVersion = String(p.ts || p.path || i);
            }
            attachSmartImageRetry(exImg, {force: changed || el.classList.contains('is-broken')});
          }
          const dl = el.querySelector('.photo-download-btn');
          if(dl) dl.href = Photos.originalDownloadUrl(p);
        } else {
          el = buildThumb(p, i);
          grid.insertBefore(el, refNode);
        }
      });
    }
    grid.dataset.renderKey = renderKey;
    // Attivo retry inteligente su ogni img della griglia (idempotente:
    // se già montato salta via dataset.retryBound)
    grid.querySelectorAll('img[data-src]').forEach(img => attachSmartImageRetry(img));

    if(dlBtn){
      dlBtn.hidden = false;
      dlBtn.disabled = false;
      dlBtn.innerHTML = `<span class="dl-icon">⬇</span> Scarica tutte <strong>(${photos.length})</strong> ZIP`;
    }
  }

  // Lightbox pubblico: alta qualità, originale separato, zoom/pan e focus accessibile.
  let publicPhotoViewer=null;
  function ensurePublicLightbox(){
    let lb=$('#publicPhotosLightbox');
    if(!lb){
      lb=document.createElement('div');
      lb.id='publicPhotosLightbox';
      lb.className='photos-lightbox';
      lb.setAttribute('aria-hidden','true');
      lb.setAttribute('role','dialog');
      lb.setAttribute('aria-modal','true');
      lb.setAttribute('aria-label','Visualizzatore fotografie');
      lb.innerHTML=`
        <button type="button" class="lightbox-close" aria-label="Chiudi visualizzatore">×</button>
        <button type="button" class="lightbox-nav lightbox-prev" aria-label="Foto precedente">‹</button>
        <button type="button" class="lightbox-nav lightbox-next" aria-label="Foto successiva">›</button>
        <div class="lightbox-stage"><img class="lightbox-img" alt="" draggable="false"></div>
        <div class="lightbox-bar">
          <div class="lightbox-meta"><span class="lightbox-name"></span><small class="lightbox-counter"></small></div>
          <a class="lightbox-download btn small" download href="#">⬇ Originale</a>
        </div>`;
      document.body.appendChild(lb);
    }
    if(!publicPhotoViewer){
      publicPhotoViewer=window.NGImageViewer?.bind(lb,{
        onClose:()=>{publicLightboxIndex=-1;},
        onPrevious:()=>navPublicLightbox(-1),
        onNext:()=>navPublicLightbox(1)
      });
    }
    return lb;
  }

  function openPublicLightbox(idx,trigger=null){
    ensurePublicLightbox();
    publicLightboxIndex=idx;
    updatePublicLightboxContent();
    publicPhotoViewer?.open(trigger);
  }
  function closePublicLightbox(){
    if(publicPhotoViewer)publicPhotoViewer.close();
    else {const lb=$('#publicPhotosLightbox');if(lb){lb.classList.remove('open');lb.setAttribute('aria-hidden','true');}}
    publicLightboxIndex=-1;
  }
  function navPublicLightbox(delta){
    const photos=window.NexoraPhotos?window.NexoraPhotos.listTeamPhotos(state,photosSelectedTeam):[];
    if(!photos.length)return;
    publicLightboxIndex=(publicLightboxIndex+delta+photos.length)%photos.length;
    updatePublicLightboxContent();
  }
  function updatePublicLightboxContent(){
    const Photos=window.NexoraPhotos;
    const photos=Photos?Photos.listTeamPhotos(state,photosSelectedTeam):[];
    const p=photos[publicLightboxIndex];
    if(!p)return closePublicLightbox();
    ensurePublicLightbox();
    const dimension=p.width&&p.height?`${p.width}×${p.height} · `:'';
    publicPhotoViewer?.setContent({
      preview:p.thumbUrl||p.url,
      large:p.largeUrl||p.originalUrl||p.url,
      alt:p.altText||p.title||p.name,
      name:p.title||p.name,
      counter:`${publicLightboxIndex+1} / ${photos.length} · ${dimension}${formatPhotoBytes(p.originalSize||p.size)}`,
      downloadUrl:Photos.originalDownloadUrl(p),
      downloadName:p.originalName||p.name
    });
  }
  function formatPhotoBytes(bytes){
    const value=Number(bytes)||0;
    if(value<1024)return value+' B';
    if(value<1024*1024)return Math.round(value/1024)+' KB';
    return (value/1024/1024).toFixed(2)+' MB';
  }

  // Click su pillole + apertura foto + click change retrocompatibile
  document.addEventListener('click', e => {
    if(e.target.closest('[data-photo-download]')) return;
    const pill = e.target.closest('[data-photos-team]');
    if(pill){
      photosSelectedTeam = pill.dataset.photosTeam;
      renderPhotos();
      return;
    }
    const opener = e.target.closest('[data-public-photo-open]');
    if(opener){
      const idx = Number(opener.dataset.publicPhotoOpen);
      if(!Number.isNaN(idx)) openPublicLightbox(idx,opener);
      return;
    }
  });


  document.addEventListener('keydown', e => {
    if(e.key!=='Enter'&&e.key!==' ')return;
    const opener=e.target.closest?.('[data-public-photo-open]');
    if(!opener||e.target!==opener)return;
    e.preventDefault();
    const idx=Number(opener.dataset.publicPhotoOpen);
    if(!Number.isNaN(idx))openPublicLightbox(idx,opener);
  });

  document.addEventListener('change', e => {
    if(e.target?.id === 'publicPhotosTeamFilter'){
      photosSelectedTeam = e.target.value;
      renderPhotos();
    }
  });

  // Click "Scarica tutte" → ZIP via NexoraPhotos con UX progress
  document.addEventListener('click', async e => {
    if(e.target?.closest?.('#publicPhotosDownloadAllBtn')){
      const btn = $('#publicPhotosDownloadAllBtn');
      const team = (state.teams||[]).find(t=>t.id===photosSelectedTeam);
      if(!team || !window.NexoraPhotos) return;
      const busy = window.NGInteractive;
      if(busy?.isButtonBusy(btn)) return;
      if(busy) busy.setButtonBusy(btn,true,'Preparazione ZIP…');
      else btn.disabled = true;
      try{
        await window.NexoraPhotos.downloadAllAsZip(state, team.id, team.name);
        if(busy){
          busy.setButtonBusyLabel(btn,'Scaricato',false,'success');
          setTimeout(()=>busy.setButtonBusy(btn,false),2000);
        }else btn.disabled = false;
      }catch(err){
        const message=window.NexoraPhotos?.userMessage?.(err)||err?.message||'Download ZIP non riuscito.';
        if(busy){
          busy.setButtonBusyLabel(btn,'Errore',false,'error');
          setTimeout(()=>busy.setButtonBusy(btn,false),3000);
        }else btn.disabled=false;
        const status=$('#publicPhotosStatus')||document.createElement('div');
        if(!status.id){status.id='publicPhotosStatus';status.setAttribute('aria-live','polite');$('#publicPhotosGrid')?.before(status);}
        status.innerHTML=`<div class="message error">${UI.esc(message)}</div>`;
      }
    }
  });

  function setRgb(doc,method,c){doc[method](c[0],c[1],c[2]);}
  function slug(v){return String(v||'scheda-squadra').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'scheda-squadra';}
  async function dataUrlFromImage(src){
    if(!src) return '';
    if(String(src).startsWith('data:')) return src;
    return new Promise(resolve=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{try{const canvas=document.createElement('canvas');const max=768;const ratio=Math.min(1,max/Math.max(img.width,img.height));canvas.width=Math.max(1,Math.round(img.width*ratio));canvas.height=Math.max(1,Math.round(img.height*ratio));const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/png'));}catch(_){resolve('');}};
      img.onerror=()=>resolve(''); img.src=src;
    });
  }
  function drawPdfLogo(doc,src,x,y,size,fallback='NG'){
    if(src){try{doc.addImage(src,'PNG',x,y,size,size,undefined,'FAST');return;}catch(_){}}
    setRgb(doc,'setFillColor',PDF_COLORS.gold);doc.roundedRect(x,y,size,size,5,5,'F');setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(Math.max(8,size*.28));doc.text(String(fallback||'NG').slice(0,2).toUpperCase(),x+size/2,y+size*.6,{align:'center'});
  }
  function addTeamPdfFooter(doc){
    const pages=doc.internal.getNumberOfPages();
    for(let i=1;i<=pages;i++){doc.setPage(i);const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.setLineWidth(.25);doc.line(14,h-13,w-14,h-13);setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(`Pagina ${i}/${pages}`,w-14,h-8,{align:'right'});doc.text('Scheda squadra · report pubblico ufficiale',14,h-8);}
  }
  function standingsRowsForState(s){
    const opts={includeLive:true};
    if(store.selectors.officialStandings)return store.selectors.officialStandings(s,opts);
    if(store.selectors.hasGroupStage&&store.selectors.hasGroupStage(s)&&store.selectors.groupedStandings){
      return store.selectors.groupedStandings(s,opts).flatMap(g=>g.rows||[]);
    }
    return store.selectors.calculateStandings(s,undefined,opts);
  }
  function teamPhaseData(s,teamId){
    if(store.selectors.teamPhaseStats)return store.selectors.teamPhaseStats(s,teamId,{includeLive:true});
    const rows=standingsRowsForState(s);
    const official=rows.find(r=>r.teamId===teamId)||{played:0,points:0,goalsFor:0,goalsAgainst:0,diff:0,wins:0,draws:0,losses:0};
    return {official,total:official,rows:[]};
  }
  function teamStatsForPdf(s,teamId){
    return teamPhaseData(s,teamId).total||{played:0,points:0,goalsFor:0,goalsAgainst:0,diff:0,wins:0,draws:0,losses:0};
  }
  function teamPhaseDataForReport(s,teamId){
    if(store.selectors.teamPhaseStats)return store.selectors.teamPhaseStats(s,teamId);
    return teamPhaseData(s,teamId);
  }
  function teamPlayerStatsRows(s,team){
    const statsMap=new Map((store.selectors.playerStats(s)||[]).filter(p=>p.teamId===team.id).map(p=>[p.playerId,p]));
    return [...(team.players||[])].map(player=>{
      const st=statsMap.get(player.id)||{};
      return {
        id:player.id,
        number:player.number!==''&&player.number!=null?String(player.number):'',
        name:player.name||'Calciatore',
        birthYear:player.birthYear||'-',
        played:Number(st.played||0),
        goals:Number(st.goals||0),
        yellow:Number(st.yellow||0),
        red:Number(st.red||0)
      };
    }).sort((a,b)=>b.goals-a.goals||b.played-a.played||a.red-b.red||a.yellow-b.yellow||String(a.number||'999').localeCompare(String(b.number||'999'),undefined,{numeric:true})||a.name.localeCompare(b.name,'it'));
  }
  function teamLeaders(rows){
    const firstBy=(fn)=>rows.length?rows.slice().sort(fn)[0]:null;
    return {
      topScorer:firstBy((a,b)=>b.goals-a.goals||b.played-a.played||a.name.localeCompare(b.name,'it')),
      mostUsed:firstBy((a,b)=>b.played-a.played||b.goals-a.goals||a.name.localeCompare(b.name,'it')),
      mostBooked:firstBy((a,b)=>(b.yellow+b.red*2)-(a.yellow+a.red*2)||b.played-a.played||a.name.localeCompare(b.name,'it')),
      cleanest:firstBy((a,b)=>(a.yellow+a.red*2)-(b.yellow+b.red*2)||b.played-a.played||a.name.localeCompare(b.name,'it')),
    };
  }
  function teamResultsSummary(teamId){
    const matches=matchesForTeam(state,teamId).filter(m=>store.hasScore(state,m));
    return matches.reduce((acc,m)=>{const winner=store.winnerId?store.winnerId(state,m):''; if(winner===teamId)acc.wins+=1; else if(!winner)acc.draws+=1; else acc.losses+=1; return acc;},{wins:0,draws:0,losses:0});
  }
  function matchesForTeam(s,teamId){
    return (s.matches||[]).filter(m=>m.homeTeamId===teamId||m.awayTeamId===teamId).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.time||'').localeCompare(String(b.time||''))||((a.roundIndex||0)-(b.roundIndex||0)));
  }
  function phaseStatsTable(stats){
    const rows=(stats.rows||[]).map(r=>`<tr><td><strong>${UI.esc(r.label)}</strong>${r.live?`<small class="team-phase-live">${r.live} live</small>`:''}</td><td>${r.rankable?UI.esc(String(r.points||0)):'—'}</td><td>${r.played||0}</td><td>${r.wins||0}</td><td>${r.draws||0}</td><td>${r.losses||0}</td><td>${r.goalsFor||0}</td><td>${r.goalsAgainst||0}</td><td>${(r.diff||0)>0?'+':''}${r.diff||0}</td></tr>`).join('');
    if(!rows)return '<div class="empty small">Nessuna statistica di fase disponibile.</div>';
    return `<div class="team-phase-table-wrap"><table class="team-phase-table"><thead><tr><th>Fase</th><th>Pt</th><th>PG</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th>DR</th></tr></thead><tbody>${rows}</tbody></table><p class="muted small">I punti sono mostrati solo per fasi con classifica; playoff, eliminazione diretta e Supercoppa restano separati.</p></div>`;
  }
  async function downloadTeamPdf(teamId){
    const team=store.getTeam(state,teamId); if(!team) return;
    if(!window.jspdf||!window.jspdf.jsPDF){alert('Librerie PDF non disponibili. Controlla la connessione e riprova.');return;}
    const {jsPDF}=window.jspdf; const doc=new jsPDF({orientation:'p',unit:'mm',format:'a4',compress:true});
    const brandLogo=await dataUrlFromImage(BRAND_LOGO); const teamLogo=await dataUrlFromImage(team.logo);
    const w=doc.internal.pageSize.getWidth();
    // v126.9: header editoriale bianco. Niente più sfondo scuro.
    setRgb(doc,'setFillColor',[255,255,255]);doc.rect(0,0,w,32,'F');
    if(brandLogo){ try { doc.addImage(brandLogo,'PNG',14,7,18,18,undefined,'FAST'); } catch(_){} }
    setRgb(doc,'setTextColor',PDF_COLORS.gold);doc.setFont('helvetica','bold');doc.setFontSize(7);
    doc.text('NEW GENERATION · SCHEDA SQUADRA',35,11);
    setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(13);
    doc.text(String(state.rules?.name||'New Generation'),35,18,{maxWidth:w-70});
    setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7);
    doc.text(`Generato ${today()}`,w-14,18,{align:'right'});
    setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.setLineWidth(0.5);doc.line(14,32,w-14,32);
    setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.setLineWidth(0.18);doc.line(14,32.9,w-14,32.9);
    setRgb(doc,'setFillColor',PDF_COLORS.paper);doc.roundedRect(12,55,w-24,46,8,8,'F');drawPdfLogo(doc,teamLogo,20,63,28,team.name);
    setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(21);doc.text(String(team.name||'Squadra'),55,74,{maxWidth:w-70});
    doc.setFont('helvetica','normal');doc.setFontSize(9);setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.text(`Presidente: ${team.president?.name||'Non inserito'}  ·  Allenatore: ${team.coach?.name||'Non inserito'}`,55,83,{maxWidth:w-70});
    doc.setFontSize(8.2);doc.text('Scheda squadra in stile report calcistico: focus su andamento, leader individuali, roster e calendario.',55,89.2,{maxWidth:w-70});
    const phaseData=teamPhaseDataForReport(state,teamId);
    const st=phaseData.total||teamStatsForPdf(state,teamId);
    const official=phaseData.official||{};
    const playerRows=teamPlayerStatsRows(state,team);
    const leaders=teamLeaders(playerRows);
    const formSummary=teamResultsSummary(teamId);
    const chips=[
      ['Pt classifica',official.points||0],
      ['PG torneo',st.played||0],
      ['GF torneo',st.goalsFor||0],
      ['GS torneo',st.goalsAgainst||0],
      ['Roster',playerRows.length||0],
      ['Record',`${formSummary.wins}-${formSummary.draws}-${formSummary.losses}`]
    ];
    chips.forEach((c,i)=>{const x=14+(i%3)*62,y=108+Math.floor(i/3)*20;setRgb(doc,'setFillColor',[255,248,226]);setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.roundedRect(x,y,56,16,4,4,'FD');setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFontSize(6.8);doc.text(c[0],x+28,y+5,{align:'center'});setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(String(c[1]),x+28,y+11.7,{align:'center'});});
    if(doc.autoTable){
      const phaseRows=(phaseData.rows||[]).map(r=>[r.label,r.rankable?String(r.points||0):'-',String(r.played||0),String(r.wins||0),String(r.draws||0),String(r.losses||0),String(r.goalsFor||0),String(r.goalsAgainst||0),`${(r.diff||0)>0?'+':''}${r.diff||0}`]);
      setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(11.5);doc.text('Statistiche per fase',14,154);
      setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text('Le partite live non incidono sul PDF finché il referto non viene chiuso.',14,158.5,{maxWidth:w-28});
      doc.autoTable({startY:162,head:[['Fase','Pt','PG','V','N','P','GF','GS','DR']],body:phaseRows.length?phaseRows:[['Nessuna fase disputata','-','-','-','-','-','-','-','-']],styles:{font:'helvetica',fontSize:7.1,cellPadding:2,textColor:PDF_COLORS.ink,lineColor:PDF_COLORS.line,lineWidth:.1},headStyles:{fillColor:PDF_COLORS.ink,textColor:PDF_COLORS.gold2,fontStyle:'bold'},alternateRowStyles:{fillColor:[255,249,231]},columnStyles:{0:{cellWidth:58,fontStyle:'bold'},1:{halign:'center'},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'},5:{halign:'center'},6:{halign:'center'},7:{halign:'center'},8:{halign:'center'}}});
      let y=(doc.lastAutoTable?.finalY||162)+9; if(y>208){doc.addPage();y=20;}
      const leaderRows=[
        ['Capocannoniere',leaders.topScorer?leaders.topScorer.name:'Nessuno',leaders.topScorer?`${leaders.topScorer.goals} gol · PG ${leaders.topScorer.played}`:'-'],
        ['Più presente',leaders.mostUsed?leaders.mostUsed.name:'Nessuno',leaders.mostUsed?`PG ${leaders.mostUsed.played} · ${leaders.mostUsed.goals} gol`:'-'],
        ['Più sanzionato',leaders.mostBooked?leaders.mostBooked.name:'Nessuno',leaders.mostBooked?`Gialli ${leaders.mostBooked.yellow} · Rossi ${leaders.mostBooked.red}`:'-'],
        ['Fair play',leaders.cleanest?leaders.cleanest.name:'Nessuno',leaders.cleanest?`Gialli ${leaders.cleanest.yellow} · Rossi ${leaders.cleanest.red}`:'-']
      ];
      doc.autoTable({startY:y,head:[['Focus roster','Nome','Dato chiave']],body:leaderRows,styles:{font:'helvetica',fontSize:8,cellPadding:2.4,textColor:PDF_COLORS.ink,lineColor:PDF_COLORS.line,lineWidth:.1},headStyles:{fillColor:PDF_COLORS.ink,textColor:PDF_COLORS.gold2,fontStyle:'bold'},alternateRowStyles:{fillColor:[255,249,231]},columnStyles:{0:{cellWidth:38,fontStyle:'bold'},1:{cellWidth:62,fontStyle:'bold'},2:{cellWidth:78}}});
      y=(doc.lastAutoTable?.finalY||y)+8; if(y>198){doc.addPage();y=20;}
      const rosterRows=playerRows.map(p=>[p.number||'—',p.name,p.birthYear||'-',String(p.played),String(p.goals),String(p.yellow),String(p.red)]);
      doc.autoTable({startY:y,head:[['#','Calciatore','Anno','PG','Gol','Gialli','Rossi']],body:rosterRows.length?rosterRows:[['-','Roster non inserito','-','-','-','-','-']],styles:{font:'helvetica',fontSize:7.8,cellPadding:2.2,textColor:PDF_COLORS.ink,lineColor:PDF_COLORS.line,lineWidth:.1},headStyles:{fillColor:PDF_COLORS.ink,textColor:PDF_COLORS.gold2,fontStyle:'bold'},alternateRowStyles:{fillColor:[255,249,231]},columnStyles:{0:{cellWidth:14,halign:'center',fontStyle:'bold'},1:{cellWidth:70,fontStyle:'bold'},2:{cellWidth:22,halign:'center'},3:{cellWidth:16,halign:'center'},4:{cellWidth:18,halign:'center',fontStyle:'bold'},5:{cellWidth:15,halign:'center'},6:{cellWidth:15,halign:'center'}}});
      y=(doc.lastAutoTable?.finalY||y)+8; if(y>195){doc.addPage();y=20;}
      const matches=matchesForTeam(state,teamId).map(m=>{const isHome=m.homeTeamId===teamId;const other=store.teamName(state,isHome?m.awayTeamId:m.homeTeamId,isHome?m.awayLabel:m.homeLabel);return {phase:m.bracketName||store.PHASE_LABELS[m.phase]||m.phase,round:m.round||'-',where:isHome?'Casa':'Trasferta',opponent:other,date:UI.fmtDate(m),field:m.field||'Campo da definire',score:store.hasScore(state,m)?store.scoreText(state,m):'Da giocare'};});
      doc.autoTable({startY:y,head:[['Fase / turno','Avversaria','Data','Campo','Risultato']],body:matches.length?matches.map(m=>[`${m.phase} · ${m.round} · ${m.where}`,m.opponent,m.date,m.field,m.score]):[['Nessuna partita disponibile','-','-','-','-']],styles:{font:'helvetica',fontSize:7.4,cellPadding:2.2,textColor:PDF_COLORS.ink,lineColor:PDF_COLORS.line,lineWidth:.1},headStyles:{fillColor:PDF_COLORS.ink,textColor:PDF_COLORS.gold2,fontStyle:'bold'},alternateRowStyles:{fillColor:[255,249,231]},columnStyles:{0:{cellWidth:56},1:{cellWidth:45,fontStyle:'bold'},2:{cellWidth:35},3:{cellWidth:32},4:{cellWidth:25,halign:'center',fontStyle:'bold'}}});
    }
    addTeamPdfFooter(doc); doc.save(`${slug(state.rules?.name)}-${slug(team.name)}-scheda-squadra.pdf`);
  }


  let lastTeamTrigger=null;
  function teamRecord(teamId){
    const data=teamPhaseData(state,teamId);
    return data.official||{played:0,points:0,goalsFor:0,goalsAgainst:0,diff:0};
  }
  function teamLastMatches(teamId){
    const live=(state.matches||[]).filter(m=>(m.homeTeamId===teamId||m.awayTeamId===teamId)&&m.status==='live');
    const played=(state.matches||[]).filter(m=>(m.homeTeamId===teamId||m.awayTeamId===teamId)&&store.hasScore(state,m)).slice(-5).reverse();
    // Mostra prima le live, poi le giocate, max 5 totale (le live hanno priorità di visualizzazione)
    return [...live, ...played].slice(0, Math.max(5, live.length));
  }
  function ensureTeamModal(){
    let modal=$('#teamModal');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.className='modal team-modal';
    modal.id='teamModal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','teamModalTitle');
    modal.innerHTML=`<div class="modal-content team-modal-content"><div class="team-modal-toolbar"><div><span class="article-kicker">Scheda squadra</span><h2 id="teamModalTitle">Squadra</h2></div><button class="btn danger" id="closeTeamModal" type="button">Chiudi</button></div><div id="teamModalBody"></div></div>`;
    document.body.appendChild(modal);
    return modal;
  }
  function closeTeamModal(){const modal=$('#teamModal');if(!modal)return;modal.classList.remove('open');}
  function teamDetailMarkup(team){
    const phaseData=teamPhaseData(state,team.id);
    const rec=phaseData.official||teamRecord(team.id);
    const total=phaseData.total||rec;
    const playerRows=teamPlayerStatsRows(state,team);
    const leaders=teamLeaders(playerRows);
    const president=store.selectors.presidentStats(state).find(p=>p.teamId===team.id);
    const rosterRows=playerRows.map(p=>`<tr><td><span class="jersey-number small ${p.number?'':'empty'}">${p.number||'—'}</span></td><td><strong>${UI.esc(p.name)}</strong><small>${UI.esc(p.birthYear||'-')}</small></td><td>${p.played}</td><td><strong>${p.goals}</strong></td><td>${p.yellow}</td><td>${p.red}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">Roster non inserito</td></tr>';
    const leaderCards=[
      {label:'Capocannoniere',name:leaders.topScorer?.name||'Nessuno',meta:leaders.topScorer?`${leaders.topScorer.goals} gol · PG ${leaders.topScorer.played}`:'Nessun dato'},
      {label:'Più presente',name:leaders.mostUsed?.name||'Nessuno',meta:leaders.mostUsed?`PG ${leaders.mostUsed.played} · Gol ${leaders.mostUsed.goals}`:'Nessun dato'},
      {label:'Più sanzionato',name:leaders.mostBooked?.name||'Nessuno',meta:leaders.mostBooked?`🟨 ${leaders.mostBooked.yellow} · 🟥 ${leaders.mostBooked.red}`:'Nessun dato'},
      {label:'Fair play',name:leaders.cleanest?.name||'Nessuno',meta:leaders.cleanest?`🟨 ${leaders.cleanest.yellow} · 🟥 ${leaders.cleanest.red}`:'Nessun dato'}
    ];
    const form=teamLastMatches(team.id).map(m=>{
      const isHome=m.homeTeamId===team.id;
      const opp=store.teamName(state,isHome?m.awayTeamId:m.homeTeamId,isHome?m.awayLabel:m.homeLabel);
      const isLiveM=m.status==='live';
      const scoreCell=isLiveM ? `<em class="team-form-live">🔴 LIVE ${store.matchGoals(state,m).home}-${store.matchGoals(state,m).away}</em>` : `<em>${UI.esc(store.scoreText(state,m))}</em>`;
      return `<div class="team-form-row ${isLiveM?'is-live-row':''}"><span>${UI.esc(m.round||'Turno')}</span><strong>${UI.esc(opp)}</strong>${scoreCell}</div>`;
    }).join('')||'<div class="empty small">Nessuna partita disputata.</div>';
    return `<section class="pro-team-sheet report-team-sheet-upgrade">
      <div class="pro-team-hero">
        <div class="pro-team-logo">${UI.logo(team,true)}</div>
        <div class="pro-team-title"><span class="pill">${total.played?`Totale torneo · PG ${total.played}`:'Scheda squadra'}</span><h2>${UI.esc(team.name)}</h2><p>${team.president?.name?`Presidente: ${UI.esc(team.president.name)}`:'Presidente non inserito'}${team.coach?.name?` · Allenatore: ${UI.esc(team.coach.name)}`:''}</p><div class="favorite-hero-action">${favoriteButton(team.id,'Segui')}</div></div>
      </div>
      <div class="team-sheet-kpis">
        <div><strong>${rec.points||0}</strong><span>Punti classifica</span></div><div><strong>${total.played||0}</strong><span>PG totali</span></div><div><strong>${total.goalsFor||0}</strong><span>GF totali</span></div><div><strong>${total.goalsAgainst||0}</strong><span>GS totali</span></div><div><strong>${(total.diff||0)>0?'+':''}${total.diff||0}</strong><span>DR totale</span></div><div><strong>${playerRows.length||0}</strong><span>Giocatori in rosa</span></div>
      </div>
      <div class="team-sheet-grid">
        <section class="team-sheet-panel team-phase-panel"><h3>Statistiche per fase</h3>${phaseStatsTable(phaseData)}</section>
        <section class="team-sheet-panel"><h3>Composizione tecnica</h3><div class="staff-cards"><div><span>Presidente</span><strong>${team.president?.name?UI.esc(team.president.name):'Non inserito'}</strong><small>${president?`PG ${president.played} · Gol ${president.goals}`:'Stats non disponibili'}</small></div><div><span>Allenatore</span><strong>${team.coach?.name?UI.esc(team.coach.name):'Non inserito'}</strong><small>Ruolo tecnico</small></div></div></section>
        <section class="team-sheet-panel"><h3>Focus giocatori</h3><div class="team-leader-grid">${leaderCards.map(card=>`<article class="team-leader-card"><span>${UI.esc(card.label)}</span><strong>${UI.esc(card.name)}</strong><small>${UI.esc(card.meta)}</small></article>`).join('')}</div></section>
        <section class="team-sheet-panel"><h3>Ultime partite</h3>${form}</section>
        <section class="team-sheet-panel roster-panel team-roster-panel-full"><h3>Roster e statistiche</h3><div class="team-roster-table-wrap"><table class="team-roster-table"><thead><tr><th>#</th><th>Calciatore</th><th>PG</th><th>Gol</th><th>🟨</th><th>🟥</th></tr></thead><tbody>${rosterRows}</tbody></table><p class="muted small">Statistiche giocatori in stile portale calcistico: presenze, gol e disciplina per ogni atleta della rosa.</p></div></section>
      </div>
      <div class="row-actions margin-top"><button class="btn primary" data-team-pdf="${UI.esc(team.id)}" type="button">Scarica scheda PDF</button></div>
    </section>`;
  }

  function showTeamDetail(teamId,trigger=null){
    const team=store.getTeam(state,teamId);if(!team)return;
    lastTeamTrigger=trigger;
    const modal=ensureTeamModal();
    $('#teamModalTitle').textContent=team.name;
    {const html=teamDetailMarkup(team);setHtmlStable('#teamModalBody',html);_lastTeamModalHtml=html;}
    modal.classList.add('open');
  }

  function renderSearch(){const q=($('#globalSearch').value||'').trim().toLowerCase();const box=$('#searchResults');if(!q){setHtmlStable(box,'<div class="empty">Scrivi per cercare squadre, giocatori o partite.</div>');return;}const teams=state.teams.filter(t=>t.name.toLowerCase().includes(q)).map(t=>`<div class="team-row search-team-result" data-team-id="${UI.esc(t.id)}">${UI.logo(t)}<div><strong>${UI.esc(t.name)}</strong><p class="muted">${t.players.length} calciatori${t.president?.name?` · Presidente: ${UI.esc(t.president.name)}`:''}${t.coach?.name?` · Allenatore: ${UI.esc(t.coach.name)}`:''}</p></div><div class="row-actions">${favoriteButton(t.id,'Segui')}<button class="btn small" data-team-detail="${UI.esc(t.id)}" type="button">Scheda</button><button class="btn small primary" data-team-pdf="${UI.esc(t.id)}" type="button">PDF</button></div></div>`);const stats=store.selectors.playerStats(state);const players=stats.filter(p=>p.name.toLowerCase().includes(q)||p.teamName.toLowerCase().includes(q)).map(p=>`<div class="player-row"><div><strong>${UI.esc(p.name)}</strong><p class="muted">${UI.esc(p.teamName)}${p.birthYear?' · '+UI.esc(p.birthYear):''}</p></div><span class="pill">PG ${p.played} · Gol ${p.goals} · 🟨 ${p.yellow} · 🟥 ${p.red}</span></div>`);const presidents=state.rules.isKingsLeague?store.selectors.presidentStats(state).filter(p=>p.name.toLowerCase().includes(q)||p.teamName.toLowerCase().includes(q)).map(p=>`<div class="player-row"><div><strong>Pres. ${UI.esc(p.name)}</strong><p class="muted">${UI.esc(p.teamName)}</p></div><span class="pill">PG ${p.played} · Gol ${p.goals}</span></div>`):[];const matches=state.matches.filter(m=>`${store.teamName(state,m.homeTeamId,m.homeLabel)} ${store.teamName(state,m.awayTeamId,m.awayLabel)} ${m.round} ${m.referee} ${m.field}`.toLowerCase().includes(q)).map(m=>UI.matchCard(state,m,true));const articles=store.selectors.articles(state).filter(a=>`${a.title} ${a.body}`.toLowerCase().includes(q)).map(a=>UI.articleCard(a,false));setHtmlStable(box,[...teams,...players,...presidents,...matches,...articles].join('')||`<div class="empty">Nessun risultato per “${UI.esc(q)}”.</div>`);decorateFavoriteUI();}
  function matchDetailEventList(items,emptyLabel){
    if(!items.length)return `<div class="public-match-empty">${UI.esc(emptyLabel)}</div>`;
    return items.map(item=>`<div class="public-match-event-item"><span class="event-dot ${UI.esc(item.kind||'')}">${UI.esc(item.icon||'•')}</span><div><strong>${UI.esc(item.name)}</strong>${item.meta?`<small>${UI.esc(item.meta)}</small>`:''}</div></div>`).join('');
  }
  function shareMatchText(m){
    const home=store.teamName(state,m.homeTeamId,m.homeLabel), away=store.teamName(state,m.awayTeamId,m.awayLabel);
    const played=isMatchPlayed(m), sc=store.matchGoals(state,m);
    return `${home} vs ${away}${played?` · ${sc.home}-${sc.away}`:''} · ${UI.fmtDate(m)} · ${m.field||'Campo da definire'}`;
  }
  function getTeamLogoImage(team){return new Promise(resolve=>{if(!team?.logo){resolve(null);return;}const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=team.logo;});}
  function roundRectPath(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();}
  function drawTextFit(ctx,text,x,y,maxWidth,fontSize=42,weight='900',align='center',color='#fff'){ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;let size=fontSize;do{ctx.font=`${weight} ${size}px Arial, sans-serif`;if(ctx.measureText(text).width<=maxWidth||size<=18)break;size-=2;}while(size>18);ctx.fillText(text,x,y,maxWidth);}
  async function buildMatchShareImage(m){
    const homeT=store.getTeam(state,m.homeTeamId),awayT=store.getTeam(state,m.awayTeamId);
    const home=store.teamName(state,m.homeTeamId,m.homeLabel),away=store.teamName(state,m.awayTeamId,m.awayLabel);
    const played=isMatchPlayed(m),score=store.matchGoals(state,m);
    const W=1600,H=1000;
    const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
    ctx.textBaseline='alphabetic';
    const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#070806');bg.addColorStop(.58,'#17190f');bg.addColorStop(1,'#090a07');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    ctx.fillStyle='rgba(230,199,96,.06)';ctx.fillRect(0,0,W,160);
    roundRectPath(ctx,64,64,W-128,H-128,44);ctx.fillStyle='rgba(255,255,255,.035)';ctx.fill();ctx.strokeStyle='rgba(230,199,96,.72)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#e6c760';ctx.font='900 34px Arial, sans-serif';ctx.textAlign='left';ctx.fillText('NEW GENERATION',112,132);
    ctx.textAlign='right';ctx.font='800 30px Arial, sans-serif';ctx.fillText(UI.fmtDate(m),W-112,132);
    const contextLine=`${store.PHASE_LABELS[m.phase]||m.phase||'Partita'}${m.groupName?' · '+m.groupName:''}${m.round?' · '+m.round:''}`.replace(/\s+/g,' ').trim();
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='900 42px Arial, sans-serif';ctx.fillText(contextLine,W/2,210,W-240);
    const homeLogo=await getTeamLogoImage(homeT),awayLogo=await getTeamLogoImage(awayT);
    function drawLogo(img,x,y,name){
      roundRectPath(ctx,x-76,y-76,152,152,30);ctx.fillStyle='rgba(255,255,255,.07)';ctx.fill();ctx.strokeStyle='rgba(255,255,255,.10)';ctx.lineWidth=1.5;ctx.stroke();
      if(img){ctx.save();roundRectPath(ctx,x-64,y-64,128,128,24);ctx.clip();ctx.drawImage(img,x-64,y-64,128,128);ctx.restore();}
      else{ctx.fillStyle='#e6c760';ctx.font='900 42px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(name||'?').slice(0,2).toUpperCase(),x,y);ctx.textBaseline='alphabetic';}
    }
    drawLogo(homeLogo,300,375,home);drawLogo(awayLogo,1300,375,away);
    drawTextFit(ctx,home,300,535,430,62,'900');drawTextFit(ctx,away,1300,535,430,62,'900');
    roundRectPath(ctx,650,300,300,190,34);ctx.fillStyle='rgba(0,0,0,.36)';ctx.fill();ctx.strokeStyle='rgba(230,199,96,.66)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle=played?'#7ff0bc':'#ff4c55';ctx.font='900 26px Arial';ctx.textAlign='center';ctx.fillText(played?'GIOCATA':'DA GIOCARE',800,345);
    ctx.fillStyle='#fff';ctx.font='950 82px Arial';ctx.fillText(played?`${score.home} - ${score.away}`:'VS',800,430);
    const meta=[['CAMPO',m.field||'Da definire'],['ARBITRO',m.referee||'Da definire'],['DATA',UI.fmtDate(m)]];
    meta.forEach((it,i)=>{const x=130+i*450;roundRectPath(ctx,x,650,390,104,22);ctx.fillStyle='rgba(0,0,0,.42)';ctx.fill();ctx.strokeStyle='rgba(255,255,255,.10)';ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#e6c760';ctx.font='900 19px Arial';ctx.textAlign='left';ctx.fillText(it[0],x+28,690);ctx.fillStyle='#fff';ctx.font='850 28px Arial';ctx.fillText(it[1],x+28,725,330);});
    const goals=(m.goals||[]).map(g=>store.goalEventLabel?store.goalEventLabel(state,m,g):store.playerName(state,g.playerId)).filter(Boolean).slice(0,10).join(' · ')||'Nessun marcatore';
    roundRectPath(ctx,130,810,W-260,94,22);ctx.fillStyle='rgba(0,0,0,.34)';ctx.fill();ctx.strokeStyle='rgba(255,255,255,.10)';ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle='#e6c760';ctx.font='900 20px Arial';ctx.textAlign='left';ctx.fillText('MARCATORI',160,848);ctx.fillStyle='#fff';ctx.font='850 28px Arial';ctx.fillText(goals,160,884,W-320);
    return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob),'image/png',.98));
  }
  async function shareMatchImage(m,btn){
    const busy=window.NGInteractive;
    if(btn && busy?.isButtonBusy(btn)) return;
    if(btn){
      if(busy) busy.setButtonBusy(btn,true,'Preparo immagine…');
      else btn.disabled=true;
    }
    try{
      const blob=await buildMatchShareImage(m); if(!blob)throw new Error('Immagine non generata');
      const file=new File([blob],`new-generation-${m.id||'partita'}.png`,{type:'image/png'});
      if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file]});}
      else{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1200);}
    }catch(err){alert('Condivisione immagine non disponibile su questo dispositivo: ho scaricato la card partita.');try{const blob=await buildMatchShareImage(m);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`new-generation-${m.id||'partita'}.png`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1200);}catch(_){} }
    finally{if(btn){if(busy)busy.setButtonBusy(btn,false);else btn.disabled=false;}}
  }
  function publicMatchDetailMarkup(m){
    const homeT=store.getTeam(state,m.homeTeamId), awayT=store.getTeam(state,m.awayTeamId);
    const home=store.teamName(state,m.homeTeamId,m.homeLabel), away=store.teamName(state,m.awayTeamId,m.awayLabel);
    const score=store.matchGoals(state,m);
    const isLive=m.status==='live';
    const played=store.hasScore(state,m)||m.status==='played';
    const showScore=played||isLive||(store.hasGoals&&store.hasGoals(state,m));
    const homeGoals=[], awayGoals=[], yellow=[], red=[];
    (m.goals||[]).forEach(g=>{const own=store.isOwnGoalEvent&&store.isOwnGoalEvent(g);const row={icon:own?'↩️':'⚽',kind:own?'own-goal':'goal',name:store.goalEventLabel?store.goalEventLabel(state,m,g):store.playerName(state,g.playerId),meta:own?'Autogol':(Number(g.weight)===2?'Gol doppio Kings League':'')};const teamId=store.goalScoringTeamId?store.goalScoringTeamId(state,m,g):(store.getParticipant(state,g.playerId)?.team?.id);if(teamId===m.homeTeamId)homeGoals.push(row);else if(teamId===m.awayTeamId)awayGoals.push(row);else homeGoals.push(row);});
    (m.cards||[]).forEach(c=>{const row={icon:c.type==='red'?'■':'■',kind:c.type==='red'?'red':'yellow',name:store.playerName(state,c.playerId),meta:c.type==='red'?'Espulsione':'Ammonizione'};(c.type==='red'?red:yellow).push(row);});
    const status=store.matchStatusInfo?store.matchStatusInfo(state,m):(played?{label:'Giocata',cls:'is-played'}:{label:'Da giocare',cls:'is-pending'});
    // Compone una sottostringa pulita per la pill, evitando duplicati di "Girone X" tra
    // groupName e round (i round dei match di girone includono già il nome del girone).
    const phaseLabel=store.PHASE_LABELS[m.phase]||m.phase;
    const groupName=m.groupName||'';
    let round=m.round||'';
    if(groupName && round.includes(groupName)){
      // Es. round = "Girone B - Giornata 1", groupName = "Girone B" → tengo solo "Giornata 1"
      round = round.replace(groupName,'').replace(/^[\s·:\-–—]+/,'').replace(/[\s·:\-–—]+$/,'').trim();
    }
    const subtitle=[UI.esc(phaseLabel),UI.esc(groupName),UI.esc(round)].filter(Boolean).join(' · ');
    const centerCls=isLive?'is-live':(played?'is-played':'is-pending');
    // Rigori
    let pBlock='';
    if(showScore&&score.home===score.away&&store.isKnockoutPhase&&store.isKnockoutPhase(m)&&m.penalties){
      const p=store.normalizePenalties?store.normalizePenalties(m.penalties):m.penalties;
      if(p){
        const winner=p.home>p.away?home:(p.away>p.home?away:'');
        pBlock=`<div class="public-penalty-block">
          <div class="public-penalty-head"><span>Rigori</span><strong>${p.home} - ${p.away}</strong></div>
          ${winner?`<div class="public-penalty-winner">🏆 ${UI.esc(winner)} qualificata ai rigori</div>`:''}
        </div>`;
      }
    }
    return `<article class="public-match-detail-card ${isLive?'is-live-card':''}">
      <section class="public-match-hero">
        <div class="public-match-hero-top">
          <span class="pill">${subtitle||'Partita'}</span>
          <span class="score-badge match-status-badge ${status.cls}" role="status">${isLive?'🔴 ':''}${UI.esc(status.label)}</span>
        </div>
        <div class="public-scoreboard">
          <div class="public-score-team public-score-home">${UI.logo(homeT,false)}<strong>${UI.esc(home)}</strong></div>
          <div class="public-score-center ${centerCls}"><span>${showScore?score.home:'-'}</span><em aria-hidden="true">${showScore?'-':'vs'}</em><span>${showScore?score.away:'-'}</span></div>
          <div class="public-score-team public-score-away">${UI.logo(awayT,false)}<strong>${UI.esc(away)}</strong></div>
        </div>
        ${pBlock}
        <div class="public-match-meta-grid">
          <span><small>Data e ora</small><strong>${UI.esc(UI.fmtDate(m))}</strong></span>
          <span><small>Campo</small><strong>${UI.esc(m.field||'Da definire')}</strong></span>
          <span><small>Arbitro</small><strong>${UI.esc(m.referee||'Da definire')}</strong></span>
        </div>
      </section>
      <section class="public-match-panels">
        <div class="public-match-panel"><div class="panel-title"><span>⚽</span><h3>Marcatori ${UI.esc(home)}</h3></div>${matchDetailEventList(homeGoals,'Nessun marcatore')}</div>
        <div class="public-match-panel"><div class="panel-title"><span>⚽</span><h3>Marcatori ${UI.esc(away)}</h3></div>${matchDetailEventList(awayGoals,'Nessun marcatore')}</div>
        <div class="public-match-panel"><div class="panel-title"><span>🟨</span><h3>Cartellini gialli</h3></div>${matchDetailEventList(yellow,'Nessun ammonito')}</div>
        <div class="public-match-panel"><div class="panel-title"><span>🟥</span><h3>Cartellini rossi</h3></div>${matchDetailEventList(red,'Nessun espulso')}</div>
      </section>
      ${isLive
        ? '<div class="public-match-actions"><small class="muted live-share-note">⛔ La condivisione immagine sarà disponibile a partita conclusa.</small></div>'
        : `<div class="public-match-actions"><button class="btn primary" type="button" data-share-match="${UI.esc(m.id)}">Condividi immagine</button></div>`}
    </article>`;
  }
  function showMatch(id){const m=state.matches.find(x=>x.id===id);if(!m)return;{const html=publicMatchDetailMarkup(m);setHtmlStable('#matchModalBody',html);_lastMatchModalHtml=html;}const modal=$('#matchModal');modal.classList.add('public-match-modal');modal.classList.add('open');}
  let lastArticleTrigger=null;
  function ensureHeadMeta(selector,attributes){
    let node=document.head.querySelector(selector);
    if(!node){node=document.createElement(attributes.tag||'meta');Object.entries(attributes).forEach(([key,value])=>{if(key!=='tag')node.setAttribute(key,value);});document.head.appendChild(node);}
    return node;
  }
  function updateArticleHead(article=null){
    if(!article){document.title=baseDocumentTitle;return;}
    const title=article.seoTitle||article.title||'Articolo';
    const description=article.seoDescription||article.excerpt||String(article.body||'').replace(/\s+/g,' ').slice(0,180);
    document.title=`${title} · ${UI.siteTitle(state)}`;
    ensureHeadMeta('meta[name="description"]',{name:'description'}).setAttribute('content',description);
    ensureHeadMeta('meta[property="og:title"]',{property:'og:title'}).setAttribute('content',title);
    ensureHeadMeta('meta[property="og:description"]',{property:'og:description'}).setAttribute('content',description);
    ensureHeadMeta('meta[property="og:type"]',{property:'og:type'}).setAttribute('content','article');
    if(article.socialImage||article.image)ensureHeadMeta('meta[property="og:image"]',{property:'og:image'}).setAttribute('content',article.socialImage||article.image);
  }
  function ensureArticleModal(){
    let modal=$('#articleModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.className='modal article-modal';
    modal.id='articleModal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','articleModalTitle');
    modal.innerHTML=`<div class="modal-content article-modal-content"><div class="article-modal-toolbar"><div><span class="article-kicker">Magazine</span><h2 id="articleModalTitle">Articolo</h2></div><div class="row-actions"><button class="btn" id="copyArticleLink" type="button">Copia link</button><button class="btn danger article-modal-close" id="closeArticleModal" type="button">Chiudi</button></div></div><div id="articleModalBody"></div></div>`;
    document.body.appendChild(modal);
    return modal;
  }
  function articlePublicUrl(article){
    const base=String(location.href||'').split('#')[0];
    return `${base}#article=${encodeURIComponent(article.slug||article.id)}`;
  }
  function closeArticleModal({updateHistory=true,restoreScroll=true}={}){
    const modal=$('#articleModal');
    if(!modal)return;
    modal.classList.remove('open');
    openArticleId='';lastArticleHtml='';updateArticleHead(null);
    if(updateHistory){
      try{history.pushState({tab:'articles'},'','#articles');}catch(_){location.hash='articles';}
    }
    const target=lastArticleTrigger;lastArticleTrigger=null;
    requestAnimationFrame(()=>{
      if(target&&document.contains(target))target.focus?.({preventScroll:true});
      if(restoreScroll)window.scrollTo({top:articleListScrollY,behavior:'auto'});
    });
  }
  function showArticle(value,trigger=null,{updateHistory=true,restoreScroll=true}={}){
    const article=store.selectors.articleById(state,value);
    const modal=ensureArticleModal();
    if(!article){
      openArticleId='';lastArticleHtml='';
      $('#articleModalTitle').textContent='Articolo non disponibile';
      setHtmlStable('#articleModalBody','<div class="empty article-unavailable"><strong>Articolo non disponibile</strong><span>Potrebbe essere stato rimosso, non ancora pubblicato o l’indirizzo potrebbe essere errato.</span></div>');
      modal.classList.add('open');updateArticleHead(null);return false;
    }
    if(!openArticleId){articleListScrollY=window.scrollY;if(trigger)lastArticleTrigger=trigger;}
    openArticleId=article.id;
    const html=UI.articleDetail(article);
    if(html!==lastArticleHtml){setHtmlStable('#articleModalBody',html);lastArticleHtml=html;}
    const articleBody=$('#articleModalBody');
    UI.prepareArticleDetail?.(articleBody,{onBack:()=>closeArticleModal()});
    $('#articleModalTitle').textContent=article.title||'Articolo';
    modal.classList.add('open');
    updateArticleHead(article);
    if(updateHistory){
      const next=`#article=${encodeURIComponent(article.slug||article.id)}`;
      if(location.hash!==next){try{history.pushState({tab:'articles',article:article.id},'',next);}catch(_){location.hash=next;}}
    }
    return true;
  }
  function resetFiltersForNewState(){
    if(phaseFilter && !store.selectors.phases(state).includes(phaseFilter)) phaseFilter='';
    if(statusFilter==='favorite' && (!favoriteTeamId||!store.getTeam(state,favoriteTeamId))) statusFilter='';
    if(roundFilter && !store.selectors.rounds(state).includes(roundFilter)) roundFilter='';
    if(teamFilter && !state.teams.some(t=>t.id===teamFilter)) teamFilter='';
    if(playerTeamFilter && !state.teams.some(t=>t.id===playerTeamFilter)) playerTeamFilter='';
    if(standingsGroup !== 'all' && !store.selectors.groupNames(state).includes(standingsGroup)) standingsGroup='all';
  }
  // -----------------------------------------------------------------------
  // Notifiche pop-up per partite live: appaiono in alto a destra solo quando
  // il PUNTEGGIO di una partita live cambia. Spariscono dopo 10s.
  // -----------------------------------------------------------------------
  const liveScoreSnapshot = new Map(); // matchId -> "home-away"
  let _liveNotifContainer = null;
  function ensureLiveNotifContainer(){
    if(_liveNotifContainer && document.body.contains(_liveNotifContainer)) return _liveNotifContainer;
    _liveNotifContainer = document.createElement('div');
    _liveNotifContainer.id = 'ngLiveNotifContainer';
    _liveNotifContainer.className = 'ng-live-notif-container';
    _liveNotifContainer.setAttribute('aria-live', 'polite');
    _liveNotifContainer.setAttribute('aria-label', 'Notifiche partite live');
    document.body.appendChild(_liveNotifContainer);
    return _liveNotifContainer;
  }
  function showLiveNotification(m, prevScore, newScore){
    // Se l'utente è già nella tab Home, il banner "Partite in corso" è visibile e si
    // aggiorna in tempo reale: la notifica pop-up sarebbe ridondante e confusionaria.
    if(activePublicTab()==='home') return;
    const container = ensureLiveNotifContainer();
    const home = store.teamName(state, m.homeTeamId, m.homeLabel);
    const away = store.teamName(state, m.awayTeamId, m.awayLabel);
    const homeT = store.getTeam(state, m.homeTeamId);
    const awayT = store.getTeam(state, m.awayTeamId);
    // Indico chi ha segnato in base a quale colonna è salita
    let scorerLabel = '';
    if(newScore.home > prevScore.home) scorerLabel = `⚽ ${home}`;
    else if(newScore.away > prevScore.away) scorerLabel = `⚽ ${away}`;
    else scorerLabel = '⚽ Aggiornamento risultato';

    // Se esiste già una notifica per QUESTO match, la sostituisco (no duplicati visibili).
    container.querySelectorAll(`.ng-live-notif[data-match-id="${UI.esc(m.id)}"]`).forEach(el=>el.remove());

    const notif = document.createElement('article');
    notif.className = 'ng-live-notif';
    notif.setAttribute('role', 'status');
    notif.dataset.matchId = m.id;
    notif.innerHTML = `
      <button class="ng-live-notif-close" type="button" aria-label="Chiudi notifica">×</button>
      <div class="ng-live-notif-head">
        <span class="ng-live-notif-badge">🔴 LIVE</span>
        <span class="ng-live-notif-scorer">${UI.esc(scorerLabel)}</span>
      </div>
      <div class="ng-live-notif-body">
        <div class="ng-live-notif-team">${UI.logo(homeT,false)}<strong>${UI.esc(home)}</strong></div>
        <div class="ng-live-notif-score">${newScore.home} - ${newScore.away}</div>
        <div class="ng-live-notif-team">${UI.logo(awayT,false)}<strong>${UI.esc(away)}</strong></div>
      </div>
      <div class="ng-live-notif-hint">Tocca per aprire il dettaglio partita</div>
    `;
    container.appendChild(notif);

    // Anima ingresso
    requestAnimationFrame(()=> notif.classList.add('is-in'));

    const dismiss = () => {
      notif.classList.remove('is-in');
      notif.classList.add('is-out');
      setTimeout(()=> notif.remove(), 320);
    };
    // Rimozione immediata senza animazione (es. quando si apre il modale per evitare sovrapposizione visiva)
    const dismissNow = () => {
      notif.classList.remove('is-in');
      notif.classList.add('is-out');
      // remove subito, senza setTimeout: evita sfarfallio quando si apre il modale
      if(notif.parentNode) notif.parentNode.removeChild(notif);
    };
    let autoTimer = setTimeout(dismiss, 10000);

    notif.addEventListener('click', e => {
      // Click sulla X: chiude SOLO la notifica, lascia tutto il resto com'è
      if(e.target.closest('.ng-live-notif-close')){
        e.stopPropagation();
        clearTimeout(autoTimer);
        dismiss();
        return;
      }
      // Click sul corpo: apro la schermata dedicata del match.
      // La notifica viene rimossa SUBITO (no animazione) per evitare sfarfallio mentre il modale appare.
      clearTimeout(autoTimer);
      dismissNow();
      showMatch(m.id);
    });

    // Se la notifica si trova ad esistere quando il modale già è aperto sullo stesso match,
    // la nascondo subito (sarebbe ridondante - l'utente sta già guardando i dettagli).
    if(openMatchModalId === m.id){
      clearTimeout(autoTimer);
      dismissNow();
    }
  }
  function detectLiveScoreChanges(newState){
    // Trovo i match attualmente live nel nuovo state e confronto con lo snapshot precedente.
    // Notifico SOLO se il punteggio è cambiato (per evitare spam su altre modifiche, es. cambio campo/arbitro).
    const newLiveByMatch = new Map();
    (newState.matches||[]).forEach(m => {
      if(m.status==='live' && m.homeTeamId && m.awayTeamId){
        newLiveByMatch.set(m.id, store.matchGoals(newState, m));
      }
    });
    newLiveByMatch.forEach((sc, matchId) => {
      const key = `${sc.home}-${sc.away}`;
      const prevKey = liveScoreSnapshot.get(matchId);
      if(prevKey === undefined){
        // Prima volta che vedo questa partita live: registro senza notificare
        // (evita notifica al primo caricamento o quando una partita inizia ora)
        liveScoreSnapshot.set(matchId, key);
        return;
      }
      if(prevKey !== key){
        // Punteggio cambiato!
        const prev = (()=>{const [h,a]=prevKey.split('-'); return {home:Number(h)||0, away:Number(a)||0};})();
        const m = newState.matches.find(x=>x.id===matchId);
        if(m) showLiveNotification(m, prev, sc);
        liveScoreSnapshot.set(matchId, key);
      }
    });
    // Pulisco snapshot di match che non sono più live
    for(const id of Array.from(liveScoreSnapshot.keys())){
      if(!newLiveByMatch.has(id)) liveScoreSnapshot.delete(id);
    }
  }

  let _lastRenderedStateSig='';
  function publicStateSignature(s){
    try{
      const media={
        site:s.site||{},
        teams:(s.teams||[]).map(t=>({id:t.id,logo:t.logo||''})),
        articles:(s.articles||[]).map(a=>({id:a.id,title:a.title,updatedAt:a.updatedAt||a.createdAt||'',image:a.image||''})),
        photos:(s.photos||[]).map(p=>({id:p.id,teamId:p.teamId,url:p.url||p.secure_url||'',publicId:p.publicId||p.public_id||'',updatedAt:p.updatedAt||p.createdAt||''}))
      };
      // v126.6 sync-fix: deriveFingerprint omette date/time/field/referee
      // perché non incidono su classifiche/selettori memoizzati. Però sono
      // proprio i campi che l'admin modifica più spesso ("Arbitri: Da
      // definire", riprogrammazione campo/orario). Li includo qui nel
      // signature di render così l'utente vede subito le modifiche senza
      // dover ricaricare la pagina, mantenendo intatta la memoization.
      const matchMeta=(s.matches||[]).map(m=>({id:m.id,date:m.date||'',time:m.time||'',field:m.field||'',referee:m.referee||''}));
      return `${store.deriveFingerprint?store.deriveFingerprint(s):''}|${JSON.stringify(media)}|${JSON.stringify(matchMeta)}`;
    }catch(_){return String(Date.now())+Math.random();}
  }
  function markRenderedState(){_lastRenderedStateSig=publicStateSignature(state);}
  function isRedundantIncoming(incoming){return publicStateSignature(incoming)===_lastRenderedStateSig;}

  function render(opts={}){
    // skipAlign=true quando lo state arriva già normalizzato (es. da Supabase via publishPublicState)
    if(!opts.skipAlign) store.alignState(state);
    try{UI.applySiteTheme(state);}catch(e){}
    // v126.11: aggiorna lo <style id="ngTeamLogos"> con i data-URL dei loghi.
    // Una sola volta per render (no più ripetizione del data-URL per ogni
    // occorrenza nelle card). Internamente bailout se invariato.
    try{UI.injectTeamLogoStyles && UI.injectTeamLogoStyles(state);}catch(e){}
    updateAppViewportVars();
    sanitizeFavoriteTeam();
    // Differisco il save() su localStorage al prossimo idle (no block del thread).
    deferredSave();
    resetFiltersForNewState();
    persistPublicFilters();
    markRenderedState();
    // v126.8: render della SOLA sezione attiva anche su desktop (prima
    // si rifacevano tutte 8 le sezioni a ogni broadcast). Le sezioni
    // non attive sono visualmente nascoste (display:none + content-visibility),
    // e verranno renderizzate dal listener ng:tab-changed quando l'utente
    // le aprirà. opts.initial / opts.fullRender mantengono il render
    // completo (boot iniziale, import dati, reset).
    if(opts.initial || opts.fullRender){
      renderAllSections();
    } else {
      renderTabSection(activePublicTab());
    }
  }
  let _saveTimer=null;
  function deferredSave(){
    if(_saveTimer) return;
    const schedule = window.requestIdleCallback || function(cb){return setTimeout(cb,1);};
    _saveTimer = schedule(()=>{_saveTimer=null; save();}, {timeout: 300});
  }
  // Debounce dei render in arrivo da eventi realtime (burst protection)
  let _renderRafId = null;
  let _renderPending = null;
  function scheduleRender(opts={}){
    _renderPending = Object.assign({}, _renderPending||{}, opts);
    if(_renderRafId) return;
    const run=()=>{
      const o = _renderPending || {};
      _renderRafId = null; _renderPending = null;
      render(o);
    };
    // Su mobile accumulo brevemente gli update realtime per evitare micro-sfarfallii.
    if(isMobileAppView()) _renderRafId = setTimeout(()=>requestAnimationFrame(run), 70);
    else _renderRafId = requestAnimationFrame(run);
  }
  const publicImport=$('#publicImport'); if(publicImport) publicImport.addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const json=JSON.parse(await file.text());state=store.normalizeState(json);save();phaseFilter='';roundFilter='';teamFilter='';statusFilter='';playerTeamFilter='';standingsGroup='all';articleSearch='';articleCategory='all';persistPublicFilters();render({fullRender:true});alert('Dati pubblici importati correttamente.');}catch(err){alert('File JSON non valido.');}});
  document.addEventListener('ng:tab-changed',e=>{const tab=e.detail?.tab;if(PUBLIC_TABS.has(tab)&&!e.detail?.restored)safeSessionSet(PUBLIC_ACTIVE_TAB_KEY,tab); if(PUBLIC_TABS.has(tab)) requestAnimationFrame(()=>renderTabSection(tab));});
  $('#publicPhaseFilter').addEventListener('change',e=>{phaseFilter=e.target.value;persistPublicFilters();renderMatches();});$('#publicRoundFilter').addEventListener('change',e=>{roundFilter=e.target.value;persistPublicFilters();renderMatches();});$('#publicTeamFilter').addEventListener('change',e=>{teamFilter=e.target.value;persistPublicFilters();renderMatches();});$('#publicPlayerTeamFilter')?.addEventListener('change',e=>{playerTeamFilter=e.target.value;persistPublicFilters();renderPlayers();});document.addEventListener('change',e=>{if(e.target.id==='publicGroupStandingsFilter'){standingsGroup=e.target.value||'all';persistPublicFilters();renderHome();}});$('#globalSearch').addEventListener('input',()=>{persistPublicFilters();renderSearch();});
  $('#publicArticleSearch')?.addEventListener('input',event=>{articleSearch=event.currentTarget.value.slice(0,120);persistPublicFilters();clearTimeout(articleSearchTimer);articleSearchTimer=setTimeout(renderArticles,120);});
  $('#publicArticleCategory')?.addEventListener('change',event=>{articleCategory=event.currentTarget.value||'all';persistPublicFilters();renderArticles();});
  $('#clearArticleFilters')?.addEventListener('click',()=>{articleSearch='';articleCategory='all';persistPublicFilters();renderArticles();$('#publicArticleSearch')?.focus();});
  document.addEventListener('click',async e=>{const filterOpener=e.target.closest('[data-open-match-filter]');if(filterOpener){e.preventDefault();openMatchFilterSheet(filterOpener.dataset.openMatchFilter);return;}const filterChoice=e.target.closest('[data-filter-type]');if(filterChoice){e.preventDefault();setMatchFilter(filterChoice.dataset.filterType,filterChoice.dataset.filterValue||'');return;}if(e.target.closest('[data-close-match-filter]')){e.preventDefault();closeMatchFilterSheet();return;}if(e.target.id==='matchFilterSheet'){e.preventDefault();e.stopPropagation();closeMatchFilterSheet();return;}if(e.target.closest('[data-clear-match-filters]')){e.preventDefault();phaseFilter='';roundFilter='';teamFilter='';statusFilter='';persistPublicFilters();renderMatches();return;}const presetBtn=e.target.closest('[data-match-preset]');if(presetBtn){e.preventDefault();statusFilter=presetBtn.dataset.matchPreset==='all'?'':presetBtn.dataset.matchPreset;persistPublicFilters();renderMatches();return;}const shareBtn=e.target.closest('[data-share-match]');if(shareBtn){e.preventDefault();const m=state.matches.find(x=>x.id===shareBtn.dataset.shareMatch);if(m){if(m.status==='live'){alert('La condivisione immagine è disponibile solo per partite concluse.');return;}await shareMatchImage(m,shareBtn);}return;}const favBtn=e.target.closest('[data-favorite-team]');if(favBtn){e.preventDefault();e.stopPropagation();const id=favBtn.dataset.favoriteTeam;if(isFavoriteTeam(id))clearFavoriteTeam();else setFavoriteTeam(id);return;}if(e.target.closest('[data-clear-favorite]')){e.preventDefault();clearFavoriteTeam();return;}if(e.target.closest('[data-open-teams-tab]')){e.preventDefault();document.querySelector('[data-tab="teams"]')?.click();return;}const favMatchBtn=e.target.closest('[data-filter-favorite-matches]');if(favMatchBtn){e.preventDefault();teamFilter=favMatchBtn.dataset.filterFavoriteMatches||favoriteTeamId;persistPublicFilters();document.querySelector('[data-tab="matches"]')?.click();renderMatches();return;}const teamTarget=e.target.closest('[data-team-detail]');if(teamTarget){e.preventDefault();showTeamDetail(teamTarget.dataset.teamDetail,teamTarget);return;}const pdfBtn=e.target.closest('[data-team-pdf]');if(pdfBtn){const busy=window.NGInteractive;if(busy?.isButtonBusy(pdfBtn))return;if(busy)busy.setButtonBusy(pdfBtn,true,'Genero PDF…');else pdfBtn.disabled=true;try{await downloadTeamPdf(pdfBtn.dataset.teamPdf);}catch(err){alert('Errore PDF squadra: '+(err.message||err));}finally{if(busy)busy.setButtonBusy(pdfBtn,false);else pdfBtn.disabled=false;}return;}const copyArticle=e.target.closest('#copyArticleLink');if(copyArticle){e.preventDefault();const article=store.selectors.articleById(state,openArticleId);if(article){const url=articlePublicUrl(article);try{await navigator.clipboard.writeText(url);copyArticle.textContent='Link copiato';setTimeout(()=>{copyArticle.textContent='Copia link';},1600);}catch(_){window.prompt('Copia questo collegamento',url);}}return;}const articleTarget=e.target.closest('[data-article-open]');if(articleTarget && !e.target.closest('[data-edit-article],[data-delete-article]')){e.preventDefault();e.stopPropagation();showArticle(articleTarget.dataset.articleOpen||articleTarget.closest('[data-article-open]')?.dataset.articleOpen,articleTarget);return;}const card=e.target.closest('[data-match-detail]');if(card){e.preventDefault();showMatch(card.dataset.matchDetail);return;}if(e.target.id==='closeModal'){const mm=$('#matchModal');mm.classList.remove('open');mm.classList.remove('public-match-modal');}
  if(e.target.id==='matchModal'){e.preventDefault();e.stopPropagation();const mm=$('#matchModal');mm.classList.remove('open');mm.classList.remove('public-match-modal');}if(e.target.id==='closeArticleModal')closeArticleModal();
  if(e.target.id==='articleModal'){e.preventDefault();e.stopPropagation();closeArticleModal();}if(e.target.id==='closeTeamModal')closeTeamModal();
  if(e.target.id==='teamModal'){e.preventDefault();e.stopPropagation();closeTeamModal();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target?.matches?.('[data-team-detail]')){e.preventDefault();showTeamDetail(e.target.dataset.teamDetail,e.target);return;}if((e.key==='Enter'||e.key===' ')&&e.target?.matches?.('[data-article-open]:not(a)')){e.preventDefault();showArticle(e.target.dataset.articleOpen,e.target);return;}const matchTarget=e.target?.closest?.('[data-match-detail]');if((e.key==='Enter'||e.key===' ')&&matchTarget){e.preventDefault();showMatch(matchTarget.dataset.matchDetail);}});

  document.addEventListener('error',e=>{const img=e.target?.closest?.('img.article-image');if(img)UI.replaceBrokenArticleImage(img);},true);
  document.addEventListener('load',e=>{
    const img=e.target?.closest?.('img.article-image');
    if(!img)return;
    img.closest('.article-media')?.classList.add('image-ready');
    const detailFrame=img.closest('.article-detail-frame');
    if(detailFrame && img.naturalWidth && img.naturalHeight){
      detailFrame.style.setProperty('--article-natural-w', img.naturalWidth + 'px');
      detailFrame.style.setProperty('--article-natural-h', img.naturalHeight + 'px');
      detailFrame.classList.add('natural-size-ready');
    }
  },true);

  function setupMobileNavigation(){
    if(document.querySelector('.mobile-bottom-nav')) return;
    const labels={home:'Panoramica',teams:'Squadre',players:'Giocatori',matches:'Partite',bracket:'Tabellone',articles:'Articoli',photos:'Foto',search:'Cerca'};
    const icons={home:'⌂',teams:'◎',players:'♙',matches:'⬢',bracket:'▥',articles:'✦',photos:'📷',search:'⌕'};
    const mainTabs=['home','teams','matches','search'];
    const moreTabs=['players','bracket','articles','photos'];
    const nav=document.createElement('nav');
    nav.className='mobile-bottom-nav';
    nav.setAttribute('aria-label','Navigazione principale mobile');
    nav.innerHTML=mainTabs.map(tab=>`<button type="button" class="mobile-nav-item ${tab==='home'?'active':''}" data-tab="${tab}" aria-label="${labels[tab]}"><span class="mobile-nav-icon">${icons[tab]}</span><span>${labels[tab]}</span></button>`).join('')+
      `<button type="button" class="mobile-nav-item mobile-more-trigger" data-mobile-more="open" aria-label="Altre sezioni"><span class="mobile-nav-icon">☰</span><span>Altro</span></button>`;
    const sheet=document.createElement('div');
    sheet.className='mobile-nav-sheet';
    sheet.setAttribute('aria-hidden','true');
    sheet.innerHTML=`<div class="mobile-nav-backdrop" aria-hidden="true"></div><section class="mobile-nav-panel" role="dialog" aria-label="Altre sezioni"><div class="mobile-sheet-handle"></div><div class="mobile-sheet-head"><strong>Vai a</strong><button type="button" class="btn small" data-mobile-more="close">Chiudi</button></div><div class="mobile-sheet-grid">${moreTabs.map(tab=>`<button type="button" class="mobile-sheet-item" data-tab="${tab}"><span>${icons[tab]}</span><strong>${labels[tab]}</strong></button>`).join('')}</div></section>`;
    document.body.appendChild(nav);
    document.body.appendChild(sheet);
    function closeSheet(){sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true');}
    function openSheet(){sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');}
    document.addEventListener('click',e=>{
      const more=e.target.closest('[data-mobile-more]');
      if(more){more.dataset.mobileMore==='open'?openSheet():closeSheet();return;}
      if(e.target.closest('.mobile-sheet-item')){closeSheet();return;}
      if(e.target===sheet||e.target.closest('.mobile-nav-backdrop')) closeSheet();
    });
    document.addEventListener('ng:tab-changed',e=>{
      const tab=e.detail?.tab;
      document.querySelectorAll('.mobile-nav-item').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
      const moreActive=moreTabs.includes(tab);
      const moreBtn=document.querySelector('.mobile-more-trigger');
      if(moreBtn) moreBtn.classList.toggle('active',moreActive);
      closeSheet();
      if(window.matchMedia('(max-width:720px)').matches) window.scrollTo({top:0,behavior:'auto'});
    });
  }
  // Memorizza l'id del match/team del modale aperto, per ri-disegnarli alla ricezione di nuovi dati
  let openMatchModalId = '';
  let openTeamModalId = '';
  const _origShowMatch = showMatch;
  showMatch = function(id){ openMatchModalId = id; _origShowMatch(id); };
  const _origShowTeamDetail = showTeamDetail;
  showTeamDetail = function(teamId, trigger=null){ openTeamModalId = teamId; _origShowTeamDetail(teamId, trigger); };
  let _lastMatchModalHtml='', _lastTeamModalHtml='';
  function refreshOpenModals(){
    const matchModal=$('#matchModal');
    if(openMatchModalId && matchModal && matchModal.classList.contains('open')){
      const m=state.matches.find(x=>x.id===openMatchModalId);
      if(m){
        const html=publicMatchDetailMarkup(m);
        if(html!==_lastMatchModalHtml){setHtmlStable('#matchModalBody',html);_lastMatchModalHtml=html;}
      } else { matchModal.classList.remove('open'); matchModal.classList.remove('public-match-modal');  openMatchModalId=''; _lastMatchModalHtml=''; }
    } else if(!openMatchModalId){_lastMatchModalHtml='';}
    const teamModal=$('#teamModal');
    if(openTeamModalId && teamModal && teamModal.classList.contains('open')){
      const t=store.getTeam(state,openTeamModalId);
      if(t){
        const html=teamDetailMarkup(t);
        if(html!==_lastTeamModalHtml){setHtmlStable('#teamModalBody',html);_lastTeamModalHtml=html;}
      }
    } else if(!openTeamModalId){_lastTeamModalHtml='';}
    const articleModal=$('#articleModal');
    if(openArticleId&&articleModal&&articleModal.classList.contains('open')){
      const article=store.selectors.articleById(state,openArticleId);
      if(article){
        const html=UI.articleDetail(article);
        if(html!==lastArticleHtml){setHtmlStable('#articleModalBody',html);lastArticleHtml=html;}
        UI.prepareArticleDetail?.($('#articleModalBody'),{onBack:()=>closeArticleModal()});
        $('#articleModalTitle').textContent=article.title||'Articolo';
        updateArticleHead(article);
        const expected=`#article=${encodeURIComponent(article.slug||article.id)}`;
        if(location.hash!==expected){try{history.replaceState({tab:'articles',article:article.id},'',expected);}catch(_){}}
      }else{
        openArticleId='';lastArticleHtml='';
        $('#articleModalTitle').textContent='Articolo non disponibile';
        setHtmlStable('#articleModalBody','<div class="empty article-unavailable"><strong>Articolo non disponibile</strong><span>È stato rimosso o non è più pubblicato.</span></div>');
        updateArticleHead(null);
      }
    }
  }
  window.addEventListener('ng:cloudinary-photos-updated',()=>scheduleRender({skipAlign:true}));
  window.addEventListener('ng:public-state-updated',e=>{
    if(e.detail&&e.detail.state){
      // Lo state arrivato è già normalizzato (publishPublicState chiama normalizeState).
      // Salto alignState e debouncing del render.
      const incoming = e.detail.state;
      const source = e.detail.source || '';
      // v126.7: rimosso il gate globale isRedundantIncoming. Era la causa
      // di update "fantasma" quando admin puliva un Live: se anche un solo
      // campo (es. date/time/referee, ora coperti) usciva dalla firma globale,
      // l'update veniva scartato in toto. Ora lasciamo che il filtro avvenga
      // a livello di setHtmlStable per-sezione (che confronta l'HTML finale,
      // immune da gap dei campi). Più robusto: nessuna possibilità di update
      // perso. Le sezioni con HTML invariato bailano comunque in pochi µs.
      detectLiveScoreChanges(incoming);
      state = incoming;
      // Anche i broadcast realtime passano dal render schedulato: su mobile evita
      // ricostruzioni sincrone mentre l'utente sta toccando o scrollando.
      scheduleRender({skipAlign:true});
      refreshOpenModals();
    }
  });
  window.addEventListener('storage',e=>{
    if(e.key===store.PUBLIC_KEY&&e.newValue){
      try{
        const currentTab=activePublicTab();
        const parsed=JSON.parse(e.newValue);
        const incoming=store.normalizeState(store.mergeMissingMedia?store.mergeMissingMedia(parsed,state):parsed);
        // v126.7: rimosso anche qui il gate globale (vedi commento sopra).
        detectLiveScoreChanges(incoming);
        state=incoming;
        scheduleRender({skipAlign:true});
        setPublicTab(currentTab,{persist:true,scroll:false});
        refreshOpenModals();
      }catch(_){}
    }
  });
  // Pulizia variabili modale alla chiusura
  document.addEventListener('click',e=>{
    if(e.target.id==='closeModal'){openMatchModalId='';_lastMatchModalHtml='';}
    if(e.target.id==='closeTeamModal'){openTeamModalId='';_lastTeamModalHtml='';}
  });
  updateAppViewportVars();
  window.addEventListener('resize',()=>requestAnimationFrame(updateAppViewportVars),{passive:true});
  window.visualViewport?.addEventListener?.('resize',()=>requestAnimationFrame(updateAppViewportVars),{passive:true});
  UI.bindTabs();setupMobileNavigation();restorePublicFilters();restorePublicTab();
  // Inizializzo lo snapshot dei punteggi live PRIMA del primo render, così le partite
  // già in corso al boot non triggerano notifiche fasulle.
  detectLiveScoreChanges(state);
  window.NexoraPhotos?.refreshAll?.().catch(()=>{});
  render({initial:true});
  const initialArticleKey=articleKeyFromHash();if(initialArticleKey)requestAnimationFrame(()=>showArticle(initialArticleKey,null,{updateHistory:false,restoreScroll:false}));
})();
````

## `/mnt/data/ng-work/new-generation-main/assets/js/ui.js`

````javascript
(function(){
  const store=window.NexoraStore;
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  function initials(name){return String(name||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();}
  // v126.12 - Stemma squadra: rendering basato su classe CSS.
  // I data-URL restano centralizzati in UN solo <style id="ngTeamLogos">:
  // il markup delle card contiene soltanto la classe stabile della squadra.
  // Quando lo stemma esiste non viene montato alcun fallback sopra il
  // background-image; le iniziali sono usate solo per squadre senza stemma.
  function logo(team,big=false){
    const tid=esc(team?.id||'');
    const inits=esc(initials(team?.name));
    const safeName=esc(team?.name||'squadra non definita');
    const hasLogo=Boolean(team?.logo);
    const classes=['team-logo-wrap'];
    if(big) classes.push('big');
    if(hasLogo) classes.push(`ng-tl-${tid}`);
    const fallback=hasLogo?'':`<span class="team-logo-fallback${big?' big':''}" aria-hidden="true"><span>${inits}</span></span>`;
    return `<span class="${classes.join(' ')}" data-team-id="${tid}" role="img" aria-label="Stemma di ${safeName}">${fallback}</span>`;
  }

  // Inietta/aggiorna lo <style id="ngTeamLogos"> con tutte le regole
  // .ng-tl-{teamId} { background-image:url(<data-url>) }. Chiamata UNA volta
  // per stato (su render dello state). I data-URL base64 generati da
  // canvas.toDataURL non contengono mai parentesi o virgolette, quindi
  // possono finire dentro url(...) senza escape.
  function injectTeamLogoStyles(state){
    if(!state || !Array.isArray(state.teams)) return;
    let style=document.getElementById('ngTeamLogos');
    if(!style){
      style=document.createElement('style');
      style.id='ngTeamLogos';
      document.head.appendChild(style);
    }
    let css='';
    for(const t of state.teams){
      if(t && t.id && t.logo){
        // class name safe: gli id sono uid alfanumerici/underscore
        css+=`.ng-tl-${t.id}{background-image:url(${t.logo})}\n`;
      }
    }
    // Update solo se diverso (no innerHTML inutili)
    if(style.textContent!==css) style.textContent=css;
  }
  function fmtDate(m){if(m.date&&m.time)return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date(`${m.date}T${m.time}`)); if(m.date)return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium'}).format(new Date(`${m.date}T00:00`)); return 'Da definire';}
  function teamOptions(state,selected=''){return `<option value="">Seleziona squadra</option>`+state.teams.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${esc(t.name)}</option>`).join('');}
  function playerOptions(state,match,selected=''){const ids=[match.homeTeamId,match.awayTeamId];let html='<option value="">Seleziona calciatore</option>';ids.forEach(tid=>{const t=store.getTeam(state,tid);if(!t)return;html+=`<optgroup label="${esc(t.name)}">`+t.players.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}${p.birthYear?' · '+esc(p.birthYear):''}</option>`).join('')+'</optgroup>';});return html;}
  function statsGrid(stats){const goalsLabel=stats.scoreGoals&&stats.scoreGoals!==stats.goals?`Gol reali / punteggio: ${stats.scoreGoals}`:'Gol';return `<div class="stat"><strong>${stats.teams}</strong><span>Squadre</span></div><div class="stat"><strong>${stats.players}</strong><span>Giocatori</span></div><div class="stat"><strong>${stats.presidents||0}</strong><span>Presidenti</span></div><div class="stat"><strong>${stats.matches}</strong><span>Partite</span></div><div class="stat"><strong>${stats.goals}</strong><span>${goalsLabel}</span></div><div class="stat"><strong>${stats.yellow}</strong><span>Gialli</span></div><div class="stat"><strong>${stats.red}</strong><span>Rossi</span></div>`;}
  function standingsTable(rows,state=null){return `<table class="standings-table"><thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>PG</th><th>GF</th><th>GS</th><th>DR</th><th>CR</th></tr></thead><tbody>${rows.map((r,i)=>{const t=state?store.getTeam(state,r.teamId):null;const liveCls=r.hasLive?' is-live-row':'';const liveDot=r.hasLive?'<span class="standings-live-dot" title="Partita in corso" aria-label="Live"></span>':'';const clickable=t?` class="standings-team-row${liveCls}" data-team-id="${esc(t.id)}" data-team-detail="${esc(t.id)}" tabindex="0" role="button" aria-label="Apri scheda ${esc(t.name)}"`:` class="${liveCls.trim()}"`;return `<tr${clickable}><td><span class="rank">${i+1}</span></td><td><div class="team-inline">${logo(t,false)}<strong>${esc(r.name)}</strong>${liveDot}</div></td><td><strong>${r.points}</strong></td><td>${r.played}</td><td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.diff>0?'+':''}${r.diff}</td><td>${Number(r.cards)||0}</td></tr>`}).join('')||'<tr><td colspan="8">Nessuna squadra.</td></tr>'}</tbody></table>`;}
  function groupStandingsSelector(state,selected='',id='groupStandingsFilter'){const groups=store.selectors.groupNames(state);if(!groups.length)return '';return `<div class="filters compact-filters group-standings-menu"><div><label>Classifica girone</label><select id="${esc(id)}"><option value="all" ${selected==='all'?'selected':''}>Tutti i gironi</option>${groups.map(g=>`<option value="${esc(g)}" ${g===selected?'selected':''}>${esc(g)}</option>`).join('')}</select></div></div>`;}
  function groupStandingsTables(state,selected='all',opts){const groups=store.selectors.groupedStandings(state,opts);if(!groups.length)return standingsTable(store.selectors.calculateStandings(state,undefined,opts),state);const visible=selected&&selected!=='all'?groups.filter(g=>g.name===selected):groups;return visible.map(g=>`<div class="group-standing-block"><div class="mini-section-title"><h3>${esc(g.name)}</h3><span class="pill">${g.completed?'Girone completato':'In corso'}</span></div>${standingsTable(g.rows,state)}</div>`).join('')||'<div class="empty">Nessun girone disponibile.</div>';}
  function playerStatsTable(rows){return `<table><thead><tr><th>Calciatore</th><th>Anno</th><th>Squadra</th><th>PG</th><th>Gol</th><th>Gialli</th><th>Rossi</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.birthYear||'-')}</td><td>${esc(r.teamName)}</td><td>${r.played}</td><td>${r.goals}</td><td>${r.yellow}</td><td>${r.red}</td></tr>`).join('')||'<tr><td colspan="7">Nessun giocatore.</td></tr>'}</tbody></table>`;}
  function presidentStatsTable(rows){return `<table><thead><tr><th>Presidente</th><th>Squadra</th><th>PG</th><th>Gol</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.teamName)}</td><td>${r.played}</td><td>${r.goals}</td></tr>`).join('')||'<tr><td colspan="4">Nessun gol presidente.</td></tr>'}</tbody></table>`;}
  function matchStatusMeta(state,m){
    if(store.matchStatusInfo)return store.matchStatusInfo(state,m);
    const played=store.hasScore(state,m)||m.status==='played';
    if(m.status==='live')return {key:'live',label:'Live',cls:'is-live'};
    return played?{label:'Giocata',cls:'is-played'}:{label:'Da giocare',cls:'is-pending'};
  }
  function matchCard(state,m,clickable=false){const homeT=store.getTeam(state,m.homeTeamId),awayT=store.getTeam(state,m.awayTeamId);const home=store.teamName(state,m.homeTeamId,m.homeLabel),away=store.teamName(state,m.awayTeamId,m.awayLabel);const goals=(m.goals||[]).map(g=>`${g.minute?`${g.minute}′ `:''}${store.goalEventLabel?store.goalEventLabel(state,m,g):store.playerName(state,g.playerId)}${(!(store.isOwnGoalEvent&&store.isOwnGoalEvent(g))&&Number(g.weight)===2)?' (x2)':''}`).join(', ');const yellow=(m.cards||[]).filter(c=>c.type==='yellow').map(c=>store.playerName(state,c.playerId)).join(', ');const red=(m.cards||[]).filter(c=>c.type==='red').map(c=>store.playerName(state,c.playerId)).join(', ');const status=matchStatusMeta(state,m);const isLive=m.status==='live';const played=store.hasScore(state,m)||m.status==='played';const showScore=played||isLive||(store.hasGoals&&store.hasGoals(state,m));const score=showScore?store.matchGoals(state,m):null;const centerCls=isLive?'is-live':(played?'is-played':'is-pending');
    // Rigori: visibili solo se KO + pareggio + penalties valide
    let pBadge='';
    if(showScore&&score&&score.home===score.away&&store.isKnockoutPhase&&store.isKnockoutPhase(m)&&m.penalties){
      const p=store.normalizePenalties?store.normalizePenalties(m.penalties):m.penalties;
      if(p)pBadge=`<div class="fixture-penalty-row"><span>d.c.r.</span><strong>${p.home} - ${p.away}</strong></div>`;
    }
    return `<article class="match-card public-fixture-card ${clickable?'clickable':''} ${isLive?'is-live-card':''}" ${clickable?`data-match-detail="${m.id}" role="button" tabindex="0" aria-label="Apri dettaglio ${esc(home)} contro ${esc(away)}"`:''}><div class="match-card-head"><span class="pill">${esc(store.PHASE_LABELS[m.phase]||m.phase)} · ${esc(m.round)}</span><span class="score-badge match-status-badge ${status.cls}" role="status" aria-label="Stato partita: ${esc(status.label)}">${isLive?'🔴 ':''}${esc(status.label)}</span></div><div class="fixture-scoreline"><div class="fixture-team home">${logo(homeT,false)}<strong>${esc(home)}</strong></div><div class="fixture-center ${centerCls}"><strong>${showScore?`${score.home} - ${score.away}`:'VS'}</strong></div><div class="fixture-team away">${logo(awayT,false)}<strong>${esc(away)}</strong></div></div>${pBadge}<div class="fixture-meta-row"><span>🗓️ ${fmtDate(m)}</span><span>📍 ${esc(m.field||'Campo da definire')}</span><span>👤 ${esc(m.referee||'Arbitro da definire')}</span></div><div class="fixture-events"><span>⚽ ${goals?esc(goals):'nessun marcatore'}</span><span>🟨 ${yellow?esc(yellow):'nessuno'}</span><span>🟥 ${red?esc(red):'nessuno'}</span></div></article>`;}
  function pauseCard(event){return `<article class="match-card pause-card"><div class="match-top"><span class="pill">Pausa torneo</span><span class="score-badge">${esc(event.duration)} min</span></div><div class="match-teams"><div class="team-inline"><div class="team-logo-fallback"><span></span></div><h3>${esc(event.label||'Pausa programmata')}</h3></div></div><p class="muted">${esc(event.date)} · ${esc(event.time)} · Nessuna partita programmata in questo intervallo.</p><div class="event-lines"><p>☕ <strong>Intervallo:</strong> pausa inserita automaticamente nel calendario del torneo giornaliero.</p></div></article>`;}
  function matchList(state,matches=state.matches,clickable=false){
    const list=[...(matches||[])];
    const pause=store.oneDayCalendarPauseEvent?store.oneDayCalendarPauseEvent(state.rules):null;
    const includePause=pause&&list.some(m=>m.date===pause.date)&&list.length===state.matches.length;
    const items=list.map(m=>({type:'match',date:m.date||'',time:m.time||'',match:m}));
    if(includePause)items.push({type:'pause',date:pause.date,time:pause.time,event:pause});
    items.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||(a.type==='pause'?-1:1));
    return items.length?items.map(item=>item.type==='pause'?pauseCard(item.event):matchCard(state,item.match,clickable)).join(''):'<div class="empty">Nessuna partita disponibile.</div>';
  }
  function teamGrid(state){
    if(!state.teams.length)return '<div class="empty">Nessuna squadra.</div>';
    return `<div class="team-disclosure-list">${state.teams.map((t,i)=>{
      const staff=[];
      if(t.president?.name)staff.push(`<span><strong>Presidente</strong>${esc(t.president.name)}</span>`);
      if(t.coach?.name)staff.push(`<span><strong>Allenatore</strong>${esc(t.coach.name)}</span>`);
      const players=(t.players||[]).map(p=>`<li><strong>${esc(p.name)}</strong>${p.birthYear?` <span>${esc(p.birthYear)}</span>`:''}</li>`).join('')||'<li class="muted">Roster vuoto</li>';
      return `<details class="ng-disclosure team-disclosure" data-team-id="${esc(t.id)}" ${i===0?'':''}>
        <summary class="ng-disclosure-summary">
          <span class="disclosure-main">${logo(t,false)}<span><strong>${esc(t.name)}</strong><small>${(t.players||[]).length} calciatori${t.president?.name?` · Presidente: ${esc(t.president.name)}`:''}</small></span></span>
          <span class="disclosure-actions"><button class="btn small favorite-team-btn" type="button" data-favorite-placeholder="${esc(t.id)}">☆ Segui</button><span class="disclosure-action">Apri scheda</span></span>
        </summary>
        <div class="ng-disclosure-body team-profile-body">
          <div class="team-profile-hero">${logo(t,true)}<div><h3>${esc(t.name)}</h3><p class="muted">Scheda squadra, staff tecnico e rosa completa.</p></div></div>
          <div class="team-profile-meta">${staff.join('')||'<span><strong>Staff</strong>Non inserito</span>'}</div>
          <div class="team-profile-section"><h4>Roster</h4><ul class="roster-clean-list">${players}</ul></div>
          <div class="row-actions"><button class="btn small primary" data-team-pdf="${esc(t.id)}" type="button">Scarica scheda PDF</button></div>
        </div>
      </details>`;
    }).join('')}</div>`;
  }
  function rulesSummary(state){const r=state.rules;const comps=(r.eliminationCompetitions||[]).map(c=>`${c.name}: ${c.startRank}ª-${c.startRank+c.teams-1}ª`).join(' · ');const fixed=store.groupFieldMap?store.groupFieldMap(r):null;const groupFieldText=fixed?Object.entries(fixed).map(([g,f])=>`${g} → Campo ${f}`).join(' · '):'';return `<div class="summary-grid"><span><strong>Torneo</strong>${esc(r.name)}</span><span><strong>Formato</strong>${esc(store.FORMAT_LABELS[r.format]||r.format)}</span><span><strong>Modalità</strong>${r.oneDay?'Tutto in un giorno':'Più giorni'}</span><span><strong>Campi</strong>${esc(r.fieldCount)}</span><span><strong>Date</strong>${r.oneDay?esc(r.startDate||'Da definire'):esc(`${r.startDate||'?'} → ${r.endDate||'?'}`)}</span>${groupFieldText?`<span><strong>Gironi sui campi</strong>${esc(groupFieldText)}</span>`:''}${r.format==='league_knockout'?`<span><strong>Competizioni KO</strong>${esc(comps||'Nessuna')}</span>`:''}</div>`;}

  function bracketMarkup(state, compact=false){
    const data=store.bracketData(state);
    if(!data.available)return `<div class="empty">${esc(data.message)}</div>`;
    function teamLabel(match,side){
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      const label=side==='home'?match.homeLabel:match.awayLabel;
      const t=store.getTeam(state,id);return `${logo(t,false)}<span>${esc(store.teamName(state,id,label||'Da definire'))}</span>`;
    }
    function teamText(match,side){
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      const label=side==='home'?match.homeLabel:match.awayLabel;
      return esc(store.teamName(state,id,label||'Da definire'));
    }
    function resultClass(match,side){
      const wid=store.winnerId(state,match);
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      return wid&&id===wid?'winner':'';
    }
    function penaltyBadge(m){
      const sc=store.matchGoals(state,m);
      if(sc.home!==sc.away||!m.penalties)return '';
      const p=store.normalizePenalties?store.normalizePenalties(m.penalties):m.penalties;
      if(!p)return '';
      return `<div class="bracket-penalty-row" title="Vittoria ai rigori"><span>d.c.r.</span><strong>${p.home}-${p.away}</strong></div>`;
    }
    function matchCompact(m){
      const score=store.matchGoals(state,m);
      const status=store.hasScore(state,m)||m.status==='played'?'Giocata':'Da giocare';
      const sc=store.hasScore(state,m)?`${score.home} - ${score.away}`:'-';
      const pBadge=penaltyBadge(m);
      return `<article class="bracket-list-match bracket-detail-trigger" data-match-detail="${esc(m.id)}" role="button" tabindex="0" aria-label="Apri dettaglio ${teamText(m,'home')} contro ${teamText(m,'away')}">
        <div class="bracket-list-meta"><span>${esc(m.round)}</span><strong>${sc}</strong></div>
        <div class="bracket-list-teams"><span class="${resultClass(m,'home')}">${teamText(m,'home')}</span><em>vs</em><span class="${resultClass(m,'away')}">${teamText(m,'away')}</span></div>
        ${pBadge}
        <div class="bracket-list-footer"><small>${esc(m.field||'Campo da definire')} · ${esc(fmtDate(m))}</small><span>${status}</span></div>
      </article>`;
    }
    return `<div class="bracket-wrapper ${compact?'compact':''}">${data.brackets.map(bracket=>`
      <section class="bracket-block">
        <div class="section-title compact"><div><h3>${esc(bracket.name)}</h3><p>${esc(data.message)}</p></div></div>
        <p class="mobile-only-note bracket-mobile-hint">Vista mobile ottimizzata: i turni sono impilati in elenco. Su desktop il tabellone resta a colonne.</p>
        <div class="bracket-scroll desktop-bracket-view"><div class="bracket-grid">
          ${bracket.rounds.map(round=>`
            <div class="bracket-round">
              <h4>${esc(round.name)}</h4>
              <div class="bracket-matches">
                ${round.matches.map(m=>`
                  <article class="bracket-match bracket-detail-trigger" data-match-detail="${esc(m.id)}" role="button" tabindex="0" aria-label="Apri dettaglio ${teamText(m,'home')} contro ${teamText(m,'away')}">
                    <div class="bracket-match-head"><span class="bracket-meta">${esc(m.round)}</span><span class="bracket-open-hint">Dettaglio</span></div>
                    <div class="bracket-team ${resultClass(m,'home')}">${teamLabel(m,'home')}<strong>${store.hasScore(state,m)?store.matchGoals(state,m).home:''}</strong></div>
                    <div class="bracket-team ${resultClass(m,'away')}">${teamLabel(m,'away')}<strong>${store.hasScore(state,m)?store.matchGoals(state,m).away:''}</strong></div>
                    ${penaltyBadge(m)}
                    <small>${esc(m.field||'Campo da definire')} · ${esc(fmtDate(m))}</small>
                  </article>`).join('')}
              </div>
            </div>`).join('')}
        </div></div>
        <div class="bracket-mobile-list mobile-bracket-view">
          ${bracket.rounds.map(round=>`<section class="bracket-list-round"><h4>${esc(round.name)}</h4>${round.matches.map(matchCompact).join('')}</section>`).join('')}
        </div>
      </section>`).join('')}</div>`;
  }


  function fmtArticleDate(value,{dateOnly=false}={}){
    if(!value)return '';
    const parsed=new Date(value);
    if(Number.isNaN(parsed.getTime()))return '';
    try{return new Intl.DateTimeFormat('it-IT',dateOnly?{dateStyle:'long'}:{dateStyle:'medium',timeStyle:'short'}).format(parsed);}catch(e){return '';}
  }
  function articleStatusLabel(status){
    return ({draft:'Bozza',scheduled:'Programmato',published:'Pubblicato'})[status]||'Pubblicato';
  }
  function articlePlaceholder(title='NG'){
    const label=initials(title||'NG')||'NG';
    return `<div class="article-image article-placeholder" role="img" aria-label="Immagine dell’articolo non disponibile"><span>${esc(label)}</span><small>NEWS</small></div>`;
  }
  function replaceBrokenArticleImage(img){
    const holder=document.createElement('div');
    holder.className='article-image article-placeholder';
    holder.setAttribute('role','img');
    holder.setAttribute('aria-label','Immagine dell’articolo non disponibile');
    const title=(img?.dataset?.articleTitle||img?.alt||'NG').replace(/^Immagine(?: principale)?(?: dell’articolo)?\s*/i,'').trim();
    const label=initials(title||'NG')||'NG';
    holder.innerHTML=`<span>${esc(label)}</span><small>NEWS</small>`;
    img?.closest('.article-media,.article-detail-media')?.classList.add('image-fallback');
    img?.replaceWith(holder);
  }
  function articleImageMarkup(article,{detail=false,eager=false}={}){
    const title=String(article?.title||'articolo');
    const src=String(article?.image||'').trim();
    if(!src)return detail?'':articlePlaceholder(title);
    const alt=String(article?.imageAlt||'').trim()||`Immagine principale dell’articolo ${title}`;
    return `<img class="article-image" src="${esc(src)}" alt="${esc(alt)}" data-article-title="${esc(title)}" width="1280" height="800" loading="${eager?'eager':'lazy'}" decoding="async"${eager?' fetchpriority="high"':''} referrerpolicy="no-referrer">`;
  }
  function articleExcerpt(article,max=220){
    const source=String(article?.excerpt||article?.subtitle||article?.body||'').replace(/\s+/g,' ').trim();
    if(!source)return '';
    if(source.length<=max)return source;
    return source.slice(0,max).replace(/\s+\S*$/,'').trim()+'…';
  }
  function safeArticleUrl(value,{image=false}={}){
    const url=String(value||'').trim();
    if(!url)return '';
    if(image&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(url))return url;
    if(/^(?:https?:\/\/|mailto:|\/|#)/i.test(url))return url;
    return '';
  }
  function articleInlineMarkup(value){
    const links=[];
    let text=String(value||'').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(all,label,url)=>{
      const safe=safeArticleUrl(url);
      if(!safe)return label;
      const token=`@@NGARTICLELINK${links.length}@@`;
      links.push(`<a href="${esc(safe)}"${/^https?:\/\//i.test(safe)?' target="_blank" rel="noopener noreferrer"':''}>${esc(label)}</a>`);
      return token;
    });
    let html=esc(text);
    html=html.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    html=html.replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>');
    links.forEach((link,index)=>{html=html.replace(`@@NGARTICLELINK${index}@@`,link);});
    return html;
  }
  function articleBodyMarkup(value){
    const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
    const out=[];
    let listType='',list=[];
    const flushList=()=>{if(!list.length)return;out.push(`<${listType}>${list.map(item=>`<li>${articleInlineMarkup(item)}</li>`).join('')}</${listType}>`);list=[];listType='';};
    for(const raw of lines){
      const line=raw.trim();
      if(!line){flushList();continue;}
      const image=line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
      if(image){
        flushList();
        const src=safeArticleUrl(image[2],{image:true});
        if(src)out.push(`<figure class="article-inline-figure"><img src="${esc(src)}" alt="${esc(image[1]||'Immagine interna dell’articolo')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${image[3]?`<figcaption>${esc(image[3])}</figcaption>`:''}</figure>`);
        continue;
      }
      const ul=line.match(/^[-*]\s+(.+)/),ol=line.match(/^\d+[.)]\s+(.+)/);
      if(ul||ol){
        const type=ul?'ul':'ol';
        if(listType&&listType!==type)flushList();
        listType=type;list.push((ul||ol)[1]);continue;
      }
      flushList();
      if(/^###\s+/.test(line))out.push(`<h4>${articleInlineMarkup(line.replace(/^###\s+/,''))}</h4>`);
      else if(/^##\s+/.test(line))out.push(`<h3>${articleInlineMarkup(line.replace(/^##\s+/,''))}</h3>`);
      else if(/^>\s?/.test(line))out.push(`<blockquote>${articleInlineMarkup(line.replace(/^>\s?/,''))}</blockquote>`);
      else out.push(`<p>${articleInlineMarkup(line)}</p>`);
    }
    flushList();
    return out.join('')||'<p>Nessun testo inserito.</p>';
  }
  function articleMetadata(article,{admin=false}={}){
    const dateValue=article?.publishedAt||article?.updatedAt||article?.createdAt||'';
    const date=fmtArticleDate(dateValue,{dateOnly:true});
    const category=String(article?.category||'Aggiornamenti');
    const author=String(article?.author||'Redazione New Generation');
    return `<div class="article-meta">
      <span class="article-kicker">${esc(category)}</span>
      ${admin?`<span class="article-status status-${esc(article?.status||'published')}">${esc(articleStatusLabel(article?.status))}</span>`:''}
      ${date?`<time datetime="${esc(dateValue)}">${esc(date)}</time>`:''}
      ${author?`<span class="article-author">di ${esc(author)}</span>`:''}
    </div>`;
  }
  function articleCard(article,admin=false){
    const title=String(article?.title||'News');
    const subtitle=String(article?.subtitle||'').trim();
    const excerpt=articleExcerpt(article);
    const key=String(article?.slug||article?.id||'');
    const content=`<div class="article-media">${articleImageMarkup(article)}<span class="article-kicker media-kicker">${esc(article?.category||'NEWS')}</span></div>
      <div class="article-content">${articleMetadata(article,{admin})}<h3>${esc(title)}</h3>${subtitle?`<p class="article-card-subtitle">${esc(subtitle)}</p>`:''}${excerpt?`<p class="article-card-excerpt">${esc(excerpt)}</p>`:''}<span class="article-open-label" aria-hidden="true">Leggi l’articolo <span>→</span></span></div>`;
    if(!admin){
      return `<article class="article-card sports-news-card" data-article-id="${esc(article?.id||'')}"><a class="article-card-main" href="#article=${encodeURIComponent(key)}" data-article-open="${esc(article?.id||key)}" aria-label="Leggi articolo completo: ${esc(title)}">${content}</a></article>`;
    }
    return `<article class="article-card sports-news-card admin-news-card" data-article-id="${esc(article?.id||'')}"><div class="article-card-main">${content}</div><div class="article-admin-actions" aria-label="Azioni articolo ${esc(title)}"><button class="btn small" type="button" data-preview-article="${esc(article?.id||'')}">Anteprima</button><button class="btn small primary" type="button" data-edit-article="${esc(article?.id||'')}">Modifica</button><button class="btn small danger" type="button" data-delete-article="${esc(article?.id||'')}">Elimina</button></div></article>`;
  }
  function articleReadingTime(article){
    const words=String(article?.body||'').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1,Math.ceil(words/220));
  }
  function articleDetailMeta(article,{preview=false}={}){
    const rows=[];
    const author=String(article?.author||'').trim()||'Redazione New Generation';
    const publishedValue=article?.publishedAt||article?.createdAt||'';
    const updatedValue=article?.updatedAt||'';
    const published=fmtArticleDate(publishedValue,{dateOnly:true});
    const updated=fmtArticleDate(updatedValue,{dateOnly:true});
    if(author)rows.push(`<span class="article-detail-author">di ${esc(author)}</span>`);
    if(published)rows.push(`<time datetime="${esc(publishedValue)}">${esc(published)}</time>`);
    if(updated&&updated!==published)rows.push(`<span>Aggiornato ${esc(updated)}</span>`);
    rows.push(`<span>${articleReadingTime(article)} min di lettura</span>`);
    if(preview)rows.push(`<span class="article-status status-${esc(article?.status||'published')}">${esc(articleStatusLabel(article?.status))}</span>`);
    return `<div class="article-detail-meta">${rows.join('')}</div>`;
  }
  function articleDetail(article,{preview=false}={}){
    const title=String(article?.title||'News');
    const subtitle=String(article?.subtitle||'').trim();
    const caption=String(article?.imageCaption||'').trim();
    const image=String(article?.image||'').trim();
    const imageMarkup=image?articleImageMarkup(article,{detail:true,eager:true}):'';
    const tags=Array.isArray(article?.tags)?article.tags.map(tag=>String(tag||'').trim()).filter(Boolean):[];
    const category=String(article?.category||'Aggiornamenti').trim()||'Aggiornamenti';
    const publishedValue=article?.publishedAt||article?.createdAt||'';
    const updatedValue=article?.updatedAt||'';
    const published=fmtArticleDate(publishedValue);
    const updated=updatedValue&&updatedValue!==publishedValue?fmtArticleDate(updatedValue):'';
    const backLabel=preview?'Chiudi anteprima':'Torna agli articoli';
    return `<article class="article-detail article-detail-editorial${image?' has-image':' no-image'}" data-article-detail="${esc(article?.id||'')}">
      ${preview?'<div class="article-preview-banner">Anteprima amministratore · strumenti di modifica separati dal contenuto pubblico</div>':''}
      <nav class="article-detail-nav" aria-label="Navigazione articolo"><button type="button" class="article-back-link" data-article-back>← ${backLabel}</button></nav>
      <header class="article-detail-header">
        <span class="article-detail-category">${esc(category)}</span>
        <h1>${esc(title)}</h1>
        ${subtitle?`<p class="article-detail-subtitle">${esc(subtitle)}</p>`:''}
        ${articleDetailMeta(article,{preview})}
      </header>
      ${image?`<figure class="article-detail-media">
        <button type="button" class="article-image-open" data-article-image-open="${esc(image)}" aria-label="Apri fotografia a dimensione intera: ${esc(title)}">
          ${imageMarkup}<span class="article-image-open-hint" aria-hidden="true">Apri immagine</span>
        </button>
        ${caption?`<figcaption>${esc(caption)}</figcaption>`:''}
      </figure>`:''}
      <div class="article-detail-body">
        <div class="article-full-text">${articleBodyMarkup(article?.body)}</div>
        ${tags.length?`<div class="article-tags" aria-label="Tag">${tags.map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div>`:''}
        <footer class="article-detail-footer">${published?`<span>Pubblicato: ${esc(published)}</span>`:''}${updated?`<span>Aggiornato: ${esc(updated)}</span>`:''}</footer>
        <nav class="article-detail-end-nav" aria-label="Fine articolo"><button type="button" class="article-back-link" data-article-back>← ${backLabel}</button></nav>
      </div>
    </article>`;
  }

  let articleViewer=null;
  function ensureArticleImageViewer(){
    if(articleViewer)return articleViewer;
    const root=document.createElement('div');
    root.className='article-image-viewer';
    root.setAttribute('aria-hidden','true');
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label','Visualizzatore fotografia articolo');
    root.innerHTML=`<div class="article-image-viewer-toolbar"><div class="article-image-viewer-zoom"><button type="button" data-article-viewer-out aria-label="Riduci zoom">−</button><span data-article-viewer-label>100%</span><button type="button" data-article-viewer-in aria-label="Aumenta zoom">+</button><button type="button" data-article-viewer-reset>Ripristina</button></div><button type="button" class="article-image-viewer-close" aria-label="Chiudi fotografia">×</button></div><div class="article-image-viewer-stage"><img alt="" draggable="false"></div>`;
    document.body.appendChild(root);
    const img=root.querySelector('img'),close=root.querySelector('.article-image-viewer-close'),stage=root.querySelector('.article-image-viewer-stage');
    const pointers=new Map();
    let scale=1,x=0,y=0,trigger=null,drag=null,pinchStart=null,ownsBodyLock=false;
    const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
    function apply(){if(scale<=1){x=0;y=0;}img.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;root.querySelector('[data-article-viewer-label]').textContent=Math.round(scale*100)+'%';img.classList.toggle('is-zoomed',scale>1);}
    function setScale(next){scale=clamp(next,1,4);apply();}
    function reset(){scale=1;x=0;y=0;drag=null;pinchStart=null;pointers.clear();apply();}
    function hide(){root.classList.remove('open');root.setAttribute('aria-hidden','true');if(ownsBodyLock)document.body.classList.remove('ng-overlay-open');ownsBodyLock=false;reset();const target=trigger;trigger=null;requestAnimationFrame(()=>target&&document.contains(target)&&target.focus?.({preventScroll:true}));}
    root.addEventListener('click',event=>{
      if(event.target===root||event.target===stage||event.target.closest('.article-image-viewer-close'))hide();
      else if(event.target.closest('[data-article-viewer-in]'))setScale(scale+.5);
      else if(event.target.closest('[data-article-viewer-out]'))setScale(scale-.5);
      else if(event.target.closest('[data-article-viewer-reset]'))reset();
    });
    stage.addEventListener('wheel',event=>{event.preventDefault();setScale(scale+(event.deltaY<0?.35:-.35));},{passive:false});
    img.addEventListener('dblclick',()=>setScale(scale>1?1:2));
    img.addEventListener('pointerdown',event=>{
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      img.setPointerCapture?.(event.pointerId);
      if(pointers.size===1&&scale>1)drag={px:event.clientX,py:event.clientY,x,y};
      if(pointers.size===2){const values=[...pointers.values()];pinchStart={distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y),scale};drag=null;}
    });
    img.addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2&&pinchStart){const values=[...pointers.values()];const distance=Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y);setScale(pinchStart.scale*(distance/Math.max(1,pinchStart.distance)));return;}
      if(!drag)return;x=drag.x+event.clientX-drag.px;y=drag.y+event.clientY-drag.py;apply();
    });
    function pointerEnd(event){pointers.delete(event.pointerId);drag=null;if(pointers.size<2)pinchStart=null;}
    img.addEventListener('pointerup',pointerEnd);img.addEventListener('pointercancel',pointerEnd);
    document.addEventListener('keydown',event=>{
      if(!root.classList.contains('open'))return;
      if(event.key==='Tab'){
        const focusable=[...root.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
        if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      }else if(event.key==='Escape'){event.preventDefault();hide();}
      else if(event.key==='+'||event.key==='='){event.preventDefault();setScale(scale+.5);}
      else if(event.key==='-'){event.preventDefault();setScale(scale-.5);}
      else if(event.key==='0'){event.preventDefault();reset();}
    });
    articleViewer={open(src,alt,lastTrigger){trigger=lastTrigger||document.activeElement;img.src=src;img.alt=alt||'Fotografia articolo';reset();ownsBodyLock=!document.body.classList.contains('ng-overlay-open');root.classList.add('open');root.setAttribute('aria-hidden','false');document.body.classList.add('ng-overlay-open');requestAnimationFrame(()=>close.focus());},close:hide,root};
    return articleViewer;
  }
  function prepareArticleDetail(root,{onBack}={}){
    if(!root)return;
    root.querySelectorAll('.article-detail-media img.article-image').forEach(img=>{
      const figure=img.closest('.article-detail-media');
      const classify=()=>{if(!img.naturalWidth||!img.naturalHeight)return;const ratio=img.naturalWidth/img.naturalHeight;figure?.classList.remove('is-portrait','is-square','is-landscape');figure?.classList.add(ratio<.85?'is-portrait':ratio>1.2?'is-landscape':'is-square');};
      if(img.complete)classify();else img.addEventListener('load',classify,{once:true});
    });
    if(root.dataset.articleInteractionsBound==='1')return;
    root.dataset.articleInteractionsBound='1';
    root.addEventListener('click',event=>{
      const back=event.target.closest('[data-article-back]');if(back){event.preventDefault();onBack?.(back);return;}
      const opener=event.target.closest('[data-article-image-open]');if(opener){event.preventDefault();const img=opener.querySelector('img');ensureArticleImageViewer().open(opener.dataset.articleImageOpen,img?.alt||'Fotografia articolo',opener);}
    });
  }
  function articleList(articles,admin=false){
    const rows=Array.isArray(articles)?articles:[];
    return rows.length?`<div class="article-list">${rows.map(a=>articleCard(a,admin)).join('')}</div>`:`<div class="empty article-empty"><strong>${admin?'Nessun articolo trovato':'Nessun articolo pubblicato'}</strong><span>${admin?'Crea un nuovo articolo o modifica i filtri.':'Torna presto per leggere i prossimi aggiornamenti.'}</span></div>`;
  }

  function siteSettings(state){return store.defaultSite?store.defaultSite():{title:'New Generation',subtitle:'Risultati, squadre, giocatori e dettagli partite.',logo:''};}
  function siteTitle(state){return state?.rules?.name||'New Generation';}
  function siteSubtitle(state){return 'Risultati, squadre, giocatori e dettagli partite.';}
  function siteLogoMarkup(state,big=false){
    const site=siteSettings(state); const cls=`brand-logo-img ${big?'big':''}`;
    if(site.logo)return `<img class="${cls}" src="${esc(site.logo)}" alt="Logo ${esc(siteTitle(state))}">`;
    return `<div class="logo ${big?'big':''}"><span></span></div>`;
  }
  function applySiteTheme(state){
    try{
      const r=document.documentElement;
      ['--brand-primary','--brand-accent','--brand-surface','--brand-radius'].forEach(k=>r.style.removeProperty(k));
      document.querySelectorAll('[data-brand-title]').forEach(el=>{if(!el.dataset.brandSuffix){const txt=String(el.textContent||'');const i=txt.indexOf('·');if(i>=0)el.dataset.brandSuffix=' '+txt.slice(i).trim();}el.textContent=siteTitle(state)+(el.dataset.brandSuffix||'');});
      document.querySelectorAll('[data-brand-subtitle]').forEach(el=>{el.textContent=siteSubtitle(state);});
      document.querySelectorAll('[data-brand-logo]').forEach(el=>{el.innerHTML=siteLogoMarkup(state);});
      document.title=(document.title||'New Generation').replace(/^New Generation/,siteTitle(state));
    }catch(e){console.warn('Tema sito non applicato',e);}
  }

  function createTextPdf(title, lines, filename){const safe=s=>String(s).replace(/[()\\]/g,'');const body=[];let y=790;body.push('BT /F1 18 Tf 40 820 Td ('+safe(title)+') Tj ET');lines.forEach(line=>{if(y<40){return;}body.push(`BT /F1 10 Tf 40 ${y} Td (${safe(line).slice(0,110)}) Tj ET`);y-=16;});const stream=body.join('\n');const objs=[`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`,`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`,`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,`4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,`5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`];let pdf='%PDF-1.4\n';const offsets=[0];objs.forEach(o=>{offsets.push(pdf.length);pdf+=o+'\n';});const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')+`\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;const blob=new Blob([pdf],{type:'application/pdf'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);}
  function bindTabs(){document.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;const target=b.dataset.tab;$$('[data-tab]').forEach(x=>x.classList.remove('active'));$$('.tab-panel').forEach(x=>x.classList.remove('active'));$$(`[data-tab="${target}"]`).forEach(x=>x.classList.add('active'));$('#'+target)?.classList.add('active');document.dispatchEvent(new CustomEvent('ng:tab-changed',{detail:{tab:target}}));});}
  function bindDisclosures(){document.addEventListener('toggle',e=>{const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.open)return;const list=d.closest('.team-disclosure-list,.admin-disclosure-list,.admin-player-list');if(!list)return;list.querySelectorAll('details[open]').forEach(x=>{if(x!==d)x.open=false;});},true);}
  document.addEventListener('DOMContentLoaded',bindDisclosures);
  window.NexoraUI={esc,$,$$,logo,injectTeamLogoStyles,siteTitle,siteSubtitle,siteLogoMarkup,applySiteTheme,fmtDate,teamOptions,playerOptions,statsGrid,standingsTable,groupStandingsSelector,groupStandingsTables,playerStatsTable,presidentStatsTable,matchStatusMeta,matchCard,matchList,teamGrid,rulesSummary,bracketMarkup,articleCard,articleDetail,articleList,articlePlaceholder,replaceBrokenArticleImage,articleBodyMarkup,articleStatusLabel,prepareArticleDetail,ensureArticleImageViewer,createTextPdf,bindTabs,bindDisclosures};
})();
````

## `/mnt/data/ng-work/new-generation-main/assets/js/ux-a11y.js`

````javascript
(function(){
  'use strict';

  const focusableSelector = [
    'a[href]','button:not([disabled])','input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])','textarea:not([disabled])','[tabindex]:not([tabindex="-1"])',
    'details > summary:first-of-type','[contenteditable="true"]'
  ].join(',');
  const overlaySelector = '.modal,.ng-modal-backdrop,.filter-sheet-modal,.mobile-nav-sheet,.ng-confirm-overlay,.photos-lightbox,.photo-lightbox,.public-photo-lightbox,.article-image-viewer,.login-overlay';
  let generatedId = 0;
  const modalTriggers = new WeakMap();
  const modalOpenState = new WeakMap();
  const modalFocusFrames = new WeakMap();
  const busyButtons = new WeakMap();
  let scrollLockState = null;

  const ready = fn => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, {once:true})
    : fn();

  function visible(el){
    if(!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function textLabel(el){
    const labelledBy = el.getAttribute('aria-labelledby');
    if(labelledBy){
      const value = labelledBy.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
      if(value) return value;
    }
    const label = el.labels?.[0]?.textContent?.trim();
    if(label) return label;
    const heading = el.closest('article,section,.card,.modal-content,.ng-modal')?.querySelector('h1,h2,h3');
    return heading?.textContent?.trim() || '';
  }

  function ensureId(el, prefix='ng-control'){
    if(!el.id) el.id = `${prefix}-${++generatedId}`;
    return el.id;
  }

  function enhanceLabels(root){
    root.querySelectorAll?.('label:not([for])').forEach(label=>{
      if(label.control) return;
      const parent = label.parentElement;
      if(!parent) return;
      let control = label.querySelector('input,select,textarea');
      if(!control){
        const candidates = [...parent.querySelectorAll(':scope > input,:scope > select,:scope > textarea')];
        control = candidates.find(el=>el.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_PRECEDING) || candidates[0];
      }
      if(control) label.htmlFor = ensureId(control);
    });

    root.querySelectorAll?.('input:not([type="hidden"]),select,textarea').forEach(control=>{
      const key = `${control.id || ''} ${control.getAttribute('name') || ''}`.toLowerCase();
      if(!control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby') && !control.labels?.length){
        const preceding = control.previousElementSibling;
        const fallback = preceding?.matches?.('label') ? preceding.textContent.trim() : control.getAttribute('placeholder');
        if(fallback) control.setAttribute('aria-label', fallback);
      }
      if(control instanceof HTMLInputElement){
        if((key.includes('search') || key.includes('ricerca')) && control.type === 'text') control.type = 'search';
        if((control.type === 'number' || /year|anno|number|numero|score|gol|goal|teams|squadre/.test(key)) && !control.inputMode) control.inputMode = 'numeric';
        if(!control.autocomplete){
          if(key.includes('email')) control.autocomplete = 'email';
          else if(key.includes('password')) control.autocomplete = 'current-password';
          else if(/first.?name|nome/.test(key)) control.autocomplete = 'name';
          else if(key.includes('search')) control.autocomplete = 'off';
        }
      }
    });
  }

  function enhanceImages(root){
    root.querySelectorAll?.('img').forEach(img=>{
      if(!img.hasAttribute('alt')) img.alt = '';
      if(!img.hasAttribute('decoding')) img.decoding = 'async';
      if(img.classList.contains('brand-logo-img')){
        if(!img.hasAttribute('width')) img.width = img.classList.contains('big') ? 82 : 56;
        if(!img.hasAttribute('height')) img.height = img.classList.contains('big') ? 82 : 56;
      }else if(img.classList.contains('team-logo')){
        if(!img.hasAttribute('width')) img.width = img.classList.contains('big') ? 82 : 54;
        if(!img.hasAttribute('height')) img.height = img.classList.contains('big') ? 82 : 54;
      }else if(img.classList.contains('article-image')){
        if(!img.hasAttribute('width')) img.width = 1200;
        if(!img.hasAttribute('height')) img.height = 750;
      }
    });
  }

  function regionName(el, fallback){
    const heading = el.closest('article,section,.card')?.querySelector('h2,h3');
    return heading?.textContent?.trim() || fallback;
  }

  function enhanceScrollable(root){
    root.querySelectorAll?.('.table-wrap,.photos-team-bar,.admin-nav,.tabs').forEach(el=>{
      if(el.classList.contains('table-wrap')){
        if(!el.hasAttribute('tabindex')) el.tabIndex = 0;
        if(!el.hasAttribute('role')) el.setAttribute('role','region');
        if(!el.hasAttribute('aria-label')) el.setAttribute('aria-label',regionName(el,'Tabella scorrevole'));
      }
    });
  }

  function enhanceMessages(root){
    root.querySelectorAll?.('[id$="Msg"],#ngSyncStatus,.sync-status,[data-live-message],.message').forEach(el=>{
      const isError = el.classList.contains('error') || el.dataset.type === 'error';
      if(!el.hasAttribute('role')) el.setAttribute('role',isError ? 'alert' : 'status');
      if(!el.hasAttribute('aria-live')) el.setAttribute('aria-live',isError ? 'assertive' : 'polite');
      el.setAttribute('aria-atomic','true');
    });
  }

  function enhanceNavigation(root){
    root.querySelectorAll?.('nav').forEach(nav=>{
      if(nav.hasAttribute('aria-label')) return;
      if(nav.classList.contains('admin-nav')) nav.setAttribute('aria-label','Navigazione amministrazione');
      else if(nav.classList.contains('tabs')) nav.setAttribute('aria-label','Sezioni del sito');
      else nav.setAttribute('aria-label','Navigazione');
    });
    root.querySelectorAll?.('.admin-nav a').forEach(link=>{
      if(link.classList.contains('active')) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }

  function updateTabs(){
    const tablist = document.querySelector('.tabs');
    if(!tablist) return;
    tablist.setAttribute('role','tablist');
    tablist.querySelectorAll('[data-tab]').forEach((tab,index)=>{
      const target = tab.dataset.tab;
      const panel = target ? document.getElementById(target) : null;
      const id = ensureId(tab,'ng-tab');
      tab.setAttribute('role','tab');
      if(panel){
        tab.setAttribute('aria-controls',panel.id);
        panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-labelledby',id);
        panel.setAttribute('aria-hidden',panel.classList.contains('active') ? 'false' : 'true');
        if(!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
      }
      const active = tab.classList.contains('active');
      tab.setAttribute('aria-selected',String(active));
      tab.tabIndex = active ? 0 : -1;
      if(index === 0 && !tablist.hasAttribute('aria-orientation')) tablist.setAttribute('aria-orientation','horizontal');
    });
    document.querySelectorAll('.mobile-bottom-nav [data-tab],.mobile-sheet-grid [data-tab]').forEach(item=>{
      if(item.classList.contains('active')) item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    });
  }

  function modalContainer(node){
    if(!(node instanceof Element)) return null;
    if(node.matches('[role="dialog"]')) return node;
    return node.querySelector('[role="dialog"],.modal-content,.ng-modal,.filter-sheet-panel,.mobile-nav-panel,.ng-confirm-card,.lightbox-stage,.lightbox-content') || null;
  }

  function overlayIsOpen(overlay){
    if(overlay.classList.contains('modal')) return overlay.classList.contains('open');
    if(overlay.classList.contains('ng-modal-backdrop')) return overlay.classList.contains('show');
    if(overlay.classList.contains('filter-sheet-modal') || overlay.classList.contains('mobile-nav-sheet') || overlay.classList.contains('ng-confirm-overlay')) return overlay.classList.contains('open');
    if(overlay.classList.contains('photos-lightbox') || overlay.classList.contains('photo-lightbox') || overlay.classList.contains('public-photo-lightbox')) return overlay.classList.contains('open');
    if(overlay.classList.contains('login-overlay')) return overlay.isConnected;
    return overlay.classList.contains('open') || overlay.classList.contains('show');
  }

  function overlayBlocksPage(overlay){
    return overlayIsOpen(overlay) || overlay.classList.contains('is-closing');
  }

  function allOverlays(root=document){
    const overlays=[];
    if(root.matches?.(overlaySelector)) overlays.push(root);
    root.querySelectorAll?.(overlaySelector).forEach(el=>overlays.push(el));
    return overlays;
  }

  function lockDocumentScroll(){
    if(scrollLockState || !document.body) return;
    const body=document.body;
    const computed=getComputedStyle(body);
    const stableGutter=getComputedStyle(document.documentElement).scrollbarGutter.includes('stable');
    const scrollbar=stableGutter ? 0 : Math.max(0,window.innerWidth-document.documentElement.clientWidth);
    scrollLockState={
      overflow:body.style.overflow,
      overscrollBehavior:body.style.overscrollBehavior,
      paddingRight:body.style.paddingRight
    };
    if(scrollbar>0){
      const currentPadding=parseFloat(computed.paddingRight)||0;
      body.style.paddingRight=`${currentPadding+scrollbar}px`;
      document.documentElement.style.setProperty('--ng-scrollbar-compensation',`${scrollbar}px`);
    }
    body.style.overflow='hidden';
    body.style.overscrollBehavior='none';
    body.classList.add('ng-overlay-open');
  }

  function unlockDocumentScroll(){
    if(!scrollLockState || !document.body) return;
    const body=document.body;
    body.style.overflow=scrollLockState.overflow;
    body.style.overscrollBehavior=scrollLockState.overscrollBehavior;
    body.style.paddingRight=scrollLockState.paddingRight;
    body.classList.remove('ng-overlay-open','modal-open','mobile-nav-open');
    document.documentElement.style.removeProperty('--ng-scrollbar-compensation');
    scrollLockState=null;
  }

  function syncDocumentLock(){
    const blocked=allOverlays().some(overlay=>overlayBlocksPage(overlay));
    if(blocked) lockDocumentScroll();
    else unlockDocumentScroll();
  }

  function scheduleFocus(overlay,callback){
    const previous=modalFocusFrames.get(overlay);
    if(previous) cancelAnimationFrame(previous);
    const frame=requestAnimationFrame(()=>{
      modalFocusFrames.delete(overlay);
      callback();
    });
    modalFocusFrames.set(overlay,frame);
  }

  function restoreModalTrigger(overlay){
    const trigger=modalTriggers.get(overlay);
    modalTriggers.delete(overlay);
    if(trigger instanceof HTMLElement && trigger.matches('button,a,[role="button"]')) trigger.setAttribute('aria-expanded','false');
    if(!(trigger instanceof HTMLElement) || !document.contains(trigger)) return;
    scheduleFocus(overlay,()=>{
      const stillOpen=activeOverlay();
      if(stillOpen && stillOpen!==overlay && !stillOpen.contains(trigger)){
        const dialog=modalContainer(stillOpen);
        const first=dialog ? [...dialog.querySelectorAll(focusableSelector)].find(visible) : null;
        (first||dialog)?.focus?.({preventScroll:true});
        return;
      }
      trigger.focus({preventScroll:true});
    });
  }

  function updateModal(overlay){
    if(!(overlay instanceof Element) || !overlay.matches(overlaySelector)) return;
    const dialog = modalContainer(overlay);
    if(!dialog) return;
    if(!dialog.hasAttribute('role')) dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    if(!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    if(!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')){
      const heading = dialog.querySelector('h1,h2,h3');
      if(heading) dialog.setAttribute('aria-labelledby',ensureId(heading,'ng-dialog-title'));
      else dialog.setAttribute('aria-label','Finestra di dialogo');
    }
    const open = overlayIsOpen(overlay);
    const wasOpen = modalOpenState.get(overlay) === true;
    overlay.setAttribute('aria-hidden',String(!open));
    modalOpenState.set(overlay,open);
    if(open && !wasOpen){
      const trigger=document.activeElement;
      modalTriggers.set(overlay,trigger);
      if(trigger instanceof HTMLElement && trigger.matches('button,a,[role="button"]')){
        trigger.setAttribute('aria-controls',ensureId(overlay,'ng-overlay'));
        trigger.setAttribute('aria-expanded','true');
      }
      scheduleFocus(overlay,()=>{
        if(!overlayIsOpen(overlay)) return;
        const current = document.activeElement;
        if(!overlay.contains(current)){
          const first = [...dialog.querySelectorAll(focusableSelector)].find(visible);
          (first || dialog).focus({preventScroll:true});
        }
      });
    }else if(!open && wasOpen){
      if(overlay.classList.contains('is-closing')){
        modalOpenState.set(overlay,true);
        syncDocumentLock();
        return;
      }
      restoreModalTrigger(overlay);
    }
    syncDocumentLock();
  }

  function enhanceModals(root){
    allOverlays(root).forEach(updateModal);
    syncDocumentLock();
  }

  function enhance(root=document){
    enhanceLabels(root);
    enhanceImages(root);
    enhanceScrollable(root);
    enhanceMessages(root);
    enhanceNavigation(root);
    enhanceModals(root);
    updateTabs();
  }

  function activeOverlay(){
    return allOverlays()
      .filter(overlay=>overlayIsOpen(overlay) && visible(overlay))
      .sort((a,b)=>{
        const za=Number.parseInt(getComputedStyle(a).zIndex,10)||0;
        const zb=Number.parseInt(getComputedStyle(b).zIndex,10)||0;
        if(za!==zb) return za-zb;
        return (a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)?-1:1;
      })
      .pop() || null;
  }

  function closeActiveOverlay(overlay){
    const selectors = [
      '[data-close-match-filter]','[data-mobile-more="close"]','[data-lightbox-close]','.lightbox-close',
      '#closeModal','#closeArticleModal','#closeTeamModal','#closeMatchTaskModal','#closeMatchListModal',
      '#closeGroupMoveModal','#closeCriterionMoveModal','#closePlayersTeamModal',
      '#cancelResetBtn','#cancelSimulationBtn','.ng-confirm-cancel','.article-modal-close','.match-modal-close'
    ];
    let button = overlay.querySelector(selectors.join(','));
    if(!button){
      button = [...overlay.querySelectorAll('button')].find(btn=>/^(chiudi|annulla|close|×)$/i.test(btn.textContent.trim()));
    }
    if(button) button.click();
  }

  function setButtonBusy(button,busy,label='Attendi…'){
    if(!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement)) return false;
    if(busy){
      if(busyButtons.has(button)){
        setButtonBusyLabel(button,label,true);
        return false;
      }
      const rect=button.getBoundingClientRect();
      const state={
        html:button.innerHTML,
        value:button.value,
        disabled:button.disabled,
        ariaBusy:button.getAttribute('aria-busy'),
        minWidth:button.style.minWidth,
        minHeight:button.style.minHeight
      };
      busyButtons.set(button,state);
      if(rect.width>0) button.style.minWidth=`${Math.ceil(rect.width)}px`;
      if(rect.height>0) button.style.minHeight=`${Math.ceil(rect.height)}px`;
      button.disabled=true;
      button.setAttribute('aria-busy','true');
      button.classList.add('is-loading');
      if(button instanceof HTMLInputElement){
        button.value=label;
      }else{
        const original=document.createElement('span');
        original.className='ng-btn-original';
        original.setAttribute('aria-hidden','true');
        original.innerHTML=state.html;
        const layer=document.createElement('span');
        layer.className='ng-btn-busy-layer';
        const spinner=document.createElement('span');
        spinner.className='ng-btn-spinner';
        spinner.setAttribute('aria-hidden','true');
        const text=document.createElement('span');
        text.className='ng-btn-busy-text';
        text.textContent=label;
        layer.append(spinner,text);
        button.replaceChildren(original,layer);
      }
      return true;
    }
    const state=busyButtons.get(button);
    if(!state) return false;
    if(button instanceof HTMLInputElement) button.value=state.value;
    else button.innerHTML=state.html;
    button.disabled=state.disabled;
    if(state.ariaBusy===null) button.removeAttribute('aria-busy');
    else button.setAttribute('aria-busy',state.ariaBusy);
    button.style.minWidth=state.minWidth;
    button.style.minHeight=state.minHeight;
    button.classList.remove('is-loading','is-success','is-error');
    busyButtons.delete(button);
    return true;
  }

  function setButtonBusyLabel(button,label,spinner=true,tone=''){
    if(!busyButtons.has(button)) return false;
    if(button instanceof HTMLInputElement){
      button.value=label;
      return true;
    }
    const text=button.querySelector('.ng-btn-busy-text');
    const icon=button.querySelector('.ng-btn-spinner');
    if(text) text.textContent=label;
    if(icon) icon.hidden=!spinner;
    button.classList.toggle('is-success',tone==='success');
    button.classList.toggle('is-error',tone==='error');
    return true;
  }

  window.NGInteractive={
    setButtonBusy,
    setButtonBusyLabel,
    isButtonBusy:button=>busyButtons.has(button),
    syncDocumentLock,
    activeOverlay
  };

  ready(()=>{
    document.documentElement.classList.remove('no-js');
    document.documentElement.classList.add('js');
    enhance(document);

    const observer = new MutationObserver(records=>{
      for(const record of records){
        if(record.type === 'childList'){
          record.addedNodes.forEach(node=>{if(node instanceof Element) enhance(node);});
          record.removedNodes.forEach(node=>{
            if(!(node instanceof Element)) return;
            allOverlays(node).forEach(overlay=>{
              if(modalOpenState.get(overlay)===true) restoreModalTrigger(overlay);
              modalOpenState.set(overlay,false);
            });
          });
        }else if(record.type === 'attributes' && record.target instanceof Element){
          updateModal(record.target);
        }
      }
      enhanceMessages(document);
      updateTabs();
      syncDocumentLock();
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});

    document.addEventListener('ng:tab-changed',updateTabs);
    document.addEventListener('click',()=>requestAnimationFrame(updateTabs));

    document.addEventListener('keydown',event=>{
      const tab = event.target?.closest?.('.tabs [role="tab"]');
      if(tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
        const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
        let index = tabs.indexOf(tab);
        if(event.key === 'Home') index = 0;
        else if(event.key === 'End') index = tabs.length - 1;
        else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[index].focus();
        tabs[index].click();
        return;
      }

      const overlay = activeOverlay();
      if(!overlay) return;
      const dialog = modalContainer(overlay);
      if(event.key === 'Escape'){
        event.preventDefault();
        event.stopPropagation();
        closeActiveOverlay(overlay);
        return;
      }
      if(event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll(focusableSelector)].filter(visible);
      if(!items.length){event.preventDefault();dialog.focus();return;}
      const first = items[0], last = items[items.length-1];
      if(event.shiftKey && document.activeElement === first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement === last){event.preventDefault();first.focus();}
    },true);

    window.addEventListener('pagehide',unlockDocumentScroll,{once:true});
  });
})();
````

## `/mnt/data/ng-work/new-generation-main/supabase/functions/team-photos/index.ts`

````typescript
// Supabase Edge Function: team-photos
// Flusso separato dalle immagini articolo: Cloudinary folder/tag e tabella dedicati.
// Deploy con verify_jwt=false (config.toml): GET/download/ZIP sono pubblici,
// mentre upload, modifica, sostituzione ed eliminazione validano manualmente
// la sessione Supabase dell'amministratore.

import JSZip from 'npm:jszip@3.10.1';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 20;
const MAX_BATCH_SIZE = 80 * 1024 * 1024;
const MAX_ZIP_FILES = 100;
const MAX_ZIP_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 120 * 1000 * 1000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const ADMIN_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type PhotoRecord = Record<string, any>;

class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function env(name: string, fallback = '') {
  return Deno.env.get(name) || fallback;
}

function allowedOrigins() {
  return env('PHOTO_ALLOWED_ORIGINS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const configured = allowedOrigins();
  const allowOrigin = configured.length ? (configured.includes(origin) ? origin : '') : '*';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

function ensureOriginAllowed(req: Request) {
  const origin = req.headers.get('origin') || '';
  const configured = allowedOrigins();
  if (origin && configured.length && !configured.includes(origin)) {
    throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origine non autorizzata per la sezione Foto.');
  }
}

function json(req: Request, body: JsonValue, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

function binary(req: Request, body: BodyInit, status: number, headers: HeadersInit) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(req),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function cleanSegment(value: FormDataEntryValue | string | null | undefined, fallback = 'default') {
  const clean = String(value || fallback)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function safeText(value: unknown, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function safeFileName(value: unknown, fallback = 'foto.jpg') {
  const name = String(value || fallback).split(/[\\/]/).pop() || fallback;
  return name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140) || fallback;
}

function baseName(filename: string) {
  return cleanSegment(filename.replace(/\.[^.]+$/, ''), 'photo').slice(0, 50);
}

function fileExtension(filename: string) {
  return String(filename || '').split('.').pop()?.toLowerCase() || '';
}

function cloudinaryConfig() {
  const cloudName = env('CLOUDINARY_CLOUD_NAME', 'dc17izhac');
  const apiKey = env('CLOUDINARY_API_KEY');
  const apiSecret = env('CLOUDINARY_API_SECRET');
  const rootFolder = cleanSegment(env('CLOUDINARY_TEAM_FOLDER', 'squadra'), 'squadra');
  const sectionTag = cleanSegment(env('CLOUDINARY_SECTION_TAG', 'foto-squadra'), 'foto-squadra');
  if (!cloudName || !apiKey || !apiSecret) {
    throw new HttpError(500, 'CLOUDINARY_CONFIG', 'Cloudinary non configurato per la sezione Foto.');
  }
  return { cloudName, apiKey, apiSecret, rootFolder, sectionTag };
}

function supabaseConfig() {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    throw new HttpError(500, 'SUPABASE_CONFIG', 'Configurazione Supabase incompleta nella Edge Function.');
  }
  return { url: url.replace(/\/$/, ''), anonKey, serviceRoleKey };
}

async function requireAdmin(req: Request) {
  const { url, anonKey } = supabaseConfig();
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sb_publishable_') || token === anonKey) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Sessione amministratore assente o scaduta.');
  }
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Sessione amministratore non valida o scaduta.');
  }
  return user;
}

async function dbRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

function metadataUnavailable(status: number, data: any) {
  return status === 404 || data?.code === '42P01' || /team_photos.*does not exist/i.test(String(data?.message || data || ''));
}

async function listMetadata(teamId = '') {
  const query = new URLSearchParams({ select: '*' });
  if (teamId) query.set('team_id', `eq.${teamId}`);
  query.set('order', 'display_order.asc,created_at.desc');
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`);
  if (metadataUnavailable(response.status, data)) return { available: false, rows: [] as PhotoRecord[] };
  if (!response.ok) throw new HttpError(502, 'DB_READ_FAILED', 'Impossibile leggere i metadati delle foto.', data);
  return { available: true, rows: Array.isArray(data) ? data : [] };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findMetadata(photoId: string) {
  const safeId = String(photoId || '').trim();
  if (!safeId) return null;
  const field = isUuid(safeId) ? 'id' : 'public_id';
  const query = new URLSearchParams({ select: '*', limit: '1' });
  query.set(field, `eq.${safeId}`);
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`);
  if (metadataUnavailable(response.status, data)) return null;
  if (!response.ok) throw new HttpError(502, 'DB_READ_FAILED', 'Impossibile verificare la foto richiesta.', data);
  return Array.isArray(data) ? data[0] || null : null;
}

async function insertMetadata(record: PhotoRecord) {
  const { response, data } = await dbRequest('team_photos?on_conflict=public_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new HttpError(502, 'DB_SAVE_FAILED', 'Cloudinary ha risposto, ma il salvataggio dei metadati è fallito.', data);
  return Array.isArray(data) ? data[0] : data;
}

async function patchMetadata(id: string, patch: PhotoRecord) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new HttpError(502, 'DB_SAVE_FAILED', 'Aggiornamento dei metadati non riuscito.', data);
  return Array.isArray(data) ? data[0] : data;
}

async function deleteMetadata(id: string) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!response.ok) throw new HttpError(502, 'DB_DELETE_FAILED', 'Eliminazione del record foto non riuscita.', data);
  return Array.isArray(data) ? data[0] : data;
}

async function sha1Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signParams(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return sha1Hex(toSign + apiSecret);
}

function encodedPublicId(publicId: string) {
  return String(publicId).split('/').map(encodeURIComponent).join('/');
}

function deliveryUrls(resource: any, cloudName: string) {
  const publicId = resource.public_id || resource.publicId || '';
  const versionNumber = resource.version || '';
  const version = versionNumber ? `v${versionNumber}/` : '';
  const formatValue = resource.format || '';
  const format = formatValue ? `.${formatValue}` : '';
  const base = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  const id = encodedPublicId(publicId);
  return {
    thumbUrl: `${base}a_auto,c_fill,w_600,h_420,g_auto,q_auto,f_auto,dpr_auto/${version}${id}${format}`,
    mediumUrl: `${base}a_auto,c_limit,w_1200,q_auto,f_auto,dpr_auto/${version}${id}${format}`,
    largeUrl: `${base}a_auto,c_limit,w_2200,q_auto,f_auto,dpr_auto/${version}${id}${format}`,
    originalUrl: resource.secure_url || `${base}${version}${id}${format}`,
    downloadUrl: `${base}fl_attachment:${encodeURIComponent(safeFileName(resource.original_filename || resource.originalName || `foto.${formatValue || 'jpg'}`))}/${version}${id}${format}`,
  };
}

function normalizeResource(resource: any, cloudName: string, rootFolder: string, metadata: PhotoRecord | null = null) {
  const urls = deliveryUrls({ ...resource, original_filename: metadata?.original_name || resource.original_filename }, cloudName);
  const publicId = resource.public_id || metadata?.public_id || '';
  const parts = String(publicId).split('/');
  const teamId = metadata?.team_id || (parts[0] === rootFolder ? parts[1] || '' : '');
  const createdAt = metadata?.created_at || resource.created_at || '';
  const format = metadata?.format || resource.format || '';
  const originalName = metadata?.original_name || `${parts[parts.length - 1] || 'photo'}.${format || 'jpg'}`;
  return {
    id: publicId,
    dbId: metadata?.id || '',
    publicId,
    path: publicId,
    teamId,
    name: originalName,
    originalName,
    title: metadata?.title || '',
    description: metadata?.description || '',
    caption: metadata?.caption || '',
    altText: metadata?.alt_text || '',
    album: metadata?.album || '',
    order: Number(metadata?.display_order || 0),
    version: Number(metadata?.version || resource.version || 0),
    format,
    mimeType: metadata?.mime_type || (format ? `image/${format === 'jpg' ? 'jpeg' : format}` : ''),
    width: Number(metadata?.width || resource.width || 0),
    height: Number(metadata?.height || resource.height || 0),
    size: Number(metadata?.bytes || resource.bytes || 0),
    originalSize: Number(metadata?.bytes || resource.bytes || 0),
    bytes: Number(metadata?.bytes || resource.bytes || 0),
    ts: createdAt ? Date.parse(createdAt) || Date.now() : Date.now(),
    createdAt,
    updatedAt: metadata?.updated_at || createdAt,
    ...urls,
    url: urls.thumbUrl,
    previewUrl: urls.thumbUrl,
  };
}

function resourceToRecord(resource: any, teamId: string, originalName: string, metadata: PhotoRecord = {}) {
  const { cloudName } = cloudinaryConfig();
  const normalizedResource = {
    ...resource,
    public_id: resource.public_id || resource.publicId || resource.path,
    secure_url: resource.secure_url || resource.originalUrl || resource.original_url,
    bytes: resource.bytes || resource.size || resource.originalSize,
    original_filename: originalName,
  };
  const urls = deliveryUrls(normalizedResource, cloudName);
  return {
    public_id: normalizedResource.public_id,
    team_id: teamId,
    original_url: urls.originalUrl,
    download_url: urls.downloadUrl,
    thumb_url: urls.thumbUrl,
    medium_url: urls.mediumUrl,
    large_url: urls.largeUrl,
    version: Number(normalizedResource.version || 0),
    format: normalizedResource.format || '',
    width: Number(normalizedResource.width || 0),
    height: Number(normalizedResource.height || 0),
    bytes: Number(normalizedResource.bytes || 0),
    mime_type: normalizedResource.mimeType || normalizedResource.mime_type || (normalizedResource.format ? `image/${normalizedResource.format === 'jpg' ? 'jpeg' : normalizedResource.format}` : ''),
    original_name: safeFileName(originalName),
    title: safeText(metadata.title, 160),
    description: safeText(metadata.description, 2000),
    caption: safeText(metadata.caption, 1000),
    alt_text: safeText(metadata.altText || metadata.alt_text, 300),
    album: safeText(metadata.album, 120),
    display_order: Number.isFinite(Number(metadata.order ?? metadata.display_order)) ? Number(metadata.order ?? metadata.display_order) : 0,
    updated_at: new Date().toISOString(),
  };
}

async function validateFile(file: File) {
  if (!file.size) throw new HttpError(400, 'EMPTY_FILE', `Il file ${safeFileName(file.name)} è vuoto.`);
  if (file.size > MAX_FILE_SIZE) throw new HttpError(413, 'FILE_TOO_LARGE', `${safeFileName(file.name)} supera il limite di 10 MB.`);
  if (!ALLOWED_MIME.has(file.type)) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Sono supportati soltanto JPEG, PNG e WebP.');
  if (!ALLOWED_EXT.has(fileExtension(file.name))) throw new HttpError(415, 'UNSUPPORTED_EXTENSION', 'Estensione non supportata. Usa JPG, JPEG, PNG o WebP.');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const matches = (file.type === 'image/jpeg' && isJpeg) || (file.type === 'image/png' && isPng) || (file.type === 'image/webp' && isWebp);
  if (!matches) throw new HttpError(415, 'CORRUPT_FILE', `${safeFileName(file.name)} non contiene un'immagine valida del formato dichiarato.`);
}

async function cloudinaryUpload(file: File, teamId: string) {
  const { cloudName, apiKey, apiSecret, rootFolder, sectionTag } = cloudinaryConfig();
  const folder = `${rootFolder}/${cleanSegment(teamId, 'team')}`;
  const publicId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${baseName(file.name || 'photo')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedParams: Record<string, string> = {
    folder,
    public_id: publicId,
    timestamp,
    tags: `${sectionTag},team_${cleanSegment(teamId, 'team')}`,
    overwrite: 'false',
    invalidate: 'true',
  };
  const signature = await signParams(signedParams, apiSecret);
  const uploadForm = new FormData();
  uploadForm.set('file', file);
  uploadForm.set('api_key', apiKey);
  uploadForm.set('signature', signature);
  Object.entries(signedParams).forEach(([key, value]) => uploadForm.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: uploadForm,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(response.status, 'CLOUDINARY_UPLOAD', data?.error?.message || 'Upload Cloudinary fallito.');
    if (!data?.public_id || !Number(data?.width) || !Number(data?.height) || !Number(data?.bytes)) {
      throw new HttpError(502, 'CLOUDINARY_INVALID_RESPONSE', 'Cloudinary non ha restituito metadati validi per l’originale.');
    }
    if (Number(data.width) * Number(data.height) > MAX_IMAGE_PIXELS) {
      await cloudinaryDestroy(data.public_id).catch(() => undefined);
      throw new HttpError(415, 'INVALID_DIMENSIONS', 'La risoluzione della foto supera il limite di 120 megapixel.');
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new HttpError(504, 'CLOUDINARY_TIMEOUT', 'Cloudinary non ha risposto entro il tempo previsto.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function cloudinaryDestroy(publicId: string) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { public_id: publicId, timestamp, invalidate: 'true' };
  const signature = await signParams(params, apiSecret);
  const form = new FormData();
  form.set('api_key', apiKey);
  form.set('signature', signature);
  Object.entries(params).forEach(([key, value]) => form.set(key, value));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: 'POST', body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !['ok', 'not found'].includes(data?.result)) {
    throw new HttpError(response.status || 502, 'CLOUDINARY_DELETE', data?.error?.message || 'Eliminazione Cloudinary fallita.');
  }
  return data?.result || 'ok';
}

async function listCloudinary(teamId = '') {
  const { cloudName, apiKey, apiSecret, rootFolder } = cloudinaryConfig();
  const safeTeam = teamId ? cleanSegment(teamId) : '';
  const prefix = safeTeam ? `${rootFolder}/${safeTeam}/` : `${rootFolder}/`;
  const resources: any[] = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ prefix, max_results: '500', type: 'upload', resource_type: 'image' });
    if (cursor) query.set('next_cursor', cursor);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${query.toString()}`, {
      headers: { Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}` },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(response.status, 'CLOUDINARY_LIST', data?.error?.message || 'Lista Cloudinary non disponibile.');
    resources.push(...(data?.resources || []));
    cursor = data?.next_cursor || '';
  } while (cursor);
  return resources.filter((resource) => resource?.public_id?.startsWith(`${rootFolder}/`) && !resource.placeholder && Number(resource.bytes || 0) > 0);
}

async function resolvePhoto(photoId: string) {
  const { cloudName, rootFolder } = cloudinaryConfig();
  const metadata = await findMetadata(photoId);
  if (metadata) {
    if (!String(metadata.public_id || '').startsWith(`${rootFolder}/`)) throw new HttpError(403, 'PHOTO_SCOPE', 'La risorsa non appartiene alla galleria Foto.');
    return normalizeResource({
      public_id: metadata.public_id,
      version: metadata.version,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      bytes: metadata.bytes,
      secure_url: metadata.original_url,
      created_at: metadata.created_at,
    }, cloudName, rootFolder, metadata);
  }
  const resources = await listCloudinary();
  const resource = resources.find((item) => item.public_id === photoId);
  if (!resource) throw new HttpError(404, 'PHOTO_NOT_FOUND', 'Foto non trovata.');
  return normalizeResource(resource, cloudName, rootFolder, null);
}

async function ensureMetadata(photoId: string) {
  const existing = await findMetadata(photoId);
  if (existing) return existing;
  const photo = await resolvePhoto(photoId);
  const record = resourceToRecord(photo, photo.teamId, photo.originalName || photo.name, {
    title: photo.title,
    description: photo.description,
    caption: photo.caption,
    altText: photo.altText,
    album: photo.album,
    order: photo.order,
  });
  return insertMetadata(record);
}

async function listResources(req: Request) {
  const url = new URL(req.url);
  const teamId = safeText(url.searchParams.get('teamId'), 80);
  const { cloudName, rootFolder } = cloudinaryConfig();
  const [resources, metadataResult] = await Promise.all([listCloudinary(teamId), listMetadata(teamId)]);
  const byPublicId = new Map(metadataResult.rows.map((row) => [row.public_id, row]));
  const photos = resources
    .map((resource) => normalizeResource(resource, cloudName, rootFolder, byPublicId.get(resource.public_id) || null))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (b.ts || 0) - (a.ts || 0));
  return json(req, { ok: true, photos, count: photos.length, metadataSource: metadataResult.available ? 'database' : 'cloudinary-fallback' });
}

function metadataFromForm(form: FormData) {
  return {
    title: form.get('title'),
    description: form.get('description'),
    caption: form.get('caption'),
    altText: form.get('altText'),
    album: form.get('album'),
    order: form.get('order'),
  };
}

async function uploadResources(req: Request) {
  const form = await req.formData();
  const files = [...form.getAll('files'), form.get('file')].filter((entry): entry is File => entry instanceof File);
  const uniqueFiles = files.filter((file, index) => files.indexOf(file) === index);
  if (!uniqueFiles.length) throw new HttpError(400, 'FILE_MISSING', 'Nessun file ricevuto nel campo multipart "file" o "files".');
  if (uniqueFiles.length > MAX_BATCH_FILES) throw new HttpError(413, 'BATCH_TOO_LARGE', `Puoi caricare al massimo ${MAX_BATCH_FILES} foto per batch.`);
  const totalBytes = uniqueFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BATCH_SIZE) throw new HttpError(413, 'BATCH_TOO_LARGE', 'Il batch supera il limite totale di 80 MB.');
  const teamId = cleanSegment(form.get('teamId'), 'team');
  const metadata = metadataFromForm(form);
  const created: any[] = [];
  const failed: any[] = [];
  for (const file of uniqueFiles) {
    let uploaded: any = null;
    try {
      await validateFile(file);
      uploaded = await cloudinaryUpload(file, teamId);
      const record = resourceToRecord(uploaded, teamId, file.name, metadata);
      const saved = await insertMetadata(record);
      created.push(normalizeResource(uploaded, cloudinaryConfig().cloudName, cloudinaryConfig().rootFolder, saved));
    } catch (error) {
      if (uploaded?.public_id) await cloudinaryDestroy(uploaded.public_id).catch(() => undefined);
      const httpError = error instanceof HttpError ? error : new HttpError(500, 'UPLOAD_FAILED', error instanceof Error ? error.message : 'Upload fallito.');
      failed.push({ name: safeFileName(file.name), code: httpError.code, message: httpError.message, status: httpError.status });
    }
  }
  const status = created.length && failed.length ? 207 : created.length ? 201 : failed[0]?.status || 400;
  return json(req, {
    ok: failed.length === 0,
    partial: created.length > 0 && failed.length > 0,
    created,
    failed,
    photo: created.length === 1 ? created[0] : undefined,
    message: failed.length ? `${created.length} foto caricate, ${failed.length} fallite.` : `${created.length} foto caricate.`,
  }, status);
}

async function updateMetadata(req: Request) {
  const body = await req.json().catch(() => ({}));
  const record = await ensureMetadata(String(body.photoId || body.publicId || body.id || ''));
  const patch = {
    title: safeText(body.title, 160),
    description: safeText(body.description, 2000),
    caption: safeText(body.caption, 1000),
    alt_text: safeText(body.altText, 300),
    album: safeText(body.album, 120),
    display_order: Number.isFinite(Number(body.order)) ? Number(body.order) : Number(record.display_order || 0),
  };
  const saved = await patchMetadata(record.id, patch);
  const photo = await resolvePhoto(saved.public_id);
  return json(req, { ok: true, photo, message: 'Metadati aggiornati.' });
}

async function replaceResource(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'FILE_MISSING', 'File sostitutivo mancante.');
  await validateFile(file);
  const old = await ensureMetadata(String(form.get('photoId') || form.get('publicId') || ''));
  const { rootFolder, cloudName } = cloudinaryConfig();
  if (!String(old.public_id).startsWith(`${rootFolder}/`)) throw new HttpError(403, 'PHOTO_SCOPE', 'La risorsa non appartiene alla galleria Foto.');
  const uploaded = await cloudinaryUpload(file, old.team_id);
  try {
    const record = resourceToRecord(uploaded, old.team_id, file.name, {
      title: form.get('title') ?? old.title,
      description: form.get('description') ?? old.description,
      caption: form.get('caption') ?? old.caption,
      altText: form.get('altText') ?? old.alt_text,
      album: form.get('album') ?? old.album,
      order: form.get('order') ?? old.display_order,
    });
    const saved = await patchMetadata(old.id, record);
    let oldResourceDeleted = true;
    try { await cloudinaryDestroy(old.public_id); } catch { oldResourceDeleted = false; }
    return json(req, {
      ok: true,
      photo: normalizeResource(uploaded, cloudName, rootFolder, saved),
      warning: oldResourceDeleted ? '' : 'La nuova foto è salvata, ma la vecchia risorsa Cloudinary richiede pulizia manuale.',
    });
  } catch (error) {
    await cloudinaryDestroy(uploaded.public_id).catch(() => undefined);
    throw error;
  }
}

async function deleteResource(req: Request) {
  const body = await req.json().catch(() => ({}));
  const photoId = String(body.photoId || body.publicId || body.path || '').trim();
  const photo = await resolvePhoto(photoId);
  const metadata = await findMetadata(photo.publicId);
  if (metadata) await deleteMetadata(metadata.id);
  try {
    await cloudinaryDestroy(photo.publicId);
  } catch (error) {
    if (metadata) await insertMetadata(metadata).catch(() => undefined);
    throw error;
  }
  return json(req, { ok: true, publicId: photo.publicId, message: 'Foto eliminata.' });
}

async function downloadOriginal(req: Request) {
  const url = new URL(req.url);
  const photo = await resolvePhoto(url.searchParams.get('photoId') || '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(photo.originalUrl, { signal: controller.signal });
    if (!response.ok) throw new HttpError(response.status, 'ORIGINAL_UNAVAILABLE', 'Originale non disponibile su Cloudinary.');
    const bytes = await response.arrayBuffer();
    return binary(req, bytes, 200, {
      'Content-Type': photo.mimeType || response.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(photo.name))}`,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new HttpError(504, 'DOWNLOAD_TIMEOUT', 'Download dell’originale scaduto.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueZipName(name: string, used: Set<string>) {
  const safe = safeFileName(name);
  if (!used.has(safe)) { used.add(safe); return safe; }
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let index = 2;
  let candidate = `${stem}_${index}${ext}`;
  while (used.has(candidate)) candidate = `${stem}_${++index}${ext}`;
  used.add(candidate);
  return candidate;
}

async function downloadZip(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((value: unknown) => String(value || '').trim()).filter(Boolean))] : [];
  const teamId = safeText(body.teamId, 80);
  if (!ids.length) throw new HttpError(400, 'ZIP_EMPTY', 'Seleziona almeno una foto per lo ZIP.');
  if (ids.length > MAX_ZIP_FILES) throw new HttpError(413, 'ZIP_TOO_LARGE', `Lo ZIP può contenere al massimo ${MAX_ZIP_FILES} foto.`);
  const photos = await Promise.all(ids.map((id: string) => resolvePhoto(id)));
  const expectedBytes = photos.reduce((sum, photo) => sum + Number(photo.originalSize || photo.size || photo.bytes || 0), 0);
  if (expectedBytes > MAX_ZIP_BYTES) throw new HttpError(413, 'ZIP_TOO_LARGE', 'La selezione supera il limite ZIP di 150 MB. Riduci il numero di foto.');
  if (teamId && photos.some((photo) => photo.teamId !== teamId)) throw new HttpError(403, 'ZIP_SCOPE', 'La selezione contiene foto di una squadra differente.');
  const zip = new JSZip();
  const used = new Set<string>();
  const failures: string[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < photos.length) {
      const photo = photos[cursor++];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetch(photo.originalUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        zip.file(uniqueZipName(photo.name, used), bytes, { binary: true, compression: 'STORE' });
      } catch {
        failures.push(photo.name);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker));
  if (failures.length) throw new HttpError(502, 'ZIP_INCOMPLETE', `ZIP non creato: ${failures.length} originali non sono disponibili.`, { failures });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const archiveName = safeFileName(`${safeText(body.teamName, 80) || 'foto-squadra'}-originali.zip`, 'foto-originali.zip');
  return binary(req, bytes, 200, {
    'Content-Type': 'application/zip',
    'Content-Length': String(bytes.byteLength),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
  });
}

async function route(req: Request) {
  ensureOriginAllowed(req);
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';
  if (ADMIN_METHODS.has(req.method) && action !== 'zip') await requireAdmin(req);
  if (req.method === 'GET' && action === 'download') return downloadOriginal(req);
  if (req.method === 'GET' && action === 'detail') return json(req, { ok: true, photo: await resolvePhoto(url.searchParams.get('photoId') || '') });
  if (req.method === 'GET') return listResources(req);
  if (req.method === 'POST' && action === 'zip') return downloadZip(req);
  if (req.method === 'POST') return uploadResources(req);
  if (req.method === 'PUT') return replaceResource(req);
  if (req.method === 'PATCH') return updateMetadata(req);
  if (req.method === 'DELETE') return deleteResource(req);
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Metodo non supportato.');
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') {
    try {
      ensureOriginAllowed(req);
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    } catch (error) {
      const httpError = error instanceof HttpError ? error : new HttpError(500, 'PREFLIGHT_FAILED', 'Preflight non riuscita.');
      return json(req, { ok: false, code: httpError.code, message: httpError.message }, httpError.status);
    }
  }
  try {
    const response = await route(req);
    console.info(JSON.stringify({ scope: 'team-photos', method: req.method, action: new URL(req.url).searchParams.get('action') || 'default', status: response.status, durationMs: Date.now() - startedAt }));
    return response;
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore funzione team-photos.');
    console.error(JSON.stringify({ scope: 'team-photos', method: req.method, action: new URL(req.url).searchParams.get('action') || 'default', status: httpError.status, code: httpError.code, durationMs: Date.now() - startedAt }));
    return json(req, { ok: false, code: httpError.code, message: httpError.message, details: httpError.details || undefined }, httpError.status);
  }
});
````

## `/mnt/data/ng-work/new-generation-main/supabase/functions/team-photos/config.toml`

````toml
# La verifica JWT del gateway viene disattivata per consentire OPTIONS e letture pubbliche.
# POST/PUT/PATCH/DELETE sono comunque protetti dentro index.ts tramite auth.getUser.
verify_jwt = false
````

## `/mnt/data/ng-work/new-generation-main/tools/edge-function-test-globals.d.ts`

````typescript
declare module 'npm:jszip@3.10.1' {
  const JSZip: any;
  export default JSZip;
}
declare namespace Deno {
  namespace env { function get(name: string): string | undefined; }
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}
````

## `/mnt/data/ng-work/new-generation-main/tools/test-photo-system.mjs`

````javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'assets/js/photos.js'),'utf8');

function createRuntime({fetchImpl,token='user-session-token'}={}){
  const events=[];
  const decodeImage=async()=>({width:1200,height:800,close(){}});
  const context={
    console,
    performance,
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    FormData,
    Blob,
    File,
    Response,
    Headers,
    Request,
    CustomEvent,
    setTimeout,
    clearTimeout,
    fetch:fetchImpl,
    createImageBitmap:decodeImage,
    Image:class {},
    document:{
      body:{appendChild(){}},
      createElement(){return {style:{},click(){},remove(){},set href(_){},set download(_){},set rel(_){}};}
    },
    window:{
      NEW_GENERATION_CLOUDINARY:{CLOUD_NAME:'demo',FOLDER:'squadra',SECTION:'foto-squadra',EDGE_FUNCTION:'team-photos'},
      NEW_GENERATION_SUPABASE:{URL:'https://project.supabase.co',ANON_KEY:'sb_publishable_test'},
      NG_SUPABASE_CLIENT:{auth:{getSession:async()=>({data:{session:token?{access_token:token}:null},error:null})}},
      location:{protocol:'https:'},
      dispatchEvent:event=>events.push(event),
      addEventListener(){},
      createImageBitmap:decodeImage,
    }
  };
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'assets/js/photos.js'});
  return {Photos:context.window.NexoraPhotos,events,context};
}

function jpegFile(name='foto prova.jpg'){
  return new File([new Uint8Array([0xff,0xd8,0xff,0xe0,0,1,2,3,4,5])],name,{type:'image/jpeg',lastModified:1});
}

function pngFile(name='foto verticale.png'){
  return new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,1,2,3])],name,{type:'image/png',lastModified:2});
}
function webpFile(name='foto panoramica.webp'){
  return new File([new Uint8Array([0x52,0x49,0x46,0x46,4,0,0,0,0x57,0x45,0x42,0x50,1,2,3,4])],name,{type:'image/webp',lastModified:3});
}

const results=[];
async function test(name,fn){
  try{await fn();results.push({name,result:'PASS'});console.log(`[photos] PASS · ${name}`);}
  catch(error){results.push({name,result:'FAIL',details:error.stack||String(error)});console.error(`[photos] FAIL · ${name}\n${error.stack||error}`);process.exitCode=1;}
}

await test('GET pubblico senza Authorization e senza preflight superflua',async()=>{
  let request;
  const {Photos}=createRuntime({fetchImpl:async(url,opts)=>{request={url,opts};return new Response(JSON.stringify({ok:true,photos:[]}),{status:200,headers:{'content-type':'application/json'}});}});
  await Photos.refreshAll({force:true});
  assert.equal(request.opts.method,'GET');
  assert.equal(request.opts.headers.Authorization,undefined);
  assert.equal(request.opts.headers['Content-Type'],undefined);
});

await test('upload multipart usa access token sessione e boundary del browser',async()=>{
  let request;
  const {Photos}=createRuntime({fetchImpl:async(url,opts)=>{
    request={url,opts};
    return new Response(JSON.stringify({ok:true,photo:{publicId:'squadra/team-a/id',teamId:'team-a',name:'foto prova.jpg',originalUrl:'https://res.cloudinary.com/demo/image/upload/id.jpg',thumbUrl:'https://res.cloudinary.com/demo/image/upload/c_fill/id.jpg',width:1200,height:800,size:10,format:'jpg'}}),{status:201,headers:{'content-type':'application/json'}});
  }});
  const photo=await Photos.uploadTeamPhoto('team-a',jpegFile());
  assert.equal(request.opts.method,'POST');
  assert.equal(request.opts.headers.Authorization,'Bearer user-session-token');
  assert.equal(request.opts.headers['Content-Type'],undefined);
  assert.ok(request.opts.body instanceof FormData);
  assert.ok(request.opts.body.get('file') instanceof File);
  assert.equal(request.opts.body.get('teamId'),'team-a');
  assert.equal(photo.publicId,'squadra/team-a/id');
});

await test('chiave pubblicabile non viene usata al posto della sessione',async()=>{
  let calls=0;
  const {Photos}=createRuntime({token:'',fetchImpl:async()=>{calls++;throw new Error('non deve essere chiamato');}});
  await assert.rejects(()=>Photos.uploadTeamPhoto('team-a',jpegFile()),error=>error?.code==='AUTH_REQUIRED');
  assert.equal(calls,0);
});

await test('errore di rete/CORS classificato senza Failed to fetch grezzo',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>{throw new TypeError('Failed to fetch');}});
  await assert.rejects(()=>Photos.refreshAll({force:true}),error=>{
    assert.equal(error.code,'NETWORK_ERROR');
    assert.match(Photos.userMessage(error),/Server Foto non raggiungibile/);
    return true;
  });
});

await test('validazione rifiuta formato e firma binaria incoerenti',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  const fake=new File([new TextEncoder().encode('not an image')],'finta.jpg',{type:'image/jpeg'});
  await assert.rejects(()=>Photos.validateImageFile(fake),error=>error?.code==='CORRUPT_FILE');
  const gif=new File([new TextEncoder().encode('GIF89a')],'animata.gif',{type:'image/gif'});
  await assert.rejects(()=>Photos.validateImageFile(gif),error=>error?.code==='UNSUPPORTED_TYPE');
});

await test('JPEG, PNG e WebP validi superano firma e decodifica',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  for(const file of [jpegFile(),pngFile(),webpFile()]){
    const meta=await Photos.validateImageFile(file);
    assert.equal(meta.width,1200);
    assert.equal(meta.height,800);
  }
});

await test('limiti per file e batch vengono applicati prima della rete',async()=>{
  let calls=0;
  const {Photos}=createRuntime({fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}});
  const tooLarge=new File([new Uint8Array(10*1024*1024+1)],'grande.jpg',{type:'image/jpeg'});
  await assert.rejects(()=>Photos.validateImageFile(tooLarge),error=>error?.code==='FILE_TOO_LARGE');
  await assert.rejects(()=>Photos.validateBatch(Array.from({length:21},(_,i)=>jpegFile(`foto-${i}.jpg`))),error=>error?.code==='BATCH_TOO_LARGE');
  assert.equal(calls,0);
});

await test('interruzione upload produce errore recuperabile distinto',async()=>{
  const controller=new AbortController();
  const {Photos}=createRuntime({fetchImpl:async(_url,opts)=>new Promise((_resolve,reject)=>{
    const fail=()=>reject(new DOMException('Aborted','AbortError'));
    if(opts.signal.aborted){fail();return;}
    opts.signal.addEventListener('abort',fail,{once:true});
  })});
  const promise=Photos.uploadTeamPhoto('team-a',jpegFile(),{signal:controller.signal});
  controller.abort();
  await assert.rejects(()=>promise,error=>error?.code==='REQUEST_ABORTED');
});

await test('download singolo e ZIP passano dalla Edge Function Foto',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  const url=Photos.originalDownloadUrl({publicId:'squadra/team-a/id'});
  assert.match(url,/functions\/v1\/team-photos\?action=download/);
  assert.match(url,/photoId=squadra%2Fteam-a%2Fid/);
  assert.match(source,/action:'zip'/);
  assert.doesNotMatch(source,/fetch\(photo\.originalUrl/);
});

await test('backend Foto separato da endpoint e modelli Articoli',async()=>{
  const edge=fs.readFileSync(path.join(root,'supabase/functions/team-photos/index.ts'),'utf8');
  const config=fs.readFileSync(path.join(root,'supabase/functions/team-photos/config.toml'),'utf8');
  const sql=fs.readFileSync(path.join(root,'SUPABASE_SETUP.sql'),'utf8');
  assert.match(edge,/team_photos/);
  assert.match(edge,/rootFolder.*squadra/);
  assert.match(edge,/action === 'zip'/);
  assert.match(edge,/MAX_ZIP_BYTES = 150/);
  assert.match(edge,/req\.method === 'OPTIONS'/);
  assert.match(edge,/ORIGIN_NOT_ALLOWED/);
  assert.match(edge,/MAX_IMAGE_PIXELS/);
  assert.doesNotMatch(edge,/from\(['"]articles|\/articles\?|article_images/);
  assert.match(config,/verify_jwt\s*=\s*false/);
  assert.match(sql,/create table if not exists public\.team_photos/);
  assert.match(sql,/team_photos_gallery_scope/);
});

await test('UI upload dichiara limiti e soli JPEG/PNG/WebP',async()=>{
  const html=fs.readFileSync(path.join(root,'admin-photos.html'),'utf8');
  assert.match(html,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(html,/image\/gif/);
  assert.match(html,/max 20 file \/ 80 MB/);
});

console.log(JSON.stringify({root,tests:results.length,results},null,2));
if(process.exitCode)process.exit(process.exitCode);
````

## `/mnt/data/ng-work/new-generation-main/tools/test-ui-stability.mjs`

````javascript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const chromium=process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const pages=['index.html','admin.html','admin-rules.html','admin-groups.html','admin-teams.html','admin-players.html','admin-matches.html','admin-articles.html','admin-photos.html','admin-reports.html','admin-customize.html','print.html','404.html'];
const widths=[320,360,375,390,412,480,768,1024,1280,1440,1920];
const results=[];
const runtimeErrors=[];
const localNetworkErrors=[];
let browser;
let server;
let client;
let fixtureRoot='';
let storageState={};

function record(name,ok,details=''){
  results.push({test:name,result:ok?'PASS':'FAIL',details});
  if(!ok) process.exitCode=1;
}
function assert(condition,message){if(!condition)throw new Error(message);}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function mime(file){
  const ext=path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'})[ext]||'application/octet-stream';
}
function transformHtml(text){
  return text.replace(/<script\s+defer\s+src="https:\/\/cdn\.jsdelivr\.net\/[^"]+"><\/script>/g,'');
}
function prepareFileFixture(){
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'ng-ui-files-'));
  fs.cpSync(root,target,{recursive:true,filter:src=>!['dist','node_modules','.git'].includes(path.basename(src))});
  for(const page of pages){
    const file=path.join(target,page);
    fs.writeFileSync(file,transformHtml(fs.readFileSync(file,'utf8')));
  }
  const config=path.join(target,'assets/js/supabase-config.js');
  fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('ENABLED: true','ENABLED: false'));
  return target;
}
function storagePrelude(){
  const seed=JSON.stringify(storageState).replaceAll('<','\\u003c');
  return `<script>(function(){
    const seed=${seed};
    const storage={};
    const define=(key,value)=>Object.defineProperty(storage,String(key),{value:String(value),writable:true,enumerable:true,configurable:true});
    Object.defineProperties(storage,{
      getItem:{value:key=>Object.prototype.hasOwnProperty.call(storage,String(key))?String(storage[String(key)]):null},
      setItem:{value:(key,value)=>define(key,value)},
      removeItem:{value:key=>{delete storage[String(key)];}},
      clear:{value:()=>{Object.keys(storage).forEach(key=>delete storage[key]);}},
      key:{value:index=>Object.keys(storage)[Number(index)]??null},
      length:{get:()=>Object.keys(storage).length}
    });
    Object.entries(seed).forEach(([key,value])=>define(key,value));
    Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
  })();<\/script>`;
}
function bundlePage(page){
  const file=path.join(fixtureRoot,page);
  let html=fs.readFileSync(file,'utf8');
  const css=fs.readFileSync(path.join(fixtureRoot,'assets/css/styles.css'),'utf8').replace(/<\/style/gi,'<\\/style');
  html=html.replace(/<link\s+rel="stylesheet"\s+href="assets\/css\/styles\.css[^\"]*">/i,`<style>${css}</style>`);
  html=html.replace(/<script\s+defer\s+src="(assets\/js\/[^\"]+)"\s*><\/script>/gi,(_,src)=>{
    const rel=src.split('?')[0];
    const code=fs.readFileSync(path.join(fixtureRoot,rel),'utf8').replace(/<\/script/gi,'<\\/script');
    return `<script>${code}\n//# sourceURL=${rel}<\/script>`;
  });
  html=html.replace('<head>','<head>'+storagePrelude());
  return html;
}
function startServer(){
  return new Promise(resolve=>{
    server=http.createServer((req,res)=>{
      try{
        const url=new URL(req.url,'http://127.0.0.1');
        let rel=decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if(rel.endsWith('/'))rel+='index.html';
        const full=path.resolve(root,rel);
        if(!full.startsWith(root+path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()){
          res.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('Not found');return;
        }
        let body=fs.readFileSync(full);
        if(rel.endsWith('.html'))body=Buffer.from(transformHtml(body.toString('utf8')));
        if(rel==='assets/js/supabase-config.js')body=Buffer.from(body.toString('utf8').replace('ENABLED: true','ENABLED: false'));
        res.writeHead(200,{'content-type':mime(full),'cache-control':'no-store','content-length':body.length});
        res.end(body);
      }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(String(error));}
    });
    server.listen(0,'127.0.0.1',()=>resolve(server.address().port));
  });
}
function freePort(){
  return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
}
async function waitFor(fn,{timeout=8000,interval=40,label='condition'}={}){
  const start=Date.now();let last;
  while(Date.now()-start<timeout){try{last=await fn();if(last)return last;}catch(error){last=error;}await delay(interval);}
  throw new Error(`Timeout waiting for ${label}${last instanceof Error?`: ${last.message}`:''}`);
}
class CDPClient{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.handlers=new Map();}
  async connect(){
    await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});
    this.ws.addEventListener('message',event=>{
      const msg=JSON.parse(event.data);
      if(msg.id){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);if(msg.error)p.reject(new Error(msg.error.message));else p.resolve(msg.result);return;}
      const list=this.handlers.get(msg.method)||[];for(const fn of list)fn(msg.params||{});
    });
  }
  on(method,fn){const list=this.handlers.get(method)||[];list.push(fn);this.handlers.set(method,list);}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){this.ws.close();}
}
async function launchBrowser(){
  const port=await freePort();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ng-ui-chromium-'));
  browser=spawn(chromium,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--allow-file-access-from-files',
    '--disable-component-update','--disable-default-apps','--disable-extensions','--disable-sync','--metrics-recording-only',
    '--no-first-run','--no-proxy-server',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  let stderr='';browser.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  await waitFor(async()=>{try{const r=await fetch(`http://127.0.0.1:${port}/json/list`);return r.ok;}catch{return false;}},{timeout:10000,label:'Chromium DevTools'});
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=targets.find(t=>t.type==='page');
  if(!target)throw new Error(`No page target. Chromium stderr: ${stderr.slice(-1000)}`);
  client=new CDPClient(new WebSocket(target.webSocketDebuggerUrl));
  await client.connect();
  await Promise.all([client.send('Page.enable'),client.send('Runtime.enable'),client.send('Network.enable'),client.send('Log.enable')]);
  client.on('Runtime.exceptionThrown',p=>runtimeErrors.push({url:currentUrl,description:p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'Runtime exception'}));
  client.on('Runtime.consoleAPICalled',p=>{if(p.type==='error')runtimeErrors.push({url:currentUrl,description:(p.args||[]).map(a=>a.value||a.description||'').join(' ')});});
  client.on('Network.loadingFailed',p=>{const u=requestUrls.get(p.requestId)||'';if(u.startsWith(baseUrl))localNetworkErrors.push({url:u,error:p.errorText});});
  client.on('Network.requestWillBeSent',p=>requestUrls.set(p.requestId,p.request.url));
}
const requestUrls=new Map();
let baseUrl='';
let currentUrl='';
async function evaluate(expression,{awaitPromise=true}={}){
  const r=await client.send('Runtime.evaluate',{expression,awaitPromise,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text||'Evaluation failed');
  return r.result?.value;
}
async function setViewport(width,height=900){
  await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=480,screenWidth:width,screenHeight:height});
}
async function navigate(page){
  try{
    const saved=await evaluate(`(()=>{try{const out={};for(const key of Object.keys(localStorage))out[key]=localStorage.getItem(key);return out;}catch(_){return null;}})()`);
    if(saved)storageState=saved;
  }catch{}
  currentUrl=`inline://${page}`;
  const tree=await client.send('Page.getFrameTree');
  await client.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:bundlePage(page)});
  await waitFor(()=>evaluate(`document.readyState==='complete' && !!document.body`),{timeout:10000,label:`load ${page}`});
  await delay(180);
}
async function pressKey(key,code=key){
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code});
  await delay(60);
}
async function click(selector){
  const ok=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.focus?.({preventScroll:true});el.click();return true;})()`);
  assert(ok,`Elemento non trovato: ${selector}`);await delay(70);
}
async function seedState(){
  const ok=await evaluate(`(()=>{
    const store=window.NexoraStore;if(!store)return false;
    const crest=(w,h,body)=>'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+body+'</svg>');
    const circle=crest(100,100,'<circle cx="50" cy="50" r="48" fill="#d7a42d"/><circle cx="50" cy="50" r="30" fill="#101820"/><text x="50" y="57" text-anchor="middle" font-size="22" fill="#fff">A</text>');
    const square=crest(100,100,'<rect x="1" y="1" width="98" height="98" fill="#174f9b"/><path d="M10 90L50 5L90 90Z" fill="#fff"/><text x="50" y="78" text-anchor="middle" font-size="18" fill="#174f9b">N</text>');
    const wide=crest(240,80,'<path d="M2 40L28 3H212L238 40L212 77H28Z" fill="#8a1538"/><text x="120" y="51" text-anchor="middle" font-size="30" fill="#fff">WIDE CLUB</text>');
    const tall=crest(80,240,'<path d="M40 2L77 42V190L40 238L3 190V42Z" fill="#19713f"/><circle cx="40" cy="72" r="24" fill="#fff"/><text x="40" y="168" text-anchor="middle" font-size="28" fill="#fff">T</text>');
    const transparent=crest(120,120,'<path d="M60 0L74 40L120 45L84 72L96 120L60 92L24 120L36 72L0 45L46 40Z" fill="#f4d878"/><circle cx="60" cy="60" r="22" fill="#111"/><text x="60" y="68" text-anchor="middle" font-size="22" fill="#fff">X</text>');
    const state=store.normalizeState({
      rules:{...store.blankRules(),name:'Test stabilità UI',format:'league_knockout',startDate:'2026-06-20',eliminationCompetitions:[{id:'gold',name:'Oro',teams:4,startRank:1}]},
      site:{...store.defaultSite(),title:'Test stabilità UI'},
      teams:[
        {id:'team_a',name:'Aurora FC',logo:circle,president:{id:'pres_a',name:'Ada Rossi'},coach:{name:'Luca Bianchi'},players:[{id:'player_a',name:'Marco Verdi',birthYear:2001,number:9}]},
        {id:'team_b',name:'Nova United',logo:square,president:{id:'pres_b',name:'Sara Neri'},coach:{name:'Paolo Blu'},players:[{id:'player_b',name:'Andrea Gialli',birthYear:2000,number:10}]},
        {id:'team_c',name:'Wide Club',logo:wide,president:{id:'pres_c',name:'Marta Viola'},coach:{name:'Elio Rosa'},players:[{id:'player_c',name:'Lorenzo Ambra',birthYear:1999,number:7}]},
        {id:'team_d',name:'Tall Athletic',logo:tall,president:{id:'pres_d',name:'Nora Verde'},coach:{name:'Ivan Bianco'},players:[{id:'player_d',name:'Davide Bruno',birthYear:2002,number:11}]},
        {id:'team_e',name:'Transparent Stars',logo:transparent,president:{id:'pres_e',name:'Eva Oro'},coach:{name:'Carlo Nero'},players:[{id:'player_e',name:'Fabio Ciano',birthYear:2003,number:4}]},
        {id:'team_f',name:'Senza Stemma',logo:'',president:{id:'pres_f',name:'Lia Grigia'},coach:{name:'Ugo Rosso'},players:[{id:'player_f',name:'Piero Blu',birthYear:2001,number:5}]}
      ],
      matches:[
        {id:'match_1',phase:'league',round:'Giornata 1',roundIndex:0,homeTeamId:'team_a',awayTeamId:'team_b',date:'2026-06-20',time:'18:00',field:'Campo 1',referee:'Arbitro Test',status:'scheduled',goals:[],cards:[]},
        {id:'match_2',phase:'league',round:'Giornata 1',roundIndex:0,homeTeamId:'team_c',awayTeamId:'team_d',date:'2026-06-20',time:'19:00',field:'Campo 2',referee:'Arbitro Test 2',status:'scheduled',goals:[],cards:[]},
        {id:'match_ko',phase:'playoff',round:'Semifinale Oro 1',roundIndex:1,bracketRound:'Semifinali',bracketName:'Oro',bracketRoundIndex:1,bracketMatchIndex:1,homeTeamId:'team_e',awayTeamId:'team_a',date:'2026-06-21',time:'20:00',field:'Campo 1',referee:'Arbitro KO',status:'scheduled',goals:[],cards:[]}
      ],
      articles:[
        {id:'article_1',title:'Notizia test',body:'Contenuto di prova per la stabilità della modale.',image:'',category:'Aggiornamenti',author:'Redazione Test',status:'published',slug:'notizia-test',publishedAt:'2026-06-20T10:00:00Z',createdAt:'2026-06-20T10:00:00Z',updatedAt:'2026-06-20T10:00:00Z'},
        {id:'article_2',title:'Titolo molto lungo per verificare che la card editoriale rimanga leggibile senza tagliare informazioni importanti su smartphone e desktop',subtitle:'Sottotitolo editoriale con caratteri accentati, emoji ⚽ e informazioni aggiuntive',excerpt:'Estratto lungo usato per controllare il troncamento visivo controllato senza perdita del contenuto completo.',body:'## Analisi completa\\nPrimo paragrafo con **grassetto**, *corsivo* e [collegamento](https://example.com).\\n- Prima voce\\n- Seconda voce\\n> Una citazione leggibile.\\nParolaMoltoLungaSenzaSpaziCheNonDeveCreareScrollOrizzontale1234567890',image:tall,imageAlt:'Locandina verticale del torneo',imageCaption:'Didascalia immagine verticale',category:'Approfondimenti',author:'Ada Rossi',tags:['torneo','analisi'],status:'published',slug:'analisi-completa',publishedAt:'2026-06-21T12:00:00Z',createdAt:'2026-06-21T11:00:00Z',updatedAt:'2026-06-21T12:00:00Z'},
        {id:'article_3',title:'Bozza riservata',body:'<script>window.__articleXss=true</script> Testo bozza.',image:wide,category:'Comunicati',author:'Admin',status:'draft',slug:'bozza-riservata',createdAt:'2026-06-21T13:00:00Z',updatedAt:'2026-06-21T13:00:00Z'},
        {id:'article_4',title:'Articolo programmato futuro',body:'Non deve essere ancora visibile.',image:circle,category:'Programmati',author:'Admin',status:'scheduled',slug:'programmato-futuro',publishedAt:'2099-01-01T09:00:00Z',createdAt:'2026-06-21T14:00:00Z',updatedAt:'2026-06-21T14:00:00Z'}
      ],
      teamPhotos:{team_a:[{path:'test/photo-1.jpg',name:'photo-1.jpg',size:2048,ts:1781949600000}]}
    });
    localStorage.setItem(store.PUBLIC_KEY,JSON.stringify(state));
    localStorage.setItem(store.ADMIN_KEY,JSON.stringify(state));
    return true;
  })()`);
  assert(ok,'Store non disponibile per seed');
}
async function overlayState(selector){return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return {exists:!!el,open:!!el&&(el.classList.contains('open')||el.classList.contains('show')),count:document.querySelectorAll(${JSON.stringify(selector)}).length,bodyLocked:document.body.classList.contains('ng-overlay-open'),overflow:getComputedStyle(document.body).overflow,activeId:document.activeElement?.id||'',activeText:document.activeElement?.textContent?.trim()||'',scrollY:window.scrollY,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};})()`);}

async function testPageLoads(){
  const beforeErrors=runtimeErrors.length,beforeNetwork=localNetworkErrors.length;
  for(const page of pages){await setViewport(1280,900);await navigate(page);const hasRuntime=await evaluate(`typeof window.NGInteractive==='object'`);if(!hasRuntime){const debug=await evaluate(`({scripts:[...document.scripts].map(s=>({src:s.src,ready:s.readyState})),html:document.documentElement.outerHTML.slice(-1000)})`);throw new Error(`${page}: runtime interattivo assente; errors=${JSON.stringify(runtimeErrors)}; debug=${JSON.stringify(debug)}`);}}
  record('Avvio e caricamento delle 13 pagine HTML',runtimeErrors.length===beforeErrors && localNetworkErrors.length===beforeNetwork,`13/13 caricate; errori runtime nuovi ${runtimeErrors.length-beforeErrors}; richieste locali fallite ${localNetworkErrors.length-beforeNetwork}`);
}
async function testResponsive(){
  await navigate('index.html');await seedState();await navigate('index.html');
  const failures=[];
  for(const width of widths){
    await setViewport(width,900);await delay(90);
    const m=await evaluate(`({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,body:document.body.scrollWidth-document.documentElement.clientWidth,modal:document.querySelector('#matchModal')?.getBoundingClientRect().width||0})`);
    if(m.doc>1||m.body>1)failures.push(`${width}px doc=${m.doc} body=${m.body}`);
  }
  record('Responsive e overflow orizzontale',failures.length===0,failures.length?failures.join('; '):widths.map(w=>`${w}px`).join(', '));
}
async function testTeamLogoRendering(){
  const failures=[];
  const samples=[];
  const inspect=async(label,{requireRendered=true}={})=>{
    const data=await evaluate(`(()=>{
      const style=document.getElementById('ngTeamLogos');
      const wrappers=[...document.querySelectorAll('.team-logo-wrap')];
      const withLogo=wrappers.filter(el=>[...el.classList].some(c=>c.startsWith('ng-tl-')));
      const fallbackWrappers=wrappers.filter(el=>el.querySelector(':scope > .team-logo-fallback'));
      const fallbackChecks=fallbackWrappers.map(el=>{
        const f=el.querySelector(':scope > .team-logo-fallback');
        const before=getComputedStyle(f,'::before'),after=getComputedStyle(f,'::after');
        return {beforeContent:before.content,afterContent:after.content,beforeClip:before.clipPath,afterClip:after.clipPath};
      });
      const rows=withLogo.map(el=>{
        const cs=getComputedStyle(el);
        const id=el.dataset.teamId||'';
        const className=[...el.classList].find(c=>c.startsWith('ng-tl-'))||'';
        const r=el.getBoundingClientRect();
        return {id,className,aria:el.getAttribute('aria-label')||'',backgroundImage:cs.backgroundImage,backgroundSize:cs.backgroundSize,backgroundPosition:cs.backgroundPosition,overflow:cs.overflow,borderRadius:cs.borderRadius,pointerEvents:cs.pointerEvents,width:parseFloat(cs.width)||r.width,height:parseFloat(cs.height)||r.height,children:el.children.length,fallbacks:el.querySelectorAll(':scope > .team-logo-fallback').length};
      });
      return {
        styleCount:document.querySelectorAll('#ngTeamLogos').length,
        styleText:style?.textContent||'',
        wrapperCount:wrappers.length,
        withLogoCount:withLogo.length,
        fallbackCount:fallbackWrappers.length,
        rows,
        fallbackChecks,
        loadingPlaceholders:document.querySelectorAll('.team-logo-wrap .skeleton,.team-logo-wrap .loader,.team-logo-wrap [class*="placeholder"]').length,
        brokenTeamImages:[...document.querySelectorAll('img.team-logo')].filter(img=>!img.complete||img.naturalWidth===0).length,
        dataImageRequests:performance.getEntriesByType('resource').filter(e=>String(e.name).startsWith('data:image/')).length
      };
    })()`);
    samples.push({label,wrapperCount:data.wrapperCount,withLogoCount:data.withLogoCount,fallbackCount:data.fallbackCount});
    const fail=message=>failures.push(label+': '+message);
    if(data.styleCount!==1)fail('atteso un solo #ngTeamLogos, trovati '+data.styleCount);
    for(const id of ['team_a','team_b','team_c','team_d','team_e'])if(!data.styleText.includes('.ng-tl-'+id+'{background-image:url(data:image/svg+xml;base64,'))fail('regola CSS assente per '+id);
    if(requireRendered&&data.withLogoCount===0)fail('nessuno stemma reale renderizzato');
    if(data.loadingPlaceholders!==0)fail('placeholder/loader visibile nel componente stemma');
    if(data.brokenTeamImages!==0)fail('immagine stemma rotta');
    if(data.dataImageRequests!==0)fail('i data URL hanno generato richieste di rete');
    for(const row of data.rows){
      if(row.className!=='ng-tl-'+row.id)fail('associazione squadra-classe errata per '+row.id+' ('+row.className+')');
      if(row.aria!=='Stemma di '+({team_a:'Aurora FC',team_b:'Nova United',team_c:'Wide Club',team_d:'Tall Athletic',team_e:'Transparent Stars'}[row.id]||''))fail('testo alternativo errato per '+row.id+': '+row.aria);
      if(row.backgroundImage==='none')fail('background-image assente per '+row.id);
      if(row.backgroundSize!=='contain')fail('background-size non contain per '+row.id+': '+row.backgroundSize);
      if(!row.backgroundPosition.includes('50%'))fail('stemma non centrato per '+row.id+': '+row.backgroundPosition);
      if(row.overflow!=='visible')fail('overflow può ritagliare '+row.id+': '+row.overflow);
      if(row.borderRadius!=='0px')fail('border-radius può mascherare '+row.id+': '+row.borderRadius);
      if(row.pointerEvents!=='none')fail('lo stemma intercetta eventi per '+row.id);
      if(row.width<=0||row.height<=0)fail('dimensioni non riservate per '+row.id);
      if(row.children!==0||row.fallbacks!==0)fail('fallback sovrapposto allo stemma '+row.id);
    }
    for(const f of data.fallbackChecks){
      if(!['none','normal'].includes(f.beforeContent)||!['none','normal'].includes(f.afterContent))fail('pseudo-elemento fallback ancora attivo');
      if(f.beforeClip!=='none'||f.afterClip!=='none')fail('clip-path fallback ancora attivo');
    }
    return data;
  };

  await setViewport(1280,900);await navigate('index.html');await seedState();
  await client.send('Network.setCacheDisabled',{cacheDisabled:true});
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:64000,uploadThroughput:32000,connectionType:'cellular3g'});
  await navigate('index.html');
  await inspect('pubblico primo caricamento lento / classifica');
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'none'});
  await client.send('Network.setCacheDisabled',{cacheDisabled:false});

  await click('[data-tab="teams"]');await inspect('pubblico card squadre e roster');
  await click('[data-team-detail="team_a"]');await inspect('pubblico dettaglio squadra e modale');await pressKey('Escape');
  await click('[data-tab="matches"]');await inspect('pubblico card partite e calendario');
  await click('[data-match-detail="match_1"]');await inspect('pubblico dettaglio partita e modale');await pressKey('Escape');
  await click('[data-tab="bracket"]');await inspect('pubblico tabellone');
  await click('[data-tab="search"]');
  await evaluate(`(()=>{const q=document.querySelector('#globalSearch');q.value='Aurora';q.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await delay(80);await inspect('pubblico ricerca e filtro');

  const reversed=await evaluate(`(()=>{const store=window.NexoraStore;const state=store.load('public');state.teams=state.teams.slice().reverse();store.save('public',state);return state.teams.map(t=>t.id).join(',');})()`);
  assert(reversed==='team_f,team_e,team_d,team_c,team_b,team_a','Riordinamento squadre non applicato nel test');
  await navigate('index.html');await click('[data-tab="teams"]');await inspect('pubblico ordinamento invertito e associazione squadra-stemma');

  for(const [width,height,label] of [[768,1024,'tablet'],[390,844,'smartphone verticale'],[844,390,'smartphone orizzontale']]){
    await setViewport(width,height);await navigate('index.html');await click('[data-tab="teams"]');await inspect('pubblico '+label);
  }

  await setViewport(1280,900);
  for(const page of ['admin.html','admin-teams.html','admin-players.html','admin-matches.html','admin-groups.html','admin-photos.html']){
    await navigate(page);await inspect('admin '+page,{requireRendered:!['admin.html','admin-groups.html'].includes(page)});
  }

  await navigate('index.html');await inspect('pubblico ritorno pagina / cache popolata');
  await navigate('index.html');
  await waitFor(()=>evaluate(`document.readyState==='complete' && !!document.querySelector('#ngTeamLogos')`),{timeout:10000,label:'reload con cache'});await delay(180);
  await inspect('pubblico refresh completo');

  record('Stemmi web: niente forma dorata, contain, associazione stabile, accessibilità, caricamento e responsive',failures.length===0,failures.length?failures.join('; '):JSON.stringify(samples));
}

async function testBusyButton(){
  await setViewport(1280,900);await navigate('admin.html');
  const data=await evaluate(`(()=>{const b=document.querySelector('#resetAllBtn');const before=b.getBoundingClientRect();const first=NGInteractive.setButtonBusy(b,true,'Operazione molto lunga…');const during=b.getBoundingClientRect();const second=NGInteractive.setButtonBusy(b,true,'Ancora…');const disabled=b.disabled;NGInteractive.setButtonBusy(b,false);const after=b.getBoundingClientRect();return {first,second,disabled,before:{w:before.width,h:before.height},during:{w:during.width,h:during.height},after:{w:after.width,h:after.height},busy:NGInteractive.isButtonBusy(b)};})()`);
  const stable=Math.abs(data.before.w-data.during.w)<1 && Math.abs(data.before.h-data.during.h)<1 && Math.abs(data.before.w-data.after.w)<1 && Math.abs(data.before.h-data.after.h)<1;
  record('Pulsante loading: dimensioni stabili e click multipli bloccati',stable&&data.first&&!data.second&&data.disabled&&!data.busy,JSON.stringify(data));
}
async function testAdminResetDialog(){
  await setViewport(1280,900);await navigate('admin.html');
  await evaluate(`window.scrollTo(0,Math.min(240,document.documentElement.scrollHeight-window.innerHeight))`);const scrollBefore=await evaluate('window.scrollY');
  const geometryBefore=await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();const b=document.querySelector('#resetAllBtn').getBoundingClientRect();return {headerX:r.x,headerW:r.width,buttonX:b.x,buttonW:b.width};})()`);
  await click('#resetAllBtn');let st=await overlayState('#resetTournamentDialog');
  assert(st.open&&st.count===1&&st.bodyLocked,'Reset non aperto o scroll non bloccato');
  const geometryOpen=await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();const b=document.querySelector('#resetAllBtn').getBoundingClientRect();return {headerX:r.x,headerW:r.width,buttonX:b.x,buttonW:b.width};})()`);
  await click('#cancelResetBtn');await delay(80);st=await overlayState('#resetTournamentDialog');
  assert(!st.open&&!st.bodyLocked,'Reset non chiuso o scroll ancora bloccato');
  const focusButton=await evaluate(`document.activeElement===document.querySelector('#resetAllBtn')`);
  for(let i=0;i<10;i++){await click('#resetAllBtn');await click('#cancelResetBtn');}
  let residual=await overlayState('#resetTournamentDialog');
  const cyclesOk=!residual.open&&!residual.bodyLocked&&residual.count===1;
  await evaluate(`document.querySelector('#resetAllBtn').click();document.querySelector('#resetAllBtn').click()`);await delay(80);
  st=await overlayState('#resetTournamentDialog');const doubleOk=st.open&&st.count===1;
  await pressKey('Escape');st=await overlayState('#resetTournamentDialog');const escapeOk=!st.open&&!st.bodyLocked;
  await click('#resetAllBtn');await click('#resetTournamentDialog');st=await overlayState('#resetTournamentDialog');const backdropOk=!st.open&&!st.bodyLocked;
  const scrollAfter=await evaluate('window.scrollY');
  const geometryAfter=await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();const b=document.querySelector('#resetAllBtn').getBoundingClientRect();return {headerX:r.x,headerW:r.width,buttonX:b.x,buttonW:b.width};})()`);
  const delta=(a,b)=>Math.abs(a-b)<1;
  const noShift=['headerX','headerW','buttonX','buttonW'].every(k=>delta(geometryBefore[k],geometryOpen[k])&&delta(geometryBefore[k],geometryAfter[k]));
  record('Modale reset: apertura/chiusura, 10 cicli, doppio click, Escape, backdrop, focus e scroll',focusButton&&cyclesOk&&doubleOk&&escapeOk&&backdropOk&&Math.abs(scrollBefore-scrollAfter)<1&&noShift,JSON.stringify({focusButton,cyclesOk,doubleOk,escapeOk,backdropOk,scrollBefore,scrollAfter,noShift,geometryBefore,geometryOpen,geometryAfter,residual}));
}
async function testMobileSheet(){
  await setViewport(390,844);await navigate('index.html');
  const opener='.mobile-more-trigger';
  const widthBefore=await evaluate('document.documentElement.clientWidth');
  await click(opener);let st=await overlayState('.mobile-nav-sheet');assert(st.open&&st.bodyLocked,'Menu mobile non aperto');
  await pressKey('Escape');st=await overlayState('.mobile-nav-sheet');const focusOk=await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(opener)})`);
  const escapeOk=!st.open&&!st.bodyLocked&&focusOk;
  for(let i=0;i<10;i++){await click(opener);await pressKey('Escape');}
  let residual=await overlayState('.mobile-nav-sheet');const cyclesOk=!residual.open&&!residual.bodyLocked&&residual.count===1;
  await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(opener)});b.click();b.click();return true;})()`);await delay(80);st=await overlayState('.mobile-nav-sheet');const doubleOk=st.open&&st.count===1;
  await click('.mobile-nav-backdrop');st=await overlayState('.mobile-nav-sheet');const backdropOk=!st.open&&!st.bodyLocked;
  const widthAfter=await evaluate('document.documentElement.clientWidth');
  record('Menu mobile: 10 cicli, doppio click, Escape, backdrop, focus e larghezza pagina',escapeOk&&cyclesOk&&doubleOk&&backdropOk&&widthBefore===widthAfter,JSON.stringify({escapeOk,cyclesOk,doubleOk,backdropOk,widthBefore,widthAfter,residual}));
}
async function testFilterAndPublicModals(){
  await setViewport(390,844);await navigate('index.html');
  await click('[data-tab="matches"]');await click('[data-open-match-filter="phase"]');
  let st=await overlayState('#matchFilterSheet');const filterOpen=st.open&&st.bodyLocked;
  await click('#matchFilterSheet');st=await overlayState('#matchFilterSheet');const filterBackdrop=!st.open&&!st.bodyLocked;
  await click('[data-open-match-filter="phase"]');await pressKey('Escape');st=await overlayState('#matchFilterSheet');const filterEscape=!st.open&&!st.bodyLocked;
  await click('[data-match-detail="match_1"]');st=await overlayState('#matchModal');const matchOpen=st.open&&st.bodyLocked;
  await click('#matchModal');st=await overlayState('#matchModal');const matchBackdrop=!st.open&&!st.bodyLocked;
  await click('[data-match-detail="match_1"]');await pressKey('Escape');st=await overlayState('#matchModal');const matchEscape=!st.open&&!st.bodyLocked;
  await click('[data-tab="teams"]');await click('[data-team-detail="team_a"]');st=await overlayState('#teamModal');const teamOpen=st.open&&st.bodyLocked;
  await pressKey('Escape');st=await overlayState('#teamModal');const teamEscape=!st.open&&!st.bodyLocked;
  await click('[data-tab="articles"]');await click('[data-article-open="article_1"]');st=await overlayState('#articleModal');const articleOpen=st.open&&st.bodyLocked;
  await click('#articleModal');st=await overlayState('#articleModal');const articleBackdrop=!st.open&&!st.bodyLocked;
  const residual=await evaluate(`document.querySelectorAll('.modal.open,.filter-sheet-modal.open,.ng-confirm-overlay.open').length`);
  record('Filtri e modali pubbliche: apertura, Escape, backdrop e assenza residui',filterOpen&&filterBackdrop&&filterEscape&&matchOpen&&matchBackdrop&&matchEscape&&teamOpen&&teamEscape&&articleOpen&&articleBackdrop&&residual===0,JSON.stringify({filterOpen,filterBackdrop,filterEscape,matchOpen,matchBackdrop,matchEscape,teamOpen,teamEscape,articleOpen,articleBackdrop,residual}));
}


async function testArticlesEndToEnd(){
  const checks=[];
  const add=(name,ok,details='')=>{checks.push({name,ok:Boolean(ok),details});console.log(`[articles] ${ok?'PASS':'FAIL'} · ${name}`);if(!ok)throw new Error(`Articoli · ${name}${details?`: ${details}`:''}`);};

  await setViewport(1280,900);await navigate('index.html');await seedState();await navigate('index.html');await click('[data-tab="articles"]');
  let publicState=await evaluate(`(()=>{
    const cards=[...document.querySelectorAll('#publicArticles .article-card')];
    const titles=cards.map(c=>c.querySelector('h3')?.textContent||'');
    const image=document.querySelector('[data-article-id="article_2"] img.article-image');
    return {count:cards.length,badge:document.querySelector('#publicArticleCount')?.textContent||'',titles,draft:!!document.querySelector('[data-article-id="article_3"]'),scheduled:!!document.querySelector('[data-article-id="article_4"]'),alt:image?.alt||'',href:document.querySelector('[data-article-id="article_2"] a')?.getAttribute('href')||'',nullText:document.querySelector('#publicArticles')?.textContent.includes('null')||document.querySelector('#publicArticles')?.textContent.includes('undefined')};
  })()`);
  add('lista pubblica filtra bozze e programmati',publicState.count===2&&!publicState.draft&&!publicState.scheduled,JSON.stringify(publicState));
  add('titoli e immagini accessibili',publicState.titles.some(t=>t.startsWith('Titolo molto lungo'))&&publicState.alt==='Locandina verticale del torneo'&&publicState.href==='#article=analisi-completa'&&!publicState.nullText,JSON.stringify(publicState));

  await evaluate(`(()=>{const input=document.querySelector('#publicArticleSearch');input.value='analisi completa';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(220);
  let filterState=await evaluate(`({cards:document.querySelectorAll('#publicArticles .article-card').length,ids:[...document.querySelectorAll('#publicArticles .article-card')].map(x=>x.dataset.articleId)})`);
  add('ricerca pubblica',filterState.cards===1&&filterState.ids[0]==='article_2',JSON.stringify(filterState));
  await click('#clearArticleFilters');
  await evaluate(`(()=>{const select=document.querySelector('#publicArticleCategory');select.value='Approfondimenti';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(100);
  filterState=await evaluate(`({cards:document.querySelectorAll('#publicArticles .article-card').length,id:document.querySelector('#publicArticles .article-card')?.dataset.articleId||''})`);
  add('filtro categoria pubblico',filterState.cards===1&&filterState.id==='article_2',JSON.stringify(filterState));
  await click('#clearArticleFilters');

  await evaluate(`document.body.style.minHeight='2400px';window.scrollTo(0,420)`);const scrollBefore=await evaluate('window.scrollY');
  await click('[data-article-open="article_1"]');
  let modal=await overlayState('#articleModal');
  let detail=await evaluate(`({hash:location.hash,title:document.querySelector('#articleModalTitle')?.textContent||'',body:document.querySelector('#articleModalBody')?.textContent||'',dialog:document.querySelector('#articleModal')?.getAttribute('role')||'',photoSections:document.querySelectorAll('#articleModalBody .article-detail-media').length,mainLandmarks:document.querySelectorAll('main').length})`);
  add('apertura dettaglio con URL stabile',modal.open&&detail.hash==='#article=notizia-test'&&detail.title==='Notizia test'&&detail.body.includes('Contenuto di prova')&&detail.dialog==='dialog'&&detail.photoSections===0&&detail.mainLandmarks===1,JSON.stringify({modal,detail}));
  await evaluate('history.back()');await waitFor(()=>evaluate(`!document.querySelector('#articleModal')?.classList.contains('open')`),{label:'history back article'});
  await waitFor(()=>evaluate(`Math.abs(window.scrollY-${scrollBefore})<2`),{label:'restore article list scroll'});
  const scrollAfter=await evaluate('window.scrollY');
  add('pulsante indietro e posizione lista',Math.abs(scrollBefore-scrollAfter)<2,JSON.stringify({scrollBefore,scrollAfter,hash:await evaluate('location.hash')}));

  await click('[data-article-open="article_2"]');
  detail=await evaluate(`(()=>{const root=document.querySelector('#articleModalBody');const img=root.querySelector('.article-detail-media img');return {title:root.querySelector('h1')?.textContent||'',h3:root.querySelector('.article-full-text h3')?.textContent||'',strong:root.querySelector('.article-full-text strong')?.textContent||'',em:root.querySelector('.article-full-text em')?.textContent||'',link:root.querySelector('.article-full-text a')?.href||'',list:root.querySelectorAll('.article-full-text li').length,quote:root.querySelector('blockquote')?.textContent||'',objectFit:img?getComputedStyle(img).objectFit:'',caption:root.querySelector('figcaption')?.textContent||'',scriptCount:root.querySelectorAll('script').length};})()`);
  add('dettaglio completo e formattazione sicura',detail.title.startsWith('Titolo molto lungo')&&detail.h3==='Analisi completa'&&detail.strong==='grassetto'&&detail.em==='corsivo'&&detail.link.startsWith('https://example.com')&&detail.list===2&&detail.quote.includes('citazione')&&detail.objectFit==='contain'&&detail.caption.includes('Didascalia')&&detail.scriptCount===0,JSON.stringify(detail));
  await evaluate(`(()=>{const opener=document.querySelector('#articleModalBody [data-article-image-open]');opener.focus();opener.click();document.querySelector('.article-image-viewer [data-article-viewer-in]').click();})()`);
  await delay(60);
  const articleViewer=await evaluate(`(()=>{const root=document.querySelector('.article-image-viewer');return {open:root.classList.contains('open'),hidden:root.getAttribute('aria-hidden'),zoom:root.querySelector('[data-article-viewer-label]').textContent,focusClose:document.activeElement===root.querySelector('.article-image-viewer-close')};})()`);
  await pressKey('Escape');await delay(60);
  const articleViewerClosed=await evaluate(`!document.querySelector('.article-image-viewer').classList.contains('open')&&document.activeElement===document.querySelector('#articleModalBody [data-article-image-open]')&&document.body.classList.contains('ng-overlay-open')&&document.querySelector('#articleModal').classList.contains('open')`);
  add('visualizzatore fotografia: zoom, Escape e ritorno focus',articleViewer.open&&articleViewer.hidden==='false'&&articleViewer.zoom==='150%'&&articleViewer.focusClose&&articleViewerClosed,JSON.stringify({articleViewer,articleViewerClosed}));
  const hashBeforeRefresh=await evaluate('location.hash');await navigate('index.html');await waitFor(()=>evaluate(`document.querySelector('#articleModal')?.classList.contains('open')`),{label:'direct article refresh'});
  const refreshed=await evaluate(`({hash:location.hash,title:document.querySelector('#articleModalBody h1')?.textContent||'',cards:document.querySelectorAll('#publicArticles .article-card').length})`);
  add('refresh e URL diretto',hashBeforeRefresh==='#article=analisi-completa'&&refreshed.hash===hashBeforeRefresh&&refreshed.title.startsWith('Titolo molto lungo'),JSON.stringify(refreshed));

  await evaluate(`history.pushState({},'','#article=notizia-test');window.dispatchEvent(new HashChangeEvent('hashchange'));`);await delay(100);
  const switched=await evaluate(`({title:document.querySelector('#articleModalBody h1')?.textContent||'',old:document.querySelector('#articleModalBody')?.textContent.includes('Analisi completa')||false})`);
  add('apertura ripetuta senza contenuto precedente',switched.title==='Notizia test'&&!switched.old,JSON.stringify(switched));
  await evaluate(`history.pushState({},'','#article=inesistente');window.dispatchEvent(new HashChangeEvent('hashchange'));`);await delay(100);
  const missing=await evaluate(`document.querySelector('#articleModalBody')?.textContent||''`);
  add('articolo inesistente',missing.includes('Articolo non disponibile'),missing);
  await click('#closeArticleModal');

  const responsive=[];
  for(const [width,height] of [[320,700],[390,844],[844,390],[768,1024],[1440,900]]){
    await setViewport(width,height);await navigate('index.html');await click('[data-tab="articles"]');await delay(80);
    const data=await evaluate(`(()=>{const card=document.querySelector('#publicArticles .article-card');const main=card?.querySelector('.article-card-main');const media=card?.querySelector('.article-media');const title=card?.querySelector('h3');const r=card?.getBoundingClientRect();return {width:${width},doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,cardRight:r?.right||0,vw:innerWidth,columns:main?getComputedStyle(main).gridTemplateColumns:'',mainAreas:main?getComputedStyle(main).gridTemplateAreas:'',mediaArea:media?getComputedStyle(media).gridArea:'',mediaColumn:media?getComputedStyle(media).gridColumn:'',contentArea:card?.querySelector('.article-content')?getComputedStyle(card.querySelector('.article-content')).gridArea:'',contentColumn:card?.querySelector('.article-content')?getComputedStyle(card.querySelector('.article-content')).gridColumn:'',mediaH:media?.getBoundingClientRect().height||0,titleDisplay:title?getComputedStyle(title).display:'',lineClamp:title?getComputedStyle(title).webkitLineClamp:'',touch:[...document.querySelectorAll('#articles button,#articles input,#articles select')].every(el=>el.getBoundingClientRect().height>=40)};})()`);
    responsive.push(data);
    add(`responsive ${width}px`,data.doc<=1&&data.cardRight<=data.vw+1&&data.mediaH>0&&(width<=760||data.mediaH<=301)&&data.titleDisplay==='block'&&(width>760||!data.columns.includes(' '))&&data.touch,JSON.stringify(data));
  }

  await setViewport(1280,900);await navigate('admin-articles.html');
  let adminState=await evaluate(`({cards:document.querySelectorAll('#adminArticlesList .article-card').length,drafts:document.querySelectorAll('.status-draft').length,scheduled:document.querySelectorAll('.status-scheduled').length,fields:['articleTitle','articleSubtitle','articleExcerpt','articleAuthor','articleCategory','articleTags','articleBody','articleImage','articleImageAlt','articleImageCaption','articleStatus','articlePublishedAt','articleSlug'].every(id=>!!document.getElementById(id))})`);
  add('elenco e modulo admin completi',adminState.cards===4&&adminState.drafts===1&&adminState.scheduled===1&&adminState.fields,JSON.stringify(adminState));

  await evaluate(`(()=>{document.querySelector('#articleTitle').value='';document.querySelector('#articleBody').value='';})()`);await click('#articleSubmitBtn');await delay(80);
  const validation=await evaluate(`({errors:document.querySelectorAll('#articleFormErrors li').length,titleInvalid:document.querySelector('#articleTitle').getAttribute('aria-invalid'),bodyInvalid:document.querySelector('#articleBody').getAttribute('aria-invalid'),count:NexoraStore.selectors.allArticles(NexoraStore.load('admin')).length})`);
  add('validazione obbligatori',validation.errors===2&&validation.titleInvalid==='true'&&validation.bodyInvalid==='true'&&validation.count===4,JSON.stringify(validation));
  await navigate('admin-articles.html');

  const imageLoaded=await evaluate(`(()=>new Promise(resolve=>{
    const binary=atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8AARAwMjIwgAQAQAAH+Q0YzAAAAAElFTkSuQmCC');
    const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const file=new File([bytes],'test.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(file);
    const input=document.querySelector('#articleImage');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    const start=Date.now();const timer=setInterval(()=>{const img=document.querySelector('#articleImagePreview img');if(img&&img.src.startsWith('data:image/png')){clearInterval(timer);resolve(true);}else if(Date.now()-start>5000){clearInterval(timer);resolve(false);}},40);
  }))()`);
  add('upload e anteprima immagine',imageLoaded,String(imageLoaded));
  await evaluate(`(()=>{const set=(id,value,event='input')=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}));};set('articleTitle','Nuovo articolo end to end');set('articleSubtitle','Sottotitolo di prova');set('articleExcerpt','Estratto di prova');set('articleAuthor','Tester');set('articleCategory','Test');set('articleTags','uno, due');set('articleBody','## Titolo interno\\nCorpo **formattato** e [link](https://example.com).');set('articleImageAlt','Quadrato di prova');set('articleImageCaption','Didascalia prova');set('articleStatus','draft','change');return {slug:document.getElementById('articleSlug').value,dirty:document.getElementById('articleFormTitle').dataset.unsaved};})()`);
  const dirty=await evaluate(`({dirty:document.querySelector('#articleFormTitle').dataset.unsaved,slug:document.querySelector('#articleSlug').value})`);
  add('slug automatico e stato non salvato',dirty.dirty==='true'&&dirty.slug==='nuovo-articolo-end-to-end',JSON.stringify(dirty));
  await click('#articlePreviewBtn');modal=await overlayState('#articlePreviewModal');
  const preview=await evaluate(`({open:document.querySelector('#articlePreviewModal')?.classList.contains('open'),title:document.querySelector('#articlePreviewModalBody h1')?.textContent||'',imgAlt:document.querySelector('#articlePreviewModalBody img')?.alt||'',editorial:!!document.querySelector('#articlePreviewModalBody .article-detail-editorial')})`);
  add('anteprima amministratore',modal.open&&modal.bodyLocked&&preview.title==='Nuovo articolo end to end'&&preview.imgAlt==='Quadrato di prova'&&preview.editorial,JSON.stringify({modal,preview}));await pressKey('Escape');
  const previewClosed=await waitFor(()=>evaluate(`(()=>({closed:!document.querySelector('#articlePreviewModal').classList.contains('open'),unlocked:!document.body.classList.contains('ng-overlay-open'),focus:document.activeElement===document.querySelector('#articlePreviewBtn')}))()`),{label:'chiusura anteprima amministratore'});
  add('anteprima: Escape e ritorno focus',previewClosed.closed&&previewClosed.unlocked&&previewClosed.focus,JSON.stringify(previewClosed));
  await click('#articleSubmitBtn');
  await waitFor(()=>evaluate(`NexoraStore.selectors.allArticles(NexoraStore.load('admin')).some(a=>a.title==='Nuovo articolo end to end')`),{label:'create draft article'});
  const created=await evaluate(`(()=>{const a=NexoraStore.selectors.allArticles(NexoraStore.load('admin')).find(a=>a.title==='Nuovo articolo end to end');return {id:a?.id||'',status:a?.status||'',image:a?.image?.slice(0,22)||'',tags:a?.tags||[],formTitle:document.querySelector('#articleTitle').value};})()`);
  add('creazione bozza senza perdita dati',created.id&&created.status==='draft'&&created.image.startsWith('data:image/png')&&created.tags.length===2&&created.formTitle==='',JSON.stringify(created));

  await navigate('index.html');await click('[data-tab="articles"]');
  add('bozza non visibile al pubblico',!(await evaluate(`!![...document.querySelectorAll('#publicArticles h3')].find(el=>el.textContent==='Nuovo articolo end to end')`)));

  await navigate('admin-articles.html');await click(`[data-edit-article="${created.id}"]`);
  await evaluate(`(()=>{const sub=document.querySelector('#articleSubtitle');sub.value='Modifica non salvata';sub.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>true;})()`);
  add('avviso modifiche non salvate',await evaluate(`document.querySelector('#articleFormTitle').dataset.unsaved==='true'`));
  await click('#cancelEditArticleBtn');add('annullamento modifica',await evaluate(`document.querySelector('#articleTitle').value===''&&document.querySelector('#articleFormTitle').dataset.unsaved==='false'`));

  await click(`[data-edit-article="${created.id}"]`);
  await evaluate(`(()=>{const status=document.querySelector('#articleStatus');status.value='published';status.dispatchEvent(new Event('change',{bubbles:true}));const date=document.querySelector('#articlePublishedAt');const d=new Date(Date.now()-60000);date.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);date.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#articleSubmitBtn');await waitFor(()=>evaluate(`NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})?.status==='published'`),{label:'publish article'});
  await navigate('index.html');await click('[data-tab="articles"]');
  add('pubblicazione aggiorna il pubblico',await evaluate(`!![...document.querySelectorAll('#publicArticles h3')].find(el=>el.textContent==='Nuovo articolo end to end')`));

  await navigate('admin-articles.html');
  await click('[data-preview-article="article_3"]');
  const safePreview=await evaluate(`({scripts:document.querySelectorAll('#articlePreviewModalBody script').length,text:document.querySelector('#articlePreviewModalBody')?.textContent||'',xss:window.__articleXss===true})`);
  add('sanificazione contenuto',safePreview.scripts===0&&!safePreview.xss&&safePreview.text.includes('<script>'),JSON.stringify(safePreview));await pressKey('Escape');

  const invalidFile=await evaluate(`(()=>new Promise(resolve=>{const file=new File([new Uint8Array(13*1024*1024)],'troppo-grande.jpg',{type:'image/jpeg'});const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('#articleImage');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));const start=Date.now();const timer=setInterval(()=>{const text=document.querySelector('#articleMsg')?.textContent||'';if(text.includes('12 MB')){clearInterval(timer);resolve(text);}else if(Date.now()-start>3000){clearInterval(timer);resolve(text);}},40);}))()`);
  add('rifiuto immagine troppo grande',String(invalidFile).includes('12 MB'),String(invalidFile));

  await click(`[data-delete-article="${created.id}"]`);let deleteDialog=await overlayState('#deleteArticleDialog');
  const deleteVisual=await evaluate(`(()=>{const el=document.querySelector('#deleteArticleDialog');const style=getComputedStyle(el);return {opacity:style.opacity,pointerEvents:style.pointerEvents,display:style.display,open:el.classList.contains('open'),label:document.querySelector('#confirmDeleteArticleBtn')?.textContent||''};})()`);
  add('conferma eliminazione esplicita e interattiva',deleteDialog.open&&deleteDialog.bodyLocked&&deleteVisual.open&&deleteVisual.opacity==='1'&&deleteVisual.pointerEvents!=='none'&&deleteVisual.label.includes('Elimina articolo')&&(await evaluate(`document.querySelector('#deleteArticleDialogText').textContent.includes('Nuovo articolo end to end')`)),JSON.stringify({deleteDialog,deleteVisual}));
  await pressKey('Escape');
  add('eliminazione: Escape e ritorno focus',await evaluate(`!document.querySelector('#deleteArticleDialog').classList.contains('show')&&!document.querySelector('#deleteArticleDialog').classList.contains('open')&&!document.body.classList.contains('ng-overlay-open')&&document.activeElement===document.querySelector(${JSON.stringify(`[data-delete-article="${created.id}"]`)})`));
  await click(`[data-preview-article="${created.id}"]`);await click('#deleteArticleFromPreviewBtn');
  add('eliminazione disponibile dal dettaglio admin',await evaluate(`document.querySelector('#articlePreviewModal').classList.contains('open')&&document.querySelector('#deleteArticleDialog').classList.contains('open')&&document.querySelector('#deleteArticleDialogText').textContent.includes('Nuovo articolo end to end')`));
  await click('#cancelDeleteArticleBtn');await pressKey('Escape');
  await click(`[data-delete-article="${created.id}"]`);await click('#cancelDeleteArticleBtn');
  add('annullamento eliminazione',!(await overlayState('#deleteArticleDialog')).open&&await evaluate(`!!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})`));
  const invalidDelete=await evaluate(`(()=>{const fake=document.createElement('button');fake.type='button';fake.dataset.deleteArticle='';document.body.appendChild(fake);fake.click();fake.remove();return {open:document.querySelector('#deleteArticleDialog').classList.contains('open'),message:document.querySelector('#articleMsg')?.textContent||''};})()`);
  add('ID eliminazione non valido bloccato',!invalidDelete.open&&invalidDelete.message.includes('identificativo articolo non valido'),JSON.stringify(invalidDelete));
  await click(`[data-delete-article="${created.id}"]`);
  await evaluate(`NEW_GENERATION_SUPABASE.ENABLED=true;window.__deleteRemoteCalls=0;NG_FORCE_REMOTE_SAVE=()=>{window.__deleteRemoteCalls++;return Promise.resolve(false);};`);
  await click('#confirmDeleteArticleBtn');await waitFor(()=>evaluate(`document.querySelector('#deleteArticleDialogMsg')?.textContent.includes('non ha confermato')`),{label:'delete backend false'});
  const rollback=await evaluate(`({exists:!!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true}),open:document.querySelector('#deleteArticleDialog').classList.contains('show'),calls:window.__deleteRemoteCalls,busy:document.querySelector('#confirmDeleteArticleBtn').disabled})`);
  add('errore backend mantiene articolo e consente nuovo tentativo',rollback.exists&&rollback.open&&rollback.calls===1&&!rollback.busy,JSON.stringify(rollback));
  await evaluate(`NEW_GENERATION_SUPABASE.ENABLED=false;`);
  await evaluate(`(()=>{const b=document.querySelector('#confirmDeleteArticleBtn');b.click();b.click();})()`);
  await waitFor(()=>evaluate(`!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})&&!document.querySelector('#deleteArticleDialog').classList.contains('show')`),{label:'final delete'});
  add('eliminazione e doppio click',true);
  await navigate('admin-articles.html');
  add('refresh dopo eliminazione non ripristina articolo',!(await evaluate(`!!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})`)));

  await setViewport(390,844);await navigate('admin-articles.html');
  const adminMobile=await evaluate(`(()=>{const actions=[...document.querySelectorAll('.article-admin-actions .btn')];return {overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,actions:actions.length,large:actions.every(b=>b.getBoundingClientRect().height>=44),columns:getComputedStyle(document.querySelector('.article-admin-layout')).gridTemplateColumns};})()`);
  add('admin mobile e touch',adminMobile.overflow<=1&&adminMobile.actions>0&&adminMobile.large&&!adminMobile.columns.includes(' '),JSON.stringify(adminMobile));

  record('Articoli end-to-end: pubblico, admin, immagini, sicurezza, URL, responsive e sincronizzazione',checks.every(c=>c.ok),JSON.stringify(checks));
}

async function testSimulationDialog(){
  await setViewport(1280,900);await navigate('admin.html');
  await evaluate(`window.__preWizardState=structuredClone(NexoraStore.load('admin'));`);
  await click('#simulateTournamentBtn');let st=await overlayState('#simulationDialog');
  const initial=await evaluate(`({title:document.querySelector('#simulationStepBody h3')?.textContent||'',steps:document.querySelectorAll('.simulation-stepper li').length,generated:document.querySelector('input[name="simulationTeamMode"][value="generated"]')?.checked,existingDisabled:document.querySelector('input[name="simulationTeamMode"][value="existing"]')?.disabled})`);
  const openOk=st.open&&st.bodyLocked&&st.count===1&&initial.steps===5&&initial.generated&&initial.existingDisabled&&initial.title.includes('squadre già presenti');
  await pressKey('Escape');st=await overlayState('#simulationDialog');const escapeOk=!st.open&&!st.bodyLocked&&await evaluate(`document.activeElement===document.querySelector('#simulateTournamentBtn')`);
  for(let i=0;i<10;i++){await click('#simulateTournamentBtn');await click('#cancelSimulationBtn');}
  st=await overlayState('#simulationDialog');const cyclesOk=!st.open&&!st.bodyLocked&&st.count===1;
  await evaluate(`(()=>{const b=document.querySelector('#simulateTournamentBtn');b.focus();b.click();b.click();return true;})()`);await delay(80);st=await overlayState('#simulationDialog');const doubleOk=st.open&&st.count===1;
  await click('#simulationDialog');st=await overlayState('#simulationDialog');const backdropOk=!st.open&&!st.bodyLocked;

  await click('#simulateTournamentBtn');
  const beforeChoice=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,running:NGTournamentSimulation.getWizardState()?.running,operation:NexoraStore.load('admin')._simulationOperationId||''})`);
  await click('input[name="simulationTeamMode"][value="generated"]');await delay(80);
  const afterChoice=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,running:NGTournamentSimulation.getWizardState()?.running,operation:NexoraStore.load('admin')._simulationOperationId||'',title:document.querySelector('#simulationStepBody h3')?.textContent||''})`);
  await evaluate(`document.querySelector('input[name="simulationTeamMode"][value="generated"]').focus()`);await pressKey('Enter');await delay(60);
  const afterEnter=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,running:NGTournamentSimulation.getWizardState()?.running,operation:NexoraStore.load('admin')._simulationOperationId||''})`);
  const noEarlyStart=beforeChoice.step===0&&!beforeChoice.running&&afterChoice.step===0&&!afterChoice.running&&afterChoice.operation===beforeChoice.operation&&afterEnter.step===0&&!afterEnter.running&&afterEnter.operation===beforeChoice.operation&&afterChoice.title.includes('squadre già presenti');
  await click('#simulationNextBtn');const formatOk=await evaluate(`document.querySelector('#simulationStepBody h3')?.textContent.includes('formato')&&document.querySelectorAll('input[name="simulationFormat"]').length===4`);
  await click('input[name="simulationFormat"][value="knockout"]');await click('#simulationNextBtn');const kingsOk=await evaluate(`document.querySelector('#simulationStepBody h3')?.textContent.includes('Kings')`);
  await click('input[name="simulationKings"][value="yes"]');await click('#simulationNextBtn');const durationOk=await evaluate(`document.querySelector('#simulationStepBody h3')?.textContent.includes('un solo giorno o in più giorni')`);
  await click('input[name="simulationDuration"][value="one_day"]');await click('#simulationNextBtn');
  const summaryBefore=await evaluate(`({summary:document.querySelector('.simulation-summary')?.textContent||'',disabled:document.querySelector('#simulationExecuteBtn')?.disabled,label:document.querySelector('#simulationExecuteBtn')?.textContent||'',step:NGTournamentSimulation.getWizardState()?.step})`);
  await click('#simulationReplaceConfirm');await click('#simulationTeamsConfirm');
  const summaryAfter=await evaluate(`(()=>{const payload=NGTournamentSimulation.getFinalPayload();return {enabled:!document.querySelector('#simulationExecuteBtn')?.disabled,label:document.querySelector('#simulationExecuteBtn')?.textContent||'',kings:document.querySelector('.simulation-summary')?.textContent.includes('presidente obbligatorio'),payload};})()`);
  await click('#simulationBackBtn');const backState=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,duration:document.querySelector('input[name="simulationDuration"][value="one_day"]')?.checked})`);
  await click('#simulationNextBtn');
  const selectionsKept=backState.step===3&&backState.duration===true;
  const payloadOk=summaryAfter.payload?.teamMode==='generated'&&summaryAfter.payload?.generatedTeamCount===8&&summaryAfter.payload?.format==='knockout'&&summaryAfter.payload?.kings===true&&summaryAfter.payload?.presidentMode==='default_per_team'&&summaryAfter.payload?.duration==='one_day'&&summaryAfter.payload?.replaceTournamentConfirmed===true&&summaryAfter.payload?.replaceTeamsConfirmed===true&&summaryAfter.payload?.requestSource==='wizard-final-confirmation';
  await click('#simulationReplaceConfirm');await click('#simulationTeamsConfirm');
  await evaluate(`(()=>{const b=document.querySelector('#simulationExecuteBtn');b.click();b.click();})()`);
  await waitFor(()=>evaluate(`!!document.querySelector('.simulation-success')`),{label:'wizard final execution',timeout:15000});
  const completed=await evaluate(`(()=>{const s=NexoraStore.load('admin');return {teams:s.teams.length,players:s.teams.reduce((n,t)=>n+(t.players||[]).length,0),matches:s.matches.length,winner:s._simulationSummary?.winnerName||'',articlesSame:JSON.stringify(s.articles||[])===JSON.stringify(window.__preWizardState.articles||[]),running:NGTournamentSimulation.getWizardState()?.running};})()`);
  const completionOk=completed.teams===8&&completed.players===40&&completed.matches===7&&Boolean(completed.winner)&&completed.articlesSame&&completed.running===false;
  await click('#cancelSimulationBtn');
  await evaluate(`(()=>{NexoraStore.save('admin',window.__preWizardState);NexoraStore.save('public',window.__preWizardState);delete window.__preWizardState;})()`);
  const wizardOk=noEarlyStart&&formatOk&&kingsOk&&durationOk&&summaryBefore.step===4&&summaryBefore.disabled&&summaryBefore.label.includes('Genera torneo simulato')&&summaryAfter.enabled&&summaryAfter.kings&&payloadOk&&selectionsKept&&completionOk;
  record('Procedura Simula: nessun avvio anticipato, wizard completo, payload esplicito, avvio finale unico e ricaricamento',openOk&&escapeOk&&cyclesOk&&doubleOk&&backdropOk&&wizardOk,JSON.stringify({openOk,escapeOk,cyclesOk,doubleOk,backdropOk,wizardOk,noEarlyStart,initial,beforeChoice,afterChoice,afterEnter,summaryBefore,summaryAfter,backState,payloadOk,selectionsKept,completed,completionOk}));
}
async function testPhotoConfirmAndLightbox(){
  await setViewport(1280,900);await navigate('admin-photos.html');
  await click('[data-team-pick="team_a"]');
  const photoExists=await evaluate(`!!document.querySelector('[data-delete-photo="test/photo-1.jpg"]')`);
  assert(photoExists,'Foto test non renderizzata');
  await evaluate(`(()=>{const b=document.querySelector('[data-delete-photo="test/photo-1.jpg"]');b.focus();b.click();b.click();return true;})()`);await delay(80);
  let st=await overlayState('.ng-confirm-overlay');const doubleOk=st.open&&st.count===1&&st.bodyLocked;
  await pressKey('Escape');await delay(320);st=await overlayState('.ng-confirm-overlay');const escapeOk=!st.exists&&!st.bodyLocked&&await evaluate(`document.activeElement===document.querySelector('[data-delete-photo="test/photo-1.jpg"]')`);
  let cyclesOk=true;
  for(let i=0;i<10;i++){
    await click('[data-delete-photo="test/photo-1.jpg"]');
    const open=await overlayState('.ng-confirm-overlay');
    if(!open.open||open.count!==1){cyclesOk=false;break;}
    await click('.ng-confirm-cancel');await delay(380);
  }
  st=await overlayState('.ng-confirm-overlay');cyclesOk=cyclesOk&&!st.exists&&!st.bodyLocked;
  await click('[data-delete-photo="test/photo-1.jpg"]');await waitFor(()=>evaluate(`!!document.querySelector('.ng-confirm-overlay.open')`),{label:'confirm backdrop'});await click('.ng-confirm-overlay');await delay(380);st=await overlayState('.ng-confirm-overlay');const backdropOk=!st.exists&&!st.bodyLocked;
  await click('[data-photo-open="0"]');let light=await overlayState('#photosLightbox');const lightOpen=light.open&&light.bodyLocked&&light.count===1;
  await pressKey('ArrowRight');await pressKey('ArrowLeft');
  await pressKey('Escape');light=await overlayState('#photosLightbox');const lightEscape=!light.open&&!light.bodyLocked;
  for(let i=0;i<10;i++){await click('[data-photo-open="0"]');await pressKey('Escape');}
  light=await overlayState('#photosLightbox');const lightCycles=!light.open&&!light.bodyLocked&&light.count===1;

  const stagingReady=await evaluate(`(async()=>{
    window.__photoUploadCalls=0;
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
    const ctx=canvas.getContext('2d');ctx.fillRect(0,0,2,2);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const file=new File([blob],'nuova foto speciale.png',{type:'image/png',lastModified:Date.now()});
    window.__testPhotoFile=file;
    const dt=new DataTransfer();dt.items.add(file);
    const input=document.querySelector('#photosFileInput');
    Object.defineProperty(input,'files',{value:dt.files,configurable:true});
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  assert(stagingReady,'Impossibile preparare il file locale per il test Foto');
  await waitFor(()=>evaluate(`!!document.querySelector('.staging-panel [data-remove-staged]')`),{label:'anteprima locale Foto'});
  const staging=await evaluate(`({
    panel:!!document.querySelector('.staging-panel'),
    name:document.querySelector('.staging-thumb-name')?.textContent||'',
    dimensions:document.querySelector('.staging-thumb small')?.textContent||'',
    confirmDisabled:document.querySelector('#photosStagingConfirmBtn')?.disabled||false
  })`);
  await click('.staging-thumb-remove');
  const removedBeforeUpload=await evaluate(`!document.querySelector('.staging-panel')&&!document.querySelector('[data-staging-id]')`);
  await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(window.__testPhotoFile);const input=document.querySelector('#photosFileInput');Object.defineProperty(input,'files',{value:dt.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await waitFor(()=>evaluate(`!!document.querySelector('.staging-panel [data-remove-staged]')`),{label:'ripristino anteprima locale Foto'});
  await evaluate(`(()=>{
    window.NexoraPhotos.uploadTeamPhoto=async(teamId,file)=>{
      window.__photoUploadCalls++;
      await new Promise(resolve=>setTimeout(resolve,120));
      return {id:'mock-photo',publicId:'squadra/'+teamId+'/mock-photo',path:'squadra/'+teamId+'/mock-photo',teamId,name:file.name,originalName:file.name,size:file.size,width:1,height:1,mimeType:file.type,thumbUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC/gAAAAASUVORK5CYII=',originalUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC/gAAAAASUVORK5CYII='};
    };
    window.NexoraPhotos.refreshAll=async()=>[];
  })()`);
  await evaluate(`(()=>{const b=document.querySelector('#photosStagingConfirmBtn');b.click();b.click();return true;})()`);
  await waitFor(()=>evaluate(`(window.__photoUploadCalls||0)===1 && document.querySelector('#photosFileInput')?.disabled===false`),{label:'upload Foto simulato',timeout:5000});
  const upload=await evaluate(`({calls:window.__photoUploadCalls||0,busy:document.querySelector('#photosFileInput')?.disabled||false,summary:document.querySelector('#photosMsg')?.textContent||'',failed:document.querySelectorAll('.upload-item-status.fail').length})`);
  const stagingOk=staging.panel&&staging.name==='nuova foto speciale.png'&&staging.dimensions.includes('2×2')&&!staging.confirmDisabled&&removedBeforeUpload&&upload.calls===1&&!upload.busy&&upload.failed===0;

  await navigate('index.html');
  await evaluate(`(()=>{
    const store=NexoraStore;const s=store.load('public');const rows=s.teamPhotos?.team_a||[];
    window.NexoraPhotos.status=()=>({loaded:true,loading:false,error:null});
    window.NexoraPhotos.getTeamPhotoMap=()=>({team_a:rows});
    window.NexoraPhotos.listTeamPhotos=()=>rows.map((p,i)=>({...p,teamId:'team_a',title:'Foto test accessibile',altText:'Foto test accessibile',thumbUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',originalUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',largeUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}));
    window.NexoraPhotos.originalDownloadUrl=()=> 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  })()`);
  await click('[data-tab="photos"]');
  await waitFor(()=>evaluate(`!!document.querySelector('[data-public-photo-open="0"]')`),{label:'foto pubblica accessibile'});
  const publicCard=await evaluate(`(()=>{const el=document.querySelector('[data-public-photo-open="0"]');return {role:el?.getAttribute('role')||'',tabindex:el?.getAttribute('tabindex')||'',aria:el?.getAttribute('aria-label')||'',alt:el?.querySelector('img')?.alt||''};})()`);
  await evaluate(`document.querySelector('[data-public-photo-open="0"]').focus()`);
  await pressKey('Enter');
  await waitFor(()=>evaluate(`document.querySelector('#publicPhotosLightbox')?.classList.contains('open')`),{label:'lightbox Foto da tastiera'});
  const publicOpen=await overlayState('#publicPhotosLightbox');
  await pressKey('Escape');
  const publicClosed=await overlayState('#publicPhotosLightbox');
  const publicFocus=await evaluate(`document.activeElement===document.querySelector('[data-public-photo-open="0"]')`);
  const publicKeyboardOk=publicCard.role==='button'&&publicCard.tabindex==='0'&&Boolean(publicCard.aria)&&Boolean(publicCard.alt)&&publicOpen.open&&!publicClosed.open&&publicFocus;

  record('Foto: conferma, lightbox, anteprima locale, doppio click upload e apertura pubblica da tastiera',doubleOk&&escapeOk&&cyclesOk&&backdropOk&&lightOpen&&lightEscape&&lightCycles&&stagingOk&&publicKeyboardOk,JSON.stringify({doubleOk,escapeOk,cyclesOk,backdropOk,lightOpen,lightEscape,lightCycles,staging,removedBeforeUpload,upload,stagingOk,publicCard,publicOpen,publicClosed,publicFocus,publicKeyboardOk,confirm:st,light}));
}

async function testResizeAndScroll(){
  await setViewport(1280,900);await navigate('index.html');await click('[data-tab="matches"]');await click('[data-match-detail="match_1"]');
  await setViewport(320,700);await delay(120);
  const measure=await evaluate(`(()=>{const modal=document.querySelector('#matchModal');const content=modal.querySelector('.modal-content');const r=content.getBoundingClientRect();return {open:modal.classList.contains('open'),left:r.left,right:r.right,width:r.width,vw:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,locked:document.body.classList.contains('ng-overlay-open')};})()`);
  await evaluate('window.scrollTo(0,300)');const whileOpen=await evaluate('window.scrollY');
  await pressKey('Escape');const after=await overlayState('#matchModal');
  record('Ridimensionamento e scroll con modale aperta',measure.open&&measure.left>=-1&&measure.right<=measure.vw+1&&measure.overflow<=1&&measure.locked&&!after.open&&!after.bodyLocked,JSON.stringify({measure,whileOpen,after}));
}
async function run(){
  fixtureRoot=prepareFileFixture();baseUrl='inline://';
  await launchBrowser();
  const articlesOnly=process.argv.includes('--articles-only');
  try{
    if(articlesOnly){
      await testArticlesEndToEnd();
    }else{
      await testPageLoads();
      await testResponsive();
      await testTeamLogoRendering();
      await testBusyButton();
      await testAdminResetDialog();
      await testSimulationDialog();
      await testMobileSheet();
      await testFilterAndPublicModals();
      await testPhotoConfirmAndLightbox();
      await testResizeAndScroll();
    }
    record('Console JavaScript e richieste locali',runtimeErrors.length===0&&localNetworkErrors.length===0,JSON.stringify({runtimeErrors,localNetworkErrors}));
  }finally{
    try{client?.close();}catch{}
    try{browser?.kill('SIGTERM');}catch{}
    if(server)await new Promise(resolve=>server.close(resolve));
    try{if(fixtureRoot)fs.rmSync(fixtureRoot,{recursive:true,force:true});}catch{}
  }
  console.log(JSON.stringify({root,pages:pages.length,widths,mode:articlesOnly?'articles':'ui',results,runtimeErrors,localNetworkErrors},null,2));
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
run().catch(error=>{console.error(error.stack||error);try{browser?.kill('SIGTERM');}catch{}try{server?.close();}catch{}process.exit(1);});
````

## `/mnt/data/ng-work/new-generation-main/tools/validate-project.mjs`

````javascript
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const rootArg=args.find(a=>a.startsWith('--root='));
const root=path.resolve(rootArg?rootArg.slice(7):path.join(here,'..'));
const lintOnly=args.includes('--lint');
const errors=[];
const warnings=[];
const required=['index.html','admin.html','admin-rules.html','admin-groups.html','admin-teams.html','admin-players.html','admin-matches.html','admin-articles.html','admin-photos.html','admin-reports.html','admin-customize.html','print.html','404.html','assets/css/styles.css','assets/js/ux-a11y.js'];
for(const rel of required){if(!fs.existsSync(path.join(root,rel)))errors.push(`File obbligatorio mancante: ${rel}`);}

const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(dir,entry.name);
  if(entry.name==='node_modules'||entry.name==='.git'||entry.name==='dist')return [];
  return entry.isDirectory()?walk(full):[full];
});
const files=fs.existsSync(root)?walk(root):[];
const htmlFiles=files.filter(f=>f.endsWith('.html'));
const jsFiles=files.filter(f=>f.endsWith('.js'));

for(const file of htmlFiles){
  const rel=path.relative(root,file);
  const html=fs.readFileSync(file,'utf8');
  const checks=[
    [/<!doctype html>/i,'doctype'],[/<html[^>]+lang="it"/i,'lang="it"'],[/name="viewport"/i,'viewport'],[/name="theme-color"/i,'theme-color'],[/class="skip-link"/i,'skip link'],[/<main\b/i,'main landmark'],[/assets\/css\/styles\.css\?v=[a-z0-9-]+/i,'versioned stylesheet'],[/assets\/js\/ux-a11y\.js\?v=[a-z0-9-]+/i,'UX accessibility runtime']
  ];
  for(const [re,label] of checks){if(!re.test(html))errors.push(`${rel}: ${label} mancante`);}
  const attr=/\b(?:src|href)="([^"]+)"/g;
  let match;
  while((match=attr.exec(html))){
    const ref=match[1].split('?')[0].split('#')[0];
    if(!ref||/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(ref))continue;
    const target=path.resolve(path.dirname(file),ref);
    if(!fs.existsSync(target))errors.push(`${rel}: riferimento locale mancante ${match[1]}`);
  }
}

for(const file of jsFiles){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)errors.push(`${path.relative(root,file)}: sintassi JavaScript non valida\n${result.stderr.trim()}`);
}

const cssPath=path.join(root,'assets/css/styles.css');
if(fs.existsSync(cssPath)){
  const css=fs.readFileSync(cssPath,'utf8');
  const opens=(css.match(/{/g)||[]).length, closes=(css.match(/}/g)||[]).length;
  if(opens!==closes)errors.push(`assets/css/styles.css: parentesi graffe non bilanciate (${opens}/${closes})`);
  if(/transition\s*:\s*all\b/i.test(css))errors.push('assets/css/styles.css: transition: all ancora presente');
  if(!/prefers-reduced-motion/.test(css))errors.push('assets/css/styles.css: supporto prefers-reduced-motion mancante');
  if(!/scrollbar-gutter\s*:\s*stable/.test(css))warnings.push('scrollbar-gutter stabile non rilevato');
}

const forbiddenRoot=files.filter(f=>path.dirname(f)===root&&/\.(?:js|css)$/.test(f));
for(const file of forbiddenRoot)errors.push(`Asset legacy duplicato nella root: ${path.basename(file)}`);

const hashes=new Map();
for(const file of files.filter(f=>/\.(?:js|css|png|jpg|jpeg)$/i.test(f))){
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const list=hashes.get(hash)||[];list.push(path.relative(root,file));hashes.set(hash,list);
}
for(const list of hashes.values())if(list.length>1)warnings.push(`File identici: ${list.join(', ')}`);

const summary={root,html:htmlFiles.length,js:jsFiles.length,errors:errors.length,warnings:warnings.length,mode:lintOnly?'lint':'test'};
console.log(JSON.stringify(summary,null,2));
for(const warning of warnings)console.warn(`WARN: ${warning}`);
for(const error of errors)console.error(`ERROR: ${error}`);
if(errors.length)process.exit(1);
````
