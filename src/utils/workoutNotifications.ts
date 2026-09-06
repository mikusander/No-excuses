/**
 * workoutNotifications.ts — Pilastro 2: Gestione delle Notifiche Web e Service Worker.
 *
 * SINCRONIZZAZIONE TIMESTAMP ASSOLUTO & SCHEDULING PUNTUALE:
 * - Richiesta permessi PWA.
 * - Invio messaggio al Service Worker per pianificare la notifica quando la pagina è in background.
 * - Auto-cancellazione delle notifiche con tag 'rest-timer' al ritorno in primo piano.
 *
 * FIX CRITICI:
 * - Messaggio inviato UNA SOLA VOLTA al SW (prima via controller, poi ready come fallback)
 *   per evitare notifiche doppie.
 * - Registrazione SW delegata a vite-plugin-pwa (registerSW in main.tsx),
 *   nessuna registrazione manuale duplicata.
 */

export const isIosDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

export const isStandalonePwa = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
};

/**
 * Inizializza il riferimento al Service Worker.
 * Non registra più manualmente (lo fa vite-plugin-pwa in main.tsx),
 * ma aspetta che il SW sia pronto.
 */
export const initServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg;
  } catch (error) {
    console.debug('Service Worker ready failed:', error);
    return null;
  }
};

export type NotificationPermissionStatus = NotificationPermission | 'unsupported' | 'ios_pwa_required';

export const getNotificationPermission = (): NotificationPermissionStatus => {
  if (typeof window === 'undefined') return 'unsupported';

  if (isIosDevice() && !isStandalonePwa()) {
    return 'ios_pwa_required';
  }

  if (!('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
};

export const isNotificationPermissionGranted = (): boolean => {
  return getNotificationPermission() === 'granted';
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (error) {
    console.debug('Error requesting notification permission:', error);
    return false;
  }
};

export interface RestNotificationPayload {
  nextExerciseName: string;
  nextSetInfo?: string;
}

export const sendRestFinishedNotification = async ({
  nextExerciseName,
  nextSetInfo,
}: RestNotificationPayload) => {
  // Vibrazione aptica immediata se supportata
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([250, 100, 250]);
    } catch {
      // ignore
    }
  }

  if (!isNotificationPermissionGranted()) return;

  const title = '⏱️ Recupero Terminato!';
  const body = nextSetInfo
    ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
    : `È ora di iniziare: ${nextExerciseName}`;

  const options: NotificationOptions & Record<string, any> = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'rest-timer',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [250, 100, 250],
  };

  try {
    // Preferisce showNotification tramite il SW (necessario per notifiche su iOS PWA)
    if ('serviceWorker' in navigator) {
      const readyReg = await navigator.serviceWorker.ready;
      if (readyReg && 'showNotification' in readyReg) {
        await readyReg.showNotification(title, options);
        return;
      }
    }

    // Fallback: notifica dal contesto della pagina
    if ('Notification' in window) {
      const n = new Notification(title, options);
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  } catch (err) {
    console.debug('Error dispatching notification:', err);
  }
};

/**
 * Invia un messaggio al Service Worker per schedulare la notifica.
 * CRITICO: Invia il messaggio UNA SOLA VOLTA per evitare notifiche doppie.
 * Priorità: controller → ready.active come fallback.
 */
const postMessageToSW = (payload: Record<string, unknown>) => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    // Tentativo 1: via controller (il SW che controlla la pagina)
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
      return; // STOP: messaggio inviato con successo
    }

    // Tentativo 2: via registration.active come fallback
    navigator.serviceWorker.ready.then((reg) => {
      if (reg.active) {
        reg.active.postMessage(payload);
      }
    }).catch(() => {});
  } catch (err) {
    console.debug('Error posting message to SW:', err);
  }
};

export const scheduleBackgroundRestNotification = ({
  endsAtMs,
  nextExerciseName,
  nextSetInfo,
}: {
  endsAtMs: number;
  nextExerciseName: string;
  nextSetInfo?: string;
}) => {
  if (!isNotificationPermissionGranted()) return;

  const title = '⏱️ Recupero Terminato!';
  const body = nextSetInfo
    ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
    : `È ora di iniziare: ${nextExerciseName}`;

  postMessageToSW({
    type: 'SCHEDULE_REST_NOTIFICATION',
    endsAtMs,
    targetTime: endsAtMs,
    title,
    body,
  });
};

export const cancelBackgroundRestNotification = () => {
  postMessageToSW({ type: 'CANCEL_REST_NOTIFICATION' });
};

export const closeActiveRestNotifications = async () => {
  cancelBackgroundRestNotification();
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg && 'getNotifications' in reg) {
      const notifications = await reg.getNotifications({ tag: 'rest-timer' });
      notifications.forEach((n) => n.close());
    }
  } catch {
    // ignore
  }
};
