/**
 * audio.ts — Utility per la generazione di feedback audio sintetici.
 *
 * Re-esporta e integra il SoundManager (Pilastro 3) per garantire compatibilità
 * assoluta con la musica in background (Spotify, Apple Music, YouTube Music).
 */

import { soundManager } from './soundManager';

export { soundManager };

export const unlockAudio = () => {
  soundManager.unlock();
};

export const configureAmbientAudio = () => {
  soundManager.getContext();
};

export const getAudioCtx = (): AudioContext => {
  const ctx = soundManager.getContext();
  if (!ctx) {
    throw new Error('AudioContext non disponibile');
  }
  return ctx;
};

export const isAudioFeedbackEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('voice_assistance_enabled') !== 'false';
};

export const playCountdownBeep = (secondsRemaining?: number) => {
  if (!isAudioFeedbackEnabled()) return;
  soundManager.playCountdownBeep(secondsRemaining);
};

export const playRestFinishedSound = () => {
  if (!isAudioFeedbackEnabled()) return;
  soundManager.playRestFinishedSound();
};

export const playGoalReachedSound = () => {
  if (!isAudioFeedbackEnabled()) return;
  soundManager.playGoalReachedSound();
};

export const testAudio = () => {
  if (!isAudioFeedbackEnabled()) return;
  soundManager.testAudio();
};

export const playErrorSound = () => {
  if (!isAudioFeedbackEnabled()) return;
  try {
    const ctx = soundManager.getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (err) {
    console.debug('playErrorSound error:', err);
  }
};
