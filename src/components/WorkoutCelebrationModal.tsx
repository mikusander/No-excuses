import React, { useEffect, useRef } from 'react';
import { ArrowRight, Trophy, Clock } from 'lucide-react';
import { hapticSuccess, hapticMedium } from '../utils/haptics';

interface WorkoutCelebrationModalProps {
  isOpen: boolean;
  workoutName?: string;
  durationSeconds?: number;
  exercisesCompletedCount?: number;
  onComplete: () => void;
}

interface FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  decay: number;
  size: number;
  flicker: boolean;
}

interface Rocket {
  x: number;
  y: number;
  targetY: number;
  vx: number;
  vy: number;
  color: string;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

const FIREWORK_COLORS = [
  '#FF5E00', // Athletic Orange
  '#FF7724', // Light Orange
  '#FFD700', // Gold
  '#FFA500', // Pure Orange
  '#FF2D55', // Crimson Rose
  '#00F0FF', // Electric Cyan
  '#30D158', // Emerald Green
  '#BF5AF2', // Royal Violet
  '#FFFFFF', // Bright Sparkle
];

const formatDuration = (totalSecs?: number) => {
  if (totalSecs == null || !Number.isFinite(totalSecs) || totalSecs <= 0) return '00:00';
  const s = Math.max(0, Math.trunc(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  if (h > 0) {
    return `${h}h ${m}m ${remSec}s`;
  }
  return `${m}m ${remSec}s`;
};

export const WorkoutCelebrationModal: React.FC<WorkoutCelebrationModalProps> = ({
  isOpen,
  workoutName = 'Allenamento',
  durationSeconds = 0,
  exercisesCompletedCount,
  onComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const isCompletedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    isCompletedRef.current = false;
    void hapticSuccess();

    // Auto-complete timer after 4.5 seconds
    const autoTimer = window.setTimeout(() => {
      handleFinish();
    }, 4500);

    return () => {
      window.clearTimeout(autoTimer);
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [isOpen]);

  const handleFinish = () => {
    if (isCompletedRef.current) return;
    isCompletedRef.current = true;
    void hapticMedium();
    onComplete();
  };

  // Canvas Fireworks Engine
  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    const particles: FireworkParticle[] = [];
    const rockets: Rocket[] = [];

    // Helper to spawn explosion particles
    const createExplosion = (x: number, y: number, baseColor?: string) => {
      const particleCount = 45 + Math.floor(Math.random() * 25);
      const chosenColor = baseColor || FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];

      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 6 + 1.5;
        const color = Math.random() < 0.25 ? '#FFFFFF' : chosenColor;

        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          alpha: 1,
          decay: Math.random() * 0.016 + 0.012,
          size: Math.random() * 2.8 + 1.2,
          flicker: Math.random() > 0.4,
        });
      }
    };

    // Helper to launch a rocket
    const launchRocket = () => {
      const startX = width * 0.15 + Math.random() * (width * 0.7);
      const targetY = height * 0.12 + Math.random() * (height * 0.45);
      const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];

      rockets.push({
        x: startX,
        y: height,
        targetY,
        vx: (Math.random() - 0.5) * 2.5,
        vy: -(Math.random() * 4 + 11),
        color,
        trail: [],
      });
    };

    // Initial blast right behind the emoji
    createExplosion(width / 2, height / 2 - 40, '#FF5E00');
    createExplosion(width / 2 - 80, height / 2 - 70, '#FFD700');
    createExplosion(width / 2 + 80, height / 2 - 70, '#FF2D55');

    // Interval to spawn fireworks continuously
    const rocketInterval = window.setInterval(() => {
      launchRocket();
      if (Math.random() > 0.4) {
        // Also direct spontaneous burst at random location
        const randomX = width * 0.15 + Math.random() * (width * 0.7);
        const randomY = height * 0.15 + Math.random() * (height * 0.5);
        createExplosion(randomX, randomY);
      }
    }, 380);

    // Main animation loop
    const render = () => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = 'lighter';

      // Update & draw rockets
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.trail.push({ x: r.x, y: r.y, alpha: 0.8 });
        if (r.trail.length > 7) r.trail.shift();

        // Draw trail
        for (const t of r.trail) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = r.color;
          ctx.globalAlpha = t.alpha;
          ctx.fill();
        }

        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.1; // gravity on rocket

        // Draw rocket head
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = 1;
        ctx.fill();

        // Detonate condition
        if (r.y <= r.targetY || r.vy >= -0.5) {
          createExplosion(r.x, r.y, r.color);
          rockets.splice(i, 1);
        }
      }

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96; // friction
        p.vy *= 0.96;
        p.vy += 0.08; // gravity
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.flicker && Math.random() < 0.3 ? p.alpha * 0.4 : p.alpha;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      animationFrameIdRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.clearInterval(rocketInterval);
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      onClick={handleFinish}
      className="fixed inset-0 z-[120] bg-black/95 flex flex-col items-center justify-between px-5 select-none overflow-hidden cursor-pointer"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)',
      }}
    >
      <style>{`
        @keyframes bicepPulse {
          0% {
            transform: scale(0.92);
            filter: drop-shadow(0 0 20px rgba(255, 94, 0, 0.45));
          }
          50% {
            transform: scale(1.32) rotate(-6deg);
            filter: drop-shadow(0 0 55px rgba(255, 94, 0, 0.95)) drop-shadow(0 0 90px rgba(255, 215, 0, 0.7));
          }
          100% {
            transform: scale(0.92);
            filter: drop-shadow(0 0 20px rgba(255, 94, 0, 0.45));
          }
        }

        @keyframes ringExpand {
          0% {
            transform: scale(0.5);
            opacity: 0.85;
          }
          100% {
            transform: scale(2.4);
            opacity: 0;
          }
        }

        @keyframes progressBar {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }

        .animate-bicep {
          animation: bicepPulse 1.1s ease-in-out infinite;
          will-change: transform, filter;
        }

        .animate-ring-1 {
          animation: ringExpand 2.2s cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
        }

        .animate-ring-2 {
          animation: ringExpand 2.2s cubic-bezier(0.1, 0.8, 0.3, 1) 0.7s infinite;
        }

        .animate-ring-3 {
          animation: ringExpand 2.2s cubic-bezier(0.1, 0.8, 0.3, 1) 1.4s infinite;
        }

        .animate-progress-countdown {
          animation: progressBar 4.5s linear forwards;
        }
      `}</style>

      {/* HTML5 Fireworks Canvas (Behind the pulsating emoji) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
      />

      {/* Top Banner Chip */}
      <div className="z-10 flex items-center justify-center pt-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-orange text-xs font-black uppercase tracking-widest shadow-[0_0_20px_rgba(255,94,0,0.35)] backdrop-blur-md">
          <Trophy size={14} className="text-brand-orange" />
          <span>Sessione Completata</span>
        </div>
      </div>

      {/* Central Hero: Pulsating Bicep Emoji with Halo Rings */}
      <div className="z-10 flex flex-col items-center justify-center my-auto relative">
        {/* Glowing Luminous Halo Rings */}
        <div className="absolute w-44 h-44 sm:w-56 sm:h-56 rounded-full border border-brand-orange/30 animate-ring-1 pointer-events-none" />
        <div className="absolute w-44 h-44 sm:w-56 sm:h-56 rounded-full border border-brand-orange/25 animate-ring-2 pointer-events-none" />
        <div className="absolute w-44 h-44 sm:w-56 sm:h-56 rounded-full border border-brand-orange/20 animate-ring-3 pointer-events-none" />

        {/* Ambient Radial Golden Glow */}
        <div className="absolute w-60 h-60 sm:w-72 sm:h-72 rounded-full bg-gradient-radial from-brand-orange/30 via-brand-orange/5 to-transparent blur-2xl pointer-events-none" />

        {/* Pulsating Emoji 💪 */}
        <div className="relative text-8xl sm:text-9xl cursor-pointer select-none animate-bicep transition-transform">
          💪
        </div>

        {/* Main Heading */}
        <div className="mt-8 text-center px-4">
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-wider text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
            Allenamento Completato!
          </h1>
          <p className="text-sm font-semibold text-zinc-300 mt-1.5">
            Grandissimo lavoro! Continua così.
          </p>
        </div>

        {/* Workout Stats Pills */}
        <div className="mt-5 flex items-center justify-center gap-2.5 flex-wrap px-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/60 border border-white/10 text-xs font-bold text-zinc-200">
            <span className="text-zinc-500">•</span>
            <span className="truncate max-w-[180px]">{workoutName}</span>
          </div>

          {durationSeconds > 0 && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-black/60 border border-white/10 text-xs font-bold text-brand-orange font-mono">
              <Clock size={12} />
              <span>{formatDuration(durationSeconds)}</span>
            </div>
          )}

          {exercisesCompletedCount != null && exercisesCompletedCount > 0 && (
            <div className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-black/60 border border-white/10 text-xs font-bold text-emerald-400">
              <span>{exercisesCompletedCount} esercizi</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Area: Home button & countdown bar */}
      <div className="z-10 w-full max-w-sm flex flex-col items-center gap-3 pb-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleFinish();
          }}
          className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-brand-orange to-brand-lightOrange text-black font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(255,94,0,0.5)] active:scale-95 transition-all cursor-pointer"
        >
          <span>Torna alla Home</span>
          <ArrowRight size={18} strokeWidth={2.5} />
        </button>

        {/* Auto-redirect progress line */}
        <div className="w-full flex flex-col items-center gap-1.5">
          <div className="w-36 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-brand-orange/80 rounded-full animate-progress-countdown" />
          </div>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Tocca ovunque per continuare
          </span>
        </div>
      </div>
    </div>
  );
};
