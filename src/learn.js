// Lernen: Karteikarten (Spaced Repetition), Quiz, Lernsitzungen, Fokus-Timer

import { h, svg, uid, plural, toast, clamp } from './util.js';
import { I } from './icons.js';
import { sanitizeInline, htmlToText, inlineMdToHtml } from './inline.js';
import { modal, menu, confirmDialog } from './menus.js';
import { renderMathIn } from './blocks.js';
import { pageTitle } from './model.js';

const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120];

export function isDue(card, now = Date.now()) {
  return !card.due || card.due <= now;
}

export function rateCard(card, rating) {
  const now = Date.now();
  const box = card.box || 0;
  card.reps = (card.reps || 0) + 1;
  card.last = now;
  if (rating === 'again') {
    card.box = 0;
    card.due = now + 10 * 60000;
    card.lapses = (card.lapses || 0) + 1;
  } else if (rating === 'hard') {
    card.box = Math.max(1, box);
    card.due = now + Math.max(0.5, INTERVALS[card.box] * 0.5) * DAY;
  } else if (rating === 'good') {
    card.box = Math.min(INTERVALS.length - 1, box + 1);
    card.due = now + INTERVALS[card.box] * DAY;
  } else {
    card.box = Math.min(INTERVALS.length - 1, box + 2);
    card.due = now + INTERVALS[card.box] * 1.3 * DAY;
  }
}

export function nextLabel(card, rating) {
  const c = { ...card };
  rateCard(c, rating);
  const d = c.due - Date.now();
  if (d < 3600000) return '< 1 Std.';
  const days = Math.round(d / DAY);
  if (days <= 1) return '1 Tag';
  if (days < 30) return days + ' Tage';
  return Math.round(days / 30) + ' Mon.';
}

// ---------------------------------------------------------------------------
// Karteikarten-Block
// ---------------------------------------------------------------------------
export function renderFlashcards(ed, b) {
  if (!Array.isArray(b.cards)) b.cards = [];
  const wrap = h('div', { class: 'fc-block' });
  let expanded = b.cards.length <= 6 || b._expanded;
  const draw = (focusNew) => {
    wrap.innerHTML = '';
    const due = b.cards.filter((c) => isDue(c) && htmlToText(c.q).trim()).length;
    const head = h(
      'div',
      { class: 'fc-head' },
      h('div', { class: 'fc-title' }, h('span', { class: 'fc-ico' }, svg(I.cards)), h('span', {}, b.title || 'Karteikarten'), h('span', { class: 'chip' }, plural(b.cards.length, 'Karte', 'Karten')), due ? h('span', { class: 'chip chip-accent' }, due + ' fällig') : null),
      h(
        'div',
        { class: 'fc-actions' },
        h('button', { class: 'btn btn-prominent btn-sm', type: 'button', disabled: !b.cards.length, onclick: () => studySession(ed.app, collectFromBlock(ed.page, b), { title: b.title || pageTitle(ed.page) }) }, svg(I.play), ' Lernen'),
        ed.app.ai && ed.app.ai.available
          ? h('button', { class: 'btn btn-tinted btn-sm', type: 'button', onclick: (e) => ed.app.ai.makeFlashcards(ed, b, e.currentTarget) }, svg(I.sparkle), ' Erstellen')
          : null,
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Karteikarten-Optionen',
            onclick: (e) =>
              menu(e.currentTarget, [
                { label: expanded ? 'Karten einklappen' : 'Alle Karten zeigen', icon: expanded ? I.chevronUp : I.chevronDown, onSelect: () => { expanded = !expanded; b._expanded = expanded; draw(); } },
                { label: 'Fortschritt zurücksetzen', icon: I.refresh, onSelect: () => { ed.history.structural(); b.cards.forEach((c) => { c.box = 0; c.due = 0; }); ed.app.touch(ed.page); draw(); } },
                { label: 'Karten mischen', icon: I.flip, onSelect: () => { ed.history.structural(); b.cards.sort(() => Math.random() - 0.5); ed.app.touch(ed.page); draw(); } },
              ], { title: 'Karteikarten' }),
          },
          svg(I.more)
        )
      )
    );
    wrap.appendChild(head);
    const list = h('div', { class: 'fc-list' });
    const shown = expanded ? b.cards : b.cards.slice(0, 4);
    shown.forEach((c) => list.appendChild(cardRow(c)));
    if (!b.cards.length) list.appendChild(h('div', { class: 'fc-empty' }, 'Noch keine Karten. Füge eine hinzu' + (ed.app.ai && ed.app.ai.available ? ' oder lass Claude Karten aus dieser Seite erstellen.' : '.')));
    wrap.appendChild(list);
    const foot = h('div', { class: 'fc-foot' });
    foot.appendChild(h('button', { class: 'btn btn-plain btn-sm', type: 'button', 'data-open': '', onclick: () => addCard() }, svg(I.plus), ' Karte hinzufügen'));
    if (!expanded && b.cards.length > 4) foot.appendChild(h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => { expanded = true; b._expanded = true; draw(); } }, `Alle ${b.cards.length} anzeigen`));
    wrap.appendChild(foot);
    if (focusNew) {
      const rows = list.querySelectorAll('.fc-q');
      const last = rows[rows.length - 1];
      if (last) last.focus();
    }
  };
  const field = (c, key, ph) => {
    const el = h('div', { class: 'fc-' + key + ' fc-field', contenteditable: 'true', 'data-ph': ph, spellcheck: 'true' });
    el.innerHTML = c[key] || '';
    renderMathIn(el);
    el.addEventListener('input', () => {
      ed.history.typing();
      c[key] = sanitizeInline(el.innerHTML);
      ed.app.touch(ed.page);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (key === 'q') el.parentNode.querySelector('.fc-a').focus();
        else addCard();
      } else if (e.key === 'Backspace' && key === 'q' && !htmlToText(c.q) && !htmlToText(c.a)) {
        e.preventDefault();
        removeCard(c);
      }
    });
    return el;
  };
  const cardRow = (c) =>
    h(
      'div',
      { class: 'fc-row fc-edit', 'data-card': c.id },
      field(c, 'q', 'Frage / Begriff'),
      field(c, 'a', 'Antwort / Definition'),
      h('button', { class: 'icon-btn fc-del', type: 'button', 'aria-label': 'Karte löschen', onclick: () => removeCard(c) }, svg(I.trash))
    );
  const addCard = () => {
    ed.history.structural();
    b.cards.push({ id: uid('k'), q: '', a: '', box: 0, due: 0 });
    expanded = true;
    ed.app.touch(ed.page);
    draw(true);
  };
  const removeCard = (c) => {
    ed.history.structural();
    b.cards = b.cards.filter((x) => x !== c);
    ed.app.touch(ed.page);
    draw();
  };
  wrap._redraw = draw;
  draw();
  return wrap;
}

function collectFromBlock(page, b) {
  return b.cards.filter((c) => htmlToText(c.q).trim()).map((c) => ({ card: c, page, block: b }));
}

export function collectAllCards(app) {
  const out = [];
  for (const p of app.pages.values()) {
    if (p.trashed || app.isTrashedDeep(p)) continue;
    for (const b of p.blocks || []) {
      if (b.type !== 'flashcards') continue;
      for (const c of b.cards || []) if (htmlToText(c.q).trim()) out.push({ card: c, page: p, block: b });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lernsitzung
// ---------------------------------------------------------------------------
export function studySession(app, items, opts = {}) {
  let queue = items.filter((x) => isDue(x.card));
  let mode = 'due';
  if (!queue.length) {
    queue = [...items];
    mode = 'all';
  }
  if (!queue.length) {
    toast('Keine Karten zum Lernen');
    return;
  }
  queue = queue.sort(() => Math.random() - 0.5);
  const total = queue.length;
  let done = 0;
  const stats = { again: 0, hard: 0, good: 0, easy: 0 };
  let flipped = false;
  let current = null;

  const body = h('div', { class: 'study' });
  const m = modal(body, { class: 'modal-study', title: opts.title ? 'Lernen · ' + opts.title : 'Lernen', onClose: () => document.removeEventListener('keydown', onKey) });

  const onKey = (e) => {
    if (!current) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!flipped) flip();
    } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      rate(['again', 'hard', 'good', 'easy'][Number(e.key) - 1]);
    }
  };
  document.addEventListener('keydown', onKey);

  const next = () => {
    flipped = false;
    current = queue.shift();
    body.innerHTML = '';
    if (!current) return finish();
    const pct = Math.round((done / total) * 100);
    const front = h('div', { class: 'study-face study-front' }, h('div', { class: 'study-label' }, 'Frage'), h('div', { class: 'study-text', html: current.card.q }));
    const back = h('div', { class: 'study-face study-back' }, h('div', { class: 'study-label' }, 'Antwort'), h('div', { class: 'study-text', html: current.card.a || '<span class="muted">(keine Antwort)</span>' }));
    renderMathIn(front);
    renderMathIn(back);
    const card = h('button', { class: 'study-card', type: 'button', 'aria-label': 'Karte umdrehen', onclick: () => !flipped && flip() }, h('div', { class: 'study-inner' }, front, back));
    const source = h('div', { class: 'study-source' }, current.page.icon ? current.page.icon + ' ' : '', pageTitle(current.page));
    const rateRow = h(
      'div',
      { class: 'study-rate', hidden: true },
      rateBtn('again', 'Nochmal', 'danger'),
      rateBtn('hard', 'Schwer', 'warn'),
      rateBtn('good', 'Gut', 'ok'),
      rateBtn('easy', 'Leicht', 'accent')
    );
    const flipBtn = h('button', { class: 'btn btn-prominent btn-lg study-flip', type: 'button', onclick: () => flip() }, 'Antwort zeigen');
    body.append(
      h('div', { class: 'study-progress' }, h('div', { class: 'study-bar' }, h('div', { class: 'study-bar-fill', style: { width: pct + '%' } })), h('span', { class: 'study-count' }, `${done + 1} / ${total}`)),
      source,
      card,
      h('div', { class: 'study-controls' }, flipBtn, rateRow)
    );
    body._card = card;
    body._rate = rateRow;
    body._flipBtn = flipBtn;
  };

  const rateBtn = (r, label, tone) =>
    h('button', { class: 'rate-btn tone-' + tone, type: 'button', onclick: () => rate(r) }, h('span', { class: 'rate-label' }, label), h('span', { class: 'rate-next' }, current ? nextLabel(current.card, r) : ''));

  const flip = () => {
    flipped = true;
    body._card.classList.add('flipped');
    body._flipBtn.hidden = true;
    body._rate.hidden = false;
    body._rate.querySelectorAll('.rate-btn').forEach((btn, i) => {
      btn.querySelector('.rate-next').textContent = nextLabel(current.card, ['again', 'hard', 'good', 'easy'][i]);
    });
  };

  const rate = (r) => {
    rateCard(current.card, r);
    stats[r]++;
    app.touch(current.page, { silent: true });
    if (r === 'again') queue.splice(Math.min(queue.length, 3), 0, current);
    else done++;
    next();
  };

  const finish = () => {
    current = null;
    const right = stats.good + stats.easy;
    body.innerHTML = '';
    body.append(
      h(
        'div',
        { class: 'study-done' },
        h('div', { class: 'study-done-ico' }, '🎉'),
        h('h2', {}, 'Geschafft!'),
        h('p', {}, `${plural(total, 'Karte', 'Karten')} wiederholt${mode === 'all' ? ' (alle Karten)' : ''}.`),
        h(
          'div',
          { class: 'study-stats' },
          stat('Nochmal', stats.again, 'danger'),
          stat('Schwer', stats.hard, 'warn'),
          stat('Gut', stats.good, 'ok'),
          stat('Leicht', stats.easy, 'accent')
        ),
        h('p', { class: 'muted' }, right >= total * 0.8 ? 'Stark – die meisten Karten sitzen.' : 'Die schwierigen Karten kommen bald wieder dran.'),
        h('div', { class: 'confirm-actions' }, h('button', { class: 'btn btn-prominent', type: 'button', onclick: () => m.close() }, 'Fertig'))
      )
    );
    app.onStudyDone && app.onStudyDone();
  };
  const stat = (label, n, tone) => h('div', { class: 'study-stat tone-' + tone }, h('div', { class: 'study-stat-n' }, String(n)), h('div', { class: 'study-stat-l' }, label));
  next();
}

// ---------------------------------------------------------------------------
// Quiz-Block
// ---------------------------------------------------------------------------
export function renderQuiz(ed, b) {
  if (!Array.isArray(b.questions)) b.questions = [];
  const wrap = h('div', { class: 'quiz' });
  let editing = !b.questions.length;
  let answers = {};
  const draw = () => {
    wrap.innerHTML = '';
    const answered = Object.keys(answers).length;
    const correct = b.questions.filter((q, i) => answers[i] === q.correct).length;
    wrap.appendChild(
      h(
        'div',
        { class: 'fc-head' },
        h('div', { class: 'fc-title' }, h('span', { class: 'fc-ico quiz-ico' }, svg(I.quiz)), h('span', {}, b.title || 'Quiz'), h('span', { class: 'chip' }, plural(b.questions.length, 'Frage', 'Fragen')), answered && !editing ? h('span', { class: 'chip chip-accent' }, `${correct}/${answered} richtig`) : null),
        h(
          'div',
          { class: 'fc-actions' },
          ed.app.ai && ed.app.ai.available ? h('button', { class: 'btn btn-tinted btn-sm', type: 'button', onclick: (e) => ed.app.ai.makeQuiz(ed, b, e.currentTarget) }, svg(I.sparkle), ' Erstellen') : null,
          h('button', { class: 'btn btn-plain btn-sm', type: 'button', 'data-open': '', onclick: () => { editing = !editing; draw(); } }, editing ? 'Fertig' : 'Bearbeiten'),
          !editing && answered ? h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => { answers = {}; draw(); } }, 'Neu starten') : null
        )
      )
    );
    if (!b.questions.length && !editing) wrap.appendChild(h('div', { class: 'fc-empty' }, 'Noch keine Fragen.'));
    b.questions.forEach((q, i) => wrap.appendChild(editing ? editQuestion(q, i) : showQuestion(q, i)));
    if (editing) {
      wrap.appendChild(
        h('div', { class: 'fc-foot' }, h('button', { class: 'btn btn-plain btn-sm', type: 'button', onclick: () => { ed.history.structural(); b.questions.push({ q: '', options: ['', '', '', ''], correct: 0, explain: '' }); ed.app.touch(ed.page); draw(); const qs = wrap.querySelectorAll('.quiz-q-input'); qs[qs.length - 1]?.focus(); } }, svg(I.plus), ' Frage hinzufügen'))
      );
    } else if (answered === b.questions.length && b.questions.length) {
      const pct = Math.round((correct / b.questions.length) * 100);
      b.lastScore = { pct, at: Date.now() };
      wrap.appendChild(h('div', { class: 'quiz-result' }, h('strong', {}, `${correct} von ${b.questions.length} richtig (${pct} %)`), h('span', {}, pct >= 80 ? ' – sehr gut!' : pct >= 50 ? ' – schon ordentlich, wiederhole die falschen Fragen.' : ' – lies die Erklärungen und versuch es nochmal.')));
    }
  };
  const showQuestion = (q, i) => {
    const sel = answers[i];
    const box = h('div', { class: 'quiz-item' + (sel != null ? ' answered' : '') });
    const qt = h('div', { class: 'quiz-q' }, h('span', { class: 'quiz-num' }, i + 1 + '.'), h('span', { html: inlineMdToHtml(q.q) }));
    renderMathIn(qt);
    box.appendChild(qt);
    const opts = h('div', { class: 'quiz-opts' });
    q.options.forEach((o, j) => {
      if (!String(o).trim()) return;
      let cls = 'quiz-opt';
      if (sel != null) {
        if (j === q.correct) cls += ' correct';
        else if (j === sel) cls += ' wrong';
        else cls += ' dim';
      }
      const btn = h('button', { class: cls, type: 'button', disabled: sel != null, onclick: () => { answers[i] = j; draw(); } }, h('span', { class: 'quiz-letter' }, 'ABCDEF'[j]), h('span', { html: inlineMdToHtml(String(o)) }));
      renderMathIn(btn);
      opts.appendChild(btn);
    });
    box.appendChild(opts);
    if (sel != null && q.explain) {
      const ex = h('div', { class: 'quiz-explain' + (sel === q.correct ? ' ok' : ' bad') }, h('strong', {}, sel === q.correct ? 'Richtig. ' : 'Nicht ganz. '), h('span', { html: inlineMdToHtml(q.explain) }));
      renderMathIn(ex);
      box.appendChild(ex);
    }
    return box;
  };
  const editQuestion = (q, i) => {
    const upd = () => ed.app.touch(ed.page);
    const qi = h('input', { class: 'input quiz-q-input', type: 'text', placeholder: `Frage ${i + 1}` });
    qi.value = q.q;
    qi.addEventListener('input', () => {
      q.q = qi.value;
      upd();
    });
    const opts = h('div', { class: 'quiz-edit-opts' });
    q.options.forEach((o, j) => {
      const inp = h('input', { class: 'input', type: 'text', placeholder: `Antwort ${'ABCDEF'[j]}` });
      inp.value = o;
      inp.addEventListener('input', () => {
        q.options[j] = inp.value;
        upd();
      });
      const radio = h('button', { class: 'quiz-radio' + (q.correct === j ? ' on' : ''), type: 'button', 'aria-label': 'Als richtig markieren', title: 'Richtige Antwort', onclick: () => { q.correct = j; upd(); draw(); } }, svg(I.check));
      opts.appendChild(h('div', { class: 'quiz-edit-opt' }, radio, inp));
    });
    const ex = h('input', { class: 'input', type: 'text', placeholder: 'Erklärung (optional)' });
    ex.value = q.explain || '';
    ex.addEventListener('input', () => {
      q.explain = ex.value;
      upd();
    });
    return h(
      'div',
      { class: 'quiz-edit' },
      h('div', { class: 'quiz-edit-head' }, qi, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Frage löschen', onclick: () => { ed.history.structural(); b.questions.splice(i, 1); upd(); draw(); } }, svg(I.trash))),
      opts,
      ex
    );
  };
  wrap._redraw = draw;
  draw();
  return wrap;
}

// ---------------------------------------------------------------------------
// Fokus-Timer (Pomodoro)
// ---------------------------------------------------------------------------
const timer = { mode: 'focus', left: 25 * 60, running: false, t: null, listeners: new Set(), rounds: 0 };
const DUR = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };

export function focusTimer() {
  return timer;
}

function tick() {
  timer.left = Math.max(0, timer.left - 1);
  if (timer.left === 0) {
    timer.running = false;
    clearInterval(timer.t);
    if (timer.mode === 'focus') {
      timer.rounds++;
      toast('Fokuszeit vorbei – Zeit für eine Pause ☕', { duration: 6000 });
      setTimerMode(timer.rounds % 4 === 0 ? 'long' : 'short');
    } else {
      toast('Pause vorbei – weiter geht’s 💪', { duration: 6000 });
      setTimerMode('focus');
    }
    beep();
  }
  timer.listeners.forEach((f) => f());
}

export function setTimerMode(mode) {
  timer.mode = mode;
  timer.left = DUR[mode];
  timer.running = false;
  clearInterval(timer.t);
  timer.listeners.forEach((f) => f());
}

export function toggleTimer() {
  timer.running = !timer.running;
  clearInterval(timer.t);
  if (timer.running) timer.t = setInterval(tick, 1000);
  timer.listeners.forEach((f) => f());
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.start();
    o.stop(ctx.currentTime + 0.85);
  } catch {
    /* kein Ton */
  }
}

export function renderTimerCard() {
  const ring = h('div', { class: 'timer-ring' });
  const time = h('div', { class: 'timer-time' });
  const label = h('div', { class: 'timer-label' });
  const playBtn = h('button', { class: 'btn btn-prominent timer-play', type: 'button', onclick: () => toggleTimer() });
  const seg = h('div', { class: 'segmented' });
  const modes = [
    ['focus', 'Fokus'],
    ['short', 'Pause'],
    ['long', 'Lange Pause'],
  ];
  modes.forEach(([m, l]) => seg.appendChild(h('button', { type: 'button', 'data-m': m, onclick: () => setTimerMode(m) }, l)));
  const card = h('div', { class: 'timer-card' }, h('div', { class: 'timer-dial' }, ring, h('div', { class: 'timer-center' }, time, label)), seg, playBtn);
  const upd = () => {
    const mm = String(Math.floor(timer.left / 60)).padStart(2, '0');
    const ss = String(timer.left % 60).padStart(2, '0');
    time.textContent = `${mm}:${ss}`;
    label.textContent = timer.mode === 'focus' ? `Fokus · Runde ${timer.rounds + 1}` : 'Pause';
    const pct = 1 - timer.left / DUR[timer.mode];
    ring.style.setProperty('--p', clamp(pct, 0, 1));
    playBtn.innerHTML = '';
    playBtn.append(svg(timer.running ? I.pause : I.play), timer.running ? ' Pausieren' : ' Starten');
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === timer.mode));
    if (card.isConnected) card._seen = true;
    else if (card._seen) timer.listeners.delete(upd);
  };
  timer.listeners.add(upd);
  upd();
  return card;
}

export async function confirmResetCards() {
  return confirmDialog({ title: 'Fortschritt zurücksetzen?', text: 'Alle Karten werden wieder als neu markiert.', okLabel: 'Zurücksetzen', danger: true });
}
