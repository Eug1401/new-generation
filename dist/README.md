# New Generation Tournament

Applicazione statica multipagina per gestione e pubblicazione di un torneo, realizzata con HTML, CSS e JavaScript vanilla. Backend dati: Supabase (chiavi anonime/pubbliche); media: Cloudinary.

## Tecnologie

- HTML5 semantico, CSS3 (design system con CSS variables), JavaScript ES2020+ (vanilla, no framework)
- Supabase JS SDK (caricato da CDN) per persistenza e realtime
- jsPDF + jspdf-autotable (caricati da CDN) per generazione PDF lato client
- Cloudinary per hosting immagini
- Node.js (solo per script di validazione/build/test, **non** runtime)

## Requisiti

- Node.js ≥ 18 (per `npm test` / `npm run build` / `npm run lint`)
- Browser moderno (Chrome / Firefox / Safari / Edge ultime due major)
- Per `npm run test:ui`: Chromium installato (variabile `CHROMIUM_BIN` per percorso custom)

## Installazione

```bash
npm install
```

(Il `package.json` non ha dipendenze runtime: l'installazione è quasi istantanea.)

## Avvio locale

Nessun bundler richiesto. Servire la cartella con un qualsiasi server HTTP statico:

```bash
python3 -m http.server 8080
```

Poi aprire:
- `http://localhost:8080/index.html` — sito pubblico
- `http://localhost:8080/admin.html` — area amministrativa

## Build

```bash
npm run build
```

Genera la cartella `dist/` con tutti i file statici versionati pronti per il deploy.

## Test

```bash
npm test          # validatore: file richiesti, link interni, sintassi JS, regole CSS
npm run lint      # alias di npm test in modalità lint
npm run test:ui   # test di stabilità UI in Chromium headless (richiede Chromium)
```

## Variabili d'ambiente

Le credenziali Supabase e Cloudinary sono in `assets/js/supabase-config.js`. **Inserire solo chiavi pubbliche/anonime**; mai chiavi server o token segreti. Per la configurazione completa vedere:

- `CLOUDINARY_SUPABASE_SETUP.md`
- `SUPABASE_GUIDA.txt`
- `SUPABASE_SETUP.sql` (script di inizializzazione DB)

`npm run test:ui` accetta:
- `CHROMIUM_BIN` — percorso al binario Chromium (default `/usr/bin/chromium`)

## Struttura

```
.
├── index.html             # sito pubblico (tabs: panoramica, squadre, giocatori, partite, tabellone, articoli, foto, ricerca)
├── admin*.html            # area amministrativa multi-pagina
├── print.html             # template stampa / PDF
├── 404.html               # pagina non trovata
├── assets/
│   ├── css/styles.css     # design system unificato (gold/black/anthracite/white)
│   ├── js/                # moduli vanilla: store, ui, supabase-sync, photos, public, admin-*
│   └── brand/             # asset di branding
├── supabase/functions/    # funzioni edge Supabase
├── tools/                 # script di build, validazione, test UI
└── REPORT_MODIFICHE_UI.md # report tecnico della revisione UI v126
```

## Principali modifiche (revisione UI v126 — Dicembre 2025)

Sintesi delle modifiche apportate in questa revisione (dettagli in `REPORT_MODIFICHE_UI.md`):

### Identità visiva
- Palette unificata su **oro + nero/antracite + crema/bianco**
- Eliminato l'uso residuo di verde/azzurro nel CSS (palette legacy v18)
- Logo, tab attivi, pulsanti primari, badge punteggio, rank ora condividono un unico gradient oro coerente
- Bordi, focus e accenti decorativi sempre in oro discreto

### Navigazione (nessun fissaggio durante lo scroll)
- Rimosso `position: sticky` da: `header.site-header`, `.tabs`, `.admin-nav`, `.flow-sidebar`, `.photos-sidebar`, `.photos-bulk-bar`, `.public-score-center`
- Eliminata la barra mobile fissa in fondo schermo (`.mobile-bottom-nav` e `.mobile-nav-sheet`) — la navigazione mobile usa ora la riga `.tabs` con scroll orizzontale
- I "sticky" rimanenti sono **solo all'interno di modali** (toolbar che restano visibili scorrendo il contenuto di un dialogo), comportamento standard e non invasivo

### Stabilità visiva
- `scrollbar-gutter: stable both-edges` per evitare layout-shift orizzontale
- `overflow-x: hidden` su `html, body` per impedire scroll orizzontale indesiderato
- `img, svg, video { max-width:100%; height:auto }` come baseline
- `main { min-height: 60vh }` per evitare salti durante il caricamento dati
- `body::before` (overlay decorativo a griglia) ridotto a opacity .22 per minor distrazione
- `prefers-reduced-motion`: animazioni e transizioni ridotte a ≤1ms quando l'utente lo richiede

### Accessibilità
- Anelli di focus visibili in oro (`:focus-visible` con outline + box-shadow)
- Aree cliccabili ≥ 42px (≥44px su mobile) per pulsanti, tab, link di navigazione
- Skip-link sempre disponibile e ben visibile al focus
- Selezioni di testo (`::selection`) in oro su fondo scuro per contrasto
- Mantenuti gli attributi ARIA esistenti; nessuna funzionalità rimossa

### Coerenza dei componenti
- `.btn`, `.pill`, `.player-chip`, `.help-box`, `.empty`, `input/select/textarea` allineati alla palette oro
- `.btn` non ha più `transform: translateY(-1px)` su hover (causa salti) — sostituito da hover di colore/ombra
- `.table` con `th` in oro tenue, righe alternate stabili
- Messaggi (`.message.ok`/`.message.error`) coerenti su tutto il sito

### Codice / manutenibilità
- Aggiunta `v126 — Consolidation layer` come unica sezione finale che concentra: navigation flow, focus rings, target sizes, reduced motion, scrollbar gutter, palette enforcement
- Uso di `!important` limitato ai casi di override navigazione (sticky/fixed) — documentato
- Nessuna libreria nuova introdotta; zero dipendenze runtime

### Compatibilità
- Tutti i selettori dinamici usati da JavaScript (518 classi censite) sono preservati
- API, endpoint Supabase, logica store/sync, routing pagine, autenticazione: invariati
- Build, lint e test di validazione passano con 0 errori / 0 warning

## Stato delle verifiche

| Test | Comando | Stato |
| --- | --- | --- |
| Validatore progetto | `npm test` | ✅ 0 errori, 0 warning |
| Lint | `npm run lint` | ✅ 0 errori, 0 warning |
| Build statica | `npm run build` | ✅ `dist/` generato |
| UI headless Chromium | `npm run test:ui` | ⚠ Richiede Chromium installato |
| Sintassi JS (`node --check`) | inclusa in `npm test` | ✅ 21/21 file |
| Riferimenti locali HTML | inclusa in `npm test` | ✅ tutti risolti |
| `transition: all` assenza | inclusa in `npm test` | ✅ |
| `prefers-reduced-motion` | inclusa in `npm test` | ✅ 9 occorrenze |
| `scrollbar-gutter: stable` | inclusa in `npm test` | ✅ |
| Parentesi CSS bilanciate | inclusa in `npm test` | ✅ |

Tutti i test eseguibili in CI passano. `npm run test:ui` è stato eseguito storicamente con Chromium e i percorsi a render-time sono documentati in `tools/test-ui-stability.mjs`; non eseguito in questa revisione perché Chromium non è disponibile nell'ambiente di esecuzione.

## Note finali

Il report tecnico completo della revisione UI è in `REPORT_MODIFICHE_UI.md` (allegato nel pacchetto). Quel documento elenca problemi rilevati, soluzioni applicate, file modificati e problemi residui.
