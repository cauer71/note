import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test.describe('Touch (iPhone / iPad)', () => {
  test('Navigation, Tastatur-Leiste und Blöcke per Touch', async ({ page, isMobile }, info) => {
    await openApp(page);
    const phone = info.project.name === 'iphone';
    if (phone) {
      await expect(page.locator('.tabbar .tab.on')).toContainText('Notizen');
      await page.locator('.notes-home .tree-main', { hasText: 'Lernmethoden' }).tap();
    } else {
      await page.locator('.sidebar .tree-main', { hasText: 'Lernmethoden' }).tap();
    }
    await expect(page.locator('.page-title')).toHaveText('Lernmethoden, die funktionieren');
    // Seiten-Leiste unten sichtbar (Touch)
    await expect(page.locator('.page-toolbar')).toBeVisible();
    // Block antippen → Tastatur-Leiste erscheint
    await page.locator('.blk-text').nth(1).tap();
    await expect(page.locator('.kb-bar')).toBeVisible();
    await expect(page.locator('.page-toolbar')).toBeHidden();
    // Checkliste über die Leiste
    await page.locator('.kb-btn[aria-label="Checkliste"]').tap();
    const t = await page.evaluate(() => window.lernraum.currentPage().blocks[1].type);
    expect(t).toBe('todo');
    // Block nach oben verschieben
    const before = await page.evaluate(() => window.lernraum.currentPage().blocks.map((b) => b.id));
    await page.locator('.kb-btn[aria-label="Nach oben"]').tap();
    const after = await page.evaluate(() => window.lernraum.currentPage().blocks.map((b) => b.id));
    expect(after[0]).toBe(before[1]);
    // Tastatur schließen
    await page.locator('.kb-btn[aria-label="Tastatur schließen"]').tap();
    await expect(page.locator('.kb-bar')).toBeHidden();
    if (phone) {
      await page.locator('.nav-back').tap();
      await expect(page.locator('.notes-home')).toBeVisible();
      await page.locator('.tabbar .tab', { hasText: 'Heute' }).tap();
      await expect(page.locator('.large-title')).toHaveText('Heute');
      await page.locator('.tabbar .tab', { hasText: 'Lernen' }).tap();
      await expect(page.locator('.large-title')).toHaveText('Lernen');
    }
    void isMobile;
  });

  test('Block-Auswahl über „+“ als Bottom-Sheet', async ({ page }, info) => {
    await openApp(page, 'seed-inbox');
    await page.locator('.page-toolbar .pt-btn[aria-label="Block"]').tap();
    const sheet = page.locator('.popover');
    await expect(sheet).toBeVisible();
    if (info.project.name === 'iphone') await expect(sheet).toHaveClass(/sheet/);
    await sheet.locator('.menu-item', { hasText: 'Hinweis' }).tap();
    const last = await page.evaluate(() => window.lernraum.currentPage().blocks.filter((b) => b.type === 'callout').length);
    expect(last).toBe(1);
  });

  test('Handschrift über die Seiten-Leiste einfügen', async ({ page }) => {
    await openApp(page, 'seed-inbox');
    await page.locator('.page-toolbar .pt-btn[aria-label="Stift"]').tap();
    await expect(page.locator('.draw-block')).toBeVisible();
  });

  test('Suche über den Such-Button', async ({ page }, info) => {
    await openApp(page);
    if (info.project.name === 'iphone') await page.locator('.tab-search').tap();
    else await page.locator('.sidebar .search-field').tap();
    await expect(page.locator('.search-input')).toBeVisible();
    await page.locator('.search-input').fill('Matrizen');
    await expect(page.locator('.search-row', { hasText: 'Lineare Algebra' })).toBeVisible();
    await expect(page.locator('.search-row').first()).toContainText('Matrizen');
  });

  test('Kein horizontales Scrollen der Seite', async ({ page }) => {
    for (const hash of ['seed-ana-vl3', 'seed-aufgaben', 'seed-stundenplan', 'heute', 'lernen']) {
      await openApp(page, hash);
      const overflow = await page.evaluate(() => {
        const sc = document.querySelector('.page-scroll');
        return sc.scrollWidth - sc.clientWidth;
      });
      expect(overflow, hash).toBeLessThanOrEqual(1);
    }
  });
});
