# Test report

## Comandi eseguiti

- `node tools/test-calendar-share.mjs`
- `node tools/validate-project.mjs`
- `node tools/build-static.mjs`
- `node tools/test-ui-stability.mjs` tentato, non eseguibile: cerca `/usr/bin/chromium` su ambiente Windows.
- Controllo browser in-app su `http://127.0.0.1:4179/visual-bracket-check-http.html`.

## Copertura

| Area | Esito | Note |
| --- | --- | --- |
| Tabellone web | Automatico + visuale | Browser check: 3 card, 6 righe squadra, 2 turni, `overlaps: []`. |
| Loghi/fallback | Automatico + statico | Slot stabile e placeholder neutro per squadre non determinate. |
| PDF tabellone | Build | Pagina panoramica dinamica e card con spazi minimi. |
| Immagine tabellone | Statico | Canvas panoramico con card piu ampie e placeholder neutro. |
| Orario minimo esordio | Automatico | La prima partita della squadra non inizia prima dell'orario richiesto. |
| Posizione esordio | Automatico | La squadra occupa la posizione cronologica richiesta nella giornata 1. |
| Combinazione incompatibile | Automatico | Preview bloccata e nessuna partita salvata. |
| Rigenerazione globale | Automatico | Preview lavora su bozza e non persiste partite. |
| Infattibilita | Automatico | Conflitti strutturati e azioni di modifica/rimozione. |

## Artefatti visuali

- Screenshot controllo tabellone: `outputs/bracket-visual-check.png`.

## Non eseguiti nell'ambiente

- Verifica manuale browser a zoom 200%.
- Apertura reale del PDF in un viewer esterno.
- Stampa fisica.

Questi controlli richiedono browser/viewer interattivi esterni.
