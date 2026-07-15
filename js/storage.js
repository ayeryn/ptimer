// storage.js — load/save routines, history, settings to localStorage.
// Seeds presets on first run (key 'ptimer_seeded' absent).

import { PRESET_ROUTINES, PRESET_GROUPS } from './presets.js';

const KEYS = {
  routines: 'ptimer_routines',
  history:  'ptimer_history',
  settings: 'ptimer_settings',
  seeded:   'ptimer_seeded',
  groups:   'ptimer_groups',
};

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  voice:     true,
  beeps:     true,
  visual:    true,
  globalCue: 'Blades back and down — no shrug.',
  voiceRate: 1.0,
  theme:     'auto',   // 'auto' | 'light' | 'dark'
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Seed ─────────────────────────────────────────────────────────────────────

export function seedIfNeeded() {
  if (!localStorage.getItem(KEYS.seeded)) {
    write(KEYS.routines, PRESET_ROUTINES);
    write(KEYS.groups, PRESET_GROUPS);
    localStorage.setItem(KEYS.seeded, '1');
    return;
  }
  
  // Seed groups if empty
  if (getGroups().length === 0) {
    saveGroups(PRESET_GROUPS);
  }

  // Update built-ins with their preset group if it is absent or no longer exists.
  const routines = getRoutines();
  const groupIds = new Set(getGroups().map(group => group.id));
  let updated = false;

  routines.forEach(r => {
    const preset = PRESET_ROUTINES.find(pr => pr.id === r.id);
    if (preset && preset.groupId && groupIds.has(preset.groupId) && (!r.groupId || !groupIds.has(r.groupId))) {
      r.groupId = preset.groupId;
      updated = true;
    }
  });

  const deadliftIdx = routines.findIndex(r => r.id === 'preset-deadlift');
  if (deadliftIdx >= 0) {
    const legacyExerciseIds = ['ex-deadlift', 'ex-pull-through', 'ex-hip-hinge-iso'];
    const existingExerciseIds = (routines[deadliftIdx].exercises ?? []).map(exercise => exercise.id);
    if (legacyExerciseIds.every(id => existingExerciseIds.includes(id))) {
      const deadliftPreset = PRESET_ROUTINES.find(r => r.id === 'preset-deadlift');
      if (deadliftPreset) {
        routines[deadliftIdx] = deadliftPreset;
        updated = true;
      }
    }
  } else {
    // If it does not exist at all, prepend it.
    const deadliftPreset = PRESET_ROUTINES.find(r => r.id === 'preset-deadlift');
    if (deadliftPreset) {
      routines.unshift(deadliftPreset);
      updated = true;
    }
  }

  // Add newly introduced built-in routines without changing existing routines.
  ['preset-tricep-pulldown', 'preset-single-side-tricep-extension', 'preset-leg-kickback', 'preset-bulgarian-squat'].forEach(id => {
    if (routines.some(routine => routine.id === id)) return;
    const preset = PRESET_ROUTINES.find(routine => routine.id === id);
    if (preset) {
      routines.push(preset);
      updated = true;
    }
  });

  // Upgrade the original single-side preset so both arms receive timed sets.
  const singleSideIdx = routines.findIndex(routine => routine.id === 'preset-single-side-tricep-extension');
  if (singleSideIdx >= 0) {
    const exerciseIds = (routines[singleSideIdx].exercises ?? []).map(exercise => exercise.id);
    if (exerciseIds.length === 1 && exerciseIds[0] === 'ex-single-side-tricep-extension') {
      const preset = PRESET_ROUTINES.find(routine => routine.id === 'preset-single-side-tricep-extension');
      if (preset) {
        routines[singleSideIdx] = preset;
        updated = true;
      }
    }
  }

  if (updated) {
    saveRoutines(routines);
  }
}

// ── Routines ─────────────────────────────────────────────────────────────────

export function getRoutines() {
  return read(KEYS.routines, []);
}

export function saveRoutines(routines) {
  write(KEYS.routines, routines);
}

export function getRoutineById(id) {
  return getRoutines().find(r => r.id === id) ?? null;
}

export function saveRoutine(routine) {
  const routines = getRoutines();
  const idx = routines.findIndex(r => r.id === routine.id);
  if (idx >= 0) {
    routines[idx] = routine;
  } else {
    routines.push(routine);
  }
  saveRoutines(routines);
}

export function deleteRoutine(id) {
  saveRoutines(getRoutines().filter(r => r.id !== id));
}

// ── Groups ───────────────────────────────────────────────────────────────────

export function getGroups() {
  return read(KEYS.groups, []);
}

export function saveGroups(groups) {
  write(KEYS.groups, groups);
}

export function saveGroup(group) {
  const groups = getGroups();
  const idx = groups.findIndex(g => g.id === group.id);
  if (idx >= 0) {
    groups[idx] = group;
  } else {
    groups.push(group);
  }
  saveGroups(groups);
}

export function deleteGroup(id) {
  saveGroups(getGroups().filter(g => g.id !== id));
}

// ── History ──────────────────────────────────────────────────────────────────

export function getHistory() {
  return read(KEYS.history, []);
}

export function addSession(entry) {
  const history = getHistory();
  history.unshift(entry); // newest first
  write(KEYS.history, history);
}

export function clearHistory() {
  write(KEYS.history, []);
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(settings) {
  write(KEYS.settings, settings);
}

// ── ID generation ─────────────────────────────────────────────────────────────

export function newId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Storage-wipe diagnostics ───────────────────────────────────────────────────
// Goal: find out WHEN and HOW localStorage gets cleared. `installId` is written
// once and never changes — unless storage is wiped, in which case a new one is
// minted. So a changed installId after an app update === data was wiped. The
// boot log records each app launch so the history is visible on the phone.

const BOOT_LOG   = 'ptimer_boot_log';
const INSTALL_ID = 'ptimer_install_id';
const MAX_BOOTS  = 30;

// Call once on boot, AFTER seedIfNeeded(). Returns the recorded entry.
export function recordBoot() {
  let installId = localStorage.getItem(INSTALL_ID);
  const fresh = !installId;           // true on first-ever boot OR after a wipe
  if (fresh) {
    installId = newId('inst');
    localStorage.setItem(INSTALL_ID, installId);
  }

  const entry = {
    t:       Date.now(),
    fresh,                            // was a brand-new install id minted this boot?
    n:       getRoutines().length,    // routine count (drops to preset count on a wipe)
    install: installId,
  };

  const log = read(BOOT_LOG, []);
  log.unshift(entry);
  localStorage.setItem(BOOT_LOG, JSON.stringify(log.slice(0, MAX_BOOTS)));
  try { console.log('[ptimer] boot', entry); } catch {}
  return entry;
}

export function getInstallId() {
  return localStorage.getItem(INSTALL_ID) || '(none yet)';
}

export function getBootLog() {
  return read(BOOT_LOG, []);
}
