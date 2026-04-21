// src/hooks/useVoiceCommands.ts
import { useEffect, useRef } from 'react';

interface VoiceCommandsProps {
  onStart?: () => void;
  onStop?: () => void;
  onPause: () => void;
  onResume: () => void;
  enabled: boolean;
}

export const useVoiceCommands = ({ onStart, onStop, onPause, onResume, enabled }: VoiceCommandsProps) => {
  const recognitionRef = useRef<any>(null);
  const isActiveRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);
  const onPauseRef = useRef(onPause);
  const onResumeRef = useRef(onResume);

  // Keep refs updated to avoid re-triggering useEffect
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onResumeRef.current = onResume; }, [onResume]);

  useEffect(() => {
    if (!enabled) {
      isActiveRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
      }
      return;
    }

    isActiveRef.current = true;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'it-IT';
      recognition.continuous = true;
      recognition.interimResults = false;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        const last = event.results.length - 1;
        const command = event.results[last][0].transcript.toLowerCase().trim();
        console.log('Voice Command:', command);
        if (command.includes('vai') || command.includes('go')) {
          onStartRef.current?.();
        } else if (command.includes('stop') || command.includes('fermo')) {
          onStopRef.current?.();
        } else if (command.includes('pausa')) {
          onPauseRef.current();
        } else if (command.includes('riprendi') || command.includes('continua')) {
          onResumeRef.current();
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.warn('Speech recognition error', event.error);
      };

      recognition.onend = () => {
        // ONLY restart if still enabled, NOT unmounted
        if (enabledRef.current && isActiveRef.current) {
          setTimeout(() => {
            if (enabledRef.current && isActiveRef.current) {
              try {
                recognition.start();
              } catch {
                // Ignore errors if it's already started
              }
            }
          }, 2000); // 2 second delay to avoid resource spam
        }
      };

      recognitionRef.current = recognition;
    }

    try {
      recognitionRef.current.start();
    } catch (e) {
      // recognition already started or other non-fatal error
    }

    return () => {
      isActiveRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // already stopped
        }
      }
    };
  }, [enabled]); // Only depend on enabled
};
