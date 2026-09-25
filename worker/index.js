// Lernraum – Cloudflare Worker
// Liefert die App (statische Assets) aus und stellt eine kleine JSON-API
// für die Seiten in D1 bereit. Vor dem Worker sitzt Cloudflare Access;
// zusätzlich prüft der Worker das Access-JWT, sobald ACCESS_AUD gesetzt ist.

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const MAX_PAGE_BYTES = 1_800_000; // D1 erlaubt bis 2 MB pro Zeile

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
    const since = Number(url.searchParams.get('since') || 0) || 0;
    const { results } = await env.DB.prepare(
      'SELECT id, updated_at, CASE WHEN updated_at > ?1 THEN data END AS data FROM pages'
    )
      .bind(since)
      .all();
    return json({ now: Date.now(), pages: results || [] });
  }

  if (path === '/api/pages' && method === 'PUT') {
    const body = await readJson(request);
    const pages = Array.isArray(body && body.pages) ? body.pages : [];
    if (!pages.length) return json({ saved: 0 });
    const stmts = [];
    for (const p of pages) {
      if (!p || typeof p.id !== 'string' || !p.id || typeof p.data !== 'string') {
        return json({ error: 'Ungültige Seite' }, 400);
      }
      if (p.data.length > MAX_PAGE_BYTES) {
        return json({ error: `Seite ${p.id} ist zu groß (max. 1,8 MB)` }, 413);
      }
      const ts = Number(p.updated_at) || Date.now();
      stmts.push(
        env.DB.prepare(
          'INSERT INTO pages (id, data, updated_at) VALUES (?1, ?2, ?3) ' +
            'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
        ).bind(p.id, p.data, ts)
      );
    }
    await env.DB.batch(stmts);
    return json({ saved: stmts.length });
  }

  if (path === '/api/pages' && method === 'DELETE') {
    const body = await readJson(request);
    const ids = Array.isArray(body && body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
    if (!ids.length) return json({ deleted: 0 });
    const stmts = ids.map((id) => env.DB.prepare('DELETE FROM pages WHERE id = ?1').bind(id));
    await env.DB.batch(stmts);
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
    // Lokale Entwicklung ohne Access
    return { type: 'local' };
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

async function getKeys(env) {
  const now = Date.now();
  if (certCache.keys && now - certCache.at < 10 * 60 * 1000) return certCache.keys;
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
  const keys = await getKeys(env);
  const jwk = keys.find((k) => k.kid === header.kid);
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
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error('Falscher Aussteller');
  return payload;
}
