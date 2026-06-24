(function(){
  const ADMIN_KEY='new-generation-admin-state-v23';
  const PUBLIC_KEY='new-generation-public-state-v23';
  const PENDING_REMOTE_SAVE_KEY='new-generation-pending-remote-save-v1';

  const FORMAT_LABELS={
    league:"Campionato all'italiana",
    knockout:'Eliminazione diretta',
    groups_knockout:'Gironi + eliminazione diretta',
    league_knockout:"Campionato all'italiana + eliminazione diretta"
  };
  const PHASE_LABELS={league:'Campionato',group:'Gironi',knockout:'Eliminazione diretta',playoff:'Playoff',secondary_playoff:'Playoff secondario',supercup:'Supercoppa'};
  const FORMAT_HELP={
    league:'Solo campionato: un unico girone, tutti contro tutti. Nessun tabellone.',
    knockout:'Solo tabellone a eliminazione diretta. Nessun girone, tabellone creato subito.',
    groups_knockout:'Fase a gironi bilanciati, poi eliminazione diretta con tabellone standard e BYE automatici quando servono. Le migliori dei gironi vengono distribuite per incontrarsi il più tardi possibile.',
    league_knockout:'Campionato unico, poi una o più competizioni a eliminazione diretta configurabili per fasce consecutive di classifica: Oro, Argento, Bronzo, ecc. Il seeding usa il tabellone standard: le migliori teste di serie sono distribuite per incontrarsi il più tardi possibile.'
  };

  const uid=p=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const compId=()=>uid('comp');
  function normalizeBirthYear(value){const n=Number(value);return Number.isInteger(n)&&n>=1900&&n<=2100?n:'';}
  function normalizeJerseyNumber(value){
    if(value===''||value==null)return '';
    const n=Number(value);
    return Number.isInteger(n)&&n>=0&&n<=999?n:'';
  }
  function normalizePenalties(value){
    if(!value||typeof value!=='object')return null;
    const h=Number(value.home), a=Number(value.away);
    // Entrambi devono essere interi >= 0; se uno è invalido, scartiamo tutto
    if(!Number.isInteger(h)||h<0||!Number.isInteger(a)||a<0)return null;
    if(h>99||a>99)return null;
    return {home:h, away:a};
  }
  const KNOCKOUT_PHASES=new Set(['knockout','playoff','secondary_playoff','supercup']);
  function isKnockoutPhase(m){return Boolean(m && (KNOCKOUT_PHASES.has(m.phase) || m.bracketName));}
  function normalizeMatchStatus(value){
    const v=String(value||'').toLowerCase();
    if(v==='played')return 'played';
    if(v==='live')return 'live';
    return 'scheduled';
  }
  function isPresidentId(state,id){return Boolean(id&&state?.teams?.some(t=>t.president?.id===id));}
  const defaultCompetitions=()=>[
    {id:'comp_oro',name:'Playoff Oro',startRank:1,teams:4}
  ];
  function defaultGroupConfigs(){return [{name:'Girone A',size:4,qualifiers:2},{name:'Girone B',size:4,qualifiers:2}];}
  function defaultSite(){return {title:'New Generation',subtitle:'Risultati, squadre, giocatori e dettagli partite.',logo:'',primary:'#fff45a',accent:'#d2a63a',surface:'#17170f',radius:'24'};}
  const STANDINGS_CRITERIA=[
    {id:'points',label:'Punti',short:'Pt',direction:'desc'},
    {id:'headToHead',label:'Scontri diretti',short:'SD',direction:'desc'},
    {id:'diff',label:'Differenza reti',short:'DR',direction:'desc'},
    {id:'goalsFor',label:'Gol fatti',short:'GF',direction:'desc'},
    {id:'goalsAgainst',label:'Gol subiti',short:'GS',direction:'asc'},
    {id:'cards',label:'Cartellini gialli + rossi',short:'CR',direction:'asc'}
  ];
  const defaultStandingsCriteriaOrder=()=>STANDINGS_CRITERIA.map(c=>c.id);
  function normalizeStandingsCriteriaOrder(value){
    const allowed=new Set(STANDINGS_CRITERIA.map(c=>c.id));
    const out=[];
    (Array.isArray(value)?value:[]).forEach(id=>{if(allowed.has(id)&&!out.includes(id))out.push(id);});
    STANDINGS_CRITERIA.forEach(c=>{if(!out.includes(c.id))out.push(c.id);});
    return out;
  }
  function standingsCriterionMeta(id){return STANDINGS_CRITERIA.find(c=>c.id===id)||STANDINGS_CRITERIA[0];}
  function normalizeHex(value, fallback){const v=String(value||'').trim();return /^#[0-9a-fA-F]{6}$/.test(v)?v:fallback;}
  function normalizeSite(site){const base=defaultSite();const out={...base,...(site||{})};out.title=String(out.title||base.title).trim().slice(0,80)||base.title;out.subtitle=String(out.subtitle||base.subtitle).trim().slice(0,160);out.logo=String(out.logo||'');out.primary=normalizeHex(out.primary,base.primary);out.accent=normalizeHex(out.accent,base.accent);out.surface=normalizeHex(out.surface,base.surface);out.radius=String(Math.max(8,Math.min(36,Number(out.radius)||24)));return out;}

  function articleSlug(value){
    return String(value||'articolo')
      .normalize('NFD').replace(/[̀-ͯ]/g,'')
      .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'articolo';
  }
  function normalizeArticleStatus(value){
    const status=String(value||'').toLowerCase();
    return ['draft','published','scheduled'].includes(status)?status:'published';
  }
  function normalizeArticleTags(value){
    const rows=Array.isArray(value)?value:String(value||'').split(',');
    return [...new Set(rows.map(tag=>String(tag||'').trim()).filter(Boolean).map(tag=>tag.slice(0,36)))].slice(0,12);
  }
  function normalizeArticleDate(value,fallback=''){
    if(!value)return fallback;
    const parsed=new Date(value);
    return Number.isNaN(parsed.getTime())?fallback:parsed.toISOString();
  }
  function normalizeArticles(value){
    const source=Array.isArray(value)?value:[];
    const usedSlugs=new Set();
    const now=new Date().toISOString();
    return source.map(raw=>{
      const a=raw&&typeof raw==='object'?raw:{};
      const createdAt=normalizeArticleDate(a.createdAt,now);
      const updatedAt=normalizeArticleDate(a.updatedAt,createdAt);
      const status=normalizeArticleStatus(a.status);
      const title=String(a.title||'Articolo senza titolo').trim().slice(0,160)||'Articolo senza titolo';
      const baseSlug=articleSlug(a.slug||title);
      let slug=baseSlug, suffix=2;
      while(usedSlugs.has(slug))slug=`${baseSlug.slice(0,Math.max(1,86-String(suffix).length))}-${suffix++}`;
      usedSlugs.add(slug);
      const publishedFallback=status==='published'?updatedAt:'';
      return {
        ...a,
        id:String(a.id||uid('article')),
        title,
        subtitle:String(a.subtitle||'').trim().slice(0,240),
        excerpt:String(a.excerpt||a.intro||'').trim().slice(0,420),
        body:String(a.body||a.content||''),
        image:String(a.image||''),
        imageAlt:String(a.imageAlt||'').trim().slice(0,220),
        imageCaption:String(a.imageCaption||'').trim().slice(0,280),
        author:String(a.author||'Redazione New Generation').trim().slice(0,100),
        category:String(a.category||'Aggiornamenti').trim().slice(0,80),
        tags:normalizeArticleTags(a.tags),
        status,
        slug,
        createdAt,
        updatedAt,
        publishedAt:normalizeArticleDate(a.publishedAt,publishedFallback),
        seoTitle:String(a.seoTitle||'').trim().slice(0,70),
        seoDescription:String(a.seoDescription||'').trim().slice(0,180),
        socialImage:String(a.socialImage||'')
      };
    }).sort((a,b)=>new Date(b.publishedAt||b.updatedAt||b.createdAt)-new Date(a.publishedAt||a.updatedAt||a.createdAt));
  }
  function isArticlePublic(article,at=Date.now()){
    if(!article)return false;
    if(article.status==='draft')return false;
    const publishTime=Date.parse(article.publishedAt||article.updatedAt||article.createdAt||0)||0;
    return article.status==='published'||(article.status==='scheduled'&&publishTime<=at);
  }

  function defaultCalendarCustomization(){return {version:4,minRestMinutes:0,firstRoundLocks:[],teamDebuts:[]};}
  function normalizeCalendarCustomization(value){
    const base=defaultCalendarCustomization();
    const raw=value&&typeof value==='object'?value:{};
    const out={...base};
    out.minRestMinutes=Math.max(0,Math.min(240,Number(raw.minRestMinutes)||0));
    out.firstRoundLocks=(Array.isArray(raw.firstRoundLocks)?raw.firstRoundLocks:[]).map(lock=>({
      id:String(lock.id||uid('lock')),
      groupName:String(lock.groupName||'').trim(),
      homeTeamId:String(lock.homeTeamId||''),
      awayTeamId:String(lock.awayTeamId||''),
      requiredDate:String(lock.requiredDate||'').trim(),
      requiredTime:String(lock.requiredTime||'').trim(),
      requiredField:String(lock.requiredField||'').trim(),
      mode:'hard'
    })).filter(lock=>lock.homeTeamId||lock.awayTeamId||lock.groupName).slice(0,80);
    out.teamDebuts=(Array.isArray(raw.teamDebuts)?raw.teamDebuts:[])
      .filter(rule=>rule?.kind==='exactTime')
      .map(rule=>({
        id:String(rule.id||uid('debut')),
        teamId:String(rule.teamId||''),
        kind:'exactTime',
        value:String(rule.value||'').trim(),
        mode:'hard'
      })).filter(rule=>rule.teamId||rule.value).slice(0,120);
    return out;
  }
  function blankRules(){return {name:'New Generation',format:'league',groupCount:2,groupConfigs:defaultGroupConfigs(),groupAssignments:{},playoffTeams:4,eliminationCompetitions:defaultCompetitions(),superCup:{enabled:false,homeCompetitionId:'comp_oro',awayCompetitionId:''},isKingsLeague:false,oneDay:false,fieldCount:1,startDate:'',endDate:'',startTime:'09:00',endTime:'18:00',matchDuration:40,breakMinutes:10,oneDayPauseEnabled:false,oneDayPauseStart:'13:00',oneDayPauseDuration:60,playingDays:[1,2,3,4,5,6,0],groupFieldPolicy:'auto',standingsCriteriaOrder:defaultStandingsCriteriaOrder(),calendarCustomization:defaultCalendarCustomization()};}
  function emptyState(){return {rules:blankRules(),site:defaultSite(),teams:[],matches:[],articles:[],teamPhotos:{},calendarSignature:''};}
  function normalizeRules(r){
    const base=blankRules();
    const out={...base,...(r||{})};
    if(!Array.isArray(out.eliminationCompetitions)||!out.eliminationCompetitions.length){
      if(r?.splitPlayoffs){out.eliminationCompetitions=[{id:'comp_oro',name:'Playoff Oro',startRank:1,teams:Number(r.playoffTeams)||4},{id:'comp_argento',name:'Playoff Argento',startRank:(Number(r.playoffTeams)||4)+1,teams:Number(r.secondaryPlayoffTeams)||4}];}
      else {out.eliminationCompetitions=[{id:'comp_oro',name:'Playoff Oro',startRank:1,teams:Number(r?.playoffTeams)||4}];}
    }
    out.eliminationCompetitions=out.eliminationCompetitions.map((c,i)=>({id:c.id||compId(),name:c.name||`Playoff ${i+1}`,startRank:Math.max(1,Number(c.startRank)||1),teams:Math.max(2,Number(c.teams)||4)}));
    out.superCup={...base.superCup,...(out.superCup||{})};
    if(out.eliminationCompetitions.length<2){out.superCup.enabled=false;out.superCup.awayCompetitionId='';}
    out.isKingsLeague=Boolean(out.isKingsLeague);
    out.groupCount=Math.max(2,Number(out.groupCount)||2);
    out.groupAssignments=out.groupAssignments&&typeof out.groupAssignments==='object'&&!Array.isArray(out.groupAssignments)?out.groupAssignments:{};
    if(!Array.isArray(out.groupConfigs)||!out.groupConfigs.length){out.groupConfigs=Array.from({length:out.groupCount},(_,i)=>({name:`Girone ${String.fromCharCode(65+i)}`,size:4,qualifiers:Math.min(2,4)}));}
    out.groupConfigs=out.groupConfigs.map((g,i)=>({name:g.name||`Girone ${String.fromCharCode(65+i)}`,size:Math.max(2,Number(g.size)||4),qualifiers:Math.max(0,Number(g.qualifiers)||0)}));
    out.groupCount=out.groupConfigs.length||out.groupCount;
    out.playoffTeams=out.groupConfigs.reduce((sum,g)=>sum+(Number(g.qualifiers)||0),0)||Math.max(2,Number(out.playoffTeams)||4);
    out.fieldCount=Math.max(1,Number(out.fieldCount)||1);out.matchDuration=Math.max(5,Number(out.matchDuration)||40);out.breakMinutes=Math.max(0,Number(out.breakMinutes)||0);out.oneDayPauseEnabled=Boolean(out.oneDayPauseEnabled);out.oneDayPauseStart=out.oneDayPauseStart||'13:00';out.oneDayPauseDuration=Math.max(0,Number(out.oneDayPauseDuration)||60);
    out.playingDays=Array.isArray(out.playingDays)?out.playingDays.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6):[1,2,3,4,5,6,0];
    out.groupFieldPolicy=out.groupFieldPolicy==='fixed_by_group'?'fixed_by_group':'auto';
    out.standingsCriteriaOrder=normalizeStandingsCriteriaOrder(out.standingsCriteriaOrder);
    out.calendarCustomization=normalizeCalendarCustomization(out.calendarCustomization);
    return out;
  }
  function normalizeState(data){const s={...emptyState(),...(data||{})};s.rules=normalizeRules(s.rules);s.site=normalizeSite(s.site);s.calendarSignature=typeof s.calendarSignature==='string'?s.calendarSignature:'';s.teams=Array.isArray(s.teams)?s.teams:[];s.matches=Array.isArray(s.matches)?s.matches:[];s.teams.forEach(t=>{t.id=t.id||uid('team');t.name=t.name||'Squadra';t.logo=t.logo||'';t.players=Array.isArray(t.players)?t.players:[];t.president=(t.president&&typeof t.president==='object')?t.president:{name:t.presidentName||''};t.president.id=t.president.id||uid('president');t.president.name=String(t.president.name||'').trim();t.coach=(t.coach&&typeof t.coach==='object')?t.coach:{name:t.coachName||''};t.coach.name=String(t.coach.name||'').trim();t.players.forEach(p=>{p.id=p.id||uid('player');p.name=p.name||'Calciatore';p.birthYear=normalizeBirthYear(p.birthYear||p.year||p.annoNascita);p.number=normalizeJerseyNumber(p.number);delete p.role;});});s.matches.forEach((m,i)=>{m.id=m.id||uid('match');m.phase=m.phase||'league';m.round=m.round||`Giornata ${i+1}`;m.roundIndex=Number(m.roundIndex)||0;m.groupName=m.groupName||'';m.bracketRound=m.bracketRound||'';m.bracketName=m.bracketName||'';m.bracketRoundIndex=Number(m.bracketRoundIndex)||0;m.bracketMatchIndex=Number(m.bracketMatchIndex)||0;m.sourceHome=m.sourceHome||'';m.sourceAway=m.sourceAway||'';m.homeTeamId=m.homeTeamId||'';m.awayTeamId=m.awayTeamId||'';m.homeLabel=m.homeLabel||'';m.awayLabel=m.awayLabel||'';m.manualLock=Boolean(m.manualLock);m.requiredDate=m.requiredDate||'';m.requiredTime=m.requiredTime||'';m.requiredField=m.requiredField||'';m.date=m.date||'';m.time=m.time||'';m.datetime=m.datetime||'';m.field=m.field||'';m.referee=m.referee||'';m.status=normalizeMatchStatus(m.status);m.penalties=normalizePenalties(m.penalties);m.goals=Array.isArray(m.goals)?m.goals.map(g=>normalizeGoalEvent(g,m)):[];m.cards=Array.isArray(m.cards)?m.cards.map(c=>{const card={id:c.id||uid('card'),playerId:c.playerId||'',type:c.type==='red'?'red':'yellow'};const minute=normalizeEventMinute(c.minute,120);if(minute)card.minute=minute;return card;}):[];});s.articles=normalizeArticles(s.articles);s.teamPhotos=normalizeTeamPhotos(s.teamPhotos,s.teams);return alignState(s,{silent:true});}
  // teamPhotos: { teamId: [{path, name, size, ts}] } - solo metadati, le foto reali su Supabase Storage
  function normalizeTeamPhotos(raw,teams){
    if(!raw||typeof raw!=='object') return {};
    const validTeamIds=new Set((teams||[]).map(t=>t.id));
    const out={};
    Object.keys(raw).forEach(teamId=>{
      if(!validTeamIds.has(teamId)) return;
      const arr=Array.isArray(raw[teamId])?raw[teamId]:[];
      const clean=arr.filter(p=>p&&typeof p==='object'&&p.path).map(p=>{
        const o={
          path:String(p.path),
          name:String(p.name||'foto.jpg').slice(0,80),
          size:Number(p.size)||0,
          ts:Number(p.ts)||Date.now()
        };
        // v104: estensione dell'originale (per ricostruire l'URL)
        if(p.originalExt) o.originalExt=String(p.originalExt).slice(0,5);
        // v104: dimensione originale
        if(p.originalSize) o.originalSize=Number(p.originalSize)||0;
        // Legacy (v97-v98): manteniamo per retrocompat
        if(p.thumbPath) o.thumbPath=String(p.thumbPath);
        if(p.thumbSize) o.thumbSize=Number(p.thumbSize)||0;
        if(p.originalPath) o.originalPath=String(p.originalPath);
        return o;
      }).sort((a,b)=>b.ts-a.ts);
      if(clean.length) out[teamId]=clean;
    });
    return out;
  }
  function legacyStorageKeys(){
    try{return Object.keys(localStorage).filter(k=>/^new-generation-(admin|public)-state-v\d+$/.test(k)||/^nexora-(admin|public)-state/.test(k));}
    catch(e){return [];}
  }
  function cleanupLegacyStorage(keep=[]){
    const keepSet=new Set(keep);
    legacyStorageKeys().forEach(k=>{if(!keepSet.has(k))try{localStorage.removeItem(k);}catch(e){}});
  }
  function isDataUrl(value){return typeof value==='string'&&value.startsWith('data:');}
  function compactDataUrl(value,maxChars=350000){
    if(!isDataUrl(value))return value||'';
    return value.length<=maxChars?value:'';
  }
  function readStoredStateRaw(key){
    try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}catch(_){return null;}
  }
  function readPendingRemoteState(){
    try{
      const raw=localStorage.getItem(PENDING_REMOTE_SAVE_KEY);
      if(!raw)return null;
      const parsed=JSON.parse(raw);
      if(!parsed||!parsed.state)return null;
      return {state:normalizeState(parsed.state),hash:parsed.hash||'',updatedAt:parsed.updatedAt||''};
    }catch(_){return null;}
  }
  function stateTimeValue(value){return Date.parse(value||0)||0;}
  function newestAdminLocalState(){
    const base=readStoredStateRaw(ADMIN_KEY);
    const pending=readPendingRemoteState();
    if(pending&&pending.state){
      const baseTime=stateTimeValue(base&&base._localUpdatedAt);
      const pendingTime=Math.max(stateTimeValue(pending.state._localUpdatedAt),stateTimeValue(pending.updatedAt));
      if(!base||pendingTime>=baseTime)return pending.state;
    }
    return base;
  }
  function mergeMissingMedia(next, previous){
    if(!next||!previous)return next;
    const oldTeams=Object.fromEntries((previous.teams||[]).map(t=>[t.id,t]));
    (next.teams||[]).forEach(t=>{
      const old=oldTeams[t.id];
      if(old&&(!t.logo||String(t.logo).length<80)&&old.logo)t.logo=old.logo;
    });
    const oldArticles=Object.fromEntries((previous.articles||[]).map(a=>[a.id,a]));
    (next.articles||[]).forEach(a=>{
      const old=oldArticles[a.id];
      if(!old||!old.image)return;
      const nextTime=Date.parse(a.updatedAt||a.createdAt||0)||0;
      const oldTime=Date.parse(old.updatedAt||old.createdAt||0)||0;
      const looksLikePartialUpdate=nextTime<=oldTime || String(a.image||'').length<80;
      if((!a.image||String(a.image).length<80)&&looksLikePartialUpdate)a.image=old.image;
    });
    return next;
  }
  function publicCacheState(state){
    const s=normalizeState(state);
    const previous=readStoredStateRaw(PUBLIC_KEY);
    const copy=mergeMissingMedia(JSON.parse(JSON.stringify(s)), previous);
    copy.teams=(copy.teams||[]).map(t=>({...t,logo:compactDataUrl(t.logo,350000)}));
    copy.articles=(copy.articles||[]).slice(0,20).map(a=>({...a,image:compactDataUrl(a.image,180000)}));
    return copy;
  }
  function withoutHeavyMedia(state){
    const copy=JSON.parse(JSON.stringify(normalizeState(state)));
    copy.teams=(copy.teams||[]).map(t=>({...t,logo:isDataUrl(t.logo)?'':(t.logo||'')}));
    copy.articles=(copy.articles||[]).map(a=>({...a,image:isDataUrl(a.image)?'':(a.image||'')}));
    return copy;
  }
  function trySetLocalStorage(key,value){
    try{localStorage.setItem(key,value);return true;}
    catch(err){
      const name=err&&err.name?err.name:'';
      const msg=err&&err.message?err.message:String(err||'');
      const quota=name==='QuotaExceededError'||name==='NS_ERROR_DOM_QUOTA_REACHED'||msg.toLowerCase().includes('quota');
      if(!quota)throw err;
      return false;
    }
  }
  const lastLocalWriteByKey={};
  let publicCacheWriteTimer=null;
  let pendingPublicCacheState=null;
  function writeLocalState(key,value){
    if(lastLocalWriteByKey[key]===value)return true;
    if(trySetLocalStorage(key,value)){lastLocalWriteByKey[key]=value;return true;}
    return false;
  }
  function safeWriteState(key,state,{publicCache=false}={}){
    cleanupLegacyStorage([ADMIN_KEY,PUBLIC_KEY]);
    const first=publicCache?publicCacheState(state):normalizeState(state);
    if(writeLocalState(key,JSON.stringify(first)))return {ok:true,compact:false};
    // Rimuove la cache pubblica prima di ritentare: evita doppio salvataggio admin+public con immagini pesanti.
    try{if(key!==PUBLIC_KEY)localStorage.removeItem(PUBLIC_KEY);}catch(e){}
    cleanupLegacyStorage([key]);
    if(writeLocalState(key,JSON.stringify(first)))return {ok:true,compact:false};
    const compact=withoutHeavyMedia(state);
    if(writeLocalState(key,JSON.stringify(compact)))return {ok:true,compact:true};
    console.warn('Spazio browser esaurito: stato non salvato in localStorage. I dati online restano la fonte principale.');
    return {ok:false,compact:true};
  }
  function load(mode){
    try{
      cleanupLegacyStorage([ADMIN_KEY,PUBLIC_KEY]);
      if(mode==='admin'){
        const adminState=newestAdminLocalState();
        return adminState?normalizeState(adminState):emptyState();
      }
      const raw=localStorage.getItem(PUBLIC_KEY);
      return raw?normalizeState(JSON.parse(raw)):emptyState();
    }catch(e){return emptyState();}
  }
  function schedulePublicCacheWrite(clean){
    pendingPublicCacheState=clean;
    clearTimeout(publicCacheWriteTimer);
    publicCacheWriteTimer=setTimeout(()=>{
      if(!pendingPublicCacheState)return;
      safeWriteState(PUBLIC_KEY,pendingPublicCacheState,{publicCache:true});
      pendingPublicCacheState=null;
    },350);
  }
  function save(mode,state){
    const clean=normalizeState(state);
    if(mode==='public'){
      safeWriteState(PUBLIC_KEY,clean,{publicCache:true});
      return clean;
    }
    const skipLocalTimestamp=Boolean(clean._skipLocalTimestamp);
    delete clean._skipLocalTimestamp;
    if(!skipLocalTimestamp){
      clean._localUpdatedAt=new Date().toISOString();
      clean._localRevision=Date.now();
    }
    safeWriteState(ADMIN_KEY,clean,{publicCache:false});
    // La copia pubblica locale è solo cache: la aggiorniamo in debounce per non bloccare i commit admin.
    schedulePublicCacheWrite(clean);
    try{
      window.dispatchEvent(new CustomEvent('ng:admin-local-state-saved',{detail:{state:clean}}));
    }catch(_){ }
    return clean;
  }
  function getTeam(state,id){return state.teams.find(t=>t.id===id);} 
  function getPlayer(state,id){for(const t of state.teams){const p=t.players.find(x=>x.id===id);if(p)return {...p,team:t,type:'player'};}return null;}
  function getPresident(state,id){for(const t of state.teams){if(t.president?.id===id&&t.president?.name)return {...t.president,team:t,type:'president'};}return null;}
  function getParticipant(state,id){return getPlayer(state,id)||getPresident(state,id);}
  function playerTeamId(state,playerId){const x=getParticipant(state,playerId);return x?.team.id||'';}
  function teamName(state,id,fallback='Da definire'){return getTeam(state,id)?.name||fallback;}
  function playerName(state,id){const p=getParticipant(state,id);return p?(p.type==='president'?`Pres. ${p.name}`:p.name):'Persona rimossa';}
  function presidentGoalLabel(state,id){
    const p=getPresident(state,id);
    return p?`${p.name} (rig.)`:'Presidente rimosso';
  }
  function isDoubleGoalEvent(g){return Number(g?.weight)===2;}
  function isOwnGoalEvent(g){return Boolean(g&&g.ownGoal===true);}
  function normalizeEventMinute(value,max=120){
    const minute=Number(value);
    return Number.isInteger(minute)&&minute>=1&&minute<=max?minute:'';
  }
  function normalizeGoalEvent(g,m=null){
    const minute=normalizeEventMinute(g?.minute,120);
    const base={id:g?.id||uid('goal'),playerId:g?.playerId||'',weight:Number(g?.weight)===2?2:1};
    if(minute)base.minute=minute;
    if(isOwnGoalEvent(g)){
      const teamId=String(g.teamId||g.scoringTeamId||'');
      const valid=!m || teamId===m.homeTeamId || teamId===m.awayTeamId;
      return {...base,playerId:'',ownGoal:true,teamId:valid?teamId:'',weight:1};
    }
    return base;
  }
  function goalScoringTeamId(state,m,g){
    if(isOwnGoalEvent(g))return (g.teamId===m?.homeTeamId||g.teamId===m?.awayTeamId)?g.teamId:'';
    return playerTeamId(state,g?.playerId);
  }
  function goalEventLabel(state,m,g){
    if(isOwnGoalEvent(g)){
      const team=teamName(state,g.teamId,'squadra');
      return `Autogol a favore di ${team}`;
    }
    return isPresidentId(state,g?.playerId)?presidentGoalLabel(state,g?.playerId):playerName(state,g?.playerId);
  }
  function aggregateGoalEvents(state,m){
    const groups=new Map();
    (m?.goals||[]).forEach(g=>{
      const own=isOwnGoalEvent(g);
      const teamId=goalScoringTeamId(state,m,g);
      const key=own?`own:${teamId}`:`player:${g?.playerId||''}`;
      if(!groups.has(key)){
        const participant=own?null:getParticipant(state,g?.playerId);
        groups.set(key,{
          key,
          teamId,
          playerId:own?'':(g?.playerId||''),
          ownGoal:own,
          label:goalEventLabel(state,m,g),
          number:participant?.type==='player'?(participant.number??''):'',
          count:0,
          scoreValue:0,
          doubleCount:0,
          weights:new Set()
        });
      }
      const row=groups.get(key);
      row.count+=1;
      const value=eventScoreWeight(state,g);
      row.scoreValue+=value;
      if(!own&&value===2)row.doubleCount+=1;
      row.weights.add(value);
    });
    return Array.from(groups.values()).map(row=>({...row,weights:Array.from(row.weights).sort((a,b)=>a-b)}));
  }
  function actualGoalCount(state,m,teamId){return (m.goals||[]).filter(g=>goalScoringTeamId(state,m,g)===teamId).length;}
  function eventScoreWeight(state,g){return isOwnGoalEvent(g)?1:(isPresidentId(state,g?.playerId)?1:((state?.rules?.isKingsLeague&&isDoubleGoalEvent(g))?2:1));}
  function matchGoals(state,m){let home=0,away=0;(m.goals||[]).forEach(g=>{const tid=goalScoringTeamId(state,m,g);const w=eventScoreWeight(state,g);if(tid===m.homeTeamId)home+=w;if(tid===m.awayTeamId)away+=w;});return {home,away};}
  function isLive(state,m){return m?.status==='live';}
  function hasGoals(state,m){const sc=matchGoals(state,m);return sc.home+sc.away>0;}
  function hasScore(state,m){
    if(!m)return false;
    if(m.status==='played')return true;
    if(m.status==='live')return false;
    const sc=matchGoals(state,m);
    if(sc.home+sc.away>0)return true;
    // KO 0-0 ma con rigori inseriti → consideralo con risultato
    if(isKnockoutPhase(m)&&m.penalties){
      const p=normalizePenalties(m.penalties);
      if(p&&(p.home+p.away)>0)return true;
    }
    return false;
  }
  function isPlayed(state,m){return hasScore(state,m) || (m.cards||[]).length>0 || Boolean(m.referee||m.field||m.date||m.time||m.datetime);}
  function matchStatusInfo(state,m){
    if(!m)return {key:'pending',label:'Da giocare',cls:'is-pending'};
    if(m.status==='live')return {key:'live',label:'Live',cls:'is-live'};
    const played=m.status==='played'||hasScore(state,m);
    return played?{key:'played',label:'Giocata',cls:'is-played'}:{key:'pending',label:'Da giocare',cls:'is-pending'};
  }
  function scoreText(state,m){
    const s=matchGoals(state,m);
    const base=`${s.home} - ${s.away}`;
    if(s.home===s.away && isKnockoutPhase(m) && m.penalties){
      const p=normalizePenalties(m.penalties);
      if(p)return `${base} (${p.home}-${p.away} d.c.r.)`;
    }
    return base;
  }
  function penaltyWinnerId(state,m){
    if(!m||!m.penalties)return '';
    const p=normalizePenalties(m.penalties);
    if(!p)return '';
    if(p.home>p.away)return m.homeTeamId||'';
    if(p.away>p.home)return m.awayTeamId||'';
    return '';
  }
  function winnerId(state,m){
    if(!m)return '';
    if(m.homeTeamId&&!m.awayTeamId&&(m.awayLabel==='BYE'||!m.awayLabel))return m.homeTeamId;
    if(m.awayTeamId&&!m.homeTeamId&&(m.homeLabel==='BYE'||!m.homeLabel))return m.awayTeamId;
    const sc=matchGoals(state,m);
    if(sc.home>sc.away)return m.homeTeamId;
    if(sc.away>sc.home)return m.awayTeamId;
    // Pareggio nei tempi regolamentari: nelle fasi KO i rigori decidono
    if(isKnockoutPhase(m)){
      const pw=penaltyWinnerId(state,m);
      if(pw)return pw;
    }
    return '';
  }

  function isPowerOfTwo(n){return Number.isInteger(n)&&n>=2&&(n&(n-1))===0;}
  function nextPow2(n){let p=1;while(p<n)p*=2;return p;}
  function daysBetween(start,end){const a=new Date(start+'T00:00'),b=new Date(end+'T00:00');return Math.floor((b-a)/864e5)+1;}
  function addDays(date,days){const d=new Date(date+'T00:00');d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}
  function weekdayOf(date){return new Date(date+'T00:00').getDay();}
  function weekdayLabels(days){const names=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];return (days||[]).map(d=>names[Number(d)]).join(', ');}
  function allowedDateList(start,end,playingDays){
    if(!start||!end)return [];
    const total=daysBetween(start,end);
    if(total<1)return [];
    const allowed=new Set((playingDays&&playingDays.length?playingDays:[0,1,2,3,4,5,6]).map(Number));
    const out=[];
    for(let i=0;i<total;i++){const d=addDays(start,i);if(allowed.has(weekdayOf(d)))out.push(d);}
    return out;
  }
  function requiredPlayingDaysForMatches(matches,rules){
    const fields=Math.max(1,Number(rules.fieldCount)||1);
    return matchesByRoundIndex(matches).reduce((sum,[,roundMatches])=>sum+Math.ceil(roundMatches.length/fields),0);
  }
  function suggestEndDateForMatches(matches,rules){
    rules=normalizeRules(rules);
    if(rules.oneDay){
      if(!rules.startDate||!rules.startTime)return {ok:false,message:'Inserisci data e ora inizio per stimare la fine del torneo giornaliero.'};
      const fields=Math.max(1,Number(rules.fieldCount)||1);
      const duration=Math.max(5,Number(rules.matchDuration)||40);
      const breakMinutes=Math.max(0,Number(rules.breakMinutes)||0);
      const step=duration+breakMinutes;
      const requiredSlots=matchesByRoundIndex(matches).reduce((sum,[,roundMatches])=>sum+Math.ceil(roundMatches.length/fields),0);
      const start=new Date(`${rules.startDate}T${rules.startTime}`);
      const pause=oneDayPauseWindow(rules);
      let scheduledSlots=0, slot=0, lastSlot=0;
      const guard=Math.max(200,requiredSlots+100);
      while(scheduledSlots<requiredSlots&&slot<guard){
        const dt=oneDaySlotDate(rules.startDate,rules.startTime,slot,step);
        const dayMinutes=dt.getHours()*60+dt.getMinutes();
        if(!slotOverlapsPause(dayMinutes,dayMinutes+duration,pause)){scheduledSlots++;lastSlot=slot;}
        slot++;
      }
      if(scheduledSlots<requiredSlots)return {ok:false,oneDay:true,message:'Impossibile stimare la fine del torneo giornaliero: controlla pausa programmata, durata partite e ora inizio.'};
      const end=new Date(start.getTime()+Math.max(0,lastSlot)*step*60000+duration*60000);
      const endTime=end.toTimeString().slice(0,5);
      const pauseText=pause?` Pausa programmata alle ${pause.startTime} per ${pause.duration} min.`:'';
      return {ok:true,oneDay:true,requiredSlots,calculatedEndTime:endTime,suggestedEndDate:rules.startDate,message:`Fine stimata torneo: ${endTime}. Calcolo su ${requiredSlots} slot, ${fields} campi, durata ${duration} min e pausa tra slot ${breakMinutes} min.${pauseText}`};
    }
    if(!rules.startDate)return {ok:false,message:'Inserisci la data inizio per stimare la data fine.'};
    const needed=requiredPlayingDaysForMatches(matches,rules);
    const days=rules.playingDays&&rules.playingDays.length?rules.playingDays:[0,1,2,3,4,5,6];
    let found=0,offset=0,last=rules.startDate;
    const guard=3660;
    while(found<needed&&offset<guard){const d=addDays(rules.startDate,offset);if(days.includes(weekdayOf(d))){found++;last=d;}offset++;}
    if(found<needed)return {ok:false,message:'Impossibile stimare la data fine entro un intervallo ragionevole. Controlla i giorni di gioco.'};
    return {ok:true,requiredDays:needed,suggestedEndDate:last,playingDaysLabel:weekdayLabels(days),message:`Con ${rules.fieldCount} campi e giorni di gioco ${weekdayLabels(days)}, servono circa ${needed} giorni di gioco. Data fine consigliata: ${last}.`};
  }

  function minimumTeams(r){r=normalizeRules(r);if(r.format==='league')return 2;if(r.format==='knockout')return 2;if(r.format==='groups_knockout')return Math.max(4,r.groupConfigs.reduce((sum,g)=>sum+g.size,0));if(r.format==='league_knockout'){const maxEnd=Math.max(...r.eliminationCompetitions.map(c=>c.startRank+c.teams-1),0);return Math.max(2,maxEnd);}return 2;}
  function groupConfigsTotal(r){return normalizeRules(r).groupConfigs.reduce((sum,g)=>sum+g.size,0);}
  function groupQualifiersTotal(r){return normalizeRules(r).groupConfigs.reduce((sum,g)=>sum+g.qualifiers,0);}
  function pairKey(a,b){return [a,b].filter(Boolean).sort().join('|');}
  function roundRobinPairs(teams){const arr=[...teams];if(arr.length%2)arr.push(null);const rounds=[];const n=arr.length;for(let r=0;r<n-1;r++){const pairs=[];for(let i=0;i<n/2;i++){const a=arr[i],b=arr[n-1-i];if(a&&b)pairs.push(r%2?[b,a]:[a,b]);}rounds.push(pairs);arr.splice(1,0,arr.pop());}return rounds;}
  function manualLocksForScope(rules,groupName=''){
    const wanted=String(groupName||'');
    return normalizeCalendarCustomization(rules?.calendarCustomization).firstRoundLocks
      .filter(lock=>String(lock.groupName||'')===wanted&&lock.homeTeamId&&lock.awayTeamId);
  }
  function roundRobinPairsWithLocks(teams,locks=[]){
    const validTeams=new Map((teams||[]).map(t=>[t.id,t]));
    const usedTeams=new Set(), usedPairs=new Set();
    const first=[];
    (locks||[]).forEach(lock=>{
      const h=validTeams.get(lock.homeTeamId), a=validTeams.get(lock.awayTeamId);
      if(!h||!a||h.id===a.id||usedTeams.has(h.id)||usedTeams.has(a.id))return;
      first.push([h,a,{manualLock:true,requiredDate:lock.requiredDate||'',requiredTime:lock.requiredTime||'',requiredField:lock.requiredField||''}]);
      usedTeams.add(h.id);usedTeams.add(a.id);usedPairs.add(pairKey(h.id,a.id));
    });
    const remaining=[...(teams||[])].filter(t=>!usedTeams.has(t.id));
    while(remaining.length>1){
      const h=remaining.shift(), a=remaining.pop();
      first.push([h,a,{manualLock:false}]);
      usedPairs.add(pairKey(h.id,a.id));
    }
    const pending=[];
    for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++){
      const h=teams[i],a=teams[j],key=pairKey(h.id,a.id);
      if(!usedPairs.has(key))pending.push([h,a,{manualLock:false}]);
    }
    const rounds=first.length?[first]:[];
    while(pending.length){
      const round=[], roundTeams=new Set();
      for(let i=0;i<pending.length;){
        const [h,a]=pending[i];
        if(roundTeams.has(h.id)||roundTeams.has(a.id)){i++;continue;}
        round.push(pending.splice(i,1)[0]);roundTeams.add(h.id);roundTeams.add(a.id);
      }
      if(!round.length)round.push(pending.shift());
      rounds.push(round);
    }
    return rounds;
  }
  function splitGroupsBalanced(teams,n){const groups=Array.from({length:n},(_,i)=>({name:`Girone ${String.fromCharCode(65+i)}`,teams:[]}));teams.forEach((t,i)=>groups[i%n].teams.push(t));return groups;}
  function splitGroupsByConfig(teams,configs,assignments={}){
    // Distribuzione serpentina stile seeding: evita gironi creati solo a blocchi consecutivi
    // e mantiene più bilanciata la forza se l'ordine squadre rappresenta il ranking/seed.
    // Se esistono assegnazioni manuali valide, vengono rispettate e i posti vuoti sono riempiti.
    const groups=configs.map((g,i)=>({name:g.name||`Girone ${String.fromCharCode(65+i)}`,size:Math.max(2,Number(g.size)||2),qualifiers:Math.max(0,Number(g.qualifiers)||0),teams:[]}));
    if(!groups.length)return [];
    const byName=Object.fromEntries(groups.map(g=>[g.name,g]));
    const used=new Set();
    teams.forEach(t=>{const name=assignments&&assignments[t.id];const g=byName[name];if(g&&g.teams.length<g.size){g.teams.push(t);used.add(t.id);}});
    const remaining=teams.filter(t=>!used.has(t.id));
    let direction=1,idx=0;
    remaining.forEach(t=>{
      let guard=0;
      while(groups[idx]&&groups[idx].teams.length>=groups[idx].size&&guard<groups.length*3){idx+=direction;if(idx>=groups.length){idx=groups.length-1;direction=-1;}if(idx<0){idx=0;direction=1;}guard++;}
      if(groups[idx]&&groups[idx].teams.length<groups[idx].size)groups[idx].teams.push(t);
      idx+=direction;
      if(idx>=groups.length){idx=groups.length-1;direction=-1;}
      if(idx<0){idx=0;direction=1;}
    });
    return groups;
  }
  function plannedGroups(state){const r=normalizeRules(state.rules);return splitGroupsByConfig([...(state.teams||[])],r.groupConfigs,r.groupAssignments||{});}
  function initialPhaseName(rules){const r=normalizeRules(rules);return r.format==='groups_knockout'?'group':'league';}
  function isInitialPhaseMatch(match){return match&&['group','league'].includes(match.phase);}
  function compareMatchesChronological(a,b){
    return (Number(a.roundIndex)||0)-(Number(b.roundIndex)||0)
      ||String(a.date||'9999-99-99').localeCompare(String(b.date||'9999-99-99'))
      ||String(a.time||'99:99').localeCompare(String(b.time||'99:99'))
      ||fieldNoFromLabel(a.field)-fieldNoFromLabel(b.field)
      ||String(a.id||'').localeCompare(String(b.id||''));
  }
  function orderedInitialMatches(matches){return [...(matches||[])].filter(isInitialPhaseMatch).sort(compareMatchesChronological);}
  function firstTeamInitialMatch(matches,teamId){return orderedInitialMatches(matches).find(m=>m.homeTeamId===teamId||m.awayTeamId===teamId)||null;}
  function groupAssignmentsFromMatches(state){const map={};(state.matches||[]).filter(m=>m.phase==='group'&&m.groupName).forEach(m=>{if(m.homeTeamId)map[m.homeTeamId]=m.groupName;if(m.awayTeamId)map[m.awayTeamId]=m.groupName;});return map;}
  function validateGroupAssignments(state,assignments){const r=normalizeRules(state.rules);if(r.format!=='groups_knockout')return {ok:false,message:'Le assegnazioni manuali sono disponibili solo per Gironi + eliminazione diretta.'};const names=r.groupConfigs.map(g=>g.name);const counts=Object.fromEntries(names.map(n=>[n,0]));for(const t of state.teams){const g=assignments[t.id];if(!g)return {ok:false,message:`Assegna anche ${t.name}.`};if(!names.includes(g))return {ok:false,message:`${t.name} è assegnata a un girone non valido.`};counts[g]++;}
    for(const cfg of r.groupConfigs){if(counts[cfg.name]!==cfg.size)return {ok:false,message:`${cfg.name}: ${counts[cfg.name]} squadre assegnate, ma la dimensione configurata è ${cfg.size}.`};}
    return {ok:true,message:'Assegnazioni valide.'};}
  function serpentineAssignments(state){const r=normalizeRules(state.rules);const groups=splitGroupsByConfig([...(state.teams||[])],r.groupConfigs,{});const out={};groups.forEach(g=>g.teams.forEach(t=>out[t.id]=g.name));return out;}
  function shuffleInPlace(list){
    for(let i=list.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [list[i],list[j]]=[list[j],list[i]];
    }
    return list;
  }
  function seededRng(seed){
    let h=2166136261;
    String(seed||'').split('').forEach(ch=>{h^=ch.charCodeAt(0);h=Math.imul(h,16777619);});
    return function(){h+=0x6D2B79F5;let t=h;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  }
  function seededShuffle(list,seed){
    const a=[...list], rnd=seededRng(seed);
    for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  }
  function randomAssignments(state){const r=normalizeRules(state.rules);const teams=shuffleInPlace([...(state.teams||[])]);const groups=splitGroupsByConfig(teams,r.groupConfigs,{});const out={};groups.forEach(g=>g.teams.forEach(t=>out[t.id]=g.name));return out;}
  function createMatch(home,away,phase,round,roundIndex,extra={}){return {id:uid('match'),homeTeamId:home?.id||'',awayTeamId:away?.id||'',homeLabel:home?.label||home?.name||'',awayLabel:away?.label||away?.name||'',phase,round,roundIndex,groupName:extra.groupName||'',bracketRound:extra.bracketRound||'',bracketName:extra.bracketName||'',bracketRoundIndex:Number(extra.bracketRoundIndex)||0,bracketMatchIndex:Number(extra.bracketMatchIndex)||0,sourceHome:extra.sourceHome||'',sourceAway:extra.sourceAway||'',manualLock:Boolean(extra.manualLock),requiredDate:extra.requiredDate||'',requiredTime:extra.requiredTime||'',requiredField:extra.requiredField||'',date:'',time:'',datetime:'',field:'',referee:'',status:'scheduled',goals:[],cards:[]};}
  function bracketRoundName(roundNo,totalRounds){if(roundNo===totalRounds)return 'Finale';if(roundNo===totalRounds-1)return 'Semifinali';if(roundNo===totalRounds-2)return 'Quarti di finale';if(roundNo===totalRounds-3)return 'Ottavi di finale';return `Turno ${roundNo}`;}
  // Seeding KO standard: non basta accoppiare 1-ultima, 2-penultima in ordine,
  // perché in un tabellone a 8 metterebbe 1ª e 2ª nella stessa metà. Qui usiamo
  // la classica distribuzione ricorsiva degli slot: 4 => 1-4 / 2-3,
  // 8 => 1-8 / 4-5 / 2-7 / 3-6. Così le teste di serie migliori
  // possono incontrarsi solo nei turni più avanzati compatibili col formato.
  function seedEntrantsHighLow(entrants){const out=[];for(let i=0,j=entrants.length-1;i<j;i++,j--){out.push(entrants[i],entrants[j]);}if(entrants.length%2)out.push(entrants[Math.floor(entrants.length/2)]);return out;}
  function entrantLabelFromSeed(seed){return seed?`${seed}ª classificata`:'BYE';}
  const STANDARD_SEED_ORDER_CACHE=new Map();
  function standardBracketSeedOrder(n){
    n=nextPow2(Math.max(2,Number(n)||2));
    if(STANDARD_SEED_ORDER_CACHE.has(n))return [...STANDARD_SEED_ORDER_CACHE.get(n)];
    let order;
    if(n<=2)order=[1,2].slice(0,n);
    else{
      const prev=standardBracketSeedOrder(n/2);
      order=prev.flatMap(seed=>[seed,n+1-seed]);
    }
    STANDARD_SEED_ORDER_CACHE.set(n,order);
    return [...order];
  }
  function standardSeedSlotIndex(size,seed){return standardBracketSeedOrder(size).indexOf(seed);}
  function buildStandardSeedSlots(entrants){
    const size=nextPow2(Math.max(2,entrants.length));
    const order=standardBracketSeedOrder(size);
    return order.map(seed=>entrants[seed-1]||{label:'BYE',seed});
  }
  function buildFirstRoundSlots(entrants,{prePaired=false}={}){
    const size=nextPow2(Math.max(2,entrants.length));
    if(prePaired){const slots=[...entrants];while(slots.length<size)slots.push({label:'BYE'});return slots;}
    return buildStandardSeedSlots(entrants.map((entry,i)=>({...entry,seed:entry.seed||i+1})));
  }
  function genKO(entrants,phase,startIndex,prefix='',bracketName='Tabellone',options={}){
    const size=nextPow2(Math.max(2,entrants.length));
    let slots=buildFirstRoundSlots(entrants,options);
    const total=Math.log2(size);
    const out=[];let current=slots;
    for(let r=1;r<=total;r++){
      const roundName=bracketRoundName(r,total);
      const roundLabel=prefix?`${prefix} · ${roundName}`:roundName;
      const next=[];
      for(let i=0;i<current.length;i+=2){
        const a=current[i],b=current[i+1];
        const matchNo=Math.floor(i/2)+1;
        out.push(createMatch(a,b,phase,roundLabel,startIndex+r-1,{bracketRound:roundName,bracketName,bracketRoundIndex:r,bracketMatchIndex:matchNo,sourceHome:a?.source||'',sourceAway:b?.source||''}));
        next.push({label:`Vincente ${roundName} ${matchNo}`,source:`winner:${bracketName}:${r}:${matchNo}`});
      }
      current=next;
    }
    return out;
  }
  function leagueEntrants(count,startRank=0,label='Classificata'){return Array.from({length:count},(_,i)=>({label:`${startRank+i+1}ª ${label}`,source:`league:${startRank+i+1}`,seed:i+1}));}
  function groupSlot(group,pos){return {label:`${pos}ª Girone ${group}`,source:`group:Girone ${group}:${pos}`};}
  const GROUP_KNOCKOUT_ALLOWED_TEXT='2 o più qualificate complessive';
  function removePickedCandidate(list,candidate){
    const idx=list.indexOf(candidate);
    if(idx>=0)list.splice(idx,1);
    return candidate;
  }
  function compareGroupEntrantsForFill(a,b){
    return (Number(b.pos)||0)-(Number(a.pos)||0) || (Number(a.groupIndex)||0)-(Number(b.groupIndex)||0) || String(a.label||'').localeCompare(String(b.label||''));
  }
  function pickGroupEntrantForSlot(candidates,slots,slotIndex){
    if(!candidates.length)return null;
    const pairedSlot=slotIndex%2===0?slotIndex+1:slotIndex-1;
    const pairedGroup=slots[pairedSlot]?.groupName||'';
    const ordered=[...candidates].sort(compareGroupEntrantsForFill);
    const preferred=pairedGroup?ordered.find(c=>c.groupName!==pairedGroup):ordered[0];
    return removePickedCandidate(candidates,preferred||ordered[0]);
  }
  function groupFirstRoundPenalty(slots){
    let score=0;
    for(let i=0;i<slots.length;i+=2){
      const a=slots[i],b=slots[i+1];
      if(!a||!b)continue;
      const aBye=String(a.label||'').toUpperCase()==='BYE';
      const bBye=String(b.label||'').toUpperCase()==='BYE';
      if(aBye&&bBye)score+=10000;
      if(aBye||bBye)continue;
      if(a.groupName&&b.groupName&&a.groupName===b.groupName)score+=1000;
      if(Number(a.pos)===1&&Number(b.pos)===1)score+=800;
      if(Number(a.pos)>1&&Number(a.pos)===Number(b.pos))score+=220;
      if(Number(a.pos)>1&&Number(b.pos)>1)score+=Math.max(0,60-Math.abs(Number(a.pos)-Number(b.pos))*25);
    }
    return score;
  }
  function improveGroupFirstRoundSlots(slots,locked=()=>false){
    let best=[...slots], bestScore=groupFirstRoundPenalty(best);
    if(!bestScore)return best;
    let improved=true;
    while(improved){
      improved=false;
      for(let i=0;i<best.length;i++){
        if(locked(i,best[i]))continue;
        for(let j=i+1;j<best.length;j++){
          if(locked(j,best[j]))continue;
          if(Math.floor(i/2)===Math.floor(j/2))continue;
          const candidate=[...best];
          [candidate[i],candidate[j]]=[candidate[j],candidate[i]];
          const score=groupFirstRoundPenalty(candidate);
          if(score<bestScore){best=candidate;bestScore=score;improved=true;}
          if(!bestScore)return best;
        }
      }
    }
    return best;
  }
  function isByeEntry(entry){return String(entry?.label||'').toUpperCase()==='BYE';}
  function groupEntry(group,pos,groupIndex){return {label:`${pos}ª ${group.name}`,source:`group:${group.name}:${pos}`,groupName:group.name,groupIndex,pos};}
  function twoGroupEqualQualifierSlots(groups){
    const a=groups[0], b=groups[1];
    const qa=Number(a.qualifiers)||0, qb=Number(b.qualifiers)||0;
    if(qa!==qb||qa<1)return null;
    const A=pos=>groupEntry(a,pos,0);
    const B=pos=>groupEntry(b,pos,1);
    // V117: per due gironi equivalenti usiamo un seeding sportivo intercalato:
    // A1, B1, A2, B2, A3, B3... poi lo inseriamo negli slot standard del tabellone.
    // Effetti:
    // - le prime stanno in metà opposte;
    // - i BYE, quando servono, vanno alle migliori posizioni complessive;
    // - 2ª e 3ª vengono incrociate con l'altro girone, non contro pari posizione;
    // - il criterio continua a funzionare per 1, 2, 3, 4, 5, 6... qualificate per girone.
    const ranked=[];
    for(let pos=1;pos<=qa;pos++)ranked.push(A(pos),B(pos));
    return buildStandardSeedSlots(ranked.map((entry,i)=>({...entry,seed:i+1}))).map((entry,i)=>({...entry,seed:i+1}));
  }
  function genericGroupQualifierSlots(groups,entrants){
    const size=nextPow2(Math.max(2,entrants.length));
    const byes=size-entrants.length;
    const slots=Array(size).fill(null);
    const sorted=[...entrants].sort((x,y)=>(Number(x.pos)||99)-(Number(y.pos)||99)||(Number(x.groupIndex)||0)-(Number(y.groupIndex)||0));
    const bye={label:'BYE'};
    // I bye vanno alle migliori teste di serie disponibili, distribuite negli slot standard.
    let seed=1;
    const remaining=[...sorted];
    for(let i=0;i<byes&&remaining.length;i++){
      const entry=remaining.shift();
      const slot=standardSeedSlotIndex(size,seed++);
      if(slot>=0){slots[slot]=entry;slots[slot%2===0?slot+1:slot-1]=bye;}
    }
    const winners=remaining.filter(e=>e.pos===1);
    const rest=remaining.filter(e=>e.pos!==1);
    winners.forEach(w=>{
      const slot=standardSeedSlotIndex(size,seed++);
      if(slot>=0&&!slots[slot])slots[slot]=w; else rest.push(w);
    });
    const pool=rest.sort(compareGroupEntrantsForFill);
    standardBracketSeedOrder(size).forEach(s=>{
      const slot=standardSeedSlotIndex(size,s);
      if(slot>=0&&!slots[slot])slots[slot]=pickGroupEntrantForSlot(pool,slots,slot)||bye;
    });
    for(let i=0;i<slots.length;i++)if(!slots[i])slots[i]=pool.shift()||bye;
    const locked=(idx,entry)=>Number(entry?.pos)===1||isByeEntry(entry);
    return improveGroupFirstRoundSlots(slots,locked).map((entry,i)=>({...entry,seed:i+1}));
  }
  function groupQualifierSlotsFromConfigs(groupConfigs){
    const groups=normalizeRules({groupConfigs}).groupConfigs;
    const entrants=[];
    groups.forEach((g,groupIndex)=>{
      for(let pos=1;pos<=g.qualifiers;pos++)entrants.push(groupEntry(g,pos,groupIndex));
    });
    if(!entrants.length)return entrants;

    // Specializzazione per due gironi equivalenti: replica il criterio più usato
    // nei tornei sportivi a gironi, cioè incrocio tra posizioni complementari
    // dell'altro girone (A2-B3, B2-A3), prime separate e bye alle prime se
    // il numero di qualificate non è già una potenza di 2.
    if(groups.length===2){
      const special=twoGroupEqualQualifierSlots(groups);
      if(special)return special;
    }
    return genericGroupQualifierSlots(groups,entrants);
  }
  function sortedCompetitions(r){return normalizeRules(r).eliminationCompetitions.slice().sort((a,b)=>a.startRank-b.startRank||a.name.localeCompare(b.name));}

  function buildMatches(state){
    const r=normalizeRules(state.rules);
    const variant='';
    const teams=variant?seededShuffle(state.teams,variant):[...state.teams];
    const matches=[];
    if(r.format==='league'){
      roundRobinPairsWithLocks(teams,manualLocksForScope(r,'')).forEach((round,i)=>round.forEach(([h,a,extra])=>matches.push(createMatch(h,a,'league',`Giornata ${i+1}`,i,extra||{}))));
      return matches;
    }
    if(r.format==='knockout')return genKO(teams,'knockout',0,'Tabellone','Tabellone principale');
    if(r.format==='groups_knockout'){
      const groups=splitGroupsByConfig(teams,r.groupConfigs,r.groupAssignments||{});
      const groupRounds=groups.map(g=>roundRobinPairsWithLocks(variant?seededShuffle(g.teams,`${variant}:${g.name}`):g.teams,manualLocksForScope(r,g.name)));
      const maxGroupRounds=Math.max(...groupRounds.map(rounds=>rounds.length),0);
      groups.forEach((g,gi)=>{
        groupRounds[gi].forEach((round,ri)=>round.forEach(([h,a,extra])=>matches.push(createMatch(h,a,'group',`${g.name} · Giornata ${ri+1}`,ri,{...(extra||{}),groupName:g.name}))));
      });
      matches.push(...genKO(groupQualifierSlotsFromConfigs(r.groupConfigs),'knockout',maxGroupRounds,'Fase finale','Fase finale',{prePaired:true}));
      return matches;
    }
    if(r.format==='league_knockout'){
      const rounds=roundRobinPairsWithLocks(teams,manualLocksForScope(r,''));
      rounds.forEach((round,i)=>round.forEach(([h,a,extra])=>matches.push(createMatch(h,a,'league',`Giornata ${i+1}`,i,extra||{}))));
      let maxKO=0;
      sortedCompetitions(r).forEach((c,idx)=>{const phase=idx===0?'playoff':'secondary_playoff';const entrants=leagueEntrants(c.teams,c.startRank-1,'classificata');matches.push(...genKO(entrants,phase,rounds.length,c.name,c.name));maxKO=Math.max(maxKO,Math.log2(nextPow2(c.teams)));});
      if(r.superCup?.enabled){const comps=sortedCompetitions(r);const h=comps.find(c=>c.id===r.superCup.homeCompetitionId)||comps[0];const a=comps.find(c=>c.id===r.superCup.awayCompetitionId)||comps[1];if(h&&a&&h.id!==a.id){matches.push(createMatch({label:`Vincente ${h.name}`,source:`bracketwinner:${h.name}`},{label:`Vincente ${a.name}`,source:`bracketwinner:${a.name}`},'supercup','Supercoppa',rounds.length+maxKO,{bracketRound:'Supercoppa',bracketName:'Supercoppa',bracketRoundIndex:1,bracketMatchIndex:1,sourceHome:`bracketwinner:${h.name}`,sourceAway:`bracketwinner:${a.name}`}));}}
      return matches;
    }
    return matches;
  }

  function matchesByRoundIndex(matches){const map=new Map();matches.forEach(m=>{const k=m.roundIndex||0;if(!map.has(k))map.set(k,[]);map.get(k).push(m);});return [...map.entries()].sort((a,b)=>a[0]-b[0]);}

  function matchTeamIds(m){return [m.homeTeamId,m.awayTeamId].filter(Boolean);}
  function timeLabel(d){return d.toTimeString().slice(0,5);}
  function localDateLabel(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function dateTimeKey(date,time,field){return `${date}|${time||'NO_TIME'}|${field}`;}
  function minutesFromTime(value){const [h,m]=String(value||'00:00').split(':').map(Number);return (Number(h)||0)*60+(Number(m)||0);}
  function oneDayPauseWindow(rules){rules=normalizeRules(rules);if(!rules.oneDay||!rules.oneDayPauseEnabled||!rules.oneDayPauseStart||!rules.oneDayPauseDuration)return null;const start=minutesFromTime(rules.oneDayPauseStart);const end=start+Math.max(0,Number(rules.oneDayPauseDuration)||0);return end>start?{start,end,startTime:rules.oneDayPauseStart,duration:Math.max(0,Number(rules.oneDayPauseDuration)||0)}:null;}
  function slotOverlapsPause(slotStart,slotEnd,pause){return Boolean(pause&&slotStart<pause.end&&slotEnd>pause.start);}
  function oneDaySlotDate(startDate,startTime,slot,step){return new Date(new Date(`${startDate}T${startTime}`).getTime()+slot*step*60000);}
  function oneDayCalendarPauseEvent(rules){const pause=oneDayPauseWindow(rules);if(!pause||!rules.startDate)return null;return {type:'pause',id:'pause_one_day',date:rules.startDate,time:pause.startTime,duration:pause.duration,label:'Pausa programmata'};}

  function groupFieldMap(rules){
    rules=normalizeRules(rules);
    const groups=rules.groupConfigs||[];
    if(rules.format!=='groups_knockout'||rules.groupFieldPolicy!=='fixed_by_group'||groups.length!==rules.fieldCount)return null;
    return Object.fromEntries(groups.map((g,i)=>[g.name,i+1]));
  }
  function allowedFieldsForMatch(match,rules){
    const fixed=groupFieldMap(rules);
    const allFields=Array.from({length:Math.max(1,Number(rules.fieldCount)||1)},(_,i)=>i+1);
    const required=fieldNoFromLabel(match.requiredField);
    if(required)return allFields.includes(required)?[required]:[];
    if(fixed&&match.phase==='group'&&match.groupName&&fixed[match.groupName]){
      const own=fixed[match.groupName];
      return [own,...allFields.filter(field=>field!==own)];
    }
    return allFields;
  }
  function orderRoundMatches(roundMatches,rules){
    const fixed=groupFieldMap(rules);
    if(!fixed||!roundMatches.some(match=>match.phase==='group'))return [...roundMatches];
    const buckets=new Map(Object.keys(fixed).map(group=>[group,[]]));
    const other=[];
    roundMatches.forEach(match=>{const bucket=buckets.get(match.groupName);if(bucket&&match.phase==='group')bucket.push(match);else other.push(match);});
    const ordered=[];
    const groupOrder=Object.entries(fixed).sort((a,b)=>a[1]-b[1]).map(([group])=>group);
    while(groupOrder.some(group=>buckets.get(group).length))groupOrder.forEach(group=>{const match=buckets.get(group).shift();if(match)ordered.push(match);});
    return ordered.concat(other);
  }
  function groupFieldPolicyMessage(rules){
    const fixed=groupFieldMap(rules);
    if(!fixed)return '';
    return ' Mappatura campi attiva: '+Object.entries(fixed).map(([g,f])=>`${g} → Campo ${f}`).join(' · ')+'. I campi liberi possono essere usati temporaneamente dall altro girone solo quando il proprio campo è già occupato.';
  }
  function timeToMinutes(value){const m=String(value||'').match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null;}
  function requiredSlotOk(match,date,time,field){
    if(match.requiredDate&&match.requiredDate!==date)return false;
    if(match.requiredTime&&match.requiredTime!==time)return false;
    if(match.requiredField&&match.requiredField!==field)return false;
    return true;
  }
  function hasEnoughRest(match,teamLastEnd,startDateTime,minRestMinutes){
    if(!minRestMinutes)return true;
    return matchTeamIds(match).every(tid=>{
      const prev=teamLastEnd.get(tid);
      if(!prev)return true;
      return startDateTime.getTime()-prev.getTime()>=minRestMinutes*60000;
    });
  }

  function calendarAvailableTimes(state){
    const normalized=normalizeState(JSON.parse(JSON.stringify(state||emptyState())));
    const rules=normalizeRules(normalized.rules);
    if(!rules.oneDay||!rules.startDate||!rules.startTime)return [];
    const duration=Math.max(5,Number(rules.matchDuration)||40);
    const step=duration+Math.max(0,Number(rules.breakMinutes)||0);
    const fields=Math.max(1,Number(rules.fieldCount)||1);
    const custom=normalizeCalendarCustomization(rules.calendarCustomization);
    normalized.rules.calendarCustomization={...custom,teamDebuts:[]};
    const matches=buildMatches(normalized);
    const initial=matches.filter(isInitialPhaseMatch);
    const grouped=matchesByRoundIndex(initial);
    const baseSlots=Math.max(1,grouped.reduce((sum,[,roundMatches])=>sum+Math.ceil(roundMatches.length/fields),0));
    const restPadding=Math.ceil(Math.max(0,custom.minRestMinutes)/Math.max(1,step))*Math.max(0,grouped.length-1);
    const wanted=Math.min(240,baseSlots+restPadding+fields+2);
    const pause=oneDayPauseWindow(rules);
    const out=[];
    for(let slot=0,guard=0;out.length<wanted&&guard<wanted+120;slot++,guard++){
      const dt=oneDaySlotDate(rules.startDate,rules.startTime,slot,step);
      if(localDateLabel(dt)!==rules.startDate)break;
      const startMinutes=dt.getHours()*60+dt.getMinutes();
      if(slotOverlapsPause(startMinutes,startMinutes+duration,pause))continue;
      out.push(timeLabel(dt));
    }
    return [...new Set(out)];
  }
  function validateCalendarConstraintDefinitions(state,matches=null){
    const normalized=normalizeState(JSON.parse(JSON.stringify(state||emptyState())));
    const rules=normalizeRules(normalized.rules);
    const built=matches||buildMatches(normalized);
    const custom=rules.calendarCustomization;
    const issues=[];
    const teamIds=new Set((normalized.teams||[]).map(team=>team.id));
    const seenTeams=new Set();
    const firstInitialByTeam=new Map();
    orderedInitialMatches(built).forEach(match=>matchTeamIds(match).forEach(teamId=>{if(!firstInitialByTeam.has(teamId))firstInitialByTeam.set(teamId,match);}));
    const availableTimes=new Set(calendarAvailableTimes(normalized));
    const exactByMatch=new Map();
    custom.teamDebuts.forEach(rule=>{
      const meta={severity:'error',rule:'Orario esatto esordio',sourceType:'teamDebut',sourceId:rule.id,step:2,modifiable:true};
      if(!rule.teamId){issues.push({...meta,message:'Seleziona una squadra per completare il vincolo.',suggestion:'Scegli una squadra oppure elimina la riga incompleta.'});return;}
      if(!teamIds.has(rule.teamId)){issues.push({...meta,message:'Il vincolo usa una squadra non presente nel torneo.',suggestion:'Sostituisci la squadra rimossa o elimina il vincolo.'});return;}
      if(seenTeams.has(rule.teamId))issues.push({...meta,message:`${teamName(normalized,rule.teamId,'Squadra')}: esiste già un vincolo sull orario di esordio.`,suggestion:'Mantieni un solo orario di esordio per squadra.'});
      seenTeams.add(rule.teamId);
      const requested=timeToMinutes(rule.value);
      if(!rules.oneDay){issues.push({...meta,message:'Il vincolo di orario richiede la modalità torneo in un giorno.',suggestion:'Attiva il torneo in un giorno oppure rimuovi il vincolo.'});return;}
      if(requested===null||!availableTimes.has(rule.value)){issues.push({...meta,message:`L orario ${rule.value||'selezionato'} non appartiene agli slot disponibili.`,suggestion:'Scegli uno degli orari proposti dal selettore.'});return;}
      const match=firstInitialByTeam.get(rule.teamId);
      if(!match){issues.push({...meta,message:'Non esiste una partita iniziale per la squadra selezionata.',suggestion:'Controlla l assegnazione della squadra al torneo.'});return;}
      const previous=exactByMatch.get(match.id);
      if(previous&&previous.value!==rule.value)issues.push({...meta,message:`Le due squadre della stessa partita richiedono orari di esordio diversi (${previous.value} e ${rule.value}).`,suggestion:'Imposta lo stesso orario per entrambe oppure rimuovi uno dei vincoli.'});
      else exactByMatch.set(match.id,{value:rule.value,rule});
    });
    const timeCounts=new Map();
    exactByMatch.forEach(({value,rule})=>{const count=(timeCounts.get(value)||0)+1;timeCounts.set(value,count);if(count>Math.max(1,Number(rules.fieldCount)||1))issues.push({severity:'error',rule:'Orario esatto esordio',sourceType:'teamDebut',sourceId:rule.id,step:2,modifiable:true,message:`Troppi esordi distinti sono richiesti alle ${value}: i campi disponibili sono ${rules.fieldCount}.`,suggestion:'Distribuisci gli esordi su orari differenti o aumenta i campi.'});});
    const errors=issues.filter(issue=>issue.severity==='error');
    return {ok:errors.length===0,issues,errors,message:errors.length?`${errors.length} vincolo/i non valido/i.`:'Vincoli validi.'};
  }

  function calendarConsecutiveStats(matches,rules,state=null){
    const normalizedRules=normalizeRules(rules||{});
    const step=Math.max(5,Number(normalizedRules.matchDuration)||40)+Math.max(0,Number(normalizedRules.breakMinutes)||0);
    const byTeam=new Map();
    (matches||[]).forEach(match=>{
      if(!match?.date||!match?.time)return;
      const minute=timeToMinutes(match.time);
      if(minute===null)return;
      matchTeamIds(match).forEach(teamId=>{
        if(!byTeam.has(teamId))byTeam.set(teamId,[]);
        byTeam.get(teamId).push({date:match.date,minute,time:match.time,matchId:match.id});
      });
    });
    const teamIds=[];
    const occurrencesByTeam={};
    const maxRunByTeam={};
    const restMinutesByTeam={};
    let totalOccurrences=0,threePlusOccurrences=0,maxRun=0;
    byTeam.forEach((raw,teamId)=>{
      const slots=[...new Map(raw.map(item=>[`${item.date}|${item.time}`,item])).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.minute-b.minute||String(a.matchId).localeCompare(String(b.matchId)));
      let occurrences=0,currentRun=slots.length?1:0,teamMax=currentRun;
      const rests=[];
      for(let index=1;index<slots.length;index++){
        const previous=slots[index-1],current=slots[index];
        if(current.date===previous.date){
          const delta=current.minute-previous.minute;
          rests.push(Math.max(0,delta-Math.max(5,Number(normalizedRules.matchDuration)||40)));
          if(delta===step){occurrences++;currentRun++;if(currentRun>=3)threePlusOccurrences++;}
          else currentRun=1;
        }else currentRun=1;
        teamMax=Math.max(teamMax,currentRun);
      }
      if(occurrences>0)teamIds.push(teamId);
      occurrencesByTeam[teamId]=occurrences;
      maxRunByTeam[teamId]=teamMax;
      restMinutesByTeam[teamId]=rests;
      totalOccurrences+=occurrences;
      maxRun=Math.max(maxRun,teamMax);
    });
    const teamNames=teamIds.map(teamId=>state?teamName(state,teamId,teamId):teamId);
    const threePlusTeamIds=teamIds.filter(teamId=>(maxRunByTeam[teamId]||0)>=3);
    return {
      uniqueTeams:teamIds.length,
      totalOccurrences,
      teamIds,
      teamNames,
      occurrencesByTeam,
      maxRunByTeam,
      maxRun,
      threePlusOccurrences,
      threePlusTeamIds,
      threePlusTeamNames:threePlusTeamIds.map(teamId=>state?teamName(state,teamId,teamId):teamId),
      restMinutesByTeam
    };
  }
  function consecutiveResultMessage(stats){
    if(!stats||stats.uniqueTeams===0)return 'Calendario generato correttamente. Nessuna squadra giocherà due partite consecutive.';
    const names=stats.teamNames?.length?` Squadre coinvolte: ${stats.teamNames.join(', ')}.`:'';
    const runs=stats.threePlusTeamNames?.length?` Sequenze di almeno tre partite consecutive: ${stats.threePlusTeamNames.join(', ')}.`:'';
    return `Calendario generato correttamente. Squadre con almeno due partite consecutive: ${stats.uniqueTeams}. Occorrenze consecutive complessive: ${stats.totalOccurrences}.${names}${runs}`;
  }

  // Scheduler vincolato:
  // - mai due partite sullo stesso campo nello stesso slot;
  // - mai la stessa squadra in contemporanea;
  // - nei tornei multi-giorno una squadra non gioca più di una partita nello stesso giorno;
  // - nei tornei in un giorno la stessa squadra può giocare anche slot consecutivi, ma mai nello stesso slot.
  // Le fasi/roundIndex vengono pianificate in ordine, così un turno KO non viene calendarizzato prima del turno precedente.
  function scheduleMatches(matches,rules,options={}){
    const custom=normalizeCalendarCustomization(rules.calendarCustomization);
    const fields=Math.max(1,Number(rules.fieldCount)||1);
    const duration=Math.max(5,Number(rules.matchDuration)||40);
    const breakMinutes=Math.max(0,Number(rules.breakMinutes)||0);
    const step=duration+breakMinutes;
    const fixedFields=groupFieldMap(rules);
    const fixedGroupMatches=fixedFields?matches.filter(match=>match.phase==='group'&&fixedFields[match.groupName]):[];
    const exactGroupMatches=rules.oneDay&&rules.format==='groups_knockout'?matches.filter(match=>match.phase==='group'):fixedGroupMatches;
    const exactGroupIds=new Set(exactGroupMatches.map(match=>match.id));
    const remainingMatches=exactGroupMatches.length?matches.filter(match=>!exactGroupIds.has(match.id)):matches;
    const units=[];
    if(exactGroupMatches.length)units.push({kind:'fixedGroups',matches:exactGroupMatches});
    matchesByRoundIndex(remainingMatches).forEach(([roundIndex,roundMatches])=>units.push({kind:'round',roundIndex,matches:orderRoundMatches(roundMatches,rules)}));

    const debutExactTimes=new Map();
    custom.teamDebuts.forEach(rule=>{if(rule.kind==='exactTime'&&rule.value&&timeToMinutes(rule.value)!==null)debutExactTimes.set(rule.teamId,rule.value);});
    const debutedTeams=new Set();
    let debutBlockIssue=null;
    const originalOrder=new Map(matches.map((match,index)=>[match.id,index]));

    function candidateRespectsDebutTime(match,teams,date,time){
      if(!isInitialPhaseMatch(match)||!debutExactTimes.size)return true;
      return teams.every(teamId=>{
        if(debutedTeams.has(teamId))return true;
        const required=debutExactTimes.get(teamId);
        if(!required)return true;
        if(time===required)return true;
        const source=custom.teamDebuts.find(rule=>rule.teamId===teamId)||{};
        const label=match.homeTeamId===teamId?(match.homeLabel||teamId):(match.awayLabel||teamId);
        debutBlockIssue={severity:'error',rule:'Orario esatto esordio',sourceType:'teamDebut',sourceId:source.id||'',step:2,message:`${label} deve disputare la prima partita alle ${required}, ma nessuno slot compatibile è disponibile.`,suggestion:'Scegli un altro orario disponibile o correggi gli altri vincoli.'};
        return false;
      });
    }
    function markInitialDebut(match,teams){if(isInitialPhaseMatch(match))teams.forEach(teamId=>debutedTeams.add(teamId));}
    function groupPrerequisites(stageMatches){
      const byTeam=new Map(), prerequisites=new Map(stageMatches.map(match=>[match.id,new Set()]));
      stageMatches.forEach(match=>matchTeamIds(match).forEach(teamId=>{if(!byTeam.has(teamId))byTeam.set(teamId,[]);byTeam.get(teamId).push(match);}));
      byTeam.forEach(teamMatches=>{
        teamMatches.sort((a,b)=>(Number(a.roundIndex)||0)-(Number(b.roundIndex)||0)||(originalOrder.get(a.id)||0)-(originalOrder.get(b.id)||0));
        for(let index=1;index<teamMatches.length;index++)prerequisites.get(teamMatches[index].id).add(teamMatches[index-1].id);
      });
      return prerequisites;
    }
    function isReady(match,scheduledIds,prerequisites){return [...(prerequisites.get(match.id)||[])].every(id=>scheduledIds.has(id));}
    function candidatePriority(match,date,time,fieldLabel){
      let urgency=0;
      if(match.requiredDate&&match.requiredDate===date)urgency+=8;
      if(match.requiredTime&&match.requiredTime===time)urgency+=12;
      if(match.requiredField&&match.requiredField===fieldLabel)urgency+=10;
      if(matchTeamIds(match).some(teamId=>!debutedTeams.has(teamId)&&debutExactTimes.get(teamId)===time))urgency+=20;
      return {urgency,round:Number(match.roundIndex)||0,order:originalOrder.get(match.id)||0};
    }
    function compareCandidates(a,b,date,time,fieldLabel){
      const pa=candidatePriority(a,date,time,fieldLabel),pb=candidatePriority(b,date,time,fieldLabel);
      return pb.urgency-pa.urgency||pa.round-pb.round||pa.order-pb.order||String(a.id).localeCompare(String(b.id));
    }

    if(rules.oneDay){
      if(!rules.startDate||!rules.startTime)return {ok:false,message:'Per torneo in un giorno indica data e ora inizio. L’ora fine viene calcolata automaticamente.'};
      const start=new Date(`${rules.startDate}T${rules.startTime}`);
      const pause=oneDayPauseWindow(rules);
      const estimatedSlots=Math.ceil((24*60)/Math.max(1,step))+1;
      const slotTeams=Array.from({length:estimatedSlots},()=>new Set());
      const slotFieldBusy=new Set();
      const teamLastEnd=new Map();
      let earliestSlot=0;
      let maxSlotUsed=-1;

      function oneDayCandidateFits(match,slot,field,dt){
        const teams=matchTeamIds(match),time=timeLabel(dt),fieldLabel=`Campo ${field}`;
        if(teams.some(teamId=>slotTeams[slot].has(teamId)))return false;
        if(!allowedFieldsForMatch(match,rules).includes(field))return false;
        if(!requiredSlotOk(match,rules.startDate,time,fieldLabel))return false;
        if(!candidateRespectsDebutTime(match,teams,rules.startDate,time))return false;
        if(!hasEnoughRest(match,teamLastEnd,dt,custom.minRestMinutes))return false;
        return !slotFieldBusy.has(dateTimeKey(rules.startDate,time,field));
      }
      function commitOneDay(match,slot,field,dt,scheduledIds=null,pending=null,placements=null){
        const teams=matchTeamIds(match),time=timeLabel(dt),fieldLabel=`Campo ${field}`;
        match.date=rules.startDate;match.time=time;match.datetime=`${match.date}T${match.time}`;match.field=fieldLabel;
        slotFieldBusy.add(dateTimeKey(rules.startDate,time,field));
        teams.forEach(teamId=>slotTeams[slot].add(teamId));
        const endDt=new Date(dt.getTime()+duration*60000);
        teams.forEach(teamId=>teamLastEnd.set(teamId,endDt));
        markInitialDebut(match,teams);
        scheduledIds?.add(match.id);pending?.delete(match);placements?.set(field,match);
        maxSlotUsed=Math.max(maxSlotUsed,slot);
      }
      function pickFixedCandidate(pending,scheduledIds,prerequisites,slot,field,dt,predicate=()=>true){
        const date=rules.startDate,time=timeLabel(dt),fieldLabel=`Campo ${field}`;
        return [...pending].filter(match=>predicate(match)&&isReady(match,scheduledIds,prerequisites)&&oneDayCandidateFits(match,slot,field,dt)).sort((a,b)=>compareCandidates(a,b,date,time,fieldLabel))[0]||null;
      }
      function scheduleFixedGroups(unit){
        const stageMatches=unit.matches;
        let maxSlotInUnit=earliestSlot-1;
        const matchCount=stageMatches.length;
        if(!matchCount)return true;
        const matchIndex=new Map(stageMatches.map((match,index)=>[match.id,index]));
        const fullMask=(1n<<BigInt(matchCount))-1n;
        const teamIds=[...new Set(stageMatches.flatMap(matchTeamIds))].sort();
        const teamIndex=new Map(teamIds.map((teamId,index)=>[teamId,index]));
        const teamBits=teamIds.map((_,index)=>1n<<BigInt(index));
        const matchTeamMasks=stageMatches.map(match=>matchTeamIds(match).reduce((mask,teamId)=>mask|teamBits[teamIndex.get(teamId)],0n));
        const teamMatchMasks=teamIds.map(()=>0n);
        stageMatches.forEach((match,index)=>matchTeamIds(match).forEach(teamId=>{teamMatchMasks[teamIndex.get(teamId)]|=1n<<BigInt(index);}));
        const prerequisites=groupPrerequisites(stageMatches);
        const prerequisiteMasks=stageMatches.map(match=>[...(prerequisites.get(match.id)||[])].reduce((mask,id)=>{
          const index=matchIndex.get(id);return index===undefined?mask:mask|(1n<<BigInt(index));
        },0n));
        const gamesPerTeam=teamIds.map((_,index)=>stageMatches.filter(match=>(matchTeamMasks[matchIndex.get(match.id)]&teamBits[index])!==0n).length);
        const popcount=value=>{let count=0,mask=value;while(mask){mask&=mask-1n;count++;}return count;};
        const compareTuple=(a,b)=>{for(let index=0;index<Math.max(a.length,b.length);index++){const av=a[index]??0,bv=b[index]??0;if(av!==bv)return av-bv;}return 0;};
        const timeMs=dt=>dt.getTime();
        const usableSlots=[];
        for(let rawSlot=earliestSlot;;rawSlot++){
          const dt=new Date(start.getTime()+rawSlot*step*60000);
          if(localDateLabel(dt)!==rules.startDate)break;
          const dayMinutes=dt.getHours()*60+dt.getMinutes();
          if(slotOverlapsPause(dayMinutes,dayMinutes+duration,pause))continue;
          usableSlots.push({rawSlot,dt,time:timeLabel(dt),startMs:timeMs(dt)});
        }
        if(!usableSlots.length)return false;
        const slotIndexByTime=new Map(usableSlots.map((slot,index)=>[slot.time,index]));
        let latestRequiredIndex=-1;
        for(const match of stageMatches){
          if(match.requiredDate&&match.requiredDate!==rules.startDate)return false;
          if(match.requiredTime){
            const index=slotIndexByTime.get(match.requiredTime);
            if(index===undefined)return false;
            latestRequiredIndex=Math.max(latestRequiredIndex,index);
          }
        }
        debutExactTimes.forEach(value=>{const index=slotIndexByTime.get(value);if(index===undefined)latestRequiredIndex=Number.POSITIVE_INFINITY;else latestRequiredIndex=Math.max(latestRequiredIndex,index);});
        if(!Number.isFinite(latestRequiredIndex))return false;
        const minimumHorizon=Math.max(Math.ceil(matchCount/fields),latestRequiredIndex+1);
        const progress=typeof options.onProgress==='function'?options.onProgress:null;
        let totalNodes=0,totalPruned=0,horizonsTested=0;

        function validFieldAssignment(selected,slotInfo){
          const assignments=[];
          const used=new Set();
          const ordered=[...selected].sort((a,b)=>{
            const ar=stageMatches[a].requiredField?0:1,br=stageMatches[b].requiredField?0:1;
            return ar-br||allowedFieldsForMatch(stageMatches[a],rules).length-allowedFieldsForMatch(stageMatches[b],rules).length||a-b;
          });
          let answer=null;
          function walk(position){
            if(answer)return;
            if(position===ordered.length){
              const byMatch=new Map(assignments.map(item=>[item.index,item.field]));
              for(const item of assignments){
                const match=stageMatches[item.index],owner=fixedFields?.[match.groupName];
                if(!owner||item.field===owner||match.requiredField)continue;
                const ownOccupied=assignments.some(other=>other.index!==item.index&&stageMatches[other.index].groupName===match.groupName&&other.field===owner);
                const borrowedOwner=Object.entries(fixedFields||{}).find(([,fieldNo])=>fieldNo===item.field)?.[0]||'';
                const ownerIdle=!borrowedOwner||!assignments.some(other=>other.index!==item.index&&stageMatches[other.index].groupName===borrowedOwner);
                if(!ownOccupied||!ownerIdle)return;
              }
              answer=[...assignments].sort((a,b)=>a.field-b.field||a.index-b.index);
              return;
            }
            const index=ordered[position],match=stageMatches[index];
            for(const field of allowedFieldsForMatch(match,rules)){
              if(used.has(field))continue;
              const fieldLabel=`Campo ${field}`;
              if(!requiredSlotOk(match,rules.startDate,slotInfo.time,fieldLabel))continue;
              used.add(field);assignments.push({index,field});walk(position+1);assignments.pop();used.delete(field);
            }
          }
          walk(0);
          return answer;
        }

        function searchHorizon(horizon){
          horizonsTested++;
          const memo=new Map();
          let best=null,bestObjective=null;
          let horizonNodes=0,horizonPruned=0;
          const lastSlotByTeam=Array(teamIds.length).fill(-1);
          const streakByTeam=Array(teamIds.length).fill(0);
          const placements=[];
          const targetSpan=Math.max(0,horizon-1);

          function prefixDominates(prefix,bound){return compareTuple(prefix,bound)>=0;}
          function report(force=false){
            if(!progress)return;
            if(!force&&horizonNodes%2000!==0)return;
            progress({phase:'optimal-search',horizon,nodes:totalNodes+horizonNodes,pruned:totalPruned+horizonPruned,best:bestObjective?{internalEmptyFields:bestObjective[0],uniqueConsecutiveTeams:bestObjective[1],consecutiveOccurrences:bestObjective[2],threePlusOccurrences:bestObjective[3],restBalancePenalty:bestObjective[4]}:null});
          }
          function teamHasPlayed(mask,teamPos){return (mask&teamMatchMasks[teamPos])!==0n;}
          function slotCandidateOk(index,mask,slotInfo){
            const bit=1n<<BigInt(index),match=stageMatches[index];
            if(mask&bit)return false;
            if((mask&prerequisiteMasks[index])!==prerequisiteMasks[index])return false;
            const teamMask=matchTeamMasks[index];
            for(let teamPos=0;teamPos<teamIds.length;teamPos++){
              if(!(teamMask&teamBits[teamPos]))continue;
              const requiredDebut=debutExactTimes.get(teamIds[teamPos]);
              if(!teamHasPlayed(mask,teamPos)&&requiredDebut&&requiredDebut!==slotInfo.time)return false;
              const previous=lastSlotByTeam[teamPos];
              if(previous>=0){
                const rest=slotInfo.startMs-usableSlots[previous].startMs-duration*60000;
                if(rest<custom.minRestMinutes*60000)return false;
              }
            }
            return true;
          }
          function missedDebut(mask,slotIndex,selectedTeamMask){
            const time=usableSlots[slotIndex].time;
            for(let teamPos=0;teamPos<teamIds.length;teamPos++){
              if(teamHasPlayed(mask,teamPos))continue;
              const required=debutExactTimes.get(teamIds[teamPos]);
              if(required===time&&!(selectedTeamMask&teamBits[teamPos]))return true;
              const requiredIndex=required?slotIndexByTime.get(required):-1;
              if(requiredIndex!==undefined&&requiredIndex>=0&&requiredIndex<slotIndex)return true;
            }
            return false;
          }
          function buildOptions(mask,slotIndex,size,previousTeamMask){
            if(size===0)return [{selected:[],teamMask:0n,assignments:[]}];
            const slotInfo=usableSlots[slotIndex];
            const ready=[];
            for(let index=0;index<matchCount;index++)if(slotCandidateOk(index,mask,slotInfo))ready.push(index);
            const result=[];
            function choose(from,selected,selectedTeams){
              if(selected.length===size){
                const assignments=validFieldAssignment(selected,slotInfo);
                if(assignments){
                  const selectedSet=new Set(selected);
                  const invalidBorrow=assignments.some(item=>{
                    const match=stageMatches[item.index],owner=fixedFields?.[match.groupName];
                    if(!owner||item.field===owner||match.requiredField)return false;
                    const borrowedOwner=Object.entries(fixedFields||{}).find(([,fieldNo])=>fieldNo===item.field)?.[0]||'';
                    return Boolean(borrowedOwner&&ready.some(index=>!selectedSet.has(index)&&stageMatches[index].groupName===borrowedOwner));
                  });
                  if(!invalidBorrow)result.push({selected:[...selected],teamMask:selectedTeams,assignments});
                }
                return;
              }
              if(ready.length-from<size-selected.length)return;
              for(let position=from;position<ready.length;position++){
                const index=ready[position],teams=matchTeamMasks[index];
                if(teams&selectedTeams)continue;
                selected.push(index);choose(position+1,selected,selectedTeams|teams);selected.pop();
              }
            }
            choose(0,[],0n);
            const adjacent=slotIndex>0&&usableSlots[slotIndex].startMs-usableSlots[slotIndex-1].startMs===step*60000;
            result.sort((a,b)=>{
              const ac=adjacent?popcount(a.teamMask&previousTeamMask):0,bc=adjacent?popcount(b.teamMask&previousTeamMask):0;
              const an=a.selected.reduce((sum,index)=>sum+Number(stageMatches[index].roundIndex||0),0),bn=b.selected.reduce((sum,index)=>sum+Number(stageMatches[index].roundIndex||0),0);
              return ac-bc||an-bn||a.selected.join(',').localeCompare(b.selected.join(','));
            });
            return result;
          }

          function remainingTeamFeasible(mask,slotIndex){
            const minimumStartGap=(duration+custom.minRestMinutes)*60000;
            for(let teamPos=0;teamPos<teamIds.length;teamPos++){
              const played=popcount(mask&teamMatchMasks[teamPos]);
              const remainingGames=gamesPerTeam[teamPos]-played;
              if(remainingGames<=0)continue;
              const required=played===0?debutExactTimes.get(teamIds[teamPos]):'';
              const requiredIndex=required?slotIndexByTime.get(required):undefined;
              if(required&&(requiredIndex===undefined||requiredIndex<slotIndex||requiredIndex>=horizon))return false;
              let count=0;
              let previousStart=lastSlotByTeam[teamPos]>=0?usableSlots[lastSlotByTeam[teamPos]].startMs:null;
              for(let index=slotIndex;index<horizon&&count<remainingGames;index++){
                if(required&&count===0&&index!==requiredIndex)continue;
                const startMs=usableSlots[index].startMs;
                if(previousStart!==null&&startMs-previousStart<minimumStartGap)continue;
                previousStart=startMs;count++;
              }
              if(count<remainingGames)return false;
            }
            return true;
          }
          function dfs(slotIndex,mask,previousTeamMask,consecutiveMask,internalEmpty,occurrences,threePlus,restPenalty){
            horizonNodes++;report(false);
            if(slotIndex===horizon){
              if(mask!==fullMask)return;
              const objective=[internalEmpty,popcount(consecutiveMask),occurrences,threePlus,restPenalty];
              if(!bestObjective||compareTuple(objective,bestObjective)<0){bestObjective=objective;best=placements.map(slot=>slot.map(item=>({...item})));report(true);}
              return;
            }
            const remaining=matchCount-popcount(mask),slotsLeft=horizon-slotIndex;
            if(remaining>slotsLeft*fields||remaining===0||!remainingTeamFeasible(mask,slotIndex)){horizonPruned++;return;}
            const futureInternalSlots=Math.max(0,slotsLeft-1);
            const maxFutureInternalMatches=Math.min(Math.max(0,remaining-1),futureInternalSlots*fields);
            const minimumFutureInternalEmpty=futureInternalSlots*fields-maxFutureInternalMatches;
            if(bestObjective){
              const lower=[internalEmpty+minimumFutureInternalEmpty,popcount(consecutiveMask),occurrences,threePlus,restPenalty];
              if(prefixDominates(lower,bestObjective)){horizonPruned++;return;}
            }
            const memoKey=[slotIndex,mask.toString(),previousTeamMask.toString(),consecutiveMask.toString(),lastSlotByTeam.join(','),streakByTeam.join(',')].join('|');
            const memoValue=[internalEmpty,occurrences,threePlus,restPenalty];
            const previous=memo.get(memoKey);
            if(previous&&compareTuple(previous,memoValue)<=0){horizonPruned++;return;}
            memo.set(memoKey,memoValue);

            const minSize=Math.max(0,remaining-(slotsLeft-1)*fields);
            const maxSize=Math.min(fields,remaining);
            for(let size=maxSize;size>=minSize;size--){
              if(slotIndex===horizon-1&&(size!==remaining||size===0))continue;
              const optionsForSlot=buildOptions(mask,slotIndex,size,previousTeamMask);
              for(const option of optionsForSlot){
                if(missedDebut(mask,slotIndex,option.teamMask))continue;
                let addedMask=0n;for(const index of option.selected)addedMask|=1n<<BigInt(index);
                const adjacent=slotIndex>0&&usableSlots[slotIndex].startMs-usableSlots[slotIndex-1].startMs===step*60000;
                const consecutiveNow=adjacent?(option.teamMask&previousTeamMask):0n;
                const changed=[];
                let nextOccurrences=occurrences+popcount(consecutiveNow),nextThreePlus=threePlus,nextRest=restPenalty;
                for(let teamPos=0;teamPos<teamIds.length;teamPos++){
                  const plays=Boolean(option.teamMask&teamBits[teamPos]);
                  changed.push([teamPos,lastSlotByTeam[teamPos],streakByTeam[teamPos]]);
                  if(plays){
                    const previousSlot=lastSlotByTeam[teamPos];
                    if(previousSlot>=0){
                      const gap=Math.round((usableSlots[slotIndex].startMs-usableSlots[previousSlot].startMs)/(step*60000));
                      const divisor=Math.max(1,gamesPerTeam[teamPos]-1);
                      const diff=gap*divisor-targetSpan;
                      nextRest+=diff*diff;
                    }
                    streakByTeam[teamPos]=adjacent&&Boolean(previousTeamMask&teamBits[teamPos])?streakByTeam[teamPos]+1:1;
                    if(streakByTeam[teamPos]>=3)nextThreePlus++;
                    lastSlotByTeam[teamPos]=slotIndex;
                  }else streakByTeam[teamPos]=0;
                }
                placements.push(option.assignments.map(item=>({matchIndex:item.index,field:item.field,slotIndex})));
                dfs(slotIndex+1,mask|addedMask,option.teamMask,consecutiveMask|consecutiveNow,internalEmpty+(slotIndex<horizon-1?fields-size:0),nextOccurrences,nextThreePlus,nextRest);
                placements.pop();
                for(const [teamPos,last,streak] of changed){lastSlotByTeam[teamPos]=last;streakByTeam[teamPos]=streak;}
              }
            }
          }
          dfs(0,0n,0n,0n,0,0,0,0);
          totalNodes+=horizonNodes;totalPruned+=horizonPruned;report(true);
          return best?{placements:best,objective:bestObjective,nodes:horizonNodes,pruned:horizonPruned}:null;
        }

        let solved=null,solvedHorizon=0;
        for(let horizon=minimumHorizon;horizon<=usableSlots.length;horizon++){
          const attempt=searchHorizon(horizon);
          if(attempt){solved=attempt;solvedHorizon=horizon;break;}
        }
        if(!solved)return false;
        for(const slotPlacements of solved.placements){
          for(const placement of slotPlacements){
            const match=stageMatches[placement.matchIndex],slotInfo=usableSlots[placement.slotIndex];
            commitOneDay(match,slotInfo.rawSlot,placement.field,slotInfo.dt);
          }
        }
        maxSlotInUnit=Math.max(maxSlotInUnit,...solved.placements.flat().map(item=>usableSlots[item.slotIndex].rawSlot));
        earliestSlot=maxSlotInUnit+1;
        const objective=solved.objective;
        options._optimality={provenOptimal:true,algorithm:'exact-branch-and-bound',horizonsTested,nodes:totalNodes,pruned:totalPruned,horizonSlots:solvedHorizon,internalEmptyFields:objective[0],uniqueConsecutiveTeams:objective[1],consecutiveOccurrences:objective[2],threePlusOccurrences:objective[3],restBalancePenalty:objective[4]};
        progress?.({phase:'complete',horizon:solvedHorizon,nodes:totalNodes,pruned:totalPruned,best:{internalEmptyFields:objective[0],uniqueConsecutiveTeams:objective[1],consecutiveOccurrences:objective[2],threePlusOccurrences:objective[3],restBalancePenalty:objective[4]},provenOptimal:true});
        return true;
      }

      for(const unit of units){
        if(unit.kind==='fixedGroups'){
          if(!scheduleFixedGroups(unit))return {ok:false,message:debutBlockIssue?.message||'Calendario impossibile: non riesco a collocare tutte le partite dei gironi senza sovrapposizioni o violazioni dell ordine delle partite.',issues:debutBlockIssue?[debutBlockIssue]:undefined};
          continue;
        }
        let maxSlotUsedInRound=earliestSlot-1;
        for(const match of unit.matches){
          const teams=matchTeamIds(match);
          let placed=false;
          for(let slot=earliestSlot;slot<estimatedSlots&&!placed;slot++){
            const dt=new Date(start.getTime()+slot*step*60000);
            if(localDateLabel(dt)!==rules.startDate)break;
            const dayMinutes=dt.getHours()*60+dt.getMinutes();
            if(slotOverlapsPause(dayMinutes,dayMinutes+duration,pause)||teams.some(teamId=>slotTeams[slot].has(teamId)))continue;
            for(const field of allowedFieldsForMatch(match,rules)){
              if(!oneDayCandidateFits(match,slot,field,dt))continue;
              commitOneDay(match,slot,field,dt);
              maxSlotUsedInRound=Math.max(maxSlotUsedInRound,slot);
              placed=true;break;
            }
          }
          if(!placed)return {ok:false,message:debutBlockIssue?.message||'Calendario impossibile: non riesco a collocare tutte le partite senza sovrapposizioni di campo/squadra. Aumenta campi o riduci durata/pausa.',issues:debutBlockIssue?[debutBlockIssue]:undefined};
        }
        earliestSlot=maxSlotUsedInRound+1;
      }
      const end=new Date(start.getTime()+Math.max(0,maxSlotUsed)*step*60000+duration*60000);
      const pauseText=pause?` Pausa programmata alle ${pause.startTime} per ${pause.duration} min inserita nel calendario.`:'';
      return {ok:true,calculatedEndTime:end.toTimeString().slice(0,5),optimality:options._optimality||null,message:`Calendario generato: ${matches.length} partite in un giorno su ${fields} campi. Fine stimata: ${end.toTimeString().slice(0,5)}.${pauseText} Nessuna squadra gioca in contemporanea e nessun campo è sovrapposto.${groupFieldPolicyMessage(rules)}`};
    }

    if(!rules.startDate||!rules.endDate)return {ok:false,message:'Per tornei su più giorni indica data inizio e data fine.'};
    if(daysBetween(rules.startDate,rules.endDate)<1)return {ok:false,message:'La data fine deve essere uguale o successiva alla data inizio.'};
    const allowedDates=allowedDateList(rules.startDate,rules.endDate,rules.playingDays);
    if(!allowedDates.length)return {ok:false,message:'Nel periodo indicato non esistono date che rispettano i giorni della settimana selezionati.'};
    const dayTeams=Array.from({length:allowedDates.length},()=>new Set());
    const dayFieldBusy=Array.from({length:allowedDates.length},()=>new Set());
    let earliestDay=0;

    function multiDayCandidateFits(match,day,field){
      const teams=matchTeamIds(match),fieldLabel=`Campo ${field}`;
      if(teams.some(teamId=>dayTeams[day].has(teamId)))return false;
      if(!allowedFieldsForMatch(match,rules).includes(field))return false;
      if(!requiredSlotOk(match,allowedDates[day],'',fieldLabel))return false;
      if(!candidateRespectsDebutTime(match,teams,allowedDates[day],''))return false;
      return !dayFieldBusy[day].has(field);
    }
    function commitMultiDay(match,day,field,scheduledIds=null,pending=null,placements=null){
      const teams=matchTeamIds(match),fieldLabel=`Campo ${field}`;
      match.date=allowedDates[day];match.time='';match.datetime='';match.field=fieldLabel;
      dayFieldBusy[day].add(field);teams.forEach(teamId=>dayTeams[day].add(teamId));markInitialDebut(match,teams);
      scheduledIds?.add(match.id);pending?.delete(match);placements?.set(field,match);
    }
    function scheduleFixedGroupsMultiDay(unit){
      const pending=new Set(unit.matches),scheduledIds=new Set(),prerequisites=groupPrerequisites(unit.matches);
      let maxDayInUnit=earliestDay-1;
      for(let day=earliestDay;day<allowedDates.length&&pending.size;day++){
        const placements=new Map(),fieldNumbers=Array.from({length:fields},(_,index)=>index+1);
        const pick=(field,predicate)=>[...pending].filter(match=>predicate(match)&&isReady(match,scheduledIds,prerequisites)&&multiDayCandidateFits(match,day,field)).sort((a,b)=>compareCandidates(a,b,allowedDates[day],'',`Campo ${field}`))[0]||null;
        fieldNumbers.forEach(field=>{const match=pick(field,candidate=>candidate.requiredField===`Campo ${field}`);if(match)commitMultiDay(match,day,field,scheduledIds,pending,placements);});
        fieldNumbers.forEach(field=>{if(placements.has(field))return;const owner=Object.entries(fixedFields).find(([,fieldNo])=>fieldNo===field)?.[0]||'';const match=owner?pick(field,candidate=>candidate.groupName===owner):null;if(match)commitMultiDay(match,day,field,scheduledIds,pending,placements);});
        fieldNumbers.forEach(field=>{
          if(placements.has(field))return;
          const owner=Object.entries(fixedFields).find(([,fieldNo])=>fieldNo===field)?.[0]||'';
          for(const [group,ownField] of Object.entries(fixedFields).sort((a,b)=>a[1]-b[1])){
            if(group===owner)continue;
            const ownPlacement=placements.get(ownField);
            if(!ownPlacement||ownPlacement.groupName!==group)continue;
            const match=pick(field,candidate=>candidate.groupName===group&&!candidate.requiredField);
            if(!match)continue;
            commitMultiDay(match,day,field,scheduledIds,pending,placements);break;
          }
        });
        if(placements.size)maxDayInUnit=Math.max(maxDayInUnit,day);
      }
      if(pending.size)return false;
      earliestDay=maxDayInUnit+1;
      return true;
    }

    for(const unit of units){
      if(unit.kind==='fixedGroups'){
        if(!scheduleFixedGroupsMultiDay(unit)){
          const estimate=suggestEndDateForMatches(matches,rules),extra=estimate.ok?` Data fine consigliata: ${estimate.suggestedEndDate}.`:'';
          return {ok:false,message:`Calendario impossibile: non ci sono abbastanza date per completare i gironi senza sovrapposizioni.${extra}`};
        }
        continue;
      }
      let maxDayUsed=earliestDay-1;
      for(const match of unit.matches){
        const teams=matchTeamIds(match);
        let placed=false;
        for(let day=earliestDay;day<allowedDates.length&&!placed;day++){
          if(teams.some(teamId=>dayTeams[day].has(teamId)))continue;
          for(const field of allowedFieldsForMatch(match,rules)){
            if(!multiDayCandidateFits(match,day,field))continue;
            commitMultiDay(match,day,field);maxDayUsed=Math.max(maxDayUsed,day);placed=true;break;
          }
        }
        if(!placed){
          const estimate=suggestEndDateForMatches(matches,rules),extra=estimate.ok?` Data fine consigliata: ${estimate.suggestedEndDate}.`:'';
          return {ok:false,message:debutBlockIssue?.message||`Calendario impossibile tra ${rules.startDate} e ${rules.endDate} nei giorni selezionati (${weekdayLabels(rules.playingDays)}): non ci sono abbastanza giorni/campi per evitare sovrapposizioni e doppie partite della stessa squadra nello stesso giorno.${extra}`,issues:debutBlockIssue?[debutBlockIssue]:undefined};
        }
      }
      earliestDay=maxDayUsed+1;
      if(earliestDay>allowedDates.length&&unit!==units[units.length-1])return {ok:false,message:'Calendario impossibile: non restano date di gioco disponibili per completare tutte le fasi nel periodo indicato.'};
    }
    const usedDays=[...new Set(matches.map(match=>match.date).filter(Boolean))].length;
    return {ok:true,message:`Calendario generato su ${usedDays} date di gioco tra ${rules.startDate} e ${rules.endDate} (${weekdayLabels(rules.playingDays)}). Nessuna squadra gioca due volte nello stesso giorno e nessun campo è sovrapposto.${groupFieldPolicyMessage(rules)}`};
  }

  function validateCompetitionConfig(r, teamCount=null){
    r=normalizeRules(r);
    if(r.format!=='league_knockout')return {ok:true,message:'Configurazione competizioni non richiesta per questo formato.'};
    const comps=sortedCompetitions(r);
    if(!comps.length)return {ok:false,message:'Deve esistere almeno una competizione: di default Playoff Oro.'};
    let expectedStart=1;
    for(const c of comps){
      if(c.startRank!==expectedStart)return {ok:false,message:`${c.name}: posizione non valida. Le fasce devono essere consecutive e partire dalla 1ª posizione. Posizione attesa: ${expectedStart}ª.`};
      if(!isPowerOfTwo(c.teams))return {ok:false,message:`${c.name}: il numero squadre deve essere 2, 4, 8, 16, ecc.`};
      const end=c.startRank+c.teams-1;
      if(teamCount!==null&&end>teamCount)return {ok:false,message:`${c.name}: richiede le classificate dalla ${c.startRank}ª alla ${end}ª, ma ci sono solo ${teamCount} squadre.`};
      expectedStart=end+1;
    }
    if(r.superCup?.enabled){
      if(comps.length<2)return {ok:false,message:'La Supercoppa si può abilitare solo se esistono almeno due competizioni a eliminazione diretta.'};
      const ids=comps.map(c=>c.id);
      if(!r.superCup.homeCompetitionId||!r.superCup.awayCompetitionId||r.superCup.homeCompetitionId===r.superCup.awayCompetitionId)return {ok:false,message:'Per la Supercoppa scegli due competizioni diverse.'};
      if(!ids.includes(r.superCup.homeCompetitionId)||!ids.includes(r.superCup.awayCompetitionId))return {ok:false,message:'Le competizioni scelte per la Supercoppa non esistono.'};
    }
    return {ok:true,message:'Competizioni a eliminazione diretta valide.'};
  }

  function validateGeneration(state){const r=normalizeRules(state.rules);const teams=state.teams.length;const min=minimumTeams(r);if(teams<min)return {ok:false,message:`Servono almeno ${min} squadre per ${FORMAT_LABELS[r.format]}. Inserite: ${teams}.`};if(Number(r.fieldCount||0)<1)return {ok:false,message:'Inserisci almeno 1 campo disponibile.'};if(!r.oneDay&&(!Array.isArray(r.playingDays)||!r.playingDays.length))return {ok:false,message:'Seleziona almeno un giorno della settimana in cui si può giocare.'};if(r.format==='league')return {ok:true,message:'Formato valido: campionato unico senza fasi successive.'};if(r.format==='knockout')return {ok:true,message:'Formato valido: solo tabellone a eliminazione diretta.'};if(r.format==='groups_knockout'){const cfgs=r.groupConfigs||[];if(cfgs.length<2)return {ok:false,message:'Per gironi + eliminazione diretta servono almeno 2 gironi.'};if(r.groupFieldPolicy==='fixed_by_group'&&cfgs.length!==r.fieldCount)return {ok:false,message:`La modalità girone → campo richiede che il numero di gironi (${cfgs.length}) sia uguale al numero di campi (${r.fieldCount}).`};const totalSizes=cfgs.reduce((sum,g)=>sum+g.size,0);if(totalSizes!==teams)return {ok:false,message:`La somma delle squadre nei gironi deve essere uguale alle squadre iscritte. Configurate: ${totalSizes}, iscritte: ${teams}.`};for(const g of cfgs){if(g.size<2)return {ok:false,message:`${g.name}: servono almeno 2 squadre.`};if(g.qualifiers<1)return {ok:false,message:`${g.name}: almeno 1 squadra deve qualificarsi alla fase finale.`};if(g.qualifiers>g.size)return {ok:false,message:`${g.name}: non puoi qualificare ${g.qualifiers} squadre su ${g.size}.`};}const totalQ=cfgs.reduce((sum,g)=>sum+g.qualifiers,0);if(totalQ>teams)return {ok:false,message:'Le qualificate alla fase finale non possono superare le squadre iscritte.'};if(totalQ<2)return {ok:false,message:'Servono almeno 2 qualificate complessive per generare la fase finale.'};const bracketSize=nextPow2(totalQ);const koStart=bracketRoundName(1,Math.log2(bracketSize));const byeText=bracketSize>totalQ?` con ${bracketSize-totalQ} bye assegnati alle migliori qualificate`:'';return {ok:true,message:`Formato valido: gironi personalizzati + fase finale da ${totalQ} squadre${byeText}, con partenza da ${koStart.toLowerCase()} e teste di serie distribuite nel tabellone.`};}if(r.format==='league_knockout'){const cfg=validateCompetitionConfig(r,teams);if(!cfg.ok)return cfg;return {ok:true,message:'Formato valido: campionato unico + competizioni a eliminazione diretta configurabili.'};}return {ok:false,message:'Formato torneo non riconosciuto.'};}
  function isManualCalendarFormat(r){r=normalizeRules(r);return r.format==='groups_knockout'||r.format==='league_knockout';}
  function calendarPrerequisites(state){
    state=normalizeState({...state,matches:Array.isArray(state.matches)?state.matches:[]});
    const r=state.rules;
    const items=[];
    const add=(ok,label,message)=>items.push({ok,label,message});
    add(isManualCalendarFormat(r),'Formato supportato','Usa Gironi + eliminazione diretta oppure Classifica unica + eliminazione diretta.');
    const base=validateGeneration(state);
    add(base.ok,'Regole torneo valide',base.message);
    add(state.teams.length>=minimumTeams(r),'Squadre sufficienti',`Squadre presenti: ${state.teams.length}. Minimo richiesto: ${minimumTeams(r)}.`);
    add(Number(r.fieldCount)>0,'Campi configurati','Configura almeno un campo.');
    add(Boolean(r.startDate),'Data inizio configurata','Inserisci la data di inizio o la data del torneo.');
    add(r.oneDay?Boolean(r.startTime):Boolean(r.endDate),'Orari/date completi',r.oneDay?'Inserisci l ora di inizio.':'Inserisci anche la data fine.');
    add(Number(r.matchDuration)>=5,'Durata partita configurata','La durata deve essere almeno 5 minuti.');
    if(r.format==='groups_knockout'){
      const groups=plannedGroups(state);
      const complete=groups.length&&groups.every(g=>g.teams.length===g.size&&g.size>=2);
      add(complete,'Gironi completi','Assegna tutte le squadre ai gironi prima di generare.');
    }
    add(!(state.matches||[]).length,'Calendario non ancora generato','Se esiste gia un calendario, la conferma lo sostituira solo dopo consenso esplicito.');
    return {ok:items.filter(i=>!i.ok&&i.label!=='Calendario non ancora generato').length===0,items,message:items.filter(i=>!i.ok).map(i=>i.message).join(' ')||'Prerequisiti soddisfatti.'};
  }
  function validateManualLocks(state,issues){
    const r=normalizeRules(state.rules), custom=r.calendarCustomization, teamIds=new Set((state.teams||[]).map(t=>t.id));
    const byScope=new Map();
    const groupMap=new Map();
    if(r.format==='groups_knockout')plannedGroups(state).forEach(g=>g.teams.forEach(t=>groupMap.set(t.id,g.name)));
    custom.firstRoundLocks.forEach(lock=>{
      const severity=lock.mode==='hard'?'error':'warn';
      const meta={severity,rule:'Prima giornata',sourceType:'firstRoundLock',sourceId:lock.id,step:1,modifiable:true};
      if(!lock.homeTeamId||!lock.awayTeamId){issues.push({...meta,message:'Una partita fissata deve avere entrambe le squadre.',suggestion:'Completa entrambe le squadre oppure rimuovi questa regola dalla prima giornata.'});return;}
      if(lock.homeTeamId===lock.awayTeamId)issues.push({...meta,message:'Una squadra non puo giocare contro se stessa.',suggestion:'Scegli due squadre diverse per la partita fissata.'});
      if(!teamIds.has(lock.homeTeamId)||!teamIds.has(lock.awayTeamId))issues.push({...meta,message:'Una partita fissata usa una squadra non presente nel torneo.',suggestion:'Sostituisci la squadra rimossa o elimina la regola.'});
      if(r.format==='groups_knockout'){
        if(!lock.groupName)issues.push({...meta,message:'Indica il girone per ogni partita fissata.',suggestion:'Seleziona il girone corretto per questa partita.'});
        if(groupMap.get(lock.homeTeamId)!==lock.groupName||groupMap.get(lock.awayTeamId)!==lock.groupName)issues.push({...meta,message:`La partita fissata per ${lock.groupName||'un girone'} contiene una squadra di un altro girone.`,suggestion:'Sposta la partita nel girone corretto o scegli squadre appartenenti allo stesso girone.'});
      }
      const scope=lock.groupName||'league';
      if(!byScope.has(scope))byScope.set(scope,new Set());
      const seen=byScope.get(scope);
      [lock.homeTeamId,lock.awayTeamId].forEach(id=>{if(seen.has(id))issues.push({...meta,message:'La stessa squadra e stata fissata due volte nella stessa prima giornata.',suggestion:'Rimuovi una delle partite fissate o trasformala in preferenza.'});seen.add(id);});
    });
  }
  function validateDebutRules(state,matches,issues){
    const r=normalizeRules(state.rules);
    const custom=r.calendarCustomization;
    const teamIds=new Set((state.teams||[]).map(team=>team.id));
    const seen=new Set();
    custom.teamDebuts.forEach(rule=>{
      const meta={severity:'error',rule:'Orario esatto esordio',sourceType:'teamDebut',sourceId:rule.id,step:2,modifiable:true};
      if(!teamIds.has(rule.teamId)){issues.push({...meta,message:'La regola di esordio usa una squadra non presente nel torneo.',suggestion:'Sostituisci la squadra rimossa o elimina la regola.'});return;}
      if(seen.has(rule.teamId))issues.push({...meta,message:`${teamName(state,rule.teamId,'Squadra')}: regola duplicata per l orario di esordio.`,suggestion:'Mantieni un solo orario di esordio per squadra.'});
      seen.add(rule.teamId);
      const first=firstTeamInitialMatch(matches,rule.teamId);
      if(!first){issues.push({...meta,message:`${teamName(state,rule.teamId,'Squadra')}: nessuna partita trovata nella fase iniziale per verificare l esordio.`,suggestion:'Controlla che la squadra sia assegnata al torneo o rimuovi la regola di esordio.'});return;}
      const requested=timeToMinutes(rule.value),actual=timeToMinutes(first.time);
      if(requested===null){issues.push({...meta,message:`${teamName(state,rule.teamId,'Squadra')}: orario di esordio non valido.`,suggestion:'Scegli uno degli orari disponibili.'});return;}
      if(!r.oneDay){issues.push({...meta,message:`${teamName(state,rule.teamId,'Squadra')}: il vincolo di orario richiede una generazione con orari nel giorno di gioco.`,suggestion:'Usa la modalita torneo in un giorno oppure rimuovi il vincolo di orario.'});return;}
      if(actual===null||actual!==requested)issues.push({...meta,message:`${teamName(state,rule.teamId,'Squadra')} deve disputare la prima partita alle ${rule.value}. Esordio ottenuto: ${first.time||'senza orario'} (${first.round||'-'}).`,suggestion:'Scegli un altro orario disponibile o correggi i vincoli incompatibili.'});
    });
  }
  function debutConstraintChecks(state,matches){
    const custom=normalizeRules(state.rules).calendarCustomization;
    return custom.teamDebuts.map(rule=>{
      const first=firstTeamInitialMatch(matches,rule.teamId);
      const name=teamName(state,rule.teamId,'Squadra');
      const requested=timeToMinutes(rule.value),actual=timeToMinutes(first?.time);
      const ok=Boolean(first&&requested!==null&&actual!==null&&actual===requested);
      return {team:name,rule:'Orario esatto',requested:rule.value||'-',obtained:first?.time||'senza orario',status:ok?'Applicata nell anteprima':'In conflitto',ok,message:ok?`${name} esordisce alle ${first.time}.`:`${name} non rispetta l orario richiesto ${rule.value||'-'}.`};
    });
  }
  function conflictStep(issue){
    if(Number.isInteger(issue?.step))return issue.step;
    if(issue?.rule==='Prima giornata')return 1;
    if(issue?.rule==='Orario esatto esordio')return 2;
    return 1;
  }
  function suggestionForIssue(issue){
    const rule=String(issue?.rule||'');
    const msg=String(issue?.message||'');
    if(issue?.suggestion)return issue.suggestion;
    if(rule==='Prima giornata')return 'Rimuovi o correggi l accoppiamento fissato e riesegui la validazione.';
    if(rule==='Orario esatto esordio')return 'Scegli un altro orario disponibile oppure rimuovi il vincolo incompatibile.';
    if(/riposo|minuti/i.test(msg))return 'Riduci il riposo minimo obbligatorio o aggiungi slot disponibili tra una partita e la successiva.';
    if(/date|giorni|periodo/i.test(msg))return 'Aggiungi altre date di gioco o amplia il periodo del torneo.';
    if(/campo|campi/i.test(msg))return 'Aumenta i campi disponibili o libera uno slot campo bloccato.';
    if(/orario|slot|pausa/i.test(msg))return 'Aggiungi uno slot orario, riduci durata/pausa o correggi un vincolo obbligatorio.';
    return 'Modifica i vincoli evidenziati e riesegui l analisi di fattibilita.';
  }
  function normalizeConflict(issue){
    const out={severity:issue?.severity||'error',rule:issue?.rule||'Pianificazione',message:issue?.message||'Vincolo non rispettato.',sourceType:issue?.sourceType||'',sourceId:issue?.sourceId||'',step:conflictStep(issue),nonRelaxable:Boolean(issue?.nonRelaxable),suggestion:suggestionForIssue(issue)};
    out.actions=out.nonRelaxable?[]:((out.sourceType==='firstRoundLock'||out.sourceType==='teamDebut')?['remove']:[]);
    return out;
  }
  function infeasibleResult(message,issues=[],extra={}){
    const conflicts=(issues.length?issues:[{severity:'error',rule:'Pianificazione',message}]).map(normalizeConflict);
    const status=extra.status||'INFEASIBLE';
    return {ok:false,status,code:status,message:message||'Il calendario non puo essere generato con i vincoli correnti.',technical:false,conflicts,issues:conflicts,...extra};
  }
  function technicalCalendarError(err){
    const detail=String(err?.message||err||'Errore sconosciuto');
    return {ok:false,status:'TECHNICAL_ERROR',code:'TECHNICAL_ERROR',technical:true,message:'Errore tecnico durante la generazione del calendario. La configurazione e stata conservata: riprova o controlla i dettagli nei log.',detail,conflicts:[],issues:[]};
  }
  function timeoutCalendarResult(elapsed,maxMs){
    const conflict=normalizeConflict({rule:'Timeout',message:'Tempo massimo di generazione raggiunto.',suggestion:'Riprova senza un limite temporale: la garanzia dell ottimo globale richiede il completamento della ricerca.'});
    return {ok:false,status:'TIMEOUT',code:'TIMEOUT',technical:false,message:'La ricerca esatta e stata interrotta prima della prova di ottimalita. Nessun calendario parziale e stato salvato.',elapsedMs:elapsed,maxMs,conflicts:[conflict],issues:[conflict]};
  }
  function calendarRuleReport(state,matches,validation){
    const warnings=(validation?.warnings||[]).map(normalizeConflict);
    const stats=calendarConsecutiveStats(matches||state.matches||[],state.rules,state);
    return {
      respectedHardConstraints:['Vincoli sportivi e formato','Numero corretto degli incontri','Assenza di partite duplicate','Assenza di sovrapposizioni squadra/campo','Durata e intervalli obbligatori','Prima giornata','Orari esatti di esordio','Minimo globale delle partite consecutive'],
      debutChecks:debutConstraintChecks(state,matches||state.matches||[]),
      consecutiveStats:stats,
      warnings
    };
  }
  function validateCalendarCustomization(state,matches){
    const issues=[];
    const prereq=calendarPrerequisites({...state,matches:[]});
    prereq.items.filter(i=>!i.ok&&i.label!=='Calendario non ancora generato').forEach(i=>issues.push({severity:'error',rule:i.label,message:i.message}));
    validateManualLocks(state,issues);
    validateDebutRules(state,matches||state.matches||[],issues);
    const errors=issues.filter(i=>i.severity==='error');
    const warnings=issues.filter(i=>i.severity!=='error');
    return {ok:errors.length===0,status:errors.length?'INFEASIBLE':(warnings.length?'FEASIBLE_WITH_WARNINGS':'FEASIBLE'),issues:issues.map(normalizeConflict),errors:errors.map(normalizeConflict),warnings:warnings.map(normalizeConflict),message:errors.length?`${errors.length} vincolo/i rigido/i non rispettati.`:(warnings.length?`Fattibile con ${warnings.length} avviso/i.`:'Fattibile: tutti i vincoli rigidi risultano rispettati.')};
  }
  function scheduleSignature(state){
    const r=normalizeRules(state.rules);
    const rulesForSchedule={format:r.format,groupConfigs:r.groupConfigs,groupAssignments:r.groupAssignments,playoffTeams:r.playoffTeams,eliminationCompetitions:r.eliminationCompetitions,superCup:r.superCup,isKingsLeague:r.isKingsLeague,oneDay:r.oneDay,fieldCount:r.fieldCount,startDate:r.startDate,endDate:r.endDate,startTime:r.startTime,matchDuration:r.matchDuration,breakMinutes:r.breakMinutes,oneDayPauseEnabled:r.oneDayPauseEnabled,oneDayPauseStart:r.oneDayPauseStart,oneDayPauseDuration:r.oneDayPauseDuration,playingDays:r.playingDays,groupFieldPolicy:r.groupFieldPolicy,calendarCustomization:r.calendarCustomization,bracketSeedVersion:'group-cross-seeding-v117'};
    const teams=(state.teams||[]).map(t=>({id:t.id}));
    return JSON.stringify({rules:rulesForSchedule,teams});
  }
  function matchPreserveKey(m){
    const h=m.homeTeamId||m.sourceHome||m.homeLabel||'';
    const a=m.awayTeamId||m.sourceAway||m.awayLabel||'';
    return [m.phase||'',m.groupName||'',m.bracketName||'',m.bracketRoundIndex||0,m.bracketMatchIndex||0,m.round||'',h,a].join('|');
  }
  function matchLooseKey(m){
    const pair=[m.homeTeamId||m.sourceHome||m.homeLabel||'',m.awayTeamId||m.sourceAway||m.awayLabel||''].sort().join('~');
    return [m.phase||'',m.groupName||'',m.bracketName||'',m.round||'',pair].join('|');
  }
  function preserveMatchData(newMatches,oldMatches){
    const exact=new Map(), loose=new Map();
    (oldMatches||[]).forEach(m=>{exact.set(matchPreserveKey(m),m);loose.set(matchLooseKey(m),m);});
    let kept=0;
    newMatches.forEach(m=>{
      const old=exact.get(matchPreserveKey(m))||loose.get(matchLooseKey(m));
      if(!old)return;
      m.referee=old.referee||m.referee||'';
      m.status=(old.status==='played'?'played':(old.status==='live'?'live':((old.goals&&old.goals.length)?'played':'scheduled')));
      m.goals=Array.isArray(old.goals)?old.goals.map(g=>({...g})):[];
      m.cards=Array.isArray(old.cards)?old.cards.map(c=>({...c})):[];
      const oldP=normalizePenalties(old.penalties);
      if(oldP)m.penalties=oldP;
      kept++;
    });
    return kept;
  }
  function isCalendarFresh(state){return Boolean(state.matches&&state.matches.length&&state.calendarSignature&&state.calendarSignature===scheduleSignature(state));}
  function calendarLayoutFingerprint(matches){return (matches||[]).map(m=>[m.phase,m.groupName,m.bracketName,m.roundIndex,m.round,m.homeTeamId||m.homeLabel||m.sourceHome,m.awayTeamId||m.awayLabel||m.sourceAway,m.date,m.time,m.field].join('~')).join('|');}
  function newCalendarVariant(){return `variant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;}
  function generateCalendar(state,options={}){
    try{
      const started=Date.now();
      state.rules=normalizeRules(state.rules);
      const v=validateGeneration(state);
      if(!v.ok){state.calendarSignature='';return infeasibleResult(v.message,[{severity:'error',rule:'Prerequisiti',message:v.message,step:0,nonRelaxable:true}],{status:'NO_SOLUTION'});}
      const oldMatches=Array.isArray(state.matches)?state.matches:[];
      const matches=buildMatches(state);
      const definitions=validateCalendarConstraintDefinitions({...state,matches},matches);
      if(!definitions.ok){state.calendarSignature='';return infeasibleResult(definitions.message,definitions.errors,{validation:definitions});}
      const s=scheduleMatches(matches,state.rules,options);
      if(options.maxMs&&Date.now()-started>Number(options.maxMs)){state.calendarSignature='';return timeoutCalendarResult(Date.now()-started,Number(options.maxMs));}
      if(!s.ok){state.calendarSignature='';return infeasibleResult(s.message,s.issues||[{severity:'error',rule:'Pianificazione',message:s.message,step:1}],{scheduler:s});}
      const custom=validateCalendarCustomization({...state,matches},matches);
      if(!custom.ok){state.calendarSignature='';return infeasibleResult(custom.message,custom.errors,{validation:custom});}
      const kept=options.preserveResults!==false?preserveMatchData(matches,oldMatches):0;
      state.matches=matches;
      autoResolveKnockout(state);
      state.calendarSignature=scheduleSignature(state);
      const status=custom.warnings.length?'FEASIBLE_WITH_WARNINGS':'FEASIBLE';
      const consecutiveStats=calendarConsecutiveStats(matches,state.rules,state);
      const resultMessage=consecutiveResultMessage(consecutiveStats)+(kept?` Risultati/referti preservati su ${kept} partite rimaste compatibili.`:'');
      return {...s,ok:true,status,code:status,validation:custom,ruleReport:calendarRuleReport(state,matches,custom),preservedMatches:kept,layoutFingerprint:calendarLayoutFingerprint(matches),consecutiveStats,optimality:s.optimality||options._optimality||null,message:resultMessage};
    }catch(err){
      if(state)state.calendarSignature='';
      return technicalCalendarError(err);
    }
  }
  function ensureFreshCalendar(state){if(isCalendarFresh(state))return {ok:true,message:'Calendario già aggiornato.',changed:false};const before=(state.matches||[]).length;const res=generateCalendar(state,{preserveResults:true});return {...res,changed:res.ok,previousMatches:before};}
  function previewCalendar(state,options={}){
    const started=Date.now();
    const draft=normalizeState(JSON.parse(JSON.stringify(state||emptyState())));
    const before=Array.isArray(state?.matches)?state.matches.length:0;
    draft.matches=[];
    draft.calendarSignature='';
    const res=options.forceTimeout?timeoutCalendarResult(Number(options.maxMs)||0,Number(options.maxMs)||0):generateCalendar(draft,{...options,preserveResults:false,maxMs:options.maxMs});
    if(options.maxMs&&Date.now()-started>Number(options.maxMs)&&res.ok)return {...timeoutCalendarResult(Date.now()-started,Number(options.maxMs)),draft,previewMatches:[],originalMatches:before,notPersisted:true};
    return {...res,draft,previewMatches:draft.matches||[],originalMatches:before,notPersisted:true,message:res.ok?`Anteprima generata: ${draft.matches.length} partite. Nessun record e stato salvato. ${res.message}`:res.message};
  }

  function playerBelongsToMatch(state,m,playerId){const tid=playerTeamId(state,playerId);return Boolean(tid&&(tid===m.homeTeamId||tid===m.awayTeamId));}
  function matchLabel(m){return `${m.round||'Partita'} · ${m.homeLabel||m.homeTeamId||'Casa'} vs ${m.awayLabel||m.awayTeamId||'Ospite'}`;}
  function normalizeEventIds(list,prefix){const seen=new Set();return (list||[]).map(e=>({...e,id:e.id||uid(prefix)})).filter(e=>{if(seen.has(e.id))return false;seen.add(e.id);return true;});}
  function fieldNoFromLabel(field){const m=String(field||'').match(/(\d+)/);return m?Number(m[1]):0;}
  function scheduleSlotKey(m,rules,withTeam=false){
    const date=m.date||'NO_DATE';
    const time=rules.oneDay?(m.time||'NO_TIME'):'ALL_DAY';
    const field=m.field||'NO_FIELD';
    return withTeam?`${date}|${time}`:`${date}|${time}|${field}`;
  }
  function derivedSnapshot(state){
    autoResolveKnockout(state);
    return {
      standings:officialStandings(state).map(r=>({teamId:r.teamId,points:r.points,played:r.played,gf:r.goalsFor,ga:r.goalsAgainst,diff:r.diff})),
      groups:groupedStandings(state).map(g=>({name:g.name,completed:g.completed,rows:g.rows.map(r=>({teamId:r.teamId,points:r.points,played:r.played,gf:r.goalsFor,ga:r.goalsAgainst,diff:r.diff}))})),
      scorers:scorers(state).map(p=>({playerId:p.playerId,teamId:p.teamId,goals:p.goals,yellow:p.yellow,red:p.red,played:p.played})),
      presidentScorers:presidentScorers(state).map(p=>({presidentId:p.presidentId,teamId:p.teamId,goals:p.goals})),
      stats:stats(state),
      bracket:bracketData(state)
    };
  }
  function alignState(state,options={}){
    state=state||emptyState();
    state.rules=normalizeRules(state.rules);
    const teamIds=new Set((state.teams||[]).map(t=>t.id));
    const playerIds=new Set();
    const goalParticipantIds=new Set();
    const presidentIds=new Set();
    let removedEvents=0, fixedMatches=0, fixedAssignments=0, fixedStatuses=0, fixedEvents=0;
    (state.teams||[]).forEach(t=>{
      t.players=Array.isArray(t.players)?t.players:[];
      t.president=(t.president&&typeof t.president==='object')?t.president:{name:t.presidentName||''};
      t.president.id=t.president.id||uid('president');
      t.president.name=String(t.president.name||'').trim();
      t.coach=(t.coach&&typeof t.coach==='object')?t.coach:{name:t.coachName||''};
      t.coach.name=String(t.coach.name||'').trim();
      t.players.forEach(p=>{playerIds.add(p.id);goalParticipantIds.add(p.id);});
      if(t.president.name){presidentIds.add(t.president.id);if(state.rules.isKingsLeague)goalParticipantIds.add(t.president.id);}
    });
    const nextAssignments={};
    Object.entries(state.rules.groupAssignments||{}).forEach(([teamId,groupName])=>{
      const exists=teamIds.has(teamId);
      const groupExists=(state.rules.groupConfigs||[]).some(g=>g.name===groupName);
      if(exists&&groupExists)nextAssignments[teamId]=groupName; else fixedAssignments++;
    });
    state.rules.groupAssignments=nextAssignments;
    (state.matches||[]).forEach(m=>{
      m.goals=normalizeEventIds(m.goals,'goal');
      m.cards=normalizeEventIds(m.cards,'card');
      if(m.homeTeamId&&!teamIds.has(m.homeTeamId)){m.homeTeamId='';fixedMatches++;}
      if(m.awayTeamId&&!teamIds.has(m.awayTeamId)){m.awayTeamId='';fixedMatches++;}
      const beforeG=m.goals.length;
      const beforeC=m.cards.length;
      m.goals=m.goals.map(g=>normalizeGoalEvent(g,m)).filter(g=>{
        if(isOwnGoalEvent(g))return Boolean(g.teamId&&(g.teamId===m.homeTeamId||g.teamId===m.awayTeamId));
        return Boolean(g.playerId&&goalParticipantIds.has(g.playerId)&&playerBelongsToMatch(state,m,g.playerId));
      }).map(g=>isOwnGoalEvent(g)?{...g,weight:1}:((presidentIds.has(g.playerId)||!state.rules.isKingsLeague)?{...g,weight:1}:g));
      m.cards=m.cards.filter(c=>c.playerId&&playerIds.has(c.playerId)&&!presidentIds.has(c.playerId)&&playerBelongsToMatch(state,m,c.playerId)&&(c.type==='yellow'||c.type==='red'));
      removedEvents+=beforeG-m.goals.length+beforeC-m.cards.length;
      fixedEvents+=beforeG-m.goals.length+beforeC-m.cards.length;
      if((m.goals.length||m.cards.length)&&m.status!=='played'&&m.status!=='live'){m.status='played';fixedStatuses++;}
      if(!m.status)m.status='scheduled';
      // Rigori validi solo nelle KO con entrambe le squadre reali; altrimenti puliamo.
      if(m.penalties){
        if(!isKnockoutPhase(m)||!m.homeTeamId||!m.awayTeamId){
          m.penalties=null;
        } else {
          const np=normalizePenalties(m.penalties);
          m.penalties=np||null;
        }
      }
    });
    autoResolveKnockout(state);
    state._integrity={removedEvents,fixedMatches,fixedAssignments,fixedStatuses,fixedEvents,checkedAt:new Date().toISOString()};
    return state;
  }
  function auditSchedule(state,issues){
    const r=normalizeRules(state.rules);
    const fieldSlots=new Map();
    const teamSlots=new Map();
    const teamDays=new Map();
    const fixed=groupFieldMap(r);
    const ownerByField=fixed?Object.fromEntries(Object.entries(fixed).map(([group,field])=>[field,group])):{};
    const matchesBySlot=new Map();
    (state.matches||[]).forEach(match=>{
      const key=scheduleSlotKey(match,r,true);
      if(!matchesBySlot.has(key))matchesBySlot.set(key,[]);
      matchesBySlot.get(key).push(match);
    });
    (state.matches||[]).forEach(m=>{
      if(!m.homeTeamId||!m.awayTeamId)return;
      if(fixed&&m.phase==='group'&&m.groupName){
        const expected=fixed[m.groupName],actual=fieldNoFromLabel(m.field);
        if(expected&&actual!==expected){
          const peers=matchesBySlot.get(scheduleSlotKey(m,r,true))||[];
          const explicitField=Boolean(m.requiredField&&fieldNoFromLabel(m.requiredField)===actual);
          const ownFieldOccupied=peers.some(other=>other.id!==m.id&&other.phase==='group'&&other.groupName===m.groupName&&fieldNoFromLabel(other.field)===expected);
          const borrowedOwner=ownerByField[actual]||'';
          const ownerIdle=!borrowedOwner||!peers.some(other=>other.id!==m.id&&other.phase==='group'&&other.groupName===borrowedOwner);
          if(!explicitField&&!(ownFieldOccupied&&ownerIdle))issues.push({severity:'error',area:'Calendario',message:`${m.round}: uso non valido di ${m.field||'un campo alternativo'} da parte di ${m.groupName}. Il Campo ${expected} deve essere occupato dallo stesso girone e il proprietario del campo alternativo non deve avere una partita nello slot.`});
        }
      }
      const fKey=scheduleSlotKey(m,r,false);
      if(m.date&&m.field){
        if(fieldSlots.has(fKey))issues.push({severity:'error',area:'Calendario',message:`Sovrapposizione campo: ${m.field} occupato nello stesso slot da più partite.`});
        fieldSlots.set(fKey,m.id);
      }
      const slot=scheduleSlotKey(m,r,true);
      [m.homeTeamId,m.awayTeamId].forEach(tid=>{
        if(!tid)return;
        const key=`${tid}|${slot}`;
        if(teamSlots.has(key))issues.push({severity:'error',area:'Calendario',message:`${teamName(state,tid)} ha due partite nello stesso slot.`});
        teamSlots.set(key,m.id);
        if(!r.oneDay&&m.date){
          const dayKey=`${tid}|${m.date}`;
          if(teamDays.has(dayKey))issues.push({severity:'warn',area:'Calendario',message:`${teamName(state,tid)} ha più di una partita nello stesso giorno (${m.date}).`});
          teamDays.set(dayKey,m.id);
        }
      });
    });
  }
  function auditDataState(state){
    state=normalizeState(state);
    const issues=[];
    const teamIds=new Set((state.teams||[]).map(t=>t.id));
    const playerIds=new Set();
    const presidentIds=new Set();
    const participantIds=new Set();
    const playerTeam=new Map();
    const teamNames=new Map();
    (state.teams||[]).forEach(t=>{
      const nameKey=String(t.name||'').trim().toLowerCase();
      if(teamNames.has(nameKey))issues.push({severity:'warn',area:'Squadre',message:`Nome squadra duplicato: ${t.name}.`});
      teamNames.set(nameKey,t.id);
      if(t.president?.id&&t.president?.name){presidentIds.add(t.president.id);if(state.rules.isKingsLeague)participantIds.add(t.president.id);}
      (t.players||[]).forEach(p=>{
        if(playerIds.has(p.id))issues.push({severity:'error',area:'Giocatori',message:`ID calciatore duplicato: ${p.name}.`});
        playerIds.add(p.id); participantIds.add(p.id); playerTeam.set(p.id,t.id);
      });
    });
    const generation=validateGeneration(state);
    if(!generation.ok)issues.push({severity:'error',area:'Regole',message:generation.message});
    const fx=state._integrity||{};
    const fixedTotal=(fx.removedEvents||0)+(fx.fixedMatches||0)+(fx.fixedAssignments||0)+(fx.fixedStatuses||0);
    if(fixedTotal>0){
      issues.push({severity:'warn',area:'Auto-riparazione',message:`Ho corretto automaticamente ${fixedTotal} elemento/i non allineati in fase di lettura: eventi rimossi ${fx.removedEvents||0}, partite ${fx.fixedMatches||0}, assegnazioni gironi ${fx.fixedAssignments||0}, stati referto ${fx.fixedStatuses||0}.`});
    }
    if((state.matches||[]).length&& !isCalendarFresh(state))issues.push({severity:'warn',area:'Calendario',message:'Calendario non allineato alle regole/squadre/gironi attuali: rigenera o apri un PDF per riallinearlo.'});
    (state.matches||[]).forEach(m=>{
      if(m.homeTeamId&&!teamIds.has(m.homeTeamId))issues.push({severity:'error',area:'Partite',message:`${matchLabel(m)}: squadra casa non esistente.`});
      if(m.awayTeamId&&!teamIds.has(m.awayTeamId))issues.push({severity:'error',area:'Partite',message:`${matchLabel(m)}: squadra ospite non esistente.`});
      if(m.homeTeamId&&m.awayTeamId&&m.homeTeamId===m.awayTeamId)issues.push({severity:'error',area:'Partite',message:`${m.round}: una squadra risulta contro sé stessa.`});
      if((m.status==='played'||m.status==='live'||m.goals.length||m.cards.length)&&(!m.homeTeamId||!m.awayTeamId))issues.push({severity:'error',area:'Referti',message:`${matchLabel(m)}: referto presente ma mancano una o entrambe le squadre reali.`});
      if((m.goals.length||m.cards.length)&&m.status!=='played'&&m.status!=='live')issues.push({severity:'warn',area:'Referti',message:`${m.round}: eventi presenti ma partita non marcata come giocata.`});
      (m.goals||[]).forEach(g=>{
        if(isOwnGoalEvent(g)){
          if(!g.teamId||!(g.teamId===m.homeTeamId||g.teamId===m.awayTeamId))issues.push({severity:'error',area:'Marcatori',message:`${m.round}: autogol assegnato a una squadra non in campo.`});
          return;
        }
        if(!participantIds.has(g.playerId))issues.push({severity:'error',area:'Marcatori',message:`${m.round}: gol assegnato a una persona inesistente.`});
        else if(!playerBelongsToMatch(state,m,g.playerId))issues.push({severity:'error',area:'Marcatori',message:`${m.round}: ${playerName(state,g.playerId)} non appartiene alle squadre in campo.`});
      });
      (m.cards||[]).forEach(c=>{
        if(!playerIds.has(c.playerId))issues.push({severity:'error',area:'Cartellini',message:`${m.round}: cartellino assegnato a un calciatore inesistente o a un presidente.`});
        else if(presidentIds.has(c.playerId))issues.push({severity:'error',area:'Cartellini',message:`${m.round}: ${playerName(state,c.playerId)} è presidente e non può ricevere gialli o rossi.`});
        else if(!playerBelongsToMatch(state,m,c.playerId))issues.push({severity:'error',area:'Cartellini',message:`${m.round}: ${playerName(state,c.playerId)} non appartiene alle squadre in campo.`});
      });
      ['Home','Away'].forEach(side=>{
        const source=m[`source${side}`];
        if(source){
          const resolved=resolveSource(state,source,'');
          const current=m[side==='Home'?'homeTeamId':'awayTeamId'];
          if(resolved&&current&&current!==resolved.id)issues.push({severity:'warn',area:'Tabellone',message:`${m.round}: placeholder ${sourceLabel(source)} risolto con una squadra diversa da quella mostrata.`});
        }
      });
    });
    if(state.rules.format==='groups_knockout'){
      const assignments=state.rules.groupAssignments||{};
      const names=(state.rules.groupConfigs||[]).map(g=>g.name);
      const counts=Object.fromEntries(names.map(n=>[n,0]));
      (state.teams||[]).forEach(t=>{if(assignments[t.id]&&counts[assignments[t.id]]!==undefined)counts[assignments[t.id]]++;});
      (state.rules.groupConfigs||[]).forEach(g=>{if(counts[g.name]&&counts[g.name]!==g.size)issues.push({severity:'warn',area:'Gironi',message:`${g.name}: assegnazioni manuali ${counts[g.name]}/${g.size}.`});});
    }

    if(state.rules.isKingsLeague){
      const playerGoalIds=new Set(); state.teams.forEach(t=>(t.players||[]).forEach(p=>playerGoalIds.add(p.id)));
      const realPlayerGoals=(state.matches||[]).reduce((sum,m)=>sum+(m.goals||[]).filter(g=>playerGoalIds.has(g.playerId)).length,0);
      const scorerGoals=scorers(state).reduce((sum,p)=>sum+p.goals,0);
      const realPresidentGoals=(state.matches||[]).reduce((sum,m)=>sum+(m.goals||[]).filter(g=>isPresidentId(state,g.playerId)).length,0);
      const presidentGoals=presidentScorers(state).reduce((sum,p)=>sum+p.goals,0);
      if(realPlayerGoals!==scorerGoals)issues.push({severity:'error',area:'Kings League',message:'La classifica marcatori calciatori non coincide con i gol reali dei calciatori: i gol doppi valgono 1 per i marcatori.'});
      if(realPresidentGoals!==presidentGoals)issues.push({severity:'error',area:'Kings League',message:'La classifica marcatori presidenti non coincide con i gol reali dei presidenti.'});
    }else{
      const nonKingsPresidentGoals=(state.matches||[]).reduce((sum,m)=>sum+(m.goals||[]).filter(g=>isPresidentId(state,g.playerId)).length,0);
      const doubleGoalsOutsideKings=(state.matches||[]).reduce((sum,m)=>sum+(m.goals||[]).filter(g=>Number(g.weight)===2).length,0);
      if(nonKingsPresidentGoals)issues.push({severity:'error',area:'Formato torneo',message:'I gol dei presidenti sono consentiti solo con Kings League attiva.'});
      if(doubleGoalsOutsideKings)issues.push({severity:'warn',area:'Formato torneo',message:'Gol doppi rilevati fuori dalla Kings League: verranno conteggiati come gol normali.'});
    }
    auditSchedule(state,issues);
    const snapshot=derivedSnapshot(state);
    return {ok:issues.filter(i=>i.severity==='error').length===0,issues,checkedAt:new Date().toISOString(),snapshot,message:issues.length?`${issues.length} controllo/i da verificare: ${issues.filter(i=>i.severity==='error').length} errori, ${issues.filter(i=>i.severity!=='error').length} avvisi.`:'Dati coerenti: tutte le viste derivano da regole, squadre, giocatori e referti aggiornati.'};
  }
  function repairState(state){
    const before=JSON.stringify(state||{});
    alignState(state);
    if((state.matches||[]).length&&!isCalendarFresh(state)){
      state.calendarSignature='';
      state._repairMessage='Calendario non allineato: nessuna rigenerazione automatica eseguita. Apri Regole & calendario e conferma una nuova anteprima.';
    }
    alignState(state);
    const changed=before!==JSON.stringify(state||{});
    return {ok:true,changed,message:state._repairMessage|| (changed?'Dati riallineati e proiezioni ricalcolate.':'Nessuna correzione necessaria.')};
  }
  function integrityReport(state){const report=auditDataState(state);return {ok:report.ok&&report.issues.length===0,issues:report.issues.map(i=>`${i.area}: ${i.message}`),details:report.issues,checkedAt:report.checkedAt,message:report.message,snapshot:report.snapshot};}

  function buildStandingsRows(state,matches,teamsSubset,opts){
    const includeLive = Boolean(opts && opts.includeLive);
    const teams=(teamsSubset||state.teams);
    const rows=teams.map(t=>({teamId:t.id,name:t.name,played:0,points:0,goalsFor:0,goalsAgainst:0,diff:0,headToHeadPoints:0,cards:0,yellow:0,red:0,hasLive:false}));
    const map=Object.fromEntries(rows.map(r=>[r.teamId,r]));
    const participantTeam={};
    (state.teams||[]).forEach(t=>{(t.players||[]).forEach(p=>{participantTeam[p.id]=t.id;});if(t.president?.id)participantTeam[t.president.id]=t.id;});
    (matches||[]).forEach(m=>{
      if(!m.homeTeamId||!m.awayTeamId)return;
      const h=map[m.homeTeamId],a=map[m.awayTeamId];
      if(!h||!a)return;
      (m.cards||[]).forEach(c=>{
        const tid=participantTeam[c.playerId];
        const row=map[tid];
        if(!row)return;
        if(c.type==='red')row.red++; else row.yellow++;
        row.cards++;
      });
      const isLiveM = m.status==='live';
      // Marca le squadre coinvolte in una live se richiesto (per evidenziazione UI)
      if(isLiveM && includeLive){ h.hasLive=true; a.hasLive=true; }
      // Le partite "Giocate" entrano sempre; le "Live" entrano SOLO se includeLive
      const counts = hasScore(state,m) || (includeLive && isLiveM);
      if(!counts) return;
      const sc=matchGoals(state,m);
      h.played++;a.played++;
      h.goalsFor+=sc.home;h.goalsAgainst+=sc.away;
      a.goalsFor+=sc.away;a.goalsAgainst+=sc.home;
      if(sc.home>sc.away)h.points+=3;
      else if(sc.away>sc.home)a.points+=3;
      else{h.points++;a.points++;}
    });
    rows.forEach(r=>r.diff=r.goalsFor-r.goalsAgainst);
    return rows;
  }
  function headToHeadPointsForTeam(state,matches,teamId,tiedIds,opts){
    const includeLive = Boolean(opts && opts.includeLive);
    let pts=0;
    (matches||[]).forEach(m=>{
      const counts = hasScore(state,m) || (includeLive && m.status==='live');
      if(!counts||!m.homeTeamId||!m.awayTeamId)return;
      if(!tiedIds.has(m.homeTeamId)||!tiedIds.has(m.awayTeamId))return;
      if(m.homeTeamId!==teamId&&m.awayTeamId!==teamId)return;
      const sc=matchGoals(state,m);
      const isHome=m.homeTeamId===teamId;
      const gf=isHome?sc.home:sc.away, ga=isHome?sc.away:sc.home;
      if(gf>ga)pts+=3; else if(gf===ga)pts+=1;
    });
    return pts;
  }
  function headToHeadPointsBetween(state,matches,teamId,otherId,opts){
    return headToHeadPointsForTeam(state,matches,teamId,new Set([teamId,otherId]),opts);
  }
  function compareStandingsRows(state,matches,a,b,opts){
    const order=normalizeStandingsCriteriaOrder(state.rules?.standingsCriteriaOrder);
    for(const id of order){
      let delta=0;
      if(id==='points')delta=b.points-a.points;
      else if(id==='headToHead')delta=headToHeadPointsBetween(state,matches,b.teamId,a.teamId,opts)-headToHeadPointsBetween(state,matches,a.teamId,b.teamId,opts);
      else if(id==='diff')delta=b.diff-a.diff;
      else if(id==='goalsFor')delta=b.goalsFor-a.goalsFor;
      else if(id==='goalsAgainst')delta=a.goalsAgainst-b.goalsAgainst;
      else if(id==='cards')delta=a.cards-b.cards;
      if(delta)return delta;
    }
    return a.name.localeCompare(b.name);
  }
  function calculateStandingsForMatches(state,matches,teamsSubset,opts){
    const rows=buildStandingsRows(state,matches,teamsSubset,opts);
    const byPoints=new Map();
    rows.forEach(r=>{if(!byPoints.has(r.points))byPoints.set(r.points,[]);byPoints.get(r.points).push(r);});
    byPoints.forEach(group=>{
      if(group.length>1){
        const tiedIds=new Set(group.map(r=>r.teamId));
        group.forEach(r=>r.headToHeadPoints=headToHeadPointsForTeam(state,matches,r.teamId,tiedIds,opts));
      }
    });
    return rows.sort((a,b)=>compareStandingsRows(state,matches,a,b,opts));
  }
  function calculateStandings(state,phaseFilter,opts){return calculateStandingsForMatches(state,state.matches.filter(m=>!phaseFilter||m.phase===phaseFilter),undefined,opts);}
  function allPhaseMatchesCompleted(state,phase){const ms=state.matches.filter(m=>m.phase===phase);return ms.length>0&&ms.every(m=>hasScore(state,m));}
  function groupNames(state){const fromMatches=state.matches.filter(m=>m.phase==='group'&&m.groupName).map(m=>m.groupName);const fromRules=(state.rules?.groupConfigs||[]).map(g=>g.name).filter(Boolean);return [...new Set([...fromRules,...fromMatches])];}
  function hasGroupStage(state){return state.rules?.format==='groups_knockout'||state.matches.some(m=>m.phase==='group');}
  function groupMatchesCompleted(state,groupName){const ms=state.matches.filter(m=>m.phase==='group'&&m.groupName===groupName);return ms.length>0&&ms.every(m=>hasScore(state,m));}
  function groupStandings(state,groupName,opts){const groupMatches=state.matches.filter(m=>m.phase==='group'&&m.groupName===groupName);const ids=[...new Set(groupMatches.flatMap(m=>[m.homeTeamId,m.awayTeamId]).filter(Boolean))];const teams=ids.map(id=>getTeam(state,id)).filter(Boolean);return calculateStandingsForMatches(state,groupMatches,teams,opts);}
  function groupedStandings(state,opts){return groupNames(state).map(name=>({name,rows:groupStandings(state,name,opts),completed:groupMatchesCompleted(state,name)}));}

  function officialStandings(state,opts){
    // Classifica principale ufficiale: nei format con playoff resta separata dalla fase a eliminazione diretta.
    // - Gironi + KO: la UI usa groupStandings/groupedStandings, quindi qui restituiamo comunque le righe dei gironi.
    // - Campionato + KO: solo fase league, playoff e Supercoppa esclusi.
    if(hasGroupStage(state))return groupedStandings(state,opts).flatMap(g=>g.rows||[]);
    if(state?.rules?.format==='league_knockout')return calculateStandings(state,'league',opts);
    return calculateStandings(state,undefined,opts);
  }
  function officialTeamRecord(state,teamId,opts){
    return officialStandings(state,opts).find(r=>r.teamId===teamId)||{teamId,played:0,points:0,goalsFor:0,goalsAgainst:0,diff:0,wins:0,draws:0,losses:0,yellow:0,red:0,cards:0,name:teamName(state,teamId,'Squadra')};
  }
  function teamPhaseKeyLabel(m){
    if(m.phase==='group')return {key:`group:${m.groupName||'Gironi'}`,label:m.groupName?`Fase a gironi · ${m.groupName}`:'Fase a gironi',rankable:true,order:10};
    if(m.phase==='league')return {key:'league',label:'Campionato',rankable:true,order:20};
    if(m.phase==='knockout')return {key:m.bracketName?`knockout:${m.bracketName}`:'knockout',label:m.bracketName||'Eliminazione diretta',rankable:false,order:30};
    if(m.phase==='playoff')return {key:m.bracketName?`playoff:${m.bracketName}`:'playoff',label:m.bracketName||'Playoff',rankable:false,order:40};
    if(m.phase==='secondary_playoff')return {key:m.bracketName?`secondary:${m.bracketName}`:'secondary_playoff',label:m.bracketName||'Playoff secondario',rankable:false,order:50};
    if(m.phase==='supercup')return {key:'supercup',label:'Supercoppa',rankable:false,order:60};
    return {key:m.phase||'other',label:PHASE_LABELS[m.phase]||m.phase||'Altra fase',rankable:false,order:90};
  }
  function emptyTeamPhaseRow(meta){
    return {key:meta.key,label:meta.label,rankable:!!meta.rankable,order:meta.order||90,played:0,wins:0,draws:0,losses:0,points:0,goalsFor:0,goalsAgainst:0,diff:0,live:0};
  }
  function addTeamMatchToPhaseRow(state,row,m,teamId,opts){
    const includeLive=Boolean(opts&&opts.includeLive);
    const isLiveMatch=m.status==='live';
    const counts=hasScore(state,m)||(includeLive&&isLiveMatch);
    if(!counts)return;
    const isHome=m.homeTeamId===teamId;
    if(!isHome&&m.awayTeamId!==teamId)return;
    const sc=matchGoals(state,m);
    const gf=isHome?sc.home:sc.away;
    const ga=isHome?sc.away:sc.home;
    row.played++; if(isLiveMatch)row.live++;
    row.goalsFor+=gf; row.goalsAgainst+=ga; row.diff=row.goalsFor-row.goalsAgainst;
    const isKO=isKnockoutPhase(m);
    const pWinner=isKO&&gf===ga?penaltyWinnerId(state,m):'';
    if(pWinner){
      if(pWinner===teamId){row.wins++; if(row.rankable)row.points+=3;}
      else{row.losses++;}
      return;
    }
    if(gf>ga){row.wins++; if(row.rankable)row.points+=3;}
    else if(gf<ga){row.losses++;}
    else{row.draws++; if(row.rankable)row.points+=1;}
  }
  function teamPhaseStats(state,teamId,opts){
    const rowsByKey=new Map();
    (state.matches||[]).forEach(m=>{
      if(m.homeTeamId!==teamId&&m.awayTeamId!==teamId)return;
      const meta=teamPhaseKeyLabel(m);
      if(!rowsByKey.has(meta.key))rowsByKey.set(meta.key,emptyTeamPhaseRow(meta));
      addTeamMatchToPhaseRow(state,rowsByKey.get(meta.key),m,teamId,opts);
    });
    const rows=[...rowsByKey.values()].filter(r=>r.played>0||r.live>0).sort((a,b)=>a.order-b.order||a.label.localeCompare(b.label,'it'));
    const total=rows.reduce((acc,r)=>{
      acc.played+=r.played; acc.wins+=r.wins; acc.draws+=r.draws; acc.losses+=r.losses;
      acc.points+=r.points; acc.goalsFor+=r.goalsFor; acc.goalsAgainst+=r.goalsAgainst; acc.live+=r.live;
      acc.diff=acc.goalsFor-acc.goalsAgainst; return acc;
    },{teamId,played:0,wins:0,draws:0,losses:0,points:0,goalsFor:0,goalsAgainst:0,diff:0,live:0});
    return {official:officialTeamRecord(state,teamId,opts),total,rows};
  }
  function resolveSource(state,source,fallback){if(!source)return null;if(source.startsWith('group:')){const parts=source.split(':');const posRaw=parts.pop();const group=parts.slice(1).join(':');if(!groupMatchesCompleted(state,group))return null;const row=groupStandings(state,group)[Number(posRaw)-1];return row?getTeam(state,row.teamId):null;}if(source.startsWith('league:')){if(!allPhaseMatchesCompleted(state,'league'))return null;const row=calculateStandings(state,'league')[Number(source.split(':')[1])-1];return row?getTeam(state,row.teamId):null;}if(source.startsWith('winner:')){const [,bracketName,rRaw,mRaw]=source.split(':');const match=state.matches.find(m=>m.bracketName===bracketName&&m.bracketRoundIndex===Number(rRaw)&&m.bracketMatchIndex===Number(mRaw));const wid=winnerId(state,match);return wid?getTeam(state,wid):null;}if(source.startsWith('bracketwinner:')){const bracketName=source.split(':')[1];const ms=state.matches.filter(m=>m.bracketName===bracketName);const max=Math.max(0,...ms.map(m=>m.bracketRoundIndex));const final=ms.find(m=>m.bracketRoundIndex===max);const wid=winnerId(state,final);return wid?getTeam(state,wid):null;}return null;}
  function sourceLabel(source,previous='Da definire'){if(!source)return previous||'Da definire';if(source.startsWith('group:')){const parts=source.split(':');const pos=parts.pop();const group=parts.slice(1).join(':');return `${pos}ª ${group}`;}if(source.startsWith('league:'))return `${source.split(':')[1]}ª classificata`;if(source.startsWith('winner:')){const [,bracketName,r,m]=source.split(':');return `Vincente ${bracketName} ${r}.${m}`;}if(source.startsWith('bracketwinner:'))return `Vincente ${source.split(':').slice(1).join(':')}`;return previous||'Da definire';}
  function rebalanceResolvedKnockoutSchedule(state){
    const rules=normalizeRules(state?.rules||{});
    if(!rules.oneDay)return {changed:false,provenOptimal:true,combinationsEvaluated:0};
    const eligible=(state.matches||[]).filter(match=>isKnockoutPhase(match)&&match.homeTeamId&&match.awayTeamId&&match.status!=='played'&&match.status!=='live'&&!(match.goals||[]).length&&!(match.cards||[]).length&&!match.manualLock&&!match.requiredDate&&!match.requiredTime&&!match.requiredField&&match.date&&match.time&&match.field);
    if(eligible.length<2)return {changed:false,provenOptimal:true,combinationsEvaluated:0};
    const grouped=new Map();
    eligible.forEach(match=>{const key=`${Number(match.roundIndex)||0}|${Number(match.bracketRoundIndex)||0}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(match);});
    const groups=[...grouped.values()].filter(matches=>matches.length>1);
    if(!groups.length)return {changed:false,provenOptimal:true,combinationsEvaluated:0};
    const allMatches=state.matches||[];
    const original=new Map(eligible.map(match=>[match.id,{date:match.date,time:match.time,datetime:match.datetime,field:match.field}]));
    const tupleFor=()=>{
      const stats=calendarConsecutiveStats(allMatches,rules,state);
      let restPenalty=0;
      Object.values(stats.restMinutesByTeam||{}).forEach(rests=>{if(!rests.length)return;const avg=rests.reduce((sum,value)=>sum+value,0)/rests.length;rests.forEach(value=>{const diff=value-avg;restPenalty+=diff*diff;});});
      return [stats.uniqueTeams,stats.totalOccurrences,stats.threePlusOccurrences,stats.maxRun,Math.round(restPenalty)];
    };
    const compare=(a,b)=>{for(let i=0;i<Math.max(a.length,b.length);i++){const av=a[i]??0,bv=b[i]??0;if(av!==bv)return av-bv;}return 0;};
    const minRest=Math.max(0,Number(rules.calendarCustomization?.minRestMinutes)||0);
    function validWholeSchedule(){
      const fieldSlots=new Set(),teamSlots=new Set(),byTeam=new Map();
      for(const match of allMatches){
        if(!match.date||!match.time||!match.field)continue;
        const fieldKey=`${match.date}|${match.time}|${match.field}`;
        if(fieldSlots.has(fieldKey))return false;fieldSlots.add(fieldKey);
        for(const teamId of matchTeamIds(match)){
          const teamKey=`${match.date}|${match.time}|${teamId}`;
          if(teamSlots.has(teamKey))return false;teamSlots.add(teamKey);
          if(!byTeam.has(teamId))byTeam.set(teamId,[]);
          byTeam.get(teamId).push(match);
        }
      }
      if(minRest){
        for(const matches of byTeam.values()){
          matches.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time)));
          for(let index=1;index<matches.length;index++){
            const previous=matches[index-1],current=matches[index];
            if(previous.date!==current.date)continue;
            const rest=(timeToMinutes(current.time)-timeToMinutes(previous.time))-Math.max(5,Number(rules.matchDuration)||40);
            if(rest<minRest)return false;
          }
        }
      }
      return true;
    }
    let bestTuple=tupleFor();
    let bestSlots=new Map([...original.entries()].map(([id,slot])=>[id,{...slot}]));
    let combinationsEvaluated=0;
    function captureCurrent(){return new Map(eligible.map(match=>[match.id,{date:match.date,time:match.time,datetime:match.datetime,field:match.field}]));}
    function searchGroup(groupIndex){
      if(groupIndex===groups.length){
        combinationsEvaluated++;
        if(!validWholeSchedule())return;
        const tuple=tupleFor();
        if(compare(tuple,bestTuple)<0){bestTuple=tuple;bestSlots=captureCurrent();}
        return;
      }
      const matches=groups[groupIndex];
      const slots=matches.map(match=>({...original.get(match.id)}));
      const used=Array(slots.length).fill(false),assigned=Array(matches.length);
      function permute(position){
        if(position===matches.length){
          matches.forEach((match,index)=>Object.assign(match,assigned[index]));
          searchGroup(groupIndex+1);
          return;
        }
        const match=matches[position],teams=matchTeamIds(match);
        for(let slotIndex=0;slotIndex<slots.length;slotIndex++){
          if(used[slotIndex])continue;
          const slot=slots[slotIndex];
          let conflict=false;
          for(let earlier=0;earlier<position;earlier++){
            if(assigned[earlier].date===slot.date&&assigned[earlier].time===slot.time&&matchTeamIds(matches[earlier]).some(teamId=>teams.includes(teamId))){conflict=true;break;}
          }
          if(conflict)continue;
          used[slotIndex]=true;assigned[position]=slot;permute(position+1);used[slotIndex]=false;
        }
      }
      permute(0);
    }
    searchGroup(0);
    eligible.forEach(match=>Object.assign(match,bestSlots.get(match.id)||original.get(match.id)));
    const changed=eligible.some(match=>{const before=original.get(match.id);return match.date!==before.date||match.time!==before.time||match.field!==before.field;});
    return {changed,provenOptimal:true,combinationsEvaluated,objective:{uniqueConsecutiveTeams:bestTuple[0],consecutiveOccurrences:bestTuple[1],threePlusOccurrences:bestTuple[2],maxRun:bestTuple[3],restBalancePenalty:bestTuple[4]}};
  }

  function autoResolveKnockout(state){(state.matches||[]).forEach(m=>{if(m.sourceHome){const t=resolveSource(state,m.sourceHome,m.homeLabel);if(t){m.homeTeamId=t.id;m.homeLabel=t.name;}else{m.homeTeamId='';m.homeLabel=sourceLabel(m.sourceHome,m.homeLabel);}}if(m.sourceAway){const t=resolveSource(state,m.sourceAway,m.awayLabel);if(t){m.awayTeamId=t.id;m.awayLabel=t.name;}else{m.awayTeamId='';m.awayLabel=sourceLabel(m.sourceAway,m.awayLabel);}}});rebalanceResolvedKnockoutSchedule(state);}
  function bracketData(state){autoResolveKnockout(state);const ko=state.matches.filter(m=>['knockout','playoff','secondary_playoff','supercup'].includes(m.phase)||m.bracketName);if(!ko.length)return {available:false,message:'Questo formato non prevede una fase a eliminazione diretta.',brackets:[]};const byName=new Map();ko.forEach(m=>{const name=m.bracketName||'Tabellone';if(!byName.has(name))byName.set(name,[]);byName.get(name).push(m);});const brackets=[...byName.entries()].map(([name,matches])=>{const rounds=new Map();matches.sort((a,b)=>a.bracketRoundIndex-b.bracketRoundIndex||a.bracketMatchIndex-b.bracketMatchIndex).forEach(m=>{const key=m.bracketRound||m.round;if(!rounds.has(key))rounds.set(key,[]);rounds.get(key).push(m);});return {name,rounds:[...rounds.entries()].map(([name,matches])=>({name,matches}))};});return {available:true,message:'Tabellone calcolato automaticamente. I placeholder diventano squadre reali appena la fase precedente è completata.',brackets};}
  function playerStats(state){
    const rows=[];
    state.teams.forEach(t=>t.players.forEach(p=>rows.push({playerId:p.id,name:p.name,birthYear:p.birthYear||'',teamId:t.id,teamName:t.name,played:0,goals:0,scoreGoals:0,yellow:0,red:0,type:'player'})));
    const map=Object.fromEntries(rows.map(r=>[r.playerId,r]));
    state.matches.forEach(m=>{
      // Le partite LIVE non contribuiscono alle statistiche giocatori: gol, cartellini e PG
      // entrano nelle stats solo quando la partita è chiusa (status==='played' o equivalente
      // tramite hasScore, che per design esclude 'live').
      if(m.status==='live')return;
      if(hasScore(state,m)){[m.homeTeamId,m.awayTeamId].forEach(tid=>{const team=getTeam(state,tid);team?.players.forEach(p=>{if(map[p.id])map[p.id].played++;});});}
      (m.goals||[]).forEach(g=>{
        if(map[g.playerId]){
          map[g.playerId].goals+=1; // classifica marcatori calciatori: un gol reale vale sempre 1, anche se nel punteggio Kings League vale doppio
          map[g.playerId].scoreGoals+=eventScoreWeight(state,g);
        }
      });
      (m.cards||[]).forEach(c=>{if(map[c.playerId])map[c.playerId][c.type==='red'?'red':'yellow']++;});
    });
    return rows.sort((a,b)=>b.goals-a.goals||a.teamName.localeCompare(b.teamName)||a.name.localeCompare(b.name));
  }
  function presidentStats(state){
    const rows=[];
    state.teams.forEach(t=>{if(t.president?.name)rows.push({presidentId:t.president.id,name:t.president.name,teamId:t.id,teamName:t.name,goals:0,scoreGoals:0,played:0,type:'president'});});
    const map=Object.fromEntries(rows.map(r=>[r.presidentId,r]));
    state.matches.forEach(m=>{
      if(m.status==='live')return;
      if(hasScore(state,m)){[m.homeTeamId,m.awayTeamId].forEach(tid=>{const team=getTeam(state,tid);if(team?.president?.id&&map[team.president.id])map[team.president.id].played++;});}
      (m.goals||[]).forEach(g=>{if(map[g.playerId]){map[g.playerId].goals+=1;map[g.playerId].scoreGoals+=eventScoreWeight(state,g);}});
    });
    return rows.sort((a,b)=>b.goals-a.goals||a.teamName.localeCompare(b.teamName)||a.name.localeCompare(b.name));
  }
  function scorers(state){return playerStats(state).filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name));}
  function presidentScorers(state){return presidentStats(state).filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name));}
  function stats(state){
    // Le partite LIVE non vengono ancora contate nei totali globali (gol, cartellini):
    // sono pre-classifica. Solo quando passano a 'played' diventano definitive.
    const consolidated = state.matches.filter(m=>m.status!=='live');
    const actualGoals=consolidated.reduce((s,m)=>s+(m.goals||[]).length,0);
    const scoreGoals=consolidated.reduce((s,m)=>s+(m.goals||[]).reduce((a,g)=>a+eventScoreWeight(state,g),0),0);
    return {
      teams:state.teams.length,
      players:state.teams.reduce((s,t)=>s+t.players.length,0),
      presidents:state.teams.filter(t=>t.president?.name).length,
      matches:state.matches.length,
      goals:actualGoals,
      scoreGoals,
      yellow:consolidated.reduce((s,m)=>s+(m.cards||[]).filter(c=>c.type==='yellow').length,0),
      red:consolidated.reduce((s,m)=>s+(m.cards||[]).filter(c=>c.type==='red').length,0),
      articles:(state.articles||[]).length
    };
  }
  function phases(state){return [...new Set(state.matches.map(m=>m.phase))];}
  function rounds(state){return [...new Set(state.matches.map(m=>m.round).filter(Boolean))];}
  function allArticles(state){return [...(state.articles||[])].sort((a,b)=>new Date(b.publishedAt||b.updatedAt||b.createdAt)-new Date(a.publishedAt||a.updatedAt||a.createdAt));}
  function articles(state){return allArticles(state).filter(a=>isArticlePublic(a));}
  function articleById(state,value,{includeDrafts=false}={}){
    const key=String(value||'');
    return (includeDrafts?allArticles(state):articles(state)).find(a=>a.id===key||a.slug===key)||null;
  }
  function articleCategories(state,{includeDrafts=false}={}){
    return [...new Set((includeDrafts?allArticles(state):articles(state)).map(a=>a.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it'));
  }
  function generationPlan(state){const v=validateGeneration(state);if(!v.ok)return v;const r=normalizeRules(state.rules);const matches=buildMatches(state);const grouped=matchesByRoundIndex(matches);const b=matches.some(m=>m.bracketName);const estimate=suggestEndDateForMatches(matches,r);const estimateText=estimate.ok?` ${estimate.message}`:` ${estimate.message}`;return {ok:estimate.ok,message:`${FORMAT_HELP[r.format]} Partite previste: ${matches.length}. Giornate/fasi calendario: ${grouped.length}.${b?' Tabellone previsto e visualizzabile nei report.':''}${estimateText}`,matches,rounds:grouped.length,estimate};}

  // ---------------------------------------------------------------
  // Memoization layer: cache i selettori derivati finché lo state rilevante non cambia.
  // Una "fingerprint" leggera (numero match, somma goals/cards, status, regole serializzate)
  // identifica se serve davvero ricomputare. Su tornei grandi ~10-50x più veloce.
  // ---------------------------------------------------------------
  const _derivedCache = new WeakMap();
  function stableCacheString(value){
    try{return JSON.stringify(value);}catch(_){return String(Date.now())+Math.random();}
  }
  function deriveFingerprint(state){
    const r=state.rules||{};
    // La cache dei selettori deve invalidarsi anche quando il numero di eventi resta uguale
    // ma cambia il contenuto: es. sposto un gol da un calciatore a un altro, cambio un autogol,
    // modifico un rigore, rinomino una squadra o cambio criteri di classifica.
    const rulesKey={
      format:r.format,
      isKingsLeague:!!r.isKingsLeague,
      playoffTeams:r.playoffTeams,
      standingsCriteriaOrder:r.standingsCriteriaOrder||[],
      groupConfigs:(r.groupConfigs||[]).map(g=>({name:g.name,size:g.size,qualifiers:g.qualifiers})),
      eliminationCompetitions:(r.eliminationCompetitions||[]).map(c=>({id:c.id,name:c.name,startRank:c.startRank,teams:c.teams})),
      superCup:r.superCup||{}
    };
    const teamsKey=(state.teams||[]).map(t=>({
      id:t.id,
      name:t.name,
      president:t.president?{id:t.president.id,name:t.president.name}:null,
      players:(t.players||[]).map(p=>({id:p.id,name:p.name,birthYear:p.birthYear,number:p.number}))
    }));
    const matchesKey=(state.matches||[]).map(m=>({
      id:m.id,
      phase:m.phase,
      groupName:m.groupName,
      bracketName:m.bracketName,
      bracketRoundIndex:m.bracketRoundIndex,
      bracketMatchIndex:m.bracketMatchIndex,
      homeTeamId:m.homeTeamId,
      awayTeamId:m.awayTeamId,
      homeLabel:m.homeLabel,
      awayLabel:m.awayLabel,
      sourceHome:m.sourceHome,
      sourceAway:m.sourceAway,
      status:m.status,
      penalties:m.penalties?{home:m.penalties.home,away:m.penalties.away}:null,
      goals:(m.goals||[]).map(g=>({id:g.id,playerId:g.playerId,ownGoal:!!g.ownGoal,teamId:g.teamId,weight:Number(g.weight)||1,minute:g.minute||''})),
      cards:(m.cards||[]).map(c=>({id:c.id,playerId:c.playerId,type:c.type,minute:c.minute||''}))
    }));
    return stableCacheString({rules:rulesKey,teams:teamsKey,matches:matchesKey});
  }
  function memo(fn,key){
    return function(state, ...args){
      const argsKey = key + (args.length ? '|' + stableCacheString(args) : '');
      let bucket = _derivedCache.get(state);
      if(!bucket){
        bucket = {fp: deriveFingerprint(state), data: new Map()};
        _derivedCache.set(state, bucket);
      } else {
        // Verifica se la fingerprint è ancora valida (state mutato in-place)
        const fp = deriveFingerprint(state);
        if(fp !== bucket.fp){
          bucket.fp = fp;
          bucket.data.clear();
        }
      }
      if(bucket.data.has(argsKey)) return bucket.data.get(argsKey);
      const result = fn(state, ...args);
      bucket.data.set(argsKey, result);
      return result;
    };
  }
  // Wrapper memoizzati: il payload di calculateStandings/playerStats/bracketData è pesante,
  // quindi memoizzare anche solo per la stessa render-pass è già un gain enorme.
  const memoCalculateStandings = memo(calculateStandings,'standings');
  const memoPlayerStats = memo(playerStats,'playerStats');
  const memoPresidentStats = memo(presidentStats,'presidentStats');
  const memoScorers = memo(scorers,'scorers');
  const memoPresidentScorers = memo(presidentScorers,'presidentScorers');
  const memoBracketData = memo(bracketData,'bracketData');
  const memoGroupStandings = memo(groupStandings,'groupStandings');
  const memoGroupedStandings = memo(groupedStandings,'groupedStandings');
  const memoOfficialStandings = memo(officialStandings,'officialStandings');
  const memoOfficialTeamRecord = memo(officialTeamRecord,'officialTeamRecord');
  const memoTeamPhaseStats = memo(teamPhaseStats,'teamPhaseStats');
  const memoStats = memo(stats,'stats');

  window.NexoraStore={ADMIN_KEY,PUBLIC_KEY,FORMAT_LABELS,PHASE_LABELS,FORMAT_HELP,STANDINGS_CRITERIA,defaultStandingsCriteriaOrder,normalizeStandingsCriteriaOrder,standingsCriterionMeta,uid,blankRules,defaultCalendarCustomization,normalizeCalendarCustomization,defaultGroupConfigs,defaultSite,normalizeSite,articleSlug,isArticlePublic,emptyState,normalizeState,readPendingRemoteState,newestAdminLocalState,publicCacheState,withoutHeavyMedia,mergeMissingMedia,eventScoreWeight,load,save,alignState,repairState,auditDataState,derivedSnapshot,integrityReport,getTeam,getPlayer,getPresident,getParticipant,isPresidentId,teamName,playerName,presidentGoalLabel,isOwnGoalEvent,goalScoringTeamId,goalEventLabel,aggregateGoalEvents,scoreText,matchGoals,actualGoalCount,hasScore,hasGoals,isPlayed,isLive,matchStatusInfo,normalizeJerseyNumber,normalizePenalties,isKnockoutPhase,penaltyWinnerId,winnerId,minimumTeams,plannedGroups,groupAssignmentsFromMatches,validateGroupAssignments,serpentineAssignments,randomAssignments,generateCalendar,ensureFreshCalendar,previewCalendar,isCalendarFresh,scheduleSignature,validateGeneration,validateCompetitionConfig,calendarPrerequisites,validateCalendarConstraintDefinitions,validateCalendarCustomization,calendarAvailableTimes,generationPlan,calendarConsecutiveStats,consecutiveResultMessage,rebalanceResolvedKnockoutSchedule,autoResolveKnockout,bracketData:memoBracketData,sortedCompetitions,seedEntrantsHighLow,allowedDateList,weekdayLabels,suggestEndDateForMatches,oneDayCalendarPauseEvent,groupFieldMap,allowedFieldsForMatch,groupFieldPolicyMessage,deriveFingerprint,selectors:{calculateStandings:memoCalculateStandings,officialStandings:memoOfficialStandings,officialTeamRecord:memoOfficialTeamRecord,teamPhaseStats:memoTeamPhaseStats,groupStandings:memoGroupStandings,groupNames,groupedStandings:memoGroupedStandings,hasGroupStage,playerStats:memoPlayerStats,presidentStats:memoPresidentStats,scorers:memoScorers,presidentScorers:memoPresidentScorers,stats:memoStats,phases,rounds,bracketData:memoBracketData,articles,allArticles,articleById,articleCategories}};
})();
