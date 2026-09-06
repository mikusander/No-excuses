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

export const playCountdownBeep = (secondsRemaining?: number) => {
  soundManager.playCountdownBeep(secondsRemaining);
};

export const playRestFinishedSound = () => {
  soundManager.playRestFinishedSound();
};

export const playGoalReachedSound = () => {
  soundManager.playGoalReachedSound();
};

export const playErrorSound = () => {
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
