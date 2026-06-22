// =============================================================
// New Generation — Foto squadre via Cloudinary + Supabase Edge Function
// v126.16-photo-network
// =============================================================
// Flusso esclusivo galleria Foto. Non usa endpoint, modelli o cartelle Articoli.
// - GET pubblico senza header non semplici: niente preflight inutile.
// - Upload/modifica/eliminazione con access token della sessione admin.
// - Timeout, abort, errori strutturati e messaggi distinti.
// - Originali e ZIP scaricati dalla Edge Function, non via fetch CORS Cloudinary.
// =============================================================
(function(){
  'use strict';

  const DEFAULT_SECTION = 'foto-squadra';
  const DEFAULT_FOLDER = 'squadra';
  const DEFAULT_FUNCTION = 'team-photos';
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_BATCH_FILES = 20;
  const MAX_BATCH_SIZE = 80 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 120 * 1000 * 1000;
  const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp']);
  const ALLOWED_EXTENSIONS = new Set(['jpg','jpeg','png','webp']);
  const REQUEST_TIMEOUT_MS = 45000;
  const UPLOAD_TIMEOUT_MS = 75000;
  const ZIP_TIMEOUT_MS = 120000;

  const cfg = Object.assign({
    CLOUD_NAME: 'dc17izhac',
    FOLDER: DEFAULT_FOLDER,
    SECTION: DEFAULT_SECTION,
    EDGE_FUNCTION: DEFAULT_FUNCTION,
    FUNCTION_URL: ''
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

  class PhotoError extends Error{
    constructor(message,{code='PHOTO_ERROR',kind='unknown',status=0,phase='',details=null,cause=null}={}){
      super(message);
      this.name='PhotoError';
      this.code=code;
      this.kind=kind;
      this.status=Number(status)||0;
      this.phase=phase;
      this.details=details;
      if(cause)this.cause=cause;
    }
  }

  function now(){ return Date.now(); }
  function isConfigured(){ return Boolean((cfg.FUNCTION_URL || supabaseCfg.URL) && cfg.EDGE_FUNCTION); }
  function functionUrl(action=''){
    const base = cfg.FUNCTION_URL
      ? String(cfg.FUNCTION_URL).replace(/\/$/,'')
      : String(supabaseCfg.URL || '').replace(/\/$/,'') + '/functions/v1/' + encodeURIComponent(cfg.EDGE_FUNCTION || DEFAULT_FUNCTION);
    if(!action) return base;
    return base + (base.includes('?')?'&':'?') + 'action=' + encodeURIComponent(action);
  }
  function assertTransportConfig(){
    if(!isConfigured()) throw new PhotoError('Servizio Foto non configurato.',{code:'CONFIG_MISSING',kind:'config',phase:'config'});
    const url=functionUrl();
    if(window.location?.protocol==='https:' && /^http:\/\//i.test(url)){
      throw new PhotoError('Configurazione non valida: una pagina HTTPS non può chiamare un endpoint HTTP.',{code:'MIXED_CONTENT',kind:'config',phase:'config'});
    }
    try{ new URL(url); }catch(error){
      throw new PhotoError('URL della Edge Function Foto non valido.',{code:'INVALID_URL',kind:'config',phase:'config',cause:error});
    }
  }
  function dispatch(){
    window.dispatchEvent(new CustomEvent('ng:cloudinary-photos-updated',{
      detail:{loaded:cache.loaded,error:cache.error,loadedAt:cache.loadedAt}
    }));
  }
  function normalizePhoto(photo){
    const out=Object.assign({},photo||{});
    out.id=out.publicId||out.path||out.id||'';
    out.dbId=out.dbId||out.db_id||'';
    out.publicId=out.publicId||out.public_id||out.path||out.id||'';
    out.path=out.path||out.publicId||out.id;
    out.teamId=out.teamId||out.team_id||'';
    out.name=out.name||out.originalName||out.original_name||out.filename||String(out.path||'foto').split('/').pop();
    out.originalName=out.originalName||out.original_name||out.name;
    out.title=out.title||'';
    out.description=out.description||'';
    out.caption=out.caption||'';
    out.altText=out.altText||out.alt_text||'';
    out.album=out.album||'';
    out.order=Number(out.order??out.display_order??0)||0;
    out.version=Number(out.version||0)||0;
    out.format=out.format||'';
    out.mimeType=out.mimeType||out.mime_type||'';
    out.width=Number(out.width||0)||0;
    out.height=Number(out.height||0)||0;
    out.size=Number(out.size||out.bytes||0);
    out.originalSize=Number(out.originalSize||out.bytes||out.size||0);
    out.ts=Number(out.ts||out.createdAtMs||Date.parse(out.createdAt||out.created_at||'')||0)||now();
    out.createdAt=out.createdAt||out.created_at||'';
    out.updatedAt=out.updatedAt||out.updated_at||out.createdAt;
    out.thumbUrl=out.thumbUrl||out.thumb_url||out.previewUrl||out.preview_url||out.url||'';
    out.mediumUrl=out.mediumUrl||out.medium_url||out.thumbUrl||'';
    out.largeUrl=out.largeUrl||out.large_url||out.mediumUrl||out.originalUrl||'';
    out.originalUrl=out.originalUrl||out.original_url||out.largeUrl||out.url||'';
    out.downloadUrl=out.downloadUrl||out.download_url||out.originalUrl;
    out.url=out.thumbUrl||out.mediumUrl||out.largeUrl||out.originalUrl||out.url||'';
    out.previewUrl=out.previewUrl||out.thumbUrl||out.url;
    out.hasOriginal=Boolean(out.originalUrl);
    out.hasThumb=Boolean(out.thumbUrl);
    return out;
  }
  function setCache(list){
    const photos=Array.isArray(list)?list.map(normalizePhoto).filter(photo=>photo.path&&(photo.thumbUrl||photo.originalUrl||photo.url)):[];
    photos.sort((a,b)=>(a.order||0)-(b.order||0)||(b.ts||0)-(a.ts||0));
    const byTeam=Object.create(null);
    photos.forEach(photo=>{
      const teamId=String(photo.teamId||'').trim();
      if(!teamId)return;
      if(!byTeam[teamId])byTeam[teamId]=[];
      byTeam[teamId].push(photo);
    });
    cache.loaded=true;
    cache.error=null;
    cache.loadedAt=now();
    cache.photos=photos;
    cache.byTeam=byTeam;
  }
  function legacyListFromState(state,teamId){
    const map=state?.teamPhotos||{};
    const rows=Array.isArray(map[teamId])?map[teamId]:[];
    return rows.map(normalizePhoto);
  }
  function invalidateCache(){
    cache.loaded=false;
    cache.loadedAt=0;
  }
  function safeLog(level,event,data={}){
    const payload={scope:'team-photos',event,...data};
    delete payload.token;
    delete payload.authorization;
    const fn=console[level]||console.info;
    fn.call(console,'[Foto]',payload);
  }
  function combineSignals(external,timeoutMs){
    const controller=new AbortController();
    let timedOut=false;
    const abort=()=>controller.abort(external?.reason);
    if(external){
      if(external.aborted)abort();
      else external.addEventListener('abort',abort,{once:true});
    }
    const timer=setTimeout(()=>{timedOut=true;controller.abort(new DOMException('Timeout','TimeoutError'));},timeoutMs);
    return {signal:controller.signal,timedOut:()=>timedOut,cleanup:()=>{clearTimeout(timer);external?.removeEventListener?.('abort',abort);}};
  }
  async function sessionToken(){
    const client=window.NG_SUPABASE_CLIENT;
    if(!client?.auth?.getSession){
      throw new PhotoError('Servizio di autenticazione non disponibile. Ricarica la pagina.',{code:'AUTH_SERVICE_MISSING',kind:'auth',phase:'auth'});
    }
    const {data,error}=await client.auth.getSession();
    if(error)throw new PhotoError(error.message||'Impossibile leggere la sessione.',{code:'AUTH_SESSION_ERROR',kind:'auth',phase:'auth',cause:error});
    const token=data?.session?.access_token||'';
    if(!token)throw new PhotoError('Sessione amministratore scaduta. Accedi di nuovo.',{code:'AUTH_REQUIRED',kind:'auth',status:401,phase:'auth'});
    return token;
  }
  function errorKind(status,code){
    if(status===401||status===403||/^AUTH_|ORIGIN_/.test(code))return 'auth';
    if(status===408||status===504||/TIMEOUT/.test(code))return 'timeout';
    if(status===413||/TOO_LARGE/.test(code))return 'size';
    if(status===415||/UNSUPPORTED|CORRUPT|EMPTY_FILE/.test(code))return 'validation';
    if(/CLOUDINARY/.test(code))return 'cloudinary';
    if(/^DB_/.test(code))return 'database';
    if(status>=500)return 'server';
    return 'http';
  }
  async function parseResponse(response){
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    const text=await response.text();
    if(!text)return null;
    if(type.includes('application/json')){
      try{return JSON.parse(text);}catch(_){return {message:'Risposta JSON non valida dal backend.'};}
    }
    if(type.includes('text/html'))return {message:'Il proxy ha restituito HTML invece di JSON.',rawType:'html'};
    try{return JSON.parse(text);}catch(_){return {message:text.slice(0,500),rawType:type||'text'};}
  }
  async function apiRequest({method='GET',action='',params=null,body=null,admin=false,signal=null,timeout=REQUEST_TIMEOUT_MS,phase='request',expect='json'}={}){
    assertTransportConfig();
    const url=new URL(functionUrl(action));
    Object.entries(params||{}).forEach(([key,value])=>{if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));});
    const headers={};
    if(admin)headers.Authorization='Bearer '+await sessionToken();
    if(body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body!=='string'){
      headers['Content-Type']='application/json';
      body=JSON.stringify(body);
    }
    const controlled=combineSignals(signal,timeout);
    const started=performance.now();
    try{
      const response=await fetch(url.toString(),{method,headers,body,signal:controlled.signal,cache:'no-store',redirect:'error'});
      if(expect==='blob'){
        if(!response.ok){
          const data=await parseResponse(response);
          const code=String(data?.code||`HTTP_${response.status}`);
          throw new PhotoError(data?.message||data?.error||`Errore HTTP ${response.status}.`,{code,kind:errorKind(response.status,code),status:response.status,phase,details:data});
        }
        safeLog('info','request-ok',{method,phase,status:response.status,durationMs:Math.round(performance.now()-started)});
        return {response,blob:await response.blob()};
      }
      const data=await parseResponse(response);
      if(!response.ok){
        const code=String(data?.code||`HTTP_${response.status}`);
        throw new PhotoError(data?.message||data?.error||`Errore HTTP ${response.status}.`,{code,kind:errorKind(response.status,code),status:response.status,phase,details:data});
      }
      safeLog('info','request-ok',{method,phase,status:response.status,durationMs:Math.round(performance.now()-started)});
      return data||{};
    }catch(error){
      if(error instanceof PhotoError)throw error;
      const aborted=controlled.signal.aborted;
      if(aborted && controlled.timedOut()){
        throw new PhotoError('Il server Foto non ha risposto entro il tempo previsto.',{code:'REQUEST_TIMEOUT',kind:'timeout',status:504,phase,cause:error});
      }
      if(aborted){
        throw new PhotoError('Caricamento interrotto.',{code:'REQUEST_ABORTED',kind:'aborted',phase,cause:error});
      }
      const mixed=window.location?.protocol==='https:'&&/^http:\/\//i.test(url.toString());
      throw new PhotoError(mixed?'Richiesta bloccata per mixed content.':'Server Foto non raggiungibile o richiesta bloccata da CORS/preflight.',{
        code:mixed?'MIXED_CONTENT':'NETWORK_ERROR',kind:mixed?'config':'network',phase,cause:error
      });
    }finally{
      controlled.cleanup();
    }
  }
  function userMessage(error){
    const err=error instanceof PhotoError?error:new PhotoError(error?.message||String(error));
    const byCode={
      AUTH_REQUIRED:'Sessione scaduta: effettua nuovamente l’accesso amministratore.',
      AUTH_SERVICE_MISSING:'Autenticazione non disponibile: ricarica la pagina.',
      ORIGIN_NOT_ALLOWED:'Il dominio del sito non è autorizzato dalla configurazione CORS Foto.',
      NETWORK_ERROR:'Server Foto non raggiungibile. Controlla connessione, CORS e disponibilità della Edge Function.',
      MIXED_CONTENT:'Configurazione bloccata: la pagina HTTPS sta chiamando un endpoint HTTP.',
      REQUEST_TIMEOUT:'Timeout: il caricamento non è stato confermato dal backend.',
      REQUEST_ABORTED:'Caricamento interrotto.',
      FILE_TOO_LARGE:'La foto supera il limite di 10 MB.',
      BATCH_TOO_LARGE:'Il batch supera il numero o il peso massimo consentito.',
      UNSUPPORTED_TYPE:'Formato non supportato. Usa JPEG, PNG o WebP.',
      UNSUPPORTED_EXTENSION:'Estensione non supportata. Usa JPG, JPEG, PNG o WebP.',
      CORRUPT_FILE:'Il file è corrotto o non corrisponde al formato dichiarato.',
      EMPTY_FILE:'Il file selezionato è vuoto.',
      CLOUDINARY_CONFIG:'Cloudinary non è configurato sul backend.',
      CLOUDINARY_UPLOAD:'Cloudinary ha rifiutato il caricamento.',
      CLOUDINARY_TIMEOUT:'Cloudinary non ha risposto entro il tempo previsto.',
      DB_SAVE_FAILED:'La foto è stata annullata perché i metadati non sono stati salvati nel database.',
      DB_READ_FAILED:'Il database dei metadati Foto non è raggiungibile.',
      ZIP_INCOMPLETE:'ZIP non creato: almeno un originale non è disponibile.',
      ZIP_TOO_LARGE:'La selezione supera il limite ZIP di 150 MB. Riduci il numero di foto.',
      INVALID_DIMENSIONS:'La risoluzione della foto non è valida o supera 120 megapixel.',
      ORIGINAL_UNAVAILABLE:'Il file originale non è disponibile.'
    };
    return byCode[err.code]||err.message||'Operazione Foto non riuscita.';
  }

  async function apiGet(params={}){
    return apiRequest({method:'GET',params:{folder:cfg.FOLDER||DEFAULT_FOLDER,...params},phase:'gallery-read'});
  }
  async function refreshAll(opts={}){
    if(cache.loading&&!opts.force)return cache.loading;
    if(cache.loaded&&!opts.force&&now()-cache.loadedAt<15000)return cache.photos;
    cache.loading=(async()=>{
      try{
        const data=await apiGet({});
        setCache(data.photos||[]);
        dispatch();
        return cache.photos;
      }catch(error){
        cache.error=error;
        dispatch();
        throw error;
      }finally{cache.loading=null;}
    })();
    return cache.loading;
  }
  async function fetchTeamPhotos(teamId,opts={}){
    if(!teamId)return [];
    if(cache.loaded&&!opts.force&&cache.byTeam[teamId])return cache.byTeam[teamId].slice();
    if(opts.teamOnly){
      const data=await apiGet({teamId});
      const rows=(data.photos||[]).map(normalizePhoto);
      cache.byTeam[teamId]=rows;
      rows.forEach(photo=>{cache.photos=[photo].concat(cache.photos.filter(item=>item.path!==photo.path));});
      cache.loaded=true;cache.loadedAt=now();cache.error=null;dispatch();
      return rows.slice();
    }
    await refreshAll({force:!!opts.force});
    return (cache.byTeam[teamId]||[]).slice();
  }
  function getTeamPhotoMap(state){return cache.loaded?cache.byTeam:(state?.teamPhotos||{});}
  function listTeamPhotos(state,teamId){return cache.loaded?(cache.byTeam[teamId]||[]).slice():legacyListFromState(state,teamId);}
  function status(){return {loaded:cache.loaded,loading:!!cache.loading,error:cache.error,loadedAt:cache.loadedAt};}

  function extension(name){return String(name||'').split('.').pop()?.toLowerCase()||'';}
  async function sniffFile(file){
    const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
    const png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a;
    const chars=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
    const webp=chars(0,4)==='RIFF'&&chars(8,12)==='WEBP';
    return {jpeg,png,webp};
  }
  function decodeDimensions(file){
    if('createImageBitmap' in window){
      return createImageBitmap(file).then(bitmap=>{const result={width:bitmap.width,height:bitmap.height};bitmap.close?.();return result;});
    }
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);const image=new Image();
      image.onload=()=>{const result={width:image.naturalWidth,height:image.naturalHeight};URL.revokeObjectURL(url);resolve(result);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('decode failed'));};
      image.src=url;
    });
  }
  async function validateImageFile(file){
    if(!(file instanceof File))throw new PhotoError('File mancante.',{code:'FILE_MISSING',kind:'validation',phase:'validation'});
    if(!file.size)throw new PhotoError('Il file è vuoto.',{code:'EMPTY_FILE',kind:'validation',phase:'validation'});
    if(file.size>MAX_FILE_SIZE)throw new PhotoError('La foto supera il limite di 10 MB.',{code:'FILE_TOO_LARGE',kind:'size',status:413,phase:'validation'});
    if(!ALLOWED_TYPES.has(file.type))throw new PhotoError('Formato non supportato. Usa JPEG, PNG o WebP.',{code:'UNSUPPORTED_TYPE',kind:'validation',status:415,phase:'validation'});
    if(!ALLOWED_EXTENSIONS.has(extension(file.name)))throw new PhotoError('Estensione non supportata.',{code:'UNSUPPORTED_EXTENSION',kind:'validation',status:415,phase:'validation'});
    const signature=await sniffFile(file);
    const matches=(file.type==='image/jpeg'&&signature.jpeg)||(file.type==='image/png'&&signature.png)||(file.type==='image/webp'&&signature.webp);
    if(!matches)throw new PhotoError('Il file è corrotto o non corrisponde al formato dichiarato.',{code:'CORRUPT_FILE',kind:'validation',status:415,phase:'validation'});
    let dimensions;
    try{dimensions=await decodeDimensions(file);}catch(error){throw new PhotoError('Il file non contiene un’immagine leggibile.',{code:'CORRUPT_FILE',kind:'validation',status:415,phase:'validation',cause:error});}
    if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>MAX_IMAGE_PIXELS){
      throw new PhotoError('Risoluzione immagine non valida o eccessiva.',{code:'INVALID_DIMENSIONS',kind:'validation',status:415,phase:'validation'});
    }
    return {...dimensions,type:file.type,size:file.size,name:file.name};
  }
  async function validateBatch(files){
    const rows=Array.from(files||[]);
    if(rows.length>MAX_BATCH_FILES)throw new PhotoError(`Puoi selezionare al massimo ${MAX_BATCH_FILES} foto.`,{code:'BATCH_TOO_LARGE',kind:'size',status:413,phase:'validation'});
    if(rows.reduce((sum,file)=>sum+(file?.size||0),0)>MAX_BATCH_SIZE)throw new PhotoError('Il batch supera il limite totale di 80 MB.',{code:'BATCH_TOO_LARGE',kind:'size',status:413,phase:'validation'});
    const results=[];
    for(const file of rows){
      try{results.push({file,ok:true,meta:await validateImageFile(file)});}
      catch(error){results.push({file,ok:false,error});}
    }
    return results;
  }

  async function uploadTeamPhoto(teamId,file,opts={}){
    if(!teamId)throw new PhotoError('Squadra mancante.',{code:'TEAM_MISSING',kind:'validation',phase:'validation'});
    await validateImageFile(file);
    const fd=new FormData();
    fd.append('file',file,file.name||'photo.jpg');
    fd.append('teamId',teamId);
    fd.append('folder',cfg.FOLDER||DEFAULT_FOLDER);
    fd.append('section',cfg.SECTION||DEFAULT_SECTION);
    ['title','description','caption','altText','album','order'].forEach(key=>{if(opts[key]!==undefined&&opts[key]!==null)fd.append(key,String(opts[key]));});
    const data=await apiRequest({method:'POST',body:fd,admin:true,signal:opts.signal,timeout:UPLOAD_TIMEOUT_MS,phase:'upload'});
    const photo=normalizePhoto(data.photo||(data.created||[])[0]);
    if(!photo.path){
      const failed=data.failed?.[0];
      throw new PhotoError(failed?.message||'Il backend non ha confermato il caricamento.',{code:failed?.code||'UPLOAD_NOT_CONFIRMED',kind:errorKind(failed?.status||500,failed?.code||''),status:failed?.status||500,phase:'upload',details:data});
    }
    if(!cache.byTeam[teamId])cache.byTeam[teamId]=[];
    cache.byTeam[teamId]=[photo].concat(cache.byTeam[teamId].filter(item=>item.path!==photo.path));
    cache.photos=[photo].concat(cache.photos.filter(item=>item.path!==photo.path));
    cache.loaded=true;cache.loadedAt=now();cache.error=null;dispatch();
    return photo;
  }
  async function updatePhotoMetadata(photoOrId,metadata={}){
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    if(!photoId)throw new PhotoError('Identificativo foto mancante.',{code:'PHOTO_ID_MISSING',kind:'validation',phase:'metadata'});
    const data=await apiRequest({method:'PATCH',admin:true,body:{photoId,...metadata},phase:'metadata'});
    const photo=normalizePhoto(data.photo);
    cache.photos=cache.photos.map(item=>item.path===photoId?photo:item);
    Object.keys(cache.byTeam).forEach(teamId=>{cache.byTeam[teamId]=(cache.byTeam[teamId]||[]).map(item=>item.path===photoId?photo:item);});
    cache.loadedAt=now();dispatch();
    return photo;
  }
  async function replaceTeamPhoto(teamId,photoOrId,file,metadata={},opts={}){
    await validateImageFile(file);
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    const fd=new FormData();
    fd.append('file',file,file.name||'photo.jpg');fd.append('photoId',photoId);fd.append('teamId',teamId||'');
    ['title','description','caption','altText','album','order'].forEach(key=>{if(metadata[key]!==undefined&&metadata[key]!==null)fd.append(key,String(metadata[key]));});
    const data=await apiRequest({method:'PUT',body:fd,admin:true,signal:opts.signal,timeout:UPLOAD_TIMEOUT_MS,phase:'replace'});
    const photo=normalizePhoto(data.photo);
    cache.photos=cache.photos.map(item=>item.path===photoId?photo:item);
    Object.keys(cache.byTeam).forEach(id=>{cache.byTeam[id]=(cache.byTeam[id]||[]).filter(item=>item.path!==photoId);});
    if(!cache.byTeam[photo.teamId])cache.byTeam[photo.teamId]=[];
    cache.byTeam[photo.teamId].unshift(photo);
    cache.loadedAt=now();dispatch();
    return {photo,warning:data.warning||''};
  }
  async function deleteTeamPhoto(teamId,photoOrId){
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    if(!photoId)throw new PhotoError('Identificativo foto mancante.',{code:'PHOTO_ID_MISSING',kind:'validation',phase:'delete'});
    await apiRequest({method:'DELETE',admin:true,body:{photoId,teamId,folder:cfg.FOLDER||DEFAULT_FOLDER},phase:'delete'});
    cache.photos=cache.photos.filter(photo=>![photo.path,photo.publicId,photo.id].includes(photoId));
    Object.keys(cache.byTeam).forEach(id=>{cache.byTeam[id]=(cache.byTeam[id]||[]).filter(photo=>![photo.path,photo.publicId,photo.id].includes(photoId));});
    cache.loadedAt=now();dispatch();
    return true;
  }

  function publicUrl(path){
    if(!path)return '';
    if(/^https?:\/\//i.test(path))return path;
    return `https://res.cloudinary.com/${cfg.CLOUD_NAME}/image/upload/${path}`;
  }
  function originalDownloadUrl(photoOrId){
    const photoId=typeof photoOrId==='object'?(photoOrId.publicId||photoOrId.path||photoOrId.id):photoOrId;
    const url=new URL(functionUrl('download'));
    url.searchParams.set('photoId',photoId||'');
    return url.toString();
  }
  function downloadOriginal(photo){
    if(!photo)return;
    const anchor=document.createElement('a');
    anchor.href=originalDownloadUrl(photo);
    anchor.rel='noopener';
    anchor.download=String(photo.name||'foto');
    document.body.appendChild(anchor);anchor.click();anchor.remove();
  }
  function safeFileName(name){return String(name||'foto').replace(/[\\/:*?"<>|]+/g,'_').slice(0,120);}
  async function downloadSelectedAsZip(photos,teamId,teamName,{signal}={}){
    const rows=Array.from(photos||[]).map(normalizePhoto).filter(photo=>photo.path);
    if(!rows.length)throw new PhotoError('Nessuna foto selezionata.',{code:'ZIP_EMPTY',kind:'validation',phase:'zip'});
    const {response,blob}=await apiRequest({method:'POST',action:'zip',body:{ids:rows.map(photo=>photo.publicId||photo.path),teamId,teamName},signal,timeout:ZIP_TIMEOUT_MS,phase:'zip',expect:'blob'});
    const disposition=response.headers.get('content-disposition')||'';
    const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename=encoded?decodeURIComponent(encoded):safeFileName(`${teamName||'foto-squadra'}-originali.zip`);
    const objectUrl=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),2000);
  }
  async function downloadAllAsZip(state,teamId,teamName){
    let photos=listTeamPhotos(state,teamId);
    if(!photos.length)photos=await fetchTeamPhotos(teamId,{force:true,teamOnly:true});
    return downloadSelectedAsZip(photos,teamId,teamName);
  }
  function compressImage(file){return Promise.resolve(file);}

  window.NexoraPhotos={
    version:'v126.16-photo-network',
    config:{...cfg,MAX_FILE_SIZE,MAX_BATCH_FILES,MAX_BATCH_SIZE,ALLOWED_TYPES:[...ALLOWED_TYPES]},
    PhotoError,
    status,
    userMessage,
    invalidateCache,
    refreshAll,
    fetchTeamPhotos,
    getTeamPhotoMap,
    listTeamPhotos,
    validateImageFile,
    validateBatch,
    uploadTeamPhoto,
    updatePhotoMetadata,
    replaceTeamPhoto,
    deleteTeamPhoto,
    publicUrl,
    originalDownloadUrl,
    downloadOriginal,
    compressImage,
    downloadSelectedAsZip,
    downloadAllAsZip
  };
})();
