import { useState, useRef, useCallback, useEffect } from 'react';

// Dichiarazione tipi per SpeechRecognition W3C / WebKit
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

export interface UseWorkoutDictationReturn {
  isListening: boolean;
  isSupported: boolean;
  interimTranscript: string;
  finalTranscript: string;
  fullTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

export function useWorkoutDictation(): UseWorkoutDictationReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const shouldKeepListeningRef = useRef(false);

  const isSupported = typeof window !== 'undefined' && Boolean(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );

  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecClass) return;

    const recognition = new SpeechRecClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'it-IT';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let currentInterim = '';
      let currentFinal = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const transcriptPart = item[0]?.transcript || '';

        if (item.isFinal) {
          currentFinal += transcriptPart + ' ';
        } else {
          currentInterim += transcriptPart;
        }
      }

      if (currentFinal) {
        setFinalTranscript((prev) => (prev ? `${prev} ${currentFinal.trim()}` : currentFinal.trim()));
      }
      setInterimTranscript(currentInterim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') {
        // Nessun audio rilevato durante la pausa: comportamento normale, non è un errore bloccante
        return;
      }
      if (event.error === 'not-allowed') {
        setError('Accesso al microfono negato. Verifica i permessi nelle impostazioni del browser.');
        setIsListening(false);
        shouldKeepListeningRef.current = false;
        return;
      }
      if (event.error === 'audio-capture') {
        setError('Nessun microfono rilevato sul dispositivo.');
        setIsListening(false);
        shouldKeepListeningRef.current = false;
        return;
      }
      console.warn('SpeechRecognition warning:', event.error);
    };

    recognition.onend = () => {
      // Se l'utente non ha premuto esplicitamente stop, riavvia per consentire pause naturali
      if (shouldKeepListeningRef.current) {
        try {
          recognition.start();
        } catch {
          // Ignora se già in avvio
        }
      } else {
        setIsListening(false);
        setInterimTranscript('');
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldKeepListeningRef.current = false;
      try {
        recognition.abort();
      } catch {
        // Safe cleanup
      }
      recognitionRef.current = null;
    };
  }, [isSupported]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError('La dettatura vocale non è supportata da questo browser. Usa Chrome, Edge o Safari.');
      return;
    }

    setError(null);
    shouldKeepListeningRef.current = true;
    setIsListening(true);

    try {
      recognitionRef.current?.start();
    } catch {
      // Potrebbe essere già avviato
    }
  }, [isSupported]);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');

    try {
      recognitionRef.current?.stop();
    } catch {
      // Safe stop
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  const fullTranscript = (
    finalTranscript + (interimTranscript ? ` ${interimTranscript}` : '')
  ).trim();

  return {
    isListening,
    isSupported,
    interimTranscript,
    finalTranscript,
    fullTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}
