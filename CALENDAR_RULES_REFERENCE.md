# Calendar Rules Reference

| Regola | Tipo | Entita | Compatibilita | Errore |
| --- | --- | --- | --- | --- |
| Accoppiamento prima giornata | Rigida | Partita | Gironi + KO, Classifica unica + KO | Squadra duplicata, squadra fuori girone, squadra contro se stessa |
| Campo partita fissata | Rigida | Partita | Tornei con campi configurati | Campo non disponibile o bloccato |
| Orario partita fissata | Rigida | Partita | Tornei in un giorno | Slot non disponibile o in conflitto |
| Indisponibilita squadra | Rigida | Squadra | Tutte le modalita supportate | Squadra pianificata nello slot bloccato |
| Blocco campo | Rigida | Campo | Tutte le modalita supportate | Campo occupato durante il blocco |
| Riposo minimo | Rigida | Squadra | Tornei in un giorno | Differenza tra fine e inizio sotto soglia |
| Esordio prima giornata | Rigida/preferenza | Squadra | Tutte le modalita supportate | Prima partita reale non in giornata 1 |
| Esordio giornata esatta | Rigida/preferenza | Squadra | Tutte le modalita supportate | Prima partita in giornata diversa |
| Esordio non prima/entro | Rigida/preferenza | Squadra | Tutte le modalita supportate | Prima partita fuori intervallo |
| Esordio campo/orario | Rigida/preferenza | Squadra | Dipende da campi/orari | Prima partita su campo/orario diverso |
| Esordio contro avversaria | Rigida/preferenza | Squadra | Squadre nello stesso scope | Prima partita contro altra squadra |

Le regole rigide bloccano la conferma. Le preferenze non soddisfatte vengono mostrate nel report di fattibilita.

## Semplificazione

Le preferenze possono essere rilassate solo nella generazione semplificata e solo dopo conferma esplicita. Non vengono mai rilassati: indisponibilita assolute, blocchi campo, durata/intervalli obbligatori, assenza di sovrapposizioni e regole marcate come rigide. Campo 1 e Campo 2 sono equivalenti salvo blocchi campo espliciti: nessuno dei due campi ha preferenza automatica.
