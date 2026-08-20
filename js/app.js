// app.js — State, rendering, screen wiring, wake lock, session logging.

import {
  seedIfNeeded,
  getRoutines,
  saveRoutine,
  saveRoutines,
  deleteRoutine,
  getGroups,
  saveGroups,
  saveGroup,
  deleteGroup,
  getSettings,
  saveSettings,
  addSession,
  getHistory,
  clearHistory,
  newId,
  recordBoot,
  getInstallId,
  getBootLog,
} from "./storage.js";
import { buildSchedule } from "./schedule.js";
import { SessionEngine } from "./engine.js";
import { CueEngine } from "./cues.js";

// ── Boot ──────────────────────────────────────────────────────────────────────

seedIfNeeded();
recordBoot(); // storage-wipe diagnostics (see storage.js)

let settings = getSettings();
let cueEngine = new CueEngine(settings);
let engine = null; // active SessionEngine
let wakeLock = null;

// Total-workout countup (excludes the get-ready countdown)
let workoutStartMs = null; // performance.now() when first real phase began
let workoutPauseMs = null; // performance.now() when paused, else null

// ── Theme ───────────────────────────────────────────────────────────────────
const THEME_COLORS = { light: "#f5f0eb", dark: "#171B21" };
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");

function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") return theme;
  return darkMQ.matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const resolved = resolveTheme(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = resolved === "dark" ? "☀️" : "🌙";
}

// Header quick-toggle: flip to the opposite of what's showing now.
document.getElementById("btn-theme").addEventListener("click", () => {
  settings.theme =
    resolveTheme(settings.theme ?? "auto") === "dark" ? "light" : "dark";
  saveSettings(settings);
  applyTheme(settings.theme);
});

// Re-sync the status-bar color when the system flips and we're following it.
darkMQ.addEventListener("change", () => {
  if ((settings.theme ?? "auto") === "auto") applyTheme("auto");
});

applyTheme(settings.theme ?? "auto");

// ── Screen router ─────────────────────────────────────────────────────────────

const screens = {
  list: document.getElementById("screen-list"),
  player: document.getElementById("screen-player"),
  editor: document.getElementById("screen-editor"),
  exercise: document.getElementById("screen-exercise"),
  history: document.getElementById("screen-history"),
  settings: document.getElementById("screen-settings"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name]?.classList.add("active");
  window.scrollTo(0, 0);
}

// ── Routine list ──────────────────────────────────────────────────────────────

function renderList() {
  const routines = getRoutines();
  const groups = getGroups();
  const container = document.getElementById("routine-list");
  container.innerHTML = "";

  if (routines.length === 0 && groups.length === 0) {
    container.innerHTML =
      '<p class="empty">No routines yet. Tap + to create one.</p>';
    return;
  }

  // Pinned groups first
  const pinnedGroups = groups.filter((g) => g.pinned);
  pinnedGroups.forEach((group, indexInGroups) => {
    renderGroup(group, indexInGroups, pinnedGroups.length, routines, container);
  });

  // Ungrouped routines next
  const knownGroupIds = new Set(groups.map((group) => group.id));
  // Never hide a routine solely because its saved group was deleted or renamed.
  const ungrouped = routines.filter(
    (r) => !r.groupId || !knownGroupIds.has(r.groupId),
  );
  ungrouped.forEach((r, i) => {
    container.appendChild(buildRoutineCard(r, i, ungrouped.length));
  });

  // Unpinned groups last
  const unpinnedGroups = groups.filter((g) => !g.pinned);
  unpinnedGroups.forEach((group, indexInGroups) => {
    renderGroup(
      group,
      indexInGroups,
      unpinnedGroups.length,
      routines,
      container,
    );
  });

  // Wire drag-and-drop after render
  initDragAndDrop(container);
}

function renderGroup(group, indexInGroups, sectionLen, routines, container) {
  const members = routines.filter((r) => r.groupId === group.id);
  const section = document.createElement("div");
  section.className = "routine-group";
  section.dataset.groupId = group.id;

  const header = document.createElement("div");
  header.className = "group-header";
  header.innerHTML = `
    <div class="group-header-info">
      <span class="group-chevron">${group.collapsed ? "▸" : "▾"}</span>
      <span class="group-name">${esc(group.name)}</span>
    </div>
    <div class="group-actions">
      <button class="btn-group-up" data-group-id="${group.id}" ${indexInGroups === 0 ? "disabled" : ""} aria-label="Move group up">↑</button>
      <button class="btn-group-down" data-group-id="${group.id}" ${indexInGroups === sectionLen - 1 ? "disabled" : ""} aria-label="Move group down">↓</button>
      <button class="btn-group-pin${group.pinned ? " pinned" : ""}" data-group-id="${group.id}" aria-label="Pin group">📌</button>
      <button class="btn-group-edit" data-group-id="${group.id}" aria-label="Rename group">✏️</button>
      <button class="btn-group-delete" data-group-id="${group.id}" aria-label="Delete group">🗑</button>
    </div>
  `;
  section.appendChild(header);

  const content = document.createElement("div");
  content.className = "group-content" + (group.collapsed ? " collapsed" : "");
  members.forEach((r, i) => {
    content.appendChild(buildRoutineCard(r, i, members.length));
  });
  section.appendChild(content);

  container.appendChild(section);
}

function buildRoutineCard(r, indexInSection, sectionLen) {
  const card = document.createElement("div");
  card.className = "routine-card";
  card.dataset.id = r.id;
  card.setAttribute("draggable", "true");

  const est = estimateDuration(r);
  card.innerHTML = `
    <span class="drag-handle" aria-label="Drag to reorder">⠿</span>
    <div class="card-main">
      <span class="card-name">${esc(r.name)}</span>
      <span class="card-meta">${esc(r.note ?? "")} · ${est}</span>
    </div>
    <div class="card-actions">
      <button class="btn-rtn-up" data-id="${r.id}" ${indexInSection === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
      <button class="btn-rtn-down" data-id="${r.id}" ${indexInSection === sectionLen - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
      <button class="btn-start" data-id="${r.id}">Start</button>
      <button class="btn-edit" data-id="${r.id}" aria-label="Edit ${esc(r.name)}">✏️</button>
      <button class="btn-delete" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">🗑</button>
    </div>
  `;
  return card;
}

function estimateDuration(routine) {
  let secs = 0;
  (routine.exercises ?? []).forEach((ex) => {
    if (ex.type === "hold") {
      secs += ex.sets * ex.holdDuration;
    } else {
      const repTarget = Array.isArray(ex.repTarget)
        ? ex.repTarget[1]
        : ex.repTarget;
      const perRep =
        (ex.tempo?.out ?? 2) + (ex.tempo?.hold ?? 1) + (ex.tempo?.return ?? 3);
      secs += ex.sets * repTarget * perRep;
    }
    secs += (ex.sets - 1) * (ex.rest ?? 30);
  });
  secs *= routine.repeat ?? 1;
  if (secs < 60) return `~${secs}s`;
  return `~${Math.round(secs / 60)} min`;
}

// ── Drag-and-drop (mouse + touch) ─────────────────────────────────────────────

function initDragAndDrop(container) {
  const cards = container.querySelectorAll(".routine-card");

  // --- HTML5 Drag API (mouse / desktop) ---
  cards.forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.id);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      container
        .querySelectorAll(".drag-over")
        .forEach((el) => el.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () =>
      card.classList.remove("drag-over"),
    );
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/plain");
      const targetId = card.dataset.id;
      if (draggedId && draggedId !== targetId) {
        dropReorder(draggedId, targetId);
      }
    });
  });

  // --- Touch drag (mobile) ---
  let touchState = null;

  cards.forEach((card) => {
    const handle = card.querySelector(".drag-handle");
    if (!handle) return;

    handle.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        touchState = {
          id: card.dataset.id,
          startX: touch.clientX,
          startY: touch.clientY,
          timer: setTimeout(() => {
            if (touchState) {
              touchState.active = true;
              card.classList.add("dragging");
            }
          }, 300),
          active: false,
        };
      },
      { passive: true },
    );

    handle.addEventListener(
      "touchmove",
      (e) => {
        if (!touchState) return;
        if (!touchState.active) {
          // Check if user is scrolling — cancel if moved too far before long-press fires
          const touch = e.touches[0];
          const dx = Math.abs(touch.clientX - touchState.startX);
          const dy = Math.abs(touch.clientY - touchState.startY);
          if (dx > 10 || dy > 10) {
            clearTimeout(touchState.timer);
            touchState = null;
          }
          return;
        }
        e.preventDefault();
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetCard = target?.closest(".routine-card");
        container
          .querySelectorAll(".drag-over")
          .forEach((el) => el.classList.remove("drag-over"));
        if (targetCard && targetCard.dataset.id !== touchState.id) {
          targetCard.classList.add("drag-over");
        }
      },
      { passive: false },
    );

    handle.addEventListener(
      "touchend",
      () => {
        if (!touchState) return;
        clearTimeout(touchState.timer);
        if (touchState.active) {
          const overEl = container.querySelector(".drag-over");
          if (overEl) {
            dropReorder(touchState.id, overEl.dataset.id);
            overEl.classList.remove("drag-over");
          }
          card.classList.remove("dragging");
        }
        touchState = null;
      },
      { passive: true },
    );

    handle.addEventListener(
      "touchcancel",
      () => {
        if (!touchState) return;
        clearTimeout(touchState.timer);
        card.classList.remove("dragging");
        container
          .querySelectorAll(".drag-over")
          .forEach((el) => el.classList.remove("drag-over"));
        touchState = null;
      },
      { passive: true },
    );
  });
}

/** Move dragged routine to the position of the target routine and update groupId */
function dropReorder(draggedId, targetId) {
  const routines = getRoutines();
  const dragIdx = routines.findIndex((r) => r.id === draggedId);
  const targIdx = routines.findIndex((r) => r.id === targetId);
  if (dragIdx < 0 || targIdx < 0) return;

  // Adopt target's groupId so cross-group drag works
  routines[dragIdx].groupId = routines[targIdx].groupId || null;

  // Move within array
  const [moved] = routines.splice(dragIdx, 1);
  const newTargIdx = routines.findIndex((r) => r.id === targetId);
  routines.splice(newTargIdx, 0, moved);

  saveRoutines(routines);
  renderList();
}

// ── Routine list up/down reorder ──────────────────────────────────────────────

function moveRoutine(routineId, direction) {
  const routines = getRoutines();
  const routine = routines.find((r) => r.id === routineId);
  if (!routine) return;

  // Get siblings (same group)
  const groupId = routine.groupId || null;
  const siblings = routines.filter((r) => (r.groupId || null) === groupId);
  const posInSib = siblings.findIndex((r) => r.id === routineId);
  if (posInSib < 0) return;
  if (direction === -1 && posInSib === 0) return;
  if (direction === 1 && posInSib === siblings.length - 1) return;

  const swapTarget = siblings[posInSib + direction];
  const globalA = routines.indexOf(routine);
  const globalB = routines.indexOf(swapTarget);
  [routines[globalA], routines[globalB]] = [
    routines[globalB],
    routines[globalA],
  ];

  saveRoutines(routines);
  renderList();
}

// ── Group management ──────────────────────────────────────────────────────────

document.getElementById("btn-new-group").addEventListener("click", () => {
  const name = prompt("Group name:");
  if (!name || !name.trim()) return;
  saveGroup({ id: newId("grp"), name: name.trim(), collapsed: false });
  renderList();
});

// ── Routine list event delegation ─────────────────────────────────────────────

document.getElementById("routine-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) {
    // Clicking group header (non-button area) toggles collapse
    const header = e.target.closest(".group-header");
    if (header) {
      const section = header.closest(".routine-group");
      const groupId = section?.dataset.groupId;
      if (groupId) toggleGroupCollapse(groupId);
    }
    return;
  }

  const id = btn.dataset.id;

  if (btn.classList.contains("btn-start")) startSession(id);
  if (btn.classList.contains("btn-edit")) openEditor(id);
  if (btn.classList.contains("btn-delete")) {
    if (confirm("Delete this routine?")) {
      deleteRoutine(id);
      renderList();
    }
  }
  if (btn.classList.contains("btn-rtn-up")) moveRoutine(id, -1);
  if (btn.classList.contains("btn-rtn-down")) moveRoutine(id, 1);

  // Group actions
  const groupId = btn.dataset.groupId;
  if (btn.classList.contains("btn-group-up")) moveGroup(groupId, -1);
  if (btn.classList.contains("btn-group-down")) moveGroup(groupId, 1);
  if (btn.classList.contains("btn-group-pin")) toggleGroupPin(groupId);
  if (btn.classList.contains("btn-group-edit")) {
    const groups = getGroups();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const name = prompt("Rename group:", group.name);
    if (name && name.trim()) {
      group.name = name.trim();
      saveGroups(groups);
      renderList();
    }
  }
  if (btn.classList.contains("btn-group-delete")) {
    if (!confirm("Delete this group? Routines will be moved to ungrouped."))
      return;
    // Ungroup routines
    const routines = getRoutines();
    routines.forEach((r) => {
      if (r.groupId === groupId) r.groupId = null;
    });
    saveRoutines(routines);
    deleteGroup(groupId);
    renderList();
  }
});

function toggleGroupCollapse(groupId) {
  const groups = getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.collapsed = !group.collapsed;
  saveGroups(groups);
  renderList();
}

function toggleGroupPin(groupId) {
  const groups = getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;
  group.pinned = !group.pinned;
  saveGroups(groups);
  renderList();
}

function moveGroup(groupId, direction) {
  const groups = getGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return;

  const isPinned = !!group.pinned;
  // Get siblings with same pin state
  const siblings = groups.filter((g) => !g.pinned === !isPinned);
  const posInSib = siblings.findIndex((g) => g.id === groupId);
  if (posInSib < 0) return;
  if (direction === -1 && posInSib === 0) return;
  if (direction === 1 && posInSib === siblings.length - 1) return;

  const swapTarget = siblings[posInSib + direction];
  const globalA = groups.indexOf(group);
  const globalB = groups.indexOf(swapTarget);
  [groups[globalA], groups[globalB]] = [groups[globalB], groups[globalA]];

  saveGroups(groups);
  renderList();
}

document
  .getElementById("btn-new-routine")
  .addEventListener("click", () => openEditor(null));
document.getElementById("btn-history").addEventListener("click", () => {
  renderHistory();
  showScreen("history");
});
document.getElementById("btn-settings").addEventListener("click", () => {
  renderSettings();
  showScreen("settings");
});

// ── Session player ────────────────────────────────────────────────────────────

// Seconds the initial get-ready is shortened to when "Skip to Start" is used;
// also the minimum start countdown above which the button is worth showing.
const SKIP_TO_START_SECONDS = 5;

let activeSchedule = [];
let activeRoutine = null;
let startCountdownSkipped = false;

async function startSession(routineId) {
  const routine = getRoutines().find((r) => r.id === routineId);
  if (!routine) return;

  activeRoutine = routine;
  startCountdownSkipped = false;
  activeSchedule = buildSchedule(routine);

  // Unlock audio on this gesture
  cueEngine.unlock();

  // Wake lock
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) {
    /* graceful degradation */
  }

  showScreen("player");
  renderPlayerHeader(routine);
  resetPlayerUI();

  engine = new SessionEngine(activeSchedule, {
    onPhaseStart: (phase, idx) => {
      cueEngine.onPhaseStart(phase);
      renderPhase(phase, idx);
      syncSkipToStartButton(phase, idx);
      startWorkoutClock(phase);
    },
    onTick: (remaining, phase, idx) => {
      cueEngine.onTick(remaining, phase);
      updateCountdown(remaining, phase);
      updateWorkoutClock();
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
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && engine && !engine.isPaused) {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (e) {
      /* ok */
    }
  }
});

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ── Player render ─────────────────────────────────────────────────────────────

function renderPlayerHeader(routine) {
  document.getElementById("player-routine-name").textContent = routine.name;
  document.getElementById("player-global-cue").textContent = settings.globalCue;
}

function resetPlayerUI() {
  document.getElementById("player-phase-label").textContent = "";
  document.getElementById("player-sub-label").textContent = "";
  document.getElementById("player-set-label").textContent = "";
  document.getElementById("player-exercise-name").textContent = "";
  document.getElementById("player-exercise-cue").textContent = "";
  document.getElementById("player-countdown").textContent = "";
  setRingProgress(0);
  resetWorkoutClock();
  hideDoneOverlay();
}

function syncSkipToStartButton(phase, idx) {
  const button = document.getElementById("btn-skip-to-start");
  if (!button) return;
  const shouldShow =
    !startCountdownSkipped &&
    !engine?.isPaused &&
    idx === 0 &&
    phase.type === "get-ready" &&
    phase.duration > SKIP_TO_START_SECONDS;
  button.classList.toggle("hidden", !shouldShow);
}

function renderPhase(phase, idx) {
  const visual = settings.visual;

  const phaseEl = document.getElementById("player-phase-label");
  const subEl = document.getElementById("player-sub-label");
  const setEl = document.getElementById("player-set-label");
  const exEl = document.getElementById("player-exercise-name");
  const cueEl = document.getElementById("player-exercise-cue");

  if (visual) {
    const isNextExercise = phase.label === "NEXT EXERCISE";
    phaseEl.textContent = phase.label;
    subEl.textContent = isNextExercise ? "" : (phase.subLabel ?? "");
    setEl.textContent = isNextExercise ? "" : (phase.setLabel ?? "");
    exEl.textContent = isNextExercise
      ? (phase.nextExerciseName ?? "")
      : (phase.exerciseName ?? "");
    cueEl.textContent = isNextExercise ? "" : (phase.cue ?? "");
  }

  // Color coding for phase
  const playerEl = document.getElementById("screen-player");
  playerEl.className =
    "screen active phase-" +
    (phase.type?.replace(":", "-") ?? "default") +
    (phase.label === "NEXT EXERCISE" ? " phase-next-exercise" : "");
}

function updateCountdown(remaining, phase) {
  if (!settings.visual) return;
  const el = document.getElementById("player-countdown");
  el.textContent = Math.ceil(remaining);

  // Ring: progress = elapsed / total
  const total = phase.duration;
  const elapsed = total - remaining;
  const pct = total > 0 ? elapsed / total : 0;
  setRingProgress(pct);
}

function setRingProgress(pct) {
  const ring = document.getElementById("progress-ring-fill");
  if (!ring) return;
  const r = 80;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, Math.max(0, pct)));
  ring.style.strokeDashoffset = offset;
}

// ── Total workout countup ─────────────────────────────────────────────────────

function resetWorkoutClock() {
  workoutStartMs = null;
  workoutPauseMs = null;
  const el = document.getElementById("player-elapsed");
  if (!el) return;
  el.textContent = "0:00";
  el.classList.add("hidden");
}

function startWorkoutClock(phase) {
  // Skip the pre-routine countdown; clock starts at the first real phase.
  if (workoutStartMs !== null || phase.type === "get-ready") return;
  workoutStartMs = performance.now();
  document.getElementById("player-elapsed")?.classList.remove("hidden");
  updateWorkoutClock();
}

function updateWorkoutClock() {
  if (workoutStartMs === null) return;
  const el = document.getElementById("player-elapsed");
  if (!el) return;
  const secs = Math.floor((performance.now() - workoutStartMs) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = `${m}:${String(s).padStart(2, "0")}`;
}

function showDoneOverlay(stats) {
  const overlay = document.getElementById("player-done-overlay");
  if (overlay) overlay.classList.remove("hidden");
  const msg = document.getElementById("player-done-msg");
  if (msg) msg.textContent = `${stats.setsCompleted} sets done 💪`;
}

function hideDoneOverlay() {
  const overlay = document.getElementById("player-done-overlay");
  if (overlay) overlay.classList.add("hidden");
}

// Player controls
document.getElementById("btn-pause").addEventListener("click", () => {
  if (!engine) return;
  if (engine.isPaused) {
    engine.resume();
    // Shift start forward by the paused span so it isn't counted
    if (workoutStartMs !== null && workoutPauseMs !== null) {
      workoutStartMs += performance.now() - workoutPauseMs;
    }
    workoutPauseMs = null;
    document.getElementById("btn-pause").textContent = "Pause";
    syncSkipToStartButton(engine.currentPhase, engine.phaseIdx);
  } else {
    engine.pause();
    workoutPauseMs = performance.now();
    document.getElementById("btn-pause").textContent = "Resume";
    syncSkipToStartButton(engine.currentPhase, engine.phaseIdx);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  if (!engine || !screens.player.classList.contains("active")) return;
  e.preventDefault();
  document.getElementById("btn-pause").click();
});

document
  .getElementById("btn-end-set")
  .addEventListener("click", () => engine?.endSetEarly());
document
  .getElementById("btn-skip-ex")
  .addEventListener("click", () => engine?.skipExercise());
document.getElementById("btn-skip-to-start").addEventListener("click", () => {
  if (!engine?.restartInitialCountdown(SKIP_TO_START_SECONDS)) return;
  startCountdownSkipped = true;
  document.getElementById("btn-skip-to-start").classList.add("hidden");
});

document.getElementById("btn-end-session").addEventListener("click", () => {
  if (confirm("End this session?")) {
    engine?.endSession();
  }
});

document.getElementById("btn-mute").addEventListener("click", () => {
  settings.voice = !settings.voice;
  settings.beeps = !settings.beeps;
  cueEngine.updateSettings(settings);
  document.getElementById("btn-mute").textContent =
    settings.voice || settings.beeps ? "Mute" : "Unmute";
  saveSettings(settings);
});

document.getElementById("btn-player-back").addEventListener("click", () => {
  if (engine && !engine._ended) {
    if (!confirm("End session and go back?")) return;
    engine.endSession();
  }
  releaseWakeLock();
  showScreen("list");
  renderList();
});

document.getElementById("btn-done-back").addEventListener("click", () => {
  releaseWakeLock();
  showScreen("list");
  renderList();
});

// ── Session logging ───────────────────────────────────────────────────────────

function logSession(routine, stats) {
  addSession({
    id: newId("sess"),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: stats.startedAt,
    completedAt: stats.endedAt,
    setsCompleted: stats.setsCompleted,
    exercisesCompleted: stats.exercisesCompleted,
  });
}

// ── Routine editor ────────────────────────────────────────────────────────────

let editingRoutine = null; // deep copy of routine being edited

function openEditor(routineId) {
  if (routineId) {
    const r = getRoutines().find((r) => r.id === routineId);
    editingRoutine = JSON.parse(JSON.stringify(r)); // deep copy
  } else {
    editingRoutine = {
      id: newId("rtn"),
      name: "",
      note: "",
      repeat: 1,
      startCountdown: 15,
      groupId: null,
      exercises: [],
    };
  }
  renderEditor();
  showScreen("editor");
}

function renderEditor() {
  document.getElementById("editor-name").value = editingRoutine.name;
  document.getElementById("editor-note").value = editingRoutine.note ?? "";
  document.getElementById("editor-repeat").value = editingRoutine.repeat ?? 1;
  document.getElementById("editor-start-countdown").value =
    editingRoutine.startCountdown ?? 15;

  // Populate group dropdown
  const groupSelect = document.getElementById("editor-group");
  const groups = getGroups();
  groupSelect.innerHTML = '<option value="">No Group</option>';
  groups.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    if (editingRoutine.groupId === g.id) opt.selected = true;
    groupSelect.appendChild(opt);
  });

  const list = document.getElementById("editor-exercise-list");
  list.innerHTML = "";
  editingRoutine.exercises.forEach((ex, i) => {
    const item = document.createElement("div");
    item.className = "editor-ex-item" + (ex.pinned ? " pinned" : "");
    item.innerHTML = `
      <button class="btn-ex-pin${ex.pinned ? " pinned" : ""}" data-idx="${i}" aria-label="Pin exercise">📌</button>
      <span class="ex-name">${esc(ex.name || "Unnamed")}</span>
      <span class="ex-meta">${exSummary(ex)}</span>
      <button class="btn-ex-edit" data-idx="${i}" aria-label="Edit ${esc(ex.name || "Unnamed")}">✏️</button>
      <button class="btn-ex-up"   data-idx="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="btn-ex-down" data-idx="${i}" ${i === editingRoutine.exercises.length - 1 ? "disabled" : ""}>↓</button>
      <button class="btn-ex-del"  data-idx="${i}">✕</button>
    `;
    list.appendChild(item);
  });
}

function exSummary(ex) {
  // Interpolated into innerHTML by the caller, so the user-entered labels are escaped.
  const labels =
    Array.isArray(ex.labels) && ex.labels.length
      ? ` · ${esc(ex.labels.join("/"))}`
      : "";
  if (ex.type === "hold") {
    return `Hold · ${ex.sets}×${ex.holdDuration}s${labels}`;
  }
  const rep = Array.isArray(ex.repTarget)
    ? ex.repTarget.join("–")
    : ex.repTarget;
  return `${ex.sets}×${rep} reps · ${ex.tempo?.out}/${ex.tempo?.hold}/${ex.tempo?.return}${labels}`;
}

document
  .getElementById("editor-exercise-list")
  .addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    const exs = editingRoutine.exercises;

    if (btn.classList.contains("btn-ex-pin")) {
      exs[idx].pinned = !exs[idx].pinned;
      // Stable sort: pinned first
      const pinnedExs = exs.filter((ex) => ex.pinned);
      const unpinnedExs = exs.filter((ex) => !ex.pinned);
      editingRoutine.exercises = [...pinnedExs, ...unpinnedExs];
      renderEditor();
      return;
    }
    if (btn.classList.contains("btn-ex-edit")) openExerciseEditor(idx);
    if (btn.classList.contains("btn-ex-del")) {
      exs.splice(idx, 1);
      renderEditor();
    }
    if (btn.classList.contains("btn-ex-up")) {
      [exs[idx - 1], exs[idx]] = [exs[idx], exs[idx - 1]];
      renderEditor();
    }
    if (btn.classList.contains("btn-ex-down")) {
      [exs[idx], exs[idx + 1]] = [exs[idx + 1], exs[idx]];
      renderEditor();
    }
  });

document.getElementById("btn-add-exercise").addEventListener("click", () => {
  openExerciseEditor(null);
});

function readRoutineStartCountdown() {
  const value = Number.parseInt(
    document.getElementById("editor-start-countdown").value,
    10,
  );
  return Number.isFinite(value) ? Math.min(120, Math.max(5, value)) : 15;
}

document.getElementById("btn-save-routine").addEventListener("click", () => {
  editingRoutine.name =
    document.getElementById("editor-name").value.trim() || "Untitled";
  editingRoutine.note = document.getElementById("editor-note").value.trim();
  editingRoutine.repeat =
    parseInt(document.getElementById("editor-repeat").value) || 1;
  editingRoutine.startCountdown = readRoutineStartCountdown();
  editingRoutine.groupId =
    document.getElementById("editor-group").value || null;
  saveRoutine(editingRoutine);
  showScreen("list");
  renderList();
});

document.getElementById("btn-cancel-routine").addEventListener("click", () => {
  showScreen("list");
  renderList();
});

// ── Exercise editor ───────────────────────────────────────────────────────────

let editingExIdx = null;
let editingLabels = []; // working copy of the exercise's set labels

function syncEditorFields() {
  editingRoutine.name =
    document.getElementById("editor-name").value.trim() || editingRoutine.name;
  editingRoutine.note = document.getElementById("editor-note").value.trim();
  editingRoutine.repeat =
    parseInt(document.getElementById("editor-repeat").value) || 1;
  editingRoutine.startCountdown = readRoutineStartCountdown();
  editingRoutine.groupId =
    document.getElementById("editor-group").value || null;
}

function openExerciseEditor(exIdx) {
  syncEditorFields();
  editingExIdx = exIdx;
  let ex;
  if (exIdx !== null && exIdx < editingRoutine.exercises.length) {
    ex = JSON.parse(JSON.stringify(editingRoutine.exercises[exIdx]));
  } else {
    ex = {
      id: newId("ex"),
      name: "",
      type: "reps",
      load: "",
      sets: 3,
      repTarget: [12, 15],
      tempo: { out: 2, hold: 2, return: 3 },
      rest: 40,
      holdDuration: 20,
      cue: "",
      labels: [],
    };
  }
  populateExEditor(ex);
  showScreen("exercise");
}

function populateExEditor(ex) {
  document.getElementById("ex-name").value = ex.name;
  document.getElementById("ex-load").value = ex.load ?? "";
  document.getElementById("ex-sets").value = ex.sets;
  document.getElementById("ex-rest").value = ex.rest;
  document.getElementById("ex-cue").value = ex.cue ?? "";

  // Exercises saved before set labels existed have no `labels` key.
  editingLabels = Array.isArray(ex.labels) ? ex.labels.slice() : [];
  renderLabelRows();

  const isReps = ex.type === "reps";
  document.getElementById("ex-type-reps").checked = isReps;
  document.getElementById("ex-type-hold").checked = !isReps;

  // Rep fields
  const rt = Array.isArray(ex.repTarget)
    ? ex.repTarget
    : [ex.repTarget, ex.repTarget];
  document.getElementById("ex-rep-min").value = rt[0];
  document.getElementById("ex-rep-max").value = rt[1];
  document.getElementById("ex-tempo-out").value = ex.tempo?.out ?? 2;
  document.getElementById("ex-tempo-hold").value = ex.tempo?.hold ?? 2;
  document.getElementById("ex-tempo-return").value = ex.tempo?.return ?? 3;

  // Hold fields
  document.getElementById("ex-hold-duration").value = ex.holdDuration ?? 20;

  toggleExFields(isReps);
}

// ── Set labels sub-editor ─────────────────────────────────────────────────────

function currentSetsValue() {
  return parseInt(document.getElementById("ex-sets").value) || 1;
}

function renderLabelRows() {
  const list = document.getElementById("ex-labels-list");
  list.innerHTML = "";

  editingLabels.forEach((text, i) => {
    const row = document.createElement("div");
    row.className = "label-row";

    const idx = document.createElement("span");
    idx.className = "label-idx";
    idx.textContent = `${i + 1}.`;

    const input = document.createElement("input");
    input.type = "text";
    input.value = text;
    input.placeholder = "e.g. Left";
    input.autocomplete = "off";
    input.setAttribute("aria-label", `Set label ${i + 1}`);
    input.addEventListener("input", () => {
      editingLabels[i] = input.value;
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-icon";
    del.textContent = "−";
    del.setAttribute("aria-label", `Remove set label ${i + 1}`);
    del.addEventListener("click", () => {
      editingLabels.splice(i, 1);
      renderLabelRows();
    });

    row.append(idx, input, del);
    list.appendChild(row);
  });

  syncAddLabelButton();
}

function syncAddLabelButton() {
  // At most one label per set — beyond that the cycling would never reach them.
  document.getElementById("btn-add-label").disabled =
    editingLabels.length >= currentSetsValue();
}

document.getElementById("btn-add-label").addEventListener("click", () => {
  if (editingLabels.length >= currentSetsValue()) return;
  editingLabels.push("");
  renderLabelRows();
  const inputs = document.querySelectorAll("#ex-labels-list input");
  inputs[inputs.length - 1]?.focus();
});

document
  .getElementById("ex-sets")
  .addEventListener("input", syncAddLabelButton);

function toggleExFields(isReps) {
  document.getElementById("ex-reps-fields").classList.toggle("hidden", !isReps);
  document.getElementById("ex-hold-fields").classList.toggle("hidden", isReps);
}

document.querySelectorAll('input[name="ex-type"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    toggleExFields(document.getElementById("ex-type-reps").checked);
  });
});

document.getElementById("btn-save-exercise").addEventListener("click", () => {
  const isReps = document.getElementById("ex-type-reps").checked;
  const tempoOut = parseFloat(document.getElementById("ex-tempo-out").value);
  const tempoHold = parseFloat(document.getElementById("ex-tempo-hold").value);
  const tempoReturn = parseFloat(
    document.getElementById("ex-tempo-return").value,
  );
  const sets = parseInt(document.getElementById("ex-sets").value) || 3;
  // Blank rows are dropped, and labels never outnumber sets (sets may have been
  // lowered after the labels were added).
  const labels = editingLabels
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, sets);
  const ex = {
    id:
      editingExIdx !== null
        ? (editingRoutine.exercises[editingExIdx]?.id ?? newId("ex"))
        : newId("ex"),
    name: document.getElementById("ex-name").value.trim() || "Unnamed",
    type: isReps ? "reps" : "hold",
    load: document.getElementById("ex-load").value.trim() || null,
    sets,
    labels,
    rest: parseInt(document.getElementById("ex-rest").value) || 40,
    cue: document.getElementById("ex-cue").value.trim() || null,
    pinned:
      editingExIdx !== null
        ? !!editingRoutine.exercises[editingExIdx]?.pinned
        : false,
    // reps
    repTarget: [
      parseInt(document.getElementById("ex-rep-min").value) || 12,
      parseInt(document.getElementById("ex-rep-max").value) || 15,
    ],
    tempo: {
      out: Number.isFinite(tempoOut) ? tempoOut : 2,
      hold: Number.isFinite(tempoHold) ? tempoHold : 2,
      return: Number.isFinite(tempoReturn) ? tempoReturn : 3,
    },
    // hold
    holdDuration:
      parseInt(document.getElementById("ex-hold-duration").value) || 20,
  };

  if (editingExIdx !== null && editingExIdx < editingRoutine.exercises.length) {
    editingRoutine.exercises[editingExIdx] = ex;
  } else {
    editingRoutine.exercises.push(ex);
  }
  renderEditor();
  showScreen("editor");
});

document.getElementById("btn-cancel-exercise").addEventListener("click", () => {
  showScreen("editor");
});

// ── History ───────────────────────────────────────────────────────────────────

function renderHistory() {
  const history = getHistory();
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  if (history.length === 0) {
    list.innerHTML = '<p class="empty">No sessions yet.</p>';
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const date = new Date(entry.startedAt);
    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    item.innerHTML = `
      <span class="h-name">${esc(entry.routineName)}</span>
      <span class="h-meta">${dateStr} ${timeStr} · ${entry.setsCompleted} sets</span>
    `;
    list.appendChild(item);
  });
}

document.getElementById("btn-clear-history").addEventListener("click", () => {
  if (confirm("Clear all history?")) {
    clearHistory();
    renderHistory();
  }
});

document.getElementById("btn-history-back").addEventListener("click", () => {
  showScreen("list");
  renderList();
});

// ── Settings ──────────────────────────────────────────────────────────────────

function renderSettings() {
  document.getElementById("setting-voice").checked = settings.voice;
  document.getElementById("setting-beeps").checked = settings.beeps;
  document.getElementById("setting-visual").checked = settings.visual;
  document.getElementById("setting-global-cue").value = settings.globalCue;
  document.getElementById("setting-voice-rate").value =
    settings.voiceRate ?? 1.0;
  document.getElementById("setting-theme").value = settings.theme ?? "auto";
  renderDiagnostics();
}

function renderDiagnostics() {
  const idEl = document.getElementById("diag-install-id");
  const logEl = document.getElementById("diag-boot-log");
  if (idEl) idEl.textContent = getInstallId();
  if (!logEl) return;

  const log = getBootLog();
  if (log.length === 0) {
    logEl.textContent = "No boots recorded yet.";
    return;
  }

  logEl.textContent = log
    .map((b) => {
      const d = new Date(b.t);
      const when = d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return `${when} · ${b.n} routines${b.fresh ? " · ⚠️ FRESH INSTALL (storage was empty)" : ""}`;
    })
    .join("\n");
}

document.getElementById("btn-save-settings").addEventListener("click", () => {
  settings.voice = document.getElementById("setting-voice").checked;
  settings.beeps = document.getElementById("setting-beeps").checked;
  settings.visual = document.getElementById("setting-visual").checked;
  settings.globalCue =
    document.getElementById("setting-global-cue").value.trim() ||
    "Blades back and down — no shrug.";
  settings.voiceRate =
    parseFloat(document.getElementById("setting-voice-rate").value) || 1.0;
  settings.theme = document.getElementById("setting-theme").value || "auto";
  saveSettings(settings);
  cueEngine.updateSettings(settings);
  applyTheme(settings.theme);
  showScreen("list");
  renderList();
});

document
  .getElementById("btn-settings-back")
  .addEventListener("click", () => showScreen("list"));

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Service worker registration ───────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {
      // Graceful degradation — app works without SW (localhost / no HTTPS)
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────

renderList();
showScreen("list");
