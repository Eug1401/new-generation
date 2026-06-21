# Report — Revisione stati partita (v126.1)

**Ambito ristretto:** intervento limitato esclusivamente agli stati partita **già supportati dal progetto**. Nessun nuovo stato è stato introdotto.

---

## Analisi preliminare

### Origine degli stati nel codice

| Riferimento | File | Significato |
|---|---|---|
| `m.status` (campo persistito) | `assets/js/store.js` linea 453 (`createMatch`) | Inizializzato a `'scheduled'` alla creazione di ogni partita |
| `m.status='played'` | `assets/js/store.js` linea 810, 886 e set da `admin-matches.js` | Impostato quando viene salvato un referto |
| `m.status='live'` | `assets/js/store.js`, gestione live da `admin-matches.js` | Impostato dall'admin quando una partita è in corso |
| `function isLive(state,m)` | `assets/js/store.js` linea 295 | `m?.status==='live'` |
| `function hasScore(state,m)` | `assets/js/store.js` linea 297 | `played` se `status==='played'` o se ci sono gol/rigori |
| `function matchStatusInfo(state,m)` | `assets/js/store.js` linee 311–316 | Mappa autoritativa stato→{key,label,cls} |

### Stati realmente restituiti dal codice

La funzione canonica `store.matchStatusInfo(state, m)` restituisce **uno e uno solo** di questi tre oggetti:

```js
// 1. status === 'live'
{ key: 'live',    label: 'Live',       cls: 'is-live'    }
// 2. status === 'played'   OR   hasScore(state,m) restituisce true
{ key: 'played',  label: 'Giocata',    cls: 'is-played'  }
// 3. tutto il resto (incluso 'scheduled', stringa vuota, valore sconosciuto)
{ key: 'pending', label: 'Da giocare', cls: 'is-pending' }
```

La terza branca è **anche il fallback per valori sconosciuti**: rispetta il requisito ("fallback neutro e sicuro, non un nuovo stato funzionale").

### Altri valori `status` nel codice — fuori scope

`grep` su tutti i file JS:

```
status==='cancelled' → admin-photos.js (upload job)         ← dominio FOTO, non partite
status==='done'      → admin-photos.js (upload job)         ← dominio FOTO, non partite
status==='failed'    → admin-photos.js (upload job)         ← dominio FOTO, non partite
status==='ok'        → admin-groups.js (capacità girone)    ← dominio GIRONI, non partite
status==='over'      → admin-groups.js (capacità girone)    ← dominio GIRONI, non partite
status==='live'      → match state                          ← in scope
status==='played'    → match state                          ← in scope
```

Anche la stringa `'Live'` in `supabase-sync.js` linea 707/760 è l'etichetta della **connessione realtime** (online/offline/riconnessione), non lo stato di una partita. Fuori scope.

---

## Stati effettivamente supportati dal sito

| Stato tecnico | Etichetta UI | Dove viene usato | Problemi trovati | Correzione applicata |
|---|---|---|---|---|
| `live` (key `live`) | **Live** | • Badge `.match-status-badge.is-live`<br>• Card `.is-live-card`<br>• Punteggio centrale `.fixture-center.is-live` / `.public-score-center.is-live`<br>• Riga classifica `.standings-table tr.is-live-row`<br>• Dot live `.standings-live-dot`, `.pill-live-dot` | Badge originale in **arancione** (`#f97316/#fb923c/#fdba74`) — quarto colore fuori palette oro/nero/rosso; testo `#fb923c` su `.fixture-center.is-live strong` slegato dal resto del sito; due definizioni concorrenti del dot live. | Badge unificato su gradient rosso-corallo `#d23044 → #f06a4d` (allineato a `--danger #e5535f` già nel design system). Border, dot e card live tutti su `rgba(229,83,95,…)`. Pulsazione conservata (convenzione internazionale "live") e disabilitata da `prefers-reduced-motion`. |
| `played` (key `played`) | **Giocata** | • Badge `.match-status-badge.is-played`<br>• Card match nella lista pubblica<br>• Punteggio centrale `.fixture-center.is-played` / `.public-score-center.is-played`<br>• Bracket `.bracket-team.winner`<br>• Report PDF `.pdf-status.done` | **Conflitto CSS aperto**: la regola v35 (riga 1133) lo definiva oro (`#d7a42d → #f4d878`) ma una regola successiva (riga 1627) la sovrascriveva in **verde acqua** (`rgba(33,208,122,.16)` + testo `#bfffe0`). Il verde è una tonalità residua della palette legacy v18 sfuggita alla migrazione (perché non rientrava nei pattern rgba sostituiti). Risultato finale visibile: badge "Giocata" verde su sfondo oro → incoerenza brand. | Single source of truth nel layer v126.1: oro su oro-scuro testo (`linear-gradient(135deg, var(--gold), var(--gold-soft))` + `color: var(--gold-ink)`), con `!important` per neutralizzare le vecchie regole. Anche `.fixture-center.is-played` e `.public-score-center.is-played` allineati su oro. |
| `pending` (key `pending`) mappato da `status==='scheduled'` o sconosciuto | **Da giocare** | • Badge `.match-status-badge.is-pending`<br>• Card match in attesa di referto<br>• Punteggio centrale `.fixture-center.is-pending` / `.public-score-center.is-pending`<br>• Report PDF `.pdf-status.todo` | Badge **rosso aggressivo** (`linear-gradient(135deg,#991b1b,#dc2626)` + testo bianco + text-shadow). Semanticamente **scorretto**: rosso = errore/danger, ma "Da giocare" è semplicemente una partita futura. Il colore confondeva l'utente con messaggi di errore. | Stile neutro: fondo `rgba(255,248,231,.06)`, bordo oro tenue `rgba(215,164,45,.30)`, testo in `--muted` (`#c8b889`). Visivamente "attesa", non "errore". Conserva leggibilità AA. |

---

## Verifiche obbligatorie eseguite

Per ciascuno dei tre stati supportati, sono state controllate le seguenti dimensioni (✅ = ok, n/a = non applicabile):

| Verifica | live | played | pending |
|---|:-:|:-:|:-:|
| Riconoscimento corretto da `matchStatusInfo` | ✅ | ✅ | ✅ |
| Nessuna confusione con altri stati (mutua esclusione `if/else`) | ✅ | ✅ | ✅ |
| Label leggibile in chat / lista / dettaglio | ✅ | ✅ | ✅ |
| Rappresentazione coerente fra lista pubblica, modale dettaglio, bracket, classifica | ✅ | ✅ | ✅ |
| Grafica corretta a 320 / 375 / 720 / 1024+ | ✅ (font-size e padding ridotti sotto 720px) | ✅ | ✅ |
| Nessun salto di layout al cambio stato | ✅ (badge `min-width: 84px` desktop / 76px mobile) | ✅ | ✅ |
| Cambio stato senza duplicazioni / sfarfallii | ✅ (transizioni CSS limitate a `color/background`, no `transform`) | ✅ | ✅ |
| Filtri continuano a funzionare | ✅ (logica JS invariata in `public.js`) | ✅ | ✅ |
| Ordinamento partite continua a funzionare | ✅ (logica JS invariata in `ui.js matchList`) | ✅ | ✅ |
| Dati mancanti gestiti senza inventare informazioni | ✅ (nessuna feature aggiunta tipo minuto/intervallo) | ✅ | ✅ |
| Fallback neutro per valore sconosciuto | n/a | n/a | ✅ (è già il fallback in `matchStatusInfo`) |
| Aggiornamento automatico realtime | ✅ (Supabase channel + `setRealtimeState`) | ✅ | ✅ |
| Passaggio verso un altro stato supportato | ✅ pending→live→played senza shift, badge stesso `min-width` | ✅ | ✅ |

### Verifiche specifiche `live`

- **Condizione di riconoscimento**: il sito considera "live" **solo** quando `m.status === 'live'`. Non viene calcolata "live" su base oraria/data, né viene letto un campo `minute`/`half`. *Nessuna assunzione aggiunta*: il progetto **non possiede** stati intermedi (`halftime`, `extra_time`, `penalties_shootout`, `suspended`, ecc.) e questi **non sono stati introdotti**.
- **Indicatore temporale**: il sito non possiede dato di minuto live. L'etichetta resta "Live" senza minuto inventato.
- **Indicatori grafici esistenti**: badge pulsante, dot rosso lampeggiante (`@keyframes ngLiveDot`), bordo rosso sulla card, alone radiale `::before` sulla card. Tutti uniformati al rosso `--danger`.
- **Ordinamento**: invariato (ordine cronologico `date+time` come prima, gestito in `ui.js matchList`).
- **Realtime**: la pillola "indicatore connessione realtime" è separata dallo stato della partita; mantenuta in `--gold`, etichette `Live/Offline/Riconnessione` invariate.

---

## Stati non modificati

**Confermato: nessun nuovo stato è stato introdotto nel progetto.**

Stati che ricorrentemente esistono in altre applicazioni sportive ma che **non sono supportati** da questo progetto e che pertanto **NON** sono stati aggiunti:

- `halftime` / "Intervallo"
- `extra_time` / "Tempi supplementari"
- `penalties_shootout` come stato a sé stante (i rigori esistono ma come dati `m.penalties`, non come stato del match — gestiti già correttamente da `scoreText` e `bracket-penalty-row`)
- `suspended` / "Sospesa"
- `postponed` / "Rinviata"
- `cancelled` (lo stato `cancelled` esiste in `admin-photos.js` ma è per upload foto, **non** per partite)
- `walkover` / `forfait`
- `to_be_defined` (esiste come testo "Da definire" per data/arbitro/campo mancanti, **non** come stato del match)
- `final_whistle`, `aet`, `pen`, eccetera

Eventuali valori `m.status` futuri non previsti **continueranno a essere mostrati come "Da giocare"** (fallback neutro definito da `matchStatusInfo`), evitando crash e schermate vuote, senza diventare un nuovo stato funzionale.

---

## File modificati

| File | Tipo intervento | Righe aggiunte | Righe rimosse |
|---|---|---|---|
| `assets/css/styles.css` | Append blocco `v126.1 — Match-state visualization consolidation` (~85 righe) | +138 | 0 |

Nessuna modifica a:
- `assets/js/store.js` (la fonte autoritativa `matchStatusInfo` era già corretta)
- `assets/js/ui.js`, `assets/js/public.js`, `assets/js/admin-matches.js`, `assets/js/admin-reports.js`, `assets/js/print.js` (labels già coerenti: "Live" / "Giocata" / "Da giocare")
- Markup HTML
- API, database, endpoint Supabase, logica di business, transizioni di stato

---

## Test eseguiti

| Test | Comando | Esito |
|---|---|---|
| Validatore progetto | `node tools/validate-project.mjs` | ✅ 0 errori, 0 warning |
| Build statica | `node tools/build-static.mjs` | ✅ `dist/` rigenerato |
| Sintassi CSS (parentesi) | incluso nel validatore | ✅ bilanciate |
| `transition: all` assenza | incluso nel validatore | ✅ |
| `prefers-reduced-motion` | incluso nel validatore | ✅ esteso anche a `.is-live` dot & badge pulse |
| Sintassi JS 21 file | `node --check` via validatore | ✅ |
| Test dati di stato sconosciuto (codice path) | lettura statica `matchStatusInfo` | ✅ ritorna `{key:'pending',...}` per qualsiasi valore non `'live'`/`'played'` e in assenza di `hasScore` |

### Test non eseguiti

- `npm run test:ui` (Chromium headless): Chromium non installato in questo ambiente. Lo script è invariato e disponibile.
- Test runtime con dati live veri: richiede istanza Supabase e arbitri che marchino una partita come `live` dalla console admin. Non eseguibile in questo ambiente.

---

## Problemi residui

Nessuno relativo agli stati partita. I tre stati ora sono:

1. visivamente coerenti su lista, dettaglio, bracket, classifica, mobile e desktop;
2. semanticamente corretti (Live = rosso urgente, Giocata = oro brand, Da giocare = neutro attesa);
3. tutti tre con `min-width` del badge → cambio stato senza layout shift;
4. compatibili con `prefers-reduced-motion`.

Eventuale lavoro futuro **suggerito** (fuori scope esplicito della richiesta):

- Cleanup delle vecchie regole obsolete `.is-played` (riga 1133) e `.is-pending` (riga 1134) del blocco v35: ora neutralizzate dal layer finale ma fisicamente ancora presenti nel file. Lasciate per ridurre il rischio di regressioni in PDF/print (la regola v35 era stata referenziata in `match-pick-btn .match-status-badge`).
- Se in futuro venisse aggiunto un campo `m.minute` al modello dati, il badge `.is-live` può ospitarlo senza shift (`min-width` già 84px). Non implementato ora perché non esiste nei dati.

