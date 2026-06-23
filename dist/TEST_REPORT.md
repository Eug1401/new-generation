# Test Report

## Eseguiti

| Suite | Totale | Superati | Falliti | Saltati |
| --- | ---: | ---: | ---: | ---: |
| Sintassi JS modificati via `vm.Script` | 6 | 6 | 0 | 0 |
| Test store calendario/share `tools/test-calendar-share.mjs` | 12 | 12 | 0 | 0 |
| Validazione progetto `tools/validate-project.mjs` | 2 | 2 | 0 | 0 |
| Build statica `tools/build-static.mjs` | 1 | 1 | 0 | 0 |

## Dettaglio verifiche

- `store.previewCalendar` genera una proposta senza mutare `matches`.
- `store.generateCalendar` salva solo su chiamata esplicita.
- `store.repairState` non rigenera piu il calendario.
- La partita fissata Team 1 vs Team 2 resta in `Girone A · Giornata 1`, Campo 1, ore 09:00.
- Un doppio uso della stessa squadra nella prima giornata blocca la preview.
- Il modulo `share-images.js` espone `window.NGShareImages`, usa canvas PNG e Web Share API.
- Il wizard di simulazione espone solo `groups_knockout` e `league_knockout`.
- Il wizard calendario ha salvataggio, recupero ed eliminazione bozza senza persistenza di partite.
- Il calendario personalizzato non fattibile restituisce conflitti strutturati e `SIMPLIFICATION_AVAILABLE`.
- Una preferenza di prima giornata incompatibile genera una proposta `SIMPLIFIED_SOLUTION` al livello 2.
- Un vincolo obbligatorio incompatibile resta bloccato con `NO_SOLUTION`.
- Campo 1 e Campo 2 sono equivalenti; se Campo 1 e bloccato il calendario usa Campo 2 senza warning/preferenze automatiche.
- Timeout ed errore tecnico sono distinti dall infattibilita.
- Le pagine `index.html`, `admin-rules.html`, `admin-groups.html` risolvono i riferimenti locali.
- `dist/` e stato rigenerato e validato.

## Non eseguiti

| Suite | Motivo |
| --- | --- |
| Browser visuale / E2E reale | Browser integrato bloccato da policy URL su `127.0.0.1:8788`, `localhost` e `file://`; non e stato aggirato. |
| Test Android/iOS reali | Dispositivi non disponibili nell'ambiente. |
| Test E2E UI completo | Il flusso e coperto da test store/build, ma l E2E visuale richiede browser locale accessibile; l'ambiente corrente blocca l'apertura del target statico. |

## Comandi consigliati

```bash
npm run test
npm run test:calendar-share
npm run build
```
