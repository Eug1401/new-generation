# Risultati test — v126.18

- Validazione progetto: **PASS**, 0 errori, 0 warning.
- Suite UI generale: **PASS** su 13 pagine e larghezze 320, 360, 375, 390, 412, 430, 480, 768, 1024, 1280, 1440 e 1920 px.
- Suite Articoli end-to-end: **PASS**.
- Suite Foto: **PASS**, 12 test su 12.
- Type-check Edge Function Foto: **PASS**.
- Test di accettazione mirato: **PASS** a 320, 375, 430, 768, 1024, 1280 e 1440 px.
- Build statica: **PASS**, 0 errori, 0 warning.

## Verifiche specifiche confermate

- `Campioni!`: una sola parola/riga interna, nessuno spezzamento `Campio` / `ni!`.
- CSS calcolato del titolo: `word-break: normal`, `overflow-wrap: normal`, `hyphens: none`.
- Parole normali di un titolo lungo: una sola sequenza grafica per token.
- Token realmente lunghi nel corpo: contenuti contenuti senza scroll orizzontale.
- Hero: heading e pannello metadati non si intersecano.
- Foto admin: logo e testo non si intersecano.
- Foto admin: anteprima, contenuto e azioni sono aree verticalmente separate.
- Logo: `object-fit: contain`.
- Pulsanti: 44 px desktop/tablet, 46 px mobile.
- Nessun errore JavaScript o richiesta locale fallita durante la suite UI.

Log grezzi:

- `reports/test-ui.log`
- `reports/test-articles.log`
- `reports/test-photos.log`
- `reports/test-validation.log`
