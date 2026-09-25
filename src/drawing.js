// Handschrift-Block: Apple Pencil (Druck), Finger, Maus
// Vektorstriche in einem logischen Koordinatensystem (Breite 1000), skaliert auf jede Breite.

import { h, svg, storageGet, storageSet, toast, isTouchUI } from './util.js';
import { I } from './icons.js';
import { menu } from './menus.js';
import { newBlock } from './model.js';

const W = 1000;
const INK = {
  ink: ['#1c1c1e', '#f2f2f7'],
  blue: ['#0a5bd8', '#64a8ff'],
  red: ['#d70015', '#ff6961'],
  green: ['#248a3d', '#4ade80'],
  orange: ['#c93400', '#ffb340'],
  purple: ['#8944ab', '#d69cff'],
};
const HL = {
  yellow: ['#ffd60a', '#ffd60a'],
  green: ['#34c759', '#30d158'],
  pink: ['#ff2d55', '#ff375f'],
  blue: ['#5ac8fa', '#64d2ff'],
};
const SIZES = { pen: [2.2, 3.6, 6], hl: [14, 22, 32], eraser: [10, 20, 36] };

let penSeen = storageGet('lr:penSeen', false);
const toolState = Object.assign({ tool: 'pen', ink: 'ink', hl: 'yellow', size: 1, finger: false }, storageGet('lr:tool', {}));
function saveTool() {
  storageSet('lr:tool', toolState);
}

function isDark() {
  const r = document.documentElement;
  const app = r.getAttribute('data-app-theme');
  if (app === 'dark') return true;
  if (app === 'light') return false;
  const t = r.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function colorOf(s, dark) {
  const table = s.t === 'hl' ? HL : INK;
  const e = table[s.c] || (s.t === 'hl' ? HL.yellow : INK.ink);
  return e[dark ? 1 : 0];
}

const instances = new Set();
export function redrawAllDrawings() {
  for (const inst of instances) if (inst.isConnected()) inst.redraw();
    else instances.delete(inst);
}

// ---------------------------------------------------------------------------
export function renderDrawing(ed, b) {
  if (!Array.isArray(b.strokes)) b.strokes = [];
  if (!b.h) b.h = 520;
  if (!b.bg) b.bg = 'lines';
  const wrap = h('div', { class: 'draw-block' });
  const surface = h('div', { class: 'draw-surface bg-' + b.bg });
  const canvas = h('canvas', { class: 'draw-canvas' });
  const live = h('canvas', { class: 'draw-live' });
  const hint = h('div', { class: 'draw-hint' });
  surface.append(canvas, live, hint);

  const undoStack = [];
  const redoStack = [];
  let scale = 1;
  let dpr = 1;
  let cur = null;
  let erasing = false;
  let activePointer = null;

  // --- Werkzeugleiste -----------------------------------------------------
  const bar = h('div', { class: 'draw-bar glass' });
  const toolBtn = (tool, icon, label) =>
    h('button', { class: 'draw-tool', type: 'button', 'data-tool': tool, 'aria-label': label, title: label, onclick: () => setTool(tool) }, svg(icon));
  const tools = h('div', { class: 'draw-group' }, toolBtn('pen', I.pen, 'Stift'), toolBtn('hl', I.highlighter, 'Textmarker'), toolBtn('eraser', I.eraser, 'Radierer'));
  const colors = h('div', { class: 'draw-group draw-colors' });
  const sizes = h('div', { class: 'draw-group draw-sizes' });
  const undoBtn = h('button', { class: 'draw-tool', type: 'button', 'aria-label': 'Rückgängig', title: 'Rückgängig', onclick: () => undo() }, svg(I.undo));
  const redoBtn = h('button', { class: 'draw-tool', type: 'button', 'aria-label': 'Wiederholen', title: 'Wiederholen', onclick: () => redo() }, svg(I.redo));
  const fingerBtn = h('button', { class: 'draw-tool finger-btn', type: 'button', 'aria-label': 'Mit dem Finger zeichnen', title: 'Mit dem Finger zeichnen', onclick: () => setFinger(!toolState.finger) }, svg(I.hand));
  const moreBtn = h('button', { class: 'draw-tool', type: 'button', 'aria-label': 'Weitere Optionen', title: 'Weitere Optionen', onclick: () => moreMenu() }, svg(I.more));
  const fsBtn = h('button', { class: 'draw-tool', type: 'button', 'aria-label': 'Vollbild', title: 'Vollbild', onclick: () => toggleFullscreen() }, svg(I.expand));
  const aiBtn = h('button', { class: 'draw-ai', type: 'button', onclick: () => toText() }, svg(I.sparkle), h('span', {}, 'In Text'));
  bar.append(tools, colors, sizes, h('div', { class: 'draw-group' }, undoBtn, redoBtn, fingerBtn, fsBtn, moreBtn), aiBtn);
  wrap.append(bar, surface);

  function renderPalette() {
    colors.innerHTML = '';
    sizes.innerHTML = '';
    const t = toolState.tool;
    if (t !== 'eraser') {
      const table = t === 'hl' ? HL : INK;
      const key = t === 'hl' ? 'hl' : 'ink';
      for (const c of Object.keys(table)) {
        colors.appendChild(
          h('button', {
            class: 'draw-color' + (toolState[key] === c ? ' on' : ''),
            type: 'button',
            'aria-label': 'Farbe ' + c,
            style: { '--sw': table[c][isDark() ? 1 : 0] },
            onclick: () => {
              toolState[key] = c;
              saveTool();
              renderPalette();
            },
          })
        );
      }
    }
    SIZES[t].forEach((_, i) => {
      sizes.appendChild(
        h('button', {
          class: 'draw-size' + (toolState.size === i ? ' on' : ''),
          type: 'button',
          'aria-label': 'Stärke ' + (i + 1),
          style: { '--d': 4 + i * 4 + 'px' },
          onclick: () => {
            toolState.size = i;
            saveTool();
            renderPalette();
          },
        })
      );
    });
    tools.querySelectorAll('.draw-tool').forEach((x) => x.classList.toggle('on', x.dataset.tool === t));
    fingerBtn.classList.toggle('on', !!toolState.finger);
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
    fingerBtn.hidden = !isTouchUI();
    aiBtn.hidden = !(ed.app.ai && ed.app.ai.available);
    updateTouchMode();
  }

  function setTool(t) {
    toolState.tool = t;
    saveTool();
    renderPalette();
  }

  function setFinger(on) {
    toolState.finger = on;
    saveTool();
    renderPalette();
    if (on) toast('Finger zeichnet – zum Scrollen wieder ausschalten');
  }

  function updateTouchMode() {
    const fingerDraws = !!toolState.finger;
    surface.style.touchAction = fingerDraws ? 'none' : 'pan-x pan-y pinch-zoom';
    surface.classList.toggle('finger-mode', fingerDraws);
    if (!b.strokes.length) {
      hint.textContent = penSeen
        ? 'Schreibe mit dem Apple Pencil – mit dem Finger scrollst du.'
        : isTouchUI()
          ? 'Schreibe mit dem Stift – oder tippe auf ✋, um mit dem Finger zu zeichnen.'
          : 'Zeichne mit der Maus oder dem Stift.';
      hint.hidden = false;
    } else hint.hidden = true;
  }

  // --- Größe & Zeichnen ---------------------------------------------------
  function layout() {
    const cssW = surface.clientWidth || 600;
    scale = cssW / W;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssH = Math.round(b.h * scale);
    surface.style.height = cssH + 'px';
    surface.style.setProperty('--gap', 36 * scale + 'px');
    for (const c of [canvas, live]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
    }
    redraw();
  }

  function ctxOf(c) {
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }

  function redraw() {
    const ctx = ctxOf(canvas);
    ctx.clearRect(0, 0, W, b.h);
    const dark = isDark();
    // Marker zuerst (liegen unter der Tinte)
    for (const s of b.strokes) if (s.t === 'hl') drawStroke(ctx, s, dark);
    for (const s of b.strokes) if (s.t !== 'hl') drawStroke(ctx, s, dark);
    ctxOf(live).clearRect(0, 0, W, b.h);
    updateTouchMode();
  }

  const ro = new ResizeObserver(() => layout());
  requestAnimationFrame(() => {
    ro.observe(surface);
    layout();
  });

  const inst = { isConnected: () => wrap.isConnected, redraw: () => { renderPalette(); redraw(); } };
  instances.add(inst);

  // --- Eingabe ------------------------------------------------------------
  function pt(e) {
    const r = surface.getBoundingClientRect();
    let pr = e.pressure;
    if (e.pointerType !== 'pen') pr = 0.5;
    else if (!pr) pr = 0.5;
    return [Math.round(((e.clientX - r.left) / scale) * 10) / 10, Math.round(((e.clientY - r.top) / scale) * 10) / 10, Math.round(pr * 100)];
  }

  function shouldDraw(e) {
    if (e.pointerType === 'pen') {
      if (!penSeen) {
        penSeen = true;
        storageSet('lr:penSeen', true);
        updateTouchMode();
      }
      return true;
    }
    if (e.pointerType === 'mouse') return e.button === 0;
    if (e.pointerType === 'touch') return !!toolState.finger;
    return false;
  }

  surface.addEventListener('pointerdown', (e) => {
    if (activePointer != null) return;
    if (!shouldDraw(e)) return;
    e.preventDefault();
    activePointer = e.pointerId;
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const tool = toolState.tool;
    if (tool === 'eraser') {
      erasing = { removed: [] };
      eraseAt(pt(e));
      return;
    }
    const size = SIZES[tool][toolState.size] || SIZES[tool][1];
    cur = { t: tool === 'hl' ? 'hl' : 'pen', c: tool === 'hl' ? toolState.hl : toolState.ink, w: size, p: [], real: e.pointerType === 'pen' };
    cur.p.push(...pt(e));
    drawLive();
    hint.hidden = true;
  });

  surface.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (erasing) {
      for (const ev of events) eraseAt(pt(ev));
      return;
    }
    if (!cur) return;
    for (const ev of events.length ? events : [e]) {
      const p = pt(ev);
      const n = cur.p.length;
      if (Math.hypot(p[0] - cur.p[n - 3], p[1] - cur.p[n - 2]) < 0.6) continue;
      cur.p.push(...p);
    }
    drawLive();
  });

  const finish = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (erasing) {
      if (erasing.removed.length) {
        undoStack.push({ type: 'erase', strokes: erasing.removed });
        redoStack.length = 0;
        commit();
      }
      erasing = false;
      return;
    }
    if (!cur) return;
    const s = cur;
    cur = null;
    s.p = simplify(s.p, s.t === 'hl' ? 1.2 : 0.45);
    if (!s.real) delete s.real;
    else delete s.real;
    b.strokes.push(s);
    undoStack.push({ type: 'add', stroke: s });
    redoStack.length = 0;
    // automatisch wachsen
    let maxY = 0;
    for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i]);
    if (maxY > b.h - 90 && b.h < 8000) {
      b.h = Math.min(8000, b.h + 360);
      layout();
    } else {
      ctxOf(live).clearRect(0, 0, W, b.h);
      if (s.t === 'hl') redraw();
      else drawStroke(ctxOf(canvas), s, isDark());
    }
    commit();
  };
  surface.addEventListener('pointerup', finish);
  surface.addEventListener('pointercancel', finish);

  // iOS: Apple-Pencil-Berührungen dürfen nicht scrollen, Finger schon
  const stopStylus = (e) => {
    const t = e.touches && e.touches[0];
    if (t && t.touchType === 'stylus') e.preventDefault();
  };
  surface.addEventListener('touchstart', stopStylus, { passive: false });
  surface.addEventListener('touchmove', stopStylus, { passive: false });

  function drawLive() {
    const ctx = ctxOf(live);
    ctx.clearRect(0, 0, W, b.h);
    if (cur) drawStroke(ctx, cur, isDark());
  }

  function eraseAt(p) {
    const r = SIZES.eraser[toolState.size] || 20;
    const keep = [];
    let removed = false;
    for (const s of b.strokes) {
      if (hitStroke(s, p[0], p[1], r + s.w / 2)) {
        erasing.removed.push({ stroke: s, index: b.strokes.indexOf(s) });
        removed = true;
      } else keep.push(s);
    }
    if (removed) {
      b.strokes.length = 0;
      b.strokes.push(...keep);
      redraw();
    }
    const ctx = ctxOf(live);
    ctx.clearRect(0, 0, W, b.h);
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(128,128,128,.8)';
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
  }

  function undo() {
    const op = undoStack.pop();
    if (!op) return;
    if (op.type === 'add') {
      const i = b.strokes.indexOf(op.stroke);
      if (i >= 0) b.strokes.splice(i, 1);
    } else if (op.type === 'erase') {
      for (const r of [...op.strokes].sort((a, c) => a.index - c.index)) b.strokes.splice(Math.min(r.index, b.strokes.length), 0, r.stroke);
    } else if (op.type === 'clear') {
      b.strokes.push(...op.strokes);
    }
    redoStack.push(op);
    redraw();
    commit();
  }

  function redo() {
    const op = redoStack.pop();
    if (!op) return;
    if (op.type === 'add') b.strokes.push(op.stroke);
    else if (op.type === 'erase') {
      const set = new Set(op.strokes.map((r) => r.stroke));
      const keep = b.strokes.filter((s) => !set.has(s));
      b.strokes.length = 0;
      b.strokes.push(...keep);
    } else if (op.type === 'clear') b.strokes.length = 0;
    undoStack.push(op);
    redraw();
    commit();
  }

  function commit() {
    renderPalette();
    ed.app.touch(ed.page);
  }

  function moreMenu() {
    const bgItem = (id, label, icon) => ({
      label,
      icon,
      checked: b.bg === id,
      onSelect: () => {
        surface.classList.remove('bg-' + b.bg);
        b.bg = id;
        surface.classList.add('bg-' + b.bg);
        ed.app.touch(ed.page);
      },
    });
    menu(
      moreBtn,
      [
        { header: 'Papier' },
        bgItem('lines', 'Liniert', I.lines),
        bgItem('grid', 'Kariert', I.grid),
        bgItem('dots', 'Punkte', I.dots),
        bgItem('blank', 'Blanko', I.blank),
        { divider: true },
        { label: 'Mehr Platz', icon: I.plus, onSelect: () => { b.h = Math.min(8000, b.h + 400); layout(); ed.app.touch(ed.page); } },
        {
          label: 'Auf Inhalt zuschneiden',
          icon: I.expand,
          onSelect: () => {
            let maxY = 120;
            for (const s of b.strokes) for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i] + s.w);
            b.h = Math.max(200, Math.ceil(maxY + 60));
            layout();
            ed.app.touch(ed.page);
          },
        },
        { label: 'Mit dem Finger zeichnen', icon: I.hand, checked: !!toolState.finger, onSelect: () => setFinger(!toolState.finger) },
        { divider: true },
        {
          label: 'Alles löschen',
          icon: I.trash,
          danger: true,
          disabled: !b.strokes.length,
          onSelect: () => {
            undoStack.push({ type: 'clear', strokes: [...b.strokes] });
            b.strokes.length = 0;
            redraw();
            commit();
          },
        },
      ],
      { title: 'Handschrift' }
    );
  }

  function toggleFullscreen() {
    const on = !wrap.classList.contains('draw-fullscreen');
    wrap.classList.toggle('draw-fullscreen', on);
    document.body.classList.toggle('has-fullscreen-drawing', on);
    fsBtn.innerHTML = '';
    fsBtn.appendChild(svg(on ? I.close : I.expand));
    fsBtn.setAttribute('aria-label', on ? 'Vollbild beenden' : 'Vollbild');
    requestAnimationFrame(layout);
  }

  async function toText() {
    if (!b.strokes.length) {
      toast('Schreibe zuerst etwas');
      return;
    }
    const blob = await drawingToBlob(b);
    ed.app.ai.handwritingToText(ed, b, blob, aiBtn);
  }

  renderPalette();
  return wrap;
}

// ---------------------------------------------------------------------------
function drawStroke(ctx, s, dark) {
  const p = s.p;
  const n = p.length / 3;
  if (!n) return;
  ctx.strokeStyle = colorOf(s, dark);
  ctx.fillStyle = ctx.strokeStyle;
  if (s.t === 'hl') {
    ctx.save();
    ctx.globalAlpha = dark ? 0.38 : 0.42;
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
    ctx.lineWidth = s.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    if (n === 1) ctx.lineTo(p[0] + 0.1, p[1]);
    for (let i = 1; i < n - 1; i++) {
      const mx = (p[i * 3] + p[i * 3 + 3]) / 2;
      const my = (p[i * 3 + 1] + p[i * 3 + 4]) / 2;
      ctx.quadraticCurveTo(p[i * 3], p[i * 3 + 1], mx, my);
    }
    if (n > 1) ctx.lineTo(p[(n - 1) * 3], p[(n - 1) * 3 + 1]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const wAt = (i) => s.w * (0.45 + (p[i * 3 + 2] / 100) * 1.1);
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], wAt(0) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  let px = p[0];
  let py = p[1];
  for (let i = 1; i < n; i++) {
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const nx = i < n - 1 ? (x + p[i * 3 + 3]) / 2 : x;
    const ny = i < n - 1 ? (y + p[i * 3 + 4]) / 2 : y;
    ctx.beginPath();
    ctx.lineWidth = (wAt(i - 1) + wAt(i)) / 2;
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(x, y, nx, ny);
    ctx.stroke();
    px = nx;
    py = ny;
  }
}

function hitStroke(s, x, y, r) {
  const p = s.p;
  const r2 = r * r;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - x;
    const dy = p[i + 1] - y;
    if (dx * dx + dy * dy <= r2) return true;
    if (i + 3 < p.length && segDist2(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= r2) return true;
  }
  return false;
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

// Ramer-Douglas-Peucker auf [x,y,p]-Tripeln
function simplify(p, eps) {
  const n = p.length / 3;
  if (n < 3) return p;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const e2 = eps * eps;
  while (stack.length) {
    const [a, c] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < c; i++) {
      const d = segDist2(p[i * 3], p[i * 3 + 1], p[a * 3], p[a * 3 + 1], p[c * 3], p[c * 3 + 1]);
      // Druckwechsel erhalten
      const dp = Math.abs(p[i * 3 + 2] - (p[a * 3 + 2] + p[c * 3 + 2]) / 2) > 18 ? e2 * 2 : 0;
      if (d + dp > maxD) {
        maxD = d + dp;
        idx = i;
      }
    }
    if (maxD > e2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, c]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  return out;
}

// Rendert eine Zeichnung (zugeschnitten) als PNG für die KI
export function drawingToBlob(b) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of b.strokes) {
    for (let i = 0; i < s.p.length; i += 3) {
      minX = Math.min(minX, s.p[i] - s.w);
      maxX = Math.max(maxX, s.p[i] + s.w);
      minY = Math.min(minY, s.p[i + 1] - s.w);
      maxY = Math.max(maxY, s.p[i + 1] + s.w);
    }
  }
  const pad = 24;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W, maxX + pad);
  maxY = Math.min(b.h, maxY + pad);
  const w = Math.max(50, maxX - minX);
  const hh = Math.max(50, maxY - minY);
  const k = Math.min(2, 1600 / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(hh * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -minX * k, -minY * k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of b.strokes) if (s.t === 'hl') drawStroke(ctx, s, false);
  for (const s of b.strokes) if (s.t !== 'hl') drawStroke(ctx, s, false);
  return new Promise((resolve) => c.toBlob((bl) => resolve(bl), 'image/png'));
}

export function newDrawingBlock() {
  return newBlock('drawing');
}
