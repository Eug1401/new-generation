# Riferimento regole calendario

| Regola | Tipo | Ambito | Validazione principale |
| --- | --- | --- | --- |
| Accoppiamenti della prima giornata | Obbligatoria | Partite della prima giornata | Squadre valide, non duplicate e appartenenti allo stesso ambito previsto |
| Campo/orario di una partita fissata | Obbligatoria | Partita configurata nella prima giornata | Campo e slot disponibili, nessuna sovrapposizione |
| Riposo minimo | Obbligatoria | Tutte le squadre | Intervallo tra fine e inizio non inferiore al minimo configurato |
| Orario d'esordio | Obbligatoria | Prima partita cronologica della squadra | Orario esatto disponibile e compatibile con campi, date e altri vincoli |
| Posizione nella prima giornata | Obbligatoria | Ordine complessivo della prima giornata | Posizione esistente e non assegnata in modo incompatibile a un'altra partita |
| Campo preferito del girone | Priorità strutturale | Fase a gironi | Il girone resta sul proprio campo salvo utilizzo controllato di un campo altrimenti libero |
| Preferenze del profilo | Non obbligatoria | Generazione completa | Applicate solo dopo tutte le regole strutturali e i vincoli espliciti |

## Ordine di priorità

1. Validità strutturale del torneo.
2. Nessuna sovrapposizione per le squadre.
3. Disponibilità di campi, date e orari.
4. Vincoli espliciti inseriti dall'utente.
5. Assegnazione abituale di ogni girone al proprio campo.
6. Uso dell'altro campo soltanto quando rimarrebbe inutilizzato.
7. Preferenze non obbligatorie.

## Ordinamento della prima giornata

La posizione è calcolata sull'elenco complessivo delle partite della giornata, non separatamente per girone. L'ordine deterministico è:

1. data;
2. orario di inizio;
3. numero/ordine del campo;
4. girone;
5. coppia di squadre;
6. identificativo della partita.

## Mancanza di una soluzione

I vincoli espliciti non vengono ignorati o rilassati automaticamente. Se non esiste una soluzione completa, la generazione si interrompe, non salva partite parziali e restituisce conflitti leggibili al wizard.
