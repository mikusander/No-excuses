/**
 * sw.js — Service Worker per la gestione delle notifiche in background e lockscreen.
 */

let backgroundRestTimeout = null;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SCHEDULE_REST_NOTIFICATION') {
    if (backgroundRestTimeout) {
      clearTimeout(backgroundRestTimeout);
      backgroundRestTimeout = null;
    }

    const endsAtMs = Number(data.endsAtMs) || 0;
    const delay = Math.max(0, endsAtMs - Date.now());

    backgroundRestTimeout = setTimeout(async () => {
      backgroundRestTimeout = null;
      try {
        const title = data.title || '⏱️ Recupero Terminato!';
        const options = {
          body: data.body || 'È ora di iniziare la prossima serie!',
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: 'rest-timer-finished',
          renotify: true,
          requireInteraction: false,
          silent: false,
          vibrate: [200, 100, 200, 100, 350],
          data: {
            url: '/',
          },
        };

        await self.registration.showNotification(title, options);
      } catch (err) {
        console.debug('Service Worker showNotification error:', err);
      }
    }, delay);
  } else if (data.type === 'CANCEL_REST_NOTIFICATION') {
    if (backgroundRestTimeout) {
      clearTimeout(backgroundRestTimeout);
      backgroundRestTimeout = null;
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
