/**
 * audio.ts — Utility per la generazione di feedback audio sintetici.
 *
 * Usa la Web Audio API per produrre suoni in-browser senza file audio esterni.
 * Il contesto audio viene creato in modo lazy al primo utilizzo e riutilizzato
 * successivamente (singleton) per evitare il limite di istanze del browser.
 *
 * Funzioni esportate:
 *  - `playErrorSound`       : suono basso discendente (errore / rep non valida)
 *  - `playGoalReachedSound` : arpeggio ascendente Do-Mi-Sol (obiettivo raggiunto)
 */

// Singleton del contesto audio — viene creato al primo utilizzo e condiviso
let audioCtx: AudioContext | null = null;

/**
 * Restituisce (creando se necessario) il contesto Web Audio.
 * Riprende il contesto se era stato sospeso dal browser (policy autoplay).
 */
const getAudioCtx = (): AudioContext => {
  if (!audioCtx) {
    // Fallback per Safari che usa il prefisso webkit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator && (navigator as any).audioSession) {
      try {
        (navigator as any).audioSession.type = 'ambient';
      } catch {
        // ignore
      }
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
};

/**
 * `playErrorSound` — Suono di errore/avviso.
 * Oscillatore square con frequenza che scende da 150 Hz a 40 Hz in 300 ms.
 * Usato quando una ripetizione viene rifiutata (movimento non valido).
 */
export const playErrorSound = () => {
  const ctx = getAudioCtx();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(150, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);
  gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.3);
};

/**
 * `playGoalReachedSound` — Suono di obiettivo raggiunto.
 * Tre note ascendenti (Do-Mi-Sol, C5-E5-G5) suonate in sequenza.
 * Usato quando l'utente completa tutte le ripetizioni target di una serie.
 */
export const playGoalReachedSound = () => {
  const ctx = getAudioCtx();
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  const noteDuration = 0.18;
  const gap = 0.06; // pausa tra le note

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Ogni nota parte dopo la precedente (noteDuration + gap)
    const startTime = ctx.currentTime + i * (noteDuration + gap);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    // Fade-in rapido + fade-out esponenziale per un suono "campanellino"
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + noteDuration);
  });
};
