import React, { memo } from 'react';
import {
  X,
  FileText,
  Flame,
  Video,
  Smartphone,
} from 'lucide-react';
import type {
  Exercise,
  InstructionModalContext,
  NoteModalContext,
} from './types';
import { WorkoutCelebrationModal } from '../WorkoutCelebrationModal';

export interface ActiveWorkoutModalsProps {
  // Exercise Note Modal
  isNoteModalOpen: boolean;
  noteModalContext: NoteModalContext | null;
  currentExerciseName: string;
  noteModalDraft: string;
  onNoteModalDraftChange: (text: string) => void;
  onCloseNoteModal: () => void;
  onSaveNoteModal: () => void;

  // Instruction Modal
  isInstructionModalOpen: boolean;
  instructionModalContext: InstructionModalContext | null;
  onCloseInstructionModal: () => void;

  // Auto-count Choice Modal
  isAutoCountModalOpen: boolean;
  autoCountExerciseName?: string;
  autoCountTargetReps?: number;
  onChooseCameraAutoCount: () => void;
  onChooseAccelerometerAutoCount: () => void;
  onCloseAutoCountModal: () => void;

  // MAX / Sfinimento Prompt Modal
  isMaxPromptModalOpen: boolean;
  maxPromptExercise: Exercise | null;
  targetEditingSetIdx: number;
  currentSetIdx: number;
  isPendingSetAdvance: boolean;
  modalPerformanceValue: number;
  setModalPerformanceValue: React.Dispatch<React.SetStateAction<number>>;
  onSaveMaxPerformance: (value: number) => void;
  onSkipMaxPerformance?: () => void;
  onCloseMaxPromptModal: () => void;

  // Workout Celebration Modal
  isCelebrationOpen: boolean;
  workoutName?: string;
  workoutDurationSeconds: number;
  exercisesCompletedCount?: number;
  onCelebrationComplete: () => void;
}

const isMaxTarget = (val: unknown): boolean => {
  if (val === 0 || val === '0' || val === -1 || val === '-1') return true;
  if (typeof val === 'string' && val.trim().toLowerCase() === 'max') return true;
  return false;
};

const getPerformanceUnit = (exercise?: Exercise | null): 'sec' | 'reps' => {
  if (!exercise) return 'reps';
  return exercise.type === 'isometry' ? 'sec' : 'reps';
};

export const ActiveWorkoutModals: React.FC<ActiveWorkoutModalsProps> = memo(({
  // Exercise Note Modal
  isNoteModalOpen,
  noteModalContext,
  currentExerciseName,
  noteModalDraft,
  onNoteModalDraftChange,
  onCloseNoteModal,
  onSaveNoteModal,

  // Instruction Modal
  isInstructionModalOpen,
  instructionModalContext,
  onCloseInstructionModal,

  // Auto-count Choice Modal
  isAutoCountModalOpen,
  autoCountExerciseName,
  autoCountTargetReps,
  onChooseCameraAutoCount,
  onChooseAccelerometerAutoCount,
  onCloseAutoCountModal,

  // MAX / Sfinimento Prompt Modal
  isMaxPromptModalOpen,
  maxPromptExercise,
  targetEditingSetIdx,
  currentSetIdx,
  isPendingSetAdvance,
  modalPerformanceValue,
  setModalPerformanceValue,
  onSaveMaxPerformance,
  onSkipMaxPerformance,
  onCloseMaxPromptModal,

  // Workout Celebration Modal
  isCelebrationOpen,
  workoutName,
  workoutDurationSeconds,
  exercisesCompletedCount,
  onCelebrationComplete,
}) => {
  return (
    <>
      {/* Exercise Note Modal */}
      {isNoteModalOpen && (
        <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-brand-darkGrey/95 border border-white/10 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText size={18} className="text-brand-orange" />
                  <span>Note Esercizio</span>
                </h3>
                <p className="text-xs text-brand-grey mt-0.5 truncate max-w-[280px]">
                  {noteModalContext?.name || currentExerciseName || 'Esercizio'}
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseNoteModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                title="Chiudi note"
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <textarea
                value={noteModalDraft}
                onChange={(e) => onNoteModalDraftChange(e.target.value)}
                placeholder="Scrivi le considerazioni per questo esercizio..."
                className="w-full min-h-[150px] bg-black/40 border border-brand-grey/20 rounded-xl px-4 py-3 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none"
                autoFocus
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCloseNoteModal}
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={onSaveNoteModal}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black active:scale-95 shadow-md cursor-pointer"
              >
                Salva Nota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instruction Modal */}
      {isInstructionModalOpen && instructionModalContext && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-orange/25 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Istruzioni Esercizio</h3>
                <p className="text-xs text-brand-grey mt-1">{instructionModalContext.exerciseName}</p>
              </div>
              <button
                onClick={onCloseInstructionModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                title="Chiudi istruzioni"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {instructionModalContext.note && (
                <div className="bg-black/40 border border-brand-orange/25 rounded-xl px-4 py-3">
                  <p className="text-xs uppercase tracking-wider font-bold text-brand-orange/90 mb-2">Nota Principale</p>
                  <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">{instructionModalContext.note}</p>
                </div>
              )}

              {instructionModalContext.items.map((item, idx) => (
                <div key={`${item.name}-${idx}`} className="bg-black/40 border border-white/10 rounded-xl px-4 py-3">
                  <p className="text-xs uppercase tracking-wider font-bold text-brand-orange/90 mb-2">{item.name}</p>
                  <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">{item.note}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={onCloseInstructionModal}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black cursor-pointer"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Count Choice Modal */}
      {isAutoCountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl bg-brand-dark p-6 shadow-2xl border border-white/10">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-black text-white uppercase tracking-wider">Scegli Metodo</h3>
              <button
                onClick={onCloseAutoCountModal}
                className="text-brand-grey hover:text-white transition-colors p-2 cursor-pointer"
              >
                <X size={24} />
              </button>
            </div>

            <p className="text-brand-grey mb-8 text-sm">
              Come preferisci contare le tue {autoCountTargetReps || 0} ripetizioni di {autoCountExerciseName || 'questo esercizio'}?
            </p>

            <div className="flex flex-col gap-4">
              <button
                onClick={onChooseCameraAutoCount}
                className="w-full bg-brand-darkGrey/60 border border-purple-500/50 rounded-2xl p-4 flex items-center gap-4 hover:bg-purple-500/20 transition-colors group cursor-pointer"
              >
                <div className="bg-purple-500/20 p-3 rounded-xl group-hover:bg-purple-500/40 transition-colors flex-shrink-0">
                  <Video size={24} className="text-purple-400" />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-bold text-lg uppercase tracking-wide">Fotocamera</h4>
                  <p className="text-brand-grey text-xs mt-1">Appoggia il telefono ed esegui a vista</p>
                </div>
              </button>

              <button
                onClick={onChooseAccelerometerAutoCount}
                className="w-full bg-brand-darkGrey/60 border border-brand-orange/50 rounded-2xl p-4 flex items-center gap-4 hover:bg-brand-orange/20 transition-colors group cursor-pointer"
              >
                <div className="bg-brand-orange/20 p-3 rounded-xl group-hover:bg-brand-orange/40 transition-colors flex-shrink-0">
                  <Smartphone size={24} className="text-brand-orange" />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-bold text-lg uppercase tracking-wide">Accelerometro</h4>
                  <p className="text-brand-grey text-xs mt-1">Tieni il telefono in tasca o a contatto</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAX / Sfinimento Prompt Modal */}
      {isMaxPromptModalOpen && maxPromptExercise && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-brand-orange/40 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-brand-orange/20 text-brand-orange">
                  <Flame size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-wider">
                    Set {targetEditingSetIdx + 1} {isMaxTarget(maxPromptExercise.reps) || (maxPromptExercise.type === 'isometry' && isMaxTarget(maxPromptExercise.duration_seconds)) ? '· A Sfinimento' : '· Modifica Set'}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {maxPromptExercise.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseMaxPromptModal}
                className="text-zinc-400 hover:text-white p-1 cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-zinc-300 text-center">
              Inserisci {getPerformanceUnit(maxPromptExercise) === 'sec' ? 'i secondi di tenuta' : 'le ripetizioni'} per questo set:
            </p>

            <div className="flex items-center justify-center gap-2 py-2">
              <button
                type="button"
                onClick={() => setModalPerformanceValue((prev) => Math.max(0, prev - 5))}
                className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
              >
                -5
              </button>
              <button
                type="button"
                onClick={() => setModalPerformanceValue((prev) => Math.max(0, prev - 1))}
                className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-lg flex items-center justify-center transition-all border border-white/5 cursor-pointer"
              >
                -1
              </button>

              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={modalPerformanceValue > 0 ? modalPerformanceValue : ''}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setModalPerformanceValue(Number.isFinite(val) && val >= 0 ? Math.trunc(val) : 0);
                }}
                placeholder="0"
                autoFocus
                className="w-24 h-14 bg-black/60 border-2 border-brand-orange rounded-2xl text-center text-3xl font-mono font-black text-brand-orange focus:outline-none"
              />

              <button
                type="button"
                onClick={() => setModalPerformanceValue((prev) => prev + 1)}
                className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-lg flex items-center justify-center transition-all border border-white/5 cursor-pointer"
              >
                +1
              </button>
              <button
                type="button"
                onClick={() => setModalPerformanceValue((prev) => prev + 5)}
                className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
              >
                +5
              </button>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={() => onSaveMaxPerformance(modalPerformanceValue)}
                className="w-full py-3.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-sm uppercase tracking-wider transition-colors shadow-lg shadow-brand-orange/20 cursor-pointer"
              >
                {targetEditingSetIdx === currentSetIdx && isPendingSetAdvance
                  ? 'Salva e Continua'
                  : 'Salva'}
              </button>
              {targetEditingSetIdx === currentSetIdx && isPendingSetAdvance && onSkipMaxPerformance && (
                <button
                  type="button"
                  onClick={onSkipMaxPerformance}
                  className="text-xs text-zinc-400 hover:text-zinc-200 py-1 transition-colors cursor-pointer"
                >
                  Salta / Lascia MAX
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Workout Celebration Modal */}
      <WorkoutCelebrationModal
        isOpen={isCelebrationOpen}
        workoutName={workoutName}
        durationSeconds={workoutDurationSeconds}
        exercisesCompletedCount={exercisesCompletedCount}
        onComplete={onCelebrationComplete}
      />
    </>
  );
});

ActiveWorkoutModals.displayName = 'ActiveWorkoutModals';
