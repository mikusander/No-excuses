/**
 * usePoseLandmarker.ts — Hook React per la gestione del lifecycle di MediaPipe PoseLandmarker.
 *
 * Inizializza e gestisce il modello di rilevamento pose di MediaPipe Tasks Vision.
 * Il modello viene caricato da CDN (jsdelivr + Google Storage) e gira in modalità VIDEO
 * per il rilevamento frame-by-frame in tempo reale.
 *
 * Architettura:
 *  - Il PoseLandmarker è mantenuto in un `ref` (non in state) per evitare re-render inutili.
 *  - L'inizializzazione è asincrona; durante il caricamento `isLoading` è true.
 *  - Se il componente viene smontato prima del completamento, `isCancelled` previene
 *    l'aggiornamento dello state su un componente non più montato (memory leak / warning).
 *  - Al cleanup dell'effect (o quando `enabled` diventa false), il modello viene chiuso
 *    con `.close()` per liberare le risorse GPU/WASM.
 *
 * Opzioni del modello:
 *  - runningMode: "VIDEO" — ottimizzato per stream video continui (tracking inter-frame)
 *  - numPoses: 1           — traccia un solo soggetto alla volta
 *  - delegate: "GPU"       — usa WebGL per l'inferenza (fallback CPU automatico se non disponibile)
 *
 * @param enabled - Se false, il modello viene distrutto e l'hook è inattivo (default: true)
 * @returns detectPose - funzione stabile (useCallback) per rilevare la pose su un frame video
 * @returns isLoading  - true durante il caricamento del modello
 * @returns error      - messaggio di errore se l'inizializzazione fallisce
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/** Versione del pacchetto MediaPipe WASM da caricare dal CDN */
const MEDIAPIPE_VERSION = '0.10.34';

export const usePoseLandmarker = (enabled = true) => {
  // Ref invece di state: aggiornare il modello non deve causare re-render
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Se il tracking è disabilitato, distruggi il modello esistente e resetta
    if (!enabled) {
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
      setIsLoading(false);
      setError(null);
      return;
    }

    // Flag per gestire il caso in cui l'effect si cleanup prima che il modello sia pronto
    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    const initPoseLandmarker = async () => {
      try {
        // 1. Carica i file WASM di MediaPipe Tasks Vision dal CDN
        const vision = await FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
        );
        
        // 2. Crea il PoseLandmarker con il modello "lite" (bilanciamento accuratezza/performance)
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
            delegate: "GPU" // Preferisce GPU (WebGL); fallback automatico a CPU
          },
          runningMode: "VIDEO", // Ottimizzato per tracking continuo tra frame
          numPoses: 1           // Un solo soggetto
        });
        
        // Se il componente si è smontato durante il caricamento, chiudi il modello
        if (isCancelled) {
          poseLandmarker.close();
          return;
        }

        poseLandmarkerRef.current = poseLandmarker;
        setIsLoading(false);
      } catch (error) {
        console.error("Failed to initialize Pose Landmarker:", error);
        if (!isCancelled) {
          setError('Impossibile inizializzare MediaPipe. Riprova o verifica la connessione.');
          setIsLoading(false);
        }
      }
    };

    initPoseLandmarker();

    // Cleanup: annulla l'inizializzazione in corso e chiudi il modello se già pronto
    return () => {
      isCancelled = true;
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
    };
  }, [enabled]);

  /**
   * `detectPose` — Esegue la rilevazione pose su un singolo frame video.
   *
   * Usa `useCallback` con array di dipendenze vuoto: la reference è stabile tra i render
   * perché legge il modello tramite ref (non state), il che la rende sicura da passare
   * come prop o usare come dipendenza in altri effect senza causare loop.
   *
   * @param video     - Elemento <video> del feed della fotocamera
   * @param timestamp - Timestamp del frame in millisecondi (richiesto da MediaPipe VIDEO mode)
   * @returns PoseLandmarkerResult con i landmark rilevati, o null se il modello non è pronto
   */
  const detectPose = useCallback((video: HTMLVideoElement, timestamp: number) => {
    if (!poseLandmarkerRef.current) return null;
    return poseLandmarkerRef.current.detectForVideo(video, timestamp);
  }, []); // stable reference - poseLandmarkerRef is a ref, not state

  return { detectPose, isLoading, error };
};
