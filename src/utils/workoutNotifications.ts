/**
 * workoutNotifications.ts — Gestione delle Notifiche Web e Service Worker.
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
    // Su iOS le notifiche push sono consentite da Apple solo se l'app è installata su Schermata Home (PWA)
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
