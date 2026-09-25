// Datenmodell: Seiten, Blöcke, Datenbanken

import { uid, clone, todayISO } from './util.js';
import { I } from './icons.js';

export const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'toggle', 'quote', 'callout']);
export const LIST_TYPES = new Set(['ul', 'ol', 'todo', 'toggle']);

// Blocktypen für Slash-Menü & "Umwandeln in"
export const BLOCK_TYPES = [
  { type: 'p', label: 'Text', desc: 'Einfacher Absatz', icon: I.text, keys: 'text absatz paragraph plain', group: 'Grundlagen' },
  { type: 'h1', label: 'Überschrift 1', desc: 'Große Abschnittsüberschrift', icon: I.heading1, keys: 'h1 überschrift heading titel', group: 'Grundlagen', md: '#' },
  { type: 'h2', label: 'Überschrift 2', desc: 'Mittlere Überschrift', icon: I.heading2, keys: 'h2 überschrift heading', group: 'Grundlagen', md: '##' },
  { type: 'h3', label: 'Überschrift 3', desc: 'Kleine Überschrift', icon: I.heading3, keys: 'h3 überschrift heading', group: 'Grundlagen', md: '###' },
  { type: 'ul', label: 'Aufzählung', desc: 'Einfache Liste mit Punkten', icon: I.bullet, keys: 'liste bullet aufzählung ul punkt', group: 'Grundlagen', md: '-' },
  { type: 'ol', label: 'Nummerierte Liste', desc: 'Liste mit Nummern', icon: I.numbered, keys: 'nummer liste ol numbered', group: 'Grundlagen', md: '1.' },
  { type: 'todo', label: 'To-do-Liste', desc: 'Aufgaben zum Abhaken', icon: I.todo, keys: 'todo aufgabe checkbox check haken', group: 'Grundlagen', md: '[]' },
  { type: 'toggle', label: 'Toggle-Liste', desc: 'Inhalte ein- und ausklappen', icon: I.toggle, keys: 'toggle aufklappen einklappen', group: 'Grundlagen', md: '>' },
  { type: 'quote', label: 'Zitat', desc: 'Ein Zitat hervorheben', icon: I.quote, keys: 'zitat quote', group: 'Grundlagen', md: '"' },
  { type: 'callout', label: 'Hinweis', desc: 'Hervorgehobener Kasten', icon: I.callout, keys: 'hinweis callout box merke info', group: 'Grundlagen' },
  { type: 'divider', label: 'Trennlinie', desc: 'Abschnitte optisch trennen', icon: I.divider, keys: 'trennlinie divider linie hr', group: 'Grundlagen', md: '---' },
  { type: 'page', label: 'Unterseite', desc: 'Neue Seite in dieser Seite', icon: I.page, keys: 'seite page unterseite', group: 'Seiten' },
  { type: 'database', label: 'Datenbank', desc: 'Tabelle, Board oder Kalender', icon: I.database, keys: 'datenbank tabelle database board kalender', group: 'Seiten' },
  { type: 'toc', label: 'Inhaltsverzeichnis', desc: 'Überschriften dieser Seite', icon: I.toc, keys: 'inhalt toc verzeichnis', group: 'Seiten' },
  { type: 'drawing', label: 'Handschrift', desc: 'Zeichnen mit Apple Pencil oder Finger', icon: I.pen, keys: 'handschrift zeichnen stift pencil skizze zeichnung', group: 'Lernen' },
  { type: 'flashcards', label: 'Karteikarten', desc: 'Lernen mit Wiederholung', icon: I.cards, keys: 'karteikarten flashcards lernen karten', group: 'Lernen' },
  { type: 'quiz', label: 'Quiz', desc: 'Multiple-Choice-Fragen', icon: I.quiz, keys: 'quiz test fragen prüfung', group: 'Lernen' },
  { type: 'math', label: 'Formel', desc: 'LaTeX-Formel (Blockmodus)', icon: I.math, keys: 'formel mathe math latex gleichung tex', group: 'Lernen', md: '$$' },
  { type: 'code', label: 'Code', desc: 'Code mit Syntaxhervorhebung', icon: I.code, keys: 'code programm snippet', group: 'Lernen', md: '```' },
  { type: 'table', label: 'Tabelle', desc: 'Einfache Tabelle', icon: I.table, keys: 'tabelle table raster stundenplan', group: 'Medien' },
  { type: 'image', label: 'Bild', desc: 'Foto hochladen oder aufnehmen', icon: I.image, keys: 'bild foto image upload', group: 'Medien' },
];

export const TYPE_BY_ID = Object.fromEntries(BLOCK_TYPES.map((t) => [t.type, t]));

export const CALLOUT_ICONS = ['💡', '📌', '⚠️', '❗', '✅', 'ℹ️', '📝', '🎯', '🔥', '❓'];

export function newBlock(type = 'p', extra = {}) {
  const b = { id: uid('b'), type, text: '', indent: 0 };
  if (type === 'todo') b.checked = false;
  if (type === 'toggle') b.open = true;
  if (type === 'callout') {
    b.icon = '💡';
    b.bg = 'gray';
  }
  if (type === 'code') {
    b.lang = 'python';
    b.text = '';
  }
  if (type === 'math') b.tex = '';
  if (type === 'table')
    b.rows = [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ];
  if (type === 'table') b.header = true;
  if (type === 'flashcards') b.cards = [];
  if (type === 'quiz') b.questions = [];
  if (type === 'drawing') {
    b.strokes = [];
    b.h = 520;
    b.bg = 'lines';
  }
  if (type === 'image') {
    b.src = '';
    b.caption = '';
  }
  return Object.assign(b, extra);
}

export function newPage(extra = {}) {
  const now = Date.now();
  return Object.assign(
    {
      id: uid('p'),
      parentId: null,
      kind: 'page',
      title: '',
      icon: '',
      cover: null,
      blocks: [newBlock('p')],
      favorite: false,
      trashed: 0,
      order: now,
      fullWidth: false,
      font: 'sans',
      createdAt: now,
      updatedAt: now,
    },
    extra
  );
}

export const PROP_TYPES = [
  { type: 'text', label: 'Text', icon: I.type },
  { type: 'number', label: 'Zahl', icon: I.number },
  { type: 'select', label: 'Auswahl', icon: I.select },
  { type: 'multi', label: 'Mehrfachauswahl', icon: I.multiSelect },
  { type: 'date', label: 'Datum', icon: I.calendar },
  { type: 'checkbox', label: 'Kontrollkästchen', icon: I.checkbox },
  { type: 'url', label: 'URL', icon: I.url },
];
export const PROP_TYPE_BY_ID = Object.fromEntries(PROP_TYPES.map((t) => [t.type, t]));

export const OPTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function newProp(type, name, options) {
  const p = { id: uid('c'), name, type, width: type === 'checkbox' ? 110 : 180 };
  if (type === 'select' || type === 'multi') {
    p.options = (options || []).map((o, i) =>
      typeof o === 'string' ? { id: uid('o'), name: o, color: OPTION_COLORS[(i + 3) % OPTION_COLORS.length] } : o
    );
  }
  return p;
}

export function newView(type, extra = {}) {
  const labels = { table: 'Tabelle', board: 'Board', calendar: 'Kalender', list: 'Liste', gallery: 'Galerie' };
  return Object.assign({ id: uid('v'), type, name: labels[type] || 'Ansicht', filters: [], sorts: [], hidden: [] }, extra);
}

export function newDatabase(extra = {}, props) {
  const properties = props || [newProp('select', 'Status', ['Offen', 'In Arbeit', 'Erledigt']), newProp('date', 'Datum')];
  const page = newPage(
    Object.assign(
      {
        kind: 'database',
        blocks: [],
        db: {
          titleName: 'Name',
          properties,
          views: [newView('table')],
        },
      },
      extra
    )
  );
  return page;
}

export function newRow(db, props = {}, extra = {}) {
  return newPage(
    Object.assign(
      {
        parentId: db.id,
        isRow: true,
        props,
        blocks: [newBlock('p')],
      },
      extra
    )
  );
}

export function pageTitle(p) {
  if (!p) return 'Gelöschte Seite';
  return (p.title || '').trim() || (p.kind === 'database' ? 'Unbenannte Datenbank' : 'Ohne Titel');
}

export function defaultIcon(p) {
  return p && p.kind === 'database' ? I.database : I.pageText;
}

export function duplicateBlocks(blocks) {
  return clone(blocks).map((b) => Object.assign(b, { id: uid('b') }));
}

// Kinder eines Blocks = folgende Blöcke mit größerer Einrückung
export function blockSubtreeEnd(blocks, index) {
  const base = blocks[index].indent || 0;
  let j = index + 1;
  while (j < blocks.length && (blocks[j].indent || 0) > base) j++;
  return j;
}

export function fmtPropValue(prop, v) {
  if (v == null || v === '') return '';
  if (prop.type === 'select') {
    const o = (prop.options || []).find((x) => x.id === v);
    return o ? o.name : '';
  }
  if (prop.type === 'multi') {
    return (Array.isArray(v) ? v : [])
      .map((id) => (prop.options || []).find((x) => x.id === id))
      .filter(Boolean)
      .map((o) => o.name)
      .join(', ');
  }
  if (prop.type === 'checkbox') return v ? 'Ja' : 'Nein';
  return String(v);
}

export function today() {
  return todayISO();
}
