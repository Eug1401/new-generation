import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=process.cwd();
const memory=new Map();
const drawTexts=[];
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
class FakeImage{set src(_){setTimeout(()=>this.onerror?.(new Error('mock')),0);}}
function fakeContext(canvas){
 const ctx={canvas,font:'16px Arial',fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',textBaseline:'alphabetic',shadowColor:'',shadowBlur:0,shadowOffsetY:0,lineJoin:'',lineCap:''};
 for(const n of ['fillRect','beginPath','moveTo','arcTo','closePath','fill','stroke','drawImage','lineTo','arc','save','restore'])ctx[n]=()=>{};
 ctx.fillText=t=>drawTexts.push(String(t));
 ctx.measureText=t=>{const s=Number(String(ctx.font).match(/(\d+(?:\.\d+)?)px/)?.[1]||16);return {width:String(t??'').length*s*.54};};
 ctx.createLinearGradient=()=>({addColorStop(){}});return ctx;
}
function fakeCanvas(){const c={width:0,height:0};const ctx=fakeContext(c);c.getContext=()=>ctx;c.toBlob=cb=>cb(new Blob(['png'],{type:'image/png'}));return c;}
const context={console,setTimeout,clearTimeout,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,Blob,Image:FakeImage,
 localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 document:{createElement:t=>t==='canvas'?fakeCanvas():({}),body:{appendChild(){}},head:{appendChild(){}},getElementById(){return null},querySelector(){return null},querySelectorAll(){return[]},addEventListener(){}},
 navigator:{onLine:true},location:{href:'http://localhost/index.html',origin:'http://localhost',pathname:'/index.html'},dispatchEvent(){return true},CustomEvent};
context.window=context;context.globalThis=context;vm.createContext(context);
for(const f of ['assets/js/store.js','assets/js/ui.js','assets/js/share-images.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});
const store=context.NexoraStore, UI=context.NexoraUI;
let total=0; const results=[];
function test(name,fn){total++;try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
async function atest(name,fn){total++;try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
function baseState(){return {
 rules:{...store.blankRules(),name:'Kings Audit',format:'league',isKingsLeague:true,startDate:'2026-07-01'},
 teams:[
  {id:'a',name:"Associazione Sportiva Internazionale d’Àngelo",logo:'',players:[{id:'p1',name:'Li',number:1},{id:'p7',name:"Gianluca D’Àngelo-Rossi del Borgo",number:7},{id:'same_player',name:'Mario Rossi',number:9}],president:{id:'pres_a',name:'Mario Rossi'},coach:{name:''}},
  {id:'b',name:'Boreale United Football Club dalla Valle',logo:'',players:[{id:'p10',name:"José O’Connor",number:10},{id:'p11',name:'Anna María Núñez',number:11}],president:{id:'pres_b',name:'Presidentessa dal Nome Straordinariamente Lungo'},coach:{name:''}}
 ],matches:[]};}
function match(id,goals=[],status='played'){return {id,phase:'league',round:'Giornata 1',homeTeamId:'a',awayTeamId:'b',date:'2026-07-01',time:'20:00',field:'Campo 1',status,cards:[],goals};}
function norm(raw){return store.normalizeState(raw);}

// 1 single double
{
 const r=baseState();r.matches=[match('m1',[{id:'g1',playerId:'p7',weight:2}])];const s=norm(r),m=s.matches[0];
 test('gol doppio: un evento',()=>assert.equal(m.goals.length,1));
 test('gol doppio: risultato +2',()=>assert.deepEqual({...store.matchGoals(s,m)},{home:2,away:0}));
 test('gol doppio: stats individuale +1',()=>assert.equal(store.selectors.playerStats(s).find(x=>x.playerId==='p7').goals,1));
 test('gol doppio: scoreGoals individuale +2',()=>assert.equal(store.selectors.playerStats(s).find(x=>x.playerId==='p7').scoreGoals,2));
 test('gol doppio: classifica +1',()=>assert.equal(store.selectors.scorers(s).find(x=>x.playerId==='p7').goals,1));
 test('gol doppio: GF squadra +2',()=>assert.equal(store.selectors.officialStandings(s).find(x=>x.teamId==='a').goalsFor,2));
}
// 2 normal + double
{
 const r=baseState();r.matches=[match('m2',[{id:'a',playerId:'p7',weight:1},{id:'b',playerId:'p7',weight:1},{id:'c',playerId:'p7',weight:2}])];const s=norm(r),m=s.matches[0],p=store.selectors.playerStats(s).find(x=>x.playerId==='p7');
 test('2 normali + doppio: risultato 4',()=>assert.equal(store.matchGoals(s,m).home,4));
 test('2 normali + doppio: 3 eventi',()=>assert.equal(m.goals.length,3));
 test('2 normali + doppio: 3 gol personali',()=>assert.equal(p.goals,3));
 test('2 normali + doppio: scoreGoals 4',()=>assert.equal(p.scoreGoals,4));
}
// edit/delete/move
{
 let r=baseState();r.matches=[match('m3',[{id:'x',playerId:'p7',weight:1}])];let s=norm(r);
 s.matches[0].goals[0].weight=2;s=norm(s);
 test('modifica normale->doppio',()=>assert.equal(store.matchGoals(s,s.matches[0]).home,2));
 s.matches[0].goals[0].weight=1;s=norm(s);
 test('modifica doppio->normale',()=>assert.equal(store.matchGoals(s,s.matches[0]).home,1));
 s.matches[0].goals[0].playerId='p10';s=norm(s);
 test('modifica giocatore associato',()=>assert.deepEqual({...store.matchGoals(s,s.matches[0])},{home:0,away:1}));
 s.matches[0].goals=[];s=norm(s);
 test('eliminazione gol aggiorna risultato',()=>assert.deepEqual({...store.matchGoals(s,s.matches[0])},{home:0,away:0}));
}
// multiple doubles both sides
{
 const r=baseState();r.matches=[match('m4',[{id:'1',playerId:'p7',weight:2},{id:'2',playerId:'p7',weight:2},{id:'3',playerId:'p10',weight:2},{id:'4',playerId:'p11',weight:2}])];const s=norm(r),m=s.matches[0];
 test('più doppi entrambe squadre: risultato',()=>assert.deepEqual({...store.matchGoals(s,m)},{home:4,away:4}));
 test('più doppi: giocatore conta eventi',()=>assert.equal(store.selectors.scorers(s).find(x=>x.playerId==='p7').goals,2));
}
// presidents and same name
{
 const r=baseState();r.matches=[match('m5',[{id:'p',playerId:'pres_a',weight:2},{id:'q',playerId:'same_player',weight:1},{id:'r',playerId:'pres_b',weight:1}])];const s=norm(r),m=s.matches[0];
 test('presidente peso forzato 1',()=>assert.equal(m.goals.find(g=>g.playerId==='pres_a').weight,1));
 test('presidente risultato +1',()=>assert.deepEqual({...store.matchGoals(s,m)},{home:2,away:1}));
 test('presidente escluso marcatori giocatori',()=>assert.ok(!store.selectors.scorers(s).some(x=>x.playerId==='pres_a')));
 test('presidente incluso classifica separata',()=>assert.equal(store.selectors.presidentScorers(s).find(x=>x.presidentId==='pres_a').goals,1));
 test('stesso nome separato per ID',()=>assert.equal(store.selectors.scorers(s).find(x=>x.playerId==='same_player').goals,1));
 test('nome DB presidente invariato',()=>assert.equal(s.teams[0].president.name,'Mario Rossi'));
 test('label dettaglio presidente esatta',()=>assert.equal(store.goalEventLabel(s,m,m.goals.find(g=>g.playerId==='pres_a')),'Mario Rossi (rig.)'));
 test('classifica presidenti senza rig',()=>assert.ok(!UI.presidentStatsTable(store.selectors.presidentScorers(s)).includes('(rig.)')));
}
// full combined order permutations
for(const [idx,goals] of [
 [{id:'n',playerId:'p1',weight:1},{id:'d',playerId:'p7',weight:2},{id:'p',playerId:'pres_a',weight:1}],
 [{id:'p',playerId:'pres_a',weight:1},{id:'d',playerId:'p7',weight:2},{id:'n',playerId:'p1',weight:1}]
].entries()){
 const r=baseState();r.matches=[match('mix'+idx,goals)];const s=norm(r),m=s.matches[0];
 test(`scenario combinato ${idx}: risultato 4`,()=>assert.equal(store.matchGoals(s,m).home,4));
 test(`scenario combinato ${idx}: giocatori +1`,()=>assert.equal(JSON.stringify(store.selectors.scorers(s).map(x=>[x.playerId,x.goals]).sort()),JSON.stringify([['p1',1],['p7',1]].sort())));
 test(`scenario combinato ${idx}: presidente +1`,()=>assert.equal(store.selectors.presidentScorers(s)[0].goals,1));
 test(`scenario combinato ${idx}: card coerente`,()=>{const html=UI.matchCard(s,m,true);assert.ok(html.includes('4 - 0'));assert.ok(html.includes('Mario Rossi (rig.)'));});
}
// live excluded, deletion, persistence
{
 const r=baseState();r.matches=[match('played',[{id:'a',playerId:'p7',weight:2}]),match('live',[{id:'b',playerId:'p7',weight:2}],'live')];let s=norm(r);
 test('live esclusa classifica individuale',()=>assert.equal(store.selectors.scorers(s).find(x=>x.playerId==='p7').goals,1));
 test('live esclusa classifica squadra ufficiale',()=>assert.equal(store.selectors.officialStandings(s).find(x=>x.teamId==='a').goalsFor,2));
 store.save('admin',s);const loaded=store.load('admin');
 test('persistenza locale preserva pesi/eventi',()=>assert.deepEqual(loaded.matches.map(m=>m.goals.map(g=>g.weight)),[[2],[2]]));
 loaded.matches=loaded.matches.filter(m=>m.id!=='played');s=norm(loaded);
 test('eliminazione partita aggiorna classifica',()=>assert.equal(store.selectors.scorers(s).length,0));
}
// corrupted duplicate event id must not duplicate semantic event
{
 const r=baseState();r.matches=[match('dup',[{id:'same-event',playerId:'p7',weight:2},{id:'same-event',playerId:'p7',weight:2}])];const s=norm(r);
 test('ID evento duplicato non viene contato due volte',()=>assert.equal(s.matches[0].goals.length,1));
}
// classic mode double forced normal
{
 const r=baseState();r.rules.isKingsLeague=false;r.matches=[match('classic',[{id:'c',playerId:'p7',weight:2},{id:'p',playerId:'pres_a',weight:1}])];const s=norm(r);
 test('classico: doppio forzato a 1',()=>assert.equal(store.matchGoals(s,s.matches[0]).home,1));
 test('classico: gol presidente rimosso',()=>assert.ok(!s.matches[0].goals.some(g=>g.playerId==='pres_a')));
}
// presentation and image
{
 const r=baseState();r.matches=[match('visual',[{id:'n',playerId:'p1',weight:1},{id:'d',playerId:'p7',weight:2},{id:'p',playerId:'pres_a',weight:1}])];const s=norm(r),m=s.matches[0];
 test('aggregazione mantiene count, scoreValue e doppi distinti',()=>{const row=store.aggregateGoalEvents(s,m).find(x=>x.playerId==='p7');assert.equal(row.count,1);assert.equal(row.scoreValue,2);assert.equal(row.doubleCount,1);});
 test('card mostra presidente e indicazione gol doppio',()=>{const h=UI.matchCard(s,m,true);assert.ok(h.includes('Mario Rossi (rig.)'));assert.ok(!h.includes('Mario Rossi pres. (rig.)'));assert.ok(h.includes('1 gol doppio'));});
 await atest('immagine usa risultato e label coerenti',async()=>{drawTexts.length=0;await context.NGShareImages.generate('match',s,{match:m});const txt=drawTexts.join(' | ');assert.ok(txt.includes('4 - 0'));assert.ok(txt.includes('Mario Rossi (rig.)'));assert.ok(!txt.includes('Mario Rossi pres. (rig.)'));assert.ok(txt.includes('1 gol · 1 doppio'));});
}

const failed=results.filter(x=>!x.ok);
console.log(JSON.stringify({total,passed:total-failed.length,failed:failed.length,failures:failed},null,2));
if(failed.length)process.exitCode=1;
