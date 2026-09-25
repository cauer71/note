// Schneller Rauchtest: lädt die App lokal, sammelt Fehler, macht Screenshots
import { chromium, devices } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = join(process.cwd(), 'dist/site');
const types = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || !existsSync(join(root, p))) p = '/index.html';
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(join(root, p)));
}).listen(4173);

const out = process.argv[2] || '.';
const browser = await chromium.launch();
const errors = [];
async function run(name, ctxOpts, fn) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}\n${e.stack}`));
  await fn(page);
  await ctx.close();
}
const shots = process.argv.slice(3);
await run('desktop', { viewport: { width: 1280, height: 860 } }, async (page) => {
  await page.goto('http://localhost:4173/?local=smoke');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/desktop-today.png` });
  await page.goto('http://localhost:4173/?local=smoke#seed-ana-vl3');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/desktop-page.png` });
  await page.goto('http://localhost:4173/?local=smoke#seed-aufgaben');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/desktop-db.png` });
});
await run('iphone', { ...devices['iPhone 15 Pro'] }, async (page) => {
  await page.goto('http://localhost:4173/?local=smoke2');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/iphone-home.png` });
  await page.goto('http://localhost:4173/?local=smoke2#seed-ana-vl3');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/iphone-page.png` });
});
console.log(errors.length ? errors.join('\n') : 'Keine Fehler');
await browser.close();
server.close();
