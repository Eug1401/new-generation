import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root=process.cwd();
const memory=new Map();
const documents=[];
class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}}
class FakeImage{
  set src(_value){queueMicrotask(()=>this.onerror?.(new Error('mock image unavailable')));}
}
class FakePdf{
  constructor(opts={}){
    this.opts=opts;this.page=1;this.pages=1;this.fontSize=10;this.texts=[];this.tables=[];this.shapes=[];this.saved='';
    const landscape=opts.orientation==='l';
    this.width=landscape?297:210;this.height=landscape?210:297;
    if(Array.isArray(opts.format)){this.width=Number(opts.format[0])||this.width;this.height=Number(opts.format[1])||this.height;}
    this.internal={pageSize:{getWidth:()=>this.width,getHeight:()=>this.height},getNumberOfPages:()=>this.pages};
    documents.push(this);
  }
  setFillColor(){} setDrawColor(){} setTextColor(){} setFont(){} setLineWidth(){} setProperties(){}
  setFontSize(v){this.fontSize=Number(v)||this.fontSize;}
  rect(...a){this.shapes.push(['rect',this.page,...a]);} roundedRect(...a){this.shapes.push(['roundedRect',this.page,...a]);}
  line(...a){this.shapes.push(['line',this.page,...a]);} circle(...a){this.shapes.push(['circle',this.page,...a]);}
  addImage(){}
  text(value,x,y,opts={}){const values=Array.isArray(value)?value:[value];values.forEach((v,i)=>this.texts.push({page:this.page,text:String(v),x:Number(x)||0,y:(Number(y)||0)+i*this.fontSize*.35,opts,fontSize:this.fontSize}));}
  splitTextToSize(value,maxWidth){
    const text=String(value??'');const max=Math.max(8,Math.floor(Number(maxWidth)||30));const words=text.split(/\s+/);const lines=[];let line='';
    for(const word of words){const test=line?`${line} ${word}`:word;if(test.length<=max)line=test;else{if(line)lines.push(line);line=word;}}
    if(line)lines.push(line);return lines.length?lines:[''];
  }
  getTextWidth(v){return String(v??'').length*this.fontSize*.19;}
  getStringUnitWidth(v){return String(v??'').length*.5;}
  addPage(format,orientation){this.pages++;this.page=this.pages;if(Array.isArray(format)){this.width=Number(format[0])||this.width;this.height=Number(format[1])||this.height;}else if(orientation==='landscape'){this.width=297;this.height=210;}return this;}
  setPage(n){this.page=n;}
  autoTable(options={}){
    const startY=Number(options.startY)||20;
    const body=Array.isArray(options.body)?structuredClone(options.body):[];
    const columns=Array.isArray(options.columns)?structuredClone(options.columns):[];
    const head=Array.isArray(options.head)?structuredClone(options.head):[];
    this.tables.push({page:this.page,startY,body,columns,head,options});
    this.lastAutoTable={finalY:startY+Math.max(1,body.length)*7+8};
    return this;
  }
  save(name){this.saved=String(name||'');}
}
const element=()=>({innerHTML:'',textContent:'',value:'',disabled:false,title:'',dataset:{},className:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelector(){return null},querySelectorAll(){return[]}});
const elements=new Map();
const document={
  body:{appendChild(){}},head:{appendChild(){}},
  createElement(tag){if(tag==='canvas')return {width:1,height:1,getContext(){return {drawImage(){},clearRect(){}}},toDataURL(){return 'data:image/png;base64,AA=='}};return element();},
  getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
  querySelector(sel){if(!elements.has(sel))elements.set(sel,element());return elements.get(sel)},querySelectorAll(){return[]},addEventListener(){}
};
const context={console,setTimeout,clearTimeout,queueMicrotask,Date,Math,JSON,Intl,URL,Map,Set,WeakMap,Promise,structuredClone,Blob,Image:FakeImage,CustomEvent,
 localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 document,navigator:{onLine:true},location:{href:'http://localhost/admin-reports.html',origin:'http://localhost',pathname:'/admin-reports.html'},dispatchEvent(){return true},addEventListener(){},open(){},alert(){},confirm(){return true}};
context.window=context;context.globalThis=context;context.jspdf={jsPDF:FakePdf};
vm.createContext(context);
for(const file of ['assets/js/store.js','assets/js/ui.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const store=context.NexoraStore;
function stateFixture(){
 const raw={rules:{...store.blankRules(),name:'Kings Export Audit',format:'league',isKingsLeague:true,startDate:'2026-07-01'},site:{},articles:[],teamPhotos:[],teams:[
  {id:'a',name:'Associazione Sportiva Internazionale d’Àngelo',logo:'',players:[{id:'p1',name:'Li',number:1},{id:'p7',name:'Gianluca D’Àngelo-Rossi del Borgo',number:7}],president:{id:'pres_a',name:'Mario Rossi'},coach:{name:''}},
  {id:'b',name:'Boreale United Football Club dalla Valle',logo:'',players:[{id:'p10',name:'José O’Connor',number:10}],president:{id:'pres_b',name:'Presidentessa dal Nome Straordinariamente Lungo'},coach:{name:''}}
 ],matches:[
  {id:'m1',phase:'league',round:'Giornata 1',roundIndex:1,homeTeamId:'a',awayTeamId:'b',homeLabel:'',awayLabel:'',date:'2026-07-01',time:'20:00',field:'Campo 1',status:'played',goals:[
   {id:'n1',playerId:'p1',weight:1},{id:'n2',playerId:'p7',weight:1},{id:'d1',playerId:'p7',weight:2},{id:'pr1',playerId:'pres_a',weight:1}
  ],cards:[]}
 ]};
 return store.normalizeState(raw);
}
let current=stateFixture();
context.NexoraAdmin={state:()=>current,save:s=>{current=store.normalizeState(s);return current;},flash(){}};
let source=fs.readFileSync(path.join(root,'assets/js/admin-reports.js'),'utf8');
const marker='window.addEventListener(\'ng:admin-state-loaded\', () => window.NexoraAdminRefresh());\n})();';
if(!source.includes(marker))throw new Error('Impossibile esporre le funzioni PDF per il test');
source=source.replace(marker,"window.addEventListener('ng:admin-state-loaded', () => window.NexoraAdminRefresh());\nwindow.__NG_REPORT_TEST={pdfScorers,pdfRecap,pdfStandings,pdfCalendar,pdfGroups,pdfBracket,buildMatchEvents};\n})();");
vm.runInContext(source,context,{filename:'assets/js/admin-reports.js'});
const api=context.__NG_REPORT_TEST;
function lastDoc(){assert.ok(documents.length,'nessun documento generato');return documents.at(-1);}
function findTable(doc,header){return doc.tables.find(t=>t.columns.some(c=>c.header===header)||t.head.flat().includes(header));}
function textDump(doc){return doc.texts.map(x=>x.text).join(' | ');}
const results=[];let total=0;
async function test(name,fn){total++;try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.message});}}

await test('PDF marcatori: classifica giocatori usa eventi, non valore doppio',async()=>{
 documents.length=0;await api.pdfScorers();const doc=lastDoc();const table=findTable(doc,'Calciatore');assert.ok(table);const p7=table.body.find(r=>r.playerId==='p7');assert.equal(p7.goals,2);assert.equal(p7.scoreGoals,3);
});
await test('PDF marcatori: presidenti separati e senza (rig.)',async()=>{
 const doc=lastDoc();const table=findTable(doc,'Presidente');assert.ok(table);assert.equal(table.body[0].president,'Mario Rossi');assert.ok(!JSON.stringify(table.body).includes('(rig.)'));const players=findTable(doc,'Calciatore');assert.ok(!players.body.some(r=>r.playerId==='pres_a'));
});
await test('PDF marcatori: riepilogo gol e media non sono zero',async()=>{
 const doc=lastDoc();const dump=textDump(doc);assert.ok(dump.includes('4'),`totale eventi non visibile: ${dump}`);assert.ok(dump.includes('5.00'),`media ponderata non visibile: ${dump}`);
});
await test('PDF recap: risultato ponderato e label eventi coerenti',async()=>{
 documents.length=0;await api.pdfRecap();const doc=lastDoc();const dump=textDump(doc);const compact=dump.replace(/\s*\|\s*/g,' ').replace(/\s+/g,' ');assert.ok(dump.includes('5 – 0')||dump.includes('5 - 0'),dump);assert.ok(compact.includes('Mario Rossi (rig.)'),dump);assert.ok(dump.includes('1 gol doppio'),dump);assert.ok(!dump.includes('Mario Rossi pres. (rig.)'));
});
await test('PDF classifica squadre: GF usa valore ponderato',async()=>{
 documents.length=0;await api.pdfStandings();const table=findTable(lastDoc(),'Squadra');const row=table.body.find(r=>r.teamId==='a');assert.equal(row.goalsFor,5);
});
await test('PDF calendario: risultato usa valore ponderato',async()=>{
 documents.length=0;await api.pdfCalendar();const doc=lastDoc();const serialized=JSON.stringify(doc.tables.map(t=>t.body));assert.ok(serialized.includes('5')&&serialized.includes('0'),serialized);
});
await test('Eventi PDF rigenerati dopo modifica ed eliminazione',async()=>{
 const m=current.matches[0];m.goals=m.goals.filter(g=>g.id!=='d1');current=store.normalizeState(current);documents.length=0;await api.pdfRecap();let dump=textDump(lastDoc());assert.ok(dump.includes('3 – 0')||dump.includes('3 - 0'),dump);assert.ok(!dump.includes('gol doppio'),dump);
 m.goals=[];current=store.normalizeState(current);documents.length=0;await api.pdfRecap();dump=textDump(lastDoc());assert.ok(!dump.includes('Mario Rossi (rig.)'),dump);
});

const failed=results.filter(r=>!r.ok);
console.log(JSON.stringify({total,passed:total-failed.length,failed:failed.length,results},null,2));
if(failed.length)process.exitCode=1;
