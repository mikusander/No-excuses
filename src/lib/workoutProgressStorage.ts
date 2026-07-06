/**
 * workoutProgressStorage.ts — Gestione dei checkpoint di progresso workout nel localStorage.
 *
 * Permette di salvare/leggere/cancellare lo stato parziale di un workout interrotto,
 * così che l'utente possa riprendere da dove si era fermato anche dopo aver chiuso l'app.
 *
 * Schema chiavi localStorage:
 *   `active_workout_progress_v1:{userId}:{type}-{id}`
 *   Esempio: `active_workout_progress_v1:abc123:scheda-42`
 *
 * Tipi di identità:
 *  - 'scheda' : workout avviato direttamente da una scheda (id = id_scheda)
 *  - 'run'    : workout rieseguito dallo storico (id = workout_run_id)
 *
 * I checkpoint scadono automaticamente dopo WORKOUT_PROGRESS_MAX_AGE_MS (72 ore).
 * Le operazioni di lettura effettuano pulizia lazy dei checkpoint scaduti.
 *
 * Nota: tutte le operazioni localStorage sono wrapped in try/catch per gestire
 * ambienti con storage disabilitato (modalità privata iOS, quota esaurita, ecc.).
 */

/** Discrimina tra workout avviato da scheda e workout rieseguito da storico */
export type WorkoutProgressIdentityType = 'scheda' | 'run';

/** Identità univoca di un checkpoint di progresso */
export interface WorkoutProgressIdentity {
  type: WorkoutProgressIdentityType;
  id: number;
}

/** Metadati di un checkpoint valido trovato nel localStorage */
export interface WorkoutProgressCheckpointMeta {
  key: string;                    // Chiave localStorage completa
  identity: WorkoutProgressIdentity;
  savedAtMs: number;              // Timestamp Unix (ms) dell'ultimo salvataggio
}

/** Prefisso comune per tutte le chiavi di checkpoint nell'app */
export const WORKOUT_PROGRESS_STORAGE_PREFIX = 'active_workout_progress_v1';

/** TTL dei checkpoint: 3 giorni in millisecondi */
export const WORKOUT_PROGRESS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

/** Costruisce il prefisso namespace per le chiavi di un utente specifico */
const getUserPrefix = (userId: string) => `${WORKOUT_PROGRESS_STORAGE_PREFIX}:${userId}:`;

/**
 * Wrapper sicuro per localStorage.removeItem.
 * Ignora gli errori (quota, modalità privata, ecc.) senza propagarli.
 */
const safeRemoveItem = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore localStorage failures (quota/private mode constraints).
  }
};

/**
 * Parsa il suffisso di una chiave localStorage nel formato `{type}-{id}`.
 * Restituisce null se il formato non è valido o l'id non è un numero positivo finito.
 *
 * @example parseIdentitySuffix('scheda-42') → { type: 'scheda', id: 42 }
 * @example parseIdentitySuffix('foo-bar')   → null
 */
const parseIdentitySuffix = (suffix: string): WorkoutProgressIdentity | null => {
  const match = suffix.match(/^(scheda|run)-(\d+)$/);
  if (!match) return null;

  const id = Number(match[2]);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    type: match[1] as WorkoutProgressIdentityType,
    id: Math.trunc(id),
  };
};

/**
 * Estrae l'identità del checkpoint dalla chiave localStorage completa.
 * Verifica che la chiave appartenga al namespace dell'utente specificato.
 */
const parseIdentityFromKey = (key: string, userId: string): WorkoutProgressIdentity | null => {
  const prefix = getUserPrefix(userId);
  if (!key.startsWith(prefix)) return null;
  return parseIdentitySuffix(key.slice(prefix.length));
};

/**
 * Legge il campo `savedAtMs` da un raw JSON string di localStorage.
 * Restituisce null se il JSON non è valido o il valore non è un numero finito positivo.
 */
const readSavedAtMsFromRaw = (raw: string): number | null => {
  const parsed = JSON.parse(raw) as { savedAtMs?: unknown };
  const savedAtMs = Number(parsed.savedAtMs);
  if (!Number.isFinite(savedAtMs) || savedAtMs <= 0) return null;
  return savedAtMs;
};

/**
 * Itera su tutto il localStorage e restituisce le chiavi che appartengono
 * al namespace dell'utente specificato.
 */
const getUserCheckpointKeys = (userId: string): string[] => {
  const prefix = getUserPrefix(userId);
  const keys: string[] = [];

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }

  return keys;
};

/**
 * `buildWorkoutProgressStorageKey` — Costruisce la chiave localStorage per un checkpoint.
 *
 * Normalizza l'id con Math.trunc per evitare chiavi con decimali.
 *
 * @example buildWorkoutProgressStorageKey('user1', { type: 'scheda', id: 42 })
 *          → 'active_workout_progress_v1:user1:scheda-42'
 */
export const buildWorkoutProgressStorageKey = (userId: string, identity: WorkoutProgressIdentity) => {
  const safeId = Math.trunc(Number(identity.id));
  return `${getUserPrefix(userId)}${identity.type}-${safeId}`;
};

/**
 * `getValidWorkoutProgressCheckpoints` — Restituisce tutti i checkpoint validi dell'utente.
 *
 * Durante la lettura effettua pulizia lazy:
 *  - Rimuove le chiavi con formato non valido
 *  - Rimuove le chiavi con JSON corrotto
 *  - Rimuove i checkpoint più vecchi di WORKOUT_PROGRESS_MAX_AGE_MS
 *
 * I checkpoint restituiti sono ordinati dal più recente al più vecchio (desc per savedAtMs).
 */
export const getValidWorkoutProgressCheckpoints = (userId: string): WorkoutProgressCheckpointMeta[] => {
  const now = Date.now();
  const checkpoints: WorkoutProgressCheckpointMeta[] = [];

  for (const key of getUserCheckpointKeys(userId)) {
    // Verifica che la chiave abbia un formato valido
    const identity = parseIdentityFromKey(key, userId);
    if (!identity) {
      safeRemoveItem(key); // Pulizia lazy di chiavi malformate
      continue;
    }

    // Legge il valore raw dal localStorage
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }

    if (!raw) {
      safeRemoveItem(key);
      continue;
    }

    // Parsa il timestamp di salvataggio
    let savedAtMs: number | null = null;
    try {
      savedAtMs = readSavedAtMsFromRaw(raw);
    } catch {
      savedAtMs = null;
    }

    if (savedAtMs == null) {
      safeRemoveItem(key); // JSON corrotto o senza timestamp
      continue;
    }

    // Rimuove i checkpoint scaduti (TTL 72 ore)
    if (now - savedAtMs > WORKOUT_PROGRESS_MAX_AGE_MS) {
      safeRemoveItem(key);
      continue;
    }

    checkpoints.push({ key, identity, savedAtMs });
  }

  // Ordina dal più recente al più vecchio
  checkpoints.sort((a, b) => b.savedAtMs - a.savedAtMs);
  return checkpoints;
};

/**
 * `getLatestWorkoutProgressCheckpoint` — Restituisce il checkpoint più recente dell'utente.
 * Restituisce null se non esistono checkpoint validi.
 */
export const getLatestWorkoutProgressCheckpoint = (userId: string): WorkoutProgressCheckpointMeta | null => {
  return getValidWorkoutProgressCheckpoints(userId)[0] || null;
};

/**
 * `pruneWorkoutProgressCheckpoints` — Rimuove tutti i checkpoint tranne quello specificato.
 *
 * Usato dopo aver scelto quale checkpoint riprendere: conserva solo il checkpoint
 * attivo e cancella tutti gli altri (che sarebbero comunque irrecuperabili).
 *
 * @param keepKey - Chiave del checkpoint da conservare (null = cancella tutto)
 */
export const pruneWorkoutProgressCheckpoints = (userId: string, keepKey: string | null = null) => {
  const checkpoints = getValidWorkoutProgressCheckpoints(userId);

  for (const checkpoint of checkpoints) {
    if (keepKey && checkpoint.key === keepKey) continue; // Conserva quello attivo
    safeRemoveItem(checkpoint.key);
  }
};

/**
 * `clearAllWorkoutProgressCheckpoints` — Cancella tutti i checkpoint dell'utente.
 * Usato quando l'utente decide di non riprendere il workout interrotto.
 */
export const clearAllWorkoutProgressCheckpoints = (userId: string) => {
  pruneWorkoutProgressCheckpoints(userId, null);
};

/**
 * `clearWorkoutProgressCheckpointByIdentity` — Cancella il checkpoint di un workout specifico.
 * Usato al completamento o all'abbandono volontario di un workout.
 */
export const clearWorkoutProgressCheckpointByIdentity = (userId: string, identity: WorkoutProgressIdentity) => {
  const storageKey = buildWorkoutProgressStorageKey(userId, identity);
  safeRemoveItem(storageKey);
};
