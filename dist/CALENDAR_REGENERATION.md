# Rigenerazione calendario

Il calendario non viene corretto localmente su una singola partita. Ogni anteprima parte da una copia dello stato, svuota le partite e ricostruisce la fase iniziale completa.

Flusso:

1. modifica vincolo;
2. anteprima marcata obsoleta;
3. conferma disabilitata;
4. ricalcolo dell'intero calendario;
5. validazione globale;
6. nuova anteprima;
7. salvataggio solo dopo conferma.

## Dati invariati

Restano invariati torneo, formula, squadre, gironi, numero campi, durata, pause, criteri sportivi e blocchi espliciti.

## Dati ricalcolati

Vengono ricalcolati ordine partite, giornate, campi, orari, esordi e tabellone derivato.

## Atomicita

`previewCalendar` lavora su una bozza e non salva partite. `generateCalendar` sostituisce `state.matches` solo dopo scheduling e validazione riusciti.

Se la generazione fallisce, la bozza resta modificabile e il calendario precedente non viene eliminato.
