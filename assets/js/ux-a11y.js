(function(){
  'use strict';

  const focusableSelector = [
    'a[href]','button:not([disabled])','input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])','textarea:not([disabled])','[tabindex]:not([tabindex="-1"])',
    'details > summary:first-of-type','[contenteditable="true"]'
  ].join(',');
  let generatedId = 0;
  const modalTriggers = new WeakMap();

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
    return node.querySelector('[role="dialog"],.modal-content,.ng-modal,.filter-sheet-panel,.mobile-nav-panel,.ng-confirm-card,.lightbox-content') || null;
  }

  function overlayIsOpen(overlay){
    if(overlay.classList.contains('modal')) return overlay.classList.contains('open');
    if(overlay.classList.contains('ng-modal-backdrop')) return overlay.classList.contains('show');
    if(overlay.classList.contains('filter-sheet-modal') || overlay.classList.contains('mobile-nav-sheet') || overlay.classList.contains('ng-confirm-overlay')) return overlay.classList.contains('open');
    if(overlay.classList.contains('photo-lightbox') || overlay.classList.contains('public-photo-lightbox')) return overlay.classList.contains('open');
    if(overlay.classList.contains('login-overlay')) return true;
    return overlay.classList.contains('open') || overlay.classList.contains('show');
  }

  function updateModal(overlay){
    const dialog = modalContainer(overlay);
    if(!dialog) return;
    if(!dialog.hasAttribute('role')) dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    if(!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    if(!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')){
      const heading = dialog.querySelector('h1,h2,h3');
      if(heading){
        dialog.setAttribute('aria-labelledby',ensureId(heading,'ng-dialog-title'));
      }else{
        dialog.setAttribute('aria-label','Finestra di dialogo');
      }
    }
    const open = overlayIsOpen(overlay);
    const hiddenValue = String(!open);
    if(overlay.getAttribute('aria-hidden') !== hiddenValue) overlay.setAttribute('aria-hidden',hiddenValue);
    if(open){
      if(!modalTriggers.has(overlay)) modalTriggers.set(overlay,document.activeElement);
      requestAnimationFrame(()=>{
        const current = document.activeElement;
        if(!overlay.contains(current)){
          const first = [...dialog.querySelectorAll(focusableSelector)].find(visible);
          (first || dialog).focus({preventScroll:true});
        }
      });
    }else{
      const trigger = modalTriggers.get(overlay);
      if(trigger instanceof HTMLElement && document.contains(trigger) && !overlay.contains(document.activeElement)){
        requestAnimationFrame(()=>trigger.focus({preventScroll:true}));
      }
      modalTriggers.delete(overlay);
    }
  }

  function enhanceModals(root){
    const overlays = [];
    if(root.matches?.('.modal,.ng-modal-backdrop,.filter-sheet-modal,.mobile-nav-sheet,.ng-confirm-overlay,.photo-lightbox,.public-photo-lightbox,.login-overlay')) overlays.push(root);
    root.querySelectorAll?.('.modal,.ng-modal-backdrop,.filter-sheet-modal,.mobile-nav-sheet,.ng-confirm-overlay,.photo-lightbox,.public-photo-lightbox,.login-overlay').forEach(el=>overlays.push(el));
    overlays.forEach(updateModal);
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
    return [...document.querySelectorAll('.modal.open,.ng-modal-backdrop.show,.filter-sheet-modal.open,.mobile-nav-sheet.open,.ng-confirm-overlay.open,.photo-lightbox.open,.public-photo-lightbox.open,.login-overlay')]
      .filter(visible).pop() || null;
  }

  function closeActiveOverlay(overlay){
    const selectors = [
      '[data-close-match-filter]','[data-mobile-more="close"]','[data-lightbox-close]',
      '#closeModal','#closeArticleModal','#closeTeamModal','#closeMatchTaskModal','#closeMatchListModal',
      '#closeGroupMoveModal','#closeCriterionMoveModal','#closePlayersTeamModal',
      '#cancelResetBtn','#cancelSimulationBtn','.ng-confirm-cancel','.article-modal-close','.match-modal-close'
    ];
    let button = overlay.querySelector(selectors.join(','));
    if(!button){
      button = [...overlay.querySelectorAll('button')].find(btn=>/^(chiudi|annulla|close)$/i.test(btn.textContent.trim()));
    }
    if(button) button.click();
  }

  ready(()=>{
    document.documentElement.classList.remove('no-js');
    document.documentElement.classList.add('js');
    enhance(document);

    const observer = new MutationObserver(records=>{
      for(const record of records){
        if(record.type === 'childList') record.addedNodes.forEach(node=>{if(node instanceof Element) enhance(node);});
        else if(record.type === 'attributes' && record.target instanceof Element) updateModal(record.target);
      }
      enhanceMessages(document);
      updateTabs();
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
  });
})();
