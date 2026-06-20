(function(){
  const store=NexoraStore, UI=NexoraUI;
  const state=store.load('admin');
  const params=new URLSearchParams(location.search);
  const type=params.get('type')||'calendar';

  function today(){
    return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date());
  }

  function countLive(){return (state.matches||[]).filter(m=>m.status==='live').length;}
  function countPlayed(){return (state.matches||[]).filter(m=>store.hasScore(state,m)).length;}
  function summaryGrid(items){
    return `<div class="report-mini-grid">${items.map(item=>`<article class="report-mini-card ${item.accent?'accent':''}"><span>${UI.esc(item.label)}</span><strong>${UI.esc(String(item.value??'-'))}</strong>${item.note?`<small>${UI.esc(item.note)}</small>`:''}</article>`).join('')}</div>`;
  }
  function reportNote(text, kind='info'){
    return `<div class="report-note ${UI.esc(kind)}">${UI.esc(text)}</div>`;
  }

  function reportHeader(title, subtitle, kicker='Report ufficiale'){
    const r=state.rules || {};
    return `
      <section class="pdf-hero report-hero-upgrade">
        <div class="pdf-brand-row">
          <div class="brand">
            <div class="logo"><span></span></div>
            <div>
              <span class="pdf-kicker">${UI.esc(kicker)}</span>
              <h1>${UI.esc(title)}</h1>
              <p>${UI.esc(subtitle)}</p>
            </div>
          </div>
          <div class="pdf-meta">
            <span>${UI.esc(r.name || 'New Generation')}</span>
            <small>Generato: ${UI.esc(today())}</small>
          </div>
        </div>
        <div class="pdf-info-grid report-info-grid-upgrade">
          <span><strong>Formato</strong>${UI.esc(store.FORMAT_LABELS[r.format] || r.format || '-')}</span>
          <span><strong>Squadre</strong>${state.teams.length}</span>
          <span><strong>Partite</strong>${state.matches.length}</span>
          <span><strong>Campi</strong>${UI.esc(r.fieldCount || '-')}</span>
        </div>
      </section>`;
  }

  function standingsRowsTable(rows){
    return `<table class="pdf-table compact standings-report-table">
      <thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>PG</th><th>GF</th><th>GS</th><th>DR</th></tr></thead>
      <tbody>${rows.map((r,i)=>`
        <tr>
          <td><span class="pdf-rank">${i+1}</span></td>
          <td><strong>${UI.esc(r.name)}</strong></td>
          <td><strong>${r.points}</strong></td>
          <td>${r.played}</td>
          <td>${r.goalsFor}</td>
          <td>${r.goalsAgainst}</td>
          <td>${r.diff>0?'+':''}${r.diff}</td>
        </tr>`).join('') || '<tr><td colspan="7">Nessuna squadra disponibile.</td></tr>'}</tbody>
    </table>`;
  }

  function standingsLead(rows){
    const leader=rows[0]||null;
    const bestAttack=rows.slice().sort((a,b)=>b.goalsFor-a.goalsFor||a.name.localeCompare(b.name))[0]||null;
    const bestDefense=rows.slice().sort((a,b)=>a.goalsAgainst-b.goalsAgainst||a.name.localeCompare(b.name))[0]||null;
    return summaryGrid([
      {label:'Capolista',value:leader?leader.name:'—',note:leader?`${leader.points} pt · DR ${leader.diff>0?'+':''}${leader.diff}`:'Nessun dato',accent:true},
      {label:'Miglior attacco',value:bestAttack?bestAttack.name:'—',note:bestAttack?`${bestAttack.goalsFor} gol fatti`:'Nessun dato'},
      {label:'Miglior difesa',value:bestDefense?bestDefense.name:'—',note:bestDefense?`${bestDefense.goalsAgainst} gol subiti`:'Nessun dato'},
      {label:'Partite consolidate',value:countPlayed(),note:countLive()?`${countLive()} live escluse`:'Nessun live in corso'}
    ]);
  }

  function compactStandingsTable(){
    const grouped=store.selectors.hasGroupStage(state)?store.selectors.groupedStandings(state):[];
    if(grouped.length){
      return grouped.map(g=>`
        <section class="pdf-card report-card-upgrade">
          <div class="pdf-section-title report-section-head">
            <div><span class="pdf-kicker">Classifica girone</span><h2>${UI.esc(g.name)}</h2></div>
            <p>${g.completed?'Girone completato':'Girone in corso'} · I dati live non vengono consolidati nel report.</p>
          </div>
          ${standingsLead(g.rows)}
          ${standingsRowsTable(g.rows)}
        </section>`).join('');
    }
    const rows=store.selectors.officialStandings?store.selectors.officialStandings(state):store.selectors.calculateStandings(state);
    return `
      <section class="pdf-card report-card-upgrade">
        <div class="pdf-section-title report-section-head">
          <div><span class="pdf-kicker">Classifica ufficiale</span><h2>Classifica squadre</h2></div>
          <p>Punti, partite giocate, gol fatti, gol subiti e differenza reti.</p>
        </div>
        ${standingsLead(rows)}
        ${countLive()?reportNote('Le partite in stato Live non incidono sulla classifica PDF e restano fuori dai conteggi ufficiali.','warning'):''}
        ${standingsRowsTable(rows)}
      </section>`;
  }

  function calendarRows(){
    const matches=[...state.matches].sort((a,b)=>(a.roundIndex-b.roundIndex)||String(a.date||'').localeCompare(String(b.date||''))||String(a.time||'').localeCompare(String(b.time||'')));
    const pause=store.oneDayCalendarPauseEvent?store.oneDayCalendarPauseEvent(state.rules):null;
    const rows=matches.map(m=>({type:'match',date:m.date||'',time:m.time||'',match:m}));
    if(pause&&matches.some(m=>m.date===pause.date))rows.push({type:'pause',date:pause.date,time:pause.time,event:pause});
    rows.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||(a.type==='pause'?-1:1));
    return rows;
  }

  function compactCalendarTable(){
    const rows=calendarRows();
    const matchRows=rows.filter(r=>r.type==='match');
    const played=matchRows.filter(r=>store.hasScore(state,r.match)).length;
    const pending=matchRows.length-played;
    return `
      <section class="pdf-card report-card-upgrade">
        <div class="pdf-section-title report-section-head">
          <div><span class="pdf-kicker">Programma gare</span><h2>Calendario partite</h2></div>
          <p>Documento sintetico e leggibile: squadre, campo, data e stato ufficiale della partita.</p>
        </div>
        ${summaryGrid([
          {label:'Partite totali',value:matchRows.length,note:'Intero calendario'},
          {label:'Giocate',value:played,note:'Risultati consolidati',accent:true},
          {label:'Da giocare',value:pending,note:countLive()?`${countLive()} live mostrate come da giocare`:'In attesa di referto'},
          {label:'Campi attivi',value:state.rules?.fieldCount||'-',note:'Configurazione torneo'}
        ])}
        ${countLive()?reportNote('Controllo logico attivo: le partite live non vengono riportate come concluse nel PDF, ma restano indicate come “Da giocare”.','warning'):''}
        <table class="pdf-table compact calendar-report-table">
          <thead>
            <tr><th>Fase / giornata</th><th>Partita</th><th>Campo</th><th>Data</th><th>Stato</th></tr>
          </thead>
          <tbody>
            ${rows.map(row=>{
              if(row.type==='pause')return `<tr><td><span class="pdf-pill">Pausa</span><br><small>Torneo giornaliero</small></td><td><strong>${UI.esc(row.event.label)}</strong></td><td>-</td><td>${UI.esc(row.event.date)} ${UI.esc(row.event.time)}</td><td><span class="pdf-status todo">${UI.esc(row.event.duration)} min</span></td></tr>`;
              const m=row.match;
              const home=store.teamName(state,m.homeTeamId,m.homeLabel);
              const away=store.teamName(state,m.awayTeamId,m.awayLabel);
              const hasScore=store.hasScore(state,m);
              const status=hasScore ? store.scoreText(state,m) : 'Da giocare';
              const phase=store.PHASE_LABELS[m.phase] || m.phase || '-';
              return `<tr>
                <td><span class="pdf-pill">${UI.esc(phase)}</span><br><small>${UI.esc(m.round || '-')}</small></td>
                <td><strong>${UI.esc(home)}</strong><span class="muted"> vs </span><strong>${UI.esc(away)}</strong></td>
                <td>${UI.esc(m.field || 'Campo da definire')}</td>
                <td>${UI.esc(UI.fmtDate(m))}</td>
                <td><span class="pdf-status ${hasScore?'done':'todo'}">${UI.esc(status)}</span></td>
              </tr>`;
            }).join('') || '<tr><td colspan="5">Nessuna partita disponibile.</td></tr>'}
          </tbody>
        </table>
      </section>`;
  }

  function compactBracketReport(){
    const data=store.bracketData(state);
    if(!data.available){return `<section class="pdf-card report-card-upgrade"><h2>Tabellone</h2><div class="empty">${UI.esc(data.message)}</div></section>`;}
    const flat=data.brackets.flatMap(b=>b.rounds.flatMap(r=>r.matches));
    const completed=flat.filter(m=>store.hasScore(state,m)).length;
    return `${summaryGrid([
      {label:'Blocchi tabellone',value:data.brackets.length,note:'Percorsi fase finale'},
      {label:'Match KO',value:flat.length,note:'Totale incontri programmati'},
      {label:'Consolidati',value:completed,note:countLive()?`${countLive()} live escluse`:'Aggiornamento ufficiale',accent:true},
      {label:'Formato',value:store.FORMAT_LABELS[state.rules?.format] || state.rules?.format || '-',note:'Formula torneo'}
    ])}
    ${countLive()?reportNote('Nel tabellone i match live non vengono mostrati come conclusi: restano “Da giocare” fino alla chiusura del referto.','warning'):''}
    ${data.brackets.map(bracket=>`
      <section class="pdf-card bracket-report-card report-card-upgrade">
        <div class="pdf-section-title report-section-head"><div><span class="pdf-kicker">Fase finale</span><h2>${UI.esc(bracket.name)}</h2></div><p>Tabellone essenziale con squadre, placeholder e risultato se disponibile.</p></div>
        ${bracket.rounds.map(round=>`
          <h3 class="pdf-round-title">${UI.esc(round.name)}</h3>
          <table class="pdf-table compact bracket-report-table">
            <thead><tr><th>#</th><th>Casa / lato A</th><th>Ospite / lato B</th><th>Risultato</th><th>Stato</th></tr></thead>
            <tbody>
              ${round.matches.map((m,i)=>{
                const home=store.teamName(state,m.homeTeamId,m.homeLabel);
                const away=store.teamName(state,m.awayTeamId,m.awayLabel);
                const done = store.hasScore(state,m) && m.status!=='live';
                return `<tr><td>${i+1}</td><td><strong>${UI.esc(home)}</strong></td><td><strong>${UI.esc(away)}</strong></td><td>${done?UI.esc(store.scoreText(state,m)):'-'}</td><td><span class="pdf-status ${done?'done':'todo'}">${done?'Giocata':'Da giocare'}</span></td></tr>`;
              }).join('')}
            </tbody>
          </table>`).join('')}
      </section>`).join('')}`;
  }

  function render(){
    const root=UI.$('#printRoot');
    if(type==='standings'){
      root.innerHTML = reportHeader(`Classifica · ${state.rules.name}`,'Report editoriale ufficiale con impaginazione più leggibile e coerente con il sito.') + compactStandingsTable();
    }else if(type==='bracket'){
      root.innerHTML = reportHeader(`Tabellone · ${state.rules.name}`,'Report editoriale ufficiale della fase finale, con focus su chiarezza e leggibilità.') + compactBracketReport();
    }else{
      root.innerHTML = reportHeader(`Calendario · ${state.rules.name}`,'Report editoriale ufficiale del calendario, con stato logico coerente anche in presenza di match live.') + compactCalendarTable();
    }
    setTimeout(()=>window.print(),450);
  }

  render();
})();
