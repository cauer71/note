// Spezialblöcke: Code, Formel, Bild, Tabelle, Inhaltsverzeichnis, Unterseite, Trennlinie

import { h, svg, escapeHtml, toast, copyText, compressImage, mod } from './util.js';
import { I } from './icons.js';
import { sanitizeInline, htmlToText } from './inline.js';
import { newBlock, pageTitle } from './model.js';
import { menu, modal } from './menus.js';
import { renderDrawing } from './drawing.js';
import { renderFlashcards, renderQuiz } from './learn.js';
import { renderDatabaseInline } from './database.js';

export const CODE_LANGS = [
  ['plaintext', 'Klartext'],
  ['python', 'Python'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['sql', 'SQL'],
  ['r', 'R'],
  ['matlab', 'MATLAB'],
  ['bash', 'Bash'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['latex', 'LaTeX'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['kotlin', 'Kotlin'],
  ['swift', 'Swift'],
];

// ---------------------------------------------------------------------------
// KaTeX / highlight.js (per CDN geladen, bei Bedarf nachgerendert)
// ---------------------------------------------------------------------------
export function renderMathIn(root) {
  if (!root) return;
  root.querySelectorAll('.math').forEach((span) => renderMath(span));
}

export function renderMath(span) {
  const tex = span.getAttribute('data-tex') || '';
  span.setAttribute('contenteditable', 'false');
  const display = span.classList.contains('display');
  if (window.katex) {
    try {
      window.katex.render(tex || '\\square', span, { throwOnError: false, displayMode: display, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
    } catch {
      span.textContent = tex;
    }
  } else span.textContent = tex;
}

export function highlight(code, lang) {
  if (window.hljs && lang && lang !== 'plaintext' && window.hljs.getLanguage(lang)) {
    try {
      return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* Fallback */
    }
  }
  return escapeHtml(code);
}

// ---------------------------------------------------------------------------
export function renderSpecialBlock(ed, b) {
  switch (b.type) {
    case 'divider':
      return selectable(ed, b, h('div', { class: 'divider', tabindex: '-1' }, h('hr')));
    case 'code':
      return renderCode(ed, b);
    case 'math':
      return renderMathBlock(ed, b);
    case 'image':
      return renderImage(ed, b);
    case 'table':
      return renderTable(ed, b);
    case 'toc':
      return selectable(ed, b, renderToc(ed, b));
    case 'page':
      return renderPageLink(ed, b);
    case 'database':
      return renderDatabaseInline(ed, b);
    case 'flashcards':
      return renderFlashcards(ed, b);
    case 'quiz':
      return renderQuiz(ed, b);
    case 'drawing':
      return renderDrawing(ed, b);
    default:
      return h('div', { class: 'unknown' }, 'Unbekannter Block: ' + b.type);
  }
}

function selectable(ed, b, el) {
  el.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, textarea, [contenteditable="true"]')) return;
    ed.selectBlocks([b.id]);
  });
  return el;
}

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------
function renderCode(ed, b) {
  const code = h('code', { class: 'hljs' });
  const pre = h('pre', { class: 'code-pre', 'aria-hidden': 'true' }, code);
  const ta = h('textarea', {
    class: 'code-ta',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    rows: '1',
    'aria-label': 'Code',
    placeholder: '// Code eingeben',
  });
  ta.value = b.text || '';
  const langName = () => (CODE_LANGS.find((l) => l[0] === b.lang) || [b.lang, b.lang || 'Klartext'])[1];
  const langBtn = h('button', { class: 'code-lang', type: 'button' }, h('span', {}, langName()), svg(I.chevronDown));
  const sync = () => {
    code.innerHTML = highlight(ta.value, b.lang) + '\n';
  };
  sync();
  langBtn.addEventListener('click', () => {
    menu(
      langBtn,
      CODE_LANGS.map(([id, label]) => ({
        label,
        checked: b.lang === id,
        onSelect: () => {
          b.lang = id;
          langBtn.firstChild.textContent = label;
          const cb = langBtn.closest('.code-block');
          if (cb) cb.dataset.lang = id;
          sync();
          ed.changed(b, true);
        },
      })),
      { search: true, title: 'Sprache' }
    );
  });
  const copyBtn = h(
    'button',
    {
      class: 'code-copy',
      type: 'button',
      onclick: () => {
        copyText(ta.value);
        toast('Code kopiert');
      },
    },
    svg(I.copy),
    h('span', {}, 'Kopieren')
  );
  ta.addEventListener('input', () => {
    ed.history.typing();
    b.text = ta.value;
    sync();
    ed.app.touch(ed.page);
  });
  ta.addEventListener('keydown', (e) => {
    const v = ta.value;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        if (v.slice(ls, ls + 2) === '  ') {
          ta.setRangeText('', ls, ls + 2, 'end');
          ta.setSelectionRange(Math.max(ls, s - 2), Math.max(ls, en - 2));
        }
      } else ta.setRangeText('  ', s, en, 'end');
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'Enter' && mod(e)) {
      e.preventDefault();
      ed.insertAfter(b.id, newBlock('p', { indent: b.indent || 0 }));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const ws = /^[ \t]*/.exec(v.slice(ls))[0];
      const extra = /[{:(\[]\s*$/.test(v.slice(ls, s)) ? '  ' : '';
      ta.setRangeText('\n' + ws + extra, s, en, 'end');
      ta.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'Backspace' && !v) {
      e.preventDefault();
      ed.changeType(b, 'p', { offset: 0 });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      ed.selectBlocks([b.id]);
      return;
    }
    if (e.key === 'ArrowUp' && s === en && v.lastIndexOf('\n', s - 1) === -1) {
      e.preventDefault();
      ed.focusNeighbor(ed.indexOf(b.id), -1, null, 'end');
      return;
    }
    if (e.key === 'ArrowDown' && s === en && v.indexOf('\n', s) === -1) {
      e.preventDefault();
      if (!ed.focusNeighbor(ed.indexOf(b.id), 1, null, 'start')) ed.insertAfter(b.id, newBlock('p'));
    }
  });
  ta.addEventListener('focus', () => ed.app.onEditorFocus && ed.app.onEditorFocus(ed, b, ta));
  return h(
    'div',
    { class: 'code-block', 'data-lang': b.lang || 'plaintext' },
    h('div', { class: 'code-head' }, langBtn, copyBtn),
    h('div', { class: 'code-edit' }, pre, ta)
  );
}

// ---------------------------------------------------------------------------
// Formel (Block)
// ---------------------------------------------------------------------------
function renderMathBlock(ed, b) {
  const out = h('div', { class: 'math-render' });
  const ta = h('textarea', { class: 'math-src mono', rows: '2', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', placeholder: 'z. B. \\int_0^1 x^2\\,dx = \\tfrac{1}{3}' });
  ta.value = b.tex || '';
  const help = h('div', { class: 'math-help' }, h('span', {}, 'LaTeX · ', h('kbd', {}, '⏎'), ' schließt, ', h('kbd', {}, '⇧⏎'), ' neue Zeile'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => close() }, 'Fertig'));
  const editor = h('div', { class: 'math-editor', hidden: true }, ta, help);
  const wrap = h('div', { class: 'math-block', 'data-open': '', tabindex: '0' }, out, editor);
  const draw = () => {
    out.innerHTML = '';
    if (!ta.value.trim()) {
      out.appendChild(h('div', { class: 'math-empty' }, svg(I.math), ' Formel hinzufügen'));
      return;
    }
    const span = h('span', { class: 'math display', 'data-tex': ta.value });
    out.appendChild(span);
    renderMath(span);
  };
  draw();
  const open = () => {
    if (!editor.hidden) return;
    editor.hidden = false;
    wrap.classList.add('editing');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  };
  const close = () => {
    editor.hidden = true;
    wrap.classList.remove('editing');
    if (!ta.value.trim() && !b.tex) return;
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.math-editor')) return;
    open();
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.target === wrap && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
    }
  });
  ta.addEventListener('input', () => {
    ed.history.typing();
    b.tex = ta.value;
    draw();
    ed.app.touch(ed.page);
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
      e.preventDefault();
      close();
      const idx = ed.indexOf(b.id);
      if (e.key === 'Enter') {
        if (!ed.focusNeighbor(idx, 1, null, 'start')) ed.insertAfter(b.id, newBlock('p'));
      } else ed.selectBlocks([b.id]);
    }
  });
  ta.addEventListener('blur', () => setTimeout(() => !wrap.contains(document.activeElement) && close(), 150));
  return wrap;
}

// ---------------------------------------------------------------------------
// Bild
// ---------------------------------------------------------------------------
function renderImage(ed, b) {
  const wrap = h('div', { class: 'image-block' });
  const pick = (capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      try {
        const img = await compressImage(f);
        b.src = img.dataUrl;
        b.w = img.width;
        b.h = img.height;
        ed.cacheBlobs(b);
        ed.rerenderBlock(b);
        ed.changed(b, true);
      } catch {
        toast('Bild konnte nicht gelesen werden', { kind: 'error' });
      }
    });
    document.body.appendChild(input);
    input.click();
  };
  if (!b.src) {
    const ph = h(
      'div',
      { class: 'image-empty' },
      svg(I.image, 'image-empty-ico'),
      h('div', { class: 'image-empty-text' }, 'Bild hinzufügen'),
      h(
        'div',
        { class: 'image-empty-actions' },
        h('button', { class: 'btn btn-tinted', type: 'button', 'data-open': '', onclick: () => pick(false) }, svg(I.image), ' Foto wählen'),
        h('button', { class: 'btn btn-tinted', type: 'button', onclick: () => pick(true) }, svg(I.camera), ' Kamera')
      )
    );
    wrap.appendChild(ph);
    return wrap;
  }
  const img = h('img', { src: b.src, alt: b.caption || 'Bild', loading: 'lazy', draggable: 'false' });
  if (b.w && b.h) img.style.aspectRatio = `${b.w} / ${b.h}`;
  img.addEventListener('click', () => {
    const m = modal(h('div', { class: 'lightbox' }, h('img', { src: b.src, alt: b.caption || 'Bild' })), { class: 'modal-lightbox', title: b.caption || 'Bild' });
    return m;
  });
  const cap = h('div', { class: 'image-caption', contenteditable: 'true', 'data-ph': 'Bildunterschrift …', spellcheck: 'true' });
  cap.textContent = b.caption || '';
  cap.addEventListener('input', () => {
    b.caption = cap.textContent;
    ed.app.touch(ed.page);
  });
  cap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = ed.indexOf(b.id);
      if (!ed.focusNeighbor(idx, 1, null, 'start')) ed.insertAfter(b.id, newBlock('p'));
    }
  });
  const actions = h('div', { class: 'image-actions' });
  if (ed.app.ai && ed.app.ai.available) {
    actions.appendChild(h('button', { class: 'glass-chip', type: 'button', onclick: (e) => ed.app.ai.imageActions(ed, b, e.currentTarget) }, svg(I.sparkle), ' Auswerten'));
  }
  actions.appendChild(h('button', { class: 'glass-chip', type: 'button', onclick: () => pick(false), 'aria-label': 'Bild ersetzen' }, svg(I.refresh)));
  actions.appendChild(h('button', { class: 'glass-chip', type: 'button', onclick: () => ed.removeBlock(b.id), 'aria-label': 'Bild löschen' }, svg(I.trash)));
  wrap.append(h('figure', { class: 'image-fig' }, img, actions), cap);
  return wrap;
}

// ---------------------------------------------------------------------------
// Tabelle
// ---------------------------------------------------------------------------
function renderTable(ed, b) {
  if (!b.rows || !b.rows.length) b.rows = [['']];
  const wrap = h('div', { class: 'tbl-block' });
  const scroller = h('div', { class: 'tbl-scroll' });
  const table = h('table', { class: 'tbl' + (b.header ? ' has-header' : '') });
  let focus = { r: 0, c: 0 };
  const build = (fr, fc) => {
    table.innerHTML = '';
    table.className = 'tbl' + (b.header ? ' has-header' : '');
    b.rows.forEach((row, r) => {
      const tr = h('tr');
      row.forEach((cell, c) => {
        const div = h('div', { class: 'tbl-cell', contenteditable: 'true', 'data-r': r, 'data-c': c, spellcheck: 'true' });
        div.innerHTML = cell || '';
        tr.appendChild(h(r === 0 && b.header ? 'th' : 'td', {}, div));
      });
      table.appendChild(tr);
    });
    if (fr != null) {
      const t = table.querySelector(`.tbl-cell[data-r="${fr}"][data-c="${fc}"]`);
      if (t) {
        t.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(t);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };
  build();
  const addRow = (at) => {
    ed.history.structural();
    b.rows.splice(at, 0, b.rows[0].map(() => ''));
    ed.app.touch(ed.page);
  };
  const addCol = (at) => {
    ed.history.structural();
    b.rows.forEach((r) => r.splice(at, 0, ''));
    ed.app.touch(ed.page);
  };
  table.addEventListener('input', (e) => {
    const cell = e.target.closest('.tbl-cell');
    if (!cell) return;
    ed.history.typing();
    b.rows[+cell.dataset.r][+cell.dataset.c] = sanitizeInline(cell.innerHTML);
    ed.app.touch(ed.page);
  });
  table.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.tbl-cell');
    if (!cell) return;
    focus = { r: +cell.dataset.r, c: +cell.dataset.c };
    wrap.classList.add('active');
  });
  table.addEventListener('focusout', () => setTimeout(() => !wrap.contains(document.activeElement) && wrap.classList.remove('active'), 100));
  table.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.tbl-cell');
    if (!cell) return;
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    const rows = b.rows.length;
    const cols = b.rows[0].length;
    if (e.key === 'Tab') {
      e.preventDefault();
      let nr = r;
      let nc = c + (e.shiftKey ? -1 : 1);
      if (nc >= cols) {
        nc = 0;
        nr++;
      }
      if (nc < 0) {
        nc = cols - 1;
        nr--;
      }
      if (nr < 0) return;
      if (nr >= rows) {
        addRow(rows);
        build(nr, nc);
        return;
      }
      build(nr, nc);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (r + 1 >= rows) addRow(rows);
      build(r + 1, c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      ed.selectBlocks([b.id]);
    }
  });
  const toolbar = h(
    'div',
    { class: 'tbl-tools' },
    h('button', { class: 'glass-chip', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { addRow(focus.r + 1); build(focus.r + 1, focus.c); } }, svg(I.plus), ' Zeile'),
    h('button', { class: 'glass-chip', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => { addCol(focus.c + 1); build(focus.r, focus.c + 1); } }, svg(I.plus), ' Spalte'),
    h(
      'button',
      {
        class: 'glass-chip',
        type: 'button',
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) =>
          menu(e.currentTarget, [
            { label: 'Kopfzeile', checked: !!b.header, onSelect: () => { ed.history.structural(); b.header = !b.header; build(); ed.app.touch(ed.page); } },
            { divider: true },
            { label: 'Zeile darüber einfügen', icon: I.arrowUp, onSelect: () => { addRow(focus.r); build(focus.r, focus.c); } },
            { label: 'Spalte links einfügen', icon: I.chevronLeft, onSelect: () => { addCol(focus.c); build(focus.r, focus.c); } },
            { divider: true },
            { label: 'Zeile löschen', icon: I.trash, danger: true, disabled: b.rows.length < 2, onSelect: () => { ed.history.structural(); b.rows.splice(focus.r, 1); build(Math.max(0, focus.r - 1), focus.c); ed.app.touch(ed.page); } },
            { label: 'Spalte löschen', icon: I.trash, danger: true, disabled: b.rows[0].length < 2, onSelect: () => { ed.history.structural(); b.rows.forEach((r) => r.splice(focus.c, 1)); build(focus.r, Math.max(0, focus.c - 1)); ed.app.touch(ed.page); } },
          ], { title: 'Tabelle' }),
      },
      svg(I.more)
    )
  );
  scroller.appendChild(table);
  wrap.append(scroller, toolbar);
  return wrap;
}

// ---------------------------------------------------------------------------
// Inhaltsverzeichnis
// ---------------------------------------------------------------------------
function renderToc(ed, b) {
  const box = h('nav', { class: 'toc', 'aria-label': 'Inhaltsverzeichnis' });
  box._update = () => {
    box.innerHTML = '';
    const heads = ed.blocks.filter((x) => /^h[123]$/.test(x.type) && htmlToText(x.text).trim());
    if (!heads.length) {
      box.appendChild(h('div', { class: 'toc-empty' }, 'Füge Überschriften hinzu, um ein Inhaltsverzeichnis zu erhalten.'));
      return;
    }
    for (const x of heads) {
      box.appendChild(
        h(
          'button',
          {
            class: 'toc-item toc-' + x.type,
            type: 'button',
            onclick: () => {
              const el = ed.els.get(x.id);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          },
          htmlToText(x.text)
        )
      );
    }
  };
  box._update();
  box.classList.add('toc-live');
  return box;
}

export function updateTocs(ed) {
  ed.root.querySelectorAll('.toc-live').forEach((t) => t._update && t._update());
}

// ---------------------------------------------------------------------------
// Unterseite
// ---------------------------------------------------------------------------
function renderPageLink(ed, b) {
  const p = ed.app.getPage(b.pageId);
  const btn = h(
    'button',
    {
      class: 'page-link' + (!p || p.trashed ? ' missing' : ''),
      type: 'button',
      'data-open': '',
      onclick: () => {
        if (p && !p.trashed) ed.app.navigate(p.id);
        else toast('Diese Seite liegt im Papierkorb');
      },
    },
    h('span', { class: 'page-link-ico' }, p && p.icon ? h('span', { class: 'emoji' }, p.icon) : svg(p && p.kind === 'database' ? I.database : I.pageText)),
    h('span', { class: 'page-link-title' }, p ? pageTitle(p) : 'Gelöschte Seite'),
    svg(I.chevronRight, 'page-link-chev')
  );
  return btn;
}
