# Riduzione egress Supabase — v1.33.0

## Problema individuato

La riga `public.app_state` conteneva gli 11 loghi delle squadre come stringhe Base64 dentro `data.teams[].logo`.
Il solo array `teams` pesava circa 1,84 MB. Inoltre il polling di sicurezza leggeva l'intero campo `data` ogni 2–6 secondi.

## Correzioni incluse

1. Il polling PostgREST usa ora `updated_at` come filtro e scarica `data` soltanto quando lo stato cambia.
2. Il polling fallback è stato ridotto a 5 secondi durante i live, 15 secondi con pagina visibile e 60 secondi in background. Realtime e Broadcast restano attivi e immediati.
3. I nuovi loghi vengono ridimensionati a massimo 512 px, caricati su Cloudinary tramite la Edge Function autenticata e salvati in `app_state` solo come URL HTTPS.
4. La pagina **Admin → Squadre** rileva automaticamente i vecchi loghi Base64 e li migra su Cloudinary. È disponibile anche il pulsante **Ottimizza ora**.
5. Il rendering dei loghi accetta in sicurezza sia i vecchi data URL sia i nuovi URL HTTPS.

## Ordine di distribuzione obbligatorio

### 1. Aggiornare la Edge Function

Distribuire il file:

`supabase/functions/team-photos/index.ts`

con JWT gateway disabilitato, come nella configurazione già usata dal progetto. La funzione continua a verificare manualmente la sessione admin per POST/PUT/PATCH/DELETE.

Con Supabase CLI, dalla cartella del progetto:

```bash
supabase functions deploy team-photos --no-verify-jwt
```

La route di controllo deve restituire la capability `team-logos`:

`/functions/v1/team-photos?action=health`

### 2. Pubblicare il sito

Pubblicare il contenuto della cartella `dist/` sul provider attuale.

### 3. Migrare gli 11 loghi esistenti

1. Accedere all'area admin.
2. Aprire **Squadre**.
3. Attendere l'ottimizzazione automatica oppure premere **Ottimizza ora**.
4. Attendere il messaggio di completamento e il salvataggio online.

La migrazione non elimina un logo Base64 finché il corrispondente upload Cloudinary non è stato confermato.

## Verifica dopo la migrazione

Nel SQL Editor di Supabase:

```sql
select
  pg_size_pretty(octet_length(data::text)::bigint) as dimensione_app_state,
  count(*) filter (
    where team->>'logo' like 'data:image/%'
  ) as loghi_base64_residui
from public.app_state a
cross join lateral jsonb_array_elements(a.data::jsonb->'teams') team
where a.id = 'main'
group by a.data;
```

Risultato atteso:

- `loghi_base64_residui = 0`
- `dimensione_app_state` nell'ordine di poche decine di kB, non circa 1,86 MB.

Per verificare gli URL:

```sql
select
  team->>'name' as squadra,
  left(team->>'logo', 100) as logo
from public.app_state a
cross join lateral jsonb_array_elements(a.data::jsonb->'teams') team
where a.id = 'main';
```

Tutti i valori `logo` devono iniziare con `https://res.cloudinary.com/`.

## Impatto atteso

A parità di aperture del sito, la risposta completa `app_state` passa da circa 1,86 MB a circa 25–30 kB. Nei poll senza modifiche la risposta è vuota e non contiene più `data`.
