/**
 * workoutNotifications.ts — Gestione delle Notifiche Web e Service Worker.
 */

let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

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

export const getNotificationPermission = (): NotificationPermission | 'unsupported' => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
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
  // Vibrazione aptica se supportata dal dispositivo
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([200, 100, 200, 100, 350]);
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
    tag: 'rest-timer-finished',
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200, 100, 350],
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

    // Fallback standard Notification
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
