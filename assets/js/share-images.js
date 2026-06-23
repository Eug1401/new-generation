(()=>{
  const store=window.NexoraStore;
  const BRAND_LOGO='assets/brand/new-generation-logo-transparent.png';
  const GOLD='#d7a42d', GOLD_SOFT='#f7dc78', INK='#161208', PAPER='#fffaf0', MUTED='#705f36', LINE='#e3cf91';
  const FONT='Inter, Segoe UI, Arial, sans-serif';
  const imageCache=new Map();

  function siteTitle(state){return state?.rules?.name||'New Generation';}
  function phaseLabel(state){return store.FORMAT_LABELS[state?.rules?.format]||state?.rules?.format||'Torneo';}
  function nowLabel(){try{return new Intl.DateTimeFormat('it-IT',{dateStyle:'medium',timeStyle:'short'}).format(new Date());}catch(_){return new Date().toISOString();}}
  function safeName(value){return String(value||'new-generation').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'new-generation';}
  function isSafeImageSrc(src){
    if(!src)return false;
    if(/^data:image\//i.test(src)||/^blob:/i.test(src))return true;
    try{const u=new URL(src,location.href);return u.origin===location.origin;}catch(_){return !/^https?:\/\//i.test(src);}
  }
  function loadImage(src,timeout=3500){
    if(!isSafeImageSrc(src))return Promise.resolve(null);
    if(imageCache.has(src))return imageCache.get(src);
    const promise=new Promise(resolve=>{
      const img=new Image();
      let done=false;
      const finish=value=>{if(done)return;done=true;resolve(value);};
      img.decoding='async';
      img.crossOrigin='anonymous';
      img.onload=()=>finish(img);
      img.onerror=()=>finish(null);
      setTimeout(()=>finish(null),timeout);
      img.src=src;
    });
    imageCache.set(src,promise);
    return promise;
  }
  function canvasBlob(canvas){return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Blob non generato')),'image/png',1);}catch(err){reject(err);}});}
  function roundRect(ctx,x,y,w,h,r,fill,stroke){
    const rr=Math.min(r,w/2,h/2);
    ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
  }
  function wrapText(ctx,text,maxWidth,font){
    ctx.font=font;
    const words=String(text||'').split(/\s+/).filter(Boolean);
    const lines=[];
    let line='';
    for(const word of words.length?words:['']){
      const test=line?line+' '+word:word;
      if(ctx.measureText(test).width<=maxWidth||!line){line=test;continue;}
      lines.push(line);line=word;
    }
    if(line)lines.push(line);
    return lines.flatMap(item=>{
      if(ctx.measureText(item).width<=maxWidth)return [item];
      const chunks=[];let part='';
      for(const char of Array.from(item)){
        if(ctx.measureText(part+char).width>maxWidth&&part){chunks.push(part);part=char;}else part+=char;
      }
      if(part)chunks.push(part);
      return chunks;
    });
  }
  function drawWrapped(ctx,text,x,y,maxWidth,lineHeight,font,color,opts={}){
    ctx.font=font;ctx.fillStyle=color;ctx.textAlign=opts.align||'left';ctx.textBaseline='top';
    const lines=wrapText(ctx,text,maxWidth,font).slice(0,opts.maxLines||99);
    lines.forEach((line,i)=>ctx.fillText(line,x,y+i*lineHeight,maxWidth));
    return lines.length*lineHeight;
  }
  function fitFont(ctx,text,maxWidth,start,min=18,weight='900'){
    let size=start;
    do{ctx.font=`${weight} ${size}px ${FONT}`;if(ctx.measureText(String(text||'')).width<=maxWidth||size<=min)break;size-=2;}while(size>min);
    return size;
  }
  function drawHeader(ctx,state,title,subtitle,width){
    ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,190);
    ctx.fillStyle='rgba(215,164,45,.16)';ctx.fillRect(0,0,width,12);
    roundRect(ctx,50,42,92,92,24,'#fff',LINE);
    return loadImage(state?.site?.logo||BRAND_LOGO).then(img=>{
      if(img)drawContain(ctx,img,62,54,68,68);
      else drawInitials(ctx,96,88,56,'NG');
      ctx.fillStyle=GOLD;ctx.font=`900 22px ${FONT}`;ctx.textAlign='left';ctx.fillText('NEW GENERATION',166,64);
      ctx.fillStyle=INK;ctx.font=`900 40px ${FONT}`;ctx.fillText(siteTitle(state),166,106,width-420);
      ctx.fillStyle=MUTED;ctx.font=`700 20px ${FONT}`;ctx.fillText(subtitle||phaseLabel(state),166,140,width-420);
      ctx.textAlign='right';ctx.fillStyle=INK;ctx.font=`900 38px ${FONT}`;ctx.fillText(title,width-54,82,width*.44);
      ctx.fillStyle=MUTED;ctx.font=`700 18px ${FONT}`;ctx.fillText('Generata '+nowLabel(),width-54,118,width*.38);
      ctx.strokeStyle=GOLD;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(50,178);ctx.lineTo(width-50,178);ctx.stroke();
    });
  }
  function drawFooter(ctx,width,height,note='Dati pubblici visibili sul sito'){
    ctx.strokeStyle=LINE;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(50,height-76);ctx.lineTo(width-50,height-76);ctx.stroke();
    ctx.fillStyle=MUTED;ctx.font=`700 18px ${FONT}`;ctx.textAlign='left';ctx.fillText(note,54,height-42,width*.55);
    ctx.textAlign='right';ctx.fillText('new-generation · '+nowLabel(),width-54,height-42,width*.35);
  }
  function drawContain(ctx,img,x,y,w,h){
    const iw=img.naturalWidth||img.width||1, ih=img.naturalHeight||img.height||1;
    const scale=Math.min(w/iw,h/ih);
    const dw=iw*scale, dh=ih*scale;
    ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  }
  function drawInitials(ctx,cx,cy,size,label){
    roundRect(ctx,cx-size/2,cy-size/2,size,size,Math.max(14,size*.2),'#fff7dc',LINE);
    ctx.fillStyle=GOLD;ctx.font=`900 ${Math.max(18,size*.34)}px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';
    const text=String(label||'?').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||'?';
    ctx.fillText(text,cx,cy);
  }
  async function drawTeamLogo(ctx,state,teamId,label,x,y,size){
    const team=store.getTeam(state,teamId);
    roundRect(ctx,x,y,size,size,16,'#fff',LINE);
    const img=await loadImage(team?.logo||'');
    if(img)drawContain(ctx,img,x+8,y+8,size-16,size-16);
    else drawInitials(ctx,x+size/2,y+size/2,size-16,label);
  }
  function rowsForStandings(state,groupName=''){
    const opts={includeLive:true};
    let rows=[];
    if(groupName)rows=store.selectors.groupStandings(state,groupName,opts);
    else if(store.selectors.hasGroupStage(state))rows=store.selectors.groupedStandings(state,opts).flatMap(g=>(g.rows||[]).map(r=>({...r,groupName:g.name})));
    else rows=store.selectors.officialStandings(state,opts);
    const matches=groupName?(state.matches||[]).filter(m=>m.groupName===groupName):((state.rules?.format==='league_knockout')?(state.matches||[]).filter(m=>m.phase==='league'):(state.matches||[]));
    return rows.map(row=>({...row,...recordForTeam(state,matches,row.teamId)}));
  }
  function recordForTeam(state,matches,teamId){
    const out={wins:0,draws:0,losses:0};
    (matches||[]).forEach(m=>{
      if(m.homeTeamId!==teamId&&m.awayTeamId!==teamId)return;
      if(!(store.hasScore(state,m)||m.status==='played'||m.status==='live'))return;
      const sc=store.matchGoals(state,m), home=m.homeTeamId===teamId;
      const gf=home?sc.home:sc.away, ga=home?sc.away:sc.home;
      if(gf>ga)out.wins++;else if(gf<ga)out.losses++;else out.draws++;
    });
    return out;
  }
  async function standingsImage(state,{groupName=''}={}){
    const rows=rowsForStandings(state,groupName);
    if(!rows.length)throw new Error(groupName?'Classifica girone non disponibile.':'Classifica non disponibile.');
    const title=groupName?`Classifica - ${groupName}`:'Classifica generale';
    const width=1080, rowH=76, height=Math.max(1350,290+rows.length*rowH+190);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,height);
    await drawHeader(ctx,state,title,phaseLabel(state),width);
    const x=54,y0=230,tableW=width-108;
    const headers=[['#',0,58],['Squadra',58,402],['PG',460,62],['V',522,58],['N',580,58],['P',638,58],['GF',696,62],['GS',758,62],['DR',820,70],['Pt',890,82]];
    roundRect(ctx,x,y0,tableW,54,18,INK,null);
    ctx.fillStyle=GOLD_SOFT;ctx.font=`900 18px ${FONT}`;ctx.textBaseline='middle';
    headers.forEach(([h,dx,w],i)=>{ctx.textAlign=i<2?'left':'center';ctx.fillText(h,x+dx+(i<2?18:w/2),y0+28,w);});
    for(let i=0;i<rows.length;i++){
      const row=rows[i], y=y0+54+i*rowH;
      roundRect(ctx,x,y,tableW,rowH,0,i%2?'#fff6dc':'#fffaf0',null);
      ctx.strokeStyle='rgba(215,164,45,.28)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y+rowH);ctx.lineTo(x+tableW,y+rowH);ctx.stroke();
      const qualified=qualificationCutoff(state,groupName,row,i);
      if(qualified){ctx.fillStyle='rgba(215,164,45,.16)';ctx.fillRect(x,y,8,rowH);}
      ctx.fillStyle=INK;ctx.font=`900 22px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x+29,y+rowH/2);
      await drawTeamLogo(ctx,state,row.teamId,row.name,x+70,y+12,52);
      const teamX=x+136;
      const teamFont=`900 ${fitFont(ctx,row.name,300,25,17,'900')}px ${FONT}`;
      drawWrapped(ctx,row.name,teamX,y+17,292,24,teamFont,INK,{maxLines:2});
      if(qualified){ctx.fillStyle=GOLD;ctx.font=`800 14px ${FONT}`;ctx.fillText('Qualificata',teamX,y+60,130);}
      const values=[row.played,row.wins,row.draws,row.losses,row.goalsFor,row.goalsAgainst,(row.diff>0?'+':'')+row.diff,row.points];
      const centers=[491,551,609,667,727,789,855,931];
      values.forEach((value,idx)=>{ctx.fillStyle=idx===7?INK:MUTED;ctx.font=`${idx===7?'950':'850'} 22px ${FONT}`;ctx.textAlign='center';ctx.fillText(String(value??0),x+centers[idx],y+rowH/2);});
    }
    const legendY=y0+64+rows.length*rowH+30;
    roundRect(ctx,54,legendY,width-108,76,18,'#fff6dc',LINE);
    ctx.fillStyle=INK;ctx.font=`900 18px ${FONT}`;ctx.textAlign='left';ctx.fillText('Legenda: PG partite giocate · V vittorie · N pareggi · P sconfitte · GF gol fatti · GS gol subiti · DR differenza reti · Pt punti',78,legendY+30,width-156);
    ctx.fillStyle=MUTED;ctx.font=`700 16px ${FONT}`;ctx.fillText('Le posizioni qualificate sono indicate anche dal testo, non solo dal colore.',78,legendY+56,width-156);
    drawFooter(ctx,width,height);
    const blob=await canvasBlob(canvas);
    return {blob,width,height,title,fileName:`${groupName?'classifica-'+safeName(groupName):'classifica-generale'}-${safeName(siteTitle(state))}.png`,text:title+' · '+siteTitle(state)};
  }
  function qualificationCutoff(state,groupName,row,index){
    if(groupName){
      const cfg=(state.rules?.groupConfigs||[]).find(g=>g.name===groupName);
      return cfg&&index<Number(cfg.qualifiers||0);
    }
    if(state.rules?.format==='league_knockout'){
      const max=Math.max(...(state.rules.eliminationCompetitions||[]).map(c=>c.startRank+c.teams-1),0);
      return max&&index<max;
    }
    return false;
  }
  async function bracketImage(state){
    const data=store.bracketData(state);
    if(!data.available)throw new Error(data.message||'Tabellone non disponibile.');
    const blocks=[];
    let width=1920,totalHeight=170;
    for(const bracket of data.brackets){
      const rounds=bracket.rounds||[];
      const firstCount=Math.max(1,...rounds.map(r=>(r.matches||[]).length));
      const roundW=330,gap=120,matchH=116,step=160;
      const blockW=120+rounds.length*roundW+Math.max(0,rounds.length-1)*gap+120;
      const blockH=Math.max(520,firstCount*step+150);
      width=Math.max(width,blockW);
      blocks.push({bracket,roundW,gap,matchH,step,blockW,blockH,y:totalHeight});
      totalHeight+=blockH+80;
    }
    const height=Math.max(1080,totalHeight+110);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,height);
    await drawHeader(ctx,state,'Tabellone',phaseLabel(state),width);
    for(const block of blocks)await drawBracketBlock(ctx,state,block,width);
    drawFooter(ctx,width,height,'Tabellone completo esportato come immagine panoramica');
    const blob=await canvasBlob(canvas);
    return {blob,width,height,title:'Tabellone',fileName:`tabellone-${safeName(siteTitle(state))}.png`,text:'Tabellone · '+siteTitle(state)};
  }
  async function drawBracketBlock(ctx,state,block,width){
    const {bracket,roundW,gap,matchH,step,y}=block;
    const x0=60;
    ctx.fillStyle=INK;ctx.font=`950 34px ${FONT}`;ctx.textAlign='left';ctx.fillText(bracket.name,x0,y+20,width-120);
    const positions=new Map();
    const rounds=bracket.rounds||[];
    rounds.forEach((round,ri)=>{
      const x=x0+ri*(roundW+gap);
      ctx.fillStyle=GOLD;ctx.font=`900 22px ${FONT}`;ctx.fillText(round.name,x,y+64,roundW);
      (round.matches||[]).forEach((m,mi)=>{
        let cy;
        if(ri===0)cy=y+120+mi*step;
        else{
          const p1=positions.get(`${m.bracketRoundIndex-1}:${(m.bracketMatchIndex-1)*2+1}`);
          const p2=positions.get(`${m.bracketRoundIndex-1}:${(m.bracketMatchIndex-1)*2+2}`);
          cy=p1&&p2?(p1.cy+p2.cy)/2:y+120+mi*step*Math.pow(2,ri);
        }
        positions.set(`${m.bracketRoundIndex}:${m.bracketMatchIndex}`,{x,cy});
      });
    });
    for(const round of rounds){
      for(const m of round.matches||[]){
        const pos=positions.get(`${m.bracketRoundIndex}:${m.bracketMatchIndex}`);
        if(!pos||m.bracketRoundIndex>=rounds.length)continue;
        const next=positions.get(`${m.bracketRoundIndex+1}:${Math.ceil(m.bracketMatchIndex/2)}`);
        if(!next)continue;
        const sx=pos.x+roundW, sy=pos.cy, mx=sx+gap/2, ex=next.x, ey=next.cy;
        ctx.strokeStyle='rgba(215,164,45,.62)';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(mx,sy);ctx.lineTo(mx,ey);ctx.lineTo(ex,ey);ctx.stroke();
      }
    }
    for(const round of rounds){
      for(const m of round.matches||[]){
        const pos=positions.get(`${m.bracketRoundIndex}:${m.bracketMatchIndex}`);
        await drawBracketMatch(ctx,state,m,pos.x,pos.cy-matchH/2,roundW,matchH);
      }
    }
  }
  async function drawBracketMatch(ctx,state,m,x,y,w,h){
    roundRect(ctx,x,y,w,h,18,'#fffaf0',LINE);
    ctx.fillStyle=MUTED;ctx.font=`800 14px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(m.round||m.bracketRound,x+16,y+10,w-32);
    const score=store.hasScore(state,m)?store.matchGoals(state,m):null;
    await drawBracketTeam(ctx,state,m,'home',x+14,y+34,w-28,32,score?score.home:'');
    await drawBracketTeam(ctx,state,m,'away',x+14,y+72,w-28,32,score?score.away:'');
  }
  async function drawBracketTeam(ctx,state,m,side,x,y,w,h,score){
    const id=side==='home'?m.homeTeamId:m.awayTeamId, label=store.teamName(state,id,side==='home'?m.homeLabel:m.awayLabel);
    const winner=store.winnerId(state,m)===id&&id;
    roundRect(ctx,x,y,w,h,10,winner?'#fff1bf':'#ffffff','rgba(215,164,45,.25)');
    await drawTeamLogo(ctx,state,id,label,x+6,y+4,24);
    ctx.fillStyle=INK;ctx.font=`850 ${fitFont(ctx,label,w-78,16,11,'850')}px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,x+38,y+h/2,w-78);
    ctx.textAlign='right';ctx.font=`950 18px ${FONT}`;ctx.fillText(String(score||''),x+w-10,y+h/2);
  }
  async function matchImage(state,{matchId,match}={}){
    const m=match||state.matches.find(x=>x.id===matchId);
    if(!m)throw new Error('Partita non trovata.');
    const width=1080,height=1350,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,height);
    const home=store.teamName(state,m.homeTeamId,m.homeLabel), away=store.teamName(state,m.awayTeamId,m.awayLabel);
    await drawHeader(ctx,state,'Partita',`${store.PHASE_LABELS[m.phase]||m.phase||'Fase'} · ${m.groupName||m.bracketName||m.round||''}`,width);
    roundRect(ctx,70,240,width-140,420,34,'#fff8e7',LINE);
    await drawTeamLogo(ctx,state,m.homeTeamId,home,125,315,138);
    await drawTeamLogo(ctx,state,m.awayTeamId,away,width-263,315,138);
    drawWrapped(ctx,home,222,480,260,32,`900 ${fitFont(ctx,home,260,34,20,'900')}px ${FONT}`,INK,{align:'center',maxLines:2});
    drawWrapped(ctx,away,width-222,480,260,32,`900 ${fitFont(ctx,away,260,34,20,'900')}px ${FONT}`,INK,{align:'center',maxLines:2});
    const played=store.hasScore(state,m)||m.status==='played', live=m.status==='live', score=store.matchGoals(state,m);
    roundRect(ctx,390,330,300,188,32,INK,GOLD);
    ctx.fillStyle=played?'#9ff4bf':(live?'#ffcf6a':GOLD_SOFT);ctx.font=`900 22px ${FONT}`;ctx.textAlign='center';ctx.fillText(live?'LIVE':(played?'GIOCATA':'DA GIOCARE'),540,370);
    ctx.fillStyle='#fff';ctx.font=`950 72px ${FONT}`;ctx.fillText(played||live?`${score.home} - ${score.away}`:'VS',540,455);
    if((played||live)&&score.home===score.away&&m.penalties){
      const p=store.normalizePenalties(m.penalties);
      if(p){ctx.fillStyle=GOLD_SOFT;ctx.font=`850 20px ${FONT}`;ctx.fillText(`Rigori ${p.home}-${p.away}`,540,498);}
    }
    const meta=[
      ['Modalita',phaseLabel(state)],
      ['Fase',store.PHASE_LABELS[m.phase]||m.phase||'-'],
      ['Turno',m.round||m.bracketRound||'-'],
      ['Data e ora',formatMatchDate(m)],
      ['Campo',m.field||'Da definire'],
      ['Stato',live?'Live':(played?'Giocata':'Da giocare')]
    ];
    let y=710;
    for(let i=0;i<meta.length;i++){
      const col=i%2,row=Math.floor(i/2),x=70+col*470,yy=y+row*98;
      roundRect(ctx,x,yy,430,74,18,'#fff',LINE);
      ctx.fillStyle=GOLD;ctx.font=`900 16px ${FONT}`;ctx.textAlign='left';ctx.fillText(meta[i][0],x+24,yy+26);
      ctx.fillStyle=INK;ctx.font=`850 22px ${FONT}`;ctx.fillText(meta[i][1],x+24,yy+54,382);
    }
    const goals=(m.goals||[]).map(g=>store.goalEventLabel?store.goalEventLabel(state,m,g):store.playerName(state,g.playerId)).filter(Boolean).slice(0,12).join(' · ');
    roundRect(ctx,70,1035,width-140,140,24,'#fff8e7',LINE);
    ctx.fillStyle=GOLD;ctx.font=`900 18px ${FONT}`;ctx.textAlign='left';ctx.fillText('Marcatori',102,1076);
    drawWrapped(ctx,goals||'Nessun marcatore disponibile',102,1100,width-204,30,`850 24px ${FONT}`,INK,{maxLines:3});
    drawFooter(ctx,width,height);
    const blob=await canvasBlob(canvas);
    return {blob,width,height,title:`${home} vs ${away}`,fileName:`partita-${safeName(home)}-vs-${safeName(away)}.png`,text:`${home} vs ${away} · ${siteTitle(state)}`};
  }
  function formatMatchDate(m){try{return m.date||m.time?new Intl.DateTimeFormat('it-IT',m.time?{dateStyle:'medium',timeStyle:'short'}:{dateStyle:'medium'}).format(new Date(`${m.date||'1970-01-01'}T${m.time||'00:00'}`)):'Da definire';}catch(_){return 'Da definire';}}
  async function generate(kind,state,payload={}){
    if(kind==='standings-general')return standingsImage(state,{});
    if(kind==='standings-group')return standingsImage(state,{groupName:payload.groupName||''});
    if(kind==='bracket')return bracketImage(state);
    if(kind==='match')return matchImage(state,payload);
    throw new Error('Tipo export non supportato.');
  }
  function ensurePreview(){
    let modal=document.getElementById('shareImagePreview');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.id='shareImagePreview';
    modal.className='share-preview-modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`<div class="share-preview-panel"><div class="share-preview-head"><div><span class="article-kicker">Immagine pronta</span><h2 id="sharePreviewTitle">Anteprima</h2><p id="sharePreviewMeta"></p></div><button class="btn danger" type="button" data-share-preview-close>Chiudi</button></div><div class="share-preview-stage"><img alt="Anteprima immagine esportata"></div><div class="share-preview-actions"><button class="btn primary" type="button" data-share-preview-native>Condividi</button><button class="btn" type="button" data-share-preview-download>Scarica immagine</button><span class="share-preview-message" role="status"></span></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',event=>{if(event.target===modal||event.target.closest('[data-share-preview-close]'))closePreview();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))closePreview();});
    return modal;
  }
  let currentPreview=null;
  function closePreview(){
    const modal=document.getElementById('shareImagePreview');
    if(!modal)return;
    modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.classList.remove('ng-overlay-open');
    if(currentPreview?.url)URL.revokeObjectURL(currentPreview.url);
    currentPreview=null;
  }
  async function openPreview(result,trigger=null){
    const modal=ensurePreview();
    if(currentPreview?.url)URL.revokeObjectURL(currentPreview.url);
    const url=URL.createObjectURL(result.blob);
    currentPreview={...result,url,trigger};
    modal.querySelector('img').src=url;
    modal.querySelector('img').alt=result.title||'Anteprima immagine esportata';
    modal.querySelector('#sharePreviewTitle').textContent=result.title||'Anteprima';
    modal.querySelector('#sharePreviewMeta').textContent=`${result.width} x ${result.height}px · PNG · ${(result.blob.size/1024).toFixed(0)} KB`;
    modal.querySelector('.share-preview-message').textContent='';
    modal.querySelector('[data-share-preview-native]').onclick=()=>shareCurrent();
    modal.querySelector('[data-share-preview-download]').onclick=()=>downloadCurrent();
    modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('ng-overlay-open');
    requestAnimationFrame(()=>modal.querySelector('[data-share-preview-native]')?.focus());
  }
  async function shareCurrent(){
    if(!currentPreview)return;
    const msg=document.querySelector('#shareImagePreview .share-preview-message');
    try{
      const file=new File([currentPreview.blob],currentPreview.fileName,{type:'image/png'});
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({title:currentPreview.title,text:currentPreview.text,files:[file]});
        if(msg)msg.textContent='Condivisione avviata.';
      }else{
        downloadCurrent();
        if(msg)msg.textContent='Condivisione diretta non supportata: immagine scaricata.';
      }
    }catch(err){
      if(String(err?.name||'')==='AbortError'){if(msg)msg.textContent='Condivisione annullata.';return;}
      downloadCurrent();
      if(msg)msg.textContent='Condivisione non disponibile: immagine scaricata.';
    }
  }
  function downloadCurrent(){
    if(!currentPreview)return;
    const a=document.createElement('a');
    a.href=currentPreview.url;
    a.download=currentPreview.fileName;
    document.body.appendChild(a);a.click();a.remove();
  }
  async function generateAndPreview(kind,state,payload={},button=null){
    if(button){button.disabled=true;button.dataset.originalLabel=button.textContent;button.textContent='Preparo immagine...';}
    try{const result=await generate(kind,state,payload);await openPreview(result,button);return result;}
    finally{if(button){button.disabled=false;button.textContent=button.dataset.originalLabel||'Esporta e condividi';delete button.dataset.originalLabel;}}
  }
  window.NGShareImages={generate,generateAndPreview,openPreview,closePreview,shareCurrent,downloadCurrent};
})();
