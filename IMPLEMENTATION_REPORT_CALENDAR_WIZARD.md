# Rapporto aggiornato — Configura e genera calendario

Data verifica: 23 giugno 2026

Questo documento sostituisce la descrizione precedente della sezione **Vincoli**. La versione corrente supporta esclusivamente l'orario esatto d'esordio della squadra.

## Stato del wizard

I passaggi **Preferenze** e **Prima giornata** restano invariati. La sezione **Vincoli** contiene soltanto:

- selezione della squadra;
- selezione di un orario disponibile;
- aggiunta, modifica ed eliminazione del vincolo;
- validazione inline e blocco del passaggio all'anteprima in caso di errori.

Il modello `rules.calendarCustomization.teamDebuts` accetta soltanto elementi con `kind: "exactTime"`. I tipi precedenti vengono eliminati durante la normalizzazione e non influenzano più lo scheduler.

## Scheduler su due campi

La mappatura girone-campo è una priorità, non un divieto assoluto. Lo scheduler programma prima ogni girone sul proprio campo. Se un campo resta libero, può collocarvi una seconda partita pronta dell'altro girone soltanto quando il campo naturale di quest'ultimo è già occupato nello stesso slot e il girone proprietario del campo libero non ha una partita valida.

La prontezza viene calcolata attraverso le precedenze delle singole squadre e non più limitando la ricerca alle partite dello stesso `roundIndex`.

## Persistenza

L'anteprima continua a lavorare su una copia. Il calendario esistente viene sostituito soltanto dopo conferma esplicita e la generazione ricostruisce l'elenco completo delle partite.

Per cause, file e risultati completi vedere `IMPLEMENTATION_REPORT_SCHEDULER_FIELDS.md`.
