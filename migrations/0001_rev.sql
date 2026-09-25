-- Revision als serverseitige Sync-Marke nachrüsten (für bestehende Datenbanken)
ALTER TABLE pages ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_pages_rev ON pages(rev);
DROP INDEX IF EXISTS idx_pages_updated;
