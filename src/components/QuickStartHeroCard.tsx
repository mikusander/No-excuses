/**
 * QuickStartHeroCard.tsx — Hero Card per l'avvio rapido in 1 tap stile Apple Fitness+.
 *
 * Logica intelligente:
 *  1. Se c'è un workout in sospeso nel localStorage (workoutProgressStorage),
 *     mostra lo stato "IN CORSO" e il pulsante "RIPRENDI SUBITO".
 *  2. Altrimenti, mostra l'ultima scheda eseguita dall'utente (da workout_run o schede)
 *     con il pulsante arancione "ALLENATI SUBITO" per iniziare senza cercare.
 *  3. Fallback elegante se l'utente non ha ancora schede ("Crea il tuo primo allenamento").
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, RotateCcw, Dumbbell, ArrowRight } from 'lucide-react';
import { hapticMedium } from '../utils/haptics';

interface QuickStartHeroCardProps {
  /** Checkpoint di workout in sospeso (se presente) */
  activeCheckpoint?: {
    workoutName?: string;
    currentExerciseName?: string;
    currentSetIdx?: number;
    totalSets?: number;
    identity: { type: 'scheda' | 'run'; id: number };
  } | null;
  /** Ultima scheda completata o consigliata */
  lastWorkout?: {
    id_scheda?: number;
    nome: string;
    dataLabel?: string;
  } | null;
}

const QuickStartHeroCard: React.FC<QuickStartHeroCardProps> = ({
  activeCheckpoint,
  lastWorkout,
}) => {
  const navigate = useNavigate();

  const handleAction = () => {
    void hapticMedium();
    if (activeCheckpoint) {
      if (activeCheckpoint.identity.type === 'run') {
        navigate(`/active-workout-history/${activeCheckpoint.identity.id}`);
      } else {
        navigate(`/active-workout/${activeCheckpoint.identity.id}`);
      }
      return;
    }

    if (lastWorkout?.id_scheda) {
      navigate(`/active-workout/${lastWorkout.id_scheda}`);
      return;
    }

    // Se non c'è una scheda pronta, vai alla selezione
    navigate('/select-workout');
  };

  const isResuming = Boolean(activeCheckpoint);

  return (
    <div
      onClick={handleAction}
      className={`relative w-full rounded-3xl p-5 overflow-hidden border transition-all duration-200 active:scale-[0.98] cursor-pointer shadow-xl select-none group ${
        isResuming
          ? 'bg-gradient-to-br from-[#1C1C1E] via-[#2A1E14] to-[#1C1C1E] border-brand-orange/50 shadow-brand-orange/10'
          : 'bg-[#1C1C1E]/90 backdrop-blur-xl border-white/10 hover:border-white/20'
      }`}
    >
      {/* Glow d'accento arancione */}
      <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-brand-orange/15 blur-2xl pointer-events-none" />

      <div className="relative flex flex-col gap-4">
        {/* Top Header Card: Badge di stato */}
        <div className="flex items-center justify-between">
          {isResuming ? (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-orange/20 border border-brand-orange/40 text-[10px] font-black uppercase tracking-wider text-brand-orange">
              <span className="w-2 h-2 rounded-full bg-brand-orange animate-ping" />
              Workout in sospeso
            </span>
          ) : (
            <span className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-[10px] font-bold uppercase tracking-wider text-brand-grey">
              <Dumbbell size={12} className="text-brand-orange" />
              Avvio Rapido
            </span>
          )}

          {lastWorkout?.dataLabel && !isResuming && (
            <span className="text-[11px] font-medium text-brand-grey/50">
              {lastWorkout.dataLabel}
            </span>
          )}
        </div>

        {/* Titolo e Dettagli */}
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-black text-white tracking-tight leading-snug group-hover:text-brand-orange transition-colors truncate">
            {isResuming
              ? activeCheckpoint?.workoutName || 'Riprendi Allenamento'
              : lastWorkout?.nome || 'Inizia un Allenamento'}
          </h2>
          <p className="text-xs font-medium text-brand-grey/70 line-clamp-1">
            {isResuming
              ? `Esercizio: ${activeCheckpoint?.currentExerciseName || 'In corso'} (Serie ${activeCheckpoint?.currentSetIdx || 1})`
              : 'Tocca per avviare la tua scheda con timer e ripetizioni guidate.'}
          </p>
        </div>

        {/* Bottone CTA grande */}
        <button
          type="button"
          className={`w-full py-3.5 px-5 rounded-2xl flex items-center justify-center gap-2 font-black text-sm uppercase tracking-wider transition-all shadow-md ${
            isResuming
              ? 'bg-brand-orange text-black shadow-brand-orange/30'
              : 'bg-gradient-to-r from-brand-orange to-brand-lightorange text-black shadow-[0_8px_20px_rgba(255,94,0,0.35)]'
          }`}
        >
          {isResuming ? (
            <>
              <RotateCcw size={18} strokeWidth={2.5} className="animate-spin-slow" />
              <span>Riprendi Ora</span>
            </>
          ) : (
            <>
              <Play size={18} fill="currentColor" />
              <span>Allenati Subito</span>
              <ArrowRight size={16} className="ml-auto group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default React.memo(QuickStartHeroCard);
