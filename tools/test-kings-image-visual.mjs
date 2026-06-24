import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';

const root=process.cwd();
const outDir=path.join(root,'reports','kings-visual');fs.mkdirSync(outDir,{recursive:true});
const chromium=process.env.CHROMIUM_BIN||'/usr/bin/chromium';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
class Client{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}async connect(){await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});}send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}}
async function waitFor(fn,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){try{const v=await fn();if(v)return v;}catch{}await delay(60);}throw new Error('timeout');}
const debug=await freePort();const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ng-img-'));
const browser=spawn(chromium,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${debug}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
try{
 await waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${debug}/json/list`)).ok}catch{return false}});
 const targets=await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();const page=targets.find(t=>t.type==='page');const client=new Client(new WebSocket(page.webSocketDebuggerUrl));await client.connect();await client.send('Page.enable');await client.send('Runtime.enable');
 const safe=s=>s.replace(/<\/script/gi,'<\\/script');
 const html=`<!doctype html><meta charset="utf-8"><script>${safe(fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8'))}</script><script>${safe(fs.readFileSync(path.join(root,'assets/js/share-images.js'),'utf8'))}</script><body></body>`;
 const tree=await client.send('Page.getFrameTree');await client.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
 await waitFor(async()=>{const r=await client.send('Runtime.evaluate',{expression:'document.readyState==="complete"&&!!window.NGShareImages',returnByValue:true});return r.result?.value;});
 const run=async(name,stateCode)=>{
  const expression=`(async()=>{const store=NexoraStore;const raw=(${stateCode})();const state=store.normalizeState(raw);const match=state.matches[0];const result=await NGShareImages.generate('match',state,{match});const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(result.blob);});return {data,width:result.width,height:result.height,title:result.title};})()`;
  const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);const value=r.result.value;const file=path.join(outDir,`${name}.png`);fs.writeFileSync(file,Buffer.from(value.data.split(',')[1],'base64'));return {file,width:value.width,height:value.height,title:value.title,size:fs.statSync(file).size};
 };
 const common=`()=>({rules:{...NexoraStore.blankRules(),name:'Kings League Eleganza Internazionale',format:'league',isKingsLeague:true,startDate:'2026-07-01'},site:{},articles:[],teamPhotos:[],teams:[{id:'a',name:'Associazione Sportiva Internazionale d’Àngelo',logo:'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90"><rect width="300" height="90" rx="20" fill="#8a1538"/><text x="150" y="57" text-anchor="middle" font-size="32" fill="white">ANGELO FC</text></svg>'),players:[{id:'p1',name:'Li',number:1},{id:'p7',name:'Gianluca D’Àngelo-Rossi del Borgo',number:7}],president:{id:'pres_a',name:'Mario Rossi'},coach:{name:''}},{id:'b',name:'Boreale United Football Club dalla Valle',logo:'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="300"><rect width="90" height="300" rx="20" fill="#176b3a"/><circle cx="45" cy="65" r="30" fill="white"/><text x="45" y="190" text-anchor="middle" font-size="28" fill="white" transform="rotate(-90 45 190)">BOREALE</text></svg>'),players:[{id:'p10',name:'José O’Connor',number:10},{id:'p11',name:'Anna María Núñez',number:11}],president:{id:'pres_b',name:'Presidentessa dal Nome Straordinariamente Lungo'},coach:{name:''}}],matches:[{id:'m1',phase:'league',round:'Giornata conclusiva serale',homeTeamId:'a',awayTeamId:'b',date:'2026-07-01',time:'20:00',field:'Campo Centrale New Generation Arena',referee:'Dott. Alessandro Maria Francesco De Luca',status:'played',goals:[{id:'n1',playerId:'p1',weight:1},{id:'n2',playerId:'p7',weight:1},{id:'d1',playerId:'p7',weight:2},{id:'pr1',playerId:'pres_a',weight:1},{id:'b1',playerId:'p10',weight:2}],cards:[]} ]})`;
 const normal=await run('match-combined',common);
 const stress=`()=>{const s=(${common})();s.matches[0].goals=[];for(let i=0;i<18;i++)s.matches[0].goals.push({id:'a'+i,playerId:i%2?'p7':'p1',weight:i%3===0?2:1});for(let i=0;i<14;i++)s.matches[0].goals.push({id:'b'+i,playerId:i%2?'p10':'p11',weight:i%4===0?2:1});for(let i=0;i<7;i++)s.matches[0].goals.push({id:'pr'+i,playerId:i%2?'pres_a':'pres_b',weight:2});return s;}`;
 const stressResult=await run('match-stress',stress);
 const many=`()=>{const s=(${common})();s.teams[0].players=[];s.teams[1].players=[];s.matches[0].goals=[];for(let i=0;i<14;i++){s.teams[0].players.push({id:'ha'+i,name:'Alessandro Maria De Santis della Valle '+(i+1),number:i+1});s.matches[0].goals.push({id:'hg'+i,playerId:'ha'+i,weight:i%3===0?2:1});}for(let i=0;i<13;i++){s.teams[1].players.push({id:'ab'+i,name:'Giovanni Battista Montemaggiore O’Connor '+(i+1),number:i+20});s.matches[0].goals.push({id:'ag'+i,playerId:'ab'+i,weight:i%4===0?2:1});}s.matches[0].goals.push({id:'presA',playerId:'pres_a',weight:2},{id:'presB',playerId:'pres_b',weight:2});return s;}`;
 const manyResult=await run('match-many-scorers',many);
 if(manyResult.height<=normal.height)throw new Error('Il canvas non cresce con molti marcatori');
 console.log(JSON.stringify({ok:true,images:[normal,stressResult,manyResult]},null,2));
}finally{browser.kill('SIGKILL');}
