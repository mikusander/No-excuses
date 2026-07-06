/**
 * HomePage.tsx — Schermata principale dell'applicazione.
 *
 * Punto di atterraggio dopo il login. Mostra due WorkoutCard per accedere alle
 * due modalità di allenamento (Guided Program e Free Mode) e, se esiste un
 * checkpoint di workout interrotto, propone una modal di ripresa.
 *
 * Flusso di resume workout:
 *  1. All'avvio, se l'utente è loggato, si controlla il localStorage per checkpoint
 *     di workout non completati (via `getLatestWorkoutProgressCheckpoint`).
 *  2. Il prompt di resume viene mostrato al massimo una volta per sessione browser
 *     (gestito tramite sessionStorage con la chiave RESUME_PROMPT_SESSION_KEY).
 *  3. Se l'utente clicca "No, start new workout", tutti i checkpoint vengono cancellati.
 *  4. Se clicca "Resume", viene reindirizzato al workout interrotto.
 *
 * Il checkpoint può puntare a:
 *  - `/active-workout/:id`          → workout avviato da una scheda
 *  - `/active-workout-history/:id`  → workout rieseguito dallo storico
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HeaderLogo from '../components/HeaderLogo';
import WorkoutCard from '../components/WorkoutCard';
import BottomNavigation from '../components/BottomNavigation';
import { useAuth } from '../context/AuthContext';
import {
  clearAllWorkoutProgressCheckpoints,
  getLatestWorkoutProgressCheckpoint,
  pruneWorkoutProgressCheckpoints,
} from '../lib/workoutProgressStorage';

/** Dati del workout interrotto da proporre all'utente per la ripresa */
interface ResumeCheckpointCandidate {
  targetPath: string; // Rotta React Router verso cui navigare per riprendere
  savedAtMs: number;  // Timestamp Unix (ms) dell'ultimo salvataggio
  label: string;      // Etichetta leggibile (es. "workout #42")
}

/**
 * Chiave sessionStorage che impedisce di mostrare il prompt di resume più volte
 * nella stessa sessione browser (si resetta quando si chiude il tab).
 */
const RESUME_PROMPT_SESSION_KEY = 'resume_prompt_shown_v1';

/**
 * Formatta un timestamp Unix in formato data/ora leggibile (DD/MM/YYYY HH:mm).
 * Restituisce stringa vuota se il valore non è una data valida.
 */
const formatCheckpointTimestamp = (savedAtMs: number) => {
  const parsed = new Date(savedAtMs);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const HomePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  // null = nessun checkpoint trovato o già gestito; oggetto = prompt di resume visibile
  const [resumeCandidate, setResumeCandidate] = useState<ResumeCheckpointCandidate | null>(null);

  useEffect(() => {
    // Nessun utente loggato: reset sicuro dello state
    if (!user?.id) {
      setResumeCandidate(null);
      return;
    }

    // Il prompt è già stato mostrato in questa sessione browser → non ripetere
    if (sessionStorage.getItem(RESUME_PROMPT_SESSION_KEY) === '1') {
      return;
    }

    // Cerca il checkpoint più recente nel localStorage dell'utente
    const latestCheckpoint = getLatestWorkoutProgressCheckpoint(user.id);
    if (!latestCheckpoint) return;

    // Elimina tutti gli altri checkpoint tranne quello più recente (pulizia)
    pruneWorkoutProgressCheckpoints(user.id, latestCheckpoint.key);

    // Determina la rotta di ripresa in base al tipo di checkpoint
    const isHistoryRun = latestCheckpoint.identity.type === 'run';
    const resumeModel: ResumeCheckpointCandidate = {
      targetPath: isHistoryRun
        ? `/active-workout-history/${latestCheckpoint.identity.id}`
        : `/active-workout/${latestCheckpoint.identity.id}`,
      savedAtMs: latestCheckpoint.savedAtMs,
      label: isHistoryRun
        ? `history workout #${latestCheckpoint.identity.id}`
        : `workout #${latestCheckpoint.identity.id}`,
    };

    setResumeCandidate(resumeModel);
    // Marca il prompt come già mostrato per questa sessione
    sessionStorage.setItem(RESUME_PROMPT_SESSION_KEY, '1');
  }, [user?.id]); // Re-esegue solo se cambia l'utente loggato

  /** Chiude il prompt e cancella tutti i checkpoint (l'utente vuole ricominciare) */
  const closeResumePrompt = () => {
    if (user?.id) {
      clearAllWorkoutProgressCheckpoints(user.id);
    }
    setResumeCandidate(null);
  };

  /** Naviga verso il workout interrotto */
  const resumeWorkout = () => {
    if (!resumeCandidate) return;
    navigate(resumeCandidate.targetPath);
  };

  return (
    <div className="pb-24 flex flex-col items-center relative min-h-screen">
      <HeaderLogo />

      <main className="w-full flex flex-col items-center mt-4 space-y-8">
        {/* Card modalità guidata (Guided Program) — animazione delay 1 */}
        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-1">
          <WorkoutCard
            imageSrc="/images/download.jpeg"
            buttonText="START NEW TRAIN"
            to="/select-workout"
            ctaVariant="primary"
          />
        </div>

        {/* Card modalità libera (Free Mode) — animazione delay 2 */}
        <div className="w-full flex justify-center animate-home-card animate-home-card-delay-2">
          <WorkoutCard
            imageSrc="/images/download (1).jpeg"
            buttonText="START REPS COUNT"
            to="/reps-count"
            ctaVariant="secondary"
          />
        </div>
      </main>

      {/* Modal di ripresa workout — visibile solo se esiste un checkpoint */}
      {resumeCandidate && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-brand-darkGrey/95 border border-brand-grey/20 rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-black text-white">Resume workout?</h2>
            <p className="text-sm text-brand-grey mt-2 leading-relaxed">
              I found a saved checkpoint for {resumeCandidate.label}.
            </p>
            <p className="text-xs text-brand-grey/80 mt-2">
              Last saved: {formatCheckpointTimestamp(resumeCandidate.savedAtMs)}
            </p>

            <div className="mt-5 flex items-center justify-end gap-3">
              {/* Rifiuta la ripresa: cancella checkpoint e chiude la modal */}
              <button
                onClick={closeResumePrompt}
                className="px-4 py-2 rounded-xl border border-brand-grey/30 text-brand-grey hover:text-white hover:border-brand-grey/50 transition-colors text-sm font-bold"
              >
                No, start new workout
              </button>
              {/* Accetta la ripresa: naviga verso il workout interrotto */}
              <button
                onClick={resumeWorkout}
                className="px-4 py-2 rounded-xl bg-brand-orange hover:bg-brand-lightOrange text-black transition-colors text-sm font-black"
              >
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNavigation />
    </div>
  );
};

export default HomePage;
