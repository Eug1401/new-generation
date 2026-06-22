(function(){
  const store=window.NexoraStore, UI=window.NexoraUI, Admin=window.NexoraAdmin;
  const $=UI.$;
  const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp']);
  const MAX_IMAGE_BYTES=12*1024*1024;
  const MAX_IMAGE_EDGE=1600;
  let editingId='';
  let currentImage='';
  let baselineSignature='';
  let slugTouched=false;
  let deleteArticleId='';
  let deleteArticleTrigger=null;
  let previewTrigger=null;
  let previewArticleId='';
  let suppressDirty=false;

  function allArticles(){return store.selectors.allArticles(Admin.state());}
  function refreshPublicCache(snapshot){try{store.save('public',snapshot);}catch(_){} }
  function articleById(id){return store.selectors.articleById(Admin.state(),id,{includeDrafts:true});}
  function toLocalDateTime(value){
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }
  function fromLocalDateTime(value){
    if(!value)return '';
    const date=new Date(value);
    return Number.isNaN(date.getTime())?'':date.toISOString();
  }
  function parseTags(value){return [...new Set(String(value||'').split(',').map(v=>v.trim()).filter(Boolean))].slice(0,12);}
  function uniqueSlug(value,id=''){
    const base=store.articleSlug(value||$('#articleTitle')?.value||'articolo');
    const used=new Set(allArticles().filter(a=>a.id!==id).map(a=>a.slug));
    let slug=base,n=2;
    while(used.has(slug))slug=`${base.slice(0,Math.max(1,86-String(n).length))}-${n++}`;
    return slug;
  }
  function formSnapshot(){
    return {
      id:editingId,
      title:$('#articleTitle')?.value.trim()||'',
      subtitle:$('#articleSubtitle')?.value.trim()||'',
      excerpt:$('#articleExcerpt')?.value.trim()||'',
      author:$('#articleAuthor')?.value.trim()||'',
      category:$('#articleCategory')?.value.trim()||'',
      tags:parseTags($('#articleTags')?.value),
      body:$('#articleBody')?.value.trim()||'',
      image:currentImage||'',
      imageAlt:$('#articleImageAlt')?.value.trim()||'',
      imageCaption:$('#articleImageCaption')?.value.trim()||'',
      status:$('#articleStatus')?.value||'published',
      publishedAt:fromLocalDateTime($('#articlePublishedAt')?.value||''),
      slug:uniqueSlug($('#articleSlug')?.value||$('#articleTitle')?.value||'articolo',editingId),
      seoTitle:$('#articleSeoTitle')?.value.trim()||'',
      seoDescription:$('#articleSeoDescription')?.value.trim()||''
    };
  }
  function snapshotSignature(){return JSON.stringify(formSnapshot());}
  function isDirty(){return Boolean(baselineSignature&&snapshotSignature()!==baselineSignature);}
  function setBaseline(){baselineSignature=snapshotSignature();updateDirtyState();}
  function updateDirtyState(){
    const dirty=isDirty();
    const submit=$('#articleSubmitBtn');
    if(submit)submit.dataset.unsaved=dirty?'true':'false';
    const title=$('#articleFormTitle');
    if(title)title.dataset.unsaved=dirty?'true':'false';
  }
  function updateCounters(){
    const pairs=[['#articleTitle','#articleTitleCount'],['#articleSubtitle','#articleSubtitleCount'],['#articleExcerpt','#articleExcerptCount'],['#articleBody','#articleBodyCount']];
    pairs.forEach(([field,count])=>{const a=$(field),b=$(count);if(a&&b)b.textContent=String(a.value.length);});
  }
  function setFormMode(article=null){
    const title=$('#articleFormTitle'),hint=$('#articleFormHint'),submit=$('#articleSubmitBtn'),cancel=$('#cancelEditArticleBtn');
    if(title)title.textContent=article?'Modifica articolo':'Nuovo articolo';
    if(hint)hint.textContent=article?'Aggiorna i contenuti, controlla l’anteprima e salva senza perdere i dati esistenti.':'Compila i campi principali, controlla l’anteprima e scegli se pubblicare o salvare come bozza.';
    if(submit)submit.textContent=article?'Salva modifiche':'Salva articolo';
    if(cancel)cancel.hidden=!article;
  }
  function previewMarkup(image,title,alt=''){
    if(!image)return '<div class="article-image article-placeholder small"><span>NG</span><small>NEWS</small></div><span class="muted">Nessuna immagine selezionata.</span>';
    return `<img class="article-image small" src="${UI.esc(image)}" alt="${UI.esc(alt||`Anteprima immagine ${title||'articolo'}`)}"><span class="muted">Anteprima reale dell’immagine salvata.</span>`;
  }
  function refreshImagePreview(){
    const box=$('#articleImagePreview');
    if(box)box.innerHTML=previewMarkup(currentImage,$('#articleTitle')?.value,$('#articleImageAlt')?.value);
  }
  function clearValidation(){
    ['articleTitle','articleBody','articlePublishedAt','articleSlug'].forEach(id=>$('#'+id)?.removeAttribute('aria-invalid'));
    const box=$('#articleFormErrors');if(box)box.innerHTML='';
  }
  function showValidation(errors){
    clearValidation();
    if(!errors.length)return true;
    const box=$('#articleFormErrors');
    if(box)box.innerHTML=`<div class="message error"><strong>Controlla questi campi:</strong><ul>${errors.map(e=>`<li>${UI.esc(e.message)}</li>`).join('')}</ul></div>`;
    errors.forEach(e=>$('#'+e.field)?.setAttribute('aria-invalid','true'));
    $('#'+errors[0].field)?.focus();
    return false;
  }
  function validateArticle(data){
    const errors=[];
    if(!data.title)errors.push({field:'articleTitle',message:'Il titolo è obbligatorio.'});
    if(!data.body)errors.push({field:'articleBody',message:'Il testo completo è obbligatorio.'});
    if(data.status==='scheduled'&&!data.publishedAt)errors.push({field:'articlePublishedAt',message:'Indica la data per un articolo programmato.'});
    if(data.status==='scheduled'&&data.publishedAt&&Date.parse(data.publishedAt)<=Date.now())errors.push({field:'articlePublishedAt',message:'La pubblicazione programmata deve essere nel futuro.'});
    if(!data.slug)errors.push({field:'articleSlug',message:'Lo slug non può essere vuoto.'});
    return errors;
  }
  function resetForm({force=false}={}){
    if(!force&&isDirty()&&!window.confirm('Abbandonare le modifiche non salvate?'))return false;
    suppressDirty=true;
    editingId='';currentImage='';slugTouched=false;
    $('#articleForm')?.reset();
    $('#articleId').value='';
    $('#articleAuthor').value='Redazione New Generation';
    $('#articleCategory').value='Aggiornamenti';
    $('#articleStatus').value='published';
    $('#articlePublishedAt').value=toLocalDateTime(new Date().toISOString());
    $('#articleImage').value='';
    refreshImagePreview();
    clearValidation();
    setFormMode(null);
    updateCounters();
    suppressDirty=false;
    setBaseline();
    return true;
  }
  function fillForm(article){
    if(!article)return;
    if(isDirty()&&!window.confirm('Aprire un altro articolo e abbandonare le modifiche non salvate?'))return;
    suppressDirty=true;
    editingId=article.id;currentImage=article.image||'';slugTouched=true;
    $('#articleId').value=article.id;
    $('#articleTitle').value=article.title||'';
    $('#articleSubtitle').value=article.subtitle||'';
    $('#articleExcerpt').value=article.excerpt||'';
    $('#articleAuthor').value=article.author||'Redazione New Generation';
    $('#articleCategory').value=article.category||'Aggiornamenti';
    $('#articleTags').value=(article.tags||[]).join(', ');
    $('#articleBody').value=article.body||'';
    $('#articleImageAlt').value=article.imageAlt||'';
    $('#articleImageCaption').value=article.imageCaption||'';
    $('#articleStatus').value=article.status||'published';
    $('#articlePublishedAt').value=toLocalDateTime(article.publishedAt||article.updatedAt||article.createdAt);
    $('#articleSlug').value=article.slug||store.articleSlug(article.title);
    $('#articleSeoTitle').value=article.seoTitle||'';
    $('#articleSeoDescription').value=article.seoDescription||'';
    $('#articleImage').value='';
    refreshImagePreview();
    clearValidation();
    setFormMode(article);
    updateCounters();
    suppressDirty=false;
    setBaseline();
    $('#articleFormTitle')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function filteredArticles(){
    const query=String($('#adminArticleSearch')?.value||'').trim().toLocaleLowerCase('it');
    const status=$('#adminArticleStatusFilter')?.value||'all';
    const category=$('#adminArticleCategoryFilter')?.value||'all';
    return allArticles().filter(article=>{
      if(status!=='all'&&article.status!==status)return false;
      if(category!=='all'&&article.category!==category)return false;
      if(!query)return true;
      return [article.title,article.subtitle,article.excerpt,article.body,article.author,article.category,(article.tags||[]).join(' ')].join(' ').toLocaleLowerCase('it').includes(query);
    });
  }
  function renderCategoryOptions(){
    const categories=store.selectors.articleCategories(Admin.state(),{includeDrafts:true});
    const filter=$('#adminArticleCategoryFilter'),current=filter?.value||'all';
    if(filter){filter.innerHTML='<option value="all">Tutte</option>'+categories.map(c=>`<option value="${UI.esc(c)}">${UI.esc(c)}</option>`).join('');filter.value=categories.includes(current)?current:'all';}
    const datalist=$('#articleCategorySuggestions');if(datalist)datalist.innerHTML=categories.map(c=>`<option value="${UI.esc(c)}"></option>`).join('');
  }
  function render(){
    const list=allArticles();
    if(editingId&&!list.some(a=>a.id===editingId)){
      resetForm({force:true});
      Admin.flash('#articleMsg','L’articolo che stavi modificando non è più disponibile.','error');
    }
    renderCategoryOptions();
    const visible=filteredArticles();
    $('#articleCount').textContent=String(list.length);
    $('#adminArticlesList').innerHTML=UI.articleList(visible,true);
    const published=list.filter(a=>a.status==='published').length,drafts=list.filter(a=>a.status==='draft').length,scheduled=list.filter(a=>a.status==='scheduled').length;
    const summary=$('#adminArticleSummary');
    if(summary)summary.innerHTML=`<span><strong>${visible.length}</strong> visualizzati</span><span><strong>${published}</strong> pubblicati</span><span><strong>${drafts}</strong> bozze</span><span><strong>${scheduled}</strong> programmati</span>`;
  }
  function imageFromFile(file){
    return new Promise((resolve,reject)=>{
      if(!file){resolve('');return;}
      if(!IMAGE_TYPES.has(file.type)){reject(new Error('Formato non valido. Usa JPG, PNG o WebP.'));return;}
      if(file.size>MAX_IMAGE_BYTES){reject(new Error('L’immagine supera il limite di 12 MB.'));return;}
      const url=URL.createObjectURL(file);
      const image=new Image();
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Il file non contiene un’immagine leggibile.'));};
      image.onload=()=>{
        try{
          if(!image.naturalWidth||!image.naturalHeight)throw new Error('Risoluzione immagine non valida.');
          const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(image.naturalWidth,image.naturalHeight));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          const context=canvas.getContext('2d',{alpha:file.type!=='image/jpeg'});
          if(!context)throw new Error('Ottimizzazione immagine non disponibile.');
          context.drawImage(image,0,0,canvas.width,canvas.height);
          const outputType=file.type==='image/png'?'image/png':file.type==='image/webp'?'image/webp':'image/jpeg';
          const data=canvas.toDataURL(outputType,outputType==='image/png'?undefined:.84);
          URL.revokeObjectURL(url);
          resolve(data);
        }catch(error){URL.revokeObjectURL(url);reject(error);}
      };
      image.src=url;
    });
  }
  async function waitForRemote(state,{timeout=10000}={}){
    const cfg=window.NEW_GENERATION_SUPABASE||{};
    if(!cfg.ENABLED)return {online:false,ok:true};
    if(typeof window.NG_FORCE_REMOTE_SAVE!=='function')throw new Error('Servizio di sincronizzazione non disponibile. Ricarica la pagina e riprova.');
    let timer;
    try{
      const result=await Promise.race([
        window.NG_FORCE_REMOTE_SAVE(state),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('La sincronizzazione online non ha risposto in tempo.')),timeout);})
      ]);
      if(result!==true)throw new Error('Il backend non ha confermato l’operazione. Verifica la sessione amministratore e riprova.');
      return {online:true,ok:true};
    }finally{clearTimeout(timer);}
  }
  function syncOverlayLock(){
    const open=Boolean($('#articlePreviewModal')?.classList.contains('open')||$('#deleteArticleDialog')?.classList.contains('show'));
    document.body.classList.toggle('ng-overlay-open',open);
  }
  function restoreTrigger(trigger){
    requestAnimationFrame(()=>{if(trigger&&document.contains(trigger))trigger.focus?.({preventScroll:true});});
  }
  function openPreview(article,trigger=null){
    const modal=$('#articlePreviewModal');
    if(!modal)return;
    previewTrigger=trigger||document.activeElement;
    previewArticleId=articleById(article?.id)?.id||'';
    $('#articlePreviewModalTitle').textContent=article.title||'Anteprima articolo';
    const previewBody=$('#articlePreviewModalBody');
    previewBody.innerHTML=UI.articleDetail(article,{preview:true});
    UI.prepareArticleDetail?.(previewBody,{onBack:()=>closePreview()});
    const remove=$('#deleteArticleFromPreviewBtn');
    if(remove){remove.hidden=!previewArticleId;remove.dataset.deleteArticlePreview=previewArticleId;}
    modal.classList.add('open');syncOverlayLock();
    requestAnimationFrame(()=>$('#closeArticlePreviewModal')?.focus());
  }
  function closePreview(){
    const trigger=previewTrigger;previewTrigger=null;previewArticleId='';
    const remove=$('#deleteArticleFromPreviewBtn');if(remove){remove.hidden=true;remove.dataset.deleteArticlePreview='';}
    $('#articlePreviewModal')?.classList.remove('open');syncOverlayLock();restoreTrigger(trigger);
  }
  function openDeleteDialog(id,trigger=null){
    const normalizedId=String(id||'').trim();
    const article=articleById(normalizedId);
    if(!normalizedId||!article){Admin.flash('#articleMsg','Impossibile eliminare: identificativo articolo non valido.','error');return false;}
    deleteArticleId=normalizedId;deleteArticleTrigger=trigger||document.activeElement;
    const dialog=$('#deleteArticleDialog');
    $('#deleteArticleDialogText').textContent=`Stai per eliminare “${article.title}”. L’operazione è irreversibile e l’articolo verrà rimosso anche dal sito pubblico.`;
    $('#deleteArticleDialogMsg').innerHTML='';
    dialog.hidden=false;dialog.classList.add('show','open');syncOverlayLock();
    requestAnimationFrame(()=>$('#cancelDeleteArticleBtn')?.focus());
    return true;
  }
  function closeDeleteDialog(){
    const trigger=deleteArticleTrigger;deleteArticleTrigger=null;
    const dialog=$('#deleteArticleDialog');dialog.classList.remove('show','open');dialog.hidden=true;dialog.removeAttribute('aria-busy');deleteArticleId='';syncOverlayLock();restoreTrigger(trigger);
  }
  async function deleteArticlePersisted(id){
    const previous=Admin.state();
    const article=store.selectors.articleById(previous,id,{includeDrafts:true});
    if(!article)throw new Error('L’articolo non esiste più o è già stato eliminato.');
    const next=window.structuredClone?structuredClone(previous):JSON.parse(JSON.stringify(previous));
    next.articles=(next.articles||[]).filter(item=>String(item.id)!==String(id));
    if(next.articles.length===(previous.articles||[]).length)throw new Error('Identificativo articolo non valido.');
    store.alignState(next);
    const remote=await waitForRemote(next);
    if(remote.online&&typeof window.NG_VERIFY_REMOTE_ARTICLE_ABSENT==='function'){
      const verified=await window.NG_VERIFY_REMOTE_ARTICLE_ABSENT(id);
      if(!verified)throw new Error('Il backend non ha confermato la cancellazione dell’articolo.');
    }
    try{
      const saved=remote.online&&typeof window.NG_SAVE_LOCAL_AFTER_REMOTE==='function'?window.NG_SAVE_LOCAL_AFTER_REMOTE(next):store.save('admin',next);
      refreshPublicCache(saved);
      return {article,saved,remote};
    }catch(error){
      if(remote.online&&typeof window.NG_FORCE_REMOTE_SAVE==='function'){
        try{await window.NG_FORCE_REMOTE_SAVE(previous);}catch(rollbackError){console.error('[Articoli] rollback remoto non riuscito',rollbackError);}
      }
      throw error;
    }
  }
  function applyFormat(type){
    const textarea=$('#articleBody');if(!textarea)return;
    const start=textarea.selectionStart,end=textarea.selectionEnd,selected=textarea.value.slice(start,end);
    const lineStart=textarea.value.lastIndexOf('\n',Math.max(0,start-1))+1;
    let replacement=selected,cursorOffset=0;
    if(type==='heading'){replacement=`## ${selected||'Titolo paragrafo'}`;cursorOffset=selected?replacement.length:3;}
    if(type==='bold'){replacement=`**${selected||'testo in grassetto'}**`;cursorOffset=selected?replacement.length:2;}
    if(type==='italic'){replacement=`*${selected||'testo in corsivo'}*`;cursorOffset=selected?replacement.length:1;}
    if(type==='list'){
      const block=selected||'prima voce\nseconda voce';replacement=block.split('\n').map(line=>`- ${line.replace(/^[-*]\s+/,'')}`).join('\n');cursorOffset=replacement.length;
    }
    if(type==='quote'){replacement=`> ${selected||'citazione'}`;cursorOffset=selected?replacement.length:2;}
    if(type==='link'){
      const label=selected||'testo del collegamento';replacement=`[${label}](https://)`;cursorOffset=replacement.length-1;
    }
    const replaceStart=['heading','list','quote'].includes(type)&&start===end?lineStart:start;
    textarea.setRangeText(replacement,replaceStart,end,'end');
    if(!selected&&cursorOffset)textarea.setSelectionRange(replaceStart+cursorOffset,replaceStart+cursorOffset+(type==='link'?0:Math.max(0,replacement.length-cursorOffset-(type==='bold'?2:type==='italic'?1:0))));
    textarea.focus();textarea.dispatchEvent(new Event('input',{bubbles:true}));
  }

  $('#articleImage')?.addEventListener('change',async event=>{
    const input=event.currentTarget,file=input.files?.[0];
    if(!file)return;
    const preview=$('#articleImagePreview');
    preview?.setAttribute('aria-busy','true');
    try{
      currentImage=await imageFromFile(file);
      if(!$('#articleImageAlt').value.trim())$('#articleImageAlt').value=`Immagine principale dell’articolo ${$('#articleTitle').value.trim()||'senza titolo'}`;
      refreshImagePreview();updateDirtyState();
      Admin.flash('#articleMsg',`Immagine ottimizzata: ${file.name}.`);
    }catch(error){input.value='';Admin.flash('#articleMsg',error.message||String(error),'error');}
    finally{preview?.removeAttribute('aria-busy');}
  });
  $('#removeArticleImageBtn')?.addEventListener('click',()=>{currentImage='';$('#articleImage').value='';refreshImagePreview();updateDirtyState();});
  $('#articlePreviewBtn')?.addEventListener('click',event=>{
    const data=formSnapshot(),errors=validateArticle(data);
    if(!showValidation(errors))return;
    const existing=editingId?articleById(editingId):null;
    openPreview({...existing,...data,id:editingId||'preview',createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()},event.currentTarget);
  });
  $('#closeArticlePreviewModal')?.addEventListener('click',closePreview);
  $('#deleteArticleFromPreviewBtn')?.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    if(previewArticleId)openDeleteDialog(previewArticleId,event.currentTarget);
  });
  $('#articlePreviewModal')?.addEventListener('click',event=>{if(event.target.id==='articlePreviewModal')closePreview();});
  $('#cancelEditArticleBtn')?.addEventListener('click',()=>resetForm());
  $('#articleTitle')?.addEventListener('input',()=>{if(!slugTouched)$('#articleSlug').value=store.articleSlug($('#articleTitle').value);});
  $('#articleSlug')?.addEventListener('input',event=>{slugTouched=true;event.currentTarget.value=store.articleSlug(event.currentTarget.value);});
  $('#articleStatus')?.addEventListener('change',event=>{
    if(event.currentTarget.value!=='draft'&&!$('#articlePublishedAt').value)$('#articlePublishedAt').value=toLocalDateTime(new Date().toISOString());
  });
  $('#articleImageAlt')?.addEventListener('input',refreshImagePreview);
  document.querySelectorAll('[data-article-format]').forEach(button=>button.addEventListener('click',()=>applyFormat(button.dataset.articleFormat)));
  $('#articleForm')?.addEventListener('input',()=>{updateCounters();if(!suppressDirty)updateDirtyState();});
  $('#articleForm')?.addEventListener('change',()=>{if(!suppressDirty)updateDirtyState();});
  ['#adminArticleSearch','#adminArticleStatusFilter','#adminArticleCategoryFilter'].forEach(selector=>$(selector)?.addEventListener(selector==='#adminArticleSearch'?'input':'change',render));

  $('#articleForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const data=formSnapshot(),errors=validateArticle(data);
    if(!showValidation(errors))return;
    const button=$('#articleSubmitBtn');
    if(window.NGInteractive?.isButtonBusy(button))return;
    window.NGInteractive?.setButtonBusy(button,true,'Salvataggio…');
    const now=new Date().toISOString(),existing=editingId?articleById(editingId):null;
    if(data.status==='published'&&!data.publishedAt)data.publishedAt=existing?.publishedAt||now;
    try{
      const saved=Admin.commit(state=>{
        state.articles=Array.isArray(state.articles)?state.articles:[];
        if(editingId){
          const target=state.articles.find(article=>article.id===editingId);
          if(!target)throw new Error('Articolo non più disponibile.');
          Object.assign(target,data,{id:target.id,createdAt:target.createdAt||now,updatedAt:now});
        }else{
          state.articles.unshift({...data,id:store.uid('article'),createdAt:now,updatedAt:now});
        }
      });
      refreshPublicCache(saved);
      render();
      try{
        const remote=await waitForRemote(saved);
        Admin.flash('#articleMsg',remote.online?'Articolo salvato e sincronizzato online.':'Articolo salvato.');
      }catch(error){
        Admin.flash('#articleMsg','Articolo salvato nel browser; sincronizzazione online ancora in attesa. I dati inseriti non sono stati persi.','error');
      }
      resetForm({force:true});
    }catch(error){Admin.flash('#articleMsg',error.message||String(error),'error');}
    finally{window.NGInteractive?.setButtonBusy(button,false);}
  });

  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-edit-article],[data-preview-article],[data-delete-article]');
    if(!action)return;
    event.preventDefault();event.stopPropagation();
    if(action.matches('[data-edit-article]')){fillForm(articleById(action.dataset.editArticle));return;}
    if(action.matches('[data-preview-article]')){const article=articleById(action.dataset.previewArticle);if(article)openPreview(article,action);return;}
    openDeleteDialog(action.dataset.deleteArticle,action);
  });
  $('#cancelDeleteArticleBtn')?.addEventListener('click',closeDeleteDialog);
  $('#deleteArticleDialog')?.addEventListener('click',event=>{if(event.target.id==='deleteArticleDialog')closeDeleteDialog();});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if($('#deleteArticleDialog')?.classList.contains('show')){event.preventDefault();closeDeleteDialog();return;}
    if($('#articlePreviewModal')?.classList.contains('open')){event.preventDefault();closePreview();}
  });
  $('#confirmDeleteArticleBtn')?.addEventListener('click',async event=>{
    event.preventDefault();event.stopPropagation();
    const id=String(deleteArticleId||'').trim(),article=articleById(id);
    if(!id||!article){$('#deleteArticleDialogMsg').innerHTML='<div class="message error">Articolo non disponibile o identificativo non valido.</div>';return;}
    const button=$('#confirmDeleteArticleBtn');if(window.NGInteractive?.isButtonBusy(button))return;
    window.NGInteractive?.setButtonBusy(button,true,'Eliminazione…');
    $('#deleteArticleDialog')?.setAttribute('aria-busy','true');
    try{
      const result=await deleteArticlePersisted(id);
      render();
      if(editingId===id)resetForm({force:true});
      const previewWasOpen=previewArticleId===id&&$('#articlePreviewModal')?.classList.contains('open');
      closeDeleteDialog();
      if(previewWasOpen)closePreview();
      Admin.flash('#articleMsg',`Articolo “${result.article.title}” eliminato e sincronizzato.`);
      console.info('[Articoli]',{action:'delete',articleId:id,remote:result.remote.online?'confirmed':'offline-local'});
    }catch(error){
      console.warn('[Articoli] eliminazione fallita',{articleId:id,error:String(error?.message||error)});
      $('#deleteArticleDialogMsg').innerHTML=`<div class="message error">${UI.esc(error.message||String(error))} L’articolo non è stato rimosso e puoi riprovare.</div>`;
    }finally{
      $('#deleteArticleDialog')?.removeAttribute('aria-busy');
      window.NGInteractive?.setButtonBusy(button,false);
    }
  });

  window.addEventListener('beforeunload',event=>{if(!isDirty())return;event.preventDefault();event.returnValue='';});
  window.NexoraAdminRefresh=function(){render();};
  window.addEventListener('ng:admin-state-loaded',render);
  resetForm({force:true});
  render();
})();
