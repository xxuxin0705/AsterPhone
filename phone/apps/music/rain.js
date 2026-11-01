// 下雨天皮肤：雨丝斜着落进水里荡开涟漪；当前这句跟着唱一个字一个字掉下来，落在水面上排成一行，水里有倒影；
// 下一句来了，上一句沉进水里、被雨冲淡化开（最多同时两句）。字的位置全按播放时间算，拖进度、暂停都对得上。
import * as P from '../../core/music.js';

const FONT = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif';
const WIDE = '぀-ヿ㐀-鿿가-힯＀-￯　-〿“”‘’…—';
const TOK = new RegExp(`[${WIDE}]|[^\\s${WIDE}]+|\\s+`, 'g');   // 中日韩一个字一块，外文一个词一块
const FALL = .75, FADE = 2.4, SIZE = 26;
export const isNight = () => { const h = new Date().getHours(); return h >= 18 || h < 6; };

export function rain(cv, page) {
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, ground = 0, raf = 0, last = 0, night = true, drops = [], rips = [], lines = new Map(), forL = null;
  const ink = a => night ? `rgba(244,248,255,${a})` : `rgba(26,56,110,${a})`;
  const drop = top => ({ x: Math.random() * (W + 80) - 20, y: top ? -Math.random() * H * .3 : Math.random() * H, l: 12 + Math.random() * 16, v: 520 + Math.random() * 260, end: ground + 6 + Math.random() * (H - ground - 6) });

  function size() {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (r.width === W && r.height === H) return;
    W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    ground = Math.round(H * .64);   // 背景图里水面在这一带
    drops = Array.from({ length: 56 }, () => drop(false)); lines.clear();
  }
  // 一句排好：字号放不下就缩，每块记下落地位置、掉下来时的歪斜
  function layout(x) {
    if (lines.has(x)) return lines.get(x);
    let fs = SIZE; ctx.font = `500 ${fs}px ${FONT}`;
    const toks = x.text.match(TOK) || [];
    let ws = toks.map(t => ctx.measureText(t).width), sum = ws.reduce((a, b) => a + b, 0);
    if (sum > W - 40) { fs = Math.max(13, fs * (W - 40) / sum); ctx.font = `500 ${fs}px ${FONT}`; ws = toks.map(t => ctx.measureText(t).width); sum = ws.reduce((a, b) => a + b, 0); }
    let at = (W - sum) / 2;
    const out = { fs, tr: x.tr, toks: [] };
    toks.forEach((t, k) => { if (t.trim()) out.toks.push({ t, x: at, w: ws[k], jx: (Math.random() - .5) * 40, r0: (Math.random() - .5) * 1.2, r1: (Math.random() - .5) * .08 }); at += ws[k]; });
    lines.set(x, out);
    return out;
  }

  function frame(now) {
    if (page.classList.contains('is-behind') || page.classList.contains('is-lrc') || !page.isConnected) { raf = 0; return; }
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now; size();
    ctx.clearRect(0, 0, W, H);
    // 雨丝
    ctx.strokeStyle = ink(night ? .28 : .3); ctx.lineWidth = 1; ctx.beginPath();
    for (const d of drops) {
      d.y += d.v * dt; d.x -= d.v * dt * .12;
      if (d.y >= d.end) { rips.push({ x: d.x, y: d.end, a: 0, s: .4 + (d.end - ground) / (H - ground) }); Object.assign(d, drop(true)); continue; }
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * .12, d.y - d.l);
    }
    ctx.stroke();
    // 涟漪：越近（越往下）越大
    for (let i = rips.length - 1; i >= 0; i--) {
      const r = rips[i]; r.a += dt / .9; if (r.a >= 1) { rips.splice(i, 1); continue; }
      ctx.strokeStyle = ink((1 - r.a) * .32); ctx.beginPath(); ctx.ellipse(r.x, r.y, 3 + r.a * 22 * r.s, (3 + r.a * 22 * r.s) * .28, 0, 0, Math.PI * 2); ctx.stroke();
    }
    words(P.audio.currentTime || 0, now / 1000);
    raf = requestAnimationFrame(frame);
  }

  function words(t, clock) {
    let L = P.lyricsNow();
    if (!L.length) { const s = P.current() || {}; L = [{ t: 0, text: s.name || '', tr: s.artist || '' }]; }
    if (L !== forL) { forL = L; lines.clear(); }
    let i = -1; while (i + 1 < L.length && L[i + 1].t <= t) i++;
    if (i < 0) return;
    if (i > 0 && t - L[i].t < FADE) draw(L, i - 1, t, clock, (t - L[i].t) / FADE);
    draw(L, i, t, clock, 0);
  }
  // fade：0 = 正常；0→1 = 沉进水里、化开、变淡
  function draw(L, i, t, clock, fade) {
    const x = L[i], lay = layout(x), n = lay.toks.length; if (!n) return;
    const len = Math.min((L[i + 1] ? L[i + 1].t : x.t + 6) - x.t, n * .45 + .6), step = len * .9 / n;
    ctx.font = `500 ${lay.fs}px ${FONT}`; ctx.textBaseline = 'alphabetic';
    let landed = 0;
    lay.toks.forEach((k, j) => {
      const q = (t - x.t - j * step) / FALL; if (q <= 0) return;
      let y, rot, a = 1;
      if (q < 1) { y = -20 + (ground + 20) * q * q; rot = k.r0 * (1 - q) + k.r1 * q; a = Math.min(1, q * 3); }
      else { const b = Math.min(1, (q - 1) * FALL / .35); y = ground - Math.sin(b * Math.PI) * 7 * (1 - b); rot = k.r1; landed++; }
      const cx = k.x + k.jx * Math.max(0, 1 - q) + k.w / 2;
      if (q >= 1 && !fade) {   // 刚落地那一下的水圈
        const b = (q - 1) * FALL; if (b < 1.1) { ctx.strokeStyle = ink((1 - b / 1.1) * .45); ctx.beginPath(); ctx.ellipse(cx, ground + 4, k.w * .4 + b * 34, (k.w * .4 + b * 34) * .22, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      glyph(k.t, cx, y + fade * 34, rot, a * (1 - fade), fade, q >= 1, clock);
    });
    if (lay.tr && landed) {
      ctx.font = `400 13px ${FONT}`; ctx.textAlign = 'center'; ctx.shadowColor = night ? 'rgba(4,14,40,.9)' : 'rgba(255,255,255,.8)'; ctx.shadowBlur = 6;   // 夜里水面月光亮，垫一层暗影才看得清
      ctx.fillStyle = ink((night ? .82 : .6) * Math.min(1, landed / n * 1.5) * (1 - fade)); ctx.fillText(lay.tr, W / 2, ground + 32 + fade * 30);
      ctx.textAlign = 'start'; ctx.shadowBlur = 0;
    }
  }
  function glyph(t, cx, y, rot, a, fade, onWater, clock) {
    if (a <= .01) return;
    const spread = fade * 5, sc = 1 + fade * .3;
    ctx.save(); ctx.translate(cx, y); ctx.rotate(rot); ctx.scale(sc, sc * (1 + fade * .15)); ctx.textAlign = 'center';
    if (night) { ctx.shadowColor = `rgba(170,205,255,${.7 * a})`; ctx.shadowBlur = 10; }
    if (fade) { ctx.fillStyle = ink(a * .35); for (const [dx, dy] of [[-spread, 0], [spread, 0], [0, -spread * .6], [0, spread]]) ctx.fillText(t, dx, dy); }   // 化开：往四周晕
    ctx.fillStyle = ink(a); ctx.fillText(t, 0, 0);
    ctx.restore();
    if (onWater) {   // 倒影：压扁、晃一晃
      ctx.save(); ctx.translate(cx + Math.sin(clock * 2.2 + cx * .05) * 1.5, ground + 6 + fade * 34); ctx.scale(sc, -.55 * sc); ctx.textAlign = 'center'; ctx.shadowBlur = 0;
      ctx.fillStyle = ink(a * .18); ctx.fillText(t, 0, 0); ctx.restore();
    }
  }

  return {
    start() { night = isNight(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); },
    get night() { return night; },
  };
}
