import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, ArrowLeft, PlayCircle } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate } from 'react-router-dom';

interface Workout {
  id: string;
  name: string;
  created_at: string;
}

const SelectWorkoutPage: React.FC = () => {
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
        .select('id, name, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWorkouts(data as Workout[]);
    } catch (error) {
      console.error('Error fetching workouts:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <header className="p-4 flex items-center bg-black/50 sticky top-0 z-20 backdrop-blur-md">
        <button 
          onClick={() => navigate('/')} 
          className="p-2 text-white hover:text-brand-orange transition-colors"
        >
          <ArrowLeft size={28} />
        </button>
        <h1 className="text-xl font-bold ml-2">Seleziona Scheda</h1>
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
          <div className="space-y-4">
            {workouts.map((workout) => (
              <button
                key={workout.id}
                onClick={() => navigate(`/active-workout/${workout.id}`)}
                className="w-full text-left bg-brand-darkGrey/40 hover:bg-brand-darkGrey border border-brand-grey/20 hover:border-brand-orange/50 transition-all rounded-3xl p-6 shadow-lg group flex items-center justify-between"
              >
                <div className="flex items-center">
                  <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4 group-hover:scale-110 transition-transform">
                    <Calendar className="text-brand-orange" size={28} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white leading-tight">{workout.name}</h2>
                    <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                      {new Date(workout.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="bg-brand-orange/10 group-hover:bg-brand-orange text-brand-orange group-hover:text-black p-3 rounded-full transition-colors">
                  <PlayCircle size={28} />
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <BottomNavigation />
    </div>
  );
};

export default SelectWorkoutPage;
