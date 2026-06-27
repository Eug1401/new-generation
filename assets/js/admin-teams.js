(function(){
 'use strict';
 const store=window.NexoraStore, A=window.NexoraAdmin, Logos=window.NexoraTeamLogos;
 let migrationRunning=false;

 function render(){
  try{window.NexoraUI?.injectTeamLogoStyles?.(A.state());}catch(_){}
  A.renderTeamsList('#teamsList');
  renderLogoOptimizationStatus();
 }
 function selectedFile(fd){const file=fd.get('logoFile');return file instanceof File&&file.name&&file.size?file:null;}
 function setBusy(button,on,label){
  if(!button)return;
  if(window.NGInteractive?.setButtonBusy){window.NGInteractive.setButtonBusy(button,on,label);return;}
  if(on){button.dataset.oldText=button.textContent;button.disabled=true;if(label)button.textContent=label;}
  else{button.disabled=false;if(button.dataset.oldText)button.textContent=button.dataset.oldText;delete button.dataset.oldText;}
 }
 function humanBytes(bytes){
  const n=Number(bytes)||0;if(n<1024)return `${n} B`;if(n<1024*1024)return `${Math.round(n/1024)} kB`;return `${(n/1024/1024).toFixed(2)} MB`;
 }
 function optimizationNodes(){return {panel:document.getElementById('logoOptimizationPanel'),text:document.getElementById('logoOptimizationText'),button:document.getElementById('optimizeLogosBtn')};}
 function maybeAutoMigrate(delay=0){
  setTimeout(()=>{
   try{
    if(sessionStorage.getItem('ng-logo-migration-attempt-v133'))return;
    if(!(Logos?.legacyTeams?.(A.state())||[]).length)return;
    sessionStorage.setItem('ng-logo-migration-attempt-v133','1');
    runLogoMigration({automatic:true});
   }catch(_){}
  },delay);
 }
 function renderLogoOptimizationStatus(message='',type='warn'){
  const {panel,text,button}=optimizationNodes();if(!panel||!text)return;
  const state=A.state();const legacy=Logos?.legacyTeams?.(state)||[];
  if(!legacy.length&&!migrationRunning){panel.hidden=true;return;}
  panel.hidden=false;panel.dataset.type=type;
  if(message)text.textContent=message;
  else text.textContent=`${legacy.length} loghi sono ancora incorporati nel database (${humanBytes(Logos?.estimateLegacyBytes?.(state)||0)}). L’ottimizzazione li sposta su Cloudinary e riduce il traffico PostgREST di circa il 98%.`;
  if(button){button.hidden=!legacy.length;button.disabled=migrationRunning;}
 }

 async function runLogoMigration({automatic=false}={}){
  if(migrationRunning||!Logos)return false;
  const snapshot=A.state();const legacy=Logos.legacyTeams(snapshot);
  if(!legacy.length){renderLogoOptimizationStatus();return true;}
  migrationRunning=true;
  const {button}=optimizationNodes();setBusy(button,true,'Ottimizzazione…');
  renderLogoOptimizationStatus(`Preparazione di ${legacy.length} loghi…`,'warn');
  try{
   const result=await Logos.migrateState(snapshot,{onProgress:({index,total,team,status})=>{
    const done=Math.min(index,total);const verb=status==='uploading'?'Caricamento':status==='preparing'?'Preparazione':status==='failed'?'Errore su':'Completato';
    renderLogoOptimizationStatus(`${verb} ${team?.name||'logo'} · ${done}/${total}`,'warn');
   }});
   if(result.migrated){
    // Applica al più recente stato locale soltanto i campi logo, senza sovrascrivere
    // eventuali modifiche contemporanee a partite, roster o calendario.
    const latest=A.state();
    const migratedById=new Map((result.state.teams||[]).filter(t=>t.logo&&!Logos.isDataUrl(t.logo)).map(t=>[t.id,t]));
    (latest.teams||[]).forEach(team=>{
     const migrated=migratedById.get(team.id);if(!migrated)return;
     team.logo=migrated.logo;team.logoPublicId=migrated.logoPublicId||'';team.logoVersion=migrated.logoVersion||0;team.logoMigratedAt=migrated.logoMigratedAt||new Date().toISOString();
    });
    A.save(latest);
    try{await Promise.race([window.NG_FLUSH_REMOTE_SAVE?.()||Promise.resolve(),new Promise(resolve=>setTimeout(resolve,12000))]);}catch(_){}
   }
   render();
   if(result.failed.length){
    renderLogoOptimizationStatus(`${result.migrated} loghi ottimizzati; ${result.failed.length} non riusciti. ${result.failed[0].message}`,'error');
    if(!automatic)alert(`Ottimizzazione parziale: ${result.migrated} completati, ${result.failed.length} falliti.\n\n${result.failed.map(f=>`${f.teamName}: ${f.message}`).join('\n')}`);
    return false;
   }
   renderLogoOptimizationStatus(`${result.migrated} loghi ottimizzati e salvati online.`,'ok');
   setTimeout(()=>renderLogoOptimizationStatus(),2500);
   return true;
  }catch(error){
   const message=Logos.userMessage(error);
   renderLogoOptimizationStatus(message,'error');
   if(!automatic)alert(message);
   return false;
  }finally{
   migrationRunning=false;setBusy(button,false);renderLogoOptimizationStatus();
  }
 }

 document.addEventListener('DOMContentLoaded',()=>{
  render();
  // Migrazione automatica una tantum per questa scheda. Se la Edge Function non
  // è stata ancora ridistribuita, il pannello resta visibile con il messaggio utile.
  maybeAutoMigrate(2200);
 });

 document.addEventListener('submit',async e=>{
  const f=e.target;
  if(f.id==='teamCreateForm'){
   e.preventDefault();const submit=f.querySelector('[type="submit"]');setBusy(submit,true,'Salvataggio…');
   try{
    const fd=new FormData(f);const name=(fd.get('name')||'').trim();if(!name){alert('Inserisci il nome della squadra.');return;}
    const id=store.uid('team');const file=selectedFile(fd);let logo=null;
    if(file){if(!Logos)throw new Error('Modulo upload loghi non disponibile.');logo=await Logos.upload(id,name,file);}
    A.commit(s=>s.teams.push({id,name,logo:logo?.url||'',logoPublicId:logo?.publicId||'',logoVersion:logo?.version||0,president:{id:store.uid('president'),name:(fd.get('presidentName')||'').trim()},coach:{name:(fd.get('coachName')||'').trim()},players:[]}));
    f.reset();render();
   }catch(err){alert(Logos?.userMessage?.(err)||err.message||'Impossibile salvare la squadra.');}
   finally{setBusy(submit,false);}
  }
  if(f.classList.contains('team-edit-form')){
   e.preventDefault();const submit=f.querySelector('[type="submit"]');setBusy(submit,true,'Salvataggio…');
   try{
    const fd=new FormData(f);const name=(fd.get('name')||'').trim();if(!name){alert('Il nome squadra non può essere vuoto.');return;}
    const current=store.getTeam(A.state(),f.dataset.teamId);if(!current)throw new Error('Squadra non trovata.');
    const file=selectedFile(fd);let logo=null;if(file){if(!Logos)throw new Error('Modulo upload loghi non disponibile.');logo=await Logos.upload(current.id,name,file);}
    A.commit(s=>{const t=store.getTeam(s,f.dataset.teamId);if(t){
     t.name=name;t.president=t.president||{id:store.uid('president'),name:''};t.president.name=(fd.get('presidentName')||'').trim();t.coach=t.coach||{name:''};t.coach.name=(fd.get('coachName')||'').trim();
     if(logo){t.logo=logo.url;t.logoPublicId=logo.publicId||'';t.logoVersion=logo.version||0;t.logoMigratedAt=new Date().toISOString();}
    }});render();
   }catch(err){alert(Logos?.userMessage?.(err)||err.message||'Impossibile salvare le modifiche della squadra.');}
   finally{setBusy(submit,false);}
  }
 });

 document.addEventListener('click',e=>{
  const optimize=e.target.closest('#optimizeLogosBtn');if(optimize){runLogoMigration({automatic:false});return;}
  const clearAll=e.target.closest('[data-clear-all-staff]');
  if(clearAll){
   if(confirm('Pulire presidente e allenatore di tutte le squadre? I roster, i loghi, il calendario e gli orari resteranno invariati. Se in Kings League un presidente era marcatore, i suoi gol saranno rimossi dal referto.')){
    A.commit(s=>{(s.teams||[]).forEach(t=>{t.president=t.president||{id:store.uid('president'),name:''};t.president.name='';t.coach=t.coach||{name:''};t.coach.name='';});store.alignState(s);});render();
   }return;
  }
  const clearTeam=e.target.closest('[data-clear-team-staff]');
  if(clearTeam){
   const teamId=clearTeam.dataset.clearTeamStaff;const team=store.getTeam(A.state(),teamId);
   if(team&&confirm(`Pulire presidente e allenatore di ${team.name}? Il roster e il calendario resteranno invariati. Se il presidente era marcatore in Kings League, i suoi gol saranno rimossi dal referto.`)){
    A.commit(s=>{const t=store.getTeam(s,teamId);if(t){t.president=t.president||{id:store.uid('president'),name:''};t.president.name='';t.coach=t.coach||{name:''};t.coach.name='';}store.alignState(s);});render();
   }return;
  }
  const d=e.target.closest('[data-delete-team]');
  if(d&&confirm('Eliminare squadra, giocatori, partite ed eventi collegati?')){
   const team=store.getTeam(A.state(),d.dataset.deleteTeam);const logoPublicId=team?.logoPublicId||'';
   A.commit(s=>{const id=d.dataset.deleteTeam;s.teams=s.teams.filter(t=>t.id!==id);s.matches=s.matches.filter(m=>m.homeTeamId!==id&&m.awayTeamId!==id);});render();
   if(logoPublicId&&Logos)Logos.remove(logoPublicId).catch(err=>console.warn('Pulizia logo Cloudinary non completata:',err));
  }
 });

 window.NexoraAdminRefresh=function(){try{render();}catch(_){}};
 window.addEventListener('ng:admin-state-loaded',()=>{window.NexoraAdminRefresh();maybeAutoMigrate(300);});
})();
