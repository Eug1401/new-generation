# Calendar Customization

## Nuovo flusso

Il calendario non viene piu creato durante:

- salvataggio regole;
- modifica gironi;
- normalizzazione o riparazione dello stato;
- apertura delle pagine admin;
- generazione PDF/report.

Il calendario viene creato solo in `admin-rules.html`, premendo `Configura e genera calendario`, analizzando la fattibilita e confermando `Conferma e crea calendario`.

## Stati operativi

- Calendario non ancora generato: lo stato contiene regole, squadre, gironi e configurazione, ma `matches` e vuoto.
- Anteprima: `store.previewCalendar(state)` genera una copia non persistente.
- Calendario generato: `store.generateCalendar(state)` viene chiamato solo alla conferma finale.
- Calendario da rivedere: se regole/squadre/gironi cambiano, `calendarSignature` viene invalidata senza rigenerare partite.
- Calendario non fattibile: lo store restituisce `SIMPLIFICATION_AVAILABLE`, `NO_SOLUTION`, `TIMEOUT` o `TECHNICAL_ERROR` con conflitti strutturati.
- Calendario semplificato: `store.previewSimplifiedCalendar(state)` prova livelli progressivi e restituisce `SIMPLIFIED_SOLUTION` senza salvare partite.

## Wizard

Il wizard contiene:

1. Prerequisiti.
2. Preferenze e profilo.
3. Prima giornata personalizzabile.
4. Vincoli base.
5. Analisi di fattibilita e anteprima.

Il wizard salva una bozza locale (`new-generation-calendar-draft-v1`) con preferenze e vincoli. La bozza puo essere recuperata riaprendo il wizard, modificata, salvata di nuovo o eliminata. La bozza non crea partite e viene rimossa dopo una generazione confermata con successo.

## Regole implementate

- Accoppiamenti fissati nella prima giornata.
- Campo e orario richiesti per una partita fissata.
- Indisponibilita squadra per data/ora.
- Blocchi campo per data/ora.
- Riposo minimo obbligatorio nei tornei in un giorno.
- Esordio in prima giornata, giornata esatta, non prima di una giornata, entro una giornata, campo, orario o avversaria.
- Seed variante per generare una proposta diversa in modo riproducibile.
- Validazione conflitti rigidi prima del salvataggio.
- Pannello di infattibilita con conflitti, suggerimenti, azioni di modifica e bozza conservata.
- Semplificazione a livelli: preferenze secondarie, preferenze principali, calendario essenziale.
- Campo 1 e Campo 2 sono equivalenti: non esiste una preferenza automatica per Campo 1.

## Semplificazione

La generazione semplificata rilassa solo preferenze e mai regole obbligatorie. I livelli vengono provati in ordine:

1. Rilassa bilanciamento perfetto, attese e preferenze sui consecutivi.
2. Rilassa accoppiamenti ed esordi indicati come preferiti.
3. Rimuove seed/ordine preferenziale e usa il calendario essenziale.

Se restano conflitti hard, il risultato e `NO_SOLUTION`: il wizard non elimina vincoli obbligatori e permette di trasformare o rimuovere manualmente solo le regole modificabili.

## Backend/store

Il progetto e statico, quindi il backend applicativo e lo store locale/Supabase:

- `rules.calendarCustomization` contiene le regole.
- `previewCalendar` lavora su clone e non salva.
- `generateCalendar` valida i vincoli prima di mutare `matches`.
- `repairState` non chiama piu `ensureFreshCalendar`.
- `admin-groups.js` salva solo `groupAssignments`.

## Modalita supportate nel flusso admin

- Gironi + eliminazione diretta.
- Classifica unica + eliminazione diretta (`league_knockout`).

I formati legacy restano nel motore store per compatibilita con dati esistenti, ma non sono esposti nel select admin principale ne nel wizard di simulazione.

## Limiti conosciuti

- Non e stato introdotto un solver CP-SAT esterno: la soluzione resta deterministica e leggera, coerente con una app statica.
- Le preferenze sono valutate e riportate, ma non tutte vengono ottimizzate globalmente.
- L'anteprima si modifica tornando agli step precedenti del wizard; non e stato aggiunto drag/drop diretto sulla lista anteprima.
