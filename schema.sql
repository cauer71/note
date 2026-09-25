-- Lernraum D1-Schema (neue Datenbanken; bestehende rüstet der Worker automatisch nach)
-- rev: fortlaufende Revision, in D1 vergeben – Sync-Marke unabhängig von Geräteuhren
-- base_rev: Revision, auf der eine Änderung beruht (optimistische Sperre beim Speichern)
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  base_rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
