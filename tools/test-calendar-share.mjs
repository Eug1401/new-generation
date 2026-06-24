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
assert.equal(brokenPreview.status,'INFEASIBLE');
assert.ok(Array.isArray(brokenPreview.conflicts)&&brokenPreview.conflicts.length>0,'i conflitti devono essere strutturati');

const formerlyPreferred=baseState();
formerlyPreferred.rules.calendarCustomization=store.normalizeCalendarCustomization({firstRoundLocks:[{groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',requiredDate:'2026-07-02',mode:'preferred'}]});
assert.equal(formerlyPreferred.rules.calendarCustomization.firstRoundLocks[0].mode,'hard','le vecchie preferenze devono essere convertite in vincoli obbligatori');
const formerlyPreferredPreview=store.previewCalendar(formerlyPreferred);
assert.equal(formerlyPreferredPreview.ok,false,'un vecchio vincolo preferito impossibile deve essere trattato come obbligatorio');
assert.equal(formerlyPreferredPreview.status,'INFEASIBLE');
assert.equal(formerlyPreferred.matches.length,0,'una proposta non fattibile non deve salvare partite');
assert.equal(typeof store.previewSimplifiedCalendar,'undefined','la generazione semplificata deve essere rimossa');
assert.equal(typeof store.generateAlternativeCalendar,'undefined','la generazione alternativa deve essere rimossa');

const exactDebut=baseState();
exactDebut.rules.calendarCustomization=store.normalizeCalendarCustomization({teamDebuts:[{teamId:'team_1',kind:'exactTime',value:'10:20',mode:'hard'}]});
const exactDebutPreview=store.previewCalendar(exactDebut);
assert.equal(exactDebutPreview.ok,true,exactDebutPreview.message);
const team1First=[...exactDebutPreview.previewMatches].filter(m=>m.phase==='group'&&(m.homeTeamId==='team_1'||m.awayTeamId==='team_1')).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.time).localeCompare(String(b.time))||String(a.field).localeCompare(String(b.field)))[0];
assert.equal(team1First.time,'10:20','la prima partita di team_1 deve iniziare esattamente alle 10:20');
assert.ok(exactDebutPreview.ruleReport.debutChecks.some(c=>c.rule==='Orario esatto'&&c.ok),'il report deve dichiarare applicato l orario esatto');

const legacyConstraints=store.normalizeCalendarCustomization({
  teamDebuts:[
    {id:'keep_exact',teamId:'team_1',kind:'exactTime',value:'10:20',mode:'hard'},
    {id:'drop_position',teamId:'team_2',kind:'firstRoundPosition',value:'2',mode:'hard'},
    {id:'drop_other',teamId:'team_3',kind:'field',value:'Campo 1',mode:'hard'}
  ],
  teamUnavailability:[{teamId:'team_1',date:'2026-07-01',time:'09:00'}],
  fieldBlocks:[{field:'Campo 1',date:'2026-07-01',time:'09:00'}],
  events:[{date:'2026-07-01',time:'09:00'}]
});
assert.deepEqual(legacyConstraints.teamDebuts.map(rule=>rule.kind),['exactTime'],'solo l orario esatto deve restare nel modello');
assert.equal('teamUnavailability' in legacyConstraints,false);
assert.equal('fieldBlocks' in legacyConstraints,false);
assert.equal('events' in legacyConstraints,false);

const impossibleDebut=baseState();
impossibleDebut.rules.calendarCustomization=store.normalizeCalendarCustomization({
  firstRoundLocks:[{id:'locked_pair',groupName:'Girone A',homeTeamId:'team_1',awayTeamId:'team_2',mode:'hard'}],
  teamDebuts:[
    {id:'time_a',teamId:'team_1',kind:'exactTime',value:'09:00',mode:'hard'},
    {id:'time_b',teamId:'team_2',kind:'exactTime',value:'10:20',mode:'hard'}
  ]
});
const impossibleDebutPreview=store.previewCalendar(impossibleDebut);
assert.equal(impossibleDebutPreview.ok,false,'orari esatti incompatibili per la stessa partita devono bloccare la preview');
assert.equal(impossibleDebut.matches.length,0,'una preview con vincoli incompatibili non deve salvare partite');

const fieldFallback=store.emptyState();
fieldFallback.rules.format='groups_knockout';
fieldFallback.rules.oneDay=true;
fieldFallback.rules.startDate='2026-07-01';
fieldFallback.rules.startTime='09:00';
fieldFallback.rules.fieldCount=2;
fieldFallback.rules.groupFieldPolicy='fixed_by_group';
fieldFallback.rules.matchDuration=30;
fieldFallback.rules.breakMinutes=10;
fieldFallback.rules.groupConfigs=[{name:'Girone A',size:4,qualifiers:1},{name:'Girone B',size:6,qualifiers:1}];
fieldFallback.teams=Array.from({length:10},(_,i)=>team(i+1));
fieldFallback.rules.groupAssignments=Object.fromEntries(fieldFallback.teams.map((t,i)=>[t.id,i<4?'Girone A':'Girone B']));
const fieldFallbackPreview=store.previewCalendar(store.normalizeState(fieldFallback));
assert.equal(fieldFallbackPreview.ok,true,fieldFallbackPreview.message);
const groupMatches=fieldFallbackPreview.previewMatches.filter(m=>m.phase==='group');
const borrowed=groupMatches.filter(m=>m.groupName==='Girone B'&&m.field==='Campo 1');
assert.ok(borrowed.length>0,'il girone più grande deve poter usare il campo libero');
for(const match of borrowed){
  const sameSlot=groupMatches.filter(other=>other.date===match.date&&other.time===match.time);
  assert.ok(sameSlot.some(other=>other.id!==match.id&&other.groupName==='Girone B'&&other.field==='Campo 2'),'il prestito deve avvenire soltanto mentre il campo naturale è occupato');
  assert.equal(sameSlot.some(other=>other.groupName==='Girone A'),false,'il campo del Girone A non può essere prestato quando il proprietario gioca');
}

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
vm.runInContext(shareSource,context,{filename:'assets/js/share-images.js'});
const layoutBuilder=context.NGShareImages?.__test?.buildBracketLayout;
assert.equal(typeof layoutBuilder,'function','helper geometrico del tabellone esposto per i test');
const headerColumns=context.NGShareImages?.__test?.headerColumns;
assert.equal(typeof headerColumns,'function','helper delle colonne intestazione esposto per i test');
for(const width of [1080,1920,2400]){
  const columns=headerColumns(width);
  assert.ok(columns.leftX+columns.leftW+columns.gap<=columns.rightStart+1,`intestazione sovrapposta a ${width}px`);
  assert.ok(columns.leftW>=260&&columns.rightW>=300,`colonne intestazione troppo strette a ${width}px`);
}
const generatedBracket=store.bracketData(s);
const layout=layoutBuilder(generatedBracket);
assert.ok(layout.blocks.length>0,'il layout deve contenere almeno un blocco tabellone');
assert.ok(layout.blocks[0].y>layout.geometry.headerBottom,'il primo blocco non deve sovrapporsi all intestazione');
for(let bi=0;bi<layout.blocks.length;bi++){
  const block=layout.blocks[bi];
  const cardsStart=block.y+layout.geometry.blockTitleHeight+layout.geometry.roundTitleHeight+layout.geometry.titleToCardsGap;
  const all=block.positions.flat();
  assert.equal(all.length,block.rounds.reduce((sum,round)=>sum+round.matches.length,0),'ogni partita deve avere una sola posizione');
  for(const round of block.positions){
    for(let i=0;i<round.length;i++){
      const pos=round[i];
      assert.ok(pos.x>=layout.geometry.sidePadding,'card fuori dal margine sinistro');
      assert.ok(pos.x+layout.geometry.roundWidth<=layout.width-layout.geometry.sidePadding,'card fuori dal margine destro');
      assert.ok(pos.cy-layout.geometry.matchHeight/2>=cardsStart,'card sovrapposta ai titoli del turno');
      assert.ok(pos.cy+layout.geometry.matchHeight/2<=block.y+block.blockHeight-layout.geometry.blockBottomPadding+1,'card oltre il blocco assegnato');
      if(i>0)assert.ok(pos.cy-round[i-1].cy>=layout.geometry.matchHeight+28,'card dello stesso turno sovrapposte');
    }
  }
  if(bi>0)assert.ok(block.y>=layout.blocks[bi-1].y+layout.blocks[bi-1].blockHeight+layout.geometry.blockGap,'blocchi tabellone sovrapposti');
}
const malformedLayout=layoutBuilder({brackets:[{name:'Indici duplicati',rounds:[
  {name:'Semifinali',matches:[{id:'m1',bracketMatchIndex:0},{id:'m2',bracketMatchIndex:0}]},
  {name:'Finale',matches:[{id:'m3',bracketMatchIndex:0}]}
]}]});
assert.equal(malformedLayout.blocks[0].positions.flat().length,3,'gli indici mancanti o duplicati non devono far collassare le card');

const simulationSource=fs.readFileSync(path.join(root,'assets/js/admin-simulation.js'),'utf8');
assert.match(simulationSource,/const FORMATS=\['groups_knockout','league_knockout'\]/,'la simulazione espone solo i due formati ammessi');
assert.doesNotMatch(simulationSource,/league:\{title/,'il formato legacy league non deve essere selezionabile');
assert.doesNotMatch(simulationSource,/(^|[,{]\s*)knockout:\{title/,'il formato legacy knockout puro non deve essere selezionabile');

const adminRulesSource=fs.readFileSync(path.join(root,'assets/js/admin-rules.js'),'utf8');
assert.match(adminRulesSource,/new-generation-calendar-draft-v1/,'bozza calendario persistita con chiave dedicata');
assert.match(adminRulesSource,/data-calendar-save-draft/,'azione UI per salvare la bozza presente');
assert.match(adminRulesSource,/data-calendar-clear-draft/,'azione UI per eliminare la bozza presente');
assert.match(adminRulesSource,/Impossibile generare un calendario valido/,'pannello di infattibilita presente');
assert.doesNotMatch(adminRulesSource,/proposta semplificata|data-calendar-confirm-simplify|preferenze opzionali/i,'la UI non deve più esporre semplificazioni o preferenze');
assert.match(adminRulesSource,/Ricerca del calendario ottimale in corso/,'stato della ricerca esatta presente');
assert.ok(adminRulesSource.includes('localStorage.setItem(DRAFT_KEY'),'salvataggio bozza in localStorage presente');
assert.ok(adminRulesSource.includes('localStorage.removeItem(DRAFT_KEY'),'eliminazione bozza in localStorage presente');

console.log(JSON.stringify({ok:true,manualPreview:true,noAutoRepair:true,firstRoundLock:true,shareModuleStatic:true,bracketImageLayout:true,simulationFormats:true,draftPersistence:true,infeasibleFlow:true,optionalPreferencesRemoved:true,hardConflictBlocked:true,debutExactTime:true,legacyConstraintsRemoved:true,debutConflict:true,fieldFallback:true,technicalStates:true},null,2));
