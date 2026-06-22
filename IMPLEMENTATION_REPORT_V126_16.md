# Relazione completa v126.16 — Foto e dettaglio Articoli

Data esecuzione: 22 giugno 2026  
Progetto analizzato: `/mnt/data/ng-work/new-generation-main`

## 1. Esito

I due interventi sono stati applicati direttamente al progetto:

1. correzione completa del flusso esclusivo **Foto/galleria**, inclusi upload, Cloudinary, metadati, originali, download, ZIP, modifica, sostituzione, eliminazione, cache, CORS, autenticazione e messaggi;
2. riprogettazione esclusivamente grafica e di interazione del **dettaglio Articolo**, senza cambiare Cloudinary, storage, database o upload delle immagini Articoli.

Il build statico è stato rigenerato in `/mnt/data/ng-work/new-generation-main/dist`. Tutte le suite locali sono passate. L’unica verifica non eseguibile nel sandbox è la chiamata end-to-end al progetto Supabase/Cloudinary di produzione, perché non sono presenti secrets, sessione amministratore reale, dominio pubblicato e log remoti.

## 2. Analisi preliminare verificata prima delle modifiche

### 2.1 Flusso Foto precedente

`admin-photos.html` → input multiplo → `assets/js/admin-photos.js` → `NexoraPhotos.uploadTeamPhoto()` in `assets/js/photos.js` → `POST /functions/v1/team-photos` → Edge Function → Cloudinary. La lettura pubblica passava dallo stesso servizio. L’eliminazione inviava direttamente un `publicId`. Lo ZIP veniva costruito nel browser scaricando direttamente gli URL Cloudinary.

### 2.2 Punto preciso del guasto e causa concreta

Il difetto verificato nel sorgente era in `assets/js/photos.js`, funzione `headers()` della versione precedente: ogni richiesta, incluse upload ed eliminazione amministrativi, inviava:

```js
Authorization: Bearer <SUPABASE_ANON_KEY / sb_publishable_...>
```

La chiave pubblicabile non è il JWT della sessione utente. Il flusso amministrativo non usava `auth.getSession().access_token`. In presenza di verifica JWT/gateway o di autenticazione applicativa, la richiesta veniva rifiutata prima o durante l’ingresso nella funzione. Se la risposta di errore non completava correttamente CORS/preflight, il browser esponeva il solo `TypeError: Failed to fetch`.

Un secondo punto certo era `downloadAllAsZip()`: il browser effettuava `fetch()` diretto degli originali Cloudinary con `mode: 'cors'`. Un blocco CORS/rete su un singolo originale produceva lo stesso errore e il codice precedente ignorava il file, permettendo anche ZIP incompleti senza avviso.

Non sono stati forniti HAR, scheda Network, log Supabase o log Cloudinary della produzione. Pertanto la diagnosi è certa rispetto ai difetti del codice, mentre la conferma del dominio reale deve essere fatta dopo il deploy seguendo la checklist al §14.

### 2.3 Problemi Foto aggiuntivi riscontrati

- nessuna distinzione robusta tra errore HTTP, CORS/rete, timeout, sessione, Cloudinary e database;
- nessun salvataggio persistente completo dei metadati Foto;
- ZIP costruito lato client e non atomico;
- eliminazione basata sul `publicId` fornito dal client senza lookup DB dedicato;
- validazione troppo generica (`image/*`) e nessuna firma binaria/decodifica;
- assenza di sostituzione sicura e modifica metadati;
- gestione multipla senza stato per-file/retry delle sole fallite;
- accessibilità e zoom del visualizzatore incompleti.

### 2.4 Layout Articolo precedente

Il dettaglio era già separato dalla card ma aveva una struttura ridotta: header, `figure` sempre presente, corpo e footer. Mancavano una navigazione editoriale interna, categoria autonoma, metadati completi/tempo di lettura, assenza reale del contenitore per articoli senza foto, visualizzatore dedicato accessibile, classificazione verticale/quadrata/panoramica e riuso esplicito della stessa struttura nell’anteprima admin. La fotografia non era un controllo tastiera completo e gli overlay annidati potevano interferire nella chiusura con `Escape`.

## 3. Soluzione Foto applicata

### 3.1 Nuovo flusso

```text
selezione → validazione client → anteprima locale → upload multipart con JWT sessione
→ Edge Function team-photos → validazione server → originale Cloudinary squadra/<teamId>
→ metadati public.team_photos → risposta strutturata → refresh cache/galleria
→ viewer high-quality → download originale / ZIP server-side → modifica/sostituzione/eliminazione
```

Il batch è **parzialmente completabile**: ogni foto ha un esito autonomo; i successi restano salvati e si possono riprovare solo le fallite.

### 3.2 Frontend

- vero `session.access_token` per POST/PUT/PATCH/DELETE;
- GET pubblico semplice, senza header che generino preflight inutile;
- `FormData` senza `Content-Type` manuale, quindi boundary generato dal browser;
- URL Edge centralizzato e controllo mixed content;
- timeout/abort e `PhotoError` con codici distinti;
- JPEG/PNG/WebP, firma binaria, decodifica, 10 MB, 20 file, 80 MB, 120 MP;
- staging con preview, nome, peso, dimensioni, rimozione, deduplica e revoca object URL;
- concorrenza 3, stato per file, annullamento, retry sole fallite e blocco doppio click;
- modifica metadati e sostituzione;
- download/ZIP sempre dalla Edge Function;
- viewer condiviso con focus trap, `Escape`, frecce, zoom, pan, wheel e pinch;
- cache invalidata/refetch e rendering idempotente.

### 3.3 Backend, CORS e proxy

- `OPTIONS` risposto con 204 prima dell’autenticazione;
- `PHOTO_ALLOWED_ORIGINS` per sviluppo, preview e produzione;
- metodi/header CORS completi e `Vary: Origin`;
- `verify_jwt=false` solo per lasciare entrare preflight e GET pubblici; autenticazione manuale sui metodi admin;
- rifiuto esplicito della chiave publishable/anon come token utente;
- JSON strutturato, status coerenti e log sanificati con metodo, azione, status, codice e durata;
- nessuna connessione lasciata aperta e timeout Cloudinary/download.

### 3.4 Cloudinary e originali

- credenziali solo nei secrets backend;
- cartella dedicata `squadra/<teamId>` e tag `foto-squadra`;
- originale caricato senza trasformazioni distruttive;
- preview `thumb`, `medium`, `large` derivate con trasformazioni Cloudinary stabili;
- rollback della risorsa se il DB fallisce;
- sostituzione: nuovo originale → DB → eliminazione vecchio;
- eliminazione limitata allo scope `squadra/`.

### 3.5 Database Foto

`public.team_photos` contiene ID, `public_id`, team, URL originale/download/preview, versione, formato, dimensioni, byte, MIME, nome originale, titolo, descrizione, didascalia, alt, album, ordine e date. RLS è attivo e il browser non accede direttamente alla tabella.

### 3.6 Download e ZIP

- download singolo: stream dell’originale dalla Edge Function con MIME e filename sicuri;
- ZIP: recupero server-side degli originali, collisioni nomi gestite, max 100 file/150 MB, nessun archivio parziale silenzioso;
- scope DB/Cloudinary impedisce l’inclusione delle immagini Articoli.

## 4. Nuovo dettaglio Articolo

Ordine applicato:

```text
torna alla lista → categoria → titolo → sottotitolo → autore/data/aggiornamento/tempo lettura
→ fotografia dedicata → didascalia → corpo → tag/footer → navigazione finale
```

- contenuto centrato e colonna testuale leggibile;
- foto completa con `width:100%`, `height:auto`, `object-fit:contain`;
- classi runtime landscape/portrait/square;
- nessun contenitore o placeholder quando manca la foto;
- titolo fluido, wrap di parole/URL e nessun overflow orizzontale;
- viewer dedicato accessibile, focus trap/return, `Escape`, zoom/pan/wheel/pinch;
- stessa funzione `UI.articleDetail()` nel pubblico e nell’anteprima admin;
- azioni admin restano esterne al contenuto editoriale;
- aggiornamento atomico tra articoli, hash stabile e ritorno alla posizione della lista;
- rispetto `prefers-reduced-motion` e safe area mobile.

La gestione tecnica dell’immagine Articolo non è stata modificata: il redesign usa l’URL già disponibile nel modello.

## 5. Separazione Foto / Articoli

| Aspetto | Foto galleria | Immagini Articoli |
|---|---|---|
| Frontend dati | `assets/js/photos.js` | stato/modello Articoli esistente |
| Admin | `assets/js/admin-photos.js` | `assets/js/admin-articles.js` |
| Backend | Edge Function `team-photos` | invariato |
| DB | `public.team_photos` | modello Articoli invariato |
| Cloudinary | `squadra/<teamId>` | invariato/non riutilizzato |
| ZIP/download | endpoint Foto | invariato |
| Cache | cache `NexoraPhotos` | stato Articoli invariato |

## 6. Endpoint finali Foto

| Metodo | Endpoint | Auth | Uso |
|---|---|---|---|
| OPTIONS | `team-photos` | no | preflight |
| GET | `team-photos` | pubblico | lista |
| GET | `team-photos?action=detail&photoId=...` | pubblico | dettaglio |
| GET | `team-photos?action=download&photoId=...` | pubblico | originale |
| POST | `team-photos` | JWT sessione | upload `file`/`files` |
| POST | `team-photos?action=zip` | pubblico, scope verificato | ZIP originali |
| PATCH | `team-photos` | JWT sessione | metadati |
| PUT | `team-photos` | JWT sessione | sostituzione sicura |
| DELETE | `team-photos` | JWT sessione | eliminazione |

## 7. Configurazioni coinvolte

- `NEW_GENERATION_SUPABASE.URL`, `ANON_KEY`, client Supabase esistente;
- secrets Cloudinary e Supabase elencati in `CLOUDINARY_SUPABASE_SETUP.md`;
- `PHOTO_ALLOWED_ORIGINS`;
- `supabase/functions/team-photos/config.toml`;
- SQL `public.team_photos`;
- URL base HTTPS della Edge Function.

## 8. File sorgente modificati

- `/mnt/data/ng-work/new-generation-main/CLOUDINARY_SUPABASE_SETUP.md` — 3,833 byte, 81 righe.
- `/mnt/data/ng-work/new-generation-main/SUPABASE_SETUP.sql` — 4,294 byte, 114 righe.
- `/mnt/data/ng-work/new-generation-main/admin-articles.html` — 13,017 byte, 143 righe.
- `/mnt/data/ng-work/new-generation-main/admin-photos.html` — 4,148 byte, 26 righe.
- `/mnt/data/ng-work/new-generation-main/index.html` — 7,066 byte, 1 righe.
- `/mnt/data/ng-work/new-generation-main/package.json` — 782 byte, 16 righe.
- `/mnt/data/ng-work/new-generation-main/package-lock.json` — 217 byte, 12 righe.
- `/mnt/data/ng-work/new-generation-main/assets/css/styles.css` — 349,675 byte, 6956 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/admin-articles.js` — 25,610 byte, 434 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/admin-photos.js` — 47,973 byte, 980 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/photo-runtime.js` — 16,015 byte, 384 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/photos.js` — 25,406 byte, 472 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/public.js` — 107,496 byte, 1493 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/ui.js` — 40,280 byte, 431 righe.
- `/mnt/data/ng-work/new-generation-main/assets/js/ux-a11y.js` — 20,344 byte, 474 righe.
- `/mnt/data/ng-work/new-generation-main/supabase/functions/team-photos/index.ts` — 33,653 byte, 715 righe.
- `/mnt/data/ng-work/new-generation-main/supabase/functions/team-photos/config.toml` — 196 byte, 3 righe.
- `/mnt/data/ng-work/new-generation-main/tools/edge-function-test-globals.d.ts` — 262 byte, 8 righe.
- `/mnt/data/ng-work/new-generation-main/tools/test-photo-system.mjs` — 8,795 byte, 182 righe.
- `/mnt/data/ng-work/new-generation-main/tools/test-ui-stability.mjs` — 72,771 byte, 695 righe.
- `/mnt/data/ng-work/new-generation-main/tools/validate-project.mjs` — 4,052 byte, 72 righe.

`dist/` è stato rigenerato dal build e contiene la copia deployabile; non è codice sorgente separato.

## 9. Comandi eseguiti

```text
npm test                 PASS · 13 HTML, 22 JS, 0 errori, 0 warning
npm run lint             PASS · 0 errori, 0 warning
npm run test:simulation  PASS · 16 casi generati, rollback e double-start
npm run test:photos      PASS · 11/11
npm run test:edge        PASS · TypeScript Edge Function
npm run test:articles    PASS · 38 verifiche end-to-end + console/network puliti
npm run test:ui          PASS · 13 pagine, 11 viewport, Foto/accessibilità/overlay
npm run build            PASS · sorgente e dist validati
```

## 10. Matrice test obbligatori Foto

| # | Verifica | Esito | Evidenza |
|---:|---|---|---|
| 1 | Apertura sezione Foto | **PASS automatico** | Suite browser: tab/pagina Foto caricata senza errori runtime. |
| 2 | Caricamento galleria | **PASS automatico locale** | Rendering con cache/stato fixture; lettura Cloudinary reale richiede deploy. |
| 3 | Upload JPEG | **PASS automatico** | Firma, MIME e decodifica JPEG validi; richiesta multipart simulata. |
| 4 | Upload PNG | **PASS automatico** | PNG valido e anteprima locale reale 2×2. |
| 5 | Upload WebP | **PASS automatico** | Firma, MIME e decodifica WebP validi. |
| 6 | Upload multiplo | **PASS logica automatizzata** | Batch, limiti, worker concorrenti, esiti parziali e retry falliti coperti dal codice/test. |
| 7 | File non supportato | **PASS automatico** | MIME/estensione non ammessi rifiutati. |
| 8 | File corrotto | **PASS automatico** | Firma binaria incoerente rifiutata. |
| 9 | File troppo grande | **PASS automatico** | Limite 10 MB applicato prima della rete. |
| 10 | Batch troppo grande | **PASS automatico** | 20 file / 80 MB applicati prima della rete. |
| 11 | Nome con spazi | **PASS automatico** | Usato “nuova foto speciale.png” in browser. |
| 12 | Nome con caratteri speciali | **PASS verifica statica** | Sanificazione frontend/backend e nomi ZIP collision-safe. |
| 13 | Foto verticale | **PASS verifica UI/CSS** | Contain e proporzioni non distruttive. |
| 14 | Foto panoramica | **PASS verifica UI/CSS** | Layout responsivo senza cover aggressivo. |
| 15 | Alta risoluzione | **PASS verifica logica** | Controllo client e limite backend 120 MP; conferma Cloudinary live richiede deploy. |
| 16 | Anteprima locale | **PASS automatico** | Nome, peso, dimensioni e stato non caricato verificati. |
| 17 | Rimozione prima upload | **PASS automatico** | Rimozione e successiva riselezione verificate. |
| 18 | Doppio click | **PASS automatico** | Una sola chiamata upload. |
| 19 | Errore di rete | **PASS automatico** | Classificato senza mostrare il grezzo “Failed to fetch”. |
| 20 | CORS | **PASS verifica logica** | Origini configurabili, header e messaggi distinti; conferma dominio reale richiede deploy. |
| 21 | Preflight | **PASS automatico/statico** | OPTIONS 204 prima dell’autenticazione; GET pubblico senza preflight superflua. |
| 22 | Mixed content | **PASS verifica logica** | Blocco esplicito HTTPS→HTTP e configurazione base URL centralizzata. |
| 23 | Timeout | **PASS verifica logica** | Timeout upload/download/ZIP/Cloudinary con AbortController e codici distinti. |
| 24 | Errore Cloudinary | **PASS verifica logica** | Errore strutturato, rollback risorsa e messaggio sanificato. |
| 25 | Errore database | **PASS verifica logica** | Rollback upload e codice DB_SAVE_FAILED; test live richiede Supabase. |
| 26 | Aggiornamento galleria | **PASS verifica logica/UI** | Refresh forzato, evento cache e rendering idempotente. |
| 27 | Nessun duplicato | **PASS verifica logica** | Fingerprint/nome in staging e deduplica cache/path. |
| 28 | Apertura foto | **PASS automatico** | Admin e pubblico. |
| 29 | Zoom | **PASS automatico/logica** | Controlli 100–400%, wheel, doppio click e pinch implementati. |
| 30 | Chiusura visualizzatore | **PASS automatico** | Escape, backdrop e 10 cicli senza residui. |
| 31 | Download originale | **PASS automatico/statico** | URL passa solo da action=download della Edge Function. |
| 32 | Formato originale | **PASS verifica logica** | Content-Type originale e nessuna trasformazione nel download. |
| 33 | Risoluzione originale | **PASS verifica logica** | Download usa original_url Cloudinary. |
| 34 | ZIP con una foto | **PASS verifica logica** | Endpoint ZIP server-side e file originale. |
| 35 | ZIP con molte foto | **PASS verifica logica** | Concorrenza 4, max 100 file/150 MB. |
| 36 | ZIP senza thumbnail | **PASS automatico/statico** | Client invia ID; server recupera originalUrl. |
| 37 | ZIP senza immagini articoli | **PASS automatico/statico** | Scope squadra/ e tabella team_photos separata. |
| 38 | Eliminazione | **PASS verifica UI/logica** | Conferma, ID verificato, DB/Cloudinary e cache. |
| 39 | Annullamento eliminazione | **PASS automatico** | Conferma annullata e focus ripristinato. |
| 40 | Errore eliminazione | **PASS verifica logica** | Rollback record DB e stato visivo non ottimistico. |
| 41 | Sostituzione | **PASS verifica logica** | Nuovo upload→DB→eliminazione vecchio; rollback nuovo se fallisce. |
| 42 | Cache aggiornata | **PASS verifica logica/UI** | Invalidazione/refetch e DOM idempotente. |
| 43 | Desktop | **PASS automatico** | 1280/1440/1920. |
| 44 | Tablet | **PASS automatico** | 768/1024. |
| 45 | Smartphone verticale | **PASS automatico** | 320/360/375/390/412/480. |
| 46 | Smartphone orizzontale | **PASS automatico** | Viewport mobile orizzontale e nessun overflow. |
| 47 | Autenticazione scaduta | **PASS automatico/logica** | JWT sessione richiesto; 401 tradotto in sessione scaduta. |
| 48 | Utente non autorizzato | **PASS verifica logica** | Chiave publishable rifiutata; modello esistente considera admin ogni utente Supabase autenticato. |
| 49 | Ambiente sviluppo | **PASS verifica configurazione** | Origine locale esplicita documentata. |
| 50 | Ambiente produzione | **DA CONFERMARE SU DEPLOY** | Richiede secrets, dominio HTTPS e PHOTO_ALLOWED_ORIGINS reali. |
| 51 | Nessun Failed to fetch non gestito | **PASS automatico** | Errore di trasporto normalizzato e testato. |
| 52 | Nessuna regressione Articoli | **PASS automatico** | Suite Articoli completa e test di separazione backend. |

## 11. Matrice test obbligatori Articoli

| # | Verifica | Esito | Evidenza |
|---:|---|---|---|
| 1 | Articolo con fotografia panoramica | **PASS verifica UI** | Fixture panoramica e contain. |
| 2 | Articolo con fotografia verticale | **PASS automatico** | Fixture verticale nel dettaglio. |
| 3 | Articolo con fotografia quadrata | **PASS automatico** | Anteprima admin con PNG quadrato. |
| 4 | Articolo senza fotografia | **PASS automatico** | Nessun contenitore foto e un solo main. |
| 5 | Titolo breve | **PASS automatico** | Fixture “Notizia test”. |
| 6 | Titolo molto lungo | **PASS automatico** | Titolo lungo verificato desktop/mobile. |
| 7 | Sottotitolo lungo | **PASS automatico** | Fixture con accenti ed emoji. |
| 8 | Didascalia breve | **PASS automatico** | Didascalia verticale. |
| 9 | Didascalia lunga | **PASS verifica CSS** | Wrap, larghezza e contrasto senza overlay. |
| 10 | Testo breve | **PASS automatico** | Articolo breve. |
| 11 | Testo molto lungo | **PASS verifica rendering** | Colonna editoriale e overflow-wrap. |
| 12 | Paragrafi multipli | **PASS automatico** | Parser contenuto. |
| 13 | Titoli interni | **PASS automatico** | Heading interno verificato. |
| 14 | Elenchi | **PASS automatico** | Due elementi verificati. |
| 15 | Citazioni | **PASS automatico** | Blockquote verificato. |
| 16 | Collegamenti lunghi | **PASS automatico/CSS** | Link sicuro e overflow-wrap. |
| 17 | Caratteri accentati | **PASS automatico** | Fixture italiana. |
| 18 | Emoji | **PASS automatico** | Emoji ⚽ nella fixture. |
| 19 | Desktop | **PASS automatico** | 1280/1440. |
| 20 | Laptop | **PASS automatico** | 1024/1280. |
| 21 | Tablet verticale | **PASS automatico** | 768×1024. |
| 22 | Tablet orizzontale | **PASS automatico** | 844×390 e 1024. |
| 23 | Smartphone verticale | **PASS automatico** | 320/390. |
| 24 | Smartphone orizzontale | **PASS automatico** | 844×390. |
| 25 | Rotazione dispositivo | **PASS automatico** | Cambi viewport verticale/orizzontale. |
| 26 | Zoom browser | **PASS verifica CSS/accessibilità** | Unità fluide e testo non bloccato; zoom manuale multi-browser resta deploy/manuale. |
| 27 | Scroll rotella | **PASS automatico/UI** | Nessun 100vh bloccante; scroll preservato. |
| 28 | Touch | **PASS automatico/CSS** | Aree touch ≥40 px e pointer events. |
| 29 | Tastiera | **PASS automatico** | Focus, Enter/Space, Tab/Escape. |
| 30 | Apertura fotografia | **PASS automatico** | Viewer articolo aperto. |
| 31 | Chiusura fotografia | **PASS automatico** | Escape. |
| 32 | Tasto Escape | **PASS automatico** | Viewer chiuso senza chiudere dettaglio sottostante. |
| 33 | Ritorno focus | **PASS automatico** | Focus torna al pulsante immagine. |
| 34 | Cambio tra articoli | **PASS automatico** | Nessun contenuto precedente. |
| 35 | Refresh dettaglio | **PASS automatico** | Hash stabile e riapertura. |
| 36 | Apertura tramite URL | **PASS automatico** | #article=slug. |
| 37 | Ritorno lista | **PASS automatico** | History back e posizione scroll. |
| 38 | Nessun overflow orizzontale | **PASS automatico** | 11 larghezze complessive. |
| 39 | Nessuna sovrapposizione | **PASS automatico/UI** | Layout e overlay. |
| 40 | Nessun ritaglio aggressivo | **PASS automatico** | object-fit contain. |
| 41 | Nessuna deformazione | **PASS automatico** | height auto/contain. |
| 42 | Nessuno sfarfallio | **PASS automatico/logica** | Render stabile, URL invariato, cambio atomico. |
| 43 | Nessun contenuto articolo precedente | **PASS automatico** | Switch ripetuto verificato. |
| 44 | Anteprima admin | **PASS automatico** | Stesso article-detail-editorial. |
| 45 | Azioni admin desktop | **PASS automatico** | Anteprima/modifica/elimina. |
| 46 | Azioni admin mobile | **PASS automatico** | Touch e nessun overflow. |
| 47 | Nessuna modifica Cloudinary | **PASS confronto sorgenti** | Flusso tecnico immagini Articoli non modificato. |
| 48 | Nessuna modifica upload file Articoli | **PASS automatico/confronto** | Upload esistente e relativo test ancora passano. |

## 12. Conferma assenza regressioni Articoli

La suite Articoli verifica lista pubblica, filtri, URL diretto, dettaglio, immagini, anteprima admin, creazione/modifica/eliminazione, sicurezza, mobile e sincronizzazione. Tutti i test sono passati. Nessun endpoint, tabella, secret, cartella Cloudinary o funzione di upload delle immagini Articoli è stato modificato.

## 13. Limiti residui dichiarati

1. Non è stato possibile interrogare la produzione reale: mancano secrets, credenziali/sessione, dominio e accesso ai log remoti.
2. Il ruolo “admin” del progetto coincide già con “utente Supabase autenticato”; la Edge Function conserva questo modello. Per ruoli granulari servirebbe una regola applicativa aggiuntiva non presente nel progetto originale.
3. Le immagini Articolo legacy non hanno sempre metadati intrinseci larghezza/altezza nel modello; il layout riduce il salto con dimensioni/contain, ma eliminarlo al 100% richiederebbe cambiare il modello dati, vietato dal secondo prompt.
4. Safari/iOS reali, certificato TLS, reverse proxy e limiti hosting devono essere verificati sul dominio pubblicato.

## 14. Verifica finale dopo deploy

1. eseguire `SUPABASE_SETUP.sql`;
2. configurare i secrets e `PHOTO_ALLOWED_ORIGINS`;
3. deployare `team-photos`;
4. aprire DevTools Network e verificare OPTIONS 204, POST 201/207, `Access-Control-Allow-Origin` corretto e assenza redirect/mixed content;
5. caricare JPEG/PNG/WebP reali e controllare Cloudinary `squadra/<teamId>` e riga `team_photos`;
6. scaricare originale e ZIP, confrontando formato, dimensioni e risoluzione;
7. eliminare/sostituire e verificare Cloudinary, DB e refresh galleria;
8. ripetere su dominio produzione e dispositivi Safari/iOS/Android.

## 15. Artefatti di consegna

- progetto completo corretto e compilato;
- patch sorgente `CHANGES_V126_16.patch`;
- codice completo dei file modificati in `FULL_MODIFIED_FILES_V126_16.md`;
- output test in `TEST_RESULTS_V126_16.txt`.
