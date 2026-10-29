import React, { useState } from 'react';
import {
  X,
  SlidersHorizontal,
  Flame,
  Plus,
  Trash2,
  Clock,
  Dumbbell,
  FileText,
  AlertCircle,
  Check,
} from 'lucide-react';
import type { Exercise, ExerciseType, ExerciseSubItem, ExercisePyramidStep } from './types';
import { hapticLight, hapticSuccess } from '../../utils/haptics';

export interface ExerciseParameterEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  exercise: Exercise;
  exerciseIndex: number;
  totalExercises: number;
  isCurrentExercise: boolean;
  currentSetIdx: number;
  onSave: (updatedExercise: Exercise) => Promise<void> | void;
}

const isMaxTarget = (val: unknown): boolean => {
  if (val === 0 || val === '0' || val === -1 || val === '-1') return true;
  if (typeof val === 'string' && val.trim().toLowerCase() === 'max') return true;
  return false;
};

const formatWeightValue = (weight?: number | null): string => {
  if (weight == null || Number.isNaN(Number(weight)) || Number(weight) <= 0) return '';
  return String(Math.round(Number(weight) * 100) / 100).replace('.', ',');
};

const parseWeightInput = (raw: string): number | null => {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
};

export const ExerciseParameterEditModal: React.FC<ExerciseParameterEditModalProps> = ({
  isOpen,
  onClose,
  exercise,
  exerciseIndex,
  totalExercises,
  isCurrentExercise,
  currentSetIdx,
  onSave,
}) => {
  // Initial state setup based on exercise
  const isInitialRepsMax = isMaxTarget(exercise.reps);
  const isInitialDurationMax = isMaxTarget(exercise.duration_seconds);

  const [name, setName] = useState(exercise.name || '');
  const [sets, setSets] = useState(Math.max(1, exercise.sets || 1));
  const [reps, setReps] = useState(isInitialRepsMax ? 10 : Math.max(1, Number(exercise.reps) || 10));
  const [isMaxReps, setIsMaxReps] = useState(isInitialRepsMax);
  const [durationSeconds, setDurationSeconds] = useState(
    isInitialDurationMax ? 30 : Math.max(1, Number(exercise.duration_seconds) || 30)
  );
  const [isMaxDuration, setIsMaxDuration] = useState(isInitialDurationMax);
  const [weightKg, setWeightKg] = useState(formatWeightValue(exercise.weight_kg));
  const [restSeconds, setRestSeconds] = useState(Math.max(0, exercise.rest_seconds || 0));
  const [transitionRestSeconds, setTransitionRestSeconds] = useState(
    Math.max(0, exercise.transition_rest_seconds || 0)
  );
  const [instructionNote, setInstructionNote] = useState(exercise.instruction_note || '');

  // Sub-exercises for superset / circuit / emom
  const [subExercises, setSubExercises] = useState<ExerciseSubItem[]>(() => {
    return (exercise.subExercises || []).map((sub, idx) => ({
      name: sub.name || `Esercizio ${idx + 1}`,
      type: sub.type || 'reps',
      reps: isMaxTarget(sub.reps) ? 0 : Math.max(1, Number(sub.reps) || 10),
      duration_seconds: isMaxTarget(sub.duration_seconds) ? 0 : Math.max(1, Number(sub.duration_seconds) || 30),
      weight_kg: sub.weight_kg != null ? sub.weight_kg : null,
      instruction_note: sub.instruction_note || '',
    }));
  });

  // Pyramid steps
  const [pyramidSteps, setPyramidSteps] = useState<ExercisePyramidStep[]>(() => {
    return (exercise.pyramid_steps || []).map((step) => ({
      reps: isMaxTarget(step.reps) ? 0 : Math.max(1, Number(step.reps) || 10),
      rest_seconds: Math.max(0, step.rest_seconds || 0),
      weight_kg: step.weight_kg != null ? step.weight_kg : null,
    }));
  });

  // EMOM specific
  const [emomRounds, setEmomRounds] = useState(Math.max(1, exercise.emom_rounds || exercise.sets || 1));
  const [emomRoundDuration, setEmomRoundDuration] = useState(Math.max(1, exercise.emom_round_duration || 60));

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const minAllowedSets = isCurrentExercise ? currentSetIdx + 1 : 1;

  const handleSave = async () => {
    if (sets < minAllowedSets) {
      setErrorMessage(
        `Sei attualmente al set ${currentSetIdx + 1}. Il numero totale di serie non può essere inferiore a ${minAllowedSets}.`
      );
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);

    try {
      const finalWeight = parseWeightInput(weightKg);
      const updatedExercise: Exercise = {
        ...exercise,
        name: name.trim() || exercise.name,
        sets: Math.max(1, sets),
        reps: isMaxReps ? 0 : Math.max(1, reps),
        duration_seconds: isMaxDuration ? 0 : Math.max(1, durationSeconds),
        weight_kg: finalWeight,
        rest_seconds: Math.max(0, restSeconds),
        transition_rest_seconds: Math.max(0, transitionRestSeconds),
        instruction_note: instructionNote.trim() || null,
        subExercises: subExercises.length > 0 ? subExercises : exercise.subExercises,
        pyramid_steps: pyramidSteps.length > 0 ? pyramidSteps : exercise.pyramid_steps,
        emom_rounds: emomRounds,
        emom_round_duration: emomRoundDuration,
      };

      await onSave(updatedExercise);
      void hapticSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Errore durante il salvataggio dei parametri.');
    } finally {
      setIsSaving(false);
    }
  };

  const getTypeNameBadge = (type: ExerciseType) => {
    switch (type) {
      case 'reps':
        return 'Standard (Ripetizioni)';
      case 'isometry':
        return 'Isometria (Tempo)';
      case 'cardio':
        return 'Cardio';
      case 'pyramid':
        return 'Piramidale';
      case 'superset':
        return 'Superset';
      case 'circuit':
        return 'Circuito';
      case 'emom':
        return 'EMOM';
      default:
        return type;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-lg bg-[#1C1C1E] border border-white/10 rounded-3xl p-4 sm:p-5 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2 flex-wrap">
              <SlidersHorizontal size={17} className="text-brand-orange shrink-0" />
              <h3 className="text-base font-black text-white truncate">Modifica Parametri</h3>
              {isCurrentExercise && (
                <span className="text-[10px] font-black uppercase bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded-full border border-brand-orange/30 shrink-0">
                  In esecuzione
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              Esercizio {exerciseIndex + 1} di {totalExercises} · {getTypeNameBadge(exercise.type)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            title="Chiudi editor parametri"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto space-y-4 py-3 pr-1">
          {/* Nome Esercizio */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 flex items-center gap-1.5">
              <Dumbbell size={13} className="text-brand-orange" />
              Nome Esercizio
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl px-3 py-2 text-white font-bold text-sm outline-none transition-colors"
              placeholder="Es. Panca Piana Bilanciere"
            />
          </div>

          {/* PARAMETRI SPECIFICI IN BASE AL TIPO */}
          {exercise.type === 'pyramid' ? (
            /* ── PIRAMIDALE ── */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                  Step Piramidali ({pyramidSteps.length})
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void hapticLight();
                    const lastStep = pyramidSteps[pyramidSteps.length - 1];
                    setPyramidSteps([
                      ...pyramidSteps,
                      {
                        reps: lastStep ? lastStep.reps : 10,
                        weight_kg: lastStep ? lastStep.weight_kg : null,
                        rest_seconds: lastStep ? lastStep.rest_seconds : 60,
                      },
                    ]);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-orange/15 border border-brand-orange/40 text-brand-orange hover:bg-brand-orange/25 text-xs font-bold transition-all cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Aggiungi Step</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {pyramidSteps.map((step, idx) => {
                  const isStepMax = isMaxTarget(step.reps);
                  return (
                    <div
                      key={`step-${idx}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-brand-orange">
                          Step {idx + 1}
                        </span>
                        {pyramidSteps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              void hapticLight();
                              setPyramidSteps(pyramidSteps.filter((_, sIdx) => sIdx !== idx));
                            }}
                            className="p-1 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Elimina questo step"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {/* Reps */}
                        <div>
                          <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">
                            Reps
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              disabled={isStepMax}
                              value={isStepMax ? '0' : step.reps}
                              onChange={(e) => {
                                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                setPyramidSteps(
                                  pyramidSteps.map((s, sIdx) => (sIdx === idx ? { ...s, reps: val } : s))
                                );
                              }}
                              className={`w-full bg-black/60 border rounded-xl px-2 py-1.5 text-center text-sm font-bold text-white outline-none ${
                                isStepMax ? 'border-brand-orange/40 text-brand-orange opacity-60' : 'border-white/15 focus:border-brand-orange'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                void hapticLight();
                                setPyramidSteps(
                                  pyramidSteps.map((s, sIdx) =>
                                    sIdx === idx ? { ...s, reps: isStepMax ? 10 : 0 } : s
                                  )
                                );
                              }}
                              className={`px-1.5 py-1.5 rounded-xl border text-[10px] font-black uppercase transition-all cursor-pointer ${
                                isStepMax
                                  ? 'bg-brand-orange text-black border-brand-orange'
                                  : 'bg-white/5 border-white/15 text-zinc-400 hover:text-white'
                              }`}
                              title="Tocca per impostare ripetizioni a sfinimento (MAX)"
                            >
                              MAX
                            </button>
                          </div>
                        </div>

                        {/* Peso (kg) */}
                        <div>
                          <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">
                            Carico (kg)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={step.weight_kg != null && step.weight_kg > 0 ? String(step.weight_kg).replace('.', ',') : ''}
                            onChange={(e) => {
                              const parsed = parseWeightInput(e.target.value);
                              setPyramidSteps(
                                pyramidSteps.map((s, sIdx) => (sIdx === idx ? { ...s, weight_kg: parsed } : s))
                              );
                            }}
                            placeholder="0 (Libero)"
                            className="w-full bg-black/60 border border-white/15 focus:border-brand-orange rounded-xl px-2 py-1.5 text-center text-sm font-bold text-white outline-none"
                          />
                        </div>

                        {/* Recupero (sec) */}
                        <div>
                          <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">
                            Recup. (sec)
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={step.rest_seconds}
                            onChange={(e) => {
                              const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                              setPyramidSteps(
                                pyramidSteps.map((s, sIdx) => (sIdx === idx ? { ...s, rest_seconds: val } : s))
                              );
                            }}
                            className="w-full bg-black/60 border border-white/15 focus:border-brand-orange rounded-xl px-2 py-1.5 text-center text-sm font-bold text-white outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : exercise.type === 'superset' || exercise.type === 'circuit' ? (
            /* ── SUPERSET O CIRCUITO ── */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Giri / Sets */}
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 block">
                    {exercise.type === 'circuit' ? 'Giri (Rounds)' : 'Serie (Sets)'}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setSets((prev) => Math.max(minAllowedSets, prev - 1));
                      }}
                      className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={minAllowedSets}
                      value={sets}
                      onChange={(e) => setSets(Math.max(minAllowedSets, parseInt(e.target.value, 10) || minAllowedSets))}
                      className="flex-1 h-9 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl text-center text-white font-black text-base outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setSets((prev) => prev + 1);
                      }}
                      className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Recupero a fine giro */}
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 block">
                    Recupero Fine Giro (sec)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={restSeconds}
                    onChange={(e) => setRestSeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full h-9 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl text-center text-white font-black text-base outline-none"
                  />
                </div>
              </div>

              {/* Sub-exercises stations */}
              <div className="space-y-2 pt-1">
                <p className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                  Stazioni del {exercise.type === 'circuit' ? 'Circuito' : 'Superset'} ({subExercises.length})
                </p>
                {subExercises.map((sub, sIdx) => {
                  const isSubIso = sub.type === 'isometry';
                  const isSubMax = isSubIso ? isMaxTarget(sub.duration_seconds) : isMaxTarget(sub.reps);

                  return (
                    <div
                      key={`sub-${sIdx}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={sub.name}
                          onChange={(e) => {
                            setSubExercises(
                              subExercises.map((s, idx) => (idx === sIdx ? { ...s, name: e.target.value } : s))
                            );
                          }}
                          className="flex-1 bg-transparent border-b border-white/15 focus:border-brand-orange text-white font-bold text-xs py-0.5 outline-none"
                          placeholder={`Stazione ${sIdx + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void hapticLight();
                            setSubExercises(
                              subExercises.map((s, idx) =>
                                idx === sIdx ? { ...s, type: isSubIso ? 'reps' : 'isometry' } : s
                              )
                            );
                          }}
                          className="px-2 py-0.5 rounded-lg border border-white/10 text-[10px] font-bold text-brand-orange bg-brand-orange/10 cursor-pointer"
                        >
                          {isSubIso ? 'Isometria (sec)' : 'Ripetizioni (reps)'}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Target (Reps o Durata) */}
                        <div>
                          <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">
                            {isSubIso ? 'Durata' : 'Ripetizioni'}
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              disabled={isSubMax}
                              value={isSubMax ? '0' : isSubIso ? sub.duration_seconds : sub.reps}
                              onChange={(e) => {
                                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                setSubExercises(
                                  subExercises.map((s, idx) =>
                                    idx === sIdx
                                      ? isSubIso
                                        ? { ...s, duration_seconds: val }
                                        : { ...s, reps: val }
                                      : s
                                  )
                                );
                              }}
                              className={`w-full bg-black/60 border rounded-xl px-2 py-1.5 text-center text-xs font-bold text-white outline-none ${
                                isSubMax ? 'border-brand-orange/40 text-brand-orange opacity-60' : 'border-white/15 focus:border-brand-orange'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                void hapticLight();
                                setSubExercises(
                                  subExercises.map((s, idx) =>
                                    idx === sIdx
                                      ? isSubIso
                                        ? { ...s, duration_seconds: isSubMax ? 30 : 0 }
                                        : { ...s, reps: isSubMax ? 10 : 0 }
                                      : s
                                  )
                                );
                              }}
                              className={`px-1.5 py-1.5 rounded-xl border text-[10px] font-black uppercase transition-all cursor-pointer ${
                                isSubMax
                                  ? 'bg-brand-orange text-black border-brand-orange'
                                  : 'bg-white/5 border-white/15 text-zinc-400 hover:text-white'
                              }`}
                            >
                              MAX
                            </button>
                          </div>
                        </div>

                        {/* Carico kg */}
                        <div>
                          <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">
                            Carico (kg)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={sub.weight_kg != null && sub.weight_kg > 0 ? String(sub.weight_kg).replace('.', ',') : ''}
                            onChange={(e) => {
                              const parsed = parseWeightInput(e.target.value);
                              setSubExercises(
                                subExercises.map((s, idx) => (idx === sIdx ? { ...s, weight_kg: parsed } : s))
                              );
                            }}
                            placeholder="0 (Libero)"
                            className="w-full bg-black/60 border border-white/15 focus:border-brand-orange rounded-xl px-2 py-1.5 text-center text-xs font-bold text-white outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : exercise.type === 'emom' ? (
            /* ── EMOM ── */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Rounds */}
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 block">
                    Round Totali
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={emomRounds}
                    onChange={(e) => setEmomRounds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full h-10 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl text-center text-white font-black text-base outline-none"
                  />
                </div>

                {/* Durata round */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 block truncate">
                      Durata Round
                    </label>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {String(Math.floor(emomRoundDuration / 60)).padStart(2, '0')}:{String(emomRoundDuration % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="flex bg-black/50 border border-white/15 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-10">
                    <div className="relative flex-1 border-r border-white/10 flex flex-col justify-center items-center">
                      <span className="text-[8px] text-zinc-400 uppercase font-black tracking-wider leading-none pt-1 pointer-events-none">MIN</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={Math.floor(emomRoundDuration / 60)}
                        onChange={(e) => {
                          const m = Math.max(0, parseInt(e.target.value, 10) || 0);
                          const total = m * 60 + (emomRoundDuration % 60);
                          setEmomRoundDuration(Math.max(5, total));
                        }}
                        className="w-full h-full bg-transparent text-center text-white font-mono font-black text-base focus:outline-none"
                      />
                    </div>
                    <div className="relative flex-1 flex flex-col justify-center items-center">
                      <span className="text-[8px] text-zinc-400 uppercase font-black tracking-wider leading-none pt-1 pointer-events-none">SEC</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={59}
                        value={emomRoundDuration % 60}
                        onChange={(e) => {
                          const s = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                          const total = Math.floor(emomRoundDuration / 60) * 60 + s;
                          setEmomRoundDuration(Math.max(5, total));
                        }}
                        className="w-full h-full bg-transparent text-center text-white font-mono font-black text-base focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Recupero tra Serie (diviso in minuti e secondi) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 block">
                    Recupero tra Serie
                  </label>
                  <span className="text-xs font-mono font-bold text-brand-orange">
                    {String(Math.floor(restSeconds / 60)).padStart(2, '0')}:{String(restSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
                <div className="flex bg-black/50 border border-white/15 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-10">
                  <div className="relative flex-1 border-r border-white/10 flex flex-col justify-center items-center">
                    <span className="text-[8px] text-zinc-400 uppercase font-black tracking-wider leading-none pt-1 pointer-events-none">MIN</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={Math.floor(restSeconds / 60)}
                      onChange={(e) => {
                        const m = Math.max(0, parseInt(e.target.value, 10) || 0);
                        setRestSeconds(m * 60 + (restSeconds % 60));
                      }}
                      className="w-full h-full bg-transparent text-center text-white font-mono font-black text-base focus:outline-none"
                    />
                  </div>
                  <div className="relative flex-1 flex flex-col justify-center items-center">
                    <span className="text-[8px] text-zinc-400 uppercase font-black tracking-wider leading-none pt-1 pointer-events-none">SEC</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={59}
                      value={restSeconds % 60}
                      onChange={(e) => {
                        const s = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                        setRestSeconds(Math.floor(restSeconds / 60) * 60 + s);
                      }}
                      className="w-full h-full bg-transparent text-center text-white font-mono font-black text-base focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  {[
                    { label: '0s', secs: 0 },
                    { label: '30s', secs: 30 },
                    { label: '60s', secs: 60 },
                    { label: '90s', secs: 90 },
                    { label: '2m', secs: 120 },
                    { label: '3m', secs: 180 },
                  ].map((preset) => (
                    <button
                      key={preset.secs}
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setRestSeconds(preset.secs);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        restSeconds === preset.secs
                          ? 'bg-brand-orange text-black font-black'
                          : 'bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-exercises tasks */}
              <div className="space-y-2 pt-1">
                <p className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                  Esercizi EMOM ({subExercises.length})
                </p>
                {subExercises.map((sub, sIdx) => (
                  <div key={`emom-sub-${sIdx}`} className="rounded-2xl border border-white/10 bg-black/30 p-3 space-y-2">
                    <input
                      type="text"
                      value={sub.name}
                      onChange={(e) => {
                        setSubExercises(
                          subExercises.map((s, idx) => (idx === sIdx ? { ...s, name: e.target.value } : s))
                        );
                      }}
                      className="w-full bg-transparent border-b border-white/15 focus:border-brand-orange text-white font-bold text-xs py-0.5 outline-none"
                      placeholder={`Task ${sIdx + 1}`}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">Reps</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={sub.reps}
                          onChange={(e) => {
                            const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                            setSubExercises(
                              subExercises.map((s, idx) => (idx === sIdx ? { ...s, reps: val } : s))
                            );
                          }}
                          className="w-full bg-black/60 border border-white/15 focus:border-brand-orange rounded-xl px-2 py-1.5 text-center text-xs font-bold text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-0.5">Carico (kg)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={sub.weight_kg != null && sub.weight_kg > 0 ? String(sub.weight_kg).replace('.', ',') : ''}
                          onChange={(e) => {
                            const parsed = parseWeightInput(e.target.value);
                            setSubExercises(
                              subExercises.map((s, idx) => (idx === sIdx ? { ...s, weight_kg: parsed } : s))
                            );
                          }}
                          placeholder="0 (Libero)"
                          className="w-full bg-black/60 border border-white/15 focus:border-brand-orange rounded-xl px-2 py-1.5 text-center text-xs font-bold text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── ESERCIZIO STANDARD (REPS / ISOMETRY / CARDIO) ── */
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                {/* Serie (Sets) */}
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 block">
                    Serie (Sets)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setSets((prev) => Math.max(minAllowedSets, prev - 1));
                      }}
                      className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={minAllowedSets}
                      value={sets}
                      onChange={(e) => setSets(Math.max(minAllowedSets, parseInt(e.target.value, 10) || minAllowedSets))}
                      className="flex-1 h-9 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl text-center text-white font-black text-base outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setSets((prev) => prev + 1);
                      }}
                      className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Carico / Peso (kg) */}
                <div>
                  <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 block">
                    Carico (kg)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    placeholder="0 (Corpo Libero)"
                    className="w-full h-9 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl text-center text-white font-black text-sm outline-none"
                  />
                </div>
              </div>

              {/* Target: Reps oppure Durata con toggle MAX */}
              {exercise.type === 'isometry' || exercise.type === 'cardio' ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                      Durata Isometrica Target
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setIsMaxDuration(!isMaxDuration);
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase transition-all cursor-pointer ${
                        isMaxDuration
                          ? 'bg-brand-orange text-black border border-brand-orange shadow-sm shadow-brand-orange/30'
                          : 'bg-white/5 text-zinc-400 hover:text-white border border-white/10'
                      }`}
                    >
                      <Flame size={12} className={isMaxDuration ? 'animate-pulse' : ''} />
                      <span>MAX (Sfinimento)</span>
                    </button>
                  </div>

                  {isMaxDuration ? (
                    <div className="w-full bg-brand-orange/15 border border-brand-orange/40 rounded-xl p-3 flex items-center justify-center gap-2 text-brand-orange font-black text-sm">
                      <Flame size={16} className="animate-pulse" />
                      <span>Tenuta Isometrica a Sfinimento (MAX)</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={durationSeconds}
                        onChange={(e) => setDurationSeconds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="flex-1 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl px-3 py-2 text-center text-white font-black text-base outline-none"
                      />
                      <span className="text-xs font-bold text-zinc-400 uppercase">Secondi</span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                      Ripetizioni Target
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setIsMaxReps(!isMaxReps);
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase transition-all cursor-pointer ${
                        isMaxReps
                          ? 'bg-brand-orange text-black border border-brand-orange shadow-sm shadow-brand-orange/30'
                          : 'bg-white/5 text-zinc-400 hover:text-white border border-white/10'
                      }`}
                    >
                      <Flame size={12} className={isMaxReps ? 'animate-pulse' : ''} />
                      <span>MAX (Cedimento)</span>
                    </button>
                  </div>

                  {isMaxReps ? (
                    <div className="w-full bg-brand-orange/15 border border-brand-orange/40 rounded-xl p-3 flex items-center justify-center gap-2 text-brand-orange font-black text-sm">
                      <Flame size={16} className="animate-pulse" />
                      <span>Ripetizioni a Sfinimento (MAX)</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          void hapticLight();
                          setReps((prev) => Math.max(1, prev - 1));
                        }}
                        className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={reps}
                        onChange={(e) => setReps(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="flex-1 h-10 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl text-center text-white font-black text-lg outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void hapticLight();
                          setReps((prev) => prev + 1);
                        }}
                        className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold flex items-center justify-center cursor-pointer active:scale-95"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Recupero tra le serie */}
              <div>
                <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 block">
                  Recupero tra le Serie
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={restSeconds}
                    onChange={(e) => setRestSeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-24 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl px-3 py-1.5 text-center text-white font-black text-sm outline-none"
                  />
                  <span className="text-xs text-zinc-400 font-bold">secondi</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '30s', secs: 30 },
                    { label: '45s', secs: 45 },
                    { label: '60s', secs: 60 },
                    { label: '90s', secs: 90 },
                    { label: '2m', secs: 120 },
                    { label: '3m', secs: 180 },
                  ].map((preset) => (
                    <button
                      key={preset.secs}
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setRestSeconds(preset.secs);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        restSeconds === preset.secs
                          ? 'bg-brand-orange text-black font-black'
                          : 'bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pausa di transizione (recupero dopo l'esercizio prima del successivo) */}
          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 flex items-center gap-1.5">
                <Clock size={13} className="text-brand-orange" />
                Pausa Dopo Questo Esercizio (Transizione)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={transitionRestSeconds}
                onChange={(e) => setTransitionRestSeconds(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-24 bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl px-3 py-1.5 text-center text-white font-black text-sm outline-none"
              />
              <span className="text-xs text-zinc-400 font-bold">secondi (0 = nessuna)</span>
            </div>
          </div>

          {/* Note / Istruzioni Esercizio */}
          <div className="pt-2 border-t border-white/10">
            <label className="text-[11px] uppercase tracking-wider font-bold text-zinc-400 mb-1 flex items-center gap-1.5">
              <FileText size={13} className="text-brand-orange" />
              Note / Istruzioni Esercizio
            </label>
            <textarea
              value={instructionNote}
              onChange={(e) => setInstructionNote(e.target.value)}
              placeholder="Scrivi eventuali note tecniche o personali per questo esercizio..."
              className="w-full min-h-[75px] bg-black/50 border border-white/15 focus:border-brand-orange rounded-xl px-3 py-2 text-white text-xs leading-relaxed outline-none resize-none"
            />
          </div>

          {/* Errore eventuale */}
          {errorMessage && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2 text-red-300 text-xs">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-xs active:scale-95 transition-all shadow-md shadow-brand-orange/30 cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
          >
            {isSaving ? (
              <span>Salvataggio...</span>
            ) : (
              <>
                <Check size={14} />
                <span>Salva Modifiche</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

