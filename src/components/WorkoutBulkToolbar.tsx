import React, { useState } from 'react';
import { Clock, Layers, Sparkles, Check } from 'lucide-react';
import type { ExerciseDraft } from '../hooks/useWorkoutBuilder';

interface WorkoutBulkToolbarProps {
  exercises: ExerciseDraft[];
  onApplyGlobalRest: (seconds: number) => void;
  onApplyGlobalSets: (sets: number) => void;
}

const REST_PRESETS = [45, 60, 90, 120, 180];
const SETS_PRESETS = [3, 4, 5];

export const WorkoutBulkToolbar: React.FC<WorkoutBulkToolbarProps> = ({
  exercises,
  onApplyGlobalRest,
  onApplyGlobalSets,
}) => {
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);

  if (exercises.length === 0) {
    return null;
  }

  // Controlla se tutti gli esercizi condividono lo stesso recupero
  const currentCommonRest = exercises.length > 0 && exercises.every(e => e.rest_seconds === exercises[0].rest_seconds)
    ? exercises[0].rest_seconds
    : null;

  // Controlla se tutti gli esercizi condividono lo stesso numero di serie
  const currentCommonSets = exercises.length > 0 && exercises.every(e => e.sets === exercises[0].sets)
    ? exercises[0].sets
    : null;

  const handleRestClick = (seconds: number) => {
    onApplyGlobalRest(seconds);
    setLastActionMessage(`Recupero impostato a ${seconds}s per ${exercises.length} esercizi`);
    setTimeout(() => setLastActionMessage(null), 2500);
  };

  const handleSetsClick = (sets: number) => {
    onApplyGlobalSets(sets);
    setLastActionMessage(`${sets} serie applicate a ${exercises.length} esercizi`);
    setTimeout(() => setLastActionMessage(null), 2500);
  };

  return (
    <div className="bg-brand-darkGrey/30 border border-brand-grey/20 rounded-2xl p-3 sm:p-4 mb-5 backdrop-blur-sm relative overflow-hidden transition-all shadow-md">
      {/* Intestazione Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="p-1 rounded-lg bg-brand-orange/15 text-brand-orange">
            <Sparkles size={14} />
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-brand-grey/80">
            Azioni Rapide su Tutta la Scheda ({exercises.length} {exercises.length === 1 ? 'es.' : 'es.'})
          </span>
        </div>

        {lastActionMessage && (
          <div className="flex items-center text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full animate-fade-in">
            <Check size={12} className="mr-1" />
            {lastActionMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Sezione Recupero Globale */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center text-[11px] text-brand-grey/70 font-medium">
            <Clock size={12} className="mr-1 text-brand-orange/80" />
            Recupero Globale:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REST_PRESETS.map((seconds) => {
              const isActive = currentCommonRest === seconds;
              return (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => handleRestClick(seconds)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all active:scale-95 ${
                    isActive
                      ? 'bg-brand-orange text-black border-brand-orange shadow-sm shadow-brand-orange/30 ring-1 ring-brand-orange/50'
                      : 'bg-black/40 text-brand-grey/90 border-white/10 hover:border-brand-orange/40 hover:text-white'
                  }`}
                  title={`Imposta ${seconds}s di riposo per tutti gli esercizi`}
                >
                  {seconds}s
                </button>
              );
            })}
          </div>
        </div>

        {/* Sezione Uniforma Serie */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center text-[11px] text-brand-grey/70 font-medium">
            <Layers size={12} className="mr-1 text-brand-orange/80" />
            Uniforma Serie:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SETS_PRESETS.map((sets) => {
              const isActive = currentCommonSets === sets;
              return (
                <button
                  key={sets}
                  type="button"
                  onClick={() => handleSetsClick(sets)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all active:scale-95 ${
                    isActive
                      ? 'bg-brand-orange text-black border-brand-orange shadow-sm shadow-brand-orange/30 ring-1 ring-brand-orange/50'
                      : 'bg-black/40 text-brand-grey/90 border-white/10 hover:border-brand-orange/40 hover:text-white'
                  }`}
                  title={`Imposta ${sets} serie per tutti gli esercizi`}
                >
                  {sets} Serie
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkoutBulkToolbar;
