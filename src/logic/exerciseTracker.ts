/**
 * exerciseTracker.ts — State machine per il conteggio automatico delle ripetizioni via MediaPipe.
 *
 * Riceve in input i landmark normalizzati di MediaPipe PoseLandmarker frame-per-frame e
 * conta le ripetizioni valide per due esercizi: pull-up (trazioni) e push-up (flessioni).
 *
 * ──────────────────────────────────────────────────────────────────────────────────────
 * ARCHITETTURA GENERALE
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * La classe `ExerciseTracker` implementa una macchina a stati con due fasi: UP e DOWN.
 * La transizione tra le fasi viene rilevata monitorando il movimento verticale delle spalle
 * (asse Y dei landmark, normalizzato [0,1] dove 0=cima, 1=fondo dello schermo).
 *
 * PULL-UP (trazioni):
 *   - DOWN: le spalle sono SOTTO la sbarra (smoothed > 0.08)
 *   - UP:   le spalle raggiungono/superano la sbarra (smoothed < 0.04)
 *   - Metrica: `shoulderToBar` = shoulderY - barY (media Y dei polsi)
 *             Valori positivi = spalle sotto la sbarra; negativi = spalle sopra
 *   - Validazione: le spalle devono essersi spostate di almeno SHOULDER_MOVE_THRESHOLD (5%)
 *                  e i polsi devono essere rimasti stabili (< WRIST_MOVE_THRESHOLD) per
 *                  escludere falsi positivi da movimento della fotocamera
 *
 * PUSH-UP (flessioni):
 *   - UP:   posizione di partenza (braccia distese)
 *   - DOWN: le spalle scendono di oltre EXCURSION_THRESHOLD (10%)
 *   - Rep contata quando le spalle risalgono oltre EXCURSION_THRESHOLD dalla posizione più bassa
 *   - Validazione: stesso controllo sulla stabilità dei polsi (esclude movimento del telefono)
 *
 * ──────────────────────────────────────────────────────────────────────────────────────
 * SMOOTHING / FILTRO EMA
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Per le trazioni, la metrica `shoulderToBar` viene filtrata con una media mobile
 * esponenziale (EMA, alpha=0.4) per ridurre il rumore dei landmark frame-per-frame.
 * L'EMA bilancia reattività (alpha alto) e stabilità (alpha basso).
 *
 * ──────────────────────────────────────────────────────────────────────────────────────
 * VALIDAZIONE ANTI-FALSI-POSITIVI
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Il tracker mantiene uno snapshot della fase DOWN (`downPhaseSnapshot`) che registra:
 *  - La posizione Y più bassa/alta delle spalle raggiunta
 *  - Le coordinate Y dei polsi all'inizio del movimento
 *
 * Al termine di ogni rep, confronta le coordinate attuali dei polsi con quelle dello
 * snapshot: se i polsi si sono spostati oltre la soglia, la rep viene rifiutata
 * (il telefono probabilmente si è mosso, non le spalle dell'utente).
 *
 * ──────────────────────────────────────────────────────────────────────────────────────
 * FUNZIONE `calculateAngle`
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Utility esportata per calcolare l'angolo 3D tra tre punti (a-b-c, con b come vertice).
 * Usa il prodotto scalare dei vettori v1=(a-b) e v2=(c-b) per essere invariante
 * alla prospettiva della fotocamera (frontale vs laterale).
 * Non attualmente usata per il conteggio reps, ma disponibile per futuri esercizi
 * basati sull'angolo delle articolazioni (es. squat, curl).
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface Point {
  x: number;
  y: number;
  z?: number;
}

export const calculateAngle = (a: Point, b: Point, c: Point): number => {
  // Use 3D angle calculation to be invariant to camera perspective (frontal vs lateral)
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };

  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

  if (mag1 === 0 || mag2 === 0) return 0;

  // Math.acos expects value between -1 and 1
  const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
  return angleRad * (180.0 / Math.PI);
};

const applyEMA = (current: number, prev: number | null, alpha = 0.4): number => {
  if (prev === null) return current;
  return alpha * current + (1 - alpha) * prev;
};

interface LandmarkSample {
  y: number;
  timestamp: number;
}

interface DownPhaseSnapshot {
  shoulderY: number;
  leftWristY?: number;
  rightWristY?: number;
  leftWristVisible: boolean;
  rightWristVisible: boolean;
  peakShoulderMovement?: number;
}

export class ExerciseTracker {
  private stage: 'UP' | 'DOWN' | null = null;
  private count: number = 0;

  private onCount: (count: number) => void;
  private onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string; okMsg?: string }) => void;
  private hasStarted: boolean = false;

  // EMA state
  private lastAngles: { L: number | null; R: number | null; Primary: number | null } = {
    L: null, R: null, Primary: null
  };

  // Tracking history for validation
  private wristYHistory: LandmarkSample[] = [];
  private shoulderYHistory: LandmarkSample[] = [];
  private downPhaseSnapshot: DownPhaseSnapshot | null = null;

  // Motion threshold constants
  private SHOULDER_MOVE_THRESHOLD = 0.05; // Minimum vertical shoulder displacement to count a rep
  private WRIST_MOVE_THRESHOLD = 0.02; // Maximum wrist vertical movement to consider hands stationary

  constructor(
    onCount: (count: number) => void,
    onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string; okMsg?: string }) => void
  ) {
    this.onCount = onCount;
    this.onDebug = onDebug;
  }

  /**
   * Updates wrist Y coordinate history using the average of visible wrist landmarks.
   */
  private updateWristHistory(lWrist: NormalizedLandmark | undefined, rWrist: NormalizedLandmark | undefined) {
    const wristYValues: number[] = [];
    if (lWrist && (lWrist.visibility ?? 0) > 0.4) wristYValues.push(lWrist.y);
    if (rWrist && (rWrist.visibility ?? 0) > 0.4) wristYValues.push(rWrist.y);

    if (wristYValues.length > 0) {
      const avgWristY = wristYValues.reduce((a, b) => a + b, 0) / wristYValues.length;
      this.wristYHistory.push({ y: avgWristY, timestamp: Date.now() });

      // Maintain only the last 1000ms of history
      const cutoff = Date.now() - 1000;
      this.wristYHistory = this.wristYHistory.filter(s => s.timestamp >= cutoff);
    }
  }

  /**
   * Updates shoulder Y coordinate history using the average of visible shoulder landmarks.
   */
  private updateShoulderHistory(lShoulder: NormalizedLandmark | undefined, rShoulder: NormalizedLandmark | undefined) {
    const shoulderYValues: number[] = [];
    if (lShoulder && (lShoulder.visibility ?? 0) > 0.4) shoulderYValues.push(lShoulder.y);
    if (rShoulder && (rShoulder.visibility ?? 0) > 0.4) shoulderYValues.push(rShoulder.y);

    if (shoulderYValues.length > 0) {
      const avgShoulderY = shoulderYValues.reduce((a, b) => a + b, 0) / shoulderYValues.length;
      this.shoulderYHistory.push({ y: avgShoulderY, timestamp: Date.now() });

      // Maintain only the last 1000ms of history
      const cutoff = Date.now() - 1000;
      this.shoulderYHistory = this.shoulderYHistory.filter(s => s.timestamp >= cutoff);
    }
  }

  updatePullup(landmarks: NormalizedLandmark[]) {
    // Pullup tracking requires shoulder (11, 12) and wrist (15, 16) landmarks
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lWrist = landmarks[15], rWrist = landmarks[16];

    if (!lShoulder || !rShoulder || (!lWrist && !rWrist)) return;

    // Validate visibility of shoulders and at least one wrist
    const lShoulderVis = (lShoulder.visibility ?? 0) > 0.4;
    const rShoulderVis = (rShoulder.visibility ?? 0) > 0.4;
    const lWristVis = (lWrist?.visibility ?? 0) > 0.4;
    const rWristVis = (rWrist?.visibility ?? 0) > 0.4;
    if (!lShoulderVis && !rShoulderVis) return;
    if (!lWristVis && !rWristVis) return;

    // Update histories
    this.updateWristHistory(lWrist, rWrist);
    this.updateShoulderHistory(lShoulder, rShoulder);

    // Bar height is calculated as the average Y of the visible wrists (lower Y = higher on screen)
    const wristYValues: number[] = [];
    if (lWristVis && lWrist) wristYValues.push(lWrist.y);
    if (rWristVis && rWrist) wristYValues.push(rWrist.y);
    const barY = wristYValues.reduce((a, b) => a + b, 0) / wristYValues.length;

    // Distance metric: shoulderToBar > 0 means shoulders are below the bar (hanging phase)
    // shoulderToBar < 0 means shoulders are above the bar (completed pullup phase)
    const shoulderYValues: number[] = [];
    if (lShoulderVis) shoulderYValues.push(lShoulder.y);
    if (rShoulderVis) shoulderYValues.push(rShoulder.y);
    const shoulderY = shoulderYValues.reduce((a, b) => a + b, 0) / shoulderYValues.length;
    const rawShoulderToBar = shoulderY - barY;
    const smoothed = applyEMA(rawShoulderToBar, this.lastAngles.Primary);
    this.lastAngles.Primary = smoothed;

    // Send raw relative distance metric to debug callback
    this.onDebug?.({ angle: Math.round(smoothed * 1000) / 10, stage: this.stage });

    // DOWN phase: shoulders are clearly below the bar (full hang position)
    if (smoothed > 0.08) {
      if (this.stage !== 'DOWN') {
        // Initialize down phase snapshot
        this.downPhaseSnapshot = {
          shoulderY,
          leftWristY: lWristVis && lWrist ? lWrist.y : undefined,
          rightWristY: rWristVis && rWrist ? rWrist.y : undefined,
          leftWristVisible: !!lWristVis,
          rightWristVisible: !!rWristVis,
        };
        this.stage = 'DOWN';
      } else if (this.downPhaseSnapshot) {
        // Track the lowest shoulder Y position during hang phase
        if (shoulderY > this.downPhaseSnapshot.shoulderY) {
          this.downPhaseSnapshot.shoulderY = shoulderY;
        }

        // Continuously update wrist Y coordinate while in full hang to clear initial settling noise.
        // Once the pull movement starts (smoothed <= 0.08), coordinates will freeze for movement validation.
        if (lWristVis && lWrist) this.downPhaseSnapshot.leftWristY = lWrist.y;
        if (rWristVis && rWrist) this.downPhaseSnapshot.rightWristY = rWrist.y;
      }
    }

    // UP phase: shoulders reach or exceed the bar level
    if (this.stage === 'DOWN' && smoothed < 0.04) {
      let isValid = false;
      const reasons: string[] = [];

      if (this.downPhaseSnapshot) {
        // Calculate total vertical shoulder displacement
        const shoulderMovement = Math.abs(shoulderY - this.downPhaseSnapshot.shoulderY);

        // Check if wrists remained stationary to avoid camera/phone movement false positives
        let leftWristMoved = false;
        let rightWristMoved = false;
        let leftVal = 0;
        let rightVal = 0;

        if (this.downPhaseSnapshot.leftWristVisible) {
          if (!lWristVis || !lWrist) {
            leftWristMoved = true;
          } else {
            leftVal = Math.abs(lWrist.y - (this.downPhaseSnapshot.leftWristY ?? lWrist.y));
            leftWristMoved = leftVal >= this.WRIST_MOVE_THRESHOLD;
          }
        }

        if (this.downPhaseSnapshot.rightWristVisible) {
          if (!rWristVis || !rWrist) {
            rightWristMoved = true;
          } else {
            rightVal = Math.abs(rWrist.y - (this.downPhaseSnapshot.rightWristY ?? rWrist.y));
            rightWristMoved = rightVal >= this.WRIST_MOVE_THRESHOLD;
          }
        }

        const wristsStable = !(leftWristMoved || rightWristMoved);
        const shouldersMoved = shoulderMovement >= this.SHOULDER_MOVE_THRESHOLD;

        if (!shouldersMoved) reasons.push('shoulders_not_moving');
        if (!wristsStable) reasons.push('wrists_moving');

        this.onDebug?.({
          angle: Math.round(smoothed * 1000) / 10,
          stage: this.stage,
          warning: reasons.length ? `Invalid repetition: ${reasons.join(', ')}` : undefined,
          okMsg: `shoulderMove=${shoulderMovement.toFixed(3)} leftWrist=${leftVal.toFixed(3)} rightWrist=${rightVal.toFixed(3)}`
        });

        isValid = shouldersMoved && wristsStable;
      } else {
        isValid = false;
      }

      // Reset phase state to UP to continue tracking subsequent repetitions
      this.stage = 'UP';

      if (isValid) {
        this.count++;
        this.onCount(this.count);
      }

      this.downPhaseSnapshot = null;
    }
  }

  updatePushup(landmarks: NormalizedLandmark[]) {
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lWrist = landmarks[15], rWrist = landmarks[16];

    if (!lShoulder || !rShoulder || !lWrist || !rWrist) return;

    // Check visibilities
    const lShoulderVis = (lShoulder.visibility ?? 0) > 0.5;
    const rShoulderVis = (rShoulder.visibility ?? 0) > 0.5;
    const lWristVis = (lWrist.visibility ?? 0) > 0.5;
    const rWristVis = (rWrist.visibility ?? 0) > 0.5;

    const isLeftArmVisible = lShoulderVis && lWristVis;
    const isRightArmVisible = rShoulderVis && rWristVis;

    if (!isLeftArmVisible && !isRightArmVisible) return;

    const shoulderYValues = [];
    if (lShoulderVis) shoulderYValues.push(lShoulder.y);
    if (rShoulderVis) shoulderYValues.push(rShoulder.y);
    const shoulderY = shoulderYValues.reduce((a, b) => a + b, 0) / shoulderYValues.length;

    // Relational shoulder excursion relative to starting position
    const EXCURSION_THRESHOLD = 0.10;
    const PUSHUP_WRIST_THRESHOLD = 0.05; // Slightly higher wrist variance threshold for pushups

    this.onDebug?.({ angle: Math.round(shoulderY * 1000) / 1000, stage: this.stage });

    if (!this.hasStarted) {
      this.hasStarted = true;
      this.stage = 'UP';
      this.downPhaseSnapshot = {
        shoulderY,
        leftWristY: lWristVis ? lWrist.y : undefined,
        rightWristY: rWristVis ? rWrist.y : undefined,
        leftWristVisible: isLeftArmVisible,
        rightWristVisible: isRightArmVisible,
        peakShoulderMovement: 0
      };
      return;
    }

    if (this.stage === 'UP' && this.downPhaseSnapshot) {
      // In the UP phase, track the minimum Y (highest vertical position)
      if (shoulderY < this.downPhaseSnapshot.shoulderY) {
        this.downPhaseSnapshot.shoulderY = shoulderY;
      }

      // If the shoulders move down past the excursion threshold
      if (shoulderY - this.downPhaseSnapshot.shoulderY > EXCURSION_THRESHOLD) {
        this.stage = 'DOWN';
        this.downPhaseSnapshot.peakShoulderMovement = shoulderY;
        if (lWristVis) this.downPhaseSnapshot.leftWristY = lWrist.y;
        if (rWristVis) this.downPhaseSnapshot.rightWristY = rWrist.y;
      }
    } else if (this.stage === 'DOWN' && this.downPhaseSnapshot) {
      // In the DOWN phase, track the maximum Y (lowest vertical position, closest to floor)
      if (shoulderY > (this.downPhaseSnapshot.peakShoulderMovement ?? shoulderY)) {
        this.downPhaseSnapshot.peakShoulderMovement = shoulderY;
        // Capture baseline wrist coordinates at the absolute bottom of the pushup
        if (lWristVis) this.downPhaseSnapshot.leftWristY = lWrist.y;
        if (rWristVis) this.downPhaseSnapshot.rightWristY = rWrist.y;
      }

      // If the shoulders rise back up past the excursion threshold
      if ((this.downPhaseSnapshot.peakShoulderMovement ?? shoulderY) - shoulderY > EXCURSION_THRESHOLD) {
        // Validate that wrists remained stationary to filter out camera movement or translation
        let leftWristMoved = false;
        let rightWristMoved = false;
        let leftVal = 0;
        let rightVal = 0;

        if (this.downPhaseSnapshot.leftWristVisible) {
          if (!lWristVis) leftWristMoved = true;
          else {
            leftVal = Math.abs(lWrist.y - (this.downPhaseSnapshot.leftWristY ?? lWrist.y));
            leftWristMoved = leftVal >= PUSHUP_WRIST_THRESHOLD;
          }
        }
        if (this.downPhaseSnapshot.rightWristVisible) {
          if (!rWristVis) rightWristMoved = true;
          else {
            rightVal = Math.abs(rWrist.y - (this.downPhaseSnapshot.rightWristY ?? rWrist.y));
            rightWristMoved = rightVal >= PUSHUP_WRIST_THRESHOLD;
          }
        }

        const wristsStable = !(leftWristMoved || rightWristMoved);

        if (wristsStable) {
          this.count++;
          this.onCount(this.count);
        }

        this.onDebug?.({
          angle: shoulderY,
          stage: 'UP',
          warning: !wristsStable ? `Motion validation failed (L:${leftVal.toFixed(2)} R:${rightVal.toFixed(2)})` : undefined,
          okMsg: wristsStable ? `Repetition validated (L:${leftVal.toFixed(2)} R:${rightVal.toFixed(2)})` : undefined
        });

        // Reset state for next repetition tracking
        this.stage = 'UP';
        this.downPhaseSnapshot = {
          shoulderY,
          leftWristY: lWristVis ? lWrist.y : undefined,
          rightWristY: rWristVis ? rWrist.y : undefined,
          leftWristVisible: isLeftArmVisible,
          rightWristVisible: isRightArmVisible,
          peakShoulderMovement: 0
        };
      }
    }
  }

  getCount() {
    return this.count;
  }

  resetTrackingState() {
    this.stage = null;
    this.hasStarted = false;
    this.lastAngles = { L: null, R: null, Primary: null };
    this.wristYHistory = [];
    this.shoulderYHistory = [];
    this.downPhaseSnapshot = null;
  }

  reset() {
    this.count = 0;
    this.resetTrackingState();
  }
}
