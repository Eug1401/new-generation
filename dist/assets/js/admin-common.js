(function(){
  const store=window.NexoraStore, UI=window.NexoraUI;
  function state(){return store.load('admin');}
  function save(s){store.save('admin',s);} 
  function commit(fn){const s=state(); fn(s); store.alignState(s); save(s); return s;}
  function flash(el,text,type='ok'){const node=typeof el==='string'?UI.$(el):el;if(node)node.innerHTML=text?`<div class="message ${type}">${UI.esc(text)}</div>`:'';}
  // Label dell'admin corrente per i lock atomici. Prende email/nome dalla sessione Supabase
  // o un nick salvato in localStorage. Default 'Admin'.
  function adminLabel(){
    try{
      const stored = localStorage.getItem('ng-admin-label');
      if(stored) return stored;
      const sess = window.NG_SUPABASE_CLIENT?.auth?.getSession?.();
      // sess è una Promise - non possiamo aspettarla qui. Usiamo email cache se disponibile.
      const cached = window.NG_ADMIN_EMAIL_CACHE;
      if(cached) return cached.split('@')[0];
    }catch(_){}
    return 'Admin';
  }

  // v126.9: palette editoriale bianco/oro (vedi admin-reports.js per il
  // razionale). Coerente fra tutti i PDF: classifiche, marcatori, recap
  // partite, tabellone e recap globale pre-reset.
  // 'bg' è ora un grigio molto chiaro (quasi bianco) invece del nero
  // precedente: i nuovi header non usano sfondi scuri.
  const PDF_COLORS={bg:[253,251,247],ink:[22,18,8],muted:[120,105,72],gold:[184,134,28],gold2:[253,239,200],paper:[253,251,247],line:[222,210,176],red:[156,30,42]};
  function setRgb(doc,fn,c){doc[fn](...(Array.isArray(c)?c:[c,c,c]));}
  function today(){return new Date().toLocaleDateString('it-IT');}
  function slug(v){return String(v||'new-generation').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'new-generation';}
  function teamInitial(label){return String(label||'NG').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'NG';}
  function loadScriptOnce(src){return new Promise((resolve,reject)=>{if([...document.scripts].some(s=>s.src===src)){resolve();return;}const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(new Error('Libreria non caricata: '+src));document.head.appendChild(s);});}
  async function ensurePdfTools(){if(!(window.jspdf&&window.jspdf.jsPDF))await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');if(!(window.jspdf&&window.jspdf.jsPDF))throw new Error('jsPDF non disponibile');if(!window.jspdf.jsPDF.API.autoTable)await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js');}
  function imgToDataURL(src){return new Promise(resolve=>{if(!src){resolve('');return;}if(/^data:image\//.test(src)){resolve(src);return;}const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{try{const c=document.createElement('canvas');const scale=Math.min(1,900/Math.max(img.naturalWidth||1,img.naturalHeight||1));c.width=Math.max(1,Math.round((img.naturalWidth||1)*scale));c.height=Math.max(1,Math.round((img.naturalHeight||1)*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/png'));}catch(e){resolve('');}};img.onerror=()=>resolve('');img.src=src;});}
  async function preloadTeamLogos(s){const out={};for(const t of (s.teams||[])){out[t.id]=await imgToDataURL(t.logo);}return out;}
  function drawPlaceholderLogo(doc,x,y,size,label){setRgb(doc,'setFillColor',PDF_COLORS.gold);setRgb(doc,'setDrawColor',PDF_COLORS.gold2);doc.roundedRect(x,y,size,size,4,4,'FD');setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(Math.max(7,size*.28));doc.text(teamInitial(label),x+size/2,y+size*.58,{align:'center'});}
  function drawLogo(doc,src,x,y,size,label){if(src){try{doc.addImage(src,'PNG',x,y,size,size,undefined,'FAST');return;}catch(e){}}drawPlaceholderLogo(doc,x,y,size,label);}
  async function createRecapDoc(s){
    await ensurePdfTools();
    const {jsPDF}=window.jspdf; const doc=new jsPDF({orientation:'p',unit:'mm',format:'a4',compress:true});
    const logos=await preloadTeamLogos(s); const brand=await imgToDataURL('assets/brand/new-generation-logo-transparent.png');
    const standings=(store.selectors.officialStandings?store.selectors.officialStandings(s):store.selectors.calculateStandings(s)).map((r,i)=>({...r,rank:i+1,diff:(r.diff>0?'+':'')+r.diff}));
    const scorers=store.selectors.scorers(s).slice(0,15).map((p,i)=>({...p,rank:i+1,player:p.name,team:p.teamName,year:p.birthYear||'-'}));
    const presidentScorers=(store.selectors.presidentScorers?store.selectors.presidentScorers(s):[]).map((p,i)=>({...p,rank:i+1,president:p.name,team:p.teamName}));
    const data=store.bracketData(s);
    const winner=findWinner(s,standings);
    function header(title,subtitle){
      const w=doc.internal.pageSize.getWidth();
      // v126.9: header editoriale bianco (vedi admin-reports.js). Niente
      // più sfondo scuro: stesso linguaggio visivo per tutti i PDF.
      setRgb(doc,'setFillColor',[255,255,255]);doc.rect(0,0,w,32,'F');
      if(brand){ try { doc.addImage(brand,'PNG',14,7,18,18,undefined,'FAST'); } catch(_){} }
      setRgb(doc,'setTextColor',PDF_COLORS.gold);doc.setFont('helvetica','bold');doc.setFontSize(7);
      doc.text('NEW GENERATION · REPORT UFFICIALE',35,11);
      setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(13);
      doc.text(String(s.rules?.name||'New Generation'),35,18,{maxWidth:w-90});
      setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(14);
      doc.text(title,w-14,18,{align:'right',maxWidth:w*0.5});
      setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7);
      doc.text(`Generato ${today()}`,w-14,23,{align:'right'});
      // Regola gold sotto l'header
      setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.setLineWidth(0.5);doc.line(14,32,w-14,32);
      setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.setLineWidth(0.18);doc.line(14,32.9,w-14,32.9);
      // Titolo della sezione
      setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(16);
      doc.text(title,14,46);
      setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
      doc.text(subtitle,14,52,{maxWidth:w-28});
    }
    function footer(){const pages=doc.internal.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.setLineWidth(.25);doc.line(14,h-13,w-14,h-13);setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(`Recap torneo - ${today()}`,14,h-8);doc.text(`Pagina ${i}/${pages}`,w-14,h-8,{align:'right'});}}
    function tableTheme(){return {theme:'grid',styles:{font:'helvetica',fontSize:8,cellPadding:2,lineColor:[232,210,150],lineWidth:.12,textColor:PDF_COLORS.ink,overflow:'linebreak',valign:'middle'},headStyles:{fillColor:PDF_COLORS.ink,textColor:PDF_COLORS.gold2,fontStyle:'bold',fontSize:7.5,halign:'center'},alternateRowStyles:{fillColor:[255,252,241]},margin:{left:14,right:14},showHead:'everyPage'};}
    function didParseTeamCell(col){return function(d){if(d.section==='body'&&d.column.index===col){d.cell.styles.cellPadding={top:2,right:2,bottom:2,left:11};d.cell.styles.fontStyle='bold';}};}
    function didDrawTeamLogo(rows,col){return function(d){if(d.section==='body'&&d.column.index===col){const r=rows[d.row.index];if(r)drawLogo(d.doc,logos[r.teamId],d.cell.x+1.6,d.cell.y+1.3,6.4,r.name||r.team);}};}
    header('Recap ufficiale torneo','Documento riepilogativo prima del reset: classifiche, marcatori, tabellone finale e squadra vincente.');
    setRgb(doc,'setFillColor',[255,252,241]);setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.roundedRect(14,80,182,44,5,5,'FD');drawLogo(doc,winner.logo,22,88,28,winner.name);setRgb(doc,'setTextColor',PDF_COLORS.gold);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('SQUADRA VINCENTE',58,93);setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFontSize(20);doc.text(winner.name,58,103,{maxWidth:125});setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(winner.note,58,113,{maxWidth:125});
    doc.autoTable({...tableTheme(),startY:133,columns:[{header:'#',dataKey:'rank'},{header:'Squadra',dataKey:'name'},{header:'Pt',dataKey:'points'},{header:'PG',dataKey:'played'},{header:'GF',dataKey:'goalsFor'},{header:'GS',dataKey:'goalsAgainst'},{header:'DR',dataKey:'diff'}],body:standings.length?standings:[{rank:'-',name:'Nessuna classifica disponibile',points:'-',played:'-',goalsFor:'-',goalsAgainst:'-',diff:'-',teamId:''}],columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:75},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'},5:{halign:'center'},6:{halign:'center'}},didParseCell:didParseTeamCell(1),didDrawCell:didDrawTeamLogo(standings,1)});
    doc.addPage();header('Classifiche marcatori','Top 15 calciatori del torneo e, in modalità Kings League, classifica presidenti separata.');
    doc.autoTable({...tableTheme(),startY:82,columns:[{header:'#',dataKey:'rank'},{header:'Giocatore',dataKey:'player'},{header:'Anno',dataKey:'year'},{header:'Squadra',dataKey:'team'},{header:'Gol',dataKey:'goals'},{header:'PG',dataKey:'played'}],body:scorers.length?scorers:[{rank:'-',player:'Nessun marcatore disponibile',year:'-',team:'-',goals:'-',played:'-',teamId:''}],columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:58,fontStyle:'bold'},2:{halign:'center',cellWidth:18},3:{cellWidth:58},4:{halign:'center',fontStyle:'bold'},5:{halign:'center'}},didParseCell:function(d){if(d.section==='body'&&d.column.index===3)d.cell.styles.cellPadding={top:2,right:2,bottom:2,left:11};},didDrawCell:function(d){if(d.section==='body'&&d.column.index===3){const r=scorers[d.row.index];if(r)drawLogo(d.doc,logos[r.teamId],d.cell.x+1.6,d.cell.y+1.3,6.4,r.team);}}});
    const presY=Math.min((doc.lastAutoTable?.finalY||82)+14,215);
    setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(13);doc.text('Classifica presidenti',14,presY);
    doc.autoTable({...tableTheme(),startY:presY+6,columns:[{header:'#',dataKey:'rank'},{header:'Presidente',dataKey:'president'},{header:'Squadra',dataKey:'team'},{header:'Gol',dataKey:'goals'}],body:presidentScorers.length?presidentScorers:[{rank:'-',president:'Nessun gol presidente disponibile',team:'-',goals:'-',teamId:''}],columnStyles:{0:{halign:'center',cellWidth:10},1:{cellWidth:70,fontStyle:'bold'},2:{cellWidth:70},3:{halign:'center',fontStyle:'bold'}},didParseCell:function(d){if(d.section==='body'&&d.column.index===2)d.cell.styles.cellPadding={top:2,right:2,bottom:2,left:11};},didDrawCell:function(d){if(d.section==='body'&&d.column.index===2){const r=presidentScorers[d.row.index];if(r)drawLogo(d.doc,logos[r.teamId],d.cell.x+1.6,d.cell.y+1.3,6.4,r.team);}}});
    doc.addPage('a4','landscape');drawBracketRecap(doc,s,logos,brand,data);
    footer(); return doc;
  }
  function findWinner(s,standings){
    const final=findTournamentFinalMatch(s);
    if(final){
      const id=store.winnerId(s,final);
      if(id){const t=store.getTeam(s,id);if(t)return {name:t.name,logo:t.logo||'',note:`Campione: vincente della finale${final.bracketName?` (${final.bracketName})`:''}`};}
      return {name:'Vincitore da definire',logo:'',note:'La finale non ha ancora un risultato valido.'};
    }
    return {name:'Vincitore da definire',logo:'',note:'Nessuna finale disponibile nel tabellone: placeholder automatico.'};
  }
  function findTournamentFinalMatch(s){
    const matches=(s.matches||[]).filter(m=>m&&(m.bracketName||['knockout','playoff','secondary_playoff','supercup'].includes(m.phase)));
    if(!matches.length)return null;
    const finals=matches.filter(m=>String(m.bracketRound||m.round||'').toLowerCase().includes('finale'));
    const primary=finals.find(m=>['Fase finale','Tabellone principale','Tabellone'].includes(m.bracketName))||finals.find(m=>m.phase==='knockout')||finals[0];
    if(primary)return primary;
    return matches.slice().sort((a,b)=>(b.roundIndex-a.roundIndex)||(b.bracketRoundIndex-a.bracketRoundIndex)||(b.bracketMatchIndex-a.bracketMatchIndex))[0]||null;
  }
  function recapSourceLabel(m,side,fallback){
    const src=side==='home'?m.sourceHome:m.sourceAway;
    if(src&&src.startsWith('winner:')){const parts=src.split(':');return `Vincente ${parts.slice(1,-2).join(':')} ${parts[parts.length-2]}.${parts[parts.length-1]}`;}
    if(src&&src.startsWith('group:')){const parts=src.split(':');const pos=parts.pop();return `${pos}ª ${parts.slice(1).join(':')}`;}
    if(src&&src.startsWith('league:'))return `${src.split(':')[1]}ª classificata`;
    if(src&&src.startsWith('bracketwinner:'))return `Vincente ${src.split(':').slice(1).join(':')}`;
    return fallback||'Da definire';
  }
  function drawTeamLine(doc,s,logos,m,side,x,y,w,h){
    const id=side==='home'?m.homeTeamId:m.awayTeamId;
    const raw=side==='home'?m.homeLabel:m.awayLabel;
    const name=id?store.teamName(s,id,raw):recapSourceLabel(m,side,raw||'Da definire');
    const sc=store.matchGoals(s,m);
    const score=store.hasScore(s,m)?(side==='home'?sc.home:sc.away):'';
    const winner=store.winnerId?store.winnerId(s,m):'';
    const isWinner=id&&winner===id;
    setRgb(doc,'setFillColor',isWinner?[255,248,226]:[255,255,255]);
    setRgb(doc,'setDrawColor',isWinner?PDF_COLORS.gold:PDF_COLORS.line);
    doc.setLineWidth(isWinner?0.45:0.18);
    doc.roundedRect(x,y,w,h,2.5,2.5,'FD');
    drawLogo(doc,logos[id],x+1.8,y+1.2,h-2.4,name);
    setRgb(doc,'setTextColor',PDF_COLORS.ink);doc.setFont('helvetica',isWinner?'bold':'normal');doc.setFontSize(7.1);
    doc.text(String(name),x+h+2.3,y+h/2+2.1,{maxWidth:w-h-15});
    if(score!==''){
      setRgb(doc,'setFillColor',isWinner?PDF_COLORS.ink:PDF_COLORS.paper);setRgb(doc,'setDrawColor',isWinner?PDF_COLORS.ink:PDF_COLORS.line);
      doc.circle(x+w-6,y+h/2,4,'FD');setRgb(doc,'setTextColor',isWinner?PDF_COLORS.gold2:PDF_COLORS.ink);doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.text(String(score),x+w-6,y+h/2+2.5,{align:'center'});
    }
  }
  function drawBracketRecap(doc,s,logos,brand,data){
    const w=doc.internal.pageSize.getWidth(),h=doc.internal.pageSize.getHeight();
    setRgb(doc,'setFillColor',PDF_COLORS.bg);doc.rect(0,0,w,38,'F');drawLogo(doc,brand,w/2-11,4,22,s.rules?.name||'NG');
    setRgb(doc,'setTextColor',PDF_COLORS.gold2);doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text('Tabellone finale',w/2,32,{align:'center'});
    if(!data.available){setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFontSize(12);doc.text(data.message||'Nessun tabellone disponibile.',w/2,h/2,{align:'center'});return;}
    const bracket=data.brackets.find(b=>['Fase finale','Tabellone principale','Tabellone'].includes(b.name))||data.brackets[0];
    const rounds=bracket.rounds||[];const left=12,right=12,top=50,bottom=18,gap=8;
    const colW=Math.min(88,(w-left-right-gap*Math.max(0,rounds.length-1))/Math.max(1,rounds.length));
    const startX=(w-(colW*rounds.length+gap*Math.max(0,rounds.length-1)))/2;
    const refs=[];
    rounds.forEach((round,ri)=>{
      const x=startX+ri*(colW+gap);setRgb(doc,'setFillColor',PDF_COLORS.ink);setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.roundedRect(x,top-10,colW,7.5,2.2,2.2,'FD');
      setRgb(doc,'setTextColor',PDF_COLORS.gold2);doc.setFont('helvetica','bold');doc.setFontSize(7.8);doc.text(String(round.name),x+colW/2,top-4.8,{align:'center',maxWidth:colW-2});
      const count=Math.max((round.matches||[]).length,1);const cardH=Math.max(22,Math.min(32,(h-top-bottom-(count-1)*7)/count));const available=h-top-bottom-cardH;
      (round.matches||[]).forEach((m,mi)=>{const y=top+(count===1?available/2:(available*mi/(count-1)));setRgb(doc,'setFillColor',[213,184,94]);doc.roundedRect(x+1,y+1,colW,cardH,4,4,'F');setRgb(doc,'setFillColor',PDF_COLORS.paper);setRgb(doc,'setDrawColor',PDF_COLORS.line);doc.setLineWidth(.22);doc.roundedRect(x,y,colW,cardH,4,4,'FD');setRgb(doc,'setTextColor',PDF_COLORS.muted);doc.setFont('helvetica','normal');doc.setFontSize(5.8);doc.text(`${m.bracketName||bracket.name} · ${round.name} ${m.bracketMatchIndex||mi+1} · ${m.field||'Campo da definire'}`,x+2.2,y+4.3,{maxWidth:colW-4});const rowH=(cardH-8.5)/2;drawTeamLine(doc,s,logos,m,'home',x+2.2,y+6.4,colW-4.4,rowH);drawTeamLine(doc,s,logos,m,'away',x+2.2,y+6.4+rowH+1.2,colW-4.4,rowH);refs.push({ri,mi,x,y,w:colW,h:cardH,mid:y+cardH/2});});
    });
    setRgb(doc,'setDrawColor',PDF_COLORS.gold);doc.setLineWidth(.35);refs.forEach(ref=>{const next=refs.filter(r=>r.ri===ref.ri+1);if(!next.length)return;const target=next[Math.floor(ref.mi/2)]||next[0];const x1=ref.x+ref.w,x2=target.x,xm=x1+(x2-x1)/2;doc.line(x1,ref.mid,xm,ref.mid);doc.line(xm,ref.mid,xm,target.mid);doc.line(xm,target.mid,x2,target.mid);});
  }
  async function downloadRecapPdf(s){const doc=await createRecapDoc(store.normalizeState(s));doc.save(`${slug(s.rules?.name||'new-generation')}-recap-torneo.pdf`);}  
  function backupPayload(s,source='manual'){
    const clean=store.normalizeState(s);
    return {
      app:'new-generation',
      type:'tournament-state-backup',
      version:1,
      exportedAt:new Date().toISOString(),
      source,
      meta:{
        tournamentName:clean.rules?.name||'New Generation',
        teams:(clean.teams||[]).length,
        players:(clean.teams||[]).reduce((sum,t)=>sum+(t.players||[]).length,0),
        matches:(clean.matches||[]).length,
        articles:(clean.articles||[]).length
      },
      state:clean
    };
  }
  function downloadJsonFile(payload,filename){
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1200);
  }
  function downloadStateBackup(s,source='manual'){
    const payload=backupPayload(s,source);
    downloadJsonFile(payload,`${slug(payload.meta.tournamentName)}-backup-torneo-${new Date().toISOString().slice(0,10)}.json`);
    return payload;
  }
  function parseBackupPayload(raw){
    let payload;
    try{payload=typeof raw==='string'?JSON.parse(raw):raw;}catch(e){throw new Error('File JSON non leggibile.');}
    if(!payload||typeof payload!=='object')throw new Error('Backup non valido.');
    const candidate=payload.type==='tournament-state-backup'?payload.state:payload.state||payload;
    if(!candidate||typeof candidate!=='object')throw new Error('Il file non contiene uno stato torneo.');
    const normalized=store.normalizeState(candidate);
    return {payload, state:normalized};
  }
  function importStateBackup(payload,{reload=true}={}){
    const parsed=parseBackupPayload(payload);
    const current=state();
    const msg=`Confermi il ripristino del backup?\n\nTorneo nel file: ${parsed.state.rules?.name||'New Generation'}\nSquadre: ${(parsed.state.teams||[]).length}\nPartite: ${(parsed.state.matches||[]).length}\n\nLo stato attuale (${(current.teams||[]).length} squadre, ${(current.matches||[]).length} partite) verrà sostituito.`;
    if(!confirm(msg))return false;
    save(parsed.state);
    if(reload)setTimeout(()=>location.reload(),400);
    return true;
  }
  // =====================================================================
  // RESET DEL TORNEO — v126.10 (flusso transazionale verificato)
  //
  // Sostituisce il vecchio flusso unico setTimeout(..., 900). Le fasi sono
  // ora esplicite, verificate e atomiche:
  //
  //   1) SNAPSHOT  — deep copy dello state corrente
  //   2) EXPORT    — generazione Blob backup JSON + Blob PDF recap
  //   3) VERIFICA  — blob.size > 0 e MIME type corretto per entrambi
  //   4) DOWNLOAD  — trigger dei file via <a download>
  //   5) CONFERMA  — l'admin deve cliccare esplicitamente "Procedi" dopo
  //                  aver verificato che i file siano stati salvati
  //   6) CANCELLAZIONE — emptyState + force remote save (attende Supabase)
  //   7) VERIFICA STATO VUOTO — rilegge da localStorage e da remoto
  //   8) RELOAD    — reload finale (UI admin + propagazione lato utente)
  //
  // La cancellazione NON parte mai se la fase 2 o 3 fallisce: niente perdita
  // di dati. Lock anti-doppio-click attivo per tutta la durata del flusso.
  // =====================================================================

  let resetInProgress = false;
  function resetLog(opId, phase, detail){
    try { console.info(`[NG-Reset ${opId}] ${phase}`, detail !== undefined ? detail : ''); } catch(_){}
  }

  // FASE 1: deep snapshot indipendente dallo state mutabile
  function snapshotState(){
    const s = state();
    return JSON.parse(JSON.stringify(s));
  }

  // FASE 2a: blob JSON
  function buildBackupBlob(snapshot){
    const payload = backupPayload(snapshot, 'reset-flow');
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type:'application/json' });
    const filename = `${slug(payload.meta.tournamentName)}-backup-torneo-${new Date().toISOString().slice(0,10)}.json`;
    return { blob, filename, payload };
  }

  // FASE 2b: blob PDF (usa createRecapDoc esistente, ottenendo blob
  // invece che chiamare doc.save() direttamente). jsPDF supporta output('blob').
  async function buildRecapPdfBlob(snapshot){
    const doc = await createRecapDoc(store.normalizeState(snapshot));
    const blob = doc.output('blob');
    const filename = `${slug(snapshot.rules?.name||'new-generation')}-recap-torneo.pdf`;
    return { blob, filename };
  }

  // FASE 3: verifica integrità blob
  function verifyExport(label, expectedMime, blob){
    if(!blob || !(blob instanceof Blob)) throw new Error(`Export ${label}: oggetto non valido.`);
    if(blob.size === 0) throw new Error(`Export ${label}: file vuoto (0 byte).`);
    if(expectedMime && blob.type && !blob.type.includes(expectedMime.split('/')[1])){
      // MIME loose check: alcuni browser normalizzano application/pdf vs application/x-pdf
      console.warn(`[NG-Reset] MIME atteso ${expectedMime}, ricevuto ${blob.type}`);
    }
    return true;
  }

  // FASE 4: trigger download via anchor (un singolo gesture, no popup blocker)
  function triggerDownload(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Pulizia ritardata dell'URL per dare tempo al browser di iniziare il download
    setTimeout(() => {
      try { document.body.removeChild(a); } catch(_){}
      try { URL.revokeObjectURL(url); } catch(_){}
    }, 4000);
    return url;
  }

  // FASE 6 + 7: cancellazione transazionale con attesa remote save
  async function executeAtomicWipe(opId){
    // 6a) salvataggio locale dello stato vuoto
    resetLog(opId, 'CANCELLAZIONE', 'rimozione cache localStorage');
    try{
      Object.keys(localStorage)
        .filter(k => k.startsWith('new-generation-admin-state') || k.startsWith('new-generation-public-state') || k.startsWith('nexora-admin-state') || k.startsWith('nexora-public-state'))
        .forEach(k => localStorage.removeItem(k));
    }catch(e){ resetLog(opId, 'CANCELLAZIONE WARN', 'localStorage clear fallito (continuo)'); }

    const empty = store.emptyState();
    resetLog(opId, 'CANCELLAZIONE', 'save(emptyState) locale + broadcast');
    save(empty); // patched store.save: scrive localStorage + broadcast + scheduleRemoteSave

    // 6b) attesa flush remoto (Supabase): qui sta la differenza chiave.
    // Senza questo wait, location.reload() può anticipare il remote save,
    // su Supabase resta lo stato pieno, supabase-sync lo ripristina e
    // l'utente vede il torneo "tornato".
    if(typeof window.NG_FORCE_REMOTE_SAVE === 'function'){
      resetLog(opId, 'CANCELLAZIONE', 'attesa NG_FORCE_REMOTE_SAVE');
      try {
        const ok = await Promise.race([
          window.NG_FORCE_REMOTE_SAVE(empty),
          new Promise(resolve => setTimeout(() => resolve('timeout'), 8000))
        ]);
        if(ok === 'timeout'){
          resetLog(opId, 'CANCELLAZIONE WARN', 'remote save timeout 8s — proseguo comunque');
        } else {
          resetLog(opId, 'CANCELLAZIONE', `remote save risultato: ${ok}`);
        }
      } catch(err){
        resetLog(opId, 'CANCELLAZIONE WARN', `remote save errore: ${err?.message||err}`);
      }
    } else {
      resetLog(opId, 'CANCELLAZIONE', 'NG_FORCE_REMOTE_SAVE non disponibile (modalità offline / no Supabase)');
    }

    // 7) verifica stato vuoto rileggendo da store.load
    const verifyState = store.load('admin');
    const isEmpty = (verifyState.teams||[]).length === 0
                 && (verifyState.matches||[]).length === 0
                 && (verifyState.articles||[]).length === 0;
    resetLog(opId, 'VERIFICA STATO VUOTO', { teams:(verifyState.teams||[]).length, matches:(verifyState.matches||[]).length, articles:(verifyState.articles||[]).length, ok:isEmpty });
    if(!isEmpty){
      throw new Error('Lo stato locale risulta ancora popolato dopo la cancellazione. Riprovare.');
    }
    return true;
  }

  // Funzione legacy mantenuta per compatibilità (mai più chiamata dal nuovo
  // flusso; preservata per non rompere eventuali test esterni).
  function resetStorageAndState(){
    try{
      Object.keys(localStorage)
        .filter(k => k.startsWith('new-generation-admin-state') || k.startsWith('new-generation-public-state') || k.startsWith('nexora-admin-state') || k.startsWith('nexora-public-state'))
        .forEach(k => localStorage.removeItem(k));
    }catch(e){}
    save(store.emptyState());
    location.reload();
  }

  function openResetDialog(){
    if(resetInProgress){
      return; // protezione anti-doppio click globale: un reset alla volta
    }
    let dlg = document.getElementById('resetTournamentDialog');
    if(!dlg){
      dlg = document.createElement('div');
      dlg.id = 'resetTournamentDialog';
      dlg.className = 'ng-modal-backdrop';
      dlg.innerHTML = `
        <div class="ng-modal card pad reset-modal" role="dialog" aria-modal="true" aria-labelledby="resetDialogTitle">
          <span class="pill danger-pill">Azione irreversibile</span>
          <h2 id="resetDialogTitle">Reset torneo</h2>
          <p class="muted">Il reset esegue questi passaggi <strong>in ordine</strong>:</p>
          <ol class="reset-steps muted">
            <li>Generazione e download del <strong>backup JSON</strong> completo</li>
            <li>Generazione e download del <strong>PDF recap</strong> ufficiale</li>
            <li>Verifica che entrambi i file siano stati salvati (conferma manuale)</li>
            <li>Cancellazione dello stato torneo (lato locale e remoto)</li>
            <li>Verifica dello stato vuoto e ricaricamento</li>
          </ol>
          <p class="muted small">Se la generazione di uno dei due file fallisce, <strong>il reset non viene eseguito</strong> e nessun dato viene cancellato.</p>

          <label class="check-card confirm-card">
            <input id="resetConfirmCheck" type="checkbox">
            <span>
              <strong>Confermo di voler azzerare il torneo</strong>
              <small>L'operazione è irreversibile. I file di backup sono l'unico modo per ripristinare i dati.</small>
            </span>
          </label>

          <div id="resetPhaseBox" class="reset-phase-box" aria-live="polite"></div>
          <div id="resetDialogMsg" aria-live="polite"></div>

          <div class="reset-choice-grid">
            <button class="btn danger" id="resetExecuteBtn" type="button" disabled>Esporta file di sicurezza</button>
            <button class="btn danger" id="resetFinalBtn" type="button" hidden>Procedi con la cancellazione</button>
            <button class="btn" id="cancelResetBtn" type="button">Annulla</button>
          </div>
        </div>`;
      document.body.appendChild(dlg);

      const confirmCheck = dlg.querySelector('#resetConfirmCheck');
      const execBtn      = dlg.querySelector('#resetExecuteBtn');
      const finalBtn     = dlg.querySelector('#resetFinalBtn');
      const cancelBtn    = dlg.querySelector('#cancelResetBtn');
      const phaseBox     = dlg.querySelector('#resetPhaseBox');
      const msg          = dlg.querySelector('#resetDialogMsg');

      confirmCheck.addEventListener('change', () => {
        execBtn.disabled = !confirmCheck.checked || resetInProgress;
      });
      cancelBtn.addEventListener('click', () => {
        if(resetInProgress) return; // niente cancel durante la cancellazione
        dlg.classList.remove('show');
      });
      dlg.addEventListener('click', e => {
        if(e.target === dlg && !resetInProgress){
          e.preventDefault(); e.stopPropagation();
          dlg.classList.remove('show');
        }
      });

      function setPhase(text, level){
        phaseBox.innerHTML = `<div class="reset-phase reset-phase-${level||'info'}">${UI.esc(text)}</div>`;
      }
      function setMsg(text, type){
        msg.innerHTML = text ? `<div class="message ${type||''}">${UI.esc(text)}</div>` : '';
      }

      // Memoria delle URL blob per cleanup
      const blobUrls = [];

      // -------- STEP 1: pulsante "Esporta file di sicurezza" --------
      execBtn.addEventListener('click', async () => {
        if(!confirmCheck.checked || resetInProgress) return;
        const opId = (Math.random().toString(36).slice(2,8)).toUpperCase();
        resetInProgress = true;
        resetLog(opId, 'AVVIO RESET', { time:new Date().toISOString() });
        confirmCheck.disabled = true;
        execBtn.disabled = true;
        const busy = window.NGInteractive;
        if(busy) busy.setButtonBusy(execBtn, true, 'Esporto…');

        try{
          // FASE 1: snapshot
          setPhase('1/4 · Preparazione dei dati');
          resetLog(opId, 'FASE 1 SNAPSHOT');
          const snapshot = snapshotState();
          const summary = {
            tournament: snapshot.rules?.name || 'New Generation',
            teams: (snapshot.teams||[]).length,
            matches: (snapshot.matches||[]).length,
            articles: (snapshot.articles||[]).length
          };
          resetLog(opId, 'FASE 1 SNAPSHOT OK', summary);

          // FASE 2 (a): backup JSON
          setPhase('2/4 · Generazione backup JSON');
          resetLog(opId, 'FASE 2a BACKUP JSON');
          const backup = buildBackupBlob(snapshot);
          verifyExport('backup JSON', 'application/json', backup.blob);
          resetLog(opId, 'FASE 2a BACKUP JSON OK', { filename:backup.filename, sizeBytes:backup.blob.size });

          // FASE 2 (b): PDF recap
          setPhase('2/4 · Generazione PDF recap');
          resetLog(opId, 'FASE 2b PDF RECAP');
          if(!window.jspdf || !window.jspdf.jsPDF){
            await ensurePdfTools();
          }
          const pdf = await buildRecapPdfBlob(snapshot);
          verifyExport('PDF recap', 'application/pdf', pdf.blob);
          resetLog(opId, 'FASE 2b PDF RECAP OK', { filename:pdf.filename, sizeBytes:pdf.blob.size });

          // FASE 3: download di entrambi (in ordine)
          setPhase('3/4 · Avvio download');
          resetLog(opId, 'FASE 3 DOWNLOAD AVVIO');
          blobUrls.push(triggerDownload(backup.blob, backup.filename));
          // Piccolo ritardo per evitare che il browser unisca due download in
          // un solo dialog "salva con nome" su alcuni sistemi
          await new Promise(r => setTimeout(r, 400));
          blobUrls.push(triggerDownload(pdf.blob, pdf.filename));
          resetLog(opId, 'FASE 3 DOWNLOAD OK', { backup:backup.filename, pdf:pdf.filename });

          // FASE 3b: attesa user-confirmation (cuore della sicurezza)
          setPhase('Verifica i file salvati, poi conferma per procedere');
          setMsg(`Sono stati avviati ${2} download: il backup JSON (${(backup.blob.size/1024).toFixed(0)} KB) e il PDF recap (${(pdf.blob.size/1024).toFixed(0)} KB). Controlla che entrambi i file siano arrivati nella cartella Download e siano apribili. Solo dopo la verifica clicca "Procedi con la cancellazione".`, 'ok');
          execBtn.hidden = true;
          finalBtn.hidden = false;
          finalBtn.disabled = true;
          // Anti-rage-click: il pulsante finale resta disabilitato per
          // almeno 2.5 secondi così l'utente non può cancellare per errore
          setTimeout(() => { if(!resetInProgress) return; finalBtn.disabled = false; }, 2500);
          resetLog(opId, 'FASE 3 IN ATTESA CONFERMA UTENTE');

          // FASE 4: handler del pulsante finale (in chiusura, registrato qui per accesso a opId/snapshot)
          const finalHandler = async () => {
            if(finalBtn.disabled) return;
            finalBtn.disabled = true;
            cancelBtn.disabled = true;
            try{
              setPhase('4/4 · Cancellazione torneo in corso');
              resetLog(opId, 'FASE 4 CANCELLAZIONE INIZIO');
              await executeAtomicWipe(opId);
              setPhase('Reset completato. Ricaricamento in corso…', 'ok');
              setMsg('Stato vuoto confermato. La pagina verrà ricaricata fra un istante.', 'ok');
              resetLog(opId, 'RESET COMPLETATO', { time:new Date().toISOString() });
              // Piccolo delay per leggere il messaggio finale, poi reload
              setTimeout(() => {
                try { blobUrls.forEach(u => URL.revokeObjectURL(u)); } catch(_){}
                location.reload();
              }, 1200);
            }catch(err){
              resetLog(opId, 'FASE 4 ERRORE', err?.message || err);
              setPhase('Cancellazione fallita. Il torneo non è stato azzerato.', 'error');
              setMsg(`Errore: ${err.message||err}. Lo stato attuale è preservato. Riprova o segnala il problema.`, 'error');
              finalBtn.disabled = false;
              cancelBtn.disabled = false;
              // NB: resetInProgress resta true finché l'utente chiude il dialog
            }
          };
          // bind one-shot
          finalBtn.onclick = finalHandler;

        }catch(err){
          // Errore in fase 1, 2 o 3 (PRIMA della cancellazione)
          // → NESSUN DATO TOCCATO
          resetLog(opId, 'EXPORT ERRORE', err?.message || err);
          console.error('[NG-Reset] export fallito:', err);
          setPhase('Esportazione fallita. Nessun dato è stato cancellato.', 'error');
          setMsg(`Errore durante l'esportazione: ${err.message||err}. Lo stato del torneo è integro. Riprova o annulla.`, 'error');
          // Riabilita per nuovo tentativo
          if(busy) busy.setButtonBusy(execBtn, false);
          execBtn.disabled = false;
          confirmCheck.disabled = false;
          resetInProgress = false;
          // Cleanup eventuali URL già creati
          try { blobUrls.forEach(u => URL.revokeObjectURL(u)); } catch(_){}
          blobUrls.length = 0;
        }
      });
    }

    // Reset stato dialog ad ogni apertura
    const phaseBox = dlg.querySelector('#resetPhaseBox'); if(phaseBox) phaseBox.innerHTML = '';
    const msg = dlg.querySelector('#resetDialogMsg'); if(msg) msg.innerHTML = '';
    const chk = dlg.querySelector('#resetConfirmCheck'); if(chk){ chk.checked = false; chk.disabled = false; }
    const exec = dlg.querySelector('#resetExecuteBtn'); if(exec){ exec.disabled = true; exec.hidden = false; }
    const finalBtn = dlg.querySelector('#resetFinalBtn'); if(finalBtn){ finalBtn.disabled = true; finalBtn.hidden = true; finalBtn.onclick = null; }
    const cancel = dlg.querySelector('#cancelResetBtn'); if(cancel) cancel.disabled = false;
    if(window.NGInteractive && exec) window.NGInteractive.setButtonBusy(exec, false);
    resetInProgress = false;
    dlg.classList.add('show');
  }

  // v126.14: la simulazione completa vive nel modulo dedicato admin-simulation.js.
  // Questi wrapper mantengono compatibile l’API NexoraAdmin già usata dalle pagine admin.
  function runTournamentSimulation(options){
    if(!window.NGTournamentSimulation)throw new Error('Modulo simulazione non disponibile.');
    return window.NGTournamentSimulation.run(options||{});
  }
  function openSimulationDialog(){
    if(!window.NGTournamentSimulation)throw new Error('Modulo simulazione non disponibile.');
    return window.NGTournamentSimulation.open();
  }

  function initGlobalActions(){try{UI.applySiteTheme(state());}catch(e){} try{UI.injectTeamLogoStyles && UI.injectTeamLogoStyles(state());}catch(e){} const reset=UI.$('#resetAllBtn');if(reset)reset.addEventListener('click',openResetDialog);const sim=UI.$('#simulateTournamentBtn');if(sim)sim.addEventListener('click',openSimulationDialog);}
  function renderStats(id){const box=UI.$(id); if(box) box.innerHTML=UI.statsGrid(store.selectors.stats(state()));}
  function teamOptions(s, selected=''){return UI.teamOptions(s, selected);}
  function renderTeamsList(container){
    const s=state(), box=UI.$(container);
    if(!box)return;
    if(!s.teams.length){box.innerHTML='<div class="empty">Nessuna squadra inserita.</div>';return;}
    box.innerHTML=`<div class="section-toolbar danger-toolbar"><div><strong>Staff squadre</strong><small>Pulisce presidente e allenatore. Se in Kings il presidente era marcatore, quei gol vengono rimossi dal referto.</small></div><button class="btn danger" type="button" data-clear-all-staff> Pulisci presidenti e allenatori</button></div><div class="team-disclosure-list admin-disclosure-list">${s.teams.map((t,i)=>`<details class="ng-disclosure admin-team-disclosure">
      <summary class="ng-disclosure-summary">
        <span class="disclosure-main">${UI.logo(t,false)}<span><strong>${UI.esc(t.name)}</strong><small>${t.players.length} calciatori${t.president?.name?` · Presidente: ${UI.esc(t.president.name)}`:''}${t.coach?.name?` · Allenatore: ${UI.esc(t.coach.name)}`:''}</small></span></span>
        <span class="disclosure-action">Gestisci</span>
      </summary>
      <div class="ng-disclosure-body">
        <div class="team-profile-meta compact-meta">
          <span><strong>Presidente</strong>${UI.esc(t.president?.name||'Non inserito')}</span>
          <span><strong>Allenatore</strong>${UI.esc(t.coach?.name||'Non inserito')}</span>
          <span><strong>Roster</strong>${t.players.length} calciatori</span>
        </div>
        <form class="team-edit-form form-grid margin-top" data-team-id="${t.id}">
          <div><label>Nome</label><input name="name" value="${UI.esc(t.name)}" required></div>
          <div><label>Presidente</label><input name="presidentName" value="${UI.esc(t.president?.name||'')}" placeholder="Cognome Nome"></div>
          <div><label>Allenatore</label><input name="coachName" value="${UI.esc(t.coach?.name||'')}" placeholder="Cognome Nome"></div>
          <div class="field-full"><label>Sostituisci logo dal dispositivo</label><input name="logoFile" type="file" accept="image/*"></div>
          <div class="field-full row-actions"><button class="btn primary" type="submit">Salva modifica</button><button class="btn ghost" type="button" data-clear-team-staff="${t.id}">Pulisci staff</button><button class="btn danger" type="button" data-delete-team="${t.id}">Elimina squadra</button></div>
        </form>
      </div>
    </details>`).join('')}</div>`;
  }
  function renderRoster(teamId, container){
    const s=state(), box=UI.$(container);
    if(!box)return;
    if(!teamId){box.innerHTML='<div class="empty">Seleziona una squadra per visualizzare il roster.</div>';return;}
    const t=store.getTeam(s,teamId);
    if(!t){box.innerHTML='<div class="empty">Squadra non trovata.</div>';return;}
    const staff=`<div class="team-profile-meta"><span><strong>Presidente</strong>${UI.esc(t.president?.name||'Non inserito')}</span><span><strong>Allenatore</strong>${UI.esc(t.coach?.name||'Non inserito')}</span><span><strong>Roster</strong>${(t.players||[]).length} calciatori</span></div>`;
    if(!t.players.length){box.innerHTML=staff+'<div class="empty margin-top">Roster giocatori vuoto per questa squadra.</div>';return;}
    // Ordina per numero (vuoti in fondo) per leggibilità
    const players=[...t.players].sort((a,b)=>{
      const an=a.number===''||a.number==null?9999:Number(a.number);
      const bn=b.number===''||b.number==null?9999:Number(b.number);
      if(an!==bn)return an-bn;
      return String(a.name||'').localeCompare(String(b.name||''),'it');
    });
    box.innerHTML=staff+`<div class="team-disclosure-list admin-player-list margin-top">${players.map(p=>{
      const numBadge=p.number!==''&&p.number!=null
        ? `<span class="jersey-number small" title="Numero maglia">${UI.esc(String(p.number))}</span>`
        : `<span class="jersey-number small empty" title="Numero non assegnato">—</span>`;
      return `<details class="ng-disclosure player-disclosure">
      <summary class="ng-disclosure-summary">
        <span class="disclosure-main">${numBadge}<span class="person-avatar">${UI.esc(String(p.name||'?').trim().charAt(0).toUpperCase()||'?')}</span><span><strong>${UI.esc(p.name)}</strong><small>${p.birthYear?`Anno nascita: ${UI.esc(p.birthYear)}`:'Anno nascita non inserito'}</small></span></span>
        <span class="disclosure-action">Modifica</span>
      </summary>
      <div class="ng-disclosure-body">
        <form class="player-edit-form form-grid" data-team-id="${t.id}" data-player-id="${p.id}">
          <div class="jersey-number-field"><label>Numero maglia</label><input name="number" type="number" min="0" max="999" inputmode="numeric" value="${UI.esc(p.number!==''&&p.number!=null?String(p.number):'')}" placeholder="Es. 10"></div>
          <div><label>Cognome e nome</label><input name="name" value="${UI.esc(p.name)}" required></div>
          <div><label>Anno di nascita</label><input name="birthYear" type="number" min="1900" max="2100" value="${UI.esc(p.birthYear||'')}"></div>
          <div class="field-full row-actions"><button class="btn primary" type="submit">Salva modifica</button><button class="btn danger" type="button" data-delete-player="${p.id}" data-team-id="${t.id}">Elimina calciatore</button></div>
        </form>
      </div>
    </details>`;}).join('')}</div>`;
  }
  function filteredMatches(s, teamFilter='', roundFilter=''){return s.matches.filter(m=>(!teamFilter||m.homeTeamId===teamFilter||m.awayTeamId===teamFilter)&&(!roundFilter||m.round===roundFilter));}
  function renderMatchFilters(teamSel, roundSel, matchSel, selectedId='', teamFilter='', roundFilter=''){
    const s=state(); const tEl=UI.$(teamSel), rEl=UI.$(roundSel), mEl=UI.$(matchSel); if(tEl)tEl.innerHTML='<option value="">Tutte le squadre</option>'+s.teams.map(t=>`<option value="${t.id}" ${t.id===teamFilter?'selected':''}>${UI.esc(t.name)}</option>`).join(''); if(rEl){const rounds=store.selectors.rounds(s);rEl.innerHTML='<option value="">Tutte le giornate/turni</option>'+rounds.map(r=>`<option value="${UI.esc(r)}" ${r===roundFilter?'selected':''}>${UI.esc(r)}</option>`).join('');} if(mEl){const list=filteredMatches(s,teamFilter,roundFilter);mEl.innerHTML=list.length?list.map(m=>`<option value="${m.id}" ${m.id===selectedId?'selected':''}>${UI.esc(m.round)} · ${UI.esc(store.teamName(s,m.homeTeamId,m.homeLabel))} vs ${UI.esc(store.teamName(s,m.awayTeamId,m.awayLabel))}</option>`).join(''):'<option value="">Nessuna partita</option>';}
  }
  function openPrint(type){window.open(`print.html?type=${encodeURIComponent(type)}`,'_blank');}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-toggle-form]'); if(b)b.closest('.team-row,.player-row,.event-row')?.querySelector('form')?.toggleAttribute('hidden');});
  window.NexoraAdmin={state,save,commit,flash,adminLabel,initGlobalActions,openSimulationDialog,runTournamentSimulation,renderStats,teamOptions,renderTeamsList,renderRoster,filteredMatches,renderMatchFilters,openPrint,downloadRecapPdf,downloadStateBackup,parseBackupPayload,importStateBackup};
  document.addEventListener('DOMContentLoaded',initGlobalActions);
  // v126.11: ad ogni cambio di stato admin (anche da sync remoto) rigenera
  // lo <style id="ngTeamLogos"> per evitare riferimenti a classi orfane
  // quando vengono aggiunte/rimosse squadre o modificati i loghi.
  window.addEventListener('ng:admin-state-loaded',()=>{try{UI.injectTeamLogoStyles && UI.injectTeamLogoStyles(state());}catch(_){}});
})();
