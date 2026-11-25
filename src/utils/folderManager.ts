/**
 * folderManager.ts — Gestione offline-first delle cartelle per le schede di allenamento.
 *
 * Consente di:
 *  - Creare, rinominare ed eliminare cartelle per utente
 *  - Assegnare o spostare singole schede o gruppi di schede tra cartelle (o al livello radice)
 *  - Propagare i cambiamenti in tempo reale tra componenti tramite CustomEvent e listener di storage
 *  - Sincronizzazione automatica e bidirezionale in tempo reale su Supabase Cloud (user_metadata)
 */
import { supabase } from '../lib/supabase';

export interface WorkoutFolder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  color?: string; // Colore tema per badge/bordo/icona (es. orange, cyan, emerald, purple, rose, amber)
  schedeOrder?: string[]; // Array ordinato di schedaId in formato stringa
}

export interface FolderAssignmentMap {
  [schedaId: string]: string; // schedaId -> folderId
}

export interface FolderAssignmentMetaEntry {
  folderId: string | null;
  updatedAt: string;
}

export interface FolderAssignmentMetaMap {
  [schedaId: string]: FolderAssignmentMetaEntry;
}

const FOLDERS_STORAGE_PREFIX = 'workout_folders_v1:';
const ASSIGNMENTS_STORAGE_PREFIX = 'workout_folder_assignments_v1:';
const ASSIGNMENT_META_STORAGE_PREFIX = 'workout_folder_assignment_meta_v1:';
const DELETED_STORAGE_PREFIX = 'workout_deleted_folders_v1:';
export const FOLDER_CHANGE_EVENT = 'workout-folders-changed';

const CLOUD_SYNC_THROTTLE_MS = 10_000;
let cloudPushTimeout: ReturnType<typeof setTimeout> | null = null;
let isCloudSyncing = false;
let pendingPushUserId: string | null = null;
let lastCloudSyncAt = 0;

const getCleanUserId = (userId?: string): string => {
  return userId && userId.trim() ? userId.trim() : 'guest';
};

const notifyFolderChanges = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOLDER_CHANGE_EVENT));
  }
};

/**
 * Recupera l'elenco degli ID di cartelle eliminate localmente (tombstones per sincronizzazione)
 */
export const getDeletedFolderIds = (userId?: string): string[] => {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(`${DELETED_STORAGE_PREFIX}${getCleanUserId(userId)}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Memorizza un ID di cartella eliminata localmente
 */
const markFolderDeleted = (folderId: string, userId?: string): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = getDeletedFolderIds(userId);
    if (!current.includes(folderId)) {
      const next = [...current.slice(-100), folderId]; // Tieni fino a 100 tombstones
      localStorage.setItem(`${DELETED_STORAGE_PREFIX}${getCleanUserId(userId)}`, JSON.stringify(next));
    }
  } catch (err) {
    console.debug('Errore memorizzazione tombstone cartella:', err);
  }
};

/**
 * Risolve l'ID utente autenticato da Supabase se non esplicitamente fornito.
 */
const resolveUserId = async (userId?: string): Promise<string | null> => {
  const clean = getCleanUserId(userId);
  if (clean !== 'guest') return clean;

  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.id) {
      return data.session.user.id;
    }
  } catch {
    // Sessione non disponibile
  }
  return null;
};

const getFolderAssignmentMeta = (userId?: string): FolderAssignmentMetaMap => {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(`${ASSIGNMENT_META_STORAGE_PREFIX}${getCleanUserId(userId)}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as FolderAssignmentMetaMap;
  } catch {
    return {};
  }
};

const saveFolderAssignmentMeta = (meta: FolderAssignmentMetaMap, userId?: string): void => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(
      `${ASSIGNMENT_META_STORAGE_PREFIX}${getCleanUserId(userId)}`,
      JSON.stringify(meta)
    );
  } catch (err) {
    console.debug('Errore salvataggio meta assegnazioni cartella:', err);
  }
};

const updateAssignmentMetaEntries = (
  updates: Record<string, string | null>,
  userId?: string,
  timestamp = new Date().toISOString()
): void => {
  const nextMeta: FolderAssignmentMetaMap = { ...getFolderAssignmentMeta(userId) };
  Object.entries(updates).forEach(([schedaId, folderId]) => {
    nextMeta[String(schedaId)] = {
      folderId: folderId || null,
      updatedAt: timestamp,
    };
  });
  saveFolderAssignmentMeta(nextMeta, userId);
};

const parseMetaTimestampMs = (iso?: string): number => {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const mergeAssignmentsWithLww = (params: {
  allDeleted: string[];
  validFolderIds: Set<string>;
  cloudAssignments: FolderAssignmentMap | null;
  localAssignments: FolderAssignmentMap;
  cloudMeta: FolderAssignmentMetaMap | null;
  localMeta: FolderAssignmentMetaMap;
}): {
  mergedAssignments: FolderAssignmentMap;
  mergedMeta: FolderAssignmentMetaMap;
} => {
  const {
    allDeleted,
    validFolderIds,
    cloudAssignments,
    localAssignments,
    cloudMeta,
    localMeta,
  } = params;

  const allSchedaIds = new Set<string>([
    ...Object.keys(cloudAssignments || {}),
    ...Object.keys(localAssignments || {}),
    ...Object.keys(cloudMeta || {}),
    ...Object.keys(localMeta || {}),
  ]);

  const mergedAssignments: FolderAssignmentMap = {};
  const mergedMeta: FolderAssignmentMetaMap = {};

  allSchedaIds.forEach((schedaId) => {
    const hasLocalAssign = Object.prototype.hasOwnProperty.call(localAssignments, schedaId);
    const hasCloudAssign = Boolean(
      cloudAssignments && Object.prototype.hasOwnProperty.call(cloudAssignments, schedaId)
    );

    const localEntry: FolderAssignmentMetaEntry | null = localMeta[schedaId]
      ? localMeta[schedaId]
      : hasLocalAssign
        ? { folderId: localAssignments[schedaId], updatedAt: '' }
        : null;

    const cloudEntry: FolderAssignmentMetaEntry | null = cloudMeta?.[schedaId]
      ? cloudMeta[schedaId]
      : hasCloudAssign
        ? { folderId: cloudAssignments![schedaId], updatedAt: '' }
        : null;

    let winner: FolderAssignmentMetaEntry | null = null;
    if (localEntry && cloudEntry) {
      const localTs = parseMetaTimestampMs(localEntry.updatedAt);
      const cloudTs = parseMetaTimestampMs(cloudEntry.updatedAt);
      if (localTs > 0 && cloudTs > 0) {
        winner = localTs >= cloudTs ? localEntry : cloudEntry;
      } else if (localTs > 0) {
        winner = localEntry;
      } else if (cloudTs > 0) {
        winner = cloudEntry;
      } else {
        winner = hasLocalAssign ? localEntry : cloudEntry;
      }
    } else {
      winner = localEntry || cloudEntry;
    }

    if (!winner) return;

    const candidateFolderId = winner.folderId;
    if (
      candidateFolderId &&
      !allDeleted.includes(candidateFolderId) &&
      validFolderIds.has(candidateFolderId)
    ) {
      mergedAssignments[schedaId] = candidateFolderId;
      if (winner.updatedAt) {
        mergedMeta[schedaId] = { folderId: candidateFolderId, updatedAt: winner.updatedAt };
      }
    } else if (winner.updatedAt) {
      mergedMeta[schedaId] = { folderId: null, updatedAt: winner.updatedAt };
    }
  });

  return { mergedAssignments, mergedMeta };
};

/**
 * Spinge l'elenco cartelle e assegnazioni locali verso i metadati utente Supabase.
 * Supporta esecuzione immediata (per azioni utente) o debounced.
 */
export const pushFoldersToCloud = async (userId?: string, immediate = true): Promise<void> => {
  const targetId = await resolveUserId(userId);
  if (!targetId) return;

  pendingPushUserId = targetId;

  const executePush = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }
    try {
      const currentFolders = getFolders(targetId);
      const currentAssignments = getFolderAssignments(targetId);
      const currentDeleted = getDeletedFolderIds(targetId);
      const currentMeta = getFolderAssignmentMeta(targetId);

      const { error } = await supabase.auth.updateUser({
        data: {
          workout_folders: currentFolders,
          workout_folder_assignments: currentAssignments,
          workout_deleted_folders: currentDeleted,
          workout_folder_assignment_meta: currentMeta,
        },
      });

      if (error) {
        console.warn('Errore sync cartelle su Supabase:', error.message);
      } else {
        pendingPushUserId = null;
      }
    } catch (err) {
      console.warn('Eccezione durante push cartelle su Supabase:', err);
    }
  };

  if (cloudPushTimeout) {
    clearTimeout(cloudPushTimeout);
    cloudPushTimeout = null;
  }

  if (immediate) {
    await executePush();
  } else {
    cloudPushTimeout = setTimeout(() => {
      void executePush();
    }, 300);
  }
};

/**
 * Sincronizza bidirezionalmente le cartelle locali con Supabase Cloud:
 * - Migra eventuali cartelle create come 'guest' al profilo autenticato.
 * - Sincronizza cartelle, assegnazioni e cancellazioni tra tutti i dispositivi (iPhone, PWA, PC).
 */
export const syncFoldersWithCloud = async (userId?: string): Promise<void> => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const targetId = await resolveUserId(userId);
  if (!targetId || isCloudSyncing) return;

  isCloudSyncing = true;
  lastCloudSyncAt = Date.now();
  try {
    // Migrazione automatica cartelle 'guest' (es. se create prima che l'auth caricasse)
    const guestFolders = getFolders('guest');
    const guestAssignments = getFolderAssignments('guest');
    const guestMeta = getFolderAssignmentMeta('guest');
    if (guestFolders.length > 0 || Object.keys(guestAssignments).length > 0) {
      const existingUserFolders = getFolders(targetId);
      const existingUserAssignments = getFolderAssignments(targetId);
      const existingUserMeta = getFolderAssignmentMeta(targetId);

      const mergedWithGuest = [...existingUserFolders];
      guestFolders.forEach((gf) => {
        if (!mergedWithGuest.some((f) => f.id === gf.id)) {
          mergedWithGuest.push(gf);
        }
      });

      saveFolders(mergedWithGuest, targetId, true);
      saveFolderAssignments({ ...existingUserAssignments, ...guestAssignments }, targetId, true);
      saveFolderAssignmentMeta({ ...existingUserMeta, ...guestMeta }, targetId);

      localStorage.removeItem(`${FOLDERS_STORAGE_PREFIX}guest`);
      localStorage.removeItem(`${ASSIGNMENTS_STORAGE_PREFIX}guest`);
      localStorage.removeItem(`${ASSIGNMENT_META_STORAGE_PREFIX}guest`);
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user || data.user.id !== targetId) {
      return;
    }

    const metadata = data.user.user_metadata || {};
    const cloudFolders = Array.isArray(metadata.workout_folders)
      ? (metadata.workout_folders as WorkoutFolder[])
      : null;
    const cloudAssignments =
      metadata.workout_folder_assignments && typeof metadata.workout_folder_assignments === 'object'
        ? (metadata.workout_folder_assignments as FolderAssignmentMap)
        : null;
    const cloudDeleted = Array.isArray(metadata.workout_deleted_folders)
      ? (metadata.workout_deleted_folders as string[])
      : [];
    const cloudMeta =
      metadata.workout_folder_assignment_meta && typeof metadata.workout_folder_assignment_meta === 'object'
        ? (metadata.workout_folder_assignment_meta as FolderAssignmentMetaMap)
        : null;

    const localFolders = getFolders(targetId);
    const localAssignments = getFolderAssignments(targetId);
    const localDeleted = getDeletedFolderIds(targetId);
    const localMeta = getFolderAssignmentMeta(targetId);

    // Unisci lista delle cartelle cancellate (tombstones)
    const allDeleted = Array.from(new Set([...cloudDeleted, ...localDeleted]));
    if (allDeleted.length > localDeleted.length) {
      localStorage.setItem(`${DELETED_STORAGE_PREFIX}${targetId}`, JSON.stringify(allDeleted));
    }

    // Caso 1: il cloud ha dati e il locale è vuoto (nuovo device o ultima cartella eliminata offline)
    if (cloudFolders && cloudFolders.length > 0 && localFolders.length === 0) {
      const filtered = cloudFolders.filter((f) => !allDeleted.includes(f.id));
      const validFolderIds = new Set(filtered.map((f) => f.id));
      const { mergedAssignments, mergedMeta } = mergeAssignmentsWithLww({
        allDeleted,
        validFolderIds,
        cloudAssignments,
        localAssignments,
        cloudMeta,
        localMeta,
      });

      saveFolders(filtered, targetId, true);
      saveFolderAssignments(mergedAssignments, targetId, true);
      saveFolderAssignmentMeta(mergedMeta, targetId);

      const cloudDirty =
        filtered.length !== cloudFolders.length ||
        JSON.stringify(cloudAssignments || {}) !== JSON.stringify(mergedAssignments) ||
        JSON.stringify(cloudDeleted) !== JSON.stringify(allDeleted) ||
        JSON.stringify(cloudMeta || {}) !== JSON.stringify(mergedMeta);

      if (cloudDirty) {
        await pushFoldersToCloud(targetId, true);
      }
      return;
    }

    // Caso 2: il locale ha dati e il cloud è ancora vuoto (primo sync)
    if (localFolders.length > 0 && (!cloudFolders || cloudFolders.length === 0)) {
      await pushFoldersToCloud(targetId, true);
      return;
    }

    // Caso 3: entrambi hanno dati -> merge LWW cartelle + assegnazioni per-scheda con tombstone
    if (cloudFolders && cloudFolders.length > 0 && localFolders.length > 0) {
      const folderMap = new Map<string, WorkoutFolder>();

      const processFolder = (f: WorkoutFolder) => {
        if (allDeleted.includes(f.id)) return;
        const existing = folderMap.get(f.id);
        if (!existing) {
          folderMap.set(f.id, f);
        } else {
          const existingTime = parseMetaTimestampMs(existing.updatedAt || existing.createdAt);
          const incomingTime = parseMetaTimestampMs(f.updatedAt || f.createdAt);
          if (incomingTime >= existingTime) {
            folderMap.set(f.id, f);
          }
        }
      };

      cloudFolders.forEach(processFolder);
      localFolders.forEach(processFolder);

      const mergedFolders = Array.from(folderMap.values());
      const validFolderIds = new Set(mergedFolders.map((f) => f.id));
      const { mergedAssignments, mergedMeta } = mergeAssignmentsWithLww({
        allDeleted,
        validFolderIds,
        cloudAssignments,
        localAssignments,
        cloudMeta,
        localMeta,
      });

      const localDirty =
        JSON.stringify(localFolders) !== JSON.stringify(mergedFolders) ||
        JSON.stringify(localAssignments) !== JSON.stringify(mergedAssignments) ||
        JSON.stringify(localMeta) !== JSON.stringify(mergedMeta);

      const cloudDirty =
        JSON.stringify(cloudFolders) !== JSON.stringify(mergedFolders) ||
        JSON.stringify(cloudAssignments || {}) !== JSON.stringify(mergedAssignments) ||
        JSON.stringify(cloudDeleted) !== JSON.stringify(allDeleted) ||
        JSON.stringify(cloudMeta || {}) !== JSON.stringify(mergedMeta);

      if (localDirty) {
        saveFolders(mergedFolders, targetId, true);
        saveFolderAssignments(mergedAssignments, targetId, true);
        saveFolderAssignmentMeta(mergedMeta, targetId);
      }
      if (cloudDirty) {
        await pushFoldersToCloud(targetId, true);
      }
      return;
    }

    // Caso 4: nessuna cartella su entrambi i lati ma tombstone/meta locali più recenti
    if (
      allDeleted.length > cloudDeleted.length ||
      JSON.stringify(localMeta) !== JSON.stringify(cloudMeta || {})
    ) {
      await pushFoldersToCloud(targetId, true);
    }
  } catch (err) {
    console.debug('Error in syncFoldersWithCloud:', err);
  } finally {
    isCloudSyncing = false;
  }
};

const maybeSyncFoldersOnResume = (): void => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (Date.now() - lastCloudSyncAt < CLOUD_SYNC_THROTTLE_MS) return;
  void syncFoldersWithCloud();
};

/**
 * Listener globali per sincronizzare al focus dell'app e salvare alla chiusura
 */
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    maybeSyncFoldersOnResume();
  });
  window.addEventListener('online', () => {
    if (pendingPushUserId) {
      void pushFoldersToCloud(pendingPushUserId, true);
    } else {
      void syncFoldersWithCloud();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      maybeSyncFoldersOnResume();
    } else if (document.visibilityState === 'hidden' && pendingPushUserId) {
      void pushFoldersToCloud(pendingPushUserId, true);
    }
  });
}

/**
 * Recupera l'elenco delle cartelle per l'utente specificato.
 */
export const getFolders = (userId?: string): WorkoutFolder[] => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = localStorage.getItem(`${FOLDERS_STORAGE_PREFIX}${getCleanUserId(userId)}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkoutFolder[];
  } catch (err) {
    console.warn('Errore durante il recupero delle cartelle utente:', err);
    return [];
  }
};

/**
 * Salva l'elenco delle cartelle in localStorage per l'utente e propaga su cloud.
 */
export const saveFolders = (folders: WorkoutFolder[], userId?: string, skipCloudPush = false): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(
      `${FOLDERS_STORAGE_PREFIX}${getCleanUserId(userId)}`,
      JSON.stringify(folders)
    );
    notifyFolderChanges();
    if (!skipCloudPush) {
      void pushFoldersToCloud(userId, true);
    }
  } catch (err) {
    console.warn('Errore durante il salvataggio delle cartelle utente:', err);
  }
};

/**
 * Crea una nuova cartella.
 */
export const createFolder = (
  name: string,
  userId?: string,
  color = '#ff7700'
): WorkoutFolder => {
  const trimmed = name.trim() || 'Nuova Cartella';
  const now = new Date().toISOString();
  const newFolder: WorkoutFolder = {
    id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    color,
  };

  const existing = getFolders(userId);
  const updated = [...existing, newFolder];
  saveFolders(updated, userId);
  return newFolder;
};

/**
 * Rinomina una cartella esistente.
 */
export const renameFolder = (
  folderId: string,
  newName: string,
  userId?: string
): WorkoutFolder | null => {
  const trimmed = newName.trim();
  if (!trimmed) return null;

  const existing = getFolders(userId);
  let updatedFolder: WorkoutFolder | null = null;
  const now = new Date().toISOString();

  const nextFolders = existing.map((f) => {
    if (f.id === folderId) {
      updatedFolder = { ...f, name: trimmed, updatedAt: now };
      return updatedFolder;
    }
    return f;
  });

  if (updatedFolder) {
    saveFolders(nextFolders, userId);
  }
  return updatedFolder;
};

/**
 * Elimina una cartella. Le schede collegate tornano automaticamente al livello radice (non eliminate).
 */
export const deleteFolder = (folderId: string, userId?: string): void => {
  markFolderDeleted(folderId, userId);

  const existing = getFolders(userId);
  const nextFolders = existing.filter((f) => f.id !== folderId);
  saveFolders(nextFolders, userId, true);

  // Rimuove tutte le assegnazioni associate a questa cartella registrando tombstone timestamped
  const assignments = getFolderAssignments(userId);
  const metaUpdates: Record<string, null> = {};
  const nextAssignments: FolderAssignmentMap = {};

  Object.entries(assignments).forEach(([schedaId, fId]) => {
    if (fId === folderId) {
      metaUpdates[schedaId] = null;
    } else {
      nextAssignments[schedaId] = fId;
    }
  });

  if (Object.keys(metaUpdates).length > 0) {
    updateAssignmentMetaEntries(metaUpdates, userId);
    saveFolderAssignments(nextAssignments, userId, true);
  }

  void pushFoldersToCloud(userId, true);
};

/**
 * Recupera la mappa delle assegnazioni schedaId -> folderId.
 */
export const getFolderAssignments = (userId?: string): FolderAssignmentMap => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }

  try {
    const raw = localStorage.getItem(`${ASSIGNMENTS_STORAGE_PREFIX}${getCleanUserId(userId)}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as FolderAssignmentMap;
  } catch (err) {
    console.warn('Errore durante la lettura delle assegnazioni cartella:', err);
    return {};
  }
};

/**
 * Salva la mappa delle assegnazioni in localStorage e su cloud.
 */
export const saveFolderAssignments = (
  assignments: FolderAssignmentMap,
  userId?: string,
  skipCloudPush = false
): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(
      `${ASSIGNMENTS_STORAGE_PREFIX}${getCleanUserId(userId)}`,
      JSON.stringify(assignments)
    );
    notifyFolderChanges();
    if (!skipCloudPush) {
      void pushFoldersToCloud(userId, true);
    }
  } catch (err) {
    console.warn('Errore durante il salvataggio delle assegnazioni cartella:', err);
  }
};

/**
 * Assegna una scheda a una cartella (o la rimuove da ogni cartella se folderId è null).
 */
export const assignSchedaToFolder = (
  schedaId: string | number,
  folderId: string | null,
  userId?: string
): void => {
  const sId = String(schedaId);
  const assignments = { ...getFolderAssignments(userId) };

  if (!folderId) {
    delete assignments[sId];
  } else {
    assignments[sId] = folderId;
  }

  updateAssignmentMetaEntries({ [sId]: folderId || null }, userId);
  saveFolderAssignments(assignments, userId);
};

/**
 * Sposta una lista di schede all'interno di una cartella (o al livello radice se folderId è null).
 */
export const moveSchedeToFolder = (
  schedaIds: (string | number)[],
  folderId: string | null,
  userId?: string
): void => {
  const assignments = { ...getFolderAssignments(userId) };
  const metaUpdates: Record<string, string | null> = {};

  schedaIds.forEach((id) => {
    const sId = String(id);
    if (!folderId) {
      delete assignments[sId];
      metaUpdates[sId] = null;
    } else {
      assignments[sId] = folderId;
      metaUpdates[sId] = folderId;
    }
  });

  updateAssignmentMetaEntries(metaUpdates, userId);
  saveFolderAssignments(assignments, userId);
};

/**
 * Rimuove ogni riferimento locale/cloud di una scheda eliminata dalle cartelle e dal relativo ordinamento.
 */
export const cleanupDeletedSchedaFromFolders = (
  schedaId: string | number,
  userId?: string
): void => {
  const sId = String(schedaId);
  const assignments = { ...getFolderAssignments(userId) };
  let dirty = false;

  if (Object.prototype.hasOwnProperty.call(assignments, sId)) {
    delete assignments[sId];
    updateAssignmentMetaEntries({ [sId]: null }, userId);
    saveFolderAssignments(assignments, userId, true);
    dirty = true;
  }

  const now = new Date().toISOString();
  const folders = getFolders(userId);
  let foldersDirty = false;
  const nextFolders = folders.map((folder) => {
    if (Array.isArray(folder.schedeOrder) && folder.schedeOrder.includes(sId)) {
      foldersDirty = true;
      return {
        ...folder,
        schedeOrder: folder.schedeOrder.filter((id) => id !== sId),
        updatedAt: now,
      };
    }
    return folder;
  });

  if (foldersDirty) {
    saveFolders(nextFolders, userId, true);
    dirty = true;
  }

  if (dirty) {
    void pushFoldersToCloud(userId, true);
  }
};

/**
 * Recupera l'id della cartella a cui appartiene una scheda (strettamente read-only: restituisce null se non categorizzata o se la cartella è stata cancellata).
 */
export const getFolderForScheda = (
  schedaId: string | number,
  userId?: string
): string | null => {
  const sId = String(schedaId);
  const assignments = getFolderAssignments(userId);
  const folderId = assignments[sId];
  if (!folderId) return null;

  // Verifica che la cartella esista ancora senza side-effect mutativi
  const folders = getFolders(userId);
  return folders.some((f) => f.id === folderId) ? folderId : null;
};

/**
 * Hook/helper di sottoscrizione per reagire alle modifiche delle cartelle.
 */
export const subscribeToFolderChanges = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleCustomEvent = () => callback();
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key &&
      (e.key.startsWith(FOLDERS_STORAGE_PREFIX) || e.key.startsWith(ASSIGNMENTS_STORAGE_PREFIX))
    ) {
      callback();
    }
  };

  window.addEventListener(FOLDER_CHANGE_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(FOLDER_CHANGE_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorage);
  };
};


/**
 * Recupera l'elenco ordinato degli ID delle schede all'interno di una cartella.
 */
export const getSchedeOrderInFolder = (
  folderId: string,
  userId?: string
): string[] => {
  const folders = getFolders(userId);
  const folder = folders.find((f) => f.id === folderId);
  return folder?.schedeOrder && Array.isArray(folder.schedeOrder)
    ? [...folder.schedeOrder]
    : [];
};

/**
 * Salva la sequenza ordinata degli ID delle schede per una cartella.
 */
export const setSchedeOrderInFolder = (
  folderId: string,
  orderedIds: (string | number)[],
  userId?: string
): void => {
  const folders = getFolders(userId);
  const strIds = orderedIds.map((id) => String(id));
  const updated = folders.map((f) => {
    if (f.id === folderId) {
      return {
        ...f,
        schedeOrder: strIds,
        updatedAt: new Date().toISOString(),
      };
    }
    return f;
  });
  saveFolders(updated, userId);
};

/**
 * Sposta una scheda verso l'alto ('up') o verso il basso ('down') nell'ordine della cartella.
 */
export const moveSchedaInFolderOrder = (
  folderId: string,
  schedaId: string | number,
  direction: 'up' | 'down',
  allSchedeInFolderIds: (string | number)[],
  userId?: string
): void => {
  const sId = String(schedaId);
  const currentOrder = getSchedeOrderInFolder(folderId, userId);

  // Combina l'ordine memorizzato con le schede effettivamente presenti per evitare id mancanti
  const combined = [...currentOrder];
  allSchedeInFolderIds.forEach((id) => {
    const str = String(id);
    if (!combined.includes(str)) {
      combined.push(str);
    }
  });

  // Mantieni solo gli id validi che sono attualmente nella cartella
  const validSet = new Set(allSchedeInFolderIds.map((id) => String(id)));
  const filtered = combined.filter((id) => validSet.has(id));

  const idx = filtered.indexOf(sId);
  if (idx === -1) return;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= filtered.length) return;

  // Scambia gli elementi
  const temp = filtered[idx];
  filtered[idx] = filtered[targetIdx];
  filtered[targetIdx] = temp;

  setSchedeOrderInFolder(folderId, filtered, userId);
};

/**
 * Ordina un array di schede secondo l'ordine personalizzato definito per la cartella.
 */
export const sortSchedeByFolderOrder = <T extends { id: string | number }>(
  schede: T[],
  folderId: string,
  userId?: string
): T[] => {
  if (!schede || schede.length <= 1) return schede;
  const order = getSchedeOrderInFolder(folderId, userId);
  if (!order || order.length === 0) return schede;

  const orderMap = new Map<string, number>();
  order.forEach((id, idx) => {
    orderMap.set(id, idx);
  });

  return [...schede].sort((a, b) => {
    const idxA = orderMap.has(String(a.id)) ? orderMap.get(String(a.id))! : 999999;
    const idxB = orderMap.has(String(b.id)) ? orderMap.get(String(b.id))! : 999999;
    return idxA - idxB;
  });
};

/**
 * Calcola la prossima scheda sequenziale all'interno della cartella rispetto all'ultimo workout fatto.
 * Implementa la rotazione ciclica: se l'ultimo fatto era l'ultimo della cartella, ricomincia dalla scheda #1.
 */
export const getNextSchedaInFolder = <T extends { id: string | number; nome?: string }>(
  folderId: string,
  currentSchedaId: string | number,
  allSchedeInFolder: T[],
  userId?: string
): { nextScheda: T; currentIndex: number; nextIndex: number; total: number } | null => {
  if (!allSchedeInFolder || allSchedeInFolder.length === 0) return null;

  const sorted = sortSchedeByFolderOrder(allSchedeInFolder, folderId, userId);
  const curStr = String(currentSchedaId);
  const curIdx = sorted.findIndex((s) => String(s.id) === curStr);

  if (curIdx === -1) {
    return {
      nextScheda: sorted[0],
      currentIndex: 0,
      nextIndex: 0,
      total: sorted.length,
    };
  }

  const nextIdx = (curIdx + 1) % sorted.length;
  return {
    nextScheda: sorted[nextIdx],
    currentIndex: curIdx,
    nextIndex: nextIdx,
    total: sorted.length,
  };
};
