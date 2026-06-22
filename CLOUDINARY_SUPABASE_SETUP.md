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
