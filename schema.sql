-- Tables for edge-visitor-log.
-- Apply with: npx wrangler d1 execute edge-visitor-log --remote --file schema.sql

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  -- Hash of IP + browser (see visitorKey in src/visitors.js)
  visitor_key TEXT NOT NULL,
  ip TEXT NOT NULL,
  country TEXT,
  region TEXT,
  city TEXT,
  org TEXT,
  asn INTEGER,
  host TEXT,
  path TEXT,
  title TEXT,
  referrer TEXT,
  -- JSON object of utm_* and ?ref= values, or NULL
  utm TEXT,
  user_agent TEXT,
  -- tor | vpn | relay | hosting, or NULL for an ordinary connection (see src/network.js)
  network_kind TEXT,
  network_provider TEXT
);

CREATE INDEX IF NOT EXISTS visits_at ON visits (at);
CREATE INDEX IF NOT EXISTS visits_ip ON visits (ip);

-- Your own IPs: their visits are left out of /api/visitors unless asked for
CREATE TABLE IF NOT EXISTS ignored_ips (
  ip TEXT PRIMARY KEY,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The Tor Project's exit list, replaced by the cron trigger
CREATE TABLE IF NOT EXISTS tor_exits (
  ip TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
