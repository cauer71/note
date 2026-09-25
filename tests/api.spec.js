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

test('Worker-API: optimistische Sperre lehnt veraltete Stände ab', async ({ request }) => {
  const id = 'race-' + Date.now();
  const r1 = await (await request.put('/api/pages', { data: { pages: [{ id, data: JSON.stringify({ id, title: 'v1' }), updated_at: 1, base_rev: 0 }] } })).json();
  const rev1 = r1.saved[id];
  expect(rev1).toBeGreaterThan(0);
  const r2 = await (await request.put('/api/pages', { data: { pages: [{ id, data: JSON.stringify({ id, title: 'v2' }), updated_at: 2, base_rev: rev1 }] } })).json();
  expect(r2.saved[id]).toBeGreaterThan(rev1);
  // Gerät mit veraltetem Stand (base_rev = rev1) wird abgelehnt
  const r3 = await (await request.put('/api/pages', { data: { pages: [{ id, data: JSON.stringify({ id, title: 'alt' }), updated_at: 999999999999999, base_rev: rev1 }] } })).json();
  expect(r3.rejected).toEqual([id]);
  const one = await (await request.get('/api/pages?ids=' + id)).json();
  expect(JSON.parse(one.pages[0].data).title).toBe('v2');
  await request.delete('/api/pages', { data: { ids: [id] } });
});

async function openDevice(browser, clockOffset = 0) {
  const ctx = await browser.newContext();
  if (clockOffset) await ctx.addInitScript((off) => { const real = Date.now; Date.now = () => real() + off; }, clockOffset);
  const p = await ctx.newPage();
  await p.goto('/#seed-lernmethoden');
  await p.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5 && window.lernraum.view === 'page' && window.lernraum.syncState === 'saved');
  return p;
}
const settled = (p) => p.waitForFunction(() => !window.lernraum.dirty.size && !window.lernraum.uploading.size && window.lernraum.syncState === 'saved', null, { timeout: 15000 });
const resync = (p) => p.evaluate(async () => { window.lernraum.lastSyncAt = 0; await window.lernraum.sync(); });
const serverText = async (request) => {
  const j = await (await request.get('/api/pages?ids=seed-lernmethoden')).json();
  return JSON.parse(j.pages[0].data).blocks.map((b) => b.text).join('|');
};

test('Zwei Geräte: Änderungen kommen an, gleichzeitiges Bearbeiten wird zusammengeführt', async ({ browser, request }) => {
  const a = await openDevice(browser);
  const b = await openDevice(browser);
  // A ändert, B synchronisiert (nicht am Tippen) → B zeigt die Änderung
  await a.locator('.blk-text').nth(1).click();
  await a.keyboard.press('End');
  await a.keyboard.type(' [von A]');
  await settled(a);
  await resync(b);
  await expect(b.locator('.blk-text').nth(1)).toContainText('[von A]');
  // Beide tippen gleichzeitig in verschiedenen Blöcken, ohne sich vorher zu synchronisieren
  await b.locator('.blk-text').nth(3).click();
  await b.keyboard.press('End');
  await b.keyboard.type(' [B tippt]');
  await a.keyboard.type(' [A2]');
  await settled(a);
  await settled(b);
  // B wurde abgelehnt, hat zusammengeführt und neu gespeichert → beides auf dem Server
  const text = await serverText(request);
  expect(text).toContain('[A2]');
  expect(text).toContain('[B tippt]');
  // Nach dem nächsten Sync zeigt B beides – ohne den Fokus (iOS-Tastatur) zu verlieren
  await resync(b);
  await expect(b.locator('.blk-text').nth(1)).toContainText('[A2]');
  await expect(b.locator('.blk-text').nth(3)).toContainText('[B tippt]');
  expect(await b.evaluate(() => document.activeElement.classList.contains('blk-text'))).toBe(true);
  await b.keyboard.type('!');
  await settled(b);
  expect(await serverText(request)).toContain('[B tippt]!');
});

test('Geräteuhr geht einen Tag nach: Änderungen gehen trotzdem nicht verloren', async ({ browser, request }) => {
  const late = await openDevice(browser, -86400000);
  await late.locator('.blk-text').nth(5).click();
  await late.keyboard.press('End');
  await late.keyboard.type(' [Uhr falsch]');
  await settled(late);
  expect(await serverText(request)).toContain('[Uhr falsch]');
});

test('Worker-API: Zeilen mit Revision 0 (vor der Migration) werden geladen', async ({ page, request }) => {
  // Zeile direkt mit rev 0 anlegen wie nach der Migration einer alten Datenbank
  const id = 'legacy-' + Date.now();
  const r = await request.put('/api/pages', { data: { pages: [{ id, data: JSON.stringify({ id, kind: 'page', title: 'Alt', blocks: [], parentId: null, trashed: 0, order: 1, updatedAt: 1 }), updated_at: 1, base_rev: 0 }] } });
  expect(r.ok()).toBeTruthy();
  const res = await request.get('/api/pages?since=-1');
  const rows = (await res.json()).pages;
  expect(rows.every((x) => x.data)).toBe(true);
  await request.delete('/api/pages', { data: { ids: [id] } });
  void page;
});
