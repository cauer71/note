// Datenbanken: Tabelle, Board, Kalender, Liste, Galerie + Eigenschaften

import { h, svg, uid, fmtDate, relDay, parseISODate, toISODate, todayISO, normalizeSearch, toast, clamp } from './util.js';
import { I } from './icons.js';
import { menu, popover, confirmDialog, promptDialog } from './menus.js';
import { PROP_TYPES, PROP_TYPE_BY_ID, OPTION_COLORS, newProp, newView, pageTitle } from './model.js';
import { COLOR_LABELS } from './inline.js';
import { blocksToPlain } from './markdown.js';

const VIEW_TYPES = [
  { type: 'table', label: 'Tabelle', icon: I.table },
  { type: 'board', label: 'Board', icon: I.board },
  { type: 'calendar', label: 'Kalender', icon: I.calendar },
  { type: 'list', label: 'Liste', icon: I.list },
  { type: 'gallery', label: 'Galerie', icon: I.gallery },
];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ---------------------------------------------------------------------------
// Einstieg
// ---------------------------------------------------------------------------
export function renderDatabaseInline(ed, b) {
  const app = ed.app;
  const db = app.getPage(b.pageId);
  const wrap = h('div', { class: 'db-inline' });
  if (!db || db.trashed) {
    wrap.appendChild(h('div', { class: 'db-missing' }, svg(I.database), ' Diese Datenbank wurde gelöscht.'));
    return wrap;
  }
  const title = h('div', { class: 'dbv-title', contenteditable: 'true', 'data-ph': 'Unbenannte Datenbank', spellcheck: 'true' });
  title.textContent = db.title || '';
  title.addEventListener('input', () => {
    db.title = title.textContent;
    app.touch(db);
    app.renderNav();
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      title.blur();
    }
  });
  const head = h(
    'div',
    { class: 'db-inline-head' },
    h('span', { class: 'db-inline-ico' }, db.icon ? h('span', { class: 'emoji' }, db.icon) : svg(I.database)),
    title,
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Als ganze Seite öffnen', title: 'Als ganze Seite öffnen', onclick: () => app.navigate(db.id) }, svg(I.arrowUpRight))
  );
  const view = new DbView(app, db, { inline: true });
  wrap.append(head, view.el);
  view.render();
  wrap._dbview = view;
  return wrap;
}

export function renderDatabasePage(app, db) {
  const view = new DbView(app, db, { inline: false });
  view.render();
  return view;
}

// ---------------------------------------------------------------------------
export class DbView {
  constructor(app, db, opts = {}) {
    this.app = app;
    this.db = db;
    this.opts = opts;
    this.search = '';
    this.el = h('div', { class: 'dbv' + (opts.inline ? ' dbv-inline' : '') });
    this.el._dbview = this;
    if (!db.db.views || !db.db.views.length) db.db.views = [newView('table')];
    this.monthCursor = null;
  }

  get schema() {
    return this.db.db;
  }
  get view() {
    const v = this.schema.views.find((x) => x.id === this.schema.activeView) || this.schema.views[0];
    return v;
  }
  prop(id) {
    return this.schema.properties.find((p) => p.id === id);
  }
  save() {
    this.app.touch(this.db);
  }

  rows() {
    let rows = this.app.rowsOf(this.db.id);
    const v = this.view;
    for (const f of v.filters || []) rows = rows.filter((r) => matchFilter(this, r, f));
    if (this.search.trim()) {
      const q = normalizeSearch(this.search);
      rows = rows.filter((r) => normalizeSearch(pageTitle(r) + ' ' + this.schema.properties.map((p) => cellText(p, r.props && r.props[p.id])).join(' ')).includes(q));
    }
    const sorts = v.sorts && v.sorts.length ? v.sorts : null;
    rows.sort((a, b) => {
      if (sorts) {
        for (const s of sorts) {
          const c = compareRows(this, a, b, s.prop);
          if (c) return s.dir === 'desc' ? -c : c;
        }
      }
      return (a.order || 0) - (b.order || 0);
    });
    return rows;
  }

  render() {
    const el = this.el;
    el.innerHTML = '';
    el.appendChild(this.renderToolbar());
    const body = h('div', { class: 'dbv-body' });
    el.appendChild(body);
    const t = this.view.type;
    if (t === 'table') body.appendChild(this.renderTable());
    else if (t === 'board') body.appendChild(this.renderBoard());
    else if (t === 'calendar') body.appendChild(this.renderCalendar());
    else if (t === 'list') body.appendChild(this.renderList());
    else body.appendChild(this.renderGallery());
  }

  refresh() {
    const scrollers = [...this.el.querySelectorAll('.dbt-scroll, .board-scroll')].map((s) => [s.className, s.scrollLeft]);
    this.render();
    for (const [cls, left] of scrollers) {
      const s = this.el.querySelector('.' + cls.split(' ')[0]);
      if (s) s.scrollLeft = left;
    }
  }

  // --- Toolbar ------------------------------------------------------------
  renderToolbar() {
    const v = this.view;
    const tabs = h('div', { class: 'dbv-tabs', role: 'tablist' });
    for (const view of this.schema.views) {
      const vt = VIEW_TYPES.find((x) => x.type === view.type) || VIEW_TYPES[0];
      const tab = h(
        'button',
        {
          class: 'dbv-tab' + (view.id === v.id ? ' on' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': view.id === v.id ? 'true' : 'false',
          onclick: (e) => {
            if (view.id === v.id) this.viewMenu(e.currentTarget, view);
            else {
              this.schema.activeView = view.id;
              this.save();
              this.render();
            }
          },
        },
        svg(vt.icon),
        h('span', {}, view.name)
      );
      tabs.appendChild(tab);
    }
    tabs.appendChild(
      h(
        'button',
        {
          class: 'dbv-tab dbv-tab-add',
          type: 'button',
          'aria-label': 'Ansicht hinzufügen',
          onclick: (e) =>
            menu(
              e.currentTarget,
              VIEW_TYPES.map((vt) => ({
                label: vt.label,
                icon: vt.icon,
                onSelect: () => this.addView(vt.type),
              })),
              { title: 'Neue Ansicht' }
            ),
        },
        svg(I.plus)
      )
    );
    const nFilters = (v.filters || []).length;
    const nSorts = (v.sorts || []).length;
    const searchInput = h('input', { class: 'dbv-search-input', type: 'search', placeholder: 'Suchen', value: this.search, 'aria-label': 'In Datenbank suchen' });
    searchInput.value = this.search;
    searchInput.addEventListener('input', () => {
      this.search = searchInput.value;
      const body = this.el.querySelector('.dbv-body');
      const pos = searchInput.selectionStart;
      this.render();
      const si = this.el.querySelector('.dbv-search-input');
      si.focus();
      si.setSelectionRange(pos, pos);
      void body;
    });
    const actions = h(
      'div',
      { class: 'dbv-actions' },
      h('label', { class: 'dbv-search' + (this.search ? ' on' : '') }, svg(I.search), searchInput),
      h('button', { class: 'icon-btn' + (nFilters ? ' on' : ''), type: 'button', 'aria-label': 'Filter', title: 'Filter', onclick: (e) => this.filterPopover(e.currentTarget) }, svg(I.filter), nFilters ? h('span', { class: 'badge-dot' }, String(nFilters)) : null),
      h('button', { class: 'icon-btn' + (nSorts ? ' on' : ''), type: 'button', 'aria-label': 'Sortieren', title: 'Sortieren', onclick: (e) => this.sortPopover(e.currentTarget) }, svg(I.sort), nSorts ? h('span', { class: 'badge-dot' }, String(nSorts)) : null),
      h('button', { class: 'btn btn-prominent btn-sm', type: 'button', onclick: () => this.addRow({}, true) }, svg(I.plus), h('span', { class: 'hide-xs' }, ' Neu'))
    );
    return h('div', { class: 'dbv-toolbar' }, tabs, actions);
  }

  addView(type) {
    const extra = {};
    if (type === 'board') {
      const sel = this.schema.properties.find((p) => p.type === 'select');
      if (sel) extra.groupBy = sel.id;
      else {
        const p = newProp('select', 'Status', ['Offen', 'In Arbeit', 'Erledigt']);
        this.schema.properties.push(p);
        extra.groupBy = p.id;
      }
    }
    if (type === 'calendar') {
      const d = this.schema.properties.find((p) => p.type === 'date');
      if (d) extra.dateProp = d.id;
      else {
        const p = newProp('date', 'Datum');
        this.schema.properties.push(p);
        extra.dateProp = p.id;
      }
    }
    const v = newView(type, extra);
    this.schema.views.push(v);
    this.schema.activeView = v.id;
    this.save();
    this.render();
  }

  viewMenu(anchor, view) {
    const items = [
      {
        label: 'Umbenennen',
        icon: I.type,
        onSelect: async () => {
          const n = await promptDialog({ title: 'Ansicht umbenennen', value: view.name, okLabel: 'Speichern' });
          if (n != null && n.trim()) {
            view.name = n.trim();
            this.save();
            this.render();
          }
        },
      },
    ];
    if (view.type === 'board') {
      items.push({
        label: 'Gruppieren nach',
        icon: I.board,
        submenu: this.schema.properties.filter((p) => p.type === 'select').map((p) => ({ label: p.name, checked: view.groupBy === p.id, onSelect: () => { view.groupBy = p.id; this.save(); this.render(); } })),
      });
    }
    if (view.type === 'calendar') {
      items.push({
        label: 'Datum aus',
        icon: I.calendar,
        submenu: this.schema.properties.filter((p) => p.type === 'date').map((p) => ({ label: p.name, checked: view.dateProp === p.id, onSelect: () => { view.dateProp = p.id; this.save(); this.render(); } })),
      });
    }
    items.push({
      label: 'Eigenschaften zeigen',
      icon: I.eye,
      submenu: this.schema.properties.map((p) => ({
        label: p.name,
        checked: !(view.hidden || []).includes(p.id),
        keepOpen: false,
        onSelect: () => {
          view.hidden = view.hidden || [];
          if (view.hidden.includes(p.id)) view.hidden = view.hidden.filter((x) => x !== p.id);
          else view.hidden.push(p.id);
          this.save();
          this.render();
        },
      })),
    });
    items.push({
      label: 'Duplizieren',
      icon: I.duplicate,
      onSelect: () => {
        const c = JSON.parse(JSON.stringify(view));
        c.id = uid('v');
        c.name = view.name + ' (Kopie)';
        this.schema.views.push(c);
        this.schema.activeView = c.id;
        this.save();
        this.render();
      },
    });
    items.push({
      label: 'Ansicht löschen',
      icon: I.trash,
      danger: true,
      disabled: this.schema.views.length < 2,
      onSelect: () => {
        this.schema.views = this.schema.views.filter((x) => x.id !== view.id);
        this.schema.activeView = this.schema.views[0].id;
        this.save();
        this.render();
      },
    });
    menu(anchor, items, { title: view.name });
  }

  // --- Zeilen -------------------------------------------------------------
  addRow(props = {}, open = false) {
    // Filter mit "ist gleich" vorbelegen
    for (const f of this.view.filters || []) {
      const p = this.prop(f.prop);
      if (!p || props[p.id] != null) continue;
      if ((p.type === 'select' && f.op === 'is') || (p.type === 'checkbox' && f.op === 'checked')) props[p.id] = p.type === 'checkbox' ? true : f.value;
    }
    const row = this.app.createRow(this.db, props);
    if (open) this.app.openRow(row, this.db);
    else {
      this.refresh();
      setTimeout(() => {
        const input = this.el.querySelector(`[data-row="${row.id}"] .cell-title-input`);
        if (input) input.focus();
      }, 0);
    }
    return row;
  }

  setValue(row, prop, value) {
    row.props = row.props || {};
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) delete row.props[prop.id];
    else row.props[prop.id] = value;
    this.app.touch(row);
  }

  rowMenu(anchor, row) {
    menu(
      anchor,
      [
        { label: 'Als Seite öffnen', icon: I.arrowUpRight, onSelect: () => this.app.openRow(row, this.db) },
        { label: 'Duplizieren', icon: I.duplicate, onSelect: () => { this.app.duplicatePage(row.id, this.db.id); this.refresh(); } },
        { divider: true },
        { label: 'Löschen', icon: I.trash, danger: true, onSelect: () => { this.app.trashPage(row.id, { silent: false }); this.refresh(); } },
      ],
      { title: pageTitle(row) }
    );
  }

  // --- Tabelle ------------------------------------------------------------
  visibleProps() {
    const hidden = new Set(this.view.hidden || []);
    return this.schema.properties.filter((p) => !hidden.has(p.id));
  }

  renderTable() {
    const rows = this.rows();
    const props = this.visibleProps();
    const table = h('table', { class: 'dbt' });
    const thead = h('thead');
    const hr = h('tr');
    hr.appendChild(h('th', { class: 'dbt-th dbt-th-title', style: { width: (this.schema.titleWidth || 240) + 'px' } }, this.headerBtn(null)));
    for (const p of props) hr.appendChild(h('th', { class: 'dbt-th', style: { width: (p.width || 180) + 'px' } }, this.headerBtn(p)));
    hr.appendChild(
      h(
        'th',
        { class: 'dbt-th dbt-th-add' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Eigenschaft hinzufügen', title: 'Eigenschaft hinzufügen', onclick: (e) => this.addPropMenu(e.currentTarget) }, svg(I.plus))
      )
    );
    thead.appendChild(hr);
    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr', { class: 'dbt-row', 'data-row': r.id });
      tr.appendChild(h('td', { class: 'dbt-td dbt-td-title' }, this.titleCell(r)));
      for (const p of props) tr.appendChild(h('td', { class: 'dbt-td dbt-td-' + p.type }, this.cell(r, p)));
      tr.appendChild(h('td', { class: 'dbt-td dbt-td-more' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zeilenmenü', onclick: (e) => this.rowMenu(e.currentTarget, r) }, svg(I.more))));
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    const scroll = h('div', { class: 'dbt-scroll' }, table);
    const foot = h(
      'div',
      { class: 'dbt-foot' },
      h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => this.addRow({}) }, svg(I.plus), ' Neue Zeile'),
      h('span', { class: 'dbt-count' }, rows.length === 1 ? '1 Eintrag' : rows.length + ' Einträge')
    );
    return h('div', { class: 'dbt-wrap' }, scroll, foot);
  }

  headerBtn(p) {
    const icon = p ? PROP_TYPE_BY_ID[p.type].icon : I.type;
    const name = p ? p.name : this.schema.titleName || 'Name';
    const sort = (this.view.sorts || []).find((s) => s.prop === (p ? p.id : 'title'));
    const btn = h('button', { class: 'dbt-head', type: 'button', onclick: (e) => this.propMenu(e.currentTarget, p) }, svg(icon), h('span', { class: 'dbt-head-name' }, name), sort ? svg(sort.dir === 'desc' ? I.arrowDown : I.arrowUp, 'dbt-sort') : null);
    // Spaltenbreite ziehen
    const grip = h('span', { class: 'col-resize', 'aria-hidden': 'true' });
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const th = grip.closest('th');
      const start = e.clientX;
      const w0 = th.offsetWidth;
      const move = (ev) => {
        const w = clamp(w0 + ev.clientX - start, 90, 600);
        th.style.width = w + 'px';
        if (p) p.width = w;
        else this.schema.titleWidth = w;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.save();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return h('div', { class: 'dbt-head-wrap' }, btn, grip);
  }

  titleCell(r) {
    const input = h('input', { class: 'cell-title-input', type: 'text', placeholder: 'Ohne Titel', 'aria-label': 'Titel' });
    input.value = r.title || '';
    input.addEventListener('input', () => {
      r.title = input.value;
      this.app.touch(r);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey || !input.value) input.blur();
        else this.addRow({});
      }
    });
    const icon = r.icon ? h('span', { class: 'emoji cell-row-ico' }, r.icon) : null;
    return h(
      'div',
      { class: 'cell-title' },
      icon,
      input,
      h('button', { class: 'cell-open', type: 'button', onclick: () => this.app.openRow(r, this.db), 'aria-label': 'Öffnen' }, svg(I.arrowUpRight), h('span', {}, 'Öffnen'))
    );
  }

  cell(r, p) {
    const v = r.props ? r.props[p.id] : undefined;
    switch (p.type) {
      case 'checkbox': {
        const btn = h('button', { class: 'cell-check' + (v ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': v ? 'true' : 'false', 'aria-label': p.name }, svg(I.check));
        btn.addEventListener('click', () => {
          this.setValue(r, p, !v);
          this.refresh();
        });
        return btn;
      }
      case 'select':
      case 'multi': {
        const btn = h('button', { class: 'cell-select', type: 'button', 'aria-label': p.name }, this.pills(p, v));
        btn.addEventListener('click', () => this.selectMenu(btn, r, p));
        return btn;
      }
      case 'date': {
        const input = h('input', { class: 'cell-date', type: 'date', 'aria-label': p.name });
        input.value = v || '';
        const wrapDate = h('label', { class: 'cell-date-wrap' + (v ? '' : ' empty') }, h('span', { class: 'cell-date-text' + (isOverdue(v) ? ' overdue' : '') }, v ? relDay(v) : ''), input);
        input.addEventListener('change', () => {
          this.setValue(r, p, input.value || null);
          this.refresh();
        });
        return wrapDate;
      }
      case 'number': {
        const input = h('input', { class: 'cell-input cell-number', type: 'text', inputmode: 'decimal', 'aria-label': p.name });
        input.value = v ?? '';
        input.addEventListener('change', () => {
          const n = parseFloat(String(input.value).replace(',', '.'));
          this.setValue(r, p, isNaN(n) ? null : n);
          input.value = isNaN(n) ? '' : String(n).replace('.', ',');
        });
        if (typeof v === 'number') input.value = String(v).replace('.', ',');
        return input;
      }
      case 'url': {
        const input = h('input', { class: 'cell-input', type: 'url', inputmode: 'url', 'aria-label': p.name, placeholder: '' });
        input.value = v || '';
        input.addEventListener('change', () => this.setValue(r, p, input.value.trim() || null));
        const link = v ? h('a', { class: 'cell-link', href: /^[a-z]+:/i.test(v) ? v : 'https://' + v, target: '_blank', rel: 'noopener', 'aria-label': 'Link öffnen' }, svg(I.arrowUpRight)) : null;
        return h('div', { class: 'cell-url' }, input, link);
      }
      default: {
        const input = h('input', { class: 'cell-input', type: 'text', 'aria-label': p.name });
        input.value = v || '';
        input.addEventListener('input', () => this.setValue(r, p, input.value || null));
        return input;
      }
    }
  }

  pills(p, v) {
    const ids = p.type === 'multi' ? (Array.isArray(v) ? v : []) : v ? [v] : [];
    const wrap = h('span', { class: 'pills' });
    for (const id of ids) {
      const o = (p.options || []).find((x) => x.id === id);
      if (o) wrap.appendChild(h('span', { class: 'pill', 'data-c': o.color }, o.name));
    }
    return wrap;
  }

  selectMenu(anchor, r, p, after) {
    const multi = p.type === 'multi';
    const cur = r.props ? r.props[p.id] : null;
    const list = h('div', { class: 'menu select-menu' });
    const input = h('input', { class: 'menu-search', type: 'text', placeholder: multi ? 'Optionen suchen oder erstellen' : 'Option suchen oder erstellen' });
    const items = h('div', { class: 'menu-items' });
    list.append(input, items);
    const draw = () => {
      items.innerHTML = '';
      const q = input.value.trim();
      const nq = normalizeSearch(q);
      const opts = (p.options || []).filter((o) => !nq || normalizeSearch(o.name).includes(nq));
      const selected = multi ? (Array.isArray(r.props?.[p.id]) ? r.props[p.id] : []) : [r.props?.[p.id]];
      for (const o of opts) {
        const on = selected.includes(o.id);
        const b = h('button', { class: 'menu-item' + (on ? ' checked' : ''), type: 'button' }, h('span', { class: 'pill', 'data-c': o.color }, o.name), h('span', { class: 'menu-label' }), on ? svg(I.check, 'menu-check') : null);
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          if (multi) {
            const set = new Set(selected.filter(Boolean));
            if (set.has(o.id)) set.delete(o.id);
            else set.add(o.id);
            this.setValue(r, p, [...set]);
            draw();
          } else {
            this.setValue(r, p, on ? null : o.id);
            pop.close();
          }
        });
        items.appendChild(b);
      }
      if (q && !(p.options || []).some((o) => normalizeSearch(o.name) === nq)) {
        const b = h('button', { class: 'menu-item', type: 'button' }, svg(I.plus, 'menu-ico'), h('span', { class: 'menu-label' }, `„${q}“ erstellen`));
        b.addEventListener('click', () => {
          const o = { id: uid('o'), name: q, color: OPTION_COLORS[(p.options || []).length % OPTION_COLORS.length] };
          p.options = p.options || [];
          p.options.push(o);
          this.save();
          if (multi) this.setValue(r, p, [...(Array.isArray(r.props?.[p.id]) ? r.props[p.id] : []), o.id]);
          else this.setValue(r, p, o.id);
          input.value = '';
          if (multi) draw();
          else pop.close();
        });
        items.appendChild(b);
      }
      if (!items.childNodes.length) items.appendChild(h('div', { class: 'menu-empty' }, 'Tippe, um eine Option zu erstellen'));
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = items.querySelector('.menu-item');
        if (first) first.click();
      }
    });
    draw();
    const pop = popover(anchor, list, {
      title: p.name,
      onClose: () => {
        if (after) after();
        else this.refresh();
      },
    });
    void cur;
  }

  // --- Eigenschaften ------------------------------------------------------
  addPropMenu(anchor) {
    menu(
      anchor,
      PROP_TYPES.map((t) => ({
        label: t.label,
        icon: t.icon,
        onSelect: async () => {
          const name = await promptDialog({ title: 'Neue Eigenschaft', label: 'Name', value: t.label, okLabel: 'Hinzufügen' });
          if (name == null) return;
          const p = newProp(t.type, name.trim() || t.label, t.type === 'select' || t.type === 'multi' ? [] : undefined);
          this.schema.properties.push(p);
          this.save();
          this.render();
        },
      })),
      { title: 'Eigenschaftstyp' }
    );
  }

  propMenu(anchor, p) {
    const sortBy = (dir) => {
      this.view.sorts = [{ prop: p ? p.id : 'title', dir }];
      this.save();
      this.render();
    };
    const items = [];
    items.push({
      label: 'Umbenennen',
      icon: I.type,
      onSelect: async () => {
        const n = await promptDialog({ title: 'Eigenschaft umbenennen', value: p ? p.name : this.schema.titleName || 'Name', okLabel: 'Speichern' });
        if (n == null || !n.trim()) return;
        if (p) p.name = n.trim();
        else this.schema.titleName = n.trim();
        this.save();
        this.render();
      },
    });
    if (p) {
      items.push({
        label: 'Typ: ' + PROP_TYPE_BY_ID[p.type].label,
        icon: PROP_TYPE_BY_ID[p.type].icon,
        submenu: PROP_TYPES.map((t) => ({
          label: t.label,
          icon: t.icon,
          checked: t.type === p.type,
          onSelect: () => this.changePropType(p, t.type),
        })),
      });
      if (p.type === 'select' || p.type === 'multi') items.push({ label: 'Optionen bearbeiten', icon: I.palette, onSelect: () => this.optionsEditor(anchor, p) });
    }
    items.push({ divider: true });
    items.push({ label: 'Aufsteigend sortieren', icon: I.arrowUp, onSelect: () => sortBy('asc') });
    items.push({ label: 'Absteigend sortieren', icon: I.arrowDown, onSelect: () => sortBy('desc') });
    if (p) {
      items.push({ label: 'Filtern', icon: I.filter, onSelect: () => { this.view.filters = this.view.filters || []; this.view.filters.push(defaultFilter(p)); this.save(); this.render(); this.filterPopover(this.el.querySelector('.dbv-actions .icon-btn')); } });
      items.push({ label: 'In dieser Ansicht ausblenden', icon: I.eyeOff, onSelect: () => { this.view.hidden = [...(this.view.hidden || []), p.id]; this.save(); this.render(); } });
      items.push({ divider: true });
      items.push({
        label: 'Eigenschaft löschen',
        icon: I.trash,
        danger: true,
        onSelect: async () => {
          const ok = await confirmDialog({ title: 'Eigenschaft löschen?', text: `„${p.name}“ und alle Werte werden entfernt.`, okLabel: 'Löschen', danger: true });
          if (!ok) return;
          this.schema.properties = this.schema.properties.filter((x) => x.id !== p.id);
          for (const v of this.schema.views) {
            v.filters = (v.filters || []).filter((f) => f.prop !== p.id);
            v.sorts = (v.sorts || []).filter((s) => s.prop !== p.id);
          }
          for (const r of this.app.rowsOf(this.db.id)) {
            if (r.props && p.id in r.props) {
              delete r.props[p.id];
              this.app.touch(r);
            }
          }
          this.save();
          this.render();
        },
      });
    }
    menu(anchor, items, { title: p ? p.name : this.schema.titleName || 'Name' });
  }

  changePropType(p, type) {
    const old = p.type;
    if (old === type) return;
    const rows = this.app.rowsOf(this.db.id);
    if ((type === 'select' || type === 'multi') && !p.options) p.options = [];
    for (const r of rows) {
      if (!r.props || r.props[p.id] == null) continue;
      const v = r.props[p.id];
      let nv = null;
      const text = cellText(p, v);
      if (type === 'text' || type === 'url') nv = text || null;
      else if (type === 'number') {
        const n = parseFloat(String(text).replace(',', '.'));
        nv = isNaN(n) ? null : n;
      } else if (type === 'checkbox') nv = !!v && v !== 'Nein';
      else if (type === 'date') nv = /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
      else if (type === 'select' || type === 'multi') {
        const names = old === 'multi' ? text.split(', ') : [text];
        const ids = [];
        for (const nm of names.filter(Boolean)) {
          let o = p.options.find((x) => x.name === nm);
          if (!o) {
            o = { id: uid('o'), name: nm, color: OPTION_COLORS[p.options.length % OPTION_COLORS.length] };
            p.options.push(o);
          }
          ids.push(o.id);
        }
        nv = type === 'multi' ? ids : ids[0] || null;
      }
      if (nv == null) delete r.props[p.id];
      else r.props[p.id] = nv;
      this.app.touch(r);
    }
    p.type = type;
    this.save();
    this.render();
  }

  optionsEditor(anchor, p) {
    const list = h('div', { class: 'opt-editor' });
    const draw = () => {
      list.innerHTML = '';
      for (const o of p.options || []) {
        const input = h('input', { class: 'input input-sm', type: 'text', value: o.name });
        input.value = o.name;
        input.addEventListener('change', () => {
          o.name = input.value.trim() || o.name;
          this.save();
        });
        const sw = h('button', {
          class: 'pill pill-swatch',
          'data-c': o.color,
          type: 'button',
          'aria-label': 'Farbe',
          onclick: (e) =>
            menu(e.currentTarget, OPTION_COLORS.map((c) => ({ label: COLOR_LABELS[c], swatch: 'b-' + c, checked: o.color === c, onSelect: () => { o.color = c; this.save(); draw(); } })), { stack: true, title: 'Farbe' }),
        }, 'Aa');
        const del = h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'Option löschen',
          onclick: () => {
            p.options = p.options.filter((x) => x !== o);
            this.save();
            draw();
          },
        }, svg(I.trash));
        list.appendChild(h('div', { class: 'opt-row' }, sw, input, del));
      }
      const add = h('button', {
        class: 'btn btn-plain btn-sm',
        type: 'button',
        onclick: () => {
          p.options = p.options || [];
          p.options.push({ id: uid('o'), name: 'Neue Option', color: OPTION_COLORS[p.options.length % OPTION_COLORS.length] });
          this.save();
          draw();
          const inputs = list.querySelectorAll('input');
          inputs[inputs.length - 1].select();
        },
      }, svg(I.plus), ' Option hinzufügen');
      list.appendChild(add);
    };
    draw();
    popover(anchor, list, { title: 'Optionen · ' + p.name, onClose: () => this.render() });
  }

  // --- Filter & Sortierung ------------------------------------------------
  filterPopover(anchor) {
    const v = this.view;
    v.filters = v.filters || [];
    const box = h('div', { class: 'filter-pop' });
    const draw = () => {
      box.innerHTML = '';
      if (!v.filters.length) box.appendChild(h('div', { class: 'menu-empty' }, 'Keine Filter aktiv'));
      v.filters.forEach((f, i) => {
        const p = this.prop(f.prop);
        if (!p) return;
        const propSel = h('select', { class: 'select' });
        for (const x of this.schema.properties) propSel.appendChild(h('option', { value: x.id, selected: x.id === f.prop }, x.name));
        propSel.addEventListener('change', () => {
          v.filters[i] = defaultFilter(this.prop(propSel.value));
          this.save();
          draw();
          this.render();
        });
        const opSel = h('select', { class: 'select' });
        for (const [op, label] of filterOps(p)) opSel.appendChild(h('option', { value: op, selected: op === f.op }, label));
        opSel.addEventListener('change', () => {
          f.op = opSel.value;
          this.save();
          draw();
          this.render();
        });
        let val = null;
        if (!['empty', 'notempty', 'checked', 'unchecked', 'past', 'next7', 'today'].includes(f.op)) {
          if (p.type === 'select' || p.type === 'multi') {
            val = h('select', { class: 'select' });
            val.appendChild(h('option', { value: '' }, '–'));
            for (const o of p.options || []) val.appendChild(h('option', { value: o.id, selected: o.id === f.value }, o.name));
            val.addEventListener('change', () => {
              f.value = val.value;
              this.save();
              this.render();
            });
          } else {
            val = h('input', { class: 'input input-sm', type: p.type === 'date' ? 'date' : 'text', value: f.value || '' });
            val.value = f.value || '';
            val.addEventListener('input', () => {
              f.value = val.value;
              this.save();
              this.render();
            });
          }
        }
        box.appendChild(
          h('div', { class: 'filter-row' }, propSel, opSel, val, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Filter entfernen', onclick: () => { v.filters.splice(i, 1); this.save(); draw(); this.render(); } }, svg(I.close)))
        );
      });
      box.appendChild(
        h('button', {
          class: 'btn btn-plain btn-sm',
          type: 'button',
          disabled: !this.schema.properties.length,
          onclick: () => {
            v.filters.push(defaultFilter(this.schema.properties[0]));
            this.save();
            draw();
            this.render();
          },
        }, svg(I.plus), ' Filter hinzufügen')
      );
    };
    draw();
    popover(anchor, box, { title: 'Filter', alignRight: true });
  }

  sortPopover(anchor) {
    const v = this.view;
    v.sorts = v.sorts || [];
    const box = h('div', { class: 'filter-pop' });
    const all = [{ id: 'title', name: this.schema.titleName || 'Name' }, ...this.schema.properties];
    const draw = () => {
      box.innerHTML = '';
      if (!v.sorts.length) box.appendChild(h('div', { class: 'menu-empty' }, 'Manuelle Reihenfolge'));
      v.sorts.forEach((s, i) => {
        const propSel = h('select', { class: 'select' });
        for (const x of all) propSel.appendChild(h('option', { value: x.id, selected: x.id === s.prop }, x.name));
        propSel.addEventListener('change', () => {
          s.prop = propSel.value;
          this.save();
          this.render();
        });
        const dirSel = h('select', { class: 'select' }, h('option', { value: 'asc', selected: s.dir !== 'desc' }, 'Aufsteigend'), h('option', { value: 'desc', selected: s.dir === 'desc' }, 'Absteigend'));
        dirSel.addEventListener('change', () => {
          s.dir = dirSel.value;
          this.save();
          this.render();
        });
        box.appendChild(h('div', { class: 'filter-row' }, propSel, dirSel, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sortierung entfernen', onclick: () => { v.sorts.splice(i, 1); this.save(); draw(); this.render(); } }, svg(I.close))));
      });
      box.appendChild(h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => { v.sorts.push({ prop: all[0].id, dir: 'asc' }); this.save(); draw(); this.render(); } }, svg(I.plus), ' Sortierung hinzufügen'));
    };
    draw();
    popover(anchor, box, { title: 'Sortieren', alignRight: true });
  }

  // --- Board --------------------------------------------------------------
  renderBoard() {
    const v = this.view;
    let gp = this.prop(v.groupBy);
    if (!gp || gp.type !== 'select') {
      gp = this.schema.properties.find((p) => p.type === 'select');
      if (!gp) return h('div', { class: 'db-missing' }, 'Füge eine Auswahl-Eigenschaft hinzu, um ein Board zu nutzen.');
      v.groupBy = gp.id;
    }
    const rows = this.rows();
    const groups = [...(gp.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color })), { id: '', name: 'Ohne ' + gp.name, color: 'gray' }];
    const scroll = h('div', { class: 'board-scroll' });
    const board = h('div', { class: 'board' });
    for (const g of groups) {
      const items = rows.filter((r) => (r.props?.[gp.id] || '') === g.id);
      if (!g.id && !items.length) continue;
      const col = h('div', { class: 'board-col', 'data-group': g.id });
      col.appendChild(h('div', { class: 'board-col-head' }, h('span', { class: 'pill', 'data-c': g.color }, g.name), h('span', { class: 'board-count' }, String(items.length))));
      const list = h('div', { class: 'board-list' });
      for (const r of items) list.appendChild(this.boardCard(r, gp));
      col.appendChild(list);
      col.appendChild(h('button', { class: 'board-add', type: 'button', onclick: () => this.addRow(g.id ? { [gp.id]: g.id } : {}, true) }, svg(I.plus), ' Neu'));
      board.appendChild(col);
    }
    scroll.appendChild(board);
    return scroll;
  }

  boardCard(r, gp) {
    const props = this.visibleProps().filter((p) => p.id !== gp.id);
    const meta = h('div', { class: 'card-meta' });
    for (const p of props) {
      const v = r.props?.[p.id];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      meta.appendChild(this.propChip(p, v));
    }
    const card = h(
      'div',
      { class: 'board-card', 'data-row': r.id, tabindex: '0', role: 'button' },
      h('div', { class: 'card-title' }, r.icon ? h('span', { class: 'emoji' }, r.icon + ' ') : null, pageTitle(r)),
      meta.childNodes.length ? meta : null
    );
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.app.openRow(r, this.db);
    });
    attachCardDrag(card, this, r, (target) => {
      const col = target && target.closest('.board-col');
      if (!col) return false;
      const gid = col.dataset.group;
      if ((r.props?.[gp.id] || '') !== gid) {
        this.setValue(r, gp, gid || null);
        // Reihenfolge: an Zielposition
      }
      const list = col.querySelector('.board-list');
      const cards = [...list.querySelectorAll('.board-card')].filter((c) => c !== card);
      const idx = cards.indexOf(target.closest('.board-card'));
      reorderRows(this, r, cards.map((c) => c.dataset.row), idx);
      this.refresh();
      return true;
    }, () => this.app.openRow(r, this.db));
    return card;
  }

  propChip(p, v) {
    if (p.type === 'select' || p.type === 'multi') return this.pills(p, v);
    if (p.type === 'checkbox') return h('span', { class: 'meta-chip' }, v ? '☑ ' : '☐ ', p.name);
    if (p.type === 'date') return h('span', { class: 'meta-chip' + (isOverdue(v) ? ' overdue' : '') }, svg(I.calendar), ' ', relDay(v));
    if (p.type === 'url') return h('span', { class: 'meta-chip' }, svg(I.link), ' ', String(v).replace(/^https?:\/\//, '').slice(0, 24));
    return h('span', { class: 'meta-chip' }, String(v));
  }

  // --- Kalender -----------------------------------------------------------
  renderCalendar() {
    const v = this.view;
    let dp = this.prop(v.dateProp);
    if (!dp || dp.type !== 'date') {
      dp = this.schema.properties.find((p) => p.type === 'date');
      if (!dp) return h('div', { class: 'db-missing' }, 'Füge eine Datums-Eigenschaft hinzu, um den Kalender zu nutzen.');
      v.dateProp = dp.id;
    }
    const now = new Date();
    if (!this.monthCursor) this.monthCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    const m = this.monthCursor;
    const rows = this.rows();
    const byDay = new Map();
    for (const r of rows) {
      const d = r.props?.[dp.id];
      if (!d) continue;
      const key = String(d).slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(r);
    }
    const head = h(
      'div',
      { class: 'cal-head' },
      h('div', { class: 'cal-month' }, h('strong', {}, MONTHS[m.getMonth()]), ' ', m.getFullYear()),
      h(
        'div',
        { class: 'cal-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vorheriger Monat', onclick: () => { this.monthCursor = new Date(m.getFullYear(), m.getMonth() - 1, 1); this.refresh(); } }, svg(I.chevronLeft)),
        h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => { this.monthCursor = new Date(now.getFullYear(), now.getMonth(), 1); this.selectedDay = todayISO(); this.refresh(); } }, 'Heute'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nächster Monat', onclick: () => { this.monthCursor = new Date(m.getFullYear(), m.getMonth() + 1, 1); this.refresh(); } }, svg(I.chevronRight))
      )
    );
    const grid = h('div', { class: 'cal-grid' });
    WEEKDAYS.forEach((d) => grid.appendChild(h('div', { class: 'cal-wd' }, d)));
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    const today = todayISO();
    const weeks = Math.ceil((offset + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7);
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toISODate(d);
      const items = byDay.get(iso) || [];
      const cell = h('div', {
        class: 'cal-day' + (d.getMonth() !== m.getMonth() ? ' other' : '') + (iso === today ? ' today' : '') + (iso === this.selectedDay ? ' selected' : ''),
        'data-date': iso,
      });
      const num = h('button', { class: 'cal-num', type: 'button', 'aria-label': fmtDate(iso, 'long') }, String(d.getDate()));
      num.addEventListener('click', () => {
        this.selectedDay = iso;
        this.refresh();
      });
      const add = h('button', { class: 'cal-add', type: 'button', 'aria-label': 'Eintrag am ' + fmtDate(iso), onclick: () => this.addRow({ [dp.id]: iso }, true) }, svg(I.plus));
      cell.append(h('div', { class: 'cal-day-head' }, num, add));
      const list = h('div', { class: 'cal-items' });
      for (const r of items) {
        const it = h('div', { class: 'cal-item', 'data-row': r.id, tabindex: '0', role: 'button' }, pageTitle(r));
        const sel = this.schema.properties.find((p) => p.type === 'select');
        const o = sel && (sel.options || []).find((x) => x.id === r.props?.[sel.id]);
        if (o) it.setAttribute('data-c', o.color);
        attachCardDrag(it, this, r, (target) => {
          const day = target && target.closest('.cal-day');
          if (!day) return false;
          this.setValue(r, dp, day.dataset.date);
          this.refresh();
          return true;
        }, () => this.app.openRow(r, this.db));
        list.appendChild(it);
      }
      if (items.length) cell.appendChild(h('div', { class: 'cal-dots' }, items.slice(0, 4).map(() => h('span', { class: 'cal-dot' }))));
      cell.appendChild(list);
      grid.appendChild(cell);
    }
    const wrap = h('div', { class: 'cal' }, head, grid);
    // Tagesliste (v. a. für schmale Bildschirme)
    const sd = this.selectedDay || today;
    const dayItems = byDay.get(sd) || [];
    const dayList = h(
      'div',
      { class: 'cal-daylist' },
      h('div', { class: 'cal-daylist-head' }, h('strong', {}, fmtDate(sd, 'long')), h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => this.addRow({ [dp.id]: sd }, true) }, svg(I.plus), ' Eintrag')),
      dayItems.length
        ? h('div', { class: 'ios-list' }, dayItems.map((r) => h('button', { class: 'ios-row', type: 'button', onclick: () => this.app.openRow(r, this.db) }, h('span', { class: 'ios-row-title' }, pageTitle(r)), svg(I.chevronRight, 'ios-chev'))))
        : h('div', { class: 'muted cal-empty' }, 'Keine Einträge an diesem Tag.')
    );
    wrap.appendChild(dayList);
    return wrap;
  }

  // --- Liste & Galerie ----------------------------------------------------
  renderList() {
    const rows = this.rows();
    const props = this.visibleProps();
    const list = h('div', { class: 'ios-list db-list' });
    for (const r of rows) {
      const meta = h('span', { class: 'db-list-meta' });
      for (const p of props) {
        const v = r.props?.[p.id];
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
        meta.appendChild(this.propChip(p, v));
      }
      const row = h('div', { class: 'ios-row db-list-row', 'data-row': r.id });
      const check = props.find((p) => p.type === 'checkbox');
      if (check) {
        const on = !!r.props?.[check.id];
        row.appendChild(h('button', { class: 'cell-check round' + (on ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', 'aria-label': check.name, onclick: () => { this.setValue(r, check, !on); this.refresh(); } }, svg(I.check)));
      }
      row.appendChild(
        h('button', { class: 'db-list-main', type: 'button', onclick: () => this.app.openRow(r, this.db) }, h('span', { class: 'ios-row-title' + (check && r.props?.[check.id] ? ' done' : '') }, r.icon ? r.icon + ' ' : '', pageTitle(r)), meta)
      );
      row.appendChild(svg(I.chevronRight, 'ios-chev'));
      list.appendChild(row);
    }
    if (!rows.length) list.appendChild(h('div', { class: 'ios-row muted' }, 'Keine Einträge'));
    return h('div', {}, list, h('div', { class: 'dbt-foot' }, h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => this.addRow({}, true) }, svg(I.plus), ' Neuer Eintrag'), h('span', { class: 'dbt-count' }, rows.length === 1 ? '1 Eintrag' : rows.length + ' Einträge')));
  }

  renderGallery() {
    const rows = this.rows();
    const props = this.visibleProps();
    const grid = h('div', { class: 'gallery' });
    for (const r of rows) {
      const img = (r.blocks || []).find((b) => b.type === 'image' && b.src);
      const preview = blocksToPlain(r.blocks).trim().slice(0, 160);
      const meta = h('div', { class: 'card-meta' });
      for (const p of props) {
        const v = r.props?.[p.id];
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
        meta.appendChild(this.propChip(p, v));
      }
      grid.appendChild(
        h(
          'button',
          { class: 'gallery-card', type: 'button', onclick: () => this.app.openRow(r, this.db) },
          h('div', { class: 'gallery-cover' }, img ? h('img', { src: img.src, alt: '' }) : h('div', { class: 'gallery-text' }, preview || (r.icon ? '' : ''), r.icon && !preview ? h('span', { class: 'gallery-emoji' }, r.icon) : null)),
          h('div', { class: 'gallery-body' }, h('div', { class: 'card-title' }, r.icon ? r.icon + ' ' : '', pageTitle(r)), meta.childNodes.length ? meta : null)
        )
      );
    }
    grid.appendChild(h('button', { class: 'gallery-card gallery-add', type: 'button', onclick: () => this.addRow({}, true) }, svg(I.plus), ' Neu'));
    return grid;
  }
}

// ---------------------------------------------------------------------------
// Eigenschaften einer Zeile (auf der Zeilenseite)
// ---------------------------------------------------------------------------
export function renderRowProps(app, row, db) {
  const view = new DbView(app, db, { inline: true });
  const wrap = h('div', { class: 'row-props ios-list' });
  const draw = () => {
    wrap.innerHTML = '';
    for (const p of db.db.properties) {
      const v = row.props ? row.props[p.id] : undefined;
      let editor;
      if (p.type === 'select' || p.type === 'multi') {
        editor = h('button', { class: 'cell-select', type: 'button' }, view.pills(p, v));
        editor.addEventListener('click', () => view.selectMenu(editor, row, p, () => draw()));
        if (v == null || (Array.isArray(v) && !v.length)) editor.appendChild(h('span', { class: 'muted' }, 'Leer'));
      } else if (p.type === 'checkbox') {
        editor = h('button', { class: 'cell-check' + (v ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': v ? 'true' : 'false', 'aria-label': p.name, onclick: () => { view.setValue(row, p, !v); draw(); } }, svg(I.check));
      } else if (p.type === 'date') {
        const input = h('input', { class: 'cell-date-native', type: 'date', 'aria-label': p.name });
        input.value = v || '';
        input.addEventListener('change', () => {
          view.setValue(row, p, input.value || null);
          draw();
        });
        editor = h('div', { class: 'row-date' }, input, v ? h('span', { class: 'muted row-date-rel' + (isOverdue(v) ? ' overdue' : '') }, relDay(v)) : null);
      } else {
        editor = view.cell(row, p);
      }
      wrap.appendChild(h('div', { class: 'ios-row row-prop' }, h('span', { class: 'row-prop-name' }, svg(PROP_TYPE_BY_ID[p.type].icon), p.name), h('div', { class: 'row-prop-val' }, editor)));
    }
    wrap.appendChild(
      h('button', { class: 'ios-row row-prop-add', type: 'button', onclick: (e) => view.addPropMenu(e.currentTarget) }, svg(I.plus), ' Eigenschaft hinzufügen')
    );
  };
  view.render = () => draw();
  draw();
  return wrap;
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------
function isOverdue(v) {
  return v && String(v).slice(0, 10) < todayISO();
}

export function cellText(p, v) {
  if (v == null) return '';
  if (p.type === 'select') return (p.options || []).find((o) => o.id === v)?.name || '';
  if (p.type === 'multi') return (Array.isArray(v) ? v : []).map((id) => (p.options || []).find((o) => o.id === id)?.name).filter(Boolean).join(', ');
  if (p.type === 'checkbox') return v ? 'Ja' : 'Nein';
  if (p.type === 'date') return String(v);
  return String(v);
}

function compareRows(view, a, b, propId) {
  if (propId === 'title') return pageTitle(a).localeCompare(pageTitle(b), 'de');
  const p = view.prop(propId);
  if (!p) return 0;
  const va = a.props?.[p.id];
  const vb = b.props?.[p.id];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (p.type === 'number') return va - vb;
  if (p.type === 'checkbox') return (va ? 1 : 0) - (vb ? 1 : 0);
  if (p.type === 'select') {
    const ia = (p.options || []).findIndex((o) => o.id === va);
    const ib = (p.options || []).findIndex((o) => o.id === vb);
    return ia - ib;
  }
  return cellText(p, va).localeCompare(cellText(p, vb), 'de');
}

function filterOps(p) {
  switch (p.type) {
    case 'select':
      return [['is', 'ist'], ['not', 'ist nicht'], ['empty', 'ist leer'], ['notempty', 'ist nicht leer']];
    case 'multi':
      return [['has', 'enthält'], ['nothas', 'enthält nicht'], ['empty', 'ist leer'], ['notempty', 'ist nicht leer']];
    case 'checkbox':
      return [['checked', 'ist abgehakt'], ['unchecked', 'ist nicht abgehakt']];
    case 'date':
      return [['today', 'ist heute'], ['next7', 'in den nächsten 7 Tagen'], ['past', 'liegt in der Vergangenheit'], ['before', 'vor'], ['after', 'nach'], ['empty', 'ist leer'], ['notempty', 'ist nicht leer']];
    case 'number':
      return [['eq', '='], ['gt', '>'], ['lt', '<'], ['empty', 'ist leer'], ['notempty', 'ist nicht leer']];
    default:
      return [['contains', 'enthält'], ['notcontains', 'enthält nicht'], ['empty', 'ist leer'], ['notempty', 'ist nicht leer']];
  }
}

function defaultFilter(p) {
  return { id: uid('f'), prop: p.id, op: filterOps(p)[0][0], value: '' };
}

function matchFilter(view, r, f) {
  const p = view.prop(f.prop);
  if (!p) return true;
  const v = r.props?.[p.id];
  const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
  switch (f.op) {
    case 'empty':
      return empty;
    case 'notempty':
      return !empty;
    case 'is':
      return !f.value || v === f.value;
    case 'not':
      return !f.value || v !== f.value;
    case 'has':
      return !f.value || (Array.isArray(v) && v.includes(f.value));
    case 'nothas':
      return !f.value || !(Array.isArray(v) && v.includes(f.value));
    case 'checked':
      return !!v;
    case 'unchecked':
      return !v;
    case 'contains':
      return !f.value || normalizeSearch(cellText(p, v)).includes(normalizeSearch(f.value));
    case 'notcontains':
      return !f.value || !normalizeSearch(cellText(p, v)).includes(normalizeSearch(f.value));
    case 'eq':
      return f.value === '' || Number(v) === Number(String(f.value).replace(',', '.'));
    case 'gt':
      return f.value === '' || Number(v) > Number(String(f.value).replace(',', '.'));
    case 'lt':
      return f.value === '' || Number(v) < Number(String(f.value).replace(',', '.'));
    case 'today':
      return !empty && String(v).slice(0, 10) === todayISO();
    case 'next7': {
      if (empty) return false;
      const d = parseISODate(v);
      const t = parseISODate(todayISO());
      const diff = (d - t) / 86400000;
      return diff >= 0 && diff <= 7;
    }
    case 'past':
      return !empty && String(v).slice(0, 10) < todayISO();
    case 'before':
      return !f.value || (!empty && String(v) < f.value);
    case 'after':
      return !f.value || (!empty && String(v) > f.value);
    default:
      return true;
  }
}

function reorderRows(view, row, orderIds, idx) {
  const rows = orderIds.map((id) => view.app.getPage(id)).filter(Boolean);
  const pos = idx < 0 ? rows.length : idx;
  rows.splice(pos, 0, row);
  const base = Date.now();
  rows.forEach((r, i) => {
    const ord = base + i;
    if (r.order !== ord) {
      r.order = ord;
      view.app.touch(r);
    }
  });
  // manuelle Reihenfolge ist nur ohne Sortierung sichtbar
}

// Karten per Pointer ziehen (Board, Kalender) – funktioniert mit Maus, Finger und Stift
function attachCardDrag(el, view, row, onDrop, onClick) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, input, a')) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let ghost = null;
    let longPress = null;
    const pid = e.pointerId;
    const isTouch = e.pointerType === 'touch';
    const begin = () => {
      dragging = true;
      el.classList.add('drag-src');
      ghost = el.cloneNode(true);
      ghost.classList.add('card-ghost');
      ghost.style.width = el.offsetWidth + 'px';
      document.body.appendChild(ghost);
      document.body.classList.add('is-dragging');
      try {
        el.setPointerCapture(pid);
      } catch {
        /* ok */
      }
      if (navigator.vibrate) navigator.vibrate(8);
    };
    if (isTouch) longPress = setTimeout(begin, 320);
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
          if (isTouch) {
            clearTimeout(longPress);
            cleanup();
            return;
          }
          begin();
        } else return;
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - 20}px, ${ev.clientY - 16}px) rotate(2deg)`;
      document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const zone = under && under.closest('.board-col, .cal-day');
      if (zone) zone.classList.add('drop-target');
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      clearTimeout(longPress);
      const wasDragging = dragging;
      let under = null;
      if (dragging) {
        ghost.style.display = 'none';
        under = document.elementFromPoint(ev.clientX, ev.clientY);
      }
      cleanup();
      if (wasDragging) onDrop(under);
      else if (ev.type === 'pointerup' && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) onClick();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (ghost) ghost.remove();
      el.classList.remove('drag-src');
      document.body.classList.remove('is-dragging');
      document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
  // Touch: Scrollen während des Ziehens verhindern
  el.addEventListener('touchmove', (e) => {
    if (document.body.classList.contains('is-dragging')) e.preventDefault();
  }, { passive: false });
}

export function toastRowCreated(row) {
  toast('Eintrag erstellt: ' + pageTitle(row));
}
