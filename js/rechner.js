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
const provisionJeDeal = CONFIG.dealgroesse * CONFIG.provisionssatz;
const abschlussFuerMillion = Math.ceil(CONFIG.millionSchwelle / provisionJeDeal);

function clamp(v) {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(CONFIG.maxAbschluesse, Math.max(0, v)) : 0;
}

const bars = [...document.querySelectorAll('#bars i')];
const chips = [...document.querySelectorAll('.chip')];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shown = 0, raf;

function tween(to) {
  cancelAnimationFrame(raf);
  if (reduce) { shown = to; $('jahr').textContent = eur.format(to); return; }
  const from = shown, t0 = performance.now(), dur = 450;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    shown = from + (to - from) * e;
    $('jahr').textContent = eur.format(shown);
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function render(n) {
  const jahr = n * provisionJeDeal;
  tween(jahr);
  bars.forEach((b, i) => b.classList.toggle('on', i < n));
  chips.forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.v === n)));
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
chips.forEach((c) => c.addEventListener('click', () => set(c.dataset.v)));
$('minus').addEventListener('click', () => set(clamp(input.value) - 1));
$('plus').addEventListener('click', () => set(clamp(input.value) + 1));
set(input.value);
