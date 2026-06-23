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
# Modifiche prompt tabellone e vincoli esordio

| File | Modifica | Motivazione |
| --- | --- | --- |
| `assets/js/store.js` | Aggiunti vincoli `minTime` e `firstRoundPosition`, validazione, report `debutChecks`, scheduling che scarta slot prima dell'orario minimo e riordino prima giornata. | Applicare realmente i due vincoli nel motore autorevole. |
| `assets/js/admin-rules.js` | Wizard vincoli aggiornato, posizioni dinamiche, preview obsoleta e conferma disabilitata dopo modifiche. | Collegare UI, bozza, preview e conferma atomica. |
| `assets/js/ui.js` | Righe tabellone con struttura `logo | nome | risultato` e placeholder neutro. | Eliminare collisioni e integrare loghi reali/fallback. |
| `assets/css/styles.css` | Override layout tabellone e tabella controllo vincoli. | Prevenire sovrapposizioni su web, print e mobile. |
| `assets/js/admin-reports.js` | PDF tabellone con pagina panoramica dinamica e spazi card aumentati. | Mantenere il tabellone su una pagina leggibile per blocco. |
| `assets/js/share-images.js` | Export immagine tabellone con card piu grandi e placeholder neutro. | Coerenza tra web, PDF e immagine condivisibile. |
| `tools/test-calendar-share.mjs` | Test su orario minimo, posizione esordio e combinazione incompatibile. | Verifica automatica dei vincoli reali. |
| `BRACKET_LAYOUT.md` | Nuova documentazione layout tabellone. | Documentare web, PDF, immagine, loghi e fallback. |
| `DEBUT_CONSTRAINTS.md` | Nuova documentazione vincoli esordio. | Documentare definizione, dati, conflitti e report. |
| `CALENDAR_REGENERATION.md` | Nuova documentazione rigenerazione. | Documentare invalidazione, ricalcolo globale e atomicita. |
| `TEST_REPORT.md` | Report test aggiornato. | Tracciare verifiche eseguite e non eseguite. |
| `README.md` | Link alla nuova documentazione. | Rendere rintracciabili le nuove guide. |
