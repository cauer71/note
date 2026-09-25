// Statischer Testserver: dist/site unter /, Artifact-Version unter /artifact.html
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const port = Number(process.env.PORT || 4173);
const root = join(process.cwd(), 'dist/site');
const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/artifact.html') {
    // Wie der Claude-Viewer: Inhalt in ein HTML-Gerüst einbetten
    const body = readFileSync(join(process.cwd(), 'dist/artifact/lernraum.html'), 'utf8');
    res.writeHead(200, { 'content-type': types['.html'] });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`);
    return;
  }
  if (p.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"kein Backend"}');
    return;
  }
  let f = join(root, p);
  if (p === '/' || !existsSync(f) || statSync(f).isDirectory()) f = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(port, () => console.log('Testserver auf http://localhost:' + port));
