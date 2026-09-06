/**
 * pipManager.ts — Pilastro 1: Canvas-based / Document Picture-in-Picture (Overlay Visivo Flottante).
 *
 * OBIETTIVO:
 * Permettere all'utente di vedere il countdown in tempo reale sopra altre applicazioni aperte
 * (es. Spotify, WhatsApp, schermo home) durante la pausa, SENZA richiedere il focus audio multimediale.
 *
 * MECCANISMO A DUE LIVELLI CON FALLBACK:
 *  1. `window.documentPictureInPicture`:
 *     Se supportato (Chrome/Edge 116+), apre una mini-finestra HTML flottante reattiva con
 *     countdown, nome prossimo esercizio e pulsante "Salta".
 *  2. Fallback Canvas-based Video PiP:
 *     Per browser standard e dispositivi mobili con supporto standard Picture-in-Picture,
 *     renderizza un anello di progresso circolare su un `<canvas>` off-screen collegato via
 *     `canvas.captureStream()` a un elemento `<video>` categoricamente MUTO (`muted = true`, nessun audio track).
 *     Ciò impedisce al browser di richiedere l'Audio Focus di sistema, proteggendo Spotify.
 */

export interface PiPConfig {
  totalSeconds: number;
  remainingSeconds: number;
  nextExerciseName: string;
  nextSetInfo?: string;
  onSkip?: () => void;
}

class PiPManager {
  private mode: 'document' | 'video' | null = null;
  private config: PiPConfig | null = null;

  // Document PiP references
  private pipWindow: Window | null = null;
  private pipTimerElem: HTMLElement | null = null;
  private pipCircleElem: SVGCircleElement | null = null;

  // Canvas / Video PiP references
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;

  /**
   * Verifica se una qualsiasi forma di Picture-in-Picture è supportata dal browser.
   */
  public isSupported(): boolean {
    if (typeof window === 'undefined') return false;

    // Su iOS (iPhone / iPad), Apple WebKit non supporta Document PiP e blocca
    // il Picture-in-Picture per canvas stream simulati, impedendo qualsiasi overlay sopra la Home o altre app.
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) return false;

    const hasDocPiP = 'documentPictureInPicture' in window;
    const hasVideoPiP =
      typeof document !== 'undefined' &&
      'pictureInPictureEnabled' in document &&
      Boolean(document.pictureInPictureEnabled) &&
      typeof HTMLCanvasElement !== 'undefined' &&
      'captureStream' in HTMLCanvasElement.prototype;

    return hasDocPiP || hasVideoPiP;
  }

  /**
   * Indica se un overlay PiP è attualmente aperto e attivo.
   */
  public isActive(): boolean {
    return this.mode !== null;
  }

  /**
   * Avvia l'overlay Picture-in-Picture con il timer di recupero.
   * Deve essere chiamato preferibilmente a partire da una user gesture (tap/click).
   */
  public async openRestPiP(config: PiPConfig): Promise<boolean> {
    if (!this.isSupported()) return false;

    this.config = config;

    // Tentativo 1: Document Picture-in-Picture (HTML nativo)
    if ('documentPictureInPicture' in window) {
      try {
        const opened = await this.openDocumentPiP();
        if (opened) {
          this.mode = 'document';
          return true;
        }
      } catch (err) {
        console.debug('Document PiP failed, trying Canvas video fallback:', err);
      }
    }

    // Tentativo 2: Fallback Canvas-based Video PiP
    try {
      const openedVideo = await this.openCanvasVideoPiP();
      if (openedVideo) {
        this.mode = 'video';
        return true;
      }
    } catch (err) {
      console.debug('Canvas video PiP failed:', err);
    }

    return false;
  }

  /**
   * Aggiorna i secondi residui sul PiP attivo.
   */
  public updateRemaining(remainingSeconds: number) {
    if (!this.config) return;
    this.config.remainingSeconds = remainingSeconds;

    if (this.mode === 'document') {
      this.updateDocumentPiPView(remainingSeconds);
    } else if (this.mode === 'video') {
      this.renderCanvasFrame(remainingSeconds);
    }
  }

  /**
   * Chiude qualsiasi PiP attivo e ripulisce le risorse stream/video.
   */
  public closePiP() {
    if (this.mode === 'document') {
      if (this.pipWindow && !this.pipWindow.closed) {
        try {
          this.pipWindow.close();
        } catch {
          // ignore
        }
      }
      this.pipWindow = null;
      this.pipTimerElem = null;
      this.pipCircleElem = null;
    } else if (this.mode === 'video') {
      if (typeof document !== 'undefined' && document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      }
      if (this.video) {
        try {
          this.video.pause();
          this.video.srcObject = null;
        } catch {
          // ignore
        }
      }
      if (this.stream) {
        try {
          this.stream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        this.stream = null;
      }
    }

    this.mode = null;
    this.config = null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IMPLEMENTAZIONE DOCUMENT PICTURE-IN-PICTURE
  // ──────────────────────────────────────────────────────────────────────────

  private async openDocumentPiP(): Promise<boolean> {
    if (!('documentPictureInPicture' in window) || !this.config) return false;

    // Chiudi eventuale finestra precedente
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
    }

    const docPiP = (window as any).documentPictureInPicture;
    const pipWin: Window = await docPiP.requestWindow({
      width: 280,
      height: 200,
    });

    this.pipWindow = pipWin;

    // Costruisci documento HTML interno con stile Dark/Arancione
    const doc = pipWin.document;
    doc.title = '⏱️ Recupero Workout';

    const style = doc.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        background-color: #121212;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        overflow: hidden;
        user-select: none;
        padding: 12px;
      }
      .pip-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        text-align: center;
      }
      .timer-container {
        position: relative;
        width: 96px;
        height: 96px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 8px;
      }
      .timer-svg {
        position: absolute;
        top: 0;
        left: 0;
        transform: rotate(-90deg);
      }
      .timer-bg {
        stroke: #262626;
        stroke-width: 6;
        fill: none;
      }
      .timer-progress {
        stroke: #ff6b00;
        stroke-width: 6;
        stroke-linecap: round;
        fill: none;
        transition: stroke-dashoffset 0.8s linear;
      }
      .timer-digits {
        font-size: 24px;
        font-weight: 900;
        font-family: monospace;
        letter-spacing: -0.5px;
        z-index: 1;
      }
      .next-label {
        font-size: 10px;
        font-weight: 700;
        color: #888888;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 2px;
      }
      .next-exercise {
        font-size: 13px;
        font-weight: 800;
        color: #ff6b00;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 240px;
        margin-bottom: 8px;
      }
      .skip-btn {
        background: #262626;
        color: #ffffff;
        border: 1px solid #404040;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 800;
        padding: 4px 14px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .skip-btn:hover {
        background: #ff6b00;
        color: #000000;
      }
    `;
    doc.head.appendChild(style);

    const radius = 42;
    const circumference = 2 * Math.PI * radius;

    const wrapper = doc.createElement('div');
    wrapper.className = 'pip-card';
    wrapper.innerHTML = `
      <div class="timer-container">
        <svg class="timer-svg" width="96" height="96">
          <circle class="timer-bg" cx="48" cy="48" r="${radius}"></circle>
          <circle id="pip-progress" class="timer-progress" cx="48" cy="48" r="${radius}"
            stroke-dasharray="${circumference}" stroke-dashoffset="0"></circle>
        </svg>
        <span id="pip-digits" class="timer-digits">${this.formatTime(this.config.remainingSeconds)}</span>
      </div>
      <p class="next-label">Prossimo esercizio</p>
      <p class="next-exercise">${this.escapeHtml(this.config.nextExerciseName)} ${this.config.nextSetInfo ? `(${this.escapeHtml(this.config.nextSetInfo)})` : ''}</p>
      <button id="pip-skip" class="skip-btn">Salta Recupero</button>
    `;

    doc.body.appendChild(wrapper);

    this.pipTimerElem = doc.getElementById('pip-digits');
    this.pipCircleElem = doc.getElementById('pip-progress') as unknown as SVGCircleElement;

    const skipBtn = doc.getElementById('pip-skip');
    if (skipBtn && this.config.onSkip) {
      skipBtn.addEventListener('click', () => {
        if (this.config?.onSkip) {
          this.config.onSkip();
        }
        this.closePiP();
      });
    }

    pipWin.addEventListener('pagehide', () => {
      this.mode = null;
      this.pipWindow = null;
      this.pipTimerElem = null;
      this.pipCircleElem = null;
    });

    this.updateDocumentPiPView(this.config.remainingSeconds);
    return true;
  }

  private updateDocumentPiPView(remainingSeconds: number) {
    if (!this.pipTimerElem || !this.pipCircleElem || !this.config) return;

    this.pipTimerElem.textContent = this.formatTime(remainingSeconds);

    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const fraction = Math.max(0, Math.min(1, remainingSeconds / Math.max(1, this.config.totalSeconds)));
    const offset = circumference * (1 - fraction);

    this.pipCircleElem.style.strokeDashoffset = String(offset);

    if (remainingSeconds <= 3) {
      this.pipTimerElem.style.color = '#ff6b00';
    } else {
      this.pipTimerElem.style.color = '#ffffff';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IMPLEMENTAZIONE CANVAS-BASED VIDEO PICTURE-IN-PICTURE (FALLBACK)
  // ──────────────────────────────────────────────────────────────────────────

  private async openCanvasVideoPiP(): Promise<boolean> {
    if (typeof document === 'undefined' || !this.config) return false;

    // Crea canvas offscreen
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 320;
      this.canvas.height = 320;
      this.ctx = this.canvas.getContext('2d');
    }

    // Renderizza il primo frame prima dello stream
    this.renderCanvasFrame(this.config.remainingSeconds);

    // Connetti stream al video muto
    const canvasStream = (this.canvas as any).captureStream ? (this.canvas as any).captureStream(10) : null;
    if (!canvasStream) return false;

    this.stream = canvasStream;

    if (!this.video) {
      this.video = document.createElement('video');
      this.video.style.position = 'fixed';
      this.video.style.top = '-9999px';
      this.video.style.left = '-9999px';
      this.video.style.width = '1px';
      this.video.style.height = '1px';
      this.video.style.opacity = '0';
      this.video.setAttribute('playsinline', 'true');
      this.video.muted = true; // REQUISITO CATEGORICO: Muted per non richiedere Audio Focus!
      document.body.appendChild(this.video);
    }

    this.video.muted = true;
    this.video.srcObject = this.stream;

    await this.video.play();
    await this.video.requestPictureInPicture();

    this.video.addEventListener(
      'leavepictureinpicture',
      () => {
        if (this.mode === 'video') {
          this.closePiP();
        }
      },
      { once: true }
    );

    return true;
  }

  /**
   * Disegna sul canvas offscreen: cerchio di progresso, secondi giganti e nome esercizio.
   */
  private renderCanvasFrame(remainingSeconds: number) {
    if (!this.ctx || !this.canvas || !this.config) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const center = w / 2;
    const radius = 105;

    // Sfondo Dark
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, w, h);

    // Traccia anello di sfondo
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#262626';
    ctx.beginPath();
    ctx.arc(center, center - 15, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Anello di progresso color arancione
    const total = Math.max(1, this.config.totalSeconds);
    const fraction = Math.max(0, Math.min(1, remainingSeconds / total));
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * fraction;

    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.strokeStyle = remainingSeconds <= 3 ? '#ff3b30' : '#ff6b00';
    ctx.beginPath();
    ctx.arc(center, center - 15, radius, startAngle, endAngle);
    ctx.stroke();

    // Etichetta RECUPERO
    ctx.fillStyle = '#888888';
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RECUPERO', center, center - 55);

    // Cifre Secondi
    ctx.fillStyle = remainingSeconds <= 3 ? '#ff6b00' : '#ffffff';
    ctx.font = '900 52px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.formatTime(remainingSeconds), center, center + 4);

    // Prossimo esercizio (in basso dentro il canvas)
    ctx.fillStyle = '#888888';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PROSSIMO:', center, h - 55);

    ctx.fillStyle = '#ff6b00';
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const exerciseText = this.config.nextExerciseName || 'Prossimo Esercizio';
    const truncated = exerciseText.length > 22 ? `${exerciseText.slice(0, 20)}...` : exerciseText;
    ctx.fillText(truncated, center, h - 32);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UTILITY INTERNE
  // ──────────────────────────────────────────────────────────────────────────

  private formatTime(totalSeconds: number): string {
    const safe = Math.max(0, Math.trunc(totalSeconds));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const pipManager = new PiPManager();
