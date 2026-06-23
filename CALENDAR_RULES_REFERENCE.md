# Riferimento regole calendario

| Regola | Tipo | Ambito | Validazione principale |
| --- | --- | --- | --- |
| Accoppiamenti della prima giornata | Obbligatoria | Partite della prima giornata | Squadre valide, non duplicate e appartenenti allo stesso girone o fase |
| Campo/orario di una partita fissata | Obbligatoria | Partita configurata nella prima giornata | Campo e slot disponibili, nessuna sovrapposizione |
| Riposo minimo | Obbligatoria | Tutte le squadre | Intervallo tra fine e inizio non inferiore al minimo configurato |
| Orario d'esordio | Obbligatoria | Prima partita cronologica della squadra | Orario esatto disponibile e compatibile con campi e altre regole |
| Campo naturale del girone | Priorità strutturale | Fase a gironi | Il girone viene programmato prima sul campo assegnato |
| Prestito del campo libero | Fallback strutturale | Fase a gironi | Ammesso solo quando il proprietario non ha una partita valida e il campo naturale del girone ospite è già occupato |
| Preferenze del profilo | Non obbligatoria | Generazione completa | Applicate dopo le regole strutturali e i vincoli obbligatori |

## Ordine di priorità

1. Validità strutturale del torneo.
2. Nessuna sovrapposizione per squadre e campi.
3. Disponibilità di date, orari, durata e riposo minimo.
4. Orario esatto d'esordio.
5. Configurazione esplicita della prima giornata.
6. Assegnazione abituale di ogni girone al proprio campo.
7. Uso dell'altro campo soltanto per riempire uno slot altrimenti inutilizzato.
8. Preferenze non obbligatorie.

## Prontezza di una partita

Le partite dei gironi non vengono più valutate esclusivamente per `roundIndex`. Per ogni squadra viene costruita una catena delle proprie partite: un incontro può essere programmato soltanto dopo l'incontro precedente di entrambe le squadre.

In questo modo una partita realmente pronta può riempire un campo libero anche se appartiene a una giornata numericamente successiva, senza far giocare una squadra fuori ordine o contemporaneamente su due campi.

## Mancanza di una soluzione

I vincoli obbligatori non vengono ignorati. Se non esiste una soluzione completa, la generazione si interrompe, non salva partite parziali e restituisce un errore leggibile al wizard.
