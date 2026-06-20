NEW GENERATION v19

STRUTTURA
- index.html: pagina pubblica read-only.
- admin.html: dashboard admin.
- admin-rules.html: regole, format torneo, campi, date e generazione calendario.
- admin-teams.html: gestione squadre e loghi caricati da dispositivo.
- admin-players.html: gestione giocatori filtrata per squadra.
- admin-matches.html: compilazione partite e referti.
- admin-reports.html: classifica, statistiche, tabellone e PDF.
- print.html: report PDF brandizzati New Generation.

REBRAND v19
- Nome app aggiornato da Nexora Cup a New Generation.
- Logo ufficiale inserito in assets/brand/new-generation-logo.jpg.
- Palette aggiornata: nero profondo, oro, crema e bianco.
- Grafica aggiornata per header, card, tabelle, pulsanti, tabelloni e PDF.

NOTE
L'app resta statica e usa localStorage. Per condividere dati live tra admin e utenti serve un backend condiviso.

SUPABASE BACKEND CONDIVISO
--------------------------
Questa versione può funzionare con Supabase per avere dati condivisi tra admin e utenti pubblici.
1. Crea progetto Supabase.
2. Esegui SUPABASE_SETUP.sql in SQL Editor.
3. Crea l'utente admin in Authentication > Users.
4. Copia Project URL e anon public key in assets/js/supabase-config.js.
5. Imposta ENABLED:true.
6. Pubblica la cartella su hosting statico.

Quando Supabase è attivo:
- la pagina pubblica legge i dati online;
- l'admin deve fare login;
- ogni salvataggio admin aggiorna tutti gli utenti;
- non serve più export/import JSON.

AGGIORNAMENTO v21 - Articoli
- Aggiunta pagina admin-articles.html per creare, modificare ed eliminare articoli.
- Ogni articolo contiene titolo, corpo testo e al massimo una immagine principale caricata dal dispositivo.
- Gli articoli vengono salvati nello stesso stato condiviso Supabase, quindi la pagina pubblica li mostra a tutti gli utenti.
- Nella pagina pubblica index.html è presente il tab Articoli.
- La ricerca pubblica trova anche titolo e testo degli articoli.
- Le immagini articolo vengono compresse lato browser e salvate come Data URL nello stato JSON. Per molti articoli o immagini pesanti, in futuro è consigliato Supabase Storage.

VERSIONE 22 - Pianificazione giorni di gioco
- In Regole & calendario puoi ora selezionare i giorni della settimana in cui il torneo può giocare.
- La preview suggerisce una data fine realistica in base a formato, numero squadre, campi disponibili e giorni selezionati.
- Nei tornei multi-giorno la generazione usa solo i giorni selezionati e blocca il calendario se l'intervallo data inizio/fine non basta.
- Nei tornei tutto in un giorno restano validi ora inizio, ora fine, durata partita, pause e numero campi.
- I vincoli anti-sovrapposizione restano attivi: nessun campo doppio nello stesso slot/giorno e nessuna squadra in due partite nello stesso giorno nei tornei lunghi.

--- VERSIONE 23 ---
Nuove funzionalità:
- Nei tornei con gironi l'admin può configurare ogni girone singolarmente: nome, numero squadre e numero qualificate.
- La somma delle squadre configurate nei gironi deve coincidere con le squadre iscritte.
- Il tabellone post-gironi viene generato automaticamente in base alle qualificate impostate per ciascun girone, con placeholder e BYE quando necessari.
- Nei tornei tutto in un giorno non si imposta più l'ora fine: viene calcolata automaticamente in base a partite, campi, durata e pause.
- Aggiunta modalità Kings League: quando è attiva, nel referto partita ogni marcatore può avere peso gol 1 o 2. Risultato, classifica e statistiche usano il peso selezionato.
- La versione resta compatibile con Supabase: non servono nuove tabelle, perché le nuove impostazioni vengono salvate nello stesso JSONB app_state.data.


Aggiornamento v25:
- Tabellone ottimizzato per mobile con vista elenco per turno.
- Classifica marcatori limitata alla Top 10 quando non si filtra per squadra.
- Selezionando una squadra, admin e pubblico mostrano le statistiche complete di tutti i giocatori della squadra.
- Inserimento gol e cartellini più guidato: prima scegli la squadra, poi cerchi/selezioni il calciatore.
