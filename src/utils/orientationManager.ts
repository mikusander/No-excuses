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
  lockLandscape(): Promise<{ mode: string }>;
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
 * Forza l'orientamento orizzontale (Landscape).
 */
export const lockAppToLandscape = async (): Promise<void> => {
  // 1. App Nativa iOS
  if (Capacitor.isNativePlatform()) {
    try {
      await NativeOrientationPlugin.lockLandscape();
    } catch {
      // Fallback silenzioso
    }
  }

  // 2. Web Screen Orientation API
  if (typeof window !== 'undefined' && 'screen' in window && window.screen.orientation) {
    try {
      const orientation = window.screen.orientation as any;
      if (typeof orientation.lock === 'function') {
        await orientation.lock('landscape').catch(() => {});
      }
    } catch {
      // Ignora
    }
  }
};

/**
 * Hook per rilevare se il viewport corrente è in modalità orizzontale (landscape).
 */
export const useIsLandscape = (): boolean => {
  const checkIsLandscape = () => {
    if (typeof window === 'undefined') return false;
    // Verifica sia matchMedia che il rapporto d'aspetto larghezza > altezza
    const mediaLandscape = window.matchMedia ? window.matchMedia('(orientation: landscape)').matches : false;
    return mediaLandscape || window.innerWidth > window.innerHeight;
  };

  const [isLandscape, setIsLandscape] = useState<boolean>(checkIsLandscape);

  useEffect(() => {
    const handleOrientationChange = () => {
      setIsLandscape(checkIsLandscape());
    };

    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);

    let mql: MediaQueryList | null = null;
    if (window.matchMedia) {
      mql = window.matchMedia('(orientation: landscape)');
      if (mql.addEventListener) {
        mql.addEventListener('change', handleOrientationChange);
      }
    }

    // Esegui un check immediato
    handleOrientationChange();

    return () => {
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
      if (mql && mql.removeEventListener) {
        mql.removeEventListener('change', handleOrientationChange);
      }
    };
  }, []);

  return isLandscape;
};
