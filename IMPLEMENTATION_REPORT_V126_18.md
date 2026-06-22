# Rinnovo UI Articoli e Foto admin — v126.18

## 1. Analisi del codice preesistente

Il progetto è un'applicazione web statica composta da **HTML, CSS e JavaScript vanilla**, senza framework UI. La UI è renderizzata in parte nei file HTML e in parte tramite moduli globali JavaScript:

- `assets/js/ui.js`: rendering pubblico, incluse lista e dettaglio degli articoli;
- `assets/js/admin-photos.js`: rendering e interazioni della sezione amministrativa Foto;
- `assets/js/photos.js`: accesso al backend Foto e gestione dei dati;
- `assets/css/styles.css`: unico foglio stile condiviso, con variabili e componenti grafici globali;
- `assets/js/store.js`: stato e normalizzazione dei dati.

Sono stati riutilizzati il tema scuro esistente, le variabili grafiche, i componenti `card`, `pill`, `btn`, i modali e le API già disponibili. Non sono stati modificati endpoint, payload, formati dei dati o contratti di `NexoraPhotos`.

## 2. File sorgente modificati

| File | Intervento |
|---|---|
| `admin-photos.html` | Nuova struttura semantica e responsive della sezione Foto, con sidebar squadre, area upload, anteprima/stati ed elenco immagini separati. |
| `assets/css/styles.css` | Consolidamento CSS Articoli; nuova griglia hero; wrapping sicuro; layout e card Foto responsive; touch target; eliminazione di override duplicati. |
| `assets/js/ui.js` | Nuova struttura del dettaglio articolo, metadati etichettati e gestione selettiva delle sole stringhe senza spazi realmente lunghe. |
| `assets/js/admin-photos.js` | Nuovo rendering delle card Foto; separazione media/informazioni/azioni; riconoscimento loghi; alt; copia URL; accessibilità drag-and-drop. |
| `index.html` | Aggiornamento delle versioni cache-busting per CSS e modulo UI. |
| `tools/test-ui-stability.mjs` | Aggiunta larghezza 430 px, test di accettazione dedicato e stabilizzazione del controllo asincrono sul ritorno del focus. |

Il comando di build ha rigenerato le copie corrispondenti in `dist/`:

- `dist/admin-photos.html`
- `dist/index.html`
- `dist/assets/css/styles.css`
- `dist/assets/js/admin-photos.js`
- `dist/assets/js/ui.js`

## 3. Dettaglio articolo

### Struttura

L'hero usa ora una griglia desktop con:

- colonna principale `minmax(0, 1fr)` per categoria, titolo e sottotitolo;
- colonna secondaria controllata `minmax(220px, 280px)` per autore, data, tempo di lettura e stato;
- `min-width: 0` su tutti i nodi grid/flex coinvolti;
- passaggio a una colonna sotto 860 px;
- disposizione completamente verticale su mobile.

### Titolo e contenuti lunghi

Il titolo usa:

```css
word-break: normal;
overflow-wrap: normal;
hyphens: none;
font-size: clamp(2.35rem, 5.15vw, 5.45rem);
```

Solo quando JavaScript rileva un token senza spazi superiore a 28 caratteri viene aggiunta la classe `article-title-has-long-token`, che abilita `overflow-wrap: break-word`. In questo modo parole normali come **“Campioni!”** non vengono mai spezzate, mentre identificatori o URL eccezionalmente lunghi non generano scroll orizzontale.

La stessa strategia di contenimento è applicata a sottotitolo, corpo, didascalie, tag, link, codice, immagini, tabelle e blocchi `pre`.

### Metadati

Autore, data, data di aggiornamento quando diversa, tempo di lettura e stato sono presentati come righe etichettate. La categoria rimane un badge coerente con il tema esistente.

## 4. Sezione amministrativa Foto

### Nuovo layout

La pagina è divisa semanticamente in:

1. selezione squadra;
2. intestazione con logo e informazioni della squadra in celle distinte;
3. area di caricamento accessibile;
4. anteprima/stato del batch;
5. libreria di immagini;
6. card con media, dati e azioni separati.

Nessun testo o pulsante è posizionato sopra l'immagine, ad eccezione degli stati espliciti di caricamento/errore già progettati come overlay.

### Card immagini

Ogni card contiene:

- anteprima con rapporto controllato;
- `object-fit: contain` per loghi/stemmi/marchi;
- `object-fit: cover` per fotografie;
- titolo e tipo media;
- descrizione;
- dati file in un `dl` semantico;
- URL con ellissi e valore completo nel `title`;
- azioni: Anteprima, Seleziona, Modifica, Sostituisci, Copia URL, Scarica, Elimina.

L'eliminazione continua a usare la conferma esistente. Upload, sostituzione, modifica metadati, download, selezione multipla e lightbox mantengono le funzioni e le API preesistenti.

### Accessibilità

- `alt` derivato da `altText`, titolo, nome file o contesto squadra;
- dropzone con `role="button"`, `tabindex="0"`, Enter e Spazio;
- pulsanti con area effettiva minima di 44 px, 46 px su mobile;
- gruppi di azioni con etichetta ARIA;
- stati vuoto, caricamento, errore e completamento annunciati con regioni live;
- focus visibile e nessuna dipendenza dal solo puntatore.

## 5. CSS duplicato rimosso

Sono stati rimossi e sostituiti da un solo blocco consolidato `v126.18 · UI Articoli + Foto admin`:

1. il precedente blocco editoriale Articoli inserito nella sezione v126.16;
2. il blocco completo `v126.17 · Dettaglio articolo editoriale`;
3. il correttivo `v126.17.1 · Neutralizza la vecchia griglia del media`.

Le regole generiche della galleria Foto pubblica non sono state eliminate perché ancora utilizzate. Le nuove regole amministrative sono circoscritte a selettori come `.photo-admin-card`, `.photos-admin-layout` e `.photo-card-actions`, evitando duplicazioni e regressioni sulla galleria pubblica.

## 6. Breakpoint verificati

Test di accettazione dedicati eseguiti a:

- 320 px
- 375 px
- 430 px
- 768 px
- 1024 px
- 1280 px
- 1440 px

La suite generale verifica inoltre 360, 390, 412, 480 e 1920 px. Il requisito “1440 px e superiori” è quindi coperto anche a 1920 px.

Per ciascuna larghezza richiesta sono stati verificati:

- nessuna parola normale spezzata nel mezzo;
- “Campioni!” su una sola unità di riga;
- nessuna sovrapposizione tra heading e metadati;
- nessun overflow orizzontale di pagina, modale, corpo articolo o card Foto;
- logo e testo non sovrapposti;
- media precedente e separato da contenuto/azioni;
- `contain` per il logo;
- azioni presenti e touch target di almeno 44 px;
- card singola per riga su mobile.

## 7. Test eseguiti

| Comando | Esito |
|---|---|
| `npm test` | PASS — 0 errori, 0 warning |
| `npm run test:ui` | PASS — 13 pagine, responsive, modali, Foto, nessun errore JS/rete locale |
| `npm run test:articles` | PASS — flusso pubblico/admin completo |
| `npm run test:photos` | PASS — 12/12 test |
| `npm run test:edge` | PASS — type-check Edge Function |
| `node tools/test-ui-stability.mjs --acceptance-only` | PASS — criteri Articoli/Foto alle sette larghezze richieste |
| `npm run build` | PASS — build `dist/`, 0 errori e 0 warning |

I log completi sono nella cartella `reports/`.

## 8. Codice completo delle modifiche

Il file `CHANGESET_V126_18.patch` contiene il **diff unificato completo**, senza pseudocodice, di tutte le parti sorgente modificate. L'archivio del progetto contiene inoltre i file finali completi e la build `dist/` aggiornata.
