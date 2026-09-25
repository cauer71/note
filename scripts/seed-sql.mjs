// Erzeugt seed.sql mit den Testnotizen für einen Arbeitsbereich (INSERT OR IGNORE → überschreibt nichts)
// node scripts/seed-sql.mjs <arbeitsbereich>   (z. B. christian oder eine E-Mail-Adresse)
import { writeFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
const owner = (process.argv[2] || '').trim().toLowerCase();
if (!owner) {
  console.error('Arbeitsbereich angeben: node scripts/seed-sql.mjs <arbeitsbereich>');
  process.exit(1);
}
const pages = buildSeed();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// frische Revision, damit bereits abgeglichene Geräte die Seiten auch laden
const lines = pages.map(
  (p) => `INSERT OR IGNORE INTO ws_pages (owner, id, data, updated_at, rev, base_rev) VALUES (${q(owner)}, ${q(p.id)}, ${q(JSON.stringify(p))}, ${p.updatedAt}, (SELECT COALESCE(MAX(rev), 0) + 1 FROM ws_pages), 0);`
);
writeFileSync('dist/seed.sql', lines.join('\n') + '\n');
console.log(pages.length + ' Seiten für ' + owner + ' → dist/seed.sql');
