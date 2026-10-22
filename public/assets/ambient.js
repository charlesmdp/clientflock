(() => {
  'use strict';
  const canvas = document.querySelector('.signal-canvas');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 900px)');
  const palette = [
    [69, 88, 111], [69, 88, 111], [69, 88, 111], [69, 88, 111],
    [77, 133, 169], [128, 112, 160], [139, 153, 111], [183, 138, 84]
  ];
  const labels = ['Alex · Founder', 'studio.example', 'A new hotel', 'Maya · Owner',
    'Design studio', 'hello@team.example', 'Local bakery', 'A growing team'];
  let width = 0, height = 0, top = 0, bottom = 0, centerY = 0;
  let items = [], textAreas = [], visible = true, frameId = 0;
  let lastTime = 0, elapsed = 0, resizeFrame = 0;
  const pointer = { x: -1000, y: -1000, on: false };
  const parallax = { x: 0, y: 0 };
  const random = seed => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const smooth = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };

  // Small line icons are painted directly, so the field stays crisp and lightweight.
  const paths = [
    'M3 5H21V19H3ZM3 6L12 13L21 6',
    'M16 7A4 4 0 1 1 8 7A4 4 0 1 1 16 7M4 22V20C4 10 20 10 20 20V22',
    'M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12M2 12H22M12 2C19 7 19 17 12 22C5 17 5 7 12 2',
    'M2 7H22V21H2ZM8 7V3H16V7M2 12C7 15 17 15 22 12M10 14V17H14V14',
    'M4 15C4 6 20 6 20 15M3 13H6V17H3ZM18 13H21V17H18Z',
    'M9 15L15 9M10 7L12 5C18 -1 25 6 19 12L17 14M14 17L12 19C6 25 -1 18 5 12L7 10',
    'M17 10A7 7 0 1 1 3 10A7 7 0 1 1 17 10M15 15L22 22',
    'M3 9V15M7 4V20M12 1V23M17 6V18M22 9V15'
  ].map(path => new Path2D(path));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    top = Math.max(0, heroRect.top - rect.top + 3);
    bottom = Math.min(height, heroRect.bottom - rect.top);
    const preview = hero.querySelector('.product-scene');
    // Let the field flow into the preview's upper edge, not beneath the whole page.
    if (preview && !document.body.classList.contains('layout-split')) bottom = Math.min(bottom, preview.getBoundingClientRect().top - rect.top + 180);
    centerY = top + (bottom - top) * .52;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.round(Math.max(82, Math.min(120, width / 11.8)));
    items = Array.from({ length: count }, (_, i) => ({
      x: random(i + 1) * (width + 90) - 45,
      lane: random(i + 71) * 2 - 1,
      size: 18 + random(i + 141) * 8,
      speed: 26 + random(i + 211) * 24,
      phase: random(i + 281) * Math.PI * 2,
      opacity: .19 + random(i + 351) * .105,
      type: i % paths.length,
      color: palette[i % palette.length],
      label: labels[i % labels.length],
      labelAlpha: 0
    }));
    textAreas = [...hero.querySelectorAll('h1,.hero-copy,.intro-tag,.reassurance,.form-wrap')].map(el => {
      const box = el.getBoundingClientRect();
      return { x: box.left - rect.left - 12, y: box.top - rect.top - 9,
        width: box.width + 24, height: box.height + 18 };
    });
    updatePlayback();
  }

  function insideText(x, y, padding = 0) {
    return textAreas.some(area => x > area.x - padding && x < area.x + area.width + padding &&
      y > area.y - padding && y < area.y + area.height + padding);
  }

  function draw(time) {
    frameId = 0;
    if (!active()) return;
    if (time - lastTime < 32) {
      frameId = requestAnimationFrame(draw);
      return;
    }
    const dt = Math.min((time - lastTime) / 1000, .08);
    lastTime = time;
    elapsed += dt;
    ctx.clearRect(0, 0, width, height);
    const span = Math.max(1, bottom - top);
    const targetX = pointer.on ? (pointer.x / width - .5) * 10 : 0;
    const targetY = pointer.on ? (pointer.y / height - .5) * 7 : 0;
    parallax.x += (targetX - parallax.x) * Math.min(1, dt * 3);
    parallax.y += (targetY - parallax.y) * Math.min(1, dt * 3);

    if (pointer.on && !insideText(pointer.x, pointer.y, 20)) {
      const glow = ctx.createRadialGradient(pointer.x, pointer.y, 10, pointer.x, pointer.y, 175);
      glow.addColorStop(0, 'rgba(112,177,211,.075)');
      glow.addColorStop(.6, 'rgba(137,185,211,.025)');
      glow.addColorStop(1, 'rgba(137,185,211,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(pointer.x - 175, pointer.y - 175, 350, 350);
    }

    const occupiedLabels = [];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const item of items) {
      const progress = Math.max(0, Math.min(1, item.x / width));
      // Broad at the left, gathering gently into a horizontal band at the right.
      const spread = span * (.47 - .20 * smooth(progress));
      const y = centerY + item.lane * spread + Math.sin(elapsed * .66 + item.phase) * 9 + parallax.y;
      const x = item.x + parallax.x;
      const distance = pointer.on ? Math.hypot(pointer.x - x, pointer.y - y) : 1000;
      const influence = Math.max(0, 1 - distance / 175);
      item.x += item.speed * dt * (1 - influence * .68);
      if (item.x > width + 45) item.x = -45;
      const verticalFade = Math.min(smooth((y - top) / 45), smooth((bottom - y) / 65));
      const horizontalFade = Math.min(smooth((x + 25) / 55), smooth((width + 25 - x) / 55));
      const central = 1 - smooth((Math.abs(x - width / 2) - width * .19) / (width * .22));
      const protectedText = insideText(x, y, 8);
      const ceiling = protectedText ? .13 : .32 - central * .18;
      const opacity = Math.min(ceiling, item.opacity + influence * .12) * verticalFade * horizontalFade;
      if (opacity <= .008) continue;
      const size = item.size * (1 + influence * .3);
      ctx.save();
      ctx.translate(x - size / 2, y - size / 2);
      ctx.scale(size / 24, size / 24);
      ctx.strokeStyle = `rgba(${item.color.join(',')},${opacity})`;
      ctx.lineWidth = 2.05;
      ctx.stroke(paths[item.type]);
      ctx.restore();

      const showLabel = influence > .35 && !protectedText && !insideText(x + 60, y, 20) &&
        occupiedLabels.length < 5 && !occupiedLabels.some(labelY => Math.abs(labelY - y) < 24);
      const labelTarget = showLabel ? (influence - .35) / .65 : 0;
      item.labelAlpha += (labelTarget - item.labelAlpha) * Math.min(1, dt * 7);
      if (item.labelAlpha > .025) {
        const labelX = x + size / 2 + 7;
        ctx.font = '11px Inter, Arial, sans-serif';
        const labelWidth = ctx.measureText(item.label).width;
        if (labelX + labelWidth < width - 12) {
          ctx.fillStyle = `rgba(250,250,249,${item.labelAlpha * .92})`;
          ctx.fillRect(labelX - 3, y - 9, labelWidth + 6, 18);
          ctx.fillStyle = `rgba(57,78,103,${item.labelAlpha * .7})`;
          ctx.fillText(item.label, labelX, y + 4);
          occupiedLabels.push(y);
        }
      }
    }
    frameId = requestAnimationFrame(draw);
  }

  function active() {
    return desktop.matches && !reduced.matches && visible && !document.hidden && bottom > top;
  }
  function updatePlayback() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    if (active()) {
      lastTime = performance.now();
      frameId = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }
  function queueResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resize);
  }
  function clearPointer() { pointer.on = false; }
  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.on = pointer.x >= 0 && pointer.x <= width && pointer.y >= top && pointer.y <= bottom;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);
  document.addEventListener('visibilitychange', updatePlayback);
  reduced.addEventListener('change', updatePlayback);
  desktop.addEventListener('change', queueResize);
  window.addEventListener('resize', queueResize, { passive: true });
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    updatePlayback();
  }, { threshold: .01 }).observe(canvas);
  const resizeObserver = new ResizeObserver(queueResize);
  resizeObserver.observe(hero);
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
  resize();
})();
