// 设置 → 连接 · 插线板
// 上面一块玻璃板，每个接口（API）是一个格子：中间是一张字符小脸（插孔），下面一个接口口子。
// 下面一根 ASCII 字符拼成的线；底部切换「聊天 / 生图 / 语音 / 其他」，就换成那一根线，板子上也只剩那一类接口。
// 拎起线插进哪个格子，这件事就用哪个接口。
// 小脸：平时呆呆的 ·_·，拎着线靠近会好奇地看过来，插中先「≧▽≦」，连上了 ^‿^，连不上 T_T 还会掉眼泪。
import { h, uid } from '../../core/util.js';
import { state, commit, subscribe } from '../../core/store.js';
import { page, navBtn, toast, actionSheet, dialog, sheet, icon, input, textarea, segmented, slider, switchEl } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { CHANNELS, testConn, testImage, testVoice, testEmbed, listModels, keysOf, syncTavernProfiles } from '../../core/api.js';
import { shell } from '../../core/shell.js';
import { AsciiOcean } from './ocean.js';

const C = () => state.connections;
const subscribeConn = fn => subscribe(w => { if (w === 'connections' || w === 'all') fn(); });
const KIND_NAME = { text: '文字', image: '生图', tts: '语音', embed: '向量' };
/** 四根线。use = 存在 defaults 里的名字；kind = 能插哪一类接口。「其他」= 向量记忆（Embedding），以后找旧聊天用 */
const CORDS = [
  { use: 'text', kind: 'text', label: '聊天', sym: '@', ink: [52, 120, 220], glow: [140, 200, 255] },
  { use: 'image', kind: 'image', label: '生图', sym: '#', ink: [130, 92, 220], glow: [200, 170, 255] },
  { use: 'tts', kind: 'tts', label: '语音', sym: 'S', ink: [210, 132, 40], glow: [255, 210, 140] },
  { use: 'aux', kind: 'embed', label: '其他', sym: '%', ink: [28, 150, 132], glow: [120, 240, 210] },
];
let lastCord = 0;     // 上次看的是哪根线（这次打开还停在那里）
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FACE = { idle: '·_·', blink: '-_-', curious: '·_·?', dim: '-_-', test: '°o°', ok: '^‿^', joy: '≧▽≦', bad: 'T_T', need: '·_·?', plugged: '·‿·' };
// 同一种心情有好几张脸，每个格子挑不一样的；每插一次 / 测通一次换一张
const FACES = {
  idle: ['·_·', '•_•', '°_°', '·ㅅ·', '·ω·'],
  ok: ['^‿^', '^▽^', '◕‿◕', '^ω^', 'ᵔᴥᵔ', '≧◡≦', '^_^'],
  joy: ['≧▽≦', '✧▽✧', '^o^', '★▽★', '≧ω≦'],
  need: ['·_·?', '?_?', '°~°?', '•_•?', 'ˀ_ˀ'],
  bad: ['T_T', 'ಥ_ಥ', ';_;', '×_×', 'ToT'],
  test: ['°o°', '·o·', '°□°'],
};
const strHash = str => { let n = 7; for (let i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) | 0; return Math.abs(n); };
const faceText = (f, id, mood = 0) => { const set = FACES[f]; return set ? set[(strHash(id || '') + mood) % set.length] : FACE[f]; };

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
  const head = h('div.as-pb__head', h('h1.as-pb__title', '连接'), h('div.as-pb__rule', h('i'), h('span', '✦'), h('i')), h('p.as-pb__sub', '拎起一根线，插进想用的接口'));
  const schemeChip = h('button.as-pb__scheme', { onclick: () => schemes() });
  head.appendChild(schemeChip);
  const grid = h('div.as-pb__grid');
  const panel = h('div.as-pb__panel', grid);
  const cordsBox = h('div.as-pb__cords');
  const cvs = h('canvas.as-pb__canvas', { 'aria-hidden': 'true' });
  p.body.append(head, panel, cordsBox, cvs);
  const isNight = () => shell.phone && shell.phone.dataset.mode === 'night';
  const ocean = new AsciiOcean(p.body, isNight);
  if (syncTavernProfiles()) commit('connections');

  /* ----- 格子：按 id 记住每个格子，增删改只动变了的那个，不整个重建 ----- */
  let tiles = [];      // 按显示顺序：{ c, kind, el, face, eyes, port, nameEl, subEl, usesEl }
  const tileMap = new Map();
  let quietUntil = 0;  // 刚拖完线 / 刚排完序，别把松手当成点格子
  const isTv = c => c.type === 'tavern' || c.type === 'tavern-profile';
  const needSetup = (c, kind) => { if (!c || isTv(c)) return false; const ch = (CHANNELS[kind] || []).find(x => x.v === c.type) || {}; return !ch.noKey && !keysOf(c).length; };
  const kindLabel = (c, kind) => c.type === 'tavern' ? '酒馆 · 当前' : c.type === 'tavern-profile' ? '酒馆' : KIND_NAME[kind];
  const subOf = c => c.type === 'tavern' ? (c.cur ? `现在是「${c.cur}」` : c.curApi ? `现在是 ${c.curApi}` : '跟着酒馆走')
    : c.type === 'tavern-profile' ? (c.gone ? '酒馆里没有了' : c.model || c.api || '')
    : (!keysOf(c).length && !((CHANNELS.image.find(x => x.v === c.type) || CHANNELS.tts.find(x => x.v === c.type) || {}).noKey) && c.type !== 'tavern' ? '还没填密钥' : c.model || '');
  /** 显示顺序：置顶的在最前（按置顶先后），其余按拖动排好的顺序，没排过的接在后面 */
  function ordered() {
    const all = ['text', 'image', 'tts', 'embed'].flatMap(k => (C()[k] || []).map(c => ({ c, kind: k })));
    const pin = C().pinned || [], ord = C().order || [];
    const rank = x => { const pi = pin.indexOf(x.c.id); if (pi >= 0) return pi - 1e6; const oi = ord.indexOf(x.c.id); return oi >= 0 ? oi : 1e5 + all.indexOf(x); };
    return all.sort((a, b) => rank(a) - rank(b));
  }
  function makeTile(c, kind) {
    const eyes = h('b', FACE.idle), face = h('span.as-pb__face', eyes), port = h('span.as-pb__port', h('i'));
    if (!c) {
      const el = h('div.as-pb__tile.is-add', { role: 'button', tabindex: 0, 'aria-label': '添加接口' }, h('span.as-pb__face', h('b', '+')), h('span.as-pb__name', '添加'), port);
      const t = { c: null, kind: null, el, face, eyes, port };
      el.addEventListener('click', () => { if (dragging() || sorting || performance.now() < quietUntil) return; addNew(); });
      return t;
    }
    const kindEl = h('span.as-pb__kind'), nameEl = h('span.as-pb__name'), subEl = h('span.as-pb__model'), usesEl = h('span.as-pb__uses'), pinEl = h('span.as-pb__pin', { 'aria-hidden': 'true' }, '📌');
    const el = h('div.as-pb__tile', { role: 'button', tabindex: 0, dataset: { kind, id: c.id } }, kindEl, pinEl, face, nameEl, subEl, usesEl, port);
    const t = { c, kind, el, face, eyes, port, nameEl, subEl, kindEl, usesEl, pinEl, blinkAt: performance.now() + 1500 + Math.random() * 4000, blinkUntil: 0, joyUntil: 0 };
    el.addEventListener('click', () => { if (dragging() || sorting || performance.now() < quietUntil) return; openDetail(t.c, t.kind); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
    bindSort(t);
    return t;
  }
  function paintTile(t) {
    const c = t.c;
    const name = c.type === 'tavern' ? '酒馆当前连接' : c.name;
    if (t.nameEl.textContent !== name) t.nameEl.textContent = name;
    const sub = subOf(c); if (t.subEl.textContent !== sub) t.subEl.textContent = sub;
    const kl = kindLabel(c, t.kind); if (t.kindEl.textContent !== kl) t.kindEl.textContent = kl;
    t.el.setAttribute('aria-label', `${name}，${kl}接口`);
    t.el.classList.toggle('is-tavern', isTv(c)); t.el.classList.toggle('is-gone', !!c.gone);
    t.el.classList.toggle('is-pinned', (C().pinned || []).includes(c.id));
  }
  let addTile = null;
  /** 让格子和数据对上：新的加进来、没了的拿掉、改了的改字、顺序变了就挪位置（只挪 DOM，不重建） */
  function updateTiles() {
    const list = ordered(), alive = new Set();
    tiles = list.map(({ c, kind }) => {
      alive.add(c.id);
      let t = tileMap.get(c.id);
      if (!t || t.kind !== kind) { if (t) t.el.remove(); t = makeTile(c, kind); tileMap.set(c.id, t); }
      t.c = c; paintTile(t);
      return t;
    });
    for (const [id, t] of tileMap) if (!alive.has(id)) { t.el.remove(); tileMap.delete(id); }
    if (!addTile) addTile = makeTile(null);
    tiles.push(addTile);
    tiles.forEach((t, i) => { if (grid.children[i] !== t.el) grid.insertBefore(t.el, grid.children[i] || null); });
    filterTiles(); syncUses();
  }
  function filterTiles() { const k = cur().kind; for (const t of tiles) if (t.c) { const h0 = t.kind !== k; if (t.el.hidden !== h0) t.el.hidden = h0; } }
  /** 格子上写着「哪几根线插在我这」 */
  function syncUses() {
    for (const t of tiles) {
      if (!t.c) continue;
      const want = CORDS.filter(cd => C().defaults[cd.use] === t.c.id).map(cd => cd.label).join(',');
      if (t.usesEl.dataset.v === want) continue;
      t.usesEl.dataset.v = want; t.usesEl.replaceChildren(...CORDS.filter(cd => C().defaults[cd.use] === t.c.id).map(cd => h('i', { style: { '--c': `rgb(${cd.ink})` } }, cd.label)));
    }
    const sc = '方案：' + ((C().schemes || []).find(s => s.id === C().scheme) || { name: '当前接法' }).name + ' ▾';
    if (schemeChip.textContent !== sc) schemeChip.textContent = sc;
  }

  /* ----- 长按格子拖动排序 -----
   * 按住 0.3 秒，格子「拿起来」：一个浮起来的影子跟着手指走（不会抖、不会跳），原来的位置留一个淡淡的空位。
   * 手指移到别的格子中间，空位就挪过去，别的格子滑开让位；松手影子落回空位。 */
  let sorting = null;
  const flip = fn => {      // 先记下每个格子的位置，改完顺序再让它们从旧位置滑过去
    const before = new Map(tiles.map(o => [o.el, o.el.getBoundingClientRect()]));
    fn();
    for (const o of tiles) {
      const r0 = before.get(o.el), r1 = o.el.getBoundingClientRect();
      if (!r0 || (Math.abs(r0.left - r1.left) < 1 && Math.abs(r0.top - r1.top) < 1)) continue;
      o.el.style.transition = 'none'; o.el.style.transform = `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px)`;
      o.el.getBoundingClientRect();
      o.el.style.transition = 'transform 240ms cubic-bezier(.2,.8,.2,1)'; o.el.style.transform = '';
    }
  };
  const layoutRect = el => {
    const r = el.getBoundingClientRect(), tf = getComputedStyle(el).transform;
    if (!tf || tf === 'none') return r;
    const m = new DOMMatrix(tf);
    return { left: r.left - m.m41, right: r.right - m.m41, top: r.top - m.m42, bottom: r.bottom - m.m42, width: r.width, height: r.height };
  };
  function bindSort(t) {
    let timer = 0, start = null;
    t.el.addEventListener('pointerdown', e => {
      if (e.button > 0 || dragging() || sorting) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      clearTimeout(timer); timer = setTimeout(() => { if (start) beginSort(t, start); }, 300);
    });
    t.el.addEventListener('pointermove', e => { if (start && !sorting && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) { clearTimeout(timer); start = null; } });
    const cancel = () => { clearTimeout(timer); start = null; };
    t.el.addEventListener('pointerup', cancel); t.el.addEventListener('pointercancel', cancel);
    t.el.addEventListener('contextmenu', e => e.preventDefault());
  }
  function beginSort(t, start) {
    if (dragging()) return;
    const r = t.el.getBoundingClientRect(), b = B();
    const ghost = t.el.cloneNode(true);
    ghost.classList.add('as-pb__ghost'); ghost.removeAttribute('data-id');
    Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left - b.left + 'px', top: r.top - b.top + 'px', transform: 'scale(1.06)' });
    p.body.appendChild(ghost);
    t.el.classList.add('is-slot');
    sorting = { t, ghost, id: start.id, ox: start.x - r.left, oy: start.y - r.top };
    panel.classList.add('is-sorting'); vib(12);
    try { panel.setPointerCapture(start.id); } catch (e) { /* 忽略 */ }
  }
  function moveSort(x, y) {
    const S0 = sorting, b = B();
    S0.ghost.style.left = x - S0.ox - b.left + 'px'; S0.ghost.style.top = y - S0.oy - b.top + 'px';
    // 手指到了哪个格子的中间区域，空位就挪到那儿
    // 用格子「该在的位置」判断（扣掉正在滑动的动画偏移），不然刚让开的格子还在原地，会来回换
    const over = tiles.find(o => o !== S0.t && o.c && !o.el.hidden && (() => { const r = layoutRect(o.el); return x > r.left + r.width * .2 && x < r.right - r.width * .2 && y > r.top + r.height * .2 && y < r.bottom - r.height * .2; })());
    if (over) flip(() => {
      const i = tiles.indexOf(S0.t), j = tiles.indexOf(over);
      tiles.splice(i, 1); tiles.splice(j, 0, S0.t);
      grid.insertBefore(S0.t.el, j > i ? over.el.nextSibling : over.el);
    });
    const pr = panel.getBoundingClientRect();
    if (y < pr.top + 40) panel.scrollTop -= 8; else if (y > pr.bottom - 40) panel.scrollTop += 8;
  }
  panel.addEventListener('pointermove', e => { if (sorting && e.pointerId === sorting.id) { e.preventDefault(); e.stopPropagation(); moveSort(e.clientX, e.clientY); } });
  const endSort = e => {
    if (!sorting || (e && e.pointerId !== sorting.id)) return;
    const { t, ghost } = sorting; sorting = null;
    // 影子飞回空位，再消失
    const r = t.el.getBoundingClientRect(), b = B();
    ghost.style.transition = 'left 200ms ease, top 200ms ease, transform 200ms ease';
    ghost.style.left = r.left - b.left + 'px'; ghost.style.top = r.top - b.top + 'px'; ghost.style.transform = 'none';
    setTimeout(() => { ghost.remove(); t.el.classList.remove('is-slot'); }, 210);
    panel.classList.remove('is-sorting');
    const ids = tiles.filter(o => o.c).map(o => o.c.id), pin = C().pinned || [];
    C().order = ids.filter(id => !pin.includes(id));
    C().pinned = pin.filter(id => ids.includes(id)).sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    commit('connections'); quietUntil = performance.now() + 350;
  };
  panel.addEventListener('pointerup', endSort); panel.addEventListener('pointercancel', endSort);
  // 保险：手指在别处松开、或者拖动被别的东西抢走了，也要把浮起来的格子放回去，不能卡在屏幕上
  panel.addEventListener('lostpointercapture', endSort);
  const winUp = e => endSort(e);
  window.addEventListener('pointerup', winUp, true); window.addEventListener('pointercancel', winUp, true);
  // 手机上：拿起格子后手指再动，不能让列表跟着滚走（否则浏览器会把拖动当成滚动，直接打断）
  panel.addEventListener('touchmove', e => { if (sorting) e.preventDefault(); }, { passive: false });
  function togglePin(id) {
    const pin = C().pinned || (C().pinned = []), i = pin.indexOf(id);
    if (i >= 0) pin.splice(i, 1); else pin.push(id);
    commit('connections');
    flip(() => updateTiles());
    return i < 0;
  }
  const status = {};   // id → 'test' | 'ok' | 'bad'（这次打开页面里测出来的）
  const stOf = c => status[c.id] || (c.ok === true ? 'ok' : c.ok === false ? 'bad' : '');

  /* ----- 线（插头） ----- */
  const plugs = CORDS.map((cd, i) => ({ ...cd, i, x: 0, y: 0, vx: 0, vy: 0, tilt: 0, tv: 0, sway: 0, swayV: 0, mode: 'rest', target: null, prev: null, snapT: 0, from: null, grab: null, vis: 1, shake: 0 }));
  const B = () => p.body.getBoundingClientRect();
  const W = () => p.body.clientWidth, H = () => p.body.clientHeight;
  let active = lastCord;
  const cur = () => plugs[active];
  const isOn = pl => pl.i === active;
  const restOf = pl => ({ x: W() / 2, y: cordsBox.offsetTop + 8 });
  const anchorOf = pl => ({ x: W() / 2 + 34, y: H() + 50 });
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
      if (!instant && (pl.mode === 'drag' || pl.mode === 'snap')) continue;   // 正在拖 / 正在飞的线别打断
      const id = C().defaults[pl.use], t = id && tileOf(id);
      if (t && t.kind === pl.kind) { pl.mode = 'plugged'; pl.target = id; }
      else { pl.mode = 'rest'; pl.target = null; }
      if (instant) { const q = pl.mode === 'plugged' ? portOf(tileOf(pl.target), pl) : restOf(pl); pl.x = q.x; pl.y = q.y; }
    }
  }
  // 底部切换：这根线给谁
  const tabs = h('div.as-pb__tabs', { role: 'tablist' }, plugs.map(pl => h('button.as-pb__tab', { role: 'tab', style: { '--c': `rgb(${pl.ink})` }, onclick: () => setActive(pl.i) }, h('i', pl.sym), pl.label)));
  const cordHint = h('span.as-pb__cordhint');
  cordsBox.append(cordHint, tabs);
  function layoutLabels() {
    [...tabs.children].forEach((b, i) => { b.classList.toggle('is-on', i === active); b.setAttribute('aria-selected', String(i === active)); });
    const pl = cur(); cordHint.textContent = pl.mode === 'drag' ? `把「${pl.label}」插进一个${KIND_NAME[pl.kind]}接口` : pl.mode === 'rest' ? `「${pl.label}」还没插，拎起来插进上面一个接口` : '';
  }
  /** 换一根线：板子上只留这一类接口（只是藏起来，不重建），线淡入 */
  function setActive(i) {
    if (i === active || dragging()) return;
    active = lastCord = i;
    const pl = cur(); pl.vis = 0;
    filterTiles(); panel.scrollTop = 0;
    requestAnimationFrame(() => { placePlugs(true); layoutLabels(); forceDraw = true; });
    ocean.kick(.3);
  }
  const dragging = () => plugs.some(pl => pl.mode === 'drag');
  const tileOf = id => tileMap.get(id);
  const hitPlug = (x, y) => {
    for (let i = plugs.length - 1; i >= 0; i--) {
      const pl = plugs[i]; if (pl.mode === 'snap' || !isOn(pl)) continue;
      const dx = x - pl.x, dy = y - pl.y;
      if (pl.mode === 'plugged' && pl.route > .5) { if (Math.abs(dx) < 26 && dy > -18 && dy < 22) return pl; }
      else if (Math.abs(dx) < 32 && dy > -20 && dy < PL + 14) return pl;
      // 插着的时候，也可以按在格子的接口口子上拎起来
      if (pl.mode === 'plugged' && !sorting) { const t = tileOf(pl.target); if (t) { const r = t.port.getBoundingClientRect(), b = B(); if (x > r.left - b.left - 18 && x < r.right - b.left + 18 && y > r.top - b.top - 18 && y < r.bottom - b.top + 26) return pl; } }
    }
    return null;
  };
  const local = e => { const b = B(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  p.body.addEventListener('pointerdown', e => {
    if (sorting) return;
    const q = local(e), pl = hitPlug(q.x, q.y);
    if (!pl) return;
    e.stopPropagation(); e.preventDefault();
    if (pl.mode === 'plugged') { pl.prev = pl.target; burst(pl.x, pl.y, 8, 'dust'); ocean.kick(.5); }
    pl.mode = 'drag'; pl.target = null; pl.grab = { id: e.pointerId, dx: pl.x - q.x, dy: pl.y - q.y, x: q.x, y: q.y, x0: q.x, y0: q.y, moved: false };
    try { p.body.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    vib(6); layoutLabels();
  }, true);
  p.body.addEventListener('touchstart', e => {
    if (sorting) return;
    const t = e.touches[0], b = B();
    if (t && hitPlug(t.clientX - b.left, t.clientY - b.top)) e.preventDefault();   // 按在插头上：别滚动、别弹长按菜单，不然拖到一半会被打断
  }, { passive: false, capture: true });
  p.body.addEventListener('touchmove', e => { if (dragging()) e.preventDefault(); }, { passive: false });
  p.body.addEventListener('contextmenu', e => e.preventDefault());
  p.body.addEventListener('pointermove', e => {
    const pl = plugs.find(x => x.mode === 'drag' && x.grab && x.grab.id === e.pointerId); if (!pl) return;
    e.stopPropagation();
    const q = local(e); pl.grab.x = q.x; pl.grab.y = q.y;
    if (!pl.grab.moved && Math.hypot(q.x - pl.grab.x0, q.y - pl.grab.y0) > 8) pl.grab.moved = true;   // 真的拖起来了，别的格子才开始变暗 / 好奇
  });
  const up = e => {
    const pl = plugs.find(x => x.mode === 'drag' && x.grab && x.grab.id === e.pointerId); if (!pl) return;
    pl.grab = null; quietUntil = performance.now() + 350;
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
    burst(pl.x, pl.y, 20, 'spark'); layoutLabels(); ocean.kick(1);
    if (t) { t.joyUntil = performance.now() + 900; t.mood = (t.mood || 0) + 1; }
    if (again) return;
    // 插上就算接好了：不发请求，直接笑脸。想确认真能用，点格子里的「测试」
    C().defaults[pl.use] = id; C().scheme = ''; commit('connections'); syncUses();
    if (status[id] !== 'bad') status[id] = 'ok';
    flowing = { pl, until: performance.now() + 900 };
  }
  /** 真的去测一下（只在详情里点「测试」时才会发请求）。c 可以是还没保存的草稿 */
  async function doTest(c, kind) {
    const chs = CHANNELS[kind] || [], ch = chs.find(x => x.v === c.type) || {};
    if (kind !== 'text' && !ch.noKey && !keysOf(c).length) throw new Error('还没填密钥');
    if (kind === 'text') { await testConn(c); return {}; }
    if (kind === 'embed') { const n = await testEmbed(c); return { note: `返回了 ${n} 维向量` }; }
    if (kind === 'tts') { await testVoice(c); return {}; }
    if (!ch.noKey && !(await dialog({ title: '真画一张试试？', text: '会画一张很小的图，付费渠道会扣一张图的钱。', confirm: '画' }))) return { cancel: true };
    return { img: await testImage(c) };
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
    const dp = plugs.find(x => x.mode === 'drag' && x.grab && x.grab.moved);
    for (const t of tiles) {
      if (!t.c) { t.el.classList.toggle('is-near', !!dp && nearTile(dp) === t); continue; }
      const used = plugs.some(pl => pl.kind === t.kind && C().defaults[pl.use] === t.c.id && !(pl.mode === 'drag' && isOn(pl)));
      const st = stOf(t.c), compat = dp && dp.kind === t.kind, near = dp && nearTile(dp) === t;
      if (now > t.blinkAt) { t.blinkUntil = now + 140; t.blinkAt = now + 2200 + Math.random() * 4200; }
      let f, look = 0;
      if (now < t.joyUntil) f = 'joy';
      else if (status[t.c.id] === 'test') f = 'test';
      else if (dp && !compat) f = 'dim';
      else if (dp && compat) { f = 'curious'; const q = portOf(t, dp); look = Math.max(-1, Math.min(1, (dp.x - q.x) / 120)); }
      else if (used && st === 'bad') f = 'bad';                 // 红：点了测试，连不上
      else if (used && needSetup(t.c, t.kind)) f = 'need';     // 黄：插上了，但还没填密钥
      else if (used) f = 'ok';                                  // 绿：插着就算好（外面不会主动去测）
      else f = 'idle';
      if ((f === 'idle' || f === 'curious' || f === 'plugged') && now < t.blinkUntil) f = f === 'plugged' ? 'blink' : 'blink';
      const txt = f === 'blink' || f === 'dim' || f === 'curious' ? FACE[f] : faceText(f, t.c.id, t.mood || 0);
      if (t.eyes.textContent !== txt) t.eyes.textContent = txt;
      t.eyes.style.transform = `translateX(${(look * 3).toFixed(1)}px)`;
      t.el.dataset.face = f;
      t.el.classList.toggle('is-near', !!near); t.el.classList.toggle('is-dim', !!dp && !compat); t.el.classList.toggle('is-used', used);
    }
  }

  /* ----- 每一帧：物理 + 把线画成字符 ----- */
  const ctx = cvs.getContext('2d');
  let dpr = 1, cols = 0, rows = 0, dens = null, own = null, typ = null, raf = 0, last = performance.now(), alive = true, lastTick = -1, forceDraw = true;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    cvs.width = Math.round(W() * dpr); cvs.height = Math.round(H() * dpr);
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
      if (pl.mode === 'drag' && pl.grab) {
        tx = pl.grab.x + pl.grab.dx; ty = pl.grab.y + pl.grab.dy;
        // 拖到玻璃板上下边上，板子自己慢慢滚，好插到看不见的格子
        const bb = B(), pr = panel.getBoundingClientRect(), top0 = pr.top - bb.top, bot0 = pr.bottom - bb.top;
        if (pl.grab.moved && ty > top0 && ty < top0 + 36) panel.scrollTop -= 6;
        else if (pl.grab.moved && ty > bot0 - 40 && ty < bot0 + 30) panel.scrollTop += 6;
      }
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
      pl.vis = Math.min(1, pl.vis + dt * 3);
      // 插好了：线慢慢「理」进格子之间的缝里；拔出来 / 格子滚出去了：线又变回自由垂着
      const rT = pl.mode === 'plugged' && isOn(pl) && routeOf(pl) ? 1 : 0, rv = dt / (reduce ? .05 : .42);
      pl.route = rT > (pl.route || 0) ? Math.min(rT, (pl.route || 0) + rv) : Math.max(rT, (pl.route || 0) - rv * 1.6);
    }
    faces(now);
    // 线全部画在最上面一层（之前藏在玻璃板后面会看起来断掉）；经过别的格子时变淡，不挡字。
    // 省电：东西没在动的时候，只在字符闪一下的节拍上重画（一秒六次左右），不是每帧都画。
    const tickNow = reduce ? 0 : Math.floor(now / 170);
    const moving = plugs.some(pl => isOn(pl) && pl.vis < 1 || (isOn(pl) && pl.route > 0 && pl.route < 1) || pl.mode === 'drag' || pl.mode === 'snap' || pl.shake > 0 || Math.abs(pl.vx) + Math.abs(pl.vy) > 1.5 || Math.abs(pl.swayV) > .5)
      || (flowing && now < flowing.until) || parts.length > 0;
    if (moving || tickNow !== lastTick || forceDraw) {
      lastTick = tickNow; forceDraw = false;
      drawLayer(ctx, now, () => true, () => true);
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

  /** 插好的线怎么「理」：从插头往下到格子之间的横缝，横着走到旁边的竖缝，顺着竖缝下到板子底，再出去。
   *  返回一个按长度取点的函数 at(0..1)（0 是底下线的根，1 是插头），格子看不见时返回 null */
  function routeOf(pl) {
    if (pl.mode !== 'plugged' || !pl.target) return null;
    const t = tileOf(pl.target); if (!t || t.el.hidden) return null;
    const q = portOf(t, pl); if (q.hidden) return null;
    const b = B(), tr = t.el.getBoundingClientRect(), gr = grid.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 10, colW = (gr.width - 2 * gap) / 3;
    const c = Math.max(0, Math.min(2, Math.round((tr.left - gr.left) / (colW + gap))));
    const side = c === 2 ? -1 : 1;                              // 左边、中间的格子走右边的缝，最右边的走左边的缝
    const gx = (side > 0 ? tr.right + gap / 2 : tr.left - gap / 2) - b.left;
    const bottom = pr.bottom - b.top - 3, gy = Math.min(bottom, tr.bottom + gap / 2 - b.top), capB = q.y + 9;
    const A = anchorOf(pl), pts = [];
    for (let i = 0; i <= 30; i++) {                           // 板子外面：从底下自然弯上来，竖着进缝
      const u = i / 30, v = 1 - u, P1 = { x: A.x, y: A.y - 70 }, P2 = { x: gx, y: bottom + 80 };
      pts.push({ x: v * v * v * A.x + 3 * v * v * u * P1.x + 3 * v * u * u * P2.x + u * u * u * gx, y: v * v * v * A.y + 3 * v * v * u * P1.y + 3 * v * u * u * P2.y + u * u * u * bottom, out: true });
    }
    pts.push({ x: gx, y: gy }, { x: q.x, y: gy }, { x: q.x, y: capB });
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = L[L.length - 1] || 1;
    return {
      total,
      at(t) {
        const d = t * total; let i = 1; while (i < L.length - 1 && L[i] < d) i++;
        const a = pts[i - 1], z = pts[i], f = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1);
        return { x: a.x + (z.x - a.x) * f, y: a.y + (z.y - a.y) * f, inside: !z.out, vert: Math.abs(z.y - a.y) > Math.abs(z.x - a.x) };
      },
    };
  }

  /** 把一层画成字符：cable(pl) 要不要画这根线，head(pl) 要不要画这个插头 */
  function drawLayer(ctx, now, cable, head) {
    dens.fill(0); own.fill(0); typ.fill(0);
    const order = [...plugs].sort((a, b) => (a.mode === 'drag') - (b.mode === 'drag'));
    for (const pl of order) {
      if (!isOn(pl)) continue;
      const doCable = cable(pl), doHead = head(pl);
      if (!doCable && !doHead) continue;
      const A = anchorOf(pl), c = Math.cos(pl.tilt), s = Math.sin(pl.tilt);
      const Bp = { x: pl.x - s * PL, y: pl.y + c * PL };
      const dist = Math.hypot(Bp.x - A.x, Bp.y - A.y), k = Math.min(220, dist * .42 + 30);
      const P1 = { x: A.x, y: A.y - k * .8 }, P2 = { x: Bp.x - s * k + pl.sway, y: Bp.y + c * k };
      const rt = pl.route > 0 ? routeOf(pl) : null, e = rt ? pl.route * pl.route * (3 - 2 * pl.route) : 0;
      const n = Math.min(600, Math.max(24, Math.ceil(Math.max(dist, rt ? rt.total : 0) / 3)));
      const flow = flowing && flowing.pl === pl && now < flowing.until;
      let px = A.x, py = A.y;
      if (doCable) for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        let x = u * u * u * A.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * Bp.x, y = u * u * u * A.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * Bp.y;
        let thin = 0;
        if (rt) { const r = rt.at(t); x += (r.x - x) * e; y += (r.y - y) * e; if (e > .55 && r.inside) thin = r.vert ? 4 : 5; }
        const ang = Math.atan2(y - py, x - px); px = x; py = y;
        const pulse = flow ? Math.max(0, 1 - Math.abs(((t * 2.4 - now / 600) % 1 + 1) % 1 - .5) * 8) : 0;
        if (thin) { stamp(x, y, Math.min(1, .9 + pulse * .1), pl.i + 1, pulse > .3 ? 2 : thin); continue; }   // 缝里只走一根细线
        for (const [o, a] of [[0, .82], [-4, .5], [4, .42], [-7, .14]]) stamp(x - Math.sin(ang) * o, y + Math.cos(ang) * o, Math.min(1, a + pulse * .5), pl.i + 1, pulse > .3 ? 2 : 0);
      }
      if (!doHead) continue;
      const sx = pl.shake ? (Math.random() - .5) * 5 * pl.shake : 0, X0 = pl.x + sx, Y0 = pl.y;
      if (pl.mode === 'plugged' && pl.route > .5) {
        for (let cy = Math.floor((Y0 - 9) / CH); cy <= Math.floor((Y0 + 9) / CH); cy++) for (let cx = Math.floor((X0 - 18) / CW); cx <= Math.floor((X0 + 18) / CW); cx++) {
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          const X = cx * CW + CW / 2 - X0, Y = cy * CH + CH / 2 - Y0; if (Math.abs(X) > 18 || Y < -9 || Y > 9) continue;
          const kk = cy * cols + cx; dens[kk] = Math.abs(X) > 14 ? .6 : .95; own[kk] = pl.i + 1; typ[kk] = Y < -2 ? 1 : 0;
        }
        const mx = Math.floor(X0 / CW), my = Math.floor((Y0 + 3) / CH);
        if (mx >= 0 && my >= 0 && mx < cols && my < rows) { const kk = my * cols + mx; dens[kk] = 1; own[kk] = pl.i + 1; typ[kk] = 3; }
        continue;
      }
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
      else if (typ[k] === 4) { ch = hash(k, tick + ((hash(k, 3) * 7) | 0)) < .18 ? ':' : '|'; a = .95; }
      else if (typ[k] === 5) { ch = hash(k, tick + ((hash(k, 5) * 7) | 0)) < .18 ? '=' : '-'; a = .95; }
      else {
        const jit = hash(k, tick + ((hash(k, 7) * 9) | 0)) < .1 ? (hash(k, tick) < .5 ? -1 : 1) : 0;
        ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(d * (RAMP.length - 1)) + jit))];
        if (typ[k] === 1) col = night ? [235, 245, 255] : [120, 132, 156];
      }
      a *= cd.vis;
      ctx.fillStyle = `rgba(${col},${a})`; ctx.fillText(ch, x, y + .5);
    }
  }

  /* ================= 接口详情 ================= */
  function addNew(kind) {
    const k = kind || cur().kind, ch = CHANNELS[k][0];
    openDetail({ id: uid('conn'), name: '', type: ch.v, base: ch.base, key: '', keys: [], model: ch.model || '' }, k, true);
  }
  function openDetail(orig, kind, isNew) {
    const d = JSON.parse(JSON.stringify(orig));
    d.keys = d.keys || []; d.params = Object.assign({ temperature: .9, thinking: 'off' }, d.params); d.adv = Object.assign({ cache: false }, d.adv);
    d.img = Object.assign({ size: '1024x1024', tags: '', neg: '' }, d.img); d.tts = Object.assign({ voice: '', speed: 1, volume: 1 }, d.tts);
    const tavern = isTv(d);
    let dirty = !!isNew;
    const savedTag = h('span.as-pbd__saved', isNew ? '还没保存' : '已保存');
    const touch = () => { dirty = true; savedTag.textContent = '有改动，记得保存'; savedTag.classList.add('is-dirty'); paintSt(); };
    const st = () => { const s = status[orig.id] || (orig.ok === true ? 'ok' : orig.ok === false ? 'bad' : ''); return s === 'bad' || s === 'test' ? s : needSetup(d, kind) ? 'need' : s; };
    const faceEl = h('span.as-pb__face.as-pbd__face', h('b', FACE.idle));
    const stText = h('span.as-pbd__st');
    const paintSt = () => {
      const s = st(); stText.className = 'as-pbd__st is-' + (s || 'none');
      stText.textContent = s === 'ok' ? '已连接' : s === 'bad' ? '连不上' : s === 'test' ? '正在测…' : s === 'need' ? '还没配置（没填密钥）' : '还没测过';
      faceEl.firstChild.textContent = faceText(s || 'idle', orig.id);
      faceEl.dataset.face = s || 'idle';
    };
    paintSt();
    const nameEl = h('b.as-pbd__name', d.type === 'tavern' ? '酒馆当前连接' : d.name || (isNew ? '新接口' : ''));
    const subEl = h('span.as-pbd__subline');
    const paintSub = () => { subEl.textContent = tavern ? `酒馆 · ${subOf(d) || '跟着酒馆走'}` : `${KIND_NAME[kind]} · ${d.model || '还没选模型'}`; };
    paintSub();
    // 测试用的是现在填的内容（不用先保存）；测好了觉得行再保存
    const testBtn = h('button.as-pbd__test', { onclick: async () => {
      testBtn.disabled = true; status[orig.id] = 'test'; paintSt();
      let r = {}, err = '';
      try { r = await doTest(d, kind); } catch (e) { err = e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : e.message || '连不上'; }
      testBtn.disabled = false;
      if (r.cancel) { delete status[orig.id]; paintSt(); return; }
      status[orig.id] = err ? 'bad' : 'ok';
      if (!isNew) { orig.ok = !err; orig.okAt = Date.now(); if (!dirty) commit('connections'); }
      paintSt();
      const t = tileOf(orig.id); if (t && !err) { t.joyUntil = performance.now() + 1100; t.mood = (t.mood || 0) + 1; }
      if (err) toast(/^连不上/.test(err) ? err : `连不上：${err}`, { label: '查看日志', fn: () => shell.openApp('log') });
      else toast(r.note ? `连上了，${r.note}` : dirty || isNew ? '连上了，记得保存' : '连上了');
      if (r.img) { card.parentNode.querySelector('.as-pbd__testimg')?.remove(); card.after(h('img.as-pbd__testimg', { src: r.img, alt: '测试画出来的图' })); }
    } }, icon('sparkle', 14, 2), '测试');
    const card = h('div.as-pbd__card', faceEl, h('div.as-pbd__info', nameEl, subEl, stText), testBtn);

    // 可以折起来的一组：标题右边写着现在的值
    const fold = (title, ic, summary, build, open = false) => {
      const sum = h('span.as-pbd__sum', summary());
      const body = h('div.as-pbd__fbody'); let built = false;
      const box = h('div.as-pbd__fold' + (open ? '.is-open' : ''));
      const re = () => { sum.textContent = summary(); };
      const rebuild = () => { body.replaceChildren(); build(body, re, rebuild); re(); };   // 只重画这一组（比如换了渠道，要多填的东西不一样）
      const toggle = () => { if (!built) { build(body, re, rebuild); built = true; } box.classList.toggle('is-open'); };
      if (open) { build(body, re, rebuild); built = true; }
      box.append(h('button.as-pbd__fhead', { onclick: toggle, 'aria-expanded': String(open) }, icon(ic, 18, 1.8), h('span.as-pbd__ftitle', title), sum, h('span.as-pbd__chev', icon('chevron', 16, 2))), body);
      return box;
    };
    const row = (label, ctrl, hint) => h('div.as-pbd__row', h('span.as-pbd__label', label), h('div.as-pbd__ctrl', ctrl), hint && h('p.as-pbd__hint', hint));

    const groups = [];
    if (tavern) {
      const info = (k, v) => v ? h('div.as-pbd__row.is-inline', h('span.as-pbd__label', k), h('span.as-pbd__v', v)) : null;
      groups.push(h('div.as-pbd__fold.is-open', h('div.as-pbd__fbody',
        d.type === 'tavern'
          ? [info('现在用的配置', d.cur || '（没用连接配置）'), info('模型', d.model), info('API', d.curApi),
            h('p.as-pbd__hint', '酒馆此刻选中的连接是什么，这里就用什么；你在酒馆里一换，这里跟着变。温度这些也跟着酒馆的预设走。')]
          : [info('API', d.api), info('模型', d.model), info('预设', d.preset), info('地址', d.url),
            h('p.as-pbd__hint', d.gone ? '酒馆里已经没有这个配置了。把插在它上面的线换到别的接口，它就会自己消失。' : '这是酒馆「连接配置」里存的一个配置。用它的时候不会切换酒馆自己正在用的连接。要改地址、模型，去酒馆里改，这里会跟着变。')]
      )));
    } else {
      groups.push(fold('连接', 'link', () => `${(CHANNELS[kind].find(x => x.v === d.type) || {}).label || d.type} · ${keysOf(d).length} 把密钥`, (b, re, rebuild) => {
        const nameIn = input({ value: d.name, placeholder: '随便起，方便自己认', onInput: v => { d.name = v; nameEl.textContent = v || '新接口'; touch(); } });
        const typeBtn = h('button.as-pbd__select', { onclick: async () => {
          const v = await actionSheet('类型', CHANNELS[kind].map(x => ({ value: x.v, label: x.label, active: x.v === d.type })));
          if (!v) return; const ch = CHANNELS[kind].find(x => x.v === v);
          if (!d.base || CHANNELS[kind].some(x => x.base === d.base)) { d.base = ch.base; baseIn.value = ch.base; }
          if (ch.model && (!d.model || CHANNELS[kind].some(x => x.model === d.model))) { d.model = ch.model; modelIn.value = ch.model; paintSub(); }
          if (kind === 'tts' && (!d.tts.voice || CHANNELS.tts.some(x => x.voice === d.tts.voice))) d.tts.voice = ch.voice || '';
          // 名字还是原来渠道的名字（没自己改过）就跟着换
          if (!d.name || CHANNELS[kind].some(x => x.label === d.name)) { d.name = ch.label; nameEl.textContent = ch.label; }
          d.type = v; touch(); rebuild();
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
        // 官网：去哪拿密钥
        const siteBox = h('div.as-pbd__site');
        const paintSite = () => {
          const ch = CHANNELS[kind].find(x => x.v === d.type) || {};
          siteBox.replaceChildren(...[ch.note && h('p.as-pbd__hint', ch.note), ch.site && h('a.as-pbd__sitelink', { href: ch.site, target: '_blank', rel: 'noopener' }, icon('link', 13, 2), '官网：' + ch.site.replace(/^https?:\/\//, '').replace(/\/$/, ''))].filter(Boolean));
        };
        paintSite();
        // 有的渠道要多填一两样（MiniMax 的 Group ID、豆包的 App ID）
        const extra = (CHANNELS[kind].find(x => x.v === d.type) || {}).fields || [];
        const extraRows = extra.map(([k, label]) => row(label, input({ value: d[k] || '', onInput: v => { d[k] = v.trim(); touch(); } })));
        b.append(row('名字', nameIn), row('类型', typeBtn), siteBox, ...extraRows, row('地址', baseIn), row('密钥', keyBox, (CHANNELS[kind].find(x => x.v === d.type) || {}).noKey ? '这个渠道可以不填密钥。' : '只存在这台设备上；导出数据时默认不带。有好几把的话，被拒或限流会自动换下一把。'),
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
          row('不要出现', textarea({ value: d.img.neg, rows: 2, placeholder: '例：lowres, bad anatomy', onInput: v => { d.img.neg = v; touch(); } })),
          (d.type === 'novelai' || d.type === 'sd-webui') ? row('采样器 / 步数', h('div.as-pbd__line',
            input({ value: d.img.sampler || '', placeholder: d.type === 'novelai' ? 'k_euler_ancestral' : 'Euler a', onInput: v => { d.img.sampler = v; touch(); } }),
            input({ value: d.img.steps || '', type: 'number', placeholder: d.type === 'novelai' ? '28' : '24', onInput: v => { d.img.steps = +v || undefined; touch(); } }))) : null,
          d.type === 'comfyui' ? row('工作流（API 格式 JSON）', textarea({ value: d.img.workflow || '', rows: 5, placeholder: '在 ComfyUI 里「保存 (API 格式)」，整段粘过来；正面提示词写 %prompt%，负面写 %negative%，种子写 %seed%', onInput: v => { d.img.workflow = v; touch(); } })) : null);
      }));
      if (kind === 'tts') groups.push(fold('声音', 'mic', () => `${d.tts.voice || '默认音色'} · ${d.tts.speed}x`, (b, re) => {
        const sp = h('output.as-pbd__val', d.tts.speed + 'x'), vo = h('output.as-pbd__val', Math.round(d.tts.volume * 100) + '%');
        const chv = CHANNELS.tts.find(x => x.v === d.type) || {};
        b.append(row('音色', input({ value: d.tts.voice, placeholder: chv.voice ? '默认 ' + chv.voice : '音色 ID', onInput: v => { d.tts.voice = v; touch(); re(); } }), chv.note || ''),
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
    if (!isNew) {
      const pinned = () => (C().pinned || []).includes(orig.id);
      const pinBtn = h('button.as-pbd__pinbtn', { onclick: () => { const on = togglePin(orig.id); pinBtn.textContent = on ? '取消置顶' : '置顶'; toast(on ? '置顶了' : '取消置顶了'); } }, pinned() ? '取消置顶' : '置顶');
      groups.push(h('div.as-pbd__danger', pinBtn, h('span.as-pbd__hint', { style: { flex: 2, alignSelf: 'center' } }, '在板子上长按格子，可以拖动排序。')));
    }
    const save = h('button.as-pbd__save', { onclick: () => {
      if (tavern) { s.close(); return; }
      d.name = (d.name || '').trim() || `${(CHANNELS[kind].find(x => x.v === d.type) || {}).label} ${d.model || ''}`.trim();
      d.keys = d.keys.filter(k => String(k).trim());
      if (isNew) { C()[kind].push(d); if (!C().defaults[kind]) C().defaults[kind] = d.id; }
      else { Object.assign(orig, d); if (status[orig.id] === 'ok' || status[orig.id] === 'bad') orig.ok = status[orig.id] === 'ok'; }
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
      h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '聊天线断了，改用酒馆当前连接'), switchEl(R.fallback, v => { R.fallback = v; commit('connections'); }, '聊天线断了改用酒馆当前连接')),
      h('p.as-pbd__hint', '只在酒馆里有用：你插的接口连不上时，这一次先借酒馆正在用的连接回复。'));
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
        const name = await dialog({ title: '存成方案', input: { placeholder: '方案名字' } });
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
  function refresh() { if (syncTavernProfiles()) commit('connections'); updateTiles(); requestAnimationFrame(() => { placePlugs(false); layoutLabels(); forceDraw = true; }); }
  p.el._onShow = refresh;
  // 酒馆那边改了连接配置（加 / 删 / 切换）时，这里跟着就地更新
  const unsub = subscribeConn(() => { if (p.el.isConnected) { updateTiles(); placePlugs(false); layoutLabels(); } });
  nav.push(p.el);
  updateTiles();
  requestAnimationFrame(() => { resize(); placePlugs(true); layoutLabels(); last = performance.now(); raf = requestAnimationFrame(step); });
  const mo = new MutationObserver(() => { if (!p.el.isConnected && p.el._wasIn) { alive = false; cancelAnimationFrame(raf); ocean.stop(); unsub(); mo.disconnect(); window.removeEventListener('pointerup', winUp, true); window.removeEventListener('pointercancel', winUp, true); } if (p.el.isConnected) p.el._wasIn = true; });
  setTimeout(() => { p.el._wasIn = p.el.isConnected; if (p.el.parentNode) mo.observe(p.el.parentNode, { childList: true }); }, 0);
  return p;
}
