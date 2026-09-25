// KI-Funktionen über Claude (Artifact-Fähigkeit "sample")
// In der gehosteten Cloudflare-Version gibt es kein window.claude → Hinweis mit Link zur Artifact-Version.

import { h, svg, uid, toast, copyText, dataUrlToBlob, isNarrow, todayISO, fmtDate } from './util.js';
import { I } from './icons.js';
import { popover, modal, menu } from './menus.js';
import { markdownToBlocks, blocksToMarkdown, blocksToPlain, mdToHtmlPreview } from './markdown.js';
import { renderMathIn } from './blocks.js';
import { newBlock, pageTitle, TEXT_TYPES } from './model.js';
import { htmlToText, sanitizeInline, getSelectionRange } from './inline.js';

const MAX_CTX = 24000;

const ERR = {
  not_granted: 'Claude ist für diese Seite nicht erlaubt. Du kannst es beim nächsten Öffnen erlauben.',
  sampling_disabled: 'Claude ist für dein Konto gerade nicht verfügbar.',
  not_declared: 'Diese Version hat keinen KI-Zugriff.',
  capability_disabled: 'KI ist in dieser Ansicht nicht verfügbar.',
  capability_removed: 'KI ist in dieser App-Version nicht verfügbar.',
  rate_limited: 'Zu viele Anfragen – warte kurz und versuche es dann erneut.',
  session_expired: 'Bitte melde dich bei Claude erneut an.',
  refused: 'Claude hat diese Anfrage abgelehnt. Formuliere sie anders.',
  empty_completion: 'Claude hat keine Antwort geliefert. Versuche es mit weniger Inhalt.',
  invalid_json: 'Die Antwort ließ sich nicht auswerten. Versuche es erneut.',
  prompt_too_large: 'Die Seite ist zu lang für eine Anfrage. Markiere einen Abschnitt und versuche es damit.',
  images_unavailable: 'Bilder können in dieser Ansicht nicht an Claude geschickt werden.',
  image_rejected: 'Das Bild wurde nicht akzeptiert (zu groß oder falsches Format).',
  tools_unavailable: 'Werkzeuge sind hier nicht verfügbar.',
  upstream_error: 'Verbindung zu Claude unterbrochen. Versuche es erneut.',
};
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed']);

export class AI {
  constructor(app) {
    this.app = app;
    this.sample = null;
    this.available = false;
    this.limits = null;
    this.chat = [];
    this.panel = null;
  }

  async init() {
    if (!window.claude || typeof window.claude.use !== 'function') return false;
    try {
      this.sample = await window.claude.use('sample');
    } catch {
      this.sample = null;
    }
    this.available = !!this.sample;
    if (this.available) {
      try {
        this.limits = await this.sample.limits();
      } catch {
        this.limits = null;
      }
    }
    return this.available;
  }

  get canImages() {
    return !!(this.limits && this.limits.images);
  }
  get canTools() {
    return !!(this.limits && this.limits.tools);
  }

  handleError(e, where) {
    const code = (e && e.code) || 'upstream_error';
    if (code === 'cancelled') return;
    const msg = ERR[code] || ERR.upstream_error;
    if (where) where.textContent = msg;
    else toast(msg, { kind: 'error', duration: 5000 });
    if (PERMANENT.has(code)) {
      this.available = false;
      this.app.onAIChanged && this.app.onAIChanged();
    }
  }

  explainUnavailable() {
    const url = this.app.config.artifactUrl;
    const body = h(
      'div',
      { class: 'ai-unavail' },
      h('div', { class: 'ai-unavail-ico' }, svg(I.sparkle)),
      h('h3', {}, 'KI über Claude'),
      h('p', {}, 'Die KI-Funktionen (Zusammenfassen, Karteikarten, Quiz, Handschrift in Text, Fragen an deine Notizen) laufen über Claude. Öffne dafür Notes in der Claude-App – deine Notizen sind dort dieselben, weil beide Versionen deine Cloudflare-Datenbank nutzen.'),
      url ? h('a', { class: 'btn btn-prominent', href: url, target: '_blank', rel: 'noopener' }, 'In Claude öffnen') : h('p', { class: 'muted' }, 'Die Claude-Version findest du in deinen Artifacts auf claude.ai.')
    );
    modal(body, { title: 'KI-Assistent', class: 'modal-sm' });
  }

  // ------------------------------------------------------------------
  pageContext(page, max = MAX_CTX) {
    const md = blocksToMarkdown(page.blocks || [], { pageTitle: (id) => pageTitle(this.app.getPage(id)) });
    let props = '';
    if (page.isRow) {
      const db = this.app.getPage(page.parentId);
      if (db) props = this.app.rowPropsText(page, db);
    }
    const text = `# ${pageTitle(page)}\n${props}\n${md}`;
    return text.length > max ? text.slice(0, max) + '\n\n[… gekürzt]' : text;
  }

  async ask(prompt, opts = {}) {
    if (!this.available) {
      this.explainUnavailable();
      throw { code: 'cancelled' };
    }
    return this.sample(prompt, opts);
  }

  async askJson(prompt, opts = {}) {
    if (!this.available) {
      this.explainUnavailable();
      throw { code: 'cancelled' };
    }
    return this.sample.json(prompt, opts);
  }

  // ------------------------------------------------------------------
  // Karteikarten & Quiz
  // ------------------------------------------------------------------
  async makeFlashcards(ed, b, anchor) {
    const page = ed.page;
    const done = this.busy(anchor, 'Claude erstellt Karteikarten …');
    try {
      const existing = (b.cards || []).map((c) => htmlToText(c.q)).filter(Boolean);
      const data = await this.askJson(
        `Du bist ein Lerncoach für Studierende. Erstelle aus den folgenden Notizen 8 bis 15 prägnante Karteikarten auf Deutsch (Fachbegriffe dürfen im Original bleiben).\n` +
          `Regeln: Eine Idee pro Karte. Vorderseite als Frage oder Begriff, Rückseite als kurze, präzise Antwort (max. 2 Sätze). Mathematik als LaTeX zwischen $…$.\n` +
          (existing.length ? `Diese Fragen gibt es schon, wiederhole sie nicht: ${existing.slice(0, 40).join(' | ')}\n` : '') +
          `Antworte nur mit einem JSON-Array, z. B. [{"q":"Was ist …?","a":"…"}].\n\nNOTIZEN:\n${this.pageContext(page)}`,
        { modelTier: 'default' }
      );
      const cards = (Array.isArray(data) ? data : data && data.cards) || [];
      const clean = cards.filter((c) => c && c.q && c.a).map((c) => ({ id: uid('k'), q: mdInline(String(c.q)), a: mdInline(String(c.a)), box: 0, due: 0 }));
      if (!clean.length) throw { code: 'invalid_json' };
      ed.history.structural();
      b.cards = [...(b.cards || []).filter((c) => htmlToText(c.q).trim()), ...clean];
      ed.rerenderBlock(b);
      ed.app.touch(page);
      toast(`${clean.length} Karteikarten erstellt`);
    } catch (e) {
      this.handleError(e);
    } finally {
      done();
    }
  }

  async makeQuiz(ed, b, anchor) {
    const page = ed.page;
    const done = this.busy(anchor, 'Claude erstellt ein Quiz …');
    try {
      const data = await this.askJson(
        `Erstelle ein Multiple-Choice-Quiz (6 Fragen) auf Deutsch zu den folgenden Lernnotizen. Prüfe Verständnis, nicht nur Auswendiglernen. Jede Frage hat genau 4 Antwortoptionen, genau eine ist richtig; die falschen sollen plausibel sein. ` +
          `Gib zu jeder Frage eine kurze Erklärung. Mathematik als LaTeX zwischen $…$.\n` +
          `Antworte nur mit JSON: [{"q":"…","options":["…","…","…","…"],"correct":0,"explain":"…"}]\n\nNOTIZEN:\n${this.pageContext(page)}`,
        { modelTier: 'default' }
      );
      const qs = (Array.isArray(data) ? data : data && data.questions) || [];
      const clean = qs
        .filter((q) => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
        .map((q) => ({ q: String(q.q), options: q.options.slice(0, 6).map((o) => String(o)), correct: Math.max(0, Math.min(q.options.length - 1, Number(q.correct) || 0)), explain: String(q.explain || '') }));
      if (!clean.length) throw { code: 'invalid_json' };
      ed.history.structural();
      b.questions = clean;
      ed.rerenderBlock(b);
      ed.app.touch(page);
      toast(`Quiz mit ${clean.length} Fragen erstellt`);
    } catch (e) {
      this.handleError(e);
    } finally {
      done();
    }
  }

  busy(anchor, text) {
    const el = anchor && anchor.closest ? anchor : null;
    if (el) {
      el.classList.add('is-busy');
      el.disabled = true;
    }
    const t = toast(h('span', { class: 'ai-busy' }, h('span', { class: 'spinner' }), ' ', text), { duration: 120000 });
    return () => {
      if (el) {
        el.classList.remove('is-busy');
        el.disabled = false;
      }
      t.remove();
    };
  }

  // ------------------------------------------------------------------
  // Handschrift & Bilder
  // ------------------------------------------------------------------
  async handwritingToText(ed, b, blob, anchor) {
    if (!this.canImages) return toast(ERR.images_unavailable, { kind: 'error' });
    const done = this.busy(anchor, 'Claude liest deine Handschrift …');
    try {
      const { text } = await this.ask(
        'Das Bild zeigt handschriftliche Lernnotizen (Apple Pencil). Übertrage sie originalgetreu in sauberes Markdown auf Deutsch (bzw. in der Sprache der Notiz). ' +
          'Übernimm Struktur (Überschriften, Aufzählungen, Pfeile als →). Formeln als LaTeX: inline $…$, abgesetzt $$…$$. Skizzen kurz in *kursiv* beschreiben. ' +
          'Wenn etwas unleserlich ist, schreibe [unleserlich]. Antworte nur mit dem Markdown, ohne Einleitung.',
        { images: blob, modelTier: 'default' }
      );
      const blocks = markdownToBlocks(text);
      if (!blocks.length) throw { code: 'empty_completion' };
      blocks.unshift(newBlock('callout', { icon: '✍️', bg: 'purple', text: '<b>Aus Handschrift übertragen</b> – prüfe Formeln und Begriffe.' }));
      ed.insertBlocksAfter(b.id, blocks, false);
      toast('Handschrift übertragen');
    } catch (e) {
      this.handleError(e);
    } finally {
      done();
    }
  }

  imageActions(ed, b, anchor) {
    if (!this.canImages) return toast(ERR.images_unavailable, { kind: 'error' });
    const run = async (kind) => {
      const prompts = {
        text: 'Erkenne den gesamten Text auf dem Bild (z. B. Tafel, Folie, Skript, Buchseite) und gib ihn als sauberes Markdown wieder. Formeln als LaTeX ($…$ bzw. $$…$$). Nur das Markdown.',
        notes: 'Das Bild stammt aus einer Lehrveranstaltung (Tafel, Folie oder Skript). Erstelle daraus strukturierte Lernnotizen auf Deutsch in Markdown: Überschrift, Kernaussagen als Aufzählung, wichtige Definitionen fett, Formeln als LaTeX, am Ende „Offene Fragen“ als To-do-Liste (- [ ] …). Nur das Markdown.',
        explain: 'Erkläre verständlich auf Deutsch, was auf diesem Bild zu sehen ist und was man daraus lernen soll (für Studierende). Nutze Markdown mit kurzen Abschnitten. Formeln als LaTeX.',
      };
      const done = this.busy(anchor, 'Claude wertet das Bild aus …');
      try {
        const blob = dataUrlToBlob(b.src);
        const { text } = await this.ask(prompts[kind], { images: blob });
        const blocks = markdownToBlocks(text);
        ed.insertBlocksAfter(b.id, blocks, false);
        toast('Eingefügt');
      } catch (e) {
        this.handleError(e);
      } finally {
        done();
      }
    };
    menu(
      anchor,
      [
        { label: 'Notizen aus Foto erstellen', icon: I.pageText, onSelect: () => run('notes') },
        { label: 'Text erkennen', icon: I.text, onSelect: () => run('text') },
        { label: 'Erklären', icon: I.info, onSelect: () => run('explain') },
      ],
      { title: 'Bild mit Claude auswerten' }
    );
  }

  // Foto → neue Notizseite (aus der Werkzeugleiste)
  photoToNotes(targetPage) {
    if (!this.available) return this.explainUnavailable();
    if (!this.canImages) return toast(ERR.images_unavailable, { kind: 'error' });
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      const ed = this.app.editor;
      if (!ed) return;
      const last = ed.blocks[ed.blocks.length - 1];
      const imgBlock = await ed.insertImageFile(f, (ed.focusedId && ed.indexOf(ed.focusedId) >= 0 ? ed.focusedId : last.id));
      if (imgBlock) {
        const anchor = ed.els.get(imgBlock.id);
        this.imageActions(ed, imgBlock, anchor.querySelector('.image-actions') || anchor);
      }
    });
    document.body.appendChild(input);
    input.click();
    void targetPage;
  }

  // ------------------------------------------------------------------
  // Text-Aktionen (Auswahl / Block)
  // ------------------------------------------------------------------
  textActionItems() {
    return [
      { id: 'improve', label: 'Schreiben verbessern', icon: I.sparkle, prompt: 'Verbessere Stil, Klarheit und Rechtschreibung des folgenden Textes. Bedeutung und Sprache beibehalten.' },
      { id: 'fix', label: 'Rechtschreibung & Grammatik', icon: I.check, prompt: 'Korrigiere nur Rechtschreibung, Grammatik und Zeichensetzung im folgenden Text. Sonst nichts ändern.' },
      { id: 'simplify', label: 'Einfacher erklären', icon: I.info, prompt: 'Erkläre den folgenden Inhalt einfacher und anschaulicher für Studierende im ersten Semester, gern mit einem Beispiel.' },
      { id: 'explain', label: 'Erklären lassen', icon: I.quiz, prompt: 'Erkläre ausführlich und verständlich, was der folgende Text bedeutet, inklusive Hintergrund und einem Beispiel.' },
      { id: 'shorter', label: 'Kürzer', icon: I.outdent, prompt: 'Kürze den folgenden Text auf das Wesentliche (etwa die Hälfte).' },
      { id: 'longer', label: 'Ausführlicher', icon: I.indent, prompt: 'Formuliere den folgenden Text ausführlicher mit mehr Details und Erklärungen.' },
      { id: 'summary', label: 'Zusammenfassen', icon: I.list, prompt: 'Fasse den folgenden Text in 3–5 Stichpunkten zusammen.' },
      { id: 'continue', label: 'Weiterschreiben', icon: I.pen, prompt: 'Schreibe den folgenden Text sinnvoll weiter (1–2 Absätze), im gleichen Stil.' },
      { id: 'en', label: 'Ins Englische übersetzen', icon: I.link, prompt: 'Übersetze den folgenden Text ins Englische.' },
      { id: 'it', label: 'Ins Italienische übersetzen', icon: I.link, prompt: 'Übersetze den folgenden Text ins Italienische.' },
      { id: 'de', label: 'Ins Deutsche übersetzen', icon: I.link, prompt: 'Übersetze den folgenden Text ins Deutsche.' },
    ];
  }

  selectionActions(ed, anchor, range) {
    const saved = range || (getSelectionRange() && getSelectionRange().cloneRange());
    if (!saved || saved.collapsed) return;
    const text = saved.toString();
    const t = saved.startContainer.parentElement && saved.startContainer.parentElement.closest('.blk-text');
    const b = t && ed.blockOf(t);
    const items = this.textActionItems().map((a) => ({
      label: a.label,
      icon: a.icon,
      onSelect: () => this.runTextAction(ed, a, text, { b, range: saved, anchor: anchor instanceof Element ? anchor : null, rect: saved.getBoundingClientRect() }),
    }));
    items.push({ divider: true });
    items.push({ label: 'Eigene Anweisung …', icon: I.pen, onSelect: () => this.customInstruction(ed, text, { b, range: saved, rect: saved.getBoundingClientRect() }) });
    menu(anchor, items, { title: 'Claude', search: true, searchPlaceholder: 'KI-Aktion suchen …' });
  }

  blockActions(ed, ids, anchor) {
    const blocks = ids.map((id) => ed.blocks[ed.indexOf(id)]).filter(Boolean);
    const md = blocksToMarkdown(blocks, { pageTitle: (id) => pageTitle(this.app.getPage(id)) });
    const items = this.textActionItems().map((a) => ({
      label: a.label,
      icon: a.icon,
      onSelect: () => this.runTextAction(ed, a, md, { blockIds: ids, rect: anchor.getBoundingClientRect() }),
    }));
    items.push({ divider: true });
    items.push({ label: 'Eigene Anweisung …', icon: I.pen, onSelect: () => this.customInstruction(ed, md, { blockIds: ids, rect: anchor.getBoundingClientRect() }) });
    menu(anchor, items, { title: 'Claude', search: true });
  }

  customInstruction(ed, text, target) {
    const input = h('textarea', { class: 'input', rows: '3', placeholder: 'z. B. „Mach daraus eine Tabelle“ oder „Formuliere als Prüfungsfrage“' });
    const go = () => {
      const v = input.value.trim();
      if (!v) return;
      m.close();
      this.runTextAction(ed, { id: 'custom', label: v, prompt: v }, text, target);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        go();
      }
    });
    const m = modal(h('div', { class: 'confirm' }, input, h('div', { class: 'confirm-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Abbrechen'), h('button', { class: 'btn btn-prominent', onclick: go }, 'Los'))), { title: 'Anweisung an Claude', class: 'modal-sm' });
    input.focus();
  }

  runTextAction(ed, action, text, target) {
    const out = h('div', { class: 'ai-result md' }, h('span', { class: 'ai-thinking' }, h('span', { class: 'spinner' }), ' Claude denkt nach …'));
    const note = h('div', { class: 'ai-note' });
    const ctl = new AbortController();
    let result = '';
    const btnReplace = h('button', { class: 'btn btn-prominent btn-sm', type: 'button', disabled: true }, 'Ersetzen');
    const btnInsert = h('button', { class: 'btn btn-tinted btn-sm', type: 'button', disabled: true }, 'Darunter einfügen');
    const btnCopy = h('button', { class: 'btn btn-sm', type: 'button', disabled: true }, 'Kopieren');
    const btnStop = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctl.abort() }, 'Stopp');
    const box = h('div', { class: 'ai-pop' }, h('div', { class: 'ai-pop-head' }, svg(I.sparkle), ' ', action.label), out, note, h('div', { class: 'confirm-actions' }, btnStop, btnCopy, btnInsert, btnReplace));
    const rect = target.rect || (target.anchor && target.anchor.getBoundingClientRect());
    const pop = popover(rect || document.body.getBoundingClientRect(), box, { title: 'Claude', onClose: () => ctl.abort() });
    const inline = !!target.range;
    const prompt =
      `${action.prompt}\nAntworte nur mit dem Ergebnis${inline ? ' als Fließtext (kein Markdown außer **fett**, *kursiv* und $Formeln$)' : ' in Markdown'}, ohne Einleitung oder Kommentar.\n\n` +
      `Kontext – Seite „${pageTitle(ed.page)}“ (nur zur Orientierung):\n${this.pageContext(ed.page, 6000)}\n\nTEXT:\n${text}`;
    const quick = ['fix', 'shorter', 'en', 'it', 'de'].includes(action.id);
    this.ask(prompt, {
      signal: ctl.signal,
      cache: false,
      modelTier: quick ? 'quick' : 'default',
      onText: ({ text: t }) => {
        result = t;
        out.innerHTML = mdToHtmlPreview(t);
        renderMathIn(out);
        pop.reposition();
      },
    })
      .then(({ text: t, truncated }) => {
        result = t;
        out.innerHTML = mdToHtmlPreview(t);
        renderMathIn(out);
        if (truncated) note.textContent = 'Die Antwort wurde gekürzt.';
        btnStop.remove();
        [btnReplace, btnInsert, btnCopy].forEach((x) => (x.disabled = false));
        pop.reposition();
      })
      .catch((e) => {
        if (e && e.text) {
          out.innerHTML = mdToHtmlPreview(e.text);
          result = e.text;
          [btnInsert, btnCopy].forEach((x) => (x.disabled = false));
        } else out.textContent = '';
        this.handleError(e, note);
        btnStop.remove();
      });
    btnCopy.onclick = () => {
      copyText(result);
      toast('Kopiert');
    };
    btnInsert.onclick = () => {
      pop.close();
      const blocks = markdownToBlocks(result);
      const after = target.blockIds ? target.blockIds[target.blockIds.length - 1] : target.b ? target.b.id : null;
      ed.insertBlocksAfter(after, blocks, false);
    };
    btnReplace.onclick = () => {
      pop.close();
      if (target.range && target.b) {
        const t = ed.textEl(target.b.id);
        t.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(target.range);
        const html = sanitizeInline(markdownToBlocks(result).map((x) => x.text || '').join('<br>'));
        document.execCommand('insertHTML', false, html);
        target.b.text = sanitizeInline(t.innerHTML);
        ed.changed(target.b, true);
      } else if (target.blockIds) {
        const blocks = markdownToBlocks(result);
        if (!blocks.length) return;
        ed.history.structural();
        const [first, ...rest] = target.blockIds;
        for (const id of rest) ed.removeBlock(id, { noHistory: true, trashSubpage: false });
        ed.clearSelection();
        ed.replaceBlockWith(first, blocks, { noHistory: true });
      }
    };
  }

  // /ki im Editor: Claude schreibt an dieser Stelle
  inlineWrite(ed, b) {
    const el = ed.els.get(b.id);
    const box = h('div', { class: 'ai-inline' });
    const input = h('textarea', { class: 'ai-inline-input', rows: '1', placeholder: 'Was soll Claude schreiben? z. B. „Gliederung für die Hausarbeit“' });
    const out = h('div', { class: 'ai-result md', hidden: true });
    const suggestions = h(
      'div',
      { class: 'chips' },
      [
        ['Weiterschreiben', 'Schreibe die Notizen dieser Seite an dieser Stelle sinnvoll weiter.'],
        ['Zusammenfassung', 'Schreibe eine kompakte Zusammenfassung dieser Seite mit den wichtigsten Punkten.'],
        ['Beispiele', 'Ergänze anschauliche Beispiele zu den Konzepten dieser Seite.'],
        ['Gliederung', 'Erstelle eine sinnvolle Gliederung (Überschriften und Stichpunkte) zum Thema dieser Seite.'],
        ['Prüfungsfragen', 'Formuliere 5 typische Prüfungsfragen zu dieser Seite, jeweils mit kurzer Musterantwort in einem Toggle-Stil (Frage als Aufzählungspunkt, Antwort eingerückt).'],
      ].map(([l, p]) => h('button', { class: 'chip-btn', type: 'button', onclick: () => { input.value = p; go(); } }, l))
    );
    const actions = h('div', { class: 'confirm-actions' });
    const cancel = () => {
      ctl && ctl.abort();
      box.remove();
      el.classList.remove('ai-writing');
      ed.focusBlock(b.id, -1);
    };
    let ctl = null;
    let result = '';
    const go = () => {
      const q = input.value.trim();
      if (!q) return;
      ctl = new AbortController();
      suggestions.hidden = true;
      out.hidden = false;
      out.innerHTML = '<span class="ai-thinking"><span class="spinner"></span> Claude schreibt …</span>';
      actions.innerHTML = '';
      actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctl.abort() }, 'Stopp'));
      this.ask(
        `Du hilfst einer/einem Studierenden beim Schreiben von Lernnotizen. Aufgabe: ${q}\nSchreibe auf Deutsch in Markdown (Überschriften ##, Listen, **fett**, To-dos "- [ ]", Formeln $…$ / $$…$$, Code in \`\`\`). Keine Einleitung, nur der Inhalt.\n\nAKTUELLE SEITE:\n${this.pageContext(ed.page)}`,
        {
          signal: ctl.signal,
          cache: false,
          onText: ({ text }) => {
            result = text;
            out.innerHTML = mdToHtmlPreview(text);
            renderMathIn(out);
          },
        }
      )
        .then(({ text }) => {
          result = text;
          out.innerHTML = mdToHtmlPreview(text);
          renderMathIn(out);
          showDone();
        })
        .catch((e) => {
          if (e && e.text) {
            result = e.text;
            showDone();
          } else {
            out.textContent = '';
            actions.innerHTML = '';
            actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: cancel }, 'Schließen'));
          }
          this.handleError(e);
        });
    };
    const showDone = () => {
      actions.innerHTML = '';
      actions.append(
        h('button', { class: 'btn btn-sm', type: 'button', onclick: cancel }, 'Verwerfen'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go() }, 'Neu versuchen'),
        h('button', {
          class: 'btn btn-prominent btn-sm',
          type: 'button',
          onclick: () => {
            const blocks = markdownToBlocks(result);
            box.remove();
            el.classList.remove('ai-writing');
            const empty = TEXT_TYPES.has(b.type) && !htmlToText(b.text).trim();
            if (!blocks.length) return;
            if (empty) ed.replaceBlockWith(b.id, blocks);
            else {
              ed.insertBlocksAfter(b.id, blocks);
              ed.ensureTrailingParagraph();
              ed.refreshLayout();
            }
          },
        }, 'Übernehmen')
      );
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        go();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    });
    actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: cancel }, 'Abbrechen'), h('button', { class: 'btn btn-prominent btn-sm', type: 'button', onclick: go }, 'Schreiben'));
    box.append(h('div', { class: 'ai-inline-head' }, svg(I.sparkle), ' Claude'), input, suggestions, out, actions);
    el.classList.add('ai-writing');
    el.querySelector('.blk-body').appendChild(box);
    input.focus(); // synchron, damit iOS die Tastatur öffnet und kein Tippen verloren geht
  }

  // ------------------------------------------------------------------
  // Assistent-Panel (Seiten-Aktionen + Chat)
  // ------------------------------------------------------------------
  quickActions() {
    return [
      { id: 'summary', label: 'Zusammenfassen', icon: I.list },
      { id: 'cards', label: 'Karteikarten', icon: I.cards },
      { id: 'quiz', label: 'Quiz', icon: I.quiz },
      { id: 'simple', label: 'Einfach erklären', icon: I.info },
      { id: 'plan', label: 'Lernplan', icon: I.calendar },
      { id: 'glossary', label: 'Glossar', icon: I.type },
      { id: 'questions', label: 'Prüfungsfragen', icon: I.hash },
      { id: 'gaps', label: 'Lücken finden', icon: I.search },
      { id: 'translate', label: 'Übersetzen', icon: I.link },
    ];
  }

  openPanel(opts = {}) {
    if (!this.available) return this.explainUnavailable();
    if (this.panel && this.panel.isConnected) {
      this.panel.classList.add('open');
      this.panel.querySelector('textarea').focus();
      return;
    }
    const app = this.app;
    const panel = h('aside', { class: 'ai-panel glass-panel', role: 'dialog', 'aria-label': 'KI-Assistent' });
    const msgs = h('div', { class: 'ai-msgs' });
    const scope = { workspace: !!opts.workspace };
    const scopeSeg = h(
      'div',
      { class: 'segmented segmented-sm' },
      h('button', { type: 'button', class: scope.workspace ? '' : 'on', onclick: () => setScope(false) }, 'Diese Seite'),
      h('button', { type: 'button', class: scope.workspace ? 'on' : '', onclick: () => setScope(true) }, 'Alle Notizen')
    );
    const setScope = (w) => {
      scope.workspace = w;
      scopeSeg.children[0].classList.toggle('on', !w);
      scopeSeg.children[1].classList.toggle('on', w);
    };
    const quick = h(
      'div',
      { class: 'ai-quick' },
      this.quickActions().map((a) => h('button', { class: 'ai-quick-btn', type: 'button', onclick: () => this.runQuick(a.id, msgs) }, svg(a.icon), h('span', {}, a.label)))
    );
    const input = h('textarea', { class: 'ai-input', rows: '1', placeholder: 'Frag Claude zu deinen Notizen …', 'aria-label': 'Nachricht an Claude' });
    const sendBtn = h('button', { class: 'ai-send', type: 'button', 'aria-label': 'Senden' }, svg(I.arrowUp));
    const composer = h('div', { class: 'ai-composer glass' }, input, sendBtn);
    const close = h('button', { class: 'glass-btn', type: 'button', 'aria-label': 'Schließen', onclick: () => this.closePanel() }, svg(I.close));
    const clear = h('button', { class: 'glass-btn', type: 'button', 'aria-label': 'Neuer Chat', title: 'Neuer Chat', onclick: () => { this.chat = []; msgs.innerHTML = ''; msgs.appendChild(this.welcome()); } }, svg(I.refresh));
    panel.append(
      h('div', { class: 'ai-head' }, h('div', { class: 'ai-title' }, h('span', { class: 'ai-logo' }, svg(I.sparkle)), 'Claude'), h('div', { class: 'ai-head-actions' }, clear, close)),
      h('div', { class: 'ai-scope' }, scopeSeg),
      h('div', { class: 'ai-scroll' }, quick, msgs),
      composer
    );
    msgs.appendChild(this.welcome());
    for (const m of this.chat) msgs.appendChild(this.bubble(m.role, m.content, m.role === 'assistant'));
    const send = () => {
      const q = input.value.trim();
      if (!q || this.streaming) return;
      input.value = '';
      input.style.height = '';
      this.sendChat(q, msgs, scope.workspace, sendBtn);
    };
    sendBtn.addEventListener('click', () => {
      if (this.streaming && this.ctl) this.ctl.abort();
      else send();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(140, input.scrollHeight) + 'px';
    });
    document.body.appendChild(panel);
    document.body.classList.add('ai-open');
    requestAnimationFrame(() => panel.classList.add('open'));
    this.panel = panel;
    if (!isNarrow()) setTimeout(() => input.focus(), 200);
  }

  closePanel() {
    if (!this.panel) return;
    this.ctl && this.ctl.abort();
    const p = this.panel;
    p.classList.remove('open');
    document.body.classList.remove('ai-open');
    setTimeout(() => p.remove(), 280);
    this.panel = null;
  }

  welcome() {
    const page = this.app.currentPage();
    return h(
      'div',
      { class: 'ai-welcome' },
      h('p', {}, page ? `Ich kenne die Seite „${pageTitle(page)}“. Wähle oben eine Aktion oder stelle eine Frage.` : 'Stelle eine Frage zu deinen Notizen.'),
      h('p', { class: 'muted' }, 'Antworten nutzen dein Claude-Kontingent. Die erste Anfrage fragt nach deiner Erlaubnis.')
    );
  }

  bubble(role, content, isMd) {
    const b = h('div', { class: 'ai-msg ai-' + role });
    const body = h('div', { class: 'ai-msg-body md' });
    if (isMd) {
      body.innerHTML = mdToHtmlPreview(content);
      renderMathIn(body);
    } else body.textContent = content;
    b.appendChild(body);
    if (role === 'assistant' && content) b.appendChild(this.msgActions(content));
    return b;
  }

  msgActions(content) {
    return h(
      'div',
      { class: 'ai-msg-actions' },
      h('button', { class: 'chip-btn', type: 'button', onclick: () => this.insertIntoPage(content) }, svg(I.plus), ' In Seite einfügen'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => this.newPageFrom(content) }, svg(I.page), ' Als neue Seite'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => { copyText(content); toast('Kopiert'); } }, svg(I.copy), ' Kopieren')
    );
  }

  insertIntoPage(md) {
    const ed = this.app.editor;
    if (!ed) return toast('Öffne zuerst eine Seite');
    const blocks = markdownToBlocks(md);
    const after = ed.focusedId && ed.indexOf(ed.focusedId) >= 0 ? ed.focusedId : ed.blocks[ed.blocks.length - 1]?.id;
    ed.insertBlocksAfter(after, blocks, false);
    toast('In die Seite eingefügt');
    if (isNarrow()) this.closePanel();
  }

  newPageFrom(md) {
    const blocks = markdownToBlocks(md);
    let title = 'KI-Notiz';
    if (blocks[0] && /^h[123]$/.test(blocks[0].type)) {
      title = htmlToText(blocks[0].text);
      blocks.shift();
    }
    const cur = this.app.currentPage();
    const p = this.app.createPage({ title, icon: '✨', blocks: blocks.length ? blocks : [newBlock('p')], parentId: cur && !cur.isRow ? cur.id : null }, { navigate: true });
    if (cur && !cur.isRow && this.app.editor) {
      /* Unterseite verlinken */
      const ed = this.app.editor;
      void ed;
    }
    if (isNarrow()) this.closePanel();
    return p;
  }

  async runQuick(id, msgs) {
    const app = this.app;
    const page = app.currentPage();
    const ed = app.editor;
    if (!page || !ed) return toast('Öffne zuerst eine Seite');
    if (id === 'cards' || id === 'quiz') {
      const type = id === 'cards' ? 'flashcards' : 'quiz';
      let b = ed.blocks.find((x) => x.type === type);
      if (!b) {
        b = newBlock(type);
        const last = ed.blocks[ed.blocks.length - 1];
        ed.insertBlocksAfter(last.id, [newBlock('h2', { text: id === 'cards' ? 'Karteikarten' : 'Quiz' }), b], false);
      }
      msgs.appendChild(this.bubble('user', id === 'cards' ? 'Erstelle Karteikarten aus dieser Seite.' : 'Erstelle ein Quiz zu dieser Seite.'));
      const status = h('div', { class: 'ai-msg ai-assistant' }, h('div', { class: 'ai-msg-body' }, h('span', { class: 'spinner' }), id === 'cards' ? ' Karteikarten werden erstellt …' : ' Quiz wird erstellt …'));
      msgs.appendChild(status);
      if (id === 'cards') await this.makeFlashcards(ed, b, null);
      else await this.makeQuiz(ed, b, null);
      status.firstChild.textContent = id === 'cards' ? 'Fertig – die Karteikarten stehen unten auf der Seite.' : 'Fertig – das Quiz steht unten auf der Seite.';
      const el = ed.els.get(b.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const prompts = {
      summary: 'Fasse diese Lernnotizen strukturiert zusammen: zuerst ein Satz zum Kern, dann die wichtigsten Punkte als Aufzählung, dann „Merke“ mit 2–3 Kernaussagen.',
      simple: 'Erkläre den Inhalt dieser Notizen so einfach wie möglich (Feynman-Methode), mit Alltagsbeispielen und Analogien.',
      plan: `Erstelle einen realistischen Lernplan für diesen Stoff ab heute (${fmtDate(todayISO(), 'long')}). Teile den Stoff in Lerneinheiten à 25–50 Minuten auf, mit Datum und Wiederholungen (Spaced Repetition). Format: Überschriften pro Woche, darunter To-dos "- [ ] Mo 29.09.: …".`,
      glossary: 'Erstelle ein Glossar der wichtigsten Fachbegriffe aus diesen Notizen als Tabelle in Markdown (| Begriff | Erklärung |), alphabetisch.',
      questions: 'Formuliere 6 anspruchsvolle Prüfungsfragen zu diesen Notizen (offene Fragen) und gib zu jeder eine stichpunktartige Musterlösung.',
      gaps: 'Prüfe diese Lernnotizen kritisch: Welche wichtigen Aspekte des Themas fehlen, wo sind Unklarheiten oder mögliche Fehler? Gib konkrete Ergänzungsvorschläge als To-do-Liste.',
      translate: 'Übersetze diese Notizen ins Englische und behalte die Struktur (Markdown) bei.',
    };
    const label = this.quickActions().find((a) => a.id === id).label;
    await this.sendChat(label, msgs, false, null, prompts[id]);
  }

  async sendChat(q, msgs, workspace, sendBtn, instruction) {
    const app = this.app;
    const page = app.currentPage();
    msgs.appendChild(this.bubble('user', q));
    const bubble = h('div', { class: 'ai-msg ai-assistant' });
    const body = h('div', { class: 'ai-msg-body md' }, h('span', { class: 'ai-thinking' }, h('span', { class: 'spinner' }), ' Claude denkt nach …'));
    bubble.appendChild(body);
    msgs.appendChild(bubble);
    const scroller = msgs.closest('.ai-scroll');
    const scroll = () => scroller && (scroller.scrollTop = scroller.scrollHeight);
    scroll();
    this.ctl = new AbortController();
    this.streaming = true;
    if (sendBtn) {
      sendBtn.innerHTML = '';
      sendBtn.appendChild(svg(I.stop));
      sendBtn.setAttribute('aria-label', 'Stopp');
    }
    const rules =
      'Du bist Claude, Lernassistent in der Notiz-App „Notes“ einer/eines Studierenden. Antworte auf Deutsch (außer es wird anders gewünscht), präzise und gut strukturiert in Markdown (Überschriften ##, Listen, **fett**, Tabellen, Formeln als LaTeX $…$ bzw. $$…$$). ' +
      `Heute ist ${fmtDate(todayISO(), 'long')}. Beziehe dich auf die Notizen; wenn etwas nicht in den Notizen steht, sag das und ergänze Allgemeinwissen deutlich gekennzeichnet.`;
    let context = '';
    let tools;
    if (workspace) {
      const list = app.allPages().filter((p) => !p.isRow).map((p) => `- ${p.id}: ${pageTitle(p)}`).slice(0, 300).join('\n');
      context = `\n\nSEITEN IM LERNRAUM (ID: Titel):\n${list}`;
      if (this.canTools) {
        tools = [
          {
            name: 'search_notes',
            description: 'Durchsucht alle Notizen nach einem Stichwort. Gibt bis zu 8 Treffer mit Seiten-ID, Titel und Textausschnitt zurück.',
            inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Suchbegriff' } }, required: ['query'] },
            execute: ({ query }) => app.searchPages(String(query || ''), 8).map((r) => ({ id: r.page.id, title: pageTitle(r.page), snippet: r.snippet })),
          },
          {
            name: 'read_page',
            description: 'Liest den Inhalt einer Seite als Markdown (gekürzt auf 12000 Zeichen). Gibt Titel und Inhalt zurück.',
            inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Seiten-ID' } }, required: ['id'] },
            execute: ({ id }) => {
              const p = app.getPage(String(id));
              if (!p) throw new Error('Seite nicht gefunden');
              return { title: pageTitle(p), content: this.pageContext(p, 12000) };
            },
          },
          {
            name: 'upcoming_deadlines',
            description: 'Listet Einträge aus allen Datenbanken mit Datum in den nächsten 30 Tagen (Aufgaben, Abgaben, Prüfungen).',
            execute: () => app.upcoming(30).map((u) => ({ title: pageTitle(u.row), date: u.date, database: pageTitle(u.db), status: u.status || '' })),
          },
        ];
      } else {
        const up = app.upcoming(30).map((u) => `- ${u.date}: ${pageTitle(u.row)} (${pageTitle(u.db)}${u.status ? ', ' + u.status : ''})`).join('\n');
        context += `\n\nANSTEHENDE TERMINE:\n${up || '(keine)'}`;
        if (page) context += `\n\nAKTUELLE SEITE:\n${this.pageContext(page, 16000)}`;
      }
    } else if (page) context = `\n\nAKTUELLE SEITE:\n${this.pageContext(page)}`;
    const turns = [{ role: 'user', content: rules + context }];
    for (const m of this.chat.slice(-8)) turns.push({ role: m.role, content: m.content });
    turns.push({ role: 'user', content: instruction || q });
    let answer = '';
    try {
      const opts = {
        signal: this.ctl.signal,
        onText: ({ text }) => {
          answer = text;
          body.innerHTML = mdToHtmlPreview(text);
          renderMathIn(body);
          scroll();
        },
      };
      if (tools) opts.tools = tools;
      else opts.cache = false;
      const res = await this.sample(turns, opts);
      answer = res.text;
      body.innerHTML = mdToHtmlPreview(answer);
      renderMathIn(body);
      if (res.truncated) bubble.appendChild(h('div', { class: 'ai-note' }, 'Die Antwort wurde gekürzt.'));
      this.chat.push({ role: 'user', content: instruction || q }, { role: 'assistant', content: answer });
      bubble.appendChild(this.msgActions(answer));
    } catch (e) {
      if (e && e.text) {
        body.innerHTML = mdToHtmlPreview(e.text);
        bubble.appendChild(this.msgActions(e.text));
      } else if (!(e && e.code === 'cancelled')) body.textContent = '';
      if (e && e.code === 'cancelled') bubble.appendChild(h('div', { class: 'ai-note' }, 'Gestoppt.'));
      const note = h('div', { class: 'ai-note' });
      bubble.appendChild(note);
      this.handleError(e, note);
    } finally {
      this.streaming = false;
      if (sendBtn) {
        sendBtn.innerHTML = '';
        sendBtn.appendChild(svg(I.arrowUp));
        sendBtn.setAttribute('aria-label', 'Senden');
      }
      scroll();
    }
  }
}

function mdInline(s) {
  const blocks = markdownToBlocks(s);
  return sanitizeInline(blocks.map((b) => b.text || (b.tex ? `<span class="math" data-tex="${b.tex.replace(/"/g, '&quot;')}"></span>` : '')).join('<br>'));
}

export { blocksToPlain };
