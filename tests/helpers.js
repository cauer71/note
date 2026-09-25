// Gemeinsame Test-Helfer
import { expect } from '@playwright/test';

let n = 0;
export function uniq(prefix = 't') {
  return `${prefix}${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Öffnet die App mit eigenem lokalen Speicher (IndexedDB-Schlüssel) → Tests sind unabhängig
export async function openApp(page, hash = '', key = uniq('k')) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`/?local=${key}${hash ? '#' + hash : ''}`);
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5 && document.querySelector('.content')?.dataset.rendered === '1');
  page.__errors = errors;
  return { key, errors };
}

export async function newPage(page, title = 'Testseite') {
  await page.evaluate(() => window.lernraum.createPage({}));
  const t = page.locator('.page-title');
  await expect(t).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.editor-blocks .blk-text').first()).toBeFocused();
}

export function blocks(page) {
  return page.locator('.editor-blocks > .blk');
}

export async function pageData(page) {
  return page.evaluate(() => {
    const p = window.lernraum.currentPage();
    return JSON.parse(JSON.stringify(p));
  });
}

export function noErrors(page) {
  expect(page.__errors || [], 'Keine JS-Fehler').toEqual([]);
}

// Wechselt die Datenbank-Ansicht (Klick auf die aktive Ansicht öffnet deren Menü)
export async function selectView(page, name) {
  const tab = page.locator('.dbv-tab', { hasText: name }).first();
  if (!(await tab.getAttribute('class')).includes(' on')) await tab.click();
  await expect(page.locator('.dbv-tab.on', { hasText: name }).first()).toBeVisible();
}
