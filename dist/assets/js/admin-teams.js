(function(){
 const store=NexoraStore, A=NexoraAdmin;
 function fileToDataURL(file){return new Promise((resolve,reject)=>{
  // Quando l'input file è vuoto, FormData può restituire comunque un File
  // "fantasma" con name vuoto/size 0. In quel caso non va bloccato il salvataggio
  // di modifiche testuali come presidente o allenatore.
  if(!file||!file.name||file.size===0){resolve('');return;}
  if(!file.type||!file.type.startsWith('image/')){reject(new Error('Carica solo immagini.'));return;}
  const reader=new FileReader();
  reader.onerror=()=>reject(new Error('Impossibile leggere il logo.'));
  reader.onload=()=>{
    const img=new Image();
    img.onerror=()=>reject(new Error('Formato logo non valido.'));
    img.onload=()=>{
      const max=512;
      const scale=Math.min(1,max/Math.max(img.width,img.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));
      canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      // PNG mantiene la trasparenza dei loghi, ma viene ridimensionato per evitare quota exceeded.
      resolve(canvas.toDataURL('image/png'));
    };
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
});}
 function render(){A.renderTeamsList('#teamsList');}
 document.addEventListener('DOMContentLoaded',render);
 document.addEventListener('submit',async e=>{
  const f=e.target;
  if(f.id==='teamCreateForm'){
   e.preventDefault();
   try{
    const fd=new FormData(f);
    const name=(fd.get('name')||'').trim();
    if(!name){alert('Inserisci il nome della squadra.');return;}
    const uploaded=await fileToDataURL(fd.get('logoFile'));
    A.commit(s=>s.teams.push({id:store.uid('team'),name,logo:uploaded||'',president:{id:store.uid('president'),name:(fd.get('presidentName')||'').trim()},coach:{name:(fd.get('coachName')||'').trim()},players:[]}));
    f.reset();render();
   }catch(err){alert(err.message||'Impossibile salvare la squadra.');}
  }
  if(f.classList.contains('team-edit-form')){
   e.preventDefault();
   try{
    const fd=new FormData(f);
    const name=(fd.get('name')||'').trim();
    if(!name){alert('Il nome squadra non può essere vuoto.');return;}
    const uploaded=await fileToDataURL(fd.get('logoFile'));
    A.commit(s=>{const t=store.getTeam(s,f.dataset.teamId);if(t){
     t.name=name;
     t.president=t.president||{id:store.uid('president'),name:''};
     t.president.name=(fd.get('presidentName')||'').trim();
     t.coach=t.coach||{name:''};
     t.coach.name=(fd.get('coachName')||'').trim();
     if(uploaded)t.logo=uploaded;
    }});
    render();
   }catch(err){alert(err.message||'Impossibile salvare le modifiche della squadra.');}
  }
 });
 document.addEventListener('click',e=>{
  const clearAll=e.target.closest('[data-clear-all-staff]');
  if(clearAll){
    if(confirm('Pulire presidente e allenatore di tutte le squadre? I roster, i loghi, il calendario e gli orari resteranno invariati. Se in Kings League un presidente era marcatore, i suoi gol saranno rimossi dal referto.')){
      A.commit(s=>{(s.teams||[]).forEach(t=>{t.president=t.president||{id:store.uid('president'),name:''};t.president.name='';t.coach=t.coach||{name:''};t.coach.name='';});store.alignState(s);});
      render();
    }
    return;
  }
  const clearTeam=e.target.closest('[data-clear-team-staff]');
  if(clearTeam){
    const teamId=clearTeam.dataset.clearTeamStaff;
    const team=store.getTeam(A.state(),teamId);
    if(team&&confirm(`Pulire presidente e allenatore di ${team.name}? Il roster e il calendario resteranno invariati. Se il presidente era marcatore in Kings League, i suoi gol saranno rimossi dal referto.`)){
      A.commit(s=>{const t=store.getTeam(s,teamId);if(t){t.president=t.president||{id:store.uid('president'),name:''};t.president.name='';t.coach=t.coach||{name:''};t.coach.name='';}store.alignState(s);});
      render();
    }
    return;
  }
  const d=e.target.closest('[data-delete-team]');
  if(d&&confirm('Eliminare squadra, giocatori, partite ed eventi collegati?')){A.commit(s=>{const id=d.dataset.deleteTeam;s.teams=s.teams.filter(t=>t.id!==id);s.matches=s.matches.filter(m=>m.homeTeamId!==id&&m.awayTeamId!==id);});render();}
 });
 window.NexoraAdminRefresh=function(){try{render();}catch(_){}};
 window.addEventListener('ng:admin-state-loaded',()=>window.NexoraAdminRefresh());
})();
