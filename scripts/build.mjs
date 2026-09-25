// Baut zwei Varianten aus demselben Quellcode:
//   dist/site/index.html      → Cloudflare Worker (Assets), Speicher: /api (D1)
//   dist/artifact/lernraum.html → Claude-Artifact, Speicher: D1 über den Cloudflare-Connector, KI über Claude
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const D1_ID = '7f5ba627-dfd3-4ba6-a7cb-e8afcf315eb1';
const HOSTED_URL = 'https://notes.auer.page';
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

const [css, js] = await Promise.all([cssBundle(), jsBundle()]);

const cfg = (target) =>
  `window.__LERNRAUM__=${JSON.stringify({ target, d1: D1_ID, artifactUrl: ARTIFACT_URL, hostedUrl: HOSTED_URL, version: pkg.version })};`;

// --- Gehostete Version ------------------------------------------------------
const hosted = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual">
<meta name="theme-color" content="#f2f2f7">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Lernraum">
<meta name="description" content="Lernraum – Notizen, Aufgaben, Karteikarten und Handschrift fürs Studium">
<link rel="manifest" href="/icons/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<title>Lernraum</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${cfg('hosted')}</script>
<script>${js}</script>
</body>
</html>
`;

// --- Artifact-Version (ohne eigenes <html>/<head>/<body>) -------------------
const artifact = `<title>Lernraum</title>
<style>${css}</style>
<div id="app"></div>
<script>${cfg('artifact')}</script>
<script>${js}</script>
`;

mkdirSync(join(root, 'dist/site/icons'), { recursive: true });
mkdirSync(join(root, 'dist/artifact'), { recursive: true });
writeFileSync(join(root, 'dist/site/index.html'), hosted);
writeFileSync(join(root, 'dist/artifact/lernraum.html'), artifact);
if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), join(root, 'dist/site'), { recursive: true });
writeFileSync(
  join(root, 'dist/site/icons/manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'Lernraum',
      short_name: 'Lernraum',
      description: 'Notizen, Aufgaben, Karteikarten und Handschrift fürs Studium',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f2f2f7',
      theme_color: '#5856d6',
      lang: 'de',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2
  )
);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`dist/site/index.html        ${kb(hosted)}`);
console.log(`dist/artifact/lernraum.html ${kb(artifact)}`);
console.log(`Artifact-URL: ${ARTIFACT_URL || '(noch keine)'}`);
