# Setup galleria Foto: Cloudinary + Supabase Edge Function (v126.17)

La galleria Foto è autonoma rispetto alle immagini degli articoli:

```text
frontend Foto → team-photos → Cloudinary cartella squadra/<teamId>
                           ↘ tabella public.team_photos
```

Gli articoli, i relativi URL immagine e il loro caricamento non vengono usati né modificati.

## 1. Causa dell'errore di rete

Il frontend chiama `https://<project-ref>.supabase.co/functions/v1/team-photos`.
Il messaggio “Server Foto non raggiungibile” compare quando il browser non può leggere alcuna risposta HTTP: funzione non distribuita, preflight bloccata oppure origine esclusa da CORS.

La versione v126.17 corregge inoltre due problemi di configurazione:

- invia la chiave pubblicabile nell'header `apikey` del gateway Supabase;
- legge sia `CLOUDINARY_URL` sia le tre variabili Cloudinary separate;
- restituisce un JSON leggibile anche quando l'origine è esclusa, così il frontend mostra `ORIGIN_NOT_ALLOWED` invece di `Failed to fetch`;
- espone `GET ?action=health`, senza rivelare segreti.

## 2. Sicurezza immediata

Una API secret incollata in chat, log o ticket deve essere considerata esposta. Ruotala dal pannello Cloudinary prima del deploy e usa soltanto il nuovo valore nei Secrets Supabase. Non inserirla in file JavaScript, HTML, repository o ZIP consegnati agli utenti.

## 3. Database

Esegui `SUPABASE_SETUP.sql` nel SQL Editor. La tabella `public.team_photos` conserva metadati, URL originale e URL derivati. Il browser non accede direttamente alla tabella; la Edge Function usa la service role e RLS resta attivo.

## 4. Secrets della Edge Function

Puoi usare un solo secret Cloudinary completo:

```env
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
CLOUDINARY_TEAM_FOLDER=squadra
CLOUDINARY_SECTION_TAG=foto-squadra
PHOTO_ALLOWED_ORIGINS=https://dominio-produzione.example,http://localhost:4173
```

Oppure le variabili separate:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
CLOUDINARY_TEAM_FOLDER=squadra
CLOUDINARY_SECTION_TAG=foto-squadra
PHOTO_ALLOWED_ORIGINS=https://dominio-produzione.example,http://localhost:4173
```

La stringa `CLOUDINARY_URL` non deve contenere placeholder come `<your_api_key>`.
Il dominio in `PHOTO_ALLOWED_ORIGINS` deve corrispondere esattamente a protocollo, host e porta della pagina. Per disabilitare temporaneamente la restrizione durante la diagnosi puoi usare `PHOTO_ALLOWED_ORIGINS=*`; gli endpoint amministrativi restano protetti dal JWT utente.

## 5. Deploy obbligatorio

Il codice presente nello ZIP non distribuisce automaticamente la funzione remota. Esegui:

```bash
supabase login
supabase link --project-ref mcksxqtgibkazxnkdfra
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy team-photos --no-verify-jwt
```

Il file reale `supabase/functions/.env` deve restare escluso dal repository. Il progetto include soltanto `.env.example`.

## 6. Diagnostica

Dopo il deploy:

```bash
PHOTO_TEST_ORIGIN=https://dominio-reale.example npm run test:photo-edge-live
```

Il controllo distingue:

- funzione 404/non distribuita;
- timeout o DNS;
- origine CORS errata;
- Cloudinary non configurato;
- secrets Supabase incompleti.

È disponibile anche:

```text
GET /functions/v1/team-photos?action=health
```

La risposta mostra solo flag booleani e cloud name; non restituisce API key, API secret, token o service role.

## 7. Endpoint

```text
GET    /team-photos?action=health            diagnostica non sensibile
GET    /team-photos                          lista galleria
GET    /team-photos?action=detail&photoId=   dettaglio
GET    /team-photos?action=download&photoId= originale
POST   /team-photos                          upload multipart admin
POST   /team-photos?action=zip               ZIP originali
PATCH  /team-photos                          metadati admin
PUT    /team-photos                          sostituzione admin
DELETE /team-photos                          eliminazione admin
OPTIONS /team-photos                         preflight
```
