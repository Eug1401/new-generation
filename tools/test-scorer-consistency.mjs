import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const memory=new Map();
const drawnTexts=[];
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
class FakeImage{set src(_){setTimeout(()=>this.onerror?.(new Error('mock image')),0);}}
function fakeContext(canvas){
  const ctx={canvas,font:'16px Arial',fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',textBaseline:'alphabetic',shadowColor:'',shadowBlur:0,shadowOffsetY:0,lineJoin:'',lineCap:''};
  for(const name of ['fillRect','beginPath','moveTo','arcTo','closePath','fill','stroke','drawImage','lineTo','arc','save','restore'])ctx[name]=()=>{};
  ctx.fillText=(text)=>drawnTexts.push(String(text));
  ctx.measureText=text=>{const size=Number(String(ctx.font).match(/(\d+(?:\.\d+)?)px/)?.[1]||16);return {width:String(text??'').length*size*.54};};
  ctx.createLinearGradient=()=>({addColorStop(){}});
  return ctx;
}
function fakeCanvas(){const canvas={width:0,height:0};const ctx=fakeContext(canvas);canvas.getContext=()=>ctx;canvas.toBlob=cb=>cb(new Blob(['png'],{type:'image/png'}));return canvas;}
const context={
  console,setTimeout,clearTimeout,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,Blob,Image:FakeImage,
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  document:{createElement:tag=>tag==='canvas'?fakeCanvas():({}),body:{appendChild(){}},head:{appendChild(){}},getElementById(){return null},querySelector(){return null},querySelectorAll(){return[]},addEventListener(){}},
  navigator:{onLine:true},location:{href:'http://localhost/index.html',origin:'http://localhost',pathname:'/index.html'},dispatchEvent(){return true},CustomEvent
};
context.window=context;context.globalThis=context;
vm.createContext(context);
for(const file of ['assets/js/store.js','assets/js/ui.js','assets/js/share-images.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const store=context.NexoraStore,UI=context.NexoraUI;

const raw={
  rules:{...store.blankRules(),name:'Kings Consistency Test',format:'league',isKingsLeague:true,startDate:'2026-07-01'},
  teams:[
    {id:'a',name:'Aurora',players:[{id:'p7',name:'Mario Rossi',number:7},{id:'p10',name:'Luca Neri',number:10}],president:{id:'pres_a',name:'Ada Bianchi'},coach:{name:''}},
    {id:'b',name:'Boreale',players:[{id:'p9',name:'Paolo Verdi',number:9}],president:{id:'pres_b',name:'Sara Blu'},coach:{name:''}}
  ],
  matches:[{
    id:'m1',phase:'league',round:'Giornata 1',homeTeamId:'a',awayTeamId:'b',date:'2026-07-01',time:'20:00',field:'Campo 1',status:'played',cards:[],
    goals:[
      {id:'g1',playerId:'p7',weight:1},{id:'g2',playerId:'p7',weight:2},{id:'g3',playerId:'p7',weight:2},
      {id:'gp',playerId:'pres_a',weight:2},
      {id:'gb',playerId:'p9',weight:1}
    ]
  }]
};
const state=store.normalizeState(raw),match=state.matches[0];
const presidentGoal=match.goals.find(g=>g.playerId==='pres_a');
assert.equal(presidentGoal.weight,1,'un gol del presidente deve essere normalizzato a peso 1');
assert.equal(store.eventScoreWeight(state,{playerId:'pres_a',weight:2}),1,'il presidente non può mai valere 2');
assert.equal(store.goalEventLabel(state,match,presidentGoal),'Ada Bianchi (rig.)','etichetta gol presidente non coerente');

const score=store.matchGoals(state,match);
assert.deepEqual({...score},{home:6,away:1},'risultato ponderato Kings errato');
const standings=store.selectors.officialStandings(state);
const homeRow=standings.find(r=>r.teamId==='a'),awayRow=standings.find(r=>r.teamId==='b');
assert.equal(homeRow.goalsFor,6);assert.equal(homeRow.goalsAgainst,1);assert.equal(homeRow.points,3);
assert.equal(awayRow.goalsFor,1);assert.equal(awayRow.goalsAgainst,6);
const phase=store.selectors.teamPhaseStats(state,'a');
assert.equal(phase.total.goalsFor,6,'le statistiche squadra devono usare il peso 2');

const player=store.selectors.playerStats(state).find(r=>r.playerId==='p7');
assert.equal(player.goals,3,'la classifica marcatori deve contare ogni evento come un solo gol');
assert.equal(player.scoreGoals,5,'scoreGoals deve conservare il valore nel risultato');
const scorer=store.selectors.scorers(state).find(r=>r.playerId==='p7');
assert.equal(scorer.goals,3);
const president=store.selectors.presidentStats(state).find(r=>r.presidentId==='pres_a');
assert.equal(president.goals,1);assert.equal(president.scoreGoals,1);assert.equal(president.played,1);
assert.equal(store.selectors.presidentScorers(state)[0].presidentId,'pres_a','classifica presidenti non aggiornata');
const totals=store.selectors.stats(state);
assert.equal(totals.goals,5,'totale gol reali errato');assert.equal(totals.scoreGoals,7,'totale punteggio ponderato errato');

const aggregate=store.aggregateGoalEvents(state,match);
const mario=aggregate.find(r=>r.playerId==='p7');
assert.equal(mario.count,3);assert.equal(mario.scoreValue,5);assert.deepEqual([...mario.weights],[1,2]);
const presRow=aggregate.find(r=>r.playerId==='pres_a');
assert.equal(presRow.count,1);assert.equal(presRow.scoreValue,1);assert.equal(presRow.label,'Ada Bianchi (rig.)');

const card=UI.matchCard(state,match,true);
for(const text of ['6 - 1','#7 Mario Rossi ×3','Ada Bianchi (rig.)'])assert.ok(card.includes(text),`card partita non contiene: ${text}`);
assert.ok(!card.includes('5 pt')&&!card.includes('5 punti'),'il peso 2 non deve essere mostrato come gol aggiuntivi nei marcatori');
const presidentTable=UI.presidentStatsTable(store.selectors.presidentScorers(state));
assert.ok(presidentTable.includes('Ada Bianchi')&&presidentTable.includes('>1<'),'tabella presidenti incoerente');
const scorerTable=UI.playerStatsTable(store.selectors.scorers(state));
assert.ok(scorerTable.includes('Mario Rossi')&&scorerTable.includes('>3<'),'tabella marcatori deve mostrare 3, non 5');

await context.NGShareImages.generate('match',state,{match});
assert.ok(drawnTexts.join(' ').includes('Ada Bianchi (rig.)'),'export immagine non usa l etichetta coerente del presidente: '+JSON.stringify(drawnTexts.filter(x=>x.includes('Ada')||x.includes('Bianchi')||x.includes('pres'))));
assert.ok(drawnTexts.includes('6 - 1'),'export immagine non usa il risultato ponderato');

const adminSource=fs.readFileSync(path.join(root,'assets/js/admin-matches.js'),'utf8');
for(const token of ['data-goal-player-search','/^\\d+$/.test(q)','String(p.number??\'\').startsWith(q)','name="goalDoubleCount"','data-goal-double-count-picker','presidentGoalLabel','participant.type===\'president\''])assert.ok(adminSource.includes(token),`admin: manca ${token}`);
const reportsSource=fs.readFileSync(path.join(root,'assets/js/admin-reports.js'),'utf8');
assert.ok(reportsSource.includes('store.aggregateGoalEvents?store.aggregateGoalEvents(s,m)'), 'PDF report non aggrega i marcatori con la logica comune');
assert.ok(reportsSource.includes('store.getParticipant(s,c.playerId)'), 'PDF report cartellini non usa i partecipanti correnti');

console.log(JSON.stringify({ok:true,score,playerGoals:player.goals,playerScoreGoals:player.scoreGoals,presidentGoals:president.goals,presidentLabel:presRow.label,standingsGF:homeRow.goalsFor},null,2));
