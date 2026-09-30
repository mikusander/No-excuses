import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayCircle, Clock, Timer, Repeat, X, Loader2, Pencil, Flame, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import { saveExercisesToDb, type SaveExercise } from '../lib/workoutSaveHelper';
import {
  clearAllWorkoutProgressCheckpoints,
  getValidWorkoutProgressCheckpoints,
  subscribeToWorkoutProgress,
  type WorkoutProgressCheckpointMeta,
} from '../lib/workoutProgressStorage';
import { hapticLight, hapticMedium } from '../utils/haptics';

export interface PreviewExercise {
  id: string;
  type: 'reps' | 'isometry' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid';
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
    type: 'reps' | 'isometry' | 'cardio';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
}

export interface PreviewWorkoutData {
  id: string;
  name: string;
  created_at: string;
  exercises: PreviewExercise[];
}

interface WorkoutPreviewModalProps {
  workoutId: string | number;
  initialWorkoutName?: string;
  initialWorkoutCreatedAt?: string;
  onClose: () => void;
  onStarted?: () => void;
}

const parseTaggedNote = (rawNote: string) => {
  const match = /^\[(.*?)\]\s*(.*)$/.exec(rawNote.trim());
  if (!match) return null;

  const tag = match[1].trim();
  const text = match[2].trim();

  const orderMatch = /^(\d+)\.\s*(.*)$/.exec(tag);
  if (orderMatch) {
    return {
      orderIndex: parseInt(orderMatch[1], 10) - 1,
      exerciseName: orderMatch[2].trim(),
      text,
    };
  }

  return {
    orderIndex: null,
    exerciseName: tag,
    text,
  };
};

const normalizeNoteKey = (name: string) => name.toLowerCase().trim();

const parseNumericInput = (raw: string, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
};

const parseWeightInput = (raw: string): number | null => {
  if (raw.trim() === '' || raw.trim() === '0') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

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

const WorkoutPreviewModal: React.FC<WorkoutPreviewModalProps> = ({
  workoutId,
  initialWorkoutName,
  initialWorkoutCreatedAt,
  onClose,
  onStarted,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [workoutPreview, setWorkoutPreview] = useState<PreviewWorkoutData | null>(null);
  const [editableExercises, setEditableExercises] = useState<PreviewExercise[]>([]);
  const [latestExerciseNotes, setLatestExerciseNotes] = useState<Record<string, string>>({});
  const [isSavingAndStarting, setIsSavingAndStarting] = useState(false);
  const [activeCheckpoints, setActiveCheckpoints] = useState<WorkoutProgressCheckpointMeta[]>([]);

  const initialExercisesJsonRef = useRef<string>('');

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

  const isWorkoutActive = useCallback((schedaIdStr?: string | number | null) => {
    if (schedaIdStr == null) return false;
    const numId = Number(schedaIdStr);
    if (!Number.isFinite(numId)) return false;
    return activeCheckpoints.some((cp) => cp.identity.type === 'scheda' && cp.identity.id === numId);
  }, [activeCheckpoints]);

  useEffect(() => {
    let isCancelled = false;

    const loadData = async () => {
      try {
        setPreviewLoading(true);
        setPreviewError(null);

        const numId = Number(workoutId);
        if (!Number.isFinite(numId)) {
          setPreviewError('ID scheda non valido.');
          setPreviewLoading(false);
          return;
        }

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
          .eq('id_scheda', numId)
          .maybeSingle();

        if (isCancelled) return;
        if (error) throw error;

        if (!data) {
          setPreviewError('Scheda non trovata.');
          setWorkoutPreview({
            id: String(numId),
            name: initialWorkoutName || 'Scheda',
            created_at: initialWorkoutCreatedAt || new Date().toISOString(),
            exercises: [],
          });
          return;
        }

        const parsedExercises = parseDbExerciseRows(data.esecuzioni || []) as PreviewExercise[];
        initialExercisesJsonRef.current = JSON.stringify(parsedExercises);

        setWorkoutPreview({
          id: String(data.id_scheda),
          name: String(data.nome || initialWorkoutName || 'Scheda'),
          created_at: String(data.data_creazione || initialWorkoutCreatedAt || new Date().toISOString()),
          exercises: parsedExercises,
        });
        setEditableExercises(JSON.parse(JSON.stringify(parsedExercises)));

        if (user?.id) {
          const { data: runsData } = await supabase
            .from('workout_run')
            .select('data_esecuzione, note_workout!inner(testo)')
            .eq('id_utente', user.id)
            .eq('id_scheda', numId)
            .order('data_esecuzione', { ascending: false })
            .limit(1);

          if (isCancelled) return;

          const notesMap: Record<string, string> = {};
          if (runsData && runsData.length > 0) {
            const lastRun = runsData[0];
            const notes = Array.isArray(lastRun.note_workout) ? lastRun.note_workout : [lastRun.note_workout];
            for (const noteRow of notes) {
              if (!noteRow) continue;
              const parsed = parseTaggedNote(String(noteRow.testo || ''));
              if (parsed?.exerciseName && parsed?.text) {
                if (parsed.orderIndex !== null) {
                  const key = `${parsed.orderIndex}_${normalizeNoteKey(parsed.exerciseName)}`;
                  if (!notesMap[key]) {
                    notesMap[key] = parsed.text;
                  }
                } else {
                  const key = `legacy_${normalizeNoteKey(parsed.exerciseName)}`;
                  if (!notesMap[key]) {
                    notesMap[key] = parsed.text;
                  }
                }
              }
            }
          }
          setLatestExerciseNotes(notesMap);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Error fetching workout preview modal data:', err);
          setPreviewError(err?.message || 'Impossibile caricare i dati della scheda.');
        }
      } finally {
        if (!isCancelled) {
          setPreviewLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isCancelled = true;
    };
  }, [workoutId, initialWorkoutName, initialWorkoutCreatedAt, user?.id]);

  const updateExerciseField = (index: number, field: keyof PreviewExercise, value: any) => {
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

  const handleSaveAndStart = async () => {
    if (!workoutPreview || isSavingAndStarting) return;
    const schedaId = Number(workoutPreview.id);
    if (!Number.isFinite(schedaId)) return;

    try {
      setIsSavingAndStarting(true);
      void hapticMedium();

      const hasChanged = JSON.stringify(editableExercises) !== initialExercisesJsonRef.current;
      if (hasChanged) {
        await saveExercisesToDb(schedaId, editableExercises as SaveExercise[]);
      }

      const currentCheckpoints = user?.id ? getValidWorkoutProgressCheckpoints(user.id) : [];
      const isCurrentSchedaActive = currentCheckpoints.some(
        (cp) => cp.identity.type === 'scheda' && cp.identity.id === schedaId
      );
      if (!isCurrentSchedaActive && user?.id) {
        clearAllWorkoutProgressCheckpoints(user.id);
      }

      onStarted?.();
      onClose();
      navigate(`/active-workout/${workoutPreview.id}`);
    } catch (err: any) {
      console.error('Error saving workout before start:', err);
      setPreviewError(err?.message || 'Errore durante il salvataggio.');
      setIsSavingAndStarting(false);
    }
  };

  const currentWorkoutId = workoutPreview?.id || String(workoutId);
  const currentWorkoutName = workoutPreview?.name || initialWorkoutName || 'Scheda';
  const isActive = isWorkoutActive(currentWorkoutId);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-5 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl shadow-2xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-2xl font-black text-white leading-tight break-words">
                {currentWorkoutName}
              </h3>
              {isActive && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-orange bg-brand-orange/15 border border-brand-orange/30 px-2.5 py-0.5 rounded-full">
                  <Flame size={12} className="animate-pulse fill-current" />
                  In corso
                </span>
              )}
            </div>
            {isActive ? (
              <p className="text-xs text-brand-orange font-bold mt-1 flex items-center gap-1.5">
                <Flame size={12} className="shrink-0" />
                Allenamento sospeso: puoi modificare i parametri e riprendere senza perdere i tuoi progressi
              </p>
            ) : (
              <p className="text-xs text-brand-grey/70 font-semibold mt-1 flex items-center">
                <Pencil size={10} className="mr-1 text-brand-orange" />
                Tocca i valori per modificarli prima di iniziare
              </p>
            )}
          </div>

          <button
            onClick={() => {
              void hapticLight();
              onClose();
            }}
            className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors shrink-0"
            title="Chiudi anteprima"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
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
                    (ex.type === 'superset' || ex.type === 'circuit' || ex.type === 'emom') &&
                    (ex.subExercises?.length || 0) > 1;

                  const noteKey = `${i}_${normalizeNoteKey(ex.name)}`;
                  const noteLegacyKey = `legacy_${normalizeNoteKey(ex.name)}`;
                  const latestNote = latestExerciseNotes[noteKey] || latestExerciseNotes[noteLegacyKey];

                  return (
                    <div key={ex.id || i} className="flex flex-col bg-black/40 px-5 py-4 rounded-2xl border border-white/5">
                      {ex.type === 'superset' || ex.type === 'circuit' || ex.type === 'emom' || ex.type === 'pyramid' ? (
                        <div className="mb-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="font-bold text-lg text-white drop-shadow-md flex items-center min-w-0">
                              <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i + 1}.</span>
                              <Repeat size={16} className="mr-1 shrink-0 text-brand-orange" />
                              <span className="truncate">{ex.name}</span>
                            </span>
                            {ex.type === 'circuit' && (
                              <span className="shrink-0 inline-flex items-center rounded-full border border-brand-orange/60 bg-brand-orange/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-brand-orange">
                                CIRCUITO
                              </span>
                            )}
                            {ex.type === 'superset' && (
                              <span className="shrink-0 inline-flex items-center rounded-full border border-brand-orange/60 bg-brand-orange/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-brand-orange">
                                SUPERSET
                              </span>
                            )}
                            {ex.type === 'emom' && (
                              <span className="shrink-0 inline-flex items-center rounded-full border border-brand-orange/60 bg-brand-orange/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-brand-orange">
                                EMOM
                              </span>
                            )}
                            {ex.type === 'pyramid' && (
                              <span className="shrink-0 inline-flex items-center rounded-full border border-brand-orange/60 bg-brand-orange/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-brand-orange">
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
                                  const subNoteKey = `${i}_${normalizeNoteKey(sub.name)}`;
                                  const subNoteLegacyKey = `legacy_${normalizeNoteKey(sub.name)}`;
                                  const subNote = latestExerciseNotes[subNoteKey] || latestExerciseNotes[subNoteLegacyKey];

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
                            {ex.type === 'cardio' ? (
                              <Activity size={12} className="mr-1 text-rose-400" />
                            ) : ex.type === 'isometry' ? (
                              <Timer size={12} className="mr-1 text-brand-orange" />
                            ) : (
                              <Repeat size={12} className="mr-1 text-brand-orange" />
                            )}
                            {ex.type === 'cardio' ? 'CARDIO' : ex.type === 'isometry' ? 'ISOMETRIC' : 'REPS'}
                          </div>
                        </div>
                      )}

                      <div
                        className={`grid ${
                          ex.type === 'pyramid'
                            ? 'grid-cols-1'
                            : ex.type === 'superset' || ex.type === 'circuit'
                            ? 'grid-cols-2'
                            : ex.type === 'emom'
                            ? 'grid-cols-2 sm:grid-cols-4'
                            : showInlineWeightNearName
                            ? 'grid-cols-2 min-[450px]:grid-cols-3'
                            : 'grid-cols-2 min-[450px]:grid-cols-4'
                        } gap-2 text-xs text-brand-grey font-bold w-full mt-2`}
                      >
                        {ex.type === 'pyramid' ? (
                          <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                            <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Steps</span>
                            <span className="text-sm text-white">{ex.pyramid_steps?.length || 0}</span>
                          </div>
                        ) : (
                          <InlineNumberInput
                            label={
                              ex.type === 'circuit'
                                ? 'Giri'
                                : ex.type === 'superset'
                                ? 'Round'
                                : ex.type === 'emom'
                                ? 'Sets'
                                : 'Sets'
                            }
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

                        {ex.type !== 'superset' &&
                          ex.type !== 'circuit' &&
                          ex.type !== 'pyramid' &&
                          ex.type !== 'emom' && (
                            <InlineNumberInput
                              label={(ex.type === 'isometry' || ex.type === 'cardio') ? 'Duration (s)' : 'Reps'}
                              value={(ex.type === 'isometry' || ex.type === 'cardio') ? ex.duration_seconds : ex.reps}
                              onChange={(v) =>
                                updateExerciseField(i, (ex.type === 'isometry' || ex.type === 'cardio') ? 'duration_seconds' : 'reps', v)
                              }
                              placeholder={(ex.type === 'isometry' || ex.type === 'cardio') ? 'MAX' : 'MAX'}
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
                              onChange={(e) =>
                                updateExerciseField(i, 'rest_seconds', parseNumericInput(e.target.value, 0))
                              }
                              placeholder="0"
                              className="w-full bg-transparent text-sm text-brand-lightOrange text-center outline-none font-bold"
                            />
                          </div>
                        )}

                        {!showInlineWeightNearName &&
                          ex.type !== 'superset' &&
                          ex.type !== 'circuit' &&
                          ex.type !== 'emom' &&
                          ex.type !== 'pyramid' && (
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

                      {latestNote && (
                        <div className="mt-4 px-4 py-3 bg-black/40 rounded-xl border border-white/5 relative">
                          <div className="absolute -top-2 left-4 bg-brand-dark px-2">
                            <span className="text-[9px] uppercase tracking-widest font-bold text-brand-grey/80 flex items-center gap-1">
                              <Pencil size={10} />
                              Last time you wrote
                            </span>
                          </div>
                          <span className="text-sm text-brand-grey italic">"{latestNote}"</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {editableExercises.length === 0 && !previewError && (
                  <p className="text-sm text-brand-grey/50 italic text-center py-4 bg-black/20 rounded-2xl">
                    Nessun esercizio presente in questa scheda.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer CTA */}
        <div className="p-5 border-t border-white/10 shrink-0">
          <button
            onClick={() => void handleSaveAndStart()}
            disabled={editableExercises.length === 0 || previewLoading || isSavingAndStarting}
            className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-black py-4 px-5 rounded-full flex items-center justify-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-brand-orange/20 active:scale-[0.98]"
          >
            {isSavingAndStarting ? (
              <>
                <Loader2 size={20} className="mr-2 animate-spin" />
                {isActive ? 'Salvataggio e ripresa in corso...' : 'Salvataggio e avvio in corso...'}
              </>
            ) : isActive ? (
              <>
                <PlayCircle size={20} className="mr-2 fill-current" />
                Salva modifiche e Riprendi
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
  );
};

export default React.memo(WorkoutPreviewModal);
