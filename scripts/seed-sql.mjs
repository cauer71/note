// Erzeugt seed.sql mit den Testnotizen (INSERT OR IGNORE → überschreibt nichts)
import { writeFileSync } from 'node:fs';
import { buildSeed } from '../src/seed.js';
const pages = buildSeed();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const lines = pages.map((p) => `INSERT OR IGNORE INTO pages (id, data, updated_at) VALUES (${q(p.id)}, ${q(JSON.stringify(p))}, ${p.updatedAt});`);
writeFileSync('dist/seed.sql', lines.join('\n') + '\n');
console.log(pages.length + ' Seiten → dist/seed.sql');
