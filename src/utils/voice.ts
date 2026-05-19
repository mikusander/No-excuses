// Keep a reference to prevent garbage collection
export let lastUtterance: SpeechSynthesisUtterance | null = null;
let voices: SpeechSynthesisVoice[] = [];

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // Load voices
  voices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    voices = window.speechSynthesis.getVoices();
  };
}

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
    
    // Refresh voices list if empty
    if (voices.length === 0) voices = window.speechSynthesis.getVoices();
    
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    
    utterance.lang = 'en-US';
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    
    lastUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }
};

export const speakNumber = (num: number) => {
  speak(num.toString());
};
