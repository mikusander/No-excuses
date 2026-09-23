/**
 * WorkoutSessionRecapModal.tsx — Vista modale fluttuante per il riepilogo rapido
 * di una sessione di allenamento completata.
 *
 * Mostra:
 *  - Nome del workout, data e ora di svolgimento
 *  - Statistiche chiave: Durata totale ed Esercizi completati
 *  - Lista degli esercizi eseguiti con serie, reps/secondi, peso e note
 *  - Tasto di navigazione diretta alla pagina di dettaglio storico (/workout-history/:id)
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Clock, Dumbbell, ArrowRight, FileText, CheckCircle2 } from 'lucide-react';
import { hapticLight, hapticMedium } from '../utils/haptics';

export interface RecapWorkoutSession {
  id: string | number;
  workoutName: string;
  executedAt: string;
  totalDurationSeconds?: number | null;
  exercisesSnapshot?: any[];
  notes?: Array<{ text: string; createdAt?: string }>;
  schedaId?: string | number | null;
}

interface WorkoutSessionRecapModalProps {
  workout: RecapWorkoutSession | null;
  isOpen: boolean;
  onClose: () => void;
}

const formatItalianDate = (isoString: string) => {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const formatTime = (isoString: string) => {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (totalSecs?: number | null) => {
  if (totalSecs == null || !Number.isFinite(totalSecs) || totalSecs <= 0) {
    return 'Non registrata';
  }
  const s = Math.max(0, Math.trunc(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  if (h > 0) return `${h}h ${m}m ${remSec}s`;
  if (m > 0) return `${m}m ${remSec}s`;
  return `${remSec}s`;
};

export const WorkoutSessionRecapModal: React.FC<WorkoutSessionRecapModalProps> = ({
  workout,
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();

  if (!isOpen || !workout) return null;

  const exercises = Array.isArray(workout.exercisesSnapshot) ? workout.exercisesSnapshot : [];
  const exerciseCount = exercises.length;

  const handleOpenFullDetail = () => {
    void hapticMedium();
    onClose();
    navigate(`/workout-history/${workout.id}`);
  };

  const handleClose = () => {
    void hapticLight();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col rounded-3xl bg-[#1C1C1E] border border-white/10 shadow-2xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow arancione in alto a destra */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-brand-orange/15 blur-3xl pointer-events-none" />

        {/* Header Modale */}
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3 shrink-0 relative">
          <div className="flex-1 min-w-0 pr-2">
            <div className="flex items-center gap-1.5 text-brand-orange text-xs font-black uppercase tracking-wider mb-1">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span>Sessione Completata</span>
            </div>
            <h2 className="text-xl font-black text-white tracking-tight truncate">
              {workout.workoutName || 'Allenamento'}
            </h2>
            <p className="text-xs text-brand-grey/80 capitalize mt-0.5">
              {formatItalianDate(workout.executedAt)} • {formatTime(workout.executedAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            title="Chiudi riepilogo"
          >
            <X size={18} />
          </button>
        </div>

        {/* Statistiche in pill */}
        <div className="grid grid-cols-2 gap-3 p-4 bg-white/[0.02] border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-9 h-9 rounded-xl bg-brand-orange/15 flex items-center justify-center shrink-0 text-brand-orange">
              <Clock size={18} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Durata</span>
              <span className="text-sm font-black text-white truncate block">
                {formatDuration(workout.totalDurationSeconds)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="w-9 h-9 rounded-xl bg-brand-orange/15 flex items-center justify-center shrink-0 text-brand-orange">
              <Dumbbell size={18} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-brand-grey/60 block">Esercizi</span>
              <span className="text-sm font-black text-white truncate block">
                {exerciseCount} {exerciseCount === 1 ? 'esercizio' : 'esercizi'}
              </span>
            </div>
          </div>
        </div>

        {/* Lista Esercizi Svolti */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          <h3 className="text-xs font-bold text-brand-grey/70 uppercase tracking-wider px-1">
            Esercizi eseguiti
          </h3>

          {exercises.length === 0 ? (
            <div className="text-center py-8 text-brand-grey/50 text-xs">
              Nessun dettaglio esercizio registrato in questa sessione.
            </div>
          ) : (
            exercises.map((ex: any, idx: number) => {
              const name = String(ex.name || `Esercizio ${idx + 1}`);
              const sets = Number(ex.sets || 1);
              const reps = ex.reps != null && ex.reps !== 0 ? `${ex.reps} reps` : (ex.duration_seconds ? `${ex.duration_seconds}s` : 'MAX reps');
              const weight = Number(ex.weight || ex.peso_kg || 0);
              const weightLabel = weight > 0 ? `${weight} kg` : 'Corpo libero';

              return (
                <div
                  key={idx}
                  className="p-3.5 rounded-2xl bg-white/5 border border-white/5 flex items-start gap-3 select-none"
                >
                  <div className="w-6 h-6 rounded-lg bg-brand-orange/15 border border-brand-orange/30 text-brand-orange flex items-center justify-center text-xs font-black shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-white truncate leading-snug">
                        {name}
                      </h4>
                      {ex.type && ex.type !== 'reps' && (
                        <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-brand-orange/20 text-brand-orange shrink-0">
                          {ex.type}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-brand-grey/70 mt-0.5">
                      {sets} {sets === 1 ? 'serie' : 'serie'} • {reps} • {weightLabel}
                    </p>

                    {/* Note dell'esercizio (se presenti) */}
                    {ex.note_esercizio && (
                      <div className="mt-2 text-[11px] text-brand-grey/90 bg-white/5 border border-white/5 rounded-xl p-2 flex items-start gap-1.5">
                        <FileText size={12} className="text-brand-orange shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{ex.note_esercizio}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Azioni */}
        <div className="p-4 border-t border-white/10 bg-[#171719] flex gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 py-3 px-4 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer text-center"
          >
            Chiudi
          </button>
          <button
            type="button"
            onClick={handleOpenFullDetail}
            className="flex-1 py-3 px-4 rounded-xl bg-brand-orange hover:bg-brand-lightOrange active:scale-95 text-black text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-brand-orange/20 transition-all cursor-pointer"
          >
            <span>Dettaglio Storico</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutSessionRecapModal;
