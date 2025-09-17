// ==UserScript==
// @name         High-Contrast Customizable Color Caret & Pointer
// @namespace    https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs
// @version      2.1.0
// @description  Default red overlay caret + mouse pointer with customizable color and size for Google Docs. Loads the core, persists via GM storage, syncs across tabs, and exposes a tray menu.
// @author       https://github.com/IanWardell/
// @homepageURL  https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs
// @supportURL   https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/issues
// @license      MIT
// @match        https://docs.google.com/document/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret-vis-control.user.js
// @updateURL    https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret-vis-control.user.js
// @require      https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/pointer-caret-color-vis-control.js
// ==/UserScript==
/*
  This is the loader stub. It supplies a GM_* storage adapter at runtime,
  asks the core to adopt it (with migration), and registers a tray menu.
*/
/* eslint-disable no-undef */
(function () {
  'use strict';

  // Provide a storage adapter the core can use (GM_* backed + cross-tab change notifications)
  // We set this at document-start *before* most of the page runs; the core tolerates late adoption.
  window.__DocsCaretStorage = {
    get: function(key, defVal){ try { return GM_getValue(key, defVal); } catch(_) { return defVal; } },
    set: function(key, value){ try { GM_setValue(key, value); } catch(_) {} },
    onChange: function(key, cb){
      try {
        GM_addValueChangeListener(key, function(_name, oldVal, newVal, remote){
          if (!remote) return; // ignore same-tab writes
          try { cb(newVal, oldVal); } catch(_) {}
        });
      } catch(_) {}
    }
  };

  // Ask the core to adopt our adapter as soon as its API appears
  function whenReady(cb){
    var tries = 0, t = setInterval(function(){
      if (window.DocsCaret && typeof window.DocsCaret.useStorageAdapter === 'function') { clearInterval(t); cb(window.DocsCaret); }
      else if (++tries > 200) { clearInterval(t); } // ~10s
    }, 50);
  }

  whenReady(function(api){
    try { api.useStorageAdapter(window.__DocsCaretStorage); } catch(_){}

    // Tray menu (hotkeys still work)
    GM_registerMenuCommand('Open Controls (Ctrl+Alt+O)',        api.openPanel,    'o');
    GM_registerMenuCommand('Toggle Caret Overlay (Ctrl+Alt+C)', api.toggleCaret,  'c');
    GM_registerMenuCommand('Toggle Red Pointer (Ctrl+Alt+P)',   api.togglePointer,'p');
    GM_registerMenuCommand('Reset to Defaults (Ctrl+Alt+9)',    api.resetDefaults,'9');
    GM_registerMenuCommand('Toggle Debug Badge (Ctrl+Alt+D)',   api.toggleDebug,  'd');
  });
})();
