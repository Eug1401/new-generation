// =============================================================
// New Generation — Foto squadre via Cloudinary + Supabase Edge Function
// v106-cloudinary
// =============================================================
// Il DB Supabase resta dedicato allo stato applicativo/articoli.
// Le foto squadra sono salvate su Cloudinary nella cartella configurata
// e vengono lette on-demand tramite Edge Function Supabase.
// =============================================================
(function(){
  'use strict';

  const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const DEFAULT_SECTION = 'foto-squadra';
  const DEFAULT_FOLDER = 'squadra';
  const DEFAULT_FUNCTION = 'team-photos';
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // Cloudinary Free: 10 MB per immagine

  const cfg = Object.assign({
    CLOUD_NAME: 'dc17izhac',
    FOLDER: DEFAULT_FOLDER,
    SECTION: DEFAULT_SECTION,
    EDGE_FUNCTION: DEFAULT_FUNCTION
  }, window.NEW_GENERATION_CLOUDINARY || {});

  const supabaseCfg = window.NEW_GENERATION_SUPABASE || {};
  const cache = {
    loaded: false,
    loading: null,
    loadedAt: 0,
    photos: [],
    byTeam: Object.create(null),
    error: null
  };

  function now(){ return Date.now(); }
  function escPart(v){ return encodeURIComponent(String(v || '')); }
  function isConfigured(){
    return Boolean(supabaseCfg.URL && supabaseCfg.ANON_KEY && cfg.EDGE_FUNCTION);
  }
  function functionUrl(){
    return String(supabaseCfg.URL || '').replace(/\/$/, '') + '/functions/v1/' + encodeURIComponent(cfg.EDGE_FUNCTION || DEFAULT_FUNCTION);
  }
  function headers(json=false){
    const h = {
      'Authorization': 'Bearer ' + supabaseCfg.ANON_KEY,
      'apikey': supabaseCfg.ANON_KEY
    };
    if(json) h['Content-Type'] = 'application/json';
    return h;
  }
  function dispatch(){
    window.dispatchEvent(new CustomEvent('ng:cloudinary-photos-updated', {
      detail: { loaded: cache.loaded, error: cache.error, loadedAt: cache.loadedAt }
    }));
  }
  function normalizePhoto(p){
    const out = Object.assign({}, p || {});
    out.id = out.id || out.publicId || out.path || '';
    out.path = out.path || out.publicId || out.id;
    out.name = out.name || out.filename || String(out.path || 'foto').split('/').pop();
    out.size = Number(out.size || out.bytes || 0);
    out.originalSize = Number(out.originalSize || out.bytes || out.size || 0);
    out.ts = Number(out.ts || out.createdAtMs || Date.parse(out.createdAt || '') || 0) || now();
    out.url = out.thumbUrl || out.mediumUrl || out.largeUrl || out.originalUrl || out.url || '';
    out.thumbUrl = out.thumbUrl || out.url;
    out.previewUrl = out.previewUrl || out.thumbUrl || out.url;
    out.largeUrl = out.largeUrl || out.originalUrl || out.previewUrl || out.url;
    out.originalUrl = out.originalUrl || out.largeUrl || out.url;
    out.downloadUrl = out.downloadUrl || out.originalUrl;
    out.hasOriginal = true;
    out.hasThumb = true;
    return out;
  }
  function setCache(list){
    const photos = Array.isArray(list) ? list.map(normalizePhoto).filter(p => p.path && (p.thumbUrl || p.originalUrl || p.url)) : [];
    photos.sort((a,b) => (b.ts || 0) - (a.ts || 0));
    const byTeam = Object.create(null);
    photos.forEach(p => {
      const teamId = String(p.teamId || '').trim();
      if(!teamId) return;
      if(!byTeam[teamId]) byTeam[teamId] = [];
      byTeam[teamId].push(p);
    });
    cache.loaded = true;
    cache.error = null;
    cache.loadedAt = now();
    cache.photos = photos;
    cache.byTeam = byTeam;
  }
  function legacyListFromState(state, teamId){
    const map = state?.teamPhotos || {};
    const arr = Array.isArray(map[teamId]) ? map[teamId] : [];
    return arr.map(normalizePhoto);
  }

  async function apiGet(params={}){
    if(!isConfigured()) throw new Error('Supabase/Cloudinary non configurati');
    const qs = new URLSearchParams();
    qs.set('folder', cfg.FOLDER || DEFAULT_FOLDER);
    Object.entries(params || {}).forEach(([k,v]) => { if(v !== undefined && v !== null && v !== '') qs.set(k, v); });
    const res = await fetch(functionUrl() + '?' + qs.toString(), { method:'GET', headers: headers(false) });
    const data = await safeJson(res);
    if(!res.ok) throw new Error(data?.error || data?.message || 'Errore Cloudinary');
    return data;
  }
  async function safeJson(res){
    try{ return await res.json(); }catch(_){ return null; }
  }

  async function refreshAll(opts={}){
    if(cache.loading && !opts.force) return cache.loading;
    if(cache.loaded && !opts.force && now() - cache.loadedAt < 15000) return cache.photos;
    cache.loading = (async()=>{
      try{
        const data = await apiGet({});
        setCache(data.photos || []);
        dispatch();
        return cache.photos;
      }catch(err){
        cache.error = err;
        dispatch();
        throw err;
      }finally{
        cache.loading = null;
      }
    })();
    return cache.loading;
  }

  async function fetchTeamPhotos(teamId, opts={}){
    if(!teamId) return [];
    if(cache.loaded && !opts.force && cache.byTeam[teamId]) return cache.byTeam[teamId].slice();
    await refreshAll({ force: !!opts.force });
    return (cache.byTeam[teamId] || []).slice();
  }

  function getTeamPhotoMap(state){
    if(cache.loaded) return cache.byTeam;
    return state?.teamPhotos || {};
  }

  function listTeamPhotos(state, teamId){
    if(cache.loaded) return (cache.byTeam[teamId] || []).slice();
    return legacyListFromState(state, teamId);
  }

  function status(){
    return { loaded: cache.loaded, loading: !!cache.loading, error: cache.error, loadedAt: cache.loadedAt };
  }

  async function uploadTeamPhoto(teamId, file){
    if(!teamId) throw new Error('teamId mancante');
    if(!file) throw new Error('File mancante');
    if(!file.type || !file.type.startsWith('image/')) throw new Error('Sono accettate solo immagini');
    if(file.size > MAX_FILE_SIZE) throw new Error('Cloudinary Free accetta immagini fino a 10 MB');
    if(!isConfigured()) throw new Error('Supabase/Cloudinary non configurati');

    const fd = new FormData();
    fd.append('file', file, file.name || 'photo.jpg');
    fd.append('teamId', teamId);
    fd.append('folder', cfg.FOLDER || DEFAULT_FOLDER);
    fd.append('section', cfg.SECTION || DEFAULT_SECTION);

    const res = await fetch(functionUrl(), {
      method: 'POST',
      headers: headers(false),
      body: fd
    });
    const data = await safeJson(res);
    if(!res.ok) throw new Error(data?.error || data?.message || 'Upload Cloudinary fallito');
    const photo = normalizePhoto(data.photo || data);

    if(!cache.byTeam[teamId]) cache.byTeam[teamId] = [];
    cache.byTeam[teamId] = [photo].concat(cache.byTeam[teamId].filter(p => p.path !== photo.path));
    cache.photos = [photo].concat(cache.photos.filter(p => p.path !== photo.path));
    cache.loaded = true;
    cache.loadedAt = now();
    dispatch();
    return photo;
  }

  async function deleteTeamPhoto(teamId, photoOrPath){
    const publicId = typeof photoOrPath === 'object'
      ? (photoOrPath.publicId || photoOrPath.path || photoOrPath.id)
      : photoOrPath;
    if(!publicId) throw new Error('publicId mancante');
    if(!isConfigured()) throw new Error('Supabase/Cloudinary non configurati');
    const res = await fetch(functionUrl(), {
      method: 'DELETE',
      headers: headers(true),
      body: JSON.stringify({ publicId, folder: cfg.FOLDER || DEFAULT_FOLDER })
    });
    const data = await safeJson(res);
    if(!res.ok) throw new Error(data?.error || data?.message || 'Eliminazione Cloudinary fallita');

    cache.photos = cache.photos.filter(p => p.path !== publicId && p.publicId !== publicId && p.id !== publicId);
    Object.keys(cache.byTeam).forEach(t => {
      cache.byTeam[t] = (cache.byTeam[t] || []).filter(p => p.path !== publicId && p.publicId !== publicId && p.id !== publicId);
    });
    cache.loadedAt = now();
    dispatch();
    return true;
  }

  function publicUrl(path){
    if(!path) return '';
    if(/^https?:\/\//i.test(path)) return path;
    return `https://res.cloudinary.com/${cfg.CLOUD_NAME}/image/upload/${path}`;
  }

  function compressImage(file){
    // Con Cloudinary preserviamo l'originale: niente ricompressione client.
    return Promise.resolve(file);
  }

  async function downloadAllAsZip(state, teamId, teamName){
    let photos = listTeamPhotos(state, teamId);
    if(!photos.length){
      try{ photos = await fetchTeamPhotos(teamId, {force:true}); }catch(_){}
    }
    if(!photos.length) throw new Error('Nessuna foto da scaricare');
    if(!window.JSZip){
      await loadScript(JSZIP_CDN);
      if(!window.JSZip) throw new Error('JSZip non disponibile');
    }
    const zip = new window.JSZip();
    const CONCURRENCY = 4;
    let idx = 0;
    async function worker(){
      while(idx < photos.length){
        const p = photos[idx++];
        const url = p.originalUrl || p.largeUrl || p.url;
        if(!url) continue;
        try{
          const res = await fetch(url, { mode:'cors' });
          if(!res.ok) throw new Error('HTTP '+res.status);
          const blob = await res.blob();
          zip.file(safeFileName(p.name || `${p.id || idx}.jpg`), blob, {binary:true});
        }catch(err){
          console.warn('Download foto fallito:', p.name, err);
        }
      }
    }
    await Promise.all(Array.from({length: Math.min(CONCURRENCY, photos.length)}, worker));
    const content = await zip.generateAsync({type:'blob', compression:'STORE'});
    const a = document.createElement('a');
    const url = URL.createObjectURL(content);
    a.href = url;
    a.download = safeFileName(`${teamName || 'foto-squadra'}-originali.zip`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  }

  function safeFileName(name){
    return String(name || 'foto.jpg').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error('Script non caricato: '+src));
      document.head.appendChild(s);
    });
  }

  window.NexoraPhotos = {
    version: 'v106-cloudinary',
    config: cfg,
    status,
    refreshAll,
    fetchTeamPhotos,
    getTeamPhotoMap,
    listTeamPhotos,
    uploadTeamPhoto,
    deleteTeamPhoto,
    publicUrl,
    compressImage,
    downloadAllAsZip
  };
})();
