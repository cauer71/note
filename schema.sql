-- Notes D1-Schema (neue Datenbanken; bestehende rüstet der Worker automatisch nach)
-- owner: Arbeitsbereich (eine Person; mehrere Anmeldungen können über members denselben nutzen)
-- rev: fortlaufende Revision, in D1 vergeben – Sync-Marke unabhängig von Geräteuhren
-- base_rev: Revision, auf der eine Änderung beruht (optimistische Sperre beim Speichern)
CREATE TABLE IF NOT EXISTS ws_pages (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  base_rev INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS idx_ws_pages_rev ON ws_pages(rev);

CREATE TABLE IF NOT EXISTS ws_settings (
  owner TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, key)
);

-- Identität (E-Mail in Kleinbuchstaben bzw. Client-ID eines Service-Tokens) → Arbeitsbereich.
-- Ohne Eintrag ist der Arbeitsbereich die Identität selbst.
CREATE TABLE IF NOT EXISTS members (
  identity TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  created_at INTEGER
);
