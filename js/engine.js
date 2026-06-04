// engine.js — Session runtime: drift-corrected tick loop, controls.
//
// Usage:
//   const engine = new SessionEngine(schedule, callbacks);
//   engine.start();    // begin session
//   engine.pause();
//   engine.resume();
//   engine.endSetEarly();
//   engine.skipExercise();
//   engine.endSession();
//
// Callbacks fired by the engine:
//   onPhaseStart(phase, phaseIdx, elapsed)   — new phase begins
//   onTick(remaining, phase, phaseIdx)       — every ~250ms during a phase
//   onDone(stats)                            — session finished naturally
//   onEnd(stats)                             — session ended (natural or manual)

import { findEndSetEarlyTarget, findSkipExerciseTarget } from './schedule.js';

export class SessionEngine {
  constructor(schedule, callbacks = {}) {
    this._schedule   = schedule;
    this._cb         = callbacks;

    this._phaseIdx   = 0;
    this._paused     = false;
    this._ended      = false;

    // Tick state
    this._tickHandle    = null;
    this._phaseStart    = 0;  // performance.now() when current phase began
    this._pausedAt      = 0;  // performance.now() when paused
    this._pausedElapsed = 0;  // accumulated elapsed ms before this pause

    // Stats
    this._stats = {
      setsCompleted:      0,
      exercisesCompleted: 0,
      startedAt:          null,
      endedAt:            null,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start() {
    if (this._ended) return;
    this._stats.startedAt = new Date().toISOString();
    this._enterPhase(0);
  }

  pause() {
    if (this._paused || this._ended) return;
    this._paused    = true;
    this._pausedAt  = performance.now();
    clearTimeout(this._tickHandle);
  }

  resume() {
    if (!this._paused || this._ended) return;
    // Shift phase start forward by how long we were paused
    const pausedDuration = performance.now() - this._pausedAt;
    this._phaseStart    += pausedDuration;
    this._paused         = false;
    this._tick();
  }

  endSetEarly() {
    if (this._ended) return;
    const target = findEndSetEarlyTarget(this._schedule, this._phaseIdx);
    this._jumpTo(target);
  }

  skipExercise() {
    if (this._ended) return;
    const target = findSkipExerciseTarget(this._schedule, this._phaseIdx);
    this._jumpTo(target);
  }

  endSession() {
    if (this._ended) return;
    this._finish(false);
  }

  get currentPhase() {
    return this._schedule[this._phaseIdx];
  }

  get phaseIdx() {
    return this._phaseIdx;
  }

  get isPaused() {
    return this._paused;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _enterPhase(idx) {
    clearTimeout(this._tickHandle);

    if (idx >= this._schedule.length) {
      this._finish(true);
      return;
    }

    this._phaseIdx      = idx;
    this._phaseStart    = performance.now();
    this._pausedElapsed = 0;

    const phase = this._schedule[idx];

    if (phase.type === 'done') {
      this._finish(true);
      return;
    }

    this._cb.onPhaseStart?.(phase, idx, 0);
    this._tick();
  }

  _tick() {
    if (this._paused || this._ended) return;

    const phase     = this._schedule[this._phaseIdx];
    const elapsed   = (performance.now() - this._phaseStart) / 1000; // seconds
    const remaining = Math.max(0, phase.duration - elapsed);

    this._cb.onTick?.(remaining, phase, this._phaseIdx);

    if (remaining <= 0) {
      // Track completions on phase exit
      this._trackCompletion(phase);
      this._enterPhase(this._phaseIdx + 1);
    } else {
      // Schedule next tick (targeting ~250ms granularity)
      const nextMs = Math.min(remaining * 1000, 250);
      this._tickHandle = setTimeout(() => this._tick(), nextMs);
    }
  }

  _trackCompletion(phase) {
    // Count a set as complete when we exit the last rep:return of a set,
    // or when we exit a hold phase.
    if (phase.type === 'hold') {
      this._stats.setsCompleted++;
      return;
    }
    if (phase.type !== 'rep:return') return;

    // Is this the last rep of the set?
    const ex          = this._schedule
      .slice(0, this._phaseIdx + 1)
      .filter(p => p.exerciseIdx === phase.exerciseIdx && p.setIdx === phase.setIdx);
    const lastRepReturn = ex.filter(p => p.type === 'rep:return').pop();
    if (lastRepReturn === phase) {
      this._stats.setsCompleted++;
    }
  }

  _jumpTo(targetIdx) {
    clearTimeout(this._tickHandle);
    if (this._paused) {
      // Resume and jump
      this._paused = false;
    }
    this._enterPhase(targetIdx);
  }

  _finish(natural) {
    if (this._ended) return;
    this._ended          = true;
    this._stats.endedAt  = new Date().toISOString();
    clearTimeout(this._tickHandle);

    // Count distinct exercises that had at least one completed set
    const completedExercises = new Set(
      this._schedule
        .filter(p => (p.type === 'rep:return' || p.type === 'hold') && p.exerciseIdx !== null)
        .map(p => p.exerciseIdx)
    );
    this._stats.exercisesCompleted = completedExercises.size;

    if (natural) {
      this._cb.onDone?.(this._stats);
    }
    this._cb.onEnd?.(this._stats);
  }
}
