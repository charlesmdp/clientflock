(() => {
  'use strict';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const flights = new Map();
  let timer = 0, enabled = true, previousSurface = null, lastFlight = 0;
  const between = (min, max) => min + Math.random() * (max - min);
  // Extended neck, swept tail, and two independently moving wings.
  const swan = '<svg viewBox="0 0 106 64" aria-hidden="true"><path class="cf-swan-far-wing" d="M42 34C38 22 27 5 8 3c8 9 13 20 24 33Z"/><path class="cf-swan-body" d="M7 37l24-7c10-4 18-1 26 0 11 1 17-5 24-8 7-3 15-3 18 1l6 3-7 1c-5-3-10-2-14 0-8 5-13 12-25 14-9 3-19 2-27-1L7 42l10-4Z"/><path class="cf-swan-near-wing" d="M39 36C39 23 52 6 77 2 65 12 65 19 60 24l-4 1c1 4-1 8-5 11l-6 3Z"/></svg>';

  function surface() {
    if (!enabled || motion.matches || document.hidden) return null;
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    if (dialogs.some(dialog => !dialog.classList.contains('research-room'))) return null;
    const research = dialogs.find(dialog => dialog.classList.contains('research-room'));
    if (research) return research;
    const hero = document.querySelector('.hero');
    const rect = hero?.getBoundingClientRect();
    return rect && rect.bottom > 0 && rect.top < innerHeight ? document.body : null;
  }

  function clear(container) {
    for (const [layer, flight] of flights) {
      if (container && flight.container !== container) continue;
      clearTimeout(flight.timer);
      layer.remove();
      flights.delete(layer);
    }
  }

  function fly(container = surface()) {
    if (!container || container !== surface() || !container.isConnected || Date.now() - lastFlight < 4500) return null;
    if ([...flights.values()].some(flight => flight.container === container)) return null;
    lastFlight = Date.now();
    const layer = document.createElement('div');
    layer.className = 'cf-bird-sky';
    layer.setAttribute('aria-hidden', 'true');
    const reverse = Math.random() > .66;
    layer.dataset.direction = reverse ? 'left' : 'right';
    const smallScreen = innerWidth < 600;
    const count = smallScreen ? 4 : Math.round(between(5, 8));
    const duration = between(6.5, 8.5);
    const altitude = between(15, 65);
    const rise = between(-14, -4);
    const birds = [];
    for (let i = 0; i < count; i++) {
      const distance = i % 3 === 0 ? .65 : i % 3 === 1 ? .82 : 1;
      const side = i % 2 ? 1 : -1;
      const rank = Math.ceil(i / 2);
      const bird = document.createElement('span');
      bird.className = 'cf-swan-flight';
      bird.style.cssText = '--swan-y:' + (altitude + side * rank * 3.2).toFixed(1) + 'vh;' +
        '--swan-rise:' + rise.toFixed(1) + 'vh;--swan-arc:' + between(-9, -4).toFixed(1) + 'vh;' +
        '--swan-size:' + ((smallScreen ? 39 : 52) * distance).toFixed(0) + 'px;' +
        '--swan-duration:' + (duration + between(-.2, .2)).toFixed(2) + 's;' +
        '--swan-delay:' + (rank * .19 + between(0, .1)).toFixed(2) + 's;' +
        '--swan-opacity:' + (.11 + distance * .23).toFixed(2) + ';' +
        '--swan-flap:' + between(.8, 1.15).toFixed(2) + 's;' +
        '--swan-phase:-' + between(0, 1).toFixed(2) + 's;' +
        '--swan-roll:' + between(-5, 2).toFixed(1) + 'deg;';
      bird.innerHTML = '<span class="cf-swan-glide">' + swan + '</span>';
      birds.push(bird);
    }
    layer.append(...birds);
    container.append(layer);
    const cleanupTimer = setTimeout(() => { layer.remove(); flights.delete(layer); }, (duration + count * .2 + 1) * 1000);
    flights.set(layer, { container, timer: cleanupTimer });
    return layer;
  }

  function schedule(delay = between(9000, 14000)) {
    clearTimeout(timer);
    timer = 0;
    const next = surface();
    if (!next) return;
    timer = setTimeout(() => {
      timer = 0;
      const current = surface();
      if (current) fly(current);
      schedule();
    }, delay);
  }

  function sync() {
    const next = surface();
    if (next === previousSurface) return;
    clear();
    previousSurface = next;
    schedule(next?.classList.contains('research-room') ? 900 : 2400);
  }

  window.ClientFlockBirds = Object.freeze({
    fly, clear,
    stop() { enabled = false; clearTimeout(timer); timer = 0; clear(); previousSurface = null; },
    start() { enabled = true; sync(); }
  });
  // A research render replaces its children, so disconnected flight references
  // are released as well as responding to opening or closing nested dialogs.
  new MutationObserver(() => {
    for (const [layer, flight] of flights) {
      if (!layer.isConnected) { clearTimeout(flight.timer); flights.delete(layer); }
    }
    sync();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  window.addEventListener('pagehide', () => { clearTimeout(timer); timer = 0; clear(); previousSurface = null; });
  window.addEventListener('pageshow', sync);
  if ('IntersectionObserver' in window) {
    const hero = document.querySelector('.hero');
    if (hero) new IntersectionObserver(sync, { threshold: 0 }).observe(hero);
  }
  sync();
})();
