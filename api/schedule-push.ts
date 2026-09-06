import webpush from 'web-push';

export const config = {
  maxDuration: 300, // Fino a 300 secondi (5 minuti) consentiti su Vercel Hobby
};

const vapidPublicKey =
  process.env.VITE_VAPID_PUBLIC_KEY ||
  'BEWZ76lMUhZyU6voX38JPp08bzti_3y3aOYLs3nHExturpMD1-U0VvvGF2b72MHgw7DyAPf6HRP_jOpfyCHz4zE';

const vapidPrivateKey =
  process.env.VAPID_PRIVATE_KEY ||
  'XxaWAWT1e4-GcDCdlBJov5xtSTRO3NaNe2bn0tVaeco';

webpush.setVapidDetails(
  'mailto:support@no-excuses.app',
  vapidPublicKey,
  vapidPrivateKey
);

export const cancelledTimers = new Set<string>();

export default async function handler(req: any, res: any) {
  // Configura CORS per consentire chiamate sia da locale che da dominio di produzione
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = req.body || {};
  const { subscription, delaySeconds = 0, title, body: notificationBody, timerId } = body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Missing subscription endpoint' });
  }

  const waitMs = Math.max(0, Math.round(Number(delaySeconds) * 1000));

  if (timerId) {
    cancelledTimers.delete(timerId);
  }

  // Attende la durata del timer prima di inviare la notifica
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // Se l'utente ha cancellato il timer durante l'attesa, non inviare
  if (timerId && cancelledTimers.has(timerId)) {
    cancelledTimers.delete(timerId);
    return res.status(200).json({ cancelled: true });
  }

  try {
    const payload = JSON.stringify({
      title: title || '⏱️ Recupero Terminato!',
      body: notificationBody || 'È ora di iniziare la prossima serie!',
      tag: 'rest-timer',
      url: '/',
    });

    await webpush.sendNotification(subscription, payload, {
      headers: {
        'apns-collapse-id': 'rest-timer',
      },
      TTL: 60,
    });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('[WebPush] Error sending push to Apple APNs:', error);
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Push delivery failed',
      statusCode: error.statusCode,
    });
  }
}
