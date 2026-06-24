# Intervento marcatori KINGS — versione 1.29.0

**Data:** 24 giugno 2026  
**Esito complessivo:** PASS

## Obiettivo

Correzione completa e coerente della gestione dei marcatori, dei gol doppi e dei gol del presidente nel pannello amministratore, nei dettagli pubblici, nelle statistiche di giocatori e squadre, nelle simulazioni e in tutti gli export presenti nel progetto.

## Cause individuate

### 1. Ricerca del giocatore per numero di maglia

La ricerca dell’editor marcatori trattava il testo principalmente come nome e dipendeva da una squadra selezionata. In assenza della selezione, il filtro non produceva risultati utili. Il confronto numerico non stabiliva inoltre una priorità chiara tra corrispondenza esatta e prefisso.

**Correzione:**

- normalizzazione del numero di maglia come stringa numerica;
- corrispondenza esatta mostrata prima delle corrispondenze per prefisso;
- supporto ai numeri con più cifre;
- ricerca limitata ai giocatori delle due squadre della partita;
- quando è selezionata una squadra, ulteriore filtro a quella squadra;
- mantenimento della ricerca testuale per nome senza regressioni;
- selezione sempre associata all’ID del giocatore, non al testo visualizzato.

### 2. Più gol dello stesso giocatore

L’editor precedente rappresentava i gol con un unico totale e un valore “di cui doppi”. In più punti il dato veniva ricostruito o aggregato solo per giocatore. Questa impostazione rendeva ambiguo il salvataggio di più reti, la modifica successiva e la distinzione tra tipologie.

**Correzione:**

- due contatori espliciti e indipendenti: `goalNormalCount` e `goalDoubleCount`;
- quantità modificabili da 0 a 99;
- espansione centralizzata dei contatori in eventi persistiti;
- ricompattazione degli eventi salvati quando si riapre una partita;
- conservazione degli ID esistenti durante le modifiche, quando possibile;
- deduplicazione degli ID e aggregazione coerente per coppia giocatore/tipologia;
- eliminazione completa di una tipologia impostandone la quantità a zero.

### 3. Gol normali e gol doppi confusi nei dettagli

La funzione comune aggregava gli eventi soltanto per marcatore. Per questo 2 gol normali e 2 gol doppi potevano apparire come un’unica voce generica.

**Correzione:** l’aggregazione ora usa la chiave composta da partecipante e tipologia dell’evento. Lo stesso giocatore produce quindi righe distinte:

- `Paolo Fara — Gol × 2`
- `Paolo Fara — Gol doppi × 2`

### 4. Formule replicate in più componenti

Dettagli, card, statistiche, simulazione ed export contenevano formule o fallback locali. Ciò poteva produrre valori diversi tra UI, risultato e documenti esportati.

**Correzione:** la logica è stata centralizzata in `assets/js/store.js` e riutilizzata dagli altri moduli.

Regole applicate:

```text
golClassificaMarcatore = golNormali + golDoppi
retiRisultatoGiocatore = golNormali + (golDoppi × 2)
retiSquadra = somma dei pesi degli eventi validi della squadra
```

Pesi degli eventi:

- gol normale: 1 nella classifica individuale, 1 nel risultato;
- gol doppio KINGS: 1 nella classifica individuale, 2 nel risultato;
- gol del presidente: escluso dalla classifica ordinaria, 1 nella classifica presidenti e 1 nel risultato;
- autogol: 1 rete assegnata alla squadra avversaria;
- modalità non KINGS: gli eventi con peso doppio vengono normalizzati come gol normali.

### 5. Simulazione

Il controllo di coerenza della simulazione assumeva implicitamente che il numero degli eventi coincidesse con il punteggio. L’assunzione non è valida con i gol doppi.

**Correzione:** la simulazione confronta ora il risultato con `teamScoreValue`, cioè la stessa funzione pesata usata dal resto del progetto.

### 6. Export e nomi lunghi

Alcuni export usavano aggregazioni locali, altezze fisse o limiti sul numero di marcatori mostrati. Con più righe o nomi lunghi potevano verificarsi omissioni e sovrapposizioni.

**Correzione:**

- dati dei marcatori derivati dalla stessa aggregazione centralizzata dei dettagli;
- righe distinte per gol normali, doppi e presidente;
- altezza delle card calcolata in base al contenuto;
- rimozione del taglio delle righe marcatori;
- adattamento del testo per nomi squadra e partecipanti lunghi;
- layout responsive e wrapping esplicito.

### 7. Gol del presidente

Il presidente poteva essere normalizzato o mostrato con logiche diverse nei vari componenti.

**Correzione:**

- associazione verificata tramite ID del presidente e squadra partecipante;
- tipo evento `president` distinto;
- quantità multiple supportate;
- classifica presidenti separata da quella ordinaria;
- conteggio nel risultato e nelle statistiche di squadra;
- dicitura uniforme nei dettagli e negli export:
  - `Nome Presidente — Gol (rig.)`
  - `Nome Presidente — Gol (rig.) × 2`

## Funzioni centralizzate principali

In `assets/js/store.js`:

- `goalEventKind(state, goal)` — identifica `normal`, `double`, `president` o `own-goal`;
- `goalTypeLabel(kind, count)` — restituisce la descrizione coerente della tipologia;
- `goalBreakdownText(row, options)` — costruisce la riga testuale unica per dettagli ed export;
- `aggregateGoalEvents(state, match)` — aggrega per partecipante e tipologia, senza mescolare gol normali e doppi;
- `eventScoreWeight(state, match, goal)` — peso valido per il risultato;
- `teamScoreValue(state, match, teamId)` — totale reti della squadra;
- `matchGoals(state, match)` — risultato finale basato sui pesi centralizzati.

Le statistiche individuali continuano a contare gli eventi validi una volta ciascuno; le statistiche di squadra usano il peso del risultato.

## Compatibilità dei dati

Non è stata necessaria una migrazione dello schema dati. Il progetto persiste già i marcatori come eventi individuali con il campo `weight`.

La normalizzazione gestisce:

- `weight` assente;
- `weight: null`;
- `weight: 0`;
- partite salvate prima della correzione;
- eventi KINGS caricati in una modalità non KINGS;
- presidenti o giocatori non appartenenti alle squadre della partita;
- ID evento duplicati.

Il payload sincronizzato con Supabase passa dalla stessa normalizzazione dello store; non esiste nel progetto un secondo motore server separato per il calcolo dei marcatori. Frontend, persistenza, statistiche ed export leggono quindi la stessa semantica degli eventi.

## File modificati

### Logica e interfaccia

- `assets/js/store.js`
- `assets/js/admin-matches.js`
- `assets/js/ui.js`
- `assets/js/public.js`
- `assets/js/share-images.js`
- `assets/js/admin-reports.js`
- `assets/js/admin-simulation.js`
- `assets/css/styles.css`

### Cache degli asset aggiornata

- `index.html`
- `print.html`
- `404.html`
- `admin.html`
- `admin-articles.html`
- `admin-customize.html`
- `admin-groups.html`
- `admin-matches.html`
- `admin-photos.html`
- `admin-players.html`
- `admin-reports.html`
- `admin-rules.html`
- `admin-teams.html`

### Versione e build

- `package.json`
- `package-lock.json`

### Documento finale

- `INTERVENTO_MARCATORI_KINGS_V129.md`

## Test eseguiti

I file e gli artefatti di test sono stati rimossi dal pacchetto finale come richiesto, dopo l’esecuzione.

### Matrice funzionale centralizzata — 15/15 PASS

| Caso | Esito |
|---|---|
| Giocatore con 1 gol normale | PASS |
| Giocatore con 3 gol normali | PASS |
| Giocatore con 1 gol doppio | PASS |
| Giocatore con 3 gol doppi | PASS |
| Giocatore con 2 gol normali + 2 gol doppi | PASS |
| Più giocatori e tipologie nella stessa partita | PASS |
| Salvataggio, riapertura e modifica con conservazione degli ID | PASS |
| Eliminazione dei gol normali | PASS |
| Eliminazione dei gol doppi | PASS |
| Gol del presidente singolo e multiplo | PASS |
| Classifica marcatori ordinaria separata | PASS |
| Classifica marcatori presidenti separata | PASS |
| Risultato, GF, GS e differenza reti pesati | PASS |
| Compatibilità legacy e modalità non KINGS | PASS |
| Esclusione di giocatori non partecipanti e deduplicazione | PASS |

### Test browser amministratore/pubblico — PASS

Verificato con Chromium:

- ricerca maglia `9` e `10`, comprese due cifre;
- ricerca senza squadra selezionata sulle sole due squadre della partita;
- selezione corretta tramite ID;
- salvataggio di 3 gol normali + 2 doppi come pesi `[1,1,1,2,2]`;
- risultato coerente `7-0`;
- riapertura editor con valori `3` e `2` preservati;
- conversione/modifica a gol del presidente;
- dettaglio pubblico distinto;
- nessun errore JavaScript o richiesta locale fallita.

### Responsive — PASS

Controllati editor e dettagli alle larghezze:

- 320 px;
- 390 px;
- 768 px;
- 1280 px.

Nessun overflow orizzontale, testo tagliato o sovrapposizione rilevata nei casi con nomi lunghi e più marcatori.

### Export — 10/10 PASS

- 7/7 controlli sul PDF marcatori, riepilogo, classifica squadre e calendario;
- 3/3 controlli sui PDF ausiliari e sulle schede squadra;
- separazione tra gol normali, doppi e presidente;
- punteggio pesato coerente;
- classifica individuale non raddoppiata dai gol doppi.

### Rendering reale — PASS

- 3 immagini PNG generate, inclusi casi stress con molti marcatori e nomi lunghi;
- 2 PDF reali generati (calendario e classifica);
- nessuna sovrapposizione visiva rilevata.

### Validazione tecnica — PASS

- 13 pagine HTML analizzate;
- 24 file JavaScript analizzati prima della pulizia dei test;
- 0 errori;
- 0 avvisi;
- controllo sintattico dei file JavaScript modificati superato;
- build statica e validazione della cartella `dist` superate.

## Pulizia del progetto

Dal pacchetto finale sono stati rimossi:

- vecchi patch/changelog e report versionati;
- risultati e artefatti di test precedenti;
- script `test-*` e supporti esclusivamente dedicati ai test;
- cartelle o file di versionamento (`.git`, `.github`, `.svn`, `.hg`, ecc.);
- file duplicati o superati di documentazione versionata.

Sono stati mantenuti il codice applicativo, gli strumenti di validazione/build, la documentazione operativa ancora attuale e questo unico report finale dell’intervento.

## Risultato finale

La gestione dei marcatori usa ora una sola logica condivisa per salvataggio, modifica, risultato, classifiche, statistiche, dettagli ed export. Gol normali, gol doppi, autogol e gol del presidente restano distinti nell’intero flusso; il peso doppio influisce esclusivamente sul punteggio e sulle statistiche di squadra, non raddoppia il valore individuale nella classifica marcatori.
