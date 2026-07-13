/**
 * GymCardPage.tsx — Libreria delle schede di allenamento dell'utente.
 *
 * Mostra tutte le schede (`schede`) salvate dall'utente con i rispettivi esercizi.
 * Cliccando su una scheda si apre un modal di dettaglio che permette di:
 *  - Visualizzare tutti gli esercizi con tipo, serie, reps/durata, peso e riposo
 *  - Modificare rapidamente i parametri di un esercizio ("quick edit") senza
 *    uscire dalla pagina
 *  - Navigare all'editor completo (NewTrainPage)
 *  - Eliminare la scheda
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * CARICAMENTO DATI
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Viene eseguito un join profondo su Supabase al mount:
 *   schede → esecuzioni → esercizi (nome)
 *              → superset (round_totali)
 *              → emom (round_totali, durata_round_secondi)
 *
 * Il risultato raw viene normalizzato da `parseDbExerciseRows()` che raggruppa
 * le righe piatte in strutture gerarchiche (superset, EMOM, piramide).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * QUICK EDIT (modifica rapida parametri)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `ExerciseQuickEditDraft` è una copia locale (tutti i valori come stringa)
 * dell'esercizio in modifica. Questa scelta consente di validare i valori
 * solo al momento del salvataggio, lasciando libertà di input all'utente.
 *
 * La funzione `saveExerciseQuickEdit` esegue aggiornamenti specifici per tipo:
 *  - reps/isometry : aggiorna la riga `esecuzioni` con UPDATE diretto
 *  - superset      : aggiorna `superset.round_totali` + le righe `esecuzioni`
 *                    (peso/reps per sub-esercizio) in modo ordinato
 *  - emom          : aggiorna `emom` + le righe `esecuzioni`
 *  - pyramid       : aggiorna nome + steps serializzati nel campo nome esercizio
 *
 * Dopo il salvataggio, lo state locale viene aggiornato ottimisticamente
 * tramite `updateExerciseInLocalState` senza rifetch completo.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * VALIDAZIONE INPUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - `parseStrictInt(raw, label, allowZero)` : lancia Error se non intero
 *  - `parseOptionalWeight(raw)` : accetta virgola o punto come separatore decimale,
 *    restituisce null se vuoto o zero (= nessun peso / bodyweight)
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Dumbbell, Calendar, Trash2, Clock, Timer, Repeat, Pencil, Plus, X } from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate } from 'react-router-dom';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  weight_kg?: number | null;
  order_index: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  pyramid_steps?: { reps: number; rest_seconds: number; weight_kg?: number | null }[];
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
    weight_kg?: number | null;
  }[];
}

interface Workout {
  id: string;
  name: string;
  created_at: string;
  exercises: Exercise[];
}

interface ExerciseQuickEditDraft {
  id: string;
  type: Exercise['type'];
  name: string;
  sets: string;
  reps: string;
  duration_seconds: string;
  rest_seconds: string;
  weight_kg: string;
  emom_rounds: string;
  emom_round_duration: string;
  subExercises: {
    name: string;
    type: 'reps' | 'isometry';
    reps: string;
    duration_seconds: string;
    weight_kg: string;
  }[];
  pyramid_steps: {
    reps: string;
    rest_seconds: string;
    weight_kg: string;
  }[];
}

const GymCardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [editingExerciseIndex, setEditingExerciseIndex] = useState<number | null>(null);
  const [exerciseQuickEditDraft, setExerciseQuickEditDraft] = useState<ExerciseQuickEditDraft | null>(null);
  const [isQuickEditSaving, setIsQuickEditSaving] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkouts();
  }, [user]);

  const fetchWorkouts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('schede')
        .select(`
          id_scheda,
          nome,
          data_creazione,
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
        .order('data_creazione', { ascending: false });

      if (error) throw error;
      const parsedWorkouts = (data || []).map((w: any) => ({
        id: String(w.id_scheda),
        name: w.nome,
        created_at: w.data_creazione,
        exercises: parseDbExerciseRows(w.esecuzioni || []) as Exercise[],
      }));
      
      setWorkouts(parsedWorkouts);
    } catch (error) {
      console.error('Error fetching workouts:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteWorkout = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this workout?')) return;
    try {
      const { error } = await supabase.from('schede').delete().eq('id_scheda', Number(id));
      if (error) throw error;
      setWorkouts((prev) => prev.filter((w) => w.id !== id));
      setSelectedWorkout((prev) => (prev?.id === id ? null : prev));
    } catch (error) {
      console.error('Error deleting workout:', error);
    }
  };

  const openWorkoutModal = (workout: Workout) => {
    setSelectedWorkout(workout);
  };

  const closeWorkoutModal = () => {
    setSelectedWorkout(null);
    setEditingExerciseIndex(null);
    setExerciseQuickEditDraft(null);
    setQuickEditError(null);
    setIsQuickEditSaving(false);
  };

  const formatWeightDraft = (value?: number | null) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return String(Math.round(n * 100) / 100).replace('.', ',');
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
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error('Weight must be > 0.');
    }
    return Math.round(n * 100) / 100;
  };

  const openExerciseQuickEdit = (exerciseIndex: number) => {
    if (!selectedWorkout) return;
    const targetExercise = selectedWorkout.exercises[exerciseIndex];
    if (!targetExercise) return;

    setEditingExerciseIndex(exerciseIndex);
    setQuickEditError(null);
    setExerciseQuickEditDraft({
      id: targetExercise.id,
      type: targetExercise.type,
      name: targetExercise.name,
      sets: String(targetExercise.sets || 1),
      reps: String(targetExercise.reps || 1),
      duration_seconds: String(targetExercise.duration_seconds || 1),
      rest_seconds: String(targetExercise.rest_seconds || 0),
      weight_kg: formatWeightDraft(targetExercise.weight_kg),
      emom_rounds: String(targetExercise.emom_rounds || 1),
      emom_round_duration: String(targetExercise.emom_round_duration || targetExercise.duration_seconds || 60),
      subExercises: (targetExercise.subExercises || []).map((sub) => ({
        name: sub.name,
        type: sub.type,
        reps: String(sub.reps || 1),
        duration_seconds: String(sub.duration_seconds || 1),
        weight_kg: formatWeightDraft(sub.weight_kg),
      })),
      pyramid_steps: (targetExercise.pyramid_steps || []).map((step) => ({
        reps: String(step.reps || 1),
        rest_seconds: String(step.rest_seconds || 0),
        weight_kg: formatWeightDraft(step.weight_kg),
      })),
    });
  };

  const closeExerciseQuickEdit = () => {
    if (isQuickEditSaving) return;
    setEditingExerciseIndex(null);
    setExerciseQuickEditDraft(null);
    setQuickEditError(null);
  };

  const updateExerciseInLocalState = (workoutId: string, exerciseIndex: number, updatedExercise: Exercise) => {
    setWorkouts((prev) =>
      prev.map((workout) => {
        if (workout.id !== workoutId) return workout;
        const nextExercises = [...workout.exercises];
        nextExercises[exerciseIndex] = updatedExercise;
        return { ...workout, exercises: nextExercises };
      })
    );

    setSelectedWorkout((prev) => {
      if (!prev || prev.id !== workoutId) return prev;
      const nextExercises = [...prev.exercises];
      nextExercises[exerciseIndex] = updatedExercise;
      return { ...prev, exercises: nextExercises };
    });
  };

  const saveExerciseQuickEdit = async () => {
    if (!selectedWorkout || exerciseQuickEditDraft == null || editingExerciseIndex == null) return;

    setIsQuickEditSaving(true);
    setQuickEditError(null);

    try {
      const schedaId = Number(selectedWorkout.id);
      if (!Number.isFinite(schedaId)) {
        throw new Error('Invalid workout id.');
      }

      const draft = exerciseQuickEditDraft;
      const currentExercise = selectedWorkout.exercises[editingExerciseIndex];
      if (!currentExercise) {
        throw new Error('Selected exercise not found.');
      }

      let updatedExercise: Exercise = currentExercise;

      if (draft.type === 'reps' || draft.type === 'isometry') {
        const nextSets = parseStrictInt(draft.sets, 'Sets');
        const nextRest = parseStrictInt(draft.rest_seconds, 'Rest', true);
        const nextWeight = parseOptionalWeight(draft.weight_kg);
        const nextReps = draft.type === 'reps' ? parseStrictInt(draft.reps, 'Reps') : currentExercise.reps;
        const nextDuration = draft.type === 'isometry' ? parseStrictInt(draft.duration_seconds, 'Duration') : currentExercise.duration_seconds;

        const { error } = await supabase
          .from('esecuzioni')
          .update({
            set_num: nextSets,
            rest_secondi: nextRest > 0 ? nextRest : null,
            peso_kg: nextWeight,
            reps: draft.type === 'reps' ? nextReps : null,
            durata_secondi: draft.type === 'isometry' ? nextDuration : null,
          })
          .eq('id_scheda', schedaId)
          .eq('id_esecuzione', Number(draft.id));
        if (error) throw error;

        updatedExercise = {
          ...currentExercise,
          type: draft.type,
          sets: nextSets,
          rest_seconds: nextRest,
          weight_kg: nextWeight,
          reps: nextReps,
          duration_seconds: nextDuration,
        };
      } else if (draft.type === 'superset') {
        const nextRounds = parseStrictInt(draft.sets, 'Rounds');
        const nextRest = parseStrictInt(draft.rest_seconds, 'Rest', true);

        const normalizedSubs = draft.subExercises.map((sub) => ({
          ...sub,
          reps: sub.type === 'reps' ? parseStrictInt(sub.reps, `${sub.name || 'Superset'} reps`) : sub.reps,
          duration_seconds: sub.type === 'isometry' ? parseStrictInt(sub.duration_seconds, `${sub.name || 'Superset'} duration`) : sub.duration_seconds,
          weight_kg: parseOptionalWeight(sub.weight_kg),
        }));

        const { error: supersetError } = await supabase
          .from('superset')
          .update({ round_totali: nextRounds })
          .eq('id_superset', Number(draft.id));
        if (supersetError) throw supersetError;

        const { error: supersetRowsError } = await supabase
          .from('esecuzioni')
          .update({
            set_num: nextRounds,
            rest_secondi: nextRest > 0 ? nextRest : null,
          })
          .eq('id_scheda', schedaId)
          .eq('id_superset', Number(draft.id));
        if (supersetRowsError) throw supersetRowsError;

        const { data: rows, error: rowsError } = await supabase
          .from('esecuzioni')
          .select('id_esecuzione, ordine')
          .eq('id_scheda', schedaId)
          .eq('id_superset', Number(draft.id))
          .order('ordine', { ascending: true });
        if (rowsError) throw rowsError;

        const orderedRows = rows || [];
        for (let idx = 0; idx < normalizedSubs.length; idx += 1) {
          const row = orderedRows[idx];
          const sub = normalizedSubs[idx];
          if (!row) continue;
          const { error: rowUpdateError } = await supabase
            .from('esecuzioni')
            .update({
              reps: sub.type === 'reps' ? Number(sub.reps) : null,
              durata_secondi: sub.type === 'isometry' ? Number(sub.duration_seconds) : null,
              peso_kg: sub.weight_kg,
            })
            .eq('id_scheda', schedaId)
            .eq('id_esecuzione', Number(row.id_esecuzione));
          if (rowUpdateError) throw rowUpdateError;
        }

        updatedExercise = {
          ...currentExercise,
          sets: nextRounds,
          rest_seconds: nextRest,
          subExercises: normalizedSubs.map((sub) => ({
            name: sub.name,
            type: sub.type,
            reps: sub.type === 'reps' ? Number(sub.reps) : 0,
            duration_seconds: sub.type === 'isometry' ? Number(sub.duration_seconds) : 0,
            weight_kg: sub.weight_kg,
          })),
        };
      } else if (draft.type === 'emom') {
        const nextSets = parseStrictInt(draft.sets, 'Sets');
        const nextRounds = parseStrictInt(draft.emom_rounds, 'Rounds');
        const nextRoundDuration = parseStrictInt(draft.emom_round_duration, 'Round duration');
        const nextRest = parseStrictInt(draft.rest_seconds, 'Rest', true);

        const normalizedSubs = draft.subExercises.map((sub) => ({
          ...sub,
          reps: sub.type === 'reps' ? parseStrictInt(sub.reps, `${sub.name || 'EMOM'} reps`) : sub.reps,
          duration_seconds: sub.type === 'isometry' ? parseStrictInt(sub.duration_seconds, `${sub.name || 'EMOM'} duration`) : sub.duration_seconds,
          weight_kg: parseOptionalWeight(sub.weight_kg),
        }));

        const { error: emomError } = await supabase
          .from('emom')
          .update({
            round_totali: nextRounds,
            durata_round_secondi: nextRoundDuration,
          })
          .eq('id_emom', Number(draft.id));
        if (emomError) throw emomError;

        const { error: emomRowsError } = await supabase
          .from('esecuzioni')
          .update({
            set_num: nextSets,
            rest_secondi: nextRest > 0 ? nextRest : null,
          })
          .eq('id_scheda', schedaId)
          .eq('id_emom', Number(draft.id));
        if (emomRowsError) throw emomRowsError;

        const { data: rows, error: rowsError } = await supabase
          .from('esecuzioni')
          .select('id_esecuzione, ordine')
          .eq('id_scheda', schedaId)
          .eq('id_emom', Number(draft.id))
          .order('ordine', { ascending: true });
        if (rowsError) throw rowsError;

        const orderedRows = rows || [];
        for (let idx = 0; idx < normalizedSubs.length; idx += 1) {
          const row = orderedRows[idx];
          const sub = normalizedSubs[idx];
          if (!row) continue;
          const { error: rowUpdateError } = await supabase
            .from('esecuzioni')
            .update({
              reps: sub.type === 'reps' ? Number(sub.reps) : null,
              durata_secondi: sub.type === 'isometry' ? Number(sub.duration_seconds) : null,
              peso_kg: sub.weight_kg,
            })
            .eq('id_scheda', schedaId)
            .eq('id_esecuzione', Number(row.id_esecuzione));
          if (rowUpdateError) throw rowUpdateError;
        }

        updatedExercise = {
          ...currentExercise,
          sets: nextSets,
          rest_seconds: nextRest,
          emom_rounds: nextRounds,
          emom_round_duration: nextRoundDuration,
          duration_seconds: nextRoundDuration,
          subExercises: normalizedSubs.map((sub) => ({
            name: sub.name,
            type: sub.type,
            reps: sub.type === 'reps' ? Number(sub.reps) : 0,
            duration_seconds: sub.type === 'isometry' ? Number(sub.duration_seconds) : 0,
            weight_kg: sub.weight_kg,
          })),
        };
      } else if (draft.type === 'pyramid') {
        const normalizedSteps = draft.pyramid_steps.map((step, stepIndex) => ({
          reps: parseStrictInt(step.reps, `Step ${stepIndex + 1} reps`),
          rest_seconds: parseStrictInt(step.rest_seconds, `Step ${stepIndex + 1} rest`, true),
          weight_kg: parseOptionalWeight(step.weight_kg),
        }));

        for (let stepIndex = 0; stepIndex < normalizedSteps.length; stepIndex += 1) {
          const step = normalizedSteps[stepIndex];
          const { error: stepUpdateError } = await supabase
            .from('esecuzioni')
            .update({
              reps: step.reps,
              rest_secondi: step.rest_seconds > 0 ? step.rest_seconds : null,
              peso_kg: step.weight_kg,
            })
            .eq('id_scheda', schedaId)
            .eq('id_piramide', Number(draft.id))
            .eq('stepindex_piramide', stepIndex + 1);
          if (stepUpdateError) throw stepUpdateError;
        }

        updatedExercise = {
          ...currentExercise,
          pyramid_steps: normalizedSteps,
        };
      }

      updateExerciseInLocalState(selectedWorkout.id, editingExerciseIndex, updatedExercise);
      closeExerciseQuickEdit();
    } catch (error: any) {
      console.error('Error saving quick exercise edit:', error);
      setQuickEditError(error?.message || 'Unable to save exercise changes.');
    } finally {
      setIsQuickEditSaving(false);
    }
  };

  const updateQuickEditField = (field: keyof ExerciseQuickEditDraft, value: string) => {
    setExerciseQuickEditDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateQuickEditExerciseType = (type: 'reps' | 'isometry') => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, type };
    });
  };

  const updateQuickEditSubField = (
    subIndex: number,
    field: 'reps' | 'duration_seconds' | 'weight_kg',
    value: string,
  ) => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      const nextSubs = [...prev.subExercises];
      if (!nextSubs[subIndex]) return prev;
      nextSubs[subIndex] = { ...nextSubs[subIndex], [field]: value };
      return { ...prev, subExercises: nextSubs };
    });
  };

  const updateQuickEditSubType = (subIndex: number, type: 'reps' | 'isometry') => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      const nextSubs = [...prev.subExercises];
      if (!nextSubs[subIndex]) return prev;
      nextSubs[subIndex] = { ...nextSubs[subIndex], type };
      return { ...prev, subExercises: nextSubs };
    });
  };

  const updateQuickEditPyramidStepField = (
    stepIndex: number,
    field: 'reps' | 'rest_seconds' | 'weight_kg',
    value: string,
  ) => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      const nextSteps = [...prev.pyramid_steps];
      if (!nextSteps[stepIndex]) return prev;
      nextSteps[stepIndex] = { ...nextSteps[stepIndex], [field]: value };
      return { ...prev, pyramid_steps: nextSteps };
    });
  };

  const toNonNegativeInt = (raw: string, max?: number) => {
    const parsed = Math.trunc(Number(raw));
    if (!Number.isFinite(parsed)) return 0;
    if (parsed < 0) return 0;
    if (typeof max === 'number' && parsed > max) return max;
    return parsed;
  };

  const toRestParts = (totalSecondsRaw: string) => {
    const total = toNonNegativeInt(totalSecondsRaw);
    return {
      minutes: Math.floor(total / 60),
      seconds: total % 60,
    };
  };

  const updateQuickEditRestPart = (part: 'min' | 'sec', value: string) => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      const current = toRestParts(prev.rest_seconds);
      const nextMinutes = part === 'min' ? toNonNegativeInt(value) : current.minutes;
      const nextSeconds = part === 'sec' ? toNonNegativeInt(value, 59) : current.seconds;
      return {
        ...prev,
        rest_seconds: String((nextMinutes * 60) + nextSeconds),
      };
    });
  };

  const updateQuickEditRoundDurationPart = (part: 'min' | 'sec', value: string) => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      const current = toRestParts(prev.emom_round_duration);
      const nextMinutes = part === 'min' ? toNonNegativeInt(value) : current.minutes;
      const nextSeconds = part === 'sec' ? toNonNegativeInt(value, 59) : current.seconds;
      return {
        ...prev,
        emom_round_duration: String((nextMinutes * 60) + nextSeconds),
      };
    });
  };

  const updateQuickEditPyramidStepRestPart = (stepIndex: number, part: 'min' | 'sec', value: string) => {
    setExerciseQuickEditDraft((prev) => {
      if (!prev) return prev;
      const nextSteps = [...prev.pyramid_steps];
      if (!nextSteps[stepIndex]) return prev;
      const current = toRestParts(nextSteps[stepIndex].rest_seconds);
      const nextMinutes = part === 'min' ? toNonNegativeInt(value) : current.minutes;
      const nextSeconds = part === 'sec' ? toNonNegativeInt(value, 59) : current.seconds;
      nextSteps[stepIndex] = {
        ...nextSteps[stepIndex],
        rest_seconds: String((nextMinutes * 60) + nextSeconds),
      };
      return { ...prev, pyramid_steps: nextSteps };
    });
  };

  const formatSecs = (totalSecs: number) => {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const formatWeightLabel = (weight?: number | null) => {
    const n = Number(weight);
    if (!Number.isFinite(n) || n <= 0) return 'Body Weight';
    return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`;
  };

  const getExerciseWeightLabel = (exercise: Exercise) => {
    if (exercise.type === 'pyramid') {
      const labels = Array.from(new Set((exercise.pyramid_steps || []).map((step) => formatWeightLabel(step.weight_kg))));
      if (labels.length === 0) return 'Body Weight';
      return labels.length === 1 ? labels[0] : 'Varies';
    }

    if ((exercise.type === 'superset' || exercise.type === 'emom') && exercise.subExercises?.length) {
      const labels = Array.from(new Set(exercise.subExercises.map((sub) => formatWeightLabel(sub.weight_kg))));
      if (labels.length === 0) return 'Body Weight';
      return labels.length === 1 ? labels[0] : 'Varies';
    }

    return formatWeightLabel(exercise.weight_kg);
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24 relative">
      <header className="p-4 relative flex items-center justify-center bg-black/50 sticky top-0 z-20 backdrop-blur-md">
        <h1 className="text-xl font-bold text-center">Your Workouts</h1>
        <button
          onClick={() => navigate('/new-train')}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-brand-orange hover:text-brand-lightOrange transition-colors bg-brand-orange/10 rounded-full shadow-lg"
          title="Create New Workout"
        >
          <Plus size={24} />
        </button>
      </header>

      <main className="flex-1 p-6 w-full max-w-2xl mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center bg-brand-darkGrey/20 border border-dashed border-brand-grey/30 rounded-3xl p-8 mt-12">
            <Dumbbell size={48} className="mx-auto text-brand-grey/50 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">No Workouts</h2>
            <p className="text-brand-grey text-sm mb-6">You haven't created any training programs yet.</p>
            <button 
              onClick={() => navigate('/new-train')}
              className="bg-brand-orange hover:bg-brand-lightOrange text-black font-bold py-3 px-6 rounded-full transition-colors"
            >
              CREATE ONE NOW
            </button>
          </div>
        ) : (
          workouts.map((workout) => (
            <div
              key={workout.id}
              className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-5 shadow-xl relative overflow-hidden cursor-pointer hover:border-brand-grey/40 transition-colors"
              onClick={() => openWorkoutModal(workout)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openWorkoutModal(workout);
                }
              }}
            >
              <div className="absolute top-4 right-4 flex items-center space-x-3 z-10">
                <button 
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/edit-train/${workout.id}`);
                  }}
                  className="p-1 text-brand-grey/40 hover:text-brand-orange transition-colors bg-brand-dark/50 rounded-lg"
                  title="Edit Workout"
                >
                  <Pencil size={20} />
                </button>
                <button 
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteWorkout(workout.id);
                  }}
                  className="p-1 text-brand-grey/40 hover:text-red-500 transition-colors bg-brand-dark/50 rounded-lg"
                  title="Delete Workout"
                >
                  <Trash2 size={20} />
                </button>
              </div>

              <div className="flex items-center pr-20 py-1">
                <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4">
                  <Calendar className="text-brand-orange" size={28} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold text-white leading-tight break-words">{workout.name}</h2>
                  <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                    {new Date(workout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-brand-grey/60 font-bold uppercase tracking-wider mt-3 pl-16">
                Tap to view workout details
              </p>
            </div>
          ))
        )}
      </main>

      {selectedWorkout && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-5"
          onClick={closeWorkoutModal}
        >
          <div
            className="w-full max-w-2xl bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl shadow-2xl max-h-[88vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-2xl font-black text-white leading-tight break-words">{selectedWorkout.name}</h3>
                <p className="text-xs text-brand-grey/70 font-semibold mt-1">
                  Created on {new Date(selectedWorkout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>

              <button
                onClick={closeWorkoutModal}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close details"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(88vh-102px)]">
              {selectedWorkout.exercises && selectedWorkout.exercises.map((ex, i) => {
                const showInlineWeightNearName =
                  (ex.type === 'superset' || ex.type === 'emom') && (ex.subExercises?.length || 0) > 1;

                return (
                <div key={ex.id || i} className="flex flex-col bg-black/40 px-5 py-4 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-brand-grey/60">
                      Exercise {i + 1}
                    </span>
                    <button
                      onClick={() => openExerciseQuickEdit(i)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-brand-orange/30 text-brand-orange text-[11px] font-bold hover:bg-brand-orange/10 transition-colors"
                      title="Edit this exercise"
                    >
                      <Pencil size={12} />
                      Edit Exercise
                    </button>
                  </div>

                  {ex.type === 'superset' || ex.type === 'emom' || ex.type === 'pyramid' ? (
                    <div className="mb-3">
                       <span className="font-bold text-lg text-white drop-shadow-md flex items-center mb-2">
                         <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i+1}.</span>
                         <Repeat size={16} className="mr-1 text-brand-orange"/> {ex.name}
                       </span>
                       <div className="flex flex-col pl-6 border-l-2 border-white/10 space-y-1 mt-1">
                         {ex.type === 'pyramid' ? ex.pyramid_steps?.map((step, sIdx) => (
                           <div key={sIdx} className="text-sm font-semibold text-white/80">
                             Step {sIdx + 1}: <span className="text-brand-orange ml-1 text-xs">{step.reps > 0 ? `${step.reps} reps` : 'MAX'}</span> <span className="text-brand-grey/70 text-xs">/ rest {formatSecs(step.rest_seconds)}</span>
                           </div>
                         )) : ex.subExercises?.map((sub, sIdx) => (
                           <div key={sIdx} className="text-sm font-semibold text-white/80">
                             {sub.name} <span className="text-brand-orange ml-1 text-xs">({sub.type === 'reps' ? (sub.reps > 0 ? `${sub.reps} reps` : 'MAX REPS') : (sub.duration_seconds > 0 ? `${sub.duration_seconds} s` : 'MAX TIME')})</span>
                             {showInlineWeightNearName && (
                               <span className="text-brand-grey/70 text-xs ml-1">{formatWeightLabel(sub.weight_kg)}</span>
                             )}
                           </div>
                         ))}
                       </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center mb-2">
                       <span className="font-bold text-lg text-white truncate max-w-[70%] drop-shadow-md flex items-center">
                          <span className="text-brand-orange opacity-40 mr-2 text-xs font-black">{i+1}.</span>
                          {ex.name}
                       </span>
                       <div className="flex items-center text-xs font-bold px-2 py-1 rounded bg-brand-darkGrey text-white shadow-inner">
                          {ex.type === 'isometry' ? <Timer size={12} className="mr-1 text-brand-orange"/> : <Repeat size={12} className="mr-1 text-brand-orange"/>}
                          {ex.type === 'isometry' ? 'ISOMETRIC' : 'REPS'}
                       </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 min-[450px]:grid-cols-4 gap-2 text-xs text-brand-grey font-bold w-full mt-2">
                    <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                      <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                        {ex.type === 'superset' ? 'Round' : (ex.type === 'emom' ? 'Rounds' : ex.type === 'pyramid' ? 'Steps' : 'Sets')}
                      </span>
                      <span className="text-sm text-white">{ex.type === 'pyramid' ? (ex.pyramid_steps?.length || 0) : ex.sets}</span>
                    </div>

                    {ex.type !== 'superset' && ex.type !== 'pyramid' && (
                      <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">
                          {ex.type === 'isometry' ? 'Duration' : (ex.type === 'emom' ? 'Time/Rnd' : 'Reps')}
                        </span>
                        <span className="text-sm text-brand-orange">{ex.type === 'isometry' || ex.type === 'emom' ? (ex.duration_seconds > 0 ? formatSecs(ex.duration_seconds) : 'MAX TIME') : (ex.reps > 0 ? ex.reps : 'MAX REPS')}</span>
                      </div>
                    )}

                    {ex.type !== 'pyramid' && (
                      <div className="flex-1 bg-brand-orange/10 border border-brand-orange/20 py-2 px-3 rounded-lg text-center flex flex-col justify-center">
                        <span className="text-brand-orange/70 text-[9px] uppercase tracking-wider mb-1 flex justify-center items-center"><Clock size={9} className="mr-1"/> Rest</span>
                        <span className="text-sm text-brand-lightOrange">{formatSecs(ex.rest_seconds)}</span>
                      </div>
                    )}

                    {!showInlineWeightNearName && (
                      <div className="flex-1 bg-white/5 py-2 px-3 rounded-lg text-center flex flex-col justify-center border border-white/10">
                        <span className="opacity-50 text-[9px] uppercase tracking-wider mb-1">Weights</span>
                        <span className="text-sm text-brand-lightOrange truncate">{getExerciseWeightLabel(ex)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )})}

              {(!selectedWorkout.exercises || selectedWorkout.exercises.length === 0) && (
                <p className="text-sm text-brand-grey/50 italic text-center py-4 bg-black/20 rounded-2xl">No exercises in this workout.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {exerciseQuickEditDraft && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-5"
          onClick={closeExerciseQuickEdit}
        >
          <div
            className="w-full max-w-lg bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl shadow-2xl max-h-[88vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-5 border-b border-white/10 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-xl font-black text-white leading-tight break-words">Quick Edit Exercise</h3>
                <p className="text-xs text-brand-grey/70 font-semibold mt-1 truncate">{exerciseQuickEditDraft.name}</p>
              </div>

              <button
                onClick={closeExerciseQuickEdit}
                className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                title="Close quick edit"
                disabled={isQuickEditSaving}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-[calc(88vh-154px)] space-y-4">
              {(exerciseQuickEditDraft.type === 'reps' || exerciseQuickEditDraft.type === 'isometry') && (
                <>
                  <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                    <button
                      onClick={() => updateQuickEditExerciseType('reps')}
                      className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${exerciseQuickEditDraft.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                    >
                      REPS
                    </button>
                    <button
                      onClick={() => updateQuickEditExerciseType('isometry')}
                      className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${exerciseQuickEditDraft.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                    >
                      ISOMETRIC
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-brand-grey">Sets
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseQuickEditDraft.sets}
                        onChange={(e) => updateQuickEditField('sets', e.target.value)}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>

                    <div className="flex flex-col">
                      <label className="text-sm text-brand-grey">Rest</label>
                      <div className="mt-1 flex bg-black/40 border border-brand-grey/20 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                        <div className="relative flex-1 border-r border-brand-grey/10">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={toRestParts(exerciseQuickEditDraft.rest_seconds).minutes}
                            onChange={(e) => updateQuickEditRestPart('min', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">MIN</span>
                        </div>
                        <div className="relative flex-1">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            max={59}
                            value={toRestParts(exerciseQuickEditDraft.rest_seconds).seconds}
                            onChange={(e) => updateQuickEditRestPart('sec', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">SEC</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {exerciseQuickEditDraft.type === 'reps' ? (
                    <label className="text-sm text-brand-grey">Reps
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseQuickEditDraft.reps}
                        onChange={(e) => updateQuickEditField('reps', e.target.value)}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                  ) : (
                    <label className="text-sm text-brand-grey">Duration (sec)
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseQuickEditDraft.duration_seconds}
                        onChange={(e) => updateQuickEditField('duration_seconds', e.target.value)}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>
                  )}

                  <label className="text-sm text-brand-grey">Weight (kg)
                    <input
                      type="text"
                      value={exerciseQuickEditDraft.weight_kg}
                      onChange={(e) => updateQuickEditField('weight_kg', e.target.value)}
                      placeholder="body Weight"
                      className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                    />
                  </label>
                </>
              )}

              {exerciseQuickEditDraft.type === 'superset' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-brand-grey">Rounds
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseQuickEditDraft.sets}
                        onChange={(e) => updateQuickEditField('sets', e.target.value)}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>

                    <div className="flex flex-col">
                      <label className="text-sm text-brand-grey">Rest Between Rounds</label>
                      <div className="mt-1 flex bg-black/40 border border-brand-grey/20 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                        <div className="relative flex-1 border-r border-brand-grey/10">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={toRestParts(exerciseQuickEditDraft.rest_seconds).minutes}
                            onChange={(e) => updateQuickEditRestPart('min', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">MIN</span>
                        </div>
                        <div className="relative flex-1">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            max={59}
                            value={toRestParts(exerciseQuickEditDraft.rest_seconds).seconds}
                            onChange={(e) => updateQuickEditRestPart('sec', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">SEC</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {exerciseQuickEditDraft.subExercises.map((sub, subIdx) => (
                      <div key={`${sub.name}:${subIdx}`} className="border border-white/10 rounded-xl p-3 bg-black/20 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-brand-grey/70">{sub.name || `Exercise ${subIdx + 1}`}</p>
                        <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                          <button
                            onClick={() => updateQuickEditSubType(subIdx, 'reps')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            REPS
                          </button>
                          <button
                            onClick={() => updateQuickEditSubType(subIdx, 'isometry')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            ISOMETRIC
                          </button>
                        </div>
                        {sub.type === 'reps' ? (
                          <label className="text-sm text-brand-grey">Reps
                            <input
                              type="number" inputMode="numeric"
                              min={1}
                              value={sub.reps}
                              onChange={(e) => updateQuickEditSubField(subIdx, 'reps', e.target.value)}
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        ) : (
                          <label className="text-sm text-brand-grey">Duration (sec)
                            <input
                              type="number" inputMode="numeric"
                              min={1}
                              value={sub.duration_seconds}
                              onChange={(e) => updateQuickEditSubField(subIdx, 'duration_seconds', e.target.value)}
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        )}
                        <label className="text-sm text-brand-grey">Weight (kg)
                          <input
                            type="text"
                            value={sub.weight_kg}
                            onChange={(e) => updateQuickEditSubField(subIdx, 'weight_kg', e.target.value)}
                            placeholder="body Weight"
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {exerciseQuickEditDraft.type === 'emom' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-brand-grey">Sets
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseQuickEditDraft.sets}
                        onChange={(e) => updateQuickEditField('sets', e.target.value)}
                        className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                      />
                    </label>

                    <label className="text-sm text-brand-grey">Rounds
                      <input
                        type="number" inputMode="numeric"
                        min={1}
                        value={exerciseQuickEditDraft.emom_rounds}
                        onChange={(e) => updateQuickEditField('emom_rounds', e.target.value)}
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
                            value={toRestParts(exerciseQuickEditDraft.emom_round_duration).minutes}
                            onChange={(e) => updateQuickEditRoundDurationPart('min', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">MIN</span>
                        </div>
                        <div className="relative flex-1">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            max={59}
                            value={toRestParts(exerciseQuickEditDraft.emom_round_duration).seconds}
                            onChange={(e) => updateQuickEditRoundDurationPart('sec', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">SEC</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col">
                      <label className="text-sm text-brand-grey">Rest Between Sets</label>
                      <div className="mt-1 flex bg-black/40 border border-brand-grey/20 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                        <div className="relative flex-1 border-r border-brand-grey/10">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            value={toRestParts(exerciseQuickEditDraft.rest_seconds).minutes}
                            onChange={(e) => updateQuickEditRestPart('min', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">MIN</span>
                        </div>
                        <div className="relative flex-1">
                          <input
                            type="number" inputMode="numeric"
                            min={0}
                            max={59}
                            value={toRestParts(exerciseQuickEditDraft.rest_seconds).seconds}
                            onChange={(e) => updateQuickEditRestPart('sec', e.target.value)}
                            className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                          />
                          <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">SEC</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {exerciseQuickEditDraft.subExercises.map((sub, subIdx) => (
                      <div key={`${sub.name}:${subIdx}`} className="border border-white/10 rounded-xl p-3 bg-black/20 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-brand-grey/70">{sub.name || `Task ${subIdx + 1}`}</p>
                        <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                          <button
                            onClick={() => updateQuickEditSubType(subIdx, 'reps')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            REPS
                          </button>
                          <button
                            onClick={() => updateQuickEditSubType(subIdx, 'isometry')}
                            className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors ${sub.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                          >
                            ISOMETRIC
                          </button>
                        </div>
                        {sub.type === 'reps' ? (
                          <label className="text-sm text-brand-grey">Reps
                            <input
                              type="number" inputMode="numeric"
                              min={1}
                              value={sub.reps}
                              onChange={(e) => updateQuickEditSubField(subIdx, 'reps', e.target.value)}
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        ) : (
                          <label className="text-sm text-brand-grey">Duration (sec)
                            <input
                              type="number" inputMode="numeric"
                              min={1}
                              value={sub.duration_seconds}
                              onChange={(e) => updateQuickEditSubField(subIdx, 'duration_seconds', e.target.value)}
                              className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                            />
                          </label>
                        )}
                        <label className="text-sm text-brand-grey">Weight (kg)
                          <input
                            type="text"
                            value={sub.weight_kg}
                            onChange={(e) => updateQuickEditSubField(subIdx, 'weight_kg', e.target.value)}
                            placeholder="body Weight"
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {exerciseQuickEditDraft.type === 'pyramid' && (
                <div className="space-y-3">
                  {exerciseQuickEditDraft.pyramid_steps.map((step, stepIdx) => (
                    <div key={stepIdx} className="border border-white/10 rounded-xl p-3 bg-black/20 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-brand-grey/70">Step {stepIdx + 1}</p>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm text-brand-grey">Reps
                          <input
                            type="number" inputMode="numeric"
                            min={1}
                            value={step.reps}
                            onChange={(e) => updateQuickEditPyramidStepField(stepIdx, 'reps', e.target.value)}
                            className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                          />
                        </label>

                        <div className="flex flex-col">
                          <label className="text-sm text-brand-grey">Rest</label>
                          <div className="mt-1 flex bg-black/40 border border-brand-grey/20 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[42px]">
                            <div className="relative flex-1 border-r border-brand-grey/10">
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                value={toRestParts(step.rest_seconds).minutes}
                                onChange={(e) => updateQuickEditPyramidStepRestPart(stepIdx, 'min', e.target.value)}
                                className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                              />
                              <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">MIN</span>
                            </div>
                            <div className="relative flex-1">
                              <input
                                type="number" inputMode="numeric"
                                min={0}
                                max={59}
                                value={toRestParts(step.rest_seconds).seconds}
                                onChange={(e) => updateQuickEditPyramidStepRestPart(stepIdx, 'sec', e.target.value)}
                                className="w-full h-full bg-transparent pt-3 pb-1 px-3 text-center text-white focus:outline-none"
                              />
                              <span className="text-[8px] text-brand-grey/60 uppercase absolute top-1 left-2 font-bold tracking-wider pointer-events-none">SEC</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <label className="text-sm text-brand-grey">Weight (kg)
                        <input
                          type="text"
                          value={step.weight_kg}
                          onChange={(e) => updateQuickEditPyramidStepField(stepIdx, 'weight_kg', e.target.value)}
                          placeholder="body Weight"
                          className="mt-1 w-full bg-black/40 border border-brand-grey/20 rounded-xl px-3 py-2 text-white focus:border-brand-orange outline-none"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}

              {quickEditError && (
                <p className="text-sm text-red-300">{quickEditError}</p>
              )}
            </div>

            <div className="p-5 border-t border-white/10 flex justify-end gap-3">
              <button
                onClick={closeExerciseQuickEdit}
                disabled={isQuickEditSaving}
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveExerciseQuickEdit}
                disabled={isQuickEditSaving}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black disabled:opacity-60"
              >
                {isQuickEditSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNavigation hidden={Boolean(selectedWorkout) || Boolean(exerciseQuickEditDraft)} />
    </div>
  );
};

export default GymCardPage;
