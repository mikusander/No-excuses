/**
 * WorkoutRecoveryPromptModal.tsx — Prompt di ripristino per allenamento interrotto all'avvio dell'app.
 *
 * Mostra all'utente la possibilità di riprendere esattamente da dove era rimasto
 * o scartare la sessione non conclusa formalmente.
 */
import React from 'react';
import { RotateCcw, Trash2, Clock, Dumbbell } from 'lucide-react';
import { hapticMedium, hapticLight } from '../utils/haptics';

interface WorkoutRecoveryPromptModalProps {
  isOpen: boolean;
  workoutName?: string;
  currentExerciseName?: string;
  currentSetIdx?: number;
  totalSets?: number;
  savedAtMs?: number;
  onResume: () => void;
  onDiscard: () => void;
}

const formatRelativeTime = (timestampMs?: number): string => {
  if (!timestampMs) return 'Poco fa';
  const diffSecs = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSecs < 60) return 'Meno di un minuto fa';
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins} ${mins === 1 ? 'minuto' : 'minuti'} fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'ora' : 'ore'} fa`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'giorno' : 'giorni'} fa`;
};

export const WorkoutRecoveryPromptModal: React.FC<WorkoutRecoveryPromptModalProps> = ({
  isOpen,
  workoutName,
  currentExerciseName,
  currentSetIdx = 0,
  totalSets,
  savedAtMs,
  onResume,
  onDiscard,
}) => {
  if (!isOpen) return null;

  const handleResume = () => {
    void hapticMedium();
    onResume();
  };

  const handleDiscard = () => {
    void hapticLight();
    onDiscard();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in"
    >
      <div className="w-full max-w-sm rounded-3xl bg-[#1C1C1E] border border-brand-orange/40 shadow-2xl p-6 relative overflow-hidden text-center">
        {/* Glow arancione */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-brand-orange/20 blur-3xl pointer-events-none" />

        {/* Icona Header */}
        <div className="w-14 h-14 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 text-brand-orange flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-orange/10">
          <RotateCcw size={28} className="animate-spin-slow" />
        </div>

        {/* Titolo e Domanda Prompt */}
        <h3 className="text-xl font-black text-white tracking-tight mb-2">
          Allenamento Interrotto
        </h3>
        <p className="text-sm text-brand-grey/90 leading-relaxed mb-5">
          Hai un allenamento interrotto. Vuoi riprenderlo da dove eri rimasto o scartarlo?
        </p>

        {/* Card Dettagli Sessione */}
        <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-left mb-6 space-y-2">
          <div className="flex items-center gap-2 text-white font-bold text-sm truncate">
            <Dumbbell size={15} className="text-brand-orange shrink-0" />
            <span className="truncate">{workoutName || 'Allenamento'}</span>
          </div>

          {currentExerciseName && (
            <p className="text-xs text-brand-grey/80 pl-6">
              Esercizio: <strong className="text-white">{currentExerciseName}</strong> (Set {currentSetIdx + 1}
              {totalSets ? ` di ${totalSets}` : ''})
            </p>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-brand-grey/60 pt-1 border-t border-white/5">
            <Clock size={12} className="text-brand-orange" />
            <span>Ultimo salvataggio: {formatRelativeTime(savedAtMs)}</span>
          </div>
        </div>

        {/* Azioni */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleResume}
            className="w-full py-3.5 px-4 rounded-xl bg-brand-orange hover:bg-brand-lightOrange active:scale-[0.98] text-black font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-brand-orange/25 transition-all cursor-pointer"
          >
            <RotateCcw size={16} />
            <span>Riprendi da dove eri rimasto</span>
          </button>

          <button
            type="button"
            onClick={handleDiscard}
            className="w-full py-3 px-4 rounded-xl bg-white/5 hover:bg-red-500/15 border border-white/5 hover:border-red-500/30 text-brand-grey/80 hover:text-red-300 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Trash2 size={14} />
            <span>Scarta allenamento</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutRecoveryPromptModal;
