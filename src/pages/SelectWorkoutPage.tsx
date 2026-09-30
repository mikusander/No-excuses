/**
 * SelectWorkoutPage.tsx — Selezione e avvio di una scheda di allenamento.
 *
 * Permette all'utente di scegliere quale scheda eseguire dall'elenco delle
 * schede salvate. Cliccando su una scheda si apre un modal di anteprima che
 * mostra tutti gli esercizi e permette di regolare al volo i parametri
 * (serie, reps, peso, riposo) prima di avviare il workout.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * FLUSSO PRINCIPALE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  1. Al mount: carica la lista schede da Supabase (`schede`)
 *  2. Click su una scheda → `loadWorkoutPreview()`:
 *     - Carica gli esercizi con join profondo (esecuzioni → esercizi/superset/emom)
 *     - Carica le note dell'ultima sessione di questa scheda (`workout_run` + `note_workout`)
 *     - Popola `editableExercises` con una copia modificabile degli esercizi
 *  3. L'utente può modificare i parametri degli esercizi direttamente nel modal
 *     tramite `InlineNumberInput` (componente locale inline)
 *  4. Click "Start" → `handleSaveAndStart()`:
 *     - Salva le modifiche agli esercizi su DB tramite `saveExercisesToDb()`
 *     - Cancella i checkpoint di workout precedenti
 *     - Naviga a `/active-workout/:id`
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NOTE DELL'ULTIMA SESSIONE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Le note del workout precedente vengono precaricate e mostrate accanto a ciascun
 * esercizio come riferimento ("ultima volta ho notato che...").
 * Il formato è tagged: `[<orderIndex>. <exerciseName>] <testo>`.
 * `parseTaggedNote()` estrae `orderIndex` + `exerciseName` + `text`.
 * Le note vengono indicizzate con chiave `${orderIndex}_${normalizeNoteKey(name)}`
 * per un lookup O(1) durante il render.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ESERCIZI MODIFICABILI
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - `editableExercises` : copia profonda degli esercizi della scheda
 *  - `updateExerciseField(index, field, value)` : aggiorna un campo di un esercizio
 *  - `updateSubExerciseField(exIdx, subIdx, field, value)` : aggiorna un sub-esercizio (superset/EMOM)
 *  - `updatePyramidStepField(exIdx, stepIdx, field, value)` : aggiorna uno step di piramide
 *
 * Il componente locale `InlineNumberInput` gestisce sia input numerici interi
 * che input decimali per il peso (con parsing sicuro e gestione stringa vuota = bodyweight).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CANCELLAZIONE CHECKPOINT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Prima di avviare un nuovo workout, tutti i checkpoint di sessioni interrotte
 * vengono eliminati (`clearAllWorkoutProgressCheckpoints`) per evitare che
 * la HomePage proponga di riprendere una sessione ormai superata.
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, PlayCircle, Folder, Flame } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import AppHeader from '../components/AppHeader';
import { useNavigate } from 'react-router-dom';
import {
  getValidWorkoutProgressCheckpoints,
  subscribeToWorkoutProgress,
  type WorkoutProgressCheckpointMeta,
} from '../lib/workoutProgressStorage';
import {
  getFolders,
  getFolderAssignments,
  subscribeToFolderChanges,
  syncFoldersWithCloud,
  sortSchedeByFolderOrder,
  type WorkoutFolder,
  type FolderAssignmentMap,
} from '../utils/folderManager';
import { hapticLight, hapticMedium } from '../utils/haptics';
import WorkoutPreviewModal from '../components/WorkoutPreviewModal';

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
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [activeCheckpoints, setActiveCheckpoints] = useState<WorkoutProgressCheckpointMeta[]>([]);

  const refreshCheckpoints = useCallback(() => {
    if (!user?.id) {
      setActiveCheckpoints([]);
      return;
    }
    setActiveCheckpoints(getValidWorkoutProgressCheckpoints(user.id));
  }, [user?.id]);

  useEffect(() => {
    refreshCheckpoints();
    const unsub = subscribeToWorkoutProgress(() => {
      refreshCheckpoints();
    });
    return unsub;
  }, [refreshCheckpoints]);

  const isWorkoutActive = useCallback((schedaIdStr?: string | null) => {
    if (!schedaIdStr) return false;
    const numId = Number(schedaIdStr);
    if (!Number.isFinite(numId)) return false;
    return activeCheckpoints.some((cp) => cp.identity.type === 'scheda' && cp.identity.id === numId);
  }, [activeCheckpoints]);

  // Folder filtering
  const [folders, setFolders] = useState<WorkoutFolder[]>(() => getFolders(user?.id));
  const [folderAssignments, setFolderAssignments] = useState<FolderAssignmentMap>(() => getFolderAssignments(user?.id));
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<'all' | 'root' | string>('all');

  useEffect(() => {
    setFolders(getFolders(user?.id));
    setFolderAssignments(getFolderAssignments(user?.id));

    if (user?.id) {
      void syncFoldersWithCloud(user.id);
    }

    const unsub = subscribeToFolderChanges(() => {
      setFolders(getFolders(user?.id));
      setFolderAssignments(getFolderAssignments(user?.id));
    });
    return unsub;
  }, [user?.id]);

  const filteredWorkouts = useMemo(() => {
    if (selectedFolderFilter === 'all') return workouts;
    if (selectedFolderFilter === 'root') {
      return workouts.filter((w) => !folderAssignments[w.id]);
    }
    const inFolder = workouts.filter((w) => folderAssignments[w.id] === selectedFolderFilter);
    return sortSchedeByFolderOrder(inFolder, selectedFolderFilter, user?.id);
  }, [workouts, folderAssignments, selectedFolderFilter, user?.id, folders]);

  useEffect(() => {
    fetchWorkouts();
  }, [user]);

  const fetchWorkouts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('schede')
        .select('id_scheda, nome, data_creazione')
        .order('data_creazione', { ascending: false });

      if (error) throw error;
      setWorkouts((data || []).map((w: any) => ({
        id: String(w.id_scheda),
        name: w.nome,
        created_at: w.data_creazione,
      })));
    } catch (error) {
      console.error('Error fetching workouts:', error);
    } finally {
      setLoading(false);
    }
  };


  const closePreviewModal = () => {
    setSelectedWorkout(null);
  };

  const openWorkoutPreview = (workout: Workout) => {
    void hapticLight();
    if (isWorkoutActive(workout.id)) {
      void hapticMedium();
      navigate(`/active-workout/${workout.id}`);
      return;
    }
    setSelectedWorkout(workout);
  };



  return (
    <div className="min-h-screen bg-brand-dark flex flex-col safe-pb-nav relative">
      <AppHeader
        title="Select Workout"
        onBack={() => navigate('/')}
      />

      <main className="flex-1 p-6 w-full max-w-2xl mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center bg-brand-darkGrey/20 border border-dashed border-brand-grey/30 rounded-3xl p-8 mt-12">
            <Dumbbell size={48} className="mx-auto text-brand-grey/50 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">No Workouts Found</h2>
            <p className="text-brand-grey text-sm mb-6">You haven't created any workouts yet.</p>
            <button
              onClick={() => navigate('/new-train')}
              className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold py-3 px-6 rounded-full transition-colors"
            >
              CREATE ONE NOW
            </button>
          </div>
        ) : (
          <div>
            {folders.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-4 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedFolderFilter('all')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer ${
                    selectedFolderFilter === 'all'
                      ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                      : 'bg-brand-darkGrey/60 text-zinc-400 hover:text-white border border-white/5'
                  }`}
                >
                  Tutte ({workouts.length})
                </button>
                {folders.map((f) => {
                  const count = workouts.filter((w) => folderAssignments[w.id] === f.id).length;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFolderFilter(f.id)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                        selectedFolderFilter === f.id
                          ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                          : 'bg-brand-darkGrey/60 text-zinc-400 hover:text-white border border-white/5'
                      }`}
                    >
                      <Folder size={12} />
                      <span>{f.name}</span>
                      <span className="opacity-70 text-[10px]">({count})</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSelectedFolderFilter('root')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer ${
                    selectedFolderFilter === 'root'
                      ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                      : 'bg-brand-darkGrey/60 text-zinc-400 hover:text-white border border-white/5'
                  }`}
                >
                  Senza cartella ({workouts.filter((w) => !folderAssignments[w.id]).length})
                </button>
              </div>
            )}

            {filteredWorkouts.length === 0 ? (
              <div className="text-center py-12 bg-brand-darkGrey/20 rounded-3xl border border-dashed border-brand-grey/20">
                <Folder size={36} className="mx-auto text-brand-grey/40 mb-3" />
                <p className="text-zinc-400 text-sm">Nessuna scheda trovata con questo filtro.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredWorkouts.map((workout) => {
                  const folderId = folderAssignments[workout.id];
                  const folderName = folderId ? folders.find((f) => f.id === folderId)?.name : null;

                  return (
                    <button
                      key={workout.id}
                      onClick={() => openWorkoutPreview(workout)}
                      className="w-full text-left bg-brand-darkGrey/40 hover:bg-brand-darkGrey border border-brand-grey/20 hover:border-brand-orange/50 transition-all rounded-3xl p-6 shadow-lg group flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center min-w-0 pr-4 flex-1">
                        {/* Badge Numero d'Ordine a sinistra quando si filtra per cartella */}
                        {selectedFolderFilter !== 'all' && selectedFolderFilter !== 'root' && (
                          <div className="w-8 h-8 rounded-xl bg-brand-orange/15 border border-brand-orange/35 flex items-center justify-center text-brand-orange font-black text-xs shrink-0 mr-3.5 shadow-sm">
                            #{filteredWorkouts.indexOf(workout) + 1}
                          </div>
                        )}
                        <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4 group-hover:scale-110 transition-transform shrink-0">
                          <Calendar className="text-brand-orange" size={28} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-white leading-tight truncate">{workout.name}</h2>
                            {isWorkoutActive(workout.id) && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-orange bg-brand-orange/15 border border-brand-orange/30 px-2 py-0.5 rounded-full shrink-0">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-orange animate-ping" />
                                In corso
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <p className="text-xs text-brand-grey/60 font-semibold">
                              {new Date(workout.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                            {folderName && selectedFolderFilter === 'all' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                                <Folder size={10} />
                                {folderName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="bg-brand-orange/10 group-hover:bg-brand-orange text-brand-orange group-hover:text-black p-3 rounded-full transition-colors shrink-0">
                        {isWorkoutActive(workout.id) ? (
                          <Flame size={28} className="text-brand-orange group-hover:text-black animate-pulse" />
                        ) : (
                          <PlayCircle size={28} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {selectedWorkout && (
        <WorkoutPreviewModal
          workoutId={selectedWorkout.id}
          initialWorkoutName={selectedWorkout.name}
          initialWorkoutCreatedAt={selectedWorkout.created_at}
          onClose={closePreviewModal}
        />
      )}

      <BottomNavigation hidden={Boolean(selectedWorkout)} />
    </div>
  );
};

export default SelectWorkoutPage;
