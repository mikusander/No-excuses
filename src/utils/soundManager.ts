/**
 * soundManager.ts — Pilastro 3: Segnali Acustici con Web Audio API.
 *
 * ARCHITETTURA SPECIFICA PER IOS SAFARI & SPOTIFY:
 *
 * 1. ZERO AUDIO FOCUS:
 *    Nessun elemento <audio> multimediale che rubi il controllo Now Playing a Spotify o Apple Music.
 *
 * 2. KEEP-ALIVE WEBAUDIO ANTI-SOSPENSIONE IOS:
 *    Su Safari iOS, qualsiasi AudioContext inattivo per più di 3 secondi viene forzatamente
 *    sospeso ('suspended') da WebKit. A quel punto, riprenderlo dall'interno di un setInterval
 *    viene categoricamente BLOCCATO dalle policy di autoplay di Apple.
 *    La soluzione definitiva è collegare un nodo keep-alive sub-udibile continuo a `ctx.destination`,
 *    mantenendo lo stato in 'running' permanente per tutta la durata dell'allenamento.
 *
 * 3. AUDIOSESSION 'transient' / 'ambient':
 *    Comunica a iOS di mixare il suono (con ducking temporaneo) SOPRA la musica in riproduzione.
 *
 * 4. FREQUENZE CALIBRATE:
 *    - ~440 Hz: pre-avvisi conto alla rovescia (-3s, -2s, -1s)
 *    - ~880 Hz: segnale di fine recupero (0s)
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private isUnlocked = false;
  private keepAliveNode: OscillatorNode | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const handleUserGesture = () => {
        this.unlock();
      };
      window.addEventListener('pointerdown', handleUserGesture, { passive: true });
      window.addEventListener('touchstart', handleUserGesture, { passive: true });
      window.addEventListener('click', handleUserGesture, { passive: true });
      window.addEventListener('keydown', handleUserGesture, { passive: true });

      const resumeOnWake = () => {
        if (this.ctx && (this.ctx.state === 'suspended' || (this.ctx.state as any) === 'interrupted')) {
          this.ctx.resume().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', resumeOnWake);
      window.addEventListener('pageshow', resumeOnWake);
      window.addEventListener('focus', resumeOnWake);
    }
  }

  /**
   * Imposta l'AudioSession su 'transient' (ducking sopra la musica) con fallback su 'ambient'.
   */
  private configureSession() {
    if (typeof navigator !== 'undefined' && 'audioSession' in navigator && (navigator as any).audioSession) {
      try {
        (navigator as any).audioSession.type = 'transient';
      } catch {
        try {
          (navigator as any).audioSession.type = 'ambient';
        } catch {
          // ignore
        }
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
        this.configureSession();
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /**
   * Avvia un nodo sub-udibile continuo collegato alla destinazione.
   * Questo mantiene l'AudioContext in stato 'running' permanente su iOS Safari,
   * impedendo a WebKit di sospenderlo per inattività durante il timer di recupero.
   */
  private startKeepAlive(ctx: AudioContext) {
    if (this.keepAliveNode) return;
    try {
      // Usiamo una frequenza sub-bassa a volume infinitesimalmente basso (0.00002)
      // ma presente nel buffer grafico per mantenere attivo il clock audio
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = 30; // 30 Hz sub-bassa inudibile
      gain.gain.value = 0.00002;

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      osc.onended = () => {
        this.keepAliveNode = null;
      };

      this.keepAliveNode = osc;
    } catch (err) {
      console.debug('startKeepAlive error:', err);
    }
  }

  /**
   * Sblocca l'AudioContext su iOS Safari e attiva il keep-alive permanente.
   * Viene richiamato al primo tocco o tap dell'utente.
   */
  public async unlock(): Promise<boolean> {
    try {
      const ctx = this.getContext();
      if (!ctx) return false;

      this.configureSession();

      if (ctx.state !== 'running') {
        await ctx.resume();
      }

      this.startKeepAlive(ctx);

      if (!this.isUnlocked) {
        // Riproduci 1 micro-sample per svegliare il driver audio di iOS
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        this.isUnlocked = true;
      }
      return true;
    } catch (err) {
      console.debug('SoundManager unlock error:', err);
      return false;
    }
  }

  /**
   * Riproduce un beep a una frequenza specifica con inviluppo esponenziale per evitare click.
   */
  public async playBeep(freq: number, durationSeconds: number, volume: number = 0.85) {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      this.configureSession();

      if (ctx.state !== 'running') {
        await ctx.resume();
      }

      this.startKeepAlive(ctx);

      const now = ctx.currentTime + 0.02;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // 'triangle' genera ricche armoniche superiori che bucano i bassi e le voci della musica
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      // Inviluppo anti-click: attacco netto di 8ms e rilascio esponenziale
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volume, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationSeconds);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durationSeconds + 0.04);
    } catch (err) {
      console.debug('SoundManager playBeep error:', err);
    }
  }

  /**
   * Pre-avvisi conto alla rovescia (-3s, -2s, -1s): Frequenza ~440 Hz, durata 100ms.
   */
  public playCountdownBeep(secondsRemaining?: number) {
    const freq = secondsRemaining === 1 ? 440 : 440;
    void this.playBeep(freq, 0.12, 0.85);
  }

  /**
   * Segnale di fine recupero (0s): Frequenza ~880 Hz, durata 400ms.
   */
  public playRestFinishedSound() {
    void this.playBeep(880, 0.45, 0.9);
  }

  /**
   * Suono per il completamento complessivo dell'allenamento.
   */
  public async playGoalReachedSound() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      this.configureSession();
      if (ctx.state !== 'running') await ctx.resume();
      this.startKeepAlive(ctx);

      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      const noteDur = 0.16;
      notes.forEach((freq, idx) => {
        const now = ctx.currentTime + 0.02 + idx * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.8, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, now + noteDur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + noteDur + 0.04);
      });
    } catch (err) {
      console.debug('playGoalReachedSound error:', err);
    }
  }

  /**
   * Esegue un test acustico immediato per consentire all'utente di verificare il suono su iPhone.
   */
  public async testAudio() {
    await this.unlock();
    await this.playBeep(440, 0.12, 0.9);
    setTimeout(async () => {
      await this.playBeep(880, 0.35, 0.95);
    }, 180);
  }
}

export const soundManager = new SoundManager();
