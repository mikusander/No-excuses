/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// ─────────────────────────────────────────────────────────────────────────────
// PRECACHING: vite-plugin-pwa inietta qui la lista degli asset da precacheare
// ─────────────────────────────────────────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICAZIONE ATOMICA PERSISTENTE SU DISCO (IndexedDB per iOS WebKit)
// Risolve il problema delle istanze isolate del Service Worker su iOS che
// causavano la ricezione di 3 notifiche duplicate contemporaneamente.
// ─────────────────────────────────────────────────────────────────────────────

async function acquireNotificationSlot(minIntervalMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(true);
        return;
      }

      const request = indexedDB.open('no_excuses_pwa_push', 1);

      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore('meta');
        } catch {
          // ignore
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('meta', 'readwrite');
          const store = tx.objectStore('meta');
          const getReq = store.get('last_push_delivered_at');

          getReq.onsuccess = () => {
            const lastDelivered = Number(getReq.result) || 0;
            const now = Date.now();

            if (now - lastDelivered < minIntervalMs) {
              // Notifica duplicata arrivata contemporaneamente: sopprimi!
              resolve(false);
            } else {
              store.put(now, 'last_push_delivered_at');
              resolve(true);
            }
          };

          getReq.onerror = () => resolve(true);
        } catch {
          resolve(true);
        }
      };

      request.onerror = () => resolve(true);
    } catch {
      resolve(true);
    }
  });
}

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

  const pushProcessPromise = (async () => {
    // 1. Controllo deduplicazione atomica: blocca raffiche di notifiche push identiche
    const canShow = await acquireNotificationSlot(5000);
    if (!canShow) {
      console.debug('[SW] Notifica push duplicata soppressa con successo.');
      return;
    }

    // 2. Chiudi preventivamente qualsiasi notifica precedente con lo stesso tag
    try {
      const existing = await self.registration.getNotifications({ tag: 'rest-timer' });
      for (const notif of existing) {
        notif.close();
      }
    } catch {
      // ignore
    }

    // 3. Mostra l'unica notifica garantita
    await self.registration.showNotification(title, options as any);
  })();

  // Su iOS WebKit, event.waitUntil() è OBBLIGATORIO per i push event
  event.waitUntil(pushProcessPromise);
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

  if (data.type === 'CANCEL_REST_NOTIFICATION') {
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
