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
  private onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string; okMsg?: string }) => void;
  private onAsymmetry?: () => void;
  
  private lastAsymmetryTime: number = 0;
  private lastWarningTime: number = 0;
  private hasStarted: boolean = false;

  // EMA state
  private lastAngles: { L: number | null; R: number | null; Primary: number | null } = {
    L: null, R: null, Primary: null
  };

  constructor(
    target: number, 
    onCount: (count: number) => void, 
    onAnnounce: (msg: string) => void,
    onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string; okMsg?: string }) => void,
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
    const lHip = landmarks[23], rHip = landmarks[24];
    const lAnkle = landmarks[27], rAnkle = landmarks[28];

    if (!lShoulder || !rShoulder || !lElbow || !rElbow) return;

    // Check visibilities
    const isLeftArmVisible = (lShoulder.visibility ?? 0) > 0.5 && (lElbow.visibility ?? 0) > 0.5;
    const isRightArmVisible = (rShoulder.visibility ?? 0) > 0.5 && (rElbow.visibility ?? 0) > 0.5;
    if (!isLeftArmVisible && !isRightArmVisible) return;

    const shoulderY = (lShoulder.y + rShoulder.y) / 2;
    const elbowY = (lElbow.y + rElbow.y) / 2;
    
    // Distanza verticale braccio: >0 = spalle più in alto dei gomiti
    const armExtensionY = elbowY - shoulderY;

    let warning: string | undefined;
    let okMsg: string | undefined;

    // Controllo "A Terra" STRETTO
    let isStanding = false;
    
    const hipY = (lHip.y + rHip.y) / 2;
    const ankleY = (lAnkle.y + rAnkle.y) / 2;

    const isLateral = Math.abs(lShoulder.x - lHip.x) > 0.25 || Math.abs(rShoulder.x - rHip.x) > 0.25;

    if (!isLateral) {
         // Visuale Frontale
         // Se si è per terra verso la telecamera ("ravvicinati uno consecutivo all'altro"), la prospettiva li schiaccia e occupano pochissimo spazio su Y.
         // Se la distanza assoluta tra anca e piede è maggiore di 0.15 (che è piccolissima per uno in piedi ma enorme per uno sdraiato frontalmente), sei in piedi!
         if (Math.abs(hipY - ankleY) > 0.15) {
             isStanding = true;
         }
    } else {
         // Visuale Laterale
         // Se in posizione laterale pushup, bisogna essere paralleli a terra
         if (Math.abs(hipY - shoulderY) > 0.25) {
             isStanding = true;
         }
    }

    if (isStanding) {
        this.stage = null;
        this.hasStarted = false; // Hai rotto la posizione, devi ricominciare
        this.onDebug?.({ angle: armExtensionY, stage: null, error: false, warning: "Mettiti a terra!" });
        return;
    }

    // "Vorrei che il sistema inizi a contare solo quando l'utente è in posizione, braccia distese e anca ginocchia piedi in posizione"
    if (!this.hasStarted) {
        if (armExtensionY > 0.08) {
             // Entrato in posizione iniziale valida! (Braccia distese e non sei in piedi)
             this.hasStarted = true;
             this.stage = 'UP';
             this.onDebug?.({ angle: armExtensionY, stage: this.stage, error: false, warning: undefined, okMsg: "OK" });
        } else {
             this.onDebug?.({ angle: armExtensionY, stage: null, error: false, warning: "Iniziamo! Distendi le braccia." });
        }
        return; // Blocca eventuali conteggi fantasma se ti assembles la postura
    }

    // Siamo in posizione valida e abbiamo iniziato.
    // (spalla più in alto del gomito)
    if (armExtensionY > 0.08) {
       this.stage = 'UP';
       okMsg = "OK";
    }

    // "quando si scende nel momento in cui le spalle arrivano indicativamente alla stessa altezza dei gomiti..."
    if (armExtensionY <= 0.02) {
       // PREVENZIONE FALSI POSITIVI: "...solo quando spalle e gomiti sono vicini ma mani più lontane"
       // Calcoliamo la distanza 2D tra spalla e mani. In piedi muovendo le braccia a vuoto, le mani vengono vicine al petto.
       const distWristShoulderL = Math.sqrt(Math.pow(lWrist.x - lShoulder.x, 2) + Math.pow(lWrist.y - lShoulder.y, 2));
       const distWristShoulderR = Math.sqrt(Math.pow(rWrist.x - rShoulder.x, 2) + Math.pow(rWrist.y - rShoulder.y, 2));

       if (distWristShoulderL < 0.15 || distWristShoulderR < 0.15) {
          // Mani troppo vicine alle spalle (air pushups). Non è una discesa di pushup valida.
          return; 
       }

       if (this.stage === 'UP') {
          this.count++;
          this.onCount(this.count);
          this.checkAnnouncements();
       }
       this.stage = 'DOWN';
    }

    this.onDebug?.({ angle: armExtensionY, stage: this.stage, error: false, warning, okMsg });
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
    this.hasStarted = false;
    this.lastAnnouncement = -1;
    this.lastAngles = { L: null, R: null, Primary: null };
  }
}
