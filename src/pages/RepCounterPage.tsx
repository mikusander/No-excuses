import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Play, Pause, AlertCircle, AlertTriangle, Target, Activity, Repeat, Video, Smartphone, Timer, Square, Flag } from 'lucide-react';
import { usePoseLandmarker } from '../hooks/usePoseLandmarker';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { useAccelerometerRepCounter } from '../hooks/useAccelerometerRepCounter';
import { ExerciseTracker } from '../logic/exerciseTracker';
import { speak, speakNumber } from '../utils/voice';
import { playErrorSound, playGoalReachedSound } from '../utils/audio';
import type { ExerciseType } from '../types';
import PoseOverlay from '../components/PoseOverlay';

type CountingMode = 'video' | 'accelerometer';

const RepCounterPage: React.FC = () => {
  const navigate = useNavigate();
  const [countingMode, setCountingMode] = useState<CountingMode>('video');
  // Obiettivo ripetizioni: null = infinito
  const [repTarget, setRepTarget] = useState<number | null>(null);
  const [repTargetInput, setRepTargetInput] = useState('');

  // Calibration logic
  const [isCalibrationMode, setIsCalibrationMode] = useState(false);
  const [calibrationLogs, setCalibrationLogs] = useState<any[]>([]);
  const [showCalibrationLogs, setShowCalibrationLogs] = useState(false);

  // Setup logic states
  const [selectedExercise, setSelectedExercise] = useState<ExerciseType | null>(null);
  const { detectPose, isLoading, error: poseError } = usePoseLandmarker(countingMode === 'video' && selectedExercise !== null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // Tracking states
  const [count, setCount] = useState(0);
  const [debugData, setDebugData] = useState<{ angle: number; stage: string | null; error?: boolean; warning?: string; okMsg?: string }>({ angle: 0, stage: null });
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [isCountingActive, setIsCountingActive] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showVoiceCommandsBanner, setShowVoiceCommandsBanner] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [poseResults, setPoseResults] = useState<any>(null);

  const trackerRef = useRef<ExerciseTracker | null>(null);
  const lastStateUpdateTime = useRef(0);
  const selectedExerciseRef = useRef(selectedExercise);
  // Refs to avoid stale closures in the rAF loop (Bug #1 & #4)
  const isCountingActiveRef = useRef(isCountingActive);
  const pausedRef = useRef(paused);

  const {
    phase: accelerometerPhase,
    prepRemaining,
    error: accelerometerError,
    startSession: startAccelerometerSession,
    pauseSession: pauseAccelerometerSession,
    resumeSession: resumeAccelerometerSession,
    resetSession: resetAccelerometerSession,
  } = useAccelerometerRepCounter({
    onCountChange: (newCount) => {
      setCount(newCount);
      // Verifica obiettivo per la modalità accelerometro
      if (repTarget !== null && newCount >= repTarget) {
        playGoalReachedSound();
        resetAccelerometerSession();
      }
    },
    onRepData: (data) => {
      if (isCalibrationMode) {
        setCalibrationLogs(prev => [...prev, data]);
      }
    }
  });

  // Sync refs for the animation frame (avoids stale closures)
  useEffect(() => { selectedExerciseRef.current = selectedExercise; }, [selectedExercise]);
  useEffect(() => { isCountingActiveRef.current = isCountingActive; }, [isCountingActive]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!selectedExercise || countingMode !== 'video') {
      setShowVoiceCommandsBanner(false);
      return;
    }

    setShowVoiceCommandsBanner(true);
    const bannerTimer = window.setTimeout(() => setShowVoiceCommandsBanner(false), 5000);
    return () => window.clearTimeout(bannerTimer);
  }, [selectedExercise, countingMode]);

  const initTracker = () => {
    trackerRef.current = new ExerciseTracker(
      repTarget ?? Infinity,
      (newCount) => {
        setCount(newCount);
        speakNumber(newCount);
        // Verifica obiettivo per la modalità video
        if (repTarget !== null && newCount >= repTarget) {
          playGoalReachedSound();
          // Stop automatico al raggiungimento del target
          setIsCountingActive(false);
        }
      },
      (msg) => speak(msg),
      (data) => {
        if (performance.now() - lastStateUpdateTime.current > 66) {
          setDebugData(data);
          lastStateUpdateTime.current = performance.now();
        }
      }
    );
  };

  const startVideoCounting = () => {
    if (isCountingActive || !trackerRef.current || !selectedExerciseRef.current || !isCameraReady || isLoading) return;
    trackerRef.current.resetTrackingState();
    setPaused(false);
    setIsCountingActive(true);
  };

  const stopVideoCounting = () => {
    if (!isCountingActive) return;
    trackerRef.current?.resetTrackingState();
    setIsCountingActive(false);
  };

  useVoiceCommands({
    onStart: startVideoCounting,
    onStop: stopVideoCounting,
    onPause: () => setPaused(true),
    onResume: () => setPaused(false),
    enabled: countingMode === 'video' && selectedExercise !== null && isCameraReady && !isLoading
  });

  // Start Camera when exercise is selected
  useEffect(() => {
    if (!selectedExercise || countingMode !== 'video') return;

    let isCancelled = false;

    const startCamera = async () => {
      try {
        if (!window.isSecureContext) {
          setCameraError('La fotocamera sul telefono richiede una connessione sicura (HTTPS o localhost).');
          return;
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 }
        });

        if (isCancelled) {
          mediaStream.getTracks().forEach(track => track.stop());
          return;
        }

        setCameraStream(mediaStream);
      } catch (err) {
        console.error("Camera access error:", err);
        setCameraError('Impossibile accedere alla fotocamera. Controlla i permessi del browser e usa HTTPS sul telefono.');
      }
    };

    startCamera();
    setShowHint(true);
    const hintTimer = setTimeout(() => setShowHint(false), 8000);

    return () => {
      isCancelled = true;
      clearTimeout(hintTimer);
      setCameraStream((currentStream) => {
        currentStream?.getTracks().forEach(track => track.stop());
        return null;
      });
    };
  }, [selectedExercise, countingMode]);

  useEffect(() => {
    if (countingMode !== 'video' || !cameraStream || !videoRef.current) return;

    const videoElement = videoRef.current;
    const [videoTrack] = cameraStream.getVideoTracks();

    const handleTrackEnded = () => {
      setIsCameraReady(false);
      setCameraError('La fotocamera si è disconnessa. Riapri l\'esercizio per riprovare.');
    };

    if (videoElement.srcObject !== cameraStream) {
      videoElement.srcObject = cameraStream;
    }

    videoTrack?.addEventListener('ended', handleTrackEnded);

    videoElement.onloadedmetadata = () => {
      setVideoSize({
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      });
      setCameraError(null);
      setIsCameraReady(true);
      videoElement.play().catch((e) => console.error("Play error:", e));
    };

    if (videoElement.readyState >= 1) {
      videoElement.onloadedmetadata?.(new Event('loadedmetadata'));
    }

    return () => {
      videoElement.onloadedmetadata = null;
      videoTrack?.removeEventListener('ended', handleTrackEnded);
    };
  }, [cameraStream, countingMode]);

  // Frame processing loop
  // IMPORTANT: isCountingActive and paused are read via refs to avoid stale closures.
  // detectPose is stable (memoized with useCallback). The loop starts when the camera
  // is ready and never restarts due to counting/pause state changes.
  useEffect(() => {
    if (!selectedExercise || countingMode !== 'video' || !isCameraReady) return;

    let animationId: number;
    let lastRenderTime = 0;

    const processFrame = () => {
      // Read current values from refs — NOT from closure (Bug #1 fix)
      if (!pausedRef.current && videoRef.current) {
        // Bug #3 fix: use performance.now() for a monotonically-increasing timestamp
        const timestamp = performance.now();
        const results = detectPose(videoRef.current, timestamp);

        if (results && results.landmarks && results.landmarks.length > 0) {
          if (timestamp - lastRenderTime > 33) {
            setPoseResults(results);
            lastRenderTime = timestamp;
          }

          const landmarks = results.landmarks[0];
          const currentEx = selectedExerciseRef.current;

          // Read isCountingActive from ref, not stale closure (Bug #1 fix)
          if (isCountingActiveRef.current) {
            if (currentEx === 'pullups') trackerRef.current?.updatePullup(landmarks);
            else if (currentEx === 'pushups') trackerRef.current?.updatePushup(landmarks);
            else if (currentEx === 'squats') trackerRef.current?.updateSquat(landmarks);
          }
        }
      }
      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExercise, countingMode, isCameraReady, detectPose]);


  const handleSelectExercise = async (type: ExerciseType) => {
    setCount(0);
    setPoseResults(null);
    setIsCameraReady(false);
    setCameraError(null);
    setPaused(false);
    setIsCountingActive(false);
    setDebugData({ angle: 0, stage: null });
    resetAccelerometerSession();
    initTracker();
    setSelectedExercise(type);

    if (countingMode === 'accelerometer') {
      await startAccelerometerSession();
    }
  };

  const cancelWorkout = () => {
    setSelectedExercise(null);
    setIsCameraReady(false);
    setCameraError(null);
    setPaused(false);
    setIsCountingActive(false);
    setShowVoiceCommandsBanner(false);
    setCount(0);
    setIsCalibrationMode(false);
    setShowCalibrationLogs(false);
    setCalibrationLogs([]);
    resetAccelerometerSession();
    trackerRef.current?.reset();
  };

  const isAccelerometerMode = countingMode === 'accelerometer';
  const isAccelerometerPaused = accelerometerPhase === 'paused';
  const isAccelerometerPreparing = accelerometerPhase === 'preparing';
  const isAccelerometerActive = accelerometerPhase === 'active';
  const accelerometerStatusLabel = accelerometerError
    ? 'Accelerometro non disponibile'
    : isAccelerometerPreparing
      ? 'Preparati all\'esercizio'
      : isAccelerometerActive
        ? 'Conteggio ripetizioni in corso'
        : isAccelerometerPaused
          ? (prepRemaining > 0 ? 'Preparazione in pausa' : 'Conteggio in pausa')
          : 'Avvio accelerometro';
  const videoStatusLabel = isCountingActive && !paused ? 'Attivo' : 'In pausa';

  // --- RENDERING ---

  // SCHERMATA DI SELEZIONE ESERCIZIO
  if (!selectedExercise) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col">
        <header className="p-4 flex items-center bg-black/50">
          <button onClick={() => navigate('/')} className="p-2 text-white hover:text-brand-orange transition-colors">
            <ArrowLeft size={28} />
          </button>
          <h1 className="text-xl font-bold ml-4 text-white">Nuovo Workout</h1>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6 w-full max-w-md mx-auto">
          <h2 className="text-2xl font-black text-white text-center mb-4 uppercase tracking-widest">
            Scegli il tuo Esercizio
          </h2>

          {/* Modalità conteggio */}
          <div className="w-full rounded-3xl border border-white/10 bg-brand-darkGrey/40 p-2 shadow-lg">
            <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Modalità conteggio</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCountingMode('video')}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-all ${countingMode === 'video' ? 'bg-brand-orange text-black shadow-lg' : 'bg-black/30 text-white/70 hover:bg-black/50'}`}
              >
                <Video className="h-4 w-4" />
                Fotocamera
              </button>
              <button
                type="button"
                onClick={() => setCountingMode('accelerometer')}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-all ${countingMode === 'accelerometer' ? 'bg-brand-orange text-black shadow-lg' : 'bg-black/30 text-white/70 hover:bg-black/50'}`}
              >
                <Smartphone className="h-4 w-4" />
                Accelerometro
              </button>
            </div>
            <p className="px-2 pt-3 text-xs leading-relaxed text-white/50">
              {countingMode === 'video'
                ? 'Usa la fotocamera e il rilevamento pose di MediaPipe.'
                : 'Usa il sensore di movimento del telefono. Metti il telefono in tasca durante il conto alla rovescia di 10 secondi.'}
            </p>
          </div>

          {/* Obiettivo ripetizioni */}
          <div className="w-full rounded-3xl border border-white/10 bg-brand-darkGrey/40 p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <Flag className="h-4 w-4 text-brand-orange" />
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Obiettivo ripetizioni</p>
            </div>
            <p className="text-xs text-white/40 mb-3 leading-relaxed">
              Inserisci un numero per fermare automaticamente il conteggio quando lo raggiungi — il telefono suonerà. Lascia vuoto per contare all'infinito.
            </p>
            <div className="flex items-center gap-3">
              <input
                id="rep-target-input"
                type="number"
                min="1"
                max="999"
                placeholder="∞  nessun limite"
                value={repTargetInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setRepTargetInput(raw);
                  const parsed = parseInt(raw, 10);
                  setRepTarget(!raw || isNaN(parsed) || parsed < 1 ? null : parsed);
                }}
                className="flex-1 rounded-2xl bg-black/40 border border-white/10 text-white placeholder:text-white/25 px-4 py-3 text-sm font-bold outline-none focus:border-brand-orange/60 focus:ring-1 focus:ring-brand-orange/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {repTarget !== null && (
                <div className="flex items-center gap-1.5 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 px-3 py-2">
                  <Flag className="h-4 w-4 text-brand-orange" />
                  <span className="text-brand-orange font-black text-sm">{repTarget}</span>
                </div>
              )}
            </div>
          </div>

          {/* Calibrazione Sperimentale */}
          <div className="w-full rounded-3xl border border-purple-500/20 bg-purple-500/5 p-4 shadow-lg flex items-center justify-between">
             <div className="flex flex-col">
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-purple-400">Modalità Calibrazione</span>
                <span className="text-xs text-white/50 mt-1">Registra 10 rep per analizzare i dati</span>
             </div>
             <button
               onClick={() => {
                 const newVal = !isCalibrationMode;
                 setIsCalibrationMode(newVal);
                 if (newVal) {
                   setCountingMode('accelerometer');
                   setRepTarget(null);
                   setRepTargetInput('');
                   setCalibrationLogs([]);
                 } else {
                   setRepTarget(null);
                   setRepTargetInput('');
                 }
               }}
               className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${isCalibrationMode ? 'bg-purple-500' : 'bg-black/40 border border-white/10'}`}
             >
               <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-md ${isCalibrationMode ? 'left-7' : 'left-1'}`} />
             </button>
          </div>

          <button
            onClick={() => handleSelectExercise('pullups')}
            className="w-full bg-brand-darkGrey border border-brand-orange/50 hover:border-brand-orange hover:bg-brand-orange/10 text-white rounded-3xl p-6 flex items-center justify-between transition-all group shadow-lg"
          >
            <div className="flex items-center gap-4">
              <div className="bg-black/50 p-4 rounded-full group-hover:bg-brand-orange/20 transition-colors">
                <Target className="w-8 h-8 text-brand-orange" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider">Trazioni</h3>
                <p className="text-brand-grey text-sm">Schiena e Bicipiti</p>
              </div>
            </div>
            <Play className="w-6 h-6 text-brand-grey group-hover:text-brand-orange transition-colors" />
          </button>

          <button
            onClick={() => handleSelectExercise('pushups')}
            className="w-full bg-brand-darkGrey border border-brand-lightOrange/50 hover:border-brand-lightOrange hover:bg-brand-lightOrange/10 text-white rounded-3xl p-6 flex items-center justify-between transition-all group shadow-lg"
          >
            <div className="flex items-center gap-4">
              <div className="bg-black/50 p-4 rounded-full group-hover:bg-brand-lightOrange/20 transition-colors">
                <Repeat className="w-8 h-8 text-brand-lightOrange" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider">Flessioni</h3>
                <p className="text-brand-grey text-sm">Petto e Tricipiti</p>
              </div>
            </div>
            <Play className="w-6 h-6 text-brand-grey group-hover:text-brand-lightOrange transition-colors" />
          </button>

          <button
            onClick={() => handleSelectExercise('squats')}
            className="w-full bg-brand-darkGrey border border-white/20 hover:border-white hover:bg-white/10 text-white rounded-3xl p-6 flex items-center justify-between transition-all group shadow-lg"
          >
            <div className="flex items-center gap-4">
              <div className="bg-black/50 p-4 rounded-full group-hover:bg-white/20 transition-colors">
                <Activity className="w-8 h-8 text-white" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold uppercase tracking-wider">Squat</h3>
                <p className="text-brand-grey text-sm">Gambe e Glutei</p>
              </div>
            </div>
            <Play className="w-6 h-6 text-brand-grey group-hover:text-white transition-colors" />
          </button>
        </main>
      </div>
    );
  }

  if (isAccelerometerMode) {
    const currentExerciseLabel = selectedExercise === 'pullups' ? 'Trazioni' : selectedExercise === 'pushups' ? 'Flessioni' : 'Squat';

    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-brand-dark">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(196,90,0,0.18),transparent_55%)]" />
        <div className="relative z-10 flex items-center justify-between p-4 sm:p-6 bg-black/30 backdrop-blur-md border-b border-white/10">
          <button onClick={cancelWorkout} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Modalità accelerometro</p>
            <h2 className="text-xl font-bold uppercase tracking-widest text-brand-orange">{currentExerciseLabel}</h2>
          </div>
          <div className="w-10" />
        </div>

        <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border border-brand-orange/40 bg-brand-orange/10 shadow-[0_0_30px_rgba(196,90,0,0.2)]">
            <Smartphone className="h-12 w-12 text-brand-orange" />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/40">{accelerometerStatusLabel}</p>
            {accelerometerError ? (
              <div className="max-w-sm rounded-3xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100">
                {accelerometerError}
              </div>
            ) : isAccelerometerPreparing ? (
              <>
                <div className="text-7xl font-black text-white">{prepRemaining}</div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/70">
                  <Timer className="h-4 w-4 text-brand-orange" />
                  Metti il telefono in tasca e preparati
                </div>
              </>
            ) : (
              <>
                <div className="text-7xl font-black text-white">{count}</div>
                <p className="text-sm uppercase tracking-[0.35em] text-brand-orange">Ripetizioni</p>
                {repTarget !== null && (
                  <div className="w-full max-w-[220px] mt-2">
                    <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">
                      <span>Progresso</span>
                      <span>{count}/{repTarget}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-orange transition-all duration-300"
                        style={{ width: `${Math.min(100, (count / repTarget) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="max-w-sm rounded-3xl border border-white/10 bg-black/20 px-5 py-4 text-sm leading-relaxed text-white/60">
            {accelerometerError
              ? 'Torna alla selezione esercizio e riprova dopo aver abilitato l\'accesso al movimento.'
              : isAccelerometerPreparing
                ? 'Il conto alla rovescia ti dà il tempo per prepararti. Il conteggio parte automaticamente allo zero.'
                : isAccelerometerPaused
                  ? 'Premi riprendi per continuare la preparazione o l\'esercizio.'
                  : 'Le ripetizioni aumentano quando il telefono rileva un ciclo completo giù-su dalla tasca.'}
          </div>

          <div className="flex w-full max-w-sm gap-3">
            <button
              type="button"
              onClick={isAccelerometerPaused ? resumeAccelerometerSession : pauseAccelerometerSession}
              disabled={!!accelerometerError || accelerometerPhase === 'idle'}
              className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 text-sm font-bold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="inline-flex items-center justify-center gap-2">
                {isAccelerometerPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {isAccelerometerPaused ? 'Riprendi' : 'Pausa'}
              </span>
            </button>
            {isCalibrationMode ? (
              <button
                type="button"
                onClick={() => {
                  setShowCalibrationLogs(true);
                  pauseAccelerometerSession();
                }}
                className="flex-1 rounded-2xl border border-purple-500/50 bg-purple-500/20 px-5 py-4 text-sm font-bold text-purple-200 transition-colors hover:bg-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Flag className="h-4 w-4" />
                  Salva Log
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelWorkout}
                className="flex-1 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm font-bold text-red-100 transition-colors hover:bg-red-500/20"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Square className="h-4 w-4" />
                  Termina esercizio
                </span>
              </button>
            )}
          </div>
        </main>

        {showCalibrationLogs && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
            <div className="bg-brand-dark border border-purple-500/50 rounded-3xl p-6 w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
              <h3 className="text-xl font-black text-purple-400 mb-1 uppercase tracking-wider">Log Calibrazione</h3>
              <p className="text-xs text-white/50 mb-4 leading-relaxed">Copia questi dati per analizzare le firme del tuo movimento. Sono stati registrati {calibrationLogs.length} eventi (inclusi quelli scartati).</p>
              
              <div className="flex-1 min-h-[200px] max-h-[400px] mb-4 relative rounded-xl overflow-hidden border border-white/10 bg-black/50">
                <textarea 
                  readOnly 
                  className="absolute inset-0 w-full h-full p-4 text-[11px] font-mono text-white/80 outline-none bg-transparent resize-none"
                  value={JSON.stringify(calibrationLogs, null, 2)}
                />
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(calibrationLogs, null, 2));
                  }}
                  className="flex-1 bg-white/10 border border-white/20 text-white font-bold py-3 px-4 rounded-xl hover:bg-white/20 transition-colors text-sm"
                >
                  Copia JSON
                </button>
                <button 
                  onClick={cancelWorkout}
                  className="flex-1 bg-purple-500 text-white font-bold py-3 px-4 rounded-xl hover:bg-purple-600 shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-colors text-sm"
                >
                  Fine
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // SCHERMATA DELLA FOTOCAMERA (WORKOUT)
  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-black lg:h-[90vh] lg:mt-8 lg:rounded-3xl border border-white/10 shadow-2xl">
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4 sm:p-6 bg-gradient-to-b from-black/90 to-transparent">
        <div className="flex items-center justify-between">
          <button onClick={cancelWorkout} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <h2 className="text-xl font-bold uppercase tracking-widest text-brand-orange">
            {selectedExercise === 'pullups' ? 'Trazioni'
              : selectedExercise === 'pushups' ? 'Flessioni'
                : 'Squat'}
          </h2>
          <button
            onClick={() => setPaused(!paused)}
            className={`p-2 rounded-full transition-all ${paused ? 'bg-brand-orange text-white scale-110' : 'bg-white/10 text-white hover:bg-white/20'}`}
          >
            {paused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6 fill-current" />}
          </button>
        </div>
        <div className="mt-4 flex justify-center gap-3">
          <button
            type="button"
            onClick={startVideoCounting}
            disabled={!isCameraReady || isLoading || isCountingActive}
            className="rounded-full border border-green-500/40 bg-green-500/20 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-green-100 transition-colors hover:bg-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start temp
          </button>
          <button
            type="button"
            onClick={() => setPaused((current) => !current)}
            disabled={!isCameraReady || isLoading}
            className="rounded-full border border-yellow-500/40 bg-yellow-500/20 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-yellow-100 transition-colors hover:bg-yellow-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {paused ? 'Riprendi temp' : 'Pausa temp'}
          </button>
        </div>
      </div>

      {/* Camera Status */}
      <div className="absolute top-[80px] right-6 z-30 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
        <div className={`w-2 h-2 rounded-full ${isCameraReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-tighter">Cam</span>
      </div>

      {/* Main Viewport */}
      <div ref={containerRef} className="relative flex-1 bg-zinc-900 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute min-w-full min-h-full object-cover scale-x-[-1] transition-opacity ${paused ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}`}
        />
        {isCameraReady && (
          <PoseOverlay
            results={poseResults}
            width={videoSize.width}
            height={videoSize.height}
            exercise={selectedExercise}
          />
        )}

        {/* Hint Overlays */}
        {showHint && isCameraReady && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 bg-black/80 backdrop-blur-xl p-6 rounded-3xl border border-brand-orange/50 text-center max-w-[90%] w-sm shadow-2xl animate-in fade-in duration-300">
            <h3 className="text-xl font-black text-brand-orange mb-2 uppercase tracking-wider">Mettiti in Posizione</h3>
            <p className="text-white/80 text-sm leading-relaxed">
              {selectedExercise === 'pullups' ? 'Inquadra tutto il corpo e la sbarra per le trazioni.'
                : selectedExercise === 'pushups' ? 'Posizionati di profilo. Schiena e gambe devono essere inquadrate.'
                  : 'Posizionati leggermente di lato. Inquadra dalla testa ai piedi.'}
            </p>
          </div>
        )}

        {showVoiceCommandsBanner && (
          <div className="absolute left-1/2 top-28 z-40 w-[92%] max-w-md -translate-x-1/2 rounded-3xl border border-brand-orange/40 bg-black/85 p-4 text-center shadow-2xl backdrop-blur-xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-orange/80">Comandi vocali</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/80 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"><span className="block font-bold text-white">Vai / Go</span><span className="text-white/50">Attiva</span></div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"><span className="block font-bold text-white">Stop / Fermo</span><span className="text-white/50">Pausa</span></div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"><span className="block font-bold text-white">Pausa</span><span className="text-white/50">Ferma</span></div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2"><span className="block font-bold text-white">Riprendi</span><span className="text-white/50">Continua</span></div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/55 backdrop-blur-sm">
            <Loader2 className="w-12 h-12 text-brand-orange animate-spin" />
            <p className="text-white/80 font-medium">Caricamento modelli AI...</p>
          </div>
        )}

        {cameraError && (
          <div className="absolute bottom-32 left-1/2 z-40 w-[90%] max-w-sm -translate-x-1/2 rounded-3xl border border-red-500/40 bg-black/80 p-4 text-center text-sm text-red-100 shadow-2xl">
            {cameraError}
          </div>
        )}

        {poseError && (
          <div className="absolute bottom-14 left-1/2 z-40 w-[90%] max-w-sm -translate-x-1/2 rounded-3xl border border-yellow-500/40 bg-black/80 p-4 text-center text-sm text-yellow-100 shadow-2xl">
            {poseError}
          </div>
        )}

        {/* Debug Info Overlay */}
        <div className="absolute top-24 left-6 z-20 flex flex-col gap-3">
          <div className="bg-black/60 backdrop-blur-md p-3 rounded-xl border border-white/10">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Dati AI</p>
            <div className="flex flex-col">
              <span className="text-xs text-white font-mono">Angolo: <span className="text-brand-orange font-bold">{Math.round(debugData.angle)}°</span></span>
              <span className="text-xs text-white font-mono">Stato: <span className="text-brand-lightOrange font-bold">{debugData.stage || 'N/A'}</span></span>
              <span className="text-xs text-white font-mono">Sessione: <span className={`${videoStatusLabel === 'Attivo' ? 'text-green-400' : 'text-yellow-300'} font-bold`}>{videoStatusLabel}</span></span>
            </div>
          </div>

          {debugData.error && (
            <div className="bg-red-500/20 backdrop-blur-md p-2 rounded-xl border border-red-500/30 flex items-center gap-2 animate-pulse">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-[10px] font-bold text-red-500 uppercase">Posizione Errata</span>
            </div>
          )}

          {debugData.warning && (
            <div className="bg-yellow-500/20 backdrop-blur-md p-2 rounded-xl border border-yellow-500/30 flex items-center gap-2 animate-bounce">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-[10px] font-bold text-yellow-500 uppercase">{debugData.warning}</span>
            </div>
          )}

          {debugData.okMsg && !debugData.warning && (
            <div className="bg-green-500/20 backdrop-blur-md p-2 rounded-xl border border-green-500/30 flex items-center gap-2 animate-pulse shadow-[0_0_15px_rgba(34,197,94,0.3)]">
              <Target className="w-4 h-4 text-green-500" />
              <span className="text-[10px] font-bold text-green-500 uppercase">{debugData.okMsg}</span>
            </div>
          )}
        </div>

        {paused && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <h3 className="text-3xl font-black text-white mt-4 uppercase tracking-tighter">In Pausa</h3>
          </div>
        )}
      </div>

      {/* Stats Overlay Bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-6 bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="bg-black/60 backdrop-blur-md rounded-full px-12 py-6 border-2 border-brand-orange mx-auto max-w-xs shadow-[0_0_20px_rgba(196,90,0,0.4)] flex flex-col items-center justify-center">
          <p className="text-7xl font-black text-white">{count}</p>
          {repTarget !== null ? (
            <>
              <p className="text-brand-orange font-bold tracking-[0.2em] uppercase mt-1 text-sm">
                / {repTarget} rip.
              </p>
              <div className="w-full mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-orange transition-all duration-300"
                  style={{ width: `${Math.min(100, (count / repTarget) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-brand-orange font-bold tracking-[0.2em] uppercase mt-1 text-sm">Ripetizioni</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepCounterPage;
