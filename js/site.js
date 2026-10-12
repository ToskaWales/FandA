// Dezente Interaktion: Einblenden beim Scrollen, Zahlen-Zähler, Sprungleiste, mobiler CTA.
// Ohne JS oder bei "reduzierter Bewegung" ist alles sofort im Endzustand sichtbar.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (n, dec) => n.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  // Reveal
  const rv = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window) || reduce) {
    rv.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        e.target.querySelectorAll('[data-count]').forEach(count);
        if (e.target.matches('[data-count]')) count(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    rv.forEach((el) => io.observe(el));
  }

  // Zähler
  function count(el) {
    if (reduce || el.dataset.done) return;
    el.dataset.done = '1';
    const to = parseFloat(el.dataset.count), dec = +el.dataset.dec || 0;
    const pre = el.dataset.pre || '', suf = el.dataset.suf || '';
    const t0 = performance.now(), dur = 1100;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + fmt(to * e, dec) + suf;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Sprungleiste: aktiven Abschnitt markieren
  const links = [...document.querySelectorAll('.jump a')];
  if (links.length && 'IntersectionObserver' in window) {
    const map = new Map(links.map((a) => [document.querySelector(a.getAttribute('href')), a]));
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((a) => a.classList.remove('on'));
          map.get(e.target)?.classList.add('on');
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    map.forEach((_, sec) => sec && spy.observe(sec));
  }

  // Mobiler CTA: erst nach dem Hero einblenden, am Formular ausblenden
  const sticky = document.getElementById('sticky');
  const form = document.getElementById('bewerbung');
  if (sticky && 'IntersectionObserver' in window) {
    let pastHero = false, atForm = false;
    const upd = () => sticky.classList.toggle('show', pastHero && !atForm);
    const hero = document.querySelector('.hero');
    new IntersectionObserver(([e]) => { pastHero = !e.isIntersecting; upd(); }).observe(hero);
    if (form) new IntersectionObserver(([e]) => { atForm = e.isIntersecting; upd(); }, { threshold: 0.1 }).observe(form);
  }
})();
