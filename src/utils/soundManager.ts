/**
 * soundManager.ts — Pilastro 3: Segnali Acustici con Web Audio API.
 *
 * MODALITÀ SINTETIZZATORE ZERO-AUDIO-FOCUS:
 * Genera feedback sonori esclusivamente via Web Audio API (senza tag <audio> o file esterni),
 * evitando categoricamente di richiedere il controller multimediale globale o l'Audio Focus di sistema.
 *
 * Configurato con AudioSession 'ambient' affinché la musica in background (Spotify, Apple Music, ecc.)
 * continui a suonare ininterrottamente.
 *
 * FREQUENZE SPECIFICHE:
 *  - ~440 Hz: pre-avvisi conto alla rovescia (-3s, -2s, -1s)
 *  - ~880 Hz: segnale di fine recupero (0s)
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private isUnlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const handleUserGesture = () => {
        this.unlock();
      };
      window.addEventListener('pointerdown', handleUserGesture, { once: false, passive: true });
      window.addEventListener('touchstart', handleUserGesture, { once: false, passive: true });
      window.addEventListener('keydown', handleUserGesture, { once: false, passive: true });
    }
  }

  /**
   * Assicura l'impostazione dell'AudioSession su 'ambient' per mixaggio senza interruzioni.
   */
  private configureAmbientSession() {
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator && (navigator as any).audioSession) {
      try {
        (navigator as any).audioSession.type = 'ambient';
      } catch {
        // ignore
      }
    }
  }

  /**
   * Restituisce (o crea lazy) il singleton dell'AudioContext.
   */
  public getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
        this.configureAmbientSession();
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /**
   * Sblocca l'AudioContext su iOS Safari / mobile tramite micro-buffer muto.
   */
  public unlock() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      this.configureAmbientSession();

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (!this.isUnlocked) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        this.isUnlocked = true;
      }
    } catch (err) {
      console.debug('SoundManager unlock error:', err);
    }
  }

  /**
   * Riproduce un beep a una frequenza specifica con inviluppo esponenziale per evitare click.
   */
  private playBeep(freq: number, durationSeconds: number, volume: number = 0.75) {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      this.configureAmbientSession();

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Forma d'onda sinusoidale pura con calore armonica per penetrare il mix senza distorsione
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      // Inviluppo anti-click: attacco rapido di 6ms e rilascio esponenziale
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durationSeconds);
    } catch (err) {
      console.debug('SoundManager playBeep error:', err);
    }
  }

  /**
   * Pre-avvisi conto alla rovescia (-3s, -2s, -1s): Frequenza ~440 Hz, durata 100ms.
   */
  public playCountdownBeep(secondsRemaining?: number) {
    // Opzionale: per 1s usiamo 440 Hz come richiesto (o leggermente differenziato ~523Hz per enfasi)
    const freq = secondsRemaining === 1 ? 440 : 440;
    this.playBeep(freq, 0.1, 0.7);
  }

  /**
   * Segnale di fine recupero (0s): Frequenza ~880 Hz, durata 400ms.
   */
  public playRestFinishedSound() {
    this.playBeep(880, 0.4, 0.85);
  }

  /**
   * Suono arpeggiato opzionale per completamento workout complessivo.
   */
  public playGoalReachedSound() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      this.configureAmbientSession();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      const noteDur = 0.16;
      notes.forEach((freq, idx) => {
        const now = ctx.currentTime + idx * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.65, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + noteDur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + noteDur);
      });
    } catch (err) {
      console.debug('playGoalReachedSound error:', err);
    }
  }
}

export const soundManager = new SoundManager();
