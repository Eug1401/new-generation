import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const memory=new Map();
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
const context={console,setTimeout,clearTimeout,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{},navigator:{onLine:true},location:{pathname:'/admin-rules.html'},dispatchEvent(){return true},CustomEvent};
context.window=context;
context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8'),context,{filename:'assets/js/store.js'});
const store=context.NexoraStore;

function team(i){return {id:`team_${i}`,name:`Team ${i}`,logo:'',players:[{id:`player_${i}`,name:`Player ${i}`}],president:{id:`pres_${i}`,name:''},coach:{name:''}};}
function baseState(){
  const s=store.emptyState();
  s.rules.format='groups_knockout';
  s.rules.oneDay=true;
  s.rules.startDate='2026-07-01';
  s.rules.startTime='09:00';
  s.rules.fieldCount=2;
  s.rules.matchDuration=30;
  s.rules.breakMinutes=10;
  s.rules.groupConfigs=[{name:'Girone A',size:4,qualifiers:2},{name:'Girone B',size:4,qualifiers:2}];
  s.teams=Array.from({length:8},(_,i)=>team(i+1));
  s.rules.groupAssignments=Object.fromEntries(s.teams.map((t,i)=>[t.id,i<4?'Girone A':'Girone B']));
  return store.normalizeState(s);
}

const s=baseState();
assert.equal(s.matches.length,0,'uno stato nuovo non deve contenere partite');
s.rules.calendarCustomization=store.normalizeCalendarCustomization({firstRoundLocks:[{groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',requiredField:'Campo 1',requiredTime:'09:00',mode:'hard'}],minRestMinutes:10});

const preview=store.previewCalendar(s);
assert.equal(preview.ok,true,preview.message);
assert.equal(preview.previewMatches.length,15);
assert.equal(s.matches.length,0,'la preview non deve salvare partite nello stato sorgente');

const generated=store.generateCalendar(s,{preserveResults:false});
assert.equal(generated.ok,true,generated.message);
assert.equal(s.matches.length,15);
const locked=s.matches.find(m=>m.manualLock);
assert.equal(locked.homeTeamId,'team_1');
assert.equal(locked.awayTeamId,'team_2');
assert.equal(locked.round,'Girone A · Giornata 1');
assert.equal(locked.field,'Campo 1');
assert.equal(locked.time,'09:00');

const broken=baseState();
broken.rules.calendarCustomization=store.normalizeCalendarCustomization({firstRoundLocks:[{groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',mode:'hard'},{groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_3',mode:'hard'}]});
const brokenPreview=store.previewCalendar(broken);
assert.equal(brokenPreview.ok,false,'una squadra doppia nella prima giornata deve bloccare la preview');
assert.equal(brokenPreview.status,'SIMPLIFICATION_AVAILABLE');
assert.ok(Array.isArray(brokenPreview.conflicts)&&brokenPreview.conflicts.length>0,'i conflitti devono essere strutturati');

const preferredImpossible=baseState();
preferredImpossible.rules.calendarCustomization=store.normalizeCalendarCustomization({firstRoundLocks:[{groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',requiredDate:'2026-07-02',mode:'preferred'}]});
const preferredPreview=store.previewCalendar(preferredImpossible);
assert.equal(preferredPreview.ok,false,'una preferenza di slot impossibile deve bloccare la proposta personalizzata');
assert.equal(preferredPreview.status,'SIMPLIFICATION_AVAILABLE');
assert.equal(preferredImpossible.matches.length,0,'la proposta personalizzata non fattibile non deve salvare partite');
const simplifiedPreferred=store.previewSimplifiedCalendar(preferredImpossible);
assert.equal(simplifiedPreferred.ok,true,simplifiedPreferred.message);
assert.equal(simplifiedPreferred.status,'SIMPLIFIED_SOLUTION');
assert.equal(simplifiedPreferred.simplificationLevel,2,'deve usare il primo livello sufficiente, non saltare al calendario essenziale');
assert.ok(simplifiedPreferred.relaxedPreferences.some(r=>/Accoppiamento preferito/.test(r.rule)),'la preferenza rilassata deve essere dichiarata');
assert.equal(preferredImpossible.matches.length,0,'la preview semplificata non deve salvare partite');

const hardImpossible=baseState();
hardImpossible.rules.calendarCustomization=store.normalizeCalendarCustomization({firstRoundLocks:[{groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',requiredDate:'2026-07-02',mode:'hard'}]});
const hardSimplified=store.previewSimplifiedCalendar(hardImpossible);
assert.equal(hardSimplified.ok,false,'un vincolo obbligatorio impossibile non deve essere rimosso automaticamente');
assert.equal(hardSimplified.status,'NO_SOLUTION');
assert.equal(hardImpossible.rules.calendarCustomization.firstRoundLocks[0].mode,'hard');

const minDebut=baseState();
minDebut.rules.calendarCustomization=store.normalizeCalendarCustomization({teamDebuts:[{teamId:'team_1',kind:'minTime',value:'10:00',mode:'hard'}]});
const minDebutPreview=store.previewCalendar(minDebut);
assert.equal(minDebutPreview.ok,true,minDebutPreview.message);
const team1First=[...minDebutPreview.previewMatches].filter(m=>m.phase==='group'&&(m.homeTeamId==='team_1'||m.awayTeamId==='team_1')).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||String(a.field).localeCompare(String(b.field)))[0];
assert.ok(team1First.time>='10:00','la prima partita di team_1 non deve iniziare prima delle 10:00');
assert.ok(minDebutPreview.ruleReport.debutChecks.some(c=>c.rule==='Orario minimo'&&c.ok),'il report deve dichiarare applicato l orario minimo');

const positionDebut=baseState();
positionDebut.rules.calendarCustomization=store.normalizeCalendarCustomization({teamDebuts:[{teamId:'team_1',kind:'firstRoundPosition',value:'2',mode:'hard'}]});
const positionPreview=store.previewCalendar(positionDebut);
assert.equal(positionPreview.ok,true,positionPreview.message);
const groupAFirst=positionPreview.previewMatches.filter(m=>m.phase==='group'&&m.groupName==='Girone A'&&Number(m.roundIndex)===0).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||String(a.field).localeCompare(String(b.field)));
assert.ok(groupAFirst[1].homeTeamId==='team_1'||groupAFirst[1].awayTeamId==='team_1','team_1 deve esordire nella seconda partita cronologica del Girone A');
assert.ok(positionPreview.ruleReport.debutChecks.some(c=>c.rule==='Posizione giornata 1'&&c.ok),'il report deve dichiarare applicata la posizione di esordio');

const impossibleDebut=baseState();
impossibleDebut.rules.calendarCustomization=store.normalizeCalendarCustomization({teamDebuts:[{teamId:'team_1',kind:'firstRoundPosition',value:'1',mode:'hard'},{teamId:'team_1',kind:'minTime',value:'16:00',mode:'hard'}]});
const impossibleDebutPreview=store.previewCalendar(impossibleDebut);
assert.equal(impossibleDebutPreview.ok,false,'posizione iniziale e orario minimo incompatibile devono bloccare la preview');
assert.equal(impossibleDebut.matches.length,0,'una preview con vincoli di esordio incompatibili non deve salvare partite');

const fieldEquality=baseState();
fieldEquality.rules.calendarCustomization=store.normalizeCalendarCustomization({fieldBlocks:[{field:'Campo 1',date:'2026-07-01',time:'',mode:'hard'}]});
const fieldEqualityPreview=store.previewCalendar(fieldEquality);
assert.equal(fieldEqualityPreview.ok,true,'Campo 1 bloccato non deve essere un vincolo bloccante se Campo 2 e disponibile');
assert.ok(fieldEqualityPreview.previewMatches.every(m=>m.field==='Campo 2'),'con Campo 1 bloccato il calendario puo usare Campo 2');
assert.ok(!(fieldEqualityPreview.ruleReport?.warnings||[]).some(w=>w.rule==='Campo 1'),'Campo 1 non deve comparire come preferenza o avviso');

const timeoutPreview=store.previewCalendar(baseState(),{forceTimeout:true,maxMs:1});
assert.equal(timeoutPreview.status,'TIMEOUT','il timeout deve essere distinto dall infattibilita');
const technical=store.generateCalendar(null);
assert.equal(technical.status,'TECHNICAL_ERROR','un errore tecnico deve essere distinto dall infattibilita');

const stale=store.normalizeState(JSON.parse(JSON.stringify(s)));
stale.rules.matchDuration=45;
const before=stale.matches.length;
const repaired=store.repairState(stale);
assert.equal(stale.matches.length,before,'repairState non deve rigenerare calendario');
assert.match(repaired.message,/nessuna rigenerazione automatica/i);

const shareSource=fs.readFileSync(path.join(root,'assets/js/share-images.js'),'utf8');
assert.match(shareSource,/window\.NGShareImages/,'modulo immagini pubblico esposto');
assert.match(shareSource,/navigator\.share/,'condivisione nativa tramite Web Share API presente');
assert.match(shareSource,/canvas\.toBlob/,'export immagine PNG tramite canvas presente');

const simulationSource=fs.readFileSync(path.join(root,'assets/js/admin-simulation.js'),'utf8');
assert.match(simulationSource,/const FORMATS=\['groups_knockout','league_knockout'\]/,'la simulazione espone solo i due formati ammessi');
assert.doesNotMatch(simulationSource,/league:\{title/,'il formato legacy league non deve essere selezionabile');
assert.doesNotMatch(simulationSource,/(^|[,{]\s*)knockout:\{title/,'il formato legacy knockout puro non deve essere selezionabile');

const adminRulesSource=fs.readFileSync(path.join(root,'assets/js/admin-rules.js'),'utf8');
assert.match(adminRulesSource,/new-generation-calendar-draft-v1/,'bozza calendario persistita con chiave dedicata');
assert.match(adminRulesSource,/data-calendar-save-draft/,'azione UI per salvare la bozza presente');
assert.match(adminRulesSource,/data-calendar-clear-draft/,'azione UI per eliminare la bozza presente');
assert.match(adminRulesSource,/Impossibile generare il calendario personalizzato/,'pannello di infattibilita presente');
assert.match(adminRulesSource,/Conferma e genera proposta semplificata/,'conferma esplicita per semplificazione presente');
assert.match(adminRulesSource,/data-calendar-confirm-simplify/,'azione UI per confermare la semplificazione presente');
assert.ok(adminRulesSource.includes('localStorage.setItem(DRAFT_KEY'),'salvataggio bozza in localStorage presente');
assert.ok(adminRulesSource.includes('localStorage.removeItem(DRAFT_KEY'),'eliminazione bozza in localStorage presente');

console.log(JSON.stringify({ok:true,manualPreview:true,noAutoRepair:true,firstRoundLock:true,shareModuleStatic:true,simulationFormats:true,draftPersistence:true,infeasibleFlow:true,simplifiedPreview:true,hardConflictBlocked:true,debutMinTime:true,debutPosition:true,debutConflict:true,fieldEquality:true,technicalStates:true},null,2));
