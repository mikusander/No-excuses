/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// ─────────────────────────────────────────────────────────────────────────────
// PRECACHING: vite-plugin-pwa inietta qui la lista degli asset da precacheare
// ─────────────────────────────────────────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ─────────────────────────────────────────────────────────────────────────────
// RATE-LIMITER E GESTIONE PUSH SENZA BLOCCHI STORAGE
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GESTIONE TIMER LOCALE SERVICE WORKER (Fallback 100% Offline & App-Switching)
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

// ─────────────────────────────────────────────────────────────────────────────
// GESTIONE PUSH NOTIFICATIONS (Apple APNs per iOS 16.4+ a schermo spento)
// ─────────────────────────────────────────────────────────────────────────────

let lastPushShownAt = 0;

self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; timerId?: string; endsAtMs?: number } = {
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

  // Deduplicazione rapida in-memory senza attendere IndexedDB (che su iOS blocca in background)
  const now = Date.now();
  if (now - lastPushShownAt < 2500) {
    console.debug('[SW] Notifica push duplicata soppressa dal rate-limiter.');
    return;
  }
  lastPushShownAt = now;

  const title = payload.title || '⏱️ Recupero Terminato!';
  const options: NotificationOptions & Record<string, unknown> = {
    body: payload.body || 'È ora di iniziare la prossima serie!',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'rest-timer',
    renotify: true, // FORZA la sveglia dello schermo, il banner e la vibrazione anche se la notifica precedente è ancora nel centro notifiche
    requireInteraction: true,
    silent: false,
    vibrate: [350, 150, 350, 150, 500],
    data: { url: '/' },
  };

  // Su iOS WebKit, event.waitUntil con showNotification immediato è vitale
  event.waitUntil(self.registration.showNotification(title, options as any));
});

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

    const title = data.title || '⏱️ Recupero Terminato!';
    const body = data.body || 'È ora di iniziare la prossima serie!';

    const restPromise = new Promise<void>((resolve) => {
      localRestResolve = resolve;

      localRestTimeout = setTimeout(async () => {
        localRestTimeout = null;
        localRestResolve = null;
        try {
          const now = Date.now();
          if (now - lastPushShownAt >= 2500) {
            lastPushShownAt = now;
            await self.registration.showNotification(title, {
              body,
              icon: '/pwa-192x192.png',
              badge: '/pwa-192x192.png',
              tag: 'rest-timer',
              renotify: true,
              requireInteraction: true,
              silent: false,
              vibrate: [350, 150, 350, 150, 500],
              data: { url: '/' },
            } as any);
          }
        } catch (err) {
          console.debug('[SW] Local rest timer notification error:', err);
        } finally {
          resolve();
        }
      }, delay);
    });

    // Passa a event.waitUntil solo se il delay è breve (< 25s), per evitare che iOS/Chrome
    // terminino forzatamente il Service Worker per promesse lunghe in sospeso.
    if (event.waitUntil && delay < 25000) {
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
