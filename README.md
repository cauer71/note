# Lernraum

Ein Notion-Klon für Studierende – gebaut für **iPhone und iPad mit Apple Pencil** und gestaltet wie eine native iOS-26-App (Liquid Glass).

- **Gehostet:** https://lernraum.auer.page (Cloudflare Worker + D1, geschützt mit Cloudflare Access)
- **Mit KI in Claude:** https://claude.ai/artifact/BeRSov9KCtpwwNt3kwjeLZ (gleiche Daten, KI über Claude)

## Funktionen

| Bereich | Was es kann |
| --- | --- |
| Editor | Blöcke mit `/`-Menü, Markdown-Kürzel (`# `, `- `, `1. `, `[] `, `> `, `---`, ```` ``` ````, `$$ `), Inline `**fett**`, `*kursiv*`, `` `code` ``, `$Formel$`, `@`-Seitenlinks, Farben, Einrücken, Ziehen, Rückgängig |
| Blöcke | Text, Überschriften, Listen, To-dos, Toggles, Zitat, Hinweis, Code (Syntaxfarben), Formel (KaTeX), Tabelle, Bild/Kamera, Unterseite, Inline-Datenbank, Inhaltsverzeichnis, **Handschrift**, **Karteikarten**, **Quiz** |
| Handschrift | Apple Pencil mit Druck, Palm Rejection (Finger scrollt), Stift/Marker/Radierer, Farben, Linien/Karo/Punkte, Vollbild, wächst automatisch |
| Datenbanken | Tabelle, Board (Ziehen zwischen Spalten), Kalender, Liste, Galerie; Eigenschaften Text, Zahl, Auswahl, Mehrfachauswahl, Datum, Checkbox, URL; Filter, Sortierung, Suche |
| Lernen | Karteikarten mit Spaced Repetition, Lernsitzungen über alle Stapel, Quiz, Fokus-Timer (Pomodoro) |
| Heute | Anstehende Abgaben aus allen Datenbanken, fällige Karten, Prüfungs-Countdown, zuletzt bearbeitet |
| KI (Claude) | Zusammenfassen, Karteikarten und Quiz erzeugen, einfach erklären, Lernplan, Glossar, Prüfungsfragen, Lücken finden, übersetzen, Text verbessern, `/ki` schreibt an der Stelle, **Handschrift → Text/LaTeX**, **Foto von Tafel/Folie → Notizen**, Chat über alle Notizen |
| Sonstiges | Seitenbaum mit Ziehen, Favoriten, Papierkorb, Suche (⌘K), Vorlagen, Markdown-Export/-Import, JSON-Sicherung, Hell/Dunkel, Offline-Start (Service Worker + IndexedDB) |

## Architektur

```
src/            App (Vanilla JS, mit esbuild gebündelt)
  app.js        Hülle: Navigation, Seitenbaum, Speichern/Synchronisieren
  editor.js     Block-Editor (ein contenteditable pro Block)
  database.js   Datenbank-Ansichten
  drawing.js    Handschrift-Block (Pointer Events, Druck, Vektorstriche)
  learn.js      Karteikarten, Quiz, Timer
  ai.js         KI über window.claude.use('sample')
  store.js      ApiStore (Worker/D1) · McpD1Store (Artifact → Cloudflare-Connector) · LocalStore
worker/index.js Cloudflare Worker: /api/pages, /api/settings, prüft das Access-JWT
schema.sql      D1-Schema (eine Zeile pro Seite, JSON)
tests/          Playwright-Tests (Desktop, iPhone, iPad, Artifact-Mocks, echte Worker-API)
```

Beide Versionen entstehen aus demselben Code (`npm run build`):

- `dist/site/` → Worker-Assets. Speichert über `/api` in D1.
- `dist/artifact/lernraum.html` → Claude-Artifact. Speichert über den Cloudflare-Connector (`d1_database_query`) in **dieselbe** D1-Datenbank, KI über Claude.

## Entwicklung

```bash
npm install
npm run build          # beide Varianten bauen
npm run dev            # Worker lokal mit lokaler D1 (http://localhost:8787)
npx playwright test    # alle Tests
node scripts/serve.mjs # statischer Testserver (http://localhost:4173/?local=demo)
```

## Deployment

```bash
export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=c72e13538d36f6905581747d2fd5c1fc
npx wrangler d1 execute notizen --remote --file schema.sql
node scripts/seed-sql.mjs && npx wrangler d1 execute notizen --remote --file dist/seed.sql   # Testnotizen (überschreibt nichts)
npm run deploy
```

Cloudflare Access schützt `lernraum.auer.page` (Einmal-PIN per E-Mail, dazu ein Service-Token für Skripte). Nur `/icons/*` ist öffentlich, damit „Zum Home-Bildschirm“ das App-Symbol laden kann. Weitere Personen lassen sich in Zero Trust → Access → Anwendungen → *Lernraum* → Richtlinie *Christian* ergänzen.

## Auf dem iPhone/iPad installieren

In Safari `lernraum.auer.page` öffnen → Teilen → **Zum Home-Bildschirm**. Die App startet dann im Vollbild und öffnet sich auch offline mit dem zuletzt geladenen Stand.
