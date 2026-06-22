(function(){
  const cfg = window.NEW_GENERATION_SUPABASE || {};
  const isConfigured = Boolean(cfg.ENABLED && cfg.URL && cfg.ANON_KEY && !String(cfg.URL).includes('INSERISCI') && !String(cfg.ANON_KEY).includes('INSERISCI'));
  const store = window.NexoraStore;
  if (!store) return;

  const page = location.pathname.split('/').pop() || 'index.html';
  const isAdmin = page.startsWith('admin');
  const isPublic = page === 'index.html' || page === '';
  const table = cfg.TABLE || 'app_state';
  const rowId = cfg.ROW_ID || 'main';
  const SAVE_DEBOUNCE_MS = Math.max(50, Number(cfg.SAVE_DEBOUNCE_MS) || 100);
  const SAVE_RETRY_MIN_MS = Math.max(1200, Number(cfg.SAVE_RETRY_MIN_MS) || 1800);
  const SAVE_RETRY_MAX_MS = Math.max(SAVE_RETRY_MIN_MS, Number(cfg.SAVE_RETRY_MAX_MS) || 12000);
  const originalSave = store.save.bind(store);
  const DEBUG_REALTIME = Boolean(cfg.DEBUG_REALTIME);
  function debugRealtime(...args){ if(DEBUG_REALTIME) try{ console.log(...args); }catch(_){} }

  // Identificatore univoco di questa sessione browser, per evitare di applicare a noi stessi gli eventi realtime delle nostre stesse scritture.
  const CLIENT_ID_KEY = 'new-generation-client-id-v1';
  function ensureClientId(){
    try{
      let id = sessionStorage.getItem(CLIENT_ID_KEY);
      if(!id){
        id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(CLIENT_ID_KEY, id);
      }
      return id;
    }catch(_){ return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
  }
  const CLIENT_ID = ensureClientId();
  window.NG_CLIENT_ID = CLIENT_ID;

  let client = null;
  let remoteReady = false;
  let saveTimer = null;
  let saveInFlight = null;
  let pendingRemoteState = null;
  let pendingRemoteHash = '';
  let pendingResolvers = [];
  let lastRemoteState = null;
  let lastRemoteHash = '';
  let lastBannerAt = 0;
  let retryTimer = null;
  let retryCount = 0;
  let realtimeChannel = null;
  let realtimeState = 'off'; // 'off' | 'connecting' | 'on' | 'reconnecting'
  let pendingRemoteRevision = 0; // hoisted: usato da flushRemoteSave/scheduleRemoteSave
  let suppressNextAdminRemoteSave = false;
  // Stato init-public: tracciamo se siamo riusciti almeno una volta a leggere
  // i dati online. Serve per non sovrascrivere la cache locale con un null e
  // per sapere se l'errore visualizzato è "bootstrap" (mai connesso) o "deriva".
  let publicInitialFetchOk = false;
  let publicInitRetryTimer = null;
  let publicInitRetryAttempt = 0;
  const PUBLIC_INIT_MAX_RETRIES = 4;
  const PUBLIC_INIT_BASE_DELAY_MS = 1500;
  // Timeout per le chiamate di rete verso Supabase: evita che un fetch silente
  // resti appeso per sempre (es. captive portal, DNS lento, proxy aziendale).
  const REMOTE_FETCH_TIMEOUT_MS = Math.max(4000, Number(cfg.REMOTE_FETCH_TIMEOUT_MS) || 12000);
  const PENDING_SAVE_KEY = 'new-generation-pending-remote-save-v1';

  function readPersistedPending(){
    try{
      const raw = localStorage.getItem(PENDING_SAVE_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || !parsed.state || !parsed.hash) return null;
      parsed.state = store.normalizeState(parsed.state);
      return parsed;
    }catch(e){ return null; }
  }

  function persistPending(state, hash){
    if(!isAdmin) return;
    try{
      localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({
        state: store.normalizeState(state),
        hash: hash || stateHash(state),
        updatedAt: new Date().toISOString()
      }));
    }catch(e){
      console.warn('Impossibile salvare la coda remota locale', e);
    }
  }

  function clearPersistedPending(hash){
    if(!isAdmin) return;
    try{
      if(!hash){ localStorage.removeItem(PENDING_SAVE_KEY); return; }
      const pending = readPersistedPending();
      if(!pending || pending.hash === hash) localStorage.removeItem(PENDING_SAVE_KEY);
    }catch(e){}
  }

  function hasRemoteWork(){
    return Boolean(pendingRemoteState || saveInFlight || readPersistedPending());
  }

  function updateSaveStatus(status='idle', detail={}){
    window.NG_REMOTE_SAVE_STATUS = Object.assign({
      status,
      pending:Boolean(pendingRemoteState || saveInFlight || readPersistedPending()),
      inFlight:Boolean(saveInFlight),
      updatedAt:new Date().toISOString()
    }, detail || {});
    window.NG_REMOTE_SAVE_PENDING = window.NG_REMOTE_SAVE_STATUS.pending;
    window.dispatchEvent(new CustomEvent('ng:remote-save-status', { detail: window.NG_REMOTE_SAVE_STATUS }));
  }

  function banner(text, type='ok', {sticky=false}={}){
    let el = document.getElementById('ngSyncStatus');
    if(!el){
      el = document.createElement('div');
      el.id = 'ngSyncStatus';
      el.className = 'sync-status';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.dataset.type = type;
    clearTimeout(el._t);
    if(type === 'ok' && !sticky) el._t = setTimeout(()=>{ el.textContent=''; }, 2200);
  }

  function quietBanner(text, type='ok'){
    const now = Date.now();
    if(now - lastBannerAt < 900) return;
    lastBannerAt = now;
    banner(text, type);
  }

  function normalizeForRemote(state){
    let normalized = store.normalizeState(state);
    if(lastRemoteState && store.mergeMissingMedia){
      // Evita di perdere loghi/immagini se il browser ha salvato una copia compatta per quota locale.
      normalized = store.normalizeState(store.mergeMissingMedia(normalized, lastRemoteState));
    }
    return normalized;
  }

  function stateHash(state){
    try { return JSON.stringify(state); } catch(e) { return String(Date.now()) + Math.random(); }
  }

  function comparableState(value){
    if(!value || typeof value !== 'object') return value;
    const copy = JSON.parse(JSON.stringify(value));
    delete copy._remoteUpdatedAt;
    delete copy._simulationUpdatedAt;
    delete copy._localUpdatedAt;
    delete copy._localRevision;
    delete copy._clientId;
    delete copy._revision;
    delete copy._skipLocalTimestamp;
    return copy;
  }

  function same(a,b){
    try { return JSON.stringify(comparableState(a)) === JSON.stringify(comparableState(b)); } catch(e){ return false; }
  }

  function resolvePending(ok, value){
    const list = pendingResolvers.splice(0);
    list.forEach(({resolve,reject})=> ok ? resolve(value) : reject(value));
  }

  async function getSession(){
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  // Avvolge una promise con un timeout. Rigetta con un Error 'timeout' se
  // l'operazione non termina entro ms millisecondi. Nota: questo NON cancella
  // la richiesta sottostante (supabase-js v2 non espone un AbortController
  // diretto sul query builder), ma scollega la nostra logica dal fetch appeso.
  function withTimeout(promise, ms, label='operation'){
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Timeout (${ms}ms) su ${label}`);
        err.code = 'NG_TIMEOUT';
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Classifica un errore generato dalla rete o da supabase-js.
  // Restituisce { kind: 'network'|'auth'|'config'|'server'|'unknown', message }
  // per scegliere il messaggio utente corretto e decidere se ritentare.
  function classifyRemoteError(err){
    if(!err) return { kind: 'unknown', message: 'Errore sconosciuto' };
    const raw = err.message || String(err);
    const name = err.name || '';
    const code = err.code || (err.cause && err.cause.code) || '';
    // TypeError: Failed to fetch (Chrome), NetworkError (Firefox), Load failed (Safari).
    const isFetchTypeError = name === 'TypeError' && /fetch|network|load failed/i.test(raw);
    const isTimeout = code === 'NG_TIMEOUT' || /timeout/i.test(raw);
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if(isOffline) return { kind:'network', message:'Sei offline. Riprovo automaticamente alla riconnessione.' };
    if(isFetchTypeError || isTimeout){
      return { kind:'network', message:'Impossibile contattare il server (rete, ad-blocker o progetto Supabase non raggiungibile).' };
    }
    if(/jwt|api key|invalid key|unauthor/i.test(raw)) return { kind:'auth', message: raw };
    if(code === 'PGRST' || /pgrst|relation .* does not exist|schema/i.test(raw)) return { kind:'config', message: raw };
    if(err.status >= 500) return { kind:'server', message: raw };
    return { kind:'unknown', message: raw };
  }

  async function fetchRemote(){
    if(!client) throw new Error('Client Supabase non inizializzato');
    const query = client.from(table).select('data,updated_at').eq('id', rowId).maybeSingle();
    const { data, error } = await withTimeout(query, REMOTE_FETCH_TIMEOUT_MS, 'fetchRemote');
    if(error) throw error;
    if(!data) return null;
    const normalized = store.normalizeState(data.data);
    normalized._remoteUpdatedAt = data.updated_at || '';
    lastRemoteState = normalized;
    lastRemoteHash = stateHash(normalized);
    return normalized;
  }

  async function flushRemoteSave({manual=false}={}){
    clearTimeout(saveTimer);
    saveTimer = null;
    clearTimeout(retryTimer);
    retryTimer = null;

    if(saveInFlight) return saveInFlight;
    if(!pendingRemoteState){ updateSaveStatus('idle'); return false; }

    const stateToSave = pendingRemoteState;
    const hashToSave = pendingRemoteHash || stateHash(stateToSave);
    const revToSave = pendingRemoteRevision || Date.now();
    pendingRemoteState = null;
    pendingRemoteHash = '';
    pendingRemoteRevision = 0;

    if(hashToSave && hashToSave === lastRemoteHash){
      clearPersistedPending(hashToSave);
      retryCount = 0;
      resolvePending(true, false);
      updateSaveStatus('idle');
      return false;
    }

    updateSaveStatus('saving', {hash:hashToSave});
    saveInFlight = (async()=>{
      try{
        const session = await getSession();
        if(isAdmin && !session){
          pendingRemoteState = stateToSave;
          pendingRemoteHash = hashToSave;
          pendingRemoteRevision = revToSave;
          persistPending(stateToSave, hashToSave);
          banner('Accesso admin richiesto: modifiche tenute in coda.', 'warn', {sticky:true});
          updateSaveStatus('pending-auth', {hash:hashToSave});
          return false;
        }
        const payload = {
          id: rowId,
          // _clientId per echo check, _revision per anti-flicker (stessa revision del broadcast)
          data: Object.assign({}, stateToSave, { _clientId: CLIENT_ID, _revision: revToSave }),
          updated_at: new Date().toISOString()
        };
        const { error } = await client.from(table).upsert(payload, { onConflict: 'id' });
        if(error) throw error;
        lastRemoteState = payload.data;
        lastRemoteHash = hashToSave;
        retryCount = 0;
        clearPersistedPending(hashToSave);
        quietBanner('Salvato online.', 'ok');
        resolvePending(true, true);
        updateSaveStatus('saved', {hash:hashToSave});
        return true;
      }catch(err){
        console.error(err);
        // Re-queue robusta: se intanto non è arrivato uno stato più nuovo, rimettiamo in coda quello fallito.
        if(!pendingRemoteState){
          pendingRemoteState = stateToSave;
          pendingRemoteHash = hashToSave;
          persistPending(stateToSave, hashToSave);
        }
        retryCount = Math.min(retryCount + 1, 8);
        const delay = Math.min(SAVE_RETRY_MAX_MS, SAVE_RETRY_MIN_MS * Math.pow(1.65, retryCount - 1));
        clearTimeout(retryTimer);
        retryTimer = setTimeout(()=>{ flushRemoteSave().catch(()=>{}); }, delay);
        banner('Salvataggio in background ritentato automaticamente.', 'warn');
        updateSaveStatus('retrying', {hash:hashToSave, retryInMs:delay, error:err.message || String(err)});
        resolvePending(true, false);
        return false;
      }finally{
        saveInFlight = null;
        if(pendingRemoteState && !retryTimer){
          saveTimer = setTimeout(()=>{ flushRemoteSave().catch(()=>{}); }, 80);
        }
      }
    })();

    return saveInFlight;
  }

  function scheduleRemoteSave(state, {immediate=false, source='auto', revision=0}={}){
    if(!client) return Promise.resolve(false);
    const normalized = normalizeForRemote(state);
    const hash = stateHash(normalized);
    if(hash === lastRemoteHash && !pendingRemoteState){
      return Promise.resolve(false);
    }
    pendingRemoteState = normalized;
    pendingRemoteHash = hash;
    // Se è arrivata una revision esplicita, usa la più recente tra quella e l'attuale pending.
    if(typeof revision === 'number' && revision > pendingRemoteRevision) pendingRemoteRevision = revision;
    persistPending(normalized, hash);

    const promise = new Promise((resolve,reject)=>pendingResolvers.push({resolve,reject}));
    updateSaveStatus('queued', {hash, source});

    if(immediate){
      flushRemoteSave().catch(()=>{});
    }else{
      clearTimeout(saveTimer);
      clearTimeout(retryTimer);
      retryTimer = null;
      saveTimer = setTimeout(()=>{
        flushRemoteSave().catch(()=>{});
      }, SAVE_DEBOUNCE_MS);
      if(source !== 'silent') quietBanner('Salvataggio in background...', 'ok');
    }
    return promise;
  }

  // Decide se uno state contiene cambiamenti "critici" che devono essere propagati subito
  // (senza il debounce di 700ms). Esempi: presenza di partite live, presenza di goals/cards modifiche.
  function isCriticalState(state){
    if(!state || !state.matches) return false;
    return state.matches.some(m => m && m.status === 'live');
  }

  // Patch dello store: commit locale immediato, broadcast HOT-PATH istantaneo + sync remoto in parallelo.
  store.save = function(mode, state){
    const skipRemote = mode === 'admin' && suppressNextAdminRemoteSave;
    if(skipRemote) suppressNextAdminRemoteSave = false;
    const result = originalSave(mode, state);
    if(isConfigured && mode === 'admin'){
      // Assegna una revisione monotona unica per questo save: condivisa tra broadcast e DB upsert.
      // Sul ricevente, questo permette di scartare payload "vecchi" (poll partito prima del save).
      const rev = Date.now();
      // Marca lastLocalRevision: scarta automaticamente eventuali poll/eventi vecchi.
      markLocalRevision(rev);
      // 1. BROADCAST IMMEDIATO (HOT-PATH): ~50ms a tutti i client connessi.
      try{ broadcastState(result, rev); }catch(_){}
      // 2. SAVE SU DB IN PARALLELO, salvo quando lo stesso stato è già stato
      // confermato dal backend tramite NG_FORCE_REMOTE_SAVE.
      if(skipRemote){
        window.NG_LAST_REMOTE_SAVE = Promise.resolve(true);
      }else{
        const immediate = isCriticalState(result);
        window.NG_LAST_REMOTE_SAVE = scheduleRemoteSave(result, {source:'store', immediate, revision: rev}).catch(err=>{ console.warn('Sync remoto non completato', err); return false; });
      }
    }
    return result;
  };

  // Commit locale/broadcast senza una seconda richiesta remota. Va usato solo
  // dopo che NG_FORCE_REMOTE_SAVE ha già confermato esattamente lo stesso stato.
  window.NG_SAVE_LOCAL_AFTER_REMOTE = function(state){
    suppressNextAdminRemoteSave = true;
    try{return store.save('admin', state);}
    finally{suppressNextAdminRemoteSave = false;}
  };

  window.NG_FORCE_REMOTE_SAVE = async function(state){
    if(!isConfigured || !isAdmin || !client) return false;
    return await scheduleRemoteSave(state, {immediate:true, source:'force'});
  };

  window.NG_FLUSH_REMOTE_SAVE = async function(){
    if(!isConfigured || !isAdmin || !client) return false;
    return await flushRemoteSave();
  };


  // v126.14: verifica forte usata dalla simulazione prima di mostrare il successo.
  // Legge nuovamente la riga dal backend e confronta l'identificativo atomico
  // dell'operazione, senza esporre token o dettagli della sessione.
  window.NG_VERIFY_REMOTE_SIMULATION = async function(operationId){
    if(!isConfigured || !isAdmin || !client) return true;
    const remote = await fetchRemote();
    return Boolean(remote && remote._simulationOperationId === operationId);
  };


  // Verifica forte per le eliminazioni editoriali: il frontend considera
  // conclusa l'operazione soltanto quando il record remoto non contiene più l'ID.
  window.NG_VERIFY_REMOTE_ARTICLE_ABSENT = async function(articleId){
    if(!isConfigured || !isAdmin || !client) return true;
    const remote = await fetchRemote();
    const id = String(articleId || '');
    return Boolean(remote && !(remote.articles || []).some(article=>String(article?.id || '') === id));
  };

  function flushWithTimeout(ms=3500){
    return Promise.race([
      flushRemoteSave({manual:true}).catch(err=>{ console.warn('Flush remoto non completato', err); return false; }),
      new Promise(resolve=>setTimeout(()=>resolve(false), ms))
    ]);
  }

  function installNavigationSafeSave(){
    if(!isAdmin || window.__NG_NAV_SAFE_SAVE_INSTALLED) return;
    window.__NG_NAV_SAFE_SAVE_INSTALLED = true;

    document.addEventListener('click', async e=>{
      const a = e.target.closest && e.target.closest('a[href]');
      if(!a || e.defaultPrevented) return;
      if(a.target && a.target !== '_self') return;
      if(a.hasAttribute('download')) return;
      const href = a.getAttribute('href') || '';
      if(!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      let url;
      try{ url = new URL(href, location.href); }catch(_){ return; }
      if(url.origin !== location.origin) return;
      if(!hasRemoteWork()) return;
      // Navigation-safe non bloccante: lo stato è già salvato localmente/pending.
      // Lasciamo l'interfaccia cambiare subito e completiamo online in background;
      // la pagina successiva riprende il pending se il browser interrompe questa.
      banner('Salvataggio in background: puoi cambiare schermata.', 'ok');
      flushRemoteSave().catch(()=>{});
    }, true);

    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'hidden' && hasRemoteWork()) flushRemoteSave().catch(()=>{});
    });
    window.addEventListener('pagehide', ()=>{
      if(hasRemoteWork()) flushRemoteSave().catch(()=>{});
    });
    window.addEventListener('beforeunload', ()=>{
      if(hasRemoteWork()) flushRemoteSave().catch(()=>{});
    });
    window.addEventListener('pageshow', ()=>{
      const pending = readPersistedPending();
      if(pending && !saveInFlight){
        pendingRemoteState = pending.state;
        pendingRemoteHash = pending.hash;
        flushRemoteSave().catch(()=>{});
      }
    });
  }

  function installAdminAuthUI(){
    const actions = document.querySelector('.actions');
    if(actions && !document.getElementById('ngLogoutBtn')){
      // Bottone "Nome admin": consente di settare un nome custom mostrato negli altri client
      // quando questo admin sta modificando una partita (lock atomico).
      const nameBtn = document.createElement('button');
      nameBtn.className = 'btn';
      nameBtn.id = 'ngAdminNameBtn';
      nameBtn.type = 'button';
      nameBtn.hidden = true;
      nameBtn.title = 'Imposta nome admin (visibile agli altri admin)';
      const refreshNameBtnLabel = () => {
        const custom = localStorage.getItem('ng-admin-label');
        const email = window.NG_ADMIN_EMAIL_CACHE || '';
        const display = custom || (email ? email.split('@')[0] : 'Admin');
        nameBtn.textContent = '👤 ' + display;
      };
      refreshNameBtnLabel();
      nameBtn.addEventListener('click', () => {
        const current = localStorage.getItem('ng-admin-label') || (window.NG_ADMIN_EMAIL_CACHE||'').split('@')[0] || '';
        const next = prompt('Il tuo nome (visibile agli altri admin quando modifichi una partita):', current);
        if(next === null) return; // annullato
        const trimmed = String(next).trim().slice(0, 30);
        if(trimmed){ localStorage.setItem('ng-admin-label', trimmed); }
        else { localStorage.removeItem('ng-admin-label'); }
        refreshNameBtnLabel();
        banner('Nome admin aggiornato: ' + (trimmed||(window.NG_ADMIN_EMAIL_CACHE||'').split('@')[0]||'Admin'), 'ok');
      });
      actions.appendChild(nameBtn);
      // Espongo refresh callback per richiamarla quando NG_ADMIN_EMAIL_CACHE viene popolato
      window.NG_REFRESH_ADMIN_NAME_BTN = refreshNameBtnLabel;

      const b = document.createElement('button');
      b.className = 'btn';
      b.id = 'ngLogoutBtn';
      b.type = 'button';
      b.textContent = 'Logout';
      b.hidden = true;
      b.addEventListener('click', async()=>{ await flushRemoteSave().catch(()=>{}); await client.auth.signOut(); location.reload(); });
      actions.appendChild(b);
    }
  }

  function showLoginOverlay(){
    if(document.getElementById('ngLoginOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ngLoginOverlay';
    overlay.className = 'login-overlay';
    overlay.setAttribute('aria-hidden','false');
    overlay.innerHTML = `
      <form class="login-card" id="ngLoginForm" role="dialog" aria-modal="true" aria-labelledby="ngLoginTitle">
        <div class="brand mini-brand"><div class="logo"><span></span></div><div><h2 id="ngLoginTitle">Accesso Admin</h2><p class="muted">Accedi con l'utente creato in Supabase Authentication.</p></div></div>
        <label for="ngLoginEmail">Email admin</label>
        <input id="ngLoginEmail" name="email" type="email" inputmode="email" autocomplete="email" required placeholder="admin@email.it">
        <label for="ngLoginPassword">Password</label>
        <input id="ngLoginPassword" name="password" type="password" autocomplete="current-password" required placeholder="Password">
        <button class="btn primary" type="submit">Entra</button>
        <p class="muted small-text">Il pubblico può solo leggere. Solo gli utenti autenticati possono salvare modifiche online.</p>
        <div id="ngLoginMsg" role="status" aria-live="polite" aria-atomic="true"></div>
      </form>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>overlay.querySelector('#ngLoginEmail')?.focus());
    overlay.querySelector('form').addEventListener('submit', async e=>{
      e.preventDefault();
      const form=e.currentTarget;
      const submit=form.querySelector('button[type="submit"]');
      if(submit?.disabled)return;
      const fd = new FormData(form);
      const msg = overlay.querySelector('#ngLoginMsg');
      const busy=window.NGInteractive;
      if(submit){
        if(busy) busy.setButtonBusy(submit,true,'Accesso…');
        else{submit.disabled=true;submit.setAttribute('aria-busy','true');}
      }
      form.setAttribute('aria-busy','true');
      msg.innerHTML = '<div class="message">Accesso in corso...</div>';
      try{
        const { error } = await client.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
        if(error){
          msg.textContent='';
          const errorBox=document.createElement('div');errorBox.className='message error';errorBox.textContent=error.message||'Accesso non riuscito.';msg.appendChild(errorBox);
          if(submit){
            if(busy) busy.setButtonBusy(submit,false);
            else{submit.disabled=false;submit.removeAttribute('aria-busy');}
          }
          form.removeAttribute('aria-busy');
          overlay.querySelector('#ngLoginEmail')?.focus();
          return;
        }
        location.reload();
      }catch(err){
        msg.textContent='';
        const errorBox=document.createElement('div');errorBox.className='message error';errorBox.textContent=err?.message||'Servizio di accesso non disponibile.';msg.appendChild(errorBox);
        if(submit){
          if(busy) busy.setButtonBusy(submit,false);
          else{submit.disabled=false;submit.removeAttribute('aria-busy');}
        }
        form.removeAttribute('aria-busy');
      }
    });
  }

  function localIsNewerThanRemote(local, remote){
    const localTime = Date.parse(local?._localUpdatedAt || 0) || 0;
    const remoteTime = Date.parse(remote?._remoteUpdatedAt || 0) || 0;
    return Boolean(localTime && (!remote || localTime > remoteTime));
  }

  async function initAdmin(){
    installAdminAuthUI();
    const session = await getSession();
    const logout = document.getElementById('ngLogoutBtn');
    const nameBtn = document.getElementById('ngAdminNameBtn');
    if(logout) logout.hidden = !session;
    if(nameBtn) nameBtn.hidden = !session;
    if(!session){ showLoginOverlay(); banner('Effettua login admin per sincronizzare.', 'warn', {sticky:true}); return; }
    // Cache email admin per i lock atomici (visualizzata in "Questa partita è in modifica da X").
    try{ window.NG_ADMIN_EMAIL_CACHE = session.user?.email || ''; }catch(_){}
    // Refresh label del bottone Nome admin con email appena caricata
    try{ window.NG_REFRESH_ADMIN_NAME_BTN?.(); }catch(_){}

    try{
      installNavigationSafeSave();
      const local = store.load('admin');
      const persisted = readPersistedPending();

      if(persisted){
        // UI pronta subito: prima ripristina lo stato locale più recente, poi salva online in background.
        originalSave('admin', persisted.state);
        if(window.NexoraAdminRefresh) window.NexoraAdminRefresh(persisted.state);
        window.dispatchEvent(new CustomEvent('ng:admin-state-loaded',{detail:{state:persisted.state, source:'pending-restore'}}));
        pendingRemoteState = persisted.state;
        pendingRemoteHash = persisted.hash;
        remoteReady = true;
        banner('Modifiche riprese: salvataggio online in background.', 'ok');
        flushRemoteSave().catch(()=>{});
        return;
      }

      const remote = await fetchRemote();
      const localSimTime = Date.parse(local._simulationUpdatedAt || 0) || 0;
      const remoteTime = remote ? (Date.parse(remote._remoteUpdatedAt || 0) || 0) : 0;

      if(localSimTime && (!remote || localSimTime > remoteTime)){
        scheduleRemoteSave(local, {immediate:true, source:'simulation'}).catch(()=>{});
        remoteReady = true;
        banner('Simulazione locale ripubblicata in background.', 'ok');
        return;
      }
      if(localIsNewerThanRemote(local, remote)){
        // Regola fondamentale: una schermata admin appena aperta non deve mai essere riportata indietro
        // da un fetch remoto più vecchio quando esiste una modifica locale non ancora pubblicata.
        pendingRemoteState = local;
        pendingRemoteHash = stateHash(normalizeForRemote(local));
        persistPending(local, pendingRemoteHash);
        scheduleRemoteSave(local, {immediate:true, source:'local-newer'}).catch(()=>{});
        remoteReady = true;
        banner('Modifiche locali già pronte: pubblicazione online in background.', 'ok');
        return;
      }
      if(remote && !same(remote, local)){
        originalSave('admin', Object.assign({}, remote, {_skipLocalTimestamp:true}));
        if(window.NexoraAdminRefresh) window.NexoraAdminRefresh(remote);
        window.dispatchEvent(new CustomEvent('ng:admin-state-loaded',{detail:{state:remote, source:'remote'}}));
        // Non forziamo più reload distruttivi: le schermate admin leggono sempre lo stato locale più recente.
      }
      if(!remote){ scheduleRemoteSave(local, {immediate:true, source:'bootstrap'}).catch(()=>{}); }
      remoteReady = true;
      banner('Backend Supabase attivo. Salvataggi in background e navigation-safe.', 'ok');
      // Realtime: ricevi le modifiche di altri admin senza dover ricaricare la pagina.
      subscribeRealtime();
      setupConnectivityHandlers();
    }catch(err){
      console.error(err);
      const info = classifyRemoteError(err);
      banner('Errore caricamento Supabase: ' + info.message, 'error', {sticky:true});
      // Anche in caso di errore al boot, tentiamo di attivare realtime/polling
      // per recuperare automaticamente alla riconnessione.
      try{ subscribeRealtime(); }catch(_){ }
      try{ setupConnectivityHandlers(); }catch(_){ }
    }
  }

  // -----------------------------------------------------------------------
  // Anti-flicker: tracking della revisione locale dello state.
  // Ogni save admin incrementa lastLocalRevision. Quando arriva un update
  // remoto (broadcast/postgres_changes/poll/storage), verifichiamo che la sua
  // revision sia >= lastLocalRevision. Se è più vecchia, la scartiamo
  // (è un poll partito PRIMA del nostro save che torna ora con dati stale).
  // -----------------------------------------------------------------------
  let lastLocalRevision = 0;
  function markLocalRevision(rev){
    if(typeof rev === 'number' && rev > lastLocalRevision) lastLocalRevision = rev;
  }
  function isStateStale(incomingState){
    if(!incomingState) return true;
    const incomingRev = Number(incomingState._revision) || 0;
    if(incomingRev === 0) return false; // payload senza revisione: applichiamo (es. boot iniziale)
    return incomingRev < lastLocalRevision;
  }

  function publishPublicState(next, source='remote'){
    if(!next) return false;
    // Anti-flicker: scarta payload stale (più vecchi di quello che abbiamo localmente)
    if(isStateStale(next)){
      debugRealtime('[NG-Realtime] Skip stale state da', source, '(rev:', next._revision, '< local:', lastLocalRevision + ')')
      return false;
    }
    const local = store.load('public');
    const normalized = store.normalizeState(store.mergeMissingMedia ? store.mergeMissingMedia(next, local) : next);
    if(same(normalized, local)) return false;
    originalSave('public', normalized);
    markLocalRevision(Number(next._revision) || 0);
    window.dispatchEvent(new CustomEvent('ng:public-state-updated', { detail: { state: normalized, source } }));
    return true;
  }

  function publishAdminState(next, source='remote'){
    if(!next) return false;
    // Anti-flicker: scarta payload stale
    if(isStateStale(next)){
      debugRealtime('[NG-Realtime] Skip stale admin state da', source, '(rev:', next._revision, '< local:', lastLocalRevision + ')')
      return false;
    }
    // POLICY (v80): NON ignoriamo mai gli update remoti, anche se stiamo salvando localmente.
    const local = store.load('admin');
    const normalized = store.normalizeState(store.mergeMissingMedia ? store.mergeMissingMedia(next, local) : next);
    if(same(normalized, local)) return false;
    originalSave('admin', Object.assign({}, normalized, { _skipLocalTimestamp: true }));
    markLocalRevision(Number(next._revision) || 0);
    if(window.NexoraAdminRefresh) window.NexoraAdminRefresh(normalized);
    window.dispatchEvent(new CustomEvent('ng:admin-state-loaded', { detail: { state: normalized, source } }));
    return true;
  }

  async function refreshPublicData(source='manual'){
    try{
      const remote = await fetchRemote();
      const changed = publishPublicState(remote, source);
      if(!publicInitialFetchOk){
        publicInitialFetchOk = true;
        publicInitRetryAttempt = 0;
        clearTimeout(publicInitRetryTimer);
        publicInitRetryTimer = null;
      }
      clearPublicErrorBanner();
      banner(changed ? 'Dati aggiornati senza ricaricare la pagina.' : 'Dati già aggiornati.', 'ok');
      return changed;
    }catch(err){
      console.warn('[NG-Sync] refreshPublicData failed:', err);
      // Non mostriamo un banner aggressivo: il polling/realtime riproverà.
      // Mostriamo errore solo se non abbiamo MAI letto i dati online finora.
      if(!publicInitialFetchOk) publicErrorBanner(err);
      return false;
    }
  }

  async function refreshAdminData(source='manual'){
    try{
      const remote = await fetchRemote();
      const changed = publishAdminState(remote, source);
      if(source!=='silent') banner(changed ? 'Stato admin aggiornato dal backend.' : 'Stato admin già aggiornato.', 'ok');
      return changed;
    }catch(err){
      console.warn('[NG-Sync] refreshAdminData failed:', err);
      if(source!=='silent'){
        const info = classifyRemoteError(err);
        banner('Lettura dati admin fallita: ' + info.message, 'warn');
      }
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Realtime: subscribe condivisa per admin e public
  // -----------------------------------------------------------------------
  function ensureRealtimeIndicator(){
    if(document.getElementById('ngRealtimeIndicator')) return;
    const el = document.createElement('div');
    el.id = 'ngRealtimeIndicator';
    el.className = 'ng-realtime-indicator';
    el.setAttribute('data-state', 'connecting');
    el.innerHTML = '<span class="ng-rt-dot"></span><span class="ng-rt-label">Connessione...</span>';
    document.body.appendChild(el);
  }
  function setRealtimeState(next, label){
    realtimeState = next;
    const el = document.getElementById('ngRealtimeIndicator');
    if(!el) return;
    el.setAttribute('data-state', next === 'on' ? 'on' : (next === 'reconnecting' ? 'reconnecting' : 'off'));
    const lbl = el.querySelector('.ng-rt-label');
    if(lbl) lbl.textContent = label || (next === 'on' ? 'Live' : (next === 'reconnecting' ? 'Riconnessione' : 'Offline'));
  }

  // Canali separati:
  // - realtimeChannel: postgres_changes (persistence-backed, latenza 500-2000ms)
  // - broadcastChannel: broadcast diretto WebSocket client-to-client (latenza 30-100ms)
  // Il broadcast è la via veloce. Postgres_changes è la rete di sicurezza.
  let broadcastChannel = null;
  const BROADCAST_CHANNEL_NAME = 'ng-app-state-broadcast';
  const BROADCAST_EVENT_STATE = 'state-update';
  const BROADCAST_EVENT_LOCK = 'match-lock';      // payload: {matchId, clientId, adminLabel, action: 'acquire'|'release'|'heartbeat', ts}
  const BROADCAST_EVENT_LOCK_QUERY = 'match-lock-query'; // payload: {matchId, clientId} → chi risponde se ha il lock

  // Lock atomici per modifica partita: matchId → {clientId, adminLabel, expiresAt}
  // Tracciamo sia i lock altrui (per blocchi) sia i nostri (per heartbeat).
  const remoteMatchLocks = new Map();   // matchId → {clientId, adminLabel, expiresAt}
  const myActiveLocks = new Map();      // matchId → {adminLabel, acquiredAt, heartbeatTimer}
  const LOCK_TTL_MS = 15000;            // 15s di TTL: se non si rinnova, il lock decade
  const LOCK_HEARTBEAT_MS = 5000;       // ogni 5s rinnoviamo i nostri lock

  function subscribeRealtime(){
    ensureRealtimeIndicator();
    if(realtimeChannel){
      try{ client.removeChannel(realtimeChannel); }catch(_){}
      realtimeChannel = null;
    }
    if(broadcastChannel){
      try{ client.removeChannel(broadcastChannel); }catch(_){}
      broadcastChannel = null;
    }
    setRealtimeState('connecting', 'Connessione...');

    // CHANNEL 1: postgres_changes (persistence + cold-path)
    const channelName = isAdmin ? 'app_state_admin' : 'app_state_public';
    realtimeChannel = client.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `id=eq.${rowId}` }, payload => {
        const raw = payload.new && payload.new.data;
        if(!raw) return;
        if(raw._clientId && raw._clientId === CLIENT_ID) return;
        debugRealtime('[NG-Realtime] postgres_changes da', raw._clientId || 'unknown')
        const next = store.normalizeState(raw);
        if(isPublic){
          if(publishPublicState(next, 'realtime')){
            quietBanner('Dati aggiornati in tempo reale.', 'ok');
          }
        } else if(isAdmin){
          if(publishAdminState(next, 'realtime')){
            quietBanner('Modifiche live da un altro admin.', 'ok');
          }
        }
      })
      .subscribe((status, err) => {
        if(status === 'SUBSCRIBED'){
          setRealtimeState('on', 'Live');
          if(isPublic) refreshPublicData('reconnect').catch(()=>{});
          else if(isAdmin) refreshAdminData('silent').catch(()=>{});
        } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
          setRealtimeState('reconnecting', 'Riconnessione...');
          console.warn('Realtime channel issue:', status, err);
        } else if(status === 'CLOSED'){
          setRealtimeState('off', 'Offline');
        }
      });

    // CHANNEL 2: broadcast (HOT-PATH istantaneo, ~50ms)
    // Tutti i client (admin e public) si iscrivono allo stesso canale broadcast.
    // Quando un admin pubblica un cambio, TUTTI i client lo ricevono via WebSocket
    // diretto senza passare dal database (zero latenza DB).
    // Si configura con config.broadcast.self=false così l'admin che invia non riceve l'echo.
    broadcastChannel = client.channel(BROADCAST_CHANNEL_NAME, {
      config: { broadcast: { self: false, ack: false } }
    })
      .on('broadcast', { event: BROADCAST_EVENT_STATE }, ({ payload }) => {
        if(!payload || !payload.data) return;
        // Echo check (extra safety)
        if(payload.clientId && payload.clientId === CLIENT_ID) return;
        debugRealtime('[NG-Realtime] broadcast HOT-PATH da', payload.clientId || 'unknown')
        const next = store.normalizeState(payload.data);
        if(isPublic){
          publishPublicState(next, 'broadcast');
        } else if(isAdmin){
          publishAdminState(next, 'broadcast');
        }
      })
      .on('broadcast', { event: BROADCAST_EVENT_LOCK }, ({ payload }) => {
        if(!payload || !payload.matchId || !payload.clientId) return;
        if(payload.clientId === CLIENT_ID) return; // echo
        handleRemoteLockEvent(payload);
      })
      .on('broadcast', { event: BROADCAST_EVENT_LOCK_QUERY }, ({ payload }) => {
        // Un altro client chiede chi tiene il lock di matchId. Rispondiamo se è nostro.
        if(!payload || !payload.matchId || !payload.clientId) return;
        if(payload.clientId === CLIENT_ID) return;
        const mine = myActiveLocks.get(payload.matchId);
        if(mine){
          broadcastLockEvent('acquire', payload.matchId, mine.adminLabel);
        }
      })
      .subscribe();
  }

  // Pubblica via broadcast: ad altissima velocità (~50ms WebSocket-to-WebSocket).
  // È fire-and-forget: se fallisce, il postgres_changes / polling-fallback recupera.
  function broadcastState(state, rev){
    if(!broadcastChannel) return Promise.resolve(false);
    try{
      const lightState = store.withoutHeavyMedia ? store.withoutHeavyMedia(state) : state;
      // Inietto _revision e _clientId nel state del broadcast (uguale al pattern del DB save)
      const revToUse = (typeof rev === 'number' && rev > 0) ? rev : Date.now();
      const stateWithMeta = Object.assign({}, lightState, { _clientId: CLIENT_ID, _revision: revToUse });
      return broadcastChannel.send({
        type: 'broadcast',
        event: BROADCAST_EVENT_STATE,
        payload: { data: stateWithMeta, clientId: CLIENT_ID, revision: revToUse, ts: Date.now() }
      });
    }catch(err){
      console.warn('[NG-Realtime] broadcast failed:', err);
      return Promise.resolve(false);
    }
  }

  // -----------------------------------------------------------------------
  // Lock atomici per modifica partita.
  // - acquireMatchLock(matchId, adminLabel) → {ok, lockedBy?}
  // - releaseMatchLock(matchId)
  // - getMatchLockInfo(matchId) → {clientId, adminLabel, expiresAt} | null
  // I lock vengono propagati via broadcast (~50ms). Heartbeat ogni 5s, TTL 15s.
  // -----------------------------------------------------------------------
  function broadcastLockEvent(action, matchId, adminLabel){
    if(!broadcastChannel) return Promise.resolve(false);
    try{
      return broadcastChannel.send({
        type: 'broadcast',
        event: BROADCAST_EVENT_LOCK,
        payload: { action, matchId, clientId: CLIENT_ID, adminLabel: adminLabel || 'Admin', ts: Date.now() }
      });
    }catch(_){ return Promise.resolve(false); }
  }

  function handleRemoteLockEvent(payload){
    const { matchId, clientId, adminLabel, action, ts } = payload;
    if(action === 'release'){
      const cur = remoteMatchLocks.get(matchId);
      if(cur && cur.clientId === clientId){
        remoteMatchLocks.delete(matchId);
        dispatchLockChange(matchId);
      }
      return;
    }
    remoteMatchLocks.set(matchId, {
      clientId,
      adminLabel: adminLabel || 'Admin',
      expiresAt: (ts || Date.now()) + LOCK_TTL_MS
    });
    dispatchLockChange(matchId);
  }

  function dispatchLockChange(matchId){
    try{ window.dispatchEvent(new CustomEvent('ng:match-lock-change', { detail: { matchId } })); }catch(_){}
  }

  setInterval(() => {
    const now = Date.now();
    remoteMatchLocks.forEach((info, matchId) => {
      if(info.expiresAt < now){
        remoteMatchLocks.delete(matchId);
        dispatchLockChange(matchId);
      }
    });
  }, 3000);

  function getMatchLockInfo(matchId){
    if(!matchId) return null;
    const info = remoteMatchLocks.get(matchId);
    if(!info) return null;
    if(info.expiresAt < Date.now()){ remoteMatchLocks.delete(matchId); return null; }
    return Object.assign({}, info);
  }

  function acquireMatchLock(matchId, adminLabel){
    if(!matchId) return { ok: false, reason: 'no-id' };
    if(myActiveLocks.has(matchId)){
      const mine = myActiveLocks.get(matchId);
      mine.adminLabel = adminLabel || mine.adminLabel;
      broadcastLockEvent('heartbeat', matchId, mine.adminLabel);
      return { ok: true };
    }
    const existing = getMatchLockInfo(matchId);
    if(existing && existing.clientId !== CLIENT_ID){
      return { ok: false, lockedBy: existing.adminLabel || 'Altro admin', clientId: existing.clientId };
    }
    const heartbeatTimer = setInterval(() => {
      if(!myActiveLocks.has(matchId)){ clearInterval(heartbeatTimer); return; }
      broadcastLockEvent('heartbeat', matchId, myActiveLocks.get(matchId).adminLabel);
    }, LOCK_HEARTBEAT_MS);
    myActiveLocks.set(matchId, { adminLabel: adminLabel || 'Admin', acquiredAt: Date.now(), heartbeatTimer });
    broadcastLockEvent('acquire', matchId, adminLabel || 'Admin');
    try{
      broadcastChannel?.send({
        type: 'broadcast',
        event: BROADCAST_EVENT_LOCK_QUERY,
        payload: { matchId, clientId: CLIENT_ID }
      });
    }catch(_){}
    return { ok: true };
  }

  function releaseMatchLock(matchId){
    if(!matchId) return;
    const mine = myActiveLocks.get(matchId);
    if(!mine) return;
    clearInterval(mine.heartbeatTimer);
    myActiveLocks.delete(matchId);
    broadcastLockEvent('release', matchId);
  }

  window.addEventListener('beforeunload', () => {
    myActiveLocks.forEach((_, matchId) => {
      try{ broadcastLockEvent('release', matchId); }catch(_){}
    });
  });

  window.NG_MATCH_LOCK = {
    acquire: acquireMatchLock,
    release: releaseMatchLock,
    info: getMatchLockInfo,
    hasMine: (matchId) => myActiveLocks.has(matchId)
  };

  // -----------------------------------------------------------------------
  // Polling-fallback robusto
  // Anche se Supabase Realtime non funziona (DB non configurato, mobile in
  // background, throttling browser, ecc.), un poll periodico riconcilia lo
  // state. La frequenza varia in base allo stato visivo della pagina e alla
  // presenza di partite live.
  // -----------------------------------------------------------------------
  let pollTimer = null;
  let lastPollAt = 0;
  // Frequenza polling: ottimizzata per garantire consistenza senza spammare.
  const POLL_INTERVAL_LIVE = 2000;   // 2s se ci sono partite live (massima reattività)
  const POLL_INTERVAL_VISIBLE = 6000; // 6s se la pagina è visibile (riconciliazione)
  const POLL_INTERVAL_HIDDEN = 30000; // 30s se la pagina è in background

  function hasLiveMatchesLocally(){
    try{
      const s = store.load(isAdmin ? 'admin' : 'public');
      return Array.isArray(s?.matches) && s.matches.some(m => m && m.status === 'live');
    }catch(_){ return false; }
  }

  function nextPollInterval(){
    if(document.visibilityState !== 'visible') return POLL_INTERVAL_HIDDEN;
    if(hasLiveMatchesLocally()) return POLL_INTERVAL_LIVE;
    return POLL_INTERVAL_VISIBLE;
  }

  async function doPoll(){
    // Skip se sappiamo che siamo offline (saving fail) o se sta già girando un fetch.
    if(!navigator.onLine) return;
    if(saveInFlight) return; // evito di scaricare mentre sto caricando io stesso
    try{
      const remote = await fetchRemote();
      if(!remote) return;
      if(isPublic){
        publishPublicState(remote, 'poll');
        // Se il poll riesce ma non avevamo mai letto online, segna come recuperato.
        if(!publicInitialFetchOk){
          publicInitialFetchOk = true;
          publicInitRetryAttempt = 0;
          clearTimeout(publicInitRetryTimer);
          publicInitRetryTimer = null;
          clearPublicErrorBanner();
          banner('Connessione ripristinata: dati online caricati.', 'ok');
        }
      }
      else if(isAdmin) publishAdminState(remote, 'poll');
      lastPollAt = Date.now();
    }catch(err){
      // Silenzioso: il poll riproverà.
    }
  }

  function schedulePoll(){
    clearTimeout(pollTimer);
    const delay = nextPollInterval();
    pollTimer = setTimeout(async () => {
      await doPoll();
      schedulePoll();
    }, delay);
  }

  function startPolling(){
    if(pollTimer) return;
    schedulePoll();
  }

  function stopPolling(){
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function setupConnectivityHandlers(){
    if(window.__NG_CONNECTIVITY_HANDLERS_INSTALLED) return;
    window.__NG_CONNECTIVITY_HANDLERS_INSTALLED = true;
    window.addEventListener('online', ()=>{
      setRealtimeState('reconnecting', 'Riconnessione...');
      // Forza una re-subscribe pulita + poll immediato
      setTimeout(subscribeRealtime, 200);
      doPoll();
      // Se sul public non eravamo mai riusciti a leggere i dati, rilancia il retry iniziale.
      if(isPublic && !publicInitialFetchOk){
        attemptInitialPublicFetch(true).catch(()=>{});
      }
    });
    window.addEventListener('offline', ()=>{
      setRealtimeState('off', 'Offline');
      stopPolling();
    });
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'visible'){
        // Re-fetch immediato al ritorno in foreground per recuperare modifiche perse durante background.
        doPoll();
        // Ri-sottoscrivo il canale (può essere stato chiuso dal browser in background)
        if(realtimeChannel){
          try{
            const state = realtimeChannel.state;
            if(state !== 'joined' && state !== 'joining') subscribeRealtime();
          }catch(_){ subscribeRealtime(); }
        }
        // Riprogramma il polling con la frequenza per "visible"
        schedulePoll();
      } else {
        // In background: riprogramma con frequenza ridotta
        schedulePoll();
      }
    });
    window.addEventListener('pageshow', e=>{
      if(e.persisted){ // BFCache hit: re-fetch immediato
        doPoll();
        subscribeRealtime();
      }
    });
    window.addEventListener('focus', ()=>{
      // Quando la finestra recupera il focus, fai un poll immediato (utile se realtime ha perso eventi)
      doPoll();
    });
    // Cross-tab via storage event: admin e public condividono il localStorage.
    // Un cambio in qualsiasi tab triggera questo handler nelle altre tab dello stesso browser.
    // Più rapido di Supabase realtime (latenza ~0 vs ~1-2s).
    window.addEventListener('storage', e => {
      if(!e.newValue) return;
      try{
        const incoming = JSON.parse(e.newValue);
        // Echo check: se il payload viene dal nostro stesso clientId, lo ignoriamo.
        if(incoming._clientId && incoming._clientId === CLIENT_ID) return;
        if(isAdmin && e.key === store.ADMIN_KEY){
          publishAdminState(incoming, 'storage-event');
        } else if(isPublic && e.key === store.PUBLIC_KEY){
          publishPublicState(incoming, 'storage-event');
        }
      }catch(_){}
    });
    // Avvio polling come safety-net
    startPolling();
  }

  function publicErrorBanner(err){
    const info = classifyRemoteError(err);
    // Banner sticky con bottone "Riprova" per evitare di costringere l'utente al reload.
    let el = document.getElementById('ngSyncStatus');
    if(!el){
      el = document.createElement('div');
      el.id = 'ngSyncStatus';
      el.className = 'sync-status';
      document.body.appendChild(el);
    }
    clearTimeout(el._t);
    el.dataset.type = 'error';
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = (info.kind === 'network')
      ? 'Dati online non disponibili: ' + info.message
      : 'Errore lettura dati online: ' + info.message;
    el.appendChild(span);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small';
    btn.style.marginLeft = '8px';
    btn.textContent = 'Riprova';
    btn.addEventListener('click', () => {
      const busy=window.NGInteractive;
      if(busy?.isButtonBusy(btn)) return;
      if(busy) busy.setButtonBusy(btn,true,'Riprovo…');
      else btn.disabled = true;
      attemptInitialPublicFetch(true).then(ok => {
        if(!ok){
          if(busy) busy.setButtonBusy(btn,false);
          else btn.disabled = false;
        }
      }).catch(()=>{
        if(busy) busy.setButtonBusy(btn,false);
        else btn.disabled = false;
      });
    });
    el.appendChild(btn);
  }

  function clearPublicErrorBanner(){
    const el = document.getElementById('ngSyncStatus');
    if(el && el.dataset.type === 'error'){
      el.textContent = '';
      el.dataset.type = 'ok';
    }
  }

  // Tentativo iniziale di lettura dati online, robusto:
  // - rispetta REMOTE_FETCH_TIMEOUT_MS (no hang infinito)
  // - in caso di errore mostra cache locale (se presente) e ripianifica retry
  // - dopo PUBLIC_INIT_MAX_RETRIES si limita al banner con bottone "Riprova",
  //   ma realtime e polling continuano comunque a girare in background.
  async function attemptInitialPublicFetch(manualRetry=false){
    if(manualRetry){
      publicInitRetryAttempt = 0;
      clearTimeout(publicInitRetryTimer);
      publicInitRetryTimer = null;
    }
    try{
      const remote = await fetchRemote();
      publicInitialFetchOk = true;
      publicInitRetryAttempt = 0;
      clearTimeout(publicInitRetryTimer);
      publicInitRetryTimer = null;
      const changed = publishPublicState(remote, 'initial');
      banner(changed ? 'Dati caricati dal server.' : 'Dati già aggiornati.', 'ok');
      return true;
    }catch(err){
      console.error('[NG-Sync] fetch iniziale fallito:', err);
      publicErrorBanner(err);
      // Riprovo con backoff esponenziale finché non raggiungo il limite,
      // poi lascio comunque attivi realtime + polling (che continueranno a tentare).
      if(publicInitRetryAttempt < PUBLIC_INIT_MAX_RETRIES){
        publicInitRetryAttempt += 1;
        const delay = PUBLIC_INIT_BASE_DELAY_MS * Math.pow(1.8, publicInitRetryAttempt - 1);
        clearTimeout(publicInitRetryTimer);
        publicInitRetryTimer = setTimeout(() => {
          attemptInitialPublicFetch().catch(()=>{});
        }, delay);
      }
      return false;
    }
  }

  async function initPublic(){
    window.NG_REFRESH_PUBLIC_DATA = refreshPublicData;
    // Nota: public.js legge già store.load('public') al boot, quindi la cache
    // locale (eventuale) viene mostrata subito senza che noi dobbiamo forzare
    // un re-render. Quando i dati online arriveranno, il custom event
    // 'ng:public-state-updated' aggiornerà la UI.

    // IMPORTANTE: realtime + connectivity handlers vengono attivati SUBITO,
    // anche se il primo fetch fallirà. Così quando la rete torna (online event,
    // tab visibile, riconnessione realtime) il sistema recupera automaticamente
    // senza richiedere reload manuale all'utente — fix del bug per cui un solo
    // errore al boot lasciava la pagina rotta finché non si ricaricava.
    try{ subscribeRealtime(); }catch(err){ console.warn('[NG-Sync] subscribeRealtime init error:', err); }
    try{ setupConnectivityHandlers(); }catch(err){ console.warn('[NG-Sync] setupConnectivityHandlers init error:', err); }

    // Tentativo iniziale + retry interno. Non blocca subscribeRealtime/polling.
    await attemptInitialPublicFetch();
  }

  document.addEventListener('DOMContentLoaded', async()=>{
    if(!isConfigured){
      banner('Modalità locale: configura Supabase per dati condivisi.', 'warn', {sticky:true});
      return;
    }
    if(!window.supabase){ banner('Client Supabase non caricato. Controlla internet/CDN.', 'error', {sticky:true}); return; }
    client = window.supabase.createClient(cfg.URL, cfg.ANON_KEY);
    window.NG_SUPABASE_CLIENT = client;
    if(isAdmin) await initAdmin();
    if(isPublic) await initPublic();
  });
})();
