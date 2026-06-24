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
  function goalSummaryText(state,m){
    return store.aggregateGoalEvents(state,m).map(row=>store.goalBreakdownText(row)).join(' · ');
  }
  function matchStatusMeta(state,m){
    if(store.matchStatusInfo)return store.matchStatusInfo(state,m);
    const played=store.hasScore(state,m)||m.status==='played';
    if(m.status==='live')return {key:'live',label:'Live',cls:'is-live'};
    return played?{label:'Giocata',cls:'is-played'}:{label:'Da giocare',cls:'is-pending'};
  }
  function matchCard(state,m,clickable=false){const homeT=store.getTeam(state,m.homeTeamId),awayT=store.getTeam(state,m.awayTeamId);const home=store.teamName(state,m.homeTeamId,m.homeLabel),away=store.teamName(state,m.awayTeamId,m.awayLabel);const goals=goalSummaryText(state,m);const yellow=(m.cards||[]).filter(c=>c.type==='yellow').map(c=>store.playerName(state,c.playerId)).join(', ');const red=(m.cards||[]).filter(c=>c.type==='red').map(c=>store.playerName(state,c.playerId)).join(', ');const status=matchStatusMeta(state,m);const isLive=m.status==='live';const played=store.hasScore(state,m)||m.status==='played';const showScore=played||isLive||(store.hasGoals&&store.hasGoals(state,m));const score=showScore?store.matchGoals(state,m):null;const centerCls=isLive?'is-live':(played?'is-played':'is-pending');
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
    function neutralLogo(label){
      return `<span class="bracket-logo-neutral" role="img" aria-label="${esc(label||'Squadra da determinare')}"><span>?</span></span>`;
    }
    function teamLabel(match,side){
      const id=side==='home'?match.homeTeamId:match.awayTeamId;
      const label=side==='home'?match.homeLabel:match.awayLabel;
      const t=store.getTeam(state,id);
      const name=store.teamName(state,id,label||'Da determinare');
      return `${t?logo(t,false):neutralLogo(name)}<span class="bracket-team-name" title="${esc(name)}">${esc(name)}</span>`;
    }
    function teamRow(match,side){
      const score=store.hasScore(state,match)?store.matchGoals(state,match)[side]:'';
      const status=store.hasScore(state,match)?String(score):(match.status==='live'?'Live':'');
      return `<div class="bracket-team ${resultClass(match,side)}">${teamLabel(match,side)}<strong class="bracket-score-slot">${esc(status)}</strong></div>`;
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
                    ${teamRow(m,'home')}
                    ${teamRow(m,'away')}
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


  function fmtArticleDate(value,{dateOnly=false}={}){
    if(!value)return '';
    const parsed=new Date(value);
    if(Number.isNaN(parsed.getTime()))return '';
    try{return new Intl.DateTimeFormat('it-IT',dateOnly?{dateStyle:'long'}:{dateStyle:'medium',timeStyle:'short'}).format(parsed);}catch(e){return '';}
  }
  function articleStatusLabel(status){
    return ({draft:'Bozza',scheduled:'Programmato',published:'Pubblicato'})[status]||'Pubblicato';
  }
  function articlePlaceholder(title='NG'){
    const label=initials(title||'NG')||'NG';
    return `<div class="article-image article-placeholder" role="img" aria-label="Immagine dell’articolo non disponibile"><span>${esc(label)}</span><small>NEWS</small></div>`;
  }
  function replaceBrokenArticleImage(img){
    const holder=document.createElement('div');
    holder.className='article-image article-placeholder';
    holder.setAttribute('role','img');
    holder.setAttribute('aria-label','Immagine dell’articolo non disponibile');
    const title=(img?.dataset?.articleTitle||img?.alt||'NG').replace(/^Immagine(?: principale)?(?: dell’articolo)?\s*/i,'').trim();
    const label=initials(title||'NG')||'NG';
    holder.innerHTML=`<span>${esc(label)}</span><small>NEWS</small>`;
    img?.closest('.article-media,.article-detail-media')?.classList.add('image-fallback');
    img?.replaceWith(holder);
  }
  function articleImageMarkup(article,{detail=false,eager=false}={}){
    const title=String(article?.title||'articolo');
    const src=String(article?.image||'').trim();
    if(!src)return detail?'':articlePlaceholder(title);
    const alt=String(article?.imageAlt||'').trim()||`Immagine principale dell’articolo ${title}`;
    return `<img class="article-image" src="${esc(src)}" alt="${esc(alt)}" data-article-title="${esc(title)}" width="1280" height="800" loading="${eager?'eager':'lazy'}" decoding="async"${eager?' fetchpriority="high"':''} referrerpolicy="no-referrer">`;
  }
  function articleExcerpt(article,max=220){
    const source=String(article?.excerpt||article?.subtitle||article?.body||'').replace(/\s+/g,' ').trim();
    if(!source)return '';
    if(source.length<=max)return source;
    return source.slice(0,max).replace(/\s+\S*$/,'').trim()+'…';
  }
  function safeArticleUrl(value,{image=false}={}){
    const url=String(value||'').trim();
    if(!url)return '';
    if(image&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(url))return url;
    if(/^(?:https?:\/\/|mailto:|\/|#)/i.test(url))return url;
    return '';
  }
  function articleInlineMarkup(value){
    const links=[];
    let text=String(value||'').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(all,label,url)=>{
      const safe=safeArticleUrl(url);
      if(!safe)return label;
      const token=`@@NGARTICLELINK${links.length}@@`;
      links.push(`<a href="${esc(safe)}"${/^https?:\/\//i.test(safe)?' target="_blank" rel="noopener noreferrer"':''}>${esc(label)}</a>`);
      return token;
    });
    let html=esc(text);
    html=html.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    html=html.replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>');
    links.forEach((link,index)=>{html=html.replace(`@@NGARTICLELINK${index}@@`,link);});
    return html;
  }
  function articleBodyMarkup(value){
    const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n');
    const out=[];
    let listType='',list=[];
    const flushList=()=>{if(!list.length)return;out.push(`<${listType}>${list.map(item=>`<li>${articleInlineMarkup(item)}</li>`).join('')}</${listType}>`);list=[];listType='';};
    for(const raw of lines){
      const line=raw.trim();
      if(!line){flushList();continue;}
      const image=line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
      if(image){
        flushList();
        const src=safeArticleUrl(image[2],{image:true});
        if(src)out.push(`<figure class="article-inline-figure"><img src="${esc(src)}" alt="${esc(image[1]||'Immagine interna dell’articolo')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${image[3]?`<figcaption>${esc(image[3])}</figcaption>`:''}</figure>`);
        continue;
      }
      const ul=line.match(/^[-*]\s+(.+)/),ol=line.match(/^\d+[.)]\s+(.+)/);
      if(ul||ol){
        const type=ul?'ul':'ol';
        if(listType&&listType!==type)flushList();
        listType=type;list.push((ul||ol)[1]);continue;
      }
      flushList();
      if(/^###\s+/.test(line))out.push(`<h4>${articleInlineMarkup(line.replace(/^###\s+/,''))}</h4>`);
      else if(/^##\s+/.test(line))out.push(`<h3>${articleInlineMarkup(line.replace(/^##\s+/,''))}</h3>`);
      else if(/^>\s?/.test(line))out.push(`<blockquote>${articleInlineMarkup(line.replace(/^>\s?/,''))}</blockquote>`);
      else out.push(`<p>${articleInlineMarkup(line)}</p>`);
    }
    flushList();
    return out.join('')||'<p>Nessun testo inserito.</p>';
  }
  function articleMetadata(article,{admin=false}={}){
    const dateValue=article?.publishedAt||article?.updatedAt||article?.createdAt||'';
    const date=fmtArticleDate(dateValue,{dateOnly:true});
    const category=String(article?.category||'Aggiornamenti');
    const author=String(article?.author||'Redazione New Generation');
    return `<div class="article-meta">
      <span class="article-kicker">${esc(category)}</span>
      ${admin?`<span class="article-status status-${esc(article?.status||'published')}">${esc(articleStatusLabel(article?.status))}</span>`:''}
      ${date?`<time datetime="${esc(dateValue)}">${esc(date)}</time>`:''}
      ${author?`<span class="article-author">di ${esc(author)}</span>`:''}
    </div>`;
  }
  function articleCard(article,admin=false){
    const title=String(article?.title||'News');
    const subtitle=String(article?.subtitle||'').trim();
    const excerpt=articleExcerpt(article);
    const key=String(article?.slug||article?.id||'');
    const content=`<div class="article-media">${articleImageMarkup(article)}<span class="article-kicker media-kicker">${esc(article?.category||'NEWS')}</span></div>
      <div class="article-content">${articleMetadata(article,{admin})}<h3>${esc(title)}</h3>${subtitle?`<p class="article-card-subtitle">${esc(subtitle)}</p>`:''}${excerpt?`<p class="article-card-excerpt">${esc(excerpt)}</p>`:''}<span class="article-open-label" aria-hidden="true">Leggi l’articolo <span>→</span></span></div>`;
    if(!admin){
      return `<article class="article-card sports-news-card" data-article-id="${esc(article?.id||'')}"><a class="article-card-main" href="#article=${encodeURIComponent(key)}" data-article-open="${esc(article?.id||key)}" aria-label="Leggi articolo completo: ${esc(title)}">${content}</a></article>`;
    }
    return `<article class="article-card sports-news-card admin-news-card" data-article-id="${esc(article?.id||'')}"><div class="article-card-main">${content}</div><div class="article-admin-actions" aria-label="Azioni articolo ${esc(title)}"><button class="btn small" type="button" data-preview-article="${esc(article?.id||'')}">Anteprima</button><button class="btn small primary" type="button" data-edit-article="${esc(article?.id||'')}">Modifica</button><button class="btn small danger" type="button" data-delete-article="${esc(article?.id||'')}">Elimina</button></div></article>`;
  }
  function articleReadingTime(article){
    const words=String(article?.body||'').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1,Math.ceil(words/220));
  }
  function hasLongArticleToken(value,limit=28){
    return String(value||'').split(/\s+/).some(token=>Array.from(token).length>limit);
  }
  function articleDetailMeta(article,{preview=false}={}){
    const rows=[];
    const author=String(article?.author||'').trim()||'Redazione New Generation';
    const publishedValue=article?.publishedAt||article?.createdAt||'';
    const updatedValue=article?.updatedAt||'';
    const published=fmtArticleDate(publishedValue,{dateOnly:true});
    const updated=fmtArticleDate(updatedValue,{dateOnly:true});
    if(author)rows.push(`<span class="article-detail-author"><span class="article-meta-label">Autore</span><span>di ${esc(author)}</span></span>`);
    if(published)rows.push(`<time datetime="${esc(publishedValue)}"><span class="article-meta-label">Data</span><span>${esc(published)}</span></time>`);
    if(updated&&updated!==published)rows.push(`<span><span class="article-meta-label">Aggiornato</span><span>${esc(updated)}</span></span>`);
    rows.push(`<span><span class="article-meta-label">Lettura</span><span>${articleReadingTime(article)} min</span></span>`);
    rows.push(`<span class="article-status status-${esc(article?.status||'published')}"><span class="article-meta-label">Stato</span><span>${esc(articleStatusLabel(article?.status))}</span></span>`);
    return `<div class="article-detail-meta" aria-label="Informazioni articolo">${rows.join('')}</div>`;
  }
  function articleDetail(article,{preview=false}={}){
    const title=String(article?.title||'News');
    const subtitle=String(article?.subtitle||'').trim();
    const caption=String(article?.imageCaption||'').trim();
    const image=String(article?.image||'').trim();
    const imageMarkup=image?articleImageMarkup(article,{detail:true,eager:true}):'';
    const tags=Array.isArray(article?.tags)?article.tags.map(tag=>String(tag||'').trim()).filter(Boolean):[];
    const category=String(article?.category||'Aggiornamenti').trim()||'Aggiornamenti';
    const publishedValue=article?.publishedAt||article?.createdAt||'';
    const updatedValue=article?.updatedAt||'';
    const published=fmtArticleDate(publishedValue);
    const updated=updatedValue&&updatedValue!==publishedValue?fmtArticleDate(updatedValue):'';
    const backLabel=preview?'Chiudi anteprima':'Torna agli articoli';
    const titleClass=hasLongArticleToken(title)?' article-title-has-long-token':'';
    const subtitleClass=hasLongArticleToken(subtitle)?' article-copy-has-long-token':'';
    return `<article class="article-detail article-detail-editorial${image?' has-image':' no-image'}" data-article-detail="${esc(article?.id||'')}">
      ${preview?'<div class="article-preview-banner">Anteprima amministratore · strumenti di modifica separati dal contenuto pubblico</div>':''}
      <nav class="article-detail-nav" aria-label="Navigazione articolo"><button type="button" class="article-back-link" data-article-back>← ${backLabel}</button></nav>
      <header class="article-detail-header">
        <div class="article-detail-heading">
          <span class="article-detail-category">${esc(category)}</span>
          <h1 class="${titleClass.trim()}">${esc(title)}</h1>
          ${subtitle?`<p class="article-detail-subtitle${subtitleClass}">${esc(subtitle)}</p>`:''}
        </div>
        <aside class="article-detail-meta-panel" aria-label="Riepilogo pubblicazione">
          ${articleDetailMeta(article,{preview})}
        </aside>
      </header>
      ${image?`<section class="article-detail-media article-featured-photo" aria-label="Fotografia principale dell’articolo">
        <figure class="article-featured-photo-card">
          <div class="article-featured-photo-frame">
            <button type="button" class="article-image-open" data-article-image-open="${esc(image)}" aria-label="Apri fotografia a dimensione intera: ${esc(title)}">
              <span class="article-featured-photo-canvas">${imageMarkup}</span>
              <span class="article-image-open-hint" aria-hidden="true"><span>↗</span> Apri fotografia</span>
            </button>
          </div>
          ${caption?`<figcaption>${esc(caption)}</figcaption>`:''}
        </figure>
      </section>`:''}
      <div class="article-detail-body">
        <div class="article-full-text">${articleBodyMarkup(article?.body)}</div>
        ${tags.length?`<div class="article-tags" aria-label="Tag">${tags.map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div>`:''}
        <footer class="article-detail-footer">${published?`<span>Pubblicato: ${esc(published)}</span>`:''}${updated?`<span>Aggiornato: ${esc(updated)}</span>`:''}</footer>
        <nav class="article-detail-end-nav" aria-label="Fine articolo"><button type="button" class="article-back-link" data-article-back>← ${backLabel}</button></nav>
      </div>
    </article>`;
  }

  let articleViewer=null;
  function ensureArticleImageViewer(){
    if(articleViewer)return articleViewer;
    const root=document.createElement('div');
    root.className='article-image-viewer';
    root.setAttribute('aria-hidden','true');
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label','Visualizzatore fotografia articolo');
    root.innerHTML=`<div class="article-image-viewer-toolbar"><div class="article-image-viewer-zoom"><button type="button" data-article-viewer-out aria-label="Riduci zoom">−</button><span data-article-viewer-label>100%</span><button type="button" data-article-viewer-in aria-label="Aumenta zoom">+</button><button type="button" data-article-viewer-reset>Ripristina</button></div><button type="button" class="article-image-viewer-close" aria-label="Chiudi fotografia">×</button></div><div class="article-image-viewer-stage"><img alt="" draggable="false"></div>`;
    document.body.appendChild(root);
    const img=root.querySelector('img'),close=root.querySelector('.article-image-viewer-close'),stage=root.querySelector('.article-image-viewer-stage');
    const pointers=new Map();
    let scale=1,x=0,y=0,trigger=null,drag=null,pinchStart=null,ownsBodyLock=false;
    const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
    function apply(){if(scale<=1){x=0;y=0;}img.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;root.querySelector('[data-article-viewer-label]').textContent=Math.round(scale*100)+'%';img.classList.toggle('is-zoomed',scale>1);}
    function setScale(next){scale=clamp(next,1,4);apply();}
    function reset(){scale=1;x=0;y=0;drag=null;pinchStart=null;pointers.clear();apply();}
    function hide(){root.classList.remove('open');root.setAttribute('aria-hidden','true');if(ownsBodyLock)document.body.classList.remove('ng-overlay-open');ownsBodyLock=false;reset();const target=trigger;trigger=null;requestAnimationFrame(()=>target&&document.contains(target)&&target.focus?.({preventScroll:true}));}
    root.addEventListener('click',event=>{
      if(event.target===root||event.target===stage||event.target.closest('.article-image-viewer-close'))hide();
      else if(event.target.closest('[data-article-viewer-in]'))setScale(scale+.5);
      else if(event.target.closest('[data-article-viewer-out]'))setScale(scale-.5);
      else if(event.target.closest('[data-article-viewer-reset]'))reset();
    });
    stage.addEventListener('wheel',event=>{event.preventDefault();setScale(scale+(event.deltaY<0?.35:-.35));},{passive:false});
    img.addEventListener('dblclick',()=>setScale(scale>1?1:2));
    img.addEventListener('pointerdown',event=>{
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      img.setPointerCapture?.(event.pointerId);
      if(pointers.size===1&&scale>1)drag={px:event.clientX,py:event.clientY,x,y};
      if(pointers.size===2){const values=[...pointers.values()];pinchStart={distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y),scale};drag=null;}
    });
    img.addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2&&pinchStart){const values=[...pointers.values()];const distance=Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y);setScale(pinchStart.scale*(distance/Math.max(1,pinchStart.distance)));return;}
      if(!drag)return;x=drag.x+event.clientX-drag.px;y=drag.y+event.clientY-drag.py;apply();
    });
    function pointerEnd(event){pointers.delete(event.pointerId);drag=null;if(pointers.size<2)pinchStart=null;}
    img.addEventListener('pointerup',pointerEnd);img.addEventListener('pointercancel',pointerEnd);
    document.addEventListener('keydown',event=>{
      if(!root.classList.contains('open'))return;
      if(event.key==='Tab'){
        const focusable=[...root.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
        if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      }else if(event.key==='Escape'){event.preventDefault();hide();}
      else if(event.key==='+'||event.key==='='){event.preventDefault();setScale(scale+.5);}
      else if(event.key==='-'){event.preventDefault();setScale(scale-.5);}
      else if(event.key==='0'){event.preventDefault();reset();}
    });
    articleViewer={open(src,alt,lastTrigger){trigger=lastTrigger||document.activeElement;img.src=src;img.alt=alt||'Fotografia articolo';reset();ownsBodyLock=!document.body.classList.contains('ng-overlay-open');root.classList.add('open');root.setAttribute('aria-hidden','false');document.body.classList.add('ng-overlay-open');requestAnimationFrame(()=>close.focus());},close:hide,root};
    return articleViewer;
  }
  function prepareArticleDetail(root,{onBack}={}){
    if(!root)return;
    root.querySelectorAll('.article-detail-media img.article-image').forEach(img=>{
      const section=img.closest('.article-detail-media');
      const card=img.closest('.article-featured-photo-card')||section;
      const classify=()=>{if(!img.naturalWidth||!img.naturalHeight)return;const ratio=img.naturalWidth/img.naturalHeight;[section,card].forEach(el=>{el?.classList.remove('is-portrait','is-square','is-landscape');el?.classList.add(ratio<.85?'is-portrait':ratio>1.2?'is-landscape':'is-square');});};
      if(img.complete)classify();else img.addEventListener('load',classify,{once:true});
    });
    if(root.dataset.articleInteractionsBound==='1')return;
    root.dataset.articleInteractionsBound='1';
    root.addEventListener('click',event=>{
      const back=event.target.closest('[data-article-back]');if(back){event.preventDefault();onBack?.(back);return;}
      const opener=event.target.closest('[data-article-image-open]');if(opener){event.preventDefault();const img=opener.querySelector('img');ensureArticleImageViewer().open(opener.dataset.articleImageOpen,img?.alt||'Fotografia articolo',opener);}
    });
  }
  function articleList(articles,admin=false){
    const rows=Array.isArray(articles)?articles:[];
    return rows.length?`<div class="article-list">${rows.map(a=>articleCard(a,admin)).join('')}</div>`:`<div class="empty article-empty"><strong>${admin?'Nessun articolo trovato':'Nessun articolo pubblicato'}</strong><span>${admin?'Crea un nuovo articolo o modifica i filtri.':'Torna presto per leggere i prossimi aggiornamenti.'}</span></div>`;
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
  window.NexoraUI={esc,$,$$,logo,injectTeamLogoStyles,siteTitle,siteSubtitle,siteLogoMarkup,applySiteTheme,fmtDate,teamOptions,playerOptions,statsGrid,standingsTable,groupStandingsSelector,groupStandingsTables,playerStatsTable,presidentStatsTable,matchStatusMeta,matchCard,matchList,teamGrid,rulesSummary,bracketMarkup,articleCard,articleDetail,articleList,articlePlaceholder,replaceBrokenArticleImage,articleBodyMarkup,articleStatusLabel,prepareArticleDetail,ensureArticleImageViewer,createTextPdf,bindTabs,bindDisclosures};
})();
