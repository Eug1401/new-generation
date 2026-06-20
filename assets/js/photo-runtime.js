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

  window.NGPhotoEngine = { load, refreshGrid, retryFromButton, version: 'v105' };
})();
