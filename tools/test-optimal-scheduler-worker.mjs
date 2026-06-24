import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromium=process.env.CHROMIUM_BIN||'/usr/bin/chromium';
const storeSource=fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8');
const workerSource=`self.window=self;self.globalThis=self;${storeSource}\nself.onmessage=event=>{const {requestId,state}=event.data||{};if(!requestId||!state)return;try{const result=self.NexoraStore.previewCalendar(state,{onProgress:progress=>self.postMessage({type:'progress',requestId,progress})});self.postMessage({type:'result',requestId,result});}catch(error){self.postMessage({type:'error',requestId,message:String(error?.message||error||'Errore sconosciuto')});}};`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});

const page=`<!doctype html><html><body><script>
(()=>{
  const state={
    rules:{name:'Test',format:'groups_knockout',groupCount:2,groupConfigs:[{name:'Girone A',size:4,qualifiers:1},{name:'Girone B',size:6,qualifiers:1}],groupAssignments:{},playoffTeams:2,eliminationCompetitions:[],superCup:{enabled:false,homeCompetitionId:'',awayCompetitionId:''},isKingsLeague:false,oneDay:true,fieldCount:2,startDate:'2026-07-01',endDate:'',startTime:'09:00',endTime:'',matchDuration:40,breakMinutes:10,oneDayPauseEnabled:false,oneDayPauseStart:'13:00',oneDayPauseDuration:60,playingDays:[1,2,3,4,5,6,0],groupFieldPolicy:'fixed_by_group',standingsCriteriaOrder:[],calendarCustomization:{version:4,minRestMinutes:0,firstRoundLocks:[],teamDebuts:[]}},
    site:{},teams:[],matches:[],articles:[],teamPhotos:{},calendarSignature:''
  };
  state.teams=Array.from({length:10},(_,index)=>({id:'team_'+(index+1),name:'Squadra '+(index+1),logo:'',players:[],president:{id:'pres_'+(index+1),name:''},coach:{name:''}}));
  state.teams.forEach((team,index)=>state.rules.groupAssignments[team.id]=index<4?'Girone A':'Girone B');
  const originalMatches=JSON.stringify(state.matches);
  const status=window.__schedulerWorkerTest={done:false,error:'',ticks:0,progressEvents:0,result:null,sourceUnchanged:false};
  const timer=setInterval(()=>status.ticks++,5);
  const source=${JSON.stringify(workerSource)};
  const worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  worker.onmessage=event=>{
    const data=event.data||{};
    if(data.type==='progress'){status.progressEvents++;return;}
    if(data.type==='result'){clearInterval(timer);status.result=data.result;status.sourceUnchanged=JSON.stringify(state.matches)===originalMatches;status.done=true;worker.terminate();return;}
    if(data.type==='error'){clearInterval(timer);status.error=data.message||'worker error';status.done=true;worker.terminate();}
  };
  worker.onerror=event=>{clearInterval(timer);status.error=event.message||'worker error';status.done=true;worker.terminate();};
  worker.postMessage({requestId:'browser_exact_test',state});
})();
<\/script></body></html>`;

let browser,client;
class CDPClient{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  async connect(){await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});this.ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error.message)):pending.resolve(message.result);});}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){this.ws.close();}
}
async function waitFor(fn,timeout=60000){const started=Date.now();while(Date.now()-started<timeout){const value=await fn();if(value)return value;await delay(50);}throw new Error('Timeout della prova Web Worker.');}
async function evaluate(expression){const response=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result?.value;}

try{
  const port=await freePort();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ng-scheduler-worker-'));
  browser=spawn(chromium,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  await waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/list`)).ok;}catch{return false;}},10000);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=targets.find(item=>item.type==='page');
  client=new CDPClient(new WebSocket(target.webSocketDebuggerUrl));await client.connect();await client.send('Runtime.enable');await client.send('Page.enable');
  const tree=await client.send('Page.getFrameTree');
  await client.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:page});
  await waitFor(()=>evaluate('window.__schedulerWorkerTest?.done===true'));
  const status=await evaluate('window.__schedulerWorkerTest');
  assert.equal(status.error,'',status.error);
  assert.equal(status.result?.ok,true,status.result?.message||'Risultato worker non valido.');
  assert.equal(status.result?.optimality?.provenOptimal,true,'Il worker non ha completato la prova di ottimalità.');
  assert.equal(status.result?.optimality?.algorithm,'exact-branch-and-bound');
  assert.ok(status.result?.optimality?.nodes>0,'Nessun nodo di ricerca registrato.');
  assert.ok(status.progressEvents>0,'Nessun aggiornamento di avanzamento ricevuto.');
  assert.ok(status.ticks>0,'Il thread principale non ha eseguito alcun tick durante la ricerca.');
  assert.equal(status.sourceUnchanged,true,'La preview ha modificato il calendario sorgente.');
  assert.ok(Number.isInteger(status.result?.consecutiveStats?.uniqueTeams));
  console.log(JSON.stringify({ok:true,worker:true,mainThreadResponsive:true,progressEvents:status.progressEvents,ticks:status.ticks,nodes:status.result.optimality.nodes,pruned:status.result.optimality.pruned,uniqueTeams:status.result.consecutiveStats.uniqueTeams,occurrences:status.result.consecutiveStats.totalOccurrences},null,2));
}finally{
  try{client?.close();}catch{}
  if(browser){browser.kill('SIGTERM');await Promise.race([new Promise(resolve=>browser.once('exit',resolve)),delay(2000)]);if(!browser.killed)browser.kill('SIGKILL');}
}
