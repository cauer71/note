// Anleitung: geführte Tour durch die Funktionen – beim ersten Start und jederzeit über „Hilfe“
// Jeder Schritt zeigt oben ein kleines animiertes Beispiel der echten Oberfläche (CSS-Animationen: Aussehen in
// tour.css, Zeitleisten als kompakte Tabelle weiter unten) und darunter, wofür die Funktion im Studienalltag gut ist.

import { h, svg, storageGet, storageSet, isNarrow, relDay, toISODate, fmtDate, todayISO, escapeHtml } from './util.js';
import { I } from './icons.js';
import { APP_NAME, iconSvg } from './brand.js';
import { canInstall, installHint, hasInstallPrompt, promptInstall } from './install.js';
import { openSearch } from './views.js';

// Beim Laden gemerkt: route() ersetzt Kurzbefehle wie #neu sofort durch das Ziel
const START_HASH = typeof location !== 'undefined' ? location.hash : '';
const W = 340; // Zeichenfläche der Illustrationen (CSS-Pixel vor dem Skalieren)
const H = 232;

let current = null;

export function tourSeenKey(app) {
  return 'lr:tourSeen:' + (app.cacheKey || 'default');
}

export function isTourOpen() {
  return !!current;
}

// --- Bausteine für die Illustrationen (statische Vorlagen, nur eigene Konstanten) -----------------
const k = (s) => `<kbd>${escapeHtml(s)}</kbd>`;
const ic = (n) => `<span class="ico">${I[n]}</span>`;
// Absolut platziertes Element im 340×232-Raster
const P = (cls, x, y, w, hh, inner = '', extra = '') =>
  `<div class="ab ${cls}" style="left:${x}px;top:${y}px${w ? `;width:${w}px` : ''}${hh ? `;height:${hh}px` : ''}${extra}">${inner}</div>`;
// Tippen: Abdeckung mit Schreibmarke wandert schrittweise nach rechts
const T = (text, cls = '') => `<span class="tm-type${cls ? ' ' + cls : ''}">${text}<i class="tm-cover"></i></span>`;
// Finger (Touch) bzw. Mauszeiger, Hotspot in der Mitte
const ACT = (cls) =>
  `<div class="ab tm-actor tf ${cls}"><div class="tf-i"><svg class="tf-arr" viewBox="0 0 16 22"><path d="M1 1v16.5l4.2-4 2.9 6.6 2.7-1.2-2.9-6.4H15z"/></svg></div></div>`;
const scene = (inner) => `<div class="tm-scene">${inner}</div>`;
const tile = (c, n) => `<span class="tm-tile tile ${c}">${ic(n)}</span>`;
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2c.7 4.6 3.4 7.3 8 8-4.6.7-7.3 3.4-8 8-.7-4.6-3.4-7.3-8-8 4.6-.7 7.3-3.4 8-8z"/></svg>';
const TITLE_VL = '📈 VL 03 – Folgen und Grenzwerte';

function artWillkommen() {
  const chip = (x, y, dx, dy, i, c, n, label) =>
    `<span class="ab tv-chip" style="left:${x}px;top:${y}px;--dx:${dx}px;--dy:${dy}px;--i:${i}"><span class="tm-chip">${tile(c, n)}${label}</span></span>`;
  return (
    P('rd tv-halo', 82, 16, 176, 176) +
    P('ov tv-ic', 126, 60, 88, 88, iconSvg({ id: 'tourIc', rounded: true })) +
    chip(14, 28, 44, 25, 0, 'c-indigo', 'pen', 'Notizen') +
    chip(222, 22, -41, 28, 1, 'c-purple', 'highlighter', 'Handschrift') +
    chip(8, 150, 46, -24, 2, 'c-green', 'board', 'Aufgaben') +
    chip(214, 152, -38, -24, 3, 'c-orange', 'cards', 'Karteikarten') +
    chip(132, 196, 0, -42, 4, 'c-pink', 'sparkle', 'Claude')
  );
}

function artSchreiben() {
  const row = (n, label, desc, md, cls = '') =>
    `<div class="fx tw-row${cls}"><span class="fc cd tw-rb">${ic(n)}</span><span class="col tw-rl"><b class="w5">${label}</b><small class="z85 c2">${desc}</small></span><code class="c3">${md}</code></div>`;
  return scene(
    P('tm-window', 12, 10, 316, 212) +
      P('el tw-h', 28, 24, 0, 0, '<i class="tw-e">📈</i> VL 03 – Folgen und Grenzwerte') +
      P('z12 nw', 28, 56, 0, 0, 'Eine Folge (aₙ) konvergiert gegen a, wenn …') +
      P('tm-line', 28, 78, 180) +
      P('tm-line', 28, 90, 120) +
      P('z12 c2 tw-sl', 28, 111, 0, 0, '/') +
      P('tw-cw', 28, 112, 0, 0, '<i class="tw-car"></i>') +
      P('fx z12 nw tw-todo', 28, 111, 0, 0, `<span class="rl tw-cb"><span class="tm-on">${ic('check')}</span></span>${T('Übungsblatt 2 rechnen<i class="tw-st"></i>', 'tw-tx')}`) +
      P(
        'tm-glass tw-menu',
        44,
        126,
        232,
        98,
        `<div class="uc z85 tw-mh">Grundlagen</div><i class="tw-hi"></i>${row('heading1', 'Überschrift 1', 'Große Abschnittsüberschrift', '#')}${row('bullet', 'Aufzählung', 'Einfache Liste mit Punkten', '-')}${row('todo', 'To-do-Liste', 'Aufgaben zum Abhaken', '[]', ' tw-r3')}`
      ) +
      ACT('tw-act')
  );
}

function artKuerzel() {
  const sp = '<i class="c3">␣</i>';
  return scene(
    P('tm-window', 12, 10, 316, 212) +
      P('tm-glass pl c2 tk-key', 226, 18, 90, 24, `<span class="in tk-l1">#${sp}</span><span class="in tk-l2">-${sp}</span><span class="in tk-l3">**…**</span><span class="in tk-l4">[]${sp}</span>`) +
      // pro Zeile erst das Ergebnis, darüber das rohe Kürzel (verschwindet nach dem Leerzeichen)
      P('tk-hd', 28, 22, 0, 0, T('Konvergenz')) +
      P('c2 tk-raw tk-ra', 28, 27, 0, 0, T('# ')) +
      P('rd tk-bul tk-b1', 32, 72, 5, 5) +
      P('nw tk-l tk-tb', 44, 66, 0, 0, T('(aₙ) konvergiert gegen a')) +
      P('c2 tk-raw tk-rb', 28, 66, 0, 0, T('- ')) +
      P('rd tk-bul tk-b2', 32, 98, 5, 5) +
      P('nw tk-l', 44, 92, 0, 0, `<span class="tk-pre">Grenzwerte sind </span><span class="rl tk-rel"><span class="tk-rc">${T('<i class="c3">**</i>eindeutig<i class="c3">**</i>')}</span><b class="ab w7 tk-bd">eindeutig</b></span>`) +
      P('tk-cb', 28, 121, 14, 14) +
      P('nw tk-l tk-td', 48, 120, 0, 0, T('Skript Kapitel 2 lesen')) +
      P('c2 tk-raw tk-rd', 28, 120, 0, 0, T('[] ')) +
      P('tm-line', 28, 160, 210) +
      P('tm-line', 28, 172, 150)
  );
}

function artFormeln() {
  const line = (i, code) => `<div class="tx-l${i}">${code}</div>`;
  const kw = (s) => `<span class="hljs-keyword">${s}</span>`;
  const ty = '<span class="hljs-type">int</span>';
  const num = (s) => `<span class="hljs-number">${s}</span>`;
  return scene(
    P(
      'tm-window ov',
      14,
      10,
      312,
      98,
      P('tx-src', 12, 14, 288, 24, T('$\\lim_{n\\to\\infty} \\frac{1}{n} = 0$')) +
        '<div class="ab fc tx-f"><span class="col tx-lim">lim<small>n→∞</small></span><span class="col tx-fr"><i>1</i><b></b><i class="it">n</i></span><span>=&nbsp;0</span></div><i class="ab tx-sh"></i>'
    ) +
      P(
        'tm-window tx-c',
        14,
        118,
        312,
        106,
        P('z95 c2', 14, 9, 0, 0, 'Java') +
          P('tx-code', 14, 28, 0, 0, line(1, `${ty} summe = ${num(0)};`) + line(2, `${kw('for')} (${ty} i = ${num(1)}; i &lt;= n; i++) {`) + line(3, '  summe += i;') + line(4, '}'))
      )
  );
}

function artHandschrift() {
  const tool = (n, cls) => `<span class="fc rl th-t ${cls}">${ic(n)}<span class="tm-on">${ic(n)}</span></span>`;
  const dot = (col) => `<i class="rd th-dot" style="background:var(--${col})"></i>`;
  return scene(
    P(
      'tm-glass fx th-bar',
      14,
      10,
      312,
      30,
      tool('pen', 'th-tp') + tool('highlighter', 'th-th') + tool('eraser', '') + dot('label') + dot('blue') + dot('red') + ic('undo') + ic('hand') + ic('expand') + ic('more')
    ) +
      P(
        'ov th-paper',
        14,
        46,
        312,
        178,
        '<div class="th-pc"><svg class="th-ink" viewBox="0 0 312 178"><path d="M44 80q18-60 36 0q18 44 36 0q18-30 36 0q18 18 36 0q18-10 36 0"/></svg>' +
          '<i class="ab th-wipe"></i><i class="ab th-hl"></i>' +
          '<svg class="th-g" viewBox="0 0 312 178"><path class="th-lim" d="M34 80H262"/><path class="th-eps" d="M34 64H262M34 96H262"/><text x="22" y="84">a</text><text x="22" y="62">ε</text></svg>' +
          '<i class="in th-rule"></i></div>'
      ) +
      P('th-palm', 222, 150, 130, 96, '<i class="rd" style="left:30px;top:24px"></i><i class="rd" style="left:56px;top:38px"></i><i class="rd" style="left:38px;top:56px"></i>') +
      P('tm-chip th-c1', 156, 200, 0, 0, ic('hand') + 'Handballen wird ignoriert') +
      P('tm-chip o0 th-c2', 22, 200, 0, 0, ic('hand') + 'Finger scrollt') +
      '<div class="ab th-px"><div class="th-py"><svg class="th-pencil" viewBox="-6 -134 12 134"><rect x="-4.5" y="-134" width="9" height="120" rx="4.5"/><path class="c" d="M-4.5-14h9L1.2-3h-2.4z"/><path class="n" d="M-1.2-3h2.4L0 0z"/></svg></div></div>' +
      ACT('th-act fg')
  );
}

function artAufgaben(c) {
  const card = (cls, x, y, title, col, fach) =>
    P('col cd ta-card ' + cls, x, y, 80, 44, `<b class="w6">${title}</b><span class="fx">${col ? `<span class="pill" data-c="${col}">${fach}</span>` : `<span class="pl w6 ta-due">${fach}</span>`}</span>`);
  const col = (x, pill, color, n) => P('ta-col', x, 72, 94, 140, `<div class="fx ta-head"><span class="pill" data-c="${color}">${pill}</span><span class="ov z9 c3 ta-n">${n}</span></div>`);
  // Kalender ab dem Montag dieser Woche mit echten Tagen
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const wd = (now.getDay() + 6) % 7;
  const items = { [wd + 2]: ['blue', 'Übungsblatt 2', 1], [wd + 4]: ['purple', 'FizzBuzz', 2], [wd + 6]: ['green', 'Vektorräume', 3], [wd + 9]: ['orange', 'ER-Diagramm', 4] };
  let cells = '';
  for (let i = 0; i < 28; i++) {
    const it = items[i];
    cells += `<div class="col z85 c2 ta-d${i === wd ? ' now' : ''}"><span class="rd">${new Date(now.getTime() + (i - wd) * 864e5).getDate()}</span>${it ? `<span class="pill ta-p${it[2]}" data-c="${it[0]}">${it[1]}</span>` : ''}</div>`;
  }
  const tab = (n, label) => `<span class="fc rl w5 c2 ta-tab">${ic(n)}${label}</span>`;
  return scene(
    P('tm-window', 10, 8, 320, 216) +
      P('w7 nw ta-h', 22, 18, 0, 0, '✅ Aufgaben &amp; Abgaben') +
      P('fx ta-tabs', 22, 38, 0, 0, '<i class="ab pl ta-ind"></i>' + tab('table', 'Alle') + tab('board', 'Board') + tab('calendar', 'Kalender')) +
      P('ta-sep', 10, 64, 320, 0) +
      '<div class="in ta-board">' +
      col(22, 'Offen', 'red', '2') +
      col(124, 'In Arbeit', 'yellow', '<span class="ta-cs">2<br>1</span>') +
      col(226, 'Erledigt', 'green', '<span class="ta-cs">1<br>2</span>') +
      P('o0 ta-drop', 226, 72, 94, 140) +
      card('', 29, 103, 'FizzBuzz &amp; Primzahlen', 'purple', 'Programmieren 1') +
      card('', 29, 153, 'ER-Diagramm', 'orange', 'Datenbanken') +
      card('ta-c4', 131, 153, 'Übungsblatt 1 – Vektorräume', 'green', 'Lineare Algebra') +
      card('ta-c5', 233, 103, 'Übungsblatt 1 – Mengen &amp; Beweise', 'blue', 'Analysis I') +
      card('ta-c3', 131, 103, 'Übungsblatt 2 – Folgen', '', c.dueIn(2)) +
      '</div>' +
      P('o0 ta-cal', 22, 72, 296, 140, `<div class="z8 c3 ta-wd">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span>${d}</span>`).join('')}</div><div class="ta-grid">${cells}</div>`) +
      ACT('ta-act')
  );
}

function artHeute(c) {
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Hallo' : 'Guten Abend';
  const box = (cls, x, col, n, num, label) => P('col cd td-tile ' + cls, x, 56, 98, 64, `<span class="fx td-th">${tile(col, n)}<b class="td-n">${num}</b></span><span class="z85 w6 c2 td-l">${label}</span>`);
  const row = (cls, y, title, sub, due, soon) =>
    `<div class="ab fx td-r ${cls}" style="top:${y}px"><span class="rd rl td-ck"><span class="tm-on rd">${ic('check')}</span></span><span class="col td-m"><b class="el w6">${title}</b><small class="fx nw z85 c2">Aufgaben &amp; Abgaben${sub}</small></span><span class="pl w6 z85 nw td-due${soon ? ' soon' : ''}">${due}</span></div>`;
  return scene(
    P('td-t', 16, 8, 0, 0, 'Heute') +
      P('nw c2', 16, 36, 0, 0, `${greet} · ${fmtDate(todayISO(), 'long')}`) +
      box('td-t1', 16, 'c-orange', 'cards', '12', 'Fällige Karten') +
      box('td-t2', 121, 'c-blue', 'checkbox', '<span class="td-win"><span class="td-s2">5<br>4</span></span>', 'Abgaben (14 Tage)') +
      box('td-t3', 226, 'c-purple', 'quiz', '<span class="td-win"><span class="td-s3">132<br>131<br>130</span></span>', 'Tage bis zur nächsten Prüfung') +
      P('uc z85', 22, 128, 0, 0, 'Anstehend') +
      P(
        'tm-list',
        16,
        142,
        308,
        84,
        row('td-r1', 0, 'Übungsblatt 2 – Folgen', ' <span class="pill" data-c="yellow">In Arbeit</span>', c.dueIn(2), true) +
          '<div class="in td-rest">' +
          row('', 28, 'Programmieraufgabe: FizzBuzz &amp; Primzahlen', '', c.dueIn(4)) +
          row('', 56, 'Übungsblatt 1 – Vektorräume', '', c.dueIn(6)) +
          row('', 84, 'ER-Diagramm für die Bibliothek', '', c.dueIn(9)) +
          '</div>'
      ) +
      '<div class="ab tm-toast td-toast" style="top:196px">„Übungsblatt 2 – Folgen“ erledigt</div>' +
      ACT('td-act')
  );
}

function artLernen() {
  const rb = (i, color, label, sub) => `<div class="col fc cd tl-rb tl-rb${i}"><b class="w7" style="color:var(--${color})">${label}</b><small class="z85 c2">${sub}</small></div>`;
  const opt = (l, v, cls) => `<div class="fx rl tl-o${cls}"><i class="fc rd">${l}</i>${v}${cls ? '' : `<span class="in fx tl-ok"><i class="fc rd">${ic('check')}</i>${v}</span>`}</div>`;
  return scene(
    '<div class="in tl-a">' +
      P('ov tl-prog', 40, 12, 200, 4, '<i class="in"></i>') +
      P('nw z85 c2', 40, 20, 0, 0, TITLE_VL) +
      P(
        'tl-card',
        70,
        32,
        200,
        106,
        '<div class="in tl-in"><div class="in col fc tl-f"><small class="uc">Frage</small><b class="w6">Was besagt das Sandwich-Lemma?</b></div><div class="in col fc tl-f tl-bk"><small class="uc">Antwort</small><span>Liegt cₙ zwischen zwei Folgen mit gleichem Grenzwert L, dann konvergiert auch cₙ gegen L.</span></div></div>'
      ) +
      P('fx tl-rate', 22, 150, 298, 40, rb(1, 'red', 'Nochmal', '&lt; 1 Std.') + rb(2, 'orange', 'Schwer', '1 Tag') + rb(3, 'green', 'Gut', '3 Tage') + rb(4, 'tint', 'Leicht', '9 Tage')) +
      `<div class="ab tm-chip o0 tl-chip" style="top:200px">${ic('clock')}Wieder in 3 Tagen</div>` +
      '</div><div class="in o0 tl-b">' +
      P(
        'cd tl-q',
        14,
        14,
        152,
        204,
        `<div class="fx w7 tl-qh">${tile('c-green', 'quiz')}Quiz: Matrizen</div><p class="w6">Welches Format hat AB, wenn A 2×3 und B 3×4 ist?</p>${opt('A', '3×3', ' tl-oa')}${opt('B', '2×4', '')}${opt('C', '4×2', ' tl-oa')}<div class="z9 tl-ex">Zeilen von A × Spalten von B – also 2×4.</div>`
      ) +
      P(
        'cd tl-t',
        174,
        14,
        152,
        204,
        '<b class="z11">Fokus-Timer</b>' +
          '<svg class="ab tl-dial" viewBox="0 0 96 96" style="left:28px;top:46px"><circle cx="48" cy="48" r="42"/><circle class="p" cx="48" cy="48" r="42" transform="rotate(-90 48 48)"/></svg>' +
          '<div class="ab col tl-clock"><span class="ov tl-win"><span class="tl-ds">25:00<br>24:59<br>24:58<br>24:57</span></span><small class="z85 c2">Fokus · Runde 1</small></div>' +
          `<div class="ab pl wh w6 z95 tl-go"><span class="in fc tl-g1">${ic('play')}Starten</span><span class="in fc o0 tl-g2">${ic('pause')}Pausieren</span></div>`
      ) +
      '</div>' +
      ACT('tl-act')
  );
}

function artClaude(c) {
  const q = (n, label, cls = '') => `<span class="fx rl ov w6 nw tc-q${cls}">${ic(n)}<span class="el">${label}</span>${cls ? '<i class="tm-on"></i>' : ''}</span>`;
  const fc = (i, y, a, b) => `<div class="ab col tc-fc tc-fc${i}" style="top:${y}px"><b class="el w6">${a}</b><span class="nw c2">${b}</span><i class="ab o0 tc-bu">${STAR}${STAR}</i></div>`;
  return scene(
    P(
      'tm-window ov',
      8,
      14,
      176,
      206,
      `<div class="ab el w7 tc-t">${TITLE_VL}</div>` +
        P('tm-line', 12, 32, 124) +
        P('tm-line', 12, 44, 104) +
        P('tm-line', 12, 56, 116) +
        P('tm-line', 12, 68, 80) +
        P('w7 z11 tc-h2', 12, 90, 0, 0, 'Karteikarten') +
        fc(1, 108, 'Wann konvergiert (aₙ)?', '|aₙ − a| &lt; ε ab N') +
        fc(2, 134, 'Sandwich-Lemma?', 'cₙ zwischen aₙ, bₙ → L') +
        fc(3, 160, 'Ist (−1)ⁿ konvergent?', 'Nein, divergent') +
        '<i class="in o0 tc-ring"></i>'
    ) +
      P(
        'tm-glass tc-panel',
        150,
        6,
        182,
        220,
        `<div class="ab fx w7 z12 tc-head"><span class="fc rd wh tc-logo">${ic('sparkle')}</span>Claude</div>` +
          '<div class="ab tm-seg z85 tc-seg"><b>Diese Seite</b><span>Alle Notizen</span></div>' +
          `<div class="ab tc-grid">${q('list', 'Zusammenfassen')}${q('cards', 'Karteikarten', ' tc-qk')}${q('quiz', 'Quiz')}${q('info', 'Einfach erklären')}${q('calendar', 'Lernplan')}${q('type', 'Glossar')}</div>` +
          '<div class="ab z85 wh tc-ub">Erstelle Karteikarten aus dieser Seite.</div>' +
          `<div class="ab z85 tc-ab"><span class="ab o0 tc-ab1"><i class="rd tc-spin"></i>Karteikarten werden erstellt&nbsp;…</span><span class="tc-ab2">${ic('check')}Fertig – die Karteikarten stehen unten auf der Seite.</span></div>`
      ) +
      (c.ai ? '' : P('tm-chip tc-na', 14, 202, 0, 0, ic('sparkle') + 'Nur in der Claude-Version')) +
      ACT('tc-act')
  );
}

function artFinden(c) {
  const r = (y, icon, label, cls = '') => `<div class="ab fx ov nw ts-r${cls}" style="top:${y}px">${icon}<span>${label}</span></div>`;
  const sr = (y, icon, title, sub = '') => `<div class="ab fx w6 nw ts-row" style="top:${y}px">${icon}<span class="col ts-rm">${title}${sub}</span></div>`;
  return scene(
    P(
      'cd ov ts-sb',
      10,
      8,
      178,
      216,
      `<div class="ab fx w7 ts-head"><span class="ov ts-logo">${iconSvg({ id: 'tourIc2', rounded: true })}</span>${APP_NAME}</div>` +
        `<div class="ab fx z95 c2 ts-sf">${ic('search')}<span>Suchen</span><kbd class="tm-kbd-only">${c.mod}K</kbd></div>` +
        P('uc z7', 12, 62, 0, 0, 'Favoriten') +
        r(72, '👋', 'Willkommen bei Notes', ' ts-fr') +
        r(88, '🎯', 'Prüfungsplan', ' ts-fr') +
        r(104, '📐', 'Analysis I', ' ts-fr ts-fav') +
        '<div class="ab ts-seiten">' +
        P('uc z7', 12, 110, 0, 0, 'Seiten') +
        r(120, `<span class="ts-chev">${ic('chevronRight')}</span>🎓`, 'Wintersemester 2026/27', ' ts-fr') +
        r(136, '<i class="ts-al"></i>📐', 'Analysis I', ' ts-fr ts-kid ts-k1') +
        r(152, '💻', 'Programmieren 1 (Java)', ' ts-fr ts-kid ts-k2') +
        r(168, '📊', 'Statistik', ' ts-fr ts-kid ts-k2') +
        '</div>'
    ) +
      P(
        'tm-window ts-pg',
        196,
        8,
        134,
        216,
        `<div class="ab fx pl tm-glass ts-cap"><span class="fx rl ts-star">${ic('star')}<span class="tm-on">${ic('starFill')}</span></span><span class="fx ts-spk">${ic('sparkle')}</span>${ic('more')}</div>` +
          '<div class="ab ts-cA"><b class="el w7">👋 Willkommen bei Notes</b><i class="tm-line" style="width:100px"></i><i class="tm-line" style="width:80px"></i></div>' +
          `<div class="ab ts-cB"><b class="el w7">📐 Analysis I</b><span class="fx ov nw ts-link">${ic('pageText')}VL 03 – Folgen und Grenzwerte</span><i class="tm-line" style="width:96px;margin-top:10px"></i><i class="tm-line" style="width:70px;margin-top:6px"></i></div>`
      ) +
      P('o0 ts-dim', 10, 8, 320, 216) +
      P(
        'tm-glass o0 ts-sheet',
        18,
        14,
        304,
        204,
        `<div class="ab fx ts-field">${ic('search')}${T('Sandwich')}<span class="ab nw c3 o0 ts-ph">Seiten, Notizen, Aufgaben durchsuchen</span></div><span class="ab ts-cancel">Abbrechen</span>` +
          P('uc z7 ts-hit', 14, 42, 0, 0, '1 Treffer') +
          sr(54, '📈', 'VL 03 – Folgen und Grenzwerte', '<small class="c2">… <mark>Sandwich</mark>-Lemma: Gilt aₙ ≤ cₙ ≤ bₙ …</small>')
      ) +
      ACT('ts-act')
  );
}

function artSync() {
  const sq = (wipe) =>
    `<span class="rl ov ty-sw"><svg viewBox="0 0 120 30"><path d="M3 21c8-18 16-18 20-2s12 10 18-4 14-10 20 2 12 12 20-2 14-8 20 0 9 6 15 1"/></svg>${wipe ? '<i class="in ty-w"></i>' : ''}</span>`;
  const bars = (a, b, d) => `<i class="tm-line" style="width:${a}%"></i><i class="tm-line" style="width:${b}%"></i><i class="tm-line" style="width:${d}%"></i>`;
  return scene(
    P('ty-dev ty-pad', 14, 34, 186, 136, `<div class="ab col ov ty-scr"><b class="el w7">📈 VL 03 – Folgen</b>${bars(82, 64, 74)}${sq(true)}<span class="z8 c2 ty-ln">Sandwich-Lemma ✓</span></div>`) +
      P('ty-dev ty-ph', 262, 62, 64, 134, `<i class="ab ty-isl"></i><div class="ab col ov ty-scr"><b class="el w7">📈 VL 03</b>${bars(90, 70, 80)}${sq(false)}${T('Sandwich-Lemma')}</div>`) +
      P('ty-cl', 206, 16, 44, 44, `<span class="in fc ty-on">${ic('cloud')}</span><span class="in fc o0 c3 ty-off">${ic('cloudOff')}</span>`) +
      `<div class="ab fc o0 wh ty-p">${ic('pageText')}</div>` +
      '<div class="ab ty-s"><span class="tm-chip ty-s1"><i class="rd"></i>Gespeichert</span><span class="tm-chip o0 ty-s2"><i class="rd"></i>Offline – wird später gespeichert</span></div>'
  );
}

function artFertig() {
  const COL = ['tint', 'pink', 'orange', 'green', 'yellow', 'teal'];
  let conf = '';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.35;
    const r = 60 + (i % 3) * 25;
    conf += `<i class="${i % 2 ? 'd' : ''}" style="--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r * 0.6 + 14)}px;--r:${(i * 97) % 360}deg;background:var(--${COL[i % 6]})"></i>`;
  }
  const row = (n, label, cls = '') => `<div class="fx rl tz-r${cls}">${tile('c-gray', n)}<span>${label}</span></div>`;
  return (
    P('tz-cf', 170, 54, 0, 0, conf) +
    P('ov tz-ic', 142, 24, 56, 56, iconSvg({ id: 'tourIc3', rounded: true })) +
    P('fc rd wh tz-bd', 186, 64, 20, 20, ic('check')) +
    P('tm-list tz-list', 70, 102, 200, 98, row('trash', 'Papierkorb') + row('help', 'Hilfe', ' tz-hl') + row('settings', 'Einstellungen')) +
    P('tm-kbd-only col tz-key', 280, 136, 38, 0, '<span class="fc rl w7 tz-cap">?</span><small class="z8 c2 nw">oder Taste</small>')
  );
}

// --- Zeitleisten der Beispiele ------------------------------------------------------------------
// Kompakt notiert und beim ersten Öffnen zu CSS-Keyframes (t-<schritt>-<n>) übersetzt.
// Schreibweise: „8:o1 n;9,38:o0 tx7“ = 0 % bis 8 %: opacity 1, transform none; 9 % bis 100 %: …
// (fehlen 0 % bzw. 100 %, gehören sie zum ersten bzw. letzten Block)
// o = opacity, n = none, tx/ty/t = translate (px), s/sx = scale, r/ry/k = rotate/rotateY/skewX (deg),
// E = ganz aufgedeckt (Tippen), X = draußen unten rechts (Finger/Zeiger), ~ = Zeitfunktion bis zum nächsten Schritt.
const TF = { s: 'var(--spring)', l: 'linear', b: 'cubic-bezier(.3,0,.2,1)', f: 'cubic-bezier(.34,1.3,.64,1)' };
const TR = { tx: 'translateX(#px)', ty: 'translateY(#px)', t: 'translate(#px)', s: 'scale(#)', sx: 'scaleX(#)', r: 'rotate(#deg)', ry: 'rotateY(#deg)', k: 'skewX(#deg)' };
const F = (a, b, x = 0, y = 1) => `${a}:o${x};${b}:o${y}`; // Überblenden
const K = (a, b, n) => `${a}:n ~${n};${b}:E`; // Tippen mit n Zeichen
const U = (a, b, from, tf = '~s') => `${a}:o0 ${from} ${tf};${b}:o1 n`; // Erscheinen
const B = (a) => `${a}:o0 s0 r0;${a + 2.5}:o1 s1.1 r22;${a + 5}:o0 s0 r45`; // Funkeln
const TOAST = (a, b, c, d) => `${a}:o0 ty12;${b},${c}:o1 n;${d}:o0 n`;
// Finger/Zeiger: Weg, Druck beim Tippen (Skalierung) und Ring
function actor(sel, path, taps, press) {
  const tap = press || `${taps.map((x) => `${x - 2},${x + 2}`).join(',')},100:n;${taps.join(',')}:s.82`;
  let rip = `${taps[0] - 0.1}:o0 s.5`;
  taps.forEach((x, i) => (rip += `;${x}:o.45 s.5;${x + 5}${i < taps.length - 1 ? ',' + (taps[i + 1] - 0.1) : ''}:o0 s1.7`));
  return [[sel, path], [sel + ' .tf-i', tap], [sel + '::after', rip]];
}
const ANIM = {
  schreiben: [
    ['.tw-car', '49:o1;50:o0', 'animation-duration:1s'],
    ['.tw-cw', '8:o1 n;9,38:o1 tx7;42:o0 tx7'],
    ['.tw-sl', '8:o0;9,36:o1;40:o0'],
    ['.tw-menu', '10:o0 s.92 ~s;16,36:o1 n;40:o0 s.97'],
    ['.tw-hi', '22:n;28:ty52'],
    ['.tw-r3', '30,34,100:n;32:s.97'],
    ['.tw-cb', '38:o0 s.5 ~s;42,68:o1 n;70:o1 s.88;72:o1 n'],
    ['.tw-cb .tm-on', F(70, 73)],
    ['.tw-cb .ico', '70:s.4 ~s;73:n'],
    ['.tw-tx .tm-cover', K(44, 62, 21)],
    ['.tw-st', '72:sx0;78:n'],
    ['.tw-tx', F(72, 78, 1, 0.5)],
    ...actor('.tw-act', '16:X;19:o1;30,38:o1 t160,210;47:o1;50,60:X;63:o1;68,74:o1 t35,119;83:o1;86:X', [32, 70]),
  ],
  kuerzel: [
    ['.tk-key', F(88, 92, 1, 0)],
    ['.tk-l1', '2:o0;4,20:o1;22:o0'],
    ['.tk-l2', '24:o0;26,42:o1;44:o0'],
    ['.tk-l3', '46:o0;48,64:o1;66:o0'],
    ['.tk-l4', '68:o0;70,86:o1;88:o0'],
    ['.tk-ra', F(8, 10, 1, 0)],
    ['.tk-ra .tm-cover', K(2, 6, 2)],
    ['.tk-ha .tm-cover', K(10, 20, 10)],
    ['.tk-rb', F(28, 30, 1, 0)],
    ['.tk-rb .tm-cover', K(24, 27, 2)],
    ['.tk-b1', U(28, 30, 's0')],
    ['.tk-tb .tm-cover', K(30, 42, 24)],
    ['.tk-b2', U(44, 46, 's0')],
    ['.tk-pre', F(44, 46)],
    ['.tk-rc', F(60, 63, 1, 0)],
    ['.tk-rc .tm-cover', K(46, 58, 13)],
    ['.tk-bd', U(60, 63, 'tx8', '')],
    ['.tk-rd', F(72, 74, 1, 0)],
    ['.tk-rd .tm-cover', K(68, 71, 3)],
    ['.tk-cb', U(72, 74, 's0')],
    ['.tk-td .tm-cover', K(74, 86, 22)],
  ],
  formeln: [
    ['.tx-src', '28:o1 n;32:o0 ty-4'],
    ['.tx-src .tm-cover', K(4, 24, 34)],
    ['.tx-f', U(28, 32, 's.92')],
    ['.tx-sh', '31:o0 tx-60 k-20 ~l;35:o.9;40:o0 tx340 k-20'],
    ['.tx-l1', U(38, 41, 'tx-4', '')],
    ['.tx-l2', U(42, 45, 'tx-4', '')],
    ['.tx-l3', U(46, 49, 'tx-4', '')],
    ['.tx-l4', U(50, 53, 'tx-4', '')],
  ],
  handschrift: [
    ['.th-px', '2:o0 tx118;10:o1 tx58 ~l;34:tx238;40:tx258;46,48:tx58;52:tx164 ~l;62:o1 tx260;68:o0 tx340'],
    ['.th-py', '2:ty76;10:ty126;12.4:ty96;17.2:ty148;22:ty111;26.8:ty135;31.6:ty121;34:ty126;40:ty112;46:ty27;47:ty29;48:ty27;52,62:ty126;68:ty66', 'animation-timing-function:ease-in-out'],
    ['.th-wipe', '10:n ~l;34:tx184'],
    ['.th-hl', '52:sx0 ~l;62:n'],
    ['.th-palm', '2:o0 t10,14;10,66:o1 n;70:o0 t6,10'],
    ['.th-c1', '12:o0 s.9 ~s;15,62:o1 n;66:o0 n'],
    ['.th-c2', '74:o0 s.9 ~s;77,85:o1 n;88:o0 n'],
    ['.th-tp .tm-on', F(47, 49, 1, 0)],
    ['.th-th .tm-on', F(47, 49)],
    ['.th-pc', '72:n ~b;82:ty-30'],
    ['.th-act', '70:o0 t150,206;72:o1 t150,206 ~b;82:o1 t150,160;86:o0 t150,160'],
  ],
  aufgaben: [
    ['.ta-c3', '20:tx0 s1 r0 ~s;22:tx0 s1.05 r-2;40:tx102 s1.05 r-2 ~s;44:tx102 s1 r0'],
    ['.ta-c3::before', '20:o0;22,40:o1;44:o0'],
    ['.ta-c4', '26:n;32:ty-50'],
    ['.ta-c5', '30:n;36:ty50'],
    ['.ta-drop', '30:o0;36,42:o1;46:o0'],
    ['.ta-cs', '42:n ~s;46:ty-11'],
    ['.ta-ind', '58:n ~s;62:tx68'],
    ['.ta-board', '60:o1 n;64:o0 s.98'],
    ['.ta-cal', '60:o0 s.98;64:o1 n'],
    ['.ta-p1', U(66, 69, 's.8')],
    ['.ta-p2', U(69, 72, 's.8')],
    ['.ta-p3', U(72, 75, 's.8')],
    ['.ta-p4', U(75, 78, 's.8')],
    // langes Drücken, Ziehen, dann Tipp auf „Kalender“
    ...actor('.ta-act', '4:X;7:o1;14,22:o1 t170,118;40,46:t272,118;56,60:o1 t190,49;71:o1;74:X', [58], '16,42,56,60,100:n;18,40:s.88;58:s.82'),
  ],
  heute: [
    ['.td-t1', '0:o0 ty6;4:o1 n'],
    ['.td-t2', '3:o0 ty6;7:o1 n'],
    ['.td-t3', '6:o0 ty6;10:o1 n'],
    ['.td-s2', '48:n ~s;52:ty-22'],
    ['.td-s3', '14:n ~s;16,24:ty-22 ~s;26:ty-44'],
    ['.td-r1', '46:o1 n;54:o0 tx-30'],
    ['.td-r1 .tm-on', U(40, 44, 's.6')],
    ['.td-rest', '48:n;56:ty-28'],
    ['.td-toast', TOAST(50, 54, 74, 78)],
    ...actor('.td-act', '30:X;33:o1;38,44:o1 t31,156;53:o1;56:X', [40]),
  ],
  lernen: [
    ['.tl-a', F(54, 58, 1, 0)],
    ['.tl-b', F(58, 62)],
    ['.tl-prog i', '44:sx.3;48:sx.4'],
    ['.tl-card', '0:o0 ty8;5,12:o1 n;14:s.97;16,42:o1 n;50:o0 tx-80 r-8'],
    ['.tl-in', '14:n ~f;24:ry180'],
    ['.tl-rb1', '24:o0 ty6;27,44:o1 n;48:o0 n'],
    ['.tl-rb2', '25.5:o0 ty6;28.5,44:o1 n;48:o0 n'],
    ['.tl-rb3', '27:o0 ty6;30,36:o1 n;38:s.94;40,44:o1 n;48:o0 n'],
    ['.tl-rb4', '28.5:o0 ty6;31.5,44:o1 n;48:o0 n'],
    ['.tl-chip', U(40, 43, 's.9')],
    ['.tl-ok', F(68, 72)],
    ['.tl-oa', F(68, 72, 1, 0.45)],
    ['.tl-ex', F(72, 76)],
    ['.tl-ds', '83.9:n;84,87.9:ty-24;88,91.9:ty-48;92:ty-72'],
    ['.tl-dial', '84,88,92,100:n;86,90:s1.02'],
    ['.tl-go', '80,84,100:n;82:s.94'],
    ['.tl-g1', F(82, 84, 1, 0)],
    ['.tl-g2', F(82, 84)],
    ...actor('.tl-act', '6:X;8:o1;12,30:o1 t170,84;36,40:t208,170;48:o1;50,62:X;64:o1;66,74:o1 t90,131;80,84:t250,196;90:o1;92:X', [14, 38, 68, 82]),
  ],
  claude: [
    ['.tc-panel', '0:o0 tx24;8:o1 n'],
    ['.tc-q .tm-on', F(16, 18)],
    ['.tc-ub', U(20, 24, 's.9')],
    ['.tc-ab', '26:o0 ty4;30:o1 n'],
    ['.tc-ab1', F(56, 60, 1, 0)],
    ['.tc-ab2', F(56, 60)],
    ['.tc-spin', '0:n;100:r360', 'animation-duration:.8s;animation-timing-function:linear'],
    ['.tc-ring', '32:o0;36,58:o1;62:o0'],
    ['.tc-h2', F(34, 37)],
    ['.tc-fc1', U(38, 41, 'tx-8', '')],
    ['.tc-fc2', U(44, 47, 'tx-8', '')],
    ['.tc-fc3', U(50, 53, 'tx-8', '')],
    ['.tc-fc1 .tc-bu', B(40)],
    ['.tc-fc2 .tc-bu', B(46)],
    ['.tc-fc3 .tc-bu', B(52)],
    ...actor('.tc-act', '8:X;10:o1;14,18:o1 t282,77;27:o1;30:X', [16]),
  ],
  finden: [
    ['.ts-chev', '12:n;16:r90'],
    ['.ts-k1', U(14, 17, 'ty-4', '')],
    ['.ts-k2', U(16, 19, 'ty-4', '')],
    ['.ts-al', F(28, 30)],
    ['.ts-cA', F(28, 32, 1, 0)],
    ['.ts-cB', F(28, 32)],
    ['.ts-star .tm-on', U(40, 43, 's1.35')],
    ['.ts-seiten', '42:n;48:ty18'],
    ['.ts-fav', U(44, 48, 'ty-4', '')],
    ['.ts-dim', F(58, 62)],
    ['.ts-sheet', U(58, 62, 'ty-8')],
    ['.ts-ph', '62:o1;62.5:o0'],
    ['.ts-field .tm-cover', K(62, 72, 8)],
    ['.ts-hit', F(72, 75)],
    ['.ts-row', U(72, 76, 'ty-4', '')],
    ...actor('.ts-act', '4:X;6:o1;10,20:o1 t22,136;26,32:t70,152;38,50:t272,26;56,60:o1 t60,48;66:o1;68:X', [12, 28, 40, 58]),
  ],
  sync: [
    ['.ty-dev', '3:o0 ty10;8:o1 n'],
    ['.ty-pad .ty-w', '8:n ~l;18:E'],
    ['.ty-ln', F(86, 90)],
    ['.ty-ph .ty-sw', F(40, 44)],
    ['.ty-ph .tm-cover', K(58, 68, 14)],
    ['.ty-cl', '26,30,50,54,74,78,100:n;28:s1.12;52,76:s.95'],
    ['.ty-on', '50:o1;54,74:o0;78:o1'],
    ['.ty-off', '50:o0;54,74:o1;78:o0'],
    ['.ty-p', '20:o0 t190,60;21:o1;26,30:t228,40;36:o1;38,78:o0 t292,92;79:o1;82:t228,40;85:o1;86:o0 t190,60'],
    ['.ty-s', U(40, 44, 's.9')],
    ['.ty-s1', '52:o1;56,76:o0;80:o1'],
    ['.ty-s2', '52:o0;56,76:o1;80:o0'],
    ['.ty-s2 i', '56,66,76,100:o1;61,71:o.35'],
  ],
};

function frames(spec) {
  const blocks = spec.split(';');
  const all = blocks.map((b) => b.split(':')[0].split(',')).flat();
  return blocks
    .map((blk, bi) => {
      const [at, decl] = blk.split(':');
      const pts = at.split(',');
      if (bi === 0 && !all.includes('0')) pts.unshift('0');
      if (bi === blocks.length - 1 && !all.includes('100')) pts.push('100');
      const out = [];
      const tr = [];
      for (const x of decl.split(' ')) {
        if (!x) continue;
        if (x[0] === 'o') out.push('opacity:' + x.slice(1));
        else if (x[0] === '~') out.push('animation-timing-function:' + (TF[x.slice(1)] || `steps(${x.slice(1)},end)`));
        else if (x === 'X') {
          out.push('opacity:0');
          tr.push('translate(360px,250px)');
        } else if (x === 'E') tr.push('translateX(calc(100% + 3px))');
        else if (x === 'n') tr.push('none');
        else {
          const m = /^([a-z]+)(.+)$/.exec(x);
          tr.push(TR[m[1]].replace('#', m[2].replace(',', 'px,')));
        }
      }
      if (tr.length) out.push('transform:' + tr.join(' '));
      return pts.map((p) => p + '%').join(',') + '{' + out.join(';') + '}';
    })
    .join('');
}

let animCss = null;
function ensureAnimCss() {
  if (animCss && animCss.isConnected) return;
  let css = '';
  for (const [step, list] of Object.entries(ANIM)) {
    list.forEach(([sel, spec, extra], i) => {
      const name = `t-${step}-${i}`;
      css += `.tour-art[data-step=${step}].is-playing ${sel}{animation-name:${name}${extra ? ';' + extra : ''}}@keyframes ${name}{${frames(spec)}}`;
    });
  }
  animCss = h('style', { id: 'tour-anim', text: css });
  document.head.appendChild(animCss);
}

// --- Schritte: ein Dienstag im Semester -------------------------------------------------------
// Texte dürfen <kbd> enthalten (nur eigene Konstanten, daher innerHTML).
const STEPS = [
  {
    id: 'willkommen',
    eyebrow: 'Ein Dienstag im Semester',
    title: `Willkommen bei ${APP_NAME}`,
    text: 'Mitschreiben, skizzieren, Abgaben planen und für Prüfungen lernen – alles an einem Ort statt in fünf Apps. Komm mit durch einen typischen Unitag und sieh, wobei dir die einzelnen Funktionen helfen.',
    tip: (c) => (c.touch ? 'Wische nach links oder tippe auf „Weiter“. Mit „Überspringen“ kannst du jederzeit aufhören.' : `Mit ${k('←')} und ${k('→')} blätterst du, ${k('Esc')} beendet die Anleitung.`),
    art: artWillkommen,
  },
  {
    id: 'schreiben',
    loop: 7.5,
    eyebrow: '10:30 · Vorlesung Analysis',
    title: 'Mitschreiben mit Blöcken',
    text: `Jede Zeile ist ein Block. Tippe ${k('/')} in eine leere Zeile und wähle, was du gerade brauchst – Überschrift, To-do, Tabelle, Bild, Formel, Handschrift oder Karteikarten. So ist deine Mitschrift schon im Hörsaal gegliedert, und das Abtippen am Abend fällt weg.`,
    tip: (c) => (c.touch ? 'Auch das ＋ in der Leiste über der Tastatur öffnet alle Blöcke.' : `Tipp nach dem ${k('/')} einfach weiter, z. B. ${k('/todo')}, und übernimm mit ${k('Enter')}. Am Griff ⋮⋮ ziehst du Blöcke an eine neue Stelle.`),
    action: (c) => ({
      label: 'Übungsseite anlegen',
      icon: I.plus,
      run: () => {
        const p = c.app.createPage({ title: 'Meine erste Notiz', icon: '✏️' }, { navigate: false });
        c.app.navigate(p.id);
        if (c.app.editor && p.blocks[0]) c.app.editor.focusBlock(p.blocks[0].id, 0);
      },
    }),
    art: artSchreiben,
  },
  {
    id: 'kuerzel',
    acc: 'blue',
    loop: 9,
    eyebrow: '10:45 · Die Dozentin wird schneller',
    title: 'Formatieren im Tippfluss',
    text: `Kürzel formatieren schon beim Tippen: ${k('# ')} wird zur Überschrift, ${k('- ')} zur Liste, ${k('[] ')} zum To-do und ${k('**fett**')} wird fett. Deine Hände bleiben auf der Tastatur – und dein Kopf bei der Vorlesung.`,
    tip: (c) =>
      c.touch
        ? 'Über der Tastatur hast du Fett, Kursiv, Farbe, Formel, Einrücken und Verschieben immer griffbereit.'
        : `Außerdem: ${k('1. ')} Nummern, ${k('> ')} Toggle, ${k('---')} Trennlinie, ${k('*kursiv*')} und ${k('`Code`')}. ${k('Tab')} rückt ein, ${k(c.mod + 'Z')} macht rückgängig.`,
    action: (c) => c.has('seed-start') && { label: 'Alle Kürzel ansehen', icon: I.arrowUpRight, run: () => c.app.navigate('seed-start') },
    art: artKuerzel,
  },
  {
    id: 'formeln',
    acc: 'yellow',
    loop: 8.5,
    eyebrow: '11:15 · Die Tafel ist voller Formeln',
    title: 'Formeln und Code wie gedruckt',
    text: `Schreib LaTeX zwischen ${k('$…$')} mitten in den Satz oder starte mit ${k('$$ ')} einen Formelblock – ${APP_NAME} setzt die Formel sofort wie im Skript. Drei Backticks ${k('```')} starten einen Codeblock mit Syntaxfarben, etwa für Java, Python oder SQL.`,
    tip: (c) => `${c.touch ? 'Tippe' : 'Klicke'} auf eine Formel, um sie zu bearbeiten. Unter ${k('/')} findest du außerdem Tabellen und ein automatisches Inhaltsverzeichnis.`,
    action: (c) =>
      c.has('seed-ana-vl3')
        ? { label: 'Mathe-Vorlesung ansehen', icon: I.arrowUpRight, run: () => c.app.navigate('seed-ana-vl3') }
        : c.has('seed-prog-vl2') && { label: 'Java-Beispiel ansehen', icon: I.arrowUpRight, run: () => c.app.navigate('seed-prog-vl2') },
    art: artFormeln,
  },
  {
    id: 'handschrift',
    acc: 'purple',
    loop: 9,
    eyebrow: '11:50 · Skizze von der Tafel',
    title: 'Handschrift mit dem Apple Pencil',
    text: 'Graphen, Pfeile und Herleitungen skizzierst du direkt in die Notiz – mit Druckstufen, Textmarker und Radierer auf liniertem, kariertem oder gepunktetem Papier. Deine Hand darf aufliegen: Nur der Stift schreibt, der Finger scrollt, und das Blatt wächst von selbst mit.',
    tip: (c) =>
      c.touch
        ? 'Kein Stift zur Hand? Tippe in der Werkzeugleiste auf ✋, dann zeichnet auch der Finger. Dauerhaft stellst du das unter Einstellungen → „Nur Stift zeichnet“ ein.'
        : `Am Computer zeichnest du mit Maus oder Grafiktablett, „Vollbild“ gibt dir die ganze Fläche. Neue Handschrift fügst du mit ${k('/handschrift')} ein.`,
    action: (c) => c.has('seed-handschrift') && { label: 'Beispiel ansehen', icon: I.arrowUpRight, run: () => c.app.navigate('seed-handschrift') },
    art: artHandschrift,
  },
  {
    id: 'aufgaben',
    acc: 'green',
    loop: 9.5,
    eyebrow: '12:15 · Neues Übungsblatt',
    title: 'Aufgaben und Abgaben im Griff',
    text: 'In einer Datenbank bekommt jedes Übungsblatt Fach, Status und Fälligkeit. Ist etwas fertig, ziehst du die Karte im Board nach „Erledigt“ – dieselben Einträge siehst du auch als Tabelle, Kalender, Liste oder Galerie. So rutscht dir keine Abgabe mehr durch.',
    tip: (c) =>
      c.touch
        ? 'Karte kurz gedrückt halten, dann ziehen. Filter, Sortierung und Suche gibt es in jeder Ansicht.'
        : `Filter, Sortierung und Suche gibt es in jeder Ansicht. Eine neue Datenbank legst du mit ${k('/datenbank')} oder der Vorlage „Aufgaben-Tracker“ an.`,
    action: (c) =>
      c.has('seed-aufgaben') && {
        label: 'Beispiel ansehen',
        icon: I.arrowUpRight,
        run: () => {
          // gleich mit der Board-Ansicht öffnen
          const db = c.app.pages.get('seed-aufgaben');
          const v = db.db && (db.db.views || []).find((x) => x.type === 'board');
          if (v && db.db.activeView !== v.id) {
            db.db.activeView = v.id;
            c.app.touch(db);
          }
          c.app.navigate('seed-aufgaben');
        },
      },
    art: artAufgaben,
  },
  {
    id: 'heute',
    acc: 'red',
    loop: 8,
    eyebrow: '12:40 · Mensa – was steht an?',
    title: 'Heute: dein Tag auf einen Blick',
    text: '„Heute“ sammelt die Abgaben aus all deinen Datenbanken, zeigt fällige Karteikarten und zählt die Tage bis zur nächsten Prüfung. Erledigtes hakst du direkt hier ab, ohne jede Seite einzeln zu öffnen.',
    tip: (c) => (c.narrow ? 'Du findest „Heute“ unten in der Tab-Leiste. ' : '') + 'Den Countdown bekommen Datenbanken mit „Prüfung“ oder „Klausur“ im Namen – etwa ein „Prüfungsplan“.',
    action: (c) => ({ label: 'Heute öffnen', icon: I.calendar, run: () => c.app.goView('heute') }),
    art: artHeute,
  },
  {
    id: 'lernen',
    acc: 'orange',
    loop: 10,
    eyebrow: '16:00 · Lerngruppe in der Bibliothek',
    title: 'Lernen, das hängen bleibt',
    text: 'Karteikarten kommen genau dann wieder, wenn du sie sonst vergessen würdest: „Gut“ schiebt eine Karte ein paar Tage nach hinten, „Nochmal“ holt sie gleich zurück. Im Quiz prüfst du dich vor der Klausur, und der Fokus-Timer hält dich 25 Minuten am Stück bei der Sache.',
    tip: (c) =>
      (c.touch ? 'Tippe auf die Karte, um sie umzudrehen.' : `In der Lernrunde dreht die ${k('Leertaste')} die Karte um, ${k('1')}–${k('4')} bewerten sie.`) +
      ` Neue Karten legst du mit ${k('/karteikarten')} an, Testfragen mit ${k('/quiz')}.`,
    action: (c) => ({ label: 'Lernen öffnen', icon: I.cards, run: () => c.app.goView('lernen') }),
    art: artLernen,
  },
  {
    id: 'claude',
    acc: 'pink',
    loop: 9.5,
    eyebrow: '19:30 · Zu Hause wiederholen',
    title: 'Claude als Lernpartner',
    text: 'Claude fasst deine Vorlesung zusammen, macht daraus Karteikarten, Quiz oder Prüfungsfragen, erklärt Schwieriges einfacher und plant deinen Lernstoff. Aus Handschrift und Fotos von Tafel oder Folie werden saubere Notizen – und du kannst Fragen an alle deine Notizen stellen.',
    chip: (c) => (c.ai ? { on: true, text: 'In dieser Version verfügbar' } : { on: false, text: `Nur in der Claude-Version von ${APP_NAME}` }),
    tip: (c) =>
      c.ai
        ? `${c.touch ? 'Tippe oben rechts auf ✨' : `Klick oben rechts auf ✨, drück ${k(c.mod + 'J')}`} oder schreib ${k('/ki')} in eine leere Zeile – dann schreibt Claude direkt an dieser Stelle.`
        : `Alles andere in ${APP_NAME} funktioniert auch ohne Claude.`,
    action: (c) =>
      c.ai
        ? { label: 'Claude ausprobieren', icon: I.sparkle, run: () => c.app.ai.openPanel({ workspace: true }) }
        : c.app.config.artifactUrl && { label: 'In Claude öffnen', icon: I.arrowUpRight, href: c.app.config.artifactUrl },
    art: artClaude,
  },
  {
    id: 'finden',
    acc: 'blue',
    loop: 10,
    eyebrow: '21:00 · Wo stand das nochmal?',
    title: 'Alles in Sekunden wiederfinden',
    text: 'Ordne Seiten wie Ordner – Semester, Fach, Vorlesung – und zieh sie im Seitenbaum an ihren Platz. Was du oft brauchst, markierst du mit ☆ als Favorit, und die Suche findet jedes Wort in deinen Notizen und Aufgaben.',
    tip: (c) =>
      (!c.touch ? `${k(c.mod + 'K')} öffnet die Suche von überall` : c.narrow ? 'Die Lupe neben der Tab-Leiste öffnet die Suche' : 'Die Suche sitzt oben in der Seitenleiste') +
      `, ${k('@')} verlinkt Seiten untereinander.`,
    action: (c) => ({ label: 'Suche ausprobieren', icon: I.search, run: () => openSearch(c.app) }),
    art: artFinden,
  },
  {
    id: 'sync',
    loop: 10,
    eyebrow: '22:30 · Auf dem Sofa, am iPhone',
    title: 'Auf allen Geräten – auch offline',
    text: `Was du in der Vorlesung auf dem iPad mitschreibst, ist abends auf iPhone und Computer da – ${APP_NAME} gleicht alles automatisch ab. Kein WLAN im Hörsaal? Schreib einfach weiter, gespeichert wird, sobald du wieder online bist.`,
    tip: (c) =>
      c.localOnly
        ? `Gerade speichert ${APP_NAME} nur in diesem Browser. Eine Sicherung legst du unter Einstellungen → „Sicherung exportieren (JSON)“ an.`
        : c.install
          ? 'Als App mit eigenem Symbol: ' + escapeHtml(installHint())
          : `Ob alles gespeichert ist, siehst du unten in der ${c.narrow ? 'Notizen-Übersicht' : 'Seitenleiste'}.`,
    action: (c) => c.install && c.prompt && { label: 'Als App installieren', icon: I.download, run: () => promptInstall() },
    art: artSync,
  },
  {
    id: 'fertig',
    acc: 'green',
    eyebrow: '23:00 · Feierabend',
    title: 'Bereit fürs Semester',
    text: (c) =>
      c.has('seed-start')
        ? 'Die Testnotizen kannst du behalten, umbauen oder löschen – oder du startest gleich mit einer eigenen Seite oder einer Vorlage wie „Vorlesungsnotiz“ oder „Cornell-Notizen“.'
        : 'Leg jetzt deine erste eigene Seite an – oder starte mit einer Vorlage wie „Vorlesungsnotiz“ oder „Cornell-Notizen“.',
    tip: (c) =>
      !c.touch
        ? `Diese Anleitung findest du jederzeit unter „Hilfe“ in der Seitenleiste, in den Einstellungen oder mit der Taste ${k('?')}.`
        : `Diese Anleitung findest du jederzeit unter „Hilfe“ in der ${c.narrow ? 'Notizen-Übersicht' : 'Seitenleiste'} und in den Einstellungen.`,
    action: (c) => c.has('seed-start') && { label: 'Willkommensseite öffnen', icon: I.arrowUpRight, run: () => c.app.navigate('seed-start') },
    art: artFertig,
  },
];

function context(app) {
  const b = document.body.classList;
  return {
    app,
    touch: b.contains('is-touch'),
    narrow: b.contains('is-narrow') || isNarrow(),
    mod: navigator.platform.includes('Mac') ? '⌘' : 'Strg+',
    ai: !!(app.ai && app.ai.available),
    install: canInstall(app),
    prompt: hasInstallPrompt(),
    localOnly: !!app.store && app.store.kind === 'local',
    // Seite vorhanden und nicht (auch nicht über eine Elternseite) im Papierkorb?
    has: (id) => {
      const p = app.pages.get(id);
      return !!p && !app.isTrashedDeep(p);
    },
    dueIn: (n) => relDay(toISODate(new Date(Date.now() + n * 864e5))),
  };
}

const val = (v, c) => (typeof v === 'function' ? v(c) : v);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Öffnet die Anleitung. opts.step: Index oder id des Startschritts.
 * Rückgabe: { el, close(), go(i) } – ist sie schon offen, wird nur fokussiert bzw. geblättert.
 */
export function openTour(app, opts = {}) {
  const want = typeof opts.step === 'string' ? STEPS.findIndex((s) => s.id === opts.step) : opts.step;
  if (current) {
    if (want != null && want >= 0) current.go(want);
    current.el.querySelector('.tour-next')?.focus({ preventScroll: true });
    return current;
  }
  ensureAnimCss();
  const c = context(app);
  const N = STEPS.length;
  const reduced = reducedMotion();
  let idx = -1;
  let slide = null;
  let pending = null;
  let closed = false;
  let sw = null;

  // Eingabefokus aufgeben, damit die iOS-Tastatur verschwindet
  const prevFocus = document.activeElement;
  const editable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  if (editable(prevFocus)) prevFocus.blur();

  const count = h('span', { class: 'tour-count', 'aria-hidden': 'true' });
  const skip = h('button', { class: 'btn btn-plain tour-skip', type: 'button', onclick: () => close('skip') }, 'Überspringen');
  const track = h('div', { class: 'tour-track' });
  const ind = h('span', { class: 'tour-dot-ind', style: { transition: 'none' } });
  const dots = h(
    'div',
    { class: 'tour-dots', role: 'group', 'aria-label': 'Fortschritt' },
    STEPS.map((s, i) => h('button', { class: 'tour-dot', type: 'button', 'aria-label': `Schritt ${i + 1}: ${s.title}`, onclick: () => go(i) })),
    ind
  );
  const back = h('button', { class: 'btn btn-plain btn-lg tour-back', type: 'button', onclick: () => go(idx - 1) }, 'Zurück');
  const next = h('button', { class: 'btn btn-prominent btn-lg tour-next', type: 'button', onclick: () => (idx === N - 1 ? close('finish') : go(idx + 1)) }, 'Weiter');
  const live = h('div', { class: 'tour-live tour-sr', 'aria-live': 'polite' });
  const box = h(
    'div',
    { class: 'modal tour', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-h' },
    h('h2', { id: 'tour-h', class: 'tour-sr' }, 'Anleitung'),
    h('div', { class: 'tour-top' }, count, skip),
    track,
    h('div', { class: 'tour-foot' }, dots, h('div', { class: 'tour-btns' }, back, next)),
    live
  );
  // Absichtlich kein Schließen per Tipp auf den Hintergrund (versehentliches Wegtippen beim Einstieg)
  const root = h('div', { class: 'modal-backdrop tour-backdrop', 'data-input': c.touch ? 'touch' : 'mouse' }, box);

  // Illustration auf die verfügbare Bühne skalieren (nie breiter als die Karte)
  const fit = (art) => {
    const w = art.clientWidth;
    const hh = art.clientHeight;
    if (w && hh) art.style.setProperty('--s', Math.min(w / W, hh / H, 1.6).toFixed(3));
  };
  const placeInd = () => {
    const d = dots.children[idx];
    if (d) ind.style.setProperty('--x', d.offsetLeft + d.offsetWidth / 2 - 10 + 'px');
  };
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const en of entries) if (en.target.classList.contains('tour-art')) fit(en.target);
          placeInd();
        })
      : null;

  function actionButton(a) {
    // Erst schließen (hebt inert auf), dann handeln – alles im selben Tipp, damit iOS Fokus und Tastatur erlaubt
    const run = () => {
      close('action', { restoreFocus: false });
      if (a.run) a.run();
    };
    const label = [svg(a.icon), a.label];
    return a.href
      ? h('a', { class: 'btn btn-tinted tour-action', href: a.href, target: '_blank', rel: 'noopener', onclick: run }, label)
      : h('button', { class: 'btn btn-tinted tour-action', type: 'button', onclick: run }, label);
  }

  function build(i) {
    const s = STEPS[i];
    const tid = 'tour-t-' + s.id;
    const body = h(
      'div',
      { class: 'tour-body' },
      h('p', { class: 'tour-eyebrow' }, /^\d/.test(s.eyebrow) ? svg(I.clock) : null, s.eyebrow),
      h('h3', { class: 'tour-title', id: tid }, s.title),
      h('p', { class: 'tour-text', html: val(s.text, c) })
    );
    const chip = s.chip && s.chip(c);
    if (chip) body.appendChild(h('div', { class: 'tour-chip' }, h('i', { class: chip.on ? 'on' : null }), chip.text));
    const tip = s.tip && s.tip(c);
    if (tip) body.appendChild(h('p', { class: 'tour-tip' }, svg(s.id === 'claude' ? I.sparkle : I.info), h('span', { html: tip })));
    const a = s.action && s.action(c);
    if (a) body.appendChild(actionButton(a));
    const art = h('div', { class: 'tour-art', dataset: { step: s.id }, style: s.loop ? { '--loop': s.loop + 's' } : null, 'aria-hidden': 'true' }, h('div', { class: 'tour-canvas', html: s.art(c) }));
    // Akzentfarbe des Schritts (Bühne, Kopfzeile, Tipp-Symbol)
    const acc = s.acc || 'tint';
    const style = { '--acc': `var(--${acc})`, '--acc-t': s.acc ? `var(--t-${acc})` : 'var(--tint-text)' };
    return h('section', { class: 'tour-slide is-entering', dataset: { step: s.id }, style, role: 'group', 'aria-roledescription': 'Schritt', 'aria-labelledby': tid }, art, body);
  }

  function finish() {
    if (!pending) return;
    clearTimeout(pending.t);
    pending.done();
  }

  function go(i) {
    i = Math.max(0, Math.min(N - 1, i));
    if (closed || i === idx) return;
    finish();
    const dir = i > idx ? 'next' : 'prev';
    const old = slide;
    const neu = build(i);
    slide = neu;
    if (old) neu.classList.add('in-' + dir);
    track.appendChild(neu);
    const art = neu.firstChild;
    fit(art);
    ro && ro.observe(art);
    // Nur der aktive Schritt spielt; die Szene blendet Frame 0 unter der Einblendung aus
    art.classList.add('is-playing');
    idx = i;
    if (old) {
      ro && ro.unobserve(old.firstChild);
      old.classList.add('is-leaving', 'out-' + dir);
      old.setAttribute('aria-hidden', 'true');
    }
    update();
    if (!old) return;
    old.inert = true;
    const done = () => {
      pending = null;
      old.remove();
      neu.classList.remove('in-next', 'in-prev');
    };
    // Nicht auf animationend verlassen (Hintergrund-Tabs, reduzierte Bewegung)
    if (reduced) done();
    else pending = { t: setTimeout(done, 420), done };
  }

  function update() {
    const s = STEPS[idx];
    const last = idx === N - 1;
    count.textContent = `${idx + 1} von ${N}`;
    [...dots.querySelectorAll('.tour-dot')].forEach((d, j) => (j === idx ? d.setAttribute('aria-current', 'step') : d.removeAttribute('aria-current')));
    back.style.visibility = idx ? '' : 'hidden';
    box.classList.toggle('is-first', !idx);
    skip.style.visibility = last ? 'hidden' : '';
    next.textContent = last ? 'Los geht’s' : 'Weiter';
    live.textContent = `Schritt ${idx + 1} von ${N}: ${s.title}`;
    placeInd();
    // Fokus war auf der alten Folie oder einem jetzt versteckten Knopf → zurück auf „Weiter“
    const ae = document.activeElement;
    if (slide.previousSibling && (!box.contains(ae) || ae.closest('.is-leaving') || getComputedStyle(ae).visibility === 'hidden')) next.focus({ preventScroll: true });
  }

  function focusables() {
    return [...box.querySelectorAll('button, a[href]')].filter((el) => !el.disabled && !el.closest('.is-leaving') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }

  // Ein Listener am Fenster (Capture): läuft vor den App-Kürzeln und hält sie hinter dem Dialog zurück
  function onKey(e) {
    if (e.isComposing) return;
    const key = e.key;
    let handled = true;
    if (key === 'ArrowRight' || key === 'PageDown') go(idx + 1);
    else if (key === 'ArrowLeft' || key === 'PageUp') go(idx - 1);
    else if (key === 'Home') go(0);
    else if (key === 'End') go(N - 1);
    else if (key === 'Escape') close('escape');
    else if (key === 'Tab') {
      const f = focusables();
      const at = f.indexOf(document.activeElement);
      const n = e.shiftKey ? (at <= 0 ? f.length - 1 : at - 1) : at < 0 || at === f.length - 1 ? 0 : at + 1;
      if (f[n]) f[n].focus();
    } else handled = false;
    if (handled) e.preventDefault();
    e.stopPropagation();
  }

  // Wischen mit Finger oder Stift; senkrecht scrollt der Browser weiter selbst
  const springBack = (el) => {
    el.style.transition = 'transform .3s var(--spring), opacity .3s';
    el.style.transform = '';
    el.style.opacity = '';
    setTimeout(() => (el.style.transition = ''), 320);
  };
  const eatClick = (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || pending || e.target.closest('button, a, .tour-dots')) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, lt: e.timeStamp, dx: 0, v: 0, on: false };
  });
  track.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    if (!sw.on) {
      if (Math.hypot(dx, dy) < 8) return;
      if (Math.abs(dx) <= 1.2 * Math.abs(dy)) {
        sw = null;
        return;
      }
      sw.on = true;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
    }
    const dt = e.timeStamp - sw.lt;
    if (dt > 0) sw.v = 0.7 * ((e.clientX - sw.lx) / dt) + 0.3 * sw.v;
    sw.lx = e.clientX;
    sw.lt = e.timeStamp;
    // Gummiband am ersten und letzten Schritt
    sw.dx = (dx > 0 && idx === 0) || (dx < 0 && idx === N - 1) ? dx * 0.35 : dx;
    slide.style.transition = 'none';
    slide.style.transform = `translateX(${sw.dx}px)`;
    slide.style.opacity = String(Math.max(0.2, 1 - Math.abs(sw.dx) / 500));
  });
  const release = (e, cancel) => {
    if (!sw || e.pointerId !== sw.id) return;
    const s = sw;
    sw = null;
    if (!s.on) return;
    window.addEventListener('click', eatClick, true);
    setTimeout(() => window.removeEventListener('click', eatClick, true), 350);
    const to = s.dx < 0 ? idx + 1 : idx - 1;
    const far = Math.abs(s.dx) > Math.min(80, track.clientWidth * 0.22) || (Math.abs(s.v) > 0.4 && Math.sign(s.v) === Math.sign(s.dx));
    if (!cancel && far && to >= 0 && to < N) go(to);
    else springBack(slide);
  };
  track.addEventListener('pointerup', (e) => release(e, false));
  track.addEventListener('pointercancel', (e) => release(e, true));

  const onVis = () => root.classList.toggle('is-paused', document.visibilityState === 'hidden');
  const appEl = document.getElementById('app');

  function close(reason, { restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    current = null;
    finish();
    // Jede Art des Schließens zählt als gesehen
    storageSet(tourSeenKey(app), true);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', placeInd);
    ro && ro.disconnect();
    if (appEl) appEl.inert = false;
    root.classList.add('is-closing', 'is-paused');
    root.style.pointerEvents = 'none';
    setTimeout(() => root.remove(), reduced ? 0 : c.narrow ? 320 : 220);
    if (restoreFocus && prevFocus && prevFocus.isConnected && prevFocus !== document.body && !editable(prevFocus)) {
      try {
        prevFocus.focus({ preventScroll: true });
      } catch {
        /* egal */
      }
    }
    opts.onClose && opts.onClose(reason);
  }

  document.body.appendChild(root);
  try {
    go(want != null && want >= 0 ? want : 0);
    placeInd();
    void ind.offsetWidth;
    ind.style.transition = '';
    ro && ro.observe(dots);
    if (appEl) appEl.inert = true;
  } catch (err) {
    root.remove();
    if (appEl) appEl.inert = false;
    throw err;
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', placeInd);
  document.addEventListener('visibilitychange', onVis);
  // Fokus in den Dialog; beim automatischen Erststart ohne Fokusring (Tab zeigt ihn wie gewohnt)
  next.focus(opts.auto ? { preventScroll: true, focusVisible: false } : { preventScroll: true });
  current = { el: root, close: (reason = 'close') => close(reason), go };
  return current;
}

/**
 * Zeigt die Anleitung einmal beim ersten Start (pro Arbeitsbereich/Speicher), sobald Inhalte da sind
 * und die Startanimation weg ist. ?tour=1 erzwingt sie (auch in automatisierten Tests).
 */
export async function maybeAutoTour(app) {
  const forced = new URLSearchParams(location.search).get('tour') === '1';
  if (navigator.webdriver && !forced) return false;
  if (!forced && storageGet(tourSeenKey(app), false)) return false;
  // Start über einen Kurzbefehl: diesmal nicht stören (und nicht als gesehen markieren); #hilfe öffnet route()
  if (/^#(neu|suche|hilfe)$/.test(START_HASH)) return false;
  const t0 = Date.now();
  while (document.getElementById('splash') && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 100));
  if (!app.pages.size || isTourOpen() || document.querySelector('.modal-backdrop, .popover')) return false;
  openTour(app, { auto: true });
  return true;
}
