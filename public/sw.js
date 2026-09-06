/**
 * sw.js — Service Worker per la gestione delle notifiche in background (Pilastro 2).
 *
 * SINCRONIZZAZIONE TIMESTAMP ASSOLUTO & SCHEDULING PUNTUALE:
 * Quando l'app va in background, riceve `SCHEDULE_REST_NOTIFICATION` con il timestamp
 * assoluto di fine recupero.
 * Se la pagina torna visibile prima della scadenza, riceve `CANCEL_REST_NOTIFICATION`
 * e auto-cancella il timer e la notifica.
 */

let backgroundRestTimeout = null;
let backgroundRestResolve = null;

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
    if (backgroundRestTimeout) {
      clearTimeout(backgroundRestTimeout);
      backgroundRestTimeout = null;
    }
    if (backgroundRestResolve) {
      backgroundRestResolve();
      backgroundRestResolve = null;
    }

    const targetTime = Number(data.targetTime || data.endsAtMs) || 0;
    const delay = Math.max(0, targetTime - Date.now());

    // CRUCIALE PER IOS: event.waitUntil() dichiara a WebKit che il Service Worker
    // ha un'attività asincrona attiva e impedisce che venga terminato come idle quando si cambia app!
    const restPromise = new Promise((resolve) => {
      backgroundRestResolve = resolve;

      backgroundRestTimeout = setTimeout(async () => {
        backgroundRestTimeout = null;
        backgroundRestResolve = null;
        try {
          const title = data.title || '⏱️ Recupero Terminato!';
          const options = {
            body: data.body || 'È ora di iniziare la prossima serie!',
            icon: '/favicon.svg',
            badge: '/favicon.svg',
            tag: 'rest-timer',
            renotify: false,
            requireInteraction: false,
            silent: false,
            vibrate: [250, 100, 250],
            data: {
              url: '/',
            },
          };

          await self.registration.showNotification(title, options);
        } catch (err) {
          console.debug('Service Worker showNotification error:', err);
        } finally {
          resolve();
        }
      }, delay);
    });

    if (event.waitUntil) {
      event.waitUntil(restPromise);
    }
  } else if (data.type === 'CANCEL_REST_NOTIFICATION') {
    if (backgroundRestTimeout) {
      clearTimeout(backgroundRestTimeout);
      backgroundRestTimeout = null;
    }
    if (backgroundRestResolve) {
      backgroundRestResolve();
      backgroundRestResolve = null;
    }

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
