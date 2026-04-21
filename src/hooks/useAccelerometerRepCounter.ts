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
const REP_COOLDOWN_MS = 650;

export const useAccelerometerRepCounter = ({
  prepDurationSeconds = 30,
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
  const lastRepTimeRef = useRef(0);

  const resetTrackingState = useCallback(() => {
    smoothedMagnitudeRef.current = null;
    stageRef.current = 'idle';
    lastRepTimeRef.current = 0;
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
      setError('Accelerometer is not supported on this device or requires HTTPS.');
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
        setError('Motion permission was denied. Enable motion access and try again.');
        return false;
      }

      setPermissionState('granted');
      return true;
    } catch {
      setPermissionState('denied');
      setError('Unable to request motion permission on this device.');
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
      const now = Date.now();

      if (stageRef.current === 'idle') {
        if (delta >= PEAK_THRESHOLD && now - lastRepTimeRef.current > REP_COOLDOWN_MS) {
          stageRef.current = 'peak';
        }
        return;
      }

      if (delta <= RESET_THRESHOLD) {
        stageRef.current = 'idle';
        lastRepTimeRef.current = now;
        countRef.current += 1;
        onCountChange(countRef.current);
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
