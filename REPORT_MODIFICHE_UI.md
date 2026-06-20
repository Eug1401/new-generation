# REPORT MODIFICHE UI

## 1. Riepilogo generale

Il progetto è stato analizzato come applicazione statica multipagina composta da **13 pagine HTML**, un foglio di stile globale e moduli JavaScript vanilla. Non sono presenti framework frontend, CSS Modules, styled components o librerie UI runtime. Il routing è basato su pagine HTML separate; lo stato applicativo e lo stato dei componenti interattivi sono gestiti direttamente tramite DOM, classi CSS, `localStorage` e moduli JavaScript. La sincronizzazione remota opzionale usa Supabase; le immagini possono usare Cloudinary.

L’analisi ha coperto:

- tutte le pagine pubbliche e amministrative;
- pulsanti normali, submit e loading;
- menu mobile, pannelli filtro e modali pubbliche;
- modali di reset e simulazione;
- finestre di conferma e lightbox foto;
- focus, tastiera, backdrop, scroll lock e ripristino del focus;
- transizioni, overlay, stacking e montaggio/smontaggio;
- responsive design e overflow orizzontale;
- caricamento delle risorse locali e stabilità della console;
- script di build, lint e validazione già presenti nel progetto.

Le cause principali degli sfarfallii e delle instabilità erano tecniche e distribuite: selettori incompleti nel controller condiviso, più gestori `Escape` per lo stesso componente, listener globali non rimossi, blocco scroll frammentato, compensazione della scrollbar applicata due volte, click sul backdrop non gestiti, sostituzione dimensionale del contenuto dei pulsanti durante il loading e transizioni non uniformi.

L’intervento ha introdotto una sola infrastruttura condivisa per overlay, focus, tastiera e scroll; ha reso idempotenti le chiusure; ha stabilizzato i pulsanti loading; ha uniformato le animazioni a `opacity` e `transform`; ha eliminato listener e classi globali concorrenti; e ha aggiunto una suite browser ripetibile con Chromium headless.

Il risultato verificato è che tutti i controlli statici, la build e i test browser descritti nella sezione **Test eseguiti** terminano con esito positivo. La verifica automatizzata non sostituisce una valutazione estetica umana, ma conferma concretamente le proprietà misurabili riportate in questo documento.

## 2. Architettura e tecnologie individuate

| Area | Risultato dell’analisi |
|---|---|
| Framework frontend | Nessuno; HTML, CSS e JavaScript vanilla |
| Pagine e routing | 13 documenti HTML con navigazione multipagina |
| Stato | Stato DOM, moduli JavaScript, `localStorage`; sincronizzazione Supabase opzionale |
| Stili | Un foglio globale principale: `assets/css/styles.css` |
| Componenti condivisi | Controller accessibilità/UI in `assets/js/ux-a11y.js`; logica comune admin in `admin-common.js`; logica pubblica in `public.js` |
| Overlay e portal | Overlay nel DOM della pagina; nessun sistema portal di framework |
| Risorse esterne | Supabase, Cloudinary e font/icone caricati dal frontend dove configurati |
| Lazy loading / skeleton | Gestione manuale; nessun framework Suspense |
| Animazioni | Classi CSS e Web Animations API per la chiusura della conferma foto |
| Test disponibili | Validatore statico, lint, build statica; aggiunta suite browser Chromium headless |
| `transition: all` | Nessuna occorrenza rilevata nel CSS finale |

## 3. Errori trovati

| ID | Pagina o componente | Errore trovato | Causa tecnica | Gravità | Impatto |
|---|---|---|---|---|---|
| UI-001 | Lightbox amministrazione foto | Lightbox non incluso nel controller condiviso | Il selettore cercava `.photo-lightbox`, mentre il componente reale usa `.photos-lightbox` | Alta | Focus, Escape e scroll lock non erano coordinati con gli altri overlay |
| UI-002 | Modali e lightbox | Chiusure duplicate o concorrenti tramite Escape | Gestori `keydown` locali convivevano con il gestore condiviso | Alta | Una singola pressione poteva attivare più callback e produrre stati intermedi |
| UI-003 | Conferma eliminazione foto | Listener globali e conferme ripetibili | Ogni apertura registrava listener globali; anche `Enter` poteva confermare globalmente | Alta | Rischio di callback multiple, doppia azione e listener residui |
| UI-004 | Reset, simulazione, lightbox e menu | Blocco scroll frammentato | Classi e modifiche dirette a `body.style.overflow` erano gestite da più file | Alta | Scroll sbloccato troppo presto o lasciato bloccato quando più overlay si sovrapponevano |
| UI-005 | Tutte le modali | Ripristino del focus non sempre deterministico | Il trigger veniva ripristinato solo in alcune condizioni locali e con timer separati | Media | Focus perso o spostato su elementi non coerenti dopo la chiusura |
| UI-006 | Pulsanti download, submit, reset, simulazione e login | Larghezza variabile e click multipli durante loading | Il testo veniva sostituito senza riservare lo spazio originale e senza stato busy condiviso | Alta | Spostamento dei controlli vicini e possibili operazioni duplicate |
| UI-007 | Apertura modali su desktop | Spostamento laterale misurato di 10 px | La compensazione manuale della scrollbar si sommava a `scrollbar-gutter: stable` | Alta | Header e pulsanti cambiavano posizione durante apertura/chiusura |
| UI-008 | Menu mobile, filtri e modali pubbliche | Click sul backdrop non chiudeva o seguiva percorsi diversi | Il backdrop non era collegato alla stessa funzione di chiusura del pulsante | Media | Interazione incoerente e maggiore rischio di overlay residui |
| UI-009 | Modali basate su `.card` | Movimento del contenuto al passaggio del mouse | Lo stile hover generico delle card poteva applicare trasformazioni anche alle card modali | Media | Contenuto modale apparentemente instabile durante l’interazione |
| UI-010 | Messaggi di stato | Animazione ripetuta a ogni aggiornamento | La classe condivisa dei messaggi riavviava l’animazione quando il contenuto cambiava | Bassa | Lampeggio dei feedback di errore/successo |
| UI-011 | Overlay sovrapposti | Overlay attivo scelto solo per ordine DOM | Il controller non confrontava lo `z-index` effettivo | Alta | Escape e focus potevano agire su un overlay visivamente sottostante |
| UI-012 | Lightbox pubbliche e amministrative | Un componente poteva sbloccare il body di un altro | Ogni lightbox impostava e ripristinava direttamente `overflow` | Alta | Scroll del contenuto sottostante riattivato con un altro overlay ancora aperto |
| UI-013 | Modali amministrative | Entrata/uscita non uniforme | Transizioni distribuite e non sempre sincronizzate tra backdrop e contenuto | Media | Animazioni percepite come irregolari tra componenti simili |

## 4. Pulsanti e componenti apribili

| ID | Componente | Interazione | Sfarfallio o errore | Causa tecnica | Modifica applicata | Risultato del test |
|---|---|---|---|---|---|---|
| UI-001 | Lightbox foto admin | Apertura, Escape, backdrop, frecce | Stato non coordinato e scroll/focus non centralizzati | Classe reale esclusa dal selettore condiviso | Aggiunta `.photos-lightbox`; chiusura instradata dal controller condiviso | 10 cicli, Escape, backdrop e frecce superati; un solo lightbox riutilizzato; body sbloccato alla fine |
| UI-002 | Tutte le modali testate | Escape ripetuto | Possibile doppia chiusura | Listener locali e globale contemporanei | Rimossi i listener Escape duplicati; il controller chiude solo l’overlay superiore | Reset, simulazione, menu mobile, filtri, modali pubbliche e lightbox superano Escape senza residui |
| UI-003 | Conferma eliminazione foto | Doppio click, chiusura, conferma | Possibili istanze e callback multiple | Listener globali per ogni apertura e assenza di guardia idempotente | Guardia singola istanza, funzione di chiusura idempotente, rimozione al termine reale dell’animazione | Doppio click produce una sola istanza; 10 cicli e backdrop superati; 0 nodi residui |
| UI-004 | Reset e simulazione | Apertura/chiusura ripetuta | Scroll lock non condiviso | Le modali non partecipavano a un contatore/stato globale | Inclusione nel controller unico e ripristino esatto degli stili inline precedenti | Scroll reset preservato 240→240; body sbloccato; focus restituito ai trigger |
| UI-005 | Trigger di overlay | Chiusura tramite pulsante, Escape o backdrop | Focus non sempre ritornava all’apertura | Timer e restore locali | Memorizzazione del trigger in `WeakMap`, focus programmato con `requestAnimationFrame`, gestione overlay sovrapposti | Focus ripristinato nei test reset, simulazione e menu mobile |
| UI-006 | Pulsanti loading | Click ripetuto e cambio etichetta | Variazione della larghezza e operazioni duplicate | Sostituzione del contenuto senza dimensioni minime | API `setButtonBusy`: misura iniziale, `min-width`/`min-height`, contenuto originale invisibile ma presente, layer spinner sovrapposto, `disabled` e `aria-busy` | 74,921875×44 prima; 75×44 durante; 74,921875×44 dopo; secondo ingresso busy rifiutato |
| UI-007 | Modale reset | Apertura desktop | Header e pulsante traslavano di 10 px | Compensazione scrollbar duplicata con gutter stabile | Rilevamento di `scrollbar-gutter: stable`; padding aggiunto solo quando necessario | Geometria identica prima/aperta/dopo: header x=14, w=1242; pulsante x=1164,078125, w=74,921875 |
| UI-008 | Menu mobile, filtri, match, team e articoli | Click fuori dal pannello | Backdrop non coerente | Eventi mancanti o separati | Backdrop collegato alla funzione di chiusura esistente; click interni non attraversano il contenuto | Chiusure backdrop superate; 0 overlay aperti residui nelle modali pubbliche |
| UI-009 | Card dentro modali | Hover | Movimento indesiderato | Regola hover generica ereditata | Neutralizzazione della trasformazione hover nei contenitori modali | Nessuna variazione geometrica rilevata nei test di apertura e resize |
| UI-010 | Messaggi dinamici | Aggiornamento testo | Lampeggio | Animazione riavviata dalla classe generica | Disattivata la replay animation sui messaggi aggiornabili | Nessun errore runtime o instabilità di layout rilevata dalla suite |
| UI-011 | Overlay multipli | Escape e focus | Azione sull’overlay sbagliato | Ordine DOM usato come unica priorità | Selezione dell’overlay attivo per `z-index`, poi ordine DOM | Chiusura deterministica dell’overlay visibile superiore nei flussi testati |
| UI-012 | Lightbox | Apertura/chiusura con altri overlay | Sblocco anticipato dello scroll | Scritture dirette concorrenti sul body | Rimosse scritture locali; lock mantenuto finché esiste un overlay aperto o in chiusura | Nessun `overflow:hidden` residuo e nessuno sblocco anticipato rilevato |
| UI-013 | Modali admin | Apertura/chiusura | Durate e proprietà diverse | Regole non centralizzate | Stati coerenti basati su `opacity` e `transform`; supporto `prefers-reduced-motion` | 10 cicli consecutivi superati senza stati intermedi |

## 5. Modifiche effettuate

| File | Componente | Modifica effettuata | Problema risolto | Motivazione tecnica |
|---|---|---|---|---|
| `assets/js/ux-a11y.js` | Controller overlay condiviso | Centralizzati rilevamento overlay, focus trap, Escape, trigger, `aria-expanded`, `aria-controls`, scroll lock e priorità z-index | Chiusure concorrenti, focus perso, overlay non riconosciuti, scroll instabile | Una sola fonte di verità elimina stati visivi e logici divergenti |
| `assets/js/ux-a11y.js` | Pulsanti loading | Aggiunta API busy con misura preventiva, layer spinner e blocco doppio click | Variazione dimensionale e invii multipli | Mantiene il box originale e rende idempotente l’ingresso nello stato loading |
| `assets/css/styles.css` | Overlay e modali | Aggiunte regole stabili per body bloccato, isolamento overlay, hover card, animazioni e reduced motion | Salti, animazioni incoerenti e movimento delle card modali | `opacity` e `transform` non richiedono reflow del layout principale |
| `assets/css/styles.css` | Pulsanti loading | Aggiunti contenuto originale nascosto, layer assoluto e spinner stabile | Testo/spinner che modificavano larghezza e allineamento | Lo spazio del contenuto originale resta riservato durante il loading |
| `assets/js/admin-photos.js` | Conferma foto | Singola istanza, chiusura idempotente, rimozione listener globali, fine animazione reale | Doppie aperture/chiusure e listener residui | La vita del nodo segue lo stato e l’evento reale dell’animazione |
| `assets/js/admin-photos.js` | Lightbox foto | Rimossi Escape e scroll lock locali duplicati | Chiusure multiple e body sbloccato in modo concorrente | Il controller condiviso gestisce tastiera, focus e scroll |
| `assets/js/public.js` | Menu, filtri, modali e lightbox pubbliche | Backdrop coerente, rimozione Escape/body class/focus locali duplicati | Percorsi di chiusura differenti e overlay residui | Tutte le chiusure convergono sulle funzioni esistenti e sul controller centrale |
| `assets/js/public.js` | Download ZIP, PDF squadra, immagine condivisa | Applicato stato busy condiviso e guardia contro click ripetuti | Larghezza variabile e operazioni duplicate | Stato loading stabile e accessibile |
| `assets/js/admin-common.js` | Reset e simulazione | Backdrop di chiusura e busy state condiviso | Dialoghi non uniformi, doppio invio, scroll/focus frammentati | Coerenza con gli altri overlay |
| `assets/js/admin-groups.js` | Modali gruppi | Rimossi body class, focus timer ed Escape duplicati; backdrop instradato alla chiusura | Listener concorrenti e ripristino focus incerto | Un solo controller per ciclo di vita dell’overlay |
| `assets/js/admin-matches.js` | Modali partite | Rimossi body class, focus timer ed Escape duplicati; backdrop instradato alla chiusura | Stesso problema delle modali gruppi | Riduzione delle fonti di stato |
| `assets/js/admin-players.js` | Modale giocatori | Rimosse classi body locali; backdrop usa la chiusura esistente | Scroll lock duplicato | Stato globale centralizzato |
| `assets/js/admin-rules.js` | Modali criteri/regole | Rimosse classi body locali; backdrop usa la chiusura esistente | Scroll e chiusura concorrenti | Stato globale centralizzato |
| `assets/js/supabase-sync.js` | Login e retry | Busy state stabile e click multipli bloccati | Submit ripetuto e variazione del bottone | Impedisce richieste duplicate e conserva le dimensioni |
| Tutti i 13 file `.html` | Cache busting asset | Versione asset aggiornata da `v124-ux` a `v125-ui-stable` | Browser poteva riutilizzare CSS/JS precedenti | Forza il caricamento coerente degli asset corretti |
| `package.json` | Script progetto | Versione 1.25.0 e script `test:ui` | Mancanza di una verifica browser ripetibile | Espone il test reale con un comando standard |
| `package-lock.json` | Lock dipendenze | Creato lockfile npm | Installazione non deterministica/documentazione incompleta | Registra lo stato effettivo del pacchetto, anche senza dipendenze runtime |
| `tools/test-ui-stability.mjs` | Suite browser | Creato server locale e test CDP/Chromium per pagine, viewport e interazioni | Verifiche manuali non ripetibili | Produce misure e risultati reali su DOM, geometria, focus, scroll e console |
| `tools/validate-project.mjs` | Validazione statica | Versione asset attesa aggiornata | Il validatore avrebbe segnalato la nuova versione come incoerente | Mantiene il controllo allineato agli asset distribuiti |
| `README.md` | Istruzioni | Documentati avvio, comandi e configurazione pubblica | Istruzioni essenziali incomplete | Consente estrazione e avvio senza dipendenze superflue |
| `REPORT_MODIFICHE_UI.md` | Documentazione | Creato il presente report | Assenza di una traccia verificabile aggiornata | Registra solo modifiche e test effettivamente svolti |
| `UX_REVIEW_REPORT.md` | Vecchio report | Eliminato | Documento precedente riferito alla versione v124 e non più coerente | Evita risultati contraddittori o obsoleti nello ZIP finale |

## 6. Dettaglio tecnico delle correzioni principali

### 6.1 Controller unico per overlay

**Comportamento precedente:** ogni pagina o modulo poteva aggiungere classi al body, ascoltare Escape, gestire focus e modificare `overflow` autonomamente.

**Causa tecnica:** più fonti di verità controllavano lo stesso stato visivo. In particolare, una lightbox poteva rimuovere `overflow:hidden` mentre un’altra modale era ancora aperta.

**Modifica applicata:** `ux-a11y.js` riconosce tutti gli overlay reali, ne osserva apertura e chiusura, seleziona quello superiore tramite `z-index`, applica una sola gestione di Escape e mantiene il lock finché almeno un overlay è aperto o in stato `is-closing`.

**Comportamento finale:** apertura, chiusura, focus e scroll sono sincronizzati. Gli stili inline originari del body vengono salvati e ripristinati esattamente.

**Verifica:** test reset, simulazione, menu mobile, modali pubbliche, conferma foto, lightbox e resize; nessun overlay o lock residuo nei risultati finali.

### 6.2 Eliminazione dello spostamento laterale

**Comportamento precedente:** durante il primo test browser l’apertura della modale spostava header e pulsante di 10 px.

**Causa tecnica:** il layout dispone già di `scrollbar-gutter: stable`; il controller aggiungeva anche il padding equivalente alla scrollbar, compensando due volte.

**Modifica applicata:** prima di calcolare il padding, il controller verifica il valore computato di `scrollbar-gutter`. Se il gutter è già stabile, la compensazione manuale è zero.

**Comportamento finale:** la geometria resta identica prima, durante e dopo l’apertura.

**Verifica:** header `x=14`, `width=1242`; pulsante reset `x=1164,078125`, `width=74,921875` in tutti e tre gli stati.

### 6.3 Pulsanti loading dimensionalmente stabili

**Comportamento precedente:** varie azioni sostituivano il testo con etichette o spinner di dimensioni differenti; un secondo click poteva riavviare l’operazione.

**Causa tecnica:** mancavano una misura preventiva e uno stato busy centralizzato.

**Modifica applicata:** al primo ingresso in loading vengono registrati contenuto, dimensioni e stato accessibile. Il contenuto originale resta nel flusso ma invisibile; spinner ed etichetta sono sovrapposti. `disabled` e `aria-busy` impediscono click multipli. Il secondo tentativo di attivazione busy viene rifiutato.

**Comportamento finale:** altezza invariata e differenza di larghezza limitata all’arrotondamento sub-pixel del browser, senza spostamento degli elementi adiacenti.

**Verifica:** 74,921875×44 prima; 75×44 durante; 74,921875×44 dopo; secondo ingresso busy `false`.

### 6.4 Conferma foto senza listener residui

**Comportamento precedente:** ogni apertura poteva registrare nuovi listener globali e il tasto Enter poteva confermare senza un contesto di focus locale.

**Causa tecnica:** ciclo di vita del listener separato dal ciclo di vita del nodo dialogo.

**Modifica applicata:** rimozione dei listener globali locali, guardia contro istanze duplicate, chiusura idempotente e rimozione del nodo al completamento della Web Animation effettiva.

**Comportamento finale:** una sola istanza, nessuna conferma globale e nessun nodo residuo dopo la chiusura.

**Verifica:** doppio click, 10 cicli, Escape e backdrop superati; conteggio finale conferme `0`.

### 6.5 Focus e accessibilità

**Comportamento precedente:** focus iniziale e ripristino erano distribuiti tra timer locali; gli attributi di espansione non erano aggiornati uniformemente.

**Causa tecnica:** trigger e overlay non erano associati in modo persistente.

**Modifica applicata:** associazione in `WeakMap`, `aria-controls`, `aria-expanded`, `aria-hidden`, `aria-modal`, focus trap e ripristino tramite `requestAnimationFrame`. In presenza di overlay sovrapposti, il focus resta nell’overlay superiore.

**Comportamento finale:** il trigger recupera il focus dopo la chiusura e il contenuto sottostante non riceve focus durante l’apertura.

**Verifica:** focus restituito ai pulsanti reset, simulazione e menu mobile nei test browser.

## 7. File modificati

### Modificati

- `404.html`
- `README.md`
- `admin-articles.html`
- `admin-customize.html`
- `admin-groups.html`
- `admin-matches.html`
- `admin-photos.html`
- `admin-players.html`
- `admin-reports.html`
- `admin-rules.html`
- `admin-teams.html`
- `admin.html`
- `index.html`
- `print.html`
- `assets/css/styles.css`
- `assets/js/admin-common.js`
- `assets/js/admin-groups.js`
- `assets/js/admin-matches.js`
- `assets/js/admin-photos.js`
- `assets/js/admin-players.js`
- `assets/js/admin-rules.js`
- `assets/js/public.js`
- `assets/js/supabase-sync.js`
- `assets/js/ux-a11y.js`
- `package.json`
- `tools/validate-project.mjs`

### Creati

- `package-lock.json`
- `tools/test-ui-stability.mjs`
- `REPORT_MODIFICHE_UI.md`

### Eliminati

- `UX_REVIEW_REPORT.md`

## 8. Test eseguiti

| Test eseguito | Comando o modalità | Risultato |
|---|---|---|
| Installazione/risoluzione pacchetto | `npm install --ignore-scripts --no-audit --no-fund` | Superata; pacchetto già aggiornato, lockfile creato, nessuna dipendenza runtime installata |
| Validazione progetto | `npm test` | Superata: 13 HTML, 21 JavaScript, 0 errori, 0 warning |
| Lint/controlli statici | `npm run lint` | Superato: 13 HTML, 21 JavaScript, 0 errori, 0 warning |
| Build produzione statica | `npm run build` | Superata: validazione sorgente e `dist`, entrambe con 13 HTML, 21 JavaScript, 0 errori, 0 warning |
| Avvio e caricamento pagine | `npm run test:ui`, server HTTP locale + Chromium headless | Superato: 13/13 pagine caricate, 0 errori runtime, 0 richieste locali fallite |
| Responsive e overflow | Chromium a 320, 360, 375, 390, 412, 480, 768, 1024, 1280, 1440 e 1920 px | Superato a tutte le 11 larghezze; nessun overflow orizzontale rilevato |
| Pulsante loading | Attivazione busy, secondo tentativo, ripristino | Superato: altezza 44 px stabile; larghezza 74,921875→75→74,921875 px; secondo ingresso bloccato |
| Modale reset | Apertura/chiusura, 10 cicli, doppio click, Escape, backdrop, focus, scroll e geometria | Superato; una sola modale, focus ripristinato, scroll 240→240, nessuno spostamento misurato |
| Modale simulazione | Apertura/chiusura, 10 cicli, doppio click, Escape, backdrop e focus | Superato; nessun overlay o lock residuo |
| Menu mobile | 10 cicli, doppio click, Escape, backdrop, focus e larghezza pagina | Superato; larghezza pagina 390→390 px |
| Filtri e modali pubbliche | Filtri, partita, squadra e articolo con Escape/backdrop | Superato; 0 overlay aperti residui |
| Conferma foto | Doppio click, Escape, 10 cicli e backdrop | Superato; una sola istanza durante l’apertura e 0 nodi residui dopo la chiusura |
| Lightbox foto | Apertura, Escape, 10 cicli, backdrop e frecce | Superato; lightbox riutilizzato, chiuso e body sbloccato al termine |
| Resize e scroll con modale | Viewport portata a 320 px durante apertura, scroll a 300 px | Superato; modale entro viewport, overflow 0, lock attivo durante apertura e rimosso dopo |
| Console e rete locale | Raccolta eccezioni JavaScript, `console.error` e richieste locali fallite | Superato: 0 errori runtime e 0 errori di rete locale |
| Ricerca transizioni globali instabili | Ricerca statica di `transition: all` | Superata: nessuna occorrenza nel CSS finale |
| Scansione dati sensibili | Ricerca di `.env`, chiavi private, service-role e secret applicativi | Superata: nessun file `.env`, chiave privata o secret applicativo rilevato; mantenuta solo configurazione frontend pubblica già prevista dal progetto |
| Integrità archivio finale | `unzip -t` sul file consegnato | Superata: archivio leggibile e struttura valida |
| Estrazione archivio finale | Estrazione in cartella pulita, verifica report/struttura e `npm test` | Superata: report presente, cartella corretta e validazione estratta senza errori |
| Build dal progetto estratto | `npm run build` nella copia estratta dall’archivio | Superata: build statica completata dalla copia consegnata |

## 9. Risultato finale

Principali sfarfallii e instabilità eliminati:

- doppia compensazione della scrollbar e conseguente spostamento laterale;
- variazione dimensionale dei pulsanti loading;
- doppio click durante operazioni asincrone;
- gestori Escape concorrenti;
- listener residui nella conferma foto;
- mancato riconoscimento del lightbox amministrativo;
- blocco e sblocco scroll frammentato;
- click backdrop incoerenti;
- ripristino focus non deterministico;
- overlay attivo scelto senza considerare lo `z-index`;
- trasformazione hover applicabile alle card modali;
- replay dell’animazione dei messaggi dinamici.

Componenti stabilizzati e verificati:

- pulsanti loading condivisi;
- modale reset;
- modale simulazione;
- menu mobile;
- pannello filtri;
- modali pubbliche partita, squadra e articolo;
- conferma eliminazione foto;
- lightbox foto;
- controller comune di overlay, focus, Escape e scroll.

La build statica termina con successo. Tutte le prove elencate nella sezione **Test eseguiti** hanno avuto esito positivo. Non sono stati inclusi `node_modules`, directory di build, cache, log, file IDE, `.env`, chiavi private o segreti.

**Archivio generato:** `new-generation-ui-flicker-fix.zip`
