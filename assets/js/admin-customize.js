(function(){
 const store=NexoraStore, UI=NexoraUI, A=NexoraAdmin;
 function fileToDataURL(file){return new Promise((resolve,reject)=>{
  if(!file){resolve('');return;} if(!file.type.startsWith('image/')){reject(new Error('Carica solo immagini.'));return;}
  const reader=new FileReader(); reader.onerror=()=>reject(new Error('Impossibile leggere il logo.'));
  reader.onload=()=>{const img=new Image(); img.onerror=()=>reject(new Error('Formato immagine non valido.'));
    img.onload=()=>{const max=720; const scale=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale)); const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height); resolve(c.toDataURL('image/png'));};
    img.src=reader.result;}; reader.readAsDataURL(file);
 });}
 function renderPreview(s){
  const box=UI.$('#customPreview'); if(!box)return; const site=s.site||store.defaultSite();
  box.innerHTML=`<article class="custom-preview-card"><div class="brand-preview">${UI.siteLogoMarkup(s,true)}<div><span class="pill">Anteprima live</span><h2>${UI.esc(UI.siteTitle(s))}</h2><p>${UI.esc(UI.siteSubtitle(s)||'')}</p></div></div><div class="preview-match"><span>Match center</span><strong>Squadra A vs Squadra B</strong><small>Colore principale e bordi usano il tema scelto.</small></div><div class="row-actions"><button class="btn primary" type="button">Azione primaria</button><button class="btn" type="button">Azione secondaria</button></div></article>`;
 }
 function render(){const s=A.state(); UI.applySiteTheme(s); const site={...store.defaultSite(),...(s.site||{})};
  const form=UI.$('#customizeForm'); if(!form)return;
  form.title.value=site.title||''; form.subtitle.value=site.subtitle||''; form.primary.value=site.primary||'#fff45a'; form.accent.value=site.accent||'#d2a63a'; form.surface.value=site.surface||'#17170f'; form.radius.value=site.radius||'24';
  renderPreview(s);
 }
 document.addEventListener('DOMContentLoaded',render);
 document.addEventListener('input',e=>{if(!e.target.closest('#customizeForm'))return; const s=A.state(); const fd=new FormData(UI.$('#customizeForm')); s.site=store.normalizeSite({...s.site,title:fd.get('title'),subtitle:fd.get('subtitle'),primary:fd.get('primary'),accent:fd.get('accent'),surface:fd.get('surface'),radius:fd.get('radius')}); UI.applySiteTheme(s); renderPreview(s);});
 document.addEventListener('submit',async e=>{const f=e.target;if(f.id!=='customizeForm')return; e.preventDefault(); const fd=new FormData(f); try{const logo=await fileToDataURL(fd.get('logoFile')); A.commit(s=>{s.site=store.normalizeSite({...s.site,title:fd.get('title'),subtitle:fd.get('subtitle'),primary:fd.get('primary'),accent:fd.get('accent'),surface:fd.get('surface'),radius:fd.get('radius')}); if(logo)s.site.logo=logo; if(fd.get('removeLogo')==='on')s.site.logo='';}); UI.$('#customizeMsg').innerHTML='<div class="message ok">Personalizzazione salvata. Il sito pubblico userà logo, nome e colori scelti.</div>'; f.removeLogo.checked=false; render();}catch(err){UI.$('#customizeMsg').innerHTML=`<div class="message error">${UI.esc(err.message||err)}</div>`;}});
 document.addEventListener('click',e=>{const b=e.target.closest('#resetThemeBtn'); if(!b)return; if(confirm('Ripristinare nome, colori e logo grafico predefiniti?')){A.commit(s=>{s.site=store.defaultSite();}); render(); UI.$('#customizeMsg').innerHTML='<div class="message ok">Tema predefinito ripristinato.</div>';}});
 window.NexoraAdminRefresh=function(){render();};
 window.addEventListener('ng:admin-state-loaded',()=>render());
})();
