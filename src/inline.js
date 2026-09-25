// Inline-Formatierung: Bereinigen von HTML, Caret-Helfer, Inline-Markdown

import { escapeHtml } from './util.js';

const ALLOWED = new Set(['B', 'I', 'U', 'S', 'CODE', 'A', 'SPAN', 'BR', 'MARK']);
const RENAME = { STRONG: 'B', EM: 'I', DEL: 'S', STRIKE: 'S', INS: 'U' };
export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export const COLOR_LABELS = {
  default: 'Standard',
  gray: 'Grau',
  brown: 'Braun',
  orange: 'Orange',
  yellow: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
  purple: 'Lila',
  pink: 'Pink',
  red: 'Rot',
};

// Erlaubt nur ein kleines, sicheres Inline-Vokabular.
export function sanitizeInline(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = document.createElement('div');
  walk(tpl.content, out);
  let res = out.innerHTML;
  // Ein einzelnes abschließendes <br> ist in contenteditable nur ein Platzhalter
  res = res.replace(/(<br>)+$/, (m) => (m.length > 4 ? m.slice(4) : ''));
  if (res === '<br>') res = '';
  return res;
}

function walk(src, dst) {
  for (const node of Array.from(src.childNodes)) {
    if (node.nodeType === 3) {
      dst.appendChild(document.createTextNode(node.nodeValue.replace(/​/g, '')));
      continue;
    }
    if (node.nodeType !== 1) continue;
    let tag = node.tagName;
    tag = RENAME[tag] || tag;

    if (tag === 'SPAN' && node.classList.contains('math')) {
      const tex = node.getAttribute('data-tex') || '';
      const span = document.createElement('span');
      span.className = 'math';
      span.setAttribute('data-tex', tex);
      dst.appendChild(span);
      continue;
    }
    if (tag === 'A' && node.classList.contains('mention')) {
      const a = document.createElement('a');
      a.className = 'mention';
      a.setAttribute('data-page', node.getAttribute('data-page') || '');
      a.textContent = node.textContent;
      dst.appendChild(a);
      continue;
    }
    if (tag === 'DIV' || tag === 'P') {
      // Zeilen in einem Block → Zeilenumbruch
      if (dst.childNodes.length) dst.appendChild(document.createElement('br'));
      walk(node, dst);
      continue;
    }
    if (tag === 'FONT') {
      walk(node, dst);
      continue;
    }
    if (!ALLOWED.has(tag)) {
      walk(node, dst);
      continue;
    }
    const el = document.createElement(tag);
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^(https?:|mailto:|tel:|#)/i.test(href)) el.setAttribute('href', href);
      else if (href && !/^[a-z]+:/i.test(href)) el.setAttribute('href', 'https://' + href);
    }
    if (tag === 'SPAN' || tag === 'MARK') {
      const c = node.getAttribute('data-color');
      const bg = node.getAttribute('data-bg');
      if (c && COLORS.includes(c)) el.setAttribute('data-color', c);
      if (bg && COLORS.includes(bg)) el.setAttribute('data-bg', bg);
      if (!el.hasAttribute('data-color') && !el.hasAttribute('data-bg')) {
        walk(node, dst);
        continue;
      }
    }
    if (tag === 'BR') {
      dst.appendChild(el);
      continue;
    }
    walk(node, el);
    if (!el.childNodes.length) continue;
    dst.appendChild(el);
  }
}

export function htmlToText(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
  d.querySelectorAll('.math').forEach((m) => (m.textContent = m.getAttribute('data-tex') || ''));
  return d.textContent || '';
}

export function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// Inline-Markdown ↔ HTML
// ---------------------------------------------------------------------------

export function inlineMdToHtml(md) {
  if (!md) return '';
  let s = escapeHtml(md);
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/\$\$([^$]+)\$\$/g, (_, t) => keep(`<span class="math" data-tex="${t}"></span>`));
  s = s.replace(/\$([^$\n]+?)\$/g, (_, t) => keep(`<span class="math" data-tex="${t}"></span>`));
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => keep(`<a href="${u}">${t}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_]+)__/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/==([^=]+)==/g, '<span data-bg="yellow">$1</span>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  return s.replace(/\n/g, '<br>');
}

export function htmlToInlineMd(html, pageTitle = (id) => id) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  return nodeToMd(d, pageTitle);
}

function nodeToMd(node, pageTitle) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      out += n.nodeValue;
      continue;
    }
    if (n.nodeType !== 1) continue;
    const inner = () => nodeToMd(n, pageTitle);
    switch (n.tagName) {
      case 'B':
      case 'STRONG':
        out += `**${inner()}**`;
        break;
      case 'I':
      case 'EM':
        out += `*${inner()}*`;
        break;
      case 'S':
        out += `~~${inner()}~~`;
        break;
      case 'U':
        out += inner();
        break;
      case 'CODE':
        out += '`' + n.textContent + '`';
        break;
      case 'BR':
        out += '\n';
        break;
      case 'A':
        if (n.classList.contains('mention')) out += `[[${pageTitle(n.getAttribute('data-page')) || n.textContent}]]`;
        else out += `[${inner()}](${n.getAttribute('href') || ''})`;
        break;
      case 'SPAN':
        if (n.classList.contains('math')) out += `$${n.getAttribute('data-tex') || ''}$`;
        else if (n.getAttribute('data-bg') === 'yellow') out += `==${inner()}==`;
        else out += inner();
        break;
      default:
        out += inner();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caret / Selektion
// ---------------------------------------------------------------------------

export function getSelectionRange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  return sel.getRangeAt(0);
}

// Textoffset des Carets innerhalb eines Elements (BR zählt als \n, Mathe als 1 Zeichen)
export function getCaretOffset(el) {
  const r = getSelectionRange();
  if (!r || !el.contains(r.startContainer)) return -1;
  return offsetFromPoint(el, r.startContainer, r.startOffset);
}

export function getSelectionOffsets(el) {
  const r = getSelectionRange();
  if (!r || !el.contains(r.startContainer)) return null;
  return {
    start: offsetFromPoint(el, r.startContainer, r.startOffset),
    end: offsetFromPoint(el, r.endContainer, r.endOffset),
  };
}

function nodeLen(n) {
  if (n.nodeType === 3) return n.nodeValue.length;
  if (n.nodeName === 'BR') return 1;
  if (n.nodeType === 1 && n.classList && n.classList.contains('math')) return 1;
  let len = 0;
  for (const c of n.childNodes) len += nodeLen(c);
  return len;
}

function offsetFromPoint(root, container, offset) {
  let total = 0;
  let found = false;
  function visit(node) {
    if (found) return;
    if (node === container) {
      if (node.nodeType === 3) total += offset;
      else {
        for (let i = 0; i < offset && i < node.childNodes.length; i++) total += nodeLen(node.childNodes[i]);
      }
      found = true;
      return;
    }
    if (node.nodeType === 3) {
      total += node.nodeValue.length;
      return;
    }
    if (node.nodeName === 'BR') {
      total += 1;
      return;
    }
    if (node.nodeType === 1 && node.classList && node.classList.contains('math')) {
      if (node.contains(container)) {
        found = true;
        total += 1;
        return;
      }
      total += 1;
      return;
    }
    for (const c of node.childNodes) {
      visit(c);
      if (found) return;
    }
  }
  visit(root);
  return total;
}

export function textLength(el) {
  return nodeLen(el);
}

// Text mit denselben Offsets wie die Caret-Helfer (Formel = 1 Zeichen, <br> = \n)
export function offsetText(el) {
  let out = '';
  const visit = (n) => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeName === 'BR') out += '\n';
    else if (n.nodeType === 1 && n.classList && n.classList.contains('math')) out += '\ufffc';
    else for (const c of n.childNodes) visit(c);
  };
  visit(el);
  return out;
}

// Länge des gespeicherten HTML (ohne Zero-Width-Spaces aus der Bearbeitung)
export function modelTextLength(html) {
  const d = document.createElement('div');
  d.innerHTML = sanitizeInline(html || '');
  return nodeLen(d);
}

// Setzt den Caret an einen Textoffset (oder ans Ende bei -1 / zu groß)
export function setCaretOffset(el, offset, endOffset) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const a = pointFromOffset(el, offset < 0 ? Infinity : offset);
  range.setStart(a.node, a.offset);
  if (endOffset != null) {
    const b = pointFromOffset(el, endOffset);
    range.setEnd(b.node, b.offset);
  } else range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function pointFromOffset(root, offset) {
  let remaining = offset;
  let result = null;
  function visit(node) {
    if (result) return;
    if (node.nodeType === 3) {
      const len = node.nodeValue.length;
      if (remaining <= len) {
        result = { node, offset: remaining };
        return;
      }
      remaining -= len;
      return;
    }
    if (node.nodeName === 'BR' || (node.nodeType === 1 && node.classList && node.classList.contains('math'))) {
      const parent = node.parentNode;
      const idx = Array.prototype.indexOf.call(parent.childNodes, node);
      if (remaining === 0) {
        result = { node: parent, offset: idx };
        return;
      }
      remaining -= 1;
      if (remaining === 0 && node.nodeName !== 'BR') {
        result = { node: parent, offset: idx + 1 };
      } else if (remaining === 0) {
        result = { node: parent, offset: idx + 1 };
      }
      return;
    }
    for (const c of node.childNodes) {
      visit(c);
      if (result) return;
    }
  }
  visit(root);
  if (!result) {
    // Ende
    let last = root;
    while (last.lastChild && last.lastChild.nodeType === 1 && last.lastChild.nodeName !== 'BR' && !last.lastChild.classList.contains('math')) {
      last = last.lastChild;
    }
    if (last.lastChild && last.lastChild.nodeType === 3) return { node: last.lastChild, offset: last.lastChild.nodeValue.length };
    return { node: last, offset: last.childNodes.length };
  }
  return result;
}

export function isCaretAtStart(el) {
  const r = getSelectionRange();
  if (!r || !r.collapsed) return false;
  return getCaretOffset(el) === 0;
}

export function isCaretAtEnd(el) {
  const r = getSelectionRange();
  if (!r || !r.collapsed) return false;
  return getCaretOffset(el) >= textLength(el);
}

// Teilt den Inhalt am Caret: gibt HTML vor und nach dem Caret zurück
export function splitAtCaret(el) {
  const r = getSelectionRange();
  if (!r) return { before: el.innerHTML, after: '' };
  const after = document.createRange();
  after.setStart(r.endContainer, r.endOffset);
  after.setEnd(el, el.childNodes.length);
  if (!r.collapsed) r.deleteContents();
  const frag = after.extractContents();
  const tmp = document.createElement('div');
  tmp.appendChild(frag);
  return { before: sanitizeInline(el.innerHTML), after: sanitizeInline(tmp.innerHTML) };
}

export function caretRect() {
  const r = getSelectionRange();
  if (!r) return null;
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const rect = r.getBoundingClientRect();
  if (rect && (rect.width || rect.height || rect.top)) return rect;
  // Leere Zeile: temporärer Marker
  const span = document.createElement('span');
  span.textContent = '​';
  const clone = r.cloneRange();
  clone.insertNode(span);
  const res = span.getBoundingClientRect();
  const parent = span.parentNode;
  span.remove();
  if (parent) parent.normalize();
  return res;
}

export function isCaretOnFirstLine(el) {
  const rect = caretRect();
  if (!rect || (!rect.top && !rect.height)) return true;
  const er = el.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return rect.top - er.top < lh * 0.8;
}

export function isCaretOnLastLine(el) {
  const rect = caretRect();
  if (!rect || (!rect.top && !rect.height)) return true;
  const er = el.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return er.bottom - rect.bottom < lh * 0.8;
}

// Setzt den Caret möglichst nahe an eine x-Position in der ersten/letzten Zeile
export function placeCaretAtX(el, x, atBottom) {
  const er = el.getBoundingClientRect();
  const y = atBottom ? er.bottom - 6 : er.top + 6;
  let range = null;
  if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
  else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) {
      range = document.createRange();
      range.setStart(p.offsetNode, p.offset);
    }
  }
  if (range && el.contains(range.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    range.collapse(true);
    sel.addRange(range);
    return true;
  }
  setCaretOffset(el, atBottom ? -1 : 0);
  return false;
}

// Liefert den Text vom Blockanfang bis zum Caret
export function textBeforeCaret(el) {
  const r = getSelectionRange();
  if (!r || !el.contains(r.startContainer)) return '';
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString();
}

// Löscht n Zeichen vor dem Caret (nur innerhalb des aktuellen Textknotens sicher)
export function deleteBeforeCaret(el, n) {
  const off = getCaretOffset(el);
  if (off < n) return false;
  setCaretOffset(el, off - n, off);
  document.execCommand('delete');
  return true;
}

export function selectionInside(el) {
  const r = getSelectionRange();
  return !!(r && el.contains(r.commonAncestorContainer));
}

// Wendet eine Markierung auf die Auswahl an bzw. entfernt sie
export function toggleWrap(root, tagName, attrs = {}) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  // bereits umschlossen? → entpacken
  const anc = closestTag(range.commonAncestorContainer, tagName, root, attrs);
  if (anc) {
    unwrap(anc);
    return;
  }
  const el = document.createElement(tagName);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const frag = range.extractContents();
  // verschachtelte gleiche Tags entfernen
  frag.querySelectorAll && frag.querySelectorAll(tagName).forEach(unwrap);
  el.appendChild(frag);
  range.insertNode(el);
  sel.removeAllRanges();
  const nr = document.createRange();
  nr.selectNodeContents(el);
  sel.addRange(nr);
}

function closestTag(node, tagName, root, attrs) {
  let n = node.nodeType === 3 ? node.parentNode : node;
  while (n && n !== root) {
    if (n.tagName === tagName.toUpperCase()) {
      const keys = Object.keys(attrs);
      if (!keys.length || keys.every((k) => n.getAttribute(k) === attrs[k])) return n;
    }
    n = n.parentNode;
  }
  return null;
}

export function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

export function applyColor(root, kind, color) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const frag = range.extractContents();
  const attr = kind === 'bg' ? 'data-bg' : 'data-color';
  frag.querySelectorAll && frag.querySelectorAll(`[${attr}]`).forEach((n) => {
    n.removeAttribute(attr);
    if (n.tagName === 'SPAN' && !n.attributes.length) unwrap(n);
  });
  if (color === 'default') {
    range.insertNode(frag);
  } else {
    const span = document.createElement('span');
    span.setAttribute(attr, color);
    span.appendChild(frag);
    range.insertNode(span);
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nr);
  }
  root.normalize();
}

export function activeMarks(root) {
  const r = getSelectionRange();
  const marks = new Set();
  if (!r) return marks;
  let n = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer;
  while (n && n !== root && n.nodeType === 1) {
    marks.add(n.tagName);
    n = n.parentNode;
  }
  return marks;
}
