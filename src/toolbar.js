// Werkzeugleisten: Auswahl-Leiste (Desktop), Tastatur-Leiste (iPhone/iPad), Seiten-Leiste unten

import { h, svg, isTouchUI, isNarrow, onVisualViewportChange } from './util.js';
import { I } from './icons.js';
import { getSelectionRange, activeMarks, COLORS, COLOR_LABELS } from './inline.js';
import { menu } from './menus.js';
import { TEXT_TYPES, newBlock } from './model.js';

export class Toolbars {
  constructor(app) {
    this.app = app;
    this.sel = h('div', { class: 'sel-bar glass', role: 'toolbar', 'aria-label': 'Formatierung', hidden: true });
    this.kb = h('div', { class: 'kb-bar', role: 'toolbar', 'aria-label': 'Bearbeiten', hidden: true });
    this.bottom = h('div', { class: 'page-toolbar', role: 'toolbar', 'aria-label': 'Seite', hidden: true });
    document.body.append(this.sel, this.kb, this.bottom);
    this.savedRange = null;
    this.ctx = null;
    document.addEventListener('selectionchange', () => this.onSelectionChange());
    onVisualViewportChange(() => this.positionKb());
    window.addEventListener('scroll', () => this.hideSel(), { passive: true });
    app.scroll.addEventListener('scroll', () => this.positionSel(), { passive: true });
    this.buildSel();
  }

  // ------------------------------------------------------------------
  update() {
    const app = this.app;
    const touch = isTouchUI();
    const showBottom = touch && app.view === 'page' && app.currentPage() && !this.ctx && !(app.editor && app.editor.selected.size);
    this.bottom.hidden = !showBottom;
    if (showBottom) this.buildBottom();
    document.body.classList.toggle('has-page-toolbar', !!showBottom);
    if (!this.ctx && !(app.editor && app.editor.selected.size)) this.kb.hidden = true;
  }

  onFocus(ed, b, el) {
    this.ctx = { ed, b, el };
    if (isTouchUI()) {
      this.buildKb();
      this.kb.hidden = false;
      document.body.classList.add('kb-open');
      this.positionKb();
    }
    this.update();
  }

  onBlur(ed) {
    if (this.ctx && this.ctx.ed === ed) this.ctx = null;
    setTimeout(() => {
      if (this.ctx || (this.app.editor && this.app.editor.selected.size)) return;
      this.kb.hidden = true;
      document.body.classList.remove('kb-open');
      this.hideSel();
      this.update();
    }, 50);
  }

  onSelection(ed) {
    if (ed.selected.size && isTouchUI()) {
      this.buildSelectionKb(ed);
      this.kb.hidden = false;
      this.positionKb();
    } else if (!this.ctx) {
      this.kb.hidden = true;
    }
    this.update();
  }

  positionKb() {
    const vv = window.visualViewport;
    if (!vv) return;
    const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    this.kb.style.transform = `translateY(${-offset}px)`;
    document.documentElement.style.setProperty('--kb-offset', offset + 'px');
    document.body.classList.toggle('vkb', offset > 80);
  }

  // ------------------------------------------------------------------
  // Tastatur-Leiste
  // ------------------------------------------------------------------
  btn(icon, label, onclick, cls = '') {
    const b = h('button', { class: 'kb-btn ' + cls, type: 'button', 'aria-label': label, title: label }, typeof icon === 'string' && icon.startsWith('<') ? svg(icon) : h('span', { class: 'kb-txt' }, icon));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.savedRange = currentRange();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      onclick(b);
    });
    return b;
  }

  buildKb() {
    const kb = this.kb;
    kb.innerHTML = '';
    const ctx = this.ctx;
    if (!ctx) return;
    const { ed } = ctx;
    const b = () => (this.ctx ? this.ctx.b : null);
    const isText = () => b() && TEXT_TYPES.has(b().type);
    const fmt = (a) => () => {
      const r = this.savedRange || currentRange();
      ed.applyInline(a, r && !r.collapsed ? r : null);
      this.savedRange = null;
    };
    const group = (...items) => h('div', { class: 'kb-group' }, ...items);
    const inner = h(
      'div',
      { class: 'kb-scroll' },
      group(
        this.btn(I.plus, 'Block einfügen', (el) => ed.openBlockPicker(el, b())),
        this.btn('Aa', 'Umwandeln in', (el) => isText() && ed.turnIntoMenu(el, [b().id])),
        this.btn(I.todo, 'Checkliste', () => {
          const bl = b();
          if (!bl || !TEXT_TYPES.has(bl.type)) return;
          ed.changeType(bl, bl.type === 'todo' ? 'p' : 'todo', { offset: -1 });
        })
      ),
      group(
        this.btn(I.bold, 'Fett', fmt('b')),
        this.btn(I.italic, 'Kursiv', fmt('i')),
        this.btn(I.underline, 'Unterstrichen', fmt('u')),
        this.btn(I.strike, 'Durchgestrichen', fmt('s')),
        this.btn(I.code, 'Inline-Code', fmt('code')),
        this.btn(I.math, 'Formel', fmt('math')),
        this.btn(I.link, 'Link', fmt('link')),
        this.btn(I.palette, 'Farbe', (el) => this.colorMenu(el, ed))
      ),
      this.app.ai.available
        ? group(
            this.btn(I.sparkle, 'Claude', (el) => {
              const r = this.savedRange || currentRange();
              if (r && !r.collapsed) this.app.ai.selectionActions(ed, el, r);
              else if (b()) this.app.ai.blockActions(ed, [b().id], el);
            }, 'kb-ai')
          )
        : null,
      group(
        this.btn(I.outdent, 'Ausrücken', () => b() && (ed.setIndent([b().id], -1), refocus(ed, b()))),
        this.btn(I.indent, 'Einrücken', () => b() && (ed.setIndent([b().id], 1), refocus(ed, b()))),
        this.btn(I.arrowUp, 'Nach oben', () => b() && ed.moveUp(b().id)),
        this.btn(I.arrowDown, 'Nach unten', () => b() && ed.moveDown(b().id)),
        this.btn(I.more, 'Blockmenü', (el) => b() && ed.blockMenu(el, b()))
      )
    );
    const done = this.btn(I.keyboardDown, 'Tastatur schließen', () => {
      if (document.activeElement) document.activeElement.blur();
    }, 'kb-done');
    kb.append(h('div', { class: 'kb-inner glass' }, inner), h('div', { class: 'kb-done-wrap glass' }, done));
  }

  buildSelectionKb(ed) {
    const kb = this.kb;
    kb.innerHTML = '';
    const ids = () => ed.selectedIds();
    const inner = h(
      'div',
      { class: 'kb-scroll' },
      h(
        'div',
        { class: 'kb-group' },
        this.btn(I.trash, 'Löschen', () => ed.deleteBlocks(ids()), 'danger'),
        this.btn(I.duplicate, 'Duplizieren', () => ed.duplicate(ids())),
        this.btn(I.arrowUp, 'Nach oben', () => ed.moveUp(ids()[0])),
        this.btn(I.arrowDown, 'Nach unten', () => ed.moveDown(ids()[ids().length - 1])),
        this.btn(I.palette, 'Farbe', (el) => ed.colorMenu(el, ids())),
        this.btn(I.copy, 'Kopieren', () => ed.handleSelectionKey({ key: 'c', metaKey: true, ctrlKey: true, preventDefault() {} }))
      )
    );
    const done = this.btn('Fertig', 'Auswahl beenden', () => ed.clearSelection(), 'kb-done kb-done-text');
    kb.append(h('div', { class: 'kb-inner glass' }, inner), h('div', { class: 'kb-done-wrap glass glass-tint' }, done));
  }

  colorMenu(anchor, ed) {
    const r = this.savedRange || currentRange();
    const items = [{ header: 'Textfarbe' }, { label: COLOR_LABELS.default, swatch: 'default', onSelect: () => ed.applyInline('color:default', r) }];
    COLORS.forEach((c) => items.push({ label: COLOR_LABELS[c], swatch: 'c-' + c, onSelect: () => ed.applyInline('color:' + c, r) }));
    items.push({ header: 'Markierung' }, { label: 'Keine', swatch: 'default', onSelect: () => ed.applyInline('bg:default', r) });
    COLORS.forEach((c) => items.push({ label: COLOR_LABELS[c], swatch: 'b-' + c, onSelect: () => ed.applyInline('bg:' + c, r) }));
    if (!r || r.collapsed) {
      // ohne Auswahl: ganzen Block einfärben
      const b = this.ctx && this.ctx.b;
      if (b) return ed.colorMenu(anchor, [b.id]);
    }
    menu(anchor, items, { title: 'Farbe' });
  }

  // ------------------------------------------------------------------
  // Auswahl-Leiste (Maus/Trackpad)
  // ------------------------------------------------------------------
  buildSel() {
    const s = this.sel;
    const act = (a) => () => {
      const ed = this.app.editor;
      if (!ed) return;
      ed.applyInline(a, this.selRange);
      this.onSelectionChange(true);
    };
    const b = (content, label, fn, cls = '') => {
      const el = h('button', { class: 'sel-btn ' + cls, type: 'button', 'aria-label': label, title: label }, typeof content === 'string' && content.startsWith('<') ? svg(content) : content);
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', (e) => {
        e.preventDefault();
        fn(el);
      });
      return el;
    };
    this.selAi = b(h('span', { class: 'sel-ai' }, svg(I.sparkle), ' Claude'), 'Claude', (el) => this.app.editor && this.app.ai.selectionActions(this.app.editor, el, this.selRange), 'sel-ai-btn');
    s.append(
      this.selAi,
      h('span', { class: 'sel-sep' }),
      b(h('span', { class: 'sel-txt' }, 'Aa ', svg(I.chevronDown)), 'Umwandeln in', (el) => {
        const ed = this.app.editor;
        const r = this.selRange;
        const t = r && r.startContainer.parentElement && r.startContainer.parentElement.closest('.blk-text');
        const blk = t && ed.blockOf(t);
        if (blk) ed.turnIntoMenu(el, [blk.id]);
      }),
      h('span', { class: 'sel-sep' }),
      b(I.bold, 'Fett (⌘B)', act('b'), 'm-B'),
      b(I.italic, 'Kursiv (⌘I)', act('i'), 'm-I'),
      b(I.underline, 'Unterstrichen (⌘U)', act('u'), 'm-U'),
      b(I.strike, 'Durchgestrichen (⌘⇧S)', act('s'), 'm-S'),
      b(I.code, 'Code (⌘E)', act('code'), 'm-CODE'),
      b(I.math, 'Formel', act('math')),
      b(I.link, 'Link (⌘K)', act('link'), 'm-A'),
      h('span', { class: 'sel-sep' }),
      b(h('span', { class: 'sel-color' }, 'A'), 'Farbe', (el) => {
        const ed = this.app.editor;
        if (!ed) return;
        const r = this.selRange;
        const items = [{ header: 'Textfarbe' }, { label: COLOR_LABELS.default, swatch: 'default', onSelect: () => ed.applyInline('color:default', r) }];
        COLORS.forEach((c) => items.push({ label: COLOR_LABELS[c], swatch: 'c-' + c, onSelect: () => ed.applyInline('color:' + c, r) }));
        items.push({ header: 'Markierung' }, { label: 'Keine', swatch: 'default', onSelect: () => ed.applyInline('bg:default', r) });
        COLORS.forEach((c) => items.push({ label: COLOR_LABELS[c], swatch: 'b-' + c, onSelect: () => ed.applyInline('bg:' + c, r) }));
        menu(el, items, { title: 'Farbe', focusList: false });
      })
    );
  }

  onSelectionChange(keep) {
    const ed = this.app.editor;
    if (!ed) return this.hideSel();
    const r = currentRange();
    if (!r || r.collapsed) {
      if (!keep && !document.querySelector('.popover')) this.hideSel();
      return;
    }
    const t = r.startContainer.parentElement && r.startContainer.parentElement.closest('.blk-text');
    if (!t || !ed.root.contains(t) || !t.contains(r.endContainer)) return this.hideSel();
    this.selRange = r.cloneRange();
    if (isTouchUI() && !window.matchMedia('(any-hover: hover)').matches) return;
    this.selAi.hidden = !this.app.ai.available;
    const marks = activeMarks(t);
    this.sel.querySelectorAll('.sel-btn').forEach((b) => {
      const m = [...b.classList].find((c) => c.startsWith('m-'));
      if (m) b.classList.toggle('on', marks.has(m.slice(2)));
    });
    this.sel.hidden = false;
    this.positionSel();
  }

  positionSel() {
    if (this.sel.hidden || !this.selRange) return;
    const rect = this.selRange.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    const w = this.sel.offsetWidth;
    const hh = this.sel.offsetHeight;
    let top = rect.top - hh - 10;
    if (top < 64) top = rect.bottom + 10;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    this.sel.style.top = top + 'px';
    this.sel.style.left = left + 'px';
  }

  hideSel() {
    this.sel.hidden = true;
  }

  // ------------------------------------------------------------------
  // Seiten-Leiste unten (Touch, ohne Tastatur)
  // ------------------------------------------------------------------
  buildBottom() {
    const app = this.app;
    const p = app.currentPage();
    const bt = this.bottom;
    bt.innerHTML = '';
    const ed = app.editor;
    const tb = (icon, label, fn, cls = '') => h('button', { class: 'pt-btn ' + cls, type: 'button', 'aria-label': label, title: label, onclick: (e) => fn(e.currentTarget) }, svg(icon), h('span', { class: 'pt-label' }, label));
    const lastBlock = () => (ed ? ed.blocks[ed.blocks.length - 1] : null);
    const appendAndApply = (type) => {
      if (!ed) return;
      let last = lastBlock();
      if (!last || !(last.type === 'p' && !(last.text || '').trim())) {
        last = ed.insertAfter(last ? last.id : null, newBlock('p'), false);
      }
      ed.applyBlockChoice(last, type);
    };
    const items = [];
    if (p.kind === 'database') {
      items.push(tb(I.plus, 'Eintrag', () => app.dbview && app.dbview.addRow({}, true)));
    } else {
      items.push(
        tb(I.plus, 'Block', (el) => {
          if (!ed) return;
          let last = lastBlock();
          if (!last || !(last.type === 'p' && !(last.text || '').trim())) last = ed.insertAfter(last ? last.id : null, newBlock('p'), false);
          ed.openBlockPicker(el, last);
        }),
        tb(I.todo, 'Checkliste', () => appendAndApply('todo')),
        tb(I.pen, 'Stift', () => appendAndApply('drawing')),
        tb(I.camera, 'Foto', () => appendAndApply('image'))
      );
    }
    items.push(tb(I.sparkle, 'Claude', () => app.ai.openPanel(), 'pt-ai'));
    bt.append(h('div', { class: 'pt-group glass' }, items), h('button', { class: 'pt-compose glass glass-tint', type: 'button', 'aria-label': 'Neue Seite', onclick: () => app.createPage({}) }, svg(I.pen)));
    void isNarrow;
  }
}

function currentRange() {
  const r = getSelectionRange();
  return r ? r.cloneRange() : null;
}

function refocus(ed, b) {
  const el = ed.focusableEl(b.id);
  if (el && document.activeElement !== el) ed.focusBlock(b.id, -1);
}
