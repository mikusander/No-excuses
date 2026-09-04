/**
 * workoutMediaSession.ts — Widget per la Lockscreen e Background Audio Keeper.
 *
 * Utilizza la Media Session API e un audio continuo silente (/silence.wav) per
 * mantenere attivo il thread di esecuzione in background su iOS (Safari) e Android,
 * visualizzando in tempo reale il conto alla rovescia del recupero nella schermata di blocco
 * e consentendo di mettere in pausa, riprendere o saltare il recupero dai tasti multimediali.
 */

let silentAudio: HTMLAudioElement | null = null;

const getSilentAudio = (): HTMLAudioElement => {
  if (!silentAudio && typeof Audio !== 'undefined') {
    silentAudio = new Audio('/silence.wav');
    silentAudio.loop = true;
    silentAudio.volume = 0.01;
    silentAudio.preload = 'auto';
  }
  return silentAudio!;
};

/**
 * Avvia l'audio in modo sincrono direttamente all'interno di un'interazione utente (click/tap).
 * Su iOS Safari questo passaggio è fondamentale per sbloccare l'audio session in modalità 'playback'.
 */
export const startRestMediaSessionAudio = () => {
  if (typeof window === 'undefined') return;
  try {
    const audio = getSilentAudio();

    if ('audioSession' in navigator && (navigator as any).audioSession) {
      try {
        (navigator as any).audioSession.type = 'playback';
      } catch {
        // ignore
      }
    }

    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.debug('startRestMediaSessionAudio autoplay catch:', err);
      });
    }
  } catch (err) {
    console.debug('startRestMediaSessionAudio error:', err);
  }
};

export const pauseRestMediaSessionAudio = () => {
  if (silentAudio && !silentAudio.paused) {
    try {
      silentAudio.pause();
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'paused';
    } catch {
      // ignore
    }
  }
};

export const resumeRestMediaSessionAudio = () => {
  if (silentAudio && silentAudio.paused) {
    try {
      silentAudio.play().catch(() => {});
    } catch {
      // ignore
    }
  }
  if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'playing';
    } catch {
      // ignore
    }
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

  const audio = getSilentAudio();
  if (isRunning && audio.paused) {
    audio.play().catch(() => {});
  }

  const nextLabel = nextExerciseName
    ? `Prossimo: ${nextExerciseName}${nextSetInfo ? ` (${nextSetInfo})` : ''}`
    : 'No Excuses Workout';

  const timeLabel = formatMinSec(remainingSeconds);

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `⏱️ Recupero: ${timeLabel}`,
      artist: 'No Excuses Workout',
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
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(1, totalSeconds),
          playbackRate: isRunning ? 1 : 0,
          position: elapsed,
        });
      } catch {
        // ignore
      }
    }

    navigator.mediaSession.setActionHandler('play', () => {
      audio.play().catch(() => {});
      onResume?.();
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
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
  if (typeof window === 'undefined') return;

  if (silentAudio) {
    try {
      silentAudio.pause();
      silentAudio.currentTime = 0;
    } catch {
      // ignore
    }
  }

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    } catch {
      // ignore
    }
  }
};
