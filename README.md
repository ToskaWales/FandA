# F&A Sales Consulting — Website

Statische Website (HTML, CSS, JavaScript — kein Build-Schritt). Live: https://fasalesconsulting.com/ (GitHub Pages; Domain bei Squarespace, DNS-Einträge siehe unten)

## Seiten
| Datei | Inhalt |
|---|---|
| `index.html` | Für bAV-Vermittler („Closer“): Termine statt Kaltakquise, Ablauf, Vorteile, Setter-Teaser, Partner-Anfrage |
| `karriere.html` | Für Setter (selbstständige Freelancer): Angebot, Provisionsrechner (5 % der Dealgröße, 200.000 € bis 5 Mio. €), FAQ, Bewerbung |
| `impressum.html`, `datenschutz.html` | **Platzhalter — müssen rechtlich geprüft und gefüllt werden** (`noindex`, solange sie leer sind) |

## Vor dem Livegang
1. **Kontaktdaten** stehen in `js/config.js` (E-Mail, Telefon) und gelten für Links, Footer und beide Formulare.
2. **Impressum & Datenschutz** sind mit den Firmendaten befüllt (F&A Sales Consulting GbR, Lohne). Offen: **USt-IdNr.** im Impressum ergänzen, sobald vorhanden (auskommentierter Block in `impressum.html`). HTML-Kommentare enthalten weitere Hinweise (GitHub/DPF-Zertifizierung prüfen, § 34d GewO, B2B-Telefonansprache). Einmal rechtlich prüfen lassen.
3. **Rechner** — Provisionssatz und Dealgrößen-Spanne stehen oben in `js/rechner.js`. Den Einkommenshinweis rechtlich prüfen lassen. Texte laut Vorgabe: keine Festanstellung, keine garantierten Abschlüsse.
4. **Formulare** — öffnen das E-Mail-Programm (`js/form.js`). Für den Dauerbetrieb einen Formular-Dienst oder ein Backend anbinden. Statt Einwilligungs-Checkbox steht ein Datenschutzhinweis (Rechtsgrundlage Art. 6 Abs. 1 lit. b/f DSGVO).
5. Optional: Referenzen/Zitate, Fotos ergänzen.

## Technik
- Schriften (Newsreader, Hanken Grotesk) liegen lokal in `assets/fonts/` (kein Google-Abruf, DSGVO-freundlich).
- Keine Cookies, kein Tracking → kein Cookie-Banner nötig. Bei Einbindung von Analytics/Tools neu bewerten.
- Animationen respektieren „reduzierte Bewegung“.
- Design-Tokens (Farben, Schriften) stehen am Anfang von `css/style.css`.
- Veröffentlichung über GitHub Pages aus dem Standard-Branch; `CNAME`, `sitemap.xml`, `robots.txt` und die Open-Graph-/Canonical-URLs verweisen auf `fasalesconsulting.com`.

## Gestaltung & Assets
- **Guilloché-Ornamente** (`assets/art/*.svg`) sind generiert — Skript: `python3 tools/art.py`. Sie werden per CSS-Maske eingefärbt (`.art`), Farbe über `color`.
- **Open-Graph-Bild** `assets/og.png` (1200×630) und Icons (`assets/icon-*.png`, `favicon.ico`) sind aus Logo/Art abgeleitet; `manifest.webmanifest` verweist darauf.
- **Strukturierte Daten** (JSON-LD): Organisation auf der Startseite, FAQ auf der Karriere-Seite (werden aus den sichtbaren FAQ-Texten erzeugt — bei Textänderungen mitpflegen).
- Bewegung: Zeilen-Reveal der Überschriften, Hero-Rotation beim Scrollen, Prozess-Bühne, Odometer im Rechner, sanfte Seitenübergänge (View Transitions). Alles respektiert „reduzierte Bewegung“.

## Logo
Das Logo (Seal mit Guilloché-Ring, Monogramm „F & A“ in Newsreader, „Sales Consulting“) liegt als SVG vor (`assets/logo.svg`, Buchstaben als Pfade) sowie als Kurzform `assets/logo-mark.svg` (goldenes „&“ im Ring) für Favicon/App-Icon. Neu erzeugen: `pip install fonttools brotli && python3 tools/logo.py`. PNG-Varianten (`logo-512.png`, `icon-*.png`, `apple-touch-icon.png`, `favicon.ico`) und `og.png` sind daraus abgeleitet.

## Gestaltungsprinzipien (gegen den „KI-Look“)
Recherchierte typische KI-Merkmale wurden bewusst vermieden bzw. entfernt: Verlaufstexte und -buttons, Glas-/Blur-Navigation, Leuchteffekte, Stock-Effekte (Cursor-Ring, magnetische Buttons, Count-up/Odometer, Fade-up bei jedem Abschnitt), Icon-Kacheln, Drei-Karten-Reihen, dekorative 01/02/03-Nummerierung (nur echte Abläufe sind nummeriert), gesperrte Großbuchstaben-Etiketten, Pfeile an Buttons, Akzentwort in Überschriften, Standardschrift Inter. Texte: konkret statt Floskeln, kaum Gedankenstriche, keine „nicht nur … sondern“-Konstruktionen. Gold dient nur Marke, Ornament und Hauptaktion.

## Domain (fasalesconsulting.com)
Hauptadresse ohne `www`; `www` leitet dorthin weiter. DNS bei Squarespace (Domains → DNS Settings → Custom Records):
- `A` `@` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- `CNAME` `www` → toskawales.github.io
- Standard-Einträge, die auf Squarespace-Websites zeigen, löschen. **MX/TXT (E-Mail) nicht löschen.**
GitHub: Settings → Pages → Custom domain `fasalesconsulting.com`, danach „Enforce HTTPS“.

## Anfragen & Admin (Supabase)

Formulare speichern Anfragen in einer Datenbank. Ansehen und als „kontaktiert“ markieren geht unter `/admin.html` (nicht verlinkt, `noindex`).

1. Konto auf supabase.com, neues Projekt, **Region: Central EU (Frankfurt)**.
2. **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → Run. (Die erste Admin-E-Mail steht schon drin.)
3. **Authentication → Users → Add user**: E-Mail + Passwort anlegen, „Auto Confirm“ an. **Authentication → Sign In / Providers**: „Allow new users to sign up“ **aus**.
4. **Project Settings → API**: `Project URL` und den `anon`/`publishable` Key in `js/config.js` als `SUPABASE_URL` und `SUPABASE_KEY` eintragen. Der Key ist öffentlich und durch die Regeln im Schema geschützt (Besucher dürfen nur einfügen).
5. Auftragsverarbeitungsvertrag (DPA) bei Supabase abschließen, Datenschutzabschnitt 6 prüfen.

**Weitere Admins:** Person unter *Authentication → Users → Add user* anlegen (Auto Confirm), dann auf `/admin.html` unter „Team“ ihre E-Mail hinzufügen. Entfernen geht dort ebenfalls.

Bleiben die beiden Werte leer, öffnen die Formulare wie bisher das E-Mail-Programm. Schlägt das Senden fehl, greift derselbe Ersatzweg.
