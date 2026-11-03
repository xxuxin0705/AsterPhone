// 念念树的花枝：水彩底图（白天 / 夜里跟着手机走）上，主枝挂满风铃和纸签，一个挂件一段记忆，跟着阵风晃；
// 纸签上竖着写这件事的标题，玻璃隔一会儿闪一下；花瓣飘下来落到水上漂一会儿；水面碎光、空中光斑一闪一闪。
// 页面被盖住、离开就停（rain.js 一样的做法），回来 resume 接着动；换记忆只换挂件，底图不动（不闪）。
import { h } from '../../core/util.js';

const BASE = 'assets/memory/';
const R = Math.random, TAU = Math.PI * 2, slow = matchMedia('(prefers-reduced-motion: reduce)').matches ? .3 : 1;
// 图只加载一次，整个手机共用
const IM = {};
const img = k => IM[k] || (IM[k] = Object.assign(new Image(), { src: BASE + k + '.webp' }));
// 底图里那根主枝（从右上斜到左边）：x 0~1 → y 0~1；水平线在 79%
const BR = [[0, .305], [.1, .3], [.25, .29], [.45, .25], [.6, .21], [.75, .17], [1, .11]];
const branchY = x => { for (let i = 1; i < BR.length; i++) if (x <= BR[i][0]) { const [a, b] = [BR[i - 1], BR[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return BR[BR.length - 1][1]; };
const HORIZON = .79;
// 挂件：纸签（写字）给重要的，其余轮着挂风铃、中国结；身子多宽（占屏幕宽）
const TAGS = ['tag-pink', 'tag-blue', 'tag-purple', 'tag-cream'], BELLS = ['bell-sakura', 'knot', 'bell-small', 'bell-flower', 'bell-big', 'bell-pink', 'chime-tube', 'bell-dome'];
const WIDE = { tag: .078, bell: .12, knot: .12, chime: .05 };
const FONT = '"Noto Serif SC", "Songti SC", "STSong", serif';

/** host：放场景的元素；onPick(事件)：点到了哪个挂件（点空白处给 null） */
export function scene(host, onPick) {
  const day = h('img.as-mem-sky', { src: BASE + 'sky-day.webp', alt: '' }), night = h('img.as-mem-sky.is-night', { src: BASE + 'sky-night.webp', alt: '' });
  const cv = h('canvas.as-mem-cv'), g = cv.getContext('2d');
  host.append(day, night, cv);
  const page = host.closest('.as-page');
  let W = 0, H = 0, D = 1, charms = [], fall = [], motes = [], glints = [], raf = 0, last = 0;

  function size() {
    const r = host.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    if (r.width === W && r.height === H && d === D) return;
    W = r.width; H = r.height; D = d; cv.width = W * D; cv.height = H * D;
    fall = Array.from({ length: 26 }, () => petal(false));
    motes = Array.from({ length: 20 }, () => ({ x: R() * W, y: R() * H * .85, r: 2 + R() * 6, v: 4 + R() * 10, ph: R() * TAU, f: .3 + R() * .8 }));
    glints = Array.from({ length: 80 }, () => ({ x: R(), y: HORIZON + .005 + Math.pow(R(), 1.6) * (1 - HORIZON), w: .4 + R(), f: 1.2 + R() * 2.5, p: R() * TAU }));
  }
  function petal(top) {
    const z = .5 + R() * .8;
    return { im: img('petal' + Math.floor(R() * 4)), x: R() * W * 1.2 - W * .1, y: top ? -30 - R() * H * .3 : R() * H * .8, size: 16 * z, vy: 34 * z, sw: 20 + R() * 30, ph: R() * TAU,
      rot: R() * TAU, spin: (R() - .5) * 2.4, flip: R() * TAU, fs: 1 + R() * 2, land: H * (HORIZON + .02 + R() * .18), float: 0 };
  }
  /** 换一批要挂的记忆（最多 11 件）：在主枝上均匀排开 */
  function set(list) {
    const n = list.length, old = new Map(charms.map(c => [c.e.id, c]));
    let ti = 0, bi = 0;
    charms = list.map((e, i) => {
      const o = old.get(e.id), paper = e.pin || e.imp >= 4 || bi >= BELLS.length;
      const k = o && o.paper === paper ? o.k : paper ? TAGS[ti++ % TAGS.length] : BELLS[bi++];
      const x = n === 1 ? .5 : .07 + .86 * i / (n - 1);
      return { e, k, x, paper, z: .82 + ((i * 37) % 23) / 100, cord: .02 + ((i * 53) % 17) / 100, th: o ? o.th : 0, om: o ? o.om : 0, ph: i * 2.1, glass: /bell|chime/.test(k), glint: 3 + R() * 6 };
    });
  }

  const star = (x, y, r, a) => {
    g.globalAlpha = a; g.fillStyle = '#fff'; g.beginPath();
    g.moveTo(x, y - r * 2.4); g.quadraticCurveTo(x, y, x + r * 2.4, y); g.quadraticCurveTo(x, y, x, y + r * 2.4); g.quadraticCurveTo(x, y, x - r * 2.4, y); g.quadraticCurveTo(x, y, x, y - r * 2.4); g.fill();
    g.globalAlpha = a * .35; g.beginPath(); g.arc(x, y, r * 1.6, 0, TAU); g.fill();
  };
  const blob = (x, y, r, a, c) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(${c},${a})`); q.addColorStop(1, `rgba(${c},0)`); g.fillStyle = q; g.globalAlpha = 1; g.fillRect(x - r, y - r, r * 2, r * 2); };

  function frame(now) {
    if (page.classList.contains('is-behind') || !page.isConnected) { raf = 0; return; }
    const dt = Math.min(.05, (now - last) / 1000 || 0) * slow, t = now / 1000 * slow; last = now; size();
    const dark = (host.closest('.as-phone') || document.body).dataset.mode === 'night';
    host.classList.toggle('is-night', dark);
    g.setTransform(D, 0, 0, D, 0, 0); g.clearRect(0, 0, W, H);
    // 阵风：大部分时间轻轻吹，隔一会儿来一阵大的，从右往左扫过去
    const gust = x => { const s = t - (1 - x) * 1.2; return Math.pow(.5 + .5 * Math.sin(s * .45) * Math.sin(s * .71 + 1), 2); };
    g.globalCompositeOperation = 'lighter';
    for (const q of glints) {
      const a = Math.pow(.5 + .5 * Math.sin(t * q.f + q.p), 4) * (dark ? .55 : .7), y = q.y * H, half = (3 + (q.y - HORIZON) * 60) * q.w;
      if (a < .02) continue;
      g.globalAlpha = a; g.fillStyle = dark ? '#e8ecff' : '#fff'; g.fillRect(q.x * W - half, y, half * 2, 1 + (q.y - HORIZON) * 8);
    }
    for (const m of motes) {
      m.y -= m.v * dt * .3; m.x += Math.sin(t * m.f + m.ph) * .15; if (m.y < -10) { m.y = H * .85; m.x = R() * W; }
      blob(m.x, m.y, m.r * (dark ? 1.6 : 1.3), (.25 + .25 * Math.sin(t * m.f * 2 + m.ph)) * (dark ? 1 : .7), dark ? '255,236,190' : '255,255,255');
    }
    g.globalCompositeOperation = 'source-over';
    // 挂件：带阻尼的摆，绳长的晃得慢
    for (const c of charms) {
      const im = img(c.k); if (!im.complete || !im.naturalWidth) continue;
      const ax = c.x * W, ay = branchY(c.x) * H, w = WIDE[c.k.split('-')[0]] * W * c.z, h0 = w * im.naturalHeight / im.naturalWidth, cord = c.cord * H, L = cord + h0;
      const k = 9.8 / (L / H * 5), wind = gust(c.x);
      const target = -.03 * wind * (c.paper ? 1.4 : 1) + (.035 + .06 * wind) * Math.sin(t * (1.1 + c.z * .4) + c.ph) * (c.paper ? 1.3 : 1);
      for (let s = 0; s < 3; s++) { const hdt = dt / 3, acc = -k * (c.th - target) - 2 * .12 * Math.sqrt(k) * c.om; c.om += acc * hdt; c.th += c.om * hdt; }
      const twist = c.paper ? Math.cos(.55 * Math.sin(t * .9 + c.ph) * (.3 + wind)) : 1;
      c.box = { ax, ay, w, h: L, th: c.th };
      g.save(); g.translate(ax, ay); g.rotate(c.th); g.globalAlpha = .75 + .25 * c.z;
      if (dark) g.filter = 'brightness(.86) saturate(1.05)';
      if (cord > 0) { g.strokeStyle = c.paper || c.k === 'knot' ? 'rgba(214,60,70,.9)' : 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, cord + 2); g.stroke(); }
      g.translate(0, cord); g.scale(twist, 1); g.drawImage(im, -w / 2, 0, w, h0);
      // 纸签上竖着写标题（纸翻过去时字也跟着窄）
      if (c.paper) {
        const all = [...c.e.title], fs = Math.max(w * .3, Math.min(w * .42, h0 * .5 / (all.length * 1.08))), chars = all.slice(0, Math.floor(h0 * .5 / (fs * 1.08)));   // 字多就写小一点
        g.filter = 'none'; g.fillStyle = 'rgba(92,52,70,.85)'; g.font = `500 ${fs}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
        chars.forEach((ch, i) => g.fillText(ch, 0, h0 * .45 + i * fs * 1.08));
      }
      if (c.e.pin) { g.filter = 'none'; star(w * .32, h0 * .42, 1.8, .9); }
      g.restore();
      if (c.glass) {   // 玻璃上隔几秒闪一下
        c.glint -= dt; if (c.glint < -.6) c.glint = 3 + R() * 6;
        if (c.glint < 0) { const d = cord + h0 * .55; star(ax - Math.sin(c.th) * d - Math.cos(c.th) * w * .2, ay + Math.cos(c.th) * d, 2.4, Math.sin(-c.glint / .6 * Math.PI) * .95); }
      }
    }
    g.filter = 'none'; g.globalAlpha = 1;
    // 花瓣：一边落一边飘、打转、翻面；落到水上漂一会儿淡掉
    for (let i = 0; i < fall.length; i++) {
      const f = fall[i];
      if (!f.float) {
        f.y += f.vy * dt; f.x += (Math.sin(t * .8 + f.ph) * f.sw - 18 * gust(Math.max(0, Math.min(1, f.x / W)))) * dt * .9;
        f.rot += f.spin * dt; f.flip += f.fs * dt;
        if (f.y >= f.land) { f.float = 1; f.y = f.land; }
      } else { f.float += dt; f.x += Math.sin(t * .6 + f.ph) * 4 * dt; if (f.float > 4) { fall[i] = petal(true); continue; } }
      if (!f.im.complete || !f.im.naturalWidth) continue;
      const a = f.float ? Math.max(0, 1 - (f.float - 1) / 3) * .8 : 1, sy = f.float ? .35 : Math.abs(Math.cos(f.flip)) * .8 + .2;
      g.save(); g.globalAlpha = a; g.translate(f.x, f.y); g.rotate(f.rot); g.scale(1, sy); g.drawImage(f.im, -f.size / 2, -f.size / 2, f.size, f.size * f.im.naturalHeight / f.im.naturalWidth); g.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  // 点到挂件：它晃一下，交给 onPick；点空白处起一阵小风
  cv.addEventListener('click', ev => {
    const r = host.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    for (const c of [...charms].reverse()) {
      const b = c.box; if (!b) continue;
      const dx = px - b.ax, dy = py - b.ay, lx = dx * Math.cos(-b.th) - dy * Math.sin(-b.th), ly = dx * Math.sin(-b.th) + dy * Math.cos(-b.th);
      if (Math.abs(lx) < b.w / 2 + 8 && ly > b.h * .45 && ly < b.h + 8) { c.om += (lx < 0 ? -1 : 1) * 1.8; onPick(c.e); return; }
    }
    for (const c of charms) c.om += (R() - .5) * .5;
    onPick(null);
  });
  const resume = () => { if (!raf && page.isConnected) { last = 0; raf = requestAnimationFrame(frame); } };
  const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!page.classList.contains('is-behind')) resume(); };
  document.addEventListener('visibilitychange', vis);
  resume();
  return { set, resume, stop: () => { cancelAnimationFrame(raf); raf = 0; document.removeEventListener('visibilitychange', vis); } };
}
