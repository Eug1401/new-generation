// =============================================================
// New Generation — admin-photos.js (v91 UI ottimizzata)
// =============================================================
// Funzionalità:
//   - Drag&drop area per upload
//   - Preview con thumbnail prima dell'upload
//   - Compressione client con barra di progresso per ogni file
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
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ng-confirm-overlay';
      overlay.innerHTML = `<div class="ng-confirm-card" role="dialog" aria-modal="true">
        <div class="ng-confirm-icon">${opts.icon || '⚠️'}</div>
        <h3 class="ng-confirm-title">${UI.esc(opts.title || 'Sei sicuro?')}</h3>
        <p class="ng-confirm-text">${UI.esc(opts.text || '')}</p>
        <div class="ng-confirm-actions">
          <button type="button" class="btn ng-confirm-cancel">${UI.esc(opts.cancelLabel || 'Annulla')}</button>
          <button type="button" class="btn ${opts.danger?'danger':'primary'} ng-confirm-ok">${UI.esc(opts.okLabel || 'Conferma')}</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(()=>overlay.classList.add('open'));
      function close(result){
        overlay.classList.remove('open');
        setTimeout(()=>overlay.remove(), 200);
        resolve(result);
      }
      overlay.addEventListener('click', e=>{
        if(e.target === overlay) close(false);
        else if(e.target.closest('.ng-confirm-cancel')) close(false);
        else if(e.target.closest('.ng-confirm-ok')) close(true);
      });
      document.addEventListener('keydown', function onKey(e){
        if(e.key === 'Escape'){ close(false); document.removeEventListener('keydown', onKey); }
        else if(e.key === 'Enter'){ close(true); document.removeEventListener('keydown', onKey); }
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
            <button type="button" class="photo-action-btn photo-zoom" data-photo-open="${i}" aria-label="Visualizza" title="Visualizza">🔍</button>
            <button type="button" class="photo-action-btn photo-select" data-photo-select="${UI.esc(p.path)}" aria-label="Seleziona" title="Seleziona">${isSelected?'✓':'○'}</button>
          </div>
        </div>
        <figcaption>
          <span class="photo-name" title="${UI.esc(p.name)}">${UI.esc(p.name)}</span>
          <small>${formatSize(p.size)}</small>
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
        <button type="button" class="btn small danger" id="photosBulkDelete">🗑 Elimina selezionate</button>
      </div>`;
  }

  function formatSize(bytes){
    bytes = Number(bytes)||0;
    if(bytes < 1024) return bytes+' B';
    if(bytes < 1024*1024) return (bytes/1024).toFixed(0)+' KB';
    return (bytes/1024/1024).toFixed(2)+' MB';
  }

  // -------------------- Drag & drop --------------------
  function setupDragDrop(){
    const dropZone = UI.$('#photosDropZone');
    if(!dropZone || dropZone.dataset.bound === '1') return;
    dropZone.dataset.bound = '1';
    ['dragenter','dragover'].forEach(ev=>{
      dropZone.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dropZone.classList.add('is-drag-over'); });
    });
    ['dragleave','drop'].forEach(ev=>{
      dropZone.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('is-drag-over'); });
    });
    dropZone.addEventListener('drop', e=>{
      const files = Array.from(e.dataTransfer?.files || []).filter(f=>f.type.startsWith('image/'));
      if(files.length && selectedTeam) uploadFiles(files);
      else if(!selectedTeam) flashMsg('Seleziona prima una squadra.', 'warn');
    });
  }

  // -------------------- Upload --------------------
  // -------------------- Upload --------------------
  // STAGING → CONFIRM → BATCH UPLOAD
  // Quando l'utente seleziona/dropa file, NON parte subito l'upload.
  // Si apre uno "staging panel" con thumbnail grandi cliccabili e bottone
  // Cancel × per ogni foto. L'utente può rivedere e poi confermare con
  // "Carica N foto", oppure annullare tutto.
  //
  // Upload parallelo a 5 vie. Compressione su Web Worker pool (off-main-thread).
  // Pipeline overlap: mentre l'upload 1 è in rete, parte già la compressione del 2.
  const UPLOAD_CONCURRENCY = 5;   // upload paralleli (sweet spot per Supabase)
  let activeUploadController = null;
  let stagedFiles = [];           // file in staging (in attesa di conferma)

  function uploadFiles(rawFiles){
    if(!selectedTeam){ flashMsg('Seleziona prima una squadra.', 'warn'); return; }
    if(!rawFiles || !rawFiles.length) return;

    // 1. FILTRO E VALIDAZIONE
    const s = A.state();
    const photoMap = Photos.getTeamPhotoMap ? Photos.getTeamPhotoMap(s) : (s.teamPhotos || {});
    const existingNames = new Set((photoMap?.[selectedTeam]||[]).map(p => p.name));
    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    let skippedDup = 0, skippedBig = 0, skippedType = 0;
    const validFiles = [];
    rawFiles.forEach(file => {
      if(!file.type.startsWith('image/')){ skippedType++; return; }
      if(file.size > MAX_FILE_SIZE){ skippedBig++; return; }
      if(existingNames.has(file.name)){ skippedDup++; return; }
      validFiles.push(file);
    });

    if(!validFiles.length){
      const skipMsg = [];
      if(skippedDup) skipMsg.push(`${skippedDup} duplicate`);
      if(skippedBig) skipMsg.push(`${skippedBig} oltre 10MB`);
      if(skippedType) skipMsg.push(`${skippedType} non-immagini`);
      flashMsg('Nessun file da caricare' + (skipMsg.length ? ' (' + skipMsg.join(', ') + ')' : '') + '.', 'warn');
      return;
    }

    // 2. AGGIUNGI ALLO STAGING (cumulativo se si fa più drop in fila)
    validFiles.forEach((file, i) => {
      stagedFiles.push({
        id: 'staged_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2,6),
        file,
        blobUrl: URL.createObjectURL(file)
      });
    });

    renderStagingPanel({skippedDup, skippedBig, skippedType});
  }

  function renderStagingPanel(skipMeta){
    const progressEl = UI.$('#photosUploadProgress');
    if(!progressEl) return;
    if(!stagedFiles.length){
      progressEl.innerHTML = '';
      return;
    }
    const totalSize = stagedFiles.reduce((s,j)=>s+j.file.size, 0);
    const skipCount = (skipMeta?.skippedDup||0)+(skipMeta?.skippedBig||0)+(skipMeta?.skippedType||0);
    const skipParts = [];
    if(skipMeta?.skippedDup) skipParts.push(skipMeta.skippedDup+' duplicate');
    if(skipMeta?.skippedBig) skipParts.push(skipMeta.skippedBig+' >10MB');
    if(skipMeta?.skippedType) skipParts.push(skipMeta.skippedType+' non-immagini');

    progressEl.innerHTML = `
      <div class="upload-panel staging-panel">
        <div class="upload-panel-head">
          <div class="upload-panel-info">
            <strong>${stagedFiles.length}</strong> ${stagedFiles.length===1?'foto':'foto'} da caricare · <span>${formatSize(totalSize)}</span>
            ${skipCount ? `<small class="upload-panel-skipped" title="${UI.esc(skipParts.join(', '))}">${skipCount} ignorate</small>` : ''}
          </div>
          <div class="upload-panel-actions">
            <button type="button" class="btn small" id="photosStagingClearBtn">Svuota</button>
            <button type="button" class="btn small" id="photosStagingAddBtn">+ Aggiungi</button>
            <button type="button" class="btn small primary" id="photosStagingConfirmBtn">⬆ Carica ${stagedFiles.length}</button>
          </div>
        </div>
        <div class="staging-grid">
          ${stagedFiles.map(j => `
            <figure class="staging-thumb" data-staging-id="${j.id}">
              <div class="staging-thumb-img"><img src="${j.blobUrl}" alt="" loading="lazy" /></div>
              <figcaption>
                <span class="staging-thumb-name" title="${UI.esc(j.file.name)}">${UI.esc(j.file.name)}</span>
                <small>${formatSize(j.file.size)}</small>
              </figcaption>
              <button type="button" class="staging-thumb-remove" data-remove-staged="${j.id}" aria-label="Rimuovi" title="Rimuovi">×</button>
            </figure>
          `).join('')}
        </div>
      </div>`;
  }

  function removeStagedFile(id){
    const idx = stagedFiles.findIndex(j => j.id === id);
    if(idx === -1) return;
    const job = stagedFiles[idx];
    if(job.blobUrl) URL.revokeObjectURL(job.blobUrl);
    stagedFiles.splice(idx, 1);
    if(!stagedFiles.length){
      const progressEl = UI.$('#photosUploadProgress');
      if(progressEl) progressEl.innerHTML = '';
    } else {
      renderStagingPanel();
    }
  }

  function clearStaging(){
    stagedFiles.forEach(j => { if(j.blobUrl) URL.revokeObjectURL(j.blobUrl); });
    stagedFiles = [];
    const progressEl = UI.$('#photosUploadProgress');
    if(progressEl) progressEl.innerHTML = '';
  }

  async function confirmAndUpload(){
    if(!stagedFiles.length){ flashMsg('Niente da caricare.', 'warn'); return; }
    if(!selectedTeam){ flashMsg('Seleziona prima una squadra.', 'warn'); clearStaging(); return; }

    // Snapshot dei file in staging come job di upload
    const jobs = stagedFiles.map(s => ({
      id: s.id,
      file: s.file,
      status: 'queued',
      blobUrl: s.blobUrl,
      compressedBlob: null
    }));
    // Svuoto lo staging (i blobUrl li passa ai jobs)
    stagedFiles = [];

    activeUploadController = new AbortController();
    const signal = activeUploadController.signal;
    const startedAt = Date.now();
    activeJobsRef = jobs;
    renderUploadPanel(jobs);

    // POOL PARALLELO con pipeline compress+upload non bloccante.
    // Ogni worker prende un job dalla coda, lo comprime (Web Worker off-main-thread),
    // poi lo carica su Supabase. Mentre uno carica, gli altri possono comprimere.
    const uploadedMetas = [];
    let cursor = 0;
    async function worker(){
      while(cursor < jobs.length && !signal.aborted){
        const idx = cursor++;
        const job = jobs[idx];
        if(job.status === 'cancelled') continue;
        try{
          // Upload originale su Cloudinary tramite Edge Function Supabase.
          // Non ricomprimiamo lato client: Cloudinary conserva l'originale e genera varianti ottimizzate via URL.
          job.status = 'uploading';
          updateJobRow(job, 20, 'Caricamento Cloudinary…');
          const meta = await Photos.uploadTeamPhoto(selectedTeam, job.file);
          job.status = 'done';
          job.meta = meta;
          uploadedMetas.push(meta);
          updateJobRow(job, 100, '✓ Caricata (' + formatSize(meta.size) + ')', 'ok');
        }catch(err){
          if(signal.aborted){
            job.status = 'cancelled';
            updateJobRow(job, 100, 'Annullato', 'cancel');
          } else {
            job.status = 'failed';
            updateJobRow(job, 100, '✗ ' + (err.message || 'errore sconosciuto'), 'fail');
          }
        } finally {
          if(job.blobUrl){ URL.revokeObjectURL(job.blobUrl); job.blobUrl = null; }
        }
      }
    }
    const workers = Array.from({length: Math.min(UPLOAD_CONCURRENCY, jobs.length)}, worker);
    await Promise.all(workers);

    // Nessun commit su app_state: le foto ora vivono su Cloudinary.
    // Aggiorno solo la cache runtime e rileggo la cartella per consistenza.
    if(uploadedMetas.length){
      try{ await Photos.refreshAll?.({force:true}); }catch(_){ }
    }

    activeUploadController = null;
    const ok = jobs.filter(j=>j.status==='done').length;
    const fail = jobs.filter(j=>j.status==='failed').length;
    const cancelled = jobs.filter(j=>j.status==='cancelled').length;
    const elapsed = ((Date.now()-startedAt)/1000).toFixed(1);
    const msgType = (fail || cancelled) ? 'warn' : 'ok';
    const parts = [`${ok}/${jobs.length} caricate`];
    if(fail) parts.push(fail + ' fallite');
    if(cancelled) parts.push(cancelled + ' annullate');
    parts.push(elapsed + 's');
    flashMsg(parts.join(' · '), msgType);
    finalizeUploadPanel();
    const input = UI.$('#photosFileInput');
    if(input) input.value = '';
    render();
  }

  function cancelAllUploads(){
    if(!activeUploadController) return;
    activeUploadController.abort();
    flashMsg('Annullamento in corso…', 'warn');
  }

  function cancelSingleUpload(jobId){
    const row = document.querySelector(`[data-job-id="${jobId}"]`);
    if(!row) return;
    row.classList.add('is-cancelled');
    const status = row.querySelector('.upload-item-status');
    if(status){ status.textContent = 'Annullato'; status.classList.add('cancel'); }
    const fill = row.querySelector('.upload-item-fill');
    if(fill){ fill.classList.add('cancel'); }
    activeJobsRef.forEach(j => { if(j.id === jobId) j.status = 'cancelled'; });
  }

  let activeJobsRef = [];

  function renderUploadPanel(jobs){
    const progressEl = UI.$('#photosUploadProgress');
    if(!progressEl) return;
    const totalSize = jobs.reduce((s,j)=>s+j.file.size, 0);
    progressEl.innerHTML = `
      <div class="upload-panel">
        <div class="upload-panel-head">
          <div class="upload-panel-info">
            <strong>${jobs.length}</strong> in upload · <span>${formatSize(totalSize)}</span> · Cloudinary · concurrency ${UPLOAD_CONCURRENCY}
          </div>
          <button type="button" class="btn small danger" id="photosCancelAllBtn">Annulla tutto</button>
        </div>
        <div class="upload-list">
          ${jobs.map(j => `
            <div class="upload-item" data-job-id="${j.id}">
              <div class="upload-item-preview"><img src="${j.blobUrl}" alt="" loading="lazy" /></div>
              <div class="upload-item-body">
                <div class="upload-item-head">
                  <span class="upload-item-name">${UI.esc(j.file.name)}</span>
                  <span class="upload-item-size">${formatSize(j.file.size)}</span>
                </div>
                <div class="upload-item-bar"><div class="upload-item-fill" style="width:0%"></div></div>
                <small class="upload-item-status">In coda…</small>
              </div>
              <button type="button" class="upload-item-cancel" data-cancel-job="${j.id}" aria-label="Annulla" title="Annulla">×</button>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function updateJobRow(job, percent, status, kind){
    const row = document.querySelector(`[data-job-id="${job.id}"]`);
    if(!row) return;
    const fill = row.querySelector('.upload-item-fill');
    const statusEl = row.querySelector('.upload-item-status');
    if(fill){
      fill.style.width = percent + '%';
      ['ok','fail','cancel'].forEach(c => fill.classList.toggle(c, kind === c));
    }
    if(statusEl){
      statusEl.textContent = status;
      ['ok','fail','cancel'].forEach(c => statusEl.classList.toggle(c, kind === c));
    }
    if(kind === 'ok' || kind === 'fail' || kind === 'cancel'){
      const cancelBtn = row.querySelector('.upload-item-cancel');
      if(cancelBtn) cancelBtn.style.display = 'none';
    }
  }

  function finalizeUploadPanel(){
    const head = document.querySelector('#photosCancelAllBtn');
    if(head) head.style.display = 'none';
    setTimeout(() => {
      const progressEl = UI.$('#photosUploadProgress');
      if(!progressEl) return;
      const hasFails = progressEl.querySelector('.upload-item-status.fail');
      if(!hasFails) progressEl.innerHTML = '';
    }, 6000);
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
      flashMsg('Errore durante l\'eliminazione: '+(err.message||err), 'error');
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
    let ok = 0, fail = 0;
    for(const path of paths){
      try{ await Photos.deleteTeamPhoto(selectedTeam, path); ok++; }
      catch(_){ fail++; }
    }
    try{ await Photos.refreshAll?.({force:true}); }catch(_){ }
    selectedPhotos.clear();
    flashMsg(`Eliminate ${ok} foto${fail?', '+fail+' falliti':''}.`, fail?'warn':'ok');
    render();
  }

  // -------------------- Lightbox --------------------
  function ensureLightbox(){
    if(UI.$('#photosLightbox')) return;
    const lb = document.createElement('div');
    lb.id = 'photosLightbox';
    lb.className = 'photos-lightbox';
    lb.setAttribute('aria-hidden','true');
    lb.innerHTML = `
      <button type="button" class="lightbox-close" aria-label="Chiudi">×</button>
      <button type="button" class="lightbox-nav lightbox-prev" aria-label="Precedente">‹</button>
      <button type="button" class="lightbox-nav lightbox-next" aria-label="Successiva">›</button>
      <div class="lightbox-stage"><img class="lightbox-img" alt="" /></div>
      <div class="lightbox-bar">
        <div class="lightbox-meta"><span class="lightbox-name"></span><small class="lightbox-counter"></small></div>
        <a class="lightbox-download btn small" download href="#">⬇ Scarica</a>
      </div>`;
    document.body.appendChild(lb);
    const img = lb.querySelector('.lightbox-img');
    let isZoomed = false;
    function toggleZoom(){
      isZoomed = !isZoomed;
      img.classList.toggle('is-zoomed', isZoomed);
    }
    lb.addEventListener('click', e=>{
      if(e.target.matches('.lightbox-close, .photos-lightbox, .lightbox-stage')) closeLightbox();
      else if(e.target.matches('.lightbox-prev')) navLightbox(-1);
      else if(e.target.matches('.lightbox-next')) navLightbox(1);
    });
    // Doppio-tap / doppio-click per zoom
    let lastTap = 0;
    img.addEventListener('click', e=>{
      e.stopPropagation();
      const now = Date.now();
      if(now - lastTap < 300){ toggleZoom(); lastTap = 0; }
      else lastTap = now;
    });
    // Swipe touch
    let touchStartX = 0;
    lb.addEventListener('touchstart', e=>{ touchStartX = e.touches[0].clientX; }, {passive:true});
    lb.addEventListener('touchend', e=>{
      if(isZoomed) return;
      const dx = (e.changedTouches[0].clientX - touchStartX);
      if(Math.abs(dx) > 50) navLightbox(dx < 0 ? 1 : -1);
    }, {passive:true});
    document.addEventListener('keydown', e=>{
      if(!lb.classList.contains('open')) return;
      if(e.key === 'Escape') closeLightbox();
      else if(e.key === 'ArrowLeft') navLightbox(-1);
      else if(e.key === 'ArrowRight') navLightbox(1);
    });
  }
  function openLightbox(idx){
    ensureLightbox();
    lightboxIndex = idx;
    updateLightboxContent();
    const lb = UI.$('#photosLightbox');
    lb.classList.add('open');
    lb.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox(){
    const lb = UI.$('#photosLightbox');
    if(lb){ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); }
    document.body.style.overflow = '';
    lightboxIndex = -1;
  }
  function navLightbox(delta){
    const s = A.state();
    const photos = Photos.listTeamPhotos(s, selectedTeam);
    if(!photos.length) return;
    lightboxIndex = (lightboxIndex + delta + photos.length) % photos.length;
    updateLightboxContent();
  }
  function updateLightboxContent(){
    const s = A.state();
    const photos = Photos.listTeamPhotos(s, selectedTeam);
    const p = photos[lightboxIndex];
    if(!p) return closeLightbox();
    const lb = UI.$('#photosLightbox');
    const img = lb.querySelector('.lightbox-img');
    const thumbSrc = p.thumbUrl || p.url;
    const hdSrc = p.originalUrl || p.url;
    img.src = thumbSrc;
    img.alt = p.name;
    if(hdSrc && hdSrc !== thumbSrc){
      const preloader = new Image();
      preloader.onload = () => {
        if(lb.classList.contains('open') && img.alt === p.name){
          img.src = hdSrc;
        }
      };
      preloader.src = hdSrc;
    }
    lb.querySelector('.lightbox-name').textContent = p.name;
    const sizeInfo = p.hasOriginal && p.originalSize ? formatSize(p.originalSize) + ' originale' : formatSize(p.size);
    lb.querySelector('.lightbox-counter').textContent = `${lightboxIndex+1} / ${photos.length} · ${sizeInfo}`;
    const dl = lb.querySelector('.lightbox-download');
    dl.href = hdSrc;
    dl.setAttribute('download', p.name);
  }

  // -------------------- Event handlers --------------------
  document.addEventListener('click', e => {
    const teamBtn = e.target.closest('[data-team-pick]');
    if(teamBtn){
      selectedTeam = teamBtn.dataset.teamPick;
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
      if(!Number.isNaN(idx)) openLightbox(idx);
      return;
    }
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
    if(e.target.id === 'photosBulkDelete'){ deleteBulk(); return; }
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

  document.addEventListener('submit', e => {
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
      if(files.length && selectedTeam) uploadFiles(files);
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
  window.addEventListener('ng:admin-state-loaded', () => render());
  window.addEventListener('ng:cloudinary-photos-updated', () => render());

  // -------------------- Boot --------------------
  function boot(){
    A.initGlobalActions?.();
    setupDragDrop();
    Photos.refreshAll?.({force:true}).catch(err => flashMsg('Cloudinary: '+(err.message||err), 'warn'));
    render();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
