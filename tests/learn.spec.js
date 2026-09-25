import { test, expect } from '@playwright/test';
import { openApp, noErrors } from './helpers.js';

test.describe('Lernen', () => {
  test('Karteikarten lernen: umdrehen und bewerten', async ({ page }) => {
    await openApp(page, 'lernen');
    await expect(page.locator('.large-title')).toHaveText('Lernen');
    const dueBefore = await page.evaluate(() => window.lernraum.dueCardsCount());
    expect(dueBefore).toBeGreaterThan(3);
    await page.locator('.hero-card .btn-prominent').click();
    await expect(page.locator('.study-card')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('.study-card')).toHaveClass(/flipped/);
    await page.locator('.rate-btn', { hasText: 'Gut' }).click();
    await expect(page.locator('.study-count')).toContainText('2 /');
    await page.keyboard.press('Space');
    await page.keyboard.press('4');
    await page.locator('.modal-head .icon-btn').click();
    const dueAfter = await page.evaluate(() => window.lernraum.dueCardsCount());
    expect(dueAfter).toBe(dueBefore - 2);
    noErrors(page);
  });

  test('Karteikarten im Block bearbeiten', async ({ page }) => {
    await openApp(page, 'seed-dbs-vl1');
    const block = page.locator('.fc-block');
    await expect(block.locator('.fc-row')).toHaveCount(3);
    await block.locator('.fc-foot .btn', { hasText: 'Karte hinzufügen' }).click();
    await page.keyboard.type('Was ist SQL?');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Structured Query Language');
    await expect(block.locator('.fc-row')).toHaveCount(4);
    const cards = await page.evaluate(() => window.lernraum.currentPage().blocks.find((b) => b.type === 'flashcards').cards.map((c) => c.q));
    expect(cards[3]).toBe('Was ist SQL?');
  });

  test('Quiz beantworten zeigt Ergebnis', async ({ page }) => {
    await openApp(page, 'seed-la');
    const quiz = page.locator('.quiz');
    await expect(quiz.locator('.quiz-item')).toHaveCount(4);
    await quiz.locator('.quiz-item').nth(0).locator('.quiz-opt').nth(1).click();
    await expect(quiz.locator('.quiz-item').nth(0).locator('.quiz-opt.correct')).toBeVisible();
    await expect(quiz.locator('.quiz-explain.ok')).toBeVisible();
    await quiz.locator('.quiz-item').nth(1).locator('.quiz-opt').nth(0).click();
    await expect(quiz.locator('.quiz-item').nth(1).locator('.quiz-opt.wrong')).toBeVisible();
    await quiz.locator('.quiz-item').nth(2).locator('.quiz-opt').nth(0).click();
    await quiz.locator('.quiz-item').nth(3).locator('.quiz-opt').nth(1).click();
    await expect(quiz.locator('.quiz-result')).toContainText('3 von 4 richtig');
  });

  test('Heute: Abgaben abhaken', async ({ page }) => {
    await openApp(page, 'heute');
    await expect(page.locator('.large-title')).toHaveText('Heute');
    const rows = page.locator('.deadline-row');
    const n = await rows.count();
    expect(n).toBeGreaterThan(2);
    const title = await rows.first().locator('.ios-row-title').textContent();
    await rows.first().locator('.cell-check').click();
    await expect(page.locator('.deadline-row', { hasText: title })).toHaveCount(0);
  });

  test('Fokus-Timer startet und pausiert', async ({ page }) => {
    await openApp(page, 'lernen');
    const t = page.locator('.timer-time');
    await expect(t).toHaveText('25:00');
    await page.locator('.timer-play').click();
    await page.waitForTimeout(2200);
    await expect(t).not.toHaveText('25:00');
    await page.locator('.timer-play').click();
    await page.locator('.segmented button', { hasText: 'Pause' }).first().click();
    await expect(t).toHaveText('05:00');
  });
});
