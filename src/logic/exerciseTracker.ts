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
