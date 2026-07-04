// Keep a reference to prevent garbage collection
export let lastUtterance: SpeechSynthesisUtterance | null = null;

/**
 * Deve essere chiamato da un contesto di gesto utente (click/tap) per
 * sbloccare speechSynthesis su iOS Safari e Chrome mobile.
 * Senza questa chiamata iniziale, speak() può fallire silenziosamente
 * quando invocata da requestAnimationFrame o altri contesti non-gesture.
 */
export const warmupSpeechSynthesis = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0.01;
    utterance.lang = 'en-US';
    synth.speak(utterance);
  } catch {
    // ignore errors
  }
};

export const speak = (text: string) => {
  const isVoiceAssistantEnabled = localStorage.getItem('voice_assistance_enabled') !== 'false';
  if (!isVoiceAssistantEnabled) return;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synth = window.speechSynthesis;

    // Workaround for Chrome/Safari speechSynthesis inactivity state issue
    if (synth.paused) {
      synth.resume();
    }

    // Solo cancel se c'è qualcosa in riproduzione o in coda.
    // Chiamare cancel() su un synth inattivo può rompere lo stato su Chrome mobile.
    if (synth.speaking || synth.pending) {
      try {
        synth.cancel();
      } catch {
        // ignore errors
      }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    
    lastUtterance = utterance;
    synth.speak(utterance);
  }
};

export const speakNumber = (num: number) => {
  speak(num.toString());
};
