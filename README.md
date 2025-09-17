# TamperMonkey-Red-Cursor-Google-Docs

A lightweight TamperMonkey userscript that makes the text caret (blinking cursor) bright red in Google Docs for improved visibility.  
Optionally, it can also replace the mouse pointer with a red arrow for better contrast.

## Features
- High-contrast red caret overlay in Google Docs
- Optional red mouse pointer (with adjustable size)
- Works inside Docs iframes
- Full debug logging (toggleable)
- Hotkeys (fully disableable with one switch)
- Configurable via script variables:
  - `CARET_COLOR` – caret color (default: `#ff0000`)
  - `CARET_WIDTH` – caret width in pixels
  - `CARET_BLINKMS` – blink speed
  - `HOLD_LAST_MS` – keep caret visible briefly on selection flicker
  - `RED_POINTER_ENABLED` – toggle red pointer on/off
  - `RED_POINTER_FORCE_EVERYWHERE` – override I-beam everywhere (or keep I-beam in text fields)
  - `RED_POINTER_PIXEL_SIZE` – pointer nominal size (in pixels)
  - `HOTKEYS` – enable/disable hotkeys entirely

## Hotkeys (when `HOTKEYS = true`)
Use `Ctrl+Alt+` + key combinations:
- `C` – toggle caret overlay
- `D` – toggle debug logging
- `P` – toggle red pointer
- `- / +` – decrease / increase pointer size
- `9` – reset pointer size to a tiny preset

## Install
1. Install [TamperMonkey](https://www.tampermonkey.net/).
2. Open the **Raw** link to [`docs-caret.user.js`](https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/TamperMonkey-Red-Cursor-Google-Docs/main/docs-caret.user.js).  
   TamperMonkey will prompt to install/update automatically.
3. Reload any open Google Docs tabs.

## Files
- `docs-caret.user.js` — minimal userscript stub with metadata and `@require` to load the implementation
- `caret.js` — full userscript implementation
- `README.md`, `LICENSE`

## License
This project is licensed under the MIT License – see [LICENSE](./LICENSE).
