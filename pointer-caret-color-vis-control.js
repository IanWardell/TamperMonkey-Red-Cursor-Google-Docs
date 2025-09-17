/* eslint-disable no-var, prefer-const, no-use-before-define, no-undef */
/*
  pointer-caret-color-vis-control.js
  Google Docs High-Contrast Red Caret + Red Pointer (overlay)

  Implementation file used by docs-caret-vis-control.user.js (the installer stub).
  You can also load this file directly in Tampermonkey if you prefer a single-file setup.

  Notes:
  - Works inside Docs iframes
  - Skips bogus about:blank frames and zero-ish rects
  - Deep debug logging available
  - Hotkeys fully disableable via HOTKEYS = false
  - Author: https://github.com/IanWardell/
*/

(function () {
  'use strict';

  // =========================
  // ======= CONFIG ==========
  // =========================
  var CARET_COLOR   = '#ff0000';    // Overlay caret color
  var CARET_WIDTH   = 1;            // Overlay caret width, px
  var CARET_BLINKMS = 500;          // Overlay caret blink period
  var HOLD_LAST_MS  = 650;          // Keep last caret for brief selection flicker (ms)
  var DEBUG         = false;        // Global debug logs (toggle with Ctrl+Alt+D when HOTKEYS=true)

  // Master hotkey switch. If false, NO hotkeys are registered.
  var HOTKEYS       = false;

  // Red pointer (arrow) options (toggle with Ctrl+Alt+P when HOTKEYS=true)
  var RED_POINTER_ENABLED = true;            // default ON
  var RED_POINTER_FORCE_EVERYWHERE = false;  // false = keep I-beam in text, true = override everywhere
  var RED_POINTER_PIXEL_SIZE = 12;           // nominal cursor SVG size (small default, matches "ORIG")

  // Pointer size limits for hotkeys (when enabled)
  var POINTER_MIN = 10;
  var POINTER_MAX = 48;
  var POINTER_STEP = 2;
  var POINTER_TINY_PRESET = 10;

  // =========================
  // ===== UTIL / LOGS =======
  // =========================
  function log(){ if(DEBUG) console.log.apply(console, ['[DocsCaret]'].concat([].slice.call(arguments))); }
  function warn(){ if(DEBUG) console.warn.apply(console, ['[DocsCaret]'].concat([].slice.call(arguments))); }
  function err(){ if(DEBUG) console.error.apply(console, ['[DocsCaret]'].concat([].slice.call(arguments))); }

  // "Zero-ish" rect filter. A real caret should have some height and near-zero width.
  function isZeroishRect(r){
    if(!r) return true;
    var h = Math.max(0, r.height || 0);
    // Reject tiny heights and a common bogus (0,0,16) fallback
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
    }catch(e){/* ignore */}
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

  function findActiveSelectionRect(){
    var docs=getAllDocs(document);

    // Prefer likely editor docs
    var pri=[], sec=[];
    for (var i=0;i<docs.length;i++){
      var d=docs[i];
      (looksLikeDocsEditor(d) ? pri : sec).push(d);
    }
    var ordered = pri.concat(sec);

    for (var j=0;j<ordered.length;j++){
      var d=ordered[j];

      // 1) Selection API
      var r = collapsedSelectionRect(d);
      if(r && !isZeroishRect(r)){
        return {doc:d, rect:r, src:'selection'};
      }

      // 2) DOM caret heuristic
      var r2 = docsDOMCaretRect(d);
      if(r2 && !isZeroishRect(r2)){
        return {doc:d, rect:r2, src:'dom-caret'};
      }
    }
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
    var scheduled=false;
    function schedule(reason){
      if(scheduled) return; scheduled=true;
      setTimeout(function(){ scheduled=false; updateCaretPositionGlobal(reason); }, 16);
    }

    ['selectionchange','keyup','keydown','input','mouseup','mousedown','touchend','touchstart']
      .forEach(function(ev){ doc.addEventListener(ev, function(){ if(DEBUG) log('Event',ev,'-> update'); schedule(ev); }, true); });

    (doc.defaultView||window).addEventListener('scroll', function(){ schedule('scroll'); }, true);
    (doc.defaultView||window).addEventListener('resize', function(){ schedule('resize'); }, true);

    // Boot polling to catch editor swaps
    var tries=0, max=120;
    var boot=setInterval(function(){ updateCaretPositionGlobal('boot#'+tries); tries++; if(tries>=max) clearInterval(boot); }, 250);
  }

  // =========================
  // ===== RED POINTER =======
  // =========================
  function buildRedCursorDataURL(pixelSize){
    // Keep it small and simple: clamp 12–48, default 12
    var w = Math.max(12, Math.min(48, pixelSize || 12));
    var h = Math.round(w * 1.5);
    // Keep path constant (viewBox 32x48) so hotspot stays consistent; size is controlled by width/height.
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='"+w+"' height='"+h+"' viewBox='0 0 32 48'>"+
      "  <path d='M1,1 L1,35 L10,28 L14,46 L20,44 L16,26 L31,26 Z' fill='#ff0000' stroke='white' stroke-width='2'/>"+
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

      // Mode A: everywhere (strongest)
      var ruleEverywhere = [
        '* { cursor: url("'+url+'") 2 2, auto !important; }'
      ].join('\n');

      // Mode B: non-text areas – try to keep the I-beam in the content editor
      var ruleNonText = [
        // Editor chrome and panels
        'html, body, .kix-appview-editor, .kix-appview-editor *:not([contenteditable="true"]) {',
        '  cursor: url("'+url+'") 2 2, auto !important;',
        '}',
        // Do NOT override common text inputs / contenteditable
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
  // ======= HOTKEYS =========
  // =========================
  function installHotkeys(){
    if (!HOTKEYS) return;

    document.addEventListener('keydown', function(e){
      if(!(e.ctrlKey&&e.altKey)) return;

      // Toggle caret overlay on/off
      if(e.code==='KeyC'){
        var docs=getAllDocs(document);
        var state;
        for(var i=0;i<docs.length;i++){
          var d=docs[i]; ensureCaretForDoc(d);
          d.__overlayCaretEnabled=!d.__overlayCaretEnabled;
          if(!d.__overlayCaretEnabled && d.__overlayCaret){ d.__overlayCaret.style.visibility='hidden'; d.__overlayCaretVisible=false; }
          state=d.__overlayCaretEnabled; ensureDebugBadge(d);
        }
        log('Toggle caret enabled ->', state); e.preventDefault();
        return;
      }

      // Toggle DEBUG logs + badge
      if(e.code==='KeyD'){
        DEBUG=!DEBUG;
        var d2=getAllDocs(document);
        for(var j=0;j<d2.length;j++) ensureDebugBadge(d2[j]);
        console.log('[DocsCaret] DEBUG ->', DEBUG); e.preventDefault();
        return;
      }

      // Toggle red pointer
      if(e.code==='KeyP'){
        RED_POINTER_ENABLED = !RED_POINTER_ENABLED;
        console.log('[DocsCaret] Red Pointer ->', RED_POINTER_ENABLED);
        applyRedPointerAllDocs();
        e.preventDefault();
        return;
      }

      // Shrink pointer size
      if(e.code==='Minus' || e.code==='NumpadSubtract'){
        RED_POINTER_PIXEL_SIZE = Math.max(POINTER_MIN, RED_POINTER_PIXEL_SIZE - POINTER_STEP);
        console.log('[DocsCaret] Pointer size ->', RED_POINTER_PIXEL_SIZE);
        applyRedPointerAllDocs();
        e.preventDefault();
        return;
      }

      // Grow pointer size
      if(e.code==='Equal' || e.code==='NumpadAdd'){
        RED_POINTER_PIXEL_SIZE = Math.min(POINTER_MAX, RED_POINTER_PIXEL_SIZE + POINTER_STEP);
        console.log('[DocsCaret] Pointer size ->', RED_POINTER_PIXEL_SIZE);
        applyRedPointerAllDocs();
        e.preventDefault();
        return;
      }

      // Quick preset tiny pointer
      if(e.code==='Digit9'){
        RED_POINTER_PIXEL_SIZE = POINTER_TINY_PRESET;
        console.log('[DocsCaret] Pointer size preset ->', RED_POINTER_PIXEL_SIZE);
        applyRedPointerAllDocs();
        e.preventDefault();
        return;
      }
    }, true);
  }

  // =========================
  // ========= INIT ==========
  // =========================
  (function initAll(){
    var docs=getAllDocs(document);
    for(var i=0;i<docs.length;i++){
      ensureCaretForDoc(docs[i]);
      applyRedPointerToDoc(docs[i]);
    }

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
              }
            }catch(e){}
          } else if(n && n.querySelectorAll){
            var nested=n.querySelectorAll('iframe');
            for(var k=0;k<nested.length;k++){
              try{
                if(nested[k].contentDocument){
                  ensureCaretForDoc(nested[k].contentDocument);
                  applyRedPointerToDoc(nested[k].contentDocument);
                }
              }catch(e){}
            }
          }
        }
      }
    });
    try{ mo.observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}

    updateCaretPositionGlobal('init');
    setInterval(applyRedPointerAllDocs, 2000);
    installHotkeys();
  })();

})();
