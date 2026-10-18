/**
 * orientationManager.ts — Gestione orientamento schermo (Portrait / Landscape).
 *
 * Requisito: L'applicazione si orienta in orizzontale (landscape) ESCLUSIVAMENTE durante
 * un workout attivo (/active-workout). In tutte le altre pagine resta bloccata in verticale (portrait).
 *
 * Supporta:
 *  1. App nativa iOS (Capacitor) tramite plugin nativo AppOrientationPlugin in AppDelegate.swift
 *  2. PWA / Web standard tramite screen.orientation.lock / unlock
 *  3. Hook reattivo `useIsLandscape()` per rilevare lo stato di rotazione in tempo reale
 */
import { useState, useEffect } from 'react';
import { registerPlugin, Capacitor } from '@capacitor/core';

interface AppOrientationPluginInterface {
  lockPortrait(): Promise<{ mode: string }>;
  unlockForWorkout(): Promise<{ mode: string }>;
}

const NativeOrientationPlugin = registerPlugin<AppOrientationPluginInterface>('AppOrientationPlugin');

/**
 * Blocca l'applicazione in modalità verticale (Portrait).
 * Chiamato all'avvio dell'app, al cambio rotta fuori dal workout e all'uscita dal workout.
 */
export const lockAppToPortrait = async (): Promise<void> => {
  // 1. App Nativa iOS
  if (Capacitor.isNativePlatform()) {
    try {
      await NativeOrientationPlugin.lockPortrait();
    } catch {
      // Fallback silenzioso se non disponibile
    }
  }

  // 2. Web Screen Orientation API (PWA / Android Chrome)
  if (typeof window !== 'undefined' && 'screen' in window && window.screen.orientation) {
    try {
      const orientation = window.screen.orientation as any;
      if (typeof orientation.lock === 'function') {
        await orientation.lock('portrait').catch(() => {});
      }
    } catch {
      // Ignora restrizioni di sicurezza del browser
    }
  }
};

/**
 * Sblocca la rotazione dello schermo consentendo l'orientamento orizzontale durante il workout.
 */
export const unlockAppForWorkout = async (): Promise<void> => {
  // 1. App Nativa iOS
  if (Capacitor.isNativePlatform()) {
    try {
      await NativeOrientationPlugin.unlockForWorkout();
    } catch {
      // Fallback silenzioso
    }
  }

  // 2. Web Screen Orientation API
  if (typeof window !== 'undefined' && 'screen' in window && window.screen.orientation) {
    try {
      const orientation = window.screen.orientation as any;
      if (typeof orientation.unlock === 'function') {
        orientation.unlock();
      }
    } catch {
      // Ignora
    }
  }
};

/**
 * Hook per rilevare se il viewport / dispositivo corrente è in modalità orizzontale (landscape).
 * Rileva esclusivamente la rotazione fisica del dispositivo (sensori / giroscopio / orientation change).
 */
export const useIsLandscape = (): boolean => {
  const checkIsLandscape = (): boolean => {
    if (typeof window === 'undefined') return false;

    // 1. Screen Orientation API standard (Android Chrome / Safari 16.4+ / WebView)
    if (typeof window.screen !== 'undefined' && window.screen.orientation) {
      const type = window.screen.orientation.type;
      if (typeof type === 'string') {
        if (type.startsWith('landscape')) return true;
        if (type.startsWith('portrait')) return false;
      }
    }

    // 2. Legacy window.orientation (WebKit / iOS Safari)
    if (typeof window.orientation !== 'undefined') {
      const angle = Math.abs(Number(window.orientation));
      if (angle === 90) return true;
      if (angle === 0 || angle === 180) return false;
    }

    // 3. Media query orientation
    const mediaLandscape = window.matchMedia ? window.matchMedia('(orientation: landscape)').matches : false;
    if (mediaLandscape) return true;

    // 4. Rapporto d'aspetto dimensioni viewport (larghezza > altezza)
    return window.innerWidth > window.innerHeight;
  };

  const [isLandscape, setIsLandscape] = useState<boolean>(checkIsLandscape);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleOrientationChange = () => {
      setIsLandscape(checkIsLandscape());
      // Re-check a 60ms per sincronizzare la conclusione dell'animazione di rotazione nativa iOS
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsLandscape(checkIsLandscape());
      }, 60);
    };

    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);

    // Screen Orientation API event listener
    const screenOrientation = typeof window !== 'undefined' && 'screen' in window ? window.screen.orientation : null;
    if (screenOrientation && typeof screenOrientation.addEventListener === 'function') {
      screenOrientation.addEventListener('change', handleOrientationChange);
    }

    let mql: MediaQueryList | null = null;
    if (window.matchMedia) {
      mql = window.matchMedia('(orientation: landscape)');
      if (mql.addEventListener) {
        mql.addEventListener('change', handleOrientationChange);
      }
    }

    // Check immediato all'aggancio
    handleOrientationChange();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
      if (screenOrientation && typeof screenOrientation.removeEventListener === 'function') {
        screenOrientation.removeEventListener('change', handleOrientationChange);
      }
      if (mql && mql.removeEventListener) {
        mql.removeEventListener('change', handleOrientationChange);
      }
    };
  }, []);

  return isLandscape;
};
