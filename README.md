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
└── INTERVENTO_UI_GESTIONE_PARTITA_V132.md
```

## Gestione partita responsive

Dalla versione 1.32.0 la finestra di gestione partita utilizza una struttura responsive unica per desktop, tablet e smartphone:

- intestazione e barra azioni sempre accessibili;
- scroll esclusivamente verticale all’interno della finestra;
- ricerca unificata per nome o numero di maglia, utilizzabile anche da tastiera;
- contatori touch per gol normali e gol doppi;
- marcatori raggruppati per squadra e mostrati come card responsive;
- modifica diretta delle quantità e del giocatore associato;
- eliminazione con possibilità di annullamento;
- layout adattivo anche per info partita e cartellini;
- focus visibile, chiusura con `Escape` e ripristino del focus.

Il report completo dell’intervento e dei test è disponibile in `INTERVENTO_UI_GESTIONE_PARTITA_V132.md`.

### Salvataggio generale e bozze 1.32.0

La versione 1.32.0 introduce un solo punto di salvataggio definitivo, centrato nella scheda principale della partita. Le sezioni **Info partita**, **Marcatori** e **Cartellini** aggiornano esclusivamente una bozza locale e mostrano chiaramente lo stato delle modifiche.

Regole operative:

- nessun pulsante di salvataggio definitivo è presente nelle singole sezioni;
- marcatori, cartellini, rigori e stato Live vengono applicati insieme dal salvataggio generale;
- una gara senza modifiche può essere refertata 0-0 senza cartellini soltanto dopo conferma esplicita;
- una gara con soli cartellini viene salvata correttamente come 0-0;
- le sole variazioni organizzative — campo, arbitro, data e orario — vengono salvate senza refertare la partita;
- lo svuotamento completo di un referto già definitivo richiede una conferma aggiuntiva;
- lo stato mostrato distingue sempre i dati definitivi dalle variazioni ancora in bozza.

La verifica V132 comprende **256 asserzioni browser**, una matrice di 30 combinazioni operative, modalità KINGS e non KINGS, fasi a eliminazione diretta, stato Live, responsive da 320 a 1600 px e zoom al 125%/150%.

## Marcatori e modalità KINGS

La logica dei gol resta centralizzata in `assets/js/store.js` e non è stata modificata dall’intervento UI 1.32.0.

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
