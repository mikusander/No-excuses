import { useState, useRef, useCallback, useEffect } from 'react';
import { createWorker } from 'tesseract.js';

export type OcrStatus = 'idle' | 'preprocessing' | 'recognizing' | 'done' | 'error';

export interface UseLocalOcrReturn {
  status: OcrStatus;
  progress: number;
  statusText: string;
  error: string | null;
  recognizedText: string;
  recognizeImage: (file: File) => Promise<string>;
  resetOcr: () => void;
}

/**
 * Pre-elaborazione su Canvas off-screen per ottimizzare la precisione dell'OCR:
 * 1. Scala proporzionalmente se l'immagine è troppo grande (max 1800px per performance/RAM).
 * 2. Converte in scala di grigi ad alta precisione.
 * 3. Applica un aumento di contrasto/binarizzazione per evidenziare il testo rispetto allo sfondo.
 */
async function preprocessImageCanvas(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const MAX_DIMENSION = 1800;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        // Fallback: restituisci URL originale se canvas 2d non disponibile
        resolve(objectUrl);
        return;
      }

      // Disegna immagine ridimensionata
      ctx.drawImage(img, 0, 0, width, height);

      try {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const len = data.length;

        // Calcola luminosità media per soglia dinamica
        let totalBrightness = 0;
        for (let i = 0; i < len; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          totalBrightness += 0.299 * r + 0.587 * g + 0.114 * b;
        }
        const avgBrightness = totalBrightness / (len / 4);

        // Scala di grigi e contrast enhancement (soglia adattiva semplificata)
        const threshold = Math.max(100, Math.min(160, avgBrightness));

        for (let i = 0; i < len; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // Stretch di contrasto attorno alla soglia
          const binary = gray > threshold ? 255 : Math.max(0, gray * 0.5);
          data[i] = binary;
          data[i + 1] = binary;
          data[i + 2] = binary;
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Canvas filter bypass (es. CORS o memoria):', err);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Impossibile caricare l'immagine selezionata."));
    };

    img.src = objectUrl;
  });
}

export function useLocalOcr(): UseLocalOcrReturn {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState('');

  const workerRef = useRef<Awaited<ReturnType<typeof createWorker>> | null>(null);

  // Termina il worker all'unmount per liberare la memoria WebAssembly
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        void workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const resetOcr = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setStatusText('');
    setError(null);
    setRecognizedText('');
  }, []);

  const recognizeImage = useCallback(async (file: File): Promise<string> => {
    setError(null);
    setRecognizedText('');
    setStatus('preprocessing');
    setProgress(10);
    setStatusText('Ottimizzazione contrasto e nitidezza immagine...');

    try {
      // 1. Preprocessing su Canvas off-screen
      const preprocessedDataUrl = await preprocessImageCanvas(file);

      setStatus('recognizing');
      setProgress(25);
      setStatusText('Inizializzazione motore OCR Wasm...');

      // 2. Inizializza worker Tesseract (lingua italiana e inglese)
      if (!workerRef.current) {
        const worker = await createWorker(['ita', 'eng'], 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              const currentProgress = Math.round(25 + m.progress * 70);
              setProgress(Math.min(95, currentProgress));
              setStatusText(`Riconoscimento testo... ${Math.round(m.progress * 100)}%`);
            } else if (m.status === 'loading tesseract core') {
              setStatusText('Caricamento WebAssembly OCR...');
            } else if (m.status === 'loading language traineddata') {
              setStatusText('Caricamento modello lingua...');
            }
          },
        });
        workerRef.current = worker;
      }

      setStatusText('Analisi caratteri e tabelle in corso...');
      const result = await workerRef.current.recognize(preprocessedDataUrl);
      const text = result.data.text || '';

      setProgress(100);
      setStatus('done');
      setStatusText('Scansione completata con successo!');
      setRecognizedText(text);

      return text;
    } catch (err: unknown) {
      console.error('Errore durante elaborazione OCR locale:', err);
      const msg = err instanceof Error ? err.message : 'Errore durante la scansione OCR.';
      setError(msg);
      setStatus('error');
      setStatusText('Errore durante la scansione.');
      throw err;
    }
  }, []);

  return {
    status,
    progress,
    statusText,
    error,
    recognizedText,
    recognizeImage,
    resetOcr,
  };
}
