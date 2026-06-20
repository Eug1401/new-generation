(function(){
 const store=NexoraStore, UI=NexoraUI, A=NexoraAdmin;
 let selectedTeam='';

 function normalizeName(v){return String(v||'').trim().replace(/\s+/g,' ');}
 function normalizeBirthYear(v){const n=Number(v);return Number.isInteger(n)&&n>=1900&&n<=2100?n:'';}
 function normalizeNumber(v){return store.normalizeJerseyNumber?store.normalizeJerseyNumber(v):(()=>{const n=Number(v);return Number.isInteger(n)&&n>=0&&n<=999?n:'';})();}
 function splitBulkList(text){
   return String(text||'')
    .replace(/[;|]+/g,'\n')
    .split(/\n|,/g)
    .map(normalizeName)
    .filter(line=>line && !/^[-–—_\s]*lista giocatori[-–—_\s]*$/i.test(line) && !/^[-–—_\s]+$/.test(line));
 }
 function parsePlayerLine(line){
   // Formato supportato (in qualsiasi ordine):
   //   "10 Rossi Marco 2010"   -> numero 10, nome "Rossi Marco", anno 2010
   //   "Rossi Marco #10 2010"  -> numero 10
   //   "Rossi Marco"           -> solo nome
   //   "2010 Rossi Marco"      -> anno + nome
   let raw=normalizeName(line);
   if(!raw)return null;
   let number='';
   // 1) numero esplicito con #
   const hashMatch=raw.match(/(?:^|\s)#(\d{1,3})(?:\s|$)/);
   if(hashMatch){number=Number(hashMatch[1]);raw=normalizeName(raw.replace(hashMatch[0],' '));}
   // 2) anno di nascita (inizio o fine)
   let birthYear='';
   const yearStart=raw.match(/^(19\d{2}|20\d{2})[\s,;.-]+(.+)$/);
   const yearEnd=raw.match(/^(.+?)[\s,;.-]+(19\d{2}|20\d{2})$/);
   if(yearStart){birthYear=Number(yearStart[1]);raw=normalizeName(yearStart[2]);}
   else if(yearEnd){birthYear=Number(yearEnd[2]);raw=normalizeName(yearEnd[1]);}
   // 3) numero in testa o in coda (1-3 cifre)
   if(number===''){
     const numStart=raw.match(/^(\d{1,3})[\s.\-]+(.+)$/);
     const numEnd=raw.match(/^(.+?)[\s.\-]+(\d{1,3})$/);
     if(numStart){number=Number(numStart[1]);raw=normalizeName(numStart[2]);}
     else if(numEnd){number=Number(numEnd[2]);raw=normalizeName(numEnd[1]);}
   }
   return raw?{name:raw,birthYear,number:normalizeNumber(number)}:null;
 }
 function addPlayerToTeam(team, name, birthYear, number){
   team.players=team.players||[];
   team.players.push({id:store.uid('player'),name:normalizeName(name),birthYear:normalizeBirthYear(birthYear),number:normalizeNumber(number)});
 }
 function setStaff(team, role, name){
   if(role==='president'){team.president=team.president||{id:store.uid('president'),name:''};team.president.name=normalizeName(name);}
   if(role==='coach'){team.coach=team.coach||{name:''};team.coach.name=normalizeName(name);}
 }
 function parseStaffLine(line){
   const m=String(line||'').match(/^\s*(presidente|president|allenatore|coach)\s*:\s*(.+)$/i);
   if(!m)return null;
   const role=/pres/i.test(m[1])?'president':'coach';
   return {role,name:normalizeName(m[2])};
 }
 function flashBulk(text,type='ok'){const el=UI.$('#bulkPlayersMsg');if(el)el.innerHTML=`<div class="message ${type}">${UI.esc(text)}</div>`;}
 function teamStatsSummary(s,t){
   const matches=(s.matches||[]).filter(m=>m.homeTeamId===t.id||m.awayTeamId===t.id);
   const played=matches.filter(m=>m.status==='played').length;
   const goals=(s.matches||[]).reduce((acc,m)=>{const sc=store.matchGoals(s,m);if(m.homeTeamId===t.id)return acc+sc.home;if(m.awayTeamId===t.id)return acc+sc.away;return acc;},0);
   return `${(t.players||[]).length} giocatori · ${played}/${matches.length} partite · ${goals} gol`;
 }
 function clearTeamRoster(teamId){
   const s=A.state();
   const t=store.getTeam(s,teamId);
   const count=(t?.players||[]).length;
   if(!t||!count){alert('Roster già vuoto.');return;}
   const ok=confirm(`Svuotare il roster di ${t.name}?\n\nVerranno eliminati ${count} calciatori e i loro marcatori/cartellini dai referti. Presidente, allenatore e squadra resteranno invariati.`);
   if(!ok)return;
   A.commit(state=>{
     const team=store.getTeam(state,teamId);
     if(!team)return;
     const ids=new Set((team.players||[]).map(p=>p.id));
     team.players=[];
     (state.matches||[]).forEach(m=>{
       m.goals=(m.goals||[]).filter(g=>!ids.has(g.playerId));
       m.cards=(m.cards||[]).filter(c=>!ids.has(c.playerId));
     });
   });
   renderTeamButtons();
   renderWorkspace('#playersTeamModalBody');
   setTimeout(()=>{const msg=UI.$('#bulkPlayersMsg'); if(msg)msg.innerHTML='<div class="message ok">Roster svuotato. Staff e squadra conservati.</div>';},0);
 }
 function renderTeamButtons(){
   const s=A.state(), box=UI.$('#playersTeamButtons'); if(!box) return;
   if(!s.teams.length){box.innerHTML='<div class="empty">Aggiungi prima almeno una squadra.</div>';return;}
   if(!selectedTeam || !s.teams.some(t=>t.id===selectedTeam)) selectedTeam=s.teams[0]?.id||'';
   box.innerHTML=s.teams.map(t=>`<button type="button" class="flow-pick-btn ${t.id===selectedTeam?'active':''}" data-player-team="${t.id}" aria-pressed="${t.id===selectedTeam?'true':'false'}">
     ${UI.logo(t,false)}
     <span><strong>${UI.esc(t.name)}</strong><small>${UI.esc(teamStatsSummary(s,t))}</small></span>
     <em>Gestisci</em>
   </button>`).join('');
 }
 function renderWorkspace(targetSelector='#playersWorkspace'){
   const s=A.state(), box=UI.$(targetSelector); if(!box) return;
   const t=store.getTeam(s,selectedTeam);
   if(!t){box.innerHTML='<div class="empty">Seleziona una squadra per gestire il roster.</div>';return;}
   box.innerHTML=`
    <div class="flow-workspace-head">
      <div class="team-profile-hero">${UI.logo(t,true)}<div><span class="pill">Squadra selezionata</span><h2>${UI.esc(t.name)}</h2><p class="muted">Gestione unica: staff, aggiunta singola, import rapido e modifica roster.</p></div></div>
      <div class="team-profile-meta compact-meta"><span><strong>Presidente</strong>${UI.esc(t.president?.name||'Non inserito')}</span><span><strong>Allenatore</strong>${UI.esc(t.coach?.name||'Non inserito')}</span><span><strong>Roster</strong>${(t.players||[]).length} calciatori</span></div>
      <div class="roster-danger-zone" aria-label="Azioni roster squadra">
        <div><strong>Svuota roster squadra</strong><small>Rimuove solo i calciatori e i loro eventi nei referti. Presidente, allenatore e squadra restano invariati.</small></div>
        <button class="btn danger" type="button" data-clear-team-roster="${t.id}" ${(t.players||[]).length?'':'disabled'}>Svuota roster</button>
      </div>
    </div>
    <div class="flow-accordion margin-top">
      <details class="ng-disclosure" open>
        <summary class="ng-disclosure-summary"><span class="disclosure-main"><span class="person-avatar">+</span><span><strong>Aggiungi calciatore</strong><small>Inserimento singolo, veloce e controllato.</small></span></span><span class="disclosure-action">Apri</span></summary>
        <div class="ng-disclosure-body">
          <form id="playerCreateForm" class="form-grid" data-team-id="${t.id}">
            <input type="hidden" name="teamId" value="${t.id}">
            <div><label>Numero maglia</label><input name="number" type="number" min="0" max="999" inputmode="numeric" placeholder="Es. 10" autocomplete="off"></div>
            <div><label>Cognome e nome</label><input name="name" required placeholder="Es. Rossi Marco" autocomplete="off"></div>
            <div><label>Anno di nascita</label><input name="birthYear" type="number" min="1900" max="2100" placeholder="Es. 2010"></div>
            <div class="field-full"><button class="btn primary" type="submit">Aggiungi al roster</button></div>
          </form>
        </div>
      </details>
      <details class="ng-disclosure">
        <summary class="ng-disclosure-summary"><span class="disclosure-main"><span class="person-avatar">⇣</span><span><strong>Aggiunta rapida</strong><small>Incolla lista: <em>numero · cognome nome · anno</em>.</small></span></span><span class="disclosure-action">Apri</span></summary>
        <div class="ng-disclosure-body">
          <form id="bulkPlayersForm" class="form-grid" data-team-id="${t.id}">
            <input type="hidden" name="teamId" value="${t.id}">
            <div class="field-full"><label>Lista</label><textarea name="players" rows="8" placeholder="presidente: Rossi Marco\nallenatore: Bianchi Luca\n10 Verdi Andrea 2010\n7 Neri Paolo\n#9 Gallo Matteo 2011\nBianchi Luca 2012"></textarea><small class="muted">Supporto numero maglia in testa (10 Rossi) o con # (#10 Rossi). Anno di nascita all'inizio o alla fine.</small></div>
            <div><label>Duplicati</label><select name="duplicateMode"><option value="skip">Salta nomi già presenti</option><option value="add">Aggiungi comunque</option></select></div>
            <div class="field-full"><button class="btn primary" type="submit">Importa lista</button><div id="bulkPlayersMsg"></div></div>
          </form>
        </div>
      </details>
      <details class="ng-disclosure" open>
        <summary class="ng-disclosure-summary"><span class="disclosure-main"><span class="person-avatar">${UI.esc(String((t.players||[]).length))}</span><span><strong>Roster e modifiche</strong><small>Apri ogni calciatore per modificare o eliminare.</small></span></span><span class="disclosure-action">Apri</span></summary>
        <div class="ng-disclosure-body"><div id="rosterList" class="stack"></div></div>
      </details>
    </div>`;
   A.renderRoster(selectedTeam,'#rosterList');
 }
 function ensurePlayersModal(){
   let modal=UI.$('#playersTeamModal');
   if(modal)return modal;
   modal=document.createElement('div');
   modal.className='modal admin-players-modal';
   modal.id='playersTeamModal';
   modal.setAttribute('role','dialog');
   modal.setAttribute('aria-modal','true');
   modal.innerHTML=`<div class="modal-content admin-players-content"><div class="match-task-toolbar"><div><span class="article-kicker">Gestione roster</span><h2 id="playersTeamModalTitle">Squadra</h2></div><button class="btn danger" id="closePlayersTeamModal" type="button">Chiudi</button></div><div id="playersTeamModalBody"></div></div>`;
   document.body.appendChild(modal);return modal;
 }
 function openPlayersTeam(teamId){
   selectedTeam=teamId;
   const t=store.getTeam(A.state(),selectedTeam);
   const modal=ensurePlayersModal();
   UI.$('#playersTeamModalTitle').textContent=t?`Gestione ${t.name}`:'Gestione squadra';
   renderWorkspace('#playersTeamModalBody');
   modal.classList.add('open');
   document.body.classList.add('modal-open');
   setTimeout(()=>UI.$('#closePlayersTeamModal')?.focus(),0);
 }
 function closePlayersModal(){UI.$('#playersTeamModal')?.classList.remove('open');document.body.classList.remove('modal-open');}
 function render(){renderTeamButtons(); const box=UI.$('#playersWorkspace'); if(box) box.innerHTML='<div class="empty">Clicca una squadra per aprire la schermata completa di gestione roster.</div>';}
 document.addEventListener('DOMContentLoaded',render);
 document.addEventListener('click',e=>{const btn=e.target.closest('[data-player-team]');if(btn){openPlayersTeam(btn.dataset.playerTeam);return;} if(e.target.id==='closePlayersTeamModal')closePlayersModal();
   if(e.target.id==='playersTeamModal'){e.preventDefault();e.stopPropagation();}});
 document.addEventListener('submit',e=>{
   const f=e.target;
   if(f.id==='playerCreateForm'){
     e.preventDefault();
     const fd=new FormData(f); selectedTeam=fd.get('teamId'); const name=normalizeName(fd.get('name')); if(!name)return;
     A.commit(s=>{const t=store.getTeam(s,selectedTeam); if(t)addPlayerToTeam(t,name,fd.get('birthYear'),fd.get('number'));});
     renderTeamButtons(); renderWorkspace('#playersTeamModalBody');
   }
   if(f.id==='bulkPlayersForm'){
     e.preventDefault(); const fd=new FormData(f); selectedTeam=fd.get('teamId'); const lines=splitBulkList(fd.get('players')); const duplicateMode=fd.get('duplicateMode')||'skip';
     let added=0, skipped=0, staff=0;
     if(!lines.length){flashBulk('Incolla almeno un giocatore, un presidente o un allenatore.','error');return;}
     A.commit(s=>{const t=store.getTeam(s,selectedTeam); if(!t)return; const existing=new Set((t.players||[]).map(p=>normalizeName(p.name).toLowerCase()));
       lines.forEach(line=>{
         const staffLine=parseStaffLine(line);
         if(staffLine){setStaff(t,staffLine.role,staffLine.name);staff++;return;}
         const parsed=parsePlayerLine(line); if(!parsed||!parsed.name)return;
         const key=parsed.name.toLowerCase(); if(duplicateMode==='skip'&&existing.has(key)){skipped++;return;}
         addPlayerToTeam(t,parsed.name,parsed.birthYear,parsed.number); existing.add(key); added++;
       });
     });
     renderTeamButtons(); renderWorkspace('#playersTeamModalBody'); setTimeout(()=>flashBulk(`Aggiunti ${added} giocatori${staff?`, aggiornati ${staff} dati staff`:''}${skipped?`, saltati ${skipped} duplicati`:''}.`,'ok'),0);
   }
   if(f.classList.contains('player-edit-form')){
     e.preventDefault(); const fd=new FormData(f);
     A.commit(s=>{const t=store.getTeam(s,f.dataset.teamId); const p=t?.players.find(x=>x.id===f.dataset.playerId); if(p){p.name=normalizeName(fd.get('name'));p.birthYear=normalizeBirthYear(fd.get('birthYear'));p.number=normalizeNumber(fd.get('number'));delete p.role;}});
     renderTeamButtons(); renderWorkspace('#playersTeamModalBody');
   }
 });
 document.addEventListener('click',e=>{
   const clear=e.target.closest('[data-clear-team-roster]');
   if(clear){clearTeamRoster(clear.dataset.clearTeamRoster);return;}
   const d=e.target.closest('[data-delete-player]');
   if(d&&confirm('Eliminare calciatore e tutti i suoi eventi?')){A.commit(s=>{const t=store.getTeam(s,d.dataset.teamId);if(t)t.players=t.players.filter(p=>p.id!==d.dataset.deletePlayer);s.matches.forEach(m=>{m.goals=m.goals.filter(g=>g.playerId!==d.dataset.deletePlayer);m.cards=m.cards.filter(c=>c.playerId!==d.dataset.deletePlayer);});});renderTeamButtons();renderWorkspace('#playersTeamModalBody');}
 });

 // Realtime: re-render quando arriva uno stato aggiornato da Supabase
 window.NexoraAdminRefresh=function(){renderTeamButtons();const modalOpen=UI.$('#playersTeamModal')?.classList.contains('open');if(modalOpen)renderWorkspace('#playersTeamModalBody');else{const box=UI.$('#playersWorkspace');if(box)box.innerHTML='<div class="empty">Clicca una squadra per aprire la schermata completa di gestione roster.</div>';}};
 window.addEventListener('ng:admin-state-loaded',()=>window.NexoraAdminRefresh());
})();
