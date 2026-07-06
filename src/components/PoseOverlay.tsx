/**
 * PoseOverlay.tsx — Canvas overlay per la visualizzazione dei landmark MediaPipe.
 *
 * Disegna in tempo reale (su ogni frame del video) le connessioni scheletriche e i
 * punti chiave del corpo rilevati da MediaPipe PoseLandmarker.
 *
 * Il canvas viene posizionato in overlay sul feed video con `position: absolute` e
 * `scale-x-[-1]` (mirroring orizzontale) per corrispondere alla visualizzazione
 * speculare tipica delle fotocamere frontali.
 *
 * Props:
 *  - results   : risultato della rilevazione pose (landmark normalizzati 0-1)
 *  - width     : larghezza in pixel del canvas (deve combaciare col video)
 *  - height    : altezza in pixel del canvas
 *  - exercise  : esercizio corrente — filtra i landmark mostrati a quelli pertinenti
 *
 * Landmark indices usati (standard MediaPipe BlazePose):
 *  11 = spalla sinistra, 12 = spalla destra
 *  13 = gomito sinistro,  14 = gomito destro
 *  15 = polso sinistro,   16 = polso destro
 *  23 = anca sinistra,    24 = anca destra
 *  25 = ginocchio sinistro, 26 = ginocchio destro
 *  27 = caviglia sinistra,  28 = caviglia destra
 */
import React, { useEffect, useRef } from 'react';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { ExerciseType } from '../types';

interface Props {
  results: PoseLandmarkerResult | null;
  width: number;
  height: number;
  /** Se null, vengono mostrate tutte le connessioni scheletriche principali */
  exercise?: ExerciseType | null;
}

/**
 * Mappa esercizio → connessioni e punti rilevanti da disegnare.
 * Filtrare i landmark riduce il "rumore visivo" mostrando solo le parti
 * del corpo utili per il feedback dell'esercizio specifico.
 */
const EXERCISE_CONFIG: Record<ExerciseType, { connections: [number, number][]; points: number[] }> = {
  pullups: {
    // Trazione: spalle, gomiti, polsi
    connections: [
      [11, 12], // spalla-spalla
      [11, 13], [13, 15], // braccio sinistro
      [12, 14], [14, 16], // braccio destro
    ],
    points: [11, 12, 13, 14, 15, 16],
  },
  pushups: {
    // Flessione: spalle, gomiti, polsi + anche (per verificare l'allineamento del corpo)
    connections: [
      [11, 12],
      [11, 13], [13, 15],
      [12, 14], [14, 16],
    ],
    points: [11, 12, 13, 14, 15, 16, 23, 24],
  },
};

const PoseOverlay: React.FC<Props> = ({ results, width, height, exercise }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Riesegue il disegno ogni volta che cambiano i risultati della pose,
   * le dimensioni o l'esercizio selezionato.
   */
  useEffect(() => {
    if (!canvasRef.current || !results || !results.landmarks) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Pulisce il frame precedente prima di ridisegnare
    ctx.clearRect(0, 0, width, height);

    // Usa solo il primo soggetto rilevato (numPoses: 1 nel PoseLandmarker)
    const landmarks = results.landmarks[0];
    if (!landmarks) return;

    // Determina le connessioni e i punti da disegnare in base all'esercizio
    const config = exercise ? EXERCISE_CONFIG[exercise] : null;
    const connections = config?.connections ?? [
      // Scheletro generico se nessun esercizio è selezionato
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
      [24, 26], [26, 28],
    ];
    // Set dei punti rilevanti per filtrare i dot (null = mostra tutti)
    const relevantPoints = config ? new Set(config.points) : null;

    // ── Disegna connessioni (linee tra i landmark) ──────────────────────────
    ctx.strokeStyle = '#a78bfa'; // viola
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(139, 92, 246, 0.5)';

    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      // Disegna solo se entrambi i punti hanno visibilità sufficiente (> 40%)
      if (p1 && p2 && (p1.visibility ?? 0) > 0.4 && (p2.visibility ?? 0) > 0.4) {
        ctx.beginPath();
        // I landmark sono normalizzati [0,1]: moltiplica per le dimensioni del canvas
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }
    });

    // ── Disegna landmark (cerchi sui punti chiave) ──────────────────────────
    ctx.shadowBlur = 0;
    landmarks.forEach((landmark, idx) => {
      // Se c'è un esercizio selezionato, disegna solo i punti rilevanti
      if (relevantPoints && !relevantPoints.has(idx)) return;
      if ((landmark.visibility ?? 0) > 0.4) {
        // Le spalle nelle trazioni vengono evidenziate in giallo (punto di riferimento primario)
        const isShoulderPoint = exercise === 'pullups' && (idx === 11 || idx === 12);
        const radius = isShoulderPoint ? 8 : 6;
        const fillColor = isShoulderPoint ? '#fbbf24' : '#ffffff';
        const strokeColor = isShoulderPoint ? '#f59e0b' : '#8b5cf6';

        ctx.beginPath();
        ctx.arc(landmark.x * width, landmark.y * height, radius, 0, 2 * Math.PI);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isShoulderPoint ? 3 : 2;
        ctx.stroke();
      }
    });

    // ── Linea orizzontale tratteggiata per le trazioni ──────────────────────
    // Mostra visivamente il livello della sbarra (media Y dei polsi visibili)
    // aiutando l'utente a capire fino a dove deve salire per completare la rep.
    if (exercise === 'pullups') {
      const lWrist = landmarks[15];
      const rWrist = landmarks[16];
      const visibleWristYs: number[] = [];
      if ((lWrist?.visibility ?? 0) > 0.4) visibleWristYs.push(lWrist.y);
      if ((rWrist?.visibility ?? 0) > 0.4) visibleWristYs.push(rWrist.y);

      if (visibleWristYs.length > 0) {
        // Y della sbarra = media dei polsi visibili, convertita in coordinate pixel
        const barY = (visibleWristYs.reduce((a, b) => a + b, 0) / visibleWristYs.length) * height;
        ctx.setLineDash([8, 6]); // trattino 8px, spazio 6px
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)'; // giallo semi-trasparente
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(0, barY);
        ctx.lineTo(width, barY);
        ctx.stroke();
        ctx.setLineDash([]); // reset al disegno normale
      }
    }
  }, [results, width, height, exercise]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      // scale-x-[-1]: mirror orizzontale per corrispondere alla visualizzazione speculare della camera
      // pointer-events-none: il canvas è puramente decorativo, non intercetta i click
      className="absolute min-w-full min-h-full object-cover scale-x-[-1] pointer-events-none"
    />
  );
};

export default PoseOverlay;
