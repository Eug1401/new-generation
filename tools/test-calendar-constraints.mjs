import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localStorage={getItem(){return null;},setItem(){},removeItem(){},key(){return null;},get length(){return 0;}};
const context={console,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,localStorage,sessionStorage:localStorage,CustomEvent:class{},navigator:{onLine:true},location:{pathname:'/admin-rules.html'},document:{},dispatchEvent(){return true;}};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8'),context,{filename:'assets/js/store.js'});
const store=context.NexoraStore;

function makeState(sizes=[4,4],customization={}){
  const state=store.emptyState();
  const total=sizes.reduce((sum,size)=>sum+size,0);
  state.teams=Array.from({length:total},(_,index)=>({id:`team_${index+1}`,name:`Squadra ${index+1}`,players:[],president:{id:`pres_${index+1}`,name:''},coach:{name:''}}));
  const groups=sizes.map((size,index)=>({name:`Girone ${String.fromCharCode(65+index)}`,size,qualifiers:1}));
  let offset=0;
  const assignments={};
  groups.forEach(group=>{state.teams.slice(offset,offset+group.size).forEach(team=>assignments[team.id]=group.name);offset+=group.size;});
  state.rules={...state.rules,format:'groups_knockout',oneDay:true,fieldCount:2,groupFieldPolicy:'fixed_by_group',startDate:'2026-07-01',startTime:'09:00',matchDuration:40,breakMinutes:10,groupConfigs:groups,groupAssignments:assignments,calendarCustomization:store.normalizeCalendarCustomization({...store.defaultCalendarCustomization(),...customization})};
  return store.normalizeState(state);
}
const groupMatches=state=>state.matches.filter(match=>match.phase==='group');
const minutes=time=>{const [hours,mins]=String(time).split(':').map(Number);return hours*60+mins;};
const chronological=matches=>[...matches].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||(Number(a.field.match(/\d+/)?.[0])||0)-(Number(b.field.match(/\d+/)?.[0])||0)||String(a.id).localeCompare(String(b.id)));
const pairCount=size=>size*(size-1)/2;
const scheduleTuple=state=>chronological(groupMatches(state)).map(match=>[match.groupName,match.roundIndex,[match.homeTeamId,match.awayTeamId].sort().join('|'),match.time,match.field].join('~'));

function assertIntegrity(state,sizes){
  const matches=groupMatches(state);
  assert.equal(matches.length,sizes.reduce((sum,size)=>sum+pairCount(size),0),'Numero partite dei gironi non corretto.');
  const pairs=new Set(matches.map(match=>`${match.groupName}:${[match.homeTeamId,match.awayTeamId].sort().join('|')}`));
  assert.equal(pairs.size,matches.length,'Sono presenti partite duplicate.');
  const fieldSlots=new Set(),teamSlots=new Set();
  for(const match of matches){
    const fieldKey=`${match.date}|${match.time}|${match.field}`;
    assert.equal(fieldSlots.has(fieldKey),false,`Campo duplicato nello slot ${fieldKey}.`);fieldSlots.add(fieldKey);
    for(const teamId of [match.homeTeamId,match.awayTeamId]){
      const teamKey=`${match.date}|${match.time}|${teamId}`;
      assert.equal(teamSlots.has(teamKey),false,`La squadra ${teamId} gioca contemporaneamente su due campi.`);teamSlots.add(teamKey);
    }
  }
  for(const team of state.teams){
    const teamMatches=chronological(matches.filter(match=>match.homeTeamId===team.id||match.awayTeamId===team.id));
    for(let index=1;index<teamMatches.length;index++)assert.ok(Number(teamMatches[index].roundIndex)>Number(teamMatches[index-1].roundIndex),`Ordine giornate non rispettato per ${team.id}.`);
  }
}

function validTopologicalOrders(matches){
  const result=[];
  function ready(match,remaining){
    return [match.homeTeamId,match.awayTeamId].every(teamId=>!remaining.some(other=>other.id!==match.id&&(other.homeTeamId===teamId||other.awayTeamId===teamId)&&Number(other.roundIndex)<Number(match.roundIndex)));
  }
  function visit(remaining,order){
    if(!remaining.length){result.push([...order]);return;}
    for(const match of remaining.filter(match=>ready(match,remaining)).sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
      visit(remaining.filter(other=>other.id!==match.id),[...order,match]);
    }
  }
  visit([...matches],[]);
  return result;
}

function adjacencyObjective(slotMatches){
  const lastSlot=new Map(),consecutiveTeams=new Set();
  let occurrences=0;
  slotMatches.forEach((matches,slot)=>matches.flatMap(match=>[match.homeTeamId,match.awayTeamId]).forEach(teamId=>{
    if(lastSlot.get(teamId)===slot-1){consecutiveTeams.add(teamId);occurrences++;}
    lastSlot.set(teamId,slot);
  }));
  return [consecutiveTeams.size,occurrences];
}

// 1. Gironi uguali: nessun prestito di campo e prova di ottimalità presente.
{
  const state=makeState([4,4]);
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assertIntegrity(state,[4,4]);
  assert.equal(groupMatches(state).some(match=>match.groupName==='Girone A'&&match.field!=='Campo 1'),false);
  assert.equal(groupMatches(state).some(match=>match.groupName==='Girone B'&&match.field!=='Campo 2'),false);
  assert.equal(result.optimality?.provenOptimal,true,'Lo scheduler non certifica l ottimo globale.');
  assert.equal(result.optimality?.algorithm,'exact-branch-and-bound');
}

// 2. Gironi diversi: il girone più grande usa il campo libero senza sottrarlo al proprietario.
let unequalState;
{
  unequalState=makeState([4,6]);
  const result=store.generateCalendar(unequalState,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assertIntegrity(unequalState,[4,6]);
  const matches=groupMatches(unequalState);
  const borrowed=matches.filter(match=>match.groupName==='Girone B'&&match.field==='Campo 1');
  assert.ok(borrowed.length>0,'Il Girone B non usa mai il Campo 1 rimasto libero.');
  for(const match of borrowed){
    const sameSlot=matches.filter(other=>other.date===match.date&&other.time===match.time);
    assert.ok(sameSlot.some(other=>other.id!==match.id&&other.groupName==='Girone B'&&other.field==='Campo 2'),'Il prestito deve avvenire solo quando il campo naturale del girone è già occupato.');
    assert.equal(sameSlot.some(other=>other.groupName==='Girone A'),false,'Il Campo 1 è stato sottratto al Girone A mentre il proprietario giocava nello stesso slot.');
  }
  assert.equal(result.optimality?.internalEmptyFields,0,'Esiste ancora almeno un buco interno riempibile.');
  const audit=store.auditDataState(unequalState);
  assert.equal(audit.issues.some(issue=>issue.area==='Calendario'&&/uso non valido|dovrebbe giocare/i.test(issue.message)),false,'L audit considera erroneamente non valido il prestito controllato del campo.');
}

// 3. Il vecchio blocco per roundIndex non lascia un campo vuoto se una partita pronta esiste.
{
  const slots=new Map();
  groupMatches(unequalState).forEach(match=>{const key=`${match.date}|${match.time}`;if(!slots.has(key))slots.set(key,[]);slots.get(key).push(match);});
  const mixedRoundSlot=[...slots.values()].find(list=>list.length===2&&new Set(list.map(match=>match.roundIndex)).size>1);
  assert.ok(mixedRoundSlot,'Lo scheduler non ha riempito lo slot con una partita pronta di una giornata successiva.');
  assert.deepEqual(new Set(mixedRoundSlot.map(match=>match.field)),new Set(['Campo 1','Campo 2']));
}

// 4. Il campo alternativo non viene usato se il girone proprietario ha una partita pronta.
{
  const matches=groupMatches(unequalState);
  for(const borrowed of matches.filter(match=>match.groupName==='Girone B'&&match.field==='Campo 1')){
    const target=minutes(borrowed.time);
    const ownerCandidates=matches.filter(match=>match.groupName==='Girone A'&&minutes(match.time)>target);
    for(const candidate of ownerCandidates){
      const ready=[candidate.homeTeamId,candidate.awayTeamId].every(teamId=>matches.filter(match=>match.groupName==='Girone A'&&(match.homeTeamId===teamId||match.awayTeamId===teamId)&&Number(match.roundIndex)<Number(candidate.roundIndex)).every(previous=>minutes(previous.time)<target));
      assert.equal(ready,false,`Il Campo 1 è stato prestato benché ${candidate.id} del Girone A fosse pronta.`);
    }
  }
}

// 5. Orario esatto di esordio obbligatorio.
{
  const state=makeState([3,3]);
  state.rules.calendarCustomization.teamDebuts=[{id:'exact_1',teamId:'team_1',kind:'exactTime',value:'10:40',mode:'hard'}];
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  const first=chronological(groupMatches(state).filter(match=>match.homeTeamId==='team_1'||match.awayTeamId==='team_1'))[0];
  assert.equal(first.time,'10:40');
  assertIntegrity(state,[3,3]);
}

// 6. Vincoli di esordio incompatibili bloccano la generazione.
{
  const state=makeState([4,4],{firstRoundLocks:[{id:'lock_pair',groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',mode:'hard'}]});
  state.rules.calendarCustomization.teamDebuts=[{id:'time_a',teamId:'team_1',kind:'exactTime',value:'09:00',mode:'hard'},{id:'time_b',teamId:'team_2',kind:'exactTime',value:'10:40',mode:'hard'}];
  const preview=store.previewCalendar(state);
  assert.equal(preview.ok,false);
  assert.ok((preview.conflicts||[]).some(conflict=>/orari di esordio diversi/i.test(conflict.message)));
}

// 7. Riposo minimo e prima giornata fissata restano vincoli obbligatori.
{
  const state=makeState([3,3],{minRestMinutes:30,firstRoundLocks:[{id:'locked_slot',groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',requiredTime:'10:40',requiredField:'Campo 1',mode:'hard'}]});
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  const locked=groupMatches(state).find(match=>match.manualLock);
  assert.equal(locked?.time,'10:40');
  assert.equal(locked?.field,'Campo 1');
  for(const team of state.teams){
    const list=chronological(groupMatches(state).filter(match=>match.homeTeamId===team.id||match.awayTeamId===team.id));
    for(let index=1;index<list.length;index++)assert.ok(minutes(list[index].time)-(minutes(list[index-1].time)+state.rules.matchDuration)>=30,`Riposo minimo non rispettato per ${team.id}.`);
  }
}

// 8. Preferenze opzionali e vecchi tipi di vincolo sono eliminati dal modello.
{
  const normalized=store.normalizeCalendarCustomization({profile:'custom',seed:123,preferences:{avoidConsecutive:false},teamDebuts:[{id:'keep',teamId:'team_1',kind:'exactTime',value:'10:40'},{id:'drop_position',teamId:'team_2',kind:'firstRoundPosition',value:'2'},{id:'drop_field',teamId:'team_3',kind:'field',value:'Campo 1'},{id:'drop_round',teamId:'team_4',kind:'firstRound',value:'1'}],teamUnavailability:[{teamId:'team_1'}],fieldBlocks:[{field:'Campo 1'}],events:[{date:'2026-07-01'}]});
  assert.deepEqual(normalized.teamDebuts.map(rule=>rule.kind),['exactTime']);
  for(const removed of ['profile','seed','preferences','teamUnavailability','fieldBlocks','events'])assert.equal(removed in normalized,false,`${removed} è ancora presente nel modello.`);
  const clean=makeState([4,4]);
  const legacy=makeState([4,4]);
  legacy.rules.calendarCustomization={...legacy.rules.calendarCustomization,profile:'aggressive',seed:999,preferences:{avoidConsecutive:false},teamDebuts:[{id:'legacy',teamId:'team_1',kind:'firstRoundPosition',value:'4',mode:'hard'}],teamUnavailability:[{teamId:'team_1',date:'2026-07-01',time:'09:00'}],fieldBlocks:[{field:'Campo 1',date:'2026-07-01',time:'09:00'}]};
  assert.equal(store.generateCalendar(clean,{preserveResults:false}).ok,true);
  assert.equal(store.generateCalendar(legacy,{preserveResults:false}).ok,true);
  assert.deepEqual(scheduleTuple(legacy),scheduleTuple(clean),'Le vecchie preferenze influenzano ancora il calendario.');
}

// 9. UI: quattro step, nessuna preferenza, Web Worker e metriche dell'ottimo.
{
  const uiSource=fs.readFileSync(path.join(root,'assets/js/admin-rules.js'),'utf8');
  const htmlSource=fs.readFileSync(path.join(root,'admin-rules.html'),'utf8');
  const storeSource=fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8');
  const workerSource=fs.readFileSync(path.join(root,'assets/js/calendar-worker.js'),'utf8');
  assert.match(uiSource,/const steps=\['Prerequisiti','Prima giornata','Vincoli obbligatori','Anteprima'\]/);
  assert.match(uiSource,/function firstRoundStep/);
  assert.match(uiSource,/function constraintsStep/);
  assert.match(uiSource,/new Worker\('assets\/js\/calendar-worker\.js'\)/);
  assert.match(uiSource,/Ricerca del calendario ottimale in corso/);
  assert.match(uiSource,/Squadre con almeno due partite consecutive/);
  assert.doesNotMatch(uiSource,/function preferencesStep|data-profile|data-seed|balanceFields|avoidConsecutive|reduceWaiting/);
  assert.doesNotMatch(htmlSource,/generateAlternativeCalendarBtn/);
  assert.match(workerSource,/importScripts\('store\.js'\)/);
  assert.match(workerSource,/onProgress/);
  assert.match(storeSource,/exact-branch-and-bound/);
  assert.match(storeSource,/provenOptimal:true/);
  assert.doesNotMatch(storeSource,/firstRoundPosition/);
}

// 10. L'anteprima non sovrascrive il calendario precedente.
{
  const state=makeState([4,4]);
  state.matches=[{id:'existing_calendar_sentinel',phase:'league',round:'Vecchio calendario',roundIndex:0,date:'2026-01-01',time:'09:00',field:'Campo 1',homeTeamId:'team_1',awayTeamId:'team_2',goals:[],cards:[],status:'scheduled'}];
  const before=JSON.stringify(state.matches);
  const preview=store.previewCalendar(state);
  assert.equal(preview.ok,true,preview.message);
  assert.equal(JSON.stringify(state.matches),before);
  assert.equal(preview.notPersisted,true);
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assert.equal(state.matches.some(match=>match.id==='existing_calendar_sentinel'),false);
}

// 11. Prova indipendente dell'ottimo globale su due gironi da quattro.
{
  const state=makeState([4,4]);
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  const a=groupMatches(state).filter(match=>match.groupName==='Girone A');
  const b=groupMatches(state).filter(match=>match.groupName==='Girone B');
  const ordersA=validTopologicalOrders(a),ordersB=validTopologicalOrders(b);
  assert.ok(ordersA.length>1&&ordersB.length>1,'Il test indipendente non sta esplorando combinazioni alternative.');
  let bruteBest=null,checked=0;
  for(const orderA of ordersA)for(const orderB of ordersB){
    const objective=adjacencyObjective(orderA.map((match,index)=>[match,orderB[index]]));
    checked++;
    if(!bruteBest||objective[0]<bruteBest[0]||(objective[0]===bruteBest[0]&&objective[1]<bruteBest[1]))bruteBest=objective;
  }
  assert.ok(checked>1,'Nessuna enumerazione esaustiva eseguita.');
  assert.deepEqual([result.consecutiveStats.uniqueTeams,result.consecutiveStats.totalOccurrences],bruteBest,'Esiste una configurazione valida migliore di quella restituita.');
  assert.deepEqual([result.optimality.uniqueConsecutiveTeams,result.optimality.consecutiveOccurrences],bruteBest);
}

// 12. Messaggio esplicito quando il valore ottimo è zero.
{
  const state=makeState([2,2]);
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assert.equal(result.consecutiveStats.uniqueTeams,0);
  assert.equal(result.consecutiveStats.totalOccurrences,0);
  assert.match(result.message,/Nessuna squadra giocherà due partite consecutive/);
}


// 13. Nelle fasi finali una terza partita consecutiva viene scambiata automaticamente quando possibile.
{
  const state=makeState([3,3]);
  state.matches=[
    {id:'g1',phase:'group',groupName:'Girone A',roundIndex:1,date:'2026-07-01',time:'09:00',datetime:'2026-07-01T09:00',field:'Campo 1',homeTeamId:'team_1',awayTeamId:'team_2',goals:[],cards:[],status:'scheduled'},
    {id:'g2',phase:'group',groupName:'Girone A',roundIndex:2,date:'2026-07-01',time:'09:50',datetime:'2026-07-01T09:50',field:'Campo 1',homeTeamId:'team_1',awayTeamId:'team_3',goals:[],cards:[],status:'scheduled'},
    {id:'sf1',phase:'knockout',bracketName:'Finali',roundIndex:10,bracketRoundIndex:1,bracketMatchIndex:1,date:'2026-07-01',time:'10:40',datetime:'2026-07-01T10:40',field:'Campo 1',homeTeamId:'team_1',awayTeamId:'team_4',goals:[],cards:[],status:'scheduled'},
    {id:'sf2',phase:'knockout',bracketName:'Finali',roundIndex:10,bracketRoundIndex:1,bracketMatchIndex:2,date:'2026-07-01',time:'11:30',datetime:'2026-07-01T11:30',field:'Campo 1',homeTeamId:'team_5',awayTeamId:'team_6',goals:[],cards:[],status:'scheduled'}
  ];
  const before=store.calendarConsecutiveStats(state.matches,state.rules,state);
  assert.equal(before.maxRun,3);
  const rebalanced=store.rebalanceResolvedKnockoutSchedule(state);
  const after=store.calendarConsecutiveStats(state.matches,state.rules,state);
  assert.equal(rebalanced.provenOptimal,true);
  assert.ok(rebalanced.combinationsEvaluated>=2);
  assert.equal(rebalanced.changed,true);
  assert.equal(after.maxRun,2);
  assert.ok(after.totalOccurrences<before.totalOccurrences);
  assert.equal(state.matches.find(match=>match.id==='sf1').time,'11:30');
}

// 14. Il pruning resta sicuro in presenza di una pausa che comprime gli indici degli slot utilizzabili.
{
  const state=makeState([3,3],{minRestMinutes:60});
  state.rules.oneDayPauseEnabled=true;
  state.rules.oneDayPauseStart='09:40';
  state.rules.oneDayPauseDuration=60;
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assert.equal(result.optimality?.provenOptimal,true);
  for(const team of state.teams){
    const list=chronological(groupMatches(state).filter(match=>match.homeTeamId===team.id||match.awayTeamId===team.id));
    for(let index=1;index<list.length;index++)assert.ok(minutes(list[index].time)-(minutes(list[index-1].time)+state.rules.matchDuration)>=60,`Riposo con pausa non rispettato per ${team.id}.`);
  }
}

console.log(JSON.stringify({ok:true,scenarios:14},null,2));
