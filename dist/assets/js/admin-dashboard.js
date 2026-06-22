(function(){
  function renderIntegrity(){
    const box=document.getElementById('dashboardIntegrity');
    if(!box)return;
    const s=NexoraAdmin.state();
    const report=NexoraStore.integrityReport(s);
    const details=report.details||[];
    const errors=details.filter(i=>i.severity==='error').length;
    const warnings=details.length-errors;
    const grouped=details.reduce((acc,i)=>{(acc[i.area]=acc[i.area]||[]).push(i);return acc;},{});
    const list=Object.entries(grouped).map(([area,items])=>`<details class="integrity-group" ${items.some(i=>i.severity==='error')?'open':''}><summary><strong>${NexoraUI.esc(area)}</strong> · ${items.length} controllo/i</summary><ul>${items.slice(0,12).map(i=>`<li class="${i.severity==='error'?'error-text':'warn-text'}">${NexoraUI.esc(i.message)}</li>`).join('')}</ul>${items.length>12?`<p class="muted">Altri ${items.length-12} controlli non mostrati.</p>`:''}</details>`).join('');
    const snapshot=report.snapshot;
    const snap=snapshot?`<div class="integrity-snapshot"><span><strong>${snapshot.stats.matches}</strong> partite</span><span><strong>${snapshot.stats.goals}</strong> gol</span><span><strong>${snapshot.scorers.length}</strong> marcatori</span><span><strong>${snapshot.groups.length}</strong> gironi</span></div>`:'';
    box.innerHTML=`<div class="message ${errors?'error':warnings?'warn':'ok'}"><strong>${NexoraUI.esc(report.message)}</strong><br><span class="muted">Controllo fonte unica: regole, squadre, giocatori e referti generano classifiche, marcatori, calendario, tabellone, sito pubblico e PDF.</span>${snap}<div class="row-actions margin-top"><button class="btn small" id="copyAuditBtn" type="button">Copia report</button></div></div>${list||'<div class="help-box">Nessuna incoerenza trovata. Le viste sono già derivate dai dati reali e si aggiornano senza pulsanti manuali.</div>'}`;
  }

  function adminActionPlan(s){
    const matches=s.matches||[], teams=s.teams||[];
    const played=matches.filter(m=>NexoraStore.hasScore(s,m)||m.status==='played').length;
    const pending=matches.length-played;
    const emptyRosters=teams.filter(t=>!(t.players||[]).length).length;
    const missingStaff=teams.filter(t=>!t.president?.name||!t.coach?.name).length;
    const firstPending=matches.filter(m=>!(NexoraStore.hasScore(s,m)||m.status==='played')).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))||String(a.time||'99:99').localeCompare(String(b.time||'99:99')))[0];
    const percent=matches.length?Math.round((played/matches.length)*100):0;
    return {played,pending,emptyRosters,missingStaff,firstPending,percent};
  }
  function renderAdminCockpit(){
    const stats=document.getElementById('dashboardStats'); if(!stats)return;
    const s=NexoraAdmin.state(); const plan=adminActionPlan(s);
    let box=document.getElementById('dashboardCockpit');
    if(!box){box=document.createElement('div');box.id='dashboardCockpit';box.className='admin-cockpit margin-top';stats.insertAdjacentElement('afterend',box);}
    const next=plan.firstPending?`${NexoraStore.teamName(s,plan.firstPending.homeTeamId,plan.firstPending.homeLabel)} vs ${NexoraStore.teamName(s,plan.firstPending.awayTeamId,plan.firstPending.awayLabel)}`:'Nessuna partita aperta';
    const nextHref=plan.firstPending?`admin-matches.html?match=${encodeURIComponent(plan.firstPending.id)}`:'admin-matches.html';
    box.innerHTML=`<div class="admin-cockpit-head"><div><span class="pill">Control room</span><h3>Stato operativo torneo</h3><p class="muted">Vista rapida per capire cosa manca prima della pubblicazione o della stampa.</p></div><strong>${plan.percent}%</strong></div><div class="admin-cockpit-grid"><a href="${nextHref}"><span>Prossimo referto</span><strong>${NexoraUI.esc(next)}</strong><small>${plan.firstPending?'Apre subito la gestione della partita':plan.pending+' partite da giocare'}</small></a><a href="admin-players.html"><span>Roster vuoti</span><strong>${plan.emptyRosters}</strong><small>Squadre senza calciatori</small></a><a href="admin-teams.html"><span>Staff incompleto</span><strong>${plan.missingStaff}</strong><small>Presidente o allenatore mancanti</small></a><a href="admin-reports.html"><span>Report</span><strong>PDF</strong><small>Classifiche, calendario e recap</small></a></div>`;
  }

  document.addEventListener('DOMContentLoaded',()=>{NexoraAdmin.renderStats('#dashboardStats');renderAdminCockpit();renderIntegrity();});
  document.addEventListener('click',e=>{
    if(e.target.id==='copyAuditBtn'){
      const report=NexoraStore.integrityReport(NexoraAdmin.state());
      const lines=[report.message,...(report.details||[]).map(i=>`[${i.severity.toUpperCase()}] ${i.area}: ${i.message}`)];
      navigator.clipboard?.writeText(lines.join('\n'));
      alert('Report copiato negli appunti.');
    }
  });
})();

// v21: import sicuro backup JSON creato dal reset
(function(){
  let selectedBackupRaw='';
  function fileToText(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('Impossibile leggere il file.'));r.readAsText(file);});}
  function renderBackupPreview(parsed){
    const box=document.getElementById('backupPreview');
    if(!box)return;
    const state=parsed.state;
    const meta=parsed.payload?.meta||{};
    const exported=parsed.payload?.exportedAt?new Date(parsed.payload.exportedAt).toLocaleString('it-IT'):'Data non disponibile';
    const players=(state.teams||[]).reduce((sum,t)=>sum+(t.players||[]).length,0);
    box.innerHTML=`<span class="pill">Backup valido</span><h3>${NexoraUI.esc(state.rules?.name||meta.tournamentName||'New Generation')}</h3><p class="muted">Esportato: ${NexoraUI.esc(exported)}</p><div class="mini-grid"><span><strong>${(state.teams||[]).length}</strong><br>Squadre</span><span><strong>${players}</strong><br>Giocatori</span><span><strong>${(state.matches||[]).length}</strong><br>Partite</span><span><strong>${(state.articles||[]).length}</strong><br>Articoli</span></div>`;
  }
  function resetBackupUi(){
    selectedBackupRaw='';
    const f=document.getElementById('backupImportFile');if(f)f.value='';
    const btn=document.getElementById('backupImportBtn');if(btn)btn.disabled=true;
    const msg=document.getElementById('backupImportMsg');if(msg)msg.innerHTML='';
    const box=document.getElementById('backupPreview');if(box)box.innerHTML='<strong>Nessun backup selezionato</strong><p class="muted">Seleziona un file per vedere nome torneo, squadre, partite e data esportazione.</p>';
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const input=document.getElementById('backupImportFile');
    const btn=document.getElementById('backupImportBtn');
    const clear=document.getElementById('backupClearBtn');
    const msg=document.getElementById('backupImportMsg');
    if(!input||!btn)return;
    input.addEventListener('change',async()=>{
      const file=input.files&&input.files[0];
      if(!file){resetBackupUi();return;}
      try{
        selectedBackupRaw=await fileToText(file);
        const parsed=NexoraAdmin.parseBackupPayload(selectedBackupRaw);
        renderBackupPreview(parsed);
        btn.disabled=false;
        if(msg)msg.innerHTML='<div class="message ok">Backup valido. Puoi ripristinarlo quando vuoi.</div>';
      }catch(err){
        selectedBackupRaw='';btn.disabled=true;
        if(msg)msg.innerHTML=`<div class="message error">${NexoraUI.esc(err.message||err)}</div>`;
      }
    });
    clear?.addEventListener('click',resetBackupUi);
    btn.addEventListener('click',()=>{
      if(!selectedBackupRaw)return;
      try{
        const ok=NexoraAdmin.importStateBackup(selectedBackupRaw,{reload:true});
        if(ok&&msg)msg.innerHTML='<div class="message ok">Backup ripristinato. Ricarico la pagina...</div>';
      }catch(err){
        if(msg)msg.innerHTML=`<div class="message error">${NexoraUI.esc(err.message||err)}</div>`;
      }
    });
  });
  window.NexoraAdminRefresh=function(){
    try{NexoraAdmin.renderStats('#dashboardStats');renderAdminCockpit();renderIntegrity();}catch(_){}
  };
  window.addEventListener('ng:admin-state-loaded',()=>window.NexoraAdminRefresh());
})();
