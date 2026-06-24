# Rapporto implementazione scheduler ottimale

## Modifiche principali

- Sostituito il riempimento progressivo dei due gironi con ricerca esatta branch-and-bound.
- Introdotto confronto lessicografico: buchi interni, squadre uniche consecutive, occorrenze, serie di almeno tre, equilibrio riposi.
- Aggiunta prova tecnica dell'ottimo globale tramite `optimality.provenOptimal` e contatori della ricerca.
- Mantenuto il prestito controllato del campo libero tra gironi di dimensioni diverse.
- Aggiunto ribilanciamento esatto delle fasi finali quando i placeholder diventano squadre reali.
- Rimosse dalla logica e dalla UI preferenze opzionali, profili, seed, generazione alternativa e proposta semplificata.
- Spostato il calcolo in un Web Worker con stato di caricamento e avanzamento.
- Il calendario precedente viene sostituito soltanto dopo ricerca completata e conferma.

## File principali

- `assets/js/store.js`: algoritmo esatto, metriche, prova di ottimalità e ribilanciamento finali.
- `assets/js/calendar-worker.js`: esecuzione fuori dal thread UI.
- `assets/js/admin-rules.js`: wizard, avanzamento, risultati e conferma atomica.
- `assets/css/styles.css`: indicatore di caricamento e pannello metriche.
- `tools/test-calendar-constraints.mjs`: 14 scenari, inclusa enumerazione esaustiva indipendente e il caso di regressione con pausa/minimo riposo.
- `tools/test-optimal-scheduler-worker.mjs`: verifica in Chromium che la ricerca esatta venga eseguita nel Web Worker, comunichi il progresso e mantenga reattivo il thread principale.
- `tools/test-calendar-share.mjs`: regressioni del flusso manuale e rimozione delle preferenze.

## Test di ottimalità

Il test controllato con due gironi da quattro squadre genera indipendentemente tutti gli ordinamenti topologici validi, confronta tutte le combinazioni e calcola il vero minimo di squadre uniche e occorrenze consecutive. Il risultato viene confrontato con quello dello scheduler.

È inoltre presente un test per le fasi finali nel quale una squadra avrebbe tre incontri consecutivi: la permutazione esatta scambia automaticamente le semifinali e riduce la serie a due.
