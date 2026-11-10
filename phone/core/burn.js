// 烧掉：从按的地方烧开——前面先烤黄，一条白热的火线走过去，后面焦黑、成灰，飘火星；烧完收起来，下面的补上来。
// 做法：元素本身用遮罩一格格挖掉（低分辨率的画布当遮罩），上面盖一层同样大小的画布画焦边、火线和火星；
// 每格什么时候烧到 = 离按下去的地方多远 + 一点噪声（边不是正圆）。火线 1.15 秒走完，全程 2 秒（作者给的参考参数）。
const S = 3, LINE = 1150, ALL = 2000, EDGE = 20;   // 一格 3px；焦边约 20px
const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
const smooth = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, f = t => t * t * (3 - 2 * t);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * f(u) + (c - a) * f(v) + (a - b - c + d) * f(u) * f(v); };
const fbm = (x, y) => smooth(x, y) * .5 + smooth(x * 2, y * 2) * .3 + smooth(x * 4, y * 4) * .2;

/** 把 el 从屏幕坐标 (x, y) 烧掉；烧完、收起来以后 resolve（el 还在，调用的人自己删） */
export function burn(el, x, y) {
  const r = el.getBoundingClientRect(), w = Math.max(1, Math.ceil(r.width / S)), h = Math.max(1, Math.ceil(r.height / S));
  const px = (x - r.left) / S, py = (y - r.top) / S, far = Math.hypot(Math.max(px, w - px), Math.max(py, h - py)) || 1;
  const D = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) D[j * w + i] = Math.hypot(i - px, j - py) / far + fbm(i * S * .018, j * S * .018) * .42;
  const top = Math.max(...D), edge = EDGE / S / far;
  const cv = () => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const mask = cv(), over = cv(), mc = mask.getContext('2d'), oc = over.getContext('2d'), M = mc.createImageData(w, h), O = oc.createImageData(w, h);
  Object.assign(over.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', pointerEvents: 'none', zIndex: 90 });
  document.body.append(over);
  const sparks = [];
  return new Promise(done => {
    const t0 = performance.now();
    const frame = now => {
      const t = now - t0, L = t / LINE * (top + edge);   // 火线现在走到哪
      for (let k = 0; k < D.length; k++) {
        const s = L - D[k], o = k * 4;   // s < 0 还没烧到；0～edge 焦边；再往后成灰
        M.data[o + 3] = s > edge ? 0 : 255;
        let c = [0, 0, 0], a = 0;
        if (s < 0 && s > -.08) { c = [255, 160, 60]; a = (1 + s / .08) * 70; }   // 前面先烤黄
        if (s >= 0 && s <= edge) { const f = s / edge; c = [60 - f * 40, 28 - f * 20, 10]; a = 120 + f * 135; }   // 焦边，越往后越黑
        const line = Math.exp(-((s / .012) ** 2));   // 白热的火线
        if (line > .02) { c = c.map((v, i) => v + ([255, 236, 190][i] - v) * line); a = Math.max(a, line * 255); if (Math.random() < .004) sparks.push({ x: k % w, y: (k / w) | 0, vx: (Math.random() - .5) * .6, vy: -.4 - Math.random() * .8, life: 1 }); }
        O.data[o] = c[0]; O.data[o + 1] = c[1]; O.data[o + 2] = c[2]; O.data[o + 3] = s > edge ? 0 : a;
      }
      for (const p of sparks) { p.x += p.vx; p.y += p.vy; p.life -= .03; const i = Math.round(p.x), j = Math.round(p.y);
        if (p.life > 0 && i >= 0 && i < w && j >= 0 && j < h) { const o = (j * w + i) * 4; O.data.set([255, 190, 90, p.life * 255], o); } }
      mc.putImageData(M, 0, 0); oc.putImageData(O, 0, 0);
      el.style.webkitMaskImage = el.style.maskImage = `url(${mask.toDataURL()})`; el.style.webkitMaskSize = el.style.maskSize = '100% 100%';
      if (t < ALL) return requestAnimationFrame(frame);
      over.remove();
      // 收起来：下面的补上
      Object.assign(el.style, { height: r.height + 'px', overflow: 'hidden', transition: 'height 280ms ease, margin 280ms ease, padding 280ms ease' });
      requestAnimationFrame(() => Object.assign(el.style, { height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }));
      setTimeout(done, 300);
    };
    requestAnimationFrame(frame);
  });
}
