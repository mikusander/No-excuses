import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MEDIAPIPE_VERSION = '0.10.34';

export const usePoseLandmarker = (enabled = true) => {
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
      setIsLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    const initPoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
        );
        
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });
        
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

    return () => {
      isCancelled = true;
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
    };
  }, [enabled]);

  const detectPose = (video: HTMLVideoElement, timestamp: number) => {
    if (!poseLandmarkerRef.current) return null;
    return poseLandmarkerRef.current.detectForVideo(video, timestamp);
  };

  return { detectPose, isLoading, error };
};
