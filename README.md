# No-Excuses 

A multimodal web app for **hands-free, eyes-free workout tracking** — no smartwatch required.

🔗 **Live app:** [no-excuses-cv39.vercel.app](https://no-excuses-cv39.vercel.app/)

---

## What it does

No-Excuses lets you track your workouts without ever touching your phone during a set. It uses your smartphone's built-in sensors and camera to count repetitions automatically, and speaks every count aloud so you never need to look at the screen.

---

## How it works

###  Workout Routines
Create and manage training programs directly in the app. Each routine supports multiple exercise types:
- **Reps** — classic sets with a fixed rep count
- **Isometry** — timed holds (plank, wall sit)
- **Superset** — two or more exercises back-to-back
- **Pyramid** — progressive load/rep schemes
- **EMOM** — Every Minute On the Minute

Once created, tap a routine to start a guided session. The app walks you through every exercise, automatically tracks rest timers, and saves your session history.

### Pocket Mode (Accelerometer)
Put your phone in your pocket and start a set. The app uses the accelerometer and gyroscope to detect each repetition and announces the count aloud. A 5-second countdown lets you get into position before counting starts.

Works for: **pushups, squats, lunges**, and other floor/ground exercises.

###  Stand Mode (Camera)
Prop your phone against a wall so the front camera frames your body. Google MediaPipe tracks your body landmarks in real time directly in the browser (no data is sent to any server) and counts your reps automatically.

Works for: **pullups, chin-ups**, and bar exercises.

### 🎤 Voice Commands
During a guided workout session, control everything with your voice — no touching needed:

| Say | Action |
|-----|--------|
| *"Vai"* | Start / advance to next set |
| *"Pausa"* | Pause the timer |
| *"Riprendi"* | Resume |
| *"Stop"* | End the session |

###  Audio & Haptic Feedback
The app communicates its state entirely through sound and vibration:
- **3-tone chime** when the countdown ends and counting starts
- **Short beep + vibration** on every confirmed repetition
- **Spoken count** after each rep ("One", "Two", …)
- **Goal chime** when you hit your target rep count
- **Voice announcements** during rest timers

---

## Tech stack

- **React + TypeScript** (Vite PWA)
- **Google MediaPipe Pose** — on-device body landmark detection via WebAssembly
- **Web Speech API** — voice recognition and speech synthesis
- **Web Audio API** — real-time audio feedback
- **DeviceMotion / DeviceOrientation** — accelerometer + gyroscope
- **Supabase** — authentication and workout history (no sensor data is ever stored)

---

## Privacy

All sensor and camera processing happens **100% on your device**. No video frames, motion data, or biometrics are ever sent to a server.

---

## Getting started (local dev)

```bash
npm install
npm run dev
```

Requires HTTPS or localhost for `DeviceMotion` permission on iOS.

---

## link to the video demo

🔗 **Video:** [VideoDemo](https://youtu.be/tBPbmQmYDGo?is=N2I2UZESG_gdOvsi)