# Verifica e correzione consistenza marcatori — v1.28.1

## Ambito verificato

- coerenza tra referto, risultato, classifica squadre, statistiche squadra, classifica marcatori e classifica presidenti;
- ricerca dei giocatori per numero di maglia;
- aggiunta, modifica, accorpamento e rimozione dei marcatori nell'area amministrativa;
- gestione Kings League dei gol da 2 punti;
- gol dei presidenti, sempre di valore massimo 1;
- visualizzazione uniforme del gol presidenziale come `Nome (rig.)`;
- card partita, dettaglio pubblico, immagine esportata e PDF dei report.

## Correzioni necessarie applicate

1. **Gol misti da 1 e da 2 dello stesso giocatore**
   - La precedente riga aggregata disponeva di un solo valore comune a tutti i gol del giocatore.
   - Ora l'admin inserisce il totale dei gol e il numero di quelli da 2 punti.
   - Un giocatore resta presente una sola volta, ma il risultato conserva esattamente la combinazione di gol normali e doppi.

2. **Presidenti Kings League**
   - Il presidente è selezionabile soltanto in modalità Kings League.
   - Passando una riga da calciatore a presidente, il numero di gol da 2 viene azzerato e il relativo campo scompare.
   - Anche dati alterati o importati con peso 2 vengono normalizzati automaticamente a peso 1.
   - Nei contesti che mostrano un evento-gol compare l'etichetta uniforme `Nome (rig.)`.

3. **PDF riepilogo partite**
   - La ricostruzione precedente cercava giocatori e squadra attraverso proprietà non coerenti con il modello attuale.
   - Il PDF ora usa la stessa aggregazione centrale impiegata da card pubbliche ed export immagine.

4. **Classifica marcatori**
   - Ogni evento-gol vale sempre 1 nella graduatoria individuale, anche quando vale 2 nel risultato Kings League.
   - Il valore doppio non viene mostrato come gol aggiuntivo nelle liste marcatori.
   - Risultato, GF/GS, differenza reti, classifica squadre e statistiche squadra continuano invece a usare il valore ponderato.

## Test automatici

- test logico dedicato a risultato ponderato, GF/GS, classifica squadre, statistiche squadra, marcatori e presidenti;
- test UI reale con Chromium per ricerca maglia `#9` e `#10`;
- salvataggio e riapertura di 5 gol dello stesso giocatore, di cui 2 da due punti;
- modifica della riga da calciatore a presidente e viceversa;
- verifica del peso massimo 1 del presidente;
- verifica del dettaglio pubblico dopo pubblicazione dello stato;
- test responsive a 320, 390, 768 e 1280 px;
- test dell'immagine esportata e della relativa etichetta presidenziale.
