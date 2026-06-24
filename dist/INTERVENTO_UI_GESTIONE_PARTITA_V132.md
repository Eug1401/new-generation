# Intervento UI gestione partita — versione 1.32.0

## Obiettivo

L’intervento introduce un unico salvataggio definitivo per l’intera gestione della partita. Il comando è disponibile esclusivamente nella scheda principale della gara, all’interno di una card centrata e riconoscibile. Le sezioni **Info partita**, **Marcatori** e **Cartellini** non salvano più autonomamente: ogni modifica resta in bozza, viene segnalata nell’interfaccia e viene applicata soltanto attraverso il salvataggio generale.

La logica centralizzata di marcatori, gol doppi, gol del presidente, autogol, statistiche ed export non è stata modificata.

## Cause dei problemi

1. **Azioni definitive distribuite in più sezioni.** Marcatori, cartellini, informazioni e stato Live disponevano di percorsi di salvataggio separati. Ciò rendeva poco chiaro quali dati fossero già definitivi e quali fossero ancora in modifica.
2. **Informazioni organizzative e referto sportivo condividevano lo stesso flusso.** Una modifica a campo, arbitro, data o orario poteva essere trattata come parte della chiusura della gara.
3. **Rilevamento della bozza basato sul confronto integrale degli oggetti.** Identificativi tecnici, ordine degli eventi e normalizzazioni potevano produrre falsi stati “modificato”.
4. **Stato visivo dedotto dai gol presenti nella bozza.** Inserendo un marcatore, la UI poteva mostrare prematuramente “Giocata”, anche se il referto non era ancora stato salvato.
5. **Caso 0-0 non sufficientemente esplicito.** Una gara senza eventi necessitava di una conferma dedicata, distinta dal salvataggio delle sole informazioni.
6. **Svuotamento di un referto già definitivo.** La rimozione di tutti gli eventi poteva trasformare una gara giocata in uno 0-0 vuoto senza una seconda conferma di sicurezza.
7. **Combobox riaperto dopo l’inserimento.** Il focus automatico sulla ricerca riapriva l’elenco dei risultati e poteva coprire il pulsante per tornare alla scheda principale.

## Correzioni effettuate

### Salvataggio generale unico

È presente un solo comando definitivo, nella card **Salvataggio generale** della scheda principale della partita. Il pulsante:

- è centrato nella card;
- non compare in Info partita, Marcatori o Cartellini;
- cambia etichetta e spiegazione in base ai dati in bozza;
- mostra un riepilogo di risultato, eventi gol, cartellini e sezioni modificate;
- applica in modo atomico tutte le modifiche sportive e organizzative quando il referto deve essere salvato.

Le singole sezioni contengono soltanto il comando **Torna alla scheda partita** e un messaggio che ricorda che i dati sono ancora in bozza.

### Bozze per sezione

Le modifiche vengono mantenute in memoria durante la navigazione tra le sezioni e anche chiudendo e riaprendo la modale nella stessa sessione. La UI segnala:

- la sezione modificata tramite badge `Bozza`;
- lo stato della sezione tramite banner accessibile `role="status"`;
- il numero di sezioni modificate nel riepilogo del salvataggio generale;
- lo stato reale della partita separatamente dallo stato della bozza.

Il confronto tra dati salvati e bozza è semantico: gol e cartellini vengono normalizzati per partecipante, tipologia, peso e minuto, senza dipendere dagli identificativi tecnici o dall’ordine dei record.

### Salvataggio sicuro delle sole informazioni

Quando cambiano esclusivamente:

- campo;
- arbitro;
- data;
- orario;

il pulsante diventa **Salva informazioni**. Questo percorso aggiorna soltanto i dati organizzativi e mantiene invariati:

- stato della gara;
- marcatori;
- cartellini;
- rigori;
- risultato;
- classifiche e statistiche.

Una gara `Da giocare` resta quindi `Da giocare`; una gara già `Giocata` resta `Giocata`; una gara `Live` resta `Live`.

I rigori e l’attivazione/disattivazione dello stato Live non sono considerati semplici informazioni organizzative: fanno parte del flusso sportivo e seguono le relative validazioni.

## Matrice dei comportamenti

| Stato e modifiche | Comportamento del salvataggio generale |
|---|---|
| Gara da giocare, nessuna modifica | Mostra **Referta 0-0** e richiede conferma esplicita prima di salvare 0-0 senza cartellini |
| Solo campo/arbitro/data/orario | Salva esclusivamente le informazioni; la gara non viene refertata |
| Solo cartellini, nessun marcatore | Salva la gara come `Giocata` con risultato 0-0 e cartellini presenti |
| Solo marcatori | Salva risultato ed eventi e porta la gara a `Giocata` |
| Marcatori e cartellini | Salva l’intero referto in un’unica operazione |
| Informazioni più marcatori/cartellini | Salva informazioni e referto insieme e porta la gara a `Giocata` |
| Attivazione Live | Rimane in bozza fino al salvataggio generale, poi avvia la gara Live |
| Modifiche a gara già Live | Aggiorna la gara mantenendola Live |
| Disattivazione Live | Conclude la gara tramite il salvataggio generale; se è completamente vuota richiede conferma 0-0 |
| Gara già giocata, sole informazioni | Aggiorna le informazioni senza alterare il referto definitivo |
| Gara già giocata, modifiche agli eventi | Aggiorna il referto mantenendo lo stato `Giocata` |
| Gara già giocata, rimozione di tutti gli eventi | Richiede conferma aggiuntiva prima di sostituire il referto con uno 0-0 vuoto |
| Eliminazione diretta in parità | Blocca il salvataggio definitivo finché non sono presenti rigori validi e non in parità |
| Partita con una squadra mancante/riposo | Marcatori e cartellini restano disabilitati; le sole informazioni possono essere salvate senza refertare |

## Conferma 0-0

La conferma è integrata nella card del salvataggio generale, non usa un messaggio generico del browser e riceve automaticamente il focus da tastiera.

Sono distinti due casi:

1. **Nuovo referto vuoto:** conferma la chiusura della gara sullo 0-0 senza cartellini.
2. **Referto definitivo svuotato:** avvisa che il referto esistente verrà sostituito da uno 0-0 senza marcatori, cartellini o rigori.

Annullando la conferma, nessun dato viene salvato. Se l’utente apre una sezione e modifica la bozza, la conferma precedente viene invalidata e il piano di salvataggio viene ricalcolato.

## Stato Live e stato visivo

La UI distingue ora lo stato persistito dalla variazione in bozza:

- `Da giocare` con eventi in bozza non viene più mostrato come `Giocata`;
- l’attivazione non ancora salvata mostra **Live in bozza**;
- la disattivazione di una gara Live non ancora salvata mostra **Chiusura Live in bozza**;
- soltanto dopo il salvataggio generale lo stato definitivo cambia realmente.

## Migliorie UI e accessibilità

- card di salvataggio centrata, con larghezza fluida e massimo di 720 px;
- pulsante principale centrato, largo al massimo 440 px e completamente responsive;
- nessun salvataggio nascosto o duplicato nelle sottosezioni;
- indicatori di bozza non basati esclusivamente sul colore;
- conferma 0-0 con `role="alertdialog"`, titolo e descrizione associati;
- focus automatico sul comando di conferma;
- messaggi di esito con `role="status"`;
- testi lunghi gestiti tramite wrapping;
- controlli e riepiloghi senza overflow orizzontale;
- elenco della ricerca chiuso dopo l’aggiunta di un evento, pur mantenendo il focus sul campo per un inserimento rapido.

## File modificati

- `assets/js/admin-matches.js`
  - gestione centralizzata delle bozze;
  - matrice del piano di salvataggio;
  - salvataggio separato delle sole informazioni;
  - conferme 0-0;
  - stato Live e stato visivo della bozza;
  - rimozione delle azioni definitive dalle sottosezioni;
  - gestione del focus e dei combobox.
- `assets/css/styles.css`
  - card del salvataggio generale;
  - riepiloghi e conferme;
  - badge e banner di bozza;
  - stato visivo “in bozza”;
  - responsive mobile/tablet/desktop.
- `admin-matches.html`
  - aggiornamento versionamento degli asset.
- `README.md`
  - documentazione del flusso V132.
- `package.json`
- `package-lock.json`
  - versione progetto `1.32.0`.
- `INTERVENTO_UI_GESTIONE_PARTITA_V132.md`
  - presente report.
- `dist/`
  - build statica rigenerata dai sorgenti aggiornati.

Non sono state necessarie modifiche al database, alla struttura degli eventi o alla logica centralizzata in `assets/js/store.js`.

## Test eseguiti

### Matrice funzionale — 112 asserzioni

Sono state verificate 30 combinazioni operative, tra cui:

- nessuna modifica e conferma 0-0;
- annullamento della conferma;
- sole informazioni su gara da giocare, Live e giocata;
- soli cartellini con risultato 0-0;
- gol normali e gol doppi;
- informazioni, marcatori e cartellini nella stessa bozza;
- aggiunta, rimozione e annullamento della rimozione;
- autogol;
- gol del presidente;
- avvio, aggiornamento e conclusione Live;
- modifica di referti definitivi;
- protezione dello svuotamento completo di un referto;
- eliminazione diretta 0-0 e con pareggio segnato;
- rigori mancanti, incompleti, uguali e validi;
- persistenza della bozza tra sezioni e riapertura della modale;
- annullamento di modifiche riportando il valore originale;
- invalidazione di una conferma 0-0 dopo una nuova modifica;
- partite con una squadra mancante;
- dati già salvati e normalizzati dal progetto.

### Responsive, accessibilità e compatibilità — 70 asserzioni

- viewport: 320, 360, 375, 390, 430, 667×375, 768, 1024, 1280, 1440 e 1600 px;
- menu principale, Info partita, Marcatori e Cartellini;
- assenza di overflow del documento, della modale e del corpo interno;
- pulsante generale sempre contenuto e centrato nella card;
- nessun pulsante di salvataggio nelle sottosezioni;
- nomi di squadre e giocatori molto lunghi;
- ricerca esatta della maglia `10` prima della maglia `100`;
- `Escape` chiude il solo elenco della ricerca senza chiudere la modale;
- modalità KINGS e non KINGS;
- campo gol doppi assente quando non previsto.

### Regressione del flusso partita — 67 asserzioni

- salvataggio delle informazioni senza referto;
- referto 0-0 esplicito;
- cartellini senza marcatori;
- marcatori e punteggio;
- combinazioni tra sezioni;
- fasi a eliminazione diretta;
- stato Live;
- gara già giocata;
- responsive e centratura del comando generale.

### Stato bozza e zoom — 7 asserzioni

- eventi in bozza non mostrati come gara già giocata;
- `Live in bozza`;
- `Chiusura Live in bozza`;
- stato persistito invariato prima del salvataggio;
- zoom al 125% e 150% senza overflow del salvataggio generale.

**Totale: 256/256 asserzioni browser superate.**

Sono stati inoltre controllati tre rendering visivi temporanei — desktop, smartphone e conferma 0-0 — senza includere screenshot o artefatti di test nel progetto finale.

## Validazione del progetto

- sintassi di `assets/js/admin-matches.js`: valida;
- validazione HTML/JavaScript del progetto: completata senza errori;
- build statica `dist/`: rigenerata e validata;
- file temporanei, script di test e screenshot: non inclusi nello ZIP finale.
