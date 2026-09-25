import { test, expect } from '@playwright/test';
import { openApp, noErrors, selectView } from './helpers.js';

test.describe('Datenbanken', () => {
  test('Tabelle: Zeile anlegen, Titel, Auswahl und Datum setzen', async ({ page }) => {
    await openApp(page, 'seed-aufgaben');
    await selectView(page, 'Alle');
    await expect(page.locator('.dbt-row')).toHaveCount(10);
    await page.locator('.dbt-foot .btn', { hasText: 'Neue Zeile' }).click();
    await expect(page.locator('.dbt-row')).toHaveCount(11);
    const input = page.locator('.cell-title-input:focus');
    await input.fill('Neue Abgabe');
    const row = page.locator('.dbt-row', { has: page.locator('input[value="Neue Abgabe"], .cell-title-input:focus') }).last();
    // Auswahl "Fach"
    const rowId = await row.getAttribute('data-row');
    await row.locator('.dbt-td-select .cell-select').first().click();
    await page.locator('.select-menu .menu-item', { hasText: 'Datenbanken' }).click();
    const fach = await page.evaluate((id) => {
      const r = window.lernraum.getPage(id);
      const db = window.lernraum.getPage(r.parentId);
      const p = db.db.properties.find((x) => x.name === 'Fach');
      return p.options.find((o) => o.id === r.props[p.id])?.name;
    }, rowId);
    expect(fach).toBe('Datenbanken');
    // Datum
    await page.locator(`.dbt-row[data-row="${rowId}"] .cell-date`).fill('2026-10-20');
    const date = await page.evaluate((id) => {
      const r = window.lernraum.getPage(id);
      const db = window.lernraum.getPage(r.parentId);
      const p = db.db.properties.find((x) => x.name === 'Fällig');
      return r.props[p.id];
    }, rowId);
    expect(date).toBe('2026-10-20');
    // Neue Option über die Suche anlegen
    await page.locator(`.dbt-row[data-row="${rowId}"] .dbt-td-select .cell-select`).nth(2).click();
    await page.locator('.select-menu .menu-search').fill('Sehr hoch');
    await page.keyboard.press('Enter');
    const prio = await page.evaluate((id) => {
      const r = window.lernraum.getPage(id);
      const db = window.lernraum.getPage(r.parentId);
      const p = db.db.properties.find((x) => x.name === 'Priorität');
      return p.options.find((o) => o.id === r.props[p.id])?.name;
    }, rowId);
    expect(prio).toBe('Sehr hoch');
    noErrors(page);
  });

  test('Board: Karte in andere Spalte ziehen ändert den Status', async ({ page }) => {
    await openApp(page, 'seed-aufgaben');
    await selectView(page, 'Board');
    const card = page.locator('.board-card', { hasText: 'FizzBuzz' });
    const target = page.locator('.board-col', { hasText: 'Erledigt' });
    const a = await card.boundingBox();
    const b = await target.boundingBox();
    await page.mouse.move(a.x + 30, a.y + 20);
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 40, { steps: 5 });
    await page.mouse.move(b.x + 80, b.y + 60, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.board-col', { hasText: 'Erledigt' }).locator('.board-card', { hasText: 'FizzBuzz' })).toBeVisible();
    const status = await page.evaluate(() => {
      const r = window.lernraum.getPage('seed-task-3');
      const db = window.lernraum.getPage(r.parentId);
      const p = db.db.properties.find((x) => x.name === 'Status');
      return p.options.find((o) => o.id === r.props[p.id])?.name;
    });
    expect(status).toBe('Erledigt');
  });

  test('Board: Klick öffnet die Zeile als Seite mit Eigenschaften', async ({ page }) => {
    await openApp(page, 'seed-aufgaben');
    await selectView(page, 'Board');
    await page.locator('.board-card', { hasText: 'Übungsblatt 2 – Folgen' }).click();
    await expect(page.locator('.page-title')).toHaveText('Übungsblatt 2 – Folgen');
    await expect(page.locator('.row-props')).toContainText('Fach');
    await expect(page.locator('.row-props')).toContainText('Analysis I');
    await expect(page.locator('.blk-todo')).toHaveCount(3);
    await page.locator('.row-db-link').click();
    await expect(page.locator('.page-title')).toHaveText('Aufgaben & Abgaben');
  });

  test('Kalender zeigt Einträge und wechselt Monate', async ({ page }) => {
    await openApp(page, 'seed-pruefungen');
    await selectView(page, 'Kalender');
    await expect(page.locator('.cal-grid')).toBeVisible();
    for (let i = 0; i < 5; i++) {
      if (await page.locator('.cal-item', { hasText: 'Analysis I – Klausur' }).count()) break;
      await page.locator('.cal-nav .icon-btn[aria-label="Nächster Monat"]').click();
    }
    await expect(page.locator('.cal-item', { hasText: 'Analysis I – Klausur' })).toBeVisible();
    await expect(page.locator('.cal-month')).toContainText('Februar');
  });

  test('Filter und Sortierung', async ({ page }) => {
    await openApp(page, 'seed-aufgaben');
    await selectView(page, 'Alle');
    await page.locator('.dbv-actions .icon-btn[aria-label="Filter"]').click();
    await page.locator('.filter-pop .btn', { hasText: 'Filter hinzufügen' }).click();
    // erste Eigenschaft ist "Fach" (Auswahl) → Wert wählen
    const selects = page.locator('.filter-pop .filter-row select');
    await selects.nth(2).selectOption({ label: 'Analysis I' });
    await expect(page.locator('.dbt-row')).toHaveCount(3);
    await page.keyboard.press('Escape');
    // Suche
    await page.locator('.dbv-search-input').fill('Reihen');
    await expect(page.locator('.dbt-row')).toHaveCount(1);
  });

  test('Neue Eigenschaft hinzufügen und Ansicht ergänzen', async ({ page }) => {
    await openApp(page, 'seed-leseliste');
    await expect(page.locator('.gallery-card')).toHaveCount(5);
    await selectView(page, 'Tabelle');
    await page.locator('.dbt-th-add .icon-btn').click();
    await page.locator('.menu-item', { hasText: 'Zahl' }).click();
    await page.locator('.modal .input').fill('Seiten');
    await page.locator('.modal .btn-primary').click();
    await expect(page.locator('.dbt-head', { hasText: 'Seiten' })).toBeVisible();
    await page.locator('.dbv-tab-add').click();
    await page.locator('.menu-item', { hasText: 'Liste' }).click();
    await expect(page.locator('.db-list-row')).toHaveCount(4);
  });

  test('Inline-Datenbank über den Slash-Befehl', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.lernraum.createPage({}));
    await page.keyboard.type('DB-Test');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/datenbank');
    await page.keyboard.press('Enter');
    await expect(page.locator('.db-inline .dbv')).toBeVisible();
    await page.locator('.db-inline .dbt-foot .btn').click();
    await expect(page.locator('.db-inline .dbt-row')).toHaveCount(1);
  });
});
