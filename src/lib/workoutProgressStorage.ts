export type WorkoutProgressIdentityType = 'scheda' | 'run';

export interface WorkoutProgressIdentity {
  type: WorkoutProgressIdentityType;
  id: number;
}

export interface WorkoutProgressCheckpointMeta {
  key: string;
  identity: WorkoutProgressIdentity;
  savedAtMs: number;
}

export const WORKOUT_PROGRESS_STORAGE_PREFIX = 'active_workout_progress_v1';
export const WORKOUT_PROGRESS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;

const getUserPrefix = (userId: string) => `${WORKOUT_PROGRESS_STORAGE_PREFIX}:${userId}:`;

const safeRemoveItem = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore localStorage failures (quota/private mode constraints).
  }
};

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

const parseIdentityFromKey = (key: string, userId: string): WorkoutProgressIdentity | null => {
  const prefix = getUserPrefix(userId);
  if (!key.startsWith(prefix)) return null;
  return parseIdentitySuffix(key.slice(prefix.length));
};

const readSavedAtMsFromRaw = (raw: string): number | null => {
  const parsed = JSON.parse(raw) as { savedAtMs?: unknown };
  const savedAtMs = Number(parsed.savedAtMs);
  if (!Number.isFinite(savedAtMs) || savedAtMs <= 0) return null;
  return savedAtMs;
};

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

export const buildWorkoutProgressStorageKey = (userId: string, identity: WorkoutProgressIdentity) => {
  const safeId = Math.trunc(Number(identity.id));
  return `${getUserPrefix(userId)}${identity.type}-${safeId}`;
};

export const getValidWorkoutProgressCheckpoints = (userId: string): WorkoutProgressCheckpointMeta[] => {
  const now = Date.now();
  const checkpoints: WorkoutProgressCheckpointMeta[] = [];

  for (const key of getUserCheckpointKeys(userId)) {
    const identity = parseIdentityFromKey(key, userId);
    if (!identity) {
      safeRemoveItem(key);
      continue;
    }

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

    let savedAtMs: number | null = null;
    try {
      savedAtMs = readSavedAtMsFromRaw(raw);
    } catch {
      savedAtMs = null;
    }

    if (savedAtMs == null) {
      safeRemoveItem(key);
      continue;
    }

    if (now - savedAtMs > WORKOUT_PROGRESS_MAX_AGE_MS) {
      safeRemoveItem(key);
      continue;
    }

    checkpoints.push({ key, identity, savedAtMs });
  }

  checkpoints.sort((a, b) => b.savedAtMs - a.savedAtMs);
  return checkpoints;
};

export const getLatestWorkoutProgressCheckpoint = (userId: string): WorkoutProgressCheckpointMeta | null => {
  return getValidWorkoutProgressCheckpoints(userId)[0] || null;
};

export const pruneWorkoutProgressCheckpoints = (userId: string, keepKey: string | null = null) => {
  const checkpoints = getValidWorkoutProgressCheckpoints(userId);

  for (const checkpoint of checkpoints) {
    if (keepKey && checkpoint.key === keepKey) continue;
    safeRemoveItem(checkpoint.key);
  }
};

export const clearAllWorkoutProgressCheckpoints = (userId: string) => {
  pruneWorkoutProgressCheckpoints(userId, null);
};

export const clearWorkoutProgressCheckpointByIdentity = (userId: string, identity: WorkoutProgressIdentity) => {
  const storageKey = buildWorkoutProgressStorageKey(userId, identity);
  safeRemoveItem(storageKey);
};
