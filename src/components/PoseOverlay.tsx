import React, { useEffect, useRef } from 'react';
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { ExerciseType } from '../types';

interface Props {
  results: PoseLandmarkerResult | null;
  width: number;
  height: number;
  exercise?: ExerciseType | null;
}

// Landmark indices rilevanti per ogni esercizio
const EXERCISE_CONFIG: Record<ExerciseType, { connections: [number, number][]; points: number[] }> = {
  pullups: {
    // Trazione: naso, spalle, gomiti, polsi
    connections: [
      [11, 12], // spalla-spalla
      [11, 13], [13, 15], // braccio sinistro
      [12, 14], [14, 16], // braccio destro
    ],
    points: [0, 11, 12, 13, 14, 15, 16], // + naso (0)
  },
  pushups: {
    // Flessione: spalle, gomiti, polsi, fianchi
    connections: [
      [11, 12],
      [11, 13], [13, 15],
      [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24],
    ],
    points: [11, 12, 13, 14, 15, 16, 23, 24],
  },
};

const PoseOverlay: React.FC<Props> = ({ results, width, height, exercise }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !results || !results.landmarks) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const landmarks = results.landmarks[0];
    if (!landmarks) return;

    const config = exercise ? EXERCISE_CONFIG[exercise] : null;
    const connections = config?.connections ?? [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
      [24, 26], [26, 28],
    ];
    const relevantPoints = config ? new Set(config.points) : null;

    // Disegna connessioni
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(139, 92, 246, 0.5)';

    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      if (p1 && p2 && (p1.visibility ?? 0) > 0.4 && (p2.visibility ?? 0) > 0.4) {
        ctx.beginPath();
        ctx.moveTo(p1.x * width, p1.y * height);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.stroke();
      }
    });

    // Disegna landmark
    ctx.shadowBlur = 0;
    landmarks.forEach((landmark, idx) => {
      // Se c'è un esercizio selezionato, disegna solo i punti rilevanti
      if (relevantPoints && !relevantPoints.has(idx)) return;
      if ((landmark.visibility ?? 0) > 0.4) {
        // Naso (0) per le trazioni: evidenzialo in verde come punto chiave
        const isKeyPoint = exercise === 'pullups' && idx === 0;
        const radius = isKeyPoint ? 9 : 6;
        const fillColor = isKeyPoint ? '#4ade80' : '#ffffff';
        const strokeColor = isKeyPoint ? '#16a34a' : '#8b5cf6';

        ctx.beginPath();
        ctx.arc(landmark.x * width, landmark.y * height, radius, 0, 2 * Math.PI);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isKeyPoint ? 3 : 2;
        ctx.stroke();
      }
    });

    // Per le trazioni: disegna una linea orizzontale tratteggiata che mostra il livello della sbarra (polsi)
    if (exercise === 'pullups') {
      const lWrist = landmarks[15];
      const rWrist = landmarks[16];
      const visibleWristYs: number[] = [];
      if ((lWrist?.visibility ?? 0) > 0.4) visibleWristYs.push(lWrist.y);
      if ((rWrist?.visibility ?? 0) > 0.4) visibleWristYs.push(rWrist.y);

      if (visibleWristYs.length > 0) {
        const barY = (visibleWristYs.reduce((a, b) => a + b, 0) / visibleWristYs.length) * height;
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(0, barY);
        ctx.lineTo(width, barY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [results, width, height, exercise]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute min-w-full min-h-full object-cover scale-x-[-1] pointer-events-none"
    />
  );
};

export default PoseOverlay;
