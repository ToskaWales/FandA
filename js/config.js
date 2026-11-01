// Zentrale Kontaktdaten. Hier einmal ändern — gilt für alle Seiten, Links und Formulare.
window.FA = {
  EMAIL: 'info@fasalesconsulting.com',
  PHONE: '+49 4442 9499985',        // leer lassen = Telefon wird im Footer nicht angezeigt
  // Anfragen speichern (Supabase). Beides leer lassen = Formulare öffnen wie bisher das E-Mail-Programm.
  // Anleitung: README.md, Abschnitt "Anfragen & Admin". Der Schlüssel ist der öffentliche "anon"/"publishable" Key.
  SUPABASE_URL: 'https://xohxhrbpcrnslcgumgya.supabase.co',                // z. B. https://abcdefgh.supabase.co
  SUPABASE_KEY: 'sb_publishable_5zts9mpV-oWOCwKOx0o1lw_gbFlsxqp',                // anon / publishable key (öffentlich, durch die Regeln in supabase/migrations geschützt)
  TURNSTILE_SITE_KEY: '',     // Cloudflare Turnstile (öffentlicher Site-Key). Leer = aus. Gesetzt = TURNSTILE_SECRET in Supabase setzen.
  // Zahlungen, Auszahlungen, Provisionen im CRM anzeigen. Erst nach der anwaltlichen Prüfung (Bauplan P2) auf true setzen.
  MONEY_ENABLED: false,
};
