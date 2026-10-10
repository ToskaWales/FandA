// Provisionsrechner — alle Werte sind PLATZHALTER und vor Veröffentlichung anzupassen.
const CONFIG = {
  durchschnittlichePraemie: 1200,   // € Jahresprämie je Abschluss [PLATZHALTER]
  provisionssatz: 0.40,             // Provision in % der Jahresprämie [PLATZHALTER]
  stornoQuote: 0.10,                // Anteil Storno-Reserve [PLATZHALTER]
  bonusStufen: [                    // Bonus je Abschluss ab Anzahl [PLATZHALTER]
    { ab: 10, bonus: 50 },
    { ab: 20, bonus: 100 },
  ],
  maxAbschluesse: 100,
};

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const input = $('abschluesse'), slider = $('slider');

function clamp(v) {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(CONFIG.maxAbschluesse, Math.max(0, v)) : 0;
}

function berechne(n) {
  const basis = n * CONFIG.durchschnittlichePraemie * CONFIG.provisionssatz;
  const stufe = [...CONFIG.bonusStufen].reverse().find((s) => n >= s.ab);
  const brutto = basis + (stufe ? stufe.bonus * n : 0);
  const reserve = brutto * CONFIG.stornoQuote;
  return { netto: brutto - reserve, reserve, proAbschluss: n ? (brutto - reserve) / n : 0 };
}

function render(n) {
  const r = berechne(n);
  $('monat').textContent = eur.format(r.netto);
  $('jahr').textContent = eur.format(r.netto * 12);
  $('proAbschluss').textContent = eur.format(r.proAbschluss);
  $('storno').textContent = '−' + eur.format(r.reserve);
}

function set(v) {
  const n = clamp(v);
  input.value = slider.value = n;
  render(n);
}

$('annahmen').textContent =
  `Annahmen: Ø Prämie ${eur.format(CONFIG.durchschnittlichePraemie)} · Satz ${Math.round(CONFIG.provisionssatz * 100)} % · Storno ${Math.round(CONFIG.stornoQuote * 100)} % [PLATZHALTER]`;
input.max = slider.max = CONFIG.maxAbschluesse;
input.addEventListener('input', () => { if (input.value !== '') set(input.value); });
input.addEventListener('blur', () => set(input.value));
slider.addEventListener('input', () => set(slider.value));
$('minus').addEventListener('click', () => set(clamp(input.value) - 1));
$('plus').addEventListener('click', () => set(clamp(input.value) + 1));
set(input.value);
