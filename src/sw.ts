/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// ─────────────────────────────────────────────────────────────────────────────
// PRECACHING: vite-plugin-pwa inietta qui la lista degli asset da precacheare
// ─────────────────────────────────────────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ─────────────────────────────────────────────────────────────────────────────
// GESTIONE PUSH NOTIFICATIONS (Apple APNs per iOS 16.4+ a schermo spento)
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string } = {
    title: '⏱️ Recupero Terminato!',
    body: 'È ora di iniziare la prossima serie!',
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }

  const title = payload.title || '⏱️ Recupero Terminato!';
  const options: NotificationOptions & Record<string, unknown> = {
    body: payload.body || 'È ora di iniziare la prossima serie!',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'rest-timer',
    renotify: false,
    requireInteraction: false,
    silent: false,
    vibrate: [250, 100, 250],
    data: { url: '/' },
  };

  // Su iOS WebKit, event.waitUntil(showNotification) è OBBLIGATORIO per i push event
  event.waitUntil(self.registration.showNotification(title, options as any));
});

// ─────────────────────────────────────────────────────────────────────────────
// GESTIONE TIMER LOCALE (Fallback per browser desktop o sessione attiva)
// ─────────────────────────────────────────────────────────────────────────────

let localRestTimeout: ReturnType<typeof setTimeout> | null = null;
let localRestResolve: (() => void) | null = null;

function clearLocalRestTimer() {
  if (localRestTimeout !== null) {
    clearTimeout(localRestTimeout);
    localRestTimeout = null;
  }
  if (localRestResolve) {
    localRestResolve();
    localRestResolve = null;
  }
}

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
    clearLocalRestTimer();

    const targetTime = Number(data.targetTime || data.endsAtMs) || 0;
    const delay = Math.max(0, targetTime - Date.now());
    if (delay <= 0) return;

    const title = data.title || '⏱️ Recupero Terminato!';
    const body = data.body || 'È ora di iniziare la prossima serie!';

    const restPromise = new Promise<void>((resolve) => {
      localRestResolve = resolve;

      localRestTimeout = setTimeout(async () => {
        localRestTimeout = null;
        localRestResolve = null;
        try {
          await self.registration.showNotification(title, {
            body,
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: 'rest-timer',
            renotify: false,
            silent: false,
            vibrate: [250, 100, 250],
            data: { url: '/' },
          } as any);
        } catch (err) {
          console.debug('[SW] showNotification error:', err);
        } finally {
          resolve();
        }
      }, delay);
    });

    if (event.waitUntil) {
      event.waitUntil(restPromise);
    }
  } else if (data.type === 'CANCEL_REST_NOTIFICATION') {
    clearLocalRestTimer();

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
