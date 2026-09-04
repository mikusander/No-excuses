/**
 * workoutMediaSession.ts — Gestione Media Session e compatibilità musica esterna (Spotify, Apple Music).
 *
 * POLICY AUDIO MUSICA:
 * Su iOS e Android esiste un solo slot "Now Playing" per i controlli multimediali.
 * Se la web app avvia un lettore audio multimediale (playback), il sistema operativo
 * mette forzatamente in pausa Spotify o Apple Music.
 *
 * Per evitare che la musica dell'utente si fermi durante il workout:
 * - La modalità predefinita è "Music-Friendly": NON avvia alcun audio silente continuo,
 *   lasciando che la musica esterna continui a suonare al 100% ininterrottamente.
 * - Imposta l'Audio Session su 'ambient' per consentire ai bip/chime di fine recupero
 *   di suonare SOPRA la musica senza mai fermarla.
 * - Il widget lockscreen rimane un'opzione facoltativa (opt-in) per chi non ascolta musica.
 */

const LOCKSCREEN_WIDGET_KEY = 'workout_lockscreen_widget_enabled';

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
 * Controlla se il widget multimediale lockscreen è abilitato.
 * Il default è FALSE così Spotify / Apple Music NON vengono mai interrotti!
 */
export const isLockscreenMediaWidgetEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LOCKSCREEN_WIDGET_KEY) === 'true';
};

export const setLockscreenMediaWidgetEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCKSCREEN_WIDGET_KEY, String(enabled));
  if (!enabled) {
    stopRestMediaSession();
  }
};

/**
 * Avvia l'audio del recupero.
 * Se il widget lockscreen non è abilitato, imposta 'ambient' per non toccare la musica.
 */
export const startRestMediaSessionAudio = () => {
  if (typeof window === 'undefined') return;

  // Se l'opzione salva-musica è attiva (default), impostiamo ambient e NON avviamo l'audio continuo
  if (!isLockscreenMediaWidgetEnabled()) {
    if ('audioSession' in navigator && (navigator as any).audioSession) {
      try {
        (navigator as any).audioSession.type = 'ambient';
      } catch {
        // ignore
      }
    }
    return;
  }

  // Modalità Lockscreen widget esplicita (interrompe la musica esterna)
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
  if (!isLockscreenMediaWidgetEnabled()) return;

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
  if (!isLockscreenMediaWidgetEnabled()) return;

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
  if (typeof window === 'undefined') return;

  const timeLabel = formatMinSec(remainingSeconds);

  // Aggiorna sempre il titolo della scheda nel browser
  if (isRunning && remainingSeconds > 0) {
    document.title = `⏱️ ${timeLabel} - Recupero | No Excuses`;
  }

  // Se il widget lockscreen è disattivato per proteggere la musica, non tocchiamo MediaSession
  if (!isLockscreenMediaWidgetEnabled() || !('mediaSession' in navigator)) {
    return;
  }

  const audio = getSilentAudio();
  if (isRunning && audio.paused) {
    audio.play().catch(() => {});
  }

  const nextLabel = nextExerciseName
    ? `Prossimo: ${nextExerciseName}${nextSetInfo ? ` (${nextSetInfo})` : ''}`
    : 'No Excuses Workout';

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

  document.title = 'No Excuses Workout';

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
