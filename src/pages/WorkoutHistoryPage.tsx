import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronRight, Dumbbell, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import BottomNavigation from '../components/BottomNavigation';

interface WorkoutHistoryItem {
  id: string;
  schedaId: string | null;
  workoutName: string;
  executedAt: string;
}

const WorkoutHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [historyItems, setHistoryItems] = useState<WorkoutHistoryItem[]>([]);
  const [deletingWorkoutId, setDeletingWorkoutId] = useState<string | null>(null);

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
          workout_name_snapshot,
          data_esecuzione,
          schede ( id_scheda, nome )
        `)
        .order('data_esecuzione', { ascending: false });

      if (error) throw error;

      const parsed = (data || []).map((row) => {
        const snapshotName = String((row as { workout_name_snapshot?: unknown }).workout_name_snapshot || '').trim();
        const linkedScheda = Array.isArray(row.schede) ? row.schede[0] : row.schede;
        return {
          id: String(row.id_workout),
          schedaId: row.id_scheda == null ? null : String(row.id_scheda),
          workoutName:
            snapshotName ||
            linkedScheda?.nome ||
            (row.id_scheda != null ? `Workout #${row.id_scheda}` : `Workout #${row.id_workout}`),
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

  const deleteHistoryWorkout = async (workoutRunId: string) => {
    if (!user?.id || deletingWorkoutId != null) return;
    if (!window.confirm('Delete this completed workout from history?')) return;

    const workoutRunNumericId = Number(workoutRunId);
    if (Number.isNaN(workoutRunNumericId)) return;

    try {
      setDeletingWorkoutId(workoutRunId);

      const { error: notesDeleteError } = await supabase
        .from('note_workout')
        .delete()
        .eq('id_workout', workoutRunNumericId);
      if (notesDeleteError) throw notesDeleteError;

      const { error: workoutDeleteError } = await supabase
        .from('workout_run')
        .delete()
        .eq('id_workout', workoutRunNumericId)
        .eq('id_utente', user.id);
      if (workoutDeleteError) throw workoutDeleteError;

      setHistoryItems((prev) => prev.filter((item) => item.id !== workoutRunId));
    } catch (deleteError) {
      console.error('Error deleting workout from history:', deleteError);
      alert('Unable to delete workout history entry.');
    } finally {
      setDeletingWorkoutId(null);
    }
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
            <div key={item.id} className="relative">
              <button
                onClick={() => navigate(`/workout-history/${item.id}`)}
                aria-label={`Open details for ${item.workoutName}`}
                className="w-full text-left bg-brand-darkGrey/40 hover:bg-brand-darkGrey border border-brand-grey/20 hover:border-brand-orange/40 rounded-3xl p-5 pr-16 shadow-xl transition-colors group"
                disabled={deletingWorkoutId === item.id}
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

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteHistoryWorkout(item.id);
                }}
                disabled={deletingWorkoutId != null}
                className="absolute top-4 right-4 p-2 rounded-lg bg-black/30 border border-white/10 text-brand-grey/70 hover:text-red-300 hover:border-red-400/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                title="Delete completed workout"
                aria-label={`Delete ${item.workoutName}`}
              >
                {deletingWorkoutId === item.id ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            </div>
          ))
        )}
      </main>

      <BottomNavigation />
    </div>
  );
};

export default WorkoutHistoryPage;
