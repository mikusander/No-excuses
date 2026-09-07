import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Copy,
  Clock,
  Minus,
  Plus,
  Sparkles,
  History,
  Check,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ExerciseDraft } from '../hooks/useWorkoutBuilder';
import type { UserExerciseHistoryItem } from '../hooks/useUserExerciseHistory';
import { parseExerciseInput, type ParsedWorkoutItem } from '../utils/parseExerciseInput';

interface WorkoutExerciseRowProps {
  exercise: ExerciseDraft;
  index: number;
  totalExercises: number;
  onUpdate: (id: string, field: keyof ExerciseDraft, value: unknown) => void;
  onRemove: (id: string) => void;
  onDuplicate: (index: number) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onApplyParsed: (id: string, parsed: ParsedWorkoutItem) => void;
  onApplyHistory: (id: string, item: UserExerciseHistoryItem) => void;
  searchHistory: (query: string, limit?: number) => UserExerciseHistoryItem[];
  isFocused?: boolean;
}

export const WorkoutExerciseRow: React.FC<WorkoutExerciseRowProps> = ({
  exercise,
  index,
  totalExercises,
  onUpdate,
  onRemove,
  onDuplicate,
  onMove,
  onApplyParsed,
  onApplyHistory,
  searchHistory,
  isFocused,
}) => {
  const { user } = useAuth();
  const [nameInput, setNameInput] = useState(exercise.name);
  const [suggestions, setSuggestions] = useState<UserExerciseHistoryItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sincronizza l'input locale con la prop exercise.name se cambia dall'esterno
  useEffect(() => {
    setNameInput(exercise.name);
  }, [exercise.name]);

  // Gestione click esterno per chiudere il dropdown suggerimenti
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Ricerca nello storico quando l'utente digita
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNameInput(val);
    if (val.trim().length >= 2) {
      const results = searchHistory(val, 4);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  /**
   * Esegue lo Smart String Parser Inline al blur o tasto Invio
   */
  const handleTriggerParse = () => {
    setShowSuggestions(false);
    const trimmed = nameInput.trim();
    if (!trimmed) {
      onUpdate(exercise.id, 'name', '');
      return;
    }

    const parsed = parseExerciseInput(trimmed, exercise.rest_seconds || 90, user?.id);

    if (parsed.matched) {
      onApplyParsed(exercise.id, parsed);
      setNameInput(parsed.name);
      if (parsed.learnedRule) {
        setBannerNotice(
          `💡 Regola Appresa: ${parsed.name} (${parsed.type === 'reps' ? `${parsed.sets}x${parsed.isMaxReps ? 'Max' : parsed.reps}` : parsed.type.toUpperCase()})`
        );
      } else {
        setBannerNotice(
          parsed.type === 'reps'
            ? `✨ Riconosciuto: ${parsed.sets}x${parsed.isMaxReps ? 'Max' : parsed.reps} • ${parsed.rest_seconds}s`
            : `✨ Trasformato in ${parsed.type.toUpperCase()}`
        );
      }
      setTimeout(() => setBannerNotice(null), 3000);
    } else {
      onUpdate(exercise.id, 'name', trimmed);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTriggerParse();
      nameInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleSelectHistoryItem = (item: UserExerciseHistoryItem) => {
    onApplyHistory(exercise.id, item);
    setNameInput(item.name);
    setShowSuggestions(false);
    setBannerNotice(`Memoria utente applicata: ${item.sets}x${item.reps} • ${item.rest_seconds}s`);
    setTimeout(() => setBannerNotice(null), 3000);
  };

  // Controlli Incrementali Rapidi (+ / -)
  const adjustSets = (delta: number) => {
    const next = Math.max(1, (exercise.sets || 3) + delta);
    onUpdate(exercise.id, 'sets', next);
  };

  const adjustReps = (delta: number) => {
    const next = Math.max(0, (exercise.reps || 10) + delta);
    onUpdate(exercise.id, 'reps', next);
  };

  const adjustDuration = (delta: number) => {
    const next = Math.max(5, (exercise.duration_seconds || 30) + delta);
    onUpdate(exercise.id, 'duration_seconds', next);
  };

  const adjustRest = (delta: number) => {
    const next = Math.max(0, (exercise.rest_seconds || 60) + delta);
    onUpdate(exercise.id, 'rest_seconds', next);
  };

  return (
    <div
      ref={containerRef}
      className={`bg-brand-darkGrey/40 border p-4 rounded-3xl flex flex-col space-y-4 relative shadow-lg transition-colors ${
        isFocused ? 'border-brand-orange/70 ring-2 ring-brand-orange/30' : 'border-brand-grey/20'
      }`}
    >
      {/* Header Esercizio: Frecce Ordine, Duplica ed Elimina */}
      <div className="flex justify-between items-center bg-black/30 -mx-4 -mt-4 p-3 rounded-t-3xl border-b border-white/5">
        <div className="flex space-x-1">
          <button
            type="button"
            onClick={() => onMove(index, 'up')}
            disabled={index === 0}
            className="p-1.5 text-brand-grey hover:text-white hover:bg-white/10 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Sposta su"
          >
            <ChevronUp size={20} />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, 'down')}
            disabled={index === totalExercises - 1}
            className="p-1.5 text-brand-grey hover:text-white hover:bg-white/10 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Sposta giù"
          >
            <ChevronDown size={20} />
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold text-brand-grey/60 tracking-wider">
            ESERCIZIO {index + 1}
          </span>
          {exercise.type !== 'reps' && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange uppercase border border-brand-orange/30">
              {exercise.type}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => onDuplicate(index)}
            className="p-1.5 text-brand-grey/60 hover:text-brand-orange hover:bg-brand-orange/10 rounded-md transition-colors"
            title="Duplica esercizio"
          >
            <Copy size={18} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(exercise.id)}
            className="p-1.5 text-brand-grey/60 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
            title="Elimina esercizio"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      {/* Banner Notifica (Inline Parse o Autofill Memoria) */}
      {bannerNotice && (
        <div className="bg-brand-orange/15 border border-brand-orange/30 text-brand-orange text-xs px-3 py-1.5 rounded-xl flex items-center justify-between animate-fade-in">
          <div className="flex items-center space-x-1.5">
            <Sparkles size={14} />
            <span className="font-semibold">{bannerNotice}</span>
          </div>
          <Check size={14} />
        </div>
      )}

      {/* Campo Nome Esercizio con Autocomplete e Inline Parser */}
      <div className="relative">
        <div className="relative flex items-center">
          <input
            ref={nameInputRef}
            type="text"
            placeholder="Nome esercizio (es. spinte brutte 4x8 90s, squat 15-12-10-8, EMOM 10'...)"
            value={nameInput}
            onChange={handleNameChange}
            onBlur={handleTriggerParse}
            onKeyDown={handleNameKeyDown}
            className="w-full bg-black/50 border border-brand-grey/20 rounded-xl px-4 py-3 text-white placeholder:text-brand-grey/40 focus:border-brand-orange focus:outline-none transition-colors text-base font-medium pr-10"
          />
          {suggestions.length > 0 && (
            <span className="absolute right-3 text-brand-orange/60 pointer-events-none" title="Suggerimenti disponibili">
              <History size={16} />
            </span>
          )}
        </div>

        {/* Dropdown Suggerimenti dallo Storico Utente */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#181818] border border-brand-orange/30 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-white/5 backdrop-blur-md">
            <div className="p-2 bg-black/40 text-[10px] uppercase font-bold text-brand-grey/60 tracking-wider flex items-center">
              <History size={11} className="mr-1.5 text-brand-orange" />
              Usato nelle tue sessioni precedenti (clicca per autofill)
            </div>
            {suggestions.map((item, sIdx) => (
              <button
                key={sIdx}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // Evita il blur dell'input prima della selezione
                  handleSelectHistoryItem(item);
                }}
                className="w-full text-left p-3 hover:bg-brand-orange/15 transition-colors flex items-center justify-between group"
              >
                <div>
                  <div className="text-sm font-semibold text-white group-hover:text-brand-orange transition-colors">
                    {item.name}
                  </div>
                  <div className="text-xs text-brand-grey/70 mt-0.5">
                    {item.sets} serie × {item.reps} reps • {item.rest_seconds}s recupero
                    {item.weight_kg != null ? ` • ${item.weight_kg} kg` : ''}
                  </div>
                </div>
                <span className="text-[11px] font-bold text-brand-orange opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                  Applica <Check size={12} className="ml-1" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Note opzionali */}
      <div>
        <textarea
          rows={1}
          value={exercise.instruction_note || ''}
          onChange={(e) => onUpdate(exercise.id, 'instruction_note', e.target.value)}
          placeholder="Note d'esecuzione (opzionale)"
          className="w-full bg-black/30 border border-brand-grey/15 rounded-xl px-3 py-2 text-white text-xs placeholder:text-brand-grey/40 focus:border-brand-orange focus:outline-none transition-colors resize-none"
        />
      </div>

      {/* Tipo Esercizio: Reps vs Isometria */}
      <div className="flex space-x-2 bg-black/40 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => onUpdate(exercise.id, 'type', 'reps')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
            exercise.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'
          }`}
        >
          REPS
        </button>
        <button
          type="button"
          onClick={() => onUpdate(exercise.id, 'type', 'isometry')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
            exercise.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'
          }`}
        >
          ISOMETRIA
        </button>
      </div>

      {/* Parametri Numerici con Stepper (+/-) Rapidi */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Serie (Sets) */}
        <div className="bg-black/30 border border-brand-grey/15 rounded-xl p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-grey/70 mb-1.5">
            Serie
          </span>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => adjustSets(-1)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-orange/20 hover:text-brand-orange flex items-center justify-center text-white transition-colors"
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              min="1"
              value={exercise.sets || 3}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onUpdate(exercise.id, 'sets', Number.isNaN(val) ? 1 : Math.max(1, val));
              }}
              className="w-12 text-center bg-transparent text-white font-bold text-lg focus:outline-none"
            />
            <button
              type="button"
              onClick={() => adjustSets(1)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-orange/20 hover:text-brand-orange flex items-center justify-center text-white transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Ripetizioni o Tempo */}
        <div className="bg-black/30 border border-brand-grey/15 rounded-xl p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-grey/70 mb-1.5">
            {exercise.type === 'isometry' ? 'Durata (sec)' : 'Ripetizioni'}
          </span>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => (exercise.type === 'isometry' ? adjustDuration(-5) : adjustReps(-1))}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-orange/20 hover:text-brand-orange flex items-center justify-center text-white transition-colors"
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              min="0"
              value={exercise.type === 'isometry' ? (exercise.duration_seconds || 30) : (exercise.reps || 10)}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                const safeVal = Number.isNaN(val) ? 0 : Math.max(0, val);
                if (exercise.type === 'isometry') {
                  onUpdate(exercise.id, 'duration_seconds', safeVal);
                } else {
                  onUpdate(exercise.id, 'reps', safeVal);
                }
              }}
              className="w-12 text-center bg-transparent text-white font-bold text-lg focus:outline-none"
            />
            <button
              type="button"
              onClick={() => (exercise.type === 'isometry' ? adjustDuration(5) : adjustReps(1))}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-orange/20 hover:text-brand-orange flex items-center justify-center text-white transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Recupero (Rest) */}
        <div className="bg-black/30 border border-brand-grey/15 rounded-xl p-2.5 flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-grey/70 mb-1.5 flex items-center">
            <Clock size={11} className="mr-1 text-brand-orange" />
            Recupero (sec)
          </span>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => adjustRest(-15)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-orange/20 hover:text-brand-orange flex items-center justify-center text-white transition-colors"
              title="-15s"
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              min="0"
              step="15"
              value={exercise.rest_seconds ?? 90}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onUpdate(exercise.id, 'rest_seconds', Number.isNaN(val) ? 0 : Math.max(0, val));
              }}
              className="w-12 text-center bg-transparent text-brand-orange font-bold text-lg focus:outline-none"
            />
            <button
              type="button"
              onClick={() => adjustRest(15)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-orange/20 hover:text-brand-orange flex items-center justify-center text-white transition-colors"
              title="+15s"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkoutExerciseRow;
