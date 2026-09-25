// Kontaktabzug: node scripts/contact.mjs <ordner> <muster> <ausgabe.png> [spalten] [breite]
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
const [dir, pattern, outFile, cols = '4', width = '1800'] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => new RegExp(pattern).test(f) && f.endsWith('.png')).sort();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(width), height: 800 } });
const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(dir + '/' + f).toString('base64')}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`).join('');
await p.setContent(`<style>body{margin:0;background:#888;font:13px sans-serif}.g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px}figure{margin:0;background:#fff}img{width:100%;display:block}figcaption{padding:2px 4px}</style><div class="g">${imgs}</div>`);
await p.waitForTimeout(300);
await p.screenshot({ path: outFile, fullPage: true });
await b.close();
console.log(files.length + ' Bilder');
