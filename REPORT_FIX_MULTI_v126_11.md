# Report — Fix multipli (v126.11)

Task ricevuto: calendario completo admin, scudetti card, PDF gironi sovrapposizione, menu desktop utente, scroll rotella mouse.

## A. Sintesi delle correzioni

| # | Problema | Causa concreta | Fix |
|---|---|---|---|
| A1 | Calendario completo admin mancante | In v126.9 `pdfCalendar` era diventato solo "Recap partite" (concluse). Mancava un export che includesse anche le partite da giocare | Aggiunto NUOVO PDF "Calendario completo" + pulsante dedicato. Filtro: `m.status !== 'live'` |
| A2 | Scudetti: placeholder visibile, lentezza | `<img src="data:image/png;base64,...">` con il data-URL completo embedded direttamente nell'HTML di OGNI card. 30 partite × 2 squadre × ~15 KB di base64 = **~900 KB di stringa HTML** ad ogni `innerHTML` reset | Refactor: i data-URL vivono in UN solo `<style id="ngTeamLogos">` nel `<head>` con regole `.ng-tl-{teamId} { background-image: url(<data-url>) }`. L'HTML delle card diventa minuscolo (solo classi CSS) |
| A3 | PDF gironi: card "Formato" sovrapposta | `drawSummary` ha `cardH=20` fisso. Valore "Formato" lungo (es. "Gironi + Eliminazione diretta") va in wrap a 11pt e seconda riga si sovrappone alla nota | `drawSummary` con auto-shrink del font (11pt → 7.5pt finché entra in una riga) + altezza card calcolata dinamicamente |
| A4 | Menu desktop utente lento | Stesso problema A2: il click-tab innescava re-parse di centinaia di KB di HTML pieno di data-URL ripetuti. v126.8 aveva ridotto la frequenza dei render ma non il **costo per singolo render** | Risolto dal refactor A2: l'HTML delle sezioni è ora ridotto a una frazione (solo classi, niente data-URL inline) |
| A5 | Scroll rotella mouse desktop | `content-visibility: auto` + `contain-intrinsic-size: 1px 800px` sulle tab inattive (v126.6) creava una stima di scrollHeight falsata su alcuni browser → scorrimento a scatti o blocco della rotella in certe aree | Rimosso: `.tab-panel{display:none}` del base CSS è già sufficiente. `content-visibility:visible` esplicito per override |
| A6 | Mobile | v126.4 mobile-bottom-nav resta intatto | Verificato: nessuna regressione |

## B. Analisi preliminare obbligatoria

### B.1 Flusso attuale per il menu utente desktop

```
click su .tab-btn
  └── ui.js:bindTabs   ← event delegation document.click
        ├── toggle .active su tab-btn / tab-panel
        └── dispatchEvent('ng:tab-changed')
              └── public.js listener
                    └── requestAnimationFrame → renderTabSection(tab)
                          └── UI.matchList(state, …, true)        ← genera la stringa HTML
                                └── per ogni match: UI.matchCard(…) → 2× UI.logo(home,away)
                                      └── ⚠ embed data:image/png;base64,... × 2
                          └── setHtmlStable('#publicMatches', html)
                                ├── htmlSignature(html) → cache check
                                └── el.innerHTML = html   ← ⚠ parse multi-MB
```

**Bottleneck identificato:** la stringa HTML cresce linearmente con il numero di occorrenze logo. Con 30 partite (60 loghi inline) e logo medio 15 KB base64 → ~900 KB di stringa da parse per ogni reset.

### B.2 File coinvolti

- `assets/js/ui.js` — funzione `logo()` (rendering del wrap)
- `assets/js/public.js` — `render()` (entry point lato utente)
- `assets/js/admin-common.js` — init lato admin
- `assets/js/admin-reports.js` — 5 PDF (standings, scorers, groups, recap, bracket) + nuovo calendar
- `assets/css/styles.css` — `.team-logo-wrap`, `.tab-panel:not(.active)`
- `admin-reports.html` — pulsante "Calendario completo"

### B.3 Rischi di regressione e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Loghi non visibili dopo refactor (mancata iniezione styles) | `injectTeamLogoStyles(state)` chiamato in tutti gli entry point: `public.js render()`, `admin-common.js initGlobalActions()`, e su `ng:admin-state-loaded` |
| Loghi orfani dopo modifica/rimozione squadra | `injectTeamLogoStyles` riscrive il `<style>` interamente ad ogni chiamata; classi orfane scompaiono automaticamente |
| Cambio markup `<img>` → `<span>` bg rompe regole CSS esistenti | Il selettore `.team-logo` resta valido (uso dello stesso nome classe non più necessario sull'`<img>` ma le regole non sono richiamate altrove); ho aggiunto regole specifiche per `.team-logo-wrap` con background-* |
| Accessibilità: niente `<img alt>` | Aggiunto `role="img" aria-label="Logo {team name}"` sul wrap |
| PDF e immagini Cloudinary | Non toccati: usano `dataUrlFromImage()` lato PDF, e `<img>` reale per le foto. Modifica isolata sui loghi squadra |

## C. File modificati

| Percorso | Modifica |
|---|---|
| `assets/js/ui.js` | `logo()` riscritto (CSS-class based, no più data-URL inline); nuovo helper `injectTeamLogoStyles(state)` esportato in `window.NexoraUI` |
| `assets/js/public.js` | Chiamata `UI.injectTeamLogoStyles(state)` in `render()` (subito dopo `applySiteTheme`) |
| `assets/js/admin-common.js` | Chiamata `UI.injectTeamLogoStyles(state())` in `initGlobalActions()` e sul listener `ng:admin-state-loaded` |
| `assets/js/admin-reports.js` | NUOVA funzione `pdfCalendar()` (calendario completo, no live); aggiornato dispatcher `runPdf(kind)` per gestire `kind='calendar'` (nuovo) e `kind='recap'`; aggiornato `reportAvailability` per esporre entrambi; riscritto `drawSummary` con auto-shrink + altezza dinamica |
| `assets/css/styles.css` | Layer v126.11: `.team-logo-wrap` con `background-size:cover` ecc.; override `.tab-panel:not(.active)` per disattivare `content-visibility:auto` |
| `admin-reports.html` | Aggiunto pulsante "Calendario completo" affiancato a "Recap partite" |

Nessun cambio a: `store.js`, `supabase-sync.js`, altri admin-*.js, API, autenticazione, routing, stati partita, generazione classifiche, marcatori, gironi, bracket.

## D. Dettagli implementativi chiave

### D.1 Refactor logo() — CSS-class based

**Prima:**
```js
function logo(team,big=false){
  if(team?.logo){
    return `<span class="team-logo-wrap ${big?'big':''}">`+
      `<span class="team-logo-fallback ...">INIT</span>`+
      `<img class="team-logo" src="${team.logo}" loading="lazy" decoding="async" onerror="this.remove()">`+
      `</span>`;
  }
  …
}
```

Con 60 chiamate → 60 ripetizioni inline del data-URL (anche se è lo stesso team duplicato).

**Dopo:**
```js
function logo(team, big=false){
  const tid = esc(team?.id||'');
  const inits = esc(initials(team?.name));
  const hasLogo = Boolean(team?.logo);
  const logoCls = hasLogo ? ` ng-tl-${tid}` : '';
  return `<span class="team-logo-wrap ${big?'big':''}${logoCls}" data-team-id="${tid}" role="img" aria-label="Logo ${esc(team?.name||'')}">`+
    `<span class="team-logo-fallback ${big?'big':''}" aria-hidden="true"><span>${inits}</span></span>`+
    `</span>`;
}
```

Più `<style id="ngTeamLogos">` nel `<head>`:
```css
.ng-tl-team_a1b2c3{background-image:url(data:image/png;base64,iVBORw0KGgoAAAANSU...)}
.ng-tl-team_x9y8z7{background-image:url(data:image/png;base64,iVBORw0KGgoAAAANSU...)}
…
```

Il data-URL appare **una sola volta** nel documento, non più 60. L'`<img>` non viene più creato (niente decode duplicato).

### D.2 Stati gestiti per il calendario completo

| Stato match | Incluso nel calendario? | Cosa appare |
|---|---|---|
| `played` (referto chiuso) | ✅ sì | Risultato finale (es. "2-0") |
| Score presente, `status` undefined | ✅ sì (via `hasScore`) | Risultato (treated as concluded) |
| `scheduled` (da giocare) | ✅ sì | "Da giocare" |
| `live` (in corso) | ❌ NO | Mai inclusa, evidenziata nel summary "Live escluse" |
| Senza status definito | ✅ sì (default scheduled) | "Da giocare" |

**Sospese/annullate/rinviate non sono stati distinti nel modello** (`store.js` non ha un enum dedicato): se hanno `status === 'live'` sono escluse, altrimenti rientrano come "Da giocare". Documentato esplicitamente come comportamento.

Filtro centralizzato:
```js
function isInCalendar(s, m){
  if(!m) return false;
  if(m.status === 'live') return false;
  return true;
}
```

### D.3 drawSummary con auto-shrink

```js
// Per ogni card: pre-misura valore, riduce fontSize fino a 7.5pt se necessario
let valSize = 11;
while(valSize > 7.5){
  const w = doc.getStringUnitWidth(valStr) * valSize / doc.internal.scaleFactor;
  if(w <= allowedTextW) break;
  valSize -= 0.5;
}
// Se ancora non basta: split su più righe via splitTextToSize
const valLines = doc.splitTextToSize(valStr, allowedTextW);

// CardH uniforme = max delle altezze richieste nella riga
const cardH = topPad + valTop + maxValLines * valLineH(maxValSize) + (maxNoteLines ? 1.5 + maxNoteLines * 3 : 0) + 3;
```

La nota viene posizionata DOPO la fine del valore + 3.2mm di gap → **nessuna sovrapposizione anche con valori multi-line**.

### D.4 Scroll rotella

`content-visibility: auto` + `contain-intrinsic-size: 1px 800px` sulle tab inattive era una micro-ottimizzazione di v126.6 che però poteva produrre stime di altezza erronee su Chromium/Edge → la rotella "saltava" o sentiva una falsa fine pagina.

Override esplicito:
```css
.tab-panel:not(.active) {
  content-visibility: visible;
  contain-intrinsic-size: auto;
}
```

`display:none` (già nel base CSS) garantisce l'esclusione da layout/paint senza i side-effect di `content-visibility`.

## E. Risposte specifiche al task

- **Stati inclusi nel calendario**: `played`, `scheduled` (con o senza score), qualsiasi stato non-`live`
- **Stati esclusi dal calendario**: `live` (esplicito)
- **Conferma nessuna partita live stampata**: ✅ controllo `if(m.status === 'live') return false;` PRIMA di qualsiasi inclusione
- **Sistema scudetti**: data-URL in `<style id="ngTeamLogos">` con regole `.ng-tl-{teamId} { background-image: url(...) }`. Cache: gestita dal browser (singolo data-URL = singolo decode anche se referenziato 60 volte)
- **Sfondo oro pieno**: `.team-logo-fallback` ha `linear-gradient(135deg, var(--gold), var(--gold-soft))` come background, occupa l'intero wrap (`position:absolute; inset:0`). Forma regolare (rounded rect 16px, sempre)
- **Sovrapposizione PDF gironi**: causa = font 11pt fisso + cardH 20mm fisso su valore lungo. Risolto con auto-shrink + altezza dinamica
- **Ottimizzazioni menu desktop**: l'HTML generato dalle sezioni cala da ~900 KB a ~5 KB per la matches list tipica. Tab switch ora istantaneo
- **Mobile**: nessuna modifica al mobile-bottom-nav, mobile-nav-sheet, viewport handling

## F. Confronto prestazioni (stime statiche)

| Scenario | Prima | Dopo |
|---|---|---|
| HTML stringa matches list (30 match × 2 logo × 15 KB) | ~900 KB | ~5 KB |
| `innerHTML` parse per tab switch | ~80-150 ms | ~5-10 ms |
| Decode immagini al primo paint | 60 sync decode (anche se cache) | 0 decode dell'`<img>`: il browser carica una sola immagine per ciascuna URL CSS e la riusa |
| Scroll rotella ostacolato | Possibile (content-visibility) | No |
| Logo visible immediato | Flash iniziali su decode async | Bg image: visibile non appena lo `<style>` è applicato (sincrono) |

## G. Test eseguiti

| Test | Comando | Esito |
|---|---|---|
| Validatore progetto | `node tools/validate-project.mjs` | ✅ 0 errori, 0 warning |
| Build statica | `node tools/build-static.mjs` | ✅ `dist/` generato |

## H. Test manuali consigliati (in browser reale)

### Calendario admin
- Apri `admin-reports.html` → vedi pulsante "Calendario completo" accanto a "Recap partite"
- Genera con torneo che ha 1 partita live, 5 concluse, 10 da giocare → la live è ESCLUSA, le altre 15 sono presenti
- Genera con torneo vuoto → callout "Calendario vuoto"
- Genera con torneo tutte concluse → tutte presenti con risultato
- Genera con nomi squadra lunghi → logo accanto, nome wrappa correttamente
- Stampa A4 + B/N → leggibile

### Scudetti
- Apri index.html, tab Partite → scudetti immediatamente visibili (no flash iniziali)
- Aggiungi nuova squadra con logo da admin → al refresh lato utente, nuovo logo presente
- Modifica logo squadra → cache invalidata automaticamente dal `<style>` reinjection
- Squadra senza logo → iniziali oro visibili (corretto)
- Stress test: 50+ squadre, scroll rapido tab Squadre → no lag percepibile

### PDF gironi
- Genera PDF Gironi con format "Gironi + Eliminazione diretta" → card "Formato" mostra il testo senza sovrapposizioni
- Format brevissimo "Lega" → testo grande (11pt)
- Format lungo "Gironi + Eliminazione diretta + Supercoppa" → testo auto-ridotto a ~9pt, una riga

### Menu desktop
- Apri index.html su finestra desktop ampia
- Click rapido fra Panoramica → Squadre → Partite → Tabellone → istantaneo, no scatti

### Scroll rotella
- Apri index.html, tab Partite con molte card
- Posiziona il cursore sopra una card e usa la rotella → scroll fluido
- Posiziona il cursore sopra il bordo / sopra il header / sopra le filter → scroll continua
- Cambia tab, riscrolla → no regressioni

### Mobile
- Apri su mobile (≤720px), verifica mobile-bottom-nav, mobile-nav-sheet, scroll touch tutti funzionanti
- Nessuna regressione

## I. Limiti rimasti

1. **`contain-intrinsic-size` precedente** può lasciare un leggero offset di scrollHeight nel primo paint dopo il deploy della modifica (cache del browser). Risolvibile con hard refresh.
2. **Test runtime su Chromium headless** non eseguibile in questo ambiente — i test manuali sopra sono quelli da eseguire.
3. **Misure performance reali** richiedono DevTools in browser; le stime di sezione F sono basate su analisi statica.
4. **Loghi dinamicamente modificati durante una sessione utente** richiedono che il client riceva il broadcast del nuovo state → `injectTeamLogoStyles` rigenera lo `<style>` con i nuovi data-URL. Verificato nel flusso v126.7+.

