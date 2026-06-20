# Setup foto squadra Cloudinary + Supabase Edge Function

Questa versione sposta la gestione delle foto squadra fuori dal database.
Il DB Supabase continua a gestire articoli, squadre, partite e stato app.
Le foto vengono salvate e lette da Cloudinary tramite una Edge Function Supabase.

## 1. Valori già configurati nel frontend

```js
CLOUDINARY_CLOUD_NAME = dc17izhac
CLOUDINARY_TEAM_FOLDER = squadra
PHOTO_SECTION_NAME = foto-squadra
EDGE_FUNCTION = team-photos
```

## 2. Crea i Secrets nella dashboard Supabase

Nel progetto Supabase vai in:

Project Settings → Edge Functions → Secrets

Aggiungi:

```env
CLOUDINARY_CLOUD_NAME=dc17izhac
CLOUDINARY_API_KEY=la_tua_api_key
CLOUDINARY_API_SECRET=il_tuo_api_secret
CLOUDINARY_TEAM_FOLDER=squadra
CLOUDINARY_SECTION_TAG=foto-squadra
```

Non mettere mai `CLOUDINARY_API_SECRET` nei file JS pubblici.

## 3. Deploy Edge Function

Con Supabase CLI:

```bash
supabase login
supabase link --project-ref avypkzuwyfydmayoewdi
supabase functions deploy team-photos
```

Se lavori in locale, la funzione è in:

```text
supabase/functions/team-photos/index.ts
```

## 4. Deploy sito su Cloudflare

Carica normalmente il sito statico su Cloudflare Pages.
Il frontend chiama:

```text
https://avypkzuwyfydmayoewdi.supabase.co/functions/v1/team-photos
```

usando la `ANON_KEY` già presente in `assets/js/supabase-config.js`.

## 5. Come funziona ora

Admin:

```text
admin-photos.html → POST Edge Function → Cloudinary
```

Pubblico:

```text
index.html → GET Edge Function → lista foto da Cloudinary
```

Griglia:

```text
c_fill,w_600,h_420,q_auto,f_auto
```

Lightbox:

```text
c_limit,w_2200,q_auto,f_auto
```

Download/ZIP:

```text
originale Cloudinary
```

## 6. Limite importante Free Plan

Cloudinary Free accetta immagini fino a 10 MB. Il frontend e la funzione bloccano file più grandi.
