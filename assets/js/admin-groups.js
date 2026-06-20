(function(){
  const store=NexoraStore, UI=NexoraUI, A=NexoraAdmin;
  let assignments={};
  let pickedTeamId='';
  const isTouchDevice=()=>window.matchMedia&&window.matchMedia('(pointer: coarse)').matches;

  function groupNames(s){return (s.rules.groupConfigs||[]).map(g=>g.name).filter(Boolean);}
  function groupByName(s,name){return (s.rules.groupConfigs||[]).find(g=>g.name===name)||{name,size:0,qualifiers:0};}
  function initialAssignments(){
    const s=A.state();
    const saved={...(s.rules.groupAssignments||{})};
    const fromCalendar=store.groupAssignmentsFromMatches(s);
    const auto=store.serpentineAssignments(s);
    const out={};
    s.teams.forEach(t=>out[t.id]=saved[t.id]||fromCalendar[t.id]||auto[t.id]||'');
    return out;
  }
  function counts(s){const c=Object.fromEntries(groupNames(s).map(n=>[n,0]));s.teams.forEach(t=>{if(c[assignments[t.id]]!==undefined)c[assignments[t.id]]++;});return c;}
  function hasPlayedGroupData(s){return s.matches.some(m=>m.phase==='group'&&(store.hasScore(s,m)||m.goals.length||m.cards.length));}
  function assignmentOptions(s,selected){return '<option value="">Non assegnata</option>'+groupNames(s).map(n=>`<option value="${UI.esc(n)}" ${n===selected?'selected':''}>${UI.esc(n)}</option>`).join('');}
  function assignedTeamsFor(s,group){return s.teams.filter(t=>assignments[t.id]===group);}
  function render(){
    const s=A.state();
    if(s.rules.format!=='groups_knockout'){
      UI.$('#manualGroupsEditor').innerHTML='<div class="empty">Questa pagina si attiva quando il formato è “Gironi + eliminazione diretta”. Vai in Regole & calendario e cambia formato.</div>';
      UI.$('#groupHealth').innerHTML='<div class="help-box">Formato attuale: '+UI.esc(store.FORMAT_LABELS[s.rules.format]||s.rules.format)+'</div>';
      UI.$('#groupPreview').innerHTML='<div class="empty">Nessuna anteprima disponibile.</div>';
      UI.$('#applyGroupsBtn').disabled=true;
      return;
    }
    UI.$('#applyGroupsBtn').disabled=false;
    UI.$('#groupModePill').textContent=`${s.rules.groupConfigs.length} gironi · ${s.teams.length} squadre`;
    const c=counts(s);
    UI.$('#manualGroupsEditor').innerHTML=s.rules.groupConfigs.map(g=>{
      const teams=assignedTeamsFor(s,g.name);
      const status=c[g.name]===g.size?'ok':(c[g.name]>g.size?'over':'warn');
      return `<section class="group-column ${status}" data-group-drop="${UI.esc(g.name)}"><div class="group-column-head"><div><h3>${UI.esc(g.name)}</h3><p class="muted">${g.qualifiers} qualificate · ${teams.length}/${g.size} squadre</p></div><span class="pill">${status==='ok'?'OK':status==='over'?'Troppe':'Da completare'}</span></div><button class="btn small group-drop-btn" type="button" data-move-picked-to="${UI.esc(g.name)}" ${pickedTeamId?'':'disabled'}>Sposta qui</button><div class="stack group-drop-zone">${teams.map(t=>teamAssignmentRow(s,t)).join('')||'<div class="empty small">Trascina qui una squadra o selezionala e premi “Sposta qui”.</div>'}</div></section>`;
    }).join('')+unassignedBlock(s);
    renderHealth(s,c);
    renderPreview(s);
  }
  function teamAssignmentRow(s,t){
    const touch=isTouchDevice();
    return `<div class="group-team-row draggable-team ${touch?'touch-fallback':''} ${pickedTeamId===t.id?'picked':''}" data-team-id="${t.id}" draggable="${touch?'false':'true'}">${UI.logo(t)}<div><strong>${UI.esc(t.name)}</strong><label class="tiny-label">Girone</label><select data-group-select="${t.id}">${assignmentOptions(s,assignments[t.id]||'')}</select></div><button class="btn small" type="button" data-pick-team="${t.id}">${pickedTeamId===t.id?'Selezionata':'Sposta'}</button></div>`;
  }
  function unassignedBlock(s){const teams=s.teams.filter(t=>!assignments[t.id]);if(!teams.length)return '';return `<section class="group-column warn" data-group-drop=""><div class="group-column-head"><div><h3>Non assegnate</h3><p class="muted">Da sistemare prima di rigenerare.</p></div><span class="pill">${teams.length}</span></div><button class="btn small group-drop-btn" type="button" data-move-picked-to="" ${pickedTeamId?'':'disabled'}>Sposta qui</button><div class="stack group-drop-zone">${teams.map(t=>teamAssignmentRow(s,t)).join('')}</div></section>`;}
  function renderHealth(s,c){
    const lines=s.rules.groupConfigs.map(g=>{const diff=c[g.name]-g.size;const cls=diff===0?'ok':diff>0?'error':'warn';const txt=diff===0?'Capienza corretta':diff>0?`${diff} squadra/e in più`:`${Math.abs(diff)} posto/i vuoti`;return `<div class="health-line ${cls}"><strong>${UI.esc(g.name)}</strong><span>${txt}</span></div>`;}).join('');
    const validation=store.validateGroupAssignments(s,assignments);
    const played=hasPlayedGroupData(s);
    UI.$('#groupHealth').innerHTML=`${lines}<div class="help-box ${validation.ok?'':'warn'}">${UI.esc(validation.message)}</div>${played?'<div class="message error">Attenzione: esistono già risultati o referti nei gironi. Applicando le modifiche verranno sostituite le partite della fase a gironi.</div>':''}`;
  }
  function renderPreview(s){
    const temp=store.normalizeState({...s,rules:{...s.rules,groupAssignments:{...assignments}},matches:[]});
    const valid=store.validateGroupAssignments(temp,assignments);
    if(!valid.ok){UI.$('#groupPreview').innerHTML='<div class="empty">Completa le assegnazioni per vedere l’anteprima.</div>';return;}
    const res=store.generationPlan(temp);
    if(!res.ok){UI.$('#groupPreview').innerHTML=`<div class="message error">${UI.esc(res.message)}</div>`;return;}
    const groupMatches=res.matches.filter(m=>m.phase==='group');
    UI.$('#groupPreview').innerHTML=groupMatches.length?UI.matchList(temp,groupMatches,false):'<div class="empty">Nessuna partita di girone prevista.</div>';
  }

  function ensureGroupMoveModal(){
    let modal=UI.$('#groupMoveModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.className='modal group-move-modal';
    modal.id='groupMoveModal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.innerHTML=`<div class="modal-content group-move-content"><div class="match-task-toolbar"><h2 id="groupMoveTitle">Sposta squadra</h2><button class="btn danger" id="closeGroupMoveModal" type="button">Chiudi</button></div><div id="groupMoveBody" class="group-move-body"></div></div>`;
    document.body.appendChild(modal);
    return modal;
  }
  function openGroupMoveModal(teamId){
    const s=A.state();
    const team=store.getTeam(s,teamId);
    if(!team)return;
    pickedTeamId=teamId;
    const modal=ensureGroupMoveModal();
    UI.$('#groupMoveTitle').textContent=`Sposta ${team.name}`;
    const current=assignments[teamId]||'';
    UI.$('#groupMoveBody').innerHTML=`<div class="selected-team-summary">${UI.logo(team,false)}<div><strong>${UI.esc(team.name)}</strong><small>Girone attuale: ${UI.esc(current||'Non assegnata')}</small></div></div><div class="group-move-actions">${groupNames(s).map(name=>{const g=groupByName(s,name);const c=assignedTeamsFor(s,name).length;return `<button class="match-action-card compact" type="button" data-mobile-move-team="${UI.esc(teamId)}" data-mobile-move-group="${UI.esc(name)}"><strong>${UI.esc(name)}</strong><small>${c}/${g.size} squadre · ${g.qualifiers} qualificate</small></button>`;}).join('')}<button class="match-action-card compact danger-soft" type="button" data-mobile-move-team="${UI.esc(teamId)}" data-mobile-move-group=""><strong>Non assegnata</strong><small>Rimuovi momentaneamente dai gironi</small></button></div>`;
    modal.classList.add('open');
    
    
  }
  function closeGroupMoveModal(){UI.$('#groupMoveModal')?.classList.remove('open');}

  function applyAssignments(){
    const s=A.state();
    const v=store.validateGroupAssignments(s,assignments);
    if(!v.ok){A.flash('#groupsMessage',v.message,'error');render();return;}
    if(hasPlayedGroupData(s)&&!confirm('Ci sono risultati/referti nei gironi. Applicando le modifiche saranno eliminati perché il calendario viene rigenerato. Continuare?'))return;
    s.rules.groupAssignments={...assignments};
    const res=store.generateCalendar(s,{preserveResults:true});
    if(!res.ok){A.flash('#groupsMessage',res.message,'error');return;}
    A.save(s);
    A.flash('#groupsMessage','Gironi applicati e calendario rigenerato correttamente.','ok');
    assignments=initialAssignments();
    render();
  }
  function downloadBackup(){
    const s=A.state();
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),state:s},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`new-generation-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
  }
  function importBackup(file){
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{try{const data=JSON.parse(reader.result);const next=store.normalizeState(data.state||data);if(!confirm('Importare questo backup e sostituire i dati admin attuali?'))return;A.save(next);location.reload();}catch(err){A.flash('#groupsMessage','Backup non valido: '+(err.message||err),'error');}};
    reader.readAsText(file);
  }

  function moveTeam(teamId,group){if(!teamId)return;assignments[teamId]=group||'';pickedTeamId='';closeGroupMoveModal();render();}
  document.addEventListener('DOMContentLoaded',()=>{assignments=initialAssignments();render();});
  document.addEventListener('change',e=>{const sel=e.target.closest('[data-group-select]');if(sel){assignments[sel.dataset.groupSelect]=sel.value;render();}});
  document.addEventListener('click',e=>{
    const pick=e.target.closest('[data-pick-team]');
    if(pick){
      if(isTouchDevice()){openGroupMoveModal(pick.dataset.pickTeam);return;}
      pickedTeamId=pickedTeamId===pick.dataset.pickTeam?'':pick.dataset.pickTeam;render();return;
    }
    const mobileMove=e.target.closest('[data-mobile-move-team]');
    if(mobileMove){moveTeam(mobileMove.dataset.mobileMoveTeam,mobileMove.dataset.mobileMoveGroup||'');return;}
    if(e.target.id==='closeGroupMoveModal'){closeGroupMoveModal();return;}
    if(e.target.id==='groupMoveModal'){e.preventDefault();e.stopPropagation();closeGroupMoveModal();return;}
    const move=e.target.closest('[data-move-picked-to]');if(move&&pickedTeamId){moveTeam(pickedTeamId,move.dataset.movePickedTo||'');}
  });
  document.addEventListener('dragstart',e=>{if(isTouchDevice()){e.preventDefault();return;}const row=e.target.closest('[data-team-id]');if(row){e.dataTransfer.setData('text/plain',row.dataset.teamId);row.classList.add('dragging');}});
  document.addEventListener('dragend',e=>{e.target.closest('[data-team-id]')?.classList.remove('dragging');document.querySelectorAll('.group-column.drop-active').forEach(x=>x.classList.remove('drop-active'));});
  document.addEventListener('dragover',e=>{if(isTouchDevice())return;const col=e.target.closest('[data-group-drop]');if(col){e.preventDefault();col.classList.add('drop-active');}});
  document.addEventListener('dragleave',e=>{const col=e.target.closest('[data-group-drop]');if(col&&!col.contains(e.relatedTarget))col.classList.remove('drop-active');});
  document.addEventListener('drop',e=>{if(isTouchDevice())return;const col=e.target.closest('[data-group-drop]');if(col){e.preventDefault();const id=e.dataTransfer.getData('text/plain');moveTeam(id,col.dataset.groupDrop||'');}});

  UI.$('#serpentineBtn')?.addEventListener('click',()=>{assignments=store.serpentineAssignments(A.state());A.flash('#groupsMessage','Distribuzione bilanciata applicata in anteprima. Premi “Applica e rigenera” per salvarla.','ok');render();});
  UI.$('#randomBtn')?.addEventListener('click',()=>{assignments=store.randomAssignments(A.state());A.flash('#groupsMessage','Sorteggio casuale applicato in anteprima. Premi “Applica e rigenera” per salvarlo.','ok');render();});
  UI.$('#fromCalendarBtn')?.addEventListener('click',()=>{const s=A.state();const map=store.groupAssignmentsFromMatches(s);assignments={...assignments,...map};A.flash('#groupsMessage','Assegnazioni lette dal calendario generato.','ok');render();});
  UI.$('#clearAssignmentsBtn')?.addEventListener('click',()=>{Object.keys(assignments).forEach(k=>assignments[k]='');A.flash('#groupsMessage','Assegnazioni svuotate in anteprima.','ok');render();});
  UI.$('#applyGroupsBtn')?.addEventListener('click',applyAssignments);
  UI.$('#exportBackupBtn')?.addEventListener('click',downloadBackup);
  UI.$('#importBackupInput')?.addEventListener('change',e=>importBackup(e.target.files[0]));
  window.NexoraAdminRefresh=function(){try{render();}catch(_){}};
  window.addEventListener('ng:admin-state-loaded',()=>window.NexoraAdminRefresh());
})();
