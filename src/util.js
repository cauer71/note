// Kleine Helfer für DOM, IDs, Zeit und Plattform

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function svg(markup, cls = '') {
  const span = document.createElement('span');
  span.className = 'ico ' + cls;
  span.innerHTML = markup;
  return span;
}

const ALPH = '0123456789abcdefghijklmnopqrstuvwxyz';
export function uid(prefix = 'b') {
  let s = '';
  const arr = new Uint8Array(12);
  (globalThis.crypto || window.crypto).getRandomValues(arr);
  for (const n of arr) s += ALPH[n % 36];
  return prefix + '-' + s;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  d.flush = (...args) => {
    if (t) {
      clearTimeout(t);
      t = null;
      fn(...args);
    }
  };
  d.cancel = () => {
    clearTimeout(t);
    t = null;
  };
  return d;
}

export function clone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const modKey = isMac ? '⌘' : 'Strg';

export function isTouchUI() {
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
}

export function isNarrow() {
  return window.matchMedia('(max-width: 760px)').matches;
}

export function mod(e) {
  return isMac ? e.metaKey : e.ctrlKey;
}

const dtf = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
const dtfShort = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dtfLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export function fmtDate(iso, style = 'default') {
  if (!iso) return '';
  const d = typeof iso === 'number' ? new Date(iso) : parseISODate(iso);
  if (!d || isNaN(d)) return '';
  if (style === 'short') return dtfShort.format(d);
  if (style === 'long') return dtfLong.format(d);
  return dtf.format(d);
}

export function fmtTime(ts) {
  return tf.format(new Date(ts));
}

export function parseISODate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return new Date(s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function daysBetween(aISO, bISO) {
  const a = parseISODate(aISO);
  const b = parseISODate(bISO);
  return Math.round((b - a) / 86400000);
}

export function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return fmtDate(ts);
}

export function relDay(iso) {
  if (!iso) return '';
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'Heute';
  if (n === 1) return 'Morgen';
  if (n === -1) return 'Gestern';
  if (n > 1 && n < 7) return `in ${n} Tagen`;
  if (n < -1 && n > -7) return `vor ${-n} Tagen`;
  return fmtDate(iso);
}

export function storageGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let toastWrap = null;
export function toast(msg, opts = {}) {
  if (!toastWrap) {
    toastWrap = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastWrap);
  }
  const el = h('div', { class: 'toast' + (opts.kind ? ' toast-' + opts.kind : '') }, msg);
  if (opts.action) {
    el.appendChild(
      h('button', {
        class: 'toast-btn',
        onclick: () => {
          opts.action.run();
          el.remove();
        },
        text: opts.action.label,
      })
    );
  }
  toastWrap.appendChild(el);
  setTimeout(() => el.classList.add('out'), opts.duration || 3200);
  setTimeout(() => el.remove(), (opts.duration || 3200) + 400);
  return el;
}

export function copyText(text) {
  try {
    const p = navigator.clipboard && navigator.clipboard.writeText(text);
    if (p) return p.then(() => true, () => fallbackCopy(text));
  } catch {
    /* weiter unten */
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0', top: '0' } });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// Bild verkleinern und als JPEG/PNG-Data-URL zurückgeben (hält D1-Zeilen klein)
export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const url = await readFileAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d');
  const png = /png|gif|webp/.test(file.type) && file.size < 300000;
  if (!png) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, hgt);
  }
  ctx.drawImage(img, 0, 0, w, hgt);
  return {
    dataUrl: png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality),
    width: w,
    height: hgt,
  };
}

export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function onVisualViewportChange(fn) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener('resize', fn);
  vv.addEventListener('scroll', fn);
  return () => {
    vv.removeEventListener('resize', fn);
    vv.removeEventListener('scroll', fn);
  };
}

export function normalizeSearch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}
