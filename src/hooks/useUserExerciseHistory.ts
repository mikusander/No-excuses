import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { extractNoteMeta } from '../lib/workoutSchemaAdapter';
import { getOfflineSchede } from '../lib/offlineSchedeManager';
import { toSnapshotExercises } from '../utils/periodicReportEngine';

export interface UserExerciseHistoryItem {
  name: string;
  sets: number;
  reps: number;
  duration_seconds?: number;
  rest_seconds: number;
  weight_kg?: number | null;
  type?: 'reps' | 'isometry' | 'cardio' | 'pyramid';
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
  }[];
  lastUsedDate?: string;
}

const toNonNegativeOrDefault = (val: unknown, fallback: number): number => {
  if (val === null || val === undefined || String(val).trim() === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
};

const toPositiveOrDefault = (val: unknown, fallback: number): number => {
  if (val === null || val === undefined || String(val).trim() === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};

const toOptionalWeight = (val: unknown): number | null => {
  if (val === null || val === undefined || String(val).trim() === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

export function useUserExerciseHistory(userId?: string) {
  const [historyItems, setHistoryItems] = useState<UserExerciseHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setHistoryItems([]);
      return;
    }

    let isMounted = true;

    async function loadUserHistory() {
      try {
        setLoading(true);

        const itemsMap = new Map<string, UserExerciseHistoryItem>();
        const isOnline = typeof navigator === 'undefined' || navigator.onLine;

        const addUiExercisesToMap = (
          exercises: ReturnType<typeof toSnapshotExercises>,
          date?: string
        ) => {
          for (const ex of exercises) {
            const rawName = String(ex.name || '').trim();
            if (!rawName) continue;
            const key = rawName.toLowerCase();

            if (!itemsMap.has(key) && ex.type !== 'superset' && ex.type !== 'circuit' && ex.type !== 'emom') {
              const hasPyramidSteps =
                ex.type === 'pyramid' && Array.isArray(ex.pyramid_steps) && ex.pyramid_steps.length > 0;
              const resolvedType: UserExerciseHistoryItem['type'] = hasPyramidSteps
                ? 'pyramid'
                : ex.type === 'cardio'
                  ? 'cardio'
                  : ex.type === 'isometry'
                    ? 'isometry'
                    : 'reps';

              itemsMap.set(key, {
                name: rawName,
                sets: toPositiveOrDefault(ex.sets, 3),
                reps: resolvedType === 'reps' ? toNonNegativeOrDefault(ex.reps, 10) : 10,
                duration_seconds:
                  resolvedType === 'isometry' || resolvedType === 'cardio'
                    ? toNonNegativeOrDefault(ex.duration_seconds, 30)
                    : 0,
                rest_seconds: toNonNegativeOrDefault(ex.rest_seconds, 60),
                weight_kg: toOptionalWeight(ex.weight_kg),
                type: resolvedType,
                pyramid_steps:
                  hasPyramidSteps && ex.pyramid_steps
                    ? ex.pyramid_steps.map((s) => ({
                        reps: toNonNegativeOrDefault(s.reps, 10),
                        rest_seconds: toNonNegativeOrDefault(s.rest_seconds, 60),
                        weight_kg: toOptionalWeight(s.weight_kg),
                      }))
                    : undefined,
                lastUsedDate: date,
              });
            }

            if (Array.isArray(ex.subExercises)) {
              for (const sub of ex.subExercises) {
                const subName = String(sub.name || '').trim();
                if (!subName) continue;
                const subKey = subName.toLowerCase();
                if (!itemsMap.has(subKey)) {
                  const subType: 'reps' | 'isometry' | 'cardio' =
                    sub.type === 'cardio' ? 'cardio' : sub.type === 'isometry' ? 'isometry' : 'reps';
                  itemsMap.set(subKey, {
                    name: subName,
                    sets: toPositiveOrDefault(ex.sets, 3),
                    reps: subType === 'reps' ? toNonNegativeOrDefault(sub.reps, 10) : 10,
                    duration_seconds:
                      subType === 'isometry' || subType === 'cardio'
                        ? toNonNegativeOrDefault(sub.duration_seconds, 30)
                        : 0,
                    rest_seconds: toNonNegativeOrDefault(ex.rest_seconds, 90),
                    weight_kg: toOptionalWeight(sub.weight_kg),
                    type: subType,
                    lastUsedDate: date,
                  });
                }
              }
            }
          }
        };

        if (isOnline) {
          // 1. Carica le sessioni completate da workout_run (più recenti prima)
          const { data: runData, error: runError } = await supabase
            .from('workout_run')
            .select('exercises_snapshot, data_esecuzione')
            .eq('id_utente', userId!)
            .order('data_esecuzione', { ascending: false })
            .limit(60);

          if (!runError && Array.isArray(runData)) {
            for (const run of runData) {
              const date = run.data_esecuzione ? String(run.data_esecuzione) : undefined;
              addUiExercisesToMap(toSnapshotExercises(run.exercises_snapshot), date);
            }
          }

          // 2. Integrazione con schede ed esecuzioni create dall'utente
          const { data: schedeData, error: schedeError } = await supabase
            .from('schede')
            .select(`
              id_scheda,
              data_creazione,
              esecuzioni (
                set_num,
                reps,
                durata_secondi,
                rest_secondi,
                peso_kg,
                tipo,
                note_esercizio,
                esercizi (
                  nome
                )
              )
            `)
            .eq('id_utente', userId!)
            .order('data_creazione', { ascending: false })
            .limit(25);

          if (!schedeError && Array.isArray(schedeData)) {
            for (const s of schedeData) {
              const date = s.data_creazione ? String(s.data_creazione) : undefined;
              const esec = Array.isArray(s.esecuzioni) ? s.esecuzioni : [];
              for (const row of esec) {
                const esercizioRel = Array.isArray(row.esercizi) ? row.esercizi[0] : row.esercizi;
                const exName = String((esercizioRel as { nome?: unknown } | null)?.nome || '').trim();
                if (!exName) continue;
                const key = exName.toLowerCase();
                if (!itemsMap.has(key)) {
                  const noteMeta = extractNoteMeta(row.note_esercizio);
                  const isCardio =
                    String(row.tipo || '').toUpperCase() === 'CARDIO' ||
                    noteMeta.meta?.exerciseType === 'cardio';
                  const isIsometry = String(row.tipo || '').toUpperCase() === 'ISOMETRIA';
                  const rowType: 'reps' | 'isometry' | 'cardio' = isCardio
                    ? 'cardio'
                    : isIsometry
                      ? 'isometry'
                      : 'reps';

                  itemsMap.set(key, {
                    name: exName,
                    sets: toPositiveOrDefault(row.set_num, 3),
                    reps: rowType === 'reps' ? toNonNegativeOrDefault(row.reps, 10) : 10,
                    duration_seconds:
                      rowType === 'isometry' || rowType === 'cardio'
                        ? toNonNegativeOrDefault(row.durata_secondi, 30)
                        : 0,
                    rest_seconds: toNonNegativeOrDefault(row.rest_secondi, 90),
                    weight_kg: toOptionalWeight(row.peso_kg),
                    type: rowType,
                    lastUsedDate: date,
                  });
                }
              }
            }
          }
        }

        // 3. Fallback / integrazione dalla cache schede offline
        const offlineSchede = getOfflineSchede(userId);
        for (const cached of offlineSchede) {
          if (Array.isArray(cached.exercises) && cached.exercises.length > 0) {
            addUiExercisesToMap(cached.exercises, cached.data_creazione || undefined);
          }
        }

        if (isMounted) {
          setHistoryItems(Array.from(itemsMap.values()));
        }
      } catch (err) {
        console.warn('Errore nel caricamento storico esercizi utente:', err);
        const offlineSchede = getOfflineSchede(userId);
        if (isMounted && offlineSchede.length > 0) {
          const fallbackMap = new Map<string, UserExerciseHistoryItem>();
          for (const cached of offlineSchede) {
            for (const ex of cached.exercises || []) {
              const rawName = String(ex.name || '').trim();
              if (!rawName) continue;
              const key = rawName.toLowerCase();
              if (!fallbackMap.has(key) && ex.type !== 'superset' && ex.type !== 'circuit' && ex.type !== 'emom') {
                fallbackMap.set(key, {
                  name: rawName,
                  sets: toPositiveOrDefault(ex.sets, 3),
                  reps: ex.type === 'reps' ? toNonNegativeOrDefault(ex.reps, 10) : 10,
                  duration_seconds:
                    ex.type === 'isometry' || ex.type === 'cardio'
                      ? toNonNegativeOrDefault(ex.duration_seconds, 30)
                      : 0,
                  rest_seconds: toNonNegativeOrDefault(ex.rest_seconds, 60),
                  weight_kg: toOptionalWeight(ex.weight_kg),
                  type:
                    ex.type === 'pyramid'
                      ? 'pyramid'
                      : ex.type === 'cardio'
                        ? 'cardio'
                        : ex.type === 'isometry'
                          ? 'isometry'
                          : 'reps',
                  pyramid_steps: ex.pyramid_steps?.map((s) => ({
                    reps: toNonNegativeOrDefault(s.reps, 10),
                    rest_seconds: toNonNegativeOrDefault(s.rest_seconds, 60),
                    weight_kg: toOptionalWeight(s.weight_kg),
                  })),
                  lastUsedDate: cached.data_creazione || undefined,
                });
              }
            }
          }
          setHistoryItems(Array.from(fallbackMap.values()));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadUserHistory();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  /**
   * Cerca nello storico utente per sottostringa case-insensitive,
   * ordinando prima le corrispondenze a inizio stringa (prefix) e poi quelle interne.
   */
  const searchHistory = useCallback((query: string, limit = 6): UserExerciseHistoryItem[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const prefixMatches: UserExerciseHistoryItem[] = [];
    const substringMatches: UserExerciseHistoryItem[] = [];

    for (const item of historyItems) {
      const lower = item.name.toLowerCase();
      if (lower === q) {
        prefixMatches.unshift(item);
      } else if (lower.startsWith(q)) {
        prefixMatches.push(item);
      } else if (lower.includes(q)) {
        substringMatches.push(item);
      }
    }

    return [...prefixMatches, ...substringMatches].slice(0, limit);
  }, [historyItems]);

  return {
    historyItems,
    isLoading: loading,
    searchHistory,
  };
}
