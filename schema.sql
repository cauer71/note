-- Lernraum D1-Schema
-- rev: vom Server vergebene Revision (Millisekunden der Cloudflare-Uhr) als Sync-Marke,
--      unabhängig von den Uhren der Geräte
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pages_rev ON pages(rev);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
