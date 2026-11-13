// 幕间 · 两颗十面骰（冰蓝水晶的十位、深蓝星空的个位），图是作者让 GPT 画的。
// 抛：从右下角划一道弧飞进来，空中轮着换翻滚的模糊图、一边转，落地弹两下停住，再亮出点数。
const BASE = 'assets/interlude/';
const roll = k => [0, 1, 2, 3].map(i => BASE + `dice-${k}${i}.webp`);
const still = (k, n) => BASE + `dice-f${k}${n}.webp`;   // 每一面朝上的图
[BASE + 'dice-d20.webp', ...roll('t'), ...roll('u'), ...[...Array(10).keys()].flatMap(n => [still('t', n), still('u', n)])].forEach(src => { new Image().src = src; });   // 先解码好，抛的时候不闪

// 落地的「嗒」：一小段带通滤波的噪声
let actx = null;
function tick(vol) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const sr = actx.sampleRate, b = actx.createBuffer(1, sr * .05, sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * .008));
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.4; g.gain.value = vol;
    s.connect(f).connect(g).connect(actx.destination); s.start();
  } catch (e) { /* 不让响就算了 */ }
}

/** 桌上骰子盘里静止的：一颗二十面（和开屏落下来的是同一颗）加一颗个位十面 */
export function restDice(host, u = 7) {
  host.replaceChildren(...[[BASE + 'dice-d20.webp', 'd20'], [still('u', u), 'u']].map(([src, k]) => Object.assign(new Image(), { src, alt: '', className: 'as-int-die is-' + k })));
}

/** 在 host（一块盖住页面的层）里抛一次，抛完停住。t = 十位 0～9，u = 个位 0～9 */
export function throwDice(host, t, u) {
  const els = [['t', t], ['u', u]].map(([k, n], i) => {
    const im = Object.assign(new Image(), { src: roll(k)[0], alt: '', className: 'as-int-die is-' + k });
    host.append(im); return { im, k, n, i };
  });
  const W = host.clientWidth, H = host.clientHeight, T = 1500, t0 = performance.now();
  // 停在哪：两颗并排，在画面中间偏上
  const end = [[W * .36, H * .42], [W * .64, H * .46]], from = [[W * 1.1, H * 1.05], [W * 1.2, H * .95]];
  let ticked = 0;
  return new Promise(res => {
    const step = now => {
      let busy = false;
      for (const d of els) {
        const k = Math.min(1, Math.max(0, (now - t0 - d.i * 90) / T)), e = 1 - Math.pow(1 - k, 2.4); busy = busy || k < 1;
        const x = from[d.i][0] + (end[d.i][0] - from[d.i][0]) * e, y0 = from[d.i][1] + (end[d.i][1] - from[d.i][1]) * e;
        // 高度：一个大抛物线，落地后两个小弹跳
        const z = k < .55 ? Math.sin(k / .55 * Math.PI) * H * .28 : k < .78 ? Math.sin((k - .55) / .23 * Math.PI) * H * .05 : k < .92 ? Math.sin((k - .78) / .14 * Math.PI) * H * .015 : 0;
        const spin = (1 - e) * 900 * (d.i ? -1 : 1), s = 1 + z / H * .6;
        d.im.style.transform = `translate(${x}px, ${y0 - z}px) translate(-50%, -50%) rotate(${spin}deg) scale(${s})`;
        const done = k >= .92;
        const src = done ? still(d.k, d.n) : roll(d.k)[1 + Math.floor(now / 70 + d.i) % 3];
        if (d.im.getAttribute('src') !== src) d.im.src = src;
      }
      const k0 = (now - t0) / T;
      if ((ticked === 0 && k0 > .55) || (ticked === 1 && k0 > .78) || (ticked === 2 && k0 > .92)) { tick([.5, .3, .15][ticked]); ticked++; }
      if (busy) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
