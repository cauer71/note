// Lernraum – Cloudflare Worker
// Liefert die App (statische Assets) aus und stellt eine kleine JSON-API
// für die Seiten in D1 bereit. Vor dem Worker sitzt Cloudflare Access;
// zusätzlich prüft der Worker das Access-JWT, sobald ACCESS_AUD gesetzt ist.

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MAX_PAGE_BYTES = 1_900_000; // D1 erlaubt bis 2 MB pro Zeile (in Bytes)
const MAX_BATCH = 40; // D1: höchstens 50 Abfragen pro Aufruf (Free-Plan)
const MAX_PARAMS = 90; // D1: höchstens 100 gebundene Parameter
const encoder = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        const identity = await authorize(request, env);
        if (!identity) return json({ error: 'Nicht angemeldet' }, 401);
        return await handleApi(request, env, url, identity);
      } catch (err) {
        return json({ error: String(err && err.message ? err.message : err) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url, identity) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === '/api/health') {
    return json({ ok: true, user: identity.email || identity.type });
  }

  if (path === '/api/pages' && method === 'GET') {
    await ensureSchema(env);
    const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    if (ids.length) {
      // gezielt einzelne Seiten (nach einem abgelehnten Speichern)
      if (ids.length > MAX_PARAMS) return json({ error: `Höchstens ${MAX_PARAMS} Seiten pro Anfrage` }, 400);
      const { results } = await env.DB.prepare(
        `SELECT id, updated_at, rev, data FROM pages WHERE id IN (${ids.map((_, i) => '?' + (i + 1)).join(', ')})`
      )
        .bind(...ids)
        .all();
      return json({ now: Date.now(), pages: results || [] });
    }
    // since = zuletzt gesehene Revision; neuere Zeilen kommen mit Inhalt
    const since = Number(url.searchParams.get('since') || 0) || 0;
    const { results } = await env.DB.prepare(
      'SELECT id, updated_at, rev, CASE WHEN rev > ?1 THEN data END AS data FROM pages'
    )
      .bind(since)
      .all();
    return json({ now: Date.now(), pages: results || [] });
  }

  if (path === '/api/pages' && method === 'PUT') {
    await ensureSchema(env);
    const body = await readJson(request);
    const pages = Array.isArray(body && body.pages) ? body.pages : [];
    if (!pages.length) return json({ saved: {}, rejected: [], tooLarge: [] });
    if (pages.length > MAX_BATCH) return json({ error: `Höchstens ${MAX_BATCH} Seiten pro Anfrage` }, 400);
    const now = Date.now();
    const stmts = [];
    const ids = [];
    const tooLarge = [];
    for (const p of pages) {
      if (!p || typeof p.id !== 'string' || !p.id || typeof p.data !== 'string') {
        return json({ error: 'Ungültige Seite' }, 400);
      }
      if (encoder.encode(p.data).length > MAX_PAGE_BYTES) {
        tooLarge.push(p.id);
        continue;
      }
      const ts = Math.min(Number(p.updated_at) || now, now + 60000);
      const base = Number(p.base_rev) || 0;
      // Optimistische Sperre: nur schreiben, wenn die Seite seit base_rev unverändert ist.
      // Revision fortlaufend in D1 vergeben (Reihenfolge = Reihenfolge der Schreibvorgänge).
      stmts.push(
        env.DB.prepare(
          'INSERT INTO pages (id, data, updated_at, rev, base_rev) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(rev), 0) + 1 FROM pages), ?4) ' +
            'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev, base_rev = excluded.base_rev ' +
            'WHERE pages.rev = excluded.base_rev RETURNING id, rev'
        ).bind(p.id, p.data, ts, base)
      );
      ids.push(p.id);
    }
    const results = stmts.length ? await env.DB.batch(stmts) : [];
    const saved = {};
    const rejected = [];
    ids.forEach((id, i) => {
      const row = results[i] && results[i].results && results[i].results[0];
      if (row) saved[id] = Number(row.rev);
      else rejected.push(id);
    });
    return json({ saved, rejected, tooLarge });
  }

  if (path === '/api/pages' && method === 'DELETE') {
    await ensureSchema(env);
    const body = await readJson(request);
    const ids = Array.isArray(body && body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return json({ deleted: 0 });
    if (ids.length > MAX_PARAMS) return json({ error: `Höchstens ${MAX_PARAMS} Seiten pro Anfrage` }, 400);
    await env.DB.prepare(`DELETE FROM pages WHERE id IN (${ids.map((_, i) => '?' + (i + 1)).join(', ')})`)
      .bind(...ids)
      .run();
    return json({ deleted: ids.length });
  }

  if (path === '/api/settings' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of results || []) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return json(out);
  }

  if (path === '/api/settings' && method === 'PUT') {
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return json({ error: 'Ungültige Einstellungen' }, 400);
    const now = Date.now();
    const stmts = Object.entries(body).map(([k, v]) =>
      env.DB.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind(k, JSON.stringify(v), now)
    );
    if (stmts.length) await env.DB.batch(stmts);
    return json({ saved: stmts.length });
  }

  return json({ error: 'Nicht gefunden' }, 404);
}

// Schema anlegen bzw. nachrüsten (einmal pro Worker-Instanz)
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.prepare(
        'CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0, base_rev INTEGER NOT NULL DEFAULT 0)'
      ).run();
      const { results } = await env.DB.prepare('PRAGMA table_info(pages)').all();
      const cols = new Set((results || []).map((c) => c.name));
      if (!cols.has('rev')) await env.DB.prepare('ALTER TABLE pages ADD COLUMN rev INTEGER NOT NULL DEFAULT 0').run();
      if (!cols.has('base_rev')) await env.DB.prepare('ALTER TABLE pages ADD COLUMN base_rev INTEGER NOT NULL DEFAULT 0').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pages_rev ON pages(rev)').run();
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// ---------------------------------------------------------------------------
// Cloudflare Access: JWT prüfen (RS256, Schlüssel vom Team-Endpunkt)
// ---------------------------------------------------------------------------

let certCache = { at: 0, keys: null };

async function authorize(request, env) {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    // Ohne Access-Konfiguration nur mit ausdrücklichem Entwicklungsschalter offen
    return env.DEV_NO_AUTH === '1' ? { type: 'local' } : null;
  }
  const token =
    request.headers.get('cf-access-jwt-assertion') || getCookie(request, 'CF_Authorization');
  if (!token) return null;
  try {
    const payload = await verifyJwt(token, env);
    return { type: payload.type || 'app', email: payload.email || payload.common_name || '' };
  } catch {
    return null;
  }
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKeys(env, force = false) {
  const now = Date.now();
  const fresh = certCache.keys && now - certCache.at < 10 * 60 * 1000;
  // Unbekannter Schlüssel (Rotation): höchstens alle 30 s neu laden
  if (fresh && !(force && now - certCache.at > 30 * 1000)) return certCache.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Access-Zertifikate nicht erreichbar');
  const { keys } = await res.json();
  certCache = { at: now, keys };
  return keys;
}

async function verifyJwt(token, env) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('Token-Format');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (header.alg !== 'RS256') throw new Error('Algorithmus');
  let jwk = (await getKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(env, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unbekannter Schlüssel');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error('Signatur ungültig');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error('Falsche Zielgruppe');
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('Token abgelaufen');
  if (payload.nbf && payload.nbf * 1000 > Date.now() + 60000) throw new Error('Token noch nicht gültig');
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error('Falscher Aussteller');
  return payload;
}
