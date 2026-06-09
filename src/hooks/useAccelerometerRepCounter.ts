import { useCallback, useEffect, useRef, useState } from 'react';

type MotionPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';
export type AccelerometerSessionPhase = 'idle' | 'preparing' | 'active' | 'paused';

type MotionPermissionAPI = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

export interface RepData {
  // ─ Classificazione ─────────────────────────────────────────────────────────
  status: 'valid' | 'rejected_too_short' | 'rejected_shake' | 'rejected_timeout';
  exerciseType?: string; // Es. 'pushups', 'pullups'
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
  waitForStillness?: boolean;
  fallbackToTimer?: boolean;
  exerciseType?: string; // Es. 'pushups', 'pullups' — usato nei log di calibrazione
  onCountChange: (count: number) => void;
  onRepData?: (data: RepData) => void;
}

// ─── Helpers per stabilizzare le callback ────────────────────────────────────
// Le callback vengono wrappate in ref per evitare che il listener devicemotion
// si ri-registri ad ogni render (Bug #4). Il listener legge sempre la versione
// più aggiornata tramite il ref, senza essere incluso nelle deps del useEffect.

// ─── COSTANTI DI RILEVAMENTO ─────────────────────────────────────────────────
// Timeout se il burst si protrae senza mai invertire
const MAX_REP_DURATION_MS = 8000;

// Soglie per esercizio — derivate dall'analisi dei dati di calibrazione reali.
//
// pullups — backtest su 32 sessioni / 168 rep reali:
//   mode 'single_burst': 1 burst valido = 1 ripetizione (accuratezza 88.1%)
//   vs dual_burst: 42.9% — il problema è che la discesa lenta non genera un burst
//   di ritorno separato (l'energia EMA non scende sotto THRESH_REST).
//   active:      140  → min maxEnergy valido = 180.7, margine 40pt
//   rest:         78  → min minEnergy valido = 75.2
//   gyroShake:   673  → midpoint del gap (max_valid=645.6, min_shake=700.5)
//   minDuration: 210  → midpoint del gap (max_tooShort=200ms, min_valid=217ms)
//   repCooldown: 500  → impedisce doppio conteggio nella stessa ripetizione
const EXERCISE_CONFIG: Record<string, {
  active: number;
  rest: number;
  gyroShake: number;
  minDuration: number;
  mode: 'single_burst' | 'dual_burst' | 'peak_count';
  repCooldownMs: number;
  peakRatioThreshold?: number; // solo peak_count: energia min picco = active * ratio
  minRestMs?: number;          // solo peak_count: ms minimi di idle prima di contare la rep
}> = {
  pullups: { active: 140, rest: 78,  gyroShake: 673,  minDuration: 210, mode: 'single_burst', repCooldownMs: 500 },
  // ── Flessioni: peak_count ─────────────────────────────────────────────────────
  // I dati (5 sessioni reali) mostrano picchi a 900-1100 e valley a 73-80.
  // Il burst NON si chiude tra rep ravvicinate (inter-rep energy = 73-90 ≈ rest=75).
  // Soluzione: peak_count — conta ogni picco genuino che supera active*3 (=360)
  pushups: { active: 120, rest: 75, gyroShake: 1200, minDuration: 300, mode: 'peak_count', repCooldownMs: 1200, peakRatioThreshold: 3 },

  default: { active: 180, rest: 100, gyroShake: 700, minDuration: 200, mode: 'dual_burst',  repCooldownMs: 0 },
};

// ─── Feedback aptico ──────────────────────────────────────────────────────────
// AudioContext viene creato lazily dentro startSession (user gesture) per evitare
// che iOS lo blocchi permanentemente quando viene creato a livello modulo.
let _audioCtx: AudioContext | null = null;

const getAudioCtx = (): AudioContext | null => {
  if (_audioCtx) return _audioCtx;
  if (typeof window === 'undefined') return null;
  try {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    return _audioCtx;
  } catch { return null; }
};

const playBeep = async (freq: number, durationMs: number, volume = 0.8) => {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch { /* ignore */ }
};

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate([60, 40, 60]);
  }
  // Beep anche su Android (complementare alla vibrazione) + fallback iOS
  void playBeep(880, 100);
};

// Vibrazione/audio distinta per segnalare l'inizio dell'esercizio.
// Esportata perché usata anche in RepCounterPage come suono di "obiettivo raggiunto".
export const triggerStartHaptic = () => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate([150, 80, 150, 80, 300]);
  }
  // Tre beep ascendenti: udibili su iOS e come rinforzo su Android
  void playBeep(440, 150);
  setTimeout(() => void playBeep(550, 150), 220);
  setTimeout(() => void playBeep(660, 250), 440);
};

export const useAccelerometerRepCounter = ({
  prepDurationSeconds = 5,
  waitForStillness = false,
  fallbackToTimer = false,
  exerciseType,
  onCountChange,
  onRepData,
}: UseAccelerometerRepCounterOptions) => {
  // Bug #4 fix: stabilizzazione callback tramite ref — evita ri-registrazione
  // del listener devicemotion ad ogni render quando le callback cambiano identità.
  const onCountChangeRef = useRef(onCountChange);
  const onRepDataRef = useRef(onRepData);
  useEffect(() => { onCountChangeRef.current = onCountChange; }, [onCountChange]);
  useEffect(() => { onRepDataRef.current = onRepData; }, [onRepData]);
  const [phase, setPhase] = useState<AccelerometerSessionPhase>('idle');
  const [prepRemaining, setPrepRemaining] = useState(prepDurationSeconds);
  const [isDeviceStill, setIsDeviceStill] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<MotionPermissionState>('unknown');

  const previousPhaseRef = useRef<AccelerometerSessionPhase>('preparing');
  const prepEndsAtRef = useRef<number | null>(null);
  const countRef = useRef(0);
  const lastRepTimeRef = useRef<number>(0); // timestamp dell'ultima rep contata (cooldown anti-doppio)

  // ─── Stati Algoritmo (Motion Energy) ─────────────────────────────────────────────
  const gravityRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const initialGravityRef = useRef<{ x: number; y: number; z: number } | null>(null); // Calibrata a T=0
  const energyRef = useRef<number>(0);
  const prevEnergyRef = useRef<number>(0);
  const peakSeenRef = useRef<boolean>(false);
  const peakMaxEnergyRef = useRef<number>(0);
  const peakIdleStartRef = useRef<number>(0);

  // Ref per la fase corrente — accessibile dentro il listener devicemotion
  // senza causare ri-registrazione ad ogni cambio fase.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  
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
    gravityRef.current       = null;
    initialGravityRef.current = null;
    energyRef.current        = 0;
    prevEnergyRef.current    = 0;
    peakSeenRef.current      = false;
    peakMaxEnergyRef.current = 0;
    peakIdleStartRef.current = 0;
    trackStateRef.current    = 'idle';
    burstCountRef.current    = 0;
    lastBurstTimeRef.current = 0;
    lastRepTimeRef.current   = 0;
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
    if (!granted && !fallbackToTimer) return false;

    // Crea/resume AudioContext dentro la user gesture per sbloccare l'audio su iOS
    getAudioCtx();
    const ctx = _audioCtx;
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    countRef.current = 0;
    onCountChange(0);
    resetTrackingState();
    lastRepTimeRef.current = Date.now(); // evita burstDurationMs astronomico sulla prima rep
    setPrepRemaining(prepDurationSeconds);
    previousPhaseRef.current = 'preparing';
    prepEndsAtRef.current = Date.now() + prepDurationSeconds * 1000;
    setPhase('preparing');
    return true;
  }, [onCountChange, prepDurationSeconds, requestMotionPermission, resetTrackingState]);

  const stopSession = useCallback(() => {
    prepEndsAtRef.current = null;
    previousPhaseRef.current = 'idle';
    setPhase('idle');
  }, []);

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
      
      if (waitForStillness) {
        if (energyRef.current > 10) {
          // Device is not still, reset the countdown
          prepEndsAtRef.current = Date.now() + prepDurationSeconds * 1000;
          setIsDeviceStill(false);
        } else {
          setIsDeviceStill(true);
        }
      }

      const remainingMs = Math.max(0, prepEndsAtRef.current - Date.now());
      setPrepRemaining(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0) {
        prepEndsAtRef.current = null;
        previousPhaseRef.current = 'active';
        // Salva la gravità calibrata (telefono in tasca) per filtrare l'estrazione
        if (gravityRef.current) {
          initialGravityRef.current = { ...gravityRef.current };
        }
        triggerStartHaptic();
        setPhase('active');
      } else if (remainingMs <= 1000 && gravityRef.current === null) {
        // Ultimo secondo: avvia la calibrazione della gravity con il telefono in tasca.
        // La gravity vector verrà usata subito quando parte il conteggio.
        resetTrackingState();
        lastRepTimeRef.current = Date.now();
      }
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(interval);
  }, [phase, prepRemaining, resetTrackingState]);

  // ── Listener DeviceOrientation (angoli assoluti) ─────────────────────────────
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


  // ── Listener DeviceMotion: attivo durante preparing (calibrazione) e active (conteggio)
  useEffect(() => {
    if (phase !== 'active' && phase !== 'preparing') return;

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
      const rr      = event.rotationRate;
      const gAlpha  = Math.abs(rr?.alpha || 0);
      const gBeta   = Math.abs(rr?.beta  || 0);
      const gGamma  = Math.abs(rr?.gamma || 0);
      const gyroMag = Math.hypot(gAlpha, gBeta, gGamma);

      const rawEnergy = gyroMag + 40 * linMag;
      prevEnergyRef.current = energyRef.current;
      energyRef.current = energyRef.current * 0.6 + rawEnergy * 0.4;
      const energy = energyRef.current;

      // 5. Ritorno in 'preparing' se il dispositivo viene mosso bruscamente (solo in waitForStillness)
      if (waitForStillness && phaseRef.current === 'active') {
        if (energy > 40) {
          prepEndsAtRef.current = Date.now() + prepDurationSeconds * 1000;
          previousPhaseRef.current = 'preparing';
          setPrepRemaining(prepDurationSeconds);
          setPhase('preparing');
          return;
        }
      }

      const cfg_peek = (exerciseType && EXERCISE_CONFIG[exerciseType])
        ? EXERCISE_CONFIG[exerciseType]
        : EXERCISE_CONFIG.default;

      if (cfg_peek.mode === 'peak_count') {
        const peakThresh = cfg_peek.active * (cfg_peek.peakRatioThreshold ?? 3);

        if (energy > cfg_peek.active) {
          if (energy > peakMaxEnergyRef.current) peakMaxEnergyRef.current = energy;
          if (peakMaxEnergyRef.current > peakThresh) peakSeenRef.current = true;
          peakIdleStartRef.current = 0;
        } else {
          if (peakIdleStartRef.current === 0) peakIdleStartRef.current = now;

          // Conta solo durante la fase attiva (non durante la calibrazione)
          if (phaseRef.current === 'active' && peakSeenRef.current) {
            
            // CONTROLLO GRAVITÀ: scarta il movimento se il telefono non è più 
            // nell'orientamento iniziale (es. quando viene estratto dalla tasca).
            let isSameOrientation = true;
            if (initialGravityRef.current) {
              const ig = initialGravityRef.current;
              const cg = gravity;
              const dot = ig.x * cg.x + ig.y * cg.y + ig.z * cg.z;
              const magIg = Math.hypot(ig.x, ig.y, ig.z);
              const magCg = Math.hypot(cg.x, cg.y, cg.z);
              if (magIg > 0 && magCg > 0) {
                const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (magIg * magCg))));
                if (angleRad > Math.PI / 2.7) { // ~66 gradi: tollera tasche larghe, blocca l'alzata in piedi (~90 gradi)
                  isSameOrientation = false;
                }
              }
            }

            if (isSameOrientation) {
              const sinceLastRep = now - lastRepTimeRef.current;
              if (sinceLastRep >= cfg_peek.repCooldownMs) {
                countRef.current += 1;
                onCountChangeRef.current(countRef.current);
                lastRepTimeRef.current = now;
                triggerHaptic();
                if (onRepDataRef.current) {
                  onRepDataRef.current({
                    status: 'valid', burstIndex: 1, exerciseType,
                    burstDurationMs: sinceLastRep, totalRepDurationMs: sinceLastRep,
                    energyRampMs: 0, sampleCount: 0,
                    maxEnergy: peakMaxEnergyRef.current, minEnergy: energy,
                    avgEnergy: 0, energyAt25pct: 0, energyAt50pct: 0, energyAt75pct: 0,
                    maxLinAcc: 0, peakAccRaw: { x: 0, y: 0, z: 0 },
                    maxGyro: 0, maxGyroAlpha: 0, maxGyroBeta: 0, maxGyroGamma: 0,
                    orientationStart: { alpha: 0, beta: 0, gamma: 0 },
                    orientationEnd:   { alpha: 0, beta: 0, gamma: 0 },
                    orientationDelta: { beta: 0, gamma: 0 },
                    gravityVec: { ...gravity }, tiltAngleDeg: 0, timestamp: now,
                  });
                }
              }
            }
            
            peakSeenRef.current      = false;
            peakMaxEnergyRef.current = 0;
          }
        }
        return;
      }

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
      const cfg = (exerciseType && EXERCISE_CONFIG[exerciseType])
        ? EXERCISE_CONFIG[exerciseType]
        : EXERCISE_CONFIG.default;

      const THRESH_ACTIVE    = cfg.active;
      const THRESH_REST      = cfg.rest;
      const GYRO_SHAKE_LIMIT = cfg.gyroShake;
      const MIN_DURATION     = cfg.minDuration;

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
            exerciseType,
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

          if (duration <= MIN_DURATION) {
            // Bug #2 fix: se siamo in dual_burst e B1 era già stato contato,
            // un B2 troppo corto deve resettare il contatore altrimenti il prossimo
            // burst valido qualsiasi viene erroneamente contato come completamento rep.
            if (cfg.mode === 'dual_burst') burstCountRef.current = 0;
            if (onRepDataRef.current) onRepDataRef.current({ status: 'rejected_too_short', burstIndex: (burstCountRef.current + 1) as 1 | 2, ...burstData });
            return;
          }

          if (maxGyroRef.current > GYRO_SHAKE_LIMIT) {
            // Bug #2 fix: stesso problema — reset esplicito in caso di shake su B2.
            burstCountRef.current = 0;
            if (onRepDataRef.current) onRepDataRef.current({ status: 'rejected_shake', burstIndex: (burstCountRef.current + 1) as 1 | 2, ...burstData });
            return;
          }

          // ── Modalità single_burst: ogni burst valido = 1 rep ────────────────
          if (cfg.mode === 'single_burst') {
            const sinceLastRep = now - lastRepTimeRef.current;
            if (sinceLastRep < cfg.repCooldownMs) {
              // Siamo nel cooldown: scarta il burst (troppo vicino alla rep precedente)
              if (onRepDataRef.current) onRepDataRef.current({ status: 'rejected_too_short', burstIndex: 1, ...burstData });
              return;
            }
            // ✅ Conta la ripetizione
            countRef.current += 1;
            onCountChangeRef.current(countRef.current);
            lastRepTimeRef.current = now;
            if (onRepDataRef.current) onRepDataRef.current({ status: 'valid', burstIndex: 1, ...burstData, totalRepDurationMs: duration });
            triggerHaptic();
            burstCountRef.current = 0;
            return;
          }

          // ── Modalità dual_burst: B1 + B2 = 1 rep (logica originale) ─────────
          burstCountRef.current += 1;

          if (burstCountRef.current === 1) {
            lastBurstTimeRef.current = activeStartTimeRef.current;
            if (onRepDataRef.current) onRepDataRef.current({ status: 'valid', burstIndex: 1, ...burstData });
          } else if (burstCountRef.current === 2) {
            countRef.current += 1;
            onCountChangeRef.current(countRef.current);
            const totalDuration = now - lastBurstTimeRef.current;
            if (onRepDataRef.current) onRepDataRef.current({ status: 'valid', burstIndex: 2, ...burstData, totalRepDurationMs: totalDuration });
            triggerHaptic();
            burstCountRef.current = 0;
          } else {
            // Burst > 2: stato inconsistente, resettiamo per sicurezza
            burstCountRef.current = 0;
          }

        } else if (duration > MAX_REP_DURATION_MS) {
          trackStateRef.current = 'idle';
          burstCountRef.current = 0; // Reset anche qui per sicurezza (Bug #2 defense)
          const avgEnergy    = sampleCountRef.current > 0 ? sumEnergyRef.current / sampleCountRef.current : 0;
          const energyRampMs = energyPeakTimeRef.current - activeStartTimeRef.current;
          const orientEnd    = { ...orientationRef.current };
          const gVec         = gravityAtBurstStartRef.current;
          const tiltAngleDeg = Math.round(Math.atan2(Math.hypot(gVec.x, gVec.y), Math.abs(gVec.z)) * 180 / Math.PI);
          if (onRepDataRef.current) {
            onRepDataRef.current({
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
    // Bug #1 fix: aggiunto exerciseType alle deps — se l'utente cambia esercizio
    // senza smontare il componente, il listener rilegge la cfg corretta.
    // Bug #4 fix: onCountChange e onRepData sono letti tramite ref, non inclusi
    // nelle deps — il listener non si ri-registra ad ogni render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, exerciseType]);

  return {
    phase,
    prepRemaining,
    isDeviceStill,
    error,
    permissionState,
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    resetSession,
  };
};
