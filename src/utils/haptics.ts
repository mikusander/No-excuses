/**
 * haptics.ts — Gestore unificato per il feedback aptico (vibrazioni tattili).
 *
 * Fornisce micro-vibrazioni native stile iOS tramite @capacitor/haptics su iPhone,
 * con fallback trasparente a navigator.vibrate su browser o Android supportati.
 * Nessuna chiamata genera eccezioni in caso di piattaforma non supportata.
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/** Verifica sicura se siamo in ambiente browser */
const isBrowser = typeof window !== 'undefined';

/**
 * Tocco leggero (Light)
 * Ideale per: cambio tab nella bottom bar, selezione chip/pill, switch opzione rapida.
 */
export const hapticLight = async (): Promise<void> => {
  if (!isBrowser) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    try {
      if ('vibrate' in navigator) navigator.vibrate(10);
    } catch {
      // Ignora silenziosamente
    }
  }
};

/**
 * Tocco medio (Medium)
 * Ideale per: pressione pulsanti primari, stepper +1 / -1, salvataggio rapido.
 */
export const hapticMedium = async (): Promise<void> => {
  if (!isBrowser) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    try {
      if ('vibrate' in navigator) navigator.vibrate(20);
    } catch {
      // Ignora silenziosamente
    }
  }
};

/**
 * Tocco pesante (Heavy)
 * Ideale per: azioni ad alto impatto come eliminazione elemento, reset timer o logout.
 */
export const hapticHeavy = async (): Promise<void> => {
  if (!isBrowser) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Heavy });
  } catch {
    try {
      if ('vibrate' in navigator) navigator.vibrate(40);
    } catch {
      // Ignora silenziosamente
    }
  }
};

/**
 * Notifica di successo (Success)
 * Ideale per: workout completato, timer recupero terminato, salvataggio riuscito.
 */
export const hapticSuccess = async (): Promise<void> => {
  if (!isBrowser) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    try {
      if ('vibrate' in navigator) navigator.vibrate([30, 60, 30]);
    } catch {
      // Ignora silenziosamente
    }
  }
};

/**
 * Notifica di avviso (Warning)
 * Ideale per: ultimi 3 secondi prima della fine del recupero, conferma azione.
 */
export const hapticWarning = async (): Promise<void> => {
  if (!isBrowser) return;
  try {
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    try {
      if ('vibrate' in navigator) navigator.vibrate([20, 40, 20]);
    } catch {
      // Ignora silenziosamente
    }
  }
};

/**
 * Scatto morbido di selezione (Selection change)
 * Ideale per: scrolling picker numerici, stepper veloci o slider.
 */
export const hapticSelection = async (): Promise<void> => {
  if (!isBrowser) return;
  try {
    await Haptics.selectionChanged();
  } catch {
    try {
      if ('vibrate' in navigator) navigator.vibrate(8);
    } catch {
      // Ignora silenziosamente
    }
  }
};
