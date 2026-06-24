import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';

const root=process.cwd();
const outDir=path.join(root,'reports','kings-visual');
fs.mkdirSync(outDir,{recursive:true});
const chromium=process.env.CHROMIUM_BIN||'/usr/bin/chromium';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
class Client{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}async connect(){await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});}send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}}
async function waitFor(fn,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){try{const v=await fn();if(v)return v;}catch{}await delay(60);}throw new Error('timeout');}
const safe=s=>s.replace(/<\/script/gi,'<\\/script');
const styles=fs.readFileSync(path.join(root,'assets/css/styles.css'),'utf8');
const storeSrc=fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8');
const uiSrc=fs.readFileSync(path.join(root,'assets/js/ui.js'),'utf8');
let printSrc=fs.readFileSync(path.join(root,'assets/js/print.js'),'utf8')
 .replace("const state=store.load('admin');","const state=store.normalizeState(window.__AUDIT_STATE);")
 .replace("const type=params.get('type')||'calendar';","const type=window.__AUDIT_TYPE||'calendar';")
 .replace("setTimeout(()=>window.print(),450);","window.__PRINT_READY=true;");

function fixture(){
 const teams=[];
 for(let i=0;i<12;i++)teams.push({id:`t${i}`,name:`Associazione Sportiva Internazionale d’Àngelo della Valle Numero ${i+1}`,logo:'',players:[{id:`p${i}`,name:`Giocatore José O’Connor Montemaggiore ${i+1}`,number:i+1}],president:{id:`pr${i}`,name:`Presidente María D’Àngelo ${i+1}`},coach:{name:''}});
 const matches=[];
 for(let i=0;i<42;i++){
  const home=i%12,away=(i*5+3)%12;
  matches.push({id:`m${i}`,phase:'league',round:`Giornata ${Math.floor(i/6)+1}`,roundIndex:Math.floor(i/6),homeTeamId:`t${home}`,awayTeamId:`t${away}`,date:`2026-07-${String(1+Math.floor(i/6)).padStart(2,'0')}`,time:`${String(9+(i%6)).padStart(2,'0')}:00`,field:`Campo Internazionale ${i%2+1}`,status:'played',goals:[{id:`g${i}a`,playerId:`p${home}`,weight:i%3===0?2:1},{id:`g${i}b`,playerId:`pr${home}`,weight:1},{id:`g${i}c`,playerId:`p${away}`,weight:i%4===0?2:1}],cards:[]});
 }
 return {rules:{name:'Kings League – Torneo Internazionale d’Àngelo',format:'league',isKingsLeague:true,fieldCount:2,startDate:'2026-07-01'},site:{},teams,matches,articles:[],teamPhotos:[]};
}

const debug=await freePort();
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ng-pdf-'));
const browser=spawn(chromium,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${debug}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
try{
 await waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${debug}/json/list`)).ok}catch{return false}});
 const targets=await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();
 const page=targets.find(t=>t.type==='page');
 const client=new Client(new WebSocket(page.webSocketDebuggerUrl));
 await client.connect();await client.send('Page.enable');await client.send('Runtime.enable');
 const tree=await client.send('Page.getFrameTree');
 const results=[];
 for(const type of ['calendar','standings']){
  const html=`<!doctype html><html lang="it"><head><meta charset="utf-8"><style>${styles}</style></head><body class="print-page"><div class="shell"><main id="printRoot" class="print-report"></main></div><script>window.__AUDIT_STATE=${JSON.stringify(fixture())};window.__AUDIT_TYPE=${JSON.stringify(type)};</script><script>${safe(storeSrc)}</script><script>${safe(uiSrc)}</script><script>${safe(printSrc)}</script></body></html>`;
  await client.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
  await waitFor(async()=>{const r=await client.send('Runtime.evaluate',{expression:'window.__PRINT_READY===true && document.querySelectorAll(".pdf-table tbody tr").length>0',returnByValue:true});return r.result?.value;});
  const metrics=await client.send('Runtime.evaluate',{expression:'({height:document.documentElement.scrollHeight,rows:document.querySelectorAll(".pdf-table tbody tr").length,text:document.body.innerText})',returnByValue:true});
  if(type==='calendar' && !metrics.result.value.text.includes('3 - 1'))throw new Error('Risultato Kings pesato non presente nel PDF calendario');
  const pdf=await client.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,paperWidth:8.27,paperHeight:11.69,marginTop:0.35,marginBottom:0.35,marginLeft:0.35,marginRight:0.35});
  const file=path.join(outDir,`print-${type}.pdf`);fs.writeFileSync(file,Buffer.from(pdf.data,'base64'));
  results.push({type,file,size:fs.statSync(file).size,rows:metrics.result.value.rows,documentHeight:metrics.result.value.height});
 }
 console.log(JSON.stringify({ok:true,pdfs:results},null,2));
}finally{browser.kill('SIGKILL');}
