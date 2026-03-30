import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, Trash2, ArrowLeft, Clock, Timer, Repeat, Pencil, Plus } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate } from 'react-router-dom';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  order_index: number;
  emom_rounds?: number;
  emom_round_duration?: number;
}

interface Workout {
  id: string;
  name: string;
  created_at: string;
  exercises: (Exercise & { subExercises?: any[] })[];
}

const GymCardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkouts();
  }, [user]);

  const fetchWorkouts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('workouts')
        .select(`
          id, name, created_at,
          exercises ( id, type, name, sets, reps, duration_seconds, rest_seconds, order_index )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const parsedWorkouts = (data as unknown as Workout[]).map(w => ({
        ...w,
        // Riordiniamo gli esercizi caricati nella card per l'order_index corretto
        exercises: w.exercises?.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map((ex: any) => {
          let parsedName = ex.name;
          let subExercises = [];
          if (ex.type === 'superset') {
            try {
              subExercises = JSON.parse(ex.name);
              parsedName = 'Superset Circuit';
            } catch(e) {}
          } else if (ex.type === 'emom') {
            try {
              const parsed = JSON.parse(ex.name);
              if (Array.isArray(parsed)) {
                subExercises = parsed;
              } else if (parsed && parsed.subExercises) {
                subExercises = parsed.subExercises;
                ex.sets = parsed.emom_rounds || ex.sets;
                ex.duration_seconds = parsed.emom_round_duration || ex.duration_seconds;
              }
              parsedName = 'EMOM Circuit';
            } catch(e) {}
          }
          return { ...ex, name: parsedName, subExercises };
        }) || []
      }));
      
      setWorkouts(parsedWorkouts);
    } catch (error) {
      console.error('Error fetching workouts:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteWorkout = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this workout?')) return;
    try {
      const { error } = await supabase.from('workouts').delete().eq('id', id);
      if (error) throw error;
      setWorkouts(workouts.filter(w => w.id !== id));
    } catch (error) {
      console.error('Error deleting workout:', error);
    }
  };

  const formatSecs = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <header className="p-4 flex items-center justify-between bg-black/50 sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center">
          <button 
            onClick={() => navigate('/')} 
            className="p-2 -ml-2 text-white hover:text-brand-orange transition-colors"
          >
            <ArrowLeft size={28} />
          </button>
          <h1 className="text-xl font-bold ml-2">Your Workouts</h1>
        </div>
        <button
          onClick={() => navigate('/new-train')}
          className="p-2 text-brand-orange hover:text-brand-lightOrange transition-colors bg-brand-orange/10 rounded-full shadow-lg"
          title="Create New Workout"
        >
          <Plus size={24} />
        </button>
      </header>

      <main className="flex-1 p-6 w-full max-w-2xl mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center bg-brand-darkGrey/20 border border-dashed border-brand-grey/30 rounded-3xl p-8 mt-12">
            <Dumbbell size={48} className="mx-auto text-brand-grey/50 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">No Workouts</h2>
            <p className="text-brand-grey text-sm mb-6">You haven't created any training programs yet.</p>
            <button 
              onClick={() => navigate('/new-train')}
              className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold py-3 px-6 rounded-full transition-colors"
            >
              CREATE ONE NOW
            </button>
          </div>
        ) : (
          workouts.map((workout) => (
            <div key={workout.id} className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute top-4 right-4 flex items-center space-x-3 z-10">
                <button 
                  onClick={() => navigate(`/edit-train/${workout.id}`)}
                  className="p-1 text-brand-grey/40 hover:text-brand-orange transition-colors bg-brand-dark/50 rounded-lg"
                  title="Edit Workout"
                >
                  <Pencil size={20} />
                </button>
                <button 
                  onClick={() => deleteWorkout(workout.id)}
                  className="p-1 text-brand-grey/40 hover:text-red-500 transition-colors bg-brand-dark/50 rounded-lg"
                  title="Delete Workout"
                >
                  <Trash2 size={20} />
                </button>
              </div>

              <div className="flex items-center mb-6 pr-20 border-b border-white/5 pb-4 pt-2">
                <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4">
                  <Calendar className="text-brand-orange" size={28} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold text-white leading-tight break-words">{workout.name}</h2>
                  <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                    {new Date(workout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {workout.exercises && workout.exercises.map((ex, i) => (
                  <div key={ex.id || i} className="flex flex-col bg-black/40 px-5 py-4 rounded-2xl border border-white/5">
                    {ex.type === 'superset' || ex.type === 'emom' ? (
                      <div className="mb-3">
                         <span className="font-bold text-lg text-white drop-shadow-md flex items-center mb-2">
                           <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i+1}.</span>
                           <Repeat size={16} className="mr-1 text-brand-orange"/> {ex.name}
                         </span>
                         <div className="flex flex-col pl-6 border-l-2 border-white/10 space-y-1 mt-1">
                           {ex.subExercises?.map((sub, sIdx) => (
                             <div key={sIdx} className="text-sm font-semibold text-white/80">
                               • {sub.name} <span className="text-brand-orange ml-1 text-xs">({sub.type === 'reps' ? sub.reps + ' reps' : sub.duration_seconds + ' s'})</span>
                             </div>
                           ))}
                         </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center mb-2">
                         <span className="font-bold text-lg text-white truncate max-w-[70%] drop-shadow-md flex items-center">
                            <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i+1}.</span>
                            {ex.name}
                         </span>
                         <div className="flex items-center text-xs font-bold px-2 py-1 rounded bg-brand-darkGrey text-white shadow-inner">
                            {ex.type === 'isometry' ? <Timer size={12} className="mr-1 text-brand-orange"/> : <Repeat size={12} className="mr-1 text-brand-orange"/>}
                            {ex.type === 'isometry' ? 'ISOMETRIC' : 'REPS'}
                         </div>
                      </div>
                    )}
                    
                    <div className="flex items-center space-x-2 text-xs text-brand-grey font-bold w-full mt-2">
                      <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                            {ex.type === 'superset' ? 'Round' : (ex.type === 'emom' ? 'Rounds' : 'Sets')}
                          </span>
                          <span className="text-sm text-white">{ex.sets}</span>
                        </div>

                        {ex.type !== 'superset' && (
                          <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                            <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                              {ex.type === 'isometry' ? 'Duration' : (ex.type === 'emom' ? 'Time/Rnd' : 'Reps')}
                            </span>
                            <span className="text-sm text-brand-orange">{ex.type === 'isometry' || ex.type === 'emom' ? formatSecs(ex.duration_seconds) : ex.reps}</span>
                      <div className="flex-1 bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                         <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center"><Clock size={9} className="mr-1"/> Rest</span>
                         <span className="text-sm text-brand-lightOrange">{formatSecs(ex.rest_seconds)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {(!workout.exercises || workout.exercises.length === 0) && (
                  <p className="text-sm text-brand-grey/50 italic text-center py-4 bg-black/20 rounded-2xl">No exercises in this workout.</p>
                )}
              </div>
            </div>
          ))
        )}
      </main>

      <BottomNavigation />
    </div>
  );
};

export default GymCardPage;
