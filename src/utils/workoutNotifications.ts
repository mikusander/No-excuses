/**
 * workoutNotifications.ts — Pilastro 2: Gestione delle Notifiche Web e Web Push (Apple APNs).
 *
 * NOTIFICHE PUSH A LIVELLO DI SISTEMA OPERATIVO:
 * - Supporta la Web Push API (iOS 16.4+ e browser moderni) via VAPID keys.
 * - Le notifiche inviate tramite APNs risvegliano l'iPhone anche a schermo bloccato / spento.
 * - Non interferiscono né interrompono la riproduzione di musica su Spotify / Apple Music.
 * - Mantiene un fallback locale con il Service Worker per browser desktop.
 */

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BEWZ76lMUhZyU6voX38JPp08bzti_3y3aOYLs3nHExturpMD1-U0VvvGF2b72MHgw7DyAPf6HRP_jOpfyCHz4zE';

let currentActiveTimerId: string | null = null;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
    const reg = await navigator.serviceWorker.ready;
    return reg;
  } catch (error) {
    console.debug('Service Worker ready failed:', error);
    return null;
  }
};

export type NotificationPermissionStatus =
  | NotificationPermission
  | 'unsupported'
  | 'ios_pwa_required';

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

/**
 * Ottiene la sottoscrizione Web Push esistente o ne crea una nuova con le chiavi VAPID.
 */
export const getOrCreatePushSubscription = async (): Promise<PushSubscription | null> => {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return null;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
      });
    }
    return sub;
  } catch (err) {
    console.debug('[Push] Impossibile ottenere la sottoscrizione Push:', err);
    return null;
  }
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      // Pre-sottoscrivi il dispositivo al servizio Web Push APNs
      void getOrCreatePushSubscription();
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
    renotify: false,
    requireInteraction: false,
    silent: false,
    vibrate: [250, 100, 250],
  };

  try {
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

const postMessageToSW = (payload: Record<string, unknown>) => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.active) {
          reg.active.postMessage(payload);
        }
      })
      .catch(() => {});
  } catch (err) {
    console.debug('Error posting message to SW:', err);
  }
};

let lastScheduledEndsAtMs = 0;
let lastScheduledAtMs = 0;
let isSchedulingPushInProgress = false;

/**
 * Pianifica la notifica di fine recupero.
 * 1. Annulla qualsiasi notifica pendente per evitare duplicati.
 * 2. Previene chiamate multiple ravvicinate (debouncing e singleton lock).
 * 3. Invia la richiesta Web Push via APNs (Serverless) per risveglio a schermo spento su iOS.
 */
export const scheduleBackgroundRestNotification = async ({
  endsAtMs,
  nextExerciseName,
  nextSetInfo,
}: {
  endsAtMs: number;
  nextExerciseName: string;
  nextSetInfo?: string;
}) => {
  if (!isNotificationPermissionGranted()) return;

  const now = Date.now();
  // Se una notifica per lo stesso target (entro 2s) è già stata programmata negli ultimi 3s, o se una schedulazione è in corso, ignora
  if (
    isSchedulingPushInProgress ||
    (Math.abs(endsAtMs - lastScheduledEndsAtMs) < 2000 && now - lastScheduledAtMs < 3000)
  ) {
    return;
  }

  isSchedulingPushInProgress = true;
  lastScheduledEndsAtMs = endsAtMs;
  lastScheduledAtMs = now;

  try {
    // Annulla tassativamente qualsiasi notifica pendente prima di schedularne una nuova
    if (currentActiveTimerId) {
      cancelBackgroundRestNotification();
    }

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    const delaySeconds = Math.max(1, Math.round((endsAtMs - Date.now()) / 1000));
    const timerId = `rest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    currentActiveTimerId = timerId;

    // Web Push API (APNs) per risveglio dell'iPhone a schermo spento
    const sub = await getOrCreatePushSubscription();
    if (sub) {
      void fetch('/api/schedule-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          delaySeconds,
          title,
          body,
          timerId,
        }),
      }).catch((err) => {
        console.debug('[Push] Impossibile contattare /api/schedule-push:', err);
      });
    }
  } catch (err) {
    console.debug('[Push] Errore durante la pianificazione Web Push:', err);
  } finally {
    isSchedulingPushInProgress = false;
  }
};

export const cancelBackgroundRestNotification = () => {
  if (currentActiveTimerId) {
    const timerIdToCancel = currentActiveTimerId;
    currentActiveTimerId = null;

    // Annulla il push sul server se non ancora inviato
    void fetch('/api/cancel-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timerId: timerIdToCancel }),
    }).catch(() => {});
  }

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

/**
 * Funzione di test: programma una notifica Web Push tra `delaySeconds` (default 5s).
 * Utile per permettere all'utente di premere il pulsante e bloccare immediatamente
 * lo schermo dell'iPhone per verificare l'accensione e il suono.
 */
export const testPushNotification = async (delaySeconds = 5): Promise<boolean> => {
  const granted = await requestNotificationPermission();
  if (!granted) return false;

  const sub = await getOrCreatePushSubscription();
  if (!sub) {
    // Se PushManager non è disponibile (es. Safari non PWA), prova notifica locale
    setTimeout(() => {
      void sendRestFinishedNotification({
        nextExerciseName: 'Test Notifica iPhone',
        nextSetInfo: 'Funziona correttamente!',
      });
    }, delaySeconds * 1000);
    return true;
  }

  try {
    const res = await fetch('/api/schedule-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        delaySeconds,
        title: '⏱️ Test Notifica iPhone Riuscito!',
        body: 'La notifica è arrivata anche a schermo spento senza fermare Spotify!',
        timerId: `test-${Date.now()}`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.debug('[Push] Errore testPushNotification:', err);
    return false;
  }
};
