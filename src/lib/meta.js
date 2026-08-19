export function extractMetaMessagingEvents(payload) {
  if (!payload || payload.object !== 'page' || !Array.isArray(payload.entry)) return [];

  const events = [];

  for (const entry of payload.entry) {
    const pageId = String(entry.id ?? '');
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const item of messaging) {
      const senderId = item?.sender?.id ? String(item.sender.id) : null;
      const recipientId = item?.recipient?.id ? String(item.recipient.id) : pageId || null;
      if (!senderId) continue;

      const referral = item.referral ?? item.message?.referral ?? item.postback?.referral ?? null;
      const timestamp = Number(item.timestamp ?? Date.now());
      const messageId = item.message?.mid ? String(item.message.mid) : null;
      const text = item.message?.text ? String(item.message.text) : '';

      events.push({
        senderId,
        pageId: recipientId,
        timestamp,
        messageId,
        text,
        referral: referral
          ? {
              source: referral.source ?? null,
              ref: referral.ref ?? null,
              adId: referral.ad_id ?? null,
              campaignId: referral.campaign_id ?? null,
              adsetId: referral.adset_id ?? null
            }
          : null,
        raw: item
      });
    }
  }

  return events;
}

export async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader?.startsWith('sha256=')) return false;

  const providedHex = signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeHexEqual(expected, providedHex.toLowerCase());
}

function timingSafeHexEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function timingSafeTextEqual(a, b) {
  const left = new TextEncoder().encode(String(a ?? ''));
  const right = new TextEncoder().encode(String(b ?? ''));
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
