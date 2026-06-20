# Report revisione UI/UX — New Generation

**Data:** 20 giugno 2026  
**Versione intervento:** v124-ux  
**Tecnologia:** sito statico multipagina, HTML5, CSS e JavaScript vanilla; persistenza locale e sincronizzazione opzionale Supabase; foto Cloudinary; jsPDF tramite CDN.

## A. Riepilogo generale

### Stato iniziale

Il progetto era funzionante e ricco di funzionalità, ma presentava un livello di stratificazione elevato: un foglio CSS di oltre 5.000 righe con numerosi override, copie identiche degli asset sia nella root sia in `assets/`, un bundle legacy non referenziato, controlli form non sempre associati a label, modali con comportamento focus/Escape non uniforme, tab pubblici non completamente semantici e una pagina di stampa che generava overflow orizzontale su schermi stretti.

Le immagini dinamiche non avevano sempre dimensioni intrinseche riservate; il logo PNG trasparente pesava circa 1 MB. Il login amministratore non esponeva una struttura dialog completa e non bloccava invii multipli durante l'autenticazione.

### Aree analizzate

Sono state controllate tutte le pagine presenti:

- sito pubblico e relativi tab;
- dashboard amministrativa;
- regole e calendario;
- gironi;
- squadre;
- giocatori;
- partite e referti;
- articoli;
- foto;
- report e PDF;
- personalizzazione;
- stampa;
- login amministratore generato dinamicamente;
- modali, lightbox, pannelli filtro e navigazione mobile;
- pagina 404, inizialmente assente.

### Strategia adottata

L'intervento ha mantenuto l'architettura e la logica di business esistenti. È stato aggiunto un piccolo runtime condiviso (`assets/js/ux-a11y.js`) per applicare in modo coerente label, ARIA, focus trap, navigazione da tastiera, metadati delle immagini e regioni scorrevoli anche ai componenti creati dinamicamente. Il CSS è stato rinforzato con un livello finale dedicato a stabilità, responsive, touch target, focus e riduzione del movimento.

Sono state poi corrette direttamente le aree che richiedevano logica specifica: routing dei tab pubblici tramite hash, login Supabase, stampa mobile, cache busting degli asset e pagina 404. Le copie asset inutilizzate sono state eliminate.

### Risultato finale

- Tutte le 13 pagine HTML passano il controllo automatico dei riferimenti locali.
- Tutti i 21 file JavaScript passano `node --check`.
- L'audit axe non rileva violazioni WCAG A/AA nel rendering testato.
- Non è stato rilevato overflow orizzontale alle larghezze 320, 360, 375, 390, 412, 480, 768, 1024, 1280, 1440 e 1920 px.
- I flussi tab, modali, menu mobile, focus, Escape, login e ritorno del focus hanno superato i test interattivi in Chromium headless.
- La dimensione dei file del progetto, escludendo build temporanea e report, è passata da **2.756.755 byte** a **1.300.978 byte**.
- Il logo PNG trasparente è passato da **1.003.266 byte / 1024×1024** a **333.007 byte / 512×512**, mantenendo trasparenza e qualità sufficiente per interfaccia e PDF.

## B. Errori e problemi trovati

| ID | Pagina o componente | Problema | Causa tecnica | Gravità | Impatto / riproduzione |
|---|---|---|---|---|---|
| UI-001 | Struttura progetto | Asset JS/CSS duplicati nella root e in `assets/`; bundle `app.js` non referenziato | Copie legacy rimaste nel pacchetto | Alta | Pacchetto più pesante, rischio di modificare la copia sbagliata e divergenze future |
| UI-002 | Form amministrativi | Diversi campi non avevano una label associata programmaticamente | `label` senza `for` e input senza `id` | Alta | Screen reader e navigazione assistita non identificavano correttamente il campo |
| UI-003 | Tab pubblici | Tab non completamente semantici e senza navigazione frecce | Mancanza di `tablist`, `tab`, `tabpanel`, `aria-selected` e gestione tastiera | Alta | Navigazione da tastiera incompleta e stato poco chiaro agli ausili |
| UI-004 | Navigazione pubblica | Refresh/deep link e avanti-indietro non conservavano il tab tramite URL | Stato salvato soltanto in `sessionStorage` | Media | Il browser non poteva rappresentare in cronologia la sezione aperta |
| UI-005 | Modali e pannelli | Focus trap, Escape, `aria-hidden` e ritorno focus non erano uniformi; il dettaglio partita non si chiudeva con Escape | Gestione separata in più file senza controller comune | Alta | Possibile perdita del focus dietro la modale e uso difficoltoso da tastiera |
| UI-006 | Login admin | Form login privo di dialog semantico completo, focus iniziale e stato loading | Markup dinamico minimo; submit non disabilitato | Alta | Invii multipli, feedback debole e accessibilità ridotta |
| UI-007 | Login admin | Messaggio di errore inserito tramite `innerHTML` | Testo del backend interpolato direttamente | Alta | Contenuto non affidabile interpretato come HTML; feedback potenzialmente non sicuro |
| UI-008 | Header e logo | Spazio non sempre riservato per logo personalizzato | Immagine dinamica senza dimensioni intrinseche uniformi | Media | Possibili variazioni di larghezza/altezza al caricamento |
| UI-009 | Immagini dinamiche | Logo squadre e immagini articoli senza dimensioni HTML coerenti | Markup generato senza `width`/`height` | Media | Layout shift e calcolo tardivo delle dimensioni |
| UI-010 | Stampa mobile | Overflow orizzontale a 320–375 px | Larghezze fisse sulle colonne della tabella calendario | Alta | Pagina più larga del viewport, contenuto tagliato o difficile da consultare |
| UI-011 | Controlli touch | Checkbox, radio, range e un link inline avevano target inferiori a 24 px | Dimensioni native del browser | Media | Interazione più difficile su touch e mancato rispetto del target minimo |
| UI-012 | Animazioni | Presenza di `transition: all` e assenza di una regola globale reduced motion | Transizioni generiche accumulate nel CSS | Media | Reflow non necessario e discomfort per utenti sensibili al movimento |
| UI-013 | Scrollbar e modali | Comparsa/scomparsa della scrollbar poteva spostare il layout | Nessuna riserva stabile del gutter | Media | Spostamento orizzontale durante apertura/chiusura overlay |
| UI-014 | Tabelle scorrevoli | Regioni scrollabili non sempre raggiungibili da tastiera | `.table-wrap` senza `tabindex` e nome accessibile | Media | Tabelle larghe non esplorabili comodamente senza mouse |
| UI-015 | Messaggi dinamici | Errori, successi e stato sync non sempre annunciati | Assenza uniforme di `role`/`aria-live` | Media | Utenti screen reader potevano non ricevere il feedback |
| UI-016 | Error handling | Pagina 404 assente | Nessun file dedicato | Media | Link errato senza recupero guidato |
| UI-017 | Cache browser | Tutti gli asset usavano ancora la stessa versione query | Cache busting non aggiornato dopo le modifiche | Alta | Possibile caricamento misto tra HTML nuovo e asset vecchi |
| UI-018 | Prestazioni | Logo trasparente da circa 1 MB | PNG 1024×1024 non ottimizzato | Media | Caricamento iniziale e generazione PDF più pesanti |
| UI-019 | Focus | Focus visibile non uniforme su tutti i componenti | Regole focus locali e non coordinate | Alta | Difficile capire la posizione corrente con tastiera |
| UI-020 | Pacchetto output | Archivio originale con doppio livello `new-generation-main/new-generation-main` | Struttura di compressione ridondante | Media | Estrazione meno chiara e rischio di pubblicare la cartella sbagliata |

## C. Modifiche effettuate

| File | Componente | Modifica | Problema risolto | Motivazione tecnica |
|---|---|---|---|---|
| `assets/js/ux-a11y.js` | Runtime condiviso | Nuovo enhancer per label, id, autocomplete, immagini, tabelle, messaggi, tab, modali e MutationObserver | UI-002, UI-003, UI-005, UI-008, UI-009, UI-011, UI-014, UI-015, UI-019 | Un solo punto coerente copre anche componenti creati dopo il caricamento |
| `assets/css/styles.css` | Design system e responsive | Focus ring senza variazioni dimensionali, touch target, scrollbar stabile, modal sizing, riduzione movimento, immagini con aspect ratio, layout mobile e stampa | UI-008–UI-14, UI-019 | Evita reflow, migliora accessibilità e mantiene l'identità visiva |
| `assets/js/public.js` | Tab pubblici | Hash URL, deep link e sincronizzazione con cronologia browser | UI-003, UI-004 | URL condivisibile e navigazione avanti/indietro coerente |
| `assets/js/supabase-sync.js` | Login admin | Dialog semantico, label esplicite, focus iniziale, submit loading, blocco invio multiplo e errori inseriti come testo | UI-006, UI-007, UI-015 | Flusso login più sicuro, accessibile e comprensibile |
| Tutti gli HTML | Layout e cache | Skip link, main focalizzabile, theme-color/color-scheme, nav label, script UX condiviso, versione asset `v124-ux` | UI-002, UI-003, UI-017, UI-019 | Struttura semantica consistente e invalidazione cache |
| `index.html` | Pubblico | Header uniforme, ricerca `type=search`, modale con stato iniziale ARIA | UI-003, UI-005 | Semantica e comportamento coerenti |
| `admin.html` | Backup | Label esplicita per upload JSON | UI-002 | Associazione statica anche prima del runtime |
| `print.html` + CSS | Stampa | Main focalizzabile e tabelle adattive su schermi stretti | UI-010 | Nessun overflow alle larghezze testate |
| `404.html` | Error page | Nuova pagina con recupero verso pubblico/admin | UI-016 | Gestione esplicita dei percorsi non trovati |
| `assets/brand/new-generation-logo-transparent.png` | Brand | Ridimensionamento 1024→512 e compressione lossless/ottimizzata | UI-018 | Riduzione di circa il 67% del peso |
| `package.json` | Qualità | Script `lint`, `test`, `build` senza dipendenze runtime | Controlli finali | Processo ripetibile anche in CI |
| `tools/validate-project.mjs` | Validazione | Controllo file, riferimenti, sintassi JS, CSS, versioni, duplicati | UI-001, UI-017 | Previene regressioni strutturali |
| `tools/build-static.mjs` | Build | Generazione e validazione di una build statica `dist` | Controllo produzione | Verifica che il pacchetto deployabile sia autonomo |
| Root progetto | Asset legacy | Eliminate 17 copie duplicate e `app.js` non referenziato | UI-001 | Una sola fonte di verità in `assets/` |
| Archivio finale | Packaging | Un solo livello radice `new-generation-main/` | UI-020 | Estrazione e deploy più chiari |

Effetti collaterali controllati: non sono state modificate le API pubbliche dello store, la struttura dati Supabase, il formato JSON di backup, il modello dei tornei, la gestione delle foto o la logica dei referti.

## D. Test eseguiti

| Ambiente / dimensione | Browser o strumento | Funzionalità | Risultato | Limiti |
|---|---|---|---|---|
| 320, 360, 375, 390, 412, 480 px | Chromium 144 headless + Playwright | Overflow, controlli, form, stampa | PASS | Rendering isolato dai servizi esterni |
| 768, 1024 px | Chromium 144 headless + Playwright | Tablet e breakpoint intermedi | PASS | Nessun dispositivo fisico |
| 1280, 1440, 1920 px | Chromium 144 headless + Playwright | Desktop e viewport ampi | PASS | Motore Chromium |
| Tutte le 13 pagine | axe-core WCAG A/AA/2.1/2.2 | Label, nomi accessibili, regioni, contrasto rilevabile | PASS, 0 violazioni nel DOM testato | Il contrasto di contenuti personalizzati dipende dai colori scelti dall'admin |
| Sito pubblico | Playwright | Click tab, frecce tastiera, ARIA selected | PASS | Cronologia hash implementata; test end-to-end HTTP limitato dall'ambiente |
| Sito pubblico | Playwright | Modale partita, squadra, articolo; focus ed Escape | PASS | Dati di test locali |
| Mobile 390×844 | Playwright | Bottom navigation, pannello “Altro”, Escape | PASS | Emulazione viewport, non browser iOS reale |
| Admin | Playwright | Apertura reset, focus, Escape, ritorno focus | PASS | Operazione distruttiva non eseguita |
| Login admin | Playwright + client Supabase stub | Focus email, label, loading, errore sicuro, riabilitazione submit | PASS | Autenticazione reale non eseguita |
| Tutti i JS | Node `--check` | Sintassi | PASS, 21/21 | Non sostituisce type checking statico |
| Build | `npm run build` | Copia produzione e seconda validazione | PASS | Sito statico, nessuna bundling/minification richiesta |
| Riferimenti locali | Validator interno | CSS, JS, link e file locali | PASS | URL CDN/backend verificati solo come configurazione |
| Asset | Hash e dimensioni | Duplicati e peso logo | PASS | Non è stata effettuata una conversione WebP per compatibilità PDF |

## E. Problemi non risolti / limiti di verifica

### E-001 — Test backend e rete reale

- **Motivo:** l'ambiente di esecuzione blocca la navigazione HTTP di Chromium e non consente una verifica end-to-end dei servizi CDN/Supabase/Cloudinary.
- **Impatto:** non è stato possibile certificare richieste reali, policy CORS, login con credenziali effettive, realtime e upload Cloudinary.
- **Soluzione raccomandata:** eseguire `npm run build`, pubblicare una preview Netlify/Cloudflare e verificare Network/Console con account di test.

### E-002 — Browser non Chromium

- **Motivo:** Firefox, Safari desktop, Safari iOS e Chrome Android reali non erano disponibili nel runtime.
- **Impatto:** la compatibilità è basata su standard CSS/HTML e fallback, non su test fisici completi.
- **Soluzione raccomandata:** smoke test su BrowserStack o dispositivi reali, soprattutto file input, stampa e viewport iOS.

### E-003 — CSS legacy ancora esteso

- **Motivo:** il foglio contiene molte regole storiche e override. Una rimozione automatica aggressiva avrebbe potuto eliminare stili di componenti visibili solo con dati reali o flussi specifici.
- **Impatto:** manutenzione CSS ancora più complessa del necessario, ma senza duplicati file e senza errori rilevati.
- **Soluzione raccomandata:** in un intervento separato, aggiungere visual regression test con dataset completo e rimuovere selettori inutilizzati per gruppi funzionali.

### E-004 — Registrazione e recupero password

- **Motivo:** il progetto implementa soltanto login admin; gli utenti vengono creati in Supabase Authentication e il pubblico è read-only.
- **Impatto:** non esistono pagine registrazione/recupero da revisionare.
- **Soluzione raccomandata:** aggiungerle solo se il modello di accesso del prodotto cambia; non sono state introdotte per non alterare la business logic.

## F. File modificati

### Creati

- `404.html`
- `assets/js/ux-a11y.js`
- `package.json`
- `tools/build-static.mjs`
- `tools/validate-project.mjs`
- `UX_REVIEW_REPORT.md`

### Modificati

- `index.html`
- `admin.html`
- `admin-rules.html`
- `admin-groups.html`
- `admin-teams.html`
- `admin-players.html`
- `admin-matches.html`
- `admin-articles.html`
- `admin-photos.html`
- `admin-reports.html`
- `admin-customize.html`
- `print.html`
- `assets/css/styles.css`
- `assets/js/public.js`
- `assets/js/supabase-sync.js`
- `assets/brand/new-generation-logo-transparent.png`

### Eliminati

Copie root duplicate o non utilizzate:

- `app.js`
- `styles.css`
- `store.js`
- `public.js`
- `ui.js`
- `print.js`
- `supabase-config.js`
- `supabase-sync.js`
- `admin-articles.js`
- `admin-common.js`
- `admin-dashboard.js`
- `admin-groups.js`
- `admin-matches.js`
- `admin-players.js`
- `admin-reports.js`
- `admin-rules.js`
- `admin-teams.js`

## G. Risultato dei controlli automatici

| Controllo | Comando / metodo | Esito |
|---|---|---|
| Build produzione | `npm run build` | PASS; `dist` generata e validata |
| Lint strutturale | `npm run lint` | PASS; 0 errori, 0 warning |
| Test statici | `npm test` | PASS; 0 errori, 0 warning |
| Type checking | Non applicabile: JavaScript vanilla senza TypeScript/JSDoc tipizzato | N/A |
| Sintassi JS | `node --check` su 21 file | PASS |
| Console browser | Rendering isolato di tutte le pagine | PASS; 0 errori/page errors |
| Responsive | 11 larghezze × 13 pagine | PASS; 0 overflow orizzontali |
| Accessibilità | axe-core + controlli custom | PASS; 0 violazioni rilevate, 0 campi senza nome, 0 target <24 px |
| Interazioni | Playwright | PASS per tab, modali, menu mobile, reset, form e login |
| Prestazioni asset | Analisi dimensioni/hash | PASS; progetto -52,8%, logo -66,8% |
| Riferimenti locali | Validator custom | PASS; nessun file mancante |
| Duplicati asset | SHA-256 | PASS; nessun duplicato rilevato tra asset |
| `transition: all` | Validator CSS | PASS; nessuna occorrenza |
| Reduced motion | Validator CSS | PASS |

