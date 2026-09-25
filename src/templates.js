// Vorlagen für Studierende (auch von den Testnotizen genutzt)

import { newPage, newBlock, newDatabase, newProp, newView, newRow, OPTION_COLORS } from './model.js';
import { markdownToBlocks } from './markdown.js';
import { inlineMdToHtml } from './inline.js';
import { uid, todayISO, toISODate, parseISODate } from './util.js';

export const md = (s) => markdownToBlocks(s.replace(/^\n/, ''));

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function sel(name, options) {
  const p = newProp('select', name, []);
  p.options = options.map((o, i) => (Array.isArray(o) ? { id: uid('o'), name: o[0], color: o[1] } : { id: uid('o'), name: o, color: OPTION_COLORS[(i + 3) % OPTION_COLORS.length] }));
  return p;
}

export function opt(prop, name) {
  const o = prop.options.find((x) => x.name === name);
  return o ? o.id : null;
}

export function cards(list) {
  return list.map(([q, a, box = 0, dueInDays = 0]) => ({ id: uid('k'), q: inlineMdToHtml(q), a: inlineMdToHtml(a), box, due: dueInDays ? Date.now() + dueInDays * 86400000 : 0 }));
}

// ---------------------------------------------------------------------------
export const TEMPLATES = [
  {
    id: 'lecture',
    name: 'Vorlesungsnotiz',
    icon: '🎓',
    desc: 'Lernziele, Mitschrift, Zusammenfassung, Karteikarten',
    build: () => {
      const blocks = md(`
> [!note] **Datum:** ${todayISO().split('-').reverse().join('.')} · **Dozent/in:** … · **Folien:** …

## Lernziele
- [ ] …
- [ ] …

## Mitschrift
Tippe hier oder nutze einen Handschrift-Block (\`/handschrift\`).

## Zusammenfassung
In drei Sätzen: Worum ging es heute?

## Offene Fragen
- [ ] Beim Tutorium nachfragen: …
`);
      blocks.push(newBlock('h2', { text: 'Karteikarten' }), newBlock('flashcards', { cards: [] }));
      return newPage({ title: 'Vorlesung: ', icon: '🎓', blocks });
    },
  },
  {
    id: 'cornell',
    name: 'Cornell-Notizen',
    icon: '🗒️',
    desc: 'Stichworte, Notizen und Zusammenfassung nach Cornell',
    build: () =>
      newPage({
        title: 'Cornell-Notiz: ',
        icon: '🗒️',
        blocks: md(`
> [!tip] **So geht’s:** Während der Vorlesung rechts mitschreiben, danach links Stichworte und Fragen ergänzen, unten zusammenfassen.

## Stichworte & Fragen
- Leitfrage 1?
- Leitfrage 2?

## Notizen
- …

## Zusammenfassung
…
`),
      }),
  },
  {
    id: 'handwriting',
    name: 'Handschrift-Notiz',
    icon: '✍️',
    desc: 'Liniertes Blatt für den Apple Pencil',
    build: () => newPage({ title: 'Handschriftliche Notiz', icon: '✍️', blocks: [newBlock('drawing', { h: 1300, bg: 'lines' }), newBlock('p')] }),
  },
  {
    id: 'homework',
    name: 'Aufgaben-Tracker',
    icon: '✅',
    desc: 'Datenbank mit Board und Kalender für Abgaben',
    build: (app) => {
      const fach = sel('Fach', ['Mathe', 'Informatik', 'Sprachen']);
      const status = sel('Status', [['Offen', 'red'], ['In Arbeit', 'yellow'], ['Erledigt', 'green']]);
      const due = newProp('date', 'Fällig');
      const prio = sel('Priorität', [['Hoch', 'red'], ['Mittel', 'orange'], ['Niedrig', 'gray']]);
      const db = newDatabase({ title: 'Aufgaben', icon: '✅' }, [fach, status, due, prio]);
      db.db.titleName = 'Aufgabe';
      db.db.views = [newView('table', { name: 'Alle' }), newView('board', { name: 'Nach Status', groupBy: status.id }), newView('calendar', { name: 'Kalender', dateProp: due.id })];
      const rows = [newRow(db, { [status.id]: opt(status, 'Offen'), [due.id]: addDays(todayISO(), 3), [prio.id]: opt(prio, 'Hoch') }, { title: 'Erste Aufgabe' })];
      return { page: db, extra: rows, app };
    },
  },
  {
    id: 'exam',
    name: 'Prüfungsvorbereitung',
    icon: '🎯',
    desc: 'Stoffübersicht, Lernplan, Karteikarten, Quiz',
    build: () => {
      const blocks = md(`
> [!important] **Prüfung am:** … · **Raum:** … · **Hilfsmittel:** …

## Stoffübersicht
- [ ] Kapitel 1
- [ ] Kapitel 2
- [ ] Kapitel 3
- [ ] Altklausuren rechnen

## Lernplan
| Tag | Thema | Erledigt |
| --- | --- | --- |
| Mo | Kapitel 1 wiederholen | ☐ |
| Di | Übungsblätter 1–3 | ☐ |
| Mi | Kapitel 2 | ☐ |

## Schwachstellen
- …
`);
      blocks.push(newBlock('h2', { text: 'Karteikarten' }), newBlock('flashcards', { cards: [] }), newBlock('h2', { text: 'Probeklausur' }), newBlock('quiz', { questions: [] }));
      return newPage({ title: 'Prüfung: ', icon: '🎯', blocks });
    },
  },
  {
    id: 'week',
    name: 'Wochenplan',
    icon: '🗓️',
    desc: 'Aufgaben pro Tag, Ziele und Rückblick',
    build: () => {
      const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Wochenende'];
      return newPage({
        title: 'Wochenplan',
        icon: '🗓️',
        blocks: md(`
## Ziele der Woche
- [ ] …

${days.map((d) => `### ${d}\n- [ ] `).join('\n\n')}

## Rückblick
Was lief gut? Was nehme ich mir für nächste Woche vor?
`),
      });
    },
  },
  {
    id: 'timetable',
    name: 'Stundenplan',
    icon: '🕘',
    desc: 'Tabelle Montag bis Freitag',
    build: () =>
      newPage({
        title: 'Stundenplan',
        icon: '🕘',
        blocks: [
          newBlock('table', {
            header: true,
            rows: [
              ['Zeit', 'Mo', 'Di', 'Mi', 'Do', 'Fr'],
              ['08:30', '', '', '', '', ''],
              ['10:30', '', '', '', '', ''],
              ['14:00', '', '', '', '', ''],
              ['16:00', '', '', '', '', ''],
            ],
          }),
          newBlock('p'),
        ],
      }),
  },
  {
    id: 'reading',
    name: 'Leseliste',
    icon: '📚',
    desc: 'Bücher und Paper mit Status und Galerie',
    build: () => {
      const status = sel('Status', [['Will lesen', 'gray'], ['Lese gerade', 'blue'], ['Gelesen', 'green']]);
      const author = newProp('text', 'Autor/in');
      const link = newProp('url', 'Link');
      const db = newDatabase({ title: 'Leseliste', icon: '📚' }, [author, status, link]);
      db.db.titleName = 'Titel';
      db.db.views = [newView('gallery', { name: 'Galerie' }), newView('table', { name: 'Tabelle' }), newView('board', { name: 'Status', groupBy: status.id })];
      return { page: db, extra: [] };
    },
  },
  {
    id: 'project',
    name: 'Hausarbeit / Projekt',
    icon: '🧩',
    desc: 'Gliederung, Quellen, Meilensteine',
    build: () =>
      newPage({
        title: 'Hausarbeit: ',
        icon: '🧩',
        blocks: md(`
> [!note] **Abgabe:** … · **Umfang:** … Seiten · **Betreuer/in:** …

## Forschungsfrage
…

## Gliederung
1. Einleitung
2. Grundlagen
3. Hauptteil
4. Fazit

## Meilensteine
- [ ] Thema festlegen
- [ ] Literaturrecherche
- [ ] Rohfassung
- [ ] Korrekturlesen
- [ ] Abgabe

## Quellen
- …
`),
      }),
  },
];
