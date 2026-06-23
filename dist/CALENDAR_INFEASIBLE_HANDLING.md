# Calendar Infeasible Handling

## Obiettivo

Quando il calendario personalizzato non e fattibile, il flusso non salva partite parziali e non perde la configurazione. Lo store restituisce risultati strutturati con `status` stabile e il wizard mostra un pannello dedicato.

## Stati restituiti

- `FEASIBLE`: calendario valido.
- `FEASIBLE_WITH_WARNINGS`: calendario valido con preferenze o avvisi non bloccanti.
- `SIMPLIFICATION_AVAILABLE`: calendario personalizzato non fattibile, ma esistono preferenze rilassabili.
- `SIMPLIFIED_SOLUTION`: proposta semplificata valida, non ancora salvata.
- `NO_SOLUTION`: nessuna proposta valida senza modificare vincoli obbligatori.
- `TIMEOUT`: tempo massimo superato, distinto dall infattibilita.
- `TECHNICAL_ERROR`: eccezione o errore tecnico, distinto dall infattibilita.

## Flusso UI

1. L amministratore richiede l anteprima.
2. Se non fattibile, appare il pannello `Impossibile generare il calendario personalizzato`.
3. Il pannello elenca conflitti, suggerimenti e azioni:
   - `Modifica le regole`;
   - `Genera calendario semplificato`;
   - `Annulla`.
4. La semplificazione richiede il pulsante esplicito `Conferma e genera proposta semplificata`.
5. La proposta semplificata viene mostrata come anteprima e si salva solo con `Conferma e crea calendario`.

## Livelli di semplificazione

- Livello 1: rilassa preferenze secondarie, bilanciamento perfetto, attese e partite consecutive.
- Livello 2: rilassa anche accoppiamenti ed esordi indicati come preferiti.
- Livello 3: usa calendario essenziale, rimuovendo seed/ordine preferenziale.

Il sistema prova i livelli in ordine e si ferma al primo livello sufficiente.

## Vincoli mai rilassati

- Modalita del torneo.
- Squadre, gironi e appartenenza ai gironi.
- Numero corretto di incontri.
- Divieto squadra contro se stessa.
- Assenza di duplicati.
- Assenza di sovrapposizioni squadra/campo.
- Durata e intervalli obbligatori.
- Indisponibilita assolute.
- Blocchi campo.
- Regole `hard` di prima giornata ed esordio.

## Conservazione dati

La configurazione originale resta nella bozza e, quando si conferma una proposta semplificata, viene salvato in `rules.calendarSimplification`:

- configurazione originale;
- configurazione semplificata;
- livello applicato;
- preferenze rilassate;
- tentativi eseguiti;
- data di validazione;
- seed/variante.

## Test coperti

`tools/test-calendar-share.mjs` copre:

- anteprima fattibile senza salvataggio;
- preferenza incompatibile con proposta semplificata;
- vincolo obbligatorio incompatibile bloccato;
- Campo 1 e Campo 2 sono equivalenti: Campo 1 bloccato non blocca il calendario se Campo 2 e disponibile;
- nessuna partita salvata prima della conferma;
- timeout distinto dall infattibilita;
- errore tecnico distinto dall infattibilita.
