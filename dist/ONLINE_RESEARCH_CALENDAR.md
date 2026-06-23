# Online Research Calendar

Data ricerca: 2026-06-23.

| Regola individuata | Fonte | Presente nel progetto | Utilita | Complessita | Decisione |
| --- | --- | ---: | ---: | ---: | --- |
| Vincoli no-overlap per risorse | Google OR-Tools job shop scheduling: https://developers.google.com/optimization/scheduling/job_shop | Parziale | Alta | Media | Implementati per campo/squadra |
| Vincoli di precedenza e slot | Google OR-Tools CP-SAT: https://developers.google.com/optimization/cp/cp_solver | Parziale | Alta | Alta | Implementati senza solver esterno |
| Round-robin e numero turni | Round-robin tournament: https://en.wikipedia.org/wiki/Round-robin_tournament | Si | Alta | Bassa | Esteso con prima giornata fissata |
| Condivisione file immagine | MDN Navigator.share: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share | No | Alta | Bassa | Implementata per immagini pubbliche |
| Accessibilita modali/focus/contrasto | W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/ | Parziale | Alta | Media | Integrata in wizard e preview |

## Regole aggiunte

- Accoppiamenti fissati.
- Slot/campo fissati per match manuali.
- Indisponibilita squadra.
- Blocchi campo.
- Riposo minimo.
- Esordi con vincolo rigido o preferenza.
- Report dei conflitti.

## Regole escluse

- Solver CP-SAT esterno: escluso per non introdurre dipendenze pesanti in una app statica.
- Rigenerazione parziale visuale drag/drop: esclusa in questa iterazione per ridurre rischio regressioni.
- Ottimizzazione globale delle preferenze: documentata come limite.
