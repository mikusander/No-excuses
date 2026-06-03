import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, ArrowLeft, PlayCircle, Clock, Timer, Repeat, X, Loader2, Pencil } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate } from 'react-router-dom';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import { clearAllWorkoutProgressCheckpoints } from '../lib/workoutProgressStorage';
import { saveExercisesToDb, type SaveExercise } from '../lib/workoutSaveHelper';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
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
    instruction_note?: string;
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

const parseTaggedNote = (rawNote: string) => {
  const match = /^\[(.*?)\]\s*(.*)$/.exec(rawNote.trim());
  if (!match) return null;
  return {
    exerciseName: match[1].trim(),
    text: match[2].trim(),
  };
};

const normalizeNoteKey = (name: string) => name.toLowerCase().trim();

const SelectWorkoutPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [selectedWorkoutPreview, setSelectedWorkoutPreview] = useState<WorkoutPreview | null>(null);
  const [latestExerciseNotes, setLatestExerciseNotes] = useState<Record<string, string>>({});
  const [editableExercises, setEditableExercises] = useState<Exercise[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isSavingAndStarting, setIsSavingAndStarting] = useState(false);

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
    setSelectedWorkoutPreview(null);
    setLatestExerciseNotes({});
    setEditableExercises([]);
    setPreviewLoading(false);
    setPreviewError(null);
    setIsSavingAndStarting(false);
  };

  const clearSavedWorkoutCheckpoint = () => {
    if (!user?.id) return;
    clearAllWorkoutProgressCheckpoints(user.id);
  };

  // --- Editable exercise helpers ---

  const updateExerciseField = (index: number, field: keyof Exercise, value: any) => {
    setEditableExercises((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const updateSubExerciseField = (exIndex: number, subIndex: number, field: string, value: any) => {
    setEditableExercises((prev) => {
      const next = [...prev];
      const ex = { ...next[exIndex] };
      if (ex.subExercises) {
        const newSubs = [...ex.subExercises];
        newSubs[subIndex] = { ...newSubs[subIndex], [field]: value };
        ex.subExercises = newSubs;
      }
      next[exIndex] = ex;
      return next;
    });
  };

  const updatePyramidStepField = (exIndex: number, stepIndex: number, field: string, value: any) => {
    setEditableExercises((prev) => {
      const next = [...prev];
      const ex = { ...next[exIndex] };
      if (ex.pyramid_steps) {
        const newSteps = [...ex.pyramid_steps];
        newSteps[stepIndex] = { ...newSteps[stepIndex], [field]: value };
        ex.pyramid_steps = newSteps;
      }
      next[exIndex] = ex;
      return next;
    });
  };

  const parseNumericInput = (raw: string, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
  };

  const parseWeightInput = (raw: string): number | null => {
    if (raw.trim() === '' || raw.trim() === '0') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  // --- Data fetching ---

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
            rest_tra_esercizi,
            peso_kg,
            note_esercizio,
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
      setEditableExercises(JSON.parse(JSON.stringify(parsedExercises)));

      if (user?.id) {
        const { data: runsData } = await supabase
          .from('workout_run')
          .select('data_esecuzione, note_workout!inner(testo)')
          .eq('id_utente', user.id)
          .order('data_esecuzione', { ascending: false });

        const notesMap: Record<string, string> = {};
        if (runsData) {
          for (const run of runsData) {
            const notes = Array.isArray(run.note_workout) ? run.note_workout : [run.note_workout];
            for (const noteRow of notes) {
              if (!noteRow) continue;
              const parsed = parseTaggedNote(String(noteRow.testo || ''));
              if (parsed?.exerciseName && parsed?.text) {
                const key = normalizeNoteKey(parsed.exerciseName);
                if (!notesMap[key]) {
                  notesMap[key] = parsed.text;
                }
              }
            }
          }
        }
        setLatestExerciseNotes(notesMap);
      }
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

  const handleSaveAndStart = async () => {
    if (!selectedWorkoutPreview || isSavingAndStarting) return;
    const schedaId = Number(selectedWorkoutPreview.id);
    if (Number.isNaN(schedaId)) return;

    try {
      setIsSavingAndStarting(true);
      await saveExercisesToDb(schedaId, editableExercises as SaveExercise[]);
      clearSavedWorkoutCheckpoint();
      navigate(`/active-workout/${selectedWorkoutPreview.id}`);
    } catch (err: any) {
      console.error('Error saving workout before start:', err);
      setPreviewError(err.message || 'Error saving changes.');
      setIsSavingAndStarting(false);
    }
  };

  // --- Inline input component ---

  const InlineNumberInput: React.FC<{
    label: string;
    value: number;
    onChange: (v: number) => void;
    placeholder?: string;
    isWeight?: boolean;
    weightValue?: number | null;
    onWeightChange?: (v: number | null) => void;
  }> = ({ label, value, onChange, placeholder, isWeight, weightValue, onWeightChange }) => {
    if (isWeight && onWeightChange) {
      return (
        <div className="flex-1 bg-white/5 py-2 px-2 rounded-lg text-center flex flex-col justify-center border border-white/10">
          <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">{label}</span>
          <input
            type="text"
            inputMode="decimal"
            value={weightValue != null && weightValue > 0 ? String(weightValue) : ''}
            onChange={(e) => onWeightChange(parseWeightInput(e.target.value))}
            placeholder="BW"
            className="w-full bg-transparent text-sm text-brand-lightOrange text-center outline-none font-bold"
          />
        </div>
      );
    }
    return (
      <div className="flex-1 bg-white/5 py-2 px-2 rounded-lg text-center flex flex-col justify-center border border-white/10">
        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">{label}</span>
        <input
          type="text"
          inputMode="numeric"
          value={value > 0 ? String(value) : ''}
          onChange={(e) => onChange(parseNumericInput(e.target.value, 0))}
          placeholder={placeholder || '0'}
          className="w-full bg-transparent text-sm text-brand-orange text-center outline-none font-bold"
        />
      </div>
    );
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
                <p className="text-xs text-brand-grey/70 font-semibold mt-1 flex items-center">
                  <Pencil size={10} className="mr-1 text-brand-orange" />
                  Tap values to edit before starting
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
                    {editableExercises.map((ex, i) => {
                      const showInlineWeightNearName =
                        (ex.type === 'superset' || ex.type === 'emom') && (ex.subExercises?.length || 0) > 1;

                      return (
                        <div key={ex.id || i} className="flex flex-col bg-black/40 px-5 py-4 rounded-2xl border border-white/5">
                          {ex.type === 'superset' || ex.type === 'emom' || ex.type === 'pyramid' ? (
                            <div className="mb-3">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className="font-bold text-lg text-white drop-shadow-md flex items-center min-w-0">
                                  <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i + 1}.</span>
                                  <Repeat size={16} className="mr-1 text-brand-orange shrink-0" />
                                  <span className="truncate">{ex.name}</span>
                                </span>
                                {ex.type === 'pyramid' && (
                                  <span className="shrink-0 inline-flex items-center rounded-full border border-amber-300/60 bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-300">
                                    PYRAMID
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col pl-6 border-l-2 border-white/10 space-y-2 mt-1">
                                {ex.type === 'pyramid'
                                  ? ex.pyramid_steps?.map((step, sIdx) => (
                                    <div key={sIdx} className="bg-black/20 rounded-xl p-3 space-y-2">
                                      <p className="text-xs font-bold text-brand-grey uppercase">Step {sIdx + 1}</p>
                                      <div className="grid grid-cols-3 gap-2">
                                        <InlineNumberInput
                                          label="Reps"
                                          value={step.reps}
                                          onChange={(v) => updatePyramidStepField(i, sIdx, 'reps', v)}
                                          placeholder="MAX"
                                        />
                                        <InlineNumberInput
                                          label="Rest (s)"
                                          value={step.rest_seconds}
                                          onChange={(v) => updatePyramidStepField(i, sIdx, 'rest_seconds', v)}
                                        />
                                        <InlineNumberInput
                                          label="Kg"
                                          value={0}
                                          onChange={() => {}}
                                          isWeight
                                          weightValue={step.weight_kg}
                                          onWeightChange={(v) => updatePyramidStepField(i, sIdx, 'weight_kg', v)}
                                        />
                                      </div>
                                    </div>
                                  ))
                                  : ex.subExercises?.map((sub, sIdx) => {
                                      const subNote = latestExerciseNotes[normalizeNoteKey(sub.name)];
                                      return (
                                        <div key={sIdx} className="bg-black/20 rounded-xl p-3 space-y-2">
                                          <p className="text-xs font-bold text-white">{sub.name}</p>
                                          <div className="grid grid-cols-2 gap-2">
                                            {sub.type === 'reps' ? (
                                              <InlineNumberInput
                                                label="Reps"
                                                value={sub.reps}
                                                onChange={(v) => updateSubExerciseField(i, sIdx, 'reps', v)}
                                                placeholder="MAX"
                                              />
                                            ) : (
                                              <InlineNumberInput
                                                label="Time (s)"
                                                value={sub.duration_seconds}
                                                onChange={(v) => updateSubExerciseField(i, sIdx, 'duration_seconds', v)}
                                              />
                                            )}
                                            <InlineNumberInput
                                              label="Kg"
                                              value={0}
                                              onChange={() => {}}
                                              isWeight
                                              weightValue={sub.weight_kg}
                                              onWeightChange={(v) => updateSubExerciseField(i, sIdx, 'weight_kg', v)}
                                            />
                                          </div>
                                          {subNote && (
                                            <div className="text-xs text-brand-grey italic pl-2 border-l border-brand-orange/30">
                                              "{subNote}"
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
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

                          <div className={`grid ${
                            ex.type === 'pyramid' ? 'grid-cols-1' :
                            ex.type === 'superset' ? 'grid-cols-2' :
                            ex.type === 'emom' ? 'grid-cols-2 sm:grid-cols-4' :
                            showInlineWeightNearName ? 'grid-cols-2 min-[450px]:grid-cols-3' :
                            'grid-cols-2 min-[450px]:grid-cols-4'
                          } gap-2 text-xs text-brand-grey font-bold w-full mt-2`}>

                            {ex.type === 'pyramid' ? (
                              <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                                <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Steps</span>
                                <span className="text-sm text-white">{ex.pyramid_steps?.length || 0}</span>
                              </div>
                            ) : (
                              <InlineNumberInput
                                label={ex.type === 'superset' ? 'Round' : ex.type === 'emom' ? 'Sets' : 'Sets'}
                                value={ex.sets}
                                onChange={(v) => updateExerciseField(i, 'sets', Math.max(1, v))}
                              />
                            )}

                            {ex.type === 'emom' && (
                              <>
                                <InlineNumberInput
                                  label="Rounds"
                                  value={ex.emom_rounds || 1}
                                  onChange={(v) => updateExerciseField(i, 'emom_rounds', Math.max(1, v))}
                                />
                                <InlineNumberInput
                                  label="Time/Rnd (s)"
                                  value={ex.emom_round_duration || ex.duration_seconds}
                                  onChange={(v) => {
                                    updateExerciseField(i, 'emom_round_duration', Math.max(1, v));
                                    updateExerciseField(i, 'duration_seconds', Math.max(1, v));
                                  }}
                                />
                              </>
                            )}

                            {ex.type !== 'superset' && ex.type !== 'pyramid' && ex.type !== 'emom' && (
                              <InlineNumberInput
                                label={ex.type === 'isometry' ? 'Duration (s)' : 'Reps'}
                                value={ex.type === 'isometry' ? ex.duration_seconds : ex.reps}
                                onChange={(v) => updateExerciseField(i, ex.type === 'isometry' ? 'duration_seconds' : 'reps', v)}
                                placeholder={ex.type === 'isometry' ? 'MAX' : 'MAX'}
                              />
                            )}

                            {ex.type !== 'pyramid' && (
                              <div className="flex-1 bg-brand-orange/10 border border-brand-orange/20 py-2 px-2 rounded-lg text-center flex flex-col justify-center">
                                <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                                  <Clock size={9} className="mr-1" /> Rest (s)
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={ex.rest_seconds > 0 ? String(ex.rest_seconds) : ''}
                                  onChange={(e) => updateExerciseField(i, 'rest_seconds', parseNumericInput(e.target.value, 0))}
                                  placeholder="0"
                                  className="w-full bg-transparent text-sm text-brand-lightOrange text-center outline-none font-bold"
                                />
                              </div>
                            )}

                            {!showInlineWeightNearName && ex.type !== 'superset' && ex.type !== 'emom' && ex.type !== 'pyramid' && (
                              <InlineNumberInput
                                label="Kg"
                                value={0}
                                onChange={() => {}}
                                isWeight
                                weightValue={ex.weight_kg}
                                onWeightChange={(v) => updateExerciseField(i, 'weight_kg', v)}
                              />
                            )}
                          </div>

                          {latestExerciseNotes[normalizeNoteKey(ex.name)] && (
                            <div className="mt-3 bg-brand-darkGrey/30 p-3 rounded-xl border border-white/5">
                              <span className="text-xs font-bold text-brand-orange uppercase block mb-1">Note:</span>
                              <span className="text-sm text-brand-grey italic">"{latestExerciseNotes[normalizeNoteKey(ex.name)]}"</span>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {editableExercises.length === 0 && !previewError && (
                      <p className="text-sm text-brand-grey/50 italic text-center py-4 bg-black/20 rounded-2xl">No exercises in this workout.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-5 border-t border-white/10">
              <button
                onClick={() => void handleSaveAndStart()}
                disabled={editableExercises.length === 0 || previewLoading || isSavingAndStarting}
                className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-black py-4 px-5 rounded-full flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingAndStarting ? (
                  <>
                    <Loader2 size={20} className="mr-2 animate-spin" />
                    Saving & Starting...
                  </>
                ) : (
                  <>
                    <PlayCircle size={20} className="mr-2" />
                    Start Workout
                  </>
                )}
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
