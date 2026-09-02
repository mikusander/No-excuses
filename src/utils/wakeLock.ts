/**
 * wakeLock.ts — Gestione dello Screen Wake Lock API.
 *
 * Mantiene lo schermo del dispositivo acceso durante l'esecuzione del workout,
 * evitando che il telefono vada in standby automatico mentre l'utente si allena.
 */

let wakeLockSentinel: WakeLockSentinel | null = null;
let isRequested = false;

const handleVisibilityChange = async () => {
  if (isRequested && document.visibilityState === 'visible' && !wakeLockSentinel) {
    await acquireWakeLock();
  }
};

const acquireWakeLock = async () => {
  if (typeof window === 'undefined' || !('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch (error) {
    // Può fallire per policy di risparmio energetico o batteria quasi scarica
    console.debug('Wake lock request could not be granted:', error);
  }
};

export const requestScreenWakeLock = async () => {
  isRequested = true;
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  await acquireWakeLock();
};

export const releaseScreenWakeLock = async () => {
  isRequested = false;
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // ignore
    }
    wakeLockSentinel = null;
  }
};
