# Relazione intervento v126.17

Data: 22 giugno 2026

## 1. Risultato

Sono stati applicati due interventi indipendenti:

1. rielaborazione completa del dettaglio Articolo, con una vera sezione fotografica editoriale autonoma;
2. correzione del flusso di rete della sezione Foto e aggiunta di una diagnostica esplicita per Supabase Edge Function, CORS e Cloudinary.

La gestione delle immagini degli articoli non è stata collegata alla galleria Foto. Upload, storage, endpoint e modello degli Articoli restano separati.

## 2. Dettaglio Articolo: problema verificato

Nel progetto v126.16 il markup nuovo conviveva ancora con regole CSS storiche che impostavano il dettaglio come composizione a due colonne e applicavano `display: grid` alla sezione media. Le regole più recenti le sovrascrivevano solo in parte. In alcune larghezze la fotografia risultava quindi appoggiata nella pagina anziché integrata come blocco editoriale, e il frame poteva restringersi in modo anomalo.

## 3. Nuovo impianto editoriale

L'ordine del dettaglio è ora stabile:

```text
navigazione di ritorno
categoria
intestazione: titolo, sottotitolo, metadati
sezione fotografica autonoma
eventuale didascalia
corpo editoriale
contenuti finali e navigazione
```

La fotografia usa un pannello dedicato composto da:

- sezione semantica `article-featured-photo`;
- card fotografica indipendente;
- canvas neutro e stabile;
- immagine centrata con `object-fit: contain`;
- comando “Apri fotografia” separato dall'immagine e non sovrapposto;
- didascalia esterna al canvas.

Il testo non può sovrapporsi all'immagine. Non sono presenti titoli sull'immagine, gradienti decorativi, altezze rigide con ritaglio o overflow orizzontale.

### Rapporti d'aspetto

- panoramica: usa la larghezza editoriale disponibile senza ritaglio;
- verticale: card centrata con larghezza massima ridotta;
- quadrata: dimensione equilibrata e centrata;
- articolo senza foto: l'intera sezione non viene renderizzata.

### Responsive

Il layout è a colonna editoriale unica. La fotografia rimane distinta dall'intestazione e dal testo a 320, 768 e 1440 px, mantiene le proporzioni e non supera la viewport. L'anteprima amministrativa usa lo stesso renderer del dettaglio pubblico.

## 4. “Server Foto non raggiungibile”: cause individuate nel codice

Nel pacchetto sono state verificate tre condizioni concrete capaci di produrre il messaggio generico:

1. le richieste alla Edge Function non inviavano sempre l'header `apikey` richiesto dal gateway Supabase;
2. la funzione leggeva solo `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` e `CLOUDINARY_API_SECRET`, ignorando un'eventuale configurazione tramite `CLOUDINARY_URL`;
3. quando `PHOTO_ALLOWED_ORIGINS` non conteneva l'origine reale, la risposta 403 non era leggibile dal browser e veniva rappresentata come errore di rete/CORS.

Il file `CLOUDINARY_URL` mostrato nella richiesta conteneva ancora un placeholder per la API key e non era quindi una stringa di configurazione utilizzabile così com'era.

Non è possibile stabilire dal solo archivio quale configurazione sia attualmente pubblicata sul progetto Supabase remoto. La versione v126.17 elimina l'ambiguità tramite un health check non sensibile.

## 5. Correzione frontend Foto

`assets/js/photos.js` ora:

- invia la chiave pubblicabile nell'header `apikey` per tutte le chiamate alla funzione;
- usa il vero `session.access_token` solo per le operazioni amministrative;
- non usa la chiave pubblicabile come token utente;
- lascia al browser la generazione del boundary multipart;
- classifica separatamente rete, CORS, origine non autorizzata, configurazione Cloudinary, configurazione Supabase, autenticazione e timeout;
- espone `healthCheck()`.

`assets/js/admin-photos.js` esegue la diagnostica prima di caricare la galleria e mostra un messaggio preciso per:

- funzione non raggiungibile;
- dominio assente da `PHOTO_ALLOWED_ORIGINS`;
- Cloudinary non configurato;
- secrets Supabase incompleti.

## 6. Correzione Edge Function

`supabase/functions/team-photos/index.ts` ora:

- accetta `CLOUDINARY_URL` oppure le tre variabili Cloudinary separate;
- rifiuta stringhe con placeholder;
- gestisce `PHOTO_ALLOWED_ORIGINS` con normalizzazione di protocollo, host, porta e slash finale;
- risponde alle preflight `OPTIONS` con gli header necessari;
- mantiene il blocco applicativo 403 per origini non ammesse ma consente al browser di leggerne il JSON;
- espone `GET ?action=health` senza restituire API key, API secret, service role o token;
- mantiene gli endpoint amministrativi protetti dal JWT della sessione;
- resta completamente separata dagli endpoint e dai dati Articoli.

## 7. Sicurezza delle credenziali

La API secret fornita nel messaggio deve essere considerata esposta e va ruotata nel pannello Cloudinary prima del deploy. Il valore non è stato copiato in JavaScript, HTML, documentazione, patch o archivio.

Sono stati aggiunti:

- `.gitignore` per escludere `.env` e i secrets delle funzioni;
- `supabase/functions/.env.example` con soli placeholder;
- controllo finale sull'albero sorgente per escludere i valori forniti nel messaggio.

## 8. Attivazione sul progetto remoto

La modifica locale non sostituisce automaticamente una Edge Function già pubblicata. Dopo aver ruotato il secret, creare `supabase/functions/.env` partendo da `.env.example`, quindi eseguire:

```bash
supabase login
supabase link --project-ref mcksxqtgibkazxnkdfra
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy team-photos --no-verify-jwt
```

Impostare `PHOTO_ALLOWED_ORIGINS` con l'origine completa del sito, per esempio `https://www.dominio.example`, includendo porta e protocollo quando presenti.

Dopo il deploy:

```bash
PHOTO_TEST_ORIGIN=https://dominio-reale.example npm run test:photo-edge-live
```

oppure aprire:

```text
https://mcksxqtgibkazxnkdfra.supabase.co/functions/v1/team-photos?action=health
```

## 9. Test eseguiti

Passati localmente:

- validazione progetto: 13 HTML, 22 JavaScript, zero errori e zero avvisi;
- lint;
- 12 test specifici Foto;
- controllo TypeScript della Edge Function;
- suite Articoli end-to-end;
- sezione fotografica autonoma e ordinata;
- visualizzatore con Escape e ritorno focus;
- dettaglio fotografico a 320, 768 e 1440 px;
- assenza di overflow orizzontale;
- build statica sorgente e `dist`.

Il test live dal container ha prodotto `DNS non risolto per mcksxqtgibkazxnkdfra.supabase.co`. Questo descrive il limite della rete dell'ambiente di esecuzione e non dimostra lo stato della funzione pubblicata. Il deploy e i log remoti non erano disponibili in questa sessione e non vengono dichiarati come verificati.

## 10. File modificati o aggiunti

- `.gitignore`
- `CLOUDINARY_SUPABASE_SETUP.md`
- `package.json`
- `package-lock.json`
- pagine HTML, esclusivamente per aggiornamento cache-busting degli asset
- `assets/css/styles.css`
- `assets/js/ui.js`
- `assets/js/photos.js`
- `assets/js/admin-photos.js`
- `supabase/functions/.env.example`
- `supabase/functions/team-photos/index.ts`
- `tools/check-photo-edge.mjs`
- `tools/test-photo-system.mjs`
- `tools/test-ui-stability.mjs`

## 11. Limite residuo

Per eliminare il messaggio nel sito pubblicato è obbligatorio distribuire la nuova funzione e impostare i nuovi secrets nel progetto Supabase. Senza accesso amministrativo al progetto remoto non è corretto dichiarare questa fase completata. Il codice, la diagnostica e i comandi necessari sono inclusi nell'archivio.
