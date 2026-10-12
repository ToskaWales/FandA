// Bewusst schlank: Überschriften-Reveal im Hero, Vollbild-Menü am Handy, Aktionsleiste unten.
// Ohne JS oder bei "reduzierter Bewegung" ist alles sofort sichtbar.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lines = document.querySelectorAll('.lines');
  if (reduce || !('IntersectionObserver' in window)) {
    lines.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.2 });
    lines.forEach((el) => io.observe(el));
  }

  // Aktionsleiste (Daumenzone): nach kurzem Scrollen, am Formular aus
  const sticky = document.getElementById('sticky');
  const formEl = document.getElementById('bewerbung') || document.getElementById('anfrage');
  let atForm = false, ticking = false;
  const update = () => { ticking = false; if (sticky) sticky.classList.toggle('show', scrollY > 260 && !atForm); };
  if (sticky) {
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    if (formEl && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { atForm = e.isIntersecting; update(); }, { threshold: 0.1 }).observe(formEl);
    }
    update();
  }

  // Vollbild-Menü
  const btn = document.getElementById('menuBtn'), menu = document.getElementById('menu'), close = document.getElementById('menuClose');
  if (btn && menu) {
    const inert = [document.getElementById('main'), document.querySelector('footer.site'), sticky].filter(Boolean);
    const setOpen = (open) => {
      menu.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      inert.forEach((el) => (open ? el.setAttribute('inert', '') : el.removeAttribute('inert')));
      if (open) setTimeout(() => menu.querySelector('nav a')?.focus(), 60); else btn.focus();
    };
    btn.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false));
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) setOpen(false); });
    matchMedia('(min-width:760px)').addEventListener('change', (m) => { if (m.matches) setOpen(false); });
  }
})();
