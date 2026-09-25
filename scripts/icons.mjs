// Erzeugt PNG-Icons (Home-Bildschirm) aus public/icons/icon.svg
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const b = await chromium.launch();
for (const [name, size, pad] of [['apple-touch-icon.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  // iOS rundet selbst ab → quadratische Fläche ohne Transparenz
  const full = svg.replace('rx="112"', 'rx="0"').replace('rx="112"', 'rx="0"');
  await p.setContent(`<style>html,body{margin:0;background:#5856d6}svg{width:${size}px;height:${size}px;display:block}</style>${full}`);
  await p.screenshot({ path: 'public/icons/' + name, omitBackground: false });
  await p.close();
  void pad;
}
await b.close();
console.log('Icons erzeugt');
