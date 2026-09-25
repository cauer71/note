// Gehostete Version gegen den echten Worker (wrangler dev, lokale D1)
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Worker-API: Testnotizen werden in D1 gespeichert und wieder geladen', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.lernraum.store.kind)).toBe('cloudflare');
  await page.waitForFunction(() => window.lernraum.syncState === 'saved' && !window.lernraum.dirty.size, null, { timeout: 15000 });
  const res = await request.get('/api/pages?since=0');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json.pages.length).toBeGreaterThan(20);
  // Änderung → Server
  await page.evaluate(() => (location.hash = 'seed-inbox'));
  await page.locator('.blk-text').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (API-Test)');
  await page.waitForFunction(() => !window.lernraum.dirty.size && window.lernraum.syncState === 'saved', null, { timeout: 10000 });
  const again = await (await request.get('/api/pages?since=0')).json();
  const inbox = again.pages.find((p) => p.id === 'seed-inbox');
  expect(inbox.data).toContain('(API-Test)');
  // Neu laden → Inhalt kommt vom Server (Cache leeren)
  await page.evaluate(() => indexedDB.deleteDatabase('lernraum'));
  await page.reload();
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
  await page.evaluate(() => (location.hash = 'seed-inbox'));
  await expect(page.locator('.blk-text').first()).toContainText('(API-Test)');
  expect(errors).toEqual([]);
});

test('Worker-API: Endgültig löschen entfernt die Zeile', async ({ page, request }) => {
  await page.goto('/#seed-woche');
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
  await page.evaluate(() => window.lernraum.deleteForever('seed-woche'));
  await page.waitForFunction(() => !window.lernraum.dirty.size, null, { timeout: 10000 });
  const json = await (await request.get('/api/pages?since=0')).json();
  expect(json.pages.find((p) => p.id === 'seed-woche')).toBeUndefined();
});

test('Worker-API: ungültige Eingaben werden abgelehnt', async ({ request }) => {
  const r = await request.put('/api/pages', { data: { pages: [{ id: '', data: 5 }] } });
  expect(r.status()).toBe(400);
  const nf = await request.get('/api/unbekannt');
  expect(nf.status()).toBe(404);
});
