# Personalizzazione del calendario

## Flusso di generazione

Il calendario viene configurato nella pagina `admin-rules.html` tramite il wizard **Configura e genera calendario**:

1. Prerequisiti.
2. Preferenze.
3. Prima giornata.
4. Vincoli.
5. Anteprima.

`store.previewCalendar(state)` lavora su una copia dello stato e non modifica il calendario salvato. `store.generateCalendar(state)` viene eseguito soltanto dopo la conferma finale. Se esiste già un calendario, l'interfaccia richiede un consenso esplicito prima di sostituirlo.

## Stato temporaneo del wizard

La bozza locale `new-generation-calendar-draft-v1` conserva preferenze, configurazione della prima giornata e vincoli mentre l'utente si sposta avanti e indietro nel wizard.

L'avvio di una nuova configurazione azzera la bozza temporanea. Una generazione confermata ricostruisce tutte le partite da zero; non integra e non riordina parzialmente il calendario precedente.

## Vincolo supportato

La sezione **Vincoli** espone esclusivamente l'**orario d'esordio della squadra**.

La prima partita cronologica della squadra deve iniziare esattamente nell'orario selezionato. Gli orari proposti sono ricavati dalla data, dall'ora iniziale, dalla durata delle partite, dalla pausa e dal numero di campi configurati.

La struttura dati è memorizzata in `rules.calendarCustomization.teamDebuts`:

```json
[
  {
    "id": "constraint-id",
    "teamId": "team-id",
    "kind": "exactTime",
    "value": "10:40",
    "mode": "hard"
  }
]
```

Durante la normalizzazione vengono mantenute soltanto le regole `exactTime`. Tipi precedenti, indisponibilità squadra, blocchi campo ed eventi usati come vincoli non vengono caricati né applicati allo scheduler.

## Assegnazione dei campi ai gironi

Con la modalità `fixed_by_group`, ogni girone utilizza prioritariamente il proprio campo. Con due gironi e due campi, il Girone A usa normalmente il Campo 1 e il Girone B il Campo 2.

Per ogni fascia oraria lo scheduler opera in questo ordine:

1. applica le eventuali assegnazioni esplicite della sezione **Prima giornata**;
2. cerca una partita valida per il girone proprietario di ciascun campo;
3. soltanto sui campi rimasti liberi cerca una seconda partita pronta dell'altro girone;
4. consente il prestito solo se il campo naturale del girone che prende in prestito è già occupato da una sua partita nello stesso slot;
5. non usa il campo alternativo quando il girone proprietario ha una partita valida da disputare.

Una partita è considerata pronta quando entrambe le squadre hanno già completato le rispettive partite precedenti. Questo permette di utilizzare una partita di una giornata successiva quando è realmente compatibile, senza anticipare l'ordine delle giornate della singola squadra.

Restano sempre obbligatorie l'assenza di sovrapposizioni di squadra e campo, la durata degli incontri, gli slot disponibili, il riposo minimo configurato e l'unicità di ogni partita.

## Validazione

La validazione viene eseguita sia nel wizard sia nello store. Sono bloccanti, tra gli altri:

- squadra assente o non selezionata;
- più vincoli di esordio per la stessa squadra;
- orario non appartenente agli slot disponibili;
- richieste diverse per le due squadre della stessa prima partita;
- numero di esordi distinti nello stesso orario superiore ai campi disponibili;
- impossibilità di costruire un calendario completo.

In caso di errore non viene salvato alcun calendario parziale e la bozza resta disponibile per le correzioni.
