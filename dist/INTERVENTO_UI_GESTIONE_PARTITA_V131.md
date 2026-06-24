# Hardening UI gestione partita e test estesi — versione 1.31.0

## Obiettivo

Questa revisione mantiene invariata la UI responsive introdotta nella versione precedente e amplia in modo sostanziale la verifica dell’intera gestione partita. La batteria aggiuntiva non si limita alla schermata dei marcatori: copre menu della partita, informazioni gara, marcatori, cartellini, modalità KINGS e non KINGS, stato Live, chiusura della partita, rigori, persistenza, dati legacy, accessibilità, touch, resilienza e regole centralizzate di punteggio/statistiche.

Le prove approfondite hanno individuato due regressioni d’interazione, corrette prima della consegna finale. Non sono state modificate le regole di conteggio dei gol, il formato dei dati, le statistiche o gli export.

## Problemi individuati dai test aggiuntivi

### 1. `Escape` nel combobox poteva chiudere la modale

**Causa:** il gestore accessibile globale intercettava `Escape` sull’overlay prima che il combobox dei partecipanti completasse la propria gestione. Quando l’elenco dei risultati era aperto, l’azione poteva propagarsi fino alla chiusura dell’intera finestra.

Inoltre, nel caso in cui il focus fosse posizionato su un risultato, il focus veniva riportato al campo di ricerca dopo la chiusura dell’elenco. Il relativo evento `focusin` poteva riaprire immediatamente i risultati.

**Correzione:**

- il gestore globale dell’overlay non chiude la modale quando `Escape` proviene da un combobox con risultati aperti;
- il combobox chiude prima il livello corretto dell’interfaccia;
- il focus viene riportato alla ricerca in un ordine che evita la riapertura dell’elenco;
- una successiva pressione di `Escape` continua a chiudere normalmente la modale.

### 2. Attivazione Live con footer non aggiornato immediatamente

**Causa:** il primo passaggio allo stato Live usava il salvataggio silenzioso. Lo stato veniva persistito correttamente, ma il pannello aperto non veniva sempre ricostruito; il footer poteva quindi conservare temporaneamente azioni e diciture dello stato precedente.

**Correzione:** dopo ogni aggiornamento Live vengono rigenerati sia l’elenco delle partite sia il pannello attualmente aperto. Al primo passaggio Live l’utente resta nella sezione corrente, ma vede subito pulsanti, etichette e stato aggiornati.

## Compatibilità e logica invariata

Non sono stati modificati:

- formato degli eventi gol salvati;
- distinzione tra gol normali, doppi, presidente e autogol;
- valore del gol doppio KINGS nel risultato e nella classifica marcatori;
- classifica marcatori ordinaria;
- classifica dei presidenti;
- gol fatti, gol subiti e differenza reti;
- stato Live rispetto alle statistiche definitive;
- dettagli partita ed export;
- compatibilità con dati legacy;
- comportamento delle competizioni non KINGS.

La UI continua a usare esclusivamente `NexoraStore` e le funzioni centralizzate già presenti. Non sono stati aggiunti conteggi alternativi nei componenti visivi.

## File modificati

### Correzioni funzionali

- `assets/js/admin-matches.js`
- `assets/js/ux-a11y.js`

### Aggiornamento cache runtime

Il riferimento a `ux-a11y.js` è stato aggiornato nelle 13 pagine HTML, mentre `admin-matches.html` aggiorna anche il riferimento a `admin-matches.js`:

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
- `index.html`
- `print.html`

### Versione e documentazione

- `package.json`
- `package-lock.json`
- `README.md`
- `INTERVENTO_UI_GESTIONE_PARTITA_V131.md`

La cartella `dist/` è stata eliminata e rigenerata integralmente dalla build. Contiene le copie di produzione dei file sopra elencati. Il report precedente V130 è stato rimosso: nel pacchetto resta soltanto il report corrente.

# Test eseguiti

## 1. Suite browser estesa: 2.930/2.930 asserzioni superate

La suite è stata eseguita in Chromium headless sull’applicazione reale, caricando gli stessi moduli JavaScript e lo stesso CSS del progetto.

### Matrice responsive: 2.696 controlli

Sono state combinate quattro condizioni dati:

1. partita KINGS vuota;
2. partita con molti eventi;
3. modalità non KINGS;
4. dati legacy, inclusi pesi assenti, nulli o uguali a zero.

Per ciascuna condizione sono stati controllati quattro pannelli:

- menu gestione partita;
- informazioni gara;
- marcatori;
- cartellini.

Ogni pannello è stato verificato su 21 configurazioni del viewport:

- 320 × 760;
- 340 × 700;
- 360 × 800;
- 375 × 812;
- 390 × 844;
- 430 × 900;
- 480 × 800;
- 568 × 320;
- 640 × 720;
- 667 × 375;
- 700 × 760;
- 768 × 900;
- 820 × 900;
- 900 × 800;
- 1024 × 900;
- 1280 × 900;
- 1440 × 1000;
- 1600 × 1000;
- 683 × 600, equivalente a una finestra desktop ridotta/zoom elevato;
- 390 × 500, simulazione tastiera virtuale;
- 844 × 390, orientamento orizzontale mobile.

Per ogni combinazione sono stati controllati:

- assenza di overflow orizzontale del documento;
- assenza di overflow della modale;
- assenza di overflow del corpo scrollabile;
- controlli completamente all’interno del viewport;
- nessuna sovrapposizione tra titolo e chiusura;
- nessuna sovrapposizione nel footer;
- nessuna sovrapposizione tra azioni delle card;
- nessun testo principale tagliato.

Sono stati inoltre verificati errori JavaScript e messaggi `console.error` per ciascuno stato.

### Ricerca partecipanti: 35 controlli

Superati:

- apertura e chiusura accessibile del combobox;
- `aria-expanded` coerente;
- esclusione della terza squadra;
- presenza di presidente e autogol solo quando compatibili;
- ricerca maglie 1, 7, 10, 100 e 123;
- priorità delle corrispondenze esatte rispetto ai prefissi;
- mantenimento delle corrispondenze parziali, ad esempio `#100` cercando `10`;
- ricerca per nome senza distinzione tra maiuscole e minuscole;
- mancata confusione tra anno di nascita e numero di maglia;
- ricerca con caratteri accentati;
- limite dei risultati;
- navigazione circolare con frecce;
- selezione con `Enter`;
- chiusura con `Escape` senza chiudere la modale;
- ritorno del focus alla ricerca;
- chiusura con click esterno;
- esclusione di presidente e autogol dalla ricerca cartellini.

### Contatori e inserimento rapido: 28 controlli

Superati:

- pulsante disabilitato senza partecipante;
- valori predefiniti 1 normale e 0 doppio;
- incremento e decremento touch;
- limite minimo 0;
- limite massimo 99;
- correzione di valori vuoti o non validi;
- digitazione manuale;
- aggiornamento immediato del risultato;
- inserimento con `Enter`;
- reset coerente dopo l’aggiunta;
- mantenimento della squadra selezionata;
- impossibilità di creare quantità negative o oltre il limite.

### Modifica, merge, eliminazione e annullamento: 24 controlli

Superati:

- modifica diretta dei gol normali;
- modifica diretta dei gol doppi;
- cambio del giocatore associato;
- apertura, conferma e annullamento dell’editor giocatore;
- unione automatica dei duplicati;
- assenza di card duplicate incoerenti;
- eliminazione con feedback;
- annullamento dell’eliminazione;
- conservazione dei valori DOM modificati;
- scadenza corretta dell’azione di annullamento.

### Persistenza e dati legacy: 19 controlli

Superati:

- passaggio tra pannelli senza perdita del draft;
- salvataggio e riapertura della partita;
- quantità aggregate ricostruite correttamente;
- pesi mancanti, nulli e zero interpretati in modo compatibile;
- esclusione di giocatori non appartenenti alla partita;
- risultato salvato coerente con gli eventi;
- separazione dei tipi di gol dopo la riapertura.

### Cartellini: 16 controlli

Superati:

- ricerca e selezione giocatore;
- inserimento giallo e rosso;
- prevenzione dei duplicati incoerenti;
- modifica del tipo;
- eliminazione;
- annullamento;
- salvataggio e riapertura;
- layout responsive della lista.

### Live, partita conclusa e rigori: 13 controlli

Superati:

- primo passaggio allo stato Live;
- aggiornamento immediato del footer;
- mantenimento del pannello corrente;
- aggiornamento successivo Live;
- persistenza del risultato parziale;
- conclusione della partita;
- esclusione delle partite Live dalle statistiche definitive;
- gestione rigori nelle fasi a eliminazione diretta;
- vincitore ai rigori coerente.

### Accessibilità: 12 controlli di alto livello

Superati:

- `role="dialog"` e `aria-modal`;
- nome accessibile della finestra;
- label/nome accessibile dei controlli visibili;
- target touch adeguati;
- focus visibile;
- focus trap con 60 avanzamenti tramite `Tab`;
- focus trap inverso con 20 pressioni `Shift+Tab`;
- gestione gerarchica di `Escape`;
- chiusura tramite pulsante;
- ripristino del focus al controllo di apertura.

### Stress test: 24 controlli

Superati con:

- 48 card marcatore aggregate;
- 19 cartellini;
- nomi giocatore estremamente lunghi;
- nomi squadra estremamente lunghi;
- scroll fino all’ultimo elemento;
- footer sticky;
- limite dei risultati di ricerca;
- nessun overflow o elemento irraggiungibile.

### Compatibilità non KINGS e liste vuote: 10 controlli

Superati:

- campo gol doppi completamente assente;
- presidente legacy non mostrato;
- eventi incompatibili esclusi;
- autogol disponibili anche senza giocatori;
- salvataggio del solo evento valido;
- nessun errore runtime.

### Resilienza: 7 controlli

Superati:

- storage locale malformato con fallback dell’interfaccia;
- errore simulato di quota durante il salvataggio;
- UI ancora montata e utilizzabile dopo l’errore;
- errore reso rilevabile senza crash;
- aggiornamento remoto del roster;
- mantenimento del draft aperto durante il refresh;
- nuovo giocatore remoto immediatamente ricercabile.

### Screenshot e verifiche mirate: 46 controlli

Sono stati generati rendering a:

- 320 × 760;
- 390 × 844;
- 768 × 900;
- 1440 × 1000;
- 844 × 390.

I controlli geometrici hanno confermato assenza di overflow, sovrapposizioni e testi principali tagliati.

## 2. Property test randomizzato della logica: 12.400/12.400 asserzioni superate

Per verificare che l’hardening della UI non avesse introdotto regressioni nella logica centralizzata, sono stati generati 600 referti casuali conclusi, alternando modalità KINGS e non KINGS. Per ogni referto sono state generate quantità casuali da 0 a 4 di:

- gol normali casa e trasferta;
- gol doppi casa e trasferta;
- gol del presidente casa e trasferta;
- autogol a favore di entrambe le squadre;
- eventi legacy con `weight` assente, nullo o zero.

Per ogni caso sono stati verificati:

- risultato pesato;
- numero reale degli eventi;
- gol validi per la classifica marcatori;
- reti pesate attribuite al giocatore;
- classifica presidenti separata;
- esclusione dei presidenti dalla classifica ordinaria;
- esclusione dei giocatori dalla classifica presidenti;
- gol fatti, subiti e differenza reti di entrambe le squadre;
- aggregazione separata normali/doppi in KINGS;
- conversione coerente dei pesi fuori dalla modalità KINGS;
- peso unitario di presidente e autogol;
- normalizzazione dei dati legacy.

Sono stati inoltre generati 100 stati Live. Per ciascuno è stato verificato che:

- il punteggio pesato fosse visibile;
- i gol non entrassero ancora nella classifica marcatori;
- i gol del presidente non entrassero ancora nella classifica presidenti;
- la partita non entrasse ancora nella classifica definitiva di squadra.

Risultato: **12.400 superati, 0 falliti**.

## 3. Suite di regressione UI precedente

È stata rieseguita anche la suite completa già usata per la versione 1.30.0, adeguando soltanto l’aspettativa corretta di `Escape`: la prima pressione chiude un eventuale elenco del combobox, la successiva chiude la modale.

Risultati:

- flusso principale marcatori: PASS;
- cartellini e informazioni partita: PASS;
- molti marcatori: PASS;
- non KINGS, lista vuota e touch: PASS;
- risultato complessivo: `FULL_UI_PASS`.

## 4. Validazione statica e build

Dopo le correzioni sono stati eseguiti:

```text
npm run lint
npm run build
```

Risultati finali:

- 13 pagine HTML validate;
- 24 moduli JavaScript controllati sintatticamente;
- CSS con parentesi bilanciate;
- riferimenti locali verificati;
- supporto `prefers-reduced-motion` verificato;
- 0 errori;
- 0 avvisi;
- sorgente validata;
- cartella `dist/` rigenerata e validata separatamente.

## Totale verifiche automatiche

- **2.930 asserzioni browser UI**;
- **12.400 asserzioni randomizzate sulla logica centralizzata**;
- **15.330 asserzioni complessive, tutte superate**;
- suite di regressione UI completa: PASS;
- validazione e build: PASS.

## Pulizia finale

Nel progetto consegnato non sono presenti:

- script di test;
- risultati JSON o log di test;
- screenshot di verifica;
- backup temporanei;
- cartelle `.git` o altri metadati di versionamento;
- report di interventi precedenti.

Restano soltanto gli strumenti di validazione e build necessari al progetto e il report V131 corrente.
