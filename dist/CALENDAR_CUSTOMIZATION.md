# Personalizzazione del calendario

## Flusso di generazione

Il calendario non viene creato durante il salvataggio delle regole, la modifica dei gironi, l'apertura delle pagine amministrative o la generazione di report.

La creazione avviene esclusivamente nella pagina `admin-rules.html` tramite il wizard **Configura e genera calendario**:

1. Prerequisiti.
2. Preferenze.
3. Prima giornata.
4. Vincoli.
5. Anteprima.

`store.previewCalendar(state)` lavora su una copia dello stato e non modifica il calendario salvato. `store.generateCalendar(state)` viene eseguito soltanto dopo la conferma finale. Se esiste già un calendario, l'interfaccia richiede un consenso esplicito prima di sostituirlo.

## Stato temporaneo del wizard

La bozza locale `new-generation-calendar-draft-v2` conserva preferenze, configurazione della prima giornata e vincoli mentre l'utente si sposta avanti e indietro nel wizard.

L'avvio di una nuova configurazione azzera la bozza e i vincoli temporanei. Una generazione confermata ricostruisce sempre tutte le partite da zero; non riordina né integra il calendario precedente.

## Vincoli supportati

La sezione **Vincoli** espone esclusivamente due regole obbligatorie:

### Orario d'esordio della squadra

La prima partita cronologica della squadra deve iniziare esattamente nell'orario selezionato. Gli orari disponibili sono ricavati dalle date, dalla fascia oraria, dalla durata delle partite e dal numero di campi configurati.

### Posizione nella prima giornata

La partita della squadra deve occupare la posizione richiesta nell'ordine cronologico complessivo della prima giornata. A parità di orario, l'ordinamento usa in modo deterministico campo, girone, coppia di squadre e identificativo della partita.

Le posizioni disponibili sono calcolate dal numero effettivo di partite della prima giornata.

## Modello dati

I vincoli sono memorizzati in `rules.calendarCustomization.teamDebuts`:

```json
[
  {
    "id": "constraint-id",
    "teamId": "team-id",
    "kind": "exactTime",
    "value": "10:40",
    "mode": "hard"
  },
  {
    "id": "constraint-id-2",
    "teamId": "team-id-2",
    "kind": "firstRoundPosition",
    "value": 3,
    "mode": "hard"
  }
]
```

I dati legacy `minTime`, `time`, indisponibilità squadra e blocchi campo vengono normalizzati: gli orari di esordio diventano `exactTime`, mentre i tipi non più esposti dal wizard non partecipano alla nuova configurazione.

## Assegnazione dei campi

Ogni girone mantiene come scelta predefinita il proprio campo. Con due gironi e due campi, il Girone A usa normalmente il Campo 1 e il Girone B il Campo 2.

Una partita può essere spostata temporaneamente sull'altro campo soltanto quando:

- il campo preferito è già occupato nello slot;
- il secondo campo è libero;
- il girone assegnato al secondo campo non ha una propria partita ancora da collocare nello stesso turno;
- nessuna squadra viene sovrapposta;
- riposo minimo, durata, date e orari restano validi.

Con gironi della stessa dimensione non vengono effettuati spostamenti. Con gironi di dimensione diversa, il campo libero può essere usato dal girone più grande solo negli slot altrimenti inutilizzati.

## Validazione

La validazione viene eseguita sia nell'interfaccia sia nello store prima della generazione. Sono bloccanti, tra gli altri:

- squadra inesistente o non selezionata;
- orario non disponibile;
- posizione fuori intervallo;
- vincoli duplicati per la stessa squadra;
- due partite diverse assegnate alla stessa posizione;
- richieste di orario incompatibili nella stessa partita;
- numero di esordi simultanei superiore ai campi disponibili;
- soluzione completa non trovata.

In caso di errore non viene salvato alcun calendario parziale e la bozza resta disponibile per le correzioni.
