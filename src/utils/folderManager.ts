/**
 * folderManager.ts — Gestione offline-first delle cartelle per le schede di allenamento.
 *
 * Consente di:
 *  - Creare, rinominare ed eliminare cartelle per utente
 *  - Assegnare o spostare singole schede o gruppi di schede tra cartelle (o al livello radice)
 *  - Propagare i cambiamenti in tempo reale tra componenti tramite CustomEvent e listener di storage
 */

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

const getCleanUserId = (userId?: string): string => {
  return userId && userId.trim() ? userId.trim() : 'guest';
};

const notifyFolderChanges = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOLDER_CHANGE_EVENT));
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
export const saveFolders = (folders: WorkoutFolder[], userId?: string): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    localStorage.setItem(
      `${FOLDERS_STORAGE_PREFIX}${getCleanUserId(userId)}`,
      JSON.stringify(folders)
    );
    notifyFolderChanges();
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
  userId?: string
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
