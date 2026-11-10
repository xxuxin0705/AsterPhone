/* ---------- 白噪音：程序算出来的，不用下载录音（电台和幕间都用） ---------- */
const rnd = () => Math.random() * 2 - 1;
let ac = null;
function buf(sec, f) { const sr = 22050, b = ac.createBuffer(1, sec * sr, sr); f(b.getChannelData(0), sr); return b; }
const fill = { white: d => { for (let i = 0; i < d.length; i++) d[i] = rnd() * .35; },
  pink: d => { let a = 0, b = 0, c = 0; for (let i = 0; i < d.length; i++) { const w = rnd(); a = .99765 * a + w * .099046; b = .963 * b + w * .2965164; c = .57 * c + w * 1.0526913; d[i] = (a + b + c + w * .1848) * .18; } },
  brown: d => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + .02 * rnd()) / 1.02; d[i] = l * 3.2; } } };
/** 在 d 里随机撒 n 个很短的「啪」：雨点、柴火的噼啪 */
const pops = (d, sr, n, ms, amp) => { for (let k = 0; k < n; k++) { const at = Math.random() * d.length | 0, len = sr * ms[0] / 1e3 + Math.random() * sr * (ms[1] - ms[0]) / 1e3 | 0, a = amp * (.3 + Math.random() * .7);
  for (let i = 0; i < len && at + i < d.length; i++) d[at + i] += rnd() * a * Math.exp(-5 * i / len); } };
/** 一种白噪音（rain / fire / wave / wind / bug / white / pink / brown）接到 dest 上放起来，返回 { g 音量, stop 停的时候要停的 } */
export function noiseNode(c, k, dest, v) {
  ac = c; const g = c.createGain(), s = c.createBufferSource(), stop = [s];
  let out = s;
  const filt = (type, f, q = .7) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; out.connect(x); out = x; return x; };
  if (k === 'rain') { s.buffer = buf(6, (d, sr) => { fill.pink(d); pops(d, sr, 6 * 70, [2, 6], .5); }); filt('highpass', 500); }
  else if (k === 'fire') s.buffer = buf(8, (d, sr) => { fill.brown(d); for (let i = 0; i < d.length; i++) d[i] *= .6; pops(d, sr, 8 * 7, [2, 14], .9); });
  else if (k === 'wave') { s.buffer = buf(16, (d, sr) => { fill.brown(d); for (let i = 0; i < d.length; i++) d[i] *= .15 + .85 * Math.sin(Math.PI * i / sr / 8) ** 2; }); filt('lowpass', 900); }
  else if (k === 'wind') {
    s.buffer = buf(8, fill.pink); const bp = filt('bandpass', 600, .8), lfo = c.createOscillator(), dep = c.createGain();
    lfo.frequency.value = .08; dep.gain.value = 350; lfo.connect(dep); dep.connect(bp.frequency); lfo.start(); stop.push(lfo);
  }
  else if (k === 'bug') s.buffer = buf(6, (d, sr) => {   // 两只蟋蟀：一声三下「唧」，隔半秒多再叫
    for (const [f, a] of [[4300, .22], [4900, .12]]) for (let t = Math.random() * .5; t < 5.6; t += .55 + Math.random() * .5)
      for (let p = 0; p < 3; p++) { const at = (t + p * .05) * sr | 0, n = .028 * sr | 0; for (let i = 0; i < n && at + i < d.length; i++) d[at + i] += Math.sin(2 * Math.PI * f * i / sr) * Math.sin(Math.PI * i / n) * a; }
  });
  else s.buffer = buf(6, fill[k]);
  s.loop = true; g.gain.value = v; out.connect(g); g.connect(dest); s.start();
  return { g, stop };
}
