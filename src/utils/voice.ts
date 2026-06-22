// Keep a reference to prevent garbage collection
export let lastUtterance: SpeechSynthesisUtterance | null = null;


export const speak = (text: string) => {
  const isVoiceAssistantEnabled = localStorage.getItem('voice_assistance_enabled') !== 'false';
  if (!isVoiceAssistantEnabled) return;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synth = window.speechSynthesis;
    const isBusy = synth.speaking || synth.pending;

    // Workaround per bug Chrome/Safari mobile: chiamare cancel() su un
    // speechSynthesis inattivo può metterlo in uno stato rotto, causando
    // il drop silenzioso della successiva speak(). Cancelliamo solo se
    // c'è effettivamente qualcosa in riproduzione o in coda.
    if (isBusy) {
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

    if (isBusy) {
      // Se abbiamo appena cancellato, diamo al browser il tempo di
      // processare il cancel prima di accodare la nuova utterance.
      setTimeout(() => synth.speak(utterance), 10);
    } else {
      synth.speak(utterance);
    }
  }
};

export const speakNumber = (num: number) => {
  speak(num.toString());
};
