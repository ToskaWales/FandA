// Formulare (Bewerbung, Anfrage): validieren und E-Mail-Programm mit vorbefüllter Nachricht öffnen.
// Für den Live-Betrieb idealerweise durch einen Formular-Dienst/Backend ersetzen.
(() => {
  const FA = window.FA || {};

  // Kontaktdaten aus config.js einsetzen
  document.querySelectorAll('[data-mail]').forEach((a) => { if (FA.EMAIL) a.href = 'mailto:' + FA.EMAIL; });
  document.querySelectorAll('[data-mail-text]').forEach((a) => { if (FA.EMAIL) a.textContent = FA.EMAIL; });
  document.querySelectorAll('[data-tel]').forEach((a) => {
    if (!FA.PHONE) return;
    a.href = 'tel:' + FA.PHONE.replace(/[^+\d]/g, '');
    a.hidden = false;
    if (a.hasAttribute('data-tel-text')) a.textContent = FA.PHONE;
  });

  // Tracking-Parameter (?ref= Recruiter, src= Kanal, post= Gruppen-Post, ad_id= Website-Anzeige, utm_*) beim Absenden aus der URL lesen.
  // Bewusst ohne sessionStorage/Cookie: die Datenschutzerklärung sagt "keine Speicherung auf dem Endgerät" (§ 25 TDDDG, Bauplan 11.2 Nr. 4).
  // Darum zeigen Tracking-Links direkt auf das Formular (karriere.html?ref=…#apply).
  const TRACK_KEYS = ['ref', 'src', 'post', 'ad_id', 'utm_source', 'utm_medium', 'utm_campaign'];
  const readTrack = () => {
    const q = new URLSearchParams(location.search);
    const out = {};
    TRACK_KEYS.forEach((k) => { if (q.get(k)) out[k] = q.get(k).slice(0, 120); });
    return out;
  };

  // Cloudflare Turnstile (Bot-Schutz) nur, wenn in config.js ein Site-Key steht; dann muss auch TURNSTILE_SECRET in Supabase gesetzt sein.
  if (FA.TURNSTILE_SITE_KEY && FA.SUPABASE_URL && document.querySelector('form[data-mail-form]')) {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  document.querySelectorAll('form[data-mail-form]').forEach((form) => {
    const status = form.querySelector('.form-status');
    if (FA.TURNSTILE_SITE_KEY && FA.SUPABASE_URL) {
      const ts = document.createElement('div');
      ts.className = 'cf-turnstile'; ts.dataset.sitekey = FA.TURNSTILE_SITE_KEY; ts.dataset.language = 'de';
      form.querySelector('button[type=submit]').before(ts);
    }

    const validate = () => {
      let ok = true;
      form.querySelectorAll('[required]').forEach((el) => {
        const valid = el.type === 'checkbox' ? el.checked : el.checkValidity() && el.value.trim() !== '';
        el.closest('.field').classList.toggle('bad', !valid);
        el.setAttribute('aria-invalid', String(!valid));
        if (!valid && ok) { el.focus(); ok = false; }
      });
      return ok;
    };

    const hp = document.createElement('input');   // Spam-Falle: Menschen sehen das Feld nicht
    hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    form.appendChild(hp);
    const t0 = Date.now();

    const collect = () => {
      const data = {};
      form.querySelectorAll('input:not([type=checkbox]):not([name=website]), select, textarea').forEach((el) => {
        const label = form.querySelector(`label[for="${el.id}"]`);
        const name = label ? label.textContent.replace('(optional)', '').trim() : el.name;
        if (el.value.trim()) data[name] = el.value.trim();
      });
      return data;
    };

    const mailFallback = (data) => {
      const lines = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
      const who = (form.elements.vorname?.value || form.elements.name?.value || form.elements['a-name']?.value || '').trim();
      const subject = `${form.dataset.subject}${who ? ' – ' + who : ''}`;
      location.href = `mailto:${FA.EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
    };

    // Speichern über die Edge Function submit-lead (prüft, entdoppelt, teilt dem Recruiter zu). Direkt in die Tabelle darf niemand mehr schreiben.
    const MAPPED = new Set(['vorname', 'nachname', 'email', 'telefon', 'nachricht', 'a-name', 'a-firma', 'a-email', 'a-tel', 'a-msg', 'website']);
    const send = async () => {
      const v = (id) => (form.elements[id]?.value || '').trim();
      const extra = {};
      form.querySelectorAll('input:not([type=checkbox]), select, textarea').forEach((el) => {
        if (!el.name || MAPPED.has(el.name) || !el.value.trim()) return;
        const label = form.querySelector(`label[for="${el.id}"]`);
        extra[label ? label.textContent.replace('(optional)', '').trim() : el.name] = el.value.trim();
      });
      const body = {
        kind: form.dataset.kind || (form.id === 'apply' ? 'setter' : 'partner'),
        first_name: v('vorname') || null, last_name: v('nachname') || null, name: v('a-name') || null,
        email: v('email') || v('a-email') || null, phone: v('telefon') || v('a-tel') || null,
        firma: v('a-firma') || null, message: v('nachricht') || v('a-msg') || null, data: extra,
        consent: true,            // Formular zeigt den Datenschutzhinweis (Art. 6 Abs. 1 lit. b/f DSGVO), keine Checkbox
        company: hp.value,        // Honeypot, muss leer sein
        turnstile_token: form.querySelector('[name="cf-turnstile-response"]')?.value || undefined,
        ...readTrack(),
      };
      const res = await fetch(`${FA.SUPABASE_URL}/functions/v1/submit-lead`, {
        method: 'POST',
        headers: { apikey: FA.SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) return;
      const formal = form.hasAttribute('data-formal');
      const text = status.querySelector('[data-status-text]');
      const btn = form.querySelector('button[type=submit]');
      const data = collect();
      const show = (msg) => { text.textContent = msg; status.classList.add('show'); status.focus(); };

      if (hp.value || Date.now() - t0 < 2500) {               // Bot: so tun, als wäre alles gut
        show(formal ? 'Danke! Wir melden uns bei Ihnen.' : 'Danke! Wir melden uns bei dir.');
        return;
      }
      if (FA.SUPABASE_URL && FA.SUPABASE_KEY) {
        btn.disabled = true;
        try {
          await send();
          form.reset();
          show(formal ? 'Danke! Ihre Nachricht ist bei uns angekommen. Wir melden uns persönlich bei Ihnen.'
                      : 'Danke! Deine Nachricht ist bei uns angekommen. Wir melden uns persönlich bei dir.');
        } catch (err) {
          mailFallback(data);
          show(`Das direkte Senden hat nicht geklappt. Deine Nachricht liegt jetzt in deinem E-Mail-Programm bereit, bitte sende sie dort ab. Oder schreib uns an ${FA.EMAIL}.`);
        } finally { btn.disabled = false; }
        return;
      }
      mailFallback(data);
      show(formal
        ? `Danke! Die Nachricht liegt in Ihrem E-Mail-Programm bereit. Bitte senden Sie sie dort ab. Öffnet sich nichts, schreiben Sie uns direkt an ${FA.EMAIL}.`
        : `Danke! Die Nachricht liegt in deinem E-Mail-Programm bereit. Bitte sende sie dort ab. Öffnet sich nichts, schreib uns direkt an ${FA.EMAIL}.`);
    });

    form.addEventListener('input', (e) => {
      const f = e.target.closest('.field');
      if (f && f.classList.contains('bad')) validate();
    });
  });
})();
