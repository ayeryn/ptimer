// storage.js — load/save routines, history, settings to localStorage.
// Seeds presets on first run (key 'ptimer_seeded' absent).

import { PRESET_ROUTINES } from './presets.js';

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
    localStorage.setItem(KEYS.seeded, '1');
    return;
  }
  
  // Migration/update: check if the Deadlift routine exists in localStorage
  const routines = getRoutines();
  const deadliftIdx = routines.findIndex(r => r.id === 'preset-deadlift');
  if (deadliftIdx >= 0) {
    // 1. If it exists but does not have all 3 exercises, update/overwrite it.
    if ((routines[deadliftIdx].exercises ?? []).length < 3) {
      const deadliftPreset = PRESET_ROUTINES.find(r => r.id === 'preset-deadlift');
      if (deadliftPreset) {
        routines[deadliftIdx] = deadliftPreset;
      }
    }
    // 2. Relocate to the beginning (index 0) to match its position in presets.js
    if (deadliftIdx > 0) {
      const [deadliftRoutine] = routines.splice(deadliftIdx, 1);
      routines.unshift(deadliftRoutine);
    }
    saveRoutines(routines);
  } else {
    // If it does not exist at all, prepend it.
    const deadliftPreset = PRESET_ROUTINES.find(r => r.id === 'preset-deadlift');
    if (deadliftPreset) {
      routines.unshift(deadliftPreset);
      saveRoutines(routines);
    }
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
