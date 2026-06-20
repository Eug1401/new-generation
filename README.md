# New Generation Tournament

Applicazione statica multipagina per gestione e pubblicazione di un torneo, realizzata con HTML, CSS e JavaScript vanilla.

## Avvio locale

Non ci sono dipendenze runtime obbligatorie. È sufficiente servire la cartella con un server HTTP statico, per esempio:

```bash
python3 -m http.server 8080
```

Poi aprire `http://localhost:8080/index.html` per il sito pubblico oppure `http://localhost:8080/admin.html` per l’area amministrativa.

## Verifiche disponibili

```bash
npm install
npm test
npm run lint
npm run build
npm run test:ui
```

`npm run test:ui` usa Chromium headless. Il percorso predefinito è `/usr/bin/chromium`; può essere sostituito impostando `CHROMIUM_BIN`.

## Configurazione dati condivisi

La configurazione Supabase e Cloudinary è in `assets/js/supabase-config.js`. Non inserire chiavi segrete nel frontend: sono ammesse esclusivamente chiavi pubbliche/anonime. Per la configurazione completa consultare `CLOUDINARY_SUPABASE_SETUP.md` e `SUPABASE_GUIDA.txt`.

La revisione tecnica della stabilità UI è documentata in `REPORT_MODIFICHE_UI.md`.
