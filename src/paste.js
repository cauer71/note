// HTML aus der Zwischenablage (Webseiten, Word, Google Docs) → Blöcke

import { newBlock } from './model.js';
import { sanitizeInline } from './inline.js';

export function htmlToBlocks(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const blocks = [];
  const pushText = (type, el, extra = {}) => {
    const text = sanitizeInline(el.innerHTML).trim();
    if (!text && type === 'p') return;
    blocks.push(newBlock(type, Object.assign({ text }, extra)));
  };
  function walkList(list, indent) {
    const ordered = list.tagName === 'OL';
    for (const li of list.children) {
      if (li.tagName !== 'LI') continue;
      const clone = li.cloneNode(true);
      clone.querySelectorAll('ul, ol').forEach((n) => n.remove());
      const cb = clone.querySelector('input[type=checkbox]');
      if (cb) {
        const checked = cb.checked || cb.hasAttribute('checked');
        cb.remove();
        blocks.push(newBlock('todo', { text: sanitizeInline(clone.innerHTML).trim(), indent, checked }));
      } else blocks.push(newBlock(ordered ? 'ol' : 'ul', { text: sanitizeInline(clone.innerHTML).trim(), indent }));
      for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') walkList(sub, Math.min(6, indent + 1));
    }
  }
  function walk(node) {
    for (const el of node.childNodes) {
      if (el.nodeType === 3) {
        if (el.nodeValue.trim()) blocks.push(newBlock('p', { text: sanitizeInline(el.nodeValue.trim()) }));
        continue;
      }
      if (el.nodeType !== 1) continue;
      const tag = el.tagName;
      if (/^H[1-6]$/.test(tag)) pushText('h' + Math.min(3, Number(tag[1])), el);
      else if (tag === 'P') pushText('p', el);
      else if (tag === 'UL' || tag === 'OL') walkList(el, 0);
      else if (tag === 'BLOCKQUOTE') pushText('quote', el);
      else if (tag === 'PRE') blocks.push(newBlock('code', { text: el.textContent.replace(/\n$/, ''), lang: 'plaintext' }));
      else if (tag === 'HR') blocks.push(newBlock('divider'));
      else if (tag === 'TABLE') {
        const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => sanitizeInline(td.innerHTML).trim()));
        const w = Math.max(0, ...rows.map((r) => r.length));
        if (w) {
          rows.forEach((r) => {
            while (r.length < w) r.push('');
          });
          blocks.push(newBlock('table', { rows, header: !!el.querySelector('th') }));
        }
      } else if (tag === 'IMG') {
        /* externe Bilder werden nicht übernommen */
      } else if (el.querySelector('p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,div,li,hr')) {
        // Container (auch Google Docs' <b id="docs-internal-guid-…">) → hineingehen
        walk(el);
      } else if (['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'SPAN', 'FONT', 'CENTER'].includes(tag)) {
        pushText('p', el);
      } else if (['STYLE', 'SCRIPT', 'META', 'TITLE', 'HEAD', 'LINK'].includes(tag)) {
        continue;
      } else pushText('p', el);
    }
  }
  walk(tpl.content);
  return blocks;
}
