// storage.js — load/save routines, history, settings to localStorage.
// Seeds presets on first run (key 'ptimer_seeded' absent).

import { PRESET_ROUTINES, PRESET_GROUPS } from './presets.js';

const KEYS = {
  routines: 'ptimer_routines',
  history:  'ptimer_history',
  settings: 'ptimer_settings',
  seeded:   'ptimer_seeded',
  groups:   'ptimer_groups',
  cloud:    'ptimer_cloud',    // gist token + id — NOT part of the synced snapshot
  updated:  'ptimer_updated',  // last local-change timestamp (ms), for last-write-wins
};

// Keys whose writes represent user data and should trigger a cloud push.
const SYNCED = new Set([KEYS.routines, KEYS.history, KEYS.settings, KEYS.groups]);

let changeListener = null;   // set by cloud layer to schedule a push
let notifySuspended = false; // true while applying a remote snapshot

// Register a callback fired after any local data change (for cloud sync).
export function onDataChange(fn) { changeListener = fn; }

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
  if (SYNCED.has(key) && !notifySuspended) {
    localStorage.setItem(KEYS.updated, String(Date.now()));
    changeListener?.();
  }
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

// ── Cloud sync support ────────────────────────────────────────────────────────

export function getLocalUpdated() {
  return Number(localStorage.getItem(KEYS.updated)) || 0;
}

// Full user-data snapshot pushed to / pulled from the cloud (token excluded).
export function snapshot() {
  return {
    version:   1,
    updatedAt: getLocalUpdated(),
    routines:  getRoutines(),
    groups:    getGroups(),
    settings:  read(KEYS.settings, {}),
    history:   getHistory(),
  };
}

// Apply a remote snapshot without re-triggering a push (suspend the notifier).
export function restoreSnapshot(data) {
  notifySuspended = true;
  try {
    if (Array.isArray(data.routines)) write(KEYS.routines, data.routines);
    if (Array.isArray(data.groups))   write(KEYS.groups,   data.groups);
    if (Array.isArray(data.history))  write(KEYS.history,  data.history);
    if (data.settings && typeof data.settings === 'object') write(KEYS.settings, data.settings);
    localStorage.setItem(KEYS.updated, String(data.updatedAt || Date.now()));
    localStorage.setItem(KEYS.seeded, '1');
  } finally {
    notifySuspended = false;
  }
}

const DEFAULT_CLOUD = { token: '', gistId: '', enabled: false };

export function getCloudConfig() {
  return { ...DEFAULT_CLOUD, ...read(KEYS.cloud, {}) };
}

export function setCloudConfig(cfg) {
  localStorage.setItem(KEYS.cloud, JSON.stringify({ ...DEFAULT_CLOUD, ...cfg }));
}
