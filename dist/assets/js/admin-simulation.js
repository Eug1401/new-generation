(function(){
  'use strict';
  const store=window.NexoraStore;
  const UI=window.NexoraUI;
  const A=window.NexoraAdmin;
  if(!store||!UI||!A)return;

  const LOCK_KEY='new-generation-simulation-lock-v1';
  const OWNER_KEY='new-generation-simulation-owner-v1';
  const LOCK_TTL=5*60*1000;
  const FORMATS=['groups_knockout','league_knockout'];
  const FORMAT_META={
    groups_knockout:{title:'Due gironi + fase finale',description:'Due gironi da 4, prime due qualificate, semifinali e finale: 15 partite.',teams:8},
    league_knockout:{title:'Girone unico + tabellone',description:'28 partite di campionato, poi quarti, semifinali e finale: 35 partite.',teams:8}
  };
  const TEAM_BLUEPRINTS=[
    {name:'Golden Lions',shortName:'Lions',logo:'assets/simulation/teams/golden-lions.svg',primaryColor:'#d6a52f',secondaryColor:'#1a1306'},
    {name:'Red Falcons',shortName:'Falcons',logo:'assets/simulation/teams/red-falcons.svg',primaryColor:'#d43b45',secondaryColor:'#26080b'},
    {name:'Thunder Wolves',shortName:'Wolves',logo:'assets/simulation/teams/thunder-wolves.svg',primaryColor:'#7c5cff',secondaryColor:'#130d2c'},
    {name:'Blue Sharks',shortName:'Sharks',logo:'assets/simulation/teams/blue-sharks.svg',primaryColor:'#2488d8',secondaryColor:'#061a2d'},
    {name:'Royal Eagles',shortName:'Eagles',logo:'assets/simulation/teams/royal-eagles.svg',primaryColor:'#e7c45a',secondaryColor:'#241d08'},
    {name:'Black Panthers',shortName:'Panthers',logo:'assets/simulation/teams/black-panthers.svg',primaryColor:'#777777',secondaryColor:'#0b0b0d'},
    {name:'Silver Bulls',shortName:'Bulls',logo:'assets/simulation/teams/silver-bulls.svg',primaryColor:'#c8d0d8',secondaryColor:'#182027'},
    {name:'Urban Dragons',shortName:'Dragons',logo:'assets/simulation/teams/urban-dragons.svg',primaryColor:'#35b86b',secondaryColor:'#082818'}
  ];
  const FIRST_NAMES=['Luca','Marco','Andrea','Matteo','Davide','Alessio','Simone','Francesco','Gabriele','Nicolò','Tommaso','Edoardo','Riccardo','Leonardo','Samuele','Giacomo','Federico','Michele','Antonio','Emanuele','Filippo','Pietro','Manuel','Christian'];
  const LAST_NAMES=['Rossi','Bianchi','Romano','Colombo','Ferrari','Esposito','Ricci','Marino','Greco','Lombardi','Moretti','Conti','Gallo','Costa','Bruno','Fontana','Rizzo','Barbieri','Mancini','Leone','De Luca','Santoro','Ferri','Martini'];
  const JERSEY_NUMBERS=[1,7,9,10,11];
  const STEPS=['Squadre','Formato','Kings','Durata','Conferma'];
  const PROGRESS_STAGES=['Preparazione','Verifica squadre','Generazione giocatori','Configurazione torneo','Creazione calendario','Simulazione partite','Calcolo classifiche','Creazione tabellone','Verifica finale','Salvataggio'];
  let dialog=null;
  let wizard=null;
  let running=false;
  let activeOperationId='';
  let dialogTrigger=null;

  function simulationOwner(){
    try{
      let owner=sessionStorage.getItem(OWNER_KEY);
      if(!owner){owner=`tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;sessionStorage.setItem(OWNER_KEY,owner);}
      return owner;
    }catch(_){return 'single-tab';}
  }

  function clone(value){return window.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));}
  function addDays(date,days){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}
  function today(){return new Date().toISOString().slice(0,10);}
  function operationId(){return `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;}
  function hashString(value){let h=2166136261;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function rngFrom(value){let a=hashString(value)||1;return function(){a|=0;a=a+0x6D2B79F5|0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
  function randInt(rnd,min,max){return Math.floor(rnd()*(max-min+1))+min;}
  function pick(rnd,list){return list[Math.floor(rnd()*list.length)];}
  function unique(list){return [...new Set(list)];}
  function safeJson(value){try{return JSON.stringify(value);}catch(_){return '';}}
  function sleep(ms=18){return new Promise(resolve=>setTimeout(resolve,ms));}
  function simulationLog(opId,stage,data={}){try{console.info('[NG-Simulation]',{operationId:opId,stage,...data});}catch(_){}}

  function acquireLock(id){
    if(running)throw new Error('Una simulazione è già in corso in questa scheda.');
    try{
      const raw=localStorage.getItem(LOCK_KEY);
      const owner=simulationOwner();
      if(raw){
        const lock=JSON.parse(raw);
        const fresh=lock&&Date.now()-Number(lock.startedAt||0)<LOCK_TTL;
        if(fresh&&lock.owner!==owner&&lock.id!==id)throw new Error('Una simulazione è già in corso in un’altra scheda.');
      }
      localStorage.setItem(LOCK_KEY,JSON.stringify({id,owner,startedAt:Date.now()}));
    }catch(err){if(String(err?.message||err).includes('già in corso'))throw err;}
    running=true;
    activeOperationId=id;
  }
  function releaseLock(id){
    running=false;
    activeOperationId='';
    try{const lock=JSON.parse(localStorage.getItem(LOCK_KEY)||'null');if(!lock||lock.id===id)localStorage.removeItem(LOCK_KEY);}catch(_){try{localStorage.removeItem(LOCK_KEY);}catch(__){}}
  }

  function normalizeOptions(raw={}){
    const teamMode=raw.teamMode==='existing'?'existing':'generated';
    const kings=Boolean(raw.kings);
    return {
      teamMode,
      selectedTeamIds:unique(Array.isArray(raw.selectedTeamIds)?raw.selectedTeamIds.map(String):[]),
      generatedTeamCount:Number(raw.generatedTeamCount||8),
      format:FORMATS.includes(raw.format)?raw.format:'groups_knockout',
      kings,
      presidentMode:kings?(raw.presidentMode==='default_per_team'?'default_per_team':'default_per_team'):'none',
      duration:raw.duration==='one_day'?'one_day':'multi_day',
      replaceTournamentConfirmed:Boolean(raw.replaceTournamentConfirmed),
      replacePlayersConfirmed:Boolean(raw.replacePlayersConfirmed),
      replaceTeamsConfirmed:Boolean(raw.replaceTeamsConfirmed),
      requestSource:String(raw.requestSource||'internal')
    };
  }

  function validateOptions(source,raw,{requireConfirmations=false}={}){
    const options=normalizeOptions(raw);
    if(raw.format&&!FORMATS.includes(raw.format))return {ok:false,message:'Formato non supportato: usa Gironi + eliminazione diretta oppure Classifica unica + eliminazione diretta.'};
    if(options.generatedTeamCount!==8)return {ok:false,message:'La simulazione supporta esattamente 8 squadre.'};
    if(options.teamMode==='existing'){
      if((source.teams||[]).length<8)return {ok:false,message:'Servono almeno 8 squadre esistenti. Puoi scegliere “Genera 8 squadre di prova”.'};
      if(options.selectedTeamIds.length!==8)return {ok:false,message:'Seleziona esattamente 8 squadre esistenti.'};
      const known=new Set((source.teams||[]).map(t=>String(t.id)));
      if(options.selectedTeamIds.some(id=>!known.has(id)))return {ok:false,message:'Una delle squadre selezionate non esiste più. Riapri la procedura.'};
    }
    if(options.kings&&options.presidentMode!=='default_per_team')return {ok:false,message:'Configura il presidente di default per il formato Kings.'};
    if(requireConfirmations){
      if(!options.replaceTournamentConfirmed)return {ok:false,message:'Conferma la sostituzione dei dati del torneo.'};
      if(options.teamMode==='existing'&&!options.replacePlayersConfirmed)return {ok:false,message:'Conferma la sostituzione dei giocatori delle squadre selezionate.'};
      if(options.teamMode==='generated'&&!options.replaceTeamsConfirmed)return {ok:false,message:'Conferma la creazione e sostituzione con 8 squadre simulate.'};
    }
    return {ok:true,options};
  }

  function simulatedPersonName(teamIndex,personIndex){
    const first=FIRST_NAMES[(teamIndex*7+personIndex*5)%FIRST_NAMES.length];
    const last=LAST_NAMES[(teamIndex*11+personIndex*3)%LAST_NAMES.length];
    return `${first} ${last}`;
  }
  function makePlayers(teamIndex){
    return JERSEY_NUMBERS.map((number,index)=>({
      id:store.uid('player'),
      name:simulatedPersonName(teamIndex,index),
      displayName:simulatedPersonName(teamIndex,index),
      number,
      birthYear:String(1994+((teamIndex*3+index*2)%14)),
      active:true,
      simulated:true
    }));
  }
  function ensurePresident(team,teamIndex,kings){
    const current=team.president&&typeof team.president==='object'?team.president:{};
    if(!kings)return {...current,id:current.id||store.uid('president'),name:String(current.name||'').trim()};
    return {...current,id:current.id||store.uid('president'),name:String(current.name||`Presidente ${simulatedPersonName(teamIndex,7)}`).trim(),active:true,simulated:!current.name};
  }
  function generatedTeams(kings){
    return TEAM_BLUEPRINTS.map((blueprint,index)=>({
      id:store.uid('team'),
      ...blueprint,
      players:makePlayers(index),
      president:ensurePresident({},index,kings),
      coach:{name:`Coach ${simulatedPersonName(index,9)}`},
      simulated:true
    }));
  }
  function existingTeams(source,ids,kings){
    const selected=new Set(ids);
    const teams=(source.teams||[]).filter(t=>selected.has(String(t.id))).map((team,index)=>{
      const copy=clone(team);
      copy.players=makePlayers(index);
      copy.logo=copy.logo||TEAM_BLUEPRINTS[index].logo;
      copy.president=ensurePresident(copy,index,kings);
      copy.simulatedRoster=true;
      return copy;
    });
    const order=new Map(ids.map((id,index)=>[id,index]));
    return teams.sort((a,b)=>order.get(String(a.id))-order.get(String(b.id)));
  }

  function configureRules(current,options){
    const rules={...(current||{})};
    const end=addDays(today(),-1);
    const start=options.duration==='one_day'?end:addDays(end,-75);
    rules.format=options.format;
    rules.isKingsLeague=options.kings;
    rules.oneDay=options.duration==='one_day';
    rules.fieldCount=4;
    rules.startDate=start;
    rules.endDate=options.duration==='one_day'?start:end;
    rules.startTime='09:00';
    rules.endTime='23:00';
    rules.matchDuration=40;
    rules.breakMinutes=10;
    rules.oneDayPauseEnabled=options.duration==='one_day';
    rules.oneDayPauseStart='13:00';
    rules.oneDayPauseDuration=40;
    rules.playingDays=[1,2,3,4,5,6,0];
    rules.groupFieldPolicy='auto';
    rules.groupCount=2;
    rules.groupConfigs=[{name:'Girone A',size:4,qualifiers:2},{name:'Girone B',size:4,qualifiers:2}];
    rules.groupAssignments={};
    rules.playoffTeams=4;
    rules.eliminationCompetitions=[{id:'comp_sim_oro',name:'Playoff Oro',startRank:1,teams:8}];
    rules.superCup={enabled:false,homeCompetitionId:'comp_sim_oro',awayCompetitionId:''};
    return rules;
  }

  function createDraft(source,rawOptions,opId){
    const checked=validateOptions(source,rawOptions);
    if(!checked.ok)throw new Error(checked.message);
    const options=checked.options;
    const draft=clone(source);
    const originalArticles=clone(source.articles||[]);
    draft.rules=configureRules(draft.rules,options);
    draft.teams=options.teamMode==='existing'?existingTeams(source,options.selectedTeamIds,options.kings):generatedTeams(options.kings);
    draft.matches=[];
    draft.calendarSignature='';
    draft.teamPhotos=options.teamMode==='existing'?Object.fromEntries(Object.entries(source.teamPhotos||{}).filter(([id])=>options.selectedTeamIds.includes(String(id)))):{};
    draft.articles=originalArticles;
    draft._simulationOperationId=opId;
    draft._simulationUpdatedAt=new Date().toISOString();
    return {draft,options,originalArticles};
  }

  function assignMultiDayTimes(state){
    if(state.rules.oneDay)return;
    const byDate=new Map();
    (state.matches||[]).forEach(m=>{if(!byDate.has(m.date))byDate.set(m.date,[]);byDate.get(m.date).push(m);});
    byDate.forEach(matches=>{
      matches.sort((a,b)=>String(a.field).localeCompare(String(b.field))||a.roundIndex-b.roundIndex);
      matches.forEach(m=>{m.time=state.rules.startTime||'09:00';m.datetime=m.date&&m.time?`${m.date}T${m.time}`:'';});
    });
  }

  function scorePair(rnd,isKnockout){
    const weights=[0,0,1,1,1,2,2,2,3,3,4];
    let home=pick(rnd,weights),away=pick(rnd,weights),penalties=null;
    if(isKnockout&&home===away){
      if(rnd()<0.42){
        const base=randInt(rnd,3,5),homeWins=rnd()<0.5;
        penalties=homeWins?{home:base+1,away:base}:{home:base,away:base+1};
      }else if(rnd()<0.5)home+=1;else away+=1;
    }
    return {home,away,penalties};
  }
  function scoringParticipants(state,team,rnd){
    const players=[...(team.players||[])];
    if(state.rules.isKingsLeague&&team.president?.name&&rnd()<0.12)players.push(team.president);
    return players;
  }
  function makeGoalEvents(state,match,team,total,rnd){
    const participants=scoringParticipants(state,team,rnd);
    const events=[];
    for(let i=0;i<total;i++){
      const participant=pick(rnd,participants);
      const duration=Math.max(5,Number(state.rules.matchDuration)||40);
      events.push({id:store.uid('goal'),playerId:participant.id,weight:1,minute:randInt(rnd,2,Math.max(3,duration-2))});
    }
    return events;
  }
  function makeCards(team,rnd){
    const cards=[];
    const players=team.players||[];
    const yellowCount=rnd()<0.58?randInt(rnd,1,Math.min(3,players.length)):0;
    const chosen=new Set();
    for(let i=0;i<yellowCount;i++){
      const available=players.filter(p=>!chosen.has(p.id));
      if(!available.length)break;
      const p=pick(rnd,available);chosen.add(p.id);
      cards.push({id:store.uid('card'),playerId:p.id,type:'yellow',minute:randInt(rnd,8,36)});
    }
    if(rnd()<0.10&&players.length){
      const p=pick(rnd,players);
      cards.push({id:store.uid('card'),playerId:p.id,type:'red',minute:40});
    }
    return cards;
  }
  function simulateMatch(state,match,rnd,index){
    if(!match.homeTeamId||!match.awayTeamId)throw new Error(`${match.round}: abbinamento non risolto.`);
    const home=store.getTeam(state,match.homeTeamId),away=store.getTeam(state,match.awayTeamId);
    if(!home||!away)throw new Error(`${match.round}: squadra non trovata.`);
    const result=scorePair(rnd,store.isKnockoutPhase(match));
    match.goals=[...makeGoalEvents(state,match,home,result.home,rnd),...makeGoalEvents(state,match,away,result.away,rnd)].sort((a,b)=>(a.minute||0)-(b.minute||0));
    match.cards=[...makeCards(home,rnd),...makeCards(away,rnd)].sort((a,b)=>(a.minute||0)-(b.minute||0));
    match.penalties=result.penalties;
    match.status='played';
    match.referee=`Arbitro simulato ${1+(index%8)}`;
    const winner=store.winnerId(state,match);
    match.winnerTeamId=winner||'';
    const winnerTeam=store.getTeam(state,winner);
    match.mvpPlayerId=winnerTeam?.players?.length?pick(rnd,winnerTeam.players).id:'';
  }
  function simulateAllMatches(state,seed){
    const rnd=rngFrom(seed);
    const roundIndexes=unique((state.matches||[]).map(m=>Number(m.roundIndex)||0)).sort((a,b)=>a-b);
    let index=0;
    for(const roundIndex of roundIndexes){
      store.autoResolveKnockout(state);
      const roundMatches=state.matches.filter(m=>(Number(m.roundIndex)||0)===roundIndex).sort((a,b)=>(a.bracketMatchIndex||0)-(b.bracketMatchIndex||0)||String(a.id).localeCompare(String(b.id)));
      for(const match of roundMatches)simulateMatch(state,match,rnd,index++);
      store.autoResolveKnockout(state);
    }
    return index;
  }

  function tournamentWinner(state){
    let bracketName='Tabellone principale';
    if(state.rules.format==='groups_knockout')bracketName='Fase finale';
    if(state.rules.format==='league_knockout')bracketName='Playoff Oro';
    const matches=(state.matches||[]).filter(m=>m.bracketName===bracketName);
    const max=Math.max(0,...matches.map(m=>Number(m.bracketRoundIndex)||0));
    const final=matches.find(m=>(Number(m.bracketRoundIndex)||0)===max);
    return final?store.winnerId(state,final):'';
  }

  function expectedMatchCount(format){return {groups_knockout:15,league_knockout:35}[format]||0;}
  function validateSimulation(state,context={}){
    const errors=[];
    const options=normalizeOptions(context.options||{});
    const teams=state.teams||[],matches=state.matches||[];
    if(teams.length!==8)errors.push(`Squadre attese: 8; trovate: ${teams.length}.`);
    if(new Set(teams.map(t=>t.id)).size!==teams.length)errors.push('Sono presenti ID squadra duplicati.');
    if(new Set(teams.map(t=>String(t.name).toLowerCase())).size!==teams.length)errors.push('Sono presenti nomi squadra duplicati.');
    const participantIds=new Set();
    teams.forEach(team=>{
      if(!team.logo)errors.push(`${team.name}: stemma mancante.`);
      if((team.players||[]).length!==5)errors.push(`${team.name}: il roster deve contenere esattamente 5 giocatori.`);
      const numbers=(team.players||[]).map(p=>Number(p.number));
      if(new Set(numbers).size!==numbers.length||numbers.some(n=>!Number.isInteger(n)))errors.push(`${team.name}: numeri di maglia non validi o duplicati.`);
      (team.players||[]).forEach(player=>{
        if(participantIds.has(player.id))errors.push(`Giocatore duplicato: ${player.name}.`);
        participantIds.add(player.id);
      });
      if(options.kings&&(!team.president?.id||!team.president?.name))errors.push(`${team.name}: presidente Kings mancante.`);
      if(team.president?.id)participantIds.add(team.president.id);
    });
    const expected=expectedMatchCount(options.format);
    if(matches.length!==expected)errors.push(`Partite attese per ${options.format}: ${expected}; trovate: ${matches.length}.`);
    const matchIds=new Set(),pairKeys=new Set(),fieldSlots=new Set(),teamSlots=new Set();
    let priorRoundMax='';
    const roundIndexes=unique(matches.map(m=>Number(m.roundIndex)||0)).sort((a,b)=>a-b);
    for(const roundIndex of roundIndexes){
      const round=matches.filter(m=>(Number(m.roundIndex)||0)===roundIndex);
      const stamps=round.map(m=>`${m.date||''}T${m.time||'00:00'}`).sort();
      const min=stamps[0]||'',max=stamps[stamps.length-1]||'';
      if(priorRoundMax&&min<priorRoundMax)errors.push(`Ordine temporale incoerente alla fase ${roundIndex}.`);
      priorRoundMax=max;
    }
    matches.forEach(match=>{
      if(matchIds.has(match.id))errors.push(`ID partita duplicato: ${match.id}.`);matchIds.add(match.id);
      if(!match.homeTeamId||!match.awayTeamId)errors.push(`${match.round}: squadre non risolte.`);
      if(match.homeTeamId===match.awayTeamId)errors.push(`${match.round}: una squadra gioca contro sé stessa.`);
      if(!store.getTeam(state,match.homeTeamId)||!store.getTeam(state,match.awayTeamId))errors.push(`${match.round}: riferimento squadra non valido.`);
      if(match.status!=='played')errors.push(`${match.round}: partita non conclusa.`);
      if(!match.date||!match.time||!match.field)errors.push(`${match.round}: data, ora o campo mancanti.`);
      const pair=[match.homeTeamId,match.awayTeamId].sort().join('~');
      const pairKey=[match.phase,match.groupName,match.bracketName,match.roundIndex,pair].join('|');
      if(pairKeys.has(pairKey))errors.push(`${match.round}: partita duplicata.`);pairKeys.add(pairKey);
      const slot=`${match.date}|${match.time}`;
      const fieldKey=`${slot}|${match.field}`;
      if(fieldSlots.has(fieldKey))errors.push(`${match.round}: campo occupato contemporaneamente.`);fieldSlots.add(fieldKey);
      [match.homeTeamId,match.awayTeamId].forEach(teamId=>{const key=`${slot}|${teamId}`;if(teamSlots.has(key))errors.push(`${match.round}: squadra impegnata contemporaneamente.`);teamSlots.add(key);});
      let lastMinute=0;
      (match.goals||[]).forEach(goal=>{
        const participant=store.getParticipant(state,goal.playerId);
        if(!participant||![match.homeTeamId,match.awayTeamId].includes(participant.team.id))errors.push(`${match.round}: marcatore non appartenente alle squadre in campo.`);
        const minute=Number(goal.minute);
        if(!Number.isInteger(minute)||minute<1||minute>Number(state.rules.matchDuration||40))errors.push(`${match.round}: minuto gol non valido.`);
        if(minute<lastMinute)errors.push(`${match.round}: gol non ordinati cronologicamente.`);lastMinute=minute;
        if(Number(goal.weight)!==1)errors.push(`${match.round}: il test usa eventi uno-a-uno con il punteggio; peso gol inatteso.`);
      });
      (match.cards||[]).forEach(card=>{
        const player=store.getPlayer(state,card.playerId);
        if(!player||![match.homeTeamId,match.awayTeamId].includes(player.team.id))errors.push(`${match.round}: cartellino associato a giocatore estraneo.`);
        if(!['yellow','red'].includes(card.type))errors.push(`${match.round}: tipo cartellino non valido.`);
      });
      const score=store.matchGoals(state,match);
      if(store.actualGoalCount(state,match,match.homeTeamId)!==score.home||store.actualGoalCount(state,match,match.awayTeamId)!==score.away)errors.push(`${match.round}: eventi gol e risultato non coincidono.`);
      const derivedWinner=store.winnerId(state,match);
      if(store.isKnockoutPhase(match)&&!derivedWinner)errors.push(`${match.round}: nessun vincitore nella fase a eliminazione diretta.`);
      if(String(match.winnerTeamId||'')!==String(derivedWinner||''))errors.push(`${match.round}: vincitore registrato non coerente con il risultato.`);
      const redMinuteByPlayer=new Map((match.cards||[]).filter(c=>c.type==='red').map(c=>[c.playerId,Number(c.minute)||0]));
      (match.goals||[]).forEach(goal=>{const redMinute=redMinuteByPlayer.get(goal.playerId);if(redMinute&&Number(goal.minute)>redMinute)errors.push(`${match.round}: un giocatore segna dopo l'espulsione.`);});
    });
    const stats=store.selectors.stats(state);
    if(stats.players!==40)errors.push(`Giocatori attesi: 40; trovati: ${stats.players}.`);
    const goalsFromMatches=matches.reduce((sum,m)=>sum+(m.goals||[]).length,0);
    if(stats.goals!==goalsFromMatches)errors.push('Totale gol non coerente con gli eventi partita.');
    if(options.format==='groups_knockout'){
      const groups=store.selectors.groupedStandings(state);
      if(groups.length!==2||groups.some(g=>!g.completed||g.rows.length!==4))errors.push('Classifiche dei gironi incomplete.');
      const qualified=new Set(groups.flatMap(g=>g.rows.slice(0,2).map(r=>r.teamId)));
      const firstKo=matches.filter(m=>m.phase==='knockout'&&m.bracketRoundIndex===1).flatMap(m=>[m.homeTeamId,m.awayTeamId]);
      if(firstKo.some(id=>!qualified.has(id))||new Set(firstKo).size!==4)errors.push('Le qualificate del tabellone non corrispondono alle classifiche dei gironi.');
    }
    if(options.format==='league_knockout'){
      const top=new Set(store.selectors.calculateStandings(state,'league').slice(0,8).map(r=>r.teamId));
      const firstKo=matches.filter(m=>m.phase==='playoff'&&m.bracketRoundIndex===1).flatMap(m=>[m.homeTeamId,m.awayTeamId]);
      if(firstKo.some(id=>!top.has(id))||new Set(firstKo).size!==8)errors.push('Il tabellone playoff non corrisponde alla classifica del campionato.');
    }
    const winnerId=tournamentWinner(state);
    if(!winnerId||!store.getTeam(state,winnerId))errors.push('Vincitore del torneo mancante o non valido.');
    const finals=matches.filter(m=>store.isKnockoutPhase(m)&&m.bracketRound==='Finale');
    if(!finals.length)errors.push('Finale non presente.');
    const dates=unique(matches.map(m=>m.date));
    if(options.duration==='one_day'&&dates.length!==1)errors.push('Il torneo giornaliero usa più di una data.');
    if(options.duration==='multi_day'&&dates.length<2)errors.push('Il torneo su più giorni non è stato distribuito correttamente.');
    if(context.originalArticles&&safeJson(state.articles||[])!==safeJson(context.originalArticles))errors.push('La sezione articoli è stata modificata dalla simulazione.');
    return {ok:errors.length===0,errors,winnerId,winner:store.teamName(state,winnerId,''),stats,dates};
  }

  function finalizeDraft(draft,options,opId,originalArticles){
    store.alignState(draft);
    const winnerId=tournamentWinner(draft);
    const totals=store.selectors.stats(draft);
    draft._simulationSummary={
      operationId:opId,
      teamMode:options.teamMode,
      format:options.format,
      kings:options.kings,
      duration:options.duration,
      teams:draft.teams.length,
      players:totals.players,
      matches:draft.matches.length,
      goals:totals.goals,
      yellow:totals.yellow,
      red:totals.red,
      winnerTeamId:winnerId,
      winnerName:store.teamName(draft,winnerId,''),
      startDate:draft.rules.startDate,
      endDate:draft.rules.endDate,
      completedAt:new Date().toISOString()
    };
    const validation=validateSimulation(draft,{options,originalArticles});
    if(!validation.ok)throw new Error(`Verifica finale fallita: ${validation.errors.join(' ')}`);
    return validation;
  }

  function buildSimulation(source,rawOptions,opId=operationId()){
    const {draft,options,originalArticles}=createDraft(source,rawOptions,opId);
    const generation=store.generateCalendar(draft,{preserveResults:false});
    if(!generation.ok)throw new Error(generation.message||'Calendario non generato.');
    assignMultiDayTimes(draft);
    simulateAllMatches(draft,opId);
    const validation=finalizeDraft(draft,options,opId,originalArticles);
    return {state:draft,options,validation,operationId:opId,generation};
  }

  async function buildSimulationWithProgress(source,rawOptions,opId,onProgress){
    const progress=async(stage,detail='')=>{onProgress?.(stage,detail);await sleep();};
    await progress('Preparazione','Creo uno snapshot sicuro dello stato corrente.');
    const {draft,options,originalArticles}=createDraft(source,rawOptions,opId);
    await progress('Verifica squadre',`${draft.teams.length} squadre pronte, senza duplicati.`);
    await progress('Generazione giocatori','Inserisco esattamente 5 giocatori per squadra.');
    await progress('Configurazione torneo',`${FORMAT_META[options.format].title}${options.kings?' · modalità Kings':''}.`);
    const generation=store.generateCalendar(draft,{preserveResults:false});
    if(!generation.ok)throw new Error(generation.message||'Calendario non generato.');
    assignMultiDayTimes(draft);
    await progress('Creazione calendario',`${draft.matches.length} partite programmate senza sovrapposizioni.`);
    const played=simulateAllMatches(draft,opId);
    await progress('Simulazione partite',`${played} partite concluse con gol e cartellini coerenti.`);
    store.selectors.officialStandings(draft);
    await progress('Calcolo classifiche','Punti e statistiche ricalcolati dagli eventi.');
    store.autoResolveKnockout(draft);
    await progress('Creazione tabellone','Turni, finale e vincitore risolti.');
    const validation=finalizeDraft(draft,options,opId,originalArticles);
    await progress('Verifica finale',`Controlli superati. Vincitore: ${validation.winner}.`);
    return {state:draft,options,validation,operationId:opId,generation};
  }

  async function rollback(snapshot,remoteExpected,opId){
    simulationLog(opId,'rollback-start');
    store.save('admin',snapshot);
    store.save('public',snapshot);
    if(remoteExpected&&window.NG_FORCE_REMOTE_SAVE){
      try{await window.NG_FORCE_REMOTE_SAVE(snapshot);if(window.NG_FLUSH_REMOTE_SAVE)await window.NG_FLUSH_REMOTE_SAVE();}catch(err){console.error('[NG-Simulation] rollback remoto non completato',err);}
    }
    simulationLog(opId,'rollback-complete');
  }

  async function commitSimulation(result,onProgress){
    const snapshot=clone(A.state());
    const remoteExpected=Boolean(window.NEW_GENERATION_SUPABASE?.ENABLED&&window.NG_SUPABASE_CLIENT&&window.NG_FORCE_REMOTE_SAVE);
    try{
      onProgress?.('Salvataggio','Commit locale e verifica del backend.');
      store.save('admin',result.state);
      const local=store.load('admin');
      if(local._simulationOperationId!==result.operationId)throw new Error('Il commit locale non è stato verificato.');
      if(remoteExpected){
        await window.NG_FORCE_REMOTE_SAVE(result.state);
        if(window.NG_FLUSH_REMOTE_SAVE)await window.NG_FLUSH_REMOTE_SAVE();
        const status=window.NG_REMOTE_SAVE_STATUS||{};
        if(status.pending||['retrying','pending-auth'].includes(status.status))throw new Error('Il backend non ha confermato il salvataggio della simulazione.');
        if(window.NG_VERIFY_REMOTE_SIMULATION){
          const verified=await window.NG_VERIFY_REMOTE_SIMULATION(result.operationId);
          if(!verified)throw new Error('Il torneo salvato sul backend non coincide con la simulazione appena generata.');
        }
      }
      store.save('public',result.state);
      try{UI.injectTeamLogoStyles?.(result.state);}catch(_){ }
      try{window.NexoraAdminRefresh?.(result.state);}catch(_){ }
      window.dispatchEvent(new CustomEvent('ng:simulation-complete',{detail:{state:result.state,summary:result.state._simulationSummary}}));
      return result;
    }catch(err){
      await rollback(snapshot,remoteExpected,result.operationId);
      throw new Error(`${err.message||err} È stato eseguito il rollback completo.`);
    }
  }

  async function run(rawOptions,onProgress){
    const opId=operationId(),started=Date.now();
    acquireLock(opId);
    const source=clone(A.state());
    const beforeArticles=safeJson(source.articles||[]);
    try{
      const checked=validateOptions(source,rawOptions,{requireConfirmations:true});
      if(!checked.ok)throw new Error(checked.message);
      simulationLog(opId,'start',{teamMode:checked.options.teamMode,format:checked.options.format,kings:checked.options.kings,duration:checked.options.duration,requestSource:checked.options.requestSource});
      const result=await buildSimulationWithProgress(source,checked.options,opId,onProgress);
      if(safeJson(result.state.articles||[])!==beforeArticles)throw new Error('Protezione articoli fallita.');
      await commitSimulation(result,onProgress);
      const summary=result.state._simulationSummary;
      simulationLog(opId,'commit',{teams:summary.teams,players:summary.players,format:summary.format,startDate:summary.startDate,endDate:summary.endDate,matches:summary.matches,events:summary.goals+summary.yellow+summary.red,winner:summary.winnerName,durationMs:Date.now()-started});
      return result;
    }catch(err){
      simulationLog(opId,'error',{message:String(err?.message||err),durationMs:Date.now()-started});
      throw err;
    }finally{releaseLock(opId);}
  }

  function selectedExistingTeams(){
    const source=A.state();
    if((source.teams||[]).length===8)return source.teams.map(t=>String(t.id));
    return (source.teams||[]).slice(0,8).map(t=>String(t.id));
  }
  function initialWizard(){return {step:0,running:false,options:{teamMode:(A.state().teams||[]).length>=8?'existing':'generated',selectedTeamIds:selectedExistingTeams(),format:'groups_knockout',kings:false,duration:'multi_day'}};}
  function choiceCard(name,value,title,description,checked,disabled=false){return `<label class="simulation-choice ${disabled?'is-disabled':''}"><input type="radio" name="${name}" value="${value}" ${checked?'checked':''} ${disabled?'disabled':''}><span><strong>${UI.esc(title)}</strong><small>${UI.esc(description)}</small></span></label>`;}
  function stepProgress(){return `<ol class="simulation-stepper" aria-label="Avanzamento procedura">${STEPS.map((label,index)=>`<li class="${index===wizard.step?'active':index<wizard.step?'done':''}" ${index===wizard.step?'aria-current="step"':''}><span>${index+1}</span><small>${label}</small></li>`).join('')}</ol>`;}

  function estimate(options){
    try{
      const source=A.state();
      const checked=validateOptions(source,options);if(!checked.ok)return {ok:false,message:checked.message};
      const {draft}=createDraft(source,checked.options,'preview');
      const generation=store.generateCalendar(draft,{preserveResults:false});
      if(!generation.ok)return generation;
      assignMultiDayTimes(draft);
      return {ok:true,matches:draft.matches.length,startDate:draft.rules.startDate,endDate:draft.rules.endDate,teams:draft.teams.length};
    }catch(err){return {ok:false,message:String(err?.message||err)};}
  }

  function renderStep(){
    if(!dialog||!wizard)return;
    const body=dialog.querySelector('#simulationStepBody');
    const source=A.state(),o=wizard.options;
    dialog.querySelector('#simulationStepper').innerHTML=stepProgress();
    if(wizard.step===0){
      const available=(source.teams||[]).length;
      const list=o.teamMode==='existing'&&available>=8?`<fieldset class="simulation-team-picker"><legend>Seleziona esattamente 8 squadre (${o.selectedTeamIds.length}/8)</legend>${source.teams.map(t=>`<label><input type="checkbox" data-existing-team value="${UI.esc(t.id)}" ${o.selectedTeamIds.includes(String(t.id))?'checked':''}><span>${UI.logo(t,false)}<strong>${UI.esc(t.name)}</strong><small>${(t.players||[]).length} giocatori attuali</small></span></label>`).join('')}</fieldset>`:'';
      body.innerHTML=`<div class="simulation-step-copy"><span class="pill">Passaggio 1 di 5</span><h3>Vuoi utilizzare le squadre già presenti nel sistema?</h3><p>La simulazione usa sempre 8 partecipanti, così tutti i formati restano confrontabili.</p></div><div class="simulation-choice-grid">${choiceCard('simulationTeamMode','existing','Usa squadre esistenti',available>=8?`Sono disponibili ${available} squadre. Selezionane 8.`:`Sono disponibili solo ${available} squadre: ne servono almeno 8.`,o.teamMode==='existing',available<8)}${choiceCard('simulationTeamMode','generated','Genera 8 squadre di prova','Crea nomi, colori e stemmi locali differenti.',o.teamMode==='generated')}</div>${list}${o.teamMode==='existing'?'<div class="message warn"><strong>Attenzione:</strong> i giocatori delle 8 squadre selezionate verranno sostituiti con 5 giocatori simulati per squadra.</div>':'<div class="help-box">Le squadre e le foto del torneo corrente saranno sostituite; articoli, sito e configurazioni esterne resteranno invariati.</div>'}`;
    }else if(wizard.step===1){
      body.innerHTML=`<div class="simulation-step-copy"><span class="pill">Passaggio 2 di 5</span><h3>Quale formato vuoi utilizzare?</h3><p>Sono mostrati soltanto i due formati ammessi dal flusso calendario manuale.</p></div><div class="simulation-format-grid">${FORMATS.map(format=>choiceCard('simulationFormat',format,FORMAT_META[format].title,FORMAT_META[format].description,o.format===format)).join('')}</div>`;
    }else if(wizard.step===2){
      body.innerHTML=`<div class="simulation-step-copy"><span class="pill">Passaggio 3 di 5</span><h3>Vuoi utilizzare il formato Kings?</h3><p>La modalità Kings usa le regole già previste dal progetto e garantisce un presidente per ogni squadra.</p></div><div class="simulation-choice-grid">${choiceCard('simulationKings','no','Formato standard','Presidenti facoltativi e punteggio standard.',!o.kings)}${choiceCard('simulationKings','yes','Formato Kings','Crea o completa i presidenti di tutte le squadre.',o.kings)}</div>`;
    }else if(wizard.step===3){
      body.innerHTML=`<div class="simulation-step-copy"><span class="pill">Passaggio 4 di 5</span><h3>Il torneo si svolge in un solo giorno o in più giorni?</h3><p>Il torneo viene generato come interamente concluso, con date nel passato e fasi sempre ordinate.</p></div><div class="simulation-choice-grid">${choiceCard('simulationDuration','one_day','Un solo giorno','Quattro campi, slot da 40 minuti e pause realistiche.',o.duration==='one_day')}${choiceCard('simulationDuration','multi_day','Più giorni','Una giornata o fase per data, senza doppie partite della stessa squadra.',o.duration==='multi_day')}</div>`;
    }else{
      const e=estimate(o);
      const sourceText=o.teamMode==='existing'?'8 squadre esistenti selezionate':'8 squadre simulate con stemmi locali';
      const interval=e.ok?(e.startDate===e.endDate?e.startDate:`${e.startDate} → ${e.endDate}`):'Da verificare';
      body.innerHTML=`<div class="simulation-step-copy"><span class="pill">Passaggio 5 di 5</span><h3>Riepilogo e conferma finale</h3><p>Il commit avverrà solo dopo la verifica completa di calendario, eventi, classifiche, tabellone e vincitore.</p></div><dl class="simulation-summary"><div><dt>Squadre</dt><dd>${UI.esc(sourceText)}</dd></div><div><dt>Giocatori</dt><dd>40 totali · esattamente 5 per squadra</dd></div><div><dt>Formato</dt><dd>${UI.esc(FORMAT_META[o.format].title)}</dd></div><div><dt>Kings</dt><dd>${o.kings?'Sì · presidente obbligatorio per ogni squadra':'No'}</dd></div><div><dt>Durata</dt><dd>${o.duration==='one_day'?'Un solo giorno':'Più giorni'}</dd></div><div><dt>Date</dt><dd>${UI.esc(interval)}</dd></div><div><dt>Partite previste</dt><dd>${e.ok?e.matches:'Configurazione non valida'}</dd></div><div><dt>Dati sostituiti</dt><dd>Squadre partecipanti, roster, calendario, referti, classifiche e tabellone</dd></div><div><dt>Dati mantenuti</dt><dd>Articoli, personalizzazione del sito e account amministrativi</dd></div></dl>${!e.ok?`<div class="message error">${UI.esc(e.message||'Configurazione non valida.')}</div>`:''}<div class="simulation-confirmations"><label class="check-card confirm-card"><input id="simulationReplaceConfirm" type="checkbox"><span><strong>Confermo la sostituzione dei dati del torneo</strong><small>Partite, eventi, classifiche e tabellone correnti saranno sostituiti.</small></span></label>${o.teamMode==='existing'?'<label class="check-card confirm-card"><input id="simulationRosterConfirm" type="checkbox"><span><strong>Confermo la sostituzione dei giocatori</strong><small>La simulazione rimuoverà gli attuali giocatori delle squadre selezionate e inserirà 5 giocatori di prova per ogni squadra.</small></span></label>':'<label class="check-card confirm-card"><input id="simulationTeamsConfirm" type="checkbox"><span><strong>Confermo la creazione delle 8 squadre simulate</strong><small>Le squadre correnti del torneo saranno sostituite.</small></span></label>'}</div>`;
    }
    updateButtons();
  }

  function validateCurrentStep(){
    const o=wizard.options,source=A.state();
    if(wizard.step===0){
      if(o.teamMode==='existing'&&(source.teams||[]).length<8)return 'Servono almeno 8 squadre esistenti.';
      if(o.teamMode==='existing'&&o.selectedTeamIds.length!==8)return 'Seleziona esattamente 8 squadre.';
    }
    if(wizard.step===1&&!FORMATS.includes(o.format))return 'Seleziona un formato supportato.';
    if(wizard.step===4){
      const required=[dialog.querySelector('#simulationReplaceConfirm'),dialog.querySelector('#simulationRosterConfirm')||dialog.querySelector('#simulationTeamsConfirm')].filter(Boolean);
      if(required.some(input=>!input.checked))return 'Conferma entrambe le operazioni distruttive prima di procedere.';
      const e=estimate(o);if(!e.ok)return e.message||'Configurazione non valida.';
    }
    return '';
  }
  function updateButtons(){
    const back=dialog.querySelector('#simulationBackBtn'),next=dialog.querySelector('#simulationNextBtn'),execute=dialog.querySelector('#simulationExecuteBtn');
    back.hidden=wizard.step===0||wizard.running;
    next.hidden=wizard.step===4||wizard.running;
    execute.hidden=wizard.step!==4;
    execute.disabled=wizard.running||Boolean(validateCurrentStep());
    dialog.querySelector('#cancelSimulationBtn').disabled=wizard.running;
  }

  function handleChange(event){
    if(wizard.running)return;
    const target=event.target;
    if(target.name==='simulationTeamMode'){
      wizard.options.teamMode=target.value==='existing'?'existing':'generated';
      if(wizard.options.teamMode==='existing'&&wizard.options.selectedTeamIds.length!==8)wizard.options.selectedTeamIds=selectedExistingTeams();
      renderStep();return;
    }
    if(target.matches('[data-existing-team]')){
      const id=String(target.value);
      if(target.checked){if(wizard.options.selectedTeamIds.length>=8){target.checked=false;showMessage('Puoi selezionare esattamente 8 squadre.','warn');return;}wizard.options.selectedTeamIds.push(id);}
      else wizard.options.selectedTeamIds=wizard.options.selectedTeamIds.filter(x=>x!==id);
      renderStep();return;
    }
    if(target.name==='simulationFormat'){wizard.options.format=target.value;renderStep();return;}
    if(target.name==='simulationKings'){wizard.options.kings=target.value==='yes';renderStep();return;}
    if(target.name==='simulationDuration'){wizard.options.duration=target.value==='one_day'?'one_day':'multi_day';renderStep();return;}
    updateButtons();
  }
  function showMessage(text,type='error'){const box=dialog.querySelector('#simulationDialogMsg');box.innerHTML=text?`<div class="message ${type}">${UI.esc(text)}</div>`:'';}
  function close(){
    if(!dialog||wizard?.running)return;
    dialog.classList.remove('show');
    document.body.classList.remove('ng-overlay-open');
    const trigger=dialogTrigger;dialogTrigger=null;
    requestAnimationFrame(()=>{if(trigger&&document.contains(trigger))trigger.focus?.({preventScroll:true});});
  }

  function finalPayload(){
    const o=wizard.options;
    return {
      teamMode:o.teamMode,
      selectedTeamIds:o.teamMode==='existing'?[...o.selectedTeamIds]:[],
      generatedTeamCount:8,
      format:o.format,
      kings:Boolean(o.kings),
      presidentMode:o.kings?'default_per_team':'none',
      duration:o.duration,
      replaceTournamentConfirmed:Boolean(dialog.querySelector('#simulationReplaceConfirm')?.checked),
      replacePlayersConfirmed:o.teamMode==='existing'&&Boolean(dialog.querySelector('#simulationRosterConfirm')?.checked),
      replaceTeamsConfirmed:o.teamMode==='generated'&&Boolean(dialog.querySelector('#simulationTeamsConfirm')?.checked),
      requestSource:'wizard-final-confirmation'
    };
  }

  function renderRunningProgress(){
    dialog.querySelector('#simulationStepper').innerHTML='';
    dialog.querySelector('#simulationStepBody').innerHTML=`<div class="simulation-step-copy"><span class="pill">Generazione in corso</span><h3>Sto creando e verificando il torneo simulato</h3><p>Non chiudere la pagina finché il commit non è stato confermato.</p></div><ol class="simulation-progress-list">${PROGRESS_STAGES.map(stage=>`<li data-progress-stage="${UI.esc(stage)}"><span aria-hidden="true">○</span><strong>${UI.esc(stage)}</strong><small>In attesa</small></li>`).join('')}</ol>`;
    dialog.querySelector('#simulationBackBtn').hidden=true;
    dialog.querySelector('#simulationNextBtn').hidden=true;
    dialog.querySelector('#simulationExecuteBtn').hidden=true;
    dialog.querySelector('#cancelSimulationBtn').disabled=true;
  }
  function updateRunningProgress(stage,detail){
    const items=[...dialog.querySelectorAll('[data-progress-stage]')];
    const index=items.findIndex(item=>item.dataset.progressStage===stage);
    items.forEach((item,i)=>{
      item.classList.toggle('done',i<index);
      item.classList.toggle('active',i===index);
      item.querySelector('span').textContent=i<index?'✓':i===index?'●':'○';
      item.querySelector('small').textContent=i===index?(detail||'In corso'):i<index?'Completato':'In attesa';
    });
  }
  function renderSuccess(result){
    wizard.running=false;
    const summary=result.state._simulationSummary;
    dialog.querySelector('#simulationStepBody').innerHTML=`<div class="simulation-success"><span class="simulation-success-icon">✓</span><span class="pill">Simulazione completata</span><h3>${UI.esc(summary.winnerName)} vince il torneo</h3><p>Il torneo è stato verificato e pubblicato nelle interfacce admin e utente.</p><div class="simulation-summary compact"><div><dt>Squadre</dt><dd>${summary.teams}</dd></div><div><dt>Giocatori</dt><dd>${summary.players}</dd></div><div><dt>Partite</dt><dd>${summary.matches}</dd></div><div><dt>Gol</dt><dd>${summary.goals}</dd></div><div><dt>Gialli / Rossi</dt><dd>${summary.yellow} / ${summary.red}</dd></div><div><dt>Periodo</dt><dd>${UI.esc(summary.startDate===summary.endDate?summary.startDate:`${summary.startDate} → ${summary.endDate}`)}</dd></div></div></div>`;
    dialog.querySelector('#simulationDialogMsg').innerHTML='';
    const cancel=dialog.querySelector('#cancelSimulationBtn');cancel.disabled=false;cancel.textContent='Chiudi';
  }

  async function execute(event){
    event?.preventDefault();event?.stopPropagation();
    if(!wizard||wizard.step!==4){showMessage('Completa tutti i passaggi prima di avviare la simulazione.','warn');return;}
    if(wizard.running)return;
    const validation=validateCurrentStep();if(validation){showMessage(validation);return;}
    const payload=finalPayload();
    const backendValidation=validateOptions(A.state(),payload,{requireConfirmations:true});
    if(!backendValidation.ok){showMessage(backendValidation.message,'warn');return;}
    wizard.running=true;wizard.lastPayload=clone(payload);showMessage('');renderRunningProgress();
    try{
      const result=await run(payload,updateRunningProgress);
      renderSuccess(result);
    }catch(err){
      console.error(err);
      wizard.running=false;
      wizard.step=4;
      renderStep();
      showMessage(`Simulazione non completata: ${err.message||err}. Le scelte sono state conservate; conferma nuovamente e riprova.`,'error');
      dialog.querySelector('#cancelSimulationBtn').disabled=false;
      dialog.querySelector('#cancelSimulationBtn').textContent='Chiudi';
    }
  }

  function ensureDialog(){
    if(dialog)return dialog;
    dialog=document.createElement('div');
    dialog.id='simulationDialog';dialog.className='ng-modal-backdrop';
    dialog.innerHTML=`<div class="ng-modal card pad simulation-modal simulation-wizard" role="dialog" aria-modal="true" aria-labelledby="simulationDialogTitle" tabindex="-1"><header class="simulation-wizard-head"><div><span class="pill">Test ecosistema</span><h2 id="simulationDialogTitle">Simula torneo</h2></div><button class="btn small" id="cancelSimulationBtn" type="button" aria-label="Chiudi procedura">Chiudi</button></header><div id="simulationStepper"></div><div id="simulationStepBody"></div><div id="simulationDialogMsg" aria-live="polite"></div><footer class="simulation-wizard-actions"><button class="btn" id="simulationBackBtn" type="button">Indietro</button><span></span><button class="btn" id="simulationNextBtn" type="button">Continua</button><button class="btn primary" id="simulationExecuteBtn" type="button">Genera torneo simulato</button></footer></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('change',handleChange);
    dialog.addEventListener('submit',event=>event.preventDefault());
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!wizard?.running){event.preventDefault();close();return;}
      if(event.key==='Enter'&&event.target.matches('input[type="radio"],input[type="checkbox"]'))event.preventDefault();
    });
    dialog.querySelector('#cancelSimulationBtn').addEventListener('click',event=>{event.preventDefault();close();});
    dialog.querySelector('#simulationBackBtn').addEventListener('click',event=>{event.preventDefault();if(wizard.running)return;wizard.step=Math.max(0,wizard.step-1);showMessage('');renderStep();});
    dialog.querySelector('#simulationNextBtn').addEventListener('click',event=>{event.preventDefault();if(wizard.running)return;const error=validateCurrentStep();if(error){showMessage(error,'warn');return;}wizard.step=Math.min(4,wizard.step+1);showMessage('');renderStep();});
    dialog.querySelector('#simulationExecuteBtn').addEventListener('click',execute);
    dialog.addEventListener('click',event=>{if(event.target===dialog&&!wizard?.running)close();});
    return dialog;
  }

  function open(trigger=null){
    ensureDialog();
    if(dialog.classList.contains('show'))return;
    dialogTrigger=trigger||document.activeElement;
    wizard=initialWizard();
    dialog.querySelector('#cancelSimulationBtn').textContent='Chiudi';
    showMessage('');renderStep();
    dialog.classList.add('show');
    document.body.classList.add('ng-overlay-open');
    requestAnimationFrame(()=>dialog.querySelector('input:checked:not(:disabled),button:not([hidden])')?.focus());
  }


  if(window.addEventListener)window.addEventListener('beforeunload',event=>{
    if(!running)return;
    event.preventDefault();
    event.returnValue='';
  });

  window.NGTournamentSimulation={open,run,buildSimulation,validateSimulation,estimate,normalizeOptions,FORMAT_META,TEAM_BLUEPRINTS,getWizardState:()=>wizard?clone(wizard):null,getFinalPayload:()=>wizard&&wizard.step===4?clone(finalPayload()):null};
})();
