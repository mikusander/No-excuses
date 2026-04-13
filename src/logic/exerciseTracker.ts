import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface Point {
  x: number;
  y: number;
  z?: number;
}

export const calculateAngle = (a: Point, b: Point, c: Point): number => {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);

  if (angle > 180.0) {
    angle = 360 - angle;
  }

  return angle;
};

const applyEMA = (current: number, prev: number | null, alpha = 0.4): number => {
  if (prev === null) return current;
  return alpha * current + (1 - alpha) * prev;
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
  private isInvalidated: boolean = false;

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
    const lAnkle = landmarks[27], rAnkle = landmarks[28];

    if (!lShoulder || !rShoulder || !lElbow || !rElbow || !lWrist || !rWrist) return;

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

    // Hip sagging check
    if (lHip && lAnkle && rHip && rAnkle) {
       // use the most visible side
       const side = (lShoulder.visibility || 0) > (rShoulder.visibility || 0) ? 'L' : 'R';
       let spineAngle = 180;
       
       if (side === 'L') {
          spineAngle = calculateAngle(lShoulder, lHip, lAnkle);
       } else {
          spineAngle = calculateAngle(rShoulder, rHip, rAnkle);
       }

       if (spineAngle < 155) {
         warning = "Alza il bacino!";
         this.isInvalidated = true;
         this.triggerWarning(warning);
       } else if (spineAngle > 165) {
         this.isInvalidated = false;
       }
    }

    this.onDebug?.({ angle: avgAngle, stage: this.stage, error: isAsymmetric, warning });

    if (this.isInvalidated) return; // Block state progression if form is bad

    if (avgAngle > 155) {
      if (this.stage === 'DOWN') {
        this.count++;
        this.onCount(this.count);
        this.checkAnnouncements();
      }
      this.stage = 'UP';
    }

    if (avgAngle < 90) {
      this.stage = 'DOWN';
    }
  }

  updateSquat(landmarks: NormalizedLandmark[]) {
    const lHip = landmarks[23], rHip = landmarks[24];
    const lKnee = landmarks[25], rKnee = landmarks[26];
    const lAnkle = landmarks[27], rAnkle = landmarks[28];
    const lShoulder = landmarks[11], rShoulder = landmarks[12];

    if (!lHip || !rHip || !lKnee || !rKnee || !lAnkle || !rAnkle || !lShoulder || !rShoulder) return;

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

    if (torsoAngle > 45) {
        warning = "Tieni il petto in alto!";
        this.triggerWarning(warning);
        this.isInvalidated = true;
    } else if (torsoAngle < 40) {
        this.isInvalidated = false;
    }

    this.onDebug?.({ angle: avgKneeAngle, stage: this.stage, error: false, warning });

    if (this.isInvalidated) return; // Block count if form is heavily wrong

    if (avgKneeAngle < 75) {
      this.stage = 'DOWN';
    }

    if (this.stage === 'DOWN' && avgKneeAngle > 160) {
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
    this.isInvalidated = false;
    this.lastAngles = { L: null, R: null, Primary: null };
  }
}
