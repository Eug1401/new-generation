# Photo System v105

Gestione foto riscritta da zero mantenendo la UI esistente.

## Cosa cambia

- Nuovo runtime centralizzato: `assets/js/photo-runtime.js`.
- La card prova sempre la preview e poi l'originale nello stesso `<img>`.
- Lo stato `Foto non disponibile` viene mostrato solo dopo il fallimento di preview, originale e originale con cache refresh stabile.
- Caricamento con `IntersectionObserver`, coda a concorrenza limitata e priorità sulle prime foto visibili.
- DOM diff già presente in public/admin preservato: i refresh realtime non distruggono più le immagini in caricamento.
- Download singolo e ZIP restano collegati agli originali.
- Upload Storage con `cacheControl: 31536000`, sicuro perché i path upload sono unici.

## File modificati

- `assets/js/photo-runtime.js` nuovo
- `assets/js/public.js`
- `assets/js/admin-photos.js`
- `assets/js/photos.js`
- `index.html`
- `admin-photos.html`

## Verifica consigliata

1. Svuota cache o fai hard refresh.
2. Apri Foto su desktop.
3. Aspetta un refresh automatico Supabase.
4. Verifica che la card non resti bloccata su fallback.
5. Ripeti da smartphone con rete mobile.
6. Scarica una foto singola o ZIP e verifica che venga usato l'originale.
