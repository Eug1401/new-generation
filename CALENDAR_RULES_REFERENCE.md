# Riferimento regole calendario

| Regola | Tipo | Ambito | Controllo |
| --- | --- | --- | --- |
| Accoppiamenti della prima giornata | Obbligatoria | Prima giornata | Squadre valide, distinte e nello stesso girone/fase |
| Campo e orario di una partita fissata | Obbligatoria | Partita bloccata | Slot disponibile e nessuna sovrapposizione |
| Riposo minimo | Obbligatoria | Tutte le squadre | Intervallo tra fine e inizio almeno pari al minimo |
| Orario d'esordio | Obbligatoria | Prima partita cronologica | Orario esatto compatibile con gli altri vincoli |
| Campo naturale del girone | Strutturale | Fase a gironi | Uso prioritario del campo assegnato |
| Prestito del campo libero | Strutturale | Gironi diversi | Solo se il proprietario non ha una partita pronta e il campo naturale dell'ospite è occupato |
| Minimizzazione partite consecutive | Obbligatoria | Calendario complessivo | Ottimo globale, mai preferenza disattivabile |

## Ordine di confronto delle soluzioni

1. Rispetto di tutti i vincoli obbligatori.
2. Minimo orizzonte temporale e minimo numero di buchi interni riempibili.
3. Minimo numero di squadre uniche con almeno una coppia consecutiva.
4. Minimo numero totale di occorrenze consecutive.
5. Minimo numero di sequenze di almeno tre partite consecutive.
6. Distribuzione più equilibrata dei tempi di riposo.
7. Scelta deterministica di una qualsiasi soluzione ancora equivalente.

## Garanzia di correttezza

Lo scheduler usa enumerazione esatta, backtracking, branch and bound e memoization. Un ramo viene eliminato soltanto tramite un limite inferiore sicuro o perché viola un vincolo obbligatorio. Non sono usati greedy, casualità o limiti temporali nell'azione standard dell'interfaccia.

L'oggetto `optimality` riporta algoritmo, orizzonti testati, nodi esplorati, rami potati e valore dell'obiettivo. `provenOptimal` è vero solo per una ricerca completata.

## Prontezza di una partita

Per ogni squadra viene costruita la catena dei propri incontri. Una partita può essere collocata soltanto dopo che entrambe le squadre hanno disputato le rispettive partite precedenti. Questo consente di riempire uno slot con una giornata numericamente successiva senza violare l'ordine sportivo individuale.

## Nessuna soluzione

Se i vincoli sono incompatibili, la ricerca restituisce `INFEASIBLE`, non salva un calendario parziale e non rilassa automaticamente alcuna regola.
