# File modificati — Configura e genera calendario

| File | Modifica | Motivazione |
| --- | --- | --- |
| `assets/js/store.js` | Validazione dei due vincoli, orario esatto, posizione complessiva della prima giornata, rigenerazione atomica e fallback controllato sul campo libero | Correggere il motore senza perdere o duplicare partite |
| `assets/js/admin-rules.js` | Riparazione dello step Vincoli, stato persistente del wizard, modifica/eliminazione, errori inline, navigazione e conferma esplicita | Completare il flusso Preferenze → Prima giornata → Vincoli → Anteprima |
| `assets/css/styles.css` | Stili coerenti per i due blocchi di vincoli, righe modificabili ed errori | Integrare la nuova UI nel design esistente |
| `tools/test-calendar-constraints.mjs` | Nuova suite con nove scenari funzionali | Coprire i requisiti richiesti e la rigenerazione completa |
| `tools/test-calendar-share.mjs` | Aggiornamento dei test legacy ai vincoli esatti e al fallback di campo | Evitare regressioni sul calendario manuale |
| `package.json` | Aggiunto `test:calendar` e incluso il nuovo test in `npm test` | Rendere la copertura eseguibile automaticamente |
| `CALENDAR_CUSTOMIZATION.md` | Documentazione aggiornata del flusso, modello dati e regola dei due campi | Eliminare riferimenti ai vincoli legacy |
| `CALENDAR_RULES_REFERENCE.md` | Riferimento aggiornato a priorità, ordinamento e conflitti | Documentare le regole effettive |
| `README.md` | Comandi di test e descrizione del wizard aggiornati | Allineare la guida al comportamento corrente |
| `IMPLEMENTATION_REPORT_CALENDAR_WIZARD.md` | Rapporto tecnico, cause, API interne e risultati dei test | Documentare la consegna |
