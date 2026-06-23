# Shareable Images

## Contenuti esportabili

- Classifica generale nei tornei senza gironi e nella modalita Classifica unica + eliminazione diretta.
- Classifica di ogni singolo girone nella modalita Gironi + eliminazione diretta.
- Tabellone a eliminazione diretta completo, con formato panoramico dinamico.
- Singola partita dal dettaglio pubblico.

Le immagini sono disponibili solo nel sito pubblico. L'area admin mantiene i PDF report gia presenti e non espone azioni per generare immagini.

## Implementazione

- Modulo: `assets/js/share-images.js`.
- Integrazione pubblica: `assets/js/public.js` e `index.html`.
- Tecnica: canvas dedicato, non screenshot del DOM.
- Output: PNG tramite `canvas.toBlob`.
- Preview: modale accessibile con anteprima completa, pulsanti Condividi e Scarica.
- Condivisione: Web Share API con `File` reale quando `navigator.canShare({files})` e disponibile.
- Fallback: download automatico dell'immagine.

## Design system

Il layout condiviso usa:

- header con logo/identita torneo;
- titolo contenuto;
- sottotitolo fase/formato;
- area dati dedicata;
- legenda quando utile;
- footer con data di generazione e riferimento discreto.

I colori riprendono la palette oro/nero del sito, ma le immagini usano fondo chiaro per leggibilita su smartphone, chat e stampa.

## Loghi e nomi lunghi

I loghi sono disegnati in contenitori quadrati con `object-fit` manuale canvas. URL esterni non sicuri o non CORS-safe vengono sostituiti da placeholder con iniziali, evitando canvas contaminati e token esterni nelle immagini.

I nomi lunghi usano wrapping e riduzione controllata del font. Il troncamento non e usato come prima scelta.

## Formati

- Classifiche: 1080 px di larghezza, altezza dinamica, minimo 1350 px.
- Partita: 1080 x 1350 px.
- Tabellone: minimo 1920 px di larghezza, altezza e larghezza dinamiche in base a turni e card.

## Permessi e privacy

La generazione avviene lato browser usando lo stato pubblico gia visibile. Non vengono inclusi email, token, note admin o ID tecnici. Gli ID delle squadre restano solo nello stato applicativo e non sono stampati nell'immagine.

## Limiti conosciuti

- La verifica visuale automatica richiede un browser headless disponibile. In questo ambiente non e stato possibile avviare il plugin browser.
- La condivisione nativa dipende dal supporto del browser e del sistema operativo. In desktop non compatibili viene usato il download.
- Loghi remoti senza CORS vengono sostituiti dal placeholder per preservare il PNG esportabile.
