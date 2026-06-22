import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=fs.readFileSync(path.join(root,'assets/js/photos.js'),'utf8');

function createRuntime({fetchImpl,token='user-session-token'}={}){
  const events=[];
  const decodeImage=async()=>({width:1200,height:800,close(){}});
  const context={
    console,
    performance,
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    FormData,
    Blob,
    File,
    Response,
    Headers,
    Request,
    CustomEvent,
    setTimeout,
    clearTimeout,
    fetch:fetchImpl,
    createImageBitmap:decodeImage,
    Image:class {},
    document:{
      body:{appendChild(){}},
      createElement(){return {style:{},click(){},remove(){},set href(_){},set download(_){},set rel(_){}};}
    },
    window:{
      NEW_GENERATION_CLOUDINARY:{CLOUD_NAME:'demo',FOLDER:'squadra',SECTION:'foto-squadra',EDGE_FUNCTION:'team-photos'},
      NEW_GENERATION_SUPABASE:{URL:'https://project.supabase.co',ANON_KEY:'sb_publishable_test'},
      NG_SUPABASE_CLIENT:{auth:{getSession:async()=>({data:{session:token?{access_token:token}:null},error:null})}},
      location:{protocol:'https:'},
      dispatchEvent:event=>events.push(event),
      addEventListener(){},
      createImageBitmap:decodeImage,
    }
  };
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'assets/js/photos.js'});
  return {Photos:context.window.NexoraPhotos,events,context};
}

function jpegFile(name='foto prova.jpg'){
  return new File([new Uint8Array([0xff,0xd8,0xff,0xe0,0,1,2,3,4,5])],name,{type:'image/jpeg',lastModified:1});
}

function pngFile(name='foto verticale.png'){
  return new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,1,2,3])],name,{type:'image/png',lastModified:2});
}
function webpFile(name='foto panoramica.webp'){
  return new File([new Uint8Array([0x52,0x49,0x46,0x46,4,0,0,0,0x57,0x45,0x42,0x50,1,2,3,4])],name,{type:'image/webp',lastModified:3});
}

const results=[];
async function test(name,fn){
  try{await fn();results.push({name,result:'PASS'});console.log(`[photos] PASS · ${name}`);}
  catch(error){results.push({name,result:'FAIL',details:error.stack||String(error)});console.error(`[photos] FAIL · ${name}\n${error.stack||error}`);process.exitCode=1;}
}

await test('GET pubblico usa apikey gateway senza Authorization utente',async()=>{
  let request;
  const {Photos}=createRuntime({fetchImpl:async(url,opts)=>{request={url,opts};return new Response(JSON.stringify({ok:true,photos:[]}),{status:200,headers:{'content-type':'application/json'}});}});
  await Photos.refreshAll({force:true});
  assert.equal(request.opts.method,'GET');
  assert.equal(request.opts.headers.Authorization,undefined);
  assert.equal(request.opts.headers.apikey,'sb_publishable_test');
  assert.equal(request.opts.headers['Content-Type'],undefined);
});

await test('upload multipart usa access token sessione e boundary del browser',async()=>{
  let request;
  const {Photos}=createRuntime({fetchImpl:async(url,opts)=>{
    request={url,opts};
    return new Response(JSON.stringify({ok:true,photo:{publicId:'squadra/team-a/id',teamId:'team-a',name:'foto prova.jpg',originalUrl:'https://res.cloudinary.com/demo/image/upload/id.jpg',thumbUrl:'https://res.cloudinary.com/demo/image/upload/c_fill/id.jpg',width:1200,height:800,size:10,format:'jpg'}}),{status:201,headers:{'content-type':'application/json'}});
  }});
  const photo=await Photos.uploadTeamPhoto('team-a',jpegFile());
  assert.equal(request.opts.method,'POST');
  assert.equal(request.opts.headers.Authorization,'Bearer user-session-token');
  assert.equal(request.opts.headers.apikey,'sb_publishable_test');
  assert.equal(request.opts.headers['Content-Type'],undefined);
  assert.ok(request.opts.body instanceof FormData);
  assert.ok(request.opts.body.get('file') instanceof File);
  assert.equal(request.opts.body.get('teamId'),'team-a');
  assert.equal(photo.publicId,'squadra/team-a/id');
});

await test('chiave pubblicabile non viene usata al posto della sessione',async()=>{
  let calls=0;
  const {Photos}=createRuntime({token:'',fetchImpl:async()=>{calls++;throw new Error('non deve essere chiamato');}});
  await assert.rejects(()=>Photos.uploadTeamPhoto('team-a',jpegFile()),error=>error?.code==='AUTH_REQUIRED');
  assert.equal(calls,0);
});

await test('errore di rete/CORS classificato senza Failed to fetch grezzo',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>{throw new TypeError('Failed to fetch');}});
  await assert.rejects(()=>Photos.refreshAll({force:true}),error=>{
    assert.equal(error.code,'NETWORK_ERROR');
    assert.match(Photos.userMessage(error),/Edge Function Foto non raggiungibile/);
    return true;
  });
});

await test('health check distingue configurazione backend senza esporre segreti',async()=>{
  let request;
  const {Photos}=createRuntime({fetchImpl:async(url,opts)=>{
    request={url,opts};
    return new Response(JSON.stringify({ok:true,service:'team-photos',originAllowed:true,cloudinary:{configured:true,cloudName:'demo',source:'CLOUDINARY_URL'},supabase:{configured:true}}),{status:200,headers:{'content-type':'application/json'}});
  }});
  const health=await Photos.healthCheck();
  assert.match(request.url,/action=health/);
  assert.equal(request.opts.headers.apikey,'sb_publishable_test');
  assert.equal(health.cloudinary.cloudName,'demo');
  assert.equal(JSON.stringify(health).includes('apiSecret'),false);
});

await test('validazione rifiuta formato e firma binaria incoerenti',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  const fake=new File([new TextEncoder().encode('not an image')],'finta.jpg',{type:'image/jpeg'});
  await assert.rejects(()=>Photos.validateImageFile(fake),error=>error?.code==='CORRUPT_FILE');
  const gif=new File([new TextEncoder().encode('GIF89a')],'animata.gif',{type:'image/gif'});
  await assert.rejects(()=>Photos.validateImageFile(gif),error=>error?.code==='UNSUPPORTED_TYPE');
});

await test('JPEG, PNG e WebP validi superano firma e decodifica',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  for(const file of [jpegFile(),pngFile(),webpFile()]){
    const meta=await Photos.validateImageFile(file);
    assert.equal(meta.width,1200);
    assert.equal(meta.height,800);
  }
});

await test('limiti per file e batch vengono applicati prima della rete',async()=>{
  let calls=0;
  const {Photos}=createRuntime({fetchImpl:async()=>{calls++;return new Response('{}',{status:200});}});
  const tooLarge=new File([new Uint8Array(10*1024*1024+1)],'grande.jpg',{type:'image/jpeg'});
  await assert.rejects(()=>Photos.validateImageFile(tooLarge),error=>error?.code==='FILE_TOO_LARGE');
  await assert.rejects(()=>Photos.validateBatch(Array.from({length:21},(_,i)=>jpegFile(`foto-${i}.jpg`))),error=>error?.code==='BATCH_TOO_LARGE');
  assert.equal(calls,0);
});

await test('interruzione upload produce errore recuperabile distinto',async()=>{
  const controller=new AbortController();
  const {Photos}=createRuntime({fetchImpl:async(_url,opts)=>new Promise((_resolve,reject)=>{
    const fail=()=>reject(new DOMException('Aborted','AbortError'));
    if(opts.signal.aborted){fail();return;}
    opts.signal.addEventListener('abort',fail,{once:true});
  })});
  const promise=Photos.uploadTeamPhoto('team-a',jpegFile(),{signal:controller.signal});
  controller.abort();
  await assert.rejects(()=>promise,error=>error?.code==='REQUEST_ABORTED');
});

await test('download singolo e ZIP passano dalla Edge Function Foto',async()=>{
  const {Photos}=createRuntime({fetchImpl:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  const url=Photos.originalDownloadUrl({publicId:'squadra/team-a/id'});
  assert.match(url,/functions\/v1\/team-photos\?action=download/);
  assert.match(url,/photoId=squadra%2Fteam-a%2Fid/);
  assert.match(source,/action:'zip'/);
  assert.doesNotMatch(source,/fetch\(photo\.originalUrl/);
});

await test('backend Foto separato da endpoint e modelli Articoli',async()=>{
  const edge=fs.readFileSync(path.join(root,'supabase/functions/team-photos/index.ts'),'utf8');
  const config=fs.readFileSync(path.join(root,'supabase/functions/team-photos/config.toml'),'utf8');
  const sql=fs.readFileSync(path.join(root,'SUPABASE_SETUP.sql'),'utf8');
  assert.match(edge,/team_photos/);
  assert.match(edge,/rootFolder.*squadra/);
  assert.match(edge,/action === 'zip'/);
  assert.match(edge,/MAX_ZIP_BYTES = 150/);
  assert.match(edge,/req\.method === 'OPTIONS'/);
  assert.match(edge,/ORIGIN_NOT_ALLOWED/);
  assert.match(edge,/CLOUDINARY_URL/);
  assert.match(edge,/action === 'health'/);
  assert.match(edge,/MAX_IMAGE_PIXELS/);
  assert.doesNotMatch(edge,/from\(['"]articles|\/articles\?|article_images/);
  assert.match(config,/verify_jwt\s*=\s*false/);
  assert.match(sql,/create table if not exists public\.team_photos/);
  assert.match(sql,/team_photos_gallery_scope/);
});

await test('UI upload dichiara limiti e soli JPEG/PNG/WebP',async()=>{
  const html=fs.readFileSync(path.join(root,'admin-photos.html'),'utf8');
  assert.match(html,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(html,/image\/gif/);
  assert.match(html,/max 20 file \/ 80 MB/);
});

console.log(JSON.stringify({root,tests:results.length,results},null,2));
if(process.exitCode)process.exit(process.exitCode);
