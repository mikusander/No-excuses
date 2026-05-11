import { useCallback, useEffect, useRef, useState } from 'react';

type MotionPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';
export type AccelerometerSessionPhase = 'idle' | 'preparing' | 'active' | 'paused';

type MotionPermissionAPI = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export interface RepData {
  // ─ Classificazione ─────────────────────────────────────────────────────────
  status: 'valid' | 'rejected_too_short' | 'rejected_shake' | 'rejected_timeout';
  exerciseType?: string; // Es. 'pushups', 'pullups', 'squats'
  burstIndex: 1 | 2;    // 1 = andata (discesa), 2 = ritorno (rep completata)

  // ─ Timing ───────────────────────────────────────────────────────────────────
  burstDurationMs: number;    // Durata del singolo burst (es. solo discesa)
  totalRepDurationMs: number; // Durata totale rep (solo su burstIndex=2)
  energyRampMs: number;       // Tempo (ms) da THRESH_ACTIVE al picco di energia (esplosività)
  sampleCount: number;        // Campioni raccolti nel burst (verifica frequenza sensore)
  timestamp: number;

  // ─ Energia Cinetica ─────────────────────────────────────────────────────────
  maxEnergy: number;     // Picco di energia combinata durante il burst
  minEnergy: number;     // Minimo di energia (fondo del burst)
  avgEnergy: number;     // Media energia durante il burst
  energyAt25pct: number; // Energia al 25% della durata del burst
  energyAt50pct: number; // Energia al 50% (punto medio — utile per capire la "forma" del movimento)
  energyAt75pct: number; // Energia al 75%

  // ─ Accelerazione Lineare (gravità rimossa) ──────────────────────────────────
  maxLinAcc: number;           // Picco di accelerazione lineare pura (m/s²)
  peakAccRaw: { x: number; y: number; z: number }; // Raw acc al momento del picco di energia

  // ─ Giroscopio ───────────────────────────────────────────────────────────────
  maxGyro: number;       // Magnitudine composta massima (°/s)
  maxGyroAlpha: number;  // Rotazione max attorno Z (yaw, °/s)
  maxGyroBeta: number;   // Rotazione max attorno X (pitch, °/s)
  maxGyroGamma: number;  // Rotazione max attorno Y (roll, °/s)

  // ─ Orientamento Assoluto (DeviceOrientationEvent) ───────────────────────────
  // Questi angoli danno la posizione assoluta del telefono rispetto alla Terra
  // Fondamentali per distinguere flessioni (telefono orizzontale) da trazioni (verticale)
  orientationStart: { alpha: number; beta: number; gamma: number }; // Inizio burst
  orientationEnd:   { alpha: number; beta: number; gamma: number }; // Fine burst
  orientationDelta: { beta: number; gamma: number }; // Cambio angolo (range of motion in gradi!)

  // ─ Gravità (Contesto) ────────────────────────────────────────────────────────
  gravityVec: { x: number; y: number; z: number }; // Vettore gravità stimato all'inizio del burst
  tiltAngleDeg: number; // Angolo di inclinazione dal verticale (0°=in piedi, 90°=a terra)
}


interface UseAccelerometerRepCounterOptions {
  prepDurationSeconds?: number;
  onCountChange: (count: number) => void;
  onRepData?: (data: RepData) => void;
}

// ─── COSTANTI DI RILEVAMENTO ─────────────────────────────────────────────────
// Timeout se il burst si protrae senza mai invertire
const MAX_REP_DURATION_MS = 8000;

// Filtro Anti-Shake: soglia basata su dati reali (pushup = 430-516 °/s)
// Alziamo a 700 per non scartare le ripetizioni vere
const GYRO_SHAKE_THRESHOLD = 700;

// ─── Feedback aptico ──────────────────────────────────────────────────────────
const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    // Doppio impulso breve: indica chiaramente una ripetizione confermata
    navigator.vibrate([60, 40, 60]);
  }
};

export const useAccelerometerRepCounter = ({
  prepDurationSeconds = 10,
  onCountChange,
  onRepData,
}: UseAccelerometerRepCounterOptions) => {
  const [phase, setPhase] = useState<AccelerometerSessionPhase>('idle');
  const [prepRemaining, setPrepRemaining] = useState(prepDurationSeconds);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<MotionPermissionState>('unknown');

  const previousPhaseRef = useRef<AccelerometerSessionPhase>('preparing');
  const prepEndsAtRef = useRef<number | null>(null);
  const countRef = useRef(0);

  // ─── Stati Algoritmo (Motion Energy) ─────────────────────────────────────────────
  const gravityRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const energyRef = useRef<number>(0);
  
  const trackStateRef = useRef<'idle' | 'active'>('idle');
  const burstCountRef = useRef<number>(0);
  const lastBurstTimeRef = useRef<number>(0);
  
  // Metriche per i log — Timing
  const activeStartTimeRef = useRef<number>(0);
  const energyPeakTimeRef  = useRef<number>(0); // Momento del picco → calcola energyRampMs
  
  // Metriche — Energia
  const maxEnergyRef    = useRef<number>(0);
  const minEnergyRef    = useRef<number>(Infinity);
  const sumEnergyRef    = useRef<number>(0);
  const sampleCountRef  = useRef<number>(0);
  // Snapshot energia a 25/50/75% della durata — campionati durante il burst
  const energyAt25Ref   = useRef<number>(0);
  const energyAt50Ref   = useRef<number>(0);
  const energyAt75Ref   = useRef<number>(0);
  const e25SetRef       = useRef<boolean>(false);
  const e50SetRef       = useRef<boolean>(false);
  const e75SetRef       = useRef<boolean>(false);

  // Metriche — Accelerazione Lineare
  const maxLinAccRef    = useRef<number>(0);
  const peakAccRawRef   = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  // Metriche — Giroscopio per asse
  const maxGyroRef      = useRef<number>(0);
  const maxGyroAlphaRef = useRef<number>(0);
  const maxGyroBetaRef  = useRef<number>(0);
  const maxGyroGammaRef = useRef<number>(0);

  // Metriche — Orientamento Assoluto (DeviceOrientationEvent)
  const orientationRef       = useRef<{ alpha: number; beta: number; gamma: number }>({ alpha: 0, beta: 0, gamma: 0 });
  const orientationStartRef  = useRef<{ alpha: number; beta: number; gamma: number }>({ alpha: 0, beta: 0, gamma: 0 });

  // Metriche — Gravità
  const gravityAtBurstStartRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });

  const resetBurstMetrics = useCallback(() => {
    activeStartTimeRef.current   = 0;
    energyPeakTimeRef.current    = 0;
    maxEnergyRef.current         = 0;
    minEnergyRef.current         = Infinity;
    sumEnergyRef.current         = 0;
    sampleCountRef.current       = 0;
    energyAt25Ref.current        = 0;
    energyAt50Ref.current        = 0;
    energyAt75Ref.current        = 0;
    e25SetRef.current            = false;
    e50SetRef.current            = false;
    e75SetRef.current            = false;
    maxLinAccRef.current         = 0;
    peakAccRawRef.current        = { x: 0, y: 0, z: 0 };
    maxGyroRef.current           = 0;
    maxGyroAlphaRef.current      = 0;
    maxGyroBetaRef.current       = 0;
    maxGyroGammaRef.current      = 0;
    gravityAtBurstStartRef.current = { x: 0, y: 0, z: 0 };
    orientationStartRef.current  = { ...orientationRef.current };
  }, []);

  const resetTrackingState = useCallback(() => {
    gravityRef.current     = null;
    energyRef.current      = 0;
    trackStateRef.current  = 'idle';
    burstCountRef.current  = 0;
    lastBurstTimeRef.current = 0;
    resetBurstMetrics();

    gravityAtBurstStartRef.current = { x: 0, y: 0, z: 0 };
  }, []);

  const resetSession = useCallback(() => {
    prepEndsAtRef.current = null;
    previousPhaseRef.current = 'preparing';
    countRef.current = 0;
    setPrepRemaining(prepDurationSeconds);
    setPhase('idle');
    setError(null);
    onCountChange(0);
    resetTrackingState();
  }, [onCountChange, prepDurationSeconds, resetTrackingState]);

  const isSupported = typeof window !== 'undefined'
    && 'DeviceMotionEvent' in window
    && window.isSecureContext;

  const requestMotionPermission = useCallback(async () => {
    if (!isSupported) {
      setPermissionState('unsupported');
      setError('L\'accelerometro non è supportato su questo dispositivo oppure richiede HTTPS.');
      return false;
    }

    const api = DeviceMotionEvent as MotionPermissionAPI;
    if (typeof api.requestPermission !== 'function') {
      setPermissionState('granted');
      return true;
    }

    try {
      const result = await api.requestPermission();
      if (result !== 'granted') {
        setPermissionState('denied');
        setError('Permesso di movimento negato. Abilita l\'accesso al movimento e riprova.');
        return false;
      }
      setPermissionState('granted');
      return true;
    } catch {
      setPermissionState('denied');
      setError('Impossibile richiedere il permesso di movimento su questo dispositivo.');
      return false;
    }
  }, [isSupported]);

  const startSession = useCallback(async () => {
    setError(null);
    const granted = await requestMotionPermission();
    if (!granted) return false;

    countRef.current = 0;
    onCountChange(0);
    resetTrackingState();
    setPrepRemaining(prepDurationSeconds);
    previousPhaseRef.current = 'preparing';
    prepEndsAtRef.current = Date.now() + prepDurationSeconds * 1000;
    setPhase('preparing');
    return true;
  }, [onCountChange, prepDurationSeconds, requestMotionPermission, resetTrackingState]);

  const pauseSession = useCallback(() => {
    if (phase !== 'preparing' && phase !== 'active') return;
    previousPhaseRef.current = phase;
    if (phase === 'preparing' && prepEndsAtRef.current) {
      const remainingMs = Math.max(0, prepEndsAtRef.current - Date.now());
      setPrepRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
      prepEndsAtRef.current = null;
    }
    setPhase('paused');
  }, [phase]);

  const resumeSession = useCallback(() => {
    if (phase !== 'paused') return;
    const nextPhase = previousPhaseRef.current;
    if (nextPhase === 'preparing') {
      prepEndsAtRef.current = Date.now() + prepRemaining * 1000;
    }
    setPhase(nextPhase);
  }, [phase, prepRemaining]);

  // ── Countdown conto alla rovescia ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'preparing') return;

    // ── Listener DeviceOrientation (angoli assoluti) ────────────────────────────
  useEffect(() => {
    if (phase !== 'active') return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      orientationRef.current = {
        alpha: e.alpha ?? 0,
        beta:  e.beta  ?? 0,
        gamma: e.gamma ?? 0,
      };
    };
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [phase]);

  // ── Listener DeviceMotion (Energia Cinetica + tutte le metriche) ─────────────
  useEffect(() => {
    if (phase !== 'active') return;

    const onMotion = (event: DeviceMotionEvent) => {
      const now = Date.now();

      const accData = event.accelerationIncludingGravity ?? event.acceleration;
      if (!accData) return;

      const rawAcc = { x: accData.x || 0, y: accData.y || 0, z: accData.z || 0 };

      // 1. Tracciamento continuo della Gravità (Filtro Passa-Basso lento)
      if (!gravityRef.current) gravityRef.current = { ...rawAcc };
      const gravity = gravityRef.current;
      const alphaG = 0.95;
      gravity.x = alphaG * gravity.x + (1 - alphaG) * rawAcc.x;
      gravity.y = alphaG * gravity.y + (1 - alphaG) * rawAcc.y;
      gravity.z = alphaG * gravity.z + (1 - alphaG) * rawAcc.z;

      // 2. Accelerazione Lineare (gravità rimossa)
      const linMag = Math.hypot(rawAcc.x - gravity.x, rawAcc.y - gravity.y, rawAcc.z - gravity.z);

      // 3. Giroscopio per asse (valori assoluti)
      const rr     = event.rotationRate;
      const gAlpha = Math.abs(rr?.alpha || 0);
      const gBeta  = Math.abs(rr?.beta  || 0);
      const gGamma = Math.abs(rr?.gamma || 0);
      const gyroMag = Math.hypot(gAlpha, gBeta, gGamma);

      // 4. Energia Cinetica combinata (gyro + linAcc scalate sulla stessa unità)
      const rawEnergy = gyroMag + 40 * linMag;
      energyRef.current = energyRef.current * 0.6 + rawEnergy * 0.4;
      const energy = energyRef.current;

      // ─── AGGIORNAMENTO METRICHE DURANTE BURST ────────────────────────────────
      if (trackStateRef.current === 'active') {
        const elapsed = now - activeStartTimeRef.current;

        // Aggiorna max/min/avg energia
        if (energy > maxEnergyRef.current) {
          maxEnergyRef.current = energy;
          energyPeakTimeRef.current = now;
          // Snapshot raw acc al momento del picco
          peakAccRawRef.current = { ...rawAcc };
        }
        minEnergyRef.current   = Math.min(minEnergyRef.current, energy);
        sumEnergyRef.current  += energy;
        sampleCountRef.current += 1;

        // Snapshot energia a 25/50/75% — campionati "on the fly"
        // (non conosciamo la durata totale in anticipo, quindi usiamo una stima mobile di 800ms)
        const estimatedTotal = 800; // ms, stima di un burst medio
        if (!e25SetRef.current && elapsed >= estimatedTotal * 0.25) { energyAt25Ref.current = energy; e25SetRef.current = true; }
        if (!e50SetRef.current && elapsed >= estimatedTotal * 0.50) { energyAt50Ref.current = energy; e50SetRef.current = true; }
        if (!e75SetRef.current && elapsed >= estimatedTotal * 0.75) { energyAt75Ref.current = energy; e75SetRef.current = true; }

        // Aggiorna picchi linAcc e gyro per asse
        maxLinAccRef.current    = Math.max(maxLinAccRef.current, linMag);
        maxGyroRef.current      = Math.max(maxGyroRef.current, gyroMag);
        maxGyroAlphaRef.current = Math.max(maxGyroAlphaRef.current, gAlpha);
        maxGyroBetaRef.current  = Math.max(maxGyroBetaRef.current, gBeta);
        maxGyroGammaRef.current = Math.max(maxGyroGammaRef.current, gGamma);
      }

      // ─── MACCHINA A STATI: RILEVAMENTO BURSTS ───────────────────────────────
      const THRESH_ACTIVE = 180;
      const THRESH_REST   = 100;

      if (trackStateRef.current === 'idle') {
        if (energy > THRESH_ACTIVE) {
          // INIZIO DI UN BURST — inizializza tutte le metriche
          trackStateRef.current         = 'active';
          activeStartTimeRef.current    = now;
          energyPeakTimeRef.current     = now;
          maxEnergyRef.current          = energy;
          minEnergyRef.current          = energy;
          sumEnergyRef.current          = energy;
          sampleCountRef.current        = 1;
          energyAt25Ref.current         = 0; e25SetRef.current = false;
          energyAt50Ref.current         = 0; e50SetRef.current = false;
          energyAt75Ref.current         = 0; e75SetRef.current = false;
          maxLinAccRef.current          = linMag;
          peakAccRawRef.current         = { ...rawAcc };
          maxGyroRef.current            = gyroMag;
          maxGyroAlphaRef.current       = gAlpha;
          maxGyroBetaRef.current        = gBeta;
          maxGyroGammaRef.current       = gGamma;
          gravityAtBurstStartRef.current = { ...gravity };
          orientationStartRef.current   = { ...orientationRef.current };
        }
      } else if (trackStateRef.current === 'active') {
        const duration = now - activeStartTimeRef.current;

        if (energy < THRESH_REST) {
          // FINE DEL BURST — punto di inversione o arresto completo
          trackStateRef.current = 'idle';

          const avgEnergy     = sampleCountRef.current > 0 ? sumEnergyRef.current / sampleCountRef.current : 0;
          const energyRampMs  = energyPeakTimeRef.current - activeStartTimeRef.current;
          const orientEnd     = { ...orientationRef.current };
          const orientStart   = orientationStartRef.current;
          const gVec          = gravityAtBurstStartRef.current;
          // Angolo di inclinazione dal verticale (0°=in piedi, 90°=a terra)
          const tiltAngleDeg  = Math.round(Math.atan2(Math.hypot(gVec.x, gVec.y), Math.abs(gVec.z)) * 180 / Math.PI);

          const burstData = {
            burstDurationMs:    duration,
            totalRepDurationMs: 0,
            energyRampMs,
            sampleCount:        sampleCountRef.current,
            maxEnergy:          maxEnergyRef.current,
            minEnergy:          minEnergyRef.current,
            avgEnergy,
            energyAt25pct:      energyAt25Ref.current,
            energyAt50pct:      energyAt50Ref.current,
            energyAt75pct:      energyAt75Ref.current,
            maxLinAcc:          maxLinAccRef.current,
            peakAccRaw:         { ...peakAccRawRef.current },
            maxGyro:            maxGyroRef.current,
            maxGyroAlpha:       maxGyroAlphaRef.current,
            maxGyroBeta:        maxGyroBetaRef.current,
            maxGyroGamma:       maxGyroGammaRef.current,
            orientationStart:   orientStart,
            orientationEnd:     orientEnd,
            orientationDelta:   {
              beta:  Math.round((orientEnd.beta  - orientStart.beta)  * 10) / 10,
              gamma: Math.round((orientEnd.gamma - orientStart.gamma) * 10) / 10,
            },
            gravityVec:         { ...gVec },
            tiltAngleDeg,
            timestamp:          now,
          };

          if (duration <= 200) {
            if (onRepData) onRepData({ status: 'rejected_too_short', burstIndex: (burstCountRef.current + 1) as 1 | 2, ...burstData });
            return;
          }

          if (maxGyroRef.current > GYRO_SHAKE_THRESHOLD) {
            if (onRepData) onRepData({ status: 'rejected_shake', burstIndex: (burstCountRef.current + 1) as 1 | 2, ...burstData });
            burstCountRef.current = 0;
            return;
          }

          burstCountRef.current += 1;

          if (burstCountRef.current === 1) {
            lastBurstTimeRef.current = activeStartTimeRef.current;
            if (onRepData) onRepData({ status: 'valid', burstIndex: 1, ...burstData });
          } else if (burstCountRef.current === 2) {
            countRef.current += 1;
            onCountChange(countRef.current);
            const totalDuration = now - lastBurstTimeRef.current;
            if (onRepData) onRepData({ status: 'valid', burstIndex: 2, ...burstData, totalRepDurationMs: totalDuration });
            triggerHaptic();
            burstCountRef.current = 0;
          }

        } else if (duration > MAX_REP_DURATION_MS) {
          trackStateRef.current = 'idle';
          burstCountRef.current = 0;
          const avgEnergy    = sampleCountRef.current > 0 ? sumEnergyRef.current / sampleCountRef.current : 0;
          const energyRampMs = energyPeakTimeRef.current - activeStartTimeRef.current;
          const orientEnd    = { ...orientationRef.current };
          const gVec         = gravityAtBurstStartRef.current;
          const tiltAngleDeg = Math.round(Math.atan2(Math.hypot(gVec.x, gVec.y), Math.abs(gVec.z)) * 180 / Math.PI);
          if (onRepData) {
            onRepData({
              status: 'rejected_timeout',
              burstIndex: 1,
              burstDurationMs: duration, totalRepDurationMs: 0, energyRampMs, sampleCount: sampleCountRef.current,
              maxEnergy: maxEnergyRef.current, minEnergy: minEnergyRef.current, avgEnergy,
              energyAt25pct: energyAt25Ref.current, energyAt50pct: energyAt50Ref.current, energyAt75pct: energyAt75Ref.current,
              maxLinAcc: maxLinAccRef.current, peakAccRaw: { ...peakAccRawRef.current },
              maxGyro: maxGyroRef.current, maxGyroAlpha: maxGyroAlphaRef.current, maxGyroBeta: maxGyroBetaRef.current, maxGyroGamma: maxGyroGammaRef.current,
              orientationStart: orientationStartRef.current, orientationEnd: orientEnd,
              orientationDelta: { beta: Math.round((orientEnd.beta - orientationStartRef.current.beta) * 10) / 10, gamma: Math.round((orientEnd.gamma - orientationStartRef.current.gamma) * 10) / 10 },
              gravityVec: { ...gVec }, tiltAngleDeg, timestamp: now,
            });
          }
        }
      }
    };

    window.addEventListener('devicemotion', onMotion, { passive: true });
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [onCountChange, onRepData, phase]);

  return {
    phase,
    prepRemaining,
    error,
    isSupported,
    permissionState,
    startSession,
    pauseSession,
    resumeSession,
    resetSession,
  };
};

