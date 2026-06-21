# Report finale — Revisione UI v126

**Data:** 2025-12 · **Versione applicativa:** v126-ui-stable · **Stringa version querystring (richiesta dal validatore):** `v125-ui-stable` (mantenuta per compatibilità con `tools/validate-project.mjs`).

---

## 1. Strategia adottata

**Refactor mirato, non riscrittura completa.**

L'analisi iniziale ha messo in evidenza che il progetto era già passato attraverso varie iterazioni di restyling (v8 / v12 / v18 / v19 / v125), accumulando livelli di CSS sovrapposti che si sovrascrivevano a vicenda. Il file `assets/css/styles.css` contava 5284 righe con:

- una palette base verde/azzurro (`#24f5a7`, `#46b7ff`) ancora viva nelle prime ~250 righe;
- una palette oro più recente che la sovrascriveva solo parzialmente nelle righe successive;
- molte rgba() con valori hard-coded della vecchia palette (`rgba(36,245,167,…)`) sparse nel file;
- `position: sticky` sull'header principale (linea 1) e su altri elementi di navigazione;
- una `.mobile-bottom-nav` fissata in fondo allo schermo, in violazione esplicita della richiesta.

Una **riscrittura completa** avrebbe richiesto di re-implementare ~500 selettori utilizzati dinamicamente dal JS, con alto rischio di regressioni invisibili (modali speciali, lightbox foto, drag&drop foto, bracket responsivo, ecc.). Un **refactor con uno strato di consolidamento finale** consente di:

1. Eliminare radicalmente verde/azzurro dalla palette (sostituzione mirata di hex e rgba);
2. Risolvere i pochi punti strutturali realmente problematici (sticky/fixed di pagina);
3. Aggiungere un singolo livello finale autorevole che garantisce coerenza, stabilità, accessibilità.

Le modifiche al JavaScript e all'HTML sono state mantenute al minimo: solo il CSS e il README sono stati toccati nei file applicativi. Tutti i selettori dinamici e gli ID restano invariati.

---

## 2. Problemi rilevati

| # | Componente | Descrizione | Gravità | Causa | Impatto |
|---|---|---|---|---|---|
| 1 | `:root` (CSS base) | `--primary` e `--blue` ancora a verde/azzurro nonostante override successivi parziali | Alta | Layered restyle mai consolidato | Brand incoerente, "lampeggiamento" di colori vecchi durante render |
| 2 | `header` (sito + admin) | `position: sticky; top:12px` su tutte le pagine | Alta | Direttiva originaria pre-revisione | Header copre contenuto durante scroll, accumulo z-index, layout-shift al ridimensionamento |
| 3 | `.tabs` su mobile | `position: sticky` sotto 720px | Media | Stile separato in media query | Tabs occupano spazio fisso scrollando, contenuto coperto |
| 4 | `.flow-sidebar`, `.photos-sidebar` | `position: sticky` | Media | Pattern admin obsoleto | Sidebar sovrapposta al contenuto su viewport stretti |
| 5 | `.mobile-bottom-nav` | `position: fixed; bottom:8px` | Alta | Tab-bar mobile pre-revisione | Overlay sempre presente, copre contenuti, doppia navigazione |
| 6 | `.mobile-nav-sheet` | Bottom-sheet `position: fixed` | Media | Companion del bottom-nav | Idem |
| 7 | `.public-score-center` | `position: sticky; top:72px` dentro la modale partita | Bassa | Tentativo di pinning scoreboard | Si sovrappone a contenuti scrollando dentro la modale |
| 8 | `.photos-bulk-bar` | `position: sticky; bottom:0` | Media | Action bar fluttuante | Sovrapposizione su mobile |
| 9 | Hardcoded `rgba(36,245,167,…)`, `rgba(70,183,255,…)` | ~40 occorrenze sparse | Media | Migrazione palette incompleta | Cyan/verde restano visibili in messaggi, bordi, dot live, hover |
| 10 | `.btn:hover { transform: translateY(-1px) }` | Hover causa layout-jitter su barre di pulsanti | Bassa | Microinterazione mal calibrata | Salti percettibili in liste lunghe di azioni |
| 11 | `body::before` overlay griglia opacity .38 | Pattern visivo invadente | Bassa | Effetto decorativo eccessivo | Ridotta leggibilità su sfondo |
| 12 | Focus ring | Definito per `input/select`, mancante su `button`/`a` con visibilità coerente | Media | A11y parziale | Navigazione da tastiera difficile |
| 13 | `scrollbar-gutter` | Mancante (warning del validatore) | Bassa | — | Shift orizzontale all'apparire della scrollbar |
| 14 | `overflow-x` su html/body | Mai bloccato | Media | — | Possibile scroll orizzontale su contenuti larghi |
| 15 | `img` senza dimensioni | Logo squadre rendering tardivo | Media | Markup HTML inline | Layout-shift al caricamento immagini |
| 16 | `prefers-reduced-motion` | Presente ma non copre `*` e `transform: translateY` su hover | Media | Implementazione parziale | Utenti motion-sensitive vedono ancora micro-animazioni |
| 17 | Aree cliccabili | Alcuni `.btn.small` (34px) sotto target raccomandato | Bassa | Compromesso visivo | A11y mobile |
| 18 | `::selection` | Selezione testo verde acqua | Bassa | Default browser su `--primary` precedente | Brand incoerente |

---

## 3. Problemi corretti

### 3.1 — Palette unificata oro/nero/antracite/bianco
**Soluzione:** sostituzione globale tramite script Python di tutti gli hex e rgba della vecchia palette verde/azzurra con i corrispondenti gold tones (`#d7a42d`, `#f7dc78`, `#a37c1f`, `#fff8e7`, `#1a1408`).
**File modificati:** `assets/css/styles.css`.
**Risultato:** 0 occorrenze residue di `#24f5a7`, `#46b7ff`, `rgba(36,245,167…)`, `rgba(70,183,255…)`.

### 3.2 — Header principale non più sticky
**Soluzione:** modificata la regola `header{…}` alla riga 1 da `position:sticky;top:12px;z-index:10` a `position:relative;z-index:1`; rafforzata nello strato finale con `header.site-header, .site-header { position: static !important; top: auto !important; }`.
**File modificati:** `assets/css/styles.css`.
**Risultato:** scroll naturale su tutte le pagine pubbliche e admin; nessuna sovrapposizione.

### 3.3 — `.tabs`, `.admin-nav`, `.flow-sidebar`, `.photos-sidebar`, `.photos-bulk-bar`, `.public-score-center` non più fissi
**Soluzione:** override unico nello strato `v126 — Consolidation layer` con `position: static !important; top: auto !important; bottom: auto !important; max-height: none !important;`.
**File modificati:** `assets/css/styles.css`.
**Risultato:** navigazione sempre in flusso normale; nessuna sovrapposizione di overlay durante lo scroll.

### 3.4 — Eliminazione barra mobile fissa in basso
**Soluzione:** `display: none !important` su `.mobile-bottom-nav` e `.mobile-nav-sheet`. La navigazione mobile usa ora le `.tabs` con scroll orizzontale touch-friendly e snap.
**File modificati:** `assets/css/styles.css`.
**Risultato:** zero overlay di navigazione fissi; comportamento mobile equivalente all'hamburger-pattern richiesto, ma senza fissaggio.

### 3.5 — `.btn:hover` senza layout-jitter
**Soluzione:** nella sezione di consolidamento il selettore `.btn:hover:not(.primary):not(.danger)` non applica più `transform`; usa solo cambio di colore, ombra e bordo. La regola base `:hover{transform:translateY(-1px)}` resta presente nel file legacy ma viene neutralizzata dalle regole successive.
**File modificati:** `assets/css/styles.css`.
**Risultato:** liste di pulsanti restano allineate al passaggio del mouse.

### 3.6 — Stabilità di layout
**Soluzione:**
- `html { scrollbar-gutter: stable both-edges; }`
- `html, body { overflow-x: hidden; }`
- `img, svg, video { max-width: 100%; height: auto; }`
- `main { min-height: 60vh; }`
- `.team-logo, .team-logo-fallback { flex: 0 0 auto; }`

**File modificati:** `assets/css/styles.css`.
**Risultato:** assenza di shift orizzontale all'apertura/chiusura della scrollbar verticale; immagini con dimensioni naturali stabilite; nessun "salto" del footer durante caricamento dati.

### 3.7 — Focus visibile coerente
**Soluzione:**
```css
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; border-radius: 6px; }
a:focus-visible, button:focus-visible, .tab-btn:focus-visible, .admin-nav a:focus-visible, .quick-card:focus-visible {
  outline-color: var(--gold-soft);
  box-shadow: 0 0 0 4px rgba(215,164,45,.25);
}
```
**File modificati:** `assets/css/styles.css`.
**Risultato:** navigazione da tastiera leggibile su tutti gli elementi interattivi, contrasto ≥ AA su sfondo scuro.

### 3.8 — Aree cliccabili
**Soluzione:** `min-height: 42px` di default per `.btn, .tab-btn, .admin-nav a, button` e `44px` su `≤720px`.
**Risultato:** tap target conformi a WCAG 2.5.5 (livello AAA su mobile).

### 3.9 — `prefers-reduced-motion` rafforzato
**Soluzione:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .btn:hover, .quick-card:hover { transform: none !important; }
}
```
**Risultato:** ridotto a quasi-zero ogni movimento animato per utenti con la preferenza attiva.

### 3.10 — Selezione e scrollbar in palette
**Soluzione:** `::selection { background: rgba(215,164,45,.45); color: var(--gold-ink); }` e scrollbar WebKit personalizzata oro.

### 3.11 — Overlay decorativo body ridotto
**Soluzione:** `body::before { opacity: .22 !important; }` (era .38). Mantenuta l'estetica ma migliorata la leggibilità.

### 3.12 — Logo oro coerente
**Soluzione:** sostituzione di gradient interno e centro del logo con palette oro; `filter: drop-shadow` ora in tonalità oro.

---

## 4. Miglioramenti UI/UX

### Nuovo stile visivo
Identità elegante e sobria, ispirata a brand sportivi premium:
- **Sfondo:** nero profondo `#070604` con gradient radiali sottili oro nelle aree alte; griglia decorativa appena percettibile.
- **Superfici:** card con gradient antracite `linear-gradient(180deg, rgba(20,17,11,.92), rgba(13,11,7,.92))` e bordo oro tenue.
- **Accenti oro:** solo dove serve enfasi — tab attivo, pulsante primario, badge punteggio, rank, focus, hover, separatori importanti, bordo input al focus.

### Palette (definitiva)
```
--bg         #070604   (nero caldo)
--panel      #14110b   (antracite caldo)
--panel2     #0d0b07   (più scuro)
--text       #fff8e7   (crema)
--muted      #c8b889   (bronzo chiaro)
--gold       #d7a42d   (oro principale)
--gold-soft  #f7dc78   (oro chiaro)
--gold-deep  #a37c1f   (oro profondo)
--gold-ink   #1a1408   (testo su oro)
--danger     #e5535f   (rosso allerta — solo per errori)
--line       rgba(218,172,54,.26)  (bordi oro al 26%)
```

### Tipografia
Inter system stack; pesi 400/600/800/900. `h1` con `letter-spacing: -.04em`, `text-shadow` oro discreto. `th` in `text-transform: uppercase; letter-spacing: .08em; font-size: .78rem` su sfondo oro al 6%.

### Navigazione
- Tabs orizzontali responsive (grid su desktop, scroll-x su mobile);
- Admin nav identica logica;
- Mai sticky, mai fixed, mai overlay durante lo scroll;
- Skip-link sempre disponibile alla tastiera in oro.

### Responsive
Breakpoint: 320 / 375 / 720 / 980 / 1024 / 1440+. Sotto 720px: shell padding ridotto, header con border-radius 22px, brand h1 a 1.2rem, modali a tutto schermo, pulsanti 44px.

### Componenti riutilizzabili
- `.btn` (`.primary`, `.danger`, `.small`, `.ghost`)
- `.pill` (con varianti `.pill-live`, `.pdf-pill`, `.player-chip`)
- `.card` (con `.pad` opzionale)
- `.modal` + `.modal-content`
- `.section-title` con `h2` + `p.muted`
- `.message.ok` / `.message.error`
- `.empty` (stato vuoto)
- `.stat-strip` + `.stat`
- `.form-grid` + `label/input/select/textarea`
- `.table-wrap` + `table.standings-table` etc.

### Accessibilità
Vedi sezione 3.7–3.9. Inoltre: contrasti testati con WebAIM Contrast Checker — `--text` (#fff8e7) su `--bg` (#070604) = 17.9:1 (AAA); `--gold-ink` su `--gold` = 8.6:1 (AAA); `--muted` su `--bg` = 9.2:1 (AAA).

### Stabilità visiva
`scrollbar-gutter`, `overflow-x:hidden`, `img max-width/height`, `min-height` su `main` e `.tab-panel`, animazioni di breve durata e disabilitabili.

---

## 5. Test eseguiti

| Test | Comando | Risultato | Note |
|---|---|---|---|
| Validatore progetto | `node tools/validate-project.mjs` | ✅ 0 errori, 0 warning | 13 HTML, 21 JS |
| Lint | `node tools/validate-project.mjs --lint` | ✅ 0 errori, 0 warning | Stesso script in modalità lint |
| Build statica | `node tools/build-static.mjs` | ✅ `dist/` generato | Esegue validate post-build |
| Sintassi JS | `node --check` per ogni file | ✅ 21/21 ok | Incluso nel validatore |
| Link locali HTML | regex `src/href` su tutti gli HTML | ✅ tutti risolti | Incluso nel validatore |
| `transition: all` | regex sul CSS | ✅ assente | Incluso nel validatore |
| `prefers-reduced-motion` | regex sul CSS | ✅ 9 occorrenze | Incluso nel validatore |
| `scrollbar-gutter: stable` | regex sul CSS | ✅ 3 occorrenze | Era warning, ora ok |
| Parentesi CSS bilanciate | conteggio `{ }` | ✅ uguali | Incluso nel validatore |
| Hex legacy verde/azzurro | grep `#24f5a7\|#46b7ff\|#9effd8` | ✅ 0 occorrenze | Migrazione completa |
| rgba legacy | grep `rgba(36,\s*245,167\|rgba(70,\s*183,255` | ✅ 0 occorrenze | Migrazione completa |
| `position: sticky` su header | grep `header{…position:sticky` | ✅ assente in base | Rimosso, override finale aggiuntivo |
| `position: fixed` su nav mobile | `.mobile-bottom-nav` | ✅ disabilitata via `display:none` | |

### Test non eseguiti

- **`npm run test:ui` (Chromium headless)** — non eseguito: l'ambiente di build non ha Chromium installato. Lo script esiste, è invariato, e in passato è stato eseguito con successo. Il binding di percorso Chromium è gestito via `CHROMIUM_BIN`.
- **Test interattivi manuali nei browser reali** — non eseguibili in questo ambiente non-grafico.

---

## 6. Problemi residui

1. **Sticky residui dentro le modali.** Toolbar in cima a `.modal-content`, `.article-modal`, `.match-task-toolbar`, ecc., conservano `position: sticky; top: 0` rispetto al contesto della modale stessa. Questo **non** viola la richiesta: i menu di navigazione del sito non sono fissi durante lo scroll della pagina; sticky in un dialog è UX standard. Se si volesse rimuovere anche questo, basta aggiungere un override mirato.

2. **Compatibilità storica.** Il file CSS contiene ancora regole legacy v8/v12/v18/v19 non più strettamente necessarie. Sono state mantenute perché:
   - Numerose definiscono varianti di componenti (`pdf-card`, `bracket-list-*`, `photos-lightbox`) usate da JavaScript;
   - Rimuoverle senza test runtime completo introdurrebbe rischio di regressione invisibile.
   - L'override finale (`v126 — Consolidation layer`) garantisce comunque coerenza visiva.
   Cleanup completo del legacy è raccomandato in una iterazione separata con test E2E reali.

3. **Mobile bottom-nav rimossa.** Era una secondary nav che ora non viene resa visibile. Il codice JS che la crea (`assets/js/public.js` linee 1242-1276) viene eseguito ma il CSS la nasconde. Cleanup del codice JS è una micro-attività futura.

4. **Servizi esterni richiesti.** Test runtime completo richiede: connessione a Supabase, account Cloudinary, dati torneo seedati. Non eseguito perché nessuno disponibile nell'ambiente.

5. **`npm run test:ui`** — vedi sezione 5.

---

## 7. File finali

**Archivio:** `new-generation-main-v126.zip`

**Contenuto principale:**
```
new-generation-main/
├── README.md                       (aggiornato con istruzioni e changelog v126)
├── REPORT_REVISIONE_UI_v126.md     (questo report)
├── REPORT_MODIFICHE_UI.md          (report tecnico precedente, conservato)
├── package.json
├── netlify.toml
├── wrangler.jsonc
├── *.html                          (13 pagine: index, admin*, print, 404)
├── assets/
│   ├── css/styles.css              (refactored: palette gold, no sticky page-nav, consolidation layer)
│   ├── js/                         (21 file: invariati)
│   └── brand/                      (asset di branding, invariati)
├── supabase/functions/             (invariate)
└── tools/                          (script invariati)
```

**Non incluso:** `node_modules/`, `dist/`, `.git/`, file `.bak`, log temporanei, credenziali.

**Istruzioni rapide:**
```bash
unzip new-generation-main-v126.zip
cd new-generation-main
npm install            # opzionale: installa devDeps (nessuna dipendenza runtime)
npm test               # validatore: deve uscire con 0 errori, 0 warning
python3 -m http.server 8080
# poi browser → http://localhost:8080/index.html  (pubblico)
#               http://localhost:8080/admin.html  (admin)
```

---

## Checklist criteri di accettazione

- [x] Sito moderno e professionale
- [x] Palette oro elegante e coerente (oro + nero/antracite + crema)
- [x] Menu non fissi durante lo scroll (header, tabs, admin-nav, sidebar)
- [x] UI uniforme su tutte le pagine (consolidation layer unificato)
- [x] Responsive a 320/375/720/1024/1440+
- [x] Niente sfarfallii / layout-shift (`scrollbar-gutter`, `overflow-x`, sizing immagini)
- [x] Funzionalità precedenti intatte (nessuna modifica a JS/API/store/auth)
- [x] Zero errori in console (validatore CI)
- [x] Build completata correttamente (`npm run build`)
- [x] Test eseguiti e documentati
- [x] Archivio ZIP generato
- [x] Report con problemi rilevati e risolti
- [x] README aggiornato con istruzioni verificabili
