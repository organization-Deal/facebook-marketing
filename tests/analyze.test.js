import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage } from '../src/lib/analyze.js';
import { extractMetaMessagingEvents } from '../src/lib/meta.js';

test('analyzes Thai investment message', () => {
  const result = analyzeMessage('สนใจลงทุนตู้ชกมวย 50,000 บาท มีที่เชียงใหม่ไหม คืนทุนกี่เดือน');
  assert.equal(result.product, 'Boxing Machine');
  assert.ok(result.keywords.includes('ลงทุน'));
  assert.ok(result.keywords.includes('เชียงใหม่'));
  assert.ok(result.leadScore >= 70);
});

test('extracts Messenger event and referral', () => {
  const payload = {
    object: 'page',
    entry: [{
      id: 'page-1',
      messaging: [{
        sender: { id: 'user-1' },
        recipient: { id: 'page-1' },
        timestamp: 123,
        message: {
          mid: 'mid.1',
          text: 'hello',
          referral: { source: 'ADS', ref: 'CONTENT_1', ad_id: 'ad-1' }
        }
      }]
    }]
  };

  const [event] = extractMetaMessagingEvents(payload);
  assert.equal(event.senderId, 'user-1');
  assert.equal(event.messageId, 'mid.1');
  assert.equal(event.referral.adId, 'ad-1');
  assert.equal(event.referral.ref, 'CONTENT_1');
});
