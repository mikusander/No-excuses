/**
 * ExerciseTrendChart.tsx — Grafico SVG nativo ad alte prestazioni a zero dipendenze
 * per visualizzare la curva di progressione temporale di un esercizio (reps, TUT o carico).
 *
 * Supporta:
 *  - Rendering responsive SVG con spline/polilinea e gradiente sfumato
 *  - Punti dati interattivi con tooltip su hover e tap (mobile friendly)
 *  - Indicatore di partenza, valore di picco e delta rispetto alla sessione iniziale
 */

import React, { useState } from 'react';
import type { ExerciseHistoryPoint } from '../utils/periodicReportEngine';

interface ExerciseTrendChartProps {
  historyPoints: ExerciseHistoryPoint[];
  isIsometric?: boolean;
  metricLabel?: string;
  accentColor?: string;
}

export const ExerciseTrendChart: React.FC<ExerciseTrendChartProps> = ({
  historyPoints,
  isIsometric = false,
  metricLabel,
  accentColor = '#ff7700',
}) => {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

  if (!historyPoints || historyPoints.length === 0) {
    return (
      <div className="py-3 px-3 rounded-xl bg-black/25 border border-white/5 text-center text-xs text-brand-grey/50">
        Nessun dato storico registrato nel periodo
      </div>
    );
  }

  // Se c'è solo un punto, mostriamo una pillola di baseline iniziale
  if (historyPoints.length === 1) {
    const pt = historyPoints[0];
    const valStr = isIsometric ? `${pt.metricValue}s TUT` : `${pt.metricValue} ${metricLabel || pt.metricLabel}`;
    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-black/30 border border-white/5 text-xs">
        <span className="text-brand-grey/70">1ª Sessione registrata ({pt.formattedDate}):</span>
        <span className="font-mono font-bold text-white bg-white/5 px-2 py-0.5 rounded-lg border border-white/10">
          {valStr} ({pt.sets} {pt.sets === 1 ? 'serie' : 'serie'})
        </span>
      </div>
    );
  }

  // Dimensioni virtuali SVG
  const width = 340;
  const height = 90;
  const paddingX = 24;
  const paddingTop = 18;
  const paddingBottom = 22;

  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;

  const values = historyPoints.map((p) => p.metricValue);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal === minVal ? 1 : maxVal - minVal;

  // Calcolo delle coordinate (x, y) per ciascun punto
  const coordinates = historyPoints.map((pt, idx) => {
    const x = paddingX + (idx / (historyPoints.length - 1)) * innerWidth;
    const normalizedY = (pt.metricValue - minVal) / valRange;
    // Invertito perché l'asse Y dello schermo va dall'alto verso il basso
    const y = paddingTop + (1 - normalizedY) * innerHeight;
    return { x, y, pt };
  });

  // Costruzione del percorso polilinea o curva SVG
  const linePath = coordinates.reduce((acc, curr, idx) => {
    if (idx === 0) return `M ${curr.x} ${curr.y}`;
    // Curva smussata cubica
    const prev = coordinates[idx - 1];
    const cpx1 = prev.x + (curr.x - prev.x) / 2;
    const cpy1 = prev.y;
    const cpx2 = prev.x + (curr.x - prev.x) / 2;
    const cpy2 = curr.y;
    return `${acc} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${curr.x} ${curr.y}`;
  }, '');

  // Percorso dell'area chiusa verso il fondo per il gradiente
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x} ${height - paddingBottom + 4} L ${coordinates[0].x} ${height - paddingBottom + 4} Z`;

  // Delta tra primo punto e ultimo punto
  const firstPt = historyPoints[0];
  const lastPt = historyPoints[historyPoints.length - 1];
  const totalDiff = lastPt.metricValue - firstPt.metricValue;
  const pctChange = firstPt.metricValue > 0 ? Math.round((totalDiff / firstPt.metricValue) * 100) : 0;

  const activeCoord = activePointIndex !== null ? coordinates[activePointIndex] : null;

  return (
    <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-3 sm:p-4 space-y-2 select-none">
      {/* Header del grafico con Delta Inizio → Fine */}
      <div className="flex items-center justify-between text-[11px] sm:text-xs">
        <span className="font-bold text-brand-grey/80 flex items-center gap-1">
          <span>📈 Curva di Progressione:</span>
          <span className="text-white font-mono font-medium">
            {historyPoints.length} sessioni
          </span>
        </span>

        <div className="flex items-center gap-1 font-mono">
          <span className="text-brand-grey/70">
            {firstPt.metricValue} → {lastPt.metricValue} {metricLabel || lastPt.metricLabel}
          </span>
          {pctChange !== 0 && (
            <span
              className={`font-black px-1.5 py-0.2 rounded-md text-[10px] ${
                pctChange > 0
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {pctChange > 0 ? `+${pctChange}%` : `${pctChange}%`}
            </span>
          )}
        </div>
      </div>

      {/* SVG Canvas interattivo */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-24 sm:h-28 overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`gradient-${accentColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.35" />
              <stop offset="85%" stopColor={accentColor} stopOpacity="0.02" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor={accentColor} floodOpacity="0.5" />
            </filter>
          </defs>

          {/* Linee guida orizzontali sottili */}
          <line
            x1={paddingX}
            y1={paddingTop}
            x2={width - paddingX}
            y2={paddingTop}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 3"
          />
          <line
            x1={paddingX}
            y1={height - paddingBottom}
            x2={width - paddingX}
            y2={height - paddingBottom}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 3"
          />

          {/* Area sfumata */}
          <path d={areaPath} fill={`url(#gradient-${accentColor.replace('#', '')})`} />

          {/* Linea principale di progressione */}
          <path
            d={linePath}
            fill="none"
            stroke={accentColor}
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow)"
          />

          {/* Punti dati interattivi */}
          {coordinates.map((coord, idx) => {
            const isHovered = activePointIndex === idx;
            const isLast = idx === coordinates.length - 1;

            return (
              <g key={idx} className="cursor-pointer">
                {/* Hitbox trasparente allargata per facilitare il tocco su smartphone */}
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r="14"
                  fill="transparent"
                  onMouseEnter={() => setActivePointIndex(idx)}
                  onMouseLeave={() => setActivePointIndex(null)}
                  onClick={() => setActivePointIndex(activePointIndex === idx ? null : idx)}
                />
                {/* Cerchio visivo */}
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r={isHovered ? 6 : isLast ? 4.5 : 3.5}
                  fill={isHovered ? '#ffffff' : accentColor}
                  stroke="#121212"
                  strokeWidth={isHovered ? 2.5 : 2}
                  className="transition-all duration-150"
                />
              </g>
            );
          })}
        </svg>

        {/* Tooltip dinamico su punto attivo */}
        {activeCoord && (
          <div
            className="absolute top-1 transform -translate-x-1/2 bg-black/90 border border-white/20 rounded-xl px-2.5 py-1 text-[11px] shadow-2xl pointer-events-none z-10 flex flex-col items-center gap-0.5 whitespace-nowrap animate-in fade-in duration-100"
            style={{
              left: `${(activeCoord.x / width) * 100}%`,
            }}
          >
            <span className="text-[10px] text-brand-grey/80">
              {activeCoord.pt.formattedDate} • {activeCoord.pt.workoutName}
            </span>
            <span className="font-mono font-black text-white">
              {isIsometric
                ? `${activeCoord.pt.metricValue}s TUT`
                : `${activeCoord.pt.metricValue} ${metricLabel || activeCoord.pt.metricLabel}`}
              <span className="text-[10px] text-brand-grey/70 font-normal ml-1">
                ({activeCoord.pt.sets} set)
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Etichette temporali (Data prima seduta e data ultima seduta) */}
      <div className="flex items-center justify-between text-[10px] text-brand-grey/60 px-1 font-mono">
        <span>{firstPt.formattedDate}</span>
        {coordinates.length > 2 && (
          <span>{coordinates[Math.floor(coordinates.length / 2)].pt.formattedDate}</span>
        )}
        <span className="text-white/80 font-bold">{lastPt.formattedDate}</span>
      </div>
    </div>
  );
};

export default ExerciseTrendChart;
