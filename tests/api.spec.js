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

// --- Getrennte Arbeitsbereiche --------------------------------------------------
const as = (user) => ({ headers: { 'x-dev-user': user } });
const pageJson = (id, title) => JSON.stringify({ id, kind: 'page', title, blocks: [], parentId: null, trashed: 0, order: 1, updatedAt: 1 });

test('Arbeitsbereiche: jede Person sieht nur ihre eigenen Seiten', async ({ request }) => {
  const id = 'gleich-' + Date.now();
  const put = (user, title) => request.put('/api/pages', { ...as(user), data: { pages: [{ id, data: pageJson(id, title), updated_at: 1, base_rev: 0 }] } });
  // Gleiche Seiten-ID in zwei Arbeitsbereichen: kein Konflikt, keine Vermischung
  expect((await (await put('anna@test.local', 'Von Anna')).json()).saved[id]).toBeGreaterThan(0);
  expect((await (await put('ben@test.local', 'Von Ben')).json()).saved[id]).toBeGreaterThan(0);
  const title = async (user) => {
    const j = await (await request.get('/api/pages?ids=' + id, as(user))).json();
    return j.pages.map((p) => JSON.parse(p.data).title);
  };
  expect(await title('anna@test.local')).toEqual(['Von Anna']);
  expect(await title('ben@test.local')).toEqual(['Von Ben']);
  expect(await title('dev')).toEqual([]);
  // Liste enthält nur eigene Seiten
  const annaAll = (await (await request.get('/api/pages?since=-1', as('anna@test.local'))).json()).pages;
  expect(annaAll.map((p) => p.id)).toEqual([id]);
  // Löschen wirkt nur im eigenen Arbeitsbereich
  await request.delete('/api/pages', { ...as('ben@test.local'), data: { ids: [id] } });
  expect(await title('ben@test.local')).toEqual([]);
  expect(await title('anna@test.local')).toEqual(['Von Anna']);
  // Groß-/Kleinschreibung der E-Mail spielt keine Rolle
  expect(await title('Anna@Test.Local')).toEqual(['Von Anna']);
  // Einstellungen ebenfalls getrennt
  await request.put('/api/settings', { ...as('anna@test.local'), data: { farbe: 'blau' } });
  expect((await (await request.get('/api/settings', as('anna@test.local'))).json()).farbe).toBe('blau');
  expect((await (await request.get('/api/settings', as('ben@test.local'))).json()).farbe).toBeUndefined();
});

test('Arbeitsbereiche: alte Daten gehören LEGACY_WORKSPACE, mehrere Adressen teilen einen Bereich', async ({ request }) => {
  const me = await (await request.get('/api/me', as('alt@test.local'))).json();
  expect(me).toMatchObject({ workspace: 'legacy-ws', legacy: true, user: 'alt@test.local' });
  expect((await (await request.get('/api/me', as('neu@test.local'))).json())).toMatchObject({ workspace: 'neu@test.local', legacy: false });
  // Seite aus der alten Tabelle, mit ihrer Revision übernommen
  for (const user of ['alt@test.local', 'alt2@test.local']) {
    const rows = (await (await request.get('/api/pages?since=-1', as(user))).json()).pages;
    const legacy = rows.find((r) => r.id === 'legacy-page');
    expect(legacy, user).toBeTruthy();
    expect(legacy.rev).toBe(7);
    expect(JSON.parse(legacy.data).title).toBe('Alte Notiz');
  }
  expect((await (await request.get('/api/settings', as('alt@test.local'))).json()).theme).toBe('dark');
  // Andere sehen sie nicht
  const other = (await (await request.get('/api/pages?since=-1', as('neu@test.local'))).json()).pages;
  expect(other.find((r) => r.id === 'legacy-page')).toBeUndefined();
});

test('Arbeitsbereiche: Gerät mit fremdem Zwischenspeicher wird abgewiesen (409)', async ({ request }) => {
  const id = 'fremd-' + Date.now();
  const r = await request.put('/api/pages', { headers: { 'x-dev-user': 'ben@test.local', 'x-notes-workspace': encodeURIComponent('anna@test.local') }, data: { pages: [{ id, data: pageJson(id, 'x'), updated_at: 1, base_rev: 0 }] } });
  expect(r.status()).toBe(409);
  expect((await r.json()).code).toBe('workspace');
  const j = await (await request.get('/api/pages?ids=' + id, as('ben@test.local'))).json();
  expect(j.pages).toEqual([]);
  // passender Arbeitsbereich → normal
  const ok = await request.get('/api/pages?since=-1', { headers: { 'x-dev-user': 'ben@test.local', 'x-notes-workspace': 'ben%40test.local' } });
  expect(ok.status()).toBe(200);
});

test('Zwei Personen am selben Gerät: Notizen bleiben getrennt', async ({ browser, request }) => {
  const ctx = await browser.newContext();
  await ctx.setExtraHTTPHeaders({ 'x-dev-user': 'rebecca@test.local' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('/#seed-inbox');
  // Neuer Arbeitsbereich bekommt eigene Testnotizen
  await p.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 20 && window.lernraum.syncState === 'saved' && !window.lernraum.dirty.size, null, { timeout: 20000 });
  expect(await p.evaluate(() => window.lernraum.cacheKey)).toBe('cache:api:rebecca@test.local');
  const own = await p.evaluate(() => window.lernraum.createPage({ title: 'Nur Rebecca' }, { navigate: false }).id);
  await p.waitForFunction(() => !window.lernraum.dirty.size && !window.lernraum.uploading.size, null, { timeout: 10000 });
  await p.evaluate(() => window.lernraum.writeCache());
  // Andere Person meldet sich am selben Gerät an (gleicher Browser-Speicher)
  await ctx.setExtraHTTPHeaders({ 'x-dev-user': 'thomas@test.local' });
  await p.reload();
  await p.waitForFunction(() => window.lernraum && window.lernraum.storeReady && window.lernraum.pages.size > 20 && window.lernraum.syncState === 'saved' && !window.lernraum.dirty.size, null, { timeout: 20000 });
  expect(await p.evaluate(() => window.lernraum.cacheKey)).toBe('cache:api:thomas@test.local');
  expect(await p.evaluate((id) => window.lernraum.pages.has(id), own)).toBe(false);
  await expect(p.locator('.sb-scroll, .content').first()).not.toContainText('Nur Rebecca');
  // … und auf dem Server ist Rebeccas Seite nicht bei Thomas gelandet
  const thomas = (await (await request.get('/api/pages?since=-1', as('thomas@test.local'))).json()).pages;
  expect(thomas.find((r) => r.id === own)).toBeUndefined();
  const rebecca = (await (await request.get('/api/pages?ids=' + own, as('rebecca@test.local'))).json()).pages;
  expect(rebecca.length).toBe(1);
  // Zurück zu Rebecca: ihre Seite ist sofort wieder da (aus ihrem Zwischenspeicher)
  await ctx.setExtraHTTPHeaders({ 'x-dev-user': 'rebecca@test.local' });
  await p.reload();
  await p.waitForFunction((id) => window.lernraum && window.lernraum.storeReady && window.lernraum.pages.has(id), own, { timeout: 20000 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('Zwischenspeicher aus der Zeit vor den Arbeitsbereichen: gehört dem alten Bereich, sonst verworfen', async ({ browser }) => {
  const legacyCache = { pages: [{ id: 'cache-only', kind: 'page', title: 'Offline geändert', blocks: [], parentId: null, trashed: 0, order: 1, updatedAt: Date.now() }], known: [], dirty: ['cache-only'], base: {}, baseRev: {}, lastSync: -1, v: 4 };
  const seedCache = async (p) =>
    p.evaluate(async (c) => {
      await new Promise((res, rej) => {
        const r = indexedDB.open('lernraum', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
          const tx = r.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(c, 'cache:api');
          tx.oncomplete = () => { r.result.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        r.onerror = () => rej(r.error);
      });
      localStorage.removeItem('lr:lastWorkspace');
    }, legacyCache);
  // 1) Fremde Person: alter Zwischenspeicher wird nicht übernommen und nichts davon gespeichert
  const c1 = await browser.newContext();
  await c1.setExtraHTTPHeaders({ 'x-dev-user': 'gast@test.local' });
  const p1 = await c1.newPage();
  await p1.goto('/api/health');
  await seedCache(p1);
  await p1.goto('/');
  await p1.waitForFunction(() => window.lernraum && window.lernraum.storeReady && window.lernraum.syncState === 'saved' && !window.lernraum.dirty.size, null, { timeout: 20000 });
  expect(await p1.evaluate(() => window.lernraum.pages.has('cache-only'))).toBe(false);
  await c1.close();
  // 2) Besitzer des alten Bereichs: Offline-Änderung wird übernommen und gespeichert
  const c2 = await browser.newContext();
  await c2.setExtraHTTPHeaders({ 'x-dev-user': 'alt@test.local' });
  const p2 = await c2.newPage();
  await p2.goto('/api/health');
  await seedCache(p2);
  await p2.goto('/');
  await p2.waitForFunction(() => window.lernraum && window.lernraum.storeReady && window.lernraum.pages.has('cache-only') && !window.lernraum.dirty.size && window.lernraum.syncState === 'saved', null, { timeout: 20000 });
  expect(await p2.evaluate(() => window.lernraum.cacheKey)).toBe('cache:api:legacy-ws');
  expect(await p2.evaluate(() => window.lernraum.pages.has('legacy-page'))).toBe(true);
  await c2.close();
});
