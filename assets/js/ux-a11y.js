(function(){
  'use strict';

  const focusableSelector = [
    'a[href]','button:not([disabled])','input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])','textarea:not([disabled])','[tabindex]:not([tabindex="-1"])',
    'details > summary:first-of-type','[contenteditable="true"]'
  ].join(',');
  const overlaySelector = '.modal,.ng-modal-backdrop,.filter-sheet-modal,.mobile-nav-sheet,.ng-confirm-overlay,.photos-lightbox,.photo-lightbox,.public-photo-lightbox,.article-image-viewer,.login-overlay';
  let generatedId = 0;
  const modalTriggers = new WeakMap();
  const modalOpenState = new WeakMap();
  const modalFocusFrames = new WeakMap();
  const busyButtons = new WeakMap();
  let scrollLockState = null;

  const ready = fn => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, {once:true})
    : fn();

  function visible(el){
    if(!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function textLabel(el){
    const labelledBy = el.getAttribute('aria-labelledby');
    if(labelledBy){
      const value = labelledBy.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
      if(value) return value;
    }
    const label = el.labels?.[0]?.textContent?.trim();
    if(label) return label;
    const heading = el.closest('article,section,.card,.modal-content,.ng-modal')?.querySelector('h1,h2,h3');
    return heading?.textContent?.trim() || '';
  }

  function ensureId(el, prefix='ng-control'){
    if(!el.id) el.id = `${prefix}-${++generatedId}`;
    return el.id;
  }

  function enhanceLabels(root){
    root.querySelectorAll?.('label:not([for])').forEach(label=>{
      if(label.control) return;
      const parent = label.parentElement;
      if(!parent) return;
      let control = label.querySelector('input,select,textarea');
      if(!control){
        const candidates = [...parent.querySelectorAll(':scope > input,:scope > select,:scope > textarea')];
        control = candidates.find(el=>el.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_PRECEDING) || candidates[0];
      }
      if(control) label.htmlFor = ensureId(control);
    });

    root.querySelectorAll?.('input:not([type="hidden"]),select,textarea').forEach(control=>{
      const key = `${control.id || ''} ${control.getAttribute('name') || ''}`.toLowerCase();
      if(!control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby') && !control.labels?.length){
        const preceding = control.previousElementSibling;
        const fallback = preceding?.matches?.('label') ? preceding.textContent.trim() : control.getAttribute('placeholder');
        if(fallback) control.setAttribute('aria-label', fallback);
      }
      if(control instanceof HTMLInputElement){
        if((key.includes('search') || key.includes('ricerca')) && control.type === 'text') control.type = 'search';
        if((control.type === 'number' || /year|anno|number|numero|score|gol|goal|teams|squadre/.test(key)) && !control.inputMode) control.inputMode = 'numeric';
        if(!control.autocomplete){
          if(key.includes('email')) control.autocomplete = 'email';
          else if(key.includes('password')) control.autocomplete = 'current-password';
          else if(/first.?name|nome/.test(key)) control.autocomplete = 'name';
          else if(key.includes('search')) control.autocomplete = 'off';
        }
      }
    });
  }

  function enhanceImages(root){
    root.querySelectorAll?.('img').forEach(img=>{
      if(!img.hasAttribute('alt')) img.alt = '';
      if(!img.hasAttribute('decoding')) img.decoding = 'async';
      if(img.classList.contains('brand-logo-img')){
        if(!img.hasAttribute('width')) img.width = img.classList.contains('big') ? 82 : 56;
        if(!img.hasAttribute('height')) img.height = img.classList.contains('big') ? 82 : 56;
      }else if(img.classList.contains('team-logo')){
        if(!img.hasAttribute('width')) img.width = img.classList.contains('big') ? 82 : 54;
        if(!img.hasAttribute('height')) img.height = img.classList.contains('big') ? 82 : 54;
      }else if(img.classList.contains('article-image')){
        if(!img.hasAttribute('width')) img.width = 1200;
        if(!img.hasAttribute('height')) img.height = 750;
      }
    });
  }

  function regionName(el, fallback){
    const heading = el.closest('article,section,.card')?.querySelector('h2,h3');
    return heading?.textContent?.trim() || fallback;
  }

  function enhanceScrollable(root){
    root.querySelectorAll?.('.table-wrap,.photos-team-bar,.admin-nav,.tabs').forEach(el=>{
      if(el.classList.contains('table-wrap')){
        if(!el.hasAttribute('tabindex')) el.tabIndex = 0;
        if(!el.hasAttribute('role')) el.setAttribute('role','region');
        if(!el.hasAttribute('aria-label')) el.setAttribute('aria-label',regionName(el,'Tabella scorrevole'));
      }
    });
  }

  function enhanceMessages(root){
    root.querySelectorAll?.('[id$="Msg"],#ngSyncStatus,.sync-status,[data-live-message],.message').forEach(el=>{
      const isError = el.classList.contains('error') || el.dataset.type === 'error';
      if(!el.hasAttribute('role')) el.setAttribute('role',isError ? 'alert' : 'status');
      if(!el.hasAttribute('aria-live')) el.setAttribute('aria-live',isError ? 'assertive' : 'polite');
      el.setAttribute('aria-atomic','true');
    });
  }

  function enhanceNavigation(root){
    root.querySelectorAll?.('nav').forEach(nav=>{
      if(nav.hasAttribute('aria-label')) return;
      if(nav.classList.contains('admin-nav')) nav.setAttribute('aria-label','Navigazione amministrazione');
      else if(nav.classList.contains('tabs')) nav.setAttribute('aria-label','Sezioni del sito');
      else nav.setAttribute('aria-label','Navigazione');
    });
    root.querySelectorAll?.('.admin-nav a').forEach(link=>{
      if(link.classList.contains('active')) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }

  function updateTabs(){
    const tablist = document.querySelector('.tabs');
    if(!tablist) return;
    tablist.setAttribute('role','tablist');
    tablist.querySelectorAll('[data-tab]').forEach((tab,index)=>{
      const target = tab.dataset.tab;
      const panel = target ? document.getElementById(target) : null;
      const id = ensureId(tab,'ng-tab');
      tab.setAttribute('role','tab');
      if(panel){
        tab.setAttribute('aria-controls',panel.id);
        panel.setAttribute('role','tabpanel');
        panel.setAttribute('aria-labelledby',id);
        panel.setAttribute('aria-hidden',panel.classList.contains('active') ? 'false' : 'true');
        if(!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
      }
      const active = tab.classList.contains('active');
      tab.setAttribute('aria-selected',String(active));
      tab.tabIndex = active ? 0 : -1;
      if(index === 0 && !tablist.hasAttribute('aria-orientation')) tablist.setAttribute('aria-orientation','horizontal');
    });
    document.querySelectorAll('.mobile-bottom-nav [data-tab],.mobile-sheet-grid [data-tab]').forEach(item=>{
      if(item.classList.contains('active')) item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    });
  }

  function modalContainer(node){
    if(!(node instanceof Element)) return null;
    if(node.matches('[role="dialog"]')) return node;
    return node.querySelector('[role="dialog"],.modal-content,.ng-modal,.filter-sheet-panel,.mobile-nav-panel,.ng-confirm-card,.lightbox-stage,.lightbox-content') || null;
  }

  function overlayIsOpen(overlay){
    if(overlay.classList.contains('modal')) return overlay.classList.contains('open');
    if(overlay.classList.contains('ng-modal-backdrop')) return overlay.classList.contains('show');
    if(overlay.classList.contains('filter-sheet-modal') || overlay.classList.contains('mobile-nav-sheet') || overlay.classList.contains('ng-confirm-overlay')) return overlay.classList.contains('open');
    if(overlay.classList.contains('photos-lightbox') || overlay.classList.contains('photo-lightbox') || overlay.classList.contains('public-photo-lightbox')) return overlay.classList.contains('open');
    if(overlay.classList.contains('login-overlay')) return overlay.isConnected;
    return overlay.classList.contains('open') || overlay.classList.contains('show');
  }

  function overlayBlocksPage(overlay){
    return overlayIsOpen(overlay) || overlay.classList.contains('is-closing');
  }

  function allOverlays(root=document){
    const overlays=[];
    if(root.matches?.(overlaySelector)) overlays.push(root);
    root.querySelectorAll?.(overlaySelector).forEach(el=>overlays.push(el));
    return overlays;
  }

  function lockDocumentScroll(){
    if(scrollLockState || !document.body) return;
    const body=document.body;
    const computed=getComputedStyle(body);
    const stableGutter=getComputedStyle(document.documentElement).scrollbarGutter.includes('stable');
    const scrollbar=stableGutter ? 0 : Math.max(0,window.innerWidth-document.documentElement.clientWidth);
    scrollLockState={
      overflow:body.style.overflow,
      overscrollBehavior:body.style.overscrollBehavior,
      paddingRight:body.style.paddingRight
    };
    if(scrollbar>0){
      const currentPadding=parseFloat(computed.paddingRight)||0;
      body.style.paddingRight=`${currentPadding+scrollbar}px`;
      document.documentElement.style.setProperty('--ng-scrollbar-compensation',`${scrollbar}px`);
    }
    body.style.overflow='hidden';
    body.style.overscrollBehavior='none';
    body.classList.add('ng-overlay-open');
  }

  function unlockDocumentScroll(){
    if(!scrollLockState || !document.body) return;
    const body=document.body;
    body.style.overflow=scrollLockState.overflow;
    body.style.overscrollBehavior=scrollLockState.overscrollBehavior;
    body.style.paddingRight=scrollLockState.paddingRight;
    body.classList.remove('ng-overlay-open','modal-open','mobile-nav-open');
    document.documentElement.style.removeProperty('--ng-scrollbar-compensation');
    scrollLockState=null;
  }

  function syncDocumentLock(){
    const blocked=allOverlays().some(overlay=>overlayBlocksPage(overlay));
    if(blocked) lockDocumentScroll();
    else unlockDocumentScroll();
  }

  function scheduleFocus(overlay,callback){
    const previous=modalFocusFrames.get(overlay);
    if(previous) cancelAnimationFrame(previous);
    const frame=requestAnimationFrame(()=>{
      modalFocusFrames.delete(overlay);
      callback();
    });
    modalFocusFrames.set(overlay,frame);
  }

  function restoreModalTrigger(overlay){
    const trigger=modalTriggers.get(overlay);
    modalTriggers.delete(overlay);
    if(trigger instanceof HTMLElement && trigger.matches('button,a,[role="button"]')) trigger.setAttribute('aria-expanded','false');
    if(!(trigger instanceof HTMLElement) || !document.contains(trigger)) return;
    scheduleFocus(overlay,()=>{
      const stillOpen=activeOverlay();
      if(stillOpen && stillOpen!==overlay && !stillOpen.contains(trigger)){
        const dialog=modalContainer(stillOpen);
        const first=dialog ? [...dialog.querySelectorAll(focusableSelector)].find(visible) : null;
        (first||dialog)?.focus?.({preventScroll:true});
        return;
      }
      trigger.focus({preventScroll:true});
    });
  }

  function updateModal(overlay){
    if(!(overlay instanceof Element) || !overlay.matches(overlaySelector)) return;
    const dialog = modalContainer(overlay);
    if(!dialog) return;
    if(!dialog.hasAttribute('role')) dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    if(!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    if(!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')){
      const heading = dialog.querySelector('h1,h2,h3');
      if(heading) dialog.setAttribute('aria-labelledby',ensureId(heading,'ng-dialog-title'));
      else dialog.setAttribute('aria-label','Finestra di dialogo');
    }
    const open = overlayIsOpen(overlay);
    const wasOpen = modalOpenState.get(overlay) === true;
    overlay.setAttribute('aria-hidden',String(!open));
    modalOpenState.set(overlay,open);
    if(open && !wasOpen){
      const trigger=document.activeElement;
      modalTriggers.set(overlay,trigger);
      if(trigger instanceof HTMLElement && trigger.matches('button,a,[role="button"]')){
        trigger.setAttribute('aria-controls',ensureId(overlay,'ng-overlay'));
        trigger.setAttribute('aria-expanded','true');
      }
      scheduleFocus(overlay,()=>{
        if(!overlayIsOpen(overlay)) return;
        const current = document.activeElement;
        if(!overlay.contains(current)){
          const first = [...dialog.querySelectorAll(focusableSelector)].find(visible);
          (first || dialog).focus({preventScroll:true});
        }
      });
    }else if(!open && wasOpen){
      if(overlay.classList.contains('is-closing')){
        modalOpenState.set(overlay,true);
        syncDocumentLock();
        return;
      }
      restoreModalTrigger(overlay);
    }
    syncDocumentLock();
  }

  function enhanceModals(root){
    allOverlays(root).forEach(updateModal);
    syncDocumentLock();
  }

  function enhance(root=document){
    enhanceLabels(root);
    enhanceImages(root);
    enhanceScrollable(root);
    enhanceMessages(root);
    enhanceNavigation(root);
    enhanceModals(root);
    updateTabs();
  }

  function activeOverlay(){
    return allOverlays()
      .filter(overlay=>overlayIsOpen(overlay) && visible(overlay))
      .sort((a,b)=>{
        const za=Number.parseInt(getComputedStyle(a).zIndex,10)||0;
        const zb=Number.parseInt(getComputedStyle(b).zIndex,10)||0;
        if(za!==zb) return za-zb;
        return (a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)?-1:1;
      })
      .pop() || null;
  }

  function closeActiveOverlay(overlay){
    const selectors = [
      '[data-close-match-filter]','[data-mobile-more="close"]','[data-lightbox-close]','.lightbox-close',
      '#closeModal','#closeArticleModal','#closeTeamModal','#closeMatchTaskModal','#closeMatchListModal',
      '#closeGroupMoveModal','#closeCriterionMoveModal','#closePlayersTeamModal',
      '#cancelResetBtn','#cancelSimulationBtn','.ng-confirm-cancel','.article-modal-close','.match-modal-close'
    ];
    let button = overlay.querySelector(selectors.join(','));
    if(!button){
      button = [...overlay.querySelectorAll('button')].find(btn=>/^(chiudi|annulla|close|×)$/i.test(btn.textContent.trim()));
    }
    if(button) button.click();
  }

  function setButtonBusy(button,busy,label='Attendi…'){
    if(!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement)) return false;
    if(busy){
      if(busyButtons.has(button)){
        setButtonBusyLabel(button,label,true);
        return false;
      }
      const rect=button.getBoundingClientRect();
      const state={
        html:button.innerHTML,
        value:button.value,
        disabled:button.disabled,
        ariaBusy:button.getAttribute('aria-busy'),
        minWidth:button.style.minWidth,
        minHeight:button.style.minHeight
      };
      busyButtons.set(button,state);
      if(rect.width>0) button.style.minWidth=`${Math.ceil(rect.width)}px`;
      if(rect.height>0) button.style.minHeight=`${Math.ceil(rect.height)}px`;
      button.disabled=true;
      button.setAttribute('aria-busy','true');
      button.classList.add('is-loading');
      if(button instanceof HTMLInputElement){
        button.value=label;
      }else{
        const original=document.createElement('span');
        original.className='ng-btn-original';
        original.setAttribute('aria-hidden','true');
        original.innerHTML=state.html;
        const layer=document.createElement('span');
        layer.className='ng-btn-busy-layer';
        const spinner=document.createElement('span');
        spinner.className='ng-btn-spinner';
        spinner.setAttribute('aria-hidden','true');
        const text=document.createElement('span');
        text.className='ng-btn-busy-text';
        text.textContent=label;
        layer.append(spinner,text);
        button.replaceChildren(original,layer);
      }
      return true;
    }
    const state=busyButtons.get(button);
    if(!state) return false;
    if(button instanceof HTMLInputElement) button.value=state.value;
    else button.innerHTML=state.html;
    button.disabled=state.disabled;
    if(state.ariaBusy===null) button.removeAttribute('aria-busy');
    else button.setAttribute('aria-busy',state.ariaBusy);
    button.style.minWidth=state.minWidth;
    button.style.minHeight=state.minHeight;
    button.classList.remove('is-loading','is-success','is-error');
    busyButtons.delete(button);
    return true;
  }

  function setButtonBusyLabel(button,label,spinner=true,tone=''){
    if(!busyButtons.has(button)) return false;
    if(button instanceof HTMLInputElement){
      button.value=label;
      return true;
    }
    const text=button.querySelector('.ng-btn-busy-text');
    const icon=button.querySelector('.ng-btn-spinner');
    if(text) text.textContent=label;
    if(icon) icon.hidden=!spinner;
    button.classList.toggle('is-success',tone==='success');
    button.classList.toggle('is-error',tone==='error');
    return true;
  }

  window.NGInteractive={
    setButtonBusy,
    setButtonBusyLabel,
    isButtonBusy:button=>busyButtons.has(button),
    syncDocumentLock,
    activeOverlay
  };

  ready(()=>{
    document.documentElement.classList.remove('no-js');
    document.documentElement.classList.add('js');
    enhance(document);

    const observer = new MutationObserver(records=>{
      for(const record of records){
        if(record.type === 'childList'){
          record.addedNodes.forEach(node=>{if(node instanceof Element) enhance(node);});
          record.removedNodes.forEach(node=>{
            if(!(node instanceof Element)) return;
            allOverlays(node).forEach(overlay=>{
              if(modalOpenState.get(overlay)===true) restoreModalTrigger(overlay);
              modalOpenState.set(overlay,false);
            });
          });
        }else if(record.type === 'attributes' && record.target instanceof Element){
          updateModal(record.target);
        }
      }
      enhanceMessages(document);
      updateTabs();
      syncDocumentLock();
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});

    document.addEventListener('ng:tab-changed',updateTabs);
    document.addEventListener('click',()=>requestAnimationFrame(updateTabs));

    document.addEventListener('keydown',event=>{
      const tab = event.target?.closest?.('.tabs [role="tab"]');
      if(tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
        const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
        let index = tabs.indexOf(tab);
        if(event.key === 'Home') index = 0;
        else if(event.key === 'End') index = tabs.length - 1;
        else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[index].focus();
        tabs[index].click();
        return;
      }

      const overlay = activeOverlay();
      if(!overlay) return;
      const dialog = modalContainer(overlay);
      if(event.key === 'Escape'){
        event.preventDefault();
        event.stopPropagation();
        closeActiveOverlay(overlay);
        return;
      }
      if(event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll(focusableSelector)].filter(visible);
      if(!items.length){event.preventDefault();dialog.focus();return;}
      const first = items[0], last = items[items.length-1];
      if(event.shiftKey && document.activeElement === first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement === last){event.preventDefault();first.focus();}
    },true);

    window.addEventListener('pagehide',unlockDocumentScroll,{once:true});
  });
})();
