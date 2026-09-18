/**
 * WorkoutHistoryPage.tsx — Lista dello storico sessioni di allenamento completate.
 *
 * Mostra in ordine cronologico inverso (più recenti in cima) tutte le sessioni
 * `workout_run` dell'utente, con nome del workout, data/ora di esecuzione e
 * un pulsante di cancellazione per ogni voce.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NOME DEL WORKOUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * La risoluzione del nome è a cascata (primo disponibile vince):
 *  1. `workout_name_snapshot` — snapshot del nome al momento dell'esecuzione
 *     (immutabile anche se la scheda originale viene rinominata o eliminata)
 *  2. `schede.nome` — nome corrente della scheda collegata (join eager)
 *  3. Fallback generato: `Workout #<id_scheda>` o `Workout #<id_workout>`
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CANCELLAZIONE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * La cancellazione elimina in sequenza:
 *  1. Le note collegate (`note_workout`) — per rispettare l'integrità referenziale
 *  2. Il record `workout_run` — con filtro su `id_utente` per sicurezza (RLS)
 *
 * Durante la cancellazione, il bottone mostra uno spinner e tutti gli altri
 * bottoni di delete vengono disabilitati (`deletingWorkoutId != null`) per
 * evitare operazioni concorrenti che potrebbero corrompere lo stato.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NAVIGAZIONE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Ogni voce naviga a `/workout-history/:workoutRunId` (WorkoutHistoryDetailPage)
 * per visualizzare il dettaglio completo della sessione.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronRight, Dumbbell, Loader2, Trash2, BarChart3, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import BottomNavigation from '../components/BottomNavigation';
import PeriodicReportModal from '../components/PeriodicReportModal';
import AppHeader from '../components/AppHeader';
import { hapticLight, hapticHeavy } from '../utils/haptics';
import {
  type RawWorkoutSession,
  toSnapshotExercises,
} from '../utils/periodicReportEngine';

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
  const [reportWorkouts, setReportWorkouts] = useState<RawWorkoutSession[]>([]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [deletingWorkoutId, setDeletingWorkoutId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    try {
      setLoading(true);

      const runSelectWithDuration = `
        id_workout,
        id_scheda,
        workout_name_snapshot,
        exercises_snapshot,
        data_esecuzione,
        durata_totale_secondi,
        schede ( id_scheda, nome ),
        note_workout ( testo, created_at )
      `;

      const runSelectBase = `
        id_workout,
        id_scheda,
        workout_name_snapshot,
        exercises_snapshot,
        data_esecuzione,
        schede ( id_scheda, nome ),
        note_workout ( testo, created_at )
      `;

      let runData: any = null;
      let runError: any = null;

      const firstAttempt = await supabase
        .from('workout_run')
        .select(runSelectWithDuration)
        .order('data_esecuzione', { ascending: false });

      runData = firstAttempt.data;
      runError = firstAttempt.error;

      if (runError && /durata_totale_secondi/i.test(String(runError.message || ''))) {
        const fallbackAttempt = await supabase
          .from('workout_run')
          .select(runSelectBase)
          .order('data_esecuzione', { ascending: false });
        runData = fallbackAttempt.data;
        runError = fallbackAttempt.error;
      }

      if (runError) throw runError;

      const rows = runData || [];

      const parsed = rows.map((row: any) => {
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

      const parsedRawSessions: RawWorkoutSession[] = rows
        .map((row: any) => {
          if (!row) return null;
          const snapshotName = String((row as { workout_name_snapshot?: unknown }).workout_name_snapshot || '').trim();
          const linkedScheda = Array.isArray(row.schede) ? row.schede[0] : row.schede;
          const workoutName =
            snapshotName ||
            linkedScheda?.nome ||
            (row.id_scheda != null ? `Workout #${row.id_scheda}` : `Workout #${row.id_workout}`);

          const exercises = toSnapshotExercises(row.exercises_snapshot);
          const linkedNotes = Array.isArray(row.note_workout) ? row.note_workout : [];
          const notes = linkedNotes
            .filter((n: any) => Boolean(n && typeof n === 'object'))
            .map((n: any) => ({
              text: String(n.testo || ''),
              createdAt: n.created_at ? String(n.created_at) : undefined,
            }));

          return {
            id: String(row.id_workout),
            workoutName,
            executedAt: String(row.data_esecuzione || ''),
            totalDurationSeconds: row.durata_totale_secondi != null ? Number(row.durata_totale_secondi) : null,
            exercises,
            notes,
          };
        })
        .filter((s: RawWorkoutSession | null): s is RawWorkoutSession => Boolean(s && s.executedAt));

      setHistoryItems(parsed);
      setReportWorkouts(parsedRawSessions);
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
      setReportWorkouts((prev) => prev.filter((item) => item.id !== workoutRunId));
    } catch (deleteError) {
      console.error('Error deleting workout from history:', deleteError);
      alert('Unable to delete workout history entry.');
    } finally {
      setDeletingWorkoutId(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col safe-pb-nav relative">
      <AppHeader
        title="Storico Allenamenti"
        subtitle={!loading && historyItems.length > 0 ? `${historyItems.length} completati` : undefined}
      />

      <main className="flex-1 p-4 sm:p-6 w-full max-w-2xl mx-auto space-y-4">
        {/* Banner Genera Report Periodico in primo piano */}
        {!loading && historyItems.length > 0 && (
          <div className="bg-gradient-to-br from-[#1C1C1E] via-[#241E1A] to-[#1C1C1E] border border-brand-orange/30 rounded-3xl p-5 shadow-2xl backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 w-full sm:w-auto">
              <div className="p-3 bg-brand-orange/15 border border-brand-orange/30 rounded-2xl text-brand-orange shrink-0 shadow-lg shadow-brand-orange/10">
                <BarChart3 size={26} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-white font-extrabold text-base sm:text-lg tracking-tight">Statistiche & Progressi</h2>
                  <span className="bg-brand-orange/20 border border-brand-orange/30 text-brand-orange text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Sparkles size={10} /> Macro & Micro
                  </span>
                </div>
                <p className="text-xs text-brand-grey/80 mt-0.5 leading-relaxed">
                  Tempo effettivo, frequenza, Hard Sets e progressione per esercizio con curve di trend.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                void hapticLight();
                setIsReportModalOpen(true);
              }}
              className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-brand-orange to-brand-lightOrange text-black font-extrabold text-sm shadow-xl shadow-brand-orange/20 hover:brightness-110 active:scale-95 transition-all cursor-pointer select-none"
            >
              <BarChart3 size={18} />
              <span>📊 Statistiche & Progressi</span>
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-brand-orange border-b-2 border-white/10"></div>
          </div>
        ) : historyItems.length === 0 ? (
          <div className="text-center bg-[#1C1C1E]/60 border border-white/10 rounded-3xl p-8 mt-8">
            <Dumbbell size={48} className="mx-auto text-brand-grey/40 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Nessun allenamento salvato</h2>
            <p className="text-brand-grey/70 text-sm mb-6 max-w-xs mx-auto">Completa una sessione per vederla apparire qui con data, esercizi e note.</p>
            <button
              onClick={() => {
                void hapticLight();
                navigate('/select-workout');
              }}
              className="bg-brand-orange hover:bg-brand-lightOrange text-black font-extrabold py-3 px-6 rounded-full transition-all shadow-lg shadow-brand-orange/20 cursor-pointer active:scale-95"
            >
              INIZIA ALLENAMENTO
            </button>
          </div>
        ) : (
          historyItems.map((item) => (
            <div key={item.id} className="relative group">
              <button
                onClick={() => {
                  void hapticLight();
                  navigate(`/workout-history/${item.id}`);
                }}
                aria-label={`Open details for ${item.workoutName}`}
                className="w-full text-left bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/10 hover:border-brand-orange/40 rounded-3xl p-4 sm:p-5 pr-14 sm:pr-16 shadow-lg transition-all active:scale-[0.99] cursor-pointer"
                disabled={deletingWorkoutId === item.id}
              >
                <div className="flex items-start justify-between min-w-0 gap-4">
                  <div className="flex items-start min-w-0">
                    <div className="bg-brand-orange/15 border border-brand-orange/25 p-3 rounded-2xl mr-4 mt-0.5 shrink-0">
                      <Calendar className="text-brand-orange" size={22} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base sm:text-lg font-bold text-white leading-tight break-words">{item.workoutName}</h2>
                      <p className="text-xs sm:text-sm text-brand-grey/70 mt-1">{formatExecutedAt(item.executedAt)}</p>
                      <p className="text-[11px] text-brand-orange font-semibold mt-2 tracking-wide uppercase">Tocca per dettagli</p>
                    </div>
                  </div>

                  <div className="shrink-0 mt-1 text-brand-grey/50 group-hover:text-brand-orange transition-colors">
                    <ChevronRight size={20} />
                  </div>
                </div>
              </button>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void hapticHeavy();
                  void deleteHistoryWorkout(item.id);
                }}
                disabled={deletingWorkoutId != null}
                className="absolute top-4 right-4 p-2 rounded-xl bg-black/40 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-brand-grey/60 hover:text-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title="Elimina allenamento completato"
                aria-label={`Elimina ${item.workoutName}`}
              >
                {deletingWorkoutId === item.id ? (
                  <Loader2 size={16} className="animate-spin text-brand-orange" />
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            </div>
          ))
        )}
      </main>

      <PeriodicReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        workouts={reportWorkouts}
      />

      <BottomNavigation hidden={isReportModalOpen} />
    </div>
  );
};

export default WorkoutHistoryPage;
