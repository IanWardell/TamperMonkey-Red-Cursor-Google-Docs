// ==UserScript==
// @name         High-Contrast Customizable Color Caret & Pointer
// @namespace    https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs
// @version      1.0.0
// @description  Default red overlay caret + mouse pointer with customizable color and size built for use in Google Docs. With control panel and settings persistence. Includes optional debug logging. HOTKEYS master toggle included.
// @author       https://github.com/IanWardell/
// @homepageURL  https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs
// @supportURL   https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/issues
// @license      MIT
// @match        https://docs.google.com/document/d/*
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret-vis-control.user.js
// @updateURL    https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret-vis-control.user.js
// @require      https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/pointer-caret-color-vis-control.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// ==/UserScript==

/*
  Lightweight installer/tray stub.
  - Exposes a GM-backed storage adapter for the core (which adopts it lazily).
  - Adds a Tampermonkey tray menu for quick actions.
*/

(function () {
  'use strict';

  // GM-backed storage adapter the core will adopt when ready.
  // (The core polls window.__DocsCaretStorage and switches over automatically.)
  window.__DocsCaretStorage = {
    get: function (key, defVal) {
      try { return GM_getValue(key, defVal); } catch (_) { return defVal; }
    },
    set: function (key, value) {
      try { GM_setValue(key, value); } catch (_) {}
    },
    onChange: function (key, cb) {
      try {
        GM_addValueChangeListener(key, function (_name, oldVal, newVal, remote) {
          // Only forward cross-tab changes; local writes are already applied by the core.
          if (!remote) return;
          cb(newVal, oldVal);
        });
      } catch (_) {}
    }
  };

  // Tiny helper to wait for the core API
  function whenReady(cb) {
    var tries = 0, h = setInterval(function () {
      if (window.DocsCaret) { clearInterval(h); cb(window.DocsCaret); }
      else if (++tries > 200) { clearInterval(h); } // ~10s
    }, 50);
  }

  // Register tray menu once the core is live
  whenReady(function (api) {
    try { GM_registerMenuCommand('Open Controls (Ctrl+Alt+O)',     api.openPanel); } catch (_) {}
    try { GM_registerMenuCommand('Toggle Caret Overlay (Ctrl+Alt+C)', api.toggleCaret, 'c'); } catch (_) {}
    try { GM_registerMenuCommand('Toggle Red Pointer (Ctrl+Alt+P)',  api.togglePointer, 'p'); } catch (_) {}
    try { GM_registerMenuCommand('Reset to Defaults (Ctrl+Alt+9)', api.resetDefaults); } catch (_) {}
    try { GM_registerMenuCommand('Toggle Console Debug',          api.toggleDebug); } catch (_) {}
  });
})();
