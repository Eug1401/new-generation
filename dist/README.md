# New Generation Tournament

Applicazione statica multipagina per la gestione e la pubblicazione di un torneo, realizzata con HTML, CSS e JavaScript vanilla. La persistenza usa Supabase; i media possono essere ospitati su Cloudinary.

## Tecnologie

- HTML5, CSS3 e JavaScript ES2020+ senza framework;
- Supabase JS SDK per persistenza e aggiornamenti realtime;
- jsPDF e jspdf-autotable per gli export PDF lato browser;
- Canvas e Web Share API per gli export immagine;
- Node.js 18 o successivo esclusivamente per validazione e build.

## Avvio locale

Non è richiesto un bundler. Servire la cartella con un server HTTP statico, per esempio:

```bash
python3 -m http.server 8080
```

Pagine principali:

- `http://localhost:8080/index.html` — sito pubblico;
- `http://localhost:8080/admin.html` — area amministrativa.

## Validazione e build

```bash
npm run lint
npm run build
```

La build genera `dist/`, pronta per il deploy statico. Il progetto consegnato non contiene script o artefatti di test: sono stati rimossi dopo l’esecuzione delle verifiche finali.

## Struttura

```text
.
├── index.html
├── admin*.html
├── print.html
├── 404.html
├── assets/
│   ├── css/styles.css
│   ├── js/
│   └── brand/
├── supabase/functions/
├── tools/
│   ├── validate-project.mjs
│   └── build-static.mjs
├── dist/
└── INTERVENTO_MARCATORI_KINGS_V129.md
```

## Marcatori e modalità KINGS

Dalla versione 1.29.0 la logica dei gol è centralizzata in `assets/js/store.js`.

- Un gol normale vale 1 nella classifica marcatori e 1 nel risultato.
- Un gol doppio KINGS vale 1 nella classifica marcatori e 2 nel risultato.
- Il gol del presidente è separato dalla classifica ordinaria, alimenta la classifica presidenti e vale 1 nel risultato.
- Gli autogol vengono attribuiti alla squadra avversaria.
- Dettagli, statistiche, card ed export usano la stessa aggregazione per partecipante e tipologia.

Il report completo dell’intervento, con cause, file modificati e test eseguiti, è disponibile in `INTERVENTO_MARCATORI_KINGS_V129.md`.

## Configurazione servizi

Le configurazioni pubbliche sono in `assets/js/supabase-config.js`. Inserire esclusivamente chiavi anonime/pubbliche, mai token server o segreti.

Documentazione disponibile:

- `CLOUDINARY_SUPABASE_SETUP.md`;
- `SUPABASE_GUIDA.txt`;
- `SUPABASE_SETUP.sql`;
- `CALENDAR_CUSTOMIZATION.md`;
- `CALENDAR_RULES_REFERENCE.md`;
- `SHAREABLE_IMAGES.md`.

## Compatibilità

- browser moderni Chrome, Firefox, Safari ed Edge;
- layout responsive per desktop, tablet e smartphone;
- compatibilità con partite già salvate e con eventi gol legacy privi di un peso valido;
- nessuna dipendenza runtime installata tramite npm.
