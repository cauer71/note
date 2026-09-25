// Screenshots für die visuelle Prüfung: node scripts/shots.mjs <ordner> [filter]
import { chromium, devices } from '@playwright/test';
const out = process.argv[2] || 'shots';
const filter = process.argv[3] || '';
const b = await chromium.launch();
const base = 'http://localhost:4173';
const sets = [
  ['iphone', { ...devices['iPhone 15 Pro'] }],
  ['ipad', { ...devices['iPad Pro 11 landscape'] }],
  ['desktop', { viewport: { width: 1360, height: 880 } }],
];
const scenes = [
  ['home', '#notizen'],
  ['today', '#heute'],
  ['learn', '#lernen'],
  ['vl3', '#seed-ana-vl3'],
  ['vl3-scroll', '#seed-ana-vl3', async (p) => { await p.locator('.page-scroll').evaluate((e) => (e.scrollTop = 900)); }],
  ['board', '#seed-aufgaben'],
  ['table', '#seed-aufgaben', async (p) => { await p.locator('.dbv-tab', { hasText: 'Alle' }).click(); }],
  ['cal', '#seed-pruefungen', async (p) => { await p.locator('.dbv-tab', { hasText: 'Kalender' }).click(); }],
  ['gallery', '#seed-leseliste'],
  ['hand', '#seed-handschrift'],
  ['java', '#seed-prog-vl2'],
  ['start', '#seed-start'],
  ['stunden', '#seed-stundenplan'],
  ['row', '#seed-task-2'],
  ['slash', '#seed-inbox', async (p) => { await p.locator('.page-tail').click(); await p.keyboard.type('/'); }],
  ['kb', '#seed-inbox', async (p) => { await p.locator('.blk-text').first().click(); }],
  ['settings', '#heute', async (p) => { await p.evaluate(() => import('./x').catch(() => {})); await p.evaluate(() => document.querySelector('.sb-head-actions .glass-btn, .notes-home .glass-btn')?.click()); }],
  ['search', '#heute', async (p) => { await p.keyboard.press('Control+k'); await p.keyboard.type('Grenz'); }],
  ['study', '#lernen', async (p) => { await p.locator('.hero-card .btn-prominent').click(); await p.waitForTimeout(200); await p.keyboard.press('Space'); }],
  ['tpl', '#heute', async (p) => { await p.evaluate(() => window.lernraum && document.querySelector('.nav-row:nth-child(4)')?.click()); }],
  ['pagemenu', '#seed-ana-vl3', async (p) => { await p.locator('.cap-btn[aria-label="Seitenmenü"]').click(); }],
];
for (const [dev, opts] of sets) {
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ ...opts, ignoreHTTPSErrors: true, colorScheme: theme });
    const p = await ctx.newPage();
    for (const [name, hash, act] of scenes) {
      const id = `${dev}-${theme}-${name}`;
      if (filter && !new RegExp(filter).test(id)) continue;
      await p.goto('about:blank');
      await p.goto(`${base}/?local=shots-${dev}-${theme}${hash}`);
      await p.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
      await p.waitForTimeout(700);
      if (act) { try { await act(p); } catch (e) { console.log(id, 'Aktion fehlgeschlagen', e.message.split('\n')[0]); } await p.waitForTimeout(450); }
      await p.screenshot({ path: `${out}/${id}.png` });
    }
    await ctx.close();
  }
}
await b.close();
console.log('fertig');
