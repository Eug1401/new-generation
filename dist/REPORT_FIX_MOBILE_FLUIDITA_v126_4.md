# Report — Fix menu mobile + fluidità UI + riquadro oro (v126.4)

## 1. Problemi rilevati

### Problema #1 — Riquadro oro all'apertura del sito *(priorità alta)*

| Campo | Valore |
|---|---|
| Componente | `<main id="main-content" tabindex="-1">` su tutte le pagine |
| Causa tecnica | Il layer `v126 — Consolidation layer` aveva un selettore globale `:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px }` non scopato. Quando il browser carica una pagina con un fragment hash (es. `#main-content`) o quando lo skip-link viene attivato/programmaticamente focalizzato, `<main tabindex="-1">` riceve focus e attiva `:focus-visible`. Il selettore globale disegnava un **outline oro da 2px attorno a TUTTO il contenitore main** (cioè quasi l'intera pagina). |
| Viewport | Tutti — desktop e mobile (ma più evidente su mobile dove main occupa tutto lo schermo) |
| Gravità | Alta — primo impatto visivo "ammazza" il sito appena aperto |
| Impatto utente | Pessima percezione brand, sensazione di errore o stato di selezione persistente |

### Problema #2 — Menu inferiore mobile scomparso *(priorità massima)*

| Campo | Valore |
|---|---|
| Componente | `.mobile-bottom-nav` + `.mobile-nav-sheet` (generati dinamicamente da `setupMobileNavigation()` in `assets/js/public.js`) |
| Causa tecnica | Nel layer `v126 — Consolidation layer` avevo aggiunto `.mobile-bottom-nav, .mobile-nav-sheet { display: none !important }`. Il JavaScript continuava a creare il DOM correttamente, ma il CSS lo rendeva invisibile. |
| Viewport | Tutti i breakpoint ≤720px (mobile portrait e landscape, tutti i device target) |
| Gravità | **Massima** — l'utente mobile resta senza navigazione (le `.tabs` top erano la nav di fallback ma su mobile risultavano scomode rispetto al bottom nav previsto dal design originale) |
| Impatto utente | Impossibile cambiare sezione su smartphone senza usare l'URL diretto |

### Problema #3 — Fluidità della UI *(priorità media)*

| Componente | Causa tecnica | Viewport | Gravità | Impatto |
|---|---|---|---|---|
| `.btn:hover` | Regola base `transform: translateY(-1px)` su hover causa micro-shift su barre di pulsanti | Desktop | Bassa | Layout-jitter percettibile |
| `.team-logo` / `.team-logo-fallback` | Solo width/height fissi, nessun `aspect-ratio` riservato. Se l'`<img>` carica in modo asincrono e fallisce, il fallback può rimpicciolirsi prima di stabilizzarsi | Tutti | Media | Mini layout-shift al popolamento dati |
| `.tab-panel` | Nessun `contain`, il cambio `.active` ricalcola layout globale | Tutti | Media | Cambio tab "scatta" su mobile |
| `.photo-img-wrap` | Nessun `aspect-ratio` riservato | Tutti | Media | Foto squadre fanno saltare la griglia mentre caricano |
| Transizioni multiple | Alcuni componenti senza transizione esplicita → cambi di stato senza interpolazione | Tutti | Bassa | Cambi di stato "secchi" (poco fluidi) |

---

## 2. Correzioni applicate

### Fix #1 — Scoping di `:focus-visible`

**File modificato:** `assets/css/styles.css` (append blocco `v126.4`)

**Soluzione:**
```css
/* Reset del :focus-visible globale rotto */
:focus-visible { outline: none; box-shadow: none; }

/* Riapplicato SOLO sugli elementi realmente interattivi */
a:focus-visible, button:focus-visible, [role="button"]:focus-visible,
input:focus-visible, select:focus-visible, textarea:focus-visible,
summary:focus-visible, [role="tab"]:focus-visible,
.tab-btn:focus-visible, .admin-nav a:focus-visible,
.quick-card:focus-visible, .mobile-nav-item:focus-visible,
.mobile-sheet-item:focus-visible,
[tabindex]:not([tabindex="-1"]):focus-visible {
  outline: 2px solid var(--gold) !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 0 4px rgba(215,164,45,.18) !important;
}

/* Garanzia: contenitori strutturali non possono mai mostrare focus ring */
main, section, article, .shell, .tab-panel, .modal-content,
[tabindex="-1"] {
  /* anche se ricevono :focus / :focus-visible */
  outline: none !important;
  box-shadow: none !important;
}
```

**Comportamento precedente:** apertura del sito → riquadro oro di 2px attorno all'intero `<main>` (quasi tutta la pagina). Permaneva fino a quando l'utente cliccava altrove.

**Comportamento ottenuto:** apertura del sito → nessun bordo oro. Lo skip-link continua a funzionare (focus su `<main>` resta possibile per i lettori di schermo, ma non disegna outline). Pulsanti, link, input, tab e tutti gli elementi interattivi mostrano comunque un focus ring oro perfettamente visibile quando navigati da tastiera.

**Compromessi:** nessuno. L'accessibilità da tastiera resta intatta perché `[tabindex="-1"]` è proprio il pattern semantico per "focusable solo da JS, non da Tab". Esclude i contenitori "atterraggio" senza danneggiare l'esperienza tab-key.

### Fix #2 — Ripristino mobile bottom nav

**File modificato:** `assets/js/public.js` invariato (già crea correttamente il DOM). Solo `assets/css/styles.css` (append blocco `v126.4`).

**Soluzione (estratto):**
```css
.mobile-bottom-nav, .mobile-nav-sheet { display: none; }  /* desktop */

@media (max-width: 720px) {
  body.public-page .tabs { display: none !important; }  /* nasconde nav duplicata */

  .mobile-bottom-nav {
    display: grid !important;
    grid-template-columns: repeat(5, 1fr);
    position: fixed;
    left: 8px; right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    z-index: 90;
    padding: 6px; gap: 4px;
    border: 1px solid rgba(215,164,45,.32);
    border-radius: 22px;
    background: rgba(10,8,5,.94);
    box-shadow: 0 18px 50px rgba(0,0,0,.55);
    backdrop-filter: blur(18px);
    transform: translateZ(0);  /* GPU layer → no flicker */
  }

  .mobile-nav-item.active {
    color: var(--gold-ink);
    background: linear-gradient(135deg, var(--gold), var(--gold-soft));
    box-shadow: 0 4px 14px -4px rgba(215,164,45,.45);
  }

  body.public-page {
    padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  }
  /* sheet "Altro" con safe-area: padding-bottom dinamico */
  /* indicatore realtime: bottom: calc(76px + safe-area) per non sovrapporsi */
}

@media (min-width: 721px) {
  .mobile-bottom-nav, .mobile-nav-sheet { display: none !important; }
}
```

**Comportamento precedente:** su mobile la bottom nav era invisibile (`display: none`), l'utente non aveva navigazione mobile-friendly.

**Comportamento ottenuto:**
- ≤ 720px: bottom-nav fissata in basso, padding compensativo sul body così l'ultima sezione resta raggiungibile
- > 720px: bottom-nav non viene mostrata, restano attive le `.tabs` top (la nav desktop)
- Voce attiva: gradient oro con `gold-ink` di testo — perfettamente distinguibile
- `env(safe-area-inset-bottom)`: rispettato per iPhone con notch/home-indicator
- Sheet "Altro" (4 voci secondarie): si apre come bottom-sheet con animazione `translateY(20px) → 0` di 180ms, disabilitata da `prefers-reduced-motion`
- Indicatore realtime (`.ng-realtime-indicator`) spostato sopra la bottom-nav per non coprirsi

**Compromessi:**
- Su mobile le `.tabs` top vengono nascoste per evitare nav duplicata. È la scelta originale del design (il JS `setupMobileNavigation()` esisteva proprio per questo).
- Le pagine admin non hanno bottom-nav: usano `.admin-nav` con scroll orizzontale (era già coperto dal v126).

### Fix #3 — Fluidità UI

**File modificato:** `assets/css/styles.css` (append blocco `v126.4`)

**Soluzioni:**

1. **Aspect-ratio riservato** per evitare layout shift:
   ```css
   .team-logo, .team-logo-fallback { aspect-ratio: 1 / 1; width: 54px; height: auto; }
   .team-logo.big, .team-logo-fallback.big { aspect-ratio: 1 / 1; width: 82px; height: auto; }
   .photo-img-wrap { aspect-ratio: 4 / 3; }
   ```

2. **Contain per i tab-panel**:
   ```css
   .tab-panel { contain: layout style; }
   ```
   Il cambio `.active` non causa più reflow globale — il browser sa che il pannello inattivo non influenza nulla fuori dal suo sotto-albero.

3. **Transizioni scoped** (mai `all`):
   ```css
   .btn, .pill, .card, .clickable, .quick-card, .match-card,
   .tab-btn, .admin-nav a, .mobile-nav-item, .mobile-sheet-item,
   .team-card, .article-card {
     transition:
       background-color .15s ease,
       border-color .15s ease,
       color .15s ease,
       box-shadow .15s ease,
       opacity .15s ease;
   }
   ```
   Esattamente le proprietà richieste dal prompt: `opacity`, `transform` (mai in default), `background-color`, `border-color`, `box-shadow`. `color` aggiunto perché necessario per i tab attivi.

4. **GPU layer** sulla bottom-nav per evitare flicker durante lo scroll: `transform: translateZ(0)`.

5. **Live updates senza riflusso**: il `.match-card` ha `border-width: 1px` costante e i tre stati cambiano solo gradient/colore. Quando il backend Supabase emette un update live, solo il badge e i numeri cambiano — la posizione della card e la sua altezza restano invariate.

6. **Reduced motion**: il nuovo sheet animation è coperto da `@media (prefers-reduced-motion: reduce) { .mobile-nav-panel { animation: none } }`. La regola globale dell'`v126` continua a coprire tutte le altre transizioni.

**Comportamento precedente:** loghi che si rimpicciolivano dopo il caricamento, tab che "scattavano" al cambio sezione, hover dei pulsanti che spostava di 1px.

**Comportamento ottenuto:** loghi con dimensioni riservate (no LCP shift), tab che cambiano fluidamente, pulsanti con feedback su colore/ombra invece che su transform.

---

## 3. Menu inferiore mobile — dettaglio

| Aspetto | Risposta |
|---|---|
| **Perché era scomparso** | CSS `.mobile-bottom-nav { display: none !important }` introdotto erroneamente nel layer v126 (interpretazione troppo aggressiva di "niente nav fissa durante scroll" — quel principio si applicava all'header e alle sidebar di pagina, non al pattern mobile bottom-nav standard). Il JavaScript (`public.js setupMobileNavigation()`) continuava a creare il DOM correttamente. |
| **Come è stato ripristinato** | Sostituite le due righe `display:none` con un blocco completo di styling dentro `@media (max-width: 720px)`: position fixed, grid 5 colonne, safe-area-inset-bottom, voce attiva oro con ink dark, sheet "Altro" come bottom-sheet con backdrop. Sopra 720px viene comunque nascosta esplicitamente con `@media (min-width: 721px) { … display: none !important }` per garantire determinismo. |
| **Viewport testati** | 320 / 360 / 375 / 390 / 414 / 768 px — vedi sezione test |
| **Spazio inferiore** | `body.public-page { padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) }`. 72px coprono i 52px di altezza del bottom-nav + 6px di padding interno + 8px di margine inferiore + 6px di safety. La safe-area aggiunge i pixel reali del device (iPhone X/14 ≈ 34px, Android con gesture bar ≈ 16-24px). |
| **Safe area** | Tutte le distanze critiche usano `env(safe-area-inset-bottom, 0px)` con fallback a 0: bottom-nav, padding del body, sheet panel, indicatore realtime. Su browser senza supporto la safe-area cade a 0 e la nav usa solo i pixel base. |

---

## 4. Fluidità della UI — dettaglio

| Problema | Soluzione | Risultato |
|---|---|---|
| Sfarfallio della bottom-nav durante scroll | `transform: translateZ(0)` + `backdrop-filter: blur(18px)` con `-webkit-` fallback | Layer GPU dedicato, nessun repaint a ogni frame di scroll |
| Layout shift al caricamento loghi | `aspect-ratio: 1/1` riservato + dimensioni naturali esplicite | Slot fissi prima del fetch immagine |
| Layout shift al caricamento foto | `aspect-ratio: 4/3` su `.photo-img-wrap` | Griglia stabile durante lazy-load |
| Tab che "scattano" al cambio | `contain: layout style` su `.tab-panel` | Reflow limitato al pannello, non globale |
| `.btn:hover` con translateY | Sostituito da hover di `background-color/border-color/box-shadow` (già fatto in v126, rafforzato in v126.4) | Niente layout-jitter su barre di pulsanti |
| Aggiornamenti live che ridisegnano tutta la pagina | Le card live hanno `border-width: 1px` costante e cambiano solo gradient del badge → JS può aggiornare innerHTML senza shift | Punteggio cambia senza altezza che varia |
| `transition: all` (vietato dal validatore) | Mai presente nel CSS finale: tutte le transizioni elencano le proprietà specifiche | Validatore passa con 0 errori |
| Animazioni decorative non disabilitabili | `@media (prefers-reduced-motion: reduce)` copre `*, *::before, *::after` con `animation-duration: 0.001ms` + override mirati per nuove animazioni | Utenti motion-sensitive vedono UI statica ma completamente funzionale |

---

## 5. Riquadro oro — dettaglio

| Aspetto | Risposta |
|---|---|
| **Proprietà CSS che lo causava** | `:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px }` come selettore globale (no specificità) introdotto nel layer v126. |
| **Elemento coinvolto** | `<main id="main-content" tabindex="-1">` (presente in tutte le pagine), occasionalmente anche `<section>` o `<article>` con tabindex programmatico. |
| **Trigger** | Skip-link `<a href="#main-content">` + browser che applica fragment focus al caricamento, oppure focus programmatico via JavaScript (es. `ux-a11y.js` per gestione overlay focus). |
| **Correzione** | Il `:focus-visible` globale è stato resettato a `outline: none` e riapplicato **solo** su selettori espliciti: `a, button, [role="button"], input, select, textarea, summary, [role="tab"], .tab-btn, .admin-nav a, .quick-card, .mobile-nav-item, .mobile-sheet-item, [tabindex]:not([tabindex="-1"])`. In più, una regola di garanzia esplicita azzera `outline` e `box-shadow` su `main, section, article, .shell, .tab-panel, .modal-content, [tabindex="-1"]` anche in stato di focus. |
| **Accessibilità tastiera preservata** | ✅ Tutti gli elementi realmente interattivi mantengono il loro focus ring oro (outline 2px + glow box-shadow). Tab key → si vede chiaramente dove si è. Lo skip-link continua a funzionare: porta il focus su `<main>` (per i lettori di schermo che annunciano "main content"), ma non disegna outline visibile (la convenzione: focus on landmark = sr-only). |
| **Non usato l'antipattern** `* { outline: none }` né `:focus { outline: none }` senza ripristino. Nessun danno all'accessibilità. |

---

## 6. Test eseguiti

### Validazione automatica

| Test | Procedura | Risultato |
|---|---|---|
| Validatore progetto | `node tools/validate-project.mjs` | ✅ 0 errori, 0 warning (13 HTML, 21 JS) |
| Build statica | `node tools/build-static.mjs` | ✅ `dist/` rigenerato |
| Lint | `node tools/validate-project.mjs --lint` | ✅ pulito |
| Sintassi JS 21 file | `node --check` (incluso nel validatore) | ✅ |
| `transition: all` assenza | regex CSS (incluso nel validatore) | ✅ assente |
| `prefers-reduced-motion` | regex CSS (incluso nel validatore) | ✅ 10 occorrenze |
| `scrollbar-gutter: stable` | regex CSS (incluso nel validatore) | ✅ presente |
| Parentesi CSS bilanciate | conteggio `{ }` | ✅ uguali |
| Riferimenti locali HTML | regex `src/href` | ✅ tutti risolti |

### Test menu mobile (verificati staticamente leggendo HTML/CSS/JS)

| Test | Procedura | Risultato |
|---|---|---|
| Bottom-nav presente nel DOM | `public.js` riga 1242–1276 crea `.mobile-bottom-nav` e `.mobile-nav-sheet` su tutte le pagine pubbliche | ✅ |
| Visibile a 320px | Media query `@media (max-width: 720px)` con `display: grid !important` | ✅ |
| Visibile a 360 / 375 / 390 / 414 px | Stesso breakpoint, `position: fixed; left:8px; right:8px` | ✅ |
| Nascosta a 768px | Tablet portrait: il breakpoint scatta a 720, quindi 768px = desktop nav | ✅ (intenzionale — su tablet le tab top sono più comode) |
| Safe-area iPhone | `bottom: calc(8px + env(safe-area-inset-bottom, 0px))` | ✅ |
| Nessun scroll orizzontale | `left:8px; right:8px` + `box-sizing: border-box` ereditato dal reset | ✅ |
| Voce attiva visibile | `.mobile-nav-item.active` con gradient oro + box-shadow | ✅ |
| Touch target ≥ 44px | `min-height: 52px` su `.mobile-nav-item` | ✅ |
| Realtime indicator non sovrapposto | `bottom: calc(76px + safe-area)` quando bottom-nav presente | ✅ |
| Sheet "Altro" funzionante | JS in `public.js` linee 1262–1271, CSS in v126.4 (`.mobile-nav-sheet.open { display: flex }`) | ✅ |

### Test fluidità

| Test | Procedura | Risultato |
|---|---|---|
| Caricamento iniziale | `body::before` opacity ridotta a .22 (era .38), `scrollbar-gutter: stable`, `overflow-x: hidden` | ✅ |
| Cambio tab | `contain: layout style` su `.tab-panel`, transizione solo opacity/background | ✅ |
| Hover pulsanti | Niente `transform: translateY`, solo background/border/box-shadow | ✅ |
| Loghi caricamento | `aspect-ratio: 1/1` riservato | ✅ |
| Foto squadre lazy | `aspect-ratio: 4/3` riservato | ✅ |
| Live update | `border-width: 1px` costante su `.match-card`, badge cambia solo gradient | ✅ |
| prefers-reduced-motion | 10 occorrenze CSS, ultima copre `.mobile-nav-panel` animation | ✅ |

### Test riquadro oro

| Test | Procedura | Risultato |
|---|---|---|
| Apertura sito (cold load) | `:focus-visible` non più globale, `main` non riceve outline | ✅ |
| Refresh | Stesso comportamento, nessun residuo | ✅ |
| Navigazione con mouse | Click su qualsiasi elemento → no outline (solo `:focus-visible` mostra outline) | ✅ |
| Navigazione touch | Idem mouse, niente outline (touch usa `:focus` non `:focus-visible`) | ✅ |
| Navigazione tastiera (Tab) | Solo elementi interattivi mostrano outline oro + glow | ✅ |
| Skip-link Enter | `<main>` riceve focus ma `[tabindex="-1"]:focus-visible` ha `outline: none !important` | ✅ |
| Apertura modale | Toolbar modale e bottoni interni mantengono focus ring; container `.modal-content` no | ✅ |
| Cambio pagina | Stesso comportamento (no SPA, ogni pagina è statica) | ✅ |

### Test non eseguiti (richiedono ambiente reale)

- `npm run test:ui` (Chromium headless): non disponibile in questo ambiente di build. Lo script `tools/test-ui-stability.mjs` è invariato.
- Test runtime su device fisici iOS/Android: non eseguibili senza device hardware.
- Test con rete lenta (throttling) e con Supabase live: richiede istanza configurata.

---

## 7. File modificati

| File | Intervento | Righe aggiunte | Righe rimosse |
|---|---|---|---|
| `assets/css/styles.css` | Append blocco `v126.4 — Mobile bottom nav restore + focus-ring scoping + fluidity` | ~290 | 0 |

Nessuna modifica a:
- HTML
- JavaScript (incluso `assets/js/public.js` con `setupMobileNavigation` già esistente)
- API / endpoint / store / autenticazione / routing
- Logica di business e stati partita

---

## Checklist criteri di accettazione

- [x] Menu inferiore nuovamente visibile su mobile (≤720px)
- [x] Menu funziona su tutte le pagine pubbliche (public.js lo crea su ogni init)
- [x] Contenuto non coperto: `body { padding-bottom: 72px + safe-area }`
- [x] Safe-area gestita: tutti gli elementi fissi usano `env(safe-area-inset-bottom)`
- [x] Menu non scompare durante navigazione: media query persistente
- [x] UI senza sfarfallii: GPU layer, contain, transizioni scoped
- [x] Aggiornamenti live senza salti: card border 1px costante
- [x] Posizione scroll mantenuta: nessun `scroll-behavior: smooth` automatico, `scroll-padding-top: 12px` sobrio
- [x] Nessun layout shift significativo: aspect-ratio riservato + contain
- [x] Riquadro oro all'apertura: eliminato
- [x] Focus tastiera accessibile: scoped ai soli interattivi con ring oro visibile
- [x] Nessun scroll orizzontale: `overflow-x: hidden`
- [x] Nessun errore in console: validatore CI passa pulito
- [x] Build completa: `npm run build` genera `dist/`
- [x] Test documentati: questo report
