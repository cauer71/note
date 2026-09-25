# Notes

Ein Notion-Klon für Studierende – gebaut für **iPhone und iPad mit Apple Pencil** (und Android) und gestaltet wie eine native iOS-26-App (Liquid Glass). Installierbar als Web-App mit eigenem Symbol, Startanimation und Offline-Start.

- **Gehostet:** https://notes.auer.page (Cloudflare Worker + D1, geschützt mit Cloudflare Access)
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
| Web-App | Installierbar auf iOS/iPadOS („Zum Home-Bildschirm“, Startbilder für alle aktuellen iPhones/iPads) und Android (Installationsfenster mit Screenshots, runde/adaptive Symbole, Kurzbefehle *Neue Notiz*, *Heute*, *Lernen*, *Suchen*), Startanimation |
| Sonstiges | Seitenbaum mit Ziehen, Favoriten, Papierkorb, Suche (⌘K), Vorlagen, Markdown-Export/-Import, JSON-Sicherung, Hell/Dunkel, Offline-Start (Service Worker + IndexedDB) |

## Architektur

```
src/            App (Vanilla JS, mit esbuild gebündelt)
  brand.js      App-Symbol und Startanimation (Quelle für alle Icons und Startbilder)
  install.js    „Als App installieren“ (Android-Installationsfenster, iOS-Hinweis)
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
node scripts/icons.mjs --screens   # Symbole, Startbilder und Store-Screenshots neu erzeugen (nach npm run build)
node scripts/icons.mjs --preview x.png   # Kontrollbild des Symbols mit iOS-/Android-Masken
```

## Deployment

```bash
export CLOUDFLARE_API_TOKEN=…  CLOUDFLARE_ACCOUNT_ID=c72e13538d36f6905581747d2fd5c1fc
npx wrangler d1 execute notizen --remote --file schema.sql      # nur bei einer neuen Datenbank
node scripts/seed-sql.mjs && npx wrangler d1 execute notizen --remote --file dist/seed.sql   # Testnotizen (überschreibt nichts)
npm run deploy
```

Bestehende Datenbanken rüstet der Worker (und die Artifact-Version) beim ersten Zugriff selbst nach (`rev`, `base_rev`).

Cloudflare Access schützt `notes.auer.page` (Einmal-PIN per E-Mail, dazu ein Service-Token für Skripte). Nur `/icons/*` ist öffentlich, damit „Zum Home-Bildschirm“ das App-Symbol laden kann. Weitere Personen lassen sich in Zero Trust → Access → Anwendungen → *Notes* → Richtlinie *Christian* ergänzen.

## Versionen

Die App zeigt ihre Version immer an (Seitenleiste bzw. Ende der Notizen-Übersicht, Einstellungen): `Version 1.2.0 · 25.09.2026 16:27` – Nummer aus `package.json`, dazu der Build-Zeitpunkt. **Vor jeder Veröffentlichung die Version in `package.json` erhöhen** (Fehlerbehebung: letzte Stelle, neue Funktionen: mittlere Stelle). `npm run deploy` gibt sie auch an den Worker weiter (`/api/health` → `version`).

| Version | Änderungen |
| --- | --- |
| 1.2.0 | Eigene Arbeitsbereiche pro Person, Anleitung beim ersten Start und unter „Hilfe“, Versionsanzeige |
| 1.1.0 | Neuer Name „Notes“, App-Symbol, Startanimation, Web-App für iOS und Android |
| 1.0.0 | Erste Version (Lernraum) |

## Synchronisierung

- Jede Seite ist eine Zeile in D1. `rev` ist eine fortlaufende Revision, die D1 selbst vergibt – Geräteuhren spielen für die Reihenfolge keine Rolle.
- Speichern ist eine **optimistische Sperre**: Ein Gerät schreibt nur, wenn die Seite seit seiner Basis-Revision unverändert ist. Sonst holt es den neuen Stand, führt **blockweise** zusammen (Dreiwege-Merge gegen die Basis) und speichert erneut. So gehen gleichzeitige Änderungen auf iPhone und iPad nicht verloren.
- Neue Stände von anderen Geräten werden übernommen, ohne den gerade fokussierten Block neu aufzubauen – die iOS-Tastatur bleibt offen.
- Offline: Alles liegt zusätzlich in IndexedDB; nicht gespeicherte Änderungen werden beim nächsten Start nachgeholt.

## Als App installieren

- **iPhone/iPad:** In Safari `notes.auer.page` öffnen → Teilen → **Zum Home-Bildschirm**.
- **Android:** In Chrome `notes.auer.page` öffnen → **Installieren** (Karte auf „Heute“, Einstellungen oder Browsermenü ⋮ → *App installieren*). Langes Drücken auf das Symbol zeigt die Kurzbefehle.

Die App startet dann im Vollbild mit Startanimation und öffnet sich auch offline mit dem zuletzt geladenen Stand.

Das Symbol ist randlos und so groß wie möglich gezeichnet: iOS rundet die Ecken selbst ab, für Android gibt es eine eigene *maskable*-Variante, deren Inhalt vollständig im runden Sicherheitsbereich liegt.
