import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Play, Pause, AlertCircle, AlertTriangle, Target, Activity, Repeat } from 'lucide-react';
import { usePoseLandmarker } from '../hooks/usePoseLandmarker';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { ExerciseTracker } from '../logic/exerciseTracker';
import { speak, speakNumber } from '../utils/voice';
import { playErrorSound } from '../utils/audio';
import type { ExerciseType } from '../types';
import PoseOverlay from '../components/PoseOverlay';

const RepCounterPage: React.FC = () => {
  const navigate = useNavigate();
  
  // Setup logic states
  const [selectedExercise, setSelectedExercise] = useState<ExerciseType | null>(null);
  const { detectPose, isLoading } = usePoseLandmarker();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Tracking states
  const [count, setCount] = useState(0);
  const [debugData, setDebugData] = useState<{ angle: number; stage: string | null; error?: boolean; warning?: string }>({ angle: 0, stage: null });
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [poseResults, setPoseResults] = useState<any>(null);
  
  const trackerRef = useRef<ExerciseTracker | null>(null);
  const lastStateUpdateTime = useRef(0);
  const selectedExerciseRef = useRef(selectedExercise);

  // Sync ref for the animation frame
  useEffect(() => { selectedExerciseRef.current = selectedExercise; }, [selectedExercise]);

  const initTracker = () => {
    // In un contesto reale potresti voler limitare il target (es. 10), ma qui facciamo infinito (Infinity)
    // Finché l'utente non decide di terminare
    trackerRef.current = new ExerciseTracker(
      Infinity,
      (newCount) => {
        setCount(newCount);
        speakNumber(newCount);
      },
      (msg) => speak(msg),
      (data) => {
        if (performance.now() - lastStateUpdateTime.current > 66) {
           setDebugData(data);
           lastStateUpdateTime.current = performance.now();
        }
      },
      () => playErrorSound()
    );
  };

  useVoiceCommands({
    onPause: () => setPaused(true),
    onResume: () => setPaused(false),
    enabled: selectedExercise !== null && isCameraReady && !isLoading
  });

  // Start Camera when exercise is selected
  useEffect(() => {
    if (!selectedExercise) return;

    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
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
    setShowHint(true);
    const hintTimer = setTimeout(() => setShowHint(false), 8000);

    return () => {
      clearTimeout(hintTimer);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [selectedExercise]);

  // Frame processing loop
  useEffect(() => {
    if (!selectedExercise || paused || !isCameraReady) return;

    let animationId: number;
    let lastRenderTime = 0;
    
    const processFrame = (time: number) => {
      if (videoRef.current) {
        const results = detectPose(videoRef.current, time);
        
        if (results && results.landmarks && results.landmarks.length > 0) {
          if (time - lastRenderTime > 33) {
            setPoseResults(results);
            lastRenderTime = time;
          }

          const landmarks = results.landmarks[0];
          const currentEx = selectedExerciseRef.current;
          
          if (currentEx === 'pullups') trackerRef.current?.updatePullup(landmarks);
          else if (currentEx === 'pushups') trackerRef.current?.updatePushup(landmarks);
          else if (currentEx === 'squats') trackerRef.current?.updateSquat(landmarks);
        }
      }
      animationId = requestAnimationFrame(processFrame);
    };

    animationId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animationId);
  }, [selectedExercise, isCameraReady, paused, detectPose]);


  const handleSelectExercise = (type: ExerciseType) => {
    setCount(0);
    setPoseResults(null);
    initTracker();
    setSelectedExercise(type);
  };

  const cancelWorkout = () => {
    setSelectedExercise(null);
    setCount(0);
    trackerRef.current?.reset();
  };

  // --- RENDERING ---

  if (isLoading && selectedExercise) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-brand-dark gap-4">
        <Loader2 className="w-12 h-12 text-brand-orange animate-spin" />
        <p className="text-white/70 font-medium">Caricamento modelli AI...</p>
      </div>
    );
  }

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
      </div>

      {/* Camera Status */}
      <div className="absolute top-[80px] right-6 z-30 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
        <div className={`w-2 h-2 rounded-full ${isCameraReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-tighter">Rec</span>
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

        {/* Debug Info Overlay */}
        <div className="absolute top-24 left-6 z-20 flex flex-col gap-3">
          <div className="bg-black/60 backdrop-blur-md p-3 rounded-xl border border-white/10 hidden sm:block">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Dati AI</p>
            <div className="flex flex-col">
              <span className="text-xs text-white font-mono">Angolo: <span className="text-brand-orange font-bold">{Math.round(debugData.angle)}°</span></span>
              <span className="text-xs text-white font-mono">Stato: <span className="text-brand-lightOrange font-bold">{debugData.stage || 'N/A'}</span></span>
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
            <p className="text-brand-orange font-bold tracking-[0.2em] uppercase mt-1 text-sm">Reps</p>
         </div>
      </div>
    </div>
  );
};

export default RepCounterPage;
