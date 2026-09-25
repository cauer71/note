// Block-Editor: ein contenteditable pro Textblock, flache Blockliste mit Einrückung

import { h, svg, uid, clone, mod, isTouchUI, isNarrow, toast, copyText, compressImage } from './util.js';
import { I } from './icons.js';
import {
  sanitizeInline,
  getCaretOffset,
  setCaretOffset,
  textLength,
  splitAtCaret,
  caretRect,
  isCaretOnFirstLine,
  isCaretOnLastLine,
  placeCaretAtX,
  textBeforeCaret,
  getSelectionRange,
  toggleWrap,
  applyColor,
  COLORS,
  COLOR_LABELS,
  htmlToText,
  offsetText,
  modelTextLength,
} from './inline.js';
import { BLOCK_TYPES, TYPE_BY_ID, TEXT_TYPES, newBlock, blockSubtreeEnd, pageTitle, CALLOUT_ICONS } from './model.js';
import { menu, popover, closeAllPopovers, emojiPicker, promptDialog } from './menus.js';
import { markdownToBlocks, blocksToMarkdown } from './markdown.js';
import { renderSpecialBlock, renderMathIn } from './blocks.js';
import { htmlToBlocks } from './paste.js';

const PLACEHOLDER = {
  p: 'Tippe „/“ für Befehle …',
  h1: 'Überschrift 1',
  h2: 'Überschrift 2',
  h3: 'Überschrift 3',
  ul: 'Liste',
  ol: 'Liste',
  todo: 'Aufgabe',
  toggle: 'Toggle',
  quote: 'Zitat',
  callout: 'Hinweis',
};

const CONTINUE_TYPES = new Set(['ul', 'ol', 'todo', 'toggle']);

export class Editor {
  constructor(app, page, root) {
    this.app = app;
    this.page = page;
    this.root = root;
    this.els = new Map();
    this.selected = new Set();
    this.slash = null;
    this.mention = null;
    this.composing = false;
    this.focusedId = null;
    this.blobCache = new Map();
    this.history = new History(this);
    this.onEvent = this.onEvent.bind(this);
    for (const ev of ['input', 'keydown', 'beforeinput', 'paste', 'focusin', 'focusout', 'click', 'compositionstart', 'compositionend', 'pointerdown', 'dragover', 'drop']) {
      root.addEventListener(ev, this.onEvent);
    }
  }

  destroy() {
    this.closeSlash();
    this.closeMention();
    this.root.querySelectorAll('.draw-block').forEach((el) => el._dispose && el._dispose());
    this.history.dispose();
    for (const ev of ['input', 'keydown', 'beforeinput', 'paste', 'focusin', 'focusout', 'click', 'compositionstart', 'compositionend', 'pointerdown', 'dragover', 'drop']) {
      this.root.removeEventListener(ev, this.onEvent);
    }
  }

  get blocks() {
    return this.page.blocks;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  render() {
    this.root.innerHTML = '';
    this.els.clear();
    if (!this.page.blocks) this.page.blocks = [];
    for (const b of this.page.blocks) this.root.appendChild(this.renderBlock(b));
    this.refreshLayout();
  }

  renderBlock(b) {
    this.cacheBlobs(b);
    const el = h('div', { class: 'blk blk-' + b.type, 'data-id': b.id });
    el._block = b;
    el.style.setProperty('--indent', b.indent || 0);
    const gutter = h(
      'div',
      { class: 'blk-gutter', contenteditable: 'false' },
      h('button', { class: 'blk-add', type: 'button', tabindex: '-1', 'aria-label': 'Block einfügen', title: 'Klicken: Block darunter einfügen' }, svg(I.plus)),
      h('button', { class: 'blk-handle', type: 'button', tabindex: '-1', 'aria-label': 'Block verschieben oder Menü', title: 'Ziehen zum Verschieben · Klicken für Menü' }, svg(I.grip))
    );
    const body = h('div', { class: 'blk-body' });
    if (b.color) body.setAttribute('data-color', b.color);
    if (b.bg) body.setAttribute('data-bg', b.bg);
    el.append(gutter, body);

    if (TEXT_TYPES.has(b.type)) {
      if (b.type === 'ul') body.appendChild(h('span', { class: 'blk-bullet', contenteditable: 'false' }));
      if (b.type === 'ol') body.appendChild(h('span', { class: 'blk-num', contenteditable: 'false' }));
      if (b.type === 'todo')
        body.appendChild(
          h('button', { class: 'blk-check' + (b.checked ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': b.checked ? 'true' : 'false', 'aria-label': 'Erledigt' }, svg(I.check))
        );
      if (b.type === 'toggle')
        body.appendChild(h('button', { class: 'blk-tog' + (b.open ? ' open' : ''), type: 'button', 'aria-label': b.open ? 'Einklappen' : 'Ausklappen', 'aria-expanded': b.open ? 'true' : 'false' }, svg(I.chevronRight)));
      if (b.type === 'callout') body.appendChild(h('button', { class: 'blk-callout-ico', type: 'button', 'aria-label': 'Symbol ändern' }, b.icon || '💡'));
      const txt = h('div', {
        class: 'blk-text',
        contenteditable: 'true',
        spellcheck: 'true',
        'data-ph': PLACEHOLDER[b.type] || '',
        role: /^h\d$/.test(b.type) ? 'heading' : 'textbox',
        'aria-level': /^h\d$/.test(b.type) ? b.type.slice(1) : null,
        'aria-multiline': 'true',
      });
      txt.innerHTML = sanitizeInline(b.text || '');
      renderMathIn(txt);
      if (b.type === 'todo' && b.checked) txt.classList.add('done');
      body.appendChild(txt);
      if (b.type === 'callout' && !b.bg) body.setAttribute('data-bg', 'gray');
    } else {
      body.appendChild(renderSpecialBlock(this, b));
    }
    this.els.set(b.id, el);
    return el;
  }

  // Neuer Stand von außen (anderes Gerät): alles um den fokussierten Block herum neu aufbauen.
  // Das fokussierte Element bleibt im DOM → iOS-Tastatur und Caret bleiben erhalten.
  applyRemoteBlocks() {
    const blocks = this.page.blocks || (this.page.blocks = []);
    if (!blocks.length) blocks.push(newBlock('p'));
    this.history.reset();
    this.clearSelection();
    const active = document.activeElement;
    const focusBlk = active && this.root.contains(active) ? active.closest('.blk') : null;
    const focusId = focusBlk && focusBlk.dataset.id;
    const idx = focusId ? blocks.findIndex((b) => b.id === focusId) : -1;
    if (!focusBlk || idx < 0 || !focusBlk.classList.contains('blk-' + blocks[idx].type)) {
      this.render();
      return;
    }
    const nb = blocks[idx];
    if (TEXT_TYPES.has(nb.type) && active.classList.contains('blk-text')) {
      const cur = sanitizeInline(active.innerHTML);
      if (cur !== (nb.text || '')) {
        const off = getCaretOffset(active);
        active.innerHTML = sanitizeInline(nb.text || '');
        renderMathIn(active);
        setCaretOffset(active, Math.min(off, textLength(active)));
      }
      focusBlk._block = nb;
    } else {
      // Spezialblock (Code, Tabelle, Karten …) hält Referenzen → lokale Fassung behalten
      blocks[idx] = focusBlk._block || nb;
    }
    for (const [id, el] of this.els) if (el !== focusBlk) el.remove();
    this.els.clear();
    this.els.set(focusId, focusBlk);
    let after = false;
    for (const b of blocks) {
      if (b.id === focusId) {
        after = true;
        continue;
      }
      const el = this.renderBlock(b);
      if (after) this.root.appendChild(el);
      else this.root.insertBefore(el, focusBlk);
    }
    this.refreshLayout();
  }

  rerenderBlock(b, focusOffset) {
    const old = this.els.get(b.id);
    const el = this.renderBlock(b);
    if (old && old.parentNode) old.replaceWith(el);
    this.refreshLayout();
    if (focusOffset != null) this.focusBlock(b.id, focusOffset);
    return el;
  }

  cacheBlobs(b) {
    if (b.type === 'drawing') this.blobCache.set(b.id + ':strokes', b.strokes);
    if (b.type === 'image' && b.src) this.blobCache.set(b.id + ':src', b.src);
  }

  textEl(id) {
    const el = this.els.get(id);
    return el && el.querySelector(':scope > .blk-body > .blk-text');
  }

  focusableEl(id) {
    const el = this.els.get(id);
    if (!el) return null;
    return el.querySelector(':scope > .blk-body > .blk-text, :scope > .blk-body .code-ta');
  }

  // Nummerierung, Sichtbarkeit (Toggles), leere Toggles
  refreshLayout() {
    let hideLevel = Infinity;
    const counters = [];
    const blocks = this.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const el = this.els.get(b.id);
      if (!el) continue;
      const ind = b.indent || 0;
      el.style.setProperty('--indent', ind);
      let hidden = false;
      if (ind > hideLevel) hidden = true;
      else {
        hideLevel = Infinity;
        if (b.type === 'toggle' && !b.open) hideLevel = ind;
      }
      el.classList.toggle('collapsed-hidden', hidden);
      counters.length = ind + 1;
      if (b.type === 'ol') {
        counters[ind] = (counters[ind] || 0) + 1;
        const num = el.querySelector('.blk-num');
        if (num) num.textContent = listMarker(counters[ind], ind);
      } else counters[ind] = 0;
      if (b.type === 'ul') {
        const bul = el.querySelector('.blk-bullet');
        if (bul) bul.dataset.level = String(ind % 3);
      }
      if (b.type === 'toggle') {
        const next = blocks[i + 1];
        el.classList.toggle('toggle-empty', !!b.open && !(next && (next.indent || 0) > ind));
      }
    }
    this.app.onBlocksLayout && this.app.onBlocksLayout(this);
  }

  // ---------------------------------------------------------------------
  // Fokus
  // ---------------------------------------------------------------------
  focusBlock(id, offset = -1) {
    const el = this.focusableEl(id);
    if (!el) {
      this.selectBlocks([id]);
      return;
    }
    if (el.tagName === 'TEXTAREA') {
      el.focus({ preventScroll: false });
      const pos = offset < 0 ? el.value.length : Math.min(offset, el.value.length);
      el.setSelectionRange(pos, pos);
      return;
    }
    el.focus({ preventScroll: true });
    setCaretOffset(el, offset);
    ensureVisible(el);
  }

  focusFirst() {
    const first = this.blocks.find((b) => TEXT_TYPES.has(b.type) || b.type === 'code');
    if (first) this.focusBlock(first.id, 0);
  }

  indexOf(id) {
    return this.blocks.findIndex((b) => b.id === id);
  }

  blockOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentNode);
    const bel = el && el.closest && el.closest('.blk');
    if (!bel || !this.root.contains(bel)) return null;
    const id = bel.dataset.id;
    return this.blocks.find((b) => b.id === id) || null;
  }

  visibleNeighbor(index, dir) {
    let j = index + dir;
    while (j >= 0 && j < this.blocks.length) {
      const el = this.els.get(this.blocks[j].id);
      if (el && !el.classList.contains('collapsed-hidden')) return j;
      j += dir;
    }
    return -1;
  }

  focusNeighbor(index, dir, x, atEdge) {
    let j = this.visibleNeighbor(index, dir);
    while (j >= 0 && !this.focusableEl(this.blocks[j].id)) j = this.visibleNeighbor(j, dir);
    if (j < 0) {
      if (dir < 0) this.app.focusTitle && this.app.focusTitle();
      return false;
    }
    const b = this.blocks[j];
    const el = this.focusableEl(b.id);
    if (el.tagName === 'TEXTAREA') {
      this.focusBlock(b.id, dir < 0 ? -1 : 0);
      return true;
    }
    el.focus({ preventScroll: true });
    if (x != null) placeCaretAtX(el, x, dir < 0);
    else setCaretOffset(el, atEdge === 'end' ? -1 : 0);
    ensureVisible(el);
    return true;
  }

  // ---------------------------------------------------------------------
  // Änderungen
  // ---------------------------------------------------------------------
  changed(b, structural) {
    if (structural) this.history.structural();
    this.app.touch(this.page);
  }

  insertAfter(id, block, focus = true) {
    this.history.structural();
    const idx = id == null ? -1 : this.indexOf(id);
    const at = idx < 0 ? this.blocks.length : blockInsertIndex(this.blocks, idx, block);
    this.blocks.splice(at, 0, block);
    const el = this.renderBlock(block);
    const next = this.blocks[at + 1];
    if (next && this.els.get(next.id)) this.root.insertBefore(el, this.els.get(next.id));
    else this.root.appendChild(el);
    this.refreshLayout();
    this.app.touch(this.page);
    if (focus) this.focusBlock(block.id, 0);
    return block;
  }

  insertAt(index, block, focus = true) {
    this.history.structural();
    this.blocks.splice(index, 0, block);
    const el = this.renderBlock(block);
    const next = this.blocks[index + 1];
    if (next && this.els.get(next.id)) this.root.insertBefore(el, this.els.get(next.id));
    else this.root.appendChild(el);
    this.refreshLayout();
    this.app.touch(this.page);
    if (focus) this.focusBlock(block.id, 0);
    return block;
  }

  insertBlocksAfter(id, blocks, focusLast = true) {
    if (!blocks.length) return;
    this.history.structural();
    let idx = id == null ? this.blocks.length - 1 : this.indexOf(id);
    const base = idx >= 0 ? this.blocks[idx].indent || 0 : 0;
    let at = idx < 0 ? this.blocks.length : idx + 1;
    for (const b of blocks) {
      b.indent = Math.min(6, (b.indent || 0) + (base && TEXT_TYPES.has(b.type) ? 0 : 0));
      this.blocks.splice(at, 0, b);
      const el = this.renderBlock(b);
      const next = this.blocks[at + 1];
      if (next && this.els.get(next.id)) this.root.insertBefore(el, this.els.get(next.id));
      else this.root.appendChild(el);
      at++;
    }
    this.refreshLayout();
    this.app.touch(this.page);
    const last = blocks[blocks.length - 1];
    if (focusLast && this.focusableEl(last.id)) this.focusBlock(last.id, -1);
  }

  // Ersetzt einen Block durch neue Blöcke (z. B. Einfügen in eine leere Zeile)
  replaceBlockWith(id, newBlocks, opts = {}) {
    const idx = this.indexOf(id);
    if (idx < 0 || !newBlocks.length) return;
    if (!opts.noHistory) this.history.structural();
    const old = this.els.get(id);
    const base = this.blocks[idx].indent || 0;
    newBlocks.forEach((b) => (b.indent = Math.min(6, (b.indent || 0) + base)));
    this.blocks.splice(idx, 1, ...newBlocks);
    const frag = document.createDocumentFragment();
    newBlocks.forEach((b) => frag.appendChild(this.renderBlock(b)));
    if (old) old.replaceWith(frag);
    this.els.delete(id);
    this.ensureTrailingParagraph();
    this.refreshLayout();
    this.app.touch(this.page);
    const last = newBlocks[newBlocks.length - 1];
    if (opts.focus !== false) {
      if (this.focusableEl(last.id)) this.focusBlock(last.id, -1);
      else {
        const next = this.blocks[this.indexOf(last.id) + 1];
        if (next && this.focusableEl(next.id)) this.focusBlock(next.id, 0);
      }
    }
  }

  // Hinter Tabellen, Bildern usw. soll man weiterschreiben können
  ensureTrailingParagraph() {
    const last = this.blocks[this.blocks.length - 1];
    if (last && (TEXT_TYPES.has(last.type) || last.type === 'code')) return;
    const nb = newBlock('p');
    this.blocks.push(nb);
    this.root.appendChild(this.renderBlock(nb));
  }

  removeBlock(id, opts = {}) {
    const idx = this.indexOf(id);
    if (idx < 0) return;
    if (!opts.noHistory) this.history.structural();
    const [b] = this.blocks.splice(idx, 1);
    const el = this.els.get(id);
    if (el) el.remove();
    this.els.delete(id);
    this.selected.delete(id);
    if (b.type === 'page' && b.pageId && opts.trashSubpage !== false) this.app.trashPage(b.pageId, { silent: true });
    if (!this.blocks.length) {
      const nb = newBlock('p');
      this.blocks.push(nb);
      this.root.appendChild(this.renderBlock(nb));
    }
    this.refreshLayout();
    this.app.touch(this.page);
  }

  changeType(b, type, opts = {}) {
    this.history.structural();
    const prevText = b.text || '';
    const keep = { id: b.id, indent: b.indent || 0, text: prevText, color: b.color, bg: b.bg };
    for (const k of Object.keys(b)) delete b[k];
    Object.assign(b, newBlock(type), keep);
    if (!b.color) delete b.color;
    if (!b.bg) delete b.bg;
    if (type === 'callout' && !b.bg) b.bg = 'gray';
    if (type === 'code') b.text = htmlToText(prevText);
    if (type === 'math') b.tex = htmlToText(prevText);
    if (!TEXT_TYPES.has(type) && type !== 'code') delete b.text;
    this.rerenderBlock(b);
    this.app.touch(this.page);
    if (opts.focus !== false) {
      if (TEXT_TYPES.has(type) || type === 'code') this.focusBlock(b.id, opts.offset ?? -1);
    }
  }

  setIndent(ids, delta) {
    this.history.structural();
    for (const id of ids) {
      const idx = this.indexOf(id);
      if (idx < 0) continue;
      const b = this.blocks[idx];
      const prev = this.blocks[idx - 1];
      const max = prev ? (prev.indent || 0) + 1 : 0;
      const end = blockSubtreeEnd(this.blocks, idx);
      const next = Math.max(0, Math.min(6, Math.min(max, (b.indent || 0) + delta)));
      const d = next - (b.indent || 0);
      if (!d) continue;
      for (let j = idx; j < end; j++) this.blocks[j].indent = Math.max(0, Math.min(6, (this.blocks[j].indent || 0) + d));
    }
    this.refreshLayout();
    this.app.touch(this.page);
  }

  moveBlocks(ids, toIndex, baseIndent) {
    // ids: zusammenhängende Gruppe (inkl. Kindern)
    this.history.structural();
    const set = new Set(ids);
    const moving = this.blocks.filter((b) => set.has(b.id));
    const firstIdx = this.indexOf(moving[0].id);
    const before = this.blocks.slice(0, toIndex).filter((b) => set.has(b.id)).length;
    const rest = this.blocks.filter((b) => !set.has(b.id));
    const at = Math.max(0, Math.min(rest.length, toIndex - before));
    if (baseIndent != null) {
      const d = baseIndent - (moving[0].indent || 0);
      moving.forEach((b) => (b.indent = Math.max(0, Math.min(6, (b.indent || 0) + d))));
    }
    rest.splice(at, 0, ...moving);
    this.page.blocks = rest;
    // DOM neu ordnen
    for (const b of rest) {
      const el = this.els.get(b.id);
      if (el) this.root.appendChild(el);
    }
    this.refreshLayout();
    this.app.touch(this.page);
    return firstIdx !== this.indexOf(moving[0].id);
  }

  groupOf(id) {
    const idx = this.indexOf(id);
    if (idx < 0) return [];
    const end = blockSubtreeEnd(this.blocks, idx);
    return this.blocks.slice(idx, end).map((b) => b.id);
  }

  moveUp(id) {
    const idx = this.indexOf(id);
    if (idx <= 0) return;
    const group = this.groupOf(id);
    // vorheriges Geschwister mit gleicher/kleinerer Einrückung finden
    const ind = this.blocks[idx].indent || 0;
    let j = idx - 1;
    while (j > 0 && (this.blocks[j].indent || 0) > ind) j--;
    this.moveBlocks(group, j, Math.min(ind, this.blocks[j].indent || 0));
    this.refocus(id);
  }

  moveDown(id) {
    const idx = this.indexOf(id);
    const group = this.groupOf(id);
    const end = idx + group.length;
    if (end >= this.blocks.length) return;
    const nextEnd = blockSubtreeEnd(this.blocks, end);
    this.moveBlocks(group, nextEnd, Math.min(this.blocks[idx].indent || 0, this.blocks[end].indent || 0));
    this.refocus(id);
  }

  refocus(id) {
    const el = this.focusableEl(id);
    if (el && document.activeElement === el) {
      ensureVisible(el);
      return;
    }
    if (this.selected.size) this.selectBlocks([...this.selected]);
    else if (el) this.focusBlock(id, -1);
  }

  duplicate(ids) {
    this.history.structural();
    const idxs = ids.map((id) => this.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (!idxs.length) return;
    const lastIdx = idxs[idxs.length - 1];
    const copies = idxs.map((i) => Object.assign(clone(this.blocks[i]), { id: uid('b') }));
    copies.forEach((c) => {
      if (c.type === 'page') {
        const np = this.app.duplicatePage(c.pageId, this.page.id);
        if (np) c.pageId = np.id;
      }
    });
    this.insertBlocksAfter(this.blocks[lastIdx].id, copies, false);
    this.selectBlocks(copies.map((c) => c.id));
  }

  // ---------------------------------------------------------------------
  // Blockauswahl
  // ---------------------------------------------------------------------
  selectBlocks(ids) {
    this.clearSelection();
    for (const id of ids) {
      this.selected.add(id);
      const el = this.els.get(id);
      if (el) el.classList.add('selected');
    }
    if (document.activeElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    window.getSelection().removeAllRanges();
    this.app.onBlockSelection && this.app.onBlockSelection(this);
  }

  clearSelection() {
    for (const id of this.selected) {
      const el = this.els.get(id);
      if (el) el.classList.remove('selected');
    }
    this.selected.clear();
    this.app.onBlockSelection && this.app.onBlockSelection(this);
  }

  selectedIds() {
    return this.blocks.filter((b) => this.selected.has(b.id)).map((b) => b.id);
  }

  // Globale Tasten, wenn Blöcke ausgewählt sind
  handleSelectionKey(e) {
    if (!this.selected.size) return false;
    const ids = this.selectedIds();
    const first = this.indexOf(ids[0]);
    const last = this.indexOf(ids[ids.length - 1]);
    if (e.key === 'Escape') {
      this.clearSelection();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      this.deleteBlocks(ids);
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const b = this.blocks[first];
      this.clearSelection();
      if (this.focusableEl(b.id)) this.focusBlock(b.id, -1);
      else this.openSpecial(b);
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (mod(e) && e.shiftKey) {
        if (dir < 0) this.moveUp(ids[0]);
        else this.moveDown(ids[0]);
        return true;
      }
      const j = this.visibleNeighbor(dir < 0 ? first : last, dir);
      if (j < 0) return true;
      if (e.shiftKey) this.selectBlocks([...ids, this.blocks[j].id]);
      else this.selectBlocks([this.blocks[j].id]);
      this.els.get(this.blocks[j].id).scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (mod(e) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicate(ids);
      return true;
    }
    if (mod(e) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selectBlocks(this.blocks.map((b) => b.id));
      return true;
    }
    if (mod(e) && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
      const md = blocksToMarkdown(ids.map((id) => this.blocks[this.indexOf(id)]), { pageTitle: (id) => pageTitle(this.app.getPage(id)) });
      writeBlocksToClipboard(md, ids.map((id) => this.blocks[this.indexOf(id)]));
      if (e.key.toLowerCase() === 'x') this.deleteBlocks(ids, { keepSubpages: true });
      e.preventDefault();
      toast(e.key.toLowerCase() === 'x' ? 'Ausgeschnitten' : 'Kopiert');
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.setIndent(ids, e.shiftKey ? -1 : 1);
      return true;
    }
    if (mod(e) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.history.redo();
      else this.history.undo();
      return true;
    }
    return false;
  }

  deleteBlocks(ids, opts = {}) {
    this.history.structural();
    const firstIdx = this.indexOf(ids[0]);
    for (const id of ids) this.removeBlock(id, { noHistory: true, trashSubpage: !opts.keepSubpages });
    this.clearSelection();
    const j = Math.max(0, Math.min(firstIdx - 1, this.blocks.length - 1));
    const b = this.blocks[j];
    if (b && this.focusableEl(b.id)) this.focusBlock(b.id, -1);
  }

  openSpecial(b) {
    const el = this.els.get(b.id);
    const f = el && el.querySelector('[data-open]');
    if (f) f.click();
  }

  // ---------------------------------------------------------------------
  // Ereignisse
  // ---------------------------------------------------------------------
  onEvent(e) {
    switch (e.type) {
      case 'input':
        return this.onInput(e);
      case 'keydown':
        return this.onKeyDown(e);
      case 'beforeinput':
        return this.onBeforeInput(e);
      case 'paste':
        return this.onPaste(e);
      case 'focusin':
        return this.onFocusIn(e);
      case 'focusout':
        return this.onFocusOut(e);
      case 'click':
        return this.onClick(e);
      case 'compositionstart':
        this.composing = true;
        return;
      case 'compositionend':
        this.composing = false;
        return;
      case 'pointerdown':
        return this.onPointerDown(e);
      case 'dragover':
        if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault();
        return;
      case 'drop':
        return this.onDrop(e);
    }
  }

  isText(target) {
    return target && target.classList && target.classList.contains('blk-text') && target.closest('.blk') && target.closest('.editor-blocks') === this.root;
  }

  onFocusIn(e) {
    const b = this.blockOf(e.target);
    if (!b) return;
    if (this.selected.size) this.clearSelection();
    this.focusedId = b.id;
    this.root.querySelectorAll('.blk.focused').forEach((x) => x.classList.remove('focused'));
    const el = this.els.get(b.id);
    if (el) el.classList.add('focused');
    this.app.onEditorFocus && this.app.onEditorFocus(this, b, e.target);
  }

  onFocusOut(e) {
    const b = this.blockOf(e.target);
    if (b) {
      const el = this.els.get(b.id);
      setTimeout(() => {
        if (el && !el.contains(document.activeElement)) el.classList.remove('focused');
      }, 0);
    }
    setTimeout(() => {
      if (!this.root.contains(document.activeElement)) {
        this.closeSlash();
        this.closeMention();
        this.app.onEditorBlur && this.app.onEditorBlur(this);
      }
    }, 120);
  }

  onInput(e) {
    const t = e.target;
    if (!this.isText(t)) return;
    const b = this.blockOf(t);
    if (!b) return;
    this.history.typing();
    let html = sanitizeInline(t.innerHTML);
    if (!html && t.innerHTML) t.innerHTML = '';
    b.text = html;
    this.app.touch(this.page);

    if (this.composing) return;
    const it = e.inputType || '';
    if (it === 'insertText' || it === 'insertReplacementText' || it === 'insertCompositionText' || !it) {
      const data = e.data || '';
      if (data === ' ' || data.endsWith(' ')) {
        if (this.tryMarkdownShortcut(b, t)) return;
      }
      if (/[`*~$=]$/.test(data)) this.tryInlineFormat(t);
      const before = textBeforeCaret(t);
      if (before.endsWith('```') && before === '```') {
        t.innerHTML = '';
        b.text = '';
        this.changeType(b, 'code', { offset: 0 });
        return;
      }
      if (before === '---' && htmlToText(b.text) === '---') {
        b.text = '';
        this.changeType(b, 'divider', { focus: false });
        const nb = newBlock('p', { indent: b.indent || 0 });
        this.insertAfter(b.id, nb);
        return;
      }
      if (data === '/' && (before.length === 1 || /\s\/$/.test(before))) {
        this.openSlash(b, t, getCaretOffset(t) - 1);
      } else if (data === '@' && (before.length === 1 || /\s@$/.test(before))) {
        this.openMention(b, t, getCaretOffset(t) - 1);
      } else if (before.endsWith('[[') && data === '[') {
        this.openMention(b, t, getCaretOffset(t) - 2);
      }
    }
    if (this.slash) this.updateSlash();
    if (this.mention) this.updateMention();
  }

  tryMarkdownShortcut(b, t) {
    if (!['p', 'ul', 'ol', 'todo', 'toggle', 'quote', 'h1', 'h2', 'h3', 'callout'].includes(b.type)) return false;
    const before = textBeforeCaret(t).replace(/ /g, ' ');
    const map = [
      [/^#\s$/, 'h1'],
      [/^##\s$/, 'h2'],
      [/^###\s$/, 'h3'],
      [/^[-*+]\s$/, 'ul'],
      [/^\d+[.)]\s$/, 'ol'],
      [/^\[\s?\]\s$/, 'todo'],
      [/^\[x\]\s$/i, 'todo-checked'],
      [/^>\s$/, 'toggle'],
      [/^["„“]\s$/, 'quote'],
      [/^\$\$\s$/, 'math'],
      [/^!\s$/, 'callout'],
    ];
    for (const [re, type] of map) {
      if (!re.test(before)) continue;
      if (type === b.type) return false;
      const { after } = splitAtCaret(t);
      b.text = after;
      const realType = type === 'todo-checked' ? 'todo' : type;
      this.changeType(b, realType, { offset: 0 });
      if (type === 'todo-checked') {
        b.checked = true;
        this.rerenderBlock(b, 0);
      }
      if (realType === 'math') this.openSpecial(b);
      return true;
    }
    return false;
  }

  tryInlineFormat(t) {
    const r = getSelectionRange();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3) return;
    const node = r.startContainer;
    const text = node.nodeValue.slice(0, r.startOffset);
    const rules = [
      [/`([^`\s][^`]*)`$/, 'code'],
      [/\*\*([^*\s][^*]*?)\*\*$/, 'b'],
      [/(?:^|[^*])\*([^*\s][^*]*?)\*$/, 'i'],
      [/~~([^~\s][^~]*?)~~$/, 's'],
      [/==([^=\s][^=]*?)==$/, 'mark'],
      [/(?:^|[^$\\])\$([^$\s][^$]*?)\$$/, 'math'],
    ];
    for (const [re, tag] of rules) {
      const m = re.exec(text);
      if (!m) continue;
      const inner = m[1];
      const full = m[0].slice(m[0].indexOf(tag === 'b' ? '**' : tag === 's' ? '~~' : tag === 'mark' ? '==' : tag === 'code' ? '`' : tag === 'math' ? '$' : '*'));
      const start = r.startOffset - full.length;
      if (start < 0) continue;
      const rest = node.nodeValue.slice(r.startOffset);
      const pre = node.nodeValue.slice(0, start);
      const parent = node.parentNode;
      let el;
      if (tag === 'math') {
        el = document.createElement('span');
        el.className = 'math';
        el.setAttribute('data-tex', inner);
      } else if (tag === 'mark') {
        el = document.createElement('span');
        el.setAttribute('data-bg', 'yellow');
        el.textContent = inner;
      } else {
        el = document.createElement(tag);
        el.textContent = inner;
      }
      const after = document.createTextNode('​' + rest);
      node.nodeValue = pre;
      parent.insertBefore(el, node.nextSibling);
      parent.insertBefore(after, el.nextSibling);
      if (tag === 'math') renderMathIn(parent.closest('.blk-text') || parent);
      const sel = window.getSelection();
      const nr = document.createRange();
      nr.setStart(after, 1);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
      const b = this.blockOf(t);
      if (b) {
        b.text = sanitizeInline(t.innerHTML);
        this.app.touch(this.page);
      }
      return;
    }
  }

  onBeforeInput(e) {
    // Fallback für Tastaturen, die keydown nicht sauber melden (z. B. Android)
    const t = e.target;
    if (!this.isText(t) || this.composing) return;
    const b = this.blockOf(t);
    if (!b) return;
    if (e.inputType === 'insertParagraph') {
      e.preventDefault();
      if (this.slash) return this.slashChoose();
      if (this.mention) return this.mentionChoose();
      this.enter(b, t);
    } else if (e.inputType === 'deleteContentBackward') {
      const r = getSelectionRange();
      if (r && r.collapsed && getCaretOffset(t) === 0) {
        e.preventDefault();
        this.backspace(b, t);
      }
    }
  }

  onKeyDown(e) {
    const t = e.target;
    if (t.classList && t.classList.contains('code-ta')) return; // eigener Handler
    if (!this.isText(t)) return;
    const b = this.blockOf(t);
    if (!b) return;

    if (this.slash && this.slashKey(e)) return;
    if (this.mention && this.mentionKey(e)) return;
    if (this.composing || e.isComposing) return;

    const k = e.key;
    if (k === 'Enter' && !e.shiftKey && !mod(e)) {
      e.preventDefault();
      this.enter(b, t);
      return;
    }
    if (k === 'Enter' && mod(e)) {
      e.preventDefault();
      if (b.type === 'todo') this.toggleTodo(b);
      else if (b.type === 'toggle') this.toggleOpen(b);
      return;
    }
    if (k === 'Backspace' && !mod(e) && !e.altKey) {
      const r = getSelectionRange();
      if (r && r.collapsed && getCaretOffset(t) === 0) {
        e.preventDefault();
        this.backspace(b, t);
      }
      return;
    }
    if (k === 'Delete') {
      const r = getSelectionRange();
      if (r && r.collapsed && getCaretOffset(t) >= textLength(t)) {
        e.preventDefault();
        this.deleteForward(b, t);
      }
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      this.setIndent([b.id], e.shiftKey ? -1 : 1);
      this.focusBlock(b.id, getCaretOffset(t));
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      this.selectBlocks([b.id]);
      return;
    }
    if (k === 'ArrowUp' && !e.shiftKey && !mod(e) && !e.altKey) {
      if (isCaretOnFirstLine(t)) {
        e.preventDefault();
        const rect = caretRect();
        this.focusNeighbor(this.indexOf(b.id), -1, rect ? rect.left : null);
      }
      return;
    }
    if (k === 'ArrowDown' && !e.shiftKey && !mod(e) && !e.altKey) {
      if (isCaretOnLastLine(t)) {
        e.preventDefault();
        const rect = caretRect();
        this.focusNeighbor(this.indexOf(b.id), 1, rect ? rect.left : null);
      }
      return;
    }
    if (k === 'ArrowLeft' && !e.shiftKey && !mod(e)) {
      const r = getSelectionRange();
      if (r && r.collapsed && getCaretOffset(t) === 0) {
        if (this.focusNeighbor(this.indexOf(b.id), -1, null, 'end')) e.preventDefault();
      }
      return;
    }
    if (k === 'ArrowRight' && !e.shiftKey && !mod(e)) {
      const r = getSelectionRange();
      if (r && r.collapsed && getCaretOffset(t) >= textLength(t)) {
        if (this.focusNeighbor(this.indexOf(b.id), 1, null, 'start')) e.preventDefault();
      }
      return;
    }
    if ((k === 'ArrowUp' || k === 'ArrowDown') && mod(e) && e.shiftKey) {
      e.preventDefault();
      if (k === 'ArrowUp') this.moveUp(b.id);
      else this.moveDown(b.id);
      return;
    }
    if (mod(e)) {
      const key = k.toLowerCase();
      if (key === 'b') return this.fmt(e, 'b');
      if (key === 'i') return this.fmt(e, 'i');
      if (key === 'u') return this.fmt(e, 'u');
      if (key === 'e') return this.fmt(e, 'code');
      if (key === 's' && e.shiftKey) return this.fmt(e, 's');
      if (key === 'k') {
        const r = getSelectionRange();
        if (r && !r.collapsed) {
          e.preventDefault();
          this.addLink(t);
        }
        return;
      }
      if (key === 'd') {
        e.preventDefault();
        this.duplicate([b.id]);
        return;
      }
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.history.redo();
        else this.history.undo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        this.history.redo();
        return;
      }
      if (key === 'a') {
        const r = getSelectionRange();
        const len = textLength(t);
        const offs = r && getCaretOffset(t);
        if (r && !r.collapsed && r.toString().length >= htmlToText(b.text).length) {
          e.preventDefault();
          this.selectBlocks(this.blocks.map((x) => x.id));
        } else if (len === 0 || offs === -1) {
          e.preventDefault();
          this.selectBlocks(this.blocks.map((x) => x.id));
        }
        return;
      }
      // Umwandeln per Tastatur: Strg+Alt+0..9 (wie Notion)
      if (e.altKey && /^[0-9]$/.test(k)) {
        const types = { 0: 'p', 1: 'h1', 2: 'h2', 3: 'h3', 4: 'todo', 5: 'ul', 6: 'ol', 7: 'toggle', 8: 'code', 9: 'page' };
        e.preventDefault();
        if (types[k] !== 'page') this.changeType(b, types[k], { offset: getCaretOffset(t) });
        return;
      }
    }
  }

  fmt(e, tag) {
    e && e.preventDefault();
    const t = document.activeElement;
    if (!this.isText(t)) return;
    const r = getSelectionRange();
    if (!r || r.collapsed) return;
    if (tag === 'b' || tag === 'i' || tag === 'u' || tag === 's') {
      document.execCommand({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[tag]);
    } else toggleWrap(t, tag);
    const b = this.blockOf(t);
    b.text = sanitizeInline(t.innerHTML);
    this.history.typing();
    this.app.touch(this.page);
  }

  async addLink(t, range) {
    const saved = range || (getSelectionRange() && getSelectionRange().cloneRange());
    const url = await promptDialog({ title: 'Link einfügen', label: 'Adresse (URL)', placeholder: 'https://…', okLabel: 'Verlinken' });
    if (!url || !saved) return;
    t.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(saved);
    const href = /^[a-z]+:/i.test(url) ? url : 'https://' + url;
    if (saved.collapsed) document.execCommand('insertHTML', false, `<a href="${href.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
    else document.execCommand('createLink', false, href);
    const b = this.blockOf(t);
    b.text = sanitizeInline(t.innerHTML);
    this.app.touch(this.page);
  }

  enter(b, t) {
    const idx = this.indexOf(b.id);
    const empty = !htmlToText(b.text).trim() && !t.querySelector('.math');
    if (empty && (CONTINUE_TYPES.has(b.type) || b.type === 'quote' || b.type === 'callout' || (b.type === 'p' && (b.indent || 0) > 0))) {
      if ((b.indent || 0) > 0 && b.type !== 'quote' && b.type !== 'callout') {
        this.setIndent([b.id], -1);
        this.focusBlock(b.id, 0);
      } else this.changeType(b, 'p', { offset: 0 });
      return;
    }
    const offset = getCaretOffset(t);
    const len = textLength(t);
    this.history.structural();
    if (offset === 0 && len > 0) {
      // leeren Block davor einfügen
      const nb = newBlock(CONTINUE_TYPES.has(b.type) ? b.type : 'p', { indent: b.indent || 0 });
      this.blocks.splice(idx, 0, nb);
      const el = this.renderBlock(nb);
      this.root.insertBefore(el, this.els.get(b.id));
      this.refreshLayout();
      this.app.touch(this.page);
      this.focusBlock(b.id, 0);
      return;
    }
    const { before, after } = splitAtCaret(t);
    b.text = before;
    t.innerHTML = before;
    renderMathIn(t);
    let type = CONTINUE_TYPES.has(b.type) ? b.type : 'p';
    let indent = b.indent || 0;
    if (b.type === 'toggle' && b.open) {
      type = 'p';
      indent = indent + 1;
    }
    const nb = newBlock(type, { indent, text: after });
    // direkt hinter dem Block einfügen – bei eingeklapptem Toggle hinter dessen Kinder
    const at = b.type === 'toggle' && !b.open ? blockSubtreeEnd(this.blocks, idx) : idx + 1;
    this.blocks.splice(at, 0, nb);
    const el = this.renderBlock(nb);
    const next = this.blocks[at + 1];
    if (next && this.els.get(next.id)) this.root.insertBefore(el, this.els.get(next.id));
    else this.root.appendChild(el);
    this.refreshLayout();
    this.app.touch(this.page);
    this.focusBlock(nb.id, 0);
  }

  backspace(b, t) {
    const idx = this.indexOf(b.id);
    if (b.type !== 'p' && TEXT_TYPES.has(b.type)) {
      this.changeType(b, 'p', { offset: 0 });
      return;
    }
    if ((b.indent || 0) > 0) {
      this.setIndent([b.id], -1);
      this.focusBlock(b.id, 0);
      return;
    }
    const pj = this.visibleNeighbor(idx, -1);
    if (pj < 0) {
      if (!htmlToText(b.text).trim() && this.blocks.length > 1) {
        this.removeBlock(b.id);
        this.focusFirst();
      } else this.app.focusTitle && this.app.focusTitle(true);
      return;
    }
    const prev = this.blocks[pj];
    if (TEXT_TYPES.has(prev.type)) {
      this.history.structural();
      const pt = this.textEl(prev.id);
      const off = modelTextLength(prev.text);
      prev.text = sanitizeInline((prev.text || '') + (b.text || ''));
      this.removeBlock(b.id, { noHistory: true });
      pt.innerHTML = prev.text;
      renderMathIn(pt);
      this.app.touch(this.page);
      this.focusBlock(prev.id, off);
      return;
    }
    if (prev.type === 'code' && !htmlToText(b.text)) {
      this.removeBlock(b.id);
      this.focusBlock(prev.id, -1);
      return;
    }
    if (!htmlToText(b.text).trim()) this.removeBlock(b.id);
    this.selectBlocks([prev.id]);
  }

  deleteForward(b, t) {
    const idx = this.indexOf(b.id);
    const nj = this.visibleNeighbor(idx, 1);
    if (nj < 0) return;
    const next = this.blocks[nj];
    if (!TEXT_TYPES.has(next.type)) return;
    this.history.structural();
    const off = modelTextLength(b.text);
    b.text = sanitizeInline((b.text || '') + (next.text || ''));
    this.removeBlock(next.id, { noHistory: true });
    t.innerHTML = b.text;
    renderMathIn(t);
    this.app.touch(this.page);
    this.focusBlock(b.id, off);
  }

  toggleTodo(b) {
    this.history.structural();
    b.checked = !b.checked;
    const el = this.els.get(b.id);
    const box = el.querySelector('.blk-check');
    box.classList.toggle('on', b.checked);
    box.setAttribute('aria-checked', b.checked ? 'true' : 'false');
    el.querySelector('.blk-text').classList.toggle('done', b.checked);
    this.app.touch(this.page);
  }

  toggleOpen(b) {
    b.open = !b.open;
    const el = this.els.get(b.id);
    const tog = el.querySelector('.blk-tog');
    tog.classList.toggle('open', b.open);
    tog.setAttribute('aria-expanded', b.open ? 'true' : 'false');
    this.refreshLayout();
    this.app.touch(this.page);
  }

  onClick(e) {
    const t = e.target;
    const b = this.blockOf(t);
    if (!b) return;
    if (t.closest('.blk-check')) {
      e.preventDefault();
      this.toggleTodo(b);
      return;
    }
    if (t.closest('.blk-tog')) {
      e.preventDefault();
      this.toggleOpen(b);
      return;
    }
    if (t.closest('.blk-callout-ico')) {
      emojiPicker(t.closest('.blk-callout-ico'), (em) => {
        b.icon = em || '💡';
        t.closest('.blk-callout-ico').textContent = b.icon;
        this.changed(b, true);
      });
      return;
    }
    if (t.closest('.blk-add')) {
      e.preventDefault();
      this.addBelow(b, t.closest('.blk-add'), e.altKey);
      return;
    }
    const mention = t.closest('a.mention');
    if (mention) {
      e.preventDefault();
      this.app.navigate(mention.getAttribute('data-page'));
      return;
    }
    const link = t.closest('.blk-text a[href]');
    if (link) {
      e.preventDefault();
      if (mod(e) || !isTouchUI()) {
        if (mod(e)) window.open(link.href, '_blank', 'noopener');
        else this.linkPopover(link, b);
      } else this.linkPopover(link, b);
      return;
    }
    const math = t.closest('.blk-text .math');
    if (math) {
      e.preventDefault();
      this.editInlineMath(math, b);
      return;
    }
    if (b.type === 'toggle' && this.els.get(b.id).classList.contains('toggle-empty') && t.classList.contains('blk-body') && e.offsetY > t.offsetHeight - 30) {
      const nb = newBlock('p', { indent: (b.indent || 0) + 1 });
      this.insertAfter(b.id, nb);
    }
  }

  addBelow(b, anchor, before) {
    const idx = this.indexOf(b.id);
    const empty = TEXT_TYPES.has(b.type) && b.type === 'p' && !htmlToText(b.text).trim();
    let target = b;
    if (!empty) {
      const nb = newBlock('p', { indent: b.indent || 0 });
      if (before) this.insertAt(idx, nb);
      else {
        const end = blockSubtreeEnd(this.blocks, idx);
        this.insertAt(end, nb);
      }
      target = nb;
    }
    const t = this.textEl(target.id);
    t.focus();
    setCaretOffset(t, 0);
    document.execCommand('insertText', false, '/');
    // input-Handler öffnet das Slash-Menü
  }

  linkPopover(a, b) {
    const t = a.closest('.blk-text');
    const wrap = h(
      'div',
      { class: 'link-pop' },
      h('a', { class: 'link-url', href: a.href, target: '_blank', rel: 'noopener' }, svg(I.arrowUpRight), ' ', a.href.replace(/^https?:\/\//, '').slice(0, 48)),
      h(
        'div',
        { class: 'link-actions' },
        h('button', { class: 'btn btn-sm', onclick: () => { pop.close(); copyText(a.href); toast('Link kopiert'); } }, 'Kopieren'),
        h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            pop.close();
            const url = await promptDialog({ title: 'Link bearbeiten', label: 'Adresse (URL)', value: a.getAttribute('href') });
            if (url) {
              a.setAttribute('href', /^[a-z]+:/i.test(url) ? url : 'https://' + url);
              b.text = sanitizeInline(t.innerHTML);
              this.changed(b, true);
            }
          },
        }, 'Bearbeiten'),
        h('button', {
          class: 'btn btn-sm btn-danger-ghost',
          onclick: () => {
            pop.close();
            const parent = a.parentNode;
            while (a.firstChild) parent.insertBefore(a.firstChild, a);
            a.remove();
            b.text = sanitizeInline(t.innerHTML);
            this.changed(b, true);
          },
        }, 'Entfernen')
      )
    );
    const pop = popover(a, wrap, { title: 'Link' });
  }

  editInlineMath(span, b) {
    const t = span.closest('.blk-text');
    const input = h('input', { class: 'input mono', type: 'text', value: span.getAttribute('data-tex') || '', placeholder: 'LaTeX, z. B. \\frac{a}{b}' });
    const prev = h('div', { class: 'math-preview' });
    const upd = () => {
      prev.innerHTML = '';
      const s = h('span', { class: 'math', 'data-tex': input.value });
      prev.appendChild(s);
      renderMathIn(prev);
    };
    input.value = span.getAttribute('data-tex') || '';
    upd();
    input.addEventListener('input', upd);
    const done = () => {
      if (!input.value.trim()) span.remove();
      else {
        span.setAttribute('data-tex', input.value);
        renderMathIn(t);
      }
      b.text = sanitizeInline(t.innerHTML);
      this.changed(b, true);
      pop.close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        done();
      }
    });
    const wrap = h('div', { class: 'inline-math-pop' }, input, prev, h('div', { class: 'confirm-actions' }, h('button', { class: 'btn btn-primary btn-sm', onclick: done }, 'Fertig')));
    const pop = popover(span, wrap, { title: 'Formel' });
    input.focus();
  }

  onPointerDown(e) {
    const handle = e.target.closest('.blk-handle');
    if (!handle) return;
    const b = this.blockOf(handle);
    if (!b) return;
    e.preventDefault();
    startBlockDrag(this, b, e, handle);
  }

  async onDrop(e) {
    const files = e.dataTransfer && [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files || !files.length) return;
    e.preventDefault();
    const b = this.blockOf(e.target) || this.blocks[this.blocks.length - 1];
    for (const f of files) await this.insertImageFile(f, b.id);
  }

  async insertImageFile(file, afterId) {
    try {
      const img = await compressImage(file);
      const nb = newBlock('image', { src: img.dataUrl, w: img.width, h: img.height });
      const cur = this.blocks[this.indexOf(afterId)];
      if (cur && cur.type === 'p' && !htmlToText(cur.text).trim()) {
        this.history.structural();
        const idx = this.indexOf(afterId);
        this.blocks.splice(idx, 1, nb);
        const old = this.els.get(afterId);
        const el = this.renderBlock(nb);
        old.replaceWith(el);
        this.els.delete(afterId);
        this.refreshLayout();
        this.app.touch(this.page);
      } else this.insertAfter(afterId, nb, false);
      return nb;
    } catch (err) {
      toast('Bild konnte nicht geladen werden', { kind: 'error' });
      return null;
    }
  }

  onPaste(e) {
    const t = e.target;
    const cd = e.clipboardData;
    if (!cd) return;
    const b = this.blockOf(t);
    if (!b) return;
    if (t.closest('.tbl') || t.closest('.fc-edit') || t.closest('.quiz') || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') {
      // Zellen/Karten: nur Klartext
      if (t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT') {
        e.preventDefault();
        document.execCommand('insertText', false, cd.getData('text/plain'));
      }
      return;
    }
    if (!this.isText(t)) return;
    const files = [...(cd.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach((f) => this.insertImageFile(f, b.id));
      return;
    }
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    let blocks = null;
    const own = /data-lernraum-blocks="([^"]*)"/.exec(html || '');
    if (own) {
      try {
        blocks = sanitizeBlocks(JSON.parse(decodeURIComponent(own[1])));
        for (const x of blocks) if (x.type === 'page' && x.pageId) this.app.restorePage(x.pageId, { silent: true });
      } catch {
        blocks = null;
      }
    }
    if (!blocks && html && /<(p|h[1-6]|li|ul|ol|table|pre|blockquote|div)[\s>]/i.test(html)) {
      blocks = htmlToBlocks(html);
      if (blocks.length === 1 && TEXT_TYPES.has(blocks[0].type) && blocks[0].type === 'p') {
        e.preventDefault();
        document.execCommand('insertHTML', false, blocks[0].text);
        b.text = sanitizeInline(t.innerHTML);
        this.changed(b);
        return;
      }
    }
    if (!blocks && text && /\n/.test(text.trim())) blocks = markdownToBlocks(text);
    if (!blocks && text && /^(#{1,3} |[-*] |\d+\. |> |```|\$\$)/.test(text)) blocks = markdownToBlocks(text);
    if (blocks && blocks.length) {
      e.preventDefault();
      const empty = b.type === 'p' && !htmlToText(b.text).trim();
      if (empty) this.replaceBlockWith(b.id, blocks);
      else {
        this.insertBlocksAfter(b.id, blocks);
        this.ensureTrailingParagraph();
        this.refreshLayout();
      }
      return;
    }
    // einfacher Text; URL über Auswahl → Link
    e.preventDefault();
    const r = getSelectionRange();
    if (r && !r.collapsed && /^https?:\/\/\S+$/.test(text.trim())) {
      document.execCommand('createLink', false, text.trim());
    } else document.execCommand('insertText', false, text);
    b.text = sanitizeInline(t.innerHTML);
    this.changed(b);
  }

  // ---------------------------------------------------------------------
  // Slash-Menü
  // ---------------------------------------------------------------------
  slashItems() {
    const items = BLOCK_TYPES.map((x) => ({ ...x }));
    if (this.app.ai && this.app.ai.available) {
      items.unshift({ type: 'ai', label: 'KI schreiben lassen', desc: 'Claude schreibt an dieser Stelle', icon: I.sparkle, keys: 'ki ai claude schreiben generieren assistent', group: 'KI' });
    } else {
      items.push({ type: 'ai', label: 'KI schreiben lassen', desc: 'Nur in der Claude-Version', icon: I.sparkle, keys: 'ki ai claude', group: 'KI' });
    }
    return items;
  }

  openSlash(b, t, slashOffset) {
    this.closeSlash();
    this.closeMention();
    const box = h('div', { class: 'slash', role: 'listbox' });
    document.body.appendChild(box);
    this.slash = { b, t, slashOffset, box, active: 0, items: [], query: '' };
    this.updateSlash();
  }

  updateSlash() {
    const s = this.slash;
    if (!s) return;
    const off = getCaretOffset(s.t);
    const txt = offsetText(s.t);
    if (off <= s.slashOffset || txt[s.slashOffset] !== '/') return this.closeSlash();
    const q = txt.slice(s.slashOffset + 1, off);
    if (q.length > 24 || /\s{2}/.test(q)) return this.closeSlash();
    s.query = q;
    const nq = q.toLowerCase().trim();
    const all = this.slashItems();
    s.items = !nq
      ? all
      : all
          .map((x) => {
            const hay = (x.label + ' ' + x.keys).toLowerCase();
            const score = x.label.toLowerCase().startsWith(nq) ? 0 : hay.split(/\s+/).some((w) => w.startsWith(nq)) ? 1 : hay.includes(nq) ? 2 : 9;
            return { x, score };
          })
          .filter((y) => y.score < 9)
          .sort((a, b) => a.score - b.score)
          .map((y) => y.x);
    if (!s.items.length && q.length > 3) return this.closeSlash();
    s.active = Math.min(s.active, Math.max(0, s.items.length - 1));
    this.renderSlash();
  }

  renderSlash() {
    const s = this.slash;
    s.box.innerHTML = '';
    let group = null;
    s.items.forEach((it, i) => {
      if (!s.query && it.group !== group) {
        group = it.group;
        s.box.appendChild(h('div', { class: 'menu-header' }, group));
      }
      const row = h(
        'button',
        { class: 'slash-item' + (i === s.active ? ' active' : ''), type: 'button', role: 'option', 'aria-selected': i === s.active ? 'true' : 'false' },
        h('span', { class: 'slash-ico' }, svg(it.icon)),
        h('span', { class: 'slash-text' }, h('span', { class: 'slash-label' }, it.label), h('span', { class: 'slash-desc' }, it.desc)),
        it.md ? h('span', { class: 'slash-md' }, it.md) : null
      );
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => {
        s.active = i;
        this.slashChoose();
      });
      row.addEventListener('mousemove', () => {
        if (s.active !== i) {
          s.active = i;
          s.box.querySelectorAll('.slash-item').forEach((x, j) => x.classList.toggle('active', j === i));
        }
      });
      s.box.appendChild(row);
    });
    if (!s.items.length) s.box.appendChild(h('div', { class: 'menu-empty' }, 'Keine Treffer'));
    positionFloating(s.box, caretRect());
    const act = s.box.querySelector('.slash-item.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  slashKey(e) {
    const s = this.slash;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      s.active = (s.active + 1) % Math.max(1, s.items.length);
      this.renderSlash();
      return true;
    }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      s.active = (s.active - 1 + s.items.length) % Math.max(1, s.items.length);
      this.renderSlash();
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.slashChoose();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeSlash();
      return true;
    }
    return false;
  }

  closeSlash() {
    if (this.slash) {
      this.slash.box.remove();
      this.slash = null;
    }
  }

  slashChoose() {
    const s = this.slash;
    if (!s) return;
    const it = s.items[s.active];
    this.closeSlash();
    if (!it) return;
    const { b, t, slashOffset } = s;
    const off = getCaretOffset(t);
    // "/befehl" entfernen
    setCaretOffset(t, slashOffset, Math.max(off, slashOffset + 1));
    document.execCommand('delete');
    b.text = sanitizeInline(t.innerHTML);
    if (!b.text) t.innerHTML = '';
    this.applyBlockChoice(b, it.type);
  }

  // Wendet einen Blocktyp aus Slash-Menü/Blockauswahl an
  applyBlockChoice(b, type, opts = {}) {
    const empty = TEXT_TYPES.has(b.type) && !htmlToText(b.text).trim() && !(b.text || '').includes('math');
    const indent = b.indent || 0;
    const replaceOrInsert = (nb) => {
      if (empty) {
        this.history.structural();
        const idx = this.indexOf(b.id);
        nb.indent = indent;
        this.blocks.splice(idx, 1, nb);
        const old = this.els.get(b.id);
        const el = this.renderBlock(nb);
        old.replaceWith(el);
        this.els.delete(b.id);
        this.refreshLayout();
        this.app.touch(this.page);
        return nb;
      }
      nb.indent = indent;
      return this.insertAfter(b.id, nb, false);
    };
    if (type === 'ai') {
      if (!this.app.ai || !this.app.ai.available) {
        this.app.ai && this.app.ai.explainUnavailable();
        return;
      }
      this.app.ai.inlineWrite(this, b);
      return;
    }
    if (type === 'page') {
      const child = this.app.createPage({ parentId: this.page.id }, { navigate: false });
      const nb = replaceOrInsert(newBlock('page', { pageId: child.id }));
      this.app.flushSave();
      this.app.navigate(child.id, { focusTitle: true });
      return nb;
    }
    if (type === 'database') {
      const db = this.app.createDatabase({ parentId: this.page.id, title: '' }, { navigate: false, inline: true });
      const nb = replaceOrInsert(newBlock('database', { pageId: db.id }));
      setTimeout(() => {
        const el = this.els.get(nb.id);
        const title = el && el.querySelector('.dbv-title');
        if (title) title.focus();
      }, 50);
      return nb;
    }
    if (TEXT_TYPES.has(type) && TEXT_TYPES.has(b.type) && empty) {
      this.changeType(b, type, { offset: 0 });
      return b;
    }
    if (TEXT_TYPES.has(type)) {
      const nb = newBlock(type, { indent });
      this.insertAfter(b.id, nb);
      return nb;
    }
    const nb = replaceOrInsert(newBlock(type));
    if (type === 'divider') {
      const idx = this.indexOf(nb.id);
      const next = this.blocks[idx + 1];
      if (!next) this.insertAfter(nb.id, newBlock('p', { indent }));
      else if (this.focusableEl(next.id)) this.focusBlock(next.id, 0);
    } else if (type === 'code') this.focusBlock(nb.id, 0);
    else if (type === 'image' && !opts.noPicker) this.openSpecial(nb);
    else if (type === 'math') this.openSpecial(nb);
    else if (type === 'flashcards') this.openSpecial(nb);
    else if (type === 'table') {
      const cell = this.els.get(nb.id).querySelector('.tbl-cell');
      if (cell) cell.focus();
    } else if (type === 'drawing') this.els.get(nb.id).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // hinter Spezialblöcken für Weiterschreiben sorgen
    const idx = this.indexOf(nb.id);
    if (idx === this.blocks.length - 1 && !['divider'].includes(type)) {
      this.blocks.push(newBlock('p'));
      this.root.appendChild(this.renderBlock(this.blocks[this.blocks.length - 1]));
      this.refreshLayout();
    }
    return nb;
  }

  // Block-Auswahl (mobil "+") ohne Slash
  openBlockPicker(anchor, b) {
    const items = this.slashItems().map((it) => ({
      label: it.label,
      desc: it.desc,
      icon: it.icon,
      keys: it.keys,
      onSelect: () => this.applyBlockChoice(b, it.type),
    }));
    const groups = [];
    let g = null;
    this.slashItems().forEach((it, i) => {
      if (it.group !== g) {
        g = it.group;
        groups.push({ header: g });
      }
      groups.push(items[i]);
    });
    menu(anchor, groups, { search: true, searchPlaceholder: 'Block suchen …', title: 'Block einfügen' });
  }

  turnIntoMenu(anchor, ids) {
    const bs = ids.map((id) => this.blocks[this.indexOf(id)]).filter(Boolean);
    const types = BLOCK_TYPES.filter((t) => TEXT_TYPES.has(t.type) || t.type === 'code' || t.type === 'math');
    menu(
      anchor,
      types.map((t) => ({
        label: t.label,
        icon: t.icon,
        checked: bs.length === 1 && bs[0].type === t.type,
        onSelect: () => {
          for (const b of bs) {
            if (TEXT_TYPES.has(b.type) || b.type === 'code') this.changeType(b, t.type, { focus: bs.length === 1 });
          }
        },
      })),
      { title: 'Umwandeln in', search: true }
    );
  }

  colorMenu(anchor, ids) {
    const bs = ids.map((id) => this.blocks[this.indexOf(id)]).filter(Boolean);
    const apply = (kind, c) => {
      this.history.structural();
      for (const b of bs) {
        if (kind === 'color') {
          if (c === 'default') delete b.color;
          else b.color = c;
        } else {
          if (c === 'default') delete b.bg;
          else b.bg = c;
        }
        this.rerenderBlock(b);
      }
      this.app.touch(this.page);
    };
    const items = [{ header: 'Textfarbe' }];
    items.push({ label: COLOR_LABELS.default, swatch: 'default', onSelect: () => apply('color', 'default') });
    COLORS.forEach((c) => items.push({ label: COLOR_LABELS[c], swatch: 'c-' + c, onSelect: () => apply('color', c) }));
    items.push({ header: 'Hintergrund' });
    items.push({ label: COLOR_LABELS.default, swatch: 'default', onSelect: () => apply('bg', 'default') });
    COLORS.forEach((c) => items.push({ label: COLOR_LABELS[c] + ' (Hintergrund)', swatch: 'b-' + c, onSelect: () => apply('bg', c) }));
    menu(anchor, items, { title: 'Farbe' });
  }

  blockMenu(anchor, b) {
    const ids = this.selected.has(b.id) ? this.selectedIds() : [b.id];
    if (!this.selected.has(b.id)) this.selectBlocks(ids);
    const isTextish = TEXT_TYPES.has(b.type) || b.type === 'code';
    const items = [];
    if (this.app.ai && this.app.ai.available && isTextish) {
      items.push({ label: 'Mit KI bearbeiten', icon: I.sparkle, onSelect: () => this.app.ai.blockActions(this, ids, anchor) });
      items.push({ divider: true });
    }
    items.push(
      { label: 'Löschen', icon: I.trash, hint: 'Entf', danger: true, onSelect: () => this.deleteBlocks(ids) },
      { label: 'Duplizieren', icon: I.duplicate, hint: (navigator.platform.includes('Mac') ? '⌘' : 'Strg+') + 'D', onSelect: () => this.duplicate(ids) },
      { label: 'Umwandeln in', icon: I.refresh, disabled: !isTextish, onSelect: () => this.turnIntoMenu(anchor, ids) },
      { label: 'Farbe', icon: I.palette, onSelect: () => this.colorMenu(anchor, ids) },
      { divider: true },
      { label: 'Nach oben', icon: I.arrowUp, onSelect: () => this.moveUp(ids[0]) },
      { label: 'Nach unten', icon: I.arrowDown, onSelect: () => this.moveDown(ids[ids.length - 1]) },
      { label: 'Einrücken', icon: I.indent, hint: 'Tab', onSelect: () => this.setIndent(ids, 1) },
      { label: 'Ausrücken', icon: I.outdent, hint: '⇧Tab', onSelect: () => this.setIndent(ids, -1) },
      { divider: true },
      {
        label: 'Als Markdown kopieren',
        icon: I.copy,
        onSelect: () => {
          const md = blocksToMarkdown(ids.map((id) => this.blocks[this.indexOf(id)]), { pageTitle: (id) => pageTitle(this.app.getPage(id)) });
          copyText(md);
          toast('Kopiert');
        },
      }
    );
    if (b.type === 'page' && b.pageId) items.push({ label: 'Seite öffnen', icon: I.arrowUpRight, onSelect: () => this.app.navigate(b.pageId) });
    if (b.type === 'database' && b.pageId) items.push({ label: 'Als ganze Seite öffnen', icon: I.arrowUpRight, onSelect: () => this.app.navigate(b.pageId) });
    menu(anchor, items, { title: 'Block', onClose: () => {} });
  }

  // ---------------------------------------------------------------------
  // @-Erwähnungen
  // ---------------------------------------------------------------------
  openMention(b, t, atOffset) {
    this.closeMention();
    this.closeSlash();
    const box = h('div', { class: 'slash mention-box', role: 'listbox' });
    document.body.appendChild(box);
    this.mention = { b, t, atOffset, box, active: 0, items: [] };
    this.updateMention();
  }

  updateMention() {
    const m = this.mention;
    if (!m) return;
    const off = getCaretOffset(m.t);
    const txt = offsetText(m.t);
    const trigger = txt[m.atOffset] === '@' ? 1 : txt.slice(m.atOffset, m.atOffset + 2) === '[[' ? 2 : 0;
    if (!trigger || off < m.atOffset + trigger) return this.closeMention();
    const q = txt.slice(m.atOffset + trigger, off);
    if (q.length > 40) return this.closeMention();
    m.trigger = trigger;
    const pages = this.app.searchTitles(q, 8).filter((p) => p.id !== this.page.id);
    m.items = pages.map((p) => ({ page: p }));
    if (q.trim()) m.items.push({ create: q.trim() });
    m.active = Math.min(m.active, Math.max(0, m.items.length - 1));
    m.box.innerHTML = '';
    m.box.appendChild(h('div', { class: 'menu-header' }, 'Seite verlinken'));
    m.items.forEach((it, i) => {
      const row = h(
        'button',
        { class: 'slash-item' + (i === m.active ? ' active' : ''), type: 'button' },
        h('span', { class: 'slash-ico' }, it.page ? (it.page.icon ? h('span', { class: 'emoji' }, it.page.icon) : svg(I.pageText)) : svg(I.plus)),
        h('span', { class: 'slash-text' }, h('span', { class: 'slash-label' }, it.page ? pageTitle(it.page) : `Neue Unterseite „${it.create}“`), it.page ? h('span', { class: 'slash-desc' }, this.app.pathLabel(it.page)) : null)
      );
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => {
        m.active = i;
        this.mentionChoose();
      });
      m.box.appendChild(row);
    });
    if (!m.items.length) m.box.appendChild(h('div', { class: 'menu-empty' }, 'Tippe, um Seiten zu suchen'));
    positionFloating(m.box, caretRect());
  }

  mentionKey(e) {
    const m = this.mention;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      m.active = (m.active + 1) % Math.max(1, m.items.length);
      this.updateMention();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      m.active = (m.active - 1 + m.items.length) % Math.max(1, m.items.length);
      this.updateMention();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!m.items.length) return false;
      e.preventDefault();
      this.mentionChoose();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeMention();
      return true;
    }
    return false;
  }

  closeMention() {
    if (this.mention) {
      this.mention.box.remove();
      this.mention = null;
    }
  }

  mentionChoose() {
    const m = this.mention;
    if (!m) return;
    const it = m.items[m.active];
    this.closeMention();
    if (!it) return;
    let page = it.page;
    if (!page) page = this.app.createPage({ parentId: this.page.id, title: it.create }, { navigate: false });
    const off = getCaretOffset(m.t);
    setCaretOffset(m.t, m.atOffset, off);
    const title = pageTitle(page).replace(/</g, '&lt;');
    document.execCommand('insertHTML', false, `<a class="mention" data-page="${page.id}">${page.icon ? page.icon + ' ' : ''}${title}</a>&nbsp;`);
    m.b.text = sanitizeInline(m.t.innerHTML);
    this.changed(m.b, true);
  }

  // Inline-Formatierung aus Toolbars heraus
  applyInline(action, savedRange) {
    const t = savedRange ? savedRange.startContainer.parentElement && savedRange.startContainer.parentElement.closest('.blk-text') : document.activeElement;
    const target = t && t.classList && t.classList.contains('blk-text') ? t : document.activeElement;
    if (!this.isText(target)) return;
    if (savedRange) {
      target.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    const b = this.blockOf(target);
    if (action === 'link') return this.addLink(target, savedRange);
    if (action === 'math') {
      const r = getSelectionRange();
      const tex = r ? r.toString() : '';
      document.execCommand('insertHTML', false, `<span class="math" data-tex="${tex.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></span>&#8203;`);
      renderMathIn(target);
      b.text = sanitizeInline(target.innerHTML);
      this.changed(b, true);
      const span = [...target.querySelectorAll('.math')].find((x) => x.getAttribute('data-tex') === tex);
      if (span && !tex) this.editInlineMath(span, b);
      return;
    }
    if (action.startsWith('color:') || action.startsWith('bg:')) {
      const [kind, c] = action.split(':');
      applyColor(target, kind === 'bg' ? 'bg' : 'color', c);
    } else if (['b', 'i', 'u', 's'].includes(action)) {
      document.execCommand({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[action]);
    } else toggleWrap(target, action);
    b.text = sanitizeInline(target.innerHTML);
    this.history.typing();
    this.app.touch(this.page);
  }
}

// ---------------------------------------------------------------------------
// Rückgängig / Wiederholen (Schnappschüsse der Seite)
// ---------------------------------------------------------------------------
class History {
  constructor(ed) {
    this.ed = ed;
    this.undoStack = [];
    this.redoStack = [];
    this.burst = false;
    this.timer = null;
    this.stable = this.snap();
  }
  dispose() {
    clearTimeout(this.timer);
  }
  reset() {
    clearTimeout(this.timer);
    this.undoStack = [];
    this.redoStack = [];
    this.burst = false;
    this.stable = this.snap();
  }
  snap() {
    const p = this.ed.page;
    return JSON.stringify({ t: p.title, b: p.blocks }, (k, v) => (k === 'strokes' || (k === 'src' && typeof v === 'string' && v.startsWith('data:')) ? undefined : v));
  }
  push(s) {
    if (this.undoStack[this.undoStack.length - 1] === s) return;
    this.undoStack.push(s);
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
  }
  typing() {
    if (!this.burst) this.push(this.stable);
    this.burst = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.burst = false;
      this.stable = this.snap();
    }, 700);
  }
  structural() {
    clearTimeout(this.timer);
    this.burst = false;
    this.push(this.snap());
    // nach der Änderung stabilen Stand aktualisieren
    Promise.resolve().then(() => (this.stable = this.snap()));
  }
  restore(s) {
    const ed = this.ed;
    const data = JSON.parse(s);
    ed.page.title = data.t;
    for (const b of data.b) {
      if (b.type === 'drawing') b.strokes = ed.blobCache.get(b.id + ':strokes') || [];
      if (b.type === 'image' && !b.src) b.src = ed.blobCache.get(b.id + ':src') || '';
    }
    const focusId = ed.focusedId;
    const before = new Map(ed.page.blocks.map((b) => [b.id, JSON.stringify(b)]));
    // Lernfortschritt der Karteikarten nicht zurückdrehen
    const progress = new Map();
    for (const b of ed.page.blocks) if (b.type === 'flashcards') for (const c of b.cards || []) progress.set(c.id, { box: c.box, due: c.due, reps: c.reps, last: c.last, lapses: c.lapses });
    for (const b of data.b) if (b.type === 'flashcards') for (const c of b.cards || []) if (progress.has(c.id)) Object.assign(c, progress.get(c.id));
    // Unterseiten, die per Rückgängig wieder auftauchen, aus dem Papierkorb holen
    for (const b of data.b) if (b.type === 'page' && b.pageId && !before.has(b.id)) ed.app.restorePage(b.pageId, { silent: true });
    ed.page.blocks = data.b;
    ed.render();
    ed.app.onTitleRestored && ed.app.onTitleRestored(ed.page);
    ed.app.touch(ed.page);
    // Fokus: zuletzt fokussierter Block, sonst der erste geänderte, sonst der letzte Textblock
    let target = focusId && ed.focusableEl(focusId) ? focusId : null;
    if (!target) {
      const changed = data.b.find((b) => before.get(b.id) !== JSON.stringify(b) && ed.focusableEl(b.id));
      if (changed) target = changed.id;
    }
    if (!target) {
      const lastText = [...data.b].reverse().find((b) => ed.focusableEl(b.id));
      if (lastText) target = lastText.id;
    }
    if (target) ed.focusBlock(target, -1);
  }
  undo() {
    clearTimeout(this.timer);
    this.burst = false;
    const cur = this.snap();
    let prev = this.undoStack.pop();
    while (prev === cur && this.undoStack.length) prev = this.undoStack.pop();
    if (!prev || prev === cur) {
      toast('Nichts zum Rückgängigmachen');
      return;
    }
    this.redoStack.push(cur);
    this.stable = prev;
    this.restore(prev);
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snap());
    this.stable = next;
    this.restore(next);
  }
}

// ---------------------------------------------------------------------------
// Drag & Drop per Pointer (Maus, Touch, Stift)
// ---------------------------------------------------------------------------
function startBlockDrag(ed, b, e, handle) {
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let dragging = false;
  let indicator = null;
  let ghost = null;
  let target = null;
  let scrollTimer = null;
  const group = ed.selected.has(b.id) && ed.selected.size > 1 ? ed.selectedIds().flatMap((id) => ed.groupOf(id)).filter((v, i, a) => a.indexOf(v) === i) : ed.groupOf(b.id);
  const scroller = ed.root.closest('.page-scroll') || document.scrollingElement;
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    /* ok */
  }

  function begin() {
    dragging = true;
    closeAllPopovers();
    group.forEach((id) => ed.els.get(id) && ed.els.get(id).classList.add('dragging'));
    indicator = h('div', { class: 'drop-line' });
    document.body.appendChild(indicator);
    const src = ed.els.get(b.id);
    ghost = h('div', { class: 'drag-ghost' }, (src.querySelector('.blk-text') || src).textContent.slice(0, 80) || TYPE_BY_ID[b.type]?.label || 'Block');
    document.body.appendChild(ghost);
    document.body.classList.add('is-dragging');
  }

  function onMove(ev) {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 5) begin();
    if (!dragging) return;
    ev.preventDefault();
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    // Ziel bestimmen
    const visible = ed.blocks.filter((x) => {
      const el = ed.els.get(x.id);
      return el && !el.classList.contains('collapsed-hidden') && !group.includes(x.id);
    });
    let best = null;
    for (const x of visible) {
      const r = ed.els.get(x.id).getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) {
        best = { id: x.id, before: true, rect: r };
        break;
      }
      best = { id: x.id, before: false, rect: r };
    }
    target = best;
    if (best) {
      const rootR = ed.root.getBoundingClientRect();
      const y = best.before ? best.rect.top : best.rect.bottom;
      const tb = ed.blocks[ed.indexOf(best.id)];
      let indent = tb.indent || 0;
      // Horizontal nach rechts ziehen → einrücken
      if (!best.before && ev.clientX - rootR.left > 60 + indent * 24 && TEXT_TYPES.has(tb.type)) indent = Math.min(6, indent + 1);
      best.indent = indent;
      const left = rootR.left + indent * 24;
      indicator.style.cssText = `top:${y - 2}px;left:${left}px;width:${Math.max(40, rootR.width - indent * 24)}px`;
    }
    // Auto-Scroll
    clearInterval(scrollTimer);
    const vh = window.innerHeight;
    if (ev.clientY < 70) scrollTimer = setInterval(() => scroller.scrollBy(0, -12), 16);
    else if (ev.clientY > vh - 70) scrollTimer = setInterval(() => scroller.scrollBy(0, 12), 16);
  }

  function onUp(ev) {
    if (ev.pointerId !== pointerId) return;
    cleanup();
    if (!dragging) {
      ed.blockMenu(handle, b);
      return;
    }
    if (!target) return;
    const tIdx = ed.indexOf(target.id);
    let to = target.before ? tIdx : blockSubtreeEnd(ed.blocks, tIdx);
    if (!target.before && target.indent > (ed.blocks[tIdx].indent || 0)) to = tIdx + 1;
    ed.moveBlocks(group, to, target.indent);
    ed.selectBlocks(group);
  }

  function cleanup() {
    clearInterval(scrollTimer);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    if (indicator) indicator.remove();
    if (ghost) ghost.remove();
    document.body.classList.remove('is-dragging');
    group.forEach((id) => ed.els.get(id) && ed.els.get(id).classList.remove('dragging'));
  }

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
}

// ---------------------------------------------------------------------------
function listMarker(n, level) {
  const l = level % 3;
  if (l === 1) return toLetters(n) + '.';
  if (l === 2) return toRoman(n) + '.';
  return n + '.';
}
function toLetters(n) {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
function toRoman(n) {
  const map = [
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let s = '';
  for (const [v, r] of map)
    while (n >= v) {
      s += r;
      n -= v;
    }
  return s;
}

function blockInsertIndex(blocks, idx) {
  return idx + 1;
}

// Blöcke aus fremden Quellen (Zwischenablage, Import) bereinigen
export function sanitizeBlocks(list, opts = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  for (const x of list) {
    if (!x || typeof x !== 'object' || !TYPE_BY_ID[x.type]) continue;
    const b = newBlock(x.type);
    if (opts.keepIds && typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id)) b.id = x.id;
    if (typeof x.title === 'string') b.title = x.title.slice(0, 200);
    b.indent = Math.max(0, Math.min(6, Number(x.indent) || 0));
    if (typeof x.text === 'string') b.text = x.type === 'code' ? x.text : sanitizeInline(x.text);
    if (x.type === 'todo') b.checked = !!x.checked;
    if (x.type === 'toggle') b.open = x.open !== false;
    if (x.type === 'callout' && typeof x.icon === 'string') b.icon = x.icon.slice(0, 8);
    if (typeof x.color === 'string' && COLORS.includes(x.color)) b.color = x.color;
    if (typeof x.bg === 'string' && COLORS.includes(x.bg)) b.bg = x.bg;
    if (x.type === 'code' && typeof x.lang === 'string') b.lang = x.lang.replace(/[^\w+#-]/g, '').slice(0, 20);
    if (x.type === 'math' && typeof x.tex === 'string') b.tex = x.tex;
    if (x.type === 'table' && Array.isArray(x.rows)) {
      b.rows = x.rows.filter(Array.isArray).map((r) => r.map((c) => sanitizeInline(String(c || ''))));
      b.header = !!x.header;
    }
    if (x.type === 'image' && typeof x.src === 'string' && /^(data:image\/|https:)/.test(x.src)) {
      b.src = x.src;
      b.caption = String(x.caption || '');
      if (x.w) b.w = num(x.w);
      if (x.h) b.h = num(x.h);
    }
    if (x.type === 'flashcards' && Array.isArray(x.cards))
      b.cards = x.cards.map((c) => ({
        id: typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : uid('k'),
        q: sanitizeInline(String(c.q || '')),
        a: sanitizeInline(String(c.a || '')),
        box: num(c.box),
        due: num(c.due),
        reps: num(c.reps),
        last: num(c.last),
        lapses: num(c.lapses),
      }));
    if (x.type === 'quiz' && x.lastScore && typeof x.lastScore === 'object') b.lastScore = { pct: num(x.lastScore.pct), at: num(x.lastScore.at) };
    if (x.type === 'quiz' && Array.isArray(x.questions)) b.questions = x.questions.map((q) => ({ q: String(q.q || ''), options: (q.options || []).map(String), correct: Number(q.correct) || 0, explain: String(q.explain || '') }));
    if (x.type === 'drawing' && Array.isArray(x.strokes)) {
      b.strokes = x.strokes.filter((s) => s && Array.isArray(s.p)).map((s) => ({ t: s.t === 'hl' ? 'hl' : 'pen', c: String(s.c || 'ink').slice(0, 12), w: Number(s.w) || 3, p: s.p.map(Number) }));
      b.h = Number(x.h) || 520;
      b.bg = ['lines', 'grid', 'dots', 'blank'].includes(x.bg) ? x.bg : 'lines';
    }
    if ((x.type === 'page' || x.type === 'database') && typeof x.pageId === 'string') b.pageId = x.pageId;
    out.push(b);
  }
  return out;
}

export function positionFloating(box, rect) {
  if (!rect) return;
  const vw = window.innerWidth;
  const vv = window.visualViewport;
  let vh = vv ? vv.height + vv.offsetTop : window.innerHeight;
  // Tastatur-Leiste (iPhone/iPad) nicht verdecken
  const kb = document.querySelector('.kb-bar:not([hidden])');
  if (kb) vh = Math.min(vh, kb.getBoundingClientRect().top);
  box.style.maxHeight = '';
  const bh = Math.min(box.scrollHeight, 360);
  const bw = box.offsetWidth || 300;
  let top = rect.bottom + 6;
  if (top + bh > vh - 8) {
    const above = rect.top - bh - 6;
    if (above > 8) top = above;
    else {
      top = Math.max(8, rect.bottom + 6);
      box.style.maxHeight = Math.max(140, vh - top - 8) + 'px';
    }
  }
  let left = Math.max(8, Math.min(rect.left, vw - bw - 8));
  box.style.top = top + 'px';
  box.style.left = left + 'px';
}

function ensureVisible(el) {
  const r = el.getBoundingClientRect();
  const vv = window.visualViewport;
  const bottom = vv ? vv.height + vv.offsetTop - (isNarrow() || isTouchUI() ? 60 : 0) : window.innerHeight;
  if (r.bottom > bottom - 20 || r.top < 60) {
    el.scrollIntoView({ block: r.top < 60 ? 'start' : 'end', behavior: 'auto' });
    if (r.top < 60) {
      const sc = el.closest('.page-scroll');
      if (sc) sc.scrollBy(0, -80);
    }
  }
}

function writeBlocksToClipboard(md, blocks) {
  const payload = encodeURIComponent(JSON.stringify(blocks));
  const html = `<div data-lernraum-blocks="${payload}">${md.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard
        .write([
          new ClipboardItem({
            'text/plain': new Blob([md], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
        .catch(() => copyText(md));
      return;
    }
  } catch {
    /* Fallback */
  }
  copyText(md);
}
