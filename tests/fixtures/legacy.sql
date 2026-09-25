-- Testdaten: Datenbank im alten Format (eine gemeinsame Tabelle pages ohne owner),
-- wie vor den getrennten Arbeitsbereichen. Der Worker übernimmt sie in LEGACY_WORKSPACE.
CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0, base_rev INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
INSERT OR IGNORE INTO pages (id, data, updated_at, rev, base_rev) VALUES ('legacy-page', '{"id":"legacy-page","kind":"page","title":"Alte Notiz","blocks":[],"parentId":null,"trashed":0,"order":1,"updatedAt":5}', 5, 7, 0);
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('theme', '"dark"', 5);
INSERT OR IGNORE INTO members (identity, workspace, created_at) VALUES ('alt@test.local', 'legacy-ws', 0), ('alt2@test.local', 'legacy-ws', 0);
