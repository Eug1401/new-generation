# Layout tabellone

Il tabellone usa lo stesso flusso dati per vista web, PDF amministratore e immagine condivisibile:

`NexoraStore.bracketData(state)` -> turni -> partite -> squadre/loghi -> rendering.

## Web

- Ogni riga squadra usa la struttura stabile `logo | nome | risultato`.
- Il logo ha uno slot fisso e usa `object-fit: contain` tramite le regole globali dei loghi squadra.
- Se la squadra non e ancora determinata viene mostrato un placeholder neutro `?`.
- I nomi lunghi possono andare su due righe senza invadere logo o risultato.
- Le linee del tabellone partono dal bordo della card e restano nel gap tra colonne.

## PDF

- Il PDF del tabellone usa una pagina panoramica dinamica.
- La dimensione minima resta A4 orizzontale, ma aumenta in base a numero di turni e partite.
- Ogni blocco di tabellone resta su una pagina.
- Le card hanno altezza minima, spazio logo e area risultato riservati.

## Immagine

- L'immagine condivisibile usa card piu ampie e placeholder neutro per squadre non determinate.
- Le linee sono disegnate prima delle card, quindi non attraversano testi o loghi.
- Il canvas cresce in larghezza e altezza in base al tabellone.

## Test

I controlli automatici verificano presenza del modulo immagini, export PNG via canvas e rendering tabellone con loghi/fallback nei sorgenti.
