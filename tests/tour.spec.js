// Anleitung: Erststart, Blättern (Knöpfe, Tasten, Wischen), Hilfe-Einstiege, Aktionen, reduzierte Bewegung
import { test, expect } from '@playwright/test';
import { openApp, noErrors, uniq } from './helpers.js';

const STEPS = ['willkommen', 'schreiben', 'kuerzel', 'formeln', 'handschrift', 'aufgaben', 'heute', 'lernen', 'claude', 'finden', 'sync', 'fertig'];

// Wie openApp, aber optional mit ?tour=1 (erzwingt die Anleitung trotz Testbrowser)
async function gotoTour(page, { tour = true, hash = '' } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  page.__errors = errors;
  await page.goto(`/?local=${uniq('k')}${tour ? '&tour=1' : ''}${hash ? '#' + hash : ''}`);
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
}

// Frischer Browser-Kontext mit den Geräteeinstellungen des Projekts (eigener Speicher, eigene IndexedDB)
async function freshPage(browser, info, base) {
  const { browserName, launchOptions, trace, screenshot, ...use } = info.project.use;
  const ctx = await browser.newContext({ ...use, baseURL: base });
  return ctx.newPage();
}

const dialog = (page) => page.getByRole('dialog', { name: 'Anleitung' });
const current = (page) => page.locator('.tour-slide:not(.is-leaving)');
const seen = (page) => page.evaluate(() => localStorage.getItem('lr:tourSeen:' + window.lernraum.cacheKey));

async function openTourNow(page) {
  await page.evaluate(() => (location.hash = 'hilfe'));
  await expect(dialog(page)).toBeVisible();
  await expect(current(page)).toHaveAttribute('data-step', 'willkommen');
}

test.describe('Anleitung', () => {
  test('erscheint beim Erststart nach der Startanimation und lässt sich durchblättern', async ({ page }) => {
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    expect(await page.locator('#splash').count()).toBe(0);
    await expect(dialog(page).locator('.tour-next')).toBeFocused();
    const next = dialog(page).locator('.tour-next');
    for (let i = 0; i < STEPS.length; i++) {
      await expect(current(page)).toHaveAttribute('data-step', STEPS[i]);
      await expect(dialog(page).locator('.tour-live')).toHaveText(new RegExp(`^Schritt ${i + 1} von ${STEPS.length}: `));
      // jede Zeitleiste dieses Schritts trifft mindestens ein Element seiner Illustration
      const dead = await current(page).evaluate((slide) => {
        const art = slide.querySelector('.tour-art');
        const pre = `.tour-art[data-step=${art.dataset.step}].is-playing `;
        return [...document.getElementById('tour-anim').sheet.cssRules]
          .filter((r) => r.selectorText && r.selectorText.startsWith(pre))
          .map((r) => r.selectorText.slice(pre.length).replace(/::?(before|after)$/, ''))
          .filter((sel) => !art.querySelector(sel));
      });
      expect(dead).toEqual([]);
      if (i < STEPS.length - 1) await next.click();
    }
    await expect(next).toHaveText(/Los geht/);
    await expect(dialog(page).locator('.tour-skip')).toBeHidden();
    await next.click();
    await expect(dialog(page)).toBeHidden();
    expect(await seen(page)).toBe('true');
    // App ist wieder bedienbar
    expect(await page.evaluate(() => document.getElementById('app').inert)).toBe(false);
    noErrors(page);
  });

  test('erscheint nicht von selbst im Testbrowser ohne ?tour=1', async ({ page }) => {
    await gotoTour(page, { tour: false });
    await page.waitForFunction(() => !document.getElementById('splash'));
    await page.waitForTimeout(2500);
    expect(await page.locator('.tour-backdrop').count()).toBe(0);
    noErrors(page);
  });

  test('Überspringen und Escape schließen und merken sich das', async ({ page }) => {
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    await dialog(page).getByRole('button', { name: 'Überspringen' }).click();
    await expect(dialog(page)).toBeHidden();
    expect(await seen(page)).toBe('true');
    await page.evaluate(() => localStorage.removeItem('lr:tourSeen:' + window.lernraum.cacheKey));
    await openTourNow(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    expect(await seen(page)).toBe('true');
    noErrors(page);
  });

  test('Pfeiltasten, Pos1/Ende und Punkte', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tastatur am Computer');
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('ArrowRight');
    await expect(current(page)).toHaveAttribute('data-step', 'schreiben');
    await page.keyboard.press('ArrowLeft');
    await expect(current(page)).toHaveAttribute('data-step', 'willkommen');
    await page.keyboard.press('End');
    await expect(current(page)).toHaveAttribute('data-step', 'fertig');
    await expect(dialog(page).locator('.tour-skip')).toBeHidden();
    // Pfeil nach rechts auf dem letzten Schritt schließt nicht
    await page.keyboard.press('ArrowRight');
    await expect(dialog(page)).toBeVisible();
    // Browser-Kürzel mit Strg/Alt/⌘ bleiben dem Browser
    await page.keyboard.press('Control+Home');
    await expect(current(page)).toHaveAttribute('data-step', 'fertig');
    await page.keyboard.press('Home');
    await expect(current(page)).toHaveAttribute('data-step', 'willkommen');
    await expect(dialog(page).locator('.tour-back')).toBeHidden();
    await dialog(page).getByRole('button', { name: 'Schritt 7: Heute: dein Tag auf einen Blick' }).click();
    await expect(current(page)).toHaveAttribute('data-step', 'heute');
    await expect(dialog(page).locator('.tour-dot[aria-current="step"]')).toHaveAttribute('aria-label', /^Schritt 7:/);
    // Fokus bleibt im Dialog
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.tour'))).toBe(true);
    }
    noErrors(page);
  });

  test('Wischen mit dem Finger blättert, senkrechtes Ziehen nicht', async ({ page }, info) => {
    test.skip(info.project.name !== 'iphone', 'Touch auf dem iPhone');
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (x0, y0, x1, y1) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * i) / 6 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const vw = page.viewportSize().width;
    const art = await current(page).locator('.tour-art').boundingBox();
    const y = art.y + art.height / 2;
    await swipe(vw * 0.8, y, vw * 0.2, y);
    await expect(current(page)).toHaveAttribute('data-step', 'schreiben');
    await page.waitForTimeout(500);
    await swipe(vw * 0.2, y, vw * 0.8, y);
    await expect(current(page)).toHaveAttribute('data-step', 'willkommen');
    await page.waitForTimeout(500);
    // senkrecht ziehen scrollt die (lange) Folie, ohne zu blättern
    await dialog(page).getByRole('button', { name: /^Schritt 5: / }).click();
    await expect(current(page)).toHaveAttribute('data-step', 'handschrift');
    await page.waitForTimeout(500);
    expect(await current(page).evaluate((el) => el.scrollHeight > el.clientHeight && el.classList.contains('is-more'))).toBe(true);
    const sb = await current(page).boundingBox();
    await swipe(vw / 2, sb.y + sb.height - 20, vw / 2 + 10, sb.y + sb.height - 220);
    await page.waitForTimeout(500);
    await expect(current(page)).toHaveAttribute('data-step', 'handschrift');
    expect(await current(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await dialog(page).getByRole('button', { name: /^Schritt 1: / }).click();
    await expect(current(page)).toHaveAttribute('data-step', 'willkommen');
    // Nach links über den ersten Schritt hinaus: federt zurück
    await swipe(vw * 0.2, y, vw * 0.8, y);
    await page.waitForTimeout(500);
    await expect(current(page)).toHaveAttribute('data-step', 'willkommen');
    noErrors(page);
  });

  test('#hilfe öffnet die Anleitung, Zurück öffnet sie nicht erneut', async ({ page: first, browser }, info) => {
    let page = first;
    await openApp(page);
    await page.evaluate(() => window.lernraum.navigate('seed-inbox'));
    await page.evaluate(() => (location.hash = 'hilfe'));
    await expect(dialog(page)).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe('#seed-inbox');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    // Zurück und wieder vor: die Anleitung kommt nicht noch einmal
    await page.goBack();
    await page.waitForTimeout(400);
    await page.goForward();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => location.hash)).toBe('#seed-inbox');
    expect(await page.locator('.tour-backdrop').count()).toBe(0);
    noErrors(page);
    // direkter Start mit #hilfe (eigener Tab mit eigenem Speicher)
    const p2 = await freshPage(browser, info, new URL(page.url()).origin);
    await openApp(p2, 'hilfe');
    await expect(dialog(p2)).toBeVisible();
    expect(await p2.evaluate(() => location.hash)).not.toBe('#hilfe');
    page = p2;
    noErrors(page);
  });

  test('Einstellungen → Anleitung ansehen', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Seitenleiste am Computer');
    await openApp(page);
    await page.locator('.sidebar .sb-foot .nav-row', { hasText: 'Einstellungen' }).click();
    await expect(page.locator('.modal-settings')).toBeVisible();
    await expect(page.locator('.modal-settings .shortcuts')).toContainText('Anleitung');
    await page.getByRole('button', { name: 'Anleitung ansehen' }).click();
    await expect(page.locator('.modal-settings')).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
    noErrors(page);
  });

  test('„Hilfe“ in der Seitenleiste bzw. Notizen-Übersicht', async ({ page }, info) => {
    const phone = info.project.name === 'iphone';
    await openApp(page, phone ? 'notizen' : '');
    if (info.project.name === 'ipad' && (await page.evaluate(() => document.body.classList.contains('is-compact')))) {
      await page.locator('.navbar .glass-btn[aria-label="Seitenleiste zeigen"]').click();
      await page.waitForTimeout(450);
    }
    const row = page.locator(phone ? '.sb-home .sb-foot .nav-row' : '.sidebar .sb-foot .nav-row', { hasText: 'Hilfe' });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await row.click();
    await expect(dialog(page)).toBeVisible();
    noErrors(page);
  });

  test('Hilfe-Knopf oben in der Seitenleiste', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Seitenleiste am Computer');
    await openApp(page);
    await page.locator('.sidebar .sb-head .glass-btn[aria-label="Hilfe"]').click();
    await expect(dialog(page)).toBeVisible();
    noErrors(page);
  });

  test('Erststart: einmal pro Speicher, nicht nach Neuladen, nicht bei #neu', async ({ page, browser }, info) => {
    // wie ein normaler Browser (ohne Testkennung)
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const key = uniq('first');
    await page.goto(`/?local=${key}`);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    expect(await page.locator('#splash').count()).toBe(0);
    await dialog(page).getByRole('button', { name: 'Überspringen' }).click();
    await expect(dialog(page)).toBeHidden();
    expect(await seen(page)).toBe('true');
    await page.reload();
    await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5 && !document.getElementById('splash'));
    await page.waitForTimeout(1500);
    expect(await page.locator('.tour-backdrop').count()).toBe(0);
    // frischer Browser, Start über den Kurzbefehl #neu: diesmal nicht, und nicht als gesehen gemerkt
    const p2 = await freshPage(browser, info, new URL(page.url()).origin);
    await p2.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    await p2.goto(`/?local=${uniq('neu')}#neu`);
    await p2.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5 && !document.getElementById('splash'));
    await p2.waitForTimeout(1500);
    expect(await p2.locator('.tour-backdrop').count()).toBe(0);
    expect(await seen(p2)).toBe(null);
  });

  test('Taste „?“ öffnet die Anleitung, im Editor nicht', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Tastatur am Computer');
    await openApp(page, 'heute');
    await page.keyboard.press('?');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await page.evaluate(() => window.lernraum.navigate('seed-inbox'));
    const blk = page.locator('.editor-blocks .blk-text').first();
    await blk.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Warum?');
    await expect(blk).toContainText('Warum?');
    await page.waitForTimeout(200);
    expect(await page.locator('.tour-backdrop').count()).toBe(0);
    noErrors(page);
  });

  test('„Beispiel ansehen“ öffnet die Testnotiz, fehlt ohne sie', async ({ page }) => {
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    await dialog(page).getByRole('button', { name: /^Schritt 5: Handschrift mit dem / }).click();
    await expect(current(page)).toHaveAttribute('data-step', 'handschrift');
    await current(page).locator('.tour-action').click();
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => location.hash)).toBe('#seed-handschrift');
    await page.evaluate(() => window.lernraum.trashPage('seed-handschrift'));
    await openTourNow(page);
    await dialog(page).getByRole('button', { name: /^Schritt 5: Handschrift mit dem / }).click();
    await expect(current(page)).toHaveAttribute('data-step', 'handschrift');
    await expect(current(page).locator('.tour-action')).toHaveCount(0);
    // die übrigen Schritte funktionieren weiter
    await dialog(page).locator('.tour-next').click();
    await expect(current(page)).toHaveAttribute('data-step', 'aufgaben');
    noErrors(page);
  });

  test('„Übungsseite anlegen“ legt eine Seite an und öffnet sie', async ({ page }) => {
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    await dialog(page).locator('.tour-next').click();
    await expect(current(page)).toHaveAttribute('data-step', 'schreiben');
    await current(page).getByRole('button', { name: 'Übungsseite anlegen' }).click();
    await expect(dialog(page)).toBeHidden();
    expect(await page.evaluate(() => window.lernraum.currentPage().title)).toBe('Meine erste Notiz');
    await expect(page.locator('.page-title')).toHaveText('Meine erste Notiz');
    noErrors(page);
  });

  test('reduzierte Bewegung zeigt Standbilder', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    const next = dialog(page).locator('.tour-next');
    for (let i = 0; i < STEPS.length; i++) {
      await expect(current(page)).toHaveAttribute('data-step', STEPS[i]);
      // Wechsel ohne Übergang: nur eine Folie im DOM
      await expect(page.locator('.tour-slide')).toHaveCount(1);
      const names = await current(page).evaluate((el) => [...el.querySelectorAll('.tour-art *')].map((x) => getComputedStyle(x).animationName).filter((n) => n !== 'none'));
      expect(names).toEqual([]);
      const scene = current(page).locator('.tour-art .tm-scene');
      if (await scene.count()) expect(await scene.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
      if (i < STEPS.length - 1) await next.click();
    }
    await next.click();
    await expect(dialog(page)).toBeHidden();
    noErrors(page);
  });

  test('passt auf das iPhone ohne waagrechtes Scrollen', async ({ page }, info) => {
    test.skip(info.project.name !== 'iphone', 'nur iPhone');
    await gotoTour(page);
    await expect(dialog(page)).toBeVisible({ timeout: 10000 });
    const vw = page.viewportSize().width;
    const next = dialog(page).locator('.tour-next');
    for (let i = 0; i < STEPS.length; i++) {
      await expect(current(page)).toHaveAttribute('data-step', STEPS[i]);
      await page.waitForTimeout(450);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = await dialog(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
      const cv = await current(page).locator('.tour-canvas').boundingBox();
      expect(cv.x).toBeGreaterThanOrEqual(0);
      expect(cv.x + cv.width).toBeLessThanOrEqual(vw + 0.5);
      // Knöpfe groß genug zum Tippen
      const nb = await next.boundingBox();
      expect(nb.height).toBeGreaterThanOrEqual(44);
      if (i < STEPS.length - 1) await next.click();
    }
    noErrors(page);
  });
});
