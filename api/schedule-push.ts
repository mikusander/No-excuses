import webpush from 'web-push';

export const maxDuration = 60;
export const config = {
  maxDuration: 60,
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
  // CORS configuration
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
  const {
    subscription,
    delaySeconds = 0,
    title,
    body: notificationBody,
    timerId,
    endsAtMs,
    origin,
    isRelayWorker,
  } = body;

  const isImmediate = req.query?.immediate === 'true' || body?.immediate === true;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Missing subscription endpoint' });
  }

  const sendPushNow = async () => {
    const payload = JSON.stringify({
      title: title || '⏱️ Recupero Terminato!',
      body: notificationBody || 'È ora di iniziare la prossima serie!',
      tag: 'rest-timer',
      url: '/',
      timerId: timerId || null,
      endsAtMs: endsAtMs || null,
    });

    return webpush.sendNotification(subscription, payload, {
      headers: {
        'apns-collapse-id': 'rest-timer',
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      TTL: 60,
      urgency: 'high',
    });
  };

  // 1. Consegna immediata (richiesta esplicita o scadenza timer)
  if (isImmediate || delaySeconds <= 0) {
    try {
      await sendPushNow();
      return res.status(200).json({ success: true, delivered: true });
    } catch (error: any) {
      console.error('[WebPush] Immediate push delivery error:', error);
      return res.status(error.statusCode || 500).json({
        error: error.message || 'Push delivery failed',
      });
    }
  }

  if (timerId) {
    cancelledTimers.delete(timerId);
  }

  // 2. Integrazione con Upstash QStash se configurato (standard enterprise serverless per timer arbitrariamente lunghi)
  const qstashToken = process.env.QSTASH_TOKEN;
  if (qstashToken && delaySeconds > 0) {
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const baseUrl = origin || `${proto}://${host}`;
      const destinationUrl = `${baseUrl}/api/schedule-push`;

      const qstashRes = await fetch(`https://qstash.upstash.io/v2/publish/${destinationUrl}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          'Upstash-Delay': `${delaySeconds}s`,
          'Upstash-Deduplication-Id': `${timerId || 'rest'}-${Date.now()}`,
        },
        body: JSON.stringify({
          subscription,
          title,
          body: notificationBody,
          timerId,
          endsAtMs: endsAtMs || null,
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
      console.warn('[Push] QStash scheduling failed, falling back to relay baton:', await qstashRes.text());
    } catch (qstashErr) {
      console.error('[Push] QStash scheduling error:', qstashErr);
    }
  }

  // 3. STAFFETTA SERVERLESS AUTONOMA (Serverless Relay Baton):
  // Risolve definitivamente il limite dei 60s di Vercel Hobby senza richiedere account o token esterni!
  // Ogni staffetta dorme 35s (ben sotto i 60s), poi passa il testimone alla successiva prima di chiudersi.
  const CHUNK_SECONDS = 35;
  const THRESHOLD_SECONDS = 45;

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = origin || `${proto}://${host}`;
  const nextUrl = `${baseUrl}/api/schedule-push`;

  if (delaySeconds > THRESHOLD_SECONDS) {
    if (!isRelayWorker) {
      // Chiamata iniziale dal browser dell'atleta:
      // Avviamo il Worker 1 in background, attendiamo la conferma di avvio (streaming ACK <100ms)
      // e rispondiamo SUBITO al client in ~150ms. In questo modo il socket HTTP dell'iPhone si chiude
      // e l'atleta può bloccare lo schermo / passare ad altre app istantaneamente!
      try {
        const workerPayload = {
          ...body,
          isRelayWorker: true,
          origin: baseUrl,
        };

        const workerRes = await fetch(nextUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-relay-worker': 'true',
          },
          body: JSON.stringify(workerPayload),
        });

        if (workerRes.ok && workerRes.body) {
          const reader = workerRes.body.getReader();
          await reader.read(); // Attende il primo chunk emesso da Worker 1 (<50ms)
          reader.releaseLock();
        }

        return res.status(200).json({
          success: true,
          scheduled: true,
          provider: 'relay-baton',
          delaySeconds,
        });
      } catch (err: any) {
        console.error('[Push] Errore dispatch iniziale relay worker:', err);
        // Fallback: se la chiamata interna fallisce, tenta un'attesa diretta
      }
    } else {
      // Invocazione di uno step intermedio della staffetta:
      // Rispondi con header HTTP di streaming immediati al chiamante per liberarlo
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      res.write(`ack-step:${delaySeconds}\n`);

      // Dormi per la frazione sicura (35s)
      await new Promise((resolve) => setTimeout(resolve, CHUNK_SECONDS * 1000));

      if (timerId && cancelledTimers.has(timerId)) {
        cancelledTimers.delete(timerId);
        res.end();
        return;
      }

      const remainingDelay = delaySeconds - CHUNK_SECONDS;

      // Passaggio del testimone allo step successivo
      let batonPassed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const nextPayload = {
            ...body,
            delaySeconds: remainingDelay,
            isRelayWorker: true,
            origin: baseUrl,
          };

          const nextRes = await fetch(nextUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-relay-worker': 'true',
            },
            body: JSON.stringify(nextPayload),
          });

          if (nextRes.ok && nextRes.body) {
            const reader = nextRes.body.getReader();
            await reader.read(); // Confermato che il prossimo worker ha iniziato
            reader.releaseLock();
            batonPassed = true;
            break;
          }
        } catch (relayErr) {
          console.error(`[Push] Tentativo passaggio staffetta ${attempt + 1} fallito:`, relayErr);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Se per qualsiasi anomalia di rete tutti i 3 tentativi di passaggio sono falliti,
      // invia la notifica subito per non lasciare l'atleta senza avviso
      if (!batonPassed) {
        console.warn('[Push] Relay fallback: invio push d emergenza!');
        try {
          await sendPushNow();
        } catch (err) {
          console.error('[Push] Errore push emergenza:', err);
        }
      }

      res.end();
      return;
    }
  }

  // 4. Ultimo anello della staffetta (o timer breve <= 45s)
  if (isRelayWorker) {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    res.write(`ack-final:${delaySeconds}\n`);
  }

  const waitMs = Math.max(0, Math.round(Number(delaySeconds) * 1000));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  if (timerId && cancelledTimers.has(timerId)) {
    cancelledTimers.delete(timerId);
    if (isRelayWorker) res.end();
    else res.status(200).json({ cancelled: true });
    return;
  }

  try {
    await sendPushNow();
    if (isRelayWorker) {
      res.end();
    } else {
      res.status(200).json({ success: true, delivered: true });
    }
  } catch (error: any) {
    console.error('[WebPush] Error sending push to Apple APNs:', error);
    if (isRelayWorker) {
      res.end();
    } else {
      res.status(error.statusCode || 500).json({
        error: error.message || 'Push delivery failed',
      });
    }
  }
}
