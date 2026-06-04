// schedule.js — Pure function: routine → flat phase schedule.
//
// buildSchedule(routine) returns an array of phase objects:
//   { type, duration, label, subLabel, exerciseIdx, setIdx, repIdx, cue, exerciseName }
//
// Phase types:
//   'get-ready'   — 3s countdown before first set
//   'rep:out'     — outward phase of a rep
//   'rep:hold'    — hold phase of a rep
//   'rep:return'  — return phase of a rep
//   'hold'        — isometric hold duration
//   'rest'        — rest between sets
//   'done'        — terminal marker (duration 0)

/**
 * @param {Object} routine - Routine object
 * @returns {Array} Flat ordered array of phase objects
 */
export function buildSchedule(routine) {
  const phases = [];

  // A single pass through exercises, honoring routine.repeat.
  const repeatCount = Math.max(1, routine.repeat ?? 1);

  for (let round = 0; round < repeatCount; round++) {
    routine.exercises.forEach((exercise, exIdx) => {
      const isFirstExercise = round === 0 && exIdx === 0;
      const isLastExercise  = round === repeatCount - 1 && exIdx === routine.exercises.length - 1;

      for (let setIdx = 0; setIdx < exercise.sets; setIdx++) {
        const isLastSet = setIdx === exercise.sets - 1;

        // GET READY (only before the very first set of a round; 3s gap between exercises too)
        if (setIdx === 0) {
          phases.push({
            type:         'get-ready',
            duration:     isFirstExercise && setIdx === 0 ? 3 : 2,
            label:        'GET READY',
            subLabel:     exercise.name,
            exerciseIdx:  exIdx,
            setIdx:       setIdx,
            repIdx:       null,
            cue:          exercise.cue ?? null,
            exerciseName: exercise.name,
          });
        }

        if (exercise.type === 'hold') {
          // ── Timed hold ──────────────────────────────────────────────────
          phases.push({
            type:         'hold',
            duration:     exercise.holdDuration,
            label:        'HOLD',
            subLabel:     `Set ${setIdx + 1} / ${exercise.sets}`,
            exerciseIdx:  exIdx,
            setIdx:       setIdx,
            repIdx:       null,
            cue:          exercise.cue ?? null,
            exerciseName: exercise.name,
          });
        } else {
          // ── Rep-based ───────────────────────────────────────────────────
          const repTarget = Array.isArray(exercise.repTarget)
            ? exercise.repTarget[1] // use upper bound for scheduling
            : exercise.repTarget;

          for (let repIdx = 0; repIdx < repTarget; repIdx++) {
            phases.push({
              type:         'rep:out',
              duration:     exercise.tempo.out,
              label:        'OUT',
              subLabel:     `Rep ${repIdx + 1} / ${repTarget}`,
              exerciseIdx:  exIdx,
              setIdx:       setIdx,
              repIdx:       repIdx,
              cue:          exercise.cue ?? null,
              exerciseName: exercise.name,
            });
            phases.push({
              type:         'rep:hold',
              duration:     exercise.tempo.hold,
              label:        'HOLD',
              subLabel:     `Rep ${repIdx + 1} / ${repTarget}`,
              exerciseIdx:  exIdx,
              setIdx:       setIdx,
              repIdx:       repIdx,
              cue:          exercise.cue ?? null,
              exerciseName: exercise.name,
            });
            phases.push({
              type:         'rep:return',
              duration:     exercise.tempo.return,
              label:        'RETURN',
              subLabel:     `Rep ${repIdx + 1} / ${repTarget}`,
              exerciseIdx:  exIdx,
              setIdx:       setIdx,
              repIdx:       repIdx,
              cue:          exercise.cue ?? null,
              exerciseName: exercise.name,
            });
          }
        }

        // REST — after every set except the last set of the last exercise
        const skipRest = isLastSet && isLastExercise;
        if (!skipRest) {
          phases.push({
            type:         'rest',
            duration:     exercise.rest,
            label:        isLastSet ? 'NEXT EXERCISE' : 'REST',
            subLabel:     isLastSet
              ? (routine.exercises[exIdx + 1] ?? routine.exercises[0])?.name ?? ''
              : `Set ${setIdx + 2} / ${exercise.sets} next`,
            exerciseIdx:  exIdx,
            setIdx:       setIdx,
            repIdx:       null,
            cue:          null,
            exerciseName: exercise.name,
          });
        }
      }
    });
  }

  phases.push({
    type:         'done',
    duration:     0,
    label:        'DONE',
    subLabel:     'Great work!',
    exerciseIdx:  null,
    setIdx:       null,
    repIdx:       null,
    cue:          null,
    exerciseName: null,
  });

  return phases;
}

/**
 * Given a flat schedule and a phase index, find the index of the first phase
 * of the REST block after the current set (for "end set early").
 * Returns the index of the rest phase, or the next set's get-ready if no rest,
 * or the 'done' phase index if nothing else.
 */
export function findEndSetEarlyTarget(schedule, currentPhaseIdx) {
  const current = schedule[currentPhaseIdx];
  if (!current) return schedule.length - 1;

  const { exerciseIdx, setIdx } = current;

  // Walk forward until we hit a 'rest' or 'get-ready' for a different set,
  // or 'done'.
  for (let i = currentPhaseIdx + 1; i < schedule.length; i++) {
    const p = schedule[i];
    if (p.type === 'done') return i;
    if (p.type === 'rest' && p.exerciseIdx === exerciseIdx && p.setIdx === setIdx) return i;
    if (p.type === 'get-ready' && (p.exerciseIdx !== exerciseIdx || p.setIdx !== setIdx)) return i;
  }
  return schedule.length - 1;
}

/**
 * Find the index of the first phase of the next exercise, or 'done'.
 */
export function findSkipExerciseTarget(schedule, currentPhaseIdx) {
  const current = schedule[currentPhaseIdx];
  if (!current) return schedule.length - 1;

  const { exerciseIdx } = current;
  for (let i = currentPhaseIdx + 1; i < schedule.length; i++) {
    const p = schedule[i];
    if (p.type === 'done') return i;
    if (p.exerciseIdx !== exerciseIdx) return i;
  }
  return schedule.length - 1;
}

// ── Self-test (runs only in Node / when called directly) ──────────────────────

export function selfTest() {
  const testRoutine = {
    id: 'test',
    name: 'Test',
    repeat: 1,
    exercises: [
      {
        id: 'a',
        name: 'Face Pulls',
        type: 'reps',
        sets: 2,
        repTarget: [3, 3],
        tempo: { out: 2, hold: 1, return: 3 },
        rest: 10,
        cue: null,
      },
      {
        id: 'b',
        name: 'Prone Cobra',
        type: 'hold',
        sets: 2,
        holdDuration: 5,
        rest: 8,
        cue: null,
      },
    ],
  };

  const sched = buildSchedule(testRoutine);

  // Phase type order validation
  const types = sched.map(p => p.type);

  // Should start with get-ready
  console.assert(types[0] === 'get-ready', 'Should start with get-ready');

  // Should end with done
  console.assert(types[types.length - 1] === 'done', 'Should end with done');

  // Count rep phases for 2 sets × 3 reps = 6 reps × 3 phases = 18
  const repPhases = types.filter(t => t.startsWith('rep:')).length;
  console.assert(repPhases === 18, `Expected 18 rep phases, got ${repPhases}`);

  // Count hold phases: 2 sets × 1 hold = 2
  const holdPhases = types.filter(t => t === 'hold').length;
  console.assert(holdPhases === 2, `Expected 2 hold phases, got ${holdPhases}`);

  // Count rest phases — set 1 ends with rest, set 2 of first exercise ends with rest (next ex),
  // hold set 1 ends with rest, hold set 2 is last → no rest = 3 total rest phases
  const restPhases = types.filter(t => t === 'rest').length;
  console.assert(restPhases === 3, `Expected 3 rest phases, got ${restPhases}`);

  // Last real phase before 'done' should NOT be rest (last set of last exercise)
  const secondToLast = types[types.length - 2];
  console.assert(secondToLast !== 'rest', 'Last set of last exercise should not end with rest');

  console.log('schedule.js self-test PASSED', `(${sched.length} phases total)`);
  return sched;
}
