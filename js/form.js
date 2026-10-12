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

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate()) return;
      const lines = [];
      form.querySelectorAll('input:not([type=checkbox]), select, textarea').forEach((el) => {
        const label = form.querySelector(`label[for="${el.id}"]`);
        const name = label ? label.textContent.replace('(optional)', '').trim() : el.name;
        if (el.value.trim()) lines.push(`${name}: ${el.value.trim()}`);
      });
      const who = (form.elements.vorname?.value || form.elements.name?.value || '').trim();
      const subject = `${form.dataset.subject}${who ? ' – ' + who : ''}`;
      location.href = `mailto:${FA.EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
      const formal = form.hasAttribute('data-formal');
      status.querySelector('[data-status-text]').textContent = formal
        ? `Danke! Die Nachricht liegt in Ihrem E-Mail-Programm bereit — bitte senden Sie sie dort ab. Öffnet sich nichts, schreiben Sie uns direkt an ${FA.EMAIL}.`
        : `Danke! Die Nachricht liegt in deinem E-Mail-Programm bereit — bitte sende sie dort ab. Öffnet sich nichts, schreib uns direkt an ${FA.EMAIL}.`;
      status.classList.add('show');
      status.focus();
    });

    form.addEventListener('input', (e) => {
      const f = e.target.closest('.field');
      if (f && f.classList.contains('bad')) validate();
    });
  });
})();
