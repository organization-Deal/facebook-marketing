const RULES = [
  { keyword: 'ลงทุน', intent: 'investment_interest', score: 20 },
  { keyword: 'ขั้นต่ำ', intent: 'pricing', score: 15 },
  { keyword: 'ราคา', intent: 'pricing', score: 12 },
  { keyword: '50,000', intent: 'investment_amount', score: 20 },
  { keyword: '50000', intent: 'investment_amount', score: 20 },
  { keyword: 'คืนทุน', intent: 'roi_question', score: 15 },
  { keyword: 'ผลตอบแทน', intent: 'roi_question', score: 15 },
  { keyword: 'รายได้', intent: 'revenue_question', score: 10 },
  { keyword: 'ความเสี่ยง', intent: 'risk_question', score: 8 },
  { keyword: 'สัญญา', intent: 'contract_question', score: 8 },
  { keyword: 'เชียงใหม่', intent: 'location_question', score: 10 },
  { keyword: 'กรุงเทพ', intent: 'location_question', score: 10 },
  { keyword: 'ตู้ชกมวย', intent: 'product_interest', score: 20, product: 'Boxing Machine' },
  { keyword: 'boxing', intent: 'product_interest', score: 20, product: 'Boxing Machine' },
  { keyword: 'คอนโด', intent: 'product_interest', score: 20, product: 'Real Estate' },
  { keyword: 'อสังหา', intent: 'product_interest', score: 20, product: 'Real Estate' }
];

export function analyzeMessage(text = '') {
  const normalized = String(text).toLowerCase().trim();
  const matches = RULES.filter((rule) => normalized.includes(rule.keyword.toLowerCase()));
  const keywords = [...new Set(matches.map((rule) => rule.keyword))];
  const intents = matches.map((rule) => rule.intent);
  const product = matches.find((rule) => rule.product)?.product ?? null;

  let leadScore = matches.reduce((sum, rule) => sum + rule.score, 0);

  // Strong buying signal: user mentions a money amount.
  if (/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{4,7}\b/.test(normalized)) {
    leadScore += 15;
  }

  // Strong intent phrases.
  if (/(สนใจ|อยากลง|พร้อมลง|เริ่มได้|ซื้อ|จ่าย)/i.test(normalized)) {
    leadScore += 20;
  }

  leadScore = Math.min(100, leadScore);

  let primaryIntent = 'other';
  if (intents.includes('investment_amount')) primaryIntent = 'investment_amount';
  else if (intents.includes('investment_interest')) primaryIntent = 'investment_interest';
  else if (intents.includes('product_interest')) primaryIntent = 'product_interest';
  else if (intents.length) primaryIntent = intents[0];

  return {
    intent: primaryIntent,
    product,
    leadScore,
    sentiment: 'neutral',
    keywords
  };
}
