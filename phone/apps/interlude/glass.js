// 书桌那扇窗：点一下，裂纹从点的地方炸开、一些碎片往下掉；再点一下，碎片飞回去、裂纹收回去
const NS = 'http://www.w3.org/2000/svg';
const S = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const rnd = (a, b) => a + Math.random() * (b - a);

/** w×h 是窗户在书桌图上的大小；clip 是玻璃的形状（被窗帘挡住的角不算） */
export function windowGlass(w, h, clip) {
  const svg = S('svg', { class: 'as-int-glass', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  svg.append(S('clipPath', { id }), S('g', { 'clip-path': `url(#${id})` }));
  svg.firstChild.append(S('polygon', { points: clip }));
  const box = svg.lastChild, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let broken = false, busy = false, falling = [], cracks = [];

  function shatter(px, py) {
    const n = 13, A = [...Array(n)].map((_, i) => i / n * Math.PI * 2 + rnd(-.22, .22)), R = [0, rnd(12, 20), rnd(45, 70), rnd(110, 150), w + h];
    // 每条裂纹走几步就拐一下，不是直线；外圈的环只连一部分，不像蜘蛛网
    const P = A.map(a => R.map((r, j) => { const b = a + (j ? rnd(-.12, .12) : 0); return [px + Math.cos(b) * r * rnd(.85, 1.15), py + Math.sin(b) * r * rnd(.85, 1.15)]; }));
    const pt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
    let d = '';
    for (let i = 0; i < n; i++) {
      d += `M${px},${py}L${P[i].slice(1).map(pt).join('L')}`;
      for (let j = 1; j <= 3; j++) if (Math.random() < [0, .9, .55, .3][j]) d += `M${pt(P[i][j])}L${pt(P[(i + 1) % n][j])}`;
      // 主裂纹上再岔出一两根细的
      for (let j = 1; j < 3; j++) if (Math.random() < .5) { const [x, y] = P[i][j], a = A[i] + rnd(-.9, .9), r = rnd(10, 26); d += `M${pt([x, y])}L${pt([x + Math.cos(a) * r, y + Math.sin(a) * r])}`; }
    }
    // 没掉的玻璃带一点点反光，掉了的地方就是透的，看得出洞
    for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
      const q = [P[i][j], P[(i + 1) % n][j], P[(i + 1) % n][j + 1], P[i][j + 1]].map(pt).join(' ');
      const fall = j > 0 && Math.random() < (j < 3 ? .4 : .18);
      if (j === 3 && !fall) continue;   // 最外一圈太大，留着不画，不然整扇窗都蒙上一层
      const el = S('polygon', { points: q, class: fall ? 'is-shard' : 'is-pane' });
      box.append(el);
      if (fall) falling.push([el, rnd(-30, 30), rnd(220, 340), rnd(-140, 140)]);
    }
    cracks = [S('path', { d, class: 'is-glow' }), S('path', { d, class: 'is-crack' })];
    box.append(...cracks);
    if (still) return;
    const flash = S('circle', { cx: px, cy: py, r: 30, class: 'is-flash' }); box.append(flash);
    flash.animate([{ opacity: 1, transform: 'scale(.2)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 320, easing: 'ease-out' }).onfinish = () => flash.remove();
    cracks.forEach(c => { const L = c.getTotalLength(); c.style.strokeDasharray = L; c.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 220, easing: 'ease-out' }); });
    falling.forEach(([el, dx, dy, rot]) => el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 }],
      { duration: rnd(650, 1000), delay: rnd(40, 140), easing: 'cubic-bezier(.45, 0, .9, .6)', fill: 'forwards' }));
  }
  function mend() {
    const clear = () => { box.replaceChildren(); falling = []; cracks = []; busy = false; };
    if (still) return clear();
    busy = true;
    const back = falling.map(([el, dx, dy, rot]) => el.animate([{ transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: rnd(380, 520), easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'forwards' }).finished);
    Promise.all(back).then(() => {
      const anims = cracks.map(c => c.animate([{ strokeDashoffset: 0, opacity: 1 }, { strokeDashoffset: c.getTotalLength(), opacity: 0 }], { duration: 300, easing: 'ease-in', fill: 'forwards' }).finished);
      box.querySelectorAll('.is-pane, .is-shard').forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }));
      Promise.all(anims).then(clear);
    });
  }
  /** 点在屏幕上的 x、y */
  svg.toggle = (cx, cy) => {
    if (busy) return;
    if (broken) mend();
    else { const r = svg.getBoundingClientRect(); shatter((cx - r.left) / r.width * w, (cy - r.top) / r.height * h); }
    broken = !broken;
  };
  return svg;
}
