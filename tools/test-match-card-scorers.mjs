import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const memory=new Map();
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
class FakeImage{
  constructor(){this.naturalWidth=1;this.naturalHeight=1;this.width=1;this.height=1;}
  set src(value){const v=String(value||'');if(v.includes('horizontal')){this.naturalWidth=600;this.naturalHeight=160;this.width=600;this.height=160;setTimeout(()=>this.onload?.(),0);return;}if(v.includes('vertical')){this.naturalWidth=160;this.naturalHeight=600;this.width=160;this.height=600;setTimeout(()=>this.onload?.(),0);return;}setTimeout(()=>this.onerror?.(new Error('image mocked')),0);}
}
function fakeContext(canvas){
  const ctx={canvas,font:'16px Arial',fillStyle:'',strokeStyle:'',lineWidth:1,textAlign:'left',textBaseline:'alphabetic',shadowColor:'',shadowBlur:0,shadowOffsetY:0,lineJoin:'',lineCap:''};
  for(const name of ['fillRect','beginPath','moveTo','arcTo','closePath','fill','stroke','drawImage','fillText','lineTo','arc','save','restore'])ctx[name]=()=>{};
  ctx.measureText=text=>{const size=Number(String(ctx.font).match(/(\d+(?:\.\d+)?)px/)?.[1]||16);return {width:String(text??'').length*size*.54};};
  ctx.createLinearGradient=()=>({addColorStop(){}});
  return ctx;
}
function fakeCanvas(){
  const canvas={width:0,height:0};
  const ctx=fakeContext(canvas);
  canvas.getContext=()=>ctx;
  canvas.toBlob=callback=>callback(new Blob(['mock-png'],{type:'image/png'}));
  return canvas;
}
const context={
  console,setTimeout,clearTimeout,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,Blob,Image:FakeImage,
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  document:{createElement:tag=>tag==='canvas'?fakeCanvas():({}),body:{appendChild(){}},getElementById(){return null},addEventListener(){}},
  navigator:{onLine:true},location:{href:'http://localhost/index.html',origin:'http://localhost',pathname:'/index.html'},dispatchEvent(){return true},CustomEvent
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8'),context,{filename:'assets/js/store.js'});
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/share-images.js'),'utf8'),context,{filename:'assets/js/share-images.js'});
const store=context.NexoraStore;

const state=store.emptyState();
state.rules.name='Torneo con denominazione estremamente lunga per il test responsive';
state.rules.format='groups_knockout';
state.rules.isKingsLeague=true;
state.teams=[
  {id:'home',name:'Associazione Sportiva Dilettantistica Real Borgo San Giovanni United',logo:'http://localhost/horizontal-logo.png',players:Array.from({length:14},(_,i)=>({id:`h${i}`,name:`Alessandro Maria De Santis Della Valle ${i+1}`,number:i+1})),president:{id:'ph',name:''},coach:{name:''}},
  {id:'away',name:'Polisportiva Atletico Citta Metropolitana Football Club',logo:'http://localhost/vertical-logo.png',players:Array.from({length:14},(_,i)=>({id:`a${i}`,name:`Giovanni Battista Montemaggiore ${i+1}`,number:i+20})),president:{id:'pa',name:''},coach:{name:''}}
];
const goals=[];
for(let i=0;i<12;i++){const quantity=i===0?18:(i%4)+1;for(let n=0;n<quantity;n++)goals.push({id:`h_${i}_${n}`,playerId:`h${i}`,weight:1});}
for(let i=0;i<10;i++)for(let n=0;n<(i%3)+1;n++)goals.push({id:`a_${i}_${n}`,playerId:`a${i}`,weight:i===2?2:1});
goals.push({id:'own1',ownGoal:true,teamId:'home',weight:1},{id:'own2',ownGoal:true,teamId:'home',weight:1});
state.matches=[{id:'m1',phase:'quarter',round:'Quarti di finale · Secondo turno serale',homeTeamId:'home',awayTeamId:'away',date:'2026-07-18',time:'21:40',field:'Campo Centrale New Generation Arena',referee:'Dott. Alessandro Maria Francesco De Luca',status:'played',goals,cards:[]}];
const normalized=store.normalizeState(state);const match=normalized.matches[0];
const aggregate=store.aggregateGoalEvents(normalized,match);
assert.equal(aggregate.length,23,'ogni marcatore/autogol deve produrre una sola riga aggregata');
const first=aggregate.find(row=>row.playerId==='h0');
assert.equal(first.count,18,'un singolo giocatore deve poter avere molti gol senza righe duplicate');assert.equal(first.number,1);
const repeated=aggregate.find(row=>row.playerId==='h3');
assert.equal(repeated.count,4,'lo stesso giocatore deve essere mostrato una sola volta con quantità 4');
const double=aggregate.find(row=>row.playerId==='a2');
assert.equal(double.count,3);assert.equal(double.scoreValue,6,'i gol Kings di valore doppio devono mantenere il punteggio');
const own=aggregate.find(row=>row.ownGoal&&row.teamId==='home');
assert.equal(own.count,2,'gli autogol della stessa squadra devono essere aggregati');

const result=await context.NGShareImages.generate('match',normalized,{match});
assert.equal(result.width,1080);
assert.ok(result.height>1350,'molti marcatori devono aumentare dinamicamente l altezza del canvas');
assert.equal(result.blob.type,'image/png');

const admin=fs.readFileSync(path.join(root,'assets/js/admin-matches.js'),'utf8');
for(const token of ['data-goal-count-picker','name="goalCount"','data-goal-row-player','mergeDuplicateGoalRow','Numero di gol'])assert.ok(admin.includes(token),`admin marcatori: manca ${token}`);
const css=fs.readFileSync(path.join(root,'assets/css/styles.css'),'utf8');
assert.ok(css.includes('.scorer-editor-row'));assert.ok(css.includes('@media(max-width:480px)'));
console.log(JSON.stringify({ok:true,aggregatedScorers:aggregate.length,canvas:[result.width,result.height],responsiveEditor:true},null,2));
