// Testnotizen: ein realistischer Lernraum für das Wintersemester 2026/27

import { newPage, newBlock, newDatabase, newProp, newView, newRow } from './model.js';
import { md, sel, opt, cards, addDays } from './templates.js';
import { todayISO } from './util.js';

export const SEED_VERSION = 1;

function page(id, extra) {
  return newPage(Object.assign({ id: 'seed-' + id }, extra));
}

// Handschrift-Beispiel: Achsen, Folge mit Grenzwert, ε-Schlauch
function sampleStrokes() {
  const strokes = [];
  const line = (pts, c = 'ink', w = 3.6) => strokes.push({ t: 'pen', c, w, p: pts.flatMap(([x, y], i) => [x, y, 45 + Math.round(20 * Math.sin(i / 3))]) });
  const wobble = (x, y, i) => [x + Math.sin(i * 1.7) * 0.8, y + Math.cos(i * 1.3) * 0.8];
  // Achsen
  line(Array.from({ length: 40 }, (_, i) => wobble(80 + i * 21, 420, i)));
  line(Array.from({ length: 30 }, (_, i) => wobble(90, 440 - i * 12.5, i)));
  line([[1000 - 90, 410], [940, 420], [1000 - 90, 430]]);
  line([[80, 110], [90, 88], [100, 110]]);
  // Grenzwert-Linie a
  strokes.push({ t: 'hl', c: 'yellow', w: 40, p: [100, 200, 50, 940, 200, 50] });
  line(Array.from({ length: 30 }, (_, i) => wobble(100 + i * 28, 200, i)), 'blue', 2.2);
  // ε-Band
  line(Array.from({ length: 28 }, (_, i) => [100 + i * 30, 170 + (i % 2) * 0.6]), 'red', 2.2);
  line(Array.from({ length: 28 }, (_, i) => [100 + i * 30, 230 + (i % 2) * 0.6]), 'red', 2.2);
  // Folgenglieder a_n = a + (-1)^n * c/n
  for (let n = 1; n <= 14; n++) {
    const x = 100 + n * 58;
    const y = 200 - ((n % 2 ? -1 : 1) * 190) / n;
    const pts = Array.from({ length: 8 }, (_, i) => [x + Math.cos((i / 7) * Math.PI * 2) * 5, y + Math.sin((i / 7) * Math.PI * 2) * 5]);
    line(pts, 'ink', 3);
  }
  // "ε" beim Band
  line([[965, 176], [952, 170], [944, 178], [952, 186], [944, 194], [952, 202], [966, 196]], 'red', 3);
  // "a" bei der Linie
  line([[62, 194], [52, 188], [44, 198], [50, 208], [60, 204], [62, 194], [63, 210]], 'blue', 3);
  // Pfeil + Notiz-Unterstreichung
  line(Array.from({ length: 20 }, (_, i) => wobble(560 + i * 18, 470, i)), 'purple', 3);
  return strokes;
}

export function buildSeed() {
  const pages = [];
  const T = todayISO();
  const now = Date.now();
  let order = now - 100000;
  const push = (p) => {
    p.order = order++;
    pages.push(p);
    return p;
  };

  // --- Datenbank: Aufgaben & Abgaben -----------------------------------
  const fach = sel('Fach', [
    ['Analysis I', 'blue'],
    ['Programmieren 1', 'purple'],
    ['Datenbanken', 'orange'],
    ['Lineare Algebra', 'green'],
    ['Englisch B2', 'pink'],
  ]);
  const status = sel('Status', [
    ['Offen', 'red'],
    ['In Arbeit', 'yellow'],
    ['Erledigt', 'green'],
  ]);
  const due = newProp('date', 'Fällig');
  const prio = sel('Priorität', [
    ['Hoch', 'red'],
    ['Mittel', 'orange'],
    ['Niedrig', 'gray'],
  ]);
  const punkte = newProp('number', 'Punkte');
  const tasks = newDatabase({ id: 'seed-aufgaben', title: 'Aufgaben & Abgaben', icon: '✅' }, [fach, status, due, prio, punkte]);
  tasks.db.titleName = 'Aufgabe';
  const vTable = newView('table', { name: 'Alle' });
  const vBoard = newView('board', { name: 'Board', groupBy: status.id });
  const vCal = newView('calendar', { name: 'Kalender', dateProp: due.id });
  const vOpen = newView('list', { name: 'Offen', filters: [{ id: 'f1', prop: status.id, op: 'not', value: opt(status, 'Erledigt') }], sorts: [{ prop: due.id, dir: 'asc' }] });
  tasks.db.views = [vTable, vBoard, vCal, vOpen];
  tasks.db.activeView = vBoard.id;

  // --- Kurse -------------------------------------------------------------
  const start = push(
    page('start', {
      title: 'Willkommen im Lernraum',
      icon: '👋',
      cover: { type: 'gradient', value: 'dusk' },
      favorite: true,
      blocks: [
        ...md(`
> [!tip] **Lernraum** ist dein Notizbuch fürs Studium – Notizen, Aufgaben, Karteikarten und Handschrift an einem Ort. Diese Seiten sind Testnotizen, du kannst sie ändern oder löschen.

## Erste Schritte
- [x] Lernraum öffnen
- [ ] Tippe **/** in einer leeren Zeile für alle Blöcke (Überschrift, To-do, Formel, Handschrift …)
- [ ] Schreibe mit dem Apple Pencil in der Seite **Handschrift: Folgen skizziert**
- [ ] Öffne **Aufgaben & Abgaben** und ziehe eine Karte im Board in eine andere Spalte
- [ ] Lerne die fälligen Karteikarten im Tab **Lernen**
- [ ] Frag Claude: ✨ oben rechts → „Zusammenfassen“

## Kürzel beim Tippen
- \`# \` Überschrift · \`- \` Liste · \`1. \` Nummern · \`[] \` To-do · \`> \` Toggle
- \`**fett**\`, \`*kursiv*\`, \`\`Code\`\`, \`$x^2$\` für Formeln, \`@\` verlinkt eine Seite
- \`---\` Trennlinie · drei Backticks starten einen Codeblock · \`$$ \` Formelblock

## Deine Bereiche
`),
      ],
    })
  );

  const semester = push(page('semester', { title: 'Wintersemester 2026/27', icon: '🎓', favorite: true, blocks: [] }));

  // Analysis I
  const ana = push(page('analysis', { parentId: semester.id, title: 'Analysis I', icon: '📐', blocks: [] }));
  const vl3 = push(
    page('ana-vl3', {
      parentId: ana.id,
      title: 'VL 03 – Folgen und Grenzwerte',
      icon: '📈',
      blocks: [
        ...md(`
> [!note] **Datum:** 07.10.2026 · **Dozent:** Prof. Rinaldi · **Skript:** Kapitel 2.1–2.3

## Definition: Konvergenz
Eine Folge $(a_n)_{n\\in\\mathbb{N}}$ reeller Zahlen **konvergiert** gegen $a \\in \\mathbb{R}$, wenn es zu jedem $\\varepsilon > 0$ ein $N \\in \\mathbb{N}$ gibt, sodass für alle $n \\ge N$ gilt:
$$
|a_n - a| < \\varepsilon
$$
Man schreibt $\\lim_{n\\to\\infty} a_n = a$. Anschaulich: Ab einem gewissen Index liegen **alle** Folgenglieder im „ε-Schlauch“ um $a$.

## Beispiele
1. $a_n = \\frac{1}{n}$ konvergiert gegen $0$: Wähle $N > \\frac{1}{\\varepsilon}$ (Archimedisches Axiom).
2. $a_n = (-1)^n$ ist **divergent** – die Folge springt zwischen $-1$ und $1$.
3. $a_n = \\left(1+\\frac{1}{n}\\right)^n \\to e \\approx 2{,}718$

## Rechenregeln
Sind $a_n \\to a$ und $b_n \\to b$, dann gilt:
- $a_n + b_n \\to a + b$
- $a_n \\cdot b_n \\to a \\cdot b$
- $\\frac{a_n}{b_n} \\to \\frac{a}{b}$, falls $b \\neq 0$
- Grenzwerte sind **eindeutig**.

> [!important] **Merke:** Jede konvergente Folge ist beschränkt. Die Umkehrung gilt nicht – siehe $(-1)^n$.

## Sandwich-Lemma
Gilt $a_n \\le c_n \\le b_n$ für fast alle $n$ und $a_n, b_n \\to L$, dann auch $c_n \\to L$.

## Offene Fragen
- [ ] Warum reicht „für fast alle $n$“ statt „für alle $n$“?
- [x] Unterschied Häufungspunkt vs. Grenzwert klären
`),
        newBlock('h2', { text: 'Karteikarten' }),
        newBlock('flashcards', {
          cards: cards([
            ['Wann konvergiert eine Folge $(a_n)$ gegen $a$?', 'Wenn es zu jedem $\\varepsilon>0$ ein $N$ gibt mit $|a_n-a|<\\varepsilon$ für alle $n\\ge N$.'],
            ['Ist jede beschränkte Folge konvergent?', 'Nein, z. B. $(-1)^n$. Aber jede konvergente Folge ist beschränkt.'],
            ['Was besagt das Sandwich-Lemma?', 'Liegt $c_n$ zwischen zwei Folgen mit gleichem Grenzwert $L$, dann konvergiert auch $c_n$ gegen $L$.'],
            ['Grenzwert von $\\left(1+\\frac1n\\right)^n$?', 'Die Eulersche Zahl $e \\approx 2{,}718$.'],
            ['Grenzwert von $\\frac{1}{n}$ – welches $N$ wählt man?', '$N > \\frac{1}{\\varepsilon}$, nach dem Archimedischen Axiom.', 2, 3],
            ['Was ist ein Häufungspunkt?', 'Ein Punkt, in dessen jeder Umgebung unendlich viele Folgenglieder liegen.', 1, 1],
          ]),
        }),
      ],
    })
  );
  const vl4 = push(
    page('ana-vl4', {
      parentId: ana.id,
      title: 'VL 04 – Reihen',
      icon: '∑',
      blocks: md(`
## Geometrische Reihe
Für $|q| < 1$ gilt
$$
\\sum_{k=0}^{\\infty} q^k = \\frac{1}{1-q}
$$
Für $|q| \\ge 1$ divergiert die Reihe.

## Konvergenzkriterien
| Kriterium | Aussage | Wann nützlich? |
| --- | --- | --- |
| Nullfolgen-Kriterium | Konvergiert $\\sum a_k$, dann $a_k \\to 0$ | Divergenz zeigen |
| Quotientenkriterium | $\\limsup \\left|\\frac{a_{k+1}}{a_k}\\right| < 1 \\Rightarrow$ absolut konvergent | Fakultäten, Potenzen |
| Wurzelkriterium | $\\limsup \\sqrt[k]{|a_k|} < 1 \\Rightarrow$ absolut konvergent | $k$-te Potenzen |
| Leibniz-Kriterium | alternierend + monoton fallende Nullfolge | $\\sum (-1)^k b_k$ |

## Harmonische Reihe
$\\sum_{k=1}^\\infty \\frac{1}{k}$ **divergiert**, obwohl $\\frac1k \\to 0$. Das Nullfolgen-Kriterium ist also nur notwendig, nicht hinreichend!

- Toggle-Idee: Beweis über Gruppierung $\\frac12 + \\left(\\frac13+\\frac14\\right) + \\dots \\ge \\frac12 + \\frac12 + \\dots$
`),
    })
  );
  ana.blocks = [
    ...md(`
> [!note] **Vorlesung:** Di 10:30 & Do 08:30 · Hörsaal E1.01 · **Übung:** Mi 14:00 · **Klausur:** 02.02.2027
`),
    newBlock('page', { pageId: vl3.id }),
    newBlock('page', { pageId: vl4.id }),
    newBlock('h2', { text: 'Übungsblätter' }),
    newBlock('database', { pageId: tasks.id }),
    newBlock('p'),
  ];

  // Programmieren 1
  const prog = push(page('prog', { parentId: semester.id, title: 'Programmieren 1 (Java)', icon: '💻', blocks: [] }));
  const pvl2 = push(
    page('prog-vl2', {
      parentId: prog.id,
      title: 'VL 02 – Datentypen & Kontrollstrukturen',
      icon: '☕',
      blocks: [
        ...md(`
## Primitive Datentypen
| Typ | Größe | Beispiel |
| --- | --- | --- |
| \`int\` | 32 Bit | \`int n = 42;\` |
| \`long\` | 64 Bit | \`long big = 3_000_000_000L;\` |
| \`double\` | 64 Bit | \`double pi = 3.14159;\` |
| \`boolean\` | – | \`boolean ok = true;\` |
| \`char\` | 16 Bit | \`char c = 'A';\` |

> [!warning] Ganzzahldivision: \`7 / 2\` ergibt **3**, nicht 3,5. Für Kommazahlen \`7 / 2.0\` schreiben.

## Schleifen
\`\`\`java
public class Summe {
    public static void main(String[] args) {
        int summe = 0;
        for (int i = 1; i <= 100; i++) {
            summe += i;
        }
        System.out.println("Summe 1..100 = " + summe); // 5050
    }
}
\`\`\`

## Rekursion: Fakultät
\`\`\`java
static long fakultaet(int n) {
    if (n <= 1) return 1;          // Abbruchbedingung
    return n * fakultaet(n - 1);   // rekursiver Aufruf
}
\`\`\`
Die Laufzeit ist $O(n)$, der Speicherbedarf durch den Call-Stack ebenfalls $O(n)$.

## To-dos
- [ ] Übungsblatt 2 in IntelliJ lösen
- [ ] \`switch\`-Ausdrücke (Java 21) nachlesen
`),
        newBlock('h2', { text: 'Karteikarten' }),
        newBlock('flashcards', {
          cards: cards([
            ['Was ergibt `7 / 2` in Java?', '`3` – Ganzzahldivision, der Rest wird abgeschnitten.'],
            ['Unterschied `==` und `equals()` bei Strings?', '`==` vergleicht Referenzen, `equals()` den Inhalt.'],
            ['Was braucht jede Rekursion?', 'Eine Abbruchbedingung (Basisfall) und einen Schritt, der sich ihr nähert.'],
            ['Wie viele Bit hat ein `int`?', '32 Bit, Wertebereich $-2^{31}$ bis $2^{31}-1$.', 3, 6],
          ]),
        }),
      ],
    })
  );
  prog.blocks = [...md(`> [!note] **Vorlesung:** Mo 08:30 · Labor L2 · **Tutorium:** Fr 10:30`), newBlock('page', { pageId: pvl2.id }), newBlock('p')];

  // Datenbanken
  const dbs = push(page('dbs', { parentId: semester.id, title: 'Datenbanksysteme', icon: '🗄️', blocks: [] }));
  const dvl1 = push(
    page('dbs-vl1', {
      parentId: dbs.id,
      title: 'VL 01 – Relationales Modell & SQL',
      icon: '🧱',
      blocks: [
        ...md(`
## Begriffe
- **Relation** = Tabelle, **Tupel** = Zeile, **Attribut** = Spalte
- **Primärschlüssel**: identifiziert jedes Tupel eindeutig
- **Fremdschlüssel**: verweist auf den Primärschlüssel einer anderen Relation

## Beispiel-Schema
\`\`\`sql
CREATE TABLE studierende (
  matrikel INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  semester INTEGER
);

SELECT s.name, COUNT(*) AS anzahl
FROM studierende s
JOIN belegungen b ON b.matrikel = s.matrikel
GROUP BY s.name
HAVING COUNT(*) > 3
ORDER BY anzahl DESC;
\`\`\`

## Relationale Algebra
Selektion $\\sigma_{semester > 2}(\\text{Studierende})$, Projektion $\\pi_{name}$, Join $\\bowtie$.

- Merkhilfe: **σ** filtert Zeilen, **π** wählt Spalten.
`),
        newBlock('flashcards', {
          cards: cards([
            ['Was ist ein Fremdschlüssel?', 'Ein Attribut, das auf den Primärschlüssel einer anderen Relation verweist.'],
            ['Unterschied `WHERE` und `HAVING`?', '`WHERE` filtert Zeilen vor der Gruppierung, `HAVING` Gruppen danach.'],
            ['Was macht die Projektion π?', 'Sie wählt Spalten (Attribute) aus.', 2, 4],
          ]),
        }),
      ],
    })
  );
  dbs.blocks = [newBlock('page', { pageId: dvl1.id }), newBlock('p')];

  // Lineare Algebra mit Quiz
  const la = push(
    page('la', {
      parentId: semester.id,
      title: 'Lineare Algebra',
      icon: '🧮',
      blocks: [
        ...md(`
## Matrizenmultiplikation
Für $A \\in \\mathbb{R}^{m\\times n}$ und $B \\in \\mathbb{R}^{n \\times p}$ ist $C = AB \\in \\mathbb{R}^{m\\times p}$ mit
$$
c_{ij} = \\sum_{k=1}^{n} a_{ik}\\, b_{kj}
$$
> [!warning] Matrizenmultiplikation ist **nicht kommutativ**: im Allgemeinen gilt $AB \\neq BA$.

## Determinante (2×2)
$$
\\det\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc
$$
`),
        newBlock('h2', { text: 'Selbsttest' }),
        newBlock('quiz', {
          title: 'Quiz: Matrizen',
          questions: [
            { q: 'Welches Format hat $AB$, wenn $A$ eine $2\\times3$- und $B$ eine $3\\times4$-Matrix ist?', options: ['$3\\times3$', '$2\\times4$', '$4\\times2$', 'nicht definiert'], correct: 1, explain: 'Zeilen von $A$ × Spalten von $B$ – also $2\\times4$.' },
            { q: 'Gilt für alle quadratischen Matrizen $AB = BA$?', options: ['Ja', 'Nein', 'Nur für $2\\times2$', 'Nur wenn $\\det A = 0$'], correct: 1, explain: 'Die Matrizenmultiplikation ist im Allgemeinen nicht kommutativ.' },
            { q: 'Was ist $\\det\\begin{pmatrix}2&1\\\\4&3\\end{pmatrix}$?', options: ['$2$', '$10$', '$-2$', '$6$'], correct: 0, explain: '$2\\cdot3 - 1\\cdot4 = 2$.' },
            { q: 'Wann ist eine quadratische Matrix invertierbar?', options: ['Wenn alle Einträge $\\neq 0$ sind', 'Wenn $\\det A \\neq 0$', 'Wenn sie symmetrisch ist', 'Immer'], correct: 1, explain: 'Genau dann, wenn die Determinante ungleich null ist.' },
          ],
        }),
        newBlock('p'),
      ],
    })
  );

  semester.blocks = [
    ...md(`
> [!note] **Studiengang:** Informatik (B.Sc.) · **Semesterbeginn:** 01.10.2026 · **Prüfungszeitraum:** 25.01.–19.02.2027
`),
    newBlock('page', { pageId: ana.id }),
    newBlock('page', { pageId: prog.id }),
    newBlock('page', { pageId: dbs.id }),
    newBlock('page', { pageId: la.id }),
    newBlock('h2', { text: 'Alle Aufgaben' }),
    newBlock('database', { pageId: tasks.id }),
    newBlock('p'),
  ];

  // Aufgaben-Zeilen
  push(tasks);
  const taskRows = [
    ['Übungsblatt 1 – Mengen & Beweise', 'Analysis I', 'Erledigt', -3, 'Mittel', 18],
    ['Übungsblatt 2 – Folgen', 'Analysis I', 'In Arbeit', 2, 'Hoch', null],
    ['Programmieraufgabe: FizzBuzz & Primzahlen', 'Programmieren 1', 'Offen', 4, 'Mittel', null],
    ['ER-Diagramm für die Bibliothek', 'Datenbanken', 'Offen', 9, 'Hoch', null],
    ['Übungsblatt 1 – Vektorräume', 'Lineare Algebra', 'In Arbeit', 6, 'Mittel', null],
    ['Essay: „My hometown“ (250 Wörter)', 'Englisch B2', 'Offen', 12, 'Niedrig', null],
    ['Übungsblatt 3 – Reihen', 'Analysis I', 'Offen', 16, 'Mittel', null],
    ['SQL-Übung: JOINs', 'Datenbanken', 'Offen', 20, 'Mittel', null],
    ['Mini-Projekt: Taschenrechner in Java', 'Programmieren 1', 'Offen', 34, 'Hoch', null],
    ['Tutorium vorbereiten: Matrizen', 'Lineare Algebra', 'Erledigt', -1, 'Niedrig', null],
  ];
  taskRows.forEach(([title, f, s, d, p, pts], i) => {
    const props = { [fach.id]: opt(fach, f), [status.id]: opt(status, s), [due.id]: addDays(T, d), [prio.id]: opt(prio, p) };
    if (pts != null) props[punkte.id] = pts;
    const r = newRow(tasks, props, { id: 'seed-task-' + (i + 1), title, order: now + i });
    if (i === 1) r.blocks = md(`## Aufgaben\n- [x] Aufgabe 1: Konvergenz von $\\frac{n+1}{n}$ zeigen\n- [ ] Aufgabe 2: Sandwich-Lemma anwenden\n- [ ] Aufgabe 3: $(-1)^n$ divergiert – Beweis\n\n> [!tip] Tipp aus dem Tutorium: immer mit $|a_n - a|$ anfangen und nach oben abschätzen.`);
    if (i === 3) r.blocks = md(`## Anforderungen\n- Entitäten: Buch, Exemplar, Mitglied, Ausleihe\n- Kardinalitäten angeben\n- [ ] Entwurf skizzieren\n- [ ] In Relationen überführen`);
    pages.push(r);
  });

  // --- Prüfungsplan -----------------------------------------------------
  const pf = sel('Fach', [
    ['Analysis I', 'blue'],
    ['Programmieren 1', 'purple'],
    ['Datenbanken', 'orange'],
    ['Lineare Algebra', 'green'],
  ]);
  const art = sel('Art', [
    ['Klausur', 'red'],
    ['Mündlich', 'blue'],
    ['Projekt', 'purple'],
  ]);
  const pdate = newProp('date', 'Datum');
  const anm = newProp('date', 'Anmeldung bis');
  const angemeldet = newProp('checkbox', 'Angemeldet');
  const note = newProp('number', 'Note');
  const exams = newDatabase({ id: 'seed-pruefungen', title: 'Prüfungsplan', icon: '🎯', favorite: true }, [pf, art, pdate, anm, angemeldet, note]);
  exams.db.titleName = 'Prüfung';
  exams.db.views = [newView('table', { name: 'Übersicht', sorts: [{ prop: pdate.id, dir: 'asc' }] }), newView('calendar', { name: 'Kalender', dateProp: pdate.id })];
  push(exams);
  [
    ['Analysis I – Klausur', 'Analysis I', 'Klausur', '2027-02-02', '2027-01-10', false],
    ['Programmieren 1 – Projektabgabe', 'Programmieren 1', 'Projekt', '2027-01-29', '2027-01-08', true],
    ['Datenbanksysteme – Klausur', 'Datenbanken', 'Klausur', '2027-02-09', '2027-01-15', false],
    ['Lineare Algebra – Mündliche Prüfung', 'Lineare Algebra', 'Mündlich', '2027-02-16', '2027-01-20', false],
  ].forEach(([title, f, a, d, an, ok], i) => {
    const r = newRow(exams, { [pf.id]: opt(pf, f), [art.id]: opt(art, a), [pdate.id]: d, [anm.id]: an, [angemeldet.id]: ok }, { id: 'seed-exam-' + (i + 1), title, order: now + i });
    pages.push(r);
  });

  // --- Stundenplan -----------------------------------------------------
  push(
    page('stundenplan', {
      title: 'Stundenplan WS 26/27',
      icon: '🕘',
      blocks: [
        newBlock('table', {
          header: true,
          rows: [
            ['Zeit', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'],
            ['08:30', '<b>Programmieren 1</b><br>Labor L2', '', 'Englisch B2<br>C3.05', '<b>Analysis I</b><br>E1.01', ''],
            ['10:30', 'Lineare Algebra<br>E2.10', '<b>Analysis I</b><br>E1.01', '', 'Datenbanken<br>D1.03', 'Tutorium Java<br>L2'],
            ['14:00', 'Datenbanken<br>D1.03', 'Lineare Algebra<br>E2.10', 'Übung Analysis<br>E1.02', '', ''],
            ['16:00', '', 'Lerngruppe 📚<br>Bibliothek', '', 'Sport 🏐', ''],
          ],
        }),
        ...md(`> [!note] Alle Räume am Campus Bozen. Änderungen werden im Kursportal angekündigt.`),
      ],
    })
  );

  // --- Handschrift -------------------------------------------------------
  push(
    page('handschrift', {
      title: 'Handschrift: Folgen skizziert',
      icon: '✍️',
      blocks: [
        ...md(`Skizze aus der Vorlesung: Die Folge $a_n = a + \\frac{(-1)^n c}{n}$ springt um $a$ herum und bleibt ab einem Index im ε-Schlauch. Schreib mit dem Apple Pencil einfach weiter – mit dem Finger scrollst du.`),
        newBlock('drawing', { h: 620, bg: 'grid', strokes: sampleStrokes() }),
        newBlock('drawing', { h: 700, bg: 'lines', strokes: [] }),
        newBlock('p'),
      ],
    })
  );

  // --- Leseliste ----------------------------------------------------------
  const rs = sel('Status', [
    ['Will lesen', 'gray'],
    ['Lese gerade', 'blue'],
    ['Gelesen', 'green'],
  ]);
  const autor = newProp('text', 'Autor/in');
  const rfach = sel('Fach', [
    ['Informatik', 'purple'],
    ['Mathe', 'blue'],
    ['Lernen', 'yellow'],
  ]);
  const link = newProp('url', 'Link');
  const reading = newDatabase({ id: 'seed-leseliste', title: 'Leseliste', icon: '📚' }, [autor, rs, rfach, link]);
  reading.db.titleName = 'Titel';
  reading.db.views = [newView('gallery', { name: 'Galerie' }), newView('board', { name: 'Status', groupBy: rs.id }), newView('table', { name: 'Tabelle' })];
  push(reading);
  [
    ['Clean Code', 'Robert C. Martin', 'Lese gerade', 'Informatik', '📘'],
    ['Analysis 1', 'Otto Forster', 'Gelesen', 'Mathe', '📗'],
    ['Make It Stick', 'Brown, Roediger, McDaniel', 'Will lesen', 'Lernen', '🧠'],
    ['Datenbanksysteme', 'Kemper & Eickler', 'Will lesen', 'Informatik', '🗄️'],
  ].forEach(([title, a, s, f, icon], i) => {
    const r = newRow(reading, { [autor.id]: a, [rs.id]: opt(rs, s), [rfach.id]: opt(rfach, f) }, { id: 'seed-book-' + (i + 1), title, icon, order: now + i });
    if (i === 0) r.blocks = md(`## Notizen\n- Funktionen sollen **eine** Sache tun\n- Aussagekräftige Namen > Kommentare\n\n> Code is read much more often than it is written.`);
    pages.push(r);
  });

  // --- Lernmethoden -----------------------------------------------------
  push(
    page('lernmethoden', {
      title: 'Lernmethoden, die funktionieren',
      icon: '🧠',
      blocks: md(`
## Aktives Erinnern (Active Recall)
Statt Skript nochmal zu lesen: Buch zu, Fragen beantworten. Genau dafür sind die **Karteikarten** und das **Quiz** da.

## Verteiltes Wiederholen (Spaced Repetition)
Wiederhole mit wachsenden Abständen: 1 Tag → 3 Tage → 1 Woche → 2 Wochen. Die Karteikarten planen das automatisch.

## Pomodoro
25 Minuten Fokus, 5 Minuten Pause, nach vier Runden eine lange Pause. Den Timer findest du im Tab **Lernen**.

## Feynman-Methode
1. Thema wählen
2. So erklären, als wäre es für eine 12-Jährige
3. Lücken finden und nachlesen
4. Vereinfachen und Analogien nutzen

- Tipp: Claude kann „Einfach erklären“ – nutze es, um deine eigene Erklärung zu prüfen.
`),
    })
  );

  // --- Wochenplan ---------------------------------------------------------
  push(
    page('woche', {
      title: 'Wochenplan KW 40',
      icon: '🗓️',
      blocks: md(`
## Ziele der Woche
- [x] Einschreibung abschließen
- [ ] Übungsblatt 2 Analysis abgeben
- [ ] Lerngruppe für Lineare Algebra finden

### Montag
- [x] Einführungsveranstaltung
- [ ] IntelliJ installieren

### Dienstag
- [ ] Analysis VL nacharbeiten (30 min)

### Mittwoch
- [ ] Übung Analysis – Fragen zu Aufgabe 2 mitnehmen

### Donnerstag
- [ ] Karteikarten Datenbanken wiederholen

### Freitag
- [ ] Tutorium Java
- [ ] Wochenrückblick schreiben
`),
    })
  );

  // --- Schnellnotizen ---------------------------------------------------
  push(
    page('inbox', {
      title: 'Schnellnotizen',
      icon: '📝',
      blocks: md(`
- Mensa-Tipp: Mittwoch gibt’s Knödel 😋
- Buch „Make It Stick“ in der Bibliothek vormerken
- Fragen an die Studienberatung: Anerkennung Englisch-Zertifikat?
- WLAN-Zugang: eduroam mit Uni-Login
`),
    })
  );

  // Startseite: Links zu den Bereichen
  const find = (id) => pages.find((p) => p.id === id);
  start.blocks.push(
    newBlock('page', { pageId: semester.id }),
    newBlock('page', { pageId: tasks.id }),
    newBlock('page', { pageId: exams.id }),
    newBlock('page', { pageId: find('seed-stundenplan').id }),
    newBlock('page', { pageId: find('seed-handschrift').id }),
    newBlock('page', { pageId: find('seed-lernmethoden').id }),
    newBlock('p')
  );

  // Zeitstempel etwas streuen
  pages.forEach((p, i) => {
    p.createdAt = now - (pages.length - i) * 3600000;
    p.updatedAt = now - (pages.length - i) * 600000;
  });
  // Handschrift soll als "zuletzt bearbeitet" erscheinen
  find('seed-ana-vl3').updatedAt = now - 60000;
  return pages;
}
