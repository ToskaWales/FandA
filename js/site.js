// Mobile-Lesefluss: Textblöcke erscheinen nacheinander, wischbare Karten, Abschnittsleiste,
// "Mehr lesen" und sanfter Lesefokus. Ohne JS oder bei "reduzierter Bewegung" bleibt alles sichtbar.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = matchMedia('(max-width: 759px)');
  const hasIO = 'IntersectionObserver' in window;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---------- Hero-Überschrift ----------
  const lines = $$('.lines');
  if (reduce || !hasIO) lines.forEach((el) => el.classList.add('in'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.2 });
    lines.forEach((el) => io.observe(el));
  }

  // ---------- "Mehr lesen" (nur Handy) ----------
  $$('[data-collapse]').forEach((box, n) => {
    const keep = +box.dataset.collapse;
    const paras = [...box.children].filter((c) => c.tagName === 'P' && !c.classList.contains('small'));
    const rest = paras.slice(keep);
    if (!rest.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'more';
    wrap.id = 'more' + n;
    rest[0].before(wrap);
    rest.forEach((p) => wrap.appendChild(p));
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'readmore';
    btn.setAttribute('aria-controls', wrap.id); btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Mehr lesen';
    wrap.after(btn);
    const apply = () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      wrap.hidden = mobile.matches && !open;
      btn.hidden = !mobile.matches;
    };
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Weniger anzeigen' : 'Mehr lesen';
      wrap.hidden = !open;
    });
    mobile.addEventListener('change', apply);
    apply();
  });

  // ---------- Wischbare Karten (nur Handy, per CSS) ----------
  $$('.swipe').forEach((list) => {
    const cards = [...list.children];
    if (cards.length < 2) return;
    list.tabIndex = 0;
    const meta = document.createElement('div');
    meta.className = 'swipe-meta'; meta.setAttribute('aria-hidden', 'true');
    meta.innerHTML = '<span class="swipe-hint">Wischen</span><span class="swipe-dots">' + cards.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('') + '</span>';
    list.after(meta);
    const dots = [...meta.querySelectorAll('i')];
    let tick = false;
    list.addEventListener('scroll', () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => {
        tick = false;
        const step = cards[1].offsetLeft - cards[0].offsetLeft || 1;
        const i = Math.min(cards.length - 1, Math.max(0, Math.round(list.scrollLeft / step)));
        dots.forEach((d, k) => d.classList.toggle('on', k === i));
        meta.querySelector('.swipe-hint').textContent = i === cards.length - 1 ? 'Ende' : 'Wischen';
      });
    }, { passive: true });
  });

  // ---------- Textblöcke nacheinander einblenden ----------
  const items = [];
  if (!reduce && hasIO) {
    const sel = [
      '.hero .sub-l', '.hero .actions', '.hero .hero-note', '.hero dl.figs > div', '.hero .back-link', '.hero .note-box',
      '.head > *', '.prose > *', '.cmp .r', '.rows > li', 'ol.steps > li', '.list li',
      '.two-col > div > h3', 'details', '.form > *', '.calc .in', '.calc .res', '.endcta > .wrap > *',
      '.setter-link p'
    ].join(',');
    $$(sel).filter((el) => !el.closest('.menu') && !el.closest('footer')).forEach((el) => {
      const inSwipe = el.parentElement && el.parentElement.classList.contains('swipe');
      if (inSwipe && mobile.matches) return;             // Karten: nur die Karten-Reihe selbst einblenden
      items.push(el);
    });
    $$('.swipe').forEach((l) => { if (mobile.matches) items.push(l); });
    items.forEach((el) => el.classList.add('rv'));
    const io = new IntersectionObserver((es) => {
      es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top).forEach((e, i) => {
        e.target.style.setProperty('--d', Math.min(i, 5) * 0.09 + 's');
        e.target.classList.add('in');
        io.unobserve(e.target);
        setTimeout(() => e.target.style.setProperty('--d', '0s'), 1100);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((el) => io.observe(el));
    addEventListener('beforeprint', () => items.forEach((el) => el.classList.add('in')));
  }

  // ---------- Lesefokus (Handy): Block in der Bildschirmmitte voll, Rest leicht gedimmt ----------
  if (!reduce && hasIO && items.length) {
    document.documentElement.classList.add('fr');
    const fio = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('fc', e.isIntersecting)),
      { rootMargin: '-28% 0px -34% 0px', threshold: 0 });
    const NOFOCUS = '.form > *, .calc .in, .calc .res, .actions, .swipe, .hero dl.figs > div, details';
    items.forEach((el) => { if (el.matches(NOFOCUS)) el.classList.add('nf'); else fio.observe(el); });
  }

  // ---------- Abschnittsleiste (Handy) ----------
  const secs = $$('section[data-label]');
  const header = document.querySelector('header.site');
  if (hasIO && secs.length > 2 && header) {
    const bar = document.createElement('div');
    bar.className = 'sectionbar'; bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<span class="sb-label"></span><span class="sb-count"></span><i class="sb-line"><b></b></i>';
    header.after(bar);
    const label = bar.querySelector('.sb-label'), count = bar.querySelector('.sb-count'), fill = bar.querySelector('.sb-line b');
    const setHH = () => document.documentElement.style.setProperty('--hh', header.offsetHeight + 'px');
    setHH(); addEventListener('resize', setHH);
    const total = secs.length - 1;
    const sio = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = secs.indexOf(e.target);
      bar.classList.toggle('show', i > 0);
      if (i > 0) { label.textContent = e.target.dataset.label; count.textContent = i + ' / ' + total; fill.style.transform = `scaleX(${i / total})`; }
    }), { rootMargin: '-30% 0px -60% 0px' });
    secs.forEach((s) => sio.observe(s));
  }

  // ---------- Aktionsleiste (Daumenzone) ----------
  const sticky = document.getElementById('sticky');
  const formEl = document.getElementById('bewerbung') || document.getElementById('partner');
  let atForm = false, ticking = false;
  const update = () => { ticking = false; if (sticky) sticky.classList.toggle('show', scrollY > 260 && !atForm); };
  if (sticky) {
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    if (formEl && hasIO) new IntersectionObserver(([e]) => { atForm = e.isIntersecting; update(); }, { threshold: 0.1 }).observe(formEl);
    update();
  }

  // ---------- Vollbild-Menü ----------
  const btn = document.getElementById('menuBtn'), menu = document.getElementById('menu'), close = document.getElementById('menuClose');
  if (btn && menu) {
    const inert = [document.getElementById('main'), document.querySelector('footer.site'), sticky, document.querySelector('.sectionbar')].filter(Boolean);
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
