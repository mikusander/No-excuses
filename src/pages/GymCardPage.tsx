import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, Trash2, ArrowLeft } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate } from 'react-router-dom';

interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
}

interface Workout {
  id: string;
  name: string;
  created_at: string;
  exercises: Exercise[];
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
      // Fetches workouts with embedded exercises correctly
      const { data, error } = await supabase
        .from('workouts')
        .select(`
          id, name, created_at,
          exercises ( id, name, sets, reps )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWorkouts(data as unknown as Workout[]);
    } catch (error) {
      console.error('Error fetching workouts:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteWorkout = async (id: string) => {
    if (!window.confirm('Vuoi davvero eliminare questa scheda?')) return;
    try {
      const { error } = await supabase.from('workouts').delete().eq('id', id);
      if (error) throw error;
      setWorkouts(workouts.filter(w => w.id !== id));
    } catch (error) {
      console.error('Error deleting workout:', error);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <header className="p-4 flex items-center bg-black/50 sticky top-0 z-10">
        <button 
          onClick={() => navigate('/')} 
          className="p-2 text-white hover:text-brand-orange transition-colors"
        >
          <ArrowLeft size={28} />
        </button>
        <h1 className="text-xl font-bold ml-2">Le Tue Schede</h1>
      </header>

      <main className="flex-1 p-6 w-full max-w-2xl mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center bg-brand-darkGrey/20 border border-dashed border-brand-grey/30 rounded-3xl p-8 mt-12">
            <Dumbbell size={48} className="mx-auto text-brand-grey/50 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Nessuna Scheda</h2>
            <p className="text-brand-grey text-sm mb-6">Non hai ancora creato nessuna scheda di allenamento.</p>
            <button 
              onClick={() => navigate('/new-train')}
              className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold py-3 px-6 rounded-full transition-colors"
            >
              CREANE UNA ORA
            </button>
          </div>
        ) : (
          workouts.map((workout) => (
            <div key={workout.id} className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
              {/* Bottone elimina nascosto che appare all'hover su desktop o rimane visibile semitrasparente su mobile */}
              <button 
                onClick={() => deleteWorkout(workout.id)}
                className="absolute top-4 right-4 text-brand-grey/40 hover:text-red-500 transition-colors z-10"
                title="Elimina Scheda"
              >
                <Trash2 size={22} />
              </button>

              <div className="flex items-center mb-6 pr-8">
                <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4">
                  <Calendar className="text-brand-orange" size={28} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white leading-tight">{workout.name}</h2>
                  <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                    {new Date(workout.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm tracking-widest text-brand-orange font-bold uppercase mb-2">Esercizi</h3>
                {workout.exercises && workout.exercises.map((ex, i) => (
                  <div key={ex.id || i} className="flex justify-between items-center bg-black/40 px-4 py-3 rounded-xl border border-white/5">
                    <span className="font-semibold text-white truncate mr-4">{ex.name}</span>
                    <div className="flex space-x-3 text-sm text-brand-grey font-bold shrink-0">
                      <span className="bg-white/10 px-2 py-1 rounded-md">{ex.sets} SET</span>
                      <span className="bg-white/10 px-2 py-1 rounded-md">{ex.reps} REP</span>
                    </div>
                  </div>
                ))}
                {(!workout.exercises || workout.exercises.length === 0) && (
                  <p className="text-sm text-brand-grey/50 italic">Nessun esercizio registrato.</p>
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
