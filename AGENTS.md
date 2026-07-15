# Repository Guidelines

## Project Structure & Module Organization

Posture Timer is a zero-build progressive web app: plain HTML, CSS, and browser ES modules. `index.html` defines the six application screens and loads `styles.css` plus `js/app.js`. Keep UI wiring and rendering in `js/app.js`; keep domain logic separate: `js/schedule.js` builds the phase schedule, `js/engine.js` runs timed sessions, `js/cues.js` handles audio and speech, and `js/storage.js` owns `localStorage` persistence. Default routines live in `js/presets.js`. PWA metadata and offline behavior are in `manifest.webmanifest`, `sw.js`, and `icons/`.

## Build, Test, and Development Commands

There is no package manager, bundler, or build step. Serve the repository from its root:

```bash
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. Use localhost (or HTTPS) so the service worker can register. For schedule changes, run `selfTest()` from the browser console after loading the app:

```js
import('./js/schedule.js').then(({ selfTest }) => selfTest());
```

Manually verify routine editing, session playback, settings, history, and offline reloads for UI or persistence changes.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: two-space indentation, semicolons, single quotes, `camelCase` functions and variables, and `PascalCase` classes (for example, `SessionEngine`). Use named ES-module exports. Keep `schedule.js` and `engine.js` free of DOM access; let `app.js` bridge logic to the interface. Name CSS classes by role (`.screen`, `.btn-icon`) and phase styles as `phase-<type>`. Preserve the app’s accessible labels and mobile-first layout.

## Service Worker & Storage

When adding, renaming, or removing a runtime asset, update `ASSETS` in `sw.js` and increment `CACHE_NAME`; otherwise installed clients can retain stale files. Persist application data only through the functions and `ptimer_*` keys defined in `js/storage.js`. Consider migrations when changing stored routine, group, history, or settings shapes.

## Commit & Pull Request Guidelines

Use concise Conventional Commit-style subjects consistent with history: `feat: add timer control`, `fix: preserve group order`, or `refactor: simplify schedule logic`. Keep commits focused. Pull requests should describe user-visible behavior, list verification performed, link any relevant issue, and include screenshots or a short recording for visual changes. Call out service-worker cache bumps and storage migrations explicitly.
