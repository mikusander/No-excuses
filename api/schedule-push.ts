import webpush from 'web-push';

export const maxDuration = 300; // Fino a 300s su Vercel Pro (clamped a 60s su Hobby)
export const config = {
  maxDuration: 300,
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-relay-worker');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = req.body || {};
  const { subscription, delaySeconds = 0, title, body: notificationBody, timerId, origin } = body;
  const isImmediate = req.query?.immediate === 'true' || body?.immediate === true;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Missing subscription endpoint' });
  }

  const waitMs = isImmediate ? 0 : Math.max(0, Math.round(Number(delaySeconds) * 1000));

  if (timerId) {
    cancelledTimers.delete(timerId);
  }

  // 1. Integrazione con Upstash QStash per schedulazione serverless affidabile oltre i 60s
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!isImmediate && qstashToken && delaySeconds > 0) {
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const baseUrl = origin || `${proto}://${host}`;
      const destinationUrl = `${baseUrl}/api/schedule-push?immediate=true`;

      const qstashRes = await fetch(`https://qstash.upstash.io/v2/publish/${destinationUrl}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Delay': `${delaySeconds}s`,
          'Upstash-Deduplication-Id': timerId || `rest-${Date.now()}`,
        },
        body: JSON.stringify({
          subscription,
          title,
          body: notificationBody,
          timerId,
          endsAtMs: body.endsAtMs || null,
          immediate: true,
        }),
      });

      if (qstashRes.ok) {
        return res.status(200).json({
          success: true,
          scheduled: true,
          provider: 'qstash',
          delaySeconds,
        });
      }
      console.warn('[Push] QStash scheduling failed, falling back to in-memory wait:', await qstashRes.text());
    } catch (qstashErr) {
      console.error('[Push] QStash scheduling error:', qstashErr);
    }
  }

  // 2. Attesa in-memory per ambienti Node persistenti o serverless sotto la soglia timeout
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
      timerId: timerId || null,
      endsAtMs: body.endsAtMs || null,
    });

    // Per Apple APNs (web.push.apple.com) con VAPID, NON deve essere inviato l'header Topic personalizzato,
    // altrimenti APNs risponde con 400 BadTopic / TopicDisallowed.
    // Gli unici header APNs supportati sono apns-collapse-id, apns-priority e apns-push-type.
    await webpush.sendNotification(subscription, payload, {
      headers: {
        'apns-collapse-id': 'rest-timer',
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      TTL: 60,
      urgency: 'high',
    });

    return res.status(200).json({ success: true, delivered: true });
  } catch (error: any) {
    console.error('[WebPush] Error sending push to Apple APNs:', error);
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Push delivery failed',
      statusCode: error.statusCode,
    });
  }
}
