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
let fixtureRoot='';
let storageState={};

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
function prepareFileFixture(){
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'ng-ui-files-'));
  fs.cpSync(root,target,{recursive:true,filter:src=>!['dist','node_modules','.git'].includes(path.basename(src))});
  for(const page of pages){
    const file=path.join(target,page);
    fs.writeFileSync(file,transformHtml(fs.readFileSync(file,'utf8')));
  }
  const config=path.join(target,'assets/js/supabase-config.js');
  fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('ENABLED: true','ENABLED: false'));
  return target;
}
function storagePrelude(){
  const seed=JSON.stringify(storageState).replaceAll('<','\\u003c');
  return `<script>(function(){
    const seed=${seed};
    const storage={};
    const define=(key,value)=>Object.defineProperty(storage,String(key),{value:String(value),writable:true,enumerable:true,configurable:true});
    Object.defineProperties(storage,{
      getItem:{value:key=>Object.prototype.hasOwnProperty.call(storage,String(key))?String(storage[String(key)]):null},
      setItem:{value:(key,value)=>define(key,value)},
      removeItem:{value:key=>{delete storage[String(key)];}},
      clear:{value:()=>{Object.keys(storage).forEach(key=>delete storage[key]);}},
      key:{value:index=>Object.keys(storage)[Number(index)]??null},
      length:{get:()=>Object.keys(storage).length}
    });
    Object.entries(seed).forEach(([key,value])=>define(key,value));
    Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
  })();<\/script>`;
}
function bundlePage(page){
  const file=path.join(fixtureRoot,page);
  let html=fs.readFileSync(file,'utf8');
  const css=fs.readFileSync(path.join(fixtureRoot,'assets/css/styles.css'),'utf8').replace(/<\/style/gi,'<\\/style');
  html=html.replace(/<link\s+rel="stylesheet"\s+href="assets\/css\/styles\.css[^\"]*">/i,`<style>${css}</style>`);
  html=html.replace(/<script\s+defer\s+src="(assets\/js\/[^\"]+)"\s*><\/script>/gi,(_,src)=>{
    const rel=src.split('?')[0];
    const code=fs.readFileSync(path.join(fixtureRoot,rel),'utf8').replace(/<\/script/gi,'<\\/script');
    return `<script>${code}\n//# sourceURL=${rel}<\/script>`;
  });
  html=html.replace('<head>','<head>'+storagePrelude());
  return html;
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
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--allow-file-access-from-files',
    '--disable-component-update','--disable-default-apps','--disable-extensions','--disable-sync','--metrics-recording-only',
    '--no-first-run','--no-proxy-server',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'
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
  try{
    const saved=await evaluate(`(()=>{try{const out={};for(const key of Object.keys(localStorage))out[key]=localStorage.getItem(key);return out;}catch(_){return null;}})()`);
    if(saved)storageState=saved;
  }catch{}
  currentUrl=`inline://${page}`;
  const tree=await client.send('Page.getFrameTree');
  await client.send('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html:bundlePage(page)});
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
    const crest=(w,h,body)=>'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+body+'</svg>');
    const circle=crest(100,100,'<circle cx="50" cy="50" r="48" fill="#d7a42d"/><circle cx="50" cy="50" r="30" fill="#101820"/><text x="50" y="57" text-anchor="middle" font-size="22" fill="#fff">A</text>');
    const square=crest(100,100,'<rect x="1" y="1" width="98" height="98" fill="#174f9b"/><path d="M10 90L50 5L90 90Z" fill="#fff"/><text x="50" y="78" text-anchor="middle" font-size="18" fill="#174f9b">N</text>');
    const wide=crest(240,80,'<path d="M2 40L28 3H212L238 40L212 77H28Z" fill="#8a1538"/><text x="120" y="51" text-anchor="middle" font-size="30" fill="#fff">WIDE CLUB</text>');
    const tall=crest(80,240,'<path d="M40 2L77 42V190L40 238L3 190V42Z" fill="#19713f"/><circle cx="40" cy="72" r="24" fill="#fff"/><text x="40" y="168" text-anchor="middle" font-size="28" fill="#fff">T</text>');
    const transparent=crest(120,120,'<path d="M60 0L74 40L120 45L84 72L96 120L60 92L24 120L36 72L0 45L46 40Z" fill="#f4d878"/><circle cx="60" cy="60" r="22" fill="#111"/><text x="60" y="68" text-anchor="middle" font-size="22" fill="#fff">X</text>');
    const state=store.normalizeState({
      rules:{...store.blankRules(),name:'Test stabilità UI',format:'league_knockout',startDate:'2026-06-20',eliminationCompetitions:[{id:'gold',name:'Oro',teams:4,startRank:1}]},
      site:{...store.defaultSite(),title:'Test stabilità UI'},
      teams:[
        {id:'team_a',name:'Aurora FC',logo:circle,president:{id:'pres_a',name:'Ada Rossi'},coach:{name:'Luca Bianchi'},players:[{id:'player_a',name:'Marco Verdi',birthYear:2001,number:9}]},
        {id:'team_b',name:'Nova United',logo:square,president:{id:'pres_b',name:'Sara Neri'},coach:{name:'Paolo Blu'},players:[{id:'player_b',name:'Andrea Gialli',birthYear:2000,number:10}]},
        {id:'team_c',name:'Wide Club',logo:wide,president:{id:'pres_c',name:'Marta Viola'},coach:{name:'Elio Rosa'},players:[{id:'player_c',name:'Lorenzo Ambra',birthYear:1999,number:7}]},
        {id:'team_d',name:'Tall Athletic',logo:tall,president:{id:'pres_d',name:'Nora Verde'},coach:{name:'Ivan Bianco'},players:[{id:'player_d',name:'Davide Bruno',birthYear:2002,number:11}]},
        {id:'team_e',name:'Transparent Stars',logo:transparent,president:{id:'pres_e',name:'Eva Oro'},coach:{name:'Carlo Nero'},players:[{id:'player_e',name:'Fabio Ciano',birthYear:2003,number:4}]},
        {id:'team_f',name:'Senza Stemma',logo:'',president:{id:'pres_f',name:'Lia Grigia'},coach:{name:'Ugo Rosso'},players:[{id:'player_f',name:'Piero Blu',birthYear:2001,number:5}]}
      ],
      matches:[
        {id:'match_1',phase:'league',round:'Giornata 1',roundIndex:0,homeTeamId:'team_a',awayTeamId:'team_b',date:'2026-06-20',time:'18:00',field:'Campo 1',referee:'Arbitro Test',status:'scheduled',goals:[],cards:[]},
        {id:'match_2',phase:'league',round:'Giornata 1',roundIndex:0,homeTeamId:'team_c',awayTeamId:'team_d',date:'2026-06-20',time:'19:00',field:'Campo 2',referee:'Arbitro Test 2',status:'scheduled',goals:[],cards:[]},
        {id:'match_ko',phase:'playoff',round:'Semifinale Oro 1',roundIndex:1,bracketRound:'Semifinali',bracketName:'Oro',bracketRoundIndex:1,bracketMatchIndex:1,homeTeamId:'team_e',awayTeamId:'team_a',date:'2026-06-21',time:'20:00',field:'Campo 1',referee:'Arbitro KO',status:'scheduled',goals:[],cards:[]}
      ],
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
async function testTeamLogoRendering(){
  const failures=[];
  const samples=[];
  const inspect=async(label,{requireRendered=true}={})=>{
    const data=await evaluate(`(()=>{
      const style=document.getElementById('ngTeamLogos');
      const wrappers=[...document.querySelectorAll('.team-logo-wrap')];
      const withLogo=wrappers.filter(el=>[...el.classList].some(c=>c.startsWith('ng-tl-')));
      const fallbackWrappers=wrappers.filter(el=>el.querySelector(':scope > .team-logo-fallback'));
      const fallbackChecks=fallbackWrappers.map(el=>{
        const f=el.querySelector(':scope > .team-logo-fallback');
        const before=getComputedStyle(f,'::before'),after=getComputedStyle(f,'::after');
        return {beforeContent:before.content,afterContent:after.content,beforeClip:before.clipPath,afterClip:after.clipPath};
      });
      const rows=withLogo.map(el=>{
        const cs=getComputedStyle(el);
        const id=el.dataset.teamId||'';
        const className=[...el.classList].find(c=>c.startsWith('ng-tl-'))||'';
        const r=el.getBoundingClientRect();
        return {id,className,aria:el.getAttribute('aria-label')||'',backgroundImage:cs.backgroundImage,backgroundSize:cs.backgroundSize,backgroundPosition:cs.backgroundPosition,overflow:cs.overflow,borderRadius:cs.borderRadius,pointerEvents:cs.pointerEvents,width:parseFloat(cs.width)||r.width,height:parseFloat(cs.height)||r.height,children:el.children.length,fallbacks:el.querySelectorAll(':scope > .team-logo-fallback').length};
      });
      return {
        styleCount:document.querySelectorAll('#ngTeamLogos').length,
        styleText:style?.textContent||'',
        wrapperCount:wrappers.length,
        withLogoCount:withLogo.length,
        fallbackCount:fallbackWrappers.length,
        rows,
        fallbackChecks,
        loadingPlaceholders:document.querySelectorAll('.team-logo-wrap .skeleton,.team-logo-wrap .loader,.team-logo-wrap [class*="placeholder"]').length,
        brokenTeamImages:[...document.querySelectorAll('img.team-logo')].filter(img=>!img.complete||img.naturalWidth===0).length,
        dataImageRequests:performance.getEntriesByType('resource').filter(e=>String(e.name).startsWith('data:image/')).length
      };
    })()`);
    samples.push({label,wrapperCount:data.wrapperCount,withLogoCount:data.withLogoCount,fallbackCount:data.fallbackCount});
    const fail=message=>failures.push(label+': '+message);
    if(data.styleCount!==1)fail('atteso un solo #ngTeamLogos, trovati '+data.styleCount);
    for(const id of ['team_a','team_b','team_c','team_d','team_e'])if(!data.styleText.includes('.ng-tl-'+id+'{background-image:url(data:image/svg+xml;base64,'))fail('regola CSS assente per '+id);
    if(requireRendered&&data.withLogoCount===0)fail('nessuno stemma reale renderizzato');
    if(data.loadingPlaceholders!==0)fail('placeholder/loader visibile nel componente stemma');
    if(data.brokenTeamImages!==0)fail('immagine stemma rotta');
    if(data.dataImageRequests!==0)fail('i data URL hanno generato richieste di rete');
    for(const row of data.rows){
      if(row.className!=='ng-tl-'+row.id)fail('associazione squadra-classe errata per '+row.id+' ('+row.className+')');
      if(row.aria!=='Stemma di '+({team_a:'Aurora FC',team_b:'Nova United',team_c:'Wide Club',team_d:'Tall Athletic',team_e:'Transparent Stars'}[row.id]||''))fail('testo alternativo errato per '+row.id+': '+row.aria);
      if(row.backgroundImage==='none')fail('background-image assente per '+row.id);
      if(row.backgroundSize!=='contain')fail('background-size non contain per '+row.id+': '+row.backgroundSize);
      if(!row.backgroundPosition.includes('50%'))fail('stemma non centrato per '+row.id+': '+row.backgroundPosition);
      if(row.overflow!=='visible')fail('overflow può ritagliare '+row.id+': '+row.overflow);
      if(row.borderRadius!=='0px')fail('border-radius può mascherare '+row.id+': '+row.borderRadius);
      if(row.pointerEvents!=='none')fail('lo stemma intercetta eventi per '+row.id);
      if(row.width<=0||row.height<=0)fail('dimensioni non riservate per '+row.id);
      if(row.children!==0||row.fallbacks!==0)fail('fallback sovrapposto allo stemma '+row.id);
    }
    for(const f of data.fallbackChecks){
      if(!['none','normal'].includes(f.beforeContent)||!['none','normal'].includes(f.afterContent))fail('pseudo-elemento fallback ancora attivo');
      if(f.beforeClip!=='none'||f.afterClip!=='none')fail('clip-path fallback ancora attivo');
    }
    return data;
  };

  await setViewport(1280,900);await navigate('index.html');await seedState();
  await client.send('Network.setCacheDisabled',{cacheDisabled:true});
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:64000,uploadThroughput:32000,connectionType:'cellular3g'});
  await navigate('index.html');
  await inspect('pubblico primo caricamento lento / classifica');
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1,connectionType:'none'});
  await client.send('Network.setCacheDisabled',{cacheDisabled:false});

  await click('[data-tab="teams"]');await inspect('pubblico card squadre e roster');
  await click('[data-team-detail="team_a"]');await inspect('pubblico dettaglio squadra e modale');await pressKey('Escape');
  await click('[data-tab="matches"]');await inspect('pubblico card partite e calendario');
  await click('[data-match-detail="match_1"]');await inspect('pubblico dettaglio partita e modale');await pressKey('Escape');
  await click('[data-tab="bracket"]');await inspect('pubblico tabellone');
  await click('[data-tab="search"]');
  await evaluate(`(()=>{const q=document.querySelector('#globalSearch');q.value='Aurora';q.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await delay(80);await inspect('pubblico ricerca e filtro');

  const reversed=await evaluate(`(()=>{const store=window.NexoraStore;const state=store.load('public');state.teams=state.teams.slice().reverse();store.save('public',state);return state.teams.map(t=>t.id).join(',');})()`);
  assert(reversed==='team_f,team_e,team_d,team_c,team_b,team_a','Riordinamento squadre non applicato nel test');
  await navigate('index.html');await click('[data-tab="teams"]');await inspect('pubblico ordinamento invertito e associazione squadra-stemma');

  for(const [width,height,label] of [[768,1024,'tablet'],[390,844,'smartphone verticale'],[844,390,'smartphone orizzontale']]){
    await setViewport(width,height);await navigate('index.html');await click('[data-tab="teams"]');await inspect('pubblico '+label);
  }

  await setViewport(1280,900);
  for(const page of ['admin.html','admin-teams.html','admin-players.html','admin-matches.html','admin-groups.html','admin-photos.html']){
    await navigate(page);await inspect('admin '+page,{requireRendered:!['admin.html','admin-groups.html'].includes(page)});
  }

  await navigate('index.html');await inspect('pubblico ritorno pagina / cache popolata');
  await navigate('index.html');
  await waitFor(()=>evaluate(`document.readyState==='complete' && !!document.querySelector('#ngTeamLogos')`),{timeout:10000,label:'reload con cache'});await delay(180);
  await inspect('pubblico refresh completo');

  record('Stemmi web: niente forma dorata, contain, associazione stabile, accessibilità, caricamento e responsive',failures.length===0,failures.length?failures.join('; '):JSON.stringify(samples));
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
  await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(opener)});b.click();b.click();return true;})()`);await delay(80);st=await overlayState('.mobile-nav-sheet');const doubleOk=st.open&&st.count===1;
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
  await evaluate(`(()=>{const b=document.querySelector('#simulateTournamentBtn');b.focus();b.click();b.click();return true;})()`);await delay(80);st=await overlayState('#simulationDialog');const doubleOk=st.open&&st.count===1;
  await click('#simulationDialog');st=await overlayState('#simulationDialog');const backdropOk=!st.open&&!st.bodyLocked;
  record('Modale simulazione: 10 cicli, doppio click, Escape, backdrop e focus',openOk&&escapeOk&&cyclesOk&&doubleOk&&backdropOk,JSON.stringify({openOk,escapeOk,cyclesOk,doubleOk,backdropOk,st}));
}
async function testPhotoConfirmAndLightbox(){
  await setViewport(1280,900);await navigate('admin-photos.html');
  await click('[data-team-pick="team_a"]');
  const photoExists=await evaluate(`!!document.querySelector('[data-delete-photo="test/photo-1.jpg"]')`);
  assert(photoExists,'Foto test non renderizzata');
  await evaluate(`(()=>{const b=document.querySelector('[data-delete-photo="test/photo-1.jpg"]');b.focus();b.click();b.click();return true;})()`);await delay(80);
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
  fixtureRoot=prepareFileFixture();baseUrl='inline://';
  await launchBrowser();
  try{
    await testPageLoads();
    await testResponsive();
    await testTeamLogoRendering();
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
    if(server)await new Promise(resolve=>server.close(resolve));
    try{if(fixtureRoot)fs.rmSync(fixtureRoot,{recursive:true,force:true});}catch{}
  }
  console.log(JSON.stringify({root,pages:pages.length,widths,results,runtimeErrors,localNetworkErrors},null,2));
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
run().catch(error=>{console.error(error.stack||error);try{browser?.kill('SIGTERM');}catch{}try{server?.close();}catch{}process.exit(1);});
