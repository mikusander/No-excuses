import React, { useState, useEffect, memo } from 'react';
import {
  X,
  CheckCircle2,
  Timer,
  Clock,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Check,
  Flame,
  SlidersHorizontal,
} from 'lucide-react';
import type { Exercise, Workout } from './types';
import { hapticLight } from '../../utils/haptics';

export interface WorkoutOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  workout: Workout;
  currentExerciseIdx: number;
  currentSubExerciseIdx: number;
  currentPyramidStepIdx: number;
  currentSetIdx: number;
  currentEmomRoundIdx: number;
  isResting: boolean;
  pendingPyramidAdvance: boolean;
  pendingExerciseAdvance: boolean;
  isometryRemaining: number;
  getCurrentWorkoutElapsedSeconds: () => number;
  workoutGeneralNote: string;
  onSaveGeneralNote: (note: string) => void;
  onUpdateTransitionRest: (exerciseIndex: number, newSeconds: number) => void;
  onOpenExerciseNote: (exerciseIndex: number) => void;
  onOpenEditExercise: (exerciseIndex: number) => void;
  getExerciseNoteEntry: (index: number, exercise: Exercise) => { note?: string } | undefined;
}

const formatTime = (secs: number) => {
  const normalized = Math.max(0, Math.trunc(Number(secs) || 0));
  const m = Math.floor(normalized / 60);
  const s = normalized % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const isMaxTarget = (val: unknown): boolean => {
  if (val === 0 || val === '0' || val === -1 || val === '-1') return true;
  if (typeof val === 'string' && val.trim().toLowerCase() === 'max') return true;
  return false;
};

const toSafeTargetInt = (val: unknown): number => {
  const n = Math.trunc(Number(val));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const getEffectiveEmomRounds = (ex?: Exercise | null): number => {
  if (!ex) return 1;
  const rawRounds = ex.emom_rounds != null && ex.emom_rounds > 0
    ? ex.emom_rounds
    : (ex.sets != null && ex.sets > 0 ? ex.sets : 1);
  return Math.max(1, rawRounds);
};

const formatWeightLabel = (weight?: number | null) => {
  const n = Number(weight);
  if (!Number.isFinite(n) || n <= 0) return 'Body Weight';
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`;
};

const formatSupersetTaskMetricLabel = (sub: { type: 'reps' | 'isometry' | 'cardio'; reps: number; duration_seconds: number }) => {
  if (sub.type === 'reps') {
    return isMaxTarget(sub.reps) ? 'MAX reps' : `${toSafeTargetInt(sub.reps)} reps`;
  }
  return isMaxTarget(sub.duration_seconds) ? 'MAX hold' : `${toSafeTargetInt(sub.duration_seconds)}s hold`;
};

const formatEmomTaskMetricLabel = (sub: { type: 'reps' | 'isometry' | 'cardio'; reps: number; duration_seconds: number }) => {
  if (sub.type === 'reps') {
    return isMaxTarget(sub.reps) ? 'MAX REPS' : `${toSafeTargetInt(sub.reps)} REPS`;
  }
  return isMaxTarget(sub.duration_seconds) ? 'MAX' : `${toSafeTargetInt(sub.duration_seconds)}s`;
};

const getWorkoutOverviewTypeLabel = (exercise: Exercise) => {
  if (exercise.type === 'circuit') return 'CIRCUIT MODE';
  if (exercise.type === 'emom') return 'EMOM MODE';
  if (exercise.type === 'superset') return 'SUPERSET MODE';
  if (exercise.type === 'pyramid') return 'PYRAMID MODE';
  if (exercise.type === 'cardio') return 'CARDIO';
  if (exercise.type === 'isometry') return 'ISOMETRY';
  return 'REPS';
};

const getWorkoutOverviewDisplayLabel = (exercise: Exercise) => {
  if (
    (exercise.type === 'superset' || exercise.type === 'circuit' || exercise.type === 'emom') &&
    exercise.subExercises &&
    exercise.subExercises.length === 1
  ) {
    return exercise.subExercises[0].name || getWorkoutOverviewTypeLabel(exercise);
  }
  return getWorkoutOverviewTypeLabel(exercise);
};

const getWorkoutOverviewSummary = (exercise: Exercise) => {
  if (exercise.type === 'circuit') {
    return [
      `${exercise.sets || 1} giri`,
      `${exercise.subExercises?.length || 0} stazioni`,
      `${formatTime(exercise.rest_seconds || 0)} rest`,
    ];
  }
  if (exercise.type === 'emom') {
    return [
      `${exercise.sets || 1} sets`,
      `${getEffectiveEmomRounds(exercise)} rounds`,
      `${formatTime(exercise.emom_round_duration || 60)} per round`,
    ];
  }
  if (exercise.type === 'superset') {
    return [
      `${exercise.sets || 1} rounds`,
      `${exercise.subExercises?.length || 0} exercises`,
      `${formatTime(exercise.rest_seconds || 0)} rest`,
    ];
  }
  if (exercise.type === 'pyramid') {
    return [
      `${exercise.pyramid_steps?.length || 0} steps`,
      exercise.instruction_note ? 'Has notes' : 'No notes',
      formatWeightLabel(exercise.weight_kg),
    ];
  }
  if (exercise.type === 'isometry' || exercise.type === 'cardio') {
    return [
      `${exercise.sets || 1} sets`,
      `${isMaxTarget(exercise.duration_seconds) ? 'MAX' : formatTime(exercise.duration_seconds)}`,
      formatWeightLabel(exercise.weight_kg),
    ];
  }
  return [
    `${exercise.sets || 1} sets`,
    `${isMaxTarget(exercise.reps) ? 'MAX reps' : `${exercise.reps || 0} reps`}`,
    `${formatTime(exercise.rest_seconds || 0)} rest`,
    formatWeightLabel(exercise.weight_kg),
  ];
};

const WorkoutOverviewTimerBadge: React.FC<{ getElapsed: () => number }> = ({ getElapsed }) => {
  const [elapsed, setElapsed] = useState(() => getElapsed());

  useEffect(() => {
    setElapsed(getElapsed());
    const interval = setInterval(() => {
      setElapsed(getElapsed());
    }, 1000);
    return () => clearInterval(interval);
  }, [getElapsed]);

  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-orange bg-brand-orange/15 border border-brand-orange/30 px-2.5 py-0.5 rounded-full tabular-nums">
      <Clock size={12} />
      {formatTime(elapsed)}
    </span>
  );
};

export const WorkoutOverviewModal: React.FC<WorkoutOverviewModalProps> = memo(({
  isOpen,
  onClose,
  workout,
  currentExerciseIdx,
  currentSubExerciseIdx,
  currentPyramidStepIdx,
  currentSetIdx,
  currentEmomRoundIdx,
  isResting,
  pendingPyramidAdvance,
  pendingExerciseAdvance,
  isometryRemaining,
  getCurrentWorkoutElapsedSeconds,
  workoutGeneralNote,
  onSaveGeneralNote,
  onUpdateTransitionRest,
  onOpenExerciseNote,
  onOpenEditExercise,
  getExerciseNoteEntry,
}) => {
  const [editingTransitionIdx, setEditingTransitionIdx] = useState<number | null>(null);
  const [transitionDraftMinutes, setTransitionDraftMinutes] = useState<string>('0');
  const [transitionDraftSeconds, setTransitionDraftSeconds] = useState<string>('0');
  const [isEditingGeneralNote, setIsEditingGeneralNote] = useState<boolean>(false);
  const [generalNoteDraft, setGeneralNoteDraft] = useState<string>('');

  if (!isOpen) return null;

  const calculateExerciseProgress = (
    exercise: (typeof workout.exercises)[number],
    exerciseIndex: number
  ) => {
    if (exerciseIndex < currentExerciseIdx) {
      return {
        progressPct: 100,
        completedUnits: 1,
        totalUnits: 1,
        label: 'Completato',
      };
    }

    if (exerciseIndex > currentExerciseIdx) {
      const total = exercise.type === 'pyramid'
        ? (exercise.pyramid_steps?.length || 1)
        : (exercise.sets || 1);
      return {
        progressPct: 0,
        completedUnits: 0,
        totalUnits: total,
        label: 'In attesa',
      };
    }

    if (isResting && pendingExerciseAdvance) {
      const total = exercise.sets || 1;
      return {
        progressPct: 100,
        completedUnits: total,
        totalUnits: total,
        label: 'Tutti i set completati',
      };
    }

    if (exercise.type === 'pyramid') {
      const steps = exercise.pyramid_steps || [];
      const totalSteps = Math.max(1, steps.length);
      const completedSteps = pendingPyramidAdvance
        ? Math.min(totalSteps, currentPyramidStepIdx + 1)
        : Math.min(totalSteps, currentPyramidStepIdx);
      const pct = Math.round((completedSteps / totalSteps) * 100);
      const stepLabel = pendingPyramidAdvance
        ? `Step ${completedSteps} di ${totalSteps} completati · Recupero`
        : `Step ${currentPyramidStepIdx + 1} di ${totalSteps} in corso`;

      return {
        progressPct: Math.min(100, Math.max(0, pct)),
        completedUnits: completedSteps,
        totalUnits: totalSteps,
        label: stepLabel,
      };
    }

    if (exercise.type === 'emom') {
      const totalSets = Math.max(1, exercise.sets || 1);
      const effRounds = Math.max(1, getEffectiveEmomRounds(exercise));
      const totalUnits = totalSets * effRounds;

      let completedUnits = currentSetIdx * effRounds + currentEmomRoundIdx;
      if (isResting && !pendingExerciseAdvance) {
        completedUnits = (currentSetIdx + 1) * effRounds;
      }
      completedUnits = Math.min(totalUnits, Math.max(0, completedUnits));
      const pct = Math.round((completedUnits / totalUnits) * 100);
      const emomLabel = isResting
        ? `Set ${currentSetIdx + 1} completato · Recupero`
        : totalSets > 1
          ? `Set ${currentSetIdx + 1} · Round ${currentEmomRoundIdx + 1} di ${effRounds}`
          : `Round ${currentEmomRoundIdx + 1} di ${effRounds} in corso`;

      return {
        progressPct: Math.min(100, Math.max(0, pct)),
        completedUnits,
        totalUnits,
        label: emomLabel,
      };
    }

    if (exercise.type === 'superset' || exercise.type === 'circuit') {
      const totalRounds = Math.max(1, exercise.sets || 1);
      const subCount = Math.max(1, exercise.subExercises?.length || 1);
      const totalUnits = totalRounds * subCount;

      let completedUnits = currentSetIdx * subCount + currentSubExerciseIdx;
      if (isResting && !pendingExerciseAdvance) {
        completedUnits = (currentSetIdx + 1) * subCount;
      }
      completedUnits = Math.min(totalUnits, Math.max(0, completedUnits));
      const pct = Math.round((completedUnits / totalUnits) * 100);
      const typeLabel = exercise.type === 'circuit' ? 'Giro' : 'Round';
      const groupLabel = isResting
        ? `${typeLabel} ${currentSetIdx + 1} completato · Recupero`
        : `${typeLabel} ${currentSetIdx + 1} di ${totalRounds} · Stazione ${currentSubExerciseIdx + 1} di ${subCount}`;

      return {
        progressPct: Math.min(100, Math.max(0, pct)),
        completedUnits,
        totalUnits,
        label: groupLabel,
      };
    }

    // Standard reps / isometry / cardio
    const totalSets = Math.max(1, exercise.sets || 1);
    let completedSets = currentSetIdx;
    if (isResting && !pendingExerciseAdvance) {
      completedSets = currentSetIdx + 1;
    }
    completedSets = Math.min(totalSets, Math.max(0, completedSets));

    let fractionalSet = 0;
    if (!isResting && (exercise.type === 'isometry' || exercise.type === 'cardio')) {
      const dur = exercise.duration_seconds || 0;
      if (dur > 0 && isometryRemaining < dur) {
        fractionalSet = Math.max(0, Math.min(1, (dur - isometryRemaining) / dur));
      }
    }

    const rawPct = ((completedSets + fractionalSet) / totalSets) * 100;
    const pct = Math.round(rawPct);
    const stdLabel = isResting
      ? `Set ${completedSets} di ${totalSets} completati · Recupero`
      : `Set ${currentSetIdx + 1} di ${totalSets} in corso`;

    return {
      progressPct: Math.min(100, Math.max(0, pct)),
      completedUnits: completedSets,
      totalUnits: totalSets,
      label: stdLabel,
    };
  };

  const openTransitionEditor = (exerciseIndex: number, currentVal: number) => {
    void hapticLight();
    setEditingTransitionIdx(exerciseIndex);
    const m = Math.floor(Math.max(0, currentVal || 0) / 60);
    const s = Math.max(0, currentVal || 0) % 60;
    setTransitionDraftMinutes(String(m));
    setTransitionDraftSeconds(String(s));
  };

  const closeTransitionEditor = () => {
    setEditingTransitionIdx(null);
  };

  const adjustTransitionDraft = (deltaSeconds: number) => {
    void hapticLight();
    const m = Math.max(0, parseInt(transitionDraftMinutes, 10) || 0);
    const s = Math.max(0, parseInt(transitionDraftSeconds, 10) || 0);
    const total = Math.max(0, m * 60 + s + deltaSeconds);
    setTransitionDraftMinutes(String(Math.floor(total / 60)));
    setTransitionDraftSeconds(String(total % 60));
  };

  const handleApplyTransitionPreset = (presetSeconds: number) => {
    void hapticLight();
    const m = Math.floor(presetSeconds / 60);
    const s = presetSeconds % 60;
    setTransitionDraftMinutes(String(m));
    setTransitionDraftSeconds(String(s));
  };

  const handleSaveTransitionRest = (exerciseIndex: number) => {
    const m = Math.max(0, parseInt(transitionDraftMinutes, 10) || 0);
    const s = Math.max(0, parseInt(transitionDraftSeconds, 10) || 0);
    onUpdateTransitionRest(exerciseIndex, m * 60 + s);
    setEditingTransitionIdx(null);
  };

  const handleRemoveTransitionRest = (exerciseIndex: number) => {
    onUpdateTransitionRest(exerciseIndex, 0);
    setEditingTransitionIdx(null);
  };

  const handleSaveGeneralNote = () => {
    onSaveGeneralNote(generalNoteDraft.trim());
    setIsEditingGeneralNote(false);
    void hapticLight();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-brand-darkGrey/95 border border-brand-orange/25 rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-white">Panoramica Scheda</h3>
              <WorkoutOverviewTimerBadge getElapsed={getCurrentWorkoutElapsedSeconds} />
              <span className="inline-flex items-center text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                {currentExerciseIdx} / {workout.exercises.length} completati
              </span>
            </div>
            <p className="text-xs text-brand-grey mt-1">{workout.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Chiudi panoramica"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
          {/* Note Generali della Scheda */}
          {isEditingGeneralNote ? (
            <div className="rounded-2xl border border-brand-orange/40 bg-brand-orange/10 p-4 shadow-sm mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-brand-orange">
                  <FileText size={16} />
                  <span className="text-xs font-black uppercase tracking-wider">Note Generali Scheda</span>
                </div>
              </div>
              <textarea
                value={generalNoteDraft}
                onChange={(e) => setGeneralNoteDraft(e.target.value)}
                placeholder="Scrivi le note generali riferite all'intera scheda di allenamento..."
                className="w-full min-h-[110px] bg-black/50 border border-brand-orange/30 rounded-xl px-3 py-2.5 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none mb-3"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingGeneralNote(false)}
                  className="px-3 py-1.5 rounded-xl border border-white/10 hover:border-white/20 text-zinc-400 hover:text-white transition-colors text-xs font-bold cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={handleSaveGeneralNote}
                  className="px-3.5 py-1.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-xs font-black active:scale-95 shadow-md cursor-pointer"
                >
                  Salva Nota
                </button>
              </div>
            </div>
          ) : workoutGeneralNote.trim() ? (
            <div className="rounded-2xl border border-brand-orange/40 bg-brand-orange/10 p-4 shadow-sm mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-brand-orange">
                  <FileText size={16} />
                  <span className="text-xs font-black uppercase tracking-wider">Note Generali Scheda</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGeneralNoteDraft(workoutGeneralNote);
                    setIsEditingGeneralNote(true);
                  }}
                  className="text-[11px] font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
                >
                  Modifica
                </button>
              </div>
              <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">
                {workoutGeneralNote}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setGeneralNoteDraft('');
                setIsEditingGeneralNote(true);
              }}
              className="w-full mb-3 flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-zinc-400 hover:text-white hover:border-brand-orange/40 hover:bg-brand-orange/5 transition-all text-xs font-semibold cursor-pointer"
            >
              <FileText size={14} className="text-brand-orange" />
              <span>Aggiungi note per l'intera scheda</span>
            </button>
          )}

          {workout.exercises.map((exercise, index) => {
            const isCompleted = index < currentExerciseIdx;
            const isCurrentExercise = index === currentExerciseIdx;
            const exerciseTitle = String(exercise.name || '').trim() || `Esercizio ${index + 1}`;
            const summary = getWorkoutOverviewSummary(exercise);
            const { progressPct } = calculateExerciseProgress(exercise, index);
            const exerciseNote = getExerciseNoteEntry(index, exercise)?.note?.trim();
            const hasNote = Boolean(exerciseNote);

            const isLastEx = index === workout.exercises.length - 1;
            const transitionRestSecs = exercise.transition_rest_seconds || 0;
            const hasTransitionTimer = transitionRestSecs > 0;
            const isEditingThisTransition = editingTransitionIdx === index;

            return (
              <React.Fragment key={exercise.id}>
                <div
                  className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
                    isCurrentExercise
                      ? 'border-2 border-brand-orange/80 bg-brand-darkGrey/95 shadow-[0_0_24px_rgba(255,94,0,0.22)] ring-1 ring-brand-orange/40'
                      : isCompleted
                        ? 'border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-emerald-900/15 to-black/50 shadow-[0_0_15px_rgba(16,185,129,0.06)]'
                        : 'border-white/10 bg-black/30 opacity-75 hover:opacity-100'
                  }`}
                >
                  {isCompleted && (
                    <div className="absolute inset-0 bg-emerald-500/15 pointer-events-none" />
                  )}
                  {isCurrentExercise && (
                    <>
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-orange/35 via-brand-orange/25 to-brand-orange/15 pointer-events-none transition-all duration-500 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                      {progressPct > 0 && progressPct < 100 && (
                        <div
                          className="absolute inset-y-0 w-[2px] bg-brand-orange shadow-[0_0_10px_rgba(255,94,0,0.9)] pointer-events-none transition-all duration-500 ease-out"
                          style={{ left: `calc(${progressPct}% - 2px)` }}
                        />
                      )}
                    </>
                  )}

                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.25em] font-bold mb-1 flex items-center">
                          {isCompleted ? (
                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                              <CheckCircle2 size={11} /> Esercizio {index + 1}
                            </span>
                          ) : isCurrentExercise ? (
                            <span className="text-brand-orange font-bold flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" /> Esercizio {index + 1}
                            </span>
                          ) : (
                            <span className="text-brand-grey/70">Esercizio {index + 1}</span>
                          )}
                        </p>
                        <h4 className="text-white font-black text-lg leading-tight truncate">{exerciseTitle}</h4>
                        <p className={`text-[10px] uppercase tracking-widest font-bold mt-1 ${
                          isCompleted
                            ? 'text-emerald-400/90'
                            : isCurrentExercise
                              ? 'text-brand-orange font-black'
                              : 'text-zinc-400'
                        }`}>
                          {getWorkoutOverviewDisplayLabel(exercise)}
                        </p>
                      </div>

                      <div className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                        isCompleted
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                          : isCurrentExercise
                            ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                            : 'bg-white/5 text-brand-grey border border-white/5'
                      }`}>
                        {isCompleted ? (
                          <>
                            <CheckCircle2 size={12} className="text-emerald-400" />
                            <span>Completato</span>
                          </>
                        ) : isCurrentExercise ? (
                          <span>In corso</span>
                        ) : (
                          <span>#{index + 1}</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {summary.map((item, summaryIndex) => (
                        <span
                          key={`${exercise.id}:summary:${summaryIndex}`}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold ${
                            isCompleted
                              ? 'border-emerald-500/20 bg-emerald-950/30 text-emerald-200'
                              : isCurrentExercise
                                ? 'border-brand-orange/30 bg-black/40 text-brand-orange/95'
                                : 'border-white/10 bg-black/25 text-white/85'
                          }`}
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    {(exercise.type === 'superset' || exercise.type === 'circuit') && exercise.subExercises && exercise.subExercises.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.subExercises.map((sub, subIndex) => {
                          const isSubActive = isCurrentExercise && subIndex === currentSubExerciseIdx;
                          const isSubDone = isCompleted || (isCurrentExercise && subIndex < currentSubExerciseIdx);

                          return (
                            <div
                              key={`${exercise.id}:sub:${subIndex}`}
                              className={`rounded-xl border px-3 py-2 flex items-start justify-between gap-3 transition-colors ${
                                isSubActive
                                  ? 'border-brand-orange/60 bg-brand-orange/15 shadow-[0_0_10px_rgba(255,94,0,0.15)]'
                                  : isSubDone
                                    ? 'border-emerald-500/20 bg-emerald-950/20'
                                    : 'border-white/5 bg-black/25'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className={`font-bold text-sm truncate flex items-center gap-1.5 ${
                                  isSubActive ? 'text-white font-black' : isSubDone ? 'text-emerald-100' : 'text-zinc-300'
                                }`}>
                                  {isSubDone && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                                  {sub.name || `Esercizio ${subIndex + 1}`}
                                </p>
                                <p className={`text-[11px] font-black uppercase tracking-wide mt-1 ${
                                  isSubActive ? 'text-brand-orange' : isSubDone ? 'text-emerald-400/90' : 'text-zinc-400'
                                }`}>
                                  {formatSupersetTaskMetricLabel(sub)}
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(sub.weight_kg)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {exercise.type === 'emom' && exercise.subExercises && exercise.subExercises.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.subExercises.map((sub, subIndex) => {
                          const isSubActive = isCurrentExercise && subIndex === (currentEmomRoundIdx % (exercise.subExercises?.length || 1));
                          const isSubDone = isCompleted;

                          return (
                            <div
                              key={`${exercise.id}:emom:${subIndex}`}
                              className={`rounded-xl border px-3 py-2 flex items-start justify-between gap-3 transition-colors ${
                                isSubActive
                                  ? 'border-brand-orange/60 bg-brand-orange/15 shadow-[0_0_10px_rgba(255,94,0,0.15)]'
                                  : isSubDone
                                    ? 'border-emerald-500/20 bg-emerald-950/20'
                                    : 'border-white/5 bg-black/25'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className={`font-bold text-sm truncate flex items-center gap-1.5 ${
                                  isSubActive ? 'text-white font-black' : isSubDone ? 'text-emerald-100' : 'text-zinc-300'
                                }`}>
                                  {isSubDone && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                                  {sub.name || `Esercizio ${subIndex + 1}`}
                                </p>
                                <p className={`text-[11px] font-black uppercase tracking-wide mt-1 ${
                                  isSubActive ? 'text-brand-orange' : isSubDone ? 'text-emerald-400/90' : 'text-zinc-400'
                                }`}>
                                  {formatEmomTaskMetricLabel(sub)}
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(sub.weight_kg)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {exercise.type === 'pyramid' && exercise.pyramid_steps && exercise.pyramid_steps.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.pyramid_steps.map((step, stepIndex) => {
                          const isStepActive = isCurrentExercise && stepIndex === currentPyramidStepIdx;
                          const isStepDone = isCompleted || (isCurrentExercise && (
                            pendingPyramidAdvance ? stepIndex <= currentPyramidStepIdx : stepIndex < currentPyramidStepIdx
                          ));

                          return (
                            <div
                              key={`${exercise.id}:pyramid:${stepIndex}`}
                              className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                                isStepActive
                                  ? 'border-brand-orange/60 bg-brand-orange/15 shadow-[0_0_10px_rgba(255,94,0,0.15)]'
                                  : isStepDone
                                    ? 'border-emerald-500/20 bg-emerald-950/20'
                                    : 'border-white/5 bg-black/25'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className={`font-bold text-sm truncate flex items-center gap-1.5 ${
                                  isStepActive ? 'text-white font-black' : isStepDone ? 'text-emerald-100' : 'text-zinc-300'
                                }`}>
                                  {isStepDone && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                                  Step {stepIndex + 1}
                                </p>
                                <p className={`text-[11px] font-black uppercase tracking-wide mt-1 ${
                                  isStepActive ? 'text-brand-orange' : isStepDone ? 'text-emerald-400/90' : 'text-zinc-400'
                                }`}>
                                  {isMaxTarget(step.reps) ? 'MAX reps' : `${step.reps} reps`} · {formatTime(step.rest_seconds)} rest
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(step.weight_kg)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {hasNote && (
                      <div className="mt-2.5 rounded-xl border border-brand-orange/30 bg-black/40 px-3 py-2 flex items-start gap-2">
                        <FileText size={13} className="text-brand-orange shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-brand-orange/90 mb-0.5">Nota Esercizio</p>
                          <p className="text-xs text-zinc-200 line-clamp-2 leading-relaxed whitespace-pre-wrap">{exerciseNote}</p>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold">
                        {isCurrentExercise ? (
                          <span className="text-brand-orange font-black flex items-center gap-1.5">
                            <Flame size={12} className="text-brand-orange animate-pulse" />
                            In esecuzione adesso
                          </span>
                        ) : isCompleted ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                            <CheckCircle2 size={12} />
                            Completato
                          </span>
                        ) : (
                          <span className="text-zinc-400">
                            Esercizio {index + 1} di {workout.exercises.length}
                          </span>
                        )}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenExerciseNote(index)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm relative ${
                            hasNote
                              ? 'bg-brand-orange/20 border border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.3)]'
                              : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                          }`}
                          title={`Note per ${exerciseTitle}`}
                        >
                          <FileText size={13} />
                          <span>{hasNote ? 'Modifica Nota' : 'Nota'}</span>
                          {hasNote && (
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange ring-1 ring-black" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onOpenEditExercise(index)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm ${
                            isCurrentExercise
                              ? 'bg-brand-orange text-black hover:bg-brand-lightOrange shadow-brand-orange/20 font-black'
                              : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                          }`}
                          title={`Modifica parametri di ${exerciseTitle}`}
                        >
                          <SlidersHorizontal size={13} />
                          <span>Modifica Parametri</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recupero di transizione tra esercizio index e index + 1 */}
                {!isLastEx && (
                  <div className="py-1">
                    {isEditingThisTransition ? (
                      <div className="rounded-2xl border border-brand-orange/50 bg-[#1C1C1E] p-4 shadow-[0_0_24px_rgba(255,94,0,0.18)] ring-1 ring-brand-orange/40 my-2 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Clock size={16} className="text-brand-orange animate-pulse" />
                            <div>
                              <p className="text-[10px] uppercase font-black tracking-widest text-brand-orange">
                                Pausa tra Esercizi
                              </p>
                              <p className="text-xs font-bold text-white">
                                Tra Es. {index + 1} e Es. {index + 2}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={closeTransitionEditor}
                            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                            title="Chiudi modifica pausa"
                          >
                            <X size={16} />
                          </button>
                        </div>

                        <div>
                          <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-1.5">
                            Preset Rapidi
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { label: '30s', secs: 30 },
                              { label: '45s', secs: 45 },
                              { label: '60s', secs: 60 },
                              { label: '90s', secs: 90 },
                              { label: '2 min', secs: 120 },
                              { label: '3 min', secs: 180 },
                            ].map((preset) => {
                              const draftTotal =
                                (Math.max(0, parseInt(transitionDraftMinutes, 10) || 0) * 60) +
                                Math.max(0, parseInt(transitionDraftSeconds, 10) || 0);
                              const isActive = draftTotal === preset.secs;
                              return (
                                <button
                                  key={preset.secs}
                                  type="button"
                                  onClick={() => handleApplyTransitionPreset(preset.secs)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                    isActive
                                      ? 'bg-brand-orange text-black font-black shadow-sm shadow-brand-orange/30'
                                      : 'bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                          <div className="flex items-center gap-1.5">
                            <div className="flex flex-col items-center">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={transitionDraftMinutes}
                                onChange={(e) => setTransitionDraftMinutes(e.target.value.replace(/\D/g, ''))}
                                className="w-13 h-9 bg-black/60 border border-white/20 focus:border-brand-orange rounded-xl text-center font-mono font-black text-white text-base outline-none transition-colors"
                                placeholder="0"
                              />
                              <span className="text-[9px] font-bold text-zinc-400 mt-0.5 uppercase tracking-wider">min</span>
                            </div>
                            <span className="text-lg font-bold text-zinc-500 font-mono -mt-3">:</span>
                            <div className="flex flex-col items-center">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={transitionDraftSeconds}
                                onChange={(e) => setTransitionDraftSeconds(e.target.value.replace(/\D/g, ''))}
                                className="w-13 h-9 bg-black/60 border border-white/20 focus:border-brand-orange rounded-xl text-center font-mono font-black text-white text-base outline-none transition-colors"
                                placeholder="0"
                              />
                              <span className="text-[9px] font-bold text-zinc-400 mt-0.5 uppercase tracking-wider">sec</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => adjustTransitionDraft(-15)}
                              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 border border-white/10 transition-colors cursor-pointer"
                              title="-15 secondi"
                            >
                              -15s
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustTransitionDraft(-5)}
                              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 border border-white/10 transition-colors cursor-pointer"
                              title="-5 secondi"
                            >
                              -5s
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustTransitionDraft(5)}
                              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 border border-white/10 transition-colors cursor-pointer"
                              title="+5 secondi"
                            >
                              +5s
                            </button>
                            <button
                              type="button"
                              onClick={() => adjustTransitionDraft(15)}
                              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 border border-white/10 transition-colors cursor-pointer"
                              title="+15 secondi"
                            >
                              +15s
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-white/10">
                          {hasTransitionTimer ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveTransitionRest(index)}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2.5 py-1.5 rounded-xl transition-colors cursor-pointer"
                            >
                              <Trash2 size={13} />
                              <span>Rimuovi Pausa</span>
                            </button>
                          ) : (
                            <div />
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={closeTransitionEditor}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold text-zinc-400 hover:text-white transition-colors cursor-pointer"
                            >
                              Annulla
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveTransitionRest(index)}
                              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black text-xs font-black shadow-md shadow-brand-orange/20 active:scale-95 transition-all cursor-pointer"
                            >
                              <Check size={13} />
                              <span>Salva Pausa</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : hasTransitionTimer ? (
                      <div className="relative my-2">
                        <div className="rounded-2xl border border-brand-orange/30 bg-gradient-to-r from-brand-orange/10 via-black/40 to-brand-orange/5 px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-sm backdrop-blur-sm">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-brand-orange/20 border border-brand-orange/40 flex items-center justify-center shrink-0">
                              <Timer size={14} className="text-brand-orange" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] uppercase font-bold tracking-wider text-brand-orange/90">
                                  Pausa tra esercizi
                                </span>
                                <span className="text-[10px] text-zinc-500">·</span>
                                <span className="text-[11px] font-mono font-black text-white">
                                  {formatTime(transitionRestSecs)}
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-400 truncate">
                                Tra Es. {index + 1} e Es. {index + 2}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openTransitionEditor(index, transitionRestSecs)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-brand-orange/15 hover:bg-brand-orange/25 border border-brand-orange/30 text-brand-orange text-xs font-bold transition-all active:scale-95 cursor-pointer"
                              title="Modifica pausa"
                            >
                              <Pencil size={12} />
                              <span>Modifica</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTransitionRest(index)}
                              className="p-1.5 rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              title="Rimuovi pausa tra questi esercizi"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="relative my-2">
                        <div className="rounded-2xl border border-dashed border-white/15 hover:border-brand-orange/30 bg-white/[0.02] hover:bg-white/[0.04] px-3.5 py-2.5 flex items-center justify-between gap-3 transition-all">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                              <Timer size={14} className="text-zinc-500" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-zinc-400 truncate">
                                Pausa tra Es. {index + 1} e Es. {index + 2}
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                Nessun recupero impostato
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => openTransitionEditor(index, 60)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-brand-orange/15 border border-white/10 hover:border-brand-orange/35 text-zinc-300 hover:text-brand-orange text-xs font-bold transition-all active:scale-95 cursor-pointer shrink-0"
                          >
                            <Plus size={13} className="text-brand-orange" />
                            <span>Aggiungi Pausa</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors text-xs font-bold cursor-pointer"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
});

WorkoutOverviewModal.displayName = 'WorkoutOverviewModal';
