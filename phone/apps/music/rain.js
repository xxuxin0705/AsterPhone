// 下雨天皮肤：竖直的雨丝落进水里，落点闪一下、溅起几粒水花、荡开两圈水纹（远处小、近处大）；
// 当前这句跟着唱一个字一个字掉下来，刚好在唱到时落到水面排成一行，水里有倒影；
// 下一句开始往下掉时，上一句从左到右像水珠一样「啪」地碎掉化开。字的位置全按播放时间算，拖进度、暂停都对得上。
import * as P from '../../core/music.js';

const FONT = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif';
const WIDE = '぀-ヿ㐀-鿿가-힯＀-￯　-〿“”‘’…—';
const TOK = new RegExp(`[${WIDE}]|[^\\s${WIDE}]+|\\s+`, 'g');   // 中日韩一个字一块，外文一个词一块
const FALL = .55, POP = .38, GAP = .045, SIZE = 26;
export const isNight = () => { const h = new Date().getHours(); return h >= 18 || h < 6; };

export function rain(cv, page) {
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, ground = 0, raf = 0, last = 0, night = true, drops = [], rips = [], bits = [], lines = new Map(), forL = null;
  const col = (n, d) => a => `rgba(${night ? n : d},${a})`;
  const ink = col('244,248,255', '26,56,110'), rainC = col('215,230,255', '40,75,140'), ringC = col('110,170,255', '40,85,160'), spark = col('255,255,255', '30,60,120');
  // z：远近（0 远 1 近）。远的短、慢、淡，落在靠近水平线的地方；近的长、快，落得靠下
  const drop = top => { const z = Math.random(); return { x: Math.random() * W, y: top ? -Math.random() * H * .4 : Math.random() * H * .9, z, l: 6 + z * 18, v: 380 + z * 560, end: ground + 4 + z * (H - ground - 4) }; };

  function size() {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (r.width === W && r.height === H) return;
    W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    ground = Math.round(H * .64);   // 背景图里水面在这一带
    drops = Array.from({ length: 70 }, () => drop(false)); lines.clear();
  }
  // 一句排好：字号放不下就缩，每块记下落地位置、掉下来时的歪斜、碎开时水花往哪溅
  function layout(L, i) {
    const x = L[i]; if (lines.has(x)) return lines.get(x);
    let fs = SIZE; ctx.font = `500 ${fs}px ${FONT}`;
    const toks = x.w ? x.w.map(w => w.text) : x.text.match(TOK) || [];   // 有逐字时间就按它分块
    let ws = toks.map(t => ctx.measureText(t).width), sum = ws.reduce((a, b) => a + b, 0);
    if (sum > W - 40) { fs = Math.max(13, fs * (W - 40) / sum); ctx.font = `500 ${fs}px ${FONT}`; ws = toks.map(t => ctx.measureText(t).width); sum = ws.reduce((a, b) => a + b, 0); }
    let at = (W - sum) / 2;
    const out = { fs, tr: x.tr, toks: [] }, when = P.wordTimes(L, i, toks.filter(t => t.trim()).length);
    toks.forEach((t, k) => { if (t.trim()) out.toks.push({ t: t.trim(), at: when[out.toks.length], x: at, w: ws[k], jx: (Math.random() - .5) * 40, r0: (Math.random() - .5) * 1.2, r1: (Math.random() - .5) * .08,
      sp: Array.from({ length: 5 }, () => [(Math.random() - .5) * 2.4, .6 + Math.random() * .8]) }); at += ws[k]; });
    lines.set(x, out);
    return out;
  }

  function frame(now) {
    if (page.classList.contains('is-behind') || page.classList.contains('is-lrc') || !page.isConnected) { raf = 0; return; }
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now; size();
    ctx.clearRect(0, 0, W, H);
    for (const d of drops) {
      d.y += d.v * dt;
      if (d.y >= d.end) {
        rips.push({ x: d.x, y: d.end, z: d.z, a: 0 });
        for (let k = 0; k < 3; k++) bits.push({ x: d.x, y: d.end, vx: (Math.random() - .5) * 60 * (.4 + d.z), vy: -(40 + Math.random() * 70) * (.4 + d.z), l: .45 });
        Object.assign(d, drop(true));
      }
    }
    // 雨丝：先一道宽的淡光，再一道细的亮线；远近分两批画
    for (const [far, a] of [[true, .5], [false, 1]]) for (const [w, al] of [[3.4, .06], [1.1, .5]]) {
      ctx.lineWidth = w; ctx.strokeStyle = rainC(al * a); ctx.beginPath();
      for (const d of drops) if ((d.z < .5) === far) { ctx.moveTo(d.x, d.y - d.l); ctx.lineTo(d.x, d.y); }
      ctx.stroke();
    }
    // 水纹：两圈，第二圈晚一点；刚落下那一下闪一个亮点
    ctx.lineWidth = 1;
    for (let i = rips.length - 1; i >= 0; i--) {
      const r = rips[i]; r.a += dt / 1.1; if (r.a >= 1) { rips.splice(i, 1); continue; }
      const k = .35 + r.z, fl = .2 + r.z * .12;
      for (const a of [r.a, r.a - .2]) if (a > 0) { const rx = (3 + a * 26) * k; ctx.strokeStyle = ringC((1 - a) * .55); ctx.beginPath(); ctx.ellipse(r.x, r.y, rx, rx * fl, 0, 0, Math.PI * 2); ctx.stroke(); }
      if (r.a < .22) { const f = 1 - r.a / .22; ctx.fillStyle = spark(.12 * f); ctx.beginPath(); ctx.arc(r.x, r.y, 6 * k, 0, 7); ctx.fill(); ctx.fillStyle = spark(.9 * f); ctx.beginPath(); ctx.arc(r.x, r.y, 1 + k, 0, 7); ctx.fill(); }
    }
    // 溅起的小水花
    ctx.fillStyle = spark(.75);
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]; b.l -= dt; if (b.l <= 0) { bits.splice(i, 1); continue; }
      b.vy += 600 * dt; b.x += b.vx * dt; b.y += b.vy * dt; ctx.fillRect(b.x, b.y, 1.3, 1.3);
    }
    words(P.now(), now / 1000);
    raf = requestAnimationFrame(frame);
  }

  function words(t, clock) {
    let L = P.lyricsNow();
    if (!L.length) { const s = P.current() || {}; L = [{ t: 0, text: s.name || '', tr: s.artist || '' }]; }
    if (L !== forL) { forL = L; lines.clear(); }
    const go = k => (L[k].w ? L[k].w[0].t : L[k].t + P.LAG) - FALL;   // 这一句第一个字开始往下掉的时候，就算换句了
    let i = -1; while (i + 1 < L.length && go(i + 1) <= t) i++;
    if (i < 0) return;
    if (i > 0) draw(L, i - 1, t, clock, t - go(i));
    draw(L, i, t, clock, -1);
  }
  // pop：-1 = 正常；>= 0 = 从换句起过了几秒，字从左到右一个个碎掉
  function draw(L, i, t, clock, pop) {
    const x = L[i], lay = layout(L, i), n = lay.toks.length; if (!n) return;
    if (pop > n * GAP + POP) return;
    ctx.font = `500 ${lay.fs}px ${FONT}`; ctx.textBaseline = 'alphabetic';
    let landed = 0;
    lay.toks.forEach((k, j) => {
      const q = (t - (k.at - FALL)) / FALL; if (q <= 0) return;   // 提前 FALL 秒开始掉，唱到时刚好落地
      let y, rot, a = 1;
      if (q < 1) { y = -20 + (ground + 20) * q * q; rot = k.r0 * (1 - q) + k.r1 * q; a = Math.min(1, q * 3); }
      else { const b = Math.min(1, (q - 1) * FALL / .3); y = ground - Math.sin(b * Math.PI) * 6 * (1 - b); rot = k.r1; landed++; }
      const cx = k.x + k.jx * Math.max(0, 1 - q) + k.w / 2;
      const d = pop < 0 ? 0 : Math.max(0, Math.min(1, (pop - j * GAP) / POP));
      if (q >= 1 && pop < 0) {   // 刚落地那一下的水圈
        const b = (q - 1) * FALL; if (b < 1) { const rx = k.w * .4 + b * 30; ctx.strokeStyle = ringC((1 - b) * .5); ctx.beginPath(); ctx.ellipse(cx, ground + 4, rx, rx * .22, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      if (d > 0) burst(k, cx, d, lay.fs);
      if (d < 1) glyph(k.t, cx, y, rot, a, d, q >= 1, clock);
    });
    if (lay.tr && landed) {
      const fade = pop < 0 ? 0 : Math.min(1, pop / (n * GAP + POP));
      ctx.font = `400 13px ${FONT}`; ctx.textAlign = 'center'; ctx.shadowColor = night ? 'rgba(4,14,40,.9)' : 'rgba(255,255,255,.8)'; ctx.shadowBlur = 6;   // 夜里水面月光亮，垫一层暗影才看得清
      ctx.fillStyle = ink((night ? .82 : .6) * Math.min(1, landed / n * 1.5) * (1 - fade)); ctx.fillText(lay.tr, W / 2, ground + 32);
      ctx.textAlign = 'start'; ctx.shadowBlur = 0;
    }
  }
  // 碎开：字往下一压扁就没了，原地溅起几粒水珠落回水面，荡一圈小水纹
  function burst(k, cx, d, fs) {
    const top = ground - fs * .45;
    ctx.fillStyle = spark(.95 * (1 - d * .7)); if (night) { ctx.shadowColor = 'rgba(170,205,255,.9)'; ctx.shadowBlur = 6; }
    for (const [vx, vy] of k.sp) { const x = cx + vx * d * fs * .8, y = top - vy * fs * .9 * d + fs * 1.6 * d * d; ctx.beginPath(); ctx.arc(x, Math.min(y, ground + 2), 2.3 * (1 - d * .4), 0, 7); ctx.fill(); }
    ctx.shadowBlur = 0;
    const rx = k.w * .3 + d * 22; ctx.strokeStyle = ringC((1 - d) * .5); ctx.beginPath(); ctx.ellipse(cx, ground + 4, rx, rx * .22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  function glyph(t, cx, y, rot, a, d, onWater, clock) {
    if (a <= .01) return;
    const sq = 1 - Math.min(1, d * 1.8);   // 碎的时候前一小半就压扁没了
    if (sq <= 0) return;
    ctx.save(); ctx.translate(cx, y); ctx.rotate(rot); ctx.scale(1 + (1 - sq) * .25, sq); ctx.textAlign = 'center';
    if (night) { ctx.shadowColor = `rgba(170,205,255,${.7 * a})`; ctx.shadowBlur = 10; }
    ctx.fillStyle = ink(a * sq); ctx.fillText(t, 0, 0);
    ctx.restore();
    if (onWater) {   // 倒影：压扁、晃一晃
      ctx.save(); ctx.translate(cx + Math.sin(clock * 2.2 + cx * .05) * 1.5, ground + 6); ctx.scale(1, -.55 * sq); ctx.textAlign = 'center'; ctx.shadowBlur = 0;
      ctx.fillStyle = ink(a * .18 * sq); ctx.fillText(t, 0, 0); ctx.restore();
    }
  }

  return {
    start() { night = isNight(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); },
  };
}
