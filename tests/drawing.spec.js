import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Simuliert einen Apple-Pencil-Strich mit Druck
async function penStroke(page, surface, points, pointerType = 'pen') {
  await surface.evaluate(
    (el, { points, pointerType }) => {
      const r = el.getBoundingClientRect();
      const ev = (type, [x, y, p]) =>
        new PointerEvent(type, { pointerId: 7, pointerType, isPrimary: true, clientX: r.left + x, clientY: r.top + y, pressure: p, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true });
      el.dispatchEvent(ev('pointerdown', points[0]));
      for (const pt of points.slice(1)) el.dispatchEvent(ev('pointermove', pt));
      el.dispatchEvent(ev('pointerup', points[points.length - 1]));
    },
    { points, pointerType }
  );
}

test.describe('Handschrift', () => {
  test('Stift zeichnet mit Druck, Finger nicht, Radierer und Rückgängig', async ({ page }) => {
    await openApp(page, 'seed-handschrift');
    const surface = page.locator('.draw-surface').nth(1);
    await surface.scrollIntoViewIfNeeded();
    const count = () => page.evaluate(() => window.lernraum.currentPage().blocks.filter((b) => b.type === 'drawing')[1].strokes.length);
    expect(await count()).toBe(0);
    const pts = Array.from({ length: 30 }, (_, i) => [40 + i * 8, 80 + Math.sin(i / 3) * 20, 0.2 + (i / 30) * 0.7]);
    await penStroke(page, surface, pts, 'pen');
    expect(await count()).toBe(1);
    const stroke = await page.evaluate(() => window.lernraum.currentPage().blocks.filter((b) => b.type === 'drawing')[1].strokes[0]);
    expect(stroke.t).toBe('pen');
    const pressures = stroke.p.filter((_, i) => i % 3 === 2);
    expect(Math.max(...pressures) - Math.min(...pressures)).toBeGreaterThan(20);
    // Finger zeichnet nicht, nachdem ein Stift erkannt wurde (Palm Rejection)
    await penStroke(page, surface, pts.map(([x, y]) => [x, y + 100, 0]), 'touch');
    expect(await count()).toBe(1);
    // Radierer
    await page.locator('.draw-block').nth(1).locator('.draw-tool[data-tool="eraser"]').click();
    await penStroke(page, surface, [[80, 90, 0.5], [120, 90, 0.5], [160, 90, 0.5]], 'pen');
    expect(await count()).toBe(0);
    await page.locator('.draw-block').nth(1).locator('.draw-tool[aria-label="Rückgängig"]').click();
    expect(await count()).toBe(1);
    // Stift wieder wählen, Marker
    await page.locator('.draw-block').nth(1).locator('.draw-tool[data-tool="hl"]').click();
    await penStroke(page, surface, [[20, 200, 0.5], [300, 200, 0.5]], 'pen');
    expect(await count()).toBe(2);
    const last = await page.evaluate(() => window.lernraum.currentPage().blocks.filter((b) => b.type === 'drawing')[1].strokes[1]);
    expect(last.t).toBe('hl');
  });

  test('Zeichnung wächst nach unten und Papier lässt sich wechseln', async ({ page }) => {
    await openApp(page, 'seed-handschrift');
    await page.evaluate(() => localStorage.setItem('lr:tool', JSON.stringify({ tool: 'pen', ink: 'blue', hl: 'yellow', size: 1, finger: false })));
    const block = page.locator('.draw-block').nth(1);
    await block.scrollIntoViewIfNeeded();
    const surface = block.locator('.draw-surface');
    const h0 = await page.evaluate(() => window.lernraum.currentPage().blocks.filter((b) => b.type === 'drawing')[1].h);
    const box = await surface.boundingBox();
    const bottom = box.height - 10;
    await penStroke(page, surface, [[50, bottom - 40, 0.5], [90, bottom, 0.5]], 'mouse');
    const h1 = await page.evaluate(() => window.lernraum.currentPage().blocks.filter((b) => b.type === 'drawing')[1].h);
    expect(h1).toBeGreaterThan(h0);
    await block.locator('.draw-tool[aria-label="Weitere Optionen"]').click();
    await page.locator('.menu-item', { hasText: 'Kariert' }).click();
    await expect(surface).toHaveClass(/bg-grid/);
  });

  test('Vollbild-Modus zum Schreiben', async ({ page }) => {
    await openApp(page, 'seed-handschrift');
    const block = page.locator('.draw-block').first();
    await block.locator('.draw-tool[aria-label="Vollbild"]').click();
    await expect(block).toHaveClass(/draw-fullscreen/);
    await block.locator('.draw-tool[aria-label="Vollbild beenden"]').click();
    await expect(block).not.toHaveClass(/draw-fullscreen/);
  });
});
