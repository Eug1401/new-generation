/* Ricerca esatta del calendario fuori dal thread principale. */
self.window=self;
self.globalThis=self;
self.localStorage={getItem(){return null;},setItem(){},removeItem(){},key(){return null;},get length(){return 0;}};
self.sessionStorage=self.localStorage;
self.document={};
self.navigator=self.navigator||{onLine:true};
self.location=self.location||{pathname:'/admin-rules.html'};
self.CustomEvent=self.CustomEvent||class CustomEvent{};
self.dispatchEvent=self.dispatchEvent||(()=>true);
importScripts('store.js');

self.onmessage=event=>{
  const {requestId,state}=event.data||{};
  if(!requestId||!state)return;
  try{
    const result=self.NexoraStore.previewCalendar(state,{
      onProgress:progress=>self.postMessage({type:'progress',requestId,progress})
    });
    self.postMessage({type:'result',requestId,result});
  }catch(error){
    self.postMessage({type:'error',requestId,message:String(error?.message||error||'Errore sconosciuto')});
  }
};
