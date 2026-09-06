import { useState, useCallback } from 'react';
import type { ParsedWorkoutItem } from '../utils/parseExerciseInput';
import type { UserExerciseHistoryItem } from './useUserExerciseHistory';

export type ExerciseType = 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';

export interface ExerciseDraft {
  id: string;
  type: ExerciseType;
  name: string;
  instruction_note?: string;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  emom_rounds?: number;
  emom_round_duration?: number;
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
  }[];
}

export const DEFAULT_EXERCISE_SETS = 3;
export const DEFAULT_EXERCISE_REPS = 10;
export const DEFAULT_EXERCISE_REST = 90;
export const DEFAULT_EXERCISE_DURATION = 30;

export function useWorkoutBuilder(initialExercises: ExerciseDraft[] = []) {
  const [exercises, setExercises] = useState<ExerciseDraft[]>(initialExercises);

  /**
   * TECNICA 2: Carry-Over Pattern (Default Inheritance)
   * Aggiunge un nuovo esercizio ereditando sets, reps e rest dall'ultimo esercizio presente.
   * Se la lista è vuota, usa default neutri (3 serie, 10 reps, 90s rest).
   */
  const addExercise = useCallback((customType: ExerciseType = 'reps') => {
    setExercises(prev => {
      const lastEx = prev[prev.length - 1];

      const inheritedSets = lastEx && Number.isFinite(lastEx.sets) && lastEx.sets > 0
        ? lastEx.sets
        : DEFAULT_EXERCISE_SETS;

      const inheritedReps = lastEx && Number.isFinite(lastEx.reps) && lastEx.reps > 0
        ? lastEx.reps
        : DEFAULT_EXERCISE_REPS;

      const inheritedRest = lastEx && Number.isFinite(lastEx.rest_seconds) && lastEx.rest_seconds >= 0
        ? lastEx.rest_seconds
        : DEFAULT_EXERCISE_REST;

      const inheritedDuration = lastEx && Number.isFinite(lastEx.duration_seconds) && lastEx.duration_seconds > 0
        ? lastEx.duration_seconds
        : DEFAULT_EXERCISE_DURATION;

      const newRow: ExerciseDraft = {
        id: crypto.randomUUID(),
        type: customType,
        name: '',
        instruction_note: '',
        sets: inheritedSets,
        reps: inheritedReps,
        duration_seconds: inheritedDuration,
        rest_seconds: inheritedRest,
        transition_rest_seconds: 0,
        weight_kg: null,
      };

      return [...prev, newRow];
    });
  }, []);

  /**
   * TECNICA 3: Azioni Cumulative / Bulk Edit su Tutta la Scheda
   * Recupero Globale: aggiorna rest_seconds per tutti gli esercizi presenti.
   */
  const applyGlobalRest = useCallback((seconds: number) => {
    if (seconds < 0) return;
    setExercises(prev =>
      prev.map(ex => {
        const updated = { ...ex, rest_seconds: seconds };
        if (ex.pyramid_steps && ex.pyramid_steps.length > 0) {
          updated.pyramid_steps = ex.pyramid_steps.map(step => ({
            ...step,
            rest_seconds: seconds,
          }));
        }
        return updated;
      })
    );
  }, []);

  /**
   * TECNICA 3: Uniforma Serie
   * Applica a tutti gli esercizi lo stesso volume di serie/round.
   */
  const applyGlobalSets = useCallback((sets: number) => {
    if (sets < 1) return;
    setExercises(prev =>
      prev.map(ex => {
        if (ex.type === 'emom') {
          return { ...ex, sets, emom_rounds: sets };
        }
        if (ex.type === 'pyramid') {
          return ex; // In pyramid le serie sono il numero di step
        }
        return { ...ex, sets };
      })
    );
  }, []);

  /**
   * TECNICA 1: Autofill dallo Storico Utente
   */
  const applyHistoryItem = useCallback((id: string, item: UserExerciseHistoryItem) => {
    setExercises(prev =>
      prev.map(ex => {
        if (ex.id !== id) return ex;
        return {
          ...ex,
          name: item.name,
          type: item.type || ex.type || 'reps',
          sets: item.sets || ex.sets || DEFAULT_EXERCISE_SETS,
          reps: item.reps || ex.reps || DEFAULT_EXERCISE_REPS,
          duration_seconds: item.duration_seconds || ex.duration_seconds || DEFAULT_EXERCISE_DURATION,
          rest_seconds: item.rest_seconds ?? ex.rest_seconds ?? DEFAULT_EXERCISE_REST,
          weight_kg: item.weight_kg ?? null,
        };
      })
    );
  }, []);

  /**
   * TECNICA 4: Smart String Parser Inline
   * Popola e trasforma l'esercizio in base all'output del parser.
   */
  const applyParsedInput = useCallback((id: string, parsed: ParsedWorkoutItem) => {
    if (!parsed.matched) return;

    setExercises(prev =>
      prev.map(ex => {
        if (ex.id !== id) return ex;

        if (parsed.type === 'emom') {
          return {
            ...ex,
            type: 'emom',
            name: parsed.name,
            sets: parsed.sets,
            emom_rounds: parsed.emom_rounds || parsed.sets,
            emom_round_duration: parsed.emom_round_duration || 60,
            rest_seconds: parsed.rest_seconds,
            subExercises: (parsed.subExercises || []).map(s => ({
              name: s.name,
              type: s.type,
              reps: s.reps,
              duration_seconds: s.duration_seconds,
              weight_kg: s.weight_kg ?? null,
            })),
          };
        }

        if (parsed.type === 'circuit') {
          return {
            ...ex,
            type: 'circuit',
            name: parsed.name,
            sets: parsed.sets,
            rest_seconds: parsed.rest_seconds,
            subExercises: (parsed.subExercises || []).map(s => ({
              name: s.name,
              type: s.type,
              reps: s.reps,
              duration_seconds: s.duration_seconds,
              weight_kg: s.weight_kg ?? null,
            })),
          };
        }

        if (parsed.type === 'superset') {
          return {
            ...ex,
            type: 'superset',
            name: parsed.name,
            sets: parsed.sets,
            rest_seconds: parsed.rest_seconds,
            subExercises: (parsed.subExercises || []).map(s => ({
              name: s.name,
              type: s.type,
              reps: s.reps,
              duration_seconds: s.duration_seconds,
              weight_kg: s.weight_kg ?? null,
            })),
          };
        }

        if (parsed.type === 'pyramid') {
          return {
            ...ex,
            type: 'pyramid',
            name: parsed.name,
            sets: 1,
            rest_seconds: 0,
            pyramid_steps: (parsed.pyramid_steps || []).map(step => ({
              reps: step.reps,
              rest_seconds: step.rest_seconds,
              weight_kg: step.weight_kg ?? null,
            })),
          };
        }

        if (parsed.type === 'isometry') {
          return {
            ...ex,
            type: 'isometry',
            name: parsed.name,
            sets: parsed.sets,
            reps: 0,
            duration_seconds: parsed.duration_seconds,
            rest_seconds: parsed.rest_seconds,
          };
        }

        // Standard reps
        return {
          ...ex,
          type: 'reps',
          name: parsed.name,
          sets: parsed.sets,
          reps: parsed.reps,
          rest_seconds: parsed.rest_seconds,
        };
      })
    );
  }, []);

  /** Aggiornamento campo singolo */
  const updateExercise = useCallback((id: string, field: keyof ExerciseDraft, value: unknown) => {
    setExercises(prev =>
      prev.map(ex => {
        if (ex.id !== id) return ex;
        return { ...ex, [field]: value };
      })
    );
  }, []);

  /** Rimozione */
  const removeExercise = useCallback((id: string) => {
    setExercises(prev => prev.filter(ex => ex.id !== id));
  }, []);

  /** Duplicazione */
  const duplicateExercise = useCallback((index: number) => {
    setExercises(prev => {
      const target = prev[index];
      if (!target) return prev;
      const clone: ExerciseDraft = JSON.parse(JSON.stringify(target));
      clone.id = crypto.randomUUID();
      const next = [...prev];
      next.splice(index + 1, 0, clone);
      return next;
    });
  }, []);

  /** Spostamento ordine */
  const moveExercise = useCallback((index: number, direction: 'up' | 'down') => {
    setExercises(prev => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  }, []);

  return {
    exercises,
    setExercises,
    addExercise,
    applyGlobalRest,
    applyGlobalSets,
    applyHistoryItem,
    applyParsedInput,
    updateExercise,
    removeExercise,
    duplicateExercise,
    moveExercise,
  };
}
