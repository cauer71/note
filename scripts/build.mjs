// Baut zwei Varianten aus demselben Quellcode:
//   dist/site/index.html      → Cloudflare Worker (Assets), Speicher: /api (D1)
//   dist/artifact/lernraum.html → Claude-Artifact, Speicher: D1 über den Cloudflare-Connector, KI über Claude
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, BRAND, SPLASH_BG, SPLASH_CSS, SPLASH_JS, splashMarkup, startupImages } from '../src/brand.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const D1_ID = '7f5ba627-dfd3-4ba6-a7cb-e8afcf315eb1';
const HOSTED_URL = 'https://notes.auer.page';
// Arbeitsbereich der Claude-Version = LEGACY_WORKSPACE des Workers (eine Quelle: wrangler.jsonc)
const WORKSPACE = (readOptional(join(root, 'wrangler.jsonc')).match(/"LEGACY_WORKSPACE"\s*:\s*"([^"]+)"/) || [])[1] || '';
const ARTIFACT_URL = process.env.ARTIFACT_URL || readOptional(join(root, 'artifact-url.txt')).trim();

function readOptional(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

// --- CSS ------------------------------------------------------------------
function themeCss() {
  const src = readFileSync(join(root, 'src/theme.css'), 'utf8');
  const [light, rest] = src.split('/*DARK*/');
  const dark = rest.split('/*ENDDARK*/')[0];
  return (
    light +
    `\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]):not([data-app-theme="light"]) {${dark}}\n}\n` +
    `:root[data-theme="dark"]:not([data-app-theme="light"]),\n:root[data-app-theme="dark"] {${dark}}\n`
  );
}

function katexCss() {
  const dir = join(root, 'node_modules/katex/dist');
  let css = readFileSync(join(dir, 'katex.min.css'), 'utf8');
  // Nur woff2 behalten und als data:-URI einbetten (Artifact-CSP erlaubt keine fremden Schriften)
  css = css.replace(/src:url\(fonts\/([^)]+?)\.woff2\) format\("woff2"\)(?:,url\([^)]+\) format\("[^"]+"\))*/g, (_, name) => {
    const b64 = readFileSync(join(dir, 'fonts', name + '.woff2')).toString('base64');
    return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
  });
  return css;
}

async function cssBundle() {
  const css = themeCss() + '\n' + readFileSync(join(root, 'src/styles.css'), 'utf8');
  const out = await transform(css, { loader: 'css', minify: true, target: ['safari15', 'chrome100', 'firefox100'] });
  return out.code + '\n' + katexCss();
}

async function jsBundle() {
  const res = await build({
    entryPoints: [join(root, 'src/main.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['safari15', 'chrome100', 'firefox100'],
    write: false,
    legalComments: 'none',
    charset: 'utf8',
  });
  return res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}

// Version: package.json (bei jeder Veröffentlichung erhöhen) + Build-Zeitpunkt (Ortszeit Südtirol)
const BUILT = new Date();
const BUILD_LABEL = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(BUILT).replace(',', '');

const [css, js] = await Promise.all([cssBundle(), jsBundle()]);
const splashCss = (await transform(SPLASH_CSS, { loader: 'css', minify: true, target: ['safari15', 'chrome100'] })).code;
const splash = `${splashMarkup()}\n<script>${SPLASH_JS}</script>`;
const DESCRIPTION = 'Notizen, Aufgaben, Karteikarten und Handschrift fürs Studium – für iPhone, iPad mit Apple Pencil und Android';
const startupLinks = startupImages()
  .map((i) => `<link rel="apple-touch-startup-image" media="${i.media}" href="/icons/startup/${i.file}">`)
  .join('\n');

const cfg = (target) =>
  `window.__LERNRAUM__=${JSON.stringify({ target, d1: D1_ID, workspace: target === 'artifact' ? WORKSPACE : '', artifactUrl: ARTIFACT_URL, hostedUrl: HOSTED_URL, version: pkg.version, built: BUILD_LABEL, builtAt: BUILT.toISOString() })};`;

// --- Gehostete Version ------------------------------------------------------
const hosted = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual">
<meta name="theme-color" content="${SPLASH_BG}">
<meta name="color-scheme" content="light dark">
<meta name="application-name" content="${APP_NAME}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${APP_NAME}">
<meta name="format-detection" content="telephone=no">
<meta name="app-version" content="${pkg.version}">
<meta name="description" content="${DESCRIPTION}">
<link rel="manifest" href="/icons/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
${startupLinks}
<title>${APP_NAME}</title>
<style>${splashCss}</style>
<style>${css}</style>
</head>
<body>
${splash}
<div id="app"></div>
<script>${cfg('hosted')}</script>
<script>${js}</script>
</body>
</html>
`;

// --- Artifact-Version (ohne eigenes <html>/<head>/<body>) -------------------
const artifact = `<title>${APP_NAME}</title>
<style>${splashCss}</style>
<style>${css}</style>
${splash}
<div id="app"></div>
<script>${cfg('artifact')}</script>
<script>${js}</script>
`;

mkdirSync(join(root, 'dist/site/icons'), { recursive: true });
mkdirSync(join(root, 'dist/artifact'), { recursive: true });
writeFileSync(join(root, 'dist/site/index.html'), hosted);
writeFileSync(join(root, 'dist/artifact/lernraum.html'), artifact);
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), join(root, 'dist/site'), { recursive: true });
const shortcut = (name, short_name, url, icon) => ({ name, short_name, url, icons: [{ src: `/icons/shortcut-${icon}.png`, sizes: '96x96', type: 'image/png', purpose: 'any maskable' }] });
const screen = (file, w, h, form_factor, label) => ({ src: `/icons/screens/${file}.jpg`, sizes: `${w}x${h}`, type: 'image/jpeg', form_factor, label });
const manifest = {
  id: '/',
  name: APP_NAME,
  short_name: APP_NAME,
  description: DESCRIPTION,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'any',
  background_color: SPLASH_BG,
  theme_color: BRAND,
  lang: 'de',
  dir: 'ltr',
  categories: ['education', 'productivity'],
  prefer_related_applications: false,
  launch_handler: { client_mode: ['focus-existing', 'auto'] },
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    shortcut('Neue Notiz', 'Neu', '/#neu', 'neu'),
    shortcut('Heute', 'Heute', '/#heute', 'heute'),
    shortcut('Lernen', 'Lernen', '/#lernen', 'lernen'),
    shortcut('Suchen', 'Suchen', '/#suche', 'suche'),
  ],
  screenshots: [
    screen('phone-heute', 1179, 2556, 'narrow', 'Heute: Abgaben, Prüfungen und fällige Karten'),
    screen('phone-notiz', 1179, 2556, 'narrow', 'Vorlesungsnotiz mit Formeln'),
    screen('phone-aufgaben', 1179, 2556, 'narrow', 'Aufgaben als Board'),
    screen('tablet-notiz', 2388, 1668, 'wide', 'Notizen auf dem iPad'),
    screen('tablet-handschrift', 2388, 1668, 'wide', 'Handschrift mit dem Apple Pencil'),
  ],
};
writeFileSync(join(root, 'dist/site/icons/manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`dist/site/index.html        ${kb(hosted)}`);
console.log(`dist/artifact/lernraum.html ${kb(artifact)}`);
console.log(`Artifact-URL: ${ARTIFACT_URL || '(noch keine)'}`);
console.log(`Version ${pkg.version} · ${BUILD_LABEL}`);
