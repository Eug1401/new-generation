/*
 * admin-reports.js — v126.9 (editorial PDF rewrite)
 *
 * Generazione PDF amministratore. Riscrittura completa della grafica
 * mantenendo invariate logica di selezione dati, endpoint e librerie
 * (jsPDF 2.5 + jspdf-autotable 3.8). Stile editoriale chiaro per stampa.
 *
 *   Documenti generati:
 *     1. Classifica generale          (verticale)
 *     2. Marcatori (Top 15) + presidenti (verticale)
 *     3. Classifiche gironi           (verticale, una per girone)
 *     4. Recap partite concluse       (verticale)  <-- ex "Calendario"
 *                                     filtra: solo m.status==='played' && hasScore
 *     5. Tabellone fase finale        (orizzontale)
 *
 *   Filtro partite concluse: condiviso, vedi isConcluded(s,m).
 *   Nessun dato live finisce nei PDF.
 */
(function(){
  const store = window.NexoraStore;
  const UI    = window.NexoraUI;
  const A     = window.NexoraAdmin;

  // ---------------------------------------------------------------------
  // Stato UI della pagina report (filtri tabella in pagina, non nel PDF)
  // ---------------------------------------------------------------------
  let playerTeamFilter = '';
  let standingsGroup   = 'all';

  // ---------------------------------------------------------------------
  // Costanti grafiche — palette editoriale bianco/oro, leggibile in stampa
  // anche in bianco e nero (il gold si converte in grigio scuro coerente).
  // ---------------------------------------------------------------------
  const BRAND_LOGO = 'assets/brand/new-generation-logo-transparent.png';
  const C = {
    white     : [255,255,255],
    paper     : [253,251,247],   // riga alternata + pannelli leggeri
    ink       : [22,18,8],       // testo primario (near-black caldo)
    ink2      : [60,52,32],      // testo secondario
    muted     : [120,105,72],    // testo terziario, footer, caption
    hair      : [222,210,176],   // hairline (bordi sottili)
    rule      : [184,134,28],    // accent rule (linea sotto header)
    gold      : [184,134,28],    // accent primario
    goldInk   : [82,55,5],       // testo enfatico su sfondo gold-soft
    goldSoft  : [253,239,200],   // wash giallo crema per highlight
    goldFaint : [255,250,234],   // wash impalpabile (riepiloghi)
    green     : [21,99,52],      // stato "Giocata"
    greenSoft : [221,243,228],
    red       : [156,30,42],
  };

  // ---------------------------------------------------------------------
  // Utility colori, formato date, slug
  // ---------------------------------------------------------------------
  function setRgb(doc, method, rgb){ doc[method](rgb[0],rgb[1],rgb[2]); }
  function setFill(doc, rgb){ setRgb(doc,'setFillColor',rgb); }
  function setDraw(doc, rgb){ setRgb(doc,'setDrawColor',rgb); }
  function setText(doc, rgb){ setRgb(doc,'setTextColor',rgb); }

  function today(){
    return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date());
  }
  function todayShort(){
    return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium'}).format(new Date());
  }
  function slug(s){
    return String(s||'report').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,60)||'report';
  }
  function pdfName(s, type){
    return `${slug(s.rules?.name||'new-generation')}-${type}-${new Date().toISOString().slice(0,10)}.pdf`;
  }
  function fmtDate(m){ try { return UI.fmtDate(m) || '—'; } catch(_){ return '—'; } }
  function fmtNum(n){ return (n==null||Number.isNaN(n))?'—':String(n); }
  function fmtDiff(d){ if(d==null) return '—'; const n=Number(d)||0; return (n>0?'+':'')+n; }

  // ---------------------------------------------------------------------
  // Filtro centralizzato: una partita è "conclusa" se ha referto chiuso
  //   - status === 'played'  (riferimento autoritativo)
  //   - oppure hasScore(s,m) restituisce true E non è 'live'
  //     (copre l'edge case workflow: gol inseriti ma status non flippato)
  // Nessuna partita live, futura o non iniziata viene mai inclusa.
  // ---------------------------------------------------------------------
  function isConcluded(s, m){
    if(!m) return false;
    if(m.status === 'live') return false;
    if(m.status === 'played') return true;
    return Boolean(store.hasScore && store.hasScore(s, m));
  }

  // ---------------------------------------------------------------------
  // Cache immagini (lato generazione): un solo decode per stemma anche se
  // lo stesso URL compare più volte nel PDF.
  // ---------------------------------------------------------------------
  const imageCache = new Map();
  function dataUrlFromImage(src){
    if(!src) return Promise.resolve(null);
    if(imageCache.has(src)) return imageCache.get(src);
    const p = new Promise(resolve=>{
      if(/^data:image\//i.test(src)){ resolve(src); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let done = false;
      const finish = (val)=>{ if(done) return; done=true; resolve(val); };
      // Timeout di sicurezza: non blocco la generazione PDF se uno stemma
      // remoto è lento o non raggiungibile.
      setTimeout(()=>finish(null), 4000);
      img.onload = ()=>{
        try{
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width || 1;
          c.height = img.naturalHeight || img.height || 1;
          c.getContext('2d').drawImage(img, 0, 0);
          finish(c.toDataURL('image/png'));
        }catch(e){ finish(null); }
      };
      img.onerror = ()=>finish(null);
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }
  async function preloadTeamLogos(s){
    const out = {};
    await Promise.all((s.teams||[]).map(async t => { out[t.id] = await dataUrlFromImage(t.logo); }));
    return out;
  }
  function teamInitial(name){
    return String(name||'?').trim().split(/\s+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase() || 'NG';
  }

  // ---------------------------------------------------------------------
  // Disegno stemma: img reale oppure placeholder con iniziali su sfondo oro
  // tenue. Non interrompe mai la generazione PDF.
  // ---------------------------------------------------------------------
  function drawLogo(doc, src, x, y, size, label){
    if(src){
      try { doc.addImage(src, 'PNG', x, y, size, size, undefined, 'FAST'); return; }
      catch(_){ try { doc.addImage(src, 'JPEG', x, y, size, size, undefined, 'FAST'); return; } catch(__){} }
    }
    drawPlaceholderLogo(doc, x, y, size, label);
  }
  function drawPlaceholderLogo(doc, x, y, size, label){
    setFill(doc, C.goldFaint);
    setDraw(doc, C.hair);
    doc.setLineWidth(0.18);
    doc.roundedRect(x, y, size, size, size*0.18, size*0.18, 'FD');
    setText(doc, C.gold);
    doc.setFont('helvetica','bold');
    doc.setFontSize(Math.max(5, size*0.42));
    doc.text(teamInitial(label), x + size/2, y + size*0.62, { align:'center' });
  }

  // ---------------------------------------------------------------------
  // Header e footer editoriali (bianco/oro)
  //   - Topbar bianca con regola gold sotto
  //   - Mini-brand a sinistra, titolo grande centrato, meta a destra
  //   - Footer con pagina N/M e marca del documento
  // ---------------------------------------------------------------------
  function drawHeader(doc, ctx){
    const W = doc.internal.pageSize.getWidth();
    const margin = 14;
    const headerH = 28;
    // sfondo bianco esplicito (alcuni reader mostrano artefatti senza)
    setFill(doc, C.white); doc.rect(0, 0, W, headerH + 6, 'F');

    // logo brand a sinistra (se disponibile)
    if(ctx.brandLogo){ try { doc.addImage(ctx.brandLogo, 'PNG', margin, 6, 16, 16, undefined, 'FAST'); } catch(_){} }

    // mini-occhiello + nome competizione
    setText(doc, C.gold); doc.setFont('helvetica','bold'); doc.setFontSize(7);
    doc.text('NEW GENERATION · REPORT UFFICIALE', margin + 19, 9);
    setText(doc, C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(String(ctx.tournamentName||'New Generation'), margin + 19, 14.6, { maxWidth: W - margin*2 - 50 });
    setText(doc, C.muted); doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    if(ctx.subtitle) doc.text(String(ctx.subtitle), margin + 19, 19.4, { maxWidth: W - margin*2 - 50 });

    // titolo documento a destra
    setText(doc, C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(14);
    doc.text(String(ctx.title||''), W - margin, 13.5, { align:'right', maxWidth: W*0.5 });
    setText(doc, C.muted); doc.setFont('helvetica','normal'); doc.setFontSize(7);
    doc.text(`Generato il ${today()}`, W - margin, 19, { align:'right' });

    // regola gold sotto l'header
    setDraw(doc, C.rule); doc.setLineWidth(0.5);
    doc.line(margin, headerH, W - margin, headerH);
    setDraw(doc, C.hair); doc.setLineWidth(0.18);
    doc.line(margin, headerH + 0.9, W - margin, headerH + 0.9);
  }
  function drawFooter(doc, ctx){
    const total = doc.internal.getNumberOfPages();
    for(let i = 1; i <= total; i++){
      doc.setPage(i);
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const margin = 14;
      setDraw(doc, C.hair); doc.setLineWidth(0.18);
      doc.line(margin, H - 11, W - margin, H - 11);
      setText(doc, C.muted); doc.setFont('helvetica','normal'); doc.setFontSize(7);
      doc.text(`${ctx.tournamentName||'New Generation'} · ${ctx.docKind||'Report'}`, margin, H - 6.5);
      doc.text('newgeneration', W/2, H - 6.5, { align:'center' });
      doc.text(`Pagina ${i} di ${total}`, W - margin, H - 6.5, { align:'right' });
    }
  }

  // ---------------------------------------------------------------------
  // Sezione: occhiello + titolo + descrizione breve
  // ---------------------------------------------------------------------
  function drawSection(doc, eyebrow, title, descr, y){
    if(eyebrow){
      setText(doc, C.gold); doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
      doc.text(String(eyebrow).toUpperCase(), 14, y);
      y += 4;
    }
    setText(doc, C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(15);
    doc.text(String(title||''), 14, y);
    y += 5.4;
    if(descr){
      setText(doc, C.muted); doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
      const w = doc.internal.pageSize.getWidth() - 28;
      const lines = doc.splitTextToSize(String(descr), w);
      doc.text(lines, 14, y);
      y += lines.length * 4;
    }
    return y + 2;
  }

  // ---------------------------------------------------------------------
  // Riepilogo a card (4 colonne tipiche)
  // ---------------------------------------------------------------------
  // v126.11: drawSummary con auto-fit del valore e altezza card dinamica.
  // Prima il valore "Formato" (potenzialmente lungo: "Gironi + Eliminazione
  // diretta") andava a capo dentro la stessa card sovrapponendosi alla nota.
  // Ora:
  //  1) misuro la larghezza del valore e riduco il font fino a 7.5pt
  //  2) se ancora non basta, divido in più righe controllate
  //  3) calcolo la cardH come il massimo necessario fra tutte le card della
  //     riga, così le card restano uniformi e nessun testo si sovrappone
  function drawSummary(doc, items, y, cols=4){
    const list = (items||[]).filter(Boolean);
    if(!list.length) return y;
    const W = doc.internal.pageSize.getWidth();
    const margin = 14, gap = 4;
    const count = Math.max(1, Math.min(cols, list.length));
    const cardW = (W - margin*2 - gap*(count-1)) / count;
    const allowedTextW = cardW - 6; // padding interno orizzontale

    // Pre-misurazione per ogni card
    const computed = list.map(it => {
      const valStr  = String(it.value ?? '—');
      const noteStr = it.note ? String(it.note) : '';
      // Auto-shrink del valore: da 11pt fino a 7.5pt finché entra in una riga
      let valSize = 11;
      const scaleFactor = doc.internal.scaleFactor;
      while(valSize > 7.5){
        const w = doc.getStringUnitWidth(valStr) * valSize / scaleFactor;
        if(w <= allowedTextW) break;
        valSize -= 0.5;
      }
      // Se nemmeno a 7.5pt entra in una riga, splitto a capo controllato
      doc.setFontSize(valSize);
      const valLines = doc.splitTextToSize(valStr, allowedTextW);
      // Nota: max 2 righe a 6.6pt
      doc.setFontSize(6.6);
      const noteLines = noteStr ? doc.splitTextToSize(noteStr, allowedTextW).slice(0, 2) : [];
      return { it, valSize, valLines, noteLines };
    });

    // Altezza card uniforme = massimo necessario nella riga
    const topPad = 5.2;     // posizione baseline label
    const valTop = 3.4;     // gap fra label e prima riga del valore
    const valLineH = (sz) => sz * 0.42 + 0.6;
    // valore: usa la dimensione del valore più grande della riga
    const maxValSize  = Math.max(...computed.map(c => c.valSize));
    const maxValLines = Math.max(...computed.map(c => c.valLines.length));
    const maxNoteLines = Math.max(...computed.map(c => c.noteLines.length));
    const cardH = topPad + valTop + maxValLines * valLineH(maxValSize) + (maxNoteLines ? (1.5 + maxNoteLines * 3) : 0) + 3;

    computed.forEach((c, i)=>{
      const row = Math.floor(i / count);
      const col = i % count;
      const x   = margin + col*(cardW + gap);
      const yy  = y + row*(cardH + gap);
      setFill(doc, c.it.tone==='accent' ? C.goldSoft : C.goldFaint);
      setDraw(doc, C.hair); doc.setLineWidth(0.2);
      doc.roundedRect(x, yy, cardW, cardH, 2.4, 2.4, 'FD');
      // barretta laterale
      setFill(doc, c.it.tone==='accent' ? C.gold : C.hair);
      doc.rect(x, yy, 1.4, cardH, 'F');
      // label
      setText(doc, C.muted); doc.setFont('helvetica','bold'); doc.setFontSize(6.6);
      doc.text(String(c.it.label||'').toUpperCase(), x + 4, yy + topPad, { maxWidth: allowedTextW });
      // valore (può essere multi-line)
      setText(doc, C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(c.valSize);
      const valBaselineY = yy + topPad + valTop + valLineH(c.valSize);
      doc.text(c.valLines, x + 4, valBaselineY);
      // nota — sotto la fine del valore + gap fisso
      if(c.noteLines.length){
        setText(doc, C.muted); doc.setFont('helvetica','normal'); doc.setFontSize(6.6);
        const noteY = valBaselineY + (c.valLines.length - 1) * valLineH(c.valSize) + 3.2;
        doc.text(c.noteLines, x + 4, noteY);
      }
    });
    const rows = Math.ceil(list.length / count);
    return y + rows*cardH + (rows-1)*gap + 4;
  }

  function drawCallout(doc, text, y){
    if(!text) return y;
    const W = doc.internal.pageSize.getWidth();
    const margin = 14;
    const lines = doc.splitTextToSize(String(text), W - margin*2 - 6);
    const h = Math.max(8, 5 + lines.length*4.1);
    setFill(doc, C.goldFaint); setDraw(doc, C.gold); doc.setLineWidth(0.25);
    doc.roundedRect(margin, y, W - margin*2, h, 2, 2, 'FD');
    setText(doc, C.goldInk); doc.setFont('helvetica','italic'); doc.setFontSize(7.6);
    doc.text(lines, margin + 4, y + 5);
    return y + h + 3;
  }

  // ---------------------------------------------------------------------
  // Tema tabelle autoTable
  // ---------------------------------------------------------------------
  function tableTheme(extra){
    return Object.assign({
      theme: 'plain',
      styles: { font:'helvetica', fontSize:8.5, cellPadding:2.4, lineColor:C.hair, lineWidth:0.12, textColor:C.ink, overflow:'linebreak', valign:'middle' },
      headStyles: { fillColor:C.ink, textColor:C.goldSoft, fontStyle:'bold', fontSize:7.8, halign:'center', cellPadding:{top:2.6,right:2.4,bottom:2.6,left:2.4} },
      bodyStyles: { textColor:C.ink },
      alternateRowStyles: { fillColor:C.paper },
      margin: { left:14, right:14 },
      showHead: 'everyPage',
      tableLineColor: C.hair, tableLineWidth: 0.12,
      pageBreak: 'auto'
    }, extra||{});
  }

  // Hook: spazio extra a sinistra per il logo, nome team in bold
  function teamCellParse(col){
    return function(d){
      if(d.section==='body' && d.column.index===col){
        d.cell.styles.cellPadding = { top:2.4, right:2.4, bottom:2.4, left:10 };
        d.cell.styles.fontStyle = 'bold';
      }
    };
  }
  function teamCellDrawLogo(rows, col, logos, sizeMm){
    const size = sizeMm || 6.2;
    return function(d){
      if(d.section!=='body' || d.column.index!==col) return;
      const r = rows[d.row.index];
      if(!r) return;
      const teamId = r.teamId || r.homeTeamId || r.awayTeamId;
      const label  = r.name || r.team || r.teamName || r.home || r.away;
      drawLogo(d.doc, logos[teamId], d.cell.x + 1.6, d.cell.y + (d.cell.height - size)/2, size, label);
    };
  }

  // ---------------------------------------------------------------------
  // Preparazione documento base
  // ---------------------------------------------------------------------
  async function makeDoc(s, orientation, title, subtitle, docKind, format='a4'){
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation, unit:'mm', format, compress:true });
    const brandLogo = await dataUrlFromImage(BRAND_LOGO);
    const ctx = {
      brandLogo,
      tournamentName: s.rules?.name || 'New Generation',
      title,
      subtitle,
      docKind: docKind || title
    };
    // Metadata PDF
    try {
      doc.setProperties({
        title: `${ctx.tournamentName} · ${title}`,
        author: ctx.tournamentName,
        subject: title,
        creator: 'New Generation · Report Center',
        keywords: `${ctx.tournamentName}, report, ${title}`
      });
    } catch(_){}
    drawHeader(doc, ctx);
    return { doc, ctx };
  }

  // ---------------------------------------------------------------------
  // Snapshot dati coerente: tutti i PDF leggono lo stesso state e i loghi
  // tutti dalla stessa cache.
  // ---------------------------------------------------------------------
  function currentPdfState(){
    const s = A.state();
    const repair = store.repairState(s);
    A.save(s);
    const report = store.integrityReport(s);
    const blocking = (report.details||[]).filter(i => i.severity === 'error');
    if(blocking.length){
      throw new Error('Dati non coerenti per generare il PDF: ' + blocking.slice(0,3).map(i=>i.message).join(' · '));
    }
    if(repair.changed){
      toast('Dati riallineati con le ultime modifiche. Download in corso…');
      render();
    }
    return s;
  }

  function toast(msg, type='ok'){
    const box = UI.$('#pdfStatus');
    if(box) box.innerHTML = `<div class="message ${type}">${UI.esc(msg)}</div>`;
  }
  function toolsReady(){ return window.jspdf && window.jspdf.jsPDF; }

  // ---------------------------------------------------------------------
  // === PDF 1: CLASSIFICA GENERALE ======================================
  // ---------------------------------------------------------------------
  async function pdfStandings(){
    const s = currentPdfState();
    const logos = await preloadTeamLogos(s);
    const { doc, ctx } = await makeDoc(s, 'p',
      'Classifica generale',
      'Classifica ufficiale aggregata · partite live escluse',
      'Classifica');

    const rows = standingsRows(s).map((r,i)=>({ ...r, rank:i+1, diff:fmtDiff(r.diff) }));
    const concludedTotal = (s.matches||[]).filter(m => isConcluded(s,m)).length;
    const leader = rows[0] || null;
    const bestAtk = rows.slice().sort((a,b)=>(b.goalsFor-a.goalsFor)||a.name.localeCompare(b.name))[0]||null;
    const bestDef = rows.slice().sort((a,b)=>(a.goalsAgainst-b.goalsAgainst)||a.name.localeCompare(b.name))[0]||null;

    let y = 34;
    y = drawSection(doc,
      'Quadro classifica',
      'Andamento del torneo',
      'I valori riportati derivano esclusivamente dalle partite consolidate. Le partite in stato Live e quelle ancora da disputare non concorrono ai conteggi.',
      y);
    y = drawSummary(doc, [
      { label:'Capolista',         value: leader?leader.name:'—', note: leader?`${leader.points} pt · DR ${fmtDiff(leader.diff)}`:'Nessun dato', tone:'accent' },
      { label:'Miglior attacco',   value: bestAtk?bestAtk.name:'—', note: bestAtk?`${bestAtk.goalsFor} gol fatti`:'Nessun dato' },
      { label:'Miglior difesa',    value: bestDef?bestDef.name:'—', note: bestDef?`${bestDef.goalsAgainst} gol subiti`:'Nessun dato' },
      { label:'Partite concluse',  value: String(concludedTotal), note: 'Solo referto chiuso' }
    ], y, 4);

    doc.autoTable(Object.assign({}, tableTheme(), {
      startY: y,
      columns: [
        { header:'#',          dataKey:'rank' },
        { header:'Squadra',    dataKey:'name' },
        { header:'Pt',         dataKey:'points' },
        { header:'PG',         dataKey:'played' },
        { header:'V',          dataKey:'wins' },
        { header:'N',          dataKey:'draws' },
        { header:'P',          dataKey:'losses' },
        { header:'GF',         dataKey:'goalsFor' },
        { header:'GS',         dataKey:'goalsAgainst' },
        { header:'DR',         dataKey:'diff' }
      ],
      body: rows.length ? rows : [{ rank:'—', name:'Nessuna squadra disponibile', points:'—', played:'—', wins:'—', draws:'—', losses:'—', goalsFor:'—', goalsAgainst:'—', diff:'—', teamId:'' }],
      columnStyles: {
        0:{halign:'center', cellWidth:9,  fontStyle:'bold'},
        1:{cellWidth:64},
        2:{halign:'center', fontStyle:'bold'},
        3:{halign:'center'},
        4:{halign:'center'},
        5:{halign:'center'},
        6:{halign:'center'},
        7:{halign:'center'},
        8:{halign:'center'},
        9:{halign:'center'}
      },
      didParseCell: function(d){
        teamCellParse(1)(d);
        if(d.section==='body' && d.column.index===0 && d.row.index<3 && rows[d.row.index]){
          d.cell.styles.textColor = C.goldInk;
          d.cell.styles.fillColor = C.goldFaint;
        }
      },
      didDrawCell: teamCellDrawLogo(rows, 1, logos)
    }));

    drawFooter(doc, ctx);
    doc.save(pdfName(s, 'classifica'));
  }
  function standingsRows(s, phase){
    return phase
      ? store.selectors.calculateStandings(s, phase)
      : (store.selectors.officialStandings ? store.selectors.officialStandings(s) : store.selectors.calculateStandings(s));
  }

  // ---------------------------------------------------------------------
  // === PDF 2: MARCATORI (TOP 15) ======================================
  // ---------------------------------------------------------------------
  async function pdfScorers(){
    const s = currentPdfState();
    const logos = await preloadTeamLogos(s);
    const { doc, ctx } = await makeDoc(s, 'p',
      'Marcatori',
      'Top 15 calciatori del torneo · partite live escluse',
      'Marcatori');

    const rows = store.selectors.scorers(s).slice(0,15).map((p,i)=>({
      ...p, rank:i+1, player:p.name, team:p.teamName, year:p.birthYear||'—'
    }));
    const stats = store.selectors.stats(s);

    let y = 34;
    y = drawSection(doc,
      'Focus marcatori',
      'Graduatoria del torneo',
      'La classifica considera esclusivamente gol consolidati. I match live e i gol non ancora confermati non influiscono sui totali.',
      y);
    y = drawSummary(doc, [
      { label:'Capocannoniere',       value: rows[0]?rows[0].player:'—', note: rows[0]?`${rows[0].goals} gol · ${rows[0].team}`:'Nessun gol registrato', tone:'accent' },
      { label:'In classifica',        value: String(rows.length), note:'Top 15 visualizzata' },
      { label:'Gol totali consolidati', value: String(stats.actualGoals||0), note:'Solo referto chiuso' },
      { label:'Media gol/partita',    value: stats.matchesPlayed ? ((stats.scoreGoals||0)/stats.matchesPlayed).toFixed(2) : '0.00', note:'Calcolo ufficiale' }
    ], y, 4);

    doc.autoTable(Object.assign({}, tableTheme(), {
      startY: y,
      columns: [
        { header:'#',         dataKey:'rank' },
        { header:'Calciatore',dataKey:'player' },
        { header:'Anno',      dataKey:'year' },
        { header:'Squadra',   dataKey:'team' },
        { header:'Gol',       dataKey:'goals' },
        { header:'PG',        dataKey:'played' },
        { header:'Gialli',    dataKey:'yellow' },
        { header:'Rossi',     dataKey:'red' }
      ],
      body: rows.length ? rows : [{ rank:'—', player:'Nessun marcatore disponibile', year:'—', team:'—', goals:'—', played:'—', yellow:'—', red:'—', teamId:'' }],
      columnStyles: {
        0:{halign:'center', cellWidth:9, fontStyle:'bold'},
        1:{cellWidth:54, fontStyle:'bold'},
        2:{halign:'center', cellWidth:14},
        3:{cellWidth:52},
        4:{halign:'center', fontStyle:'bold'},
        5:{halign:'center'},
        6:{halign:'center'},
        7:{halign:'center'}
      },
      didParseCell: teamCellParse(3),
      didDrawCell: teamCellDrawLogo(rows, 3, logos)
    }));

    // Sezione presidenti — accodata, salta pagina se non c'è spazio
    const pres = (store.selectors.presidentScorers ? store.selectors.presidentScorers(s) : [])
      .slice(0,15).map((p,i)=>({ ...p, rank:i+1, president:p.name, team:p.teamName }));
    let py = (doc.lastAutoTable?.finalY || y) + 10;
    const H = doc.internal.pageSize.getHeight();
    if(py > H - 60){
      doc.addPage();
      drawHeader(doc, ctx);
      py = 34;
    }
    py = drawSection(doc, 'Sezione speciale', 'Presidenti marcatori',
      'Classifica autonoma riservata ai format con regole speciali; non confluisce nella graduatoria calciatori.', py);

    doc.autoTable(Object.assign({}, tableTheme(), {
      startY: py,
      columns: [
        { header:'#',          dataKey:'rank' },
        { header:'Presidente', dataKey:'president' },
        { header:'Squadra',    dataKey:'team' },
        { header:'Gol',        dataKey:'goals' },
        { header:'PG',         dataKey:'played' }
      ],
      body: pres.length ? pres : [{ rank:'—', president:'Nessun gol presidente disponibile', team:'—', goals:'—', played:'—', teamId:'' }],
      columnStyles: {
        0:{halign:'center', cellWidth:9, fontStyle:'bold'},
        1:{cellWidth:62, fontStyle:'bold'},
        2:{cellWidth:62},
        3:{halign:'center', fontStyle:'bold'},
        4:{halign:'center'}
      },
      didParseCell: teamCellParse(2),
      didDrawCell: teamCellDrawLogo(pres, 2, logos)
    }));

    drawFooter(doc, ctx);
    doc.save(pdfName(s, 'marcatori'));
  }

  // ---------------------------------------------------------------------
  // === PDF 3: CLASSIFICHE GIRONI ======================================
  // ---------------------------------------------------------------------
  async function pdfGroups(){
    const s = currentPdfState();
    const logos = await preloadTeamLogos(s);
    const { doc, ctx } = await makeDoc(s, 'p',
      'Classifiche gironi',
      'Una classifica dedicata per ogni girone',
      'Gironi');

    const groups = store.selectors.groupedStandings(s);
    if(!groups.length){
      let y = 34;
      y = drawSection(doc, 'Gironi', 'Nessun girone configurato',
        'Il formato di questo torneo non prevede gironi. Configura i raggruppamenti dalle Regole per generare il documento.', y);
      drawCallout(doc, 'Documento valido ma vuoto: il formato attuale non utilizza gironi.', y);
      drawFooter(doc, ctx);
      doc.save(pdfName(s, 'classifiche-gironi'));
      return;
    }

    let y = 34;
    y = drawSection(doc, 'Panoramica gironi',
      'Quadro generale',
      'Ogni girone viene riportato in una sezione dedicata. I dati sono calcolati esclusivamente sulle partite consolidate.', y);
    y = drawSummary(doc, [
      { label:'Gironi attivi',     value:String(groups.length),                            note:'Blocchi classifica' },
      { label:'Gironi completati', value:String(groups.filter(g=>g.completed).length),    note:'Stato corrente', tone:'accent' },
      { label:'Squadre coinvolte', value:String((s.teams||[]).length),                    note:'Totale partecipanti' },
      { label:'Formato',           value:String(store.FORMAT_LABELS[s.rules?.format]||s.rules?.format||'—'), note:'Struttura del torneo' }
    ], y, 4);

    groups.forEach((g, idx) => {
      if(idx>0){
        doc.addPage();
        drawHeader(doc, ctx);
        y = 34;
      }
      const leader = g.rows?.[0] || null;
      const bestAtk = (g.rows||[]).slice().sort((a,b)=>(b.goalsFor-a.goalsFor)||a.name.localeCompare(b.name))[0]||null;
      const bestDef = (g.rows||[]).slice().sort((a,b)=>(a.goalsAgainst-b.goalsAgainst)||a.name.localeCompare(b.name))[0]||null;
      const qualifiers = (s.rules?.groupConfigs||[]).find(c=>c.name===g.name)?.qualifiers;

      y = drawSection(doc,
        `Girone ${idx+1} di ${groups.length}`,
        g.name || `Girone ${idx+1}`,
        [`Stato: ${g.completed?'completato':'in corso'}`, qualifiers?`qualificate previste: ${qualifiers}`:null].filter(Boolean).join(' · '),
        y);
      y = drawSummary(doc, [
        { label:'Capolista',       value: leader?leader.name:'—', note: leader?`${leader.points} pt`:'Nessun dato', tone:'accent' },
        { label:'Miglior attacco', value: bestAtk?bestAtk.name:'—', note: bestAtk?`${bestAtk.goalsFor} gol fatti`:'—' },
        { label:'Miglior difesa',  value: bestDef?bestDef.name:'—', note: bestDef?`${bestDef.goalsAgainst} gol subiti`:'—' },
        { label:'Squadre',         value: String((g.rows||[]).length), note: g.completed?'Girone chiuso':'In aggiornamento' }
      ], y, 4);

      const rows = (g.rows||[]).map((r,i)=>({ ...r, rank:i+1, diff:fmtDiff(r.diff) }));
      doc.autoTable(Object.assign({}, tableTheme(), {
        startY: y,
        columns: [
          { header:'#',      dataKey:'rank' },
          { header:'Squadra',dataKey:'name' },
          { header:'Pt',     dataKey:'points' },
          { header:'PG',     dataKey:'played' },
          { header:'V',      dataKey:'wins' },
          { header:'N',      dataKey:'draws' },
          { header:'P',      dataKey:'losses' },
          { header:'GF',     dataKey:'goalsFor' },
          { header:'GS',     dataKey:'goalsAgainst' },
          { header:'DR',     dataKey:'diff' }
        ],
        body: rows,
        columnStyles: {
          0:{halign:'center', cellWidth:9, fontStyle:'bold'},
          1:{cellWidth:64},
          2:{halign:'center', fontStyle:'bold'},
          3:{halign:'center'},
          4:{halign:'center'},
          5:{halign:'center'},
          6:{halign:'center'},
          7:{halign:'center'},
          8:{halign:'center'},
          9:{halign:'center'}
        },
        didParseCell: function(d){
          teamCellParse(1)(d);
          if(qualifiers && d.section==='body' && d.column.index===0 && d.row.index < qualifiers){
            d.cell.styles.textColor = C.goldInk;
            d.cell.styles.fillColor = C.goldSoft;
          }
        },
        didDrawCell: teamCellDrawLogo(rows, 1, logos)
      }));
      y = (doc.lastAutoTable?.finalY || y) + 8;
    });

    drawFooter(doc, ctx);
    doc.save(pdfName(s, 'classifiche-gironi'));
  }

  // ---------------------------------------------------------------------
  // Filtro per il PDF "Calendario completo": includi tutto TRANNE le live.
  // Distinto da isConcluded (che è solo per il recap delle partite).
  // ---------------------------------------------------------------------
  function isInCalendar(s, m){
    if(!m) return false;
    if(m.status === 'live') return false;
    return true; // include 'played', 'scheduled' e qualsiasi stato non-live
  }
  function calendarStatusLabel(s, m){
    if(m.status === 'live') return 'Live';
    if(isConcluded(s, m)) return 'Giocata';
    return 'Da giocare';
  }

  // ---------------------------------------------------------------------
  // === PDF: CALENDARIO COMPLETO (verticale o orizzontale) =============
  //     Include partite concluse + partite da giocare. ESCLUDE le live.
  //     Per le partite concluse mostra il risultato finale; per le altre
  //     mostra "Da giocare" senza inventare punteggi fittizi.
  // ---------------------------------------------------------------------
  async function pdfCalendar(){
    const s = currentPdfState();
    const logos = await preloadTeamLogos(s);
    // Per calendari estesi conviene il formato orizzontale: più colonne
    // visibili senza compressione dei testi.
    const { doc, ctx } = await makeDoc(s, 'l',
      'Calendario completo',
      'Partite concluse e da giocare · live escluse',
      'Calendario');

    // Filtro centralizzato (no live), ordinamento stabile per data/ora/round.
    const rows = (s.matches||[])
      .filter(m => isInCalendar(s, m))
      .sort((a,b) => {
        const da = String(a.date||''), db = String(b.date||'');
        if(da !== db) return da.localeCompare(db);
        const ta = String(a.time||''), tb = String(b.time||'');
        if(ta !== tb) return ta.localeCompare(tb);
        if((a.roundIndex||0) !== (b.roundIndex||0)) return (a.roundIndex||0) - (b.roundIndex||0);
        return String(a.id||'').localeCompare(String(b.id||''));
      })
      .map(m => ({
        phase  : store.PHASE_LABELS?.[m.phase] || m.phase || '—',
        round  : m.round || '—',
        date   : fmtDate(m),
        field  : m.field || '—',
        homeId : m.homeTeamId,
        awayId : m.awayTeamId,
        home   : store.teamName(s, m.homeTeamId, m.homeLabel) || m.homeLabel || 'Da definire',
        away   : store.teamName(s, m.awayTeamId, m.awayLabel) || m.awayLabel || 'Da definire',
        score  : isConcluded(s, m) ? (store.scoreText ? store.scoreText(s, m) : '—') : 'Da giocare',
        concluded: isConcluded(s, m),
        teamId : m.homeTeamId, // per il logo della prima colonna squadra
      }));

    const concluded = rows.filter(r => r.concluded).length;
    const pending   = rows.length - concluded;
    const liveExcluded = (s.matches||[]).filter(m => m.status === 'live').length;

    let y = 34;
    y = drawSection(doc,
      'Programma gare',
      'Calendario integrale del torneo',
      'Vengono incluse esclusivamente partite concluse e da giocare. Le partite live sono escluse: il loro stato non è stabile e cambierebbe ad ogni rigenerazione del documento.',
      y);

    y = drawSummary(doc, [
      { label:'Partite totali',  value:String(rows.length), note:'Concluse + da giocare' },
      { label:'Concluse',        value:String(concluded), note:'Referto chiuso', tone:'accent' },
      { label:'Da giocare',      value:String(pending),   note:'In programma' },
      { label:'Live escluse',    value:String(liveExcluded), note: liveExcluded ? 'Non riportate nel PDF' : 'Nessuna live in corso' }
    ], y, 4);

    if(!rows.length){
      y = drawCallout(doc, 'Calendario vuoto: nessuna partita disponibile da stampare al momento.', y);
      drawFooter(doc, ctx);
      doc.save(pdfName(s, 'calendario-completo'));
      return;
    }
    if(liveExcluded){
      y = drawCallout(doc, `${liveExcluded} partit${liveExcluded===1?'a':'e'} attualmente live esclus${liveExcluded===1?'a':'e'} dal calendario: vengono escluse per garantire un documento stabile alla rigenerazione.`, y);
    }

    // Tabella principale del calendario
    doc.autoTable(Object.assign({}, tableTheme(), {
      startY: y,
      columns: [
        { header:'Fase',          dataKey:'phase' },
        { header:'Giornata',      dataKey:'round' },
        { header:'Data e ora',    dataKey:'date' },
        { header:'Casa',          dataKey:'home' },
        { header:'Ospite',        dataKey:'away' },
        { header:'Campo',         dataKey:'field' },
        { header:'Risultato',     dataKey:'score' }
      ],
      body: rows,
      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: 28, halign:'center' },
        2: { cellWidth: 36 },
        3: { cellWidth: 56 },
        4: { cellWidth: 56 },
        5: { cellWidth: 34 },
        6: { cellWidth: 28, halign:'center', fontStyle:'bold' }
      },
      didParseCell: function(d){
        // Padding-left per fare spazio al logo nelle colonne squadra
        if(d.section === 'body' && (d.column.index === 3 || d.column.index === 4)){
          d.cell.styles.cellPadding = { top: 2.4, right: 2.4, bottom: 2.4, left: 10 };
          d.cell.styles.fontStyle = 'bold';
        }
        // Highlight risultato concluso
        if(d.section === 'body' && d.column.index === 6){
          const row = rows[d.row.index];
          if(row && row.concluded){
            d.cell.styles.fillColor = C.goldSoft;
            d.cell.styles.textColor = C.goldInk;
          } else {
            d.cell.styles.textColor = C.muted;
            d.cell.styles.fontStyle = 'italic';
          }
        }
      },
      didDrawCell: function(d){
        if(d.section !== 'body') return;
        const r = rows[d.row.index];
        if(!r) return;
        if(d.column.index === 3) drawLogo(d.doc, logos[r.homeId], d.cell.x + 1.6, d.cell.y + (d.cell.height-6)/2, 6, r.home);
        if(d.column.index === 4) drawLogo(d.doc, logos[r.awayId], d.cell.x + 1.6, d.cell.y + (d.cell.height-6)/2, 6, r.away);
      }
    }));

    drawFooter(doc, ctx);
    doc.save(pdfName(s, 'calendario-completo'));
  }

  // ---------------------------------------------------------------------
  // === PDF 4: RECAP PARTITE CONCLUSE (verticale) ======================
  //     Mostra SOLO m.status==='played' (con fallback hasScore && !live).
  //     Una scheda per partita con: squadre + stemmi, risultato grande,
  //     metadati (data/ora/campo/fase/giornata), marcatori, cartellini,
  //     rigori KO se presenti.
  // ---------------------------------------------------------------------
  async function pdfRecap(){
    const s = currentPdfState();
    const logos = await preloadTeamLogos(s);
    const { doc, ctx } = await makeDoc(s, 'p',
      'Recap partite',
      'Solo partite con referto chiuso',
      'Recap partite');

    // Filtro: SOLO partite concluse
    const concluded = (s.matches||[])
      .filter(m => isConcluded(s, m))
      .sort((a,b)=>{
        const da = String(a.date||'');
        const db = String(b.date||'');
        if(da !== db) return da.localeCompare(db);
        const ta = String(a.time||'');
        const tb = String(b.time||'');
        if(ta !== tb) return ta.localeCompare(tb);
        return (a.roundIndex||0) - (b.roundIndex||0);
      });

    let y = 34;
    y = drawSection(doc, 'Recap ufficiale', 'Partite concluse',
      'Documento riepilogativo delle partite con referto chiuso. Le partite live, future o sospese non sono incluse.', y);

    // Statistiche aggregate calcolate SOLO sulle concluse incluse nel PDF
    if(concluded.length){
      const teams = new Set();
      let totGoals = 0, totCards = 0;
      concluded.forEach(m => {
        if(m.homeTeamId) teams.add(m.homeTeamId);
        if(m.awayTeamId) teams.add(m.awayTeamId);
        totGoals += (m.goals||[]).filter(g => !g.ownGoal).length + (m.goals||[]).filter(g=>g.ownGoal).length;
        // più semplice: gol = lunghezza array (autogol inclusi)
        totGoals = totGoals; // no-op, già contato sopra (sostituisco sotto)
        totCards += (m.cards||[]).length;
      });
      const totGoalsClean = concluded.reduce((acc,m)=>acc+(m.goals||[]).length,0);
      y = drawSummary(doc, [
        { label:'Partite concluse',  value:String(concluded.length), note:'Incluse nel PDF', tone:'accent' },
        { label:'Squadre coinvolte', value:String(teams.size), note:'Partecipanti unici' },
        { label:'Gol totali',        value:String(totGoalsClean), note:'Su partite incluse' },
        { label:'Cartellini',        value:String(totCards), note:'Gialli + rossi' }
      ], y, 4);
    } else {
      y = drawSummary(doc, [
        { label:'Partite concluse', value:'0', note:'Nessuna ancora consolidata' },
        { label:'Squadre iscritte', value:String((s.teams||[]).length), note:'Totale partecipanti' }
      ], y, 4) + 2;
      y = drawCallout(doc, 'Nessuna partita conclusa al momento. Quando i referti verranno chiusi compariranno qui in formato scheda dettagliata.', y);
      drawFooter(doc, ctx);
      doc.save(pdfName(s, 'recap-partite'));
      return;
    }

    // Card una per partita
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const margin = 14;
    const cardW = W - margin*2;
    const cardH = 50;
    const cardGap = 4;

    concluded.forEach(m => {
      if(y + cardH > H - 18){
        doc.addPage();
        drawHeader(doc, ctx);
        y = 34;
      }
      drawMatchCard(doc, s, logos, m, margin, y, cardW, cardH);
      y += cardH + cardGap;
    });

    drawFooter(doc, ctx);
    doc.save(pdfName(s, 'recap-partite'));
  }

  function drawMatchCard(doc, s, logos, m, x, y, w, h){
    // Cornice
    setFill(doc, C.white); setDraw(doc, C.hair); doc.setLineWidth(0.22);
    doc.roundedRect(x, y, w, h, 2.4, 2.4, 'FD');
    // Striscia gold a sinistra: segno "concluso" (oltre al testo)
    setFill(doc, C.gold); doc.rect(x, y, 1.6, h, 'F');

    // Meta in alto: fase · giornata · data · ora · campo
    const phase = store.PHASE_LABELS?.[m.phase] || m.phase || '';
    const round = m.round || '';
    const date  = fmtDate(m);
    const field = m.field || '';
    const referee = m.referee || '';
    const metaTop = [
      phase || null,
      round ? `${round}` : null,
      date && date!=='—' ? date : null,
      field ? `Campo: ${field}` : null
    ].filter(Boolean).join('  ·  ');
    setText(doc, C.muted); doc.setFont('helvetica','bold'); doc.setFontSize(6.8);
    doc.text(String(metaTop).toUpperCase(), x + 5, y + 4.8, { maxWidth: w - 36 });
    setText(doc, C.green); doc.setFont('helvetica','bold'); doc.setFontSize(6.8);
    doc.text('GIOCATA', x + w - 5, y + 4.8, { align:'right' });

    // Squadra HOME (sinistra)
    const homeId   = m.homeTeamId;
    const homeName = store.teamName(s, homeId, m.homeLabel) || 'Da definire';
    const awayId   = m.awayTeamId;
    const awayName = store.teamName(s, awayId, m.awayLabel) || 'Da definire';
    const winnerId = store.winnerId ? store.winnerId(s, m) : '';
    const sc = store.matchGoals ? store.matchGoals(s, m) : { home:0, away:0 };
    const homeWin = winnerId && winnerId === homeId;
    const awayWin = winnerId && winnerId === awayId;

    const teamY = y + 11;
    const logoSize = 13;

    // Home logo + nome
    drawLogo(doc, logos[homeId], x + 5, teamY, logoSize, homeName);
    setText(doc, homeWin ? C.goldInk : C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(String(homeName), x + 5 + logoSize + 3, teamY + 6, { maxWidth: (w/2) - 24 });
    if(homeWin){
      setText(doc, C.gold); doc.setFont('helvetica','bold'); doc.setFontSize(6.4);
      doc.text('VINCITRICE', x + 5 + logoSize + 3, teamY + 11);
    }

    // Score box centrale
    const scoreCx = x + w/2;
    const scoreBoxW = 34, scoreBoxH = 16;
    setFill(doc, C.ink);
    doc.roundedRect(scoreCx - scoreBoxW/2, teamY - 1, scoreBoxW, scoreBoxH, 2, 2, 'F');
    setText(doc, C.goldSoft); doc.setFont('helvetica','bold'); doc.setFontSize(16);
    const scoreText = `${fmtNum(sc.home)} – ${fmtNum(sc.away)}`;
    doc.text(scoreText, scoreCx, teamY + 9.6, { align:'center' });
    // Rigori
    if(m.penalties && (m.penalties.home != null || m.penalties.away != null)){
      setText(doc, C.muted); doc.setFont('helvetica','italic'); doc.setFontSize(6.6);
      doc.text(`Rigori ${fmtNum(m.penalties.home)} – ${fmtNum(m.penalties.away)}`, scoreCx, teamY + scoreBoxH + 2.4, { align:'center' });
    }

    // Away logo + nome (a destra, mirrored)
    drawLogo(doc, logos[awayId], x + w - 5 - logoSize, teamY, logoSize, awayName);
    setText(doc, awayWin ? C.goldInk : C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(String(awayName), x + w - 5 - logoSize - 3, teamY + 6, { align:'right', maxWidth:(w/2) - 24 });
    if(awayWin){
      setText(doc, C.gold); doc.setFont('helvetica','bold'); doc.setFontSize(6.4);
      doc.text('VINCITRICE', x + w - 5 - logoSize - 3, teamY + 11, { align:'right' });
    }

    // Linea separatore
    setDraw(doc, C.hair); doc.setLineWidth(0.16);
    doc.line(x + 5, y + h - 16, x + w - 5, y + h - 16);

    // Eventi: marcatori + cartellini  (su due colonne)
    const events = buildMatchEvents(s, m);
    const goalsList = events.goals.length ? events.goals : [];
    const cardsList = events.cards.length ? events.cards : [];
    const evY = y + h - 13;

    setText(doc, C.muted); doc.setFont('helvetica','bold'); doc.setFontSize(6.4);
    doc.text('GOL', x + 5, evY);
    setText(doc, C.ink); doc.setFont('helvetica','normal'); doc.setFontSize(7.4);
    const goalsText = goalsList.length ? goalsList.map(g=>{
      const own = g.ownGoal ? ' (AG)' : '';
      const team = g.teamSide === 'home' ? '◀' : '▶';
      return `${team} ${g.name}${own}`;
    }).join('  ·  ') : '—';
    const goalsLines = doc.splitTextToSize(goalsText, w/2 - 10);
    doc.text(goalsLines.slice(0,2), x + 5, evY + 3.6);

    setText(doc, C.muted); doc.setFont('helvetica','bold'); doc.setFontSize(6.4);
    doc.text('CARTELLINI', x + w/2 + 2, evY);
    setText(doc, C.ink); doc.setFont('helvetica','normal'); doc.setFontSize(7.4);
    const cardsText = cardsList.length ? cardsList.map(c=>{
      const sym = c.type==='red' ? '🟥' : '🟨';
      const team = c.teamSide === 'home' ? '◀' : '▶';
      return `${team} ${c.name} (${c.type==='red'?'R':'G'})`;
    }).join('  ·  ') : '—';
    const cardsLines = doc.splitTextToSize(cardsText, w/2 - 10);
    doc.text(cardsLines.slice(0,2), x + w/2 + 2, evY + 3.6);

    // Arbitro in basso a destra (se presente)
    if(referee){
      setText(doc, C.muted); doc.setFont('helvetica','italic'); doc.setFontSize(6.4);
      doc.text(`Arbitro: ${referee}`, x + w - 5, y + h - 1.8, { align:'right' });
    }
  }
  function buildMatchEvents(s, m){
    const goals = (m.goals||[]).map(g => {
      const team = g.teamId === m.homeTeamId ? 'home' : (g.teamId === m.awayTeamId ? 'away' : null);
      let name = '—';
      try {
        const t = store.getTeam(s, g.teamId);
        const p = (t?.roster||[]).find(x => x.id === g.playerId);
        name = p?.name || (g.ownGoal ? '(autogol)' : '—');
      } catch(_){ name = '—'; }
      return { name, ownGoal:Boolean(g.ownGoal), teamSide:team };
    });
    const cards = (m.cards||[]).map(c => {
      const team = c.teamId === m.homeTeamId ? 'home' : (c.teamId === m.awayTeamId ? 'away' : null);
      let name = '—';
      try {
        const t = store.getTeam(s, c.teamId);
        const p = (t?.roster||[]).find(x => x.id === c.playerId);
        name = p?.name || '—';
      } catch(_){ name = '—'; }
      return { name, type:(c.type==='red'?'red':'yellow'), teamSide:team };
    });
    return { goals, cards };
  }

  // ---------------------------------------------------------------------
  // === PDF 5: TABELLONE FASE FINALE (orizzontale) =====================
  //     Layout a colonne per turno, header dei turni in alto, card per
  //     incontro con due righe squadra + score box. Linee di connessione
  //     gold sottili. Sezione vincitore finale se determinato.
  // ---------------------------------------------------------------------
  async function pdfBracket(){
    const s = currentPdfState();
    const logos = await preloadTeamLogos(s);
    const data = store.bracketData(s);
    const roundsMax = data.available ? Math.max(1,...(data.brackets||[]).map(b=>(b.rounds||[]).length)) : 1;
    const matchesMax = data.available ? Math.max(1,...(data.brackets||[]).flatMap(b=>(b.rounds||[]).map(r=>(r.matches||[]).length))) : 1;
    const bracketFormat = data.available ? [Math.max(297, 42 + roundsMax*72 + Math.max(0,roundsMax-1)*16), Math.max(210, 78 + matchesMax*34)] : 'a4';
    const { doc, ctx } = await makeDoc(s, 'l',
      'Tabellone',
      'Fase finale · eliminazione diretta',
      'Tabellone',
      bracketFormat);
    if(!data.available){
      let y = 34;
      y = drawSection(doc, 'Tabellone', 'Non disponibile',
        data.message || 'Il formato di questo torneo non prevede una fase a eliminazione diretta.', y);
      drawCallout(doc, 'Documento valido ma vuoto: il formato attuale non utilizza un tabellone a eliminazione.', y);
      drawFooter(doc, ctx);
      doc.save(pdfName(s, 'tabellone'));
      return;
    }

    const brackets = data.brackets || [];
    let firstBracketDone = false;
    brackets.forEach(b => {
      if(firstBracketDone){ doc.addPage(bracketFormat,'landscape'); drawHeader(doc, ctx); }
      drawBracketBlock(doc, s, logos, b, ctx);
      firstBracketDone = true;
    });

    drawFooter(doc, ctx);
    doc.save(pdfName(s, 'tabellone'));
  }
  function drawBracketBlock(doc, s, logos, bracket, ctx){
    // Intro del singolo blocco di tabellone (può essere "Tabellone principale",
    // "Coppa secondaria", "Supercoppa", ecc.)
    let y = 34;
    y = drawSection(doc, 'Bracket', String(bracket.name||'Tabellone'),
      'Percorso eliminazione diretta. Le squadre evidenziate sono quelle qualificate al turno successivo.', y);

    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const margin = 13;
    const top    = y + 2;
    const bottom = 24; // footer + winner space
    const rounds = bracket.rounds || [];

    if(!rounds.length){
      drawCallout(doc, 'Tabellone ancora senza abbinamenti. Gli incontri compariranno qui appena verranno generati.', top);
      return;
    }

    const colGap = 14;
    const colW = (W - margin*2 - colGap*Math.max(0, rounds.length-1)) / Math.max(1, rounds.length);
    const headerH = 11;

    // Disegno intestazione turni (chip oro)
    rounds.forEach((round, ri) => {
      const x = margin + ri*(colW + colGap);
      setFill(doc, C.ink);
      doc.roundedRect(x, top, colW, headerH, 1.6, 1.6, 'F');
      setText(doc, C.goldSoft); doc.setFont('helvetica','bold'); doc.setFontSize(8.4);
      doc.text(String(round.name || `Turno ${ri+1}`).toUpperCase(), x + colW/2, top + headerH*0.66, { align:'center', maxWidth: colW - 4 });
    });

    // Calcolo geometria card per turno
    const matchSlots = []; // [{ri, mi, x, y, w, h, midY}]
    rounds.forEach((round, ri) => {
      const matches = round.matches || [];
      const count = Math.max(1, matches.length);
      const x = margin + ri*(colW + colGap);
      const usableTop = top + headerH + 4;
      const usableBottom = H - bottom;
      const usableH = usableBottom - usableTop;
      const gapY = Math.max(8, Math.min(14, (usableH - count*30) / Math.max(1,count+1)));
      const cardH = Math.max(30, Math.min(42, (usableH - (count-1)*gapY) / count));
      const totalH = count*cardH + (count-1)*gapY;
      const startY = usableTop + (usableH - totalH)/2;
      matches.forEach((m, mi) => {
        const cy = startY + mi*(cardH + gapY);
        drawBracketMatchCard(doc, s, logos, m, x, cy, colW, cardH, mi);
        matchSlots.push({ ri, mi, x, y:cy, w:colW, h:cardH, midY: cy + cardH/2 });
      });
    });

    // Linee di collegamento gold (turno N → turno N+1)
    setDraw(doc, C.gold); doc.setLineWidth(0.28);
    matchSlots.forEach(slot => {
      const targets = matchSlots.filter(t => t.ri === slot.ri + 1);
      if(!targets.length) return;
      // Coppia di partite (slot.mi e slot.mi+1) si uniscono nello slot floor(mi/2)
      const targetIdx = Math.floor(slot.mi / 2);
      const target = targets[targetIdx] || targets[0];
      const x1 = slot.x + slot.w;
      const x2 = target.x;
      const xm = x1 + (x2 - x1)*0.55;
      doc.line(x1, slot.midY, xm, slot.midY);
      doc.line(xm, slot.midY, xm, target.midY);
      doc.line(xm, target.midY, x2, target.midY);
    });

    // Sezione VINCITORE (se l'ultima partita del bracket è conclusa)
    const lastRound = rounds[rounds.length - 1];
    const finalMatch = lastRound?.matches?.[lastRound.matches.length - 1];
    if(finalMatch && isConcluded(s, finalMatch)){
      const winId = store.winnerId ? store.winnerId(s, finalMatch) : '';
      const winTeam = winId ? store.getTeam(s, winId) : null;
      if(winTeam){
        const wy = H - bottom + 2;
        const ww = 110;
        const wx = (W - ww)/2;
        setFill(doc, C.goldSoft); setDraw(doc, C.gold); doc.setLineWidth(0.5);
        doc.roundedRect(wx, wy, ww, 16, 3, 3, 'FD');
        drawLogo(doc, logos[winId], wx + 3, wy + 2, 12, winTeam.name);
        setText(doc, C.gold); doc.setFont('helvetica','bold'); doc.setFontSize(7);
        doc.text('CAMPIONE', wx + 18, wy + 6);
        setText(doc, C.ink); doc.setFont('helvetica','bold'); doc.setFontSize(13);
        doc.text(String(winTeam.name||'—'), wx + 18, wy + 12.6, { maxWidth: ww - 22 });
      }
    } else {
      // Nota se il vincitore non è ancora determinato
      const note = 'Vincitore da determinare: la finale non è ancora conclusa.';
      const noteW = doc.getTextWidth(note);
      setText(doc, C.muted); doc.setFont('helvetica','italic'); doc.setFontSize(7.6);
      doc.text(note, (W - noteW)/2, H - 16);
    }
  }
  function drawBracketMatchCard(doc, s, logos, m, x, y, w, h, mi){
    // Card bianca con bordo hairline e numerazione discreta
    setFill(doc, C.white); setDraw(doc, C.hair); doc.setLineWidth(0.22);
    doc.roundedRect(x, y, w, h, 2, 2, 'FD');

    // Numerazione incontro in alto a sinistra
    setText(doc, C.muted); doc.setFont('helvetica','bold'); doc.setFontSize(5.8);
    doc.text(`MATCH ${mi+1}`, x + 2.5, y + 3.6);
    // Meta in alto a destra (giornata/round se utile)
    if(m.field || m.date){
      const meta = [m.date ? fmtDate(m) : null, m.field ? `· ${m.field}` : null].filter(Boolean).join(' ');
      setText(doc, C.muted); doc.setFont('helvetica','normal'); doc.setFontSize(5.8);
      doc.text(meta, x + w - 2.5, y + 3.6, { align:'right', maxWidth: w/1.6 });
    }

    // Due righe squadra
    const homeId = m.homeTeamId;
    const awayId = m.awayTeamId;
    const homeName = m.homeTeamId ? store.teamName(s, m.homeTeamId, m.homeLabel) : (m.homeLabel || 'Da definire');
    const awayName = m.awayTeamId ? store.teamName(s, m.awayTeamId, m.awayLabel) : (m.awayLabel || 'Da definire');
    const sc = store.matchGoals ? store.matchGoals(s, m) : { home:'', away:'' };
    const winnerId = store.winnerId ? store.winnerId(s, m) : '';

    const rowH = (h - 6) / 2;
    drawBracketRow(doc, logos, x + 1, y + 5,  w - 2, rowH, homeId, homeName, isConcluded(s,m) ? sc.home : '', winnerId === homeId);
    drawBracketRow(doc, logos, x + 1, y + 5 + rowH, w - 2, rowH, awayId, awayName, isConcluded(s,m) ? sc.away : '', winnerId === awayId);
  }
  function drawBracketRow(doc, logos, x, y, w, h, teamId, name, score, isWinner){
    if(isWinner){
      setFill(doc, C.goldSoft);
      doc.rect(x, y, w, h, 'F');
      setFill(doc, C.gold);
      doc.rect(x, y, 1.2, h, 'F');
    }
    const logoSize = Math.min(h - 2, 8);
    drawLogo(doc, logos[teamId], x + 2.4, y + (h - logoSize)/2, logoSize, name);
    setText(doc, isWinner ? C.goldInk : C.ink);
    doc.setFont('helvetica', isWinner ? 'bold' : 'normal');
    doc.setFontSize(7.6);
    doc.text(String(name||'Da definire'), x + 2.4 + logoSize + 2, y + h/2 + 1.6, { maxWidth: w - logoSize - 18 });
    if(score !== '' && score != null){
      setText(doc, isWinner ? C.goldInk : C.ink);
      doc.setFont('helvetica','bold'); doc.setFontSize(9);
      doc.text(String(score), x + w - 4, y + h/2 + 1.8, { align:'right' });
    }
  }

  // ---------------------------------------------------------------------
  // Dispatcher pulsanti pagina report
  // ---------------------------------------------------------------------
  function teamFilterOptions(s, selected){
    return '<option value="">Tutte le squadre</option>' +
      s.teams.map(t => `<option value="${t.id}" ${t.id===selected?'selected':''}>${UI.esc(t.name)}</option>`).join('');
  }
  function filteredPlayerStats(s){
    const rows = store.selectors.playerStats(s);
    return playerTeamFilter
      ? rows.filter(p => p.teamId === playerTeamFilter)
      : rows.filter(p => p.goals > 0).slice(0, 15);
  }
  function reportAvailability(s){
    const matchCount = (s.matches||[]).length;
    const teamCount  = (s.teams||[]).length;
    const scorers    = store.selectors.scorers(s).length;
    const hasGroups  = store.selectors.hasGroupStage(s);
    const bracket    = store.bracketData(s);
    const concluded  = (s.matches||[]).filter(m => isConcluded(s, m)).length;
    return {
      standings:{ enabled:teamCount>0, detail: teamCount?`${teamCount} squadre`:'Aggiungi squadre' },
      scorers  :{ enabled:teamCount>0, detail: scorers?`${Math.min(scorers,15)} marcatori`:'Nessun gol: PDF vuoto' },
      groups   :{ enabled:hasGroups,   detail: hasGroups?'Classifiche gironi':'Non previsto dal format' },
      calendar :{ enabled:matchCount>0, detail: matchCount ? `${matchCount} partite (no live)` : 'Nessuna partita' },
      recap    :{ enabled:matchCount>0, detail: concluded ? `${concluded} partite concluse` : (matchCount?'0 concluse: PDF segnaposto':'Nessuna partita') },
      bracket  :{ enabled: Boolean(bracket.available), detail: bracket.available?'Tabellone disponibile':(bracket.message||'Non previsto dal format') }
    };
  }
  function renderReportButtons(s){
    const avail = reportAvailability(s);
    Object.entries(avail).forEach(([kind, meta])=>{
      const btn = document.querySelector(`[data-report-kind="${kind}"]`);
      if(!btn) return;
      btn.disabled = !meta.enabled;
      btn.title = meta.detail;
      const small = btn.querySelector('small');
      if(small) small.textContent = meta.detail;
    });
  }
  function render(){
    const s = A.state();
    renderReportButtons(s);
    UI.$('#adminStats').innerHTML = UI.statsGrid(store.selectors.stats(s));
    const standingsMenu = UI.$('#adminStandingsMenu');
    if(standingsMenu) standingsMenu.innerHTML = store.selectors.hasGroupStage(s) ? UI.groupStandingsSelector(s, standingsGroup, 'adminGroupStandingsFilter') : '';
    UI.$('#adminStandings').innerHTML = store.selectors.hasGroupStage(s)
      ? UI.groupStandingsTables(s, standingsGroup)
      : UI.standingsTable((store.selectors.officialStandings ? store.selectors.officialStandings(s) : store.selectors.calculateStandings(s)), s);
    const filter = UI.$('#adminPlayerTeamFilter');
    if(filter){
      filter.innerHTML = teamFilterOptions(s, playerTeamFilter);
      if(playerTeamFilter && !s.teams.some(t=>t.id===playerTeamFilter)) playerTeamFilter = '';
    }
    UI.$('#adminPlayers').innerHTML = UI.playerStatsTable(filteredPlayerStats(s))
      + (s.rules.isKingsLeague
          ? '<div class="mini-section-title margin-top"><h3>Presidenti marcatori</h3></div>' + UI.presidentStatsTable(store.selectors.presidentScorers(s).slice(0,15))
          : '');
    UI.$('#adminCalendar').innerHTML = UI.matchList(s);
    UI.$('#adminBracket').innerHTML = UI.bracketMarkup(s);
  }
  document.addEventListener('DOMContentLoaded', render);
  UI.$('#adminPlayerTeamFilter')?.addEventListener('change', e => { playerTeamFilter = e.target.value; render(); });
  document.addEventListener('change', e => {
    if(e.target.id === 'adminGroupStandingsFilter'){ standingsGroup = e.target.value || 'all'; render(); }
  });

  async function runPdf(kind){
    try{
      if(!toolsReady()){
        toast('Librerie PDF non disponibili. Controlla la connessione e ricarica la pagina.', 'error');
        return;
      }
      toast('Genero il PDF e avvio il download…');
      if     (kind === 'standings') await pdfStandings();
      else if(kind === 'scorers')   await pdfScorers();
      else if(kind === 'groups')    await pdfGroups();
      else if(kind === 'bracket')   await pdfBracket();
      else if(kind === 'recap')     await pdfRecap();
      else                          await pdfCalendar(); // 'calendar' = calendario completo (no live)
      toast('Download PDF avviato.');
    }catch(err){
      console.error(err);
      toast('Non sono riuscito a generare il PDF: ' + (err.message || err), 'error');
    }
  }
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-report-kind]');
    if(!btn) return;
    e.preventDefault();
    if(btn.disabled) return;
    runPdf(btn.dataset.reportKind || 'calendar');
  });
  window.NexoraAdminRefresh = function(){ try { render(); } catch(_){} };
  window.addEventListener('ng:admin-state-loaded', () => window.NexoraAdminRefresh());
})();
