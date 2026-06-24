# Generazione ottimale del calendario

## Flusso di generazione

Il calendario viene configurato in `admin-rules.html` tramite un wizard di quattro passaggi:

1. Prerequisiti.
2. Prima giornata.
3. Vincoli obbligatori.
4. Anteprima.

Non esistono profili, seed, preferenze facoltative, generazioni casuali o proposte semplificate. La riduzione delle partite consecutive è sempre attiva e non può essere disabilitata.

`store.previewCalendar(state)` lavora su una copia completa dello stato. Il calendario salvato resta invariato durante tutta la ricerca e viene sostituito soltanto dopo il completamento con esito positivo e la conferma esplicita dell'utente.

## Modello dei vincoli

`rules.calendarCustomization` contiene soltanto:

```json
{
  "version": 4,
  "minRestMinutes": 0,
  "firstRoundLocks": [],
  "teamDebuts": []
}
```

Sono obbligatori:

- accoppiamenti, campi e orari fissati nella prima giornata;
- riposo minimo;
- orario esatto della prima partita di una squadra;
- tutti i prerequisiti strutturali del torneo.

Le vecchie proprietà `profile`, `seed` e `preferences` vengono ignorate durante la normalizzazione. Anche i vecchi tipi di vincolo non supportati vengono eliminati.

## Ricerca dell'ottimo globale

Per la fase a gironi disputata in un giorno, lo scheduler usa una ricerca esatta **branch and bound**. Non si ferma alla prima soluzione valida.

La ricerca:

- prova gli orizzonti temporali dal minimo teorico al primo orizzonte fattibile;
- enumera tutte le combinazioni rilevanti di partite e assegnazioni campo;
- applica memoization e pruning soltanto quando un ramo non può matematicamente migliorare la migliore soluzione completa già trovata;
- elimina configurazioni non valide per sovrapposizione, ordine delle giornate, riposo, prima giornata o orario di esordio;
- restituisce `optimality.provenOptimal = true` soltanto dopo avere concluso la ricerca necessaria.

L'ordine lessicografico dell'obiettivo è:

1. minimo numero di buchi interni riempibili;
2. minimo numero di squadre uniche con partite consecutive;
3. minimo numero totale di occorrenze consecutive;
4. minimo numero di sequenze di almeno tre partite consecutive;
5. distribuzione più equilibrata dei tempi di riposo.

Uno slot finale con un solo campo occupato è ammesso quando il numero complessivo di partite è dispari. Un campo non viene lasciato vuoto in uno slot interno quando esiste una partita valida collocabile.

## Definizione delle partite consecutive

Due incontri sono consecutivi quando la stessa squadra gioca in due slot temporali adiacenti. Il campo non influisce sul conteggio.

`calendarConsecutiveStats` restituisce almeno:

- `uniqueTeams`: squadre uniche coinvolte;
- `totalOccurrences`: coppie consecutive complessive;
- `teamNames`: nomi delle squadre coinvolte;
- `threePlusOccurrences`: prosecuzioni oltre la seconda partita consecutiva;
- `maxRun`: massima lunghezza di una serie.

## Campi dei gironi

Con `fixed_by_group`, ogni girone mantiene il proprio campo naturale. Il girone più grande può usare il campo rimasto libero soltanto quando:

- il proprio campo naturale è già occupato da un'altra sua partita nello stesso slot;
- il proprietario del campo prestato non ha una partita valida pronta;
- non vengono introdotte sovrapposizioni di squadra o campo.

## Fasi finali

Quando i placeholder della fase finale vengono risolti in squadre reali, `rebalanceResolvedKnockoutSchedule` esamina esattamente tutte le permutazioni ammesse degli incontri scambiabili dello stesso turno.

La scelta minimizza globalmente, nell'ordine, squadre uniche consecutive, occorrenze, sequenze di almeno tre, lunghezza massima della serie e squilibrio dei riposi. Una terza partita consecutiva viene quindi spostata automaticamente quando esiste uno scambio valido migliore.

## Esecuzione nell'interfaccia

La ricerca viene eseguita in `assets/js/calendar-worker.js`, fuori dal thread principale. Durante il calcolo:

- viene mostrato un indicatore di caricamento;
- il pulsante di generazione viene disabilitato;
- non possono partire due ricerche contemporanee;
- vengono mostrati orizzonte, nodi esaminati, pruning e migliore soluzione completa corrente;
- l'interfaccia resta reattiva.

Al termine vengono mostrati il numero di squadre uniche, le occorrenze complessive, i nomi coinvolti e la prova di ottimalità. Se il valore è zero viene mostrato il messaggio esplicito: “Nessuna squadra giocherà due partite consecutive.”
