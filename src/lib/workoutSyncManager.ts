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

export interface PendingWorkoutDelete {
  remoteId: number;
  deletedAtMs: number;
}

export interface PendingNoteUpdate {
  notes: string[];
  updatedAtMs: number;
}

export const WORKOUT_SYNC_QUEUE_PREFIX = 'workout_sync_queue_v1';
export const ACTIVE_WORKOUT_DRAFT_PREFIX = 'active_workout_session_v1';
export const WORKOUT_PENDING_DELETES_PREFIX = 'workout_pending_deletes_v1';
export const WORKOUT_PENDING_NOTES_PREFIX = 'workout_pending_notes_v1';
export const WORKOUT_SYNC_EVENT = 'workout-sync-queue-changed';

const MAX_SYNCED_CACHE_ITEMS = 10;
const SYNCED_RETENTION_MS = 24 * 60 * 60 * 1000;
const MIN_FOCUS_SYNC_INTERVAL_MS = 10_000;

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
const getPendingDeletesKey = (userId: string) => `${WORKOUT_PENDING_DELETES_PREFIX}:${userId}`;
const getPendingNotesKey = (userId: string) => `${WORKOUT_PENDING_NOTES_PREFIX}:${userId}`;

/** Notifica l'applicazione del cambiamento nella coda di sincronizzazione */
export const notifySyncQueueChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKOUT_SYNC_EVENT));
  }
};

/** Sottoscrizione reattiva alle modifiche della coda */
export const subscribeToSyncQueue = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const handleCustomEvent = () => callback();
  const handleStorageEvent = (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key.startsWith(WORKOUT_SYNC_QUEUE_PREFIX) ||
      e.key.startsWith(WORKOUT_PENDING_DELETES_PREFIX) ||
      e.key.startsWith(WORKOUT_PENDING_NOTES_PREFIX)
    ) {
      callback();
    }
  };
  window.addEventListener(WORKOUT_SYNC_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);
  return () => {
    window.removeEventListener(WORKOUT_SYNC_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
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

const pruneSyncedQueueItems = (
  queue: OfflineWorkoutSession[],
  aggressive = false
): OfflineWorkoutSession[] => {
  const now = Date.now();
  let keptSyncedCount = 0;
  const result: OfflineWorkoutSession[] = [];

  for (const item of queue) {
    if (item.sync_status !== 'synced') {
      result.push(item);
      continue;
    }
    if (aggressive) continue;

    const executedMs = Date.parse(item.executed_at || '');
    const refMs =
      typeof item.last_attempt_at_ms === 'number' && Number.isFinite(item.last_attempt_at_ms)
        ? item.last_attempt_at_ms
        : Number.isFinite(executedMs)
          ? executedMs
          : 0;
    const isFresh = refMs > 0 && now - refMs <= SYNCED_RETENTION_MS;
    if (isFresh && keptSyncedCount < MAX_SYNCED_CACHE_ITEMS) {
      keptSyncedCount += 1;
      result.push(item);
    }
  }

  return result;
};

/** Salva internamente l'array della coda con pruning dei record già sincronizzati */
const saveSyncQueue = (
  userId: string,
  queue: OfflineWorkoutSession[],
  silent = false
): void => {
  if (typeof window === 'undefined') return;
  const key = getQueueKey(userId);
  const pruned = pruneSyncedQueueItems(queue, false);
  try {
    localStorage.setItem(key, JSON.stringify(pruned));
    if (!silent) notifySyncQueueChanged();
  } catch {
    try {
      const stripped = pruneSyncedQueueItems(queue, true);
      localStorage.setItem(key, JSON.stringify(stripped));
      if (!silent) notifySyncQueueChanged();
    } catch (innerErr) {
      console.warn('[SyncManager] Errore scrittura coda sync:', innerErr);
    }
  }
};

/** Aggiorna atomicamente un singolo elemento della coda rileggendo lo stato più recente */
const updateQueueItemAtomically = (
  userId: string,
  workoutUuid: string,
  updater: (current: OfflineWorkoutSession) => OfflineWorkoutSession,
  silent = false
): boolean => {
  const currentQueue = getSyncQueue(userId);
  const idx = currentQueue.findIndex((item) => item.workout_uuid === workoutUuid);
  if (idx === -1) return false;
  const nextQueue = [...currentQueue];
  nextQueue[idx] = updater(currentQueue[idx]);
  saveSyncQueue(userId, nextQueue, silent);
  return true;
};

/* -------------------------------------------------------------------------- */
/*  2b. CODA OFFLINE ELIMINAZIONI & MODIFICHE NOTE SU RUN GIÀ SINCRONIZZATE   */
/* -------------------------------------------------------------------------- */

const getPendingWorkoutDeleteRecords = (userId: string): PendingWorkoutDelete[] => {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(getPendingDeletesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (rec): rec is PendingWorkoutDelete =>
        Boolean(rec && typeof rec === 'object' && Number.isFinite(Number(rec.remoteId)) && Number(rec.remoteId) > 0)
    );
  } catch {
    return [];
  }
};

const savePendingWorkoutDeleteRecords = (userId: string, records: PendingWorkoutDelete[], silent = false): void => {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = getPendingDeletesKey(userId);
    if (records.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(records));
    }
    if (!silent) notifySyncQueueChanged();
  } catch (err) {
    console.warn('[SyncManager] Errore scrittura pending deletes:', err);
  }
};

export const getPendingWorkoutDeletes = (userId: string): number[] => {
  return Array.from(new Set(getPendingWorkoutDeleteRecords(userId).map((r) => Math.trunc(r.remoteId))));
};

export const enqueuePendingWorkoutDelete = (userId: string, remoteWorkoutId: number): void => {
  const remoteId = Math.trunc(Number(remoteWorkoutId));
  if (!userId || !Number.isFinite(remoteId) || remoteId <= 0) return;

  const existing = getPendingWorkoutDeleteRecords(userId);
  if (!existing.some((r) => r.remoteId === remoteId)) {
    existing.push({ remoteId, deletedAtMs: Date.now() });
    savePendingWorkoutDeleteRecords(userId, existing, true);
  }

  // Rimuovi eventuali aggiornamenti note pendenti per questo workout eliminato
  const pendingNotes = getPendingNoteUpdates(userId);
  if (String(remoteId) in pendingNotes) {
    delete pendingNotes[String(remoteId)];
    savePendingNoteUpdates(userId, pendingNotes, true);
  }

  notifySyncQueueChanged();
};

export const getPendingNoteUpdates = (userId: string): Record<string, PendingNoteUpdate> => {
  if (typeof window === 'undefined' || !userId) return {};
  try {
    const raw = localStorage.getItem(getPendingNotesKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, PendingNoteUpdate>;
  } catch {
    return {};
  }
};

const savePendingNoteUpdates = (
  userId: string,
  updates: Record<string, PendingNoteUpdate>,
  silent = false
): void => {
  if (typeof window === 'undefined' || !userId) return;
  try {
    const key = getPendingNotesKey(userId);
    if (Object.keys(updates).length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(updates));
    }
    if (!silent) notifySyncQueueChanged();
  } catch (err) {
    console.warn('[SyncManager] Errore scrittura pending notes:', err);
  }
};

export const enqueuePendingNoteUpdate = (
  userId: string,
  remoteWorkoutId: number,
  notes: string[]
): void => {
  const remoteId = Math.trunc(Number(remoteWorkoutId));
  if (!userId || !Number.isFinite(remoteId) || remoteId <= 0) return;
  const cleanNotes = notes.map((text) => String(text ?? '').trim()).filter((text) => text.length > 0);
  const current = getPendingNoteUpdates(userId);
  current[String(remoteId)] = {
    notes: cleanNotes,
    updatedAtMs: Date.now(),
  };
  savePendingNoteUpdates(userId, current);
};

/**
 * Aggiorna le note di `workout_run` su Supabase senza finestra di perdita dati:
 * inserisce prima le nuove righe e poi elimina solo gli ID precedentemente letti.
 */
export const replaceRemoteWorkoutNotes = async (
  remoteWorkoutId: number,
  nextNotes: string[]
): Promise<void> => {
  const cleanNotes = nextNotes
    .map((text) => String(text ?? '').trim())
    .filter((text) => text.length > 0);

  const { data: existingRows, error: selectErr } = await supabase
    .from('note_workout')
    .select('id_nota')
    .eq('id_workout', remoteWorkoutId);

  if (selectErr) throw selectErr;

  const existingIds = (existingRows || [])
    .map((r: { id_nota?: unknown }) => Number(r?.id_nota))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (cleanNotes.length > 0) {
    const rowsToInsert = cleanNotes.map((testo) => ({
      id_workout: remoteWorkoutId,
      testo,
    }));
    const { error: insertErr } = await supabase.from('note_workout').insert(rowsToInsert);
    if (insertErr) throw insertErr;
  }

  if (existingIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from('note_workout')
      .delete()
      .in('id_nota', existingIds);
    if (deleteErr) throw deleteErr;
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
 * Rimuove un workout completato dalla coda locale (per workout_uuid o remote_workout_run_id).
 */
export const removeWorkoutFromQueue = (userId: string, workoutIdOrUuid: string | number): void => {
  const targetStr = String(workoutIdOrUuid ?? '').trim();
  if (!userId || !targetStr) return;
  const queue = getSyncQueue(userId).filter(
    (item) =>
      item.workout_uuid !== targetStr &&
      !(item.remote_workout_run_id != null && String(item.remote_workout_run_id) === targetStr)
  );
  saveSyncQueue(userId, queue);
};

/**
 * Aggiorna le note di un workout presente nella coda locale (ricerca per workout_uuid o remote_workout_run_id).
 * Restituisce true se almeno un elemento nella coda è stato trovato e aggiornato.
 */
export const updateQueuedWorkoutNotes = (
  userId: string,
  workoutIdOrUuid: string | number,
  notes: string[]
): boolean => {
  const targetStr = String(workoutIdOrUuid ?? '').trim();
  if (!userId || !targetStr || targetStr === '0') return false;

  const queue = getSyncQueue(userId);
  let updated = false;

  const nextQueue = queue.map((item) => {
    const matchesUuid = item.workout_uuid === targetStr;
    const matchesRemoteId =
      item.remote_workout_run_id != null && String(item.remote_workout_run_id) === targetStr;

    if (!matchesUuid && !matchesRemoteId) return item;

    updated = true;
    return {
      ...item,
      notes: notes
        .map((text) => text.trim())
        .filter((text) => text.length > 0)
        .map((text) => ({ text })),
    };
  });

  if (updated) {
    saveSyncQueue(userId, nextQueue);
  }
  return updated;
};

/* -------------------------------------------------------------------------- */
/*  3. MOTORE DI SINCRONIZZAZIONE CON IDEMPOTENZA ED EXPONENTIAL BACKOFF      */
/* -------------------------------------------------------------------------- */

let isSyncingInProgress = false;
let syncRetryTimer: ReturnType<typeof setTimeout> | null = null;

const flushPendingDeletes = async (userId: string): Promise<void> => {
  const records = getPendingWorkoutDeleteRecords(userId);
  if (records.length === 0) return;

  const remaining: PendingWorkoutDelete[] = [];
  let changed = false;

  for (const rec of records) {
    try {
      const { error: noteErr } = await supabase
        .from('note_workout')
        .delete()
        .eq('id_workout', rec.remoteId);
      if (noteErr) throw noteErr;

      const { error: runErr } = await supabase
        .from('workout_run')
        .delete()
        .eq('id_workout', rec.remoteId)
        .eq('id_utente', userId);
      if (runErr) throw runErr;

      changed = true;
    } catch (err) {
      console.warn(`[SyncManager] Impossibile completare eliminazione offline ${rec.remoteId}:`, err);
      remaining.push(rec);
    }
  }

  if (changed) {
    savePendingWorkoutDeleteRecords(userId, remaining);
  }
};

const flushPendingNoteUpdates = async (userId: string): Promise<void> => {
  const pendingDeletes = new Set(getPendingWorkoutDeletes(userId));
  const pendingNotes = getPendingNoteUpdates(userId);
  const entries = Object.entries(pendingNotes);
  if (entries.length === 0) return;

  for (const [key, entry] of entries) {
    const remoteId = Math.trunc(Number(key));
    if (!Number.isFinite(remoteId) || remoteId <= 0 || pendingDeletes.has(remoteId)) {
      const latest = getPendingNoteUpdates(userId);
      if (latest[key]?.updatedAtMs === entry.updatedAtMs) {
        delete latest[key];
        savePendingNoteUpdates(userId, latest, true);
      }
      continue;
    }

    try {
      const { data: runCheck, error: runCheckErr } = await supabase
        .from('workout_run')
        .select('id_workout')
        .eq('id_workout', remoteId)
        .eq('id_utente', userId)
        .maybeSingle();

      if (runCheckErr) throw runCheckErr;

      if (!runCheck) {
        // Sessione già eliminata sul cloud: scarta aggiornamento orfano
        const latest = getPendingNoteUpdates(userId);
        if (latest[key]?.updatedAtMs === entry.updatedAtMs) {
          delete latest[key];
          savePendingNoteUpdates(userId, latest, true);
        }
        continue;
      }

      await replaceRemoteWorkoutNotes(remoteId, entry.notes);

      const latest = getPendingNoteUpdates(userId);
      if (latest[key]?.updatedAtMs === entry.updatedAtMs) {
        delete latest[key];
        savePendingNoteUpdates(userId, latest);
      }
    } catch (err) {
      console.warn(`[SyncManager] Impossibile sincronizzare note offline ${remoteId}:`, err);
    }
  }
};

const isForeignKeyErrorResponse = (error: { code?: unknown; message?: unknown } | null | undefined): boolean => {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  return code === '23503' || msg.includes('foreign key');
};

const isMissingDurationColumnError = (error: { code?: unknown; message?: unknown } | null | undefined): boolean => {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('durata_totale_secondi') &&
    (code === '42703' || code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache') || msg.includes('does not exist'))
  );
};

/**
 * Esegue la sincronizzazione idempotente della coda verso Supabase.
 */
export const processSyncQueue = async (
  userId: string,
  forceImmediate = false
): Promise<{ syncedCount: number; failedCount: number }> => {
  if (isSyncingInProgress || !userId) return { syncedCount: 0, failedCount: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0, failedCount: 0 };
  }

  isSyncingInProgress = true;
  let syncedCount = 0;
  let failedCount = 0;
  let earliestPendingRetryMs: number | null = null;

  try {
    await flushPendingDeletes(userId);

    const queueSnapshot = getSyncQueue(userId);
    const deletedRemoteIds = new Set(getPendingWorkoutDeletes(userId));

    for (const snapshotItem of queueSnapshot) {
      if (snapshotItem.sync_status === 'synced') continue;

      const latestItem = getSyncQueue(userId).find((q) => q.workout_uuid === snapshotItem.workout_uuid);
      if (!latestItem || latestItem.sync_status === 'synced') continue;

      if (latestItem.remote_workout_run_id && deletedRemoteIds.has(Number(latestItem.remote_workout_run_id))) {
        removeWorkoutFromQueue(userId, latestItem.workout_uuid);
        continue;
      }

      const itemNow = Date.now();
      // Rispetta la finestra di backoff esponenziale (a meno di sync manuale forzato)
      if (!forceImmediate && latestItem.next_retry_at_ms && itemNow < latestItem.next_retry_at_ms) {
        earliestPendingRetryMs =
          earliestPendingRetryMs == null
            ? latestItem.next_retry_at_ms
            : Math.min(earliestPendingRetryMs, latestItem.next_retry_at_ms);
        continue;
      }

      updateQueueItemAtomically(userId, latestItem.workout_uuid, (cur) => ({
        ...cur,
        sync_status: 'syncing',
        last_attempt_at_ms: itemNow,
      }));

      try {
        let remoteRunId = latestItem.remote_workout_run_id;

        // --- IDEMPOTENZA: Verifica se il workout_uuid è già presente su Supabase ---
        if (!remoteRunId) {
          const { data: existingRuns } = await supabase
            .from('workout_run')
            .select('id_workout, data_esecuzione, workout_name_snapshot, exercises_snapshot')
            .eq('id_utente', userId)
            .order('data_esecuzione', { ascending: false })
            .limit(50);

          if (Array.isArray(existingRuns)) {
            const hasEmptySnapshot =
              !Array.isArray(latestItem.exercises_snapshot) || latestItem.exercises_snapshot.length === 0;

            for (const run of existingRuns) {
              const snap = run.exercises_snapshot;
              const matchesUuid =
                Array.isArray(snap) &&
                snap.some(
                  (ex: any) =>
                    ex?.workout_uuid === latestItem.workout_uuid ||
                    ex?._session_meta?.workout_uuid === latestItem.workout_uuid
                );

              const matchesEmptySnapshotRun =
                hasEmptySnapshot &&
                Array.isArray(snap) &&
                snap.length === 0 &&
                Boolean(latestItem.executed_at) &&
                run.data_esecuzione === latestItem.executed_at &&
                String(run.workout_name_snapshot || '') === String(latestItem.workout_name_snapshot || '');

              if ((matchesUuid || matchesEmptySnapshotRun) && run.id_workout) {
                remoteRunId = Number(run.id_workout);
                break;
              }
            }
          }
        }

        // --- Se non ancora su Supabase, inserisci il record principale ---
        if (!remoteRunId) {
          // Assegna il workout_uuid agli esercizi presenti senza iniettare oggetti finti se lo snapshot è vuoto
          const stampedExercisesSnapshot = Array.isArray(latestItem.exercises_snapshot)
            ? latestItem.exercises_snapshot.map((ex: any) =>
                ex && typeof ex === 'object' ? { ...ex, workout_uuid: latestItem.workout_uuid } : ex
              )
            : [];

          let candidateSchedaId = latestItem.id_scheda;
          let includeDuration = true;
          let insertedId: number | null = null;
          let lastError: any = null;

          for (let attempt = 0; attempt < 3; attempt++) {
            const payload: Record<string, unknown> = {
              id_utente: userId,
              id_scheda: candidateSchedaId,
              workout_name_snapshot: latestItem.workout_name_snapshot,
              exercises_snapshot: stampedExercisesSnapshot,
              data_esecuzione: latestItem.executed_at || new Date().toISOString(),
            };
            if (includeDuration) {
              payload.durata_totale_secondi = latestItem.durata_totale_secondi;
            }

            const { data: runData, error: runError } = await supabase
              .from('workout_run')
              .insert([payload])
              .select('id_workout')
              .single();

            if (!runError && runData?.id_workout) {
              insertedId = Number(runData.id_workout);
              break;
            }

            lastError = runError;
            const fkRetryNeeded = candidateSchedaId !== null && isForeignKeyErrorResponse(runError);
            const durationRetryNeeded = includeDuration && isMissingDurationColumnError(runError);

            if (!fkRetryNeeded && !durationRetryNeeded) {
              // Non mascherare errori transitori di rete/auth con rollback dei campi
              break;
            }
            if (fkRetryNeeded) candidateSchedaId = null;
            if (durationRetryNeeded) includeDuration = false;
          }

          if (!insertedId) {
            throw lastError || new Error('Inserimento workout_run fallito');
          }
          remoteRunId = insertedId;
        }

        // Salva subito il remote_workout_run_id atomicamente prima di toccare le note
        updateQueueItemAtomically(
          userId,
          latestItem.workout_uuid,
          (cur) => ({
            ...cur,
            remote_workout_run_id: remoteRunId,
          }),
          true
        );

        // --- Sincronizzazione Note (note_workout) con merge sicuro sullo stato più recente ---
        const freshestItemForNotes =
          getSyncQueue(userId).find((q) => q.workout_uuid === latestItem.workout_uuid) || latestItem;
        const noteTexts = Array.isArray(freshestItemForNotes.notes)
          ? freshestItemForNotes.notes.map((n) => String(n?.text || ''))
          : [];

        if (remoteRunId && noteTexts.some((t) => t.trim().length > 0)) {
          await replaceRemoteWorkoutNotes(remoteRunId, noteTexts);
        }

        // --- Successo sincronizzazione: passa lo stato a 'synced' atomicamente ---
        updateQueueItemAtomically(userId, latestItem.workout_uuid, (cur) => ({
          ...cur,
          remote_workout_run_id: remoteRunId,
          sync_status: 'synced',
          last_attempt_at_ms: Date.now(),
          next_retry_at_ms: undefined,
          error_message: undefined,
        }));
        syncedCount += 1;
      } catch (syncErr: any) {
        console.warn(`[SyncManager] Errore sincronizzazione workout ${latestItem.workout_uuid}:`, syncErr);
        const currentRetries = getSyncQueue(userId).find((q) => q.workout_uuid === latestItem.workout_uuid)?.retry_count ?? latestItem.retry_count ?? 0;
        const nextRetryCount = currentRetries + 1;
        // Exponential backoff: 2s, 4s, 8s, 16s... max 60s
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, nextRetryCount)) + Math.random() * 500;
        const nextRetryAt = Date.now() + backoffMs;

        updateQueueItemAtomically(userId, latestItem.workout_uuid, (cur) => ({
          ...cur,
          retry_count: nextRetryCount,
          sync_status: 'failed',
          error_message: syncErr?.message || 'Errore di rete',
          next_retry_at_ms: nextRetryAt,
        }));
        failedCount += 1;
        earliestPendingRetryMs =
          earliestPendingRetryMs == null ? nextRetryAt : Math.min(earliestPendingRetryMs, nextRetryAt);
      }
    }

    await flushPendingNoteUpdates(userId);

    if (earliestPendingRetryMs !== null && !syncRetryTimer) {
      const delayMs = Math.max(500, earliestPendingRetryMs - Date.now());
      syncRetryTimer = setTimeout(() => {
        syncRetryTimer = null;
        void processSyncQueue(userId);
      }, delayMs);
    }
  } finally {
    isSyncingInProgress = false;
  }

  return { syncedCount, failedCount };
};

/* -------------------------------------------------------------------------- */
/*  4. NETWORK LISTENER & APP LAUNCH HOOKS                                    */
/* -------------------------------------------------------------------------- */

/**
 * Inizializza i listener di rete per l'invio automatico appena la connessione torna attiva.
 * Riconosce la riconnessione da eventi di rete, ritorno in primo piano e focus della finestra.
 */
export const initSyncNetworkListeners = (userId: string): (() => void) => {
  if (typeof window === 'undefined' || !userId) return () => {};

  let lastFullSyncAtMs = 0;

  const triggerFullSync = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    lastFullSyncAtMs = Date.now();
    void processSyncQueue(userId);
    // Sincronizza proattivamente anche le schede dal cloud
    import('./offlineSchedeManager').then(({ syncOfflineSchedeWithCloud }) => {
      void syncOfflineSchedeWithCloud(userId);
    }).catch(() => {
      // ignore
    });
  };

  // Esegui subito un ciclo di sincronizzazione all'avvio
  triggerFullSync();

  const handleOnline = () => {
    console.debug('[SyncManager] Rete disponibile: avvio sincronizzazione automatica...');
    triggerFullSync();
  };

  const handleFocus = () => {
    if (Date.now() - lastFullSyncAtMs < MIN_FOCUS_SYNC_INTERVAL_MS) return;
    triggerFullSync();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - lastFullSyncAtMs < MIN_FOCUS_SYNC_INTERVAL_MS) return;
      triggerFullSync();
    }
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('focus', handleFocus);
    document.removeEventListener('visibilitychange', handleVisibility);
    if (syncRetryTimer) {
      clearTimeout(syncRetryTimer);
      syncRetryTimer = null;
    }
  };
};
