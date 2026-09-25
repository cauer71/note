# Hinweise für Änderungen an Notes

- Die App zeigt immer ihre Version an. Vor jeder Veröffentlichung (Deploy / Artifact neu veröffentlichen) die Version in `package.json` erhöhen und die Tabelle „Versionen“ in `README.md` ergänzen.
- Deploy: `npm run deploy` (gibt die Version als `APP_VERSION` an den Worker weiter).
- UI-Texte und Kommentare auf Deutsch.
- Tests: `npx playwright test` (Projekte desktop, iphone, ipad, api). Ports über `PW_PORT` / `PW_API_PORT` änderbar.
