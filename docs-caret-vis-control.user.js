// ==UserScript==
// @name         Google Docs High-Contrast Red Caret + Red Pointer (overlay, v1.9 HOTKEY toggle)
// @namespace    https://carethelp.example
// @version      1.9
// @description  Bright red overlay caret + optional red mouse pointer in Google Docs. Skips bogus about:blank frames, ignores zero rects, and includes deep debug logging. HOTKEYS master toggle included.
// @author       https://github.com/IanWardell/
// @homepageURL  https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs
// @supportURL   https://github.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/issues
// @license      MIT
// @match        https://docs.google.com/document/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret-vis-control.user.js
// @updateURL    https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret-vis-control.user.js
// @require      https://raw.githubusercontent.com/IanWardell/TamperMonkey-Red-Cursor-Google-Docs/main/pointer-caret-color-vis-control.js
// ==/UserScript==

/*
  This is a lightweight installer stub. The full implementation lives in:
  pointer-caret-color-vis-control.js (loaded via @require above).

  To install from GitHub:
  - Open the Raw view of docs-caret-vis-control.user.js
  - Tampermonkey will prompt to install or update automatically
  - Updates will be fetched from the same Raw URL
*/
