/**
 * offlineSchedeManager.ts — Gestione della cache offline per le schede di allenamento.
 *
 * Consente l'avvio, la visualizzazione e l'esecuzione 100% offline dei workout.
 * Quando online, sincronizza e aggiorna la cache locale in localStorage.
 * Quando offline, fornisce istantaneamente le schede e gli esercizi memorizzati.
 */
import { supabase } from './supabase';
import { parseDbExerciseRows, type UiExercise } from './workoutSchemaAdapter';

export interface CachedScheda {
  id: string;
  id_scheda: number;
  nome: string;
  data_creazione: string;
  raw_esecuzioni?: any[];
  esecuzioni?: any[];
  exercises: UiExercise[];
  updated_at_ms: number;
}

export const OFFLINE_SCHEDE_CACHE_PREFIX = 'offline_schede_cache_v1';
export const OFFLINE_SCHEDE_EVENT = 'offline-schede-changed';

const getCacheKey = (userId: string) => `${OFFLINE_SCHEDE_CACHE_PREFIX}:${userId}`;

/** Notifica l'applicazione del cambiamento delle schede in cache */
export const notifyOfflineSchedeChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OFFLINE_SCHEDE_EVENT));
  }
};

/** Sottoscrizione reattiva alle modifiche della cache schede */
export const subscribeToOfflineSchede = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const handleEvent = () => callback();
  window.addEventListener(OFFLINE_SCHEDE_EVENT, handleEvent);
  window.addEventListener('storage', handleEvent);
  return () => {
    window.removeEventListener(OFFLINE_SCHEDE_EVENT, handleEvent);
    window.removeEventListener('storage', handleEvent);
  };
};

/**
 * Restituisce tutte le schede salvate nella cache offline per l'utente.
 */
export const getOfflineSchede = (userId?: string | null): CachedScheda[] => {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(getCacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Recupera una singola scheda dalla cache offline tramite ID.
 */
export const getOfflineSchedaById = (
  userId?: string | null,
  schedaId?: string | number | null
): CachedScheda | null => {
  if (!userId || schedaId == null) return null;
  const schede = getOfflineSchede(userId);
  const normalizedId = String(schedaId);
  return schede.find((s) => s.id === normalizedId || String(s.id_scheda) === normalizedId) || null;
};

/**
 * Salva l'elenco completo di schede nella cache offline.
 */
export const saveSchedeToOfflineCache = (
  userId: string,
  rawSchede: Array<{
    id_scheda: number | string;
    nome: string;
    data_creazione?: string;
    esecuzioni?: any[];
    exercises?: any[];
  }>
): void => {
  if (typeof window === 'undefined' || !userId || !Array.isArray(rawSchede)) return;
  try {
    const now = Date.now();
    const existingCache = getOfflineSchede(userId);
    const existingMap = new Map(existingCache.map((s) => [String(s.id_scheda), s]));

    const transformed: CachedScheda[] = rawSchede.map((item) => {
      const numId = Number(item.id_scheda);
      const strId = String(item.id_scheda);
      const existing = existingMap.get(strId);

      let exercises = item.exercises;
      const raw_esecuzioni = item.esecuzioni ?? existing?.raw_esecuzioni ?? [];

      if (!exercises || exercises.length === 0) {
        if (raw_esecuzioni.length > 0) {
          exercises = parseDbExerciseRows(raw_esecuzioni);
        } else if (existing?.exercises && existing.exercises.length > 0) {
          exercises = existing.exercises;
        } else {
          exercises = [];
        }
      }

      return {
        id: strId,
        id_scheda: numId,
        nome: String(item.nome || existing?.nome || `Scheda #${strId}`),
        data_creazione: String(item.data_creazione || existing?.data_creazione || new Date().toISOString()),
        raw_esecuzioni,
        esecuzioni: raw_esecuzioni,
        exercises: exercises as UiExercise[],
        updated_at_ms: now,
      };
    });

    localStorage.setItem(getCacheKey(userId), JSON.stringify(transformed));
    notifyOfflineSchedeChanged();
  } catch (err) {
    console.warn('[OfflineSchedeManager] Errore salvataggio schede in cache:', err);
  }
};

/**
 * Aggiorna o inserisce una singola scheda nella cache offline.
 */
export const updateSingleSchedaInOfflineCache = (
  userId: string,
  scheda: {
    id_scheda: number | string;
    nome: string;
    data_creazione?: string;
    created_at?: string;
    esecuzioni?: any[];
    raw_esecuzioni?: any[];
    exercises?: any[];
  }
): void => {
  if (typeof window === 'undefined' || !userId || !scheda?.id_scheda) return;
  try {
    const list = getOfflineSchede(userId);
    const strId = String(scheda.id_scheda);
    const numId = Number(scheda.id_scheda);
    const now = Date.now();

    const raw_esecuzioni = scheda.raw_esecuzioni ?? scheda.esecuzioni ?? [];
    let exercises = scheda.exercises;
    if (!exercises || exercises.length === 0) {
      if (raw_esecuzioni.length > 0) {
        exercises = parseDbExerciseRows(raw_esecuzioni);
      } else {
        exercises = [];
      }
    }

    const updatedItem: CachedScheda = {
      id: strId,
      id_scheda: numId,
      nome: scheda.nome,
      data_creazione: scheda.data_creazione || scheda.created_at || new Date().toISOString(),
      raw_esecuzioni,
      esecuzioni: raw_esecuzioni,
      exercises: exercises as UiExercise[],
      updated_at_ms: now,
    };

    const idx = list.findIndex((s) => s.id === strId || s.id_scheda === numId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updatedItem };
    } else {
      list.unshift(updatedItem);
    }

    localStorage.setItem(getCacheKey(userId), JSON.stringify(list));
    notifyOfflineSchedeChanged();
  } catch (err) {
    console.warn('[OfflineSchedeManager] Errore aggiornamento singola scheda:', err);
  }
};

/**
 * Rimuove una scheda dalla cache offline.
 */
export const removeSchedaFromOfflineCache = (userId: string, schedaId: string | number): void => {
  if (typeof window === 'undefined' || !userId || schedaId == null) return;
  try {
    const list = getOfflineSchede(userId);
    const strId = String(schedaId);
    const filtered = list.filter((s) => s.id !== strId && String(s.id_scheda) !== strId);
    localStorage.setItem(getCacheKey(userId), JSON.stringify(filtered));
    notifyOfflineSchedeChanged();
  } catch {
    // ignore
  }
};

/** Query standard Supabase con selezione completa per il caching offline */
export const SCHEDA_FULL_SELECT_QUERY = `
  id_scheda,
  nome,
  data_creazione,
  esecuzioni (
    id_esecuzione,
    ordine,
    set_num,
    rest_secondi,
    rest_tra_esercizi,
    peso_kg,
    note_esercizio,
    tipo,
    reps,
    durata_secondi,
    id_superset,
    id_piramide,
    stepindex_piramide,
    id_emom,
    stepindex_emom,
    superset ( round_totali ),
    emom ( round_totali, durata_round_secondi ),
    esercizi ( nome )
  )
`;

/**
 * Sincronizza proattivamente le schede dal cloud Supabase verso la cache offline.
 * Se offline o in caso di errore di rete, restituisce i dati già presenti in cache.
 */
export const syncOfflineSchedeWithCloud = async (userId: string): Promise<CachedScheda[]> => {
  if (!userId) return [];
  const cached = getOfflineSchede(userId);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from('schede')
      .select(SCHEDA_FULL_SELECT_QUERY)
      .order('data_creazione', { ascending: false });

    if (error) throw error;
    if (Array.isArray(data)) {
      saveSchedeToOfflineCache(userId, data);
      return getOfflineSchede(userId);
    }
  } catch (err) {
    console.warn('[OfflineSchedeManager] Impossibile scaricare schede dal cloud (fallback su cache locale):', err);
  }

  return cached;
};
