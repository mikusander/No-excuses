/**
 * workoutNotifications.ts — Gestione Notifiche per Sessioni di Allenamento.
 *
 * Le notifiche sono abilitate ESCLUSIVAMENTE sull'app nativa per iPhone (Capacitor / LocalNotifications).
 * Nella versione per il browser / PWA, il sistema di notifiche è completamente disattivato.
 *
 * Funzionalità:
 *  - Richiesta permessi nativa al primo avvio di un recupero o apertura workout (zero pulsanti o scritte invasive nell'interfaccia)
 *  - Schedulazione allarme nativo iOS tramite UNUserNotificationCenter alla scadenza esatta del recupero
 *  - Suono sveglia 'beep.wav' / default che suona a schermo bloccato, in background o con app chiusa
 *  - Cancellazione automatica della notifica se l'utente salta, mette in pausa o completa il recupero dentro l'app
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, NotificationType } from '@capacitor/haptics';

export const REST_NOTIFICATION_ID = 1001;

/**
 * Rileva se l'applicazione sta girando all'interno del container nativo iOS.
 * Restituisce SEMPRE false su browser, desktop o PWA.
 */
export const isNativeApp = (): boolean => {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
};

let cachedNativePermission: 'granted' | 'denied' | 'prompt' | null = null;
let lastScheduledEndsAtMs = 0;
let lastScheduledAtMs = 0;
let isSchedulingInProgress = false;

/**
 * Verifica e richiede in modo nativo e silenzioso i permessi di notifica su iOS.
 * Su iOS mostra il classico popup di sistema "Consenti notifiche" una sola volta.
 */
export const ensureNativeNotificationPermission = async (): Promise<boolean> => {
  if (!isNativeApp()) return false;

  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') {
      cachedNativePermission = 'granted';
      return true;
    }

    if (status.display === 'prompt' || status.display === 'prompt-with-rationale') {
      const req = await LocalNotifications.requestPermissions();
      const granted = req.display === 'granted';
      cachedNativePermission = granted ? 'granted' : 'denied';
      return granted;
    }

    cachedNativePermission = 'denied';
    return false;
  } catch (err) {
    console.debug('[Capacitor] Errore verifica permessi notifiche:', err);
    return false;
  }
};

export const isNotificationPermissionGranted = (): boolean => {
  return isNativeApp() && cachedNativePermission === 'granted';
};

export interface RestNotificationPayload {
  nextExerciseName: string;
  nextSetInfo?: string;
}

/**
 * Feedback aptico al termine del recupero (eseguito in foreground).
 */
export const sendRestFinishedNotification = async ({
  nextExerciseName: _nextExerciseName,
  nextSetInfo: _nextSetInfo,
}: RestNotificationPayload): Promise<void> => {
  if (!isNativeApp()) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
};

/**
 * Pianifica la sveglia/notifica di fine recupero hardware (solo ed esclusivamente app nativa iOS).
 * Suona e compare su schermo bloccato, Dynamic Island o altre app quando il recupero finisce.
 */
export const scheduleBackgroundRestNotification = async ({
  endsAtMs,
  nextExerciseName,
  nextSetInfo,
}: {
  endsAtMs: number;
  nextExerciseName: string;
  nextSetInfo?: string;
}): Promise<void> => {
  // Esclusivamente per app nativa iPhone
  if (!isNativeApp()) return;

  const now = Date.now();
  // Se il target è già scaduto o troppo vicino, non schedulare
  if (endsAtMs <= now + 1000) return;

  // Evita schedulazioni duplicate ravvicinate per lo stesso intervallo
  if (
    isSchedulingInProgress ||
    (Math.abs(endsAtMs - lastScheduledEndsAtMs) < 2000 && now - lastScheduledAtMs < 3000)
  ) {
    return;
  }

  isSchedulingInProgress = true;
  lastScheduledEndsAtMs = endsAtMs;
  lastScheduledAtMs = now;

  try {
    const hasPermission = await ensureNativeNotificationPermission();
    if (!hasPermission) {
      console.debug('[Capacitor] Permesso notifiche non concesso dall\'utente.');
      return;
    }

    // Cancella eventuale notifica precedente attiva
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] }).catch(() => {});

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    const scheduledDate = new Date(endsAtMs);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIFICATION_ID,
          title,
          body,
          schedule: {
            at: scheduledDate,
            allowWhileIdle: true,
          },
          sound: 'beep.wav',
          extra: {
            endsAtMs,
            nextExerciseName,
          },
        },
      ],
    });

    console.debug('[Capacitor] Sveglia di recupero schedulata per le:', scheduledDate.toLocaleTimeString());
  } catch (nativeErr) {
    console.warn('[Capacitor] Errore schedulazione notifica locale nativa:', nativeErr);
  } finally {
    isSchedulingInProgress = false;
  }
};

/**
 * Cancella la notifica programmata quando il recupero viene interrotto, saltato o completato in foreground.
 */
export const cancelBackgroundRestNotification = (): void => {
  if (!isNativeApp()) return;
  lastScheduledEndsAtMs = 0;
  void LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] }).catch(() => {});
};

/**
 * Pulisce sia la notifica pendente sia le notifiche già consegnate nel notification center.
 */
export const closeActiveRestNotifications = async (): Promise<void> => {
  if (!isNativeApp()) return;
  lastScheduledEndsAtMs = 0;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
    await LocalNotifications.removeDeliveredNotificationsById({ ids: [REST_NOTIFICATION_ID] });
  } catch {
    // ignore
  }
};

/**
 * Registra un listener per quando l'utente tocca la notifica di recupero dalla schermata di blocco / banner.
 */
export const addNotificationActionListener = (
  onAction: (notificationId: number) => void
): (() => void) => {
  if (!isNativeApp()) return () => {};

  let handle: { remove: () => void } | null = null;
  LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    onAction(action.notification.id);
  }).then((h) => {
    handle = h;
  }).catch(() => {});

  return () => {
    handle?.remove();
  };
};

/**
 * Se l'app è in primo piano, rimuove immediatamente qualsiasi notifica consegnata
 * così da evitare che compaia il banner di sistema mentre l'utente è nell'app.
 */
if (isNativeApp()) {
  LocalNotifications.addListener('localNotificationReceived', async (notification) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      try {
        await LocalNotifications.removeDeliveredNotificationsById({ ids: [notification.id] });
      } catch {
        // ignore
      }
    }
  }).catch(() => {});
}

/**
 * Stub compatibilità per service worker PWA (nessuna operazione).
 */
export const initServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  return null;
};
