/**
 * workoutNotifications.ts — Gestione Notifiche per Sessioni di Allenamento.
 *
 * Le notifiche sono abilitate ESCLUSIVAMENTE sull'app nativa per iPhone (Capacitor / LocalNotifications).
 * Nella versione per il browser / PWA, il sistema di notifiche è completamente disattivato.
 *
 * Sincronizzazione rigorosa Timer / Allarmi OS:
 *  1. Identificativo univoco e costante: TIMER_NOTIFICATION_ID
 *  2. Cancellazione preventiva obbligatoria prima di qualsiasi nuova programmazione
 *  3. Timestamp esatto di scadenza (targetTimestamp = now + remainingSeconds), senza loop in background o offset arbitrari
 *  4. Cancellazione immediata e definitiva in caso di Pausa, Reset, Stop, Skip o Avanzamento Set
 *  5. Soppressione totale dei banner di sistema quando l'app è aperta in Foreground (gestione solo in-app)
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, NotificationType } from '@capacitor/haptics';

export const TIMER_NOTIFICATION_ID = 1001;
export const REST_NOTIFICATION_ID = TIMER_NOTIFICATION_ID;
export const TIMER_CHANNEL_ID = 'workout_timer';
export const NOTIFICATIONS_ENABLED_KEY = 'native_notifications_enabled';

// Inizializza canale ad alta priorità per allarmi timer (Android Exact Alarm)
if (typeof window !== 'undefined' && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
  LocalNotifications.createChannel({
    id: TIMER_CHANNEL_ID,
    name: 'Timer di Allenamento',
    description: 'Allarmi e notifiche esatte di fine recupero',
    importance: 5,
    visibility: 1,
    sound: 'beep.wav',
    vibration: true,
  }).catch(() => {});
}

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
    void cancelTimerNotification();
  }
};

/**
 * Rileva se l'applicazione sta girando all'interno del container nativo iOS.
 * Restituisce SEMPRE false su browser, desktop o PWA.
 */
export const isNativeApp = (): boolean => {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
};

/**
 * Rileva se l'applicazione è attualmente visibile e attiva a schermo (Foreground).
 */
export const isAppInForeground = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible';
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
 * Cancella immediatamente e in modo definitivo la notifica programmata e/o consegnata
 * associata al timer attivo. Assicura che non rimangano allarmi orfani nella coda dell'OS.
 */
export const cancelTimerNotification = async (): Promise<void> => {
  if (!isNativeApp()) return;
  lastScheduledEndsAtMs = 0;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: TIMER_NOTIFICATION_ID }] });
    await LocalNotifications.removeDeliveredNotificationsById({ ids: [TIMER_NOTIFICATION_ID] });
  } catch (err) {
    console.debug('[Capacitor] Errore cancellazione notifica timer:', err);
  }
};

/**
 * Alias retro-compatibili per le funzioni di cancellazione timer.
 */
export const cancelBackgroundRestNotification = cancelTimerNotification;
export const closeActiveRestNotifications = cancelTimerNotification;

/**
 * Pianifica la sveglia/notifica hardware di fine timer (allarme esatto dell'OS).
 * Funziona e sveglia il dispositivo a schermo bloccato, in background o con app chiusa.
 * Prima di programmare, invoca sempre la cancellazione preventiva di TIMER_NOTIFICATION_ID.
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
  if (!isNativeApp() || !areNotificationsEnabled()) return;

  const now = Date.now();
  if (endsAtMs <= now) {
    await cancelTimerNotification();
    return;
  }

  // 1. Eliminazione duplicati & Cancellazione preventiva obbligatoria
  await cancelTimerNotification();

  // Evita re-schedulazioni duplicate per lo stesso identico target
  if (isSchedulingInProgress || (lastScheduledEndsAtMs === endsAtMs && now - lastScheduledAtMs < 300)) {
    return;
  }

  isSchedulingInProgress = true;
  lastScheduledEndsAtMs = endsAtMs;
  lastScheduledAtMs = now;

  try {
    const hasPermission = await ensureNativeNotificationPermission();
    if (!hasPermission) {
      console.debug('[Capacitor] Permesso notifiche non concesso.');
      return;
    }

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    // Timestamp esatto di scadenza: targetTimestamp = now + remainingSeconds = endsAtMs
    // Delega all'allarme esatto del sistema operativo (UNTimeIntervalNotificationTrigger / UNCalendarNotificationTrigger)
    const scheduledDate = new Date(endsAtMs);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: TIMER_NOTIFICATION_ID,
          channelId: TIMER_CHANNEL_ID,
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
            nextSetInfo,
          },
        },
      ],
    });

    console.debug('[Capacitor] Allarme timer esatto programmato per le:', scheduledDate.toLocaleTimeString());
  } catch (nativeErr) {
    console.warn('[Capacitor] Errore schedulazione allarme timer nativo:', nativeErr);
  } finally {
    isSchedulingInProgress = false;
  }
};

/**
 * Invia notifica istantanea di fine recupero (usata ESCLUSIVAMENTE quando l'app non è in primo piano).
 * Se l'app è in primo piano (foreground/active), la notifica di sistema è soppressa:
 * la fine del timer è gestita esclusivamente in-app tramite audio, vibrazione e UI.
 */
export const sendRestFinishedNotification = async ({
  nextExerciseName,
  nextSetInfo,
  endsAtMs,
}: RestNotificationPayload): Promise<void> => {
  if (!isNativeApp() || !areNotificationsEnabled()) return;

  // Soppressione notifiche con App Aperta (Foreground):
  // Se l'app è visibile a schermo, la notifica di sistema NON deve comparire.
  if (isAppInForeground()) {
    void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    void cancelTimerNotification();
    return;
  }

  const now = Date.now();
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

    // Cancellazione preventiva per evitare duplicati
    await cancelTimerNotification();

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: TIMER_NOTIFICATION_ID,
          channelId: TIMER_CHANNEL_ID,
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
    console.debug('[Capacitor] Errore invio notifica fine recupero:', err);
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
 * Se la notifica arriva mentre l'app è in primo piano, la rimuove immediatamente dal centro notifiche.
 */
if (isNativeApp()) {
  LocalNotifications.addListener('localNotificationReceived', (notification) => {
    if (notification.id === TIMER_NOTIFICATION_ID) {
      lastNotificationDeliveredAtMs = Date.now();
      const extraEndsAt = (notification.extra as { endsAtMs?: number } | undefined)?.endsAtMs;
      if (extraEndsAt) {
        lastDeliveredRestTargetEndsAtMs = extraEndsAt;
      }
      if (isAppInForeground()) {
        void LocalNotifications.removeDeliveredNotificationsById({ ids: [TIMER_NOTIFICATION_ID] }).catch(() => {});
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
