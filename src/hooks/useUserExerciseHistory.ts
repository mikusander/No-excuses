import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toSnapshotExercises } from '../utils/periodicReportEngine';

export interface UserExerciseHistoryItem {
  name: string;
  sets: number;
  reps: number;
  duration_seconds?: number;
  rest_seconds: number;
  weight_kg?: number | null;
  type?: 'reps' | 'isometry' | 'pyramid';
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
  }[];
  lastUsedDate?: string;
}

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
            const exercises = toSnapshotExercises(run.exercises_snapshot);

            for (const ex of exercises) {
              const rawName = String(ex.name || '').trim();
              if (!rawName) continue;
              const key = rawName.toLowerCase();

              if (!itemsMap.has(key)) {
                const hasPyramidSteps = ex.type === 'pyramid' && Array.isArray(ex.pyramid_steps) && ex.pyramid_steps.length > 0;
                itemsMap.set(key, {
                  name: rawName,
                  sets: Number(ex.sets) > 0 ? Number(ex.sets) : 3,
                  reps: Number(ex.reps) > 0 ? Number(ex.reps) : 10,
                  duration_seconds: Number(ex.duration_seconds) > 0 ? Number(ex.duration_seconds) : 30,
                  rest_seconds: Number(ex.rest_seconds) >= 0 ? Number(ex.rest_seconds) : 60,
                  weight_kg: ex.weight_kg != null && Number(ex.weight_kg) > 0 ? Number(ex.weight_kg) : null,
                  type: hasPyramidSteps ? 'pyramid' : ex.type === 'isometry' ? 'isometry' : 'reps',
                  pyramid_steps: hasPyramidSteps && ex.pyramid_steps ? ex.pyramid_steps.map((s: any) => ({
                    reps: Number(s.reps) > 0 ? Number(s.reps) : 10,
                    rest_seconds: Number(s.rest_seconds) >= 0 ? Number(s.rest_seconds) : 60,
                    weight_kg: s.weight_kg != null && Number(s.weight_kg) > 0 ? Number(s.weight_kg) : null,
                  })) : undefined,
                  lastUsedDate: date,
                });
              }

              // Se l'esercizio ha sub-esercizi (superset / circuit / emom), estrai anche quelli
              if (Array.isArray(ex.subExercises)) {
                for (const sub of ex.subExercises) {
                  const subName = String(sub.name || '').trim();
                  if (!subName) continue;
                  const subKey = subName.toLowerCase();
                  if (!itemsMap.has(subKey)) {
                    itemsMap.set(subKey, {
                      name: subName,
                      sets: Number(ex.sets) > 0 ? Number(ex.sets) : 3,
                      reps: Number(sub.reps) > 0 ? Number(sub.reps) : 10,
                      duration_seconds: Number(sub.duration_seconds) > 0 ? Number(sub.duration_seconds) : 30,
                      rest_seconds: Number(ex.rest_seconds) >= 0 ? Number(ex.rest_seconds) : 90,
                      weight_kg: sub.weight_kg != null && Number(sub.weight_kg) > 0 ? Number(sub.weight_kg) : null,
                      type: sub.type === 'isometry' ? 'isometry' : 'reps',
                      lastUsedDate: date,
                    });
                  }
                }
              }
            }
          }
        }

        // 2. Integrazione con schede ed esecuzioni create dall'utente
        const { data: schedeData } = await supabase
          .from('schede')
          .select(`
            id_scheda,
            created_at,
            esecuzioni (
              serie,
              ripetizioni,
              riposo_secondi,
              peso_kg,
              esercizi (
                nome_esercizio
              )
            )
          `)
          .eq('id_utente', userId!)
          .order('created_at', { ascending: false })
          .limit(25);

        if (Array.isArray(schedeData)) {
          for (const s of schedeData) {
            const date = s.created_at ? String(s.created_at) : undefined;
            const esec = Array.isArray(s.esecuzioni) ? s.esecuzioni : [];
            for (const row of esec) {
              const exName = (row.esercizi as { nome_esercizio?: string } | null)?.nome_esercizio?.trim();
              if (!exName) continue;
              const key = exName.toLowerCase();
              if (!itemsMap.has(key)) {
                itemsMap.set(key, {
                  name: exName,
                  sets: Number(row.serie) > 0 ? Number(row.serie) : 3,
                  reps: Number(row.ripetizioni) > 0 ? Number(row.ripetizioni) : 10,
                  rest_seconds: Number(row.riposo_secondi) >= 0 ? Number(row.riposo_secondi) : 90,
                  weight_kg: row.peso_kg != null && Number(row.peso_kg) > 0 ? Number(row.peso_kg) : null,
                  type: 'reps',
                  lastUsedDate: date,
                });
              }
            }
          }
        }

        if (isMounted) {
          setHistoryItems(Array.from(itemsMap.values()));
        }
      } catch (err) {
        console.warn('Errore nel caricamento storico esercizi utente:', err);
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
