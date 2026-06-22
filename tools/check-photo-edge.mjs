import process from 'node:process';

const projectUrl=(process.env.SUPABASE_URL||'https://mcksxqtgibkazxnkdfra.supabase.co').replace(/\/$/,'');
const publishableKey=process.env.SUPABASE_ANON_KEY||'sb_publishable_AAtoXhi2a99AyHGvDLM-CA_luXl_-PK';
const origin=process.env.PHOTO_TEST_ORIGIN||'http://localhost:4173';
const endpoint=`${projectUrl}/functions/v1/team-photos?action=health`;
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),15000);

try{
  const response=await fetch(endpoint,{headers:{apikey:publishableKey,Origin:origin},signal:controller.signal});
  const text=await response.text();
  let body=null;try{body=text?JSON.parse(text):null;}catch{body={raw:text.slice(0,500)};}
  console.log(JSON.stringify({endpoint,origin,status:response.status,headers:{allowOrigin:response.headers.get('access-control-allow-origin'),contentType:response.headers.get('content-type')},body},null,2));
  if(response.status===404)throw new Error('La Edge Function team-photos non risulta distribuita in questo progetto.');
  if(!response.ok)throw new Error(body?.message||`Health check HTTP ${response.status}`);
  if(body?.originAllowed===false)throw new Error('PHOTO_ALLOWED_ORIGINS non contiene il dominio testato.');
  if(body?.cloudinary?.configured===false)throw new Error('Cloudinary non è configurato nei Secrets della Edge Function.');
  if(body?.supabase?.configured===false)throw new Error('Secrets Supabase server-side incompleti.');
  console.log('OK: Edge Function Foto raggiungibile e configurazione dichiarata completa.');
}catch(error){
  const causeCode=error?.cause?.code||'';
  const causeMessage=error?.cause?.message||'';
  let reason=error?.message||String(error);
  if(error?.name==='AbortError')reason='timeout della richiesta alla Edge Function';
  else if(causeCode==='ENOTFOUND'||causeCode==='EAI_AGAIN')reason=`DNS non risolto per ${new URL(projectUrl).hostname}`;
  else if(causeCode==='ECONNREFUSED')reason='connessione rifiutata dal server Supabase';
  else if(causeCode==='CERT_HAS_EXPIRED'||causeCode==='UNABLE_TO_VERIFY_LEAF_SIGNATURE')reason='certificato TLS non valido';
  else if(causeMessage)reason=`${reason} (${causeCode||causeMessage})`;
  console.error(`ERRORE: ${reason}`);
  process.exitCode=1;
}finally{clearTimeout(timer);}
