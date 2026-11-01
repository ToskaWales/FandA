# F&A Sales Consulting — Website

Statische Website (HTML, CSS, JavaScript — kein Build-Schritt). Live: https://fasalesconsulting.com/ (GitHub Pages; Domain bei Squarespace, DNS-Einträge siehe unten)

## Seiten
| Datei | Inhalt |
|---|---|
| `index.html` | Für bAV-Vermittler („Closer“): interaktiver Beispielkalender, Ablauf, Vorteile, Terminwunsch und Partner-Anfrage |
| `karriere.html` | Für Setter (selbstständige Freelancer): Angebot, Provisionsrechner (5 % der Dealgröße, 200.000 € bis 5 Mio. €), FAQ, Bewerbung |
| `impressum.html`, `datenschutz.html` | **Platzhalter — müssen rechtlich geprüft und gefüllt werden** (`noindex`, solange sie leer sind) |

## Vor dem Livegang
1. **Kontaktdaten** stehen in `js/config.js` (E-Mail, Telefon) und gelten für Links, Footer und beide Formulare.
2. **Impressum & Datenschutz** sind mit den Firmendaten befüllt (F&A Sales Consulting GbR, Lohne). Offen: **USt-IdNr.** im Impressum ergänzen, sobald vorhanden (auskommentierter Block in `impressum.html`). HTML-Kommentare enthalten weitere Hinweise (GitHub/DPF-Zertifizierung prüfen, § 34d GewO, B2B-Telefonansprache). Einmal rechtlich prüfen lassen.
3. **Rechner** — Provisionssatz und Dealgrößen-Spanne stehen oben in `js/rechner.js`. Den Einkommenshinweis rechtlich prüfen lassen. Texte laut Vorgabe: keine Festanstellung, keine garantierten Abschlüsse.
4. **Formulare** — öffnen das E-Mail-Programm (`js/form.js`). Für den Dauerbetrieb einen Formular-Dienst oder ein Backend anbinden. Statt Einwilligungs-Checkbox steht ein Datenschutzhinweis (Rechtsgrundlage Art. 6 Abs. 1 lit. b/f DSGVO).
5. Optional: Referenzen/Zitate, Fotos ergänzen.

## Technik
- Schriften (Newsreader, Hanken Grotesk) liegen lokal in `assets/fonts/`; auch die Startseite lädt keine Google-Schriften.
- Keine Cookies, kein Tracking → kein Cookie-Banner nötig. Bei Einbindung von Analytics/Tools neu bewerten.
- Animationen respektieren „reduzierte Bewegung“.
- Die Closer- und Setter-Landingpages teilen sich das Designsystem aus `css/landing.css`; ihre seitenspezifischen Skripte und Inhalte bleiben getrennt. Die übrigen Seiten verwenden `css/style.css`.
- Veröffentlichung über GitHub Pages aus dem Standard-Branch; `CNAME`, `sitemap.xml`, `robots.txt` und die Open-Graph-/Canonical-URLs verweisen auf `fasalesconsulting.com`.

## Gestaltung & Assets
- **Guilloché-Ornamente** (`assets/art/*.svg`) sind generiert — Skript: `python3 tools/art.py`. Sie werden per CSS-Maske eingefärbt (`.art`), Farbe über `color`.
- **Open-Graph-Bild** `assets/og.png` (1200×630) und Icons (`assets/icon-*.png`, `favicon.ico`) sind aus Logo/Art abgeleitet; `manifest.webmanifest` verweist darauf.
- **Strukturierte Daten** (JSON-LD): Organisation auf der Startseite, FAQ auf der Karriere-Seite (werden aus den sichtbaren FAQ-Texten erzeugt — bei Textänderungen mitpflegen).
- Bewegung: interaktiver Kalender und Prozess-Bühne auf der Startseite, Rechnerinteraktionen und das gemeinsame mobile Navigationsmenü. Alles respektiert „reduzierte Bewegung“.

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

## CRM (Supabase): Leads, Recruiter, Ads, Auszahlungen

Grundlage ist der Bauplan „Recruiting-CRM mit Meta-Ads-Anbindung“ (Stand 01.11.2026). Er liegt **bewusst nicht im Repo**, weil GitHub Pages alles im Repo öffentlich ausliefert. Abschnittsnummern unten (z. B. „Bauplan 4.3“) beziehen sich auf ihn.

- **Website-Formulare** (`js/form.js`) senden an die Edge Function `submit-lead`. Bewerbungen werden Leads und gehen per `?ref=` an den Recruiter; Partner-Anfragen von Vermittlern landen in `partner_requests`. Ist Supabase nicht erreichbar, öffnet sich wie bisher das E-Mail-Programm.
- **CRM** unter `/admin.html` (nicht verlinkt, `noindex`): Admins sehen alles, Recruiter nur ihre eigenen Leads. Die Rechte erzwingt die Datenbank (Row Level Security), die Oberfläche blendet nur aus. Code: `js/admin/*.js`, ohne Build-Schritt.
- **Geld** (Zahlungen, Provisionen, Auszahlungen) ist anwaltlich geprüft (Bauplan P2) und eingeschaltet. Ausblenden: `MONEY_ENABLED: false` in `js/config.js`.

### Dateien
| Pfad | Inhalt |
|---|---|
| `supabase/migrations/` | In dieser Reihenfolge: `000050_rename_legacy` (alte Tabellen beiseite) → `000100_core` → `000150_migrate_legacy` (alte Anfragen/Admins übernehmen, `partner_requests`) → `000200_money` → `000300_ads_ai` → `000400_groups` |
| `supabase/manual/005_cron.sql` | Zeitpläne (pg_cron). Mit Platzhaltern, darum **nicht** in `migrations/`: von Hand im SQL-Editor ausführen |
| `supabase/tests/900_smoke_test.sql` | Abnahmetest (rund 85 Prüfungen, rollt alles zurück) |
| `supabase/functions/` | `submit-lead`, `meta-leadgen-webhook`, `admin-invite`, `sync-meta-insights`, `weekly-ad-report`, `draft-reply` |
| `supabase/config.toml` | `verify_jwt = false` für alle sechs Funktionen (jede prüft selbst: Signatur, `x-cron-secret` oder Login) |
| `supabase/legacy/schema.sql` | Das alte Schema, nur noch als Verlauf |

### Einrichten (direkt auf dem echten Projekt; der Abnahmetest rollt alles zurück)
1. **CLI:** `npx supabase login`, dann `npx supabase link --project-ref <REF>`.
2. **Sicherung (nur echtes Projekt):** Table Editor → `leads` und `admins` als CSV exportieren.
3. **Migrationen:** `npx supabase db push`. Die alten Tabellen heißen danach `legacy_leads`/`legacy_admins`; nach 30 Tagen von Hand löschen (`drop table legacy_leads, legacy_admins;`).
4. **Abnahmetest:** Drei Test-Nutzer unter Authentication → Users anlegen, die **noch kein Profil** haben (also nicht die bestehenden Admins), UUIDs in `900_smoke_test.sql` eintragen, im SQL-Editor ausführen. Erwartet: `Alle Tests bestanden`.
5. **Login:** Authentication → URL Configuration: Site URL `https://fasalesconsulting.com/admin.html`, dieselbe Adresse unter Redirect URLs. „Allow new users to sign up“ bleibt aus.
6. **Funktionen:** `npx supabase functions deploy` (alle). Secrets nur per CLI setzen, **nie ins Repo**:
   ```bash
   npx supabase secrets set ALLOWED_ORIGINS="https://fasalesconsulting.com,https://www.fasalesconsulting.com" \
     INVITE_REDIRECT_URL="https://fasalesconsulting.com/admin.html" CRON_SECRET="<langer Zufallswert>"
   # ab Meta (Bauplan 4.3): META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_TOKENS, META_SYSTEM_TOKEN, META_AD_ACCOUNT_ID
   # ab KI: ANTHROPIC_API_KEY (optional AI_MODEL)    ab Bot-Schutz: TURNSTILE_SECRET (+ TURNSTILE_SITE_KEY in js/config.js)
   ```
7. **Zeitpläne:** Database → Extensions: `pg_cron`, `pg_net`, `supabase_vault` an. Dann `supabase/manual/005_cron.sql` mit eingesetztem Projekt-Ref und `CRON_SECRET` ausführen (`meta-sync-daily` und `weekly-ad-report` erst, wenn die Meta- bzw. KI-Secrets gesetzt sind).
8. **Recruiter anlegen:** CRM → Betreuer → Person anlegen (mit E-Mail) → „Zum Login einladen“. Der Link-Code entsteht automatisch.
9. **Erst danach** die Website-Änderungen auf GitHub veröffentlichen: Die Formulare brauchen `submit-lead`, die Admin-Seite braucht das neue Schema.

### Meta, KI, Livegang
- Meta-App, Webhook, Berechtigungen, App Review: Checkliste in Bauplan 4.3 (früh beantragen, dauert). Anzeigen bekommen ihren Recruiter/Creator über den Namen: `[ref:<link-code>] [cr:<creator-code>]` (Codes zum Kopieren auf den Seiten Betreuer/Creators).
- Vor dem Livegang (Bauplan Schritt 9): Turnstile an, Backups/PITR an, Datenschutzerklärung um Meta, Anthropic und Turnstile ergänzen (Hinweis als Kommentar in `datenschutz.html`), AV-Verträge, RLS mit zwei Recruiter-Konten durchklicken, einmal `erase_lead` mit Testdaten.

### Testen ohne Supabase
Die Migrationen und der Abnahmetest lassen sich lokal in PGlite (Postgres als WebAssembly, `npm i @electric-sql/pglite`) mit nachgebauten Supabase-Teilen (`auth.uid()`, Rollen, `storage`) ausführen. So wurden sie auch geprüft: frisch (`Alle Tests bestanden`), nur Kern (`Kern-Tests bestanden`) und mit Altdaten-Übernahme.
