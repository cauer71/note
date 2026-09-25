// Lernraum – App-Hülle: Zustand, Navigation, Seitenansicht, Speichern/Synchronisieren

import { h, svg, uid, clone, debounce, toast, isNarrow, isTouchUI, mod, storageGet, storageSet, relTime, normalizeSearch, todayISO, parseISODate, copyText, fmtDate } from './util.js';
import { I } from './icons.js';
import { Editor } from './editor.js';
import { newPage, newBlock, newDatabase, newRow, pageTitle, TEXT_TYPES, duplicateBlocks, fmtPropValue } from './model.js';
import { menu, popover, emojiPicker, confirmDialog, closeAllPopovers, modal } from './menus.js';
import { blocksToMarkdown, blocksToPlain, markdownToBlocks } from './markdown.js';
import { renderDatabasePage, renderRowProps } from './database.js';
import { updateTocs, renderMathIn } from './blocks.js';
import { redrawAllDrawings } from './drawing.js';
import { kvGet, kvSet, LocalStore } from './store.js';
import { buildSeed } from './seed.js';
import { AI } from './ai.js';
import { Toolbars } from './toolbar.js';
import { renderToday, renderLearn, renderTrash, openSearch, openSettings, openTemplates, movePagePicker } from './views.js';
import { collectAllCards, isDue } from './learn.js';
import { htmlToText } from './inline.js';

export const COVERS = {
  dusk: 'linear-gradient(135deg, #5856d6 0%, #af52de 55%, #ff2d55 100%)',
  ocean: 'linear-gradient(135deg, #0a84ff 0%, #30b0c7 60%, #34c759 100%)',
  sunrise: 'linear-gradient(135deg, #ff9500 0%, #ff2d55 100%)',
  mint: 'linear-gradient(135deg, #00c7be 0%, #34c759 100%)',
  graphite: 'linear-gradient(135deg, #3a3a3c 0%, #8e8e93 100%)',
  dolomiti: 'linear-gradient(180deg, #ffb199 0%, #ff0844 38%, #5856d6 100%)',
  paper: 'linear-gradient(135deg, #f2f2f7 0%, #d1d1d6 100%)',
  night: 'linear-gradient(160deg, #0b1026 0%, #2b2f77 60%, #5e5ce6 100%)',
};

export class App {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.pages = new Map();
    this.dirty = new Set();
    this.knownRemote = new Set();
    this.store = null;
    this.editor = null;
    this.currentId = null;
    this.view = 'page';
    this.tab = storageGet('lr:tab', 'notes');
    this.expanded = new Set(storageGet('lr:expanded', []));
    this.sidebarOpen = storageGet('lr:sidebar', true);
    this.syncState = 'idle';
    this.lastSync = 0;
    this.lastSaved = 0;
    this.saveTimer = null;
    this.retryDelay = 4000;
    this.ai = new AI(this);
    this.arrange = false;
    this.renderNav = debounce(() => this._renderNav(), 60);
    this.saveSoon = debounce(() => this.save(), 700);
    this.cacheSoon = debounce(() => this.writeCache(), 2000);
    this.metaSoon = debounce(() => this.updateMeta(), 400);
  }

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------
  mountShell() {
    this.root.innerHTML = '';
    this.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Navigation' });
    this.main = h('main', { class: 'main', 'aria-live': 'off' });
    this.navbar = h('header', { class: 'navbar' });
    this.scroll = h('div', { class: 'page-scroll' });
    this.content = h('div', { class: 'content' });
    this.scroll.appendChild(this.content);
    this.main.append(this.navbar, this.scroll);
    this.tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Bereiche' });
    this.banner = h('div', { class: 'banner', hidden: true });
    this.root.append(this.sidebar, this.main, this.tabbar, this.banner);
    this.toolbars = new Toolbars(this);
    this.applyLayoutClasses();
    this.content.appendChild(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', {}, 'Lernraum wird geladen …')));
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('resize', debounce(() => this.applyLayoutClasses(), 100));
    document.addEventListener('keydown', (e) => this.onGlobalKey(e), true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSave();
      else this.sync();
    });
    window.addEventListener('pagehide', () => this.flushSave());
    window.addEventListener('online', () => {
      this.retryDelay = 4000;
      this.save();
    });
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener && mq.addEventListener('change', () => redrawAllDrawings());
    new MutationObserver(() => redrawAllDrawings()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-app-theme'] });
  }

  applyLayoutClasses() {
    const narrow = isNarrow();
    document.body.classList.toggle('is-narrow', narrow);
    document.body.classList.toggle('is-touch', isTouchUI());
    document.body.classList.toggle('sidebar-closed', !narrow && !this.sidebarOpen);
    this.renderNavbar && this.navbar && this.renderNavbar();
    this.renderTabbar && this.tabbar && this.renderTabbar();
  }

  async start(stores) {
    this.mountShell();
    await this.connect(stores);
    this.ai.init().then(() => this.onAIChanged());
    this.route();
  }

  async connect(stores) {
    const errors = [];
    for (const make of stores) {
      let store;
      try {
        store = await make();
        if (!store) continue;
        this.setSync('syncing');
        // Schnellstart aus Cache
        const cacheKey = 'cache:' + (store.cacheKey || store.kind);
        const cached = await kvGet(cacheKey);
        if (cached && cached.pages && !this.pages.size) {
          for (const p of cached.pages) this.pages.set(p.id, p);
          this.knownRemote = new Set(cached.known || []);
          this.lastSync = cached.lastSync || 0;
          (cached.dirty || []).forEach((id) => this.dirty.add(id));
          this.store = store;
          this.cacheKey = cacheKey;
          this._renderNav();
          this.route();
        }
        await store.init();
        this.store = store;
        this.cacheKey = cacheKey;
        await this.sync(true);
        if (!this.pages.size && store.kind === 'local') this.seed();
        else if (!this.pages.size && !storageGet('lr:seeded:' + cacheKey, false)) this.seed();
        storageSet('lr:seeded:' + cacheKey, true);
        this.setSync('saved');
        this.showBanner(store.bannerText || null);
        if (this.dirty.size) this.save();
        return;
      } catch (err) {
        errors.push(err);
        if (this.pages.size && store && this.store === store) {
          // Offline mit Cache
          this.setSync('offline');
          this.showBanner(offlineText(err), { retry: true });
          return;
        }
        this.store = null;
        this.pages.clear();
      }
    }
    // Letzter Ausweg: lokal
    const local = new LocalStore('fallback');
    await local.init();
    this.store = local;
    this.cacheKey = 'cache:fallback';
    await this.sync(true);
    if (!this.pages.size) this.seed();
    this.setSync('saved');
    this.showBanner('Nur in diesem Browser gespeichert. ' + (errors.length ? offlineText(errors[errors.length - 1]) : ''), { retry: errors.length > 0 });
  }

  showBanner(text, opts = {}) {
    const b = this.banner;
    if (!text) {
      b.hidden = true;
      return;
    }
    b.innerHTML = '';
    b.append(svg(I.cloudOff), h('span', {}, text));
    if (opts.retry) b.appendChild(h('button', { class: 'btn btn-sm btn-tinted', type: 'button', onclick: () => location.reload() }, 'Neu laden'));
    b.appendChild(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ausblenden', onclick: () => (b.hidden = true) }, svg(I.close)));
    b.hidden = false;
  }

  seed() {
    const pages = buildSeed();
    for (const p of pages) {
      this.pages.set(p.id, p);
      this.dirty.add(p.id);
    }
    this.saveSoon();
    this._renderNav();
  }

  restoreSeed() {
    const pages = buildSeed();
    let n = 0;
    for (const p of pages) {
      if (this.pages.has(p.id)) continue;
      this.pages.set(p.id, p);
      this.dirty.add(p.id);
      n++;
    }
    this.saveSoon();
    this._renderNav();
    toast(n ? `${n} Testseiten wiederhergestellt` : 'Alle Testseiten sind schon vorhanden');
  }

  // ---------------------------------------------------------------------
  // Speichern & Synchronisieren
  // ---------------------------------------------------------------------
  touch(page, opts = {}) {
    if (!page) return;
    page.updatedAt = Date.now();
    this.dirty.add(page.id);
    this.setSync('pending');
    this.saveSoon();
    if (!opts.silent) {
      this.renderNav();
      if (page.id === this.currentId) this.metaSoon();
    }
    if (this.editor && page === this.editor.page) this.tocSoon();
  }

  tocSoon() {
    clearTimeout(this._toc);
    this._toc = setTimeout(() => this.editor && updateTocs(this.editor), 300);
  }

  flushSave() {
    this.saveSoon.cancel();
    if (this.dirty.size) this.save();
  }

  async save() {
    if (!this.store || this.saving) {
      if (this.saving) this.saveAgain = true;
      return;
    }
    const ids = [...this.dirty];
    if (!ids.length) return;
    this.saving = true;
    this.setSync('syncing');
    const pages = ids.map((id) => this.pages.get(id)).filter(Boolean);
    const deleted = ids.filter((id) => !this.pages.has(id));
    ids.forEach((id) => this.dirty.delete(id));
    try {
      if (pages.length) await this.store.savePages(pages.map(stripTransient));
      if (deleted.length) await this.store.deletePages(deleted);
      pages.forEach((p) => this.knownRemote.add(p.id));
      deleted.forEach((id) => this.knownRemote.delete(id));
      this.lastSaved = Date.now();
      this.retryDelay = 4000;
      this.setSync(this.dirty.size ? 'pending' : 'saved');
      this.cacheSoon();
    } catch (err) {
      ids.forEach((id) => this.dirty.add(id));
      this.setSync('offline', err);
      this.cacheSoon();
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.save(), this.retryDelay);
      this.retryDelay = Math.min(120000, this.retryDelay * 2);
    } finally {
      this.saving = false;
      if (this.saveAgain) {
        this.saveAgain = false;
        this.saveSoon();
      }
    }
  }

  async writeCache() {
    if (!this.cacheKey) return;
    await kvSet(this.cacheKey, {
      pages: [...this.pages.values()].map(stripTransient),
      known: [...this.knownRemote],
      dirty: [...this.dirty],
      lastSync: this.lastSync,
    });
  }

  async sync(initial = false) {
    if (!this.store || this.syncing) return;
    if (!initial && Date.now() - (this.lastSyncAt || 0) < 8000) return;
    this.syncing = true;
    try {
      const since = initial && !this.pages.size ? 0 : Math.max(0, this.lastSync - 5 * 60000);
      const rows = await this.store.loadAll(since);
      this.lastSyncAt = Date.now();
      let changed = false;
      const remoteIds = new Set();
      let maxTs = this.lastSync;
      for (const row of rows) {
        remoteIds.add(row.id);
        maxTs = Math.max(maxTs, row.updatedAt || 0);
        if (!row.data) continue;
        let p;
        try {
          p = JSON.parse(row.data);
        } catch {
          continue;
        }
        const local = this.pages.get(row.id);
        if (!local || (!this.dirty.has(row.id) && (p.updatedAt || row.updatedAt) > (local.updatedAt || 0))) {
          this.pages.set(row.id, p);
          changed = true;
          if (row.id === this.currentId) this.remoteChangedCurrent = true;
        }
      }
      // anderswo gelöschte Seiten entfernen
      for (const id of [...this.pages.keys()]) {
        if (!remoteIds.has(id) && this.knownRemote.has(id) && !this.dirty.has(id)) {
          this.pages.delete(id);
          changed = true;
        }
      }
      this.knownRemote = remoteIds;
      this.lastSync = maxTs;
      if (changed) {
        this._renderNav();
        if (this.remoteChangedCurrent && !(this.editor && this.editor.root.contains(document.activeElement))) {
          this.remoteChangedCurrent = false;
          this.route(true);
        } else if (!this.currentId || this.view !== 'page') this.route(true);
        this.cacheSoon();
      }
      if (!this.dirty.size) this.setSync('saved');
    } catch (err) {
      if (initial) throw err;
      this.setSync('offline', err);
    } finally {
      this.syncing = false;
    }
  }

  setSync(state, err) {
    this.syncState = state;
    this.syncError = err;
    const el = document.querySelector('.sync-pill');
    if (el) this.paintSync(el);
    const sb = document.querySelector('.sidebar-sync');
    if (sb) this.paintSync(sb, true);
  }

  paintSync(el, long) {
    const map = {
      idle: ['', ''],
      pending: ['pending', 'Nicht gespeichert'],
      syncing: ['syncing', 'Speichert …'],
      saved: ['saved', long ? 'Gespeichert in ' + (this.store ? this.store.label : '') : 'Gespeichert'],
      offline: ['offline', 'Offline – wird später gespeichert'],
    };
    const [cls, text] = map[this.syncState] || map.idle;
    el.className = (el.classList.contains('sidebar-sync') ? 'sidebar-sync' : 'sync-pill') + ' ' + cls;
    el.title = text + (this.syncError ? ' (' + (this.syncError.message || this.syncError) + ')' : '');
    el.setAttribute('aria-label', text);
    if (long) el.textContent = text;
  }

  // ---------------------------------------------------------------------
  // Seiten-Operationen
  // ---------------------------------------------------------------------
  getPage(id) {
    return this.pages.get(id) || null;
  }

  currentPage() {
    return this.view === 'page' ? this.getPage(this.currentId) : null;
  }

  allPages() {
    return [...this.pages.values()].filter((p) => !p.trashed && !this.isTrashedDeep(p));
  }

  isTrashedDeep(p) {
    let cur = p;
    let guard = 0;
    while (cur && guard++ < 50) {
      if (cur.trashed) return true;
      cur = cur.parentId ? this.pages.get(cur.parentId) : null;
    }
    return false;
  }

  childrenOf(id) {
    return [...this.pages.values()].filter((p) => p.parentId === id && !p.isRow && !p.trashed).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  rowsOf(dbId) {
    return [...this.pages.values()].filter((p) => p.parentId === dbId && p.isRow && !p.trashed);
  }

  ancestors(p) {
    const out = [];
    let cur = p && p.parentId ? this.pages.get(p.parentId) : null;
    let guard = 0;
    while (cur && guard++ < 50) {
      out.unshift(cur);
      cur = cur.parentId ? this.pages.get(cur.parentId) : null;
    }
    return out;
  }

  pathLabel(p) {
    const a = this.ancestors(p);
    return a.length ? a.map(pageTitle).join(' / ') : 'Lernraum';
  }

  createPage(extra = {}, opts = {}) {
    const siblings = this.childrenOf(extra.parentId || null);
    const p = newPage(Object.assign({ order: siblings.length ? Math.max(...siblings.map((s) => s.order || 0)) + 1 : Date.now() }, extra));
    this.pages.set(p.id, p);
    this.touch(p);
    // Unterseite als Block im Elternteil verlinken
    const parent = p.parentId && this.getPage(p.parentId);
    if (parent && parent.kind === 'page' && !opts.noLink && !(parent.blocks || []).some((b) => b.pageId === p.id)) {
      if (opts.fromEditor !== true && !(this.editor && this.editor.page === parent && opts.navigate === false)) {
        const blocks = parent.blocks || (parent.blocks = []);
        const last = blocks[blocks.length - 1];
        const nb = newBlock('page', { pageId: p.id });
        if (last && last.type === 'p' && !htmlToText(last.text).trim()) blocks.splice(blocks.length - 1, 0, nb);
        else blocks.push(nb);
        this.touch(parent);
        if (this.editor && this.editor.page === parent) this.editor.render();
      }
    }
    if (parent) {
      this.expanded.add(parent.id);
      storageSet('lr:expanded', [...this.expanded]);
    }
    if (opts.navigate !== false) this.navigate(p.id, { focusTitle: true });
    return p;
  }

  createDatabase(extra = {}, opts = {}) {
    const db = newDatabase(Object.assign({ order: Date.now() }, extra));
    this.pages.set(db.id, db);
    this.touch(db);
    if (opts.navigate !== false) this.navigate(db.id, { focusTitle: true });
    return db;
  }

  createRow(db, props = {}) {
    const rows = this.rowsOf(db.id);
    const row = newRow(db, props, { order: rows.length ? Math.max(...rows.map((r) => r.order || 0)) + 1 : Date.now() });
    this.pages.set(row.id, row);
    this.touch(row);
    this.touch(db, { silent: true });
    return row;
  }

  openRow(row, db) {
    void db;
    this.navigate(row.id, { focusTitle: !row.title });
  }

  rowPropsText(row, db) {
    return (db.db.properties || [])
      .map((p) => {
        const v = fmtPropValue(p, row.props ? row.props[p.id] : null);
        return v ? `**${p.name}:** ${v}` : null;
      })
      .filter(Boolean)
      .join(' · ');
  }

  addPageFromTemplate(tpl, parentId = null) {
    const res = tpl.build(this);
    const page = res.page || res;
    page.parentId = parentId;
    page.order = Date.now();
    this.pages.set(page.id, page);
    this.touch(page);
    for (const x of res.extra || []) {
      this.pages.set(x.id, x);
      this.touch(x, { silent: true });
    }
    const parent = parentId && this.getPage(parentId);
    if (parent && parent.kind === 'page') {
      parent.blocks.push(newBlock(page.kind === 'database' ? 'page' : 'page', { pageId: page.id }));
      this.touch(parent);
    }
    this.navigate(page.id, { focusTitle: true });
    return page;
  }

  duplicatePage(id, parentId) {
    const src = this.getPage(id);
    if (!src) return null;
    const idMap = new Map();
    const copyTree = (p, newParent) => {
      const c = clone(p);
      c.id = uid('p');
      idMap.set(p.id, c.id);
      c.parentId = newParent;
      c.title = p === src ? (p.title || '') + (p.isRow ? '' : ' (Kopie)') : p.title;
      c.favorite = false;
      c.createdAt = c.updatedAt = Date.now();
      c.order = (p.order || 0) + 0.5;
      c.blocks = duplicateBlocks(p.blocks || []);
      this.pages.set(c.id, c);
      this.touch(c, { silent: true });
      for (const child of [...this.pages.values()].filter((x) => x.parentId === p.id && !x.trashed)) copyTree(child, c.id);
      return c;
    };
    const copy = copyTree(src, parentId !== undefined ? parentId : src.parentId);
    // Verweise innerhalb der Kopie umbiegen
    for (const newId of idMap.values()) {
      const p = this.pages.get(newId);
      for (const b of p.blocks || []) if (b.pageId && idMap.has(b.pageId)) b.pageId = idMap.get(b.pageId);
    }
    this._renderNav();
    return copy;
  }

  trashPage(id, opts = {}) {
    const p = this.getPage(id);
    if (!p) return;
    p.trashed = Date.now();
    p.favorite = false;
    this.touch(p);
    if (!opts.silent) {
      toast(`„${pageTitle(p)}“ in den Papierkorb verschoben`, { action: { label: 'Rückgängig', run: () => this.restorePage(id) } });
    }
    if (this.currentId === id || (this.currentId && this.ancestors(this.getPage(this.currentId) || {}).some((a) => a.id === id))) {
      const parent = p.parentId && this.getPage(p.parentId);
      if (parent && !parent.trashed) this.navigate(parent.id);
      else this.goHome();
    }
    this._renderNav();
  }

  restorePage(id) {
    const p = this.getPage(id);
    if (!p) return;
    p.trashed = 0;
    if (p.parentId) {
      const parent = this.getPage(p.parentId);
      if (!parent || this.isTrashedDeep(parent)) p.parentId = null;
    }
    this.touch(p);
    this._renderNav();
    if (this.view === 'trash') this.route(true);
    toast(`„${pageTitle(p)}“ wiederhergestellt`);
  }

  deleteForever(id) {
    const ids = [];
    const collect = (pid) => {
      ids.push(pid);
      for (const c of [...this.pages.values()].filter((x) => x.parentId === pid)) collect(c.id);
    };
    collect(id);
    for (const x of ids) {
      this.pages.delete(x);
      this.dirty.add(x);
    }
    this.saveSoon();
    this._renderNav();
  }

  movePage(id, newParentId, beforeId = null) {
    const p = this.getPage(id);
    if (!p || id === newParentId) return;
    if (newParentId && (this.ancestors(this.getPage(newParentId)).some((a) => a.id === id) || newParentId === id)) {
      toast('Eine Seite kann nicht in sich selbst verschoben werden');
      return;
    }
    const oldParent = p.parentId && this.getPage(p.parentId);
    if (oldParent && oldParent.kind === 'page' && p.parentId !== newParentId) {
      const idx = (oldParent.blocks || []).findIndex((b) => b.type === 'page' && b.pageId === id);
      if (idx >= 0) {
        oldParent.blocks.splice(idx, 1);
        if (!oldParent.blocks.length) oldParent.blocks.push(newBlock('p'));
        this.touch(oldParent);
      }
    }
    const siblings = this.childrenOf(newParentId || null).filter((x) => x.id !== id);
    let order;
    if (beforeId) {
      const i = siblings.findIndex((x) => x.id === beforeId);
      const prev = siblings[i - 1];
      const next = siblings[i];
      order = prev ? ((prev.order || 0) + (next.order || 0)) / 2 : (next.order || 0) - 1;
    } else order = siblings.length ? Math.max(...siblings.map((s) => s.order || 0)) + 1 : Date.now();
    const parentChanged = p.parentId !== newParentId;
    p.parentId = newParentId || null;
    p.order = order;
    this.touch(p);
    const newParent = newParentId && this.getPage(newParentId);
    if (parentChanged && newParent && newParent.kind === 'page' && !(newParent.blocks || []).some((b) => b.pageId === id)) {
      newParent.blocks.push(newBlock('page', { pageId: id }));
      this.touch(newParent);
      this.expanded.add(newParent.id);
    }
    if (this.editor && (this.editor.page === oldParent || this.editor.page === newParent)) this.editor.render();
    this._renderNav();
  }

  toggleFavorite(p) {
    p.favorite = !p.favorite;
    this.touch(p);
    this._renderNav();
    this.renderNavbar();
    toast(p.favorite ? 'Zu Favoriten hinzugefügt' : 'Aus Favoriten entfernt');
  }

  searchTitles(q, limit = 10) {
    const nq = normalizeSearch(q);
    const all = this.allPages().filter((p) => !p.isRow || nq);
    const scored = all
      .map((p) => {
        const t = normalizeSearch(pageTitle(p));
        let s = 99;
        if (!nq) s = -(p.updatedAt || 0) / 1e13;
        else if (t.startsWith(nq)) s = 0;
        else if (t.split(/\s+/).some((w) => w.startsWith(nq))) s = 1;
        else if (t.includes(nq)) s = 2;
        return { p, s };
      })
      .filter((x) => x.s < 99)
      .sort((a, b) => a.s - b.s || (b.p.updatedAt || 0) - (a.p.updatedAt || 0));
    return scored.slice(0, limit).map((x) => x.p);
  }

  searchPages(q, limit = 30) {
    const nq = normalizeSearch(q).trim();
    if (!nq) return this.allPages().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map((page) => ({ page, snippet: '' }));
    const terms = nq.split(/\s+/);
    const out = [];
    for (const p of this.allPages()) {
      const title = normalizeSearch(pageTitle(p));
      const bodyRaw = blocksToPlain(p.blocks) + (p.isRow ? ' ' + this.rowPropsText(p, this.getPage(p.parentId) || { db: { properties: [] } }) : '');
      const body = normalizeSearch(bodyRaw);
      if (!terms.every((t) => title.includes(t) || body.includes(t))) continue;
      let score = terms.reduce((s, t) => s + (title.includes(t) ? 10 : 0) + (title.startsWith(t) ? 5 : 0), 0);
      let snippet = '';
      const idx = body.indexOf(terms[0]);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        snippet = (start > 0 ? '… ' : '') + bodyRaw.slice(start, idx + 100).replace(/\s+/g, ' ') + '…';
        score += 1;
      }
      out.push({ page: p, snippet, score });
    }
    return out.sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt).slice(0, limit);
  }

  // Termine aus allen Datenbanken mit Datumseigenschaft
  upcoming(days = 14, includePast = 7) {
    const out = [];
    const today = parseISODate(todayISO());
    for (const db of this.allPages().filter((p) => p.kind === 'database')) {
      const dateProp = (db.db.properties || []).find((p) => p.type === 'date');
      if (!dateProp) continue;
      const statusProp = (db.db.properties || []).find((p) => p.type === 'select' && /status/i.test(p.name));
      const checkProp = (db.db.properties || []).find((p) => p.type === 'checkbox');
      for (const r of this.rowsOf(db.id)) {
        const v = r.props && r.props[dateProp.id];
        if (!v) continue;
        const diff = Math.round((parseISODate(v) - today) / 86400000);
        if (diff > days || diff < -includePast) continue;
        const st = statusProp && (statusProp.options || []).find((o) => o.id === r.props[statusProp.id]);
        const done = (st && /erledigt|fertig|done|gelesen/i.test(st.name)) || false;
        if (done && diff < 0) continue;
        out.push({ row: r, db, date: v, diff, status: st ? st.name : '', statusColor: st ? st.color : '', done, dateProp, statusProp, checkProp });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  dueCardsCount() {
    return collectAllCards(this).filter((x) => isDue(x.card)).length;
  }

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------
  navigate(id, opts = {}) {
    this.pendingFocusTitle = !!opts.focusTitle;
    closeAllPopovers();
    if (location.hash === '#' + id) this.route(true);
    else location.hash = id;
  }

  goView(v) {
    closeAllPopovers();
    if (location.hash === '#' + v) this.route(true);
    else location.hash = v;
  }

  goHome() {
    if (isNarrow()) this.goView(this.tab === 'notes' ? 'notizen' : this.tab === 'today' ? 'heute' : 'lernen');
    else {
      const start = this.getPage('seed-start');
      const recent = this.allPages().filter((p) => !p.isRow).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.goView('heute');
      void start;
      void recent;
    }
  }

  route(force) {
    const hash = decodeURIComponent(location.hash.slice(1));
    const views = { heute: 'today', lernen: 'learn', papierkorb: 'trash', notizen: 'notes' };
    let view = 'page';
    let id = null;
    if (!hash) {
      const last = storageGet('lr:last', null);
      if (isNarrow()) view = 'notes';
      else if (last && this.pages.has(last) && !this.isTrashedDeep(this.pages.get(last))) id = last;
      else view = 'today';
    } else if (views[hash]) view = views[hash];
    else id = hash;

    if (view === 'page' && (!id || !this.pages.has(id))) {
      if (!this.pages.size) return;
      view = isNarrow() ? 'notes' : 'today';
      id = null;
    }
    if (!force && view === this.view && id === this.currentId && this.content.dataset.rendered === '1') return;
    this.leavePage();
    this.view = view;
    this.currentId = id;
    if (view === 'today' || view === 'learn' || view === 'notes') {
      this.tab = view === 'today' ? 'today' : view === 'learn' ? 'learn' : 'notes';
      storageSet('lr:tab', this.tab);
    }
    document.body.dataset.view = view;
    this.content.innerHTML = '';
    this.content.dataset.rendered = '1';
    this.scroll.scrollTop = 0;
    if (view === 'page') {
      storageSet('lr:last', id);
      this.renderPage(this.getPage(id));
    } else if (view === 'today') renderToday(this, this.content);
    else if (view === 'learn') renderLearn(this, this.content);
    else if (view === 'trash') renderTrash(this, this.content);
    else if (view === 'notes') this.renderNotesHome();
    this.renderNavbar();
    this.renderTabbar();
    this._renderNav();
    this.toolbars.update();
    if (isNarrow() && this.sidebarOverlay) this.closeSidebarOverlay();
  }

  leavePage() {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    this.dbview = null;
    this.flushSave();
  }

  // ---------------------------------------------------------------------
  // Seite rendern
  // ---------------------------------------------------------------------
  renderPage(p) {
    const wrap = h('article', { class: 'page font-' + (p.font || 'sans') + (p.fullWidth || p.kind === 'database' ? ' full-width' : '') + (p.kind === 'database' ? ' is-db' : ''), 'data-page': p.id });
    // Titelbild
    if (p.cover) {
      const cover = h('div', { class: 'cover' });
      if (p.cover.type === 'image') cover.style.backgroundImage = `url("${p.cover.value}")`;
      else cover.style.background = COVERS[p.cover.value] || COVERS.dusk;
      cover.appendChild(
        h('div', { class: 'cover-actions' }, h('button', { class: 'glass-chip', type: 'button', onclick: (e) => this.coverMenu(e.currentTarget, p) }, 'Titelbild ändern'))
      );
      wrap.appendChild(cover);
    }
    const head = h('div', { class: 'page-head' + (p.cover ? ' has-cover' : '') + (p.icon ? ' has-icon' : '') });
    if (p.icon) {
      head.appendChild(h('button', { class: 'page-icon', type: 'button', 'aria-label': 'Symbol ändern', onclick: (e) => this.iconPicker(e.currentTarget, p) }, p.icon));
    }
    const addRow = h('div', { class: 'page-head-add' });
    if (!p.icon) addRow.appendChild(h('button', { class: 'ghost-btn', type: 'button', onclick: (e) => this.iconPicker(e.currentTarget, p) }, '☺︎ Symbol'));
    if (!p.cover) addRow.appendChild(h('button', { class: 'ghost-btn', type: 'button', onclick: (e) => this.coverMenu(e.currentTarget, p) }, svg(I.image), ' Titelbild'));
    head.appendChild(addRow);
    const title = h('h1', { class: 'page-title', contenteditable: 'true', spellcheck: 'true', 'data-ph': p.kind === 'database' ? 'Unbenannte Datenbank' : 'Ohne Titel', role: 'textbox', 'aria-label': 'Seitentitel' });
    title.textContent = p.title || '';
    title.addEventListener('input', () => {
      if (this.editor) this.editor.history.typing();
      p.title = title.textContent.replace(/\n/g, ' ');
      if (!p.title && title.innerHTML) title.innerHTML = '';
      this.touch(p);
      this.renderNavbar();
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.editor) {
          const first = this.editor.blocks[0];
          if (first && TEXT_TYPES.has(first.type) && !htmlToText(first.text).trim()) this.editor.focusBlock(first.id, 0);
          else this.editor.insertAt(0, newBlock('p'));
        } else title.blur();
      } else if (e.key === 'ArrowDown' && this.editor) {
        e.preventDefault();
        this.editor.focusFirst();
      }
    });
    title.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\n+/g, ' '));
    });
    head.appendChild(title);
    this.titleEl = title;
    this.metaEl = h('div', { class: 'page-meta' });
    head.appendChild(this.metaEl);
    wrap.appendChild(head);

    if (p.isRow) {
      const db = this.getPage(p.parentId);
      if (db && db.db) {
        wrap.appendChild(
          h('button', { class: 'row-db-link', type: 'button', onclick: () => this.navigate(db.id) }, db.icon ? h('span', { class: 'emoji' }, db.icon) : svg(I.database), ' ', pageTitle(db))
        );
        wrap.appendChild(renderRowProps(this, p, db));
      }
    }

    if (p.kind === 'database') {
      const view = renderDatabasePage(this, p);
      this.dbview = view;
      wrap.appendChild(view.el);
    } else {
      const blocksEl = h('div', { class: 'editor-blocks', role: 'document' });
      wrap.appendChild(blocksEl);
      const tail = h('div', { class: 'page-tail', 'aria-hidden': 'true' });
      tail.addEventListener('click', () => this.clickTail());
      wrap.appendChild(tail);
      const back = this.backlinks(p);
      if (back) wrap.appendChild(back);
      this.content.appendChild(wrap);
      if (!p.blocks || !p.blocks.length) p.blocks = [newBlock('p')];
      this.editor = new Editor(this, p, blocksEl);
      this.editor.render();
      wrap.classList.toggle('arrange', this.arrange);
    }
    if (!wrap.isConnected) this.content.appendChild(wrap);
    this.updateMeta();
    if (this.pendingFocusTitle) {
      this.pendingFocusTitle = false;
      setTimeout(() => this.focusTitle(), 30);
    }
  }

  focusTitle(atEnd) {
    const t = this.titleEl;
    if (!t) return;
    t.focus();
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(t);
    r.collapse(!atEnd ? false : false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  onTitleRestored(p) {
    if (this.titleEl && p.id === this.currentId) this.titleEl.textContent = p.title || '';
    this.renderNavbar();
  }

  clickTail() {
    const ed = this.editor;
    if (!ed) return;
    const last = ed.blocks[ed.blocks.length - 1];
    if (last && last.type === 'p' && !htmlToText(last.text).trim()) ed.focusBlock(last.id, 0);
    else ed.insertAfter(last ? last.id : null, newBlock('p'));
  }

  backlinks(p) {
    const refs = this.allPages().filter((x) => x.id !== p.id && (x.blocks || []).some((b) => (b.text || '').includes(`data-page="${p.id}"`)));
    if (!refs.length) return null;
    return h(
      'div',
      { class: 'backlinks' },
      h('div', { class: 'section-label' }, 'Verlinkt von'),
      h('div', { class: 'ios-list' }, refs.map((r) => h('button', { class: 'ios-row', type: 'button', onclick: () => this.navigate(r.id) }, h('span', { class: 'ios-row-ico' }, r.icon ? h('span', { class: 'emoji' }, r.icon) : svg(I.pageText)), h('span', { class: 'ios-row-title' }, pageTitle(r)), svg(I.chevronRight, 'ios-chev'))))
    );
  }

  updateMeta() {
    const p = this.currentPage();
    if (!p || !this.metaEl) return;
    const words = blocksToPlain(p.blocks || []).split(/\s+/).filter(Boolean).length;
    this.metaEl.innerHTML = '';
    const crumbs = this.ancestors(p);
    if (crumbs.length && !isNarrow()) {
      /* Breadcrumbs stehen in der Navigationsleiste */
    }
    this.metaEl.appendChild(h('span', {}, 'Bearbeitet ' + relTime(p.updatedAt || Date.now())));
    if (p.kind !== 'database') this.metaEl.appendChild(h('span', {}, `${words} ${words === 1 ? 'Wort' : 'Wörter'}`));
    else this.metaEl.appendChild(h('span', {}, `${this.rowsOf(p.id).length} Einträge`));
  }

  iconPicker(anchor, p) {
    emojiPicker(
      anchor,
      (e) => {
        p.icon = e;
        this.touch(p);
        this.route(true);
      },
      { allowRemove: !!p.icon }
    );
  }

  coverMenu(anchor, p) {
    const items = Object.keys(COVERS).map((k) => ({
      label: { dusk: 'Abendrot', ocean: 'Ozean', sunrise: 'Sonnenaufgang', mint: 'Minze', graphite: 'Graphit', dolomiti: 'Dolomiten', paper: 'Papier', night: 'Nacht' }[k],
      swatch: 'cover-' + k,
      checked: p.cover && p.cover.value === k,
      onSelect: () => {
        p.cover = { type: 'gradient', value: k };
        this.touch(p);
        this.route(true);
      },
    }));
    items.push({ divider: true });
    items.push({
      label: 'Foto hochladen …',
      icon: I.image,
      onSelect: () => {
        const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
        input.addEventListener('change', async () => {
          const f = input.files && input.files[0];
          input.remove();
          if (!f) return;
          const { compressImage } = await import('./util.js');
          const img = await compressImage(f, 1600, 0.78);
          p.cover = { type: 'image', value: img.dataUrl };
          this.touch(p);
          this.route(true);
        });
        document.body.appendChild(input);
        input.click();
      },
    });
    if (p.cover) items.push({ label: 'Titelbild entfernen', icon: I.trash, danger: true, onSelect: () => { p.cover = null; this.touch(p); this.route(true); } });
    menu(anchor, items, { title: 'Titelbild' });
  }

  pageMenu(anchor, p) {
    const words = blocksToPlain(p.blocks || []).split(/\s+/).filter(Boolean).length;
    const md = () => blocksToMarkdown(p.blocks || [], { pageTitle: (id) => pageTitle(this.getPage(id)) });
    const fullMd = () => `# ${pageTitle(p)}\n\n` + (p.isRow ? this.rowPropsText(p, this.getPage(p.parentId)) + '\n\n' : '') + md();
    const items = [
      { label: p.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: p.favorite ? I.starFill : I.star, onSelect: () => this.toggleFavorite(p) },
      { label: 'Volle Breite', icon: I.expand, checked: !!p.fullWidth, disabled: p.kind === 'database', onSelect: () => { p.fullWidth = !p.fullWidth; this.touch(p); this.route(true); } },
      {
        label: 'Schriftart',
        icon: I.type,
        submenu: [
          ['sans', 'Standard (SF Pro)'],
          ['serif', 'Serif (New York)'],
          ['mono', 'Mono (SF Mono)'],
        ].map(([f, l]) => ({ label: l, checked: (p.font || 'sans') === f, onSelect: () => { p.font = f; this.touch(p); this.route(true); } })),
      },
      isTouchUI() && p.kind !== 'database' ? { label: this.arrange ? 'Anordnen beenden' : 'Blöcke anordnen', icon: I.grip, onSelect: () => this.toggleArrange() } : null,
      { divider: true },
      { label: 'Verschieben nach …', icon: I.move, disabled: p.isRow, onSelect: () => movePagePicker(this, p) },
      { label: 'Duplizieren', icon: I.duplicate, onSelect: () => { const c = this.duplicatePage(p.id); if (c) this.navigate(c.id); } },
      { label: 'Markdown kopieren', icon: I.copy, onSelect: () => { copyText(fullMd()); toast('Als Markdown kopiert'); } },
      { label: 'Als Markdown exportieren', icon: I.download, onSelect: () => this.download(`${safeName(pageTitle(p))}.md`, fullMd()) },
      { divider: true },
      { label: 'In den Papierkorb', icon: I.trash, danger: true, onSelect: () => this.trashPage(p.id) },
      { divider: true },
      { label: `${words} Wörter · bearbeitet ${relTime(p.updatedAt)}`, disabled: true },
      { label: 'Erstellt am ' + fmtDate(p.createdAt || Date.now()), disabled: true },
    ].filter(Boolean);
    menu(anchor, items, { title: pageTitle(p), alignRight: true });
  }

  toggleArrange() {
    this.arrange = !this.arrange;
    const page = this.content.querySelector('.page');
    if (page) page.classList.toggle('arrange', this.arrange);
    toast(this.arrange ? 'Ziehe die Griffe links, um Blöcke zu verschieben' : 'Anordnen beendet');
    this.renderNavbar();
  }

  async download(filename, data) {
    try {
      if (window.claude && window.claude.use) {
        const dl = await Promise.race([window.claude.use('downloads'), new Promise((r) => setTimeout(() => r(null), 1500))]);
        if (dl) {
          await dl.save({ filename, data });
          toast('Gespeichert');
          return;
        }
      }
    } catch (e) {
      if (e && e.code === 'declined') return;
    }
    try {
      const blob = new Blob([data], { type: filename.endsWith('.json') ? 'application/json' : 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      copyText(data);
      toast('Download nicht möglich – Inhalt in die Zwischenablage kopiert');
    }
  }

  // ---------------------------------------------------------------------
  // Navigationsleiste (oben)
  // ---------------------------------------------------------------------
  renderNavbar() {
    const nb = this.navbar;
    if (!nb) return;
    nb.innerHTML = '';
    const narrow = isNarrow();
    const p = this.currentPage();
    const left = h('div', { class: 'nav-left' });
    const right = h('div', { class: 'nav-right' });
    const center = h('div', { class: 'nav-center' });
    if (narrow) {
      if (this.view === 'page') {
        const parent = p && p.parentId && this.getPage(p.parentId);
        left.appendChild(
          h(
            'button',
            { class: 'glass-btn nav-back', type: 'button', 'aria-label': parent ? 'Zurück zu ' + pageTitle(parent) : 'Zurück', onclick: () => (parent && !parent.trashed ? this.navigate(parent.id) : this.goHome()) },
            svg(I.chevronLeft)
          )
        );
        center.appendChild(h('div', { class: 'nav-title' }, p ? pageTitle(p) : ''));
      } else if (this.view === 'trash') {
        left.appendChild(h('button', { class: 'glass-btn nav-back', type: 'button', 'aria-label': 'Zurück', onclick: () => this.goView('notizen') }, svg(I.chevronLeft)));
        center.appendChild(h('div', { class: 'nav-title' }, 'Papierkorb'));
      } else {
        center.appendChild(h('div', { class: 'nav-title' }, { today: 'Heute', learn: 'Lernen', notes: 'Notizen' }[this.view] || ''));
      }
    } else {
      left.appendChild(
        h('button', { class: 'glass-btn', type: 'button', 'aria-label': this.sidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden', title: 'Seitenleiste (' + (navigator.platform.includes('Mac') ? '⌘' : 'Strg+') + '\\)', onclick: () => this.toggleSidebar() }, svg(I.sidebar))
      );
      if (p) {
        const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Pfad' });
        const chain = [...this.ancestors(p), p];
        chain.forEach((c, i) => {
          if (i) crumbs.appendChild(h('span', { class: 'crumb-sep' }, '/'));
          crumbs.appendChild(h('button', { class: 'crumb' + (i === chain.length - 1 ? ' current' : ''), type: 'button', onclick: () => this.navigate(c.id) }, c.icon ? h('span', { class: 'emoji' }, c.icon + ' ') : null, pageTitle(c)));
        });
        left.appendChild(h('div', { class: 'glass-capsule crumbs-wrap' }, crumbs));
      }
    }
    if (p) {
      right.appendChild(h('span', { class: 'sync-pill', role: 'status' }));
      const group = h('div', { class: 'glass-capsule' });
      if (this.arrange && isTouchUI()) group.appendChild(h('button', { class: 'cap-btn cap-text', type: 'button', onclick: () => this.toggleArrange() }, 'Fertig'));
      group.appendChild(h('button', { class: 'cap-btn' + (p.favorite ? ' on-star' : ''), type: 'button', 'aria-label': p.favorite ? 'Favorit entfernen' : 'Als Favorit markieren', 'aria-pressed': p.favorite ? 'true' : 'false', onclick: () => this.toggleFavorite(p) }, svg(p.favorite ? I.starFill : I.star)));
      group.appendChild(h('button', { class: 'cap-btn cap-ai', type: 'button', 'aria-label': 'Claude fragen', title: 'Claude (' + (navigator.platform.includes('Mac') ? '⌘' : 'Strg+') + 'J)', onclick: () => this.ai.openPanel() }, svg(I.sparkle)));
      group.appendChild(h('button', { class: 'cap-btn', type: 'button', 'aria-label': 'Seitenmenü', onclick: (e) => this.pageMenu(e.currentTarget, p) }, svg(I.more)));
      right.appendChild(group);
    } else if (!narrow || this.view !== 'notes') {
      const group = h('div', { class: 'glass-capsule' });
      group.appendChild(h('button', { class: 'cap-btn cap-ai', type: 'button', 'aria-label': 'Claude fragen', onclick: () => this.ai.openPanel({ workspace: true }) }, svg(I.sparkle)));
      group.appendChild(h('button', { class: 'cap-btn', type: 'button', 'aria-label': 'Neue Seite', onclick: () => this.createPage({}) }, svg(I.pen)));
      right.appendChild(group);
    }
    nb.append(left, center, right);
    const sp = nb.querySelector('.sync-pill');
    if (sp) this.paintSync(sp);
    this.onScroll();
  }

  onScroll() {
    const y = this.scroll.scrollTop;
    document.body.classList.toggle('scrolled', y > 8);
    const t = this.titleEl;
    const showTitle = t && t.isConnected ? t.getBoundingClientRect().bottom < 70 : y > 60;
    this.navbar.classList.toggle('show-title', !!showTitle);
  }

  toggleSidebar() {
    if (isNarrow()) return;
    this.sidebarOpen = !this.sidebarOpen;
    storageSet('lr:sidebar', this.sidebarOpen);
    this.applyLayoutClasses();
  }

  closeSidebarOverlay() {
    this.sidebarOverlay = false;
  }

  // ---------------------------------------------------------------------
  // Tab-Leiste (iPhone)
  // ---------------------------------------------------------------------
  renderTabbar() {
    const tb = this.tabbar;
    if (!tb) return;
    tb.innerHTML = '';
    const due = this.pages.size ? this.dueCardsCount() : 0;
    const tab = (id, hash, label, icon, badge) =>
      h(
        'button',
        { class: 'tab' + (this.view === id || (this.view === 'page' && this.tab === id) ? ' on' : ''), type: 'button', 'aria-label': label, 'aria-current': this.view === id ? 'page' : null, onclick: () => this.goView(hash) },
        h('span', { class: 'tab-ico' }, svg(icon), badge ? h('span', { class: 'tab-badge' }, badge > 99 ? '99+' : String(badge)) : null),
        h('span', { class: 'tab-label' }, label)
      );
    const group = h('div', { class: 'tab-group glass' }, tab('notes', 'notizen', 'Notizen', I.pageText), tab('today', 'heute', 'Heute', I.calendar), tab('learn', 'lernen', 'Lernen', I.cards, due));
    const search = h('button', { class: 'tab-search glass', type: 'button', 'aria-label': 'Suchen', onclick: () => openSearch(this) }, svg(I.search));
    tb.append(group, search);
  }

  // ---------------------------------------------------------------------
  // Seitenleiste / Notizen-Startbildschirm
  // ---------------------------------------------------------------------
  _renderNav() {
    if (!this.sidebar) return;
    const sc = this.sidebar.querySelector('.sb-scroll');
    const keep = sc ? sc.scrollTop : 0;
    this.sidebar.innerHTML = '';
    this.sidebar.appendChild(this.buildNavContent(false));
    const nsc = this.sidebar.querySelector('.sb-scroll');
    if (nsc) nsc.scrollTop = keep;
    if (this.view === 'notes' && isNarrow()) {
      const home = this.content.querySelector('.notes-home');
      if (home) {
        const s = this.scroll.scrollTop;
        home.replaceWith(this.buildNotesHome());
        this.scroll.scrollTop = s;
      }
    }
    if (this.tabbar) this.renderTabbar();
  }

  renderNotesHome() {
    this.content.appendChild(this.buildNotesHome());
  }

  buildNotesHome() {
    const el = h('div', { class: 'notes-home' });
    el.appendChild(this.buildNavContent(true));
    return el;
  }

  buildNavContent(asHome) {
    const wrap = h('div', { class: 'sb' + (asHome ? ' sb-home' : '') });
    const due = this.dueCardsCount();
    const head = h(
      'div',
      { class: 'sb-head' },
      h('div', { class: 'sb-brand' }, h('span', { class: 'sb-logo', 'aria-hidden': 'true' }, 'L'), h('span', { class: asHome ? 'large-title' : 'sb-name' }, asHome ? 'Notizen' : this.workspaceName())),
      h(
        'div',
        { class: 'sb-head-actions' },
        h('button', { class: 'glass-btn', type: 'button', 'aria-label': 'Einstellungen', onclick: () => openSettings(this) }, svg(I.settings)),
        h('button', { class: 'glass-btn glass-tint', type: 'button', 'aria-label': 'Neue Seite', onclick: () => this.createPage({}) }, svg(I.pen))
      )
    );
    wrap.appendChild(head);
    if (!asHome || !isNarrow()) {
      wrap.appendChild(
        h('button', { class: 'search-field', type: 'button', onclick: () => openSearch(this) }, svg(I.search), h('span', {}, 'Suchen'), h('kbd', { class: 'hide-touch' }, (navigator.platform.includes('Mac') ? '⌘' : 'Strg ') + 'K'))
      );
    }
    const scroll = h('div', { class: 'sb-scroll' });
    if (!asHome) {
      const nav = h(
        'div',
        { class: 'ios-list sb-nav' },
        this.navRow('Heute', I.calendar, 'today', () => this.goView('heute'), 'c-red'),
        this.navRow('Lernen', I.cards, 'learn', () => this.goView('lernen'), 'c-orange', due),
        this.navRow('Claude', I.sparkle, 'ai', () => this.ai.openPanel({ workspace: true }), 'c-purple'),
        this.navRow('Vorlagen', I.template, 'tpl', () => openTemplates(this), 'c-blue')
      );
      scroll.appendChild(nav);
    } else {
      scroll.appendChild(
        h(
          'div',
          { class: 'quick-grid' },
          this.quickTile('Neue Notiz', I.pen, 'c-indigo', () => this.createPage({})),
          this.quickTile('Handschrift', I.highlighter, 'c-purple', () => {
            const p = this.createPage({ title: 'Handschriftliche Notiz', icon: '✍️', blocks: [newBlock('drawing', { h: 1300 }), newBlock('p')] });
            void p;
          }),
          this.quickTile('Vorlagen', I.template, 'c-blue', () => openTemplates(this)),
          this.quickTile('Claude', I.sparkle, 'c-pink', () => this.ai.openPanel({ workspace: true }))
        )
      );
    }
    const favs = this.allPages().filter((p) => p.favorite).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (favs.length) {
      scroll.appendChild(h('div', { class: 'section-label' }, 'Favoriten'));
      scroll.appendChild(h('div', { class: 'ios-list tree' }, favs.map((p) => this.treeRow(p, 0, { flat: true }))));
    }
    scroll.appendChild(
      h(
        'div',
        { class: 'section-label with-action' },
        h('span', {}, 'Seiten'),
        h('button', { class: 'section-action', type: 'button', 'aria-label': 'Neue Seite', onclick: () => this.createPage({}) }, svg(I.plus))
      )
    );
    const roots = this.childrenOf(null);
    const tree = h('div', { class: 'ios-list tree', role: 'tree' });
    for (const p of roots) this.appendTree(tree, p, 0);
    if (!roots.length) tree.appendChild(h('div', { class: 'ios-row muted' }, 'Noch keine Seiten'));
    tree.appendChild(h('button', { class: 'ios-row tree-add', type: 'button', onclick: () => this.createPage({}) }, h('span', { class: 'ios-row-ico' }, svg(I.plus)), h('span', { class: 'ios-row-title' }, 'Neue Seite')));
    scroll.appendChild(tree);
    const trashed = [...this.pages.values()].filter((p) => p.trashed).length;
    scroll.appendChild(h('div', { class: 'ios-list sb-foot' }, this.navRow('Papierkorb', I.trash, 'trash', () => this.goView('papierkorb'), 'c-gray', trashed || null), this.navRow('Einstellungen', I.settings, 'settings', () => openSettings(this), 'c-gray')));
    const sync = h('div', { class: 'sidebar-sync' });
    this.paintSync(sync, true);
    scroll.appendChild(sync);
    wrap.appendChild(scroll);
    return wrap;
  }

  workspaceName() {
    return storageGet('lr:wsname', 'Lernraum');
  }

  navRow(label, icon, id, onclick, color, badge) {
    const active = (id === 'today' && this.view === 'today') || (id === 'learn' && this.view === 'learn') || (id === 'trash' && this.view === 'trash');
    return h(
      'button',
      { class: 'ios-row nav-row' + (active ? ' active' : ''), type: 'button', onclick },
      h('span', { class: 'ios-row-ico tile ' + color }, svg(icon)),
      h('span', { class: 'ios-row-title' }, label),
      badge ? h('span', { class: 'ios-badge' }, String(badge)) : null
    );
  }

  quickTile(label, icon, color, onclick) {
    return h('button', { class: 'quick-tile', type: 'button', onclick }, h('span', { class: 'tile ' + color }, svg(icon)), h('span', { class: 'quick-label' }, label));
  }

  appendTree(container, p, depth) {
    container.appendChild(this.treeRow(p, depth));
    if (this.expanded.has(p.id) && p.kind !== 'database') {
      const kids = this.childrenOf(p.id);
      for (const k of kids) this.appendTree(container, k, depth + 1);
      if (!kids.length) container.appendChild(h('div', { class: 'tree-empty', style: { '--depth': depth + 1 } }, 'Keine Unterseiten'));
    }
  }

  treeRow(p, depth, opts = {}) {
    const kids = p.kind === 'database' ? [] : this.childrenOf(p.id);
    const open = this.expanded.has(p.id);
    const active = this.view === 'page' && this.currentId === p.id;
    const row = h('div', { class: 'ios-row tree-row' + (active ? ' active' : ''), role: 'treeitem', 'aria-expanded': kids.length ? String(open) : null, 'data-id': p.id, style: { '--depth': depth } });
    if (!opts.flat) {
      row.appendChild(
        h(
          'button',
          {
            class: 'tree-toggle' + (open ? ' open' : '') + (kids.length ? '' : ' leaf'),
            type: 'button',
            'aria-label': open ? 'Einklappen' : 'Ausklappen',
            tabindex: kids.length ? '0' : '-1',
            onclick: (e) => {
              e.stopPropagation();
              if (open) this.expanded.delete(p.id);
              else this.expanded.add(p.id);
              storageSet('lr:expanded', [...this.expanded]);
              this._renderNav();
            },
          },
          svg(I.chevronRight)
        )
      );
    }
    const main = h(
      'button',
      { class: 'tree-main', type: 'button', onclick: () => this.navigate(p.id) },
      h('span', { class: 'ios-row-ico' }, p.icon ? h('span', { class: 'emoji' }, p.icon) : svg(p.kind === 'database' ? I.database : I.pageText)),
      h('span', { class: 'ios-row-title' }, pageTitle(p))
    );
    row.appendChild(main);
    const actions = h(
      'span',
      { class: 'tree-actions' },
      h('button', { class: 'tree-act', type: 'button', 'aria-label': 'Seitenoptionen', onclick: (e) => { e.stopPropagation(); this.treeMenu(e.currentTarget, p); } }, svg(I.more)),
      p.kind !== 'database' ? h('button', { class: 'tree-act', type: 'button', 'aria-label': 'Unterseite hinzufügen', onclick: (e) => { e.stopPropagation(); this.createPage({ parentId: p.id }); } }, svg(I.plus)) : null
    );
    row.appendChild(actions);
    attachTreeDrag(this, row, p, opts.flat);
    return row;
  }

  treeMenu(anchor, p) {
    menu(
      anchor,
      [
        { label: 'Öffnen', icon: I.arrowUpRight, onSelect: () => this.navigate(p.id) },
        p.kind !== 'database' ? { label: 'Unterseite hinzufügen', icon: I.plus, onSelect: () => this.createPage({ parentId: p.id }) } : null,
        { label: p.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: p.favorite ? I.starFill : I.star, onSelect: () => this.toggleFavorite(p) },
        { label: 'Umbenennen', icon: I.type, onSelect: () => this.renamePage(p) },
        { label: 'Duplizieren', icon: I.duplicate, onSelect: () => this.duplicatePage(p.id) },
        { label: 'Verschieben nach …', icon: I.move, onSelect: () => movePagePicker(this, p) },
        { divider: true },
        { label: 'In den Papierkorb', icon: I.trash, danger: true, onSelect: () => this.trashPage(p.id) },
      ].filter(Boolean),
      { title: pageTitle(p) }
    );
  }

  async renamePage(p) {
    const { promptDialog } = await import('./menus.js');
    const v = await promptDialog({ title: 'Umbenennen', value: p.title || '', okLabel: 'Speichern' });
    if (v == null) return;
    p.title = v.trim();
    this.touch(p);
    if (this.currentId === p.id) this.route(true);
  }

  // ---------------------------------------------------------------------
  // Editor-Rückmeldungen
  // ---------------------------------------------------------------------
  onEditorFocus(ed, b, el) {
    this.toolbars.onFocus(ed, b, el);
  }
  onEditorBlur(ed) {
    this.toolbars.onBlur(ed);
  }
  onBlockSelection(ed) {
    this.toolbars.onSelection(ed);
  }
  onBlocksLayout(ed) {
    this.tocSoon();
    void ed;
  }
  onAIChanged() {
    if (this.editor) {
      // Buttons in Blöcken (Karteikarten, Quiz, Bilder) neu zeichnen
      this.editor.root.querySelectorAll('.fc-block, .quiz').forEach((el) => el._redraw && el._redraw());
    }
    this.toolbars.update();
    redrawAllDrawings();
  }
  onStudyDone() {
    this.renderTabbar();
    this._renderNav();
    if (this.view === 'learn' || this.view === 'today') this.route(true);
    else if (this.editor) this.editor.root.querySelectorAll('.fc-block').forEach((el) => el._redraw && el._redraw());
  }

  // ---------------------------------------------------------------------
  // Tastatur
  // ---------------------------------------------------------------------
  onGlobalKey(e) {
    const k = e.key.toLowerCase();
    if (mod(e) && (k === 'k' || k === 'p') && !(k === 'k' && this.editor && window.getSelection() && !window.getSelection().isCollapsed && this.editor.root.contains(document.activeElement))) {
      e.preventDefault();
      openSearch(this);
      return;
    }
    if (mod(e) && k === 'j') {
      e.preventDefault();
      if (this.ai.panel) this.ai.closePanel();
      else this.ai.openPanel();
      return;
    }
    if (mod(e) && e.key === '\\') {
      e.preventDefault();
      this.toggleSidebar();
      return;
    }
    if (mod(e) && e.shiftKey && k === 'l') {
      e.preventDefault();
      const cur = storageGet('lr:theme', 'system');
      const next = cur === 'dark' ? 'light' : 'dark';
      this.setTheme(next);
      toast(next === 'dark' ? 'Dunkles Design' : 'Helles Design');
      return;
    }
    if (mod(e) && (k === 'z' || k === 'y') && this.editor && !document.querySelector('.popover, .modal-backdrop')) {
      const ae = document.activeElement;
      const inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (!inField) {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) this.editor.history.redo();
        else this.editor.history.undo();
        return;
      }
    }
    if (e.key === 'Escape' && this.ai.panel && !document.querySelector('.popover, .modal-backdrop')) {
      this.ai.closePanel();
      return;
    }
    if (this.editor && this.editor.selected.size && !document.querySelector('.popover, .modal-backdrop')) {
      const ae = document.activeElement;
      if (!ae || ae === document.body || !ae.isContentEditable) {
        if (this.editor.handleSelectionKey(e)) e.stopPropagation();
      }
    }
  }

  setTheme(t) {
    storageSet('lr:theme', t);
    applyTheme(t);
  }
}

export function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'dark' || t === 'light') root.setAttribute('data-app-theme', t);
  else root.removeAttribute('data-app-theme');
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}

function stripTransient(p) {
  if (!p) return p;
  const c = { ...p };
  if (c.blocks) c.blocks = c.blocks.map((b) => {
    if ('_expanded' in b) {
      const x = { ...b };
      delete x._expanded;
      return x;
    }
    return b;
  });
  return c;
}

function offlineText(err) {
  if (!err) return '';
  const code = err.code;
  if (code === 'server_not_connected') return 'Der Cloudflare-Connector ist nicht verbunden (claude.ai → Einstellungen → Connectors).';
  if (code === 'needs_reauth') return 'Der Cloudflare-Connector muss neu verbunden werden (claude.ai → Einstellungen → Connectors).';
  if (code === 'not_in_manifest' || code === 'not_granted' || code === 'consent_required') return 'Der Zugriff auf Cloudflare wurde nicht erlaubt.';
  if (code === 'auth') return 'Deine Anmeldung ist abgelaufen – lade die Seite neu, um dich anzumelden.';
  return 'Keine Verbindung zu Cloudflare. Änderungen werden gespeichert, sobald du wieder online bist.';
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'Seite';
}

// Seitenbaum: Ziehen zum Umsortieren/Verschachteln (Maus sofort, Touch nach langem Drücken)
function attachTreeDrag(app, row, p, flat) {
  if (flat) {
    // Favoriten: nur langes Drücken → Menü
    attachLongPress(row, () => app.treeMenu(row.querySelector('.tree-act') || row, p));
    return;
  }
  row.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tree-toggle, .tree-act')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const pid = e.pointerId;
    const isTouch = e.pointerType !== 'mouse';
    let dragging = false;
    let ghost = null;
    let target = null;
    let lp = null;
    const begin = () => {
      dragging = true;
      row.classList.add('drag-src');
      ghost = h('div', { class: 'drag-ghost' }, (p.icon ? p.icon + ' ' : '') + pageTitle(p));
      document.body.appendChild(ghost);
      document.body.classList.add('is-dragging');
      if (navigator.vibrate) navigator.vibrate(8);
    };
    if (isTouch) lp = setTimeout(() => {
      if (!moved) {
        begin();
      }
    }, 420);
    let moved = false;
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!dragging) {
        if (dist > 6) {
          moved = true;
          if (isTouch) {
            clearTimeout(lp);
            cleanup(false);
            return;
          }
          begin();
        } else return;
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY + 6}px)`;
      document.querySelectorAll('.tree-row.drop-before, .tree-row.drop-after, .tree-row.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
      ghost.style.display = 'none';
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      ghost.style.display = '';
      const tr = under && under.closest('.tree-row');
      target = null;
      if (tr && tr !== row && tr.dataset.id) {
        const r = tr.getBoundingClientRect();
        const rel = (ev.clientY - r.top) / r.height;
        const tp = app.getPage(tr.dataset.id);
        const zone = rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : tp && tp.kind === 'database' ? 'after' : 'into';
        tr.classList.add('drop-' + zone);
        target = { id: tr.dataset.id, zone };
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      clearTimeout(lp);
      const was = dragging;
      cleanup(true);
      if (was && target) {
        const tp = app.getPage(target.id);
        if (!tp) return;
        if (target.zone === 'into') app.movePage(p.id, tp.id);
        else if (target.zone === 'before') app.movePage(p.id, tp.parentId || null, tp.id);
        else {
          const sibs = app.childrenOf(tp.parentId || null);
          const i = sibs.findIndex((s) => s.id === tp.id);
          const next = sibs[i + 1];
          app.movePage(p.id, tp.parentId || null, next && next.id !== p.id ? next.id : null);
        }
      } else if (was && !target) {
        /* abgebrochen */
      } else if (isTouch && !moved && ev.type === 'pointerup' && Date.now() - t0 > 420) {
        /* langes Drücken ohne Ziehen → Menü */
        app.treeMenu(row.querySelector('.tree-act') || row, p);
      }
    };
    const t0 = Date.now();
    const cleanup = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (ghost) ghost.remove();
      row.classList.remove('drag-src');
      document.body.classList.remove('is-dragging');
      document.querySelectorAll('.tree-row.drop-before, .tree-row.drop-after, .tree-row.drop-into').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    app.treeMenu(row.querySelector('.tree-act') || row, p);
  });
  row.addEventListener('touchmove', (e) => {
    if (document.body.classList.contains('is-dragging')) e.preventDefault();
  }, { passive: false });
}

function attachLongPress(el, fn) {
  let t = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    t = setTimeout(fn, 480);
  });
  ['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => el.addEventListener(ev, (e) => {
    if (ev === 'pointermove' && e.movementX === 0 && e.movementY === 0) return;
    clearTimeout(t);
  }));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    fn();
  });
}

export { modal, confirmDialog, popover, markdownToBlocks, renderMathIn };
