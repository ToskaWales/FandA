(() => {
  const bar = document.getElementById('bar');
  const menu = document.getElementById('menu');
  const menuButton = document.getElementById('menuBtn');
  const closeButton = document.getElementById('menuClose');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const updateBar = () => bar?.classList.toggle('is-solid', scrollY > 20);
  updateBar();
  addEventListener('scroll', updateBar, { passive: true });

  if (menu && menuButton && closeButton) {
    const background = [
      document.getElementById('main'),
      document.getElementById('foot'),
    ].filter(Boolean);

    const setMenuOpen = (open) => {
      if (open) menu.hidden = false;
      if (!open) menu.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      background.forEach((element) => {
        if (open) element.setAttribute('inert', '');
        else element.removeAttribute('inert');
      });

      if (open) {
        requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
        menu.querySelector('.menu__links a')?.focus({ preventScroll: true });
      } else {
        if (!reducedMotion) {
          setTimeout(() => { menu.hidden = true; }, 240);
        } else {
          menu.hidden = true;
        }
        menuButton.focus();
      }
    };

    menuButton.addEventListener('click', () => setMenuOpen(true));
    closeButton.addEventListener('click', () => setMenuOpen(false));
    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMenuOpen(false));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) setMenuOpen(false);
    });
    matchMedia('(min-width: 760px)').addEventListener('change', (event) => {
      if (event.matches && !menu.hidden) setMenuOpen(false);
    });
  }

  const word = document.getElementById('footWord');
  if (word) {
    const fitWord = () => {
      word.style.fontSize = '100px';
      const style = getComputedStyle(word.parentElement);
      const width = word.parentElement.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight);
      word.style.fontSize = `${100 * width / word.scrollWidth * 0.995}px`;
    };

    addEventListener('resize', fitWord);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(fitWord);
    fitWord();
  }
})();
