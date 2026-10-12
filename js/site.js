// Interaktion: Einblenden & Zeilen-Reveal, Hero-Parallax, Scroll-Fortschritt,
// Prozess-Bühne, mobiler CTA. Ohne JS oder bei "reduzierter Bewegung" ist alles sofort sichtbar.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const targets = document.querySelectorAll('.rv, .lines');

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
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = root.scrollHeight - innerHeight;
      root.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
      if (heroArt && !reduce) heroArt.style.setProperty('--rot', (scrollY * 0.04).toFixed(2) + 'deg');
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
    const roman = ['I', 'II', 'III', 'IV'];
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

  // Mobiler CTA: erst nach dem Hero einblenden, am Formular ausblenden
  const sticky = document.getElementById('sticky');
  const form = document.getElementById('bewerbung');
  if (sticky && 'IntersectionObserver' in window) {
    let pastHero = false, atForm = false;
    const upd = () => sticky.classList.toggle('show', pastHero && !atForm);
    new IntersectionObserver(([e]) => { pastHero = !e.isIntersecting; upd(); }).observe(document.querySelector('.hero'));
    if (form) new IntersectionObserver(([e]) => { atForm = e.isIntersecting; upd(); }, { threshold: 0.1 }).observe(form);
  }
})();
