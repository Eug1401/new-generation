(function(){
 const store=NexoraStore, UI=NexoraUI, A=NexoraAdmin;
 let playerTeamFilter='', standingsGroup='all';
 const BRAND_LOGO='assets/brand/new-generation-logo-transparent.png';
 const PDF_COLORS={ink:[24,16,6], muted:[108,91,54], gold:[185,130,24], gold2:[244,219,120], cream:[255,248,231], line:[221,177,73], soft:[255,246,218]};
 const imageCache=new Map();

 function teamFilterOptions(s,selected){return '<option value="">Tutte le squadre</option>'+s.teams.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${UI.esc(t.name)}</option>`).join('');}
 function filteredPlayerStats(s){const rows=store.selectors.playerStats(s);return playerTeamFilter?rows.filter(p=>p.teamId===playerTeamFilter):rows.filter(p=>p.goals>0).slice(0,15);}
 function reportAvailability(s){
   const matchCount=(s.matches||[]).length;
   const teamCount=(s.teams||[]).length;
   const scorers=store.selectors.scorers(s).length;
   const hasGroups=store.selectors.hasGroupStage(s);
   const bracket=store.bracketData(s);
   return {
     standings:{enabled:teamCount>0,detail:teamCount?`${teamCount} squadre`:'Aggiungi squadre'},
     scorers:{enabled:teamCount>0,detail:scorers?`${Math.min(scorers,15)} marcatori`:'Nessun gol: PDF vuoto'},
     groups:{enabled:hasGroups,detail:hasGroups?'Classifiche gironi':'Non previsto dal format'},
     calendar:{enabled:matchCount>0,detail:matchCount?`${matchCount} partite`:'Genera il calendario'},
     bracket:{enabled:Boolean(bracket.available),detail:bracket.available?'Tabellone disponibile':(bracket.message||'Non previsto dal format')}
   };
 }
 function renderReportButtons(s){
   const availability=reportAvailability(s);
   Object.entries(availability).forEach(([kind,meta])=>{
     const btn=document.querySelector(`[data-report-kind="${kind}"]`);
     if(!btn)return;
     btn.disabled=!meta.enabled;
     btn.title=meta.detail;
     const small=btn.querySelector('small');
     if(small)small.textContent=meta.detail;
   });
 }
 function render(){
   const s=A.state();
   renderReportButtons(s);
   UI.$('#adminStats').innerHTML=UI.statsGrid(store.selectors.stats(s));
   const standingsMenu=UI.$('#adminStandingsMenu');
   if(standingsMenu)standingsMenu.innerHTML=store.selectors.hasGroupStage(s)?UI.groupStandingsSelector(s,standingsGroup,'adminGroupStandingsFilter'):'';
   UI.$('#adminStandings').innerHTML=store.selectors.hasGroupStage(s)?UI.groupStandingsTables(s,standingsGroup):UI.standingsTable((store.selectors.officialStandings?store.selectors.officialStandings(s):store.selectors.calculateStandings(s)),s);
   const filter=UI.$('#adminPlayerTeamFilter');
   if(filter){filter.innerHTML=teamFilterOptions(s,playerTeamFilter);if(playerTeamFilter&&!s.teams.some(t=>t.id===playerTeamFilter))playerTeamFilter='';}
   UI.$('#adminPlayers').innerHTML=UI.playerStatsTable(filteredPlayerStats(s))+(s.rules.isKingsLeague?'<div class="mini-section-title margin-top"><h3>Presidenti marcatori</h3></div>'+UI.presidentStatsTable(store.selectors.presidentScorers(s).slice(0,15)):'');
   UI.$('#adminCalendar').innerHTML=UI.matchList(s);
   UI.$('#adminBracket').innerHTML=UI.bracketMarkup(s);
 }
 document.addEventListener('DOMContentLoaded',render);
 UI.$('#adminPlayerTeamFilter')?.addEventListener('change',e=>{playerTeamFilter=e.target.value;render();});
 document.addEventListener('change',e=>{if(e.target.id==='adminGroupStandingsFilter'){standingsGroup=e.target.value||'all';render();}});

 function slug(s){return String(s||'report').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,60)||'report';}
 function today(){return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date());}
 function pdfName(s,type){return `${slug(s.rules?.name||'new-generation')}-${type}-${new Date().toISOString().slice(0,10)}.pdf`;}
 function setRgb(doc,method,rgb){doc[method](rgb[0],rgb[1],rgb[2]);}
 function toolsReady(){return window.jspdf&&window.jspdf.jsPDF;}
 function toast(msg,type='ok'){const box=UI.$('#pdfStatus'); if(box)box.innerHTML=`<div class="message ${type}">${UI.esc(msg)}</div>`;}

 function currentPdfState(){
   const s=A.state();
   const repair=store.repairState(s);
   A.save(s);
   const report=store.integrityReport(s);
   const blocking=(report.details||[]).filter(i=>i.severity==='error');
   if(blocking.length){throw new Error('Dati non coerenti per generare il PDF: '+blocking.slice(0,3).map(i=>i.message).join(' · '));}
   if(repair.changed){toast('Dati riallineati con le ultime modifiche. Download in corso…');render();}
   return s;
 }
 function dataUrlFromImage(src){
   if(!src)return Promise.resolve(null);
   if(imageCache.has(src))return imageCache.get(src);
   const p=new Promise(resolve=>{
     if(/^data:image\//i.test(src)){resolve(src);return;}
     const img=new Image(); img.crossOrigin='anonymous';
     img.onload=()=>{try{const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);resolve(c.toDataURL('image/png'));}catch(e){resolve(null);}};
     img.onerror=()=>resolve(null); img.src=src;
   });
   imageCache.set(src,p); return p;
 }
 async function preloadTeamLogos(s){const out={};await Promise.all(s.teams.map(async t=>{out[t.id]=await dataUrlFromImage(t.logo);}));return out;}
 function teamInitial(name){return String(name||'?').trim().split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||'NG';}
 function drawPlaceholderLogo(doc,x,y,size,label){setRgb(doc,'setFillColor',PDF_COLORS.soft);setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.roundedRect(x,y,size,size,2.2,2.2,'FD');setRgb(doc,'setTextColor',PDF_COLORS.gold);doc.setFont('helvetica','bold');doc.setFontSize(Math.max(5,size*.45));doc.text(teamInitial(label),x+size/2,y+size*.62,{align:'center'});}
 function drawLogo(doc,src,x,y,size,label){if(src){try{doc.addImage(src,'PNG',x,y,size,size,undefined,'FAST');return;}catch(e){try{doc.addImage(src,'JPEG',x,y,size,size,undefined,'FAST');return;}catch(_){}}}drawPlaceholderLogo(doc,x,y,size,label);}
 async function baseDoc(s,title,subtitle,orientation='p'){
   const {jsPDF}=window.jspdf; const doc=new jsPDF({orientation,unit:'mm',format:'a4',compress:true});
   const logo=await dataUrlFromImage(BRAND_LOGO); drawHeader(doc,s,title,subtitle,logo); return {doc,logo};
 }
 function drawHeader(doc,s,title,subtitle,logo){
   const w=doc.internal.pageSize.getWidth();
   setRgb(doc,'setFillColor',[7,6,4]);doc.rect(0,0,w,48,'F');
   setRgb(doc,'setFillColor',[32,24,10]);doc.rect(0,48,w,3,'F');
   drawLogo(doc,logo,w/2-12,6.5,24,s.rules?.name||'NG');
   setRgb(doc,'setTextColor',PDF_COLORS.cream);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text(String(s.rules?.name||'New Generation'),w/2,34,{align:'center'});
   setRgb(doc,'setTextColor',PDF_COLORS.gold2);doc.setFontSize(10);doc.text(String(title||'Report ufficiale'),w/2,40.5,{align:'center'});
   setRgb(doc,'setTextColor',[210,190,140]);doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.text(String(subtitle||''),w/2,45.3,{align:'center'});
 }
 function addFooter(doc,s){
   const pages=doc.internal.getNumberOfPages();
   for(let i=1;i<=pages;i++){
     doc.setPage(i);
     const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();
     setRgb(doc,'setDrawColor',[225,184,80]);doc.setLineWidth(.2);doc.line(12,h-12,w-12,h-12);
     setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFontSize(7);doc.setFont('helvetica','normal');
     doc.text(`${s.rules?.name||'New Generation'} · generato ${today()}`,12,h-7);
     doc.text(`Pagina ${i}/${pages}`,w-12,h-7,{align:'right'});
   }
 }
 function drawSectionIntro(doc,title,subtitle,y){
   setRgb(doc,'setTextColor',PDF_COLORS.gold);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('REPORT CENTER',12,y);
   setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(14.5);doc.text(String(title||''),12,y+6);
   setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(8.1);doc.text(String(subtitle||''),12,y+11,{maxWidth:doc.internal.pageSize.getWidth()-24});
   return y+15;
 }
 function drawSummaryCards(doc,items,startY,cols=4){
   const list=(items||[]).filter(Boolean); if(!list.length)return startY;
   const left=12,right=12,gap=4,rowGap=4; const count=Math.max(1,Math.min(cols,list.length));
   const cardW=(doc.internal.pageSize.getWidth()-left-right-gap*(count-1))/count; const cardH=18;
   list.forEach((item,idx)=>{
     const row=Math.floor(idx/count), col=idx%count;
     const x=left+col*(cardW+gap), y=startY+row*(cardH+rowGap);
     setRgb(doc,'setFillColor',[255,251,239]);setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.roundedRect(x,y,cardW,cardH,3.2,3.2,'FD');
     setRgb(doc,'setFillColor',item.tone==='accent'?PDF_COLORS.gold:PDF_COLORS.soft);doc.roundedRect(x,y,cardW,4.4,3.2,3.2,'F');
     setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','bold');doc.setFontSize(6.4);doc.text(String(item.label||''),x+3,y+8);
     setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(10.6);doc.text(String(item.value??'-'),x+3,y+14.2,{maxWidth:cardW-6});
     if(item.note){doc.setFont('helvetica','normal');doc.setFontSize(6.3);setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.text(String(item.note),x+3,y+17,{maxWidth:cardW-6});}
   });
   return startY + Math.ceil(list.length/count)*cardH + (Math.ceil(list.length/count)-1)*rowGap;
 }
 function drawReportNote(doc,text,startY,mode='info'){
   if(!text)return startY;
   const maxWidth=doc.internal.pageSize.getWidth()-34;
   const lines=doc.splitTextToSize(String(text),maxWidth) || [''];
   const boxH=Math.max(10,5+lines.length*4.1);
   setRgb(doc,'setFillColor',mode==='warning'?[255,248,226]:[255,252,243]);
   setRgb(doc,'setDrawColor',PDF_COLORS.line);
   doc.roundedRect(12,startY,doc.internal.pageSize.getWidth()-24,boxH,3,3,'FD');
   setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7.4);
   doc.text(lines,16,startY+5.5);
   return startY+boxH;
 }
 function tableTheme(){return {theme:'grid',styles:{font:'helvetica',fontSize:8,cellPadding:2.1,lineColor:[232,210,150],lineWidth:.12,textColor:PDF_COLORS.ink,overflow:'linebreak',valign:'middle'},headStyles:{fillColor:PDF_COLORS.ink,textColor:PDF_COLORS.gold2,fontStyle:'bold',fontSize:7.5,halign:'center'},alternateRowStyles:{fillColor:[255,252,241]},margin:{left:12,right:12},showHead:'everyPage'};}
 function didDrawTeamLogo(logos,teamsByRow,colIndex=1){return function(data){if(data.section!=='body'||data.column.index!==colIndex)return;const row=teamsByRow[data.row.index];if(!row)return;drawLogo(data.doc,logos[row.teamId],data.cell.x+1.6,data.cell.y+1.4,6.2,row.name||row.teamName||row.team);};}
 function didParseTeamCell(colIndex=1){return function(data){if(data.section==='body'&&data.column.index===colIndex){data.cell.styles.cellPadding={top:2.1,right:2.1,bottom:2.1,left:10};data.cell.styles.fontStyle='bold';}};}
 function standingsRows(s,phase){return phase?store.selectors.calculateStandings(s,phase):(store.selectors.officialStandings?store.selectors.officialStandings(s):store.selectors.calculateStandings(s));}

 async function pdfStandings(){
   const s=currentPdfState(), logos=await preloadTeamLogos(s); const {doc}=await baseDoc(s,'Classifica generale','Impaginazione editoriale, leggibile e coerente con il visual del sito.','p');
   const rows=standingsRows(s).map((r,i)=>({...r,rank:i+1}));
   const liveCount=(s.matches||[]).filter(m=>m.status==='live').length;
   const leader=rows[0]||null;
   const bestAttack=rows.slice().sort((a,b)=>b.goalsFor-a.goalsFor||a.name.localeCompare(b.name))[0]||null;
   const bestDefense=rows.slice().sort((a,b)=>a.goalsAgainst-b.goalsAgainst||a.name.localeCompare(b.name))[0]||null;
   let y=58;
   y=drawSectionIntro(doc,'Quadro classifica','La classifica ufficiale considera solo partite consolidate: gli incontri live restano fuori dai conteggi del PDF.',y);
   y=drawSummaryCards(doc,[
     {label:'Capolista',value:leader?leader.name:'—',note:leader?`${leader.points} pt · DR ${(leader.diff>0?'+':'')+leader.diff}`:'Nessun dato',tone:'accent'},
     {label:'Miglior attacco',value:bestAttack?bestAttack.name:'—',note:bestAttack?`${bestAttack.goalsFor} gol fatti`:'Nessun dato'},
     {label:'Miglior difesa',value:bestDefense?bestDefense.name:'—',note:bestDefense?`${bestDefense.goalsAgainst} gol subiti`:'Nessun dato'},
     {label:'Partite consolidate',value:String((s.matches||[]).filter(m=>store.hasScore(s,m)).length),note:liveCount?`${liveCount} live escluse`:'Nessun live in corso'}
   ],y,2)+5;
   if(liveCount)y=drawReportNote(doc,'Le partite in stato Live non vengono riportate come concluse nel PDF e non modificano classifica o statistiche finché il referto non viene chiuso.',y,'warning')+4;
   doc.autoTable({...tableTheme(),startY:y,columns:[{header:'#',dataKey:'rank'},{header:'Squadra',dataKey:'name'},{header:'Pt',dataKey:'points'},{header:'PG',dataKey:'played'},{header:'GF',dataKey:'goalsFor'},{header:'GS',dataKey:'goalsAgainst'},{header:'DR',dataKey:'diff'}],body:rows.length?rows.map(r=>({...r,diff:(r.diff>0?'+':'')+r.diff})):[{rank:'-',name:'Nessuna squadra disponibile',points:'-',played:'-',goalsFor:'-',goalsAgainst:'-',diff:'-',teamId:''}],columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:78},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'},5:{halign:'center'},6:{halign:'center'}},didParseCell:didParseTeamCell(1),didDrawCell:didDrawTeamLogo(logos,rows,1)});
   addFooter(doc,s); doc.save(pdfName(s,'classifica'));
 }

 async function pdfScorers(){
   const s=currentPdfState(), logos=await preloadTeamLogos(s); const {doc}=await baseDoc(s,'Classifica marcatori · Top 15','Lettura rapida in stile report sportivo, con sezione aggiuntiva per i presidenti se presente.', 'p');
   const rows=store.selectors.scorers(s).slice(0,15).map((p,i)=>({...p,rank:i+1,player:p.name,team:p.teamName,year:p.birthYear||'-'}));
   const stats=store.selectors.stats(s);
   let y=58;
   y=drawSectionIntro(doc,'Focus marcatori','La graduatoria considera solo dati ufficialmente consolidati. I match live restano fuori da gol e presenze del report.',y);
   y=drawSummaryCards(doc,[
     {label:'Capocannoniere',value:rows[0]?rows[0].player:'—',note:rows[0]?`${rows[0].goals} gol · ${rows[0].team}`:'Nessun gol registrato',tone:'accent'},
     {label:'Giocatori in classifica',value:String(rows.length),note:'Top 15 del torneo'},
     {label:'Gol torneo',value:String(stats.actualGoals||0),note:'Gol effettivi consolidati'},
     {label:'Media gol / partita',value:(stats.matchesPlayed?((stats.scoreGoals||0)/stats.matchesPlayed).toFixed(2):'0.00'),note:'Punteggio ufficiale'}
   ],y,2)+5;
   doc.autoTable({...tableTheme(),startY:y,columns:[{header:'#',dataKey:'rank'},{header:'Calciatore',dataKey:'player'},{header:'Anno',dataKey:'year'},{header:'Squadra',dataKey:'team'},{header:'Gol',dataKey:'goals'},{header:'PG',dataKey:'played'},{header:'Gialli',dataKey:'yellow'},{header:'Rossi',dataKey:'red'}],body:rows.length?rows:[{rank:'-',player:'Nessun marcatore disponibile',year:'-',team:'-',goals:'-',played:'-',yellow:'-',red:'-',teamId:''}],columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:52,fontStyle:'bold'},2:{halign:'center',cellWidth:18},3:{cellWidth:54},4:{halign:'center',fontStyle:'bold'},5:{halign:'center'},6:{halign:'center'},7:{halign:'center'}},didParseCell:function(data){if(data.section==='body'&&data.column.index===3){data.cell.styles.cellPadding={top:2.1,right:2.1,bottom:2.1,left:10};data.cell.styles.fontStyle='bold';}},didDrawCell:function(data){if(data.section==='body'&&data.column.index===3){const r=rows[data.row.index];if(r)drawLogo(data.doc,logos[r.teamId],data.cell.x+1.6,data.cell.y+1.4,6.2,r.teamName||r.team);}}});
   const pres=store.selectors.presidentScorers(s).slice(0,15).map((p,i)=>({...p,rank:i+1,president:p.name,team:p.teamName}));
   const nextY=(doc.lastAutoTable?.finalY||y)+10;
   setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(11.5);doc.text('Presidenti marcatori',12,nextY);
   setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7.6);doc.text('Sezione separata rispetto alla classifica calciatori, utile per i format con regole speciali.',12,nextY+4,{maxWidth:180});
   doc.autoTable({...tableTheme(),startY:nextY+8,columns:[{header:'#',dataKey:'rank'},{header:'Presidente',dataKey:'president'},{header:'Squadra',dataKey:'team'},{header:'Gol',dataKey:'goals'},{header:'PG',dataKey:'played'}],body:pres.length?pres:[{rank:'-',president:'Nessun gol presidente disponibile',team:'-',goals:'-',played:'-',teamId:''}],columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:62,fontStyle:'bold'},2:{cellWidth:62},3:{halign:'center',fontStyle:'bold'},4:{halign:'center'}},didParseCell:function(data){if(data.section==='body'&&data.column.index===2){data.cell.styles.cellPadding={top:2.1,right:2.1,bottom:2.1,left:10};}},didDrawCell:function(data){if(data.section==='body'&&data.column.index===2){const r=pres[data.row.index];if(r)drawLogo(data.doc,logos[r.teamId],data.cell.x+1.6,data.cell.y+1.4,6.2,r.teamName||r.team);}}});
   addFooter(doc,s); doc.save(pdfName(s,'marcatori'));
 }

 async function pdfGroups(){
   const s=currentPdfState(), logos=await preloadTeamLogos(s); const {doc,logo}=await baseDoc(s,'Classifiche gironi','Una classifica dedicata per ogni girone, con sommari e stato del raggruppamento.', 'p');
   const groups=store.selectors.groupedStandings(s);
   if(!groups.length){doc.autoTable({...tableTheme(),startY:58,head:[['Info']],body:[['Questo torneo non contiene gironi.']]}); addFooter(doc,s); doc.save(pdfName(s,'classifiche-gironi')); return;}
   let y=58;
   y=drawSectionIntro(doc,'Panoramica gironi','I gironi vengono mostrati in blocchi separati; i match live restano esclusi dai conteggi del PDF.',y);
   y=drawSummaryCards(doc,[
     {label:'Gironi attivi',value:String(groups.length),note:'Blocchi classifica'},
     {label:'Gironi completati',value:String(groups.filter(g=>g.completed).length),note:'Aggiornati al report'},
     {label:'Squadre coinvolte',value:String((s.teams||[]).length),note:'Totale partecipanti'},
     {label:'Formato',value:String(store.FORMAT_LABELS[s.rules?.format]||s.rules?.format||'-'),note:'Struttura torneo'}
   ],y,2)+6;
   groups.forEach((g,idx)=>{
     if(idx>0){doc.addPage();drawHeader(doc,s,'Classifiche gironi','Report ufficiale dei raggruppamenti.',logo);y=58;}
     const leader=g.rows?.[0]||null;
     const bestAttack=(g.rows||[]).slice().sort((a,b)=>b.goalsFor-a.goalsFor||a.name.localeCompare(b.name))[0]||null;
     const bestDefense=(g.rows||[]).slice().sort((a,b)=>a.goalsAgainst-b.goalsAgainst||a.name.localeCompare(b.name))[0]||null;
     const qualifiers=(s.rules?.groupConfigs||[]).find(cfg=>cfg.name===g.name)?.qualifiers;
     y=drawSectionIntro(doc,g.name,`Stato girone: ${g.completed?'completato':'in corso'}${qualifiers?` · Qualificate previste: ${qualifiers}`:''}`,y);
     y=drawSummaryCards(doc,[
       {label:'Capolista',value:leader?leader.name:'—',note:leader?`${leader.points} pt`:'Nessun dato',tone:'accent'},
       {label:'Miglior attacco',value:bestAttack?bestAttack.name:'—',note:bestAttack?`${bestAttack.goalsFor} gol fatti`:'Nessun dato'},
       {label:'Miglior difesa',value:bestDefense?bestDefense.name:'—',note:bestDefense?`${bestDefense.goalsAgainst} gol subiti`:'Nessun dato'},
       {label:'Squadre nel girone',value:String((g.rows||[]).length),note:g.completed?'Girone chiuso':'Classifica aperta'}
     ],y,2)+5;
     const rows=(g.rows||[]).map((r,i)=>({...r,rank:i+1}));
     doc.autoTable({...tableTheme(),startY:y,columns:[{header:'#',dataKey:'rank'},{header:'Squadra',dataKey:'name'},{header:'Pt',dataKey:'points'},{header:'PG',dataKey:'played'},{header:'GF',dataKey:'goalsFor'},{header:'GS',dataKey:'goalsAgainst'},{header:'DR',dataKey:'diff'}],body:rows.map(r=>({...r,diff:(r.diff>0?'+':'')+r.diff})),columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:78},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'},5:{halign:'center'},6:{halign:'center'}},didParseCell:didParseTeamCell(1),didDrawCell:didDrawTeamLogo(logos,rows,1)});
     y=(doc.lastAutoTable?.finalY||y)+10;
   });
   addFooter(doc,s); doc.save(pdfName(s,'classifiche-gironi'));
 }

 function calendarRows(s){
   const matches=[...s.matches].sort((a,b)=>(a.roundIndex-b.roundIndex)||String(a.date||'').localeCompare(String(b.date||''))||String(a.time||'').localeCompare(String(b.time||'')));
   return matches.map(m=>({
     phase:store.PHASE_LABELS[m.phase]||m.phase||'-',
     round:m.round||'-',
     home:store.teamName(s,m.homeTeamId,m.homeLabel),
     away:store.teamName(s,m.awayTeamId,m.awayLabel),
     homeTeamId:m.homeTeamId,
     awayTeamId:m.awayTeamId,
     field:m.field||'Campo da definire',
     date:UI.fmtDate(m),
     score:store.hasScore(s,m)?store.scoreText(s,m):'-',
     status:store.hasScore(s,m)?'Giocata':'Da giocare',
     isLive:m.status==='live'
   }));
 }
 async function pdfCalendar(){
   const s=currentPdfState(), logos=await preloadTeamLogos(s); const {doc}=await baseDoc(s,'Calendario completo','Programma gare con layout più leggibile e controllo logico sui match live.','l');
   const rows=calendarRows(s);
   const playedCount=rows.filter(r=>r.status==='Giocata').length;
   const pendingCount=rows.length-playedCount;
   const liveCount=rows.filter(r=>r.isLive).length;
   let y=58;
   y=drawSectionIntro(doc,'Panoramica calendario','Le partite in stato Live non vengono consolidate nel PDF: restano indicate come “Da giocare” fino al referto finale.',y);
   y=drawSummaryCards(doc,[
     {label:'Partite totali',value:String(rows.length),note:'Intero calendario'},
     {label:'Giocate',value:String(playedCount),note:'Risultati ufficiali',tone:'accent'},
     {label:'Da giocare',value:String(pendingCount),note:liveCount?`${liveCount} live non consolidate`:'In attesa di referto'},
     {label:'Campi attivi',value:String(s.rules?.fieldCount||'-'),note:'Configurazione torneo'}
   ],y,4)+5;
   if(liveCount)y=drawReportNote(doc,'Controllo logico attivo: le partite live non vengono riportate con un risultato nel report PDF. Rimangono nello stato “Da giocare” finché il referto non viene chiuso.',y,'warning')+4;
   doc.autoTable({...tableTheme(),startY:y,columns:[{header:'Fase',dataKey:'phase'},{header:'Giornata/turno',dataKey:'round'},{header:'Casa',dataKey:'home'},{header:'Ospite',dataKey:'away'},{header:'Campo',dataKey:'field'},{header:'Data e ora',dataKey:'date'},{header:'Risultato',dataKey:'score'},{header:'Stato',dataKey:'status'}],body:rows.length?rows:[{phase:'-',round:'-',home:'Nessuna partita disponibile',away:'-',field:'-',date:'-',score:'-',status:'-'}],columnStyles:{0:{cellWidth:28},1:{cellWidth:34},2:{cellWidth:46},3:{cellWidth:46},4:{cellWidth:35},5:{cellWidth:43},6:{cellWidth:26,halign:'center',fontStyle:'bold'},7:{cellWidth:24,halign:'center'}},didParseCell:function(data){if(data.section==='body'&&(data.column.index===2||data.column.index===3)){data.cell.styles.cellPadding={top:2,right:2,bottom:2,left:10};data.cell.styles.fontStyle='bold';} if(data.section==='body'&&data.column.index===7){const row=rows[data.row.index];if(row&&row.status==='Giocata'){data.cell.styles.fillColor=[255,248,226];data.cell.styles.textColor=PDF_COLORS.ink;}}},didDrawCell:function(data){if(data.section!=='body')return;const r=rows[data.row.index];if(!r)return;if(data.column.index===2)drawLogo(data.doc,logos[r.homeTeamId],data.cell.x+1.4,data.cell.y+1.3,6,r.home);if(data.column.index===3)drawLogo(data.doc,logos[r.awayTeamId],data.cell.x+1.4,data.cell.y+1.3,6,r.away);}});
   addFooter(doc,s); doc.save(pdfName(s,'calendario-completo'));
 }

 function drawTeamLine(doc,s,logos,m,side,x,y,w,h){
   const id=side==='home'?m.homeTeamId:m.awayTeamId;
   const label=side==='home'?m.homeLabel:m.awayLabel;
   const name=store.teamName(s,id,label||'Da definire');
   const sc=store.matchGoals(s,m);
   const score=store.hasScore(s,m)?(side==='home'?sc.home:sc.away):'';
   const winner=store.winnerId?store.winnerId(s,m):'';
   const isWinner=id&&winner===id;
   setRgb(doc,'setFillColor',isWinner?[255,248,226]:[255,255,255]);
   setRgb(doc,'setDrawColor',isWinner?PDF_COLORS.gold:PDF_COLORS.line);
   doc.setLineWidth(isWinner?0.45:0.18);
   doc.roundedRect(x,y,w,h,2.5,2.5,'FD');
   drawLogo(doc,logos[id],x+2,y+1.4,h-2.8,name);
   setRgb(doc,'setTextColor',PDF_COLORS.ink);
   doc.setFont('helvetica',isWinner?'bold':'normal');
   doc.setFontSize(7.2);
   doc.text(String(name||'Da definire'),x+h+2.5,y+h/2+2.1,{maxWidth:w-h-15});
   if(score!==''){
     setRgb(doc,'setFillColor',isWinner?PDF_COLORS.ink:PDF_COLORS.soft);
     setRgb(doc,'setDrawColor',isWinner?PDF_COLORS.ink:PDF_COLORS.line);
     doc.circle(x+w-6,y+h/2,4,'FD');
     setRgb(doc,'setTextColor',isWinner?PDF_COLORS.gold2:PDF_COLORS.ink);
     doc.setFont('helvetica','bold');doc.setFontSize(7.5);
     doc.text(String(score),x+w-6,y+h/2+2.5,{align:'center'});
   }
 }
 function drawBracketPage(doc,s,logos,bracket,logo,addNewPage=true){
   if(addNewPage)doc.addPage('a4','landscape');
   drawHeader(doc,s,`Tabellone · ${bracket.name}`,'Fase finale: squadre, placeholder e risultati con percorsi evidenziati.',logo);
   const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();
   const left=13,right=13,top=58,bottom=20;
   const rounds=bracket.rounds||[];
   const gap=8;
   const colW=(w-left-right-gap*Math.max(0,rounds.length-1))/Math.max(1,rounds.length);
   const cardRefs=[];
   rounds.forEach((round,ri)=>{
     const x=left+ri*(colW+gap);
     setRgb(doc,'setFillColor',PDF_COLORS.ink);
     setRgb(doc,'setDrawColor',PDF_COLORS.gold);
     doc.roundedRect(x,top-10,colW,7,2.2,2.2,'FD');
     setRgb(doc,'setTextColor',PDF_COLORS.gold2);
     doc.setFont('helvetica','bold');doc.setFontSize(8);
     doc.text(String(round.name||`Turno ${ri+1}`),x+colW/2,top-5.2,{align:'center',maxWidth:colW-2});
     const count=Math.max((round.matches||[]).length,1);
     const cardH=Math.max(22,Math.min(34,(h-top-bottom-(count-1)*7)/count));
     const usable=h-top-bottom-cardH;
     (round.matches||[]).forEach((m,mi)=>{
       const y=top+(count===1?usable/2:(usable*mi/(count-1)));
       setRgb(doc,'setFillColor',[213,184,94]);doc.roundedRect(x+1,y+1,colW,cardH,4,4,'F');
       setRgb(doc,'setFillColor',[255,253,245]);setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.setLineWidth(.22);doc.roundedRect(x,y,colW,cardH,4,4,'FD');
       setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(5.9);
       const meta=[m.round||round.name,m.field||'Campo da definire'].filter(Boolean).join(' · ');
       doc.text(meta,x+2.4,y+4.3,{maxWidth:colW-4.8});
       const rowH=(cardH-8.5)/2;
       drawTeamLine(doc,s,logos,m,'home',x+2.2,y+6.4,colW-4.4,rowH);
       drawTeamLine(doc,s,logos,m,'away',x+2.2,y+6.4+rowH+1.2,colW-4.4,rowH);
       cardRefs.push({ri,mi,x,y,w:colW,h:cardH,mid:y+cardH/2});
     });
   });
   setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.setLineWidth(.35);
   cardRefs.forEach(ref=>{
     const nextMatches=cardRefs.filter(r=>r.ri===ref.ri+1);
     if(!nextMatches.length)return;
     const target=nextMatches[Math.floor(ref.mi/2)]||nextMatches[0];
     const x1=ref.x+ref.w, x2=target.x, xm=x1+(x2-x1)/2;
     doc.line(x1,ref.mid,xm,ref.mid);
     doc.line(xm,ref.mid,xm,target.mid);
     doc.line(xm,target.mid,x2,target.mid);
   });
   const legendY=h-12;
   setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7);
   doc.text('Nota: le partite live restano da giocare nei report; le righe evidenziate indicano la squadra qualificata/vincitrice.',left,legendY);
 }
 async function pdfBracket(){
   const s=currentPdfState(), logos=await preloadTeamLogos(s); const {doc,logo}=await baseDoc(s,'Tabellone fase finale','Grafica del tabellone in stile report, coerente con calendario e classifiche.', 'l');
   const data=store.bracketData(s);
   if(!data.available){doc.autoTable({...tableTheme(),startY:58,head:[['Info']],body:[[data.message||'Nessun tabellone disponibile.']]});}
   else {
     const flat=(data.brackets||[]).flatMap(b=>(b.rounds||[]).flatMap(r=>r.matches||[]));
     const liveCount=flat.filter(m=>m.status==='live').length;
     let y=58;
     y=drawSectionIntro(doc,'Lettura del tabellone','Nel PDF il tabellone segue la logica ufficiale del torneo: i match live non vengono mostrati come conclusi.',y);
     y=drawSummaryCards(doc,[
       {label:'Blocchi tabellone',value:String((data.brackets||[]).length),note:'Percorsi distinti'},
       {label:'Match KO',value:String(flat.length),note:'Totale incontri'},
       {label:'Match consolidati',value:String(flat.filter(m=>store.hasScore(s,m)).length),note:liveCount?`${liveCount} live escluse`:'Nessun live in corso',tone:'accent'},
       {label:'Formato',value:String(store.FORMAT_LABELS[s.rules?.format]||s.rules?.format||'-'),note:'Formula torneo'}
     ],y,4)+5;
     if(liveCount)y=drawReportNote(doc,'Anche nel tabellone i match live restano visivamente “Da giocare” fino alla chiusura del referto, per mantenere coerenza con gli altri report.',y,'warning')+4;
     // v118: il riepilogo del report resta sulla prima pagina. Ogni tabellone parte
     // sempre da una pagina nuova e pulita, evitando sovrapposizioni con testo/card
     // disegnati in precedenza sullo stesso canvas PDF.
     data.brackets.forEach(b=>drawBracketPage(doc,s,logos,b,logo,true));
   }
   addFooter(doc,s); doc.save(pdfName(s,'tabellone-fase-finale'));
 }

 async function runPdf(kind){
   try{
     if(!toolsReady()){toast('Librerie PDF non disponibili. Controlla la connessione e ricarica la pagina.','error');return;}
     toast('Genero il PDF e avvio il download…');
     if(kind==='standings')await pdfStandings();
     else if(kind==='scorers')await pdfScorers();
     else if(kind==='groups')await pdfGroups();
     else if(kind==='bracket')await pdfBracket();
     else await pdfCalendar();
     toast('Download PDF avviato.');
   }catch(err){console.error(err);toast('Non sono riuscito a generare il PDF: '+(err.message||err),'error');}
 }
 document.addEventListener('click',e=>{
   const btn=e.target.closest('[data-report-kind]');
   if(!btn)return;
   e.preventDefault();
   if(btn.disabled)return;
   runPdf(btn.dataset.reportKind||'calendar');
 });
 window.NexoraAdminRefresh=function(){try{render();}catch(_){};};
 window.addEventListener('ng:admin-state-loaded',()=>window.NexoraAdminRefresh());
})();
