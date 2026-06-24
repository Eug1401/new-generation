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

La build genera `dist/`, pronta per il deploy statico. Il progetto consegnato non contiene script, screenshot o artefatti di test: sono stati rimossi dopo le verifiche finali.

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
└── INTERVENTO_UI_GESTIONE_PARTITA_V131.md
```

## Gestione partita responsive

Dalla versione 1.31.0 la finestra di gestione partita utilizza una struttura responsive unica per desktop, tablet e smartphone:

- intestazione e barra azioni sempre accessibili;
- scroll esclusivamente verticale all’interno della finestra;
- ricerca unificata per nome o numero di maglia, utilizzabile anche da tastiera;
- contatori touch per gol normali e gol doppi;
- marcatori raggruppati per squadra e mostrati come card responsive;
- modifica diretta delle quantità e del giocatore associato;
- eliminazione con possibilità di annullamento;
- layout adattivo anche per info partita e cartellini;
- focus visibile, chiusura con `Escape` e ripristino del focus.

Il report completo dell’intervento e dei test è disponibile in `INTERVENTO_UI_GESTIONE_PARTITA_V131.md`.

### Hardening e test 1.31.0

La versione 1.31.0 aggiunge correzioni mirate alla gestione di `Escape` nei combobox e all’aggiornamento immediato dello stato Live. La verifica finale comprende 2.930 asserzioni browser, 12.400 asserzioni randomizzate sulla logica dei gol e una suite di regressione completa.

## Marcatori e modalità KINGS

La logica dei gol resta centralizzata in `assets/js/store.js` e non è stata modificata dall’intervento UI 1.31.0.

- Un gol normale vale 1 nella classifica marcatori e 1 nel risultato.
- Un gol doppio KINGS vale 1 nella classifica marcatori e 2 nel risultato.
- Il gol del presidente è separato dalla classifica ordinaria, alimenta la classifica presidenti e vale 1 nel risultato.
- Gli autogol vengono attribuiti alla squadra avversaria.
- Dettagli, statistiche, card ed export usano la stessa aggregazione per partecipante e tipologia.

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
