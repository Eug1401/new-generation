# Vincoli di esordio

Per esordio si intende la prima partita cronologica della squadra nella fase iniziale:

- `groups_knockout`: prima partita nel proprio girone;
- `league_knockout`: prima partita nella classifica unica.

L'ordine cronologico usa giornata, data, orario, campo e identificatore stabile.

## Orario minimo

Tipo dati: `teamDebuts[].kind = "minTime"`.

Esempio:

```json
{"teamId":"team_1","kind":"minTime","value":"16:00","mode":"hard"}
```

La regola vale solo per la prima partita della squadra. Le partite successive possono essere prima o dopo quell'orario secondo il calendario.

## Posizione nella giornata 1

Tipo dati: `teamDebuts[].kind = "firstRoundPosition"`.

Esempio:

```json
{"teamId":"team_1","kind":"firstRoundPosition","value":"2","mode":"hard"}
```

La posizione indica l'ordine cronologico delle partite nella giornata 1 del girone o della fase iniziale. Con due campi simultanei l'ordine stabile e:

1. orario;
2. numero campo;
3. identificatore partita.

## Combinazione e conflitti

I due vincoli possono essere associati alla stessa squadra. Se la posizione richiesta cade prima dell'orario minimo, la preview viene respinta e nessuna partita viene salvata.

## Report anteprima

La preview contiene `ruleReport.debutChecks`, con squadra, vincolo, valore richiesto, valore ottenuto ed esito.
