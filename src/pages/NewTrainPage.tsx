import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Plus, Save, Trash2, ChevronUp, ChevronDown, Clock, Move } from 'lucide-react';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';

interface ExerciseDraft {
  id: string; // Temporaneo per la UI
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string;
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
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string;
  }[];
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
    weight_kg?: number | null;
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
  const type: 'reps' | 'isometry' = sub.type === 'isometry' ? 'isometry' : 'reps';

  return {
    name: String(sub.name || ''),
    type,
    reps: toSafeInteger(sub.reps, type === 'reps' ? 10 : 0, 0),
    duration_seconds: toSafeInteger(sub.duration_seconds, type === 'isometry' ? 30 : 0, 0),
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
  };
};

const normalizeExerciseDraft = (raw: unknown): ExerciseDraft => {
  const ex = (raw || {}) as Record<string, unknown>;
  const typeRaw = String(ex.type || 'reps').toLowerCase();
  const type: ExerciseDraft['type'] =
    typeRaw === 'isometry' || typeRaw === 'superset' || typeRaw === 'emom' || typeRaw === 'pyramid'
      ? (typeRaw as ExerciseDraft['type'])
      : 'reps';

  const normalized: ExerciseDraft = {
    id: String(ex.id || crypto.randomUUID()),
    type,
    name: String(ex.name || ''),
    instruction_note: String(ex.instruction_note || ''),
    sets: toSafeInteger(ex.sets, 3, 1),
    reps: toSafeInteger(ex.reps, 10, 0),
    duration_seconds: toSafeInteger(ex.duration_seconds, 30, 0),
    rest_seconds: toSafeInteger(ex.rest_seconds, 60, 0),
    transition_rest_seconds: toSafeInteger(ex.transition_rest_seconds, 0, 0),
    weight_kg: toSafeWeight(ex.weight_kg),
  };

  if (type === 'emom') {
    normalized.emom_rounds = toSafeInteger(ex.emom_rounds, 10, 1);
    normalized.emom_round_duration = toSafeInteger(ex.emom_round_duration, 60, 1);
  }

  if (type === 'superset' || type === 'emom') {
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
  const [focusedExerciseId, setFocusedExerciseId] = useState<string | null>(null);
  const [didAutoFocusExercise, setDidAutoFocusExercise] = useState(false);
  const exerciseRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const { id } = useParams<{ id: string }>();
  const requestedExerciseIndex = React.useMemo(() => {
    const raw = new URLSearchParams(location.search).get('exerciseIndex');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1, Math.trunc(parsed));
  }, [location.search]);
  const isCreateMode = !id;

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

  // Carica i dati della scheda se siamo in modalità modifica
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
        const parsed = parseDbExerciseRows(data.esecuzioni || []).map((ex: any) => ({
          ...ex,
          id: crypto.randomUUID(),
          instruction_note: typeof ex.instruction_note === 'string' ? ex.instruction_note : '',
          transition_rest_seconds: Number.isFinite(Number(ex.transition_rest_seconds))
            ? Math.max(0, Math.trunc(Number(ex.transition_rest_seconds)))
            : 0,
          subExercises: Array.isArray(ex.subExercises)
            ? ex.subExercises.map((sub: any) => ({
                ...sub,
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

  const addExercise = () => {
    setExercises([
      ...exercises,
      {
        id: crypto.randomUUID(),
        type: 'reps',
        name: '',
        instruction_note: '',
        sets: 3,
        reps: 10,
        duration_seconds: 30,
        rest_seconds: 60,
        transition_rest_seconds: 0,
        weight_kg: null,
      }
    ]);
  };

  

  const convertToSuperset = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        return {
          ...ex,
          type: 'superset',
          subExercises: [
            {
              name: ex.name,
              type: ex.type as 'reps' | 'isometry',
              reps: ex.reps,
              duration_seconds: ex.duration_seconds,
              weight_kg: ex.weight_kg ?? null,
              instruction_note: ex.instruction_note || '',
            },
            { name: '', type: 'reps', reps: 10, duration_seconds: 0, weight_kg: null, instruction_note: '' }
          ]
        };
      }
      return ex;
    }));
  };

  const convertToPyramid = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        const baseReps = Number.isFinite(ex.reps) && ex.reps > 0 ? ex.reps : PYRAMID_DEFAULT_REPS;
        const baseRest = Number.isFinite(ex.rest_seconds) && ex.rest_seconds >= 0 ? ex.rest_seconds : PYRAMID_DEFAULT_REST_SECONDS;

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
              type: ex.type === 'isometry' ? 'isometry' : 'reps',
              reps: ex.type === 'reps' ? ex.reps : 0,
              duration_seconds: ex.type === 'isometry' ? ex.duration_seconds : 0,
              weight_kg: ex.weight_kg ?? null,
              instruction_note: ex.instruction_note || '',
            },
          ],
        };
      }
      return ex;
    }));
  };

  const removeExercise = (id: string) => {
    if (editingTransitionForExerciseId === id) {
      setEditingTransitionForExerciseId(null);
    }
    setExercises(exercises.filter(ex => ex.id !== id));
  };

  const moveExercise = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === exercises.length - 1) return;

    const newExercises = [...exercises];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    // Scambia gli elementi
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

  const onNumberFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
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
    if (Object.prototype.hasOwnProperty.call(numberDrafts, key)) return numberDrafts[key];
    return formatWeightDisplay(value);
  };

  const parseWeightInput = (raw: string, fallback: number | null) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
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
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? defaultValue : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = defaultValue;
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
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? defaultValue : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = defaultValue;
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
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? defaultValue : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = defaultValue;
    if (parsed < min) parsed = min;
    if (typeof max === 'number' && parsed > max) parsed = max;
    updatePyramidStep(pyramidId, stepIndex, field, parsed);
    clearDraftValue(key);
  };

  const commitPyramidRestPart = (
    pyramidId: string,
    stepIndex: number,
    part: 'min' | 'sec',
    key: string,
    currentRestSeconds: number
  ) => {
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? 0 : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const safeCurrent = Number.isFinite(currentRestSeconds) ? currentRestSeconds : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;
    updatePyramidStep(pyramidId, stepIndex, 'rest_seconds', next);
    clearDraftValue(key);
  };

  const commitPyramidStepWeight = (
    pyramidId: string,
    stepIndex: number,
    key: string,
    currentWeight: number | null | undefined
  ) => {
    const raw = numberDrafts[key] ?? '';
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
    const raw = numberDrafts[key] ?? '';
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
    const raw = numberDrafts[key] ?? '';
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
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? (part === 'min' ? 0 : 0) : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const safeCurrent = Number.isFinite(currentRestSeconds) ? currentRestSeconds : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;
    updateExercise(id, 'rest_seconds', next);
    clearDraftValue(key);
  };

  const commitTransitionRestPart = (
    id: string,
    part: 'min' | 'sec',
    key: string,
    currentTransitionRestSeconds: number
  ) => {
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? 0 : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const safeCurrent = Number.isFinite(currentTransitionRestSeconds)
      ? Math.max(0, Math.trunc(currentTransitionRestSeconds))
      : 0;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
    const next = part === 'min' ? (parsed * 60) + seconds : (minutes * 60) + parsed;

    updateExercise(id, 'transition_rest_seconds', next);
    clearDraftValue(key);
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
    const raw = (numberDrafts[key] ?? '').trim();
    let parsed = raw === '' ? 0 : parseInt(raw, 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    if (parsed < 0) parsed = 0;
    if (part === 'sec' && parsed > 59) parsed = 59;

    const safeCurrent = Number.isFinite(currentRoundDurationSeconds) ? Math.max(1, currentRoundDurationSeconds) : 60;
    const minutes = Math.floor(safeCurrent / 60);
    const seconds = safeCurrent % 60;
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

        if (ex.type === 'superset' && remaining.length === 1) {
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
      if (ex.type === 'superset') {
        if (!ex.subExercises || ex.subExercises.length < 2) {
          setError('Supersets must contain at least 2 exercises'); return;
        }
        for (const sub of ex.subExercises) {
          if (!sub.name.trim()) { setError('All exercises in a Superset must have a name'); return; }
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
        // UPDATE scheda esistente
        const { error: updateError } = await supabase
          .from('schede')
          .update({ nome: workoutName })
          .eq('id_scheda', Number(id));
        if (updateError) throw updateError;

        // Rimuove i vecchi esercizi
        const { error: deleteError } = await supabase
          .from('esecuzioni')
          .delete()
          .eq('id_scheda', Number(id));
        if (deleteError) throw deleteError;

      } else {
        // INSERT nuova scheda
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

        if (ex.type === 'superset') {
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

            rowsToInsert.push({
              id_scheda: Number(workoutIdToUse),
              id_esercizio: idEsercizio,
              ordine: orderCounter,
              set_num: 1,
              rest_secondi: step.rest_seconds > 0 ? step.rest_seconds : null,
              rest_tra_esercizi: transitionRestToPersist,
              peso_kg: toDbWeight(step.weight_kg),
              note_esercizio: String(ex.instruction_note || '').trim() || null,
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
        const isIsometry = ex.type === 'isometry';

        rowsToInsert.push({
          id_scheda: Number(workoutIdToUse),
          id_esercizio: idEsercizio,
          ordine: orderCounter,
          set_num: Math.max(1, ex.sets || 1),
          rest_secondi: ex.rest_seconds > 0 ? ex.rest_seconds : null,
          rest_tra_esercizi: transitionRestToPersist,
          peso_kg: toDbWeight(ex.weight_kg),
          note_esercizio: String(ex.instruction_note || '').trim() || null,
          tipo: isIsometry ? 'ISOMETRIA' : 'REPS',
          reps: isIsometry ? null : Math.max(0, ex.reps ?? 0),
          durata_secondi: isIsometry ? Math.max(0, ex.duration_seconds ?? 0) : null,
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

      if (isCreateMode && user?.id) {
        preserveCreateDraftOnUnmountRef.current = false;
        suppressCreateDraftPersistenceRef.current = true;
        setCreateDraftResumeAllowed(user.id, false);
        clearCreateWorkoutDraft(user.id);
      }

      navigate('/gym-card');

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
      <header className="p-4 flex items-center bg-black/50 sticky top-0 z-20 backdrop-blur-md">
        <button
          onClick={handleBackFromCreate}
          className="p-2 text-white hover:text-brand-orange transition-colors"
        >
          <ArrowLeft size={28} />
        </button>
        <h1 className="text-xl font-bold ml-2">{id ? 'Edit Workout' : 'New Workout'}</h1>
      </header>

      <main className="flex-1 p-6 flex flex-col max-w-lg mx-auto w-full">
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

        <div className="space-y-4 mb-8">
          <div className="flex items-center mb-2">
            <h2 className="text-brand-grey font-semibold ml-1 flex items-center">
              <Move size={16} className="mr-2 opacity-50" />
              Exercises
            </h2>
          </div>

          {exercises.length === 0 ? (
            <div className="text-center p-8 bg-brand-darkGrey/20 rounded-3xl border border-dashed border-brand-grey/30">
              <p className="text-brand-grey/60">No exercises added.</p>
            </div>
          ) : (
            exercises.map((ex, index) => (
              <React.Fragment key={ex.id}>
              <div
                ref={(node) => {
                  exerciseRefs.current[ex.id] = node;
                }}
                className={`bg-brand-darkGrey/40 border p-4 rounded-3xl flex flex-col space-y-4 relative shadow-lg transition-colors ${
                  focusedExerciseId === ex.id ? 'border-brand-orange/70 ring-2 ring-brand-orange/30' : 'border-brand-grey/20'
                }`}
              >

                {/* Header Esercizio: Frecce Ordine e Bottone Elimina */}
                <div className="flex justify-between items-center bg-black/30 -mx-4 -mt-4 p-3 rounded-t-3xl border-b border-white/5">
                  <div className="flex space-x-1">
                    <button
                      onClick={() => moveExercise(index, 'up')}
                      disabled={index === 0}
                      className="p-1.5 text-brand-grey hover:text-white hover:bg-white/10 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <ChevronUp size={20} />
                    </button>
                    <button
                      onClick={() => moveExercise(index, 'down')}
                      disabled={index === exercises.length - 1}
                      className="p-1.5 text-brand-grey hover:text-white hover:bg-white/10 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <ChevronDown size={20} />
                    </button>
                  </div>
                  <span className="text-xs font-bold text-brand-grey/40">EXERCISE {index + 1}</span>
                  <button
                    onClick={() => removeExercise(ex.id)}
                    className="p-1.5 text-brand-grey/60 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                {/* Specific UI for SUPERSET vs SINGLE */}
                {ex.type === 'emom' ? (
                  <div className="space-y-3 bg-brand-dark/30 p-4 rounded-xl border border-blue-500/20">
                    <p className="text-xs font-bold text-blue-400 uppercase tracking-wider text-center mb-2 flex flex-col items-center justify-center">
                      ⏱️ EMOM Circuit
                    </p>
                    <div className="grid grid-cols-2 gap-2 mb-4 mt-2">
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Total Rounds</label>
                        <input
                          type="number" inputMode="numeric"
                          min="1"
                          value={getDraftOrValue(`${ex.id}:emom_rounds`, ex.emom_rounds || 1)}
                          onChange={(e) => setDraftValue(`${ex.id}:emom_rounds`, e.target.value)}
                          onBlur={() => commitExerciseNumber(ex.id, 'emom_rounds', `${ex.id}:emom_rounds`, 1, 1)}
                          onFocus={onNumberFocus}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Round Time</label>
                        <div className="flex bg-black/40 border border-brand-grey/20 rounded-lg overflow-hidden focus-within:border-blue-400 transition-colors h-[42px]">
                          <div className="relative flex-1 border-r border-brand-grey/10">
                            <input
                              type="number" inputMode="numeric"
                              min="0"
                              value={getDraftOrValue(`${ex.id}:emom_round_duration:min`, Math.floor((ex.emom_round_duration || 60) / 60))}
                              onChange={(e) => setDraftValue(`${ex.id}:emom_round_duration:min`, e.target.value)}
                              onBlur={() => commitEmomRoundDurationPart(ex.id, 'min', `${ex.id}:emom_round_duration:min`, ex.emom_round_duration || 60)}
                              onFocus={onNumberFocus}
                              className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                            />
                            <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">MIN</span>
                          </div>
                          <div className="relative flex-1">
                            <input
                              type="number" inputMode="numeric"
                              min="0"
                              max="59"
                              value={getDraftOrValue(`${ex.id}:emom_round_duration:sec`, (ex.emom_round_duration || 60) % 60)}
                              onChange={(e) => setDraftValue(`${ex.id}:emom_round_duration:sec`, e.target.value)}
                              onBlur={() => commitEmomRoundDurationPart(ex.id, 'sec', `${ex.id}:emom_round_duration:sec`, ex.emom_round_duration || 60)}
                              onFocus={onNumberFocus}
                              className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                            />
                            <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">SEC</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {ex.subExercises?.map((sub, sIdx) => (
                      <div key={sIdx} className="flex flex-col space-y-2 relative pr-8">
                        <input
                          type="text"
                          placeholder={`Exercise Name ${sIdx + 1}`}
                          value={sub.name}
                          onChange={(e) => updateSubExercise(ex.id, sIdx, 'name', e.target.value)}
                          className="w-full bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-400 outline-none"
                        />
                        <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                          <button
                            onClick={() => updateSubExercise(ex.id, sIdx, 'type', 'reps')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            REPS
                          </button>
                          <button
                            onClick={() => updateSubExercise(ex.id, sIdx, 'type', 'isometry')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            ISOMETRIC
                          </button>
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                            {sub.type === 'reps' ? 'Reps' : 'Time (sec)'}
                          </label>
                          <input
                            type="text" inputMode="numeric"
                            value={getDraftOrValue(`${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? sub.reps : sub.duration_seconds, true)}
                            onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:${sub.type}`, e.target.value)}
                            onBlur={() => commitSubExerciseNumber(ex.id, sIdx, sub.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:sub:${sIdx}:${sub.type}`, 0, 0)}
                            onFocus={onNumberFocus}
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-blue-400 outline-none placeholder:text-brand-orange/60 placeholder:text-xs"
                            placeholder={sub.type === 'reps' ? 'MAX REPS' : 'MAX TIME'}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                            Weight (kg)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getWeightDraftOrValue(`${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                            onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:weight`, e.target.value)}
                            onBlur={() => commitSubExerciseWeight(ex.id, sIdx, `${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                            onFocus={onNumberFocus}
                            placeholder="body Weight"
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-blue-400 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                            Exercise Note (optional)
                          </label>
                          <textarea
                            rows={2}
                            value={sub.instruction_note || ''}
                            onChange={(e) => updateSubExercise(ex.id, sIdx, 'instruction_note', e.target.value)}
                            placeholder="E.g. fermo in buca 1 secondo"
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-400 outline-none resize-none"
                          />
                        </div>
                        {ex.subExercises && ex.subExercises.length > 1 && (
                          <button
                            onClick={() => removeSubExercise(ex.id, sIdx)}
                            className="absolute right-0 top-1 text-red-500/50 hover:text-red-500 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => addSubExercise(ex.id)}
                      className="w-full mt-2 py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> ADD TO EMOM
                    </button>
                  </div>
                ) : ex.type === 'superset' ? (
                  <div className="space-y-3 bg-brand-dark/30 p-4 rounded-xl border border-brand-orange/20">
                    <p className="text-xs font-bold text-brand-orange uppercase tracking-wider text-center mb-2 flex items-center justify-center">
                      🔁 Superset Circuit
                    </p>
                    {ex.subExercises?.map((sub, sIdx) => (
                      <div key={sIdx} className="flex flex-col space-y-2 relative pr-8">
                        <input
                          type="text"
                          placeholder={`Exercise Name ${sIdx + 1}`}
                          value={sub.name}
                          onChange={(e) => updateSubExercise(ex.id, sIdx, 'name', e.target.value)}
                          className="w-full bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-orange outline-none"
                        />
                        <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                          <button
                            onClick={() => updateSubExercise(ex.id, sIdx, 'type', 'reps')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            REPS
                          </button>
                          <button
                            onClick={() => updateSubExercise(ex.id, sIdx, 'type', 'isometry')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            ISOMETRIC
                          </button>
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                            {sub.type === 'reps' ? 'Reps' : 'Time (sec)'}
                          </label>
                          <input
                            type="text" inputMode="numeric"
                            value={getDraftOrValue(`${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? sub.reps : sub.duration_seconds, true)}
                            onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:${sub.type}`, e.target.value)}
                            onBlur={() => commitSubExerciseNumber(ex.id, sIdx, sub.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:sub:${sIdx}:${sub.type}`, 0, 0)}
                            onFocus={onNumberFocus}
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none placeholder:text-brand-orange/60 placeholder:text-xs"
                            placeholder={sub.type === 'reps' ? 'MAX REPS' : 'MAX TIME'}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                            Weight (kg)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getWeightDraftOrValue(`${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                            onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:weight`, e.target.value)}
                            onBlur={() => commitSubExerciseWeight(ex.id, sIdx, `${ex.id}:sub:${sIdx}:weight`, sub.weight_kg)}
                            onFocus={onNumberFocus}
                            placeholder="body Weight"
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                            Exercise Note (optional)
                          </label>
                          <textarea
                            rows={2}
                            value={sub.instruction_note || ''}
                            onChange={(e) => updateSubExercise(ex.id, sIdx, 'instruction_note', e.target.value)}
                            placeholder="E.g. fermo a braccia stese"
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-orange outline-none resize-none"
                          />
                        </div>
                        {ex.subExercises && ex.subExercises.length > 1 && (
                          <button
                            onClick={() => removeSubExercise(ex.id, sIdx)}
                            className="absolute right-0 top-1 text-red-500/50 hover:text-red-500 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => addSubExercise(ex.id)}
                      className="w-full mt-2 py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> ADD TO SUPERSET
                    </button>
                  </div>
                ) : ex.type === 'pyramid' ? (
                  <div className="space-y-3 bg-brand-dark/30 p-4 rounded-xl border border-brand-orange/20">
                    <p className="text-xs font-bold text-brand-orange uppercase tracking-wider text-center mb-2">
                      Pyramid
                    </p>

                    <input
                      type="text"
                      placeholder="Exercise Name (e.g. Push Ups)"
                      value={ex.name}
                      onChange={(e) => updateExercise(ex.id, 'name', e.target.value)}
                      className="w-full bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-orange outline-none"
                    />

                    <div>
                      <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                        Exercise Note (optional)
                      </label>
                      <textarea
                        rows={2}
                        value={ex.instruction_note || ''}
                        onChange={(e) => updateExercise(ex.id, 'instruction_note', e.target.value)}
                        placeholder="E.g. fermo in buca 1 secondo"
                        className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand-orange outline-none resize-none"
                      />
                    </div>

                    {ex.pyramid_steps?.map((step, stepIdx) => (
                      <div key={stepIdx} className="bg-black/30 border border-white/5 rounded-xl p-3 space-y-2 relative pr-8">
                        <p className="text-[10px] uppercase tracking-wider text-brand-grey/70 font-bold">Step {stepIdx + 1}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1">Reps</label>
                            <input
                              type="text" inputMode="numeric"
                              value={getDraftOrValue(`${ex.id}:pyr:${stepIdx}:reps`, step.reps, true)}
                              onChange={(e) => setDraftValue(`${ex.id}:pyr:${stepIdx}:reps`, e.target.value)}
                              onBlur={() => commitPyramidStepNumber(ex.id, stepIdx, 'reps', `${ex.id}:pyr:${stepIdx}:reps`, 0, 0)}
                              onFocus={onNumberFocus}
                              placeholder="MAX REPS"
                              className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none placeholder:text-brand-orange/60 placeholder:text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1 flex items-center">
                              <Clock size={10} className="mr-1" />
                              Rest
                            </label>
                            <div className="flex bg-black/40 border border-brand-grey/10 rounded-lg overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                              <div className="flex flex-col items-center justify-center w-1/2 border-r border-brand-grey/10 relative">
                                <input
                                  type="number" inputMode="numeric"
                                  min="0"
                                  value={getDraftOrValue(`${ex.id}:pyr:${stepIdx}:rest:min`, Math.floor(step.rest_seconds / 60))}
                                  onChange={(e) => setDraftValue(`${ex.id}:pyr:${stepIdx}:rest:min`, e.target.value)}
                                  onBlur={() => commitPyramidRestPart(ex.id, stepIdx, 'min', `${ex.id}:pyr:${stepIdx}:rest:min`, step.rest_seconds)}
                                  onFocus={onNumberFocus}
                                  className="w-full h-full bg-transparent pt-3 pb-1 pl-4 text-center text-brand-orange font-bold text-base focus:outline-none"
                                />
                                <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">MIN</span>
                              </div>
                              <div className="flex flex-col items-center justify-center w-1/2 relative">
                                <input
                                  type="number" inputMode="numeric"
                                  min="0"
                                  max="59"
                                  value={getDraftOrValue(`${ex.id}:pyr:${stepIdx}:rest:sec`, step.rest_seconds % 60)}
                                  onChange={(e) => setDraftValue(`${ex.id}:pyr:${stepIdx}:rest:sec`, e.target.value)}
                                  onBlur={() => commitPyramidRestPart(ex.id, stepIdx, 'sec', `${ex.id}:pyr:${stepIdx}:rest:sec`, step.rest_seconds)}
                                  onFocus={onNumberFocus}
                                  className="w-full h-full bg-transparent pt-3 pb-1 pl-4 text-center text-brand-orange font-bold text-base focus:outline-none"
                                />
                                <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">SEC</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1">Weight (kg)</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getWeightDraftOrValue(`${ex.id}:pyr:${stepIdx}:weight`, step.weight_kg)}
                            onChange={(e) => setDraftValue(`${ex.id}:pyr:${stepIdx}:weight`, e.target.value)}
                            onBlur={() => commitPyramidStepWeight(ex.id, stepIdx, `${ex.id}:pyr:${stepIdx}:weight`, step.weight_kg)}
                            onFocus={onNumberFocus}
                            placeholder="body Weight"
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none"
                          />
                        </div>
                        {ex.pyramid_steps && ex.pyramid_steps.length > 1 && (
                          <button
                            onClick={() => removePyramidStep(ex.id, stepIdx)}
                            className="absolute right-2 top-2 text-red-500/50 hover:text-red-500 p-1"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}

                    <button
                      onClick={() => addPyramidStep(ex.id)}
                      className="w-full mt-1 py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> ADD PYRAMID STEP
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                      <button
                        onClick={() => updateExercise(ex.id, 'type', 'reps')}
                        className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${ex.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                      >
                        REPS
                      </button>
                      <button
                        onClick={() => updateExercise(ex.id, 'type', 'isometry')}
                        className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${ex.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                      >
                        ISOMETRIC
                      </button>
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Exercise Name (e.g. Bench Press)"
                        value={ex.name}
                        onChange={(e) => updateExercise(ex.id, 'name', e.target.value)}
                        className="w-full bg-black/30 border border-brand-grey/20 rounded-xl px-4 py-3 text-white font-semibold focus:border-brand-orange focus:outline-none transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1 ml-1">
                        Exercise Note (optional)
                      </label>
                      <textarea
                        rows={2}
                        value={ex.instruction_note || ''}
                        onChange={(e) => updateExercise(ex.id, 'instruction_note', e.target.value)}
                        placeholder="E.g. fermo a braccia stese"
                        className="w-full bg-black/30 border border-brand-grey/20 rounded-xl px-4 py-3 text-white text-sm focus:border-brand-orange focus:outline-none transition-colors resize-none"
                      />
                    </div>
                  </>
                )}

                {/* Dati Generici (Serie e Recupero) */}
                {ex.type !== 'pyramid' && (
                <div className={`grid ${ex.type === 'superset' || ex.type === 'emom' ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'} gap-3`}>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1">
                      Sets
                    </label>
                    <input
                      type="number" inputMode="numeric"
                      min="1"
                      value={getDraftOrValue(`${ex.id}:sets`, ex.sets)}
                      onChange={(e) => setDraftValue(`${ex.id}:sets`, e.target.value)}
                      onBlur={() => commitExerciseNumber(ex.id, 'sets', `${ex.id}:sets`, 1, 1)}
                      onFocus={onNumberFocus}
                      className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-white focus:border-brand-orange focus:outline-none transition-colors"
                    />
                  </div>

                  {ex.type !== 'superset' && ex.type !== 'emom' && (
                    <div className="flex flex-col">
                      <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1">
                        {ex.type === 'reps' ? 'Reps' : 'Time (sec)'}
                      </label>
                      <input
                        type="text" inputMode="numeric"
                        value={getDraftOrValue(`${ex.id}:${ex.type === 'reps' ? 'reps' : 'duration_seconds'}`, ex.type === 'reps' ? ex.reps : ex.duration_seconds, true)}
                        onChange={(e) => setDraftValue(`${ex.id}:${ex.type === 'reps' ? 'reps' : 'duration_seconds'}`, e.target.value)}
                        onBlur={() => commitExerciseNumber(ex.id, ex.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:${ex.type === 'reps' ? 'reps' : 'duration_seconds'}`, 0, 0)}
                        onFocus={onNumberFocus}
                        placeholder={ex.type === 'reps' ? 'MAX REPS' : 'MAX TIME'}
                        className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-white focus:border-brand-orange focus:outline-none transition-colors placeholder:text-brand-orange/60 placeholder:text-xs"
                      />
                    </div>
                  )}

                  {ex.type !== 'superset' && ex.type !== 'emom' && (
                    <div className="flex flex-col">
                      <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1">
                        Weight (kg)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={getWeightDraftOrValue(`${ex.id}:weight`, ex.weight_kg)}
                        onChange={(e) => setDraftValue(`${ex.id}:weight`, e.target.value)}
                        onBlur={() => commitExerciseWeight(ex.id, `${ex.id}:weight`, ex.weight_kg)}
                        onFocus={onNumberFocus}
                        placeholder="body Weight"
                        className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-white focus:border-brand-orange focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  <div className="flex flex-col relative">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 flex items-center">
                      <Clock size={10} className="mr-1" />
                      Rest
                    </label>
                    <div className="flex bg-black/40 border border-brand-grey/10 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[46px]">
                      <div className="flex flex-col items-center justify-center w-1/2 border-r border-brand-grey/10 relative">
                        <input
                          type="number" inputMode="numeric"
                          min="0"
                          value={getDraftOrValue(`${ex.id}:rest:min`, Math.floor(ex.rest_seconds / 60))}
                          onChange={(e) => setDraftValue(`${ex.id}:rest:min`, e.target.value)}
                          onBlur={() => commitRestPart(ex.id, 'min', `${ex.id}:rest:min`, ex.rest_seconds)}
                          onFocus={onNumberFocus}
                          className="w-full h-full bg-transparent pt-3 pb-1 pl-4 text-center text-brand-orange font-bold text-lg focus:outline-none"
                        />
                        <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">MIN</span>
                      </div>
                      <div className="flex flex-col items-center justify-center w-1/2 relative">
                        <input
                          type="number" inputMode="numeric"
                          min="0"
                          max="59"
                          value={getDraftOrValue(`${ex.id}:rest:sec`, ex.rest_seconds % 60)}
                          onChange={(e) => setDraftValue(`${ex.id}:rest:sec`, e.target.value)}
                          onBlur={() => commitRestPart(ex.id, 'sec', `${ex.id}:rest:sec`, ex.rest_seconds)}
                          onFocus={onNumberFocus}
                          className="w-full h-full bg-transparent pt-3 pb-1 pl-4 text-center text-brand-orange font-bold text-lg focus:outline-none"
                        />
                        <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">SEC</span>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {ex.type !== 'superset' && ex.type !== 'emom' && ex.type !== 'pyramid' && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      onClick={() => convertToSuperset(ex.id)}
                      className="py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> CREATE SUPERSET
                    </button>
                    <button
                      onClick={() => convertToEmom(ex.id)}
                      className="py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> CREATE EMOM
                    </button>
                    <button
                      onClick={() => convertToPyramid(ex.id)}
                      className="py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> CREATE PYRAMID
                    </button>
                  </div>
                )}
              </div>

              {index < exercises.length - 1 && (
                <div className="relative -mt-1 mb-1 px-1">
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-brand-grey/25" />

                  <div className="relative flex justify-center">
                    <button
                      onClick={() => setEditingTransitionForExerciseId((prev) => (prev === ex.id ? null : ex.id))}
                      className="inline-flex items-center gap-2 rounded-full border border-brand-orange/30 bg-brand-dark px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-brand-orange hover:border-brand-orange/60 hover:text-brand-lightOrange transition-colors"
                    >
                      <Clock size={12} />
                      {(ex.transition_rest_seconds || 0) > 0
                        ? `Rest between exercises: ${formatTransitionRest(ex.transition_rest_seconds)}`
                        : 'Add rest between exercises'}
                    </button>
                  </div>

                  {editingTransitionForExerciseId === ex.id && (
                    <div className="relative mt-2 bg-brand-darkGrey/30 border border-brand-grey/20 rounded-xl px-3 py-3">
                      <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold mb-2">
                        Recovery between exercise {index + 1} and {index + 2}
                      </p>

                      <div className="flex bg-black/40 border border-brand-grey/10 rounded-lg overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                        <div className="flex flex-col items-center justify-center w-1/2 border-r border-brand-grey/10 relative">
                          <input
                            type="number" inputMode="numeric"
                            min="0"
                            value={getDraftOrValue(`${ex.id}:transition_rest:min`, Math.floor((ex.transition_rest_seconds || 0) / 60))}
                            onChange={(e) => setDraftValue(`${ex.id}:transition_rest:min`, e.target.value)}
                            onBlur={() => commitTransitionRestPart(ex.id, 'min', `${ex.id}:transition_rest:min`, ex.transition_rest_seconds || 0)}
                            onFocus={onNumberFocus}
                            className="w-full h-full bg-transparent pt-3 pb-1 pl-4 text-center text-brand-orange font-bold text-base focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">MIN</span>
                        </div>
                        <div className="flex flex-col items-center justify-center w-1/2 relative">
                          <input
                            type="number" inputMode="numeric"
                            min="0"
                            max="59"
                            value={getDraftOrValue(`${ex.id}:transition_rest:sec`, (ex.transition_rest_seconds || 0) % 60)}
                            onChange={(e) => setDraftValue(`${ex.id}:transition_rest:sec`, e.target.value)}
                            onBlur={() => commitTransitionRestPart(ex.id, 'sec', `${ex.id}:transition_rest:sec`, ex.transition_rest_seconds || 0)}
                            onFocus={onNumberFocus}
                            className="w-full h-full bg-transparent pt-3 pb-1 pl-4 text-center text-brand-orange font-bold text-base focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-1.5 font-bold tracking-wider pointer-events-none">SEC</span>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          onClick={() => {
                            updateExercise(ex.id, 'transition_rest_seconds', 0);
                            clearDraftValue(`${ex.id}:transition_rest:min`);
                            clearDraftValue(`${ex.id}:transition_rest:sec`);
                            setEditingTransitionForExerciseId(null);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-xs font-bold"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => setEditingTransitionForExerciseId(null)}
                          className="px-3 py-1.5 rounded-lg bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-xs font-black"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </React.Fragment>
            ))
          )}

          <div className="flex flex-col space-y-3 pt-2">
            <button
              onClick={addExercise}
              className="w-full text-brand-orange hover:text-brand-lightOrange flex items-center justify-center text-sm font-bold bg-brand-orange/10 hover:bg-brand-orange/20 px-4 py-3 rounded-xl transition-colors border border-brand-orange/20 border-dashed"
            >
              <Plus size={20} className="mr-1" />
              EXERCISE
            </button>
          </div>
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
      </main>
    </div>
  );
};

export default NewTrainPage;
