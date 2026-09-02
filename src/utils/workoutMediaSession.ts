/**
 * workoutMediaSession.ts — Widget per la Lockscreen e Background Audio Keeper.
 *
 * Utilizza la Media Session API e un micro-audio silente per mantenere attivo
 * il countdown del timer e visualizzarlo in tempo reale sulla schermata di blocco
 * del telefono e nel centro notifiche di iOS e Android.
 */

// Audio silente WAV 1s (44 byte PCM)
const SILENT_WAV_BASE64 =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let silentAudio: HTMLAudioElement | null = null;
let isAudioInitialized = false;

const getSilentAudio = (): HTMLAudioElement => {
  if (!silentAudio && typeof Audio !== 'undefined') {
    silentAudio = new Audio(SILENT_WAV_BASE64);
    silentAudio.loop = true;
    silentAudio.volume = 0.01;
    silentAudio.preload = 'auto';
  }
  return silentAudio!;
};

/**
 * Sblocca l'elemento audio durante un'interazione utente (click/tap/start).
 */
export const warmupMediaSessionAudio = () => {
  if (isAudioInitialized || typeof window === 'undefined') return;
  try {
    const audio = getSilentAudio();
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          audio.pause();
          isAudioInitialized = true;
        })
        .catch(() => {
          // Attenderà il prossimo gesto utente
        });
    }
  } catch {
    // ignore
  }
};

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
  totalSeconds,
  remainingSeconds,
  nextExerciseName,
  nextSetInfo,
  isRunning,
  onPause,
  onResume,
  onSkip,
}: RestMediaSessionParams) => {
  if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

  // Avvia l'audio silente per mantenere sveglio il thread in background
  if (isRunning) {
    try {
      const audio = getSilentAudio();
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  const nextLabel = nextExerciseName
    ? `Prossimo: ${nextExerciseName}${nextSetInfo ? ` (${nextSetInfo})` : ''}`
    : 'No Excuses Workout';

  const timeLabel = formatMinSec(remainingSeconds);

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `⏱️ Recupero: ${timeLabel}`,
      artist: 'No Excuses',
      album: nextLabel,
      artwork: [
        { src: '/favicon.svg', sizes: '96x96', type: 'image/svg+xml' },
        { src: '/favicon.svg', sizes: '192x192', type: 'image/svg+xml' },
        { src: '/favicon.svg', sizes: '512x512', type: 'image/svg+xml' },
      ],
    });

    navigator.mediaSession.playbackState = isRunning ? 'playing' : 'paused';

    if ('setPositionState' in navigator.mediaSession && totalSeconds > 0) {
      const elapsed = Math.min(totalSeconds, Math.max(0, totalSeconds - remainingSeconds));
      navigator.mediaSession.setPositionState({
        duration: Math.max(1, totalSeconds),
        playbackRate: isRunning ? 1 : 0,
        position: elapsed,
      });
    }

    // Handlers di azione per i tasti multimediali della Lockscreen
    navigator.mediaSession.setActionHandler('play', () => {
      onResume?.();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      onPause?.();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      onSkip?.();
    });
  } catch (error) {
    console.debug('MediaSession update skipped:', error);
  }
};

export const stopRestMediaSession = () => {
  if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

  if (silentAudio && !silentAudio.paused) {
    try {
      silentAudio.pause();
    } catch {
      // ignore
    }
  }

  try {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.setActionHandler('nexttrack', null);
  } catch {
    // ignore
  }
};
