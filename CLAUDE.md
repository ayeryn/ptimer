# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Posture Timer is a zero-build PWA — plain HTML/CSS/ES modules, no bundler, no npm. Serve it with any static file server and open it in a browser. `npx serve .` or `python3 -m http.server` both work; the service worker requires HTTPS or localhost.

## Running locally

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080`. The service worker caches all assets for offline use — after first load, it works without a server.

## Architecture

The app is a single-page multi-screen PWA. All state (routines, history, settings) lives in `localStorage` under the `ptimer_*` keys defined in `storage.js`.

**Data flow:**
1. `storage.js` — pure CRUD over localStorage; seeds preset routines on first run via `presets.js`
2. `schedule.js` — pure function `buildSchedule(routine)` → flat ordered array of phase objects (no side effects, no DOM); also exports `findEndSetEarlyTarget` / `findSkipExerciseTarget` for jump navigation
3. `engine.js` — `SessionEngine` consumes a schedule and drives a drift-corrected `setTimeout` tick loop at ~250ms; fires callbacks (`onPhaseStart`, `onTick`, `onDone`, `onEnd`); no DOM access
4. `cues.js` — `CueEngine` handles Web Audio beeps + SpeechSynthesis voice cues; must be unlocked by a user gesture before use; both channels independently togglable via settings
5. `app.js` — wires everything together: screen routing, rendering, event listeners, wake lock, session logging

**Screen model:** six `<section>` elements with the `.active` class toggled by `showScreen(name)`. No routing library.

**Phase types** emitted by `schedule.js`: `get-ready`, `rep:out`, `rep:hold`, `rep:return`, `hold`, `rest`, `done`. The player colors each phase via `phase-<type>` CSS classes on `#screen-player`.

## Service worker cache

The SW uses a cache-first strategy (`ptimer-v1`). When adding new JS/CSS files, add them to the `ASSETS` array in `sw.js` and bump `CACHE_NAME` to bust stale caches.

## Testing schedule logic

`schedule.js` includes a `selfTest()` export. Run it in the browser console or Node:

```js
import { selfTest } from './js/schedule.js';
selfTest();
```
