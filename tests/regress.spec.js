// Regressionstests für Befunde aus dem Code-Review
import { test, expect } from '@playwright/test';
import { openApp, newPage, pageData } from './helpers.js';

test('Fremdes HTML aus der Zwischenablage wird bereinigt (kein XSS)', async ({ page }) => {
  await openApp(page);
  await newPage(page, 'XSS');
  const evil = encodeURIComponent(JSON.stringify([{ type: 'p', text: 'Hallo<img src=x onerror="window.__pwned=1">', indent: 0 }, { type: 'table', rows: [['<img src=x onerror="window.__pwned=2">']] }, { type: 'evil', text: 'x' }]));
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    dt.setData('text/html', `<div data-lernraum-blocks="${payload}">x</div>`);
    dt.setData('text/plain', 'x');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, evil);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('.editor-blocks img').count()).toBe(0);
  const d = await pageData(page);
  expect(d.blocks.map((b) => b.type)).toEqual(['p', 'table', 'p']);
  expect(d.blocks[0].text).toBe('Hallo');
});

test('Slash-Menü funktioniert nach einer Inline-Formel', async ({ page }) => {
  await openApp(page);
  await newPage(page, 'Formel+Slash');
  await page.keyboard.type('Formel $\\frac{a}{b}$ dann ');
  await page.keyboard.type('/zitat');
  await expect(page.locator('.slash')).toBeVisible();
  await expect(page.locator('.slash-item.active')).toContainText('Zitat');
  await page.keyboard.press('Enter');
  const d = await pageData(page);
  expect(d.blocks[0].text).toContain('data-tex="\\frac{a}{b}"');
  expect(d.blocks[0].text).not.toContain('/zitat');
  expect(d.blocks[1].type).toBe('quote');
});

test('Enter am eingeklappten Toggle lässt die Kinder im Toggle', async ({ page }) => {
  await openApp(page);
  await newPage(page, 'Toggle zu');
  await page.keyboard.type('> Frage');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Kind');
  await page.locator('.blk-tog').click();
  await page.locator('.blk-toggle .blk-text').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Nächste Frage');
  const d = await pageData(page);
  expect(d.blocks.map((b) => [b.type, b.indent, b.text])).toEqual([
    ['toggle', 0, 'Frage'],
    ['p', 1, 'Kind'],
    ['toggle', 0, 'Nächste Frage'],
  ]);
});

test('Einfügen aus Google Docs behält Überschriften und Listen', async ({ page }) => {
  await openApp(page);
  await newPage(page, 'GDocs');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><h2 dir="ltr"><span>Kapitel</span></h2><p dir="ltr"><span>Absatz</span></p><ul><li><p><span>Eins</span></p></li><li><p><span>Zwei</span></p></li></ul></b>');
    dt.setData('text/plain', 'Kapitel\nAbsatz\nEins\nZwei');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const d = await pageData(page);
  expect(d.blocks.slice(0, 4).map((b) => b.type)).toEqual(['h2', 'p', 'ul', 'ul']);
});

test('Suchhervorhebung zerstört keine HTML-Entities', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.lernraum.createPage({ title: 'Tom & Jerry amp' }, { navigate: false }));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.keyboard.type('amp');
  await expect(page.locator('.search-row').first()).toContainText('Tom & Jerry amp');
});

test('Menü schließt per Klick auf den Hintergrund ohne durchzuklicken', async ({ page }) => {
  await openApp(page, 'seed-inbox');
  await page.locator('.cap-btn[aria-label="Seitenmenü"]').click();
  await expect(page.locator('.popover')).toBeVisible();
  const star = await page.locator('.cap-btn[aria-label="Als Favorit markieren"]').boundingBox();
  await page.mouse.click(star.x + star.width / 2, star.y + star.height / 2);
  await expect(page.locator('.popover')).toHaveCount(0);
  expect(await page.evaluate(() => window.lernraum.getPage('seed-inbox').favorite)).toBe(false);
});
