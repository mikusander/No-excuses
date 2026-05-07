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

const PEAK_THRESHOLD = 1.2;
const RESET_THRESHOLD = 0.35;
const ROTATION_THRESHOLD = 90;
const ROTATION_RESET_THRESHOLD = 20;
const BURST_GAP_MS = 250;
const CYCLE_TIMEOUT_MS = 2500;

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
  const smoothedMagnitudeRef = useRef<number | null>(null);
  const stageRef = useRef<'idle' | 'peak'>('idle');
  const burstCycleRef = useRef<'idle' | 'awaitingSecondBurst'>('idle');
  const lastBurstTimeRef = useRef(0);

  const resetTrackingState = useCallback(() => {
    smoothedMagnitudeRef.current = null;
    stageRef.current = 'idle';
    burstCycleRef.current = 'idle';
    lastBurstTimeRef.current = 0;
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

  useEffect(() => {
    if (phase !== 'active') return;

    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity ?? event.acceleration;
      if (!acceleration) return;

      const rotationRate = event.rotationRate;

      const magnitude = Math.hypot(
        acceleration.x ?? 0,
        acceleration.y ?? 0,
        acceleration.z ?? 0,
      );

      if (!Number.isFinite(magnitude)) return;

      const previousSmoothed = smoothedMagnitudeRef.current;
      const smoothedMagnitude = previousSmoothed == null
        ? magnitude
        : previousSmoothed * 0.85 + magnitude * 0.15;

      smoothedMagnitudeRef.current = smoothedMagnitude;
      const delta = Math.abs(magnitude - smoothedMagnitude);
      const rotationMagnitude = rotationRate
        ? Math.hypot(rotationRate.alpha ?? 0, rotationRate.beta ?? 0, rotationRate.gamma ?? 0)
        : 0;
      const now = Date.now();

      if (stageRef.current === 'idle') {
        if (delta >= PEAK_THRESHOLD || rotationMagnitude >= ROTATION_THRESHOLD) {
          stageRef.current = 'peak';
        }
        return;
      }

      if (delta <= RESET_THRESHOLD && rotationMagnitude <= ROTATION_RESET_THRESHOLD) {
        stageRef.current = 'idle';

        if (burstCycleRef.current === 'idle') {
          burstCycleRef.current = 'awaitingSecondBurst';
          lastBurstTimeRef.current = now;
          return;
        }

        const elapsed = now - lastBurstTimeRef.current;
        if (elapsed >= BURST_GAP_MS && elapsed <= CYCLE_TIMEOUT_MS) {
          countRef.current += 1;
          onCountChange(countRef.current);
          burstCycleRef.current = 'idle';
          lastBurstTimeRef.current = now;
          return;
        }

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
