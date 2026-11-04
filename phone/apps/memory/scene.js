// 念念铃：水彩底图（白天 / 夜里跟着手机走）上，一根根细绳往下排，一只铃一件事，新的在上面。
// 一个月一根绳（事多就几根，一根挂 4 只），月份写在那个月第一根绳上；从左往右、从上往下是从新到旧。
// 铃按重要度分大小，样子和颜色按这件事定（同一件事每次都一样）；上下滑动时铃跟着晃，停下来慢慢静止，只算看得见的那几只。
// 花瓣、光斑在最上面一层不挡手的画布上飘；页面被盖住、离开就停（rain.js 一样的做法）。
import { h } from '../../core/util.js';

const BASE = 'assets/memory/';
const R = Math.random, TAU = Math.PI * 2, slow = matchMedia('(prefers-reduced-motion: reduce)').matches ? .3 : 1;
const IM = {};
const img = k => IM[k] || (IM[k] = Object.assign(new Image(), { src: BASE + k + '.webp' }));
const HORIZON = .79;   // 底图里水平线的位置：花瓣落到水上
// 每张图：宽高比、铃身从多高开始（图上面那截是自带的绳，太长的剪掉换成自己的）、身子多宽
const SHAPES = { 'bell-sakura': [536 / 228, .265, 1], 'bell-small': [430 / 179, .579, 1], 'bell-flower': [728 / 242, .261, 1], 'bell-big': [398 / 259, .407, 1],
  'bell-pink': [417 / 207, .441, 1], 'bell-dome': [495 / 163, .723, .9], knot: [790 / 254, .146, .9], 'chime-tube': [505 / 110, .24, .5] };
const KEYS = Object.keys(SHAPES);
const HUES = [0, 35, 80, 140, 190, 235, 290], KNOT = [0, 330, 290, 25];   // 同一张图转色相，换出各种颜色（中国结只在红、粉、紫里换，绿的不好看）
const WIDE = [0, 40, 48, 58, 70, 84];   // 重要度 1～5 → 铃多宽（px）
const PER = 4;
const hash = s => [...String(s)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;
const ym = at => at ? at.replace(/^(\d+)-0?(\d+).*$/, '$1年$2月') : '不知道哪天';

/** host：放场景的元素；onPick(事件)：点到了哪只铃（点空白处给 null） */
export function scene(host, onPick) {
  const day = h('img.as-mem-sky', { src: BASE + 'sky-day.webp', alt: '' }), night = h('img.as-mem-sky.is-night', { src: BASE + 'sky-night.webp', alt: '' });
  const list = h('div.as-mem-bells'), cv = h('canvas.as-mem-cv'), g = cv.getContext('2d');
  host.append(day, night, list, cv);
  const page = host.closest('.as-page');
  let W = 0, H = 0, D = 1, fall = [], motes = [], glints = [], raf = 0, last = 0, bells = new Map(), lastTop = 0, lastAt = 0;
  const seen = new IntersectionObserver(es => es.forEach(x => { const b = x.target._b; if (b) b.vis = x.isIntersecting; }), { root: list });

  function size() {
    const r = host.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    if (r.width === W && r.height === H && d === D) return;
    W = r.width; H = r.height; D = d; cv.width = W * D; cv.height = H * D;
    fall = Array.from({ length: 22 }, () => petal(false));
    motes = Array.from({ length: 18 }, () => ({ x: R() * W, y: R() * H * .85, r: 2 + R() * 6, v: 4 + R() * 10, ph: R() * TAU, f: .3 + R() * .8 }));
    glints = Array.from({ length: 80 }, () => ({ x: R(), y: HORIZON + .005 + Math.pow(R(), 1.6) * (1 - HORIZON), w: .4 + R(), f: 1.2 + R() * 2.5, p: R() * TAU }));
  }
  function petal(top) {
    const z = .5 + R() * .8;
    return { im: img('petal' + Math.floor(R() * 4)), x: R() * W * 1.2 - W * .1, y: top ? -30 - R() * H * .3 : R() * H * .8, size: 16 * z, vy: 34 * z, sw: 20 + R() * 30, ph: R() * TAU,
      rot: R() * TAU, spin: (R() - .5) * 2.4, flip: R() * TAU, fs: 1 + R() * 2, land: H * (HORIZON + .02 + R() * .18), float: 0 };
  }

  /** 换一批记忆：按月排成一根根绳。同一件事的铃留着（晃到一半的接着晃） */
  function set(evs) {
    const months = new Map(), old = bells;
    for (const e of [...evs].sort((a, b) => (b.at || '').localeCompare(a.at || ''))) { const k = ym(e.at); months.set(k, [...(months.get(k) || []), e]); }
    bells = new Map(); seen.disconnect();
    const rows = [];
    let i = 0;
    for (const [label, es] of months) for (let s = 0; s < es.length; s += PER) rows.push(rope(es.slice(s, s + PER), s ? '' : label, i++, old));
    list.replaceChildren(...rows);
  }
  // 一根绳：左高右低、右高左低轮着来，中间垂一点；铃挂在绳上等分的几个点
  function rope(es, label, i, old) {
    const [y0, y1] = i % 2 ? [40, 20] : [20, 40], cy = 46;
    const at = t => [(1 - t) * (1 - t) * -2 + 2 * (1 - t) * t * 50 + t * t * 102, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1];
    const look = es.map(e => {   // 每只铃的样子：图、宽、露出来多高（自己的绳 + 铃身）
      const k = hash(e.id), name = KEYS[k % KEYS.length], [r, top, f] = SHAPES[name], w = (WIDE[e.imp] || WIDE[2]) * f, hi = w * r, cord = 16 + (k >> 8) % 5 * 7;
      return { k, name, w, hi, show: hi * (1 - top) + cord, cap: e.imp >= 4 ? 30 : 0 };
    });
    const tall = Math.max(...look.map(l => l.show + l.cap)) + cy + 16;
    const row = h('div.as-mem-rope', { style: { height: tall + 'px' } },
      label ? h('span.as-mem-month', label) : null,
      h('div.as-mem-line', { html: `<svg viewBox="0 0 100 ${tall}" preserveAspectRatio="none"><path d="M-2 ${y0} Q50 ${cy} 102 ${y1}"/></svg>` }));
    es.forEach((e, j) => {
      const [x, y] = at((j + 1) / (es.length + 1)), { k, name, w, hi, show } = look[j], o = old.get(e.id);
      const im = h('img', { src: BASE + name + '.webp', alt: '', style: { width: w + 'px', height: hi + 'px', filter: `hue-rotate(${(name === 'knot' ? KNOT : HUES)[(k >> 4) % HUES.length % (name === 'knot' ? KNOT.length : HUES.length)]}deg) saturate(1.5)` } });
      const el = h('button.as-mem-bell', { style: { left: x + '%', top: y + 'px' }, 'aria-label': e.title }, h('span.as-mem-bell__pic', { style: { width: w + 'px', height: show + 'px' } }, im), e.imp >= 4 ? h('span.as-mem-bell__cap', e.title) : null);
      const b = { e, el, th: o ? o.th : 0, om: o ? o.om : 0, ph: (k % 100) / 16, f: .9 + (k % 7) / 10, vis: false };
      el._b = b; el.onclick = ev => { ev.stopPropagation(); ring(b); onPick(e); };
      bells.set(e.id, b); seen.observe(el); row.append(el);
    });
    return row;
  }
  const ring = (b, n = 1) => { b.om += (b.th > 0 ? -1 : 1) * 2.2 * n; resume(); };
  list.addEventListener('click', () => onPick(null));
  /** 滑到这件事的铃，让它响一下、亮一会儿 */
  function find(e) {
    const b = bells.get(e.id); if (!b) return;
    const row = b.el.parentNode;
    list.scrollTo({ top: row.offsetTop + b.el.offsetTop + b.el.offsetHeight / 2 - list.clientHeight / 2, behavior: 'smooth' });
    setTimeout(() => { ring(b, 1.3); b.el.classList.add('is-found'); setTimeout(() => b.el.classList.remove('is-found'), 2400); }, 450);
  }

  function frame(now) {
    if (page.classList.contains('is-behind') || !page.isConnected) { raf = 0; return; }
    const dt = Math.min(.05, (now - last) / 1000 || 0) * slow, t = now / 1000 * slow; last = now; size();
    const dark = (host.closest('.as-phone') || document.body).dataset.mode === 'night';
    host.classList.toggle('is-night', dark);
    // 滑动：滑得越快铃晃得越厉害（往下滑铃往上甩）
    const top = list.scrollTop, v = lastAt ? (top - lastTop) / Math.max(.008, (now - lastAt) / 1000) : 0; lastTop = top; lastAt = now;
    for (const b of bells.values()) {
      if (!b.vis) continue;
      if (Math.abs(v) > 30) b.om += Math.max(-1, Math.min(1, -v / 2600)) * (.6 + .4 * Math.sin(b.ph)) * dt * 18;
      const k = 26 / b.f, target = .025 * Math.sin(t * b.f * 1.3 + b.ph);
      for (let s = 0; s < 3; s++) { const hdt = dt / 3, acc = -k * (b.th - target) - 2 * .1 * Math.sqrt(k) * b.om; b.om += acc * hdt; b.th += b.om * hdt; }
      b.el.style.transform = `translateX(-50%) rotate(${b.th.toFixed(4)}rad)`;
    }
    g.setTransform(D, 0, 0, D, 0, 0); g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (const q of glints) {
      const a = Math.pow(.5 + .5 * Math.sin(t * q.f + q.p), 4) * (dark ? .55 : .7), y = q.y * H, half = (3 + (q.y - HORIZON) * 60) * q.w;
      if (a < .02) continue;
      g.globalAlpha = a; g.fillStyle = dark ? '#e8ecff' : '#fff'; g.fillRect(q.x * W - half, y, half * 2, 1 + (q.y - HORIZON) * 8);
    }
    for (const m of motes) {
      m.y -= m.v * dt * .3; m.x += Math.sin(t * m.f + m.ph) * .15; if (m.y < -10) { m.y = H * .85; m.x = R() * W; }
      const r = m.r * (dark ? 1.6 : 1.3), q = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, r), c = dark ? '255,236,190' : '255,255,255';
      q.addColorStop(0, `rgba(${c},${(.25 + .25 * Math.sin(t * m.f * 2 + m.ph)) * (dark ? 1 : .7)})`); q.addColorStop(1, `rgba(${c},0)`); g.fillStyle = q; g.globalAlpha = 1; g.fillRect(m.x - r, m.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
    // 花瓣：一边落一边飘、打转、翻面；落到水上漂一会儿淡掉
    for (let i = 0; i < fall.length; i++) {
      const f = fall[i];
      if (!f.float) {
        f.y += f.vy * dt; f.x += (Math.sin(t * .8 + f.ph) * f.sw - 10) * dt * .9;
        f.rot += f.spin * dt; f.flip += f.fs * dt;
        if (f.y >= f.land) { f.float = 1; f.y = f.land; }
      } else { f.float += dt; f.x += Math.sin(t * .6 + f.ph) * 4 * dt; if (f.float > 4) { fall[i] = petal(true); continue; } }
      if (!f.im.complete || !f.im.naturalWidth) continue;
      const a = f.float ? Math.max(0, 1 - (f.float - 1) / 3) * .8 : 1, sy = f.float ? .35 : Math.abs(Math.cos(f.flip)) * .8 + .2;
      g.save(); g.globalAlpha = a; g.translate(f.x, f.y); g.rotate(f.rot); g.scale(1, sy); g.drawImage(f.im, -f.size / 2, -f.size / 2, f.size, f.size * f.im.naturalHeight / f.im.naturalWidth); g.restore();
    }
    g.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  const resume = () => { if (!raf && page.isConnected) { last = 0; raf = requestAnimationFrame(frame); } };
  const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!page.classList.contains('is-behind')) resume(); };
  document.addEventListener('visibilitychange', vis);
  resume();
  return { set, find, resume, stop: () => { cancelAnimationFrame(raf); raf = 0; document.removeEventListener('visibilitychange', vis); } };
}
