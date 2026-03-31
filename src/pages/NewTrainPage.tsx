import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Plus, Save, Trash2, ChevronUp, ChevronDown, Clock, Move } from 'lucide-react';

interface ExerciseDraft {
  id: string; // Temporaneo per la UI
  type: 'reps' | 'isometry' | 'superset' | 'emom' | 'pyramid';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
  emom_rounds?: number;
  emom_round_duration?: number;
  subExercises?: {
    name: string;
    type: 'reps' | 'isometry';
    reps: number;
    duration_seconds: number;
  }[];
  pyramid_steps?: {
    reps: number;
    rest_seconds: number;
  }[];
}

const NewTrainPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [workoutName, setWorkoutName] = useState('');
  const [exercises, setExercises] = useState<ExerciseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});

  const { id } = useParams<{ id: string }>();

  // Carica i dati della scheda se siamo in modalità modifica
  React.useEffect(() => {
    if (id) {
      loadWorkout(id);
    }
  }, [id]);

  const loadWorkout = async (workoutId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('workouts')
        .select(`
          name,
          exercises ( id, type, name, sets, reps, duration_seconds, rest_seconds, order_index )
        `)
        .eq('id', workoutId)
        .single();

      if (error) throw error;

      if (data) {
        setWorkoutName(data.name);
        const sorted = data.exercises.sort((a: any, b: any) => a.order_index - b.order_index);
        setExercises(sorted.map((ex: any) => {
          let parsedName = ex.name;
          let subExercises = [];

          if (ex.type === 'superset') {
            try {
              subExercises = JSON.parse(ex.name);
              parsedName = ''; // Non ci serve il nome base per i superset
            } catch (e) {
              console.error('Error parsing superset JSON:', e);
            }
          }

          if (ex.type === 'emom') {
            try {
              const parsed = JSON.parse(ex.name);
              if (parsed.subExercises) subExercises = parsed.subExercises;
              ex.emom_rounds = parsed.emom_rounds || 1;
              ex.emom_round_duration = parsed.emom_round_duration || 60;
              parsedName = ''; 
            } catch (e) {
              console.error('Error parsing emom JSON:', e);
            }
          }

          if (ex.type === 'pyramid') {
            try {
              const parsed = JSON.parse(ex.name);
              ex.pyramid_steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
              parsedName = parsed?.name || '';
            } catch (e) {
              console.error('Error parsing pyramid JSON:', e);
            }
          }

          return {
            ...ex,
            name: parsedName,
            subExercises,
            id: crypto.randomUUID(), // Generiamo un nuovo ID temporaneo per la UI
          };
        }));
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
      { id: crypto.randomUUID(), type: 'reps', name: '', sets: 3, reps: 10, duration_seconds: 30, rest_seconds: 60 }
    ]);
  };

  

  const convertToSuperset = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        return {
          ...ex,
          type: 'superset',
          subExercises: [
            { name: ex.name, type: ex.type as 'reps' | 'isometry', reps: ex.reps, duration_seconds: ex.duration_seconds },
            { name: '', type: 'reps', reps: 10, duration_seconds: 0 }
          ]
        };
      }
      return ex;
    }));
  };

  const convertToPyramid = (id: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === id) {
        return {
          ...ex,
          type: 'pyramid',
          sets: 1,
          rest_seconds: 0,
          pyramid_steps: [
            { reps: 0, rest_seconds: 0 },
            { reps: 0, rest_seconds: 0 },
          ],
        };
      }
      return ex;
    }));
  };

  const addEmom = () => {
    setExercises([
      ...exercises,
      {
        id: crypto.randomUUID(), type: 'emom', name: '', sets: 1, reps: 0, duration_seconds: 0, rest_seconds: 60, emom_rounds: 10, emom_round_duration: 60, subExercises: [
          { name: '', type: 'reps', reps: 10, duration_seconds: 0 }
        ]
      }
    ]);
  };

  const removeExercise = (id: string) => {
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
        const nextReps = lastStep ? lastStep.reps + 5 : 10;
        return {
          ...ex,
          pyramid_steps: [...(ex.pyramid_steps || []), { reps: nextReps, rest_seconds: 120 }]
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
            pyramid_steps: undefined,
          };
        }

        return { ...ex, pyramid_steps: remaining };
      }
      return ex;
    }));
  };

  const getDraftOrValue = (key: string, value: number) => {
    if (Object.prototype.hasOwnProperty.call(numberDrafts, key)) return numberDrafts[key];
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

  const addSubExercise = (supersetId: string) => {
    setExercises(exercises.map(ex => {
      if (ex.id === supersetId && ex.subExercises) {
        return { ...ex, subExercises: [...ex.subExercises, { name: '', type: 'reps', reps: 10, duration_seconds: 0 }] };
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
            reps: only.type === 'reps' ? only.reps : ex.reps,
            duration_seconds: only.type === 'isometry' ? only.duration_seconds : ex.duration_seconds,
            subExercises: undefined,
          };
        }

        return { ...ex, subExercises: remaining };
      }
      return ex;
    }));
  };

  // Esercizi state builder helper functions

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
          .from('workouts')
          .update({ name: workoutName })
          .eq('id', id);
        if (updateError) throw updateError;

        // Rimuove i vecchi esercizi
        const { error: deleteError } = await supabase
          .from('exercises')
          .delete()
          .eq('workout_id', id);
        if (deleteError) throw deleteError;

      } else {
        // INSERT nuova scheda
        const { data: workoutData, error: workoutError } = await supabase
          .from('workouts')
          .insert([{ name: workoutName, user_id: user?.id }])
          .select()
          .single();

        if (workoutError) throw workoutError;
        workoutIdToUse = workoutData.id;
      }

      // 2. Prepara gli esercizi preservando l\'ordine
      const exercisesToInsert = exercises.map((ex, idx) => ({
        workout_id: workoutIdToUse,
        order_index: idx,
        type: ex.type,
        name: ex.type === 'superset'
          ? JSON.stringify(ex.subExercises)
          : ex.type === 'emom'
            ? JSON.stringify({ subExercises: ex.subExercises, emom_rounds: ex.emom_rounds || 1, emom_round_duration: ex.emom_round_duration || 60 })
            : ex.type === 'pyramid'
              ? JSON.stringify({ name: ex.name, steps: ex.pyramid_steps || [] })
              : ex.name,
        sets: ex.sets,
        reps: ex.type === 'reps' ? ex.reps : 0,
        duration_seconds: ex.type === 'isometry' ? ex.duration_seconds : 0,
        rest_seconds: ex.rest_seconds
      }));

      // 3. Inserisci gli esercizi
      const { error: exercisesError } = await supabase
        .from('exercises')
        .insert(exercisesToInsert);

      if (exercisesError) throw exercisesError;

      navigate('/gym-card');

    } catch (err: any) {
      setError(err.message || 'Error occurred while saving');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24">
      <header className="p-4 flex items-center bg-black/50 sticky top-0 z-20 backdrop-blur-md">
        <button
          onClick={() => navigate('/')}
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
              <div key={ex.id} className="bg-brand-darkGrey/40 border border-brand-grey/20 p-4 rounded-3xl flex flex-col space-y-4 relative shadow-lg">

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
                          type="number"
                          min="1"
                          value={getDraftOrValue(`${ex.id}:emom_rounds`, ex.emom_rounds || 1)}
                          onChange={(e) => setDraftValue(`${ex.id}:emom_rounds`, e.target.value)}
                          onBlur={() => commitExerciseNumber(ex.id, 'emom_rounds', `${ex.id}:emom_rounds`, 1, 1)}
                          onFocus={onNumberFocus}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-xs text-brand-grey mb-1">Round Time (sec)</label>
                        <input
                          type="number"
                          min="0"
                          value={getDraftOrValue(`${ex.id}:emom_round_duration`, ex.emom_round_duration || 60)}
                          onChange={(e) => setDraftValue(`${ex.id}:emom_round_duration`, e.target.value)}
                          onBlur={() => commitExerciseNumber(ex.id, 'emom_round_duration', `${ex.id}:emom_round_duration`, 60, 0)}
                          onFocus={onNumberFocus}
                          className="bg-black/40 border border-brand-grey/20 rounded-lg px-3 py-2 text-white focus:border-blue-400 outline-none"
                        />
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
                          <input
                            type="number"
                            min="1"
                            value={getDraftOrValue(`${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? sub.reps : sub.duration_seconds)}
                            onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:${sub.type}`, e.target.value)}
                            onBlur={() => commitSubExerciseNumber(ex.id, sIdx, sub.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? 10 : 30, 1)}
                            onFocus={onNumberFocus}
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-blue-400 outline-none"
                            placeholder={sub.type === 'reps' ? 'Reps' : 'Time (sec)'}
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
                          <input
                            type="number"
                            min="1"
                            value={getDraftOrValue(`${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? sub.reps : sub.duration_seconds)}
                            onChange={(e) => setDraftValue(`${ex.id}:sub:${sIdx}:${sub.type}`, e.target.value)}
                            onBlur={() => commitSubExerciseNumber(ex.id, sIdx, sub.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:sub:${sIdx}:${sub.type}`, sub.type === 'reps' ? 10 : 30, 1)}
                            onFocus={onNumberFocus}
                            className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none"
                            placeholder={sub.type === 'reps' ? 'Reps' : 'Time (sec)'}
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

                    {ex.pyramid_steps?.map((step, stepIdx) => (
                      <div key={stepIdx} className="bg-black/30 border border-white/5 rounded-xl p-3 space-y-2 relative pr-8">
                        <p className="text-[10px] uppercase tracking-wider text-brand-grey/70 font-bold">Step {stepIdx + 1}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1">Reps</label>
                            <input
                              type="number"
                              min="1"
                              value={Object.prototype.hasOwnProperty.call(numberDrafts, `${ex.id}:pyr:${stepIdx}:reps`) ? numberDrafts[`${ex.id}:pyr:${stepIdx}:reps`] : (Number.isFinite(step.reps) && step.reps > 0 ? String(step.reps) : '')}
                              onChange={(e) => setDraftValue(`${ex.id}:pyr:${stepIdx}:reps`, e.target.value)}
                              onBlur={() => commitPyramidStepNumber(ex.id, stepIdx, 'reps', `${ex.id}:pyr:${stepIdx}:reps`, 10, 1)}
                              onFocus={onNumberFocus}
                              className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold block mb-1">Rest (sec)</label>
                            <input
                              type="number"
                              min="0"
                              value={Object.prototype.hasOwnProperty.call(numberDrafts, `${ex.id}:pyr:${stepIdx}:rest`) ? numberDrafts[`${ex.id}:pyr:${stepIdx}:rest`] : (Number.isFinite(step.rest_seconds) && step.rest_seconds > 0 ? String(step.rest_seconds) : '')}
                              onChange={(e) => setDraftValue(`${ex.id}:pyr:${stepIdx}:rest`, e.target.value)}
                              onBlur={() => commitPyramidStepNumber(ex.id, stepIdx, 'rest_seconds', `${ex.id}:pyr:${stepIdx}:rest`, 60, 0)}
                              onFocus={onNumberFocus}
                              className="w-full bg-black/40 border border-brand-grey/10 rounded-lg px-3 py-2 text-white text-center focus:border-brand-orange outline-none"
                            />
                          </div>
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
                  </>
                )}

                {/* Dati Generici (Serie e Recupero) */}
                {ex.type !== 'pyramid' && (
                <div className={`grid ${ex.type === 'superset' ? 'grid-cols-2' : 'grid-cols-3'} gap-3`}>
                  <div className="flex flex-col">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1">
                      {ex.type === 'superset' ? 'Total Rounds' : 'Sets'}
                    </label>
                    <input
                      type="number"
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
                      <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 text-center">
                        {ex.type === 'reps' ? 'Reps' : 'Time (sec)'}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={getDraftOrValue(`${ex.id}:${ex.type === 'reps' ? 'reps' : 'duration_seconds'}`, ex.type === 'reps' ? ex.reps : ex.duration_seconds)}
                        onChange={(e) => setDraftValue(`${ex.id}:${ex.type === 'reps' ? 'reps' : 'duration_seconds'}`, e.target.value)}
                        onBlur={() => commitExerciseNumber(ex.id, ex.type === 'reps' ? 'reps' : 'duration_seconds', `${ex.id}:${ex.type === 'reps' ? 'reps' : 'duration_seconds'}`, ex.type === 'reps' ? 10 : 30, 1)}
                        onFocus={onNumberFocus}
                        className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-white focus:border-brand-orange focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  <div className="flex flex-col relative">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 text-center justify-center flex items-center">
                      <Clock size={10} className="mr-1" />
                      Rest
                    </label>
                    <div className="flex bg-black/40 border border-brand-grey/10 rounded-xl overflow-hidden focus-within:border-brand-orange transition-colors h-[46px]">
                      <div className="flex flex-col items-center justify-center w-1/2 border-r border-brand-grey/10 relative">
                        <input
                          type="number"
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
                          type="number"
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
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => convertToSuperset(ex.id)}
                      className="py-2 border border-dashed border-brand-orange/30 text-brand-orange/70 text-xs font-bold rounded-lg hover:border-brand-orange/50 hover:text-brand-orange transition-colors flex justify-center items-center"
                    >
                      <Plus size={14} className="mr-1" /> CREATE SUPERSET
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
            ))
          )}

          <div className="flex flex-col space-y-3 pt-2">
            <div className="flex space-x-3">
              <button
                onClick={addExercise}
                className="flex-1 text-brand-orange hover:text-brand-lightOrange flex items-center justify-center text-sm font-bold bg-brand-orange/10 hover:bg-brand-orange/20 px-4 py-3 rounded-xl transition-colors border border-brand-orange/20 border-dashed"
              >
                <Plus size={20} className="mr-1" />
                EXERCISE
              </button>
              <button
                onClick={addEmom}
                className="flex-1 text-brand-orange hover:text-brand-lightOrange flex items-center justify-center text-sm font-bold bg-brand-orange/10 hover:bg-brand-orange/20 px-4 py-3 rounded-xl transition-colors border border-brand-orange/20 border-dashed"
              >
                <Plus size={20} className="mr-1" />
                EMOM
              </button>
            </div>
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
