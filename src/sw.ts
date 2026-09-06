/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// ─────────────────────────────────────────────────────────────────────────────
// PRECACHING: vite-plugin-pwa inietta qui la lista degli asset da precacheare
// ─────────────────────────────────────────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ─────────────────────────────────────────────────────────────────────────────
// GESTIONE NOTIFICHE REST TIMER IN BACKGROUND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stato interno per la gestione del timer di notifica.
 * Usiamo un approccio a "heartbeat" per timer lunghi:
 * iOS WebKit termina aggressivamente i SW dopo ~30s di inattività,
 * quindi ri-scheduliamo con setTimeout brevi (max 20s) fino alla scadenza.
 */
let restTargetTime: number | null = null;
let restTimeout: ReturnType<typeof setTimeout> | null = null;
let restWaitUntilResolve: (() => void) | null = null;
let restNotificationTitle = '⏱️ Recupero Terminato!';
let restNotificationBody = 'È ora di iniziare la prossima serie!';

const MAX_TIMEOUT_MS = 20_000; // Max 20s per singolo setTimeout (sicuro per iOS)

/**
 * Cancella qualsiasi timer attivo e risolve la promise di waitUntil.
 */
function clearRestTimer() {
  if (restTimeout !== null) {
    clearTimeout(restTimeout);
    restTimeout = null;
  }
  restTargetTime = null;
  if (restWaitUntilResolve) {
    restWaitUntilResolve();
    restWaitUntilResolve = null;
  }
}

/**
 * Mostra la notifica di fine recupero.
 */
async function showRestNotification() {
  try {
    await self.registration.showNotification(restNotificationTitle, {
      body: restNotificationBody,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'rest-timer',
      renotify: false, // CRUCIALE: false per evitare notifiche doppie
      requireInteraction: false,
      silent: false,
      vibrate: [250, 100, 250],
      data: { url: '/' },
    } as NotificationOptions & Record<string, unknown>);
  } catch (err) {
    console.debug('[SW] showNotification error:', err);
  }
}

/**
 * Tick del heartbeat: controlla se è ora di mostrare la notifica.
 * Se manca più di MAX_TIMEOUT_MS, ri-schedula un altro tick.
 * Se manca meno, schedula il tick finale.
 */
function heartbeatTick() {
  if (restTargetTime === null) return;

  const remaining = restTargetTime - Date.now();

  if (remaining <= 0) {
    // Tempo scaduto: mostra notifica
    showRestNotification().finally(() => {
      restTargetTime = null;
      restTimeout = null;
      if (restWaitUntilResolve) {
        restWaitUntilResolve();
        restWaitUntilResolve = null;
      }
    });
    return;
  }

  // Schedula il prossimo tick (max MAX_TIMEOUT_MS per evitare che iOS uccida il SW)
  const nextDelay = Math.min(remaining, MAX_TIMEOUT_MS);
  restTimeout = setTimeout(heartbeatTick, nextDelay);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SCHEDULE_REST_NOTIFICATION') {
    // Cancella qualsiasi timer precedente
    clearRestTimer();

    const targetTime = Number(data.targetTime || data.endsAtMs) || 0;
    if (targetTime <= Date.now()) return; // Già scaduto

    restTargetTime = targetTime;
    restNotificationTitle = data.title || '⏱️ Recupero Terminato!';
    restNotificationBody = data.body || 'È ora di iniziare la prossima serie!';

    // CRUCIALE PER iOS: event.waitUntil() dichiara a WebKit che il SW
    // ha un'attività asincrona attiva e impedisce che venga terminato
    const restPromise = new Promise<void>((resolve) => {
      restWaitUntilResolve = resolve;
      heartbeatTick();
    });

    if (event.waitUntil) {
      event.waitUntil(restPromise);
    }
  } else if (data.type === 'CANCEL_REST_NOTIFICATION') {
    clearRestTimer();

    // Auto-cancella eventuali notifiche rimaste con il tag rest-timer
    const cancelPromise = self.registration
      .getNotifications({ tag: 'rest-timer' })
      .then((notifications) => {
        notifications.forEach((n) => n.close());
      })
      .catch(() => {});

    if (event.waitUntil) {
      event.waitUntil(cancelPromise);
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se c'è già una finestra aperta, portala in primo piano
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Altrimenti apri la pagina del workout
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
