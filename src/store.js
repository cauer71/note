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
  constructor() {
    this.kind = 'cloudflare';
    this.label = 'Cloudflare D1';
  }
  async init() {
    const r = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Nicht angemeldet'), { code: 'auth' });
    if (!r.ok) throw new Error('API nicht erreichbar');
    const j = await r.json();
    this.user = j.user;
    return true;
  }
  async loadAll(since = 0) {
    const r = await fetch('/api/pages?since=' + since, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('Laden fehlgeschlagen (' + r.status + ')'), { code: r.status === 401 ? 'auth' : 'net' });
    const j = await r.json();
    return j.pages.map((row) => ({ id: row.id, updatedAt: Number(row.updated_at), rev: Number(row.rev) || 0, data: row.data }));
  }
  async savePages(pages) {
    for (const part of chunks(pages, 40)) {
      const body = JSON.stringify({
        pages: part.map((p) => ({ id: p.id, data: JSON.stringify(p), updated_at: p.updatedAt })),
      });
      const r = await fetch('/api/pages', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: body.length < 60000,
      });
      if (!r.ok) {
        let msg = 'Speichern fehlgeschlagen (' + r.status + ')';
        try {
          msg = (await r.json()).error || msg;
        } catch {
          /* egal */
        }
        throw Object.assign(new Error(msg), { code: r.status === 401 ? 'auth' : 'net' });
      }
    }
  }
  async deletePages(ids) {
    for (const part of chunks(ids, 90)) {
      const r = await fetch('/api/pages', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: part }),
      });
      if (!r.ok) throw new Error('Löschen fehlgeschlagen');
    }
  }
}

// Revision direkt in D1 aus der Serverzeit berechnen (Millisekunden)
const SQL_REV = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

export class McpD1Store {
  constructor(mcp, databaseId) {
    this.kind = 'cloudflare';
    this.label = 'Cloudflare D1 (Connector)';
    this.mcp = mcp;
    this.databaseId = databaseId;
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
    return (first && first.results) || [];
  }
  async init() {
    await this.q('CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0)');
    return true;
  }
  async loadAll(since = 0) {
    // 1) nur IDs, Revisionen und Größe – 2) geänderte Seiten paketweise (Antworten klein halten)
    const meta = await this.q('SELECT id, updated_at, rev, length(data) AS size FROM pages');
    const out = new Map(meta.map((r) => [r.id, { id: r.id, updatedAt: Number(r.updated_at), rev: Number(r.rev) || 0, data: null }]));
    const changed = meta.filter((r) => (Number(r.rev) || 0) >= since);
    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const rows = await this.q(`SELECT id, updated_at, rev, data FROM pages WHERE id IN (${batch.map(() => '?').join(', ')})`, batch);
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
  async savePages(pages) {
    // Eine Anweisung pro Aufruf; mehrere kleine Seiten gebündelt (max. 90 Parameter)
    const batches = [];
    let cur = [];
    let size = 0;
    for (const p of pages) {
      const data = JSON.stringify(p);
      if (cur.length && (size + data.length > 600000 || cur.length >= 30)) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push({ id: p.id, data, ts: p.updatedAt });
      size += data.length;
    }
    if (cur.length) batches.push(cur);
    for (const b of batches) {
      const values = b.map(() => `(?, ?, ?, ${SQL_REV})`).join(', ');
      const params = [];
      for (const x of b) params.push(x.id, x.data, x.ts);
      await this.q(
        `INSERT INTO pages (id, data, updated_at, rev) VALUES ${values} ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev WHERE excluded.updated_at >= pages.updated_at`,
        params
      );
    }
  }
  async deletePages(ids) {
    for (const part of chunks(ids, 90)) {
      await this.q(`DELETE FROM pages WHERE id IN (${part.map(() => '?').join(', ')})`, part);
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
      data: (r.rev || 0) >= since ? r.data : null,
    }));
  }
  async savePages(pages) {
    const rev = Date.now();
    for (const p of pages) {
      const cur = this.rows[p.id];
      if (cur && cur.updatedAt > p.updatedAt) continue;
      this.rows[p.id] = { id: p.id, updatedAt: p.updatedAt, rev, data: JSON.stringify(p) };
    }
    await kvSet(this.key, this.rows);
  }
  async deletePages(ids) {
    for (const id of ids) delete this.rows[id];
    await kvSet(this.key, this.rows);
  }
}

export { CONNECTOR };
