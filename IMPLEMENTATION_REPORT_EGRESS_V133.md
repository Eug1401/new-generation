# Implementation report — Egress fix v1.33.0

## File modificati

- `assets/js/supabase-sync.js`
- `assets/js/team-logos.js` (nuovo)
- `assets/js/admin-teams.js`
- `assets/js/ui.js`
- `assets/js/admin-common.js`
- `assets/css/styles.css`
- `admin-teams.html`
- tutti gli HTML, per il cache busting di sync/UI/CSS
- `supabase/functions/team-photos/index.ts`
- `package.json`

## Garanzie applicative

- Nessuna modifica alla struttura di classifiche, calendario, partite, marcatori o statistiche.
- I vecchi backup con immagini Base64 restano importabili.
- La migrazione applica allo stato più recente soltanto i campi relativi ai loghi, evitando di sovrascrivere altre modifiche.
- In caso di errore upload, il vecchio logo resta nel JSON e non viene perso.
- I nuovi upload non hanno fallback Base64: se il backend logo non è pronto, il salvataggio del nuovo file viene bloccato con un messaggio esplicito.
- La route logo richiede una sessione Supabase admin valida.

## Validazioni eseguite

- validazione sintattica di tutti i file JavaScript;
- TypeScript check della Edge Function;
- build statica completa e validazione della cartella `dist`;
- test calendario, simulazione, foto, scheduler, PDF e audit sync preesistenti.

Alcuni test marcatori già presenti nel progetto risultano non allineati all'implementazione corrente e fallivano su aspettative estranee a questa modifica; l'audit sync specifico è passato integralmente.
