/**
 * WorkoutHistoryDetailPage.tsx — Dettaglio di una singola sessione di allenamento completata.
 *
 * Riceve il `workoutRunId` dai parametri URL e carica dalla tabella `workout_run`
 * i dettagli della sessione: nome, data, durata totale, note per esercizio
 * e la lista degli esercizi eseguiti.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SORGENTE DEGLI ESERCIZI
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * La lista degli esercizi è determinata con la seguente priorità:
 *  1. `exercises_snapshot` — JSON salvato al momento del workout. Immutabile,
 *     sopravvive alla modifica o cancellazione della scheda originale.
 *     Viene deserializzato da `toSnapshotExercises()`.
 *  2. Scheda collegata — se lo snapshot non è disponibile, si fa join su
 *     `schede → esecuzioni → esercizi` e si usa `parseDbExerciseRows()`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NOTE PER ESERCIZIO
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Le note sono salvate nella tabella `note_workout` con un formato tagged:
 *   `[<orderIndex>. <exerciseName>] <testo della nota>`
 *
 * `parseTaggedNote()` estrae:
 *   - `orderIndex`    : posizione 0-based dell'esercizio nella scheda
 *   - `exerciseName`  : nome dell'esercizio
 *   - `text`          : corpo della nota
 *
 * Le note vengono abbinate agli esercizi tramite la chiave composita
 * `${orderIndex}_${normalizeNoteKey(exerciseName)}`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * AZIONI DISPONIBILI
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - "Redo workout": riesegue la stessa sessione navigando a
 *    `/active-workout-history/:workoutRunId` (usa lo snapshot come sorgente dati)
 *  - "Edit in builder": apre NewTrainPage in modalità modifica per la scheda collegata
 *    (solo se `canRestartFromTemplate` è true, cioè la scheda esiste ancora)
 *  - "Delete": elimina prima le note, poi il `workout_run`
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * UTILITY HELPER
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - `formatSecs`              : secondi → "Xm Ys"
 *  - `formatHistoryTarget`     : 0 → "MAX", altrimenti stringa numerica
 *  - `formatHistoryDuration`   : 0 → "MAX", altrimenti formatSecs
 *  - `formatHistoryWeight`     : 0 → "Body Weight", altrimenti "X kg"
 *  - `formatWorkoutDuration`   : secondi totali → "Xh Ym Zs" (con ore se > 3600)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Clock, Dumbbell, FileText, Loader2, PlayCircle, Repeat, Timer, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import BottomNavigation from '../components/BottomNavigation';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import type { UiExercise, UiSubExercise } from '../lib/workoutSchemaAdapter';
import { clearAllWorkoutProgressCheckpoints } from '../lib/workoutProgressStorage';

interface WorkoutHistoryDetail {
  id: string;
  schedaId: string | null;
  canRestartFromTemplate: boolean;
  canRestartFromSnapshot: boolean;
  workoutName: string;
  executedAt: string;
  totalDurationSeconds: number | null;
  notes: string[];
}

interface ExerciseNoteModalContext {
  exerciseName: string;
  index: number;
}

const formatExecutedAt = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizeNoteKey = (value: string) => value.trim().toLowerCase();

const parseTaggedNote = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) {
    return { orderIndex: null, exerciseName: '', text: trimmed };
  }

  const tag = match[1].trim();
  const text = match[2].trim();
  
  const orderMatch = /^(\d+)\.\s*(.*)$/.exec(tag);
  if (orderMatch) {
    return {
      orderIndex: parseInt(orderMatch[1], 10) - 1,
      exerciseName: orderMatch[2].trim(),
      text,
    };
  }

  return {
    orderIndex: null,
    exerciseName: tag,
    text,
  };
};

const formatSecs = (totalSecs: number) => {
  const safe = Number.isFinite(totalSecs) ? Math.max(0, Math.trunc(totalSecs)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

const formatHistoryTarget = (value: number) => {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  return safe === 0 ? 'MAX' : String(safe);
};

const formatHistoryDuration = (value: number) => {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  return safe === 0 ? 'MAX' : formatSecs(safe);
};

const formatHistoryWeight = (value: number) => {
  return value === 0 ? 'Body Weight' : `${value} kg`;
};

const formatWorkoutDuration = (totalSecs: number | null) => {
  if (totalSecs == null || !Number.isFinite(totalSecs)) return 'Not available';

  const safe = Math.max(0, Math.trunc(totalSecs));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
};

const toSafeNumber = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toSnapshotExercises = (raw: unknown): UiExercise[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, idx) => {
      const item = entry as Record<string, unknown>;
      const typeRaw = String(item.type || 'reps').toLowerCase();
      const type: UiExercise['type'] =
        typeRaw === 'isometry' || typeRaw === 'superset' || typeRaw === 'circuit' || typeRaw === 'emom' || typeRaw === 'pyramid'
          ? (typeRaw as UiExercise['type'])
          : 'reps';

      const subExercises = Array.isArray(item.subExercises)
        ? (item.subExercises as Array<Record<string, unknown>>).map((sub) => {
          const subType: UiSubExercise['type'] =
            String(sub.type || 'reps').toLowerCase() === 'isometry' ? 'isometry' : 'reps';
          return {
            name: String(sub.name || ''),
            type: subType,
            reps: Math.max(0, Math.trunc(toSafeNumber(sub.reps, 0))),
            duration_seconds: Math.max(0, Math.trunc(toSafeNumber(sub.duration_seconds, 0))),
            weight_kg: Number.isFinite(Number(sub.weight_kg)) ? Number(sub.weight_kg) : null,
          } satisfies UiSubExercise;
        })
        : undefined;

      const pyramidSteps = Array.isArray(item.pyramid_steps)
        ? (item.pyramid_steps as Array<Record<string, unknown>>).map((step) => ({
          reps: Math.max(0, Math.trunc(toSafeNumber(step.reps, 0))),
          rest_seconds: Math.max(0, Math.trunc(toSafeNumber(step.rest_seconds, 0))),
          weight_kg: Number.isFinite(Number(step.weight_kg)) ? Number(step.weight_kg) : null,
        }))
        : undefined;

      return {
        id: String(item.id || `snapshot-${idx}`),
        type,
        name: String(item.name || `Exercise ${idx + 1}`),
        sets: Math.max(1, Math.trunc(toSafeNumber(item.sets, 1))),
        reps: Math.max(0, Math.trunc(toSafeNumber(item.reps, 0))),
        duration_seconds: Math.max(0, Math.trunc(toSafeNumber(item.duration_seconds, 0))),
        rest_seconds: Math.max(0, Math.trunc(toSafeNumber(item.rest_seconds, 0))),
        weight_kg: Number.isFinite(Number(item.weight_kg)) ? Number(item.weight_kg) : null,
        order_index: Math.max(0, Math.trunc(toSafeNumber(item.order_index, idx))),
        emom_rounds: item.emom_rounds == null ? undefined : Math.max(1, Math.trunc(toSafeNumber(item.emom_rounds, 1))),
        emom_round_duration:
          item.emom_round_duration == null ? undefined : Math.max(1, Math.trunc(toSafeNumber(item.emom_round_duration, 1))),
        pyramid_steps: pyramidSteps,
        subExercises,
      } satisfies UiExercise;
    })
    .sort((a, b) => a.order_index - b.order_index);
};

const WorkoutHistoryDetailPage: React.FC = () => {
  const { workoutRunId } = useParams<{ workoutRunId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkoutHistoryDetail | null>(null);
  const [exercises, setExercises] = useState<UiExercise[]>([]);
  const [isDeletingHistoryEntry, setIsDeletingHistoryEntry] = useState(false);
  const [isExerciseNoteModalOpen, setIsExerciseNoteModalOpen] = useState(false);
  const [exerciseNoteModalContext, setExerciseNoteModalContext] = useState<ExerciseNoteModalContext | null>(null);
  const [exerciseNoteDraft, setExerciseNoteDraft] = useState('');
  const [isSavingExerciseNote, setIsSavingExerciseNote] = useState(false);

  const clearRestartCheckpoint = () => {
    if (!user?.id) return;
    clearAllWorkoutProgressCheckpoints(user.id);
  };

  useEffect(() => {
    const fetchWorkoutHistoryDetail = async () => {
      if (!user?.id || !workoutRunId) return;

      const workoutRunNumericId = Number(workoutRunId);
      if (Number.isNaN(workoutRunNumericId)) {
        setError('Invalid workout id.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const runSelectBase = `
            id_workout,
            id_scheda,
            workout_name_snapshot,
            exercises_snapshot,
            data_esecuzione,
            schede ( id_scheda, nome ),
            note_workout ( testo, created_at )
          `;

        const runSelectWithDuration = `
            id_workout,
            id_scheda,
            workout_name_snapshot,
            exercises_snapshot,
            data_esecuzione,
            durata_totale_secondi,
            schede ( id_scheda, nome ),
            note_workout ( testo, created_at )
          `;

        let runData: any = null;
        let runError: any = null;

        const firstRunAttempt = await supabase
          .from('workout_run')
          .select(runSelectWithDuration)
          .eq('id_workout', workoutRunNumericId)
          .eq('id_utente', user.id)
          .maybeSingle();

        runData = firstRunAttempt.data;
        runError = firstRunAttempt.error;

        const needsDurationFallback =
          Boolean(runError) &&
          /durata_totale_secondi/i.test(String(runError?.message || ''));

        if (needsDurationFallback) {
          const fallbackRunAttempt = await supabase
            .from('workout_run')
            .select(runSelectBase)
            .eq('id_workout', workoutRunNumericId)
            .eq('id_utente', user.id)
            .maybeSingle();

          runData = fallbackRunAttempt.data;
          runError = fallbackRunAttempt.error;
        }

        if (runError) throw runError;
        if (!runData) {
          setError('Workout not found.');
          setDetail(null);
          setExercises([]);
          return;
        }

        const linkedScheda = Array.isArray(runData.schede) ? runData.schede[0] : runData.schede;
        const linkedNotes = Array.isArray(runData.note_workout) ? runData.note_workout : [];
        const workoutNameSnapshot = String((runData as { workout_name_snapshot?: unknown }).workout_name_snapshot || '').trim();
        const snapshotExercises = toSnapshotExercises((runData as { exercises_snapshot?: unknown }).exercises_snapshot);
        const totalDurationRaw = Number((runData as { durata_totale_secondi?: unknown }).durata_totale_secondi);
        const totalDurationSeconds = Number.isFinite(totalDurationRaw) ? Math.max(0, Math.trunc(totalDurationRaw)) : null;
        const canRestartFromTemplate = runData.id_scheda != null && Boolean(linkedScheda?.id_scheda);
        const canRestartFromSnapshot = snapshotExercises.length > 0;

        const parsedDetail: WorkoutHistoryDetail = {
          id: String(runData.id_workout),
          schedaId: runData.id_scheda == null ? null : String(runData.id_scheda),
          canRestartFromTemplate,
          canRestartFromSnapshot,
          workoutName:
            workoutNameSnapshot ||
            linkedScheda?.nome ||
            (runData.id_scheda != null ? `Workout #${runData.id_scheda}` : `Workout #${runData.id_workout}`),
          executedAt: runData.data_esecuzione,
          totalDurationSeconds,
          notes: linkedNotes
            .map((note: { testo?: unknown }) => String(note?.testo || '').trim())
            .filter((note: string) => note.length > 0),
        };

        setDetail(parsedDetail);

        if (snapshotExercises.length > 0) {
          setExercises(snapshotExercises);
          return;
        }

        if (runData.id_scheda == null) {
          setExercises([]);
          return;
        }

        const { data: workoutData, error: workoutError } = await supabase
          .from('schede')
          .select(`
            id_scheda,
            esecuzioni (
              id_esecuzione,
              ordine,
              set_num,
              rest_secondi,
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
          .eq('id_scheda', Number(runData.id_scheda))
          .maybeSingle();

        if (workoutError || !workoutData) {
          setExercises([]);
          return;
        }

        const parsedExercises = parseDbExerciseRows(workoutData?.esecuzioni || []);
        setExercises(parsedExercises);
      } catch (fetchError) {
        console.error('Error fetching workout history detail:', fetchError);
        setError('Unable to load workout details.');
        setDetail(null);
        setExercises([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchWorkoutHistoryDetail();
  }, [user, workoutRunId]);

  const notesGrouped = useMemo(() => {
    const notesMap = new Map<string, string[]>();
    const legacyMap = new Map<string, string[]>();
    const genericNotes: string[] = [];

    (detail?.notes || []).forEach((noteText) => {
      const parsed = parseTaggedNote(noteText);
      if (!parsed) {
        genericNotes.push(noteText);
        return;
      }

      if (parsed.orderIndex !== null) {
        const key = `${parsed.orderIndex}_${normalizeNoteKey(parsed.exerciseName)}`;
        const current = notesMap.get(key) || [];
        current.push(parsed.text);
        notesMap.set(key, current);
      } else {
        const key = normalizeNoteKey(parsed.exerciseName);
        const current = legacyMap.get(key) || [];
        current.push(parsed.text);
        legacyMap.set(key, current);
      }
    });

    return { notesMap, legacyMap, genericNotes };
  }, [detail?.notes]);

  const getNotesForExercise = (name: string, index: number) => {
    const key = `${index}_${normalizeNoteKey(name)}`;
    const specificNotes = notesGrouped.notesMap.get(key);
    if (specificNotes && specificNotes.length > 0) return specificNotes;
    
    return notesGrouped.legacyMap.get(normalizeNoteKey(name)) || [];
  };

  const getNoteTextsForExercise = (exerciseName: string, sourceNotes: string[], index: number) => {
    const targetKey = normalizeNoteKey(exerciseName);
    return sourceNotes
      .map((rawNote) => parseTaggedNote(rawNote))
      .filter((parsed): parsed is { orderIndex: number | null; exerciseName: string; text: string } => {
        if (!parsed || !parsed.exerciseName || !parsed.text) return false;
        
        if (parsed.orderIndex !== null) {
          return parsed.orderIndex === index && normalizeNoteKey(parsed.exerciseName) === targetKey;
        } else {
          return normalizeNoteKey(parsed.exerciseName) === targetKey;
        }
      })
      .map((parsed) => parsed.text);
  };

  const openExerciseNoteModal = (exerciseName: string, index: number) => {
    const initialNotes = getNoteTextsForExercise(exerciseName, detail?.notes || [], index);
    setExerciseNoteModalContext({ exerciseName, index });
    setExerciseNoteDraft(initialNotes.join('\n'));
    setIsExerciseNoteModalOpen(true);
  };

  const closeExerciseNoteModal = () => {
    if (isSavingExerciseNote) return;
    setIsExerciseNoteModalOpen(false);
    setExerciseNoteModalContext(null);
    setExerciseNoteDraft('');
  };

  const saveExerciseNote = async () => {
    if (!detail || !exerciseNoteModalContext || !user?.id || isSavingExerciseNote) return;

    const workoutRunNumericId = Number(detail.id);
    if (Number.isNaN(workoutRunNumericId)) {
      alert('Invalid workout id.');
      return;
    }

    try {
      setIsSavingExerciseNote(true);
      const targetKey = normalizeNoteKey(exerciseNoteModalContext.exerciseName);
      const targetIndex = exerciseNoteModalContext.index;
      
      const newSourceNotes = (detail?.notes || []).filter((raw) => {
        const parsed = parseTaggedNote(raw);
        if (!parsed || !parsed.exerciseName) return true;
        if (parsed.orderIndex !== null) {
          return !(parsed.orderIndex === targetIndex && normalizeNoteKey(parsed.exerciseName) === targetKey);
        }
        return normalizeNoteKey(parsed.exerciseName) !== targetKey;
      });

      if (exerciseNoteDraft.trim()) {
        const orderStr = `${targetIndex + 1}`;
        newSourceNotes.push(`[${orderStr}. ${exerciseNoteModalContext.exerciseName}] ${exerciseNoteDraft.trim()}`);
      }

      const { error: deleteNotesError } = await supabase
        .from('note_workout')
        .delete()
        .eq('id_workout', workoutRunNumericId);

      if (deleteNotesError) throw deleteNotesError;

      if (newSourceNotes.length > 0) {
        const rowsToInsert = newSourceNotes.map((note) => ({
          id_workout: workoutRunNumericId,
          testo: note,
        }));

        const { error: insertNotesError } = await supabase
          .from('note_workout')
          .insert(rowsToInsert);

        if (insertNotesError) throw insertNotesError;
      }

      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          notes: newSourceNotes,
        };
      });

      setIsExerciseNoteModalOpen(false);
      setExerciseNoteModalContext(null);
      setExerciseNoteDraft('');
    } catch (saveError) {
      console.error('Error saving workout exercise note:', saveError);
      alert('Unable to save exercise note.');
    } finally {
      setIsSavingExerciseNote(false);
    }
  };

  const deleteCurrentHistoryEntry = async () => {
    if (!user?.id || !detail || isDeletingHistoryEntry) return;
    if (!window.confirm('Delete this completed workout from history?')) return;

    const workoutRunNumericId = Number(detail.id);
    if (Number.isNaN(workoutRunNumericId)) {
      alert('Invalid workout id.');
      return;
    }

    try {
      setIsDeletingHistoryEntry(true);

      const { error: notesDeleteError } = await supabase
        .from('note_workout')
        .delete()
        .eq('id_workout', workoutRunNumericId);
      if (notesDeleteError) throw notesDeleteError;

      const { error: workoutDeleteError } = await supabase
        .from('workout_run')
        .delete()
        .eq('id_workout', workoutRunNumericId)
        .eq('id_utente', user.id);
      if (workoutDeleteError) throw workoutDeleteError;

      navigate('/workout-history');
    } catch (deleteError) {
      console.error('Error deleting workout history entry:', deleteError);
      alert('Unable to delete workout history entry.');
    } finally {
      setIsDeletingHistoryEntry(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-dark flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-brand-dark text-white p-6 flex flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-black mb-3">Details unavailable</h1>
        <p className="text-brand-grey mb-6">{error || 'No data found for this workout.'}</p>
        <button
          onClick={() => navigate('/workout-history')}
          className="bg-brand-orange text-black font-black px-5 py-3 rounded-full"
        >
          Back to history
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-white pb-32 px-5 pt-6">
      <header className="max-w-3xl mx-auto w-full mb-6">
        <button
          onClick={() => navigate('/workout-history')}
          className="inline-flex items-center text-brand-grey hover:text-white transition-colors mb-4"
        >
          <ArrowLeft size={18} className="mr-2" />
          Back to history
        </button>

        <div className="bg-brand-darkGrey/50 border border-brand-grey/20 rounded-3xl p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-brand-grey/70 font-black">Completed workout</p>
              <h1 className="text-2xl font-black leading-tight break-words mt-1">{detail.workoutName}</h1>
              <p className="text-sm text-brand-grey mt-2 flex items-center">
                <Calendar size={15} className="mr-2 text-brand-orange" />
                {formatExecutedAt(detail.executedAt)}
              </p>
              <p className="text-sm text-brand-grey mt-1 flex items-center">
                <Clock size={15} className="mr-2 text-brand-orange" />
                Duration: {formatWorkoutDuration(detail.totalDurationSeconds)}
              </p>
            </div>
            <div className="bg-brand-orange/20 p-3 rounded-2xl shrink-0">
              <Dumbbell size={22} className="text-brand-orange" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto space-y-4">
        {exercises.length === 0 ? (
          <div className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-5 text-brand-grey">
            No exercises found for this workout.
          </div>
        ) : (
          exercises.map((exercise, idx) => {
            const directNotes = getNotesForExercise(exercise.name, idx);
            const hasDirectExerciseNote = directNotes.length > 0;
            const typeLabel =
              exercise.type === 'reps'
                ? 'REPS'
                : exercise.type === 'isometry'
                  ? 'ISOMETRIC'
                  : exercise.type === 'circuit'
                    ? 'CIRCUITO'
                    : exercise.type === 'superset'
                      ? 'SUPERSET'
                      : exercise.type === 'emom'
                        ? 'EMOM'
                        : 'PYRAMID';

            const isComplexType =
              exercise.type === 'superset' || exercise.type === 'circuit' || exercise.type === 'emom' || exercise.type === 'pyramid';
            const shouldShowTypeBadge = exercise.type !== 'superset' && exercise.type !== 'circuit' && exercise.type !== 'emom';

            return (
              <section
                key={`${exercise.id}:${idx}`}
                className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-5"
              >
                <div className="flex flex-col bg-black/40 px-5 py-4 rounded-2xl border border-white/5">
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <span className="font-bold text-lg text-white drop-shadow-md flex items-center">
                      <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{idx + 1}.</span>
                      {isComplexType ? <Repeat size={16} className="mr-1 text-brand-orange" /> : null}
                      {exercise.name}
                    </span>
                    {exercise.type === 'circuit' && (
                      <div className="flex items-center text-xs font-black px-2.5 py-1 rounded-full bg-brand-orange/10 border border-brand-orange/40 text-brand-orange shadow-inner whitespace-nowrap">
                        <Timer size={12} className="mr-1 text-brand-orange" />
                        CIRCUITO
                      </div>
                    )}
                    {exercise.type === 'superset' && (
                      <div className="flex items-center text-xs font-black px-2.5 py-1 rounded-full bg-brand-orange/10 border border-brand-orange/40 text-brand-orange shadow-inner whitespace-nowrap">
                        <Repeat size={12} className="mr-1 text-brand-orange" />
                        SUPERSET
                      </div>
                    )}
                    {shouldShowTypeBadge && (
                      <div className="flex items-center text-xs font-bold px-2 py-1 rounded bg-brand-darkGrey text-white shadow-inner whitespace-nowrap">
                        {exercise.type === 'isometry' ? (
                          <Timer size={12} className="mr-1 text-brand-orange" />
                        ) : (
                          <Repeat size={12} className="mr-1 text-brand-orange" />
                        )}
                        {typeLabel}
                      </div>
                    )}
                  </div>

                  <div className="mb-3 flex justify-end">
                    <button
                      onClick={() => openExerciseNoteModal(exercise.name, idx)}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors border ${hasDirectExerciseNote
                          ? 'bg-brand-orange/20 text-brand-orange border-brand-orange/40 hover:bg-brand-orange/25'
                          : 'bg-brand-darkGrey/40 text-brand-grey border-brand-grey/30 hover:text-white hover:border-brand-grey/50'
                        }`}
                    >
                      <FileText size={12} />
                      {hasDirectExerciseNote ? 'Edit note' : 'Add note'}
                    </button>
                  </div>

                  {isComplexType && (
                    <div className="mb-3 mt-1">
                      <div className="flex flex-col pl-6 border-l-2 border-white/10 space-y-2">
                        {exercise.type === 'pyramid' ? (
                          exercise.pyramid_steps && exercise.pyramid_steps.length > 0 ? (
                            exercise.pyramid_steps.map((step, stepIdx) => (
                              <div key={`${exercise.id}:step:${stepIdx}`} className="text-sm font-semibold text-white/80">
                                - Step {stepIdx + 1}:{' '}
                                  <span className="text-brand-orange ml-1 text-xs">{formatHistoryTarget(step.reps)} reps</span>{' '}
                                {step.weight_kg != null && (
                                  <span className="text-white ml-1 text-xs">- {formatHistoryWeight(step.weight_kg)}</span>
                                )}
                                <span className="text-brand-grey/70 text-xs ml-1">/ rest {formatSecs(step.rest_seconds)}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-brand-grey/70">No pyramid steps configured.</p>
                          )
                        ) : exercise.subExercises && exercise.subExercises.length > 0 ? (
                          exercise.subExercises.map((subExercise: UiSubExercise, subIdx) => {
                            const subNotes = getNotesForExercise(subExercise.name, idx);
                            const subMetric =
                              subExercise.type === 'reps'
                                ? `${formatHistoryTarget(subExercise.reps)} reps`
                                : formatHistoryDuration(subExercise.duration_seconds);

                            return (
                              <div key={`${exercise.id}:sub:${subIdx}`} className="border border-white/5 bg-black/10 rounded-2xl p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="font-bold text-white text-sm">{subExercise.name}</p>
                                  <span className="text-xs text-brand-orange font-black uppercase tracking-wide">
                                    {subMetric}
                                    {subExercise.weight_kg != null && <span className="text-white ml-1">- {formatHistoryWeight(subExercise.weight_kg)}</span>}
                                  </span>
                                </div>

                                {subNotes.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {subNotes.map((note, noteIdx) => (
                                      <p
                                        key={`${exercise.id}:sub:${subIdx}:note:${noteIdx}`}
                                        className="text-xs text-brand-grey break-words"
                                      >
                                        - {note}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-sm text-brand-grey/70">No tasks configured.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {(exercise.type === 'reps' || exercise.type === 'isometry') && (
                    <div className={`grid ${exercise.weight_kg != null ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2 text-xs text-brand-grey font-bold w-full mt-2`}>
                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Sets</span>
                        <span className="text-sm text-white">{exercise.sets}</span>
                      </div>

                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                          {exercise.type === 'isometry' ? 'Duration' : 'Reps'}
                        </span>
                        <span className="text-sm text-brand-orange">
                          {exercise.type === 'isometry'
                            ? formatHistoryDuration(exercise.duration_seconds)
                            : formatHistoryTarget(exercise.reps)}
                        </span>
                      </div>

                      {exercise.weight_kg != null && (
                        <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                          <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Weight</span>
                          <span className="text-sm text-white">{formatHistoryWeight(exercise.weight_kg)}</span>
                        </div>
                      )}

                      <div className="bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                          <Clock size={9} className="mr-1" />
                          Rest
                        </span>
                        <span className="text-sm text-brand-lightOrange">{formatSecs(exercise.rest_seconds)}</span>
                      </div>
                    </div>
                  )}

                  {exercise.type === 'superset' && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-brand-grey font-bold w-full mt-2">
                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Rounds</span>
                        <span className="text-sm text-white">{exercise.sets}</span>
                      </div>

                      <div className="bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                          <Clock size={9} className="mr-1" />
                          Rest
                        </span>
                        <span className="text-sm text-brand-lightOrange">{formatSecs(exercise.rest_seconds)}</span>
                      </div>
                    </div>
                  )}

                  {exercise.type === 'circuit' && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-brand-grey font-bold w-full mt-2">
                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Giri (Rounds)</span>
                        <span className="text-sm text-white">{exercise.sets}</span>
                      </div>

                      <div className="bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="text-brand-orange/80 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                          <Clock size={9} className="mr-1" />
                          Rest Giro
                        </span>
                        <span className="text-sm text-brand-orange">{formatSecs(exercise.rest_seconds)}</span>
                      </div>

                      {exercise.total_circuit_duration_seconds != null && exercise.total_circuit_duration_seconds > 0 && (
                        <div className="bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center col-span-2 sm:col-span-1">
                          <span className="text-brand-orange/80 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                            <Timer size={9} className="mr-1" />
                            Tempo Totale
                          </span>
                          <span className="text-sm text-brand-orange font-black">{formatSecs(exercise.total_circuit_duration_seconds)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {exercise.type === 'emom' && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-brand-grey font-bold w-full mt-2">
                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Sets</span>
                        <span className="text-sm text-white">{exercise.sets}</span>
                      </div>

                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Rounds</span>
                        <span className="text-sm text-white">{exercise.emom_rounds || 1}</span>
                      </div>

                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Time/Round</span>
                        <span className="text-sm text-brand-orange">
                          {formatHistoryDuration(exercise.emom_round_duration || exercise.duration_seconds)}
                        </span>
                      </div>

                      <div className="bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center">
                          <Clock size={9} className="mr-1" />
                          Rest
                        </span>
                        <span className="text-sm text-brand-lightOrange">{formatSecs(exercise.rest_seconds)}</span>
                      </div>
                    </div>
                  )}

                  {exercise.type === 'pyramid' && (
                    <div className="grid grid-cols-1 gap-2 text-xs text-brand-grey font-bold w-full mt-2">
                      <div className="bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Steps</span>
                        <span className="text-sm text-white">{exercise.pyramid_steps?.length || 0}</span>
                      </div>
                    </div>
                  )}
                </div>

                {directNotes.length > 0 && (
                  <div className="mt-4 border-t border-white/5 pt-3 space-y-1">
                    {directNotes.map((note, noteIdx) => (
                      <p key={`${exercise.id}:note:${noteIdx}`} className="text-xs text-brand-grey break-words">
                        - {note}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}

        {notesGrouped.genericNotes.length > 0 && (
          <section className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-5">
            <div className="flex items-center mb-3 text-brand-orange">
              <FileText size={16} className="mr-2" />
              <h2 className="text-sm font-black uppercase tracking-wide">General notes</h2>
            </div>
            <div className="space-y-2">
              {notesGrouped.genericNotes.map((note, idx) => (
                <p key={`generic-note:${idx}`} className="text-sm text-brand-grey break-words">
                  - {note}
                </p>
              ))}
            </div>
          </section>
        )}

        {(detail.canRestartFromTemplate && detail.schedaId) || detail.canRestartFromSnapshot ? (
          <button
            onClick={() => {
              if (detail.canRestartFromTemplate && detail.schedaId) {
                clearRestartCheckpoint();
                navigate(`/active-workout/${detail.schedaId}`);
                return;
              }
              clearRestartCheckpoint();
              navigate(`/active-workout-history/${detail.id}`);
            }}
            className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-black py-4 px-5 rounded-full flex items-center justify-center transition-colors mt-2"
          >
            <PlayCircle size={20} className="mr-2" />
            Restart this workout
          </button>
        ) : (
          <div className="w-full bg-brand-darkGrey/40 border border-brand-grey/20 rounded-full py-4 px-5 text-center text-sm text-brand-grey mt-2">
            This workout template was deleted and no exercise snapshot is available for replay.
          </div>
        )}

        <button
          onClick={() => {
            void deleteCurrentHistoryEntry();
          }}
          disabled={isDeletingHistoryEntry}
          className="w-full bg-red-500/15 hover:bg-red-500/20 border border-red-400/40 text-red-200 font-black py-4 px-5 rounded-full flex items-center justify-center transition-colors mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isDeletingHistoryEntry ? (
            <Loader2 size={18} className="mr-2 animate-spin" />
          ) : (
            <Trash2 size={18} className="mr-2" />
          )}
          Delete from history
        </button>
      </main>

      {isExerciseNoteModalOpen && exerciseNoteModalContext && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">Exercise Note</h3>
                <p className="text-xs text-brand-grey mt-1 break-words">{exerciseNoteModalContext.exerciseName}</p>
              </div>
              <button
                onClick={closeExerciseNoteModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close note editor"
                disabled={isSavingExerciseNote}
              >
                <X size={18} />
              </button>
            </div>

            <textarea
              value={exerciseNoteDraft}
              onChange={(event) => setExerciseNoteDraft(event.target.value)}
              placeholder="Write your note for this exercise..."
              className="w-full min-h-[150px] bg-black/40 border border-brand-grey/20 rounded-xl px-4 py-3 text-white text-sm leading-relaxed focus:border-brand-orange outline-none resize-none"
            />

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={closeExerciseNoteModal}
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold"
                disabled={isSavingExerciseNote}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void saveExerciseNote();
                }}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isSavingExerciseNote}
              >
                {isSavingExerciseNote ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Saving...
                  </span>
                ) : (
                  'Save note'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNavigation />
    </div>
  );
};

export default WorkoutHistoryDetailPage;
