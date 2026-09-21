/**
 * platform.ts — Utility per il rilevamento dell'ambiente di esecuzione (PWA vs App Nativa iOS).
 */
import { Capacitor } from '@capacitor/core';

/**
 * Determina se l'applicazione sta girando all'interno dell'app nativa iOS (compilata con Capacitor).
 * Include il supporto a parametro query / localStorage per anteprima durante lo sviluppo (`?ios_glass=1`).
 */
export const isIosNativeApp = (): boolean => {
  if (typeof window === 'undefined') return false;

  const isNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  if (isNative) return true;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ios_glass') === '1') return true;
    if (window.localStorage.getItem('preview_ios_glass') === 'true') return true;
  } catch {
    // Fallback sicuro in caso di restrizioni sull'ambiente
  }

  return false;
};
