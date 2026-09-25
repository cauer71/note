// Popover, Menüs, Modale, Bottom-Sheets, Emoji-Auswahl, Bestätigung

import { h, svg, isNarrow, normalizeSearch } from './util.js';
import { I } from './icons.js';

let openPopovers = [];

export function closeAllPopovers() {
  for (const p of [...openPopovers]) p.close();
}

export function hasOpenPopover() {
  return openPopovers.length > 0;
}

// Ein Popover an einem Anker (Element oder DOMRect). Auf schmalen Geräten als Bottom-Sheet.
export function popover(anchor, content, opts = {}) {
  if (!opts.stack) closeAllPopovers();
  const sheet = opts.sheet !== false && isNarrow();
  const backdrop = h('div', { class: 'pop-backdrop' + (sheet ? ' sheet-backdrop' : '') });
  const el = h('div', { class: 'popover' + (sheet ? ' sheet' : '') + (opts.class ? ' ' + opts.class : ''), role: opts.role || 'dialog' });
  if (sheet) el.appendChild(h('div', { class: 'sheet-grip' }));
  if (sheet && opts.title) el.appendChild(h('div', { class: 'sheet-title' }, opts.title));
  el.appendChild(content);
  document.body.append(backdrop, el);

  const api = {
    el,
    closed: false,
    close() {
      if (api.closed) return;
      api.closed = true;
      backdrop.remove();
      el.remove();
      openPopovers = openPopovers.filter((p) => p !== api);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      opts.onClose && opts.onClose();
    },
    reposition: () => place(),
  };
  function onKey(e) {
    if (e.key === 'Escape' && openPopovers[openPopovers.length - 1] === api) {
      e.preventDefault();
      e.stopPropagation();
      api.close();
      opts.onEscape && opts.onEscape();
    }
  }
  // Schließen erst beim Klick auf den Hintergrund – sonst landet der Tipp auf dem Element darunter (iOS)
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    downOnBackdrop = true;
    e.preventDefault();
  });
  backdrop.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (downOnBackdrop) api.close();
    downOnBackdrop = false;
  });
  document.addEventListener('keydown', onKey, true);

  function place() {
    if (sheet) return;
    const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let left = opts.alignRight ? r.right - pw : r.left;
    let top = opts.above ? r.top - ph - 6 : r.bottom + 6;
    if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 6);
    if (top < 8) top = 8;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  place();
  window.addEventListener('resize', place);
  openPopovers.push(api);
  if (opts.focus !== false) {
    const f = el.querySelector('input, textarea, [autofocus]');
    if (f && !sheet) setTimeout(() => f.focus(), 0);
  }
  return api;
}

// Menü mit Einträgen: {label, icon, hint, danger, onSelect, checked, submenu, divider}
export function menu(anchor, items, opts = {}) {
  const list = h('div', { class: 'menu', role: 'menu' });
  let filterInput = null;
  if (opts.search) {
    filterInput = h('input', { class: 'menu-search', placeholder: opts.searchPlaceholder || 'Suchen…', type: 'text' });
    list.appendChild(filterInput);
  }
  const itemsWrap = h('div', { class: 'menu-items' });
  list.appendChild(itemsWrap);
  let pop;
  let active = -1;
  let rendered = [];

  function render(q = '') {
    itemsWrap.innerHTML = '';
    rendered = [];
    const nq = normalizeSearch(q);
    let lastHeader = null;
    for (const it of items) {
      if (it.header) {
        lastHeader = h('div', { class: 'menu-header' }, it.header);
        if (!nq) itemsWrap.appendChild(lastHeader);
        continue;
      }
      if (it.divider) {
        if (!nq) itemsWrap.appendChild(h('div', { class: 'menu-divider' }));
        continue;
      }
      if (nq && !normalizeSearch(it.label + ' ' + (it.keys || '')).includes(nq)) continue;
      const btn = h(
        'button',
        {
          class: 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''),
          role: 'menuitem',
          type: 'button',
          disabled: it.disabled,
        },
        it.icon ? (typeof it.icon === 'string' && it.icon.startsWith('<') ? svg(it.icon, 'menu-ico') : h('span', { class: 'menu-ico emoji' }, it.icon)) : it.swatch ? h('span', { class: 'menu-ico swatch', 'data-swatch': it.swatch }) : null,
        h('span', { class: 'menu-label' }, it.label, it.desc ? h('span', { class: 'menu-desc' }, it.desc) : null),
        it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
        it.checked ? svg(I.check, 'menu-check') : null,
        it.submenu ? svg(I.chevronRight, 'menu-check') : null
      );
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.submenu) {
          menu(btn, it.submenu, { stack: true, ...(it.submenuOpts || {}) });
          return;
        }
        if (!it.keepOpen) pop.close();
        it.onSelect && it.onSelect(e);
      });
      btn.addEventListener('mouseenter', () => setActive(rendered.indexOf(btn)));
      rendered.push(btn);
      itemsWrap.appendChild(btn);
    }
    if (!rendered.length) itemsWrap.appendChild(h('div', { class: 'menu-empty' }, opts.emptyText || 'Keine Treffer'));
    setActive(rendered.length ? 0 : -1);
  }
  function setActive(i) {
    rendered.forEach((b, j) => b.classList.toggle('active', j === i));
    active = i;
    if (rendered[i]) rendered[i].scrollIntoView({ block: 'nearest' });
  }
  render();
  pop = popover(anchor, list, { ...opts, role: 'menu', title: opts.title });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((active + 1) % rendered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((active - 1 + rendered.length) % rendered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rendered[active] && rendered[active].click();
    }
  });
  if (filterInput) {
    filterInput.addEventListener('input', () => render(filterInput.value));
    if (!isNarrow()) setTimeout(() => filterInput.focus(), 0);
  } else {
    list.tabIndex = -1;
    if (!isNarrow() && opts.focusList !== false) setTimeout(() => list.focus({ preventScroll: true }), 0);
  }
  return pop;
}

// Modaler Dialog
export function modal(content, opts = {}) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: 'modal' + (opts.class ? ' ' + opts.class : ''), role: 'dialog', 'aria-modal': 'true' });
  if (opts.title) {
    box.appendChild(
      h(
        'div',
        { class: 'modal-head' },
        h('div', { class: 'modal-title' }, opts.title),
        h('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => api.close() }, svg(I.close))
      )
    );
  }
  box.appendChild(content);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  const api = {
    el: box,
    close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      opts.onClose && opts.onClose();
    },
  };
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      api.close();
    }
  }
  document.addEventListener('keydown', onKey, true);
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === backdrop;
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && downOnBackdrop) api.close();
    downOnBackdrop = false;
  });
  return api;
}

export function confirmDialog({ title, text, okLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const body = h(
      'div',
      { class: 'confirm' },
      h('p', {}, text),
      h(
        'div',
        { class: 'confirm-actions' },
        h('button', { class: 'btn', onclick: () => finish(false) }, 'Abbrechen'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => finish(true) }, okLabel)
      )
    );
    const m = modal(body, { title, class: 'modal-sm', onClose: () => finish(false) });
    setTimeout(() => m.el.querySelector('.btn-primary, .btn-danger').focus(), 0);
  });
}

export function promptDialog({ title, label, value = '', okLabel = 'OK', placeholder = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', type: 'text', placeholder });
    input.value = value;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const body = h(
      'form',
      {
        class: 'confirm',
        onsubmit: (e) => {
          e.preventDefault();
          finish(input.value);
        },
      },
      label ? h('label', { class: 'field-label' }, label) : null,
      input,
      h(
        'div',
        { class: 'confirm-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Abbrechen'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, okLabel)
      )
    );
    const m = modal(body, { title, class: 'modal-sm', onClose: () => finish(null) });
    input.focus();
    input.select();
  });
}

// ---------------------------------------------------------------------------
// Emoji-Auswahl (kuratiert, mit deutschen Suchwörtern)
// ---------------------------------------------------------------------------
const EMOJI = [
  ['Lernen', '📚 bücher lernen|📖 buch lesen|📘 buch blau|📗 buch grün|📕 buch rot|📙 buch orange|📓 notizbuch|📔 notizbuch|📒 heft|📝 notiz schreiben|✏️ bleistift|🖊️ stift|🖋️ füller|✍️ schreiben hand|📐 geometrie mathe dreieck|📏 lineal|🧮 abakus rechnen|🔬 mikroskop biologie|🧪 chemie reagenz|🧬 dna genetik biologie|⚗️ chemie|🔭 teleskop physik astronomie|🌍 erde geografie|🗺️ karte geschichte|🏛️ geschichte antike|⚖️ recht jura|💻 laptop informatik|🖥️ computer|⌨️ tastatur|🧠 gehirn psychologie denken|💡 idee|🎓 abschluss uni|🏫 schule|🧑‍🏫 lehrer|👩‍🎓 studentin|👨‍🎓 student|🗣️ sprache|🇮🇹 italienisch|🇬🇧 englisch|🇩🇪 deutsch|🇫🇷 französisch|🎨 kunst|🎵 musik|📊 statistik diagramm|📈 wachstum wirtschaft|📉 fallend|💰 geld wirtschaft|🏥 medizin|🩺 medizin arzt|💊 pharmazie|⚛️ atom physik|∑ summe'],
  ['Planung', '📅 kalender|🗓️ kalender planung|⏰ wecker zeit|⏳ sanduhr|⌛ zeit|✅ erledigt|☑️ haken|📌 pin wichtig|📍 ort|🎯 ziel|🏁 ziel flagge|🚀 start projekt|🔥 wichtig heiß|⭐ stern favorit|🌟 stern|⚡ schnell|🔔 erinnerung|📋 klemmbrett liste|🗂️ ordner|📁 ordner|🗃️ kartei|📦 paket|🔖 lesezeichen|🏷️ etikett|🧾 beleg|📎 büroklammer|🔗 link|🔑 schlüssel|🔒 schloss'],
  ['Gefühle', '😀 lachen|😊 lächeln|🙂 froh|😎 cool|🤓 nerd|🤔 denken|😴 müde|😅 puh|🥳 feiern|😤 genervt|😰 stress|💪 stark|👍 daumen|🙌 hurra|👏 applaus|🙏 danke|❤️ herz|💙 herz blau|💚 herz grün|💛 herz gelb|💜 herz lila|🧡 herz orange'],
  ['Alltag', '🏠 haus zuhause|☕ kaffee|🍵 tee|🍎 apfel|🍕 pizza|🥗 salat|🏃 laufen sport|⚽ fußball|🏀 basketball|🎾 tennis|🚴 rad|🧘 yoga|🎮 spiel|🎬 film|🎧 kopfhörer|📷 kamera|✈️ reise flug|🚆 zug|🚌 bus|🚗 auto|🌱 pflanze wachsen|🌸 blume|🌞 sonne|🌙 mond nacht|❄️ winter|🍂 herbst|⛰️ berg|🏔️ berge dolomiten|🌊 welle meer'],
  ['Symbole', '❓ frage|❗ ausrufezeichen|⚠️ warnung|ℹ️ info|✨ funkeln ki|💬 sprechblase|🗨️ kommentar|📣 ankündigung|🔍 suche lupe|🧩 puzzle|🛠️ werkzeug|⚙️ einstellungen|🧭 kompass|♻️ recycling|➕ plus|➖ minus|✖️ mal|➗ geteilt|🔴 rot|🟠 orange|🟡 gelb|🟢 grün|🔵 blau|🟣 lila|⚫ schwarz|⚪ weiß'],
].map(([g, list]) => [g, list.split('|').map((x) => {
  const i = x.indexOf(' ');
  return { e: x.slice(0, i), k: x.slice(i + 1) };
})]);

export function emojiPicker(anchor, onPick, opts = {}) {
  const wrap = h('div', { class: 'emoji-picker' });
  const input = h('input', { class: 'menu-search', placeholder: 'Emoji suchen …', type: 'text' });
  const grid = h('div', { class: 'emoji-grid' });
  const top = h(
    'div',
    { class: 'emoji-top' },
    input,
    opts.allowRemove ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { pop.close(); onPick(''); } }, 'Entfernen') : null
  );
  wrap.append(top, grid);
  function render(q = '') {
    grid.innerHTML = '';
    const nq = normalizeSearch(q);
    for (const [group, list] of EMOJI) {
      const hits = list.filter((x) => !nq || normalizeSearch(x.k).includes(nq));
      if (!hits.length) continue;
      grid.appendChild(h('div', { class: 'emoji-group' }, group));
      const row = h('div', { class: 'emoji-row' });
      for (const x of hits) {
        row.appendChild(
          h('button', {
            class: 'emoji-btn',
            type: 'button',
            title: x.k,
            onclick: () => {
              pop.close();
              onPick(x.e);
            },
            text: x.e,
          })
        );
      }
      grid.appendChild(row);
    }
    if (!grid.childNodes.length) {
      // Eigenes Zeichen erlauben
      if (q.trim()) {
        grid.appendChild(
          h('button', { class: 'btn btn-ghost', onclick: () => { pop.close(); onPick(q.trim().slice(0, 4)); } }, `„${q.trim().slice(0, 4)}“ verwenden`)
        );
      } else grid.appendChild(h('div', { class: 'menu-empty' }, 'Keine Treffer'));
    }
  }
  input.addEventListener('input', () => render(input.value));
  render();
  const pop = popover(anchor, wrap, { title: 'Symbol wählen', class: 'pop-emoji' });
  return pop;
}
