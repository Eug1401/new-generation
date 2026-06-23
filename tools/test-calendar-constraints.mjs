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

function makeState(sizes=[4,4]){
  const state=store.emptyState();
  const total=sizes.reduce((sum,size)=>sum+size,0);
  state.teams=Array.from({length:total},(_,index)=>({id:`team_${index+1}`,name:`Squadra ${index+1}`,players:[],president:{id:`pres_${index+1}`,name:''},coach:{name:''}}));
  state.rules={...state.rules,format:'groups_knockout',oneDay:true,fieldCount:2,groupFieldPolicy:'fixed_by_group',startDate:'2026-07-01',startTime:'09:00',matchDuration:40,breakMinutes:10,groupConfigs:sizes.map((size,index)=>({name:`Girone ${String.fromCharCode(65+index)}`,size,qualifiers:1})),groupAssignments:{},calendarCustomization:store.defaultCalendarCustomization()};
  return store.normalizeState(state);
}
function groupMatches(state){return state.matches.filter(match=>match.phase==='group');}
function firstRound(state){return groupMatches(state).filter(match=>Number(match.roundIndex)===0).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||(Number(a.field.match(/\d+/)?.[0])||0)-(Number(b.field.match(/\d+/)?.[0])||0)||a.id.localeCompare(b.id));}
function firstMatch(state,teamId){return groupMatches(state).filter(match=>match.homeTeamId===teamId||match.awayTeamId===teamId).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||(Number(a.field.match(/\d+/)?.[0])||0)-(Number(b.field.match(/\d+/)?.[0])||0))[0];}
function pairCount(size){return size*(size-1)/2;}

// 1. Gironi uguali: ciascun girone resta sul proprio campo.
{
  const state=makeState([4,4]);
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  const groups=groupMatches(state);
  assert.equal(groups.length,pairCount(4)+pairCount(4));
  assert.equal(groups.some(match=>match.groupName==='Girone A'&&match.field!=='Campo 1'),false);
  assert.equal(groups.some(match=>match.groupName==='Girone B'&&match.field!=='Campo 2'),false);
}

// 2. Girone più grande: usa il campo libero solo quando l'altro girone non gioca nello slot.
{
  const state=makeState([5,4]);
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  const groups=groupMatches(state);
  assert.equal(groups.length,pairCount(5)+pairCount(4));
  const borrowed=groups.filter(match=>(match.groupName==='Girone A'&&match.field==='Campo 2')||(match.groupName==='Girone B'&&match.field==='Campo 1'));
  assert.ok(borrowed.length>0,'Il campo libero non è mai stato usato dal girone più grande.');
  for(const match of borrowed){
    const owner=match.field==='Campo 1'?'Girone A':'Girone B';
    assert.equal(groups.some(other=>other.id!==match.id&&other.groupName===owner&&other.date===match.date&&other.time===match.time),false,'Un campo è stato preso mentre il suo girone aveva una partita nello stesso slot.');
  }
  const pairs=new Set(groups.map(match=>[match.homeTeamId,match.awayTeamId].sort().join('|')));
  assert.equal(pairs.size,groups.length,'Sono presenti partite duplicate.');
}

// Base deterministica per i vincoli.
const baseline=makeState([4,4]);
assert.equal(store.generateCalendar(baseline,{preserveResults:false}).ok,true);
const baselineRound=firstRound(baseline);
assert.equal(baselineRound.length,4);

// 3. Orario esatto di esordio.
{
  const state=makeState([4,4]);
  const teamId=baselineRound[0].homeTeamId;
  state.rules.calendarCustomization.teamDebuts=[{id:'exact_1',teamId,kind:'exactTime',value:'10:40',mode:'hard'}];
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assert.equal(firstMatch(state,teamId).time,'10:40');
}

// 4. Posizione complessiva nella prima giornata.
{
  const state=makeState([4,4]);
  const teamId=baselineRound[0].homeTeamId;
  state.rules.calendarCustomization.teamDebuts=[{id:'position_1',teamId,kind:'firstRoundPosition',value:'4',mode:'hard'}];
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  const ordered=firstRound(state);
  assert.equal(ordered.findIndex(match=>match.homeTeamId===teamId||match.awayTeamId===teamId)+1,4);
}

// 5. Più vincoli compatibili.
{
  const state=makeState([4,4]);
  const teamId=baselineRound[0].homeTeamId;
  state.rules.calendarCustomization.teamDebuts=[
    {id:'multi_time',teamId,kind:'exactTime',value:'10:40',mode:'hard'},
    {id:'multi_position',teamId,kind:'firstRoundPosition',value:'4',mode:'hard'}
  ];
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assert.equal(firstMatch(state,teamId).time,'10:40');
  assert.equal(firstRound(state).findIndex(match=>match.homeTeamId===teamId||match.awayTeamId===teamId)+1,4);
}

// 6. Vincoli incompatibili: due partite diverse nella stessa posizione.
{
  const state=makeState([4,4]);
  const teamA=baselineRound[0].homeTeamId;
  const teamB=baselineRound[1].homeTeamId;
  state.rules.calendarCustomization.teamDebuts=[
    {id:'bad_position_a',teamId:teamA,kind:'firstRoundPosition',value:'1',mode:'hard'},
    {id:'bad_position_b',teamId:teamB,kind:'firstRoundPosition',value:'1',mode:'hard'}
  ];
  const preview=store.previewCalendar(state);
  assert.equal(preview.ok,false);
  assert.ok((preview.conflicts||[]).some(conflict=>/già richiesta|posizione/i.test(conflict.message)));
}

// 7. Wizard: passaggi, soli due tipi di vincolo e navigazione persistente nel draft.
{
  const source=fs.readFileSync(path.join(root,'assets/js/admin-rules.js'),'utf8');
  assert.match(source,/Prerequisiti','Preferenze','Prima giornata','Vincoli','Anteprima/);
  assert.match(source,/data-add-debut-time/);
  assert.match(source,/data-add-first-position/);
  assert.doesNotMatch(source,/data-add-unav|data-add-fieldblock/);
  assert.match(source,/syncWizardFromDom\(\).*wizard\.step=Math\.max/s);
  assert.match(source,/if\(wizard\.step===3\)\{runPreview\(\)/);
}

// 8. Anteprima non persistente: il calendario esistente non viene sovrascritto.
{
  const state=makeState([4,4]);
  state.matches=[{id:'existing_calendar_sentinel',phase:'league',round:'Vecchio calendario',roundIndex:0,date:'2026-01-01',time:'09:00',field:'Campo 1',homeTeamId:'team_1',awayTeamId:'team_2',goals:[],cards:[],status:'scheduled'}];
  const before=JSON.stringify(state.matches);
  const preview=store.previewCalendar(state);
  assert.equal(preview.ok,true,preview.message);
  assert.equal(JSON.stringify(state.matches),before);
  assert.equal(preview.notPersisted,true);
}

// 9. Rigenerazione completa: nessuna partita della generazione precedente resta nel nuovo calendario.
{
  const state=makeState([4,4]);
  assert.equal(store.generateCalendar(state,{preserveResults:false}).ok,true);
  const oldIds=new Set(state.matches.map(match=>match.id));
  state.rules.calendarCustomization.teamDebuts=[{id:'regen_position',teamId:baselineRound[0].homeTeamId,kind:'firstRoundPosition',value:'4',mode:'hard'}];
  const result=store.generateCalendar(state,{preserveResults:false});
  assert.equal(result.ok,true,result.message);
  assert.equal(state.matches.some(match=>oldIds.has(match.id)),false);
}

console.log(JSON.stringify({ok:true,scenarios:9},null,2));
