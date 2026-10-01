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
export const NOTIFICATIONS_ENABLED_KEY = 'native_notifications_enabled';

/**
 * Controlla se le notifiche per l'app nativa iPhone sono abilitate dall'utente (default: true).
 */
export const areNotificationsEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const saved = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  return saved === null ? true : saved === 'true';
};

/**
 * Imposta se le notifiche sono abilitate dall'utente.
 */
export const setNotificationsEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(enabled));
  if (!enabled) {
    cancelBackgroundRestNotification();
  }
};

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
let lastNotificationDeliveredAtMs = 0;
let lastDeliveredRestTargetEndsAtMs = 0;
let isSchedulingInProgress = false;

/**
 * Verifica lo stato corrente dei permessi a livello iOS senza mostrare prompt all'utente.
 */
export const checkNativeNotificationPermissionStatus = async (): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> => {
  if (!isNativeApp()) return 'unsupported';
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') {
      cachedNativePermission = 'granted';
      return 'granted';
    }
    if (status.display === 'denied') {
      cachedNativePermission = 'denied';
      return 'denied';
    }
    return 'prompt';
  } catch {
    return 'unsupported';
  }
};

/**
 * Richiede attivamente i permessi di notifica su iOS (usato dal toggle delle impostazioni).
 */
export const requestNativeNotificationPermission = async (): Promise<boolean> => {
  if (!isNativeApp()) return false;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') {
      cachedNativePermission = 'granted';
      return true;
    }
    const req = await LocalNotifications.requestPermissions();
    const granted = req.display === 'granted';
    cachedNativePermission = granted ? 'granted' : 'denied';
    return granted;
  } catch {
    return false;
  }
};

/**
 * Verifica e richiede in modo nativo e silenzioso i permessi di notifica su iOS.
 * Su iOS mostra il classico popup di sistema "Consenti notifiche" una sola volta.
 */
export const ensureNativeNotificationPermission = async (): Promise<boolean> => {
  if (!isNativeApp() || !areNotificationsEnabled()) return false;
  if (cachedNativePermission === 'granted') return true;

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
  endsAtMs?: number | null;
}

/**
 * Invia la notifica di completamento recupero in modo istantaneo
 * (usato allo scattare esatto di 00:00 sia in primo piano che allo sblocco).
 */
export const sendRestFinishedNotification = async ({
  nextExerciseName,
  nextSetInfo,
  endsAtMs,
}: RestNotificationPayload): Promise<void> => {
  if (!isNativeApp() || !areNotificationsEnabled()) return;

  // Feedback aptico immediato
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {});

  const now = Date.now();
  // Evita doppi allarmi sonori se la notifica programmata in background è già scattata (entro 1500ms)
  if (
    endsAtMs &&
    lastDeliveredRestTargetEndsAtMs === endsAtMs &&
    now - lastNotificationDeliveredAtMs < 1500
  ) {
    return;
  }

  lastDeliveredRestTargetEndsAtMs = endsAtMs || now;
  lastNotificationDeliveredAtMs = now;

  try {
    const hasPermission = await ensureNativeNotificationPermission();
    if (!hasPermission) return;

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    // Consegna immediata (senza oggetto 'schedule' iOS UNUserNotificationCenter consegna all'istante a latenza zero)
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIFICATION_ID,
          title,
          body,
          sound: typeof window !== 'undefined' && localStorage.getItem('voice_assistance_enabled') === 'false' ? undefined : 'beep.wav',
          extra: {
            endsAtMs: endsAtMs || now,
            nextExerciseName,
            deliveredAt: now,
          },
        },
      ],
    });
  } catch (err) {
    console.debug('[Capacitor] Errore invio notifica immediata fine recupero:', err);
  }
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
  // Esclusivamente per app nativa iPhone e se abilitato nelle impostazioni
  if (!isNativeApp() || !areNotificationsEnabled()) return;

  const now = Date.now();
  // Se il target è già scaduto o troppo vicino, non schedulare via background
  if (endsAtMs <= now + 500) return;

  // Evita schedulazioni duplicate identiche per lo stesso intervallo
  if (
    isSchedulingInProgress ||
    (lastScheduledEndsAtMs === endsAtMs && now - lastScheduledAtMs < 1500)
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

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    // Compensazione della latenza del kernel iOS (UNUserNotificationCenter timer coalescing):
    // Su iOS a schermo bloccato / in background le notifiche locali possono subire un ritardo di 1-2 secondi.
    // Anticipando di 1000ms la sveglia nativa programmata, il suono e il banner arrivano esattamente allo scadere di 00:00.
    const triggerMs = Math.max(Date.now() + 400, endsAtMs - 1000);
    const scheduledDate = new Date(triggerMs);

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
          sound: typeof window !== 'undefined' && localStorage.getItem('voice_assistance_enabled') === 'false' ? undefined : 'beep.wav',
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
 * Listener per tracciare la consegna effettiva della notifica di recupero da parte del sistema iOS.
 */
if (isNativeApp()) {
  LocalNotifications.addListener('localNotificationReceived', (notification) => {
    if (notification.id === REST_NOTIFICATION_ID) {
      lastNotificationDeliveredAtMs = Date.now();
      const extraEndsAt = (notification.extra as { endsAtMs?: number } | undefined)?.endsAtMs;
      if (extraEndsAt) {
        lastDeliveredRestTargetEndsAtMs = extraEndsAt;
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
