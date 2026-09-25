// Einstieg: Umgebung erkennen, Speicher wählen, App starten

import { App, applyTheme } from './app.js';
import { ApiStore, McpD1Store, LocalStore } from './store.js';
import { storageGet } from './util.js';
import { renderMath, highlight } from './blocks.js';

const config = Object.assign({ target: 'hosted', d1: '', artifactUrl: '', hostedUrl: '' }, window.__LERNRAUM__ || {});
const params = new URLSearchParams(location.search);

applyTheme(storageGet('lr:theme', 'system'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(storageGet('lr:theme', 'system')));

// Bibliotheken (KaTeX, highlight.js) nachladen und danach neu zeichnen
function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
function afterLibs() {
  document.querySelectorAll('.math').forEach((m) => renderMath(m));
  document.querySelectorAll('.code-block').forEach((cb) => {
    const ta = cb.querySelector('.code-ta');
    const code = cb.querySelector('.code-pre code');
    const lang = cb.dataset.lang;
    if (ta && code) code.innerHTML = highlight(ta.value, lang) + '\n';
  });
}
if (!params.has('nolibs')) {
  Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js'),
  ]).then(afterLibs);
}

const app = new App(document.getElementById('app'), config);
window.lernraum = app;

const stores = [];
const inClaude = !!(window.claude && typeof window.claude.use === 'function');
if (params.has('local') || config.localOnly) {
  stores.push(async () => new LocalStore(params.get('local') || 'local'));
} else if (config.target === 'artifact' || inClaude) {
  stores.push(async () => {
    if (!inClaude || !config.d1) return null;
    const mcp = await window.claude.use('mcp');
    if (!mcp) return null;
    const s = new McpD1Store(mcp, config.d1);
    s.cacheKey = 'mcp-d1';
    return s;
  });
  stores.push(async () => {
    const s = new LocalStore('artifact-local');
    s.bannerText = 'Cloudflare ist hier nicht verbunden – Notizen werden nur in diesem Browser gespeichert. Verbinde den Cloudflare-Connector in claude.ai, um deine Notizen zu synchronisieren.';
    return s;
  });
} else {
  stores.push(async () => {
    const s = new ApiStore();
    s.cacheKey = 'api';
    return s;
  });
}

app.start(stores);

// Offline-Start für die Home-Bildschirm-App (nur gehostete Version)
if (config.target === 'hosted' && !inClaude && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
