import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Plus, Save, Trash2, ChevronUp, ChevronDown, Clock, Move } from 'lucide-react';

interface ExerciseDraft {
  id: string; // Temporaneo per la UI
  type: 'reps' | 'isometry';
  name: string;
  sets: number;
  reps: number;
  duration_seconds: number;
  rest_seconds: number;
}

const NewTrainPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [workoutName, setWorkoutName] = useState('');
  const [exercises, setExercises] = useState<ExerciseDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addExercise = () => {
    setExercises([
      ...exercises, 
      { id: crypto.randomUUID(), type: 'reps', name: '', sets: 3, reps: 10, duration_seconds: 30, rest_seconds: 60 }
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

  const updateExercise = (id: string, field: keyof ExerciseDraft, value: string | number) => {
    setExercises(exercises.map(ex => 
      ex.id === id ? { ...ex, [field]: value } : ex
    ));
  };

  // Funzioni helper per input tempo (minuti:secondi visivi -> secondi interi salvati)
  const formatSecondsToMinutes = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const parseMinutesToSeconds = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      const m = parseInt(parts[0]) || 0;
      const s = parseInt(parts[1]) || 0;
      return m * 60 + s;
    }
    return parseInt(timeStr) || 0;
  };

  const saveWorkout = async () => {
    if (!workoutName.trim()) {
      setError('Inserisci il nome della scheda');
      return;
    }
    if (exercises.length === 0) {
      setError('Aggiungi almeno un esercizio alla scheda');
      return;
    }
    for (const ex of exercises) {
      if (!ex.name.trim()) {
        setError('Tutti gli esercizi devono avere un nome');
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Inserisci la scheda (Workout)
      const { data: workoutData, error: workoutError } = await supabase
        .from('workouts')
        .insert([{ name: workoutName, user_id: user?.id }])
        .select()
        .single();

      if (workoutError) throw workoutError;

      // 2. Prepara gli esercizi preservando l'ordine
      const exercisesToInsert = exercises.map((ex, idx) => ({
        workout_id: workoutData.id,
        order_index: idx,
        type: ex.type,
        name: ex.name,
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
      setError(err.message || 'Errore durante il salvataggio');
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
        <h1 className="text-xl font-bold ml-2">Nuova Scheda</h1>
      </header>

      <main className="flex-1 p-6 flex flex-col max-w-lg mx-auto w-full">
        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-100 p-3 rounded-lg mb-4 text-sm text-center">
            {error}
          </div>
        )}

        <div className="mb-8">
          <label className="block text-brand-grey font-semibold mb-2 ml-1">Nome Scheda</label>
          <input
            type="text"
            placeholder="Es: Petto e Bicipiti"
            value={workoutName}
            onChange={(e) => setWorkoutName(e.target.value)}
            className="w-full bg-brand-darkGrey/40 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors text-lg shadow-inner shadow-black/50"
          />
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-brand-grey font-semibold ml-1 flex items-center">
              <Move size={16} className="mr-2 opacity-50"/> 
              Ordina e Aggiungi
            </h2>
            <button 
              onClick={addExercise}
              className="text-brand-orange hover:text-brand-lightOrange flex items-center text-sm font-bold bg-brand-orange/10 px-3 py-1.5 rounded-lg transition-colors border border-brand-orange/20"
            >
              <Plus size={18} className="mr-1" />
              Aggiungi
            </button>
          </div>

          {exercises.length === 0 ? (
            <div className="text-center p-8 bg-brand-darkGrey/20 rounded-3xl border border-dashed border-brand-grey/30">
              <p className="text-brand-grey/60">Nessun esercizio aggiunto.</p>
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
                  <span className="text-xs font-bold text-brand-grey/40">ESERCIZIO {index + 1}</span>
                  <button 
                    onClick={() => removeExercise(ex.id)}
                    className="p-1.5 text-brand-grey/60 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                {/* Tipo Esercizio */}
                <div className="flex space-x-2 bg-black/40 p-1.5 rounded-xl">
                  <button
                    onClick={() => updateExercise(ex.id, 'type', 'reps')}
                    className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${ex.type === 'reps' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                  >
                    RIPETIZIONI
                  </button>
                  <button
                    onClick={() => updateExercise(ex.id, 'type', 'isometry')}
                    className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition-colors ${ex.type === 'isometry' ? 'bg-brand-orange text-black' : 'text-brand-grey hover:text-white'}`}
                  >
                    ISOMETRIA
                  </button>
                </div>
                
                {/* Nome */}
                <div>
                  <input
                    type="text"
                    placeholder="Nome Esercizio (es: Panca Piana)"
                    value={ex.name}
                    onChange={(e) => updateExercise(ex.id, 'name', e.target.value)}
                    className="w-full bg-black/30 border border-brand-grey/20 rounded-xl px-4 py-3 text-white font-semibold focus:border-brand-orange focus:outline-none transition-colors"
                  />
                </div>

                {/* Dati (Serie, Reps/Tempo, Recupero) */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1">Serie</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.sets}
                      onChange={(e) => updateExercise(ex.id, 'sets', parseInt(e.target.value) || 0)}
                      className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-white focus:border-brand-orange focus:outline-none transition-colors"
                    />
                  </div>
                  
                  <div className="flex flex-col">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 text-center">
                      {ex.type === 'reps' ? 'Reps' : 'Tempo (sec)'}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={ex.type === 'reps' ? ex.reps : ex.duration_seconds}
                      onChange={(e) => updateExercise(ex.id, ex.type === 'reps' ? 'reps' : 'duration_seconds', parseInt(e.target.value) || 0)}
                      className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-white focus:border-brand-orange focus:outline-none transition-colors"
                    />
                  </div>

                  <div className="flex flex-col relative">
                    <label className="text-[10px] text-brand-grey/70 uppercase tracking-wider font-bold ml-1 mb-1 text-right flex items-center justify-end">
                      <Clock size={10} className="mr-1" />
                      Riposo
                    </label>
                    {/* Visualizziamo il campo rovesciato così supporta i ":" in mobilità se vogliamo, oppure input testuale formattato MM:SS */}
                    <input
                      type="text"
                      placeholder="Mm:Ss"
                      value={formatSecondsToMinutes(ex.rest_seconds)}
                      onFocus={(e) => {
                        // All'apertura finta selezione o svuotamento
                        if(ex.rest_seconds === 60) e.target.select();
                      }}
                      onChange={(e) => {
                        // Lasciamo scrivere l'utente stringhe, ma salviamo al blur o a caldo
                        // In questo caso se è digitato senza i 2 punti (es 90) è ok.
                         updateExercise(ex.id, 'rest_seconds', parseMinutesToSeconds(e.target.value));
                      }}
                      className="bg-black/40 border border-brand-grey/10 rounded-xl px-2 py-3 text-center text-brand-orange font-bold focus:border-brand-orange focus:outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <button
          onClick={saveWorkout}
          disabled={loading || exercises.length === 0}
          className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-lg py-4 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 mt-auto shadow-lg shadow-brand-orange/20"
        >
          {loading ? 'Salvataggio in corso...' : (
            <>
              <Save size={24} className="mr-2" />
              SALVA LA SCHEDA
            </>
          )}
        </button>
      </main>
    </div>
  );
};

export default NewTrainPage;
