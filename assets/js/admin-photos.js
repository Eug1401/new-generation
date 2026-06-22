// =============================================================
// New Generation — admin-photos.js (v126.16 rete/upload affidabile)
// =============================================================
// Funzionalità:
//   - Drag&drop area per upload
//   - Preview con thumbnail prima dell'upload
//   - Originali invariati con stato per ogni file e retry selettivo
//   - Grid con selezione multipla e eliminazione batch
//   - Lightbox full-screen con navigazione frecce
//   - Mobile-first responsive
// =============================================================
(function(){
  const A = window.NexoraAdmin;
  const UI = window.NexoraUI;
  const store = window.NexoraStore;
  const Photos = window.NexoraPhotos;
  if(!A || !UI || !store || !Photos){ console.error('Dipendenze mancanti per admin-photos'); return; }

  let selectedTeam = '';
  let selectedPhotos = new Set();       // path delle foto selezionate (batch delete)
  let lightboxIndex = -1;               // indice della foto aperta nel lightbox
  let lastLightboxTrigger = null;
  let uploadInProgress = false;
  let stagedFiles = [];
  let activeJobsRef = [];
  let failedJobs = [];
  const activeUploadControllers = new Map();
  let editingPhotoPath = '';
  let editorTrigger = null;

  // Loader robusto immagini foto (desktop + mobile + refresh realtime)
  // ------------------------------------------------------------
  // Su mobile il problema più frequente è un errore temporaneo della thumbnail
  // o una richiesta lazy/stalled dopo refresh realtime. Il lightbox funziona perché
  // usa l'originale, quindi per dispositivi touch/schermi piccoli diamo priorità
  // all'originale e usiamo la thumbnail solo come alternativa. Il loader non si
  // affida a complete da solo: complete può essere true anche per immagini rotte.
  function attachSmartImageRetry(img, opts={}){
    if(!img) return;
    if(window.NGPhotoEngine){
      window.NGPhotoEngine.load(img, opts);
      return;
    }
    // Fallback minimo se photo-runtime.js non viene caricato.
    const thumb = img.closest('.photo-thumb');
    const primary = img.dataset.src || img.dataset.previewSrc || '';
    const original = img.dataset.fallbackSrc || img.dataset.originalSrc || primary;
    function mark(cls){
      if(!thumb) return;
      thumb.classList.remove('is-loading','is-loaded','is-broken');
      thumb.classList.add(cls);
    }
    mark('is-loading');
    img.onload = () => {
      if(img.naturalWidth > 0 || img.naturalHeight > 0) mark('is-loaded');
      else if(img.src !== original) img.src = original;
      else mark('is-broken');
    };
    img.onerror = () => {
      if(original && img.src !== original) img.src = original;
      else mark('is-broken');
    };
    img.src = primary || original;
  }

  // -------------------- Confirm Modal --------------------
  // Sostituto del confirm() nativo con UI custom e backdrop blur
  function confirmDialog(opts){
    if(document.querySelector('.ng-confirm-overlay')) return Promise.resolve(false);
    return new Promise(resolve => {
      const previousFocus=document.activeElement;
      const overlay = document.createElement('div');
      const titleId = `ng-confirm-title-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      overlay.className = 'ng-confirm-overlay';
      overlay.setAttribute('aria-hidden','true');
      overlay.innerHTML = `<div class="ng-confirm-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="ng-confirm-icon" aria-hidden="true">${opts.icon || '⚠️'}</div>
        <h3 class="ng-confirm-title" id="${titleId}">${UI.esc(opts.title || 'Sei sicuro?')}</h3>
        <p class="ng-confirm-text">${UI.esc(opts.text || '')}</p>
        <div class="ng-confirm-actions">
          <button type="button" class="btn ng-confirm-cancel">${UI.esc(opts.cancelLabel || 'Annulla')}</button>
          <button type="button" class="btn ${opts.danger?'danger':'primary'} ng-confirm-ok">${UI.esc(opts.okLabel || 'Conferma')}</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.getBoundingClientRect();
      overlay.setAttribute('aria-hidden','false');
      overlay.classList.add('open');
      requestAnimationFrame(()=>overlay.querySelector('.ng-confirm-cancel')?.focus());
      let settled = false, removed = false;
      function finishRemoval(){
        if(removed)return;
        removed=true;
        overlay.remove();
      }
      function removeAfterTransition(){
        // Alcuni motori possono lasciare animation.finished in sospeso quando
        // una transizione viene interrotta da aperture/chiusure molto rapide.
        // Il fallback mantiene la modale idempotente e impedisce overlay residui.
        const fallback=setTimeout(finishRemoval,450);
        requestAnimationFrame(()=>{
          const card=overlay.querySelector('.ng-confirm-card');
          const animations = typeof overlay.getAnimations === 'function'
            ? [...overlay.getAnimations(),...(card?.getAnimations?.()||[])]
            : [];
          if(!animations.length){clearTimeout(fallback);finishRemoval();return;}
          Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{clearTimeout(fallback);finishRemoval();});
        });
      }
      function onKeydown(event){
        if(event.key==='Escape'){event.preventDefault();close(false);return;}
        if(event.key!=='Tab')return;
        const focusable=[...overlay.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
        if(!focusable.length)return;
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
      function close(result){
        if(settled) return;
        settled = true;
        document.removeEventListener('keydown',onKeydown);
        overlay.classList.add('is-closing');
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden','true');
        removeAfterTransition();
        requestAnimationFrame(()=>previousFocus&&document.contains(previousFocus)&&previousFocus.focus?.({preventScroll:true}));
        resolve(result);
      }
      document.addEventListener('keydown',onKeydown);
      overlay.addEventListener('click', e=>{
        if(e.target === overlay || e.target.closest('.ng-confirm-cancel')) close(false);
        else if(e.target.closest('.ng-confirm-ok')) close(true);
      });
    });
  }

  function render(){
    const s = A.state();
    renderTeamSelector(s);
    if(selectedTeam && !s.teams.find(t=>t.id===selectedTeam)) selectedTeam = '';
    selectedPhotos = new Set([...selectedPhotos].filter(path => {
      // Tieni solo path che esistono ancora
      const photoMap = Photos.getTeamPhotoMap ? Photos.getTeamPhotoMap(s) : (s.teamPhotos || {});
      const photos = photoMap?.[selectedTeam] || [];
      return photos.some(p => p.path === path || p.publicId === path || p.id === path);
    }));
    renderWorkspace(s);
    renderBulkActions();
    UI.applySiteTheme?.(s);
  }

  // -------------------- Sidebar squadre --------------------
  function renderTeamSelector(s){
    const wrap = UI.$('#photosTeamList');
    if(!wrap) return;
    if(!s.teams.length){
      wrap.innerHTML = '<div class="empty small">Aggiungi prima delle squadre nella sezione "Squadre".</div>';
      return;
    }
    // Calcolo totale foto + dimensione bucket
    const photoMap = Photos.getTeamPhotoMap ? Photos.getTeamPhotoMap(s) : (s.teamPhotos || {});
    const totalPhotos = Object.values(photoMap||{}).reduce((sum,arr)=>sum+(arr?.length||0), 0);
    const totalBytes = Object.values(photoMap||{}).flat().reduce((sum,p)=>sum+(p?.size||0), 0);

    wrap.innerHTML = `<div class="team-list-summary">
      <span class="pill">📷 ${totalPhotos} foto · ${formatSize(totalBytes)}</span>
    </div>
    <div class="team-pick-grid">${s.teams.map(t=>{
      const count = (photoMap?.[t.id]||[]).length;
      const active = t.id===selectedTeam ? ' active' : '';
      const hasPhotos = count > 0 ? ' has-photos' : '';
      return `<button type="button" class="team-pick-btn${active}${hasPhotos}" data-team-pick="${UI.esc(t.id)}">
        ${UI.logo(t,false)}
        <span class="team-pick-name">${UI.esc(t.name)}</span>
        <span class="team-pick-meta">${count > 0 ? count+' foto' : 'Nessuna'}</span>
      </button>`;
    }).join('')}</div>`;
  }

  // -------------------- Workspace --------------------
  function renderWorkspace(s){
    const title = UI.$('#photosTitle');
    const subtitle = UI.$('#photosSubtitle');
    const count = UI.$('#photosCount');
    const uploadArea = UI.$('#photosUploadArea');
    const grid = UI.$('#photosGrid');
    if(!title || !uploadArea || !grid) return;

    if(!selectedTeam){
      title.textContent = 'Foto squadra';
      subtitle.textContent = 'Scegli una squadra a sinistra per iniziare.';
      if(count) count.textContent = '0';
      uploadArea.hidden = true;
      grid.innerHTML = '<div class="empty">Nessuna squadra selezionata.</div>';
      return;
    }
    const team = s.teams.find(t=>t.id===selectedTeam);
    if(!team) return;
    const photos = Photos.listTeamPhotos(s, team.id);
    title.innerHTML = `${UI.logo(team,false)} ${UI.esc(team.name)}`;
    subtitle.textContent = photos.length
      ? `${photos.length} foto · ${formatSize(photos.reduce((s,p)=>s+(p.size||0),0))}`
      : 'Nessuna foto caricata: trascina i file qui sotto o usa il pulsante.';
    if(count) count.textContent = String(photos.length);
    uploadArea.hidden = false;

    if(!photos.length){
      grid.innerHTML = '<div class="empty photos-empty"><div class="empty-icon">📷</div><div>Nessuna foto caricata per questa squadra.</div><small>Carica la prima foto usando il pulsante sopra o trascinando i file nell\'area di upload.</small></div>';
      grid.dataset.renderKey = '';
      return;
    }

    // Rendering idempotente: vedi commento esteso in public.js renderPhotos.
    // Riduce drasticamente il flicker e le richieste HTTP duplicate quando
    // arrivano update remoti che non toccano le foto.
    const renderKey = team.id + '|' + photos.map(p=>p.path).join(',') + '|sel:' + Array.from(selectedPhotos).sort().join(',');
    if(grid.dataset.renderKey === renderKey){
      const byPath = new Map();
      grid.querySelectorAll('.photo-thumb[data-photo-path]').forEach(el => byPath.set(el.dataset.photoPath, el));
      photos.forEach((p, i) => {
        const el = byPath.get(p.path);
        if(!el) return;
        el.dataset.photoIndex = i;
        const img = el.querySelector('img[data-src]');
        const nextSrc = p.thumbUrl || p.url || '';
        const nextFallback = p.originalUrl || p.url || '';
        if(img){
          img.dataset.photoOpen = i;
          const changed = img.dataset.src !== nextSrc || img.dataset.fallbackSrc !== nextFallback;
          if(changed){
            img.dataset.src = nextSrc;
            img.dataset.fallbackSrc = nextFallback;
            img.dataset.previewSrc = nextSrc;
            img.dataset.originalSrc = nextFallback;
            img.dataset.photoVersion = String(p.ts || p.path || i);
          }
          attachSmartImageRetry(img, {force: changed || el.classList.contains('is-broken')});
        }
      });
      return;
    }

    const prevKey = grid.dataset.renderKey || '';
    const prevTeamId = prevKey.split('|')[0];
    const sameTeam = prevTeamId === team.id && prevKey !== '';
    const existingByPath = new Map();
    if(sameTeam){
      grid.querySelectorAll('.photo-thumb[data-photo-path]').forEach(el => {
        existingByPath.set(el.dataset.photoPath, el);
      });
    }

    function buildAdminThumb(p, i){
      const isSelected = selectedPhotos.has(p.path);
      const loadStrategy = i < 6 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
      const imgSrc = UI.esc(p.thumbUrl||p.url);
      const fallbackSrc = UI.esc(p.originalUrl||p.url);
      const thumbPathAttr = p.thumbPath ? ` data-thumb-path="${UI.esc(p.thumbPath)}"` : '';
      const fig = document.createElement('figure');
      fig.className = 'photo-thumb admin is-loading' + (isSelected ? ' is-selected' : '');
      fig.dataset.photoPath = p.path;
      fig.dataset.photoIndex = i;
      fig.style.setProperty('--enter-delay', Math.min(i*12, 150) + 'ms');
      fig.innerHTML = `
        <div class="photo-img-wrap">
          <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-photo-managed="1" data-src="${imgSrc}" data-fallback-src="${fallbackSrc}" data-preview-src="${imgSrc}" data-original-src="${fallbackSrc}" data-photo-version="${UI.esc(String(p.ts||p.path||i))}"${thumbPathAttr} data-retries="0" alt="" ${loadStrategy} decoding="async" data-photo-open="${i}" />
          <div class="photo-status photo-status-loading" aria-hidden="true">
            <span class="photo-status-dots"><span></span><span></span><span></span></span>
            <span class="photo-status-text">Recupero dati, attendere…</span>
          </div>
          <div class="photo-status photo-status-error" aria-hidden="true">
            <span class="photo-status-icon">📷</span>
            <span class="photo-status-text">Foto non disponibile</span>
            <button type="button" class="photo-status-retry" data-photo-retry aria-label="Riprova caricamento">Riprova</button>
          </div>
          <div class="photo-overlay">
            <button type="button" class="photo-action-btn photo-zoom" data-photo-open="${i}" aria-label="Visualizza foto originale" title="Visualizza">🔍</button>
            <button type="button" class="photo-action-btn photo-select" data-photo-select="${UI.esc(p.path)}" aria-label="Seleziona" title="Seleziona">${isSelected?'✓':'○'}</button>
            <button type="button" class="photo-action-btn" data-photo-edit="${UI.esc(p.path)}" aria-label="Modifica metadati" title="Modifica metadati">✎</button>
            <button type="button" class="photo-action-btn" data-photo-replace="${UI.esc(p.path)}" aria-label="Sostituisci originale" title="Sostituisci originale">↻</button>
            <a class="photo-action-btn" href="${UI.esc(Photos.originalDownloadUrl(p))}" download="${UI.esc(p.name)}" data-admin-photo-download aria-label="Scarica originale" title="Scarica originale">⬇</a>
          </div>
        </div>
        <figcaption>
          <span class="photo-name" title="${UI.esc(p.name)}">${UI.esc(p.title||p.name)}</span>
          <small>${p.width&&p.height?`${p.width}×${p.height} · `:''}${formatSize(p.size)}</small>
        </figcaption>
        <button type="button" class="photo-delete-btn" data-delete-photo="${UI.esc(p.path)}" aria-label="Elimina foto" title="Elimina">×</button>`;
      return fig;
    }

    if(!sameTeam || existingByPath.size === 0){
      const frag = document.createDocumentFragment();
      photos.forEach((p,i) => frag.appendChild(buildAdminThumb(p, i)));
      grid.innerHTML = '';
      grid.appendChild(frag);
    } else {
      // Diff in-place SENZA innerHTML='' (preserva nodi e img in caricamento)
      existingByPath.forEach((el, path) => {
        if(!photos.find(p => p.path === path)) el.remove();
      });
      photos.forEach((p, i) => {
        let el = existingByPath.get(p.path);
        const refNode = grid.children[i] || null;
        if(el){
          if(refNode !== el) grid.insertBefore(el, refNode);
          el.dataset.photoIndex = i;
          const img = el.querySelector('img[data-src]');
          const nextSrc = p.thumbUrl || p.url || '';
          const nextFallback = p.originalUrl || p.url || '';
          if(img){
            img.dataset.photoOpen = i;
            const changed = img.dataset.src !== nextSrc || img.dataset.fallbackSrc !== nextFallback;
            if(changed){
              img.dataset.src = nextSrc;
              img.dataset.fallbackSrc = nextFallback;
              img.dataset.previewSrc = nextSrc;
              img.dataset.originalSrc = nextFallback;
              img.dataset.photoVersion = String(p.ts || p.path || i);
            }
            attachSmartImageRetry(img, {force: changed || el.classList.contains('is-broken')});
          }
          // Aggiorna stato selezione senza distruggere
          const isSelected = selectedPhotos.has(p.path);
          el.classList.toggle('is-selected', isSelected);
          const selBtn = el.querySelector('[data-photo-select]');
          if(selBtn) selBtn.textContent = isSelected ? '✓' : '○';
        } else {
          el = buildAdminThumb(p, i);
          grid.insertBefore(el, refNode);
        }
      });
    }
    grid.dataset.renderKey = renderKey;
    // Smart retry per immagini lente/errori transitori
    grid.querySelectorAll('img[data-src]').forEach(img => attachSmartImageRetry(img));
  }

  function renderBulkActions(){
    let bar = UI.$('#photosBulkBar');
    if(!selectedTeam){ if(bar) bar.remove(); return; }
    if(!bar){
      bar = document.createElement('div');
      bar.id = 'photosBulkBar';
      bar.className = 'photos-bulk-bar';
      const ws = UI.$('#photosWorkspace');
      if(ws) ws.appendChild(bar);
    }
    if(selectedPhotos.size === 0){
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML = `<div class="bulk-info"><strong>${selectedPhotos.size}</strong> foto selezionate</div>
      <div class="bulk-actions">
        <button type="button" class="btn small" id="photosBulkDeselect">Deseleziona tutte</button>
        <button type="button" class="btn small primary" id="photosBulkDownload">⬇ ZIP originali</button>
        <button type="button" class="btn small danger" id="photosBulkDelete">🗑 Elimina selezionate</button>
      </div>`;
  }

  function formatSize(bytes){
    bytes = Number(bytes)||0;
    if(bytes < 1024) return bytes+' B';
    if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
    return (bytes/1024/1024).toFixed(2)+' MB';
  }

  // -------------------- Drag & drop + staging --------------------
  function setupDragDrop(){
    const dropZone = UI.$('#photosDropZone');
    if(!dropZone || dropZone.dataset.bound === '1') return;
    dropZone.dataset.bound = '1';
    ['dragenter','dragover'].forEach(eventName=>{
      dropZone.addEventListener(eventName,event=>{
        event.preventDefault();event.stopPropagation();
        if(!uploadInProgress)dropZone.classList.add('is-drag-over');
      });
    });
    ['dragleave','drop'].forEach(eventName=>{
      dropZone.addEventListener(eventName,event=>{
        event.preventDefault();event.stopPropagation();dropZone.classList.remove('is-drag-over');
      });
    });
    dropZone.addEventListener('drop',event=>{
      if(uploadInProgress){flashMsg('Attendi il completamento del batch corrente.','warn');return;}
      const files=Array.from(event.dataTransfer?.files||[]);
      if(!selectedTeam){flashMsg('Seleziona prima una squadra.','warn');return;}
      uploadFiles(files).catch(error=>flashMsg(Photos.userMessage(error),'error'));
    });
  }

  const UPLOAD_CONCURRENCY = 3;

  function fileFingerprint(file){
    return [String(file?.name||'').toLocaleLowerCase('it'),Number(file?.size||0),Number(file?.lastModified||0)].join('|');
  }

  function setUploadUiBusy(busy){
    uploadInProgress=Boolean(busy);
    const input=UI.$('#photosFileInput');if(input)input.disabled=uploadInProgress;
    const drop=UI.$('#photosDropZone');
    if(drop){drop.classList.toggle('is-busy',uploadInProgress);drop.setAttribute('aria-busy',String(uploadInProgress));}
    const confirm=UI.$('#photosStagingConfirmBtn');if(confirm)confirm.disabled=uploadInProgress;
    const add=UI.$('#photosStagingAddBtn');if(add)add.disabled=uploadInProgress;
  }

  async function uploadFiles(rawFiles){
    if(!selectedTeam){flashMsg('Seleziona prima una squadra.','warn');return;}
    if(uploadInProgress){flashMsg('È già in corso un caricamento.','warn');return;}
    const incoming=Array.from(rawFiles||[]).filter(Boolean);
    if(!incoming.length)return;

    const limits=Photos.config||{};
    const maxFiles=Number(limits.MAX_BATCH_FILES||20);
    const maxBatchSize=Number(limits.MAX_BATCH_SIZE||80*1024*1024);
    if(stagedFiles.length+incoming.length>maxFiles){
      flashMsg(`Puoi preparare al massimo ${maxFiles} foto per batch.`,'error');return;
    }
    const totalBytes=stagedFiles.reduce((sum,item)=>sum+item.file.size,0)+incoming.reduce((sum,file)=>sum+(file.size||0),0);
    if(totalBytes>maxBatchSize){flashMsg('Il batch supera il limite totale di 80 MB.','error');return;}

    const state=A.state();
    const existing=Photos.listTeamPhotos(state,selectedTeam);
    const knownNames=new Set(existing.map(photo=>String(photo.originalName||photo.name||'').toLocaleLowerCase('it')));
    const knownFingerprints=new Set(stagedFiles.map(item=>fileFingerprint(item.file)));
    const unique=[];
    let duplicateCount=0;
    incoming.forEach(file=>{
      const fingerprint=fileFingerprint(file);
      const sameName=knownNames.has(String(file.name||'').toLocaleLowerCase('it'));
      if(knownFingerprints.has(fingerprint)||sameName){duplicateCount++;return;}
      knownFingerprints.add(fingerprint);unique.push(file);
    });
    if(!unique.length){flashMsg('Nessun file nuovo da aggiungere: i file selezionati sono duplicati.','warn');return;}

    flashMsg(`Validazione di ${unique.length} ${unique.length===1?'foto':'foto'} in corso…`,'info');
    const results=await Photos.validateBatch(unique);
    const invalid=results.filter(result=>!result.ok);
    results.filter(result=>result.ok).forEach(result=>{
      stagedFiles.push({
        id:'staged_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
        file:result.file,
        meta:result.meta,
        blobUrl:URL.createObjectURL(result.file)
      });
    });
    const input=UI.$('#photosFileInput');if(input)input.value='';
    renderStagingPanel({duplicateCount,invalid});
    if(invalid.length||duplicateCount){
      const first=invalid[0]?.error;
      const parts=[];
      if(duplicateCount)parts.push(`${duplicateCount} duplicate`);
      if(invalid.length)parts.push(`${invalid.length} non valide${first?`: ${Photos.userMessage(first)}`:''}`);
      flashMsg(`Selezione parziale: ${parts.join(' · ')}.`,'warn');
    }else flashMsg(`${results.length} ${results.length===1?'foto pronta':'foto pronte'} per l’upload.`,'ok');
  }

  function renderStagingPanel(summary={}){
    const progressEl=UI.$('#photosUploadProgress');
    if(!progressEl)return;
    if(!stagedFiles.length){progressEl.innerHTML='';return;}
    const totalSize=stagedFiles.reduce((sum,item)=>sum+item.file.size,0);
    const ignored=(summary.duplicateCount||0)+(summary.invalid?.length||0);
    progressEl.innerHTML=`
      <div class="upload-panel staging-panel" aria-label="Anteprima locale foto selezionate">
        <div class="upload-panel-head">
          <div class="upload-panel-info">
            <strong>${stagedFiles.length}</strong> ${stagedFiles.length===1?'foto pronta':'foto pronte'} · <span>${formatSize(totalSize)}</span>
            ${ignored?`<small class="upload-panel-skipped">${ignored} ignorate</small>`:''}
          </div>
          <div class="upload-panel-actions">
            <button type="button" class="btn small" id="photosStagingClearBtn">Svuota</button>
            <button type="button" class="btn small" id="photosStagingAddBtn">+ Aggiungi</button>
            <button type="button" class="btn small primary" id="photosStagingConfirmBtn">⬆ Carica ${stagedFiles.length}</button>
          </div>
        </div>
        <p class="upload-panel-rules">JPEG, PNG o WebP · massimo 10 MB per file · massimo 20 file / 80 MB per batch.</p>
        <div class="staging-grid">
          ${stagedFiles.map(item=>`
            <figure class="staging-thumb" data-staging-id="${item.id}">
              <div class="staging-thumb-img"><img src="${item.blobUrl}" alt="Anteprima locale di ${UI.esc(item.file.name)}" loading="lazy"></div>
              <figcaption>
                <span class="staging-thumb-name" title="${UI.esc(item.file.name)}">${UI.esc(item.file.name)}</span>
                <small>${item.meta?.width||0}×${item.meta?.height||0} · ${formatSize(item.file.size)} · non ancora caricata</small>
              </figcaption>
              <button type="button" class="staging-thumb-remove" data-remove-staged="${item.id}" aria-label="Rimuovi ${UI.esc(item.file.name)}" title="Rimuovi">×</button>
            </figure>`).join('')}
        </div>
      </div>`;
  }

  function removeStagedFile(id){
    if(uploadInProgress)return;
    const index=stagedFiles.findIndex(item=>item.id===id);
    if(index<0)return;
    const [item]=stagedFiles.splice(index,1);
    if(item.blobUrl)URL.revokeObjectURL(item.blobUrl);
    renderStagingPanel();
  }

  function clearStaging(){
    if(uploadInProgress)return;
    stagedFiles.forEach(item=>item.blobUrl&&URL.revokeObjectURL(item.blobUrl));
    stagedFiles=[];
    renderStagingPanel();
  }

  async function confirmAndUpload(){
    if(uploadInProgress)return;
    if(!stagedFiles.length){flashMsg('Niente da caricare.','warn');return;}
    if(!selectedTeam){flashMsg('Seleziona prima una squadra.','warn');return;}
    const teamId=selectedTeam;
    const jobs=stagedFiles.map(item=>({...item,teamId,status:'queued',metaResult:null,error:null}));
    stagedFiles=[];
    await runUploadJobs(jobs);
  }

  async function runUploadJobs(jobs){
    if(!jobs.length)return;
    setUploadUiBusy(true);
    failedJobs=[];
    activeJobsRef=jobs;
    renderUploadPanel(jobs);
    const startedAt=Date.now();
    let cursor=0;
    const uploaded=[];

    async function worker(){
      while(cursor<jobs.length){
        const index=cursor++;
        const job=jobs[index];
        if(job.status==='cancelled')continue;
        const controller=new AbortController();
        activeUploadControllers.set(job.id,controller);
        try{
          job.status='uploading';
          updateJobRow(job,20,'Invio originale al backend…');
          const photo=await Photos.uploadTeamPhoto(job.teamId,job.file,{signal:controller.signal,altText:job.file.name});
          job.status='done';job.metaResult=photo;uploaded.push(photo);
          updateJobRow(job,100,`✓ Cloudinary + database (${formatSize(photo.size)})`,'ok');
          if(job.blobUrl){URL.revokeObjectURL(job.blobUrl);job.blobUrl='';}
        }catch(error){
          job.error=error;
          if(error?.code==='REQUEST_ABORTED'||controller.signal.aborted||job.status==='cancelled'){
            job.status='cancelled';updateJobRow(job,100,'Annullato','cancel');
          }else{
            job.status='failed';updateJobRow(job,100,'✗ '+Photos.userMessage(error),'fail');
          }
        }finally{activeUploadControllers.delete(job.id);}
      }
    }

    await Promise.all(Array.from({length:Math.min(UPLOAD_CONCURRENCY,jobs.length)},worker));
    if(uploaded.length){
      try{await Photos.refreshAll({force:true});}catch(error){safeConsoleWarn('refresh dopo upload',error);}
    }
    failedJobs=jobs.filter(job=>job.status==='failed');
    activeJobsRef=jobs;
    setUploadUiBusy(false);
    const ok=jobs.filter(job=>job.status==='done').length;
    const fail=failedJobs.length;
    const cancelled=jobs.filter(job=>job.status==='cancelled').length;
    const parts=[`${ok}/${jobs.length} caricate`];
    if(fail)parts.push(`${fail} fallite`);
    if(cancelled)parts.push(`${cancelled} annullate`);
    parts.push(`${((Date.now()-startedAt)/1000).toFixed(1)}s`);
    flashMsg(parts.join(' · '),fail||cancelled?'warn':'ok');
    finalizeUploadPanel(jobs);
    render();
  }

  function safeConsoleWarn(phase,error){
    console.warn('[Foto]',{phase,error:String(error?.message||error)});
  }

  async function retryFailedUploads(){
    if(uploadInProgress||!failedJobs.length)return;
    const retry=failedJobs.map(job=>({...job,status:'queued',error:null}));
    failedJobs=[];
    await runUploadJobs(retry);
  }

  function cancelAllUploads(){
    if(!uploadInProgress)return;
    activeJobsRef.forEach(job=>{
      if(job.status==='queued'){job.status='cancelled';updateJobRow(job,100,'Annullato','cancel');}
      activeUploadControllers.get(job.id)?.abort();
    });
    flashMsg('Annullamento degli upload in corso…','warn');
  }

  function cancelSingleUpload(jobId){
    const job=activeJobsRef.find(item=>item.id===jobId);
    if(!job||['done','failed','cancelled'].includes(job.status))return;
    job.status='cancelled';
    activeUploadControllers.get(jobId)?.abort();
    updateJobRow(job,100,'Annullato','cancel');
  }

  function renderUploadPanel(jobs){
    const progressEl=UI.$('#photosUploadProgress');
    if(!progressEl)return;
    const totalSize=jobs.reduce((sum,job)=>sum+job.file.size,0);
    progressEl.innerHTML=`
      <div class="upload-panel" aria-live="polite">
        <div class="upload-panel-head">
          <div class="upload-panel-info"><strong>${jobs.length}</strong> in upload · <span>${formatSize(totalSize)}</span> · originali Cloudinary · ${UPLOAD_CONCURRENCY} richieste parallele</div>
          <div class="upload-panel-actions">
            <button type="button" class="btn small primary" id="photosRetryFailedBtn" hidden>Riprova fallite</button>
            <button type="button" class="btn small danger" id="photosCancelAllBtn">Annulla tutto</button>
          </div>
        </div>
        <div class="upload-list">
          ${jobs.map(job=>`
            <div class="upload-item" data-job-id="${job.id}">
              <div class="upload-item-preview"><img src="${job.blobUrl}" alt="" loading="lazy"></div>
              <div class="upload-item-body">
                <div class="upload-item-head"><span class="upload-item-name">${UI.esc(job.file.name)}</span><span class="upload-item-size">${formatSize(job.file.size)}</span></div>
                <div class="upload-item-bar"><div class="upload-item-fill" style="width:0%"></div></div>
                <small class="upload-item-status">In coda…</small>
              </div>
              <button type="button" class="upload-item-cancel" data-cancel-job="${job.id}" aria-label="Annulla ${UI.esc(job.file.name)}" title="Annulla">×</button>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function updateJobRow(job,percent,status,kind){
    const row=document.querySelector(`[data-job-id="${job.id}"]`);
    if(!row)return;
    const fill=row.querySelector('.upload-item-fill');
    const statusEl=row.querySelector('.upload-item-status');
    if(fill){fill.style.width=percent+'%';['ok','fail','cancel'].forEach(name=>fill.classList.toggle(name,kind===name));}
    if(statusEl){statusEl.textContent=status;['ok','fail','cancel'].forEach(name=>statusEl.classList.toggle(name,kind===name));}
    if(['ok','fail','cancel'].includes(kind))row.querySelector('.upload-item-cancel')?.setAttribute('hidden','');
  }

  function finalizeUploadPanel(jobs){
    const cancel=UI.$('#photosCancelAllBtn');if(cancel)cancel.hidden=true;
    const retry=UI.$('#photosRetryFailedBtn');if(retry)retry.hidden=!failedJobs.length;
    if(!failedJobs.length){
      setTimeout(()=>{const panel=UI.$('#photosUploadProgress');if(panel&&!panel.querySelector('.upload-item-status.fail'))panel.innerHTML='';},6000);
    }
    jobs.filter(job=>job.status==='cancelled'&&job.blobUrl).forEach(job=>{URL.revokeObjectURL(job.blobUrl);job.blobUrl='';});
  }

  // -------------------- Delete single + bulk --------------------
  async function deletePhoto(path){
    try{
      await Photos.deleteTeamPhoto(selectedTeam, path);
      selectedPhotos.delete(path);
      try{ await Photos.refreshAll?.({force:true}); }catch(_){ }
      flashMsg('Foto eliminata.', 'ok');
      render();
    }catch(err){
      flashMsg(Photos.userMessage(err), 'error');
    }
  }

  async function deleteBulk(){
    const paths = [...selectedPhotos];
    if(!paths.length) return;
    const confirmed = await confirmDialog({
      icon: '🗑️',
      title: `Eliminare ${paths.length} foto?`,
      text: 'L\'operazione non è reversibile.',
      okLabel: `Elimina ${paths.length}`,
      cancelLabel: 'Annulla',
      danger: true
    });
    if(!confirmed) return;
    let ok = 0;
    const failedPaths=[];
    for(const path of paths){
      try{ await Photos.deleteTeamPhoto(selectedTeam, path); ok++; }
      catch(_){ failedPaths.push(path); }
    }
    try{ await Photos.refreshAll?.({force:true}); }catch(_){ }
    selectedPhotos=new Set(failedPaths);
    flashMsg(`Eliminate ${ok} foto${failedPaths.length?', '+failedPaths.length+' non eliminate e ancora selezionate':''}.`, failedPaths.length?'warn':'ok');
    render();
  }

  async function downloadBulk(){
    const paths=[...selectedPhotos];
    if(!paths.length)return;
    const team=A.state().teams.find(item=>item.id===selectedTeam);
    const photos=Photos.listTeamPhotos(A.state(),selectedTeam).filter(photo=>paths.includes(photo.path)||paths.includes(photo.publicId)||paths.includes(photo.id));
    const button=UI.$('#photosBulkDownload');
    if(!team||!photos.length)return;
    if(button)button.disabled=true;
    try{
      await Photos.downloadSelectedAsZip(photos,team.id,team.name);
      flashMsg(`ZIP creato con ${photos.length} originali.`,'ok');
    }catch(error){flashMsg(Photos.userMessage(error),'error');}
    finally{if(button)button.disabled=false;}
  }

  function photoByPath(path){
    return Photos.listTeamPhotos(A.state(),selectedTeam).find(photo=>[photo.path,photo.publicId,photo.id].includes(path));
  }

  function ensurePhotoEditor(){
    if(UI.$('#photoMetadataModal'))return;
    const modal=document.createElement('div');
    modal.id='photoMetadataModal';
    modal.className='modal photo-metadata-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`<div class="modal-content photo-metadata-content" role="dialog" aria-modal="true" aria-labelledby="photoMetadataTitle">
      <div class="article-modal-toolbar"><div><span class="article-kicker">Galleria Foto</span><h2 id="photoMetadataTitle">Modifica metadati</h2></div><button type="button" class="btn danger" data-close-photo-editor>Chiudi</button></div>
      <form id="photoMetadataForm" class="form-grid photo-metadata-form">
        <div class="field-full"><label for="photoMetaTitle">Titolo</label><input id="photoMetaTitle" name="title" maxlength="160"></div>
        <div class="field-full"><label for="photoMetaDescription">Descrizione</label><textarea id="photoMetaDescription" name="description" rows="4" maxlength="2000"></textarea></div>
        <div class="field-full"><label for="photoMetaCaption">Didascalia</label><textarea id="photoMetaCaption" name="caption" rows="3" maxlength="1000"></textarea></div>
        <div class="field-full"><label for="photoMetaAlt">Testo alternativo</label><input id="photoMetaAlt" name="altText" maxlength="300"></div>
        <div><label for="photoMetaAlbum">Album / categoria</label><input id="photoMetaAlbum" name="album" maxlength="120"></div>
        <div><label for="photoMetaOrder">Ordine</label><input id="photoMetaOrder" name="order" type="number" step="1"></div>
        <div class="field-full photo-metadata-actions"><button type="button" class="btn" data-close-photo-editor>Annulla</button><button type="submit" class="btn primary" id="photoMetadataSave">Salva metadati</button></div>
        <div class="field-full" id="photoMetadataMsg" aria-live="polite"></div>
      </form>
    </div>`;
    document.body.appendChild(modal);
  }

  function openPhotoEditor(path,trigger){
    const photo=photoByPath(path);if(!photo)return;
    ensurePhotoEditor();editingPhotoPath=path;editorTrigger=trigger||null;
    const modal=UI.$('#photoMetadataModal');
    modal.querySelector('#photoMetaTitle').value=photo.title||'';
    modal.querySelector('#photoMetaDescription').value=photo.description||'';
    modal.querySelector('#photoMetaCaption').value=photo.caption||'';
    modal.querySelector('#photoMetaAlt').value=photo.altText||photo.name||'';
    modal.querySelector('#photoMetaAlbum').value=photo.album||'';
    modal.querySelector('#photoMetaOrder').value=String(photo.order||0);
    modal.querySelector('#photoMetadataMsg').innerHTML='';
    modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('ng-overlay-open');
    requestAnimationFrame(()=>modal.querySelector('#photoMetaTitle')?.focus());
  }

  function closePhotoEditor(){
    const modal=UI.$('#photoMetadataModal');if(!modal)return;
    modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.classList.remove('ng-overlay-open');
    const trigger=editorTrigger;editingPhotoPath='';editorTrigger=null;requestAnimationFrame(()=>trigger?.focus?.());
  }

  async function savePhotoMetadata(form){
    const button=UI.$('#photoMetadataSave');if(button)button.disabled=true;
    const msg=UI.$('#photoMetadataMsg');
    try{
      const data=new FormData(form);
      await Photos.updatePhotoMetadata(editingPhotoPath,{
        title:data.get('title'),description:data.get('description'),caption:data.get('caption'),altText:data.get('altText'),album:data.get('album'),order:data.get('order')
      });
      try{await Photos.refreshAll({force:true});}catch(_){ }
      closePhotoEditor();flashMsg('Metadati aggiornati senza ricaricare l’originale.','ok');render();
    }catch(error){if(msg)msg.innerHTML=`<div class="message error">${UI.esc(Photos.userMessage(error))}</div>`;}
    finally{if(button)button.disabled=false;}
  }

  async function replacePhoto(path,trigger){
    const photo=photoByPath(path);if(!photo)return;
    const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;
      const confirmed=await confirmDialog({icon:'↻',title:'Sostituire la foto?',text:'La vecchia risorsa sarà eliminata solo dopo il salvataggio completo della nuova.',okLabel:'Sostituisci',cancelLabel:'Annulla'});
      if(!confirmed)return;
      if(trigger)trigger.disabled=true;
      try{
        await Photos.validateImageFile(file);
        const result=await Photos.replaceTeamPhoto(selectedTeam,photo,file,{title:photo.title,description:photo.description,caption:photo.caption,altText:photo.altText,album:photo.album,order:photo.order});
        try{await Photos.refreshAll({force:true});}catch(_){ }
        flashMsg(result.warning||'Foto sostituita; galleria e cache aggiornate.',result.warning?'warn':'ok');render();
      }catch(error){flashMsg(Photos.userMessage(error),'error');}
      finally{if(trigger)trigger.disabled=false;}
    },{once:true});
    input.click();
  }

  // -------------------- Lightbox --------------------
  let adminPhotoViewer=null;
  function ensureLightbox(){
    let lb=UI.$('#photosLightbox');
    if(!lb){
      lb=document.createElement('div');
      lb.id='photosLightbox';
      lb.className='photos-lightbox';
      lb.setAttribute('aria-hidden','true');
      lb.setAttribute('role','dialog');
      lb.setAttribute('aria-modal','true');
      lb.setAttribute('aria-label','Visualizzatore fotografie amministrazione');
      lb.innerHTML=`
        <button type="button" class="lightbox-close" aria-label="Chiudi visualizzatore">×</button>
        <button type="button" class="lightbox-nav lightbox-prev" aria-label="Foto precedente">‹</button>
        <button type="button" class="lightbox-nav lightbox-next" aria-label="Foto successiva">›</button>
        <div class="lightbox-stage"><img class="lightbox-img" alt="" draggable="false"></div>
        <div class="lightbox-bar">
          <div class="lightbox-meta"><span class="lightbox-name"></span><small class="lightbox-counter"></small></div>
          <a class="lightbox-download btn small" download href="#">⬇ Originale</a>
        </div>`;
      document.body.appendChild(lb);
    }
    if(!adminPhotoViewer){
      adminPhotoViewer=window.NGImageViewer?.bind(lb,{
        onClose:()=>{lightboxIndex=-1;lastLightboxTrigger=null;},
        onPrevious:()=>navLightbox(-1),
        onNext:()=>navLightbox(1)
      });
    }
    return lb;
  }
  function openLightbox(idx,trigger=null){
    ensureLightbox();
    lightboxIndex=idx;
    lastLightboxTrigger=trigger||document.activeElement;
    updateLightboxContent();
    adminPhotoViewer?.open(lastLightboxTrigger);
  }
  function closeLightbox(){
    if(adminPhotoViewer)adminPhotoViewer.close();
    else {const lb=UI.$('#photosLightbox');if(lb){lb.classList.remove('open');lb.setAttribute('aria-hidden','true');}}
    lightboxIndex=-1;
  }
  function navLightbox(delta){
    const photos=Photos.listTeamPhotos(A.state(),selectedTeam);
    if(!photos.length)return;
    lightboxIndex=(lightboxIndex+delta+photos.length)%photos.length;
    updateLightboxContent();
  }
  function updateLightboxContent(){
    const photos=Photos.listTeamPhotos(A.state(),selectedTeam);
    const p=photos[lightboxIndex];
    if(!p)return closeLightbox();
    ensureLightbox();
    const dimensions=p.width&&p.height?`${p.width}×${p.height} · `:'';
    const sizeInfo=p.originalSize?formatSize(p.originalSize)+' originale':formatSize(p.size);
    adminPhotoViewer?.setContent({
      preview:p.thumbUrl||p.url,
      large:p.largeUrl||p.originalUrl||p.url,
      alt:p.altText||p.title||p.name,
      name:p.title||p.name,
      counter:`${lightboxIndex+1} / ${photos.length} · ${dimensions}${sizeInfo}`,
      downloadUrl:Photos.originalDownloadUrl(p),
      downloadName:p.originalName||p.name
    });
  }

  // -------------------- Event handlers --------------------
  document.addEventListener('click', e => {
    const teamBtn = e.target.closest('[data-team-pick]');
    if(teamBtn){
      if(uploadInProgress){flashMsg('Completa o annulla il caricamento prima di cambiare squadra.','warn');return;}
      if(selectedTeam!==teamBtn.dataset.teamPick&&stagedFiles.length){clearStaging();flashMsg('La selezione locale è stata svuotata per evitare upload nella squadra sbagliata.','warn');}
      selectedTeam=teamBtn.dataset.teamPick;
      selectedPhotos.clear();
      render();
      return;
    }
    const retryBtn = e.target.closest('[data-photo-retry]');
    if(retryBtn){
      e.stopPropagation();
      const thumb = retryBtn.closest('.photo-thumb');
      const img = thumb?.querySelector('img[data-src]');
      if(img && thumb){
        attachSmartImageRetry(img, {force:true});
      }
      return;
    }
    const openBtn = e.target.closest('[data-photo-open]');
    if(openBtn){
      const idx = Number(openBtn.dataset.photoOpen);
      if(!Number.isNaN(idx)) openLightbox(idx,openBtn);
      return;
    }
    const editBtn=e.target.closest('[data-photo-edit]');
    if(editBtn){e.preventDefault();e.stopPropagation();openPhotoEditor(editBtn.dataset.photoEdit,editBtn);return;}
    const replaceBtn=e.target.closest('[data-photo-replace]');
    if(replaceBtn){e.preventDefault();e.stopPropagation();replacePhoto(replaceBtn.dataset.photoReplace,replaceBtn);return;}
    if(e.target.closest('[data-close-photo-editor]')){e.preventDefault();closePhotoEditor();return;}
    const selectBtn = e.target.closest('[data-photo-select]');
    if(selectBtn){
      e.stopPropagation();
      const path = selectBtn.dataset.photoSelect;
      if(selectedPhotos.has(path)) selectedPhotos.delete(path);
      else selectedPhotos.add(path);
      render();
      return;
    }
    const delBtn = e.target.closest('[data-delete-photo]');
    if(delBtn){
      e.stopPropagation();
      const path = delBtn.dataset.deletePhoto;
      confirmDialog({
        icon: '🗑️',
        title: 'Eliminare questa foto?',
        text: 'L\'operazione non è reversibile.',
        okLabel: 'Elimina',
        cancelLabel: 'Annulla',
        danger: true
      }).then(ok => { if(ok) deletePhoto(path); });
      return;
    }
    if(e.target.id === 'photosBulkDeselect'){ selectedPhotos.clear(); render(); return; }
    if(e.target.id === 'photosBulkDownload'){ downloadBulk(); return; }
    if(e.target.id === 'photosBulkDelete'){ deleteBulk(); return; }
    if(e.target.id === 'photosRetryFailedBtn'){ retryFailedUploads().catch(error=>flashMsg(Photos.userMessage(error),'error')); return; }
    if(e.target.id === 'photosCancelAllBtn'){ cancelAllUploads(); return; }
    if(e.target.id === 'photosStagingConfirmBtn'){ confirmAndUpload(); return; }
    if(e.target.id === 'photosStagingClearBtn'){ clearStaging(); return; }
    if(e.target.id === 'photosStagingAddBtn'){ UI.$('#photosFileInput')?.click(); return; }
    const removeStagedBtn = e.target.closest('[data-remove-staged]');
    if(removeStagedBtn){ removeStagedFile(removeStagedBtn.dataset.removeStaged); return; }
    const cancelBtn = e.target.closest('[data-cancel-job]');
    if(cancelBtn){ cancelSingleUpload(cancelBtn.dataset.cancelJob); return; }
    if(e.target.id === 'photosDropTrigger'){
      UI.$('#photosFileInput')?.click();
      return;
    }
  });

  document.addEventListener('click',e=>{if(e.target?.id==='photoMetadataModal')closePhotoEditor();});
  document.addEventListener('keydown',e=>{
    const modal=UI.$('#photoMetadataModal');
    if(!modal?.classList.contains('open'))return;
    if(e.key==='Escape'){e.preventDefault();closePhotoEditor();return;}
    if(e.key!=='Tab')return;
    const focusable=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });

  document.addEventListener('submit', e => {
    if(e.target.id==='photoMetadataForm'){e.preventDefault();savePhotoMetadata(e.target);return;}
    if(e.target.id !== 'photosUploadForm') return;
    e.preventDefault();
    const fileInput = UI.$('#photosFileInput');
    const files = Array.from(fileInput?.files||[]);
    if(!files.length){ flashMsg('Seleziona almeno una foto.', 'warn'); return; }
    uploadFiles(files);
  });

  document.addEventListener('change', e => {
    if(e.target?.id === 'photosFileInput'){
      const files = Array.from(e.target.files || []);
      if(files.length && selectedTeam) uploadFiles(files).catch(error=>flashMsg(Photos.userMessage(error),'error'));
    }
  });

  function flashMsg(text, type='ok'){
    const el = UI.$('#photosMsg');
    if(el){
      el.innerHTML = `<div class="message ${type}">${UI.esc(text)}</div>`;
      // Auto-clear dopo 4s
      setTimeout(()=>{ if(el.innerHTML.includes(text)) el.innerHTML = ''; }, 4000);
    }
  }

  // -------------------- Realtime listener --------------------
  window.addEventListener('pagehide',()=>{
    stagedFiles.forEach(item=>item.blobUrl&&URL.revokeObjectURL(item.blobUrl));
    activeJobsRef.forEach(job=>job.blobUrl&&URL.revokeObjectURL(job.blobUrl));
    activeUploadControllers.forEach(controller=>controller.abort());
  });

  window.addEventListener('ng:admin-state-loaded', () => render());
  window.addEventListener('ng:cloudinary-photos-updated', () => render());

  // -------------------- Boot --------------------
  function healthProblemMessage(health){
    if(!health)return '';
    if(health.originAllowed===false)return 'Il dominio corrente non è autorizzato: aggiorna PHOTO_ALLOWED_ORIGINS nei Secrets Supabase.';
    if(health.cloudinary?.configured===false)return 'La funzione risponde, ma Cloudinary non è configurato. Imposta CLOUDINARY_URL oppure CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET nei Secrets della Edge Function.';
    if(health.supabase?.configured===false)return 'La funzione risponde, ma la configurazione Supabase server-side è incompleta.';
    return health.ok===false?'La funzione Foto risponde ma la configurazione backend non è completa.':'';
  }

  function boot(){
    A.initGlobalActions?.();
    setupDragDrop();
    (async()=>{
      try{
        const health=await Photos.healthCheck?.();
        const problem=healthProblemMessage(health);
        if(problem){flashMsg(problem,'error');return;}
        await Photos.refreshAll?.({force:true});
      }catch(err){
        flashMsg(Photos.userMessage(err),'error');
      }
    })();
    render();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
