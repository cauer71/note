// Erzeugt alle Bild-Assets der Web-App aus src/brand.js:
//   App-Symbole (iOS, Android „any“ + „maskable“), Favicon, Kurzbefehl-Symbole, iOS-Startbilder
//   und – mit --screens – Screenshots fürs Android-Installationsfenster (braucht npm run build).
// node scripts/icons.mjs [--screens] [--preview <datei.png>]
import { chromium, devices } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { iconSvg, splashMarkup, SPLASH_CSS, SPLASH_BG, startupImages, BRAND } from '../src/brand.js';
import { I } from '../src/icons.js';

const OUT = 'public/icons';
// Androids Maske: Pflichtbereich ist ein Kreis mit 40 % Radius → Zeichnung passend verkleinern
export const MASKABLE_SCALE = 0.86;
const args = process.argv.slice(2);
mkdirSync(OUT + '/startup', { recursive: true });

const b = await chromium.launch();
async function png(path, html, width, height, dpr = 1) {
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  await p.setContent(`<!doctype html><style>html,body{margin:0;overflow:hidden}svg{display:block}</style>${html}`);
  await p.waitForTimeout(30);
  await p.screenshot({ path });
  await p.close();
}
const sized = (svg, n) => svg.replace('<svg ', `<svg width="${n}" height="${n}" `);

if (args[0] === '--preview') {
  // Kontrollbild: iOS-Maske, Android-Kreis/Squircle, kleine Größen, hell/dunkel
  const any = iconSvg({ id: 'a' });
  const mask = iconSvg({ id: 'm', scale: MASKABLE_SCALE });
  const tile = (svg, n, radius, extra = '') => `<div style="width:${n}px;height:${n}px;border-radius:${radius};overflow:hidden;${extra}">${sized(svg, n)}</div>`;
  const row = (bg, fg) => `<div style="display:flex;gap:28px;align-items:center;padding:24px;background:${bg};color:${fg};font:13px system-ui">
    ${tile(any, 180, '22.4%')} ${tile(any, 60, '22.4%')} ${tile(any, 40, '22.4%')}
    ${tile(mask, 180, '50%')} ${tile(mask, 180, '30%')} ${tile(mask, 60, '50%')}
    <div style="position:relative;width:180px;height:180px">${sized(mask, 180)}<div style="position:absolute;inset:18px;border:2px dashed #ff3b30;border-radius:50%"></div></div>
  </div>`;
  await png(args[1] || 'icon-preview.png', row('#e9e6f5', '#000') + row('#1c1c1e', '#fff'), 1320, 460);
  await b.close();
  process.exit(0);
}

// App-Symbole: randlos, iOS rundet selbst ab
writeFileSync(OUT + '/icon.svg', iconSvg({ id: 'fav', rounded: true }) + '\n');
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) await png(`${OUT}/${name}`, sized(iconSvg({ id: 'i' }), size), size, size);
for (const size of [192, 512]) await png(`${OUT}/icon-maskable-${size}.png`, sized(iconSvg({ id: 'm', scale: MASKABLE_SCALE }), size), size, size);

// Kurzbefehle (Android: langes Drücken auf das App-Symbol)
for (const [name, icon] of [['neu', I.pen], ['heute', I.calendar], ['lernen', I.cards], ['suche', I.search]]) {
  const glyph = icon.replace('width="1em" height="1em"', 'width="52" height="52"').replace('stroke-width="1.8"', 'stroke-width="2.1"');
  await png(`${OUT}/shortcut-${name}.png`, `<div style="width:96px;height:96px;display:grid;place-items:center;background:${BRAND};color:#fff">${glyph}</div>`, 96, 96);
}

// iOS-Startbilder: exakt der erste Frame der Startanimation
const startHtml = `<style>${SPLASH_CSS}body{background:${SPLASH_BG}}</style>${splashMarkup().replace('id="splash"', 'id="splash" class="sp-static"')}`;
for (const img of startupImages()) await png(`${OUT}/startup/${img.file}`, startHtml, img.width, img.height, img.dpr);

if (args.includes('--screens')) {
  // Screenshots fürs Installationsfenster (Android „narrow“ = Handy, „wide“ = Tablet/Desktop)
  mkdirSync(OUT + '/screens', { recursive: true });
  const server = spawn('node', ['scripts/serve.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '4199' } });
  await new Promise((r) => setTimeout(r, 800));
  const shots = [
    ['phone-heute', devices['iPhone 15 Pro'], '#heute'],
    ['phone-notiz', devices['iPhone 15 Pro'], '#seed-ana-vl3'],
    ['phone-aufgaben', devices['iPhone 15 Pro'], '#seed-aufgaben'],
    ['tablet-notiz', devices['iPad Pro 11 landscape'], '#seed-ana-vl3'],
    ['tablet-handschrift', devices['iPad Pro 11 landscape'], '#seed-handschrift'],
  ];
  for (const [name, dev, hash] of shots) {
    const ctx = await b.newContext({ ...dev, deviceScaleFactor: name.startsWith('phone') ? 3 : 2, colorScheme: 'light' });
    await ctx.addInitScript(() => localStorage.setItem('lr:installCardHidden', 'true'));
    const p = await ctx.newPage();
    await p.goto(`http://localhost:4199/?local=screens-${name}${hash}`);
    await p.waitForFunction(() => window.lernraum && window.lernraum.pages.size > 5 && !document.getElementById('splash'));
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/screens/${name}.jpg`, type: 'jpeg', quality: 82 });
    await ctx.close();
  }
  server.kill();
}

await b.close();
console.log('Symbole, Kurzbefehle und', startupImages().length, 'Startbilder erzeugt');
