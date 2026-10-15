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

  document.querySelectorAll('form[data-mail-form]').forEach((form) => {
    const status = form.querySelector('.form-status');

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

    const send = async (data) => {
      const v = (id) => (form.elements[id]?.value || '').trim();
      const row = {
        kind: form.dataset.kind || (form.id === 'apply' ? 'setter' : 'partner'),
        name: [v('vorname'), v('nachname'), v('a-name')].filter(Boolean).join(' '),
        email: v('email') || v('a-email'),
        phone: v('telefon') || v('a-tel'),
        company: v('a-firma') || null,
        message: v('nachricht') || v('a-msg') || null,
        data,
      };
      const res = await fetch(`${FA.SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST',
        headers: { apikey: FA.SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row),
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
          await send(data);
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
