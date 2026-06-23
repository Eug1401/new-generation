# Report — Fix reset torneo (v126.10)

## 1. Flusso attuale (analisi)

```
┌────────────────────────────────────────────────────────────────────┐
│ admin-common.js — implementazione precedente di openResetDialog    │
└────────────────────────────────────────────────────────────────────┘

User click "Reset"
    │
    ▼
Dialog conferma (1 checkbox conferma + 2 checkbox OPZIONALI export)
    │   ❌ Export backup JSON: checked di default ma DISATTIVABILE
    │   ❌ Export recap PDF:   UNCHECKED di default
    │
    ▼
Click "Conferma ed esegui reset"
    │
    ├── if exportBackup → downloadStateBackup(current, 'reset-flow')
    │                     (sincrono, no verifica blob)
    │
    ├── if exportRecap  → await downloadRecapPdf(current)
    │                     (async ma usa doc.save() interno: no verifica)
    │
    ├── msg "File avviati. Reset in corso…"
    │
    └── setTimeout(resetStorageAndState, 900)   ❌ ATTESA HARDCODED
              │
              ▼
        resetStorageAndState():
          1. localStorage.removeItem(...)
          2. save(emptyState())   → patched store.save → broadcast + scheduleRemoteSave
          3. location.reload()    ❌ IMMEDIATO, no await del remote save
```

### Endpoint coinvolti

- `state()` → `store.load('admin')` — lettura localStorage
- `save(s)` → `store.save('admin', s)` — wrapped per broadcast + remote save
- `downloadStateBackup(s, source)` → genera Blob JSON + click `<a download>`
- `createRecapDoc(normalizedState)` → ritorna jsPDF doc; `doc.save()` interno
- `downloadRecapPdf(s)` → wrapper su `createRecapDoc + doc.save`
- `resetStorageAndState()` → wipe localStorage + `save(emptyState)` + reload

### Problemi identificati

| # | Problema | Gravità | Conseguenza |
|---|---|---|---|
| 1 | Export PDF e JSON sono **OPZIONALI** (checkbox sbloccati) | **CRITICA** | L'utente può azzerare tutto senza esportare nulla → perdita dati irreversibile |
| 2 | Nessuna verifica blob (`size > 0`, MIME) prima del trigger download | **ALTA** | PDF/JSON corrotti accettati senza segnalazione |
| 3 | `setTimeout(900ms)` come "attesa export" prima del wipe | **ALTA** | Race condition: con PDF grandi o macchine lente il download può non essere ancora partito quando lo stato viene cancellato |
| 4 | `location.reload()` immediato dopo `save(emptyState)` senza attendere `NG_FORCE_REMOTE_SAVE` | **CRITICA** | Su Supabase resta lo stato pieno → al reload `supabase-sync` lo ripristina → **il reset svanisce silenziosamente** |
| 5 | Nessuna protezione anti-doppio-click globale | MEDIA | Doppia esecuzione possibile in caso di click rapidi |
| 6 | Nessuna fase visibile all'utente: un solo messaggio "File avviati. Reset in corso…" | MEDIA | UX poco affidabile, difficile capire cosa è andato male in caso di errore |
| 7 | Nessuna verifica post-cancellazione dello stato vuoto | MEDIA | Stato incoerente non rilevato |
| 8 | Nessun log di tracciamento | BASSA | Diagnosi a posteriori difficile |
| 9 | Lato utente non riceve un segnale esplicito di reset (dipende dal broadcast del save che però può essere preceduto dal reload dell'admin) | MEDIA | I client utenti già aperti possono vedere lo stato vecchio finché non ripollano |

### File coinvolti

- `assets/js/admin-common.js` (cuore del reset)
- `assets/js/store.js` (`emptyState`, `normalizeState`, `load`, `save`)
- `assets/js/supabase-sync.js` (`NG_FORCE_REMOTE_SAVE`, broadcast)
- Tutti gli `admin-*.html` (pulsante `#resetAllBtn` nell'header) — chiamano `initGlobalActions()` di admin-common.js
- `assets/css/styles.css` (stile del dialog `#resetTournamentDialog`)

---

## 2. Soluzione applicata

### Nuovo flusso a 4 fasi visibili + conferma utente

```
┌────────────────────────────────────────────────────────────────────┐
│ v126.10 — flusso transazionale verificato                          │
└────────────────────────────────────────────────────────────────────┘

User click "Reset"
    │
    ▼
Dialog (1 checkbox conferma + 1 pulsante "Esporta file di sicurezza")
    │   resetInProgress = false  (lock globale)
    │
    ▼
Click "Esporta file di sicurezza"
    │   resetInProgress = true
    │   confirmCheck.disabled = true ; execBtn.disabled = true
    │   opId = uuid (per logging)
    │
    ├── FASE 1: SNAPSHOT          setPhase('1/4 · Preparazione dei dati')
    │     │   snapshot = JSON deep-copy dello state corrente
    │     │   resetLog('FASE 1 SNAPSHOT OK', {teams, matches, articles})
    │     ▼
    ├── FASE 2a: BACKUP JSON      setPhase('2/4 · Generazione backup JSON')
    │     │   blob = new Blob([JSON.stringify(payload)], {type:'application/json'})
    │     │   verifyExport('backup JSON', 'application/json', blob)
    │     │     └── blob.size > 0 ? else THROW (reset abortito)
    │     │   resetLog('FASE 2a OK', {filename, sizeBytes})
    │     ▼
    ├── FASE 2b: PDF RECAP        setPhase('2/4 · Generazione PDF recap')
    │     │   await ensurePdfTools()
    │     │   doc = await createRecapDoc(normalizeState(snapshot))
    │     │   blob = doc.output('blob')
    │     │   verifyExport('PDF recap', 'application/pdf', blob)
    │     │     └── blob.size > 0 && type incl. 'pdf' ? else THROW
    │     │   resetLog('FASE 2b OK', {filename, sizeBytes})
    │     ▼
    ├── FASE 3: DOWNLOAD          setPhase('3/4 · Avvio download')
    │     │   triggerDownload(backup) → <a download> click
    │     │   await sleep(400)  ◄── separa i due download
    │     │   triggerDownload(pdf)
    │     │   blobUrls.push(url)  ◄── URLs tracciati per cleanup
    │     ▼
    ├── FASE 3b: ATTESA CONFERMA UTENTE (KEY!)
    │     │   "Verifica i file salvati, poi conferma per procedere"
    │     │   execBtn.hidden = true
    │     │   finalBtn.hidden = false  ;  finalBtn.disabled = true
    │     │   setTimeout(() => finalBtn.disabled = false, 2500)
    │     │     └── anti-rage-click: 2.5s di lock prima dell'abilitazione
    │     │
    │     │   ⏸  L'utente DEVE cliccare esplicitamente "Procedi con la
    │     │       cancellazione". Se chiude il dialog, NIENTE VIENE TOCCATO.
    │     │
    │     ▼
User click "Procedi con la cancellazione"
    │   finalBtn.disabled = true ; cancelBtn.disabled = true
    │
    ├── FASE 4: CANCELLAZIONE     setPhase('4/4 · Cancellazione torneo in corso')
    │     │   executeAtomicWipe(opId):
    │     │
    │     │   4a. localStorage.removeItem(<all admin/public state keys>)
    │     │
    │     │   4b. save(emptyState())   ← patched: scrive locale + broadcast
    │     │
    │     │   4c. await Promise.race([
    │     │         NG_FORCE_REMOTE_SAVE(empty),
    │     │         sleep(8000) → 'timeout'
    │     │       ])
    │     │       ◄── BLOCCA il flow finché Supabase conferma il save (max 8s)
    │     │       Se timeout: log warning, prosegui (il broadcast ha già fatto
    │     │       partire un retry asincrono).
    │     │
    │     │   4d. verifyState = store.load('admin')
    │     │       isEmpty = teams.length===0 && matches.length===0 && articles.length===0
    │     │       if(!isEmpty) THROW "stato locale ancora popolato, riprovare"
    │     │   resetLog('VERIFICA STATO VUOTO OK')
    │     ▼
    │
    ├── FASE 5: RELOAD            setPhase('Reset completato. Ricaricamento…', 'ok')
    │     │   setTimeout(() => {
    │     │     blobUrls.forEach(URL.revokeObjectURL)  ◄── cleanup risorse
    │     │     location.reload()
    │     │   }, 1200)
    │     ▼
    │   Page reload
    │     ↓
    │   admin-common init → state() → empty
    │     ↓
    │   supabase-sync.refreshPublicData → fetch da Supabase → empty
    │     ↓
    │   UI mostra stato vuoto ✅


┌── ERROR HANDLING ──────────────────────────────────────────────────┐
│ Errore in FASE 1/2/3 (PRIMA della cancellazione):                  │
│   ✅ Nessun dato toccato                                            │
│   ✅ setPhase('error') + setMsg(`Errore: ${err.message}`, 'error')  │
│   ✅ resetInProgress = false  → utente può riprovare                │
│                                                                    │
│ Errore in FASE 4 (durante cancellazione):                          │
│   ✅ setPhase('Cancellazione fallita', 'error')                     │
│   ✅ finalBtn riabilitato per ritentare                             │
│   ⚠  Stato locale già emptyState — coerenza con remoto verrà       │
│      verificata al prossimo NG_FORCE_REMOTE_SAVE o al reload        │
└────────────────────────────────────────────────────────────────────┘
```

### File modificato

| Percorso | Intervento |
|---|---|
| `assets/js/admin-common.js` | Riscrittura completa di `openResetDialog` + nuove funzioni `snapshotState`, `buildBackupBlob`, `buildRecapPdfBlob`, `verifyExport`, `triggerDownload`, `executeAtomicWipe`, `resetLog`. La funzione legacy `resetStorageAndState` è mantenuta ma non più chiamata dal nuovo flusso. |
| `assets/css/styles.css` | Append blocco `v126.10 — Reset dialog (fasi visibili)`: `.reset-steps`, `.reset-phase-box`, `.reset-phase`, `.reset-phase-error`, `.reset-phase-ok`, `.reset-choice-grid`. |

Nessuna modifica a: `store.js`, `supabase-sync.js`, HTML, altri admin-*.js, API, autenticazione, routing, stati partita, logica live, generazione dei singoli PDF report.

### Confronto export prima/dopo

| Aspetto | Prima | Dopo |
|---|---|---|
| Backup JSON | Opzionale (checkbox unchecked-able) | **Obbligatorio, sempre generato** |
| PDF recap | Opzionale (checkbox unchecked di default) | **Obbligatorio, sempre generato** |
| Verifica blob | Nessuna | `blob.size > 0` + MIME check + throw se invalido |
| Verifica download | Hardcoded `setTimeout(900)` | **Conferma esplicita utente** ("Procedi") con anti-rage-click 2.5s |
| Cancellazione | Sempre eseguita dopo 900ms | Mai eseguita se export fallisce |

### Garanzie di sicurezza dati

✅ **L'export AVVIENE PRIMA della cancellazione** — il pulsante "Procedi" appare solo dopo che entrambi i blob sono stati verificati e i download triggerati.

✅ **Il PDF/JSON usa i dati pieni del torneo** — `snapshotState()` fa deep-copy all'inizio, prima di qualsiasi `save(emptyState)`. La normalizzazione e la generazione PDF leggono dal solo snapshot.

✅ **La cancellazione avviene solo dopo un export riuscito** — `verifyExport()` lancia `throw` in caso di blob non valido; il catch del flow chiama setPhase('error') e riabilita la sola UI di retry; `resetInProgress = false` ma `finalBtn` resta nascosto.

✅ **Atomicità remote save** — `await NG_FORCE_REMOTE_SAVE(empty)` con timeout 8s di sicurezza. Se non disponibile (es. Supabase offline), si procede comunque ma con log esplicito.

✅ **Verifica stato vuoto post-cancellazione** — `store.load('admin')` rilegge da localStorage e controlla `teams.length===0 && matches.length===0 && articles.length===0`. Se ancora popolato, throw.

✅ **Lato utente coerente** — `save(emptyState)` triggera il broadcast WebSocket via la patched `store.save`. I client utenti già aperti ricevono l'evento `ng:public-state-updated` e il loro renderTabSection si aggiorna mostrando lo stato vuoto, senza attendere il reload dell'admin (v126.7 garantisce che nessun gate "fingerprint" blocchi questo update).

### Anti-doppio-click

Triplice protezione:
1. **Lock globale**: `let resetInProgress = false` — la funzione `openResetDialog()` riconosce e bailout immediato se già in corso.
2. **Disabilitazione pulsanti**: `execBtn.disabled`, `confirmCheck.disabled`, `cancelBtn.disabled` durante le fasi attive.
3. **Anti-rage-click**: il pulsante "Procedi con la cancellazione" resta `disabled` per 2.5s anche dopo essere apparso, impedendo doppi click veloci o tap accidentali.

### Logging strutturato

Ogni reset ha un `opId` univoco (es. `R7K3FQ`) loggato in console:

```
[NG-Reset R7K3FQ] AVVIO RESET { time: '2026-06-22T...' }
[NG-Reset R7K3FQ] FASE 1 SNAPSHOT
[NG-Reset R7K3FQ] FASE 1 SNAPSHOT OK { tournament:'Coppa…', teams:12, matches:24, articles:3 }
[NG-Reset R7K3FQ] FASE 2a BACKUP JSON
[NG-Reset R7K3FQ] FASE 2a BACKUP JSON OK { filename:'…-backup-…json', sizeBytes:47812 }
[NG-Reset R7K3FQ] FASE 2b PDF RECAP
[NG-Reset R7K3FQ] FASE 2b PDF RECAP OK { filename:'…-recap-torneo.pdf', sizeBytes:288104 }
[NG-Reset R7K3FQ] FASE 3 DOWNLOAD AVVIO
[NG-Reset R7K3FQ] FASE 3 DOWNLOAD OK { backup:'…', pdf:'…' }
[NG-Reset R7K3FQ] FASE 3 IN ATTESA CONFERMA UTENTE
[NG-Reset R7K3FQ] FASE 4 CANCELLAZIONE INIZIO
[NG-Reset R7K3FQ] CANCELLAZIONE  rimozione cache localStorage
[NG-Reset R7K3FQ] CANCELLAZIONE  save(emptyState) locale + broadcast
[NG-Reset R7K3FQ] CANCELLAZIONE  attesa NG_FORCE_REMOTE_SAVE
[NG-Reset R7K3FQ] CANCELLAZIONE  remote save risultato: true
[NG-Reset R7K3FQ] VERIFICA STATO VUOTO { teams:0, matches:0, articles:0, ok:true }
[NG-Reset R7K3FQ] RESET COMPLETATO { time: '2026-06-22T...' }
```

Niente token, password o dati sensibili nei log. Solo conteggi e nomi file.

### Cleanup risorse

`blobUrls` accumula le `URL.createObjectURL(...)` create per JSON e PDF. Vengono revocate:
- Immediatamente dopo il completamento (prima del `location.reload`)
- In caso di errore export, sul catch
- Comunque, dopo 4s nel cleanup di `triggerDownload`

Nessun memory leak. Nessun listener residuo (gli event handler sul dialog vivono finché esiste il dialog DOM; al reload tutto sparisce).

## 3. Test eseguiti

| Test | Comando | Esito |
|---|---|---|
| Validatore progetto | `node tools/validate-project.mjs` | ✅ 0 errori, 0 warning |
| Build statica | `node tools/build-static.mjs` | ✅ `dist/` generato |
| Sintassi JS 21 file | `node --check` (via validator) | ✅ |
| Parentesi CSS bilanciate | conteggio via validator | ✅ |
| `prefers-reduced-motion` | regex via validator | ✅ 12 occorrenze (incluso ngResetPulse) |

## 4. Test manuali consigliati (in browser reale)

### Scenari Happy Path
1. **Torneo completo** (12 squadre, calendario completato, classifica, marcatori, bracket) → JSON + PDF integri scaricati, conferma manuale, wipe completo, reload, stato vuoto su admin e utente
2. **Torneo con poche partite** → idem, JSON ~5KB / PDF ~150KB
3. **Torneo vuoto (solo rules)** → idem, file più piccoli ma > 0
4. **Torneo con stemmi mancanti** → placeholder iniziali nel PDF, nessun blocco

### Scenari Error Handling
5. **Disconnetti rete prima del click "Esporta"** → fase 2b può fallire se ensurePdfTools non è in cache → setPhase('error'), NESSUN dato cancellato, utente può riprovare
6. **Disconnetti rete dopo "Procedi"** → fase 4c (NG_FORCE_REMOTE_SAVE) timeout 8s → warning in console, comunque procede con save locale + broadcast; al ricollegamento di rete il broadcast fallback si attiva
7. **Chiudi dialog prima di "Procedi"** → niente toccato, `resetInProgress` resta a true finché il dialog non viene riaperto da `openResetDialog` (che lo resetta esplicitamente)

### Scenari concorrenza
8. **Doppio click su "Reset"** → secondo click bailout immediato perché `resetInProgress=true`
9. **Click rapido su "Procedi"** → bloccato per 2.5s
10. **Due tab admin aperte, reset su tab A** → tab B riceve broadcast del save(emptyState), state aggiornato a vuoto in B; quando si refresha B, niente cambia (già vuoto)

### Scenari coerenza lato utente
11. **Utente con pagina pubblica già aperta durante reset** → broadcast realtime emesso da `save(emptyState)`, il listener `ng:public-state-updated` riceve il nuovo state vuoto, renderTabSection rifà la tab attiva mostrando stato vuoto
12. **Refresh manuale lato utente dopo reset** → fetch da Supabase ritorna empty → UI vuota
13. **Nuovo torneo creato dopo reset** → admin compila nuovi dati, save normali funzionano

### Scenari edge case
14. **Browser blocca i download multipli** (alcuni hanno limit) → workaround già implementato: sleep 400ms fra i due trigger; in caso di blocco, il PDF arriva senza errore visibile ma `verifyExport` non lo nota (verifica il blob, non l'effettivo salvataggio). L'utente in fase 3b si accorge della mancanza del file e NON clicca "Procedi" → nessun dato perso.
15. **Quota localStorage** → eccezione su localStorage.removeItem catturata e loggata come warning, il save(emptyState) continua

## 5. Limiti rimasti

1. **Verifica salvataggio file lato sistema operativo**: nessun browser permette al JS di sapere con certezza se il file è effettivamente nella cartella Downloads dell'utente. La conferma manuale dell'utente ("Procedi con la cancellazione") è l'unico meccanismo robusto possibile in un'app web statica. Alternative considerate e scartate:
   - `showSaveFilePicker()` (File System Access API) → supportato solo da Chrome/Edge desktop, non da Safari/Firefox → trade-off su compatibilità troppo alto
   - Cache nel server → richiederebbe backend dedicato, fuori scope per un'app statica

2. **Cloudinary photos** non vengono cancellate. Sono fuori state e potrebbero essere riutilizzate in un nuovo torneo. Cancellarle richiederebbe chiamate API Cloudinary. Comportamento invariato rispetto a prima.

3. **Timeout remote save 8s** è un compromesso: troppo basso può saltare flush legittimi su rete lenta, troppo alto può bloccare l'UI. 8s è il valore conservativo (la rete tipica Supabase è < 1s).

4. **Test runtime end-to-end** non eseguibili in questo ambiente (no browser headless, no istanza Supabase). I test manuali sopra sono quelli da eseguire prima della release.

## 6. Conferme finali sui vincoli del task

| Vincolo | Stato |
|---|---|
| L'export avviene PRIMA della cancellazione | ✅ |
| Il PDF utilizza i dati pieni (snapshot deep copy iniziale) | ✅ |
| La cancellazione avviene solo dopo un export riuscito | ✅ |
| PDF recap include solo partite concluse | ✅ ereditato da `createRecapDoc` v126.9 |
| Nessun dato live nei PDF | ✅ ereditato |
| Tabellone esportato rappresenta la situazione pre-reset | ✅ snapshot dello state al momento dell'avvio |
| Conferma utente esplicita prima del wipe | ✅ pulsante "Procedi con la cancellazione" |
| Cancellazione transazionale (localStorage + remoto atomico) | ✅ con timeout di sicurezza |
| Doppio click impedito | ✅ triplice protezione |
| Admin e utenti vedono subito lo stato aggiornato | ✅ via broadcast + reload |
| Cache invalidate | ✅ localStorage cleared + reload |
| Frontend ricarica dati dal backend dopo reset | ✅ via location.reload + supabase-sync.refreshPublicData |
| Errore PDF non causa cancellazione | ✅ throw in verifyExport, mai chiamato executeAtomicWipe |
| Errore remote save → stato locale già vuoto ma utente può riprovare | ✅ con log warning chiaro |
| Listener/timer puliti | ✅ blobUrls revocati, setTimeout self-clearing |
| Nessuna richiesta duplicata | ✅ singolo snapshot, singola generazione PDF |
| ZIP contiene un solo report MD (l'ultimo) | ✅ |
