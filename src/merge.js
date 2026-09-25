// Dreiwege-Zusammenführung einer Seite (Basis = letzter gemeinsamer Stand vom Server)
// Regeln: pro Feld/Block/Eigenschaft gewinnt die Seite, die etwas geändert hat;
// haben beide geändert, gewinnt die lokale Fassung (sie wurde gerade bearbeitet).

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function pick(base, local, remote) {
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  return local;
}

function mergeBlocks(baseBlocks = [], localBlocks = [], remoteBlocks = []) {
  const base = new Map(baseBlocks.map((b) => [b.id, b]));
  const local = new Map(localBlocks.map((b) => [b.id, b]));
  const out = [];
  const used = new Set();
  // Reihenfolge der Gegenseite als Gerüst
  for (const rb of remoteBlocks) {
    const lb = local.get(rb.id);
    const bb = base.get(rb.id);
    if (lb) out.push(bb ? pick(bb, lb, rb) : lb);
    else if (!bb) out.push(rb); // neu auf der Gegenseite
    else if (!same(rb, bb)) out.push(rb); // lokal gelöscht, dort aber geändert → behalten
    // sonst: lokal gelöscht, dort unverändert → weg
    used.add(rb.id);
  }
  // Lokale Blöcke, die dort fehlen
  localBlocks.forEach((lb, i) => {
    if (used.has(lb.id)) return;
    const bb = base.get(lb.id);
    if (bb && same(lb, bb)) return; // dort gelöscht, hier unverändert → weg
    // neu (oder hier geändert): hinter dem vorherigen lokalen Nachbarn einsortieren
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === localBlocks[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, lb);
    used.add(lb.id);
  });
  return out;
}

export function mergePage(base, local, remote) {
  if (!base) return local;
  const result = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    if (k === 'blocks') result.blocks = mergeBlocks(base.blocks, local.blocks, remote.blocks);
    else if (k === 'props') {
      const bp = base.props || {};
      const lp = local.props || {};
      const rp = remote.props || {};
      const pk = new Set([...Object.keys(bp), ...Object.keys(lp), ...Object.keys(rp)]);
      const out = {};
      for (const p of pk) {
        const v = pick(bp[p], lp[p], rp[p]);
        if (v !== undefined) out[p] = v;
      }
      result.props = out;
    } else if (k === 'db' && local.db && remote.db && base.db) {
      // Datenbank-Schema: Eigenschaften und Ansichten je Objekt zusammenführen
      result.db = { ...pick(base.db, local.db, remote.db) };
      result.db.properties = mergeBlocks(base.db.properties, local.db.properties, remote.db.properties);
      result.db.views = mergeBlocks(base.db.views, local.db.views, remote.db.views);
    } else {
      const v = pick(base[k], local[k], remote[k]);
      if (v !== undefined) result[k] = v;
    }
  }
  result.id = local.id;
  return result;
}
