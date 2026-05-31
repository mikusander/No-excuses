// Keep a reference to prevent garbage collection
export let lastUtterance: SpeechSynthesisUtterance | null = null;


export const speak = (text: string) => {
  const isVoiceAssistantEnabled = localStorage.getItem('voice_assistance_enabled') !== 'false';
  if (!isVoiceAssistantEnabled) return;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore errors
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    
    lastUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }
};

export const speakNumber = (num: number) => {
  speak(num.toString());
};
