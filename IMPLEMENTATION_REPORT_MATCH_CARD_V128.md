# Implementazione schede partita e marcatori — v1.28.0

## Obiettivo

Revisione completa della scheda partita esportata come immagine e della gestione marcatori lato amministrativo, mantenendo compatibilità con classifiche, statistiche e sincronizzazione esistenti.

## Scheda partita esportata

- Nuovo layout 1080 px, moderno e ad altezza dinamica.
- Loghi renderizzati con `contain`, quindi compatibili con proporzioni orizzontali, verticali e quadrate.
- Nomi delle squadre adattati automaticamente con riduzione tipografica e disposizione multilinea.
- Risultato centrale con stato della partita e rigori, quando presenti.
- Informazioni gara organizzate in card: data/ora, campo, arbitro e turno.
- Marcatori separati per squadra e aggregati: ogni giocatore appare una sola volta con numero di maglia e quantità (`×N`).
- In Kings League vengono mostrati anche i punti realizzati quando differiscono dal numero di gol.
- Altezza del canvas calcolata in base al numero massimo di marcatori, evitando tagli e sovrapposizioni.

## Gestione marcatori admin

- Campo numerico “Gol segnati” nell’inserimento rapido.
- Una sola riga per giocatore: aggiungendo nuovamente lo stesso marcatore, la quantità viene incrementata.
- Ogni riga consente di:
  - cambiare il giocatore;
  - visualizzare automaticamente il numero di maglia;
  - modificare il numero di gol;
  - modificare il valore del gol in modalità Kings League;
  - rimuovere il marcatore.
- Autogol aggregati per squadra e quantità modificabile.
- Compatibilità mantenuta: al salvataggio le quantità vengono espanse negli eventi gol già utilizzati dal progetto.
- I minuti già presenti vengono conservati finché possibile durante l’aggregazione.

## Interfaccia responsive

- Griglia di inserimento basata su `auto-fit`.
- Righe marcatori adattive per desktop, tablet e smartphone.
- Controlli con larghezza minima azzerata e testi spezzabili, per evitare overflow con nomi lunghi.
- Card, bordi delicati, ombre leggere e spaziature uniformi.
- Nuove chiavi cache `v130-match-card` su CSS e JavaScript modificati.

## Visualizzazione pubblica

Anche le card e il dettaglio partita pubblici aggregano i gol per giocatore, mostrando quantità e numero di maglia senza ripetizioni.

## Test

Il nuovo test `tools/test-match-card-scorers.mjs` verifica:

- nomi di squadre e giocatori lunghi;
- 23 marcatori aggregati;
- un singolo giocatore con 18 gol;
- gol Kings League di valore doppio;
- autogol multipli;
- loghi orizzontali e verticali;
- crescita dinamica del canvas fino a 1080 × 2290 px;
- presenza dei controlli responsive nell’interfaccia admin.

Comandi validati:

```text
npm test
npm run lint
npm run build
npm run test:simulation
npm run test:calendar-share
npm run test:match-ui
npm run test:ui -- --logos-only
```

Il test UI mirato apre realmente l’editor marcatori nel browser headless, verifica l’unione di due inserimenti dello stesso giocatore (4 + 2 = 6), la modifica del giocatore, l’aggiornamento del numero di maglia e l’assenza di overflow a 320, 390, 768 e 1280 px.
