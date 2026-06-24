import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.cwd();
const storage=new Map();
const domReady=[];
const upserts=[];
let remoteRow=null;
const element=()=>({hidden:false,disabled:false,textContent:'',innerHTML:'',dataset:{},style:{},className:'',classList:{add(){},remove(){},toggle(){}},appendChild(){},remove(){},focus(){},setAttribute(){},removeAttribute(){},addEventListener(){},querySelector(){return element()},querySelectorAll(){return[]}});
const doc={body:element(),head:element(),getElementById(){return element()},createElement(){return element()},querySelector(){return element()},querySelectorAll(){return[]},addEventListener(type,fn){if(type==='DOMContentLoaded')domReady.push(fn)}};
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
const fakeChannel={on(){return this},subscribe(cb){cb?.('SUBSCRIBED');return this},send(){return Promise.resolve({})},unsubscribe(){return Promise.resolve()}};
const client={
 auth:{getSession:async()=>({data:{session:{user:{email:'audit@example.test'}}}}),signOut:async()=>({}),signInWithPassword:async()=>({error:null})},
 from(){return {
  select(){return {eq(){return {maybeSingle:async()=>({data:remoteRow,error:null})}}}},
  upsert:async payload=>{upserts.push(structuredClone(payload));remoteRow={data:structuredClone(payload.data),updated_at:payload.updated_at};return {error:null};}
 }},
 channel(){return fakeChannel},removeChannel(){return Promise.resolve()}
};
const context={console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,Blob,CustomEvent,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),clear:()=>storage.clear()},
 sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:doc,navigator:{onLine:true},location:{pathname:'/admin-matches.html',href:'http://localhost/admin-matches.html',reload(){}},
 addEventListener(){},dispatchEvent(){return true},open(){},alert(){},confirm(){return true},
 NEW_GENERATION_SUPABASE:{ENABLED:true,URL:'https://example.supabase.co',ANON_KEY:'audit-key',TABLE:'app_state',ROW_ID:'main',SAVE_DEBOUNCE_MS:50},
 supabase:{createClient:()=>client}
};
context.window=context;context.globalThis=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8'),context,{filename:'assets/js/store.js'});
const store=context.NexoraStore;
function fixture(){return store.normalizeState({rules:{...store.blankRules(),name:'Kings Sync Audit',format:'league',isKingsLeague:true},teams:[
 {id:'a',name:'Alpha',logo:'',players:[{id:'p7',name:'Mario Rossi',number:7}],president:{id:'pres_a',name:'Mario Rossi'},coach:{name:''}},
 {id:'b',name:'Beta',logo:'',players:[{id:'p10',name:'José O’Connor',number:10}],president:{id:'pres_b',name:'Luisa Bianchi'},coach:{name:''}}
],matches:[{id:'m1',phase:'league',round:'Giornata 1',homeTeamId:'a',awayTeamId:'b',status:'played',goals:[{id:'g1',playerId:'p7',weight:2},{id:'g2',playerId:'pres_a',weight:2}],cards:[]}],articles:[],teamPhotos:[]});}
remoteRow=null;
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/supabase-sync.js'),'utf8'),context,{filename:'assets/js/supabase-sync.js'});
for(const fn of domReady)await fn();
await context.NG_FLUSH_REMOTE_SAVE();
upserts.length=0;
remoteRow=null;

const results=[];let total=0;async function test(name,fn){total++;try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
let state=fixture();
await test('salvataggio remoto preserva evento doppio e normalizza presidente',async()=>{
 upserts.length=0;state={...state,_auditRevision:1};await context.NG_FORCE_REMOTE_SAVE(state);assert.equal(upserts.length,1);const sent=upserts.at(-1).data;const goals=sent.matches[0].goals;assert.equal(goals.length,2);assert.equal(goals.find(g=>g.id==='g1').weight,2);assert.equal(goals.find(g=>g.id==='g2').weight,1);assert.equal(sent.teams[0].president.name,'Mario Rossi');
});
await test('payload remoto e frontend producono conteggi semanticamente uguali',async()=>{
 const received=store.normalizeState(remoteRow.data);const m=received.matches[0];assert.deepEqual({...store.matchGoals(received,m)},{home:3,away:0});assert.equal(store.selectors.scorers(received).find(x=>x.playerId==='p7').goals,1);assert.equal(store.selectors.presidentScorers(received).find(x=>x.presidentId==='pres_a').goals,1);
});
await test('modifica doppio->normale sostituisce il payload precedente',async()=>{
 state.matches[0].goals.find(g=>g.id==='g1').weight=1;state=store.normalizeState(state);await context.NG_FORCE_REMOTE_SAVE(state);const latest=upserts.at(-1).data;assert.equal(latest.matches[0].goals.find(g=>g.id==='g1').weight,1);assert.deepEqual({...store.matchGoals(latest,latest.matches[0])},{home:2,away:0});
});
await test('modifica marcatore mantiene associazione tramite ID, non nome',async()=>{
 state.matches[0].goals.find(g=>g.id==='g1').playerId='p10';state=store.normalizeState(state);await context.NG_FORCE_REMOTE_SAVE(state);const latest=store.normalizeState(upserts.at(-1).data);assert.deepEqual({...store.matchGoals(latest,latest.matches[0])},{home:1,away:1});assert.equal(store.selectors.scorers(latest)[0].playerId,'p10');assert.equal(store.selectors.presidentScorers(latest)[0].presidentId,'pres_a');
});
await test('eliminazione evento rimuove il dato dal payload e dalle classifiche',async()=>{
 state.matches[0].goals=state.matches[0].goals.filter(g=>g.id!=='g2');state=store.normalizeState(state);await context.NG_FORCE_REMOTE_SAVE(state);const latest=store.normalizeState(upserts.at(-1).data);assert.ok(!latest.matches[0].goals.some(g=>g.id==='g2'));assert.equal(store.selectors.presidentScorers(latest).length,0);assert.equal(store.selectors.scorers(latest)[0].goals,1);
});
await test('evento con ID duplicato viene deduplicato prima del database',async()=>{
 const corrupted=fixture();corrupted.matches[0].goals.push({id:'g1',playerId:'p7',weight:2});await context.NG_FORCE_REMOTE_SAVE(corrupted);const latest=upserts.at(-1).data;assert.equal(latest.matches[0].goals.filter(g=>g.id==='g1').length,1);
});

const failed=results.filter(x=>!x.ok);console.log(JSON.stringify({total,passed:total-failed.length,failed:failed.length,results,upsertCount:upserts.length},null,2));process.exit(failed.length?1:0);
