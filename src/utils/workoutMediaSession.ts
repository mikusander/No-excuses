/**
 * workoutMediaSession.ts — Gestione Titolo Scheda e compatibilità totale musica.
 *
 * NOTA ARCHITETTURALE:
 * Per non interrompere o mettere in pausa la musica esterna (Spotify, Apple Music, YouTube Music),
 * non viene istanziato ALCUN elemento audio HTML (niente silence.wav) né viene richiesto
 * l'Audio Focus di sistema.
 * La visualizzazione del recupero sopra altre app è gestita dal Picture-in-Picture (pipManager.ts)
 * e dai segnali sintetizzati Web Audio (soundManager.ts).
 */

const formatMinSec = (totalSeconds: number) => {
  const s = Math.max(0, Math.trunc(totalSeconds));
  const m = Math.floor(s / 60);
  const remainingS = s % 60;
  return `${m}:${remainingS < 10 ? '0' : ''}${remainingS}`;
};

export interface RestMediaSessionParams {
  totalSeconds: number;
  remainingSeconds: number;
  nextExerciseName?: string;
  nextSetInfo?: string;
  isRunning: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onSkip?: () => void;
}

export const updateRestMediaSession = ({
  remainingSeconds,
  isRunning,
}: RestMediaSessionParams) => {
  if (typeof window === 'undefined') return;

  const timeLabel = formatMinSec(remainingSeconds);

  // Aggiorna sempre il titolo della scheda nel browser
  if (isRunning && remainingSeconds > 0) {
    document.title = `⏱️ ${timeLabel} - Recupero | No Excuses`;
  }
};

export const stopRestMediaSession = () => {
  if (typeof window === 'undefined') return;
  document.title = 'No Excuses Workout';
};

export const startRestMediaSessionAudio = () => {
  // No-op intenzionale: zero audio playback per non toccare Spotify
};

export const pauseRestMediaSessionAudio = () => {
  // No-op intenzionale
};

export const resumeRestMediaSessionAudio = () => {
  // No-op intenzionale
};
