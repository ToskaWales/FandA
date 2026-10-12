// Bewerbungsformular: validiert und öffnet das E-Mail-Programm mit vorbefüllter Nachricht.
// Für den Live-Betrieb besser durch einen Formular-Dienst/Backend ersetzen.
const APPLY_EMAIL = 'platzhalter@example.de'; // [PLATZHALTER]

const form = document.getElementById('apply');
const status = document.getElementById('status');

function validate() {
  let ok = true;
  form.querySelectorAll('[required]').forEach((el) => {
    const valid = el.type === 'checkbox' ? el.checked : el.checkValidity() && el.value.trim() !== '';
    el.closest('.field').classList.toggle('bad', !valid);
    el.setAttribute('aria-invalid', String(!valid));
    if (!valid && ok) { el.focus(); ok = false; }
  });
  return ok;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validate()) return;
  const v = (id) => form.elements[id].value.trim();
  const body = [
    `Name: ${v('vorname')} ${v('nachname')}`,
    `E-Mail: ${v('email')}`,
    `Telefon: ${v('telefon') || '–'}`,
    `Vertriebserfahrung: ${v('erfahrung')}`,
    '',
    v('nachricht') || '–',
  ].join('\n');
  location.href = `mailto:${APPLY_EMAIL}?subject=${encodeURIComponent('Bewerbung Setter – ' + v('vorname') + ' ' + v('nachname'))}&body=${encodeURIComponent(body)}`;
  document.getElementById('statusText').textContent = 'Danke! Dein E-Mail-Programm wurde mit deiner Bewerbung geöffnet. Bitte sende die Nachricht dort ab. Öffnet sich nichts, schreib uns direkt an ' + APPLY_EMAIL + '.';
  status.classList.add('show');
  status.focus();
});

form.addEventListener('input', (e) => {
  const f = e.target.closest('.field');
  if (f && f.classList.contains('bad')) validate();
});
