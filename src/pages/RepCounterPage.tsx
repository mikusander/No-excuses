import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, Play, Target, Repeat, Video, Smartphone, Timer, Square, Flag } from 'lucide-react';
import { usePoseLandmarker } from '../hooks/usePoseLandmarker';

import { useAccelerometerRepCounter, triggerStartHaptic } from '../hooks/useAccelerometerRepCounter';
import { ExerciseTracker } from '../logic/exerciseTracker';
import { speak, speakNumber } from '../utils/voice';
import { playGoalReachedSound } from '../utils/audio';
import type { ExerciseType } from '../types';
import PoseOverlay from '../components/PoseOverlay';

type CountingMode = 'video' | 'accelerometer';

const POSE_LANDMARK_NAMES = [
  'nose',
  'left_eye_inner',
  'left_eye',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye',
  'right_eye_outer',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
] as const;

const POSE_LANDMARK_GROUPS = [
  'head',
  'head',
  'head',
  'head',
  'head',
  'head',
  'head',
  'head',
  'head',
  'head',
  'head',
  'left_arm',
  'right_arm',
  'left_arm',
  'right_arm',
  'left_arm',
  'right_arm',
  'left_arm',
  'right_arm',
  'left_arm',
  'right_arm',
  'left_arm',
  'right_arm',
  'torso',
  'torso',
  'left_leg',
  'right_leg',
  'left_leg',
  'right_leg',
  'left_leg',
  'right_leg',
  'left_leg',
  'right_leg',
] as const;

const POSE_LANDMARK_EXPORT_INDICES = Array.from({ length: 22 }, (_, index) => index + 11);

const csvEscape = (value: unknown) => {
  const text = String(value ?? '');
  if (/[,"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const csvNumber = (value: number | undefined | null, digits = 6) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  return value.toFixed(digits);
};

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const RepCounterPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [countingMode, setCountingMode] = useState<CountingMode>((location.state?.mode as CountingMode) || 'video');
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
  const [autoStarted, setAutoStarted] = useState(false);

  // Tracking states
  const [count, setCount] = useState(0);

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [isCountingActive, setIsCountingActive] = useState(false);

  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [poseResults, setPoseResults] = useState<any>(null);
  const [isPoseDebuggerEnabled] = useState(false);
  const isPoseDebuggerEnabledRef = useRef(isPoseDebuggerEnabled);

  const trackerRef = useRef<ExerciseTracker | null>(null);
  const selectedExerciseRef = useRef(selectedExercise);
  const countRef = useRef(count);
  // Refs to avoid stale closures in the rAF loop (Bug #1 & #4)
  const isCountingActiveRef = useRef(isCountingActive);
  const wasCountingActiveRef = useRef(false);
  const pausedRef = useRef(paused);
  const poseCsvSessionActiveRef = useRef(false);
  const poseCsvSessionStartPerfRef = useRef<number | null>(null);
  const poseCsvFrameIndexRef = useRef(0);
  const poseCsvRowsRef = useRef<string[]>([]);
  const poseCsvFilenameRef = useRef<string | null>(null);

  const {
    phase: accelerometerPhase,
    prepRemaining,
    isDeviceStill,
    error: accelerometerError,
    startSession: startAccelerometerSession,
    resetSession: resetAccelerometerSession,
    stopSession: stopAccelerometerSession,
  } = useAccelerometerRepCounter({
    prepDurationSeconds: countingMode === 'video' ? 3 : 10,
    waitForStillness: countingMode === 'video',
    fallbackToTimer: countingMode === 'video',
    exerciseType: selectedExercise ?? undefined,
    onCountChange: (newCount) => {
      if (countingMode === 'video') return;
      setCount(newCount);
      // Ferma la sessione al raggiungimento del target
      if (repTarget !== null && newCount >= repTarget) {
        triggerStartHaptic(); // stesso AudioContext già sbloccato dall'avvio sessione
        speak('finish exercise');
        stopAccelerometerSession();
      } else if (newCount > 0) {
        speakNumber(newCount);
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
  useEffect(() => { countRef.current = count; }, [count]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { isPoseDebuggerEnabledRef.current = isPoseDebuggerEnabled; }, [isPoseDebuggerEnabled]);

  const startPoseCsvSession = () => {
    if (!isPoseDebuggerEnabled || !selectedExerciseRef.current) return;

    poseCsvSessionActiveRef.current = true;
    poseCsvSessionStartPerfRef.current = performance.now();
    poseCsvFrameIndexRef.current = 0;
    poseCsvRowsRef.current = [
      [
        'session_id',
        'exercise',
        'frame_index',
        'frame_time_ms',
        'elapsed_ms',
        'count',
        'paused',
        'landmark_index',
        'landmark_name',
        'landmark_group',
        'x',
        'y',
        'z',
        'visibility',
      ].join(','),
    ];
    poseCsvFilenameRef.current = `mediapipe-debug-${selectedExerciseRef.current}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  };

  const finishPoseCsvSession = (download = true) => {
    if (!poseCsvSessionActiveRef.current) return;

    poseCsvSessionActiveRef.current = false;
    const rows = poseCsvRowsRef.current;
    const filename = poseCsvFilenameRef.current;
    poseCsvFilenameRef.current = null;
    poseCsvSessionStartPerfRef.current = null;

    if (!download || !rows || rows.length <= 1 || !filename) {
      poseCsvRowsRef.current = [];
      poseCsvFrameIndexRef.current = 0;
      return;
    }

    downloadTextFile(filename, rows.join('\n'));
    poseCsvRowsRef.current = [];
    poseCsvFrameIndexRef.current = 0;
  };

  const recordPoseCsvFrame = (timestamp: number, landmarks: any[]) => {
    if (!isPoseDebuggerEnabledRef.current || !poseCsvSessionActiveRef.current || !selectedExerciseRef.current || poseCsvSessionStartPerfRef.current == null) return;
    if (!Array.isArray(landmarks) || landmarks.length === 0) return;

    const sessionId = poseCsvFilenameRef.current || 'pose-session';
    const elapsedMs = Math.max(0, Math.round(timestamp - poseCsvSessionStartPerfRef.current));
    const frameIndex = poseCsvFrameIndexRef.current++;
    const exerciseLabel = selectedExerciseRef.current;
    const countSnapshot = countRef.current;
    const pausedSnapshot = pausedRef.current;

    const exportIndices = selectedExerciseRef.current === 'pushups'
      ? [11, 12, 13, 14, 15, 16]
      : POSE_LANDMARK_EXPORT_INDICES;

    exportIndices.forEach((landmarkIndex) => {
      const landmark = landmarks[landmarkIndex];
      if (!landmark) return;

      const landmarkName = POSE_LANDMARK_NAMES[landmarkIndex] ?? `landmark_${landmarkIndex}`;
      const landmarkGroup = POSE_LANDMARK_GROUPS[landmarkIndex] ?? 'other';
      poseCsvRowsRef.current.push([
        csvEscape(sessionId),
        csvEscape(exerciseLabel),
        String(frameIndex),
        csvNumber(timestamp),
        String(elapsedMs),
        String(countSnapshot),
        String(pausedSnapshot),
        String(landmarkIndex),
        csvEscape(landmarkName),
        csvEscape(landmarkGroup),
        csvNumber(landmark.x),
        csvNumber(landmark.y),
        csvNumber(landmark.z),
        csvNumber(landmark.visibility, 4),
      ].join(','));
    });
  };



  const initTracker = (overrideTarget?: number | null) => {
    const target = overrideTarget ?? repTarget;
    trackerRef.current = new ExerciseTracker(
      (newCount) => {
        setCount(newCount);
        // Verifica obiettivo per la modalità video
        if (target !== null && newCount >= target) {
          playGoalReachedSound();
          speak('finish exercise');
          // Stop automatico al raggiungimento del target
          setIsCountingActive(false);
        } else if (newCount > 0) {
          speakNumber(newCount);
        }
      }
    );
  };

  useEffect(() => {
    return () => {
      finishPoseCsvSession();
    };
  }, []);

  useEffect(() => {
    if (!isPoseDebuggerEnabled) {
      finishPoseCsvSession(false);
      return;
    }

    if (selectedExerciseRef.current && !poseCsvSessionActiveRef.current) {
      startPoseCsvSession();
    }
  }, [isPoseDebuggerEnabled]);

  useEffect(() => {
    wasCountingActiveRef.current = isCountingActive;
    isCountingActiveRef.current = isCountingActive;
  }, [isCountingActive]);

  const startVideoCounting = () => {
    if (isCountingActive || !trackerRef.current || !selectedExerciseRef.current || !isCameraReady || isLoading) return;
    trackerRef.current.resetTrackingState();
    if (!poseCsvSessionActiveRef.current) {
      startPoseCsvSession();
    }
    setPaused(false);
    setIsCountingActive(true);
  };



  // Auto-start camera when ready, using device stillness
  useEffect(() => {
    if (countingMode === 'video' && isCameraReady && !isLoading) {
      if (accelerometerPhase === 'idle' || accelerometerPhase === 'paused') {
        if (!isCountingActive) startAccelerometerSession();
      } else if (accelerometerPhase === 'preparing') {
        if (isCountingActive) setIsCountingActive(false);
      } else if (accelerometerPhase === 'active') {
        if (!isCountingActive) startVideoCounting();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countingMode, isCameraReady, isLoading, isCountingActive, accelerometerPhase, startAccelerometerSession]);

  // Start Camera when exercise is selected
  useEffect(() => {
    if (!selectedExercise || countingMode !== 'video') return;

    let isCancelled = false;

    const startCamera = async () => {
      try {
        if (!window.isSecureContext) {
          setCameraError('Phone camera requires a secure connection (HTTPS or localhost).');
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
        setCameraError('Cannot access camera. Check browser permissions and use HTTPS on your phone.');
      }
    };

    startCamera();

    return () => {
      isCancelled = true;
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
      setCameraError('Camera disconnected. Reopen the exercise to try again.');
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

          recordPoseCsvFrame(timestamp, landmarks);

          // Read isCountingActive from ref, not stale closure (Bug #1 fix)
          if (isCountingActiveRef.current) {
            if (currentEx === 'pullups') trackerRef.current?.updatePullup(landmarks);
            else if (currentEx === 'pushups') trackerRef.current?.updatePushup(landmarks);
          }
        }
      }
      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExercise, countingMode, isCameraReady, detectPose]);


  const handleSelectExercise = async (type: ExerciseType, overrideTarget?: number | null) => {
    if (typeof window !== 'undefined' && typeof (window as any).DeviceMotionEvent?.requestPermission === 'function') {
      try {
        await (window as any).DeviceMotionEvent.requestPermission();
      } catch (e) {
        console.warn('DeviceMotionEvent permission request failed', e);
      }
    }
    setCount(0);
    setPoseResults(null);
    setIsCameraReady(false);
    setCameraError(null);
    setPaused(false);
    setIsCountingActive(false);
    resetAccelerometerSession();
    initTracker(overrideTarget);
    setSelectedExercise(type);

    if (countingMode === 'accelerometer') {
      await startAccelerometerSession();
    }
  };

  const cancelWorkout = () => {
    if (location.state?.returnUrl) {
      finishPoseCsvSession();
      trackerRef.current?.reset();
      resetAccelerometerSession();
      navigate(location.state.returnUrl);
      return;
    }
    setSelectedExercise(null);
    setIsCameraReady(false);
    setCameraError(null);
    setPaused(false);
    setIsCountingActive(false);

    setCount(0);
    setIsCalibrationMode(false);
    setShowCalibrationLogs(false);
    setCalibrationLogs([]);
    resetAccelerometerSession();
    trackerRef.current?.reset();
    finishPoseCsvSession();
  };

  const isAccelerometerMode = countingMode === 'accelerometer';
  const isAccelerometerPaused = accelerometerPhase === 'paused';
  const isAccelerometerPreparing = accelerometerPhase === 'preparing';
  const isAccelerometerActive = accelerometerPhase === 'active';
  const accelerometerStatusLabel = accelerometerError
    ? 'Accelerometer not available'
    : isAccelerometerPreparing
      ? 'Get ready for the exercise'
      : isAccelerometerActive
        ? 'Repetition count in progress'
        : isAccelerometerPaused
          ? (prepRemaining > 0 ? 'Preparation paused' : 'Counting paused')
          : 'Starting accelerometer';


  useEffect(() => {
    if (location.state?.autoCountExercise && location.state?.targetReps !== undefined && !autoStarted) {
      setAutoStarted(true);
      setRepTarget(location.state.targetReps);
      setRepTargetInput(String(location.state.targetReps));
      handleSelectExercise(location.state.autoCountExercise, location.state.targetReps);
    }
  }, [location.state, autoStarted, handleSelectExercise]);

  // --- RENDERING ---

  // SCHERMATA DI SELEZIONE ESERCIZIO
  if (!selectedExercise) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col">
        <header className="p-4 flex items-center bg-black/50">
          <button onClick={() => location.state?.returnUrl ? navigate(location.state.returnUrl) : navigate('/')} className="p-2 text-white hover:text-brand-orange transition-colors">
            <ArrowLeft size={28} />
          </button>
          <h1 className="text-xl font-bold ml-4 text-white">New Workout</h1>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6 w-full max-w-md mx-auto">
          <h2 className="text-2xl font-black text-white text-center mb-4 uppercase tracking-widest">
            Choose Your Exercise
          </h2>

          {/* Modalità conteggio */}
          <div className="w-full rounded-3xl border border-white/10 bg-brand-darkGrey/40 p-2 shadow-lg">
            <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Counting Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCountingMode('video')}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-all ${countingMode === 'video' ? 'bg-brand-orange text-black shadow-lg' : 'bg-black/30 text-white/70 hover:bg-black/50'}`}
              >
                <Video className="h-4 w-4" />
                Camera
              </button>
              <button
                type="button"
                onClick={() => setCountingMode('accelerometer')}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-all ${countingMode === 'accelerometer' ? 'bg-brand-orange text-black shadow-lg' : 'bg-black/30 text-white/70 hover:bg-black/50'}`}
              >
                <Smartphone className="h-4 w-4" />
                Accelerometer
              </button>
            </div>
            <p className="px-2 pt-3 text-xs leading-relaxed text-white/50">
              {countingMode === 'video'
                ? 'Use camera and MediaPipe pose detection.'
                : 'Use phone motion sensor. Put the phone in your pocket during the 10-second countdown.'}
            </p>
          </div>

          {/* Obiettivo ripetizioni */}
          <div className="w-full rounded-3xl border border-white/10 bg-brand-darkGrey/40 p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-1">
              <Flag className="h-4 w-4 text-brand-orange" />
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Repetitions Target</p>
            </div>
            <p className="text-xs text-white/40 mb-3 leading-relaxed">
              Enter a number to stop counting automatically when reached — the phone will ring. Leave empty to count infinitely.
            </p>
            <div className="flex items-center gap-3">
              <input
                id="rep-target-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                placeholder="∞  no limit"
                value={repTargetInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, '');
                  setRepTargetInput(raw);
                  const parsed = parseInt(raw, 10);
                  setRepTarget(!raw || isNaN(parsed) || parsed < 1 ? null : parsed);
                }}
                className="flex-1 rounded-2xl bg-black/40 border border-white/10 text-white placeholder:text-white/25 px-4 py-3 text-sm font-bold outline-none focus:border-brand-orange/60 focus:ring-1 focus:ring-brand-orange/30 transition-all"
              />
            </div>
          </div>

          {/* Calibrazione Sperimentale */}
          <div className="w-full rounded-3xl border border-purple-500/20 bg-purple-500/5 p-4 shadow-lg flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-purple-400">Calibration Mode</span>
              <span className="text-xs text-white/50 mt-1">Record 10 reps to analyze data</span>
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
                <h3 className="text-xl font-bold uppercase tracking-wider">Pullups</h3>
                <p className="text-brand-grey text-sm">Back and Biceps</p>
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
                <h3 className="text-xl font-bold uppercase tracking-wider">Pushups</h3>
                <p className="text-brand-grey text-sm">Chest and Triceps</p>
              </div>
            </div>
            <Play className="w-6 h-6 text-brand-grey group-hover:text-brand-lightOrange transition-colors" />
          </button>
        </main>
      </div>
    );
  }

  if (isAccelerometerMode) {
    const currentExerciseLabel = selectedExercise === 'pullups' ? 'Pullups' : selectedExercise === 'pushups' ? 'Pushups' : '';

    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-brand-dark">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(196,90,0,0.18),transparent_55%)]" />
        <div className="relative z-10 flex items-center justify-between p-4 sm:p-6 bg-black/30 backdrop-blur-md border-b border-white/10">
          <button onClick={cancelWorkout} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Accelerometer Mode</p>
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
                  Put the phone in your pocket and get ready
                </div>
              </>
            ) : (
              <>
                <div className="text-7xl font-black text-white">{count}</div>
                <p className="text-sm uppercase tracking-[0.35em] text-brand-orange">Repetitions</p>
                {repTarget !== null && (
                  <div className="w-full max-w-[220px] mt-2">
                    <div className="flex justify-between text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">
                      <span>Progress</span>
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
              ? 'Return to exercise selection and try again after enabling motion access.'
              : isAccelerometerPreparing
                ? 'The countdown gives you time to prepare. Counting starts automatically at zero.'
                : isAccelerometerPaused
                  ? 'Press resume to continue preparation or exercise.'
                  : 'Reps increase when the phone detects a full down-up cycle from your pocket.'}
          </div>

          <div className="flex w-full max-w-sm gap-3">
            <button
              type="button"
              onClick={cancelWorkout}
              className="flex-1 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm font-bold text-red-100 transition-colors hover:bg-red-500/20"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Square className="h-4 w-4" />
                End exercise
              </span>
            </button>
          </div>
        </main>

        {showCalibrationLogs && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
            <div className="bg-brand-dark border border-purple-500/50 rounded-3xl p-6 w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">
              <h3 className="text-xl font-black text-purple-400 mb-1 uppercase tracking-wider">Calibration Log</h3>
              <p className="text-xs text-white/50 mb-4 leading-relaxed">Copy this data to analyze your motion signatures. {calibrationLogs.length} events have been recorded (including rejected ones).</p>

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
                  Copy JSON
                </button>
                <button
                  onClick={cancelWorkout}
                  className="flex-1 bg-purple-500 text-white font-bold py-3 px-4 rounded-xl hover:bg-purple-600 shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-colors text-sm"
                >
                  Done
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
            {selectedExercise === 'pullups' ? 'Pullups'
              : selectedExercise === 'pushups' ? 'Pushups'
                : ''}
          </h2>
          <div className="w-10"></div>
        </div>
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

        {/* Device Stillness Countdown Overlay */}
        {accelerometerPhase === 'preparing' && isCameraReady && !isCountingActive && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 bg-black/80 backdrop-blur-xl p-8 rounded-3xl border border-brand-orange/50 text-center max-w-[90%] w-sm shadow-[0_0_40px_rgba(196,90,0,0.3)] animate-in fade-in zoom-in duration-300">
            <h3 className="text-xl font-black text-brand-orange mb-2 uppercase tracking-wider">Device Stillness</h3>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              Place your device down and get in position. The tracking will start automatically when the phone is still.
            </p>
            <div className={`text-sm font-bold uppercase tracking-widest mb-6 ${accelerometerError ? 'text-yellow-400' : isDeviceStill ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>
              {accelerometerError ? 'Timer Fallback' : isDeviceStill ? 'Device is stable' : 'Device is moving...'}
            </div>
            <div className={`text-8xl font-black drop-shadow-[0_0_15px_rgba(255,255,255,0.5)] transition-colors ${isDeviceStill ? 'text-white' : 'text-red-500/50'}`}>
              {prepRemaining}
            </div>
          </div>
        )}



        {isLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/55 backdrop-blur-sm">
            <Loader2 className="w-12 h-12 text-brand-orange animate-spin" />
            <p className="text-white/80 font-medium">Loading AI models...</p>
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



        {paused && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <h3 className="text-3xl font-black text-white mt-4 uppercase tracking-tighter">Paused</h3>
          </div>
        )}

        {repTarget !== null && count >= repTarget && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md p-6">
            <h3 className="text-4xl font-black text-brand-orange mb-6 uppercase tracking-widest text-center shadow-black drop-shadow-xl">Goal Reached!</h3>
            {location.state?.returnUrl ? (
              <button
                onClick={() => {
                  finishPoseCsvSession();
                  trackerRef.current?.reset();
                  resetAccelerometerSession();
                  navigate(location.state.returnUrl, { state: { autoCompleteAction: true } });
                }}
                className="bg-brand-orange text-black font-black uppercase tracking-widest py-4 px-10 rounded-full text-xl hover:scale-105 transition-transform shadow-[0_0_30px_rgba(255,102,0,0.6)]"
              >
                Continue Workout
              </button>
            ) : (
              <button
                onClick={() => {
                  finishPoseCsvSession();
                  trackerRef.current?.reset();
                  resetAccelerometerSession();
                  navigate('/');
                }}
                className="bg-brand-orange text-black font-black uppercase tracking-widest py-4 px-10 rounded-full text-xl hover:scale-105 transition-transform shadow-[0_0_30px_rgba(255,102,0,0.6)]"
              >
                Go to Home Page
              </button>
            )}
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
                / {repTarget} reps.
              </p>
              <div className="w-full mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-orange transition-all duration-300"
                  style={{ width: `${Math.min(100, (count / repTarget) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-brand-orange font-bold tracking-[0.2em] uppercase mt-1 text-sm">Repetitions</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepCounterPage;
