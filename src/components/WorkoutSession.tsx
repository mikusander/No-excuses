import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, ArrowLeft, Loader2, Target, Repeat, Activity, Pause, Play, AlertCircle, AlertTriangle } from 'lucide-react';
import { usePoseLandmarker } from '../hooks/usePoseLandmarker';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { ExerciseTracker } from '../logic/exerciseTracker';
import { speak, speakNumber } from '../utils/voice';
import { playErrorSound } from '../utils/audio';
import type { WorkoutConfig, ExerciseType } from '../types';
import PoseOverlay from './PoseOverlay';

interface Props {
  config: WorkoutConfig;
  onFinish: () => void;
  onBack: () => void;
}

const WorkoutSession: React.FC<Props> = ({ config, onFinish, onBack }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { detectPose, isLoading } = usePoseLandmarker();
  
  const [currentExercise, setCurrentExercise] = useState<ExerciseType>('pullups');
  const [counts, setCounts] = useState({ pullups: 0, pushups: 0, squats: 0 });
  const [debugData, setDebugData] = useState<{ angle: number; stage: string | null; error?: boolean; warning?: string }>({ angle: 0, stage: null });
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [poseResults, setPoseResults] = useState<any>(null);

  // Voice commands integration
  useVoiceCommands({
    onPause: () => setPaused(true),
    onResume: () => setPaused(false),
    enabled: isCameraReady && !isLoading
  });

  const trackerRef = useRef<ExerciseTracker | null>(null);
  const lastStateUpdateTime = useRef(0);

  const currentTarget = currentExercise === 'pullups' ? config.pullupsCount 
                      : currentExercise === 'pushups' ? config.pushupsCount 
                      : config.squatsCount;
  const currentCount = currentExercise === 'pullups' ? counts.pullups 
                     : currentExercise === 'pushups' ? counts.pushups 
                     : counts.squats;

  const initTracker = (type: ExerciseType, target: number) => {
    trackerRef.current = new ExerciseTracker(
      target,
      (count) => {
        setCounts(prev => ({ ...prev, [type]: count }));
        speakNumber(count);
      },
      (msg) => speak(msg),
      (data) => {
        // Throttle UI update to ~15fps
        if (performance.now() - lastStateUpdateTime.current > 66) {
           setDebugData(data);
           lastStateUpdateTime.current = performance.now();
        }
      },
      () => playErrorSound()
    );
  };

  useEffect(() => {
    initTracker('pullups', config.pullupsCount);

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user', width: 640, height: 480 } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              setVideoSize({ 
                width: videoRef.current.videoWidth, 
                height: videoRef.current.videoHeight 
              });
              setIsCameraReady(true);
            }
          };
        }
      } catch (err) {
        console.error("Camera access error:", err);
      }
    };

    startCamera();

    return () => {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const currentExerciseRef = useRef(currentExercise);
  useEffect(() => { currentExerciseRef.current = currentExercise; }, [currentExercise]);

  // Handle Hint timer
  useEffect(() => {
    setShowHint(true);
    const timer = setTimeout(() => {
      setShowHint(false);
    }, 8000); // Hide hint after 8 seconds
    return () => clearTimeout(timer);
  }, [currentExercise]);

  // Frame processing loop
  useEffect(() => {
    if (paused || !isCameraReady) return;

    let animationId: number;
    let lastRenderTime = 0;
    
    const processFrame = (time: number) => {
      if (videoRef.current) {
        const results = detectPose(videoRef.current, time);
        
        if (results && results.landmarks && results.landmarks.length > 0) {
          // Update visualization at ~30fps
          if (time - lastRenderTime > 33) {
            setPoseResults(results);
            lastRenderTime = time;
          }

          const landmarks = results.landmarks[0];
          if (currentExerciseRef.current === 'pullups') {
            trackerRef.current?.updatePullup(landmarks);
          } else if (currentExerciseRef.current === 'pushups') {
            trackerRef.current?.updatePushup(landmarks);
          } else if (currentExerciseRef.current === 'squats') {
            trackerRef.current?.updateSquat(landmarks);
          }
        }
      }
      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
  }, [isCameraReady, paused]);

  const handleNextExercise = () => {
    if (currentExercise === 'pullups') {
      setCurrentExercise('pushups');
      initTracker('pushups', config.pushupsCount);
    } else if (currentExercise === 'pushups') {
      setCurrentExercise('squats');
      initTracker('squats', config.squatsCount);
    } else {
      onFinish();
    }
  };

  const progress = currentTarget === Infinity ? 0 : (currentCount / currentTarget) * 100;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] gap-4">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
        <p className="text-white/70 font-medium">Caricamento modelli AI...</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-black lg:h-[90vh] lg:mt-8 lg:rounded-3xl border border-white/10 shadow-2xl">
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 p-6 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors mr-3">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <div className="flex-1 flex flex-col items-center">
            <h2 className="text-xl font-bold uppercase tracking-widest text-white">
              {currentExercise === 'pullups' ? 'Trazioni' 
               : currentExercise === 'pushups' ? 'Flessioni' 
               : 'Squat'}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1.5 w-16 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[10px] font-bold text-white/50 uppercase">Progresso</span>
            </div>
          </div>
          <button 
            onClick={() => setPaused(!paused)} 
            className={`p-2 rounded-full transition-all ${paused ? 'bg-primary text-white scale-110' : 'bg-white/10 text-white hover:bg-white/20'}`}
          >
            {paused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6 fill-current" />}
          </button>
        </div>
      </div>

      {/* Camera Status Indicator */}
      <div className="absolute top-20 right-6 z-30 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
          <div className={`w-2 h-2 rounded-full ${isCameraReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} title="Camera" />
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-tighter">Camera Attiva</span>
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
          />
        )}
        
        {/* Positional Hint Overlay */}
        {showHint && isCameraReady && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 bg-black/80 backdrop-blur-xl p-8 rounded-3xl border border-white/20 text-center max-w-sm shadow-2xl animate-in fade-in zoom-in duration-300">
            <h3 className="text-xl font-black text-white mb-3 uppercase tracking-wider">Mettiti in Posizione</h3>
            <p className="text-white/80 text-sm leading-relaxed">
              {currentExercise === 'pullups' ? 'Posiziona il telefono frontalmente o leggermente di lato. Assicurati che corpo, braccia e sbarra siano visibili nella ripresa.'
               : currentExercise === 'pushups' ? 'Posiziona il telefono di lato (profilo) a terra. È indispensabile che la schiena e le gambe siano visibili per il controllo posturale.'
               : 'Posiziona il telefono di lato o a 45 gradi. Assicurati che tutto il corpo sia inquadrato dalla testa ai piedi.'}
            </p>
          </div>
        )}

        {/* Debug Info Overlay */}
        <div className="absolute top-24 left-6 z-20 flex flex-col gap-3">
          <div className="bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/10">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Dati AI (Bilateral)</p>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-white font-mono">Angolo Medio: <span className="text-primary font-bold">{Math.round(debugData.angle)}°</span></span>
              <span className="text-sm text-white font-mono">Stato: <span className="text-secondary font-bold">{debugData.stage || 'N/A'}</span></span>
            </div>
          </div>

          {debugData.error && (
            <div className="bg-red-500/20 backdrop-blur-md p-3 rounded-2xl border border-red-500/30 flex items-center gap-2 animate-pulse">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-[10px] font-bold text-red-500 uppercase">Posizione Asimmetrica</span>
            </div>
          )}
          
          {debugData.warning && (
            <div className="bg-yellow-500/20 backdrop-blur-md p-3 rounded-2xl border border-yellow-500/30 flex items-center gap-2 animate-bounce">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <span className="text-[10px] font-bold text-yellow-500 uppercase">{debugData.warning}</span>
            </div>
          )}
        </div>

        {paused && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="bg-primary/20 p-6 rounded-full animate-bounce">
              <Pause className="w-12 h-12 text-primary fill-current" />
            </div>
            <h3 className="text-3xl font-black text-white mt-4 uppercase tracking-tighter">In Pausa</h3>
            <p className="text-white/50 text-sm mt-2">Dì "Riprendi" o premi il bottone</p>
          </div>
        )}

        {!isCameraReady && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-white/50 text-sm">Accesso alla fotocamera...</p>
          </div>
        )}
      </div>

      {/* Stats Overlay Bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-8 bg-gradient-to-t from-black/90 to-transparent">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 flex flex-col items-center justify-center border border-white/5">
            <span className="text-white/40 text-xs uppercase font-bold tracking-wider mb-2">Reps Eseguite</span>
            <div className="text-6xl font-black text-white">{currentCount}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 flex flex-col items-center justify-center border border-white/5">
            <span className="text-white/40 text-xs uppercase font-bold tracking-wider mb-2">Obiettivo</span>
            <div className="text-6xl font-black text-primary">
              {currentTarget === Infinity ? '∞' : currentTarget}
            </div>
          </div>
        </div>

        {(currentCount >= currentTarget || currentTarget === Infinity) && (
          <div className="mt-6 flex flex-col gap-3">
               <button
              onClick={handleNextExercise}
              className={`w-full ${currentCount >= currentTarget && currentTarget !== Infinity ? 'bg-primary' : 'bg-white/10'} text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] text-lg`}
            >
              {currentExercise === 'pullups' ? 'Prossimo: Flessioni' 
               : currentExercise === 'pushups' ? 'Prossimo: Squat' 
               : 'Concludi Workout'}
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        )}
      </div>

      {/* Mini Stats side indicators */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2 space-y-4 z-20">
         <div className="flex flex-col items-center gap-1 group">
            <div className={`p-3 rounded-xl transition-all ${currentExercise === 'pullups' ? 'bg-primary shadow-lg shadow-primary/30' : 'bg-white/5'}`}>
              <Target className={`w-6 h-6 ${currentExercise === 'pullups' ? 'text-white' : 'text-white/20'}`} />
            </div>
         </div>
         <div className="flex flex-col items-center gap-1 group">
            <div className={`p-3 rounded-xl transition-all ${currentExercise === 'pushups' ? 'bg-primary shadow-lg shadow-primary/30' : 'bg-white/5'}`}>
              <Repeat className={`w-6 h-6 ${currentExercise === 'pushups' ? 'text-white' : 'text-white/20'}`} />
            </div>
         </div>
         <div className="flex flex-col items-center gap-1 group">
            <div className={`p-3 rounded-xl transition-all ${currentExercise === 'squats' ? 'bg-primary shadow-lg shadow-primary/30' : 'bg-white/5'}`}>
              <Activity className={`w-6 h-6 ${currentExercise === 'squats' ? 'text-white' : 'text-white/20'}`} />
            </div>
         </div>
      </div>
    </div>
  );
};

export default WorkoutSession;
