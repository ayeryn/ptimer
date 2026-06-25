// storage.js — load/save routines, history, settings to localStorage.
// Seeds presets on first run (key 'ptimer_seeded' absent).

import { PRESET_ROUTINES } from './presets.js';

const KEYS = {
  routines: 'ptimer_routines',
  history:  'ptimer_history',
  settings: 'ptimer_settings',
  seeded:   'ptimer_seeded',
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
  if (localStorage.getItem(KEYS.seeded)) return;
  write(KEYS.routines, PRESET_ROUTINES);
  localStorage.setItem(KEYS.seeded, '1');
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
