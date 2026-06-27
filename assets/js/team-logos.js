// New Generation — loghi squadra esterni (Cloudinary via Supabase Edge Function)
// Evita di salvare immagini Base64 dentro app_state.data, riducendo drasticamente
// il PostgREST egress. Compatibile con i vecchi backup: i data URL vengono migrati.
(function(){
  'use strict';

  const supabaseCfg=window.NEW_GENERATION_SUPABASE||{};
  const cloudCfg=window.NEW_GENERATION_CLOUDINARY||{};
  const EDGE_FUNCTION=cloudCfg.EDGE_FUNCTION||'team-photos';
  const MAX_SOURCE_BYTES=10*1024*1024;
  const MAX_DIMENSION=512;
  const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp']);
  let healthPromise=null;

  class LogoError extends Error{
    constructor(message,{code='LOGO_ERROR',status=0,details=null,cause=null}={}){
      super(message);this.name='LogoError';this.code=code;this.status=Number(status)||0;this.details=details;if(cause)this.cause=cause;
    }
  }

  function endpoint(action='logo'){
    const base=String(supabaseCfg.URL||'').replace(/\/$/,'')+'/functions/v1/'+encodeURIComponent(EDGE_FUNCTION);
    return base+(base.includes('?')?'&':'?')+'action='+encodeURIComponent(action);
  }
  function isDataUrl(value){return typeof value==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(value);}
  function slug(value){return String(value||'logo').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'logo';}
  function legacyTeams(state){return (state?.teams||[]).filter(team=>isDataUrl(team?.logo));}
  function estimateLegacyBytes(state){return legacyTeams(state).reduce((sum,team)=>sum+String(team.logo||'').length,0);}

  async function sessionToken(){
    const client=window.NG_SUPABASE_CLIENT;
    if(!client?.auth?.getSession)throw new LogoError('Servizio Supabase non ancora pronto.',{code:'AUTH_SERVICE_MISSING'});
    const {data,error}=await client.auth.getSession();
    if(error)throw new LogoError(error.message||'Impossibile leggere la sessione admin.',{code:'AUTH_SESSION_ERROR',cause:error});
    const token=data?.session?.access_token||'';
    if(!token)throw new LogoError('Sessione amministratore assente o scaduta.',{code:'AUTH_REQUIRED',status:401});
    return token;
  }

  async function parseJson(response){
    const text=await response.text();
    if(!text)return {};
    try{return JSON.parse(text);}catch(_){return {message:text.slice(0,500)};}
  }

  async function healthCheck({force=false}={}){
    if(!force&&healthPromise)return healthPromise;
    healthPromise=(async()=>{
      if(!supabaseCfg.URL)throw new LogoError('URL Supabase non configurato.',{code:'CONFIG_MISSING'});
      const headers={};if(supabaseCfg.ANON_KEY)headers.apikey=String(supabaseCfg.ANON_KEY);
      let response;
      try{response=await fetch(endpoint('health'),{headers,cache:'no-store'});}catch(error){throw new LogoError('Edge Function non raggiungibile.',{code:'NETWORK_ERROR',cause:error});}
      const data=await parseJson(response);
      if(!response.ok)throw new LogoError(data.message||`Errore HTTP ${response.status}.`,{code:data.code||'HEALTH_FAILED',status:response.status,details:data});
      if(!Array.isArray(data.capabilities)||!data.capabilities.includes('team-logos')){
        throw new LogoError('La Edge Function team-photos deve essere aggiornata alla versione con supporto loghi.',{code:'LOGO_FUNCTION_UPDATE_REQUIRED',details:data});
      }
      if(data.ok===false)throw new LogoError('Cloudinary o Supabase non risultano configurati nella Edge Function.',{code:'FUNCTION_NOT_READY',details:data});
      return data;
    })().catch(error=>{healthPromise=null;throw error;});
    return healthPromise;
  }

  function loadImage(file){return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new LogoError('Il file non contiene un’immagine valida.',{code:'INVALID_IMAGE'}));};
    img.src=url;
  });}
  function canvasToBlob(canvas,type,quality){return new Promise(resolve=>canvas.toBlob(resolve,type,quality));}

  async function prepareLogoFile(file,baseName='logo'){
    if(!(file instanceof Blob)||!file.size)throw new LogoError('Seleziona un file immagine valido.',{code:'FILE_MISSING'});
    const type=String(file.type||'').toLowerCase();
    if(!ALLOWED_TYPES.has(type))throw new LogoError('Formato non supportato. Usa PNG, JPG o WebP.',{code:'UNSUPPORTED_TYPE',status:415});
    if(file.size>MAX_SOURCE_BYTES)throw new LogoError('Il file supera il limite di 10 MB.',{code:'FILE_TOO_LARGE',status:413});
    const img=await loadImage(file);
    const width=img.naturalWidth||img.width||0,height=img.naturalHeight||img.height||0;
    if(!width||!height)throw new LogoError('Dimensioni immagine non valide.',{code:'INVALID_DIMENSIONS'});
    const scale=Math.min(1,MAX_DIMENSION/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d',{alpha:true});ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let blob=await canvasToBlob(canvas,'image/webp',0.9);let ext='webp';
    if(!blob){blob=await canvasToBlob(canvas,'image/png');ext='png';}
    if(!blob)throw new LogoError('Impossibile ottimizzare il logo.',{code:'ENCODE_FAILED'});
    return new File([blob],`${slug(baseName)}.${ext}`,{type:blob.type||`image/${ext}`,lastModified:Date.now()});
  }

  async function dataUrlToFile(dataUrl,name='logo'){
    if(!isDataUrl(dataUrl))throw new LogoError('Il logo legacy non è un data URL valido.',{code:'INVALID_DATA_URL'});
    let response;try{response=await fetch(dataUrl);}catch(error){throw new LogoError('Impossibile decodificare il logo legacy.',{code:'DATA_URL_DECODE_FAILED',cause:error});}
    const blob=await response.blob();
    return prepareLogoFile(new File([blob],`${slug(name)}.png`,{type:blob.type||'image/png'}),name);
  }

  async function upload(teamId,teamName,file){
    if(!teamId)throw new LogoError('Identificativo squadra mancante.',{code:'TEAM_MISSING'});
    await healthCheck();
    const prepared=await prepareLogoFile(file,teamName||teamId);
    const token=await sessionToken();
    const form=new FormData();form.append('file',prepared,prepared.name);form.append('teamId',teamId);form.append('teamName',teamName||'');
    const headers={Authorization:'Bearer '+token};if(supabaseCfg.ANON_KEY)headers.apikey=String(supabaseCfg.ANON_KEY);
    let response;try{response=await fetch(endpoint('logo'),{method:'POST',headers,body:form,cache:'no-store'});}catch(error){throw new LogoError('Upload logo non raggiungibile.',{code:'NETWORK_ERROR',cause:error});}
    const data=await parseJson(response);
    if(!response.ok||!data.logo?.url)throw new LogoError(data.message||'Il backend non ha confermato il caricamento del logo.',{code:data.code||'UPLOAD_FAILED',status:response.status,details:data});
    return data.logo;
  }

  async function uploadPrepared(teamId,teamName,prepared){
    await healthCheck();
    const token=await sessionToken();
    const form=new FormData();form.append('file',prepared,prepared.name);form.append('teamId',teamId);form.append('teamName',teamName||'');
    const headers={Authorization:'Bearer '+token};if(supabaseCfg.ANON_KEY)headers.apikey=String(supabaseCfg.ANON_KEY);
    const response=await fetch(endpoint('logo'),{method:'POST',headers,body:form,cache:'no-store'});
    const data=await parseJson(response);
    if(!response.ok||!data.logo?.url)throw new LogoError(data.message||'Upload logo non riuscito.',{code:data.code||'UPLOAD_FAILED',status:response.status,details:data});
    return data.logo;
  }

  async function remove(publicId){
    if(!publicId)return false;
    await healthCheck();const token=await sessionToken();
    const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};if(supabaseCfg.ANON_KEY)headers.apikey=String(supabaseCfg.ANON_KEY);
    const response=await fetch(endpoint('logo'),{method:'DELETE',headers,body:JSON.stringify({publicId}),cache:'no-store'});
    const data=await parseJson(response);if(!response.ok)throw new LogoError(data.message||'Eliminazione logo non riuscita.',{code:data.code||'DELETE_FAILED',status:response.status,details:data});
    return true;
  }

  async function migrateState(state,{onProgress}={}){
    const clone=JSON.parse(JSON.stringify(state||{}));
    const candidates=legacyTeams(clone);const failed=[];let migrated=0;
    if(!candidates.length)return {state:clone,migrated,failed,total:0};
    await healthCheck();
    for(let index=0;index<candidates.length;index++){
      const team=candidates[index];
      try{
        onProgress?.({index,total:candidates.length,team,status:'preparing'});
        const file=await dataUrlToFile(team.logo,team.name||team.id);
        onProgress?.({index,total:candidates.length,team,status:'uploading'});
        const logo=await uploadPrepared(team.id,team.name,file);
        team.logo=logo.url;team.logoPublicId=logo.publicId;team.logoVersion=logo.version||0;team.logoMigratedAt=new Date().toISOString();migrated++;
        onProgress?.({index:index+1,total:candidates.length,team,status:'done'});
      }catch(error){failed.push({teamId:team.id,teamName:team.name||'',message:error?.message||String(error),code:error?.code||'MIGRATION_FAILED'});onProgress?.({index:index+1,total:candidates.length,team,status:'failed',error});}
    }
    return {state:clone,migrated,failed,total:candidates.length};
  }

  function userMessage(error){
    if(!error)return 'Errore sconosciuto.';
    if(error.code==='LOGO_FUNCTION_UPDATE_REQUIRED')return 'Devi prima ridistribuire la Edge Function team-photos inclusa nel progetto aggiornato.';
    if(error.code==='AUTH_REQUIRED')return 'Sessione admin scaduta: effettua nuovamente l’accesso.';
    return error.message||String(error);
  }

  window.NexoraTeamLogos={version:'v133-egress-logo',LogoError,isDataUrl,legacyTeams,estimateLegacyBytes,healthCheck,prepareLogoFile,dataUrlToFile,upload,remove,migrateState,userMessage};
})();
