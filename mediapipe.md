# MediaPipe rep counter changes

## Files changed

- `src/hooks/useVoiceCommands.ts`
- `src/pages/RepCounterPage.tsx`
- `src/logic/exerciseTracker.ts`

## What changed

### 1. Voice commands in the rep counter now reuse the existing workout commands

The shared voice hook now supports the same start/stop commands already used in the workout flow:

- start: `vai` / `go`
- stop: `stop` / `fermo`

The existing pause/resume commands were kept:

- pause: `pausa`
- resume: `riprendi` / `continua`

### 2. Rep counting no longer starts immediately after exercise selection

When the user selects an exercise:

- the camera starts
- MediaPipe pose detection starts
- the pose overlay can render
- the tracker is initialized
- **rep counting stays disabled until a voice start command is received**

### 3. Rep counting is now gated by an explicit session state

`RepCounterPage` now keeps a dedicated `isCountingActive` state.

The tracker updates for:

- pullups
- pushups
- squats

only run when `isCountingActive === true`.

This means pose detection can remain active without incrementing repetitions.

### 4. Stop/start transitions reset transient tracking state without losing the count

`ExerciseTracker` now exposes `resetTrackingState()`.

This clears only the motion-phase state used for detection:

- current stage
- startup posture state
- smoothed angle memory

It does **not** reset the repetition count.

This avoids false positives when the user stops the session, changes posture, and then starts again.

## How the repetition counting module works now

### Session flow

1. The user selects an exercise.
2. The app starts camera acquisition.
3. MediaPipe loads and begins pose detection.
4. Landmarks can still be rendered in the overlay.
5. The rep tracker does **not** count yet.
6. When the user says the existing start command (`vai` / `go`), counting becomes active.
7. While counting is active, pose landmarks are forwarded to the tracker and repetitions are counted normally.
8. When the user says the existing stop command (`stop` / `fermo`), counting is disabled again.
9. The current rep total is preserved.
10. If the user starts again, counting resumes from the same total with a fresh transient tracking state.

### Pause/resume behavior

Pause/resume remains separate from start/stop:

- `pausa` pauses the session
- `riprendi` / `continua` resumes the paused session
- `vai` / `go` controls whether rep counting is enabled
- `stop` / `fermo` disables rep counting without clearing the current total

### Reset behavior

Counting is reset to inactive when:

- the user selects a new exercise
- the user cancels the workout

In those cases the full tracker reset still clears the total repetition count as before.

## Verification notes

The local TypeScript build could not be executed in this environment because `tsc` is not installed (`npm run build` fails with `sh: tsc: command not found`).

The implementation was therefore checked by direct file review and logic validation after each change.
