# Audit coerenza marcatori Kings League — v1.28.2

**Progetto:** New Generation Tournament  
**Data verifica:** 24 giugno 2026  
**Metodo:** test-driven; nessuna modifica preventiva, correzioni applicate soltanto dopo riproduzione automatica o visiva di un difetto reale.

## 1. Esito generale

| Indicatore | Risultato |
|---|---:|
| Controlli/test complessivi | **111** |
| Superati | **111** |
| Falliti al termine | **0** |
| Difetti funzionali o di coerenza corretti | **5** |
| Difetti grafici/paginazione corretti | **1** |
| Immagini PNG generate e ispezionate | **3** |
| PDF browser-print generati, renderizzati e ispezionati | **2** |
| Test dedicati Kings (logica, export e sincronizzazione) | **58** |
| Regressioni del progetto | **48** |

**Stato finale:** la distinzione tra valore per la squadra, gol individuale, gol doppio e gol del presidente è coerente nei calcoli, nel frontend, nello stato sincronizzato e negli export realmente supportati e verificabili dal progetto.

## 2. Architettura e flusso dei dati ricostruito

Il progetto non utilizza una tabella SQL separata per ogni evento-gol. Lo stato completo del torneo viene normalizzato nel browser e sincronizzato come documento JSON nella riga `app_state` di Supabase.

Flusso rilevato:

1. L'admin modifica il referto in `assets/js/admin-matches.js`.
2. Ogni gol viene mantenuto come **un evento** con `id`, `playerId`, `weight` e, per gli autogol, `ownGoal/teamId`.
3. `assets/js/store.js` normalizza gli eventi, risolve squadra e tipologia del partecipante e calcola:
   - punteggio della partita;
   - GF/GS e classifica squadre;
   - statistiche individuali;
   - classifica giocatori;
   - classifica presidenti.
4. `assets/js/supabase-sync.js` serializza lo stato normalizzato e lo rilegge dalla sincronizzazione remota.
5. Frontend, report PDF e immagini consumano lo stesso stato, ma alcuni generatori eseguono presentazioni o aggregazioni proprie: sono stati pertanto testati separatamente.

### Regole confermate

| Tipo evento | Risultato squadra | Statistiche squadra | Gol personali | Classifica giocatori | Classifica presidenti |
|---|---:|---:|---:|---:|---:|
| Gol normale giocatore | 1 | 1 | 1 | 1 | 0 |
| Gol doppio giocatore | 2 | 2 | 1 | 1 | 0 |
| Gol presidente | 1 massimo | 1 | 0 giocatore | 0 | 1 |
| Autogol | 1 | 1 | 0 | 0 | 0 |

La dicitura `(rig.)` è aggiunta esclusivamente a livello di presentazione dell'evento del presidente. Il nome memorizzato non viene modificato e la classifica presidenti mostra il nome pulito, senza `(rig.)`.

## 3. File e funzioni analizzati

### Calcolo e normalizzazione

- `assets/js/store.js`
  - `normalizeGoalEvent`
  - `normalizeEventIds`
  - `goalScoringTeamId`
  - `presidentGoalLabel`
  - `goalEventLabel`
  - `aggregateGoalEvents`
  - `eventScoreWeight`
  - `matchGoals`
  - `playerStats`
  - `presidentStats`
  - `scorers`
  - `presidentScorers`
  - calcolo classifica e statistiche squadra

### Inserimento e modifica admin

- `assets/js/admin-matches.js`
  - ricerca giocatore per numero di maglia;
  - selezione giocatore/presidente;
  - quantità dei gol;
  - quantità dei gol doppi;
  - cambio marcatore;
  - rimozione;
  - salvataggio, riapertura e normalizzazione del draft.

### Frontend pubblico

- `assets/js/ui.js`
- `assets/js/public.js`
  - card partita;
  - dettaglio partita;
  - profilo squadra;
  - PDF pubblico squadra.

### Sincronizzazione

- `assets/js/supabase-sync.js`
  - normalizzazione del payload remoto;
  - salvataggio e rilettura dello stato `app_state`.

### PDF individuati

- `assets/js/admin-reports.js`
  - `pdfStandings`
  - `pdfScorers`
  - `pdfGroups`
  - `pdfCalendar`
  - `pdfRecap`
  - `pdfBracket`
- `assets/js/admin-common.js`
  - `createRecapDoc`
  - riepilogo globale del torneo
- `assets/js/public.js`
  - `downloadTeamPdf`
- `assets/js/print.js`
  - stampa/PDF browser di calendario, classifica e tabellone.

### Immagini individuate

- `assets/js/share-images.js`
  - immagine partita;
  - classifica generale;
  - classifica del girone;
  - tabellone.

Non risultano nel progetto export immagine separati per classifica marcatori o classifica presidenti. Non sono stati introdotti nuovi formati, come richiesto.

## 4. Dati di test principali

Sono stati utilizzati casi con:

- 2 gol normali + 1 gol doppio dello stesso giocatore;
- più gol doppi dello stesso giocatore;
- gol doppi di entrambe le squadre;
- giocatore e presidente con lo stesso nome;
- presidente con un `weight: 2` volutamente alterato, da normalizzare a 1;
- evento duplicato con lo stesso ID;
- nomi con apostrofi, accenti, cognomi composti e caratteri speciali;
- nomi squadra e presidente molto lunghi;
- loghi SVG orizzontali, verticali e quadrati;
- partita senza marcatori, con un marcatore, mista e con **29 marcatori distinti**;
- calendario di 42 partite e classifica di 12 squadre per la paginazione PDF.

## 5. Matrice dei test principali

| Test | Risultato atteso | Risultato ottenuto | Esito finale | Correzione |
|---|---|---|---|---|
| Singolo gol doppio | +2 squadra, +1 giocatore, 1 evento | Conforme | Superato | Nessuna |
| 2 normali + 1 doppio | 4 squadra, 3 personali, 3 eventi | Conforme | Superato | Nessuna |
| Normale → doppio | Risultato +1, gol personali invariati | Conforme | Superato | Nessuna |
| Doppio → normale | Risultato -1, gol personali invariati | Conforme | Superato | Nessuna |
| Eliminazione gol doppio | -2 squadra, -1 personale, -1 evento | Conforme | Superato | Nessuna |
| Più gol doppi stesso giocatore | Ogni evento vale 2 squadra e 1 personale | Conforme | Superato | Nessuna |
| Gol doppi di più giocatori | Conteggi separati per ID | Conforme | Superato | Nessuna |
| Gol doppi entrambe le squadre | Risultato ponderato corretto | Conforme | Superato | Nessuna |
| Evento duplicato stesso ID | Conteggiato una sola volta | Inizialmente duplicato; ora deduplicato | Superato | Deduplica in `normalizeEventIds` |
| Cambio giocatore del gol doppio | Trasferimento di un solo evento personale | Conforme | Superato | Nessuna |
| Gol presidente | +1 risultato, +1 classifica presidenti | Conforme | Superato | Nessuna |
| Presidente con peso 2 alterato | Forzato a peso massimo 1 | Conforme | Superato | Nessuna |
| Presidente nella classifica giocatori | Deve essere assente | Assente | Superato | Nessuna |
| Nome presidente nel dettaglio | `Nome (rig.)` | Inizialmente `Nome pres. (rig.)`; ora corretto | Superato | Etichetta presentazionale centralizzata |
| Nome presidente in classifica presidenti | Nome pulito, senza `(rig.)` | Conforme | Superato | Nessuna |
| Giocatore/presidente stesso nome | Separazione tramite ID e tipo | Conforme | Superato | Nessuna |
| Ricerca maglia 9 e 10 | Risultati corretti e distinti | Conforme in browser | Superato | Nessuna |
| Modifica semplice admin | Una riga aggregata, quantità/edit/remove | Conforme in browser | Superato | Nessuna |
| Salvataggio e reload | Stesso significato e stessi pesi | Conforme | Superato | Nessuna |
| Sincronizzazione remota | Payload, rilettura e frontend equivalenti | Conforme, 6/6 | Superato | Nessuna |
| Classifica giocatori | Usa eventi, non somma dei pesi | Conforme | Superato | Nessuna |
| Classifica presidenti | Solo presidenti, raggruppati per ID | Conforme | Superato | Nessuna |
| Statistiche squadra | Gol doppi conteggiati come 2 | Conforme | Superato | Nessuna |
| PDF classifica marcatori | Conteggio individuale + riepilogo corretto | Riepilogo inizialmente 0; ora corretto | Superato | Proprietà statistiche corrette |
| PDF riepilogo partite | Risultato ponderato e label coerenti | Conforme dopo correzioni | Superato | Indicazione doppio e label presidente |
| PDF pubblico squadra | Documento generato e dati ponderati | Inizialmente eccezione `today is not defined` | Superato | Formatter data minimo |
| Immagine partita combinata | Dati corretti, nessun overlap | Conforme, 1080×1410 | Superato | Nessuna |
| Immagine stress | Testi/loghi lunghi leggibili | Conforme, 1080×1410 | Superato | Nessuna |
| Immagine 29 marcatori | Altezza adattiva, nessun taglio | Conforme, 1080×2466 | Superato | Nessuna |
| PDF calendario lungo | Contenuti dalla prima pagina, header ripetuti | Prima pagina quasi vuota/contrasto errato; ora conforme | Superato | CSS print mirato |
| PDF classifica lunga | Righe non tagliate, contrasto e paginazione | Conforme dopo CSS print | Superato | CSS print mirato |
| Rigenerazione dopo modifica | Nessun dato obsoleto | Conforme | Superato | Nessuna |
| Rigenerazione dopo eliminazione | Evento assente in sito/export | Conforme | Superato | Nessuna |

## 6. Difetti dimostrati e correzioni applicate

### 6.1 Etichetta del gol del presidente

**Difetto:** l'evento veniva mostrato come `Nome pres. (rig.)`, mentre il requisito prevede `Nome (rig.)`; la graduatoria presidenti deve invece mantenere il solo nome.

**Causa:** fallback ed etichetta centralizzata includevano testo aggiuntivo non richiesto.

**Correzione:** `presidentGoalLabel` e i fallback dell'editor ora aggiungono soltanto ` (rig.)` nei contesti evento. I dati anagrafici e la classifica presidenti restano invariati.

### 6.2 Duplicazione di eventi con lo stesso ID

**Difetto:** due record importati/sincronizzati con identico ID potevano incrementare due volte risultato e classifiche.

**Causa:** `normalizeEventIds` assegnava gli ID mancanti ma non eliminava duplicati già esistenti.

**Correzione:** deduplicazione deterministica per ID durante la normalizzazione.

### 6.3 Indicazione del gol doppio

**Difetto:** il valore del risultato era corretto, ma in alcuni contesti di presentazione non era evidente quale marcatore avesse segnato un gol doppio.

**Causa:** l'aggregazione esponeva il totale degli eventi ma non il numero di eventi con peso 2.

**Correzione:** aggiunto `doubleCount` all'aggregazione e relativa indicazione coerente in UI, PDF riepilogo e immagine partita. Il conteggio individuale rimane basato sugli eventi.

### 6.4 Riepilogo PDF della classifica marcatori

**Difetto:** “Gol totali consolidati” e media potevano risultare zero con gol presenti.

**Causa:** il generatore leggeva proprietà inesistenti (`actualGoals`, `matchesPlayed`).

**Correzione:** uso di `stats.goals` per gli eventi personali, conteggio locale delle partite concluse e `stats.scoreGoals` per la media ponderata di squadra.

### 6.5 PDF pubblico della squadra

**Difetto:** la generazione poteva interrompersi con `today is not defined`.

**Causa:** riferimento a un formatter assente nel modulo pubblico.

**Correzione:** aggiunto il formatter locale della data già coerente con gli altri generatori.

### 6.6 Paginazione e contrasto dei PDF browser-print

**Difetto visivo riprodotto:** sezioni lunghe marcate come indivisibili lasciavano quasi vuota la prima pagina; una regola tardiva impostava testo scuro su fondo scuro.

**Correzione minima:** esclusivamente in `@media print`:

- card lunghe paginabili;
- intestazioni tabella ripetute;
- righe non spezzate;
- colori testuali coerenti con il fondo.

**Risultato:** calendario ridotto da 5 a 4 pagine, contenuti presenti dalla prima pagina, nessuna riga troncata e contrasto leggibile.

## 7. Export verificati

### PDF

| Export | Tipo verifica | Esito |
|---|---|---|
| Classifica | Generazione browser reale, rendering PNG, ispezione pagine | Superato |
| Calendario con risultati | Generazione browser reale, rendering PNG, ispezione prima/intermedia/ultima pagina | Superato |
| Classifica marcatori admin | Test integrativo delle funzioni reali jsPDF e dei dati prodotti | Superato |
| Riepilogo partite admin | Test integrativo delle funzioni reali jsPDF | Superato |
| Classifica/gironi/tabellone admin | Test di regressione e flusso dati | Superato |
| Riepilogo globale | Test integrativo | Superato |
| PDF pubblico squadra | Test integrativo e regressione del generatore | Superato |

I generatori jsPDF amministrativi dipendono da librerie caricate da CDN e non sono incluse nel repository. Nell'ambiente offline è stata eseguita la logica reale dei generatori con un harness jsPDF compatibile, verificando testi, tabelle, aggregazioni e coordinate. La verifica visuale binaria/renderizzata è stata eseguita sui PDF browser-print realmente producibili senza dipendenze esterne.

### Immagini

| File | Dimensione | Contenuto | Esito visivo |
|---|---:|---|---|
| `match-combined.png` | 1080×1410 | normale + doppio + presidente | Superato |
| `match-stress.png` | 1080×1410 | nomi/loghi problematici | Superato |
| `match-many-scorers.png` | 1080×2466 | 29 marcatori distinti | Superato |

Controllati: proporzioni loghi, allineamento, margini, ritorni a capo, presenza di `(rig.)`, indicazione del doppio, contrasto, assenza di tagli e sovrapposizioni.

## 8. Inserimento, modifica ed eliminazione

La sequenza è stata verificata per gol normali, doppi e del presidente:

1. inserimento nell'editor admin;
2. salvataggio nello stato;
3. serializzazione nel payload Supabase simulato;
4. rilettura e normalizzazione;
5. aggiornamento risultato e statistiche;
6. aggiornamento classifiche individuali;
7. generazione dell'export;
8. modifica di peso o marcatore;
9. rigenerazione con soli dati aggiornati;
10. eliminazione e nuova rigenerazione.

Non sono emerse cache persistenti di PDF o immagini: gli export vengono costruiti ex novo dallo stato corrente.

## 9. Casi non verificabili o non presenti

- **Partita annullata:** il modello del progetto espone `scheduled`, `live` e `played`, ma non uno stato “annullata”. Non è stato inventato un nuovo stato. È stata testata l'eliminazione della partita/evento.
- **Database relazionale per gol:** non esiste una tabella marcatore né query SQL con JOIN; la persistenza è un documento JSON. Sono stati testati payload, normalizzazione e rilettura, non query SQL inesistenti.
- **API backend autonoma:** non esiste un servizio applicativo separato; la sincronizzazione Supabase è client-side.
- **Immagine classifica marcatori/presidenti:** non è una funzione presente nel progetto. Non è stato introdotto un nuovo formato.
- **Rendering visuale binario dei PDF jsPDF admin:** non eseguibile offline perché le librerie sono solo CDN; dati e layout calls sono stati verificati con harness. I PDF browser-print sono invece stati generati e ispezionati realmente.

## 10. Test automatici aggiunti

- `tools/test-kings-scorer-audit.mjs` — 42 controlli logici.
- `tools/test-kings-export-audit.mjs` — 7 controlli sui PDF admin.
- `tools/test-kings-aux-pdf-audit.mjs` — 3 controlli sui PDF ausiliari/pubblici.
- `tools/test-kings-sync-audit.mjs` — 6 controlli di sincronizzazione.
- `tools/test-kings-image-visual.mjs` — 3 immagini reali e ispezionabili.
- `tools/test-kings-print-pdf.mjs` — 2 PDF reali con casi multipagina.

Comando aggregato:

```bash
npm run test:kings-audit
```

Sono stati inoltre rieseguiti scheduler, simulazione, condivisione calendario, Worker, test UI dell'editor marcatori, validazione, lint e build.

## 11. File di produzione modificati

- `assets/js/store.js`
- `assets/js/ui.js`
- `assets/js/admin-matches.js`
- `assets/js/admin-reports.js`
- `assets/js/share-images.js`
- `assets/js/public.js`
- `assets/css/styles.css`
- file HTML, esclusivamente per aggiornare la chiave cache degli asset a `v132-kings-scorer-audit`;
- `package.json` e `package-lock.json` per versione e comando test.

## 12. Conclusione

Dopo le correzioni dimostrate dai test:

- un gol doppio produce **2** per squadra e risultato, ma **1** solo gol personale;
- la classifica giocatori conta eventi validi e non pesi;
- il presidente è escluso dalla classifica giocatori e incluso esclusivamente nella graduatoria presidenti;
- il gol del presidente pesa sempre al massimo **1**;
- `(rig.)` compare accanto al nome nei dettagli dell'evento, ma non nella classifica presidenti e non nel dato anagrafico;
- duplicati con lo stesso ID non moltiplicano i conteggi;
- frontend, stato remoto simulato, PDF e immagini usano dati semanticamente equivalenti;
- gli export realmente renderizzati non presentano tagli, sovrapposizioni o paginazione illeggibile nei casi di stress eseguiti.

**Esito finale: 111 controlli superati su 111; nessun errore noto rimasto negli scenari e nei formati effettivamente supportati e verificabili.**
