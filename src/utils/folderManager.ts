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
}

export interface FolderAssignmentMap {
  [schedaId: string]: string; // schedaId -> folderId
}

const FOLDERS_STORAGE_PREFIX = 'workout_folders_v1:';
const ASSIGNMENTS_STORAGE_PREFIX = 'workout_folder_assignments_v1:';
const DELETED_STORAGE_PREFIX = 'workout_deleted_folders_v1:';
export const FOLDER_CHANGE_EVENT = 'workout-folders-changed';

let cloudPushTimeout: ReturnType<typeof setTimeout> | null = null;
let isCloudSyncing = false;
let pendingPushUserId: string | null = null;

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

/**
 * Spinge l'elenco cartelle e assegnazioni locali verso i metadati utente Supabase.
 * Supporta esecuzione immediata (per azioni utente) o debounced.
 */
export const pushFoldersToCloud = async (userId?: string, immediate = true): Promise<void> => {
  const targetId = await resolveUserId(userId);
  if (!targetId) return;

  pendingPushUserId = targetId;

  const executePush = async () => {
    try {
      const currentFolders = getFolders(targetId);
      const currentAssignments = getFolderAssignments(targetId);
      const currentDeleted = getDeletedFolderIds(targetId);

      const { error } = await supabase.auth.updateUser({
        data: {
          workout_folders: currentFolders,
          workout_folder_assignments: currentAssignments,
          workout_deleted_folders: currentDeleted,
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
  const targetId = await resolveUserId(userId);
  if (!targetId || isCloudSyncing) return;

  isCloudSyncing = true;
  try {
    // Migrazione automatica cartelle 'guest' (es. se create prima che l'auth caricasse)
    const guestFolders = getFolders('guest');
    const guestAssignments = getFolderAssignments('guest');
    if (guestFolders.length > 0) {
      const existingUserFolders = getFolders(targetId);
      const existingUserAssignments = getFolderAssignments(targetId);

      const mergedWithGuest = [...existingUserFolders];
      guestFolders.forEach((gf) => {
        if (!mergedWithGuest.some((f) => f.id === gf.id)) {
          mergedWithGuest.push(gf);
        }
      });

      saveFolders(mergedWithGuest, targetId, true);
      saveFolderAssignments({ ...existingUserAssignments, ...guestAssignments }, targetId, true);

      localStorage.removeItem(`${FOLDERS_STORAGE_PREFIX}guest`);
      localStorage.removeItem(`${ASSIGNMENTS_STORAGE_PREFIX}guest`);
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user || data.user.id !== targetId) {
      return;
    }

    const metadata = data.user.user_metadata || {};
    const cloudFolders = Array.isArray(metadata.workout_folders) ? (metadata.workout_folders as WorkoutFolder[]) : null;
    const cloudAssignments = (metadata.workout_folder_assignments && typeof metadata.workout_folder_assignments === 'object')
      ? (metadata.workout_folder_assignments as FolderAssignmentMap)
      : null;
    const cloudDeleted = Array.isArray(metadata.workout_deleted_folders) ? (metadata.workout_deleted_folders as string[]) : [];

    const localFolders = getFolders(targetId);
    const localAssignments = getFolderAssignments(targetId);
    const localDeleted = getDeletedFolderIds(targetId);

    // Unisci lista delle cartelle cancellate (tombstones)
    const allDeleted = Array.from(new Set([...cloudDeleted, ...localDeleted]));
    if (allDeleted.length > localDeleted.length) {
      localStorage.setItem(`${DELETED_STORAGE_PREFIX}${targetId}`, JSON.stringify(allDeleted));
    }

    // Caso 1: il cloud ha dati e il locale è vuoto (es. iPhone con app o PWA appena aperta)
    if (cloudFolders && cloudFolders.length > 0 && localFolders.length === 0) {
      const filtered = cloudFolders.filter((f) => !allDeleted.includes(f.id));
      saveFolders(filtered, targetId, true);
      if (cloudAssignments) {
        saveFolderAssignments(cloudAssignments, targetId, true);
      }
      return;
    }

    // Caso 2: il locale ha dati e il cloud è ancora vuoto (es. primo sync)
    if (localFolders.length > 0 && (!cloudFolders || cloudFolders.length === 0)) {
      await pushFoldersToCloud(targetId, true);
      return;
    }

    // Caso 3: entrambi hanno dati -> unione intelligente basata su updatedAt (Last-Write-Wins) ed esclusione tombstones
    if (cloudFolders && cloudFolders.length > 0 && localFolders.length > 0) {
      const folderMap = new Map<string, WorkoutFolder>();

      const processFolder = (f: WorkoutFolder) => {
        if (allDeleted.includes(f.id)) return;
        const existing = folderMap.get(f.id);
        if (!existing) {
          folderMap.set(f.id, f);
        } else {
          const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
          const incomingTime = new Date(f.updatedAt || f.createdAt || 0).getTime();
          if (incomingTime >= existingTime) {
            folderMap.set(f.id, f);
          }
        }
      };

      cloudFolders.forEach(processFolder);
      localFolders.forEach(processFolder);

      const mergedFolders = Array.from(folderMap.values());
      const mergedAssignments: FolderAssignmentMap = {
        ...(cloudAssignments || {}),
        ...localAssignments,
      };

      // Pulizia assegnazioni di cartelle eliminate
      Object.entries(mergedAssignments).forEach(([schedaId, folderId]) => {
        if (allDeleted.includes(folderId) || !mergedFolders.some((f) => f.id === folderId)) {
          delete mergedAssignments[schedaId];
        }
      });

      const localFoldersJson = JSON.stringify(localFolders);
      const mergedFoldersJson = JSON.stringify(mergedFolders);
      const localAssignJson = JSON.stringify(localAssignments);
      const mergedAssignJson = JSON.stringify(mergedAssignments);

      if (localFoldersJson !== mergedFoldersJson || localAssignJson !== mergedAssignJson) {
        saveFolders(mergedFolders, targetId, true);
        saveFolderAssignments(mergedAssignments, targetId, true);
        await pushFoldersToCloud(targetId, true);
      }
    }
  } catch (err) {
    console.debug('Error in syncFoldersWithCloud:', err);
  } finally {
    isCloudSyncing = false;
  }
};

/**
 * Listener globali per sincronizzare al focus dell'app e salvare alla chiusura
 */
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    void syncFoldersWithCloud();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void syncFoldersWithCloud();
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
  saveFolders(nextFolders, userId);

  // Rimuove tutte le assegnazioni associate a questa cartella
  const assignments = getFolderAssignments(userId);
  let changed = false;
  const nextAssignments: FolderAssignmentMap = {};

  Object.entries(assignments).forEach(([schedaId, fId]) => {
    if (fId === folderId) {
      changed = true;
    } else {
      nextAssignments[schedaId] = fId;
    }
  });

  if (changed) {
    saveFolderAssignments(nextAssignments, userId);
  }
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

  schedaIds.forEach((id) => {
    const sId = String(id);
    if (!folderId) {
      delete assignments[sId];
    } else {
      assignments[sId] = folderId;
    }
  });

  saveFolderAssignments(assignments, userId);
};

/**
 * Recupera l'id della cartella a cui appartiene una scheda (restituisce null se non categorizzata o se la cartella è stata cancellata).
 */
export const getFolderForScheda = (
  schedaId: string | number,
  userId?: string
): string | null => {
  const sId = String(schedaId);
  const assignments = getFolderAssignments(userId);
  const folderId = assignments[sId];
  if (!folderId) return null;

  // Verifica che la cartella esista ancora
  const folders = getFolders(userId);
  const exists = folders.some((f) => f.id === folderId);
  if (!exists) {
    // Pulizia dell'assegnazione orfana
    assignSchedaToFolder(schedaId, null, userId);
    return null;
  }

  return folderId;
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
