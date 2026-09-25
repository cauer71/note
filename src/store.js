// Speicher-Adapter
//  - ApiStore:   gehostete Version auf Cloudflare (Worker + D1, same origin)
//  - McpD1Store: Claude-Artifact, spricht D1 über den Cloudflare-Connector (mcp)
//  - LocalStore: Fallback im Browser (IndexedDB), z. B. für Tests/Offline
// Alle Adapter: init(), loadAll(sinceRev) → [{id, updatedAt, rev, data|null}], savePages(pages), deletePages(ids)
// rev ist eine vom Server vergebene Revision (Cloudflare-Uhr) – sie dient als Sync-Marke.

const CONNECTOR = 'Cloudflare Developer Platform';
const TOOL = 'd1_database_query';
export const MAX_PAGE_BYTES = 1_900_000;
const encoder = new TextEncoder();

export function pageBytes(json) {
  // schnell: nur große Seiten genau messen
  return json.length < 400000 ? json.length * 3 : encoder.encode(json).length;
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export class ApiStore {
  // expected: Arbeitsbereich, den das Gerät zuletzt hatte (für den Schnellstart aus dem Zwischenspeicher)
  constructor(expected = '') {
    this.kind = 'cloudflare';
    this.label = 'Cloudflare D1';
    this.workspace = expected || '';
    this.expectsWorkspace = !!expected;
    this.cacheKey = expected ? 'api:' + expected : 'api';
    this.ready = false;
  }
  // Bis init() fertig ist, schickt jede Anfrage den erwarteten Arbeitsbereich mit – der Worker
  // lehnt ab (409), falls inzwischen jemand anderes angemeldet ist.
  headers(extra = {}) {
    return this.workspace ? { ...extra, 'x-notes-workspace': encodeURIComponent(this.workspace) } : extra;
  }
  async init() {
    const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Nicht angemeldet'), { code: 'auth' });
    if (!r.ok) throw new Error('API nicht erreichbar');
    const j = await r.json();
    this.user = j.user;
    this.workspace = j.workspace || '';
    this.legacy = !!j.legacy;
    this.cacheKey = 'api:' + this.workspace;
    this.ready = true;
    return true;
  }
  async check(r) {
    if (r.status === 409) {
      const j = await r.json().catch(() => ({}));
      if (j.code === 'workspace') throw Object.assign(new Error('Anderer Arbeitsbereich angemeldet'), { code: 'workspace' });
    }
    return r;
  }
  async loadAll(since = 0) {
    const r = await this.check(await fetch('/api/pages?since=' + since, { credentials: 'same-origin', cache: 'no-store', headers: this.headers() }));
    if (!r.ok) throw Object.assign(new Error('Laden fehlgeschlagen (' + r.status + ')'), { code: r.status === 401 ? 'auth' : 'net' });
    const j = await r.json();
    return j.pages.map((row) => ({ id: row.id, updatedAt: Number(row.updated_at), rev: Number(row.rev) || 0, data: row.data }));
  }
  // items: [{id, data (JSON-Text), updatedAt, baseRev}] → {saved: {id: rev}, rejected, tooLarge}
  async savePages(items) {
    const saved = {};
    const rejected = [];
    const tooLarge = [];
    // höchstens 40 Seiten bzw. ~6 MB pro Anfrage (Worker-Speicher, D1-Grenzen)
    const parts = [];
    let cur = [];
    let bytes = 0;
    for (const it of items) {
      const n = pageBytes(it.data);
      if (cur.length && (cur.length >= 40 || bytes + n > 6_000_000)) {
        parts.push(cur);
        cur = [];
        bytes = 0;
      }
      cur.push(it);
      bytes += n;
    }
    if (cur.length) parts.push(cur);
    for (const part of parts) {
      const body = JSON.stringify({ pages: part.map((p) => ({ id: p.id, data: p.data, updated_at: p.updatedAt, base_rev: p.baseRev || 0 })) });
      const r = await this.check(
        await fetch('/api/pages', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: this.headers({ 'content-type': 'application/json' }),
          body,
          keepalive: encoder.encode(body).length < 60000,
        })
      );
      if (!r.ok) {
        let msg = 'Speichern fehlgeschlagen (' + r.status + ')';
        try {
          msg = (await r.json()).error || msg;
        } catch {
          /* egal */
        }
        throw Object.assign(new Error(msg), { code: r.status === 401 ? 'auth' : 'net' });
      }
      const j = await r.json().catch(() => ({}));
      Object.assign(saved, j.saved || {});
      rejected.push(...(j.rejected || []));
      tooLarge.push(...(j.tooLarge || []));
    }
    return { saved, rejected, tooLarge };
  }
  async fetchPages(ids) {
    const out = [];
    for (const part of chunks(ids, 90)) {
      const r = await this.check(await fetch('/api/pages?ids=' + part.map(encodeURIComponent).join(','), { credentials: 'same-origin', cache: 'no-store', headers: this.headers() }));
      if (!r.ok) throw new Error('Laden fehlgeschlagen (' + r.status + ')');
      const j = await r.json();
      out.push(...j.pages.map((row) => ({ id: row.id, updatedAt: Number(row.updated_at), rev: Number(row.rev) || 0, data: row.data })));
    }
    return out;
  }
  async deletePages(ids) {
    for (const part of chunks(ids, 90)) {
      const r = await this.check(
        await fetch('/api/pages', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: this.headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ ids: part }),
        })
      );
      if (!r.ok) throw new Error('Löschen fehlgeschlagen');
    }
  }
}

// Revision fortlaufend in D1 vergeben; Serverzeit (ms) zum Kappen vorgehender Geräteuhren
const SQL_REV = '(SELECT COALESCE(MAX(rev), 0) + 1 FROM ws_pages)';
const SQL_NOW = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

// Spricht dieselbe D1-Datenbank wie der Worker an – immer nur im eigenen Arbeitsbereich (owner)
export class McpD1Store {
  constructor(mcp, databaseId, workspace, { legacy = false } = {}) {
    this.kind = 'cloudflare';
    this.label = 'Cloudflare D1 (Connector)';
    this.mcp = mcp;
    this.databaseId = databaseId;
    this.workspace = workspace;
    this.legacy = legacy;
  }
  async q(sql, params) {
    const input = { database_id: this.databaseId, sql };
    if (params && params.length) input.params = params.map((x) => String(x));
    const res = await this.mcp.callTool(CONNECTOR, TOOL, input, { cache: false });
    let p = res && res.payload;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        throw new Error(p);
      }
    }
    const first = Array.isArray(p) ? p[0] : p && Array.isArray(p.result) ? p.result[0] : p;
    if (first && first.success === false) throw new Error((first.errors && JSON.stringify(first.errors)) || 'D1-Fehler');
    this.lastMeta = (first && first.meta) || {};
    return (first && first.results) || [];
  }
  async init() {
    if (!this.workspace) throw new Error('Kein Arbeitsbereich konfiguriert');
    await this.q('CREATE TABLE IF NOT EXISTS ws_pages (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0, base_rev INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, id))');
    await this.q('CREATE INDEX IF NOT EXISTS idx_ws_pages_rev ON ws_pages(rev)');
    // Datenbank aus der Zeit vor den Arbeitsbereichen (Tabelle pages): einmalig übernehmen wie der Worker
    if (this.legacy && (await this.q("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pages'")).length) {
      const cols = new Set((await this.q('PRAGMA table_info(pages)')).map((c) => c.name));
      await this.q(`INSERT OR IGNORE INTO ws_pages (owner, id, data, updated_at, rev, base_rev) SELECT ?, id, data, updated_at, ${cols.has('rev') ? 'rev' : '0'}, ${cols.has('base_rev') ? 'base_rev' : '0'} FROM pages`, [this.workspace]);
      await this.q(`ALTER TABLE pages RENAME TO pages_legacy_${Date.now()}`);
    }
    return true;
  }
  async loadAll(since = 0) {
    // 1) nur IDs, Revisionen und Größe – 2) geänderte Seiten paketweise (Antworten klein halten)
    const meta = await this.q('SELECT id, updated_at, rev, length(data) AS size FROM ws_pages WHERE owner = ?', [this.workspace]);
    const out = new Map(meta.map((r) => [r.id, { id: r.id, updatedAt: Number(r.updated_at), rev: Number(r.rev) || 0, data: null }]));
    const changed = meta.filter((r) => (Number(r.rev) || 0) > since);
    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const rows = await this.q(`SELECT id, updated_at, rev, data FROM ws_pages WHERE owner = ? AND id IN (${batch.map(() => '?').join(', ')})`, [this.workspace, ...batch]);
      for (const r of rows) out.set(r.id, { id: r.id, updatedAt: Number(r.updated_at), rev: Number(r.rev) || 0, data: r.data });
      batch = [];
      size = 0;
    };
    for (const r of changed) {
      const n = Number(r.size) || 0;
      if (batch.length && (size + n > 400000 || batch.length >= 40)) await flush();
      batch.push(r.id);
      size += n;
    }
    await flush();
    return [...out.values()];
  }
  // items: [{id, data, updatedAt, baseRev}] → {saved: {id: rev}, rejected, tooLarge}
  async savePages(items) {
    const saved = {};
    const rejected = [];
    const batches = [];
    let cur = [];
    let size = 0;
    for (const it of items) {
      // 5 Parameter pro Seite, D1 erlaubt höchstens 100
      if (cur.length && (size + it.data.length > 600000 || cur.length >= 19)) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(it);
      size += it.data.length;
    }
    if (cur.length) batches.push(cur);
    for (const b of batches) {
      // Optimistische Sperre wie im Worker: nur schreiben, wenn rev noch der Basis entspricht
      const values = b.map(() => `(?, ?, ?, MIN(CAST(? AS INTEGER), ${SQL_NOW} + 60000), ${SQL_REV}, CAST(? AS INTEGER))`).join(', ');
      const params = [];
      for (const x of b) params.push(this.workspace, x.id, x.data, x.updatedAt, x.baseRev || 0);
      const rows = await this.q(
        `INSERT INTO ws_pages (owner, id, data, updated_at, rev, base_rev) VALUES ${values} ON CONFLICT(owner, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev, base_rev = excluded.base_rev WHERE ws_pages.rev = excluded.base_rev RETURNING id, rev`,
        params
      );
      for (const r of rows) saved[r.id] = Number(r.rev);
      for (const x of b) if (!(x.id in saved)) rejected.push(x.id);
    }
    return { saved, rejected, tooLarge: [] };
  }
  async fetchPages(ids) {
    const out = [];
    for (const part of chunks(ids, 40)) {
      const rows = await this.q(`SELECT id, updated_at, rev, data FROM ws_pages WHERE owner = ? AND id IN (${part.map(() => '?').join(', ')})`, [this.workspace, ...part]);
      out.push(...rows.map((r) => ({ id: r.id, updatedAt: Number(r.updated_at), rev: Number(r.rev) || 0, data: r.data })));
    }
    return out;
  }
  async deletePages(ids) {
    for (const part of chunks(ids, 90)) {
      await this.q(`DELETE FROM ws_pages WHERE owner = ? AND id IN (${part.map(() => '?').join(', ')})`, [this.workspace, ...part]);
    }
  }
}

// IndexedDB mit localStorage-Fallback
function idb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no idb'));
    const req = indexedDB.open('lernraum', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    try {
      const v = localStorage.getItem('lr:' + key);
      return v ? JSON.parse(v) : undefined;
    } catch {
      return undefined;
    }
  }
}

export async function kvSet(key, value) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem('lr:' + key, JSON.stringify(value));
    } catch {
      /* voll oder gesperrt */
    }
  }
}

export async function kvDel(key) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* kein IndexedDB */
  }
  try {
    localStorage.removeItem('lr:' + key);
  } catch {
    /* gesperrt */
  }
}

export class LocalStore {
  constructor(key = 'local-pages') {
    this.kind = 'local';
    this.label = 'Nur in diesem Browser';
    this.key = key;
    this.rows = null;
  }
  async init() {
    this.rows = (await kvGet(this.key)) || {};
    return true;
  }
  isEmpty() {
    return !this.rows || !Object.keys(this.rows).length;
  }
  async loadAll(since = 0) {
    return Object.values(this.rows).map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt,
      rev: r.rev || 0,
      data: (r.rev || 0) > since ? r.data : null,
    }));
  }
  async savePages(items) {
    const saved = {};
    const rejected = [];
    let rev = Math.max(0, ...Object.values(this.rows).map((r) => r.rev || 0));
    for (const it of items) {
      const cur = this.rows[it.id];
      if (cur && (cur.rev || 0) !== (it.baseRev || 0)) {
        rejected.push(it.id);
        continue;
      }
      this.rows[it.id] = { id: it.id, updatedAt: it.updatedAt, rev: ++rev, data: it.data };
      saved[it.id] = rev;
    }
    await kvSet(this.key, this.rows);
    return { saved, rejected, tooLarge: [] };
  }
  async fetchPages(ids) {
    return ids.filter((id) => this.rows[id]).map((id) => ({ ...this.rows[id] }));
  }
  async deletePages(ids) {
    for (const id of ids) delete this.rows[id];
    await kvSet(this.key, this.rows);
  }
}

export { CONNECTOR };
