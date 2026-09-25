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

test('Worker-API: ein älterer Stand überschreibt keinen neueren', async ({ request }) => {
  const id = 'race-' + Date.now();
  await request.put('/api/pages', { data: { pages: [{ id, data: JSON.stringify({ id, title: 'neu' }), updated_at: 2000 }] } });
  await request.put('/api/pages', { data: { pages: [{ id, data: JSON.stringify({ id, title: 'alt' }), updated_at: 1000 }] } });
  const json = await (await request.get('/api/pages?since=0')).json();
  expect(JSON.parse(json.pages.find((p) => p.id === id).data).title).toBe('neu');
  await request.delete('/api/pages', { data: { ids: [id] } });
});

test('Zwei Geräte: Änderungen kommen an, beim Tippen wird zurückgestellt', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto('/#seed-lernmethoden');
    await p.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5 && window.lernraum.view === 'page');
  }
  // A ändert, B synchronisiert (nicht am Tippen) → B zeigt die Änderung
  await a.locator('.blk-text').nth(1).click();
  await a.keyboard.press('End');
  await a.keyboard.type(' [von A]');
  await a.waitForFunction(() => !window.lernraum.dirty.size && window.lernraum.syncState === 'saved');
  await b.evaluate(async () => {
    window.lernraum.lastSyncAt = 0;
    await window.lernraum.sync();
  });
  await expect(b.locator('.blk-text').nth(1)).toContainText('[von A]');
  // B tippt gerade → neuer Stand von A wird zurückgestellt und B verliert nichts
  await b.locator('.blk-text').nth(3).click();
  await b.keyboard.press('End');
  await b.keyboard.type(' [B tippt]');
  await a.keyboard.type(' [A2]');
  await a.waitForFunction(() => !window.lernraum.dirty.size && window.lernraum.syncState === 'saved');
  await b.evaluate(async () => {
    window.lernraum.lastSyncAt = 0;
    await window.lernraum.sync();
  });
  await expect(b.locator('.blk-text').nth(3)).toContainText('[B tippt]');
  await b.waitForFunction(() => !window.lernraum.dirty.size);
  const data = await b.evaluate(() => JSON.stringify(window.lernraum.getPage('seed-lernmethoden').blocks.map((x) => x.text)));
  expect(data).toContain('[B tippt]');
});
