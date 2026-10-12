# F&A Sales Consulting — Website

Statische Website (HTML, CSS, JavaScript — kein Build-Schritt). Live: https://toskawales.github.io/FandA/

## Seiten
| Datei | Inhalt |
|---|---|
| `index.html` | Unternehmen: Terminsetting für bAV-Vermittler, Prozess, Team, Anfrageformular |
| `karriere.html` | Setter-Karriere: Angebot, Karriereweg, Provisionsrechner, FAQ, Bewerbung |
| `coaching.html` | Coaching: Methode, Bausteine, FAQ |
| `impressum.html`, `datenschutz.html` | **Platzhalter — müssen rechtlich geprüft und gefüllt werden** (`noindex`, solange sie leer sind) |

## Vor dem Livegang ausfüllen
1. **`js/config.js`** — E-Mail und Telefon eintragen. Gilt automatisch für alle Links, den Footer und beide Formulare.
2. **Impressum & Datenschutz** — Platzhalter `[PLATZHALTER: …]` ersetzen und rechtlich prüfen lassen; danach `<meta name="robots" content="noindex">` in beiden Dateien entfernen.
3. **Rechner** — Werte (Ø-Dealgröße, Provisionssatz) stehen oben in `js/rechner.js`. Den Einkommenshinweis im Rechner rechtlich prüfen lassen (Verdienstaussagen).
4. **Formulare** — öffnen aktuell das E-Mail-Programm (`js/form.js`). Für den Dauerbetrieb einen Formular-Dienst oder ein Backend anbinden.
5. Optional: Referenzen/Zitate, Team- und Coach-Profile, Fotos ergänzen.

## Technik
- Schriften (Cormorant Garamond, Inter) liegen lokal in `assets/fonts/` (kein Google-Abruf, DSGVO-freundlich).
- Keine Cookies, kein Tracking → kein Cookie-Banner nötig. Bei Einbindung von Analytics/Tools neu bewerten.
- Animationen respektieren „reduzierte Bewegung“.
- Design-Tokens (Farben, Schriften) stehen am Anfang von `css/style.css`.
- Veröffentlichung über GitHub Pages aus dem Standard-Branch; `sitemap.xml`/`robots.txt`/Open-Graph-URLs verweisen auf `toskawales.github.io/FandA` und bei eigener Domain anpassen.
