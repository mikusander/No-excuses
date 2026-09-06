/**
 * workoutNotifications.ts — Pilastro 2: Gestione delle Notifiche Web e Service Worker.
 *
 * SINCRONIZZAZIONE TIMESTAMP ASSOLUTO & SCHEDULING PUNTUALE:
 * - Richiesta permessi PWA.
 * - Invio messaggio al Service Worker per pianificare la notifica solo quando la pagina è in background.
 * - Auto-cancellazione delle notifiche con tag 'rest-timer' al ritorno in primo piano.
 */

let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

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

export const initServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    serviceWorkerRegistration = reg;
    return reg;
  } catch (error) {
    console.debug('Service Worker registration skipped or failed:', error);
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
    if (permission === 'granted') {
      await initServiceWorker();
      return true;
    }
    return false;
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
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: 'rest-timer',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [250, 100, 250],
  };

  try {
    if (serviceWorkerRegistration && 'showNotification' in serviceWorkerRegistration) {
      await serviceWorkerRegistration.showNotification(title, options);
      return;
    }

    if ('serviceWorker' in navigator) {
      const readyReg = await navigator.serviceWorker.ready;
      if (readyReg && 'showNotification' in readyReg) {
        await readyReg.showNotification(title, options);
        return;
      }
    }

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

export const scheduleBackgroundRestNotification = ({
  endsAtMs,
  nextExerciseName,
  nextSetInfo,
}: {
  endsAtMs: number;
  nextExerciseName: string;
  nextSetInfo?: string;
}) => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!isNotificationPermissionGranted()) return;

  const title = '⏱️ Recupero Terminato!';
  const body = nextSetInfo
    ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
    : `È ora di iniziare: ${nextExerciseName}`;

  try {
    const swController = navigator.serviceWorker.controller;
    if (swController) {
      swController.postMessage({
        type: 'SCHEDULE_REST_NOTIFICATION',
        endsAtMs,
        targetTime: endsAtMs,
        title,
        body,
      });
      return;
    }

    navigator.serviceWorker.ready.then((reg) => {
      if (reg.active) {
        reg.active.postMessage({
          type: 'SCHEDULE_REST_NOTIFICATION',
          endsAtMs,
          targetTime: endsAtMs,
          title,
          body,
        });
      }
    }).catch(() => {});
  } catch (err) {
    console.debug('Error scheduling background notification:', err);
  }
};

export const cancelBackgroundRestNotification = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const swController = navigator.serviceWorker.controller;
    if (swController) {
      swController.postMessage({
        type: 'CANCEL_REST_NOTIFICATION',
      });
      return;
    }

    navigator.serviceWorker.ready.then((reg) => {
      if (reg.active) {
        reg.active.postMessage({
          type: 'CANCEL_REST_NOTIFICATION',
        });
      }
    }).catch(() => {});
  } catch (err) {
    console.debug('Error canceling background notification:', err);
  }
};

export const closeActiveRestNotifications = async () => {
  cancelBackgroundRestNotification();
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = serviceWorkerRegistration || (await navigator.serviceWorker.ready);
    if (reg && 'getNotifications' in reg) {
      const notifications = await reg.getNotifications({ tag: 'rest-timer' });
      notifications.forEach((n) => n.close());
    }
  } catch {
    // ignore
  }
};
