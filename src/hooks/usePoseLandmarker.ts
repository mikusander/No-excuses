import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export const usePoseLandmarker = (enabled = true) => {
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);

    const initPoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
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

  return { detectPose, isLoading };
};
