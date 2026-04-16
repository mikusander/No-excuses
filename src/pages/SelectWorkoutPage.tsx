import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, ArrowLeft, PlayCircle, Clock, Timer, Repeat, X } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate } from 'react-router-dom';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import { clearAllWorkoutProgressCheckpoints } from '../lib/workoutProgressStorage';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  weight_kg?: number | null;
  order_index: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: { reps: number; rest_seconds: number; weight_kg?: number | null }[];
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
  }[];
}

interface Workout {
  id: string;
  name: string;
  created_at: string;
}

interface WorkoutPreview extends Workout {
  exercises: Exercise[];
}

const SelectWorkoutPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [selectedWorkoutPreview, setSelectedWorkoutPreview] = useState<WorkoutPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  const formatSecs = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const formatWeightLabel = (weight?: number | null) => {
    const n = Number(weight);
    if (!Number.isFinite(n) || n <= 0) return 'Body Weight';
    return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`;
  };

  const getExerciseWeightLabel = (exercise: Exercise) => {
    if (exercise.type === 'pyramid') {
      const labels = Array.from(new Set((exercise.pyramid_steps || []).map((step) => formatWeightLabel(step.weight_kg))));
      if (labels.length === 0) return 'Body Weight';
      return labels.length === 1 ? labels[0] : 'Varies';
    }

    if ((exercise.type === 'superset' || exercise.type === 'emom') && exercise.subExercises?.length) {
      const labels = Array.from(new Set(exercise.subExercises.map((sub) => formatWeightLabel(sub.weight_kg))));
      if (labels.length === 0) return 'Body Weight';
      return labels.length === 1 ? labels[0] : 'Varies';
    }

    return formatWeightLabel(exercise.weight_kg);
  };

  const closePreviewModal = () => {
    setSelectedWorkout(null);
    setSelectedWorkoutPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
  };

  const clearSavedWorkoutCheckpoint = () => {
    if (!user?.id) return;
    clearAllWorkoutProgressCheckpoints(user.id);
  };

  const loadWorkoutPreview = async (workout: Workout) => {
    try {
      setPreviewLoading(true);
      setPreviewError(null);
      setSelectedWorkoutPreview(null);

      const { data, error } = await supabase
        .from('schede')
        .select(`
          id_scheda,
          nome,
          data_creazione,
          esecuzioni (
            id_esecuzione,
            ordine,
            set_num,
            rest_secondi,
            peso_kg,
            tipo,
            reps,
            durata_secondi,
            id_superset,
            id_piramide,
            stepindex_piramide,
            id_emom,
            stepindex_emom,
            superset ( round_totali ),
            emom ( round_totali, durata_round_secondi ),
            esercizi ( nome )
          )
        `)
        .eq('id_scheda', Number(workout.id))
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setPreviewError('Workout not found.');
        setSelectedWorkoutPreview({
          ...workout,
          exercises: [],
        });
        return;
      }

      const parsedExercises = parseDbExerciseRows(data.esecuzioni || []) as Exercise[];
      setSelectedWorkoutPreview({
        id: String(data.id_scheda),
        name: String(data.nome || workout.name),
        created_at: String(data.data_creazione || workout.created_at),
        exercises: parsedExercises,
      });
    } catch (error) {
      console.error('Error loading workout preview:', error);
      setPreviewError('Unable to load workout preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const openWorkoutPreview = (workout: Workout) => {
    setSelectedWorkout(workout);
    void loadWorkoutPreview(workout);
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
        <h1 className="text-xl font-bold ml-2">Select Workout</h1>
      </header>

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
          <div className="space-y-4">
            {workouts.map((workout) => (
              <button
                key={workout.id}
                onClick={() => openWorkoutPreview(workout)}
                className="w-full text-left bg-brand-darkGrey/40 hover:bg-brand-darkGrey border border-brand-grey/20 hover:border-brand-orange/50 transition-all rounded-3xl p-6 shadow-lg group flex items-center justify-between"
              >
                <div className="flex items-center">
                  <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4 group-hover:scale-110 transition-transform">
                    <Calendar className="text-brand-orange" size={28} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white leading-tight">{workout.name}</h2>
                    <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                      {new Date(workout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
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

      {selectedWorkout && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-5"
          onClick={closePreviewModal}
        >
          <div
            className="w-full max-w-2xl bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl shadow-2xl max-h-[88vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-2xl font-black text-white leading-tight break-words">
                  {selectedWorkoutPreview?.name || selectedWorkout.name}
                </h3>
                <p className="text-xs text-brand-grey/70 font-semibold mt-1">
                  Created on {new Date(selectedWorkoutPreview?.created_at || selectedWorkout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>

              <button
                onClick={closePreviewModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close preview"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-[calc(88vh-186px)]">
              {previewLoading ? (
                <div className="flex justify-center items-center h-36">
                  <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey" />
                </div>
              ) : (
                <>
                  {previewError && (
                    <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-200">
                      {previewError}
                    </div>
                  )}

                  <div className="space-y-4">
                    {selectedWorkoutPreview?.exercises.map((ex, i) => {
                      const showInlineWeightNearName =
                        (ex.type === 'superset' || ex.type === 'emom') && (ex.subExercises?.length || 0) > 1;

                      return (
                        <div key={ex.id || i} className="flex flex-col bg-black/40 px-5 py-4 rounded-2xl border border-white/5">
                          {ex.type === 'superset' || ex.type === 'emom' || ex.type === 'pyramid' ? (
                            <div className="mb-3">
                              <span className="font-bold text-lg text-white drop-shadow-md flex items-center mb-2">
                                <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i + 1}.</span>
                                <Repeat size={16} className="mr-1 text-brand-orange" /> {ex.name}
                              </span>
                              <div className="flex flex-col pl-6 border-l-2 border-white/10 space-y-1 mt-1">
                                {ex.type === 'pyramid'
                                  ? ex.pyramid_steps?.map((step, sIdx) => (
                                    <div key={sIdx} className="text-sm font-semibold text-white/80">
                                      Step {sIdx + 1}: <span className="text-brand-orange ml-1 text-xs">{step.reps > 0 ? `${step.reps} reps` : 'MAX'}</span>{' '}
                                      <span className="text-brand-grey/70 text-xs">/ rest {formatSecs(step.rest_seconds)}</span>
                                    </div>
                                  ))
                                  : ex.subExercises?.map((sub, sIdx) => (
                                    <div key={sIdx} className="text-sm font-semibold text-white/80">
                                      {sub.name}{' '}
                                      <span className="text-brand-orange ml-1 text-xs">
                                        ({sub.type === 'reps' ? (sub.reps > 0 ? `${sub.reps} reps` : 'MAX REPS') : (sub.duration_seconds > 0 ? `${sub.duration_seconds} s` : 'MAX TIME')})
                                      </span>
                                      {showInlineWeightNearName && (
                                        <span className="text-brand-grey/70 text-xs ml-1">{formatWeightLabel(sub.weight_kg)}</span>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold text-lg text-white truncate max-w-[70%] drop-shadow-md flex items-center">
                                <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i + 1}.</span>
                                {ex.name}
                              </span>
                              <div className="flex items-center text-xs font-bold px-2 py-1 rounded bg-brand-darkGrey text-white shadow-inner">
                                {ex.type === 'isometry' ? <Timer size={12} className="mr-1 text-brand-orange" /> : <Repeat size={12} className="mr-1 text-brand-orange" />}
                                {ex.type === 'isometry' ? 'ISOMETRIC' : 'REPS'}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 min-[450px]:grid-cols-4 gap-2 text-xs text-brand-grey font-bold w-full mt-2">
                            <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                              <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                                {ex.type === 'superset' ? 'Round' : ex.type === 'emom' ? 'Rounds' : ex.type === 'pyramid' ? 'Steps' : 'Sets'}
                              </span>
                              <span className="text-sm text-white">{ex.type === 'pyramid' ? ex.pyramid_steps?.length || 0 : ex.sets}</span>
                            </div>

                            {ex.type !== 'superset' && ex.type !== 'pyramid' && (
                              <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                                <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                                  {ex.type === 'isometry' ? 'Duration' : ex.type === 'emom' ? 'Time/Rnd' : 'Reps'}
                                </span>
                                <span className="text-sm text-brand-orange">{ex.type === 'isometry' || ex.type === 'emom' ? (ex.duration_seconds > 0 ? formatSecs(ex.duration_seconds) : 'MAX TIME') : (ex.reps > 0 ? ex.reps : 'MAX REPS')}</span>
                              </div>
                            )}

                            {ex.type !== 'pyramid' && (
                              <div className="flex-1 bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                                <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                                  <Clock size={9} className="mr-1" /> Rest
                                </span>
                                <span className="text-sm text-brand-lightOrange">{formatSecs(ex.rest_seconds)}</span>
                              </div>
                            )}

                            {!showInlineWeightNearName && (
                              <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                                <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Weights</span>
                                <span className="text-sm text-brand-lightOrange truncate">{getExerciseWeightLabel(ex)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {(!selectedWorkoutPreview || selectedWorkoutPreview.exercises.length === 0) && !previewError && (
                      <p className="text-sm text-brand-grey/50 italic text-center py-4 bg-black/20 rounded-2xl">No exercises in this workout.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-5 border-t border-white/10">
              <button
                onClick={() => {
                  if (!selectedWorkoutPreview) return;
                  clearSavedWorkoutCheckpoint();
                  navigate(`/active-workout/${selectedWorkoutPreview.id}`);
                }}
                disabled={!selectedWorkoutPreview || previewLoading}
                className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-black py-4 px-5 rounded-full flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <PlayCircle size={20} className="mr-2" />
                Start Workout
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNavigation hidden={Boolean(selectedWorkout)} />
    </div>
  );
};

export default SelectWorkoutPage;
