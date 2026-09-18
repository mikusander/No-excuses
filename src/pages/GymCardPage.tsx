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
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  Dumbbell,
  Calendar,
  Trash2,
  Clock,
  Timer,
  Repeat,
  Pencil,
  Plus,
  X,
  Copy,
  Loader2,
  Folder,
  FolderPlus,
  FolderInput,
  FolderOpen,
  ArrowLeft,
  ChevronRight,
  Check,
} from 'lucide-react';
import BottomNavigation from '../components/BottomNavigation';
import { useNavigate, useLocation } from 'react-router-dom';
import { parseDbExerciseRows } from '../lib/workoutSchemaAdapter';
import { saveExercisesToDb, type SaveExercise } from '../lib/workoutSaveHelper';
import {
  getFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  getFolderAssignments,
  assignSchedaToFolder,
  moveSchedeToFolder,
  subscribeToFolderChanges,
  syncFoldersWithCloud,
  type WorkoutFolder,
  type FolderAssignmentMap,
} from '../utils/folderManager';

interface Exercise {
  id: string;
  type: 'reps' | 'isometry' | 'superset' | 'circuit' | 'emom' | 'pyramid';
  name: string;
  instruction_note?: string;
  auto_count_type?: 'pushups' | 'pullups' | null;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  transition_rest_seconds?: number;
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
    instruction_note?: string;
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
  const [duplicatingWorkoutId, setDuplicatingWorkoutId] = useState<string | null>(null);

  const location = useLocation();
  const [folders, setFolders] = useState<WorkoutFolder[]>(() => getFolders(user?.id));
  const [folderAssignments, setFolderAssignments] = useState<FolderAssignmentMap>(() => getFolderAssignments(user?.id));
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    return (location.state as any)?.openFolderId || null;
  });

  // Modali cartella
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [folderNameToCreate, setFolderNameToCreate] = useState('');
  const [folderColorToCreate, setFolderColorToCreate] = useState('#ff7700');

  const [folderToRename, setFolderToRename] = useState<WorkoutFolder | null>(null);
  const [renamedFolderName, setRenamedFolderName] = useState('');

  // Modale per spostare schede multiple in una cartella
  const [isMoveSchedeModalOpen, setIsMoveSchedeModalOpen] = useState(false);
  const [selectedSchedeIdsToMove, setSelectedSchedeIdsToMove] = useState<Set<string>>(new Set());

  // Modale per spostare una singola scheda
  const [singleSchedaToAssign, setSingleSchedaToAssign] = useState<Workout | null>(null);

  useEffect(() => {
    setFolders(getFolders(user?.id));
    setFolderAssignments(getFolderAssignments(user?.id));

    if (user?.id) {
      void syncFoldersWithCloud(user.id);
    }

    const unsubscribe = subscribeToFolderChanges(() => {
      setFolders(getFolders(user?.id));
      setFolderAssignments(getFolderAssignments(user?.id));
    });

    return unsubscribe;
  }, [user?.id]);

  // Cartella attualmente aperta (se presente)
  const currentFolder = useMemo(() => {
    if (!currentFolderId) return null;
    return folders.find((f) => f.id === currentFolderId) || null;
  }, [folders, currentFolderId]);

  // Se la cartella aperta non esiste più (es. cancellata), torna alla radice
  useEffect(() => {
    if (currentFolderId && !currentFolder) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, currentFolder]);

  // Schede nella cartella aperta
  const folderWorkouts = useMemo(() => {
    if (!currentFolderId) return [];
    return workouts.filter((w) => folderAssignments[w.id] === currentFolderId);
  }, [workouts, folderAssignments, currentFolderId]);

  // Schede senza cartella (livello radice)
  const rootWorkouts = useMemo(() => {
    return workouts.filter((w) => {
      const fId = folderAssignments[w.id];
      return !fId || !folders.some((f) => f.id === fId);
    });
  }, [workouts, folderAssignments, folders]);

  // Schede disponibili da spostare nella cartella corrente (tutte tranne quelle già dentro)
  const candidateWorkoutsToMove = useMemo(() => {
    if (!currentFolderId) return [];
    return workouts.filter((w) => folderAssignments[w.id] !== currentFolderId);
  }, [workouts, folderAssignments, currentFolderId]);

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

  const duplicateWorkout = async (workout: Workout) => {
    if (!user || duplicatingWorkoutId) return;
    try {
      setDuplicatingWorkoutId(workout.id);
      
      const copyName = `${workout.name} (Copy)`;
      const { data: newScheda, error: schedaError } = await supabase
        .from('schede')
        .insert([{
          id_utente: user.id,
          nome: copyName,
        }])
        .select('id_scheda, nome, data_creazione')
        .single();

      if (schedaError) throw schedaError;
      if (!newScheda) throw new Error('Failed to duplicate workout.');

      if (workout.exercises && workout.exercises.length > 0) {
        const exercisesToSave: SaveExercise[] = workout.exercises.map((ex) => ({
          id: crypto.randomUUID(),
          type: ex.type,
          name: ex.name,
          instruction_note: ex.instruction_note,
          auto_count_type: ex.auto_count_type,
          sets: ex.sets || 1,
          reps: ex.reps || 0,
          duration_seconds: ex.duration_seconds || 0,
          rest_seconds: ex.rest_seconds || 0,
          transition_rest_seconds: ex.transition_rest_seconds,
          weight_kg: ex.weight_kg,
          emom_rounds: ex.emom_rounds,
          emom_round_duration: ex.emom_round_duration,
          pyramid_steps: ex.pyramid_steps ? ex.pyramid_steps.map((s) => ({ ...s })) : undefined,
          subExercises: ex.subExercises ? ex.subExercises.map((s) => ({ ...s })) : undefined,
        }));

        await saveExercisesToDb(newScheda.id_scheda, exercisesToSave);
      }

      await fetchWorkouts();
    } catch (error: any) {
      console.error('Error duplicating workout:', error);
      alert(error?.message || 'Error duplicating workout');
    } finally {
      setDuplicatingWorkoutId(null);
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
      } else if (draft.type === 'superset' || draft.type === 'circuit') {
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

    if ((exercise.type === 'superset' || exercise.type === 'circuit' || exercise.type === 'emom') && exercise.subExercises?.length) {
      const labels = Array.from(new Set(exercise.subExercises.map((sub) => formatWeightLabel(sub.weight_kg))));
      if (labels.length === 0) return 'Body Weight';
      return labels.length === 1 ? labels[0] : 'Varies';
    }

    return formatWeightLabel(exercise.weight_kg);
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col safe-pb-nav relative">
      <header
        className="px-4 pb-3.5 relative flex items-center justify-between bg-black/75 backdrop-blur-2xl border-b border-white/5 sticky top-0 z-20"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
      >
        {currentFolder ? (
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setCurrentFolderId(null)}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white hover:text-brand-orange transition-colors shrink-0 cursor-pointer"
              title="Torna a tutte le schede"
            >
              <ArrowLeft size={22} />
            </button>
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: currentFolder.color || '#ff7700' }}
              />
              <h1 className="text-lg sm:text-xl font-black text-white truncate">
                {currentFolder.name}
              </h1>
            </div>
          </div>
        ) : (
          <h1 className="text-xl font-bold text-center flex-1">Your Workouts</h1>
        )}

        <div className="flex items-center gap-2">
          {!currentFolder && (
            <button
              onClick={() => {
                setFolderNameToCreate('');
                setFolderColorToCreate('#ff7700');
                setIsCreateFolderModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-extrabold text-brand-orange hover:text-brand-lightOrange bg-brand-orange/15 border border-brand-orange/30 hover:bg-brand-orange/25 transition-all rounded-full shadow-md cursor-pointer active:scale-95"
              title="Crea Nuova Cartella"
            >
              <FolderPlus size={16} />
              <span className="hidden sm:inline">Nuova Cartella</span>
            </button>
          )}

          <button
            onClick={() => {
              if (currentFolderId) {
                navigate(`/new-train?folderId=${currentFolderId}`);
              } else {
                navigate('/new-train');
              }
            }}
            className="p-2 text-brand-orange hover:text-brand-lightOrange transition-colors bg-brand-orange/10 rounded-full shadow-lg cursor-pointer active:scale-95"
            title={currentFolder ? `Crea Scheda in "${currentFolder.name}"` : 'Crea Nuova Scheda'}
          >
            <Plus size={24} />
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 w-full max-w-2xl mx-auto space-y-6">
        {loading ? (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-brand-orange border-b-2 border-brand-darkGrey"></div>
          </div>
        ) : currentFolder ? (
          /* ─── VISTA INTERNA ALLA CARTELLA ──────────────────────────────── */
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* Header info cartella & azioni veloci */}
            <div className="bg-gradient-to-r from-brand-darkGrey/60 via-black/40 to-transparent border border-white/10 rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: currentFolder.color || '#ff7700' }}
                  />
                  <h2 className="text-xl font-black text-white">
                    {currentFolder.name}
                  </h2>
                </div>
                <p className="text-xs text-brand-grey/70 mt-1">
                  {folderWorkouts.length} {folderWorkouts.length === 1 ? 'scheda all\'interno' : 'schede all\'interno'}
                </p>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => {
                    setFolderToRename(currentFolder);
                    setRenamedFolderName(currentFolder.name);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-brand-grey hover:text-white border border-white/10 transition-colors text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  title="Rinomina cartella"
                >
                  <Pencil size={14} />
                  <span>Rinomina</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Vuoi eliminare la cartella "${currentFolder.name}"? Le schede contenute torneranno all'elenco principale.`)) {
                      deleteFolder(currentFolder.id, user?.id);
                      setCurrentFolderId(null);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  title="Elimina cartella"
                >
                  <Trash2 size={14} />
                  <span>Elimina</span>
                </button>
              </div>
            </div>

            {/* Barra azioni interna: Crea Scheda qui & Sposta Schede Esistenti */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => navigate(`/new-train?folderId=${currentFolder.id}`)}
                className="flex items-center justify-center gap-2 p-3.5 rounded-2xl bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-sm transition-all shadow-lg shadow-brand-orange/20 cursor-pointer active:scale-95"
              >
                <Plus size={18} />
                <span>Crea Scheda Qui</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedSchedeIdsToMove(new Set());
                  setIsMoveSchedeModalOpen(true);
                }}
                className="flex items-center justify-center gap-2 p-3.5 rounded-2xl bg-brand-darkGrey/40 hover:bg-brand-darkGrey/70 border border-white/10 text-white font-bold text-sm transition-all cursor-pointer active:scale-95"
              >
                <FolderInput size={18} className="text-brand-orange" />
                <span>Sposta Schede ({candidateWorkoutsToMove.length} disponibili)</span>
              </button>
            </div>

            {/* Schede nella cartella */}
            {folderWorkouts.length === 0 ? (
              <div className="text-center bg-brand-darkGrey/20 border border-dashed border-white/15 rounded-3xl p-8 mt-4">
                <FolderOpen size={44} className="mx-auto text-brand-grey/40 mb-3" />
                <h3 className="text-base font-bold text-white mb-1">Questa cartella è vuota</h3>
                <p className="text-xs text-brand-grey/70 mb-5">
                  Crea una nuova scheda al suo interno oppure sposta qui delle schede già create.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={() => navigate(`/new-train?folderId=${currentFolder.id}`)}
                    className="bg-brand-orange hover:bg-brand-lightOrange text-black font-black text-xs uppercase px-4 py-2.5 rounded-xl transition-all cursor-pointer active:scale-95 shadow-md shadow-brand-orange/20"
                  >
                    Crea Scheda Qui
                  </button>
                  {candidateWorkoutsToMove.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectedSchedeIdsToMove(new Set());
                        setIsMoveSchedeModalOpen(true);
                      }}
                      className="bg-white/10 hover:bg-white/15 text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-white/10 transition-all cursor-pointer active:scale-95"
                    >
                      Sposta Schede Esistenti
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {folderWorkouts.map((workout) => (
                  <div
                    key={workout.id}
                    className="bg-brand-darkGrey/40 border border-brand-grey/20 rounded-3xl p-5 shadow-xl relative overflow-hidden cursor-pointer hover:border-brand-orange/40 transition-colors"
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
                    <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setSingleSchedaToAssign(workout);
                        }}
                        className="p-1 text-brand-grey/40 hover:text-brand-orange transition-colors bg-brand-dark/50 rounded-lg"
                        title="Sposta in un'altra cartella o rimuovi"
                      >
                        <FolderInput size={20} />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void duplicateWorkout(workout);
                        }}
                        disabled={duplicatingWorkoutId === workout.id}
                        className="p-1 text-brand-grey/40 hover:text-brand-orange transition-colors bg-brand-dark/50 rounded-lg disabled:opacity-50"
                        title="Duplicate Workout"
                      >
                        {duplicatingWorkoutId === workout.id ? (
                          <Loader2 size={20} className="animate-spin text-brand-orange" />
                        ) : (
                          <Copy size={20} />
                        )}
                      </button>
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

                    <div className="flex items-center pr-28 py-1">
                      <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4 shrink-0">
                        <Calendar className="text-brand-orange" size={28} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight break-words">{workout.name}</h2>
                        <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                          {new Date(workout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                      </div>
                    </div>

                    <p className="text-[11px] text-brand-grey/60 font-bold uppercase tracking-wider mt-3 pl-16">
                      Tap to view workout details
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ─── VISTA RADICE (CARTELLE + SCHEDE SENZA CARTELLA) ─────────────── */
          <div className="space-y-6">
            {/* Sezione Cartelle */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Folder className="text-brand-orange" size={20} />
                  <h2 className="text-base font-black text-white uppercase tracking-wider">Cartelle</h2>
                  {folders.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange font-bold border border-brand-orange/30">
                      {folders.length}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setFolderNameToCreate('');
                    setFolderColorToCreate('#ff7700');
                    setIsCreateFolderModalOpen(true);
                  }}
                  className="text-xs font-bold text-brand-orange hover:text-brand-lightOrange flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-orange/10 border border-brand-orange/30 active:scale-95 transition-all cursor-pointer shadow-sm"
                >
                  <FolderPlus size={15} />
                  <span>+ Nuova Cartella</span>
                </button>
              </div>

              {folders.length === 0 ? (
                <div className="bg-brand-darkGrey/20 border border-dashed border-white/10 rounded-2xl p-4 text-center">
                  <p className="text-xs text-brand-grey/70">
                    Non hai ancora creato nessuna cartella. Clicca su "+ Nuova Cartella" per organizzare le tue schede.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {folders.map((folder) => {
                    const count = workouts.filter((w) => folderAssignments[w.id] === folder.id).length;
                    return (
                      <div
                        key={folder.id}
                        onClick={() => setCurrentFolderId(folder.id)}
                        className="bg-brand-darkGrey/35 hover:bg-brand-darkGrey/60 border border-white/10 hover:border-brand-orange/40 rounded-2xl p-4 transition-all cursor-pointer group flex items-center justify-between shadow-lg relative"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="p-2.5 rounded-xl text-black font-bold shrink-0 shadow-md transition-transform group-hover:scale-105"
                            style={{ backgroundColor: folder.color || '#ff7700' }}
                          >
                            <Folder size={22} className="text-black fill-black/30" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-white text-base truncate group-hover:text-brand-orange transition-colors">
                              {folder.name}
                            </h3>
                            <p className="text-xs text-brand-grey/60 mt-0.5 font-medium">
                              {count} {count === 1 ? 'scheda' : 'schede'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolderToRename(folder);
                              setRenamedFolderName(folder.name);
                            }}
                            className="p-1.5 text-brand-grey/40 hover:text-white transition-colors rounded-lg"
                            title="Rinomina cartella"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Vuoi eliminare la cartella "${folder.name}"? Le schede contenute torneranno all'elenco principale.`)) {
                                deleteFolder(folder.id, user?.id);
                              }
                            }}
                            className="p-1.5 text-brand-grey/40 hover:text-red-400 transition-colors rounded-lg"
                            title="Elimina cartella"
                          >
                            <Trash2 size={15} />
                          </button>
                          <ChevronRight size={18} className="text-brand-grey/40 group-hover:text-brand-orange transition-colors" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sezione Schede Libere / Tutte le schede */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Dumbbell className="text-brand-orange" size={20} />
                  <h2 className="text-base font-black text-white uppercase tracking-wider">
                    {folders.length > 0 ? 'Schede senza cartella' : 'Le tue Schede'}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/80 font-bold">
                    {rootWorkouts.length}
                  </span>
                </div>
              </div>

              {rootWorkouts.length === 0 ? (
                <div className="text-center bg-brand-darkGrey/20 border border-dashed border-brand-grey/30 rounded-3xl p-8 mt-2">
                  <Dumbbell size={48} className="mx-auto text-brand-grey/50 mb-4" />
                  <h2 className="text-lg font-bold text-white mb-2">
                    {folders.length > 0 ? 'Tutte le schede sono organizzate in cartelle' : 'Nessuna scheda creata'}
                  </h2>
                  <p className="text-brand-grey text-xs sm:text-sm mb-6">
                    {folders.length > 0
                      ? 'Puoi creare una nuova scheda libera o aprirne una dalle cartelle in alto.'
                      : 'Non hai ancora creato nessuna scheda di allenamento.'}
                  </p>
                  <button 
                    onClick={() => navigate('/new-train')}
                    className="bg-brand-orange hover:bg-brand-lightOrange text-black font-extrabold py-3 px-6 rounded-full transition-colors text-xs uppercase tracking-wider"
                  >
                    CREA NUOVA SCHEDA
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {rootWorkouts.map((workout) => (
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
                      <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
                        {folders.length > 0 && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setSingleSchedaToAssign(workout);
                            }}
                            className="p-1 text-brand-grey/40 hover:text-brand-orange transition-colors bg-brand-dark/50 rounded-lg"
                            title="Sposta in una cartella"
                          >
                            <FolderInput size={20} />
                          </button>
                        )}
                        <button 
                          onClick={(event) => {
                            event.stopPropagation();
                            void duplicateWorkout(workout);
                          }}
                          disabled={duplicatingWorkoutId === workout.id}
                          className="p-1 text-brand-grey/40 hover:text-brand-orange transition-colors bg-brand-dark/50 rounded-lg disabled:opacity-50"
                          title="Duplicate Workout"
                        >
                          {duplicatingWorkoutId === workout.id ? (
                            <Loader2 size={20} className="animate-spin text-brand-orange" />
                          ) : (
                            <Copy size={20} />
                          )}
                        </button>
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

                      <div className="flex items-center pr-28 py-1">
                        <div className="bg-brand-orange/20 p-3 rounded-2xl mr-4 shrink-0">
                          <Calendar className="text-brand-orange" size={28} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight break-words">{workout.name}</h2>
                          <p className="text-xs text-brand-grey/60 font-semibold mt-1">
                            {new Date(workout.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                        </div>
                      </div>

                      <p className="text-[11px] text-brand-grey/60 font-bold uppercase tracking-wider mt-3 pl-16">
                        Tap to view workout details
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => {
                    void duplicateWorkout(selectedWorkout);
                    closeWorkoutModal();
                  }}
                  className="p-2 rounded-full text-brand-grey hover:text-brand-orange hover:bg-white/5 transition-colors"
                  title="Duplicate Workout"
                >
                  <Copy size={18} />
                </button>
                <button
                  onClick={closeWorkoutModal}
                  className="p-2 rounded-full text-brand-grey hover:text-white hover:bg-white/5 transition-colors"
                  title="Close details"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(88vh-102px)]">
              {selectedWorkout.exercises && selectedWorkout.exercises.map((ex, i) => {
                const showInlineWeightNearName =
                  (ex.type === 'superset' || ex.type === 'circuit' || ex.type === 'emom') && (ex.subExercises?.length || 0) > 1;

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

                  {ex.type === 'superset' || ex.type === 'circuit' || ex.type === 'emom' || ex.type === 'pyramid' ? (
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
                        {ex.type === 'circuit' ? 'Giri' : ex.type === 'superset' ? 'Round' : (ex.type === 'emom' ? 'Rounds' : ex.type === 'pyramid' ? 'Steps' : 'Sets')}
                      </span>
                      <span className="text-sm text-white">{ex.type === 'pyramid' ? (ex.pyramid_steps?.length || 0) : ex.sets}</span>
                    </div>

                    {ex.type !== 'superset' && ex.type !== 'circuit' && ex.type !== 'pyramid' && (
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

              {(exerciseQuickEditDraft.type === 'superset' || exerciseQuickEditDraft.type === 'circuit') && (
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

      {/* ─── MODALE CREA NUOVA CARTELLA ────────────────────────────────── */}
      {isCreateFolderModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsCreateFolderModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-brand-darkGrey/95 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2 text-white font-black text-lg">
                <FolderPlus className="text-brand-orange" size={22} />
                <span>Nuova Cartella</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateFolderModalOpen(false)}
                className="p-1 text-brand-grey hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-brand-grey/80 mb-1">
                  Nome della cartella
                </label>
                <input
                  type="text"
                  placeholder="Es. Calisthenics Skills, Scheda Massa..."
                  value={folderNameToCreate}
                  onChange={(e) => setFolderNameToCreate(e.target.value)}
                  autoFocus
                  className="w-full bg-black/50 border border-white/15 rounded-xl px-4 py-2.5 text-white placeholder-brand-grey/40 focus:outline-none focus:border-brand-orange text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (folderNameToCreate.trim()) {
                        createFolder(folderNameToCreate, user?.id, folderColorToCreate);
                        setIsCreateFolderModalOpen(false);
                      }
                    }
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-brand-grey/80 mb-2">
                  Colore distintivo
                </label>
                <div className="flex items-center gap-2.5">
                  {['#ff7700', '#06b6d4', '#10b981', '#a855f7', '#f43f5e', '#f59e0b', '#64748b'].map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setFolderColorToCreate(col)}
                      className={`w-7 h-7 rounded-full transition-transform cursor-pointer flex items-center justify-center ${
                        folderColorToCreate === col ? 'scale-125 ring-2 ring-white shadow-lg' : 'hover:scale-110 opacity-80'
                      }`}
                      style={{ backgroundColor: col }}
                    >
                      {folderColorToCreate === col && <Check size={14} className="text-black font-black" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsCreateFolderModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-brand-grey hover:text-white border border-white/10 transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={!folderNameToCreate.trim()}
                onClick={() => {
                  if (folderNameToCreate.trim()) {
                    createFolder(folderNameToCreate, user?.id, folderColorToCreate);
                    setIsCreateFolderModalOpen(false);
                  }
                }}
                className="px-5 py-2 rounded-xl text-xs font-black bg-brand-orange hover:bg-brand-lightOrange text-black uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-md"
              >
                Crea Cartella
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODALE RINOMINA CARTELLA ────────────────────────────────────── */}
      {folderToRename && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setFolderToRename(null)}
        >
          <div
            className="w-full max-w-md bg-brand-darkGrey/95 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2 text-white font-black text-lg">
                <Pencil className="text-brand-orange" size={20} />
                <span>Rinomina Cartella</span>
              </div>
              <button
                type="button"
                onClick={() => setFolderToRename(null)}
                className="p-1 text-brand-grey hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-brand-grey/80 mb-1">
                Nuovo nome
              </label>
              <input
                type="text"
                value={renamedFolderName}
                onChange={(e) => setRenamedFolderName(e.target.value)}
                autoFocus
                className="w-full bg-black/50 border border-white/15 rounded-xl px-4 py-2.5 text-white placeholder-brand-grey/40 focus:outline-none focus:border-brand-orange text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (renamedFolderName.trim()) {
                      renameFolder(folderToRename.id, renamedFolderName, user?.id);
                      setFolderToRename(null);
                    }
                  }
                }}
              />
            </div>

            <div className="pt-3 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setFolderToRename(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-brand-grey hover:text-white border border-white/10 transition-colors"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={!renamedFolderName.trim()}
                onClick={() => {
                  if (renamedFolderName.trim()) {
                    renameFolder(folderToRename.id, renamedFolderName, user?.id);
                    setFolderToRename(null);
                  }
                }}
                className="px-5 py-2 rounded-xl text-xs font-black bg-brand-orange hover:bg-brand-lightOrange text-black uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer shadow-md"
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODALE SPOSTA SCHEDE ESISTENTI NELLA CARTELLA CORRENTE ─────── */}
      {isMoveSchedeModalOpen && currentFolder && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsMoveSchedeModalOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-brand-darkGrey/95 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2 text-white font-black text-base sm:text-lg truncate">
                <FolderInput className="text-brand-orange shrink-0" size={22} />
                <span className="truncate">Sposta in "{currentFolder.name}"</span>
              </div>
              <button
                type="button"
                onClick={() => setIsMoveSchedeModalOpen(false)}
                className="p-1 text-brand-grey hover:text-white rounded-lg shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-xs text-brand-grey/80 shrink-0">
              Seleziona le schede che desideri spostare all'interno di questa cartella:
            </p>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-1">
              {candidateWorkoutsToMove.length === 0 ? (
                <div className="p-6 text-center text-xs text-brand-grey/60 border border-dashed border-white/10 rounded-2xl">
                  Non ci sono altre schede disponibili da spostare.
                </div>
              ) : (
                candidateWorkoutsToMove.map((w) => {
                  const isChecked = selectedSchedeIdsToMove.has(w.id);
                  const currentFolderIdForW = folderAssignments[w.id];
                  const currentFolderNameForW = currentFolderIdForW
                    ? folders.find((f) => f.id === currentFolderIdForW)?.name
                    : null;

                  return (
                    <div
                      key={w.id}
                      onClick={() => {
                        setSelectedSchedeIdsToMove((prev) => {
                          const next = new Set(prev);
                          if (next.has(w.id)) next.delete(w.id);
                          else next.add(w.id);
                          return next;
                        });
                      }}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isChecked
                          ? 'bg-brand-orange/15 border-brand-orange text-white'
                          : 'bg-black/40 border-white/10 text-white/80 hover:border-white/25'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-bold text-sm block truncate text-white">{w.name}</span>
                        <span className="text-[11px] text-brand-grey/60 block mt-0.5">
                          {currentFolderNameForW ? `Attualmente in: 📁 ${currentFolderNameForW}` : 'Attualmente: Scheda libera'}
                        </span>
                      </div>

                      <div
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isChecked
                            ? 'bg-brand-orange border-brand-orange text-black'
                            : 'border-white/20 bg-white/5'
                        }`}
                      >
                        {isChecked && <Check size={16} strokeWidth={3} />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between shrink-0">
              <span className="text-xs text-brand-grey/70">
                {selectedSchedeIdsToMove.size} selezionate
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsMoveSchedeModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-brand-grey hover:text-white border border-white/10"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={selectedSchedeIdsToMove.size === 0}
                  onClick={() => {
                    moveSchedeToFolder(
                      Array.from(selectedSchedeIdsToMove),
                      currentFolder.id,
                      user?.id
                    );
                    setIsMoveSchedeModalOpen(false);
                  }}
                  className="px-5 py-2 rounded-xl text-xs font-black bg-brand-orange hover:bg-brand-lightOrange text-black uppercase tracking-wider disabled:opacity-50 transition-colors shadow-md"
                >
                  Sposta qui
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODALE SPOSTA SINGOLA SCHEDA ────────────────────────────────── */}
      {singleSchedaToAssign && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSingleSchedaToAssign(null)}
        >
          <div
            className="w-full max-w-md bg-brand-darkGrey/95 border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="min-w-0 pr-2">
                <h3 className="text-base font-black text-white truncate">
                  Sposta "{singleSchedaToAssign.name}"
                </h3>
                <p className="text-xs text-brand-grey/70 mt-0.5">
                  Scegli la cartella di destinazione
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSingleSchedaToAssign(null)}
                className="p-1 text-brand-grey hover:text-white rounded-lg shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {/* Opzione Radice (Nessuna cartella) */}
              <button
                type="button"
                onClick={() => {
                  assignSchedaToFolder(singleSchedaToAssign.id, null, user?.id);
                  setSingleSchedaToAssign(null);
                }}
                className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                  !folderAssignments[singleSchedaToAssign.id]
                    ? 'bg-brand-orange/20 border-brand-orange text-brand-orange font-black'
                    : 'bg-black/30 border-white/10 text-white/90 hover:border-white/20'
                }`}
              >
                <span>Nessuna cartella (Elenco principale)</span>
                {!folderAssignments[singleSchedaToAssign.id] && <Check size={16} />}
              </button>

              {/* Cartelle esistenti */}
              {folders.map((f) => {
                const isSelected = folderAssignments[singleSchedaToAssign.id] === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      assignSchedaToFolder(singleSchedaToAssign.id, f.id, user?.id);
                      setSingleSchedaToAssign(null);
                    }}
                    className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-brand-orange/20 border-brand-orange text-brand-orange font-black'
                        : 'bg-black/30 border-white/10 text-white/90 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: f.color || '#ff7700' }}
                      />
                      <span>📁 {f.name}</span>
                    </div>
                    {isSelected && <Check size={16} />}
                  </button>
                );
              })}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSingleSchedaToAssign(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-brand-grey hover:text-white border border-white/10"
              >
                Chiudi
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
