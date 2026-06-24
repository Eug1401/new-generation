(function(){
 const store=NexoraStore, UI=NexoraUI, A=NexoraAdmin;
 let teamFilter='', roundFilter='', selectedMatch='', currentTaskMode='menu', previousTaskMode='menu';
 const reportDrafts=new Map();
 let suppressNextDraftSync=false;
 const OWN_GOAL_PREFIX='__own_goal__:';

 function ownGoalValue(teamId){return `${OWN_GOAL_PREFIX}${teamId||''}`;}
 function isOwnGoalValue(value){return String(value||'').startsWith(OWN_GOAL_PREFIX);}
 function ownGoalTeamFromValue(value){return String(value||'').slice(OWN_GOAL_PREFIX.length);}

 function currentList(){return A.filteredMatches(A.state(),teamFilter,roundFilter);} 
 function matchPhaseLabel(m){return store.PHASE_LABELS[m.phase]||m.phase||'Partita';}
 function matchStatusMeta(s,m){
   if(store.matchStatusInfo)return store.matchStatusInfo(s,m);
   if(m.status==='live')return {key:'live',label:'Live',cls:'is-live'};
   const played=store.hasScore(s,m)||m.status==='played';
   return played?{key:'played',label:'Giocata',cls:'is-played'}:{key:'pending',label:'Da giocare',cls:'is-pending'};
 }
 function matchStatusLabel(s,m){return matchStatusMeta(s,m).label;}
 function matchStatusClass(s,m){return matchStatusMeta(s,m).cls;}
 function hasReportData(s,m){return Boolean(m&&(store.hasScore(s,m)||m.status==='played'||m.status==='live'||(m.goals||[]).length||(m.cards||[]).length));}
 function isKings(state){return Boolean(state?.rules?.isKingsLeague===true);}
 function isPresidentScorerAllowed(state){return isKings(state);}
 function renderTeamButtons(){
   const s=A.state(), box=UI.$('#matchTeamButtons'); if(!box)return;
   if(!s.teams.length){box.innerHTML='<div class="empty">Aggiungi prima le squadre.</div>';return;}
   if(teamFilter && !s.teams.some(t=>t.id===teamFilter)){teamFilter='';selectedMatch='';}
   box.innerHTML=s.teams.map(t=>{
     const list=A.filteredMatches(s,t.id,roundFilter);
     const played=list.filter(m=>hasReportData(s,m)).length;
     return `<button type="button" class="flow-pick-btn ${t.id===teamFilter?'active':''}" data-match-team="${t.id}" aria-pressed="${t.id===teamFilter?'true':'false'}">
       ${UI.logo(t,false)}
       <span><strong>${UI.esc(t.name)}</strong><small>${played}/${list.length} partite filtrate</small></span>
       <em>Apri</em>
     </button>`;
   }).join('');
 }
 function renderRoundFilter(){
   const s=A.state(), el=UI.$('#adminMatchRoundFilter'); if(!el)return;
   const rounds=store.selectors.rounds(s);
   el.innerHTML='<option value="">Tutte le giornate/turni</option>'+rounds.map(r=>`<option value="${UI.esc(r)}" ${r===roundFilter?'selected':''}>${UI.esc(r)}</option>`).join('');
 }
 function matchListHtml(s,list){
   if(!list.length)return '<div class="empty">Nessuna partita per questa squadra con il filtro selezionato.</div>';
   return list.map(m=>{
     const home=store.teamName(s,m.homeTeamId,m.homeLabel), away=store.teamName(s,m.awayTeamId,m.awayLabel);
     const dirty=hasReportData(s,m);
     return `<div class="match-pick-row ${m.id===selectedMatch?'active':''}">
       <button type="button" class="match-pick-btn ${m.id===selectedMatch?'active':''}" data-select-match="${m.id}" aria-pressed="${m.id===selectedMatch?'true':'false'}">
         <span class="match-pick-round">${UI.esc(m.round)}</span>
         <strong>${UI.esc(home)} <span>vs</span> ${UI.esc(away)}</strong>
         <small>${UI.esc(matchPhaseLabel(m))} · ${UI.esc(m.field||'Campo da inserire')} · ${UI.esc(m.time||m.date||'Orario da inserire')}</small>
         <em class="match-status-badge ${matchStatusClass(s,m)}" role="status">${UI.esc(matchStatusLabel(s,m))}</em>
       </button>
       <button class="btn small danger match-clear-mini" type="button" data-clear-report-match="${m.id}" ${dirty?'':'disabled'} title="Rimuovi marcatori, autogol e cartellini da questa partita">Pulisci</button>
     </div>`;
   }).join('');
 }
 function renderMatchList(){
   const s=A.state(), box=UI.$('#teamMatchesList'); if(!box)return;
   if(!teamFilter){box.innerHTML='<div class="empty">Prima clicca una squadra. Le partite si apriranno in una schermata dedicata.</div>';selectedMatch='';return;}
   const list=currentList();
   if(!list.some(m=>m.id===selectedMatch)) selectedMatch='';
   const team=store.getTeam(s,teamFilter);
   box.innerHTML=`<div class="selected-team-summary">${team?UI.logo(team,false):''}<div><strong>${UI.esc(team?.name||'Squadra')}</strong><small>${list.length} partite disponibili</small></div><button class="btn primary" type="button" id="openTeamMatchesBtn">Apri partite</button></div>`;
 }
 function renderPreview(){}
 function teamEventOptions(state,match,selected=''){
   const ids=[match.homeTeamId,match.awayTeamId].filter(Boolean);
   return '<option value="">Tutte le squadre della partita</option>'+ids.map(id=>`<option value="${id}" ${id===selected?'selected':''}>${UI.esc(store.teamName(state,id))}</option>`).join('');
 }
 function playerLabelWithNumber(p){
   const num=p.number!==''&&p.number!=null?`#${p.number} `:'';
   const year=p.birthYear?` · ${p.birthYear}`:'';
   return `${num}${p.name}${year}`;
 }
 function playerOptionsForTeam(state,teamId,search='',selected='',kind='goal',match=null){
   const q=String(search||'').trim().toLowerCase();
   const allowedTeamIds=(teamId?[teamId]:[match?.homeTeamId,match?.awayTeamId]).filter(Boolean);
   const teams=allowedTeamIds.map(id=>store.getTeam(state,id)).filter(Boolean);
   if(!teams.length)return '<option value="">Nessun partecipante disponibile</option>';
   const people=[];
   teams.forEach(team=>{
     (team.players||[]).forEach(p=>people.push({
       id:p.id,
       teamId:team.id,
       teamName:team.name,
       name:p.name,
       number:p.number,
       label:`${playerLabelWithNumber(p)}${teamId?'':` · ${team.name}`}`,
       type:'player',
       searchKey:`${p.number!==''&&p.number!=null?p.number:''} ${p.name||''} ${p.birthYear||''} ${team.name||''}`.toLowerCase()
     }));
     if(kind==='goal')people.push({
       id:ownGoalValue(team.id),
       teamId:team.id,
       teamName:team.name,
       name:'Autogol',
       number:'',
       label:`Autogol${teamId?'':` · ${team.name}`}`,
       type:'own-goal',
       searchKey:`autogol auto own goal ${team.name||''}`.toLowerCase()
     });
     if(kind==='goal'&&isKings(state)&&team.president?.name)people.push({
       id:team.president.id,
       teamId:team.id,
       teamName:team.name,
       name:team.president.name,
       number:'',
       label:`${team.president.name} · Gol (rig.)${teamId?'':` · ${team.name}`}`,
       type:'president',
       searchKey:`pres presidente rig rigore ${team.president.name||''} ${team.name||''}`.toLowerCase()
     });
   });
   people.sort((a,b)=>{
     const typeOrder={player:0,president:1,'own-goal':2};
     if(a.teamId!==b.teamId)return allowedTeamIds.indexOf(a.teamId)-allowedTeamIds.indexOf(b.teamId);
     if(typeOrder[a.type]!==typeOrder[b.type])return typeOrder[a.type]-typeOrder[b.type];
     const an=a.type==='player'&&a.number!==''&&a.number!=null?Number(a.number):9999;
     const bn=b.type==='player'&&b.number!==''&&b.number!=null?Number(b.number):9999;
     return an-bn||String(a.name||'').localeCompare(String(b.name||''),'it');
   });
   let filtered=people;
   if(q){
     if(/^\d+$/.test(q)){
       const exact=people.filter(p=>p.type==='player'&&String(p.number??'')===q);
       const prefix=people.filter(p=>p.type==='player'&&String(p.number??'').startsWith(q)&&String(p.number??'')!==q);
       filtered=[...exact,...prefix];
     }else filtered=people.filter(p=>(p.searchKey||'').includes(q));
   }
   const selectedStillVisible=filtered.some(p=>p.id===selected);
   const first='<option value="">Seleziona marcatore/autogol</option>';
   return first+filtered.map(p=>`<option value="${UI.esc(p.id)}" ${p.id===selected&&selectedStillVisible?'selected':''}>${UI.esc(p.label)}</option>`).join('')+(filtered.length?'':'<option value="" disabled>Nessun risultato</option>');
 }
 function updateEventPlayerPickers(form,kind){
   const teamPicker=form.querySelector(`[data-${kind}-team-picker]`);
   const search=form.querySelector(`[data-${kind}-player-search]`);
   const playerPicker=form.querySelector(`[data-${kind}-player-picker]`);
   if(!teamPicker||!playerPicker)return;
   const match=A.state().matches.find(item=>item.id===form.dataset.matchId);
   playerPicker.innerHTML=playerOptionsForTeam(A.state(),teamPicker.value,search?.value||'',playerPicker.value,kind,match);
 }
 function syncQuickGoalDoublePicker(form){
   const doubleInput=form?.querySelector('[data-goal-double-count-picker]');if(!doubleInput)return;
   const normalInput=form.querySelector('[data-goal-normal-count-picker]');
   const picked=form.querySelector('[data-goal-player-picker]')?.value||'';
   const participant=store.getParticipant(A.state(),picked);
   const enabled=Boolean(isKings(A.state())&&participant&&participant.type==='player');
   doubleInput.disabled=!enabled;
   doubleInput.value=enabled?String(Math.max(0,Math.min(99,Number(doubleInput.value)||0))):'0';
   if(normalInput){
     normalInput.value=String(Math.max(0,Math.min(99,Number(normalInput.value)||0)));
     const label=normalInput.closest('div')?.querySelector('label');
     if(label)label.textContent=participant?.type==='president'?'Gol (rig.)':(isOwnGoalValue(picked)?'Autogol':'Gol normali');
   }
 }
 function cardTypeSelect(selected='yellow'){
   return `<select data-card-type-picker><option value="yellow" ${selected==='yellow'?'selected':''}>Giallo</option><option value="red" ${selected==='red'?'selected':''}>Rosso</option></select>`;
 }
 function playerLabel(state,playerId){
   const p=store.getParticipant(state,playerId);
   return p?`${p.type==='president'?'Pres. ':''}${UI.esc(p.name)} · ${UI.esc(p.team.name)}`:'Persona rimossa';
 }
 function participantNumber(state,playerId){
   const p=store.getParticipant(state,playerId);
   return p?.type==='player'&&p.number!==''&&p.number!=null?String(p.number):'';
 }
 function matchGoalPlayerOptions(state,match,selected=''){
   if(!match)return '<option value="">Nessun giocatore disponibile</option>';
   return [match.homeTeamId,match.awayTeamId].filter(Boolean).map(teamId=>{
     const team=store.getTeam(state,teamId);if(!team)return '';
     const people=(team.players||[]).map(player=>({...player,type:'player'}));
     if(isPresidentScorerAllowed(state)&&team.president?.name)people.push({...team.president,type:'president'});
     people.sort((a,b)=>{
       const an=a.type==='player'&&a.number!==''&&a.number!=null?Number(a.number):9999;
       const bn=b.type==='player'&&b.number!==''&&b.number!=null?Number(b.number):9999;
       return an-bn||String(a.name||'').localeCompare(String(b.name||''),'it');
     });
     return `<optgroup label="${UI.esc(team.name)}">${people.map(person=>{
       const number=person.type==='player'&&person.number!==''&&person.number!=null?String(person.number):'';
       const label=person.type==='president'?(store.presidentGoalLabel?store.presidentGoalLabel(state,person.id):`${person.name} (rig.)`):`${number?`#${number} `:''}${person.name}`;
       return `<option value="${UI.esc(person.id)}" data-number="${UI.esc(number)}" data-team-id="${UI.esc(teamId)}" ${person.id===selected?'selected':''}>${UI.esc(label)}</option>`;
     }).join('')}</optgroup>`;
   }).join('');
 }
 function compactGoalDrafts(goals=[]){
   const grouped=new Map();
   goals.forEach(goal=>{
     const own=Boolean(goal?.ownGoal);
     const weight=own?1:(Number(goal?.weight)===2?2:1);
     const key=own?`own:${goal?.teamId||''}`:`player:${goal?.playerId||''}`;
     if(!grouped.has(key))grouped.set(key,{
       ownGoal:own,
       teamId:own?(goal?.teamId||''):'',
       playerId:own?'':(goal?.playerId||''),
       normalCount:0,
       doubleCount:0,
       singleMinutes:[],
       doubleMinutes:[],
       singleIds:[],
       doubleIds:[]
     });
     const row=grouped.get(key);
     const minute=Number(goal?.minute);
     const cleanMinute=Number.isInteger(minute)&&minute>0?minute:'';
     const id=String(goal?.id||'');
     if(!own&&weight===2){
       row.doubleCount+=1;
       row.doubleMinutes.push(cleanMinute);
       row.doubleIds.push(id);
     }else{
       row.normalCount+=1;
       row.singleMinutes.push(cleanMinute);
       row.singleIds.push(id);
     }
   });
   return Array.from(grouped.values());
 }
 function cardLabel(type){return type==='red'?'Rosso':'Giallo';}
 function goalDraftItem(state,match,arg,weight=1){
   const g=(arg&&typeof arg==='object')?arg:{playerId:arg,normalCount:Number(weight)===2?0:1,doubleCount:Number(weight)===2?1:0};
   const legacyCount=Math.max(0,Math.min(99,Number(g.count)||0));
   const legacyDouble=Math.max(0,Math.min(legacyCount,Number(g.doubleCount ?? (Number(g.weight)===2?legacyCount:0))||0));
   let normalCount=Math.max(0,Math.min(99,Number(g.normalCount ?? (legacyCount-legacyDouble))||0));
   let doubleCount=Math.max(0,Math.min(99,Number(g.doubleCount ?? legacyDouble)||0));
   if(!normalCount&&!doubleCount){normalCount=1;}
   const singleMinutesValue=UI.esc(JSON.stringify(Array.isArray(g.singleMinutes)?g.singleMinutes:[]));
   const doubleMinutesValue=UI.esc(JSON.stringify(Array.isArray(g.doubleMinutes)?g.doubleMinutes:[]));
   const singleIdsValue=UI.esc(JSON.stringify(Array.isArray(g.singleIds)?g.singleIds:[]));
   const doubleIdsValue=UI.esc(JSON.stringify(Array.isArray(g.doubleIds)?g.doubleIds:[]));
   if(g.ownGoal){
     const teamId=g.teamId||'';
     const team=store.getTeam(state,teamId);
     if(!team)return '';
     return `<div class="event-item goal-draft-row scorer-editor-row is-own-goal-scorer" data-event-item data-own-goal-team="${UI.esc(teamId)}">
      <input type="hidden" name="goalOwnGoal" value="1">
      <input type="hidden" name="goalTeamId" value="${UI.esc(teamId)}">
      <input type="hidden" name="goalPlayerId" value="">
      <input type="hidden" name="goalDoubleCount" value="0">
      <input type="hidden" name="goalSingleMinutes" value="${singleMinutesValue}">
      <input type="hidden" name="goalDoubleMinutes" value="[]">
      <input type="hidden" name="goalSingleIds" value="${singleIdsValue}">
      <input type="hidden" name="goalDoubleIds" value="[]">
      <span class="event-icon" aria-hidden="true">↩️</span>
      <div class="scorer-editor-main"><label>Evento</label><strong>Autogol a favore di ${UI.esc(team.name||'squadra')}</strong><small>Attribuito alla squadra, senza classifica marcatore.</small></div>
      <div class="scorer-editor-number"><label>Maglia</label><input value="—" aria-label="Numero di maglia" readonly></div>
      <div class="scorer-editor-count"><label>Autogol</label><input name="goalNormalCount" type="number" min="0" max="99" step="1" inputmode="numeric" value="${normalCount}" aria-label="Numero di autogol"></div>
      <button class="btn small danger scorer-remove-btn" type="button" data-remove-draft-row>Rimuovi</button>
     </div>`;
   }
   const playerId=g.playerId;
   if(store.isPresidentId(state,playerId)&&!isPresidentScorerAllowed(state)) return '';
   const participant=store.getParticipant(state,playerId);
   if(!participant)return '';
   const isPresident=participant.type==='president';
   if(isPresident){normalCount=Math.max(1,normalCount+doubleCount);doubleCount=0;}
   const doubleField=isKings(state)&&!isPresident
     ?`<div class="scorer-editor-weight"><label>Gol doppi</label><input name="goalDoubleCount" type="number" min="0" max="99" step="1" inputmode="numeric" value="${doubleCount}" aria-label="Numero di gol doppi"></div>`
     :`<input type="hidden" name="goalDoubleCount" value="0">`;
   return `<div class="event-item goal-draft-row scorer-editor-row ${isPresident?'is-president-scorer':''}" data-event-item>
    <input type="hidden" name="goalOwnGoal" value="0">
    <input type="hidden" name="goalTeamId" value="">
    <input type="hidden" name="goalSingleMinutes" value="${singleMinutesValue}">
    <input type="hidden" name="goalDoubleMinutes" value="${doubleMinutesValue}">
    <input type="hidden" name="goalSingleIds" value="${singleIdsValue}">
    <input type="hidden" name="goalDoubleIds" value="${doubleIdsValue}">
    <span class="event-icon" aria-hidden="true">⚽</span>
    <div class="scorer-editor-main"><label>${isPresident?'Presidente':'Giocatore'}</label><select name="goalPlayerId" data-goal-row-player aria-label="Modifica marcatore">${matchGoalPlayerOptions(state,match,playerId)}</select><small>${UI.esc(participant.team.name)}${isPresident?' · Classifica presidenti separata':''}</small></div>
    <div class="scorer-editor-number"><label>Maglia</label><input data-goal-jersey value="${UI.esc(participantNumber(state,playerId)||'—')}" aria-label="Numero di maglia" readonly></div>
    <div class="scorer-editor-count"><label>${isPresident?'Gol (rig.)':'Gol normali'}</label><input name="goalNormalCount" type="number" min="0" max="99" step="1" inputmode="numeric" value="${normalCount}" aria-label="${isPresident?'Numero di gol del presidente':'Numero di gol normali'}"></div>
    ${doubleField}
    <button class="btn small danger scorer-remove-btn" type="button" data-remove-draft-row>Rimuovi</button>
   </div>`;
 }
 function cardDraftItem(state,arg,type='yellow'){
   const c=(arg&&typeof arg==='object')?arg:{playerId:arg,type};
   const playerId=c.playerId;
   const cardType=c.type==='red'?'red':'yellow';
   const minute=Number.isInteger(Number(c.minute))&&Number(c.minute)>0?Number(c.minute):'';
   return `<div class="event-item card-draft-row" data-event-item>
    <input type="hidden" name="cardPlayerId" value="${UI.esc(playerId)}">
    <input type="hidden" name="cardType" value="${UI.esc(cardType)}">
    <input type="hidden" name="cardMinute" value="${minute}">
    <span class="event-icon">${cardType==='red'?'🟥':'🟨'}</span>
    <strong>${playerLabel(state,playerId)}</strong>
    <span class="pill">${cardLabel(cardType)}</span>
    ${minute?`<span class="pill">${minute}′</span>`:''}
    <button class="btn small danger" type="button" data-remove-draft-row>Rimuovi</button>
   </div>`;
 }
 function emptyGoals(){return `<div class="empty" data-empty-goals>Nessun marcatore o autogol aggiunto. Seleziona ${isKings(A.state())?'calciatore, presidente o autogol':'un calciatore o autogol'} e premi “Aggiungi”.</div>`;}
 function emptyCards(){return '<div class="empty" data-empty-cards>Nessun cartellino aggiunto. Seleziona un calciatore, scegli il tipo e premi “Aggiungi”.</div>';}
 function draftFromMatch(m){return {field:m.field||'',referee:m.referee||'',date:m.date||'',time:m.time||'',status:m.status||'scheduled',penaltiesHome:m.penalties?String(m.penalties.home):'',penaltiesAway:m.penalties?String(m.penalties.away):'',goals:(m.goals||[]).map(g=>store.isOwnGoalEvent&&store.isOwnGoalEvent(g)?{id:g.id,ownGoal:true,teamId:g.teamId,weight:1,minute:g.minute}:{id:g.id,playerId:g.playerId,weight:Number(g.weight)===2?2:1,minute:g.minute}),cards:(m.cards||[]).map(c=>({id:c.id,playerId:c.playerId,type:c.type==='red'?'red':'yellow',minute:c.minute}))};}
 function getReportDraft(match){
   if(!match)return {field:'',referee:'',date:'',time:'',status:'scheduled',penaltiesHome:'',penaltiesAway:'',goals:[],cards:[]};
   if(!reportDrafts.has(match.id)) reportDrafts.set(match.id,draftFromMatch(match));
   const draft=reportDrafts.get(match.id);
   if(!('field' in draft)){Object.assign(draft,{field:match.field||'',referee:match.referee||'',date:match.date||'',time:match.time||''});}
   if(!('status' in draft)){draft.status=match.status||'scheduled';}
   if(!('penaltiesHome' in draft)){draft.penaltiesHome=match.penalties?String(match.penalties.home):'';draft.penaltiesAway=match.penalties?String(match.penalties.away):'';}
   return draft;
 }
 function goalEventsFromRows(state,match,rows){
   const events=[];
   const readArray=(row,name)=>{try{const value=JSON.parse(row.querySelector(`[name="${name}"]`)?.value||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}};
   const cleanCount=(row,name)=>Math.max(0,Math.min(99,Number(row.querySelector(`[name="${name}"]`)?.value)||0));
   (rows||[]).forEach(row=>{
     const own=String(row.querySelector('[name="goalOwnGoal"]')?.value||'')==='1';
     let normalCount=cleanCount(row,'goalNormalCount');
     let doubleCount=cleanCount(row,'goalDoubleCount');
     const singleMinutes=readArray(row,'goalSingleMinutes');
     const doubleMinutes=readArray(row,'goalDoubleMinutes');
     const singleIds=readArray(row,'goalSingleIds');
     const doubleIds=readArray(row,'goalDoubleIds');
     if(own){
       const teamId=String(row.querySelector('[name="goalTeamId"]')?.value||'');
       if(!match||(teamId!==match.homeTeamId&&teamId!==match.awayTeamId))return;
       for(let index=0;index<normalCount;index++){
         const minute=Number(singleMinutes[index]);
         events.push({id:String(singleIds[index]||''),ownGoal:true,teamId,weight:1,...(Number.isInteger(minute)&&minute>0?{minute}:{})});
       }
       return;
     }
     const playerId=String(row.querySelector('[name="goalPlayerId"]')?.value||'');
     if(!playerId)return;
     const participant=store.getParticipant(state,playerId);
     if(!participant||!match||![match.homeTeamId,match.awayTeamId].includes(participant.team.id))return;
     if(store.isPresidentId(state,playerId)&&!isPresidentScorerAllowed(state))return;
     if(participant.type==='president'||!isKings(state)){normalCount+=doubleCount;doubleCount=0;}
     for(let index=0;index<normalCount;index++){
       const minute=Number(singleMinutes[index]);
       events.push({id:String(singleIds[index]||''),playerId,weight:1,...(Number.isInteger(minute)&&minute>0?{minute}:{})});
     }
     for(let index=0;index<doubleCount;index++){
       const minute=Number(doubleMinutes[index]);
       events.push({id:String(doubleIds[index]||''),playerId,weight:2,...(Number.isInteger(minute)&&minute>0?{minute}:{})});
     }
   });
   return events;
 }

 function syncFormDraft(form){
   if(!form)return;
   if(form.classList?.contains('match-edit-form')){
     const matchId=form.dataset.matchId; if(!matchId)return;
     const m=A.state().matches.find(x=>x.id===matchId); const current=getReportDraft(m);
     const fd=new FormData(form);
     const isLive=form.querySelector('[name="isLive"]')?.checked;
     // I campi rigori possono essere assenti dal DOM (se non KO o non pari): mantieni i valori del draft.
     const pHomeEl=form.querySelector('[name="penaltiesHome"]');
     const pAwayEl=form.querySelector('[name="penaltiesAway"]');
     const newPHome=pHomeEl?String(fd.get('penaltiesHome')||'').trim():current.penaltiesHome;
     const newPAway=pAwayEl?String(fd.get('penaltiesAway')||'').trim():current.penaltiesAway;
     Object.assign(current,{
       field:(fd.get('field')||'').trim(),
       referee:(fd.get('referee')||'').trim(),
       date:fd.get('date')||current.date||'',
       time:fd.get('time')||'',
       penaltiesHome:newPHome,
       penaltiesAway:newPAway,
       status:isLive?'live':(current.status==='played'?'played':(current.status==='live'?'scheduled':current.status||'scheduled'))
     });
     reportDrafts.set(matchId,current);
     return;
   }
   if(!form.classList?.contains('report-complete-form'))return;
   const matchId=form.dataset.matchId; if(!matchId)return;
   const fd=new FormData(form);
   const state=A.state();
   const m=state.matches.find(x=>x.id===matchId); const current=getReportDraft(m);
   const goalRows=Array.from(form.querySelectorAll('.goal-draft-row'));
   const nextGoals=goalEventsFromRows(state,m,goalRows);
   const cardIds=fd.getAll('cardPlayerId').filter(Boolean);
   const cardTypes=fd.getAll('cardType');
   const cardMinutes=fd.getAll('cardMinute');
   const hasGoalEditor=Boolean(form.querySelector('[data-goal-rows]'));
   const hasCardEditor=Boolean(form.querySelector('[data-card-rows]'));
   reportDrafts.set(matchId,{
     ...current,
     goals:(goalRows.length||hasGoalEditor)?nextGoals:((current.goals||[]).filter(g=>g.ownGoal||(!store.isPresidentId(state,g.playerId)||isPresidentScorerAllowed(state)))),
     cards:(cardIds.length||hasCardEditor)?cardIds.map((playerId,i)=>{const minute=Number(cardMinutes[i]);return {playerId,type:cardTypes[i]==='red'?'red':'yellow',...(Number.isInteger(minute)&&minute>0?{minute}:{})};}):current.cards||[]
   });
 }
 function syncOpenTaskDraft(){
   document.querySelectorAll('.match-edit-form,.report-complete-form').forEach(syncFormDraft);
 }
 function hasUnsavedDraft(m){
   if(!m||!reportDrafts.has(m.id))return false;
   const d=reportDrafts.get(m.id)||{};
   const base=draftFromMatch(m);
   return JSON.stringify(d)!==JSON.stringify(base);
 }
 function draftGoalRows(s,m,draft){return compactGoalDrafts((draft.goals||[]).filter(g=>g.ownGoal||(g.playerId&&(!store.isPresidentId(s,g.playerId)||isPresidentScorerAllowed(s))))).map(g=>goalDraftItem(s,m,g,isKings(s)?(g.weight||1):1)).join('');}
 function draftCardRows(s,draft){return (draft.cards||[]).map(c=>cardDraftItem(s,c)).join('');}

 function countDraftGoalsByTeam(state,match,form){
   const goals=goalEventsFromRows(state,match,Array.from(form.querySelectorAll('.goal-draft-row')));
   const score=store.matchGoals(state,{...match,goals});
   return {home:score.home,away:score.away,actual:goals.length};
 }
 function countCards(form){
   const types=new FormData(form).getAll('cardType');
   return {yellow:types.filter(t=>t==='yellow').length, red:types.filter(t=>t==='red').length};
 }
 function updateDraftSummary(form){
   const s=A.state(), m=s.matches.find(x=>x.id===form.dataset.matchId);
   if(!m) return;
   const score=countDraftGoalsByTeam(s,m,form);
   const cards=countCards(form);
   const totalGoals=score.actual;
   const badge=form.querySelector('[data-draft-score]');
   const homeCount=form.querySelector('[data-home-goals-count]');
   const awayCount=form.querySelector('[data-away-goals-count]');
   const totalGoalsCount=form.querySelector('[data-total-goals-count]');
   const yellowCount=form.querySelector('[data-yellow-count]');
   const redCount=form.querySelector('[data-red-count]');
   if(badge) badge.textContent=`Risultato bozza: ${score.home} - ${score.away}`;
   if(homeCount) homeCount.textContent=score.home;
   if(awayCount) awayCount.textContent=score.away;
   if(totalGoalsCount) totalGoalsCount.textContent=totalGoals;
   if(yellowCount) yellowCount.textContent=cards.yellow;
   if(redCount) redCount.textContent=cards.red;
 }


 function goalRowIdentity(row){
   if(!row)return '';
   if(String(row.querySelector('[name="goalOwnGoal"]')?.value||'')==='1')return `own:${row.querySelector('[name="goalTeamId"]')?.value||''}`;
   return `player:${row.querySelector('[name="goalPlayerId"]')?.value||''}`;
 }
 function mergeDuplicateGoalRow(form,row){
   const identity=goalRowIdentity(row);if(!identity||identity.endsWith(':'))return row;
   const duplicate=Array.from(form.querySelectorAll('.goal-draft-row')).find(candidate=>candidate!==row&&goalRowIdentity(candidate)===identity);
   if(!duplicate)return row;
   const mergeCount=name=>{
     const target=duplicate.querySelector(`[name="${name}"]`),source=row.querySelector(`[name="${name}"]`);
     if(target)target.value=String(Math.min(99,(Number(target.value)||0)+(Number(source?.value)||0)));
   };
   const mergeArray=name=>{
     const parse=el=>{try{const value=JSON.parse(el?.value||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}};
     const target=duplicate.querySelector(`[name="${name}"]`),source=row.querySelector(`[name="${name}"]`);
     if(target)target.value=JSON.stringify([...parse(target),...parse(source)]);
   };
   mergeCount('goalNormalCount');mergeCount('goalDoubleCount');
   ['goalSingleMinutes','goalDoubleMinutes','goalSingleIds','goalDoubleIds'].forEach(mergeArray);
   row.remove();
   refreshGoalRowParticipant(A.state(),duplicate);
   return duplicate;
 }
 function refreshGoalRowParticipant(state,row){
   const picker=row?.querySelector('[data-goal-row-player]');if(!picker)return;
   const participant=store.getParticipant(state,picker.value);
   const jersey=row.querySelector('[data-goal-jersey]');if(jersey)jersey.value=participantNumber(state,picker.value)||'—';
   const meta=row.querySelector('.scorer-editor-main small');if(meta)meta.textContent=participant?.team?.name?(participant.type==='president'?`${participant.team.name} · Classifica presidenti separata`:participant.team.name):'Giocatore non disponibile';
   const normalLabel=row.querySelector('.scorer-editor-count label');
   const normalInput=row.querySelector('[name="goalNormalCount"]');
   row.classList.toggle('is-president-scorer',participant?.type==='president');
   let doubleInput=row.querySelector('[name="goalDoubleCount"]');
   const holder=row.querySelector('.scorer-editor-weight');
   if(participant?.type==='president'||!isKings(state)){
     if(holder){
       const normal=Math.max(0,Number(normalInput?.value)||0)+(Math.max(0,Number(doubleInput?.value)||0));
       if(normalInput)normalInput.value=String(Math.min(99,normal));
       holder.outerHTML='<input type="hidden" name="goalDoubleCount" value="0">';
     }
     if(normalLabel)normalLabel.textContent=participant?.type==='president'?'Gol (rig.)':'Gol normali';
     if(normalInput)normalInput.setAttribute('aria-label',participant?.type==='president'?'Numero di gol del presidente':'Numero di gol normali');
   }else{
     if(normalLabel)normalLabel.textContent='Gol normali';
     if(!holder){
       const hidden=row.querySelector('input[type="hidden"][name="goalDoubleCount"]');
       const wrapper=document.createElement('div');wrapper.className='scorer-editor-weight';wrapper.innerHTML='<label>Gol doppi</label><input name="goalDoubleCount" type="number" min="0" max="99" step="1" inputmode="numeric" value="0" aria-label="Numero di gol doppi">';
       hidden?.replaceWith(wrapper);
     }
   }
 }



 function draftScoreFromDraft(state,m,d){
   // Calcola il punteggio teorico considerando i goal del draft (anche se non ancora salvati)
   const draftMatch={...m,goals:(d.goals||[]).map(g=>g.ownGoal?{ownGoal:true,teamId:g.teamId,playerId:'',weight:1,minute:g.minute}:{playerId:g.playerId,weight:g.weight||1,minute:g.minute})};
   return store.matchGoals(state,draftMatch);
 }
 function shouldShowPenaltyFields(state,m,d){
   if(!m||!m.homeTeamId||!m.awayTeamId)return false;
   if(!store.isKnockoutPhase||!store.isKnockoutPhase(m))return false;
   const sc=draftScoreFromDraft(state,m,d);
   // Mostro i rigori sempre nelle KO con squadre reali quando il punteggio (bozza) è pari.
   // Includo anche 0-0: a volte i KO finiscono 0-0 e si va ai rigori.
   return sc.home===sc.away;
 }
 function infoFormHtml(s,m){
   const d=getReportDraft(m);
   const isLive=d.status==='live';
   const isPlayed=d.status==='played';
   const showPenalty=shouldShowPenaltyFields(s,m,d);
   const score=draftScoreFromDraft(s,m,d);
   const penaltyBlock=showPenalty?`
      <div class="penalty-fields-block">
        <div class="penalty-header">
          <strong>⚽ Rigori (fase a eliminazione diretta)</strong>
          <small>Punteggio bozza ${score.home}-${score.away}: in caso di parità inserisci i rigori per determinare il vincitore.</small>
        </div>
        <div><label>Rigori ${UI.esc(store.teamName(s,m.homeTeamId,m.homeLabel))}</label><input name="penaltiesHome" type="number" min="0" max="99" inputmode="numeric" value="${UI.esc(d.penaltiesHome||'')}" placeholder="es. 5"></div>
        <div><label>Rigori ${UI.esc(store.teamName(s,m.awayTeamId,m.awayLabel))}</label><input name="penaltiesAway" type="number" min="0" max="99" inputmode="numeric" value="${UI.esc(d.penaltiesAway||'')}" placeholder="es. 3"></div>
      </div>`:'';
   return `<form class="match-edit-form form-grid" data-match-id="${m.id}">
      <div><label>Campo</label><input name="field" value="${UI.esc(d.field||'')}" placeholder="Es. Campo 1"></div>
      <div><label>Arbitro</label><input name="referee" value="${UI.esc(d.referee||'')}" placeholder="Nome arbitro"></div>
      ${s.rules.oneDay?`<div><label>Ora partita</label><input name="time" type="time" value="${UI.esc(d.time||'')}"></div>`:`<div><label>Data</label><input name="date" type="date" value="${UI.esc(d.date||'')}"></div><div><label>Ora</label><input name="time" type="time" value="${UI.esc(d.time||'')}"></div>`}
      <label class="check-card field-full live-toggle ${isLive?'is-active':''}">
        <input name="isLive" type="checkbox" ${isLive?'checked':''} ${isPlayed?'disabled':''}>
        <span><strong>🔴 Partita Live</strong><small>${isPlayed?'La partita è già stata segnata come Giocata. Pulisci il referto per riabilitare lo stato Live.':'Attiva mentre la partita è in corso. Il punteggio sarà visibile in arancione, ma la partita non entra in classifica finché non la chiudi come Giocata.'}</small></span>
      </label>
      ${penaltyBlock}
    </form>`;
 }
 function reportFormHtml(s,m,mode='goals'){
   const real=m.homeTeamId&&m.awayTeamId;
   if(!real)return '<div class="empty">Referto disponibile solo per partite con due squadre reali.</div>';
   const draft=getReportDraft(m);
   const safeDraftGoals=(draft.goals||[]).filter(g=>g.ownGoal||(g.playerId&&(!store.isPresidentId(s,g.playerId)||isPresidentScorerAllowed(s)))).map(g=>g.ownGoal?{ownGoal:true,teamId:g.teamId,playerId:'',weight:1}:{playerId:g.playerId,weight:isKings(s)?(g.weight||1):1});
   const savedScore=store.matchGoals(s,{...m,goals:safeDraftGoals});
   const goalsRows=draftGoalRows(s,m,draft);
   const cardsRows=draftCardRows(s,draft);
   const hiddenGoals=mode==='cards'?`<div class="hidden-event-cache">${goalsRows}</div>`:'';
   const hiddenCards=mode==='goals'?`<div class="hidden-event-cache">${cardsRows}</div>`:'';
   return `<form class="report-complete-form" data-match-id="${m.id}">
      <div class="report-head clean"><div><h3>${mode==='goals'?'Marcatori e autogol':'Cartellini'}</h3><p class="muted">${UI.esc(store.teamName(s,m.homeTeamId,m.homeLabel))} vs ${UI.esc(store.teamName(s,m.awayTeamId,m.awayLabel))}</p></div><span class="score-badge" data-draft-score>${savedScore.home} - ${savedScore.away}</span></div>
      ${mode==='goals'?`
      <section class="event-panel match-task-panel-body margin-top">
        <div class="section-title compact"><div><h3>Marcatori e autogol</h3><p>${isKings(s)?'Inserisci ogni giocatore una sola volta e gestisci separatamente gol normali, gol doppi e gol del presidente.':'Inserisci ogni giocatore una sola volta e modifica direttamente la quantità dei gol.'}</p></div></div>
        <div class="quick-add-bar event-picker-grid">
          <div><label>Squadra gol</label><select data-goal-team-picker>${teamEventOptions(s,m)}</select></div>
          <div><label>Cerca nome, numero o autogol</label><input data-goal-player-search inputmode="search" placeholder="Es. 10, Paolo o autogol" autocomplete="off"></div>
          <div><label>Nuovo marcatore</label><select data-goal-player-picker><option value="">Seleziona prima una squadra</option></select></div>
          <div><label>Gol normali</label><input data-goal-normal-count-picker type="number" min="0" max="99" step="1" inputmode="numeric" value="1"></div>
          ${isKings(s)?`<div><label>Gol doppi</label><input data-goal-double-count-picker type="number" min="0" max="99" step="1" inputmode="numeric" value="0"><small>Ogni gol doppio vale 2 nel risultato e 1 nella classifica marcatori.</small></div>`:''}
          <button class="btn primary" type="button" data-add-goal-row>Aggiungi marcatore</button>
        </div>
        <div class="stack margin-top" data-goal-rows>${goalsRows||emptyGoals()}</div>
        ${hiddenCards}
      </section>`:`
      <section class="event-panel match-task-panel-body margin-top">
        <div class="section-title compact"><div><h3>Cartellini</h3><p>Cerca per numero maglia. Il presidente non è selezionabile.</p></div></div>
        <div class="quick-add-bar card-add-bar event-picker-grid">
          <div><label>Squadra cartellino</label><select data-card-team-picker>${teamEventOptions(s,m)}</select></div>
          <div><label>Cerca numero</label><input data-card-player-search inputmode="numeric" placeholder="Es. 10" autocomplete="off"></div>
          <div><label>Calciatore</label><select data-card-player-picker><option value="">Seleziona prima una squadra</option></select></div>
          <div><label>Tipo</label>${cardTypeSelect('yellow')}</div>
          <button class="btn" type="button" data-add-card-row>Aggiungi cartellino</button>
        </div>
        <div class="stack margin-top" data-card-rows>${cardsRows||emptyCards()}</div>
        ${hiddenGoals}
      </section>`}
    </form>`;
 }
 function ensureMatchListModal(){
   let modal=UI.$('#matchListModal');
   if(modal)return modal;
   modal=document.createElement('div');
   modal.className='modal match-list-modal';
   modal.id='matchListModal';
   modal.setAttribute('role','dialog');
   modal.setAttribute('aria-modal','true');
   modal.innerHTML=`<div class="modal-content match-list-content"><div class="match-task-toolbar"><h2 id="matchListTitle">Scegli partita</h2><button class="btn danger" id="closeMatchListModal" type="button">Chiudi</button></div><div id="matchListBody" class="match-pick-list"></div></div>`;
   document.body.appendChild(modal);return modal;
 }
 function openTeamMatchesModal(){
   const s=A.state();
   if(!teamFilter)return;
   const list=currentList();
   const team=store.getTeam(s,teamFilter);
   const modal=ensureMatchListModal();
   UI.$('#matchListTitle').textContent=`Partite · ${team?.name||'Squadra'}`;
   UI.$('#matchListBody').innerHTML=matchListHtml(s,list);
   modal.classList.add('open');
 }
 function closeMatchListModal(){UI.$('#matchListModal')?.classList.remove('open');}

 function ensureMatchTaskModal(){
   let modal=UI.$('#matchTaskModal');
   if(modal)return modal;
   modal=document.createElement('div');
   modal.className='modal match-task-modal';
   modal.id='matchTaskModal';
   modal.setAttribute('role','dialog');
   modal.setAttribute('aria-modal','true');
   modal.innerHTML=`<div class="modal-content match-task-content"><div class="match-task-toolbar"><h2 id="matchTaskTitle">Partita</h2><button class="btn danger" id="closeMatchTaskModal" type="button">Chiudi</button></div><div id="matchTaskBody"></div></div>`;
   document.body.appendChild(modal);return modal;
 }
 function openMatchPanel(mode='menu'){
   if(suppressNextDraftSync){suppressNextDraftSync=false;}else{syncOpenTaskDraft();}
   previousTaskMode=currentTaskMode||'menu';
   currentTaskMode=mode||'menu';
   const s=A.state(),m=s.matches.find(x=>x.id===selectedMatch);if(!m)return;
   // LOCK ATOMICO: prima di aprire, prova ad acquisire il lock della partita.
   // Se un altro admin la sta già modificando, blocco l'apertura.
   if(window.NG_MATCH_LOCK){
     const adminLabel = (typeof A.adminLabel==='function' ? A.adminLabel() : '') || 'Admin';
     const lockResult = window.NG_MATCH_LOCK.acquire(m.id, adminLabel);
     if(!lockResult.ok){
       alert('⚠️ Questa partita è in modifica da un altro admin: ' + (lockResult.lockedBy||'Sconosciuto') + '\n\nAttendi che termini, oppure aggiorna la pagina più tardi.');
       selectedMatch='';
       return;
     }
   }
   const modal=ensureMatchTaskModal();
   const title=mode==='info'?'Info partita':mode==='goals'?'Marcatori':mode==='cards'?'Cartellini':'Scegli cosa modificare';
   UI.$('#matchTaskTitle').textContent=`${title} · ${store.teamName(s,m.homeTeamId,m.homeLabel)} vs ${store.teamName(s,m.awayTeamId,m.awayLabel)}`;
   UI.$('#matchTaskBody').innerHTML=mode==='menu'?matchCommandHtml(s,m):(mode==='info'?infoFormHtml(s,m):reportFormHtml(s,m,mode));
   modal.classList.add('open');
 }
 function closeMatchTaskModal(opts={}){
   syncOpenTaskDraft();
   if(!opts.force && currentTaskMode && currentTaskMode!=='menu' && selectedMatch){
     openMatchPanel('menu');
     return;
   }
   // RILASCIO LOCK alla chiusura del modale
   if(selectedMatch && window.NG_MATCH_LOCK){
     window.NG_MATCH_LOCK.release(selectedMatch);
   }
   currentTaskMode='menu';previousTaskMode='menu';
   UI.$('#matchTaskModal')?.classList.remove('open');
 }
 function matchCommandHtml(s,m){
   const d=getReportDraft(m);
   const home=store.teamName(s,m.homeTeamId,m.homeLabel), away=store.teamName(s,m.awayTeamId,m.awayLabel);
   const draftMatch={...m,field:d.field,referee:d.referee,date:d.date,time:d.time,status:d.status||m.status,goals:(d.goals||[]).map(g=>g.ownGoal?{ownGoal:true,teamId:g.teamId,playerId:'',weight:1,minute:g.minute}:{playerId:g.playerId,weight:g.weight||1,minute:g.minute}),cards:(d.cards||[])};
   const meta=matchStatusMeta(s,draftMatch);
   const real=m.homeTeamId&&m.awayTeamId;
   const dirty=hasUnsavedDraft(m);
   const isLive=d.status==='live';
   const isKO=store.isKnockoutPhase&&store.isKnockoutPhase(m)&&real;
   const score=draftScoreFromDraft(s,m,d);
   const needsPenalties=isKO&&score.home===score.away&&(d.goals?.length>0||d.cards?.length>0||d.status==='live'||d.status==='played');
   const pParsed=parsePenaltiesFromDraft(d);
   const validPenalties=pParsed&&!pParsed.error&&pParsed.home!==pParsed.away;
   let penaltyHint='';
   if(isKO&&score.home===score.away&&validPenalties){
     penaltyHint=`<div class="match-penalty-status ok">⚽ Rigori inseriti: <strong>${pParsed.home}-${pParsed.away}</strong> · Vince ${pParsed.home>pParsed.away?UI.esc(home):UI.esc(away)}</div>`;
   } else if(needsPenalties){
     penaltyHint=`<div class="match-penalty-status warn">⚠ Pareggio ${score.home}-${score.away} in fase a eliminazione diretta: inserisci i rigori nel pannello "Info partita" prima di chiudere.</div>`;
   }
   return `<article class="match-command-center ${isLive?'is-live-card':''}">
      <div class="match-command-hero"><span class="pill">${UI.esc(matchPhaseLabel(m))} · ${UI.esc(m.round)}</span><h3>${UI.esc(home)} <span>vs</span> ${UI.esc(away)}</h3><p>${UI.esc(d.field||'Campo da inserire')} · ${UI.esc(d.date||'Data da inserire')} ${UI.esc(d.time||'')}</p><strong class="score-badge match-status-badge ${meta.cls}" role="status">${isLive?'🔴 ':''}${UI.esc(meta.label)}</strong>${dirty?'<small class="draft-status">Modifiche non salvate</small>':''}</div>
      ${penaltyHint}
      <div class="match-action-grid">
        <button class="match-action-card" type="button" data-open-match-panel="info"><span>🗓️</span><strong>Info partita</strong><small>Campo, arbitro, data, orario${isKO?', rigori':''} e ${isLive?'<em>partita Live attiva</em>':'stato Live'}.</small></button>
        <button class="match-action-card" type="button" data-open-match-panel="goals" ${real?'':'disabled'}><span>⚽</span><strong>Marcatori</strong><small>Gol, autogol, peso Kings League e risultato.</small></button>
        <button class="match-action-card" type="button" data-open-match-panel="cards" ${real?'':'disabled'}><span>🟨</span><strong>Cartellini</strong><small>Gialli e rossi dei calciatori.</small></button>
      </div>
      <div class="match-context-savebar ${isLive?'is-live-mode':''}" aria-label="Azioni finali referto">
        <div class="match-context-savebar-head"><strong>Azioni</strong><small>${isLive?'<strong style="color:#fdba74">Partita Live attiva.</strong> Usa "Aggiorna Live" per propagare il punteggio senza chiuderla, oppure "Salva tutto" per concluderla.':'Usale dopo aver completato Info partita, Marcatori e Cartellini.'}</small></div>
        <div class="match-context-savebar-actions">
          ${isLive?'<button class="btn live-update-btn" type="button" data-update-live-context>🔴 Aggiorna Live</button>':''}
          <button class="btn primary match-save-only" type="button" data-save-match-context>${isLive?'✓ Salva tutto (concludi)':'Salva tutto'}</button>
        </div>
        <small class="match-context-help">Per pulire il referto usa il pulsante Pulisci sulla card della partita nell’elenco.</small>
      </div>
    </article>`;
 }

 function clearReportForMatch(matchId, opts={}){
   if(!matchId)return false;
   const state=A.state();
   const match=state.matches.find(x=>x.id===matchId);
   if(!match)return false;
   const label=`${store.teamName(state,match.homeTeamId,match.homeLabel)} vs ${store.teamName(state,match.awayTeamId,match.awayLabel)}`;
   const ok=confirm(`Pulire il referto di ${label}?\n\nVerranno eliminati marcatori, autogol e cartellini. La partita tornerà a “Da giocare”. Campo, arbitro, data e orario resteranno invariati.`);
   if(!ok)return false;
   reportDrafts.delete(matchId);
   suppressNextDraftSync=true;
   const body=UI.$('#matchTaskBody');
   if(selectedMatch===matchId && body) body.innerHTML='<div class="empty">Referto pulito. Aggiorno la partita...</div>';
   A.commit(s=>{
     const m=s.matches.find(x=>x.id===matchId);
     if(!m)return;
     m.goals=[];
     m.cards=[];
     m.status='scheduled';
     m.penalties=null;
   });
   render();
   if(UI.$('#matchListModal')?.classList.contains('open')){
     UI.$('#matchListBody').innerHTML=matchListHtml(A.state(),currentList());
   }
   if(selectedMatch===matchId && UI.$('#matchTaskModal')?.classList.contains('open')){
     openMatchPanel('menu');
   }
   return true;
 }

 function clearAllReports(){
   syncOpenTaskDraft();
   const state=A.state();
   const matches=(state.matches||[]);
   const dirty=matches.filter(m=>hasReportData(state,m)||(reportDrafts.has(m.id)&&hasUnsavedDraft(m)));
   if(!matches.length){alert('Non ci sono partite da pulire.');return false;}
   if(!dirty.length){alert('Non ci sono referti da pulire.');return false;}
   const ok=confirm(`Pulire tutti i referti?\n\nVerranno eliminati marcatori, autogol e cartellini da ${dirty.length} partita/e. Tutte le partite torneranno a “Da giocare”. Campo, arbitro, data e orario resteranno invariati.`);
   if(!ok)return false;
   reportDrafts.clear();
   suppressNextDraftSync=true;
   A.commit(s=>{
     (s.matches||[]).forEach(m=>{
       m.goals=[];
       m.cards=[];
       m.status='scheduled';
       m.penalties=null;
     });
   });
   selectedMatch='';
   closeMatchTaskModal({force:true});
   render();
   if(UI.$('#matchListModal')?.classList.contains('open')){
     UI.$('#matchListBody').innerHTML=matchListHtml(A.state(),currentList());
   }
   alert('Referti puliti. Tutte le partite sono tornate a Da giocare.');
   return true;
 }


 function resetAllReferees(){
   syncOpenTaskDraft();
   const state=A.state();
   const matches=(state.matches||[]);
   if(!matches.length){alert('Non ci sono partite.');return false;}
   const withRef=matches.filter(m=>String(m.referee||'').trim() && String(m.referee||'').trim().toLowerCase()!=='da definire');
   if(!withRef.length){alert('Tutti gli arbitri risultano già “Da definire”.');return false;}
   const ok=confirm(`Riportare tutti gli arbitri a “Da definire”?

Verrà svuotato il campo arbitro in ${withRef.length} partita/e. Campo, data, orario e referti non verranno modificati.`);
   if(!ok)return false;
   reportDrafts.forEach(d=>{d.referee='';});
   suppressNextDraftSync=true;
   A.commit(s=>{(s.matches||[]).forEach(m=>{m.referee='';});});
   render();
   if(UI.$('#matchListModal')?.classList.contains('open')){
     UI.$('#matchListBody').innerHTML=matchListHtml(A.state(),currentList());
   }
   if(selectedMatch && UI.$('#matchTaskModal')?.classList.contains('open')) openMatchPanel(currentTaskMode||'menu');
   alert('Arbitri riportati a Da definire.');
   return true;
 }

 function parsePenaltiesFromDraft(d){
   const h=String(d.penaltiesHome||'').trim();
   const a=String(d.penaltiesAway||'').trim();
   if(h===''&&a==='')return null;          // nessun rigore inserito
   const nh=Number(h), na=Number(a);
   if(!Number.isInteger(nh)||nh<0||!Number.isInteger(na)||na<0||nh>99||na>99)return {error:'Inserisci numeri interi validi (0–99) per i rigori.'};
   if(h===''||a==='')return {error:'Inserisci entrambi i punteggi dei rigori (casa e ospite).'};
   return {home:nh,away:na};
 }
 function persistMatchContext(s0, draft, finalStatus){
   // Calcolo punteggio finale per validare i rigori
   const m0=s0.matches.find(x=>x.id===selectedMatch);
   if(!m0)return false;
   const safeGoals=(draft.goals||[]).filter(g=>{
     if(g.ownGoal)return g.teamId===m0.homeTeamId||g.teamId===m0.awayTeamId;
     const participant=store.getParticipant(s0,g.playerId);
     return Boolean(participant&&[m0.homeTeamId,m0.awayTeamId].includes(participant.team.id)&&(!store.isPresidentId(s0,g.playerId)||isPresidentScorerAllowed(s0)));
   });
   const safeCards=(draft.cards||[]).filter(c=>c.playerId&&!store.isPresidentId(s0,c.playerId));
   const draftMatch={...m0,goals:safeGoals.map(g=>g.ownGoal?{ownGoal:true,teamId:g.teamId,playerId:'',weight:1,minute:g.minute}:{playerId:g.playerId,weight:g.weight||1,minute:g.minute})};
   const score=store.matchGoals(s0,draftMatch);
   const isKO=store.isKnockoutPhase&&store.isKnockoutPhase(m0)&&m0.homeTeamId&&m0.awayTeamId;

   const pParsed=parsePenaltiesFromDraft(draft);
   let penalties=null;
   if(pParsed&&!pParsed.error) penalties=pParsed;

   if(finalStatus==='played'&&isKO&&score.home===score.away){
     if(pParsed&&pParsed.error){alert('Rigori non validi: '+pParsed.error); return false;}
     if(!penalties){alert('Partita di fase a eliminazione diretta finita in parità (' + score.home + '-' + score.away + '). Inserisci i rigori prima di chiudere la partita come "Giocata".'); return false;}
     if(penalties.home===penalties.away){alert('I rigori non possono finire in parità ('+penalties.home+'-'+penalties.away+'). Una squadra deve qualificarsi.'); return false;}
   }
   if(score.home!==score.away||!isKO) penalties=null;
   else if(pParsed&&pParsed.error&&finalStatus!=='played') penalties=null;

   A.commit(s=>{
     const m=s.matches.find(x=>x.id===selectedMatch);if(!m)return;
     m.field=(draft.field||'').trim();
     m.referee=(draft.referee||'').trim();
     m.date=(draft.date||'').trim ? (draft.date||'').trim() : (draft.date||'');
     m.time=(draft.time||'').trim ? (draft.time||'').trim() : (draft.time||'');
     m.datetime=m.date&&m.time?`${m.date}T${m.time}`:'';
     m.goals=safeGoals.map(g=>g.ownGoal?{id:g.id||store.uid('goal'),ownGoal:true,teamId:g.teamId,playerId:'',weight:1,...(Number.isInteger(Number(g.minute))&&Number(g.minute)>0?{minute:Number(g.minute)}:{})}:{id:g.id||store.uid('goal'),playerId:g.playerId,weight:isKings(s)&&Number(g.weight)===2&&!store.isPresidentId(s,g.playerId)?2:1,...(Number.isInteger(Number(g.minute))&&Number(g.minute)>0?{minute:Number(g.minute)}:{})});
     m.cards=safeCards.map(c=>({id:store.uid('card'),playerId:c.playerId,type:c.type==='red'?'red':'yellow',...(Number.isInteger(Number(c.minute))&&Number(c.minute)>0?{minute:Number(c.minute)}:{})}));
     m.status=finalStatus;
     m.penalties=penalties;
   });
   draft.status=finalStatus;
   if(penalties){draft.penaltiesHome=String(penalties.home);draft.penaltiesAway=String(penalties.away);}
   else {draft.penaltiesHome='';draft.penaltiesAway='';}
   return true;
 }

 // SALVA TUTTO: conclude la partita come "Giocata" (entra in classifica e marcatori)
 function saveMatchContext(){
   syncOpenTaskDraft();
   const s0=A.state(), m0=s0.matches.find(x=>x.id===selectedMatch); if(!m0)return;
   const draft=getReportDraft(m0);
   const wasLive = draft.status==='live' || m0.status==='live';
   // Conferma una sola volta che la partita è davvero conclusa
   if(wasLive){
     const finished = confirm('Vuoi concludere la partita?\n\nOK = Sì, segna come "Giocata" (entra in classifica e marcatori)\nAnnulla = No, mantienila ancora Live');
     if(!finished){
       // Annullato: non chiudo. Se l'utente voleva solo aggiornare il live, deve usare "Aggiorna Live".
       return;
     }
   }
   const ok = persistMatchContext(s0, draft, 'played');
   if(!ok) return;
   reportDrafts.delete(selectedMatch);
   // Re-render istantaneo della UI corrente per riflettere subito il nuovo status
   render();
   // Riapri la schermata corrente con i dati aggiornati invece di aspettare la chiusura del modale
   if(UI.$('#matchTaskModal')?.classList.contains('open')){
     openMatchPanel('menu');
   }
 }

 // AGGIORNA LIVE: salva il punteggio/info parziali e lascia la partita "Live".
 // Non chiede conferma. Propaga il punteggio a tutti i client e triggera le notifiche.
 // Opzioni: {silent} per evitare di riaprire la schermata menu (usato dal "primo click Live").
 function updateLiveContext(opts={}){
   syncOpenTaskDraft();
   const s0=A.state(), m0=s0.matches.find(x=>x.id===selectedMatch); if(!m0)return;
   const draft=getReportDraft(m0);
   // Forza status live, indipendentemente da cosa diceva il draft.
   draft.status='live';
   const ok = persistMatchContext(s0, draft, 'live');
   if(!ok) return;
   // Mantengo il draft in memoria così l'admin può continuare a editare senza perdere lo stato corrente.
   reportDrafts.set(selectedMatch, draft);
   render();
   if(!opts.silent){
     if(UI.$('#matchTaskModal')?.classList.contains('open')){
       openMatchPanel('menu');
     }
   }
   // Feedback piccolo, non blocking
   try{ const el=UI.$('#matchTaskTitle'); if(el){const old=el.textContent; el.textContent='🔴 Live aggiornato'; setTimeout(()=>{el.textContent=old;},1400);}}catch(_){}
 }

 function renderEditor(){
   const box=UI.$('#matchEditor'); if(!box)return;
   box.innerHTML=selectedMatch?'<div class="empty">Partita selezionata. Usa la finestra aperta per gestirla, oppure clicca un’altra partita.</div>':'<div class="empty">Seleziona una partita: la gestione si aprirà in una schermata dedicata.</div>';
 }


 function openMatchFromQuery(){
   const id=new URLSearchParams(location.search).get('match');
   if(!id)return;
   const s=A.state();
   const m=s.matches.find(x=>x.id===id);
   if(!m)return;
   selectedMatch=m.id;
   teamFilter=m.homeTeamId||m.awayTeamId||'';
   render();
   setTimeout(()=>openMatchPanel('menu'),80);
 }
 function render(){renderTeamButtons(); renderRoundFilter(); renderMatchList(); renderEditor();}
 document.addEventListener('DOMContentLoaded',()=>{render();openMatchFromQuery();});
 document.addEventListener('click',e=>{
   const team=e.target.closest('[data-match-team]');
   if(team){teamFilter=team.dataset.matchTeam;selectedMatch='';render();openTeamMatchesModal();return;}
   if(e.target.id==='openTeamMatchesBtn'){openTeamMatchesModal();return;}
   const clearAll=e.target.closest('[data-clear-all-reports]');
   if(clearAll){e.preventDefault();clearAllReports();return;}
   const resetRefs=e.target.closest('[data-reset-all-referees]');
   if(resetRefs){e.preventDefault();resetAllReferees();return;}
   const clearInline=e.target.closest('[data-clear-report-match]');
   if(clearInline){e.preventDefault();e.stopPropagation();clearReportForMatch(clearInline.dataset.clearReportMatch);return;}
   const match=e.target.closest('[data-select-match]');
   if(match){selectedMatch=match.dataset.selectMatch;render();closeMatchListModal();openMatchPanel('menu');return;}
   const panel=e.target.closest('[data-open-match-panel]');if(panel){syncOpenTaskDraft();openMatchPanel(panel.dataset.openMatchPanel);return;}
   if(e.target.id==='closeMatchListModal')closeMatchListModal();
   if(e.target.id==='matchListModal'){e.preventDefault();e.stopPropagation();closeMatchListModal();}
   if(e.target.id==='closeMatchTaskModal')closeMatchTaskModal();
   if(e.target.id==='matchTaskModal'){e.preventDefault();e.stopPropagation();closeMatchTaskModal({force:true});}
 });
 UI.$('#adminMatchRoundFilter').addEventListener('change',e=>{roundFilter=e.target.value;selectedMatch='';render();if(teamFilter)openTeamMatchesModal();});
 document.addEventListener('submit',e=>{
   const f=e.target;
   if(f.classList.contains('match-edit-form')||f.classList.contains('report-complete-form')){
     e.preventDefault();
     // Mobile consistency: il tasto “Invio/Fine” della tastiera non deve chiudere
     // la schermata corrente né riportare al menu. I passaggi di schermata restano
     // affidati ai pulsanti espliciti.
     syncFormDraft(f);
     return;
   }
 });

 document.addEventListener('change',e=>{
   if(e.target.matches('.match-edit-form [name="isLive"]')){
     const card=e.target.closest('.live-toggle');
     if(card)card.classList.toggle('is-active',e.target.checked);
     const form=e.target.closest('.match-edit-form');
     if(form)syncFormDraft(form);
     // FIRST-CLICK LIVE SAVE: se l'utente ha appena ATTIVATO il flag Live e la partita
     // non era già 'live' nello store, salviamo subito come live (primo salvataggio implicito).
     // Gli aggiornamenti successivi useranno i bottoni "Aggiorna Live" / "Salva tutto".
     if(e.target.checked && selectedMatch){
       const s=A.state();
       const m=s.matches.find(x=>x.id===selectedMatch);
       if(m && m.status!=='live' && m.status!=='played'){
         // Trigger silenzioso di updateLiveContext: persiste status='live' senza conferme.
         updateLiveContext({silent:true});
       }
     }
     return;
   }
   const form=e.target.closest('.report-complete-form');
   if(!form)return;
   if(e.target.matches('[data-goal-team-picker]')){form.querySelector('[data-goal-player-search]').value='';updateEventPlayerPickers(form,'goal');syncQuickGoalDoublePicker(form);return;}
   if(e.target.matches('[data-card-team-picker]')){form.querySelector('[data-card-player-search]').value='';updateEventPlayerPickers(form,'card');return;}
   if(e.target.matches('[data-goal-row-player]')){
     const row=e.target.closest('.goal-draft-row');
     refreshGoalRowParticipant(A.state(),row);
     mergeDuplicateGoalRow(form,row);
     updateDraftSummary(form);syncFormDraft(form);return;
   }
   if(e.target.matches('[data-goal-player-picker]')){syncQuickGoalDoublePicker(form);return;}
   if(e.target.matches('.goal-draft-row [name="goalNormalCount"],.goal-draft-row [name="goalDoubleCount"]')){updateDraftSummary(form);syncFormDraft(form);}
 });
 document.addEventListener('input',e=>{
   const info=e.target.closest('.match-edit-form');
   if(info){syncFormDraft(info);return;}
   const form=e.target.closest('.report-complete-form');
   if(!form)return;
   if(e.target.matches('[data-goal-player-search]')){updateEventPlayerPickers(form,'goal');return;}
   if(e.target.matches('[data-card-player-search]')){updateEventPlayerPickers(form,'card');return;}
   if(e.target.matches('[data-goal-normal-count-picker],[data-goal-double-count-picker]')){
     const value=Math.max(0,Math.min(99,Number(e.target.value)||0));
     if(String(e.target.value)!==String(value))e.target.value=String(value);
     syncQuickGoalDoublePicker(form);return;
   }
   if(e.target.matches('.goal-draft-row [name="goalNormalCount"],.goal-draft-row [name="goalDoubleCount"]')){
     const value=Math.max(0,Math.min(99,Number(e.target.value)||0));
     if(String(e.target.value)!==String(value))e.target.value=String(value);
     updateDraftSummary(form);syncFormDraft(form);return;
   }
 });
 document.addEventListener('click',e=>{
   const addGoal=e.target.closest('[data-add-goal-row]');
   const addCard=e.target.closest('[data-add-card-row]');
   const remove=e.target.closest('[data-remove-draft-row]');
   const saveContext=e.target.closest('[data-save-match-context]');
   if(saveContext){
     e.preventDefault();
     saveMatchContext();
     return;
   }
   const updateLive=e.target.closest('[data-update-live-context]');
   if(updateLive){
     e.preventDefault();
     updateLiveContext();
     return;
   }
   const clearReport=e.target.closest('[data-clear-report]');
   if(clearReport){
     e.preventDefault();
     const form=clearReport.closest('.report-complete-form');
     const matchId=form?.dataset.matchId || selectedMatch;
     clearReportForMatch(matchId);
     return;
   }
   if(addGoal){
     const form=addGoal.closest('.report-complete-form'), s=A.state(), box=form.querySelector('[data-goal-rows]');
     const picker=form.querySelector('[data-goal-player-picker]');
     const picked=picker?.value||'';
     let normalCount=Math.max(0,Math.min(99,Number(form.querySelector('[data-goal-normal-count-picker]')?.value)||0));
     let doubleCount=Math.max(0,Math.min(99,Number(form.querySelector('[data-goal-double-count-picker]')?.value)||0));
     const match=s.matches.find(x=>x.id===form.dataset.matchId);
     if(!picked){alert('Seleziona marcatore o autogol.');return;}
     if(!match){alert('Partita non disponibile.');return;}
     let existing=null;
     if(isOwnGoalValue(picked)){
       doubleCount=0;
       if(normalCount<1){alert('Inserisci almeno un autogol.');return;}
       const teamId=ownGoalTeamFromValue(picked);
       if(teamId!==match.homeTeamId&&teamId!==match.awayTeamId){alert('Autogol non valido per questa partita.');return;}
       box.querySelector('[data-empty-goals]')?.remove();
       existing=Array.from(box.querySelectorAll('.goal-draft-row')).find(row=>goalRowIdentity(row)===`own:${teamId}`);
       if(existing){
         const input=existing.querySelector('[name="goalNormalCount"]');
         if(input)input.value=String(Math.min(99,(Number(input.value)||0)+normalCount));
       }else box.insertAdjacentHTML('beforeend',goalDraftItem(s,match,{ownGoal:true,teamId,normalCount,doubleCount:0}));
     } else {
       const playerId=picked;
       if(store.isPresidentId(s,playerId)&&!isPresidentScorerAllowed(s)){alert('Fuori dalla Kings League il presidente non può essere selezionato come marcatore.');return;}
       const participant=store.getParticipant(s,playerId);
       if(!participant||![match.homeTeamId,match.awayTeamId].includes(participant.team.id)){alert('Il marcatore non appartiene alle squadre della partita.');return;}
       if(participant.type==='president'||!isKings(s)){normalCount+=doubleCount;doubleCount=0;}
       if(normalCount+doubleCount<1){alert('Inserisci almeno un gol normale, doppio o del presidente.');return;}
       box.querySelector('[data-empty-goals]')?.remove();
       existing=Array.from(box.querySelectorAll('.goal-draft-row')).find(row=>goalRowIdentity(row)===`player:${playerId}`);
       if(existing){
         const normalInput=existing.querySelector('[name="goalNormalCount"]');
         const doubleInput=existing.querySelector('[name="goalDoubleCount"]');
         if(normalInput)normalInput.value=String(Math.min(99,(Number(normalInput.value)||0)+normalCount));
         if(doubleInput)doubleInput.value=String(Math.min(99,(Number(doubleInput.value)||0)+doubleCount));
         refreshGoalRowParticipant(s,existing);
       } else box.insertAdjacentHTML('beforeend',goalDraftItem(s,match,{playerId,normalCount,doubleCount}));
     }
     picker.value='';
     form.querySelector('[data-goal-player-search]').value='';
     const normalPicker=form.querySelector('[data-goal-normal-count-picker]');if(normalPicker)normalPicker.value='1';
     const doublePicker=form.querySelector('[data-goal-double-count-picker]');if(doublePicker)doublePicker.value='0';
     updateEventPlayerPickers(form,'goal');syncQuickGoalDoublePicker(form);
     updateDraftSummary(form);syncFormDraft(form);
   }
   if(addCard){
     const form=addCard.closest('.report-complete-form'), s=A.state(), box=form.querySelector('[data-card-rows]');
     const picker=form.querySelector('[data-card-player-picker]');
     const typePicker=form.querySelector('[data-card-type-picker]');
     const playerId=picker?.value;
     const type=typePicker?.value==='red'?'red':'yellow';
     if(!playerId){alert('Seleziona prima il calciatore.');return;}
     if(store.isPresidentId(s,playerId)){alert('Il presidente non può ricevere cartellini.');return;}
     box.querySelector('[data-empty-cards]')?.remove();
     box.insertAdjacentHTML('beforeend',cardDraftItem(s,playerId,type));
     picker.value='';
     form.querySelector('[data-card-player-search]').value='';
     updateEventPlayerPickers(form,'card');
     typePicker.value='yellow';
     updateDraftSummary(form);syncFormDraft(form);
   }
   if(remove){
     const form=remove.closest('.report-complete-form');
     remove.closest('[data-event-item]')?.remove();
     const goals=form.querySelector('[data-goal-rows]');
     const cards=form.querySelector('[data-card-rows]');
     if(goals && !goals.querySelector('.goal-draft-row')) goals.innerHTML=emptyGoals();
     if(cards && !cards.querySelector('.card-draft-row')) cards.innerHTML=emptyCards();
     updateDraftSummary(form);syncFormDraft(form);
   }
 });


 // Realtime: re-render quando lo stato admin arriva aggiornato da un altro client
 window.NexoraAdminRefresh=function(){
   // Conserva selezioni correnti; ripulisci draft solo per match non più esistenti
   const s=A.state();
   const liveMatchIds=new Set((s.matches||[]).map(m=>m.id));
   for(const id of Array.from(reportDrafts.keys())){
     if(!liveMatchIds.has(id))reportDrafts.delete(id);
   }
   render();
   // Se è aperto un modale, ri-render del contenuto corrente
   if(UI.$('#matchListModal')?.classList.contains('open')){
     const team=store.getTeam(s,teamFilter);
     UI.$('#matchListTitle').textContent=`Partite · ${team?.name||'Squadra'}`;
     UI.$('#matchListBody').innerHTML=matchListHtml(s,currentList());
   }
   if(UI.$('#matchTaskModal')?.classList.contains('open') && selectedMatch && liveMatchIds.has(selectedMatch)){
     // Se l'utente sta editando un form, non gli sovrascriviamo il form aperto:
     // aggiorniamo SOLO i select dei giocatori (così nuovi giocatori aggiunti
     // da admin-players su un'altra tab compaiono subito senza perdere i dati editati).
     const reportForm=document.querySelector('.report-complete-form');
     if(reportForm){
       updateEventPlayerPickers(reportForm,'goal');
       updateEventPlayerPickers(reportForm,'card');
       return;
     }
     const matchEditForm=document.querySelector('.match-edit-form');
     if(matchEditForm && currentTaskMode!=='menu'){
       // form info aperto: non lo tocco, niente refresh
       return;
     }
     openMatchPanel(currentTaskMode||'menu');
   }
 };
 window.addEventListener('ng:admin-state-loaded',()=>window.NexoraAdminRefresh());
})();
