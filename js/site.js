// Zurückhaltende Interaktion: Einblenden beim Scrollen, mobiler CTA.
// Ohne JS oder bei "reduzierter Bewegung" ist alles sofort sichtbar.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rv = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window) || reduce) {
    rv.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
    rv.forEach((el) => io.observe(el));
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
