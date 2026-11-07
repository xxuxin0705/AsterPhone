// 下雨天皮肤：竖直的雨丝落进水里，落点闪一下、溅起几粒水花、荡开两圈水纹（远处小、近处大）；
// 当前这句跟着唱一个字一个字掉下来，刚好在唱到时落到水面排成一行（太长分两行），水里有倒影；翻译也拆成字，跟着对应的歌词字一起掉，落在倒影下面；
// 下一句开始往下掉时，上一句从左到右像水珠一样「啪」地碎掉化开。字的位置全按播放时间算，拖进度、暂停都对得上。
import * as P from '../../core/music.js';
import { shell } from '../../core/shell.js';

const FONT = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif';
const WIDE = '぀-ヿ㐀-鿿가-힯＀-￯　-〿“”‘’…—';
const TOK = new RegExp(`[${WIDE}]|[^\\s${WIDE}]+|\\s+`, 'g');   // 中日韩一个字一块，外文一个词一块
const FALL = .55, POP = .38, GAP = .045, SIZE = 26, MIN = 18, TR = 18;
export const isNight = () => document.querySelector('.as-phone')?.dataset.mode === 'night';   // 跟着手机的白天 / 夜间模式
export const hidden = () => { const p = document.querySelector('.as-phone'); return !shell.visible || !!p && (p.classList.contains('is-locked') || p.classList.contains('is-cropping')); };   // 手机收起了 / 锁着 / 正在框图：看不见的动画别画

export function rain(cv, page) {
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, ground = 0, raf = 0, last = 0, night = true, drops = [], rips = [], bits = [], lines = new Map(), forL = null, tint = '', shade = '', edge = '', face = FONT;   // shade：'' 不加 / 'edge' 描边 / 'glow' 发光；edge：自己选的描边颜色（'r,g,b'）；face：字体
  // tint：自己选的歌词颜色（'r,g,b'），字、字的光、水纹都换成它；没选就是白天 / 夜里各自的颜色
  const col = (n, d) => a => `rgba(${tint || (night ? n : d)},${a})`;
  const ink = col('244,248,255', '26,56,110'), rainC = a => `rgba(${night ? '215,230,255' : '40,75,140'},${a})`, ringC = col('110,170,255', '40,85,160'), spark = a => `rgba(${night ? '255,255,255' : '30,60,120'},${a})`;
  const glow = a => `rgba(${tint || '170,205,255'},${a})`;
  // 字底下垫一圈影子当描边：字是浅色就垫深的，字是深色就垫白的（按字的颜色算，不按白天夜里）
  const halo = a => edge ? `rgba(${edge},${a * .9})` : (tint || (night ? '244,248,255' : '26,56,110')).split(',').reduce((s, v, i) => s + v * [.3, .59, .11][i], 0) > 128 ? `rgba(4,14,40,${a * .9})` : `rgba(255,255,255,${a * .8})`;
  // z：远近（0 远 1 近）。远的短、慢、淡，落在靠近水平线的地方；近的长、快，落得靠下
  const drop = top => { const z = Math.random(); return { x: Math.random() * W, y: top ? -Math.random() * H * .4 : Math.random() * H * .9, z, l: 6 + z * 18, v: 380 + z * 560, end: ground + 4 + z * (H - ground - 4) }; };

  function size() {
    const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);   // 和壁纸一样最多 2 倍：3 倍屏画雨和字（带阴影）太费
    if (r.width === W && r.height === H) return;
    W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    // 背景图里水面在 64% 这一带；但字、倒影、翻译（最多两行）不能压到下面的歌名，屏幕矮时往上提
    const info = page.querySelector('.as-mp__info');
    ground = Math.round(Math.min(H * .64, info ? info.getBoundingClientRect().top - r.top - 74 - TR * 1.5 : H));
    drops = Array.from({ length: 70 }, () => drop(false)); lines.clear();
  }
  // 一句排好：字号放不下就缩，每块记下落地位置、掉下来时的歪斜、碎开时水花往哪溅
  function layout(L, i) {
    const x = L[i]; if (lines.has(x)) return lines.get(x);
    let fs = SIZE; ctx.font = `500 ${fs}px ${face}`;
    const toks = x.w ? x.w.map(w => w.text) : x.text.match(TOK) || [];   // 有逐字时间就按它分块
    let ws = toks.map(t => ctx.measureText(t).width), sum = ws.reduce((a, b) => a + b, 0);
    // 尽量一行：放不下先把字缩小（最小 MIN），缩到 MIN 还放不下才分成差不多长的两行（上一行浮在水面上方，下一行落在水面）；两行还放不下再缩
    let cut = toks.length;
    if (sum * MIN / SIZE > W - 40) {
      let acc = 0; cut = ws.findIndex(w => (acc += w) > sum / 2); if (cut < 1) cut = 1;
      // 有空格就在离中间最近的空格处分（日文歌词的空格是断句的地方），两行都放得下才算
      let best = Infinity; acc = 0;
      toks.forEach((t, k) => { if (k && !t.trim() && Math.max(acc, sum - acc) <= W - 40 && Math.abs(acc - sum / 2) < best) { best = Math.abs(acc - sum / 2); cut = k; } acc += ws[k]; });
    }
    const rowW = () => [ws.slice(0, cut).reduce((a, b) => a + b, 0), ws.slice(cut).reduce((a, b) => a + b, 0)];
    const widest = Math.max(...rowW());
    if (widest > W - 40) { fs = Math.max(13, fs * (W - 40) / widest); ctx.font = `500 ${fs}px ${face}`; ws = toks.map(t => ctx.measureText(t).width); }
    const [w0, w1] = rowW(), two = cut < toks.length;
    let at = (W - w0) / 2;
    // 翻译：字号固定，一行放不下就分两行（在离中间最近的空格处，没有空格就从中间分），不缩小
    ctx.font = `400 ${TR}px ${face}`;
    const tc = [...(x.tr || '')], mid = tc.length / 2, sp = tc.reduce((b, c, k) => c === ' ' && Math.abs(k - mid) < Math.abs(b - mid) ? k : b, Math.round(mid));
    const tr = !x.tr ? [] : ctx.measureText(x.tr).width > W - 48 ? [tc.slice(0, sp).join('').trim(), tc.slice(sp).join('').trim()] : [x.tr];
    const out = { fs, toks: [], trc: [] }, when = P.wordTimes(L, i, toks.filter(t => t.trim()).length);
    toks.forEach((t, k) => { if (k === cut) at = (W - w1) / 2;
      if (t.trim()) out.toks.push({ t: t.trim(), at: when[out.toks.length], x: at, w: ws[k], dy: two && k < cut ? -fs * 1.45 : 0, jx: (Math.random() - .5) * 40, r0: (Math.random() - .5) * 1.2, r1: (Math.random() - .5) * .08,
      sp: Array.from({ length: 5 }, () => [(Math.random() - .5) * 2.4, .6 + Math.random() * .8]) }); at += ws[k]; });
    // 翻译一个字一块，按比例分给歌词的字（第 j 个翻译字跟着第 j·n/m 个歌词字掉），落在倒影下面第 r 行
    tr.forEach((row, r) => { const cs = [...row], cw = cs.map(c => ctx.measureText(c).width); let tx = (W - cw.reduce((a, b) => a + b, 0)) / 2;
      cs.forEach((c, k) => { if (c.trim()) out.trc.push({ t: c, x: tx + cw[k] / 2, r, jx: (Math.random() - .5) * 24, r0: (Math.random() - .5) * .8 }); tx += cw[k]; }); });
    const n = out.toks.length, m = out.trc.length;
    out.trc.forEach((c, j) => { c.at = n ? out.toks[Math.min(n - 1, Math.floor(j * n / m))].at : 0; });
    lines.set(x, out);
    return out;
  }

  function frame(now) {
    if (page.classList.contains('is-behind') || page.classList.contains('is-lrc') || !page.isConnected) { raf = 0; return; }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
    if (hidden()) return;
    size();
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
  }

  function words(t, clock) {
    if (P.loading() || (!P.playing() && !P.now())) return;   // 还在问链接 / 还没出声：别按 0 秒把第一句掉下来
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
    ctx.font = `500 ${lay.fs}px ${face}`; ctx.textBaseline = 'alphabetic';
    lay.toks.forEach((k, j) => {
      const q = (t - (k.at - FALL)) / FALL; if (q <= 0) return;   // 提前 FALL 秒开始掉，唱到时刚好落地
      let y, rot, a = 1; const g = ground + k.dy;   // 两行时上一行停在水面上方
      if (q < 1) { y = -20 + (g + 20) * q * q; rot = k.r0 * (1 - q) + k.r1 * q; a = Math.min(1, q * 3); }
      else { const b = Math.min(1, (q - 1) * FALL / .3); y = g - Math.sin(b * Math.PI) * 6 * (1 - b); rot = k.r1; }
      const cx = k.x + k.jx * Math.max(0, 1 - q) + k.w / 2;
      const d = pop < 0 ? 0 : Math.max(0, Math.min(1, (pop - j * GAP) / POP));
      if (q >= 1 && pop < 0) {   // 刚落地那一下的水圈
        const b = (q - 1) * FALL; if (b < 1 && !k.dy) { const rx = k.w * .4 + b * 30; ctx.strokeStyle = ringC((1 - b) * .5); ctx.beginPath(); ctx.ellipse(cx, ground + 4, rx, rx * .22, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      if (d > 0) burst(k, cx, d, lay.fs);
      if (d < 1) glyph(k.t, cx, y, rot, a, d, q >= 1 && !k.dy, clock);
    });
    if (lay.trc.length) {
      const fade = pop < 0 ? 0 : Math.min(1, pop / (n * GAP + POP));
      // 翻译的字跟着对应的歌词字一起掉，落在倒影下面（不压着倒影）；换句时整句淡掉
      ctx.font = `400 ${TR}px ${face}`;
      ctx.textAlign = 'center'; ctx.shadowColor = edge ? halo(.8) : glow(.8); ctx.shadowBlur = shade === 'glow' ? 6 : 0; ctx.lineWidth = 1.1; ctx.lineJoin = 'round';
      const al = (night ? .88 : .7) * (1 - fade);
      for (const c of lay.trc) {
        const q = (t - (c.at - FALL)) / FALL; if (q <= 0) continue;
        const g = ground + SIZE * .6 + 30 + c.r * TR * 1.5;
        const y = q < 1 ? -20 + (g + 20) * q * q : g, a = Math.min(1, q * 3);
        ctx.save(); ctx.translate(c.x + c.jx * Math.max(0, 1 - q), y); ctx.rotate(c.r0 * Math.max(0, 1 - q));
        if (shade === 'edge') { ctx.strokeStyle = halo(al * a); ctx.strokeText(c.t, 0, 0); }
        ctx.fillStyle = ink(al * a); ctx.fillText(c.t, 0, 0); ctx.restore();
      }
      ctx.textAlign = 'start'; ctx.shadowBlur = 0;
    }
  }
  // 碎开：字往下一压扁就没了，原地溅起几粒水珠落回水面，荡一圈小水纹
  function burst(k, cx, d, fs) {
    const top = ground + k.dy - fs * .45;
    ctx.fillStyle = spark(.95 * (1 - d * .7)); if (night) { ctx.shadowColor = glow(.9); ctx.shadowBlur = 6; }
    for (const [vx, vy] of k.sp) { const x = cx + vx * d * fs * .8, y = top - vy * fs * .9 * d + fs * 1.6 * d * d; ctx.beginPath(); ctx.arc(x, Math.min(y, ground + k.dy + 2), 2.3 * (1 - d * .4), 0, 7); ctx.fill(); }
    ctx.shadowBlur = 0;
    const rx = k.w * .3 + d * 22; ctx.strokeStyle = ringC((1 - d) * .5); ctx.beginPath(); ctx.ellipse(cx, ground + 4, rx, rx * .22, 0, 0, Math.PI * 2); ctx.stroke();
  }
  function glyph(t, cx, y, rot, a, d, onWater, clock) {
    if (a <= .01) return;
    const sq = 1 - Math.min(1, d * 1.8);   // 碎的时候前一小半就压扁没了
    if (sq <= 0) return;
    ctx.save(); ctx.translate(cx, y); ctx.rotate(rot); ctx.scale(1 + (1 - sq) * .25, sq); ctx.textAlign = 'center';
    ctx.fillStyle = ink(a * sq); ctx.shadowBlur = 0;
    if (shade === 'edge') { ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.strokeStyle = halo(a); ctx.strokeText(t, 0, 0); }   // 描边：字边上一圈实线
    else if (shade === 'glow') { ctx.shadowColor = edge ? halo(.8 * a) : glow(.7 * a); ctx.shadowBlur = 10; }
    ctx.fillText(t, 0, 0);
    ctx.restore();
    if (onWater) {   // 倒影：压扁、晃一晃
      ctx.save(); ctx.translate(cx + Math.sin(clock * 2.2 + cx * .05) * 1.5, ground + 6); ctx.scale(1, -.55 * sq); ctx.textAlign = 'center'; ctx.shadowBlur = 0;
      ctx.fillStyle = ink(a * .18 * sq); ctx.fillText(t, 0, 0); ctx.restore();
    }
  }

  return {
    shade(v) { shade = v || ''; },
    edge(hex) { edge = hex ? [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)).join(',') : ''; },
    font(f) { const v = f ? `${f}, ${FONT}` : FONT; if (v !== face) { face = v; lines.clear(); } },   // 换了字体才重新排
    color(hex) { tint = hex ? [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)).join(',') : ''; },
    start() { night = isNight(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); },
  };
}
