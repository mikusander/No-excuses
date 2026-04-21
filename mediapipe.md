# Rep counter module changes

## Files changed

- `src/pages/RepCounterPage.tsx`
- `src/hooks/useVoiceCommands.ts`
- `src/hooks/usePoseLandmarker.ts`
- `src/hooks/useAccelerometerRepCounter.ts`
- `src/logic/exerciseTracker.ts`

## Summary

The rep counter now supports two counting modes:

- **Video**: camera + MediaPipe pose detection
- **Accelerometer**: `DeviceMotionEvent`-based counting with the phone in the user's pocket

The exercise selection screen now includes a mode toggle.

## Video mode

### Behavior

Video mode keeps the MediaPipe flow and the existing voice-controlled start/stop logic:

- MediaPipe can initialize and the camera can start
- repetitions do **not** start immediately
- counting starts only after the existing workout-style voice start command (`vai` / `go`)
- counting stops on the existing stop command (`stop` / `fermo`)
- pause/resume remains separate from start/stop

### Relevant implementation details

- `RepCounterPage` keeps an `isCountingActive` gate for MediaPipe counting
- `useVoiceCommands` now supports start/stop callbacks in addition to pause/resume
- `ExerciseTracker.resetTrackingState()` clears transient pose-tracking state without resetting the total count

## Accelerometer mode

### New flow

When the user selects **Accelerometer** mode and then chooses an exercise:

1. the app requests motion permission if needed
2. a **30-second preparation countdown** starts on screen
3. the user can put the phone in their pocket and prepare
4. when the countdown ends, repetition counting starts automatically
5. the screen shows the live rep count
6. the user can:
   - **pause / resume** the session
   - **end the exercise**

### Important behavior notes

- **Voice commands are not used** in accelerometer mode
- **MediaPipe is not initialized** when accelerometer mode is selected
- counting is based on a generic motion-cycle detector using `DeviceMotionEvent`
- the same accelerometer logic is used for pullups, pushups, and squats in this version

### New hook

`src/hooks/useAccelerometerRepCounter.ts` was added to isolate the motion logic from the page UI.

It handles:

- support detection
- iOS motion permission requests
- the 30-second preparation countdown
- pause / resume
- reset / teardown
- repetition counting from device motion

### Motion counting logic

The hook listens to `devicemotion` events and uses:

- `accelerationIncludingGravity` as the primary source
- `acceleration` as fallback
- vector magnitude (`x`, `y`, `z`) to detect full motion cycles

The current algorithm is a simple generic detector:

- it smooths motion magnitude
- detects a movement peak above a threshold
- waits for the signal to settle back below a reset threshold
- increments the rep count once per full cycle with cooldown protection

## Rep counter page structure now

### Exercise selection screen

The page now has:

- an exercise selector
- a **Video / Accelerometer** toggle

### Video session screen

The video session screen remains camera-based and shows:

- the video preview
- pose overlay
- debug information
- pause button
- rep count

### Accelerometer session screen

The accelerometer session screen shows:

- selected exercise name
- preparation countdown or rep count
- status text
- pause/resume button
- end exercise button

## MediaPipe loading change

`usePoseLandmarker` now accepts an `enabled` flag.

This allows the app to:

- initialize MediaPipe only when a video-mode exercise session actually starts
- close and release the pose landmarker when video mode is not active

## Verification notes

### What was checked

- direct review of the modified files after each change
- logic review of the state transitions for:
  - video mode start/stop
  - accelerometer preparation countdown
  - accelerometer active counting
  - pause/resume
  - session reset/end

### Environment limitation

The local TypeScript build could not be executed in this environment because `tsc` is not installed:

- `npm run build` fails with `sh: tsc: command not found`

So verification here is based on code inspection and logic validation, not a local compiled build.
