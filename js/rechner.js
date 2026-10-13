// Provisionsrechner für Setter: Provision = Dealgröße × Provisionssatz, mal Anzahl der Abschlüsse.
const CONFIG = {
  provisionssatz: 0.05,    // 5 % der Dealgröße
  dealMin: 200000,         // € kleinste Dealgröße
  dealMax: 5000000,        // € größte Dealgröße
  maxAbschluesse: 24,      // Obergrenze pro Jahr im Rechner
};

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const deal = $('deal'), input = $('abschluesse');
const quickDeal = [...document.querySelectorAll('.quick button[data-d]')];
const quickN = [...document.querySelectorAll('.quick button[data-v]')];

const clampN = (v) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(CONFIG.maxAbschluesse, Math.max(0, v)) : 0; };
const clampD = (v) => { v = Math.round(Number(v) / 50000) * 50000; return Number.isFinite(v) ? Math.min(CONFIG.dealMax, Math.max(CONFIG.dealMin, v)) : 1000000; };

function render() {
  const d = clampD(deal.value), n = clampN(input.value);
  const je = d * CONFIG.provisionssatz, jahr = je * n;
  $('dealOut').textContent = eur.format(d);
  deal.setAttribute('aria-valuetext', eur.format(d));
  $('jahr').textContent = eur.format(jahr);
  $('proAbschluss').textContent = eur.format(je);
  $('monat').textContent = eur.format(jahr / 12);
  $('volumen').textContent = eur.format(d * n);
  $('annahmen').textContent = `Rechnung: ${eur.format(d)} × ${Math.round(CONFIG.provisionssatz * 100)} % = ${eur.format(je)} je Abschluss, bei ${n} Abschlüssen pro Jahr.`;
  quickDeal.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.d === d)));
  quickN.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === n)));
}

const setN = (v) => { input.value = clampN(v); render(); };
const setD = (v) => { deal.value = clampD(v); render(); };

deal.addEventListener('input', () => setD(deal.value));
input.addEventListener('input', () => { if (input.value !== '') setN(input.value); });
input.addEventListener('blur', () => setN(input.value));
quickDeal.forEach((b) => b.addEventListener('click', () => setD(b.dataset.d)));
quickN.forEach((b) => b.addEventListener('click', () => setN(b.dataset.v)));
$('minus').addEventListener('click', () => setN(clampN(input.value) - 1));
$('plus').addEventListener('click', () => setN(clampN(input.value) + 1));
input.max = CONFIG.maxAbschluesse;
render();
