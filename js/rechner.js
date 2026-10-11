// Provisionsrechner für Setter: Provision = Abschlüsse × Ø Dealgröße × Provisionssatz.
const CONFIG = {
  dealgroesse: 2500000,     // € Ø Dealgröße
  provisionssatz: 0.05,     // 5 % Setter-Provision
  maxAbschluesseProMonat: 10,
};

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const input = $('abschluesse'), slider = $('slider');
const provisionJeDeal = CONFIG.dealgroesse * CONFIG.provisionssatz;

function clamp(v) {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(CONFIG.maxAbschluesseProMonat, Math.max(0, v)) : 0;
}

function render(n) {
  const monat = n * provisionJeDeal, jahr = monat * 12;
  $('jahr').textContent = eur.format(jahr);
  $('monat').textContent = eur.format(monat);
  $('proJahr').textContent = n * 12;
  $('proAbschluss').textContent = eur.format(provisionJeDeal);
}

function set(v) {
  const n = clamp(v);
  input.value = slider.value = n;
  render(n);
}

$('annahmen').textContent =
  `Basis: Ø Dealgröße ${eur.format(CONFIG.dealgroesse)} · Provision ${Math.round(CONFIG.provisionssatz * 100)} % = ${eur.format(provisionJeDeal)} je Abschluss`;
$('maxlabel').textContent = CONFIG.maxAbschluesseProMonat;
input.max = slider.max = CONFIG.maxAbschluesseProMonat;
input.addEventListener('input', () => { if (input.value !== '') set(input.value); });
input.addEventListener('blur', () => set(input.value));
slider.addEventListener('input', () => set(slider.value));
$('minus').addEventListener('click', () => set(clamp(input.value) - 1));
$('plus').addEventListener('click', () => set(clamp(input.value) + 1));
set(input.value);
