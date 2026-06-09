import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Play, Pause, SkipForward, ArrowRight, ArrowLeft as ArrowPrev, Timer, CheckCircle2, Mic, MicOff, FileText, X, SlidersHorizontal, Info, Video } from 'lucide-react';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import {
  buildWorkoutProgressStorageKey,
  clearAllWorkoutProgressCheckpoints,
  clearWorkoutProgressCheckpointByIdentity,
  pruneWorkoutProgressCheckpoints,
  WORKOUT_PROGRESS_MAX_AGE_MS,
  type WorkoutProgressIdentity,
} from '../lib/workoutProgressStorage';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string | null;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
  weight_kg?: number | null;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: { reps: number; rest_seconds: number; weight_kg?: number | null }[];
  order_index: number;
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
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
    type: 'reps' | 'isometry';
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
  exerciseNotesByKey: Record<string, ExerciseNoteEntry>;
  workoutStartedAtMs: number | null;
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
        typeRaw === 'isometry' || typeRaw === 'superset' || typeRaw === 'emom' || typeRaw === 'pyramid'
          ? (typeRaw as Exercise['type'])
          : 'reps';

      const subExercises = Array.isArray(item.subExercises)
        ? (item.subExercises as Array<Record<string, unknown>>).map((sub) => {
          const subType: 'reps' | 'isometry' =
            String(sub.type || 'reps').toLowerCase() === 'isometry' ? 'isometry' : 'reps';
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
        rest_seconds: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.rest_seconds, 0))),
        transition_rest_seconds: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.transition_rest_seconds, 0))),
        weight_kg: Number.isFinite(Number(item.weight_kg)) ? Number(item.weight_kg) : null,
        order_index: Math.max(0, Math.trunc(toSafeSnapshotNumber(item.order_index, idx))),
        emom_rounds: item.emom_rounds == null ? undefined : Math.max(1, Math.trunc(toSafeSnapshotNumber(item.emom_rounds, 1))),
        emom_round_duration:
          item.emom_round_duration == null ? undefined : Math.max(1, Math.trunc(toSafeSnapshotNumber(item.emom_round_duration, 1))),
        pyramid_steps: pyramidSteps,
        subExercises,
      } satisfies Exercise;
    })
    .sort((a, b) => a.order_index - b.order_index);
};

const ActiveWorkoutPage: React.FC = () => {
  const VOICE_ASSIST_KEY = 'voice_assistance_enabled';
  const { id, workoutRunId } = useParams<{ id?: string; workoutRunId?: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  // Timer State for EMOM
  const [emomActive, setEmomActive] = useState(false);
  const [emomRoundRemaining, setEmomRoundRemaining] = useState(0);
  const [emomRoundEndsAtMs, setEmomRoundEndsAtMs] = useState<number | null>(null);
  const [currentEmomRoundIdx, setCurrentEmomRoundIdx] = useState(0);

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
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteModalDraft, setNoteModalDraft] = useState('');
  const [noteModalContext, setNoteModalContext] = useState<NoteModalContext | null>(null);
  const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
  const [instructionModalContext, setInstructionModalContext] = useState<InstructionModalContext | null>(null);
  const [isWorkoutOverviewModalOpen, setIsWorkoutOverviewModalOpen] = useState(false);
  const [isWorkoutOverviewAdvancePending, setIsWorkoutOverviewAdvancePending] = useState(false);
  const [isEditExerciseModalOpen, setIsEditExerciseModalOpen] = useState(false);
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
  const canPersistExerciseEdits = sourceSchedaId != null;

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

  const normalizeDurationSeconds = (value: number) => {
    const normalized = Math.trunc(Number(value));
    if (!Number.isFinite(normalized) || normalized < 0) return 0;
    return normalized;
  };

  const computeRemainingFromEndsAt = (endsAtMs: number | null) => {
    if (endsAtMs == null) return 0;
    return Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
  };

  const buildRecoveryCue = (totalSeconds: number) => {
    const safe = Math.max(0, normalizeDurationSeconds(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;

    if (minutes > 0 && seconds > 0) {
      return `recovery ${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'}`;
    }
    if (minutes > 0) {
      return `recovery ${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    return `recovery ${seconds} second${seconds === 1 ? '' : 's'}`;
  };

  const startRestCountdown = (durationSeconds: number) => {
    const safe = normalizeDurationSeconds(durationSeconds);
    lastHandledRestCompletionEndsAtMsRef.current = null;
    setRestInitialDuration(safe);
    setRestRemaining(safe);
    setRestEndsAtMs(Date.now() + (safe * 1000));
    setIsResting(true);
  };

  const stopRestCountdown = () => {
    setIsResting(false);
    setRestEndsAtMs(null);
  };

  const pauseRestCountdown = () => {
    setRestRemaining(computeRemainingFromEndsAt(restEndsAtMs));
    setRestEndsAtMs(null);
  };

  const resumeRestCountdown = () => {
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
    setRestEndsAtMs(Date.now() + (nextDuration * 1000));
    setIsResting(true);
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

  const resetCurrentTimerFromContext = () => {
    if (isResting) {
      resetRestCountdown();
      return;
    }

    const currentExerciseForReset = workout?.exercises[currentExerciseIdx];
    if (!currentExerciseForReset) return;

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
    if (isometryActive) {
      pauseIsometryCountdown();
      return;
    }

    const currentExerciseForIso = workout?.exercises[currentExerciseIdx];
    if (!currentExerciseForIso) return;
    const currentSub = currentExerciseForIso.type === 'superset'
      ? currentExerciseForIso.subExercises?.[currentSubExerciseIdx]
      : null;
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
      ? Math.max(0, Math.min(currentEmomRoundIdx, Math.max(0, (safeExercise.emom_rounds || 1) - 1)))
      : 0;

    const safeExerciseNotesByKey = Object.entries(exerciseNotesByKey).reduce<Record<string, ExerciseNoteEntry>>((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      const note = String(value?.note || '').trim();
      if (!normalizedKey || !note) return acc;
      acc[normalizedKey] = {
        exerciseName: String(value?.exerciseName || '').trim() || normalizedKey,
        note,
      };
      return acc;
    }, {});

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
        exerciseNotesByKey: safeExerciseNotesByKey,
        workoutStartedAtMs: workoutStartedAtMsRef.current,
      },
    };

    try {
      if (user?.id) {
        pruneWorkoutProgressCheckpoints(user.id, storageKey);
      }
      localStorage.setItem(storageKey, JSON.stringify(payload));
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

    const state = parsedPayload.state;
    const safeExerciseIdx = Math.max(0, Math.min(normalizeDurationSeconds(state.currentExerciseIdx), nextWorkout.exercises.length - 1));
    const safeExercise = nextWorkout.exercises[safeExerciseIdx];
    const safeSetIdx = Math.max(0, Math.min(normalizeDurationSeconds(state.currentSetIdx), Math.max(0, safeExercise.sets - 1)));

    const rawSubIdx = normalizeDurationSeconds(state.currentSubExerciseIdx);
    const safeSubIdx = safeExercise.type === 'superset'
      ? Math.max(0, Math.min(rawSubIdx, Math.max(0, (safeExercise.subExercises?.length || 1) - 1)))
      : 0;

    const rawPyramidStepIdx = normalizeDurationSeconds(state.currentPyramidStepIdx);
    const safePyramidStepIdx = safeExercise.type === 'pyramid'
      ? Math.max(0, Math.min(rawPyramidStepIdx, Math.max(0, (safeExercise.pyramid_steps?.length || 1) - 1)))
      : 0;

    const rawEmomRoundIdx = normalizeDurationSeconds(state.currentEmomRoundIdx);
    const safeEmomRoundIdx = safeExercise.type === 'emom'
      ? Math.max(0, Math.min(rawEmomRoundIdx, Math.max(0, (safeExercise.emom_rounds || 1) - 1)))
      : 0;

    const fallbackIsometryTarget = (() => {
      if (safeExercise.type === 'isometry') return Math.max(0, normalizeDurationSeconds(safeExercise.duration_seconds));
      if (safeExercise.type === 'superset') {
        const safeSub = safeExercise.subExercises?.[safeSubIdx];
        if (safeSub?.type === 'isometry') {
          return Math.max(0, normalizeDurationSeconds(safeSub.duration_seconds));
        }
      }
      return 0;
    })();

    const fallbackEmomTarget = safeExercise.type === 'emom'
      ? Math.max(1, normalizeDurationSeconds(safeExercise.emom_round_duration || 60))
      : 0;
    const elapsedSinceSaveSeconds = Math.max(0, Math.trunc((Date.now() - savedAtMs) / 1000));

    const safeRestRemaining = Math.max(0, normalizeDurationSeconds(state.restRemaining));
    const safeRestInitial = Math.max(0, normalizeDurationSeconds(state.restInitialDuration));
    const effectiveRestInitial = safeRestInitial > 0 ? safeRestInitial : safeRestRemaining;
    const effectiveRestRemainingBase = safeRestRemaining > 0 ? safeRestRemaining : effectiveRestInitial;
    const effectiveRestRemaining = Boolean(state.restWasRunning)
      ? Math.max(0, effectiveRestRemainingBase - elapsedSinceSaveSeconds)
      : effectiveRestRemainingBase;
    const shouldRestoreRest = Boolean(state.isResting) && effectiveRestRemaining > 0;

    const safeIsometryRemainingBase = Math.max(
      0,
      normalizeDurationSeconds(
        state.isometryRemaining > 0
          ? state.isometryRemaining
          : fallbackIsometryTarget,
      ),
    );
    const safeIsometryRemaining = Boolean(state.isometryWasRunning)
      ? Math.max(0, safeIsometryRemainingBase - elapsedSinceSaveSeconds)
      : safeIsometryRemainingBase;

    const safeEmomRoundRemainingBase = Math.max(
      0,
      normalizeDurationSeconds(
        state.emomRoundRemaining > 0
          ? state.emomRoundRemaining
          : fallbackEmomTarget,
      ),
    );
    const safeEmomRoundRemaining = Boolean(state.emomWasRunning)
      ? Math.max(0, safeEmomRoundRemainingBase - elapsedSinceSaveSeconds)
      : safeEmomRoundRemainingBase;

    const safeNotes = Object.entries(state.exerciseNotesByKey || {}).reduce<Record<string, ExerciseNoteEntry>>((acc, [key, value]) => {
      const note = String(value?.note || '').trim();
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || !note) return acc;
      acc[normalizedKey] = {
        exerciseName: String(value?.exerciseName || '').trim() || normalizedKey,
        note,
      };
      return acc;
    }, {});

    setCurrentExerciseIdx(safeExerciseIdx);
    setCurrentSetIdx(safeSetIdx);
    setCurrentSubExerciseIdx(safeSubIdx);
    setCurrentPyramidStepIdx(safePyramidStepIdx);
    setCurrentEmomRoundIdx(safeEmomRoundIdx);
    setPendingPyramidAdvance(Boolean(state.pendingPyramidAdvance) && safeExercise.type === 'pyramid');
    setPendingExerciseAdvance(Boolean(state.pendingExerciseAdvance));

    const resumeRestRunning = shouldRestoreRest && Boolean(state.restWasRunning);
    const resumeIsometryRunning = Boolean(state.isometryWasRunning) && safeIsometryRemaining > 0;
    const resumeEmomRunning = Boolean(state.emomWasRunning) && safeEmomRoundRemaining > 0;

    wasRestingRef.current = resumeRestRunning;
    wasIsometryActiveRef.current = resumeIsometryRunning;
    wasEmomActiveRef.current = resumeEmomRunning;

    setIsResting(shouldRestoreRest);
    setRestRemaining(shouldRestoreRest ? effectiveRestRemaining : 0);
    setRestInitialDuration(shouldRestoreRest ? effectiveRestInitial : 0);
    setRestEndsAtMs(resumeRestRunning ? Date.now() + (effectiveRestRemaining * 1000) : null);

    setIsometryRemaining(safeIsometryRemaining);
    setIsometryActive(resumeIsometryRunning);
    setIsometryEndsAtMs(resumeIsometryRunning ? Date.now() + (safeIsometryRemaining * 1000) : null);

    setEmomRoundRemaining(safeEmomRoundRemaining);
    setEmomActive(resumeEmomRunning);
    setEmomRoundEndsAtMs(resumeEmomRunning ? Date.now() + (safeEmomRoundRemaining * 1000) : null);

    setExerciseNotesByKey(safeNotes);

    const restoredStartedAt = Number(state.workoutStartedAtMs);
    workoutStartedAtMsRef.current = Number.isFinite(restoredStartedAt) && restoredStartedAt > 0
      ? restoredStartedAt
      : Date.now();

    return true;
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

    const onStorage = (e: StorageEvent) => {
      if (e.key === VOICE_ASSIST_KEY && e.newValue !== null) {
        setVoiceAssistanceEnabled(e.newValue === 'true');
      }
    };

    window.addEventListener('storage', onStorage);
    return () => {
      isUnmounted = true;
      window.removeEventListener('storage', onStorage);
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
    return () => {
      if (voiceHelpTimeoutRef.current) {
        clearTimeout(voiceHelpTimeoutRef.current);
        voiceHelpTimeoutRef.current = null;
      }
      clearTimerLongPressState();
    };
  }, []);

  handleVoiceNextRef.current = () => {
    if (isResting) skipRest();
    else if (workout?.exercises[currentExerciseIdx]?.type === 'emom') {
      const ex = workout.exercises[currentExerciseIdx];
      if (currentEmomRoundIdx < (ex.emom_rounds || 1) - 1) {
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

    if (isResting) {
      stopRestCountdown();
      setPendingExerciseAdvance(false);
      setPendingPyramidAdvance(false);
      setIsometryRemainingWithSync(getTargetIsometry(currentEx, currentEx.subExercises?.[currentSubExerciseIdx]));
      return;
    }

    if (currentEx.type === 'superset' && currentSubExerciseIdx > 0) {
      const prevSubIdx = currentSubExerciseIdx - 1;
      setCurrentSubExerciseIdx(prevSubIdx);
      const prevSubEx = currentEx.subExercises![prevSubIdx];
      setIsometryRemainingWithSync(prevSubEx.type === 'isometry' ? prevSubEx.duration_seconds : 0);
      return;
    }

    if (currentSetIdx > 0) {
      const prevSetIdx = currentSetIdx - 1;
      setCurrentSetIdx(prevSetIdx);
      const ex = workout?.exercises[currentExerciseIdx];
      if (ex && ex.type === 'superset' && ex.subExercises) {
        const lastSubIdx = ex.subExercises.length - 1;
        setCurrentSubExerciseIdx(lastSubIdx);
        const lastSubEx = ex.subExercises[lastSubIdx];
        setIsometryRemainingWithSync(lastSubEx.type === 'isometry' ? lastSubEx.duration_seconds : 0);
      } else if (ex) {
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
    else pauseIsometryCountdown();
  };

  handleVoiceResetTimerRef.current = () => {
    resetCurrentTimerFromContext();
  };

  handleVoiceSkipRestRef.current = () => {
    if (!isResting) return false;
    skipRest();
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
        recognition.lang = 'it-IT'; // Support sia accento italiano che inglese se la parola è semplice

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
            // Se ho sentito parole ma non sono comandi supportati:
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
        recognition.onend = null; // Prevent restart
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
    currentExerciseIdx,
    currentSetIdx,
    currentSubExerciseIdx,
    currentPyramidStepIdx,
    currentEmomRoundIdx,
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
    exerciseNotesByKey,
  ]);

  useEffect(() => {
    const flushProgress = () => {
      persistWorkoutProgressRef.current?.(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
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
  }, []);

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

        if (firstEx.type === 'isometry') {
          setIsometryRemainingWithSync(firstEx.duration_seconds);
        } else if (firstEx.type === 'superset' && firstEx.subExercises?.[0]?.type === 'isometry') {
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

    const workoutDurationSeconds = (() => {
      const startedAtMs = workoutStartedAtMsRef.current;
      if (startedAtMs == null) return null;
      const elapsedSeconds = Math.trunc((Date.now() - startedAtMs) / 1000);
      if (!Number.isFinite(elapsedSeconds)) return null;
      return Math.max(0, elapsedSeconds);
    })();

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
      ? workout.exercises.map((exercise) => ({
        ...exercise,
        subExercises: exercise.subExercises || [],
        pyramid_steps: exercise.pyramid_steps || [],
      }))
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

    const rowsToInsert = Object.values(exerciseNotesByKey)
      .map((entry) => ({
        id_workout: workoutRunId,
        testo: `[${entry.exerciseName}] ${entry.note.trim()}`,
      }))
      .filter((row) => row.testo.length > 3);

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
        if (isWorkoutOverviewModalOpen) {
          setIsWorkoutOverviewAdvancePending(true);
          return;
        }
        setIsResting(false);
        finishRestAndNextSet();
      }
    };

    const handleWakeSync = () => {
      if (document.visibilityState === 'hidden') return;
      syncRestCountdown();
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
  }, [isResting, restEndsAtMs, isWorkoutOverviewModalOpen]);

  useEffect(() => {
    if (!isResting || restRemaining > 3 || restRemaining <= 0) {
      lastCountdownRestRef.current = null;
      return;
    }
    if (lastCountdownRestRef.current === restRemaining) return;
    lastCountdownRestRef.current = restRemaining;
    speakCue(String(restRemaining));
  }, [isResting, restRemaining]);

  useEffect(() => {
    const isRestTimerRunning = isResting && restEndsAtMs != null && restRemaining > 0;
    if (!wasRestingRef.current && isRestTimerRunning) {
      speakCue(buildRecoveryCue(restRemaining));
    }
    wasRestingRef.current = isRestTimerRunning;
  }, [isResting, restEndsAtMs, restRemaining]);

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
          if (currentEmomRoundIdx < (ex.emom_rounds || 1) - 1) {
            speakCue('next round');
            setCurrentEmomRoundIdx(prev => prev + 1);
            setEmomRoundRemainingWithSync(ex.emom_round_duration || 60);
          } else {
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
  }, [emomActive, emomRoundEndsAtMs, currentSetIdx, currentEmomRoundIdx, workout, currentExerciseIdx]);

  useEffect(() => {
    if (!emomActive || emomRoundRemaining > 3 || emomRoundRemaining <= 0) {
      lastCountdownEmomRef.current = null;
      return;
    }
    if (lastCountdownEmomRef.current === emomRoundRemaining) return;
    lastCountdownEmomRef.current = emomRoundRemaining;
    speakCue(String(emomRoundRemaining));
  }, [emomActive, emomRoundRemaining]);

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

  useEffect(() => {
    if (!isometryActive || isometryRemaining > 3 || isometryRemaining <= 0) {
      lastCountdownIsometryRef.current = null;
      return;
    }
    if (lastCountdownIsometryRef.current === isometryRemaining) return;
    lastCountdownIsometryRef.current = isometryRemaining;
    speakCue(String(isometryRemaining));
  }, [isometryActive, isometryRemaining]);

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
  const isLastEmomRound = currentEmomRoundIdx === (currentExercise.emom_rounds || 1) - 1;
  const isPyramid = currentExercise.type === 'pyramid';
  const isLastPyramidStep = currentPyramidStepIdx === ((currentExercise.pyramid_steps?.length || 1) - 1);

  const isSuperset = currentExercise.type === 'superset';
  const subExercise = isSuperset && currentExercise.subExercises ? currentExercise.subExercises[currentSubExerciseIdx] : null;
  const isFinalCompletionAction = isLastExercise && (isEmom ? (isLastSet && isLastEmomRound) : isPyramid ? isLastPyramidStep : isLastSet);

  const getCurrentExerciseNoteContext = () => {
    const orderStr = `${currentExerciseIdx + 1}`;
    if (isSuperset) {
      const supersetName = String(currentExercise.name || '').trim() || `Exercise ${currentExerciseIdx + 1}`;
      return {
        key: currentExercise.id,
        name: `${orderStr}. ${supersetName}`,
      };
    }

    const baseName = String(currentExercise.name || '').trim() || `Exercise ${currentExerciseIdx + 1}`;
    return {
      key: currentExercise.id,
      name: `${orderStr}. ${baseName}`,
    };
  };

  const currentExerciseNoteContext = getCurrentExerciseNoteContext();
  const hasCurrentWorkoutNote = Boolean(exerciseNotesByKey[currentExerciseNoteContext.key]?.note?.trim());

  const getCurrentInstructionContext = (): InstructionModalContext | null => {
    if (isSuperset) {
      const supersetName = String(currentExercise.name || '').trim() || `Exercise ${currentExerciseIdx + 1}`;
      const supersetNote = String(currentExercise.instruction_note || '').trim() || null;
      const supersetItems = (currentExercise.subExercises || [])
        .map((item, idx) => {
          const note = String(item.instruction_note || '').trim();
          if (!note) return null;
          return {
            name: String(item.name || '').trim() || `Exercise ${idx + 1}`,
            note,
          };
        })
        .filter((item): item is InstructionModalItem => item !== null);

      if (!supersetNote && supersetItems.length === 0) return null;
      return {
        exerciseName: supersetName,
        note: supersetNote,
        items: supersetItems,
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

  const openEditExerciseModal = () => {
    const currentSub = currentExercise.type === 'superset' ? subExercise : null;
    const currentStep = currentExercise.type === 'pyramid'
      ? currentExercise.pyramid_steps?.[currentPyramidStepIdx]
      : null;

    setExerciseEditDraft({
      sets: String(currentExercise.sets || 1),
      restSeconds: String(currentExercise.rest_seconds || 0),
      reps: formatTargetDraft(currentExercise.reps),
      durationSeconds: formatTargetDraft(currentExercise.duration_seconds),
      weightKg: formatWeightDraft(currentExercise.weight_kg),
      emomRounds: String(currentExercise.emom_rounds || 1),
      emomRoundDuration: String(currentExercise.emom_round_duration || 60),
      currentSubReps: formatTargetDraft(currentSub?.reps),
      currentSubDuration: formatTargetDraft(currentSub?.duration_seconds),
      currentSubWeightKg: formatWeightDraft(currentSub?.weight_kg),
      currentStepReps: formatTargetDraft(currentStep?.reps),
      currentStepRestSeconds: String(currentStep?.rest_seconds || 0),
      currentStepWeightKg: formatWeightDraft(currentStep?.weight_kg),
      subExerciseDrafts: buildSubExerciseDrafts(currentExercise.subExercises),
      pyramidStepDrafts: buildPyramidStepDrafts(currentExercise.pyramid_steps),
    });
    setExerciseEditError(null);
    setIsEditExerciseModalOpen(true);
  };

  const closeEditExerciseModal = () => {
    if (isSavingExerciseEdit) return;
    setIsEditExerciseModalOpen(false);
    setExerciseEditError(null);
  };

  const openCurrentExerciseNoteModal = () => {
    const existingNote = exerciseNotesByKey[currentExerciseNoteContext.key]?.note || '';
    setNoteModalContext(currentExerciseNoteContext);
    setNoteModalDraft(existingNote);
    setIsNoteModalOpen(true);
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
      finishRestAndNextSet();
    }
  };

  const closeCurrentInstructionModal = () => {
    setIsInstructionModalOpen(false);
    setInstructionModalContext(null);
  };

  const saveCurrentExerciseNote = () => {
    if (!noteModalContext) return;

    const trimmed = noteModalDraft.trim();
    setExerciseNotesByKey((prev) => {
      const next = { ...prev };
      if (!trimmed) {
        delete next[noteModalContext.key];
      } else {
        next[noteModalContext.key] = {
          exerciseName: noteModalContext.name,
          note: trimmed,
        };
      }
      return next;
    });

    closeCurrentExerciseNoteModal();
  };

  const saveCurrentExerciseEdits = async () => {
    if (!workout) return;
    if (sourceSchedaId == null) {
      setExerciseEditError('Live editing is unavailable for historical replay without a linked template.');
      return;
    }

    setIsSavingExerciseEdit(true);
    setExerciseEditError(null);

    try {
      const schedaId = sourceSchedaId;
      const nextSubExerciseDrafts = exerciseEditDraft.subExerciseDrafts;
      const nextPyramidStepDrafts = exerciseEditDraft.pyramidStepDrafts;

      const minAllowedSets = currentSetIdx + 1;

      if (currentExercise.type === 'emom') {
        const nextSets = parseStrictInt(exerciseEditDraft.sets, 'Sets');
        const nextRounds = parseStrictInt(exerciseEditDraft.emomRounds, 'Rounds');
        const nextRoundDuration = parseStrictInt(exerciseEditDraft.emomRoundDuration, 'Round duration');
        const nextRest = parseStrictInt(exerciseEditDraft.restSeconds, 'Rest', true);

        if (nextSets < minAllowedSets) {
          throw new Error(`You are currently at set ${minAllowedSets}. Sets cannot be lower than this value.`);
        }

        const minAllowedRounds = currentEmomRoundIdx + 1;
        if (nextRounds < minAllowedRounds) {
          throw new Error(`You are currently at round ${minAllowedRounds}. Rounds cannot be lower than this value.`);
        }

        const { error: emomTableError } = await supabase
          .from('emom')
          .update({
            round_totali: nextRounds,
            durata_round_secondi: nextRoundDuration,
          })
          .eq('id_emom', Number(currentExercise.id));
        if (emomTableError) throw emomTableError;

        const { error: emomRowsError } = await supabase
          .from('esecuzioni')
          .update({
            set_num: nextSets,
            rest_secondi: nextRest > 0 ? nextRest : null,
          })
          .eq('id_scheda', schedaId)
          .eq('id_emom', Number(currentExercise.id));
        if (emomRowsError) throw emomRowsError;

        const emomSubExercises = currentExercise.subExercises || [];
        if (nextSubExerciseDrafts.length !== emomSubExercises.length) {
          throw new Error('Could not map all EMOM sub-exercises to the edit form.');
        }

        const { data: emomRows, error: emomFetchError } = await supabase
          .from('esecuzioni')
          .select('id_esecuzione, ordine')
          .eq('id_scheda', schedaId)
          .eq('id_emom', Number(currentExercise.id))
          .order('ordine', { ascending: true });
        if (emomFetchError) throw emomFetchError;

        if ((emomRows?.length || 0) < nextSubExerciseDrafts.length) {
          throw new Error('Unable to map all EMOM exercises to database rows.');
        }

        await Promise.all((emomRows || []).slice(0, nextSubExerciseDrafts.length).map(async (row, index) => {
          const currentSub = emomSubExercises[index];
          const draft = nextSubExerciseDrafts[index];
          if (!currentSub || !draft) return;

          const nextSubWeight = parseOptionalWeight(draft.weightKg);
          const nextSubReps = currentSub.type === 'reps' ? parseStrictInt(draft.reps, 'EMOM reps', true) : null;
          const nextSubDuration = currentSub.type === 'isometry' ? parseStrictInt(draft.durationSeconds, 'EMOM duration', true) : null;

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

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          exercises[currentExerciseIdx] = {
            ...exercises[currentExerciseIdx],
            sets: nextSets,
            rest_seconds: nextRest,
            emom_rounds: nextRounds,
            emom_round_duration: nextRoundDuration,
            duration_seconds: nextRoundDuration,
            subExercises: (exercises[currentExerciseIdx].subExercises || []).map((sub, index) => {
              const draft = nextSubExerciseDrafts[index];
              if (!draft) return sub;
              return {
                ...sub,
                reps: sub.type === 'reps' ? parseStrictInt(draft.reps, 'EMOM reps', true) : sub.reps,
                duration_seconds: sub.type === 'isometry' ? parseStrictInt(draft.durationSeconds, 'EMOM duration', true) : sub.duration_seconds,
                weight_kg: parseOptionalWeight(draft.weightKg),
              };
            }),
          };
          return { ...prev, exercises };
        });

        setEmomRoundRemainingWithSync(Math.min(emomRoundRemaining, nextRoundDuration));
      } else if (currentExercise.type === 'superset') {
        const nextSets = parseStrictInt(exerciseEditDraft.sets, 'Rounds');
        const nextRest = parseStrictInt(exerciseEditDraft.restSeconds, 'Rest', true);
        if (nextSets < minAllowedSets) {
          throw new Error(`You are currently at round ${minAllowedSets}. Rounds cannot be lower than this value.`);
        }

        const currentSupersetExercises = currentExercise.subExercises || [];
        if (nextSubExerciseDrafts.length !== currentSupersetExercises.length) {
          throw new Error('Could not map all superset sub-exercises to the edit form.');
        }

        const supersetId = Number(currentExercise.id);
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

        if ((supersetRows?.length || 0) < nextSubExerciseDrafts.length) {
          throw new Error('Unable to map all superset exercises to database rows.');
        }

        await Promise.all((supersetRows || []).slice(0, nextSubExerciseDrafts.length).map(async (row, index) => {
          const currentSub = currentSupersetExercises[index];
          const draft = nextSubExerciseDrafts[index];
          if (!currentSub || !draft) return;

          const nextSubWeight = parseOptionalWeight(draft.weightKg);
          const nextSubReps = currentSub.type === 'reps' ? parseStrictInt(draft.reps, 'Superset reps', true) : null;
          const nextSubDuration = currentSub.type === 'isometry' ? parseStrictInt(draft.durationSeconds, 'Superset duration', true) : null;

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

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          const updated = { ...exercises[currentExerciseIdx] };
          updated.sets = nextSets;
          updated.rest_seconds = nextRest;
          updated.subExercises = (updated.subExercises || []).map((sub, index) => {
            const draft = nextSubExerciseDrafts[index];
            if (!draft) return sub;
            return {
              ...sub,
              reps: sub.type === 'reps' ? parseStrictInt(draft.reps, 'Superset reps', true) : sub.reps,
              duration_seconds: sub.type === 'isometry' ? parseStrictInt(draft.durationSeconds, 'Superset duration', true) : sub.duration_seconds,
              weight_kg: parseOptionalWeight(draft.weightKg),
            };
          });
          exercises[currentExerciseIdx] = updated;
          return { ...prev, exercises };
        });
      } else if (currentExercise.type === 'pyramid') {
        const pyramidSteps = currentExercise.pyramid_steps || [];
        if (nextPyramidStepDrafts.length !== pyramidSteps.length) {
          throw new Error('Could not map all pyramid steps to the edit form.');
        }

        const { data: pyramidRows, error: pyramidFetchError } = await supabase
          .from('esecuzioni')
          .select('id_esecuzione, ordine, stepindex_piramide')
          .eq('id_scheda', schedaId)
          .eq('id_piramide', Number(currentExercise.id))
          .order('ordine', { ascending: true });
        if (pyramidFetchError) throw pyramidFetchError;

        if ((pyramidRows?.length || 0) < nextPyramidStepDrafts.length) {
          throw new Error('Unable to map all pyramid steps to database rows.');
        }

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

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          const updated = { ...exercises[currentExerciseIdx] };
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
          exercises[currentExerciseIdx] = updated;
          return { ...prev, exercises };
        });
      } else {
        const nextSets = parseStrictInt(exerciseEditDraft.sets, 'Sets');
        const nextRest = parseStrictInt(exerciseEditDraft.restSeconds, 'Rest', true);
        const nextWeight = parseOptionalWeight(exerciseEditDraft.weightKg);

        if (nextSets < minAllowedSets) {
          throw new Error(`You are currently at set ${minAllowedSets}. Sets cannot be lower than this value.`);
        }

        const isIso = currentExercise.type === 'isometry';
        const nextReps = isIso ? currentExercise.reps : parseStrictInt(exerciseEditDraft.reps, 'Reps', true);
        const nextDuration = isIso
          ? parseStrictInt(exerciseEditDraft.durationSeconds, 'Duration', true)
          : currentExercise.duration_seconds;

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
          .eq('id_esecuzione', Number(currentExercise.id));
        if (baseUpdateError) throw baseUpdateError;

        setWorkout((prev) => {
          if (!prev) return prev;
          const exercises = [...prev.exercises];
          exercises[currentExerciseIdx] = {
            ...exercises[currentExerciseIdx],
            sets: nextSets,
            rest_seconds: nextRest,
            weight_kg: nextWeight,
            reps: nextReps,
            duration_seconds: nextDuration,
          };
          return { ...prev, exercises };
        });

        if (isIso) {
          setIsometryRemainingWithSync(Math.min(isometryRemaining, nextDuration));
        }
      }

      setIsEditExerciseModalOpen(false);
    } catch (error: any) {
      console.error('Error saving live exercise edits:', error);
      setExerciseEditError(error?.message || 'Unable to save exercise changes.');
    } finally {
      setIsSavingExerciseEdit(false);
    }
  };

  const getTargetIsometry = (ex: Exercise, subEx: any) => {
    if (ex.type === 'superset' && subEx?.type === 'isometry') return subEx.duration_seconds;
    if (ex.type === 'isometry') return ex.duration_seconds;
    return 0;
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

  const formatSupersetTaskMetricLabel = (sub: { type: 'reps' | 'isometry'; reps: number; duration_seconds: number }) => {
    if (sub.type === 'reps') {
      return isMaxTarget(sub.reps) ? 'MAX reps' : `${toSafeTargetInt(sub.reps)} reps`;
    }
    return isMaxTarget(sub.duration_seconds) ? 'MAX hold' : `${toSafeTargetInt(sub.duration_seconds)}s hold`;
  };

  const formatEmomTaskMetricLabel = (sub: { type: 'reps' | 'isometry'; reps: number; duration_seconds: number }) => {
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
    if (currentExercise.type === 'superset') {
      return getSupersetWeightLabel();
    }
    return formatWeightLabel(currentExercise.weight_kg);
  };

  const currentExecutionWeightLabel = getCurrentExecutionWeightLabel();
  const workoutOverviewExerciseNumber = currentExerciseIdx + 1;
  const workoutOverviewExerciseLabel = `EXERCISE ${workoutOverviewExerciseNumber} OF ${workout.exercises.length}`;
  const workoutRestOverviewExerciseLabel = `JUST FINISHED EXERCISE ${workoutOverviewExerciseNumber} OF ${workout.exercises.length}`;

  const getWorkoutOverviewTypeLabel = (exercise: Exercise) => {
    if (exercise.type === 'emom') return 'EMOM MODE';
    if (exercise.type === 'superset') return 'SUPERSET MODE';
    if (exercise.type === 'pyramid') return 'PYRAMID MODE';
    if (exercise.type === 'isometry') return 'ISOMETRY';
    return 'REPS';
  };

  /**
   * Per esercizi speciali con un solo sub-esercizio, mostra il nome dell'esercizio.
   * Per esercizi con più sub-esercizi o esercizi standard, mostra il tipo.
   */
  const getWorkoutOverviewDisplayLabel = (exercise: Exercise) => {
    // Se è superset, emom e ha un SOLO sub-esercizio
    if ((exercise.type === 'superset' || exercise.type === 'emom') && 
        exercise.subExercises && 
        exercise.subExercises.length === 1) {
      return exercise.subExercises[0].name || getWorkoutOverviewTypeLabel(exercise);
    }
    
    // Se è pyramid, non ha sub-esercises ma il nome è il main exercise name
    // Quindi mostra sempre il tipo
    return getWorkoutOverviewTypeLabel(exercise);
  };

  const getWorkoutOverviewSummary = (exercise: Exercise) => {
    if (exercise.type === 'emom') {
      return [
        `${exercise.sets || 1} sets`,
        `${exercise.emom_rounds || 1} rounds`,
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

    if (exercise.type === 'isometry') {
      return [
        `${exercise.sets || 1} sets`,
        `${isMaxTarget(exercise.duration_seconds) ? 'MAX' : formatTime(exercise.duration_seconds)} hold`,
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
    currentExercise.type === 'emom'
      ? 'EMOM MODE'
      : currentExercise.type === 'superset'
        ? 'SUPERSET MODE'
        : currentExercise.type === 'pyramid'
          ? 'PYRAMID MODE'
          : null;
  const specialExercisePillClass =
    currentExercise.type === 'emom'
      ? 'border-blue-400/60 bg-blue-500/10 text-blue-300'
      : currentExercise.type === 'superset'
        ? 'border-brand-orange/60 bg-brand-orange/10 text-brand-orange'
        : currentExercise.type === 'pyramid'
          ? 'border-amber-300/60 bg-amber-300/10 text-amber-300'
          : '';

  const buildNextExerciseVoiceCue = (nextExercise: Exercise, nextExerciseIndex: number) => {
    const baseName = String(nextExercise.name || '').trim() || `exercise ${nextExerciseIndex + 1}`;

    if (nextExercise.type === 'superset' || nextExercise.type === 'emom') {
      const subExerciseNames = (nextExercise.subExercises || [])
        .map((sub, idx) => String(sub.name || '').trim() || `exercise ${idx + 1}`)
        .filter((name) => name.length > 0);

      if (subExerciseNames.length > 1) {
        return `next exercise, ${nextExercise.type}, ${baseName}. ${subExerciseNames.join(', ')}`;
      }

      if (subExerciseNames.length === 1) {
        return `next exercise, ${nextExercise.type}, ${baseName}, ${subExerciseNames[0]}`;
      }

      return `next exercise, ${nextExercise.type}, ${baseName}`;
    }

    if (nextExercise.type === 'pyramid') {
      return `next exercise, pyramid, ${baseName}`;
    }

    return `next exercise, ${baseName}`;
  };

  const queueNextExerciseFlow = (sourceExercise: Exercise) => {
    const transitionRestSeconds = Math.max(0, Math.trunc(sourceExercise.transition_rest_seconds || 0));
    if (!isLastExercise && transitionRestSeconds > 0) {
      setPendingExerciseAdvance(true);
      startRestCountdown(transitionRestSeconds);
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
      setIsometryRemainingWithSync(getTargetIsometry(nextEx, nextEx.subExercises?.[0]));
      if (nextEx.type === 'emom') setEmomRoundRemainingWithSync(nextEx.emom_round_duration || 60);
      else setEmomRoundRemaining(0);
    } else {
      if (window.confirm("Workout completed! Do you want to return to home?")) {
        void completeWorkoutNow();
      } else {
        void markWorkoutComplete();
      }
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
      setIsometryRemainingWithSync(getTargetIsometry(prevEx, prevEx.subExercises?.[0]));
      if (prevEx.type === 'emom') setEmomRoundRemainingWithSync(prevEx.emom_round_duration || 60);
      else setEmomRoundRemaining(0);
    }
  };

  const completeSet = () => {
    if (currentExercise.type === 'emom') {
      // Skipping round manually via button
      if (currentEmomRoundIdx < (currentExercise.emom_rounds || 1) - 1) {
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
          startRestCountdown(stepRest);
        } else {
          setCurrentPyramidStepIdx(prev => prev + 1);
        }
      }
      return;
    }

    if (isSuperset) {
      stopIsometryCountdown();
      if (isLastSet) {
        queueNextExerciseFlow(currentExercise);
      } else {
        startRestCountdown(currentExercise.rest_seconds);
      }
      return;
    }

    // Altrimenti, abbiamo finito l'esercizio (o l'intero giro del superset)
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

    if (currentExercise.type === 'isometry') {
      setIsometryRemainingWithSync(currentExercise.duration_seconds);
      return;
    }

    if (currentExercise.type === 'superset') {
      const firstSub = currentExercise.subExercises?.[0];
      setIsometryRemainingWithSync(firstSub?.type === 'isometry' ? firstSub.duration_seconds : 0);
      return;
    }

    setIsometryRemainingWithSync(0);
  };

  const advanceWithinCurrentExercise = () => {
    if (isResting || isNoteModalOpen || isInstructionModalOpen || isEditExerciseModalOpen) return;

    if (currentExercise.type === 'emom') {
      const rounds = Math.max(1, currentExercise.emom_rounds || 1);
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

  const finishRestAndNextSet = () => {
    stopRestCountdown();

    if (pendingExerciseAdvance) {
      setPendingExerciseAdvance(false);
      handleNextExercise();
      return;
    }

    if (currentExercise.type === 'pyramid' && pendingPyramidAdvance) {
      setPendingPyramidAdvance(false);
      setCurrentPyramidStepIdx(prev => prev + 1);
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

    // Reset isometry timer if needed
    setIsometryRemainingWithSync(getTargetIsometry(currentExercise, currentExercise.subExercises?.[0]));
  };

  const skipRest = () => {
    stopRestCountdown();
    setRestRemaining(0);
    finishRestAndNextSet();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const nextRecoveryLabel = getNextRecoveryLabel();

  const handleLeaveWorkout = () => {
    suppressProgressPersistenceRef.current = true;
    clearPersistedWorkoutProgress();
    navigate('/');
  };

  const markWorkoutComplete = async () => {
    if (workoutCompletionHandledRef.current) return;
    workoutCompletionHandledRef.current = true;
    suppressProgressPersistenceRef.current = true;

    clearPersistedWorkoutProgress();

    speakCue('workout complete');
    stopEmomCountdown();
    stopIsometryCountdown();
    stopRestCountdown();

    const workoutRunId = await saveWorkoutRun();
    if (workoutRunId) {
      await saveWorkoutNotes(workoutRunId);
    }
  };

  const completeWorkoutNow = async () => {
    await markWorkoutComplete();
    navigate('/');
  };

  const handlePrimaryAction = () => {
    if (isEmom) {
      // COMPLETE WORKOUT on final EMOM state must end workout immediately.
      if (isFinalCompletionAction) {
        void completeWorkoutNow();
        return;
      }

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

  // ----------------------------------------------------------------------
  // RENDER REST VIEW
  // ----------------------------------------------------------------------
  if (isResting) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col justify-center items-center p-6 relative">
        {voiceCommandsHelpBubble}
        {isWorkoutOverviewModalOpen && (
          <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-xl bg-brand-darkGrey/95 border border-brand-orange/25 rounded-3xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Workout Overview</h3>
                  <p className="text-xs text-brand-grey mt-1">{workout.name}</p>
                </div>
                <button
                  onClick={closeWorkoutOverviewModal}
                  className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                  title="Close overview"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
                {workout.exercises.map((exercise, index) => {
                  const isCurrentExercise = index === currentExerciseIdx;
                  const exerciseTitle = String(exercise.name || '').trim() || `Exercise ${index + 1}`;
                  const summary = getWorkoutOverviewSummary(exercise);

                  return (
                    <div
                      key={exercise.id}
                      className={`rounded-2xl border p-4 transition-colors ${isCurrentExercise
                          ? 'border-brand-orange/60 bg-brand-orange/10 shadow-[0_0_18px_rgba(255,107,0,0.12)]'
                          : 'border-white/10 bg-black/30'
                        }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-brand-grey/70 font-bold mb-1">
                            Exercise {index + 1}
                          </p>
                          <h4 className="text-white font-black text-lg leading-tight truncate">{exerciseTitle}</h4>
                          <p className="text-[10px] uppercase tracking-widest font-bold mt-1 text-brand-orange/90">
                            {getWorkoutOverviewDisplayLabel(exercise)}
                          </p>
                        </div>

                        <div className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${isCurrentExercise
                            ? 'bg-brand-orange text-black'
                            : 'bg-white/5 text-brand-grey'
                          }`}>
                          {isCurrentExercise ? 'You are here' : `#${index + 1}`}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {summary.map((item, summaryIndex) => (
                          <span
                            key={`${exercise.id}:summary:${summaryIndex}`}
                            className="inline-flex items-center rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] font-bold text-white/85"
                          >
                            {item}
                          </span>
                        ))}
                      </div>

                      {exercise.type === 'superset' && exercise.subExercises && exercise.subExercises.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {exercise.subExercises.map((sub, subIndex) => (
                            <div key={`${exercise.id}:sub:${subIndex}`} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-white font-bold text-sm truncate">{sub.name || `Exercise ${subIndex + 1}`}</p>
                                <p className="text-[11px] text-brand-orange/90 font-black uppercase tracking-wide mt-1">
                                  {formatSupersetTaskMetricLabel(sub)}
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(sub.weight_kg)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {exercise.type === 'emom' && exercise.subExercises && exercise.subExercises.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {exercise.subExercises.map((sub, subIndex) => (
                            <div key={`${exercise.id}:emom:${subIndex}`} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-white font-bold text-sm truncate">{sub.name || `Exercise ${subIndex + 1}`}</p>
                                <p className="text-[11px] text-blue-400 font-black uppercase tracking-wide mt-1">
                                  {formatEmomTaskMetricLabel(sub)}
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(sub.weight_kg)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {exercise.type === 'pyramid' && exercise.pyramid_steps && exercise.pyramid_steps.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {exercise.pyramid_steps.map((step, stepIndex) => (
                            <div key={`${exercise.id}:pyramid:${stepIndex}`} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-white font-bold text-sm truncate">Step {stepIndex + 1}</p>
                                <p className="text-[11px] text-amber-300 font-black uppercase tracking-wide mt-1">
                                  {isMaxTarget(step.reps) ? 'MAX reps' : `${step.reps} reps`} · {formatTime(step.rest_seconds)} rest
                                </p>
                              </div>
                              <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                                {formatWeightLabel(step.weight_kg)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-end">
                <button
                  onClick={closeWorkoutOverviewModal}
                  className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-10 p-2">
          <button onClick={handleLeaveWorkout} className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft size={28} />
          </button>
          <div className="relative">
            {voiceStatus === 'success' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>}
            {voiceStatus === 'error' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>}
            <button
              onClick={handleVoiceButtonClick}
              className={`p-2 rounded-full transition-all duration-300 ${isVoiceEnabled ? (voiceStatus === 'success' ? 'bg-green-500 text-white scale-110' : voiceStatus === 'error' ? 'bg-red-500 text-white animate-pulse' : 'bg-brand-orange text-black') : 'text-white/50 hover:text-white bg-brand-darkGrey/40'}`}
            >
              {isVoiceEnabled ? <Mic size={24} /> : <MicOff size={24} />}
            </button>
          </div>
        </div>

        <div
          className="w-64 h-64 rounded-full border-8 border-brand-darkGrey flex flex-col justify-center items-center shadow-[0_0_50px_rgba(255,107,0,0.1)] mb-12 relative overflow-hidden cursor-pointer select-none"
          onPointerDown={(event) => handleTimerPointerDown(event, resetRestCountdown)}
          onPointerUp={(event) => handleTimerPointerUp(event, handleRestTimerTap)}
          onPointerCancel={handleTimerPointerAbort}
          onPointerLeave={handleTimerPointerAbort}
        >
          {/* Animated Fill (approximate) */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-brand-orange/20 transition-all duration-1000 ease-linear"
            style={{ height: `${(restRemaining / Math.max(1, restInitialDuration || currentExercise.rest_seconds || 1)) * 100}%` }}
          />

          <Timer size={32} className="text-brand-orange mb-2" />
          <span className="text-6xl font-black text-white z-10 font-mono tracking-tighter">
            {formatTime(restRemaining)}
          </span>
          <span className="text-brand-grey font-bold uppercase tracking-widest text-xs mt-2 z-10">REST</span>
        </div>

        <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold -mt-8 mb-8 text-center">
          Tap to {restEndsAtMs != null ? 'pause' : 'start'} / hold to reset
        </p>

        <div className="text-center space-y-2 mb-12">
          <button
            type="button"
            onClick={openWorkoutOverviewModal}
            className="inline-flex flex-col items-center gap-1 rounded-2xl border border-brand-orange/25 bg-brand-darkGrey/30 px-3 py-2 text-center transition-colors hover:border-brand-orange/60 hover:bg-brand-orange/10 cursor-pointer"
            title="Open full workout overview"
          >
            <span className="text-[10px] text-brand-grey/75 uppercase tracking-[0.24em] font-bold">Tap to view workout overview</span>
            <span className="text-brand-orange font-black text-xs tracking-widest">
              {restOverviewExerciseLabel}
            </span>
          </button>
          {restUpcomingExecutionEntries.length > 0 && (
            <div className="space-y-1">
              <p className="text-brand-grey/70 text-[10px] uppercase tracking-wider font-bold">Next exercise</p>
              {restTargetSpecialTypeLabel && (
                <p className="text-brand-orange text-xs font-black uppercase tracking-widest">{restTargetSpecialTypeLabel}</p>
              )}
              {restUpcomingExecutionEntries.map((entry, idx) => (
                <p key={`${entry.name}-${entry.weightLabel}-${idx}`} className="text-brand-orange/80 text-sm font-semibold">
                  {`${entry.name} ${entry.weightLabel}`}
                </p>
              ))}
            </div>
          )}
          <p className="text-brand-orange font-bold font-mono">
            {transitionNextExercise
              ? `Transition to Exercise ${currentExerciseIdx + 2} of ${workout.exercises.length}`
              : currentExercise.type === 'pyramid'
                ? `Step ${currentPyramidStepIdx + 2} of ${currentExercise.pyramid_steps?.length || 1}`
                : `${isSuperset ? 'Round' : 'Set'} ${currentSetIdx + 2} of ${currentExercise.sets}`}
          </p>
        </div>

        <div className="flex items-stretch gap-3">
          <button
            onClick={openCurrentExerciseNoteModal}
            className={`w-[68px] rounded-2xl border transition-all active:scale-95 flex items-center justify-center ${hasCurrentWorkoutNote
                ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                : 'bg-white/10 border-white/10 text-brand-grey hover:text-white hover:border-white/20'
              }`}
            title="Exercise Notes"
          >
            <FileText size={22} />
          </button>

          <button
            onClick={skipRest}
            className="bg-white/10 hover:bg-white/20 text-white py-4 px-10 rounded-2xl font-bold flex items-center transition-colors border border-white/5"
          >
            <SkipForward size={20} className="mr-2" /> SKIP REST
          </button>
        </div>

        {isNoteModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">Exercise Note</h3>
                  <p className="text-xs text-brand-grey mt-1">{noteModalContext?.name || 'Current exercise'}</p>
                </div>
                <button
                  onClick={closeCurrentExerciseNoteModal}
                  className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                  title="Close notes"
                >
                  <X size={18} />
                </button>
              </div>

              <textarea
                value={noteModalDraft}
                onChange={(e) => setNoteModalDraft(e.target.value)}
                placeholder="Write your considerations for this exercise..."
                className="w-full min-h-[150px] bg-black/40 border border-brand-grey/20 rounded-xl px-4 py-3 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none"
              />

              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  onClick={closeCurrentExerciseNoteModal}
                  className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={saveCurrentExerciseNote}
                  className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
                >
                  Save Note
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // RENDER ACTIVE EXERCISE VIEW
  // ----------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pt-4 pb-12 px-6 safe-top safe-bottom relative">
      {voiceCommandsHelpBubble}
      <header className="flex items-center justify-between mb-8 z-10 relative">
        <button onClick={handleLeaveWorkout} className="p-2 -ml-2 text-white hover:text-brand-orange transition-colors">
          <ArrowLeft size={28} />
        </button>
        <div className="text-center flex-1">
          <h1 className="text-xs text-brand-grey uppercase tracking-widest font-black opacity-60">Active Workout</h1>
          <h2 className="text-sm font-bold text-white truncate px-4">{workout.name}</h2>
        </div>
        <div className="relative">
          {voiceStatus === 'success' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>}
          {voiceStatus === 'error' && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>}
          <button
            onClick={handleVoiceButtonClick}
            className={`p-2 -mr-2 rounded-full transition-all duration-300 ${isVoiceEnabled ? (voiceStatus === 'success' ? 'bg-green-500 text-white scale-110' : voiceStatus === 'error' ? 'bg-red-500 text-white animate-pulse' : 'bg-brand-orange text-black') : 'text-white/50 hover:text-white bg-brand-darkGrey/40'}`}
          >
            {isVoiceEnabled ? <Mic size={24} /> : <MicOff size={24} />}
          </button>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="w-full bg-brand-darkGrey/50 h-2 rounded-full mb-8 overflow-hidden">
        <div
          className="bg-brand-orange h-full rounded-full transition-all duration-300"
          style={{ width: `${((currentExerciseIdx + 1) / workout.exercises.length) * 100}%` }}
        />
      </div>

      <main
        className="flex-1 flex flex-col relative"
        onTouchStart={handleActiveWorkoutTouchStart}
        onTouchEnd={handleActiveWorkoutTouchEnd}
        onTouchCancel={handleActiveWorkoutTouchCancel}
      >
        {/* Navigation Arrows & Title Area */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={handleArrowPrevExercise}
            disabled={currentExerciseIdx === 0}
            className="p-3 bg-brand-darkGrey/40 rounded-full text-white/50 hover:text-white disabled:opacity-20 disabled:hover:text-white/50 transition-all active:scale-95"
          >
            <ArrowPrev size={24} />
          </button>

          <div className="flex-1 text-center px-4">
            <h2 className="text-3xl font-black text-white leading-tight drop-shadow-md">
              {currentExercise.name}
            </h2>
            <button
              type="button"
              onClick={openWorkoutOverviewModal}
              className="mt-2 inline-flex flex-col items-center gap-1 rounded-2xl border border-brand-orange/25 bg-brand-darkGrey/30 px-3 py-2 text-center transition-colors hover:border-brand-orange/60 hover:bg-brand-orange/10 cursor-pointer"
              title="Open full workout overview"
            >
              <span className="text-[10px] text-brand-grey/75 uppercase tracking-[0.24em] font-bold">Tap to view workout overview</span>
              <span className="text-brand-orange font-black text-xs tracking-widest ">
                {workoutOverviewExerciseLabel}
              </span>
            </button>
            {specialExerciseLabel && (
              <div className="mt-2 flex flex-col items-center gap-1">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${specialExercisePillClass}`}>
                  {specialExerciseLabel}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={handleArrowNextExercise}
            className="p-3 bg-brand-darkGrey/40 rounded-full text-white/50 hover:text-white transition-all active:scale-95"
          >
            <ArrowRight size={24} />
          </button>
        </div>

        {/* Set Tracker Indicator */}
        <div className="flex justify-center space-x-2 mb-10">
          {Array.from({ length: currentExercise.sets }).map((_, i) => (
            <div
              key={i}
              className={`h-2.5 rounded-full transition-all duration-300 ${i < currentSetIdx ? 'bg-brand-lightOrange w-8' :
                  i === currentSetIdx ? 'bg-brand-orange w-12 shadow-[0_0_10px_rgba(255,107,0,0.5)]' :
                    'bg-white/10 w-8'
                }`}
            />
          ))}
        </div>

        {/* Focus Area (Reps / Timer / EMOM) */}
        <div className="flex-1 flex flex-col items-center justify-center">
          {currentExercise.type === 'emom' ? (
            <div className="text-center w-full max-w-sm flex flex-col items-center">
              <div className={`relative group w-48 h-48 mx-auto rounded-full border-[10px] flex flex-col justify-center items-center transition-colors duration-300 shadow-xl cursor-pointer select-none ${emomActive ? 'border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.4)]' : 'border-brand-darkGrey'}`}
                onPointerDown={(event) => handleTimerPointerDown(event, resetEmomCountdown)}
                onPointerUp={(event) => handleTimerPointerUp(event, handleEmomTimerTap)}
                onPointerCancel={handleTimerPointerAbort}
                onPointerLeave={handleTimerPointerAbort}>
                <span className={`text-[60px] font-mono tracking-tighter ${emomActive ? 'text-white' : 'text-brand-grey'} transition-colors leading-none`}>
                  {emomRoundRemaining}
                </span>
                <span className="text-brand-grey font-bold uppercase tracking-widest text-[10px] mt-1">SEC LEFT</span>
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity pointer-events-none">
                  {emomActive ? <Pause size={48} className="text-white" /> : <Play size={48} className="text-white" />}
                </div>
              </div>
              <p className="text-center text-[10px] text-brand-grey mt-2 uppercase tracking-wider font-bold mb-4">
                Tap to {emomActive ? 'pause' : 'start'} / hold to reset
              </p>

              <div className="w-full max-w-xs mb-4 grid grid-cols-2 gap-2">
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Set</span>
                  <span className="text-brand-orange font-black">{currentSetIdx + 1} / {currentExercise.sets || 1}</span>
                </div>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Round</span>
                  <span className="text-brand-orange font-black">{currentEmomRoundIdx + 1} / {currentExercise.emom_rounds || 1}</span>
                </div>
                <div className="col-span-2 bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Weights</span>
                  <span className="text-brand-orange font-black text-xs block">{currentExecutionWeightLabel}</span>
                </div>
                {hasCurrentInstructionNote && (
                  <button
                    onClick={openCurrentInstructionModal}
                    className="col-span-2 bg-brand-darkGrey/40 border border-brand-orange/35 rounded-lg py-2 px-3 text-center text-brand-orange hover:text-brand-lightOrange hover:border-brand-orange/70 hover:bg-brand-orange/10 transition-colors flex items-center justify-center gap-2"
                    title="Exercise Instructions"
                  >
                    <Info size={14} />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Exercise Instructions</span>
                  </button>
                )}
              </div>

              {nextRecoveryLabel && (
                <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold mb-3">
                  Upcoming Recovery: {nextRecoveryLabel}
                </p>
              )}

              {/* EMOM Tasks */}
              <div className="w-full flex-1 max-h-[25vh] overflow-y-auto space-y-2 px-2">
                {currentExercise.subExercises?.map((sub, idx) => (
                  <div key={idx} className="bg-brand-darkGrey/30 p-3 rounded-xl border border-white/5 flex justify-between items-center">
                    <span className="text-white font-bold text-sm truncate max-w-[70%] text-left">{sub.name}</span>
                    <div className="text-right">
                      <span className="text-blue-400 font-mono font-black text-sm block">
                        {formatEmomTaskMetricLabel(sub)}
                      </span>
                      <span className="text-[10px] text-brand-grey/80">{formatWeightLabel(sub.weight_kg)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : currentExercise.type === 'pyramid' ? (
            <div className="text-center w-full max-w-sm flex flex-col items-center">
              <span className="block text-[110px] font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_30px_rgba(255,107,0,0.2)]">
                {formatBigTargetValue(currentExercise.pyramid_steps?.[currentPyramidStepIdx]?.reps || 0)}
              </span>
              <span className="text-brand-grey font-bold uppercase tracking-widest text-lg">Reps</span>
              <div className="mt-4 w-full max-w-sm grid grid-cols-2 gap-2">
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Step</span>
                  <span className="text-brand-orange font-black">{currentPyramidStepIdx + 1} / {currentExercise.pyramid_steps?.length || 1}</span>
                </div>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Weights</span>
                  <span className="text-brand-orange font-black text-xs truncate block">{currentExecutionWeightLabel}</span>
                </div>
                {hasCurrentInstructionNote && (
                  <button
                    onClick={openCurrentInstructionModal}
                    className="col-span-2 bg-brand-darkGrey/40 border border-brand-orange/35 rounded-lg py-2 px-3 text-center text-brand-orange hover:text-brand-lightOrange hover:border-brand-orange/70 hover:bg-brand-orange/10 transition-colors flex items-center justify-center gap-2"
                    title="Exercise Instructions"
                  >
                    <Info size={14} />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Exercise Instructions</span>
                  </button>
                )}
              </div>
              <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold mt-3">
                Upcoming Recovery: {nextRecoveryLabel}
              </p>
            </div>
          ) : isSuperset ? (
            <div className="text-center w-full max-w-md flex flex-col items-center">
              <div className="w-full max-w-sm grid grid-cols-3 gap-2 mb-4">
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Round</span>
                  <span className="text-brand-orange font-black">{currentSetIdx + 1} / {currentExercise.sets || 1}</span>
                </div>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Exercises</span>
                  <span className="text-brand-orange font-black">{currentExercise.subExercises?.length || 0}</span>
                </div>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Rest</span>
                  <span className="text-brand-orange font-black">{formatTime(currentExercise.rest_seconds || 0)}</span>
                </div>
              </div>

              <div className="w-full max-h-[28vh] overflow-y-auto space-y-2 px-1">
                {(currentExercise.subExercises || []).map((sub, idx) => (
                  <div
                    key={`${currentExercise.id}:superset:${idx}`}
                    className="bg-brand-darkGrey/30 p-3 rounded-xl border border-white/5 flex justify-between items-start gap-3"
                  >
                    <div className="text-left min-w-0">
                      <p className="text-white font-bold text-sm truncate">{idx + 1}. {sub.name || `Exercise ${idx + 1}`}</p>
                      <p className="text-[11px] text-brand-orange font-black uppercase tracking-wide mt-1">
                        {formatSupersetTaskMetricLabel(sub)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Weight</span>
                      <span className="text-xs text-brand-lightOrange font-bold block">{formatWeightLabel(sub.weight_kg)}</span>
                    </div>
                  </div>
                ))}

                {(!currentExercise.subExercises || currentExercise.subExercises.length === 0) && (
                  <p className="text-sm text-brand-grey/70">No exercises configured for this superset.</p>
                )}
              </div>

              {hasCurrentInstructionNote && (
                <button
                  onClick={openCurrentInstructionModal}
                  className="mt-3 w-full max-w-sm bg-brand-darkGrey/40 border border-brand-orange/35 rounded-lg py-2 px-3 text-center text-brand-orange hover:text-brand-lightOrange hover:border-brand-orange/70 hover:bg-brand-orange/10 transition-colors flex items-center justify-center gap-2"
                  title="Exercise Instructions"
                >
                  <Info size={14} />
                  <span className="text-[10px] uppercase tracking-widest font-bold">Exercise Instructions</span>
                </button>
              )}

              <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold mt-3">
                Upcoming Recovery: {nextRecoveryLabel}
              </p>
            </div>
          ) : currentExercise.type === 'isometry' ? (
            <div
              className="text-center w-full max-w-xs relative group select-none"
            >
              <div
                className={`relative w-64 h-64 mx-auto rounded-full border-[12px] flex flex-col justify-center items-center transition-colors duration-300 shadow-xl cursor-pointer ${isometryActive ? 'border-brand-orange shadow-[0_0_40px_rgba(255,107,0,0.3)]' : 'border-brand-darkGrey'}`}
                onPointerDown={(event) => handleTimerPointerDown(event, resetIsometryCountdown)}
                onPointerUp={(event) => handleTimerPointerUp(event, handleIsometryTimerTap)}
                onPointerCancel={handleTimerPointerAbort}
                onPointerLeave={handleTimerPointerAbort}
              >
                <span className={`text-[80px] font-mono tracking-tighter ${isometryActive ? 'text-white' : 'text-brand-grey'} transition-colors leading-none`}>
                  {isMaxTarget(currentExercise.duration_seconds) ? 'MAX' : isometryRemaining}
                </span>
                <span className="text-brand-grey font-bold uppercase tracking-widest text-xs mt-2">SEC</span>

                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 rounded-full transition-opacity pointer-events-none">
                  {isometryActive ? <Pause size={48} className="text-white" /> : <Play size={48} className="text-white" />}
                </div>
              </div>
              <p className="text-center text-xs text-brand-grey mt-6 uppercase tracking-wider font-bold">
                Tap to {isometryActive ? 'pause' : 'start'} / hold to reset
              </p>
              <div className="mt-4 w-full max-w-sm grid grid-cols-3 gap-2">
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Set</span>
                  <span className="text-brand-orange font-black">{currentSetIdx + 1} / {currentExercise.sets || 1}</span>
                </div>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Rest</span>
                  <span className="text-brand-orange font-black">{formatTime(currentExercise.rest_seconds || 0)}</span>
                </div>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Weights</span>
                  <span className="text-brand-orange font-black text-xs truncate block">{currentExecutionWeightLabel}</span>
                </div>
                {hasCurrentInstructionNote && (
                  <button
                    onClick={openCurrentInstructionModal}
                    className="col-span-3 bg-brand-darkGrey/40 border border-brand-orange/35 rounded-lg py-2 px-3 text-center text-brand-orange hover:text-brand-lightOrange hover:border-brand-orange/70 hover:bg-brand-orange/10 transition-colors flex items-center justify-center gap-2"
                    title="Exercise Instructions"
                  >
                    <Info size={14} />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Exercise Instructions</span>
                  </button>
                )}
              </div>
              <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold mt-2">
                Upcoming Recovery: {nextRecoveryLabel}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <span className="block text-[120px] font-black font-mono text-brand-orange leading-none drop-shadow-[0_0_30px_rgba(255,107,0,0.2)]">
                {formatBigTargetValue(currentExercise.reps)}
              </span>
              <span className="text-brand-grey font-bold uppercase tracking-widest text-lg">Reps</span>
              <div className={`mt-4 w-full max-w-sm grid ${isSuperset ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">{isSuperset ? 'Round' : 'Set'}</span>
                  <span className="text-brand-orange font-black">{currentSetIdx + 1} / {currentExercise.sets || 1}</span>
                </div>
                {isSuperset && (
                  <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                    <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Exercise</span>
                    <span className="text-brand-orange font-black">{currentSubExerciseIdx + 1} / {currentExercise.subExercises?.length || 1}</span>
                  </div>
                )}
                <div className="bg-brand-darkGrey/30 border border-white/5 rounded-lg py-2 px-3 text-center">
                  <span className="text-[10px] uppercase tracking-widest text-brand-grey block">Weights</span>
                  <span className="text-brand-orange font-black text-xs truncate block">{currentExecutionWeightLabel}</span>
                </div>
                {hasCurrentInstructionNote && (
                  <button
                    onClick={openCurrentInstructionModal}
                    className={`${isSuperset ? 'col-span-3' : 'col-span-2'} bg-brand-darkGrey/40 border border-brand-orange/35 rounded-lg py-2 px-3 text-center text-brand-orange hover:text-brand-lightOrange hover:border-brand-orange/70 hover:bg-brand-orange/10 transition-colors flex items-center justify-center gap-2`}
                    title="Exercise Instructions"
                  >
                    <Info size={14} />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Exercise Instructions</span>
                  </button>
                )}
              </div>
              <p className="text-[10px] text-brand-grey/80 uppercase tracking-wider font-bold mt-2">
                Upcoming Recovery: {nextRecoveryLabel}
              </p>

              {!isSuperset && currentExercise.auto_count_type && (
                <button
                  onClick={async () => {
                    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                      const u = new SpeechSynthesisUtterance('');
                      u.volume = 0;
                      window.speechSynthesis.speak(u);
                    }
                    if (typeof window !== 'undefined' && typeof (window as any).DeviceMotionEvent?.requestPermission === 'function') {
                      try {
                        await (window as any).DeviceMotionEvent.requestPermission();
                      } catch (e) {
                        console.warn('DeviceMotionEvent permission request failed', e);
                      }
                    }
                    persistWorkoutProgress(true);
                    navigate('/reps-count', { 
                      state: { 
                        autoCountExercise: currentExercise.auto_count_type,
                        targetReps: currentExercise.reps,
                        returnUrl: location.pathname
                      } 
                    });
                  }}
                  className="mt-6 mx-auto w-full max-w-xs bg-brand-darkGrey/40 border border-purple-500/35 rounded-xl py-3 px-4 text-center text-purple-400 hover:text-purple-300 hover:border-purple-500/70 hover:bg-purple-500/10 transition-colors flex items-center justify-center gap-2 font-bold shadow-lg"
                  title="Use Camera/Sensor Auto-Count"
                >
                  <Video size={18} />
                  <span>USE AUTO-COUNT</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Primary Action Button */}
        <div className="mt-auto pt-8 flex items-stretch gap-3">
          <button
            onClick={openEditExerciseModal}
            disabled={!canPersistExerciseEdits}
            className="w-[70px] rounded-2xl border bg-brand-darkGrey/40 border-brand-grey/20 text-brand-grey hover:text-white hover:border-brand-grey/40 transition-all active:scale-95 flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:text-brand-grey disabled:hover:border-brand-grey/20"
            title={canPersistExerciseEdits ? 'Edit Exercise' : 'Edit unavailable for historical replay without linked template'}
          >
            <SlidersHorizontal size={22} />
          </button>

          <button
            onClick={openCurrentExerciseNoteModal}
            className={`w-[70px] rounded-2xl border transition-all active:scale-95 flex items-center justify-center ${hasCurrentWorkoutNote
                ? 'bg-brand-orange/20 border-brand-orange/60 text-brand-orange shadow-[0_0_12px_rgba(255,107,0,0.35)]'
                : 'bg-brand-darkGrey/40 border-brand-grey/20 text-brand-grey hover:text-white hover:border-brand-grey/40'
              }`}
            title="Exercise Notes"
          >
            <FileText size={24} />
          </button>

          <button
            onClick={handlePrimaryAction}
            className={`flex-1 h-[70px] rounded-2xl font-black text-xl flex items-center justify-center transition-all active:scale-95 shadow-xl ${isFinalCompletionAction
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 text-black shadow-emerald-500/20'
                : 'bg-brand-orange hover:bg-brand-lightOrange text-black shadow-brand-orange/20'
              }`}
          >
            {isFinalCompletionAction ? (
              <>
                <CheckCircle2 size={28} className="mr-2" strokeWidth={3} />
                COMPLETE WORKOUT
              </>
            ) : isEmom && !isLastEmomRound ? (
              <>NEXT ROUND <ArrowRight size={24} className="ml-2" /></>
            ) : isEmom && isLastEmomRound ? (
              <>FINISH SET</>
            ) : isPyramid && !isLastPyramidStep ? (
              <>FINISH STEP <ArrowRight size={24} className="ml-2" /></>
            ) : isLastSet ? (
              isSuperset
                ? <>NEXT EXERCISE <ArrowRight size={24} className="ml-2" /></>
                : <>FINISH EXERCISE <ArrowRight size={24} className="ml-2" /></>
            ) : (
              isSuperset
                ? <>NEXT ROUND <ArrowRight size={24} className="ml-2" /></>
                : <>FINISH SET</>
            )}
          </button>
        </div>
      </main>

      {isNoteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Exercise Note</h3>
                <p className="text-xs text-brand-grey mt-1">{noteModalContext?.name || 'Current exercise'}</p>
              </div>
              <button
                onClick={closeCurrentExerciseNoteModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close notes"
              >
                <X size={18} />
              </button>
            </div>

            <textarea
              value={noteModalDraft}
              onChange={(e) => setNoteModalDraft(e.target.value)}
              placeholder="Write your considerations for this exercise..."
              className="w-full min-h-[150px] bg-black/40 border border-brand-grey/20 rounded-xl px-4 py-3 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none"
            />

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={closeCurrentExerciseNoteModal}
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold"
              >
                Cancel
              </button>
              <button
                onClick={saveCurrentExerciseNote}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

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
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
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
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isWorkoutOverviewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-xl bg-brand-darkGrey/95 border border-brand-orange/25 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Workout Overview</h3>
                <p className="text-xs text-brand-grey mt-1">{workout.name}</p>
              </div>
              <button
                onClick={closeWorkoutOverviewModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close overview"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
              {workout.exercises.map((exercise, index) => {
                const isCurrentExercise = index === currentExerciseIdx;
                const exerciseTitle = String(exercise.name || '').trim() || `Exercise ${index + 1}`;
                const summary = getWorkoutOverviewSummary(exercise);

                return (
                  <div
                    key={exercise.id}
                    className={`rounded-2xl border p-4 transition-colors ${isCurrentExercise
                        ? 'border-brand-orange/60 bg-brand-orange/10 shadow-[0_0_18px_rgba(255,107,0,0.12)]'
                        : 'border-white/10 bg-black/30'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-brand-grey/70 font-bold mb-1">
                          Exercise {index + 1}
                        </p>
                        <h4 className="text-white font-black text-lg leading-tight truncate">{exerciseTitle}</h4>
                        <p className="text-[10px] uppercase tracking-widest font-bold mt-1 text-brand-orange/90">
                          {getWorkoutOverviewDisplayLabel(exercise)}
                        </p>
                      </div>

                      <div className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${isCurrentExercise
                          ? 'bg-brand-orange text-black'
                          : 'bg-white/5 text-brand-grey'
                        }`}>
                        {isCurrentExercise ? 'You are here' : `#${index + 1}`}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {summary.map((item, summaryIndex) => (
                        <span
                          key={`${exercise.id}:summary:${summaryIndex}`}
                          className="inline-flex items-center rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] font-bold text-white/85"
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    {exercise.type === 'superset' && exercise.subExercises && exercise.subExercises.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.subExercises.map((sub, subIndex) => (
                          <div key={`${exercise.id}:sub:${subIndex}`} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-white font-bold text-sm truncate">{sub.name || `Exercise ${subIndex + 1}`}</p>
                              <p className="text-[11px] text-brand-orange/90 font-black uppercase tracking-wide mt-1">
                                {formatSupersetTaskMetricLabel(sub)}
                              </p>
                            </div>
                            <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                              {formatWeightLabel(sub.weight_kg)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {exercise.type === 'emom' && exercise.subExercises && exercise.subExercises.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.subExercises.map((sub, subIndex) => (
                          <div key={`${exercise.id}:emom:${subIndex}`} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-white font-bold text-sm truncate">{sub.name || `Exercise ${subIndex + 1}`}</p>
                              <p className="text-[11px] text-blue-400 font-black uppercase tracking-wide mt-1">
                                {formatEmomTaskMetricLabel(sub)}
                              </p>
                            </div>
                            <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                              {formatWeightLabel(sub.weight_kg)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {exercise.type === 'pyramid' && exercise.pyramid_steps && exercise.pyramid_steps.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {exercise.pyramid_steps.map((step, stepIndex) => (
                          <div key={`${exercise.id}:pyramid:${stepIndex}`} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-white font-bold text-sm truncate">Step {stepIndex + 1}</p>
                              <p className="text-[11px] text-amber-300 font-black uppercase tracking-wide mt-1">
                                {isMaxTarget(step.reps) ? 'MAX reps' : `${step.reps} reps`} · {formatTime(step.rest_seconds)} rest
                              </p>
                            </div>
                            <span className="text-[10px] text-brand-grey/80 font-bold shrink-0">
                              {formatWeightLabel(step.weight_kg)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={closeWorkoutOverviewModal}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditExerciseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-lg bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Edit Current Exercise</h3>
                <p className="text-xs text-brand-grey mt-1">
                  {currentExercise.name}
                </p>
              </div>
              <button
                onClick={closeEditExerciseModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close exercise editor"
                disabled={isSavingExerciseEdit}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {currentExercise.type === 'emom' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-brand-grey">Sets
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseEditDraft.sets}
                        onChange={(e) => setExerciseEditDraft((d) => ({ ...d, sets: e.target.value }))}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                    <label className="text-sm text-brand-grey">Rounds
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
                      <label className="text-sm text-brand-grey">Round Duration</label>
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
                    <label className="text-sm text-brand-grey">Rest Between Sets (sec)
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
                            <p className="text-[10px] uppercase tracking-[0.24em] text-brand-grey/70 font-bold">EMOM exercise {index + 1}</p>
                            <h4 className="text-white font-black text-base truncate">{draft.name}</h4>
                          </div>
                          <span className="text-[10px] uppercase tracking-[0.24em] font-black text-brand-orange/90">{draft.type === 'isometry' ? 'Isometry' : 'Reps'}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {draft.type === 'isometry' ? (
                            <label className="text-sm text-brand-grey">Duration (sec)
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                value={draft.durationSeconds}
                                onChange={(e) => updateSubExerciseDraft(index, { durationSeconds: e.target.value })}
                                className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                              />
                            </label>
                          ) : (
                            <label className="text-sm text-brand-grey">Reps
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                value={draft.reps}
                                onChange={(e) => updateSubExerciseDraft(index, { reps: e.target.value })}
                                className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                              />
                            </label>
                          )}

                          <label className="text-sm text-brand-grey">Weight (kg)
                            <input
                              type="text"
                              value={draft.weightKg}
                              onChange={(e) => updateSubExerciseDraft(index, { weightKg: e.target.value })}
                              placeholder="body weight"
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {currentExercise.type === 'superset' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-brand-grey">Rounds
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseEditDraft.sets}
                        onChange={(e) => setExerciseEditDraft((d) => ({ ...d, sets: e.target.value }))}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                    <label className="text-sm text-brand-grey">Rest Between Rounds (sec)
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
                            <p className="text-[10px] uppercase tracking-[0.24em] text-brand-grey/70 font-bold">Superset exercise {index + 1}</p>
                            <h4 className="text-white font-black text-base truncate">{draft.name}</h4>
                          </div>
                          <span className="text-[10px] uppercase tracking-[0.24em] font-black text-brand-orange/90">{draft.type === 'isometry' ? 'Isometry' : 'Reps'}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {draft.type === 'isometry' ? (
                            <label className="text-sm text-brand-grey">Duration (sec)
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                value={draft.durationSeconds}
                                onChange={(e) => updateSubExerciseDraft(index, { durationSeconds: e.target.value })}
                                className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                              />
                            </label>
                          ) : (
                            <label className="text-sm text-brand-grey">Reps
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                value={draft.reps}
                                onChange={(e) => updateSubExerciseDraft(index, { reps: e.target.value })}
                                className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                              />
                            </label>
                          )}

                          <label className="text-sm text-brand-grey">Weight (kg)
                            <input
                              type="text"
                              value={draft.weightKg}
                              onChange={(e) => updateSubExerciseDraft(index, { weightKg: e.target.value })}
                              placeholder="body weight"
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {currentExercise.type === 'pyramid' && (
                <div className="space-y-3">
                  <div className="space-y-3 pt-2">
                    {exerciseEditDraft.pyramidStepDrafts.map((draft, index) => (
                      <div key={`step-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.24em] text-brand-grey/70 font-bold">Step {index + 1}</p>
                            <h4 className="text-white font-black text-base truncate">Pyramid step {index + 1}</h4>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <label className="text-sm text-brand-grey">Reps
                            <input
                              type="number" inputMode="numeric"
                              min={0}
                              value={draft.reps}
                              onChange={(e) => updatePyramidStepDraft(index, { reps: e.target.value })}
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                          <label className="text-sm text-brand-grey">Rest (sec)
                            <input
                              type="number" inputMode="numeric"
                              min={0}
                              value={draft.restSeconds}
                              onChange={(e) => updatePyramidStepDraft(index, { restSeconds: e.target.value })}
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                          <label className="text-sm text-brand-grey">Weight (kg)
                            <input
                              type="text"
                              value={draft.weightKg}
                              onChange={(e) => updatePyramidStepDraft(index, { weightKg: e.target.value })}
                              placeholder="body weight"
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(currentExercise.type === 'reps' || currentExercise.type === 'isometry') && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-brand-grey">Sets
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseEditDraft.sets}
                        onChange={(e) => setExerciseEditDraft((d) => ({ ...d, sets: e.target.value }))}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                    <label className="text-sm text-brand-grey">Rest (sec)
                      <input
                        type="number" inputMode="numeric"
                        min={0}
                        value={exerciseEditDraft.restSeconds}
                        onChange={(e) => setExerciseEditDraft((d) => ({ ...d, restSeconds: e.target.value }))}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                  </div>

                  {currentExercise.type === 'isometry' ? (
                    <label className="text-sm text-brand-grey">Duration (sec)
                      <input
                        type="number" inputMode="numeric"
                        min={0}
                        value={exerciseEditDraft.durationSeconds}
                        onChange={(e) => setExerciseEditDraft((d) => ({ ...d, durationSeconds: e.target.value }))}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                  ) : (
                    <label className="text-sm text-brand-grey">Reps
                      <input
                        type="number" inputMode="numeric"
                        min={0}
                        value={exerciseEditDraft.reps}
                        onChange={(e) => setExerciseEditDraft((d) => ({ ...d, reps: e.target.value }))}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                  )}

                  <label className="text-sm text-brand-grey">Weight (kg)
                    <input
                      type="text"
                      value={exerciseEditDraft.weightKg}
                      onChange={(e) => setExerciseEditDraft((d) => ({ ...d, weightKg: e.target.value }))}
                      placeholder="body Weight"
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
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveCurrentExerciseEdits}
                disabled={isSavingExerciseEdit}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black disabled:opacity-60"
              >
                {isSavingExerciseEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActiveWorkoutPage;

