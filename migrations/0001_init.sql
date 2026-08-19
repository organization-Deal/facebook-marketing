PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'facebook',
  page_id TEXT,
  display_name TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contents (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'facebook',
  content_type TEXT NOT NULL DEFAULT 'unknown',
  name TEXT NOT NULL,
  post_id TEXT,
  published_at TEXT,
  reach INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  engagement INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  page_id TEXT,
  platform TEXT NOT NULL DEFAULT 'facebook',
  source TEXT NOT NULL DEFAULT 'unknown',
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  content_id TEXT,
  ref_code TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_customer_time
  ON conversations(customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_content
  ON conversations(content_id);
CREATE INDEX IF NOT EXISTS idx_conversations_ad
  ON conversations(ad_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  message_text TEXT,
  created_at TEXT NOT NULL,
  raw_json TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
  ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_customer_time
  ON messages(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_analysis (
  message_id TEXT PRIMARY KEY,
  intent TEXT NOT NULL DEFAULT 'other',
  product TEXT,
  lead_score INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS message_keywords (
  message_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  PRIMARY KEY(message_id, keyword),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_keywords_keyword
  ON message_keywords(keyword);

CREATE TABLE IF NOT EXISTS leads (
  customer_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new', 'qualified', 'won', 'lost')),
  assigned_to TEXT,
  revenue_thb REAL NOT NULL DEFAULT 0,
  attributed_conversation_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (attributed_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_hash TEXT UNIQUE,
  received_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
