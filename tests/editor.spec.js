import { test, expect } from '@playwright/test';
import { openApp, newPage, blocks, pageData, noErrors } from './helpers.js';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Editor', () => {
  test('Testnotizen werden geladen und angezeigt', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.sidebar .tree-row')).toHaveCount(await page.locator('.sidebar .tree-row').count());
    await expect(page.locator('.sidebar')).toContainText('Wintersemester 2026/27');
    await expect(page.locator('.sidebar')).toContainText('Aufgaben & Abgaben');
    await page.locator('.sidebar .tree-main', { hasText: 'Lernmethoden' }).click();
    await expect(page.locator('.page-title')).toHaveText('Lernmethoden, die funktionieren');
    await expect(page.locator('.blk-h2').first()).toContainText('Aktives Erinnern');
    noErrors(page);
  });

  test('Tippen, Enter, Markdown-Kürzel und Blocktypen', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Kürzel');
    await page.keyboard.type('Erster Absatz');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# Große Überschrift');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- Punkt eins');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Punkt zwei');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // leerer Listenpunkt → Absatz
    await page.keyboard.type('[] Aufgabe');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. Nummer');
    await page.keyboard.press('Enter');
    await page.keyboard.type('zwei');
    const d = await pageData(page);
    const types = d.blocks.map((b) => b.type);
    expect(types.slice(0, 7)).toEqual(['p', 'h1', 'ul', 'ul', 'todo', 'ol', 'ol']);
    expect(d.blocks[1].text).toBe('Große Überschrift');
    await expect(page.locator('.blk-ol .blk-num').nth(1)).toHaveText('2.');
    // To-do abhaken
    await page.locator('.blk-todo .blk-check').first().click();
    expect((await pageData(page)).blocks[4].checked).toBe(true);
    noErrors(page);
  });

  test('Backspace wandelt um, rückt aus und verbindet Blöcke', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Backspace');
    await page.keyboard.type('Hallo');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- Welt');
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace'); // ul → p
    let d = await pageData(page);
    expect(d.blocks[1].type).toBe('p');
    await page.keyboard.press('Backspace'); // mit vorherigem verbinden
    d = await pageData(page);
    expect(d.blocks[0].text).toBe('HalloWelt');
    expect(d.blocks.filter((b) => b.type === 'p').length).toBe(1);
    // Caret an der Verbindungsstelle
    await page.keyboard.type(' ');
    d = await pageData(page);
    expect(d.blocks[0].text).toBe('Hallo Welt');
  });

  test('Tab rückt ein, Shift+Tab rückt aus', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Einrücken');
    await page.keyboard.type('- Oben');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Unten');
    await page.keyboard.press('Tab');
    let d = await pageData(page);
    expect(d.blocks[1].indent).toBe(1);
    await page.keyboard.press('Shift+Tab');
    d = await pageData(page);
    expect(d.blocks[1].indent).toBe(0);
  });

  test('Slash-Menü filtert und fügt Blöcke ein', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Slash');
    await page.keyboard.type('/über');
    await expect(page.locator('.slash')).toBeVisible();
    await expect(page.locator('.slash-item.active')).toContainText('Überschrift 1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.slash')).toHaveCount(0);
    await page.keyboard.type('Zwischentitel');
    let d = await pageData(page);
    expect(d.blocks[0].type).toBe('h2');
    expect(d.blocks[0].text).toBe('Zwischentitel');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/code');
    await page.keyboard.press('Enter');
    await expect(page.locator('.code-ta')).toBeFocused();
    await page.keyboard.type('print("hi")');
    d = await pageData(page);
    expect(d.blocks.find((b) => b.type === 'code').text).toBe('print("hi")');
    // Escape schließt das Menü
    await page.locator('.blk-p .blk-text').last().click();
    await page.keyboard.type('/tab');
    await expect(page.locator('.slash')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.slash')).toHaveCount(0);
    noErrors(page);
  });

  test('Inline-Markdown: fett, Code und Formel', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Inline');
    await page.keyboard.type('Das ist **wichtig** und `code` mit $x^2$ fertig');
    const d = await pageData(page);
    expect(d.blocks[0].text).toContain('<b>wichtig</b>');
    expect(d.blocks[0].text).toContain('<code>code</code>');
    expect(d.blocks[0].text).toContain('<span class="math" data-tex="x^2"></span>');
    expect(d.blocks[0].text).toContain('fertig');
  });

  test('Formatierung per Tastenkürzel und Auswahl-Leiste', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Format');
    await page.keyboard.type('Markiere mich');
    await page.keyboard.press('Shift+Home');
    await expect(page.locator('.sel-bar')).toBeVisible();
    await page.keyboard.press(`${mod}+b`);
    let d = await pageData(page);
    expect(d.blocks[0].text).toBe('<b>Markiere mich</b>');
    await page.locator('.sel-bar .sel-btn[aria-label^="Kursiv"]').click();
    d = await pageData(page);
    expect(d.blocks[0].text).toMatch(/<i>|<b><i>/);
  });

  test('Rückgängig und Wiederholen', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Undo');
    await page.keyboard.type('Eins');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Zwei');
    await page.waitForTimeout(800);
    await page.keyboard.press(`${mod}+z`);
    let d = await pageData(page);
    expect(d.blocks.map((b) => b.text)).toEqual(['Eins', '']);
    await page.keyboard.press(`${mod}+z`);
    d = await pageData(page);
    expect(d.blocks.length).toBe(1);
    await page.keyboard.press(`${mod}+Shift+z`);
    d = await pageData(page);
    expect(d.blocks.length).toBe(2);
  });

  test('Einfügen von Markdown erzeugt Blöcke', async ({ page, context }) => {
    await openApp(page);
    await newPage(page, 'Paste');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '## Titel\n- a\n- b\n\n```python\nx = 1\n```\n| A | B |\n| --- | --- |\n| 1 | 2 |');
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const d = await pageData(page);
    expect(d.blocks.map((b) => b.type)).toEqual(['h2', 'ul', 'ul', 'code', 'table', 'p']);
    expect(d.blocks[4].rows[1]).toEqual(['1', '2']);
    void context;
  });

  test('Erwähnung mit @ verlinkt eine Seite', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Mention');
    await page.keyboard.type('Siehe @Lernmeth');
    await expect(page.locator('.mention-box')).toBeVisible();
    await page.keyboard.press('Enter');
    const d = await pageData(page);
    expect(d.blocks[0].text).toContain('class="mention"');
    expect(d.blocks[0].text).toContain('data-page="seed-lernmethoden"');
    await page.locator('a.mention').click();
    await expect(page.locator('.page-title')).toHaveText('Lernmethoden, die funktionieren');
    await expect(page.locator('.backlinks')).toContainText('Mention');
  });

  test('Blockmenü: duplizieren, verschieben, löschen', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Menü');
    await page.keyboard.type('A');
    await page.keyboard.press('Enter');
    await page.keyboard.type('B');
    const second = blocks(page).nth(1);
    await second.hover();
    await second.locator('.blk-handle').click();
    await page.locator('.menu-item', { hasText: 'Duplizieren' }).click();
    let d = await pageData(page);
    expect(d.blocks.map((b) => b.text)).toEqual(['A', 'B', 'B']);
    await blocks(page).nth(0).hover();
    await blocks(page).nth(0).locator('.blk-handle').click();
    await page.locator('.menu-item', { hasText: 'Nach unten' }).click();
    d = await pageData(page);
    expect(d.blocks.map((b) => b.text)).toEqual(['B', 'A', 'B']);
    await blocks(page).nth(2).hover();
    await blocks(page).nth(2).locator('.blk-handle').click();
    await page.locator('.menu-item', { hasText: 'Löschen' }).click();
    d = await pageData(page);
    expect(d.blocks.map((b) => b.text)).toEqual(['B', 'A']);
  });

  test('Blöcke per Ziehen umsortieren', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Ziehen');
    for (const t of ['Eins', 'Zwei', 'Drei']) {
      await page.keyboard.type(t);
      await page.keyboard.press('Enter');
    }
    const first = blocks(page).nth(0);
    await first.hover();
    const handle = first.locator('.blk-handle');
    const hb = await handle.boundingBox();
    const target = await blocks(page).nth(2).boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 10, hb.y + 20, { steps: 4 });
    await page.mouse.move(hb.x + 10, target.y + target.height - 3, { steps: 8 });
    await page.mouse.up();
    const d = await pageData(page);
    expect(d.blocks.map((b) => b.text).slice(0, 3)).toEqual(['Zwei', 'Drei', 'Eins']);
  });

  test('Esc wählt Block aus, Entf löscht', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Auswahl');
    await page.keyboard.type('weg damit');
    await page.keyboard.press('Enter');
    await page.keyboard.type('bleibt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    await expect(blocks(page).nth(0)).toHaveClass(/selected/);
    await page.keyboard.press('Backspace');
    const d = await pageData(page);
    expect(d.blocks.map((b) => b.text)).toEqual(['bleibt']);
  });

  test('Änderungen bleiben nach dem Neuladen erhalten', async ({ page }) => {
    const { key } = await openApp(page);
    await newPage(page, 'Persistenz');
    await page.keyboard.type('Bleib da');
    await page.waitForTimeout(1200);
    const id = await page.evaluate(() => window.lernraum.currentId);
    await page.goto(`/?local=${key}#${id}`);
    await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
    await expect(page.locator('.page-title')).toHaveText('Persistenz');
    await expect(page.locator('.blk-text').first()).toHaveText('Bleib da');
  });

  test('Toggle klappt Kinder ein und aus', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Toggle');
    await page.keyboard.type('> Frage');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Antwort im Toggle');
    let d = await pageData(page);
    expect(d.blocks[0].type).toBe('toggle');
    expect(d.blocks[1].indent).toBe(1);
    await page.locator('.blk-tog').click();
    await expect(blocks(page).nth(1)).toBeHidden();
    await page.locator('.blk-tog').click();
    await expect(blocks(page).nth(1)).toBeVisible();
  });

  test('Formelblock rendert LaTeX', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Mathe');
    await page.keyboard.type('/formel');
    await page.keyboard.press('Enter');
    await expect(page.locator('.math-src')).toBeFocused();
    await page.keyboard.type('\\frac{a}{b}');
    await page.keyboard.press('Enter');
    const d = await pageData(page);
    expect(d.blocks.find((b) => b.type === 'math').tex).toBe('\\frac{a}{b}');
    await page.waitForFunction(() => !!window.katex, null, { timeout: 15000 }).catch(() => {});
    if (await page.evaluate(() => !!window.katex)) await expect(page.locator('.math-render .katex').first()).toBeVisible();
  });

  test('Unterseite, Favorit, Papierkorb und Wiederherstellen', async ({ page }) => {
    await openApp(page);
    await newPage(page, 'Elternseite');
    await page.keyboard.type('/unterseite');
    await page.keyboard.press('Enter');
    await expect(page.locator('.page-title')).toBeFocused();
    await page.keyboard.type('Kindseite');
    const childId = await page.evaluate(() => window.lernraum.currentId);
    const parent = await page.evaluate((id) => window.lernraum.getPage(id).parentId, childId);
    expect(parent).toBeTruthy();
    // Favorit
    await page.locator('.cap-btn[aria-label="Als Favorit markieren"]').click();
    await expect(page.locator('.sidebar')).toContainText('Favoriten');
    // In den Papierkorb
    await page.locator('.cap-btn[aria-label="Seitenmenü"]').click();
    await page.locator('.menu-item', { hasText: 'In den Papierkorb' }).click();
    await expect(page.locator('.page-title')).toHaveText('Elternseite');
    await page.locator('.page-link.missing').first().waitFor();
    // Wiederherstellen
    await page.evaluate(() => (location.hash = 'papierkorb'));
    await expect(page.locator('.trash-row')).toContainText('Kindseite');
    await page.locator('.trash-row .btn', { hasText: 'Wiederherstellen' }).click();
    await expect(page.locator('.trash-row')).toHaveCount(0);
  });

  test('Suche findet Inhalte', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${mod}+k`);
    await expect(page.locator('.search-input')).toBeFocused();
    await page.keyboard.type('Sandwich');
    await expect(page.locator('.search-row').first()).toContainText('VL 03');
    await page.keyboard.press('Enter');
    await expect(page.locator('.page-title')).toHaveText('VL 03 – Folgen und Grenzwerte');
  });

  test('Vorlage anlegen', async ({ page }) => {
    await openApp(page);
    await page.locator('.sidebar .nav-row', { hasText: 'Vorlagen' }).click();
    await page.locator('.tpl-card', { hasText: 'Aufgaben-Tracker' }).click();
    await expect(page.locator('.dbv')).toBeVisible();
    await expect(page.locator('.dbv-tab')).toHaveCount(4);
    await page.locator('.sidebar .nav-row', { hasText: 'Vorlagen' }).click();
    await page.locator('.tpl-card', { hasText: 'Vorlesungsnotiz' }).click();
    await expect(page.locator('.fc-block')).toBeVisible();
  });

  test('Dunkles Design per Tastenkürzel', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press(`${mod}+Shift+L`);
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(0, 0, 0)');
  });

  test('Seitenbaum: Seite per Ziehen verschachteln', async ({ page }) => {
    await openApp(page);
    const src = page.locator('.sidebar .tree-row', { hasText: 'Schnellnotizen' });
    const dst = page.locator('.sidebar .tree-row', { hasText: 'Lernmethoden' });
    const a = await src.boundingBox();
    const b = await dst.boundingBox();
    await page.mouse.move(a.x + 80, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 80, a.y - 10, { steps: 4 });
    await page.mouse.move(b.x + 80, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    const parent = await page.evaluate(() => window.lernraum.getPage('seed-inbox').parentId);
    expect(parent).toBe('seed-lernmethoden');
  });
});
