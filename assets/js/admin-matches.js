(function(){
 const store=NexoraStore, UI=NexoraUI, A=NexoraAdmin;
 let teamFilter='', roundFilter='', selectedMatch='', currentTaskMode='menu', previousTaskMode='menu';
 const reportDrafts=new Map();
 let suppressNextDraftSync=false;
 let pendingUndo=null;
 let taskFocusReturn=null;
 let pendingZeroConfirmationMatchId='';
 let saveNotice=null;
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
 function participantChoicesForTeam(state,teamId,search='',kind='goal',match=null){
   const q=String(search||'').trim().toLowerCase();
   const allowedTeamIds=(teamId?[teamId]:[match?.homeTeamId,match?.awayTeamId]).filter(Boolean);
   const teams=allowedTeamIds.map(id=>store.getTeam(state,id)).filter(Boolean);
   const people=[];
   teams.forEach(team=>{
     (team.players||[]).forEach(p=>people.push({
       id:p.id,
       teamId:team.id,
       teamName:team.name,
       name:p.name,
       number:p.number,
       birthYear:p.birthYear,
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
   const typeOrder={player:0,president:1,'own-goal':2};
   people.sort((a,b)=>{
     if(a.teamId!==b.teamId)return allowedTeamIds.indexOf(a.teamId)-allowedTeamIds.indexOf(b.teamId);
     if(typeOrder[a.type]!==typeOrder[b.type])return typeOrder[a.type]-typeOrder[b.type];
     const an=a.type==='player'&&a.number!==''&&a.number!=null?Number(a.number):9999;
     const bn=b.type==='player'&&b.number!==''&&b.number!=null?Number(b.number):9999;
     return an-bn||String(a.name||'').localeCompare(String(b.name||''),'it');
   });
   if(!q)return people;
   if(/^\d+$/.test(q)){
     const exact=people.filter(p=>p.type==='player'&&String(p.number??'')===q);
     const prefix=people.filter(p=>p.type==='player'&&String(p.number??'').startsWith(q)&&String(p.number??'')!==q);
     return [...exact,...prefix];
   }
   return people.filter(p=>(p.searchKey||'').includes(q));
 }
 function playerOptionsForTeam(state,teamId,search='',selected='',kind='goal',match=null){
   const people=participantChoicesForTeam(state,teamId,search,kind,match);
   const first=`<option value="">${people.length?'Seleziona partecipante':'Nessun risultato'}</option>`;
   return first+people.map(p=>`<option value="${UI.esc(p.id)}" ${p.id===selected?'selected':''}>${UI.esc(p.label)}</option>`).join('');
 }
 function participantResultMarkup(person,index,kind){
   const icon=person.type==='own-goal'?'↩':(person.type==='president'?'RIG':'⚽');
   const primary=person.type==='player'?`${person.number!==''&&person.number!=null?`#${person.number} · `:''}${person.name}`:(person.type==='president'?`${person.name} · Gol (rig.)`:'Autogol');
   const secondary=person.type==='own-goal'?`Rete assegnata a ${person.teamName}`:person.teamName;
   return `<button class="participant-result" type="button" role="option" aria-selected="false" data-select-${kind}-participant="${UI.esc(person.id)}" data-result-index="${index}"><span class="participant-result-icon" aria-hidden="true">${icon}</span><span><strong>${UI.esc(primary)}</strong><small>${UI.esc(secondary)}</small></span></button>`;
 }
 function selectedParticipantMarkup(state,value){
   if(!value)return '';
   if(isOwnGoalValue(value)){
     const team=store.getTeam(state,ownGoalTeamFromValue(value));
     return `<span class="selected-participant-icon" aria-hidden="true">↩</span><span><strong>Autogol</strong><small>Rete assegnata a ${UI.esc(team?.name||'squadra')}</small></span>`;
   }
   const participant=store.getParticipant(state,value);
   if(!participant)return '';
   const number=participant.type==='player'&&participant.number!==''&&participant.number!=null?`#${participant.number} · `:'';
   return `<span class="selected-participant-icon" aria-hidden="true">${participant.type==='president'?'RIG':'⚽'}</span><span><strong>${UI.esc(`${number}${participant.name}`)}</strong><small>${UI.esc(participant.team.name)}${participant.type==='president'?' · Gol (rig.)':''}</small></span>`;
 }
 function renderParticipantResults(form,kind,{open=false}={}){
   const teamPicker=form.querySelector(`[data-${kind}-team-picker]`);
   const search=form.querySelector(`[data-${kind}-player-search]`);
   const picker=form.querySelector(`[data-${kind}-player-picker]`);
   const results=form.querySelector(`[data-${kind}-player-results]`);
   const selected=form.querySelector(`[data-${kind}-selected-participant]`);
   if(!teamPicker||!picker)return;
   const state=A.state();
   const match=state.matches.find(item=>item.id===form.dataset.matchId);
   if(!results){
     picker.innerHTML=playerOptionsForTeam(state,teamPicker.value,search?.value||'',picker.value,kind,match);
     return;
   }
   const people=participantChoicesForTeam(state,teamPicker.value,search?.value||'',kind,match).slice(0,24);
   results.innerHTML=people.length?people.map((person,index)=>participantResultMarkup(person,index,kind)).join(''):'<div class="participant-no-results" role="status">Nessun risultato tra le squadre della partita.</div>';
   results.dataset.activeIndex='-1';
   const shouldOpen=open||Boolean(search?.value?.trim());
   results.hidden=!shouldOpen;
   search?.setAttribute('aria-expanded',String(shouldOpen));
   if(selected){
     const markup=selectedParticipantMarkup(state,picker.value);
     selected.innerHTML=markup?`${markup}<button type="button" class="selected-participant-clear" data-clear-${kind}-participant aria-label="Rimuovi selezione">×</button>`:'';
     selected.hidden=!markup;
   }
   if(kind==='goal')syncQuickGoalDoublePicker(form);
 }
 function updateEventPlayerPickers(form,kind){
   renderParticipantResults(form,kind);
 }
 function selectParticipant(form,kind,value){
   const picker=form.querySelector(`[data-${kind}-player-picker]`);
   const search=form.querySelector(`[data-${kind}-player-search]`);
   const results=form.querySelector(`[data-${kind}-player-results]`);
   if(!picker)return;
   picker.value=value||'';
   if(search)search.value='';
   if(results)results.hidden=true;
   search?.setAttribute('aria-expanded','false');
   renderParticipantResults(form,kind);
   if(kind==='goal')updateAddGoalState(form);
   else if(kind==='card')updateAddCardState(form);
 }
 function syncQuickGoalDoublePicker(form){
   const doubleInput=form?.querySelector('[data-goal-double-count-picker]');if(!doubleInput)return;
   const normalInput=form.querySelector('[data-goal-normal-count-picker]');
   const picked=form.querySelector('[data-goal-player-picker]')?.value||'';
   const participant=store.getParticipant(A.state(),picked);
   const enabled=Boolean(isKings(A.state())&&participant&&participant.type==='player');
   const doubleControl=doubleInput.closest('[data-goal-double-control]');
   doubleInput.disabled=!enabled;
   doubleControl?.classList.toggle('is-disabled',!enabled);
   doubleControl?.querySelectorAll('button').forEach(button=>button.disabled=!enabled);
   doubleInput.value=enabled?String(Math.max(0,Math.min(99,Number(doubleInput.value)||0))):'0';
   if(normalInput){
     normalInput.value=String(Math.max(0,Math.min(99,Number(normalInput.value)||0)));
     const label=form.querySelector('[data-goal-normal-label]');
     if(label)label.textContent=participant?.type==='president'?'Gol (rig.)':(isOwnGoalValue(picked)?'Autogol':'Gol normali');
   }
   updateAddGoalState(form);
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
 function quantityStepperHtml({name='',dataAttr='',value=0,label='',labelAttr='',ariaLabel='',help='',disabled=false,controlAttr=''}){
   const attrs=[name?`name="${name}"`:'',dataAttr,`value="${Math.max(0,Math.min(99,Number(value)||0))}"`].filter(Boolean).join(' ');
   return `<div class="goal-quantity-control ${disabled?'is-disabled':''}" ${controlAttr}>
     <label ${labelAttr}>${UI.esc(label)}</label>
     <div class="number-stepper" data-number-stepper>
       <button type="button" data-step="-1" aria-label="Diminuisci ${UI.esc(ariaLabel||label)}" ${disabled?'disabled':''}>−</button>
       <input ${attrs} type="number" min="0" max="99" step="1" inputmode="numeric" aria-label="${UI.esc(ariaLabel||label)}" ${disabled?'disabled':''}>
       <button type="button" data-step="1" aria-label="Aumenta ${UI.esc(ariaLabel||label)}" ${disabled?'disabled':''}>+</button>
     </div>
     ${help?`<small>${UI.esc(help)}</small>`:''}
   </div>`;
 }
 function goalDraftTeamId(state,g){
   if(g?.ownGoal)return g.teamId||'';
   return store.getParticipant(state,g?.playerId)?.team?.id||'';
 }
 function scorerGroupShell(state,match,teamId){
   const team=store.getTeam(state,teamId);
   return `<section class="scorer-team-group" data-goal-team-group="${UI.esc(teamId)}" hidden>
     <header class="scorer-team-group-head"><div>${team?UI.logo(team,false):''}<span><strong>${UI.esc(team?.name||'Squadra')}</strong><small><b data-team-scorer-count>0</b> marcatori/eventi</small></span></div><span class="scorer-team-total">Totale <b data-team-score>0</b></span></header>
     <div class="scorer-team-rows" data-goal-team-rows="${UI.esc(teamId)}"></div>
   </section>`;
 }
 function goalGroupsShell(state,match){
   return `<div class="scorer-groups">${[match.homeTeamId,match.awayTeamId].filter(Boolean).map(teamId=>scorerGroupShell(state,match,teamId)).join('')}</div>`;
 }
 function scorerIdentityMarkup(state,participant,isPresident=false){
   const number=participant?.type==='player'&&participant.number!==''&&participant.number!=null?`#${participant.number} · `:'';
   return `<strong class="scorer-display-name">${UI.esc(`${number}${participant?.name||'Giocatore'}`)}</strong><small>${UI.esc(participant?.team?.name||'Squadra')}${isPresident?' · Classifica presidenti separata':''}</small>`;
 }
 function goalDraftItem(state,match,arg,weight=1){
   const g=(arg&&typeof arg==='object')?arg:{playerId:arg,normalCount:Number(weight)===2?0:1,doubleCount:Number(weight)===2?1:0};
   const legacyCount=Math.max(0,Math.min(99,Number(g.count)||0));
   const legacyDouble=Math.max(0,Math.min(legacyCount,Number(g.doubleCount ?? (Number(g.weight)===2?legacyCount:0))||0));
   let normalCount=Math.max(0,Math.min(99,Number(g.normalCount ?? (legacyCount-legacyDouble))||0));
   let doubleCount=Math.max(0,Math.min(99,Number(g.doubleCount ?? legacyDouble)||0));
   if(!normalCount&&!doubleCount)normalCount=1;
   const singleMinutesValue=UI.esc(JSON.stringify(Array.isArray(g.singleMinutes)?g.singleMinutes:[]));
   const doubleMinutesValue=UI.esc(JSON.stringify(Array.isArray(g.doubleMinutes)?g.doubleMinutes:[]));
   const singleIdsValue=UI.esc(JSON.stringify(Array.isArray(g.singleIds)?g.singleIds:[]));
   const doubleIdsValue=UI.esc(JSON.stringify(Array.isArray(g.doubleIds)?g.doubleIds:[]));
   if(g.ownGoal){
     const teamId=g.teamId||'';
     const team=store.getTeam(state,teamId);
     if(!team)return '';
     return `<article class="goal-draft-row scorer-card is-own-goal-scorer" data-event-item data-own-goal-team="${UI.esc(teamId)}" data-scorer-team="${UI.esc(teamId)}">
      <input type="hidden" name="goalOwnGoal" value="1">
      <input type="hidden" name="goalTeamId" value="${UI.esc(teamId)}">
      <input type="hidden" name="goalPlayerId" value="">
      <input type="hidden" name="goalDoubleCount" value="0">
      <input type="hidden" name="goalSingleMinutes" value="${singleMinutesValue}">
      <input type="hidden" name="goalDoubleMinutes" value="[]">
      <input type="hidden" name="goalSingleIds" value="${singleIdsValue}">
      <input type="hidden" name="goalDoubleIds" value="[]">
      <header class="scorer-card-head"><span class="event-icon" aria-hidden="true">↩</span><div class="scorer-editor-main"><span class="scorer-kind">Autogol</span><strong class="scorer-display-name">Autogol a favore di ${UI.esc(team.name||'squadra')}</strong><small>Attribuito alla squadra, senza classifica marcatore.</small></div><div class="scorer-card-actions"><button class="btn small danger scorer-remove-btn" type="button" data-remove-draft-row aria-label="Elimina autogol">Elimina</button></div></header>
      <div class="scorer-card-controls">${quantityStepperHtml({name:'goalNormalCount',value:normalCount,label:'Autogol',ariaLabel:'numero di autogol'})}</div>
     </article>`;
   }
   const playerId=g.playerId;
   if(store.isPresidentId(state,playerId)&&!isPresidentScorerAllowed(state))return '';
   const participant=store.getParticipant(state,playerId);
   if(!participant)return '';
   const isPresident=participant.type==='president';
   if(isPresident){normalCount=Math.max(1,normalCount+doubleCount);doubleCount=0;}
   const teamId=participant.team.id;
   const doubleField=isKings(state)&&!isPresident
     ?quantityStepperHtml({name:'goalDoubleCount',value:doubleCount,label:'Gol doppi',ariaLabel:'numero di gol doppi',help:'Valgono 2 nel risultato e 1 nella classifica marcatori.'})
     :'<input type="hidden" name="goalDoubleCount" value="0">';
   return `<article class="goal-draft-row scorer-card ${isPresident?'is-president-scorer':''}" data-event-item data-scorer-team="${UI.esc(teamId)}">
    <input type="hidden" name="goalOwnGoal" value="0">
    <input type="hidden" name="goalTeamId" value="">
    <input type="hidden" name="goalSingleMinutes" value="${singleMinutesValue}">
    <input type="hidden" name="goalDoubleMinutes" value="${doubleMinutesValue}">
    <input type="hidden" name="goalSingleIds" value="${singleIdsValue}">
    <input type="hidden" name="goalDoubleIds" value="${doubleIdsValue}">
    <header class="scorer-card-head"><span class="event-icon" aria-hidden="true">${isPresident?'RIG':'⚽'}</span><div class="scorer-editor-main"><span class="scorer-kind">${isPresident?'Presidente':'Giocatore'}</span>${scorerIdentityMarkup(state,participant,isPresident)}</div><div class="scorer-card-actions"><button class="btn small" type="button" data-toggle-scorer-player aria-expanded="false">Modifica</button><button class="btn small danger scorer-remove-btn" type="button" data-remove-draft-row aria-label="Elimina ${UI.esc(participant.name)}">Elimina</button></div></header>
    <div class="scorer-player-editor" data-scorer-player-editor hidden><label>Cambia giocatore associato</label><div><select name="goalPlayerId" data-goal-row-player aria-label="Modifica marcatore">${matchGoalPlayerOptions(state,match,playerId)}</select><button class="btn small" type="button" data-cancel-scorer-player>Chiudi modifica</button></div></div>
    <div class="scorer-card-meta"><span><small>Maglia</small><output data-goal-jersey>${UI.esc(participantNumber(state,playerId)||'—')}</output></span><span><small>Squadra</small><strong>${UI.esc(participant.team.name)}</strong></span></div>
    <div class="scorer-card-controls">${quantityStepperHtml({name:'goalNormalCount',value:normalCount,label:isPresident?'Gol (rig.)':'Gol normali',ariaLabel:isPresident?'numero di gol del presidente':'numero di gol normali'})}${doubleField}</div>
   </article>`;
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
     pendingZeroConfirmationMatchId='';
     updateSectionDraftIndicator(form);
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
   pendingZeroConfirmationMatchId='';
   updateSectionDraftIndicator(form);
 }
 function syncOpenTaskDraft(){
   document.querySelectorAll('.match-edit-form,.report-complete-form').forEach(syncFormDraft);
 }
 function canonicalGoalDrafts(goals){
   return (goals||[]).map(g=>g?.ownGoal
     ? `own|${String(g.teamId||'')}|1|${Number(g.minute)||0}`
     : `player|${String(g.playerId||'')}|${Number(g.weight)===2?2:1}|${Number(g.minute)||0}`
   ).sort();
 }
 function canonicalCardDrafts(cards){
   return (cards||[]).map(c=>`${String(c?.playerId||'')}|${c?.type==='red'?'red':'yellow'}|${Number(c?.minute)||0}`).sort();
 }
 function normalizedDraftStatus(value){return ['scheduled','live','played'].includes(value)?value:'scheduled';}
 function draftChangeSet(m,draft=null){
   if(!m)return {info:false,goals:false,cards:false,penalties:false,status:false,report:false,any:false,infoOnly:false};
   const d=draft||getReportDraft(m),base=draftFromMatch(m);
   const clean=v=>String(v??'').trim();
   const info=['field','referee','date','time'].some(key=>clean(d[key])!==clean(base[key]));
   const goals=JSON.stringify(canonicalGoalDrafts(d.goals))!==JSON.stringify(canonicalGoalDrafts(base.goals));
   const cards=JSON.stringify(canonicalCardDrafts(d.cards))!==JSON.stringify(canonicalCardDrafts(base.cards));
   const penalties=clean(d.penaltiesHome)!==clean(base.penaltiesHome)||clean(d.penaltiesAway)!==clean(base.penaltiesAway);
   const status=normalizedDraftStatus(d.status)!==normalizedDraftStatus(base.status);
   const report=goals||cards||penalties;
   const any=info||report||status;
   return {info,goals,cards,penalties,status,report,any,infoOnly:info&&!report&&!status};
 }
 function hasUnsavedDraft(m){return Boolean(m&&reportDrafts.has(m.id)&&draftChangeSet(m,reportDrafts.get(m.id)).any);}
 function hasDraftReportContent(draft){
   const d=draft||{};
   return Boolean((d.goals||[]).length||(d.cards||[]).length||String(d.penaltiesHome||'').trim()||String(d.penaltiesAway||'').trim());
 }
 function draftSectionLabels(changes){
   const labels=[];
   if(changes.info)labels.push('Info');
   if(changes.goals)labels.push('Marcatori');
   if(changes.cards)labels.push('Cartellini');
   if(changes.penalties)labels.push('Rigori');
   if(changes.status)labels.push('Stato partita');
   return [...new Set(labels)];
 }
 function savePlanForMatch(state,m,draft){
   const changes=draftChangeSet(m,draft);
   const score=draftScoreFromDraft(state,m,draft);
   const goals=(draft.goals||[]).length,cards=(draft.cards||[]).length;
   const penaltiesEntered=Boolean(String(draft.penaltiesHome||'').trim()||String(draft.penaltiesAway||'').trim());
   const draftLive=normalizedDraftStatus(draft.status)==='live';
   const wasLive=normalizedDraftStatus(m.status)==='live';
   const wasPlayed=normalizedDraftStatus(m.status)==='played';
   const emptySport=goals===0&&cards===0&&!penaltiesEntered;
   const reportContent=hasDraftReportContent(draft);
   const isKO=Boolean(store.isKnockoutPhase&&store.isKnockoutPhase(m)&&m.homeTeamId&&m.awayTeamId);
   const parsedPenalties=parsePenaltiesFromDraft(draft);
   const penaltiesValid=Boolean(parsedPenalties&&!parsedPenalties.error&&parsedPenalties.home!==parsedPenalties.away);
   const knockoutTieBlocked=isKO&&score.home===score.away&&!penaltiesValid;
   const knockoutBlock=()=>({kind:'blocked-penalties',finalStatus:'played',label:'Rigori necessari',title:'Completa il risultato ai rigori',description:`La fase a eliminazione diretta non può essere chiusa sul ${score.home}-${score.away} senza un vincitore ai rigori. Inserisci entrambi i valori in Info partita.`,changes,score,goals,cards,disabled:true,needsZeroConfirmation:false});

   if(changes.infoOnly){
     return {kind:'info',finalStatus:normalizedDraftStatus(m.status),label:'Salva informazioni',title:'Salva soltanto le informazioni',description:'Campo, arbitro, data e orario verranno aggiornati. La partita non sarà refertata e resterà nello stato attuale.',changes,score,goals,cards,disabled:false,needsZeroConfirmation:false};
   }
   if(draftLive){
     if(wasLive&&!changes.any){
       return {kind:'noop-live',finalStatus:'live',label:'Live già aggiornato',title:'Nessuna modifica Live da salvare',description:'Per concludere la gara, apri Info partita, disattiva “Partita Live” e torna qui per il salvataggio generale.',changes,score,goals,cards,disabled:true,needsZeroConfirmation:false};
     }
     return {kind:'live',finalStatus:'live',label:wasLive?'Aggiorna partita Live':'Avvia partita Live',title:wasLive?'Aggiorna la partita Live':'Avvia la partita Live',description:'Tutte le modifiche in bozza saranno pubblicate come aggiornamento Live, senza entrare nelle classifiche definitive.',changes,score,goals,cards,disabled:false,needsZeroConfirmation:false};
   }
   if(wasPlayed){
     if(!changes.any)return {kind:'noop-played',finalStatus:'played',label:'Nessuna modifica',title:'Partita già salvata',description:'Il referto è già definitivo e non ci sono modifiche in bozza.',changes,score,goals,cards,disabled:true,needsZeroConfirmation:false};
     if(knockoutTieBlocked)return knockoutBlock();
     if(emptySport&&changes.report){
       return {kind:'played-update-zero',finalStatus:'played',label:'Conferma aggiornamento 0-0',title:'Aggiornamento a referto vuoto',description:'Le modifiche rimuovono tutti i marcatori, i cartellini e gli eventuali rigori. Prima di sostituire il referto definitivo con uno 0-0 senza eventi è richiesta una conferma esplicita.',changes,score,goals,cards,disabled:false,needsZeroConfirmation:true};
     }
     return {kind:'played-update',finalStatus:'played',label:'Salva modifiche partita',title:'Aggiorna il referto definitivo',description:'Le modifiche in bozza sostituiranno i dati attualmente salvati, mantenendo la partita nello stato Giocata.',changes,score,goals,cards,disabled:false,needsZeroConfirmation:false};
   }
   if(changes.report||changes.status||reportContent||wasLive){
     if(knockoutTieBlocked)return knockoutBlock();
     const needsZeroConfirmation=emptySport;
     return {kind:'report',finalStatus:'played',label:needsZeroConfirmation?'Conferma referto 0-0':'Salva e referta partita',title:needsZeroConfirmation?'Referto senza eventi':'Salva il referto completo',description:needsZeroConfirmation?'Non risultano marcatori, cartellini o rigori. La gara verrà chiusa sullo 0-0 soltanto dopo una conferma esplicita.':'Marcatori, cartellini, rigori e informazioni verranno salvati insieme e la gara passerà a Giocata.',changes,score,goals,cards,disabled:false,needsZeroConfirmation};
   }
   if(knockoutTieBlocked)return knockoutBlock();
   return {kind:'zero',finalStatus:'played',label:'Referta 0-0',title:'Nessuna modifica inserita',description:'Puoi comunque chiudere la partita sullo 0-0 senza cartellini. Prima del salvataggio verrà richiesta una conferma esplicita.',changes,score,goals,cards,disabled:false,needsZeroConfirmation:true};
 }
 function draftGoalRows(s,m,draft){
   const compact=compactGoalDrafts((draft.goals||[]).filter(g=>g.ownGoal||(g.playerId&&(!store.isPresidentId(s,g.playerId)||isPresidentScorerAllowed(s)))));
   if(!compact.length)return emptyGoals();
   const groups=new Map([m.homeTeamId,m.awayTeamId].filter(Boolean).map(id=>[id,[]]));
   compact.forEach(g=>{
     const teamId=goalDraftTeamId(s,g);
     if(!groups.has(teamId))groups.set(teamId,[]);
     groups.get(teamId).push(goalDraftItem(s,m,g,isKings(s)?(g.weight||1):1));
   });
   return `<div class="scorer-groups">${Array.from(groups.entries()).map(([teamId,rows])=>{
     const team=store.getTeam(s,teamId);
     return `<section class="scorer-team-group" data-goal-team-group="${UI.esc(teamId)}" ${rows.length?'':'hidden'}><header class="scorer-team-group-head"><div>${team?UI.logo(team,false):''}<span><strong>${UI.esc(team?.name||'Squadra')}</strong><small><b data-team-scorer-count>${rows.length}</b> marcatori/eventi</small></span></div><span class="scorer-team-total">Totale <b data-team-score>0</b></span></header><div class="scorer-team-rows" data-goal-team-rows="${UI.esc(teamId)}">${rows.join('')}</div></section>`;
   }).join('')}</div>`;
 }
 function draftCardRows(s,draft){return (draft.cards||[]).map(c=>cardDraftItem(s,c)).join('');}
 function goalBreakdownFromRows(state,match,rows){
   const byTeam={};
   [match?.homeTeamId,match?.awayTeamId].filter(Boolean).forEach(id=>{byTeam[id]={normal:0,double:0,president:0,own:0};});
   (rows||[]).forEach(row=>{
     const own=String(row.querySelector('[name="goalOwnGoal"]')?.value||'')==='1';
     const normal=Math.max(0,Math.min(99,Number(row.querySelector('[name="goalNormalCount"]')?.value)||0));
     const doubles=Math.max(0,Math.min(99,Number(row.querySelector('[name="goalDoubleCount"]')?.value)||0));
     if(own){
       const teamId=String(row.querySelector('[name="goalTeamId"]')?.value||'');
       if(byTeam[teamId])byTeam[teamId].own+=normal;
       return;
     }
     const participant=store.getParticipant(state,String(row.querySelector('[name="goalPlayerId"]')?.value||''));
     const teamId=participant?.team?.id;
     if(!teamId||!byTeam[teamId])return;
     if(participant.type==='president')byTeam[teamId].president+=normal+doubles;
     else{byTeam[teamId].normal+=normal;byTeam[teamId].double+=doubles;}
   });
   return byTeam;
 }
 function countDraftGoalsByTeam(state,match,form){
   const rows=Array.from(form.querySelectorAll('.goal-draft-row'));
   const goals=goalEventsFromRows(state,match,rows);
   const score=store.matchGoals(state,{...match,goals});
   return {home:score.home,away:score.away,actual:goals.length,breakdown:goalBreakdownFromRows(state,match,rows)};
 }
 function countCards(form){
   const types=new FormData(form).getAll('cardType');
   return {yellow:types.filter(t=>t==='yellow').length, red:types.filter(t=>t==='red').length};
 }
 function ensureGoalGroup(box,state,match,teamId){
   let groups=box.querySelector('.scorer-groups');
   if(!groups){box.innerHTML=goalGroupsShell(state,match);groups=box.querySelector('.scorer-groups');}
   let group=groups?.querySelector(`[data-goal-team-group="${CSS.escape(teamId)}"]`);
   if(!group&&groups){groups.insertAdjacentHTML('beforeend',scorerGroupShell(state,match,teamId));group=groups.lastElementChild;}
   return group;
 }
 function appendGoalRow(form,html,teamId){
   const state=A.state();
   const match=state.matches.find(item=>item.id===form.dataset.matchId);
   const box=form.querySelector('[data-goal-rows]');
   if(!match||!box)return null;
   box.querySelector('[data-empty-goals]')?.remove();
   const group=ensureGoalGroup(box,state,match,teamId);
   const rows=group?.querySelector('[data-goal-team-rows]');
   rows?.insertAdjacentHTML('beforeend',html);
   group?.removeAttribute('hidden');
   return rows?.lastElementChild||null;
 }
 function refreshGoalGroups(form,score=null){
   const state=A.state();
   const match=state.matches.find(item=>item.id===form?.dataset.matchId);
   const box=form?.querySelector('[data-goal-rows]');
   if(!match||!box)return;
   const rows=Array.from(box.querySelectorAll('.goal-draft-row'));
   if(!rows.length){box.innerHTML=emptyGoals();return;}
   box.querySelector('[data-empty-goals]')?.remove();
   rows.forEach(row=>{
     const teamId=row.dataset.scorerTeam||String(row.querySelector('[name="goalTeamId"]')?.value||'');
     if(!teamId)return;
     const group=ensureGoalGroup(box,state,match,teamId);
     const holder=group?.querySelector('[data-goal-team-rows]');
     if(holder&&row.parentElement!==holder)holder.appendChild(row);
   });
   box.querySelectorAll('[data-goal-team-group]').forEach(group=>{
     const teamId=group.dataset.goalTeamGroup||'';
     const count=group.querySelectorAll('.goal-draft-row').length;
     group.hidden=count===0;
     const countEl=group.querySelector('[data-team-scorer-count]');if(countEl)countEl.textContent=String(count);
     const scoreEl=group.querySelector('[data-team-score]');
     if(scoreEl&&score){scoreEl.textContent=String(teamId===match.homeTeamId?score.home:(teamId===match.awayTeamId?score.away:0));}
   });
 }
 function updateAddGoalState(form){
   if(!form)return;
   const picked=form.querySelector('[data-goal-player-picker]')?.value||'';
   const normal=Math.max(0,Number(form.querySelector('[data-goal-normal-count-picker]')?.value)||0);
   const doubles=Math.max(0,Number(form.querySelector('[data-goal-double-count-picker]')?.value)||0);
   const button=form.querySelector('[data-add-goal-row]');
   if(button){
     button.disabled=!picked||(normal+doubles<1);
     button.setAttribute('aria-disabled',String(button.disabled));
   }
 }
 function updateAddCardState(form){
   if(!form)return;
   const button=form.querySelector('[data-add-card-row]');
   if(button){button.disabled=!form.querySelector('[data-card-player-picker]')?.value;button.setAttribute('aria-disabled',String(button.disabled));}
 }
 function updateDraftSummary(form){
   const s=A.state(), m=s.matches.find(x=>x.id===form.dataset.matchId);
   if(!m)return;
   const score=countDraftGoalsByTeam(s,m,form);
   const cards=countCards(form);
   const badge=form.querySelector('[data-draft-score]');
   if(badge)badge.textContent=`Risultato bozza: ${score.home} – ${score.away}`;
   const homeCount=form.querySelector('[data-home-goals-count]');if(homeCount)homeCount.textContent=score.home;
   const awayCount=form.querySelector('[data-away-goals-count]');if(awayCount)awayCount.textContent=score.away;
   const totalGoalsCount=form.querySelector('[data-total-goals-count]');if(totalGoalsCount)totalGoalsCount.textContent=score.actual;
   const yellowCount=form.querySelector('[data-yellow-count]');if(yellowCount)yellowCount.textContent=cards.yellow;
   const redCount=form.querySelector('[data-red-count]');if(redCount)redCount.textContent=cards.red;
   [m.homeTeamId,m.awayTeamId].filter(Boolean).forEach(teamId=>{
     const data=score.breakdown[teamId]||{normal:0,double:0,president:0,own:0};
     ['normal','double','president','own'].forEach(kind=>{
       const el=form.querySelector(`[data-team-${kind}="${CSS.escape(teamId)}"]`);if(el)el.textContent=String(data[kind]||0);
     });
   });
   refreshGoalGroups(form,score);
   updateAddGoalState(form);
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
   refreshGoalGroups(form);
   return duplicate;
 }
 function refreshGoalRowParticipant(state,row){
   const picker=row?.querySelector('[data-goal-row-player]');if(!picker)return;
   const participant=store.getParticipant(state,picker.value);if(!participant)return;
   const isPresident=participant.type==='president';
   row.dataset.scorerTeam=participant.team.id;
   const jersey=row.querySelector('[data-goal-jersey]');if(jersey){jersey.textContent=participantNumber(state,picker.value)||'—';jersey.value=participantNumber(state,picker.value)||'—';}
   const meta=row.querySelector('.scorer-editor-main small');if(meta)meta.textContent=isPresident?`${participant.team.name} · Classifica presidenti separata`:participant.team.name;
   const display=row.querySelector('.scorer-display-name');if(display){const number=participant.type==='player'&&participant.number!==''&&participant.number!=null?`#${participant.number} · `:'';display.textContent=`${number}${participant.name}`;}
   const kind=row.querySelector('.scorer-kind');if(kind)kind.textContent=isPresident?'Presidente':'Giocatore';
   const icon=row.querySelector('.event-icon');if(icon)icon.textContent=isPresident?'RIG':'⚽';
   const teamMeta=row.querySelector('.scorer-card-meta span:nth-child(2) strong');if(teamMeta)teamMeta.textContent=participant.team.name;
   const normalInput=row.querySelector('[name="goalNormalCount"]');
   const normalControl=normalInput?.closest('.goal-quantity-control');
   const normalLabel=normalControl?.querySelector('label');
   row.classList.toggle('is-president-scorer',isPresident);
   let doubleInput=row.querySelector('[name="goalDoubleCount"]');
   const doubleControl=doubleInput?.closest('.goal-quantity-control');
   if(isPresident||!isKings(state)){
     if(doubleControl){
       const normal=Math.max(0,Number(normalInput?.value)||0)+Math.max(0,Number(doubleInput?.value)||0);
       if(normalInput)normalInput.value=String(Math.min(99,normal));
       doubleControl.outerHTML='<input type="hidden" name="goalDoubleCount" value="0">';
     }
     if(normalLabel)normalLabel.textContent=isPresident?'Gol (rig.)':'Gol normali';
     if(normalInput)normalInput.setAttribute('aria-label',isPresident?'Numero di gol del presidente':'Numero di gol normali');
   }else{
     if(normalLabel)normalLabel.textContent='Gol normali';
     if(doubleInput?.type==='hidden'){
       doubleInput.insertAdjacentHTML('afterend',quantityStepperHtml({name:'goalDoubleCount',value:0,label:'Gol doppi',ariaLabel:'numero di gol doppi',help:'Valgono 2 nel risultato e 1 nella classifica marcatori.'}));
       doubleInput.remove();
     }
   }
   const remove=row.querySelector('[data-remove-draft-row]');if(remove)remove.setAttribute('aria-label',`Elimina ${participant.name}`);
   const editor=row.querySelector('[data-scorer-player-editor]');if(editor)editor.hidden=true;
   const toggle=row.querySelector('[data-toggle-scorer-player]');if(toggle)toggle.setAttribute('aria-expanded','false');
   refreshGoalGroups(row.closest('.report-complete-form'));
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
 function matchTaskBackHtml(){
   return `<footer class="match-task-backbar"><button class="btn" type="button" data-back-match-menu>← Torna alla scheda partita</button><small>Le modifiche restano in bozza finché non usi il salvataggio generale nella scheda partita.</small></footer>`;
 }
 function sectionDraftBannerHtml(section,dirty=false){
   const labels={info:'Info partita',goals:'Marcatori',cards:'Cartellini'};
   return `<div class="section-draft-banner ${dirty?'is-dirty':''}" data-section-draft-banner data-section-kind="${section}" role="status" aria-live="polite"><span class="section-draft-dot" aria-hidden="true"></span><div><strong data-section-draft-title>${dirty?'Modifiche in bozza':'Nessuna modifica in questa sezione'}</strong><small data-section-draft-copy>${dirty?`${labels[section]||'Sezione'} aggiornata: torna alla scheda partita per applicare tutto con il salvataggio generale.`:'Ogni variazione verrà mantenuta localmente in bozza e non sarà salvata da questa schermata.'}</small></div></div>`;
 }
 function updateSectionDraftIndicator(form){
   if(!form?.dataset?.matchId)return;
   const m=A.state().matches.find(x=>x.id===form.dataset.matchId);if(!m)return;
   const changes=draftChangeSet(m,getReportDraft(m));
   const banner=form.querySelector('[data-section-draft-banner]');if(!banner)return;
   const kind=banner.dataset.sectionKind||'';
   const dirty=kind==='info'?(changes.info||changes.status||changes.penalties):(kind==='goals'?changes.goals:changes.cards);
   banner.classList.toggle('is-dirty',dirty);
   const title=banner.querySelector('[data-section-draft-title]');if(title)title.textContent=dirty?'Modifiche in bozza':'Nessuna modifica in questa sezione';
   const copy=banner.querySelector('[data-section-draft-copy]');if(copy)copy.textContent=dirty?`${kind==='info'?'Info partita':kind==='goals'?'Marcatori':'Cartellini'} aggiornata: torna alla scheda partita per applicare tutto con il salvataggio generale.`:'Ogni variazione verrà mantenuta localmente in bozza e non sarà salvata da questa schermata.';
 }
 function teamDraftSummaryHtml(s,m){
   return `<div class="match-draft-summary" aria-label="Riepilogo provvisorio" aria-live="polite">${[m.homeTeamId,m.awayTeamId].filter(Boolean).map((teamId,index)=>`<div class="match-draft-team"><strong>${UI.esc(store.teamName(s,teamId))}</strong><div class="match-draft-breakdown"><span><b data-team-normal="${UI.esc(teamId)}">0</b> normali</span>${isKings(s)?`<span><b data-team-double="${UI.esc(teamId)}">0</b> doppi</span><span><b data-team-president="${UI.esc(teamId)}">0</b> presidente</span>`:''}<span><b data-team-own="${UI.esc(teamId)}">0</b> autogol</span></div><em>Totale <b ${index===0?'data-home-goals-count':'data-away-goals-count'}>0</b></em></div>`).join('')}</div>`;
 }
 function infoFormHtml(s,m){
   const d=getReportDraft(m);
   const isLive=d.status==='live';
   const isPlayed=d.status==='played';
   const showPenalty=shouldShowPenaltyFields(s,m,d);
   const score=draftScoreFromDraft(s,m,d);
   const penaltyBlock=showPenalty?`
      <div class="penalty-fields-block field-full">
        <div class="penalty-header">
          <strong>⚽ Rigori (fase a eliminazione diretta)</strong>
          <small>Punteggio bozza ${score.home}-${score.away}: in caso di parità inserisci i rigori per determinare il vincitore.</small>
        </div>
        <div><label>Rigori ${UI.esc(store.teamName(s,m.homeTeamId,m.homeLabel))}</label><input name="penaltiesHome" type="number" min="0" max="99" inputmode="numeric" value="${UI.esc(d.penaltiesHome||'')}" placeholder="es. 5"></div>
        <div><label>Rigori ${UI.esc(store.teamName(s,m.awayTeamId,m.awayLabel))}</label><input name="penaltiesAway" type="number" min="0" max="99" inputmode="numeric" value="${UI.esc(d.penaltiesAway||'')}" placeholder="es. 3"></div>
      </div>`:'';
   return `<form class="match-edit-form match-info-form" data-match-id="${m.id}">
      <div class="report-head clean"><div><span class="section-kicker">Informazioni partita</span><h3>Dettagli e stato</h3><p class="muted">${UI.esc(store.teamName(s,m.homeTeamId,m.homeLabel))} vs ${UI.esc(store.teamName(s,m.awayTeamId,m.awayLabel))}</p></div><span class="score-badge">${score.home} – ${score.away}</span></div>
      ${sectionDraftBannerHtml('info',draftChangeSet(m,d).info||draftChangeSet(m,d).status||draftChangeSet(m,d).penalties)}
      <section class="event-panel match-task-panel-body match-info-grid">
        <div><label>Campo</label><input name="field" value="${UI.esc(d.field||'')}" placeholder="Es. Campo 1"></div>
        <div><label>Arbitro</label><input name="referee" value="${UI.esc(d.referee||'')}" placeholder="Nome arbitro"></div>
        ${s.rules.oneDay?`<div><label>Ora partita</label><input name="time" type="time" value="${UI.esc(d.time||'')}"></div>`:`<div><label>Data</label><input name="date" type="date" value="${UI.esc(d.date||'')}"></div><div><label>Ora</label><input name="time" type="time" value="${UI.esc(d.time||'')}"></div>`}
        <label class="check-card field-full live-toggle ${isLive?'is-active':''}">
          <input name="isLive" type="checkbox" ${isLive?'checked':''} ${isPlayed?'disabled':''}>
          <span><strong>🔴 Partita Live</strong><small>${isPlayed?'La partita è già stata segnata come Giocata. Pulisci il referto per riabilitare lo stato Live.':'La variazione resta in bozza. Salva dalla scheda partita per avviare o aggiornare il Live; per concluderlo, disattiva questa opzione e usa lo stesso salvataggio generale.'}</small></span>
        </label>
        ${penaltyBlock}
      </section>
      ${matchTaskBackHtml()}
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
   const searchResultsId=`${mode}-participant-results-${m.id}`;
   return `<form class="report-complete-form" data-match-id="${m.id}">
      <div class="report-head clean"><div><span class="section-kicker">Gestione referto</span><h3>${mode==='goals'?'Marcatori e autogol':'Cartellini'}</h3><p class="muted">${UI.esc(store.teamName(s,m.homeTeamId,m.homeLabel))} vs ${UI.esc(store.teamName(s,m.awayTeamId,m.awayLabel))}</p></div><span class="score-badge" data-draft-score>Risultato bozza: ${savedScore.home} – ${savedScore.away}</span></div>
      ${sectionDraftBannerHtml(mode,mode==='goals'?draftChangeSet(m,draft).goals:draftChangeSet(m,draft).cards)}
      ${mode==='goals'?`${teamDraftSummaryHtml(s,m)}
      <section class="event-panel match-task-panel-body margin-top">
        <div class="section-title compact"><div><span class="section-kicker">Inserimento rapido</span><h3>Aggiungi un marcatore</h3><p>${isKings(s)?'Seleziona il partecipante e gestisci separatamente gol normali, doppi, autogol e gol del presidente.':'Seleziona il partecipante e indica la quantità dei gol.'}</p></div></div>
        <div class="quick-add-bar scorer-add-grid">
          <div class="scorer-add-team"><label>Squadra del gol</label><select data-goal-team-picker>${teamEventOptions(s,m)}</select></div>
          <div class="participant-search-field"><label for="goal-search-${UI.esc(m.id)}">Cerca per nome o numero di maglia</label><div class="participant-combobox"><input id="goal-search-${UI.esc(m.id)}" data-goal-player-search type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${UI.esc(searchResultsId)}" placeholder="Cerca per nome o numero di maglia" autocomplete="off"><input data-goal-player-picker type="hidden" value=""><div id="${UI.esc(searchResultsId)}" class="participant-results" data-goal-player-results role="listbox" hidden></div></div><div class="selected-participant" data-goal-selected-participant hidden></div><small>Puoi cercare anche “autogol” o “presidente”. I risultati includono solo le squadre della partita.</small></div>
          <div class="scorer-add-quantities">${quantityStepperHtml({dataAttr:'data-goal-normal-count-picker',value:1,label:'Gol normali',labelAttr:'data-goal-normal-label',ariaLabel:'numero di gol normali'})}${isKings(s)?quantityStepperHtml({dataAttr:'data-goal-double-count-picker',value:0,label:'Gol doppi',ariaLabel:'numero di gol doppi',help:'Valgono 2 nel risultato e 1 nella classifica marcatori.',disabled:true,controlAttr:'data-goal-double-control'}):'<input type="hidden" data-goal-double-count-picker value="0">'}</div>
          <div class="scorer-add-action"><button class="btn primary" type="button" data-add-goal-row disabled>Aggiungi marcatore</button><div class="form-feedback" data-goal-feedback role="status" aria-live="polite"></div></div>
        </div>
      </section>
      <section class="event-panel match-task-panel-body scorer-list-panel margin-top"><div class="section-title compact"><div><span class="section-kicker">Marcatori inseriti</span><h3>Riepilogo per squadra</h3><p>Modifica direttamente le quantità oppure cambia il giocatore associato. Le variazioni aggiornano subito il risultato provvisorio.</p></div></div><div class="stack" data-goal-rows>${goalsRows}</div><div class="undo-notice" data-undo-notice role="status" aria-live="polite" hidden></div>${hiddenCards}</section>`:`
      <section class="event-panel match-task-panel-body margin-top">
        <div class="section-title compact"><div><span class="section-kicker">Disciplina</span><h3>Aggiungi un cartellino</h3><p>Cerca per nome o numero di maglia. Il presidente non è selezionabile.</p></div></div>
        <div class="quick-add-bar card-add-grid">
          <div><label>Squadra</label><select data-card-team-picker>${teamEventOptions(s,m)}</select></div>
          <div class="participant-search-field"><label for="card-search-${UI.esc(m.id)}">Cerca calciatore</label><div class="participant-combobox"><input id="card-search-${UI.esc(m.id)}" data-card-player-search type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${UI.esc(searchResultsId)}" placeholder="Nome o numero di maglia" autocomplete="off"><input data-card-player-picker type="hidden" value=""><div id="${UI.esc(searchResultsId)}" class="participant-results" data-card-player-results role="listbox" hidden></div></div><div class="selected-participant" data-card-selected-participant hidden></div></div>
          <div><label>Tipo</label>${cardTypeSelect('yellow')}</div>
          <button class="btn primary" type="button" data-add-card-row disabled>Aggiungi cartellino</button>
        </div>
        <div class="stack margin-top" data-card-rows>${cardsRows||emptyCards()}</div><div class="undo-notice" data-undo-notice role="status" aria-live="polite" hidden></div>
        ${hiddenGoals}
      </section>`}
      ${matchTaskBackHtml()}
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
   modal.innerHTML=`<div class="modal-content match-task-content" aria-labelledby="matchTaskTitle"><header class="match-task-toolbar"><div class="match-task-heading"><span class="match-task-eyebrow">Gestione partita</span><h2 id="matchTaskTitle">Partita</h2><p id="matchTaskTeams"></p></div><button class="btn danger match-task-close" id="closeMatchTaskModal" type="button" aria-label="Chiudi gestione partita"><span aria-hidden="true">×</span><span>Chiudi</span></button></header><div id="matchTaskBody" class="match-task-body-scroll"></div></div>`;
   document.body.appendChild(modal);return modal;
 }
 function openMatchPanel(mode='menu'){
   if(mode!=='menu')saveNotice=null;
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
   const title=mode==='info'?'Info partita':mode==='goals'?'Marcatori':mode==='cards'?'Cartellini':'Gestione partita';
   UI.$('#matchTaskTitle').textContent=title;
   UI.$('#matchTaskTeams').textContent=`${store.teamName(s,m.homeTeamId,m.homeLabel)} vs ${store.teamName(s,m.awayTeamId,m.awayLabel)}`;
   const body=UI.$('#matchTaskBody');
   body.innerHTML=mode==='menu'?matchCommandHtml(s,m):(mode==='info'?infoFormHtml(s,m):reportFormHtml(s,m,mode));
   modal.classList.add('open');
   const reportForm=body.querySelector('.report-complete-form');
   const taskForm=body.querySelector('.match-edit-form,.report-complete-form');
   if(taskForm)updateSectionDraftIndicator(taskForm);
   if(reportForm){
     updateEventPlayerPickers(reportForm,'goal');
     updateEventPlayerPickers(reportForm,'card');
     updateDraftSummary(reportForm);
     updateAddCardState(reportForm);
   }
   body.scrollTop=0;
   const confirmationAction=body.querySelector('[data-confirm-zero-report]');
   if(confirmationAction instanceof HTMLElement)confirmationAction.focus({preventScroll:true});
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
   const savedFocus=taskFocusReturn instanceof HTMLElement&&document.contains(taskFocusReturn)?taskFocusReturn:null;
   const focusTarget=savedFocus||UI.$('#openTeamMatchesBtn')||UI.$(`[data-match-team="${teamFilter}"]`);
   taskFocusReturn=null;
   if(focusTarget instanceof HTMLElement)setTimeout(()=>{if(document.contains(focusTarget))focusTarget.focus({preventScroll:true});},60);
 }
 function matchCommandHtml(s,m){
   const d=getReportDraft(m);
   const home=store.teamName(s,m.homeTeamId,m.homeLabel), away=store.teamName(s,m.awayTeamId,m.awayLabel);
   const persistedStatus=normalizedDraftStatus(m.status);
   const draftStatus=normalizedDraftStatus(d.status);
   const statusChanged=draftStatus!==persistedStatus;
   let meta=matchStatusMeta(s,m);
   if(statusChanged&&draftStatus==='live')meta={key:'live-draft',label:'Live in bozza',cls:'is-pending'};
   else if(statusChanged&&persistedStatus==='live')meta={key:'closing-live-draft',label:'Chiusura Live in bozza',cls:'is-pending'};
   const real=m.homeTeamId&&m.awayTeamId;
   const changes=draftChangeSet(m,d);
   const dirty=changes.any;
   const isLive=persistedStatus==='live'&&draftStatus==='live';
   const liveMode=persistedStatus==='live'||draftStatus==='live';
   const isKO=store.isKnockoutPhase&&store.isKnockoutPhase(m)&&real;
   const score=draftScoreFromDraft(s,m,d);
   const needsPenalties=isKO&&score.home===score.away&&(d.goals?.length>0||d.cards?.length>0||d.status==='live'||d.status==='played');
   const pParsed=parsePenaltiesFromDraft(d);
   const validPenalties=pParsed&&!pParsed.error&&pParsed.home!==pParsed.away;
   const plan=savePlanForMatch(s,m,d);
   const dirtyLabels=draftSectionLabels(changes);
   const infoDirty=changes.info||changes.status||changes.penalties;
   const scorerCount=(d.goals||[]).length;
   const cardCount=(d.cards||[]).length;
   let penaltyHint='';
   if(isKO&&score.home===score.away&&validPenalties){
     penaltyHint=`<div class="match-penalty-status ok">⚽ Rigori inseriti: <strong>${pParsed.home}-${pParsed.away}</strong> · Vince ${pParsed.home>pParsed.away?UI.esc(home):UI.esc(away)}</div>`;
   } else if(needsPenalties){
     penaltyHint=`<div class="match-penalty-status warn">⚠ Pareggio ${score.home}-${score.away} in fase a eliminazione diretta: inserisci i rigori nel pannello “Info partita” prima di chiudere.</div>`;
   }
   const sectionBadge=active=>active?'<em class="match-section-draft">Bozza</em>':'';
   const summaryChips=[
     `<span><b>${score.home} – ${score.away}</b> risultato</span>`,
     `<span><b>${scorerCount}</b> eventi gol</span>`,
     `<span><b>${cardCount}</b> cartellini</span>`,
     dirty?`<span class="is-dirty"><b>${dirtyLabels.length}</b> sezioni in bozza</span>`:'<span><b>0</b> modifiche in bozza</span>'
   ].join('');
   const updatesExistingZero=plan.kind==='played-update-zero';
   const confirmation=pendingZeroConfirmationMatchId===m.id?`<div class="zero-report-confirm" role="alertdialog" aria-labelledby="zeroReportTitle" aria-describedby="zeroReportCopy"><strong id="zeroReportTitle">${updatesExistingZero?'Confermare l’aggiornamento a 0-0?':'Confermare il referto 0-0?'}</strong><p id="zeroReportCopy">${updatesExistingZero?'Il referto definitivo esistente verrà sostituito con un risultato 0-0 senza marcatori, cartellini o rigori.':'La partita verrà segnata come Giocata con risultato 0-0 e senza cartellini.'} Le informazioni organizzative presenti verranno mantenute.</p><div><button class="btn" type="button" data-cancel-zero-report>Annulla</button><button class="btn primary" type="button" data-confirm-zero-report>${updatesExistingZero?'Conferma aggiornamento':'Conferma 0-0'}</button></div></div>`:'';
   const notice=saveNotice?.matchId===m.id?`<div class="match-save-notice ${saveNotice.type==='error'?'is-error':'is-ok'}" role="status">${UI.esc(saveNotice.text)}</div>`:'';
   return `<article class="match-command-center ${isLive?'is-live-card':''} ${statusChanged?'has-status-draft':''}">
      <div class="match-command-hero"><span class="pill">${UI.esc(matchPhaseLabel(m))} · ${UI.esc(m.round)}</span><h3>${UI.esc(home)} <span>vs</span> ${UI.esc(away)}</h3><p>${UI.esc(d.field||'Campo da inserire')} · ${UI.esc(d.date||'Data da inserire')} ${UI.esc(d.time||'')}</p><strong class="score-badge match-status-badge ${meta.cls} ${statusChanged?'is-draft-status':''}" role="status">${isLive?'🔴 ':''}${UI.esc(meta.label)}</strong>${dirty?`<small class="draft-status">Bozza attiva · ${UI.esc(dirtyLabels.join(' · '))}</small>`:'<small class="draft-status is-clean">Nessuna modifica in bozza</small>'}</div>
      ${penaltyHint}
      <div class="match-action-grid">
        <button class="match-action-card" type="button" data-open-match-panel="info"><span>🗓️</span><strong>Info partita ${sectionBadge(infoDirty)}</strong><small>Campo, arbitro, data, orario${isKO?', rigori':''} e stato Live.</small></button>
        <button class="match-action-card" type="button" data-open-match-panel="goals" ${real?'':'disabled'}><span>⚽</span><strong>Marcatori ${sectionBadge(changes.goals)}</strong><small>Gol, autogol, peso Kings League e risultato.</small></button>
        <button class="match-action-card" type="button" data-open-match-panel="cards" ${real?'':'disabled'}><span>🟨</span><strong>Cartellini ${sectionBadge(changes.cards)}</strong><small>Gialli e rossi dei calciatori.</small></button>
      </div>
      <section class="match-general-save-card ${dirty?'has-draft':''} ${liveMode?'is-live-mode':''}" aria-labelledby="generalSaveTitle">
        <span class="section-kicker">Salvataggio generale</span>
        <h3 id="generalSaveTitle">${UI.esc(plan.title)}</h3>
        <p>${UI.esc(plan.description)}</p>
        <div class="match-save-summary" aria-label="Riepilogo dati in bozza">${summaryChips}</div>
        ${notice}
        ${confirmation||`<button class="btn primary match-general-save-button" type="button" data-save-match-context ${plan.disabled?'disabled':''}>${UI.esc(plan.label)}</button>`}
        <small class="match-general-save-help">Il salvataggio è disponibile soltanto in questa scheda. Le singole sezioni non scrivono dati definitivi.</small>
      </section>
      <small class="match-context-help">Per pulire un referto già salvato usa “Pulisci” nella card della partita nell’elenco.</small>
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
   pendingZeroConfirmationMatchId='';
   saveNotice=null;
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
   pendingZeroConfirmationMatchId='';
   saveNotice=null;
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
 function persistMatchInfo(draft){
   if(!selectedMatch)return false;
   A.commit(s=>{
     const m=s.matches.find(x=>x.id===selectedMatch);if(!m)return;
     m.field=String(draft.field||'').trim();
     m.referee=String(draft.referee||'').trim();
     m.date=String(draft.date||'').trim();
     m.time=String(draft.time||'').trim();
     m.datetime=m.date&&m.time?`${m.date}T${m.time}`:'';
   });
   return true;
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

 // SALVATAGGIO GENERALE: unica azione definitiva, disponibile soltanto nella scheda partita.
 function saveMatchContext({confirmedZero=false}={}){
   syncOpenTaskDraft();
   const s0=A.state(),m0=s0.matches.find(x=>x.id===selectedMatch);if(!m0)return;
   const draft=getReportDraft(m0);
   const plan=savePlanForMatch(s0,m0,draft);
   if(plan.disabled)return;
   if(plan.needsZeroConfirmation&&!confirmedZero){
     pendingZeroConfirmationMatchId=selectedMatch;
     saveNotice=null;
     openMatchPanel('menu');
     return;
   }
   pendingZeroConfirmationMatchId='';
   let ok=false;
   if(plan.kind==='info')ok=persistMatchInfo(draft);
   else ok=persistMatchContext(s0,draft,plan.finalStatus);
   if(!ok){saveNotice={matchId:selectedMatch,type:'error',text:'Salvataggio non completato. Correggi i dati indicati e riprova.'};openMatchPanel('menu');return;}
   const matchId=selectedMatch;
   const message=plan.kind==='info'
     ? 'Informazioni salvate. La partita non è stata refertata.'
     : plan.finalStatus==='live'
       ? 'Partita Live aggiornata. Il risultato non è ancora definitivo.'
       : (plan.kind==='played-update-zero'?'Referto definitivo aggiornato a 0-0 senza eventi.':plan.needsZeroConfirmation?'Referto 0-0 confermato e salvato.':'Partita salvata e refertata correttamente.');
   reportDrafts.delete(matchId);
   saveNotice={matchId,type:'ok',text:message};
   render();
   if(UI.$('#matchTaskModal')?.classList.contains('open'))openMatchPanel('menu');
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
   if(match){selectedMatch=match.dataset.selectMatch;pendingZeroConfirmationMatchId='';saveNotice=null;render();taskFocusReturn=UI.$('#openTeamMatchesBtn')||UI.$(`[data-match-team="${teamFilter}"]`);closeMatchListModal();openMatchPanel('menu');return;}
   const panel=e.target.closest('[data-open-match-panel]');if(panel){syncOpenTaskDraft();openMatchPanel(panel.dataset.openMatchPanel);return;}
   if(e.target.closest('#closeMatchListModal')){closeMatchListModal();return;}
   if(e.target.id==='matchListModal'){e.preventDefault();e.stopPropagation();closeMatchListModal();return;}
   if(e.target.closest('#closeMatchTaskModal')){closeMatchTaskModal({force:true});return;}
   if(e.target.id==='matchTaskModal'){e.preventDefault();e.stopPropagation();closeMatchTaskModal({force:true});return;}
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

 function closeParticipantResults(form,kind){
   const results=form?.querySelector(`[data-${kind}-player-results]`);
   const search=form?.querySelector(`[data-${kind}-player-search]`);
   if(results)results.hidden=true;
   search?.setAttribute('aria-expanded','false');
 }
 function showGoalFeedback(form,message){
   const box=form?.querySelector('[data-goal-feedback]');if(!box)return;
   box.textContent=message;
   box.classList.add('is-visible');
   clearTimeout(Number(box.dataset.timer)||0);
   box.dataset.timer=String(setTimeout(()=>{box.textContent='';box.classList.remove('is-visible');},1800));
 }
 function clearPendingUndo(){
   if(!pendingUndo)return;
   clearTimeout(pendingUndo.timer);
   const notice=pendingUndo.form?.querySelector('[data-undo-notice]');if(notice){notice.hidden=true;notice.innerHTML='';}
   pendingUndo=null;
 }
 function rowSnapshotHtml(row){
   const clone=row.cloneNode(true);
   const sourceControls=row.querySelectorAll('input,select,textarea');
   const cloneControls=clone.querySelectorAll('input,select,textarea');
   sourceControls.forEach((control,index)=>{
     const target=cloneControls[index];if(!target)return;
     if(control.tagName==='SELECT'){
       Array.from(target.options).forEach((option,optionIndex)=>option.toggleAttribute('selected',Boolean(control.options[optionIndex]?.selected)));
     }else if(control.type==='checkbox'||control.type==='radio')target.toggleAttribute('checked',control.checked);
     else{
       target.value=control.value;
       target.setAttribute('value',control.value);
       if(target.tagName==='TEXTAREA')target.textContent=control.value;
     }
   });
   clone.querySelectorAll('[data-scorer-player-editor]').forEach(editor=>editor.hidden=true);
   clone.querySelectorAll('[data-toggle-scorer-player]').forEach(button=>button.setAttribute('aria-expanded','false'));
   return clone.outerHTML;
 }
 function queueUndo(form,row){
   clearPendingUndo();
   const type=row.classList.contains('goal-draft-row')?'goal':'card';
   const notice=form.querySelector('[data-undo-notice]')||form.querySelector('[data-card-rows]')?.parentElement?.querySelector('[data-undo-notice]');
   pendingUndo={form,type,html:rowSnapshotHtml(row),teamId:row.dataset.scorerTeam||row.dataset.ownGoalTeam||'',timer:0};
   row.remove();
   if(notice){notice.innerHTML=`<span>${type==='goal'?'Marcatore':'Cartellino'} eliminato.</span><button class="btn small" type="button" data-undo-remove>Annulla</button>`;notice.hidden=false;}
   pendingUndo.timer=setTimeout(clearPendingUndo,6500);
 }
 function restorePendingUndo(){
   if(!pendingUndo)return;
   const {form,type,html,teamId}=pendingUndo;
   if(type==='goal')appendGoalRow(form,html,teamId);
   else{
     const box=form.querySelector('[data-card-rows]');
     box?.querySelector('[data-empty-cards]')?.remove();
     box?.insertAdjacentHTML('beforeend',html);
   }
   clearPendingUndo();
   updateDraftSummary(form);syncFormDraft(form);
 }
 function resultButtons(form,kind){return Array.from(form.querySelectorAll(`[data-${kind}-player-results] .participant-result`));}
 function focusParticipantResult(form,kind,index){
   const buttons=resultButtons(form,kind);if(!buttons.length)return;
   const next=(index+buttons.length)%buttons.length;
   buttons.forEach((button,i)=>{button.classList.toggle('is-active',i===next);button.setAttribute('aria-selected',String(i===next));});
   buttons[next].focus();
 }

 document.addEventListener('change',e=>{
   if(e.target.matches('.match-edit-form [name="isLive"]')){
     const card=e.target.closest('.live-toggle');
     if(card)card.classList.toggle('is-active',e.target.checked);
     const form=e.target.closest('.match-edit-form');
     if(form)syncFormDraft(form);
     return;
   }
   const form=e.target.closest('.report-complete-form');
   if(!form)return;
   if(e.target.matches('[data-goal-team-picker]')){
     selectParticipant(form,'goal','');
     renderParticipantResults(form,'goal');
     return;
   }
   if(e.target.matches('[data-card-team-picker]')){
     selectParticipant(form,'card','');
     renderParticipantResults(form,'card');
     return;
   }
   if(e.target.matches('[data-goal-row-player]')){
     const row=e.target.closest('.goal-draft-row');
     refreshGoalRowParticipant(A.state(),row);
     mergeDuplicateGoalRow(form,row);
     updateDraftSummary(form);syncFormDraft(form);return;
   }
   if(e.target.matches('.goal-draft-row [name="goalNormalCount"],.goal-draft-row [name="goalDoubleCount"]')){updateDraftSummary(form);syncFormDraft(form);}
 });
 document.addEventListener('input',e=>{
   const info=e.target.closest('.match-edit-form');
   if(info){syncFormDraft(info);return;}
   const form=e.target.closest('.report-complete-form');
   if(!form)return;
   if(e.target.matches('[data-goal-player-search]')){
     const picker=form.querySelector('[data-goal-player-picker]');if(picker)picker.value='';
     renderParticipantResults(form,'goal',{open:true});updateAddGoalState(form);return;
   }
   if(e.target.matches('[data-card-player-search]')){
     const picker=form.querySelector('[data-card-player-picker]');if(picker)picker.value='';
     renderParticipantResults(form,'card',{open:true});updateAddCardState(form);return;
   }
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
 document.addEventListener('focusin',e=>{
   const form=e.target.closest('.report-complete-form');if(!form)return;
   if(e.target.matches('[data-goal-player-search]'))renderParticipantResults(form,'goal',{open:true});
   if(e.target.matches('[data-card-player-search]'))renderParticipantResults(form,'card',{open:true});
 });
 document.addEventListener('keydown',e=>{
   const form=e.target.closest('.report-complete-form');if(!form)return;
   const kind=e.target.matches('[data-goal-player-search]')?'goal':(e.target.matches('[data-card-player-search]')?'card':'');
   if(kind){
     if(e.key==='ArrowDown'){
       e.preventDefault();renderParticipantResults(form,kind,{open:true});focusParticipantResult(form,kind,0);return;
     }
     if(e.key==='Escape'){e.preventDefault();closeParticipantResults(form,kind);return;}
     if(e.key==='Enter'){
       e.preventDefault();
       const selected=form.querySelector(`[data-${kind}-player-picker]`)?.value;
       const add=form.querySelector(kind==='goal'?'[data-add-goal-row]':'[data-add-card-row]');
       if(selected&&!add?.disabled){add.click();return;}
       renderParticipantResults(form,kind,{open:true});
       const first=resultButtons(form,kind)[0];if(first)first.click();
       return;
     }
   }
   if(e.key==='Enter'&&e.target.matches('[data-goal-normal-count-picker],[data-goal-double-count-picker]')){
     const add=form.querySelector('[data-add-goal-row]');
     if(add&&!add.disabled){e.preventDefault();add.click();return;}
   }
   const result=e.target.closest('.participant-result');
   if(result){
     const resultKind=result.hasAttribute('data-select-goal-participant')?'goal':'card';
     const buttons=resultButtons(form,resultKind);const index=buttons.indexOf(result);
     if(e.key==='ArrowDown'){e.preventDefault();focusParticipantResult(form,resultKind,index+1);}
     if(e.key==='ArrowUp'){e.preventDefault();focusParticipantResult(form,resultKind,index-1);}
     if(e.key==='Escape'){
       e.preventDefault();
       // Il focus riattiva il combobox tramite focusin: spostalo prima e chiudi
       // subito dopo, così Escape lascia il campo attivo ma l'elenco chiuso.
       form.querySelector(`[data-${resultKind}-player-search]`)?.focus();
       closeParticipantResults(form,resultKind);
     }
   }
 });
 document.addEventListener('click',e=>{
   const step=e.target.closest('[data-step]');
   if(step){
     e.preventDefault();
     const input=step.closest('[data-number-stepper]')?.querySelector('input');
     if(input&&!input.disabled){input.value=String(Math.max(0,Math.min(99,(Number(input.value)||0)+Number(step.dataset.step||0))));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
     return;
   }
   const participantResult=e.target.closest('.participant-result');
   if(participantResult){
     const form=participantResult.closest('.report-complete-form');
     const kind=participantResult.hasAttribute('data-select-goal-participant')?'goal':'card';
     const value=participantResult.getAttribute(`data-select-${kind}-participant`)||'';
     selectParticipant(form,kind,value);
     const next=form.querySelector(kind==='goal'?'[data-goal-normal-count-picker]':'[data-add-card-row]');next?.focus();
     return;
   }
   const clearSelection=e.target.closest('[data-clear-goal-participant],[data-clear-card-participant]');
   if(clearSelection){
     const form=clearSelection.closest('.report-complete-form');const kind=clearSelection.hasAttribute('data-clear-goal-participant')?'goal':'card';
     selectParticipant(form,kind,'');form.querySelector(`[data-${kind}-player-search]`)?.focus();return;
   }
   const togglePlayer=e.target.closest('[data-toggle-scorer-player]');
   if(togglePlayer){
     const editor=togglePlayer.closest('.scorer-card')?.querySelector('[data-scorer-player-editor]');
     if(editor){editor.hidden=!editor.hidden;togglePlayer.setAttribute('aria-expanded',String(!editor.hidden));if(!editor.hidden)editor.querySelector('select')?.focus();}
     return;
   }
   const cancelPlayer=e.target.closest('[data-cancel-scorer-player]');
   if(cancelPlayer){const row=cancelPlayer.closest('.scorer-card');const editor=row?.querySelector('[data-scorer-player-editor]');if(editor)editor.hidden=true;row?.querySelector('[data-toggle-scorer-player]')?.setAttribute('aria-expanded','false');return;}
   const undo=e.target.closest('[data-undo-remove]');if(undo){restorePendingUndo();return;}
   const back=e.target.closest('[data-back-match-menu]');if(back){e.preventDefault();syncOpenTaskDraft();openMatchPanel('menu');return;}
   const addGoal=e.target.closest('[data-add-goal-row]');
   const addCard=e.target.closest('[data-add-card-row]');
   const remove=e.target.closest('[data-remove-draft-row]');
   const saveContext=e.target.closest('[data-save-match-context]');
   if(saveContext){e.preventDefault();saveMatchContext();return;}
   const confirmZero=e.target.closest('[data-confirm-zero-report]');
   if(confirmZero){e.preventDefault();saveMatchContext({confirmedZero:true});return;}
   const cancelZero=e.target.closest('[data-cancel-zero-report]');
   if(cancelZero){e.preventDefault();pendingZeroConfirmationMatchId='';openMatchPanel('menu');return;}
   const clearReport=e.target.closest('[data-clear-report]');
   if(clearReport){e.preventDefault();const form=clearReport.closest('.report-complete-form');clearReportForMatch(form?.dataset.matchId||selectedMatch);return;}
   if(addGoal){
     const form=addGoal.closest('.report-complete-form'),s=A.state(),box=form.querySelector('[data-goal-rows]');
     const picked=form.querySelector('[data-goal-player-picker]')?.value||'';
     let normalCount=Math.max(0,Math.min(99,Number(form.querySelector('[data-goal-normal-count-picker]')?.value)||0));
     let doubleCount=Math.max(0,Math.min(99,Number(form.querySelector('[data-goal-double-count-picker]')?.value)||0));
     const match=s.matches.find(x=>x.id===form.dataset.matchId);
     if(!picked||!match)return;
     let existing=null,teamId='';
     if(isOwnGoalValue(picked)){
       doubleCount=0;teamId=ownGoalTeamFromValue(picked);
       if(normalCount<1||![match.homeTeamId,match.awayTeamId].includes(teamId))return;
       existing=Array.from(box.querySelectorAll('.goal-draft-row')).find(row=>goalRowIdentity(row)===`own:${teamId}`);
       if(existing){const input=existing.querySelector('[name="goalNormalCount"]');if(input)input.value=String(Math.min(99,(Number(input.value)||0)+normalCount));}
       else appendGoalRow(form,goalDraftItem(s,match,{ownGoal:true,teamId,normalCount,doubleCount:0}),teamId);
     }else{
       const participant=store.getParticipant(s,picked);
       if(!participant||![match.homeTeamId,match.awayTeamId].includes(participant.team.id))return;
       teamId=participant.team.id;
       if(participant.type==='president'||!isKings(s)){normalCount+=doubleCount;doubleCount=0;}
       if(normalCount+doubleCount<1)return;
       existing=Array.from(box.querySelectorAll('.goal-draft-row')).find(row=>goalRowIdentity(row)===`player:${picked}`);
       if(existing){
         const normalInput=existing.querySelector('[name="goalNormalCount"]');const doubleInput=existing.querySelector('[name="goalDoubleCount"]');
         if(normalInput)normalInput.value=String(Math.min(99,(Number(normalInput.value)||0)+normalCount));
         if(doubleInput)doubleInput.value=String(Math.min(99,(Number(doubleInput.value)||0)+doubleCount));
         refreshGoalRowParticipant(s,existing);
       }else appendGoalRow(form,goalDraftItem(s,match,{playerId:picked,normalCount,doubleCount}),teamId);
     }
     const personLabel=isOwnGoalValue(picked)?'Autogol':(store.getParticipant(s,picked)?.name||'Marcatore');
     selectParticipant(form,'goal','');
     const normalPicker=form.querySelector('[data-goal-normal-count-picker]');if(normalPicker)normalPicker.value='1';
     const doublePicker=form.querySelector('[data-goal-double-count-picker]');if(doublePicker)doublePicker.value='0';
     syncQuickGoalDoublePicker(form);updateDraftSummary(form);syncFormDraft(form);
     showGoalFeedback(form,existing?`${personLabel}: quantità aggiornata.`:`${personLabel} aggiunto.`);
     form.querySelector('[data-goal-player-search]')?.focus({preventScroll:true});
     closeParticipantResults(form,'goal');
     return;
   }
   if(addCard){
     const form=addCard.closest('.report-complete-form'),s=A.state(),box=form.querySelector('[data-card-rows]');
     const picker=form.querySelector('[data-card-player-picker]');const typePicker=form.querySelector('[data-card-type-picker]');
     const playerId=picker?.value;const type=typePicker?.value==='red'?'red':'yellow';
     if(!playerId||store.isPresidentId(s,playerId))return;
     box.querySelector('[data-empty-cards]')?.remove();box.insertAdjacentHTML('beforeend',cardDraftItem(s,playerId,type));
     selectParticipant(form,'card','');typePicker.value='yellow';updateDraftSummary(form);syncFormDraft(form);form.querySelector('[data-card-player-search]')?.focus({preventScroll:true});closeParticipantResults(form,'card');return;
   }
   if(remove){
     const form=remove.closest('.report-complete-form');const row=remove.closest('[data-event-item]');if(!form||!row)return;
     queueUndo(form,row);
     const goals=form.querySelector('[data-goal-rows]');const cards=form.querySelector('[data-card-rows]');
     if(goals&&!goals.querySelector('.goal-draft-row'))goals.innerHTML=emptyGoals();
     if(cards&&!cards.querySelector('.card-draft-row'))cards.innerHTML=emptyCards();
     updateDraftSummary(form);syncFormDraft(form);return;
   }
   const form=e.target.closest('.report-complete-form');
   if(form&&!e.target.closest('.participant-combobox')){closeParticipantResults(form,'goal');closeParticipantResults(form,'card');}
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
