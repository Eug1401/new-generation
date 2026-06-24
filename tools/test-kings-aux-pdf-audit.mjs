import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.cwd();
const memory=new Map();
const documents=[];
class FakeImage{set src(_v){queueMicrotask(()=>this.onerror?.(new Error('mock')));}}
class FakePdf{
 static API={autoTable(){}};
 constructor(opts={}){this.opts=opts;this.page=1;this.pages=1;this.fontSize=10;this.tables=[];this.texts=[];this.saved='';this.width=210;this.height=297;this.internal={pageSize:{getWidth:()=>this.width,getHeight:()=>this.height},getNumberOfPages:()=>this.pages};documents.push(this);}
 setFillColor(){}setDrawColor(){}setTextColor(){}setFont(){}setLineWidth(){}setProperties(){}rect(){}roundedRect(){}line(){}circle(){}addImage(){}
 setFontSize(v){this.fontSize=Number(v)||10;}text(v,x,y,o={}){(Array.isArray(v)?v:[v]).forEach(t=>this.texts.push({page:this.page,text:String(t),x,y,o}));}
 splitTextToSize(v,w){const s=String(v??'');const n=Math.max(8,Math.floor(Number(w)||40));const out=[];for(let i=0;i<s.length;i+=n)out.push(s.slice(i,i+n));return out.length?out:[''];}
 getTextWidth(v){return String(v??'').length*this.fontSize*.19;}getStringUnitWidth(v){return String(v??'').length*.5;}
 addPage(){this.pages++;this.page=this.pages;return this;}setPage(n){this.page=n;}
 autoTable(options={}){const body=structuredClone(options.body||[]),head=structuredClone(options.head||[]),columns=structuredClone(options.columns||[]);this.tables.push({page:this.page,body,head,columns,options});this.lastAutoTable={finalY:(Number(options.startY)||20)+Math.max(1,body.length)*7+8};return this;}
 save(name){this.saved=String(name||'');}output(){return new Blob(['pdf']);}
}
function element(){return {innerHTML:'',textContent:'',value:'',title:'',hidden:false,disabled:false,dataset:{},style:{setProperty(){}},className:'',classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},remove(){},focus(){},setAttribute(){},removeAttribute(){},toggleAttribute(){},addEventListener(){},querySelector(){return null},querySelectorAll(){return[]},closest(){return null}};}
const dom=new Map();const node=key=>{if(!dom.has(key))dom.set(key,element());return dom.get(key)};
const document={title:'Audit',scripts:[],body:element(),head:element(),documentElement:element(),createElement(tag){if(tag==='canvas')return {width:1,height:1,getContext(){return {drawImage(){},clearRect(){}}},toDataURL(){return 'data:image/png;base64,AA=='}};return element();},getElementById(id){return node('#'+id)},querySelector(sel){return node(sel)},querySelectorAll(){return[]},addEventListener(){}};
const context={console,setTimeout,clearTimeout,queueMicrotask,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,Blob,Image:FakeImage,CustomEvent:class{constructor(t,i={}){this.type=t;this.detail=i.detail}},document,navigator:{onLine:true,clipboard:{writeText:async()=>{}}},location:{href:'http://localhost/index.html',origin:'http://localhost',pathname:'/index.html',hash:'',search:''},history:{pushState(){},replaceState(){}},scrollY:0,innerHeight:900,matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame:fn=>fn(),visualViewport:null,dispatchEvent(){return true},addEventListener(){},open(){},alert(){},confirm(){return true},prompt(){return ''},scrollTo(){},getComputedStyle(){return {getPropertyValue(){return ''}}},
 localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},jspdf:{jsPDF:FakePdf}};
context.window=context;context.globalThis=context;
vm.createContext(context);
for(const file of ['assets/js/store.js','assets/js/ui.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const store=context.NexoraStore;
const fixture=store.normalizeState({rules:{...store.blankRules(),name:'Kings Auxiliary PDF Audit',format:'league',isKingsLeague:true},site:{},articles:[],teamPhotos:[],teams:[
 {id:'a',name:'Alpha Internazionale d’Àngelo',logo:'',players:[{id:'p7',name:'Mario Rossi',number:7}],president:{id:'pres_a',name:'Mario Rossi'},coach:{name:''}},
 {id:'b',name:'Beta United',logo:'',players:[{id:'p10',name:'José O’Connor',number:10}],president:{id:'pres_b',name:'Luisa Bianchi'},coach:{name:''}}
],matches:[{id:'m1',phase:'league',round:'Giornata 1',homeTeamId:'a',awayTeamId:'b',status:'played',goals:[{id:'g1',playerId:'p7',weight:1},{id:'g2',playerId:'p7',weight:2},{id:'g3',playerId:'pres_a',weight:2}],cards:[]} ]});
store.save('admin',fixture);store.save('public',fixture);

let common=fs.readFileSync(path.join(root,'assets/js/admin-common.js'),'utf8');
common=common.replace("window.NexoraAdmin={state,save,commit,flash,adminLabel,initGlobalActions,openSimulationDialog,runTournamentSimulation,renderStats,teamOptions,renderTeamsList,renderRoster,filteredMatches,renderMatchFilters,openPrint,downloadRecapPdf,downloadStateBackup,parseBackupPayload,importStateBackup};", "window.__NG_COMMON_PDF_TEST={createRecapDoc};window.NexoraAdmin={state,save,commit,flash,adminLabel,initGlobalActions,openSimulationDialog,runTournamentSimulation,renderStats,teamOptions,renderTeamsList,renderRoster,filteredMatches,renderMatchFilters,openPrint,downloadRecapPdf,downloadStateBackup,parseBackupPayload,importStateBackup};");
vm.runInContext(common,context,{filename:'assets/js/admin-common.js'});

let publicSrc=fs.readFileSync(path.join(root,'assets/js/public.js'),'utf8');
const initStart="  updateAppViewportVars();\n  window.addEventListener('resize',()=>requestAnimationFrame(updateAppViewportVars),{passive:true});";
const idx=publicSrc.lastIndexOf(initStart);if(idx<0)throw new Error('inizializzazione public non individuata');
publicSrc=publicSrc.slice(0,idx)+"  window.__NG_PUBLIC_PDF_TEST={downloadTeamPdf,teamPlayerStatsRows,teamStatsForPdf,teamPhaseDataForReport};\n})();\n";
vm.runInContext(publicSrc,context,{filename:'assets/js/public.js'});

const results=[];let total=0;async function test(name,fn){total++;try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
const tableByHeader=(doc,label)=>doc.tables.find(t=>t.columns.some(c=>c.header===label)||t.head.flat().includes(label));
await test('recap globale: giocatore usa eventi e presidente resta separato',async()=>{documents.length=0;const doc=await context.__NG_COMMON_PDF_TEST.createRecapDoc(fixture);const players=tableByHeader(doc,'Giocatore');const presidents=tableByHeader(doc,'Presidente');assert.equal(players.body.find(r=>r.playerId==='p7').goals,2);assert.ok(!players.body.some(r=>r.playerId==='pres_a'));assert.equal(presidents.body[0].president,'Mario Rossi');assert.ok(!JSON.stringify(presidents.body).includes('(rig.)'));});
await test('scheda squadra PDF: roster usa gol personali, GF usa valore squadra',async()=>{documents.length=0;await context.__NG_PUBLIC_PDF_TEST.downloadTeamPdf('a');const doc=documents.at(-1);const roster=doc.tables.find(t=>t.head.flat().includes('Calciatore'));const phases=doc.tables.find(t=>t.head.flat().includes('GF'));assert.ok(roster);const row=roster.body.find(r=>Array.isArray(r)&&r[1]==='Mario Rossi');assert.equal(row[4],'2');assert.ok(phases);assert.equal(phases.body[0][6],'4');});
await test('scheda squadra PDF: calendario mostra risultato ponderato',async()=>{const doc=documents.at(-1);const matches=doc.tables.find(t=>t.head.flat().includes('Risultato'));assert.ok(matches);assert.equal(matches.body[0][4],'4 - 0');});
const failed=results.filter(r=>!r.ok);console.log(JSON.stringify({total,passed:total-failed.length,failed:failed.length,results},null,2));process.exit(failed.length?1:0);
