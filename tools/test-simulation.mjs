import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const memory=new Map();
const localStorage={
  getItem:key=>memory.has(key)?memory.get(key):null,
  setItem:(key,value)=>memory.set(key,String(value)),
  removeItem:key=>memory.delete(key),
  key:index=>[...memory.keys()][index]||null,
  get length(){return memory.size;}
};
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
const context={console,setTimeout,clearTimeout,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,localStorage,sessionStorage:localStorage,CustomEvent,navigator:{onLine:true},location:{pathname:'/admin.html'},document:{},dispatchEvent(){return true;}};
context.window=context;
context.globalThis=context;
vm.createContext(context);
for(const file of ['assets/js/store.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const store=context.NexoraStore;
context.NexoraUI={esc:value=>String(value??''),logo:team=>`<span>${team?.name||''}</span>`,injectTeamLogoStyles(){}};
context.NexoraAdmin={state:()=>store.load('admin')};
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/admin-simulation.js'),'utf8'),context,{filename:'assets/js/admin-simulation.js'});
const sim=context.NGTournamentSimulation;
assert.ok(sim,'Modulo simulazione non caricato');

const clone=value=>JSON.parse(JSON.stringify(value));
const makeExistingState=()=>{
  const s=store.emptyState();
  s.articles=[{id:'article_keep',title:'Articolo da mantenere',body:'Non deve cambiare',status:'published',createdAt:'2026-01-01T10:00:00.000Z',updatedAt:'2026-01-01T10:00:00.000Z'}];
  s.teams=Array.from({length:10},(_,i)=>({
    id:`existing_${i+1}`,
    name:`Squadra Esistente ${i+1}`,
    logo:i===0?'':`assets/simulation/teams/${sim.TEAM_BLUEPRINTS[i%8].logo.split('/').pop()}`,
    players:Array.from({length:3},(__,j)=>({id:`old_${i}_${j}`,name:`Vecchio ${i}-${j}`,number:j+2,birthYear:'2000'})),
    president:{id:`pres_${i}`,name:i%2?`Presidente ${i+1}`:''},
    coach:{name:`Coach ${i+1}`}
  }));
  return store.normalizeState(s);
};

const formats=['league','knockout','groups_knockout','league_knockout'];
const results=[];
const confirmedRunOptions=options=>({
  ...options,
  generatedTeamCount:8,
  presidentMode:options.kings?'default_per_team':'none',
  replaceTournamentConfirmed:true,
  replacePlayersConfirmed:options.teamMode==='existing',
  replaceTeamsConfirmed:options.teamMode!=='existing',
  requestSource:'automated-test'
});
for(const format of formats){
  for(const duration of ['one_day','multi_day']){
    for(const kings of [false,true]){
      const source=store.normalizeState({...store.emptyState(),articles:[{id:'a1',title:'Articolo invariato',body:'x',status:'published'}]});
      const built=sim.buildSimulation(source,{teamMode:'generated',format,kings,duration},`test_${format}_${duration}_${kings}`);
      assert.equal(built.validation.ok,true);
      assert.equal(built.state.teams.length,8);
      assert.equal(built.state.teams.reduce((n,t)=>n+t.players.length,0),40);
      assert.equal(built.state.matches.length,{league:28,knockout:7,groups_knockout:15,league_knockout:35}[format]);
      assert.equal(JSON.stringify(built.state.articles),JSON.stringify(source.articles));
      assert.ok(built.validation.winnerId);
      for(const match of built.state.matches){
        assert.equal(String(match.winnerTeamId||''),String(store.winnerId(built.state,match)||''));
        const redMinutes=new Map((match.cards||[]).filter(card=>card.type==='red').map(card=>[card.playerId,Number(card.minute)||0]));
        assert.ok((match.goals||[]).every(goal=>!redMinutes.get(goal.playerId)||Number(goal.minute)<=redMinutes.get(goal.playerId)));
      }
      if(kings)assert.ok(built.state.teams.every(t=>t.president?.name));
      const audit=store.auditDataState(built.state);
      assert.equal(audit.ok,true,JSON.stringify(audit.issues));
      assert.ok(audit.snapshot?.stats?.matches===built.state.matches.length);
      results.push(`${format}/${duration}/kings=${kings}`);
    }
  }
}

const existing=makeExistingState();
const selected=existing.teams.slice(1,9).map(t=>t.id);
const existingBuilt=sim.buildSimulation(existing,{teamMode:'existing',selectedTeamIds:selected,format:'groups_knockout',kings:true,duration:'multi_day'},'test_existing');
assert.deepEqual(existingBuilt.state.teams.map(t=>t.id),selected);
assert.ok(existingBuilt.state.teams.every(t=>t.players.length===5));
assert.ok(existingBuilt.state.teams.every(t=>t.logo));
assert.ok(existingBuilt.state.teams.every(t=>t.president?.name));
assert.equal(JSON.stringify(existingBuilt.state.articles),JSON.stringify(existing.articles));

assert.throws(()=>sim.buildSimulation(existing,{teamMode:'existing',selectedTeamIds:selected.slice(0,7),format:'league',duration:'multi_day'}),/esattamente 8/);
const invalid=clone(existingBuilt.state);
invalid.teams[0].players.pop();
invalid.matches[0].homeTeamId=invalid.matches[0].awayTeamId;
invalid.matches[1].goals[0]&&(invalid.matches[1].goals[0].playerId='orphan');
invalid.matches[2].winnerTeamId='winner_not_in_match';
const chronologyMatch=invalid.matches.find(m=>(m.goals||[]).length);
if(chronologyMatch){const scorer=chronologyMatch.goals[0].playerId;chronologyMatch.goals[0].minute=20;chronologyMatch.cards.push({id:'late_red',playerId:scorer,type:'red',minute:10});}
const invalidReport=sim.validateSimulation(invalid,{options:existingBuilt.options,originalArticles:existing.articles});
assert.equal(invalidReport.ok,false);
assert.ok(invalidReport.errors.some(x=>x.includes('esattamente 5')));
assert.ok(invalidReport.errors.some(x=>x.includes('contro sé stessa')));
assert.ok(invalidReport.errors.some(x=>x.includes('vincitore registrato')));
assert.ok(invalidReport.errors.some(x=>x.includes('dopo l\'espulsione')));

// Errori nelle fasi di costruzione non devono modificare lo stato sorgente.
const pristine=makeExistingState();
const pristineJson=JSON.stringify(pristine);
const originalGenerateCalendar=store.generateCalendar;
store.generateCalendar=()=>({ok:false,message:'forced calendar failure'});
assert.throws(()=>sim.buildSimulation(pristine,{teamMode:'generated',format:'league',duration:'multi_day'}),/forced calendar failure/);
store.generateCalendar=originalGenerateCalendar;
assert.equal(JSON.stringify(pristine),pristineJson);
const originalResolve=store.autoResolveKnockout;
store.autoResolveKnockout=()=>{throw new Error('forced bracket failure');};
assert.throws(()=>sim.buildSimulation(pristine,{teamMode:'generated',format:'knockout',duration:'one_day'}),/forced bracket failure/);
store.autoResolveKnockout=originalResolve;
assert.equal(JSON.stringify(pristine),pristineJson);

// Il motore rifiuta avvii esterni privi delle conferme finali del wizard.
const beforeUnconfirmed=JSON.stringify(store.load('admin'));
await assert.rejects(sim.run({teamMode:'generated',format:'knockout',kings:false,duration:'one_day'}),/Conferma la sostituzione/i);
assert.equal(JSON.stringify(store.load('admin')),beforeUnconfirmed);

// Commit locale completo e prevenzione di due avvii contemporanei.
store.save('admin',store.normalizeState({...store.emptyState(),articles:[{id:'keep',title:'Keep',body:'Body',status:'published'}]}));
const first=sim.run(confirmedRunOptions({teamMode:'generated',format:'knockout',kings:false,duration:'one_day'}));
const second=sim.run(confirmedRunOptions({teamMode:'generated',format:'league',kings:false,duration:'multi_day'})).then(()=>false,err=>/già in corso/.test(String(err.message||err)));
assert.equal(await second,true);
const committed=await first;
assert.equal(store.load('admin')._simulationOperationId,committed.operationId);
assert.equal(store.load('public')._simulationOperationId,committed.operationId);

// Errore backend dopo il commit locale: lo snapshot deve essere ripristinato.
const beforeRollback=store.normalizeState({...store.emptyState(),teams:[{id:'safe_team',name:'Safe Team',logo:'safe.svg',players:[]}],articles:[{id:'safe_article',title:'Safe',body:'Safe',status:'published'}]});
store.save('admin',beforeRollback);
store.save('public',beforeRollback);
context.NEW_GENERATION_SUPABASE={ENABLED:true};
context.NG_SUPABASE_CLIENT={};
context.NG_FORCE_REMOTE_SAVE=async state=>{if(state._simulationOperationId)throw new Error('forced remote failure');return true;};
context.NG_FLUSH_REMOTE_SAVE=async()=>true;
let rollbackError='';
try{await sim.run(confirmedRunOptions({teamMode:'generated',format:'knockout',kings:false,duration:'one_day'}));}catch(err){rollbackError=String(err.message||err);}
assert.match(rollbackError,/rollback completo/i);
assert.equal(store.load('admin').teams[0].id,'safe_team');
assert.equal(store.load('admin').articles[0].id,'safe_article');

delete context.NEW_GENERATION_SUPABASE;
delete context.NG_SUPABASE_CLIENT;
delete context.NG_FORCE_REMOTE_SAVE;
delete context.NG_FLUSH_REMOTE_SAVE;

console.log(JSON.stringify({ok:true,generatedCases:results.length,formats,existingTeams:true,eventChronology:true,buildFailureIsolation:true,finalConfirmationGuard:true,doubleStart:true,rollback:true},null,2));
