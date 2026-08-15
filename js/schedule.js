// schedule.js — Pure function: routine → flat phase schedule.
//
// buildSchedule(routine) returns an array of phase objects:
//   { type, duration, label, subLabel, setLabel, exerciseIdx, setIdx, repIdx, cue, exerciseName }
//
// Phase types:
//   'get-ready'   — per-routine countdown before the first set
//   'rep:out'     — outward phase of a rep
//   'rep:hold'    — hold phase of a rep
//   'rep:return'  — return phase of a rep
//   'hold'        — isometric hold duration
//   'rest'        — rest between sets
//   'done'        — terminal marker (duration 0)

/**
 * Per-set label, cycling when there are fewer labels than sets.
 * Exercises saved before labels existed have no `labels` key at all.
 * @returns {string|null}
 */
function setLabelFor(exercise, setIdx) {
  const labels = exercise.labels;
  if (!Array.isArray(labels) || labels.length === 0) return null;
  return labels[setIdx % labels.length] || null;
}

/**
 * @param {Object} routine - Routine object, optionally with startCountdown
 * @returns {Array} Flat ordered array of phase objects
 */
export function buildSchedule(routine) {
  const phases = [];
  const requestedStartCountdown = Number.parseInt(routine.startCountdown, 10);
  const startCountdown = Number.isFinite(requestedStartCountdown)
    ? Math.min(120, Math.max(5, requestedStartCountdown))
    : 15;

  // A single pass through exercises, honoring routine.repeat.
  const repeatCount = Math.max(1, routine.repeat ?? 1);

  for (let round = 0; round < repeatCount; round++) {
    routine.exercises.forEach((exercise, exIdx) => {
      const isFirstExercise = round === 0 && exIdx === 0;
      const isLastExercise =
        round === repeatCount - 1 && exIdx === routine.exercises.length - 1;

      for (let setIdx = 0; setIdx < exercise.sets; setIdx++) {
        const isLastSet = setIdx === exercise.sets - 1;
        const setLabel = setLabelFor(exercise, setIdx);

        // GET READY (only before the very first set of a round; 2s gap between exercises too)
        if (setIdx === 0) {
          phases.push({
            type: "get-ready",
            duration: isFirstExercise && setIdx === 0 ? startCountdown : 2,
            label: "GET READY",
            subLabel: exercise.name,
            setLabel,
            exerciseIdx: exIdx,
            setIdx: setIdx,
            repIdx: null,
            cue: exercise.cue ?? null,
            exerciseName: exercise.name,
          });
        }

        if (exercise.type === "hold") {
          // ── Timed hold ──────────────────────────────────────────────────
          phases.push({
            type: "hold",
            duration: exercise.holdDuration,
            label: "HOLD",
            subLabel: `Set ${setIdx + 1} / ${exercise.sets}`,
            setLabel,
            exerciseIdx: exIdx,
            setIdx: setIdx,
            repIdx: null,
            cue: exercise.cue ?? null,
            exerciseName: exercise.name,
          });
        } else {
          // ── Rep-based ───────────────────────────────────────────────────
          const repTarget = Array.isArray(exercise.repTarget)
            ? exercise.repTarget[1] // use upper bound for scheduling
            : exercise.repTarget;

          for (let repIdx = 0; repIdx < repTarget; repIdx++) {
            phases.push({
              type: "rep:out",
              duration: exercise.tempo.out,
              label: "OUT",
              subLabel: `Rep ${repIdx + 1} / ${repTarget}`,
              setLabel,
              exerciseIdx: exIdx,
              setIdx: setIdx,
              repIdx: repIdx,
              cue: exercise.cue ?? null,
              exerciseName: exercise.name,
            });
            // A zero-second hold means no hold at all: do not create a phase
            // that the cue system could announce before immediately skipping.
            if (Number(exercise.tempo?.hold) > 0) {
              phases.push({
                type: "rep:hold",
                duration: exercise.tempo.hold,
                label: "HOLD",
                subLabel: `Rep ${repIdx + 1} / ${repTarget}`,
                setLabel,
                exerciseIdx: exIdx,
                setIdx: setIdx,
                repIdx: repIdx,
                cue: exercise.cue ?? null,
                exerciseName: exercise.name,
              });
            }
            phases.push({
              type: "rep:return",
              duration: exercise.tempo.return,
              label: "RETURN",
              subLabel: `Rep ${repIdx + 1} / ${repTarget}`,
              setLabel,
              exerciseIdx: exIdx,
              setIdx: setIdx,
              repIdx: repIdx,
              cue: exercise.cue ?? null,
              exerciseName: exercise.name,
            });
          }
        }

        // REST — after every set except the last set of the last exercise
        const skipRest = isLastSet && isLastExercise;
        if (!skipRest) {
          // A rest phase looks forward: its label belongs to the set it leads into.
          const nextExercise =
            routine.exercises[exIdx + 1] ?? routine.exercises[0];
          const upcomingExercise = isLastSet ? nextExercise : exercise;
          phases.push({
            type: "rest",
            duration: exercise.rest,
            label: isLastSet ? "NEXT EXERCISE" : "REST",
            subLabel: isLastSet
              ? (nextExercise?.name ?? "")
              : `Set ${setIdx + 2} / ${exercise.sets} next`,
            setLabel: isLastSet
              ? nextExercise
                ? setLabelFor(nextExercise, 0)
                : null
              : setLabelFor(exercise, setIdx + 1),
            exerciseIdx: exIdx,
            setIdx: setIdx,
            repIdx: null,
            cue: null,
            exerciseName: exercise.name,
            nextExerciseName: upcomingExercise?.name ?? "",
          });
        }
      }
    });
  }

  phases.push({
    type: "done",
    duration: 0,
    label: "DONE",
    subLabel: "Great work!",
    setLabel: null,
    exerciseIdx: null,
    setIdx: null,
    repIdx: null,
    cue: null,
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
    if (p.type === "done") return i;
    if (
      p.type === "rest" &&
      p.exerciseIdx === exerciseIdx &&
      p.setIdx === setIdx
    )
      return i;
    if (
      p.type === "get-ready" &&
      (p.exerciseIdx !== exerciseIdx || p.setIdx !== setIdx)
    )
      return i;
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
    if (p.type === "done") return i;
    if (p.exerciseIdx !== exerciseIdx) return i;
  }
  return schedule.length - 1;
}

// ── Self-test (runs only in Node / when called directly) ──────────────────────

export function selfTest() {
  const testRoutine = {
    id: "test",
    name: "Test",
    repeat: 1,
    exercises: [
      {
        id: "a",
        name: "Face Pulls",
        type: "reps",
        sets: 2,
        repTarget: [3, 3],
        tempo: { out: 2, hold: 1, return: 3 },
        rest: 10,
        cue: null,
      },
      {
        id: "b",
        name: "Prone Cobra",
        type: "hold",
        sets: 2,
        holdDuration: 5,
        rest: 8,
        cue: null,
      },
    ],
  };

  const sched = buildSchedule(testRoutine);

  // Phase type order validation
  const types = sched.map((p) => p.type);

  // Should start with get-ready
  console.assert(types[0] === "get-ready", "Should start with get-ready");
  console.assert(
    sched[0].duration === 15,
    `Expected missing start countdown to default to 15, got ${sched[0].duration}`,
  );
  const shortStartSchedule = buildSchedule({
    ...testRoutine,
    startCountdown: 5,
  });
  console.assert(
    shortStartSchedule[0].duration === 5,
    `Expected per-routine start countdown to be 5, got ${shortStartSchedule[0].duration}`,
  );

  // Should end with done
  console.assert(types[types.length - 1] === "done", "Should end with done");

  // Count rep phases for 2 sets × 3 reps = 6 reps × 3 phases = 18
  const repPhases = types.filter((t) => t.startsWith("rep:")).length;
  console.assert(repPhases === 18, `Expected 18 rep phases, got ${repPhases}`);

  // Count hold phases: 2 sets × 1 hold = 2
  const holdPhases = types.filter((t) => t === "hold").length;
  console.assert(holdPhases === 2, `Expected 2 hold phases, got ${holdPhases}`);

  // Count rest phases — set 1 ends with rest, set 2 of first exercise ends with rest (next ex),
  // hold set 1 ends with rest, hold set 2 is last → no rest = 3 total rest phases
  const restPhases = types.filter((t) => t === "rest").length;
  console.assert(restPhases === 3, `Expected 3 rest phases, got ${restPhases}`);

  const noHoldSchedule = buildSchedule({
    ...testRoutine,
    exercises: [
      {
        ...testRoutine.exercises[0],
        sets: 1,
        repTarget: [1, 1],
        tempo: { out: 2, hold: 0, return: 3 },
      },
    ],
  });
  console.assert(
    !noHoldSchedule.some((p) => p.type === "rep:hold"),
    "A zero-second rep hold should not create a hold phase",
  );

  // Exercises with no labels carry setLabel: null everywhere
  console.assert(
    sched.every((p) => p.setLabel === null),
    "An unlabelled routine should produce no set labels",
  );

  // Labels cycle when there are fewer labels than sets
  const labelled = buildSchedule({
    ...testRoutine,
    exercises: [
      {
        ...testRoutine.exercises[0],
        sets: 3,
        labels: ["Left", "Right"],
      },
    ],
  });
  const readyLabels = labelled
    .filter((p) => p.type === "get-ready")
    .map((p) => p.setLabel);
  console.assert(
    readyLabels.length === 1 && readyLabels[0] === "Left",
    `Expected one get-ready labelled Left, got ${JSON.stringify(readyLabels)}`,
  );
  const setLabelsInOrder = labelled
    .filter((p) => p.type === "rep:out" && p.repIdx === 0)
    .map((p) => p.setLabel);
  console.assert(
    JSON.stringify(setLabelsInOrder) ===
      JSON.stringify(["Left", "Right", "Left"]),
    `Labels should wrap: got ${JSON.stringify(setLabelsInOrder)}`,
  );

  // A rest phase names the set it leads INTO, not the one just finished
  const restLabels = labelled
    .filter((p) => p.type === "rest")
    .map((p) => p.setLabel);
  console.assert(
    JSON.stringify(restLabels) === JSON.stringify(["Right", "Left"]),
    `Rest labels should look forward: got ${JSON.stringify(restLabels)}`,
  );

  const restNextExerciseNames = sched
    .filter((p) => p.type === "rest")
    .map((p) => p.nextExerciseName);
  console.assert(
    JSON.stringify(restNextExerciseNames) ===
      JSON.stringify(["Face Pulls", "Prone Cobra", "Prone Cobra"]),
    `Rest phases should identify their upcoming exercise: got ${JSON.stringify(restNextExerciseNames)}`,
  );

  // Last real phase before 'done' should NOT be rest (last set of last exercise)
  const secondToLast = types[types.length - 2];
  console.assert(
    secondToLast !== "rest",
    "Last set of last exercise should not end with rest",
  );

  console.log("schedule.js self-test PASSED", `(${sched.length} phases total)`);
  return sched;
}
