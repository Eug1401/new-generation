# Modified Files

| File | Modifica | Motivazione |
| --- | --- | --- |
| `assets/js/store.js` | Aggiunta configurazione calendario, preview non persistente, vincoli, infattibilita strutturata e semplificazione progressiva | Generazione manuale, personalizzabile e recuperabile |
| `assets/js/admin-rules.js` | Nuovo wizard calendario manuale con bozza locale, pannello infattibilita e proposta semplificata | Preview, fattibilita, conferma esplicita, recupero/eliminazione bozza |
| `admin-rules.html` | Testi e formati admin aggiornati | Flusso manuale e due modalita richieste |
| `assets/js/admin-groups.js` | Rimosso `generateCalendar` da applicazione gironi | Nessuna generazione automatica |
| `admin-groups.html` | Testi e pulsante aggiornati | Chiarezza su salvataggio assegnazioni |
| `assets/js/admin-simulation.js` | Limitati i formati simulazione a `groups_knockout` e `league_knockout` | Coerenza con supporto esclusivo richiesto |
| `assets/js/share-images.js` | Nuovo generatore canvas PNG | Export/condivisione immagini pubbliche |
| `assets/js/public.js` | Azioni export classifica/tabellone e partita delegata al nuovo modulo | Sistema immagini unico |
| `index.html` | Aggiunti contenitori azioni e script `share-images.js` | Esportazione pubblica per non admin |
| `assets/css/styles.css` | Stili preview immagini e wizard | UI mobile/accessibile |
| `tools/test-calendar-share.mjs` | Test calendario manuale/share/infattibilita | Copertura regressioni |
| `package.json` | Script `test:calendar-share` | Esecuzione test dedicato |
| `README.md` | Sezione calendario/condivisione e test dedicato | Documentazione utente/progetto |
| `SHAREABLE_IMAGES.md` | Nuova documentazione | Prompt immagini |
| `CALENDAR_CUSTOMIZATION.md` | Nuova documentazione | Prompt calendario |
| `CALENDAR_INFEASIBLE_HANDLING.md` | Nuova documentazione | Gestione calendario non fattibile e semplificato |
| `CALENDAR_RULES_REFERENCE.md` | Nuova documentazione | Riferimento regole |
| `ONLINE_RESEARCH_CALENDAR.md` | Nuova documentazione | Ricerca online |
| `TEST_REPORT.md` | Nuova documentazione | Risultati test |
