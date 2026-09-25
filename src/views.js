// Ansichten: Heute, Lernen, Papierkorb, Suche, Einstellungen, Vorlagen, Verschieben

import { h, svg, fmtDate, relDay, relTime, todayISO, storageGet, storageSet, toast, isNarrow, readFileAsText, normalizeSearch, plural } from './util.js';
import { I } from './icons.js';
import { modal, confirmDialog, popover } from './menus.js';
import { pageTitle, newBlock } from './model.js';
import { collectAllCards, isDue, studySession, renderTimerCard } from './learn.js';
import { TEMPLATES } from './templates.js';
import { markdownToBlocks } from './markdown.js';
import { setFingerDrawing, fingerDrawing } from './drawing.js';
import { sanitizeBlocks } from './editor.js';
import { htmlToText } from './inline.js';
import { installSection, installCard } from './install.js';
import { APP_NAME } from './brand.js';

function largeTitle(title, sub) {
  return h('div', { class: 'large-head' }, h('h1', { class: 'large-title' }, title), sub ? h('div', { class: 'large-sub' }, sub) : null);
}

function pageIcon(p) {
  return h('span', { class: 'ios-row-ico' }, p.icon ? h('span', { class: 'emoji' }, p.icon) : svg(p.kind === 'database' ? I.database : I.pageText));
}

// ---------------------------------------------------------------------------
// Heute
// ---------------------------------------------------------------------------
export function renderToday(app, root) {
  const wrap = h('div', { class: 'screen today' });
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Hallo' : 'Guten Abend';
  wrap.appendChild(largeTitle('Heute', `${greet} · ${fmtDate(todayISO(), 'long')}`));
  const install = installCard(app);
  if (install) wrap.appendChild(install);

  const due = app.dueCardsCount();
  const up = app.upcoming(14, 7).filter((u) => !u.done);
  const overdue = up.filter((u) => u.diff < 0).length;
  const exams = app.upcoming(200, 0).filter((u) => /prüf|klausur|exam/i.test(pageTitle(u.db)) && u.diff >= 0);

  // Übersichtskacheln
  const tiles = h(
    'div',
    { class: 'stat-grid' },
    statTile('Fällige Karten', due, I.cards, 'c-orange', () => app.goView('lernen')),
    statTile('Abgaben (14 Tage)', up.filter((u) => u.diff >= 0).length, I.checkbox, 'c-blue', () => document.querySelector('.today-deadlines')?.scrollIntoView({ behavior: 'smooth' })),
    statTile('Überfällig', overdue, I.clock, overdue ? 'c-red' : 'c-gray', () => document.querySelector('.today-deadlines')?.scrollIntoView({ behavior: 'smooth' })),
    exams[0] ? statTile('Tage bis zur nächsten Prüfung', exams[0].diff, I.quiz, 'c-purple', () => app.navigate(exams[0].row.id)) : null
  );
  wrap.appendChild(tiles);

  // Abgaben
  wrap.appendChild(h('div', { class: 'section-label today-deadlines' }, 'Anstehend'));
  const list = h('div', { class: 'ios-list' });
  if (!up.length) list.appendChild(h('div', { class: 'ios-row muted' }, 'Nichts fällig in den nächsten zwei Wochen 🎉'));
  for (const u of up.slice(0, 12)) {
    const donebtn = u.statusProp
      ? h('button', {
          class: 'cell-check round' + (u.done ? ' on' : ''),
          type: 'button',
          role: 'checkbox',
          'aria-checked': u.done ? 'true' : 'false',
          'aria-label': 'Als erledigt markieren',
          onclick: () => {
            const doneOpt = (u.statusProp.options || []).find((o) => /erledigt|fertig|done/i.test(o.name));
            if (!doneOpt) return;
            u.row.props[u.statusProp.id] = doneOpt.id;
            app.touch(u.row);
            toast(`„${pageTitle(u.row)}“ erledigt`);
            app.route(true);
          },
        }, svg(I.check))
      : null;
    list.appendChild(
      h(
        'div',
        { class: 'ios-row deadline-row' },
        donebtn,
        h(
          'button',
          { class: 'deadline-main', type: 'button', onclick: () => app.navigate(u.row.id) },
          h('span', { class: 'ios-row-title' }, pageTitle(u.row)),
          h('span', { class: 'ios-row-sub' }, pageTitle(u.db), u.status ? h('span', { class: 'pill pill-sm', 'data-c': u.statusColor }, u.status) : null)
        ),
        h('span', { class: 'due-chip' + (u.diff < 0 ? ' overdue' : u.diff <= 2 ? ' soon' : '') }, relDay(u.date))
      )
    );
  }
  wrap.appendChild(list);

  // Lernen
  if (due) {
    wrap.appendChild(h('div', { class: 'section-label' }, 'Wiederholen'));
    wrap.appendChild(
      h(
        'div',
        { class: 'hero-card c-orange-soft' },
        h('div', { class: 'hero-card-text' }, h('strong', {}, plural(due, 'Karteikarte ist', 'Karteikarten sind') + ' fällig'), h('span', {}, 'Ein paar Minuten reichen – verteiltes Wiederholen wirkt.')),
        h('button', { class: 'btn btn-prominent', type: 'button', onclick: () => studySession(app, collectAllCards(app), { title: 'Alle fälligen' }) }, svg(I.play), ' Lernen')
      )
    );
  }

  // Prüfungen
  if (exams.length) {
    wrap.appendChild(h('div', { class: 'section-label' }, 'Prüfungen'));
    wrap.appendChild(
      h(
        'div',
        { class: 'ios-list' },
        exams.slice(0, 5).map((u) =>
          h('button', { class: 'ios-row', type: 'button', onclick: () => app.navigate(u.row.id) }, h('span', { class: 'countdown' }, h('strong', {}, String(u.diff)), h('span', {}, u.diff === 1 ? 'Tag' : 'Tage')), h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, pageTitle(u.row)), h('span', { class: 'ios-row-sub' }, fmtDate(u.date, 'long'))), svg(I.chevronRight, 'ios-chev'))
        )
      )
    );
  }

  // Zuletzt bearbeitet
  const recent = app.allPages().filter((p) => !p.isRow).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  wrap.appendChild(h('div', { class: 'section-label' }, 'Zuletzt bearbeitet'));
  wrap.appendChild(
    h(
      'div',
      { class: 'recent-grid' },
      recent.map((p) =>
        h(
          'button',
          { class: 'recent-card', type: 'button', onclick: () => app.navigate(p.id) },
          h('div', { class: 'recent-top', style: p.cover && p.cover.type === 'gradient' ? { background: coverBg(p) } : {} }, h('span', { class: 'recent-ico' }, p.icon || '📄')),
          h('div', { class: 'recent-body' }, h('div', { class: 'recent-title' }, pageTitle(p)), h('div', { class: 'recent-sub' }, relTime(p.updatedAt)))
        )
      )
    )
  );

  // Schnellaktionen
  wrap.appendChild(h('div', { class: 'section-label' }, 'Schnell starten'));
  wrap.appendChild(
    h(
      'div',
      { class: 'quick-grid' },
      app.quickTile('Neue Notiz', I.pen, 'c-indigo', () => app.createPage({})),
      app.quickTile('Handschrift', I.highlighter, 'c-purple', () => app.createPage({ title: 'Handschriftliche Notiz', icon: '✍️', blocks: [newBlock('drawing', { h: 1300 }), newBlock('p')] })),
      app.quickTile('Foto → Notizen', I.camera, 'c-teal', () => {
        const p = app.createPage({ title: 'Notizen aus Foto', icon: '📷' });
        setTimeout(() => app.ai.photoToNotes(p), 300);
      }),
      app.quickTile('Vorlage', I.template, 'c-blue', () => openTemplates(app))
    )
  );
  root.appendChild(wrap);
}

function coverBg(p) {
  const map = {
    dusk: 'linear-gradient(135deg, #5856d6 0%, #af52de 55%, #ff2d55 100%)',
    ocean: 'linear-gradient(135deg, #0a84ff 0%, #30b0c7 60%, #34c759 100%)',
  };
  return map[p.cover.value] || 'var(--fill-2)';
}

function statTile(label, n, icon, color, onclick) {
  return h('button', { class: 'stat-tile', type: 'button', onclick }, h('span', { class: 'tile ' + color }, svg(icon)), h('span', { class: 'stat-n' }, String(n)), h('span', { class: 'stat-l' }, label));
}

// ---------------------------------------------------------------------------
// Lernen
// ---------------------------------------------------------------------------
export function renderLearn(app, root) {
  const wrap = h('div', { class: 'screen learn' });
  const all = collectAllCards(app);
  const due = all.filter((x) => isDue(x.card));
  wrap.appendChild(largeTitle('Lernen', `${plural(all.length, 'Karteikarte', 'Karteikarten')} · ${due.length} fällig`));

  wrap.appendChild(
    h(
      'div',
      { class: 'hero-card c-indigo-soft' },
      h('div', { class: 'hero-card-text' }, h('strong', {}, due.length ? `${due.length} fällig` : 'Alles wiederholt'), h('span', {}, due.length ? 'Starte eine Runde mit allen fälligen Karten.' : 'Du kannst trotzdem alle Karten durchgehen.')),
      h('button', { class: 'btn btn-prominent', type: 'button', disabled: !all.length, onclick: () => studySession(app, all, { title: 'Alle Stapel' }) }, svg(I.play), due.length ? ' Lernen' : ' Alle üben')
    )
  );

  // Stapel
  const decks = new Map();
  for (const x of all) {
    const key = x.page.id + ':' + x.block.id;
    if (!decks.has(key)) decks.set(key, { page: x.page, block: x.block, items: [] });
    decks.get(key).items.push(x);
  }
  wrap.appendChild(h('div', { class: 'section-label' }, 'Stapel'));
  const list = h('div', { class: 'ios-list' });
  if (!decks.size) list.appendChild(h('div', { class: 'ios-row muted' }, 'Noch keine Karteikarten. Tippe in einer Seite „/karteikarten“.'));
  for (const d of decks.values()) {
    const dn = d.items.filter((x) => isDue(x.card)).length;
    const mastered = d.items.filter((x) => (x.card.box || 0) >= 4).length;
    const pct = Math.round((mastered / d.items.length) * 100);
    list.appendChild(
      h(
        'div',
        { class: 'ios-row deck-row' },
        h(
          'button',
          { class: 'deck-main', type: 'button', onclick: () => studySession(app, d.items, { title: pageTitle(d.page) }) },
          pageIcon(d.page),
          h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, pageTitle(d.page)), h('span', { class: 'ios-row-sub' }, `${d.items.length} Karten · ${pct} % sicher`, h('span', { class: 'mini-bar' }, h('span', { style: { width: pct + '%' } })))),
          dn ? h('span', { class: 'ios-badge' }, String(dn)) : h('span', { class: 'check-done' }, svg(I.check))
        ),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Seite öffnen', onclick: () => app.navigate(d.page.id) }, svg(I.arrowUpRight))
      )
    );
  }
  wrap.appendChild(list);

  // Quizze
  const quizzes = [];
  for (const p of app.allPages()) for (const b of p.blocks || []) if (b.type === 'quiz' && (b.questions || []).length) quizzes.push({ p, b });
  if (quizzes.length) {
    wrap.appendChild(h('div', { class: 'section-label' }, 'Quizze'));
    wrap.appendChild(
      h(
        'div',
        { class: 'ios-list' },
        quizzes.map(({ p, b }) =>
          h('button', { class: 'ios-row', type: 'button', onclick: () => { app.navigate(p.id); setTimeout(() => { const el = app.editor && app.editor.els.get(b.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 250); } }, h('span', { class: 'ios-row-ico tile c-green' }, svg(I.quiz)), h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, b.title || pageTitle(p)), h('span', { class: 'ios-row-sub' }, plural(b.questions.length, 'Frage', 'Fragen') + (b.lastScore ? ` · zuletzt ${b.lastScore.pct} %` : ''))), svg(I.chevronRight, 'ios-chev'))
        )
      )
    );
  }

  wrap.appendChild(h('div', { class: 'section-label' }, 'Fokus-Timer'));
  wrap.appendChild(renderTimerCard());

  if (app.ai.available) {
    wrap.appendChild(h('div', { class: 'section-label' }, 'Mit Claude lernen'));
    wrap.appendChild(
      h(
        'div',
        { class: 'ios-list' },
        h('button', { class: 'ios-row', type: 'button', onclick: () => app.ai.openPanel({ workspace: true }) }, h('span', { class: 'ios-row-ico tile c-purple' }, svg(I.sparkle)), h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, 'Frag deine Notizen'), h('span', { class: 'ios-row-sub' }, 'z. B. „Was kommt in der Analysis-Klausur dran?“')), svg(I.chevronRight, 'ios-chev'))
      )
    );
  }
  root.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Papierkorb
// ---------------------------------------------------------------------------
export function renderTrash(app, root) {
  const wrap = h('div', { class: 'screen trash' });
  const items = [...app.pages.values()].filter((p) => p.trashed).sort((a, b) => b.trashed - a.trashed);
  wrap.appendChild(largeTitle('Papierkorb', items.length ? plural(items.length, 'Seite', 'Seiten') : 'Leer'));
  const list = h('div', { class: 'ios-list' });
  if (!items.length) list.appendChild(h('div', { class: 'ios-row muted' }, 'Gelöschte Seiten erscheinen hier.'));
  for (const p of items) {
    list.appendChild(
      h(
        'div',
        { class: 'ios-row trash-row' },
        pageIcon(p),
        h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, pageTitle(p)), h('span', { class: 'ios-row-sub' }, 'Gelöscht ' + relTime(p.trashed) + (p.isRow ? ' · Eintrag in ' + pageTitle(app.getPage(p.parentId)) : ''))),
        h('button', { class: 'btn btn-tinted btn-sm', type: 'button', onclick: () => app.restorePage(p.id) }, 'Wiederherstellen'),
        h(
          'button',
          {
            class: 'icon-btn danger',
            type: 'button',
            'aria-label': 'Endgültig löschen',
            onclick: async () => {
              if (await confirmDialog({ title: 'Endgültig löschen?', text: `„${pageTitle(p)}“ und alle Unterseiten werden dauerhaft entfernt.`, okLabel: 'Löschen', danger: true })) {
                app.deleteForever(p.id);
                app.route(true);
              }
            },
          },
          svg(I.trash)
        )
      )
    );
  }
  wrap.appendChild(list);
  if (items.length) {
    wrap.appendChild(
      h('div', { class: 'center-actions' }, h('button', {
        class: 'btn btn-danger-ghost',
        type: 'button',
        onclick: async () => {
          if (await confirmDialog({ title: 'Papierkorb leeren?', text: plural(items.length, 'Seite wird', 'Seiten werden') + ' dauerhaft gelöscht.', okLabel: 'Leeren', danger: true })) {
            items.forEach((p) => app.deleteForever(p.id));
            app.route(true);
          }
        },
      }, 'Papierkorb leeren'))
    );
  }
  root.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------
export function openSearch(app) {
  if (document.querySelector('.modal-search')) return;
  const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Seiten, Notizen, Aufgaben durchsuchen', 'aria-label': 'Suchen', autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div', { class: 'search-results', role: 'listbox' });
  let active = 0;
  let items = [];
  const draw = () => {
    const q = input.value;
    const res = app.searchPages(q, 40);
    items = res;
    results.innerHTML = '';
    results.appendChild(h('div', { class: 'section-label' }, q.trim() ? `${res.length} Treffer` : 'Zuletzt bearbeitet'));
    const list = h('div', { class: 'ios-list' });
    res.forEach((r, i) => {
      const row = h(
        'button',
        { class: 'ios-row search-row' + (i === active ? ' active' : ''), type: 'button', role: 'option', onclick: () => open(i) },
        pageIcon(r.page),
        h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title', html: highlight(pageTitle(r.page), q) }), h('span', { class: 'ios-row-sub', html: r.snippet ? highlight(r.snippet, q) : escape(app.pathLabel(r.page)) })),
        svg(I.chevronRight, 'ios-chev')
      );
      row.addEventListener('mousemove', () => {
        if (active !== i) {
          active = i;
          list.querySelectorAll('.search-row').forEach((x, j) => x.classList.toggle('active', j === i));
        }
      });
      list.appendChild(row);
    });
    if (!res.length) list.appendChild(h('div', { class: 'ios-row muted' }, 'Keine Treffer. ', h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => { m.close(); app.createPage({ title: q.trim() }); } }, `„${q.trim()}“ als neue Seite anlegen`)));
    results.appendChild(list);
  };
  const open = (i) => {
    const r = items[i];
    if (!r) return;
    m.close();
    app.navigate(r.page.id);
  };
  input.addEventListener('input', () => {
    active = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      draw();
      results.querySelector('.search-row.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
      draw();
      results.querySelector('.search-row.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(active);
    }
  });
  const bar = h('div', { class: 'search-bar' }, h('label', { class: 'search-field active' }, svg(I.search), input), h('button', { class: 'btn btn-plain', type: 'button', onclick: () => m.close() }, 'Abbrechen'));
  const m = modal(h('div', { class: 'search-wrap' }, bar, results), { class: 'modal-search' });
  draw();
  input.focus();
}

function escape(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(text, q) {
  // erst auf dem Rohtext suchen, dann die Stücke einzeln escapen (Entities bleiben heil)
  const raw = String(text || '');
  const terms = normalizeSearch(q).trim().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return escape(raw);
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(re)) {
    out += escape(raw.slice(last, m.index)) + '<mark>' + escape(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + escape(raw.slice(last));
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------
export function openSettings(app) {
  const theme = storageGet('lr:theme', 'system');
  const seg = (name, opts, cur, onPick) => {
    const s = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
    for (const [v, l] of opts) {
      s.appendChild(
        h('button', {
          type: 'button',
          class: v === cur ? 'on' : '',
          role: 'radio',
          'aria-checked': v === cur ? 'true' : 'false',
          onclick: () => {
            s.querySelectorAll('button').forEach((b) => {
              b.classList.remove('on');
              b.setAttribute('aria-checked', 'false');
            });
            const btn = [...s.children].find((b) => b.textContent === l);
            btn.classList.add('on');
            btn.setAttribute('aria-checked', 'true');
            onPick(v);
          },
        }, l)
      );
    }
    return s;
  };
  const penOnly = h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Nur Stift zeichnet' });
  penOnly.checked = !fingerDrawing();
  penOnly.addEventListener('change', () => {
    setFingerDrawing(!penOnly.checked);
    toast(penOnly.checked ? 'Nur der Stift zeichnet – Finger scrollen' : 'Finger zeichnen jetzt auch');
  });
  const wsName = h('input', { class: 'input input-inline', type: 'text', value: app.workspaceName(), 'aria-label': 'Name des Arbeitsbereichs' });
  wsName.value = app.workspaceName();
  wsName.addEventListener('change', () => {
    storageSet('lr:wsname', wsName.value.trim() || APP_NAME);
    app._renderNav();
  });
  const store = app.store;
  const body = h(
    'div',
    { class: 'settings' },
    h('div', { class: 'section-label' }, 'Darstellung'),
    h(
      'div',
      { class: 'ios-list' },
      h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Design'), seg('Design', [['system', 'Auto'], ['light', 'Hell'], ['dark', 'Dunkel']], theme, (v) => app.setTheme(v))),
      h('label', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Name'), wsName)
    ),
    h('div', { class: 'section-label' }, 'Apple Pencil'),
    h(
      'div',
      { class: 'ios-list' },
      h('label', { class: 'ios-row' }, h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, 'Nur Stift zeichnet'), h('span', { class: 'ios-row-sub' }, 'Mit dem Finger scrollen, mit dem Stift schreiben (Palm Rejection).')), penOnly),
      h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Stift erkannt'), h('span', { class: 'ios-row-value' }, storageGet('lr:penSeen', false) ? 'Ja' : 'Noch nicht'))
    ),
    installSection(app),
    store && store.kind === 'cloudflare' && store.user && app.config.target === 'hosted'
      ? h(
          'div',
          {},
          h('div', { class: 'section-label' }, 'Konto'),
          h(
            'div',
            { class: 'ios-list' },
            h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Angemeldet als'), h('span', { class: 'ios-row-value account-email' }, store.user)),
            h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, 'Eigener Arbeitsbereich'), h('span', { class: 'ios-row-sub', style: { whiteSpace: 'normal' } }, 'Deine Notizen sind nur für dich sichtbar – jede Person hat ihre eigenen.'))),
            h('button', { class: 'ios-row ios-row-action', type: 'button', onclick: () => { m.close(); app.logout(); } }, h('span', { class: 'ios-row-title', style: { color: 'var(--red)' } }, 'Abmelden'))
          )
        )
      : null,
    h('div', { class: 'section-label' }, 'Speicher'),
    h(
      'div',
      { class: 'ios-list' },
      h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Ort'), h('span', { class: 'ios-row-value' }, store ? store.label : '–')),
      h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Seiten'), h('span', { class: 'ios-row-value' }, String(app.allPages().length))),
      h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Zuletzt gespeichert'), h('span', { class: 'ios-row-value' }, app.lastSaved ? relTime(app.lastSaved) : '–')),
      h('button', { class: 'ios-row ios-row-action', type: 'button', onclick: async () => { app.lastSyncAt = 0; await app.sync(); await app.save(); toast('Synchronisiert'); } }, h('span', { class: 'ios-row-title tint' }, 'Jetzt synchronisieren'))
    ),
    h('div', { class: 'section-label' }, 'Daten'),
    h(
      'div',
      { class: 'ios-list' },
      h('button', { class: 'ios-row ios-row-action', type: 'button', onclick: () => exportAll(app) }, h('span', { class: 'ios-row-title tint' }, 'Sicherung exportieren (JSON)')),
      h('button', { class: 'ios-row ios-row-action', type: 'button', onclick: () => importFile(app) }, h('span', { class: 'ios-row-title tint' }, 'Importieren (Sicherung oder Markdown) …')),
      h('button', { class: 'ios-row ios-row-action', type: 'button', onclick: () => { m.close(); app.restoreSeed(); } }, h('span', { class: 'ios-row-title tint' }, 'Testnotizen wiederherstellen'))
    ),
    h('div', { class: 'section-label' }, 'Claude'),
    h(
      'div',
      { class: 'ios-list' },
      h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'KI-Funktionen'), h('span', { class: 'ios-row-value' }, app.ai.available ? 'Verfügbar' : 'Nur in der Claude-Version')),
      app.ai.available ? h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, 'Bilder & Handschrift'), h('span', { class: 'ios-row-value' }, app.ai.canImages ? 'Ja' : 'Nein')) : null,
      !app.ai.available && app.config.artifactUrl ? h('a', { class: 'ios-row ios-row-action', href: app.config.artifactUrl, target: '_blank', rel: 'noopener' }, h('span', { class: 'ios-row-title tint' }, APP_NAME + ' in Claude öffnen')) : null
    ),
    h('div', { class: 'section-label' }, 'Tastenkürzel'),
    h(
      'div',
      { class: 'ios-list shortcuts' },
      [
        ['Suchen', '⌘K'],
        ['Claude', '⌘J'],
        ['Seitenleiste', '⌘\\'],
        ['Hell/Dunkel', '⇧⌘L'],
        ['Befehle', '/'],
        ['Seite verlinken', '@'],
        ['Einrücken', 'Tab'],
        ['Block verschieben', '⇧⌘↑ / ↓'],
        ['Block duplizieren', '⌘D'],
        ['Block auswählen', 'Esc'],
        ['Rückgängig', '⌘Z'],
      ].map(([a, b]) => h('div', { class: 'ios-row' }, h('span', { class: 'ios-row-title' }, a), h('kbd', {}, navigator.platform.includes('Mac') ? b : b.replace(/⌘/g, 'Strg+').replace(/⇧/g, '⇧')))
      )
    ),
    h('p', { class: 'settings-foot muted' }, APP_NAME + ' 1.1 · Daten in deiner Cloudflare-D1-Datenbank · KI über Claude')
  );
  const m = modal(body, { title: 'Einstellungen', class: 'modal-settings' });
}

function exportAll(app) {
  const data = JSON.stringify({ app: 'lernraum', version: 1, exportedAt: new Date().toISOString(), pages: [...app.pages.values()] }, null, 0);
  app.download(`lernraum-sicherung-${todayISO()}.json`, data);
}

function importFile(app) {
  const input = h('input', { type: 'file', accept: '.json,.md,.markdown,.txt,application/json,text/markdown,text/plain', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    const text = await readFileAsText(f);
    if (/\.json$/i.test(f.name)) {
      try {
        const data = JSON.parse(text);
        const pages = data.pages || [];
        let n = 0;
        for (const p of pages) {
          if (!p || typeof p.id !== 'string' || !p.id) continue;
          // Blöcke aus der Datei bereinigen (Titel/Symbol werden nur als Text angezeigt)
          p.blocks = sanitizeBlocks(p.blocks || [], { keepIds: true });
          if (typeof p.title !== 'string') p.title = '';
          if (typeof p.icon !== 'string') p.icon = '';
          p.icon = p.icon.slice(0, 8);
          const cur = app.pages.get(p.id);
          if (!cur || (p.updatedAt || 0) > (cur.updatedAt || 0)) {
            app.pages.set(p.id, p);
            app.dirty.add(p.id);
            n++;
          }
        }
        app.saveSoon();
        app._renderNav();
        toast(`${n} Seiten importiert`);
      } catch {
        toast('Die Datei ist keine gültige Sicherung', { kind: 'error' });
      }
    } else {
      const blocks = markdownToBlocks(text);
      let title = f.name.replace(/\.(md|markdown|txt)$/i, '');
      if (blocks[0] && blocks[0].type === 'h1') {
        title = htmlToText(blocks[0].text);
        blocks.shift();
      }
      app.createPage({ title, blocks: blocks.length ? blocks : [newBlock('p')] });
      toast('Markdown importiert');
    }
  });
  document.body.appendChild(input);
  input.click();
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------
export function openTemplates(app, parentId = null) {
  const grid = h('div', { class: 'tpl-grid' });
  for (const t of TEMPLATES) {
    grid.appendChild(
      h(
        'button',
        {
          class: 'tpl-card',
          type: 'button',
          onclick: () => {
            m.close();
            app.addPageFromTemplate(t, parentId);
          },
        },
        h('span', { class: 'tpl-ico' }, t.icon),
        h('span', { class: 'tpl-name' }, t.name),
        h('span', { class: 'tpl-desc' }, t.desc)
      )
    );
  }
  grid.appendChild(
    h('button', { class: 'tpl-card', type: 'button', onclick: () => { m.close(); app.createPage({ parentId }); } }, h('span', { class: 'tpl-ico' }, '📄'), h('span', { class: 'tpl-name' }, 'Leere Seite'), h('span', { class: 'tpl-desc' }, 'Mit einem leeren Blatt beginnen'))
  );
  grid.appendChild(
    h('button', { class: 'tpl-card', type: 'button', onclick: () => { m.close(); app.createDatabase({ parentId, title: '' }); } }, h('span', { class: 'tpl-ico' }, '🗂️'), h('span', { class: 'tpl-name' }, 'Leere Datenbank'), h('span', { class: 'tpl-desc' }, 'Tabelle mit Status und Datum'))
  );
  const m = modal(grid, { title: 'Vorlagen', class: 'modal-templates' });
}

// ---------------------------------------------------------------------------
// Seite verschieben
// ---------------------------------------------------------------------------
export function movePagePicker(app, page) {
  const input = h('input', { class: 'menu-search', type: 'search', placeholder: 'Ziel suchen …' });
  const list = h('div', { class: 'ios-list move-list' });
  const forbidden = new Set([page.id]);
  const collect = (id) => {
    for (const c of app.childrenOf(id)) {
      forbidden.add(c.id);
      collect(c.id);
    }
  };
  collect(page.id);
  const draw = () => {
    list.innerHTML = '';
    const q = normalizeSearch(input.value);
    list.appendChild(h('button', { class: 'ios-row', type: 'button', onclick: () => { pop.close(); app.movePage(page.id, null); toast('Auf oberste Ebene verschoben'); } }, h('span', { class: 'ios-row-ico' }, svg(I.home)), h('span', { class: 'ios-row-title' }, 'Oberste Ebene')));
    for (const p of app.allPages()) {
      if (p.isRow || p.kind === 'database' || forbidden.has(p.id)) continue;
      if (q && !normalizeSearch(pageTitle(p)).includes(q)) continue;
      list.appendChild(
        h('button', { class: 'ios-row', type: 'button', onclick: () => { pop.close(); app.movePage(page.id, p.id); toast(`Nach „${pageTitle(p)}“ verschoben`); } }, pageIcon(p), h('span', { class: 'ios-row-main' }, h('span', { class: 'ios-row-title' }, pageTitle(p)), h('span', { class: 'ios-row-sub' }, app.pathLabel(p))))
      );
    }
  };
  input.addEventListener('input', draw);
  draw();
  const pop = popover(document.querySelector('.navbar .nav-right') || document.body, h('div', { class: 'move-pop' }, input, list), { title: `„${pageTitle(page)}“ verschieben nach`, alignRight: true });
  void isNarrow;
}
