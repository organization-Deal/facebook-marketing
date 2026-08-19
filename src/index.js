import { analyzeMessage } from './lib/analyze.js';
import { extractMetaMessagingEvents, timingSafeTextEqual, verifyMetaSignature } from './lib/meta.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const DAY_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') {
        return json({ ok: true, service: 'facebook-marketing-intelligence', now: new Date().toISOString() });
      }

      if (url.pathname === '/webhooks/meta' && request.method === 'GET') {
        return verifyWebhook(request, env);
      }

      if (url.pathname === '/webhooks/meta' && request.method === 'POST') {
        return receiveMetaWebhook(request, env, ctx);
      }

      if (url.pathname === '/api/dashboard' && request.method === 'GET') {
        return dashboard(env);
      }

      if (url.pathname === '/api/messages' && request.method === 'GET') {
        return recentMessages(env, url);
      }

      if (url.pathname === '/api/keywords' && request.method === 'GET') {
        return keywords(env);
      }

      if (url.pathname === '/api/contents' && request.method === 'GET') {
        return contentPerformance(env);
      }

      if (url.pathname === '/api/leads/update' && request.method === 'POST') {
        return updateLead(request, env);
      }

      if (url.pathname === '/api/mock/seed' && request.method === 'POST') {
        return seedDemo(env);
      }

      if (url.pathname === '/api/mock/event' && request.method === 'POST') {
        return mockEvent(request, env);
      }

      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/')) {
        return json({ error: 'not_found' }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'request_failed', error: String(error) }));
      return json({ error: 'internal_error' }, 500);
    }
  }
};

function verifyWebhook(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (!env.META_VERIFY_TOKEN) {
    return new Response('META_VERIFY_TOKEN is not configured', { status: 503 });
  }

  if (mode === 'subscribe' && timingSafeTextEqual(token, env.META_VERIFY_TOKEN) && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

async function receiveMetaWebhook(request, env, ctx) {
  const rawBody = await readBodyLimited(request, 1024 * 1024);
  const signature = request.headers.get('x-hub-signature-256');
  const production = env.APP_ENV === 'production';

  if (env.META_APP_SECRET) {
    const valid = await verifyMetaSignature(rawBody, signature, env.META_APP_SECRET);
    if (!valid) return json({ error: 'invalid_signature' }, 401);
  } else if (production) {
    return json({ error: 'META_APP_SECRET_required_in_production' }, 503);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // Meta expects a fast 200 response. Persist processing after the response path.
  ctx.waitUntil(processMetaPayload(payload, rawBody, env).catch((error) => {
    console.error(JSON.stringify({ level: 'error', message: 'webhook_processing_failed', error: String(error) }));
  }));
  return new Response('EVENT_RECEIVED', { status: 200 });
}

async function processMetaPayload(payload, rawBody, env) {
  const hash = await sha256(rawBody);
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();

  const savedEvent = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (id, source, event_hash, received_at, raw_json)
     VALUES (?, 'meta', ?, ?, ?)`
  ).bind(eventId, hash, now, rawBody).run();

  // Meta may retry the exact same webhook. Ignore duplicate payloads idempotently.
  if (Number(savedEvent.meta?.changes ?? 0) === 0) return;

  const events = extractMetaMessagingEvents(payload);
  for (const event of events) {
    await ingestMessageEvent(event, env);
  }
}

async function ingestMessageEvent(event, env) {
  const eventTime = new Date(event.timestamp).toISOString();
  const customerId = `facebook:${event.pageId}:${event.senderId}`;

  await env.DB.prepare(
    `INSERT INTO customers (id, platform, page_id, first_seen, last_seen)
     VALUES (?, 'facebook', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`
  ).bind(customerId, event.pageId, eventTime, eventTime).run();

  const conversation = await resolveConversation(customerId, event, env);

  if (!event.messageId) return;

  const messageId = `facebook:${event.messageId}`;
  const analysis = analyzeMessage(event.text);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO messages
       (id, conversation_id, customer_id, direction, message_text, created_at, raw_json)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?)`
    ).bind(messageId, conversation.id, customerId, event.text || null, eventTime, JSON.stringify(event.raw)),

    env.DB.prepare(
      `INSERT OR IGNORE INTO message_analysis
       (message_id, intent, product, lead_score, sentiment)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(messageId, analysis.intent, analysis.product, analysis.leadScore, analysis.sentiment),

    env.DB.prepare(
      `INSERT INTO leads (customer_id, status, revenue_thb, attributed_conversation_id, updated_at)
       VALUES (?, 'new', 0, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET updated_at = excluded.updated_at`
    ).bind(customerId, conversation.id, eventTime),

    env.DB.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).bind(eventTime, conversation.id)
  ]);

  if (analysis.keywords.length) {
    await env.DB.batch(
      analysis.keywords.map((keyword) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO message_keywords (message_id, keyword) VALUES (?, ?)`
        ).bind(messageId, keyword)
      )
    );
  }
}

async function resolveConversation(customerId, event, env) {
  const eventIso = new Date(event.timestamp).toISOString();
  const referral = event.referral;

  if (referral) {
    const conversationId = `conv:${crypto.randomUUID()}`;
    const source = normalizeSource(referral.source);
    const contentId = inferContentId(referral.ref, referral.adId);

    if (contentId) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO contents (id, platform, content_type, name)
         VALUES (?, 'facebook', 'tracked', ?)`
      ).bind(contentId, contentId).run();
    }

    await env.DB.prepare(
      `INSERT INTO conversations
       (id, customer_id, page_id, platform, source, campaign_id, adset_id, ad_id, content_id, ref_code, started_at, updated_at)
       VALUES (?, ?, ?, 'facebook', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      conversationId,
      customerId,
      event.pageId,
      source,
      referral.campaignId,
      referral.adsetId,
      referral.adId,
      contentId,
      referral.ref,
      eventIso,
      eventIso
    ).run();

    return { id: conversationId };
  }

  const latest = await env.DB.prepare(
    `SELECT id, updated_at FROM conversations
     WHERE customer_id = ?
     ORDER BY updated_at DESC LIMIT 1`
  ).bind(customerId).first();

  if (latest && event.timestamp - Date.parse(latest.updated_at) <= DAY_MS) {
    return { id: latest.id };
  }

  const conversationId = `conv:${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO conversations
     (id, customer_id, page_id, platform, source, started_at, updated_at)
     VALUES (?, ?, ?, 'facebook', 'organic_or_unknown', ?, ?)`
  ).bind(conversationId, customerId, event.pageId, eventIso, eventIso).run();

  return { id: conversationId };
}

function inferContentId(refCode, adId) {
  if (refCode) return `ref:${refCode}`;
  if (adId) return `ad:${adId}`;
  return null;
}

function normalizeSource(source) {
  const value = String(source ?? '').toUpperCase();
  if (value === 'ADS') return 'ads';
  if (value === 'SHORTLINK') return 'm.me';
  if (value) return value.toLowerCase();
  return 'referral';
}

async function dashboard(env) {
  const [summary, topKeywords, topContents] = await Promise.all([
    env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM conversations) AS chats,
        (SELECT COUNT(*) FROM leads) AS leads,
        (SELECT COUNT(*) FROM leads WHERE status IN ('qualified','won')) AS qualified,
        (SELECT COUNT(*) FROM leads WHERE status = 'won') AS closed,
        (SELECT COALESCE(SUM(revenue_thb), 0) FROM leads WHERE status = 'won') AS revenue
    `).first(),
    getKeywords(env, 8),
    getContentPerformance(env, 8)
  ]);

  const leads = Number(summary?.leads ?? 0);
  const closed = Number(summary?.closed ?? 0);

  return json({
    summary: {
      chats: Number(summary?.chats ?? 0),
      leads,
      qualified: Number(summary?.qualified ?? 0),
      closed,
      revenue: Number(summary?.revenue ?? 0),
      leadToClosePct: leads ? Number(((closed / leads) * 100).toFixed(1)) : 0
    },
    topKeywords,
    topContents
  });
}

async function recentMessages(env, url) {
  const limit = clamp(Number(url.searchParams.get('limit') || 30), 1, 100);
  const result = await env.DB.prepare(`
    SELECT
      m.id, m.message_text, m.created_at, m.customer_id,
      a.intent, a.product, a.lead_score,
      c.source, c.content_id, c.ad_id, c.ref_code,
      l.status AS lead_status, l.revenue_thb
    FROM messages m
    JOIN message_analysis a ON a.message_id = m.id
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN leads l ON l.customer_id = m.customer_id
    ORDER BY m.created_at DESC
    LIMIT ?
  `).bind(limit).all();

  return json({ messages: result.results ?? [] });
}

async function keywords(env) {
  return json({ keywords: await getKeywords(env, 50) });
}

async function getKeywords(env, limit) {
  const result = await env.DB.prepare(`
    WITH keyword_mentions AS (
      SELECT mk.keyword, m.customer_id, COUNT(*) AS mention_count
      FROM message_keywords mk
      JOIN messages m ON m.id = mk.message_id
      GROUP BY mk.keyword, m.customer_id
    )
    SELECT
      km.keyword,
      SUM(km.mention_count) AS mentions,
      COUNT(*) AS customers,
      SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS closed,
      COALESCE(SUM(CASE WHEN l.status = 'won' THEN l.revenue_thb ELSE 0 END), 0) AS revenue
    FROM keyword_mentions km
    LEFT JOIN leads l ON l.customer_id = km.customer_id
    GROUP BY km.keyword
    ORDER BY mentions DESC, customers DESC
    LIMIT ?
  `).bind(limit).all();

  return result.results ?? [];
}

async function contentPerformance(env) {
  return json({ contents: await getContentPerformance(env, 100) });
}

async function getContentPerformance(env, limit) {
  const result = await env.DB.prepare(`
    SELECT
      ct.id, ct.name, ct.content_type, ct.reach, ct.views, ct.engagement,
      COUNT(DISTINCT c.id) AS chats,
      COUNT(DISTINCT c.customer_id) AS leads,
      COUNT(DISTINCT CASE WHEN l.status = 'won' THEN l.customer_id END) AS closed,
      COALESCE(SUM(CASE WHEN l.status = 'won' THEN l.revenue_thb ELSE 0 END), 0) AS revenue
    FROM contents ct
    LEFT JOIN conversations c ON c.content_id = ct.id
    LEFT JOIN leads l ON l.attributed_conversation_id = c.id
    GROUP BY ct.id
    ORDER BY revenue DESC, closed DESC, chats DESC
    LIMIT ?
  `).bind(limit).all();

  return result.results ?? [];
}

async function updateLead(request, env) {
  const body = await readJson(request);
  const customerId = String(body.customerId ?? '');
  const status = String(body.status ?? '');
  const allowed = new Set(['new', 'qualified', 'won', 'lost']);
  if (!customerId || !allowed.has(status)) return json({ error: 'invalid_input' }, 400);

  const revenue = status === 'won' ? Math.max(0, Number(body.revenueThb ?? 0)) : 0;
  const latestConversation = await env.DB.prepare(
    `SELECT id FROM conversations WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(customerId).first();

  await env.DB.prepare(`
    INSERT INTO leads (customer_id, status, revenue_thb, attributed_conversation_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET
      status = excluded.status,
      revenue_thb = excluded.revenue_thb,
      attributed_conversation_id = COALESCE(excluded.attributed_conversation_id, leads.attributed_conversation_id),
      updated_at = excluded.updated_at
  `).bind(customerId, status, revenue, latestConversation?.id ?? null, new Date().toISOString()).run();

  return json({ ok: true });
}

async function mockEvent(request, env) {
  if (env.MOCK_MODE !== 'true') return json({ error: 'mock_mode_disabled' }, 403);
  const body = await readJson(request);
  const now = Date.now();
  const event = {
    senderId: body.senderId ?? `demo-${crypto.randomUUID()}`,
    pageId: body.pageId ?? 'demo-page',
    timestamp: body.timestamp ?? now,
    messageId: body.messageId ?? `demo-mid-${crypto.randomUUID()}`,
    text: body.text ?? 'สนใจลงทุนตู้ชกมวย 50,000 บาท มีที่เชียงใหม่ไหม คืนทุนกี่เดือน',
    referral: body.referral ?? {
      source: 'ADS',
      ref: body.ref ?? 'FB_REEL_BOXING_001',
      adId: body.adId ?? 'demo-ad-001',
      campaignId: body.campaignId ?? 'demo-campaign',
      adsetId: body.adsetId ?? 'demo-adset'
    },
    raw: { demo: true }
  };

  await ingestMessageEvent(event, env);
  return json({ ok: true, event });
}

async function seedDemo(env) {
  if (env.MOCK_MODE !== 'true') return json({ error: 'mock_mode_disabled' }, 403);

  const demoContents = [
    ['ref:FB_REEL_BOXING_001', 'Reel: ลงทุนตู้ชกมวย 50K', 'reel', 210000, 184000, 9400],
    ['ref:FB_REEL_OWNER_027', 'Reel: เจ้าของตู้อายุ 27', 'reel', 93000, 81000, 6100],
    ['ref:FB_POST_PROPERTY_003', 'Post: คอนโดลงทุน', 'post', 128000, 0, 4300],
    ['ad:demo-ad-004', 'Ad: Boxing Location', 'ad', 165000, 142000, 7200]
  ];

  for (const row of demoContents) {
    await env.DB.prepare(`
      INSERT INTO contents (id, platform, content_type, name, reach, views, engagement)
      VALUES (?, 'facebook', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, content_type=excluded.content_type,
        reach=excluded.reach, views=excluded.views, engagement=excluded.engagement
    `).bind(row[0], row[2], row[1], row[3], row[4], row[5]).run();
  }

  const demoMessages = [
    ['FB_REEL_BOXING_001', 'สนใจลงทุนตู้ชกมวย 50,000 บาทครับ มีที่เชียงใหม่ไหม', 'won', 50000],
    ['FB_REEL_BOXING_001', 'ขั้นต่ำเท่าไหร่ คืนทุนประมาณกี่เดือน', 'qualified', 0],
    ['FB_REEL_OWNER_027', 'อยากลง 100,000 มีสัญญาแบบไหนครับ', 'won', 100000],
    ['FB_REEL_OWNER_027', 'สนใจครับ ราคาเริ่มต้นเท่าไหร่', 'won', 50000],
    ['FB_POST_PROPERTY_003', 'คอนโดผลตอบแทนประมาณเท่าไหร่ ความเสี่ยงมีอะไรบ้าง', 'qualified', 0],
    ['FB_POST_PROPERTY_003', 'สนใจอสังหา ลงทุนขั้นต่ำกี่บาท', 'new', 0],
    ['FB_REEL_BOXING_001', 'รายได้ตู้ชกมวยต่อเดือนประมาณเท่าไหร่', 'lost', 0],
    ['FB_REEL_OWNER_027', 'พร้อมลง 50,000 ครับ เริ่มได้เลยไหม', 'won', 50000],
    ['FB_REEL_BOXING_001', 'กรุงเทพมี location ไหมครับ สนใจลงทุน', 'new', 0],
    ['FB_POST_PROPERTY_003', 'อยากลงทุนคอนโด 200000 บาท', 'won', 200000]
  ];

  for (let i = 0; i < demoMessages.length; i += 1) {
    const [ref, text, status, revenue] = demoMessages[i];
    const senderId = `seed-user-${i + 1}`;
    const timestamp = Date.now() - i * 60 * 60 * 1000;
    const event = {
      senderId,
      pageId: 'demo-page',
      timestamp,
      messageId: `seed-mid-${i + 1}`,
      text,
      referral: {
        source: 'SHORTLINK',
        ref,
        adId: null,
        campaignId: null,
        adsetId: null
      },
      raw: { demo: true, seed: i + 1 }
    };

    await ingestMessageEvent(event, env);
    await updateLeadInternal(`facebook:demo-page:${senderId}`, status, revenue, env);
  }

  return json({ ok: true, inserted: demoMessages.length });
}

async function updateLeadInternal(customerId, status, revenue, env) {
  const latest = await env.DB.prepare(
    `SELECT id FROM conversations WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(customerId).first();

  await env.DB.prepare(`
    UPDATE leads
    SET status = ?, revenue_thb = ?, attributed_conversation_id = ?, updated_at = ?
    WHERE customer_id = ?
  `).bind(status, revenue, latest?.id ?? null, new Date().toISOString(), customerId).run();
}

async function readBodyLimited(request, maxBytes) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('payload_too_large');
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('payload_too_large');
      throw new Error('payload_too_large');
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
