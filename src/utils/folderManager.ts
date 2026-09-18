/**
 * folderManager.ts — Gestione offline-first delle cartelle per le schede di allenamento.
 *
 * Consente di:
 *  - Creare, rinominare ed eliminare cartelle per utente
 *  - Assegnare o spostare singole schede o gruppi di schede tra cartelle (o al livello radice)
 *  - Propagare i cambiamenti in tempo reale tra componenti tramite CustomEvent e listener di storage
 */
import { supabase } from '../lib/supabase';

export interface WorkoutFolder {
  id: string;
  name: string;
  createdAt: string;
  color?: string; // Colore tema per badge/bordo/icona (es. orange, cyan, emerald, purple, rose, amber)
}

export interface FolderAssignmentMap {
  [schedaId: string]: string; // schedaId -> folderId
}

const FOLDERS_STORAGE_PREFIX = 'workout_folders_v1:';
const ASSIGNMENTS_STORAGE_PREFIX = 'workout_folder_assignments_v1:';
export const FOLDER_CHANGE_EVENT = 'workout-folders-changed';

let cloudPushTimeout: ReturnType<typeof setTimeout> | null = null;
let isCloudSyncing = false;

const getCleanUserId = (userId?: string): string => {
  return userId && userId.trim() ? userId.trim() : 'guest';
};

const notifyFolderChanges = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOLDER_CHANGE_EVENT));
  }
};

/**
 * Spinge l'elenco cartelle e assegnazioni locali verso i metadati utente Supabase (con debounce 500ms).
 */
export const pushFoldersToCloud = (userId?: string): void => {
  const cleanId = getCleanUserId(userId);
  if (cleanId === 'guest') return;

  if (cloudPushTimeout) {
    clearTimeout(cloudPushTimeout);
  }

  cloudPushTimeout = setTimeout(async () => {
    try {
      const currentFolders = getFolders(cleanId);
      const currentAssignments = getFolderAssignments(cleanId);

      await supabase.auth.updateUser({
        data: {
          workout_folders: currentFolders,
          workout_folder_assignments: currentAssignments,
        },
      });
    } catch (err) {
      console.debug('Cloud folder push skipped/failed:', err);
    }
  }, 500);
};

/**
 * Sincronizza bidirezionalmente le cartelle locali con Supabase:
 * - Se il cloud ha cartelle e il locale è vuoto (es. nuovo dispositivo / iPhone): scarica dal cloud nel localStorage.
 * - Se il locale ha cartelle e il cloud è vuoto (es. primo sync dal PC): effettua il push al cloud.
 * - Se entrambi hanno dati: unifica le cartelle e le assegnazioni.
 */
export const syncFoldersWithCloud = async (userId?: string): Promise<void> => {
  const cleanId = getCleanUserId(userId);
  if (cleanId === 'guest' || isCloudSyncing) return;

  isCloudSyncing = true;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user || data.user.id !== cleanId) {
      return;
    }

    const metadata = data.user.user_metadata || {};
    const cloudFolders = Array.isArray(metadata.workout_folders) ? (metadata.workout_folders as WorkoutFolder[]) : null;
    const cloudAssignments = (metadata.workout_folder_assignments && typeof metadata.workout_folder_assignments === 'object')
      ? (metadata.workout_folder_assignments as FolderAssignmentMap)
      : null;

    const localFolders = getFolders(cleanId);
    const localAssignments = getFolderAssignments(cleanId);

    // Caso 1: il cloud ha dati e il locale è vuoto (es. iPhone con app appena installata)
    if (cloudFolders && cloudFolders.length > 0 && localFolders.length === 0) {
      saveFolders(cloudFolders, cleanId, true);
      if (cloudAssignments) {
        saveFolderAssignments(cloudAssignments, cleanId, true);
      }
      return;
    }

    // Caso 2: il locale ha dati e il cloud è ancora vuoto (es. primo sync dal PC)
    if (localFolders.length > 0 && (!cloudFolders || cloudFolders.length === 0)) {
      pushFoldersToCloud(cleanId);
      return;
    }

    // Caso 3: entrambi hanno dati -> unione (merge)
    if (cloudFolders && cloudFolders.length > 0 && localFolders.length > 0) {
      const folderMap = new Map<string, WorkoutFolder>();
      cloudFolders.forEach((f) => folderMap.set(f.id, f));
      localFolders.forEach((f) => folderMap.set(f.id, f));
      const mergedFolders = Array.from(folderMap.values());

      const mergedAssignments: FolderAssignmentMap = {
        ...(cloudAssignments || {}),
        ...localAssignments,
      };

      const localFoldersJson = JSON.stringify(localFolders);
      const mergedFoldersJson = JSON.stringify(mergedFolders);
      const localAssignJson = JSON.stringify(localAssignments);
      const mergedAssignJson = JSON.stringify(mergedAssignments);

      if (localFoldersJson !== mergedFoldersJson || localAssignJson !== mergedAssignJson) {
        saveFolders(mergedFolders, cleanId, true);
        saveFolderAssignments(mergedAssignments, cleanId, true);
        pushFoldersToCloud(cleanId);
      }
    }
  } catch (err) {
    console.debug('Error in syncFoldersWithCloud:', err);
  } finally {
    isCloudSyncing = false;
  }
};

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
 * Salva l'elenco delle cartelle in localStorage per l'utente.
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
      pushFoldersToCloud(userId);
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
  const newFolder: WorkoutFolder = {
    id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    createdAt: new Date().toISOString(),
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

  const nextFolders = existing.map((f) => {
    if (f.id === folderId) {
      updatedFolder = { ...f, name: trimmed };
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
 * Salva la mappa delle assegnazioni in localStorage.
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
      pushFoldersToCloud(userId);
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
