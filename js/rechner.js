// Provisionsrechner für Setter: Provision = Abschlüsse × Ø Dealgröße × Provisionssatz.
const CONFIG = {
  dealgroesse: 2500000,   // € Ø Dealgröße
  provisionssatz: 0.05,   // 5 % Setter-Provision
  maxAbschluesse: 24,     // Obergrenze pro Jahr im Rechner
  millionSchwelle: 1000000,
};

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const input = $('abschluesse'), slider = $('slider');
const quick = [...document.querySelectorAll('.quick button')];
const provisionJeDeal = CONFIG.dealgroesse * CONFIG.provisionssatz;
const abschlussFuerMillion = Math.ceil(CONFIG.millionSchwelle / provisionJeDeal);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function clamp(v) {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(CONFIG.maxAbschluesse, Math.max(0, v)) : 0;
}

// Odometer: jede Ziffer rollt als Streifen 0–9 an ihre Position
const odo = $('jahr');
function odoSet(text) {
  odo.setAttribute('aria-label', text);
  const chars = [...text];
  const sig = chars.map((c) => (/\d/.test(c) ? 'd' : c)).join('');
  if (odo.dataset.sig !== sig) {          // Struktur ändert sich (z. B. 6 → 7 Stellen): neu aufbauen
    odo.dataset.sig = sig;
    odo.innerHTML = chars.map((c) => {
      if (/\d/.test(c)) return `<span class="c dg" aria-hidden="true"><span class="strip">${[0,1,2,3,4,5,6,7,8,9].map((d) => `<span>${d}</span>`).join('')}</span></span>`;
      if (c === '€') return '<span class="c cur" aria-hidden="true">€</span>';
      return `<span class="c sep" aria-hidden="true">${c === ' ' || c === '\u00a0' ? '&nbsp;' : c}</span>`;
    }).join('');
  }
  let k = 0;
  odo.querySelectorAll('.strip').forEach((st) => {
    const d = +chars.filter((c) => /\d/.test(c))[k++];
    st.style.transform = `translateY(${-d * 1.12}em)`;
  });
}
function tween(to) { odoSet(eur.format(to)); }

function render(n) {
  const jahr = n * provisionJeDeal;
  tween(jahr);
  quick.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === n)));
  $('monat').textContent = eur.format(jahr / 12);
  $('volumen').textContent = eur.format(n * CONFIG.dealgroesse);
  $('proAbschluss').textContent = eur.format(provisionJeDeal);
  $('hinweis').textContent = n >= abschlussFuerMillion
    ? 'Bei dieser Rechnung läge die Provision im siebenstelligen Bereich.'
    : `Rechnerisch ab ${abschlussFuerMillion} Abschlüssen pro Jahr siebenstellig.`;
}

function set(v) {
  const n = clamp(v);
  input.value = slider.value = n;
  render(n);
}

$('annahmen').textContent =
  `Basis: Ø Dealgröße ${eur.format(CONFIG.dealgroesse)} × ${Math.round(CONFIG.provisionssatz * 100)} % Provision = ${eur.format(provisionJeDeal)} je Abschluss.`;
$('maxlabel').textContent = CONFIG.maxAbschluesse;
input.max = slider.max = CONFIG.maxAbschluesse;
input.addEventListener('input', () => { if (input.value !== '') set(input.value); });
input.addEventListener('blur', () => set(input.value));
slider.addEventListener('input', () => set(slider.value));
quick.forEach((b) => b.addEventListener('click', () => set(b.dataset.v)));
$('minus').addEventListener('click', () => set(clamp(input.value) - 1));
$('plus').addEventListener('click', () => set(clamp(input.value) + 1));
set(input.value);
