// Interaktion: Einblenden & Zeilen-Reveal, Hero-Parallax, Scroll-Fortschritt,
// Prozess-Bühne, mobiler CTA. Ohne JS oder bei "reduzierter Bewegung" ist alles sofort sichtbar.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const targets = document.querySelectorAll('.rv, .lines, section.s');

  if (!('IntersectionObserver' in window) || reduce) {
    targets.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
  }

  // Scroll-Fortschritt + Hero-Rotation (ein rAF-Loop, nur bei Bewegung)
  const heroArt = document.querySelector('.hero-art');
  const fine = matchMedia('(pointer:fine)').matches;
  const sticky = document.getElementById('sticky');
  const formEl = document.getElementById('bewerbung') || document.getElementById('anfrage');
  let atForm = false;
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = root.scrollHeight - innerHeight;
      root.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
      if (heroArt && !reduce && fine) heroArt.style.setProperty('--rot', (scrollY * 0.04).toFixed(2) + 'deg');
      if (sticky) sticky.classList.toggle('show', scrollY > 260 && !atForm);
      ticking = false;
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Prozess-Bühne: aktiver Schritt steuert Ornament und Ziffer
  const steps = [...document.querySelectorAll('.proc-steps > li')];
  const arts = [...document.querySelectorAll('.proc-art .art')];
  const num = document.getElementById('procNum');
  if (steps.length && 'IntersectionObserver' in window) {
    const roman = ['01', '02', '03', '04'];
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const i = +e.target.dataset.step;
        steps.forEach((s) => s.classList.toggle('on', s === e.target));
        arts.forEach((a, k) => a.classList.toggle('on', k === i));
        if (num && num.textContent !== roman[i]) {
          num.classList.add('swap');
          setTimeout(() => { num.textContent = roman[i]; num.classList.remove('swap'); }, reduce ? 0 : 250);
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach((s) => spy.observe(s));
  }

  // Daumenzone-CTA: am Formular ausblenden
  if (sticky && formEl && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { atForm = e.isIntersecting; onScroll(); }, { threshold: 0.1 }).observe(formEl);
  }

  // Mobiles Vollbild-Menü
  const btn = document.getElementById('menuBtn'), menu = document.getElementById('menu'), close = document.getElementById('menuClose');
  if (btn && menu) {
    const inert = [document.getElementById('main'), document.querySelector('footer.site'), sticky].filter(Boolean);
    const setOpen = (open) => {
      menu.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      inert.forEach((el) => open ? el.setAttribute('inert', '') : el.removeAttribute('inert'));
      if (open) setTimeout(() => menu.querySelector('nav a')?.focus(), 60); else btn.focus();
    };
    btn.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false));
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) setOpen(false); });
    matchMedia('(min-width:760px)').addEventListener('change', (m) => { if (m.matches) setOpen(false); });
  }

  // Nur mit Maus: Hero-Spotlight folgt dem Zeiger, Cursor-Ring, magnetische Buttons
  if (!reduce && matchMedia('(pointer:fine)').matches) {
    const hero = document.querySelector('.hero');
    if (hero) hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    const ring = document.querySelector('.cursor');
    if (ring) {
      let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y;
      addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; ring.classList.add('on'); });
      document.addEventListener('pointerleave', () => ring.classList.remove('on'));
      const loop = () => { x += (tx - x) * 0.18; y += (ty - y) * 0.18; ring.style.transform = `translate(${x}px,${y}px)`; requestAnimationFrame(loop); };
      loop();
      document.addEventListener('pointerover', (e) => ring.classList.toggle('big', !!e.target.closest('a, button, summary, label, input, select, textarea')));
    }
    document.querySelectorAll('.btn').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${((e.clientX - r.left) / r.width - 0.5) * 8}px, ${((e.clientY - r.top) / r.height - 0.5) * 6}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }
})();
