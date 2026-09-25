// Artifact-Version: Claude (sample) und Cloudflare-Connector (mcp → D1) werden gemockt
import { test, expect } from '@playwright/test';

function mockClaude({ mcpFail = false, seedRows = null, legacyRows = null } = {}) {
  return `
  (() => {
    const KEY = '__mockd1';
    const LEGACY = '__mockd1legacy';
    // D1-Nachbau: { owner: { id: row } } – wie ws_pages (PRIMARY KEY owner, id)
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
    const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
    ${seedRows ? `if (!localStorage.getItem(KEY)) save({ christian: ${JSON.stringify(seedRows)} });` : ''}
    ${legacyRows ? `if (!localStorage.getItem(LEGACY) && !localStorage.getItem(KEY)) localStorage.setItem(LEGACY, JSON.stringify(${JSON.stringify(legacyRows)}));` : ''}
    window.__calls = { sample: [], mcp: [], owners: new Set() };
    const ok = (results) => ({ content: [{ type: 'text', text: JSON.stringify([{ results, success: true, meta: {} }]) }], payload: [{ results, success: true, meta: {} }] });
    const mcp = {
      async callTool(server, tool, input) {
        window.__calls.mcp.push({ server, tool, sql: input.sql, params: input.params || [] });
        await new Promise((r) => setTimeout(r, 15));
        if (${mcpFail}) throw { code: 'server_not_connected', message: 'nicht verbunden', server };
        if (server !== 'Cloudflare Developer Platform' || tool !== 'd1_database_query') throw { code: 'not_in_manifest' };
        if (!input.database_id) throw { code: 'tool_error', message: 'database_id fehlt' };
        if ((input.params || []).some((x) => typeof x !== 'string')) throw { code: 'tool_error', message: 'params müssen Texte sein' };
        const sql = input.sql; const p = input.params || [];
        const db = load();
        const rows = (owner) => { window.__calls.owners.add(owner); return db[owner] || (db[owner] = {}); };
        if (/^CREATE (TABLE|INDEX)/i.test(sql)) return ok([]);
        if (/^SELECT name FROM sqlite_master/i.test(sql)) return ok(localStorage.getItem(LEGACY) ? [{ name: 'pages' }] : []);
        if (/^PRAGMA table_info\\(pages\\)/i.test(sql)) return ok(['id', 'data', 'updated_at', 'rev', 'base_rev'].map((name) => ({ name })));
        if (/^INSERT OR IGNORE INTO ws_pages .* FROM pages$/i.test(sql)) {
          const own = rows(p[0]);
          for (const r of Object.values(JSON.parse(localStorage.getItem(LEGACY) || '{}'))) if (!own[r.id]) own[r.id] = r;
          save(db);
          return ok([]);
        }
        if (/^ALTER TABLE pages RENAME TO pages_legacy_\\d+$/i.test(sql)) { localStorage.removeItem(LEGACY); return ok([]); }
        if (/^SELECT id, updated_at, rev, length\\(data\\) AS size FROM ws_pages WHERE owner = \\?$/i.test(sql)) {
          return ok(Object.values(rows(p[0])).map((r) => ({ id: r.id, updated_at: r.updated_at, rev: r.rev || 0, size: r.data.length })));
        }
        if (/^SELECT id, updated_at, rev, data FROM ws_pages WHERE owner = \\? AND id IN/i.test(sql)) {
          window.__calls.batches = (window.__calls.batches || 0) + 1;
          const own = rows(p[0]);
          return ok(p.slice(1).map((id) => own[id]).filter(Boolean).map((r) => ({ id: r.id, updated_at: r.updated_at, rev: r.rev || 0, data: r.data })));
        }
        if (/^INSERT INTO ws_pages/i.test(sql)) {
          if (!/RETURNING id, rev$/.test(sql) || !/ON CONFLICT\\(owner, id\\)/.test(sql) || !/WHERE ws_pages\\.rev = excluded\\.base_rev/.test(sql)) throw { code: 'tool_error', message: 'Sperre fehlt' };
          if (p.length > 100) throw { code: 'tool_error', message: 'zu viele Parameter' };
          let rev = Math.max(0, ...Object.values(db).flatMap((o) => Object.values(o)).map((r) => r.rev || 0)) + 1;
          const out = [];
          for (let i = 0; i < p.length; i += 5) {
            const own = rows(p[i]);
            const cur = own[p[i + 1]];
            if (cur && (cur.rev || 0) !== Number(p[i + 4])) continue;
            own[p[i + 1]] = { id: p[i + 1], data: p[i + 2], updated_at: Number(p[i + 3]), rev };
            out.push({ id: p[i + 1], rev });
          }
          save(db);
          return ok(out);
        }
        if (/^DELETE FROM ws_pages WHERE owner = \\? AND id IN/i.test(sql)) { const own = rows(p[0]); for (const id of p.slice(1)) delete own[id]; save(db); return ok([]); }
        throw { code: 'tool_error', message: 'unbekanntes SQL: ' + sql };
      },
    };
    const answer = (prompt) => {
      if (/Karteikarten/.test(prompt) && /JSON/.test(prompt)) return JSON.stringify([{ q: 'Was ist ein Primärschlüssel?', a: 'Identifiziert jedes Tupel eindeutig.' }, { q: 'Was macht $\\\\sigma$?', a: 'Selektion von Zeilen.' }]);
      if (/Multiple-Choice-Quiz/.test(prompt)) return JSON.stringify([{ q: 'Was filtert WHERE?', options: ['Zeilen', 'Spalten', 'Tabellen', 'Nichts'], correct: 0, explain: 'WHERE filtert Zeilen.' }]);
      if (/handschriftliche Lernnotizen/.test(prompt)) return '## Grenzwert\\n- Folge $a_n$ konvergiert gegen $a$\\n- ε-Schlauch';
      if (/Verbessere Stil/.test(prompt)) return 'Ein verbesserter Satz.';
      if (/Aufgabe: /.test(prompt)) return '## Gliederung\\n1. Einleitung\\n2. Hauptteil\\n- [ ] Quellen suchen';
      return '## Zusammenfassung\\n- Punkt **eins**\\n- Punkt zwei mit $x^2$';
    };
    const sample = async (input, opts = {}) => {
      const prompt = typeof input === 'string' ? input : input.map((t) => t.content).join('\\n');
      window.__calls.sample.push({ prompt, images: !!opts.images, tools: (opts.tools || []).map((t) => t.name) });
      const text = answer(prompt);
      await new Promise((r) => setTimeout(r, 30));
      if (opts.onText) { const half = text.slice(0, Math.ceil(text.length / 2)); opts.onText({ text: half, delta: half }); await new Promise((r) => setTimeout(r, 30)); opts.onText({ text, delta: text.slice(half.length) }); }
      return { text, truncated: false, modelTierApplied: 'default' };
    };
    sample.json = async (input, opts) => JSON.parse((await sample(input, opts)).text);
    sample.limits = async () => ({ maxPromptBytes: 65536, images: { maxCount: 4, maxInputBytes: 20000000, mediaTypes: ['image/png', 'image/jpeg'] }, tools: { maxCount: 8 } });
    window.claude = { use: async (name) => { await new Promise((r) => setTimeout(r, 5)); return name === 'sample' ? sample : name === 'mcp' ? mcp : null; } };
  })();`;
}

async function openArtifact(page, opts = {}, hash = '') {
  await page.addInitScript(mockClaude(opts));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/artifact.html' + (hash ? '#' + hash : ''));
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 0 && document.querySelector('.content')?.dataset.rendered === '1');
  await page.waitForFunction(() => window.lernraum.ai.available);
  return errors;
}

test.describe('Claude-Artifact', () => {
  test('Speichert über den Cloudflare-Connector in D1', async ({ page }) => {
    const errors = await openArtifact(page);
    // Leere D1 → Testnotizen werden angelegt und gespeichert
    await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('__mockd1') || '{}').christian || {}).length > 20, null, { timeout: 10000 });
    expect(await page.evaluate(() => window.lernraum.store.kind)).toBe('cloudflare');
    const calls = await page.evaluate(() => window.__calls.mcp.map((c) => c.sql.slice(0, 12)));
    expect(calls[0]).toMatch(/CREATE TABLE/);
    // Bearbeiten → landet in D1
    await page.evaluate(() => (location.hash = 'seed-inbox'));
    await page.locator('.blk-text').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' – geändert');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('__mockd1')).christian['seed-inbox'].data.includes('geändert'), null, { timeout: 5000 });
    // Nur der eigene Arbeitsbereich wird angefasst
    expect(await page.evaluate(() => [...window.__calls.owners])).toEqual(['christian']);
    expect(errors).toEqual([]);
  });

  test('Lädt vorhandene Daten aus D1 ohne neu zu säen', async ({ page }) => {
    const pageRow = { id: 'p-eigene', kind: 'page', title: 'Meine D1-Seite', icon: '🧪', blocks: [{ id: 'b-1', type: 'p', text: 'Aus Cloudflare', indent: 0 }], parentId: null, trashed: 0, order: 1, createdAt: 1, updatedAt: 2 };
    await openArtifact(page, { seedRows: { 'p-eigene': { id: 'p-eigene', data: JSON.stringify(pageRow), updated_at: 2, rev: 5 } } }, 'p-eigene');
    await expect(page.locator('.page-title')).toHaveText('Meine D1-Seite');
    expect(await page.evaluate(() => window.lernraum.pages.size)).toBe(1);
  });

  test('Übernimmt eine Datenbank aus der Zeit vor den Arbeitsbereichen', async ({ page }) => {
    const old = { id: 'p-alt', kind: 'page', title: 'Aus der alten Tabelle', icon: '📦', blocks: [], parentId: null, trashed: 0, order: 1, createdAt: 1, updatedAt: 2 };
    await openArtifact(page, { legacyRows: { 'p-alt': { id: 'p-alt', data: JSON.stringify(old), updated_at: 2, rev: 9 } } }, 'p-alt');
    await expect(page.locator('.page-title')).toHaveText('Aus der alten Tabelle');
    expect(await page.evaluate(() => localStorage.getItem('__mockd1legacy'))).toBeNull();
    expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('__mockd1')).christian))).toEqual(['p-alt']);
  });

  test('Fällt ohne Connector auf lokalen Speicher zurück', async ({ page }) => {
    await openArtifact(page, { mcpFail: true });
    await expect(page.locator('.banner')).toContainText('Cloudflare');
    expect(await page.evaluate(() => window.lernraum.store.kind)).toBe('local');
  });

  test('KI-Panel: Zusammenfassen und in Seite einfügen', async ({ page }) => {
    await openArtifact(page, {}, 'seed-dbs-vl1');
    await page.locator('.cap-btn.cap-ai').click();
    await expect(page.locator('.ai-panel')).toBeVisible();
    await page.locator('.ai-quick-btn', { hasText: 'Zusammenfassen' }).click();
    await expect(page.locator('.ai-assistant .ai-msg-body').last()).toContainText('Punkt zwei');
    const before = await page.evaluate(() => window.lernraum.currentPage().blocks.length);
    await page.locator('.ai-msg-actions .chip-btn', { hasText: 'In Seite einfügen' }).last().click();
    const after = await page.evaluate(() => window.lernraum.currentPage().blocks.length);
    expect(after).toBeGreaterThan(before);
    const prompt = await page.evaluate(() => window.__calls.sample[0].prompt);
    expect(prompt).toContain('Relationales Modell');
    // Chat-Frage über alle Notizen nutzt Werkzeuge
    await page.locator('.ai-scope .segmented button', { hasText: 'Alle Notizen' }).click();
    await page.locator('.ai-input').fill('Wann ist die Analysis-Klausur?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ai-assistant').last()).toContainText('Zusammenfassung');
    const tools = await page.evaluate(() => window.__calls.sample[window.__calls.sample.length - 1].tools);
    expect(tools).toContain('search_notes');
  });

  test('KI erstellt Karteikarten und Quiz im Block', async ({ page }) => {
    await openArtifact(page, {}, 'seed-dbs-vl1');
    const fc = page.locator('.fc-block');
    await expect(fc.locator('.fc-row')).toHaveCount(3);
    await fc.locator('.btn', { hasText: 'Erstellen' }).click();
    await expect(fc.locator('.fc-row')).toHaveCount(5);
    await page.evaluate(() => (location.hash = 'seed-la'));
    await page.locator('.quiz .btn', { hasText: 'Erstellen' }).click();
    await expect(page.locator('.quiz .quiz-item')).toHaveCount(1);
    await expect(page.locator('.quiz .quiz-item')).toContainText('Was filtert WHERE?');
  });

  test('Handschrift in Text umwandeln', async ({ page }) => {
    await openArtifact(page, {}, 'seed-handschrift');
    await page.locator('.draw-ai').first().click();
    await expect(page.locator('.blk-callout', { hasText: 'Aus Handschrift übertragen' })).toBeVisible();
    const call = await page.evaluate(() => window.__calls.sample[window.__calls.sample.length - 1]);
    expect(call.images).toBe(true);
    await expect(page.locator('.blk-h2', { hasText: 'Grenzwert' })).toBeVisible();
  });

  test('Auswahl mit Claude verbessern und ersetzen', async ({ page }) => {
    await openArtifact(page, {}, 'seed-inbox');
    const first = page.locator('.blk-text').first();
    await first.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await expect(page.locator('.sel-bar .sel-ai-btn')).toBeVisible();
    await page.locator('.sel-bar .sel-ai-btn').click();
    await page.locator('.menu-item', { hasText: 'Schreiben verbessern' }).click();
    await expect(page.locator('.ai-pop .ai-result')).toContainText('Ein verbesserter Satz.');
    await page.locator('.ai-pop .btn', { hasText: 'Ersetzen' }).click();
    await expect(page.locator('.blk-text').first()).toHaveText('Ein verbesserter Satz.');
  });

  test('/ki schreibt an der Stelle', async ({ page }) => {
    await openArtifact(page, {}, 'seed-inbox');
    await page.locator('.page-tail').click();
    await page.keyboard.type('/ki');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ai-inline')).toBeVisible();
    await page.keyboard.type('Gliederung für die Hausarbeit');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ai-inline .ai-result')).toContainText('Quellen suchen');
    await page.locator('.ai-inline .btn', { hasText: 'Übernehmen' }).click();
    await expect(page.locator('.blk-h2', { hasText: 'Gliederung' })).toBeVisible();
    await expect(page.locator('.blk-todo', { hasText: 'Quellen suchen' })).toBeVisible();
  });
});

test('Gehostete Version: KI-Hinweis mit Link zur Claude-Version', async ({ page }) => {
  await page.goto('/?local=hint#seed-inbox');
  await page.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5);
  await page.locator('.cap-btn.cap-ai').click();
  await expect(page.locator('.ai-unavail')).toContainText('KI über Claude');
});
