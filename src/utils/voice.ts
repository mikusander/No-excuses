/**
 * voice.ts — Utility per il feedback vocale tramite Web Speech API (TTS).
 *
 * Gestisce la sintesi vocale in-browser per annunciare i conteggi delle ripetizioni
 * e i messaggi di stato durante il workout.
 *
 * Problemi noti risolti:
 *  - iOS Safari e Chrome mobile richiedono che speechSynthesis venga "sbloccato" con
 *    una chiamata iniziale all'interno di un evento utente (click/tap). Senza di essa,
 *    le chiamate successive da requestAnimationFrame o timer falliscono silenziosamente.
 *  - Chrome desktop può entrare in uno stato "paused" dopo inattività; serve un resume().
 *  - Chiamare cancel() su un synth inattivo può corrompere lo stato su Chrome mobile;
 *    quindi si cancella solo se c'è qualcosa in riproduzione o in coda.
 *
 * Funzioni esportate:
 *  - `warmupSpeechSynthesis` : da chiamare al primo click dell'utente per sbloccare il synth
 *  - `speak`                 : riproduce un testo (rispetta il flag di preferenza utente)
 *  - `speakNumber`           : shorthand per annunciare un numero intero
 */

/**
 * Riferimento all'ultima utterance creata.
 * Necessario per evitare che il garbage collector rilasci l'oggetto prima
 * che il browser abbia finito di riprodurlo (bug noto su alcuni browser).
 */
export let lastUtterance: SpeechSynthesisUtterance | null = null;

/**
 * `warmupSpeechSynthesis` — Sblocca l'API di sintesi vocale su mobile.
 *
 * Deve essere chiamato da un contesto di gesto utente (click/tap) per
 * sbloccare speechSynthesis su iOS Safari e Chrome mobile.
 * Senza questa chiamata iniziale, speak() può fallire silenziosamente
 * quando invocata da requestAnimationFrame o altri contesti non-gesture.
 */
import { isVoiceGuidanceEnabled } from './audioSettings';

export const warmupSpeechSynthesis = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (!isVoiceGuidanceEnabled()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    // Riproduce un'utterance quasi silenziosa solo per sbloccare il contesto audio
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0.01;
    utterance.lang = 'it-IT';
    synth.speak(utterance);
  } catch {
    // ignore errors
  }
};

/**
 * `speak` — Riproduce un testo tramite la sintesi vocale del browser.
 *
 * Prima di parlare controlla che la modalità audio attiva sia 'full'
 * (isVoiceGuidanceEnabled). Nelle modalità 'disabled' o 'minimal' è una no-op.
 *
 * @param text - Il testo da riprodurre vocalmente
 */
export const speak = (text: string) => {
  if (!isVoiceGuidanceEnabled()) return;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synth = window.speechSynthesis;

    // Workaround for Chrome/Safari speechSynthesis inactivity state issue
    if (synth.paused) {
      synth.resume();
    }

    // Solo cancel se c'è qualcosa in riproduzione o in coda.
    if (synth.speaking || synth.pending) {
      try {
        synth.cancel();
      } catch {
        // ignore errors
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    utterance.lang = 'it-IT';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    
    // Mantiene un riferimento per evitare garbage collection prematura
    lastUtterance = utterance;
    synth.speak(utterance);
  }
};

/**
 * `speakNumber` — Annuncia vocalmente un numero intero.
 * Shorthand per `speak(num.toString())` — usato tipicamente per il conteggio reps.
 *
 * @param num - Il numero da annunciare
 */
export const speakNumber = (num: number) => {
  speak(num.toString());
};
