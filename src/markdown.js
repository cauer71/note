// Markdown ↔ Blöcke (für Export, Einfügen und KI-Antworten)

import { newBlock } from './model.js';
import { inlineMdToHtml, htmlToInlineMd, htmlToText } from './inline.js';

export function markdownToBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const indentOf = (s) => {
    const m = /^(\s*)/.exec(s)[1].replace(/\t/g, '    ');
    return Math.min(6, Math.floor(m.length / 2));
  };
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    // Code-Fence
    const fence = /^```\s*([\w+#-]*)/.exec(t);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(newBlock('code', { lang: normLang(fence[1]), text: buf.join('\n') }));
      continue;
    }
    // Formelblock
    if (/^\$\$/.test(t)) {
      let tex = t.replace(/^\$\$/, '');
      if (tex.endsWith('$$') && tex.length > 2) {
        blocks.push(newBlock('math', { tex: tex.slice(0, -2).trim() }));
        i++;
        continue;
      }
      const buf = tex ? [tex] : [];
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) {
        const last = lines[i].replace(/\$\$\s*$/, '');
        if (last.trim()) buf.push(last);
        i++;
      }
      blocks.push(newBlock('math', { tex: buf.join('\n').trim() }));
      continue;
    }
    // Tabelle
    if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
      const rows = [];
      const parseRow = (s) =>
        s
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => inlineMdToHtml(c.trim()));
      rows.push(parseRow(t));
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) rows.push(parseRow(lines[i++]));
      const w = Math.max(...rows.map((r) => r.length));
      rows.forEach((r) => {
        while (r.length < w) r.push('');
      });
      blocks.push(newBlock('table', { rows, header: true }));
      continue;
    }
    const indent = indentOf(raw);
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) {
      blocks.push(newBlock('h' + m[1].length, { text: inlineMdToHtml(m[2]) }));
    } else if (/^#{4,6}\s+/.test(t)) {
      blocks.push(newBlock('h3', { text: inlineMdToHtml(t.replace(/^#+\s+/, '')) }));
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      blocks.push(newBlock('divider'));
    } else if ((m = /^[-*+]\s+\[( |x|X)\]\s*(.*)$/.exec(t))) {
      blocks.push(newBlock('todo', { checked: m[1] !== ' ', text: inlineMdToHtml(m[2]), indent }));
    } else if ((m = /^\[( |x|X)\]\s*(.*)$/.exec(t))) {
      blocks.push(newBlock('todo', { checked: m[1] !== ' ', text: inlineMdToHtml(m[2]), indent }));
    } else if ((m = /^[-*+•]\s+(.*)$/.exec(t))) {
      blocks.push(newBlock('ul', { text: inlineMdToHtml(m[1]), indent }));
    } else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) {
      blocks.push(newBlock('ol', { text: inlineMdToHtml(m[1]), indent }));
    } else if ((m = /^>\s?\[!(\w+)\]\s*(.*)$/.exec(t))) {
      const icons = { note: 'ℹ️', tip: '💡', important: '❗', warning: '⚠️', caution: '⚠️' };
      blocks.push(newBlock('callout', { icon: icons[m[1].toLowerCase()] || '💡', text: inlineMdToHtml(m[2]) }));
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        const last = blocks[blocks.length - 1];
        const add = inlineMdToHtml(lines[i].trim().replace(/^>\s?/, ''));
        last.text = last.text ? last.text + '<br>' + add : add;
        i++;
      }
      continue;
    } else if (/^>\s?/.test(t)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) buf.push(lines[i++].trim().replace(/^>\s?/, ''));
      blocks.push(newBlock('quote', { text: buf.map(inlineMdToHtml).join('<br>') }));
      continue;
    } else if ((m = /^(💡|📌|⚠️|❗|✅|ℹ️|📝|🎯|🔥|❓)\s+(.*)$/u.exec(t))) {
      blocks.push(newBlock('callout', { icon: m[1], text: inlineMdToHtml(m[2]) }));
    } else {
      // Absatz: folgende Zeilen ohne Leerzeile zusammenführen
      const buf = [t];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|[-*+•]\s|\d+[.)]\s|>|```|\$\$|\||-{3,}$)/.test(lines[i].trim())
      ) {
        buf.push(lines[i].trim());
        i++;
      }
      blocks.push(newBlock('p', { text: buf.map(inlineMdToHtml).join('<br>'), indent }));
      continue;
    }
    i++;
  }
  return blocks;
}

function normLang(l) {
  const x = (l || '').toLowerCase();
  const map = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', 'c++': 'cpp', md: 'markdown', text: 'plaintext', txt: 'plaintext' };
  return map[x] || x || 'plaintext';
}

export function blocksToMarkdown(blocks, ctx = {}) {
  const pageTitle = ctx.pageTitle || ((id) => id);
  const out = [];
  let olCounters = {};
  let prevType = null;
  for (const b of blocks || []) {
    const pad = '  '.repeat(b.indent || 0);
    const md = htmlToInlineMd(b.text || '', pageTitle);
    if (b.type !== 'ol') olCounters[b.indent || 0] = 0;
    const listish = ['ul', 'ol', 'todo', 'toggle'].includes(b.type);
    if (prevType && (!listish || !['ul', 'ol', 'todo', 'toggle'].includes(prevType))) out.push('');
    switch (b.type) {
      case 'h1':
        out.push('# ' + md);
        break;
      case 'h2':
        out.push('## ' + md);
        break;
      case 'h3':
        out.push('### ' + md);
        break;
      case 'ul':
      case 'toggle':
        out.push(pad + '- ' + md);
        break;
      case 'ol': {
        const k = b.indent || 0;
        olCounters[k] = (olCounters[k] || 0) + 1;
        out.push(pad + olCounters[k] + '. ' + md);
        break;
      }
      case 'todo':
        out.push(pad + '- [' + (b.checked ? 'x' : ' ') + '] ' + md);
        break;
      case 'quote':
        out.push(md.split('\n').map((l) => '> ' + l).join('\n'));
        break;
      case 'callout':
        out.push('> ' + (b.icon || '💡') + ' ' + md.split('\n').join('\n> '));
        break;
      case 'divider':
        out.push('---');
        break;
      case 'code':
        out.push('```' + (b.lang || '') + '\n' + (b.text || '') + '\n```');
        break;
      case 'math':
        out.push('$$\n' + (b.tex || '') + '\n$$');
        break;
      case 'table': {
        const rows = b.rows || [];
        if (rows.length) {
          const cells = (r) => '| ' + r.map((c) => htmlToInlineMd(c, pageTitle).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
          out.push(cells(rows[0]));
          out.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
          rows.slice(1).forEach((r) => out.push(cells(r)));
        }
        break;
      }
      case 'image':
        out.push(`![${b.caption || 'Bild'}](${b.src && b.src.startsWith('data:') ? 'eingebettetes-bild' : b.src || ''})`);
        break;
      case 'flashcards':
        out.push('**Karteikarten**');
        (b.cards || []).forEach((c) => out.push(`- **${htmlToText(c.q)}** — ${htmlToText(c.a)}`));
        break;
      case 'quiz':
        out.push('**Quiz**');
        (b.questions || []).forEach((q, i) => {
          out.push(`${i + 1}. ${q.q}`);
          (q.options || []).forEach((o, j) => out.push(`   - [${j === q.correct ? 'x' : ' '}] ${o}`));
        });
        break;
      case 'page':
        out.push(`[[${pageTitle(b.pageId)}]]`);
        break;
      case 'database':
        out.push(`[[${pageTitle(b.pageId)}]] (Datenbank)`);
        break;
      case 'drawing':
        out.push('*(Handschriftliche Notiz)*');
        break;
      case 'toc':
        break;
      default:
        out.push(pad + md);
    }
    prevType = b.type;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// Grobe Klartextfassung einer Seite (für Suche und KI-Kontext)
export function blocksToPlain(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.text && b.type !== 'code') out.push(htmlToText(b.text));
    else if (b.type === 'code') out.push(b.text || '');
    if (b.type === 'math') out.push(b.tex || '');
    if (b.type === 'table') (b.rows || []).forEach((r) => out.push(r.map(htmlToText).join(' | ')));
    if (b.type === 'flashcards') (b.cards || []).forEach((c) => out.push(htmlToText(c.q) + ' – ' + htmlToText(c.a)));
    if (b.type === 'quiz') (b.questions || []).forEach((q) => out.push(q.q));
    if (b.type === 'image' && b.caption) out.push(b.caption);
  }
  return out.join('\n');
}

// Einfaches Markdown → HTML für die Anzeige von KI-Antworten
export function mdToHtmlPreview(md) {
  const blocks = markdownToBlocks(md);
  const parts = [];
  let listOpen = null;
  const close = () => {
    if (listOpen) parts.push(`</${listOpen}>`);
    listOpen = null;
  };
  for (const b of blocks) {
    const tag = b.type === 'ol' ? 'ol' : b.type === 'ul' || b.type === 'todo' || b.type === 'toggle' ? 'ul' : null;
    if (tag !== listOpen) close();
    if (tag && !listOpen) {
      parts.push(`<${tag}>`);
      listOpen = tag;
    }
    switch (b.type) {
      case 'h1':
      case 'h2':
      case 'h3':
        parts.push(`<${b.type === 'h1' ? 'h3' : 'h4'}>${b.text}</${b.type === 'h1' ? 'h3' : 'h4'}>`);
        break;
      case 'ul':
      case 'ol':
      case 'toggle':
        parts.push(`<li style="margin-left:${(b.indent || 0) * 1.2}em">${b.text}</li>`);
        break;
      case 'todo':
        parts.push(`<li class="md-todo" style="margin-left:${(b.indent || 0) * 1.2}em">${b.checked ? '☑' : '☐'} ${b.text}</li>`);
        break;
      case 'quote':
      case 'callout':
        parts.push(`<blockquote>${b.icon ? b.icon + ' ' : ''}${b.text}</blockquote>`);
        break;
      case 'code':
        parts.push(`<pre><code>${escape(b.text)}</code></pre>`);
        break;
      case 'math':
        parts.push(`<div class="math-block-preview"><span class="math display" data-tex="${escape(b.tex)}"></span></div>`);
        break;
      case 'divider':
        parts.push('<hr>');
        break;
      case 'table':
        parts.push(
          '<div class="md-table"><table>' +
            b.rows.map((r, i) => '<tr>' + r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>').join('') +
            '</table></div>'
        );
        break;
      default:
        parts.push(`<p>${b.text}</p>`);
    }
  }
  close();
  return parts.join('');
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
