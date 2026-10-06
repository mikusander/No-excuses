/**
 * workoutSyncManager.ts — Gestione della persistenza continua in tempo reale,
 * della coda di sincronizzazione offline (sync_queue) e dell'idempotenza con Supabase.
 *
 * Funzionalità:
 *  1. Salvataggio incrementale della sessione attiva (Crash Resilience & Recovery).
 *  2. Coda offline (sync_queue) con stato 'pending' | 'syncing' | 'synced' | 'failed'.
 *  3. Idempotenza tramite workout_uuid (chiave client univoca immutabile).
 *  4. Sincronizzazione automatica con Exponential Backoff e Network Listener.
 *  5. Zero blocchi UI: la sessione si conclude e si visualizza istantaneamente offline.
 */
import { supabase } from './supabase';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface OfflineWorkoutSession {
  workout_uuid: string;
  id_utente: string;
  id_scheda: number | null;
  workout_name_snapshot: string;
  durata_totale_secondi: number;
  executed_at: string;
  exercises_snapshot: any[];
  notes: Array<{ text: string }>;
  status: 'in_progress' | 'completed';
  sync_status: SyncStatus;
  retry_count: number;
  last_attempt_at_ms?: number;
  next_retry_at_ms?: number;
  error_message?: string;
  remote_workout_run_id?: number | null;
}

export interface ActiveWorkoutDraft {
  workout_uuid: string;
  userId: string;
  schedaId: number | null;
  workoutRunId: number | null;
  workoutName: string;
  updated_at_ms: number;
  started_at_ms: number;
  currentExerciseIdx: number;
  currentSetIdx: number;
  currentExerciseName?: string;
  totalSets?: number;
  workoutStateSnapshot: any;
}

export const WORKOUT_SYNC_QUEUE_PREFIX = 'workout_sync_queue_v1';
export const ACTIVE_WORKOUT_DRAFT_PREFIX = 'active_workout_session_v1';
export const WORKOUT_SYNC_EVENT = 'workout-sync-queue-changed';

/** Generatore sicuro di UUID v4 (con fallback se crypto.randomUUID non disponibile) */
export const generateWorkoutUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const getDraftKey = (userId: string) => `${ACTIVE_WORKOUT_DRAFT_PREFIX}:${userId}`;
const getQueueKey = (userId: string) => `${WORKOUT_SYNC_QUEUE_PREFIX}:${userId}`;

/** Notifica l'applicazione del cambiamento nella coda di sincronizzazione */
export const notifySyncQueueChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKOUT_SYNC_EVENT));
  }
};

/** Sottoscrizione reattiva alle modifiche della coda */
export const subscribeToSyncQueue = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const handleEvent = () => callback();
  window.addEventListener(WORKOUT_SYNC_EVENT, handleEvent);
  window.addEventListener('storage', handleEvent);
  return () => {
    window.removeEventListener(WORKOUT_SYNC_EVENT, handleEvent);
    window.removeEventListener('storage', handleEvent);
  };
};

/* -------------------------------------------------------------------------- */
/*  1. GESTIONE SESSIONE ATTIVA (INCREMENTAL PERSISTENCE & CRASH RECOVERY)    */
/* -------------------------------------------------------------------------- */

/**
 * Salva o aggiorna immediatamente la bozza attiva in tempo reale.
 * Invocato a ogni set completato, modificato o a ogni variazione di carico/ripetizioni.
 */
export const saveActiveWorkoutDraft = (draft: ActiveWorkoutDraft): void => {
  if (typeof window === 'undefined') return;
  try {
    const key = getDraftKey(draft.userId);
    localStorage.setItem(key, JSON.stringify(draft));
  } catch (err) {
    console.debug('[SyncManager] Errore salvataggio active draft:', err);
  }
};

/**
 * Recupera la bozza attiva corrente per l'utente, se non scaduta (TTL 72 ore).
 */
export const getActiveWorkoutDraft = (userId: string): ActiveWorkoutDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const key = getDraftKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveWorkoutDraft;
    if (!parsed || !parsed.workout_uuid) return null;
    // Scadenza oltre 72 ore
    if (Date.now() - parsed.updated_at_ms > 1000 * 60 * 60 * 72) {
      clearActiveWorkoutDraft(userId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Cancella la bozza attiva (chiamata al termine o scarto formale della sessione).
 */
export const clearActiveWorkoutDraft = (userId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    const key = getDraftKey(userId);
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

/* -------------------------------------------------------------------------- */
/*  2. CODA DI SINCRONIZZAZIONE OFFLINE (SYNC QUEUE)                           */
/* -------------------------------------------------------------------------- */

/**
 * Restituisce la coda di sessioni completate salvate in locale.
 */
export const getSyncQueue = (userId: string): OfflineWorkoutSession[] => {
  if (typeof window === 'undefined') return [];
  try {
    const key = getQueueKey(userId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Salva internamente l'array della coda */
const saveSyncQueue = (userId: string, queue: OfflineWorkoutSession[]): void => {
  if (typeof window === 'undefined') return;
  try {
    const key = getQueueKey(userId);
    localStorage.setItem(key, JSON.stringify(queue));
    notifySyncQueueChanged();
  } catch (err) {
    console.warn('[SyncManager] Errore scrittura coda sync:', err);
  }
};

/**
 * Aggiunge un workout completato alla coda locale con stato 'pending'.
 * Cancella contemporaneamente la bozza attiva per azzerare i falsi allarmi di crash.
 */
export const enqueueCompletedWorkout = (
  sessionData: Omit<OfflineWorkoutSession, 'status' | 'sync_status' | 'retry_count'>
): OfflineWorkoutSession => {
  const queue = getSyncQueue(sessionData.id_utente);
  const now = Date.now();

  // Verifica se esiste già nella coda
  const existingIndex = queue.findIndex((item) => item.workout_uuid === sessionData.workout_uuid);
  const fullSession: OfflineWorkoutSession = {
    ...sessionData,
    status: 'completed',
    sync_status: 'pending',
    retry_count: 0,
    last_attempt_at_ms: now,
  };

  if (existingIndex >= 0) {
    queue[existingIndex] = { ...queue[existingIndex], ...fullSession };
  } else {
    queue.unshift(fullSession);
  }

  saveSyncQueue(sessionData.id_utente, queue);
  clearActiveWorkoutDraft(sessionData.id_utente);

  // Prova immediata se connessione attiva
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    void processSyncQueue(sessionData.id_utente);
  }

  return fullSession;
};

/**
 * Restituisce il numero di workout in attesa di sincronizzazione.
 */
export const getPendingSyncCount = (userId: string): number => {
  return getSyncQueue(userId).filter((item) => item.sync_status !== 'synced').length;
};

/**
 * Rimuove un workout completato dalla coda locale.
 */
export const removeWorkoutFromQueue = (userId: string, workoutUuid: string): void => {
  const queue = getSyncQueue(userId).filter((item) => item.workout_uuid !== workoutUuid);
  saveSyncQueue(userId, queue);
};

/* -------------------------------------------------------------------------- */
/*  3. MOTORE DI SINCRONIZZAZIONE CON IDEMPOTENZA ED EXPONENTIAL BACKOFF      */
/* -------------------------------------------------------------------------- */

let isSyncingInProgress = false;
let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Esegue la sincronizzazione idempotente della coda verso Supabase.
 */
export const processSyncQueue = async (
  userId: string
): Promise<{ syncedCount: number; failedCount: number }> => {
  if (isSyncingInProgress || !userId) return { syncedCount: 0, failedCount: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0, failedCount: 0 };
  }

  isSyncingInProgress = true;
  let syncedCount = 0;
  let failedCount = 0;
  const now = Date.now();

  try {
    const queue = getSyncQueue(userId);
    let queueChanged = false;

    for (const item of queue) {
      if (item.sync_status === 'synced') continue;

      // Rispetta la finestra di backoff esponenziale
      if (item.next_retry_at_ms && now < item.next_retry_at_ms) {
        continue;
      }

      item.sync_status = 'syncing';
      item.last_attempt_at_ms = now;

      try {
        let remoteRunId = item.remote_workout_run_id;

        // --- IDEMPOTENZA: Verifica se il workout_uuid è già presente su Supabase ---
        if (!remoteRunId) {
          // Ricerca preventiva per idempotenza:
          // Se la richiesta precedente era passata ma la risposta di rete si era persa,
          // evitiamo inserimenti duplicati interrogando per id_utente e data_esecuzione.
          const { data: existingRuns } = await supabase
            .from('workout_run')
            .select('id_workout, exercises_snapshot')
            .eq('id_utente', userId)
            .order('data_esecuzione', { ascending: false })
            .limit(10);

          if (Array.isArray(existingRuns)) {
            for (const run of existingRuns) {
              const snap = run.exercises_snapshot;
              const matchesUuid =
                Array.isArray(snap) &&
                snap.some((ex: any) => ex?.workout_uuid === item.workout_uuid);

              if (matchesUuid && run.id_workout) {
                remoteRunId = run.id_workout;
                item.remote_workout_run_id = remoteRunId;
                break;
              }
            }
          }
        }

        // --- Se non ancora su Supabase, inserisci il record principale ---
        if (!remoteRunId) {
          // Assegna il workout_uuid a ogni elemento dello snapshot per garanzia d'idempotenza futura
          const stampedExercisesSnapshot = Array.isArray(item.exercises_snapshot)
            ? item.exercises_snapshot.map((ex: any) => ({
                ...ex,
                workout_uuid: item.workout_uuid,
              }))
            : [{ workout_uuid: item.workout_uuid }];

          const { data: insertedRun, error: insertRunError } = await supabase
            .from('workout_run')
            .insert([
              {
                id_utente: userId,
                id_scheda: item.id_scheda,
                durata_totale_secondi: item.durata_totale_secondi,
                workout_name_snapshot: item.workout_name_snapshot,
                exercises_snapshot: stampedExercisesSnapshot,
              },
            ])
            .select('id_workout')
            .single();

          if (insertRunError || !insertedRun?.id_workout) {
            // Tentativo fallback senza durata se schema database legacy
            const { data: fallbackRun, error: fallbackError } = await supabase
              .from('workout_run')
              .insert([
                {
                  id_utente: userId,
                  id_scheda: item.id_scheda,
                  workout_name_snapshot: item.workout_name_snapshot,
                  exercises_snapshot: stampedExercisesSnapshot,
                },
              ])
              .select('id_workout')
              .single();

            if (fallbackError || !fallbackRun?.id_workout) {
              throw insertRunError || fallbackError || new Error('Inserimento workout_run fallito');
            }
            remoteRunId = Number(fallbackRun.id_workout);
          } else {
            remoteRunId = Number(insertedRun.id_workout);
          }

          item.remote_workout_run_id = remoteRunId;
        }

        // --- Inserimento Note (note_workout) se presenti ---
        if (remoteRunId && Array.isArray(item.notes) && item.notes.length > 0) {
          const rowsToInsert = item.notes
            .filter((n) => Boolean(n.text?.trim()))
            .map((n) => ({
              id_workout: remoteRunId,
              testo: n.text.trim(),
            }));

          if (rowsToInsert.length > 0) {
            // Pulizia preventiva note esistenti per questa run per evitare note duplicate in retry
            await supabase.from('note_workout').delete().eq('id_workout', remoteRunId);
            const { error: noteInsertError } = await supabase.from('note_workout').insert(rowsToInsert);
            if (noteInsertError) {
              console.warn('[SyncManager] Errore inserimento note_workout:', noteInsertError);
              // Non blocca lo stato synced del workout principale
            }
          }
        }

        // --- Successo sincronizzazione: passa lo stato a 'synced' ---
        item.sync_status = 'synced';
        item.error_message = undefined;
        syncedCount += 1;
        queueChanged = true;
      } catch (syncErr: any) {
        console.warn(`[SyncManager] Errore sincronizzazione workout ${item.workout_uuid}:`, syncErr);
        item.retry_count = (item.retry_count || 0) + 1;
        item.sync_status = 'failed';
        item.error_message = syncErr?.message || 'Errore di rete';

        // Exponential backoff: 2s, 4s, 8s, 16s... max 60s
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, item.retry_count)) + Math.random() * 500;
        item.next_retry_at_ms = Date.now() + backoffMs;
        failedCount += 1;
        queueChanged = true;

        // Pianifica il prossimo retry
        if (!syncRetryTimer) {
          syncRetryTimer = setTimeout(() => {
            syncRetryTimer = null;
            void processSyncQueue(userId);
          }, backoffMs);
        }
      }
    }

    if (queueChanged) {
      saveSyncQueue(userId, queue);
    }
  } finally {
    isSyncingInProgress = false;
  }

  return { syncedCount, failedCount };
};

/* -------------------------------------------------------------------------- */
/*  4. NETWORK LISTENER & APP LAUNCH HOOKS                                    */
/* -------------------------------------------------------------------------- */

let hasInitializedNetworkListener = false;

/**
 * Inizializza i listener di rete per l'invio automatico appena la connessione torna attiva.
 */
export const initSyncNetworkListeners = (userId: string): (() => void) => {
  if (typeof window === 'undefined' || !userId) return () => {};

  // Esegui subito un ciclo di sincronizzazione all'avvio
  void processSyncQueue(userId);

  if (hasInitializedNetworkListener) {
    return () => {};
  }
  hasInitializedNetworkListener = true;

  const handleOnline = () => {
    console.debug('[SyncManager] Connessione ripristinata: avvio sincronizzazione coda offline...');
    void processSyncQueue(userId);
  };

  window.addEventListener('online', handleOnline);

  return () => {
    window.removeEventListener('online', handleOnline);
    hasInitializedNetworkListener = false;
  };
};
