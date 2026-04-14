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

const isSideVisible = (p1: NormalizedLandmark, p2: NormalizedLandmark, p3: NormalizedLandmark, threshold = 0.65) => {
  return (p1.visibility ?? 0) > threshold && (p2.visibility ?? 0) > threshold && (p3.visibility ?? 0) > threshold;
};

export class ExerciseTracker {
  private stage: 'UP' | 'DOWN' | null = null;
  private count: number = 0;
  private lastAnnouncement: number = -1;
  private target: number;
  
  private onCount: (count: number) => void;
  private onAnnounce: (msg: string) => void;
  private onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string }) => void;
  private onAsymmetry?: () => void;
  
  private lastAsymmetryTime: number = 0;
  private lastWarningTime: number = 0;

  // EMA state
  private lastAngles: { L: number | null; R: number | null; Primary: number | null } = {
    L: null, R: null, Primary: null
  };

  constructor(
    target: number, 
    onCount: (count: number) => void, 
    onAnnounce: (msg: string) => void,
    onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string }) => void,
    onAsymmetry?: () => void
  ) {
    this.target = target;
    this.onCount = onCount;
    this.onAnnounce = onAnnounce;
    this.onDebug = onDebug;
    this.onAsymmetry = onAsymmetry;
  }

  private triggerWarning(msg: string) {
    const now = Date.now();
    if (now - this.lastWarningTime > 3000) { // 3 seconds debounce for vocal warnings
      this.onAnnounce(msg);
      this.lastWarningTime = now;
    }
  }

  private checkAsymmetry(angleL: number, angleR: number, landmarks: NormalizedLandmark[], thresh = 30) {
    const visL = landmarks[13]?.visibility || 0;
    const visR = landmarks[14]?.visibility || 0;

    if (visL > 0.5 && visR > 0.5) {
      const diff = Math.abs(angleL - angleR);
      if (diff > thresh) {
        const now = Date.now();
        if (now - this.lastAsymmetryTime > 2000) {
          this.onAsymmetry?.();
          this.lastAsymmetryTime = now;
          return true;
        }
      }
    }
    return false;
  }

  updatePullup(landmarks: NormalizedLandmark[]) {
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lElbow = landmarks[13], rElbow = landmarks[14];
    const lWrist = landmarks[15], rWrist = landmarks[16];
    const lHip = landmarks[23], rHip = landmarks[24];
    const nose = landmarks[0];

    if (!lShoulder || !rShoulder || !lElbow || !rElbow || !lWrist || !rWrist) return;

    // Controllo di visibilità: se nessuna delle due braccia è ben visibile, non calcolare nulla
    const isLeftArmVisible = isSideVisible(lShoulder, lElbow, lWrist, 0.65);
    const isRightArmVisible = isSideVisible(rShoulder, rElbow, rWrist, 0.65);
    if (!isLeftArmVisible && !isRightArmVisible) return;

    let angleL = calculateAngle(lShoulder, lElbow, lWrist);
    let angleR = calculateAngle(rShoulder, rElbow, rWrist);

    angleL = applyEMA(angleL, this.lastAngles.L);
    angleR = applyEMA(angleR, this.lastAngles.R);
    this.lastAngles.L = angleL;
    this.lastAngles.R = angleR;

    const isAsymmetric = this.checkAsymmetry(angleL, angleR, landmarks);

    const visL = (lShoulder.visibility || 0) + (lElbow.visibility || 0) + (lWrist.visibility || 0);
    const visR = (rShoulder.visibility || 0) + (rElbow.visibility || 0) + (rWrist.visibility || 0);
    const avgAngle = (angleL * visL + angleR * visR) / (visL + visR || 1);

    let warning: string | undefined;

    // Kipping detection
    if (lHip && rHip) {
      const midShoulderX = (lShoulder.x + rShoulder.x) / 2;
      const midHipX = (lHip.x + rHip.x) / 2;
      const midShoulderY = (lShoulder.y + rShoulder.y) / 2;
      const midHipY = (lHip.y + rHip.y) / 2;
      
      const verticalDev = Math.atan2(Math.abs(midShoulderX - midHipX), Math.abs(midHipY - midShoulderY));
      const devDegrees = verticalDev * (180 / Math.PI);
      if (devDegrees > 15 && this.stage === 'UP') {
         warning = "Non dondolare col corpo!";
         this.triggerWarning(warning);
      }
    }

    this.onDebug?.({ angle: avgAngle, stage: this.stage, error: isAsymmetric, warning });

    // Hysteresis logic
    if (avgAngle > 150) {
      this.stage = 'DOWN';
    }

    // Chin over bar check using wrists Y position
    const barLevelY = (lWrist.y + rWrist.y) / 2;
    const chinOverBar = nose.y < barLevelY;

    if (this.stage === 'DOWN' && avgAngle < 80 && chinOverBar) {
      this.stage = 'UP';
      this.count++;
      this.onCount(this.count);
      this.checkAnnouncements();
    }
  }

  updatePushup(landmarks: NormalizedLandmark[]) {
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lElbow = landmarks[13], rElbow = landmarks[14];
    const lWrist = landmarks[15], rWrist = landmarks[16];
    
    // Core check
    const lHip = landmarks[23], rHip = landmarks[24];

    if (!lShoulder || !rShoulder || !lElbow || !rElbow || !lWrist || !rWrist) return;

    // Controllo di visibilità: se nessuna delle due braccia è ben visibile, non calcolare nulla
    const isLeftArmVisible = isSideVisible(lShoulder, lElbow, lWrist, 0.65);
    const isRightArmVisible = isSideVisible(rShoulder, rElbow, rWrist, 0.65);
    if (!isLeftArmVisible && !isRightArmVisible) return;

    let angleL = calculateAngle(lShoulder, lElbow, lWrist);
    let angleR = calculateAngle(rShoulder, rElbow, rWrist);

    angleL = applyEMA(angleL, this.lastAngles.L);
    angleR = applyEMA(angleR, this.lastAngles.R);
    this.lastAngles.L = angleL;
    this.lastAngles.R = angleR;

    const isAsymmetric = this.checkAsymmetry(angleL, angleR, landmarks);

    const visL = (lShoulder.visibility ?? 0) + (lElbow.visibility ?? 0) + (lWrist.visibility ?? 0);
    const visR = (rShoulder.visibility ?? 0) + (rElbow.visibility ?? 0) + (rWrist.visibility ?? 0);
    
    // In frontal views one arm could be randomly slightly less visible. Average them if both are visible, else pick best.
    let avgAngle = (angleL * visL + angleR * visR) / ((visL + visR) || 1);
    
    // Se siamo chiaramente laterali (un braccio coperto), affidiamoci a quello più visibile per non inquinare la media
    if (visL > visR * 1.5) avgAngle = angleL;
    if (visR > visL * 1.5) avgAngle = angleR;

    let warning: string | undefined;

    // Posture block logic has been softened. We don't want to completely block the user if the 3D projection 
    // evaluates a bad posture, because extreme angles (frontal/bottom-up) make landmarks skew.
    
    const shoulderHeight = Math.min(lShoulder.y, rShoulder.y);
    const hipHeight = Math.min(lHip?.y ?? 1, rHip?.y ?? 1);

    // If completely upright, it's not a pushup
    if (hipHeight > shoulderHeight + 0.3) {
      warning = "Mettiti a terra!";
    }

    this.onDebug?.({ angle: avgAngle, stage: this.stage, error: isAsymmetric, warning });

    if (warning && !this.stage) {
       // Only block INITIAL stage setting if they are literally standing up
       return;
    }

    // UP Threshold slightly lowered to 150 to account for 3D variations and different arm spans
    if (avgAngle > 150) {
      if (this.stage === 'DOWN') {
        this.count++;
        this.onCount(this.count);
        this.checkAnnouncements();
      }
      this.stage = 'UP';
    }

    // DOWN threshold increased to 100 so partial horizontal planes count
    if (avgAngle < 100) {
      this.stage = 'DOWN';
    }
  }

  updateSquat(landmarks: NormalizedLandmark[]) {
    const lHip = landmarks[23], rHip = landmarks[24];
    const lKnee = landmarks[25], rKnee = landmarks[26];
    const lAnkle = landmarks[27], rAnkle = landmarks[28];
    const lShoulder = landmarks[11], rShoulder = landmarks[12];

    if (!lHip || !rHip || !lKnee || !rKnee || !lAnkle || !rAnkle || !lShoulder || !rShoulder) return;

    // Controllo di visibilità: se nessuna delle due gambe è ben visibile, non calcolare nulla
    const isLeftLegVisible = isSideVisible(lHip, lKnee, lAnkle, 0.65);
    const isRightLegVisible = isSideVisible(rHip, rKnee, rAnkle, 0.65);
    if (!isLeftLegVisible && !isRightLegVisible) return;

    let kneeAngleL = calculateAngle(lHip, lKnee, lAnkle);
    let kneeAngleR = calculateAngle(rHip, rKnee, rAnkle);

    kneeAngleL = applyEMA(kneeAngleL, this.lastAngles.L);
    kneeAngleR = applyEMA(kneeAngleR, this.lastAngles.R);
    this.lastAngles.L = kneeAngleL;
    this.lastAngles.R = kneeAngleR;

    const visL = (lKnee.visibility || 0);
    const visR = (rKnee.visibility || 0);
    const avgKneeAngle = (kneeAngleL * visL + kneeAngleR * visR) / ((visL + visR) || 1);

    let warning: string | undefined;

    // Torso inclination check
    const side = visL > visR ? 'L' : 'R';
    let torsoAngle = 0; // relative to vertical
    if (side === 'L') {
       torsoAngle = Math.atan2(Math.abs(lShoulder.x - lHip.x), Math.abs(lHip.y - lShoulder.y)) * (180 / Math.PI);
    } else {
       torsoAngle = Math.atan2(Math.abs(rShoulder.x - rHip.x), Math.abs(rHip.y - rShoulder.y)) * (180 / Math.PI);
    }

    if (torsoAngle > 60) {
        warning = "Tieni il petto in alto!";
        this.triggerWarning(warning);
    }

    this.onDebug?.({ angle: avgKneeAngle, stage: this.stage, error: false, warning });

    // Squat DOWN threshold
    if (avgKneeAngle < 110) {
      this.stage = 'DOWN';
    }

    // Squat UP threshold
    if (this.stage === 'DOWN' && avgKneeAngle > 150) {
      this.stage = 'UP';
      this.count++;
      this.onCount(this.count);
      this.checkAnnouncements();
    }
  }


  private checkAnnouncements() {
    if (this.target !== Infinity) {
      if (this.count === this.target) {
        this.onAnnounce("ESERCIZIO FINITO");
      } else if (this.target - this.count === 3 && this.lastAnnouncement !== this.count) {
        this.onAnnounce("ULTIME TRE");
        this.lastAnnouncement = this.count;
      }
    }
  }

  getCount() {
    return this.count;
  }

  reset() {
    this.count = 0;
    this.stage = null;
    this.lastAnnouncement = -1;
    this.lastAngles = { L: null, R: null, Primary: null };
  }
}
