// =============================================================
// New Generation — PhotoRuntime v105
// Gestione immagini foto riscritta da zero.
// Obiettivi:
//   1) mai mostrare "Foto non disponibile" se l'originale è caricabile;
//   2) DOM stabile durante refresh realtime;
//   3) caricamento veloce e controllato su mobile/desktop;
//   4) download sempre dall'originale.
// =============================================================
(function(){
  'use strict';

  const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const MAX_ACTIVE_DESKTOP = 4;
  const MAX_ACTIVE_MOBILE = 2;
  const NEAR_VIEWPORT_MARGIN = '900px 0px';
  const FIRST_EAGER_COUNT = 6;
  const PREVIEW_TIMEOUT_MS = 15000;
  const ORIGINAL_TIMEOUT_MS = 45000;

  const queue = [];
  const states = new WeakMap();
  let active = 0;
  let io = null;

  function isMobileLike(){
    try{ return window.matchMedia('(max-width: 760px), (pointer: coarse)').matches; }
    catch(_){ return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
  }

  function maxActive(){ return isMobileLike() ? MAX_ACTIVE_MOBILE : MAX_ACTIVE_DESKTOP; }

  function escUrl(url){ return String(url || '').trim(); }

  function normalizeUrl(url){
    url = escUrl(url);
    if(!url) return '';
    // Supabase public URLs sono versionate dal path unico dell'upload. Non aggiungo
    // cache-buster casuali: evitano cache utile e possono creare corse su mobile.
    return url;
  }

  function stableCacheBustedUrl(url, version){
    url = escUrl(url);
    if(!url) return '';
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'ng_photo_v=' + encodeURIComponent(version || Date.now());
  }

  function candidatesFor(img){
    const preview = normalizeUrl(img.dataset.previewSrc || img.dataset.src || img.dataset.photoPreview || '');
    const original = normalizeUrl(img.dataset.originalSrc || img.dataset.fallbackSrc || img.dataset.photoOriginal || '');
    const version = img.dataset.photoVersion || img.closest('.photo-thumb')?.dataset.photoVersion || '';
    const out = [];

    // Griglia: preview prima per velocità, originale come fonte definitiva.
    // Se la preview manca o fallisce, l'originale viene caricato nello stesso <img>.
    if(preview) out.push({url: preview, kind: 'preview', timeout: PREVIEW_TIMEOUT_MS});
    if(original && original !== preview) out.push({url: original, kind: 'original', timeout: ORIGINAL_TIMEOUT_MS});

    // Ultimo tentativo stabile: stessa risorsa originale con query versionata,
    // utile se il browser/mobile conserva una risposta fallita/stale.
    if(original){
      const busted = stableCacheBustedUrl(original, version || img.dataset.photoPath || img.dataset.photoId || 'original');
      if(!out.some(c => c.url === busted)) out.push({url: busted, kind: 'original-cache-refresh', timeout: ORIGINAL_TIMEOUT_MS});
    }

    return out;
  }

  function signatureFor(img){
    return candidatesFor(img).map(c => c.url).join('|');
  }

  function cardFor(img){ return img.closest('.photo-thumb'); }

  function mark(card, status){
    if(!card) return;
    card.classList.remove('is-loading','is-loaded','is-broken');
    if(status === 'loading') card.classList.add('is-loading');
    if(status === 'loaded') card.classList.add('is-loaded');
    if(status === 'broken') card.classList.add('is-broken');
  }

  function clearImgHandlers(img){
    img.onload = null;
    img.onerror = null;
  }

  function finalizeLoaded(img, state){
    if(states.get(img) !== state) return;
    clearTimeout(state.timer);
    clearImgHandlers(img);
    mark(cardFor(img), 'loaded');
    img.dataset.photoLoaded = '1';
    img.dataset.photoLoadedSrc = img.currentSrc || img.src || '';
    img.classList.remove('is-loading');
    img.removeAttribute('aria-busy');
    active = Math.max(0, active - 1);
    pump();
  }

  function tryNext(img, state){
    if(states.get(img) !== state) return;
    clearTimeout(state.timer);
    clearImgHandlers(img);

    const candidate = state.candidates[state.index++];
    if(!candidate){
      mark(cardFor(img), 'broken');
      img.dataset.photoLoaded = '0';
      img.removeAttribute('aria-busy');
      active = Math.max(0, active - 1);
      pump();
      return;
    }

    img.dataset.photoActiveKind = candidate.kind;
    img.onload = function(){
      if(states.get(img) !== state) return;
      if(img.naturalWidth > 0 || img.naturalHeight > 0) finalizeLoaded(img, state);
      else tryNext(img, state);
    };
    img.onerror = function(){ tryNext(img, state); };
    state.timer = setTimeout(() => tryNext(img, state), candidate.timeout);

    // Impostare src solo dopo handler evita l'evento perso da cache/refresh.
    if(img.src !== candidate.url) img.src = candidate.url;
    else {
      // Se è già la stessa src e il browser l'ha completata in cache, rivaluto.
      requestAnimationFrame(() => {
        if(states.get(img) !== state) return;
        if(img.complete && (img.naturalWidth > 0 || img.naturalHeight > 0)) finalizeLoaded(img, state);
      });
    }
  }

  function start(img){
    const current = states.get(img);
    if(!current || current.started) return;
    current.started = true;
    active++;
    mark(cardFor(img), 'loading');
    img.classList.add('is-loading');
    img.setAttribute('aria-busy','true');
    img.decoding = 'async';
    img.loading = current.priority ? 'eager' : 'lazy';
    if(current.priority && 'fetchPriority' in img) img.fetchPriority = 'high';
    tryNext(img, current);
  }

  function enqueue(img, priority){
    const st = states.get(img);
    if(!st || st.queued || st.started) return;
    st.queued = true;
    if(priority) queue.unshift(img);
    else queue.push(img);
    pump();
  }

  function pump(){
    while(active < maxActive() && queue.length){
      const img = queue.shift();
      const st = states.get(img);
      if(!st || st.started) continue;
      st.queued = false;
      start(img);
    }
  }

  function observeOrQueue(img, priority){
    if(priority){ enqueue(img, true); return; }
    if(!('IntersectionObserver' in window)){
      enqueue(img, false);
      return;
    }
    if(!io){
      io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if(!entry.isIntersecting) return;
          io.unobserve(entry.target);
          enqueue(entry.target, false);
        });
      }, { root: null, rootMargin: NEAR_VIEWPORT_MARGIN, threshold: 0.01 });
    }
    io.observe(img);
  }

  function load(img, opts={}){
    if(!img) return;
    const card = cardFor(img);
    const force = !!opts.force;
    const priorityIndex = Number.isFinite(opts.priorityIndex) ? opts.priorityIndex : Number(img.dataset.photoPriorityIndex || img.dataset.photoOpen || img.dataset.photoIndex || 9999);
    const priority = !!opts.priority || priorityIndex < FIRST_EAGER_COUNT;
    const sig = signatureFor(img);

    const old = states.get(img);
    if(old && old.signature === sig && !force){
      if(card && card.classList.contains('is-broken')) return load(img, {force:true, priority:true});
      return;
    }

    if(old){
      clearTimeout(old.timer);
      clearImgHandlers(img);
      old.cancelled = true;
      if(old.started) active = Math.max(0, active - 1);
      try{ if(io) io.unobserve(img); }catch(_){}
    }

    const candidates = candidatesFor(img);
    img.dataset.photoSignature = sig;
    img.dataset.photoLoaded = '0';
    if(!img.src || img.src === window.location.href) img.src = TRANSPARENT_PIXEL;
    mark(card, 'loading');

    const state = {
      signature: sig,
      candidates,
      index: 0,
      timer: null,
      started: false,
      queued: false,
      priority
    };
    states.set(img, state);

    if(!candidates.length){
      mark(card, 'broken');
      return;
    }

    observeOrQueue(img, priority);
  }

  function refreshGrid(root){
    const scope = root || document;
    scope.querySelectorAll('img[data-photo-managed="1"], img[data-src][data-fallback-src]').forEach((img, idx) => {
      load(img, { priorityIndex: idx });
    });
  }

  function retryFromButton(button){
    const card = button?.closest?.('.photo-thumb');
    const img = card?.querySelector?.('img[data-photo-managed="1"], img[data-src][data-fallback-src]');
    if(img) load(img, {force:true, priority:true});
  }

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') refreshGrid(document);
  });
  window.addEventListener('online', () => refreshGrid(document));

  window.NGPhotoEngine = { load, refreshGrid, retryFromButton, version: 'v126.16' };

  // Visualizzatore condiviso da galleria pubblica, galleria admin e dettaglio articolo.
  // Gestisce focus, Escape, zoom, pan, wheel e pinch senza modificare gli URL sorgente.
  function bindImageViewer(root,{onClose,onPrevious,onNext}={}){
    if(!root) return null;
    if(root._ngViewerApi) return root._ngViewerApi;
    const image=root.querySelector('.lightbox-img');
    const stage=root.querySelector('.lightbox-stage');
    const closeButton=root.querySelector('.lightbox-close');
    const pointers=new Map();
    let scale=1,x=0,y=0,dragStart=null,pinchStart=null,loadToken=0,lastTrigger=null;

    function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
    function apply(){
      if(!image)return;
      if(scale<=1){x=0;y=0;}
      image.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
      image.classList.toggle('is-zoomed',scale>1.01);
      image.setAttribute('data-zoom',scale.toFixed(2));
      const label=root.querySelector('[data-viewer-zoom-label]');
      if(label)label.textContent=Math.round(scale*100)+'%';
    }
    function setScale(next,originX=0,originY=0){
      const previous=scale;
      scale=clamp(next,1,4);
      if(previous!==scale&&previous>0&&scale>1){
        const ratio=scale/previous;
        x=originX-(originX-x)*ratio;
        y=originY-(originY-y)*ratio;
      }
      apply();
    }
    function reset(){scale=1;x=0;y=0;dragStart=null;pinchStart=null;pointers.clear();apply();}
    function ensureControls(){
      const bar=root.querySelector('.lightbox-bar');
      if(!bar||bar.querySelector('.lightbox-zoom-controls'))return;
      const controls=document.createElement('div');
      controls.className='lightbox-zoom-controls';
      controls.setAttribute('aria-label','Controlli zoom');
      controls.innerHTML='<button type="button" class="btn small" data-viewer-zoom-out aria-label="Riduci zoom">−</button><span data-viewer-zoom-label aria-live="polite">100%</span><button type="button" class="btn small" data-viewer-zoom-in aria-label="Aumenta zoom">+</button><button type="button" class="btn small" data-viewer-reset aria-label="Ripristina zoom">100%</button>';
      bar.insertBefore(controls,bar.querySelector('.lightbox-download')||null);
    }
    ensureControls();

    function open(trigger){
      lastTrigger=trigger||document.activeElement;
      reset();
      root.classList.add('open');
      root.setAttribute('aria-hidden','false');
      document.body.classList.add('ng-overlay-open');
      requestAnimationFrame(()=>closeButton?.focus?.());
    }
    function close(){
      if(!root.classList.contains('open'))return;
      root.classList.remove('open');
      root.setAttribute('aria-hidden','true');
      document.body.classList.remove('ng-overlay-open');
      reset();
      loadToken++;
      const trigger=lastTrigger;lastTrigger=null;
      requestAnimationFrame(()=>trigger&&document.contains(trigger)&&trigger.focus?.({preventScroll:true}));
      onClose?.();
    }
    function setContent({preview='',large='',alt='',name='',counter='',downloadUrl='',downloadName=''}={}){
      const token=++loadToken;
      reset();
      if(image){
        image.alt=alt||name||'Fotografia';
        image.src=preview||large||'';
        if(large&&large!==preview){
          const preloader=new Image();
          preloader.onload=()=>{if(token===loadToken&&root.classList.contains('open'))image.src=large;};
          preloader.src=large;
        }
      }
      const nameEl=root.querySelector('.lightbox-name');if(nameEl)nameEl.textContent=name||'';
      const counterEl=root.querySelector('.lightbox-counter');if(counterEl)counterEl.textContent=counter||'';
      const download=root.querySelector('.lightbox-download');
      if(download){download.href=downloadUrl||large||preview||'#';download.setAttribute('download',downloadName||name||'foto');}
    }

    root.addEventListener('click',event=>{
      if(event.target.closest('[data-viewer-zoom-in]')){setScale(scale+.5);return;}
      if(event.target.closest('[data-viewer-zoom-out]')){setScale(scale-.5);return;}
      if(event.target.closest('[data-viewer-reset]')){reset();return;}
      if(event.target.closest('.lightbox-close')){close();return;}
      if(event.target.closest('.lightbox-prev')){reset();onPrevious?.();return;}
      if(event.target.closest('.lightbox-next')){reset();onNext?.();return;}
      if(event.target===root||(event.target===stage&&scale<=1.01))close();
    });
    image?.addEventListener('dblclick',event=>{event.preventDefault();setScale(scale>1?1:2,event.offsetX,event.offsetY);});
    stage?.addEventListener('wheel',event=>{
      if(!root.classList.contains('open'))return;
      event.preventDefault();
      const rect=stage.getBoundingClientRect();
      setScale(scale+(event.deltaY<0?.35:-.35),event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2);
    },{passive:false});
    image?.addEventListener('pointerdown',event=>{
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      image.setPointerCapture?.(event.pointerId);
      if(pointers.size===1&&scale>1)dragStart={px:event.clientX,py:event.clientY,x,y};
      if(pointers.size===2){const values=[...pointers.values()];pinchStart={distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y),scale};}
    });
    image?.addEventListener('pointermove',event=>{
      if(!pointers.has(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(pointers.size===2&&pinchStart){const values=[...pointers.values()];const distance=Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y);setScale(pinchStart.scale*(distance/Math.max(1,pinchStart.distance)));return;}
      if(dragStart&&scale>1){x=dragStart.x+(event.clientX-dragStart.px);y=dragStart.y+(event.clientY-dragStart.py);apply();}
    });
    function pointerEnd(event){pointers.delete(event.pointerId);dragStart=null;if(pointers.size<2)pinchStart=null;}
    image?.addEventListener('pointerup',pointerEnd);image?.addEventListener('pointercancel',pointerEnd);
    document.addEventListener('keydown',event=>{
      if(!root.classList.contains('open'))return;
      if(event.key==='Tab'){
        const focusable=[...root.querySelectorAll('button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.getClientRects().length);
        if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
      }else if(event.key==='Escape'){event.preventDefault();close();}
      else if(event.key==='ArrowLeft'){event.preventDefault();reset();onPrevious?.();}
      else if(event.key==='ArrowRight'){event.preventDefault();reset();onNext?.();}
      else if(event.key==='+'||event.key==='='){event.preventDefault();setScale(scale+.5);}
      else if(event.key==='-'){event.preventDefault();setScale(scale-.5);}
      else if(event.key==='0'){event.preventDefault();reset();}
    });
    const api={open,close,reset,setContent,get scale(){return scale;}};
    root._ngViewerApi=api;
    return api;
  }

  window.NGImageViewer={bind:bindImageViewer,version:'v126.16'};
})();
