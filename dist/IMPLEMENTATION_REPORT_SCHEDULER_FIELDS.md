# Rapporto tecnico — Correzione scheduler su due campi

Data verifica: 23 giugno 2026

## Causa precisa del malfunzionamento

Il progetto conteneva già un tentativo di fallback sul campo alternativo, ma veniva eseguito dentro la pianificazione di una singola giornata (`roundIndex`). La ricerca considerava soltanto le partite ancora pendenti di quel turno e, al termine, avanzava definitivamente `earliestSlot`.

Questo produceva due effetti:

1. uno slot rimasto vuoto non veniva più riesaminato;
2. una partita valida di una giornata successiva non poteva essere considerata, anche quando entrambe le squadre avevano già completato le proprie partite precedenti.

Inoltre, il controllo d'integrità considerava automaticamente errata qualsiasi partita disputata fuori dal campo naturale, quindi avrebbe segnalato anche un prestito valido.

## Logica corretta introdotta

Le partite della fase a gironi con mappatura fissa vengono ora pianificate come un'unica unità a slot.

Per ciascuno slot:

1. vengono applicati eventuali campo/orario fissati nella sezione **Prima giornata**;
2. ogni campo cerca prima una partita pronta del proprio girone;
3. per ogni campo ancora libero viene cercata una partita pronta dell'altro girone;
4. il prestito è ammesso solo se il campo naturale del girone ospite è già occupato da un'altra sua partita nello stesso slot;
5. il prestito non viene eseguito se il girone proprietario ha una partita valida.

La prontezza è basata su dipendenze per squadra: ciascuna partita richiede che le partite precedenti di entrambe le squadre siano già state programmate. Questo conserva l'ordine sportivo delle singole squadre pur consentendo di usare slot prima inutilizzati.

Sono mantenute le verifiche su:

- unicità della partita;
- unicità del campo nello slot;
- assenza di contemporaneità per una squadra;
- durata, pausa, date e orari;
- riposo minimo;
- campo/orario espliciti della prima giornata;
- orario esatto d'esordio.

L'audit accetta un campo alternativo soltanto se rispetta le stesse condizioni del fallback oppure se deriva da un campo esplicitamente fissato nella prima giornata.

## Sezione Vincoli

Sono stati rimossi da interfaccia, stato operativo, validazioni e scheduler tutti i tipi di vincolo diversi dall'orario d'esordio.

Il modello corrente è:

```js
{
  id: "...",
  teamId: "...",
  kind: "exactTime",
  value: "HH:MM",
  mode: "hard"
}
```

Le chiavi legacy vengono scartate dalla normalizzazione per impedire che bozze o stati precedenti influenzino il calendario. Il progetto non possiede un backend remoto per la generazione: il livello di business è `assets/js/store.js`, quindi non è stato necessario modificare API server.

## File modificati

- `assets/js/store.js`
- `assets/js/admin-rules.js`
- `tools/test-calendar-constraints.mjs`
- `tools/test-calendar-share.mjs`
- `CALENDAR_CUSTOMIZATION.md`
- `CALENDAR_RULES_REFERENCE.md`
- `README.md`
- `MODIFIED_FILES.md`
- `IMPLEMENTATION_REPORT_CALENDAR_WIZARD.md`
- `IMPLEMENTATION_REPORT_SCHEDULER_FIELDS.md`

## Test dedicati

La suite `tools/test-calendar-constraints.mjs` verifica 10 scenari:

1. gironi uguali sempre sui campi naturali;
2. gironi diversi con utilizzo del campo libero;
3. riempimento di uno slot con una partita pronta di giornata successiva;
4. mancato prestito quando il proprietario ha una partita pronta;
5. orario esatto d'esordio;
6. vincoli di esordio incompatibili;
7. riposo minimo, preferenze e configurazione della prima giornata;
8. eliminazione e ininfluenza dei vincoli legacy;
9. UI Vincoli limitata all'orario d'esordio, con Preferenze e Prima giornata presenti;
10. anteprima non persistente e rigenerazione completa.

La suite controlla inoltre numero totale degli incontri, coppie uniche, occupazione univoca dei campi, assenza di squadre contemporanee e ordine delle partite per squadra.

I risultati finali dei comandi di progetto vengono registrati dopo la build conclusiva.

## Risultati finali

| Verifica | Risultato |
| --- | --- |
| `npm test` | Superato: validatore progetto senza errori/avvisi e 10 scenari calendario |
| `npm run lint` | Superato: 0 errori, 0 avvisi |
| `npm run test:calendar-share` | Superato: regressioni calendario, anteprima, prima giornata, vincolo esatto e fallback |
| `npm run test:photos` | Superato: 12/12 |
| `npm run test:edge` | Superato: controllo TypeScript della Edge Function |
| Matrice supplementare gironi da 2 a 6 squadre, 25 combinazioni | Superata: tutte le partite presenti, nessun duplicato o conflitto; nessun prestito con gironi uguali |
| `npm run build` | Superato: sorgenti e cartella `dist` validate senza errori o avvisi |

I test legacy `npm run test:ui` e `npm run test:simulation` continuano a fallire perché cercano i formati rimossi `knockout` e `league` nella simulazione. Lo stesso disallineamento era già documentato nel progetto ricevuto e non riguarda lo scheduler o il wizard calendario modificati.
