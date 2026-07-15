// cloud.js — optional GitHub Gist sync for routines/groups/settings/history.
//
// A private gist holds one JSON file (the full local snapshot). The token and
// gist id live in the `ptimer_cloud` localStorage key, which is NOT part of the
// synced snapshot — the token never leaves the device inside the gist.
//
// Conflict policy: last-write-wins by `updatedAt` timestamp.

import { snapshot, restoreSnapshot, getLocalUpdated,
         getCloudConfig, setCloudConfig } from './storage.js';

const FILE = 'ptimer-data.json';
const API  = 'https://api.github.com/gists';

function headers(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept':        'application/vnd.github+json',
    'Content-Type':  'application/json',
  };
}

export function isConfigured() {
  const c = getCloudConfig();
  return !!(c.enabled && c.token);
}

// ── Status broadcasting ───────────────────────────────────────────────────────

let statusCb = null;
export function setStatusHandler(fn) { statusCb = fn; }
function status(msg, kind) { statusCb?.(msg, kind); }

// ── Raw API ───────────────────────────────────────────────────────────────────

export async function pull() {
  const c = getCloudConfig();
  if (!c.token)  throw new Error('no token');
  if (!c.gistId) throw new Error('no gist id');

  const res = await fetch(`${API}/${c.gistId}`, { headers: headers(c.token) });
  if (!res.ok) throw new Error(`pull ${res.status}`);
  const gist = await res.json();

  const file = gist.files?.[FILE];
  if (!file) throw new Error('gist missing data file');

  // GitHub truncates file content >1MB; fetch raw_url in that case.
  const content = file.truncated && file.raw_url
    ? await (await fetch(file.raw_url)).text()
    : file.content;

  return JSON.parse(content);
}

export async function push() {
  const c = getCloudConfig();
  if (!c.token) throw new Error('no token');

  const body = JSON.stringify({
    description: 'Posture Timer data',
    public: false,
    files: { [FILE]: { content: JSON.stringify(snapshot(), null, 2) } },
  });

  const res = c.gistId
    ? await fetch(`${API}/${c.gistId}`, { method: 'PATCH', headers: headers(c.token), body })
    : await fetch(API,                  { method: 'POST',  headers: headers(c.token), body });
  if (!res.ok) throw new Error(`push ${res.status}`);

  const gist = await res.json();
  if (!c.gistId) { c.gistId = gist.id; setCloudConfig(c); }
  return gist.id;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

let pushTimer = null;

// Debounced auto-push — called on every local data change.
export function schedulePush() {
  if (!isConfigured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { status('Syncing…'); await push(); status('Synced ✓', 'ok'); }
    catch (e) { status(`Sync failed: ${e.message}`, 'err'); }
  }, 2000);
}

// Boot reconcile: pull remote, apply if newer; else push local up.
// `onRemoteApplied` fires only when remote data replaced local (re-render hook).
export async function syncOnBoot(onRemoteApplied) {
  if (!isConfigured()) return;
  const c = getCloudConfig();

  if (!c.gistId) {
    // First run: seed the gist from local.
    try { status('Creating cloud backup…'); await push(); status('Synced ✓', 'ok'); }
    catch (e) { status(`Sync failed: ${e.message}`, 'err'); }
    return;
  }

  try {
    status('Checking cloud…');
    const remote = await pull();
    const rTs = remote.updatedAt || 0;
    const lTs = getLocalUpdated();

    if (rTs > lTs) {
      restoreSnapshot(remote);
      onRemoteApplied?.();
      status('Pulled latest ✓', 'ok');
    } else if (rTs < lTs) {
      await push();
      status('Synced ✓', 'ok');
    } else {
      status('Up to date ✓', 'ok');
    }
  } catch (e) {
    status(`Sync failed: ${e.message}`, 'err');
  }
}

// Manual pull triggered from settings; returns true if local was replaced.
export async function pullNow(onRemoteApplied) {
  status('Pulling…');
  const remote = await pull();
  restoreSnapshot(remote);
  onRemoteApplied?.();
  status('Pulled ✓', 'ok');
  return true;
}

export async function pushNow() {
  status('Pushing…');
  await push();
  status('Pushed ✓', 'ok');
}
