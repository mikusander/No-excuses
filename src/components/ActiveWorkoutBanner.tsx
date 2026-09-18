/**
 * ActiveWorkoutBanner.tsx — Notifica / Banner fluttuante in-app per workout attivo in background.
 *
 * Mostrato in cima allo schermo su tutte le pagine dell'app (Home, Schede, Storico, Settings, ecc.)
 * quando c'è un workout avviato ma lasciato provvisoriamente in background.
 *
 * Funzionalità:
 *  - Indicatore luminoso pulsante e info rapide (nome scheda, esercizio, set attuale)
 *  - Tasto rapido "Riprendi" per tornare istantaneamente all'allenamento
 *  - Tasto "Annulla" con conferma esplicita per cancellare definitivamente il workout in corso
 *  - Estetica Apple Dark Mode (Liquid Glass / OLED black / accento arancione atletico)
 */
import React, { useEffect, useState, useTransition } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Flame, Play, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getLatestWorkoutProgressCheckpoint,
  clearWorkoutProgressCheckpointByIdentity,
  subscribeToWorkoutProgress,
  type WorkoutProgressCheckpointMeta,
} from '../lib/workoutProgressStorage';
import { hapticLight, hapticMedium, hapticSuccess } from '../utils/haptics';

export const ActiveWorkoutBanner: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [, startTransition] = useTransition();

  const [checkpoint, setCheckpoint] = useState<WorkoutProgressCheckpointMeta | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Aggiorna lo stato del checkpoint attivo
  const refreshCheckpoint = () => {
    if (!user?.id) {
      setCheckpoint(null);
      return;
    }
    const latest = getLatestWorkoutProgressCheckpoint(user.id);
    setCheckpoint(latest);
  };

  useEffect(() => {
    refreshCheckpoint();
    const unsubscribe = subscribeToWorkoutProgress(() => {
      refreshCheckpoint();
    });
    return unsubscribe;
  }, [user?.id]);

  // Se l'utente si trova già nella pagina del workout attivo o su /auth, il banner non va mostrato
  const isInActiveWorkout = location.pathname.startsWith('/active-workout');
  const isExcludedRoute = isInActiveWorkout || location.pathname === '/auth';
  if (!checkpoint || isExcludedRoute) {
    return null;
  }

  const isHistoryRun = checkpoint.identity.type === 'run';
  const targetPath = isHistoryRun
    ? `/active-workout-history/${checkpoint.identity.id}`
    : `/active-workout/${checkpoint.identity.id}`;

  const handleResume = () => {
    void hapticMedium();
    startTransition(() => {
      navigate(targetPath);
    });
  };

  const handleOpenCancelModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    void hapticLight();
    setShowCancelModal(true);
  };

  const handleConfirmCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id) return;
    void hapticSuccess();
    clearWorkoutProgressCheckpointByIdentity(user.id, checkpoint.identity);
    setShowCancelModal(false);
    setCheckpoint(null);
  };

  const workoutDisplayName = checkpoint.workoutName || `Allenamento #${checkpoint.identity.id}`;
  const exerciseDetail = checkpoint.currentExerciseName
    ? `${checkpoint.currentExerciseName}${checkpoint.currentSetIdx != null ? ` • Set ${checkpoint.currentSetIdx + 1}${checkpoint.totalSets ? `/${checkpoint.totalSets}` : ''}` : ''}`
    : 'In pausa in background';

  return (
    <>
      {/* Banner fluttuante in cima */}
      <aside
        aria-label="Workout in corso"
        className="fixed top-0 inset-x-0 z-40 pointer-events-none px-3"
        style={{
          paddingTop: 'max(0.6rem, calc(env(safe-area-inset-top, 0px) + 0.35rem))',
        }}
      >
        <div
          onClick={handleResume}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleResume()}
          className="pointer-events-auto max-w-lg mx-auto w-full bg-[#1C1C1E]/95 backdrop-blur-2xl border border-brand-orange/35 shadow-2xl shadow-brand-orange/15 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer select-none transition-all active:scale-[0.985] group"
        >
          {/* Icona pulsante fiamma arancione */}
          <div className="w-9 h-9 rounded-xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center shrink-0">
            <Flame size={20} className="text-brand-orange animate-pulse" />
          </div>

          {/* Info testuali del workout */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-brand-orange animate-ping" />
              <h2 className="text-xs font-bold text-white tracking-tight truncate">
                {workoutDisplayName}
              </h2>
            </div>
            <p className="text-[11px] font-medium text-brand-grey/80 truncate mt-0.5">
              {exerciseDetail}
            </p>
          </div>

          {/* Azioni: Riprendi + Annulla */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleResume}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-brand-orange hover:bg-brand-lightOrange text-white text-xs font-semibold shadow-md active:opacity-90 transition-all cursor-pointer"
            >
              <Play size={13} className="fill-current" />
              <span>Riprendi</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCancelModal}
              title="Annulla workout in corso"
              aria-label="Annulla workout in corso"
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-white/5 active:bg-white/10 transition-colors cursor-pointer"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Modal di conferma cancellazione workout */}
      {showCancelModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setShowCancelModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-brand-card border border-white/10 p-6 text-center space-y-4 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Chiudi finestra modale"
              onClick={() => setShowCancelModal(false)}
              className="absolute top-4 right-4 text-white/50 hover:text-white p-1 rounded-full cursor-pointer"
            >
              <X size={20} />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto text-red-400">
              <Trash2 size={24} />
            </div>

            <div className="space-y-1.5">
              <h3 id="cancel-modal-title" className="text-base font-bold text-white">Annullare il workout attivo?</h3>
              <p className="text-xs text-brand-grey leading-relaxed">
                Tutti i set completati e i progressi di questa sessione verranno eliminati. Questa azione non può essere annullata.
              </p>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Continua Workout
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-semibold shadow-lg shadow-red-600/25 transition-colors cursor-pointer"
              >
                Annulla Sessione
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ActiveWorkoutBanner;
