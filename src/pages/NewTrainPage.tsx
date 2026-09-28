/**
 * NewTrainPage.tsx — Editor completo per la creazione e modifica delle schede.
 *
 * È la pagina più grande dell'app (~2100 righe) e gestisce l'intera UX
 * di costruzione di una scheda di allenamento con supporto a tutti i tipi
 * di esercizio supportati dal sistema.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MODALITÀ CREATE vs EDIT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - Create mode (`/new-train`): `isCreateMode = true`, `id` è undefined.
 *    Gli esercizi vengono costruiti da zero nella scheda.
 *  - Edit mode (`/edit-train/:id`): `isCreateMode = false`.
 *    Gli esercizi esistenti vengono caricati da Supabase e popolano il form.
 *
 * Il salvataggio usa `saveExercisesToDb()` (lib/workoutSaveHelper) che esegue
 * delete + re-insert di tutte le righe `esecuzioni` della scheda.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TIPI DI ESERCIZIO SUPPORTATI (`ExerciseDraft`)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - `reps`     : serie × ripetizioni, peso opzionale
 *  - `isometry` : serie × durata (secondi), peso opzionale (es. plank)
 *  - `superset` : circuito di N sub-esercizi eseguiti in sequenza senza riposo,
 *                 poi riposo tra i round
 *  - `emom`     : Every Minute On the Minute — N esercizi in un round a tempo;
 *                 configurabile per round totali e durata del round
 *  - `pyramid`  : serie con reps/peso crescenti o decrescenti (ogni step ha
 *                 reps, riposo e peso propri)
 *
 * Ogni esercizio può avere:
 *  - `instruction_note`  : note testuali di esecuzione
 *  - `auto_count_type`   : tipo per il conteggio automatico (pushups / pullups)
 *  - `transition_rest_seconds` : riposo prima del prossimo esercizio
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * DRAFT PERSISTENCE (solo create mode)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Ogni modifica alla scheda viene salvata automaticamente nel localStorage
 * (chiave `new_workout_draft_v1:{userId}`) con throttle per evitare scritture
 * eccessive. Il draft viene ripristinato al reload o alla prossima apertura
 * della pagina (se la sessione è ancora valida).
 *
 * Il draft ha un TTL di 7 giorni (`NEW_WORKOUT_DRAFT_MAX_AGE_MS`).
 * Al salvataggio o all'abbandono consapevole, il draft viene cancellato.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NUMBER DRAFTS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `numberDrafts` è un dizionario `{ [fieldKey: string]: string }` che mantiene
 * il valore "grezzo" (come stringa) degli input numerici mentre l'utente sta
 * digitando. Questo permette input parziali (es. "1_" durante la digitazione di "10")
 * senza forzare la conversione in numero ad ogni keystroke.
 * La conversione sicura avviene tramite `toSafeInteger()` e `toSafeWeight()`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * AUTO-SCROLL ALL'ESERCIZIO
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Se la pagina viene aperta con il parametro `?exerciseIndex=N` in querystring
 * (es. da ActiveWorkoutPage → "edit this exercise"), la pagina fa auto-scroll
 * alla card dell'esercizio N e la mette a fuoco (`focusedExerciseId`).
 */
import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  Clock,
  Move,
  Copy,
  Minus,
  Sparkles,
  History,
  Check,
  Camera,
  Mic,
  Folder,
  Dumbbell,
  Layers,
  RotateCcw,
  Timer,
  TrendingUp,
  FileText,
  Activity,
  X,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import WorkoutBulkToolbar from '../components/WorkoutBulkToolbar';
import WorkoutQuickImportModal from '../components/WorkoutQuickImportModal';
import { useUserExerciseHistory, type UserExerciseHistoryItem } from '../hooks/useUserExerciseHistory';
import { parseExerciseInput, type ParsedWorkoutItem } from '../utils/parseExerciseInput';
import {
  getFolders,
  createFolder,
  assignSchedaToFolder,
  getFolderForScheda,
  type WorkoutFolder,
} from '../utils/folderManager';
import { generateUUID } from '../utils/uuid';
import { hapticLight } from '../utils/haptics';

interface ExerciseDraft {
  id: string;
  type: 'reps' | 'isometry' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  emom_rounds?: number;
  emom_round_duration?: number;
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry' | 'cardio';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
}

interface PersistedNewWorkoutDraftPayload {
  version: 1;
  savedAtMs: number;
  workoutName: string;
  exercises: ExerciseDraft[];
  numberDrafts: Record<string, string>;
}

const NEW_WORKOUT_DRAFT_STORAGE_PREFIX = 'new_workout_draft_v1';
const NEW_WORKOUT_DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const NEW_WORKOUT_DRAFT_RESUME_SESSION_PREFIX = 'new_workout_draft_resume_v1';

const getNewWorkoutDraftStorageKey = (userId: string) => {
  return `${NEW_WORKOUT_DRAFT_STORAGE_PREFIX}:${userId}`;
};

const getNewWorkoutDraftResumeSessionKey = (userId: string) => {
  return `${NEW_WORKOUT_DRAFT_RESUME_SESSION_PREFIX}:${userId}`;
};

const toSafeInteger = (value: unknown, fallback: number, min = 0) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  return parsed;
};

const toSafeWeight = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
};

const normalizeSubExerciseDraft = (raw: unknown): NonNullable<ExerciseDraft['subExercises']>[number] => {
  const sub = (raw || {}) as Record<string, unknown>;
  const subTypeRaw = String(sub.type || 'reps').toLowerCase();
  const type: 'reps' | 'isometry' | 'cardio' =
    subTypeRaw === 'cardio' ? 'cardio' : (subTypeRaw === 'isometry' ? 'isometry' : 'reps');

  return {
    name: String(sub.name || ''),
    type,
    reps: toSafeInteger(sub.reps, type === 'reps' ? 10 : 0, 0),
    duration_seconds: toSafeInteger(sub.duration_seconds, (type === 'isometry' || type === 'cardio') ? 30 : 0, 0),
    weight_kg: toSafeWeight(sub.weight_kg),
    instruction_note: String(sub.instruction_note || ''),
  };
};

const normalizePyramidStepDraft = (raw: unknown) => {
  const step = (raw || {}) as Record<string, unknown>;
  return {
    reps: toSafeInteger(step.reps, 10, 1),
    rest_seconds: toSafeInteger(step.rest_seconds, 60, 0),
    weight_kg: toSafeWeight(step.weight_kg),
    instruction_note: String(step.instruction_note || ''),
  };
};

const normalizeExerciseDraft = (raw: unknown): ExerciseDraft => {
  const ex = (raw || {}) as Record<string, unknown>;
  const typeRaw = String(ex.type || 'reps').toLowerCase();
  const type: ExerciseDraft['type'] =
    typeRaw === 'isometry' || typeRaw === 'cardio' || typeRaw === 'superset' || typeRaw === 'circuit' || typeRaw === 'emom' || typeRaw === 'pyramid'
      ? (typeRaw as ExerciseDraft['type'])
      : 'reps';

  const normalized: ExerciseDraft = {
    id: String(ex.id || generateUUID()),
    type,
    name: String(ex.name || ''),
    instruction_note: String(ex.instruction_note || ''),
    sets: toSafeInteger(ex.sets, 3, 1),
    reps: toSafeInteger(ex.reps, 10, 0),
    duration_seconds: toSafeInteger(ex.duration_seconds, 30, 0),
    rest_seconds: toSafeInteger(ex.rest_seconds, 60, 0),
    transition_rest_seconds: toSafeInteger(ex.transition_rest_seconds, 0, 0),
    weight_kg: toSafeWeight(ex.weight_kg),
    auto_count_type: (ex.auto_count_type === 'pushups' || ex.auto_count_type === 'pullups') ? ex.auto_count_type : null,
  };

  if (type === 'emom') {
    normalized.emom_rounds = toSafeInteger(ex.emom_rounds, 10, 1);
    normalized.emom_round_duration = toSafeInteger(ex.emom_round_duration, 60, 1);
  }

  if (type === 'superset' || type === 'circuit' || type === 'emom') {
    const subExercises = Array.isArray(ex.subExercises)
      ? ex.subExercises.map(normalizeSubExerciseDraft)
      : [];
    normalized.subExercises = subExercises;
  }

  if (type === 'pyramid') {
    const pyramidSteps = Array.isArray(ex.pyramid_steps)
      ? ex.pyramid_steps.map(normalizePyramidStepDraft)
      : [];
    normalized.pyramid_steps = pyramidSteps;
    normalized.sets = 1;
    normalized.rest_seconds = 0;
  }

  return normalized;
};

const normalizeNumberDrafts = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return {};

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[String(key)] = String(value ?? '');
  }

  return result;
};

const NewTrainPage: React.FC = () => {
  const PYRAMID_DEFAULT_REPS = 10;
  const PYRAMID_DEFAULT_REPS_INCREMENT = 5;
  const PYRAMID_DEFAULT_REST_SECONDS = 60;

  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [workoutName, setWorkoutName] = useState('');
  const [exercises, setExercises] = useState<ExerciseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [editingTransitionForExerciseId, setEditingTransitionForExerciseId] = useState<string | null>(null);
  const [openTypeMenuExerciseId, setOpenTypeMenuExerciseId] = useState<string | null>(null);
  const [focusedExerciseId, setFocusedExerciseId] = useState<string | null>(null);
  const [didAutoFocusExercise, setDidAutoFocusExercise] = useState(false);
  const exerciseRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const { searchHistory } = useUserExerciseHistory(user?.id);
  const [exerciseSuggestions, setExerciseSuggestions] = useState<Record<string, UserExerciseHistoryItem[]>>({});
  const [exerciseNotices, setExerciseNotices] = useState<Record<string, string>>({});
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const { id } = useParams<{ id: string }>();
  const requestedExerciseIndex = React.useMemo(() => {
    const raw = new URLSearchParams(location.search).get('exerciseIndex');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1, Math.trunc(parsed));
  }, [location.search]);
  const isCreateMode = !id;

  // Folder assignment state
  const [availableFolders, setAvailableFolders] = useState<WorkoutFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  React.useEffect(() => {
    const folders = getFolders(user?.id);
    setAvailableFolders(folders);

    if (isCreateMode) {
      const queryFolderId = new URLSearchParams(location.search).get('folderId');
      if (queryFolderId && folders.some((f) => f.id === queryFolderId)) {
        setSelectedFolderId(queryFolderId);
      }
    }
  }, [user?.id, isCreateMode, location.search]);

  const handleCreateFolderInline = () => {
    if (!newFolderName.trim()) return;
    const created = createFolder(newFolderName.trim(), user?.id);
    setAvailableFolders(getFolders(user?.id));
    setSelectedFolderId(created.id);
    setNewFolderName('');
    setIsNewFolderModalOpen(false);
  };

  const hasCreateDraftHydratedRef = React.useRef(false);
  const createDraftPersistTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressCreateDraftPersistenceRef = React.useRef(false);
  const preserveCreateDraftOnUnmountRef = React.useRef(true);
  const latestCreateDraftRef = React.useRef<{
    workoutName: string;
    exercises: ExerciseDraft[];
    numberDrafts: Record<string, string>;
  }>({
    workoutName: '',
    exercises: [],
    numberDrafts: {},
  });
  const persistCreateDraftRef = React.useRef<(() => void) | null>(null);

  const clearCreateWorkoutDraft = (targetUserId?: string | null) => {
    if (!targetUserId) return;

    const storageKey = getNewWorkoutDraftStorageKey(targetUserId);
    try {
      localStorage.removeItem(storageKey);
    } catch (draftError) {
      console.error('Error clearing create-workout draft:', draftError);
    }
  };

  const setCreateDraftResumeAllowed = (targetUserId?: string | null, allowed = false) => {
    if (!targetUserId) return;

    const sessionKey = getNewWorkoutDraftResumeSessionKey(targetUserId);
    try {
      if (allowed) {
        sessionStorage.setItem(sessionKey, '1');
      } else {
        sessionStorage.removeItem(sessionKey);
      }
    } catch (sessionError) {
      console.error('Error updating create-workout resume session flag:', sessionError);
    }
  };

  const persistCreateWorkoutDraft = () => {
    if (!isCreateMode || !user?.id || !hasCreateDraftHydratedRef.current) return;
    if (suppressCreateDraftPersistenceRef.current) return;

    const storageKey = getNewWorkoutDraftStorageKey(user.id);
    const snapshot = latestCreateDraftRef.current;
    const hasContent =
      snapshot.workoutName.trim().length > 0 ||
      snapshot.exercises.length > 0 ||
      Object.keys(snapshot.numberDrafts).length > 0;

    if (!hasContent) {
      clearCreateWorkoutDraft(user.id);
      return;
    }

    const payload: PersistedNewWorkoutDraftPayload = {
      version: 1,
      savedAtMs: Date.now(),
      workoutName: snapshot.workoutName,
      exercises: snapshot.exercises,
      numberDrafts: snapshot.numberDrafts,
    };

    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (draftError) {
      console.error('Error persisting create-workout draft:', draftError);
    }
  };

  persistCreateDraftRef.current = persistCreateWorkoutDraft;

  React.useEffect(() => {
    latestCreateDraftRef.current = {
      workoutName,
      exercises,
      numberDrafts,
    };
  }, [workoutName, exercises, numberDrafts]);

  React.useEffect(() => {
    hasCreateDraftHydratedRef.current = false;

    if (!isCreateMode || !user?.id) {
      hasCreateDraftHydratedRef.current = true;
      return;
    }

    const sessionKey = getNewWorkoutDraftResumeSessionKey(user.id);
    const canRestoreFromSession = (() => {
      try {
        return sessionStorage.getItem(sessionKey) === '1';
      } catch {
        return false;
      }
    })();

    const navEntry = typeof performance !== 'undefined'
      ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
      : undefined;
    const isReloadNavigation = navEntry?.type === 'reload';

    if (!canRestoreFromSession && !isReloadNavigation) {
      clearCreateWorkoutDraft(user.id);
      hasCreateDraftHydratedRef.current = true;
      return;
    }

    const storageKey = getNewWorkoutDraftStorageKey(user.id);

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        hasCreateDraftHydratedRef.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as PersistedNewWorkoutDraftPayload;
      if (!parsed || parsed.version !== 1) {
        clearCreateWorkoutDraft(user.id);
        hasCreateDraftHydratedRef.current = true;
        return;
      }

      const savedAtMs = Number(parsed.savedAtMs);
      if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > NEW_WORKOUT_DRAFT_MAX_AGE_MS) {
        clearCreateWorkoutDraft(user.id);
        hasCreateDraftHydratedRef.current = true;
        return;
      }

      const restoredWorkoutName = String(parsed.workoutName || '');
      const restoredExercises = Array.isArray(parsed.exercises)
        ? parsed.exercises.map(normalizeExerciseDraft)
        : [];
      const restoredNumberDrafts = normalizeNumberDrafts(parsed.numberDrafts);

      setWorkoutName(restoredWorkoutName);
      setExercises(restoredExercises);
      setNumberDrafts(restoredNumberDrafts);
      setEditingTransitionForExerciseId(null);
      setFocusedExerciseId(null);
      setDidAutoFocusExercise(false);
    } catch (draftError) {
      console.error('Error restoring create-workout draft:', draftError);
      clearCreateWorkoutDraft(user.id);
    } finally {
      hasCreateDraftHydratedRef.current = true;
    }
  }, [isCreateMode, user?.id]);

  React.useEffect(() => {
    if (!isCreateMode || !user?.id) return;

    preserveCreateDraftOnUnmountRef.current = true;

    return () => {
      setCreateDraftResumeAllowed(user.id, preserveCreateDraftOnUnmountRef.current);
    };
  }, [isCreateMode, user?.id]);

  React.useEffect(() => {
    if (!isCreateMode || !user?.id || !hasCreateDraftHydratedRef.current) return;

    if (createDraftPersistTimeoutRef.current) {
      clearTimeout(createDraftPersistTimeoutRef.current);
      createDraftPersistTimeoutRef.current = null;
    }

    createDraftPersistTimeoutRef.current = setTimeout(() => {
      persistCreateDraftRef.current?.();
      createDraftPersistTimeoutRef.current = null;
    }, 250);

    return () => {
      if (createDraftPersistTimeoutRef.current) {
        clearTimeout(createDraftPersistTimeoutRef.current);
        createDraftPersistTimeoutRef.current = null;
      }
    };
  }, [isCreateMode, user?.id, workoutName, exercises, numberDrafts]);

  React.useEffect(() => {
    const flushDraft = () => {
      if (createDraftPersistTimeoutRef.current) {
        clearTimeout(createDraftPersistTimeoutRef.current);
        createDraftPersistTimeoutRef.current = null;
      }
      persistCreateDraftRef.current?.();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushDraft();
      }
    };

    window.addEventListener('beforeunload', flushDraft);
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      flushDraft();
      window.removeEventListener('beforeunload', flushDraft);
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Auto-scroll su selezione/focus di qualsiasi campo per mostrare chiaramente il numero/testo in modifica
  React.useEffect(() => {
    let timer1: number | undefined;
    let timer2: number | undefined;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }

      // Se è un input numerico, seleziona il testo per renderlo leggibile e pronto alla modifica
      if (
        target instanceof HTMLInputElement &&
        (target.type === 'number' || target.inputMode === 'numeric' || target.inputMode === 'decimal')
      ) {
        try {
          target.select();
        } catch {
          // ignore
        }
      }

      const scrollIntoViewSafely = () => {
        if (!target.isConnected) return;
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      };

      // 1. Scroll immediato al frame successivo
      requestAnimationFrame(scrollIntoViewSafely);
      // 2. Scroll calibrato per l'apertura della tastiera virtuale su mobile (iOS Capacitor / Safari / Android)
      timer1 = window.setTimeout(scrollIntoViewSafely, 280);
      timer2 = window.setTimeout(scrollIntoViewSafely, 480);
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      if (timer1) window.clearTimeout(timer1);
      if (timer2) window.clearTimeout(timer2);
    };
  }, []);

  React.useEffect(() => {
    if (id) {
      loadWorkout(id);
    }
  }, [id]);

  React.useEffect(() => {
    setDidAutoFocusExercise(false);
  }, [location.search, id]);

  React.useEffect(() => {
    if (didAutoFocusExercise || requestedExerciseIndex == null || exercises.length === 0) return;

    const targetIndex = Math.min(Math.max(requestedExerciseIndex - 1, 0), exercises.length - 1);
    const targetExercise = exercises[targetIndex];
    if (!targetExercise) return;

    const targetNode = exerciseRefs.current[targetExercise.id];
    if (targetNode) {
      requestAnimationFrame(() => {
        targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    setFocusedExerciseId(targetExercise.id);
    setDidAutoFocusExercise(true);

    const timeoutId = window.setTimeout(() => {
      setFocusedExerciseId((prev) => (prev === targetExercise.id ? null : prev));
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [didAutoFocusExercise, requestedExerciseIndex, exercises]);

  const loadWorkout = async (workoutId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('schede')
        .select(`
          id_scheda,
          nome,
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
        `)
        .eq('id_scheda', Number(workoutId))
        .single();

      if (error) throw error;

      if (data) {
        setWorkoutName(data.nome);
        const currentFolder = getFolderForScheda(workoutId, user?.id);
        setSelectedFolderId(currentFolder);
        const parsed = parseDbExerciseRows(data.esecuzioni || []).map((ex: any) => ({
          ...ex,
          id: generateUUID(),
          instruction_note: typeof ex.instruction_note === 'string' ? ex.instruction_note : '',
          transition_rest_seconds: Number.isFinite(Number(ex.transition_rest_seconds))
            ? Math.max(0, Math.trunc(Number(ex.transition_rest_seconds)))
            : 0,
          subExercises: Array.isArray(ex.subExercises)
            ? ex.subExercises.map((sub: any) => ({
              ...sub,
              type: sub.type === 'isometry' ? 'isometry' : 'reps',
              instruction_note: typeof sub.instruction_note === 'string' ? sub.instruction_note : '',
            }))
            : ex.subExercises,
        }));
        setExercises(parsed as ExerciseDraft[]);
      }
    } catch (err: any) {
      console.error(err);
      setError('Error loading workout');
    } finally {
      setLoading(false);
    }
  };

  /**
   * TECNICA 2: Carry-Over Pattern (Default Inheritance)
   * Aggiunge un nuovo esercizio ereditando sets, reps, rest e duration dall'ultimo esercizio presente.
   */
  const addExercise = () => {
    try {
      void hapticLight();
      const lastEx = exercises[exercises.length - 1];
      const isLastSpecial = lastEx && (lastEx.type === 'pyramid' || lastEx.type === 'circuit' || lastEx.type === 'emom' || lastEx.type === 'superset');
      const inheritedSets = !isLastSpecial && lastEx && Number.isFinite(lastEx.sets) && lastEx.sets > 0 ? lastEx.sets : 3;
      const inheritedReps = !isLastSpecial && lastEx && Number.isFinite(lastEx.reps) && lastEx.reps > 0 ? lastEx.reps : 10;
      const inheritedRest = !isLastSpecial && lastEx && Number.isFinite(lastEx.rest_seconds) && lastEx.rest_seconds > 0 ? lastEx.rest_seconds : 60;
      const inheritedDuration = !isLastSpecial && lastEx && Number.isFinite(lastEx.duration_seconds) && lastEx.duration_seconds > 0 ? lastEx.duration_seconds : 30;

      const newId = generateUUID();
      const newEx: ExerciseDraft = {
        id: newId,
        type: 'reps',
        name: '',
        instruction_note: '',
        sets: inheritedSets,
        reps: inheritedReps,
        duration_seconds: inheritedDuration,
        rest_seconds: inheritedRest,
        transition_rest_seconds: 0,
        weight_kg: null,
      };

      setExercises(prev => [...prev, newEx]);

      // Scroll morbido verso il nuovo esercizio appena aggiunto
      setTimeout(() => {
        const el = exerciseRefs.current[newId];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    } catch (err) {
      console.error('Error adding exercise:', err);
    }
  };

  /**
   * TECNICA 3: Azioni Cumulative / Bulk Edit su Tutta la Scheda
   */
  const handleApplyGlobalRest = (seconds: number) => {
    setExercises(prev =>
      prev.map(ex => {
        const updated = { ...ex, rest_seconds: seconds };
        if (ex.pyramid_steps && ex.pyramid_steps.length > 0) {
          updated.pyramid_steps = ex.pyramid_steps.map(s => ({ ...s, rest_seconds: seconds }));
        }
        return updated;
      })
    );
    // Cancella eventuali bozze attive di recupero nei numberDrafts
    setNumberDrafts(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.includes(':rest:') || k.includes(':step:') && k.includes(':rest')) {
          delete next[k];
        }
      });
      return next;
    });
  };

  const handleApplyGlobalSets = (sets: number) => {
    setExercises(prev =>
      prev.map(ex => {
        if (ex.type === 'emom') {
          return { ...ex, sets, emom_rounds: sets };
        }
        if (ex.type === 'pyramid') {
          return ex;
        }
        return { ...ex, sets };
      })
    );
    setNumberDrafts(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.endsWith(':sets') || k.endsWith(':emom_rounds')) {
          delete next[k];
        }
      });
      return next;
    });
  };

  /**
   * TECNICA 4: Smart String Parser Inline
   * Popola e converte l'esercizio se la stringa digitata corrisponde a sintassi nota.
   */
  const handleApplyParsedToExercise = (id: string, parsed: ParsedWorkoutItem) => {
    if (!parsed.matched) return;

    setExercises(prev =>
      prev.map(ex => {
        if (ex.id !== id) return ex;

        if (parsed.type === 'emom') {
          return {
            ...ex,
            type: 'emom',
            name: parsed.name,
            sets: parsed.sets,
            emom_rounds: parsed.emom_rounds || parsed.sets,
            emom_round_duration: parsed.emom_round_duration || 60,
            rest_seconds: parsed.rest_seconds,
            subExercises: (parsed.subExercises || []).map(s => ({
              name: s.name,
              type: s.type === 'isometry' ? 'isometry' : 'reps',
              reps: s.reps,
              duration_seconds: s.duration_seconds,
              weight_kg: s.weight_kg ?? null,
              instruction_note: '',
            })),
          };
        }

        if (parsed.type === 'circuit') {
          return {
            ...ex,
            type: 'circuit',
            name: parsed.name,
            sets: parsed.sets,
            rest_seconds: parsed.rest_seconds,
            subExercises: (parsed.subExercises || []).map(s => ({
              name: s.name,
              type: s.type === 'isometry' ? 'isometry' : 'reps',
              reps: s.reps,
              duration_seconds: s.duration_seconds,
              weight_kg: s.weight_kg ?? null,
              instruction_note: '',
            })),
          };
        }

        if (parsed.type === 'superset') {
          return {
            ...ex,
            type: 'superset',
            name: parsed.name,
            sets: parsed.sets,
            rest_seconds: parsed.rest_seconds,
            subExercises: (parsed.subExercises || []).map(s => ({
              name: s.name,
              type: s.type === 'isometry' ? 'isometry' : 'reps',
              reps: s.reps,
              duration_seconds: s.duration_seconds,
              weight_kg: s.weight_kg ?? null,
              instruction_note: '',
            })),
          };
        }

        if (parsed.type === 'pyramid') {
          return {
            ...ex,
            type: 'pyramid',
            name: parsed.name,
            sets: 1,
            rest_seconds: 0,
            pyramid_steps: (parsed.pyramid_steps || []).map(s => ({
              reps: s.reps,
              rest_seconds: s.rest_seconds,
              weight_kg: s.weight_kg ?? null,
              instruction_note: '',
            })),
          };
        }

        if (parsed.type === 'isometry') {
          return {
            ...ex,
            type: 'isometry',
            name: parsed.name,
            sets: parsed.sets,
            reps: 0,
            duration_seconds: parsed.duration_seconds,
            rest_seconds: parsed.rest_seconds,
          };
        }

        return {
          ...ex,
          type: 'reps',
          name: parsed.name,
          sets: parsed.sets,
          reps: parsed.reps,
          rest_seconds: parsed.rest_seconds,
          weight_kg: parsed.weight_kg !== undefined ? parsed.weight_kg : ex.weight_kg,
        };
      })
    );

    // Resetta numberDrafts per questo esercizio in modo che i nuovi valori numerici appaiano subito
    setNumberDrafts(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(id)) {
          delete next[k];
        }
      });
      return next;
    });
  };

  /**
   * TECNICA 1: Autofill da Storico Utente
   */
  const handleApplyHistoryItemToExercise = (id: string, item: UserExerciseHistoryItem) => {
    setExercises(prev =>
      prev.map(ex => {
        if (ex.id !== id) return ex;

        if (item.type === 'pyramid' && item.pyramid_steps && item.pyramid_steps.length > 0) {
          return {
            ...ex,
            name: item.name,
            type: 'pyramid',
            sets: 1,
            rest_seconds: 0,
            pyramid_steps: item.pyramid_steps.map(s => ({
              reps: s.reps,
              rest_seconds: s.rest_seconds,
              weight_kg: s.weight_kg ?? null,
              instruction_note: '',
            })),
          };
        }

        return {
          ...ex,
          name: item.name,
          type: item.type || (ex.type === 'pyramid' ? 'reps' : ex.type) || 'reps',
          sets: item.sets || ex.sets || 3,
          reps: item.reps || ex.reps || 10,
          duration_seconds: item.duration_seconds || ex.duration_seconds || 30,
          rest_seconds: item.rest_seconds ?? ex.rest_seconds ?? 60,
          weight_kg: item.weight_kg ?? null,
          pyramid_steps: ex.type === 'pyramid' && item.type !== 'pyramid' ? undefined : ex.pyramid_steps,
        };
      })
    );

    setNumberDrafts(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(id)) {
          delete next[k];
        }
      });
      return next;
    });
  };

  /** Regolazione incrementale (+/-) per serie, reps, emom_rounds */
  const adjustExerciseNumber = (exId: string, field: 'sets' | 'reps' | 'duration_seconds' | 'emom_rounds', delta: number) => {
    setExercises(prev =>
      prev.map(ex => {
        if (ex.id !== exId) return ex;
        const current = Number(ex[field]) || 0;
        const minVal = (field === 'sets' || field === 'emom_rounds') ? 1 : 0;
        const next = Math.max(minVal, current + delta);
        return { ...ex, [field]: next };
      })
    );

    setNumberDrafts(prev => {
      const next = { ...prev };
      delete next[`${exId}:${field}`];
      delete next[`${exId}:duration:min`];
      delete next[`${exId}:duration:sec`];
      delete next[`${exId}:rest:min`];
      delete next[`${exId}:rest:sec`];
      return next;
    });
  };

  const applyTransitionPreset = (exId: string, seconds: number) => {
    void hapticLight();
    updateExercise(exId, 'transition_rest_seconds', seconds);
    clearDraftValue(`${exId}:transition_rest:min`);
    clearDraftValue(`${exId}:transition_rest:sec`);
  };

  const handleTypeChange = (id: string, targetType: 'normal' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid') => {
    void hapticLight();
    setOpenTypeMenuExerciseId(null);
    const ex = exercises.find(e => e.id === id);
    if (!ex) return;

    if (targetType === 'normal') {
      if (ex.type === 'reps' || ex.type === 'isometry') return;
      const firstSub = ex.subExercises?.[0];
      const baseName = (ex.name || firstSub?.name || '').trim();
      const baseReps = ex.type === 'pyramid'
        ? (ex.pyramid_steps?.[0]?.reps || 10)
        : (firstSub?.reps ?? (ex.reps || 10));
      const baseDuration = firstSub?.duration_seconds ?? (ex.duration_seconds || 30);
      const baseWeight = ex.type === 'pyramid'
        ? (ex.pyramid_steps?.[0]?.weight_kg ?? ex.weight_kg ?? null)
        : (firstSub?.weight_kg ?? ex.weight_kg ?? null);
      const baseRest = ex.type === 'pyramid'
        ? (ex.pyramid_steps?.[0]?.rest_seconds || 60)
        : (ex.rest_seconds || 60);

      setExercises(prev =>
        prev.map(item => {
          if (item.id !== id) return item;
          return {
            ...item,
            type: 'reps',
            name: baseName,
            sets: Math.max(1, item.sets || 3),
            reps: baseReps,
            duration_seconds: baseDuration,
            weight_kg: baseWeight,
            rest_seconds: baseRest,
            subExercises: undefined,
            pyramid_steps: undefined,
            emom_rounds: undefined,
            emom_round_duration: undefined,
          };
        })
      );
    } else if (targetType === 'cardio') {
      if (ex.type === 'cardio') return;
      const firstSub = ex.subExercises?.[0];
      const baseName = (ex.name || firstSub?.name || '').trim();
      const baseDuration = firstSub?.duration_seconds ?? (ex.duration_seconds && ex.duration_seconds > 0 ? ex.duration_seconds : 60);
      const baseWeight = ex.type === 'pyramid'
        ? (ex.pyramid_steps?.[0]?.weight_kg ?? ex.weight_kg ?? null)
        : (firstSub?.weight_kg ?? ex.weight_kg ?? null);
      const baseRest = ex.type === 'pyramid'
        ? (ex.pyramid_steps?.[0]?.rest_seconds || 60)
        : (ex.rest_seconds || 60);

      setExercises(prev =>
        prev.map(item => {
          if (item.id !== id) return item;
          return {
            ...item,
            type: 'cardio',
            name: baseName,
            sets: Math.max(1, item.sets || 3),
            reps: 0,
            duration_seconds: baseDuration,
            weight_kg: baseWeight,
            rest_seconds: baseRest,
            subExercises: undefined,
            pyramid_steps: undefined,
            emom_rounds: undefined,
            emom_round_duration: undefined,
          };
        })
      );
    } else if (targetType === 'superset') {
      if (ex.type === 'superset') return;
      convertToSuperset(id);
    } else if (targetType === 'circuit') {
      if (ex.type === 'circuit') return;
      convertToCircuit(id);
    } else if (targetType === 'emom') {
      if (ex.type === 'emom') return;
      convertToEmom(id);
    } else if (targetType === 'pyramid') {
      if (ex.type === 'pyramid') return;
      convertToPyramid(id);
    }
  };

  const convertToSuperset = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        const existingSubs = ex.subExercises && ex.subExercises.length > 0
          ? ex.subExercises.map(sub => ({
              ...sub,
              type: (sub.type === 'isometry' ? 'isometry' : 'reps') as 'reps' | 'isometry',
            }))
          : [
              {
                name: ex.name,
                type: (ex.type === 'isometry' ? 'isometry' : 'reps') as 'reps' | 'isometry',
                reps: Number.isFinite(ex.reps) && ex.reps > 0 ? ex.reps : 10,
                duration_seconds: Number.isFinite(ex.duration_seconds) && ex.duration_seconds > 0 ? ex.duration_seconds : 30,
                weight_kg: ex.weight_kg ?? null,
                instruction_note: ex.instruction_note || '',
              },
              { name: '', type: 'reps' as const, reps: 10, duration_seconds: 0, weight_kg: null, instruction_note: '' }
            ];

        return {
          ...ex,
          type: 'superset',
          subExercises: existingSubs,
        };
      }
      return ex;
    }));
  };

  const convertToCircuit = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        const existingSubs = ex.subExercises && ex.subExercises.length > 0
          ? ex.subExercises.map(sub => ({
              ...sub,
              type: (sub.type === 'isometry' ? 'isometry' : 'reps') as 'reps' | 'isometry',
            }))
          : [
              {
                name: ex.name,
                type: (ex.type === 'isometry' ? 'isometry' : 'reps') as 'reps' | 'isometry',
                reps: Number.isFinite(ex.reps) && ex.reps > 0 ? ex.reps : 10,
                duration_seconds: Number.isFinite(ex.duration_seconds) && ex.duration_seconds > 0 ? ex.duration_seconds : 30,
                weight_kg: ex.weight_kg ?? null,
                instruction_note: ex.instruction_note || '',
              },
              { name: '', type: 'reps' as const, reps: 10, duration_seconds: 0, weight_kg: null, instruction_note: '' }
            ];

        return {
          ...ex,
          type: 'circuit',
          rest_seconds: Math.max(60, ex.rest_seconds || 120),
          subExercises: existingSubs,
        };
      }
      return ex;
    }));
  };

  const convertToPyramid = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        const baseReps = Number.isFinite(ex.reps) && ex.reps > 0 ? ex.reps : PYRAMID_DEFAULT_REPS;
        const baseRest = Number.isFinite(ex.rest_seconds) && ex.rest_seconds > 0 ? ex.rest_seconds : PYRAMID_DEFAULT_REST_SECONDS;

        return {
          ...ex,
          type: 'pyramid',
          sets: 1,
          rest_seconds: 0,
          pyramid_steps: [
            { reps: baseReps, rest_seconds: baseRest, weight_kg: ex.weight_kg ?? null },
            { reps: baseReps + PYRAMID_DEFAULT_REPS_INCREMENT, rest_seconds: baseRest, weight_kg: ex.weight_kg ?? null },
          ],
        };
      }
      return ex;
    }));
  };

  const convertToEmom = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        return {
          ...ex,
          type: 'emom',
          sets: Math.max(1, ex.sets || 1),
          emom_rounds: Math.max(1, ex.emom_rounds || 10),
          emom_round_duration: Math.max(1, ex.emom_round_duration || 60),
          subExercises: [
            {
              name: ex.name,
              type: 'reps',
              reps: ex.type === 'reps' ? Math.max(1, ex.reps) : 1,
              duration_seconds: 0,
              weight_kg: ex.weight_kg ?? null,
              instruction_note: ex.instruction_note || '',
            },
          ],
        };
      }
      return ex;
    }));
  };

  const duplicateExercise = (index: number) => {
    const source = exercises[index];
    if (!source) return;

    const cloned: ExerciseDraft = {
      ...source,
      id: generateUUID(),
      subExercises: source.subExercises
        ? source.subExercises.map((sub) => ({ ...sub }))
        : undefined,
      pyramid_steps: source.pyramid_steps
        ? source.pyramid_steps.map((step) => ({ ...step }))
        : undefined,
    };

    const newExercises = [...exercises];
    newExercises.splice(index + 1, 0, cloned);
    setExercises(newExercises);
  };

  const removeExercise = (id: string) => {
    if (editingTransitionForExerciseId === id) {
      setEditingTransitionForExerciseId(null);
    }
    setExercises(exercises.filter(ex => ex.id !== id));
  };

  const handleImportExercises = (imported: ExerciseDraft[], mode: 'append' | 'replace') => {
    if (mode === 'replace') {
      setExercises(imported);
    } else {
      setExercises(prev => [...prev, ...imported]);
    }
    setNumberDrafts({});
  };

  const moveExercise = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === exercises.length - 1) return;

    const newExercises = [...exercises];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    const temp = newExercises[index];
    newExercises[index] = newExercises[targetIndex];
    newExercises[targetIndex] = temp;

    setExercises(newExercises);
  };

  const updateExercise = (id: string, field: keyof ExerciseDraft, value: any) => {
    setExercises(exercises.map(ex =>
      ex.id === id ? { ...ex, [field]: value } : ex
    ));
  };

  const updateSubExercise = (supersetId: string, subIndex: number, field: string, value: any) => {
    setExercises(exercises.map(ex => {
      if (ex.id === supersetId && ex.subExercises) {
        const newSubs = [...ex.subExercises];
        newSubs[subIndex] = { ...newSubs[subIndex], [field]: value };
        return { ...ex, subExercises: newSubs };
      }
      return ex;
    }));
  };

  const updatePyramidStep = (pyramidId: string, stepIndex: number, field: 'reps' | 'rest_seconds', value: number) => {
    setExercises(exercises.map(ex => {
      if (ex.id === pyramidId && ex.pyramid_steps) {
        const nextSteps = [...ex.pyramid_steps];
        nextSteps[stepIndex] = { ...nextSteps[stepIndex], [field]: value };
        return { ...ex, pyramid_steps: nextSteps };
      }
      return ex;
    }));
  };

  const addPyramidStep = (pyramidId: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === pyramidId) {
        const lastStep = ex.pyramid_steps?.[ex.pyramid_steps.length - 1];
        const safeLastReps = Number.isFinite(lastStep?.reps) && (lastStep?.reps || 0) > 0 ? (lastStep?.reps || 0) : PYRAMID_DEFAULT_REPS;
        const nextReps = safeLastReps + PYRAMID_DEFAULT_REPS_INCREMENT;
        const nextRest = Number.isFinite(lastStep?.rest_seconds) && (lastStep?.rest_seconds || 0) >= 0
          ? (lastStep?.rest_seconds || 0)
          : PYRAMID_DEFAULT_REST_SECONDS;
        const nextWeight = typeof lastStep?.weight_kg === 'number' && Number.isFinite(lastStep.weight_kg) && lastStep.weight_kg > 0
          ? lastStep.weight_kg
          : null;

        return {
          ...ex,
          pyramid_steps: [...(ex.pyramid_steps || []), { reps: nextReps, rest_seconds: nextRest, weight_kg: nextWeight }]
        };
      }
      return ex;
    }));
  };

  const removePyramidStep = (pyramidId: string, stepIndex: number) => {
    setExercises(exercises.map(ex => {
      if (ex.id === pyramidId && ex.pyramid_steps) {
        const remaining = ex.pyramid_steps.filter((_, idx) => idx !== stepIndex);

        // If only one pyramid step remains, revert to a normal reps exercise.
        if (remaining.length === 1) {
          const only = remaining[0];
          return {
            ...ex,
            type: 'reps',
            reps: Number.isFinite(only.reps) && only.reps > 0 ? only.reps : 10,
            rest_seconds: Number.isFinite(only.rest_seconds) && only.rest_seconds >= 0 ? only.rest_seconds : ex.rest_seconds,
            weight_kg: only.weight_kg ?? null,
            pyramid_steps: undefined,
          };
        }

        return { ...ex, pyramid_steps: remaining };
      }
      return ex;
    }));
  };

  const getDraftOrValue = (key: string, value: number, hideZero = false) => {
    if (Object.prototype.hasOwnProperty.call(numberDrafts, key)) return numberDrafts[key];
    if (hideZero && value === 0) return '';
    return Number.isFinite(value) ? String(value) : '';
  };

  const hasDraftValue = (key: string) => {
    return Object.prototype.hasOwnProperty.call(numberDrafts, key);
  };

  const onNumberFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const target = e.currentTarget;
    try {
      target.select();
    } catch {
      // ignore
    }

    const scrollSafely = () => {
      if (!target.isConnected) return;
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    };

    requestAnimationFrame(scrollSafely);
    window.setTimeout(scrollSafely, 280);
  };

  const setDraftValue = (key: string, value: string) => {
    setNumberDrafts(prev => ({ ...prev, [key]: value }));
  };

  const clearDraftValue = (key: string) => {
    setNumberDrafts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const formatWeightDisplay = (value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
    return String(value).replace('.', ',');
  };

  const getWeightDraftOrValue = (key: string, value?: number | null) => {
    if (hasDraftValue(key)) return numberDrafts[key];
    return formatWeightDisplay(value);
  };

  const parseWeightInput = (raw: string, fallback: number | null) => {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed <= 0) return null;
    return Math.round(parsed * 100) / 100;
  };

  const toDbWeight = (value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
  };

  const commitExerciseNumber = (
    id: string,
    field: keyof ExerciseDraft,
    key: string,
    defaultValue: number,
    min = 0,
    max?: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const currentExercise = exercises.find((exercise) => exercise.id === id);
    const currentRawValue = currentExercise?.[field];
    const currentValue = typeof currentRawValue === 'number' && Number.isFinite(currentRawValue)
      ? currentRawValue
      : defaultValue;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentValue;
    if (parsed < min) parsed = min;
    if (typeof max === 'number' && parsed > max) parsed = max;
    updateExercise(id, field, parsed);
    clearDraftValue(key);
  };

  const commitSubExerciseNumber = (
    supersetId: string,
    subIndex: number,
    field: 'reps' | 'duration_seconds',
    key: string,
    defaultValue: number,
    min = 0,
    max?: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const currentSubExercise = exercises.find((exercise) => exercise.id === supersetId)?.subExercises?.[subIndex];
    const currentRawValue = currentSubExercise?.[field];
    const currentValue = typeof currentRawValue === 'number' && Number.isFinite(currentRawValue)
      ? currentRawValue
      : defaultValue;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentValue;
    if (parsed < min) parsed = min;
    if (typeof max === 'number' && parsed > max) parsed = max;
    updateSubExercise(supersetId, subIndex, field, parsed);
    clearDraftValue(key);
  };

  const commitPyramidStepNumber = (
    pyramidId: string,
    stepIndex: number,
    field: 'reps' | 'rest_seconds',
    key: string,
    defaultValue: number,
    min = 0,
    max?: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const currentStep = exercises.find((exercise) => exercise.id === pyramidId)?.pyramid_steps?.[stepIndex];
    const currentRawValue = currentStep?.[field];
    const currentValue = typeof currentRawValue === 'number' && Number.isFinite(currentRawValue)
      ? currentRawValue
      : defaultValue;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentValue;
    if (parsed < min) parsed = min;
    if (typeof max === 'number' && parsed > max) parsed = max;
    updatePyramidStep(pyramidId, stepIndex, field, parsed);
    clearDraftValue(key);
  };

  const commitPyramidStepWeight = (
    pyramidId: string,
    stepIndex: number,
    key: string,
    currentWeight: number | null | undefined
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = numberDrafts[key] ?? '';
    if (!raw.trim()) {
      clearDraftValue(key);
      return;
    }

    const fallback = typeof currentWeight === 'number' && Number.isFinite(currentWeight) ? currentWeight : null;
    const parsed = parseWeightInput(raw, fallback);

    setExercises(exercises.map(ex => {
      if (ex.id === pyramidId && ex.pyramid_steps) {
        const nextSteps = [...ex.pyramid_steps];
        nextSteps[stepIndex] = { ...nextSteps[stepIndex], weight_kg: parsed };
        return { ...ex, pyramid_steps: nextSteps };
      }
      return ex;
    }));

    clearDraftValue(key);
  };

  const commitExerciseWeight = (
    id: string,
    key: string,
    currentWeight: number | null | undefined
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = numberDrafts[key] ?? '';
    if (!raw.trim()) {
      clearDraftValue(key);
      return;
    }

    const fallback = typeof currentWeight === 'number' && Number.isFinite(currentWeight) ? currentWeight : null;
    const parsed = parseWeightInput(raw, fallback);
    updateExercise(id, 'weight_kg', parsed);
    clearDraftValue(key);
  };

  const commitSubExerciseWeight = (
    containerId: string,
    subIndex: number,
    key: string,
    currentWeight: number | null | undefined
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = numberDrafts[key] ?? '';
    if (!raw.trim()) {
      clearDraftValue(key);
      return;
    }

    const fallback = typeof currentWeight === 'number' && Number.isFinite(currentWeight) ? currentWeight : null;
    const parsed = parseWeightInput(raw, fallback);
    updateSubExercise(containerId, subIndex, 'weight_kg', parsed);
    clearDraftValue(key);
  };

  const commitRestPart = (
    id: string,
    part: 'min' | 'sec',
    key: string,
    currentRestSeconds: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const safeCurrent = Number.isFinite(currentRestSeconds) ? currentRestSeconds : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const currentPartValue = part === 'min' ? minutes : seconds;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentPartValue;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;
    updateExercise(id, 'rest_seconds', next);
    clearDraftValue(key);
  };

  const commitDurationPart = (
    id: string,
    part: 'min' | 'sec',
    key: string,
    currentDurationSeconds: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const safeCurrent = Number.isFinite(currentDurationSeconds) ? currentDurationSeconds : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const currentPartValue = part === 'min' ? minutes : seconds;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentPartValue;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;
    updateExercise(id, 'duration_seconds', next);
    clearDraftValue(key);
  };

  const commitSubDurationPart = (
    exerciseId: string,
    subIndex: number,
    part: 'min' | 'sec',
    key: string,
    currentDurationSeconds: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const safeCurrent = Number.isFinite(currentDurationSeconds) ? currentDurationSeconds : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const currentPartValue = part === 'min' ? minutes : seconds;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentPartValue;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;
    updateSubExercise(exerciseId, subIndex, 'duration_seconds', next);
    clearDraftValue(key);
  };

  const commitTransitionRestPart = (
    id: string,
    part: 'min' | 'sec',
    key: string,
    currentTransitionRestSeconds: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const safeCurrent = Number.isFinite(currentTransitionRestSeconds)
      ? Math.max(0, Math.trunc(currentTransitionRestSeconds))
      : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const currentPartValue = part === 'min' ? minutes : seconds;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentPartValue;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;

    updateExercise(id, 'transition_rest_seconds', next);
    clearDraftValue(key);
  };

  const commitBothTransitionRestParts = (exId: string, currentTransitionRestSeconds: number) => {
    const minKey = `${exId}:transition_rest:min`;
    const secKey = `${exId}:transition_rest:sec`;
    const hasMin = hasDraftValue(minKey);
    const hasSec = hasDraftValue(secKey);

    if (!hasMin && !hasSec) {
      setEditingTransitionForExerciseId(null);
      return;
    }

    const safeCurrent = Number.isFinite(currentTransitionRestSeconds)
      ? Math.max(0, Math.trunc(currentTransitionRestSeconds))
      : 0;
    let minutes = Math.floor(safeCurrent / 60);
    let seconds = safeCurrent % 60;

    if (hasMin) {
      const rawMin = (numberDrafts[minKey] ?? '').trim();
      if (rawMin !== '') {
        const parsedMin = parseInt(rawMin, 10);
        if (Number.isFinite(parsedMin) && parsedMin >= 0) {
          minutes = parsedMin;
        }
      }
      clearDraftValue(minKey);
    }

    if (hasSec) {
      const rawSec = (numberDrafts[secKey] ?? '').trim();
      if (rawSec !== '') {
        const parsedSec = parseInt(rawSec, 10);
        if (Number.isFinite(parsedSec) && parsedSec >= 0) {
          seconds = Math.min(59, parsedSec);
        }
      }
      clearDraftValue(secKey);
    }

    const next = (minutes * 60) + seconds;
    updateExercise(exId, 'transition_rest_seconds', next);
    setEditingTransitionForExerciseId(null);
  };

  const formatTransitionRest = (totalSeconds?: number) => {
    const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.trunc(totalSeconds || 0)) : 0;
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const commitEmomRoundDurationPart = (
    id: string,
    part: 'min' | 'sec',
    key: string,
    currentRoundDurationSeconds: number
  ) => {
    if (!hasDraftValue(key)) return;

    const raw = (numberDrafts[key] ?? '').trim();
    const safeCurrent = Number.isFinite(currentRoundDurationSeconds) ? Math.max(1, currentRoundDurationSeconds) : 60;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const currentPartValue = part === 'min' ? minutes : seconds;

    if (raw === '') {
      clearDraftValue(key);
      return;
    }

    let parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = currentPartValue;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;

    updateExercise(id, 'emom_round_duration', Math.max(1, next));
    clearDraftValue(key);
  };

  const addSubExercise = (supersetId: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === supersetId && ex.subExercises) {
        return { ...ex, subExercises: [...ex.subExercises, { name: '', type: 'reps', reps: 10, duration_seconds: 0, weight_kg: null, instruction_note: '' }] };
      }
      return ex;
    }));
  };

  const removeSubExercise = (supersetId: string, subIndex: number) => {
    setExercises(exercises.map(ex => {
      if (ex.id === supersetId && ex.subExercises) {
        const remaining = ex.subExercises.filter((_, idx) => idx !== subIndex);

        if ((ex.type === 'superset' || ex.type === 'circuit') && remaining.length === 1) {
          const only = remaining[0];
          return {
            ...ex,
            type: only.type,
            name: only.name,
            instruction_note: only.instruction_note || '',
            reps: only.type === 'reps' ? only.reps : ex.reps,
            duration_seconds: only.type === 'isometry' ? only.duration_seconds : ex.duration_seconds,
            weight_kg: only.weight_kg ?? null,
            subExercises: undefined,
          };
        }

        return { ...ex, subExercises: remaining };
      }
      return ex;
    }));
  };

  // Esercizi state builder helper functions

  const normalizeExerciseName = (name: string) => name.replace(/@@@meta:.*$/, '').trim();

  const ensureExerciseDictionaryId = async (name: string) => {
    const normalized = normalizeExerciseName(name);
    const { data: existing, error: existingError } = await supabase
      .from('esercizi')
      .select('id_esercizio')
      .eq('nome', normalized)
      .order('id_esercizio', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing?.id_esercizio) return existing.id_esercizio;

    const { data: inserted, error: insertError } = await supabase
      .from('esercizi')
      .insert([{ nome: normalized }])
      .select('id_esercizio')
      .single();

    if (!insertError && inserted?.id_esercizio) return inserted.id_esercizio;

    // Handle concurrent inserts by re-reading the first matching row.
    const { data: afterRace, error: raceReadError } = await supabase
      .from('esercizi')
      .select('id_esercizio')
      .eq('nome', normalized)
      .order('id_esercizio', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (raceReadError || !afterRace?.id_esercizio) throw insertError || raceReadError;
    return afterRace.id_esercizio;
  };

  const getProfileMailValue = () => {
    const normalizedEmail = String(user?.email || '').trim().toLowerCase();
    if (normalizedEmail.length > 0) return normalizedEmail;
    return `${String(user?.id || 'user')}@noexcuses.local`;
  };

  const getProfileUsernameBase = (mailValue: string) => {
    const localPart = String(mailValue.split('@')[0] || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    const safe = localPart.length > 0 ? localPart : 'user';
    return safe.slice(0, 40);
  };

  const buildProfileUsernameCandidate = (base: string, attempt: number) => {
    if (attempt === 0) return base;
    const suffix = `_${Math.floor(Math.random() * 9000) + 1000}`;
    const safeBase = base.slice(0, Math.max(1, 50 - suffix.length));
    return `${safeBase}${suffix}`;
  };

  const ensureUserProfileExists = async () => {
    if (!user?.id) {
      throw new Error('User not authenticated.');
    }

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from('profili')
      .select('id_utente')
      .eq('id_utente', user.id)
      .maybeSingle();

    if (existingProfileError) throw existingProfileError;
    if (existingProfile?.id_utente) return;

    const mailValue = getProfileMailValue();
    const usernameBase = getProfileUsernameBase(mailValue);
    let lastInsertError: { code?: string; message?: string } | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const username = buildProfileUsernameCandidate(usernameBase, attempt);
      const { error: insertProfileError } = await supabase
        .from('profili')
        .insert([
          {
            id_utente: user.id,
            username,
            mail: mailValue,
            updated_at: new Date().toISOString(),
          },
        ]);

      if (!insertProfileError) {
        return;
      }

      lastInsertError = insertProfileError;
      const duplicateConflict = String(insertProfileError.code || '') === '23505'
        || /duplicate key|unique/i.test(String(insertProfileError.message || ''));

      if (!duplicateConflict) {
        throw insertProfileError;
      }
    }

    throw lastInsertError || new Error('Unable to initialize user profile.');
  };

  const saveWorkout = async () => {
    if (!workoutName.trim()) {
      setError('Enter a name for the workout');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise to the workout');
      return;
    }
    for (const ex of exercises) {
      if (ex.type === 'superset' || ex.type === 'circuit') {
        const blockLabel = ex.type === 'circuit' ? 'Circuit' : 'Superset';
        if (!ex.subExercises || ex.subExercises.length < 2) {
          setError(`${blockLabel}s must contain at least 2 exercises`); return;
        }
        for (const sub of ex.subExercises) {
          if (!sub.name.trim()) { setError(`All exercises in a ${blockLabel} must have a name`); return; }
        }
      } else if (ex.type === 'emom') {
        if (!ex.subExercises || ex.subExercises.length === 0) {
          setError('EMOM must contain at least 1 exercise'); return;
        }
        for (const sub of ex.subExercises) {
          if (!sub.name.trim()) { setError('All exercises in an EMOM must have a name'); return; }
        }
      } else if (ex.type === 'pyramid') {
        if (!ex.name.trim()) {
          setError('Pyramid exercise must have a name'); return;
        }
        if (!ex.pyramid_steps || ex.pyramid_steps.length === 0) {
          setError('Pyramid must contain at least 1 step'); return;
        }
        for (const step of ex.pyramid_steps) {
          if (!Number.isFinite(step.reps) || step.reps <= 0) {
            setError('Each pyramid step must have reps > 0'); return;
          }
        }
      } else {
        if (!ex.name.trim()) {
          setError('All exercises must have a name');
          return;
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      let workoutIdToUse = id;

      if (id) {
        const { error: updateError } = await supabase
          .from('schede')
          .update({ nome: workoutName })
          .eq('id_scheda', Number(id));
        if (updateError) throw updateError;

        const { error: deleteError } = await supabase
          .from('esecuzioni')
          .delete()
          .eq('id_scheda', Number(id));
        if (deleteError) throw deleteError;

      } else {
        await ensureUserProfileExists();

        const { data: workoutData, error: workoutError } = await supabase
          .from('schede')
          .insert([{ nome: workoutName, id_utente: user?.id }])
          .select('id_scheda')
          .single();

        if (workoutError) throw workoutError;
        workoutIdToUse = String(workoutData.id_scheda);
      }

      const rowsToInsert: any[] = [];
      let orderCounter = 1;

      for (let idx = 0; idx < exercises.length; idx += 1) {
        const ex = exercises[idx];
        const transitionRestToPersist =
          idx < exercises.length - 1 && (ex.transition_rest_seconds || 0) > 0
            ? Math.max(0, Math.trunc(ex.transition_rest_seconds || 0))
            : null;

        if (ex.type === 'superset' || ex.type === 'circuit') {
          const isCircuit = ex.type === 'circuit';
          const { data, error: supersetError } = await supabase
            .from('superset')
            .insert([{ round_totali: Math.max(1, ex.sets) }])
            .select('id_superset')
            .single();
          if (supersetError) throw supersetError;

          for (let subIdx = 0; subIdx < (ex.subExercises || []).length; subIdx += 1) {
            const sub = ex.subExercises![subIdx];
            const idEsercizio = await ensureExerciseDictionaryId(sub.name);
            const isIso = sub.type === 'isometry';

            let subNote = String(sub.instruction_note || '').trim();
            if (subIdx === 0 && isCircuit) {
              const metaPayload = { groupCategory: 'circuit', trackingMode: 'stopwatch' };
              subNote = subNote ? `${subNote} @@@meta:${JSON.stringify(metaPayload)}` : `@@@meta:${JSON.stringify(metaPayload)}`;
            }

            rowsToInsert.push({
              id_scheda: Number(workoutIdToUse),
              id_esercizio: idEsercizio,
              ordine: orderCounter,
              set_num: Math.max(1, ex.sets || 1),
              rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
              rest_tra_esercizi: transitionRestToPersist,
              peso_kg: toDbWeight(sub.weight_kg),
              note_esercizio: subNote || null,
              tipo: isIso ? 'ISOMETRIA' : 'REPS',
              reps: isIso ? null : Math.max(0, sub.reps ?? 0),
              durata_secondi: isIso ? Math.max(0, sub.duration_seconds ?? 0) : null,
              id_superset: data.id_superset,
              id_piramide: null,
              stepindex_piramide: null,
              id_emom: null,
              stepindex_emom: null,
            });

            orderCounter += 1;
          }

          continue;
        }

        if (ex.type === 'emom') {
          const { data, error: emomError } = await supabase
            .from('emom')
            .insert([{ round_totali: Math.max(1, ex.emom_rounds || 1), durata_round_secondi: Math.max(1, ex.emom_round_duration || 60) }])
            .select('id_emom')
            .single();
          if (emomError) throw emomError;

          for (let subIdx = 0; subIdx < (ex.subExercises || []).length; subIdx += 1) {
            const sub = ex.subExercises![subIdx];
            const idEsercizio = await ensureExerciseDictionaryId(sub.name);
            const isIso = sub.type === 'isometry';

            rowsToInsert.push({
              id_scheda: Number(workoutIdToUse),
              id_esercizio: idEsercizio,
              ordine: orderCounter,
              set_num: Math.max(1, ex.sets || 1),
              rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
              rest_tra_esercizi: transitionRestToPersist,
              peso_kg: toDbWeight(sub.weight_kg),
              note_esercizio: String(sub.instruction_note || '').trim() || null,
              tipo: isIso ? 'ISOMETRIA' : 'REPS',
              reps: isIso ? null : Math.max(0, sub.reps ?? 0),
              durata_secondi: isIso ? Math.max(0, sub.duration_seconds ?? 0) : null,
              id_superset: null,
              id_piramide: null,
              stepindex_piramide: null,
              id_emom: data.id_emom,
              stepindex_emom: subIdx + 1,
            });

            orderCounter += 1;
          }

          continue;
        }

        if (ex.type === 'pyramid') {
          const { data, error: piramideError } = await supabase
            .from('piramide')
            .insert([{}])
            .select('id_piramide')
            .single();
          if (piramideError) throw piramideError;

          for (let stepIdx = 0; stepIdx < (ex.pyramid_steps || []).length; stepIdx += 1) {
            const step = ex.pyramid_steps![stepIdx];
            const idEsercizio = await ensureExerciseDictionaryId(ex.name);

            const stepNote = String(step.instruction_note || '').trim();
            const exNote = String(ex.instruction_note || '').trim();
            const combinedNote = stepNote && exNote ? `${exNote} - ${stepNote}` : (stepNote || exNote);

            rowsToInsert.push({
              id_scheda: Number(workoutIdToUse),
              id_esercizio: idEsercizio,
              ordine: orderCounter,
              set_num: 1,
              rest_secondi: step.rest_seconds > 0 ? step.rest_seconds : null,
              rest_tra_esercizi: transitionRestToPersist,
              peso_kg: toDbWeight(step.weight_kg),
              note_esercizio: combinedNote || null,
              tipo: 'REPS',
              reps: Math.max(0, step.reps ?? 0),
              durata_secondi: null,
              id_superset: null,
              id_piramide: data.id_piramide,
              stepindex_piramide: stepIdx + 1,
              id_emom: null,
              stepindex_emom: null,
            });

            orderCounter += 1;
          }

          continue;
        }

        const idEsercizio = await ensureExerciseDictionaryId(ex.name);
        const isCardio = ex.type === 'cardio';
        const isIsometry = ex.type === 'isometry';
        const isDurationBased = isIsometry || isCardio;

        let noteToSave = String(ex.instruction_note || '').trim();
        const metaObj: Record<string, unknown> = {};
        if (ex.auto_count_type) {
          metaObj.autoCountType = ex.auto_count_type;
        }
        if (isCardio) {
          metaObj.exerciseType = 'cardio';
        }
        if (Object.keys(metaObj).length > 0) {
          noteToSave += (noteToSave ? ' ' : '') + `@@@meta:${JSON.stringify(metaObj)}`;
        }

        rowsToInsert.push({
          id_scheda: Number(workoutIdToUse),
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: Math.max(1, ex.sets || 1),
          rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(ex.weight_kg),
          note_esercizio: noteToSave || null,
          tipo: isDurationBased ? 'ISOMETRIA' : 'REPS',
          reps: isDurationBased ? null : Math.max(0, ex.reps ?? 0),
          durata_secondi: isDurationBased ? Math.max(0, ex.duration_seconds ?? 0) : null,
          id_superset: null,
          id_piramide: null,
          stepindex_piramide: null,
          id_emom: null,
          stepindex_emom: null,
        });

        orderCounter += 1;
      }

      const { error: exercisesError } = await supabase
        .from('esecuzioni')
        .insert(rowsToInsert);

      if (exercisesError) throw exercisesError;

      if (workoutIdToUse) {
        assignSchedaToFolder(workoutIdToUse, selectedFolderId, user?.id);
      }

      if (isCreateMode && user?.id) {
        preserveCreateDraftOnUnmountRef.current = false;
        suppressCreateDraftPersistenceRef.current = true;
        setCreateDraftResumeAllowed(user.id, false);
        clearCreateWorkoutDraft(user.id);
      }

      navigate('/gym-card', { state: { openFolderId: selectedFolderId } });

    } catch (err: any) {
      setError(err.message || 'Error occurred while saving');
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromCreate = () => {
    if (isCreateMode && user?.id) {
      preserveCreateDraftOnUnmountRef.current = false;
      suppressCreateDraftPersistenceRef.current = true;
      setCreateDraftResumeAllowed(user.id, false);
      if (createDraftPersistTimeoutRef.current) {
        clearTimeout(createDraftPersistTimeoutRef.current);
        createDraftPersistTimeoutRef.current = null;
      }
      clearCreateWorkoutDraft(user.id);
    }

    navigate('/gym-card');
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24">
      <AppHeader
        title={id ? 'Edit Workout' : 'New Workout'}
        onBack={handleBackFromCreate}
      />

      <main className="flex-1 p-6 flex flex-col max-w-lg mx-auto w-full animate-sheet-enter">
        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        <div className="mb-8">
          <label className="block text-brand-grey font-semibold mb-2 ml-1">Workout Name</label>
          <input
            type="text"
            placeholder="E.g. Chest and Biceps"
            value={workoutName}
            onChange={(e) => setWorkoutName(e.target.value)}
            className="w-full bg-brand-darkGrey/40 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors text-lg shadow-inner shadow-black/50"
          />
        </div>

        {/* Selezione Cartella */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2 ml-1">
            <label className="text-brand-grey font-semibold text-sm flex items-center gap-1.5">
              <Folder size={16} className="text-brand-orange" />
              Cartella
            </label>
            <button
              type="button"
              onClick={() => setIsNewFolderModalOpen(true)}
              className="text-xs font-semibold text-brand-orange hover:text-orange-400 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Plus size={14} /> Nuova Cartella
            </button>
          </div>
          <div className="relative">
            <select
              value={selectedFolderId || ''}
              onChange={(e) => setSelectedFolderId(e.target.value || null)}
              className="w-full bg-brand-darkGrey/40 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors text-sm appearance-none cursor-pointer"
            >
              <option value="" className="bg-[#1e1e1e] text-zinc-300">
                📁 Nessuna cartella (Principale)
              </option>
              {availableFolders.map((f) => (
                <option key={f.id} value={f.id} className="bg-[#1e1e1e] text-white">
                  📁 {f.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400">
              <Folder size={16} />
            </div>
          </div>
          {selectedFolderId && (
            <p className="text-xs text-zinc-400 mt-1.5 ml-1">
              Questa scheda verrà salvata all'interno della cartella:{' '}
              <span className="text-brand-orange font-medium">
                {availableFolders.find((f) => f.id === selectedFolderId)?.name || 'Cartella'}
              </span>
            </p>
          )}
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-brand-grey font-semibold ml-1 flex items-center">
              <Move size={16} className="mr-2 opacity-50" />
              Exercises
            </h2>
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange text-xs font-bold transition-all border border-brand-orange/30 shadow-sm active:scale-95 cursor-pointer"
              title="Importa da foto OCR o dettatura vocale"
            >
              <Camera size={14} />
              <span className="opacity-40">/</span>
              <Mic size={14} />
              <span>Importa Foto / Voce</span>
            </button>
          </div>

          <WorkoutBulkToolbar
            exercises={exercises}
            onApplyGlobalRest={handleApplyGlobalRest}
            onApplyGlobalSets={handleApplyGlobalSets}
          />

          {exercises.length === 0 ? (
            <div
              onClick={addExercise}
              className="text-center p-8 bg-brand-darkGrey/20 hover:bg-brand-darkGrey/30 active:bg-brand-darkGrey/40 rounded-3xl border border-dashed border-brand-orange/30 cursor-pointer active:scale-[0.99] transition-all flex flex-col items-center justify-center gap-2 group select-none touch-manipulation"
            >
              <div className="w-12 h-12 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center text-brand-orange group-hover:scale-110 transition-transform">
                <Plus size={24} />
              </div>
              <p className="text-zinc-200 font-bold text-sm">Nessun esercizio presente</p>
              <p className="text-xs text-brand-grey">Tocca qui o premi il pulsante sotto per inserire un esercizio</p>
            </div>
          ) : (
            exercises.map((ex, index) => (
              <React.Fragment key={ex.id}>
                <div
                  ref={(node) => {
                    exerciseRefs.current[ex.id] = node;
                  }}
                  className={`bg-brand-darkGrey/40 border p-4 rounded-3xl flex flex-col space-y-4 relative shadow-lg transition-colors ${focusedExerciseId === ex.id ? 'border-brand-orange/70 ring-2 ring-brand-orange/30' : 'border-brand-grey/20'
                    }`}
                >

                  {/* Header Esercizio: Frecce Ordine, Selettore Tipo Compatto, Duplica ed Elimina */}
                  <div className="flex justify-between items-center bg-black/40 -mx-4 -mt-4 p-3 rounded-t-3xl border-b border-white/5">
                    {/* Left: Move buttons & index */}
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[11px] font-black text-white/90 bg-white/10 px-2 py-0.5 rounded-md">
                        #{index + 1}
                      </span>
                      <div className="flex space-x-0.5">
                        <button
                          type="button"
                          onClick={() => moveExercise(index, 'up')}
                          disabled={index === 0}
                          className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded disabled:opacity-20 transition-colors"
                          title="Sposta su"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveExercise(index, 'down')}
                          disabled={index === exercises.length - 1}
                          className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded disabled:opacity-20 transition-colors"
                          title="Sposta giù"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Center: Compact Type Selector Button & Dropdown Popover */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenTypeMenuExerciseId((prev) => (prev === ex.id ? null : ex.id))
                        }
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all border ${ex.type === 'cardio'
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-400 hover:bg-rose-500/25'
                          : ex.type === 'emom'
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25'
                            : ex.type === 'pyramid'
                              ? 'bg-purple-500/15 border-purple-500/40 text-purple-300 hover:bg-purple-500/25'
                              : ex.type === 'circuit'
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25'
                                : ex.type === 'superset'
                                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/25'
                                  : 'bg-brand-orange/15 border-brand-orange/40 text-brand-orange hover:bg-brand-orange/25'
                          }`}
                        title="Cambia tipo esercizio"
                      >
                        {ex.type === 'cardio' && <Activity size={13} className="shrink-0" />}
                        {ex.type === 'emom' && <Timer size={13} className="shrink-0" />}
                        {ex.type === 'pyramid' && <TrendingUp size={13} className="shrink-0" />}
                        {ex.type === 'circuit' && <RotateCcw size={13} className="shrink-0" />}
                        {ex.type === 'superset' && <Layers size={13} className="shrink-0" />}
                        {(ex.type === 'reps' || ex.type === 'isometry') && (
                          <Dumbbell size={13} className="shrink-0" />
                        )}
                        <span className="capitalize">
                          {ex.type === 'reps'
                            ? 'Normale'
                            : ex.type === 'isometry'
                              ? 'Isometria'
                              : ex.type === 'cardio'
                                ? 'Cardio'
                                : ex.type === 'emom'
                                  ? 'EMOM'
                                  : ex.type === 'pyramid'
                                    ? 'Piramide'
                                    : ex.type === 'circuit'
                                      ? 'Circuito'
                                      : 'Superset'}
                        </span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${openTypeMenuExerciseId === ex.id ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Dropdown Popover */}
                      {openTypeMenuExerciseId === ex.id && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setOpenTypeMenuExerciseId(null)}
                          />
                          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 bg-[#161618] border border-white/15 rounded-2xl shadow-2xl p-1.5 z-50 divide-y divide-white/5 backdrop-blur-xl animate-scale-in">
                            <div className="px-2.5 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                              Tipo di Esercizio
                            </div>
                            <div className="py-1 space-y-0.5">
                              {[
                                {
                                  id: 'normal',
                                  label: 'Normale (Reps / Iso)',
                                  desc: 'Serie x Ripetizioni o Tempo',
                                  icon: Dumbbell,
                                  color: 'text-brand-orange',
                                  isActive: ex.type === 'reps' || ex.type === 'isometry',
                                },
                                {
                                  id: 'cardio',
                                  label: 'Cardio',
                                  desc: 'Corsa, cyclette, corda a tempo',
                                  icon: Activity,
                                  color: 'text-rose-400',
                                  isActive: ex.type === 'cardio',
                                },
                                {
                                  id: 'emom',
                                  label: 'EMOM',
                                  desc: 'Minuti & round con countdown',
                                  icon: Timer,
                                  color: 'text-amber-400',
                                  isActive: ex.type === 'emom',
                                },
                                {
                                  id: 'pyramid',
                                  label: 'Piramide',
                                  desc: 'Step incrementali / scalari',
                                  icon: TrendingUp,
                                  color: 'text-purple-400',
                                  isActive: ex.type === 'pyramid',
                                },
                                {
                                  id: 'circuit',
                                  label: 'Circuito a Tempo',
                                  desc: 'Stazioni continue + recupero',
                                  icon: RotateCcw,
                                  color: 'text-emerald-400',
                                  isActive: ex.type === 'circuit',
                                },
                                {
                                  id: 'superset',
                                  label: 'Superset',
                                  desc: '2 o più esercizi in sequenza',
                                  icon: Layers,
                                  color: 'text-cyan-400',
                                  isActive: ex.type === 'superset',
                                },
                              ].map((option) => {
                                const IconComponent = option.icon;
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() =>
                                      handleTypeChange(
                                        ex.id,
                                        option.id as 'normal' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid'
                                      )
                                    }
                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-colors ${option.isActive
                                      ? 'bg-white/10 text-white font-bold'
                                      : 'hover:bg-white/5 text-zinc-300'
                                      }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={`w-6 h-6 rounded-lg bg-black/40 flex items-center justify-center ${option.color}`}
                                      >
                                        <IconComponent size={14} />
                                      </div>
                                      <div>
                                        <div className="text-xs font-semibold">{option.label}</div>
                                        <div className="text-[10px] text-zinc-400 leading-none">
                                          {option.desc}
                                        </div>
                                      </div>
                                    </div>
                                    {option.isActive && (
                                      <Check size={14} className="text-brand-orange" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Right: Duplicate & Delete */}
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => duplicateExercise(index)}
                        className="p-1.5 text-zinc-400 hover:text-brand-orange hover:bg-brand-orange/10 rounded-md transition-colors"
                        title="Duplica esercizio"
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeExercise(ex.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                        title="Elimina esercizio"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {ex.type === 'emom' ? (
                    <div className="space-y-3 bg-black/25 p-3.5 rounded-2xl border border-amber-500/20">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Timer size={14} /> Round EMOM
                        </span>
                        <span className="text-[11px] text-zinc-400">
                          {(ex.emom_rounds || 10) * Math.ceil((ex.emom_round_duration || 60) / 60)} min totali
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                          <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                            Giri / Round Totali
                          </label>
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => adjustExerciseNumber(ex.id, 'emom_rounds', -1)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                            >
                              <Minus size={13} />
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={getDraftOrValue(`${ex.id}:emom_rounds`, ex.emom_rounds || 1)}
                              onChange={(e) => setDraftValue(`${ex.id}:emom_rounds`, e.target.value)}
                              onBlur={() => commitExerciseNumber(ex.id, 'emom_rounds', `${ex.id}:emom_rounds`, 1, 1)}
                              onFocus={onNumberFocus}
                              className="w-14 text-center font-bold text-white bg-transparent focus:outline-none text-base"
                            />
                            <button
                              type="button"
                              onClick={() => adjustExerciseNumber(ex.id, 'emom_rounds', 1)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                          <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                            Tempo Singolo Round
                          </label>
                          <div className="flex items-center h-7 gap-1">
                            <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                value={getDraftOrValue(`${ex.id}:emom_round_duration:min`, Math.floor((ex.emom_round_duration || 60) / 60))}
                                onChange={(e) => setDraftValue(`${ex.id}:emom_round_duration:min`, e.target.value)}
                                onBlur={() => commitEmomRoundDurationPart(ex.id, 'min', `${ex.id}:emom_round_duration:min`, ex.emom_round_duration || 60)}
                                onFocus={onNumberFocus}
                                className="w-full text-center font-bold text-white bg-transparent focus:outline-none text-sm"
                              />
                              <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">MIN</span>
                            </div>
                            <span className="text-zinc-500 font-bold">:</span>
                            <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                max="59"
                                value={getDraftOrValue(`${ex.id}:emom_round_duration:sec`, (ex.emom_round_duration || 60) % 60)}
                                onChange={(e) => setDraftValue(`${ex.id}:emom_round_duration:sec`, e.target.value)}
                                onBlur={() => commitEmomRoundDurationPart(ex.id, 'sec', `${ex.id}:emom_round_duration:sec`, ex.emom_round_duration || 60)}
                                onFocus={onNumberFocus}
                                className="w-full text-center font-bold text-white bg-transparent focus:outline-none text-sm"
                              />
                              <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">SEC</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block px-1">
                          Esercizi nel round
                        </span>

                        {ex.subExercises?.map((sub, sIdx) => (
                          <div key={sIdx} className="bg-black/40 border border-white/5 rounded-xl p-3 space-y-2 relative">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1">
                                <span className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-400 text-[10px] font-black flex items-center justify-center shrink-0">
                                  {sIdx + 1}
                                </span>
                                <input
                                  type="text"
                                  placeholder={`Nome esercizio ${sIdx + 1}`}
                                  value={sub.name}
                                  onChange={(e) => updateSubExercise(ex.id, sIdx, 'name', e.target.value)}
                                  className="w-full bg-transparent text-white text-sm font-semibold focus:outline-none placeholder:text-zinc-600"
                                />
                              </div>
                              {ex.subExercises && ex.subExercises.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeSubExercise(ex.id, sIdx)}
                                  className="text-zinc-500 hover:text-red-400 p-1 transition-colors"
                                  title="Rimuovi"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                              <div>
                                <label className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block mb-1">
                                  Target Reps / Sec
                                </label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={getDraftOrValue(`${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? sub.reps : sub.duration_seconds, true)}
                                  onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:${sub.type}`, e.target.value)}
                                  onBlur={() => commitSubExerciseNumber(ex.id, sIdx, sub.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:sub:${sIdx}:${sub.type}`, 0, 0)}
                                  onFocus={onNumberFocus}
                                  className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-center text-sm font-bold text-white focus:border-amber-400 outline-none"
                                  placeholder={sub.type === 'reps' ? 'MAX REPS' : 'MAX TIME'}
                                />
                              </div>

                              <div>
                                <label className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block mb-1">
                                  Carico (kg)
                                </label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={getWeightDraftOrValue(`${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                                  onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:weight`, e.target.value)}
                                  onBlur={() => commitSubExerciseWeight(ex.id, sIdx, `${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                                  onFocus={onNumberFocus}
                                  placeholder="Corpo libero"
                                  className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-center text-sm font-bold text-white focus:border-amber-400 outline-none placeholder:text-zinc-600 placeholder:text-xs"
                                />
                              </div>
                            </div>

                            <div>
                              <input
                                type="text"
                                value={sub.instruction_note || ''}
                                onChange={(e) => updateSubExercise(ex.id, sIdx, 'instruction_note', e.target.value)}
                                placeholder="Note esecuzione (opzionale)..."
                                className="w-full bg-black/20 border border-white/5 rounded-lg px-2.5 py-1 text-xs text-zinc-300 focus:border-amber-400 outline-none placeholder:text-zinc-600 transition-colors"
                              />
                            </div>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => addSubExercise(ex.id)}
                          className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/15 border border-dashed border-amber-500/30 text-amber-400 text-xs font-bold rounded-xl transition-colors flex justify-center items-center gap-1"
                        >
                          <Plus size={14} /> AGGIUNGI ESERCIZIO AL ROUND
                        </button>
                      </div>
                    </div>
                  ) : (ex.type === 'superset' || ex.type === 'circuit') ? (
                    <div className={`space-y-3 p-3.5 rounded-2xl border ${ex.type === 'circuit'
                      ? 'bg-emerald-950/20 border-emerald-500/25'
                      : 'bg-cyan-950/20 border-cyan-500/25'
                      }`}>
                      <div className="flex items-center justify-between px-1">
                        <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${ex.type === 'circuit' ? 'text-emerald-400' : 'text-cyan-400'
                          }`}>
                          {ex.type === 'circuit' ? <RotateCcw size={14} /> : <Layers size={14} />}
                          {ex.type === 'circuit' ? 'Circuito a Stazioni' : 'Superset Sequenziale'}
                        </span>
                        <span className="text-[11px] text-zinc-400 font-medium">
                          {ex.subExercises?.length || 0} stazioni
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {ex.subExercises?.map((sub, sIdx) => {
                          const isIso = sub.type === 'isometry';

                          return (
                            <div key={sIdx} className="bg-black/40 border border-white/5 rounded-xl p-3 space-y-2.5 relative">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1">
                                  <span className={`w-6 h-6 rounded-md text-[11px] font-black flex items-center justify-center shrink-0 ${ex.type === 'circuit'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-cyan-500/20 text-cyan-400'
                                    }`}>
                                    {ex.type === 'circuit' ? `${sIdx + 1}` : `A${sIdx + 1}`}
                                  </span>
                                  <input
                                    type="text"
                                    placeholder={ex.type === 'circuit' ? `Nome stazione ${sIdx + 1}` : `Esercizio ${sIdx + 1}`}
                                    value={sub.name}
                                    onChange={(e) => updateSubExercise(ex.id, sIdx, 'name', e.target.value)}
                                    className="w-full bg-transparent text-white text-sm font-semibold focus:outline-none placeholder:text-zinc-600"
                                  />
                                </div>

                                {ex.subExercises && ex.subExercises.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeSubExercise(ex.id, sIdx)}
                                    className="text-zinc-500 hover:text-red-400 p-1 transition-colors shrink-0"
                                    title="Rimuovi"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>

                              {/* Modalità Esercizio: Reps vs Isometria (Full Width) sotto il nome */}
                              <div className="w-full bg-black/60 rounded-xl p-1 border border-white/10 grid grid-cols-2 gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void hapticLight();
                                    updateSubExercise(ex.id, sIdx, 'type', 'reps');
                                  }}
                                  className={`w-full py-1.5 text-xs font-black rounded-lg transition-all text-center ${!isIso
                                    ? 'bg-brand-orange text-black shadow-md'
                                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                    }`}
                                >
                                  REPS
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void hapticLight();
                                    updateSubExercise(ex.id, sIdx, 'type', 'isometry');
                                  }}
                                  className={`w-full py-1.5 text-xs font-black rounded-lg transition-all text-center ${isIso
                                    ? 'bg-brand-orange text-black shadow-md'
                                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                    }`}
                                >
                                  ISOMETRIA
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                                <div>
                                  <label className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                                    {!isIso ? (
                                      'Reps Target'
                                    ) : (
                                      <>
                                        <Clock size={10} /> Durata
                                      </>
                                    )}
                                  </label>
                                  {!isIso ? (
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={getDraftOrValue(`${ex.id}:sub:${sIdx}:reps`, sub.reps, true)}
                                      onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:reps`, e.target.value)}
                                      onBlur={() => commitSubExerciseNumber(ex.id, sIdx, 'reps', `${ex.id}:sub:${sIdx}:reps`, 0, 0)}
                                      onFocus={onNumberFocus}
                                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-center text-sm font-bold text-white focus:border-brand-orange outline-none"
                                      placeholder="MAX REPS"
                                    />
                                  ) : (
                                    <div className="flex items-center h-[34px] gap-1">
                                      <div className="relative flex-1 h-full bg-black/30 border border-white/10 rounded-lg flex items-center">
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min="0"
                                          value={getDraftOrValue(`${ex.id}:sub:${sIdx}:duration:min`, Math.floor((sub.duration_seconds || 0) / 60))}
                                          onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:duration:min`, e.target.value)}
                                          onBlur={() => commitSubDurationPart(ex.id, sIdx, 'min', `${ex.id}:sub:${sIdx}:duration:min`, sub.duration_seconds || 0)}
                                          onFocus={onNumberFocus}
                                          placeholder="0"
                                          className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                                        />
                                        <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">M</span>
                                      </div>
                                      <span className="text-zinc-500 font-bold">:</span>
                                      <div className="relative flex-1 h-full bg-black/30 border border-white/10 rounded-lg flex items-center">
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min="0"
                                          max="59"
                                          value={getDraftOrValue(`${ex.id}:sub:${sIdx}:duration:sec`, (sub.duration_seconds || 0) % 60)}
                                          onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:duration:sec`, e.target.value)}
                                          onBlur={() => commitSubDurationPart(ex.id, sIdx, 'sec', `${ex.id}:sub:${sIdx}:duration:sec`, sub.duration_seconds || 0)}
                                          onFocus={onNumberFocus}
                                          placeholder="0"
                                          className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                                        />
                                        <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">S</span>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <label className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block mb-1">
                                    Carico (kg)
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={getWeightDraftOrValue(`${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                                    onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:weight`, e.target.value)}
                                    onBlur={() => commitSubExerciseWeight(ex.id, sIdx, `${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                                    onFocus={onNumberFocus}
                                    placeholder="Corpo libero"
                                    className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-center text-sm font-bold text-white focus:border-brand-orange outline-none placeholder:text-zinc-600 placeholder:text-xs"
                                  />
                                </div>
                              </div>

                              <div>
                                <input
                                  type="text"
                                  value={sub.instruction_note || ''}
                                  onChange={(e) => updateSubExercise(ex.id, sIdx, 'instruction_note', e.target.value)}
                                  placeholder="Note esecuzione (opzionale)..."
                                  className="w-full bg-black/20 border border-white/5 rounded-lg px-2.5 py-1 text-xs text-zinc-300 focus:border-brand-orange outline-none placeholder:text-zinc-600 transition-colors"
                                />
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => addSubExercise(ex.id)}
                          className={`w-full py-2 border border-dashed text-xs font-bold rounded-xl transition-colors flex justify-center items-center gap-1 ${ex.type === 'circuit'
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            : 'bg-cyan-500/10 hover:bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
                            }`}
                        >
                          <Plus size={14} /> {ex.type === 'circuit' ? 'AGGIUNGI STAZIONE' : 'AGGIUNGI ESERCIZIO AL SUPERSET'}
                        </button>
                      </div>
                    </div>
                  ) : ex.type === 'pyramid' ? (
                    <div className="space-y-3 bg-purple-950/20 p-3.5 rounded-2xl border border-purple-500/25">
                      <div className="flex items-center justify-between pb-1 border-b border-purple-500/20">
                        <div className="flex items-center space-x-2">
                          <p className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                            <TrendingUp size={14} /> Piramidale
                          </p>
                          <span className="text-[11px] text-zinc-400 font-medium">
                            ({ex.pyramid_steps?.length || 0} step)
                          </span>
                        </div>
                      </div>

                      {/* Banner notifica autofill o parse */}
                      {exerciseNotices[ex.id] && (
                        <div className="bg-brand-orange/15 border border-brand-orange/30 text-brand-orange text-xs px-3 py-1.5 rounded-xl flex items-center justify-between animate-fade-in">
                          <div className="flex items-center space-x-1.5">
                            <Sparkles size={14} />
                            <span className="font-semibold">{exerciseNotices[ex.id]}</span>
                          </div>
                          <Check size={14} />
                        </div>
                      )}

                      {/* Nome esercizio Piramidale con Autocomplete e Parser Inline */}
                      <div className="relative">
                        <div className="relative flex items-center">
                          <input
                            type="text"
                            placeholder="Nome esercizio (es. Panca Piana, o formula 12-10-8-6 90s)"
                            value={ex.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateExercise(ex.id, 'name', val);
                              if (val.trim().length >= 2) {
                                const found = searchHistory(val.trim());
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: found }));
                              } else {
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                              }, 200);
                              if (ex.name.trim()) {
                                const parsed = parseExerciseInput(ex.name, ex.rest_seconds || 60);
                                if (parsed.matched) {
                                  handleApplyParsedToExercise(ex.id, parsed);
                                  setExerciseNotices(prev => ({
                                    ...prev,
                                    [ex.id]: parsed.type === 'pyramid'
                                      ? `✨ Piramide: ${parsed.pyramid_steps?.map(s => s.reps).join('-')} • ${parsed.pyramid_steps?.[0]?.rest_seconds ?? 60}s recupero`
                                      : parsed.type === 'reps'
                                        ? `✨ Riconosciuto: ${parsed.sets}x${parsed.isMaxReps ? 'Max' : parsed.reps}${parsed.weight_kg ? ` • ${parsed.weight_kg}kg` : ''} • ${parsed.rest_seconds}s`
                                        : `✨ Trasformato in ${parsed.type.toUpperCase()}`
                                  }));
                                  setTimeout(() => {
                                    setExerciseNotices(prev => {
                                      const n = { ...prev };
                                      delete n[ex.id];
                                      return n;
                                    });
                                  }, 3500);
                                }
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (ex.name.trim()) {
                                  const parsed = parseExerciseInput(ex.name, ex.rest_seconds || 60);
                                  if (parsed.matched) {
                                    handleApplyParsedToExercise(ex.id, parsed);
                                    setExerciseNotices(prev => ({
                                      ...prev,
                                      [ex.id]: parsed.type === 'pyramid'
                                        ? `✨ Piramide: ${parsed.pyramid_steps?.map(s => s.reps).join('-')} • ${parsed.pyramid_steps?.[0]?.rest_seconds ?? 60}s recupero`
                                        : parsed.type === 'reps'
                                          ? `✨ Riconosciuto: ${parsed.sets}x${parsed.isMaxReps ? 'Max' : parsed.reps}${parsed.weight_kg ? ` • ${parsed.weight_kg}kg` : ''} • ${parsed.rest_seconds}s`
                                          : `✨ Trasformato in ${parsed.type.toUpperCase()}`
                                    }));
                                    setTimeout(() => {
                                      setExerciseNotices(prev => {
                                        const n = { ...prev };
                                        delete n[ex.id];
                                        return n;
                                      });
                                    }, 3500);
                                  }
                                }
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                                (e.target as HTMLElement).blur();
                              }
                            }}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-white font-medium text-sm focus:border-purple-400 focus:outline-none transition-colors pr-10"
                          />
                          {(exerciseSuggestions[ex.id] || []).length > 0 && (
                            <span className="absolute right-3 text-purple-400/70 pointer-events-none" title="Suggerimenti disponibili">
                              <History size={16} />
                            </span>
                          )}
                        </div>

                        {/* Dropdown Suggerimenti Autocomplete */}
                        {(exerciseSuggestions[ex.id] || []).length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#181818] border border-purple-500/30 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-white/5 backdrop-blur-md">
                            <div className="p-2 bg-black/40 text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center">
                              <History size={11} className="mr-1.5 text-purple-400" />
                              Usato nelle tue sessioni precedenti
                            </div>
                            {(exerciseSuggestions[ex.id] || []).map((item, sIdx) => (
                              <button
                                key={sIdx}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleApplyHistoryItemToExercise(ex.id, item);
                                  setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                                  setExerciseNotices(prev => ({
                                    ...prev,
                                    [ex.id]: item.pyramid_steps && item.pyramid_steps.length > 0
                                      ? `Memoria utente: Piramide ${item.pyramid_steps.map(s => s.reps).join('-')}`
                                      : `Memoria utente: ${item.name}`
                                  }));
                                  setTimeout(() => {
                                    setExerciseNotices(prev => {
                                      const n = { ...prev };
                                      delete n[ex.id];
                                      return n;
                                    });
                                  }, 3500);
                                }}
                                className="w-full text-left p-3 hover:bg-purple-500/15 transition-colors flex items-center justify-between group"
                              >
                                <div>
                                  <div className="text-sm font-semibold text-white group-hover:text-purple-400 transition-colors">
                                    {item.name}
                                  </div>
                                  <div className="text-xs text-zinc-400 mt-0.5">
                                    {item.pyramid_steps && item.pyramid_steps.length > 0
                                      ? `Piramide ${item.pyramid_steps.map(s => s.reps).join('-')} reps`
                                      : `${item.sets} serie × ${item.reps} reps • ${item.rest_seconds}s recupero`}
                                    {item.weight_kg != null ? ` • ${item.weight_kg} kg` : ''}
                                  </div>
                                </div>
                                <span className="text-[11px] font-bold text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                                  Applica <Check size={12} className="ml-1" />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Note dell'intero esercizio (direttamente visibile) */}
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                          <FileText size={13} />
                        </div>
                        <input
                          type="text"
                          value={ex.instruction_note || ''}
                          onChange={(e) => updateExercise(ex.id, 'instruction_note', e.target.value)}
                          placeholder="Note tecniche o istruzioni per questa piramide (opzionale)..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-white text-xs placeholder:text-zinc-500 focus:border-purple-400 focus:outline-none transition-colors"
                        />
                      </div>

                      {/* Step della sequenza piramidale */}
                      <div className="space-y-2 pt-1">
                        <div className="grid grid-cols-12 gap-1.5 px-2 text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                          <span className="col-span-2">Step</span>
                          <span className="col-span-3 text-center">Reps</span>
                          <span className="col-span-3 text-center">Kg</span>
                          <span className="col-span-3 text-center">Rest</span>
                          <span className="col-span-1"></span>
                        </div>

                        {ex.pyramid_steps?.map((step, sIdx) => (
                          <div key={sIdx} className="bg-black/40 border border-white/5 rounded-xl p-2 space-y-1.5 transition-colors hover:border-purple-500/20">
                            <div className="grid grid-cols-12 gap-1.5 items-center">
                              <span className="col-span-2 text-xs font-black text-purple-400 pl-1">
                                #{sIdx + 1}
                              </span>

                              <div className="col-span-3">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min="1"
                                  value={getDraftOrValue(`${ex.id}:step:${sIdx}:reps`, step.reps)}
                                  onChange={(e) => setDraftValue(`${ex.id}:step:${sIdx}:reps`, e.target.value)}
                                  onBlur={() => commitPyramidStepNumber(ex.id, sIdx, 'reps', `${ex.id}:step:${sIdx}:reps`, 10, 1)}
                                  onFocus={onNumberFocus}
                                  placeholder="10"
                                  className="w-full bg-black/50 border border-white/10 rounded-lg py-1.5 text-white text-center text-xs font-bold focus:border-purple-400 outline-none"
                                />
                              </div>

                              <div className="col-span-3">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={getWeightDraftOrValue(`${ex.id}:step:${sIdx}:weight`, step.weight_kg)}
                                  onChange={(e) => setDraftValue(`${ex.id}:step:${sIdx}:weight`, e.target.value)}
                                  onBlur={() => commitPyramidStepWeight(ex.id, sIdx, `${ex.id}:step:${sIdx}:weight`, step.weight_kg)}
                                  onFocus={onNumberFocus}
                                  placeholder="kg"
                                  className="w-full bg-black/50 border border-white/10 rounded-lg py-1.5 text-white text-center text-xs font-bold focus:border-purple-400 outline-none"
                                />
                              </div>

                              <div className="col-span-3">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  value={getDraftOrValue(`${ex.id}:step:${sIdx}:rest`, step.rest_seconds)}
                                  onChange={(e) => setDraftValue(`${ex.id}:step:${sIdx}:rest`, e.target.value)}
                                  onBlur={() => commitPyramidStepNumber(ex.id, sIdx, 'rest_seconds', `${ex.id}:step:${sIdx}:rest`, 60, 0)}
                                  onFocus={onNumberFocus}
                                  placeholder="60s"
                                  className="w-full bg-black/50 border border-white/10 rounded-lg py-1.5 text-white text-center text-xs font-bold focus:border-purple-400 outline-none"
                                />
                              </div>

                              <div className="col-span-1 flex justify-center">
                                {ex.pyramid_steps && ex.pyramid_steps.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removePyramidStep(ex.id, sIdx)}
                                    className="text-zinc-500 hover:text-red-400 p-1 transition-colors"
                                    title="Rimuovi step"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Micro-note per step */}
                            <input
                              type="text"
                              placeholder="Note step (opzionale, es. drop set, scalare peso)..."
                              value={step.instruction_note || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setExercises(exercises.map(item => {
                                  if (item.id === ex.id && item.pyramid_steps) {
                                    const nextSteps = [...item.pyramid_steps];
                                    nextSteps[sIdx] = { ...nextSteps[sIdx], instruction_note: val };
                                    return { ...item, pyramid_steps: nextSteps };
                                  }
                                  return item;
                                }));
                              }}
                              className="w-full bg-black/30 border border-white/5 rounded-lg px-2 py-1 text-zinc-300 text-[11px] focus:border-purple-400 outline-none placeholder:text-zinc-600 transition-colors"
                            />
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => addPyramidStep(ex.id)}
                          className="w-full py-2 border border-dashed border-purple-500/30 text-purple-300 hover:text-purple-200 hover:border-purple-500/60 text-xs font-bold rounded-xl transition-colors flex justify-center items-center gap-1.5 bg-purple-500/10"
                        >
                          <Plus size={14} /> AGGIUNGI STEP PIRAMIDE
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Banner notifica autofill o parse */}
                      {exerciseNotices[ex.id] && (
                        <div className="bg-brand-orange/15 border border-brand-orange/30 text-brand-orange text-xs px-3 py-1.5 rounded-xl flex items-center justify-between animate-fade-in">
                          <div className="flex items-center space-x-1.5">
                            <Sparkles size={14} />
                            <span className="font-semibold">{exerciseNotices[ex.id]}</span>
                          </div>
                          <Check size={14} />
                        </div>
                      )}

                      {/* Esercizio Singolo: Nome con Autocomplete e Smart String Parser */}
                      <div className="relative">
                        <div className="relative flex items-center">
                          <input
                            type="text"
                            placeholder="Nome esercizio (es. Panca Piana 4x8 90s, Squat 100kg...)"
                            value={ex.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              updateExercise(ex.id, 'name', val);
                              if (val.trim().length >= 2) {
                                const found = searchHistory(val.trim());
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: found }));
                              } else {
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                              }, 200);
                              if (ex.name.trim()) {
                                const parsed = parseExerciseInput(ex.name, ex.rest_seconds || 60);
                                if (parsed.matched) {
                                  handleApplyParsedToExercise(ex.id, parsed);
                                  setExerciseNotices(prev => ({
                                    ...prev,
                                    [ex.id]: parsed.type === 'pyramid'
                                      ? `✨ Piramide: ${parsed.pyramid_steps?.map(s => s.reps).join('-')} • ${parsed.pyramid_steps?.[0]?.rest_seconds ?? 60}s recupero`
                                      : parsed.type === 'reps'
                                        ? `✨ Riconosciuto: ${parsed.sets}x${parsed.isMaxReps ? 'Max' : parsed.reps}${parsed.weight_kg ? ` • ${parsed.weight_kg}kg` : ''} • ${parsed.rest_seconds}s`
                                        : `✨ Trasformato in ${parsed.type.toUpperCase()}`
                                  }));
                                  setTimeout(() => {
                                    setExerciseNotices(prev => {
                                      const n = { ...prev };
                                      delete n[ex.id];
                                      return n;
                                    });
                                  }, 3500);
                                }
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (ex.name.trim()) {
                                  const parsed = parseExerciseInput(ex.name, ex.rest_seconds || 60);
                                  if (parsed.matched) {
                                    handleApplyParsedToExercise(ex.id, parsed);
                                    setExerciseNotices(prev => ({
                                      ...prev,
                                      [ex.id]: parsed.type === 'pyramid'
                                        ? `✨ Piramide: ${parsed.pyramid_steps?.map(s => s.reps).join('-')} • ${parsed.pyramid_steps?.[0]?.rest_seconds ?? 60}s recupero`
                                        : parsed.type === 'reps'
                                          ? `✨ Riconosciuto: ${parsed.sets}x${parsed.isMaxReps ? 'Max' : parsed.reps}${parsed.weight_kg ? ` • ${parsed.weight_kg}kg` : ''} • ${parsed.rest_seconds}s`
                                          : `✨ Trasformato in ${parsed.type.toUpperCase()}`
                                    }));
                                    setTimeout(() => {
                                      setExerciseNotices(prev => {
                                        const n = { ...prev };
                                        delete n[ex.id];
                                        return n;
                                      });
                                    }, 3500);
                                  }
                                }
                                setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                                (e.target as HTMLElement).blur();
                              }
                            }}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-white font-medium text-sm focus:border-brand-orange focus:outline-none transition-colors pr-10"
                          />
                          {(exerciseSuggestions[ex.id] || []).length > 0 && (
                            <span className="absolute right-3 text-brand-orange/60 pointer-events-none" title="Suggerimenti disponibili">
                              <History size={16} />
                            </span>
                          )}
                        </div>

                        {/* Dropdown Suggerimenti Autocomplete dallo Storico Utente */}
                        {(exerciseSuggestions[ex.id] || []).length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#181818] border border-brand-orange/30 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-white/5 backdrop-blur-md">
                            <div className="p-2 bg-black/40 text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center">
                              <History size={11} className="mr-1.5 text-brand-orange" />
                              Usato nelle tue sessioni precedenti (clicca per autofill)
                            </div>
                            {(exerciseSuggestions[ex.id] || []).map((item, sIdx) => (
                              <button
                                key={sIdx}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleApplyHistoryItemToExercise(ex.id, item);
                                  setExerciseSuggestions(prev => ({ ...prev, [ex.id]: [] }));
                                  setExerciseNotices(prev => ({
                                    ...prev,
                                    [ex.id]: `Memoria utente: ${item.sets}x${item.reps} • ${item.rest_seconds}s`
                                  }));
                                  setTimeout(() => {
                                    setExerciseNotices(prev => {
                                      const n = { ...prev };
                                      delete n[ex.id];
                                      return n;
                                    });
                                  }, 3500);
                                }}
                                className="w-full text-left p-3 hover:bg-brand-orange/15 transition-colors flex items-center justify-between group"
                              >
                                <div>
                                  <div className="text-sm font-semibold text-white group-hover:text-brand-orange transition-colors">
                                    {item.name}
                                  </div>
                                  <div className="text-xs text-zinc-400 mt-0.5">
                                    {item.sets} serie × {item.reps} reps • {item.rest_seconds}s recupero
                                    {item.weight_kg != null ? ` • ${item.weight_kg} kg` : ''}
                                  </div>
                                </div>
                                <span className="text-[11px] font-bold text-brand-orange opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                                  Applica <Check size={12} className="ml-1" />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Modalità Esercizio: Reps vs Isometria (Full Width) */}
                      {(ex.type === 'reps' || ex.type === 'isometry') && (
                        <div className="w-full bg-black/60 rounded-xl p-1 border border-white/10 grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => updateExercise(ex.id, 'type', 'reps')}
                            className={`w-full py-2 text-xs font-black rounded-lg transition-all text-center ${ex.type === 'reps'
                              ? 'bg-brand-orange text-black shadow-md'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                              }`}
                          >
                            REPS
                          </button>
                          <button
                            type="button"
                            onClick={() => updateExercise(ex.id, 'type', 'isometry')}
                            className={`w-full py-2 text-xs font-black rounded-lg transition-all text-center ${ex.type === 'isometry'
                              ? 'bg-brand-orange text-black shadow-md'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                              }`}
                          >
                            ISOMETRIA
                          </button>
                        </div>
                      )}

                      {/* Note dell'esercizio (direttamente visibile) */}
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                          <FileText size={13} />
                        </div>
                        <input
                          type="text"
                          value={ex.instruction_note || ''}
                          onChange={(e) => updateExercise(ex.id, 'instruction_note', e.target.value)}
                          placeholder="Note tecniche o istruzioni per questo esercizio (opzionale)..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-white text-xs placeholder:text-zinc-500 focus:border-brand-orange focus:outline-none transition-colors"
                        />
                      </div>

                      {/* Sezione Autocount IA/Sensori con pulsanti a tutta larghezza (Solo per Reps) */}
                      {ex.type === 'reps' && (
                        <div className="bg-black/40 border border-white/5 rounded-xl p-2.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <Sparkles size={13} className={ex.auto_count_type ? 'text-brand-orange' : 'text-zinc-400'} />
                              <span className="text-xs font-bold text-zinc-200">
                                Conteggio Automatico (Autocount)
                              </span>
                            </div>
                            {ex.auto_count_type && (
                              <span className="text-[10px] font-black uppercase tracking-wider text-brand-orange bg-brand-orange/15 px-2 py-0.5 rounded-md border border-brand-orange/30">
                                Attivo
                              </span>
                            )}
                          </div>

                          {/* Pulsanti OFF, PUSH-UP, PULL-UP a tutta larghezza (Grid 3 colonne) */}
                          <div className="w-full bg-black/60 rounded-xl p-1 border border-white/10 grid grid-cols-3 gap-1">
                            <button
                              type="button"
                              onClick={() => updateExercise(ex.id, 'auto_count_type', null)}
                              className={`w-full py-2 rounded-lg font-black text-xs transition-all text-center ${!ex.auto_count_type
                                ? 'bg-white/15 text-white shadow-sm'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                                }`}
                            >
                              OFF
                            </button>
                            <button
                              type="button"
                              onClick={() => updateExercise(ex.id, 'auto_count_type', 'pushups')}
                              className={`w-full py-2 rounded-lg font-black text-xs transition-all text-center ${ex.auto_count_type === 'pushups'
                                ? 'bg-brand-orange text-black font-black shadow-md shadow-brand-orange/20'
                                : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                }`}
                            >
                              PUSH-UP
                            </button>
                            <button
                              type="button"
                              onClick={() => updateExercise(ex.id, 'auto_count_type', 'pullups')}
                              className={`w-full py-2 rounded-lg font-black text-xs transition-all text-center ${ex.auto_count_type === 'pullups'
                                ? 'bg-brand-orange text-black font-black shadow-md shadow-brand-orange/20'
                                : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                }`}
                            >
                              PULL-UP
                            </button>
                          </div>

                          <p className="text-[10px] text-zinc-400 leading-relaxed">
                            Attiva <strong className="text-zinc-300">PUSH-UP</strong> o <strong className="text-zinc-300">PULL-UP</strong> per abilitare l'autocount: durante l'allenamento il dispositivo conterà automaticamente le ripetizioni eseguite senza dover toccare lo schermo.
                          </p>
                        </div>
                      )}

                      {/* Griglia Metriche 4 Colonne per Esercizio Standard */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                        {/* Serie */}
                        <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                          <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                            Serie
                          </label>
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => adjustExerciseNumber(ex.id, 'sets', -1)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                              title="Diminuisci serie"
                            >
                              <Minus size={13} />
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={getDraftOrValue(`${ex.id}:sets`, ex.sets)}
                              onChange={(e) => setDraftValue(`${ex.id}:sets`, e.target.value)}
                              onBlur={() => commitExerciseNumber(ex.id, 'sets', `${ex.id}:sets`, 1, 1)}
                              onFocus={onNumberFocus}
                              className="w-12 text-center font-bold text-white bg-transparent focus:outline-none text-base"
                            />
                            <button
                              type="button"
                              onClick={() => adjustExerciseNumber(ex.id, 'sets', 1)}
                              className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                              title="Aumenta serie"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Reps o Durata (min:sec) */}
                        <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                          {ex.type === 'reps' ? (
                            <>
                              <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                                Reps
                              </label>
                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => adjustExerciseNumber(ex.id, 'reps', -1)}
                                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                                  title="-1 rep"
                                >
                                  <Minus size={13} />
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={getDraftOrValue(`${ex.id}:reps`, ex.reps, true)}
                                  onChange={(e) => setDraftValue(`${ex.id}:reps`, e.target.value)}
                                  onBlur={() => commitExerciseNumber(ex.id, 'reps', `${ex.id}:reps`, 0, 0)}
                                  onFocus={onNumberFocus}
                                  placeholder="MAX"
                                  className="w-14 text-center font-bold text-white bg-transparent focus:outline-none text-base placeholder:text-brand-orange/60 placeholder:text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => adjustExerciseNumber(ex.id, 'reps', 1)}
                                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                                  title="+1 rep"
                                >
                                  <Plus size={13} />
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                  <Clock size={10} /> Durata
                                </label>
                              </div>
                              <div className="flex items-center h-7 gap-1">
                                <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    value={getDraftOrValue(`${ex.id}:duration:min`, Math.floor((ex.duration_seconds || 0) / 60))}
                                    onChange={(e) => setDraftValue(`${ex.id}:duration:min`, e.target.value)}
                                    onBlur={() => commitDurationPart(ex.id, 'min', `${ex.id}:duration:min`, ex.duration_seconds || 0)}
                                    onFocus={onNumberFocus}
                                    placeholder="0"
                                    className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                                  />
                                  <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">M</span>
                                </div>
                                <span className="text-zinc-500 font-bold">:</span>
                                <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    max="59"
                                    value={getDraftOrValue(`${ex.id}:duration:sec`, (ex.duration_seconds || 0) % 60)}
                                    onChange={(e) => setDraftValue(`${ex.id}:duration:sec`, e.target.value)}
                                    onBlur={() => commitDurationPart(ex.id, 'sec', `${ex.id}:duration:sec`, ex.duration_seconds || 0)}
                                    onFocus={onNumberFocus}
                                    placeholder="0"
                                    className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                                  />
                                  <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">S</span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Peso kg */}
                        <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                          <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                            Carico (kg)
                          </label>
                          <div className="flex items-center h-7">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={getWeightDraftOrValue(`${ex.id}:weight`, ex.weight_kg)}
                              onChange={(e) => setDraftValue(`${ex.id}:weight`, e.target.value)}
                              onBlur={() => commitExerciseWeight(ex.id, `${ex.id}:weight`, ex.weight_kg)}
                              onFocus={onNumberFocus}
                              placeholder="Corpo libero"
                              className="w-full text-center font-bold text-white bg-transparent focus:outline-none text-base placeholder:text-zinc-600 placeholder:text-xs"
                            />
                          </div>
                        </div>

                        {/* Recupero (min:sec) */}
                        <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                              <Clock size={10} /> Rest
                            </label>
                          </div>
                          <div className="flex items-center h-7 gap-1">
                            <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                value={getDraftOrValue(`${ex.id}:rest:min`, Math.floor(ex.rest_seconds / 60))}
                                onChange={(e) => setDraftValue(`${ex.id}:rest:min`, e.target.value)}
                                onBlur={() => commitRestPart(ex.id, 'min', `${ex.id}:rest:min`, ex.rest_seconds)}
                                onFocus={onNumberFocus}
                                className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                              />
                              <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">M</span>
                            </div>
                            <span className="text-zinc-500 font-bold">:</span>
                            <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                max="59"
                                value={getDraftOrValue(`${ex.id}:rest:sec`, ex.rest_seconds % 60)}
                                onChange={(e) => setDraftValue(`${ex.id}:rest:sec`, e.target.value)}
                                onBlur={() => commitRestPart(ex.id, 'sec', `${ex.id}:rest:sec`, ex.rest_seconds)}
                                onFocus={onNumberFocus}
                                className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                              />
                              <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">S</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Dati Serie e Recupero per Superset / Circuito / EMOM (2 colonne) */}
                  {ex.type !== 'pyramid' && (ex.type === 'superset' || ex.type === 'circuit' || ex.type === 'emom') && (
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                        <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1">
                          {ex.type === 'circuit' ? 'Giri (Rounds)' : 'Serie Totali'}
                        </label>
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => adjustExerciseNumber(ex.id, 'sets', -1)}
                            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                            title="Diminuisci"
                          >
                            <Minus size={13} />
                          </button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            value={getDraftOrValue(`${ex.id}:sets`, ex.sets)}
                            onChange={(e) => setDraftValue(`${ex.id}:sets`, e.target.value)}
                            onBlur={() => commitExerciseNumber(ex.id, 'sets', `${ex.id}:sets`, 1, 1)}
                            onFocus={onNumberFocus}
                            className="w-12 text-center font-bold text-white bg-transparent focus:outline-none text-base"
                          />
                          <button
                            type="button"
                            onClick={() => adjustExerciseNumber(ex.id, 'sets', 1)}
                            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 transition-colors"
                            title="Aumenta"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col bg-black/40 border border-white/5 rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <Clock size={10} /> {ex.type === 'circuit' ? 'Rest fine giro' : 'Recupero round'}
                          </label>
                        </div>
                        <div className="flex items-center h-7 gap-1">
                          <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              value={getDraftOrValue(`${ex.id}:rest:min`, Math.floor(ex.rest_seconds / 60))}
                              onChange={(e) => setDraftValue(`${ex.id}:rest:min`, e.target.value)}
                              onBlur={() => commitRestPart(ex.id, 'min', `${ex.id}:rest:min`, ex.rest_seconds)}
                              onFocus={onNumberFocus}
                              className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                            />
                            <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">M</span>
                          </div>
                          <span className="text-zinc-500 font-bold">:</span>
                          <div className="relative flex-1 h-full bg-white/5 rounded-lg flex items-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="59"
                              value={getDraftOrValue(`${ex.id}:rest:sec`, ex.rest_seconds % 60)}
                              onChange={(e) => setDraftValue(`${ex.id}:rest:sec`, e.target.value)}
                              onBlur={() => commitRestPart(ex.id, 'sec', `${ex.id}:rest:sec`, ex.rest_seconds)}
                              onFocus={onNumberFocus}
                              className="w-full text-center font-bold text-brand-orange bg-transparent focus:outline-none text-sm"
                            />
                            <span className="text-[8px] text-zinc-500 font-bold pr-1.5 pointer-events-none">S</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {index < exercises.length - 1 && (
                  <div className="my-3 px-0.5">
                    {/* Stato: Pausa Impostata (Visualizzazione Compatta) */}
                    {(ex.transition_rest_seconds || 0) > 0 && editingTransitionForExerciseId !== ex.id && (
                      <div className="bg-[#18181A] border border-brand-orange/40 rounded-2xl p-3 shadow-md shadow-brand-orange/5 flex items-center justify-between transition-all">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center text-brand-orange shrink-0">
                            <Clock size={18} />
                          </div>
                          <div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-brand-orange block">
                              Recupero tra Es. {index + 1} e {index + 2}
                            </span>
                            <p className="text-base font-black text-white tracking-tight">
                              {formatTransitionRest(ex.transition_rest_seconds)}{' '}
                              <span className="text-[11px] font-semibold text-zinc-400">min : sec</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingTransitionForExerciseId(ex.id)}
                            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 text-xs font-bold text-white transition-all"
                          >
                            Modifica
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              applyTransitionPreset(ex.id, 0);
                              setEditingTransitionForExerciseId(null);
                            }}
                            className="p-2 rounded-xl text-zinc-400 hover:text-red-400 hover:bg-red-500/10 active:scale-95 transition-all"
                            title="Rimuovi recupero"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Stato: Nessuna Pausa Impostata (Tasto Ben Visibile) */}
                    {!(ex.transition_rest_seconds || 0) && editingTransitionForExerciseId !== ex.id && (
                      <button
                        type="button"
                        onClick={() => setEditingTransitionForExerciseId(ex.id)}
                        className="w-full group bg-black/40 hover:bg-[#1C1C1E] border border-dashed border-white/20 hover:border-brand-orange/50 active:scale-[0.99] rounded-2xl p-3 flex items-center justify-between transition-all"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <div className="w-8 h-8 rounded-xl bg-white/5 group-hover:bg-brand-orange/15 border border-white/10 group-hover:border-brand-orange/30 flex items-center justify-center text-zinc-400 group-hover:text-brand-orange transition-colors shrink-0">
                            <Clock size={16} />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-200 group-hover:text-white transition-colors block">
                              Pausa tra Esercizio {index + 1} e {index + 2}
                            </span>
                            <span className="text-[10px] text-zinc-500 block">
                              Tocca per impostare il tempo di recupero tra questi due esercizi
                            </span>
                          </div>
                        </div>
                        <span className="text-xs font-black text-brand-orange bg-brand-orange/10 group-hover:bg-brand-orange group-hover:text-black px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 shrink-0">
                          <Plus size={13} /> Imposta Pausa
                        </span>
                      </button>
                    )}

                    {/* Stato: Modifica / Configurazione Aperta */}
                    {editingTransitionForExerciseId === ex.id && (
                      <div className="bg-[#1C1C1E] border border-brand-orange/50 rounded-2xl p-4 shadow-xl transition-all space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-brand-orange/20 text-brand-orange flex items-center justify-center">
                              <Clock size={15} />
                            </div>
                            <div>
                              <span className="text-xs font-black uppercase tracking-wider text-brand-orange block">
                                Recupero tra Es. {index + 1} e Es. {index + 2}
                              </span>
                              <span className="text-[10px] text-zinc-400">
                                Inserisci minuti e secondi di recupero
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => commitBothTransitionRestParts(ex.id, ex.transition_rest_seconds || 0)}
                            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                            title="Chiudi"
                          >
                            <X size={18} />
                          </button>
                        </div>

                        {/* Due soli campi di testo: Minuti e Secondi */}
                        <div className="grid grid-cols-2 gap-3">
                          {/* Campo Minuti */}
                          <div className="flex flex-col bg-black/60 border border-white/10 rounded-2xl p-3.5 focus-within:border-brand-orange/60 transition-colors">
                            <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between">
                              <span>Minuti</span>
                              <span className="text-[9px] text-zinc-500 lowercase">(min)</span>
                            </label>
                            <div className="relative flex items-center">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={getDraftOrValue(`${ex.id}:transition_rest:min`, Math.floor((ex.transition_rest_seconds || 0) / 60))}
                                onChange={(e) => setDraftValue(`${ex.id}:transition_rest:min`, e.target.value)}
                                onBlur={() => commitTransitionRestPart(ex.id, 'min', `${ex.id}:transition_rest:min`, ex.transition_rest_seconds || 0)}
                                onFocus={onNumberFocus}
                                placeholder="0"
                                className="w-full text-center font-black text-brand-orange bg-transparent focus:outline-none text-2xl tracking-tight"
                              />
                            </div>
                          </div>

                          {/* Campo Secondi */}
                          <div className="flex flex-col bg-black/60 border border-white/10 rounded-2xl p-3.5 focus-within:border-brand-orange/60 transition-colors">
                            <label className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between">
                              <span>Secondi</span>
                              <span className="text-[9px] text-zinc-500 lowercase">(0 - 59)</span>
                            </label>
                            <div className="relative flex items-center">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={getDraftOrValue(`${ex.id}:transition_rest:sec`, (ex.transition_rest_seconds || 0) % 60)}
                                onChange={(e) => setDraftValue(`${ex.id}:transition_rest:sec`, e.target.value)}
                                onBlur={() => commitTransitionRestPart(ex.id, 'sec', `${ex.id}:transition_rest:sec`, ex.transition_rest_seconds || 0)}
                                onFocus={onNumberFocus}
                                placeholder="0"
                                className="w-full text-center font-black text-brand-orange bg-transparent focus:outline-none text-2xl tracking-tight"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Barra Azioni */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                          {(ex.transition_rest_seconds || 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                applyTransitionPreset(ex.id, 0);
                                setEditingTransitionForExerciseId(null);
                              }}
                              className="px-3.5 py-2 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 text-xs font-bold transition-colors active:scale-95"
                            >
                              Rimuovi recupero
                            </button>
                          ) : (
                            <span className="text-[11px] text-zinc-500 font-medium">
                              Nessuna pausa impostata
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => commitBothTransitionRestParts(ex.id, ex.transition_rest_seconds || 0)}
                            className="ml-auto px-5 py-2.5 rounded-xl bg-brand-orange text-black font-black text-xs hover:bg-brand-lightOrange active:scale-95 transition-all shadow-md shadow-brand-orange/20 cursor-pointer"
                          >
                            Fatto
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            ))
          )}

          <button
            type="button"
            onClick={addExercise}
            className="w-full text-brand-orange hover:text-brand-lightOrange active:text-white flex items-center justify-center text-sm font-black bg-brand-orange/10 hover:bg-brand-orange/20 active:bg-brand-orange/30 px-4 py-4 rounded-2xl transition-all border border-brand-orange/30 border-dashed cursor-pointer touch-manipulation select-none active:scale-[0.98] shadow-sm"
          >
            <Plus size={20} className="mr-2 shrink-0" />
            <span>AGGIUNGI ESERCIZIO</span>
          </button>
        </div>

        <button
          onClick={saveWorkout}
          disabled={loading || exercises.length === 0}
          className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-lg py-4 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 mt-auto shadow-lg shadow-brand-orange/20"
        >
          {loading ? 'Saving...' : (
            <>
              <Save size={24} className="mr-2" />
              SAVE WORKOUT
            </>
          )}
        </button>

        <WorkoutQuickImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onImportExercises={handleImportExercises}
        />

        {isNewFolderModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-2">Crea Nuova Cartella</h3>
              <p className="text-xs text-zinc-400 mb-4">
                Assegna un nome alla cartella per raggruppare le tue schede.
              </p>
              <input
                type="text"
                placeholder="Es. Schede Estate, Ipertrofia..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolderInline();
                }}
                autoFocus
                className="w-full bg-black/40 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:border-brand-orange focus:outline-none text-sm mb-4"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewFolderModalOpen(false);
                    setNewFolderName('');
                  }}
                  className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={handleCreateFolderInline}
                  disabled={!newFolderName.trim()}
                  className="flex-1 py-2 rounded-xl bg-brand-orange hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold transition-colors cursor-pointer"
                >
                  Crea
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default NewTrainPage;
