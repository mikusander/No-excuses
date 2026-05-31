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

  // Storico per validazione MediaPipe (trazioni)
  private wristYHistory: LandmarkSample[] = [];
  private shoulderYHistory: LandmarkSample[] = [];
  private downPhaseSnapshot: DownPhaseSnapshot | null = null;

  // Calibri/thresholds (regolabili)
  private SHOULDER_MOVE_THRESHOLD = 0.05; // min movimento spalle per considerare una rep (calibrato dai test)
  private WRIST_MOVE_THRESHOLD = 0.02; // max movimento polsi per considerarli fermi (calibrato dai test)

  constructor(
    onCount: (count: number) => void, 
    onDebug?: (data: { angle: number; stage: string | null; error?: boolean; warning?: string; okMsg?: string }) => void
  ) {
    this.onCount = onCount;
    this.onDebug = onDebug;
  }




  /**
   * Aggiorna lo storico Y del polso (usa la media tra left e right se visibili)
   */
  private updateWristHistory(lWrist: NormalizedLandmark | undefined, rWrist: NormalizedLandmark | undefined) {
    const wristYValues: number[] = [];
    if (lWrist && (lWrist.visibility ?? 0) > 0.4) wristYValues.push(lWrist.y);
    if (rWrist && (rWrist.visibility ?? 0) > 0.4) wristYValues.push(rWrist.y);

    if (wristYValues.length > 0) {
      const avgWristY = wristYValues.reduce((a, b) => a + b, 0) / wristYValues.length;
      this.wristYHistory.push({ y: avgWristY, timestamp: Date.now() });

      // Mantieni solo gli ultimi 1000ms di storico
      const cutoff = Date.now() - 1000;
      this.wristYHistory = this.wristYHistory.filter(s => s.timestamp >= cutoff);
    }
  }

  /**
   * Aggiorna lo storico Y delle spalle (usa la media tra left e right se visibili)
   */
  private updateShoulderHistory(lShoulder: NormalizedLandmark | undefined, rShoulder: NormalizedLandmark | undefined) {
    const shoulderYValues: number[] = [];
    if (lShoulder && (lShoulder.visibility ?? 0) > 0.4) shoulderYValues.push(lShoulder.y);
    if (rShoulder && (rShoulder.visibility ?? 0) > 0.4) shoulderYValues.push(rShoulder.y);

    if (shoulderYValues.length > 0) {
      const avgShoulderY = shoulderYValues.reduce((a, b) => a + b, 0) / shoulderYValues.length;
      this.shoulderYHistory.push({ y: avgShoulderY, timestamp: Date.now() });

      // Mantieni solo gli ultimi 1000ms di storico
      const cutoff = Date.now() - 1000;
      this.shoulderYHistory = this.shoulderYHistory.filter(s => s.timestamp >= cutoff);
    }
  }



  updatePullup(landmarks: NormalizedLandmark[]) {
    // Per le trazioni bastano: spalle (11,12) e polsi (15,16)
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lWrist = landmarks[15], rWrist = landmarks[16];

    if (!lShoulder || !rShoulder || (!lWrist && !rWrist)) return;

    // Verifica che spalle e almeno un polso siano visibili
    const lShoulderVis = (lShoulder.visibility ?? 0) > 0.4;
    const rShoulderVis = (rShoulder.visibility ?? 0) > 0.4;
    const lWristVis = (lWrist?.visibility ?? 0) > 0.4;
    const rWristVis = (rWrist?.visibility ?? 0) > 0.4;
    if (!lShoulderVis && !rShoulderVis) return;
    if (!lWristVis && !rWristVis) return;

    // Aggiorna lo storico di polsi e spalle
    this.updateWristHistory(lWrist, rWrist);
    this.updateShoulderHistory(lShoulder, rShoulder);

    // Y della sbarra = media dei polsi visibili (y più piccola = più in alto nello schermo)
    const wristYValues: number[] = [];
    if (lWristVis && lWrist) wristYValues.push(lWrist.y);
    if (rWristVis && rWrist) wristYValues.push(rWrist.y);
    const barY = wristYValues.reduce((a, b) => a + b, 0) / wristYValues.length;

    // shoulderToBar > 0: spalle SOTTO la sbarra (posizione bassa, appeso)
    // shoulderToBar < 0: spalle SOPRA la sbarra → ripetizione valida
    const shoulderYValues: number[] = [];
    if (lShoulderVis) shoulderYValues.push(lShoulder.y);
    if (rShoulderVis) shoulderYValues.push(rShoulder.y);
    const shoulderY = shoulderYValues.reduce((a, b) => a + b, 0) / shoulderYValues.length;
    const rawShoulderToBar = shoulderY - barY;
    const smoothed = applyEMA(rawShoulderToBar, this.lastAngles.Primary);
    this.lastAngles.Primary = smoothed;

    // Mostra nel debug la distanza in % altezza frame (positivo = appeso, negativo = sopra sbarra)
    this.onDebug?.({ angle: Math.round(smoothed * 1000) / 10, stage: this.stage });

    // DOWN: spalle chiaramente sotto la sbarra (appeso, braccia distese)
    if (smoothed > 0.08) {
      if (this.stage !== 'DOWN') {
        // Entrato appena in DOWN → inizializzo snapshot
        this.downPhaseSnapshot = {
          shoulderY,
          leftWristY: lWristVis && lWrist ? lWrist.y : undefined,
          rightWristY: rWristVis && rWrist ? rWrist.y : undefined,
          leftWristVisible: !!lWristVis,
          rightWristVisible: !!rWristVis,
        };
        this.stage = 'DOWN';
      } else if (this.downPhaseSnapshot) {
        // 1. Spalle: Trackiamo il picco massimo di discesa. 
        // Qui i picchi di rumore non ci fanno danni, ci assicurano solo 
        // che l'escursione superi la soglia a fine trazione.
        if (shoulderY > this.downPhaseSnapshot.shoulderY) {
          this.downPhaseSnapshot.shoulderY = shoulderY;
        }

        // 2. Polsi: AGGIORNAMENTO CONTINUO E INCONDIZIONATO (La soluzione)
        // Finché smoothed > 0.08, l'utente è considerato fermo in appensione.
        // Sovrascriviamo continuamente i polsi. Questo cancella ogni assestamento iniziale!
        // Appena l'utente inizia a tirare, smoothed scende sotto 0.08, questo if
        // smette di essere valutato e i polsi si "congelano" magicamente per la valutazione.
        if (lWristVis && lWrist) this.downPhaseSnapshot.leftWristY = lWrist.y;
        if (rWristVis && rWrist) this.downPhaseSnapshot.rightWristY = rWrist.y;
      }
    }

    // UP: le spalle hanno raggiunto/superato il livello della sbarra
    if (this.stage === 'DOWN' && smoothed < 0.04) {
      let isValid = false;
      const reasons: string[] = [];

      if (this.downPhaseSnapshot) {
        // 1. Calcolo lo spostamento delle spalle
        const shoulderMovement = Math.abs(shoulderY - this.downPhaseSnapshot.shoulderY);

        // 2. Calcolo lo spostamento dei polsi
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

        // 3. Definisco le variabili che prima mancavano
        const wristsStable = !(leftWristMoved || rightWristMoved);
        const shouldersMoved = shoulderMovement >= this.SHOULDER_MOVE_THRESHOLD;

        if (!shouldersMoved) reasons.push('spalle_non_si_muovono');
        if (!wristsStable) reasons.push('polsi_si_muovono');

        // Debug
        this.onDebug?.({
          angle: Math.round(smoothed * 1000) / 10,
          stage: this.stage,
          warning: reasons.length ? `Ripetizione non valida: ${reasons.join(', ')}` : undefined,
          okMsg: `shoulderMove=${shoulderMovement.toFixed(3)} leftWrist=${leftVal.toFixed(3)} rightWrist=${rightVal.toFixed(3)}`
        });

        isValid = shouldersMoved && wristsStable;
      } else {
        // Nessuno snapshot: considero non valida (più sicuro che regalare rep)
        isValid = false;
      }

      // --- LA CORREZIONE DELLA MACCHINA A STATI ---
      // Cambio stato in UP a prescindere dalla validità per non restare bloccati
      this.stage = 'UP';

      if (isValid) {
        this.count++;
        this.onCount(this.count);
      }

      // Pulisci snapshot
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

    // Utilizziamo l'escursione relativa delle spalle invece della distanza assoluta
    const EXCURSION_THRESHOLD = 0.10;
    const PUSHUP_WRIST_THRESHOLD = 0.05; // Tolleranza maggiore per i pushup rispetto alle trazioni

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
      // In fase UP, le spalle sono in alto (valore Y MINORE in MediaPipe)
      // Cerchiamo il picco minimo (massima altezza)
      if (shoulderY < this.downPhaseSnapshot.shoulderY) {
        this.downPhaseSnapshot.shoulderY = shoulderY;
      }
      
      // Se le spalle scendono (valore Y AUMENTA) oltre la soglia dal picco minimo
      if (shoulderY - this.downPhaseSnapshot.shoulderY > EXCURSION_THRESHOLD) {
        this.stage = 'DOWN';
        // Usiamo peakShoulderMovement temporaneamente per tracciare il picco massimo (discesa massima)
        this.downPhaseSnapshot.peakShoulderMovement = shoulderY;
        // Inizializziamo lo snapshot polsi
        if (lWristVis) this.downPhaseSnapshot.leftWristY = lWrist.y;
        if (rWristVis) this.downPhaseSnapshot.rightWristY = rWrist.y;
      }
    } else if (this.stage === 'DOWN' && this.downPhaseSnapshot) {
      // In fase DOWN, cerchiamo il picco massimo (valore Y MAGGIORE, massima vicinanza al suolo)
      if (shoulderY > (this.downPhaseSnapshot.peakShoulderMovement ?? shoulderY)) {
        this.downPhaseSnapshot.peakShoulderMovement = shoulderY;
        // PRENDIAMO LO SNAPSHOT POLSI QUI!
        // Al punto più basso del pushup, i polsi sono fermi a terra. Questo risolve il problema della prima ripetizione.
        if (lWristVis) this.downPhaseSnapshot.leftWristY = lWrist.y;
        if (rWristVis) this.downPhaseSnapshot.rightWristY = rWrist.y;
      }
      
      // Se le spalle risalgono (valore Y DIMINUISCE) oltre la soglia dal picco massimo
      if ((this.downPhaseSnapshot.peakShoulderMovement ?? shoulderY) - shoulderY > EXCURSION_THRESHOLD) {
        // VALIDAZIONE ANTI-FAKE: I polsi non devono essersi mossi drasticamente
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
          warning: !wristsStable ? `Fake rep! Polsi mossi (L:${leftVal.toFixed(2)} R:${rightVal.toFixed(2)})` : undefined,
          okMsg: wristsStable ? `Rep Valida (L:${leftVal.toFixed(2)} R:${rightVal.toFixed(2)})` : undefined
        });


        // Reset stato per la prossima ripetizione
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
