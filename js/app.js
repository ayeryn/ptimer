// app.js — State, rendering, screen wiring, wake lock, session logging.

import { seedIfNeeded, getRoutines, saveRoutine, deleteRoutine,
         getSettings, saveSettings, addSession, getHistory,
         clearHistory, newId } from './storage.js';
import { buildSchedule } from './schedule.js';
import { SessionEngine } from './engine.js';
import { CueEngine } from './cues.js';

// ── Boot ──────────────────────────────────────────────────────────────────────

seedIfNeeded();

let settings   = getSettings();
let cueEngine  = new CueEngine(settings);
let engine     = null;   // active SessionEngine
let wakeLock   = null;

// ── Screen router ─────────────────────────────────────────────────────────────

const screens = {
  list:     document.getElementById('screen-list'),
  player:   document.getElementById('screen-player'),
  editor:   document.getElementById('screen-editor'),
  exercise: document.getElementById('screen-exercise'),
  history:  document.getElementById('screen-history'),
  settings: document.getElementById('screen-settings'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name]?.classList.add('active');
  window.scrollTo(0, 0);
}

// ── Routine list ──────────────────────────────────────────────────────────────

function renderList() {
  const routines   = getRoutines();
  const container  = document.getElementById('routine-list');
  container.innerHTML = '';

  if (routines.length === 0) {
    container.innerHTML = '<p class="empty">No routines yet. Tap + to create one.</p>';
    return;
  }

  routines.forEach(r => {
    const card = document.createElement('div');
    card.className = 'routine-card';

    const est = estimateDuration(r);
    card.innerHTML = `
      <div class="card-main">
        <span class="card-name">${esc(r.name)}</span>
        <span class="card-meta">${esc(r.note ?? '')} · ${est}</span>
      </div>
      <div class="card-actions">
        <button class="btn-start" data-id="${r.id}">Start</button>
        <button class="btn-edit" data-id="${r.id}" aria-label="Edit ${esc(r.name)}">✏️</button>
        <button class="btn-delete" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">🗑</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function estimateDuration(routine) {
  let secs = 0;
  (routine.exercises ?? []).forEach(ex => {
    if (ex.type === 'hold') {
      secs += ex.sets * ex.holdDuration;
    } else {
      const repTarget = Array.isArray(ex.repTarget) ? ex.repTarget[1] : ex.repTarget;
      const perRep    = (ex.tempo?.out ?? 2) + (ex.tempo?.hold ?? 1) + (ex.tempo?.return ?? 3);
      secs += ex.sets * repTarget * perRep;
    }
    secs += (ex.sets - 1) * (ex.rest ?? 30);
  });
  secs *= (routine.repeat ?? 1);
  if (secs < 60) return `~${secs}s`;
  return `~${Math.round(secs / 60)} min`;
}

document.getElementById('routine-list').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains('btn-start')) startSession(id);
  if (btn.classList.contains('btn-edit'))  openEditor(id);
  if (btn.classList.contains('btn-delete')) {
    if (confirm('Delete this routine?')) {
      deleteRoutine(id);
      renderList();
    }
  }
});

document.getElementById('btn-new-routine').addEventListener('click', () => openEditor(null));
document.getElementById('btn-history').addEventListener('click', () => { renderHistory(); showScreen('history'); });
document.getElementById('btn-settings').addEventListener('click', () => { renderSettings(); showScreen('settings'); });

// ── Session player ────────────────────────────────────────────────────────────

let activeSchedule = [];
let activeRoutine  = null;

async function startSession(routineId) {
  const routine = getRoutines().find(r => r.id === routineId);
  if (!routine) return;

  activeRoutine  = routine;
  activeSchedule = buildSchedule(routine);

  // Unlock audio on this gesture
  cueEngine.unlock();

  // Wake lock
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* graceful degradation */ }

  showScreen('player');
  renderPlayerHeader(routine);
  resetPlayerUI();

  engine = new SessionEngine(activeSchedule, {
    onPhaseStart: (phase, idx) => {
      cueEngine.onPhaseStart(phase);
      renderPhase(phase, idx);
    },
    onTick: (remaining, phase, idx) => {
      cueEngine.onTick(remaining, phase);
      updateCountdown(remaining, phase);
    },
    onDone: (stats) => {
      logSession(routine, stats);
    },
    onEnd: (stats) => {
      releaseWakeLock();
      showDoneOverlay(stats);
    },
  });

  engine.start();
}

// Re-acquire wake lock when visibility changes back
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && engine && !engine.isPaused) {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* ok */ }
  }
});

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ── Player render ─────────────────────────────────────────────────────────────

function renderPlayerHeader(routine) {
  document.getElementById('player-routine-name').textContent = routine.name;
  document.getElementById('player-global-cue').textContent   = settings.globalCue;
}

function resetPlayerUI() {
  document.getElementById('player-phase-label').textContent   = '';
  document.getElementById('player-sub-label').textContent     = '';
  document.getElementById('player-exercise-name').textContent = '';
  document.getElementById('player-exercise-cue').textContent  = '';
  document.getElementById('player-countdown').textContent     = '';
  setRingProgress(0);
  hideDoneOverlay();
}

function renderPhase(phase, idx) {
  const visual = settings.visual;

  const phaseEl = document.getElementById('player-phase-label');
  const subEl   = document.getElementById('player-sub-label');
  const exEl    = document.getElementById('player-exercise-name');
  const cueEl   = document.getElementById('player-exercise-cue');

  if (visual) {
    phaseEl.textContent = phase.label;
    subEl.textContent   = phase.subLabel ?? '';
    exEl.textContent    = phase.exerciseName ?? '';
    cueEl.textContent   = phase.cue ?? '';
  }

  // Color coding for phase
  const playerEl = document.getElementById('screen-player');
  playerEl.className = 'screen active phase-' + (phase.type?.replace(':', '-') ?? 'default');
}

function updateCountdown(remaining, phase) {
  if (!settings.visual) return;
  const el = document.getElementById('player-countdown');
  el.textContent = Math.ceil(remaining);

  // Ring: progress = elapsed / total
  const total   = phase.duration;
  const elapsed = total - remaining;
  const pct     = total > 0 ? elapsed / total : 0;
  setRingProgress(pct);
}

function setRingProgress(pct) {
  const ring   = document.getElementById('progress-ring-fill');
  if (!ring) return;
  const r      = 80;
  const circ   = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, Math.max(0, pct)));
  ring.style.strokeDashoffset = offset;
}

function showDoneOverlay(stats) {
  const overlay = document.getElementById('player-done-overlay');
  if (overlay) overlay.classList.remove('hidden');
  const msg = document.getElementById('player-done-msg');
  if (msg) msg.textContent = `${stats.setsCompleted} sets done 💪`;
}

function hideDoneOverlay() {
  const overlay = document.getElementById('player-done-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// Player controls
document.getElementById('btn-pause').addEventListener('click', () => {
  if (!engine) return;
  if (engine.isPaused) {
    engine.resume();
    document.getElementById('btn-pause').textContent = 'Pause';
  } else {
    engine.pause();
    document.getElementById('btn-pause').textContent = 'Resume';
  }
});

document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  if (!engine || !screens.player.classList.contains('active')) return;
  e.preventDefault();
  document.getElementById('btn-pause').click();
});

document.getElementById('btn-end-set').addEventListener('click', () => engine?.endSetEarly());
document.getElementById('btn-skip-ex').addEventListener('click', () => engine?.skipExercise());

document.getElementById('btn-end-session').addEventListener('click', () => {
  if (confirm('End this session?')) {
    engine?.endSession();
  }
});

document.getElementById('btn-mute').addEventListener('click', () => {
  settings.voice = !settings.voice;
  settings.beeps = !settings.beeps;
  cueEngine.updateSettings(settings);
  document.getElementById('btn-mute').textContent = (settings.voice || settings.beeps) ? 'Mute' : 'Unmute';
  saveSettings(settings);
});

document.getElementById('btn-player-back').addEventListener('click', () => {
  if (engine && !engine._ended) {
    if (!confirm('End session and go back?')) return;
    engine.endSession();
  }
  releaseWakeLock();
  showScreen('list');
  renderList();
});

document.getElementById('btn-done-back').addEventListener('click', () => {
  releaseWakeLock();
  showScreen('list');
  renderList();
});

// ── Session logging ───────────────────────────────────────────────────────────

function logSession(routine, stats) {
  addSession({
    id:                   newId('sess'),
    routineId:            routine.id,
    routineName:          routine.name,
    startedAt:            stats.startedAt,
    completedAt:          stats.endedAt,
    setsCompleted:        stats.setsCompleted,
    exercisesCompleted:   stats.exercisesCompleted,
  });
}

// ── Routine editor ────────────────────────────────────────────────────────────

let editingRoutine = null;  // deep copy of routine being edited

function openEditor(routineId) {
  if (routineId) {
    const r = getRoutines().find(r => r.id === routineId);
    editingRoutine = JSON.parse(JSON.stringify(r)); // deep copy
  } else {
    editingRoutine = {
      id:       newId('rtn'),
      name:     '',
      note:     '',
      repeat:   1,
      exercises: [],
    };
  }
  renderEditor();
  showScreen('editor');
}

function renderEditor() {
  document.getElementById('editor-name').value    = editingRoutine.name;
  document.getElementById('editor-note').value    = editingRoutine.note ?? '';
  document.getElementById('editor-repeat').value  = editingRoutine.repeat ?? 1;

  const list = document.getElementById('editor-exercise-list');
  list.innerHTML = '';
  editingRoutine.exercises.forEach((ex, i) => {
    const item = document.createElement('div');
    item.className = 'editor-ex-item';
    item.innerHTML = `
      <span class="ex-name">${esc(ex.name || 'Unnamed')}</span>
      <span class="ex-meta">${exSummary(ex)}</span>
      <button class="btn-ex-edit" data-idx="${i}">Edit</button>
      <button class="btn-ex-up"   data-idx="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn-ex-down" data-idx="${i}" ${i === editingRoutine.exercises.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn-ex-del"  data-idx="${i}">✕</button>
    `;
    list.appendChild(item);
  });
}

function exSummary(ex) {
  if (ex.type === 'hold') {
    return `Hold · ${ex.sets}×${ex.holdDuration}s`;
  }
  const rep = Array.isArray(ex.repTarget) ? ex.repTarget.join('–') : ex.repTarget;
  return `${ex.sets}×${rep} reps · ${ex.tempo?.out}/${ex.tempo?.hold}/${ex.tempo?.return}`;
}

document.getElementById('editor-exercise-list').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const exs = editingRoutine.exercises;

  if (btn.classList.contains('btn-ex-edit'))  openExerciseEditor(idx);
  if (btn.classList.contains('btn-ex-del'))  { exs.splice(idx, 1); renderEditor(); }
  if (btn.classList.contains('btn-ex-up'))   { [exs[idx-1], exs[idx]] = [exs[idx], exs[idx-1]]; renderEditor(); }
  if (btn.classList.contains('btn-ex-down')) { [exs[idx], exs[idx+1]] = [exs[idx+1], exs[idx]]; renderEditor(); }
});

document.getElementById('btn-add-exercise').addEventListener('click', () => {
  openExerciseEditor(null);
});

document.getElementById('btn-save-routine').addEventListener('click', () => {
  editingRoutine.name   = document.getElementById('editor-name').value.trim() || 'Untitled';
  editingRoutine.note   = document.getElementById('editor-note').value.trim();
  editingRoutine.repeat = parseInt(document.getElementById('editor-repeat').value) || 1;
  saveRoutine(editingRoutine);
  showScreen('list');
  renderList();
});

document.getElementById('btn-cancel-routine').addEventListener('click', () => {
  showScreen('list');
  renderList();
});

// ── Exercise editor ───────────────────────────────────────────────────────────

let editingExIdx = null;

function syncEditorFields() {
  editingRoutine.name   = document.getElementById('editor-name').value.trim() || editingRoutine.name;
  editingRoutine.note   = document.getElementById('editor-note').value.trim();
  editingRoutine.repeat = parseInt(document.getElementById('editor-repeat').value) || 1;
}

function openExerciseEditor(exIdx) {
  syncEditorFields();
  editingExIdx = exIdx;
  let ex;
  if (exIdx !== null && exIdx < editingRoutine.exercises.length) {
    ex = JSON.parse(JSON.stringify(editingRoutine.exercises[exIdx]));
  } else {
    ex = {
      id:        newId('ex'),
      name:      '',
      type:      'reps',
      load:      '',
      sets:      3,
      repTarget: [12, 15],
      tempo:     { out: 2, hold: 2, return: 3 },
      rest:      40,
      holdDuration: 20,
      cue:       '',
    };
  }
  populateExEditor(ex);
  showScreen('exercise');
}

function populateExEditor(ex) {
  document.getElementById('ex-name').value     = ex.name;
  document.getElementById('ex-load').value     = ex.load ?? '';
  document.getElementById('ex-sets').value     = ex.sets;
  document.getElementById('ex-rest').value     = ex.rest;
  document.getElementById('ex-cue').value      = ex.cue ?? '';

  const isReps = ex.type === 'reps';
  document.getElementById('ex-type-reps').checked = isReps;
  document.getElementById('ex-type-hold').checked = !isReps;

  // Rep fields
  const rt = Array.isArray(ex.repTarget) ? ex.repTarget : [ex.repTarget, ex.repTarget];
  document.getElementById('ex-rep-min').value    = rt[0];
  document.getElementById('ex-rep-max').value    = rt[1];
  document.getElementById('ex-tempo-out').value  = ex.tempo?.out ?? 2;
  document.getElementById('ex-tempo-hold').value = ex.tempo?.hold ?? 2;
  document.getElementById('ex-tempo-return').value = ex.tempo?.return ?? 3;

  // Hold fields
  document.getElementById('ex-hold-duration').value = ex.holdDuration ?? 20;

  toggleExFields(isReps);
}

function toggleExFields(isReps) {
  document.getElementById('ex-reps-fields').classList.toggle('hidden', !isReps);
  document.getElementById('ex-hold-fields').classList.toggle('hidden', isReps);
}

document.querySelectorAll('input[name="ex-type"]').forEach(radio => {
  radio.addEventListener('change', () => {
    toggleExFields(document.getElementById('ex-type-reps').checked);
  });
});

document.getElementById('btn-save-exercise').addEventListener('click', () => {
  const isReps = document.getElementById('ex-type-reps').checked;
  const ex = {
    id:           editingExIdx !== null ? editingRoutine.exercises[editingExIdx]?.id ?? newId('ex') : newId('ex'),
    name:         document.getElementById('ex-name').value.trim() || 'Unnamed',
    type:         isReps ? 'reps' : 'hold',
    load:         document.getElementById('ex-load').value.trim() || null,
    sets:         parseInt(document.getElementById('ex-sets').value) || 3,
    rest:         parseInt(document.getElementById('ex-rest').value) || 40,
    cue:          document.getElementById('ex-cue').value.trim() || null,
    // reps
    repTarget:    [
      parseInt(document.getElementById('ex-rep-min').value) || 12,
      parseInt(document.getElementById('ex-rep-max').value) || 15,
    ],
    tempo: {
      out:    parseFloat(document.getElementById('ex-tempo-out').value) || 2,
      hold:   parseFloat(document.getElementById('ex-tempo-hold').value) || 2,
      return: parseFloat(document.getElementById('ex-tempo-return').value) || 3,
    },
    // hold
    holdDuration: parseInt(document.getElementById('ex-hold-duration').value) || 20,
  };

  if (editingExIdx !== null && editingExIdx < editingRoutine.exercises.length) {
    editingRoutine.exercises[editingExIdx] = ex;
  } else {
    editingRoutine.exercises.push(ex);
  }
  renderEditor();
  showScreen('editor');
});

document.getElementById('btn-cancel-exercise').addEventListener('click', () => {
  showScreen('editor');
});

// ── History ───────────────────────────────────────────────────────────────────

function renderHistory() {
  const history = getHistory();
  const list    = document.getElementById('history-list');
  list.innerHTML = '';

  if (history.length === 0) {
    list.innerHTML = '<p class="empty">No sessions yet.</p>';
    return;
  }

  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const date = new Date(entry.startedAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    item.innerHTML = `
      <span class="h-name">${esc(entry.routineName)}</span>
      <span class="h-meta">${dateStr} ${timeStr} · ${entry.setsCompleted} sets</span>
    `;
    list.appendChild(item);
  });
}

document.getElementById('btn-clear-history').addEventListener('click', () => {
  if (confirm('Clear all history?')) {
    clearHistory();
    renderHistory();
  }
});

document.getElementById('btn-history-back').addEventListener('click', () => {
  showScreen('list');
  renderList();
});

// ── Settings ──────────────────────────────────────────────────────────────────

function renderSettings() {
  document.getElementById('setting-voice').checked    = settings.voice;
  document.getElementById('setting-beeps').checked    = settings.beeps;
  document.getElementById('setting-visual').checked   = settings.visual;
  document.getElementById('setting-global-cue').value = settings.globalCue;
  document.getElementById('setting-voice-rate').value = settings.voiceRate ?? 1.0;
}

document.getElementById('btn-save-settings').addEventListener('click', () => {
  settings.voice     = document.getElementById('setting-voice').checked;
  settings.beeps     = document.getElementById('setting-beeps').checked;
  settings.visual    = document.getElementById('setting-visual').checked;
  settings.globalCue = document.getElementById('setting-global-cue').value.trim() || 'Blades back and down — no shrug.';
  settings.voiceRate = parseFloat(document.getElementById('setting-voice-rate').value) || 1.0;
  saveSettings(settings);
  cueEngine.updateSettings(settings);
  showScreen('list');
  renderList();
});

document.getElementById('btn-settings-back').addEventListener('click', () => showScreen('list'));

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Service worker registration ───────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Graceful degradation — app works without SW (localhost / no HTTPS)
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

renderList();
showScreen('list');
