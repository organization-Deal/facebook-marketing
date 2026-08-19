# Facebook Marketing Intelligence — Starter

Starter project สำหรับเก็บและวิเคราะห์เส้นทาง **Content → Chat → Lead → Revenue** โดยยังไม่ต้องมี Meta API key ตอนเริ่มต้น

## สิ่งที่มีให้แล้ว

- Cloudflare Worker API
- Cloudflare D1 database schema + migration
- Meta webhook verification endpoint: `GET /webhooks/meta`
- Meta Messenger webhook receiver: `POST /webhooks/meta`
- รองรับ `x-hub-signature-256` เมื่อใส่ `META_APP_SECRET`
- เก็บ Customer / Conversation / Message / Referral / Content attribution / Lead
- Rule-based keyword + intent + product + lead score เพื่อให้รันได้ทันทีโดยไม่ต้องมี AI API
- Dashboard: Chats / Leads / Qualified / Closed / Revenue / Top Content / Top Keywords / Recent Messages
- Demo seed + Mock webhook event
- Lead status endpoint สำหรับเชื่อม CRM/Sales ภายหลัง

## Architecture

```text
Meta / Facebook
      │
      │ Webhook
      ▼
Cloudflare Worker
      │
      ├── verify signature
      ├── normalize events
      ├── attribution
      └── keyword / intent analysis
      │
      ▼
Cloudflare D1
      │
      ▼
Dashboard (Static Assets)
```

## 1) ติดตั้ง

```bash
npm install
```

## 2) สร้าง D1 database

```bash
npx wrangler d1 create marketing_intelligence
```

เอา `database_id` ที่ Cloudflare คืนมา ใส่แทนค่า all-zero ใน `wrangler.jsonc`

## 3) Local migration

```bash
npm run db:migrate:local
```

## 4) เปิด Local

```bash
npm run dev
```

จากนั้นเปิด URL ที่ Wrangler แสดง แล้วกด **ใส่ข้อมูล Demo**

## 5) Deploy จริง

Apply schema ขึ้น D1 remote:

```bash
npm run db:migrate:remote
```

จากนั้นตั้ง secret (เมื่อได้ Meta App แล้ว):

```bash
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_PAGE_ACCESS_TOKEN
```

เปลี่ยน `APP_ENV` เป็น `production` และ `MOCK_MODE` เป็น `false` ใน `wrangler.jsonc` ก่อน deploy production

```bash
npm run deploy
```

## Meta Webhook URL

หลัง deploy:

```text
https://<your-worker-domain>/webhooks/meta
```

เอา URL นี้ไปใส่ใน Meta App Webhooks พร้อม Verify Token เดียวกับ `META_VERIFY_TOKEN`

## Demo API

Seed dashboard:

```bash
curl -X POST http://localhost:8787/api/mock/seed
```

ส่ง mock customer message:

```bash
curl -X POST http://localhost:8787/api/mock/event \
  -H 'content-type: application/json' \
  -d '{
    "text":"สนใจลงทุนตู้ชกมวย 50,000 บาท มีที่เชียงใหม่ไหม คืนทุนกี่เดือน",
    "ref":"FB_REEL_BOXING_001"
  }'
```

## Update lead / ปิดการขาย

```bash
curl -X POST http://localhost:8787/api/leads/update \
  -H 'content-type: application/json' \
  -d '{
    "customerId":"facebook:demo-page:seed-user-1",
    "status":"won",
    "revenueThb":50000
  }'
```

สถานะที่รองรับ:

- `new`
- `qualified`
- `won`
- `lost`

## ตอนเอา Meta API มาใส่จริง

ตัว webhook parser รองรับโครงสร้าง Messenger `entry[].messaging[]` และพยายามอ่าน referral จาก:

- `event.referral`
- `message.referral`
- `postback.referral`

โดยเก็บค่า เช่น:

- source
- ref
- ad_id
- campaign_id (ถ้ามีใน payload)
- adset_id (ถ้ามีใน payload)

> หมายเหตุ: ฟิลด์ที่ Meta ส่งจริงขึ้นกับ event/source และเวอร์ชัน API ดังนั้นก่อน production ให้ทดสอบ payload จาก Meta App ของจริงแล้วปรับ mapping ตาม payload ที่ได้รับจริง

## AI Upgrade ภายหลัง

ไฟล์ `src/lib/analyze.js` เป็นจุดที่เปลี่ยนจาก rule-based เป็น LLM ได้ โดยให้ผลลัพธ์รูปเดิม:

```js
{
  intent: 'investment_amount',
  product: 'Boxing Machine',
  leadScore: 92,
  sentiment: 'neutral',
  keywords: ['ลงทุน', '50,000', 'เชียงใหม่']
}
```

ดังนั้นหน้า Dashboard และ database ไม่ต้องรื้อเมื่อเปลี่ยนไปใช้ OpenAI/Claude/etc.

## สิ่งที่ควรเพิ่มใน Phase 2

- Meta Marketing API เพื่อ sync Campaign / Ad Set / Ad metadata
- Facebook Post/Reels insights
- CRM assignment และ sales timeline
- AI intent classifier จริง
- Authentication / roles สำหรับ dashboard
- Date range filters
- Multi-page / Instagram / LINE OA adapters
- Data retention + consent/privacy policy ตามการใช้งานจริง
