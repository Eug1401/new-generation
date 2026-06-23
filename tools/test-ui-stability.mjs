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
const widths=[320,360,375,390,412,430,480,768,1024,1280,1440,1920];
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
      articles:[
        {id:'article_1',title:'Notizia test',body:'Contenuto di prova per la stabilità della modale.',image:'',category:'Aggiornamenti',author:'Redazione Test',status:'published',slug:'notizia-test',publishedAt:'2026-06-20T10:00:00Z',createdAt:'2026-06-20T10:00:00Z',updatedAt:'2026-06-20T10:00:00Z'},
        {id:'article_2',title:'Titolo molto lungo per verificare che la card editoriale rimanga leggibile senza tagliare informazioni importanti su smartphone e desktop',subtitle:'Sottotitolo editoriale con caratteri accentati, emoji ⚽ e informazioni aggiuntive',excerpt:'Estratto lungo usato per controllare il troncamento visivo controllato senza perdita del contenuto completo.',body:'## Analisi completa\\nPrimo paragrafo con **grassetto**, *corsivo* e [collegamento](https://example.com).\\n- Prima voce\\n- Seconda voce\\n> Una citazione leggibile.\\nParolaMoltoLungaSenzaSpaziCheNonDeveCreareScrollOrizzontale1234567890',image:tall,imageAlt:'Locandina verticale del torneo',imageCaption:'Didascalia immagine verticale',category:'Approfondimenti',author:'Ada Rossi',tags:['torneo','analisi'],status:'published',slug:'analisi-completa',publishedAt:'2026-06-21T12:00:00Z',createdAt:'2026-06-21T11:00:00Z',updatedAt:'2026-06-21T12:00:00Z'},
        {id:'article_3',title:'Bozza riservata',body:'<script>window.__articleXss=true</script> Testo bozza.',image:wide,category:'Comunicati',author:'Admin',status:'draft',slug:'bozza-riservata',createdAt:'2026-06-21T13:00:00Z',updatedAt:'2026-06-21T13:00:00Z'},
        {id:'article_4',title:'Articolo programmato futuro',body:'Non deve essere ancora visibile.',image:circle,category:'Programmati',author:'Admin',status:'scheduled',slug:'programmato-futuro',publishedAt:'2099-01-01T09:00:00Z',createdAt:'2026-06-21T14:00:00Z',updatedAt:'2026-06-21T14:00:00Z'}
      ],
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
async function testArticleAndPhotoAcceptance(){
  const targetWidths=[320,375,430,768,1024,1280,1440];
  const articleSamples=[];
  const photoSamples=[];
  const failures=[];

  await setViewport(1280,900);await navigate('index.html');await seedState();
  await evaluate(`(()=>{
    const store=NexoraStore;
    for(const scope of ['public','admin']){
      const state=store.load(scope);
      const article=state.articles.find(item=>item.id==='article_1');
      if(article)article.title='Campioni!';
      store.save(scope,state);
    }
    return true;
  })()`);

  for(const width of targetWidths){
    await setViewport(width,width<=430?780:900);await navigate('index.html');await click('[data-tab="articles"]');await click('[data-article-open="article_1"]');await delay(80);
    const sample=await evaluate(`(()=>{
      const root=document.querySelector('#articleModalBody .article-detail-editorial');
      const header=root?.querySelector('.article-detail-header');
      const heading=root?.querySelector('.article-detail-heading');
      const title=root?.querySelector('h1');
      const category=root?.querySelector('.article-detail-category');
      const meta=root?.querySelector('.article-detail-meta-panel');
      const modal=document.querySelector('.article-modal-content');
      const rect=el=>el?.getBoundingClientRect();
      const intersects=(a,b)=>!!(a&&b&&a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1);
      const tokenRects=[];
      if(title?.firstChild?.nodeType===Node.TEXT_NODE){
        const text=title.firstChild.data;
        for(const match of text.matchAll(/\\S+/g)){
          const range=document.createRange();range.setStart(title.firstChild,match.index);range.setEnd(title.firstChild,match.index+match[0].length);
          tokenRects.push({token:match[0],lines:range.getClientRects().length});
        }
      }
      const hr=rect(header),hgr=rect(heading),tr=rect(title),cr=rect(category),mr=rect(meta);
      const cs=title?getComputedStyle(title):null;
      return {
        width:innerWidth,title:title?.textContent||'',tokenRects,
        wordBreak:cs?.wordBreak||'',overflowWrap:cs?.overflowWrap||'',hyphens:cs?.hyphens||'',fontSize:cs?.fontSize||'',
        docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        modalOverflow:modal?modal.scrollWidth-modal.clientWidth:999,
        overlap:intersects(hgr,mr),
        contained:[hgr,tr,cr,mr].filter(Boolean).every(r=>hr&&r.left>=hr.left-1&&r.right<=hr.right+1),
        metaRows:root?.querySelectorAll('.article-detail-meta > *').length||0
      };
    })()`);
    articleSamples.push(sample);
    const ok=sample.title==='Campioni!'&&sample.tokenRects.every(row=>row.lines===1)&&sample.wordBreak==='normal'&&['normal','break-word'].includes(sample.overflowWrap)&&sample.hyphens==='none'&&sample.docOverflow<=1&&sample.modalOverflow<=1&&!sample.overlap&&sample.contained&&sample.metaRows>=4;
    if(!ok)failures.push(`Articolo ${width}px: ${JSON.stringify(sample)}`);
    await click('#closeArticleModal');
  }

  for(const width of targetWidths){
    await setViewport(width,width<=430?780:900);await navigate('index.html');await click('[data-tab="articles"]');await click('[data-article-open="article_2"]');await delay(80);
    const sample=await evaluate(`(()=>{
      const root=document.querySelector('#articleModalBody .article-detail-editorial');
      const title=root?.querySelector('h1');
      const body=root?.querySelector('.article-full-text');
      const modal=document.querySelector('.article-modal-content');
      const normalTokens=[];
      if(title?.firstChild?.nodeType===Node.TEXT_NODE){
        const text=title.firstChild.data;
        for(const match of text.matchAll(/\\S+/g)){
          if(match[0].length>28)continue;
          const range=document.createRange();range.setStart(title.firstChild,match.index);range.setEnd(title.firstChild,match.index+match[0].length);
          normalTokens.push({token:match[0],lines:range.getClientRects().length});
        }
      }
      return {width:innerWidth,normalTokens,docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,modalOverflow:modal?modal.scrollWidth-modal.clientWidth:999,bodyOverflow:body?body.scrollWidth-body.clientWidth:999};
    })()`);
    articleSamples.push({...sample,case:'contenuto-lungo'});
    const ok=sample.normalTokens.length>0&&sample.normalTokens.every(row=>row.lines===1)&&sample.docOverflow<=1&&sample.modalOverflow<=1&&sample.bodyOverflow<=1;
    if(!ok)failures.push(`Contenuto articolo ${width}px: ${JSON.stringify(sample)}`);
    await click('#closeArticleModal');
  }

  await setViewport(1280,900);await navigate('admin-photos.html');
  await evaluate(`(()=>{
    const pixel='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const sample={id:'acceptance-logo',path:'acceptance/logo-ufficiale.png',publicId:'acceptance/logo-ufficiale',teamId:'team_a',title:'Logo ufficiale della squadra con un titolo descrittivo molto lungo',name:'logo-ufficiale.png',originalName:'nome-file-logo-ufficiale-estremamente-lungo-per-verificare-ellissi-e-contenimento.png',description:'Descrizione molto lunga usata per verificare il ritorno a capo controllato senza invadere anteprima, informazioni o pulsanti della scheda amministrativa.',album:'Loghi ufficiali',altText:'Logo ufficiale della squadra Aurora FC',size:204800,width:1200,height:800,ts:Date.now(),thumbUrl:pixel,originalUrl:pixel,url:pixel};
    window.NexoraPhotos.listTeamPhotos=()=>[sample];
    window.NexoraPhotos.originalDownloadUrl=()=>pixel;
    return true;
  })()`);
  await click('[data-team-pick="team_a"]');
  await waitFor(()=>evaluate(`document.querySelector('.photo-admin-card img')?.complete===true`),{label:'card foto acceptance'});

  for(const width of targetWidths){
    await setViewport(width,width<=430?900:1000);await delay(420);
    const sample=await evaluate(`(()=>{
      const card=document.querySelector('.photo-admin-card');
      const media=card?.querySelector('.photo-card-media');
      const content=card?.querySelector('.photo-card-content');
      const actions=card?.querySelector('.photo-card-actions');
      const image=card?.querySelector('img');
      const grid=document.querySelector('#photosGrid');
      const logo=document.querySelector('.photos-team-logo-slot');
      const copy=document.querySelector('.photos-team-copy');
      const rect=el=>el?.getBoundingClientRect();
      const intersects=(a,b)=>!!(a&&b&&a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1);
      const mr=rect(media),cr=rect(content),ar=rect(actions),lr=rect(logo),tr=rect(copy);
      const buttons=[...card.querySelectorAll('.photo-card-actions .btn')];
      return {
        width:innerWidth,
        docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        cardOverflow:card?card.scrollWidth-card.clientWidth:999,
        objectFit:image?getComputedStyle(image).objectFit:'',alt:image?.alt||'',
        mediaBeforeContent:!!(mr&&cr&&mr.bottom<=cr.top+1),
        mediaBeforeActions:!!(mr&&ar&&mr.bottom<=ar.top+1),
        logoTextOverlap:intersects(lr,tr),
        actionHeights:buttons.map(button=>Math.round(button.getBoundingClientRect().height)),
        actionMinHeights:buttons.map(button=>getComputedStyle(button).minHeight),
        actionTransforms:buttons.map(button=>getComputedStyle(button).transform),
        cardTransform:getComputedStyle(card).transform,
        deletePosition:getComputedStyle(card.querySelector('.photo-card-delete')).position,
        columns:getComputedStyle(grid).gridTemplateColumns,
        cards:grid.querySelectorAll('.photo-admin-card').length,
        hasCopy:!!card.querySelector('[data-photo-copy]'),hasReplace:!!card.querySelector('[data-photo-replace]'),hasEdit:!!card.querySelector('[data-photo-edit]'),hasDelete:!!card.querySelector('[data-delete-photo]')
      };
    })()`);
    photoSamples.push(sample);
    const oneColumn=width>600||!sample.columns.trim().includes(' ');
    const ok=sample.docOverflow<=1&&sample.cardOverflow<=1&&sample.objectFit==='contain'&&Boolean(sample.alt)&&sample.mediaBeforeContent&&sample.mediaBeforeActions&&!sample.logoTextOverlap&&sample.actionHeights.length===7&&sample.actionHeights.every(height=>height>=44)&&sample.deletePosition!=='absolute'&&sample.cards===1&&sample.hasCopy&&sample.hasReplace&&sample.hasEdit&&sample.hasDelete&&oneColumn;
    if(!ok)failures.push(`Foto ${width}px: ${JSON.stringify(sample)}`);
  }

  record('Criteri UI Articoli/Foto alle larghezze richieste',failures.length===0,failures.length?failures.join(' | '):JSON.stringify({widths:targetWidths,articleSamples,photoSamples}));
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
  await click('[data-favorite-team="team_a"]');await delay(80);
  const favoriteAdded=await evaluate(`(()=>{const logo=document.querySelector('.team-disclosure[data-team-id="team_a"] .team-logo-wrap[data-team-id="team_a"]');const card=document.querySelector('.team-disclosure[data-team-id="team_a"]');const button=document.querySelector('[data-favorite-team="team_a"]');return {logoVisible:!!logo&&getComputedStyle(logo).backgroundImage!=='none',logoHighlighted:!!logo?.classList.contains('is-favorite-team'),cardHighlighted:!!card?.classList.contains('is-favorite-team'),buttonActive:!!button?.classList.contains('active'),pressed:button?.getAttribute('aria-pressed')||''};})()`);
  if(!favoriteAdded.logoVisible||favoriteAdded.logoHighlighted||!favoriteAdded.cardHighlighted||!favoriteAdded.buttonActive||favoriteAdded.pressed!=='true')failures.push('aggiunta preferito altera lo stemma o non aggiorna correttamente la card: '+JSON.stringify(favoriteAdded));
  await click('[data-favorite-team="team_a"]');await delay(80);
  const favoriteRemoved=await evaluate(`(()=>{const logo=document.querySelector('.team-disclosure[data-team-id="team_a"] .team-logo-wrap[data-team-id="team_a"]');const card=document.querySelector('.team-disclosure[data-team-id="team_a"]');const button=document.querySelector('[data-favorite-team="team_a"]');return {logoVisible:!!logo&&getComputedStyle(logo).backgroundImage!=='none',logoHighlighted:!!logo?.classList.contains('is-favorite-team'),cardHighlighted:!!card?.classList.contains('is-favorite-team'),buttonActive:!!button?.classList.contains('active'),pressed:button?.getAttribute('aria-pressed')||''};})()`);
  if(!favoriteRemoved.logoVisible||favoriteRemoved.logoHighlighted||favoriteRemoved.cardHighlighted||favoriteRemoved.buttonActive||favoriteRemoved.pressed!=='false')failures.push('rimozione preferito altera lo stemma o lascia associazioni stale: '+JSON.stringify(favoriteRemoved));
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


async function testArticlesEndToEnd(){
  const checks=[];
  const add=(name,ok,details='')=>{checks.push({name,ok:Boolean(ok),details});console.log(`[articles] ${ok?'PASS':'FAIL'} · ${name}`);if(!ok)throw new Error(`Articoli · ${name}${details?`: ${details}`:''}`);};

  await setViewport(1280,900);await navigate('index.html');await seedState();await navigate('index.html');await click('[data-tab="articles"]');
  let publicState=await evaluate(`(()=>{
    const cards=[...document.querySelectorAll('#publicArticles .article-card')];
    const titles=cards.map(c=>c.querySelector('h3')?.textContent||'');
    const image=document.querySelector('[data-article-id="article_2"] img.article-image');
    return {count:cards.length,badge:document.querySelector('#publicArticleCount')?.textContent||'',titles,draft:!!document.querySelector('[data-article-id="article_3"]'),scheduled:!!document.querySelector('[data-article-id="article_4"]'),alt:image?.alt||'',href:document.querySelector('[data-article-id="article_2"] a')?.getAttribute('href')||'',nullText:document.querySelector('#publicArticles')?.textContent.includes('null')||document.querySelector('#publicArticles')?.textContent.includes('undefined')};
  })()`);
  add('lista pubblica filtra bozze e programmati',publicState.count===2&&!publicState.draft&&!publicState.scheduled,JSON.stringify(publicState));
  add('titoli e immagini accessibili',publicState.titles.some(t=>t.startsWith('Titolo molto lungo'))&&publicState.alt==='Locandina verticale del torneo'&&publicState.href==='#article=analisi-completa'&&!publicState.nullText,JSON.stringify(publicState));

  await evaluate(`(()=>{const input=document.querySelector('#publicArticleSearch');input.value='analisi completa';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(220);
  let filterState=await evaluate(`({cards:document.querySelectorAll('#publicArticles .article-card').length,ids:[...document.querySelectorAll('#publicArticles .article-card')].map(x=>x.dataset.articleId)})`);
  add('ricerca pubblica',filterState.cards===1&&filterState.ids[0]==='article_2',JSON.stringify(filterState));
  await click('#clearArticleFilters');
  await evaluate(`(()=>{const select=document.querySelector('#publicArticleCategory');select.value='Approfondimenti';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(100);
  filterState=await evaluate(`({cards:document.querySelectorAll('#publicArticles .article-card').length,id:document.querySelector('#publicArticles .article-card')?.dataset.articleId||''})`);
  add('filtro categoria pubblico',filterState.cards===1&&filterState.id==='article_2',JSON.stringify(filterState));
  await click('#clearArticleFilters');

  await evaluate(`document.body.style.minHeight='2400px';window.scrollTo(0,420)`);const scrollBefore=await evaluate('window.scrollY');
  await click('[data-article-open="article_1"]');
  let modal=await overlayState('#articleModal');
  let detail=await evaluate(`({hash:location.hash,title:document.querySelector('#articleModalTitle')?.textContent||'',body:document.querySelector('#articleModalBody')?.textContent||'',dialog:document.querySelector('#articleModal')?.getAttribute('role')||'',photoSections:document.querySelectorAll('#articleModalBody .article-detail-media').length,mainLandmarks:document.querySelectorAll('main').length})`);
  add('apertura dettaglio con URL stabile',modal.open&&detail.hash==='#article=notizia-test'&&detail.title==='Notizia test'&&detail.body.includes('Contenuto di prova')&&detail.dialog==='dialog'&&detail.photoSections===0&&detail.mainLandmarks===1,JSON.stringify({modal,detail}));
  await evaluate('history.back()');await waitFor(()=>evaluate(`!document.querySelector('#articleModal')?.classList.contains('open')`),{label:'history back article'});
  await waitFor(()=>evaluate(`Math.abs(window.scrollY-${scrollBefore})<2`),{label:'restore article list scroll'});
  const scrollAfter=await evaluate('window.scrollY');
  add('pulsante indietro e posizione lista',Math.abs(scrollBefore-scrollAfter)<2,JSON.stringify({scrollBefore,scrollAfter,hash:await evaluate('location.hash')}));

  await click('[data-article-open="article_2"]');
  detail=await evaluate(`(()=>{const root=document.querySelector('#articleModalBody');const img=root.querySelector('.article-detail-media img');return {title:root.querySelector('h1')?.textContent||'',h3:root.querySelector('.article-full-text h3')?.textContent||'',strong:root.querySelector('.article-full-text strong')?.textContent||'',em:root.querySelector('.article-full-text em')?.textContent||'',link:root.querySelector('.article-full-text a')?.href||'',list:root.querySelectorAll('.article-full-text li').length,quote:root.querySelector('blockquote')?.textContent||'',objectFit:img?getComputedStyle(img).objectFit:'',caption:root.querySelector('figcaption')?.textContent||'',scriptCount:root.querySelectorAll('script').length};})()`);
  add('dettaglio completo e formattazione sicura',detail.title.startsWith('Titolo molto lungo')&&detail.h3==='Analisi completa'&&detail.strong==='grassetto'&&detail.em==='corsivo'&&detail.link.startsWith('https://example.com')&&detail.list===2&&detail.quote.includes('citazione')&&detail.objectFit==='contain'&&detail.caption.includes('Didascalia')&&detail.scriptCount===0,JSON.stringify(detail));
  const photoLayout=await evaluate(`(()=>{const root=document.querySelector('#articleModalBody .article-detail-editorial');const header=root?.querySelector('.article-detail-header');const photo=root?.querySelector('.article-featured-photo');const frame=root?.querySelector('.article-featured-photo-frame');const body=root?.querySelector('.article-detail-body');const img=photo?.querySelector('img');const hint=photo?.querySelector('.article-image-open-hint');const hr=header?.getBoundingClientRect();const pr=photo?.getBoundingClientRect();const br=body?.getBoundingClientRect();const fr=frame?.getBoundingClientRect();return {sections:root?.querySelectorAll('.article-featured-photo').length||0,detailDisplay:root?getComputedStyle(root).display:'',photoPosition:photo?getComputedStyle(photo).position:'',hintPosition:hint?getComputedStyle(hint).position:'',headerBeforePhoto:!!(hr&&pr&&hr.bottom<=pr.top+2),photoBeforeBody:!!(pr&&br&&pr.bottom<=br.top+2),frameWidth:fr?.width||0,modalWidth:document.querySelector('.article-modal-content')?.getBoundingClientRect().width||0,imgObjectFit:img?getComputedStyle(img).objectFit:'',overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};})()`);
  add('fotografia in sezione editoriale autonoma e ordinata',photoLayout.sections===1&&photoLayout.detailDisplay==='block'&&photoLayout.photoPosition==='relative'&&photoLayout.hintPosition==='static'&&photoLayout.headerBeforePhoto&&photoLayout.photoBeforeBody&&photoLayout.frameWidth>300&&photoLayout.frameWidth<photoLayout.modalWidth&&photoLayout.imgObjectFit==='contain'&&photoLayout.overflow<=1,JSON.stringify(photoLayout));
  await evaluate(`(()=>{const opener=document.querySelector('#articleModalBody [data-article-image-open]');opener.focus();opener.click();document.querySelector('.article-image-viewer [data-article-viewer-in]').click();})()`);
  await delay(60);
  const articleViewer=await evaluate(`(()=>{const root=document.querySelector('.article-image-viewer');return {open:root.classList.contains('open'),hidden:root.getAttribute('aria-hidden'),zoom:root.querySelector('[data-article-viewer-label]').textContent,focusClose:document.activeElement===root.querySelector('.article-image-viewer-close')};})()`);
  await pressKey('Escape');await delay(60);
  const articleViewerClosed=await evaluate(`!document.querySelector('.article-image-viewer').classList.contains('open')&&document.activeElement===document.querySelector('#articleModalBody [data-article-image-open]')&&document.body.classList.contains('ng-overlay-open')&&document.querySelector('#articleModal').classList.contains('open')`);
  add('visualizzatore fotografia: zoom, Escape e ritorno focus',articleViewer.open&&articleViewer.hidden==='false'&&articleViewer.zoom==='150%'&&articleViewer.focusClose&&articleViewerClosed,JSON.stringify({articleViewer,articleViewerClosed}));
  const hashBeforeRefresh=await evaluate('location.hash');await navigate('index.html');await waitFor(()=>evaluate(`document.querySelector('#articleModal')?.classList.contains('open')`),{label:'direct article refresh'});
  const refreshed=await evaluate(`({hash:location.hash,title:document.querySelector('#articleModalBody h1')?.textContent||'',cards:document.querySelectorAll('#publicArticles .article-card').length})`);
  add('refresh e URL diretto',hashBeforeRefresh==='#article=analisi-completa'&&refreshed.hash===hashBeforeRefresh&&refreshed.title.startsWith('Titolo molto lungo'),JSON.stringify(refreshed));

  await evaluate(`history.pushState({},'','#article=notizia-test');window.dispatchEvent(new HashChangeEvent('hashchange'));`);await delay(100);
  const switched=await evaluate(`({title:document.querySelector('#articleModalBody h1')?.textContent||'',old:document.querySelector('#articleModalBody')?.textContent.includes('Analisi completa')||false})`);
  add('apertura ripetuta senza contenuto precedente',switched.title==='Notizia test'&&!switched.old,JSON.stringify(switched));
  await evaluate(`history.pushState({},'','#article=inesistente');window.dispatchEvent(new HashChangeEvent('hashchange'));`);await delay(100);
  const missing=await evaluate(`document.querySelector('#articleModalBody')?.textContent||''`);
  add('articolo inesistente',missing.includes('Articolo non disponibile'),missing);
  await click('#closeArticleModal');

  const responsive=[];
  for(const [width,height] of [[320,700],[390,844],[844,390],[768,1024],[1440,900]]){
    await setViewport(width,height);await navigate('index.html');await click('[data-tab="articles"]');await delay(80);
    const data=await evaluate(`(()=>{const card=document.querySelector('#publicArticles .article-card');const main=card?.querySelector('.article-card-main');const media=card?.querySelector('.article-media');const title=card?.querySelector('h3');const r=card?.getBoundingClientRect();return {width:${width},doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,cardRight:r?.right||0,vw:innerWidth,columns:main?getComputedStyle(main).gridTemplateColumns:'',mainAreas:main?getComputedStyle(main).gridTemplateAreas:'',mediaArea:media?getComputedStyle(media).gridArea:'',mediaColumn:media?getComputedStyle(media).gridColumn:'',contentArea:card?.querySelector('.article-content')?getComputedStyle(card.querySelector('.article-content')).gridArea:'',contentColumn:card?.querySelector('.article-content')?getComputedStyle(card.querySelector('.article-content')).gridColumn:'',mediaH:media?.getBoundingClientRect().height||0,titleDisplay:title?getComputedStyle(title).display:'',lineClamp:title?getComputedStyle(title).webkitLineClamp:'',touch:[...document.querySelectorAll('#articles button,#articles input,#articles select')].every(el=>el.getBoundingClientRect().height>=40)};})()`);
    responsive.push(data);
    add(`responsive ${width}px`,data.doc<=1&&data.cardRight<=data.vw+1&&data.mediaH>0&&(width<=760||data.mediaH<=301)&&data.titleDisplay==='block'&&(width>760||!data.columns.includes(' '))&&data.touch,JSON.stringify(data));
  }

  const detailResponsive=[];
  for(const [width,height] of [[320,700],[768,1024],[1440,900]]){
    await setViewport(width,height);await navigate('index.html');await click('[data-tab="articles"]');await click('[data-article-open="article_2"]');await delay(100);
    const data=await evaluate(`(()=>{const modal=document.querySelector('.article-modal-content');const detail=document.querySelector('#articleModalBody .article-detail-editorial');const photo=detail?.querySelector('.article-featured-photo');const frame=detail?.querySelector('.article-featured-photo-frame');const img=detail?.querySelector('.article-featured-photo img');const body=detail?.querySelector('.article-detail-body');const pr=photo?.getBoundingClientRect();const br=body?.getBoundingClientRect();return {width:${width},overflow:modal?modal.scrollWidth-modal.clientWidth:999,detailDisplay:detail?getComputedStyle(detail).display:'',photoWidth:pr?.width||0,viewport:innerWidth,frameMinHeight:frame?parseFloat(getComputedStyle(frame).minHeight):0,imgFit:img?getComputedStyle(img).objectFit:'',ordered:!!(pr&&br&&pr.bottom<=br.top+2)};})()`);
    detailResponsive.push(data);
    add(`dettaglio fotografico responsive ${width}px`,data.overflow<=1&&data.detailDisplay==='block'&&data.photoWidth>0&&data.photoWidth<=data.viewport+1&&data.frameMinHeight>=180&&data.imgFit==='contain'&&data.ordered,JSON.stringify(data));
    await click('#closeArticleModal');
  }

  await setViewport(1280,900);await navigate('admin-articles.html');
  let adminState=await evaluate(`({cards:document.querySelectorAll('#adminArticlesList .article-card').length,drafts:document.querySelectorAll('.status-draft').length,scheduled:document.querySelectorAll('.status-scheduled').length,fields:['articleTitle','articleSubtitle','articleExcerpt','articleAuthor','articleCategory','articleTags','articleBody','articleImage','articleImageAlt','articleImageCaption','articleStatus','articlePublishedAt','articleSlug'].every(id=>!!document.getElementById(id))})`);
  add('elenco e modulo admin completi',adminState.cards===4&&adminState.drafts===1&&adminState.scheduled===1&&adminState.fields,JSON.stringify(adminState));

  await evaluate(`(()=>{document.querySelector('#articleTitle').value='';document.querySelector('#articleBody').value='';})()`);await click('#articleSubmitBtn');await delay(80);
  const validation=await evaluate(`({errors:document.querySelectorAll('#articleFormErrors li').length,titleInvalid:document.querySelector('#articleTitle').getAttribute('aria-invalid'),bodyInvalid:document.querySelector('#articleBody').getAttribute('aria-invalid'),count:NexoraStore.selectors.allArticles(NexoraStore.load('admin')).length})`);
  add('validazione obbligatori',validation.errors===2&&validation.titleInvalid==='true'&&validation.bodyInvalid==='true'&&validation.count===4,JSON.stringify(validation));
  await navigate('admin-articles.html');

  const imageLoaded=await evaluate(`(()=>new Promise(resolve=>{
    const binary=atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8AARAwMjIwgAQAQAAH+Q0YzAAAAAElFTkSuQmCC');
    const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const file=new File([bytes],'test.png',{type:'image/png'});const dt=new DataTransfer();dt.items.add(file);
    const input=document.querySelector('#articleImage');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    const start=Date.now();const timer=setInterval(()=>{const img=document.querySelector('#articleImagePreview img');if(img&&img.src.startsWith('data:image/png')){clearInterval(timer);resolve(true);}else if(Date.now()-start>5000){clearInterval(timer);resolve(false);}},40);
  }))()`);
  add('upload e anteprima immagine',imageLoaded,String(imageLoaded));
  await evaluate(`(()=>{const set=(id,value,event='input')=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}));};set('articleTitle','Nuovo articolo end to end');set('articleSubtitle','Sottotitolo di prova');set('articleExcerpt','Estratto di prova');set('articleAuthor','Tester');set('articleCategory','Test');set('articleTags','uno, due');set('articleBody','## Titolo interno\\nCorpo **formattato** e [link](https://example.com).');set('articleImageAlt','Quadrato di prova');set('articleImageCaption','Didascalia prova');set('articleStatus','draft','change');return {slug:document.getElementById('articleSlug').value,dirty:document.getElementById('articleFormTitle').dataset.unsaved};})()`);
  const dirty=await evaluate(`({dirty:document.querySelector('#articleFormTitle').dataset.unsaved,slug:document.querySelector('#articleSlug').value})`);
  add('slug automatico e stato non salvato',dirty.dirty==='true'&&dirty.slug==='nuovo-articolo-end-to-end',JSON.stringify(dirty));
  await click('#articlePreviewBtn');modal=await overlayState('#articlePreviewModal');
  const preview=await evaluate(`({open:document.querySelector('#articlePreviewModal')?.classList.contains('open'),title:document.querySelector('#articlePreviewModalBody h1')?.textContent||'',imgAlt:document.querySelector('#articlePreviewModalBody img')?.alt||'',editorial:!!document.querySelector('#articlePreviewModalBody .article-detail-editorial')})`);
  add('anteprima amministratore',modal.open&&modal.bodyLocked&&preview.title==='Nuovo articolo end to end'&&preview.imgAlt==='Quadrato di prova'&&preview.editorial,JSON.stringify({modal,preview}));await pressKey('Escape');
  const previewClosed=await waitFor(()=>evaluate(`(()=>{const state={closed:!document.querySelector('#articlePreviewModal').classList.contains('open'),unlocked:!document.body.classList.contains('ng-overlay-open'),focus:document.activeElement===document.querySelector('#articlePreviewBtn')};return state.closed&&state.unlocked&&state.focus?state:false;})()`),{label:'chiusura anteprima amministratore'});
  add('anteprima: Escape e ritorno focus',previewClosed.closed&&previewClosed.unlocked&&previewClosed.focus,JSON.stringify(previewClosed));
  await click('#articleSubmitBtn');
  await waitFor(()=>evaluate(`NexoraStore.selectors.allArticles(NexoraStore.load('admin')).some(a=>a.title==='Nuovo articolo end to end')`),{label:'create draft article'});
  const created=await evaluate(`(()=>{const a=NexoraStore.selectors.allArticles(NexoraStore.load('admin')).find(a=>a.title==='Nuovo articolo end to end');return {id:a?.id||'',status:a?.status||'',image:a?.image?.slice(0,22)||'',tags:a?.tags||[],formTitle:document.querySelector('#articleTitle').value};})()`);
  add('creazione bozza senza perdita dati',created.id&&created.status==='draft'&&created.image.startsWith('data:image/png')&&created.tags.length===2&&created.formTitle==='',JSON.stringify(created));

  await navigate('index.html');await click('[data-tab="articles"]');
  add('bozza non visibile al pubblico',!(await evaluate(`!![...document.querySelectorAll('#publicArticles h3')].find(el=>el.textContent==='Nuovo articolo end to end')`)));

  await navigate('admin-articles.html');await click(`[data-edit-article="${created.id}"]`);
  await evaluate(`(()=>{const sub=document.querySelector('#articleSubtitle');sub.value='Modifica non salvata';sub.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>true;})()`);
  add('avviso modifiche non salvate',await evaluate(`document.querySelector('#articleFormTitle').dataset.unsaved==='true'`));
  await click('#cancelEditArticleBtn');add('annullamento modifica',await evaluate(`document.querySelector('#articleTitle').value===''&&document.querySelector('#articleFormTitle').dataset.unsaved==='false'`));

  await click(`[data-edit-article="${created.id}"]`);
  await evaluate(`(()=>{const status=document.querySelector('#articleStatus');status.value='published';status.dispatchEvent(new Event('change',{bubbles:true}));const date=document.querySelector('#articlePublishedAt');const d=new Date(Date.now()-60000);date.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);date.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#articleSubmitBtn');await waitFor(()=>evaluate(`NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})?.status==='published'`),{label:'publish article'});
  await navigate('index.html');await click('[data-tab="articles"]');
  add('pubblicazione aggiorna il pubblico',await evaluate(`!![...document.querySelectorAll('#publicArticles h3')].find(el=>el.textContent==='Nuovo articolo end to end')`));

  await navigate('admin-articles.html');
  await click('[data-preview-article="article_3"]');
  const safePreview=await evaluate(`({scripts:document.querySelectorAll('#articlePreviewModalBody script').length,text:document.querySelector('#articlePreviewModalBody')?.textContent||'',xss:window.__articleXss===true})`);
  add('sanificazione contenuto',safePreview.scripts===0&&!safePreview.xss&&safePreview.text.includes('<script>'),JSON.stringify(safePreview));await pressKey('Escape');

  const invalidFile=await evaluate(`(()=>new Promise(resolve=>{const file=new File([new Uint8Array(13*1024*1024)],'troppo-grande.jpg',{type:'image/jpeg'});const dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('#articleImage');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));const start=Date.now();const timer=setInterval(()=>{const text=document.querySelector('#articleMsg')?.textContent||'';if(text.includes('12 MB')){clearInterval(timer);resolve(text);}else if(Date.now()-start>3000){clearInterval(timer);resolve(text);}},40);}))()`);
  add('rifiuto immagine troppo grande',String(invalidFile).includes('12 MB'),String(invalidFile));

  await click(`[data-delete-article="${created.id}"]`);let deleteDialog=await overlayState('#deleteArticleDialog');
  const deleteVisual=await evaluate(`(()=>{const el=document.querySelector('#deleteArticleDialog');const style=getComputedStyle(el);return {opacity:style.opacity,pointerEvents:style.pointerEvents,display:style.display,open:el.classList.contains('open'),label:document.querySelector('#confirmDeleteArticleBtn')?.textContent||''};})()`);
  add('conferma eliminazione esplicita e interattiva',deleteDialog.open&&deleteDialog.bodyLocked&&deleteVisual.open&&deleteVisual.opacity==='1'&&deleteVisual.pointerEvents!=='none'&&deleteVisual.label.includes('Elimina articolo')&&(await evaluate(`document.querySelector('#deleteArticleDialogText').textContent.includes('Nuovo articolo end to end')`)),JSON.stringify({deleteDialog,deleteVisual}));
  await pressKey('Escape');
  add('eliminazione: Escape e ritorno focus',await evaluate(`!document.querySelector('#deleteArticleDialog').classList.contains('show')&&!document.querySelector('#deleteArticleDialog').classList.contains('open')&&!document.body.classList.contains('ng-overlay-open')&&document.activeElement===document.querySelector(${JSON.stringify(`[data-delete-article="${created.id}"]`)})`));
  await click(`[data-preview-article="${created.id}"]`);await click('#deleteArticleFromPreviewBtn');
  add('eliminazione disponibile dal dettaglio admin',await evaluate(`document.querySelector('#articlePreviewModal').classList.contains('open')&&document.querySelector('#deleteArticleDialog').classList.contains('open')&&document.querySelector('#deleteArticleDialogText').textContent.includes('Nuovo articolo end to end')`));
  await click('#cancelDeleteArticleBtn');await pressKey('Escape');
  await click(`[data-delete-article="${created.id}"]`);await click('#cancelDeleteArticleBtn');
  add('annullamento eliminazione',!(await overlayState('#deleteArticleDialog')).open&&await evaluate(`!!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})`));
  const invalidDelete=await evaluate(`(()=>{const fake=document.createElement('button');fake.type='button';fake.dataset.deleteArticle='';document.body.appendChild(fake);fake.click();fake.remove();return {open:document.querySelector('#deleteArticleDialog').classList.contains('open'),message:document.querySelector('#articleMsg')?.textContent||''};})()`);
  add('ID eliminazione non valido bloccato',!invalidDelete.open&&invalidDelete.message.includes('identificativo articolo non valido'),JSON.stringify(invalidDelete));
  await click(`[data-delete-article="${created.id}"]`);
  await evaluate(`NEW_GENERATION_SUPABASE.ENABLED=true;window.__deleteRemoteCalls=0;NG_FORCE_REMOTE_SAVE=()=>{window.__deleteRemoteCalls++;return Promise.resolve(false);};`);
  await click('#confirmDeleteArticleBtn');await waitFor(()=>evaluate(`document.querySelector('#deleteArticleDialogMsg')?.textContent.includes('non ha confermato')`),{label:'delete backend false'});
  const rollback=await evaluate(`({exists:!!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true}),open:document.querySelector('#deleteArticleDialog').classList.contains('show'),calls:window.__deleteRemoteCalls,busy:document.querySelector('#confirmDeleteArticleBtn').disabled})`);
  add('errore backend mantiene articolo e consente nuovo tentativo',rollback.exists&&rollback.open&&rollback.calls===1&&!rollback.busy,JSON.stringify(rollback));
  await evaluate(`NEW_GENERATION_SUPABASE.ENABLED=false;`);
  await evaluate(`(()=>{const b=document.querySelector('#confirmDeleteArticleBtn');b.click();b.click();})()`);
  await waitFor(()=>evaluate(`!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})&&!document.querySelector('#deleteArticleDialog').classList.contains('show')`),{label:'final delete'});
  add('eliminazione e doppio click',true);
  await navigate('admin-articles.html');
  add('refresh dopo eliminazione non ripristina articolo',!(await evaluate(`!!NexoraStore.selectors.articleById(NexoraStore.load('admin'),${JSON.stringify(created.id)},{includeDrafts:true})`)));

  await setViewport(390,844);await navigate('admin-articles.html');
  const adminMobile=await evaluate(`(()=>{const actions=[...document.querySelectorAll('.article-admin-actions .btn')];return {overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,actions:actions.length,large:actions.every(b=>b.getBoundingClientRect().height>=44),columns:getComputedStyle(document.querySelector('.article-admin-layout')).gridTemplateColumns};})()`);
  add('admin mobile e touch',adminMobile.overflow<=1&&adminMobile.actions>0&&adminMobile.large&&!adminMobile.columns.includes(' '),JSON.stringify(adminMobile));

  record('Articoli end-to-end: pubblico, admin, immagini, sicurezza, URL, responsive e sincronizzazione',checks.every(c=>c.ok),JSON.stringify(checks));
}

async function testSimulationDialog(){
  await setViewport(1280,900);await navigate('admin.html');
  await evaluate(`window.__preWizardState=structuredClone(NexoraStore.load('admin'));`);
  await click('#simulateTournamentBtn');let st=await overlayState('#simulationDialog');
  const initial=await evaluate(`({title:document.querySelector('#simulationStepBody h3')?.textContent||'',steps:document.querySelectorAll('.simulation-stepper li').length,generated:document.querySelector('input[name="simulationTeamMode"][value="generated"]')?.checked,existingDisabled:document.querySelector('input[name="simulationTeamMode"][value="existing"]')?.disabled})`);
  const openOk=st.open&&st.bodyLocked&&st.count===1&&initial.steps===5&&initial.generated&&initial.existingDisabled&&initial.title.includes('squadre già presenti');
  await pressKey('Escape');st=await overlayState('#simulationDialog');const escapeOk=!st.open&&!st.bodyLocked&&await evaluate(`document.activeElement===document.querySelector('#simulateTournamentBtn')`);
  for(let i=0;i<10;i++){await click('#simulateTournamentBtn');await click('#cancelSimulationBtn');}
  st=await overlayState('#simulationDialog');const cyclesOk=!st.open&&!st.bodyLocked&&st.count===1;
  await evaluate(`(()=>{const b=document.querySelector('#simulateTournamentBtn');b.focus();b.click();b.click();return true;})()`);await delay(80);st=await overlayState('#simulationDialog');const doubleOk=st.open&&st.count===1;
  await click('#simulationDialog');st=await overlayState('#simulationDialog');const backdropOk=!st.open&&!st.bodyLocked;

  await click('#simulateTournamentBtn');
  const beforeChoice=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,running:NGTournamentSimulation.getWizardState()?.running,operation:NexoraStore.load('admin')._simulationOperationId||''})`);
  await click('input[name="simulationTeamMode"][value="generated"]');await delay(80);
  const afterChoice=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,running:NGTournamentSimulation.getWizardState()?.running,operation:NexoraStore.load('admin')._simulationOperationId||'',title:document.querySelector('#simulationStepBody h3')?.textContent||''})`);
  await evaluate(`document.querySelector('input[name="simulationTeamMode"][value="generated"]').focus()`);await pressKey('Enter');await delay(60);
  const afterEnter=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,running:NGTournamentSimulation.getWizardState()?.running,operation:NexoraStore.load('admin')._simulationOperationId||''})`);
  const noEarlyStart=beforeChoice.step===0&&!beforeChoice.running&&afterChoice.step===0&&!afterChoice.running&&afterChoice.operation===beforeChoice.operation&&afterEnter.step===0&&!afterEnter.running&&afterEnter.operation===beforeChoice.operation&&afterChoice.title.includes('squadre già presenti');
  await click('#simulationNextBtn');const formatOk=await evaluate(`document.querySelector('#simulationStepBody h3')?.textContent.includes('formato')&&document.querySelectorAll('input[name="simulationFormat"]').length===4`);
  await click('input[name="simulationFormat"][value="knockout"]');await click('#simulationNextBtn');const kingsOk=await evaluate(`document.querySelector('#simulationStepBody h3')?.textContent.includes('Kings')`);
  await click('input[name="simulationKings"][value="yes"]');await click('#simulationNextBtn');const durationOk=await evaluate(`document.querySelector('#simulationStepBody h3')?.textContent.includes('un solo giorno o in più giorni')`);
  await click('input[name="simulationDuration"][value="one_day"]');await click('#simulationNextBtn');
  const summaryBefore=await evaluate(`({summary:document.querySelector('.simulation-summary')?.textContent||'',disabled:document.querySelector('#simulationExecuteBtn')?.disabled,label:document.querySelector('#simulationExecuteBtn')?.textContent||'',step:NGTournamentSimulation.getWizardState()?.step})`);
  await click('#simulationReplaceConfirm');await click('#simulationTeamsConfirm');
  const summaryAfter=await evaluate(`(()=>{const payload=NGTournamentSimulation.getFinalPayload();return {enabled:!document.querySelector('#simulationExecuteBtn')?.disabled,label:document.querySelector('#simulationExecuteBtn')?.textContent||'',kings:document.querySelector('.simulation-summary')?.textContent.includes('presidente obbligatorio'),payload};})()`);
  await click('#simulationBackBtn');const backState=await evaluate(`({step:NGTournamentSimulation.getWizardState()?.step,duration:document.querySelector('input[name="simulationDuration"][value="one_day"]')?.checked})`);
  await click('#simulationNextBtn');
  const selectionsKept=backState.step===3&&backState.duration===true;
  const payloadOk=summaryAfter.payload?.teamMode==='generated'&&summaryAfter.payload?.generatedTeamCount===8&&summaryAfter.payload?.format==='knockout'&&summaryAfter.payload?.kings===true&&summaryAfter.payload?.presidentMode==='default_per_team'&&summaryAfter.payload?.duration==='one_day'&&summaryAfter.payload?.replaceTournamentConfirmed===true&&summaryAfter.payload?.replaceTeamsConfirmed===true&&summaryAfter.payload?.requestSource==='wizard-final-confirmation';
  await click('#simulationReplaceConfirm');await click('#simulationTeamsConfirm');
  await evaluate(`(()=>{const b=document.querySelector('#simulationExecuteBtn');b.click();b.click();})()`);
  await waitFor(()=>evaluate(`!!document.querySelector('.simulation-success')`),{label:'wizard final execution',timeout:15000});
  const completed=await evaluate(`(()=>{const s=NexoraStore.load('admin');return {teams:s.teams.length,players:s.teams.reduce((n,t)=>n+(t.players||[]).length,0),matches:s.matches.length,winner:s._simulationSummary?.winnerName||'',articlesSame:JSON.stringify(s.articles||[])===JSON.stringify(window.__preWizardState.articles||[]),running:NGTournamentSimulation.getWizardState()?.running};})()`);
  const completionOk=completed.teams===8&&completed.players===40&&completed.matches===7&&Boolean(completed.winner)&&completed.articlesSame&&completed.running===false;
  await click('#cancelSimulationBtn');
  await evaluate(`(()=>{NexoraStore.save('admin',window.__preWizardState);NexoraStore.save('public',window.__preWizardState);delete window.__preWizardState;})()`);
  const wizardOk=noEarlyStart&&formatOk&&kingsOk&&durationOk&&summaryBefore.step===4&&summaryBefore.disabled&&summaryBefore.label.includes('Genera torneo simulato')&&summaryAfter.enabled&&summaryAfter.kings&&payloadOk&&selectionsKept&&completionOk;
  record('Procedura Simula: nessun avvio anticipato, wizard completo, payload esplicito, avvio finale unico e ricaricamento',openOk&&escapeOk&&cyclesOk&&doubleOk&&backdropOk&&wizardOk,JSON.stringify({openOk,escapeOk,cyclesOk,doubleOk,backdropOk,wizardOk,noEarlyStart,initial,beforeChoice,afterChoice,afterEnter,summaryBefore,summaryAfter,backState,payloadOk,selectionsKept,completed,completionOk}));
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

  const stagingReady=await evaluate(`(async()=>{
    window.__photoUploadCalls=0;
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
    const ctx=canvas.getContext('2d');ctx.fillRect(0,0,2,2);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const file=new File([blob],'nuova foto speciale.png',{type:'image/png',lastModified:Date.now()});
    window.__testPhotoFile=file;
    const dt=new DataTransfer();dt.items.add(file);
    const input=document.querySelector('#photosFileInput');
    Object.defineProperty(input,'files',{value:dt.files,configurable:true});
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  assert(stagingReady,'Impossibile preparare il file locale per il test Foto');
  await waitFor(()=>evaluate(`!!document.querySelector('.staging-panel [data-remove-staged]')`),{label:'anteprima locale Foto'});
  const staging=await evaluate(`({
    panel:!!document.querySelector('.staging-panel'),
    name:document.querySelector('.staging-thumb-name')?.textContent||'',
    dimensions:document.querySelector('.staging-thumb small')?.textContent||'',
    confirmDisabled:document.querySelector('#photosStagingConfirmBtn')?.disabled||false
  })`);
  await click('.staging-thumb-remove');
  const removedBeforeUpload=await evaluate(`!document.querySelector('.staging-panel')&&!document.querySelector('[data-staging-id]')`);
  await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(window.__testPhotoFile);const input=document.querySelector('#photosFileInput');Object.defineProperty(input,'files',{value:dt.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await waitFor(()=>evaluate(`!!document.querySelector('.staging-panel [data-remove-staged]')`),{label:'ripristino anteprima locale Foto'});
  await evaluate(`(()=>{
    window.NexoraPhotos.uploadTeamPhoto=async(teamId,file)=>{
      window.__photoUploadCalls++;
      await new Promise(resolve=>setTimeout(resolve,120));
      return {id:'mock-photo',publicId:'squadra/'+teamId+'/mock-photo',path:'squadra/'+teamId+'/mock-photo',teamId,name:file.name,originalName:file.name,size:file.size,width:1,height:1,mimeType:file.type,thumbUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC/gAAAAASUVORK5CYII=',originalUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC/gAAAAASUVORK5CYII='};
    };
    window.NexoraPhotos.refreshAll=async()=>[];
  })()`);
  await evaluate(`(()=>{const b=document.querySelector('#photosStagingConfirmBtn');b.click();b.click();return true;})()`);
  await waitFor(()=>evaluate(`(window.__photoUploadCalls||0)===1 && document.querySelector('#photosFileInput')?.disabled===false`),{label:'upload Foto simulato',timeout:5000});
  const upload=await evaluate(`({calls:window.__photoUploadCalls||0,busy:document.querySelector('#photosFileInput')?.disabled||false,summary:document.querySelector('#photosMsg')?.textContent||'',failed:document.querySelectorAll('.upload-item-status.fail').length})`);
  const stagingOk=staging.panel&&staging.name==='nuova foto speciale.png'&&staging.dimensions.includes('2×2')&&!staging.confirmDisabled&&removedBeforeUpload&&upload.calls===1&&!upload.busy&&upload.failed===0;

  await navigate('index.html');
  await evaluate(`(()=>{
    const store=NexoraStore;const s=store.load('public');const rows=s.teamPhotos?.team_a||[];
    window.NexoraPhotos.status=()=>({loaded:true,loading:false,error:null});
    window.NexoraPhotos.getTeamPhotoMap=()=>({team_a:rows});
    window.NexoraPhotos.listTeamPhotos=()=>rows.map((p,i)=>({...p,teamId:'team_a',title:'Foto test accessibile',altText:'Foto test accessibile',thumbUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',originalUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',largeUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}));
    window.NexoraPhotos.originalDownloadUrl=()=> 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  })()`);
  await click('[data-tab="photos"]');
  await waitFor(()=>evaluate(`!!document.querySelector('[data-public-photo-open="0"]')`),{label:'foto pubblica accessibile'});
  const publicCard=await evaluate(`(()=>{const el=document.querySelector('[data-public-photo-open="0"]');return {role:el?.getAttribute('role')||'',tabindex:el?.getAttribute('tabindex')||'',aria:el?.getAttribute('aria-label')||'',alt:el?.querySelector('img')?.alt||''};})()`);
  await evaluate(`document.querySelector('[data-public-photo-open="0"]').focus()`);
  await pressKey('Enter');
  await waitFor(()=>evaluate(`document.querySelector('#publicPhotosLightbox')?.classList.contains('open')`),{label:'lightbox Foto da tastiera'});
  const publicOpen=await overlayState('#publicPhotosLightbox');
  await pressKey('Escape');
  const publicClosed=await overlayState('#publicPhotosLightbox');
  const publicFocus=await evaluate(`document.activeElement===document.querySelector('[data-public-photo-open="0"]')`);
  const publicKeyboardOk=publicCard.role==='button'&&publicCard.tabindex==='0'&&Boolean(publicCard.aria)&&Boolean(publicCard.alt)&&publicOpen.open&&!publicClosed.open&&publicFocus;

  record('Foto: conferma, lightbox, anteprima locale, doppio click upload e apertura pubblica da tastiera',doubleOk&&escapeOk&&cyclesOk&&backdropOk&&lightOpen&&lightEscape&&lightCycles&&stagingOk&&publicKeyboardOk,JSON.stringify({doubleOk,escapeOk,cyclesOk,backdropOk,lightOpen,lightEscape,lightCycles,staging,removedBeforeUpload,upload,stagingOk,publicCard,publicOpen,publicClosed,publicFocus,publicKeyboardOk,confirm:st,light}));
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
  const articlesOnly=process.argv.includes('--articles-only');
  const acceptanceOnly=process.argv.includes('--acceptance-only');
  const logosOnly=process.argv.includes('--logos-only');
  try{
    if(acceptanceOnly){
      await testArticleAndPhotoAcceptance();
    }else if(articlesOnly){
      await testArticlesEndToEnd();
    }else if(logosOnly){
      await testTeamLogoRendering();
    }else{
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
    }
    record('Console JavaScript e richieste locali',runtimeErrors.length===0&&localNetworkErrors.length===0,JSON.stringify({runtimeErrors,localNetworkErrors}));
  }finally{
    try{client?.close();}catch{}
    try{browser?.kill('SIGTERM');}catch{}
    if(server)await new Promise(resolve=>server.close(resolve));
    try{if(fixtureRoot)fs.rmSync(fixtureRoot,{recursive:true,force:true});}catch{}
  }
  console.log(JSON.stringify({root,pages:pages.length,widths,mode:acceptanceOnly?'acceptance':(articlesOnly?'articles':(logosOnly?'logos':'ui')),results,runtimeErrors,localNetworkErrors},null,2));
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
}
run().catch(error=>{console.error(error.stack||error);try{browser?.kill('SIGTERM');}catch{}try{server?.close();}catch{}process.exit(1);});
