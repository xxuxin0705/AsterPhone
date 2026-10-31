// 连接 · 插线板：上面一排亚克力 API 模块（左右滑），下面一根 ASCII 字符拼成的插头。
// 按住插头往上拖，插进哪个模块的插孔，这个用途（聊天 / 生图 / 语音）就用哪个连接。
// 插中时「咔哒」吸进去，模块的灯：绿 = 连上了，红 = 连不上，琥珀色闪 = 正在测。
import { h } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, navBtn, segmented, toast, actionSheet, icon } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { CHANNELS, testConn } from '../../core/api.js';
import { shell } from '../../core/shell.js';

const KINDS = [['text', '聊天'], ['image', '生图'], ['tts', '语音']];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- ASCII 插头的形状：局部坐标，插头尖在 (0,0)，往下是身体 ---------- */
const PLEN = 128;                          // 插头总长（到线的接口），形状单位
const SC = 1.3, PL = PLEN * SC;            // 画出来放大 1.3 倍
const CW = 7, CH = 10;                     // 一个字符格子的宽高（CSS 像素）
const RAMP = ['.', "'", ':', 'o', 't', 'x', ';', '%', 'S', 'X', '8', '#', '@'];
const sdRound = (x, y, hw, y0, y1, r) => {   // 圆角矩形的「有向距离」：<0 在里面
  const cx = Math.abs(x) - (hw - r), cy = Math.max(y0 + r - y, y - (y1 - r));
  const ox = Math.max(cx, 0), oy = Math.max(cy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(cx, cy), 0) - r;
};
/** 插头某一点有多「密」（0~1），以及是不是金属头 */
function plugAt(x, y) {
  if (y < -4 || y > PLEN + 4 || Math.abs(x) > 34) return [0, 0];
  const cyl = hw => 1 - Math.min(1, ((x + hw * .35) / hw) ** 2);   // 左上打光的圆柱明暗
  let d = 0, metal = 0, s;
  if ((s = sdRound(x, y, 15, 0, 26, 6)) < 2) { d = .42 + .42 * cyl(15); metal = 1; d *= Math.min(1, (2 - s) / 3); }
  else if ((s = sdRound(x, y, 20, 26, 33, 2)) < 2) { d = .95 * Math.min(1, (2 - s) / 3); }
  else if ((s = sdRound(x, y, 27, 33, 98, 11)) < 2) {
    d = .62 + .3 * cyl(27);
    if ((y - 40) % 13 < 3 && y > 44 && y < 92) d *= .55;   // 防滑纹
    d *= Math.min(1, (2 - s) / 3);
  } else if (y >= 96 && y <= PLEN) {
    const hw = 21 - (y - 96) / (PLEN - 96) * 10, e = hw - Math.abs(x);
    if (e > -2) d = (.55 + .3 * cyl(hw)) * Math.min(1, (e + 2) / 3);
  }
  return [Math.max(0, d), metal];
}
const hash = (a, b) => { let n = (a * 374761393 + b * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };

/* ---------- 页面 ---------- */
export function openPlugboard({ edit, list }) {
  let kind = 'text';
  const p = page({ app: 'settings', id: 'settings-plugboard', title: '连接', back: true, cls: 'as-plug-page', right: navBtn('list', '列表模式', list) });
  p.body.classList.add('as-plug-body');
  const stage = h('div.as-plug');
  const cvs = h('canvas.as-plug__canvas', { 'aria-hidden': 'true' });
  const rail = h('div.as-plug__rail', { 'aria-label': '接口，左右滑动挑选', dataset: { noSwipe: '' } });
  const hint = h('div.as-plug__hint');
  const infoName = h('b'), infoSub = h('span');
  const info = h('div.as-plug__info', h('div.as-plug__info-text', infoName, infoSub),
    h('div.as-plug__info-btns', h('button.as-plug__pill', { onclick: () => center() && openEdit(center()) }, icon('gear', 15, 2), '设置'),
      h('button.as-plug__pill', { onclick: () => center() && runTest(center()) }, icon('link', 15, 2), '测试')));
  const tabsBox = h('div.as-plug__tabs', h('span.as-plug__tabs-label', '这根线给'));
  stage.append(cvs, rail, info, hint, tabsBox);
  p.body.append(stage);

  /* ----- 数据 ----- */
  const conns = () => state.connections[kind] || [];
  const plugged = () => conns().find(c => c.id === state.connections.defaults[kind]) || null;
  let mods = [];        // [{ c|null, el, led }]
  const center = () => (mods[Math.round(pos)] || {}).c || null;
  const ledState = {};  // id → 'ok' | 'bad' | 'test'
  const ledOf = c => ledState[c.id] || (c.ok === true ? 'ok' : c.ok === false ? 'bad' : '');
  const openEdit = c => edit(c, kind);
  const typeLabel = c => c.type === 'tavern' ? '酒馆当前连接' : ((CHANNELS[kind] || []).find(x => x.v === c.type) || {}).label || c.type;
  const glyph = c => c.type === 'tavern' ? '酒' : c.type === 'claude' ? '✳' : c.type === 'gemini' ? '✦' : (c.name || '?').trim().slice(0, 1).toUpperCase();
  const hue = c => c.type === 'tavern' ? 'amber' : c.type === 'claude' ? 'coral' : c.type === 'gemini' ? 'violet' : kind === 'image' ? 'violet' : kind === 'tts' ? 'mint' : 'blue';

  function buildMods() {
    rail.innerHTML = '';
    mods = [...conns().map(c => ({ c })), { c: null }].map(m => {
      const led = h('i.as-plug__led');
      const el = m.c
        ? h('button.as-plug__mod', { 'aria-label': m.c.name, dataset: { hue: hue(m.c) } },
          h('i.as-plug__screw'), h('i.as-plug__screw'), h('i.as-plug__screw'), h('i.as-plug__screw'), led,
          h('span.as-plug__logo', glyph(m.c)), h('span.as-plug__name', m.c.name), h('span.as-plug__type', typeLabel(m.c)),
          h('span.as-plug__socket', h('i')))
        : h('button.as-plug__mod.is-add', { 'aria-label': '添加接口' }, h('span.as-plug__logo', icon('plus', 26, 2)), h('span.as-plug__name', '添加接口'), h('span.as-plug__type', '新建一个连接'));
      rail.appendChild(el);
      return { ...m, el, led };
    });
    syncLeds();
  }
  function syncLeds() {
    const pc = plugged();
    for (const m of mods) {
      if (!m.c) continue;
      const on = pc && pc.id === m.c.id, st = on ? ledOf(m.c) || 'idle' : '';
      m.led.className = 'as-plug__led' + (st ? ' is-' + st : '');
      m.el.classList.toggle('is-plugged', !!on);
    }
  }
  function syncInfo() {
    const c = center(), pc = plugged();
    info.classList.toggle('is-hidden', !c);
    if (c) { infoName.textContent = c.name; infoSub.textContent = c.type === 'tavern' ? '跟着酒馆走，不用填密钥' : `${typeLabel(c)} · ${c.model || '未选模型'}`; }
    hint.textContent = !conns().length ? `还没有${KINDS.find(k => k[0] === kind)[1]}的接口，先点「添加接口」`
      : plug.mode === 'drag' ? '往上拖，对准插孔松手'
        : pc ? `插在「${pc.name}」· 拔出来可以换` : '按住插头，往上插进想用的接口';
  }

  /* ----- 轮播 ----- */
  const SP = 172;                // 两个模块中心的间距
  let pos = 0, posV = 0, posTarget = 0, railDrag = null;
  const W = () => stage.clientWidth, H = () => stage.clientHeight;
  const RAIL_TOP = 34, MOD_H = 196;
  function modGeo(i) {
    const d = i - pos, a = Math.min(Math.abs(d), 1.4);
    const s = 1 - .17 * a, x = W() / 2 + d * SP * (1 - .08 * a);
    return { x, y: RAIL_TOP + MOD_H / 2, s, d };
  }
  const socketOf = i => { const g = modGeo(i); return { x: g.x, y: g.y + 74 * g.s, s: g.s }; };
  function layoutMods() {
    mods.forEach((m, i) => {
      const g = modGeo(i);
      m.el.style.transform = `translate(${g.x - W() / 2}px, 0) scale(${g.s})`;
      m.el.style.zIndex = String(100 - Math.round(Math.abs(g.d) * 10));
      m.el.style.opacity = String(Math.max(0, 1 - Math.max(0, Math.abs(g.d) - .6) * .7));
      m.el.classList.toggle('is-center', Math.abs(g.d) < .5);
    });
  }
  rail.addEventListener('pointerdown', e => {
    e.stopPropagation();
    railDrag = { id: e.pointerId, x0: e.clientX, p0: pos, t: performance.now(), lx: e.clientX, v: 0, moved: false };
    try { rail.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });
  rail.addEventListener('pointermove', e => {
    if (!railDrag || e.pointerId !== railDrag.id) return;
    const dx = e.clientX - railDrag.x0, now = performance.now();
    if (Math.abs(dx) > 6) railDrag.moved = true;
    railDrag.v = (e.clientX - railDrag.lx) / Math.max(1, now - railDrag.t); railDrag.lx = e.clientX; railDrag.t = now;
    pos = Math.max(-.35, Math.min(mods.length - .65, railDrag.p0 - dx / SP)); posTarget = pos; posV = 0;
  });
  const railUp = e => {
    if (!railDrag || e.pointerId !== railDrag.id) return;
    const r = railDrag; railDrag = null;
    if (!r.moved) {   // 点一下：点中间的 = 打开设置 / 添加；点旁边的 = 滑过去
      const m = mods.findIndex(x => x.el.contains(e.target));
      if (m < 0) return;
      if (m !== Math.round(pos)) { posTarget = m; return; }
      if (mods[m].c) moduleMenu(mods[m].c); else openEdit(null);
      return;
    }
    posTarget = Math.max(0, Math.min(mods.length - 1, Math.round(pos - r.v * 2.2)));
  };
  rail.addEventListener('pointerup', railUp); rail.addEventListener('pointercancel', railUp);
  async function moduleMenu(c) {
    const pc = plugged();
    const v = await actionSheet(c.name, [
      ...(pc && pc.id === c.id ? [] : [{ value: 'plug', label: '插到这里（不想拖的话点这个）' }]),
      { value: 'test', label: '测试连接' }, { value: 'edit', label: '设置（地址、密钥、模型）' }]);
    if (v === 'plug') { plug.mode = 'snap'; plug.snapTo = mods.findIndex(m => m.c === c); plug.snapT = 0; plug.from = { x: plug.x, y: plug.y }; }
    if (v === 'test') runTest(c);
    if (v === 'edit') openEdit(c);
  }

  /* ----- 插头 ----- */
  const plug = { x: 0, y: 0, vx: 0, vy: 0, tilt: 0, tv: 0, mode: 'rest', grab: null, snapTo: -1, snapT: 0, from: null, prev: -1, vis: 0, sway: 0, swayV: 0, shake: 0 };
  const restPos = () => ({ x: W() / 2, y: H() - 330 });
  const anchor = () => ({ x: W() * .62, y: H() + 40 });
  function placePlug(instant) {
    const pi = mods.findIndex(m => m.c && plugged() && m.c.id === plugged().id);
    if (pi >= 0) { plug.mode = 'plugged'; plug.snapTo = pi; const s = socketOf(pi); if (instant) { plug.x = s.x; plug.y = s.y - 8; } }
    else { plug.mode = 'rest'; plug.snapTo = -1; if (instant) Object.assign(plug, restPos()); }
  }
  const hitPlug = (x, y) => {
    const c = Math.cos(-plug.tilt), s = Math.sin(-plug.tilt), dx = x - plug.x, dy = y - plug.y;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return Math.abs(lx) < 50 && ly > -16 && ly < PL + 20;
  };
  const stagePt = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.as-plug__rail, .as-plug__info, .as-plug__tabs')) return;
    const q = stagePt(e);
    if (!hitPlug(q.x, q.y) || plug.mode === 'snap') return;
    e.stopPropagation(); e.preventDefault();
    if (plug.mode === 'plugged') { plug.prev = plug.snapTo; burst(plug.x, plug.y, 10, 'dust'); }
    plug.mode = 'drag'; plug.grab = { id: e.pointerId, dx: plug.x - q.x, dy: plug.y - q.y, x: q.x, y: q.y };
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    syncLeds(); syncInfo(); vib(6);
  });
  stage.addEventListener('pointermove', e => {
    if (plug.mode !== 'drag' || !plug.grab || e.pointerId !== plug.grab.id) return;
    const q = stagePt(e); plug.grab.x = q.x; plug.grab.y = q.y;
  });
  const plugUp = e => {
    if (plug.mode !== 'drag' || !plug.grab || e.pointerId !== plug.grab.id) return;
    plug.grab = null;
    const t = nearSocket();
    if (t >= 0) {
      if (!mods[t].c) { plug.mode = 'rest'; openEdit(null); syncInfo(); return; }
      plug.mode = 'snap'; plug.snapTo = t; plug.snapT = 0; plug.from = { x: plug.x, y: plug.y };
    } else if (plug.prev >= 0 && mods[plug.prev]) { plug.mode = 'snap'; plug.snapTo = plug.prev; plug.snapT = 0; plug.from = { x: plug.x, y: plug.y }; plug.back = true; }
    else plug.mode = 'rest';
    syncInfo();
  };
  stage.addEventListener('pointerup', plugUp); stage.addEventListener('pointercancel', plugUp);
  function nearSocket() {
    let best = -1, bd = 70;
    mods.forEach((m, i) => { const s = socketOf(i); const d = Math.hypot(s.x - plug.x, s.y - plug.y); if (d < bd && Math.abs(i - pos) < .8) { bd = d; best = i; } });
    return best;
  }
  const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* 忽略 */ } };

  /** 插中了：记下来、测一测 */
  async function landed(i) {
    const c = mods[i].c, again = plug.back; plug.back = false; plug.prev = -1;
    plug.mode = 'plugged'; plug.shake = 1; vib(18);
    const s = socketOf(i); burst(s.x, s.y - 4, 22, 'spark');
    if (again && state.connections.defaults[kind] === c.id) { syncLeds(); syncInfo(); return; }
    state.connections.defaults[kind] = c.id; commit('connections');
    syncLeds(); syncInfo();
    runTest(c);
  }
  async function runTest(c) {
    ledState[c.id] = 'test'; syncLeds(); flowing = 2.2;
    let ok = false, msg = '';
    try {
      if (kind === 'text') { await testConn(c); ok = true; }
      else { ok = !!(c.base && (c.key || /localhost|127\.0\.0\.1/.test(c.base))); msg = ok ? '' : '还没填密钥'; }
    } catch (e) { msg = e.message || '连不上'; }
    delete ledState[c.id]; c.ok = ok; c.okAt = Date.now(); commit('connections');
    syncLeds();
    if (!stage.isConnected) return;
    const i = mods.findIndex(m => m.c === c);
    if (ok) { flowing = Math.max(flowing, 1.2); if (i >= 0) { const s = socketOf(i); burst(s.x, s.y - 10, 16, 'ok'); } toast(`「${c.name}」连上了`); }
    else { if (i >= 0 && plug.mode === 'plugged' && plug.snapTo === i) { plug.shake = 1.6; burst(plug.x, plug.y + 30, 26, 'bad'); } toast(`连不上：${msg}`, { label: '查看日志', fn: () => shell.openApp('log') }); }
  }

  /* ----- 小火花 / 数据流 ----- */
  let parts = [], flowing = 0, flowT = 0;
  function burst(x, y, n, kindP) {
    if (reduce) n = Math.ceil(n / 3);
    const ch = kindP === 'bad' ? ['x', '!', '×', '%'] : kindP === 'dust' ? ['.', ':', "'"] : ['*', '+', '.', '✦', 'o'];
    for (let i = 0; i < n; i++) {
      const a = kindP === 'spark' || kindP === 'ok' ? -Math.PI / 2 + (Math.random() - .5) * 2.6 : Math.random() * Math.PI * 2, v = 40 + Math.random() * (kindP === 'bad' ? 160 : 120);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5 + Math.random() * .6, t: 0, ch: ch[i % ch.length], k: kindP });
    }
  }

  /* ----- 每一帧 ----- */
  const ctx = cvs.getContext('2d');
  let raf = 0, last = performance.now(), dpr = 1, cols = 0, rows = 0, dens = null, tint = null, alive = true;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    cvs.width = Math.round(W() * dpr); cvs.height = Math.round(H() * dpr);
    cols = Math.ceil(W() / CW) + 1; rows = Math.ceil(H() / CH) + 1;
    dens = new Float32Array(cols * rows); tint = new Uint8Array(cols * rows);
  }
  const stamp = (x, y, d, tn) => {
    const cx = Math.floor(x / CW), cy = Math.floor(y / CH);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const k = cy * cols + cx;
    if (d > dens[k]) { dens[k] = d; tint[k] = tn; }
  };
  function cablePts() {
    const A = anchor(), c = Math.cos(plug.tilt), s = Math.sin(plug.tilt);
    const B = { x: plug.x - s * PL, y: plug.y + c * PL };
    const dist = Math.hypot(B.x - A.x, B.y - A.y), k = Math.min(260, dist * .45 + 40);
    const P1 = { x: A.x - W() * .32, y: A.y - k * .8 }, P2 = { x: B.x - s * k + plug.sway, y: B.y + c * k };   // 线从底下绕个弯上来
    const pts = [], n = Math.max(30, Math.ceil(dist / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push({ x: u * u * u * A.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * B.x, y: u * u * u * A.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * B.y, t });
    }
    return pts;
  }
  function step(now) {
    if (!alive) return;
    // 被盖在别的页面下面时不画（省电）
    if (!stage.isConnected || (nav.top() && nav.top().el !== p.el)) { last = now; raf = requestAnimationFrame(step); return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (cvs.width !== Math.round(W() * dpr) || !dens) resize();
    // 轮播回弹
    if (!railDrag) { const f = -170 * (pos - posTarget) - 24 * posV; posV += f * dt; pos += posV * dt; }
    layoutMods();
    const ci = Math.round(pos); if (ci !== lastCenter) { lastCenter = ci; syncInfo(); }
    // 插头
    let tx, ty;
    if (plug.mode === 'drag' && plug.grab) { tx = plug.grab.x + plug.grab.dx; ty = plug.grab.y + plug.grab.dy; }
    else if (plug.mode === 'plugged' && mods[plug.snapTo]) { const s = socketOf(plug.snapTo); tx = s.x; ty = s.y - 8; }
    else if (plug.mode === 'snap' && mods[plug.snapTo]) {
      plug.snapT += dt / (reduce ? .08 : .2);
      const s = socketOf(plug.snapTo), e = Math.min(1, plug.snapT) ** 2.2;   // 越靠近吸得越快
      plug.x = plug.from.x + (s.x - plug.from.x) * e; plug.y = plug.from.y + (s.y - 8 - plug.from.y) * e - Math.sin(Math.min(1, plug.snapT) * Math.PI) * 4;
      if (plug.snapT >= 1) { plug.y = s.y - 16; landed(plug.snapTo); }
    } else { const r = restPos(); tx = r.x; ty = r.y + Math.sin(now / 900) * 3; }
    if (tx != null) {
      const k = plug.mode === 'drag' ? 900 : plug.mode === 'plugged' ? 1400 : 120, damp = plug.mode === 'drag' ? 55 : plug.mode === 'plugged' ? 60 : 13;
      plug.vx += (-k * (plug.x - tx) - damp * plug.vx) * dt; plug.vy += (-k * (plug.y - ty) - damp * plug.vy) * dt;
      plug.x += plug.vx * dt; plug.y += plug.vy * dt;
    }
    const tiltT = plug.mode === 'drag' ? Math.max(-.4, Math.min(.4, plug.vx * .0016)) : 0;
    plug.tv += (-60 * (plug.tilt - tiltT) - 9 * plug.tv) * dt; plug.tilt += plug.tv * dt;
    plug.swayV += (-30 * (plug.sway - plug.vx * .12) - 4 * plug.swayV) * dt; plug.sway += plug.swayV * dt;
    plug.vis = Math.min(1, plug.vis + dt * 2.4);
    plug.shake = Math.max(0, plug.shake - dt * 3.5);
    // 光栅化：插头和线拼成一格一格的字符
    dens.fill(0); tint.fill(0);
    const cs = Math.cos(-plug.tilt), sn = Math.sin(-plug.tilt);
    const sx = plug.shake ? (Math.random() - .5) * 5 * plug.shake : 0;
    const px = plug.x + sx, py = plug.y;
    const x0 = Math.max(0, Math.floor((px - 90) / CW)), x1 = Math.min(cols - 1, Math.ceil((px + 90) / CW));
    const y0 = Math.max(0, Math.floor((py - 90) / CH)), y1 = Math.min(rows - 1, Math.ceil((py + PL + 90) / CH));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const X = cx * CW + CW / 2 - px, Y = cy * CH + CH / 2 - py;
      const [d, metal] = plugAt((X * cs - Y * sn) / SC, (X * sn + Y * cs) / SC);
      if (d <= 0) continue;
      if (hash(cx, cy) > plug.vis) continue;
      const k = cy * cols + cx; if (d > dens[k]) { dens[k] = d; tint[k] = metal ? 1 : 0; }
    }
    const pts = cablePts();
    flowT += dt; flowing = Math.max(0, flowing - dt);
    for (let i = 0; i < pts.length; i += 1) {
      const q = pts[i], pulse = flowing > 0 ? Math.max(0, 1 - Math.abs(((q.t * 2.2 - flowT * 1.6) % 1 + 1) % 1 - .5) * 9) : 0;
      for (const [o, a] of [[0, .9], [-5, .66], [5, .55], [-9, .3], [9, .24], [-13, .08]]) {
        const ang = i < pts.length - 1 ? Math.atan2(pts[i + 1].y - q.y, pts[i + 1].x - q.x) : 0;
        stamp(q.x - Math.sin(ang) * o, q.y + Math.cos(ang) * o, Math.min(1, a + pulse * .6), pulse > .3 ? 2 : 0);
      }
    }
    // 画
    const night = shell.phone && shell.phone.dataset.mode === 'night';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W(), H());
    ctx.font = `600 ${CH - 1}px ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tick = reduce ? 0 : Math.floor(now / 160);
    const ink = night ? [190, 225, 255] : [38, 56, 92], metalInk = night ? [235, 245, 255] : [92, 112, 150], dataInk = night ? [120, 240, 255] : [18, 137, 214];
    const bg = night ? 'rgba(110,170,255,' : 'rgba(70,96,150,';
    for (let k = 0; k < dens.length; k++) {
      const d = dens[k]; if (d < .05) continue;
      const cx = k % cols, cy = (k / cols) | 0, x = cx * CW + CW / 2, y = cy * CH + CH / 2;
      if (d > .52) { ctx.fillStyle = bg + (night ? .1 + (d - .5) * .45 : .07 + (d - .5) * .32) + ')'; ctx.fillRect(x - CW / 2 + .5, y - CH / 2 + .5, CW - 1, CH - 1); }
      const jit = hash(k, tick + ((hash(k, 7) * 9) | 0)) < .12 ? (hash(k, tick) < .5 ? -1 : 1) : 0;
      const idx = Math.max(0, Math.min(RAMP.length - 1, Math.round(d * (RAMP.length - 1)) + jit));
      const col = tint[k] === 2 ? dataInk : tint[k] === 1 ? metalInk : ink;
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${.3 + .7 * d})`;
      ctx.fillText(tint[k] === 2 ? (hash(k, tick) < .5 ? '0' : '1') : RAMP[idx], x, y + .5);
    }
    // 火花
    parts = parts.filter(q => (q.t += dt) < q.life);
    for (const q of parts) {
      q.vy += (q.k === 'dust' ? 40 : 160) * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      const a = 1 - q.t / q.life;
      ctx.fillStyle = q.k === 'bad' ? `rgba(229,72,77,${a})` : q.k === 'ok' ? `rgba(48,190,120,${a})` : night ? `rgba(200,235,255,${a})` : `rgba(30,110,200,${a})`;
      ctx.fillText(q.ch, q.x, q.y);
    }
    raf = requestAnimationFrame(step);
  }
  let lastCenter = -1;

  /* ----- 切换用途 ----- */
  function setKind(k, first) {
    kind = k; buildMods();
    const pi = mods.findIndex(m => m.c && plugged() && m.c.id === plugged().id);
    posTarget = pi >= 0 ? pi : 0; if (first) pos = posTarget;
    plug.vis = first ? .2 : 0; plug.prev = -1; plug.back = false;
    if (!first) burst(plug.x, plug.y + 50, 18, 'dust');
    placePlug(true);
    syncInfo();
  }
  tabsBox.appendChild(segmented(KINDS, kind, v => setKind(v)));
  // 从「设置 / 添加接口」回来：重新排一遍模块（可能多了一个）
  p.el._onShow = () => { buildMods(); posTarget = Math.min(posTarget, mods.length - 1); placePlug(false); syncInfo(); };
  nav.push(p.el);
  requestAnimationFrame(() => { resize(); setKind('text', true); last = performance.now(); raf = requestAnimationFrame(step); });
  // 页面被移走后停止
  const mo = new MutationObserver(() => { if (!p.el.isConnected) { alive = false; cancelAnimationFrame(raf); mo.disconnect(); } });
  setTimeout(() => { if (p.el.parentNode) mo.observe(p.el.parentNode, { childList: true }); }, 0);
  return p;
}
