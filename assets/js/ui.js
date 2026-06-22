(function(){
  const store=window.NexoraStore;
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  function initials(name){return String(name||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();}
  // v126.12 - Stemma squadra: rendering basato su classe CSS.
  // I data-URL restano centralizzati in UN solo <style id="ngTeamLogos">:
  // il markup delle card contiene soltanto la classe stabile della squadra.
  // Quando lo stemma esiste non viene montato alcun fallback sopra il
  // background-image; le iniziali sono usate solo per squadre senza stemma.
  function logo(team,big=false){
    const tid=esc(team?.id||'');
    const inits=esc(initials(team?.name));
    const safeName=esc(team?.name||'squadra non definita');
    const hasLogo=Boolean(team?.logo);
    const classes=['team-logo-wrap'];
    if(big) classes.push('big');
    if(hasLogo) classes.push(`ng-tl-${tid}`);
    const fallback=hasLogo?'':`<span class="team-logo-fallback${big?' big':''}" aria-hidden="true"><span>${inits}</span></span>`;
    return `<span class="${classes.join(' ')}" data-team-id="${tid}" role="img" aria-label="Stemma di ${safeName}">${fallback}</span>`;
  }

  // Inietta/aggiorna lo <style id="ngTeamLogos"> con tutte le regole
  // .ng-tl-{teamId} { background-image:url(<data-url>) }. Chiamata UNA volta
  // per stato (su render dello state). I data-URL base64 generati da
  // canvas.toDataURL non contengono mai parentesi o virgolette, quindi
  // possono finire dentro url(...) senza escape.
  function injectTeamLogoStyles(state){
    if(!state || !Array.isArray(state.teams)) return;
    let style=document.getElementById('ngTeamLogos');
    if(!style){
      style=document.createElement('style');
      style.id='ngTeamLogos';
      document.head.appendChild(style);
    }
    let css='';
    for(const t of state.teams){
      if(t && t.id && t.logo){
        // class name safe: gli id sono uid alfanumerici/underscore
        css+=`.ng-tl-${t.id}{background-image:url(${t.logo})}\n`;
      }
    }
    // Update solo se diverso (no innerHTML inutili)
    if(style.textContent!==css) style.textContent=css;
  }
  function fmtDate(m){if(m.date&&m.time)return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date(`${m.date}T${m.time}`)); if(m.date)return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium'}).format(new Date(`${m.date}T00:00`)); return 'Da definire';}
  function teamOptions(state,selected=''){return `<option value="">Seleziona squadra</option>`+state.teams.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${esc(t.name)}</option>`).join('');}
  function playerOptions(state,match,selected=''){const ids=[match.homeTeamId,match.awayTeamId];let html='<option value="">Seleziona calciatore</option>';ids.forEach(tid=>{const t=store.getTeam(state,tid);if(!t)return;html+=`<optgroup label="${esc(t.name)}">`+t.players.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}${p.birthYear?' · '+esc(p.birthYear):''}</option>`).join('')+'</optgroup>';});return html;}
  function statsGrid(stats){const goalsLabel=stats.scoreGoals&&stats.scoreGoals!==stats.goals?`Gol reali / punteggio: ${stats.scoreGoals}`:'Gol';return `<div class="stat"><strong>${stats.teams}</strong><span>Squadre</span></div><div class="stat"><strong>${stats.players}</strong><span>Giocatori</span></div><div class="stat"><strong>${stats.presidents||0}</strong><span>Presidenti</span></div><div class="stat"><strong>${stats.matches}</strong><span>Partite</span></div><div class="stat"><strong>${stats.goals}</strong><span>${goalsLabel}</span></div><div class="stat"><strong>${stats.yellow}</strong><span>Gialli</span></div><div class="stat"><strong>${stats.red}</strong><span>Rossi</span></div>`;}
  function standingsTable(rows,state=null){return `<table class="standings-table"><thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>PG</th><th>GF</th><th>GS</th><th>DR</th><th>CR</th></tr></thead><tbody>${rows.map((r,i)=>{const t=state?store.getTeam(state,r.teamId):null;const liveCls=r.hasLive?' is-live-row':'';const liveDot=r.hasLive?'<span class="standings-live-dot" title="Partita in corso" aria-label="Live"></span>':'';const clickable=t?` class="standings-team-row${liveCls}" data-team-id="${esc(t.id)}" data-team-detail="${esc(t.id)}" tabindex="0" role="button" aria-label="Apri scheda ${esc(t.name)}"`:` class="${liveCls.trim()}"`;return `<tr${clickable}><td><span class="rank">${i+1}</span></td><td><div class="team-inline">${logo(t,false)}<strong>${esc(r.name)}</strong>${liveDot}</div></td><td><strong>${r.points}</strong></td><td>${r.played}</td><td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.diff>0?'+':''}${r.diff}</td><td>${Number(r.cards)||0}</td></tr>`}).join('')||'<tr><td colspan="8">Nessuna squadra.</td></tr>'}</tbody></table>`;}
  function groupStandingsSelector(state,selected='',id='groupStandingsFilter'){const groups=store.selectors.groupNames(state);if(!groups.length)return '';return `<div class="filters compact-filters group-standings-menu"><div><label>Classifica girone</label><select id="${esc(id)}"><option value="all" ${selected==='all'?'selected':''}>Tutti i gironi</option>${groups.map(g=>`<option value="${esc(g)}" ${g===selected?'selected':''}>${esc(g)}</option>`).join('')}</select></div></div>`;}
  function groupStandingsTables(state,selected='all',opts){const groups=store.selectors.groupedStandings(state,opts);if(!groups.length)return standingsTable(store.selectors.calculateStandings(state,undefined,opts),state);const visible=selected&&selected!=='all'?groups.filter(g=>g.name===selected):groups;return visible.map(g=>`<div class="group-standing-block"><div class="mini-section-title"><h3>${esc(g.name)}</h3><span class="pill">${g.completed?'Girone completato':'In corso'}</span></div>${standingsTable(g.rows,state)}</div>`).join('')||'<div class="empty">Nessun girone disponibile.</div>';}
  function playerStatsTable(rows){return `<table><thead><tr><th>Calciatore</th><th>Anno</th><th>Squadra</th><th>PG</th><th>Gol</th><th>Gialli</th><th>Rossi</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.birthYear||'-')}</td><td>${esc(r.teamName)}</td><td>${r.played}</td><td>${r.goals}</td><td>${r.yellow}</td><td>${r.red}</td></tr>`).join('')||'<tr><td colspan="7">Nessun giocatore.</td></tr>'}</tbody></table>`;}
  function presidentStatsTable(rows){return `<table><thead><tr><th>Presidente</th><th>Squadra</th><th>PG</th><th>Gol</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.teamName)}</td><td>${r.played}</td><td>${r.goals}</td></tr>`).join('')||'<tr><td colspan="4">Nessun gol presidente.</td></tr>'}</tbody></table>`;}
  function matchStatusMeta(state,m){
    if(store.matchStatusInfo)return store.matchStatusInfo(state,m);
    const played=store.hasScore(state,m)||m.status==='played';
    if(m.status==='live')return {key:'live',label:'Live',cls:'is-live'};
    return played?{label:'Giocata',cls:'is-played'}:{label:'Da giocare',cls:'is-pending'};
  }
  function matchCard(state,m,clickable=false){const homeT=store.getTeam(state,m.homeTeamId),awayT=store.getTeam(state,m.awayTeamId);const home=store.teamName(state,m.homeTeamId,m.homeLabel),away=store.teamName(state,m.awayTeamId,m.awayLabel);const goals=(m.goals||[]).map(g=>`${store.goalEventLabel?store.goalEventLabel(state,m,g):store.playerName(state,g.playerId)}${(!(store.isOwnGoalEvent&&store.isOwnGoalEvent(g))&&Number(g.weight)===2)?' (x2)':''}`).join(', ');const yellow=(m.cards||[]).filter(c=>c.type==='yellow').map(c=>store.playerName(state,c.playerId)).join(', ');const red=(m.cards||[]).filter(c=>c.type==='red').map(c=>store.playerName(state,c.playerId)).join(', ');const status=matchStatusMeta(state,m);const isLive=m.status==='live';const played=store.hasScore(state,m)||m.status==='played';const showScore=played||isLive||(store.hasGoals&&store.hasGoals(state,m));const score=showScore?store.matchGoals(state,m):null;const centerCls=isLive?'is-live':(played?'is-played':'is-pending');
    // Rigori: visibili solo se KO + pareggio + penalties valide
    let pBadge='';
    if(showScore&&score&&score.home===score.away&&store.isKnockoutPhase&&store.isKnockoutPhase(m)&&m.penalties){
      const p=store.normalizePenalties?store.normalizePenalties(m.penalties):m.penalties;
      if(p)pBadge=`<div class="fixture-penalty-row"><span>d.c.r.</span><strong>${p.home} - ${p.away}</strong></div>`;
    }
    return `<article class="match-card public-fixture-card ${clickable?'clickable':''} ${isLive?'is-live-card':''}" ${clickable?`data-match-detail="${m.id}" role="button" tabindex="0" aria-label="Apri dettaglio ${esc(home)} contro ${esc(away)}"`:''}><div class="match-card-head"><span class="pill">${esc(store.PHASE_LABELS[m.phase]||m.phase)} · ${esc(m.round)}</span><span class="score-badge match-status-badge ${status.cls}" role="status" aria-label="Stato partita: ${esc(status.label)}">${isLive?'🔴 ':''}${esc(status.label)}</span></div><div class="fixture-scoreline"><div class="fixture-team home">${logo(homeT,false)}<strong>${esc(home)}</strong></div><div class="fixture-center ${centerCls}"><strong>${showScore?`${score.home} - ${score.away}`:'VS'}</strong></div><div class="fixture-team away">${logo(awayT,false)}<strong>${esc(away)}</strong></div></div>${pBadge}<div class="fixture-meta-row"><span>🗓️ ${fmtDate(m)}</span><span>📍 ${esc(m.field||'Campo da definire')}</span><span>👤 ${esc(m.referee||'Arbitro da definire')}</span></div><div class="fixture-events"><span>⚽ ${goals?esc(goals):'nessun marcatore'}</span><span>🟨 ${yellow?esc(yellow):'nessuno'}</span><span>🟥 ${red?esc(red):'nessuno'}</span></div></article>`;}
  function pauseCard(event){return `<article class="match-card pause-card"><div class="match-top"><span class="pill">Pausa torneo</span><span class="score-badge">${esc(event.duration)} min</span></div><div class="match-teams"><div class="team-inline"><div class="team-logo-fallback"><span></span></div><h3>${esc(event.label||'Pausa programmata')}</h3></div></div><p class="muted">${esc(event.date)} · ${esc(event.time)} · Nessuna partita programmata in questo intervallo.</p><div class="event-lines"><p>☕ <strong>Intervallo:</strong> pausa inserita automaticamente nel calendario del torneo giornaliero.</p></div></article>`;}
  function matchList(state,matches=state.matches,clickable=false){
    const list=[...(matches||[])];
    const pause=store.oneDayCalendarPauseEvent?store.oneDayCalendarPauseEvent(state.rules):null;
    const includePause=pause&&list.some(m=>m.date===pause.date)&&list.length===state.matches.length;
    const items=list.map(m=>({type:'match',date:m.date||'',time:m.time||'',match:m}));
    if(includePause)items.push({type:'pause',date:pause.date,time:pause.time,event:pause});
    items.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||(a.type==='pause'?-1:1));
    return items.length?items.map(item=>item.type==='pause'?pauseCard(item.event):matchCard(state,item.match,clickable)).join(''):'<div class="empty">Nessuna partita disponibile.</div>';
  }
  function teamGrid(state){
    if(!state.teams.length)return '<div class="empty">Nessuna squadra.</div>';
    return `<div class="team-disclosure-list">${state.teams.map((t,i)=>{
      const staff=[];
      if(t.president?.name)staff.push(`<span><strong>Presidente</strong>${esc(t.president.name)}</span>`);
      if(t.coach?.name)staff.push(`<span><strong>Allenatore</strong>${esc(t.coach.name)}</span>`);
      const players=(t.players||[]).map(p=>`<li><strong>${esc(p.name)}</strong>${p.birthYear?` <span>${esc(p.birthYear)}</span>`:''}</li>`).join('')||'<li class="muted">Roster vuoto</li>';
      return `<details class="ng-disclosure team-disclosure" data-team-id="${esc(t.id)}" ${i===0?'':''}>
        <summary class="ng-disclosure-summary">
          <span class="disclosure-main">${logo(t,false)}<span><strong>${esc(t.name)}</strong><small>${(t.players||[]).length} calciatori${t.president?.name?` · Presidente: ${esc(t.president.name)}`:''}</small></span></span>
          <span class="disclosure-actions"><button class="btn small favorite-team-btn" type="button" data-favorite-placeholder="${esc(t.id)}">☆ Segui</button><span class="disclosure-action">Apri scheda</span></span>
        </summary>
        <div class="ng-disclosure-body team-profile-body">
          <div class="team-profile-hero">${logo(t,true)}<div><h3>${esc(t.name)}</h3><p class="muted">Scheda squadra, staff tecnico e rosa completa.</p></div></div>
          <div class="team-profile-meta">${staff.join('')||'<span><strong>Staff</strong>Non inserito</span>'}</div>
          <div class="team-profile-section"><h4>Roster</h4><ul class="roster-clean-list">${players}</ul></div>
          <div class="row-actions"><button class="btn small primary" data-team-pdf="${esc(t.id)}" type="button">Scarica scheda PDF</button></div>
        </div>
      </details>`;
    }).join('')}</div>`;
  }
  function rulesSummary(state){const r=state.rules;const comps=(r.eliminationCompetitions||[]).map(c=>`${c.name}: ${c.startRank}ª-${c.startRank+c.teams-1}ª`).join(' · ');const fixed=store.groupFieldMap?store.groupFieldMap(r):null;const groupFieldText=fixed?Object.entries(fixed).map(([g,f])=>`${g} → Campo ${f}`).join(' · '):'';return `<div class="summary-grid"><span><strong>Torneo</strong>${esc(r.name)}</span><span><strong>Formato</strong>${esc(store.FORMAT_LABELS[r.format]||r.format)}</span><span><strong>Modalità</strong>${r.oneDay?'Tutto in un giorno':'Più giorni'}</span><span><strong>Campi</strong>${esc(r.fieldCount)}</span><span><strong>Date</strong>${r.oneDay?esc(r.startDate||'Da definire'):esc(`${r.startDate||'?'} → ${r.endDate||'?'}`)}</span>${groupFieldText?`<span><strong>Gironi sui campi</strong>${esc(groupFieldText)}</span>`:''}${r.format==='league_knockout'?`<span><strong>Competizioni KO</strong>${esc(comps||'Nessuna')}</span>`:''}</div>`;}

  function bracketMarkup(state, compact=false){
    const data=store.bracketData(state);
    if(!data.available)return `<div class="empty">${esc(data.message)}</div>`;
    function teamLabel(match,side){
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      const label=side==='home'?match.homeLabel:match.awayLabel;
      const t=store.getTeam(state,id);return `${logo(t,false)}<span>${esc(store.teamName(state,id,label||'Da definire'))}</span>`;
    }
    function teamText(match,side){
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      const label=side==='home'?match.homeLabel:match.awayLabel;
      return esc(store.teamName(state,id,label||'Da definire'));
    }
    function resultClass(match,side){
      const wid=store.winnerId(state,match);
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      return wid&&id===wid?'winner':'';
    }
    function penaltyBadge(m){
      const sc=store.matchGoals(state,m);
      if(sc.home!==sc.away||!m.penalties)return '';
      const p=store.normalizePenalties?store.normalizePenalties(m.penalties):m.penalties;
      if(!p)return '';
      return `<div class="bracket-penalty-row" title="Vittoria ai rigori"><span>d.c.r.</span><strong>${p.home}-${p.away}</strong></div>`;
    }
    function matchCompact(m){
      const score=store.matchGoals(state,m);
      const status=store.hasScore(state,m)||m.status==='played'?'Giocata':'Da giocare';
      const sc=store.hasScore(state,m)?`${score.home} - ${score.away}`:'-';
      const pBadge=penaltyBadge(m);
      return `<article class="bracket-list-match bracket-detail-trigger" data-match-detail="${esc(m.id)}" role="button" tabindex="0" aria-label="Apri dettaglio ${teamText(m,'home')} contro ${teamText(m,'away')}">
        <div class="bracket-list-meta"><span>${esc(m.round)}</span><strong>${sc}</strong></div>
        <div class="bracket-list-teams"><span class="${resultClass(m,'home')}">${teamText(m,'home')}</span><em>vs</em><span class="${resultClass(m,'away')}">${teamText(m,'away')}</span></div>
        ${pBadge}
        <div class="bracket-list-footer"><small>${esc(m.field||'Campo da definire')} · ${esc(fmtDate(m))}</small><span>${status}</span></div>
      </article>`;
    }
    return `<div class="bracket-wrapper ${compact?'compact':''}">${data.brackets.map(bracket=>`
      <section class="bracket-block">
        <div class="section-title compact"><div><h3>${esc(bracket.name)}</h3><p>${esc(data.message)}</p></div></div>
        <p class="mobile-only-note bracket-mobile-hint">Vista mobile ottimizzata: i turni sono impilati in elenco. Su desktop il tabellone resta a colonne.</p>
        <div class="bracket-scroll desktop-bracket-view"><div class="bracket-grid">
          ${bracket.rounds.map(round=>`
            <div class="bracket-round">
              <h4>${esc(round.name)}</h4>
              <div class="bracket-matches">
                ${round.matches.map(m=>`
                  <article class="bracket-match bracket-detail-trigger" data-match-detail="${esc(m.id)}" role="button" tabindex="0" aria-label="Apri dettaglio ${teamText(m,'home')} contro ${teamText(m,'away')}">
                    <div class="bracket-match-head"><span class="bracket-meta">${esc(m.round)}</span><span class="bracket-open-hint">Dettaglio</span></div>
                    <div class="bracket-team ${resultClass(m,'home')}">${teamLabel(m,'home')}<strong>${store.hasScore(state,m)?store.matchGoals(state,m).home:''}</strong></div>
                    <div class="bracket-team ${resultClass(m,'away')}">${teamLabel(m,'away')}<strong>${store.hasScore(state,m)?store.matchGoals(state,m).away:''}</strong></div>
                    ${penaltyBadge(m)}
                    <small>${esc(m.field||'Campo da definire')} · ${esc(fmtDate(m))}</small>
                  </article>`).join('')}
              </div>
            </div>`).join('')}
        </div></div>
        <div class="bracket-mobile-list mobile-bracket-view">
          ${bracket.rounds.map(round=>`<section class="bracket-list-round"><h4>${esc(round.name)}</h4>${round.matches.map(matchCompact).join('')}</section>`).join('')}
        </div>
      </section>`).join('')}</div>`;
  }


  function fmtArticleDate(value){
    if(!value) return '';
    try{return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch(e){return '';}
  }
  function articlePlaceholder(title='NG'){
    const label=initials(title||'NG')||'NG';
    return `<div class="article-image article-placeholder" role="img" aria-label="Immagine articolo non disponibile"><span>${esc(label)}</span><small>NEWS</small></div>`;
  }
  function replaceBrokenArticleImage(img){
    const holder=document.createElement('div');
    holder.className='article-image article-placeholder';
    holder.setAttribute('role','img');
    holder.setAttribute('aria-label','Immagine articolo non disponibile');
    const title=(img?.dataset?.articleTitle||img?.alt||'NG').replace(/^Immagine articolo\s*/i,'').trim();
    const label=initials(title||'NG')||'NG';
    holder.innerHTML=`<span>${esc(label)}</span><small>NEWS</small>`;
    img?.closest('.article-media')?.classList.add('image-fallback');
    img?.replaceWith(holder);
  }
  function articleImageMarkup(article){
    const title=article?.title||'articolo';
    const src=String(article?.image||'').trim();
    if(!src)return articlePlaceholder(title);
    return `<img class="article-image" src="${esc(src)}" alt="Immagine articolo ${esc(title)}" data-article-title="${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  function articleCard(article, admin=false){
    const rawBody=String(article.body||'').trim();
    const body=esc(rawBody).replace(/\n/g,'<br>');
    const date=esc(fmtArticleDate(article.updatedAt||article.createdAt));
    const title=esc(article.title||'News');
    const openAttrs=!admin?` role="button" tabindex="0" aria-label="Leggi articolo completo: ${title}" data-article-open="${esc(article.id)}"`:'';
    const readButton=!admin?`<div class="article-actions"><button class="btn small primary article-read-btn" type="button" data-article-open="${esc(article.id)}">Leggi tutto</button></div>`:'';
    return `<article class="article-card sports-news-card ${admin?'admin-news-card':''}" data-article-id="${esc(article.id)}"${openAttrs}>
      <div class="article-media">
        ${articleImageMarkup(article)}
        <div class="article-media-shade"></div>
        <span class="article-kicker media-kicker">NEWS</span>
      </div>
      <div class="article-content">
        <div class="article-meta"><span class="article-kicker">Articolo</span>${date?`<time datetime="${esc(article.updatedAt||article.createdAt||'')}">${date}</time>`:''}</div>
        <h3>${title}</h3>
        <p>${body||'<span class="muted">Nessun testo inserito.</span>'}</p>
        ${admin?`<div class="row-actions article-actions article-admin-actions"><button class="btn small" type="button" data-edit-article="${esc(article.id)}" aria-label="Modifica articolo ${title}">Modifica</button><button class="btn small danger" type="button" data-delete-article="${esc(article.id)}" aria-label="Elimina articolo ${title}">Elimina</button></div>`:readButton}
      </div>
    </article>`;
  }
  function articleDetail(article){
    const body=esc(String(article?.body||'').trim()||'Nessun testo inserito.').replace(/\n/g,'<br>');
    const date=esc(fmtArticleDate(article?.updatedAt||article?.createdAt));
    const title=esc(article?.title||'News');
    const src=String(article?.image||'').trim();
    const hero=src
      ? `<img class="article-detail-backdrop-img" src="${esc(src)}" alt="" aria-hidden="true" loading="eager" decoding="async" referrerpolicy="no-referrer"><div class="article-detail-frame">${articleImageMarkup(article||{}).replace('loading="lazy"','loading="eager"')}</div>`
      : `<div class="article-detail-frame">${articlePlaceholder(article?.title||'NG')}</div>`;
    return `<article class="article-detail article-detail-editorial">
      <div class="article-detail-hero">
        ${hero}
        <div class="article-media-shade"></div>
        <span class="article-kicker media-kicker">NEWS</span>
      </div>
      <div class="article-detail-body">
        <div class="article-meta"><span class="article-kicker">Articolo</span>${date?`<time datetime="${esc(article?.updatedAt||article?.createdAt||'')}">${date}</time>`:''}</div>
        <h2>${title}</h2>
        <div class="article-full-text">${body}</div>
      </div>
    </article>`;
  }
  function articleList(articles, admin=false){
    return articles.length?`<div class="article-list">${articles.map(a=>articleCard(a,admin)).join('')}</div>`:'<div class="empty">Nessun articolo pubblicato.</div>';
  }


  function siteSettings(state){return store.defaultSite?store.defaultSite():{title:'New Generation',subtitle:'Risultati, squadre, giocatori e dettagli partite.',logo:''};}
  function siteTitle(state){return state?.rules?.name||'New Generation';}
  function siteSubtitle(state){return 'Risultati, squadre, giocatori e dettagli partite.';}
  function siteLogoMarkup(state,big=false){
    const site=siteSettings(state); const cls=`brand-logo-img ${big?'big':''}`;
    if(site.logo)return `<img class="${cls}" src="${esc(site.logo)}" alt="Logo ${esc(siteTitle(state))}">`;
    return `<div class="logo ${big?'big':''}"><span></span></div>`;
  }
  function applySiteTheme(state){
    try{
      const r=document.documentElement;
      ['--brand-primary','--brand-accent','--brand-surface','--brand-radius'].forEach(k=>r.style.removeProperty(k));
      document.querySelectorAll('[data-brand-title]').forEach(el=>{if(!el.dataset.brandSuffix){const txt=String(el.textContent||'');const i=txt.indexOf('·');if(i>=0)el.dataset.brandSuffix=' '+txt.slice(i).trim();}el.textContent=siteTitle(state)+(el.dataset.brandSuffix||'');});
      document.querySelectorAll('[data-brand-subtitle]').forEach(el=>{el.textContent=siteSubtitle(state);});
      document.querySelectorAll('[data-brand-logo]').forEach(el=>{el.innerHTML=siteLogoMarkup(state);});
      document.title=(document.title||'New Generation').replace(/^New Generation/,siteTitle(state));
    }catch(e){console.warn('Tema sito non applicato',e);}
  }

  function createTextPdf(title, lines, filename){const safe=s=>String(s).replace(/[()\\]/g,'');const body=[];let y=790;body.push('BT /F1 18 Tf 40 820 Td ('+safe(title)+') Tj ET');lines.forEach(line=>{if(y<40){return;}body.push(`BT /F1 10 Tf 40 ${y} Td (${safe(line).slice(0,110)}) Tj ET`);y-=16;});const stream=body.join('\n');const objs=[`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`,`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`,`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,`4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,`5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`];let pdf='%PDF-1.4\n';const offsets=[0];objs.forEach(o=>{offsets.push(pdf.length);pdf+=o+'\n';});const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')+`\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;const blob=new Blob([pdf],{type:'application/pdf'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);}
  function bindTabs(){document.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;const target=b.dataset.tab;$$('[data-tab]').forEach(x=>x.classList.remove('active'));$$('.tab-panel').forEach(x=>x.classList.remove('active'));$$(`[data-tab="${target}"]`).forEach(x=>x.classList.add('active'));$('#'+target)?.classList.add('active');document.dispatchEvent(new CustomEvent('ng:tab-changed',{detail:{tab:target}}));});}
  function bindDisclosures(){document.addEventListener('toggle',e=>{const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.open)return;const list=d.closest('.team-disclosure-list,.admin-disclosure-list,.admin-player-list');if(!list)return;list.querySelectorAll('details[open]').forEach(x=>{if(x!==d)x.open=false;});},true);}
  document.addEventListener('DOMContentLoaded',bindDisclosures);
  window.NexoraUI={esc,$,$$,logo,injectTeamLogoStyles,siteTitle,siteSubtitle,siteLogoMarkup,applySiteTheme,fmtDate,teamOptions,playerOptions,statsGrid,standingsTable,groupStandingsSelector,groupStandingsTables,playerStatsTable,presidentStatsTable,matchStatusMeta,matchCard,matchList,teamGrid,rulesSummary,bracketMarkup,articleCard,articleDetail,articleList,articlePlaceholder,replaceBrokenArticleImage,createTextPdf,bindTabs,bindDisclosures};
})();
