// Web-App: Startanimation, Manifest, Symbole, Startbilder, Kurzbefehle
import { test, expect } from '@playwright/test';
import { openApp, uniq } from './helpers.js';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('Startanimation läuft und verschwindet, sobald die App bereit ist', async ({ page }) => {
  await page.goto(`/?local=${uniq('sp')}#heute`, { waitUntil: 'commit' });
  const splash = page.locator('#splash');
  await expect(splash).toBeAttached();
  expect(await splash.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content)).toBe('#5856d6');
  await expect(splash).toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('.large-title', { hasText: 'Heute' })).toBeVisible();
  // Danach wieder die normale Statusleistenfarbe
  expect(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content)).toBe('#f2f2f7');
  expect(await page.evaluate(() => document.documentElement.classList.contains('splashing'))).toBe(false);
});

test('Startanimation blockiert keine Eingaben', async ({ page }) => {
  await page.goto(`/?local=${uniq('sp')}#heute`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
  // Solange der Splash noch da ist, gehen Klicks an die App darunter
  const tab = page.locator('.nav-row', { hasText: 'Lernen' }).first();
  await tab.click();
  await expect(page.locator('.large-title', { hasText: 'Lernen' })).toBeVisible();
});

test('Manifest: installierbar auf Android (Symbole, maskable, Screenshots, Kurzbefehle)', async ({ page, request }) => {
  await page.goto('/?local=' + uniq('mf'));
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const m = await (await request.get(href)).json();
  expect(m.name).toBe('Notes');
  expect(m.short_name).toBe('Notes');
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/');
  expect(m.id).toBe('/');
  const sizes = (purpose) => m.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
  expect(sizes('any')).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(sizes('maskable')).toEqual(['192x192', '512x512']);
  expect(m.screenshots.some((s) => s.form_factor === 'wide')).toBe(true);
  expect(m.screenshots.some((s) => s.form_factor === 'narrow')).toBe(true);
  expect(m.shortcuts.map((s) => s.url)).toEqual(['/#neu', '/#heute', '/#lernen', '/#suche']);
  // Alle referenzierten Bilder existieren und sind Bilder
  const urls = [...m.icons, ...m.screenshots, ...m.shortcuts.flatMap((s) => s.icons)].map((i) => i.src);
  for (const u of urls) {
    const r = await request.get(u);
    expect(r.ok(), u).toBe(true);
    expect(r.headers()['content-type'], u).toMatch(/^image\//);
  }
});

test('iOS: Home-Bildschirm-Symbol, Titel und Startbilder für alle Geräte', async ({ page, request }) => {
  await page.goto('/?local=' + uniq('ios'));
  expect(await page.title()).toBe('Notes');
  expect(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content')).toBe('Notes');
  const icon = await request.get(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'));
  expect(icon.ok()).toBe(true);
  const links = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), media: e.media })));
  expect(links.length).toBeGreaterThanOrEqual(25);
  // iPhone 17 Pro (402×874 @3x) und iPad Pro 13" quer haben ein passendes Bild
  expect(links.some((l) => l.media.includes('device-width: 402px') && l.media.includes('portrait'))).toBe(true);
  expect(links.some((l) => l.media.includes('device-width: 1032px') && l.media.includes('landscape'))).toBe(true);
  for (const l of links.slice(0, 3)) expect((await request.get(l.href)).ok()).toBe(true);
});

test('Kurzbefehl „Neue Notiz“ (#neu) legt genau eine Seite an', async ({ page }) => {
  const key = uniq('neu');
  await openApp(page, '', key);
  const before = await page.evaluate(() => window.lernraum.pages.size);
  await page.goto(`/?local=${key}#neu`);
  await page.waitForFunction((n) => window.lernraum && window.lernraum.pages.size === n + 1, before);
  await expect(page.locator('.page-title')).toBeFocused();
  const hash = await page.evaluate(() => location.hash);
  expect(hash).not.toBe('#neu');
  expect(await page.evaluate((h) => window.lernraum.pages.has(h.slice(1)), hash)).toBe(true);
  // Zurück führt nicht erneut zu #neu
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.lernraum.pages.size)).toBe(before + 1);
});

test('Kurzbefehl „Suchen“ (#suche) öffnet die Suche', async ({ page }) => {
  await openApp(page, 'suche');
  await expect(page.locator('.search-input, input[type="search"]').first()).toBeVisible();
});

test('App heißt Notes (Logo, Name, Einstellungen)', async ({ page }) => {
  await openApp(page, 'heute');
  await expect(page.locator('.sb-logo svg').first()).toBeAttached();
  await expect(page.locator('.sb-name').first()).toHaveText('Notes');
});

test('Version steht in der App (Seitenleiste, Einstellungen, HTML)', async ({ page }) => {
  await openApp(page, 'heute');
  expect(await page.locator('meta[name="app-version"]').getAttribute('content')).toBe(VERSION);
  const side = page.locator('.sidebar-version').first();
  await expect(side).toContainText(`Version ${VERSION}`);
  await expect(side).toHaveText(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
  await page.locator('.sb-foot .nav-row', { hasText: 'Einstellungen' }).first().click();
  await expect(page.locator('.settings-version')).toContainText(`Notes · Version ${VERSION}`);
});
