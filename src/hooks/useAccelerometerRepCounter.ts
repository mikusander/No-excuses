import { useCallback, useEffect, useRef, useState } from 'react';

type MotionPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';
export type AccelerometerSessionPhase = 'idle' | 'preparing' | 'active' | 'paused';

type MotionPermissionAPI = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

interface UseAccelerometerRepCounterOptions {
  prepDurationSeconds?: number;
  onCountChange: (count: number) => void;
}

// ─── Soglie accelerometro ──────────────────────────────────────────────────────
// Picco di accelerazione minimo per iniziare un "burst" (m/s² delta)
const PEAK_THRESHOLD = 1.2;
// Delta sotto cui il movimento è considerato "fermo" dopo un picco
const RESET_THRESHOLD = 0.35;
// Finestra temporale entro cui i due burst devono avvenire per contare una rep
const BURST_GAP_MS = 250;
const CYCLE_TIMEOUT_MS = 2500;

// ─── Soglie giroscopio (filtro anti-movimento-casuale) ─────────────────────────
// Il giroscopio misura la velocità angolare (°/s).
// Durante una ripetizione il telefono è in tasca e ruota LENTAMENTE (corpo che
// si muove): ~20–60 °/s. Un movimento casuale/brusco produce valori molto più
// alti e soprattutto molto variabili nel breve periodo.
//
// Strategia: calcoliamo la deviazione standard della magnitudine del giroscopio
// sull'ultima finestra temporale (GYRO_WINDOW_MS). Se la std è alta → il
// movimento è irregolare/caotico → la ripetizione NON viene confermata.
const GYRO_WINDOW_MS = 600;          // finestra campioni giroscopio
const GYRO_STD_MAX = 55;             // °/s: std massima consentita (movimento "fluido")
const GYRO_MAGNITUDE_MAX = 300;      // °/s: picco assoluto massimo (scuotimento violento)

// ─── Feedback aptico ──────────────────────────────────────────────────────────
const triggerHaptic = () => {
  if ('vibrate' in navigator) {
    // Doppio impulso breve: indica chiaramente una ripetizione confermata
    navigator.vibrate([60, 40, 60]);
  }
};

// ─── Calcolo deviazione standard su array ────────────────────────────────────
const stdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export const useAccelerometerRepCounter = ({
  prepDurationSeconds = 10,
  onCountChange,
}: UseAccelerometerRepCounterOptions) => {
  const [phase, setPhase] = useState<AccelerometerSessionPhase>('idle');
  const [prepRemaining, setPrepRemaining] = useState(prepDurationSeconds);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<MotionPermissionState>('unknown');

  const previousPhaseRef = useRef<AccelerometerSessionPhase>('preparing');
  const prepEndsAtRef = useRef<number | null>(null);
  const countRef = useRef(0);

  // Accelerometro
  const smoothedMagnitudeRef = useRef<number | null>(null);
  const stageRef = useRef<'idle' | 'peak'>('idle');
  const burstCycleRef = useRef<'idle' | 'awaitingSecondBurst'>('idle');
  const lastBurstTimeRef = useRef(0);

  // Giroscopio: buffer temporizzato di campioni { ts, value }
  const gyroBufferRef = useRef<{ ts: number; value: number }[]>([]);

  const resetTrackingState = useCallback(() => {
    smoothedMagnitudeRef.current = null;
    stageRef.current = 'idle';
    burstCycleRef.current = 'idle';
    lastBurstTimeRef.current = 0;
    gyroBufferRef.current = [];
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

    if (!prepEndsAtRef.current) {
      prepEndsAtRef.current = Date.now() + prepRemaining * 1000;
    }

    const updateCountdown = () => {
      if (!prepEndsAtRef.current) return;
      const remainingMs = Math.max(0, prepEndsAtRef.current - Date.now());
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setPrepRemaining(remainingSeconds);

      if (remainingMs <= 0) {
        prepEndsAtRef.current = null;
        previousPhaseRef.current = 'active';
        resetTrackingState();
        setPhase('active');
      }
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(interval);
  }, [phase, prepRemaining, resetTrackingState]);

  // ── Listener DeviceMotion (accelerometro + giroscopio) ─────────────────────
  useEffect(() => {
    if (phase !== 'active') return;

    const onMotion = (event: DeviceMotionEvent) => {
      const now = Date.now();

      // ── 1. Giroscopio: aggiorna buffer e calcola stabilità ─────────────────
      const rr = event.rotationRate;
      const gyroMagnitude = rr
        ? Math.hypot(rr.alpha ?? 0, rr.beta ?? 0, rr.gamma ?? 0)
        : 0;

      // Aggiungi campione e rimuovi i più vecchi di GYRO_WINDOW_MS
      gyroBufferRef.current.push({ ts: now, value: gyroMagnitude });
      gyroBufferRef.current = gyroBufferRef.current.filter(
        (s) => now - s.ts <= GYRO_WINDOW_MS
      );

      const gyroValues = gyroBufferRef.current.map((s) => s.value);
      const gyroStd = stdDev(gyroValues);

      // ── 2. Accelerometro: calcolo magnitudine e delta ───────────────────────
      const acc = event.accelerationIncludingGravity ?? event.acceleration;
      if (!acc) return;

      const magnitude = Math.hypot(acc.x ?? 0, acc.y ?? 0, acc.z ?? 0);
      if (!Number.isFinite(magnitude)) return;

      const prev = smoothedMagnitudeRef.current;
      const smoothed = prev == null ? magnitude : prev * 0.85 + magnitude * 0.15;
      smoothedMagnitudeRef.current = smoothed;

      const delta = Math.abs(magnitude - smoothed);

      // ── 3. Macchina a stati: rilevamento burst ──────────────────────────────
      if (stageRef.current === 'idle') {
        if (delta >= PEAK_THRESHOLD) {
          stageRef.current = 'peak';
        }
        return;
      }

      // Siamo in "peak": aspettiamo che il movimento si calmi
      if (delta <= RESET_THRESHOLD) {
        stageRef.current = 'idle';

        if (burstCycleRef.current === 'idle') {
          // Primo burst: inizia il ciclo
          burstCycleRef.current = 'awaitingSecondBurst';
          lastBurstTimeRef.current = now;
          return;
        }

        // Secondo burst: valida il ciclo
        const elapsed = now - lastBurstTimeRef.current;
        if (elapsed >= BURST_GAP_MS && elapsed <= CYCLE_TIMEOUT_MS) {

          // ── 4. Validazione giroscopio ─────────────────────────────────────
          // Il movimento deve essere fluido: gyroStd bassa e nessun picco violento
          const isGyroStable = gyroStd <= GYRO_STD_MAX && gyroMagnitude <= GYRO_MAGNITUDE_MAX;

          if (isGyroStable) {
            countRef.current += 1;
            onCountChange(countRef.current);
            // ── 5. Feedback aptico ─────────────────────────────────────────
            triggerHaptic();
          }
          // Resetta il ciclo in ogni caso (anche se scartato)
          burstCycleRef.current = 'idle';
          lastBurstTimeRef.current = now;
          return;
        }

        // Timeout o troppo ravvicinato: riparte il ciclo dal nuovo burst
        burstCycleRef.current = 'awaitingSecondBurst';
        lastBurstTimeRef.current = now;
      }
    };

    window.addEventListener('devicemotion', onMotion, { passive: true });
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [onCountChange, phase]);

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
