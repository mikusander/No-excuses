/**
 * ActiveWorkoutPage.tsx — Il cuore dell'app: esecuzione guidata di un workout.
 *
 * È la pagina più grande e complessa (~4500 righe). Guida l'utente attraverso
 * ogni esercizio, serie e riposo di un workout, con timer, feedback vocale,
 * conteggio automatico delle reps e salvataggio dello stato su DB.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * DUE MODALITÀ DI APERTURA (params URL)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - `/active-workout/:id`
 *    Workout nuovo da una scheda (id = id_scheda).
 *    Carica gli esercizi dalla scheda Supabase.
 *
 *  - `/active-workout-history/:workoutRunId`
 *    Riesecuzione di un workout già completato (id = id_workout).
 *    Carica gli esercizi dallo snapshot JSON salvato nel `workout_run`.
 *    Se lo snapshot non è disponibile, ricade sulla scheda collegata.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * STATE MACHINE DEGLI ESERCIZI
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * La progressione è determinata da questi indici:
 *  - `currentExerciseIdx`     : indice nell'array degli esercizi
 *  - `currentSetIdx`          : indice della serie corrente
 *  - `currentSubExerciseIdx`  : indice del sub-esercizio (superset / EMOM)
 *  - `currentPyramidStepIdx`  : indice dello step della piramide
 *  - `currentEmomRoundIdx`    : indice del round EMOM
 *
 * Flags di avanzamento pendente:
 *  - `pendingPyramidAdvance`  : true quando si aspetta conferma per passare
 *                               al prossimo step della piramide (dopo il riposo)
 *  - `pendingExerciseAdvance` : true quando si aspetta conferma per passare
 *                               al prossimo esercizio (dopo il riposo di transizione)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TIMER (riposo, isometria, EMOM)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Tutti i timer usano la tecnica "deadline-based":
 *   `endsAtMs = Date.now() + durationMs`
 * In ogni tick dell'effect, si calcola `remaining = endsAtMs - Date.now()`.
 * Questo rende i timer robusti ai rallentamenti del browser (tab in background,
 * GC pauses, ecc.) perché non si accumulano errori nel tempo.
 *
 * I ref `lastHandledRestCompletionEndsAtMsRef` e `lastHandledEmomCompletionEndsAtMsRef`
 * garantiscono che lo stesso timestamp di scadenza sia gestito una sola volta,
 * evitando doppi avanzamenti anche se l'effect scatta più volte.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * FEEDBACK VOCALE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Usa `utils/voice.ts` per annunciare:
 *  - Countdown del riposo (ultimi N secondi)
 *  - Nome dell'esercizio successivo
 *  - Conteggio delle reps (se contatore automatico attivo)
 *  - Messaggi di completamento serie / workout
 *
 * Comandi vocali (Web Speech API riconoscimento): "next", "back", "skip", ecc.
 * Gestiti tramite `handleVoiceNextRef`, `handleVoicePrevRef`, `handleVoiceNextExerciseRef`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CONTEGGIO AUTOMATICO REPS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Per gli esercizi con `auto_count_type` (pushups/pullups) è possibile aprire
 * il modal auto-count che porta a RepCounterPage.
 * Il conteggio avviene in RepCounterPage e il risultato viene passato indietro
 * tramite `location.state` al ritorno.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CHECKPOINT PERSISTENCE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Ogni secondo (throttled a `WORKOUT_PROGRESS_THROTTLE_MS = 1000ms`) lo stato
 * corrente viene serializzato e salvato nel localStorage via `workoutProgressStorage`.
 * In caso di chiusura accidentale, la HomePage rileva il checkpoint e propone
 * di riprendere il workout da dove si era interrotto.
 *
 * Il payload salvato (`PersistedWorkoutProgressState`) include tutti gli indici
 * di progressione, lo stato dei timer (remainingMs), e le note degli esercizi.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SALVATAGGIO RISULTATI SU DB
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Al completamento del workout:
 *  1. Viene inserita una riga in `workout_run` (con snapshot nome + durata + esercizi)
 *  2. Vengono inserite le note degli esercizi in `note_workout` (formato tagged)
 *  3. Il checkpoint nel localStorage viene cancellato
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MODIFICA ESERCIZIO IN-WORKOUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Un modal "Edit exercise" permette di modificare al volo i parametri
 * (serie, reps, peso, riposo) dell'esercizio corrente senza interrompere il workout.
 * La modifica aggiorna sia lo state locale che il record Supabase (se la scheda esiste).
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Play, Pause, SkipForward, ArrowRight, ArrowLeft as ArrowPrev, Timer, Clock, CheckCircle2, Mic, MicOff, FileText, X, SlidersHorizontal, Info, Video, Smartphone, Layers, Flame, Pencil, ChevronDown } from 'lucide-react';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import { warmupSpeechSynthesis } from '../utils/voice';
import {
  playGoalReachedSound,
  playCountdownBeep,
  playRestFinishedSound,
  unlockAudio,
  isAudioFeedbackEnabled,
} from '../utils/audio';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { pipManager } from '../utils/pipManager';
import { requestScreenWakeLock, releaseScreenWakeLock } from '../utils/wakeLock';
import {
  initServiceWorker,
  scheduleBackgroundRestNotification,
  closeActiveRestNotifications,
  sendRestFinishedNotification,
  ensureNativeNotificationPermission,
  addNotificationActionListener,
  isNativeApp,
} from '../utils/workoutNotifications';
import {
  updateRestMediaSession,
  stopRestMediaSession,
} from '../utils/workoutMediaSession';
import {
  buildWorkoutProgressStorageKey,
  clearAllWorkoutProgressCheckpoints,
  clearWorkoutProgressCheckpointByIdentity,
  pruneWorkoutProgressCheckpoints,
  notifyWorkoutProgressChanged,
  WORKOUT_PROGRESS_MAX_AGE_MS,
  type WorkoutProgressIdentity,
} from '../lib/workoutProgressStorage';
import { WorkoutCelebrationModal } from '../components/WorkoutCelebrationModal';
import {
  lockAppToPortrait,
  unlockAppForWorkout,
  useIsLandscape,
} from '../utils/orientationManager';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'cardio' | 'superset' | 'circuit' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string | null;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  lap_durations_seconds?: number[];
  total_circuit_duration_seconds?: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: { reps: number; rest_seconds: number; weight_kg?: number | null }[];
  order_index: number;
  completed_sets_records?: (number | null)[];
  completed_sets_reps?: (number | null)[];
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry' | 'cardio';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
    instruction_note?: string | null;
  }[];
}

interface Workout {
  id: string;
  name: string;
  exercises: Exercise[];
}

interface ExerciseNoteEntry {
  exerciseName: string;
  note: string;
}

interface NoteModalContext {
  key: string;
  name: string;
  exerciseIndex?: number;
  exercise?: Exercise;
}

interface InstructionModalItem {
  name: string;
  note: string;
}
interface InstructionModalContext {
  exerciseName: string;
  note: string | null;
  items: InstructionModalItem[];
}

interface ExerciseEditDraft {
  sets: string;
  restSeconds: string;
  reps: string;
  durationSeconds: string;
  weightKg: string;
  emomRounds: string;
  emomRoundDuration: string;
  currentSubReps: string;
  currentSubDuration: string;
  currentSubWeightKg: string;
  currentStepReps: string;
  currentStepRestSeconds: string;
  currentStepWeightKg: string;
  subExerciseDrafts: Array<{
    name: string;
    type: 'reps' | 'isometry' | 'cardio';
    reps: string;
    durationSeconds: string;
    weightKg: string;
  }>;
  pyramidStepDrafts: Array<{
    reps: string;
    restSeconds: string;
    weightKg: string;
  }>;
}

interface PersistedWorkoutProgressState {
  currentExerciseIdx: number;
  currentSetIdx: number;
  currentSubExerciseIdx: number;
  currentPyramidStepIdx: number;
  currentEmomRoundIdx: number;
  pendingPyramidAdvance: boolean;
  pendingExerciseAdvance: boolean;
  isResting: boolean;
  restWasRunning: boolean;
  restRemaining: number;
  restInitialDuration: number;
  isometryWasRunning: boolean;
  isometryRemaining: number;
  emomWasRunning: boolean;
  emomRoundRemaining: number;
  circuitStopwatchElapsed?: number;
  circuitStopwatchRunning?: boolean;
  circuitLapTimes?: number[];
  exerciseNotesByKey: Record<string, ExerciseNoteEntry>;
  workoutGeneralNote?: string;
  workoutStartedAtMs: number | null;
  workoutElapsedSeconds?: number;
  workoutName?: string;
  currentExerciseName?: string;
  totalSets?: number;
  recordedMaxPerformance?: Record<string, Record<number, number>>;
}

interface PersistedWorkoutProgressPayload {
  version: 1;
  savedAtMs: number;
  state: PersistedWorkoutProgressState;
}

const WORKOUT_PROGRESS_THROTTLE_MS = 1000;

const toSafeSnapshotNumber = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toSnapshotExercises = (raw: unknown): Exercise[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, idx) => {
      const item = entry as Record<string, unknown>;
      const typeRaw = String(item.type || 'reps').toLowerCase();
      const type: Exercise['type'] =
        typeRaw === 'isometry' || typeRaw === 'cardio' || typeRaw === 'superset' || typeRaw === 'circuit' || typeRaw === 'emom' || typeRaw === 'pyramid'
          ? (typeRaw as Exercise['type'])
          : 'reps';

      const subExercises = Array.isArray(item.subExercises)
        ? (item.subExercises as Array<Record<string, unknown>>).map((sub) => {
          const subTypeRaw = String(sub.type || 'reps').toLowerCase();
          const subType: 'reps' | 'isometry' | 'cardio' =
            subTypeRaw === 'cardio' ? 'cardio' : (subTypeRaw === 'isometry' ? 'isometry' : 'reps');
          return {
            name: String(sub.name || ''),
            type: subType,
            reps: Math.max(0, Math.trunc(toSafeSnapshotNumber(sub.reps, 0))),
            duration_seconds: Math.max(0, Math.trunc(toSafeSnapshotNumber(sub.duration_seconds, 0))),
            weight_kg: Number.isFinite(Number(sub.weight_kg)) ? Number(sub.weight_kg) : null,
            instruction_note: String(sub.instruction_note || '').trim() || null,
          };
        })
        : undefined;

      const pyramidSteps = Array.isArray(item.pyramid_steps)
        ? (item.pyramid_steps as Array<Record<string, unknown>>).map((step) => ({
          reps: Math.max(0, Math.trunc(toSafeSnapshotNumber(step.reps, 0))),
          rest_seconds: Math.max(0, Math.trunc(toSafeSnapshotNumber(step.rest_seconds, 0))),
          weight_kg: Number.isFinite(Number(step.weight_kg)) ? Number(step.weight_kg) : null,
        }))
        : undefined;

      return {
        id: String(item.id || `snapshot-${idx}`),
        type,
        name: String(item.name || `Exercise ${idx + 1}`),
        instruction_note: String(item.instruction_note || '').trim() || null,
        auto_count_type: (item as any).auto_count_type || null,
        sets: Math.max(1, Math.trunc(toSafeSnapshotNumber(item.sets, 1))),
        reps: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.reps, 0))),
        duration_seconds: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.duration_seconds, 0))),
        rest_seconds: type === 'circuit' && toSafeSnapshotNumber(item.rest_seconds, 0) <= 0 ? 60 : Math.max(0, Math.trunc(toSafeSnapshotNumber(item.rest_seconds, 0))),
        transition_rest_seconds: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.transition_rest_seconds, 0))),
        weight_kg: Number.isFinite(Number(item.weight_kg)) ? Number(item.weight_kg) : null,
        lap_durations_seconds: Array.isArray(item.lap_durations_seconds)
          ? (item.lap_durations_seconds as unknown[]).map(v => Math.max(0, Math.trunc(toSafeSnapshotNumber(v, 0))))
          : undefined,
        total_circuit_duration_seconds: item.total_circuit_duration_seconds == null
          ? undefined
          : Math.max(0, Math.trunc(toSafeSnapshotNumber(item.total_circuit_duration_seconds, 0))),
        order_index: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.order_index, idx))),
        emom_rounds:
          item.emom_rounds != null && toSafeSnapshotNumber(item.emom_rounds, 0) > 0
            ? Math.max(1, Math.trunc(toSafeSnapshotNumber(item.emom_rounds, 1)))
            : (type === 'emom' && item.sets ? Math.max(1, Math.trunc(toSafeSnapshotNumber(item.sets, 1))) : undefined),
        emom_round_duration:
          item.emom_round_duration == null
            ? (type === 'emom' ? 60 : undefined)
            : Math.max(1, Math.trunc(toSafeSnapshotNumber(item.emom_round_duration, 1))),
        pyramid_steps: pyramidSteps,
        subExercises,
      } satisfies Exercise;
    })
    .sort((a, b) => a.order_index - b.order_index);
};

const formatTime = (secs: number) => {
  const normalized = Math.max(0, Math.trunc(Number(secs) || 0));
  const m = Math.floor(normalized / 60);
  const s = normalized % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getEffectiveEmomRounds = (ex?: Exercise | null): number => {
  if (!ex) return 1;
  const rawRounds = ex.emom_rounds != null && ex.emom_rounds > 0
    ? ex.emom_rounds
    : (ex.sets != null && ex.sets > 0 ? ex.sets : 1);
  return Math.max(1, rawRounds);
};

const normalizeDurationSeconds = (value: unknown): number => {
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized) || normalized < 0) return 0;
  return normalized;
};

const getTargetIsometry = (ex?: Exercise | null, subEx?: any): number => {
  if (!ex) return 0;
  if ((ex.type === 'superset' || ex.type === 'circuit') && (subEx?.type === 'isometry' || subEx?.type === 'cardio')) {
    return Math.max(0, normalizeDurationSeconds(subEx.duration_seconds));
  }
  if (ex.type === 'isometry' || ex.type === 'cardio') {
    return Math.max(0, normalizeDurationSeconds(ex.duration_seconds));
  }
  return 0;
};

const ActiveWorkoutPage: React.FC = () => {
  const VOICE_ASSIST_KEY = 'voice_assistance_enabled';
  const { id, workoutRunId } = useParams<{ id?: string; workoutRunId?: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Gestione orientamento: l'app ruota automaticamente in landscape quando il dispositivo viene fisicamente girato di 90°
  const isLandscape = useIsLandscape();

  useEffect(() => {
    // Sblocca la rotazione in orizzontale durante il workout attivo
    void unlockAppForWorkout();
    return () => {
      // Blocca rigorosamente in verticale all'uscita dal workout
      void lockAppToPortrait();
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [sourceSchedaId, setSourceSchedaId] = useState<number | null>(null);

  // App State
  const [currentExerciseIdx, setCurrentExerciseIdx] = useState(0);
  const [currentSetIdx, setCurrentSetIdx] = useState(0);
  const [currentSubExerciseIdx, setCurrentSubExerciseIdx] = useState(0);
  const [currentPyramidStepIdx, setCurrentPyramidStepIdx] = useState(0);
  const [pendingPyramidAdvance, setPendingPyramidAdvance] = useState(false);
  const [pendingExerciseAdvance, setPendingExerciseAdvance] = useState(false);

  // Timer State for Rest
  const [isResting, setIsResting] = useState(false);
  const [restRemaining, setRestRemaining] = useState(0);
  const [restInitialDuration, setRestInitialDuration] = useState(0);
  const [restEndsAtMs, setRestEndsAtMs] = useState<number | null>(null);

  // Timer State for Isometry
  const [isometryActive, setIsometryActive] = useState(false);
  const [isometryRemaining, setIsometryRemaining] = useState(0);
  const [isometryEndsAtMs, setIsometryEndsAtMs] = useState<number | null>(null);
  const [supersetIsometrySubIdx, setSupersetIsometrySubIdx] = useState<number | null>(null);

  // Tracciamento prestazioni a sfinimento (MAX) per set
  const [recordedMaxPerformance, setRecordedMaxPerformance] = useState<Record<string, Record<number, number>>>({});
  const recordedMaxPerformanceRef = useRef<Record<string, Record<number, number>>>({});
  recordedMaxPerformanceRef.current = recordedMaxPerformance;

  const [isMaxPromptModalOpen, setIsMaxPromptModalOpen] = useState(false);
  const [targetEditingSetIdx, setTargetEditingSetIdx] = useState<number>(0);
  const [modalPerformanceValue, setModalPerformanceValue] = useState<number>(0);
  const isPendingSetAdvanceRef = useRef(false);

  // Stopwatch per isometria MAX (conteggio in avanti)
  const [isometryStopwatchActive, setIsometryStopwatchActive] = useState(false);
  const [isometryElapsedSeconds, setIsometryElapsedSeconds] = useState(0);
  const isometryStopwatchStartMsRef = useRef<number | null>(null);

  // Timer State for EMOM
  const [emomActive, setEmomActive] = useState(false);
  const [emomRoundRemaining, setEmomRoundRemaining] = useState(0);
  const [emomRoundEndsAtMs, setEmomRoundEndsAtMs] = useState<number | null>(null);
  const [currentEmomRoundIdx, setCurrentEmomRoundIdx] = useState(0);

  // Timer State for Circuit Stopwatch
  const [circuitStopwatchElapsed, setCircuitStopwatchElapsed] = useState(0);
  const [isCircuitStopwatchRunning, setIsCircuitStopwatchRunning] = useState(false);
  const [circuitLapTimes, setCircuitLapTimes] = useState<number[]>([]);
  const circuitStopwatchStartedAtMsRef = useRef<number | null>(null);
  const circuitAccumulatedMsRef = useRef(0);
  const pyramidScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activePyramidStepRef = useRef<HTMLButtonElement | null>(null);

  const wasRestingRef = useRef(false);
  const wasEmomActiveRef = useRef(false);
  const wasIsometryActiveRef = useRef(false);
  const lastCountdownRestRef = useRef<number | null>(null);
  const lastCountdownEmomRef = useRef<number | null>(null);
  const lastCountdownIsometryRef = useRef<number | null>(null);
  const workoutRunSavedRef = useRef(false);
  const workoutRunIdRef = useRef<number | null>(null);
  const workoutNotesSavedRef = useRef(false);
  const workoutCompletionHandledRef = useRef(false);
  const workoutStartedAtMsRef = useRef<number | null>(null);
  const workoutElapsedSecondsRef = useRef<number>(0);
  const sessionForegroundStartedAtMsRef = useRef<number | null>(null);

  const getCurrentWorkoutElapsedSeconds = useCallback((): number => {
    let elapsed = workoutElapsedSecondsRef.current;
    if (sessionForegroundStartedAtMsRef.current != null) {
      const activeForegroundSegment = Math.max(0, Math.trunc((Date.now() - sessionForegroundStartedAtMsRef.current) / 1000));
      elapsed += activeForegroundSegment;
    }
    return Math.max(0, elapsed);
  }, []);

  const freezeForegroundWorkoutTime = useCallback(() => {
    if (sessionForegroundStartedAtMsRef.current != null) {
      const activeForegroundSegment = Math.max(0, Math.trunc((Date.now() - sessionForegroundStartedAtMsRef.current) / 1000));
      workoutElapsedSecondsRef.current += activeForegroundSegment;
      sessionForegroundStartedAtMsRef.current = null;
    }
  }, []);

  const unfreezeForegroundWorkoutTime = useCallback(() => {
    if (sessionForegroundStartedAtMsRef.current == null) {
      sessionForegroundStartedAtMsRef.current = Date.now();
    }
  }, []);
  const lastProgressPersistAtMsRef = useRef(0);
  const persistWorkoutProgressRef = useRef<((force?: boolean) => void) | null>(null);
  const suppressProgressPersistenceRef = useRef(false);
  const lastHandledRestCompletionEndsAtMsRef = useRef<number | null>(null);
  const lastHandledEmomCompletionEndsAtMsRef = useRef<number | null>(null);

  const handlePrimaryActionRef = useRef<() => void>(undefined);

  // Voice Command State
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [voiceAssistanceEnabled, setVoiceAssistanceEnabled] = useState(true);
  const [exerciseNotesByKey, setExerciseNotesByKey] = useState<Record<string, ExerciseNoteEntry>>({});
  const exerciseNotesByKeyRef = useRef<Record<string, ExerciseNoteEntry>>(exerciseNotesByKey);
  exerciseNotesByKeyRef.current = exerciseNotesByKey;
  const [workoutGeneralNote, setWorkoutGeneralNote] = useState<string>('');
  const workoutGeneralNoteRef = useRef<string>(workoutGeneralNote);
  workoutGeneralNoteRef.current = workoutGeneralNote;

  const getExerciseNoteEntry = useCallback((exIdx: number, ex?: Exercise): ExerciseNoteEntry | undefined => {
    if (!ex) return undefined;
    const notes = exerciseNotesByKeyRef.current || exerciseNotesByKey;

    // 1. Per ID esercizio primario (univoco per singola esecuzione)
    const primaryKey = String(ex.id);
    if (notes[primaryKey]?.note?.trim()) return notes[primaryKey];

    // 2. Per indice posizionale (univoco per la posizione nella scheda)
    const idxKey = `idx_${exIdx}`;
    if (notes[idxKey]?.note?.trim()) return notes[idxKey];

    // 3. Per numero d'ordine
    const orderKey = `order_${ex.order_index ?? exIdx + 1}`;
    if (notes[orderKey]?.note?.trim()) return notes[orderKey];

    // 4. Ricerca per prefisso d'ordine "X. " nel nome memorizzato (es. "1. Plank" vs "4. Plank")
    const orderPrefix = `${exIdx + 1}.`;
    for (const [k, entry] of Object.entries(notes)) {
      if (!entry?.note?.trim()) continue;
      if (k.startsWith('idx_') && k !== idxKey) continue;
      if (k.startsWith('order_') && k !== orderKey) continue;
      const entryName = (entry.exerciseName || '').trim().toLowerCase();
      if (entryName.startsWith(orderPrefix)) {
        return entry;
      }
    }

    // 5. Fallback per nome SOLO se il nome dell'esercizio è strettamente UNIVOCO nella scheda
    const cleanName = (ex.name || '').trim().toLowerCase();
    if (cleanName && workout?.exercises) {
      const countWithName = workout.exercises.filter(
        (item) => (item.name || '').trim().toLowerCase() === cleanName
      ).length;
      if (countWithName === 1) {
        const nameKey = `name_${cleanName}`;
        if (notes[nameKey]?.note?.trim()) return notes[nameKey];
        for (const [k, entry] of Object.entries(notes)) {
          if (!entry?.note?.trim()) continue;
          if (k.startsWith('idx_') && k !== idxKey) continue;
          if (k.startsWith('order_') && k !== orderKey) continue;
          const entryName = (entry.exerciseName || '').trim().toLowerCase();
          if (entryName.includes(cleanName)) {
            return entry;
          }
        }
      }
    }

    return undefined;
  }, [exerciseNotesByKey, workout?.exercises]);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteModalDraft, setNoteModalDraft] = useState('');
  const [noteModalContext, setNoteModalContext] = useState<NoteModalContext | null>(null);
  const [isEditingGeneralNoteInOverview, setIsEditingGeneralNoteInOverview] = useState(false);
  const [overviewGeneralNoteDraft, setOverviewGeneralNoteDraft] = useState('');
  const [isCelebrationOpen, setIsCelebrationOpen] = useState(false);
  const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
  const [instructionModalContext, setInstructionModalContext] = useState<InstructionModalContext | null>(null);
  const [isWorkoutOverviewModalOpen, setIsWorkoutOverviewModalOpen] = useState(false);
  const [isWorkoutOverviewAdvancePending, setIsWorkoutOverviewAdvancePending] = useState(false);
  const [isAutoCountModalOpen, setIsAutoCountModalOpen] = useState(false);
  const [isEditExerciseModalOpen, setIsEditExerciseModalOpen] = useState(false);
  const [editingExerciseIdx, setEditingExerciseIdx] = useState<number | null>(null);
  const [exerciseEditDraft, setExerciseEditDraft] = useState<ExerciseEditDraft>({
    sets: '',
    restSeconds: '',
    reps: '',
    durationSeconds: '',
    weightKg: '',
    emomRounds: '',
    emomRoundDuration: '',
    currentSubReps: '',
    currentSubDuration: '',
    currentSubWeightKg: '',
    currentStepReps: '',
    currentStepRestSeconds: '',
    currentStepWeightKg: '',
    subExerciseDrafts: [],
    pyramidStepDrafts: [],
  });
  const [exerciseEditError, setExerciseEditError] = useState<string | null>(null);
  const [isSavingExerciseEdit, setIsSavingExerciseEdit] = useState(false);
  const [isVoiceHelpVisible, setIsVoiceHelpVisible] = useState(false);
  const handleVoiceNextRef = useRef<(() => void) | null>(null);
  const handleVoicePrevRef = useRef<(() => void) | null>(null);
  const handleVoiceNextExerciseRef = useRef<(() => void) | null>(null);
  const handleVoicePrevExerciseRef = useRef<(() => void) | null>(null);
  const handleVoiceEndWorkoutRef = useRef<(() => void) | null>(null);
  const handleVoiceStartTimerRef = useRef<(() => void) | null>(null);
  const handleVoiceStopTimerRef = useRef<(() => void) | null>(null);
  const handleVoiceResetTimerRef = useRef<(() => void) | null>(null);
  const handleVoiceSkipRestRef = useRef<(() => boolean) | null>(null);
  const timerLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerLongPressTriggeredRef = useRef(false);
  const voiceHelpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressSwipeNextExerciseVoiceCueRef = useRef(false);
  const SWIPE_MIN_DISTANCE_PX = 60;
  const SWIPE_MAX_VERTICAL_DRIFT_PX = 48;


  const openVoiceHelp = () => {
    setIsVoiceHelpVisible(true);
    if (voiceHelpTimeoutRef.current) {
      clearTimeout(voiceHelpTimeoutRef.current);
      voiceHelpTimeoutRef.current = null;
    }
    voiceHelpTimeoutRef.current = setTimeout(() => {
      setIsVoiceHelpVisible(false);
      voiceHelpTimeoutRef.current = null;
    }, 10000);
  };

  const closeVoiceHelp = () => {
    setIsVoiceHelpVisible(false);
    if (voiceHelpTimeoutRef.current) {
      clearTimeout(voiceHelpTimeoutRef.current);
      voiceHelpTimeoutRef.current = null;
    }
  };

  const handleVoiceButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const nextEnabled = !isVoiceEnabled;
    setIsVoiceEnabled(nextEnabled);
    if (nextEnabled) {
      openVoiceHelp();
    } else {
      closeVoiceHelp();
    }
  };

  const speakCue = (text: string) => {
    const isVoiceAssistantEnabled = localStorage.getItem('voice_assistance_enabled') !== 'false';
    if (!isVoiceAssistantEnabled || !voiceAssistanceEnabled) return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    synth.speak(utterance);
  };

  const computeRemainingFromEndsAt = (endsAtMs: number | null) => {
    if (endsAtMs == null) return 0;
    return Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
  };

  const buildSetAnnouncementCue = (exercise: Exercise, nextSetIdx: number, pyramidStepIdx?: number) => {
    const name = String(exercise.name || '').trim();
    const parts: string[] = [];
    if (name) parts.push(name);

    parts.push(`set ${nextSetIdx + 1}`);

    if (exercise.type === 'circuit') {
      return parts.join(', ');
    }

    if ((exercise.type === 'superset' || exercise.type === 'emom') && exercise.subExercises && exercise.subExercises.length > 0) {
      const subParts = exercise.subExercises.map((sub) => {
        const subName = String(sub.name || '').trim();
        const subInfo: string[] = [];
        if (subName) subInfo.push(subName);
        if (sub.type === 'isometry') {
          if (sub.duration_seconds > 0) subInfo.push(`${sub.duration_seconds} seconds`);
        } else {
          if (sub.reps > 0) subInfo.push(`${sub.reps} reps`);
        }
        if (sub.weight_kg != null && sub.weight_kg > 0) subInfo.push(`${sub.weight_kg} kilos`);
        return subInfo.join(', ');
      });
      parts.push(subParts.join('. '));
    } else if (exercise.type === 'pyramid' && exercise.pyramid_steps) {
      const stepIdx = pyramidStepIdx != null ? pyramidStepIdx : 0;
      const step = exercise.pyramid_steps[stepIdx];
      if (step) {
        if (step.reps > 0) parts.push(`${step.reps} reps`);
        if (step.weight_kg != null && step.weight_kg > 0) parts.push(`${step.weight_kg} kilos`);
      }
    } else {
      if (exercise.type === 'isometry') {
        if (exercise.duration_seconds > 0) parts.push(`${exercise.duration_seconds} seconds`);
      } else {
        if (exercise.reps > 0) parts.push(`${exercise.reps} reps`);
      }
      if (exercise.weight_kg != null && exercise.weight_kg > 0) parts.push(`${exercise.weight_kg} kilos`);
    }

    return parts.join(', ');
  };

  const getUpcomingRestTargetInfo = useCallback(
    (overridePendingAdvance?: boolean) => {
      if (!workout) return { nextExerciseName: 'Prossimo Esercizio', nextSetInfo: '' };

      const currentEx = workout.exercises[currentExerciseIdx];
      if (!currentEx) return { nextExerciseName: 'Prossimo Esercizio', nextSetInfo: '' };

      // Controlla se siamo all'ultimo set dell'esercizio corrente
      const isLastSetOfCurrent =
        currentEx.type === 'pyramid'
          ? currentPyramidStepIdx >= (currentEx.pyramid_steps?.length || 1) - 1
          : currentEx.type === 'emom'
            ? currentEmomRoundIdx >= getEffectiveEmomRounds(currentEx) - 1
            : currentSetIdx >= (currentEx.sets || 1) - 1;

      // Se stiamo passando al prossimo esercizio (per override esplicito, per pendingExerciseAdvance o perché era l'ultimo set)
      const isTransitioningToNext =
        overridePendingAdvance === true ||
        (overridePendingAdvance !== false && (pendingExerciseAdvance || isLastSetOfCurrent));

      if (isTransitioningToNext) {
        const nextEx = workout.exercises[currentExerciseIdx + 1];
        if (!nextEx) return { nextExerciseName: 'Fine Allenamento', nextSetInfo: '' };

        const name = String(nextEx.name || '').trim() || `Esercizio ${currentExerciseIdx + 2}`;
        const totalSets = nextEx.sets || 1;

        let setInfo = `Set 1 di ${totalSets}`;
        if (nextEx.type === 'circuit') {
          setInfo = `Giro 1 di ${totalSets}`;
        } else if (nextEx.type === 'superset') {
          setInfo = `Round 1 di ${totalSets}`;
        } else if (nextEx.type === 'emom') {
          const totalRounds = getEffectiveEmomRounds(nextEx);
          setInfo = `Round 1 di ${totalRounds}`;
        } else if (nextEx.type === 'pyramid') {
          const totalSteps = nextEx.pyramid_steps?.length || 1;
          const step = nextEx.pyramid_steps?.[0];
          const reps = step ? (step.reps > 0 ? `${step.reps} reps` : 'MAX reps') : '';
          setInfo = `Step 1 di ${totalSteps}${reps ? ` • ${reps}` : ''}`;
        }

        return { nextExerciseName: name, nextSetInfo: setInfo };
      }

      // Recupero tra step piramidali dello stesso esercizio
      if (currentEx.type === 'pyramid' && pendingPyramidAdvance) {
        const nextStepIdx = currentPyramidStepIdx + 1;
        const totalSteps = currentEx.pyramid_steps?.length || 1;
        const step = currentEx.pyramid_steps?.[nextStepIdx];
        const reps = step ? (step.reps > 0 ? `${step.reps} reps` : 'MAX reps') : '';
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Step ${nextStepIdx + 1} di ${totalSteps}${reps ? ` • ${reps}` : ''}`,
        };
      }

      // Recupero tra giri di circuito
      if (currentEx.type === 'circuit') {
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Giro ${currentSetIdx + 2} di ${currentEx.sets || 1}`,
        };
      }

      // Recupero tra round di superset
      if (currentEx.type === 'superset' && currentEx.subExercises) {
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Round ${currentSetIdx + 2} di ${currentEx.sets || 1}`,
        };
      }

      // Recupero tra round di EMOM
      if (currentEx.type === 'emom') {
        const totalRounds = getEffectiveEmomRounds(currentEx);
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Round ${currentEmomRoundIdx + 2} di ${totalRounds}`,
        };
      }

      // Recupero tra serie standard (reps, isometria)
      return {
        nextExerciseName: currentEx.name,
        nextSetInfo: `Set ${currentSetIdx + 2} di ${currentEx.sets || 1}`,
      };
    },
    [workout, pendingExerciseAdvance, currentExerciseIdx, pendingPyramidAdvance, currentPyramidStepIdx, currentSetIdx, currentEmomRoundIdx]
  );

  const startRestCountdown = (
    durationSeconds: number,
    customUpcoming?: { nextExerciseName: string; nextSetInfo: string }
  ) => {
    unlockAudio();
    void requestScreenWakeLock();
    const safe = normalizeDurationSeconds(durationSeconds);
    lastHandledRestCompletionEndsAtMsRef.current = null;
    setRestInitialDuration(safe);
    setRestRemaining(safe);
    const targetTime = Date.now() + (safe * 1000);
    setRestEndsAtMs(targetTime);
    setIsResting(true);

    const upcoming = customUpcoming || getUpcomingRestTargetInfo();
    scheduleBackgroundRestNotification({
      endsAtMs: targetTime,
      nextExerciseName: upcoming.nextExerciseName,
      nextSetInfo: upcoming.nextSetInfo,
    });
    void pipManager.openRestPiP({
      totalSeconds: safe,
      remainingSeconds: safe,
      nextExerciseName: upcoming.nextExerciseName,
      nextSetInfo: upcoming.nextSetInfo,
      onSkip: skipRest,
    }).catch(() => {});
  };

  const stopRestCountdown = (keepActiveNotifications = false) => {
    setIsResting(false);
    setRestEndsAtMs(null);
    stopRestMediaSession();
    pipManager.closePiP();
    if (!keepActiveNotifications) {
      closeActiveRestNotifications();
    }
  };

  const pauseRestCountdown = () => {
    closeActiveRestNotifications();
    setRestRemaining(computeRemainingFromEndsAt(restEndsAtMs));
    setRestEndsAtMs(null);
  };

  const resumeRestCountdown = () => {
    unlockAudio();
    void requestScreenWakeLock();
    const currentExerciseForRest = workout?.exercises[currentExerciseIdx];
    const fallbackRestDuration =
      pendingExerciseAdvance
        ? Math.max(0, Math.trunc(currentExerciseForRest?.transition_rest_seconds || 0))
        : currentExerciseForRest?.type === 'pyramid' && pendingPyramidAdvance
          ? Math.max(0, Math.trunc(currentExerciseForRest.pyramid_steps?.[currentPyramidStepIdx]?.rest_seconds || 0))
          : Math.max(0, Math.trunc(currentExerciseForRest?.rest_seconds || 0));

    const nextDuration = restRemaining > 0
      ? restRemaining
      : (restInitialDuration > 0 ? restInitialDuration : fallbackRestDuration);

    if (nextDuration <= 0) return;
    lastHandledRestCompletionEndsAtMsRef.current = null;
    setRestRemaining(nextDuration);
    const targetTime = Date.now() + (nextDuration * 1000);
    setRestEndsAtMs(targetTime);
    setIsResting(true);

    const upcoming = getUpcomingRestTargetInfo();
    scheduleBackgroundRestNotification({
      endsAtMs: targetTime,
      nextExerciseName: upcoming.nextExerciseName,
      nextSetInfo: upcoming.nextSetInfo,
    });
    void pipManager.openRestPiP({
      totalSeconds: restInitialDuration > 0 ? restInitialDuration : nextDuration,
      remainingSeconds: nextDuration,
      nextExerciseName: upcoming.nextExerciseName,
      nextSetInfo: upcoming.nextSetInfo,
      onSkip: skipRest,
    }).catch(() => {});
  };

  const handleTogglePiP = async () => {
    if (pipManager.isActive()) {
      pipManager.closePiP();
    } else {
      const upcoming = getUpcomingRestTargetInfo();
      const currentEx = workout?.exercises[currentExerciseIdx];
      const total = restInitialDuration > 0 ? restInitialDuration : (currentEx?.rest_seconds || 60);
      await pipManager.openRestPiP({
        totalSeconds: total,
        remainingSeconds: restRemaining,
        nextExerciseName: upcoming.nextExerciseName,
        nextSetInfo: upcoming.nextSetInfo,
        onSkip: skipRest,
      });
    }
  };

  const resetRestCountdown = () => {
    const currentExerciseForRest = workout?.exercises[currentExerciseIdx];
    const fallbackRestDuration =
      pendingExerciseAdvance
        ? Math.max(0, Math.trunc(currentExerciseForRest?.transition_rest_seconds || 0))
        : currentExerciseForRest?.type === 'pyramid' && pendingPyramidAdvance
          ? Math.max(0, Math.trunc(currentExerciseForRest.pyramid_steps?.[currentPyramidStepIdx]?.rest_seconds || 0))
          : Math.max(0, Math.trunc(currentExerciseForRest?.rest_seconds || 0));

    const targetDuration = restInitialDuration > 0 ? restInitialDuration : fallbackRestDuration;
    if (targetDuration <= 0) return;
    startRestCountdown(targetDuration);
  };

  const handleRestTimerTap = () => {
    if (restEndsAtMs != null) {
      pauseRestCountdown();
      return;
    }
    resumeRestCountdown();
  };

  const startEmomCountdown = (durationSeconds: number) => {
    const safe = Math.max(1, normalizeDurationSeconds(durationSeconds));
    lastHandledEmomCompletionEndsAtMsRef.current = null;
    setEmomRoundRemaining(safe);
    setEmomRoundEndsAtMs(Date.now() + (safe * 1000));
    setEmomActive(true);
  };

  const pauseEmomCountdown = () => {
    setEmomRoundRemaining(computeRemainingFromEndsAt(emomRoundEndsAtMs));
    setEmomRoundEndsAtMs(null);
    setEmomActive(false);
  };

  const stopEmomCountdown = () => {
    setEmomRoundEndsAtMs(null);
    setEmomActive(false);
  };

  const setEmomRoundRemainingWithSync = (nextSeconds: number) => {
    const safe = Math.max(0, normalizeDurationSeconds(nextSeconds));
    setEmomRoundRemaining(safe);
    if (emomActive) {
      if (safe > 0) {
        setEmomRoundEndsAtMs(Date.now() + (safe * 1000));
      } else {
        setEmomRoundEndsAtMs(null);
        setEmomActive(false);
      }
    }
  };

  const resetEmomCountdown = () => {
    const currentExerciseForEmom = workout?.exercises[currentExerciseIdx];
    const defaultDuration = currentExerciseForEmom?.type === 'emom'
      ? (currentExerciseForEmom.emom_round_duration || 60)
      : 60;
    setEmomRoundRemainingWithSync(defaultDuration);
  };

  const startIsometryCountdown = (durationSeconds: number) => {
    const safe = Math.max(1, normalizeDurationSeconds(durationSeconds));
    setIsometryRemaining(safe);
    setIsometryEndsAtMs(Date.now() + (safe * 1000));
    setIsometryActive(true);
  };

  const pauseIsometryCountdown = () => {
    setIsometryRemaining(computeRemainingFromEndsAt(isometryEndsAtMs));
    setIsometryEndsAtMs(null);
    setIsometryActive(false);
  };

  const stopIsometryCountdown = () => {
    setIsometryEndsAtMs(null);
    setIsometryActive(false);
  };

  const setIsometryRemainingWithSync = (nextSeconds: number) => {
    const safe = Math.max(0, normalizeDurationSeconds(nextSeconds));
    setIsometryRemaining(safe);
    if (isometryActive) {
      if (safe > 0) {
        setIsometryEndsAtMs(Date.now() + (safe * 1000));
      } else {
        setIsometryEndsAtMs(null);
        setIsometryActive(false);
      }
    }
  };

  const resetIsometryCountdown = () => {
    const currentExerciseForIso = workout?.exercises[currentExerciseIdx];
    if (!currentExerciseForIso) return;

    const isMaxIso = currentExerciseForIso.type === 'isometry'
      ? isMaxTarget(currentExerciseForIso.duration_seconds)
      : currentExerciseForIso.type === 'superset'
      ? isMaxTarget(currentExerciseForIso.subExercises?.[currentSubExerciseIdx]?.duration_seconds)
      : false;

    if (isMaxIso) {
      setIsometryStopwatchActive(false);
      isometryStopwatchStartMsRef.current = null;
      setIsometryElapsedSeconds(0);
      setLoggedPerformanceForSet(
        currentExerciseIdx,
        currentExerciseForIso,
        currentSetIdx,
        0,
        currentExerciseForIso.type === 'superset' ? currentSubExerciseIdx : undefined
      );
      if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
        playCountdownBeep(0);
      }
      return;
    }

    let targetDuration = 0;
    if (currentExerciseForIso.type === 'isometry') {
      targetDuration = Math.max(1, normalizeDurationSeconds(currentExerciseForIso.duration_seconds));
    } else if (currentExerciseForIso.type === 'superset') {
      const currentSub = currentExerciseForIso.subExercises?.[currentSubExerciseIdx];
      if (currentSub?.type === 'isometry') {
        targetDuration = Math.max(1, normalizeDurationSeconds(currentSub.duration_seconds));
      }
    }

    if (targetDuration <= 0) return;
    setIsometryRemainingWithSync(targetDuration);
  };

  // ── Circuit Stopwatch handlers ──
  useEffect(() => {
    if (!isCircuitStopwatchRunning) return;

    circuitStopwatchStartedAtMsRef.current = Date.now();
    const interval = setInterval(() => {
      if (circuitStopwatchStartedAtMsRef.current) {
        const elapsedMs = circuitAccumulatedMsRef.current + (Date.now() - circuitStopwatchStartedAtMsRef.current);
        setCircuitStopwatchElapsed(Math.floor(elapsedMs / 1000));
      }
    }, 200);

    return () => {
      clearInterval(interval);
      if (circuitStopwatchStartedAtMsRef.current) {
        circuitAccumulatedMsRef.current += Date.now() - circuitStopwatchStartedAtMsRef.current;
        circuitStopwatchStartedAtMsRef.current = null;
      }
    };
  }, [isCircuitStopwatchRunning]);

  const startCircuitStopwatch = useCallback(() => {
    if (!isCircuitStopwatchRunning) {
      circuitStopwatchStartedAtMsRef.current = Date.now();
      setIsCircuitStopwatchRunning(true);
    }
  }, [isCircuitStopwatchRunning]);

  const pauseCircuitStopwatch = useCallback(() => {
    if (isCircuitStopwatchRunning) {
      if (circuitStopwatchStartedAtMsRef.current) {
        circuitAccumulatedMsRef.current += Date.now() - circuitStopwatchStartedAtMsRef.current;
        circuitStopwatchStartedAtMsRef.current = null;
      }
      setIsCircuitStopwatchRunning(false);
    }
  }, [isCircuitStopwatchRunning]);

  const toggleCircuitStopwatch = useCallback(() => {
    if (isCircuitStopwatchRunning) {
      pauseCircuitStopwatch();
    } else {
      startCircuitStopwatch();
    }
  }, [isCircuitStopwatchRunning, pauseCircuitStopwatch, startCircuitStopwatch]);

  const resetCircuitStopwatch = useCallback(() => {
    circuitStopwatchStartedAtMsRef.current = null;
    circuitAccumulatedMsRef.current = 0;
    setCircuitStopwatchElapsed(0);
    setIsCircuitStopwatchRunning(false);
  }, []);

  const getAccurateCircuitElapsedSeconds = useCallback(() => {
    const elapsedMs = circuitStopwatchStartedAtMsRef.current
      ? circuitAccumulatedMsRef.current + (Date.now() - circuitStopwatchStartedAtMsRef.current)
      : circuitAccumulatedMsRef.current;
    return Math.max(circuitStopwatchElapsed, Math.floor(elapsedMs / 1000));
  }, [circuitStopwatchElapsed]);

  const recordCircuitLapAndReset = useCallback(() => {
    const finalLapSeconds = getAccurateCircuitElapsedSeconds();
    setCircuitLapTimes((prev) => [...prev, finalLapSeconds]);
    resetCircuitStopwatch();
    return finalLapSeconds;
  }, [getAccurateCircuitElapsedSeconds, resetCircuitStopwatch]);

  const autoAppendCircuitTimeToNotes = useCallback((exercise: Exercise, _exIdx: number, allLapTimes: number[]) => {
    if (!allLapTimes || allLapTimes.length === 0) return;

    const lapsFormatted = allLapTimes.map((lap, i) => `set ${i + 1}: ${formatTime(lap)}`).join(', ');

    const noteKey = String(exercise.id);
    const idxKey = `idx_${_exIdx}`;
    const cleanName = (exercise.name || '').trim().toLowerCase();
    const nameKey = cleanName ? `name_${cleanName}` : '';
    const orderKey = `order_${exercise.order_index ?? _exIdx + 1}`;

    const countWithName = cleanName && workout?.exercises
      ? workout.exercises.filter((item) => (item.name || '').trim().toLowerCase() === cleanName).length
      : 0;
    const isNameUnique = countWithName === 1;

    setExerciseNotesByKey((prev) => {
      const resolved = getExerciseNoteEntry(_exIdx, exercise);
      const existing = resolved?.note?.trim() || prev[noteKey]?.note?.trim() || '';
      let mergedNote = lapsFormatted;
      if (existing) {
        const cleanExisting = existing
          .split('\n')
          .filter((line) => {
            const trimmed = line.trim().toLowerCase();
            return !trimmed.startsWith('set ') && !trimmed.includes('tempo circuito');
          })
          .join('\n')
          .trim();
        if (cleanExisting) {
          mergedNote = `${cleanExisting}\n${lapsFormatted}`;
        } else {
          mergedNote = lapsFormatted;
        }
      }
      const entry: ExerciseNoteEntry = {
        exerciseName: `${_exIdx + 1}. ${exercise.name || 'Circuito'}`,
        note: mergedNote,
      };
      const nextNotes = {
        ...prev,
        [noteKey]: entry,
        [idxKey]: entry,
        [orderKey]: entry,
      };
      if (isNameUnique && nameKey) {
        nextNotes[nameKey] = entry;
      } else if (nameKey) {
        delete nextNotes[nameKey];
      }
      exerciseNotesByKeyRef.current = nextNotes;
      return nextNotes;
    });
  }, [getExerciseNoteEntry, workout?.exercises]);

  const resetCurrentTimerFromContext = () => {
    if (isResting) {
      resetRestCountdown();
      return;
    }

    const currentExerciseForReset = workout?.exercises[currentExerciseIdx];
    if (!currentExerciseForReset) return;

    if (currentExerciseForReset.type === 'circuit') {
      resetCircuitStopwatch();
      return;
    }

    if (currentExerciseForReset.type === 'emom') {
      resetEmomCountdown();
      return;
    }

    if (
      currentExerciseForReset.type === 'isometry' ||
      (currentExerciseForReset.type === 'superset' && currentExerciseForReset.subExercises?.[currentSubExerciseIdx]?.type === 'isometry')
    ) {
      resetIsometryCountdown();
    }
  };

  const handleEmomTimerTap = () => {
    const currentExerciseForEmom = workout?.exercises[currentExerciseIdx];
    if (!currentExerciseForEmom || currentExerciseForEmom.type !== 'emom') return;

    if (emomActive) {
      pauseEmomCountdown();
      return;
    }

    const emomRoundDuration = currentExerciseForEmom.emom_round_duration || 60;
    const nextEmomDuration = emomRoundRemaining > 0 ? emomRoundRemaining : emomRoundDuration;
    startEmomCountdown(nextEmomDuration);
  };

  const handleIsometryTimerTap = () => {
    const currentExerciseForIso = workout?.exercises[currentExerciseIdx];
    if (!currentExerciseForIso) return;
    const currentSub = currentExerciseForIso.type === 'superset'
      ? currentExerciseForIso.subExercises?.[currentSubExerciseIdx]
      : null;
    const isMaxIso = currentSub
      ? (currentSub.type === 'isometry' && isMaxTarget(currentSub.duration_seconds))
      : (currentExerciseForIso.type === 'isometry' && isMaxTarget(currentExerciseForIso.duration_seconds));

    if (isMaxIso) {
      if (isometryStopwatchActive) {
        setIsometryStopwatchActive(false);
        setLoggedPerformanceForSet(
          currentExerciseIdx,
          currentExerciseForIso,
          currentSetIdx,
          isometryElapsedSeconds,
          currentSub ? currentSubExerciseIdx : undefined
        );
      } else {
        isometryStopwatchStartMsRef.current = Date.now() - (isometryElapsedSeconds * 1000);
        setIsometryStopwatchActive(true);
        speakCue('start');
      }
      return;
    }

    if (isometryActive) {
      pauseIsometryCountdown();
      return;
    }

    const fallbackTarget = getTargetIsometry(currentExerciseForIso, currentSub);
    const nextIsometryDuration = isometryRemaining > 0 ? isometryRemaining : fallbackTarget;
    if (nextIsometryDuration > 0) {
      startIsometryCountdown(nextIsometryDuration);
    }
  };

  const clearTimerLongPressState = () => {
    if (timerLongPressTimeoutRef.current) {
      clearTimeout(timerLongPressTimeoutRef.current);
      timerLongPressTimeoutRef.current = null;
    }
    timerLongPressTriggeredRef.current = false;
  };

  const startTimerLongPress = (onLongPress: () => void) => {
    clearTimerLongPressState();
    timerLongPressTimeoutRef.current = setTimeout(() => {
      timerLongPressTimeoutRef.current = null;
      timerLongPressTriggeredRef.current = true;
      onLongPress();
    }, 700);
  };

  const finishTimerLongPress = (onShortPress?: () => void) => {
    const wasLongPress = timerLongPressTriggeredRef.current;
    if (timerLongPressTimeoutRef.current) {
      clearTimeout(timerLongPressTimeoutRef.current);
      timerLongPressTimeoutRef.current = null;
    }
    timerLongPressTriggeredRef.current = false;
    if (!wasLongPress && onShortPress) {
      onShortPress();
    }
  };

  const clearNativeTextSelection = () => {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return;
    selection.removeAllRanges();
  };

  const handleTimerPointerDown = (event: React.PointerEvent<HTMLElement>, onLongPress: () => void) => {
    event.preventDefault();
    clearNativeTextSelection();
    startTimerLongPress(onLongPress);
  };

  const handleTimerPointerUp = (event: React.PointerEvent<HTMLElement>, onShortPress?: () => void) => {
    event.preventDefault();
    clearNativeTextSelection();
    finishTimerLongPress(onShortPress);
  };

  const handleTimerPointerAbort = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    clearNativeTextSelection();
    clearTimerLongPressState();
  };

  const getWorkoutProgressIdentity = (nextSourceSchedaId?: number | null): WorkoutProgressIdentity | null => {
    const runNumericId = Number(workoutRunId);
    if (Number.isFinite(runNumericId) && runNumericId > 0) {
      return {
        type: 'run',
        id: Math.trunc(runNumericId),
      };
    }

    const candidateSchedaId =
      nextSourceSchedaId != null
        ? nextSourceSchedaId
        : sourceSchedaId != null
          ? sourceSchedaId
          : Number.isFinite(Number(id))
            ? Number(id)
            : null;

    if (!Number.isFinite(candidateSchedaId) || (candidateSchedaId || 0) <= 0) {
      return null;
    }

    return {
      type: 'scheda',
      id: Math.trunc(Number(candidateSchedaId)),
    };
  };

  // Helper per tracciamento a sfinimento (MAX)
  const isMaxPerformance = (
    exercise: Exercise,
    sub?: { reps: number; duration_seconds: number; type: 'reps' | 'isometry' } | null
  ) => {
    if (sub) {
      if (sub.type === 'isometry') return isMaxTarget(sub.duration_seconds);
      return isMaxTarget(sub.reps);
    }
    if (exercise.type === 'isometry') {
      return isMaxTarget(exercise.duration_seconds);
    }
    if (exercise.type === 'reps') {
      return isMaxTarget(exercise.reps);
    }
    return false;
  };

  const getPerformanceUnit = (
    exercise: Exercise,
    sub?: { type: 'reps' | 'isometry' } | null
  ): 'reps' | 'sec' => {
    if (sub?.type === 'isometry' || exercise.type === 'isometry') return 'sec';
    return 'reps';
  };

  const getPerformanceKey = (exIdx: number, exercise: Exercise, subIdx?: number) => {
    const base = exercise.id ? String(exercise.id) : `ex_${exIdx}`;
    return subIdx != null ? `${base}_sub_${subIdx}` : base;
  };

  const getLoggedPerformanceForSet = (
    exIdx: number,
    exercise: Exercise,
    setIdx: number,
    subIdx?: number
  ): number | undefined => {
    const key = getPerformanceKey(exIdx, exercise, subIdx);
    const cleanName = (exercise.name || '').trim().toLowerCase();
    const subSuffix = subIdx != null ? `_sub_${subIdx}` : '';
    const isNameUnique = Boolean(
      cleanName &&
      workout?.exercises &&
      workout.exercises.filter((item) => (item.name || '').trim().toLowerCase() === cleanName).length === 1
    );
    return (
      recordedMaxPerformanceRef.current[key]?.[setIdx] ??
      recordedMaxPerformanceRef.current[`idx_${exIdx}${subSuffix}`]?.[setIdx] ??
      (isNameUnique ? recordedMaxPerformanceRef.current[`name_${cleanName}${subSuffix}`]?.[setIdx] : undefined)
    );
  };

  const setLoggedPerformanceForSet = (
    exIdx: number,
    exercise: Exercise,
    setIdx: number,
    value: number,
    subIdx?: number
  ) => {
    const key = getPerformanceKey(exIdx, exercise, subIdx);
    const cleanName = (exercise.name || '').trim().toLowerCase();
    const subSuffix = subIdx != null ? `_sub_${subIdx}` : '';
    const safeVal = Math.max(0, Math.trunc(value));

    setRecordedMaxPerformance((prev) => {
      const next: Record<string, Record<number, number>> = {
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          [setIdx]: safeVal,
        },
        [`idx_${exIdx}${subSuffix}`]: {
          ...(prev[`idx_${exIdx}${subSuffix}`] || {}),
          [setIdx]: safeVal,
        },
      };
      if (cleanName) {
        const isNameUnique = Boolean(
          workout?.exercises &&
          workout.exercises.filter((item) => (item.name || '').trim().toLowerCase() === cleanName).length === 1
        );
        if (isNameUnique) {
          next[`name_${cleanName}${subSuffix}`] = {
            ...(prev[`name_${cleanName}${subSuffix}`] || {}),
            [setIdx]: safeVal,
          };
        } else {
          delete next[`name_${cleanName}${subSuffix}`];
        }
      }
      recordedMaxPerformanceRef.current = next;
      return next;
    });
  };

  const adjustCurrentSetPerformance = (delta: number) => {
    const currentKey = getPerformanceKey(currentExerciseIdx, currentExercise);
    const currentVal = recordedMaxPerformanceRef.current[currentKey]?.[currentSetIdx] || 0;
    const nextVal = Math.max(0, currentVal + delta);
    setLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx, nextVal);
    if (currentExercise.type === 'isometry' && isMaxTarget(currentExercise.duration_seconds)) {
      setIsometryElapsedSeconds(nextVal);
    }
  };

  const openEditSpecificSetModal = (setIdx: number) => {
    setTargetEditingSetIdx(setIdx);
    const key = getPerformanceKey(currentExerciseIdx, currentExercise);
    const existing = recordedMaxPerformanceRef.current[key]?.[setIdx];
    setModalPerformanceValue(existing != null && existing > 0 ? existing : 0);
    isPendingSetAdvanceRef.current = false;
    setIsMaxPromptModalOpen(true);
  };

  const getWorkoutProgressStorageKey = (nextSourceSchedaId?: number | null) => {
    if (!user?.id) return null;

    const identity = getWorkoutProgressIdentity(nextSourceSchedaId);
    if (!identity) return null;

    return buildWorkoutProgressStorageKey(user.id, identity);
  };

  const clearPersistedWorkoutProgress = (nextSourceSchedaId?: number | null) => {
    if (!user?.id) return;

    try {
      const identity = getWorkoutProgressIdentity(nextSourceSchedaId);
      if (identity) {
        clearWorkoutProgressCheckpointByIdentity(user.id, identity);
      }
      clearAllWorkoutProgressCheckpoints(user.id);
    } catch (error) {
      console.error('Error clearing persisted workout progress:', error);
    }
  };

  const persistWorkoutProgress = (force = false) => {
    if (!workout || workout.exercises.length === 0) return;
    if (workoutCompletionHandledRef.current) return;
    if (suppressProgressPersistenceRef.current) return;

    const storageKey = getWorkoutProgressStorageKey();
    if (!storageKey) return;

    const now = Date.now();
    if (!force && now - lastProgressPersistAtMsRef.current < WORKOUT_PROGRESS_THROTTLE_MS) {
      return;
    }

    const safeCurrentExerciseIdx = Math.max(0, Math.min(currentExerciseIdx, workout.exercises.length - 1));
    const safeExercise = workout.exercises[safeCurrentExerciseIdx];
    const safeCurrentSetIdx = Math.max(0, Math.min(currentSetIdx, Math.max(0, safeExercise.sets - 1)));
    const safeCurrentSubExerciseIdx = safeExercise.type === 'superset'
      ? Math.max(0, Math.min(currentSubExerciseIdx, Math.max(0, (safeExercise.subExercises?.length || 1) - 1)))
      : 0;
    const safeCurrentPyramidStepIdx = safeExercise.type === 'pyramid'
      ? Math.max(0, Math.min(currentPyramidStepIdx, Math.max(0, (safeExercise.pyramid_steps?.length || 1) - 1)))
      : 0;
    const safeCurrentEmomRoundIdx = safeExercise.type === 'emom'
      ? Math.max(0, Math.min(currentEmomRoundIdx, Math.max(0, getEffectiveEmomRounds(safeExercise) - 1)))
      : 0;
    const activeNotes = exerciseNotesByKeyRef.current || exerciseNotesByKey;
    const safeExerciseNotesByKey = Object.entries(activeNotes).reduce<Record<string, ExerciseNoteEntry>>((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      const note = String(value?.note || '').trim();
      if (!normalizedKey || !note) return acc;
      acc[normalizedKey] = {
        exerciseName: String(value?.exerciseName || '').trim() || normalizedKey,
        note,
      };
      return acc;
    }, {});

    // Mappatura canonica su ogni esercizio del workout per massima resilienza
    workout.exercises.forEach((ex, exIdx) => {
      const entry = getExerciseNoteEntry(exIdx, ex);
      if (entry?.note?.trim()) {
        const canonical: ExerciseNoteEntry = {
          exerciseName: `${exIdx + 1}. ${ex.name}`,
          note: entry.note.trim(),
        };
        safeExerciseNotesByKey[String(ex.id)] = canonical;
        safeExerciseNotesByKey[`idx_${exIdx}`] = canonical;
        safeExerciseNotesByKey[`order_${ex.order_index ?? exIdx + 1}`] = canonical;
        const cleanName = (ex.name || '').trim().toLowerCase();
        if (cleanName) {
          const countWithName = workout.exercises.filter(
            (item) => (item.name || '').trim().toLowerCase() === cleanName
          ).length;
          if (countWithName === 1) {
            safeExerciseNotesByKey[`name_${cleanName}`] = canonical;
          } else {
            delete safeExerciseNotesByKey[`name_${cleanName}`];
          }
        }
      }
    });

    // Mappatura canonica anche delle performance MAX su ogni esercizio del workout
    const activeRecordedMax: Record<string, Record<number, number>> = { ...recordedMaxPerformanceRef.current };
    workout.exercises.forEach((ex, exIdx) => {
      const canonicalKey = getPerformanceKey(exIdx, ex);
      const perfData = activeRecordedMax[canonicalKey];
      if (perfData && Object.keys(perfData).length > 0) {
        activeRecordedMax[`idx_${exIdx}`] = perfData;
        const cleanName = (ex.name || '').trim().toLowerCase();
        if (cleanName) {
          const countWithName = workout.exercises.filter(
            (item) => (item.name || '').trim().toLowerCase() === cleanName
          ).length;
          if (countWithName === 1) {
            activeRecordedMax[`name_${cleanName}`] = perfData;
          } else {
            delete activeRecordedMax[`name_${cleanName}`];
          }
        }
      }
    });

    const payload: PersistedWorkoutProgressPayload = {
      version: 1,
      savedAtMs: now,
      state: {
        currentExerciseIdx: safeCurrentExerciseIdx,
        currentSetIdx: safeCurrentSetIdx,
        currentSubExerciseIdx: safeCurrentSubExerciseIdx,
        currentPyramidStepIdx: safeCurrentPyramidStepIdx,
        currentEmomRoundIdx: safeCurrentEmomRoundIdx,
        pendingPyramidAdvance,
        pendingExerciseAdvance,
        isResting,
        restWasRunning: restEndsAtMs != null,
        restRemaining: restEndsAtMs != null ? computeRemainingFromEndsAt(restEndsAtMs) : Math.max(0, normalizeDurationSeconds(restRemaining)),
        restInitialDuration: Math.max(0, normalizeDurationSeconds(restInitialDuration)),
        isometryWasRunning: isometryEndsAtMs != null,
        isometryRemaining: isometryEndsAtMs != null
          ? computeRemainingFromEndsAt(isometryEndsAtMs)
          : Math.max(0, normalizeDurationSeconds(isometryRemaining)),
        emomWasRunning: emomRoundEndsAtMs != null,
        emomRoundRemaining: emomRoundEndsAtMs != null
          ? computeRemainingFromEndsAt(emomRoundEndsAtMs)
          : Math.max(0, normalizeDurationSeconds(emomRoundRemaining)),
        circuitStopwatchElapsed: Math.max(0, normalizeDurationSeconds(circuitStopwatchElapsed)),
        circuitStopwatchRunning: isCircuitStopwatchRunning,
        circuitLapTimes: circuitLapTimes || [],
        exerciseNotesByKey: safeExerciseNotesByKey,
        workoutGeneralNote: (workoutGeneralNoteRef.current || workoutGeneralNote).trim(),
        workoutStartedAtMs: workoutStartedAtMsRef.current,
        workoutElapsedSeconds: getCurrentWorkoutElapsedSeconds(),
        workoutName: workout.name,
        currentExerciseName: safeExercise?.name,
        totalSets: safeExercise?.sets,
        recordedMaxPerformance: activeRecordedMax,
      },
    };

    try {
      if (user?.id) {
        pruneWorkoutProgressCheckpoints(user.id, storageKey);
      }
      localStorage.setItem(storageKey, JSON.stringify(payload));
      notifyWorkoutProgressChanged();
      lastProgressPersistAtMsRef.current = now;
    } catch (error) {
      console.error('Error persisting workout progress:', error);
    }
  };

  const tryRestorePersistedWorkoutProgress = (nextWorkout: Workout, nextSourceSchedaId: number | null) => {
    const storageKey = getWorkoutProgressStorageKey(nextSourceSchedaId);
    if (!storageKey) return false;

    let parsedPayload: PersistedWorkoutProgressPayload | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      parsedPayload = JSON.parse(raw) as PersistedWorkoutProgressPayload;
    } catch (error) {
      console.error('Error parsing persisted workout progress:', error);
      clearPersistedWorkoutProgress(nextSourceSchedaId);
      return false;
    }

    if (!parsedPayload || parsedPayload.version !== 1 || !parsedPayload.state) {
      clearPersistedWorkoutProgress(nextSourceSchedaId);
      return false;
    }

    const savedAtMs = Number(parsedPayload.savedAtMs);
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > WORKOUT_PROGRESS_MAX_AGE_MS) {
      clearPersistedWorkoutProgress(nextSourceSchedaId);
      return false;
    }

    try {
      const totalExercises = nextWorkout.exercises.length;
      if (totalExercises === 0) return false;

      const state = parsedPayload.state;
      let safeExerciseIdx = Math.max(0, Math.min(normalizeDurationSeconds(state.currentExerciseIdx), totalExercises - 1));
      let safeExercise = nextWorkout.exercises[safeExerciseIdx];

      // Se il nome salvato differisce da quello all'indice salvato (es. inserito un nuovo esercizio prima o cambiata sequenza),
      // cerchiamo la corrispondenza per nome nel nuovo workout per riprendere dal punto esatto
      const savedExName = String(state.currentExerciseName || '').trim().toLowerCase();
      if (savedExName && safeExercise && safeExercise.name.trim().toLowerCase() !== savedExName) {
        const matchedIdx = nextWorkout.exercises.findIndex(
          (ex) => ex.name.trim().toLowerCase() === savedExName
        );
        if (matchedIdx !== -1) {
          safeExerciseIdx = matchedIdx;
          safeExercise = nextWorkout.exercises[matchedIdx];
        }
      }
      if (!safeExercise) return false;

      const safeSetIdx = Math.max(0, Math.min(normalizeDurationSeconds(state.currentSetIdx), Math.max(0, (safeExercise.sets || 1) - 1)));

      const rawSubIdx = normalizeDurationSeconds(state.currentSubExerciseIdx);
      const safeSubIdx = (safeExercise.type === 'superset' || safeExercise.type === 'circuit')
        ? Math.max(0, Math.min(rawSubIdx, Math.max(0, (safeExercise.subExercises?.length || 1) - 1)))
        : 0;

      const rawPyramidStepIdx = normalizeDurationSeconds(state.currentPyramidStepIdx);
      const safePyramidStepIdx = safeExercise.type === 'pyramid'
        ? Math.max(0, Math.min(rawPyramidStepIdx, Math.max(0, (safeExercise.pyramid_steps?.length || 1) - 1)))
        : 0;

      const rawEmomRoundIdx = normalizeDurationSeconds(state.currentEmomRoundIdx);
      const safeEmomRoundIdx = safeExercise.type === 'emom'
        ? Math.max(0, Math.min(rawEmomRoundIdx, Math.max(0, getEffectiveEmomRounds(safeExercise) - 1)))
        : 0;

      const elapsedSinceSaveSeconds = Math.max(0, Math.trunc((Date.now() - savedAtMs) / 1000));

      const safeRestRemaining = Math.max(0, normalizeDurationSeconds(state.restRemaining));
      const safeRestInitial = Math.max(0, normalizeDurationSeconds(state.restInitialDuration));
      const effectiveRestInitial = safeRestInitial > 0 ? safeRestInitial : safeRestRemaining;
      const effectiveRestRemainingBase = safeRestRemaining > 0 ? safeRestRemaining : effectiveRestInitial;
      const effectiveRestRemaining = Boolean(state.restWasRunning)
        ? Math.max(0, effectiveRestRemainingBase - elapsedSinceSaveSeconds)
        : effectiveRestRemainingBase;

      // Rileva se il recupero era in corso ed è scaduto mentre l'app era chiusa
      const restExpiredWhileClosed = Boolean(state.isResting) && effectiveRestRemaining <= 0;
      const shouldRestoreRest = Boolean(state.isResting) && effectiveRestRemaining > 0;

      let targetExerciseIdx = safeExerciseIdx;
      let targetSetIdx = safeSetIdx;
      let targetSubExerciseIdx = safeSubIdx;
      let targetPyramidStepIdx = safePyramidStepIdx;
      let targetEmomRoundIdx = safeEmomRoundIdx;
      let targetPendingPyramidAdvance = Boolean(state.pendingPyramidAdvance) && safeExercise.type === 'pyramid';
      let targetPendingExerciseAdvance = Boolean(state.pendingExerciseAdvance);

      // Se il timer di recupero è finito durante la chiusura dell'app, avanziamo automaticamente
      if (restExpiredWhileClosed) {
        if (targetPendingExerciseAdvance) {
          targetPendingExerciseAdvance = false;
          if (safeExerciseIdx < totalExercises - 1) {
            targetExerciseIdx = safeExerciseIdx + 1;
          }
          targetSetIdx = 0;
          targetSubExerciseIdx = 0;
          targetPyramidStepIdx = 0;
          targetEmomRoundIdx = 0;
        } else if (safeExercise.type === 'pyramid' && targetPendingPyramidAdvance) {
          targetPendingPyramidAdvance = false;
          targetPyramidStepIdx = safePyramidStepIdx + 1;
        } else {
          targetSetIdx = safeSetIdx + 1;
          targetSubExerciseIdx = 0;
          if (safeExercise.type === 'emom') {
            targetEmomRoundIdx = 0;
          }
        }
      }

      targetExerciseIdx = Math.max(0, Math.min(targetExerciseIdx, totalExercises - 1));
      const effectiveExercise = nextWorkout.exercises[targetExerciseIdx] || safeExercise;
      const effectiveSetIdx = Math.max(0, Math.min(targetSetIdx, Math.max(0, (effectiveExercise.sets || 1) - 1)));
      const effectiveSubIdx = (effectiveExercise.type === 'superset' || effectiveExercise.type === 'circuit')
        ? Math.max(0, Math.min(targetSubExerciseIdx, Math.max(0, (effectiveExercise.subExercises?.length || 1) - 1)))
        : 0;
      const effectivePyramidStepIdx = effectiveExercise.type === 'pyramid'
        ? Math.max(0, Math.min(targetPyramidStepIdx, Math.max(0, (effectiveExercise.pyramid_steps?.length || 1) - 1)))
        : 0;
      const effectiveEmomRoundIdx = effectiveExercise.type === 'emom'
        ? Math.max(0, Math.min(targetEmomRoundIdx, Math.max(0, getEffectiveEmomRounds(effectiveExercise) - 1)))
        : 0;

      const effectiveIsometryTarget = getTargetIsometry(effectiveExercise, effectiveExercise.subExercises?.[effectiveSubIdx]);
      const effectiveFallbackIsometryTarget = (() => {
        if (effectiveExercise.type === 'isometry' || effectiveExercise.type === 'cardio') return Math.max(0, normalizeDurationSeconds(effectiveExercise.duration_seconds));
        if (effectiveExercise.type === 'superset') {
          const safeSub = effectiveExercise.subExercises?.[effectiveSubIdx];
          if (safeSub?.type === 'isometry' || safeSub?.type === 'cardio') {
            return Math.max(0, normalizeDurationSeconds(safeSub.duration_seconds));
          }
        }
        return 0;
      })();

      const effectiveFallbackEmomTarget = effectiveExercise.type === 'emom'
        ? Math.max(1, normalizeDurationSeconds(effectiveExercise.emom_round_duration || 60))
        : 0;

      let finalIsometryRemaining = 0;
      let finalIsometryActive = false;
      let finalIsometryEndsAtMs: number | null = null;

      let finalEmomRemaining = 0;
      let finalEmomActive = false;
      let finalEmomEndsAtMs: number | null = null;

      if (restExpiredWhileClosed) {
        finalIsometryRemaining = effectiveIsometryTarget;
        finalIsometryActive = false;
        finalIsometryEndsAtMs = null;

        finalEmomRemaining = effectiveFallbackEmomTarget;
        finalEmomActive = false;
        finalEmomEndsAtMs = null;
      } else {
        const safeIsometryRemainingBase = Math.max(
          0,
          normalizeDurationSeconds(
            state.isometryRemaining > 0
              ? state.isometryRemaining
              : effectiveFallbackIsometryTarget,
          ),
        );
        finalIsometryRemaining = Boolean(state.isometryWasRunning)
          ? Math.max(0, safeIsometryRemainingBase - elapsedSinceSaveSeconds)
          : safeIsometryRemainingBase;
        finalIsometryActive = Boolean(state.isometryWasRunning) && finalIsometryRemaining > 0;
        finalIsometryEndsAtMs = finalIsometryActive ? Date.now() + (finalIsometryRemaining * 1000) : null;

        const safeEmomRoundRemainingBase = Math.max(
          0,
          normalizeDurationSeconds(
            state.emomRoundRemaining > 0
              ? state.emomRoundRemaining
              : effectiveFallbackEmomTarget,
          ),
        );
        finalEmomRemaining = Boolean(state.emomWasRunning)
          ? Math.max(0, safeEmomRoundRemainingBase - elapsedSinceSaveSeconds)
          : safeEmomRoundRemainingBase;
        finalEmomActive = Boolean(state.emomWasRunning) && finalEmomRemaining > 0;
        finalEmomEndsAtMs = finalEmomActive ? Date.now() + (finalEmomRemaining * 1000) : null;
      }

      // Ricostruzione e rimappatura note
      const safeNotes: Record<string, ExerciseNoteEntry> = {};
      const rawNotes = state.exerciseNotesByKey || {};

      Object.entries(rawNotes).forEach(([key, value]) => {
        const note = String(value?.note || '').trim();
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || !note) return;
        safeNotes[normalizedKey] = {
          exerciseName: String(value?.exerciseName || '').trim() || normalizedKey,
          note,
        };
      });

      // Rimappa su tutti gli esercizi di nextWorkout (anche se gli ID esecuzioni sono stati rigenerati)
      nextWorkout.exercises.forEach((ex, exIdx) => {
        const cleanExName = (ex.name || '').trim().toLowerCase();
        const orderPrefix = `${exIdx + 1}.`;
        const countWithName = cleanExName
          ? nextWorkout.exercises.filter((item) => (item.name || '').trim().toLowerCase() === cleanExName).length
          : 0;
        const isNameUnique = countWithName === 1;

        let foundEntry: ExerciseNoteEntry | undefined = undefined;

        // 1. Per ID esatto
        if (rawNotes[String(ex.id)]?.note?.trim()) {
          foundEntry = rawNotes[String(ex.id)];
        }
        // 2. Per chiave indice o ordine
        else if (rawNotes[`idx_${exIdx}`]?.note?.trim()) {
          foundEntry = rawNotes[`idx_${exIdx}`];
        } else if (rawNotes[`order_${ex.order_index ?? exIdx + 1}`]?.note?.trim()) {
          foundEntry = rawNotes[`order_${ex.order_index ?? exIdx + 1}`];
        }
        // 3. Per prefisso d'ordine nel nome (es. "1. Plank")
        else {
          for (const [k, entry] of Object.entries(rawNotes)) {
            if (!entry?.note?.trim()) continue;
            if (k.startsWith('idx_') && k !== `idx_${exIdx}`) continue;
            if (k.startsWith('order_') && k !== `order_${ex.order_index ?? exIdx + 1}`) continue;
            const entryName = (entry.exerciseName || '').trim().toLowerCase();
            if (entryName.startsWith(orderPrefix)) {
              foundEntry = entry;
              break;
            }
          }
        }

        // 4. Fallback per nome SOLO se il nome dell'esercizio è strettamente univoco nella scheda
        if (!foundEntry && isNameUnique && cleanExName) {
          if (rawNotes[`name_${cleanExName}`]?.note?.trim()) {
            foundEntry = rawNotes[`name_${cleanExName}`];
          } else {
            for (const [k, entry] of Object.entries(rawNotes)) {
              if (!entry?.note?.trim()) continue;
              if (k.startsWith('idx_') && k !== `idx_${exIdx}`) continue;
              if (k.startsWith('order_') && k !== `order_${ex.order_index ?? exIdx + 1}`) continue;
              const entryName = (entry.exerciseName || '').trim().toLowerCase();
              if (entryName.includes(cleanExName)) {
                foundEntry = entry;
                break;
              }
            }
          }
        }

        if (foundEntry?.note?.trim()) {
          const canonicalEntry: ExerciseNoteEntry = {
            exerciseName: `${exIdx + 1}. ${ex.name}`,
            note: foundEntry.note.trim(),
          };
          safeNotes[String(ex.id)] = canonicalEntry;
          safeNotes[`idx_${exIdx}`] = canonicalEntry;
          safeNotes[`order_${ex.order_index ?? exIdx + 1}`] = canonicalEntry;
          if (isNameUnique && cleanExName) {
            safeNotes[`name_${cleanExName}`] = canonicalEntry;
          } else if (cleanExName) {
            delete safeNotes[`name_${cleanExName}`];
          }
        }
      });

      setCurrentExerciseIdx(targetExerciseIdx);
      setCurrentSetIdx(effectiveSetIdx);
      setCurrentSubExerciseIdx(effectiveSubIdx);
      setCurrentPyramidStepIdx(effectivePyramidStepIdx);
      setCurrentEmomRoundIdx(effectiveEmomRoundIdx);
      setPendingPyramidAdvance(targetPendingPyramidAdvance);
      setPendingExerciseAdvance(targetPendingExerciseAdvance);

      const resumeRestRunning = shouldRestoreRest && Boolean(state.restWasRunning);
      wasRestingRef.current = resumeRestRunning;
      wasIsometryActiveRef.current = finalIsometryActive;
      wasEmomActiveRef.current = finalEmomActive;

      setIsResting(shouldRestoreRest);
      setRestRemaining(shouldRestoreRest ? effectiveRestRemaining : 0);
      setRestInitialDuration(shouldRestoreRest ? effectiveRestInitial : 0);
      setRestEndsAtMs(resumeRestRunning ? Date.now() + (effectiveRestRemaining * 1000) : null);

      setIsometryRemaining(finalIsometryRemaining);
      setIsometryActive(finalIsometryActive);
      setIsometryEndsAtMs(finalIsometryEndsAtMs);

      setEmomRoundRemaining(finalEmomRemaining);
      setEmomActive(finalEmomActive);
      setEmomRoundEndsAtMs(finalEmomEndsAtMs);

      if (restExpiredWhileClosed) {
        setTimeout(() => {
          speakCue(buildSetAnnouncementCue(effectiveExercise, effectiveSetIdx, effectivePyramidStepIdx));
        }, 500);
      }

      if (state.circuitStopwatchElapsed != null) {
        setCircuitStopwatchElapsed(Math.max(0, normalizeDurationSeconds(state.circuitStopwatchElapsed)));
      }
      if (Array.isArray(state.circuitLapTimes)) {
        setCircuitLapTimes(state.circuitLapTimes.map(n => Math.max(0, normalizeDurationSeconds(n))));
      }

      if (state.recordedMaxPerformance) {
        const restoredMaxPerformance: Record<string, Record<number, number>> = { ...state.recordedMaxPerformance };
        // Rimappa sui nuovi ID degli esercizi di nextWorkout (anche se gli ID esecuzioni sono stati rigenerati dal database)
        nextWorkout.exercises.forEach((ex, exIdx) => {
          const cleanName = (ex.name || '').trim().toLowerCase();
          const countWithName = cleanName
            ? nextWorkout.exercises.filter((item) => (item.name || '').trim().toLowerCase() === cleanName).length
            : 0;
          const isNameUnique = countWithName === 1;

          const existingData =
            restoredMaxPerformance[String(ex.id)] ||
            restoredMaxPerformance[`idx_${exIdx}`] ||
            (isNameUnique && cleanName ? restoredMaxPerformance[`name_${cleanName}`] : undefined);

          if (existingData) {
            restoredMaxPerformance[String(ex.id)] = existingData;
            restoredMaxPerformance[`idx_${exIdx}`] = existingData;
            if (isNameUnique && cleanName) {
              restoredMaxPerformance[`name_${cleanName}`] = existingData;
            } else if (cleanName) {
              delete restoredMaxPerformance[`name_${cleanName}`];
            }
          }
        });
        setRecordedMaxPerformance(restoredMaxPerformance);
        recordedMaxPerformanceRef.current = restoredMaxPerformance;
      }

      setExerciseNotesByKey(safeNotes);
      exerciseNotesByKeyRef.current = safeNotes;

      const safeWorkoutGeneralNote = String(state.workoutGeneralNote || '').trim();
      setWorkoutGeneralNote(safeWorkoutGeneralNote);
      workoutGeneralNoteRef.current = safeWorkoutGeneralNote;

      const restoredStartedAt = Number(state.workoutStartedAtMs);
      workoutStartedAtMsRef.current = Number.isFinite(restoredStartedAt) && restoredStartedAt > 0
        ? restoredStartedAt
        : Date.now();

      const restoredElapsed = Number(state.workoutElapsedSeconds);
      workoutElapsedSecondsRef.current = Number.isFinite(restoredElapsed) && restoredElapsed >= 0
        ? restoredElapsed
        : 0;
      sessionForegroundStartedAtMsRef.current = Date.now();

      return true;
    } catch (err) {
      console.error('Error in tryRestorePersistedWorkoutProgress:', err);
      return false;
    }
  };

  persistWorkoutProgressRef.current = persistWorkoutProgress;

  useEffect(() => {
    const saved = localStorage.getItem(VOICE_ASSIST_KEY);
    if (saved !== null) {
      setVoiceAssistanceEnabled(saved === 'true');
    } else {
      setVoiceAssistanceEnabled(true);
    }

    let isUnmounted = false;
    const loadVoiceAssistancePreference = async () => {
      if (!user?.id) return;

      const { data, error } = await supabase
        .from('profili')
        .select('voice_assistant')
        .eq('id_utente', user.id)
        .maybeSingle();

      if (isUnmounted || error) return;

      if (typeof data?.voice_assistant === 'boolean') {
        setVoiceAssistanceEnabled(data.voice_assistant);
        localStorage.setItem(VOICE_ASSIST_KEY, String(data.voice_assistant));
      }
    };

    void loadVoiceAssistancePreference();

    const syncFromLocalStorage = () => {
      const saved = localStorage.getItem(VOICE_ASSIST_KEY);
      if (saved !== null) {
        setVoiceAssistanceEnabled(saved === 'true');
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === VOICE_ASSIST_KEY && e.newValue !== null) {
        setVoiceAssistanceEnabled(e.newValue === 'true');
      }
    };

    const onVoiceChanged = (e: Event) => {
      const custom = e as CustomEvent<boolean>;
      if (typeof custom?.detail === 'boolean') {
        setVoiceAssistanceEnabled(custom.detail);
      } else {
        syncFromLocalStorage();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('voice-assistance-changed', onVoiceChanged);
    window.addEventListener('focus', syncFromLocalStorage);
    document.addEventListener('visibilitychange', syncFromLocalStorage);

    return () => {
      isUnmounted = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('voice-assistance-changed', onVoiceChanged);
      window.removeEventListener('focus', syncFromLocalStorage);
      document.removeEventListener('visibilitychange', syncFromLocalStorage);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!isVoiceHelpVisible) return;

    const onAnyScreenClick = () => {
      closeVoiceHelp();
    };

    document.addEventListener('click', onAnyScreenClick);
    return () => {
      document.removeEventListener('click', onAnyScreenClick);
    };
  }, [isVoiceHelpVisible]);

  useEffect(() => {
    void requestScreenWakeLock();
    void initServiceWorker();
    if (isNativeApp()) {
      void ensureNativeNotificationPermission();
    }

    return () => {
      void releaseScreenWakeLock();
      stopRestMediaSession();
      void closeActiveRestNotifications();
      if (voiceHelpTimeoutRef.current) {
        clearTimeout(voiceHelpTimeoutRef.current);
        voiceHelpTimeoutRef.current = null;
      }
      clearTimerLongPressState();
    };
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    const unsub = addNotificationActionListener(() => {
      if (isResting) {
        stopRestCountdown(false);
        finishRestAndNextSet(true);
      }
    });
    return unsub;
  }, [isResting]);

  handleVoiceNextRef.current = () => {
    if (isResting) skipRest();
    else if (workout?.exercises[currentExerciseIdx]?.type === 'emom') {
      const ex = workout.exercises[currentExerciseIdx];
      if (currentEmomRoundIdx < getEffectiveEmomRounds(ex) - 1) {
        speakCue('next round');
        setCurrentEmomRoundIdx(prev => prev + 1);
        setEmomRoundRemainingWithSync(ex.emom_round_duration || 60);
      } else {
        stopEmomCountdown();
        if (currentSetIdx === ex.sets - 1) {
          queueNextExerciseFlow(ex);
        } else {
          startRestCountdown(ex.rest_seconds);
        }
      }
    }
    else completeSet();
  };

  handleVoicePrevRef.current = () => {
    // Granular 'back' functionality perfectly mirroring 'next'
    if (!workout) return;
    const currentEx = workout.exercises[currentExerciseIdx];

    if (currentEx.type === 'emom') {
      if (currentEmomRoundIdx > 0) {
        setCurrentEmomRoundIdx(prev => prev - 1);
        setEmomRoundRemainingWithSync(currentEx.emom_round_duration || 60);
      } else {
        handlePrevExercise();
      }
      return;
    }

    if (currentEx.type === 'pyramid') {
      if (currentPyramidStepIdx > 0) {
        setCurrentPyramidStepIdx(prev => prev - 1);
      } else {
        handlePrevExercise();
      }
      return;
    }

    if (currentEx.type === 'circuit') {
      if (currentSetIdx > 0) {
        setCurrentSetIdx(prev => prev - 1);
        resetCircuitStopwatch();
      } else {
        handlePrevExercise();
      }
      return;
    }

    if (currentEx.type === 'superset') {
      if (currentSetIdx > 0) {
        setCurrentSetIdx(prev => prev - 1);
        setCurrentSubExerciseIdx(0);
        resetCurrentExerciseTimerState();
      } else {
        handlePrevExercise();
      }
      return;
    }

    if (isResting) {
      stopRestCountdown();
      setPendingExerciseAdvance(false);
      setPendingPyramidAdvance(false);
      setIsometryRemainingWithSync(getTargetIsometry(currentEx, currentEx.subExercises?.[currentSubExerciseIdx]));
      return;
    }

    if (currentSetIdx > 0) {
      const prevSetIdx = currentSetIdx - 1;
      setCurrentSetIdx(prevSetIdx);
      const ex = workout?.exercises[currentExerciseIdx];
      if (ex) {
        setIsometryRemainingWithSync(getTargetIsometry(ex, null));
      }
      return;
    }

    handlePrevExercise();
  };

  handleVoiceNextExerciseRef.current = () => {
    if (!workout) return;

    if (currentExerciseIdx < workout.exercises.length - 1) {
      handleNextExercise();
      return;
    }

    speakCue('last exercise');
  };

  handleVoicePrevExerciseRef.current = () => {
    if (!workout) return;

    if (currentExerciseIdx > 0) {
      handlePrevExercise();
      return;
    }

    speakCue('first exercise');
  };

  handleVoiceEndWorkoutRef.current = () => {
    void completeWorkoutNow();
  };

  handleVoiceStartTimerRef.current = () => {
    const currentVoiceExercise = workout?.exercises[currentExerciseIdx];
    if (currentVoiceExercise?.type === 'emom') {
      const nextEmomDuration = emomRoundRemaining > 0
        ? emomRoundRemaining
        : (currentVoiceExercise.emom_round_duration || 60);
      startEmomCountdown(nextEmomDuration);
      return;
    }

    if (currentVoiceExercise?.type === 'circuit') {
      startCircuitStopwatch();
      return;
    }

    if (!currentVoiceExercise) return;

    const nextIsoDuration = isometryRemaining > 0
      ? isometryRemaining
      : getTargetIsometry(currentVoiceExercise, currentVoiceExercise.subExercises?.[currentSubExerciseIdx]);
    if (nextIsoDuration > 0) {
      startIsometryCountdown(nextIsoDuration);
    }
  };

  handleVoiceStopTimerRef.current = () => {
    if (workout?.exercises[currentExerciseIdx]?.type === 'emom') pauseEmomCountdown();
    else if (workout?.exercises[currentExerciseIdx]?.type === 'circuit') pauseCircuitStopwatch();
    else pauseIsometryCountdown();
  };

  handleVoiceResetTimerRef.current = () => {
    resetCurrentTimerFromContext();
  };

  handleVoiceSkipRestRef.current = () => {
    if (!isResting) return false;
    stopRestCountdown();
    setRestRemaining(0);
    finishRestAndNextSet(true);
    return true;
  };

  // Voice Recognition logic
  useEffect(() => {
    let recognition: any = null;

    if (isVoiceEnabled) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'it-IT';

        recognition.onresult = (event: any) => {
          const current = event.resultIndex;
          const transcript = String(event.results[current][0].transcript || '').toLowerCase();
          const normalizedTranscript = transcript
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const isNextExerciseCommand = normalizedTranscript.includes('next exercise') || normalizedTranscript.includes('prossimo esercizio');
          const isPrevExerciseCommand = normalizedTranscript.includes('previous exercise') || normalizedTranscript.includes('esercizio precedente');
          const isEndWorkoutCommand =
            /\bend\s*work\s*out\b/.test(normalizedTranscript) ||
            /\band\s*work\s*out\b/.test(normalizedTranscript) ||
            normalizedTranscript.includes('termina workout') ||
            normalizedTranscript.includes('termina allenamento');
          const isResetTimerCommand = normalizedTranscript.includes('reset') || normalizedTranscript.includes('resetta');
          const isSkipRestCommand =
            /\bskip\s*rest\b/.test(normalizedTranscript) ||
            normalizedTranscript.includes('salta recupero');

          if (isNextExerciseCommand) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceNextExerciseRef.current) {
              handleVoiceNextExerciseRef.current();
            }
          } else if (isPrevExerciseCommand) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoicePrevExerciseRef.current) {
              handleVoicePrevExerciseRef.current();
            }
          } else if (isEndWorkoutCommand) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceEndWorkoutRef.current) {
              handleVoiceEndWorkoutRef.current();
            }
          } else if (isResetTimerCommand) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceResetTimerRef.current) {
              handleVoiceResetTimerRef.current();
            }
          } else if (isSkipRestCommand) {
            const didSkipRest = handleVoiceSkipRestRef.current?.() || false;
            setVoiceStatus(didSkipRest ? 'success' : 'error');
            setTimeout(() => setVoiceStatus('idle'), 1500);
          } else if (normalizedTranscript.includes('vai') || normalizedTranscript.includes('start')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceStartTimerRef.current) {
              handleVoiceStartTimerRef.current();
            }
          } else if (normalizedTranscript.includes('stop') || normalizedTranscript.includes('fermo')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceStopTimerRef.current) {
              handleVoiceStopTimerRef.current();
            }
          } else if (normalizedTranscript.includes('next') || normalizedTranscript.includes('avanti')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoiceNextRef.current) {
              handleVoiceNextRef.current();
            }
          } else if (normalizedTranscript.includes('back') || normalizedTranscript.includes('indietro')) {
            setVoiceStatus('success');
            setTimeout(() => setVoiceStatus('idle'), 1500);
            if (handleVoicePrevRef.current) {
              handleVoicePrevRef.current();
            }
          } else {
            setVoiceStatus('error');
            setTimeout(() => setVoiceStatus('idle'), 1500);
          }
        };

        recognition.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
        };

        recognition.onend = () => {
          // Restart automatically if still enabled
          if (isVoiceEnabled && recognition) {
            try {
              recognition.start();
            } catch (e) { }
          }
        };

        try {
          recognition.start();
        } catch (e) { }
      } else {
        alert("Your browser does not support Speech Recognition.");
        setIsVoiceEnabled(false);
      }
    }

    return () => {
      if (recognition) {
        recognition.onend = null;
        recognition.stop();
      }
    };
  }, [isVoiceEnabled]);

  useEffect(() => {
    void fetchWorkout();
  }, [id, workoutRunId, user?.id]);

  useEffect(() => {
    persistWorkoutProgress(false);
  }, [
    workout,
    sourceSchedaId,
    pendingPyramidAdvance,
    pendingExerciseAdvance,
    isResting,
    restRemaining,
    restInitialDuration,
    restEndsAtMs,
    isometryRemaining,
    isometryEndsAtMs,
    emomRoundRemaining,
    emomRoundEndsAtMs,
    circuitStopwatchElapsed,
    isCircuitStopwatchRunning,
    circuitLapTimes,
    exerciseNotesByKey,
  ]);

  useEffect(() => {
    persistWorkoutProgress(true);
  }, [
    currentExerciseIdx,
    currentSetIdx,
    currentSubExerciseIdx,
    currentPyramidStepIdx,
    currentEmomRoundIdx,
  ]);

  useEffect(() => {
    const flushProgress = () => {
      freezeForegroundWorkoutTime();
      persistWorkoutProgressRef.current?.(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      } else if (document.visibilityState === 'visible') {
        unfreezeForegroundWorkoutTime();
      }
    };

    window.addEventListener('beforeunload', flushProgress);
    window.addEventListener('pagehide', flushProgress);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      flushProgress();
      window.removeEventListener('beforeunload', flushProgress);
      window.removeEventListener('pagehide', flushProgress);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [freezeForegroundWorkoutTime, unfreezeForegroundWorkoutTime]);

  const fetchWorkout = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    const initializeWorkoutState = (nextWorkout: Workout, nextSourceSchedaId: number | null) => {
      setWorkout(nextWorkout);
      setSourceSchedaId(nextSourceSchedaId);

      // Reset states just in case
      setCurrentExerciseIdx(0);
      setCurrentSetIdx(0);
      setCurrentSubExerciseIdx(0);
      setCurrentEmomRoundIdx(0);
      setCurrentPyramidStepIdx(0);
      setPendingPyramidAdvance(false);
      setPendingExerciseAdvance(false);
      setIsResting(false);
      setRestRemaining(0);
      setRestInitialDuration(0);
      setRestEndsAtMs(null);
      setIsometryActive(false);
      setIsometryEndsAtMs(null);
      setEmomActive(false);
      setEmomRoundEndsAtMs(null);
      setExerciseNotesByKey({});
      setWorkoutGeneralNote('');
      workoutGeneralNoteRef.current = '';
      setIsEditingGeneralNoteInOverview(false);
      setOverviewGeneralNoteDraft('');
      setIsNoteModalOpen(false);
      setNoteModalDraft('');
      setNoteModalContext(null);
      setIsInstructionModalOpen(false);
      setInstructionModalContext(null);
      setIsEditExerciseModalOpen(false);
      setExerciseEditError(null);
      setIsSavingExerciseEdit(false);
      workoutRunSavedRef.current = false;
      workoutRunIdRef.current = null;
      workoutNotesSavedRef.current = false;
      workoutCompletionHandledRef.current = false;
      workoutStartedAtMsRef.current = Date.now();
      workoutElapsedSecondsRef.current = 0;
      sessionForegroundStartedAtMsRef.current = Date.now();
      lastProgressPersistAtMsRef.current = 0;
      suppressProgressPersistenceRef.current = false;

      const didRestore = tryRestorePersistedWorkoutProgress(nextWorkout, nextSourceSchedaId);
      if (didRestore) {
        lastProgressPersistAtMsRef.current = Date.now();
        return;
      }

      const firstEx = nextWorkout.exercises[0];
      if (firstEx) {
        const firstExerciseName = String(firstEx.name || '').trim() || 'Exercise 1';
        speakCue(`first exercise ${firstExerciseName}`);

        if (firstEx.type === 'isometry' || firstEx.type === 'cardio') {
          setIsometryRemainingWithSync(firstEx.duration_seconds);
        } else if ((firstEx.type === 'superset' || firstEx.type === 'circuit') && (firstEx.subExercises?.[0]?.type === 'isometry' || firstEx.subExercises?.[0]?.type === 'cardio')) {
          setIsometryRemainingWithSync(firstEx.subExercises[0].duration_seconds);
        } else if (firstEx.type === 'emom') {
          setEmomRoundRemainingWithSync(firstEx.emom_round_duration || 60);
        } else {
          setIsometryRemainingWithSync(0);
          setEmomRoundRemaining(0);
        }
      }
    };

    const fetchSchedaById = async (schedaId: number) => {
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
        .eq('id_scheda', schedaId)
        .maybeSingle();

      if (error) throw error;
      return data;
    };

    try {
      setLoading(true);
      if (workoutRunId) {
        const workoutRunNumericId = Number(workoutRunId);
        if (!Number.isFinite(workoutRunNumericId)) {
          throw new Error('Invalid workout history id.');
        }

        const { data: runData, error: runError } = await supabase
          .from('workout_run')
          .select(`
            id_workout,
            id_scheda,
            workout_name_snapshot,
            exercises_snapshot,
            schede ( id_scheda, nome )
          `)
          .eq('id_workout', workoutRunNumericId)
          .eq('id_utente', user.id)
          .maybeSingle();

        if (runError) throw runError;
        if (!runData) {
          throw new Error('Workout history entry not found.');
        }

        const linkedScheda = Array.isArray(runData.schede) ? runData.schede[0] : runData.schede;
        const runSourceSchedaId = runData.id_scheda == null ? null : Number(runData.id_scheda);
        const workoutNameSnapshot = String((runData as { workout_name_snapshot?: unknown }).workout_name_snapshot || '').trim();
        const snapshotExercises = toSnapshotExercises((runData as { exercises_snapshot?: unknown }).exercises_snapshot);

        if (snapshotExercises.length > 0) {
          initializeWorkoutState(
            {
              id: `history-${runData.id_workout}`,
              name:
                workoutNameSnapshot ||
                linkedScheda?.nome ||
                (runSourceSchedaId != null ? `Workout #${runSourceSchedaId}` : `Workout #${runData.id_workout}`),
              exercises: snapshotExercises,
            },
            runSourceSchedaId,
          );
          return;
        }

        if (runSourceSchedaId != null) {
          const linkedWorkout = await fetchSchedaById(runSourceSchedaId);
          if (linkedWorkout) {
            const linkedExercises = parseDbExerciseRows(linkedWorkout.esecuzioni || []) as Exercise[];
            initializeWorkoutState(
              {
                id: String(linkedWorkout.id_scheda),
                name: workoutNameSnapshot || linkedWorkout.nome,
                exercises: linkedExercises,
              },
              runSourceSchedaId,
            );
            return;
          }
        }

        initializeWorkoutState(
          {
            id: `history-${runData.id_workout}`,
            name: workoutNameSnapshot || `Workout #${runData.id_workout}`,
            exercises: [],
          },
          runSourceSchedaId,
        );
        return;
      }

      const schedaId = Number(id);
      if (!Number.isFinite(schedaId)) {
        throw new Error('Invalid workout id.');
      }

      const data = await fetchSchedaById(schedaId);
      if (!data) {
        throw new Error('Workout not found.');
      }

      const sortedExercises = parseDbExerciseRows(data.esecuzioni || []) as Exercise[];
      initializeWorkoutState(
        { id: String(data.id_scheda), name: data.nome, exercises: sortedExercises },
        Number(data.id_scheda),
      );
    } catch (error) {
      console.error('Error fetching workout:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveWorkoutRun = async (): Promise<number | null> => {
    if (workoutRunSavedRef.current) return workoutRunIdRef.current;
    if (!user?.id) return null;

    const workoutDurationSeconds = Math.max(0, getCurrentWorkoutElapsedSeconds());

    const fallbackSchedaId = Number(id);
    const computedSchedaId = sourceSchedaId != null
      ? sourceSchedaId
      : Number.isFinite(fallbackSchedaId)
        ? fallbackSchedaId
        : null;

    const workoutNameSnapshot = String(
      workout?.name ||
      (computedSchedaId != null
        ? `Workout #${computedSchedaId}`
        : workoutRunId
          ? `Workout Replay #${workoutRunId}`
          : 'Workout')
    ).trim();
    const exercisesSnapshot = Array.isArray(workout?.exercises)
      ? workout.exercises.map((exercise, exIdx) => {
        const key = getPerformanceKey(exIdx, exercise);
        const setsMap = recordedMaxPerformanceRef.current[key] || {};
        const totalSets = Math.max(1, exercise.sets || 1);
        const completed_sets_records = Array.from({ length: totalSets }, (_, sIdx) => {
          const val = setsMap[sIdx];
          return val != null ? val : null;
        });

        return {
          ...exercise,
          subExercises: exercise.subExercises || [],
          pyramid_steps: exercise.pyramid_steps || [],
          completed_sets_records: completed_sets_records.some((v) => v != null) ? completed_sets_records : undefined,
          completed_sets_reps: completed_sets_records.some((v) => v != null) ? completed_sets_records : undefined,
        };
      })
      : [];

    let data: { id_workout?: number } | null = null;
    let error: { message?: string } | null = null;

    const firstAttempt = await supabase
      .from('workout_run')
      .insert([
        {
          id_utente: user.id,
          id_scheda: computedSchedaId,
          durata_totale_secondi: workoutDurationSeconds,
          workout_name_snapshot: workoutNameSnapshot,
          exercises_snapshot: exercisesSnapshot,
        },
      ])
      .select('id_workout')
      .single();

    data = firstAttempt.data as { id_workout?: number } | null;
    error = firstAttempt.error as { message?: string } | null;

    const needsDurationFallback =
      Boolean(error) &&
      /durata_totale_secondi/i.test(String(error?.message || ''));

    if (needsDurationFallback) {
      const noDurationAttempt = await supabase
        .from('workout_run')
        .insert([
          {
            id_utente: user.id,
            id_scheda: computedSchedaId,
            workout_name_snapshot: workoutNameSnapshot,
            exercises_snapshot: exercisesSnapshot,
          },
        ])
        .select('id_workout')
        .single();

      data = noDurationAttempt.data as { id_workout?: number } | null;
      error = noDurationAttempt.error as { message?: string } | null;
    }

    const needsLegacyFallback =
      Boolean(error) &&
      /workout_name_snapshot|exercises_snapshot/i.test(String(error?.message || ''));

    if (needsLegacyFallback) {
      const legacyAttempt = await supabase
        .from('workout_run')
        .insert([
          {
            id_utente: user.id,
            id_scheda: computedSchedaId,
          },
        ])
        .select('id_workout')
        .single();

      data = legacyAttempt.data as { id_workout?: number } | null;
      error = legacyAttempt.error as { message?: string } | null;
    }

    if (error || !data?.id_workout) {
      console.error('Error saving completed workout:', error || 'Missing workout id');
      return null;
    }

    workoutRunSavedRef.current = true;
    workoutRunIdRef.current = Number(data.id_workout);
    return workoutRunIdRef.current;
  };

  const saveWorkoutNotes = async (workoutRunId: number) => {
    if (workoutNotesSavedRef.current) return;

    const currentNotes = { ...(exerciseNotesByKeyRef.current || exerciseNotesByKey) };

    if (workout?.exercises) {
      workout.exercises.forEach((ex, exIdx) => {
        if (isMaxPerformance(ex)) {
          const key = getPerformanceKey(exIdx, ex);
          const setsMap = recordedMaxPerformanceRef.current[key];
          if (setsMap && Object.keys(setsMap).length > 0) {
            const unit = getPerformanceUnit(ex) === 'sec' ? 's' : ' reps';
            const entries = Object.entries(setsMap)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([sIdx, val]) => `Set ${Number(sIdx) + 1}: ${val}${unit}`);
            if (entries.length > 0) {
              const summaryLine = `A sfinimento: ${entries.join(' · ')}`;
              const existingEntry = getExerciseNoteEntry(exIdx, ex);
              const existing = existingEntry?.note || '';
              if (!existing.includes('A sfinimento:')) {
                const updatedNote = existing ? `${existing} | ${summaryLine}` : summaryLine;
                const newEntry = {
                  exerciseName: `${exIdx + 1}. ${ex.name}`,
                  note: updatedNote,
                };
                currentNotes[String(ex.id)] = newEntry;
                currentNotes[`idx_${exIdx}`] = newEntry;
                currentNotes[`order_${ex.order_index ?? exIdx + 1}`] = newEntry;
              }
            }
          }
        }
      });
    }

    const seenNoteTexts = new Set<string>();
    const rowsToInsert: { id_workout: number; testo: string }[] = [];

    // 1. Inserisci prima le note abbinate agli esercizi attuali con indice d'ordine per evitare collisioni di nome
    if (workout?.exercises) {
      workout.exercises.forEach((ex, exIdx) => {
        const entry = getExerciseNoteEntry(exIdx, ex);
        if (entry?.note?.trim()) {
          const fullText = `[${exIdx + 1}. ${ex.name}] ${entry.note.trim()}`;
          const legacyText = `[${ex.name}] ${entry.note.trim()}`;
          if (!seenNoteTexts.has(fullText) && fullText.length > 3) {
            seenNoteTexts.add(fullText);
            seenNoteTexts.add(legacyText);
            rowsToInsert.push({
              id_workout: workoutRunId,
              testo: fullText,
            });
          }
        }
      });
    }

    // 2. Inserisci eventuali note orfane o aggiuntive
    Object.values(currentNotes).forEach((entry) => {
      if (!entry?.note?.trim()) return;
      const fullText = `[${entry.exerciseName}] ${entry.note.trim()}`;
      if (!seenNoteTexts.has(fullText) && fullText.length > 3) {
        seenNoteTexts.add(fullText);
        rowsToInsert.push({
          id_workout: workoutRunId,
          testo: fullText,
        });
      }
    });

    const generalNoteTrimmed = (workoutGeneralNoteRef.current || workoutGeneralNote).trim();
    if (generalNoteTrimmed.length > 0) {
      rowsToInsert.unshift({
        id_workout: workoutRunId,
        testo: `[Scheda] ${generalNoteTrimmed}`,
      });
    }

    if (rowsToInsert.length === 0) {
      workoutNotesSavedRef.current = true;
      return;
    }

    const { error } = await supabase.from('note_workout').insert(rowsToInsert);

    if (error) {
      console.error('Error saving workout notes:', error);
      return;
    }

    workoutNotesSavedRef.current = true;
  };

  // Timer logic for REST
  useEffect(() => {
    if (!isResting || restEndsAtMs == null) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const syncRestCountdown = () => {
      const nextRemaining = computeRemainingFromEndsAt(restEndsAtMs);
      setRestRemaining((prev) => (prev === nextRemaining ? prev : nextRemaining));
      pipManager.updateRemaining(nextRemaining);

      if (nextRemaining <= 0) {
        if (lastHandledRestCompletionEndsAtMsRef.current === restEndsAtMs) {
          return;
        }
        lastHandledRestCompletionEndsAtMsRef.current = restEndsAtMs;

        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        const expiredRestEndsAtMs = restEndsAtMs;
        setRestEndsAtMs(null);
        stopRestMediaSession();
        pipManager.closePiP();
        if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
          playRestFinishedSound();
        }

        const upcoming = getUpcomingRestTargetInfo();
        void sendRestFinishedNotification({
          nextExerciseName: upcoming.nextExerciseName,
          nextSetInfo: upcoming.nextSetInfo,
          endsAtMs: expiredRestEndsAtMs,
        });

        if (isWorkoutOverviewModalOpen) {
          setIsWorkoutOverviewAdvancePending(true);
          return;
        }
        setIsResting(false);
        finishRestAndNextSet(true);
      }
    };

    const handleWakeSync = () => {
      if (document.visibilityState === 'visible') {
        syncRestCountdown();
      }
    };

    intervalId = setInterval(syncRestCountdown, 250);
    syncRestCountdown();
    document.addEventListener('visibilitychange', handleWakeSync);
    window.addEventListener('focus', handleWakeSync);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleWakeSync);
      window.removeEventListener('focus', handleWakeSync);
    };
  }, [isResting, restEndsAtMs, isWorkoutOverviewModalOpen, getUpcomingRestTargetInfo]);

  // Sincronizzazione Titolo Scheda per il recupero (zero audio)
  useEffect(() => {
    if (!isResting) {
      stopRestMediaSession();
      pipManager.closePiP();
      return;
    }

    const isRunning = restEndsAtMs != null;
    const currentEx = workout?.exercises[currentExerciseIdx];
    const totalDuration = restInitialDuration > 0
      ? restInitialDuration
      : (currentEx?.rest_seconds || 60);

    updateRestMediaSession({
      totalSeconds: totalDuration,
      remainingSeconds: restRemaining,
      isRunning,
    });
  }, [isResting, restEndsAtMs, restRemaining, restInitialDuration, workout, currentExerciseIdx]);

  useEffect(() => {
    if (!isResting || restRemaining > 3 || restRemaining <= 0) {
      lastCountdownRestRef.current = null;
      return;
    }
    if (lastCountdownRestRef.current === restRemaining) return;
    lastCountdownRestRef.current = restRemaining;
    if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
      playCountdownBeep(restRemaining);
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(60);
      } catch {
        // ignore
      }
    }
  }, [isResting, restRemaining, voiceAssistanceEnabled]);

  // Timer logic for EMOM
  useEffect(() => {
    if (!emomActive || emomRoundEndsAtMs == null) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const syncEmomCountdown = () => {
      const nextRemaining = computeRemainingFromEndsAt(emomRoundEndsAtMs);
      setEmomRoundRemaining((prev) => (prev === nextRemaining ? prev : nextRemaining));

      if (nextRemaining <= 0) {
        if (lastHandledEmomCompletionEndsAtMsRef.current === emomRoundEndsAtMs) {
          return;
        }
        lastHandledEmomCompletionEndsAtMsRef.current = emomRoundEndsAtMs;

        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }

        const ex = workout?.exercises[currentExerciseIdx];
        if (ex && ex.type === 'emom') {
          if (currentEmomRoundIdx < getEffectiveEmomRounds(ex) - 1) {
            if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
              playRestFinishedSound();
            }
            speakCue('next round');
            setCurrentEmomRoundIdx(prev => prev + 1);
            setEmomRoundRemainingWithSync(ex.emom_round_duration || 60);
          } else {
            if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
              playRestFinishedSound();
            }
            stopEmomCountdown();
            const isLastSetInEmomExercise = currentSetIdx === ex.sets - 1;
            if (isLastSetInEmomExercise) {
              queueNextExerciseFlow(ex);
            } else {
              startRestCountdown(ex.rest_seconds);
            }
          }
        } else {
          stopEmomCountdown();
        }
      }
    };

    const handleWakeSync = () => {
      if (document.visibilityState === 'hidden') return;
      syncEmomCountdown();
    };

    intervalId = setInterval(syncEmomCountdown, 250);
    syncEmomCountdown();
    document.addEventListener('visibilitychange', handleWakeSync);
    window.addEventListener('focus', handleWakeSync);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleWakeSync);
      window.removeEventListener('focus', handleWakeSync);
    };
  }, [emomActive, emomRoundEndsAtMs, currentSetIdx, currentEmomRoundIdx, workout, currentExerciseIdx, voiceAssistanceEnabled]);

  useEffect(() => {
    if (!emomActive || emomRoundRemaining > 3 || emomRoundRemaining <= 0) {
      lastCountdownEmomRef.current = null;
      return;
    }
    if (lastCountdownEmomRef.current === emomRoundRemaining) return;
    lastCountdownEmomRef.current = emomRoundRemaining;
    if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
      playCountdownBeep(emomRoundRemaining);
      speakCue(String(emomRoundRemaining));
    }
  }, [emomActive, emomRoundRemaining, voiceAssistanceEnabled]);

  useEffect(() => {
    if (!wasEmomActiveRef.current && emomActive && emomRoundRemaining > 0) {
      speakCue('start');
    }
    wasEmomActiveRef.current = emomActive;
  }, [emomActive, emomRoundRemaining]);

  // Timer logic for ISOMETRY
  useEffect(() => {
    if (!isometryActive || isometryEndsAtMs == null) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const syncIsometryCountdown = () => {
      const nextRemaining = computeRemainingFromEndsAt(isometryEndsAtMs);
      setIsometryRemaining((prev) => (prev === nextRemaining ? prev : nextRemaining));

      if (nextRemaining <= 0) {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        setIsometryEndsAtMs(null);
        setIsometryActive(false);
        if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
          playRestFinishedSound();
        }
      }
    };

    const handleWakeSync = () => {
      if (document.visibilityState === 'hidden') return;
      syncIsometryCountdown();
    };

    intervalId = setInterval(syncIsometryCountdown, 250);
    syncIsometryCountdown();
    document.addEventListener('visibilitychange', handleWakeSync);
    window.addEventListener('focus', handleWakeSync);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleWakeSync);
      window.removeEventListener('focus', handleWakeSync);
    };
  }, [isometryActive, isometryEndsAtMs]);

  // Timer logic for MAX ISOMETRY stopwatch (conteggio in avanti fino a cedimento)
  useEffect(() => {
    if (!isometryStopwatchActive || isometryStopwatchStartMsRef.current == null) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const syncElapsed = () => {
      const startMs = isometryStopwatchStartMsRef.current;
      if (startMs == null) return;
      const elapsed = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setIsometryElapsedSeconds(elapsed);
    };

    intervalId = setInterval(syncElapsed, 250);
    syncElapsed();

    const handleWakeSync = () => {
      if (document.visibilityState === 'hidden') return;
      syncElapsed();
    };

    document.addEventListener('visibilitychange', handleWakeSync);
    window.addEventListener('focus', handleWakeSync);

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleWakeSync);
      window.removeEventListener('focus', handleWakeSync);
    };
  }, [isometryStopwatchActive]);

  useEffect(() => {
    if (!isometryActive || isometryRemaining > 3 || isometryRemaining <= 0) {
      lastCountdownIsometryRef.current = null;
      return;
    }
    if (lastCountdownIsometryRef.current === isometryRemaining) return;
    lastCountdownIsometryRef.current = isometryRemaining;
    if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
      playCountdownBeep(isometryRemaining);
      speakCue(String(isometryRemaining));
    }
  }, [isometryActive, isometryRemaining, voiceAssistanceEnabled]);

  useEffect(() => {
    if (!wasIsometryActiveRef.current && isometryActive && isometryRemaining > 0) {
      speakCue('start');
    }
    wasIsometryActiveRef.current = isometryActive;
  }, [isometryActive, isometryRemaining]);

  useEffect(() => {
    if (location.state?.autoCompleteAction && workout && !loading) {
      navigate(location.pathname, { replace: true, state: {} });
      setTimeout(() => {
        if (handlePrimaryActionRef.current) {
          handlePrimaryActionRef.current();
        }
      }, 100);
    }
  }, [location.state?.autoCompleteAction, workout, loading, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
      </div>
    );
  }

  if (!workout || workout.exercises.length === 0) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col p-6 items-center justify-center">
        <h2 className="text-xl font-bold text-white mb-4">No exercises found.</h2>
        <button onClick={() => navigate(-1)} className="text-brand-orange">Go Back</button>
      </div>
    );
  }

  const currentExercise = workout.exercises[currentExerciseIdx];
  const isLastExercise = currentExerciseIdx === workout.exercises.length - 1;
  const isLastSet = currentSetIdx === currentExercise.sets - 1;
  const isEmom = currentExercise.type === 'emom';
  const effectiveEmomRounds = getEffectiveEmomRounds(currentExercise);
  const isLastEmomRound = currentEmomRoundIdx === effectiveEmomRounds - 1;
  const totalEmomRoundDuration = Math.max(1, currentExercise.emom_round_duration || 60);
  const emomRoundProgressRatio = Math.max(0, Math.min(1, emomRoundRemaining / totalEmomRoundDuration));
  const isPyramid = currentExercise.type === 'pyramid';
  const isLastPyramidStep = currentPyramidStepIdx === ((currentExercise.pyramid_steps?.length || 1) - 1);

  useEffect(() => {
    if (!isPyramid) return;
    const timer = window.setTimeout(() => {
      if (activePyramidStepRef.current) {
        activePyramidStepRef.current.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [currentPyramidStepIdx, currentExerciseIdx, isPyramid]);

  const isCircuit = currentExercise.type === 'circuit';
  const isSuperset = currentExercise.type === 'superset';
  const isGroup = isSuperset || isCircuit;
  const subExercise = isSuperset && currentExercise.subExercises ? currentExercise.subExercises[currentSubExerciseIdx] : null;
  const isFinalCompletionAction = isLastExercise && (
    isEmom
      ? (isLastSet && isLastEmomRound)
      : isPyramid
        ? isLastPyramidStep
        : isLastSet
  );


  const currentExerciseNoteEntry = getExerciseNoteEntry(currentExerciseIdx, currentExercise);
  const hasCurrentWorkoutNote = Boolean(currentExerciseNoteEntry?.note?.trim());
  const hasGeneralWorkoutNote = Boolean((workoutGeneralNoteRef.current || workoutGeneralNote).trim());

  const getCurrentInstructionContext = (): InstructionModalContext | null => {
    if (isGroup) {
      const groupName = String(currentExercise.name || '').trim() || `Exercise ${currentExerciseIdx + 1}`;
      const groupNote = String(currentExercise.instruction_note || '').trim() || null;
      const groupItems = (currentExercise.subExercises || [])
        .map((item, idx) => {
          const note = String(item.instruction_note || '').trim();
          if (!note) return null;
          return {
            name: String(item.name || '').trim() || `Exercise ${idx + 1}`,
            note,
          };
        })
        .filter((item): item is InstructionModalItem => item !== null);

      if (!groupNote && groupItems.length === 0) return null;
      return {
        exerciseName: groupName,
        note: groupNote,
        items: groupItems,
      };
    }

    if (isEmom) {
      const emomName = String(currentExercise.name || '').trim() || `Exercise ${currentExerciseIdx + 1}`;
      const rawEmomNote = String(currentExercise.instruction_note || '').trim();
      const emomItems = (currentExercise.subExercises || [])
        .map((item, idx) => {
          const note = String(item.instruction_note || '').trim();
          if (!note) return null;
          return {
            name: String(item.name || '').trim() || `Exercise ${idx + 1}`,
            note,
          };
        })
        .filter((item): item is InstructionModalItem => item !== null);

      const emomNote = emomItems.length === 0 && rawEmomNote ? rawEmomNote : null;

      if (!emomNote && emomItems.length === 0) return null;
      return {
        exerciseName: emomName,
        note: emomNote,
        items: emomItems,
      };
    }

    const baseNote = String(currentExercise.instruction_note || '').trim();
    if (!baseNote) return null;

    return {
      exerciseName: String(currentExercise.name || '').trim() || `Exercise ${currentExerciseIdx + 1}`,
      note: baseNote,
      items: [],
    };
  };

  const currentInstructionContext = getCurrentInstructionContext();
  const hasCurrentInstructionNote = currentInstructionContext !== null;

  const formatWeightDraft = (value?: number | null) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return String(Math.round(n * 100) / 100).replace('.', ',');
  };

  const formatTargetDraft = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return String(Math.max(0, Math.trunc(n)));
  };

  const parseStrictInt = (raw: string, label: string, allowZero = false) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`${label} must be an integer value.`);
    }
    if (allowZero ? n < 0 : n <= 0) {
      throw new Error(`${label} must be ${allowZero ? '>= 0' : '> 0'}.`);
    }
    return n;
  };

  const parseOptionalWeight = (raw: string) => {
    const normalized = raw.trim().replace(',', '.');
    if (!normalized) return null;
    const n = Number(normalized);
    if (!Number.isFinite(n)) {
      throw new Error('Weight must be a valid number.');
    }
    if (n < 0) {
      throw new Error('Weight must be >= 0.');
    }
    if (n === 0) {
      return null;
    }
    return Math.round(n * 100) / 100;
  };

  const toNonNegativeInt = (raw: string, max?: number) => {
    const parsed = Math.trunc(Number(raw));
    if (!Number.isFinite(parsed)) return 0;
    if (parsed < 0) return 0;
    if (typeof max === 'number' && parsed > max) return max;
    return parsed;
  };

  const toDurationParts = (rawSeconds: string) => {
    const total = toNonNegativeInt(rawSeconds);
    return {
      minutes: Math.floor(total / 60),
      seconds: total % 60,
    };
  };

  const updateEmomRoundDurationPart = (part: 'min' | 'sec', value: string) => {
    setExerciseEditDraft((prev) => {
      const current = toDurationParts(prev.emomRoundDuration);
      const nextMinutes = part === 'min' ? toNonNegativeInt(value) : current.minutes;
      const nextSeconds = part === 'sec' ? toNonNegativeInt(value, 59) : current.seconds;
      return {
        ...prev,
        emomRoundDuration: String((nextMinutes * 60) + nextSeconds),
      };
    });
  };

  const buildSubExerciseDrafts = (subExercises: Exercise['subExercises']) => {
    return (subExercises || []).map((sub, index) => ({
      name: String(sub?.name || '').trim() || `Exercise ${index + 1}`,
      type: sub?.type || 'reps',
      reps: formatTargetDraft(sub?.reps),
      durationSeconds: formatTargetDraft(sub?.duration_seconds),
      weightKg: formatWeightDraft(sub?.weight_kg),
    }));
  };

  const buildPyramidStepDrafts = (steps: Exercise['pyramid_steps']) => {
    return (steps || []).map((step) => ({
      reps: formatTargetDraft(step?.reps),
      restSeconds: String(Math.max(0, Math.trunc(step?.rest_seconds || 0))),
      weightKg: formatWeightDraft(step?.weight_kg),
    }));
  };

  const updateSubExerciseDraft = (index: number, patch: Partial<ExerciseEditDraft['subExerciseDrafts'][number]>) => {
    setExerciseEditDraft((prev) => ({
      ...prev,
      subExerciseDrafts: prev.subExerciseDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const updatePyramidStepDraft = (index: number, patch: Partial<ExerciseEditDraft['pyramidStepDrafts'][number]>) => {
    setExerciseEditDraft((prev) => ({
      ...prev,
      pyramidStepDrafts: prev.pyramidStepDrafts.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const openEditExerciseModal = (targetIndex?: number) => {
    if (!workout?.exercises) return;
    const targetExIdx = targetIndex != null ? targetIndex : currentExerciseIdx;
    const targetExercise = workout.exercises[targetExIdx];
    if (!targetExercise) return;

    setEditingExerciseIdx(targetExIdx);

    const isCurrent = targetExIdx === currentExerciseIdx;
    const currentSub = isCurrent
      ? (isGroup ? subExercise : null)
      : (targetExercise.subExercises?.[0] || null);
    const currentStep = targetExercise.type === 'pyramid'
      ? (isCurrent ? targetExercise.pyramid_steps?.[currentPyramidStepIdx] : targetExercise.pyramid_steps?.[0])
      : null;

    setExerciseEditDraft({
      sets: String(targetExercise.sets || 1),
      restSeconds: String(targetExercise.rest_seconds || 0),
      reps: formatTargetDraft(targetExercise.reps),
      durationSeconds: formatTargetDraft(targetExercise.duration_seconds),
      weightKg: formatWeightDraft(targetExercise.weight_kg),
      emomRounds: String(getEffectiveEmomRounds(targetExercise)),
      emomRoundDuration: String(targetExercise.emom_round_duration || 60),
      currentSubReps: formatTargetDraft(currentSub?.reps),
      currentSubDuration: formatTargetDraft(currentSub?.duration_seconds),
      currentSubWeightKg: formatWeightDraft(currentSub?.weight_kg),
      currentStepReps: formatTargetDraft(currentStep?.reps),
      currentStepRestSeconds: String(currentStep?.rest_seconds || 0),
      currentStepWeightKg: formatWeightDraft(currentStep?.weight_kg),
      subExerciseDrafts: buildSubExerciseDrafts(targetExercise.subExercises),
      pyramidStepDrafts: buildPyramidStepDrafts(targetExercise.pyramid_steps),
    });
    setExerciseEditError(null);
    setIsEditExerciseModalOpen(true);
  };

  const closeEditExerciseModal = () => {
    if (isSavingExerciseEdit) return;
    setIsEditExerciseModalOpen(false);
    setEditingExerciseIdx(null);
    setExerciseEditError(null);
  };

  const openExerciseNoteModal = (targetIndex?: number) => {
    if (!workout?.exercises) return;
    const targetIdx = targetIndex != null ? targetIndex : currentExerciseIdx;
    const targetEx = workout.exercises[targetIdx] || currentExercise;
    const existingExerciseNote = getExerciseNoteEntry(targetIdx, targetEx)?.note || '';
    const orderStr = `${targetIdx + 1}`;
    const exerciseKey = String(targetEx.id);
    const targetName = String(targetEx.name || '').trim() || `Esercizio ${targetIdx + 1}`;

    setNoteModalContext({
      key: exerciseKey,
      name: `${orderStr}. ${targetName}`,
      exerciseIndex: targetIdx,
      exercise: targetEx,
    });
    setNoteModalDraft(existingExerciseNote);
    setIsNoteModalOpen(true);
  };

  const openCurrentExerciseNoteModal = () => {
    openExerciseNoteModal(currentExerciseIdx);
  };

  const closeCurrentExerciseNoteModal = () => {
    setIsNoteModalOpen(false);
    setNoteModalDraft('');
    setNoteModalContext(null);
  };

  const openCurrentInstructionModal = () => {
    if (!currentInstructionContext) return;
    setInstructionModalContext(currentInstructionContext);
    setIsInstructionModalOpen(true);
  };

  const openWorkoutOverviewModal = () => {
    setIsWorkoutOverviewModalOpen(true);
  };

  const closeWorkoutOverviewModal = () => {
    setIsWorkoutOverviewModalOpen(false);
    setIsEditingGeneralNoteInOverview(false);
    if (isWorkoutOverviewAdvancePending) {
      setIsWorkoutOverviewAdvancePending(false);
      setIsResting(false);
      finishRestAndNextSet(true);
    }
  };

  const handleSaveGeneralNoteInOverview = () => {
    const trimmed = overviewGeneralNoteDraft.trim();
    setWorkoutGeneralNote(trimmed);
    workoutGeneralNoteRef.current = trimmed;
    setIsEditingGeneralNoteInOverview(false);
    void hapticLight();
  };

  const closeCurrentInstructionModal = () => {
    setIsInstructionModalOpen(false);
    setInstructionModalContext(null);
  };

  const saveCurrentExerciseNote = () => {
    if (noteModalContext) {
      const trimmedExerciseNote = noteModalDraft.trim();
      const targetIdx = noteModalContext.exerciseIndex != null ? noteModalContext.exerciseIndex : currentExerciseIdx;
      const targetEx = noteModalContext.exercise || workout?.exercises[targetIdx] || currentExercise;

      setExerciseNotesByKey((prev) => {
        const next = { ...prev };
        const primaryKey = noteModalContext.key;
        const idxKey = `idx_${targetIdx}`;
        const orderKey = `order_${targetEx.order_index ?? targetIdx + 1}`;
        const cleanName = (targetEx.name || '').trim().toLowerCase();
        const nameKey = cleanName ? `name_${cleanName}` : '';

        const countWithName = cleanName && workout?.exercises
          ? workout.exercises.filter((item) => (item.name || '').trim().toLowerCase() === cleanName).length
          : 0;
        const isNameUnique = countWithName === 1;

        if (!trimmedExerciseNote) {
          delete next[primaryKey];
          delete next[idxKey];
          delete next[orderKey];
          if (nameKey) delete next[nameKey];
        } else {
          const entry = {
            exerciseName: `${targetIdx + 1}. ${targetEx.name || noteModalContext.name}`,
            note: trimmedExerciseNote,
          };
          next[primaryKey] = entry;
          next[idxKey] = entry;
          next[orderKey] = entry;
          if (isNameUnique && nameKey) {
            next[nameKey] = entry;
          } else if (nameKey) {
            delete next[nameKey];
          }
        }
        exerciseNotesByKeyRef.current = next;
        return next;
      });

      setTimeout(() => {
        persistWorkoutProgress(true);
      }, 50);
    }

    void hapticLight();
    closeCurrentExerciseNoteModal();
  };

  const saveCurrentExerciseEdits = async () => {
    if (!workout) return;

    const targetExIdx = editingExerciseIdx != null ? editingExerciseIdx : currentExerciseIdx;
    const targetExercise = workout.exercises[targetExIdx];
    if (!targetExercise) return;

    setIsSavingExerciseEdit(true);
    setExerciseEditError(null);

    try {
      const schedaId = sourceSchedaId;
      const nextSubExerciseDrafts = exerciseEditDraft.subExerciseDrafts;
      const nextPyramidStepDrafts = exerciseEditDraft.pyramidStepDrafts;

      const isEditingCurrent = targetExIdx === currentExerciseIdx;
      const minAllowedSets = isEditingCurrent ? currentSetIdx + 1 : 1;

      if (targetExercise.type === 'emom') {
        const nextSets = parseStrictInt(exerciseEditDraft.sets, 'Sets');
        const nextRounds = parseStrictInt(exerciseEditDraft.emomRounds, 'Rounds');
        const nextRoundDuration = parseStrictInt(exerciseEditDraft.emomRoundDuration, 'Round duration');
        const nextRest = parseStrictInt(exerciseEditDraft.restSeconds, 'Rest', true);

        if (nextSets < minAllowedSets) {
          throw new Error(`Sei attualmente al set ${minAllowedSets}. I set totali non possono essere inferiori.`);
        }

        const minAllowedRounds = isEditingCurrent ? currentEmomRoundIdx + 1 : 1;
        if (nextRounds < minAllowedRounds) {
          throw new Error(`Sei attualmente al round ${minAllowedRounds}. I round totali non possono essere inferiori.`);
        }

        if (schedaId != null) {
          const { error: emomTableError } = await supabase
            .from('emom')
            .update({
              round_totali: nextRounds,
              durata_round_secondi: nextRoundDuration,
            })
            .eq('id_emom', Number(targetExercise.id));
          if (emomTableError) throw emomTableError;

          const { error: emomRowsError } = await supabase
            .from('esecuzioni')
            .update({
              set_num: nextSets,
              rest_secondi: nextRest > 0 ? nextRest : null,
            })
            .eq('id_scheda', schedaId)
            .eq('id_emom', Number(targetExercise.id));
          if (emomRowsError) throw emomRowsError;

          const emomSubExercises = targetExercise.subExercises || [];
          if (nextSubExerciseDrafts.length === emomSubExercises.length) {
            const { data: emomRows, error: emomFetchError } = await supabase
              .from('esecuzioni')
              .select('id_esecuzione, ordine')
              .eq('id_scheda', schedaId)
              .eq('id_emom', Number(targetExercise.id))
              .order('ordine', { ascending: true });
            if (emomFetchError) throw emomFetchError;

            if ((emomRows?.length || 0) >= nextSubExerciseDrafts.length) {
              await Promise.all((emomRows || []).slice(0, nextSubExerciseDrafts.length).map(async (row, index) => {
                const currentSub = emomSubExercises[index];
                const draft = nextSubExerciseDrafts[index];
                if (!currentSub || !draft) return;

                const nextSubWeight = parseOptionalWeight(draft.weightKg);
                const nextSubReps = currentSub.type === 'reps' ? parseStrictInt(draft.reps, 'EMOM reps', true) : null;
                const nextSubDuration = (currentSub.type === 'isometry' || currentSub.type === 'cardio') ? parseStrictInt(draft.durationSeconds, 'EMOM duration', true) : null;

                const { error: currentSubUpdateError } = await supabase
                  .from('esecuzioni')
                  .update({
                    reps: nextSubReps,
                    durata_secondi: nextSubDuration,
                    peso_kg: nextSubWeight,
                  })
                  .eq('id_scheda', schedaId)
                  .eq('id_esecuzione', row.id_esecuzione);
                if (currentSubUpdateError) throw currentSubUpdateError;
              }));
            }
          }
        }

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          exercises[targetExIdx] = {
            ...exercises[targetExIdx],
            sets: nextSets,
            rest_seconds: nextRest,
            emom_rounds: nextRounds,
            emom_round_duration: nextRoundDuration,
            duration_seconds: nextRoundDuration,
            subExercises: (exercises[targetExIdx].subExercises || []).map((sub, index) => {
              const draft = nextSubExerciseDrafts[index];
              if (!draft) return sub;
              return {
                ...sub,
                reps: sub.type === 'reps' ? parseStrictInt(draft.reps, 'EMOM reps', true) : sub.reps,
                duration_seconds: (sub.type === 'isometry' || sub.type === 'cardio') ? parseStrictInt(draft.durationSeconds, 'EMOM duration', true) : sub.duration_seconds,
                weight_kg: parseOptionalWeight(draft.weightKg),
              };
            }),
          };
          return { ...prev, exercises };
        });

        if (isEditingCurrent) {
          setEmomRoundRemainingWithSync(Math.min(emomRoundRemaining, nextRoundDuration));
        }
      } else if (targetExercise.type === 'superset' || targetExercise.type === 'circuit') {
        const nextSets = parseStrictInt(exerciseEditDraft.sets, 'Rounds');
        const nextRest = parseStrictInt(exerciseEditDraft.restSeconds, 'Rest', true);
        if (nextSets < minAllowedSets) {
          throw new Error(`Sei attualmente al round ${minAllowedSets}. I round totali non possono essere inferiori.`);
        }

        const currentSupersetExercises = targetExercise.subExercises || [];
        if (nextSubExerciseDrafts.length !== currentSupersetExercises.length) {
          throw new Error('Impossibile mappare tutti gli esercizi del superset.');
        }

        if (schedaId != null) {
          const supersetId = Number(targetExercise.id);
          const { error: supersetTableError } = await supabase
            .from('superset')
            .update({
              round_totali: nextSets,
            })
            .eq('id_superset', supersetId);
          if (supersetTableError) throw supersetTableError;

          const { error: supersetRowsError } = await supabase
            .from('esecuzioni')
            .update({
              set_num: nextSets,
              rest_secondi: nextRest > 0 ? nextRest : null,
            })
            .eq('id_scheda', schedaId)
            .eq('id_superset', supersetId);
          if (supersetRowsError) throw supersetRowsError;

          const { data: supersetRows, error: supersetFetchError } = await supabase
            .from('esecuzioni')
            .select('id_esecuzione, ordine')
            .eq('id_scheda', schedaId)
            .eq('id_superset', supersetId)
            .order('ordine', { ascending: true });
          if (supersetFetchError) throw supersetFetchError;

          if ((supersetRows?.length || 0) >= nextSubExerciseDrafts.length) {
            await Promise.all((supersetRows || []).slice(0, nextSubExerciseDrafts.length).map(async (row, index) => {
              const currentSub = currentSupersetExercises[index];
              const draft = nextSubExerciseDrafts[index];
              if (!currentSub || !draft) return;

              const nextSubWeight = parseOptionalWeight(draft.weightKg);
              const nextSubReps = currentSub.type === 'reps' ? parseStrictInt(draft.reps, 'Superset reps', true) : null;
              const nextSubDuration = (currentSub.type === 'isometry' || currentSub.type === 'cardio') ? parseStrictInt(draft.durationSeconds, 'Superset duration', true) : null;

              const { error: currentSubUpdateError } = await supabase
                .from('esecuzioni')
                .update({
                  reps: nextSubReps,
                  durata_secondi: nextSubDuration,
                  peso_kg: nextSubWeight,
                })
                .eq('id_scheda', schedaId)
                .eq('id_esecuzione', row.id_esecuzione);
              if (currentSubUpdateError) throw currentSubUpdateError;
            }));
          }
        }

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          const updated = { ...exercises[targetExIdx] };
          updated.sets = nextSets;
          updated.rest_seconds = nextRest;
          updated.subExercises = (updated.subExercises || []).map((sub, index) => {
            const draft = nextSubExerciseDrafts[index];
            if (!draft) return sub;
            return {
              ...sub,
              reps: sub.type === 'reps' ? parseStrictInt(draft.reps, 'Superset reps', true) : sub.reps,
              duration_seconds: (sub.type === 'isometry' || sub.type === 'cardio') ? parseStrictInt(draft.durationSeconds, 'Superset duration', true) : sub.duration_seconds,
              weight_kg: parseOptionalWeight(draft.weightKg),
            };
          });
          exercises[targetExIdx] = updated;
          return { ...prev, exercises };
        });
      } else if (targetExercise.type === 'pyramid') {
        const pyramidSteps = targetExercise.pyramid_steps || [];
        if (nextPyramidStepDrafts.length !== pyramidSteps.length) {
          throw new Error('Impossibile mappare tutti gli step della piramide.');
        }

        if (schedaId != null) {
          const { data: pyramidRows, error: pyramidFetchError } = await supabase
            .from('esecuzioni')
            .select('id_esecuzione, ordine, stepindex_piramide')
            .eq('id_scheda', schedaId)
            .eq('id_piramide', Number(targetExercise.id))
            .order('ordine', { ascending: true });
          if (pyramidFetchError) throw pyramidFetchError;

          if ((pyramidRows?.length || 0) >= nextPyramidStepDrafts.length) {
            await Promise.all((pyramidRows || []).slice(0, nextPyramidStepDrafts.length).map(async (row, index) => {
              const draft = nextPyramidStepDrafts[index];
              if (!draft) return;

              const nextStepReps = parseStrictInt(draft.reps, 'Step reps', true);
              const nextStepRest = parseStrictInt(draft.restSeconds, 'Step rest', true);
              const nextStepWeight = parseOptionalWeight(draft.weightKg);

              const { error: rowUpdateError } = await supabase
                .from('esecuzioni')
                .update({
                  reps: nextStepReps,
                  rest_secondi: nextStepRest > 0 ? nextStepRest : null,
                  peso_kg: nextStepWeight,
                })
                .eq('id_scheda', schedaId)
                .eq('id_esecuzione', row.id_esecuzione);
              if (rowUpdateError) throw rowUpdateError;
            }));
          }
        }

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          const updated = { ...exercises[targetExIdx] };
          updated.pyramid_steps = (updated.pyramid_steps || []).map((step, index) => {
            const draft = nextPyramidStepDrafts[index];
            if (!draft) return step;
            return {
              ...step,
              reps: parseStrictInt(draft.reps, 'Step reps', true),
              rest_seconds: parseStrictInt(draft.restSeconds, 'Step rest', true),
              weight_kg: parseOptionalWeight(draft.weightKg),
            };
          });
          exercises[targetExIdx] = updated;
          return { ...prev, exercises };
        });
      } else {
        const nextSets = parseStrictInt(exerciseEditDraft.sets, 'Sets');
        const nextRest = parseStrictInt(exerciseEditDraft.restSeconds, 'Rest', true);
        const nextWeight = parseOptionalWeight(exerciseEditDraft.weightKg);

        if (nextSets < minAllowedSets) {
          throw new Error(`Sei attualmente al set ${minAllowedSets}. I set totali non possono essere inferiori.`);
        }

        const isIso = targetExercise.type === 'isometry' || targetExercise.type === 'cardio';
        const nextReps = isIso ? targetExercise.reps : parseStrictInt(exerciseEditDraft.reps, 'Reps', true);
        const nextDuration = isIso
          ? parseStrictInt(exerciseEditDraft.durationSeconds, 'Duration', true)
          : targetExercise.duration_seconds;

        if (schedaId != null) {
          const basePayload = {
            set_num: nextSets,
            rest_secondi: nextRest > 0 ? nextRest : null,
            peso_kg: nextWeight,
            reps: isIso ? null : nextReps,
            durata_secondi: isIso ? nextDuration : null,
          };
          const { error: baseUpdateError } = await supabase
            .from('esecuzioni')
            .update(basePayload)
            .eq('id_scheda', schedaId)
            .eq('id_esecuzione', Number(targetExercise.id));
          if (baseUpdateError) throw baseUpdateError;
        }

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          exercises[targetExIdx] = {
            ...exercises[targetExIdx],
            sets: nextSets,
            rest_seconds: nextRest,
            weight_kg: nextWeight,
            reps: nextReps,
            duration_seconds: nextDuration,
          };
          return { ...prev, exercises };
        });

        if (isEditingCurrent && isIso) {
          setIsometryRemainingWithSync(Math.min(isometryRemaining, nextDuration));
        }
      }

      setIsEditExerciseModalOpen(false);
      setEditingExerciseIdx(null);
      void hapticSuccess();
      setTimeout(() => {
        persistWorkoutProgress(true);
      }, 50);
    } catch (error: any) {
      console.error('Error saving live exercise edits:', error);
      setExerciseEditError(error?.message || 'Impossibile salvare le modifiche.');
    } finally {
      setIsSavingExerciseEdit(false);
    }
  };

  const toSafeTargetInt = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.trunc(n));
  };

  const isMaxTarget = (value: unknown) => toSafeTargetInt(value) === 0;

  const formatBigTargetValue = (value: unknown) => {
    return isMaxTarget(value) ? 'MAX' : String(toSafeTargetInt(value));
  };

  const formatSupersetTaskMetricLabel = (sub: { type: 'reps' | 'isometry' | 'cardio'; reps: number; duration_seconds: number }) => {
    if (sub.type === 'reps') {
      return isMaxTarget(sub.reps) ? 'MAX reps' : `${toSafeTargetInt(sub.reps)} reps`;
    }
    return isMaxTarget(sub.duration_seconds) ? 'MAX hold' : `${toSafeTargetInt(sub.duration_seconds)}s hold`;
  };

  const formatEmomTaskMetricLabel = (sub: { type: 'reps' | 'isometry' | 'cardio'; reps: number; duration_seconds: number }) => {
    if (sub.type === 'reps') {
      return isMaxTarget(sub.reps) ? 'MAX REPS' : `${toSafeTargetInt(sub.reps)} REPS`;
    }
    return isMaxTarget(sub.duration_seconds) ? 'MAX' : `${toSafeTargetInt(sub.duration_seconds)}s`;
  };

  const formatWeightLabel = (weight?: number | null) => {
    const n = Number(weight);
    if (!Number.isFinite(n) || n <= 0) return 'Body Weight';
    return `${n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`;
  };

  const getSupersetWeightLabel = () => {
    const labels = Array.from(new Set((currentExercise.subExercises || []).map((sub) => formatWeightLabel(sub.weight_kg))));
    if (labels.length === 0) return 'Body Weight';
    return labels.length === 1 ? labels[0] : 'Varies';
  };

  const getCurrentExecutionWeightLabel = () => {
    if (currentExercise.type === 'pyramid') {
      const stepWeight = currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.weight_kg;
      return formatWeightLabel(stepWeight);
    }
    if (currentExercise.type === 'superset' || currentExercise.type === 'circuit') {
      return getSupersetWeightLabel();
    }
    return formatWeightLabel(currentExercise.weight_kg);
  };

  const currentExecutionWeightLabel = getCurrentExecutionWeightLabel();
  const workoutOverviewExerciseNumber = currentExerciseIdx + 1;
  const workoutOverviewExerciseLabel = `EXERCISE ${workoutOverviewExerciseNumber} OF ${workout.exercises.length}`;
  const workoutRestOverviewExerciseLabel = `JUST FINISHED EXERCISE ${workoutOverviewExerciseNumber} OF ${workout.exercises.length}`;

  const getWorkoutOverviewTypeLabel = (exercise: Exercise) => {
    if (exercise.type === 'circuit') return 'CIRCUIT MODE';
    if (exercise.type === 'emom') return 'EMOM MODE';
    if (exercise.type === 'superset') return 'SUPERSET MODE';
    if (exercise.type === 'pyramid') return 'PYRAMID MODE';
    if (exercise.type === 'cardio') return 'CARDIO';
    if (exercise.type === 'isometry') return 'ISOMETRY';
    return 'REPS';
  };

  /**
   * Per esercizi speciali con un solo sub-esercizio, mostra il nome dell'esercizio.
   * Per esercizi con più sub-esercizi o esercizi standard, mostra il tipo.
   */
  const getWorkoutOverviewDisplayLabel = (exercise: Exercise) => {
    if ((exercise.type === 'superset' || exercise.type === 'circuit' || exercise.type === 'emom') &&
      exercise.subExercises &&
      exercise.subExercises.length === 1) {
      return exercise.subExercises[0].name || getWorkoutOverviewTypeLabel(exercise);
    }

    return getWorkoutOverviewTypeLabel(exercise);
  };

  const getWorkoutOverviewSummary = (exercise: Exercise) => {
    if (exercise.type === 'circuit') {
      return [
        `${exercise.sets || 1} giri`,
        `${exercise.subExercises?.length || 0} stazioni`,
        `${formatTime(exercise.rest_seconds || 0)} rest`,
      ];
    }

    if (exercise.type === 'emom') {
      return [
        `${exercise.sets || 1} sets`,
        `${getEffectiveEmomRounds(exercise)} rounds`,
        `${formatTime(exercise.emom_round_duration || 60)} per round`,
      ];
    }

    if (exercise.type === 'superset') {
      return [
        `${exercise.sets || 1} rounds`,
        `${exercise.subExercises?.length || 0} exercises`,
        `${formatTime(exercise.rest_seconds || 0)} rest`,
      ];
    }

    if (exercise.type === 'pyramid') {
      return [
        `${exercise.pyramid_steps?.length || 0} steps`,
        exercise.instruction_note ? 'Has notes' : 'No notes',
        formatWeightLabel(exercise.weight_kg),
      ];
    }

    if (exercise.type === 'isometry' || exercise.type === 'cardio') {
      return [
        `${exercise.sets || 1} sets`,
        `${isMaxTarget(exercise.duration_seconds) ? 'MAX' : formatTime(exercise.duration_seconds)}`,
        formatWeightLabel(exercise.weight_kg),
      ];
    }

    return [
      `${exercise.sets || 1} sets`,
      `${isMaxTarget(exercise.reps) ? 'MAX' : `${formatBigTargetValue(exercise.reps)} reps`}`,
      formatWeightLabel(exercise.weight_kg),
    ];
  };

  const specialExerciseLabel =
    currentExercise.type === 'circuit'
      ? 'CIRCUIT MODE'
      : currentExercise.type === 'emom'
        ? 'EMOM MODE'
        : currentExercise.type === 'superset'
          ? 'SUPERSET MODE'
          : currentExercise.type === 'pyramid'
            ? 'PYRAMID MODE'
            : currentExercise.type === 'cardio'
              ? 'CARDIO'
              : null;
  const specialExercisePillClass =
    currentExercise.type === 'cardio'
      ? 'border-rose-500/60 bg-rose-500/10 text-rose-400'
      : currentExercise.type === 'circuit' ||
        currentExercise.type === 'emom' ||
        currentExercise.type === 'superset' ||
        currentExercise.type === 'pyramid'
        ? 'border-brand-orange/60 bg-brand-orange/10 text-brand-orange'
        : '';

  const buildNextExerciseVoiceCue = (nextExercise: Exercise, _nextExerciseIndex: number) => {
    const name = String(nextExercise.name || '').trim();
    const parts: string[] = ['next exercise'];
    if (name) parts.push(name);

    if ((nextExercise.type === 'superset' || nextExercise.type === 'circuit' || nextExercise.type === 'emom') && nextExercise.subExercises && nextExercise.subExercises.length > 0) {
      const subParts = nextExercise.subExercises.map((sub) => {
        const subName = String(sub.name || '').trim();
        const subInfo: string[] = [];
        if (subName) subInfo.push(subName);
        if (sub.type === 'isometry') {
          if (sub.duration_seconds > 0) subInfo.push(`${sub.duration_seconds} seconds`);
        } else {
          if (sub.reps > 0) subInfo.push(`${sub.reps} reps`);
        }
        if (sub.weight_kg != null && sub.weight_kg > 0) subInfo.push(`${sub.weight_kg} kilos`);
        return subInfo.join(', ');
      });
      parts.push(subParts.join('. '));
    } else if (nextExercise.type === 'pyramid' && nextExercise.pyramid_steps) {
      const firstStep = nextExercise.pyramid_steps[0];
      if (firstStep) {
        if (firstStep.reps > 0) parts.push(`${firstStep.reps} reps`);
        if (firstStep.weight_kg != null && firstStep.weight_kg > 0) parts.push(`${firstStep.weight_kg} kilos`);
      }
    } else if (nextExercise.type === 'isometry' || nextExercise.type === 'cardio') {
      if (nextExercise.duration_seconds > 0) parts.push(`${nextExercise.duration_seconds} seconds`);
      if (nextExercise.weight_kg != null && nextExercise.weight_kg > 0) parts.push(`${nextExercise.weight_kg} kilos`);
    } else {
      if (nextExercise.reps > 0) parts.push(`${nextExercise.reps} reps`);
      if (nextExercise.weight_kg != null && nextExercise.weight_kg > 0) parts.push(`${nextExercise.weight_kg} kilos`);
    }

    return parts.join(', ');
  };

  const queueNextExerciseFlow = (sourceExercise: Exercise) => {
    const transitionRestSeconds = Math.max(0, Math.trunc(sourceExercise.transition_rest_seconds || 0));
    if (!isLastExercise && transitionRestSeconds > 0) {
      setPendingExerciseAdvance(true);
      const upcoming = getUpcomingRestTargetInfo(true);
      startRestCountdown(transitionRestSeconds, upcoming);
      return;
    }
    handleNextExercise();
  };

  const getNextRecoveryLabel = () => {
    const transitionRestSeconds = Math.max(0, Math.trunc(currentExercise.transition_rest_seconds || 0));

    if (currentExercise.type === 'emom') {
      const hasUpcomingSetRest = currentSetIdx < currentExercise.sets - 1;
      if (hasUpcomingSetRest) {
        return formatTime(currentExercise.rest_seconds || 0);
      }
      return transitionRestSeconds > 0 ? formatTime(transitionRestSeconds) : formatTime(0);
    }

    if (currentExercise.type === 'pyramid') {
      const stepRest = Math.max(0, Math.trunc(currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.rest_seconds || 0));
      if (!isLastPyramidStep && stepRest > 0) return formatTime(stepRest);
      return transitionRestSeconds > 0 ? formatTime(transitionRestSeconds) : formatTime(0);
    }

    const hasUpcomingRest = currentSetIdx < currentExercise.sets - 1;
    if (hasUpcomingRest) {
      return formatTime(currentExercise.rest_seconds || 0);
    }

    return transitionRestSeconds > 0 ? formatTime(transitionRestSeconds) : formatTime(0);
  };

  const handleNextExercise = () => {
    if (!isLastExercise) {
      const nextIdx = currentExerciseIdx + 1;
      const nextEx = workout.exercises[nextIdx];
      const shouldSuppressVoiceCue = suppressSwipeNextExerciseVoiceCueRef.current;
      suppressSwipeNextExerciseVoiceCueRef.current = false;
      if (!shouldSuppressVoiceCue) {
        speakCue(buildNextExerciseVoiceCue(nextEx, nextIdx));
      }
      setCurrentExerciseIdx(nextIdx);
      setCurrentSetIdx(0);
      setCurrentSubExerciseIdx(0);
      setCurrentEmomRoundIdx(0);
      setCurrentPyramidStepIdx(0);
      setPendingPyramidAdvance(false);
      setPendingExerciseAdvance(false);
      stopEmomCountdown();
      stopRestCountdown();
      stopIsometryCountdown();
      setCircuitLapTimes([]);
      resetCircuitStopwatch();
      setIsometryRemainingWithSync(getTargetIsometry(nextEx, nextEx.subExercises?.[0]));
      if (nextEx.type === 'emom') setEmomRoundRemainingWithSync(nextEx.emom_round_duration || 60);
      else setEmomRoundRemaining(0);
    } else {
      void completeWorkoutNow();
    }
  };

  const handlePrevExercise = () => {
    if (currentExerciseIdx > 0) {
      const prevIdx = currentExerciseIdx - 1;
      const prevEx = workout.exercises[prevIdx];
      setCurrentExerciseIdx(prevIdx);
      setCurrentSetIdx(0);
      setCurrentSubExerciseIdx(0);
      setCurrentEmomRoundIdx(0);
      setCurrentPyramidStepIdx(0);
      setPendingPyramidAdvance(false);
      setPendingExerciseAdvance(false);
      stopEmomCountdown();
      stopRestCountdown();
      stopIsometryCountdown();
      setCircuitLapTimes([]);
      resetCircuitStopwatch();
      setIsometryRemainingWithSync(getTargetIsometry(prevEx, prevEx.subExercises?.[0]));
      if (prevEx.type === 'emom') setEmomRoundRemainingWithSync(prevEx.emom_round_duration || 60);
      else setEmomRoundRemaining(0);
    }
  };

  const completeSet = () => {
    if (currentExercise.type === 'emom') {
      // Skipping round manually via button
      if (currentEmomRoundIdx < effectiveEmomRounds - 1) {
        speakCue('next round');
        setCurrentEmomRoundIdx(prev => prev + 1);
        setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
      } else {
        stopEmomCountdown();
        if (isLastSet) queueNextExerciseFlow(currentExercise);
        else { startRestCountdown(currentExercise.rest_seconds); }
      }
      return;
    }

    if (currentExercise.type === 'pyramid') {
      const steps = currentExercise.pyramid_steps || [];
      const currentStep = steps[currentPyramidStepIdx];
      const isLastStep = currentPyramidStepIdx >= steps.length - 1;

      if (isLastStep) {
        queueNextExerciseFlow(currentExercise);
      } else {
        const stepRest = Math.max(0, currentStep?.rest_seconds || 0);
        if (stepRest > 0) {
          setPendingPyramidAdvance(true);
          const nextStepIdx = currentPyramidStepIdx + 1;
          const totalSteps = steps.length;
          const step = steps[nextStepIdx];
          const reps = step ? (step.reps > 0 ? `${step.reps} reps` : 'MAX reps') : '';
          const upcomingPyramid = {
            nextExerciseName: currentExercise.name,
            nextSetInfo: `Step ${nextStepIdx + 1} di ${totalSteps}${reps ? ` • ${reps}` : ''}`,
          };
          startRestCountdown(stepRest, upcomingPyramid);
        } else {
          setCurrentPyramidStepIdx(prev => prev + 1);
        }
      }
      return;
    }

    if (currentExercise.type === 'circuit') {
      pauseCircuitStopwatch();
      const lapSecs = recordCircuitLapAndReset();
      const updatedLaps = [...circuitLapTimes, lapSecs];

      autoAppendCircuitTimeToNotes(currentExercise, currentExerciseIdx, updatedLaps);
      currentExercise.lap_durations_seconds = updatedLaps;
      currentExercise.total_circuit_duration_seconds = updatedLaps.reduce((a, b) => a + b, 0);

      if (isLastSet) {
        queueNextExerciseFlow(currentExercise);
      } else {
        const effectiveRest = currentExercise.rest_seconds > 0 ? currentExercise.rest_seconds : 60;
        startRestCountdown(effectiveRest);
      }
      return;
    }

    if (currentExercise.type === 'superset') {
      stopIsometryCountdown();
      if (isLastSet) {
        queueNextExerciseFlow(currentExercise);
      } else {
        if (currentExercise.rest_seconds > 0) {
          startRestCountdown(currentExercise.rest_seconds);
        } else {
          finishRestAndNextSet();
        }
      }
      return;
    }

    if (isLastSet) {
      queueNextExerciseFlow(currentExercise);
    } else {
      stopIsometryCountdown();
      startRestCountdown(currentExercise.rest_seconds);
    }
  };

  const resetCurrentExerciseTimerState = () => {
    setPendingPyramidAdvance(false);
    setPendingExerciseAdvance(false);
    setCurrentSubExerciseIdx(0);
    stopRestCountdown();
    stopEmomCountdown();
    stopIsometryCountdown();

    if (currentExercise.type === 'circuit') {
      resetCircuitStopwatch();
    }

    if (currentExercise.type === 'isometry' || currentExercise.type === 'cardio') {
      setIsometryRemainingWithSync(currentExercise.duration_seconds);
      return;
    }

    if (currentExercise.type === 'superset' || currentExercise.type === 'circuit') {
      const firstSub = currentExercise.subExercises?.[0];
      setIsometryRemainingWithSync((firstSub?.type === 'isometry' || firstSub?.type === 'cardio') ? firstSub.duration_seconds : 0);
      return;
    }

    setIsometryRemainingWithSync(0);
  };

  const advanceWithinCurrentExercise = () => {
    if (isResting || isNoteModalOpen || isInstructionModalOpen || isEditExerciseModalOpen) return;

    if (currentExercise.type === 'emom') {
      const rounds = effectiveEmomRounds;
      if (currentEmomRoundIdx >= rounds - 1) return;
      stopEmomCountdown();
      setCurrentEmomRoundIdx((prev) => Math.min(rounds - 1, prev + 1));
      setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
      return;
    }

    if (currentExercise.type === 'pyramid') {
      const maxStepIdx = Math.max(0, (currentExercise.pyramid_steps?.length || 1) - 1);
      if (currentPyramidStepIdx >= maxStepIdx) return;
      setCurrentPyramidStepIdx((prev) => Math.min(maxStepIdx, prev + 1));
      return;
    }

    if (currentExercise.type === 'circuit') {
      const maxSetIdx = Math.max(0, currentExercise.sets - 1);
      if (currentSetIdx >= maxSetIdx) return;
      setCurrentSetIdx((prev) => Math.min(maxSetIdx, prev + 1));
      resetCurrentExerciseTimerState();
      return;
    }

    if (currentExercise.type === 'superset') {
      const maxSetIdx = Math.max(0, currentExercise.sets - 1);
      if (currentSetIdx >= maxSetIdx) return;
      setCurrentSetIdx((prev) => Math.min(maxSetIdx, prev + 1));
      resetCurrentExerciseTimerState();
      return;
    }

    const maxSetIdx = Math.max(0, currentExercise.sets - 1);
    if (currentSetIdx >= maxSetIdx) return;
    setCurrentSetIdx((prev) => Math.min(maxSetIdx, prev + 1));
    resetCurrentExerciseTimerState();
  };

  const rewindWithinCurrentExercise = () => {
    if (isResting || isNoteModalOpen || isInstructionModalOpen || isEditExerciseModalOpen) return;

    if (currentExercise.type === 'emom') {
      if (currentEmomRoundIdx <= 0) return;
      stopEmomCountdown();
      setCurrentEmomRoundIdx((prev) => Math.max(0, prev - 1));
      setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
      return;
    }

    if (currentExercise.type === 'pyramid') {
      if (currentPyramidStepIdx <= 0) return;
      setCurrentPyramidStepIdx((prev) => Math.max(0, prev - 1));
      return;
    }

    if (currentExercise.type === 'circuit') {
      if (currentSetIdx <= 0) return;
      setCurrentSetIdx((prev) => Math.max(0, prev - 1));
      resetCurrentExerciseTimerState();
      return;
    }

    if (currentExercise.type === 'superset') {
      if (currentSetIdx <= 0) return;
      setCurrentSetIdx((prev) => Math.max(0, prev - 1));
      resetCurrentExerciseTimerState();
      return;
    }

    if (currentSetIdx <= 0) return;
    setCurrentSetIdx((prev) => Math.max(0, prev - 1));
    resetCurrentExerciseTimerState();
  };

  const handleActiveWorkoutTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) {
      swipeTouchStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    swipeTouchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  };

  const handleActiveWorkoutTouchCancel = () => {
    swipeTouchStartRef.current = null;
  };

  const suppressNextExerciseVoiceCueForCurrentTick = () => {
    suppressSwipeNextExerciseVoiceCueRef.current = true;
    queueMicrotask(() => {
      suppressSwipeNextExerciseVoiceCueRef.current = false;
    });
  };

  const handleArrowNextExercise = () => {
    suppressNextExerciseVoiceCueForCurrentTick();
    handleNextExercise();
  };

  const handleArrowPrevExercise = () => {
    handlePrevExercise();
  };

  const handleActiveWorkoutTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = swipeTouchStartRef.current;
    swipeTouchStartRef.current = null;
    if (!start || event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaY) > SWIPE_MAX_VERTICAL_DRIFT_PX) return;
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX) return;

    if (currentExercise.type === 'pyramid') {
      const maxStepIdx = Math.max(0, (currentExercise.pyramid_steps?.length || 1) - 1);

      if (deltaX > 0) {
        if (currentPyramidStepIdx >= maxStepIdx) return;
        suppressNextExerciseVoiceCueForCurrentTick();
        advanceWithinCurrentExercise();
        return;
      }

      if (currentPyramidStepIdx <= 0) return;
      suppressNextExerciseVoiceCueForCurrentTick();
      rewindWithinCurrentExercise();
      return;
    }

    if (deltaX > 0) {
      suppressNextExerciseVoiceCueForCurrentTick();
      advanceWithinCurrentExercise();
      return;
    }

    suppressNextExerciseVoiceCueForCurrentTick();
    rewindWithinCurrentExercise();
  };

  const finishRestAndNextSet = (naturalExpiry = false) => {
    stopRestCountdown(naturalExpiry);

    if (pendingExerciseAdvance) {
      setPendingExerciseAdvance(false);
      handleNextExercise();
      return;
    }

    if (currentExercise.type === 'pyramid' && pendingPyramidAdvance) {
      setPendingPyramidAdvance(false);
      const nextPyramidStepIdx = currentPyramidStepIdx + 1;
      setCurrentPyramidStepIdx(nextPyramidStepIdx);
      if (naturalExpiry) {
        speakCue(buildSetAnnouncementCue(currentExercise, currentSetIdx, nextPyramidStepIdx));
      }
      return;
    }

    // Increment set
    const nextSetIdx = currentSetIdx + 1;
    setCurrentSetIdx(nextSetIdx);
    setCurrentSubExerciseIdx(0);
    if (currentExercise.type === 'emom') {
      setCurrentEmomRoundIdx(0);
      setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
    }
    if (currentExercise.type === 'circuit') {
      resetCircuitStopwatch();
    }

    // Announce exercise details for the upcoming set (only on natural rest timer expiry)
    if (naturalExpiry) {
      speakCue(buildSetAnnouncementCue(currentExercise, nextSetIdx));
    }

    // Reset isometry stopwatch if needed
    setIsometryStopwatchActive(false);
    isometryStopwatchStartMsRef.current = null;
    setIsometryElapsedSeconds(0);

    // Reset isometry timer if needed
    setIsometryRemainingWithSync(getTargetIsometry(currentExercise, currentExercise.subExercises?.[0]));
  };

  const skipRest = () => {
    stopRestCountdown();
    setRestRemaining(0);
    finishRestAndNextSet();
  };

  const nextRecoveryLabel = getNextRecoveryLabel();

  const handleLeaveWorkout = () => {
    freezeForegroundWorkoutTime();
    stopRestMediaSession();
    void releaseScreenWakeLock();
    persistWorkoutProgress(true);
    void lockAppToPortrait();
    navigate('/');
  };

  const markWorkoutComplete = async () => {
    if (workoutCompletionHandledRef.current) return;
    workoutCompletionHandledRef.current = true;
    suppressProgressPersistenceRef.current = true;

    clearPersistedWorkoutProgress();

    if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
      playGoalReachedSound();
    }
    speakCue('workout complete');
    stopEmomCountdown();
    stopIsometryCountdown();
    stopRestCountdown();
    stopRestMediaSession();
    void releaseScreenWakeLock();

    const workoutRunId = await saveWorkoutRun();
    if (workoutRunId) {
      await saveWorkoutNotes(workoutRunId);
    }
  };

  const handleCelebrationComplete = () => {
    setIsCelebrationOpen(false);
    void lockAppToPortrait();
    navigate('/');
  };

  const completeWorkoutNow = async () => {
    const elapsedSecs = Math.max(0, getCurrentWorkoutElapsedSeconds());
    if (elapsedSecs < 30) {
      const confirmSave = window.confirm(
        "L'allenamento è iniziato da meno di 30 secondi.\n\nVuoi davvero registrarlo come completato nello storico?\n(Premi Annulla per uscire senza salvare)."
      );
      if (!confirmSave) {
        suppressProgressPersistenceRef.current = true;
        clearPersistedWorkoutProgress();
        stopRestMediaSession();
        void releaseScreenWakeLock();
        void lockAppToPortrait();
        navigate('/');
        return;
      }
    }
    await markWorkoutComplete();
    setIsCelebrationOpen(true);
  };

  const handlePrimaryAction = () => {
    if (isFinalCompletionAction) {
      if (isCircuit) {
        pauseCircuitStopwatch();
        const lapSecs = recordCircuitLapAndReset();
        const updatedLaps = [...circuitLapTimes, lapSecs];
        autoAppendCircuitTimeToNotes(currentExercise, currentExerciseIdx, updatedLaps);
        currentExercise.lap_durations_seconds = updatedLaps;
        currentExercise.total_circuit_duration_seconds = updatedLaps.reduce((a, b) => a + b, 0);
      }
      void completeWorkoutNow();
      return;
    }

    if (isEmom) {
      // NEXT ROUND must advance even if timer is still running.
      if (!isLastEmomRound) {
        speakCue('next round');
        setCurrentEmomRoundIdx(prev => prev + 1);
        setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
        return;
      }

      // FINISH SET must close the current set even if timer is still running.
      stopEmomCountdown();
      if (isLastSet) {
        queueNextExerciseFlow(currentExercise);
      } else {
        startRestCountdown(currentExercise.rest_seconds);
      }
      return;
    }

    // Controllo per esercizio a sfinimento (MAX) prima di completare il set
    const isCurrentMax = isMaxPerformance(currentExercise);
    if (isCurrentMax) {
      // Se l'isometria era attiva col cronometro, ferma e salva
      if (isometryStopwatchActive) {
        setIsometryStopwatchActive(false);
        setLoggedPerformanceForSet(
          currentExerciseIdx,
          currentExercise,
          currentSetIdx,
          isometryElapsedSeconds
        );
      }

      const currentKey = getPerformanceKey(currentExerciseIdx, currentExercise);
      const currentVal = recordedMaxPerformanceRef.current[currentKey]?.[currentSetIdx];
      if ((currentVal == null || currentVal === 0) && !location.state?.autoCompleteAction) {
        setTargetEditingSetIdx(currentSetIdx);
        setModalPerformanceValue(isometryElapsedSeconds > 0 ? isometryElapsedSeconds : 0);
        isPendingSetAdvanceRef.current = true;
        setIsMaxPromptModalOpen(true);
        return;
      }
    }

    completeSet();
  };
  handlePrimaryActionRef.current = handlePrimaryAction;

  const voiceCommandsHelpBubble = isVoiceHelpVisible ? (
    <div className="fixed top-20 right-4 z-50 w-[min(92vw,430px)] pointer-events-none">
      <div className="relative rounded-none border-2 border-white/70 bg-[#101010] px-4 py-3 shadow-[6px_6px_0_rgba(0,0,0,0.45)]">
        <div className="absolute -top-2 right-8 h-3 w-3 rotate-45 border-l-2 border-t-2 border-white/70 bg-[#101010]" />
        <p className="mb-2 text-[11px] font-black tracking-widest text-brand-orange">VOICE COMMANDS</p>
        <div className="space-y-1 text-xs leading-relaxed text-white/90">
          <p><span className="font-bold text-brand-orange">start / vai</span> - start timer</p>
          <p><span className="font-bold text-brand-orange">stop / fermo</span> - pause timer</p>
          <p><span className="font-bold text-brand-orange">reset / resetta</span> - reset active timer</p>
          <p><span className="font-bold text-brand-orange">skip rest / salta recupero</span> - skip active rest</p>
          <p><span className="font-bold text-brand-orange">next / avanti</span> - next set or round</p>
          <p><span className="font-bold text-brand-orange">back / indietro</span> - previous step</p>
          <p><span className="font-bold text-brand-orange">next exercise / prossimo esercizio</span> - jump to next exercise</p>
          <p><span className="font-bold text-brand-orange">previous exercise / esercizio precedente</span> - jump to previous exercise</p>
          <p><span className="font-bold text-brand-orange">end workout / termina workout</span> - finish workout now</p>
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-wider text-brand-grey/80">Auto closes in 10s or on any tap</p>
      </div>
    </div>
  ) : null;



  const transitionNextExercise = pendingExerciseAdvance && !isLastExercise
    ? workout.exercises[currentExerciseIdx + 1]
    : null;
  const restOverviewExerciseLabel = transitionNextExercise ? workoutRestOverviewExerciseLabel : workoutOverviewExerciseLabel;
  const getExerciseDisplayName = (exercise: Exercise, fallbackIndex: number) => {
    return String(exercise.name || '').trim() || `Exercise ${fallbackIndex + 1}`;
  };

  const getRestTransitionSpecialTypeLabel = (exercise: Exercise | null) => {
    if (!exercise) return null;
    if (exercise.type === 'emom') return 'EMOM MODE';
    if (exercise.type === 'superset') return 'SUPERSET MODE';
    if (exercise.type === 'pyramid') return 'PYRAMID MODE';
    return null;
  };

  const getRestUpcomingExecutionEntries = (
    exercise: Exercise | null,
    fallbackIndex: number,
    pyramidStepIdx: number | null,
  ) => {
    if (!exercise) return [] as Array<{ name: string; weightLabel: string }>;

    const baseName = getExerciseDisplayName(exercise, fallbackIndex);

    if (exercise.type === 'superset' || exercise.type === 'emom') {
      const entries = (exercise.subExercises || []).map((sub, subIdx) => ({
        name: String(sub.name || '').trim() || `Exercise ${subIdx + 1}`,
        weightLabel: formatWeightLabel(sub.weight_kg),
      }));

      if (entries.length > 0) return entries;
      return [{ name: baseName, weightLabel: formatWeightLabel(exercise.weight_kg) }];
    }

    if (exercise.type === 'pyramid') {
      const steps = exercise.pyramid_steps || [];
      const rawStepIdx = pyramidStepIdx ?? 0;
      const safeStepIdx = Math.min(Math.max(rawStepIdx, 0), Math.max(0, steps.length - 1));
      const step = steps[safeStepIdx];
      return [{ name: baseName, weightLabel: formatWeightLabel(step?.weight_kg) }];
    }

    return [{ name: baseName, weightLabel: formatWeightLabel(exercise.weight_kg) }];
  };

  const restTargetExercise = transitionNextExercise || currentExercise;
  const restTargetExerciseIndex = transitionNextExercise ? currentExerciseIdx + 1 : currentExerciseIdx;
  const restTargetSpecialTypeLabel = getRestTransitionSpecialTypeLabel(restTargetExercise);
  const restTargetPyramidStepIdx = restTargetExercise.type === 'pyramid'
    ? transitionNextExercise
      ? 0
      : pendingPyramidAdvance
        ? currentPyramidStepIdx + 1
        : currentPyramidStepIdx
    : null;
  const restUpcomingExecutionEntries = getRestUpcomingExecutionEntries(
    restTargetExercise,
    restTargetExerciseIndex,
    restTargetPyramidStepIdx,
  );

  const renderOverviewGeneralNotes = () => {
    if (isEditingGeneralNoteInOverview) {
      return (
        <div className="rounded-2xl border border-brand-orange/40 bg-brand-orange/10 p-4 shadow-sm mb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-brand-orange">
              <FileText size={16} />
              <span className="text-xs font-black uppercase tracking-wider">Note Generali Scheda</span>
            </div>
          </div>
          <textarea
            value={overviewGeneralNoteDraft}
            onChange={(e) => setOverviewGeneralNoteDraft(e.target.value)}
            placeholder="Scrivi le note generali riferite all'intera scheda di allenamento..."
            className="w-full min-h-[110px] bg-black/50 border border-brand-orange/30 rounded-xl px-3 py-2.5 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none mb-3"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditingGeneralNoteInOverview(false)}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:border-white/20 text-zinc-400 hover:text-white transition-colors text-xs font-bold cursor-pointer"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={handleSaveGeneralNoteInOverview}
              className="px-3.5 py-1.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-xs font-black active:scale-95 shadow-md cursor-pointer"
            >
              Salva Nota
            </button>
          </div>
        </div>
      );
    }

    if (workoutGeneralNote.trim()) {
      return (
        <div className="rounded-2xl border border-brand-orange/40 bg-brand-orange/10 p-4 shadow-sm mb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-brand-orange">
              <FileText size={16} />
              <span className="text-xs font-black uppercase tracking-wider">Note Generali Scheda</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOverviewGeneralNoteDraft(workoutGeneralNote);
                setIsEditingGeneralNoteInOverview(true);
              }}
              className="text-[11px] font-bold text-brand-orange hover:text-brand-lightOrange transition-colors cursor-pointer"
            >
              Modifica
            </button>
          </div>
          <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">
            {workoutGeneralNote}
          </p>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          setOverviewGeneralNoteDraft('');
          setIsEditingGeneralNoteInOverview(true);
        }}
        className="w-full mb-3 flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-zinc-400 hover:text-white hover:border-brand-orange/40 hover:bg-brand-orange/5 transition-all text-xs font-semibold cursor-pointer"
      >
        <FileText size={14} className="text-brand-orange" />
        <span>Aggiungi note per l'intera scheda</span>
      </button>
    );
  };

  const renderExerciseNoteModal = () => {
    if (!isNoteModalOpen) return null;
    return (
      <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-brand-darkGrey/95 border border-white/10 rounded-3xl p-5 shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileText size={18} className="text-brand-orange" />
                <span>Note Esercizio</span>
              </h3>
              <p className="text-xs text-brand-grey mt-0.5 truncate max-w-[280px]">
                {noteModalContext?.name || currentExercise.name || 'Esercizio'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeCurrentExerciseNoteModal}
              className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title="Chiudi note"
            >
              <X size={18} />
            </button>
          </div>

          <div>
            <textarea
              value={noteModalDraft}
              onChange={(e) => setNoteModalDraft(e.target.value)}
              placeholder="Scrivi le considerazioni per questo esercizio..."
              className="w-full min-h-[150px] bg-black/40 border border-brand-grey/20 rounded-xl px-4 py-3 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none"
              autoFocus
            />
          </div>

          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeCurrentExerciseNoteModal}
              className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold cursor-pointer"
            >
              Annulla
            </button>
            <button
              type="button"
              onClick={saveCurrentExerciseNote}
              className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black active:scale-95 shadow-md cursor-pointer"
            >
              Salva Nota
            </button>
          </div>
        </div>
      </div>
    );
  };

  const calculateExerciseProgress = (
    exercise: (typeof workout.exercises)[number],
    exerciseIndex: number
  ): { progressPct: number; completedUnits: number; totalUnits: number; label: string } => {
    // 1. Esercizio già completato prima di quello corrente
    if (exerciseIndex < currentExerciseIdx) {
      const total = exercise.type === 'pyramid'
        ? (exercise.pyramid_steps?.length || 1)
        : exercise.type === 'emom'
          ? (exercise.sets || 1) * getEffectiveEmomRounds(exercise)
          : (exercise.type === 'superset' || exercise.type === 'circuit')
            ? (exercise.sets || 1) * (exercise.subExercises?.length || 1)
            : (exercise.sets || 1);

      return {
        progressPct: 100,
        completedUnits: total,
        totalUnits: total,
        label: 'Esercizio completato',
      };
    }

    // 2. Esercizio futuro non ancora iniziato
    if (exerciseIndex > currentExerciseIdx) {
      const total = exercise.type === 'pyramid'
        ? (exercise.pyramid_steps?.length || 1)
        : exercise.type === 'emom'
          ? (exercise.sets || 1) * getEffectiveEmomRounds(exercise)
          : (exercise.type === 'superset' || exercise.type === 'circuit')
            ? (exercise.sets || 1) * (exercise.subExercises?.length || 1)
            : (exercise.sets || 1);

      return {
        progressPct: 0,
        completedUnits: 0,
        totalUnits: total,
        label: 'In programma',
      };
    }

    // 3. Esercizio corrente in esecuzione
    if (pendingExerciseAdvance) {
      const total = exercise.type === 'pyramid'
        ? (exercise.pyramid_steps?.length || 1)
        : exercise.type === 'emom'
          ? (exercise.sets || 1) * getEffectiveEmomRounds(exercise)
          : (exercise.type === 'superset' || exercise.type === 'circuit')
            ? (exercise.sets || 1) * (exercise.subExercises?.length || 1)
            : (exercise.sets || 1);

      return {
        progressPct: 100,
        completedUnits: total,
        totalUnits: total,
        label: 'Tutti i set completati',
      };
    }

    if (exercise.type === 'pyramid') {
      const steps = exercise.pyramid_steps || [];
      const totalSteps = Math.max(1, steps.length);
      const completedSteps = pendingPyramidAdvance
        ? Math.min(totalSteps, currentPyramidStepIdx + 1)
        : Math.min(totalSteps, currentPyramidStepIdx);
      const pct = Math.round((completedSteps / totalSteps) * 100);
      const stepLabel = pendingPyramidAdvance
        ? `Step ${completedSteps} di ${totalSteps} completati · Recupero`
        : `Step ${currentPyramidStepIdx + 1} di ${totalSteps} in corso`;

      return {
        progressPct: Math.min(100, Math.max(0, pct)),
        completedUnits: completedSteps,
        totalUnits: totalSteps,
        label: stepLabel,
      };
    }

    if (exercise.type === 'emom') {
      const totalSets = Math.max(1, exercise.sets || 1);
      const effRounds = Math.max(1, getEffectiveEmomRounds(exercise));
      const totalUnits = totalSets * effRounds;

      let completedUnits = currentSetIdx * effRounds + currentEmomRoundIdx;
      if (isResting && !pendingExerciseAdvance) {
        completedUnits = (currentSetIdx + 1) * effRounds;
      }
      completedUnits = Math.min(totalUnits, Math.max(0, completedUnits));
      const pct = Math.round((completedUnits / totalUnits) * 100);
      const emomLabel = isResting
        ? `Set ${currentSetIdx + 1} completato · Recupero`
        : totalSets > 1
          ? `Set ${currentSetIdx + 1} · Round ${currentEmomRoundIdx + 1} di ${effRounds}`
          : `Round ${currentEmomRoundIdx + 1} di ${effRounds} in corso`;

      return {
        progressPct: Math.min(100, Math.max(0, pct)),
        completedUnits,
        totalUnits,
        label: emomLabel,
      };
    }

    if (exercise.type === 'superset' || exercise.type === 'circuit') {
      const totalRounds = Math.max(1, exercise.sets || 1);
      const subCount = Math.max(1, exercise.subExercises?.length || 1);
      const totalUnits = totalRounds * subCount;

      let completedUnits = currentSetIdx * subCount + currentSubExerciseIdx;
      if (isResting && !pendingExerciseAdvance) {
        completedUnits = (currentSetIdx + 1) * subCount;
      }
      completedUnits = Math.min(totalUnits, Math.max(0, completedUnits));
      const pct = Math.round((completedUnits / totalUnits) * 100);
      const typeLabel = exercise.type === 'circuit' ? 'Giro' : 'Round';
      const groupLabel = isResting
        ? `${typeLabel} ${currentSetIdx + 1} completato · Recupero`
        : `${typeLabel} ${currentSetIdx + 1} di ${totalRounds} · Stazione ${currentSubExerciseIdx + 1} di ${subCount}`;

      return {
        progressPct: Math.min(100, Math.max(0, pct)),
        completedUnits,
        totalUnits,
        label: groupLabel,
      };
    }

    // Standard reps / isometry / cardio
    const totalSets = Math.max(1, exercise.sets || 1);
    let completedSets = currentSetIdx;
    if (isResting && !pendingExerciseAdvance) {
      completedSets = currentSetIdx + 1;
    }
    completedSets = Math.min(totalSets, Math.max(0, completedSets));

    let fractionalSet = 0;
    if (!isResting && (exercise.type === 'isometry' || exercise.type === 'cardio')) {
      const dur = exercise.duration_seconds || 0;
      if (dur > 0 && isometryRemaining < dur) {
        fractionalSet = Math.max(0, Math.min(1, (dur - isometryRemaining) / dur));
      }
    }

    const rawPct = ((completedSets + fractionalSet) / totalSets) * 100;
    const pct = Math.round(rawPct);
    const stdLabel = isResting
      ? `Set ${completedSets} di ${totalSets} completati · Recupero`
      : `Set ${currentSetIdx + 1} di ${totalSets} in corso`;

    return {
      progressPct: Math.min(100, Math.max(0, pct)),
      completedUnits: completedSets,
      totalUnits: totalSets,
      label: stdLabel,
    };
  };

  const renderWorkoutOverviewModal = () => {
    if (!isWorkoutOverviewModalOpen) return null;
    return (
      <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-xl bg-brand-darkGrey/95 border border-brand-orange/25 rounded-3xl p-5 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-white">Panoramica Scheda</h3>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-orange bg-brand-orange/15 border border-brand-orange/30 px-2.5 py-0.5 rounded-full">
                  <Clock size={12} />
                  {formatTime(getCurrentWorkoutElapsedSeconds())}
                </span>
                <span className="inline-flex items-center text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  {currentExerciseIdx} / {workout.exercises.length} completati
                </span>
              </div>
              <p className="text-xs text-brand-grey mt-1">{workout.name}</p>
            </div>
            <button
              onClick={closeWorkoutOverviewModal}
              className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title="Chiudi panoramica"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
            {/* Note Generali della Scheda */}
            {renderOverviewGeneralNotes()}

            {workout.exercises.map((exercise, index) => {
              const isCompleted = index < currentExerciseIdx;
              const isCurrentExercise = index === currentExerciseIdx;
              const exerciseTitle = String(exercise.name || '').trim() || `Esercizio ${index + 1}`;
              const summary = getWorkoutOverviewSummary(exercise);
              const { progressPct, label: progressLabel } = calculateExerciseProgress(exercise, index);
              const exerciseNote = getExerciseNoteEntry(index, exercise)?.note?.trim();
              const hasNote = Boolean(exerciseNote);

              return (
                <div
                  key={exercise.id}
                  className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${
                    isCurrentExercise
                      ? 'border-2 border-brand-orange/80 bg-brand-darkGrey/95 shadow-[0_0_24px_rgba(255,94,0,0.22)] ring-1 ring-brand-orange/40'
                      : isCompleted
                        ? 'border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-emerald-900/15 to-black/50 shadow-[0_0_15px_rgba(16,185,129,0.06)]'
                        : 'border-white/10 bg-black/30 opacity-75 hover:opacity-100'
                  }`}
                >
                  {/* Background Fill Layer: 100% per esercizi completati, proporzionale per l'attuale */}
                  {isCompleted && (
                    <div className="absolute inset-0 bg-emerald-500/10 pointer-events-none" />
                  )}
                  {isCurrentExercise && (
                    <>
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand-orange/35 via-brand-orange/25 to-brand-orange/15 pointer-events-none transition-all duration-500 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                      {progressPct > 0 && progressPct < 100 && (
                        <div
                          className="absolute inset-y-0 w-[2px] bg-brand-orange shadow-[0_0_10px_rgba(255,94,0,0.9)] pointer-events-none transition-all duration-500 ease-out"
                          style={{ left: `calc(${progressPct}% - 2px)` }}
                        />
                      )}
                    </>
                  )}

                  {/* Card Content (relativo per stare sopra i livelli di riempimento) */}
                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.25em] font-bold mb-1 flex items-center">
                          {isCompleted ? (
                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                              <CheckCircle2 size={11} /> Esercizio {index + 1}
                            </span>
                          ) : isCurrentExercise ? (
                            <span className="text-brand-orange font-bold flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-brand-orange animate-pulse" /> Esercizio {index + 1}
                            </span>
                          ) : (
                            <span className="text-brand-grey/70">Esercizio {index + 1}</span>
                          )}
                        </p>
                        <h4 className="text-white font-black text-lg leading-tight truncate">{exerciseTitle}</h4>
                        <p className={`text-[10px] uppercase tracking-widest font-bold mt-1 ${
                          isCompleted
                            ? 'text-emerald-400/90'
                            : isCurrentExercise
                              ? 'text-brand-orange font-black'
                              : 'text-zinc-400'
                        }`}>
                          {getWorkoutOverviewDisplayLabel(exercise)}
                        </p>
                      </div>

                      <div className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${
                        isCompleted
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                          : isCurrentExercise
                            ? 'bg-brand-orange text-black shadow-md shadow-brand-orange/20'
                            : 'bg-white/5 text-brand-grey border border-white/5'
                      }`}>
                        {isCompleted ? (
                          <>
                            <CheckCircle2 size={12} className="text-emerald-400" />
                            <span>Completato</span>
                          </>
                        ) : isCurrentExercise ? (
                          <>
                            <span>Sei qui</span>
                            <span className="opacity-70">·</span>
                            <span>{progressPct}%</span>
                          </>
                        ) : (
                          <span>#{index + 1}</span>
                        )}
                      </div>
                    </div>

                    {/* Barra di avanzamento dell'esercizio */}
                    {(isCompleted || isCurrentExercise) && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                          <span className={isCompleted ? 'text-emerald-400/90' : 'text-brand-orange tracking-wide'}>
                            {progressLabel}
                          </span>
                          <span className={`font-mono text-xs font-black px-2 py-0.5 rounded-md ${
                            isCompleted
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-brand-orange/20 text-white border border-brand-orange/30'
                          }`}>
                            {progressPct}%
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isCompleted
                                ? 'bg-emerald-500'
                                : 'bg-gradient-to-r from-brand-orange via-brand-lightOrange to-yellow-400 shadow-[0_0_10px_rgba(255,94,0,0.6)]'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {summary.map((item, summaryIndex) => (
                        <span
                          key={`${exercise.id}:summary:${summaryIndex}`}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold ${
                            isCompleted
                              ? 'border-emerald-500/20 bg-emerald-950/30 text-emerald-200'
                              : isCurrentExercise
                                ? 'border-brand-orange/30 bg-black/40 text-brand-orange/95'
                                : 'border-white/10 bg-black/25 text-white/85'
                          }`}
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    {(exercise.type === 'superset' || exercise.type === 'circuit') && exercise.subExercises && exercise.subExercises.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.subExercises.map((sub, subIndex) => {
                          const isSubActive = isCurrentExercise && subIndex === currentSubExerciseIdx;
                          const isSubDone = isCompleted || (isCurrentExercise && subIndex < currentSubExerciseIdx);

                          return (
                            <div
                              key={`${exercise.id}:sub:${subIndex}`}
                              className={`rounded-xl border px-3 py-2 flex items-start justify-between gap-3 transition-colors ${
                                isSubActive
                                  ? 'border-brand-orange/60 bg-brand-orange/15 shadow-[0_0_10px_rgba(255,94,0,0.15)]'
                                  : isSubDone
                                    ? 'border-emerald-500/20 bg-emerald-950/20'
                                    : 'border-white/5 bg-black/25'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className={`font-bold text-sm truncate flex items-center gap-1.5 ${
                                  isSubActive ? 'text-white font-black' : isSubDone ? 'text-emerald-100' : 'text-zinc-300'
                                }`}>
                                  {isSubDone && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                                  {sub.name || `Esercizio ${subIndex + 1}`}
                                </p>
                                <p className={`text-[11px] font-black uppercase tracking-wide mt-1 ${
                                  isSubActive ? 'text-brand-orange' : isSubDone ? 'text-emerald-400/90' : 'text-zinc-400'
                                }`}>
                                  {formatSupersetTaskMetricLabel(sub)}
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(sub.weight_kg)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {exercise.type === 'emom' && exercise.subExercises && exercise.subExercises.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.subExercises.map((sub, subIndex) => {
                          const isSubActive = isCurrentExercise && subIndex === (currentEmomRoundIdx % (exercise.subExercises?.length || 1));
                          const isSubDone = isCompleted;

                          return (
                            <div
                              key={`${exercise.id}:emom:${subIndex}`}
                              className={`rounded-xl border px-3 py-2 flex items-start justify-between gap-3 transition-colors ${
                                isSubActive
                                  ? 'border-brand-orange/60 bg-brand-orange/15 shadow-[0_0_10px_rgba(255,94,0,0.15)]'
                                  : isSubDone
                                    ? 'border-emerald-500/20 bg-emerald-950/20'
                                    : 'border-white/5 bg-black/25'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className={`font-bold text-sm truncate flex items-center gap-1.5 ${
                                  isSubActive ? 'text-white font-black' : isSubDone ? 'text-emerald-100' : 'text-zinc-300'
                                }`}>
                                  {isSubDone && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                                  {sub.name || `Esercizio ${subIndex + 1}`}
                                </p>
                                <p className={`text-[11px] font-black uppercase tracking-wide mt-1 ${
                                  isSubActive ? 'text-brand-orange' : isSubDone ? 'text-emerald-400/90' : 'text-zinc-400'
                                }`}>
                                  {formatEmomTaskMetricLabel(sub)}
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(sub.weight_kg)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {exercise.type === 'pyramid' && exercise.pyramid_steps && exercise.pyramid_steps.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.pyramid_steps.map((step, stepIndex) => {
                          const isStepActive = isCurrentExercise && stepIndex === currentPyramidStepIdx;
                          const isStepDone = isCompleted || (isCurrentExercise && (
                            pendingPyramidAdvance ? stepIndex <= currentPyramidStepIdx : stepIndex < currentPyramidStepIdx
                          ));

                          return (
                            <div
                              key={`${exercise.id}:pyramid:${stepIndex}`}
                              className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                                isStepActive
                                  ? 'border-brand-orange/60 bg-brand-orange/15 shadow-[0_0_10px_rgba(255,94,0,0.15)]'
                                  : isStepDone
                                    ? 'border-emerald-500/20 bg-emerald-950/20'
                                    : 'border-white/5 bg-black/25'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className={`font-bold text-sm truncate flex items-center gap-1.5 ${
                                  isStepActive ? 'text-white font-black' : isStepDone ? 'text-emerald-100' : 'text-zinc-300'
                                }`}>
                                  {isStepDone && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                                  Step {stepIndex + 1}
                                </p>
                                <p className={`text-[11px] font-black uppercase tracking-wide mt-1 ${
                                  isStepActive ? 'text-brand-orange' : isStepDone ? 'text-emerald-400/90' : 'text-zinc-400'
                                }`}>
                                  {isMaxTarget(step.reps) ? 'MAX reps' : `${step.reps} reps`} · {formatTime(step.rest_seconds)} rest
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(step.weight_kg)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {hasNote && (
                      <div className="mt-2.5 rounded-xl border border-brand-orange/30 bg-black/40 px-3 py-2 flex items-start gap-2">
                        <FileText size={13} className="text-brand-orange shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-brand-orange/90 mb-0.5">Nota Esercizio</p>
                          <p className="text-xs text-zinc-200 line-clamp-2 leading-relaxed whitespace-pre-wrap">{exerciseNote}</p>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold">
                        {isCurrentExercise ? (
                          <span className="text-brand-orange font-black flex items-center gap-1.5">
                            <Flame size={12} className="text-brand-orange animate-pulse" />
                            In esecuzione adesso
                          </span>
                        ) : isCompleted ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                            <CheckCircle2 size={12} />
                            Completato
                          </span>
                        ) : (
                          <span className="text-zinc-400">
                            Esercizio {index + 1} di {workout.exercises.length}
                          </span>
                        )}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openExerciseNoteModal(index)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm relative ${
                            hasNote
                              ? 'bg-brand-orange/20 border border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.3)]'
                              : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                          }`}
                          title={`Note per ${exerciseTitle}`}
                        >
                          <FileText size={13} />
                          <span>{hasNote ? 'Modifica Nota' : 'Nota'}</span>
                          {hasNote && (
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange ring-1 ring-black" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditExerciseModal(index)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm ${
                            isCurrentExercise
                              ? 'bg-brand-orange text-black hover:bg-brand-lightOrange shadow-brand-orange/20 font-black'
                              : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                          }`}
                          title={`Modifica parametri di ${exerciseTitle}`}
                        >
                          <SlidersHorizontal size={13} />
                          <span>Modifica Parametri</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10 flex justify-end">
            <button
              onClick={closeWorkoutOverviewModal}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors text-xs font-bold cursor-pointer"
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderActiveWorkoutModals = () => {
    return (
      <>
        {renderExerciseNoteModal()}

        {isInstructionModalOpen && instructionModalContext && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-orange/25 rounded-3xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Exercise Instructions</h3>
                  <p className="text-xs text-brand-grey mt-1">{instructionModalContext.exerciseName}</p>
                </div>
                <button
                  onClick={closeCurrentInstructionModal}
                  className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                  title="Close instructions"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                {instructionModalContext.note && (
                  <div className="bg-black/40 border border-brand-orange/25 rounded-xl px-4 py-3">
                    <p className="text-xs uppercase tracking-wider font-bold text-brand-orange/90 mb-2">Primary Note</p>
                    <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">{instructionModalContext.note}</p>
                  </div>
                )}

                {instructionModalContext.items.map((item, idx) => (
                  <div key={`${item.name}-${idx}`} className="bg-black/40 border border-white/10 rounded-xl px-4 py-3">
                    <p className="text-xs uppercase tracking-wider font-bold text-brand-orange/90 mb-2">{item.name}</p>
                    <p className="text-sm leading-relaxed text-white whitespace-pre-wrap">{item.note}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-end">
                <button
                  onClick={closeCurrentInstructionModal}
                  className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {renderWorkoutOverviewModal()}

        {isEditExerciseModalOpen && (() => {
          const targetExIdx = editingExerciseIdx != null ? editingExerciseIdx : currentExerciseIdx;
          const targetEx = workout.exercises[targetExIdx] || currentExercise;
          const targetExerciseTitle = String(targetEx?.name || '').trim() || `Esercizio ${targetExIdx + 1}`;
          const isTargetCurrent = targetExIdx === currentExerciseIdx;

          return (
            <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
              <div className="w-full max-w-lg bg-brand-darkGrey/95 border border-white/10 rounded-3xl p-5 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">Modifica Parametri</h3>
                      {isTargetCurrent && (
                        <span className="text-[10px] font-black tracking-wider uppercase bg-brand-orange/20 text-brand-orange px-2 py-0.5 rounded-full border border-brand-orange/30">
                          In esecuzione
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-brand-grey mt-1">
                      {targetExerciseTitle}
                    </p>
                  </div>
                  <button
                    onClick={closeEditExerciseModal}
                    className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                    title="Chiudi editor parametri"
                    disabled={isSavingExerciseEdit}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                  {targetEx.type === 'emom' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm text-brand-grey">Serie (Sets)
                          <input
                            type="number" inputMode="numeric"
                            min={1}
                            value={exerciseEditDraft.sets}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, sets: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                        <label className="text-sm text-brand-grey">Giri (Rounds)
                          <input
                            type="number" inputMode="numeric"
                            min={1}
                            value={exerciseEditDraft.emomRounds}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, emomRounds: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col">
                          <label className="text-sm text-brand-grey">Durata Round</label>
                          <div className="mt-1 flex bg-black/40 border border-brand-grey/20 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                            <div className="relative flex-1 border-r border-brand-grey/10">
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                value={toDurationParts(exerciseEditDraft.emomRoundDuration).minutes}
                                onChange={(e) => updateEmomRoundDurationPart('min', e.target.value)}
                                className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                              />
                              <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">MIN</span>
                            </div>
                            <div className="relative flex-1">
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                max={59}
                                value={toDurationParts(exerciseEditDraft.emomRoundDuration).seconds}
                                onChange={(e) => updateEmomRoundDurationPart('sec', e.target.value)}
                                className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                              />
                              <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">SEC</span>
                            </div>
                          </div>
                        </div>
                        <label className="text-sm text-brand-grey">Recupero tra Serie (sec)
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={exerciseEditDraft.restSeconds}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, restSeconds: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      </div>

                      <div className="space-y-3 pt-2">
                        {exerciseEditDraft.subExerciseDrafts.map((draft, index) => (
                          <div key={`${draft.name}-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.24em] text-brand-grey/70 font-bold">Esercizio EMOM {index + 1}</p>
                                <h4 className="text-white font-black text-base truncate">{draft.name}</h4>
                              </div>
                              <span className="text-[10px] uppercase tracking-[0.24em] font-black text-brand-orange/90">{draft.type === 'isometry' ? 'Isometria' : 'Ripetizioni'}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              {draft.type === 'isometry' ? (
                                <label className="text-sm text-brand-grey">Durata (sec)
                                  <input
                                    type="number" inputMode="numeric"
                                    min={0}
                                    value={draft.durationSeconds}
                                    onChange={(e) => updateSubExerciseDraft(index, { durationSeconds: e.target.value })}
                                    className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                  />
                                </label>
                              ) : (
                                <label className="text-sm text-brand-grey">Ripetizioni
                                  <input
                                    type="number" inputMode="numeric"
                                    min={0}
                                    value={draft.reps}
                                    onChange={(e) => updateSubExerciseDraft(index, { reps: e.target.value })}
                                    className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                  />
                                </label>
                              )}

                              <label className="text-sm text-brand-grey">Peso (kg)
                                <input
                                  type="text"
                                  value={draft.weightKg}
                                  onChange={(e) => updateSubExerciseDraft(index, { weightKg: e.target.value })}
                                  placeholder="a corpo libero"
                                  className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {(targetEx.type === 'superset' || targetEx.type === 'circuit') && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm text-brand-grey">{targetEx.type === 'circuit' ? 'Giri (Rounds)' : 'Serie (Sets)'}
                          <input
                            type="number" inputMode="numeric"
                            min={1}
                            value={exerciseEditDraft.sets}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, sets: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                        <label className="text-sm text-brand-grey">Recupero tra Giri (sec)
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={exerciseEditDraft.restSeconds}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, restSeconds: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      </div>

                      <div className="space-y-3 pt-2">
                        {exerciseEditDraft.subExerciseDrafts.map((draft, index) => (
                          <div key={`${draft.name}-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.24em] text-brand-grey/70 font-bold">
                                  {targetEx.type === 'circuit' ? 'Stazione circuito' : 'Esercizio superset'} {index + 1}
                                </p>
                                <h4 className="text-white font-black text-base truncate">{draft.name}</h4>
                              </div>
                              <span className="text-[10px] uppercase tracking-[0.24em] font-black text-brand-orange/90">
                                {draft.type === 'isometry' ? 'Isometria' : 'Ripetizioni'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              {draft.type === 'isometry' ? (
                                <label className="text-sm text-brand-grey">Durata (sec)
                                  <input
                                    type="number" inputMode="numeric"
                                    min={0}
                                    value={draft.durationSeconds}
                                    onChange={(e) => updateSubExerciseDraft(index, { durationSeconds: e.target.value })}
                                    className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                  />
                                </label>
                              ) : (
                                <label className="text-sm text-brand-grey">Ripetizioni
                                  <input
                                    type="number" inputMode="numeric"
                                    min={0}
                                    value={draft.reps}
                                    onChange={(e) => updateSubExerciseDraft(index, { reps: e.target.value })}
                                    className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                  />
                                </label>
                              )}

                              <label className="text-sm text-brand-grey">Peso (kg)
                                <input
                                  type="text"
                                  value={draft.weightKg}
                                  onChange={(e) => updateSubExerciseDraft(index, { weightKg: e.target.value })}
                                  placeholder="a corpo libero"
                                  className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {targetEx.type === 'pyramid' && (
                    <div className="space-y-3">
                      <div className="space-y-3 pt-2">
                        {exerciseEditDraft.pyramidStepDrafts.map((draft, index) => (
                          <div key={`step-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.24em] text-brand-grey/70 font-bold">Step {index + 1}</p>
                                <h4 className="text-white font-black text-base truncate">Step piramidale {index + 1}</h4>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                              <label className="text-sm text-brand-grey">Ripetizioni
                                <input
                                  type="number" inputMode="numeric"
                                  min={0}
                                  value={draft.reps}
                                  onChange={(e) => updatePyramidStepDraft(index, { reps: e.target.value })}
                                  className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                />
                              </label>
                              <label className="text-sm text-brand-grey">Recupero (sec)
                                <input
                                  type="number" inputMode="numeric"
                                  min={0}
                                  value={draft.restSeconds}
                                  onChange={(e) => updatePyramidStepDraft(index, { restSeconds: e.target.value })}
                                  className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                />
                              </label>
                              <label className="text-sm text-brand-grey">Peso (kg)
                                <input
                                  type="text"
                                  value={draft.weightKg}
                                  onChange={(e) => updatePyramidStepDraft(index, { weightKg: e.target.value })}
                                  placeholder="a corpo libero"
                                  className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {(targetEx.type === 'reps' || targetEx.type === 'isometry' || targetEx.type === 'cardio') && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm text-brand-grey">Serie (Sets)
                          <input
                            type="number" inputMode="numeric"
                            min={1}
                            value={exerciseEditDraft.sets}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, sets: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                        <label className="text-sm text-brand-grey">Recupero (sec)
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={exerciseEditDraft.restSeconds}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, restSeconds: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      </div>

                      {(targetEx.type === 'isometry' || targetEx.type === 'cardio') ? (
                        <label className="text-sm text-brand-grey">Durata (sec)
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={exerciseEditDraft.durationSeconds}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, durationSeconds: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      ) : (
                        <label className="text-sm text-brand-grey">Ripetizioni
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={exerciseEditDraft.reps}
                            onChange={(e) => setExerciseEditDraft((d) => ({ ...d, reps: e.target.value }))}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      )}

                      <label className="text-sm text-brand-grey">Peso (kg)
                        <input
                          type="text"
                          value={exerciseEditDraft.weightKg}
                          onChange={(e) => setExerciseEditDraft((d) => ({ ...d, weightKg: e.target.value }))}
                          placeholder="a corpo libero"
                          className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                        />
                      </label>
                    </>
                  )}
                </div>

                {exerciseEditError && (
                  <p className="mt-3 text-sm text-red-300">{exerciseEditError}</p>
                )}

                <div className="mt-4 flex items-center justify-end gap-3">
                  <button
                    onClick={closeEditExerciseModal}
                    disabled={isSavingExerciseEdit}
                    className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold disabled:opacity-50 cursor-pointer"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={saveCurrentExerciseEdits}
                    disabled={isSavingExerciseEdit}
                    className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black disabled:opacity-60 cursor-pointer"
                  >
                    {isSavingExerciseEdit ? 'Salvataggio...' : 'Salva Modifiche'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Auto-Count Choice Modal */}
        {isAutoCountModalOpen && currentExercise && !isSuperset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-brand-dark p-6 shadow-2xl border border-white/10">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-black text-white uppercase tracking-wider">Choose Method</h3>
                <button
                  onClick={() => setIsAutoCountModalOpen(false)}
                  className="text-brand-grey hover:text-white transition-colors p-2 cursor-pointer"
                >
                  <X size={24} />
                </button>
              </div>

              <p className="text-brand-grey mb-8 text-sm">
                How would you like to count your {currentExercise.reps} {currentExercise.name} reps?
              </p>

              <div className="flex flex-col gap-4">
                <button
                  onClick={async () => {
                    warmupSpeechSynthesis();
                    if (typeof window !== 'undefined' && typeof (window as any).DeviceMotionEvent?.requestPermission === 'function') {
                      try {
                        await (window as any).DeviceMotionEvent.requestPermission();
                      } catch (e) {
                        console.warn('DeviceMotionEvent permission request failed', e);
                      }
                    }
                    persistWorkoutProgress(true);
                    setIsAutoCountModalOpen(false);
                    navigate('/reps-count', {
                      state: {
                        autoCountExercise: currentExercise.auto_count_type,
                        targetReps: currentExercise.reps,
                        returnUrl: location.pathname,
                        mode: 'video'
                      }
                    });
                  }}
                  className="w-full bg-brand-darkGrey/60 border border-purple-500/50 rounded-2xl p-4 flex items-center gap-4 hover:bg-purple-500/20 transition-colors group cursor-pointer"
                >
                  <div className="bg-purple-500/20 p-3 rounded-xl group-hover:bg-purple-500/40 transition-colors flex-shrink-0">
                    <Video size={24} className="text-purple-400" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-white font-bold text-lg uppercase tracking-wide">Camera</h4>
                    <p className="text-brand-grey text-xs mt-1">Place phone down and step back</p>
                  </div>
                </button>

                <button
                  onClick={async () => {
                    warmupSpeechSynthesis();
                    if (typeof window !== 'undefined' && typeof (window as any).DeviceMotionEvent?.requestPermission === 'function') {
                      try {
                        await (window as any).DeviceMotionEvent.requestPermission();
                      } catch (e) {
                        console.warn('DeviceMotionEvent permission request failed', e);
                      }
                    }
                    persistWorkoutProgress(true);
                    setIsAutoCountModalOpen(false);
                    navigate('/reps-count', {
                      state: {
                        autoCountExercise: currentExercise.auto_count_type,
                        targetReps: currentExercise.reps,
                        returnUrl: location.pathname,
                        mode: 'accelerometer'
                      }
                    });
                  }}
                  className="w-full bg-brand-darkGrey/60 border border-brand-orange/50 rounded-2xl p-4 flex items-center gap-4 hover:bg-brand-orange/20 transition-colors group cursor-pointer"
                >
                  <div className="bg-brand-orange/20 p-3 rounded-xl group-hover:bg-brand-orange/40 transition-colors flex-shrink-0">
                    <Smartphone size={24} className="text-brand-orange" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-white font-bold text-lg uppercase tracking-wide">Accelerometer</h4>
                    <p className="text-brand-grey text-xs mt-1">Keep phone in your pocket</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal per Prompt / Modifica Performance Set a Sfinimento */}
        {isMaxPromptModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-brand-orange/40 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-brand-orange/20 text-brand-orange">
                    <Flame size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white uppercase tracking-wider">
                      Set {targetEditingSetIdx + 1} · A Sfinimento
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {currentExercise.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMaxPromptModalOpen(false)}
                  className="text-zinc-400 hover:text-white p-1 cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <p className="text-xs text-zinc-300 text-center">
                Inserisci {getPerformanceUnit(currentExercise) === 'sec' ? 'i secondi di tenuta' : 'le ripetizioni'} eseguiti in questo set:
              </p>

              <div className="flex items-center justify-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => setModalPerformanceValue((prev) => Math.max(0, prev - 5))}
                  className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                >
                  -5
                </button>
                <button
                  type="button"
                  onClick={() => setModalPerformanceValue((prev) => Math.max(0, prev - 1))}
                  className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-lg flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                >
                  -1
                </button>

                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={modalPerformanceValue > 0 ? modalPerformanceValue : ''}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setModalPerformanceValue(Number.isFinite(val) && val >= 0 ? Math.trunc(val) : 0);
                  }}
                  placeholder="0"
                  autoFocus
                  className="w-24 h-14 bg-black/60 border-2 border-brand-orange rounded-2xl text-center text-3xl font-mono font-black text-brand-orange focus:outline-none"
                />

                <button
                  type="button"
                  onClick={() => setModalPerformanceValue((prev) => prev + 1)}
                  className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-lg flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => setModalPerformanceValue((prev) => prev + 5)}
                  className="w-11 h-11 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                >
                  +5
                </button>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setLoggedPerformanceForSet(currentExerciseIdx, currentExercise, targetEditingSetIdx, modalPerformanceValue);
                    setIsMaxPromptModalOpen(false);
                    if (targetEditingSetIdx === currentSetIdx && isPendingSetAdvanceRef.current) {
                      isPendingSetAdvanceRef.current = false;
                      completeSet();
                    }
                  }}
                  className="w-full py-3.5 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-sm uppercase tracking-wider transition-colors shadow-lg shadow-brand-orange/20 cursor-pointer"
                >
                  {targetEditingSetIdx === currentSetIdx && isPendingSetAdvanceRef.current
                    ? 'Salva e Continua'
                    : 'Salva'}
                </button>
                {targetEditingSetIdx === currentSetIdx && isPendingSetAdvanceRef.current && (
                  <button
                    type="button"
                    onClick={() => {
                      isPendingSetAdvanceRef.current = false;
                      setIsMaxPromptModalOpen(false);
                      completeSet();
                    }}
                    className="text-xs text-zinc-400 hover:text-zinc-200 py-1 transition-colors cursor-pointer"
                  >
                    Salta / Lascia MAX
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <WorkoutCelebrationModal
          isOpen={isCelebrationOpen}
          workoutName={workout?.name}
          durationSeconds={getCurrentWorkoutElapsedSeconds()}
          exercisesCompletedCount={workout?.exercises?.length}
          onComplete={handleCelebrationComplete}
        />
      </>
    );
  };

  const renderLandscapeRestView = () => {
    return (
      <div
        className="h-dvh h-screen max-h-screen bg-brand-dark flex flex-col justify-between overflow-hidden px-4 select-none relative"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.25rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.25rem)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 0.75rem)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 0.75rem)',
        }}
      >
        {voiceCommandsHelpBubble}

        {/* Top HUD Bar */}
        <header className="flex items-center justify-between shrink-0 h-10 px-1 z-10">
          <button
            onClick={handleLeaveWorkout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-zinc-300 hover:text-white border border-white/10 text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
            title="Esci dal workout"
          >
            <X size={14} className="text-zinc-400" />
            <span>Esci</span>
          </button>

          <button
            type="button"
            onClick={openWorkoutOverviewModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-brand-darkGrey/80 border border-brand-orange/30 text-white hover:border-brand-orange/60 active:scale-95 transition-all text-xs font-bold max-w-[280px] shadow-sm cursor-pointer"
            title="Open workout overview"
          >
            <span className="text-[10px] text-brand-orange uppercase tracking-wider font-mono font-black">RECUPERO</span>
            <span className="text-zinc-500">•</span>
            <span className="truncate text-zinc-200">{restOverviewExerciseLabel}</span>
            {hasGeneralWorkoutNote && (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
            )}
            <ChevronDown size={13} className="text-zinc-400 shrink-0" />
          </button>

          <div className="flex items-center gap-2">
            <div className="relative">
              {voiceStatus === 'success' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
              )}
              {voiceStatus === 'error' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
              <button
                onClick={handleVoiceButtonClick}
                className={`p-2 rounded-full transition-all duration-300 cursor-pointer ${
                  isVoiceEnabled
                    ? voiceStatus === 'success'
                      ? 'bg-green-500 text-white scale-105'
                      : voiceStatus === 'error'
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-brand-orange text-black'
                    : 'text-white/50 hover:text-white bg-brand-darkGrey/40'
                }`}
                title="Voice Assistant"
              >
                {isVoiceEnabled ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
            </div>
          </div>
        </header>

        {/* 2-Column Grid Body */}
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 items-center my-1">
          {/* Left Column: Timer & Controls (5 cols) */}
          <div className="col-span-5 flex flex-col items-center justify-center h-full">
            <div
              className={`w-40 h-40 sm:w-44 sm:h-44 rounded-full flex flex-col justify-center items-center relative overflow-hidden cursor-pointer select-none transition-all duration-300 ${
                restRemaining <= 3 && restRemaining > 0
                  ? 'border-[6px] border-brand-orange ring-4 ring-brand-orange/60 shadow-[0_0_50px_rgba(255,107,0,0.6)] animate-pulse'
                  : 'border-[6px] border-brand-darkGrey shadow-[0_0_30px_rgba(255,107,0,0.15)] bg-black/40'
              }`}
              onPointerDown={(event) => handleTimerPointerDown(event, resetRestCountdown)}
              onPointerUp={(event) => handleTimerPointerUp(event, handleRestTimerTap)}
              onPointerCancel={handleTimerPointerAbort}
              onPointerLeave={handleTimerPointerAbort}
            >
              <div
                className="absolute bottom-0 left-0 right-0 bg-brand-orange/20 transition-all duration-1000 ease-linear pointer-events-none"
                style={{
                  height: `${(restRemaining / Math.max(1, restInitialDuration || currentExercise.rest_seconds || 1)) * 100}%`,
                }}
              />
              <Timer
                size={22}
                className={`mb-0.5 transition-transform duration-300 ${
                  restRemaining <= 3 && restRemaining > 0 ? 'text-brand-orange scale-110' : 'text-brand-orange'
                }`}
              />
              <span
                className={`text-5xl sm:text-6xl font-black z-10 font-mono tracking-tighter transition-all duration-300 leading-none ${
                  restRemaining <= 3 && restRemaining > 0 ? 'text-brand-orange scale-105' : 'text-white'
                }`}
              >
                {formatTime(restRemaining)}
              </span>
              <span className="text-zinc-400 font-bold uppercase tracking-widest text-[10px] mt-1 z-10">
                {restEndsAtMs != null ? 'RECUPERO' : 'IN PAUSA'}
              </span>
            </div>

            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-center mt-2">
              Tocca per {restEndsAtMs != null ? 'pausa' : 'avvio'} • Tieni premuto per azzerare
            </p>

            {pipManager.isSupported() && (
              <button
                type="button"
                onClick={handleTogglePiP}
                className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-brand-orange/30 bg-brand-darkGrey/60 hover:bg-brand-orange/20 text-brand-orange text-[11px] font-bold transition-all shadow-sm cursor-pointer"
                title="Mostra timer flottante sopra altre app (PiP)"
              >
                <Layers size={12} />
                <span>{pipManager.isActive() ? 'Chiudi PiP' : 'Mini-Timer PiP'}</span>
              </button>
            )}
          </div>

          {/* Right Column: Next Exercise Preview & Actions (7 cols) */}
          <div className="col-span-7 flex flex-col justify-between h-full py-1">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black uppercase tracking-wider text-brand-orange flex items-center gap-1.5">
                  <ArrowRight size={13} className="text-brand-orange" />
                  {transitionNextExercise ? 'Prossimo esercizio' : 'Prossimo set'}
                </span>
                <div className="flex items-center gap-2">
                  {restTargetSpecialTypeLabel && (
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange border border-brand-orange/30">
                      {restTargetSpecialTypeLabel}
                    </span>
                  )}
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                    {transitionNextExercise
                      ? `Es. ${currentExerciseIdx + 2} di ${workout.exercises.length}`
                      : currentExercise.type === 'pyramid'
                        ? `Step ${currentPyramidStepIdx + 2} di ${currentExercise.pyramid_steps?.length || 1}`
                        : currentExercise.type === 'emom'
                          ? `Round ${currentEmomRoundIdx + 2} di ${effectiveEmomRounds}`
                          : `${isSuperset ? 'Round' : isCircuit ? 'Giro' : 'Set'} ${currentSetIdx + 2} di ${currentExercise.sets}`}
                  </span>
                </div>
              </div>

              {/* Next Target Preview Card */}
              <div className="w-full bg-gradient-to-b from-brand-darkGrey/90 to-brand-darkGrey/40 border border-white/10 rounded-2xl p-3 shadow-xl flex flex-col gap-2">
                {restUpcomingExecutionEntries.length > 0 && (
                  <div className="space-y-1">
                    {restUpcomingExecutionEntries.slice(0, 3).map((entry, idx) => (
                      <div key={`${entry.name}-${entry.weightLabel}-${idx}`} className="flex items-center justify-between text-sm">
                        <span className="text-white font-black truncate">{entry.name}</span>
                        <span className="text-brand-orange font-mono font-bold text-xs ml-2 shrink-0">{entry.weightLabel}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Performance logged summary during rest for MAX exercises */}
                {isMaxPerformance(currentExercise) && (
                  <div className="bg-black/50 border border-brand-orange/30 rounded-xl p-2 flex items-center justify-between">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-zinc-400 block">
                        Set {currentSetIdx + 1} (A Sfinimento)
                      </span>
                      <span className="text-sm font-black text-brand-orange font-mono">
                        {getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) != null &&
                        (getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 0) > 0
                          ? `${getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)} ${getPerformanceUnit(currentExercise) === 'sec' ? 's' : 'reps'}`
                          : 'MAX'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEditSpecificSetModal(currentSetIdx)}
                      className="px-2.5 py-1 rounded-lg bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange text-xs font-bold transition-all border border-brand-orange/30 flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil size={11} />
                      <span>Modifica</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Action Bar */}
            <div className="h-12 flex items-stretch gap-2.5 mt-2">
              <button
                onClick={openCurrentExerciseNoteModal}
                className={`w-12 rounded-xl border transition-all active:scale-95 flex items-center justify-center relative shadow-sm cursor-pointer ${
                  hasCurrentWorkoutNote
                    ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                    : 'bg-brand-darkGrey/60 border-white/10 text-zinc-400 hover:text-white'
                }`}
                title="Note esercizio"
              >
                <FileText size={18} />
                {hasCurrentWorkoutNote && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-orange ring-2 ring-black" />
                )}
              </button>

              <button
                onClick={skipRest}
                className="flex-1 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-xl font-black text-sm sm:text-base flex items-center justify-center transition-all border border-white/10 shadow-lg cursor-pointer"
              >
                <SkipForward size={18} className="mr-2" /> SALTA RECUPERO
              </button>
            </div>
          </div>
        </div>

        {renderWorkoutOverviewModal()}
        {renderExerciseNoteModal()}
        <WorkoutCelebrationModal
          isOpen={isCelebrationOpen}
          workoutName={workout?.name}
          durationSeconds={getCurrentWorkoutElapsedSeconds()}
          exercisesCompletedCount={workout?.exercises?.length}
          onComplete={handleCelebrationComplete}
        />
      </div>
    );
  };

  const renderLandscapeWorkoutView = () => {
    return (
      <div
        className="h-dvh h-screen max-h-screen bg-brand-dark flex flex-col justify-between overflow-hidden select-none relative"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.25rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.25rem)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 0.75rem)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 0.75rem)',
        }}
      >
        {voiceCommandsHelpBubble}

        {/* Top HUD Bar */}
        <div className="shrink-0 flex flex-col">
          <header className="flex items-center justify-between h-9 px-1 z-10 relative">
            <button
              onClick={handleLeaveWorkout}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-zinc-300 hover:text-white border border-white/10 text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
              title="Esci dall'allenamento"
            >
              <X size={14} className="text-zinc-400" />
              <span>Esci</span>
            </button>

            <button
              type="button"
              onClick={openWorkoutOverviewModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-brand-darkGrey/80 border border-brand-orange/30 text-white hover:border-brand-orange/60 active:scale-95 transition-all text-xs font-bold max-w-[280px] shadow-sm cursor-pointer"
              title="Panoramica allenamento"
            >
              <span className="text-[10px] text-brand-orange uppercase tracking-wider font-mono font-black">
                {currentExerciseIdx + 1}/{workout.exercises.length}
              </span>
              <span className="text-zinc-500">•</span>
              <span className="truncate text-zinc-200">{workout.name}</span>
              {hasGeneralWorkoutNote && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
              )}
              <ChevronDown size={13} className="text-zinc-400 shrink-0" />
            </button>

            <div className="flex items-center gap-2">
              <div className="relative">
                {voiceStatus === 'success' && (
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                )}
                {voiceStatus === 'error' && (
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                )}
                <button
                  onClick={handleVoiceButtonClick}
                  className={`p-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                    isVoiceEnabled
                      ? voiceStatus === 'success'
                        ? 'bg-green-500 text-white scale-105'
                        : voiceStatus === 'error'
                          ? 'bg-red-500 text-white animate-pulse'
                          : 'bg-brand-orange text-black'
                      : 'text-white/50 hover:text-white bg-brand-darkGrey/40'
                  }`}
                  title="Assistente vocale"
                >
                  {isVoiceEnabled ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
              </div>
            </div>
          </header>

          {/* Slim Progress Bar */}
          <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden mt-0.5 mb-1">
            <div
              className="bg-brand-orange h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(255,107,0,0.5)]"
              style={{ width: `${((currentExerciseIdx + 1) / workout.exercises.length) * 100}%` }}
            />
          </div>
        </div>

        {/* 2-Column Grid Layout for Workout */}
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-3 sm:gap-4 my-1">
          {/* Left Column (5 cols): Nav, Segmented dots, Chips, History, Tools */}
          <div className="col-span-5 flex flex-col justify-between bg-black/40 border border-white/10 rounded-2xl p-2.5 sm:p-3 min-h-0">
            {/* Top: Nav + Badges */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-1.5">
                <button
                  onClick={handleArrowPrevExercise}
                  disabled={currentExerciseIdx === 0}
                  className="w-8 h-8 sm:w-9 sm:h-9 bg-brand-darkGrey/80 rounded-xl text-zinc-300 hover:text-white disabled:opacity-20 disabled:hover:text-zinc-500 transition-all active:scale-95 shrink-0 border border-white/10 flex items-center justify-center shadow-md cursor-pointer"
                  title="Esercizio precedente"
                >
                  <ArrowPrev size={16} />
                </button>

                <div className="flex-1 min-w-0 flex flex-col items-center text-center">
                  <span className="text-[9px] uppercase font-bold tracking-[0.2em] text-brand-orange">
                    Es. {currentExerciseIdx + 1} di {workout.exercises.length}
                  </span>
                  <h2 className="text-sm sm:text-base font-black text-white leading-tight truncate max-w-[170px] sm:max-w-[210px] drop-shadow-sm mt-0.5">
                    {currentExercise.name}
                  </h2>

                  <div className="flex items-center gap-1 mt-1 flex-wrap justify-center">
                    {specialExerciseLabel && (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${specialExercisePillClass}`}>
                        {specialExerciseLabel}
                      </span>
                    )}
                    {hasCurrentInstructionNote && (
                      <button
                        onClick={openCurrentInstructionModal}
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-brand-darkGrey/80 border border-brand-orange/30 text-brand-orange hover:text-white text-[9px] font-bold transition-colors cursor-pointer"
                        title="Istruzioni Esercizio"
                      >
                        <Info size={10} />
                        <span>Info</span>
                      </button>
                    )}
                    {!isSuperset && currentExercise.auto_count_type && (
                      <button
                        onClick={() => setIsAutoCountModalOpen(true)}
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:text-white text-[9px] font-bold transition-colors cursor-pointer"
                        title="Auto-count con fotocamera"
                      >
                        <Video size={10} />
                        <span>AI Count</span>
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleArrowNextExercise}
                  className="w-8 h-8 sm:w-9 sm:h-9 bg-brand-darkGrey/80 rounded-xl text-zinc-300 hover:text-white transition-all active:scale-95 shrink-0 border border-white/10 flex items-center justify-center shadow-md cursor-pointer"
                  title="Prossimo esercizio"
                >
                  <ArrowRight size={16} />
                </button>
              </div>

              {/* Segmented Set/Round Tracker */}
              <div className="flex justify-center items-center gap-1 px-1">
                {Array.from({ length: isEmom ? effectiveEmomRounds : (currentExercise.sets || 1) }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => isEmom ? setCurrentEmomRoundIdx(i) : setCurrentSetIdx(i)}
                    className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                      (isEmom ? i < currentEmomRoundIdx : i < currentSetIdx)
                        ? 'bg-emerald-500/80 flex-1 max-w-10'
                        : (isEmom ? i === currentEmomRoundIdx : i === currentSetIdx)
                          ? 'bg-brand-orange flex-1 max-w-12 shadow-[0_0_10px_rgba(255,107,0,0.6)] ring-1 ring-brand-orange'
                          : 'bg-white/15 flex-1 max-w-10 hover:bg-white/25'
                    }`}
                    title={isEmom ? `Round ${i + 1}` : `Set ${i + 1}`}
                  />
                ))}
              </div>

              {/* 3-Column HUD Chips */}
              <div className="w-full grid grid-cols-3 gap-1.5 shrink-0">
                {isEmom ? (
                  <>
                    <div className="bg-black/50 border border-white/5 rounded-xl py-1.5 px-1 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 block font-semibold">
                        {currentExercise.sets > 1 ? 'Set' : 'Round'}
                      </span>
                      <span className="text-brand-orange font-mono font-black text-sm">
                        {currentExercise.sets > 1
                          ? `${currentSetIdx + 1}/${currentExercise.sets}`
                          : `${currentEmomRoundIdx + 1}/${effectiveEmomRounds}`}
                      </span>
                    </div>

                    <div className="bg-black/50 border border-white/5 rounded-xl py-1.5 px-1 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 block font-semibold">
                        {currentExercise.sets > 1 ? 'Round' : 'Round Totali'}
                      </span>
                      <span className="text-white font-mono font-black text-xs truncate block">
                        {currentExercise.sets > 1
                          ? `${currentEmomRoundIdx + 1}/${effectiveEmomRounds}`
                          : `${effectiveEmomRounds} rnd`}
                      </span>
                    </div>

                    <div className="bg-black/50 border border-white/5 rounded-xl py-1.5 px-1 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 block font-semibold">Durata Round</span>
                      <span className="text-zinc-300 font-mono font-black text-xs truncate block">
                        {currentExercise.emom_round_duration || 60}s
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-black/50 border border-white/5 rounded-xl py-1.5 px-1 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 block font-semibold">
                        {isSuperset ? 'Round' : isCircuit ? 'Giro' : 'Set'}
                      </span>
                      <span className="text-brand-orange font-mono font-black text-sm">
                        {`${currentSetIdx + 1}/${currentExercise.sets || 1}`}
                      </span>
                    </div>

                    <div className="bg-black/50 border border-white/5 rounded-xl py-1.5 px-1 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 block font-semibold">Carico</span>
                      <span className="text-white font-mono font-black text-xs truncate block" title={currentExecutionWeightLabel}>
                        {currentExecutionWeightLabel || '-'}
                      </span>
                    </div>

                    <div className="bg-black/50 border border-white/5 rounded-xl py-1.5 px-1 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 block font-semibold">Recupero</span>
                      <span className="text-zinc-300 font-mono font-black text-xs truncate block" title={nextRecoveryLabel}>
                        {nextRecoveryLabel || '-'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Middle: Set History summary pills for MAX performance or Pyramid steps */}
            {isMaxPerformance(currentExercise) ? (
              <div className="my-1 overflow-x-auto">
                <div className="flex gap-1 justify-center">
                  {Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                    const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                    const isCurrent = sIdx === currentSetIdx;
                    const isDone = logged != null && logged > 0;
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => openEditSpecificSetModal(sIdx)}
                        className={`py-1 px-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center cursor-pointer min-w-[42px] ${
                          isCurrent
                            ? 'bg-brand-orange/20 border-brand-orange text-white ring-1 ring-brand-orange/50 shadow-sm'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500'
                        }`}
                      >
                        <span className="text-[7px] uppercase font-bold opacity-70">S{sIdx + 1}</span>
                        <span className="text-[11px] font-black font-mono mt-0.5">
                          {logged != null && logged > 0
                            ? `${logged}${getPerformanceUnit(currentExercise) === 'sec' ? 's' : ''}`
                            : isCurrent
                              ? (getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || '-')
                              : '-'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : currentExercise.type === 'pyramid' && currentExercise.pyramid_steps ? (
              <div className="my-1 overflow-x-auto">
                <div className="flex gap-1 justify-center">
                  {currentExercise.pyramid_steps.map((step, sIdx) => {
                    const isCurrent = sIdx === currentPyramidStepIdx;
                    const isDone = sIdx < currentPyramidStepIdx;
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => {
                          void hapticLight();
                          setCurrentPyramidStepIdx(sIdx);
                        }}
                        className={`py-1 px-1.5 rounded-lg border text-center transition-all min-w-[38px] cursor-pointer ${
                          isCurrent
                            ? 'bg-[#521d00]/95 border-brand-orange text-white shadow-sm ring-1 ring-brand-orange/50'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                        }`}
                        title={`Vai allo Step ${sIdx + 1}`}
                      >
                        <span className="text-[7px] uppercase font-bold block opacity-70">S{sIdx + 1}</span>
                        <span className="text-[11px] font-black font-mono mt-0.5">
                          {isMaxTarget(step.reps) ? 'MAX' : `${step.reps}r`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : isEmom ? (
              <div className="my-1 overflow-x-auto">
                <div className="flex gap-1 justify-center">
                  {Array.from({ length: effectiveEmomRounds }, (_, rIdx) => {
                    const isCurrent = rIdx === currentEmomRoundIdx;
                    const isDone = rIdx < currentEmomRoundIdx;
                    return (
                      <button
                        key={rIdx}
                        type="button"
                        onClick={() => setCurrentEmomRoundIdx(rIdx)}
                        className={`py-1 px-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center cursor-pointer min-w-[38px] ${
                          isCurrent
                            ? 'bg-brand-orange/20 border-brand-orange text-white ring-1 ring-brand-orange/50 shadow-sm'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                        }`}
                        title={`Vai al round ${rIdx + 1}`}
                      >
                        <span className="text-[7px] uppercase font-bold opacity-70">R{rIdx + 1}</span>
                        <span className="text-[11px] font-black font-mono mt-0.5">
                          {isDone ? '✓' : isCurrent ? `${emomRoundRemaining}s` : `${currentExercise.emom_round_duration || 60}s`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="my-1 overflow-x-auto">
                <div className="flex gap-1 justify-center">
                  {Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                    const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                    const isCurrent = sIdx === currentSetIdx;
                    const isDone = sIdx < currentSetIdx;
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => openEditSpecificSetModal(sIdx)}
                        className={`py-1 px-1.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center cursor-pointer min-w-[38px] ${
                          isCurrent
                            ? 'bg-brand-orange/20 border-brand-orange text-white ring-1 ring-brand-orange/50 shadow-sm'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                        }`}
                        title={`Modifica set ${sIdx + 1}`}
                      >
                        <span className="text-[7px] uppercase font-bold opacity-70">S{sIdx + 1}</span>
                        <span className="text-[11px] font-black font-mono mt-0.5">
                          {logged != null && logged > 0
                            ? `${logged}r`
                            : isDone
                              ? `${currentExercise.reps}r`
                              : isCurrent
                                ? `${currentExercise.reps}r`
                                : `${currentExercise.reps}r`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Instruction or AI Count context trigger if present */}
            {hasCurrentInstructionNote && (
              <button
                type="button"
                onClick={openCurrentInstructionModal}
                className="w-full py-1 px-2 rounded-lg bg-brand-orange/10 hover:bg-brand-orange/20 border border-brand-orange/30 text-brand-orange text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer mb-1 shrink-0"
              >
                <Info size={11} />
                <span>Leggi Istruzioni Esercizio</span>
              </button>
            )}
            {!isSuperset && currentExercise.auto_count_type && (
              <button
                type="button"
                onClick={() => setIsAutoCountModalOpen(true)}
                className="w-full py-1 px-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 text-purple-300 text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer mb-1 shrink-0"
              >
                <Video size={11} />
                <span>Auto-Count con Fotocamera</span>
              </button>
            )}

            {/* Bottom Tools Row */}
            <div className="pt-1 border-t border-white/5">
              <button
                type="button"
                onClick={openCurrentExerciseNoteModal}
                className={`w-full py-1.5 rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 text-xs font-bold relative shadow-sm cursor-pointer ${
                  hasCurrentWorkoutNote
                    ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                    : 'bg-brand-darkGrey/60 border-white/10 text-zinc-300 hover:text-white hover:border-white/25'
                }`}
                title="Note esercizio"
              >
                <FileText size={13} />
                <span>Note esercizio</span>
                {hasCurrentWorkoutNote && (
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-orange" />
                )}
              </button>
            </div>
          </div>

          {/* Right Column (7 cols): Dynamic Interactive Exercise Card + Big CTA */}
          <div className="col-span-7 flex flex-col justify-between bg-gradient-to-b from-brand-darkGrey/90 via-brand-darkGrey/60 to-brand-darkGrey/40 border border-white/10 rounded-2xl p-2.5 sm:p-3 shadow-2xl backdrop-blur-sm min-h-0">
            {/* Dynamic Content Center */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
              {currentExercise.type === 'emom' ? (
                <div className="text-center w-full flex items-center justify-around h-full gap-4">
                  {/* EMOM Circular Timer */}
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className={`relative group w-44 h-44 sm:w-52 sm:h-52 rounded-full flex flex-col justify-center items-center transition-all duration-300 shadow-xl cursor-pointer select-none overflow-hidden ${
                        emomRoundRemaining <= 3 && emomRoundRemaining > 0
                          ? 'border-[10px] border-brand-orange ring-4 ring-brand-orange/60 shadow-[0_0_60px_rgba(255,107,0,0.6)] animate-pulse'
                          : emomActive
                            ? 'border-[10px] border-brand-orange shadow-[0_0_35px_rgba(255,94,0,0.35)]'
                            : 'border-[10px] border-white/10 bg-black/40'
                      }`}
                      onPointerDown={(event) => handleTimerPointerDown(event, resetEmomCountdown)}
                      onPointerUp={(event) => handleTimerPointerUp(event, handleEmomTimerTap)}
                      onPointerCancel={handleTimerPointerAbort}
                      onPointerLeave={handleTimerPointerAbort}
                    >
                      <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" stroke="rgba(255, 255, 255, 0.06)" strokeWidth="5" fill="transparent" />
                        <circle
                          cx="50"
                          cy="50"
                          r="44"
                          stroke={emomRoundRemaining <= 3 && emomRoundRemaining > 0 ? '#FF7724' : '#FF5E00'}
                          strokeWidth="5"
                          strokeDasharray={2 * Math.PI * 44}
                          strokeDashoffset={2 * Math.PI * 44 * (1 - emomRoundProgressRatio)}
                          strokeLinecap="round"
                          fill="transparent"
                          className="transition-[stroke-dashoffset] duration-300 ease-linear"
                        />
                      </svg>

                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-orange/90 mb-0.5 z-10">
                        ROUND {currentEmomRoundIdx + 1}/{currentExercise.emom_rounds || 1}
                      </span>
                      <span
                        className={`text-6xl sm:text-7xl font-mono font-black tracking-tighter leading-none z-10 transition-all ${
                          emomRoundRemaining <= 3 && emomRoundRemaining > 0
                            ? 'text-brand-orange scale-105 drop-shadow-[0_0_20px_rgba(255,107,0,0.8)]'
                            : emomActive
                              ? 'text-white'
                              : 'text-zinc-400'
                        }`}
                      >
                        {emomRoundRemaining >= 100 ? formatTime(emomRoundRemaining) : emomRoundRemaining}
                      </span>
                      <span className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mt-1 z-10">
                        {emomActive ? 'SEC LEFT' : 'IN PAUSA'}
                      </span>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity pointer-events-none z-20">
                        {emomActive ? <Pause size={38} className="text-white" /> : <Play size={38} className="text-white ml-1" />}
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-center mt-1.5">
                      {emomActive ? 'Tocca per pausa' : 'Tocca per avvio'}
                    </p>
                  </div>

                  {/* EMOM Tasks List */}
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 max-h-48">
                    {currentExercise.subExercises?.map((sub, idx) => (
                      <div key={idx} className="bg-black/50 p-2.5 rounded-2xl border border-white/10 flex justify-between items-center text-xs shadow-sm">
                        <span className="text-white font-bold truncate max-w-[65%] text-left text-xs sm:text-sm">{sub.name}</span>
                        <div className="text-right shrink-0 flex items-center gap-1.5">
                          <span className="text-brand-orange font-mono font-black text-xs sm:text-sm bg-brand-orange/15 px-2.5 py-0.5 rounded-lg border border-brand-orange/30">
                            {formatEmomTaskMetricLabel(sub)}
                          </span>
                          {sub.weight_kg != null && sub.weight_kg > 0 && (
                            <span className="text-[10px] text-zinc-400 font-semibold font-mono">{formatWeightLabel(sub.weight_kg)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : currentExercise.type === 'pyramid' ? (
                <div className="text-center w-full flex flex-col items-center justify-center my-auto">
                  <span className="block text-6xl sm:text-7xl font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_25px_rgba(255,107,0,0.3)] tracking-tight">
                    {formatBigTargetValue(currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.reps || 0)}
                  </span>
                  <span className="text-zinc-400 font-black uppercase tracking-[0.25em] text-xs mt-1.5">RIPETIZIONI TARGET</span>
                  {nextRecoveryLabel && (
                    <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-bold text-center mt-2">
                      Prossimo Recupero: <span className="text-brand-orange font-mono">{nextRecoveryLabel}</span>
                    </p>
                  )}
                </div>
              ) : isCircuit ? (
                <div className="text-center w-full flex items-center justify-around h-full gap-3">
                  {/* Circuit Stopwatch */}
                  <div
                    className={`w-36 sm:w-44 p-2.5 rounded-2xl border-2 flex flex-col items-center justify-center transition-all duration-300 shadow-md cursor-pointer select-none shrink-0 ${
                      isCircuitStopwatchRunning
                        ? 'border-brand-orange bg-brand-orange/15 shadow-[0_0_20px_rgba(179,72,0,0.25)]'
                        : circuitStopwatchElapsed > 0
                          ? 'border-brand-orange/70 bg-black/40'
                          : 'border-white/10 bg-black/30'
                    }`}
                    onPointerDown={(event) => handleTimerPointerDown(event, resetCircuitStopwatch)}
                    onPointerUp={(event) => handleTimerPointerUp(event, toggleCircuitStopwatch)}
                    onPointerCancel={handleTimerPointerAbort}
                    onPointerLeave={handleTimerPointerAbort}
                  >
                    <span className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-white leading-none my-0.5">
                      {formatTime(circuitStopwatchElapsed)}
                    </span>
                    <p className="text-[9px] text-zinc-400 uppercase tracking-widest font-semibold mt-1">
                      {isCircuitStopwatchRunning ? 'Tocca per stop' : 'Tocca per avvio'}
                    </p>
                  </div>

                  {/* Stations List */}
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 max-h-36">
                    {(currentExercise.subExercises || []).map((sub, idx) => (
                      <div
                        key={`${currentExercise.id}:circuit-station:${idx}`}
                        className="p-1.5 px-2 rounded-xl border border-white/10 bg-black/40 flex justify-between items-center text-xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-4 h-4 rounded-full bg-brand-orange/20 text-brand-orange flex items-center justify-center font-bold text-[9px] shrink-0">
                            {idx + 1}
                          </span>
                          <span className="truncate font-bold text-white/90 text-xs">{sub.name}</span>
                        </div>
                        <span className="font-mono text-xs text-brand-orange font-black ml-2 shrink-0">
                          {sub.type === 'reps' ? `${sub.reps}r` : `${sub.duration_seconds}s`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : isSuperset ? (
                <div className="w-full flex-1 min-h-0 overflow-y-auto space-y-1.5 px-1 my-auto max-h-36">
                  {(currentExercise.subExercises || []).map((sub, idx) => {
                    const isIsoSub = sub.type === 'isometry';
                    const isClickableIsoTimer = isIsoSub && sub.duration_seconds > 0;
                    const isThisTimerActive = isClickableIsoTimer && isometryActive && supersetIsometrySubIdx === idx;
                    const targetDuration = isClickableIsoTimer ? Math.max(1, sub.duration_seconds || 1) : 1;
                    const currentRemaining = isThisTimerActive || (isClickableIsoTimer && supersetIsometrySubIdx === idx) ? isometryRemaining : targetDuration;
                    const fillPercent = isClickableIsoTimer && supersetIsometrySubIdx === idx ? Math.max(0, Math.min(100, ((targetDuration - currentRemaining) / targetDuration) * 100)) : 0;

                    const handleSubIsoTap = () => {
                      if (!isClickableIsoTimer) return;
                      if (isThisTimerActive) {
                        pauseIsometryCountdown();
                        return;
                      }
                      if (isometryActive) stopIsometryCountdown();
                      setSupersetIsometrySubIdx(idx);
                      const duration = (supersetIsometrySubIdx === idx && isometryRemaining > 0) ? isometryRemaining : targetDuration;
                      startIsometryCountdown(duration);
                    };

                    const handleSubIsoReset = () => {
                      if (!isClickableIsoTimer) return;
                      stopIsometryCountdown();
                      setSupersetIsometrySubIdx(idx);
                      setIsometryRemaining(targetDuration);
                    };

                    return (
                      <div
                        key={`${currentExercise.id}:superset:${idx}`}
                        className={`relative overflow-hidden p-2.5 rounded-xl border flex justify-between items-center gap-2 select-none transition-colors ${
                          isThisTimerActive
                            ? 'border-brand-orange/70 bg-brand-orange/15 shadow-[0_0_15px_rgba(255,107,0,0.2)]'
                            : isClickableIsoTimer && supersetIsometrySubIdx === idx && fillPercent > 0
                              ? 'border-brand-orange/40 bg-black/40'
                              : 'border-white/10 bg-black/30'
                        } ${isClickableIsoTimer ? 'cursor-pointer active:scale-[0.98]' : ''}`}
                        {...(isClickableIsoTimer ? {
                          onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => handleTimerPointerDown(event, handleSubIsoReset),
                          onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => handleTimerPointerUp(event, handleSubIsoTap),
                          onPointerCancel: handleTimerPointerAbort,
                          onPointerLeave: handleTimerPointerAbort,
                        } : {})}
                      >
                        {isClickableIsoTimer && fillPercent > 0 && (
                          <div
                            className="absolute inset-0 bg-brand-orange/20 transition-[width] duration-300 ease-linear pointer-events-none rounded-xl"
                            style={{ width: `${fillPercent}%` }}
                          />
                        )}
                        <div className="text-left min-w-0 relative z-10">
                          <p className="text-white font-black text-xs truncate">{idx + 1}. {sub.name || `Exercise ${idx + 1}`}</p>
                          <p className="text-[10px] text-brand-orange font-black uppercase tracking-wide">
                            {isClickableIsoTimer && supersetIsometrySubIdx === idx
                              ? `${currentRemaining}s / ${targetDuration}s`
                              : formatSupersetTaskMetricLabel(sub)
                            }
                          </p>
                        </div>
                        <span className="text-xs text-brand-lightOrange font-mono font-bold shrink-0 relative z-10">
                          {formatWeightLabel(sub.weight_kg)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (currentExercise.type === 'isometry' || currentExercise.type === 'cardio') ? (
                <div className="text-center w-full flex items-center justify-around h-full gap-4">
                  {/* Circular Timer / Stopwatch */}
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border-[6px] flex flex-col justify-center items-center transition-colors duration-300 shadow-xl cursor-pointer ${
                        isometryStopwatchActive || isometryActive ? 'border-brand-orange shadow-[0_0_25px_rgba(255,107,0,0.3)]' : 'border-brand-darkGrey bg-black/40'
                      }`}
                      onPointerDown={(event) => handleTimerPointerDown(event, resetIsometryCountdown)}
                      onPointerUp={(event) => handleTimerPointerUp(event, handleIsometryTimerTap)}
                      onPointerCancel={handleTimerPointerAbort}
                      onPointerLeave={handleTimerPointerAbort}
                    >
                      <span className={`text-4xl sm:text-5xl font-mono tracking-tighter ${
                        isometryStopwatchActive || isometryActive ? 'text-brand-orange animate-pulse' : 'text-white'
                      } transition-colors leading-none`}>
                        {isMaxTarget(currentExercise.duration_seconds)
                          ? (isometryElapsedSeconds > 0 ? isometryElapsedSeconds : (getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 'MAX'))
                          : isometryRemaining}
                      </span>
                      <span className="text-zinc-400 font-bold uppercase tracking-widest text-[9px] mt-0.5">
                        {isMaxTarget(currentExercise.duration_seconds) && isometryElapsedSeconds === 0 && !getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)
                          ? 'A SFINIMENTO'
                          : 'SEC'}
                      </span>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 rounded-full transition-opacity pointer-events-none">
                        {isometryStopwatchActive || isometryActive ? <Pause size={30} className="text-white" /> : <Play size={30} className="text-white" />}
                      </div>
                    </div>
                    <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider text-center mt-1">
                      {isMaxTarget(currentExercise.duration_seconds) ? 'Tocca per cronometro' : 'Tocca per avvio/pausa'}
                    </p>
                  </div>

                  {/* Steppers if MAX Isometry */}
                  {isMaxTarget(currentExercise.duration_seconds) && (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-[10px] uppercase font-bold text-zinc-400">Regola Durata</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => adjustCurrentSetPerformance(-5)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 font-bold text-xs border border-white/5 cursor-pointer"
                        >
                          -5s
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustCurrentSetPerformance(-1)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 font-bold text-xs border border-white/5 cursor-pointer"
                        >
                          -1s
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditSpecificSetModal(currentSetIdx)}
                          className="px-2.5 py-1 rounded-lg bg-brand-orange/15 hover:bg-brand-orange/25 active:scale-95 text-brand-orange font-bold text-xs border border-brand-orange/30 flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil size={10} />
                          <span>Modifica</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustCurrentSetPerformance(1)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 font-bold text-xs border border-white/5 cursor-pointer"
                        >
                          +1s
                        </button>
                        <button
                          type="button"
                          onClick={() => adjustCurrentSetPerformance(5)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 font-bold text-xs border border-white/5 cursor-pointer"
                        >
                          +5s
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : isMaxTarget(currentExercise.reps) ? (
                /* MAX REPS */
                <div className="flex flex-col items-center justify-center my-auto w-full">
                  <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-orange text-[10px] font-black uppercase tracking-wider mb-1.5">
                    <Flame size={11} className="animate-pulse" />
                    <span>A Sfinimento (MAX Reps)</span>
                  </div>

                  {/* Stepper + Value */}
                  <div className="flex items-center justify-center gap-2 w-full max-w-xs">
                    <button
                      type="button"
                      onClick={() => adjustCurrentSetPerformance(-5)}
                      className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCurrentSetPerformance(-1)}
                      className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-base flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                    >
                      -1
                    </button>

                    <div
                      onClick={() => openEditSpecificSetModal(currentSetIdx)}
                      className="px-4 py-1.5 bg-black/50 border-2 border-brand-orange/60 hover:border-brand-orange rounded-2xl flex flex-col items-center justify-center cursor-pointer shadow-[0_0_15px_rgba(255,107,0,0.2)] transition-all group select-none min-w-[90px]"
                      title="Tocca per inserire le reps fatte"
                    >
                      <span className="text-3xl font-mono font-black text-brand-orange leading-tight">
                        {(getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 0) > 0
                          ? getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)
                          : 'MAX'}
                      </span>
                      <span className="text-[8px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-0.5 mt-0.5">
                        <Pencil size={8} className="text-brand-orange" />
                        Reps
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => adjustCurrentSetPerformance(1)}
                      className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-base flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                    >
                      +1
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCurrentSetPerformance(5)}
                      className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                    >
                      +5
                    </button>
                  </div>
                  <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider text-center mt-1">
                    Tocca il valore per modificare
                  </p>
                </div>
              ) : (
                /* DEFAULT: STANDARD REPS */
                <div className="flex flex-col items-center justify-center my-auto">
                  <span className="block text-6xl sm:text-7xl font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_30px_rgba(255,107,0,0.35)] tracking-tighter">
                    {formatBigTargetValue(currentExercise.reps)}
                  </span>
                  <span className="text-zinc-400 font-black uppercase tracking-[0.25em] text-xs mt-1.5">
                    RIPETIZIONI TARGET
                  </span>
                  {nextRecoveryLabel && (
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold text-center mt-1.5">
                      Prossimo Recupero: <span className="text-brand-orange font-mono">{nextRecoveryLabel}</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Bottom CTA Action Button */}
            <div className="h-11 sm:h-12 flex items-stretch mt-1">
              <button
                onClick={handlePrimaryAction}
                className={`w-full rounded-xl font-black text-sm sm:text-base flex items-center justify-center transition-all active:scale-95 shadow-xl cursor-pointer ${
                  isFinalCompletionAction
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black shadow-emerald-500/20'
                    : 'bg-brand-orange hover:bg-brand-lightOrange text-black shadow-brand-orange/20'
                }`}
              >
                {isFinalCompletionAction ? (
                  <>
                    <CheckCircle2 size={18} className="mr-1.5" strokeWidth={2.5} />
                    TERMINA ALLENAMENTO
                  </>
                ) : isEmom && !isLastEmomRound ? (
                  <>PROSSIMO ROUND <ArrowRight size={16} className="ml-1.5" /></>
                ) : isEmom && isLastEmomRound ? (
                  <>COMPLETA SERIE</>
                ) : isPyramid && !isLastPyramidStep ? (
                  <>PROSSIMO STEP <ArrowRight size={16} className="ml-1.5" /></>
                ) : isCircuit ? (
                  isLastSet
                    ? <>COMPLETA CIRCUITO <ArrowRight size={16} className="ml-1.5" /></>
                    : <>FINE SET & RECUPERO <ArrowRight size={16} className="ml-1.5" /></>
                ) : isSuperset ? (
                  isLastSet
                    ? <>PROSSIMO ESERCIZIO <ArrowRight size={16} className="ml-1.5" /></>
                    : currentExercise.rest_seconds > 0
                      ? <>FINE ROUND & RECUPERO <ArrowRight size={16} className="ml-1.5" /></>
                      : <>PROSSIMO ROUND <ArrowRight size={16} className="ml-1.5" /></>
                ) : isLastSet ? (
                  <>PROSSIMO ESERCIZIO <ArrowRight size={16} className="ml-1.5" /></>
                ) : (
                  <>COMPLETA SERIE</>
                )}
              </button>
            </div>
          </div>
        </div>

        {renderActiveWorkoutModals()}
      </div>
    );
  };

  // ----------------------------------------------------------------------
  // RENDER REST VIEW
  // ----------------------------------------------------------------------
  if (isResting) {
    if (isLandscape) {
      return renderLandscapeRestView();
    }

    return (
      <div
        className="h-dvh h-screen max-h-screen bg-brand-dark flex flex-col justify-between overflow-hidden px-3.5 sm:px-5 safe-bottom relative select-none"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.4rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
        }}
      >
        {voiceCommandsHelpBubble}
        {renderWorkoutOverviewModal()}

        {/* Top HUD: Unambiguous Exit Button & Overview */}
        <header className="flex items-center justify-between shrink-0 h-11 px-0.5 z-10">
          <button
            onClick={handleLeaveWorkout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-zinc-300 hover:text-white border border-white/10 text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
            title="Esci dal workout"
          >
            <X size={15} className="text-zinc-400" />
            <span>Esci</span>
          </button>

          <button
            type="button"
            onClick={openWorkoutOverviewModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-brand-darkGrey/80 border border-brand-orange/30 text-white hover:border-brand-orange/60 active:scale-95 transition-all text-xs font-bold max-w-[210px] shadow-sm cursor-pointer"
            title="Open workout overview"
          >
            <span className="text-[10px] text-brand-orange uppercase tracking-wider font-mono font-black">RECUPERO</span>
            <span className="text-zinc-500">•</span>
            <span className="truncate text-zinc-200">{restOverviewExerciseLabel}</span>
            {hasGeneralWorkoutNote && (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
            )}
            <ChevronDown size={13} className="text-zinc-400 shrink-0" />
          </button>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              {voiceStatus === 'success' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
              )}
              {voiceStatus === 'error' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
              <button
                onClick={handleVoiceButtonClick}
                className={`p-2 rounded-full transition-all duration-300 cursor-pointer ${
                  isVoiceEnabled
                    ? voiceStatus === 'success'
                      ? 'bg-green-500 text-white scale-105'
                      : voiceStatus === 'error'
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-brand-orange text-black'
                    : 'text-white/50 hover:text-white bg-brand-darkGrey/40'
                }`}
                title="Voice Assistant"
              >
                {isVoiceEnabled ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
            </div>
          </div>
        </header>

        {/* Central Rest Area (Well-Filled, Rich & Proportionate) */}
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 sm:gap-4 my-auto w-full max-w-md mx-auto">
          {/* Circular Countdown Timer */}
          <div className="flex flex-col items-center w-full">
            <div
              className={`w-[min(68vw,30vh,270px)] h-[min(68vw,30vh,270px)] rounded-full flex flex-col justify-center items-center relative overflow-hidden cursor-pointer select-none transition-all duration-300 ${
                restRemaining <= 3 && restRemaining > 0
                  ? 'border-[10px] sm:border-[12px] border-brand-orange ring-4 ring-brand-orange/60 shadow-[0_0_70px_rgba(255,107,0,0.6)] animate-pulse'
                  : 'border-[10px] sm:border-[12px] border-brand-darkGrey shadow-[0_0_40px_rgba(255,107,0,0.15)] bg-black/40'
              }`}
              onPointerDown={(event) => handleTimerPointerDown(event, resetRestCountdown)}
              onPointerUp={(event) => handleTimerPointerUp(event, handleRestTimerTap)}
              onPointerCancel={handleTimerPointerAbort}
              onPointerLeave={handleTimerPointerAbort}
            >
              {/* Fill animation */}
              <div
                className="absolute bottom-0 left-0 right-0 bg-brand-orange/20 transition-all duration-1000 ease-linear pointer-events-none"
                style={{
                  height: `${(restRemaining / Math.max(1, restInitialDuration || currentExercise.rest_seconds || 1)) * 100}%`,
                }}
              />

              <Timer
                size={30}
                className={`mb-1 transition-transform duration-300 ${
                  restRemaining <= 3 && restRemaining > 0 ? 'text-brand-orange scale-110' : 'text-brand-orange'
                }`}
              />
              <span
                className={`text-7xl sm:text-8xl font-black z-10 font-mono tracking-tighter transition-all duration-300 leading-none ${
                  restRemaining <= 3 && restRemaining > 0 ? 'text-brand-orange scale-105' : 'text-white'
                }`}
              >
                {formatTime(restRemaining)}
              </span>
              <span className="text-zinc-400 font-bold uppercase tracking-widest text-[11px] sm:text-xs mt-1.5 z-10">
                {restEndsAtMs != null ? 'RECUPERO' : 'IN PAUSA'}
              </span>
            </div>

            {/* Clear Tool Instructions */}
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider text-center mt-3">
              Tocca per {restEndsAtMs != null ? 'mettere in pausa' : 'avviare'} • Tieni premuto per azzerare
            </p>

            {/* PiP Mini-Timer Button */}
            {pipManager.isSupported() && (
              <button
                type="button"
                onClick={handleTogglePiP}
                className="mt-2.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-brand-orange/30 bg-brand-darkGrey/60 hover:bg-brand-orange/20 text-brand-orange text-xs font-bold transition-all shadow-sm cursor-pointer"
                title="Mostra timer flottante sopra altre app (PiP)"
              >
                <Layers size={13} />
                <span>{pipManager.isActive() ? 'Chiudi Overlay PiP' : 'Mini-Timer PiP'}</span>
              </button>
            )}
          </div>

          {/* Header prima dell'anteprima: Prossimo set / Prossimo esercizio */}
          <div className="w-full flex flex-col gap-1.5">
            <div className="flex items-center justify-between px-1.5">
              <span className="text-xs font-black uppercase tracking-wider text-brand-orange flex items-center gap-1.5">
                <ArrowRight size={13} className="text-brand-orange" />
                {transitionNextExercise ? 'Prossimo esercizio' : 'Prossimo set'}
              </span>
              <div className="flex items-center gap-2">
                {restTargetSpecialTypeLabel && (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange border border-brand-orange/30">
                    {restTargetSpecialTypeLabel}
                  </span>
                )}
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  {transitionNextExercise
                    ? `Es. ${currentExerciseIdx + 2} di ${workout.exercises.length}`
                    : currentExercise.type === 'pyramid'
                      ? `Step ${currentPyramidStepIdx + 2} di ${currentExercise.pyramid_steps?.length || 1}`
                      : currentExercise.type === 'emom'
                        ? `Round ${currentEmomRoundIdx + 2} di ${effectiveEmomRounds}`
                        : `${isSuperset ? 'Round' : 'Set'} ${currentSetIdx + 2} di ${currentExercise.sets}`}
                </span>
              </div>
            </div>

            {/* Next Target Preview Card */}
            <div className="w-full bg-gradient-to-b from-brand-darkGrey/90 to-brand-darkGrey/40 border border-white/10 rounded-3xl p-4 shadow-xl flex flex-col gap-2">
              {restUpcomingExecutionEntries.length > 0 && (
                <div className="space-y-1.5">
                  {restUpcomingExecutionEntries.slice(0, 2).map((entry, idx) => (
                    <div key={`${entry.name}-${entry.weightLabel}-${idx}`} className="flex items-center justify-between">
                      <span className="text-white font-black text-base truncate">{entry.name}</span>
                      <span className="text-brand-orange font-mono font-bold text-sm ml-2 shrink-0">{entry.weightLabel}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Performance logged summary during rest for MAX exercises */}
              {isMaxPerformance(currentExercise) && (
                <div className="bg-black/50 border border-brand-orange/30 rounded-2xl p-2.5 mt-1 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-zinc-400 block">
                      Set {currentSetIdx + 1} (A Sfinimento)
                    </span>
                    <span className="text-base font-black text-brand-orange font-mono">
                      {getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) != null &&
                      (getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 0) > 0
                        ? `${getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)} ${getPerformanceUnit(currentExercise) === 'sec' ? 's' : 'reps'}`
                        : 'MAX'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditSpecificSetModal(currentSetIdx)}
                    className="px-3 py-1.5 rounded-xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange text-xs font-bold transition-all border border-brand-orange/30 flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    <span>Modifica</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="shrink-0 h-[58px] sm:h-[66px] flex items-stretch gap-2.5 sm:gap-3">
          <button
            onClick={openCurrentExerciseNoteModal}
            className={`w-[58px] sm:w-[66px] rounded-2xl border transition-all active:scale-95 flex items-center justify-center relative shadow-sm cursor-pointer ${
              hasCurrentWorkoutNote
                ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                : 'bg-brand-darkGrey/60 border-white/10 text-zinc-400 hover:text-white'
            }`}
            title="Note esercizio"
          >
            <FileText size={22} />
            {hasCurrentWorkoutNote && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-brand-orange ring-2 ring-black" />
            )}
          </button>

          <button
            onClick={skipRest}
            className="flex-1 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center transition-all border border-white/10 shadow-lg"
          >
            <SkipForward size={20} className="mr-2" /> SALTA RECUPERO
          </button>
        </div>

        {renderExerciseNoteModal()}
        <WorkoutCelebrationModal
          isOpen={isCelebrationOpen}
          workoutName={workout?.name}
          durationSeconds={getCurrentWorkoutElapsedSeconds()}
          exercisesCompletedCount={workout?.exercises?.length}
          onComplete={handleCelebrationComplete}
        />
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // RENDER ACTIVE EXERCISE VIEW
  // ----------------------------------------------------------------------
  if (isLandscape) {
    return renderLandscapeWorkoutView();
  }

  return (
    <div
      className="h-dvh h-screen max-h-screen bg-brand-dark flex flex-col justify-between overflow-hidden px-3.5 sm:px-5 safe-bottom select-none relative"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.4rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
      }}
    >
      {voiceCommandsHelpBubble}

      {/* ZONE 1: TOP HUD - Exit button is clearly distinguished with 'Esci' and X icon */}
      <div className="shrink-0 flex flex-col">
        <header className="flex items-center justify-between h-11 px-0.5 z-10 relative">
          <button
            onClick={handleLeaveWorkout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-zinc-300 hover:text-white border border-white/10 text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer"
            title="Esci dall'allenamento"
          >
            <X size={15} className="text-zinc-400" />
            <span>Esci</span>
          </button>

          <button
            type="button"
            onClick={openWorkoutOverviewModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-brand-darkGrey/80 border border-brand-orange/30 text-white hover:border-brand-orange/60 active:scale-95 transition-all text-xs font-bold max-w-[200px] shadow-sm cursor-pointer"
            title="Panoramica allenamento"
          >
            <span className="text-[10px] text-brand-orange uppercase tracking-wider font-mono font-black">
              {currentExerciseIdx + 1}/{workout.exercises.length}
            </span>
            <span className="text-zinc-500">•</span>
            <span className="truncate text-zinc-200">{workout.name}</span>
            {hasGeneralWorkoutNote && (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
            )}
            <ChevronDown size={13} className="text-zinc-400 shrink-0" />
          </button>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              {voiceStatus === 'success' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
              )}
              {voiceStatus === 'error' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
              <button
                onClick={handleVoiceButtonClick}
                className={`p-2 rounded-full transition-all duration-300 cursor-pointer ${
                  isVoiceEnabled
                    ? voiceStatus === 'success'
                      ? 'bg-green-500 text-white scale-105'
                      : voiceStatus === 'error'
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-brand-orange text-black'
                    : 'text-white/50 hover:text-white bg-brand-darkGrey/40'
                }`}
                title="Assistente vocale"
              >
                {isVoiceEnabled ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
            </div>
          </div>
        </header>

        {/* Slim Progress Bar */}
        <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden mt-0.5 mb-1.5">
          <div
            className="bg-brand-orange h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(255,107,0,0.5)]"
            style={{ width: `${((currentExerciseIdx + 1) / workout.exercises.length) * 100}%` }}
          />
        </div>
      </div>

      {/* MAIN CONTAINER */}
      <main
        className="flex-1 min-h-0 flex flex-col justify-between relative"
        onTouchStart={handleActiveWorkoutTouchStart}
        onTouchEnd={handleActiveWorkoutTouchEnd}
        onTouchCancel={handleActiveWorkoutTouchCancel}
      >
        {/* ZONE 2: EXERCISE NAV & SEGMENTED SET TRACKER
            Navigation arrows are large, spaced and clearly separated from top-left exit button */}
        <div className="shrink-0 flex flex-col gap-2 my-1">
          <div className="flex items-center justify-between gap-3 px-0.5">
            <button
              onClick={handleArrowPrevExercise}
              disabled={currentExerciseIdx === 0}
              className="w-11 h-11 bg-brand-darkGrey/80 rounded-2xl text-zinc-300 hover:text-white disabled:opacity-20 disabled:hover:text-zinc-500 transition-all active:scale-95 shrink-0 border border-white/10 flex items-center justify-center shadow-md"
              title="Esercizio precedente"
            >
              <ArrowPrev size={20} />
            </button>

            <div className="flex-1 min-w-0 flex flex-col items-center text-center">
              <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-brand-orange">
                Esercizio {currentExerciseIdx + 1} di {workout.exercises.length}
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white leading-tight truncate max-w-[260px] sm:max-w-sm drop-shadow-sm mt-0.5">
                {currentExercise.name}
              </h2>

              <div className="flex items-center gap-1.5 mt-1 flex-wrap justify-center">
                {specialExerciseLabel && (
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${specialExercisePillClass}`}>
                    {specialExerciseLabel}
                  </span>
                )}
                {hasCurrentInstructionNote && (
                  <button
                    onClick={openCurrentInstructionModal}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-darkGrey/80 border border-brand-orange/30 text-brand-orange hover:text-white text-[10px] font-bold transition-colors"
                    title="Istruzioni Esercizio"
                  >
                    <Info size={11} />
                    <span>Info</span>
                  </button>
                )}
                {!isSuperset && currentExercise.auto_count_type && (
                  <button
                    onClick={() => setIsAutoCountModalOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:text-white text-[10px] font-bold transition-colors"
                    title="Auto-count con fotocamera"
                  >
                    <Video size={11} />
                    <span>AI Count</span>
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={handleArrowNextExercise}
              className="w-11 h-11 bg-brand-darkGrey/80 rounded-2xl text-zinc-300 hover:text-white transition-all active:scale-95 shrink-0 border border-white/10 flex items-center justify-center shadow-md"
              title="Prossimo esercizio"
            >
              <ArrowRight size={20} />
            </button>
          </div>

          {/* Segmented Set Tracker */}
          <div className="flex justify-center items-center gap-1.5 px-1">
            {Array.from({ length: isEmom ? effectiveEmomRounds : (currentExercise.sets || 1) }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => isEmom ? setCurrentEmomRoundIdx(i) : setCurrentSetIdx(i)}
                className={`h-2.5 rounded-full transition-all duration-300 cursor-pointer ${
                  (isEmom ? i < currentEmomRoundIdx : i < currentSetIdx)
                    ? 'bg-emerald-500/80 flex-1 max-w-12'
                    : (isEmom ? i === currentEmomRoundIdx : i === currentSetIdx)
                      ? 'bg-brand-orange flex-1 max-w-16 shadow-[0_0_12px_rgba(255,107,0,0.6)] ring-1 ring-brand-orange'
                      : 'bg-white/15 flex-1 max-w-12 hover:bg-white/25'
                }`}
                title={isEmom ? `Round ${i + 1}` : `Set ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* ZONE 3: CENTRAL FOCUS AREA (Rich, Screen-Filling Dashboard Card) */}
        <div className="flex-1 min-h-0 w-full max-w-lg mx-auto flex flex-col justify-between my-1 bg-gradient-to-b from-brand-darkGrey/90 via-brand-darkGrey/60 to-brand-darkGrey/40 border border-white/10 rounded-3xl p-4 sm:p-5 shadow-2xl backdrop-blur-sm">
          {/* Top HUD Chips: Clean 3-Column Grid */}
          <div className="w-full grid grid-cols-3 gap-2.5 shrink-0 mb-2">
            {isEmom ? (
              <>
                <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">
                    {currentExercise.sets && currentExercise.sets > 1 ? 'Set' : 'Round'}
                  </span>
                  <span className="text-brand-orange font-mono font-black text-base sm:text-lg">
                    {currentExercise.sets && currentExercise.sets > 1
                      ? `${currentSetIdx + 1} / ${currentExercise.sets}`
                      : `${currentEmomRoundIdx + 1} / ${effectiveEmomRounds}`}
                  </span>
                </div>

                <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">
                    {currentExercise.sets && currentExercise.sets > 1 ? 'Round' : 'Round Totali'}
                  </span>
                  <span className="text-white font-mono font-black text-sm sm:text-base truncate block">
                    {currentExercise.sets && currentExercise.sets > 1
                      ? `${currentEmomRoundIdx + 1} / ${effectiveEmomRounds}`
                      : `${effectiveEmomRounds} rnd`}
                  </span>
                </div>

                <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">Durata Round</span>
                  <span className="text-zinc-300 font-mono font-black text-sm sm:text-base truncate block">
                    {currentExercise.emom_round_duration || 60}s
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">
                    {isSuperset ? 'Round' : isCircuit ? 'Giro' : 'Set'}
                  </span>
                  <span className="text-brand-orange font-mono font-black text-base sm:text-lg">
                    {`${currentSetIdx + 1} / ${currentExercise.sets || 1}`}
                  </span>
                </div>

                <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">Carico</span>
                  <span className="text-white font-mono font-black text-sm sm:text-base truncate block" title={currentExecutionWeightLabel}>
                    {currentExecutionWeightLabel || '-'}
                  </span>
                </div>

                <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">Recupero</span>
                  <span className="text-zinc-300 font-mono font-black text-sm sm:text-base truncate block" title={nextRecoveryLabel}>
                    {nextRecoveryLabel || '-'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* DYNAMIC MODE VIEW (Fills the center of the card richly) */}
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
            {currentExercise.type === 'emom' ? (
              (() => {
                const hasEmomTasks = Boolean(currentExercise.subExercises && currentExercise.subExercises.length > 0);
                return (
                  <div className="text-center w-full flex flex-col items-center justify-between h-full py-0.5">
                    {/* EMOM Big Circular Hero Timer */}
                    <div className="flex-1 min-h-0 flex flex-col items-center justify-center w-full my-auto">
                      <div
                        className={`relative group ${
                          hasEmomTasks
                            ? 'w-[min(58vw,26vh,230px)] h-[min(58vw,26vh,230px)]'
                            : 'w-[min(82vw,42vh,350px)] h-[min(82vw,42vh,350px)]'
                        } mx-auto rounded-full flex flex-col justify-center items-center transition-all duration-300 shadow-2xl cursor-pointer select-none shrink-0 overflow-hidden ${
                          emomRoundRemaining <= 3 && emomRoundRemaining > 0
                            ? 'border-[10px] sm:border-[12px] border-brand-orange ring-4 ring-brand-orange/60 shadow-[0_0_80px_rgba(255,107,0,0.6)] animate-pulse'
                            : emomActive
                              ? 'border-[10px] sm:border-[12px] border-brand-orange shadow-[0_0_45px_rgba(255,94,0,0.35)]'
                              : 'border-[10px] sm:border-[12px] border-white/10 bg-black/40 shadow-[0_0_30px_rgba(0,0,0,0.5)]'
                        }`}
                        onPointerDown={(event) => handleTimerPointerDown(event, resetEmomCountdown)}
                        onPointerUp={(event) => handleTimerPointerUp(event, handleEmomTimerTap)}
                        onPointerCancel={handleTimerPointerAbort}
                        onPointerLeave={handleTimerPointerAbort}
                      >
                        {/* Apple-style circular progress track */}
                        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                          <circle
                            cx="50"
                            cy="50"
                            r="44"
                            stroke="rgba(255, 255, 255, 0.06)"
                            strokeWidth={hasEmomTasks ? "5" : "6"}
                            fill="transparent"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="44"
                            stroke={emomRoundRemaining <= 3 && emomRoundRemaining > 0 ? '#FF7724' : '#FF5E00'}
                            strokeWidth={hasEmomTasks ? "5" : "6"}
                            strokeDasharray={2 * Math.PI * 44}
                            strokeDashoffset={2 * Math.PI * 44 * (1 - emomRoundProgressRatio)}
                            strokeLinecap="round"
                            fill="transparent"
                            className="transition-[stroke-dashoffset] duration-300 ease-linear"
                          />
                        </svg>

                        {/* Round Indicator Badge inside dial */}
                        <span className={`${hasEmomTasks ? 'text-[10px] sm:text-xs' : 'text-xs sm:text-sm'} font-black uppercase tracking-[0.2em] text-brand-orange/90 mb-1 z-10 drop-shadow-sm`}>
                          ROUND {currentEmomRoundIdx + 1} DI {effectiveEmomRounds}
                        </span>

                        {/* Big Countdown Number */}
                        <span
                          className={`${
                            hasEmomTasks
                              ? 'text-6xl min-[375px]:text-7xl font-mono'
                              : 'text-8xl min-[375px]:text-9xl min-[410px]:text-[10rem] font-mono'
                          } font-black tracking-tighter leading-none z-10 transition-all ${
                            emomRoundRemaining <= 3 && emomRoundRemaining > 0
                              ? 'text-brand-orange scale-105 drop-shadow-[0_0_25px_rgba(255,107,0,0.8)]'
                              : emomActive
                                ? 'text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.25)]'
                                : 'text-zinc-400'
                          }`}
                        >
                          {emomRoundRemaining >= 100 ? formatTime(emomRoundRemaining) : emomRoundRemaining}
                        </span>

                        {/* Label */}
                        <span className={`text-zinc-400 font-black uppercase tracking-widest ${hasEmomTasks ? 'text-[9px] sm:text-[10px]' : 'text-[11px] sm:text-xs'} mt-1.5 z-10 flex items-center gap-1.5`}>
                          <Timer size={hasEmomTasks ? 12 : 14} className="text-brand-orange" />
                          {emomActive ? 'SECONDI RIMASTI' : 'IN PAUSA'}
                        </span>

                        {/* Tap overlay icon */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity pointer-events-none z-20">
                          {emomActive ? <Pause size={hasEmomTasks ? 40 : 54} className="text-white" /> : <Play size={hasEmomTasks ? 40 : 54} className="text-white ml-1.5" />}
                        </div>
                      </div>

                      {/* Interactive Round Timeline when no sub-exercises */}
                      {!hasEmomTasks && effectiveEmomRounds > 1 && (
                        <div className="w-full mt-3 px-1">
                          <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5 px-0.5">
                            <span>Progressione Round</span>
                            <span className="text-brand-orange font-mono font-black">
                              {Math.round(((currentEmomRoundIdx + 1) / effectiveEmomRounds) * 100)}%
                            </span>
                          </div>
                          <div className="flex gap-1.5 overflow-x-auto py-1">
                            {Array.from({ length: effectiveEmomRounds }).map((_, rIdx) => {
                              const isCurrent = rIdx === currentEmomRoundIdx;
                              const isDone = rIdx < currentEmomRoundIdx;
                              return (
                                <button
                                  key={rIdx}
                                  type="button"
                                  onClick={() => setCurrentEmomRoundIdx(rIdx)}
                                  className={`flex-1 min-w-[38px] py-1.5 px-1 rounded-xl text-center border transition-all cursor-pointer ${
                                    isCurrent
                                      ? 'bg-brand-orange/25 border-brand-orange text-white shadow-sm ring-1 ring-brand-orange/60'
                                      : isDone
                                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                        : 'bg-white/5 border-white/10 text-zinc-500 hover:border-white/20'
                                  }`}
                                  title={`Vai al round ${rIdx + 1}`}
                                >
                                  <span className="text-[8px] uppercase font-bold block opacity-70">R{rIdx + 1}</span>
                                  <span className="text-xs font-mono font-black">
                                    {isDone ? '✓' : isCurrent ? `${emomRoundRemaining}s` : `${currentExercise.emom_round_duration || 60}s`}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Helper Text */}
                      <p className="text-[11px] sm:text-xs text-zinc-400 font-bold uppercase tracking-wider text-center mt-2">
                        Tocca per {emomActive ? 'mettere in pausa' : 'avviare'} • Tieni premuto per azzerare
                      </p>
                    </div>

                    {/* EMOM Tasks List */}
                    {hasEmomTasks && currentExercise.subExercises && (
                      <div className="w-full flex-1 min-h-0 overflow-y-auto space-y-2 mt-2 px-0.5">
                        {currentExercise.subExercises.map((sub, idx) => (
                          <div
                            key={idx}
                            className="bg-black/50 p-3 sm:p-3.5 rounded-2xl border border-white/10 flex justify-between items-center text-xs sm:text-sm shadow-sm"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-6 h-6 rounded-full bg-brand-orange/20 text-brand-orange flex items-center justify-center font-bold text-xs shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-white font-bold truncate text-sm sm:text-base">
                                {sub.name}
                              </span>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-2 ml-2">
                              <span className="text-brand-orange font-mono font-black text-sm sm:text-base bg-brand-orange/15 border border-brand-orange/30 px-2.5 py-1 rounded-xl">
                                {formatEmomTaskMetricLabel(sub)}
                              </span>
                              {sub.weight_kg != null && sub.weight_kg > 0 && (
                                <span className="text-xs text-zinc-300 font-semibold font-mono bg-white/5 border border-white/10 px-2 py-1 rounded-xl">
                                  {formatWeightLabel(sub.weight_kg)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : currentExercise.type === 'pyramid' ? (
              <div className="text-center w-full flex flex-col items-center justify-between h-full my-auto py-1">
                {/* Hero Target Reps Display */}
                <div className="flex flex-col items-center justify-center my-auto">
                  <span className="block text-7xl min-[390px]:text-8xl sm:text-9xl font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_35px_rgba(255,107,0,0.35)] tracking-tight">
                    {formatBigTargetValue(currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.reps || 0)}
                  </span>
                  <span className="text-zinc-400 font-black uppercase tracking-[0.25em] text-xs sm:text-sm mt-2">
                    RIPETIZIONI TARGET
                  </span>
                </div>

                {/* Pyramid Steps Interactive Carousel with Rich Cards & Centered Active Step */}
                <div className="w-full mt-auto pt-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-bold mb-2 px-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-brand-orange font-mono font-black">
                        Step {currentPyramidStepIdx + 1}
                      </span>
                      <span className="text-zinc-500">di</span>
                      <span className="font-mono font-bold text-zinc-300">
                        {currentExercise.pyramid_steps?.length || 1}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-semibold tracking-normal lowercase opacity-80">
                      scorri per altri step ↔
                    </span>
                  </div>

                  {/* Scrollable Container centered on active step */}
                  <div
                    ref={pyramidScrollContainerRef}
                    className="w-full flex gap-3 overflow-x-auto no-scrollbar py-2 px-[calc(50%-70px)] scroll-smooth snap-x snap-mandatory"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    {currentExercise.pyramid_steps?.map((step, sIdx) => {
                      const isCurrent = sIdx === currentPyramidStepIdx;
                      const isDone = sIdx < currentPyramidStepIdx;

                      return (
                        <button
                          key={sIdx}
                          ref={isCurrent ? activePyramidStepRef : null}
                          type="button"
                          onClick={() => {
                            void hapticLight();
                            setCurrentPyramidStepIdx(sIdx);
                          }}
                          className={`shrink-0 w-[140px] p-3 rounded-2xl border text-left transition-all snap-center cursor-pointer select-none flex flex-col justify-between ${
                            isCurrent
                              ? 'bg-[#521d00]/95 border-2 border-brand-orange text-white shadow-[0_0_25px_rgba(255,94,0,0.4)] ring-1 ring-brand-orange/60 scale-[1.03] z-10'
                              : isDone
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:border-emerald-500/60 shadow-sm'
                                : 'bg-white/5 border-white/10 text-zinc-400 opacity-60 hover:opacity-90 hover:border-white/20'
                          }`}
                          title={`Vai allo Step ${sIdx + 1}`}
                        >
                          {/* Step Header */}
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className={`text-[10px] uppercase font-black tracking-wider ${
                              isCurrent ? 'text-brand-lightOrange font-mono' : isDone ? 'text-emerald-400' : 'text-zinc-400'
                            }`}>
                              Step {sIdx + 1}
                            </span>
                            {isDone && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                            {isCurrent && (
                              <span className="flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-ping" />
                                <span className="w-2 h-2 rounded-full bg-brand-orange shrink-0" />
                              </span>
                            )}
                          </div>

                          {/* Big Reps Count */}
                          <div className="flex items-baseline gap-1.5 my-1">
                            <span className={`text-2xl sm:text-3xl font-black font-mono leading-none tracking-tight ${
                              isCurrent ? 'text-white' : isDone ? 'text-emerald-200' : 'text-zinc-300'
                            }`}>
                              {isMaxTarget(step.reps) ? 'MAX' : step.reps}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                              reps
                            </span>
                          </div>

                          {/* Details: Carico & Recupero */}
                          <div className="mt-2 pt-2 border-t border-white/10 space-y-1 text-[10px] font-semibold">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[9px] uppercase tracking-wider opacity-60">Carico</span>
                              <span className={`font-mono font-bold truncate max-w-[70px] ${
                                isCurrent ? 'text-white' : isDone ? 'text-emerald-300' : 'text-zinc-300'
                              }`}>
                                {step.weight_kg != null && step.weight_kg > 0 ? formatWeightLabel(step.weight_kg) : 'Libero'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[9px] uppercase tracking-wider opacity-60">Recupero</span>
                              <span className={`font-mono font-bold ${
                                isCurrent ? 'text-brand-orange' : isDone ? 'text-emerald-400' : 'text-zinc-400'
                              }`}>
                                {step.rest_seconds > 0 ? `${step.rest_seconds}s` : '0s'}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : isCircuit ? (
              <div className="text-center w-full flex flex-col items-center justify-between h-full">
                {/* Interactive Circuit Stopwatch */}
                <div
                  className={`w-full p-3.5 rounded-2xl border-2 flex flex-col items-center justify-center transition-all duration-300 shadow-md cursor-pointer select-none group shrink-0 ${
                    isCircuitStopwatchRunning
                      ? 'border-brand-orange bg-brand-orange/15 shadow-[0_0_25px_rgba(179,72,0,0.25)]'
                      : circuitStopwatchElapsed > 0
                        ? 'border-brand-orange/70 bg-black/40'
                        : 'border-white/10 bg-black/30 hover:border-brand-orange/40'
                  }`}
                  onPointerDown={(event) => handleTimerPointerDown(event, resetCircuitStopwatch)}
                  onPointerUp={(event) => handleTimerPointerUp(event, toggleCircuitStopwatch)}
                  onPointerCancel={handleTimerPointerAbort}
                  onPointerLeave={handleTimerPointerAbort}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      isCircuitStopwatchRunning
                        ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/40 animate-pulse'
                        : circuitStopwatchElapsed > 0
                          ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/40'
                          : 'bg-white/10 text-zinc-400 border border-white/10'
                    }`}>
                      <Timer size={10} />
                      {isCircuitStopwatchRunning ? 'IN CORSO' : circuitStopwatchElapsed > 0 ? 'IN PAUSA' : 'PRONTO'}
                    </span>
                  </div>

                  <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-white leading-none my-1 drop-shadow-sm">
                    {formatTime(circuitStopwatchElapsed)}
                  </div>

                  <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-semibold mt-1">
                    Tocca per {isCircuitStopwatchRunning ? 'fermare' : 'avviare'} • Tieni premuto per azzerare
                  </p>
                </div>

                {/* Stations list */}
                <div className="w-full flex-1 min-h-0 overflow-y-auto space-y-1.5 px-0.5 my-2">
                  {(currentExercise.subExercises || []).map((sub, idx) => (
                    <div
                      key={`${currentExercise.id}:circuit-station:${idx}`}
                      className="p-2.5 px-3 rounded-xl border border-white/10 bg-black/40 flex justify-between items-center text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-brand-orange/20 text-brand-orange flex items-center justify-center font-bold text-[10px] shrink-0">
                          {idx + 1}
                        </span>
                        <span className="truncate font-bold text-white/90 text-sm">{sub.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {sub.weight_kg != null && sub.weight_kg > 0 && (
                          <span className="text-[11px] text-zinc-400 font-semibold">{formatWeightLabel(sub.weight_kg)}</span>
                        )}
                        <span className="font-mono text-sm text-brand-orange font-black">
                          {sub.type === 'reps' ? `${sub.reps}r` : `${sub.duration_seconds}s`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : isSuperset ? (
              <div className="text-center w-full flex flex-col items-center justify-between h-full">
                {/* Superset Sub-Exercises List */}
                <div className="w-full flex-1 min-h-0 overflow-y-auto space-y-2 px-0.5 my-auto">
                  {(currentExercise.subExercises || []).map((sub, idx) => {
                    const isIsoSub = sub.type === 'isometry';
                    const isClickableIsoTimer = isIsoSub && sub.duration_seconds > 0;
                    const isThisTimerActive = isClickableIsoTimer && isometryActive && supersetIsometrySubIdx === idx;
                    const targetDuration = isClickableIsoTimer ? Math.max(1, sub.duration_seconds || 1) : 1;
                    const currentRemaining = isThisTimerActive || (isClickableIsoTimer && supersetIsometrySubIdx === idx) ? isometryRemaining : targetDuration;
                    const fillPercent = isClickableIsoTimer && supersetIsometrySubIdx === idx ? Math.max(0, Math.min(100, ((targetDuration - currentRemaining) / targetDuration) * 100)) : 0;

                    const handleSubIsoTap = () => {
                      if (!isClickableIsoTimer) return;
                      if (isThisTimerActive) {
                        pauseIsometryCountdown();
                        return;
                      }
                      if (isometryActive) stopIsometryCountdown();
                      setSupersetIsometrySubIdx(idx);
                      const duration = (supersetIsometrySubIdx === idx && isometryRemaining > 0) ? isometryRemaining : targetDuration;
                      startIsometryCountdown(duration);
                    };

                    const handleSubIsoReset = () => {
                      if (!isClickableIsoTimer) return;
                      stopIsometryCountdown();
                      setSupersetIsometrySubIdx(idx);
                      setIsometryRemaining(targetDuration);
                    };

                    return (
                      <div
                        key={`${currentExercise.id}:superset:${idx}`}
                        className={`relative overflow-hidden p-3.5 rounded-2xl border flex justify-between items-start gap-3 select-none transition-colors ${
                          isThisTimerActive
                            ? 'border-brand-orange/70 bg-brand-orange/15 shadow-[0_0_15px_rgba(255,107,0,0.2)]'
                            : isClickableIsoTimer && supersetIsometrySubIdx === idx && fillPercent > 0
                              ? 'border-brand-orange/40 bg-black/40'
                              : 'border-white/10 bg-black/30'
                        } ${isClickableIsoTimer ? 'cursor-pointer active:scale-[0.98]' : ''}`}
                        {...(isClickableIsoTimer ? {
                          onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => handleTimerPointerDown(event, handleSubIsoReset),
                          onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => handleTimerPointerUp(event, handleSubIsoTap),
                          onPointerCancel: handleTimerPointerAbort,
                          onPointerLeave: handleTimerPointerAbort,
                        } : {})}
                      >
                        {isClickableIsoTimer && fillPercent > 0 && (
                          <div
                            className="absolute inset-0 bg-brand-orange/20 transition-[width] duration-300 ease-linear pointer-events-none rounded-2xl"
                            style={{ width: `${fillPercent}%` }}
                          />
                        )}
                        <div className="text-left min-w-0 relative z-10 flex flex-col justify-center">
                          <p className="text-white font-black text-sm sm:text-base truncate">{idx + 1}. {sub.name || `Exercise ${idx + 1}`}</p>
                          <p className="text-xs text-brand-orange font-black uppercase tracking-wide mt-1">
                            {isClickableIsoTimer && supersetIsometrySubIdx === idx
                              ? `${currentRemaining}s / ${targetDuration}s`
                              : formatSupersetTaskMetricLabel(sub)
                            }
                          </p>
                          {isClickableIsoTimer && (
                            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-1 opacity-90">
                              Tocca per avviare/pausa • Tieni premuto per azzerare
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0 relative z-10">
                          <span className="text-[10px] uppercase tracking-widest text-zinc-400 block font-semibold">Peso</span>
                          <span className="text-xs sm:text-sm text-brand-lightOrange font-mono font-bold block">{formatWeightLabel(sub.weight_kg)}</span>
                        </div>
                      </div>
                    );
                  })}

                  {(!currentExercise.subExercises || currentExercise.subExercises.length === 0) && (
                    <p className="text-xs text-zinc-400">Nessun esercizio configurato per questo superset.</p>
                  )}
                </div>
              </div>
            ) : (currentExercise.type === 'isometry' || currentExercise.type === 'cardio') ? (
              <div className="text-center w-full max-w-sm relative group select-none my-auto flex flex-col items-center">
                <div
                  className={`relative w-[min(72vw,35vh,290px)] h-[min(72vw,35vh,290px)] mx-auto rounded-full border-[10px] sm:border-[12px] flex flex-col justify-center items-center transition-colors duration-300 shadow-xl cursor-pointer ${
                    isometryStopwatchActive || isometryActive
                      ? 'border-brand-orange shadow-[0_0_40px_rgba(255,107,0,0.35)]'
                      : 'border-brand-darkGrey bg-black/40'
                  }`}
                  onPointerDown={(event) => handleTimerPointerDown(event, resetIsometryCountdown)}
                  onPointerUp={(event) => handleTimerPointerUp(event, handleIsometryTimerTap)}
                  onPointerCancel={handleTimerPointerAbort}
                  onPointerLeave={handleTimerPointerAbort}
                >
                  <span className={`text-7xl min-[375px]:text-8xl sm:text-9xl font-mono tracking-tighter ${
                    isometryStopwatchActive || isometryActive ? 'text-brand-orange animate-pulse' : 'text-white'
                  } transition-colors leading-none`}>
                    {isMaxTarget(currentExercise.duration_seconds)
                      ? (isometryElapsedSeconds > 0 ? isometryElapsedSeconds : (getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 'MAX'))
                      : isometryRemaining}
                  </span>
                  <span className="text-zinc-400 font-bold uppercase tracking-widest text-xs mt-2">
                    {isMaxTarget(currentExercise.duration_seconds) && isometryElapsedSeconds === 0 && !getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)
                      ? 'A SFINIMENTO'
                      : 'SECONDI'}
                  </span>

                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity pointer-events-none">
                    {isometryStopwatchActive || isometryActive ? <Pause size={48} className="text-white" /> : <Play size={48} className="text-white ml-1.5" />}
                  </div>
                </div>

                <p className="text-[11px] sm:text-xs text-zinc-400 font-bold uppercase tracking-wider text-center mt-3">
                  {isMaxTarget(currentExercise.duration_seconds)
                    ? 'Tocca per avviare il cronometro • Tieni premuto per azzerare'
                    : `Tocca per ${isometryActive ? 'mettere in pausa' : 'avviare'} • Tieni premuto per azzerare`}
                </p>

                {/* Steppers & Set pills for MAX Isometry */}
                {isMaxTarget(currentExercise.duration_seconds) && (
                  <div className="mt-3 w-full max-w-sm">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(-5)}
                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white font-bold text-xs border border-white/5 cursor-pointer"
                      >
                        -5s
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(-1)}
                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white font-bold text-xs border border-white/5 cursor-pointer"
                      >
                        -1s
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditSpecificSetModal(currentSetIdx)}
                        className="px-3.5 py-1.5 rounded-xl bg-brand-orange/15 hover:bg-brand-orange/25 active:scale-95 text-brand-orange font-bold text-xs border border-brand-orange/30 flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil size={11} />
                        <span>Modifica</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(1)}
                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white font-bold text-xs border border-white/5 cursor-pointer"
                      >
                        +1s
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(5)}
                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-zinc-300 hover:text-white font-bold text-xs border border-white/5 cursor-pointer"
                      >
                        +5s
                      </button>
                    </div>

                    <div className="mt-2.5 grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                      {Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                        const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                        const isCurrent = sIdx === currentSetIdx;
                        const isDone = logged != null && logged > 0;
                        return (
                          <button
                            key={sIdx}
                            type="button"
                            onClick={() => openEditSpecificSetModal(sIdx)}
                            className={`py-2 px-1 rounded-xl border text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                              isCurrent
                                ? 'bg-brand-orange/20 border-brand-orange text-white ring-1 ring-brand-orange/50 shadow-sm'
                                : isDone
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                  : 'bg-white/5 border-white/5 text-zinc-500'
                            }`}
                          >
                            <span className="text-[8px] uppercase font-bold opacity-70">Set {sIdx + 1}</span>
                            <span className="text-xs font-black font-mono mt-0.5">
                              {logged != null && logged > 0 ? `${logged}s` : isCurrent ? `${getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || '-'}` : '-'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* DEFAULT: STANDARD REPS - Fills the central dashboard generously */
              <div className="text-center w-full flex flex-col items-center justify-between h-full py-1">
                {isMaxTarget(currentExercise.reps) ? (
                  <div className="flex flex-col items-center w-full my-auto">
                    <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-orange text-xs font-black uppercase tracking-wider mb-3">
                      <Flame size={14} className="animate-pulse" />
                      <span>A Sfinimento (MAX Reps)</span>
                    </div>

                    {/* Stepper + Value */}
                    <div className="flex items-center justify-center gap-2.5 w-full max-w-sm mb-3">
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(-5)}
                        className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 hover:text-white font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                        title="-5 reps"
                      >
                        -5
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(-1)}
                        className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-xl flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                        title="-1 rep"
                      >
                        -
                      </button>

                      <div
                        onClick={() => openEditSpecificSetModal(currentSetIdx)}
                        className="flex-1 bg-black/50 border-2 border-brand-orange/60 hover:border-brand-orange rounded-3xl py-3 px-3 flex flex-col items-center justify-center cursor-pointer shadow-[0_0_25px_rgba(255,107,0,0.25)] transition-all group select-none"
                        title="Tocca per inserire le reps fatte"
                      >
                        <span className="text-6xl font-mono font-black text-brand-orange leading-tight group-hover:scale-105 transition-transform">
                          {(getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 0) > 0
                            ? getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)
                            : 'MAX'}
                        </span>
                        <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1 mt-1">
                          <Pencil size={11} className="text-brand-orange" />
                          Reps Eseguite
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(1)}
                        className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white font-black text-xl flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                        title="+1 rep"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustCurrentSetPerformance(5)}
                        className="w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-zinc-300 hover:text-white font-bold text-xs flex items-center justify-center transition-all border border-white/5 cursor-pointer"
                        title="+5 reps"
                      >
                        +5
                      </button>
                    </div>

                    <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider text-center mb-3">
                      Tocca il valore per inserire le ripetizioni
                    </p>

                    {/* Summary Set Pills for MAX Reps */}
                    <div className="w-full max-w-sm grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                      {Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                        const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                        const isCurrent = sIdx === currentSetIdx;
                        const isDone = logged != null && logged > 0;
                        return (
                          <button
                            key={sIdx}
                            type="button"
                            onClick={() => openEditSpecificSetModal(sIdx)}
                            className={`py-2 px-1 rounded-xl border text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                              isCurrent
                                ? 'bg-brand-orange/20 border-brand-orange text-white ring-1 ring-brand-orange/50 shadow-sm'
                                : isDone
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                  : 'bg-white/5 border-white/5 text-zinc-500'
                            }`}
                          >
                            <span className="text-[8px] uppercase font-bold opacity-70">Set {sIdx + 1}</span>
                            <span className="text-xs font-black font-mono mt-0.5">
                              {logged != null && logged > 0 ? `${logged}` : isCurrent ? `${getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || '-'}` : '-'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-between w-full h-full my-auto">
                    {/* Hero Target Reps */}
                    <div className="flex flex-col items-center justify-center my-auto py-2">
                      <span className="block text-8xl min-[390px]:text-9xl sm:text-[10rem] font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_45px_rgba(255,107,0,0.35)] tracking-tighter">
                        {formatBigTargetValue(currentExercise.reps)}
                      </span>
                      <span className="text-zinc-400 font-black uppercase tracking-[0.25em] text-xs sm:text-sm mt-3">
                        RIPETIZIONI TARGET
                      </span>
                    </div>

                    {/* Interactive Set History & Timeline */}
                    <div className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 mt-auto">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 uppercase tracking-wider font-bold mb-2 px-1">
                        <span>Set {currentSetIdx + 1} di {currentExercise.sets || 1}</span>
                        <span className="text-brand-orange font-mono font-black">
                          {currentExecutionWeightLabel ? `Carico: ${currentExecutionWeightLabel}` : 'Corpo Libero'}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                        {Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                          const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                          const isCurrent = sIdx === currentSetIdx;
                          const isDone = sIdx < currentSetIdx;
                          return (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => openEditSpecificSetModal(sIdx)}
                              className={`py-2 px-1.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
                                isCurrent
                                  ? 'bg-brand-orange/20 border-brand-orange text-white ring-1 ring-brand-orange/50 shadow-sm'
                                  : isDone
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                              }`}
                              title={`Modifica set ${sIdx + 1}`}
                            >
                              <span className="text-[8px] uppercase font-bold opacity-70">Set {sIdx + 1}</span>
                              <span className="text-xs font-black font-mono mt-0.5">
                                {logged != null && logged > 0
                                  ? `${logged}r`
                                  : isDone
                                    ? `${currentExercise.reps}r`
                                    : isCurrent
                                      ? `${currentExercise.reps}r`
                                      : `${currentExercise.reps}r`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Card Context: Upcoming recovery & Instruction trigger if available */}
          <div className="shrink-0 pt-2 border-t border-white/5 flex flex-col gap-1.5">
            {nextRecoveryLabel && (
              <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-bold text-center">
                Prossimo Recupero: <span className="text-brand-orange font-mono font-black">{nextRecoveryLabel}</span>
              </p>
            )}
            {hasCurrentInstructionNote && (
              <button
                type="button"
                onClick={openCurrentInstructionModal}
                className="w-full py-1.5 px-3 rounded-xl bg-brand-orange/10 hover:bg-brand-orange/20 border border-brand-orange/30 text-brand-orange text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Info size={13} />
                <span>Leggi Istruzioni Esercizio</span>
              </button>
            )}
            {!isSuperset && currentExercise.auto_count_type && (
              <button
                type="button"
                onClick={() => setIsAutoCountModalOpen(true)}
                className="w-full py-2 px-3 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 text-purple-300 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <Video size={14} />
                <span>Usa Auto-Count con Fotocamera</span>
              </button>
            )}
          </div>
        </div>

        {/* ZONE 4: BOTTOM ACTION DOCK */}
        <div className="shrink-0 h-[60px] sm:h-[68px] flex items-stretch gap-2.5 sm:gap-3 mt-1">
          <button
            type="button"
            onClick={openCurrentExerciseNoteModal}
            className={`w-[60px] sm:w-[68px] rounded-2xl border transition-all active:scale-95 flex items-center justify-center relative shadow-sm cursor-pointer ${
              hasCurrentWorkoutNote
                ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                : 'bg-brand-darkGrey/60 border-white/10 text-zinc-400 hover:text-white hover:border-white/25'
            }`}
            title="Note esercizio"
          >
            <FileText size={22} />
            {hasCurrentWorkoutNote && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-brand-orange ring-2 ring-black" />
            )}
          </button>

          <button
            onClick={handlePrimaryAction}
            className={`flex-1 rounded-2xl font-black text-base sm:text-xl flex items-center justify-center transition-all active:scale-95 shadow-xl ${
              isFinalCompletionAction
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black shadow-emerald-500/20'
                : 'bg-brand-orange hover:bg-brand-lightOrange text-black shadow-brand-orange/20'
            }`}
          >
            {isFinalCompletionAction ? (
              <>
                <CheckCircle2 size={24} className="mr-2" strokeWidth={2.5} />
                TERMINA ALLENAMENTO
              </>
            ) : isEmom && !isLastEmomRound ? (
              <>PROSSIMO ROUND <ArrowRight size={20} className="ml-2" /></>
            ) : isEmom && isLastEmomRound ? (
              <>COMPLETA SERIE</>
            ) : isPyramid && !isLastPyramidStep ? (
              <>PROSSIMO STEP <ArrowRight size={20} className="ml-2" /></>
            ) : isCircuit ? (
              isLastSet
                ? <>COMPLETA CIRCUITO <ArrowRight size={20} className="ml-2" /></>
                : <>FINE SET & RECUPERO <ArrowRight size={20} className="ml-2" /></>
            ) : isSuperset ? (
              isLastSet
                ? <>PROSSIMO ESERCIZIO <ArrowRight size={20} className="ml-2" /></>
                : currentExercise.rest_seconds > 0
                  ? <>FINE ROUND & RECUPERO <ArrowRight size={20} className="ml-2" /></>
                  : <>PROSSIMO ROUND <ArrowRight size={20} className="ml-2" /></>
            ) : isLastSet ? (
              <>PROSSIMO ESERCIZIO <ArrowRight size={20} className="ml-2" /></>
            ) : (
              <>COMPLETA SERIE</>
            )}
          </button>
        </div>
      </main>

      {renderActiveWorkoutModals()}
    </div>
  );
};

export default ActiveWorkoutPage;

