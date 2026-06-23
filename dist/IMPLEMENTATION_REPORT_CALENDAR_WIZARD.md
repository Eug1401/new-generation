# Rapporto di intervento — Configura e genera calendario

Data verifica: 23 giugno 2026

## File modificati

- `assets/js/store.js`
- `assets/js/admin-rules.js`
- `assets/css/styles.css`
- `tools/test-calendar-share.mjs`
- `package.json`
- `CALENDAR_CUSTOMIZATION.md`
- `CALENDAR_RULES_REFERENCE.md`
- `README.md`
- `MODIFIED_FILES.md`

File aggiunti:

- `tools/test-calendar-constraints.mjs`
- `IMPLEMENTATION_REPORT_CALENDAR_WIZARD.md`

## Causa del malfunzionamento della sezione Vincoli

La sezione usava ancora un modello legacy che mescolava più tipi di regola non richiesti. L'orario d'esordio era interpretato come limite minimo anziché come orario esatto, mentre la posizione della prima giornata veniva calcolata separatamente per ogni girone. Mancava inoltre una validazione coerente prima del passaggio all'anteprima, con conseguenti valori nulli o incompatibili che potevano interrompere il flusso del wizard.

La navigazione è stata riallineata a uno stato unico della bozza: i valori restano disponibili passando avanti e indietro, il pulsante Avanti viene disabilitato in presenza di errori bloccanti e l'anteprima viene calcolata soltanto dopo una validazione completa.

## Modifiche al generatore

- Il calendario viene ricostruito integralmente a ogni conferma, senza riutilizzare identificativi o assegnazioni della generazione precedente.
- L'anteprima lavora su un clone e non modifica `matches` nello stato salvato.
- In presenza di un calendario esistente viene richiesta conferma esplicita prima della sostituzione.
- Ogni girone mantiene il proprio campo preferito.
- Un incontro può usare l'altro campo solo se questo sarebbe altrimenti libero e il girone proprietario non ha una partita ancora da collocare nello stesso turno.
- L'algoritmo impedisce sovrapposizioni, rispetta riposo minimo, durata, date e slot, e verifica che nessuna partita venga persa o duplicata.
- L'orario d'esordio viene applicato esattamente alla prima partita cronologica della squadra.
- La posizione della prima giornata viene applicata all'ordine cronologico complessivo di tutte le partite, con ordinamento deterministico per orario, campo, girone, coppia e identificativo.
- Se i vincoli non consentono una soluzione completa, la generazione viene bloccata e non produce un calendario parziale.

## Modello dati e API interne

I due vincoli sono conservati in `rules.calendarCustomization.teamDebuts`:

```js
{
  id,
  teamId,
  kind: "exactTime" | "firstRoundPosition",
  value: "HH:MM" | Number,
  mode: "hard"
}
```

Sono state esposte nello store le funzioni interne:

- `calendarAvailableTimes(state)`
- `firstRoundMatchCount(state)`
- `validateCalendarConstraintDefinitions(state, matches)`

Non è stata introdotta una nuova API remota: il progetto gestisce questa funzionalità nello store applicativo locale. La validazione viene comunque eseguita sia dalla UI sia dal livello di business/store, evitando che dipenda soltanto dagli elementi visivi della pagina.

## Test eseguiti

| Comando/scenario | Risultato |
| --- | --- |
| `npm test` — validazione progetto + 9 scenari calendario | Superato |
| Due gironi della stessa dimensione, ciascuno sul proprio campo | Superato |
| Gironi 5+4, uso dell'altro campo soltanto negli slot liberi | Superato |
| Presenza di tutte le partite, senza duplicati | Superato |
| Orario esatto della prima partita della squadra | Superato |
| Posizione complessiva nella prima giornata | Superato |
| Più vincoli compatibili | Superato |
| Vincoli incompatibili con errore bloccante | Superato |
| Navigazione e persistenza temporanea del wizard | Superato |
| Anteprima non persistente | Superato |
| Rigenerazione completa senza residui precedenti | Superato |
| `npm run test:calendar-share` | Superato |
| `npm run test:photos` | Superato, 12/12 |
| `npm run lint` | Superato, 0 errori e 0 avvisi |
| `npm run test:edge` | Superato, controllo TypeScript Edge Function |
| `npm run build` | Superato, validazione sorgenti e `dist` |

## Test legacy già non funzionanti nel progetto originale

I comandi `npm run test:ui` e `npm run test:simulation` risultavano già non superati nel file ZIP originale: cercano formati/input legacy (`knockout`, `league`) che non sono presenti nei selettori attuali. Le modifiche al calendario non hanno introdotto queste anomalie e non hanno modificato i relativi flussi.
