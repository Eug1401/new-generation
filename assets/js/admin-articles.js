(function(){
  const store=window.NexoraStore, UI=window.NexoraUI, Admin=window.NexoraAdmin;
  let editingId='';
  let currentImage='';

  function setFormMode(article=null){
    const title=UI.$('#articleFormTitle');
    const hint=UI.$('#articleFormHint');
    if(title)title.textContent=article?'Modifica articolo':'Nuovo articolo';
    if(hint)hint.textContent=article?'Aggiorna titolo, testo o immagine dell’articolo selezionato.':'Titolo, testo e una sola immagine principale dal dispositivo.';
  }

  function readImage(file){
    return new Promise((resolve,reject)=>{
      if(!file){resolve('');return;}
      if(!file.type.startsWith('image/')){reject(new Error('Carica solo immagini.'));return;}
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Impossibile leggere immagine.'));
      reader.onload=()=>{
        const img=new Image();
        img.onerror=()=>reject(new Error('Formato immagine non valido.'));
        img.onload=()=>{
          const max=1200;
          const scale=Math.min(1,max/Math.max(img.width,img.height));
          const canvas=document.createElement('canvas');
          canvas.width=Math.round(img.width*scale);
          canvas.height=Math.round(img.height*scale);
          const ctx=canvas.getContext('2d');
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/jpeg',0.82));
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function resetForm(){
    editingId=''; currentImage='';
    const form=UI.$('#articleForm');
    form.reset();
    UI.$('#articleId').value='';
    UI.$('#articleImagePreview').innerHTML='<div class="article-image article-placeholder small"><span>NG</span></div><span class="muted">Nessuna immagine selezionata.</span>';
    UI.$('#articleSubmitBtn').textContent='Pubblica articolo';
    UI.$('#cancelEditArticleBtn').hidden=true;
    setFormMode(null);
  }
  function render(){
    const s=Admin.state();
    const list=store.selectors.articles(s);
    UI.$('#articleCount').textContent=String(list.length);
    UI.$('#adminArticlesList').innerHTML=UI.articleList(list,true);
  }
  function fillForm(article){
    editingId=article.id;
    currentImage=article.image||'';
    UI.$('#articleId').value=article.id;
    UI.$('#articleTitle').value=article.title||'';
    UI.$('#articleBody').value=article.body||'';
    UI.$('#articleImagePreview').innerHTML=currentImage?`<img class="article-image small" src="${UI.esc(currentImage)}" alt="Anteprima articolo"><span class="muted">Immagine attuale. Caricane una nuova solo se vuoi sostituirla.</span>`:'<div class="article-image article-placeholder small"><span>NG</span></div><span class="muted">Nessuna immagine.</span>';
    UI.$('#articleSubmitBtn').textContent='Salva modifica';
    UI.$('#cancelEditArticleBtn').hidden=false;
    setFormMode(article);
    window.scrollTo({top:0,behavior:'auto'});
  }

  UI.$('#articleImage')?.addEventListener('change',async e=>{
    try{
      const file=e.target.files[0];
      if(!file)return;
      currentImage=await readImage(file);
      UI.$('#articleImagePreview').innerHTML=`<img class="article-image small" src="${UI.esc(currentImage)}" alt="Anteprima articolo"><span class="muted">Immagine pronta. Verrà salvata con l'articolo.</span>`;
    }catch(err){alert(err.message||err);e.target.value='';}
  });

  UI.$('#removeArticleImageBtn')?.addEventListener('click',()=>{
    currentImage='';
    UI.$('#articleImage').value='';
    UI.$('#articleImagePreview').innerHTML='<div class="article-image article-placeholder small"><span>NG</span></div><span class="muted">Immagine rimossa.</span>';
  });

  UI.$('#cancelEditArticleBtn')?.addEventListener('click',resetForm);

  UI.$('#articleForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const title=UI.$('#articleTitle').value.trim();
    const body=UI.$('#articleBody').value.trim();
    if(!title){Admin.flash('#articleMsg','Inserisci il titolo articolo.','error');return;}
    if(!body){Admin.flash('#articleMsg','Inserisci il corpo dell’articolo.','error');return;}
    const now=new Date().toISOString();
    Admin.commit(s=>{
      s.articles=Array.isArray(s.articles)?s.articles:[];
      if(editingId){
        const a=s.articles.find(x=>x.id===editingId);
        if(a){a.title=title;a.body=body;a.image=currentImage||'';a.updatedAt=now;}
      }else{
        s.articles.unshift({id:store.uid('article'),title,body,image:currentImage||'',createdAt:now,updatedAt:now});
      }
    });
    Admin.flash('#articleMsg',editingId?'Articolo modificato e pubblicato online.':'Articolo pubblicato online.');
    resetForm();
    render();
  });

  document.addEventListener('click',e=>{
    const edit=e.target.closest('[data-edit-article]');
    const del=e.target.closest('[data-delete-article]');
    if(edit){
      const s=Admin.state();
      const article=(s.articles||[]).find(a=>a.id===edit.dataset.editArticle);
      if(article)fillForm(article);
    }
    if(del){
      if(!confirm('Eliminare questo articolo? La modifica sarà visibile anche al pubblico.'))return;
      Admin.commit(s=>{s.articles=(s.articles||[]).filter(a=>a.id!==del.dataset.deleteArticle);});
      Admin.flash('#articleMsg','Articolo eliminato.');
      if(editingId===del.dataset.deleteArticle)resetForm();
      render();
    }
  });

  render();
  window.NexoraAdminRefresh=function(){render();};
  window.addEventListener('ng:admin-state-loaded',()=>render());
})();
