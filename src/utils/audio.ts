/**
 * audio.ts — Utility per la generazione di feedback audio sintetici.
 *
 * Usa la Web Audio API per produrre suoni in-browser senza file audio esterni.
 * Il contesto audio viene creato in modo lazy al primo utilizzo e riutilizzato
 * successivamente (singleton) per evitare il limite di istanze del browser.
 *
 * COMPATIBILITÀ CON SPOTIFY / APPLE MUSIC:
 * Configura l'AudioSession in modalità 'ambient' (o 'transient') affinché i bip del timer
 * e il suono di fine recupero vengano miscelati in cuffia INSIEME alla musica
 * SENZA MAI INTERROMPERLA o metterla in pausa.
 *
 * SBLOCCO AUTOMATICO SU IOS SAFARI:
 * `unlockAudio()` riproduce un micro-buffer muto al primo tocco dell'utente,
 * garantendo che Safari non blocchi i suoni generati dai timer.
 *
 * Funzioni esportate:
 *  - `unlockAudio`             : sblocca l'AudioContext su iOS
 *  - `configureAmbientAudio`   : assicura la modalità ambient anti-interruzione
 *  - `playErrorSound`          : suono basso discendente (errore / rep non valida)
 *  - `playCountdownBeep`       : bip ad alta frequenza per 3-2-1 che taglia la musica
 *  - `playRestFinishedSound`   : gong/chime squillante di fine recupero udibile su musica
 *  - `playGoalReachedSound`    : arpeggio ascendente Do-Mi-Sol (obiettivo raggiunto)
 */

// Singleton del contesto audio
let audioCtx: AudioContext | null = null;
let isAudioUnlocked = false;

/**
 * Assicura che l'AudioSession di sistema (iOS WebKit / Android) sia impostata su 'ambient'.
 * In modalità 'ambient', il browser NON richiede audio exclusivity e si mixa
 * direttamente con Spotify / Apple Music senza mai fermarli.
 */
export const configureAmbientAudio = () => {
  if (typeof navigator !== 'undefined' && 'audioSession' in navigator && (navigator as any).audioSession) {
    try {
      (navigator as any).audioSession.type = 'ambient';
    } catch {
      // ignore
    }
  }
};

/**
 * Restituisce (creando se necessario) il contesto Web Audio.
 * Riprende il contesto se era stato sospeso dal browser (policy autoplay).
 */
export const getAudioCtx = (): AudioContext => {
  if (!audioCtx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioCtxClass();
    configureAmbientAudio();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

/**
 * Sblocca permanentemente l'AudioContext su iOS Safari riproducendo un micro-buffer muto.
 * Può essere richiamato su qualsiasi evento di tocco/click.
 */
export const unlockAudio = () => {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getAudioCtx();
    configureAmbientAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!isAudioUnlocked) {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      isAudioUnlocked = true;
    }
  } catch (err) {
    console.debug('unlockAudio error:', err);
  }
};

// Registrazione automatica listener globali al primo tocco per sbloccare l'audio senza attrito
if (typeof window !== 'undefined') {
  const handleInitialUserGesture = () => {
    unlockAudio();
  };
  window.addEventListener('pointerdown', handleInitialUserGesture, { once: false, passive: true });
  window.addEventListener('touchstart', handleInitialUserGesture, { once: false, passive: true });
  window.addEventListener('keydown', handleInitialUserGesture, { once: false, passive: true });
}

/**
 * `playErrorSound` — Suono di errore/avviso.
 * Oscillatore square con frequenza che scende da 150 Hz a 40 Hz in 300 ms.
 */
export const playErrorSound = () => {
  try {
    const ctx = getAudioCtx();
    configureAmbientAudio();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(150, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  } catch (err) {
    console.debug('playErrorSound error:', err);
  }
};

/**
 * `playCountdownBeep` — Bip secco ad alta chiarezza per il conto alla rovescia (3, 2, 1).
 * Usa frequenze (880 Hz / 1046.5 Hz) che tagliano le frequenze basse e medie della musica
 * in cuffia, riprodotto in modalità 'ambient' affinché Spotify continui a suonare al 100%.
 */
export const playCountdownBeep = (secondsRemaining?: number) => {
  try {
    const ctx = getAudioCtx();
    configureAmbientAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Se è l'ultimo secondo (1), tono leggermente più alto (1046.5 Hz = C6), altrimenti 880 Hz (A5)
    const freq = secondsRemaining === 1 ? 1046.5 : 880;
    const duration = 0.095; // 95ms: incisivo, netto, professionale

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // 'triangle' genera armoniche superiori che superano il mix audio della musica senza distorcere
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.68, ctx.currentTime + 0.008);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (err) {
    console.debug('playCountdownBeep error:', err);
  }
};

/**
 * `playRestFinishedSound` — Segnale sonoro squillante di termine recupero (Gym Buzzer / Boxing Bell).
 * Arpeggio ascendente ad alta energia (880 Hz -> 987 Hz -> 1318.5 Hz)
 * progettato per essere udito con la massima chiarezza sopra qualsiasi brano musicale in cuffia.
 * Non ferma la musica grazie al profilo 'ambient'.
 */
export const playRestFinishedSound = () => {
  try {
    const ctx = getAudioCtx();
    configureAmbientAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const notes = [
      { freq: 880.0, start: now, dur: 0.12, gain: 0.65 },
      { freq: 987.77, start: now + 0.13, dur: 0.12, gain: 0.70 },
      { freq: 1318.51, start: now + 0.27, dur: 0.38, gain: 0.78 },
    ];

    notes.forEach(({ freq, start, dur, gain }) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gainNode.gain.setValueAtTime(0, start);
      gainNode.gain.linearRampToValueAtTime(gain, start + 0.012);
      gainNode.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + dur);
    });
  } catch (err) {
    console.debug('playRestFinishedSound error:', err);
  }
};

/**
 * `playGoalReachedSound` — Suono di obiettivo raggiunto (Do-Mi-Sol).
 * Arpeggio ad alta definizione con gain potenziato e modalità ambient.
 */
export const playGoalReachedSound = () => {
  try {
    const ctx = getAudioCtx();
    configureAmbientAudio();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const noteDuration = 0.18;
    const gap = 0.06;

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = ctx.currentTime + i * (noteDuration + gap);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.55, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + noteDuration);
    });
  } catch (err) {
    console.debug('playGoalReachedSound error:', err);
  }
};
