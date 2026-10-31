// 设置 → 连接 · 插线板
// 上面一块玻璃板，每个接口（API）是一个格子：中间是一张字符小脸（插孔），下面一个接口口子。
// 下面垂着四根 ASCII 字符拼成的线：聊天、杂活、生图、语音。拎起一根插进哪个格子，这件事就用哪个接口。
// 小脸：平时呆呆的 ·_·，拎着线靠近会好奇地看过来，插中先「≧▽≦」，连上了 ^‿^，连不上 T_T 还会掉眼泪。
import { h, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, navBtn, toast, actionSheet, dialog, sheet, icon, input, textarea, segmented, slider, switchEl } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { CHANNELS, testConn, listModels, keysOf } from '../../core/api.js';
import { shell } from '../../core/shell.js';
import { buildScene } from './scene.js';

const C = () => state.connections;
const KIND_NAME = { text: '文字', image: '生图', tts: '语音' };
/** 四根线。use = 存在 defaults 里的名字；kind = 能插哪一类接口 */
const CORDS = [
  { use: 'text', kind: 'text', label: '聊天', sym: '@', ink: [52, 120, 220], glow: [140, 200, 255] },
  { use: 'aux', kind: 'text', label: '杂活', sym: '%', ink: [28, 150, 132], glow: [120, 240, 210] },
  { use: 'image', kind: 'image', label: '生图', sym: '#', ink: [130, 92, 220], glow: [200, 170, 255] },
  { use: 'tts', kind: 'tts', label: '语音', sym: 'S', ink: [210, 132, 40], glow: [255, 210, 140] },
];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FACE = { idle: '·_·', blink: '-_-', curious: '·_·?', dim: '-_-', test: '°o°', ok: '^‿^', joy: '≧▽≦', bad: 'T_T', plugged: '·‿·' };

/* ---------- ASCII 插头：形状（局部坐标，插头尖在 (0,0)，往下是身体） ---------- */
const PLEN = 128, SC = .62, PL = PLEN * SC;
const CW = 6, CH = 8;
const RAMP = ['.', "'", ':', 'o', 't', 'x', ';', '%', 'S', 'X', '8', '#', '@'];
const sdRound = (x, y, hw, y0, y1, r) => {
  const cx = Math.abs(x) - (hw - r), cy = Math.max(y0 + r - y, y - (y1 - r));
  return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - r;
};
function plugAt(x, y) {
  if (y < -4 || y > PLEN + 4 || Math.abs(x) > 34) return [0, 0];
  const cyl = hw => 1 - Math.min(1, ((x + hw * .35) / hw) ** 2);
  let d = 0, metal = 0, s;
  if ((s = sdRound(x, y, 15, 0, 26, 6)) < 2) { d = (.42 + .42 * cyl(15)) * Math.min(1, (2 - s) / 3); metal = 1; }
  else if ((s = sdRound(x, y, 20, 26, 33, 2)) < 2) d = .95 * Math.min(1, (2 - s) / 3);
  else if ((s = sdRound(x, y, 27, 33, 98, 11)) < 2) {
    d = .62 + .3 * cyl(27);
    if ((y - 40) % 13 < 3 && y > 44 && y < 92) d *= .55;
    d *= Math.min(1, (2 - s) / 3);
  } else if (y >= 96 && y <= PLEN) {
    const hw = 21 - (y - 96) / (PLEN - 96) * 10, e = hw - Math.abs(x);
    if (e > -2) d = (.55 + .3 * cyl(hw)) * Math.min(1, (e + 2) / 3);
  }
  return [Math.max(0, d), metal];
}
const hash = (a, b) => { let n = (a * 374761393 + b * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* 忽略 */ } };

/* ================= 页面 ================= */
export function openBoard({ list }) {
  const p = page({ app: 'settings', id: 'settings-board', title: '', back: true, cls: 'as-pb-page', right: navBtn('more', '更多', () => menu()) });
  p.body.classList.add('as-pb-body');
  const scene = buildScene();
  const head = h('div.as-pb__head', h('h1.as-pb__title', '连接'), h('div.as-pb__rule', h('i'), h('span', '✦'), h('i')), h('p.as-pb__sub', '拎起一根线，插进想用的接口'));
  const schemeChip = h('button.as-pb__scheme', { onclick: () => schemes() });
  head.appendChild(schemeChip);
  const grid = h('div.as-pb__grid');
  const panel = h('div.as-pb__panel', grid);
  const cordsBox = h('div.as-pb__cords');
  const cvs = h('canvas.as-pb__canvas', { 'aria-hidden': 'true' }), back = h('canvas.as-pb__canvas.is-back', { 'aria-hidden': 'true' });
  p.body.append(scene, back, head, panel, cordsBox, cvs);

  /* ----- 格子 ----- */
  let tiles = [];      // { c, kind, el, face, eyes, port }
  let quietUntil = 0;  // 刚拖完线，别把松手当成点格子
  const all = () => ['text', 'image', 'tts'].flatMap(k => (C()[k] || []).map(c => ({ c, kind: k })));
  const tileOf = id => tiles.find(t => t.c && t.c.id === id);
  function buildTiles() {
    grid.innerHTML = '';
    tiles = [...all(), { c: null, kind: null }].map(({ c, kind }) => {
      const eyes = h('b', FACE.idle), face = h('span.as-pb__face', eyes), port = h('span.as-pb__port', h('i'));
      const el = c
        ? h('div.as-pb__tile', { role: 'button', tabindex: 0, 'aria-label': `${c.name}，${KIND_NAME[kind]}接口`, dataset: { kind } },
          h('span.as-pb__kind', KIND_NAME[kind]), face, h('span.as-pb__name', c.name), h('span.as-pb__uses'), port)
        : h('div.as-pb__tile.is-add', { role: 'button', tabindex: 0, 'aria-label': '添加接口' }, h('span.as-pb__face', h('b', '+')), h('span.as-pb__name', '添加'), port);
      const t = { c, kind, el, face, eyes, port, blinkAt: performance.now() + 1500 + Math.random() * 4000, blinkUntil: 0, joyUntil: 0, near: 0 };
      el.addEventListener('click', () => { if (dragging() || performance.now() < quietUntil) return; c ? openDetail(c, kind) : addNew(); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
      grid.appendChild(el);
      return t;
    });
    syncUses();
  }
  /** 格子上写着「哪几根线插在我这」 */
  function syncUses() {
    for (const t of tiles) {
      if (!t.c) continue;
      const box = t.el.querySelector('.as-pb__uses'); box.innerHTML = '';
      CORDS.forEach((cd, i) => { if (C().defaults[cd.use] === t.c.id) box.appendChild(h('i', { style: { '--c': `rgb(${cd.ink})` } }, cd.label)); });
    }
    schemeChip.textContent = '方案：' + ((C().schemes || []).find(s => s.id === C().scheme) || { name: '当前接法' }).name + ' ▾';
  }
  const status = {};   // id → 'test' | 'ok' | 'bad'（这次打开页面里测出来的）
  const stOf = c => status[c.id] || (c.ok === true ? 'ok' : c.ok === false ? 'bad' : '');

  /* ----- 线（插头） ----- */
  const plugs = CORDS.map((cd, i) => ({ ...cd, i, x: 0, y: 0, vx: 0, vy: 0, tilt: 0, tv: 0, sway: 0, swayV: 0, mode: 'rest', target: null, prev: null, snapT: 0, from: null, grab: null, vis: 1, shake: 0 }));
  const B = () => p.body.getBoundingClientRect();
  const W = () => p.body.clientWidth, H = () => p.body.clientHeight;
  const restOf = pl => { const zt = cordsBox.offsetTop; return { x: W() * (pl.i + 1) / (CORDS.length + 1), y: zt + 26 }; };
  const anchorOf = pl => ({ x: W() * (pl.i + 1) / (CORDS.length + 1) + (pl.i - 1.5) * 18, y: H() + 50 });
  function portOf(t, pl) {
    const b = B(), r = t.port.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const same = plugs.filter(q => q.target === t.c?.id && q.mode !== 'drag'), k = Math.max(0, same.indexOf(pl)), n = Math.max(1, same.length);
    const x = r.left - b.left + r.width / 2 + (k - (n - 1) / 2) * 14;
    let y = r.top - b.top + 5; const hidden = y < pr.top - b.top - 10 || y > pr.bottom - b.top - 4;
    y = Math.max(pr.top - b.top - 10, Math.min(pr.bottom - b.top - 4, y));
    return { x, y, hidden };
  }
  function placePlugs(instant) {
    for (const pl of plugs) {
      const id = C().defaults[pl.use], t = id && tileOf(id);
      if (t && t.kind === pl.kind) { pl.mode = 'plugged'; pl.target = id; }
      else { pl.mode = 'rest'; pl.target = null; }
      if (instant) { const q = pl.mode === 'plugged' ? portOf(tileOf(pl.target), pl) : restOf(pl); pl.x = q.x; pl.y = q.y; }
    }
  }
  // 线下面的名字牌
  const cordLabels = plugs.map(pl => { const el = h('span.as-pb__cordtag', { style: { '--c': `rgb(${pl.ink})` } }, pl.label); cordsBox.appendChild(el); return el; });
  const cordHint = h('span.as-pb__cordhint'); cordsBox.appendChild(cordHint);
  function layoutLabels() {
    plugs.forEach((pl, i) => { const r = restOf(pl); cordLabels[i].style.left = r.x + 'px'; cordLabels[i].classList.toggle('is-away', pl.mode !== 'rest'); });
  }
  const dragging = () => plugs.some(pl => pl.mode === 'drag');
  const hitPlug = (x, y) => {
    for (let i = plugs.length - 1; i >= 0; i--) {
      const pl = plugs[i]; if (pl.mode === 'snap') continue;
      const dx = x - pl.x, dy = y - pl.y;
      if (Math.abs(dx) < 26 && dy > -14 && dy < PL + 14) return pl;
      // 插着的时候，也可以按在格子的接口口子上拎起来
      if (pl.mode === 'plugged') { const t = tileOf(pl.target); if (t) { const r = t.port.getBoundingClientRect(), b = B(); if (x > r.left - b.left - 10 && x < r.right - b.left + 10 && y > r.top - b.top - 12 && y < r.bottom - b.top + 12) return pl; } }
    }
    return null;
  };
  const local = e => { const b = B(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  p.body.addEventListener('pointerdown', e => {
    const q = local(e), pl = hitPlug(q.x, q.y);
    if (!pl) return;
    e.stopPropagation(); e.preventDefault();
    if (pl.mode === 'plugged') { pl.prev = pl.target; burst(pl.x, pl.y, 8, 'dust'); }
    pl.mode = 'drag'; pl.target = null; pl.grab = { id: e.pointerId, dx: pl.x - q.x, dy: pl.y - q.y, x: q.x, y: q.y };
    try { p.body.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    cordHint.textContent = `把「${pl.label}」插进一个${KIND_NAME[pl.kind]}接口`;
    vib(6); layoutLabels();
  }, true);
  p.body.addEventListener('pointermove', e => {
    const pl = plugs.find(x => x.mode === 'drag' && x.grab && x.grab.id === e.pointerId); if (!pl) return;
    const q = local(e); pl.grab.x = q.x; pl.grab.y = q.y;
  });
  const up = e => {
    const pl = plugs.find(x => x.mode === 'drag' && x.grab && x.grab.id === e.pointerId); if (!pl) return;
    pl.grab = null; cordHint.textContent = ''; quietUntil = performance.now() + 350;
    const t = nearTile(pl);
    if (t && !t.c) { backOrRest(pl); addNew(pl.kind); return; }
    if (t) snapTo(pl, t.c.id); else backOrRest(pl);
  };
  p.body.addEventListener('pointerup', up); p.body.addEventListener('pointercancel', up);
  function backOrRest(pl) { if (pl.prev && tileOf(pl.prev)) { snapTo(pl, pl.prev, true); } else { pl.mode = 'rest'; layoutLabels(); } }
  function snapTo(pl, id, back) { pl.mode = 'snap'; pl.target = id; pl.snapT = 0; pl.from = { x: pl.x, y: pl.y }; pl.back = !!back; }
  function nearTile(pl) {
    let best = null, bd = 64;
    for (const t of tiles) {
      if (t.c && t.kind !== pl.kind) continue;
      const q = portOf(t, pl); if (q.hidden) continue;
      const d = Math.hypot(q.x - pl.x, q.y - pl.y); if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  async function landed(pl) {
    const id = pl.target, t = tileOf(id), again = pl.back && C().defaults[pl.use] === id;
    pl.mode = 'plugged'; pl.prev = null; pl.back = false; pl.shake = 1; vib(18);
    burst(pl.x, pl.y, 20, 'spark'); layoutLabels();
    if (t) t.joyUntil = performance.now() + 900;
    if (again) return;
    C().defaults[pl.use] = id; C().scheme = ''; commit('connections'); syncUses();
    runTest(t.c, t.kind, pl);
  }
  async function runTest(c, kind, pl) {
    status[c.id] = 'test'; flowing = { pl: pl || plugs.find(x => x.target === c.id), until: performance.now() + 60000 };
    let ok = false, msg = '';
    try {
      if (kind === 'text') { await testConn(c); ok = true; }
      else { ok = !!(c.base && (keysOf(c).length || /localhost|127\.0\.0\.1/.test(c.base))); msg = ok ? '' : '还没填密钥'; }
    } catch (e) { msg = e.message || '连不上'; }
    status[c.id] = ok ? 'ok' : 'bad'; c.ok = ok; c.okAt = Date.now(); commit('connections');
    flowing = ok ? { pl: flowing && flowing.pl, until: performance.now() + 1200 } : null;
    if (!p.el.isConnected) return;
    const t = tileOf(c.id);
    if (ok) { if (t) t.joyUntil = performance.now() + 1100; const q = t && portOf(t, plugs[0]); if (q) burst(q.x, q.y - 40, 14, 'ok'); toast(`「${c.name}」连上了`); }
    else { const pq = plugs.find(x => x.target === c.id); if (pq) { pq.shake = 1.6; burst(pq.x, pq.y + 20, 22, 'bad'); } toast(`「${c.name}」连不上：${msg}`, { label: '查看日志', fn: () => shell.openApp('log') }); }
    return ok;
  }

  /* ----- 火花 ----- */
  let parts = [], flowing = null;
  function burst(x, y, n, k) {
    if (reduce) n = Math.ceil(n / 3);
    const ch = k === 'bad' ? ['x', '!', '×', '%'] : k === 'dust' ? ['.', ':', "'"] : ['*', '+', '.', '✦', 'o'];
    for (let i = 0; i < n; i++) {
      const a = k === 'spark' || k === 'ok' ? -Math.PI / 2 + (Math.random() - .5) * 2.8 : Math.random() * Math.PI * 2, v = 40 + Math.random() * (k === 'bad' ? 150 : 110);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5 + Math.random() * .6, t: 0, ch: ch[i % ch.length], k });
    }
  }

  /* ----- 小脸 ----- */
  function faces(now) {
    const dp = plugs.find(x => x.mode === 'drag');
    for (const t of tiles) {
      if (!t.c) { t.el.classList.toggle('is-near', !!dp && nearTile(dp) === t); continue; }
      const used = plugs.some(pl => pl.target === t.c.id && pl.mode === 'plugged');
      const st = stOf(t.c), compat = dp && dp.kind === t.kind, near = dp && nearTile(dp) === t;
      if (now > t.blinkAt) { t.blinkUntil = now + 140; t.blinkAt = now + 2200 + Math.random() * 4200; }
      let f, look = 0;
      if (now < t.joyUntil) f = 'joy';
      else if (status[t.c.id] === 'test') f = 'test';
      else if (dp && !compat) f = 'dim';
      else if (dp && compat) { f = 'curious'; const q = portOf(t, dp); look = Math.max(-1, Math.min(1, (dp.x - q.x) / 120)); }
      else if (used && st === 'bad') f = 'bad';
      else if (used && st === 'ok') f = 'ok';
      else if (used) f = 'plugged';
      else f = 'idle';
      if ((f === 'idle' || f === 'curious' || f === 'plugged') && now < t.blinkUntil) f = f === 'plugged' ? 'blink' : 'blink';
      const txt = FACE[f];
      if (t.eyes.textContent !== txt) t.eyes.textContent = txt;
      t.eyes.style.transform = `translateX(${(look * 3).toFixed(1)}px)`;
      t.el.dataset.face = f;
      t.el.classList.toggle('is-near', !!near); t.el.classList.toggle('is-dim', !!dp && !compat); t.el.classList.toggle('is-used', used);
    }
  }

  /* ----- 每一帧：物理 + 把线画成字符 ----- */
  const ctx = cvs.getContext('2d'), bctx = back.getContext('2d');
  let dpr = 1, cols = 0, rows = 0, dens = null, own = null, typ = null, raf = 0, last = performance.now(), alive = true, lastTick = -1, forceDraw = true;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [cvs, back]) { c.width = Math.round(W() * dpr); c.height = Math.round(H() * dpr); }
    cols = Math.ceil(W() / CW) + 1; rows = Math.ceil(H() / CH) + 1;
    dens = new Float32Array(cols * rows); own = new Uint8Array(cols * rows); typ = new Uint8Array(cols * rows);
  }
  const stamp = (x, y, d, o, ty) => {
    const cx = Math.floor(x / CW), cy = Math.floor(y / CH); if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const k = cy * cols + cx; if (d > dens[k]) { dens[k] = d; own[k] = o; typ[k] = ty; }
  };
  function step(now) {
    if (!alive) return;
    raf = requestAnimationFrame(step);
    if (!p.el.isConnected || (nav.top() && nav.top().el !== p.el)) { last = now; return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!dens || cvs.width !== Math.round(W() * dpr) || cvs.height !== Math.round(H() * dpr)) { resize(); layoutLabels(); forceDraw = true; }
    for (const pl of plugs) {
      let tx = null, ty = null;
      if (pl.mode === 'drag' && pl.grab) { tx = pl.grab.x + pl.grab.dx; ty = pl.grab.y + pl.grab.dy; }
      else if (pl.mode === 'plugged') { const t = tileOf(pl.target); if (!t) { pl.mode = 'rest'; continue; } const q = portOf(t, pl); tx = q.x; ty = q.y; }
      else if (pl.mode === 'snap') {
        const t = tileOf(pl.target); if (!t) { pl.mode = 'rest'; continue; }
        pl.snapT += dt / (reduce ? .08 : .2);
        const q = portOf(t, pl), e = Math.min(1, pl.snapT) ** 2.2;
        pl.x = pl.from.x + (q.x - pl.from.x) * e; pl.y = pl.from.y + (q.y - pl.from.y) * e;
        if (pl.snapT >= 1) landed(pl);
      } else { const r = restOf(pl); tx = r.x; ty = r.y + Math.sin(now / 900 + pl.i) * 2.5; }
      if (tx != null) {
        // 弹簧分小步算，掉帧时也不会「炸」
        const k = pl.mode === 'drag' ? 900 : pl.mode === 'plugged' ? 1500 : 120, damp = pl.mode === 'drag' ? 55 : pl.mode === 'plugged' ? 62 : 13;
        const nSub = Math.ceil(dt / .004), hh = dt / nSub;
        for (let j = 0; j < nSub; j++) { pl.vx += (-k * (pl.x - tx) - damp * pl.vx) * hh; pl.vy += (-k * (pl.y - ty) - damp * pl.vy) * hh; pl.x += pl.vx * hh; pl.y += pl.vy * hh; }
        if (!Number.isFinite(pl.x + pl.y + pl.vx + pl.vy)) { pl.x = tx; pl.y = ty; pl.vx = pl.vy = 0; }
      }
      const tiltT = pl.mode === 'drag' ? Math.max(-.4, Math.min(.4, pl.vx * .0016)) : 0;
      pl.tv += (-60 * (pl.tilt - tiltT) - 9 * pl.tv) * dt; pl.tilt += pl.tv * dt;
      pl.swayV += (-30 * (pl.sway - Math.max(-60, Math.min(60, pl.vx * .12))) - 4 * pl.swayV) * dt; pl.sway += pl.swayV * dt;
      if (!Number.isFinite(pl.tilt + pl.sway)) { pl.tilt = pl.tv = pl.sway = pl.swayV = 0; }
      pl.tilt = Math.max(-.6, Math.min(.6, pl.tilt)); pl.sway = Math.max(-80, Math.min(80, pl.sway));
      pl.shake = Math.max(0, pl.shake - dt * 3.5);
    }
    faces(now);
    // 两层：线和插好的插头在玻璃板后面（透过玻璃看是虚的），拎着的、还垂着的插头在最前面。
    // 省电：东西没在动的时候，只在字符闪一下的节拍上重画（一秒六次左右），不是每帧都画。
    const front = pl => pl.mode !== 'plugged';
    const tickNow = reduce ? 0 : Math.floor(now / 170);
    const moving = plugs.some(pl => pl.mode === 'drag' || pl.mode === 'snap' || pl.shake > 0 || Math.abs(pl.vx) + Math.abs(pl.vy) > 1.5 || Math.abs(pl.swayV) > .5)
      || (flowing && now < flowing.until) || parts.length > 0;
    if (moving || tickNow !== lastTick || forceDraw) {
      lastTick = tickNow; forceDraw = false;
      drawLayer(bctx, now, () => true, pl => !front(pl));
      drawLayer(ctx, now, () => false, front);
    } else return;
    const night = shell.phone && shell.phone.dataset.mode === 'night';
    parts = parts.filter(q => (q.t += dt) < q.life);
    for (const q of parts) {
      q.vy += (q.k === 'dust' ? 40 : 160) * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      const a = 1 - q.t / q.life;
      ctx.fillStyle = q.k === 'bad' ? `rgba(229,72,77,${a})` : q.k === 'ok' ? `rgba(48,190,120,${a})` : night ? `rgba(220,240,255,${a})` : `rgba(40,110,190,${a})`;
      ctx.fillText(q.ch, q.x, q.y);
    }
  }

  /** 把一层画成字符：cable(pl) 要不要画这根线，head(pl) 要不要画这个插头 */
  function drawLayer(ctx, now, cable, head) {
    dens.fill(0); own.fill(0); typ.fill(0);
    const order = [...plugs].sort((a, b) => (a.mode === 'drag') - (b.mode === 'drag'));
    for (const pl of order) {
      const doCable = cable(pl), doHead = head(pl);
      if (!doCable && !doHead) continue;
      const A = anchorOf(pl), c = Math.cos(pl.tilt), s = Math.sin(pl.tilt);
      const Bp = { x: pl.x - s * PL, y: pl.y + c * PL };
      const dist = Math.hypot(Bp.x - A.x, Bp.y - A.y), k = Math.min(220, dist * .42 + 30);
      const P1 = { x: A.x, y: A.y - k * .8 }, P2 = { x: Bp.x - s * k + pl.sway, y: Bp.y + c * k };
      const n = Math.min(500, Math.max(24, Math.ceil(dist / 3)));
      const flow = flowing && flowing.pl === pl && now < flowing.until;
      let px = A.x, py = A.y;
      if (doCable) for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const x = u * u * u * A.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * Bp.x, y = u * u * u * A.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * Bp.y;
        const ang = Math.atan2(y - py, x - px); px = x; py = y;
        const pulse = flow ? Math.max(0, 1 - Math.abs(((t * 2.4 - now / 600) % 1 + 1) % 1 - .5) * 8) : 0;
        for (const [o, a] of [[0, .82], [-4, .5], [4, .42], [-7, .14]]) stamp(x - Math.sin(ang) * o, y + Math.cos(ang) * o, Math.min(1, a + pulse * .5), pl.i + 1, pulse > .3 ? 2 : 0);
      }
      if (!doHead) continue;
      const sx = pl.shake ? (Math.random() - .5) * 5 * pl.shake : 0, X0 = pl.x + sx, Y0 = pl.y;
      const cs = Math.cos(-pl.tilt), sn = Math.sin(-pl.tilt);
      const x0 = Math.max(0, Math.floor((X0 - 40) / CW)), x1 = Math.min(cols - 1, Math.ceil((X0 + 40) / CW));
      const y0 = Math.max(0, Math.floor((Y0 - 20) / CH)), y1 = Math.min(rows - 1, Math.ceil((Y0 + PL + 20) / CH));
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const X = cx * CW + CW / 2 - X0, Y = cy * CH + CH / 2 - Y0;
        const [d, metal] = plugAt((X * cs - Y * sn) / SC, (X * sn + Y * cs) / SC);
        if (d <= 0) continue;
        const kk = cy * cols + cx; dens[kk] = d; own[kk] = pl.i + 1; typ[kk] = metal ? 1 : 0;
      }
      // 插头正面印着这根线的记号（@ % # S）
      const mx = Math.floor((X0 - s * PL * .5) / CW), my = Math.floor((Y0 + c * PL * .5) / CH);
      if (mx >= 0 && my >= 0 && mx < cols && my < rows) { const kk = my * cols + mx; dens[kk] = 1; own[kk] = pl.i + 1; typ[kk] = 3; }
    }
    const night = shell.phone && shell.phone.dataset.mode === 'night';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W(), H());
    ctx.globalAlpha = 1;
    ctx.font = `700 ${CH}px ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tick = reduce ? 0 : Math.floor(now / 170);
    for (let k = 0; k < dens.length; k++) {
      const d = dens[k]; if (d < .05) continue;
      const cd = plugs[own[k] - 1]; if (!cd) continue;
      const x = (k % cols) * CW + CW / 2, y = ((k / cols) | 0) * CH + CH / 2;
      const base = night ? cd.glow : cd.ink;
      if (d > .5) { ctx.fillStyle = `rgba(${base},${night ? .14 + (d - .5) * .4 : .12 + (d - .5) * .3})`; ctx.fillRect(x - CW / 2 + .5, y - CH / 2 + .5, CW - 1, CH - 1); }
      let ch, col = base, a = .35 + .65 * d;
      if (typ[k] === 3) { ch = cd.sym; col = night ? [255, 255, 255] : [255, 255, 255]; ctx.fillStyle = `rgba(${base},.95)`; ctx.fillRect(x - CW / 2 - 1, y - CH / 2 - 1, CW + 2, CH + 2); a = 1; }
      else if (typ[k] === 2) { ch = hash(k, tick) < .5 ? '0' : '1'; col = night ? [230, 255, 255] : [20, 60, 120]; a = 1; }
      else {
        const jit = hash(k, tick + ((hash(k, 7) * 9) | 0)) < .1 ? (hash(k, tick) < .5 ? -1 : 1) : 0;
        ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(d * (RAMP.length - 1)) + jit))];
        if (typ[k] === 1) col = night ? [235, 245, 255] : [120, 132, 156];
      }
      ctx.fillStyle = `rgba(${col},${a})`; ctx.fillText(ch, x, y + .5);
    }
  }

  /* ================= 接口详情 ================= */
  function addNew(kind) {
    const go = k => { const ch = CHANNELS[k][0]; openDetail({ id: uid('conn'), name: '', type: ch.v, base: ch.base, key: '', keys: [], model: '' }, k, true); };
    if (kind) return go(kind);
    actionSheet('添加什么接口？', [{ value: 'text', label: '文字（聊天、杂活用）' }, { value: 'image', label: '生图' }, { value: 'tts', label: '语音' }]).then(k => k && go(k));
  }
  function openDetail(orig, kind, isNew) {
    const d = JSON.parse(JSON.stringify(orig));
    d.keys = d.keys || []; d.params = Object.assign({ temperature: .9, thinking: 'off' }, d.params); d.adv = Object.assign({ cache: false }, d.adv);
    d.img = Object.assign({ size: '1024x1024', tags: '', neg: '' }, d.img); d.tts = Object.assign({ voice: '', speed: 1, volume: 1 }, d.tts);
    const tavern = d.type === 'tavern';
    let dirty = !!isNew;
    const savedTag = h('span.as-pbd__saved', isNew ? '还没保存' : '已保存');
    const touch = () => { dirty = true; savedTag.textContent = '有改动，记得保存'; savedTag.classList.add('is-dirty'); };
    const st = () => status[orig.id] || (orig.ok === true ? 'ok' : orig.ok === false ? 'bad' : '');
    const faceEl = h('span.as-pb__face.as-pbd__face', h('b', FACE[st() === 'ok' ? 'ok' : st() === 'bad' ? 'bad' : 'idle']));
    const stText = h('span.as-pbd__st');
    const paintSt = () => { const s = st(); stText.className = 'as-pbd__st is-' + (s || 'none'); stText.textContent = s === 'ok' ? '已连接' : s === 'bad' ? '连不上' : s === 'test' ? '正在测…' : '还没测过'; faceEl.firstChild.textContent = FACE[s === 'ok' ? 'ok' : s === 'bad' ? 'bad' : s === 'test' ? 'test' : 'idle']; };
    paintSt();
    const nameEl = h('b.as-pbd__name', d.name || (isNew ? '新接口' : ''));
    const subEl = h('span.as-pbd__subline');
    const paintSub = () => { subEl.textContent = tavern ? '跟着酒馆走，不用填密钥' : `${KIND_NAME[kind]} · ${d.model || '还没选模型'}`; };
    paintSub();
    const testBtn = h('button.as-pbd__test', { onclick: async () => {
      if (isNew || dirty) { toast('先保存，再测试'); return; }
      testBtn.disabled = true; status[orig.id] = 'test'; paintSt();
      await runTest(orig, kind); paintSt(); testBtn.disabled = false;
    } }, icon('sparkle', 14, 2), '测试');
    const card = h('div.as-pbd__card', faceEl, h('div.as-pbd__info', nameEl, subEl, stText), testBtn);

    // 可以折起来的一组：标题右边写着现在的值
    const fold = (title, ic, summary, build, open = false) => {
      const sum = h('span.as-pbd__sum', summary());
      const body = h('div.as-pbd__fbody'); let built = false;
      const box = h('div.as-pbd__fold' + (open ? '.is-open' : ''));
      const toggle = () => { if (!built) { build(body, () => { sum.textContent = summary(); }); built = true; } box.classList.toggle('is-open'); };
      if (open) { build(body, () => { sum.textContent = summary(); }); built = true; }
      box.append(h('button.as-pbd__fhead', { onclick: toggle, 'aria-expanded': String(open) }, icon(ic, 18, 1.8), h('span.as-pbd__ftitle', title), sum, h('span.as-pbd__chev', icon('chevron', 16, 2))), body);
      return box;
    };
    const row = (label, ctrl, hint) => h('div.as-pbd__row', h('span.as-pbd__label', label), h('div.as-pbd__ctrl', ctrl), hint && h('p.as-pbd__hint', hint));

    const groups = [];
    if (tavern) {
      groups.push(h('div.as-pbd__fold.is-open', h('div.as-pbd__fbody', h('p.as-pbd__hint', { style: { margin: 0 } }, '用酒馆此刻选中的 API 和模型生成；在酒馆里换了连接，这里就跟着变。温度这些也跟着酒馆的预设走。这个接口不能删。'))));
    } else {
      groups.push(fold('连接', 'link', () => `${(CHANNELS[kind].find(x => x.v === d.type) || {}).label || d.type} · ${keysOf(d).length} 把密钥`, (b, re) => {
        const nameIn = input({ value: d.name, placeholder: '随便起，方便自己认', onInput: v => { d.name = v; nameEl.textContent = v || '新接口'; touch(); } });
        const typeBtn = h('button.as-pbd__select', { onclick: async () => {
          const v = await actionSheet('类型', CHANNELS[kind].map(x => ({ value: x.v, label: x.label, active: x.v === d.type })));
          if (!v) return; const ch = CHANNELS[kind].find(x => x.v === v);
          if (!d.base || CHANNELS[kind].some(x => x.base === d.base)) { d.base = ch.base; baseIn.value = ch.base; }
          d.type = v; typeBtn.firstChild.textContent = ch.label; touch(); re();
        } }, h('span', (CHANNELS[kind].find(x => x.v === d.type) || {}).label || d.type), icon('chevron', 14, 2));
        const baseIn = input({ value: d.base, placeholder: 'https://…', onInput: v => { d.base = v; touch(); } });
        // 密钥：可以存好几把，被拒了自动换下一把
        const keyBox = h('div.as-pbd__keys');
        const drawKeys = () => {
          keyBox.innerHTML = '';
          const all = [d.key, ...d.keys];
          all.forEach((k, i) => {
            const inp = input({ value: k, placeholder: i ? '再一把密钥' : 'sk-…', type: 'password', onInput: v => { if (i === 0) d.key = v; else d.keys[i - 1] = v; touch(); re(); } });
            keyBox.appendChild(h('div.as-pbd__key', inp,
              i === (orig.keyIdx || 0) && k ? h('span.as-pbd__tag', '正在用') : null,
              h('button.as-pbd__ibtn', { 'aria-label': '显示密钥', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; } }, icon('info', 16, 1.8)),
              i ? h('button.as-pbd__ibtn', { 'aria-label': '删掉这把密钥', onclick: () => { d.keys.splice(i - 1, 1); touch(); drawKeys(); re(); } }, icon('close', 16, 2)) : null));
          });
          keyBox.appendChild(h('button.as-pbd__dash', { onclick: () => { d.keys.push(''); touch(); drawKeys(); } }, icon('plus', 15, 2), '再加一把密钥'));
        };
        drawKeys();
        const modelIn = input({ value: d.model, placeholder: kind === 'text' ? '例如 claude-opus' : kind === 'image' ? '例如 gpt-image-2' : '例如 tts-1', onInput: v => { d.model = v; paintSub(); touch(); } });
        const pull = h('button.as-pbd__mini', { onclick: async () => {
          pull.disabled = true;
          try {
            const models = await listModels(d);
            if (!models.length) { toast('没有拉到模型，可以手动填'); return; }
            const s = sheet({ title: `选择模型（${models.length}）`, content: h('div.as-settings-models', models.map(m => h('button.as-actions__item' + (m === d.model ? '.is-active' : ''), { onclick: () => { d.model = m; modelIn.value = m; paintSub(); touch(); s.close(); } }, h('span', m)))) });
          } catch (e) { toast('拉取失败：' + e.message); } finally { pull.disabled = false; }
        } }, icon('link', 13, 2), '拉取');
        b.append(row('名字', nameIn), row('类型', typeBtn), row('地址', baseIn), row('密钥', keyBox, '只存在这台设备上；导出数据时默认不带。有好几把的话，被拒或限流会自动换下一把。'),
          row('模型', h('div.as-pbd__line', modelIn, pull), '拉不到的话，直接在框里手动填。'));
      }, true));
      if (kind === 'text') {
        const T = [['off', '关'], ['low', '低'], ['medium', '中'], ['high', '高']];
        groups.push(fold('生成参数', 'gear', () => `${(+d.params.temperature).toFixed(2)} · 推理${(T.find(x => x[0] === d.params.thinking) || T[0])[1]}`, (b, re) => {
          const out = h('output.as-pbd__val', (+d.params.temperature).toFixed(2));
          const sl = slider({ min: 0, max: 2, step: .05, value: d.params.temperature, onInput: v => { d.params.temperature = v; out.textContent = v.toFixed(2); chips(); touch(); re(); } });
          const chipBox = h('div.as-pbd__chips');
          const chips = () => { chipBox.innerHTML = ''; [0, .3, .7, 1, 1.3].forEach(v => chipBox.appendChild(h('button' + (Math.abs(d.params.temperature - v) < .001 ? '.is-on' : ''), { onclick: () => { d.params.temperature = v; sl.value = v; out.textContent = v.toFixed(2); chips(); touch(); re(); } }, v.toFixed(1)))); };
          chips();
          b.append(row('温度', h('div.as-pbd__line', sl, out), '越低越稳，越高越放飞。单个聊天里还能另外设。'), chipBox,
            row('推理深度', segmented(T, d.params.thinking, v => { d.params.thinking = v; touch(); re(); }), '开了会先想一想再回，更聪明但更慢、更贵。模型不支持的话会报错，关掉就好。'));
        }));
        if (d.type === 'claude') groups.push(fold('高级', 'list', () => d.adv.cache ? '缓存开' : '缓存关', (b, re) => {
          b.append(h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '提示词缓存'), switchEl(d.adv.cache, v => { d.adv.cache = v; touch(); re(); }, '提示词缓存')),
            h('p.as-pbd__hint', '每次都一样的人设、设定会走缓存，按便宜很多的缓存价算，回得也更快。'));
        }));
      }
      if (kind === 'image') groups.push(fold('画风', 'image', () => `${d.img.size}${d.img.tags ? ' · 有画师串' : ''}`, (b, re) => {
        b.append(row('尺寸', segmented([['1024x1024', '方'], ['1024x1536', '竖'], ['1536x1024', '横']], d.img.size, v => { d.img.size = v; touch(); re(); })),
          row('画师串 / 风格词', textarea({ value: d.img.tags, rows: 2, placeholder: '例：masterpiece, soft light, by [artist]', onInput: v => { d.img.tags = v; touch(); re(); } }), '会加在每张图的描述前面。'),
          row('不要出现', textarea({ value: d.img.neg, rows: 2, placeholder: '例：lowres, bad anatomy', onInput: v => { d.img.neg = v; touch(); } })));
      }));
      if (kind === 'tts') groups.push(fold('声音', 'mic', () => `${d.tts.voice || '默认音色'} · ${d.tts.speed}x`, (b, re) => {
        const sp = h('output.as-pbd__val', d.tts.speed + 'x'), vo = h('output.as-pbd__val', Math.round(d.tts.volume * 100) + '%');
        b.append(row('音色', input({ value: d.tts.voice, placeholder: '例如 alloy、nova', onInput: v => { d.tts.voice = v; touch(); re(); } })),
          row('语速', h('div.as-pbd__line', slider({ min: .5, max: 2, step: .05, value: d.tts.speed, onInput: v => { d.tts.speed = +v.toFixed(2); sp.textContent = d.tts.speed + 'x'; touch(); re(); } }), sp)),
          row('音量', h('div.as-pbd__line', slider({ min: .2, max: 1, step: .05, value: d.tts.volume, onInput: v => { d.tts.volume = v; vo.textContent = Math.round(v * 100) + '%'; touch(); } }), vo)));
      }));
      if (!isNew) groups.push(h('div.as-pbd__danger',
        h('button', { onclick: () => { const cp = { ...JSON.parse(JSON.stringify(d)), id: uid('conn'), name: (d.name || orig.name) + ' 副本', ok: undefined }; C()[kind].push(cp); commit('connections'); s.close(); toast('复制好了'); } }, '复制一份'),
        h('button.is-danger', { onclick: async () => {
          if (!(await dialog({ title: `删掉「${orig.name}」？`, text: '插在它上面的线会被拔下来。', confirm: '删除', danger: true }))) return;
          const list = C()[kind]; list.splice(list.indexOf(orig), 1);
          for (const k of Object.keys(C().defaults)) if (C().defaults[k] === orig.id) C().defaults[k] = '';
          commit('connections'); s.close(); refresh();
        } }, '删除这个接口')));
    }
    const save = h('button.as-pbd__save', { onclick: () => {
      if (tavern) { s.close(); return; }
      d.name = (d.name || '').trim() || `${(CHANNELS[kind].find(x => x.v === d.type) || {}).label} ${d.model || ''}`.trim();
      d.keys = d.keys.filter(k => String(k).trim());
      if (isNew) { C()[kind].push(d); if (!C().defaults[kind]) C().defaults[kind] = d.id; }
      else { const keyChanged = JSON.stringify([orig.base, orig.key, orig.keys, orig.model, orig.type]) !== JSON.stringify([d.base, d.key, d.keys, d.model, d.type]); Object.assign(orig, d); if (keyChanged) { delete orig.ok; delete status[orig.id]; } }
      commit('connections'); dirty = false; savedTag.textContent = '已保存'; savedTag.classList.remove('is-dirty');
      toast('保存好了'); s.close(); refresh();
    } }, tavern ? '好的' : '保存');
    const s = sheet({ title: '接口详情', cls: 'as-pbd', content: h('div.as-pbd__wrap', card, ...groups, h('div.as-pbd__bar', savedTag, save)), onClose: () => { if (dirty && !isNew) toast('改动没保存'); } });
  }

  /* ================= 右上角菜单 ================= */
  async function menu() {
    const v = await actionSheet('连接', [
      { value: 'scheme', label: '接线方案（整套接法存起来、一键换）' },
      { value: 'retry', label: '断线了怎么办' },
      { value: 'add', label: '添加接口' },
      { value: 'list', label: '列表模式' }]);
    if (v === 'scheme') schemes();
    if (v === 'retry') retrySheet();
    if (v === 'add') addNew();
    if (v === 'list') list();
  }
  function retrySheet() {
    const R = C().retry;
    const box = h('div.as-pbd__wrap',
      h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '失败了自动重试'), switchEl(R.on, v => { R.on = v; commit('connections'); }, '失败自动重试')),
      h('div.as-pbd__row', h('span.as-pbd__label', '最多重试'), h('div.as-pbd__ctrl', segmented([['1', '1 次（建议）'], ['2', '2 次'], ['3', '3 次']], String(R.max || 1), v => { R.max = +v; commit('connections'); }))),
      h('p.as-pbd__hint', '付费接口按字数算钱，重试也算。只在网络出错、服务器忙的时候重试，密钥不对不会白白重试。'),
      h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '聊天线断了，改用杂活接口'), switchEl(R.fallback, v => { R.fallback = v; commit('connections'); }, '聊天线断了改用杂活接口')),
      h('p.as-pbd__hint', '要先把「杂活」线插在一个接口上才有用。'));
    sheet({ title: '断线了怎么办', cls: 'as-pbd', content: box });
  }
  function schemes() {
    const list = C().schemes;
    const draw = () => {
      box.innerHTML = '';
      if (!list.length) box.appendChild(h('p.as-pbd__hint', '还没有方案。把现在每根线插在哪存成一个方案，以后点一下就整套换过去。'));
      list.forEach(sc => box.appendChild(h('div.as-pbd__scheme' + (C().scheme === sc.id ? '.is-on' : ''),
        h('button.as-pbd__scheme-main', { onclick: () => applyScheme(sc) }, h('b', sc.name), h('span', CORDS.map(cd => { const c = (C()[cd.kind] || []).find(x => x.id === sc.map[cd.use]); return c ? `${cd.label}→${c.name}` : null; }).filter(Boolean).join('　') || '全部没插')),
        h('button.as-pbd__ibtn', { 'aria-label': '删掉这个方案', onclick: async () => { if (!(await dialog({ title: `删掉方案「${sc.name}」？`, confirm: '删除', danger: true }))) return; list.splice(list.indexOf(sc), 1); if (C().scheme === sc.id) C().scheme = ''; commit('connections'); draw(); syncUses(); } }, icon('trash', 16, 1.8)))));
      box.appendChild(h('button.as-pbd__dash', { onclick: async () => {
        const name = await dialog({ title: '存成方案', text: '起个名字，比如「九十」「省钱版」', input: { placeholder: '方案名字' } });
        if (!name) return;
        const sc = { id: uid('sch'), name: String(name).slice(0, 16), map: Object.fromEntries(CORDS.map(cd => [cd.use, C().defaults[cd.use] || ''])) };
        list.push(sc); C().scheme = sc.id; commit('connections'); draw(); syncUses(); toast('存好了');
      } }, icon('plus', 15, 2), '把现在的接法存成方案'));
    };
    const box = h('div.as-pbd__wrap');
    const s = sheet({ title: '接线方案', cls: 'as-pbd', content: box });
    function applyScheme(sc) {
      for (const cd of CORDS) C().defaults[cd.use] = sc.map[cd.use] || '';
      C().scheme = sc.id; commit('connections'); s.close();
      // 线一根根换过去：先拔下来，再飞到新接口
      plugs.forEach((pl, i) => { setTimeout(() => { const id = C().defaults[pl.use]; if (id && tileOf(id)) snapTo(pl, id, true); else { pl.mode = 'rest'; pl.target = null; } layoutLabels(); syncUses(); }, i * 140); });
      toast(`换成「${sc.name}」`);
    }
    draw();
  }

  /* ----- 刷新（加 / 删 / 改了接口之后） ----- */
  function refresh() { buildTiles(); requestAnimationFrame(() => { placePlugs(false); layoutLabels(); }); }
  p.el._onShow = refresh;
  nav.push(p.el);
  buildTiles();
  requestAnimationFrame(() => { resize(); placePlugs(true); layoutLabels(); last = performance.now(); raf = requestAnimationFrame(step); });
  const mo = new MutationObserver(() => { if (!p.el.isConnected && p.el._wasIn) { alive = false; cancelAnimationFrame(raf); mo.disconnect(); } if (p.el.isConnected) p.el._wasIn = true; });
  setTimeout(() => { p.el._wasIn = p.el.isConnected; if (p.el.parentNode) mo.observe(p.el.parentNode, { childList: true }); }, 0);
  return p;
}
