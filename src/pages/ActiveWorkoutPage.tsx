import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Play, Pause, SkipForward, ArrowRight, ArrowLeft as ArrowPrev, Timer, CheckCircle2 } from 'lucide-react';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  order_index: number;
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

  // Timer State for Rest
  const [isResting, setIsResting] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);

  // Timer State for Isometry
  const [isometryActive, setIsometryActive] = useState(false);
  const [isometryRemaining, setIsometryRemaining] = useState(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

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
        const sortedExercises = [...(data.exercises || [])].sort((a, b) => a.order_index - b.order_index);
        setWorkout({ ...data, exercises: sortedExercises });
        
        // Reset states just in case
        setCurrentExerciseIdx(0);
        setCurrentSetIdx(0);
        setIsResting(false);
        
        if (sortedExercises.length > 0 && sortedExercises[0].type === 'isometry') {
            setIsometryRemaining(sortedExercises[0].duration_seconds);
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
        <h2 className="text-xl font-bold text-white mb-4">Nessun esercizio trovato.</h2>
        <button onClick={() => navigate(-1)} className="text-brand-orange">Torna indietro</button>
      </div>
    );
  }

  const currentExercise = workout.exercises[currentExerciseIdx];
  const isLastExercise = currentExerciseIdx === workout.exercises.length - 1;
  const isLastSet = currentSetIdx === currentExercise.sets - 1;

  const handleNextExercise = () => {
    if (!isLastExercise) {
      const nextIdx = currentExerciseIdx + 1;
      setCurrentExerciseIdx(nextIdx);
      setCurrentSetIdx(0);
      setIsResting(false);
      setIsometryActive(false);
      if (workout.exercises[nextIdx].type === 'isometry') {
        setIsometryRemaining(workout.exercises[nextIdx].duration_seconds);
      }
    } else {
      // Workout Complete!
      if (window.confirm("Allenamento completato! Vuoi tornare alla home?")) {
        navigate('/');
      }
    }
  };

  const handlePrevExercise = () => {
    if (currentExerciseIdx > 0) {
      const prevIdx = currentExerciseIdx - 1;
      setCurrentExerciseIdx(prevIdx);
      setCurrentSetIdx(0);
      setIsResting(false);
      setIsometryActive(false);
      if (workout.exercises[prevIdx].type === 'isometry') {
        setIsometryRemaining(workout.exercises[prevIdx].duration_seconds);
      }
    }
  };

  const completeSet = () => {
    if (isLastSet) {
      // Skip rest on the very last set of the exercise (optional, but usually preferred)
      handleNextExercise();
    } else {
      // Start rest
      setIsometryActive(false); // Stop isometry if it was running
      setRestRemaining(currentExercise.rest_seconds);
      setIsResting(true);
    }
  };

  const finishRestAndNextSet = () => {
    setIsResting(false);
    
    // Increment set
    const nextSetIdx = currentSetIdx + 1;
    setCurrentSetIdx(nextSetIdx);
    
    // Reset isometry timer if needed
    if (currentExercise.type === 'isometry') {
      setIsometryRemaining(currentExercise.duration_seconds);
    }
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

  const toggleIsometry = () => {
    if (isometryRemaining <= 0) {
      setIsometryRemaining(currentExercise.duration_seconds);
    }
    setIsometryActive(!isometryActive);
  };

  // ----------------------------------------------------------------------
  // RENDER REST VIEW
  // ----------------------------------------------------------------------
  if (isResting) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col justify-center items-center p-6 relative">
        <div className="absolute top-4 left-4">
          <button onClick={() => navigate(-1)} className="p-2 text-white/50 hover:text-white">
            <ArrowLeft size={28} />
          </button>
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
          <p className="text-brand-grey text-sm">Prossima Serie:</p>
          <p className="text-white text-xl font-bold">{currentExercise.name}</p>
          <p className="text-brand-orange font-bold font-mono">
            Serie {currentSetIdx + 2} di {currentExercise.sets}
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
        <div className="text-center flex-1 pr-6"> {/* offset to center text */}
          <h1 className="text-xs text-brand-grey uppercase tracking-widest font-black opacity-60">Allenamento in Corso</h1>
          <h2 className="text-sm font-bold text-white truncate px-4">{workout.name}</h2>
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
               ESERCIZIO {currentExerciseIdx + 1} DI {workout.exercises.length}
             </span>
             <h2 className="text-3xl font-black text-white leading-tight drop-shadow-md">
               {currentExercise.name}
             </h2>
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
          {currentExercise.type === 'isometry' ? (
            <div className="text-center w-full max-w-xs relative group cursor-pointer" onClick={toggleIsometry}>
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
                 Tocca il timer per {isometryActive ? 'mettere in pausa' : 'avviarlo'}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <span className="block text-[120px] font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_30px_rgba(255,107,0,0.2)]">
                {currentExercise.reps}
              </span>
              <span className="text-brand-grey font-bold uppercase tracking-widest text-lg">Ripetizioni</span>
            </div>
          )}
        </div>

        {/* Primary Action Button */}
        <div className="mt-auto pt-8">
          <button
            onClick={completeSet}
            className={`w-full py-5 rounded-2xl font-black text-xl flex items-center justify-center transition-all active:scale-95 shadow-xl ${
              isLastExercise && isLastSet 
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black shadow-emerald-500/20' 
                : 'bg-brand-orange hover:bg-brand-lightOrange text-black shadow-brand-orange/20'
            }`}
          >
             {isLastExercise && isLastSet ? (
               <>
                 <CheckCircle2 size={28} className="mr-2" strokeWidth={3} />
                 COMPLETA SCHEDA
               </>
             ) : isLastSet ? (
               <>PROSSIMO ESERCIZIO <ArrowRight size={24} className="ml-2" /></>
             ) : (
               <>FINISH SET</>
             )}
          </button>
        </div>
      </main>
    </div>
  );
};

export default ActiveWorkoutPage;
