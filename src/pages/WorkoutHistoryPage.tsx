import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronRight, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import BottomNavigation from '../components/BottomNavigation';

interface WorkoutHistoryItem {
  id: string;
  schedaId: string;
  workoutName: string;
  executedAt: string;
}

const WorkoutHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [historyItems, setHistoryItems] = useState<WorkoutHistoryItem[]>([]);

  useEffect(() => {
    if (!user) return;
    void fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('workout_run')
        .select(`
          id_workout,
          id_scheda,
          data_esecuzione,
          schede ( id_scheda, nome )
        `)
        .order('data_esecuzione', { ascending: false });

      if (error) throw error;

      const parsed = (data || []).map((row) => {
        const linkedScheda = Array.isArray(row.schede) ? row.schede[0] : row.schede;
        return {
          id: String(row.id_workout),
          schedaId: String(row.id_scheda),
          workoutName: linkedScheda?.nome || `Workout #${row.id_scheda}`,
          executedAt: row.data_esecuzione,
        } as WorkoutHistoryItem;
      });

      setHistoryItems(parsed);
    } catch (error) {
      console.error('Error fetching workout history:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatExecutedAt = (isoDate: string) => {
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) return isoDate;
    return parsed.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <header className="p-4 relative flex items-center justify-center bg-black/50 sticky top-0 z-20 backdrop-blur-md">
        <h1 className="text-xl font-bold text-center">Workout History</h1>
      </header>

      <main className="flex-1 p-6 w-full max-w-2xl mx-auto space-y-4">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
          </div>
        ) : historyItems.length === 0 ? (
          <div className="text-center bg-brand-darkGrey/20 border border-dashed border-brand-grey/30 rounded-3xl p-8 mt-12">
            <Dumbbell size={48} className="mx-auto text-brand-grey/50 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">No Completed Workouts Yet</h2>
            <p className="text-brand-grey text-sm mb-6">Complete a workout and it will appear here with date and time.</p>
            <button
              onClick={() => navigate('/select-workout')}
              className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold py-3 px-6 rounded-full transition-colors"
            >
              START A WORKOUT
            </button>
          </div>
        ) : (
          historyItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/workout-history/${item.id}`)}
              aria-label={`Open details for ${item.workoutName}`}
              className="w-full text-left bg-brand-darkGrey/40 hover:bg-brand-darkGrey border border-brand-grey/20 hover:border-brand-orange/40 rounded-3xl p-5 shadow-xl transition-colors group"
            >
              <div className="flex items-start justify-between min-w-0 gap-4">
                <div className="flex items-start min-w-0">
                  <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4 mt-1">
                    <Calendar className="text-brand-orange" size={24} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-white leading-tight break-words">{item.workoutName}</h2>
                    <p className="text-sm text-brand-grey mt-1">{formatExecutedAt(item.executedAt)}</p>
                    <p className="text-xs text-brand-orange/90 mt-2 uppercase tracking-wide font-bold">Tap to view details</p>
                  </div>
                </div>

                <div className="shrink-0 mt-1 text-brand-grey/70 group-hover:text-brand-orange transition-colors">
                  <ChevronRight size={22} />
                </div>
              </div>
            </button>
          ))
        )}
      </main>

      <BottomNavigation />
    </div>
  );
};

export default WorkoutHistoryPage;
