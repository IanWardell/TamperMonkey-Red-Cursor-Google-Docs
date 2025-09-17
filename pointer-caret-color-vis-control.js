// ==UserScript==
// @name         Google Docs: High-Contrast Caret & Pointer (GM storage + cross-tab sync)
// @namespace    https://github.com/IanWardell
// @version      1.3.0
// @description  High-contrast caret overlay + customizable pointer; settings persisted via Tampermonkey GM_* and synced live across tabs/frames.
// @author       you
// @match        https://docs.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==
/* eslint-disable no-var, prefer-const, no-use-before-define, no-undef */

(function () {
  'use strict';

  // =========================
  // ======= CONFIG ========== 
  // =========================
  var CARET_COLOR         = '#ff0000'; // caret overlay color (persisted)
  var CARET_WIDTH         = 1;         // caret overlay width, px
  var CARET_BLINKMS       = 500;       // caret overlay blink period
  var HOLD_LAST_MS        = 650;       // keep last caret for brief selection flicker (ms)
  var DEBUG               = false;     // global debug logs (Ctrl+Alt+D when HOTKEYS=true)

  // Master hotkey switch. If false, NO hotkeys are registered.
  var HOTKEYS             = true;

  // Pointer (arrow) options
  var RED_POINTER_ENABLED = true;             // default ON (not persisted; session toggle)
  var RED_POINTER_FORCE_EVERYWHERE = false;   // false = keep I-beam in text, true = override everywhere
  var RED_POINTER_PIXEL_SIZE = 12;            // pointer size (persisted)
  var POINTER_COLOR       = '#ff0000';        // pointer color (persisted)

  // Pointer size limits for hotkeys (when enabled)
  var POINTER_MIN         = 10;
  var POINTER_MAX         = 48;
  var POINTER_STEP        = 2;

  // =========================
  // ===== PERSISTENCE =======
  // =========================
  var LS_KEYS = {
    caretColor:   'docsCaret.caretColor',
    pointerColor: 'docsCaret.pointerColor',
    pointerSize:  'docsCaret.pointerSize'
  };

  function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }

  // ---- GM-storage wrappers (shared across all tabs/frames) ----
  function gmGet(key, fallback) {
    try { return GM_getValue(key, fallback); } catch (_) { return fallback; }
  }
  function gmSet(key, value) {
    try { GM_setValue(key, value); } catch (_) { /* ignore */ }
  }

  function loadPrefs(){
    var cc = gmGet(LS_KEYS.caretColor, CARET_COLOR);
    if (cc && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(cc)) CARET_COLOR = cc;

    var pc = gmGet(LS_KEYS.pointerColor, POINTER_COLOR);
    if (pc && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pc)) POINTER_COLOR = pc;

    var ps = gmGet(LS_KEYS.pointerSize, String(RED_POINTER_PIXEL_SIZE));
    if (ps && !isNaN(+ps)) RED_POINTER_PIXEL_SIZE = clamp(parseInt(ps,10), POINTER_MIN, POINTER_MAX);
  }

  function savePrefs(){
    gmSet(LS_KEYS.caretColor,   CARET_COLOR);
    gmSet(LS_KEYS.pointerColor, POINTER_COLOR);
    gmSet(LS_KEYS.pointerSize,  String(RED_POINTER_PIXEL_SIZE));
  }

  // Cross-tab live sync: react to changes saved in other tabs
  function installValueChangeListeners(){
    try {
      GM_addValueChangeListener(LS_KEYS.caretColor, function(name, oldVal, newVal, remote){
        if (!remote) return; // only from other tab/frame
        if (newVal && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(newVal)) {
          CARET_COLOR = newVal;
          updateCaretColorAllDocs();
          syncPanelUI();
          if (DEBUG) console.log('[DocsCaret] caretColor synced from other tab ->', newVal);
        }
      });
      GM_addValueChangeListener(LS_KEYS.pointerColor, function(name, oldVal, newVal, remote){
        if (!remote) return;
        if (newVal && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(newVal)) {
          POINTER_COLOR = newVal;
          applyRedPointerAllDocs();
          syncPanelUI();
          if (DEBUG) console.log('[DocsCaret] pointerColor synced from other tab ->', newVal);
        }
      });
      GM_addValueChangeListener(LS_KEYS.pointerSize, function(name, oldVal, newVal, remote){
        if (!remote) return;
        var n = clamp(parseInt(newVal,10), POINTER_MIN, POINTER_MAX);
        if (!isNaN(n)) {
          RED_POINTER_PIXEL_SIZE = n;
          applyRedPointerAllDocs();
          syncPanelUI();
          if (DEBUG) console.log('[DocsCaret] pointerSize synced from other tab ->', n);
        }
      });
    } catch (e) {
      if (DEBUG) console.warn('[DocsCaret] GM_addValueChangeListener unavailable', e);
    }
  }

  // Load persisted settings immediately
  loadPrefs();

  // =========================
  // ===== UTIL / LOGS =======
  // =========================
  function log(){ if(DEBUG) console.log.apply(console, ['[DocsCaret]'].concat([].slice.call(arguments))); }
  function warn(){ if(DEBUG) console.warn.apply(console, ['[DocsCaret]'].concat([].slice.call(arguments))); }

  function getContrastColor(hexColor) {
    try{
      var r = parseInt(hexColor.substr(1, 2), 16);
      var g = parseInt(hexColor.substr(3, 2), 16);
      var b = parseInt(hexColor.substr(5, 2), 16);
      var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance > 0.5 ? '#000000' : '#ffffff';
    }catch(_){ return '#000000'; }
  }

  // "Zero-ish" rect filter. A real caret should have some height and near-zero width.
  function isZeroishRect(r){
    if(!r) return true;
    var h = Math.max(0, r.height || 0);
    return (h < 8) || (r.left === 0 && r.top === 0 && h === 16);
  }

  // =========================
  // ======= DEBUG UI ========
  // =========================
  function ensureDebugBadge(doc){
    try{
      var id='__docsCaretDebugBadge';
      var el=doc.getElementById(id);
      if(!DEBUG){ if(el) el.remove(); return; }
      if(el) return;
      var b=doc.createElement('div');
      b.id=id; b.textContent='DocsCaret DEBUG';
      Object.assign(b.style,{
        position:'fixed', right:'6px', bottom:'6px', zIndex:'2147483647',
        font:'12px/1.4 system-ui, Arial, sans-serif', padding:'4px 6px',
        background:'rgba(255,0,0,0.12)', border:'1px solid rgba(255,0,0,0.35)',
        borderRadius:'6px', color:'#900', userSelect:'none', pointerEvents:'none'
      });
      (doc.body||doc.documentElement).appendChild(b);
    }catch(e){}
  }

  // =========================
  // ===== CARET OVERLAY =====
  // =========================
  function ensureCaretForDoc(doc){
    try{
      if(!doc || !doc.documentElement) return null;
      if(!doc.__overlayCaret){
        var c=doc.createElement('div');
        c.id='__overlayRedCaret';
        c.style.position='fixed';
        c.style.left='0'; c.style.top='0';
        c.style.width=CARET_WIDTH+'px';
        c.style.height='16px';
        c.style.background=CARET_COLOR;
        c.style.pointerEvents='none';
        c.style.zIndex='2147483647';
        c.style.visibility='hidden';
        c.style.willChange='transform,opacity';
        c.style.opacity='1';
        (doc.body||doc.documentElement).appendChild(c);

        doc.__overlayCaret=c;
        doc.__overlayCaretVisible=false;
        doc.__overlayCaretEnabled=true;
        doc.__overlayLastShowTs=0;

        // Blink
        var blink=true;
        setInterval(function(){
          if(!doc.__overlayCaretEnabled){ c.style.opacity='0'; return; }
          if(doc.__overlayCaretVisible){ blink=!blink; c.style.opacity=blink?'1':'0'; }
          else { c.style.opacity='0'; }
        }, CARET_BLINKMS);

        attachDocListeners(doc);

        // Best-effort native caret-color
        try{
          var s=doc.createElement('style');
          s.id='__docsCaretColorStyle';
          s.textContent='textarea, input, [contenteditable="true"], [role="textbox"], .kix-appview-editor * { caret-color: '+CARET_COLOR+' !important; }';
          (doc.head||doc.documentElement).appendChild(s);
        }catch(_){}
      }
      ensureDebugBadge(doc);
      return doc.__overlayCaret;
    }catch(e){ warn('ensureCaretForDoc failed', e); return null; }
  }

  function getAllDocs(rootDoc){
    var out=[];
    function walk(d){
      if(!d||!d.documentElement) return;
      out.push(d);
      var ifr=d.getElementsByTagName('iframe');
      for(var i=0;i<ifr.length;i++){
        try{ if(ifr[i].contentDocument) walk(ifr[i].contentDocument); }catch(e){}
      }
    }
    walk(rootDoc||document);
    return out;
  }

  function looksLikeDocsEditor(doc){
    try{
      if (doc.querySelector('.kix-appview-editor, .kix-page, .kix-canvas-tile-content, .kix-lineview, .kix-contentarea')) return true;
      var u = (doc.URL||'') + '';
      if (u.startsWith('https://docs.google.com/')) return true;
    }catch(_){}
    return false;
  }

  function collapsedSelectionRect(d){
    try{
      var sel=d.getSelection && d.getSelection();
      if(!sel || sel.rangeCount===0 || !sel.isCollapsed) return null;

      var range=sel.getRangeAt(0);
      var rects=range.getClientRects&&range.getClientRects();
      if(rects && rects.length){
        var r=rects[rects.length-1];
        if(r && (r.width || r.height)) return r;
      }
      var br=range.getBoundingClientRect&&range.getBoundingClientRect();
      if(br && (br.width||br.height)) return br;

      // Zero-width span fallback
      var span=d.createElement('span');
      span.style.display='inline-block'; span.style.width='0'; span.style.height='1em';
      span.appendChild(d.createTextNode('\u200B'));
      var r2=range.cloneRange(); r2.collapse(true); r2.insertNode(span);
      var srect=span.getBoundingClientRect(); if(span.parentNode) span.parentNode.removeChild(span);
      if(srect && (srect.width||srect.height)) return srect;
    }catch(_){}
    return null;
  }

  function docsDOMCaretRect(d){
    try{
      var candidates = d.querySelectorAll([
        '.kix-cursor-caret',
        '.kix-cursor',
        '[class*="cursor-caret"]',
        '.kix-lineview-cursor',
        '.kix-contentarea *[style*="cursor-color"]'
      ].join(','));
      for(var i=0;i<candidates.length;i++){
        var el=candidates[i];
        var st=d.defaultView.getComputedStyle(el);
        if(st && st.display==='none') continue;
        var r=el.getBoundingClientRect();
        if(r && r.height>8 && r.width<=6) return r;
      }
    }catch(_){}
    return null;
  }

  function hideAllExcept(targetDoc){
    var docs=getAllDocs(document);
    for(var i=0;i<docs.length;i++){
      var d=docs[i], c=d.__overlayCaret;
      if(!c) continue;
      if(d!==targetDoc){ c.style.visibility='hidden'; d.__overlayCaretVisible=false; }
    }
  }

  function findActiveSelectionRect() {
    var docs = getAllDocs(document);
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (!looksLikeDocsEditor(d)) continue;

      var rSel = collapsedSelectionRect(d);
      if (rSel && !isZeroishRect(rSel)) return { doc: d, rect: rSel, src: 'selection' };

      var rDom = docsDOMCaretRect(d);
      if (rDom && !isZeroishRect(rDom)) return { doc: d, rect: rDom, src: 'dom-caret' };
    }
    return null;
  }

  function updateCaretPositionGlobal(reason){
    var found=findActiveSelectionRect();

    if(!found){
      var now=Date.now(), docs=getAllDocs(document), anyVisible=false;
      for(var i=0;i<docs.length;i++){
        var d=docs[i], c=d.__overlayCaret;
        if(!c) continue;
        var keep=(now-(d.__overlayLastShowTs||0))<HOLD_LAST_MS && d.__overlayCaretEnabled;
        if(!keep){ c.style.visibility='hidden'; d.__overlayCaretVisible=false; }
        else anyVisible=true;
      }
      if(DEBUG) log('Caret hidden (no collapsed selection)', reason, {kept:anyVisible});
      return;
    }

    var d=found.doc, rect=found.rect;
    var caret=ensureCaretForDoc(d);
    if(!caret || !d.__overlayCaretEnabled) return;

    var left=rect.left, top=rect.top, h=Math.max(rect.height||16,12);

    caret.style.transform='translate('+Math.round(left)+'px,'+Math.round(top)+'px)';
    caret.style.height=Math.round(h)+'px';
    caret.style.visibility='visible';
    d.__overlayCaretVisible=true;
    d.__overlayLastShowTs=Date.now();

    hideAllExcept(d);
    if(DEBUG) log('Caret updated', {url:(d.URL||'???'), left:left, top:top, height:h, source:found.src, reason:reason});
  }

  function attachDocListeners(doc){
    if (!doc || doc.__docsCaretListenersInstalled) return;
    doc.__docsCaretListenersInstalled = true;

    var scheduled = false;
    function schedule(reason){
      if(scheduled) return; scheduled = true;
      var cb = function(){ scheduled = false; updateCaretPositionGlobal(reason); };
      (doc.defaultView && doc.defaultView.requestAnimationFrame)
        ? doc.defaultView.requestAnimationFrame(cb)
        : setTimeout(cb, 16);
    }

    // Key/selection/input listeners: capture=true, passive not applicable
    ['selectionchange','keyup','keydown','input','mouseup','mousedown']
      .forEach(function(ev){
        doc.addEventListener(ev, function(){ if(DEBUG) log('Event',ev,'-> update'); schedule(ev); }, true);
      });

    // Touch + scroll: passive to avoid scroll-blocking warnings
    var optPassive = { capture: true, passive: true };
    doc.addEventListener('touchstart', function(){ schedule('touchstart'); }, optPassive);
    doc.addEventListener('touchend',   function(){ schedule('touchend');   }, optPassive);
    (doc.defaultView||window).addEventListener('scroll',  function(){ schedule('scroll');  }, optPassive);
    (doc.defaultView||window).addEventListener('resize',  function(){ schedule('resize');  }, { capture:true, passive:true });

    // Boot polling to catch editor swaps
    var tries=0, max=60;
    var boot=setInterval(function(){ updateCaretPositionGlobal('boot#'+tries); tries++; if(tries>=max) clearInterval(boot); }, 250);
  }

  // =========================
  // ===== RED POINTER =======
  // =========================
  function buildRedCursorDataURL(pixelSize){
    var w = clamp((pixelSize || 12), 10, 48);
    var h = Math.round(w * 1.5);
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='"+w+"' height='"+h+"' viewBox='0 0 32 48'>"+
      "  <path d='M1,1 L1,35 L10,28 L14,46 L20,44 L16,26 L31,26 Z' fill='"+POINTER_COLOR+"' stroke='white' stroke-width='2'/>"+
      "</svg>";
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function applyRedPointerToDoc(doc){
    try{
      if(!doc || !doc.documentElement) return;
      if (!doc.__redPointerStyle) {
        var css = doc.createElement('style');
        css.id = '__docsRedPointerStyle';
        doc.__redPointerStyle = css;
        (doc.head||doc.documentElement).appendChild(css);
      }
      var url = buildRedCursorDataURL(RED_POINTER_PIXEL_SIZE);

      var ruleEverywhere = [
        '* { cursor: url("'+url+'") 2 2, auto !important; }'
      ].join('\n');

      var ruleNonText = [
        'html, body, .kix-appview-editor, .kix-appview-editor *:not([contenteditable="true"]) {',
        '  cursor: url("'+url+'") 2 2, auto !important;',
        '}',
        '[contenteditable="true"], textarea, input[type="text"], input:not([type]) {',
        '  cursor: auto !important;',
        '}'
      ].join('\n');

      doc.__redPointerStyle.textContent = RED_POINTER_ENABLED
        ? (RED_POINTER_FORCE_EVERYWHERE ? ruleEverywhere : ruleNonText)
        : '';

    } catch(e){ if(DEBUG) warn('Red pointer apply failed', e); }
  }

  function applyRedPointerAllDocs(){
    (function walk(d){
      if(!d) return;
      applyRedPointerToDoc(d);
      var ifr = d.getElementsByTagName('iframe');
      for (var i=0;i<ifr.length;i++){
        try { if (ifr[i].contentDocument) walk(ifr[i].contentDocument); } catch(_) {}
      }
    })(document);
  }

  // =========================
  // ===== CONTROL PANEL =====
  // =========================
  var CONTROL_PANEL_VISIBLE = false;
  var CONTROL_PANEL_ELEMENT = null;

  function createControlPanel(doc) {
    if (CONTROL_PANEL_ELEMENT) return CONTROL_PANEL_ELEMENT;
    try { if (doc !== window.top.document) return null; } catch (_) { return null; }

    var panel = doc.createElement('div');
    panel.id = '__docsCaretControlPanel';
    panel.style.cssText = [
      'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);',
      'background:#fff; border:2px solid #333; border-radius:8px; padding:16px;',
      'box-shadow:0 4px 20px rgba(0,0,0,0.3); z-index:2147483647;',
      'font-family:system-ui, Arial, sans-serif; font-size:14px; min-width:340px; display:none;'
    ].join('');

    var title = doc.createElement('div');
    title.textContent = 'Docs Caret & Pointer Controls';
    title.style.cssText = 'font-weight:bold; margin-bottom:12px; text-align:center; color:#333;';
    panel.appendChild(title);

    // Caret color group
    var caretGroup = doc.createElement('div');
    caretGroup.style.cssText = 'margin-bottom:14px;';
    var caretLabel = doc.createElement('label');
    caretLabel.textContent = 'Caret Color:';
    caretLabel.htmlFor = '__dccpCaretColor';
    caretLabel.style.cssText = 'display:block; margin-bottom:6px; font-weight:bold;';
    caretGroup.appendChild(caretLabel);

    var caretColorInput = doc.createElement('input');
    caretColorInput.type = 'color';
    caretColorInput.id = '__dccpCaretColor';
    caretColorInput.value = CARET_COLOR;
    caretColorInput.style.cssText = 'width:100%; height:40px; border:1px solid #ccc; border-radius:4px; cursor:pointer;';
    caretGroup.appendChild(caretColorInput);

    var caretPreview = doc.createElement('div');
    caretPreview.id = '__dccpCaretPreview';
    caretPreview.textContent = CARET_COLOR;
    caretPreview.style.cssText = 'margin-top:6px; padding:6px; background:#f5f5f5; border-radius:4px; font-family:monospace; text-align:center;';
    caretGroup.appendChild(caretPreview);

    caretPreview.style.background = CARET_COLOR;
    caretPreview.style.color = getContrastColor(CARET_COLOR);

    panel.appendChild(caretGroup);

    // Pointer color group
    var pointerColorGroup = doc.createElement('div');
    pointerColorGroup.style.cssText = 'margin-bottom:14px;';
    var pointerColorLabel = doc.createElement('label');
    pointerColorLabel.textContent = 'Pointer Color:';
    pointerColorLabel.htmlFor = '__dccpPointerColor';
    pointerColorLabel.style.cssText = 'display:block; margin-bottom:6px; font-weight:bold;';
    pointerColorGroup.appendChild(pointerColorLabel);

    var pointerColorInput = doc.createElement('input');
    pointerColorInput.type = 'color';
    pointerColorInput.id = '__dccpPointerColor';
    pointerColorInput.value = POINTER_COLOR;
    pointerColorInput.style.cssText = 'width:100%; height:40px; border:1px solid #ccc; border-radius:4px; cursor:pointer;';
    pointerColorGroup.appendChild(pointerColorInput);

    var pointerColorPreview = doc.createElement('div');
    pointerColorPreview.id = '__dccpPointerPreview';
    pointerColorPreview.textContent = POINTER_COLOR;
    pointerColorPreview.style.cssText = 'margin-top:6px; padding:6px; background:#f5f5f5; border-radius:4px; font-family:monospace; text-align:center;';
    pointerColorGroup.appendChild(pointerColorPreview);

    panel.appendChild(pointerColorGroup);

    // Pointer size group
    var pointerGroup = doc.createElement('div');
    pointerGroup.style.cssText = 'margin-bottom:8px;';
    var pointerLabel = doc.createElement('label');
    pointerLabel.textContent = 'Pointer Size:';
    pointerLabel.htmlFor = '__dccpPointerSize';
    pointerLabel.style.cssText = 'display:block; margin-bottom:6px; font-weight:bold;';
    pointerGroup.appendChild(pointerLabel);

    var sizeSlider = doc.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.id = '__dccpPointerSize';
    sizeSlider.min = POINTER_MIN;
    sizeSlider.max = POINTER_MAX;
    sizeSlider.step = POINTER_STEP;
    sizeSlider.value = RED_POINTER_PIXEL_SIZE;
    sizeSlider.style.cssText = 'width:100%;';
    pointerGroup.appendChild(sizeSlider);

    var sizeDisplay = doc.createElement('div');
    sizeDisplay.id = '__dccpPointerSizeVal';
    sizeDisplay.textContent = RED_POINTER_PIXEL_SIZE + 'px';
    sizeDisplay.style.cssText = 'text-align:center; font-family:monospace; color:#666; margin-top:4px;';
    pointerGroup.appendChild(sizeDisplay);

    panel.appendChild(pointerGroup);

    // Buttons row
    var btnRow = doc.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; margin-top:12px;';

    var saveBtn = doc.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.id = '__dccpSave';
    saveBtn.style.cssText = 'flex:1; padding:8px; background:#28a745; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:14px;';
    btnRow.appendChild(saveBtn);

    var exitBtn = doc.createElement('button');
    exitBtn.textContent = 'Exit';
    exitBtn.id = '__dccpExit';
    exitBtn.style.cssText = 'flex:1; padding:8px; background:#dc3545; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:14px;';
    btnRow.appendChild(exitBtn);

    var closeBtn = doc.createElement('button');
    closeBtn.textContent = 'Close (Esc)';
    closeBtn.id = '__dccpClose';
    closeBtn.style.cssText = 'flex:1; padding:8px; background:#007cba; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:14px;';
    btnRow.appendChild(closeBtn);

    panel.appendChild(btnRow);

    // Hotkeys help (omitted for brevity — same as previous build)
    var help = doc.createElement('div');
    help.style.cssText='margin-top:12px; font:12px/1.4 system-ui,Arial,sans-serif; color:#444;';
    help.textContent='Hotkeys: Ctrl+Alt+O (panel), C (caret), P (pointer), D (debug), -/+(size), 9 (reset defaults).';
    panel.appendChild(help);

    // Handlers — save on input so other tabs sync immediately
    caretColorInput.addEventListener('input', function() {
      CARET_COLOR = caretColorInput.value;
      caretPreview.textContent = CARET_COLOR;
      caretPreview.style.background = CARET_COLOR;
      caretPreview.style.color = getContrastColor(CARET_COLOR);
      updateCaretColorAllDocs();
      savePrefs(); // immediate persist + cross-tab notify
    });

    pointerColorInput.addEventListener('input', function() {
      POINTER_COLOR = pointerColorInput.value;
      pointerColorPreview.textContent = POINTER_COLOR;
      pointerColorPreview.style.background = POINTER_COLOR;
      pointerColorPreview.style.color = getContrastColor(POINTER_COLOR);
      applyRedPointerAllDocs();
      savePrefs(); // immediate persist + cross-tab notify
    });

    sizeSlider.addEventListener('input', function() {
      RED_POINTER_PIXEL_SIZE = clamp(parseInt(sizeSlider.value,10), POINTER_MIN, POINTER_MAX);
      sizeDisplay.textContent = RED_POINTER_PIXEL_SIZE + 'px';
      applyRedPointerAllDocs();
      savePrefs(); // immediate persist + cross-tab notify
    });

    function flashGreen(){
      panel.style.transition = 'background 0.25s';
      var old = panel.style.background;
      panel.style.background = '#d4edda';
      setTimeout(function(){ panel.style.background = old; }, 350);
    }

    saveBtn.addEventListener('click', function() {
      savePrefs();
      flashGreen();
      log('Preferences saved');
    });

    exitBtn.addEventListener('click', function() {
      savePrefs();
      hideControlPanel();
    });

    closeBtn.addEventListener('click', hideControlPanel);

    doc.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && CONTROL_PANEL_VISIBLE) {
        hideControlPanel();
        e.preventDefault();
      }
    });

    (doc.body || doc.documentElement).appendChild(panel);
    CONTROL_PANEL_ELEMENT = panel;
    return panel;
  }

  function syncPanelUI(){
    if (!CONTROL_PANEL_VISIBLE || !CONTROL_PANEL_ELEMENT) return;
    var panel = CONTROL_PANEL_ELEMENT;
    var caretInput   = panel.querySelector('#__dccpCaretColor');
    var caretPrev    = panel.querySelector('#__dccpCaretPreview');
    var pointerInput = panel.querySelector('#__dccpPointerColor');
    var pointerPrev  = panel.querySelector('#__dccpPointerPreview');
    var slider       = panel.querySelector('#__dccpPointerSize');
    var sizeVal      = panel.querySelector('#__dccpPointerSizeVal');

    if (caretInput) caretInput.value = CARET_COLOR;
    if (caretPrev)  { caretPrev.textContent = CARET_COLOR; caretPrev.style.background = CARET_COLOR; caretPrev.style.color = getContrastColor(CARET_COLOR); }
    if (pointerInput) pointerInput.value = POINTER_COLOR;
    if (pointerPrev)  { pointerPrev.textContent = POINTER_COLOR; pointerPrev.style.background = POINTER_COLOR; pointerPrev.style.color = getContrastColor(POINTER_COLOR); }
    if (slider) slider.value = RED_POINTER_PIXEL_SIZE;
    if (sizeVal) sizeVal.textContent = RED_POINTER_PIXEL_SIZE + 'px';
  }

  function showControlPanel() {
    var panel = createControlPanel(window.top.document);
    if (!panel) return;

    // sync current values into controls
    CONTROL_PANEL_VISIBLE = true;
    syncPanelUI();
    panel.style.display = 'block';
  }

  function hideControlPanel() {
    if (CONTROL_PANEL_ELEMENT) CONTROL_PANEL_ELEMENT.style.display = 'none';
    CONTROL_PANEL_VISIBLE = false;
  }

  function updateCaretColorAllDocs() {
    var docs = getAllDocs(document);
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var caret = d.__overlayCaret;
      if (caret) caret.style.background = CARET_COLOR;

      try {
        var existingStyle = d.getElementById('__docsCaretColorStyle');
        if (existingStyle) existingStyle.remove();
        var style = d.createElement('style');
        style.id = '__docsCaretColorStyle';
        style.textContent = 'textarea, input, [contenteditable="true"], [role="textbox"], .kix-appview-editor * { caret-color: ' + CARET_COLOR + ' !important; }';
        (d.head || d.documentElement).appendChild(style);
      } catch (e) { if (DEBUG) warn('Failed to update caret color CSS', e); }
    }
  }

  // =========================
  // ======= HOTKEYS =========
  // =========================
  function installHotkeysOnDoc(doc){
    if (!HOTKEYS) return;
    if (!doc || doc.__docsCaretHotkeysInstalled) return;
    doc.__docsCaretHotkeysInstalled = true;

    doc.addEventListener('keydown', function(e){
      if(!(e.ctrlKey && e.altKey)) return;

      if(e.code==='KeyC'){
        var docs=getAllDocs(document);
        var state;
        for(var i=0;i<docs.length;i++){
          var d=docs[i]; ensureCaretForDoc(d);
          d.__overlayCaretEnabled=!d.__overlayCaretEnabled;
          if(!d.__overlayCaretEnabled && d.__overlayCaret){ d.__overlayCaret.style.visibility='hidden'; d.__overlayCaretVisible=false; }
          state=d.__overlayCaretEnabled; ensureDebugBadge(d);
        }
        log('Toggle caret enabled ->', state); e.preventDefault(); return;
      }

      if(e.code==='KeyD'){
        DEBUG=!DEBUG;
        var d2=getAllDocs(document);
        for(var j=0;j<d2.length;j++) ensureDebugBadge(d2[j]);
        console.log('[DocsCaret] DEBUG ->', DEBUG); e.preventDefault(); return;
      }

      if(e.code==='KeyP'){
        RED_POINTER_ENABLED = !RED_POINTER_ENABLED;
        console.log('[DocsCaret] Red Pointer ->', RED_POINTER_ENABLED);
        applyRedPointerAllDocs();
        e.preventDefault(); return;
      }

      if(e.code==='Minus' || e.code==='NumpadSubtract'){
        RED_POINTER_PIXEL_SIZE = Math.max(POINTER_MIN, RED_POINTER_PIXEL_SIZE - POINTER_STEP);
        console.log('[DocsCaret] Pointer size ->', RED_POINTER_PIXEL_SIZE);
        applyRedPointerAllDocs();
        savePrefs(); // persist & notify other tabs
        e.preventDefault(); return;
      }

      if(e.code==='Equal' || e.code==='NumpadAdd'){
        RED_POINTER_PIXEL_SIZE = Math.min(POINTER_MAX, RED_POINTER_PIXEL_SIZE + POINTER_STEP);
        console.log('[DocsCaret] Pointer size ->', RED_POINTER_PIXEL_SIZE);
        applyRedPointerAllDocs();
        savePrefs(); // persist & notify other tabs
        e.preventDefault(); return;
      }

      if(e.code==='Digit9'){
        CARET_COLOR = '#ff0000';
        POINTER_COLOR = '#ff0000';
        RED_POINTER_PIXEL_SIZE = 12;
        RED_POINTER_ENABLED = true;

        updateCaretColorAllDocs();
        applyRedPointerAllDocs();
        savePrefs(); // persist defaults & notify other tabs
        syncPanelUI();

        console.log('[DocsCaret] Reset to defaults -> caret:#ff0000, pointer:#ff0000, size:12px');
        e.preventDefault(); return;
      }

      if(e.code==='KeyO'){
        if (CONTROL_PANEL_VISIBLE) hideControlPanel();
        else showControlPanel();
        console.log('[DocsCaret] Control panel ->', CONTROL_PANEL_VISIBLE);
        e.preventDefault(); return;
      }
    }, true);
  }

  function installHotkeysAllDocs(){
    var docs = getAllDocs(document);
    for(var i=0;i<docs.length;i++){
      try{ installHotkeysOnDoc(docs[i]); }catch(_){}
    }
  }

  // =========================
  // ========= INIT ==========
  // =========================
  function applyRedPointerBoot() {
    applyRedPointerAllDocs();
    setInterval(applyRedPointerAllDocs, 5000); // slow backstop; MutationObserver handles most
  }

  function initAll(){
    var docs=getAllDocs(document);
    for(var i=0;i<docs.length;i++){
      ensureCaretForDoc(docs[i]);
      applyRedPointerToDoc(docs[i]);
      attachDocListeners(docs[i]);
    }

    try { createControlPanel(window.top.document); } catch(_) {}

    installValueChangeListeners();  // <— enable cross-tab sync
    installHotkeysAllDocs();

    var mo=new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){
        var m=muts[i];
        for(var j=0;j<m.addedNodes.length;j++){
          var n=m.addedNodes[j];
          if(n && n.tagName==='IFRAME'){
            try{
              if(n.contentDocument){
                ensureCaretForDoc(n.contentDocument);
                applyRedPointerToDoc(n.contentDocument);
                attachDocListeners(n.contentDocument);
                installHotkeysOnDoc(n.contentDocument);
              }
            }catch(e){}
          } else if(n && n.querySelectorAll){
            var nested=n.querySelectorAll('iframe');
            for(var k=0;k<nested.length;k++){
              try{
                if(nested[k].contentDocument){
                  ensureCaretForDoc(nested[k].contentDocument);
                  applyRedPointerToDoc(nested[k].contentDocument);
                  attachDocListeners(nested[k].contentDocument);
                  installHotkeysOnDoc(nested[k].contentDocument);
                }
              }catch(e){}
            }
          }
        }
      }
    });
    try{ mo.observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}

    updateCaretPositionGlobal('init');
    applyRedPointerBoot();
  }

  initAll();
})();
