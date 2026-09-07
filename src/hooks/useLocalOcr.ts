import { useState, useRef, useCallback, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import {
  preprocessTableImage,
  reconstructTableLayout,
  type WordBoundingBox,
} from '../utils/ocrTablePreprocessor.ts';

export type OcrStatus = 'idle' | 'preprocessing' | 'recognizing' | 'done' | 'error';

export interface UseLocalOcrReturn {
  status: OcrStatus;
  progress: number;
  statusText: string;
  error: string | null;
  recognizedText: string;
  reconstructedLines: string[];
  recognizeImage: (file: File) => Promise<string>;
  resetOcr: () => void;
}

export function useLocalOcr(): UseLocalOcrReturn {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState('');
  const [reconstructedLines, setReconstructedLines] = useState<string[]>([]);

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
    setReconstructedLines([]);
  }, []);

  const recognizeImage = useCallback(async (file: File): Promise<string> => {
    setError(null);
    setRecognizedText('');
    setReconstructedLines([]);
    setStatus('preprocessing');
    setProgress(10);
    setStatusText('Pre-processing Canvas: binarizzazione Otsu e contrasto griglie...');

    try {
      // 1. Preprocessing su Canvas off-screen con binarizzazione Otsu
      const preprocessedDataUrl = await preprocessTableImage(file);

      setStatus('recognizing');
      setProgress(25);
      setStatusText('Inizializzazione motore OCR Wasm...');

      // 2. Inizializza worker Tesseract (lingua italiana e inglese)
      if (!workerRef.current) {
        const worker = await createWorker(['ita', 'eng'], 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              const currentProgress = Math.round(25 + m.progress * 65);
              setProgress(Math.min(90, currentProgress));
              setStatusText(`Riconoscimento caratteri e coordinate... ${Math.round(m.progress * 100)}%`);
            } else if (m.status === 'loading tesseract core') {
              setStatusText('Caricamento WebAssembly OCR...');
            } else if (m.status === 'loading language traineddata') {
              setStatusText('Caricamento modello lingua...');
            }
          },
        });

        // Configurazione ottimale per blocchi di testo tabellare
        await worker.setParameters({
          tessedit_pageseg_mode: '11' as any, // Tesseract.PSM.SPARSE_TEXT
          preserve_interword_spaces: '1',
        });

        workerRef.current = worker;
      }

      setStatusText('Analisi geometrica e Bounding Boxes delle celle...');
      setProgress(92);

      const result = await workerRef.current.recognize(
        preprocessedDataUrl,
        {},
        { blocks: true }
      );

      // 3. Estrazione di tutti i token parola con le rispettive coordinate geometriche (Bounding Box)
      const extractedWords: WordBoundingBox[] = [];
      if (result.data.blocks) {
        for (const block of result.data.blocks) {
          for (const paragraph of block.paragraphs) {
            for (const line of paragraph.lines) {
              for (const word of line.words) {
                if (word && word.text && word.text.trim().length > 0 && word.bbox) {
                  extractedWords.push({
                    text: word.text.trim(),
                    bbox: {
                      x0: word.bbox.x0,
                      y0: word.bbox.y0,
                      x1: word.bbox.x1,
                      y1: word.bbox.y1,
                    },
                    confidence: word.confidence,
                  });
                }
              }
            }
          }
        }
      }

      // 4. Ricostruzione del layout tabellare (Clustering verticale Y + Ordinamento X + Gap colonne)
      let finalText = '';
      let finalLines: string[] = [];

      if (extractedWords.length > 0) {
        finalLines = reconstructTableLayout(extractedWords);
        finalText = finalLines.join('\n');
      }

      // Fallback sul testo grezzo lineare se la ricostruzione geometrica non ha prodotto righe
      if (!finalText.trim()) {
        finalText = result.data.text || '';
        finalLines = finalText
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l.length > 0);
      }

      setProgress(100);
      setStatus('done');
      setStatusText('Layout tabellare ricostruito con successo!');
      setRecognizedText(finalText);
      setReconstructedLines(finalLines);

      return finalText;
    } catch (err: unknown) {
      console.error('Errore durante elaborazione OCR locale tabellare:', err);
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
    reconstructedLines,
    recognizeImage,
    resetOcr,
  };
}
