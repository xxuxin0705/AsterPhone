// 时计：玻璃表盘染成歌词颜色，指针走真实时间；这一句歌词沿表圈上半圈排（唱到哪个字亮哪个字），下一句在下半圈，翻译在表下面。
// 表盘里的小东西跟着颜色换：蓝 / 黑是起伏的水和小鱼，红是红色小鱼，黄是枫叶，白是雪，粉 / 紫是樱花，绿是萤火虫。
import { h } from '../../core/util.js';

const img = n => Object.assign(new Image(), { src: `assets/music/clock-${n}.webp` });
const SPR = { fish: img('fish'), maple: img('maple'), snow: img('snow'), sakura: img('sakura') };
function theme(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (s < .2) return l > .5 ? 'snow' : 'water';
  const hue = 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return hue < 20 || hue >= 345 ? (l > .7 ? 'sakura' : 'koi') : hue < 70 ? 'maple' : hue < 170 ? 'fire' : hue < 260 ? 'water' : 'sakura';
}

export function clock(el, page, color) {
  const cv = h('canvas.as-ck__cv'), face = h('div.as-ck__face'), hand = ['h', 'm', 's'].map(k => h('i.as-ck__' + k)), ring = h('div.as-ck__ring'), tr = h('div.as-fx__tr');
  ring.innerHTML = '<svg viewBox="0 0 100 100"><path id="as-ck-t" d="M8.5 50a41.5 41.5 0 0 1 83 0" fill="none"/><path id="as-ck-b" d="M3 50a47 47 0 0 0 94 0" fill="none"/>'
    + '<text class="is-cur"><textPath href="#as-ck-t" startOffset="50%" text-anchor="middle"></textPath></text><text class="is-next"><textPath href="#as-ck-b" startOffset="50%" text-anchor="middle"></textPath></text></svg>';
  const [curT, nextT] = ring.querySelectorAll('textPath');
  face.style.webkitMaskImage = face.style.maskImage = 'url(assets/music/clock-face.webp)';
  el.className = 'as-mp__fx is-clock';
  el.replaceChildren(h('div.as-ck', cv, face, ...hand, h('b.as-ck__pin'), ring), tr);
  const ctx = cv.getContext('2d');
  let D = 0, raf = 0, last = 0, kind = '', col = '', tint = null, bits = [], chars = [], lit = -1;
  // 字多了就缩小，排得下半圈
  const fit = (t, len) => { const w = [...t].reduce((n, ch) => n + (/[\u0000-ɏ]/.test(ch) ? .56 : 1), 0); return Math.min(5, len / Math.max(w, 1)); };

  function setColor(c) {
    kind = theme(c); col = c;
    const fish = kind === 'water' || kind === 'koi', s = SPR[fish ? 'fish' : kind];
    // 小鱼是白的，染一层颜色（红色小鱼染得重一点）
    tint = null;
    if (s && fish) {
      const paint = () => { const o = h('canvas', { width: s.width, height: s.height }), x = o.getContext('2d'); x.drawImage(s, 0, 0); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = kind === 'koi' ? .6 : .25; x.fillStyle = c; x.fillRect(0, 0, o.width, o.height); tint = o; };
      s.complete ? paint() : s.addEventListener('load', paint, { once: true });
    }
    bits = Array.from({ length: fish ? 3 : kind === 'fire' ? 14 : 7 }, (_, i) => spawn(i, true));
  }
  const R = Math.random;
  function spawn(i, first) {
    if (kind === 'water' || kind === 'koi') return { x: .2 + R() * .6, y: .64 + i * .1, v: (R() < .5 ? -1 : 1) * (.03 + R() * .03), f: R() * 4, sz: .2 + R() * .07, ph: R() * 6 };
    if (kind === 'fire') return { x: .15 + R() * .7, y: .15 + R() * .7, vx: (R() - .5) * .02, vy: (R() - .5) * .02, ph: R() * 6, sz: .012 + R() * .012 };
    return { x: .1 + R() * .8, y: first ? R() : -.1, v: .05 + R() * .05, f: Math.floor(R() * 4), r: R() * 6, vr: (R() - .5) * 1.4, ph: R() * 6, sz: (kind === 'maple' ? .13 : .1) + R() * .05 };
  }
  function frame(now) {
    if (page.classList.contains('is-behind') || !page.isConnected) { raf = 0; return; }
    const dt = Math.min(.05, (now - last) / 1000), t = now / 1000; last = now;
    const d = new Date(), sec = d.getSeconds() + d.getMilliseconds() / 1000, min = d.getMinutes() + sec / 60;
    hand[0].style.transform = `rotate(${(d.getHours() % 12 + min / 60) * 30}deg)`; hand[1].style.transform = `rotate(${min * 6}deg)`; hand[2].style.transform = `rotate(${sec * 6}deg)`;
    if (!D) { const b = cv.getBoundingClientRect(), k = devicePixelRatio || 1; D = b.width * k; cv.width = cv.height = D; }
    ctx.clearRect(0, 0, D, D);
    if (kind === 'water' || kind === 'koi') {
      // 两层水波
      [[.22, 0, 1.1], [.34, 1.7, .8]].forEach(([a, p, sp]) => {
        ctx.beginPath(); ctx.moveTo(0, D);
        for (let x = 0; x <= D; x += D / 40) ctx.lineTo(x, D * (.56 + .025 * Math.sin(x / D * 6.3 + t * sp + p) + .012 * Math.sin(x / D * 13 - t * 1.7)));
        ctx.lineTo(D, D); ctx.closePath(); ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fill();
      });
      ctx.globalAlpha = .9;
      if (tint) bits.forEach(b => {
        b.x += b.v * dt; if (b.x < .18 || b.x > .82) b.v = -b.v;
        b.f = (b.f + dt * 6) % 4;
        const w = D * b.sz, y = D * (b.y + .015 * Math.sin(t * 1.3 + b.ph));
        ctx.save(); ctx.translate(D * b.x, y); if (b.v < 0) ctx.scale(-1, 1);
        ctx.drawImage(tint, Math.floor(b.f) * 200, 0, 200, 200, -w / 2, -w / 2, w, w); ctx.restore();
      });
    } else if (kind === 'fire') {
      bits.forEach(b => {
        b.x += b.vx * dt + Math.sin(t + b.ph) * .0006; b.y += b.vy * dt + Math.cos(t * .8 + b.ph) * .0006;
        if (b.x < .12 || b.x > .88) b.vx = -b.vx; if (b.y < .12 || b.y > .88) b.vy = -b.vy;
        const r = D * b.sz * 3, g = ctx.createRadialGradient(D * b.x, D * b.y, 0, D * b.x, D * b.y, r);
        g.addColorStop(0, 'rgba(235,255,190,.95)'); g.addColorStop(.3, 'rgba(160,240,140,.5)'); g.addColorStop(1, 'rgba(120,220,120,0)');
        ctx.globalAlpha = .45 + .55 * Math.abs(Math.sin(t * 1.4 + b.ph)); ctx.fillStyle = g; ctx.fillRect(D * b.x - r, D * b.y - r, r * 2, r * 2);
      });
    } else {
      const s = SPR[kind], cw = s.height;
      ctx.globalAlpha = .92;
      if (s.complete) bits.forEach((b, i) => {
        b.y += b.v * dt; b.r += b.vr * dt; if (b.y > 1.1) bits[i] = spawn(i);
        const w = D * b.sz;
        ctx.save(); ctx.translate(D * (b.x + .04 * Math.sin(t * .9 + b.ph)), D * b.y); ctx.rotate(b.r);
        ctx.drawImage(s, b.f * cw, 0, cw, cw, -w / 2, -w / 2, w, w); ctx.restore();
      });
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  setColor(color);
  return {
    kind: 'clock',
    color: setColor,
    start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    line(L, i) {
      const x = L[i] || {}, n = (L[i + 1] || {}).text || '';
      curT.parentNode.style.fontSize = fit(x.text || '', 108) + 'px'; nextT.parentNode.style.fontSize = Math.min(4, fit(n, 120)) + 'px';
      chars = [...(x.text || '')].map(ch => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'tspan'); s.textContent = ch; return s; });
      curT.replaceChildren(...chars); nextT.textContent = n; tr.textContent = x.tr || ''; lit = -1;
    },
    prog(p) {
      const n = Math.round(p * chars.length);
      if (n !== lit) { chars.forEach((c, k) => c.classList.toggle('is-lit', k < n)); lit = n; }
    },
  };
}
