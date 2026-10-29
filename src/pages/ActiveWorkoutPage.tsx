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
import { Play, Pause, SkipForward, ArrowRight, ArrowLeft as ArrowPrev, Timer, Clock, CheckCircle2, Check, Mic, MicOff, FileText, X, Info, Video, Layers, Flame, Pencil, Zap, Dumbbell, List } from 'lucide-react';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import { warmupSpeechSynthesis, speak } from '../utils/voice';
import { WorkoutOverviewModal } from '../components/active-workout/WorkoutOverviewModal';
import { ActiveWorkoutModals } from '../components/active-workout/ActiveWorkoutModals';
import {
  playGoalReachedSound,
  playCountdownBeep,
  playRestFinishedSound,
  unlockAudio,
  isAudioFeedbackEnabled,
  isVoiceGuidanceEnabled,
} from '../utils/audio';
import { hapticLight, hapticSuccess } from '../utils/haptics';
import { pipManager } from '../utils/pipManager';
import { requestScreenWakeLock, releaseScreenWakeLock } from '../utils/wakeLock';
import {
  initServiceWorker,
  scheduleBackgroundRestNotification,
  closeActiveRestNotifications,
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
import {
  generateWorkoutUuid,
  saveActiveWorkoutDraft,
  clearActiveWorkoutDraft,
  enqueueCompletedWorkout,
  processSyncQueue,
  getSyncQueue,
} from '../lib/workoutSyncManager';
import {
  getOfflineSchedaById,
  updateSingleSchedaInOfflineCache,
  SCHEDA_FULL_SELECT_QUERY,
} from '../lib/offlineSchedeManager';
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
  restEndsAtMs?: number | null;
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
  workout_uuid?: string;
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

const formatEmomTimer = (seconds: number) => {
  const normalized = Math.max(0, Math.trunc(Number(seconds) || 0));
  if (normalized >= 60) {
    const m = Math.floor(normalized / 60);
    const s = normalized % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  return normalized.toString().padStart(2, '0');
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

  // Gestione orientamento: l'app ruota automaticamente in orizzontale (StandBy Gym Mode) esclusivamente quando il dispositivo fisico viene girato
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
  const isRestingRef = useRef(false);
  isRestingRef.current = isResting;
  const restEndsAtMsRef = useRef<number | null>(null);
  restEndsAtMsRef.current = restEndsAtMs;

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
  const activePyramidStepRef = useRef<HTMLDivElement | null>(null);
  const setsCarouselScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeSetCardRef = useRef<HTMLDivElement | null>(null);
  const [isEmomRoundWorkFinished, setIsEmomRoundWorkFinished] = useState(false);
  const emomScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeEmomRoundCardRef = useRef<HTMLDivElement | null>(null);

  const wasRestingRef = useRef(false);
  const wasEmomActiveRef = useRef(false);
  const wasIsometryActiveRef = useRef(false);
  const lastCountdownRestRef = useRef<number | null>(null);
  const lastCountdownEmomRef = useRef<number | null>(null);
  const lastCountdownIsometryRef = useRef<number | null>(null);
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
  const workoutUuidRef = useRef<string>(generateWorkoutUuid());
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
  const [isCelebrationOpen, setIsCelebrationOpen] = useState(false);
  const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
  const [instructionModalContext, setInstructionModalContext] = useState<InstructionModalContext | null>(null);
  const [isWorkoutOverviewModalOpen, setIsWorkoutOverviewModalOpen] = useState(false);
  const [isWorkoutOverviewAdvancePending, setIsWorkoutOverviewAdvancePending] = useState(false);
  const [isAutoCountModalOpen, setIsAutoCountModalOpen] = useState(false);
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
    if (!isVoiceGuidanceEnabled() || !voiceAssistanceEnabled) return;
    speak(text);
  };

  const computeRemainingFromEndsAt = (endsAtMs: number | null) => {
    if (endsAtMs == null) return 0;
    return Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
  };

  const formatExerciseTypeVoiceLabel = (type: string): string => {
    switch (type) {
      case 'isometry': return 'Isometria';
      case 'pyramid': return 'Piramidale';
      case 'emom': return 'EMOM';
      case 'superset': return 'Superset';
      case 'circuit': return 'Circuito';
      case 'cardio': return 'Cardio';
      default: return 'Ripetizioni';
    }
  };

  const formatWeightVoice = (weight?: number | null): string => {
    if (weight == null || weight <= 0) return '';
    const rounded = Math.round(weight * 100) / 100;
    const str = String(rounded).replace('.', ' virgola ');
    return `${str} ${rounded === 1 ? 'chilo' : 'chili'}`;
  };

  const formatDurationVoice = (totalSeconds: number): string => {
    if (totalSeconds <= 0) return 'zero secondi';
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m > 0 && s > 0) {
      return `${m} ${m === 1 ? 'minuto' : 'minuti'} e ${s} ${s === 1 ? 'secondo' : 'secondi'}`;
    }
    if (m > 0) {
      return `${m} ${m === 1 ? 'minuto' : 'minuti'}`;
    }
    return `${s} ${s === 1 ? 'secondo' : 'secondi'}`;
  };

  const buildRestVoiceAnnouncement = (
    durationSeconds: number,
    upcoming: { nextExerciseName: string; nextSetInfo?: string; nextWeightKg?: number | null }
  ): string => {
    const durationText = formatDurationVoice(durationSeconds);
    const nextName = String(upcoming.nextExerciseName || '').trim();

    if (nextName === 'Fine Allenamento') {
      return `Recupero ${durationText}. Fine allenamento in arrivo.`;
    }

    const weightText =
      upcoming.nextWeightKg != null && upcoming.nextWeightKg > 0
        ? `, ${formatWeightVoice(upcoming.nextWeightKg)}`
        : '';

    return `Recupero ${durationText}. Prossimo: ${nextName}${weightText}.`;
  };

  const buildSetAnnouncementCue = (
    exercise: Exercise,
    nextSetIdx: number,
    pyramidStepIdx?: number
  ): string => {
    const name = String(exercise.name || '').trim();
    const typeLabel = formatExerciseTypeVoiceLabel(exercise.type);
    const parts: string[] = [];

    if (name) parts.push(name);
    parts.push(typeLabel);

    if (exercise.type === 'pyramid' && exercise.pyramid_steps) {
      const stepIdx = pyramidStepIdx != null ? pyramidStepIdx : 0;
      const step = exercise.pyramid_steps[stepIdx];
      const totalSteps = exercise.pyramid_steps.length;
      if (step) {
        if (step.weight_kg != null && step.weight_kg > 0) {
          parts.push(formatWeightVoice(step.weight_kg));
        }
        parts.push(step.reps > 0 ? `${step.reps} ripetizioni` : 'ripetizioni a sfinimento');
      }
      parts.push(`Step ${stepIdx + 1} di ${totalSteps}`);
    } else if ((exercise.type === 'superset' || exercise.type === 'emom') && exercise.subExercises && exercise.subExercises.length > 0) {
      const totalRounds = exercise.type === 'emom' ? getEffectiveEmomRounds(exercise) : (exercise.sets || 1);
      parts.push(`Round ${nextSetIdx + 1} di ${totalRounds}`);

      const subParts = exercise.subExercises.map((sub) => {
        const subName = String(sub.name || '').trim();
        const subInfo: string[] = [];
        if (subName) subInfo.push(subName);
        if (sub.weight_kg != null && sub.weight_kg > 0) subInfo.push(formatWeightVoice(sub.weight_kg));
        if (sub.type === 'isometry') {
          subInfo.push(sub.duration_seconds > 0 ? `${sub.duration_seconds} secondi` : 'tenuta a sfinimento');
        } else {
          subInfo.push(sub.reps > 0 ? `${sub.reps} ripetizioni` : 'ripetizioni a sfinimento');
        }
        return subInfo.join(', ');
      });
      parts.push(subParts.join('. '));
    } else if (exercise.type === 'circuit') {
      if (exercise.weight_kg != null && exercise.weight_kg > 0) {
        parts.push(formatWeightVoice(exercise.weight_kg));
      }
      parts.push(`Giro ${nextSetIdx + 1} di ${exercise.sets || 1}`);
    } else {
      // Standard reps o isometria
      if (exercise.weight_kg != null && exercise.weight_kg > 0) {
        parts.push(formatWeightVoice(exercise.weight_kg));
      }
      if (exercise.type === 'isometry' || exercise.type === 'cardio') {
        parts.push(exercise.duration_seconds > 0 ? `${exercise.duration_seconds} secondi` : 'tenuta a sfinimento');
      } else {
        parts.push(exercise.reps > 0 ? `${exercise.reps} ripetizioni` : 'ripetizioni a sfinimento');
      }
      parts.push(`Set ${nextSetIdx + 1} di ${exercise.sets || 1}`);
    }

    return parts.join('. ');
  };

  const getUpcomingRestTargetInfo = useCallback(
    (overridePendingAdvance?: boolean) => {
      if (!workout) return { nextExerciseName: 'Prossimo Esercizio', nextSetInfo: '', nextWeightKg: null };

      const currentEx = workout.exercises[currentExerciseIdx];
      if (!currentEx) return { nextExerciseName: 'Prossimo Esercizio', nextSetInfo: '', nextWeightKg: null };

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
        if (!nextEx) return { nextExerciseName: 'Fine Allenamento', nextSetInfo: '', nextWeightKg: null };

        const name = String(nextEx.name || '').trim() || `Esercizio ${currentExerciseIdx + 2}`;
        const totalSets = nextEx.sets || 1;

        let setInfo = `Set 1 di ${totalSets}`;
        let weightKg: number | null = null;

        if (nextEx.type === 'circuit') {
          setInfo = `Giro 1 di ${totalSets}`;
          weightKg = nextEx.weight_kg ?? nextEx.subExercises?.[0]?.weight_kg ?? null;
        } else if (nextEx.type === 'superset') {
          setInfo = `Round 1 di ${totalSets}`;
          weightKg = nextEx.subExercises?.[0]?.weight_kg ?? null;
        } else if (nextEx.type === 'emom') {
          const totalRounds = getEffectiveEmomRounds(nextEx);
          setInfo = `Round 1 di ${totalRounds}`;
          weightKg = nextEx.subExercises?.[0]?.weight_kg ?? null;
        } else if (nextEx.type === 'pyramid') {
          const totalSteps = nextEx.pyramid_steps?.length || 1;
          const step = nextEx.pyramid_steps?.[0];
          const reps = step ? (step.reps > 0 ? `${step.reps} reps` : 'MAX reps') : '';
          setInfo = `Step 1 di ${totalSteps}${reps ? ` • ${reps}` : ''}`;
          weightKg = step?.weight_kg ?? null;
        } else {
          weightKg = nextEx.weight_kg ?? null;
        }

        return { nextExerciseName: name, nextSetInfo: setInfo, nextWeightKg: weightKg };
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
          nextWeightKg: step?.weight_kg ?? null,
        };
      }

      // Recupero tra giri di circuito
      if (currentEx.type === 'circuit') {
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Giro ${currentSetIdx + 2} di ${currentEx.sets || 1}`,
          nextWeightKg: currentEx.weight_kg ?? currentEx.subExercises?.[0]?.weight_kg ?? null,
        };
      }

      // Recupero tra round di superset
      if (currentEx.type === 'superset' && currentEx.subExercises) {
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Round ${currentSetIdx + 2} di ${currentEx.sets || 1}`,
          nextWeightKg: currentEx.subExercises[0]?.weight_kg ?? null,
        };
      }

      // Recupero tra round di EMOM
      if (currentEx.type === 'emom') {
        const totalRounds = getEffectiveEmomRounds(currentEx);
        return {
          nextExerciseName: currentEx.name,
          nextSetInfo: `Round ${currentEmomRoundIdx + 2} di ${totalRounds}`,
          nextWeightKg: currentEx.subExercises?.[0]?.weight_kg ?? null,
        };
      }

      // Recupero tra serie standard (reps, isometria)
      return {
        nextExerciseName: currentEx.name,
        nextSetInfo: `Set ${currentSetIdx + 2} di ${currentEx.sets || 1}`,
        nextWeightKg: currentEx.weight_kg ?? null,
      };
    },
    [workout, pendingExerciseAdvance, currentExerciseIdx, pendingPyramidAdvance, currentPyramidStepIdx, currentSetIdx, currentEmomRoundIdx]
  );

  const startRestCountdown = (
    durationSeconds: number,
    customUpcoming?: { nextExerciseName: string; nextSetInfo: string; nextWeightKg?: number | null }
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

    // In modalità Completa: annuncia durata recupero e prossimo esercizio (nome + chili)
    const restVoiceCue = buildRestVoiceAnnouncement(safe, upcoming);
    speakCue(restVoiceCue);
  };

  const stopRestCountdown = () => {
    setIsResting(false);
    setRestEndsAtMs(null);
    stopRestMediaSession();
    pipManager.closePiP();
    void closeActiveRestNotifications();
  };

  const pauseRestCountdown = () => {
    void closeActiveRestNotifications();
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
        const nextElapsed = Math.floor(elapsedMs / 1000);
        setCircuitStopwatchElapsed((prev) => (prev === nextElapsed ? prev : nextElapsed));
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
        speakCue('Inizia');
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
      setTimeout(() => {
        persistWorkoutProgress(true);
      }, 20);
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
    void closeActiveRestNotifications();
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
        restEndsAtMs: restEndsAtMs != null ? restEndsAtMs : null,
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
        workout_uuid: workoutUuidRef.current,
        totalSets: safeExercise?.sets,
        recordedMaxPerformance: activeRecordedMax,
      },
    };

    try {
      if (user?.id) {
        pruneWorkoutProgressCheckpoints(user.id, storageKey);
        saveActiveWorkoutDraft({
          workout_uuid: workoutUuidRef.current,
          userId: user.id,
          schedaId: sourceSchedaId,
          workoutRunId: workoutRunId ? Number(workoutRunId) : null,
          workoutName: workout.name,
          updated_at_ms: now,
          started_at_ms: workoutStartedAtMsRef.current || now,
          currentExerciseIdx: safeCurrentExerciseIdx,
          currentSetIdx: safeCurrentSetIdx,
          currentExerciseName: safeExercise?.name,
          totalSets: safeExercise?.sets,
          workoutStateSnapshot: payload.state,
        });
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
      if (state.workout_uuid) {
        workoutUuidRef.current = state.workout_uuid;
      }
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
        ? (typeof state.restEndsAtMs === 'number'
            ? Math.max(0, Math.ceil((state.restEndsAtMs - Date.now()) / 1000))
            : Math.max(0, effectiveRestRemainingBase - elapsedSinceSaveSeconds))
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
          // Se la serie incrementata supera il totale delle serie dell'esercizio, avanza all'esercizio successivo
          if (targetSetIdx >= (safeExercise.sets || 1) && safeExerciseIdx < totalExercises - 1) {
            targetExerciseIdx = safeExerciseIdx + 1;
            targetSetIdx = 0;
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
      const targetRestEndsAtMs = resumeRestRunning
        ? (typeof state.restEndsAtMs === 'number' && state.restEndsAtMs > Date.now()
            ? state.restEndsAtMs
            : Date.now() + (effectiveRestRemaining * 1000))
        : null;
      setRestEndsAtMs(targetRestEndsAtMs);

      if (resumeRestRunning && targetRestEndsAtMs) {
        const upcomingEx = targetPendingExerciseAdvance ? nextWorkout.exercises[safeExerciseIdx + 1] : safeExercise;
        const nextExName = upcomingEx?.name || 'Prossimo Esercizio';
        const nextSetInfo = targetPendingExerciseAdvance
          ? `Set 1 di ${upcomingEx?.sets || 1}`
          : `Set ${safeSetIdx + 2} di ${safeExercise.sets || 1}`;
        void scheduleBackgroundRestNotification({
          endsAtMs: targetRestEndsAtMs,
          nextExerciseName: nextExName,
          nextSetInfo,
        });
      }

      setIsometryRemaining(finalIsometryRemaining);
      setIsometryActive(finalIsometryActive);
      setIsometryEndsAtMs(finalIsometryEndsAtMs);

      setEmomRoundRemaining(finalEmomRemaining);
      setEmomActive(finalEmomActive);
      setEmomRoundEndsAtMs(finalEmomEndsAtMs);

      if (restExpiredWhileClosed) {
        void closeActiveRestNotifications();
        if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
          playRestFinishedSound();
        }
        void hapticSuccess();
        setTimeout(() => {
          speakCue(buildSetAnnouncementCue(effectiveExercise, effectiveSetIdx, effectivePyramidStepIdx));
        }, 500);

        try {
          parsedPayload.state.currentExerciseIdx = targetExerciseIdx;
          parsedPayload.state.currentSetIdx = effectiveSetIdx;
          parsedPayload.state.currentSubExerciseIdx = effectiveSubIdx;
          parsedPayload.state.currentPyramidStepIdx = effectivePyramidStepIdx;
          parsedPayload.state.currentEmomRoundIdx = effectiveEmomRoundIdx;
          parsedPayload.state.pendingExerciseAdvance = false;
          parsedPayload.state.pendingPyramidAdvance = false;
          parsedPayload.state.isResting = false;
          parsedPayload.state.restWasRunning = false;
          parsedPayload.state.restRemaining = 0;
          parsedPayload.state.restEndsAtMs = null;
          parsedPayload.savedAtMs = Date.now();
          localStorage.setItem(storageKey, JSON.stringify(parsedPayload));
          notifyWorkoutProgressChanged();
        } catch (e) {
          console.error('Error updating expired rest checkpoint in storage:', e);
        }
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

    const onAudioModeChanged = (e: Event) => {
      const custom = e as CustomEvent<string>;
      setVoiceAssistanceEnabled(custom.detail === 'full');
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('voice-assistance-changed', onVoiceChanged);
    window.addEventListener('audio-mode-changed', onAudioModeChanged);
    window.addEventListener('focus', syncFromLocalStorage);
    document.addEventListener('visibilitychange', syncFromLocalStorage);

    return () => {
      isUnmounted = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('voice-assistance-changed', onVoiceChanged);
      window.removeEventListener('audio-mode-changed', onAudioModeChanged);
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
      if (!isRestingRef.current || restEndsAtMsRef.current == null || restEndsAtMsRef.current <= Date.now()) {
        void closeActiveRestNotifications();
      }
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
      void closeActiveRestNotifications();
      if (isResting) {
        stopRestCountdown();
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
        speakCue('Prossimo round');
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

    speakCue('Ultimo esercizio');
  };

  handleVoicePrevExerciseRef.current = () => {
    if (!workout) return;

    if (currentExerciseIdx > 0) {
      handlePrevExercise();
      return;
    }

    speakCue('Primo esercizio');
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
      setIsNoteModalOpen(false);
      setNoteModalDraft('');
      setNoteModalContext(null);
      setIsInstructionModalOpen(false);
      setInstructionModalContext(null);
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

      void closeActiveRestNotifications();

      const firstEx = nextWorkout.exercises[0];
      if (firstEx) {
        speakCue(buildSetAnnouncementCue(firstEx, 0));

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
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return null;
      }
      try {
        const { data, error } = await supabase
          .from('schede')
          .select(SCHEDA_FULL_SELECT_QUERY)
          .eq('id_scheda', schedaId)
          .maybeSingle();

        if (error) throw error;
        return data;
      } catch (err) {
        console.warn('[ActiveWorkoutPage] Chiamata cloud non riuscita, provo cache offline:', err);
        return null;
      }
    };

    try {
      setLoading(true);
      if (workoutRunId) {
        const workoutRunNumericId = Number(workoutRunId);
        let runData: any = null;

        if (Number.isFinite(workoutRunNumericId) && (typeof navigator === 'undefined' || navigator.onLine)) {
          try {
            const { data, error } = await supabase
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

            if (!error && data) runData = data;
          } catch {
            // offline
          }
        }

        // Se offline o non trovato sul cloud, cerca nella coda locale offline
        if (!runData && user?.id) {
          const localQueue = getSyncQueue(user.id);
          const matched = localQueue.find(
            (item) => item.workout_uuid === workoutRunId || String(item.remote_workout_run_id) === String(workoutRunId)
          );
          if (matched) {
            const snapshotExercises = toSnapshotExercises(matched.exercises_snapshot);
            initializeWorkoutState(
              {
                id: `history-${matched.workout_uuid}`,
                name: matched.workout_name_snapshot || 'Allenamento',
                exercises: snapshotExercises,
              },
              matched.id_scheda != null ? Number(matched.id_scheda) : null
            );
            return;
          }
        }

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

      if (data) {
        const sortedExercises = parseDbExerciseRows(data.esecuzioni || []) as Exercise[];
        if (user?.id) {
          updateSingleSchedaInOfflineCache(user.id, {
            id_scheda: data.id_scheda,
            nome: data.nome,
            data_creazione: data.data_creazione,
            raw_esecuzioni: data.esecuzioni || [],
            exercises: sortedExercises,
          });
        }
        initializeWorkoutState(
          { id: String(data.id_scheda), name: data.nome, exercises: sortedExercises },
          Number(data.id_scheda),
        );
        return;
      }

      // Fallback OFFLINE dalla cache locale
      if (user?.id) {
        const cached = getOfflineSchedaById(user.id, schedaId);
        if (cached) {
          const sortedExercises = (cached.exercises && cached.exercises.length > 0)
            ? (cached.exercises as Exercise[])
            : (cached.raw_esecuzioni ? parseDbExerciseRows(cached.raw_esecuzioni) as Exercise[] : []);

          initializeWorkoutState(
            { id: String(cached.id_scheda), name: cached.nome, exercises: sortedExercises },
            Number(cached.id_scheda),
          );
          return;
        }
      }

      throw new Error('Workout not found.');
    } catch (error) {
      console.error('Error fetching workout:', error);
    } finally {
      setLoading(false);
    }
  };


  const compileWorkoutNotesList = (): Array<{ text: string }> => {
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
    const notesList: Array<{ text: string }> = [];

    if (workout?.exercises) {
      workout.exercises.forEach((ex, exIdx) => {
        const entry = getExerciseNoteEntry(exIdx, ex);
        if (entry?.note?.trim()) {
          const fullText = `[${exIdx + 1}. ${ex.name}] ${entry.note.trim()}`;
          const legacyText = `[${ex.name}] ${entry.note.trim()}`;
          if (!seenNoteTexts.has(fullText) && fullText.length > 3) {
            seenNoteTexts.add(fullText);
            seenNoteTexts.add(legacyText);
            notesList.push({ text: fullText });
          }
        }
      });
    }

    Object.values(currentNotes).forEach((entry) => {
      if (!entry?.note?.trim()) return;
      const fullText = `[${entry.exerciseName}] ${entry.note.trim()}`;
      if (!seenNoteTexts.has(fullText) && fullText.length > 3) {
        seenNoteTexts.add(fullText);
        notesList.push({ text: fullText });
      }
    });

    const generalNoteTrimmed = (workoutGeneralNoteRef.current || workoutGeneralNote).trim();
    if (generalNoteTrimmed.length > 0) {
      notesList.unshift({ text: `[Scheda] ${generalNoteTrimmed}` });
    }

    return notesList;
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
        setRestEndsAtMs(null);
        stopRestMediaSession();
        pipManager.closePiP();

        // Se l'app è in primo piano, rimuove l'allarme/notifica dal centro notifiche
        if (document.visibilityState === 'visible') {
          void closeActiveRestNotifications();
        }

        // Feedback in-app (suono dedicato + vibrazione)
        if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
          playRestFinishedSound();
        }
        void hapticSuccess();

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
            speakCue('Prossimo round');
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
      speakCue('Inizia');
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
      setIsometryElapsedSeconds((prev) => (prev === elapsed ? prev : elapsed));
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
      speakCue('Inizia');
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

  useEffect(() => {
    const isCurPyramid = workout?.exercises?.[currentExerciseIdx]?.type === 'pyramid';
    if (!isCurPyramid) return;
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
  }, [currentPyramidStepIdx, currentExerciseIdx, workout]);

  useEffect(() => {
    const ex = workout?.exercises?.[currentExerciseIdx];
    const isStandardReps =
      ex &&
      ex.type !== 'pyramid' &&
      ex.type !== 'emom' &&
      ex.type !== 'isometry' &&
      ex.type !== 'cardio' &&
      ex.type !== 'circuit' &&
      ex.type !== 'superset';

    if (!isStandardReps) return;
    const timer = window.setTimeout(() => {
      if (activeSetCardRef.current) {
        activeSetCardRef.current.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [currentSetIdx, currentExerciseIdx, workout]);

  useEffect(() => {
    setIsEmomRoundWorkFinished(false);
  }, [currentEmomRoundIdx, currentExerciseIdx]);

  useEffect(() => {
    const isCurEmom = workout?.exercises?.[currentExerciseIdx]?.type === 'emom';
    if (!isCurEmom) return;
    const timer = window.setTimeout(() => {
      if (activeEmomRoundCardRef.current) {
        activeEmomRoundCardRef.current.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [currentEmomRoundIdx, currentExerciseIdx, workout]);

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

  const safeExerciseIdx = Math.max(0, Math.min(currentExerciseIdx, workout.exercises.length - 1));
  const currentExercise = workout.exercises[safeExerciseIdx] || workout.exercises[0];
  if (!currentExercise) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col p-6 items-center justify-center">
        <h2 className="text-xl font-bold text-white mb-4">No exercises found.</h2>
        <button onClick={() => navigate(-1)} className="text-brand-orange">Go Back</button>
      </div>
    );
  }

  const isLastExercise = safeExerciseIdx === workout.exercises.length - 1;
  const isLastSet = currentSetIdx === (currentExercise.sets || 1) - 1;
  const isEmom = currentExercise.type === 'emom';
  const effectiveEmomRounds = getEffectiveEmomRounds(currentExercise);
  const isLastEmomRound = currentEmomRoundIdx === effectiveEmomRounds - 1;
  const totalEmomRoundDuration = Math.max(1, currentExercise.emom_round_duration || 60);
  const emomRoundProgressRatio = Math.max(0, Math.min(1, emomRoundRemaining / totalEmomRoundDuration));
  const isPyramid = currentExercise.type === 'pyramid';
  const isLastPyramidStep = currentPyramidStepIdx === ((currentExercise.pyramid_steps?.length || 1) - 1);

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
    if (isWorkoutOverviewAdvancePending) {
      setIsWorkoutOverviewAdvancePending(false);
      setIsResting(false);
      finishRestAndNextSet(true);
    }
  };

  const updateTransitionRestSeconds = async (exerciseIndex: number, newSeconds: number) => {
    if (!workout?.exercises) return;
    const targetExercise = workout.exercises[exerciseIndex];
    if (!targetExercise) return;

    const safeSeconds = Math.max(0, Math.trunc(newSeconds || 0));

    // 1. Aggiorna in memoria workout.exercises
    setWorkout((prev) => {
      if (!prev) return prev;
      const exercises = [...prev.exercises];
      exercises[exerciseIndex] = {
        ...exercises[exerciseIndex],
        transition_rest_seconds: safeSeconds,
      };
      return { ...prev, exercises };
    });

    // 2. Se stiamo attualmente recuperando proprio su questa transizione, aggiorna il timer live
    if (isResting && pendingExerciseAdvance && currentExerciseIdx === exerciseIndex) {
      if (safeSeconds === 0) {
        skipRest();
      } else {
        setRestInitialDuration(safeSeconds);
        setRestRemaining(safeSeconds);
        const targetTime = Date.now() + safeSeconds * 1000;
        setRestEndsAtMs(targetTime);
      }
    }

    // 3. Salva checkpoint persistente
    setTimeout(() => {
      persistWorkoutProgress(true);
    }, 50);

    // 4. Salva su Supabase se id_scheda è presente
    try {
      const schedaId = sourceSchedaId;
      if (schedaId != null && targetExercise.id) {
        const isGroupEx = targetExercise.type === 'superset' || targetExercise.type === 'circuit';
        if (isGroupEx) {
          await supabase
            .from('esecuzioni')
            .update({ rest_tra_esercizi: safeSeconds > 0 ? safeSeconds : null })
            .eq('id_scheda', schedaId)
            .eq('id_superset', Number(targetExercise.id));
        } else {
          await supabase
            .from('esecuzioni')
            .update({ rest_tra_esercizi: safeSeconds > 0 ? safeSeconds : null })
            .eq('id_scheda', schedaId)
            .eq('id_esecuzione', Number(targetExercise.id));
        }
      }
    } catch (err) {
      console.warn('Could not sync transition rest to Supabase:', err);
    }

    void hapticSuccess();
  };

  const handleSaveExerciseFromOverview = async (exerciseIndex: number, updatedExercise: Exercise) => {
    if (!workout?.exercises) return;

    // 1. Aggiorna in memoria workout.exercises
    setWorkout((prev) => {
      if (!prev) return prev;
      const exercises = [...prev.exercises];
      exercises[exerciseIndex] = updatedExercise;
      return { ...prev, exercises };
    });

    // 2. Se stiamo modificando l'esercizio corrente in esecuzione
    if (exerciseIndex === currentExerciseIdx) {
      if (updatedExercise.type === 'isometry' || updatedExercise.type === 'cardio') {
        if (updatedExercise.duration_seconds > 0) {
          setIsometryRemainingWithSync(Math.min(isometryRemaining, updatedExercise.duration_seconds));
        }
      }
      if (updatedExercise.type === 'emom' && updatedExercise.emom_round_duration) {
        setEmomRoundRemainingWithSync(Math.min(emomRoundRemaining, updatedExercise.emom_round_duration));
      }
    }

    // 3. Se stiamo modificando la pausa di transizione corrente
    if (isResting && pendingExerciseAdvance && currentExerciseIdx === exerciseIndex) {
      const safeTrans = updatedExercise.transition_rest_seconds || 0;
      if (safeTrans === 0) {
        skipRest();
      } else {
        setRestInitialDuration(safeTrans);
        setRestRemaining(safeTrans);
        setRestEndsAtMs(Date.now() + safeTrans * 1000);
      }
    }

    // 4. Salva checkpoint persistente in memoria locale
    setTimeout(() => {
      persistWorkoutProgress(true);
    }, 50);

    // 5. Salva su Supabase se id_scheda è presente
    try {
      const schedaId = sourceSchedaId;
      if (schedaId != null && updatedExercise.id) {
        if (updatedExercise.type === 'superset' || updatedExercise.type === 'circuit') {
          const supersetId = Number(updatedExercise.id);
          await supabase
            .from('superset')
            .update({ round_totali: Math.max(1, updatedExercise.sets || 1) })
            .eq('id_superset', supersetId);

          const { data: rows } = await supabase
            .from('esecuzioni')
            .select('id_esecuzione, ordine')
            .eq('id_scheda', schedaId)
            .eq('id_superset', supersetId)
            .order('ordine', { ascending: true });

          if (rows && updatedExercise.subExercises) {
            await Promise.all(
              rows.slice(0, updatedExercise.subExercises.length).map(async (row, sIdx) => {
                const sub = updatedExercise.subExercises![sIdx];
                if (!sub) return;
                const isIso = sub.type === 'isometry';
                await supabase
                  .from('esecuzioni')
                  .update({
                    set_num: Math.max(1, updatedExercise.sets || 1),
                    rest_secondi: updatedExercise.rest_seconds > 0 ? updatedExercise.rest_seconds : null,
                    rest_tra_esercizi: (updatedExercise.transition_rest_seconds || 0) > 0 ? updatedExercise.transition_rest_seconds : null,
                    reps: isIso ? null : (isMaxTarget(sub.reps) ? 0 : sub.reps),
                    durata_secondi: isIso ? (isMaxTarget(sub.duration_seconds) ? 0 : sub.duration_seconds) : null,
                    peso_kg: sub.weight_kg != null && sub.weight_kg > 0 ? sub.weight_kg : null,
                  })
                  .eq('id_scheda', schedaId)
                  .eq('id_esecuzione', row.id_esecuzione);
              })
            );
          }
        } else if (updatedExercise.type === 'emom') {
          const emomId = Number(updatedExercise.id);
          await supabase
            .from('emom')
            .update({
              round_totali: Math.max(1, updatedExercise.emom_rounds || 1),
              durata_round_secondi: Math.max(1, updatedExercise.emom_round_duration || 60),
            })
            .eq('id_emom', emomId);

          const { data: rows } = await supabase
            .from('esecuzioni')
            .select('id_esecuzione, ordine')
            .eq('id_scheda', schedaId)
            .eq('id_emom', emomId)
            .order('ordine', { ascending: true });

          if (rows && updatedExercise.subExercises) {
            await Promise.all(
              rows.slice(0, updatedExercise.subExercises.length).map(async (row, sIdx) => {
                const sub = updatedExercise.subExercises![sIdx];
                if (!sub) return;
                const isIso = sub.type === 'isometry';
                await supabase
                  .from('esecuzioni')
                  .update({
                    set_num: Math.max(1, updatedExercise.sets || 1),
                    rest_secondi: updatedExercise.rest_seconds > 0 ? updatedExercise.rest_seconds : null,
                    rest_tra_esercizi: (updatedExercise.transition_rest_seconds || 0) > 0 ? updatedExercise.transition_rest_seconds : null,
                    reps: isIso ? null : (isMaxTarget(sub.reps) ? 0 : sub.reps),
                    durata_secondi: isIso ? (isMaxTarget(sub.duration_seconds) ? 0 : sub.duration_seconds) : null,
                    peso_kg: sub.weight_kg != null && sub.weight_kg > 0 ? sub.weight_kg : null,
                  })
                  .eq('id_scheda', schedaId)
                  .eq('id_esecuzione', row.id_esecuzione);
              })
            );
          }
        } else if (updatedExercise.type === 'pyramid') {
          const pyramidId = Number(updatedExercise.id);
          const { data: rows } = await supabase
            .from('esecuzioni')
            .select('id_esecuzione, ordine, stepindex_piramide')
            .eq('id_scheda', schedaId)
            .eq('id_piramide', pyramidId)
            .order('ordine', { ascending: true });

          if (rows && updatedExercise.pyramid_steps) {
            await Promise.all(
              rows.slice(0, updatedExercise.pyramid_steps.length).map(async (row, stIdx) => {
                const step = updatedExercise.pyramid_steps![stIdx];
                if (!step) return;
                await supabase
                  .from('esecuzioni')
                  .update({
                    reps: isMaxTarget(step.reps) ? 0 : step.reps,
                    rest_secondi: step.rest_seconds > 0 ? step.rest_seconds : null,
                    rest_tra_esercizi: (updatedExercise.transition_rest_seconds || 0) > 0 ? updatedExercise.transition_rest_seconds : null,
                    peso_kg: step.weight_kg != null && step.weight_kg > 0 ? step.weight_kg : null,
                  })
                  .eq('id_scheda', schedaId)
                  .eq('id_esecuzione', row.id_esecuzione);
              })
            );
          }
        } else {
          // Standard reps, isometry, cardio
          const isIso = updatedExercise.type === 'isometry' || updatedExercise.type === 'cardio';
          await supabase
            .from('esecuzioni')
            .update({
              set_num: Math.max(1, updatedExercise.sets || 1),
              reps: isIso ? null : (isMaxTarget(updatedExercise.reps) ? 0 : updatedExercise.reps),
              durata_secondi: isIso ? (isMaxTarget(updatedExercise.duration_seconds) ? 0 : updatedExercise.duration_seconds) : null,
              peso_kg: updatedExercise.weight_kg != null && updatedExercise.weight_kg > 0 ? updatedExercise.weight_kg : null,
              rest_secondi: updatedExercise.rest_seconds > 0 ? updatedExercise.rest_seconds : null,
              rest_tra_esercizi: (updatedExercise.transition_rest_seconds || 0) > 0 ? updatedExercise.transition_rest_seconds : null,
              note_esercizio: updatedExercise.instruction_note || null,
            })
            .eq('id_scheda', schedaId)
            .eq('id_esecuzione', Number(updatedExercise.id));
        }
      }
    } catch (err) {
      console.warn('Could not sync updated exercise to Supabase:', err);
    }
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


  const specialExerciseLabel =
    currentExercise.type === 'circuit'
      ? 'CIRCUIT MODE'
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
        speakCue(buildSetAnnouncementCue(nextEx, 0));
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
      speakCue(buildSetAnnouncementCue(prevEx, 0));
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
        speakCue('Prossimo round');
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
            nextWeightKg: step?.weight_kg ?? null,
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
    if (isResting || isNoteModalOpen || isInstructionModalOpen) return;

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
    if (isResting || isNoteModalOpen || isInstructionModalOpen) return;

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
    stopRestCountdown();

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
    finishRestAndNextSet(true);
  };

  const nextRecoveryLabel = getNextRecoveryLabel();

  const handleLeaveWorkout = () => {
    freezeForegroundWorkoutTime();
    stopRestMediaSession();
    pipManager.closePiP();
    void releaseScreenWakeLock();
    persistWorkoutProgress(true);
    void lockAppToPortrait();
    navigate('/');
  };

  const markWorkoutComplete = async () => {
    if (workoutCompletionHandledRef.current) return;
    workoutCompletionHandledRef.current = true;
    suppressProgressPersistenceRef.current = true;

    if (voiceAssistanceEnabled && isAudioFeedbackEnabled()) {
      playGoalReachedSound();
    }
    speakCue('Allenamento completato');
    stopEmomCountdown();
    stopIsometryCountdown();
    stopRestCountdown();
    stopRestMediaSession();
    void releaseScreenWakeLock();

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
          workout_uuid: workoutUuidRef.current,
          subExercises: exercise.subExercises || [],
          pyramid_steps: exercise.pyramid_steps || [],
          completed_sets_records: completed_sets_records.some((v) => v != null) ? completed_sets_records : undefined,
          completed_sets_reps: completed_sets_records.some((v) => v != null) ? completed_sets_records : undefined,
        };
      })
      : [];

    const compiledNotes = compileWorkoutNotesList();

    // 1. Inserimento immediato in coda locale persistente (stato 'completed', sync_status: 'pending')
    if (user?.id) {
      enqueueCompletedWorkout({
        workout_uuid: workoutUuidRef.current,
        id_utente: user.id,
        id_scheda: computedSchedaId,
        workout_name_snapshot: workoutNameSnapshot,
        durata_totale_secondi: workoutDurationSeconds,
        executed_at: new Date().toISOString(),
        exercises_snapshot: exercisesSnapshot,
        notes: compiledNotes,
      });
      clearActiveWorkoutDraft(user.id);
    }
    clearPersistedWorkoutProgress();

    // 2. Trigger automatico background sync se online (senza bloccare la UI)
    if (user?.id && typeof navigator !== 'undefined' && navigator.onLine) {
      void processSyncQueue(user.id);
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
        speakCue('Prossimo round');
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
  const getExerciseDisplayName = (exercise: Exercise, fallbackIndex: number) => {
    return String(exercise.name || '').trim() || `Exercise ${fallbackIndex + 1}`;
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


  const renderWorkoutOverviewModal = () => {
    if (!isWorkoutOverviewModalOpen) return null;
    return (
      <WorkoutOverviewModal
        isOpen={isWorkoutOverviewModalOpen}
        onClose={closeWorkoutOverviewModal}
        workout={workout}
        currentExerciseIdx={currentExerciseIdx}
        currentSubExerciseIdx={currentSubExerciseIdx}
        currentPyramidStepIdx={currentPyramidStepIdx}
        currentSetIdx={currentSetIdx}
        currentEmomRoundIdx={currentEmomRoundIdx}
        isResting={isResting}
        pendingPyramidAdvance={pendingPyramidAdvance}
        pendingExerciseAdvance={pendingExerciseAdvance}
        isometryRemaining={isometryRemaining}
        getCurrentWorkoutElapsedSeconds={getCurrentWorkoutElapsedSeconds}
        workoutGeneralNote={workoutGeneralNote}
        onSaveGeneralNote={(note) => {
          setWorkoutGeneralNote(note);
          workoutGeneralNoteRef.current = note;
        }}
        onUpdateTransitionRest={updateTransitionRestSeconds}
        onOpenExerciseNote={openExerciseNoteModal}
        onSaveExercise={handleSaveExerciseFromOverview}
        getExerciseNoteEntry={getExerciseNoteEntry}
      />
    );
  };

  const renderActiveWorkoutModals = () => {
    return (
      <>
        {renderWorkoutOverviewModal()}
        <ActiveWorkoutModals
          isNoteModalOpen={isNoteModalOpen}
          noteModalContext={noteModalContext}
          currentExerciseName={currentExercise.name}
          noteModalDraft={noteModalDraft}
          onNoteModalDraftChange={setNoteModalDraft}
          onCloseNoteModal={closeCurrentExerciseNoteModal}
          onSaveNoteModal={saveCurrentExerciseNote}

          isInstructionModalOpen={isInstructionModalOpen}
          instructionModalContext={instructionModalContext}
          onCloseInstructionModal={closeCurrentInstructionModal}

          isAutoCountModalOpen={isAutoCountModalOpen && Boolean(currentExercise) && !isSuperset}
          autoCountExerciseName={currentExercise?.name}
          autoCountTargetReps={currentExercise?.reps}
          onChooseCameraAutoCount={async () => {
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
                mode: 'video',
              },
            });
          }}
          onChooseAccelerometerAutoCount={async () => {
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
                mode: 'accelerometer',
              },
            });
          }}
          onCloseAutoCountModal={() => setIsAutoCountModalOpen(false)}

          isMaxPromptModalOpen={isMaxPromptModalOpen}
          maxPromptExercise={currentExercise}
          targetEditingSetIdx={targetEditingSetIdx}
          currentSetIdx={currentSetIdx}
          isPendingSetAdvance={Boolean(isPendingSetAdvanceRef.current)}
          modalPerformanceValue={modalPerformanceValue}
          setModalPerformanceValue={setModalPerformanceValue}
          onSaveMaxPerformance={(val) => {
            setLoggedPerformanceForSet(currentExerciseIdx, currentExercise, targetEditingSetIdx, val);
            setIsMaxPromptModalOpen(false);
            if (targetEditingSetIdx === currentSetIdx && isPendingSetAdvanceRef.current) {
              isPendingSetAdvanceRef.current = false;
              completeSet();
            }
          }}
          onSkipMaxPerformance={() => {
            isPendingSetAdvanceRef.current = false;
            setIsMaxPromptModalOpen(false);
            completeSet();
          }}
          onCloseMaxPromptModal={() => setIsMaxPromptModalOpen(false)}

          isCelebrationOpen={isCelebrationOpen}
          workoutName={workout?.name}
          workoutDurationSeconds={getCurrentWorkoutElapsedSeconds()}
          exercisesCompletedCount={workout?.exercises?.length}
          onCelebrationComplete={handleCelebrationComplete}
        />
      </>
    );
  };

  const getRestTargetDetails = () => {
    const isTransitioning = Boolean(transitionNextExercise);
    const targetExercise = isTransitioning ? transitionNextExercise! : currentExercise;
    const targetExerciseIndex = isTransitioning ? currentExerciseIdx + 1 : currentExerciseIdx;
    const targetExerciseName = getExerciseDisplayName(targetExercise, targetExerciseIndex);
    const nextStepIdx = currentPyramidStepIdx + 1;
    const nextSetIdx = currentSetIdx + 1;
    const nextEmomRoundIdx = currentEmomRoundIdx + 1;

    const targetType = targetExercise.type || 'reps';
    const isTargetPyramid = targetType === 'pyramid';
    const isTargetEmom = targetType === 'emom';
    const isTargetSuperset = targetType === 'superset';
    const isTargetCircuit = targetType === 'circuit';
    const isTargetIsometry = targetType === 'isometry';

    // Upcoming step for pyramid
    const upcomingPyramidStep = !isTransitioning && isPyramid
      ? currentExercise.pyramid_steps?.[nextStepIdx]
      : isTransitioning && isTargetPyramid
        ? targetExercise.pyramid_steps?.[0]
        : null;

    // Upcoming set/step index numbers for display:
    const upcomingSetNumber = nextSetIdx + 1;
    const totalSetsNumber = currentExercise.sets || 1;
    const upcomingStepNumber = nextStepIdx + 1;
    const totalStepsNumber = currentExercise.pyramid_steps?.length || 1;
    const upcomingRoundNumber = nextEmomRoundIdx + 1;
    const totalEmomRoundsNumber = effectiveEmomRounds;

    // Goal text (reps / duration / etc.)
    let targetGoalText = '';
    if (isTransitioning) {
      if (isTargetPyramid) {
        const s1Reps = targetExercise.pyramid_steps?.[0]?.reps;
        targetGoalText = s1Reps === 0 ? 'MAX Reps (Step 1)' : `${s1Reps || 10} Reps (Step 1)`;
      } else if (isTargetIsometry) {
        targetGoalText = targetExercise.duration_seconds === 0 ? 'MAX Tenuta' : `${targetExercise.duration_seconds}s Tenuta`;
      } else if (isTargetEmom) {
        targetGoalText = `${targetExercise.emom_rounds || 10} Round (${targetExercise.emom_round_duration || 60}s)`;
      } else if (isTargetSuperset || isTargetCircuit) {
        targetGoalText = `${targetExercise.subExercises?.length || 2} Esercizi a giro`;
      } else {
        targetGoalText = targetExercise.reps === 0 ? 'MAX Reps (Sfinimento)' : `${targetExercise.reps} Reps`;
      }
    } else {
      if (isPyramid) {
        targetGoalText = upcomingPyramidStep?.reps === 0 ? 'MAX Reps (Sfinimento)' : `${upcomingPyramidStep?.reps ?? 10} Reps`;
      } else if (isTargetIsometry) {
        targetGoalText = currentExercise.duration_seconds === 0 ? 'MAX Tenuta (Sfinimento)' : `${currentExercise.duration_seconds}s Tenuta`;
      } else if (isTargetEmom) {
        targetGoalText = `Round ${upcomingRoundNumber} (${currentExercise.emom_round_duration || 60}s)`;
      } else if (isTargetSuperset || isTargetCircuit) {
        targetGoalText = `Round ${upcomingSetNumber} (${currentExercise.subExercises?.length || 2} es.)`;
      } else {
        targetGoalText = currentExercise.reps === 0 ? 'MAX Reps (Sfinimento)' : `${currentExercise.reps} Reps`;
      }
    }

    // Weight label
    let targetWeightText = 'Corpo libero';
    if (isTransitioning) {
      if (isTargetPyramid) {
        const w = targetExercise.pyramid_steps?.[0]?.weight_kg;
        targetWeightText = w != null && w > 0 ? `${w} kg` : 'Corpo libero';
      } else if (isTargetSuperset || isTargetCircuit) {
        const subWeights = (targetExercise.subExercises || []).map(s => s.weight_kg).filter(w => w != null && w > 0);
        targetWeightText = subWeights.length > 0 ? 'Vario (vedi lista)' : 'Corpo libero';
      } else {
        targetWeightText = targetExercise.weight_kg != null && targetExercise.weight_kg > 0 ? `${targetExercise.weight_kg} kg` : 'Corpo libero';
      }
    } else {
      if (isPyramid) {
        const w = upcomingPyramidStep?.weight_kg;
        targetWeightText = w != null && w > 0 ? `${w} kg` : 'Corpo libero';
      } else if (isTargetSuperset || isTargetCircuit) {
        targetWeightText = currentExecutionWeightLabel && currentExecutionWeightLabel !== '-' ? currentExecutionWeightLabel : 'Corpo libero';
      } else {
        targetWeightText = currentExercise.weight_kg != null && currentExercise.weight_kg > 0 ? `${currentExercise.weight_kg} kg` : 'Corpo libero';
      }
    }

    // Sub-exercises list (for superset / circuit / emom)
    const targetSubExercises = isTransitioning
      ? targetExercise.subExercises || []
      : currentExercise.subExercises || [];

    // Instruction note
    const targetInstruction = isTransitioning
      ? targetExercise.instruction_note
      : currentExercise.instruction_note;

    const restTotalDuration = Math.max(1, restInitialDuration || currentExercise.rest_seconds || 1);
    const restProgressRatio = Math.max(0, Math.min(1, restRemaining / restTotalDuration));

    return {
      isTransitioning,
      targetExercise,
      targetExerciseIndex,
      targetExerciseName,
      nextStepIdx,
      nextSetIdx,
      nextEmomRoundIdx,
      targetType,
      isTargetPyramid,
      isTargetEmom,
      isTargetSuperset,
      isTargetCircuit,
      isTargetIsometry,
      upcomingPyramidStep,
      upcomingSetNumber,
      totalSetsNumber,
      upcomingStepNumber,
      totalStepsNumber,
      upcomingRoundNumber,
      totalEmomRoundsNumber,
      targetGoalText,
      targetWeightText,
      targetSubExercises,
      targetInstruction,
      restProgressRatio,
    };
  };

  const renderLandscapeRestView = () => {
    const {
      isTransitioning,
      targetExercise,
      targetExerciseName,
      nextStepIdx,
      nextSetIdx,
      targetType,
      isTargetPyramid,
      isTargetEmom,
      isTargetSuperset,
      isTargetCircuit,
      isTargetIsometry,
      targetGoalText,
      targetWeightText,
      targetSubExercises,
      targetInstruction,
      restProgressRatio,
    } = getRestTargetDetails();
    const isGroupType = isTargetSuperset || isTargetCircuit;

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
              title="Esci dal workout"
            >
              <X size={14} className="text-zinc-400" />
              <span>Esci</span>
            </button>

            <button
              type="button"
              onClick={openWorkoutOverviewModal}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 hover:border-white/20 active:scale-95 transition-all shadow-[0_2px_10px_rgba(0,0,0,0.5)] cursor-pointer group"
              title="Lista esercizi"
            >
              <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-orange opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-orange shadow-[0_0_6px_rgba(255,94,0,0.9)]" />
              </span>
              <span className="text-xs font-mono font-bold text-zinc-200 tracking-tight">
                {currentExerciseIdx + 1} di {workout.exercises.length}
              </span>
              {hasGeneralWorkoutNote && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
              )}
              <List size={13} className="text-zinc-400 group-hover:text-white transition-colors shrink-0" />
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
                  {isVoiceEnabled ? <Mic size={16} /> : <MicOff size={16} />}
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

        {/* Apple StandBy 50/50 Split Grid */}
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 sm:gap-4 my-0.5 items-stretch">
          {/* Metà Sinistra — Scheda Completa Prossimo Set / Prossimo Esercizio */}
          <div className="flex flex-col justify-between bg-[#1C1C1E]/85 backdrop-blur-md border border-white/10 rounded-3xl p-3 sm:p-3.5 min-h-0 shadow-xl overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scroll-area space-y-2 pr-1">
              {/* Header indicatore chiaro */}
              <div className="flex items-center justify-between shrink-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-orange">
                  <ArrowRight size={13} className="text-brand-orange shrink-0" />
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">
                    {isTransitioning ? 'Prossimo Esercizio' : 'Prossimo Set'}
                  </span>
                </div>
                {isTransitioning && (
                  <span className="text-[10px] sm:text-[11px] font-mono font-bold text-zinc-300 uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                    Es. {currentExerciseIdx + 2} di {workout.exercises.length}
                  </span>
                )}
              </div>

              {/* Avviso esplicito che le informazioni appartengono al prossimo esercizio o prossimo set */}
              <div className="text-[10px] text-zinc-400 font-semibold flex items-center gap-1 px-0.5">
                <Info size={11} className="text-brand-orange shrink-0" />
                <span className="truncate">
                  {isTransitioning
                    ? 'Informazioni e parametri del prossimo esercizio'
                    : 'Informazioni e parametri del prossimo set'}
                </span>
              </div>

              {/* Nome dell'esercizio + Badge tipologia */}
              <div className="flex items-center justify-between gap-2 shrink-0">
                <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-tight truncate">
                  {targetExerciseName}
                </h2>
                {!isTargetSuperset && !isTargetEmom && (
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-orange/15 text-brand-orange border border-brand-orange/30 shrink-0 font-mono">
                    {targetType.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Griglia Caratteristiche Prossimo Set / Esercizio */}
              {!isGroupType ? (
                <div className={`grid ${isTargetEmom ? 'grid-cols-1' : (isTransitioning ? 'grid-cols-3' : 'grid-cols-2')} gap-1.5`}>
                  {/* Box 1: Obiettivo / Reps */}
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-2 flex flex-col justify-center">
                    <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                      {isTargetIsometry ? 'Tenuta' : 'Target'}
                    </span>
                    <span className="text-xs sm:text-sm font-black text-white font-mono mt-0.5 truncate">
                      {targetGoalText}
                    </span>
                  </div>

                  {/* Box 2: Carico */}
                  {!isTargetEmom && (
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-2 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">Carico</span>
                      <span className="text-xs sm:text-sm font-black text-brand-orange font-mono mt-0.5 truncate">
                        {targetWeightText}
                      </span>
                    </div>
                  )}

                  {/* Box 3: Serie Totali (solo quando si passa a un nuovo esercizio, nessun campo Recupero) */}
                  {isTransitioning && !isTargetEmom && (
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-2 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                        Serie Totali
                      </span>
                      <span className="text-xs sm:text-sm font-black text-zinc-200 font-mono mt-0.5 truncate">
                        {isTargetPyramid
                          ? `${targetExercise.pyramid_steps?.length || 0} Step`
                          : `${targetExercise.sets} Serie`}
                      </span>
                    </div>
                  )}
                </div>
              ) : isTransitioning ? (
                <div className="bg-black/40 border border-white/5 rounded-2xl p-2 flex items-center justify-between">
                  <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                    {isTargetCircuit ? 'Giri Totali' : 'Serie Totali'}
                  </span>
                  <span className="text-xs sm:text-sm font-black text-zinc-200 font-mono">
                    {targetExercise.sets} {isTargetCircuit ? 'Giri' : 'Serie'}
                  </span>
                </div>
              ) : null}

              {/* Sub-esercizi se Superset / Circuito / EMOM */}
              {targetSubExercises.length > 0 && (
                <div className="bg-black/40 border border-white/5 rounded-2xl p-2 space-y-1">
                  {!isTargetSuperset && !isTargetEmom && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                      Sequenza Round:
                    </span>
                  )}
                  {targetSubExercises.map((sub, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs py-0.5 border-b border-white/5 last:border-0">
                      <span className="text-white font-bold truncate text-[11px]">{sub.name}</span>
                      <span className="text-brand-orange font-mono font-bold text-[10px] shrink-0 ml-2">
                        {sub.type === 'isometry' ? `${sub.duration_seconds}s` : `${sub.reps} reps`} • {formatWeightLabel(sub.weight_kg)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Timeline compatta dei set se stesso esercizio */}
              {!isTransitioning && (
                <div className="py-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                    Progressione Serie:
                  </span>
                  <div className="flex gap-1.5 items-center overflow-x-auto no-scrollbar py-0.5">
                    {isPyramid && currentExercise.pyramid_steps ? (
                      currentExercise.pyramid_steps.map((step, sIdx) => {
                        const isUpcoming = sIdx === nextStepIdx;
                        const isDone = sIdx <= currentPyramidStepIdx;
                        return (
                          <div
                            key={sIdx}
                            className={`w-13 h-13 sm:w-14 sm:h-14 aspect-square rounded-2xl border text-center transition-all flex flex-col items-center justify-center relative shrink-0 select-none ${
                              isUpcoming
                                ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_12px_rgba(255,94,0,0.45)] ring-1 ring-brand-orange/70'
                                : isDone
                                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                  : 'bg-white/5 border-white/5 text-zinc-400'
                            }`}
                            title={`Step ${sIdx + 1}: ${step.reps === 0 ? 'MAX' : step.reps} reps${step.weight_kg ? ` @ ${step.weight_kg}kg` : ''}`}
                          >
                            {isDone && (
                              <span className="absolute top-1 right-1.5 text-[9px] font-black text-emerald-400 leading-none">
                                ✓
                              </span>
                            )}
                            {isUpcoming && (
                              <span className="absolute top-1 right-1.5 text-[8px] leading-none">
                                ⏳
                              </span>
                            )}
                            <span className="text-sm sm:text-base font-black font-mono leading-none tracking-tight">
                              {step.reps === 0 ? 'MAX' : step.reps}
                            </span>
                            <span className="text-[9px] uppercase font-bold tracking-wider leading-none mt-1 opacity-75">
                              reps
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                        const isUpcoming = sIdx === nextSetIdx;
                        const isDone = sIdx <= currentSetIdx;
                        return (
                          <div
                            key={sIdx}
                            className={`py-1 px-2.5 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black shrink-0 ${
                              isUpcoming
                                ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_10px_rgba(255,94,0,0.4)] ring-1 ring-brand-orange/60'
                                : isDone
                                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                  : 'bg-white/5 border-white/5 text-zinc-500'
                            }`}
                          >
                            <span className="text-[10px] opacity-75">{sIdx + 1}</span>
                            <span>{isDone ? '✓' : isUpcoming ? '⏳' : ''}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Note di esecuzione se presenti */}
              {targetInstruction && (
                <div className="bg-brand-orange/10 border border-brand-orange/25 rounded-2xl p-2.5 flex items-start gap-2">
                  <Info size={13} className="text-brand-orange shrink-0 mt-0.5" />
                  <div className="text-[11px] text-zinc-200 leading-snug">
                    <span className="font-bold text-brand-orange block text-[9px] uppercase tracking-wider mb-0.5">
                      Note Esecuzione:
                    </span>
                    {targetInstruction}
                  </div>
                </div>
              )}

              {/* Riepilogo prestazione per MAX se applicabile */}
              {!isTransitioning && isMaxPerformance(currentExercise) && (
                <div className="bg-black/50 border border-brand-orange/30 rounded-2xl p-2.5 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-zinc-400 block">
                      Ultimo Set {currentSetIdx + 1} (A Sfinimento)
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
                    className="px-2.5 py-1 rounded-xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange text-xs font-bold transition-all border border-brand-orange/30 flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={11} />
                    <span>Modifica</span>
                  </button>
                </div>
              )}
            </div>

            {/* PiP Button if supported */}
            {pipManager.isSupported() && (
              <div className="pt-1.5 border-t border-white/5 flex justify-center shrink-0">
                <button
                  type="button"
                  onClick={handleTogglePiP}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-brand-orange/30 bg-brand-darkGrey/60 hover:bg-brand-orange/20 text-brand-orange text-[10px] font-bold transition-all shadow-sm cursor-pointer"
                >
                  <Layers size={11} />
                  <span>{pipManager.isActive() ? 'Chiudi PiP' : 'Mini-Timer PiP'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Metà Destra — Hero Action Stage: Grande Timer Circolare Satinato & Azioni Inferiori */}
          <div className="flex flex-col justify-between bg-gradient-to-b from-[#1C1C1E]/95 via-[#1C1C1E]/70 to-[#121214] border border-white/10 rounded-3xl p-3 sm:p-4 min-h-0 shadow-2xl relative overflow-hidden items-center">
            {/* Grande Timer Circolare Satinato */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center my-auto">
              <div
                className={`relative w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 rounded-full flex flex-col justify-center items-center cursor-pointer select-none transition-all duration-300 overflow-hidden ${
                  restRemaining <= 3 && restRemaining > 0
                    ? 'border-4 border-brand-orange ring-4 ring-brand-orange/60 shadow-[0_0_50px_rgba(255,107,0,0.6)] animate-pulse'
                    : 'border-4 border-white/10 shadow-[0_0_35px_rgba(255,94,0,0.15)] bg-black/40'
                }`}
                onPointerDown={(event) => handleTimerPointerDown(event, resetRestCountdown)}
                onPointerUp={(event) => handleTimerPointerUp(event, handleRestTimerTap)}
                onPointerCancel={handleTimerPointerAbort}
                onPointerLeave={handleTimerPointerAbort}
                title="Tocca per pausa/avvio • Tieni premuto per azzerare"
              >
                {/* SVG Circular Progress Track */}
                <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="43" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="6" fill="transparent" />
                  <circle
                    cx="50"
                    cy="50"
                    r="43"
                    stroke={restRemaining <= 3 && restRemaining > 0 ? '#FF7724' : '#FF5E00'}
                    strokeWidth="6"
                    strokeDasharray={2 * Math.PI * 43}
                    strokeDashoffset={2 * Math.PI * 43 * (1 - restProgressRatio)}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                  />
                </svg>

                {/* Countdown Digits — Extra Large, perfectly centered */}
                <span
                  className={`text-5xl sm:text-6xl md:text-7xl font-black z-10 font-mono tracking-tighter leading-none select-none transition-colors duration-300 ${
                    restRemaining <= 3 && restRemaining > 0 ? 'text-brand-orange drop-shadow-[0_0_20px_rgba(255,94,0,0.8)]' : 'text-white'
                  }`}
                >
                  {formatTime(restRemaining)}
                </span>

                {/* Scritta "PAUSA" dentro al cerchio sotto i numeri, posizionata in modo assoluto per non spostare nessun elemento */}
                {restEndsAtMs == null && (
                  <div className="absolute bottom-[14%] left-0 right-0 flex justify-center z-10 pointer-events-none animate-in fade-in duration-200">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-mono font-black tracking-widest uppercase shadow-sm">
                      PAUSA
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-center mt-2 flex items-center justify-center gap-1.5">
                <span>Tocca per {restEndsAtMs != null ? 'pausa' : 'avvio'} • Tieni premuto per azzerare</span>
              </p>
            </div>

            {/* Bottom Action Bar: Note Button + Skip Rest Button (identico a vertical mode) */}
            <div className="shrink-0 h-11 sm:h-13 w-full mt-2 flex items-stretch gap-2 sm:gap-2.5">
              <button
                type="button"
                onClick={openCurrentExerciseNoteModal}
                className={`w-11 sm:w-13 rounded-2xl border transition-all active:scale-95 flex items-center justify-center shrink-0 relative shadow-sm cursor-pointer ${
                  hasCurrentWorkoutNote
                    ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                    : 'bg-brand-darkGrey/60 border-white/10 text-zinc-400 hover:text-white'
                }`}
                title="Note esercizio"
              >
                <FileText size={18} />
                {hasCurrentWorkoutNote && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-orange ring-1 ring-black" />
                )}
              </button>

              <button
                type="button"
                onClick={skipRest}
                className="flex-1 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center transition-all border border-white/10 shadow-lg cursor-pointer tracking-wider uppercase"
              >
                <SkipForward size={18} className="mr-2 shrink-0" />
                <span>SALTA RECUPERO</span>
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
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 hover:border-white/20 active:scale-95 transition-all shadow-[0_2px_10px_rgba(0,0,0,0.5)] cursor-pointer group"
              title="Lista esercizi"
            >
              <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-orange opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-orange shadow-[0_0_6px_rgba(255,94,0,0.9)]" />
              </span>
              <span className="text-xs font-mono font-bold text-zinc-200 tracking-tight">
                {currentExerciseIdx + 1} di {workout.exercises.length}
              </span>
              {hasGeneralWorkoutNote && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
              )}
              <List size={13} className="text-zinc-400 group-hover:text-white transition-colors shrink-0" />
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openCurrentExerciseNoteModal}
                className={`p-1.5 rounded-full border transition-all active:scale-95 flex items-center justify-center relative cursor-pointer ${
                  hasCurrentWorkoutNote
                    ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_10px_rgba(255,94,0,0.35)]'
                    : 'bg-brand-darkGrey/60 border-white/10 text-zinc-300 hover:text-white'
                }`}
                title="Note esercizio"
              >
                <FileText size={16} />
                {hasCurrentWorkoutNote && (
                  <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-brand-orange ring-1 ring-black" />
                )}
              </button>

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
                  {isVoiceEnabled ? <Mic size={16} /> : <MicOff size={16} />}
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

        {/* Apple StandBy 50/50 Split Grid */}
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-3 sm:gap-4 my-0.5 items-stretch">
          {/* Metà Sinistra — Contesto Esercizio & Progressione */}
          <div className="flex flex-col justify-between bg-[#1C1C1E]/80 backdrop-blur-md border border-white/10 rounded-3xl p-3 sm:p-3.5 min-h-0 shadow-xl overflow-hidden">
            {/* Top: Nav row & Nome esercizio */}
            <div className="flex flex-col gap-1 shrink-0">
              <div className="flex items-center justify-between gap-1.5">
                <button
                  onClick={handleArrowPrevExercise}
                  disabled={currentExerciseIdx === 0}
                  className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white disabled:opacity-20 transition-all flex items-center justify-center shrink-0 cursor-pointer"
                  title="Esercizio precedente"
                >
                  <ArrowPrev size={15} />
                </button>

                <div className="flex-1 min-w-0 text-center">
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-brand-orange">
                      Es. {currentExerciseIdx + 1} di {workout.exercises.length}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-lightOrange text-[9px] font-black uppercase font-mono tracking-wider">
                      {isPyramid
                        ? `Step ${currentPyramidStepIdx + 1} di ${currentExercise.pyramid_steps?.length || 1}`
                        : isEmom
                          ? `Round ${currentEmomRoundIdx + 1} di ${effectiveEmomRounds}`
                          : isCircuit
                            ? `Giro ${currentSetIdx + 1} di ${currentExercise.sets || 1}`
                            : isSuperset
                              ? `Round ${currentSetIdx + 1} di ${currentExercise.sets || 1}`
                              : `Set ${currentSetIdx + 1} di ${currentExercise.sets || 1}`}
                    </span>
                  </div>
                  <h2 className="text-lg sm:text-2xl font-black text-white leading-tight uppercase truncate mt-0.5">
                    {currentExercise.name}
                  </h2>
                </div>

                <button
                  onClick={handleArrowNextExercise}
                  className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white transition-all flex items-center justify-center shrink-0 cursor-pointer"
                  title="Prossimo esercizio"
                >
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>

            {/* Carico in pillola satinata */}
            <div className="flex items-center justify-center gap-2 my-1 shrink-0">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/10 text-white shadow-inner">
                <Dumbbell size={14} className="text-brand-orange shrink-0" />
                <span className="text-xs sm:text-sm font-mono font-black text-brand-lightOrange tracking-wide">
                  {isPyramid && currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.weight_kg != null
                    ? (currentExercise.pyramid_steps[currentPyramidStepIdx].weight_kg! > 0
                        ? `${currentExercise.pyramid_steps[currentPyramidStepIdx].weight_kg} KG`
                        : 'CORPO LIBERO')
                    : currentExecutionWeightLabel && currentExecutionWeightLabel !== '-'
                      ? currentExecutionWeightLabel.toUpperCase()
                      : 'CORPO LIBERO'}
                </span>
              </div>
              {!isSuperset && currentExercise.auto_count_type && (
                <button
                  onClick={() => setIsAutoCountModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:text-white text-[10px] font-bold cursor-pointer"
                >
                  <Video size={11} />
                  <span>AI Count</span>
                </button>
              )}
              {hasCurrentInstructionNote && (
                <button
                  onClick={openCurrentInstructionModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-orange/15 border border-brand-orange/30 text-brand-orange text-[10px] font-bold cursor-pointer"
                >
                  <Info size={11} />
                  <span>Info</span>
                </button>
              )}
            </div>

            {/* Timeline Compatta Set / Step / Round / Giri (S1 ✓, S2 🔥, S3, S4) */}
            <div className="my-1 overflow-x-auto no-scrollbar shrink-0">
              <div className="flex gap-1.5 justify-center items-center py-0.5">
                {isPyramid && currentExercise.pyramid_steps ? (
                  currentExercise.pyramid_steps.map((step, sIdx) => {
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
                        className={`py-1 px-2 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black cursor-pointer active:scale-95 ${
                          isCurrent
                            ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_12px_rgba(255,94,0,0.5)] ring-1 ring-brand-orange/70'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                        }`}
                        title={`Step ${sIdx + 1}`}
                      >
                        <span className="text-[10px] opacity-75">S{sIdx + 1}</span>
                        <span>{isDone ? '✓' : isCurrent ? '🔥' : `${step.reps}r`}</span>
                      </button>
                    );
                  })
                ) : isEmom ? (
                  Array.from({ length: effectiveEmomRounds }, (_, rIdx) => {
                    const isCurrent = rIdx === currentEmomRoundIdx;
                    const isDone = rIdx < currentEmomRoundIdx;
                    return (
                      <button
                        key={rIdx}
                        type="button"
                        onClick={() => {
                          void hapticLight();
                          setCurrentEmomRoundIdx(rIdx);
                        }}
                        className={`py-1 px-2 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black cursor-pointer active:scale-95 ${
                          isCurrent
                            ? isEmomRoundWorkFinished
                              ? 'bg-emerald-500/25 border-emerald-500 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.5)] ring-1 ring-emerald-500/70'
                              : 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_12px_rgba(255,94,0,0.5)] ring-1 ring-brand-orange/70'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                        }`}
                        title={`Round ${rIdx + 1}`}
                      >
                        <span className="text-[10px] opacity-75">R{rIdx + 1}</span>
                        <span>{isDone ? '✓' : isCurrent ? '🔥' : ''}</span>
                      </button>
                    );
                  })
                ) : isCircuit ? (
                  Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                    const isCurrent = sIdx === currentSetIdx;
                    const isDone = sIdx < currentSetIdx;
                    return (
                      <div
                        key={sIdx}
                        className={`py-1 px-2 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black ${
                          isCurrent
                            ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_12px_rgba(255,94,0,0.5)] ring-1 ring-brand-orange/70'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500'
                        }`}
                      >
                        <span className="text-[10px] opacity-75">G{sIdx + 1}</span>
                        <span>{isDone ? '✓' : isCurrent ? '🔥' : ''}</span>
                      </div>
                    );
                  })
                ) : (
                  Array.from({ length: currentExercise.sets || 1 }, (_, sIdx) => {
                    const isCurrent = sIdx === currentSetIdx;
                    const isDone = sIdx < currentSetIdx;
                    const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => openEditSpecificSetModal(sIdx)}
                        className={`py-1 px-2 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black cursor-pointer active:scale-95 ${
                          isCurrent
                            ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_12px_rgba(255,94,0,0.5)] ring-1 ring-brand-orange/70'
                            : isDone
                              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                              : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'
                        }`}
                        title={`Set ${sIdx + 1}`}
                      >
                        <span className="text-[10px] opacity-75">S{sIdx + 1}</span>
                        <span>
                          {isDone ? '✓' : isCurrent ? '🔥' : ''}
                          {logged != null && logged > 0 ? ` (${logged})` : ''}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Pyramid step silhouette if pyramid */}
            {isPyramid && (currentExercise.pyramid_steps?.length || 0) > 1 && (
              <div className="flex items-end justify-center gap-1.5 h-6 px-4 shrink-0 my-0.5">
                {currentExercise.pyramid_steps!.map((_pStep, barIdx) => {
                  const isCur = barIdx === currentPyramidStepIdx;
                  const isDone = barIdx < currentPyramidStepIdx;
                  const steps = currentExercise.pyramid_steps!;
                  const maxDist = Math.max(1, steps.length - 1);
                  const dist = Math.abs(barIdx - currentPyramidStepIdx);
                  const ratio = 1 - (dist / maxDist);
                  const barH = Math.round(8 + ratio * 14);
                  return (
                    <button
                      key={barIdx}
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setCurrentPyramidStepIdx(barIdx);
                      }}
                      className={`w-3.5 sm:w-4 rounded-t-sm transition-all cursor-pointer ${
                        isCur
                          ? 'bg-brand-orange shadow-[0_0_8px_rgba(255,94,0,0.7)]'
                          : isDone
                            ? 'bg-emerald-400/80'
                            : 'bg-white/20'
                      }`}
                      style={{ height: `${barH}px` }}
                    />
                  );
                })}
              </div>
            )}

            {/* Middle contextual list for multi-exercise types */}
            {isCircuit ? (
              <div className="flex-1 min-h-0 bg-black/40 border border-white/5 rounded-2xl p-2 my-1 overflow-y-auto no-scrollbar space-y-1">
                <div className="flex items-center justify-between pb-1 border-b border-white/5 text-[9px] font-black uppercase tracking-wider text-brand-orange">
                  <div className="flex items-center gap-1">
                    <Zap size={10} className="fill-brand-orange" />
                    <span>Roadmap Stazioni Circuito</span>
                  </div>
                  <span className="font-mono text-zinc-400 font-bold">{currentExercise.subExercises?.length || 0} stazioni</span>
                </div>
                {currentExercise.subExercises?.map((sub, idx) => (
                  <div key={idx} className="flex items-center justify-between p-1.5 rounded-xl bg-white/5 text-xs">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="w-4 h-4 rounded-full bg-brand-orange/20 text-brand-orange font-bold text-[9px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-white truncate text-xs">{sub.name}</span>
                    </div>
                    <span className="font-mono font-black text-brand-lightOrange text-xs shrink-0 ml-1">
                      {sub.type === 'reps' ? (sub.reps === 0 ? 'MAX' : `${sub.reps}r`) : `${sub.duration_seconds}s`}
                    </span>
                  </div>
                ))}
              </div>
            ) : isSuperset ? (
              <div className="flex-1 min-h-0 bg-black/40 border border-white/5 rounded-2xl p-2 my-1 overflow-y-auto no-scrollbar space-y-1">
                <div className="flex items-center justify-between pb-1 border-b border-white/5 text-[9px] font-black uppercase tracking-wider text-brand-orange">
                  <div className="flex items-center gap-1">
                    <Zap size={10} className="fill-brand-orange" />
                    <span>Sequenza Superset</span>
                  </div>
                  <span className="font-mono text-zinc-400 font-bold">No rest</span>
                </div>
                {currentExercise.subExercises?.map((sub, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-1.5 rounded-xl text-xs transition-all ${
                      idx === currentSubExerciseIdx
                        ? 'bg-brand-orange/20 border border-brand-orange/50 text-white shadow-sm'
                        : 'bg-white/5 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-mono font-black text-[10px] text-brand-orange">{idx + 1}.</span>
                      <span className="font-bold truncate text-xs">{sub.name}</span>
                    </div>
                    <span className="font-mono font-black text-brand-lightOrange text-xs shrink-0 ml-1">
                      {formatSupersetTaskMetricLabel(sub)}
                    </span>
                  </div>
                ))}
              </div>
            ) : isEmom && currentExercise.subExercises && currentExercise.subExercises.length > 0 ? (
              <div className="flex-1 min-h-0 bg-black/40 border border-white/5 rounded-2xl p-2 my-1 overflow-y-auto no-scrollbar space-y-1">
                {currentExercise.subExercises.map((sub, idx) => (
                  <div key={idx} className="flex items-center justify-between p-1.5 rounded-xl bg-white/5 text-xs">
                    <span className="font-bold text-white truncate text-xs">{idx + 1}. {sub.name}</span>
                    <span className="font-mono font-black text-brand-lightOrange text-xs shrink-0 ml-1">
                      {formatEmomTaskMetricLabel(sub)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="my-auto" />
            )}

            {/* Footer Left: Next Recovery preview */}
            <div className="pt-1 border-t border-white/5 flex items-center justify-between text-xs text-zinc-400 shrink-0">
              <span className="text-[10px] uppercase font-bold tracking-wider">
                {isEmom
                  ? 'Prossimo recupero'
                  : (currentExercise.sets === 1 || currentSetIdx >= (currentExercise.sets || 1) - 1)
                    ? 'Prossimo esercizio'
                    : 'Prossimo recupero'}
              </span>
              <span className="font-mono font-bold text-brand-orange text-xs">
                {isEmom
                  ? (currentEmomRoundIdx < effectiveEmomRounds - 1
                      ? `${emomRoundRemaining}s`
                      : (currentExercise.transition_rest_seconds ? `${currentExercise.transition_rest_seconds}s` : (nextRecoveryLabel || 'Fine Scheda')))
                  : (nextRecoveryLabel || 'Fine Scheda')}
              </span>
            </div>
          </div>

          {/* Metà Destra — Hero Action Stage: Ripetizioni / Timer in font-mono gigante & Tasto Primario Maxi */}
          <div className="flex flex-col justify-between bg-gradient-to-b from-[#1C1C1E]/95 via-[#1C1C1E]/70 to-[#121214] border border-white/10 rounded-3xl p-3 sm:p-3.5 min-h-0 shadow-2xl relative overflow-hidden items-center">
            {/* Dynamic Center Hero Display (NO STEPPERS!) */}
            {isPyramid ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center select-none my-auto">
                <span className="text-7xl sm:text-8xl font-black font-mono text-white leading-none tracking-tight drop-shadow-[0_0_35px_rgba(255,255,255,0.25)]">
                  {isMaxTarget(currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.reps || 0)
                    ? 'MAX'
                    : (currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.reps || 0)}
                </span>
                <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-2 sm:mt-3">
                  RIPETIZIONI STEP {currentPyramidStepIdx + 1}
                </span>
                {currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.rest_seconds ? (
                  <span className="text-xs font-mono font-bold text-brand-orange mt-1.5 flex items-center gap-1">
                    <Clock size={12} />
                    Recupero step: {currentExercise.pyramid_steps[currentPyramidStepIdx].rest_seconds}s
                  </span>
                ) : null}
              </div>
            ) : isEmom ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center select-none my-auto">
                <div
                  className="flex flex-col items-center cursor-pointer group"
                  onPointerDown={(event) => handleTimerPointerDown(event, resetEmomCountdown)}
                  onPointerUp={(event) => handleTimerPointerUp(event, handleEmomTimerTap)}
                  onPointerCancel={handleTimerPointerAbort}
                  onPointerLeave={handleTimerPointerAbort}
                  title="Tocca per avviare/pausa • Tieni premuto per azzerare"
                >
                  {/* Area Cifra Timer con Capsula dinamica (leggermente piu grande delle cifre e cancellata da destra a sinistra) */}
                  <div className="relative inline-flex items-center justify-center px-6 min-[390px]:px-7 py-2 min-[390px]:py-2.5 rounded-full select-none">
                    <div
                      className={`absolute inset-0 rounded-full pointer-events-none ${
                        emomRoundRemaining <= 3 && emomRoundRemaining > 0
                          ? 'bg-brand-orange/30 border-2 border-brand-orange animate-pulse'
                          : emomActive
                            ? 'bg-brand-orange/15 border border-brand-orange/35'
                            : 'bg-white/[0.06] border border-white/10'
                      }`}
                      style={{
                        clipPath: `inset(0 ${Math.max(0, Math.min(100, (1 - emomRoundProgressRatio) * 100))}% 0 0)`,
                        WebkitClipPath: `inset(0 ${Math.max(0, Math.min(100, (1 - emomRoundProgressRatio) * 100))}% 0 0)`,
                        transition: emomActive ? 'clip-path 1s linear, -webkit-clip-path 1s linear' : 'clip-path 300ms ease-out, -webkit-clip-path 300ms ease-out',
                      }}
                    />

                    <span
                      className={`relative z-10 text-5xl sm:text-6xl font-black font-mono leading-none tracking-tight transition-colors ${
                        emomRoundRemaining <= 3 && emomRoundRemaining > 0
                          ? 'text-brand-orange scale-105'
                          : emomActive
                            ? 'text-white'
                            : 'text-zinc-400'
                      }`}
                    >
                      {formatEmomTimer(emomRoundRemaining)}
                    </span>
                  </div>

                  <span className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-zinc-400 mt-2 z-10 flex items-center gap-1 font-mono">
                    <Timer size={11} className="text-brand-orange" />
                    {emomActive ? 'SECONDI RIMASTI' : 'IN PAUSA (TAP AVVIO)'}
                  </span>

                  <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider text-center mt-2">
                    Tocca per {emomActive ? 'pausa' : 'avvio'} • Tieni premuto per azzerare
                  </p>
                </div>
              </div>
            ) : isCircuit ? (
              <div
                className="flex-1 min-h-0 flex flex-col items-center justify-center select-none my-auto cursor-pointer group"
                onPointerDown={(event) => handleTimerPointerDown(event, resetCircuitStopwatch)}
                onPointerUp={(event) => handleTimerPointerUp(event, toggleCircuitStopwatch)}
                onPointerCancel={handleTimerPointerAbort}
                onPointerLeave={handleTimerPointerAbort}
                title="Tocca per avviare o mettere in pausa • Tieni premuto per azzerare"
              >
                <span className={`text-7xl sm:text-8xl font-black font-mono leading-none tracking-tight transition-all ${
                  isCircuitStopwatchRunning ? 'text-brand-orange drop-shadow-[0_0_35px_rgba(255,94,0,0.4)] animate-pulse' : 'text-white'
                }`}>
                  {formatTime(circuitStopwatchElapsed)}
                </span>
                <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-2 sm:mt-3 flex items-center gap-1.5">
                  <Timer size={13} className="text-brand-orange" />
                  {isCircuitStopwatchRunning ? 'CRONOMETRO GIRO (IN CORSO)' : (circuitStopwatchElapsed > 0 ? 'IN PAUSA' : 'CRONOMETRO GIRO')}
                </span>
                {circuitLapTimes.length > 0 && (
                  <span className="text-xs font-mono font-bold text-emerald-400 mt-1.5 flex items-center gap-1">
                    <Check size={12} strokeWidth={2.5} />
                    Giro {circuitLapTimes.length}: {formatTime(circuitLapTimes[circuitLapTimes.length - 1])}
                  </span>
                )}
              </div>
            ) : isSuperset ? (
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center select-none my-auto text-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-brand-orange block mb-1">
                  ESERCIZIO {currentSubExerciseIdx + 1} DI {currentExercise.subExercises?.length || 2}
                </span>
                <h3 className="text-base sm:text-xl font-black text-white truncate max-w-xs mb-1">
                  {subExercise?.name || currentExercise.subExercises?.[currentSubExerciseIdx]?.name}
                </h3>
                <span className="text-7xl sm:text-8xl font-black font-mono text-white leading-none tracking-tight drop-shadow-[0_0_35px_rgba(255,255,255,0.25)]">
                  {subExercise?.type === 'reps'
                    ? (isMaxTarget(subExercise.reps) ? 'MAX' : subExercise.reps)
                    : (isometryRemaining > 0 ? isometryRemaining : (subExercise?.duration_seconds || 0))}
                </span>
                <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-2">
                  {subExercise?.type === 'reps' ? 'RIPETIZIONI' : 'SECONDI'}
                </span>
              </div>
            ) : (currentExercise.type === 'isometry' || currentExercise.type === 'cardio') ? (
              <div
                className="flex-1 min-h-0 flex flex-col items-center justify-center select-none my-auto cursor-pointer group"
                onPointerDown={(event) => handleTimerPointerDown(event, resetIsometryCountdown)}
                onPointerUp={(event) => handleTimerPointerUp(event, handleIsometryTimerTap)}
                onPointerCancel={handleTimerPointerAbort}
                onPointerLeave={handleTimerPointerAbort}
                title="Tocca per avviare o mettere in pausa • Tieni premuto per azzerare"
              >
                <span className={`text-7xl sm:text-8xl font-black font-mono leading-none tracking-tight transition-all ${
                  isometryStopwatchActive || isometryActive ? 'text-brand-orange animate-pulse drop-shadow-[0_0_35px_rgba(255,94,0,0.5)]' : 'text-white'
                }`}>
                  {isMaxTarget(currentExercise.duration_seconds)
                    ? (isometryElapsedSeconds > 0 ? isometryElapsedSeconds : (getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 'MAX'))
                    : isometryRemaining}
                </span>
                <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-2 sm:mt-3 flex items-center gap-1.5">
                  <Timer size={13} className="text-brand-orange" />
                  {isMaxTarget(currentExercise.duration_seconds)
                    ? 'SECONDI A SFINIMENTO'
                    : (isometryActive ? 'SECONDI RIMASTI (IN CORSO)' : 'SECONDI (IN PAUSA)')}
                </span>
              </div>
            ) : (
              /* DEFAULT: STANDARD REPS (NO STEPPERS!) */
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center select-none my-auto">
                <span className="text-7xl sm:text-8xl font-black font-mono text-white leading-none tracking-tight drop-shadow-[0_0_35px_rgba(255,255,255,0.25)]">
                  {isMaxTarget(currentExercise.reps)
                    ? ((getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx) || 0) > 0
                        ? getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, currentSetIdx)
                        : 'MAX')
                    : formatBigTargetValue(currentExercise.reps)}
                </span>
                <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-2 sm:mt-3">
                  {isMaxTarget(currentExercise.reps) ? 'A SFINIMENTO (MAX REPS)' : 'RIPETIZIONI'}
                </span>
                {isMaxTarget(currentExercise.reps) && (
                  <button
                    type="button"
                    onClick={() => openEditSpecificSetModal(currentSetIdx)}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-lightOrange text-xs font-bold transition-all active:scale-95 cursor-pointer"
                  >
                    <Pencil size={11} />
                    <span>Inserisci reps eseguite</span>
                  </button>
                )}
              </div>
            )}

            {/* Tasto Primario Maxi a fondo schermo (Full width orange button) */}
            <div className="shrink-0 h-12 sm:h-14 w-full mt-2">
              <button
                onClick={handlePrimaryAction}
                className={`w-full h-full rounded-2xl font-black text-sm sm:text-base flex items-center justify-center transition-all active:scale-98 shadow-xl cursor-pointer tracking-wider ${
                  isFinalCompletionAction
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black shadow-emerald-500/25'
                    : 'bg-brand-orange hover:bg-brand-lightOrange text-black shadow-brand-orange/30'
                }`}
              >
                {isFinalCompletionAction ? (
                  <>
                    <CheckCircle2 size={20} className="mr-2" strokeWidth={2.5} />
                    TERMINA ALLENAMENTO
                  </>
                ) : isEmom && !isLastEmomRound ? (
                  <>PROSSIMO ROUND <ArrowRight size={18} className="ml-2" /></>
                ) : isEmom && isLastEmomRound ? (
                  <>COMPLETA SERIE</>
                ) : isPyramid && !isLastPyramidStep ? (
                  <>PROSSIMO STEP <ArrowRight size={18} className="ml-2" /></>
                ) : isCircuit ? (
                  isLastSet
                    ? <>COMPLETA CIRCUITO <ArrowRight size={18} className="ml-2" /></>
                    : <>FINE GIRO {currentSetIdx + 1} & RECUPERO <ArrowRight size={18} className="ml-2" /></>
                ) : isSuperset ? (
                  isLastSet
                    ? <>PROSSIMO ESERCIZIO <ArrowRight size={18} className="ml-2" /></>
                    : currentExercise.rest_seconds > 0
                      ? <>FINE ROUND & RECUPERO <ArrowRight size={18} className="ml-2" /></>
                      : <>PROSSIMO ROUND <ArrowRight size={18} className="ml-2" /></>
                ) : isLastSet ? (
                  <>PROSSIMO ESERCIZIO <ArrowRight size={18} className="ml-2" /></>
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

    const {
      isTransitioning,
      targetExercise,
      targetExerciseName,
      nextStepIdx,
      nextSetIdx,
      nextEmomRoundIdx,
      targetType,
      isTargetPyramid,
      isTargetEmom,
      isTargetSuperset,
      isTargetCircuit,
      isTargetIsometry,
      totalEmomRoundsNumber,
      targetGoalText,
      targetWeightText,
      targetSubExercises,
      targetInstruction,
      restProgressRatio,
    } = getRestTargetDetails();
    const isGroupType = isTargetSuperset || isTargetCircuit;

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
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 hover:border-white/20 active:scale-95 transition-all shadow-[0_2px_10px_rgba(0,0,0,0.5)] cursor-pointer group"
            title="Lista esercizi"
          >
            <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-orange opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-orange shadow-[0_0_6px_rgba(255,94,0,0.9)]" />
            </span>
            <span className="text-xs font-mono font-bold text-zinc-200 tracking-tight">
              {currentExerciseIdx + 1} di {workout.exercises.length}
            </span>
            {hasGeneralWorkoutNote && (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
            )}
            <List size={13} className="text-zinc-400 group-hover:text-white transition-colors shrink-0" />
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

        {/* Global Workout Progress Line */}
        <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden shrink-0 mt-0.5 mb-1">
          <div
            className="bg-brand-orange h-full rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(255,107,0,0.5)]"
            style={{ width: `${((currentExerciseIdx + 1) / workout.exercises.length) * 100}%` }}
          />
        </div>

        {/* Central Rest Area: Big Fixed Hero Timer + Scrollable Target Dossier Card */}
        <div className="flex-1 min-h-0 flex flex-col items-center w-full max-w-md mx-auto gap-2 py-0.5 overflow-hidden">
          {/* Hero Countdown Timer — Prominent & High-Readability from a Distance */}
          <div className="shrink-0 flex flex-col items-center w-full pt-1 pb-1">
            <div
              className={`relative w-[min(84vw,38vh,300px)] h-[min(84vw,38vh,300px)] sm:w-[340px] sm:h-[340px] rounded-full flex flex-col justify-center items-center cursor-pointer select-none transition-all duration-300 overflow-hidden ${
                restRemaining <= 3 && restRemaining > 0
                  ? 'border-4 border-brand-orange ring-4 ring-brand-orange/60 shadow-[0_0_60px_rgba(255,94,0,0.7)] animate-pulse bg-brand-orange/10'
                  : 'border border-white/10 shadow-[0_0_40px_rgba(255,94,0,0.20)] bg-gradient-to-b from-black/85 via-black/70 to-zinc-950/90'
              }`}
              onPointerDown={(event) => handleTimerPointerDown(event, resetRestCountdown)}
              onPointerUp={(event) => handleTimerPointerUp(event, handleRestTimerTap)}
              onPointerCancel={handleTimerPointerAbort}
              onPointerLeave={handleTimerPointerAbort}
              title="Tocca per pausa/avvio • Tieni premuto per azzerare"
            >
              {/* Circular SVG Progress Ring */}
              <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none p-1.5 sm:p-2" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeWidth="5"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  stroke={restRemaining <= 3 && restRemaining > 0 ? '#FF7724' : '#FF5E00'}
                  strokeWidth="5.5"
                  strokeDasharray={2 * Math.PI * 44}
                  strokeDashoffset={2 * Math.PI * 44 * (1 - restProgressRatio)}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear shadow-[0_0_14px_rgba(255,94,0,0.8)]"
                />
              </svg>

              {/* Countdown Digits — Extra Large Hero, Perfectly Centered */}
              <span
                className={`text-6xl min-[380px]:text-7xl sm:text-8xl font-black z-10 font-mono tracking-tighter tabular-nums leading-none select-none transition-colors duration-300 ${
                  restRemaining <= 3 && restRemaining > 0
                    ? 'text-brand-orange drop-shadow-[0_0_24px_rgba(255,94,0,0.85)]'
                    : restEndsAtMs != null
                      ? 'text-white drop-shadow-[0_2px_18px_rgba(255,94,0,0.35)]'
                      : 'text-zinc-300'
                }`}
              >
                {formatTime(restRemaining)}
              </span>

              {/* Scritta "PAUSA" dentro al cerchio sotto i numeri, posizionata in modo assoluto per non spostare nessun elemento */}
              {restEndsAtMs == null && (
                <div className="absolute bottom-[16%] left-0 right-0 flex justify-center z-10 pointer-events-none animate-in fade-in duration-200">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] sm:text-xs font-mono font-black tracking-widest uppercase shadow-sm">
                    PAUSA
                  </span>
                </div>
              )}
            </div>

            {/* Clear Tool Instructions & PiP */}
            <div className="flex items-center justify-center gap-2 mt-1 sm:mt-1.5 flex-wrap">
              <p className="text-[10px] sm:text-[11px] text-zinc-400 font-bold uppercase tracking-wider text-center">
                Tocca per {restEndsAtMs != null ? 'mettere in pausa' : 'avviare'} • Tieni premuto per azzerare
              </p>

              {pipManager.isSupported() && (
                <button
                  type="button"
                  onClick={handleTogglePiP}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-brand-orange/30 bg-brand-darkGrey/60 hover:bg-brand-orange/20 text-brand-orange text-[10px] font-bold transition-all shadow-sm cursor-pointer"
                  title="Mostra timer flottante sopra altre app (PiP)"
                >
                  <Layers size={11} />
                  <span>{pipManager.isActive() ? 'Chiudi PiP' : 'PiP'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Next Target Dossier Card (Independently Scrollable to inspect all exercise/step characteristics) */}
          <div className="flex-1 min-h-0 w-full bg-gradient-to-b from-[#1C1C1E] to-[#141416] border border-white/10 rounded-3xl p-3 sm:p-3.5 shadow-xl flex flex-col overflow-hidden">
            {/* Header: Prossimo Set vs Prossimo Esercizio (Pinned at top of card) */}
            <div className="shrink-0 pb-2 border-b border-white/5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-brand-orange flex items-center gap-1.5">
                  <ArrowRight size={13} className="text-brand-orange shrink-0" />
                  {isTransitioning ? 'Prossimo Esercizio' : 'Prossimo Set'}
                </span>
                {isTransitioning && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] sm:text-[11px] font-mono font-bold text-zinc-300 uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                      Es. {currentExerciseIdx + 2} di {workout.exercises.length}
                    </span>
                  </div>
                )}
              </div>

              {/* Exercise Name & Type Badge */}
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-tight truncate">
                  {targetExerciseName}
                </h3>
                {!isTargetSuperset && !isTargetEmom && (
                  <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand-orange/15 text-brand-orange border border-brand-orange/30 shrink-0 font-mono">
                    {targetType.toUpperCase()}
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable Body: All characteristics of the upcoming exercise/step */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2 pr-0.5 space-y-2.5 custom-scroll-area">
              {/* Caratteristiche Prossimo Set / Esercizio */}
              {!isGroupType ? (
                <div className={`grid ${isTargetEmom ? 'grid-cols-1' : (isTransitioning ? 'grid-cols-3' : 'grid-cols-2')} gap-1.5 shrink-0`}>
                  {/* Box 1: Target / Reps */}
                  <div className="bg-black/50 border border-white/5 rounded-2xl p-2 flex flex-col justify-center">
                    <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                      {isTargetIsometry ? 'Tenuta' : 'Target'}
                    </span>
                    <span className="text-xs sm:text-sm font-black text-white font-mono mt-0.5 truncate">
                      {targetGoalText}
                    </span>
                  </div>

                  {/* Box 2: Carico */}
                  {!isTargetEmom && (
                    <div className="bg-black/50 border border-white/5 rounded-2xl p-2 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">Carico</span>
                      <span className="text-xs sm:text-sm font-black text-brand-orange font-mono mt-0.5 truncate">
                        {targetWeightText}
                      </span>
                    </div>
                  )}

                  {/* Box 3: Serie Totali (solo quando si passa a un nuovo esercizio, nessun campo Recupero) */}
                  {isTransitioning && !isTargetEmom && (
                    <div className="bg-black/50 border border-white/5 rounded-2xl p-2 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                        Serie Totali
                      </span>
                      <span className="text-xs sm:text-sm font-black text-zinc-200 font-mono mt-0.5 truncate">
                        {isTargetPyramid
                          ? `${targetExercise.pyramid_steps?.length || 0} Step`
                          : `${targetExercise.sets} Serie`}
                      </span>
                    </div>
                  )}
                </div>
              ) : isTransitioning ? (
                <div className="bg-black/50 border border-white/5 rounded-2xl p-2 flex items-center justify-between shrink-0">
                  <span className="text-[9px] uppercase font-bold text-zinc-400 tracking-wider">
                    {isTargetCircuit ? 'Giri Totali' : 'Serie Totali'}
                  </span>
                  <span className="text-xs sm:text-sm font-black text-zinc-200 font-mono">
                    {targetExercise.sets} {isTargetCircuit ? 'Giri' : 'Serie'}
                  </span>
                </div>
              ) : null}

              {/* Timeline Grafica Serie */}
              {!isTargetEmom && (
              <div className="pt-0.5 shrink-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  {isTransitioning ? 'Serie Prossimo Esercizio:' : 'Progressione Serie:'}
                </span>
                <div className="flex gap-1.5 items-center overflow-x-auto no-scrollbar py-0.5">
                  {isTargetPyramid && targetExercise.pyramid_steps ? (
                    targetExercise.pyramid_steps.map((step, sIdx) => {
                      const isUpcoming = isTransitioning ? sIdx === 0 : sIdx === nextStepIdx;
                      const isDone = isTransitioning ? false : sIdx <= currentPyramidStepIdx;
                      return (
                        <div
                          key={sIdx}
                          className={`w-14 h-14 sm:w-16 sm:h-16 aspect-square rounded-2xl border text-center transition-all flex flex-col items-center justify-center relative shrink-0 select-none ${
                            isUpcoming
                              ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_12px_rgba(255,94,0,0.45)] ring-1 ring-brand-orange/70'
                              : isDone
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                : 'bg-white/5 border-white/5 text-zinc-400'
                          }`}
                          title={`Step ${sIdx + 1}: ${step.reps === 0 ? 'MAX' : step.reps} reps${step.weight_kg ? ` @ ${step.weight_kg}kg` : ''}`}
                        >
                          {isDone && (
                            <span className="absolute top-1 right-1.5 text-[9px] font-black text-emerald-400 leading-none">
                              ✓
                            </span>
                          )}
                          {isUpcoming && (
                            <span className="absolute top-1 right-1.5 text-[8px] leading-none">
                              ⏳
                            </span>
                          )}
                          <span className="text-base sm:text-lg font-black font-mono leading-none tracking-tight">
                            {step.reps === 0 ? 'MAX' : step.reps}
                          </span>
                          <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider leading-none mt-1 opacity-75">
                            reps
                          </span>
                        </div>
                      );
                    })
                  ) : isTargetCircuit ? (
                    Array.from({ length: targetExercise.sets || 1 }, (_, sIdx) => {
                      const isUpcoming = isTransitioning ? sIdx === 0 : sIdx === nextSetIdx;
                      const isDone = isTransitioning ? false : sIdx <= currentSetIdx;
                      return (
                        <div
                          key={sIdx}
                          className={`py-1 px-2.5 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black shrink-0 ${
                            isUpcoming
                              ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_10px_rgba(255,94,0,0.4)] ring-1 ring-brand-orange/60'
                              : isDone
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                : 'bg-white/5 border-white/5 text-zinc-500'
                          }`}
                        >
                          <span className="text-[10px] opacity-75">{sIdx + 1}</span>
                          <span>{isDone ? '✓' : isUpcoming ? '⏳' : ''}</span>
                        </div>
                      );
                    })
                  ) : isTargetEmom ? (
                    Array.from({ length: targetExercise.emom_rounds || totalEmomRoundsNumber || 1 }, (_, rIdx) => {
                      const isUpcoming = isTransitioning ? rIdx === 0 : rIdx === nextEmomRoundIdx;
                      const isDone = isTransitioning ? false : rIdx <= currentEmomRoundIdx;
                      return (
                        <div
                          key={rIdx}
                          className={`py-1 px-2.5 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black shrink-0 ${
                            isUpcoming
                              ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_10px_rgba(255,94,0,0.4)] ring-1 ring-brand-orange/60'
                              : isDone
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                : 'bg-white/5 border-white/5 text-zinc-500'
                          }`}
                        >
                          <span className="text-[10px] opacity-75">{rIdx + 1}</span>
                          <span>{isDone ? '✓' : isUpcoming ? '⏳' : ''}</span>
                        </div>
                      );
                    })
                  ) : (
                    Array.from({ length: targetExercise.sets || 1 }, (_, sIdx) => {
                      const isUpcoming = isTransitioning ? sIdx === 0 : sIdx === nextSetIdx;
                      const isDone = isTransitioning ? false : sIdx <= currentSetIdx;
                      const logged = !isTransitioning ? getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx) : null;
                      return (
                        <button
                          key={sIdx}
                          type="button"
                          disabled={isTransitioning || !isDone}
                          onClick={() => {
                            if (!isTransitioning && isDone) {
                              openEditSpecificSetModal(sIdx);
                            }
                          }}
                          className={`py-1 px-2.5 rounded-xl border text-center transition-all flex items-center gap-1 font-mono text-xs font-black shrink-0 ${
                            isUpcoming
                              ? 'bg-brand-orange/25 border-brand-orange text-white shadow-[0_0_10px_rgba(255,94,0,0.4)] ring-1 ring-brand-orange/60'
                              : isDone
                                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 cursor-pointer active:scale-95'
                                : 'bg-white/5 border-white/5 text-zinc-500'
                          }`}
                          title={isDone ? `Modifica reps set ${sIdx + 1}` : `Set ${sIdx + 1}`}
                        >
                          <span className="text-[10px] opacity-75">{sIdx + 1}</span>
                          <span>
                            {isDone ? '✓' : isUpcoming ? '⏳' : ''}
                            {logged != null && logged > 0 ? ` (${logged})` : ''}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              )}

              {/* Elenco Completo Sub-Esercizi se Superset / Circuito / EMOM */}
              {targetSubExercises.length > 0 && (
                <div className="bg-black/50 border border-white/5 rounded-2xl p-2.5 space-y-1.5">
                  {!isTargetSuperset && !isTargetEmom && (
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                        Sequenza Round ({targetSubExercises.length} Esercizi):
                      </span>
                      <span className="text-[9px] font-mono text-brand-orange font-bold">
                        Senza recupero tra es.
                      </span>
                    </div>
                  )}
                  {targetSubExercises.map((sub, idx) => (
                    <div key={idx} className="flex flex-col py-1 border-b border-white/5 last:border-0 gap-0.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0 pr-2">
                          <span className="w-4 h-4 rounded-full bg-white/10 text-zinc-300 font-mono text-[9px] flex items-center justify-center font-bold shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-white font-bold truncate text-[11px] sm:text-xs">{sub.name}</span>
                        </div>
                        <span className="text-brand-orange font-mono font-bold text-[10px] sm:text-[11px] shrink-0">
                          {sub.type === 'isometry'
                            ? (isMaxTarget(sub.duration_seconds) ? 'MAX' : `${sub.duration_seconds}s`)
                            : (isMaxTarget(sub.reps) ? 'MAX' : `${sub.reps} reps`)} • {formatWeightLabel(sub.weight_kg)}
                        </span>
                      </div>
                      {sub.instruction_note && (
                        <p className="text-[10px] text-zinc-400 italic pl-5">
                          {sub.instruction_note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Note di esecuzione se presenti */}
              {targetInstruction && (
                <div className="bg-brand-orange/10 border border-brand-orange/25 rounded-2xl p-2.5 flex items-start gap-2">
                  <Info size={14} className="text-brand-orange shrink-0 mt-0.5" />
                  <div className="text-[11px] text-zinc-200 leading-snug">
                    <span className="font-bold text-brand-orange block text-[9px] uppercase tracking-wider mb-0.5">
                      Note Esecuzione:
                    </span>
                    {targetInstruction}
                  </div>
                </div>
              )}

              {/* Badge Contatore Automatico Camera se supportato */}
              {targetExercise.auto_count_type && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-2.5 flex items-center gap-2">
                  <Video size={14} className="text-brand-orange shrink-0" />
                  <span className="text-[11px] text-zinc-300 font-medium">
                    Contatore automatico fotocamera disponibile ({targetExercise.auto_count_type === 'pushups' ? 'Piegamenti' : 'Trazioni'})
                  </span>
                </div>
              )}

              {/* Riepilogo prestazione per MAX se applicabile */}
              {!isTransitioning && isMaxPerformance(currentExercise) && (
                <div className="bg-black/50 border border-brand-orange/30 rounded-2xl p-2.5 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-zinc-400 block">
                      Ultimo Set {currentSetIdx + 1} (A Sfinimento)
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
                    className="px-2.5 py-1 rounded-xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange text-xs font-bold transition-all border border-brand-orange/30 flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={11} />
                    <span>Modifica</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="shrink-0 h-[58px] sm:h-[66px] flex items-stretch gap-2.5 sm:gap-3 mt-1">
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
            className="flex-1 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center transition-all border border-white/10 shadow-lg cursor-pointer"
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
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 hover:border-white/20 active:scale-95 transition-all shadow-[0_2px_10px_rgba(0,0,0,0.5)] cursor-pointer group"
            title="Lista esercizi"
          >
            <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-orange opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-orange shadow-[0_0_6px_rgba(255,94,0,0.9)]" />
            </span>
            <span className="text-xs font-mono font-bold text-zinc-200 tracking-tight">
              {currentExerciseIdx + 1} di {workout.exercises.length}
            </span>
            {hasGeneralWorkoutNote && (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" title="Note generali scheda presenti" />
            )}
            <List size={13} className="text-zinc-400 group-hover:text-white transition-colors shrink-0" />
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

              {(specialExerciseLabel || (!isSuperset && currentExercise.auto_count_type)) && (
                <div className="flex items-center gap-1.5 mt-1 flex-wrap justify-center">
                  {specialExerciseLabel && (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${specialExercisePillClass}`}>
                      {specialExerciseLabel}
                    </span>
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
              )}
            </div>

            <button
              onClick={handleArrowNextExercise}
              className="w-11 h-11 bg-brand-darkGrey/80 rounded-2xl text-zinc-300 hover:text-white transition-all active:scale-95 shrink-0 border border-white/10 flex items-center justify-center shadow-md"
              title="Prossimo esercizio"
            >
              <ArrowRight size={20} />
            </button>
          </div>

        </div>

        {/* ZONE 3: CENTRAL FOCUS AREA (Rich, Screen-Filling Dashboard Card) */}
        <div className="flex-1 min-h-0 w-full max-w-lg mx-auto flex flex-col justify-between my-1 bg-gradient-to-b from-brand-darkGrey/90 via-brand-darkGrey/60 to-brand-darkGrey/40 border border-white/10 rounded-3xl p-4 sm:p-5 shadow-2xl backdrop-blur-sm">
          {/* Top HUD Chips */}
          {isSuperset ? (
            <div className="w-full shrink-0 mb-2">
              <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">
                  Round
                </span>
                <span className="text-brand-orange font-mono font-black text-base sm:text-lg">
                  {`${currentSetIdx + 1} / ${currentExercise.sets || 1}`}
                </span>
              </div>
            </div>
          ) : (currentExercise.type === 'isometry' || currentExercise.type === 'cardio') ? (
            <div className="w-full grid grid-cols-2 gap-2.5 shrink-0 mb-2">
              <div className="bg-black/50 border border-white/5 rounded-2xl py-2 px-2 text-center">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 block font-semibold">
                  Set
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
            </div>
          ) : null}

          {/* DYNAMIC MODE VIEW (Fills the center of the card richly) */}
          <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center">
            {currentExercise.type === 'emom' ? (
              (() => {
                const hasEmomTasks = Boolean(currentExercise.subExercises && currentExercise.subExercises.length > 0);
                const roundDuration = currentExercise.emom_round_duration || 60;

                return (
                  <div className="w-full flex-1 min-h-0 flex flex-col justify-between items-center">
                    {/* Horizontal Round Timeline Carousel */}
                    <div
                      ref={emomScrollContainerRef}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      className="w-full flex gap-3.5 sm:gap-4 overflow-x-auto no-scrollbar py-2 sm:py-3 px-[calc(50%-130px)] min-[390px]:px-[calc(50%-140px)] sm:px-[calc(50%-155px)] scroll-smooth snap-x snap-mandatory items-center my-auto"
                      style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                      {Array.from({ length: effectiveEmomRounds }, (_, rIdx) => {
                        const isCurrent = rIdx === currentEmomRoundIdx;
                        const isCompleted = rIdx < currentEmomRoundIdx;

                        if (isCurrent) {
                          return (
                            <div
                              key={rIdx}
                              ref={activeEmomRoundCardRef}
                              className={`shrink-0 w-[260px] min-[390px]:w-[280px] sm:w-[310px] h-[340px] min-[390px]:h-[370px] sm:h-[400px] p-4 min-[390px]:p-5 sm:p-6 rounded-3xl border-2 transition-all duration-300 z-10 snap-center select-none flex flex-col justify-between ${
                                isEmomRoundWorkFinished
                                  ? 'border-emerald-500 bg-gradient-to-b from-[#062c20] via-[#041a13] to-[#121214] text-white shadow-[0_0_35px_rgba(16,185,129,0.35)] ring-1 ring-emerald-500/60'
                                  : emomRoundRemaining <= 3 && emomRoundRemaining > 0
                                    ? 'border-brand-orange bg-gradient-to-b from-[#3a1805] via-[#200e04] to-[#121214] text-white shadow-[0_0_40px_rgba(255,94,0,0.5)] ring-2 ring-brand-orange/80 animate-pulse'
                                    : 'border-brand-orange bg-gradient-to-b from-[#2d1405] via-[#1a0c04] to-[#121214] text-white shadow-[0_0_35px_rgba(255,94,0,0.35)] ring-1 ring-brand-orange/60'
                              } scale-[1.02]`}
                            >
                              {/* Header della card: ROUND X DI Y con badge pulsante In Corso / In Riposo e durata */}
                              <div className={`flex items-center justify-between gap-2 pb-2 border-b shrink-0 ${
                                isEmomRoundWorkFinished ? 'border-emerald-500/20' : 'border-brand-orange/20'
                              }`}>
                                <div className="flex flex-col text-left">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-xs sm:text-sm font-black font-mono tracking-wider uppercase ${
                                      isEmomRoundWorkFinished ? 'text-emerald-400' : 'text-brand-orange'
                                    }`}>
                                      ROUND {rIdx + 1}
                                    </span>
                                    <span className="text-[11px] sm:text-xs font-mono text-zinc-400">
                                      / {effectiveEmomRounds}
                                    </span>
                                  </div>
                                  {currentExercise.sets && currentExercise.sets > 1 ? (
                                    <span className="text-[10px] text-zinc-400 font-mono font-medium">
                                      Set {currentSetIdx + 1}/{currentExercise.sets}
                                    </span>
                                  ) : null}
                                </div>

                                {isEmomRoundWorkFinished ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                                    In Riposo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-lightOrange text-[10px] font-black uppercase tracking-wider">
                                    <span className={`w-1.5 h-1.5 rounded-full bg-brand-orange ${emomActive ? 'animate-ping' : ''}`} />
                                    {emomActive ? 'In Corso' : 'In Pausa'}
                                  </span>
                                )}
                              </div>

                              {/* Timer integrato: Countdown con Capsula dinamica di progressione posizionata dietro la cifra */}
                              <div
                                className="my-auto py-1 flex flex-col items-center justify-center cursor-pointer select-none group"
                                onPointerDown={(event) => handleTimerPointerDown(event, resetEmomCountdown)}
                                onPointerUp={(event) => handleTimerPointerUp(event, handleEmomTimerTap)}
                                onPointerCancel={handleTimerPointerAbort}
                                onPointerLeave={handleTimerPointerAbort}
                                title="Tocca per avviare/mettere in pausa • Tieni premuto per azzerare"
                              >
                                {/* Area Cifra Timer con Capsula dinamica posizionata dietro (leggermente piu grande delle cifre e cancellata da destra a sinistra) */}
                                <div className="relative inline-flex items-center justify-center px-6 min-[390px]:px-7 py-2 min-[390px]:py-2.5 rounded-full select-none">
                                  {/* Capsula di progressione che si adatta alle cifre e viene progressivamente cancellata da destra verso sinistra */}
                                  <div
                                    className={`absolute inset-0 rounded-full pointer-events-none ${
                                      isEmomRoundWorkFinished
                                        ? 'bg-emerald-500/20 border border-emerald-500/40'
                                        : emomRoundRemaining <= 3 && emomRoundRemaining > 0
                                          ? 'bg-brand-orange/30 border-2 border-brand-orange animate-pulse'
                                          : emomActive
                                            ? 'bg-brand-orange/15 border border-brand-orange/35'
                                            : 'bg-white/[0.06] border border-white/10'
                                    }`}
                                    style={{
                                      clipPath: `inset(0 ${Math.max(0, Math.min(100, (1 - emomRoundProgressRatio) * 100))}% 0 0)`,
                                      WebkitClipPath: `inset(0 ${Math.max(0, Math.min(100, (1 - emomRoundProgressRatio) * 100))}% 0 0)`,
                                      transition: emomActive ? 'clip-path 1s linear, -webkit-clip-path 1s linear' : 'clip-path 300ms ease-out, -webkit-clip-path 300ms ease-out',
                                    }}
                                  />

                                  <span
                                    className={`relative z-10 text-6xl min-[390px]:text-7xl sm:text-8xl font-mono font-black tracking-tight leading-none transition-colors ${
                                      isEmomRoundWorkFinished
                                        ? 'text-emerald-400'
                                        : emomRoundRemaining <= 3 && emomRoundRemaining > 0
                                          ? 'text-brand-orange scale-105'
                                          : emomActive
                                            ? 'text-white'
                                            : 'text-zinc-400'
                                    }`}
                                  >
                                    {formatEmomTimer(emomRoundRemaining)}
                                  </span>
                                </div>

                                <span className={`text-[10px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1 mt-1 ${
                                  isEmomRoundWorkFinished
                                    ? 'text-emerald-400'
                                    : emomActive
                                      ? 'text-zinc-400'
                                      : 'text-zinc-500'
                                }`}>
                                  <Timer size={12} className={isEmomRoundWorkFinished ? 'text-emerald-400' : 'text-brand-orange'} />
                                  {isEmomRoundWorkFinished
                                    ? `Recupero Guadagnato (${emomRoundRemaining}s)`
                                    : emomActive
                                      ? 'Secondi Rimasti'
                                      : 'In Pausa (Tocca per avvio)'}
                                </span>
                              </div>

                              {/* Blocco Lavoro del Round */}
                              <div className="shrink-0 mb-2">
                                {hasEmomTasks ? (
                                  /* Multi-esercizio: satin frosted box compatto */
                                  <div className="bg-black/50 border border-white/10 rounded-2xl p-2.5 sm:p-3 text-left shadow-sm">
                                    <div className="space-y-1.5 max-h-[82px] overflow-y-auto no-scrollbar">
                                      {currentExercise.subExercises!.map((sub, sIdx) => (
                                        <div key={sIdx} className="flex items-center justify-between gap-2 text-xs">
                                          <div className="flex items-center gap-1.5 truncate">
                                            <span className="w-4 h-4 rounded-full bg-white/10 text-zinc-300 font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                                              {sIdx + 1}
                                            </span>
                                            <span className="text-white font-bold truncate">
                                              {sub.name}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0 font-mono">
                                            <span className="font-black text-brand-lightOrange text-xs">
                                              {formatEmomTaskMetricLabel(sub)}
                                            </span>
                                            {sub.weight_kg != null && sub.weight_kg > 0 ? (
                                              <span className="text-[10px] text-zinc-400 font-semibold">
                                                • {formatWeightLabel(sub.weight_kg)}
                                              </span>
                                            ) : (
                                              <span className="text-[9px] text-zinc-500">
                                                • Bodyweight
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  /* Singolo esercizio: reps e kg puliti al centro */
                                  <div className="bg-black/40 border border-white/10 rounded-2xl p-2.5 sm:p-3 text-center shadow-sm">
                                    <span className="text-[9px] min-[390px]:text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">
                                      Obiettivo del Round
                                    </span>
                                    <div className="flex items-center justify-center gap-2">
                                      <span className="text-xl min-[390px]:text-2xl font-mono font-black text-white">
                                        {currentExercise.reps === 0 ? 'MAX REPS' : `${currentExercise.reps} REPS`}
                                      </span>
                                      <span className="text-zinc-500 font-bold">•</span>
                                      <span className="text-sm min-[390px]:text-base font-mono font-black text-brand-lightOrange">
                                        {currentExercise.weight_kg != null && currentExercise.weight_kg > 0
                                          ? formatWeightLabel(currentExercise.weight_kg)
                                          : 'Corpo libero'}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>


                            </div>
                          );
                        }

                        if (isCompleted) {
                          return (
                            <div
                              key={rIdx}
                              onClick={() => {
                                void hapticLight();
                                stopEmomCountdown();
                                setCurrentEmomRoundIdx(rIdx);
                                setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
                              }}
                              className="shrink-0 w-[170px] min-[390px]:w-[185px] sm:w-[200px] h-[290px] min-[390px]:h-[320px] sm:h-[350px] p-4 sm:p-5 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.14] text-left transition-all snap-center cursor-pointer select-none flex flex-col justify-between shadow-sm active:scale-[0.98]"
                              title={`Round ${rIdx + 1} completato - Tocca per tornare a questo round`}
                            >
                              <div className="flex items-center justify-between gap-1 pb-2 border-b border-emerald-500/20 shrink-0">
                                <span className="text-xs sm:text-sm font-black font-mono text-zinc-300 uppercase tracking-wider">
                                  ROUND {rIdx + 1}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                                  <Check size={12} strokeWidth={3} />
                                  Concluso
                                </span>
                              </div>

                              <div className="my-auto py-1 flex flex-col items-center justify-center text-center">
                                <span className="text-4xl min-[390px]:text-5xl font-mono font-black text-emerald-400 leading-none">
                                  ✓
                                </span>
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-400/90 mt-1.5">
                                  Completato
                                </span>
                                {hasEmomTasks ? (
                                  <span className="text-[10px] text-zinc-400 font-mono mt-1">
                                    {currentExercise.subExercises?.length} esercizi
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-zinc-400 font-mono mt-1">
                                    {currentExercise.reps === 0 ? 'MAX reps' : `${currentExercise.reps} reps`}
                                  </span>
                                )}
                              </div>

                              <div className="shrink-0 pt-2 border-t border-emerald-500/20">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void hapticLight();
                                    stopEmomCountdown();
                                    setCurrentEmomRoundIdx(rIdx);
                                    setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
                                  }}
                                  className="w-full py-1.5 px-2 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                                  title={`Torna al Round ${rIdx + 1}`}
                                >
                                  <ArrowPrev size={13} strokeWidth={2.5} />
                                  <span>Torna a questo round</span>
                                </button>
                              </div>
                            </div>
                          );
                        }

                        // Upcoming Round with Jump Button
                        return (
                          <div
                            key={rIdx}
                            onClick={() => {
                              void hapticLight();
                              stopEmomCountdown();
                              setCurrentEmomRoundIdx(rIdx);
                              setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
                            }}
                            className="shrink-0 w-[170px] min-[390px]:w-[185px] sm:w-[200px] h-[290px] min-[390px]:h-[320px] sm:h-[350px] p-4 sm:p-5 rounded-3xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/20 text-left transition-all snap-center select-none flex flex-col justify-between shadow-sm cursor-pointer active:scale-[0.98]"
                            title={`Passa al Round ${rIdx + 1}`}
                          >
                            <div className="flex items-center justify-between gap-1 pb-2 border-b border-white/10 shrink-0">
                              <span className="text-xs sm:text-sm font-black font-mono text-zinc-300 uppercase tracking-wider">
                                ROUND {rIdx + 1}
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-zinc-400 text-[9px] font-black uppercase tracking-wider">
                                {rIdx === effectiveEmomRounds - 1 ? 'Ultimo' : 'In attesa'}
                              </span>
                            </div>

                            <div className="my-auto py-1 flex flex-col items-center justify-center text-center">
                              <span className="text-4xl min-[390px]:text-5xl font-mono font-black text-zinc-400 leading-none">
                                {formatEmomTimer(roundDuration)}
                              </span>
                              {hasEmomTasks ? (
                                <span className="text-[10px] text-zinc-500 font-mono mt-1">
                                  {currentExercise.subExercises?.length} esercizi
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-500 font-mono mt-1">
                                  {currentExercise.reps === 0 ? 'MAX reps' : `${currentExercise.reps} reps`}
                                </span>
                              )}
                            </div>

                            <div className="shrink-0 pt-2 border-t border-white/10">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void hapticLight();
                                  stopEmomCountdown();
                                  setCurrentEmomRoundIdx(rIdx);
                                  setEmomRoundRemainingWithSync(currentExercise.emom_round_duration || 60);
                                }}
                                className="w-full py-1.5 px-2 rounded-2xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange border border-brand-orange/35 text-[11px] font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                                title={`Passa al Round ${rIdx + 1}`}
                              >
                                <span>Passa a questo round</span>
                                <ArrowRight size={13} strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Round Dots Navigation Indicator */}
                    {effectiveEmomRounds > 1 && (
                      <div className="flex items-center justify-center gap-1.5 py-1 shrink-0">
                        {Array.from({ length: effectiveEmomRounds }).map((_, dotIdx) => {
                          const isCurrentDot = dotIdx === currentEmomRoundIdx;
                          const isCompletedDot = dotIdx < currentEmomRoundIdx;
                          return (
                            <button
                              key={dotIdx}
                              type="button"
                              onClick={() => {
                                void hapticLight();
                                setCurrentEmomRoundIdx(dotIdx);
                              }}
                              className={`transition-all rounded-full cursor-pointer ${
                                isCurrentDot
                                  ? 'w-6 h-2 bg-brand-orange shadow-[0_0_8px_rgba(255,94,0,0.6)]'
                                  : isCompletedDot
                                    ? 'w-2 h-2 bg-emerald-400/80'
                                    : 'w-2 h-2 bg-white/20 hover:bg-white/40'
                              }`}
                              title={`Vai al round ${dotIdx + 1}`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : currentExercise.type === 'pyramid' ? (
              (() => {
                const steps = currentExercise.pyramid_steps || [];

                return (
                  <div className="w-full flex-1 min-h-0 flex flex-col justify-between items-center">
                    {/* Horizontal Pyramid Cards Timeline Carousel */}
                    <div
                      ref={pyramidScrollContainerRef}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      className="w-full flex gap-3.5 sm:gap-4 overflow-x-auto no-scrollbar py-2 sm:py-3 px-[calc(50%-130px)] min-[390px]:px-[calc(50%-135px)] sm:px-[calc(50%-145px)] scroll-smooth snap-x snap-mandatory items-center my-auto"
                      style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                      {steps.map((step, sIdx) => {
                        const isCurrent = sIdx === currentPyramidStepIdx;
                        const isDone = sIdx < currentPyramidStepIdx;
                        const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                        const isMax = isMaxTarget(step.reps);

                        if (isCurrent) {
                          return (
                            <div
                              key={sIdx}
                              ref={activePyramidStepRef}
                              className="shrink-0 w-[260px] min-[390px]:w-[270px] sm:w-[290px] h-[340px] min-[390px]:h-[370px] sm:h-[400px] p-4 min-[390px]:p-5 sm:p-6 rounded-3xl border-2 border-brand-orange bg-gradient-to-b from-[#2d1405] via-[#1a0c04] to-[#121214] text-white shadow-[0_0_35px_rgba(255,94,0,0.35)] ring-1 ring-brand-orange/60 scale-[1.02] z-10 snap-center select-none flex flex-col justify-between transition-all"
                            >
                              {/* Header: Step Number + Dynamic Status Badge */}
                              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-brand-orange/20 shrink-0">
                                <div className="flex items-center gap-1 shrink-0 whitespace-nowrap font-mono">
                                  <span className="text-xs sm:text-sm font-black text-brand-orange tracking-wider uppercase">
                                    STEP {sIdx + 1}
                                  </span>
                                  <span className="text-[11px] sm:text-xs font-semibold text-zinc-400">
                                    /{steps.length}
                                  </span>
                                </div>
                                {isMax ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-orange text-[10px] font-black uppercase tracking-wider animate-pulse shrink-0">
                                    <Flame size={12} />
                                    A Cedimento
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-lightOrange text-[10px] font-black uppercase tracking-wider shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-ping" />
                                    🔥 In esecuzione
                                  </span>
                                )}
                              </div>

                              {/* Center Area: Repetitions (NO Stepper +/- as strictly requested) */}
                              <div className="my-auto py-3 flex flex-col items-center justify-center select-none">
                                <span className="text-6xl min-[390px]:text-7xl sm:text-8xl font-mono font-black text-white leading-none tracking-tight drop-shadow-[0_0_35px_rgba(255,255,255,0.25)]">
                                  {isMax ? 'MAX' : step.reps}
                                </span>
                                <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-3 sm:mt-4">
                                  Ripetizioni
                                </span>
                              </div>

                              {/* Footer: Carico dedicato dello step */}
                              <div className="pt-2.5 border-t border-brand-orange/20 flex items-center justify-center text-xs sm:text-sm shrink-0">
                                <div className="flex flex-col items-center text-center">
                                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                    Carico
                                  </span>
                                  <span className="font-mono font-black text-brand-lightOrange text-sm sm:text-base">
                                    {step.weight_kg != null && step.weight_kg > 0 ? formatWeightLabel(step.weight_kg) : 'Corpo libero'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (isDone) {
                          return (
                            <div
                              key={sIdx}
                              onClick={() => {
                                void hapticLight();
                                setCurrentPyramidStepIdx(sIdx);
                                setPendingPyramidAdvance(false);
                                stopRestCountdown();
                              }}
                              className="shrink-0 w-[170px] min-[390px]:w-[185px] sm:w-[200px] h-[290px] min-[390px]:h-[320px] sm:h-[350px] p-4 sm:p-5 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.14] text-left transition-all snap-center cursor-pointer select-none flex flex-col justify-between shadow-sm active:scale-[0.98]"
                              title={`Step ${sIdx + 1} completato - Tocca per tornare a questo step`}
                            >
                              <div className="flex items-center justify-between gap-1 pb-2 border-b border-emerald-500/20 shrink-0">
                                <div className="flex items-center gap-1 shrink-0 whitespace-nowrap font-mono">
                                  <span className="text-xs sm:text-sm font-black text-zinc-300 uppercase tracking-wider">
                                    STEP {sIdx + 1}
                                  </span>
                                  <span className="text-[11px] sm:text-xs font-semibold text-zinc-400">
                                    /{steps.length}
                                  </span>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider shrink-0">
                                  <Check size={12} strokeWidth={3} />
                                  Fatto
                                </span>
                              </div>

                              <div className="my-auto py-1 flex flex-col items-center justify-center">
                                <span className="text-5xl sm:text-6xl font-mono font-black text-emerald-400 leading-none">
                                  {logged != null && logged > 0 ? logged : (isMax ? 'MAX' : step.reps)}
                                </span>
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-400/80 mt-1.5 flex items-center gap-1">
                                  <Check size={11} strokeWidth={2.5} />
                                  Completate
                                </span>
                              </div>

                              <div className="space-y-2 shrink-0 pt-2 border-t border-emerald-500/20">
                                <div className="flex items-center justify-center text-xs">
                                  <div className="flex flex-col items-center text-center">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Carico</span>
                                    <span className="font-mono font-bold text-zinc-200 truncate max-w-[120px]">
                                      {step.weight_kg != null && step.weight_kg > 0 ? formatWeightLabel(step.weight_kg) : 'Bodyweight'}
                                    </span>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void hapticLight();
                                    setCurrentPyramidStepIdx(sIdx);
                                    setPendingPyramidAdvance(false);
                                    stopRestCountdown();
                                  }}
                                  className="w-full py-1.5 px-2 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                                  title={`Torna allo Step ${sIdx + 1}`}
                                >
                                  <ArrowPrev size={13} strokeWidth={2.5} />
                                  <span>Torna a questo step</span>
                                </button>
                              </div>
                            </div>
                          );
                        }

                        // Future Steps with Jump Button
                        return (
                          <div
                            key={sIdx}
                            onClick={() => {
                              void hapticLight();
                              setCurrentPyramidStepIdx(sIdx);
                              setPendingPyramidAdvance(false);
                              stopRestCountdown();
                            }}
                            className="shrink-0 w-[170px] min-[390px]:w-[185px] sm:w-[200px] h-[290px] min-[390px]:h-[320px] sm:h-[350px] p-4 sm:p-5 rounded-3xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/20 text-left transition-all snap-center select-none flex flex-col justify-between shadow-sm cursor-pointer active:scale-[0.98]"
                            title={`Passa allo Step ${sIdx + 1}`}
                          >
                            <div className="flex items-center justify-between gap-1 pb-2 border-b border-white/10 shrink-0">
                              <div className="flex items-center gap-1 shrink-0 whitespace-nowrap font-mono">
                                <span className="text-xs sm:text-sm font-black text-zinc-300 uppercase tracking-wider">
                                  STEP {sIdx + 1}
                                </span>
                                <span className="text-[11px] sm:text-xs font-semibold text-zinc-400">
                                  /{steps.length}
                                </span>
                              </div>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-zinc-400 text-[9px] font-black uppercase tracking-wider shrink-0">
                                {sIdx === currentPyramidStepIdx + 1 ? 'Prossimo' : sIdx === steps.length - 1 ? 'Ultimo' : 'In attesa'}
                              </span>
                            </div>

                            <div className="my-auto py-1 flex flex-col items-center justify-center text-center">
                              <span className="text-5xl sm:text-6xl font-mono font-black text-zinc-300 leading-none">
                                {isMax ? 'MAX' : step.reps}
                              </span>
                              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1.5">
                                {isMax ? 'A cedimento' : 'Ripetizioni'}
                              </span>
                            </div>

                            <div className="space-y-2 shrink-0 pt-2 border-t border-white/10">
                              <div className="flex items-center justify-center text-xs">
                                <div className="flex flex-col items-center text-center">
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Carico</span>
                                  <span className="font-mono text-zinc-400 truncate max-w-[120px]">
                                    {step.weight_kg != null && step.weight_kg > 0 ? formatWeightLabel(step.weight_kg) : 'Bodyweight'}
                                  </span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void hapticLight();
                                  setCurrentPyramidStepIdx(sIdx);
                                  setPendingPyramidAdvance(false);
                                  stopRestCountdown();
                                }}
                                className="w-full py-1.5 px-2 rounded-2xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange border border-brand-orange/35 text-[11px] font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                                title={`Passa allo Step ${sIdx + 1}`}
                              >
                                <span>Passa a questo step</span>
                                <ArrowRight size={13} strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Pyramid Indicator in basso: barra a gradini grafici di altezze diverse (sagoma piramide dinamica) */}
                    {steps.length > 1 && (
                      <div className="w-full flex flex-col items-center justify-center pt-1 pb-0.5 shrink-0">
                        <div className="flex items-end justify-center gap-1.5 sm:gap-2 h-9 px-4">
                          {steps.map((pStep, barIdx) => {
                            const isCurrentBar = barIdx === currentPyramidStepIdx;
                            const isDoneBar = barIdx < currentPyramidStepIdx;

                            // Altezza dinamica: il gradino corrente è il più alto (vertice), quelli vicini scendono progressivamente verso gli estremi
                            const maxDist = Math.max(1, steps.length - 1);
                            const dist = Math.abs(barIdx - currentPyramidStepIdx);
                            const ratio = 1 - (dist / maxDist);
                            const minBarHeight = 10;
                            const maxBarHeight = 32;
                            const barHeight = Math.round(minBarHeight + ratio * (maxBarHeight - minBarHeight));

                            return (
                              <button
                                key={barIdx}
                                type="button"
                                onClick={() => {
                                  void hapticLight();
                                  setCurrentPyramidStepIdx(barIdx);
                                }}
                                className={`w-4 sm:w-5 rounded-t-md transition-all duration-300 cursor-pointer flex flex-col items-center justify-end group ${
                                  isCurrentBar
                                    ? 'bg-brand-orange shadow-[0_0_12px_rgba(255,94,0,0.7)] ring-1 ring-brand-orange/80'
                                    : isDoneBar
                                      ? 'bg-emerald-400/80 hover:bg-emerald-400'
                                      : 'bg-white/20 hover:bg-white/40'
                                }`}
                                style={{ height: `${barHeight}px` }}
                                title={`Step ${barIdx + 1}: ${pStep.reps} reps${pStep.weight_kg ? ` @ ${pStep.weight_kg}kg` : ''}`}
                              >
                                <span className="sr-only">Step {barIdx + 1}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-center text-[9px] uppercase font-bold text-zinc-500 tracking-widest mt-1">
                          <span>Profilo Piramide</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : isCircuit ? (
              <div className="w-full flex-1 min-h-0 flex flex-col justify-between items-center py-0.5">
                {/* IN ALTO — Cronometro del Giro (Lap Stopwatch) */}
                <div
                  className={`w-full p-3 sm:p-4 rounded-3xl border-2 transition-all duration-300 shadow-xl cursor-pointer select-none group shrink-0 ${
                    isCircuitStopwatchRunning
                      ? 'border-brand-orange bg-gradient-to-b from-[#2d1405] via-[#1a0c04] to-[#121214] shadow-[0_0_35px_rgba(255,94,0,0.35)] ring-1 ring-brand-orange/60'
                      : circuitStopwatchElapsed > 0
                        ? 'border-brand-orange/60 bg-gradient-to-b from-[#1f1006] via-[#140b04] to-[#121214]'
                        : 'border-white/10 bg-[#1C1C1E]/90 hover:border-white/20'
                  }`}
                  onPointerDown={(event) => handleTimerPointerDown(event, resetCircuitStopwatch)}
                  onPointerUp={(event) => handleTimerPointerUp(event, toggleCircuitStopwatch)}
                  onPointerCancel={handleTimerPointerAbort}
                  onPointerLeave={handleTimerPointerAbort}
                  title="Tocca per avviare o mettere in pausa • Tieni premuto per azzerare"
                >
                  {/* Header: Badge satinato GIRO X DI Y + Stato Stopwatch */}
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10 shrink-0">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[10px] sm:text-[11px] font-black font-mono tracking-wider text-brand-orange uppercase">
                      GIRO {currentSetIdx + 1} DI {currentExercise.sets || 1}
                    </span>

                    {isCircuitStopwatchRunning ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-lightOrange text-[10px] font-black uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-ping" />
                        IN CORSO
                      </span>
                    ) : circuitStopwatchElapsed > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-[10px] font-black uppercase tracking-wider">
                        IN PAUSA
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-zinc-400 text-[10px] font-black uppercase tracking-wider">
                        PRONTO
                      </span>
                    )}
                  </div>

                  {/* Cronometro in grande font-mono (02:15) */}
                  <div className="my-2 sm:my-3 text-center flex flex-col items-center justify-center">
                    <span className="text-6xl min-[390px]:text-7xl sm:text-8xl font-black font-mono tracking-tight text-white leading-none drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                      {formatTime(circuitStopwatchElapsed)}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-1.5 flex items-center gap-1">
                      <Timer size={11} className="text-brand-orange" />
                      Tocca per {isCircuitStopwatchRunning ? 'pausa' : 'avvio'} • Tieni premuto per azzerare
                    </span>
                  </div>

                  {/* Indicazione discreta del tempo del giro precedente */}
                  {circuitLapTimes.length > 0 && (
                    <div className="pt-2 border-t border-white/10 flex items-center justify-center gap-1.5 text-xs font-mono font-bold text-emerald-400">
                      <Check size={13} strokeWidth={2.5} className="text-emerald-400" />
                      <span>
                        Giro {circuitLapTimes.length}: {formatTime(circuitLapTimes[circuitLapTimes.length - 1])}
                      </span>
                    </div>
                  )}
                </div>

                {/* AL CENTRO — Sequenza Stazioni del Circuito (Roadmap Verticale Satinata #1C1C1E) */}
                <div className="w-full flex-1 min-h-0 bg-[#1C1C1E] border border-white/10 rounded-3xl p-3 sm:p-4 my-2 sm:my-2.5 flex flex-col shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-brand-orange">
                      <Zap size={13} className="text-brand-orange fill-brand-orange shrink-0" />
                      <span>Roadmap Stazioni Circuito</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400 font-bold">
                      {(currentExercise.subExercises || []).length} Stazioni
                    </span>
                  </div>

                  <div className="w-full flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2 pr-0.5">
                    {(currentExercise.subExercises || []).map((sub, idx) => {
                      const isIso = sub.type === 'isometry' || sub.duration_seconds > 0;
                      const targetLabel = isIso
                        ? `${sub.duration_seconds} sec`
                        : sub.reps === 0
                          ? 'MAX reps'
                          : `${sub.reps} reps`;
                      const weightLabel =
                        sub.weight_kg != null && sub.weight_kg > 0
                          ? formatWeightLabel(sub.weight_kg)
                          : 'Corpo libero';

                      return (
                        <div
                          key={`${currentExercise.id}:circuit-station:${idx}`}
                          className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-all text-xs sm:text-sm"
                        >
                          {/* Numero stazione cerchiato in arancione + Nome esercizio in bianco bold */}
                          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 pr-2">
                            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-brand-orange bg-brand-orange/15 text-brand-orange font-mono font-black text-xs sm:text-sm flex items-center justify-center shrink-0 shadow-[0_0_8px_rgba(255,94,0,0.3)]">
                              {idx + 1}
                            </div>
                            <span className="font-bold text-white truncate text-xs sm:text-sm">
                              {sub.name}
                            </span>
                          </div>

                          {/* Pillola arancione con il target + Carico dedicato */}
                          <div className="flex items-center gap-2 shrink-0 font-mono">
                            <span className="inline-flex items-center px-2 sm:px-2.5 py-1 rounded-xl bg-brand-orange/15 border border-brand-orange/30 text-brand-lightOrange font-black text-xs">
                              {targetLabel}
                            </span>
                            <span className="text-[11px] text-zinc-400 font-bold bg-white/5 border border-white/10 px-2 py-1 rounded-xl truncate max-w-[90px]">
                              {weightLabel}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : isSuperset ? (
              (() => {
                const subExercises = currentExercise.subExercises || [];
                const count = subExercises.length;
                const isTwo = count <= 2;
                const isThree = count === 3;

                return (
                  <div className="w-full h-full flex flex-col justify-between py-0.5 min-h-0">
                    {/* The Athletic Chain Container - Dynamically proportioned to available height */}
                    <div className="w-full flex-1 min-h-0 flex flex-col justify-between overflow-y-auto no-scrollbar px-0.5">
                      {subExercises.map((sub, idx) => {
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

                        const isReps = sub.type === 'reps';
                        const targetVal = isReps
                          ? (isMaxTarget(sub.reps) ? 'MAX' : toSafeTargetInt(sub.reps))
                          : (isClickableIsoTimer && supersetIsometrySubIdx === idx
                            ? `${currentRemaining}s`
                            : (isMaxTarget(sub.duration_seconds) ? 'MAX' : `${toSafeTargetInt(sub.duration_seconds)}s`));
                        const targetUnit = isReps
                          ? (isMaxTarget(sub.reps) ? 'A SFINIMENTO' : 'REPS')
                          : (isMaxTarget(sub.duration_seconds) ? 'A SFINIMENTO' : 'SECONDI');

                        return (
                          <React.Fragment key={`${currentExercise.id}:superset:${idx}`}>
                            {/* Athletic Card - Flex-1 stretches to proportionally fill available vertical space */}
                            <div
                              className={`relative overflow-hidden border flex items-center justify-between select-none transition-all shadow-md flex-1 min-h-0 ${
                                isTwo
                                  ? 'p-4 sm:p-5 gap-3.5 sm:gap-4 rounded-3xl min-h-[110px]'
                                  : isThree
                                    ? 'p-3.5 sm:p-4 gap-3 rounded-2xl min-h-[85px]'
                                    : 'p-2.5 sm:p-3 gap-2.5 rounded-2xl min-h-[58px]'
                              } ${
                                isThisTimerActive
                                  ? 'border-brand-orange bg-brand-orange/15 shadow-[0_0_25px_rgba(255,94,0,0.25)] ring-1 ring-brand-orange/60'
                                  : isClickableIsoTimer && supersetIsometrySubIdx === idx && fillPercent > 0
                                    ? 'border-brand-orange/40 bg-black/50'
                                    : 'border-white/10 bg-gradient-to-br from-black/60 via-brand-darkGrey/80 to-black/80 hover:border-white/20'
                              } ${isClickableIsoTimer ? 'cursor-pointer active:scale-[0.99]' : ''}`}
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

                              {/* Left: Step Number + Exercise info */}
                              <div className="text-left min-w-0 relative z-10 flex items-center gap-3 sm:gap-3.5">
                                <div className={`bg-brand-orange/15 border border-brand-orange/40 text-brand-orange flex items-center justify-center font-mono font-black shrink-0 shadow-inner ${
                                  isTwo
                                    ? 'w-11 h-11 sm:w-13 sm:h-13 text-sm sm:text-base rounded-2xl'
                                    : isThree
                                      ? 'w-9 h-9 sm:w-10 sm:h-10 text-xs sm:text-sm rounded-xl'
                                      : 'w-7 h-7 sm:w-8 sm:h-8 text-[11px] rounded-lg'
                                }`}>
                                  {String(idx + 1).padStart(2, '0')}
                                </div>
                                <div className="min-w-0">
                                  <p className={`text-white font-black leading-snug truncate ${
                                    isTwo
                                      ? 'text-base sm:text-xl'
                                      : isThree
                                        ? 'text-sm sm:text-base'
                                        : 'text-xs sm:text-sm'
                                  }`}>
                                    {sub.name || `Esercizio ${idx + 1}`}
                                  </p>
                                  <div className={`flex items-center gap-2 ${isTwo ? 'mt-1.5' : 'mt-1'}`}>
                                    <span className={`inline-flex items-center gap-1 font-mono font-semibold text-zinc-300 bg-white/5 border border-white/10 ${
                                      isTwo
                                        ? 'text-xs sm:text-sm px-2.5 py-1 rounded-xl'
                                        : isThree
                                          ? 'text-[11px] sm:text-xs px-2 py-0.5 rounded-lg'
                                          : 'text-[10px] px-1.5 py-0.5 rounded-md'
                                    }`}>
                                      <Dumbbell size={isTwo ? 12 : 10} className="text-brand-orange shrink-0" />
                                      <span>{formatWeightLabel(sub.weight_kg)}</span>
                                    </span>
                                    {isClickableIsoTimer && (
                                      <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider opacity-80">
                                        {isThisTimerActive ? 'In corso' : 'Tap timer'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Right: Big Target Number */}
                              <div className="text-right shrink-0 relative z-10 pl-2">
                                <span className={`font-mono font-black text-brand-orange block leading-none drop-shadow-sm ${
                                  isTwo
                                    ? 'text-4xl min-[390px]:text-5xl sm:text-6xl'
                                    : isThree
                                      ? 'text-3xl min-[390px]:text-4xl sm:text-4xl'
                                      : 'text-2xl sm:text-3xl'
                                }`}>
                                  {targetVal}
                                </span>
                                <span className={`uppercase font-bold text-zinc-400 block ${
                                  isTwo
                                    ? 'text-[10px] sm:text-xs tracking-widest mt-1.5'
                                    : isThree
                                      ? 'text-[9px] sm:text-[10px] tracking-widest mt-1'
                                      : 'text-[8px] sm:text-[9px] tracking-wider mt-0.5'
                                }`}>
                                  {targetUnit}
                                </span>
                              </div>
                            </div>

                            {/* Neon Athletic Connector between exercises */}
                            {idx < subExercises.length - 1 && (
                              <div className="flex flex-col items-center justify-center shrink-0 select-none py-0.5">
                                <div className={`w-0.5 ${
                                  isTwo
                                    ? 'h-4 sm:h-5'
                                    : isThree
                                      ? 'h-2.5 sm:h-3'
                                      : 'h-1.5 sm:h-2'
                                } bg-gradient-to-b from-brand-orange/70 via-brand-orange to-brand-orange/70 rounded-full shadow-[0_0_8px_rgba(255,94,0,0.4)]`} />
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {subExercises.length === 0 && (
                        <p className="text-xs text-zinc-400 text-center my-auto">Nessun esercizio configurato per questo superset.</p>
                      )}
                    </div>
                  </div>
                );
              })()
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
              /* DEFAULT: STANDARD REPS & TIMELINE SETS CAROUSEL (OPTION B) */
              <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center py-0.5">
                {(() => {
                  const totalSets = Math.max(1, currentExercise.sets || 1);
                  const isMax = isMaxTarget(currentExercise.reps);

                  return (
                    <div className="w-full flex-1 min-h-0 flex flex-col justify-center items-center">
                      {/* Scrollable Container centered on active set */}
                      <div
                        ref={setsCarouselScrollContainerRef}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                        className="w-full flex gap-3.5 sm:gap-4 overflow-x-auto no-scrollbar py-3 px-[calc(50%-130px)] min-[390px]:px-[calc(50%-140px)] sm:px-[calc(50%-155px)] scroll-smooth snap-x snap-mandatory items-center"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                      >
                        {Array.from({ length: totalSets }, (_, sIdx) => {
                          const isCurrent = sIdx === currentSetIdx;
                          const isCompleted = sIdx < currentSetIdx;
                          const logged = getLoggedPerformanceForSet(currentExerciseIdx, currentExercise, sIdx);
                          const repsValue = logged != null && logged > 0 ? logged : currentExercise.reps;
                          const setWeight = currentExercise.weight_kg;
                          const weightText = setWeight != null && setWeight > 0 ? formatWeightLabel(setWeight) : 'Corpo libero';

                          if (isCurrent) {
                            return (
                              <div
                                key={sIdx}
                                ref={activeSetCardRef}
                                className="shrink-0 w-[260px] min-[390px]:w-[280px] sm:w-[310px] h-[340px] min-[390px]:h-[370px] sm:h-[400px] p-5 sm:p-6 rounded-3xl border-2 border-brand-orange bg-gradient-to-b from-[#2d1405] via-[#1a0c04] to-[#121214] text-white shadow-[0_0_35px_rgba(255,94,0,0.35)] ring-1 ring-brand-orange/60 scale-[1.02] z-10 snap-center select-none flex flex-col justify-between transition-all"
                              >
                                {/* Header: Set Number + Status Pill */}
                                <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-brand-orange/20 shrink-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs sm:text-sm font-black font-mono text-brand-orange tracking-wider uppercase">
                                      SET {sIdx + 1}
                                    </span>
                                    <span className="text-[11px] sm:text-xs font-mono text-zinc-400">
                                      / {totalSets}
                                    </span>
                                  </div>
                                  {isMax ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-orange text-[10px] font-black uppercase tracking-wider animate-pulse">
                                      <Flame size={12} />
                                      A Cedimento
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-brand-lightOrange text-[10px] font-black uppercase tracking-wider">
                                      <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-ping" />
                                      In Corso
                                    </span>
                                  )}
                                </div>

                                {/* Center Area: Hero Reps Display (Clean, Fixed, No Stepper/Edit Buttons) */}
                                {isMax ? (
                                  <div className="my-auto py-2 flex flex-col items-center justify-center">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void hapticLight();
                                        openEditSpecificSetModal(sIdx);
                                      }}
                                      className="group flex flex-col items-center justify-center cursor-pointer transition-transform active:scale-95"
                                      title="Tocca per inserire le ripetizioni eseguite"
                                    >
                                      <span className="text-6xl min-[390px]:text-7xl sm:text-8xl font-mono font-black text-brand-orange leading-none drop-shadow-[0_0_25px_rgba(255,107,0,0.45)] group-hover:scale-105 transition-transform">
                                        {(logged || 0) > 0 ? logged : 'MAX'}
                                      </span>
                                      <span className="text-[11px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1 mt-2 group-hover:text-zinc-200">
                                        <Pencil size={11} className="text-brand-orange" />
                                        Reps Eseguite
                                      </span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="my-auto py-4 flex flex-col items-center justify-center select-none">
                                    <span className="text-7xl min-[390px]:text-8xl sm:text-9xl font-mono font-black text-white leading-none tracking-tight drop-shadow-[0_0_35px_rgba(255,255,255,0.25)]">
                                      {repsValue}
                                    </span>
                                    <span className="text-xs sm:text-sm uppercase font-black text-zinc-400 tracking-[0.25em] mt-3 sm:mt-4">
                                      Ripetizioni
                                    </span>
                                  </div>
                                )}

                                {/* Footer: Carico */}
                                <div className="pt-2.5 border-t border-brand-orange/20 flex items-center justify-between text-xs sm:text-sm shrink-0">
                                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-400">
                                    Carico
                                  </span>
                                  <span className="font-mono font-black text-brand-lightOrange truncate max-w-[140px]">
                                    {weightText}
                                  </span>
                                </div>
                              </div>
                            );
                          }

                          if (isCompleted) {
                            return (
                              <div
                                key={sIdx}
                                onClick={() => {
                                  void hapticLight();
                                  setCurrentSetIdx(sIdx);
                                  resetCurrentExerciseTimerState();
                                }}
                                className="shrink-0 w-[170px] min-[390px]:w-[185px] sm:w-[200px] h-[290px] min-[390px]:h-[320px] sm:h-[350px] p-4 sm:p-5 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.14] text-left transition-all snap-center cursor-pointer select-none flex flex-col justify-between shadow-sm active:scale-[0.98]"
                                title={`Set ${sIdx + 1} completato - Tocca per tornare a questo set`}
                              >
                                <div className="flex items-center justify-between gap-1 pb-2 border-b border-emerald-500/20 shrink-0">
                                  <span className="text-xs sm:text-sm font-black font-mono text-zinc-300 uppercase tracking-wider">
                                    SET {sIdx + 1}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                                    <Check size={12} strokeWidth={3} />
                                    Fatto
                                  </span>
                                </div>

                                <div className="my-auto py-1 flex flex-col items-center justify-center">
                                  <span className="text-5xl sm:text-6xl font-mono font-black text-emerald-400 leading-none">
                                    {logged != null && logged > 0 ? logged : repsValue}
                                  </span>
                                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-400/80 mt-1.5 flex items-center gap-1">
                                    <Check size={11} strokeWidth={2.5} />
                                    Completate
                                  </span>
                                </div>

                                <div className="space-y-2 shrink-0 pt-2 border-t border-emerald-500/20">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                      Carico
                                    </span>
                                    <span className="font-mono font-bold text-zinc-200 truncate max-w-[100px]">
                                      {weightText}
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void hapticLight();
                                      setCurrentSetIdx(sIdx);
                                      resetCurrentExerciseTimerState();
                                    }}
                                    className="w-full py-1.5 px-2 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                                    title={`Torna al Set ${sIdx + 1}`}
                                  >
                                    <ArrowPrev size={13} strokeWidth={2.5} />
                                    <span>Torna a questo set</span>
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // Upcoming Sets (isUpcoming) with Jump Button
                          return (
                            <div
                              key={sIdx}
                              onClick={() => {
                                void hapticLight();
                                setCurrentSetIdx(sIdx);
                                resetCurrentExerciseTimerState();
                              }}
                              className="shrink-0 w-[170px] min-[390px]:w-[185px] sm:w-[200px] h-[290px] min-[390px]:h-[320px] sm:h-[350px] p-4 sm:p-5 rounded-3xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] hover:border-white/20 text-left transition-all snap-center select-none flex flex-col justify-between shadow-sm cursor-pointer active:scale-[0.98]"
                              title={`Passa al Set ${sIdx + 1}`}
                            >
                              <div className="flex items-center justify-between gap-1 pb-2 border-b border-white/10 shrink-0">
                                <span className="text-xs sm:text-sm font-black font-mono text-zinc-300 uppercase tracking-wider">
                                  SET {sIdx + 1}
                                </span>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/10 text-zinc-400 text-[9px] font-black uppercase tracking-wider">
                                  {sIdx === totalSets - 1 ? 'Ultimo Set' : 'Prossimo'}
                                </span>
                              </div>

                              <div className="my-auto py-1 flex flex-col items-center justify-center">
                                <span className="text-5xl sm:text-6xl font-mono font-black text-zinc-300 leading-none">
                                  {isMax ? 'MAX' : repsValue}
                                </span>
                                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1.5">
                                  {isMax ? 'A cedimento' : 'Ripetizioni'}
                                </span>
                              </div>

                              <div className="space-y-2 shrink-0 pt-2 border-t border-white/10">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                    Carico
                                  </span>
                                  <span className="font-mono font-bold text-zinc-400 truncate max-w-[100px]">
                                    {weightText}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void hapticLight();
                                    setCurrentSetIdx(sIdx);
                                    resetCurrentExerciseTimerState();
                                  }}
                                  className="w-full py-1.5 px-2 rounded-2xl bg-brand-orange/15 hover:bg-brand-orange/25 text-brand-orange border border-brand-orange/35 text-[11px] font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
                                  title={`Passa al Set ${sIdx + 1}`}
                                >
                                  <span>Passa a questo set</span>
                                  <ArrowRight size={13} strokeWidth={2.5} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Timeline Dots Indicator (if more than 1 set) */}
                      {totalSets > 1 && (
                        <div className="flex items-center justify-center gap-1.5 mt-2 shrink-0">
                          {Array.from({ length: totalSets }, (_, dIdx) => {
                            const isDotCurrent = dIdx === currentSetIdx;
                            const isDotDone = dIdx < currentSetIdx;
                            return (
                              <button
                                key={dIdx}
                                type="button"
                                onClick={() => {
                                  void hapticLight();
                                  openEditSpecificSetModal(dIdx);
                                }}
                                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                                  isDotCurrent
                                    ? 'w-6 bg-brand-orange shadow-[0_0_8px_rgba(255,94,0,0.6)]'
                                    : isDotDone
                                      ? 'w-2 bg-emerald-500/70'
                                      : 'w-2 bg-white/20 hover:bg-white/40'
                                }`}
                                title={`Set ${dIdx + 1}`}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Bottom Card Context: Upcoming recovery & Instruction trigger if available */}
          <div className="shrink-0 pt-2 border-t border-white/5 flex flex-col gap-1.5">
            {nextRecoveryLabel && (
              <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-bold text-center">
                {isPyramid
                  ? (!isLastPyramidStep ? 'Prossimo recupero' : (currentExercise.transition_rest_seconds ? 'Prossimo recupero' : 'Prossimo esercizio'))
                  : isEmom
                    ? (!isLastEmomRound ? 'Prossimo recupero' : (currentExercise.transition_rest_seconds ? 'Prossimo recupero' : 'Prossimo esercizio'))
                    : (currentExercise.sets === 1 || currentSetIdx >= (currentExercise.sets || 1) - 1)
                      ? 'Prossimo esercizio'
                      : 'Prossimo recupero'}:{' '}
                <span className="text-brand-orange font-mono font-black">{nextRecoveryLabel}</span>
              </p>
            )}
            {hasCurrentInstructionNote && (
              <button
                type="button"
                onClick={openCurrentInstructionModal}
                className="w-full py-2 px-3 rounded-xl bg-brand-orange/10 hover:bg-brand-orange/20 border border-brand-orange/30 text-brand-orange text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-[0.98]"
              >
                <Info size={14} />
                <span>Note e Istruzioni Esercizio</span>
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
                : <>FINE GIRO {currentSetIdx + 1} & RECUPERO <ArrowRight size={20} className="ml-2" /></>
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

