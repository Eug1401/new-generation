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
  function headerColumns(width){
    const leftX=166,rightX=width-54;
    const rightW=Math.max(300,Math.min(620,width*.34));
    const rightStart=rightX-rightW;
    const gap=44;
    const leftW=Math.max(260,rightStart-leftX-gap);
    return {leftX,leftW,rightX,rightW,rightStart,gap};
  }
  function drawHeader(ctx,state,title,subtitle,width){
    ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,190);
    ctx.fillStyle='rgba(215,164,45,.16)';ctx.fillRect(0,0,width,12);
    roundRect(ctx,50,42,92,92,24,'#fff',LINE);
    return loadImage(state?.site?.logo||BRAND_LOGO).then(img=>{
      if(img)drawContain(ctx,img,62,54,68,68);
      else drawInitials(ctx,96,88,56,'NG');
      const {leftX,leftW,rightX,rightW}=headerColumns(width);
      const tournament=siteTitle(state),sub=subtitle||phaseLabel(state),exportTitle=String(title||'');
      ctx.textBaseline='alphabetic';ctx.textAlign='left';
      ctx.fillStyle=GOLD;ctx.font=`900 22px ${FONT}`;ctx.fillText('NEW GENERATION',leftX,64,leftW);
      ctx.fillStyle=INK;ctx.font=`900 ${fitFont(ctx,tournament,leftW,40,24,'900')}px ${FONT}`;ctx.fillText(tournament,leftX,106,leftW);
      ctx.fillStyle=MUTED;ctx.font=`700 ${fitFont(ctx,sub,leftW,20,14,'700')}px ${FONT}`;ctx.fillText(sub,leftX,140,leftW);
      ctx.textAlign='right';ctx.fillStyle=INK;ctx.font=`900 ${fitFont(ctx,exportTitle,rightW,38,24,'900')}px ${FONT}`;ctx.fillText(exportTitle,rightX,82,rightW);
      ctx.fillStyle=MUTED;ctx.font=`700 18px ${FONT}`;ctx.fillText('Generata '+nowLabel(),rightX,118,rightW);
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
    if(!teamId){ctx.fillStyle=GOLD;ctx.font=`900 ${Math.max(18,size*.42)}px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',x+size/2,y+size/2);return;}
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
  const BRACKET_GEOMETRY={
    minWidth:1920,
    headerBottom:190,
    firstBlockTop:242,
    sidePadding:72,
    roundWidth:380,
    roundGap:150,
    matchHeight:132,
    matchStep:184,
    blockTitleHeight:48,
    roundTitleHeight:38,
    titleToCardsGap:26,
    blockBottomPadding:54,
    blockGap:88,
    footerSpace:126
  };
  function orderedRoundMatches(round){
    return [...(round?.matches||[])].sort((a,b)=>{
      const ai=Number(a?.bracketMatchIndex),bi=Number(b?.bracketMatchIndex);
      const aValid=Number.isFinite(ai)&&ai>0,bValid=Number.isFinite(bi)&&bi>0;
      if(aValid&&bValid&&ai!==bi)return ai-bi;
      if(aValid!==bValid)return aValid?-1:1;
      return String(a?.id||'').localeCompare(String(b?.id||''));
    });
  }
  function previousMatchRange(previousCount,currentCount,index){
    if(previousCount<=0||currentCount<=0)return {start:0,end:-1};
    const start=Math.ceil(index*previousCount/currentCount);
    const end=Math.max(start,Math.ceil((index+1)*previousCount/currentCount)-1);
    return {start:Math.min(previousCount-1,start),end:Math.min(previousCount-1,end)};
  }
  function buildBracketLayout(data){
    const g=BRACKET_GEOMETRY;
    const blocks=[];
    let width=g.minWidth,y=g.firstBlockTop;
    for(const bracket of data.brackets||[]){
      const rounds=(bracket.rounds||[]).map(round=>({...round,matches:orderedRoundMatches(round)}));
      const firstCount=Math.max(1,...rounds.map(round=>round.matches.length));
      const contentWidth=Math.max(g.roundWidth,rounds.length*g.roundWidth+Math.max(0,rounds.length-1)*g.roundGap);
      const cardsTop=y+g.blockTitleHeight+g.roundTitleHeight+g.titleToCardsGap;
      const blockHeight=g.blockTitleHeight+g.roundTitleHeight+g.titleToCardsGap+g.matchHeight+Math.max(0,firstCount-1)*g.matchStep+g.blockBottomPadding;
      const block={bracket:{...bracket,rounds},rounds,y,cardsTop,contentWidth,blockHeight,positions:[]};
      rounds.forEach((round,roundIndex)=>{
        const x=roundIndex*(g.roundWidth+g.roundGap);
        const centers=[];
        round.matches.forEach((match,matchIndex)=>{
          let center;
          if(roundIndex===0){
            center=cardsTop+g.matchHeight/2+matchIndex*g.matchStep;
          }else{
            const previous=block.positions[roundIndex-1]||[];
            const range=previousMatchRange(previous.length,round.matches.length,matchIndex);
            const linked=previous.slice(range.start,range.end+1);
            center=linked.length
              ? linked.reduce((sum,item)=>sum+item.cy,0)/linked.length
              : cardsTop+g.matchHeight/2+matchIndex*g.matchStep;
            const prior=centers[centers.length-1];
            if(Number.isFinite(prior))center=Math.max(center,prior+g.matchHeight+28);
          }
          centers.push(center);
          block.positions[roundIndex] ||= [];
          block.positions[roundIndex].push({match,matchIndex,roundIndex,x,cy:center});
        });
      });
      blocks.push(block);
      width=Math.max(width,contentWidth+g.sidePadding*2);
      y+=blockHeight+g.blockGap;
    }
    const height=Math.max(1080,y-g.blockGap+g.footerSpace);
    for(const block of blocks){
      block.x0=Math.round((width-block.contentWidth)/2);
      block.positions.forEach(round=>round.forEach(pos=>{pos.x=block.x0+pos.x;}));
    }
    return {width,height,blocks,geometry:g};
  }
  async function bracketImage(state){
    const data=store.bracketData(state);
    if(!data.available)throw new Error(data.message||'Tabellone non disponibile.');
    const layout=buildBracketLayout(data);
    const {width,height,blocks}=layout;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    ctx.fillStyle=PAPER;ctx.fillRect(0,0,width,height);
    await drawHeader(ctx,state,'Tabellone',phaseLabel(state),width);
    for(const block of blocks)await drawBracketBlock(ctx,state,block,width,layout.geometry);
    drawFooter(ctx,width,height,'Tabellone completo esportato come immagine panoramica');
    const blob=await canvasBlob(canvas);
    return {blob,width,height,title:'Tabellone',fileName:`tabellone-${safeName(siteTitle(state))}.png`,text:'Tabellone · '+siteTitle(state)};
  }
  async function drawBracketBlock(ctx,state,block,width,g){
    const {bracket,rounds,y,x0,positions}=block;
    ctx.fillStyle=INK;ctx.font=`950 34px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(bracket.name,x0,y,width-x0-g.sidePadding);
    rounds.forEach((round,roundIndex)=>{
      const x=x0+roundIndex*(g.roundWidth+g.roundGap);
      ctx.fillStyle=GOLD;ctx.font=`900 22px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(round.name,x+g.roundWidth/2,y+g.blockTitleHeight,g.roundWidth);
    });
    for(let roundIndex=0;roundIndex<positions.length-1;roundIndex++){
      const current=positions[roundIndex]||[],nextRound=positions[roundIndex+1]||[];
      current.forEach((pos,index)=>{
        const nextIndex=Math.min(nextRound.length-1,Math.floor(index*Math.max(1,nextRound.length)/Math.max(1,current.length)));
        const next=nextRound[nextIndex];
        if(!next)return;
        const sx=pos.x+g.roundWidth,sy=pos.cy,mx=sx+g.roundGap/2,ex=next.x,ey=next.cy;
        ctx.strokeStyle='rgba(215,164,45,.62)';ctx.lineWidth=4;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(mx,sy);ctx.lineTo(mx,ey);ctx.lineTo(ex,ey);ctx.stroke();
      });
    }
    for(const roundPositions of positions){
      for(const pos of roundPositions){
        await drawBracketMatch(ctx,state,pos.match,pos.x,pos.cy-g.matchHeight/2,g.roundWidth,g.matchHeight);
      }
    }
    const separatorY=y+block.blockHeight+g.blockGap/2;
    if(separatorY<ctx.canvas.height-g.footerSpace){
      ctx.strokeStyle='rgba(215,164,45,.22)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(g.sidePadding,separatorY);ctx.lineTo(width-g.sidePadding,separatorY);ctx.stroke();
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
    const nameW=w-104;
    ctx.fillStyle=INK;ctx.font=`850 ${fitFont(ctx,label,nameW,16,11,'850')}px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,x+42,y+h/2,nameW);
    ctx.textAlign='right';ctx.font=`950 18px ${FONT}`;ctx.fillText(score===''?'':String(score),x+w-10,y+h/2);
  }
  function fitWrappedLayout(ctx,text,maxWidth,{start=34,min=14,maxLines=2,weight='900'}={}){
    let size=start,lines=[];
    while(size>=min){
      const font=`${weight} ${size}px ${FONT}`;
      ctx.font=font;
      lines=wrapText(ctx,text,maxWidth,font);
      if(lines.length<=maxLines)return {font,size,lines};
      size-=2;
    }
    const font=`${weight} ${min}px ${FONT}`;
    ctx.font=font;
    lines=wrapText(ctx,text,maxWidth,font);
    return {font,size:min,lines};
  }
  function drawCenteredLayout(ctx,layout,cx,y,lineHeight,color){
    ctx.font=layout.font;ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='top';
    layout.lines.forEach((line,index)=>ctx.fillText(line,cx,y+index*lineHeight));
    return layout.lines.length*lineHeight;
  }
  function drawSoftCard(ctx,x,y,w,h,r=24,fill='#fff',stroke=LINE){
    ctx.save();ctx.shadowColor='rgba(73,49,5,.10)';ctx.shadowBlur=24;ctx.shadowOffsetY=8;
    roundRect(ctx,x,y,w,h,r,fill,stroke);ctx.restore();
  }
  function matchScorers(state,m){
    if(store.aggregateGoalEvents)return store.aggregateGoalEvents(state,m);
    const groups=new Map();
    (m.goals||[]).forEach(g=>{
      const own=store.isOwnGoalEvent&&store.isOwnGoalEvent(g);
      const teamId=store.goalScoringTeamId?store.goalScoringTeamId(state,m,g):store.getParticipant(state,g.playerId)?.team?.id;
      const key=own?`own:${teamId}`:`player:${g.playerId}`;
      if(!groups.has(key))groups.set(key,{teamId,playerId:g.playerId||'',ownGoal:own,label:store.goalEventLabel?store.goalEventLabel(state,m,g):store.playerName(state,g.playerId),number:store.getParticipant(state,g.playerId)?.number??'',count:0,scoreValue:0});
      const row=groups.get(key);row.count+=1;row.scoreValue+=store.eventScoreWeight?store.eventScoreWeight(state,g):(Number(g.weight)||1);
    });
    return Array.from(groups.values());
  }
  function scorerSubtitle(row){
    if(row.ownGoal)return row.count===1?'1 autogol':`${row.count} autogol`;
    const goals=row.count===1?'1 gol':`${row.count} gol`;
    const doubles=Number(row.doubleCount)||0;
    return doubles?`${goals} · ${doubles===1?'1 doppio':`${doubles} doppi`}`:goals;
  }
  function drawScorerRow(ctx,row,x,y,w,h){
    roundRect(ctx,x,y,w,h,18,'#fffdf7','rgba(215,164,45,.24)');
    const badge=48;
    roundRect(ctx,x+14,y+(h-badge)/2,badge,badge,15,row.ownGoal?'#fff1c2':'#171208',row.ownGoal?LINE:null);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=row.ownGoal?GOLD:'#fff';
    ctx.font=`900 ${row.ownGoal?20:17}px ${FONT}`;
    ctx.fillText(row.ownGoal?'↩':(row.number!==''&&row.number!=null?`#${row.number}`:'—'),x+14+badge/2,y+h/2,badge-6);
    const qtyW=72,nameX=x+78,nameW=w-78-qtyW-24;
    const layout=fitWrappedLayout(ctx,row.label,nameW,{start:21,min:13,maxLines:2,weight:'850'});
    const lineHeight=Math.max(17,layout.size+2);
    const textH=layout.lines.length*lineHeight;
    ctx.font=layout.font;ctx.fillStyle=INK;ctx.textAlign='left';ctx.textBaseline='top';
    layout.lines.forEach((line,index)=>ctx.fillText(line,nameX,y+15+index*lineHeight,nameW));
    const subY=Math.min(y+h-22,y+17+textH);
    ctx.fillStyle=MUTED;ctx.font=`750 13px ${FONT}`;ctx.fillText(scorerSubtitle(row),nameX,subY,nameW);
    roundRect(ctx,x+w-qtyW-12,y+(h-42)/2,qtyW,42,14,'#171208',null);
    ctx.fillStyle=GOLD_SOFT;ctx.font=`950 21px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(`×${row.count}`,x+w-qtyW/2-12,y+h/2,qtyW-10);
  }
  function drawEmptyScorers(ctx,x,y,w,h){
    roundRect(ctx,x,y,w,h,18,'#fffdf7','rgba(215,164,45,.18)');
    ctx.fillStyle=MUTED;ctx.font=`750 17px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('Nessun marcatore',x+w/2,y+h/2,w-30);
  }
  function drawMetaCard(ctx,label,value,x,y,w,h){
    roundRect(ctx,x,y,w,h,20,'rgba(255,255,255,.82)','rgba(215,164,45,.25)');
    ctx.fillStyle=GOLD;ctx.font=`900 14px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(label.toUpperCase(),x+20,y+16,w-40);
    const size=fitFont(ctx,value,w-40,21,13,'850');
    ctx.fillStyle=INK;ctx.font=`850 ${size}px ${FONT}`;ctx.fillText(value,x+20,y+43,w-40);
  }
  async function matchImage(state,{matchId,match}={}){
    const m=match||state.matches.find(x=>x.id===matchId);
    if(!m)throw new Error('Partita non trovata.');
    const home=store.teamName(state,m.homeTeamId,m.homeLabel),away=store.teamName(state,m.awayTeamId,m.awayLabel);
    const played=store.hasScore(state,m)||m.status==='played',live=m.status==='live',score=store.matchGoals(state,m);
    const scorers=matchScorers(state,m);
    const homeScorers=scorers.filter(row=>row.teamId===m.homeTeamId);
    const awayScorers=scorers.filter(row=>row.teamId===m.awayTeamId);
    const scorerRowH=78,scorerGap=10,maxRows=Math.max(homeScorers.length,awayScorers.length,1);
    const scorerPanelH=118+maxRows*scorerRowH+Math.max(0,maxRows-1)*scorerGap+34;
    const width=1080,heroY=218,heroH=408,metaY=654,metaH=194,scorerY=878;
    const height=Math.max(1350,scorerY+scorerPanelH+126);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    const bg=ctx.createLinearGradient(0,0,width,height);bg.addColorStop(0,'#fffdf8');bg.addColorStop(.52,'#fff7df');bg.addColorStop(1,'#fffdf8');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    await drawHeader(ctx,state,'MATCH REPORT',`${store.PHASE_LABELS[m.phase]||m.phase||'Fase'} · ${m.groupName||m.bracketName||m.round||''}`,width);

    drawSoftCard(ctx,54,heroY,width-108,heroH,34,'rgba(255,255,255,.88)',LINE);
    ctx.fillStyle='rgba(215,164,45,.12)';roundRect(ctx,74,heroY+20,width-148,44,15,'rgba(215,164,45,.12)',null);
    const phaseText=[store.PHASE_LABELS[m.phase]||m.phase,m.groupName||m.bracketName,m.round||m.bracketRound].filter(Boolean).join(' · ');
    ctx.fillStyle=MUTED;ctx.font=`850 ${fitFont(ctx,phaseText,width-210,17,12,'850')}px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(phaseText||'Partita',width/2,heroY+42,width-190);

    const teamW=300,homeX=82,awayX=width-82-teamW,logoSize=128,logoY=heroY+92;
    await drawTeamLogo(ctx,state,m.homeTeamId,home,homeX+(teamW-logoSize)/2,logoY,logoSize);
    await drawTeamLogo(ctx,state,m.awayTeamId,away,awayX+(teamW-logoSize)/2,logoY,logoSize);
    const homeLayout=fitWrappedLayout(ctx,home,teamW,{start:31,min:13,maxLines:3,weight:'900'});
    const awayLayout=fitWrappedLayout(ctx,away,teamW,{start:31,min:13,maxLines:3,weight:'900'});
    drawCenteredLayout(ctx,homeLayout,homeX+teamW/2,heroY+246,Math.max(18,homeLayout.size+4),INK);
    drawCenteredLayout(ctx,awayLayout,awayX+teamW/2,heroY+246,Math.max(18,awayLayout.size+4),INK);
    ctx.fillStyle=MUTED;ctx.font=`800 14px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('CASA',homeX+teamW/2,heroY+352);ctx.fillText('OSPITE',awayX+teamW/2,heroY+352);

    const scoreX=402,scoreY=heroY+100,scoreW=276,scoreH=210;
    ctx.save();ctx.shadowColor='rgba(0,0,0,.22)';ctx.shadowBlur=28;ctx.shadowOffsetY=10;roundRect(ctx,scoreX,scoreY,scoreW,scoreH,32,INK,null);ctx.restore();
    const statusLabel=live?'LIVE':(played?'RISULTATO FINALE':'DA GIOCARE');
    const statusFill=live?'#ffcf6a':(played?'#bff3ce':GOLD_SOFT);
    roundRect(ctx,scoreX+44,scoreY+24,scoreW-88,36,18,statusFill,null);
    ctx.fillStyle=INK;ctx.font=`950 14px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(statusLabel,scoreX+scoreW/2,scoreY+42,scoreW-100);
    ctx.fillStyle='#fff';ctx.font=`950 ${played||live?70:58}px ${FONT}`;ctx.fillText(played||live?`${score.home} - ${score.away}`:'VS',scoreX+scoreW/2,scoreY+124,scoreW-32);
    if((played||live)&&score.home===score.away&&m.penalties){
      const p=store.normalizePenalties(m.penalties);if(p){ctx.fillStyle=GOLD_SOFT;ctx.font=`850 17px ${FONT}`;ctx.fillText(`Rigori ${p.home}-${p.away}`,scoreX+scoreW/2,scoreY+178,scoreW-30);}
    }

    drawSoftCard(ctx,54,metaY,width-108,metaH,28,'rgba(255,255,255,.76)',LINE);
    const meta=[
      ['Data e ora',formatMatchDate(m)],
      ['Campo',m.field||'Da definire'],
      ['Arbitro',m.referee||'Da definire'],
      ['Turno',m.round||m.bracketRound||store.PHASE_LABELS[m.phase]||'-']
    ];
    const metaGap=14,metaW=(width-108-40-metaGap)/2,metaCardH=72;
    meta.forEach((item,index)=>{
      const col=index%2,row=Math.floor(index/2),x=74+col*(metaW+metaGap),y=metaY+18+row*(metaCardH+14);
      drawMetaCard(ctx,item[0],item[1],x,y,metaW,metaCardH);
    });

    drawSoftCard(ctx,54,scorerY,width-108,scorerPanelH,30,'rgba(255,255,255,.88)',LINE);
    ctx.fillStyle=INK;ctx.font=`950 27px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('Marcatori',82,scorerY+28);
    ctx.fillStyle=MUTED;ctx.font=`750 15px ${FONT}`;ctx.fillText('Ogni giocatore è mostrato una sola volta con il totale dei gol segnati.',82,scorerY+65,width-164);
    const colGap=24,colW=(width-164-colGap)/2,leftX=82,rightX=82+colW+colGap,headY=scorerY+92;
    ctx.strokeStyle='rgba(215,164,45,.22)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(width/2,headY);ctx.lineTo(width/2,scorerY+scorerPanelH-24);ctx.stroke();
    const headings=[[home,leftX],[away,rightX]];
    headings.forEach(([name,x])=>{
      ctx.fillStyle=GOLD;ctx.font=`900 14px ${FONT}`;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText('SQUADRA',x,headY);
      ctx.fillStyle=INK;ctx.font=`900 ${fitFont(ctx,name,colW,21,13,'900')}px ${FONT}`;ctx.fillText(name,x,headY+21,colW);
    });
    const rowsY=headY+58;
    const drawColumn=(rows,x)=>{
      if(!rows.length){drawEmptyScorers(ctx,x,rowsY,colW,scorerRowH);return;}
      rows.forEach((row,index)=>drawScorerRow(ctx,row,x,rowsY+index*(scorerRowH+scorerGap),colW,scorerRowH));
    };
    drawColumn(homeScorers,leftX);drawColumn(awayScorers,rightX);
    drawFooter(ctx,width,height,'Scheda partita esportata in alta qualità');
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
  window.NGShareImages={generate,generateAndPreview,openPreview,closePreview,shareCurrent,downloadCurrent,__test:{buildBracketLayout,headerColumns}};
})();
