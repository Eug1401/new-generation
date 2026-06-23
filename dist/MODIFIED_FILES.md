# File modificati — Scheduler campi e vincolo d'esordio

| File | Modifica |
| --- | --- |
| `assets/js/store.js` | Scheduler a slot con priorità al campo naturale, fallback sul campo libero, dipendenze per squadra, audit del prestito, validazione e modello limitati all'orario esatto d'esordio |
| `assets/js/admin-rules.js` | Sezione Vincoli ridotta al solo orario d'esordio e testi aggiornati sulla gestione dei campi |
| `tools/test-calendar-constraints.mjs` | Suite di 10 scenari per campi, integrità, vincolo d'esordio, preferenze, prima giornata e rimozione dei vincoli legacy |
| `tools/test-calendar-share.mjs` | Regressioni integrate aggiornate al nuovo modello e al fallback corretto |
| `CALENDAR_CUSTOMIZATION.md` | Documentazione del modello e dello scheduler aggiornata |
| `CALENDAR_RULES_REFERENCE.md` | Priorità e condizioni del prestito del campo documentate |
| `README.md` | Descrizione del wizard e numero dei test aggiornati |
| `IMPLEMENTATION_REPORT_CALENDAR_WIZARD.md` | Rapporto precedente riallineato allo stato corrente |
| `IMPLEMENTATION_REPORT_SCHEDULER_FIELDS.md` | Rapporto tecnico della correzione corrente |
