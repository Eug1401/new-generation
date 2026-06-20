import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const chromium=process.env.CHROMIUM_BIN || '/usr/bin/chromium';
const pages=['index.html','admin.html','admin-rules.html','admin-groups.html','admin-teams.html','admin-players.html','admin-matches.html','admin-articles.html','admin-photos.html','admin-reports.html','admin-customize.html','print.html','404.html'];
const widths=[320,360,375,390,412,480,768,1024,1280,1440,1920];
const results=[];
const runtimeErrors=[];
const localNetworkErrors=[];
let browser;
let server;
let client;

function record(name,ok,details=''){
  results.push({test:name,result:ok?'PASS':'FAIL',details});
  if(!ok) process.exitCode=1;
}
function assert(condition,message){if(!condition)throw new Error(message);}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function mime(file){
  const ext=path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'})[ext]||'application/octet-stream';
}
function transformHtml(text){
  return text.replace(/<script\s+defer\s+src="https:\/\/cdn\.jsdelivr\.net\/[^"]+"><\/script>/g,'');
}
function startServer(){
  return new Promise(resolve=>{
    server=http.createServer((req,res)=>{
      try{
        const url=new URL(req.url,'http://127.0.0.1');
        let rel=decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if(rel.endsWith('/'))rel+='index.html';
        const full=path.resolve(root,rel);
        if(!full.startsWith(root+path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()){
          res.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('Not found');return;
        }
        let body=fs.readFileSync(full);
        if(rel.endsWith('.html'))body=Buffer.from(transformHtml(body.toString('utf8')));
        if(rel==='assets/js/supabase-config.js')body=Buffer.from(body.toString('utf8').replace('ENABLED: true','ENABLED: false'));
        res.writeHead(200,{'content-type':mime(full),'cache-control':'no-store','content-length':body.length});
        res.end(body);
      }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(String(error));}
    });
    server.listen(0,'127.0.0.1',()=>resolve(server.address().port));
  });
}
function freePort(){
  return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
}
async function waitFor(fn,{timeout=8000,interval=40,label='condition'}={}){
  const start=Date.now();let last;
  while(Date.now()-start<timeout){try{last=await fn();if(last)return last;}catch(error){last=error;}await delay(interval);}
  throw new Error(`Timeout waiting for ${label}${last instanceof Error?`: ${last.message}`:''}`);
}
class CDPClient{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.handlers=new Map();}
  async connect(){
    await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true});});
    this.ws.addEventListener('message',event=>{
      const msg=JSON.parse(event.data);
      if(msg.id){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);if(msg.error)p.reject(new Error(msg.error.message));else p.resolve(msg.result);return;}
      const list=this.handlers.get(msg.method)||[];for(const fn of list)fn(msg.params||{});
    });
  }
  on(method,fn){const list=this.handlers.get(method)||[];list.push(fn);this.handlers.set(method,list);}
  send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  close(){this.ws.close();}
}
async function launchBrowser(){
  const port=await freePort();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ng-ui-chromium-'));
  browser=spawn(chromium,[
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking',
    '--disable-component-update','--disable-default-apps','--disable-extensions','--disable-sync','--metrics-recording-only',
    '--no-first-run','--no-proxy-server','--host-resolver-rules=MAP ng-ui.test 127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  let stderr='';browser.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  await waitFor(async()=>{try{const r=await fetch(`http://127.0.0.1:${port}/json/list`);return r.ok;}catch{return false;}},{timeout:10000,label:'Chromium DevTools'});
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=targets.find(t=>t.type==='page');
  if(!target)throw new Error(`No page target. Chromium stderr: ${stderr.slice(-1000)}`);
  client=new CDPClient(new WebSocket(target.webSocketDebuggerUrl));
  await client.connect();
  await Promise.all([client.send('Page.enable'),client.send('Runtime.enable'),client.send('Network.enable'),client.send('Log.enable')]);
  client.on('Runtime.exceptionThrown',p=>runtimeErrors.push({url:currentUrl,description:p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'Runtime exception'}));
  client.on('Runtime.consoleAPICalled',p=>{if(p.type==='error')runtimeErrors.push({url:currentUrl,description:(p.args||[]).map(a=>a.value||a.description||'').join(' ')});});
  client.on('Network.loadingFailed',p=>{const u=requestUrls.get(p.requestId)||'';if(u.startsWith(baseUrl))localNetworkErrors.push({url:u,error:p.errorText});});
  client.on('Network.requestWillBeSent',p=>requestUrls.set(p.requestId,p.request.url));
}
const requestUrls=new Map();
let baseUrl='';
let currentUrl='';
async function evaluate(expression,{awaitPromise=true}={}){
  const r=await client.send('Runtime.evaluate',{expression,awaitPromise,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text||'Evaluation failed');
  return r.result?.value;
}
async function setViewport(width,height=900){
  await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<=480,screenWidth:width,screenHeight:height});
}
async function navigate(page){
  currentUrl=`${baseUrl}/${page}`;
  await client.send('Page.navigate',{url:currentUrl});
  await waitFor(()=>evaluate(`document.readyState==='complete' && !!document.body`),{timeout:10000,label:`load ${page}`});
  await delay(180);
}
async function pressKey(key,code=key){
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code});
  await delay(60);
}
async function click(selector){
  const ok=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.focus?.({preventScroll:true});el.click();return true;})()`);
  assert(ok,`Elemento non trovato: ${selector}`);await delay(70);
}
async function seedState(){
  const ok=await evaluate(`(()=>{
    const store=window.NexoraStore;if(!store)return false;
    const state=store.normalizeState({
      rules:{...store.blankRules(),name:'Test stabilità UI',format:'league',startDate:'2026-06-20'},
      site:{...store.defaultSite(),title:'Test stabilità UI'},
      teams:[
        {id:'team_a',name:'Aurora FC',logo:'',president:{id:'pres_a',name:'Ada Rossi'},coach:{name:'Luca Bianchi'},players:[{id:'player_a',name:'Marco Verdi',birthYear:2001,number:9}]},
        {id:'team_b',name:'Nova United',logo:'',president:{id:'pres_b',name:'Sara Neri'},coach:{name:'Paolo Blu'},players:[{id:'player_b',name:'Andrea Gialli',birthYear:2000,number:10}]}
      ],
      matches:[{id:'match_1',phase:'league',round:'Giornata 1',roundIndex:0,homeTeamId:'team_a',awayTeamId:'team_b',date:'2026-06-20',time:'18:00',field:'Campo 1',referee:'Arbitro Test',status:'scheduled',goals:[],cards:[]}],
      articles:[{id:'article_1',title:'Notizia test',body:'Contenuto di prova per la stabilità della modale.',image:'',createdAt:'2026-06-20T10:00:00Z',updatedAt:'2026-06-20T10:00:00Z'}],
      teamPhotos:{team_a:[{path:'test/photo-1.jpg',name:'photo-1.jpg',size:2048,ts:1781949600000}]}
    });
    localStorage.setItem(store.PUBLIC_KEY,JSON.stringify(state));
    localStorage.setItem(store.ADMIN_KEY,JSON.stringify(state));
    return true;
  })()`);
  assert(ok,'Store non disponibile per seed');
}
async function overlayState(selector){return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return {exists:!!el,open:!!el&&(el.classList.contains('open')||el.classList.contains('show')),count:document.querySelectorAll(${JSON.stringify(selector)}).length,bodyLocked:document.body.classList.contains('ng-overlay-open'),overflow:getComputedStyle(document.body).overflow,activeId:document.activeElement?.id||'',activeText:document.activeElement?.textContent?.trim()||'',scrollY:window.scrollY,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};})()`);}

async function testPageLoads(){
  const beforeErrors=runtimeErrors.length,beforeNetwork=localNetworkErrors.length;
  for(const page of pages){await setViewport(1280,900);await navigate(page);const hasRuntime=await evaluate(`typeof window.NGInteractive==='object'`);if(!hasRuntime){const debug=await evaluate(`({scripts:[...document.scripts].map(s=>({src:s.src,ready:s.readyState})),html:document.documentElement.outerHTML.slice(-1000)})`);throw new Error(`${page}: runtime interattivo assente; errors=${JSON.stringify(runtimeErrors)}; debug=${JSON.stringify(debug)}`);}}
  record('Avvio e caricamento delle 13 pagine HTML',runtimeErrors.length===beforeErrors && localNetworkErrors.length===beforeNetwork,`13/13 caricate; errori runtime nuovi ${runtimeErrors.length-beforeErrors}; richieste locali fallite ${localNetworkErrors.length-beforeNetwork}`);
}
async function testResponsive(){
  await navigate('index.html');await seedState();await navigate('index.html');
  const failures=[];
  for(const width of widths){
    await setViewport(width,900);await delay(90);
    const m=await evaluate(`({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,body:document.body.scrollWidth-document.documentElement.clientWidth,modal:document.querySelector('#matchModal')?.getBoundingClientRect().width||0})`);
    if(m.doc>1||m.body>1)failures.push(`${width}px doc=${m.doc} body=${m.body}`);
  }
  record('Responsive e overflow orizzontale',failures.length===0,failures.length?failures.join('; '):widths.map(w=>`${w}px`).join(', '));
}
async function testBusyButton(){
  await setViewport(1280,900);await navigate('admin.html');
  const data=await evaluate(`(()=>{const b=document.querySelector('#resetAllBtn');const before=b.getBoundingClientRect();const first=NGInteractive.setButtonBusy(b,true,'Operazione molto lunga…');const during=b.getBoundingClientRect();const second=NGInteractive.setButtonBusy(b,true,'Ancora…');const disabled=b.disabled;NGInteractive.setButtonBusy(b,false);const after=b.getBoundingClientRect();return {first,second,disabled,before:{w:before.width,h:before.height},during:{w:during.width,h:during.height},after:{w:after.width,h:after.height},busy:NGInteractive.isButtonBusy(b)};})()`);
  const stable=Math.abs(data.before.w-data.during.w)<1 && Math.abs(data.before.h-data.during.h)<1 && Math.abs(data.before.w-data.after.w)<1 && Math.abs(data.before.h-data.after.h)<1;
  record('Pulsante loading: dimensioni stabili e click multipli bloccati',stable&&data.first&&!data.second&&data.disabled&&!data.busy,JSON.stringify(data));
}
async function testAdminResetDialog(){
  await setViewport(1280,900);await navigate('admin.html');
  await evaluate(`window.scrollTo(0,Math.min(240,document.documentElement.scrollHeight-window.innerHeight))`);const scrollBefore=await evaluate('window.scrollY');
  const geometryBefore=await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();const b=document.querySelector('#resetAllBtn').getBoundingClientRect();return {headerX:r.x,headerW:r.width,buttonX:b.x,buttonW:b.width};})()`);
  await click('#resetAllBtn');let st=await overlayState('#resetTournamentDialog');
  assert(st.open&&st.count===1&&st.bodyLocked,'Reset non aperto o scroll non bloccato');
  const geometryOpen=await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();const b=document.querySelector('#resetAllBtn').getBoundingClientRect();return {headerX:r.x,headerW:r.width,buttonX:b.x,buttonW:b.width};})()`);
  await click('#cancelResetBtn');await delay(80);st=await overlayState('#resetTournamentDialog');
  assert(!st.open&&!st.bodyLocked,'Reset non chiuso o scroll ancora bloccato');
  const focusButton=await evaluate(`document.activeElement===document.querySelector('#resetAllBtn')`);
  for(let i=0;i<10;i++){await click('#resetAllBtn');await click('#cancelResetBtn');}
  let residual=await overlayState('#resetTournamentDialog');
  const cyclesOk=!residual.open&&!residual.bodyLocked&&residual.count===1;
  await evaluate(`document.querySelector('#resetAllBtn').click();document.querySelector('#resetAllBtn').click()`);await delay(80);
  st=await overlayState('#resetTournamentDialog');const doubleOk=st.open&&st.count===1;
  await pressKey('Escape');st=await overlayState('#resetTournamentDialog');const escapeOk=!st.open&&!st.bodyLocked;
  await click('#resetAllBtn');await click('#resetTournamentDialog');st=await overlayState('#resetTournamentDialog');const backdropOk=!st.open&&!st.bodyLocked;
  const scrollAfter=await evaluate('window.scrollY');
  const geometryAfter=await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();const b=document.querySelector('#resetAllBtn').getBoundingClientRect();return {headerX:r.x,headerW:r.width,buttonX:b.x,buttonW:b.width};})()`);
  const delta=(a,b)=>Math.abs(a-b)<1;
  const noShift=['headerX','headerW','buttonX','buttonW'].every(k=>delta(geometryBefore[k],geometryOpen[k])&&delta(geometryBefore[k],geometryAfter[k]));
  record('Modale reset: apertura/chiusura, 10 cicli, doppio click, Escape, backdrop, focus e scroll',focusButton&&cyclesOk&&doubleOk&&escapeOk&&backdropOk&&Math.abs(scrollBefore-scrollAfter)<1&&noShift,JSON.stringify({focusButton,cyclesOk,doubleOk,escapeOk,backdropOk,scrollBefore,scrollAfter,noShift,geometryBefore,geometryOpen,geometryAfter,residual}));
}
async function testMobileSheet(){
  await setViewport(390,844);await navigate('index.html');
  const opener='.mobile-more-trigger';
  const widthBefore=await evaluate('document.documentElement.clientWidth');
  await click(opener);let st=await overlayState('.mobile-nav-sheet');assert(st.open&&st.bodyLocked,'Menu mobile non aperto');
  await pressKey('Escape');st=await overlayState('.mobile-nav-sheet');const focusOk=await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(opener)})`);
  const escapeOk=!st.open&&!st.bodyLocked&&focusOk;
  for(let i=0;i<10;i++){await click(opener);await pressKey('Escape');}
  let residual=await overlayState('.mobile-nav-sheet');const cyclesOk=!residual.open&&!residual.bodyLocked&&residual.count===1;
  await evaluate(`const b=document.querySelector(${JSON.stringify(opener)});b.click();b.click();`);await delay(80);st=await overlayState('.mobile-nav-sheet');const doubleOk=st.open&&st.count===1;
  await click('.mobile-nav-backdrop');st=await overlayState('.mobile-nav-sheet');const backdropOk=!st.open&&!st.bodyLocked;
  const widthAfter=await evaluate('document.documentElement.clientWidth');
  record('Menu mobile: 10 cicli, doppio click, Escape, backdrop, focus e larghezza pagina',escapeOk&&cyclesOk&&doubleOk&&backdropOk&&widthBefore===widthAfter,JSON.stringify({escapeOk,cyclesOk,doubleOk,backdropOk,widthBefore,widthAfter,residual}));
}
async function testFilterAndPublicModals(){
  await setViewport(390,844);await navigate('index.html');
  await click('[data-tab="matches"]');await click('[data-open-match-filter="phase"]');
  let st=await overlayState('#matchFilterSheet');const filterOpen=st.open&&st.bodyLocked;
  await click('#matchFilterSheet');st=await overlayState('#matchFilterSheet');const filterBackdrop=!st.open&&!st.bodyLocked;
  await click('[data-open-match-filter="phase"]');await pressKey('Escape');st=await overlayState('#matchFilterSheet');const filterEscape=!st.open&&!st.bodyLocked;
  await click('[data-match-detail="match_1"]');st=await overlayState('#matchModal');const matchOpen=st.open&&st.bodyLocked;
  await click('#matchModal');st=await overlayState('#matchModal');const matchBackdrop=!st.open&&!st.bodyLocked;
  await click('[data-match-detail="match_1"]');await pressKey('Escape');st=await overlayState('#matchModal');const matchEscape=!st.open&&!st.bodyLocked;
  await click('[data-tab="teams"]');await click('[data-team-detail="team_a"]');st=await overlayState('#teamModal');const teamOpen=st.open&&st.bodyLocked;
  await pressKey('Escape');st=await overlayState('#teamModal');const teamEscape=!st.open&&!st.bodyLocked;
  await click('[data-tab="articles"]');await click('[data-article-open="article_1"]');st=await overlayState('#articleModal');const articleOpen=st.open&&st.bodyLocked;
  await click('#articleModal');st=await overlayState('#articleModal');const articleBackdrop=!st.open&&!st.bodyLocked;
  const residual=await evaluate(`document.querySelectorAll('.modal.open,.filter-sheet-modal.open,.ng-confirm-overlay.open').length`);
  record('Filtri e modali pubbliche: apertura, Escape, backdrop e assenza residui',filterOpen&&filterBackdrop&&filterEscape&&matchOpen&&matchBackdrop&&matchEscape&&teamOpen&&teamEscape&&articleOpen&&articleBackdrop&&residual===0,JSON.stringify({filterOpen,filterBackdrop,filterEscape,matchOpen,matchBackdrop,matchEscape,teamOpen,teamEscape,articleOpen,articleBackdrop,residual}));
}

async function testSimulationDialog(){
  await setViewport(1280,900);await navigate('admin.html');
  await click('#simulateTournamentBtn');let st=await overlayState('#simulationDialog');const openOk=st.open&&st.bodyLocked&&st.count===1;
  await pressKey('Escape');st=await overlayState('#simulationDialog');const escapeOk=!st.open&&!st.bodyLocked&&await evaluate(`document.activeElement===document.querySelector('#simulateTournamentBtn')`);
  for(let i=0;i<10;i++){await click('#simulateTournamentBtn');await click('#cancelSimulationBtn');}
  st=await overlayState('#simulationDialog');const cyclesOk=!st.open&&!st.bodyLocked&&st.count===1;
  await evaluate(`const b=document.querySelector('#simulateTournamentBtn');b.focus();b.click();b.click();`);await delay(80);st=await overlayState('#simulationDialog');const doubleOk=st.open&&st.count===1;
  await click('#simulationDialog');st=await overlayState('#simulationDialog');const backdropOk=!st.open&&!st.bodyLocked;
  record('Modale simulazione: 10 cicli, doppio click, Escape, backdrop e focus',openOk&&escapeOk&&cyclesOk&&doubleOk&&backdropOk,JSON.stringify({openOk,escapeOk,cyclesOk,doubleOk,backdropOk,st}));
}
async function testPhotoConfirmAndLightbox(){
  await setViewport(1280,900);await navigate('admin-photos.html');
  await click('[data-team-pick="team_a"]');
  const photoExists=await evaluate(`!!document.querySelector('[data-delete-photo="test/photo-1.jpg"]')`);
  assert(photoExists,'Foto test non renderizzata');
  await evaluate(`const b=document.querySelector('[data-delete-photo="test/photo-1.jpg"]');b.focus();b.click();b.click();`);await delay(80);
  let st=await overlayState('.ng-confirm-overlay');const doubleOk=st.open&&st.count===1&&st.bodyLocked;
  await pressKey('Escape');await delay(320);st=await overlayState('.ng-confirm-overlay');const escapeOk=!st.exists&&!st.bodyLocked&&await evaluate(`document.activeElement===document.querySelector('[data-delete-photo="test/photo-1.jpg"]')`);
  let cyclesOk=true;
  for(let i=0;i<10;i++){
    await click('[data-delete-photo="test/photo-1.jpg"]');
    const open=await overlayState('.ng-confirm-overlay');
    if(!open.open||open.count!==1){cyclesOk=false;break;}
    await click('.ng-confirm-cancel');await delay(380);
  }
  st=await overlayState('.ng-confirm-overlay');cyclesOk=cyclesOk&&!st.exists&&!st.bodyLocked;
  await click('[data-delete-photo="test/photo-1.jpg"]');await waitFor(()=>evaluate(`!!document.querySelector('.ng-confirm-overlay.open')`),{label:'confirm backdrop'});await click('.ng-confirm-overlay');await delay(380);st=await overlayState('.ng-confirm-overlay');const backdropOk=!st.exists&&!st.bodyLocked;
  await click('[data-photo-open="0"]');let light=await overlayState('#photosLightbox');const lightOpen=light.open&&light.bodyLocked&&light.count===1;
  await pressKey('ArrowRight');await pressKey('ArrowLeft');
  await pressKey('Escape');light=await overlayState('#photosLightbox');const lightEscape=!light.open&&!light.bodyLocked;
  for(let i=0;i<10;i++){await click('[data-photo-open="0"]');await pressKey('Escape');}
  light=await overlayState('#photosLightbox');const lightCycles=!light.open&&!light.bodyLocked&&light.count===1;
  record('Conferma foto e lightbox: singola istanza, 10 cicli, Escape, backdrop, frecce e assenza residui',doubleOk&&escapeOk&&cyclesOk&&backdropOk&&lightOpen&&lightEscape&&lightCycles,JSON.stringify({doubleOk,escapeOk,cyclesOk,backdropOk,lightOpen,lightEscape,lightCycles,confirm:st,light}));
}

async function testResizeAndScroll(){
  await setViewport(1280,900);await navigate('index.html');await click('[data-tab="matches"]');await click('[data-match-detail="match_1"]');
  await setViewport(320,700);await delay(120);
  const measure=await evaluate(`(()=>{const modal=document.querySelector('#matchModal');const content=modal.querySelector('.modal-content');const r=content.getBoundingClientRect();return {open:modal.classList.contains('open'),left:r.left,right:r.right,width:r.width,vw:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,locked:document.body.classList.contains('ng-overlay-open')};})()`);
  await evaluate('window.scrollTo(0,300)');const whileOpen=await evaluate('window.scrollY');
  await pressKey('Escape');const after=await overlayState('#matchModal');
  record('Ridimensionamento e scroll con modale aperta',measure.open&&measure.left>=-1&&measure.right<=measure.vw+1&&measure.overflow<=1&&measure.locked&&!after.open&&!after.bodyLocked,JSON.stringify({measure,whileOpen,after}));
}
async function run(){
  const port=await startServer();baseUrl=`http://ng-ui.test:${port}`;
  await launchBrowser();
  try{
    await testPageLoads();
    await testResponsive();
    await testBusyButton();
    await testAdminResetDialog();
    await testSimulationDialog();
    await testMobileSheet();
    await testFilterAndPublicModals();
    await testPhotoConfirmAndLightbox();
    await testResizeAndScroll();
    record('Console JavaScript e richieste locali',runtimeErrors.length===0&&localNetworkErrors.length===0,JSON.stringify({runtimeErrors,localNetworkErrors}));
  }finally{
    try{client?.close();}catch{}
    try{browser?.kill('SIGTERM');}catch{}
    await new Promise(resolve=>server?.close(resolve));
  }
  console.log(JSON.stringify({root,pages:pages.length,widths,results,runtimeErrors,localNetworkErrors},null,2));
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
run().catch(error=>{console.error(error.stack||error);try{browser?.kill('SIGTERM');}catch{}try{server?.close();}catch{}process.exit(1);});
