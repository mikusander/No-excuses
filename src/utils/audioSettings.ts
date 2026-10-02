/**
 * audioSettings.ts — Gestione centralizzata delle preferenze audio dell'app No-Excuses.
 *
 * Supporta 3 modalità:
 *  - 'disabled' (Disattivato) : nessun audio, nessun segnale acustico né voce.
 *  - 'minimal'  (Minimale)    : segnali acustici solo alla fine di ogni timer (recupero, EMOM, isometrie, ecc.). Nessuna voce.
 *  - 'full'     (Completa)    : segnali acustici + voce parlata completa che annuncia dettagli esercizio e recupero.
 *
 * Persistenza:
 *  - Offline-first in `localStorage` con fallback retrocompatibile su `voice_assistance_enabled`.
 *  - Sincronizzazione remota nei metadati utente Supabase (`user_metadata.audio_mode`) e retrocompatibilità booleana su `profili.voice_assistant`.
 */

export type AudioMode = 'disabled' | 'minimal' | 'full';

export const AUDIO_MODE_KEY = 'audio_mode_preference';
export const VOICE_ASSIST_KEY = 'voice_assistance_enabled';

/**
 * Restituisce la modalità audio attualmente impostata.
 */
export const getAudioMode = (): AudioMode => {
  if (typeof window === 'undefined') return 'full';
  
  const saved = localStorage.getItem(AUDIO_MODE_KEY);
  if (saved === 'disabled' || saved === 'minimal' || saved === 'full') {
    return saved;
  }

  // Retrocompatibilità con vecchie installazioni che hanno solo voice_assistance_enabled
  const legacyVoice = localStorage.getItem(VOICE_ASSIST_KEY);
  if (legacyVoice === 'false') {
    return 'disabled';
  }
  return 'full';
};

/**
 * Salva la modalità audio in localStorage e notifica i componenti attivi.
 */
export const setAudioMode = (mode: AudioMode) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUDIO_MODE_KEY, mode);
  // Mantieni sincrono il flag booleano legacy per retrocompatibilità
  localStorage.setItem(VOICE_ASSIST_KEY, mode === 'full' ? 'true' : 'false');

  window.dispatchEvent(new CustomEvent('audio-mode-changed', { detail: mode }));
  window.dispatchEvent(new CustomEvent('voice-assistance-changed', { detail: mode === 'full' }));
};

/**
 * Indica se l'audio è completamente disattivato.
 */
export const isAudioDisabled = (): boolean => getAudioMode() === 'disabled';

/**
 * Indica se è attiva la modalità minimale (solo beep fine timer).
 */
export const isAudioMinimal = (): boolean => getAudioMode() === 'minimal';

/**
 * Indica se è attiva la modalità completa (beep + voce guida completa).
 */
export const isAudioFull = (): boolean => getAudioMode() === 'full';

/**
 * Suoni di fine timer (fine recupero, fine round EMOM, fine isometria, goal completato).
 * Abilitati sia in 'minimal' che in 'full'.
 */
export const areTimerEndSoundsEnabled = (): boolean => {
  const mode = getAudioMode();
  return mode === 'minimal' || mode === 'full';
};

/**
 * Beep intermedi di countdown (-3s, -2s, -1s).
 * Abilitati solo in 'full' (nella minimale i suoni sono solo alla fine dei timer).
 */
export const areCountdownBeepsEnabled = (): boolean => {
  return getAudioMode() === 'full';
};

/**
 * Voce assistente di sintesi vocale (TTS).
 * Abilitata esclusivamente in 'full'.
 */
export const isVoiceGuidanceEnabled = (): boolean => {
  return getAudioMode() === 'full';
};
