import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Play, Pause, SkipForward, ArrowRight, ArrowLeft as ArrowPrev, Timer, CheckCircle2, Mic, MicOff } from 'lucide-react';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  order_index: number;
  subExercises?: any[];
}

interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
}

const ActiveWorkoutPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [workout, setWorkout] = useState<Workout | null>(null);
  
  // App State
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);
  const [currentSetIdx, setCurrentSetIdx] = useState(0);
  const [currentSubExerciseIdx, setCurrentSubExerciseIdx] = useState(0);

  // Timer State for Rest
  const [isResting, setIsResting] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);

  // Timer State for Isometry
  const [isometryActive, setIsometryActive] = useState(false);
  const [isometryRemaining, setIsometryRemaining] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Voice Command State
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const handleVoiceNextRef = useRef<(() => void) | null>(null);
  const handleVoicePrevRef = useRef<(() => void) | null>(null);

  handleVoiceNextRef.current = () => {
    if (isResting) skipRest();
    else completeSet();
  };
  
  handleVoicePrevRef.current = () => {
    handlePrevExercise();
  };

  // Voice Recognition logic
  useEffect(() => {
    let recognition: any = null;

    if (isVoiceEnabled) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'it-IT'; // Support sia accento italiano che inglese se la parola è semplice

        recognition.onresult = (event: any) => {
          const current = event.resultIndex;
          const transcript = event.results[current][0].transcript.toLowerCase();
          
          if (transcript.includes('next') || transcript.includes('avanti')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceNextRef.current) {
               handleVoiceNextRef.current();
            }
          } else if (transcript.includes('back') || transcript.includes('indietro')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoicePrevRef.current) {
               handleVoicePrevRef.current();
            }
          } else {
            // Se ho sentito parole ma non sono comandi supportati:
            setVoiceStatus('error');
            setTimeout(() => setVoiceStatus('idle'), 1500);
          }
        };

        recognition.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
        };

        recognition.onend = () => {
          // Restart automatically if still enabled
          if (isVoiceEnabled && recognition) {
            try {
              recognition.start();
            } catch (e) {}
          }
        };

        try {
          recognition.start();
        } catch (e) {}
      } else {
        alert("Your browser does not support Speech Recognition.");
        setIsVoiceEnabled(false);
      }
    }

    return () => {
      if (recognition) {
        recognition.onend = null; // Prevent restart
        recognition.stop();
      }
    };
  }, [isVoiceEnabled]);

  useEffect(() => {
    fetchWorkout();
  }, [id, user]);

  const fetchWorkout = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('workouts')
        .select(`
          id, name,
          exercises ( id, type, name, sets, reps, duration_seconds, rest_seconds, order_index )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        let sortedExercises = [...(data.exercises || [])].sort((a: any, b: any) => a.order_index - b.order_index) as Exercise[];
        
        // Parsing superset JSON
        sortedExercises = sortedExercises.map(ex => {
          let parsedName = ex.name;
          let subExercises = undefined;
          if (ex.type === 'superset') {
            try {
              subExercises = JSON.parse(ex.name);
              parsedName = 'Superset Circuit'; 
            } catch(e) {}
          }
          return { ...ex, name: parsedName, subExercises };
        });

        setWorkout({ ...data, exercises: sortedExercises });
        
        // Reset states just in case
        setCurrentExerciseIdx(0);
        setCurrentSetIdx(0);
        setCurrentSubExerciseIdx(0);
        setIsResting(false);
        
        const firstEx = sortedExercises[0];
        if (firstEx) {
          if (firstEx.type === 'isometry') {
              setIsometryRemaining(firstEx.duration_seconds);
          } else if (firstEx.type === 'superset' && firstEx.subExercises?.[0]?.type === 'isometry') {
              setIsometryRemaining(firstEx.subExercises[0].duration_seconds);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching workout:', error);
    } finally {
      setLoading(false);
    }
  };

  // Timer logic for REST
  useEffect(() => {
    if (isResting && restRemaining > 0) {
      timerRef.current = setInterval(() => {
        setRestRemaining((prev) => prev - 1);
      }, 1000);
    } else if (isResting && restRemaining <= 0) {
      // End of rest
      setIsResting(false);
      finishRestAndNextSet();
    }
    
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isResting, restRemaining]);

  // Timer logic for ISOMETRY
  useEffect(() => {
    if (isometryActive && isometryRemaining > 0) {
      timerRef.current = setInterval(() => {
        setIsometryRemaining((prev) => prev - 1);
      }, 1000);
    } else if (isometryActive && isometryRemaining <= 0) {
      setIsometryActive(false);
      // Optional: Auto-complete set when isometry finishes, or wait for user to click "FINISH SET"
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isometryActive, isometryRemaining]);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
      </div>
    );
  }

  if (!workout || workout.exercises.length === 0) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col p-6 items-center justify-center">
        <h2 className="text-xl font-bold text-white mb-4">No exercises found.</h2>
        <button onClick={() => navigate(-1)} className="text-brand-orange">Go Back</button>
      </div>
    );
  }

  const currentExercise = workout.exercises[currentExerciseIdx];
  const isLastExercise = currentExerciseIdx === workout.exercises.length - 1;
  const isLastSet = currentSetIdx === currentExercise.sets - 1;
  
  const isSuperset = currentExercise.type === 'superset';
  const subExercise = isSuperset && currentExercise.subExercises ? currentExercise.subExercises[currentSubExerciseIdx] : null;

  const getTargetIsometry = (ex: Exercise, subEx: any) => {
    if (ex.type === 'superset' && subEx?.type === 'isometry') return subEx.duration_seconds;
    if (ex.type === 'isometry') return ex.duration_seconds;
    return 0;
  };

  const handleNextExercise = () => {
    if (!isLastExercise) {
      const nextIdx = currentExerciseIdx + 1;
      const nextEx = workout.exercises[nextIdx];
      setCurrentExerciseIdx(nextIdx);
      setCurrentSetIdx(0);
      setCurrentSubExerciseIdx(0);
      setIsResting(false);
      setIsometryActive(false);
      setIsometryRemaining(getTargetIsometry(nextEx, nextEx.subExercises?.[0]));
    } else {
      // Workout Complete!
      if (window.confirm("Workout completed! Do you want to return to home?")) {
        navigate('/');
      }
    }
  };

  const handlePrevExercise = () => {
    if (currentExerciseIdx > 0) {
      const prevIdx = currentExerciseIdx - 1;
      const prevEx = workout.exercises[prevIdx];
      setCurrentExerciseIdx(prevIdx);
      setCurrentSetIdx(0);
      setCurrentSubExerciseIdx(0);
      setIsResting(false);
      setIsometryActive(false);
      setIsometryRemaining(getTargetIsometry(prevEx, prevEx.subExercises?.[0]));
    }
  };

  const completeSet = () => {
    // Se siamo dentro a un superset e non abbiamo finito i sub-esercizi
    if (isSuperset && currentExercise.subExercises && currentSubExerciseIdx < currentExercise.subExercises.length - 1) {
       const nextSubIdx = currentSubExerciseIdx + 1;
       setCurrentSubExerciseIdx(nextSubIdx);
       setIsometryActive(false);
       const nextSubEx = currentExercise.subExercises[nextSubIdx];
       if (nextSubEx.type === 'isometry') {
          setIsometryRemaining(nextSubEx.duration_seconds);
       }
       return;
    }

    // Altrimenti, abbiamo finito l'esercizio (o l'intero giro del superset)
    if (isLastSet) {
      handleNextExercise();
    } else {
      setIsometryActive(false);
      setRestRemaining(currentExercise.rest_seconds);
      setIsResting(true);
    }
  };

  const finishRestAndNextSet = () => {
    setIsResting(false);
    
    // Increment set
    const nextSetIdx = currentSetIdx + 1;
    setCurrentSetIdx(nextSetIdx);
    setCurrentSubExerciseIdx(0);
    
    // Reset isometry timer if needed
    setIsometryRemaining(getTargetIsometry(currentExercise, currentExercise.subExercises?.[0]));
  };

  const skipRest = () => {
    setRestRemaining(0);
    finishRestAndNextSet();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ----------------------------------------------------------------------
  // RENDER REST VIEW
  // ----------------------------------------------------------------------
  if (isResting) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col justify-center items-center p-6 relative">
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-10 p-2">
          <button onClick={() => navigate(-1)} className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft size={28} />
          </button>
          <div className="relative">
            {voiceStatus === 'success' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>}
            {voiceStatus === 'error' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>}
            <button 
              onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} 
              className={`p-2 rounded-full transition-all duration-300 ${isVoiceEnabled ? (voiceStatus === 'success' ? 'bg-green-500 text-white scale-110' : voiceStatus === 'error' ? 'bg-red-500 text-white animate-pulse' : 'bg-brand-orange text-black') : 'text-white/50 hover:text-white bg-brand-darkGrey/40'}`}
            >
              {isVoiceEnabled ? <Mic size={24} /> : <MicOff size={24} />}
            </button>
          </div>
        </div>
        
        <div className="w-64 h-64 rounded-full border-8 border-brand-darkGrey flex flex-col justify-center items-center shadow-[0_0_50px_rgba(255,107,0,0.1)] mb-12 relative overflow-hidden">
           {/* Animated Fill (approximate) */}
           <div 
             className="absolute bottom-0 left-0 right-0 bg-brand-orange/20 transition-all duration-1000 ease-linear"
             style={{ height: `${(restRemaining / currentExercise.rest_seconds) * 100}%` }}
           />
           
           <Timer size={32} className="text-brand-orange mb-2" />
           <span className="text-6xl font-black text-white z-10 font-mono tracking-tighter">
             {formatTime(restRemaining)}
           </span>
           <span className="text-brand-grey font-bold uppercase tracking-widest text-xs mt-2 z-10">REST</span>
        </div>

        <div className="text-center space-y-2 mb-12">
          <p className="text-brand-grey text-sm">Next Set:</p>
          <p className="text-white text-xl font-bold">{currentExercise.name}</p>
          {isSuperset && currentExercise.subExercises && (
            <p className="text-brand-orange/80 text-sm font-semibold">{currentExercise.subExercises.map((s:any) => s.name).join(' + ')}</p>
          )}
          <p className="text-brand-orange font-bold font-mono">
            {isSuperset ? 'Round' : 'Set'} {currentSetIdx + 2} of {currentExercise.sets}
          </p>
        </div>

        <button 
          onClick={skipRest}
          className="bg-white/10 hover:bg-white/20 text-white py-4 px-10 rounded-full font-bold flex items-center transition-colors border border-white/5"
        >
          <SkipForward size={20} className="mr-2" /> SKIP REST
        </button>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // RENDER ACTIVE EXERCISE VIEW
  // ----------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pt-4 pb-12 px-6 safe-top safe-bottom relative">
      <header className="flex items-center justify-between mb-8 z-10 relative">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-white hover:text-brand-orange transition-colors">
          <ArrowLeft size={28} />
        </button>
        <div className="text-center flex-1">
          <h1 className="text-xs text-brand-grey uppercase tracking-widest font-black opacity-60">Active Workout</h1>
          <h2 className="text-sm font-bold text-white truncate px-4">{workout.name}</h2>
        </div>
        <div className="relative">
          {voiceStatus === 'success' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>}
          {voiceStatus === 'error' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>}
          <button 
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)} 
            className={`p-2 -mr-2 rounded-full transition-all duration-300 ${isVoiceEnabled ? (voiceStatus === 'success' ? 'bg-green-500 text-white scale-110' : voiceStatus === 'error' ? 'bg-red-500 text-white animate-pulse' : 'bg-brand-orange text-black') : 'text-white/50 hover:text-white bg-brand-darkGrey/40'}`}
          >
            {isVoiceEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="w-full bg-brand-darkGrey/50 h-2 rounded-full mb-8 overflow-hidden">
        <div 
          className="bg-brand-orange h-full rounded-full transition-all duration-300"
          style={{ width: `${((currentExerciseIdx + 1) / workout.exercises.length) * 100}%` }}
        />
      </div>

      <main className="flex-1 flex flex-col relative">
        {/* Navigation Arrows & Title Area */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={handlePrevExercise}
            disabled={currentExerciseIdx === 0}
            className="p-3 bg-brand-darkGrey/40 rounded-full text-white/50 hover:text-white disabled:opacity-20 disabled:hover:text-white/50 transition-all active:scale-95"
          >
            <ArrowPrev size={24} />
          </button>

          <div className="flex-1 text-center px-4">
             <span className="text-brand-orange font-black text-xs tracking-widest mb-1 block">
               EXERCISE {currentExerciseIdx + 1} OF {workout.exercises.length}
             </span>
             <h2 className="text-3xl font-black text-white leading-tight drop-shadow-md">
               {isSuperset && subExercise ? subExercise.name : currentExercise.name}
             </h2>
             {isSuperset && (
               <span className="text-[10px] text-brand-orange/60 uppercase font-black tracking-widest block mt-1">
                 Superset (Exercise {currentSubExerciseIdx + 1} of {currentExercise.subExercises?.length})
               </span>
             )}
          </div>

          <button 
            onClick={handleNextExercise}
            className="p-3 bg-brand-darkGrey/40 rounded-full text-white/50 hover:text-white transition-all active:scale-95"
          >
            <ArrowRight size={24} />
          </button>
        </div>

        {/* Set Tracker Indicator */}
        <div className="flex justify-center space-x-2 mb-10">
          {Array.from({ length: currentExercise.sets }).map((_, i) => (
            <div 
              key={i} 
              className={`h-2.5 rounded-full transition-all duration-300 ${
                i < currentSetIdx ? 'bg-brand-lightOrange w-8' : 
                i === currentSetIdx ? 'bg-brand-orange w-12 shadow-[0_0_10px_rgba(255,107,0,0.5)]' : 
                'bg-white/10 w-8'
              }`} 
            />
          ))}
        </div>

        {/* Focus Area (Reps / Timer) */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {(isSuperset ? subExercise?.type : currentExercise.type) === 'isometry' ? (
            <div className="text-center w-full max-w-xs relative group cursor-pointer" onClick={() => {
              if (isometryRemaining <= 0) {
                 setIsometryRemaining(getTargetIsometry(currentExercise, subExercise));
              }
              setIsometryActive(!isometryActive);
            }}>
              <div className={`w-64 h-64 mx-auto rounded-full border-[12px] flex flex-col justify-center items-center transition-colors duration-300 shadow-xl ${isometryActive ? 'border-brand-orange shadow-[0_0_40px_rgba(255,107,0,0.3)]' : 'border-brand-darkGrey'}`}>
                 <span className={`text-[80px] font-mono tracking-tighter ${isometryActive ? 'text-white' : 'text-brand-grey'} transition-colors leading-none`}>
                   {isometryRemaining}
                 </span>
                 <span className="text-brand-grey font-bold uppercase tracking-widest text-xs mt-2">SEC</span>
                 
                 <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity">
                    {isometryActive ? <Pause size={48} className="text-white"/> : <Play size={48} className="text-white"/>}
                 </div>
              </div>
              <p className="text-center text-xs text-brand-grey mt-6 uppercase tracking-wider font-bold">
                 Tap timer to {isometryActive ? 'pause' : 'start'}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <span className="block text-[120px] font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_30px_rgba(255,107,0,0.2)]">
                {isSuperset && subExercise ? subExercise.reps : currentExercise.reps}
              </span>
              <span className="text-brand-grey font-bold uppercase tracking-widest text-lg">Reps</span>
            </div>
          )}
        </div>

        {/* Primary Action Button */}
        <div className="mt-auto pt-8">
          <button
            onClick={completeSet}
            className={`w-full py-5 rounded-2xl font-black text-xl flex items-center justify-center transition-all active:scale-95 shadow-xl ${
              isLastExercise && isLastSet && (!isSuperset || currentSubExerciseIdx === (currentExercise.subExercises?.length || 1) - 1)
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black shadow-emerald-500/20' 
                : 'bg-brand-orange hover:bg-brand-lightOrange text-black shadow-brand-orange/20'
            }`}
          >
             {isLastExercise && isLastSet && (!isSuperset || currentSubExerciseIdx === (currentExercise.subExercises?.length || 1) - 1) ? (
               <>
                 <CheckCircle2 size={28} className="mr-2" strokeWidth={3} />
                 COMPLETE WORKOUT
               </>
             ) : isSuperset && currentExercise.subExercises && currentSubExerciseIdx < currentExercise.subExercises.length - 1 ? (
               <>NEXT IN SUPERSET <ArrowRight size={24} className="ml-2" /></>
             ) : isLastSet ? (
               <>NEXT EXERCISE <ArrowRight size={24} className="ml-2" /></>
             ) : (
               <>FINISH {isSuperset ? 'ROUND' : 'SET'}</>
             )}
          </button>
        </div>
      </main>
    </div>
  );
};

export default ActiveWorkoutPage;
