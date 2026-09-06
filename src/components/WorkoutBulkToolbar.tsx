import React, { useState } from 'react';
import { Clock, Layers, Sparkles, Check, ArrowRight } from 'lucide-react';
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
  const [customRestInput, setCustomRestInput] = useState('');
  const [customSetsInput, setCustomSetsInput] = useState('');

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

  const handleCustomRestSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const sec = parseInt(customRestInput.trim(), 10);
    if (!Number.isNaN(sec) && sec >= 0) {
      onApplyGlobalRest(sec);
      setLastActionMessage(`Recupero personalizzato: ${sec}s impostati su ${exercises.length} esercizi`);
      setTimeout(() => setLastActionMessage(null), 2500);
      setCustomRestInput('');
    }
  };

  const handleCustomSetsSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const s = parseInt(customSetsInput.trim(), 10);
    if (!Number.isNaN(s) && s >= 1) {
      onApplyGlobalSets(s);
      setLastActionMessage(`Serie personalizzate: ${s} serie impostate su ${exercises.length} esercizi`);
      setTimeout(() => setLastActionMessage(null), 2500);
      setCustomSetsInput('');
    }
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Sezione Recupero Globale */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-brand-grey/70 font-medium">
            <span className="flex items-center">
              <Clock size={12} className="mr-1 text-brand-orange/80" />
              Recupero Globale:
            </span>
            {currentCommonRest !== null && (
              <span className="text-[10px] text-brand-orange font-mono font-bold">
                Attuale: {currentCommonRest}s
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {REST_PRESETS.map((seconds) => {
              const isActive = currentCommonRest === seconds;
              return (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => handleRestClick(seconds)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all active:scale-95 cursor-pointer ${
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

            {/* Input Personalizzato Recupero */}
            <form onSubmit={handleCustomRestSubmit} className="flex items-center space-x-1">
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="999"
                  placeholder="Altro"
                  value={customRestInput}
                  onChange={(e) => setCustomRestInput(e.target.value)}
                  className="w-16 px-2 py-1 text-xs text-center rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-brand-grey/40 focus:border-brand-orange outline-none transition-colors"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-brand-grey/40 pointer-events-none">s</span>
              </div>
              <button
                type="submit"
                disabled={!customRestInput.trim() || Number(customRestInput) < 0}
                className="px-2 py-1 text-xs font-bold rounded-lg bg-brand-orange/20 hover:bg-brand-orange text-brand-orange hover:text-black border border-brand-orange/30 transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 cursor-pointer flex items-center space-x-0.5"
                title="Applica recupero personalizzato a tutti gli esercizi"
              >
                <span>Applica</span>
                <ArrowRight size={11} />
              </button>
            </form>
          </div>
        </div>

        {/* Sezione Uniforma Serie */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-brand-grey/70 font-medium">
            <span className="flex items-center">
              <Layers size={12} className="mr-1 text-brand-orange/80" />
              Uniforma Serie:
            </span>
            {currentCommonSets !== null && (
              <span className="text-[10px] text-brand-orange font-mono font-bold">
                Attuale: {currentCommonSets} serie
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {SETS_PRESETS.map((sets) => {
              const isActive = currentCommonSets === sets;
              return (
                <button
                  key={sets}
                  type="button"
                  onClick={() => handleSetsClick(sets)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all active:scale-95 cursor-pointer ${
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

            {/* Input Personalizzato Serie */}
            <form onSubmit={handleCustomSetsSubmit} className="flex items-center space-x-1">
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="50"
                placeholder="Altro"
                value={customSetsInput}
                onChange={(e) => setCustomSetsInput(e.target.value)}
                className="w-14 px-2 py-1 text-xs text-center rounded-lg bg-black/40 border border-white/10 text-white placeholder:text-brand-grey/40 focus:border-brand-orange outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={!customSetsInput.trim() || Number(customSetsInput) < 1}
                className="px-2 py-1 text-xs font-bold rounded-lg bg-brand-orange/20 hover:bg-brand-orange text-brand-orange hover:text-black border border-brand-orange/30 transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 cursor-pointer flex items-center space-x-0.5"
                title="Applica numero di serie personalizzato a tutti gli esercizi"
              >
                <span>Applica</span>
                <ArrowRight size={11} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkoutBulkToolbar;
