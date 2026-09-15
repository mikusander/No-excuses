/**
 * workoutNotifications.ts — Gestione Notifiche.
 *
 * Le notifiche sono abilitate ESCLUSIVAMENTE sull'app nativa per iPhone (Capacitor / LocalNotifications).
 * Nella versione per il browser, il sistema di notifiche è completamente disattivato.
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, NotificationType } from '@capacitor/haptics';

export const isNativeApp = (): boolean => {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
};

let cachedNativePermission: NotificationPermissionStatus | null = null;
let lastScheduledEndsAtMs = 0;
let lastScheduledAtMs = 0;
let isSchedulingPushInProgress = false;

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
  if (typeof window === 'undefined' || !isNativeApp()) return 'unsupported';
  return cachedNativePermission || 'granted';
};

export const isNotificationPermissionGranted = (): boolean => {
  return isNativeApp() && getNotificationPermission() === 'granted';
};

export const getOrCreatePushSubscription = async (): Promise<PushSubscription | null> => {
  return null;
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !isNativeApp()) return false;

  try {
    const result = await LocalNotifications.requestPermissions();
    const granted = result.display === 'granted';
    cachedNativePermission = granted ? 'granted' : 'denied';
    return granted;
  } catch (err) {
    console.debug('[Capacitor] Errore richiesta permessi notifiche locali:', err);
    return false;
  }
};

export interface RestNotificationPayload {
  nextExerciseName: string;
  nextSetInfo?: string;
}

export const sendRestFinishedNotification = async ({
  nextExerciseName: _nextExerciseName,
  nextSetInfo: _nextSetInfo,
}: RestNotificationPayload) => {
  if (!isNativeApp()) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
};

/**
 * Pianifica la notifica di fine recupero (solo app nativa iOS).
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
  if (!isNativeApp() || !isNotificationPermissionGranted()) return;

  const now = Date.now();
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
    cancelBackgroundRestNotification();

    const title = '⏱️ Recupero Terminato!';
    const body = nextSetInfo
      ? `Prossimo: ${nextExerciseName} (${nextSetInfo})`
      : `È ora di iniziare: ${nextExerciseName}`;

    const timerId = `rest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await LocalNotifications.cancel({ notifications: [{ id: 1001 }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 1001,
          title,
          body,
          schedule: { at: new Date(endsAtMs) },
          sound: 'beep.wav',
          extra: {
            timerId,
            endsAtMs,
          },
        },
      ],
    });
  } catch (nativeErr) {
    console.error('[Capacitor] Errore schedulazione notifica locale nativa:', nativeErr);
  } finally {
    isSchedulingPushInProgress = false;
  }
};

export const cancelBackgroundRestNotification = () => {
  if (!isNativeApp()) return;
  void LocalNotifications.cancel({ notifications: [{ id: 1001 }] }).catch(() => {});
};

export const closeActiveRestNotifications = async () => {
  if (!isNativeApp()) return;
  cancelBackgroundRestNotification();
};

export interface PushTestResult {
  success: boolean;
  message: string;
}

/**
 * Funzione di test per le notifiche (solo app nativa iOS).
 */
export const testPushNotification = async (delaySeconds = 5): Promise<PushTestResult> => {
  if (!isNativeApp()) {
    return {
      success: false,
      message: 'Le notifiche sono disponibili esclusivamente sull\'app nativa per iPhone.',
    };
  }

  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      return {
        success: false,
        message: '⚠️ Permesso notifiche non concesso nelle impostazioni del tuo iPhone.',
      };
    }
    await LocalNotifications.cancel({ notifications: [{ id: 9999 }] });
    const testEndsAt = new Date(Date.now() + delaySeconds * 1000);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 9999,
          title: '⏱️ Test Notifica Nativa Riuscito!',
          body: 'La sveglia hardware iOS funziona a schermo bloccato e 100% offline!',
          schedule: { at: testEndsAt },
          sound: 'beep.wav',
        },
      ],
    });
    return {
      success: true,
      message: `🔒 Sveglia nativa iOS programmata tra ${delaySeconds}s! Puoi bloccare lo schermo o uscire dall'app: suonerà all'istante senza internet o server.`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `⚠️ Errore notifica locale: ${err.message || 'Errore nativo'}`,
    };
  }
};
