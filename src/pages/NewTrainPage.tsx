import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';

interface ExerciseDraft {
  id: string; // Temporaneo per la UI
  name: string;
  sets: number;
  reps: number;
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
      { id: crypto.randomUUID(), name: '', sets: 3, reps: 10 }
    ]);
  };

  const removeExercise = (id: string) => {
    setExercises(exercises.filter(ex => ex.id !== id));
  };

  const updateExercise = (id: string, field: keyof ExerciseDraft, value: string | number) => {
    setExercises(exercises.map(ex => 
      ex.id === id ? { ...ex, [field]: value } : ex
    ));
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

      // 2. Prepara gli esercizi con il workout_id correlato
      const exercisesToInsert = exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        workout_id: workoutData.id
      }));

      // 3. Inserisci gli esercizi
      const { error: exercisesError } = await supabase
        .from('exercises')
        .insert(exercisesToInsert);

      if (exercisesError) throw exercisesError;

      // Successo! Torna alla Home o alla pagina Gym Card
      navigate('/gym-card');

    } catch (err: any) {
      setError(err.message || 'Errore durante il salvataggio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col pb-24">
      {/* Header */}
      <header className="p-4 flex items-center bg-black/50 sticky top-0 z-10">
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

        {/* Nome della Scheda */}
        <div className="mb-8">
          <label className="block text-brand-grey font-semibold mb-2 ml-1">Nome Scheda</label>
          <input
            type="text"
            placeholder="Es: Petto e Bicipiti"
            value={workoutName}
            onChange={(e) => setWorkoutName(e.target.value)}
            className="w-full bg-brand-darkGrey/40 border-2 border-brand-grey/20 rounded-xl px-4 py-3 text-white focus:border-brand-orange focus:outline-none transition-colors text-lg"
          />
        </div>

        {/* Lista Esercizi */}
        <div className="space-y-4 mb-8">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-brand-grey font-semibold ml-1">Esercizi</h2>
            <button 
              onClick={addExercise}
              className="text-brand-orange hover:text-brand-lightOrange flex items-center text-sm font-bold bg-brand-orange/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={18} className="mr-1" />
              Aggiungi
            </button>
          </div>

          {exercises.length === 0 ? (
            <div className="text-center p-8 bg-brand-darkGrey/20 rounded-2xl border border-dashed border-brand-grey/30">
              <p className="text-brand-grey/60">Nessun esercizio aggiunto.</p>
            </div>
          ) : (
            exercises.map((ex) => (
              <div key={ex.id} className="bg-brand-darkGrey/40 border border-brand-grey/20 p-4 rounded-2xl flex flex-col space-y-3 relative">
                <button 
                  onClick={() => removeExercise(ex.id)}
                  className="absolute top-3 right-3 text-brand-grey/50 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={20} />
                </button>
                
                <div>
                  <label className="text-xs text-brand-grey/70 uppercase tracking-wider font-bold ml-1">Nome Esercizio</label>
                  <input
                    type="text"
                    placeholder="Es: Panca Piana"
                    value={ex.name}
                    onChange={(e) => updateExercise(ex.id, 'name', e.target.value)}
                    className="w-full bg-black/30 border border-brand-grey/10 rounded-lg px-3 py-2 text-white focus:border-brand-orange focus:outline-none transition-colors mt-1"
                  />
                </div>

                <div className="flex space-x-4">
                  <div className="flex-1">
                    <label className="text-xs text-brand-grey/70 uppercase tracking-wider font-bold ml-1">Serie</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.sets}
                      onChange={(e) => updateExercise(ex.id, 'sets', parseInt(e.target.value) || 0)}
                      className="w-full bg-black/30 border border-brand-grey/10 rounded-lg px-3 py-2 text-white focus:border-brand-orange focus:outline-none transition-colors mt-1"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-brand-grey/70 uppercase tracking-wider font-bold ml-1">Ripetizioni</label>
                    <input
                      type="number"
                      min="1"
                      value={ex.reps}
                      onChange={(e) => updateExercise(ex.id, 'reps', parseInt(e.target.value) || 0)}
                      className="w-full bg-black/30 border border-brand-grey/10 rounded-lg px-3 py-2 text-white focus:border-brand-orange focus:outline-none transition-colors mt-1"
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bottone Salva */}
        <button
          onClick={saveWorkout}
          disabled={loading || exercises.length === 0}
          className="w-full bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-lg py-4 rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 mt-auto shadow-lg shadow-brand-orange/20"
        >
          {loading ? 'Salvataggio...' : (
            <>
              <Save size={24} className="mr-2" />
              SALVA SCHEDA
            </>
          )}
        </button>
      </main>
    </div>
  );
};

export default NewTrainPage;
