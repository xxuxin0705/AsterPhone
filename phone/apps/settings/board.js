// 设置 → 连接 · 插线板
// 上面一块玻璃板，每个接口（API）是一个格子：中间是一张字符小脸（插孔），下面一个接口口子。
// 下面一根 ASCII 字符拼成的线；底部切换「聊天 / 生图 / 语音 / 其他」，就换成那一根线，板子上也只剩那一类接口。
// 拎起线插进哪个格子，这件事就用哪个接口。
// 小脸：平时呆呆的 ·_·，拎着线靠近会好奇地看过来，插中先「≧▽≦」，连上了 ^‿^，连不上 T_T 还会掉眼泪。
import { h, uid } from '../../core/util.js';
import { state, commit, subscribe } from '../../core/store.js';
import { page, navBtn, busy, toast, actionSheet, dialog, sheet, icon, input, textarea, segmented, slider, switchEl, avatar } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { CHANNELS, tagOf, auxKey, SAMPLERS, listSamplers, failCfg, testLive, testCompat, testConn, testImage, testVoice, testEmbed, listModels, keysOf, syncTavernProfiles } from '../../core/api.js';
import { shell } from '../../core/shell.js';
import { AsciiOcean } from './ocean.js';
import { openVoicePage, voiceInput, withInfo } from './voices.js';
import { V, save as saveVoice, people, connFor, defaultConn } from '../../core/voice.js';

const C = () => state.connections;
const subscribeConn = fn => subscribe(w => { if (w === 'connections' || w === 'all') fn(); });
const KIND_NAME = { text: '文字', image: '生图', tts: '语音', embed: '其他' };
/** 四根线。use = 存在 defaults 里的名字；kind = 能插哪一类接口。「其他」= 自己写标签的接口（向量、通话…）：线在末端分叉，每个标签一股（defaults['aux:标签']） */
const CORDS = [
  { use: 'text', kind: 'text', label: '聊天', sym: '@', ink: [52, 120, 220], glow: [140, 200, 255] },
  { use: 'image', kind: 'image', label: '生图', sym: '#', ink: [130, 92, 220], glow: [200, 170, 255] },
  { use: 'tts', kind: 'tts', label: '语音', sym: 'S', ink: [210, 132, 40], glow: [255, 210, 140] },
  { use: 'aux', kind: 'embed', label: '其他', sym: '%', ink: [28, 150, 132], glow: [120, 240, 210] },
];
let lastCord = 0;     // 上次看的是哪根线（这次打开还停在那里）
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FACE = { idle: '·_·', blink: '-_-', curious: '·_·', dim: '-_-', test: '°o°', ok: '^‿^', joy: '≧▽≦', bad: 'T_T', need: '·_·', plugged: '·‿·' };
// 同一种心情有好几张脸，每个格子挑不一样的；每插一次 / 测通一次换一张
const FACES = {
  idle: ['·_·', '•_•', '°_°', '·ㅅ·', '·ω·'],
  ok: ['^‿^', '^▽^', '◕‿◕', '^ω^', 'ᵔᴥᵔ', '≧◡≦', '^_^'],
  joy: ['≧▽≦', '✧▽✧', '^o^', '★▽★', '≧ω≦'],
  need: ['·_·', '•_•', '°~°', '°_°', '·.·'],
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
/** 彩虹色：语音线在「每个人用自己的渠道」时是彩色的，沿着线慢慢流动 */
function rainbow(pos, now, night) {
  const hue = ((pos * 1.4 + now / 18) % 360 + 360) % 360, l = night ? .7 : .52, s0 = .7, a = s0 * Math.min(l, 1 - l);
  const f = n => { const k = (n + hue / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* 忽略 */ } };

/* ================= 页面 ================= */
export function openBoard({ list }) {
  const p = page({ app: 'settings', id: 'settings-board', title: '', back: true, cls: 'as-pb-page', right: [navBtn('mic', '音色库', () => voicePage(null, 'conn')), navBtn('more', '更多', () => menu())] });
  const micBtn = p.nav.querySelector('[aria-label="音色库"]');   // 音色库只在看「语音」线时出现
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
  /** 显示顺序：置顶的在最前（按置顶先后），其余按拖动排好的顺序，没排过的接在后面 */
  function ordered() {
    const all = ['text', 'image', 'tts', 'embed'].flatMap(k => (C()[k] || []).map(c => ({ c, kind: k })));
    const pin = C().pinned || [], ord = C().order || [];
    const rank = x => { const pi = pin.indexOf(x.c.id); if (pi >= 0) return pi - 1e6; const oi = ord.indexOf(x.c.id); return oi >= 0 ? oi : 1e5 + all.indexOf(x); };
    return all.sort((a, b) => rank(a) - rank(b));
  }
  function makeTile(c, kind) {
    const eyes = h('b', FACE.idle), qm = h('i.as-pb__q', '?'), face = h('span.as-pb__face', eyes, qm), port = h('span.as-pb__port', h('i'));
    if (!c) {
      const el = h('div.as-pb__tile.is-add', { role: 'button', tabindex: 0, 'aria-label': '添加接口' }, h('span.as-pb__face', h('b', '+')), h('span.as-pb__name', '添加'), port);
      const t = { c: null, kind: null, el, face, eyes, port };
      el.addEventListener('click', () => { if (dragging() || sorting || performance.now() < quietUntil) return; addNew(); });
      return t;
    }
    const kindEl = h('span.as-pb__kind'), nameEl = h('span.as-pb__name'), subEl = h('span.as-pb__model'), usesEl = h('span.as-pb__uses'), pinEl = h('span.as-pb__pin', { 'aria-hidden': 'true' }, '📌');
    // 语音格子：底下挂着用这个渠道说话的人（语音线选中时才露出来），点一下打开音色库
    const voicesEl = kind === 'tts' ? h('span.as-pb__voices', { onclick: e => { e.stopPropagation(); if (!avDrag && performance.now() >= quietUntil) voicePage(t.c, 'people'); } }) : null;
    const el = h('div.as-pb__tile', { role: 'button', tabindex: 0, dataset: { kind, id: c.id } }, kindEl, pinEl, face, nameEl, subEl, usesEl, voicesEl, port);
    const t = { c, kind, el, face, eyes, qm, qSide: 1, port, nameEl, subEl, kindEl, usesEl, pinEl, voicesEl, blinkAt: performance.now() + 1500 + Math.random() * 4000, blinkUntil: 0, joyUntil: 0 };
    el.addEventListener('click', () => { if (dragging() || sorting || performance.now() < quietUntil) return; detail(t.c, t.kind); });
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
    filterTiles(); syncUses(); paintVoices();
  }
  function filterTiles() { const k = cur().kind; for (const t of tiles) if (t.c) { const h0 = t.kind !== k; if (t.el.hidden !== h0) t.el.hidden = h0; } p.body.classList.toggle('is-voice', k === 'tts'); }
  /* ----- 音色：每个语音格子挂着在用它的人；「每个人用自己的渠道」时长按头像能拖到别的语音格子上 ----- */
  let avDrag = null;
  function paintVoices() {
    const all = people();
    for (const t of tiles) {
      if (!t.voicesEl) continue;
      const here = all.filter(x => (connFor(x.id) || {}).id === t.c.id), key = here.map(x => x.id + x.avatar).join() + V().mode;
      if (t.voicesEl.dataset.v === key) continue;
      t.voicesEl.dataset.v = key;
      t.voicesEl.replaceChildren(...here.slice(0, 4).map(x => { const a = avatar(x.avatar, x.name, 22); a.title = x.name; bindAvDrag(a, x); return a; }),
        here.length > 4 ? h('span.as-pb__more', '+' + (here.length - 4)) : null);
    }
  }
  function bindAvDrag(a, person) {
    let timer = 0, start = null;
    a.addEventListener('pointerdown', e => {
      e.stopPropagation(); if (V().mode !== 'each') return;
      start = { x: e.clientX, y: e.clientY }; clearTimeout(timer);
      timer = setTimeout(() => {
        const b = B(), g = avatar(person.avatar, person.name, 30); g.classList.add('as-pb__avghost');
        Object.assign(g.style, { left: start.x - b.left + 'px', top: start.y - b.top + 'px' }); p.body.appendChild(g);
        avDrag = { g, person }; vib(12);
      }, 300);
    });
    a.addEventListener('pointermove', e => { if (start && !avDrag && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) { clearTimeout(timer); start = null; } });
    const stop = () => { clearTimeout(timer); start = null; };
    a.addEventListener('pointerup', stop); a.addEventListener('pointercancel', stop);
    a.addEventListener('contextmenu', e => e.preventDefault());
  }
  window.addEventListener('pointermove', e => { if (!avDrag) return; const b = B(); avDrag.g.style.left = e.clientX - b.left + 'px'; avDrag.g.style.top = e.clientY - b.top + 'px'; });
  window.addEventListener('pointerup', e => {
    if (!avDrag) return;
    const { g, person } = avDrag; avDrag = null; g.remove(); quietUntil = performance.now() + 350;
    const t = tiles.find(o => o.kind === 'tts' && !o.el.hidden && (r => e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom)(o.el.getBoundingClientRect()));
    if (!t) return;
    // 拖回「语音」线插着的格子 = 改回跟随
    const P = V().people[person.id] || (V().people[person.id] = { conn: '', voices: {} });
    P.conn = t.c.id === (defaultConn() || {}).id ? '' : t.c.id; saveVoice(); paintVoices();
    toast(P.conn ? `${person.name}改用「${t.c.name}」说话` : `${person.name}跟随「语音」线`);
  }, true);
  p.body.addEventListener('touchmove', e => { if (avDrag) e.preventDefault(); }, { passive: false });
  /** 格子上写着「哪几根线插在我这」 */
  function syncUses() {
    for (const t of tiles) {
      if (!t.c) continue;
      const on = plugs.filter(pl => C().defaults[pl.use] === t.c.id), want = on.map(pl => pl.label).join(',');
      if (t.usesEl.dataset.v === want) continue;
      t.usesEl.dataset.v = want; t.usesEl.replaceChildren(...on.map(pl => h('i', { style: { '--c': `rgb(${pl.ink})` } }, pl.label)));
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
  function togglePin(id) { const on = togglePinData(id); flip(() => updateTiles()); return on; }
  const status = {};   // id → 'test' | 'ok' | 'bad'（这次打开页面里测出来的）
  const stOf = c => status[c.id] || '';   // 只认这次点「测试」的结果；插上就算好，以前测失败的不再一直挂着哭脸

  /* ----- 线（插头） ----- */
  // cord = 第几根线（底下的分类）；tag = 「其他」线的哪一股（别的线没有）
  const mkPlug = (cd, cord, tag) => ({ ...cd, cord, tag, use: tag == null ? cd.use : auxKey(tag), label: tag == null ? cd.label : tag, tagEl: tag == null ? null : h('span.as-pb__ptag', { style: { '--c': `rgb(${cd.ink})` } }, tag),
    x: 0, y: 0, vx: 0, vy: 0, tilt: 0, tv: 0, sway: 0, swayV: 0, mode: 'rest', target: null, prev: null, snapT: 0, from: null, grab: null, vis: 1, shake: 0 });
  const plugs = CORDS.slice(0, 3).map((cd, i) => mkPlug(cd, i));
  /** 「其他」线：有几种标签就分几股（一个接口都没有时也留一股「向量」） */
  function syncBranches() {
    const tags = [...new Set(C().embed.map(tagOf))]; if (!tags.length) tags.push('向量');
    for (let j = plugs.length - 1; j >= 0; j--) if (plugs[j].tag != null && !tags.includes(plugs[j].tag) && plugs[j].mode !== 'drag') { plugs[j].tagEl.remove(); plugs.splice(j, 1); }
    tags.forEach((tag, j) => {
      let q = plugs.find(x => x.tag === tag);
      if (!q) { q = mkPlug(CORDS[3], 3, tag); q.tagEl.hidden = active !== 3; p.body.appendChild(q.tagEl); plugs.push(q); q.fresh = true; }
      q.j = j; q.n = tags.length;
      if (q.fresh) { q.fresh = false; const r = restOf(q); q.x = r.x; q.y = r.y; }
    });
    plugs.forEach((q, i) => { q.i = i; });
  }
  const fits = (pl, c) => pl.tag == null || tagOf(c) === pl.tag;
  const B = () => p.body.getBoundingClientRect();
  const W = () => p.body.clientWidth, H = () => p.body.clientHeight;
  let active = lastCord;
  const cur = () => plugs.find(pl => pl.cord === active);
  const isOn = pl => pl.cord === active;
  const restOf = pl => ({ x: W() / 2 + (pl.tag == null ? 0 : (pl.j - (pl.n - 1) / 2) * 64), y: cordsBox.offsetTop + 8 });
  const forkAt = () => ({ x: W() / 2 + 34, y: tabs.getBoundingClientRect().top - B().top - 44 });   // 「其他」线在这里分叉，刚好高过底下的分类栏
  const anchorOf = pl => pl.tag == null ? { x: W() / 2 + 34, y: H() + 50 } : forkAt();
  syncBranches();
  function portOf(t, pl) {
    const b = B(), r = t.port.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const same = plugs.filter(q => q.target === t.c?.id && q.mode !== 'drag'), k = Math.max(0, same.indexOf(pl)), n = Math.max(1, same.length);
    const x = r.left - b.left + r.width / 2 + (k - (n - 1) / 2) * 14;
    let y = r.top - b.top + 5; const hidden = y < pr.top - b.top - 10 || y > pr.bottom - b.top - 4;
    y = Math.max(pr.top - b.top - 10, Math.min(pr.bottom - b.top - 4, y));
    return { x, y, hidden };
  }
  function placePlugs(instant) {
    syncBranches();
    for (const pl of plugs) {
      if (!instant && (pl.mode === 'drag' || pl.mode === 'snap')) continue;   // 正在拖 / 正在飞的线别打断
      const id = C().defaults[pl.use], t = id && tileOf(id);
      if (t && t.kind === pl.kind && fits(pl, t.c)) { pl.mode = 'plugged'; pl.target = id; }
      else { pl.mode = 'rest'; pl.target = null; }
      if (instant) { const q = pl.mode === 'plugged' ? portOf(tileOf(pl.target), pl) : restOf(pl); pl.x = q.x; pl.y = q.y; }
    }
  }
  // 底部切换：这根线给谁
  const tabs = h('div.as-pb__tabs', { role: 'tablist' }, CORDS.map((cd, i) => h('button.as-pb__tab', { role: 'tab', style: { '--c': `rgb(${cd.ink})` }, onclick: () => setActive(i) }, h('i', cd.sym), cd.label)));
  const cordHint = h('span.as-pb__cordhint');
  cordsBox.append(cordHint, tabs);
  // 语音线上的小拨片：统一一个渠道 ↔ 每个人用自己的渠道（各自时线变成彩色）。位置每帧跟着线走
  const modeLbl = h('span'), modeSw = h('button.as-pb__modesw', { 'aria-label': '每个人用哪个渠道', onclick: e => {
    e.stopPropagation(); V().mode = V().mode === 'each' ? 'one' : 'each'; saveVoice(); paintMode(); paintVoices(); forceDraw = true; vib(8);
    toast(V().mode === 'each' ? '每个人用自己的渠道' : '统一用一个渠道');
  } }, h('i'), modeLbl);
  const paintMode = () => { const each = V().mode === 'each'; modeSw.classList.toggle('is-each', each); modeLbl.textContent = each ? '各自' : '统一'; modeSw.setAttribute('aria-pressed', String(each)); };
  paintMode(); modeSw.hidden = micBtn.hidden = cur().kind !== 'tts'; p.body.appendChild(modeSw);
  function layoutLabels() {
    [...tabs.children].forEach((b, i) => { b.classList.toggle('is-on', i === active); b.setAttribute('aria-selected', String(i === active)); });
    const ons = plugs.filter(isOn), pl = ons.find(q => q.mode === 'drag') || ons.find(q => q.mode === 'rest');
    cordHint.textContent = !pl ? '' : pl.mode === 'drag' ? `把「${pl.label}」插进一个${pl.tag == null ? KIND_NAME[pl.kind] : `「${pl.tag}」`}接口` : `「${pl.label}」还没插，拎起来插进上面一个接口`;
    for (const q of plugs) if (q.tagEl) q.tagEl.hidden = !isOn(q) || q.mode === 'plugged';   // 插好了格子上自己会写，插头旁边就不挂了
  }
  /** 换一根线：板子上只留这一类接口（只是藏起来，不重建），线淡入 */
  function setActive(i) {
    if (i === active || dragging()) return;
    active = lastCord = i;
    plugs.filter(isOn).forEach(q => { q.vis = 0; });
    filterTiles(); panel.scrollTop = 0; modeSw.hidden = micBtn.hidden = CORDS[i].kind !== 'tts';
    requestAnimationFrame(() => { placePlugs(true); layoutLabels(); forceDraw = true; });
    ocean.kick(.3);
  }
  const dragging = () => plugs.some(pl => pl.mode === 'drag');
  const tileOf = id => tileMap.get(id);
  const hitPlug = (x, y) => {
    for (let i = plugs.length - 1; i >= 0; i--) {
      const pl = plugs[i]; if (pl.mode === 'snap' || !isOn(pl)) continue;
      const dx = x - pl.x, dy = y - pl.y;
      if (Math.abs(dx) < 32 && dy > -20 && dy < PL + 14) return pl;
      // 插着的时候，也可以按在格子的接口口子上拎起来
      if (pl.mode === 'plugged' && !sorting) { const t = tileOf(pl.target); if (t) { const r = t.port.getBoundingClientRect(), b = B(); if (x > r.left - b.left - 18 && x < r.right - b.left + 18 && y > r.top - b.top - 18 && y < r.bottom - b.top + 26) return pl; } }
    }
    return null;
  };
  const local = e => { const b = B(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  p.body.addEventListener('pointerdown', e => {
    if (sorting || e.target.closest('.as-pb__voices')) return;   // 按在头像上是点人 / 拖人，不是拎线
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
    if (e.target.closest('.as-pb__voices')) return;
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
    if (t && !t.c) { backOrRest(pl); addNew(pl.kind, pl.tag); return; }
    if (t) snapTo(pl, t.c.id); else backOrRest(pl);
  };
  p.body.addEventListener('pointerup', up); p.body.addEventListener('pointercancel', up);
  function backOrRest(pl) { if (pl.prev && tileOf(pl.prev)) { snapTo(pl, pl.prev, true); } else { pl.mode = 'rest'; layoutLabels(); } }
  function snapTo(pl, id, back) { pl.mode = 'snap'; pl.target = id; pl.snapT = 0; pl.from = { x: pl.x, y: pl.y }; pl.back = !!back; }
  function nearTile(pl) {
    let best = null, bd = 64;
    for (const t of tiles) {
      if (t.c && (t.kind !== pl.kind || !fits(pl, t.c))) continue;
      const q = portOf(t, pl); if (q.hidden) continue;
      const d = Math.hypot(q.x - pl.x, q.y - pl.y); if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  async function landed(pl) {
    const id = pl.target, t = tileOf(id), again = pl.back && C().defaults[pl.use] === id;
    pl.mode = 'plugged'; pl.prev = null; pl.back = false; pl.shake = 1; vib(18);
    const huh = t && t.c && needSetup(t.c, t.kind);
    burst(pl.x, pl.y, huh ? 8 : 20, huh ? 'dust' : 'spark'); layoutLabels(); ocean.kick(huh ? .4 : 1);
    if (t) { t.mood = (t.mood || 0) + 1; if (huh) t.huhUntil = performance.now() + 700; else t.joyUntil = performance.now() + 900; }
    if (again) return;
    // 插上就算接好了：不发请求，直接笑脸。想确认真能用，点格子里的「测试」
    C().defaults[pl.use] = id; C().scheme = ''; commit('connections'); syncUses();
    status[id] = 'ok';
    flowing = { pl, until: performance.now() + 900 };
  }
  /** 真的去测一下（只在详情里点「测试」时才会发请求）。c 可以是还没保存的草稿 */

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
      const st = stOf(t.c), compat = dp && dp.kind === t.kind && fits(dp, t.c), near = dp && nearTile(dp) === t;
      if (now > t.blinkAt) { t.blinkUntil = now + 140; t.blinkAt = now + 2200 + Math.random() * 4200; }
      let f, look = 0;
      if (now < (t.huhUntil || 0)) f = 'need';
      else if (plugs.some(q => q.mode === 'snap' && q.target === t.c.id)) f = 'curious';   // 插头正飞过来：先好奇地看着
      else if (now < t.joyUntil) f = 'joy';
      else if (status[t.c.id] === 'test') f = 'test';
      else if (dp && !compat) f = 'dim';
      else if (dp && compat) { f = 'curious'; const q = portOf(t, dp); look = Math.max(-1, Math.min(1, (dp.x - q.x) / 120)); }
      else if (used && st === 'bad') f = 'bad';                 // 红：点了测试，连不上
      else if (used && needSetup(t.c, t.kind)) f = 'need';     // 黄：插上了，但还没填密钥
      else if (used) f = 'ok';                                  // 绿：插着就算好（外面不会主动去测）
      else f = 'idle';
      const wonder = f === 'curious';
      if ((f === 'idle' || f === 'curious' || f === 'plugged') && now < t.blinkUntil) f = f === 'plugged' ? 'blink' : 'blink';
      const txt = f === 'blink' || f === 'dim' || f === 'curious' ? FACE[f] : faceText(f, t.c.id, t.mood || 0);
      if (t.eyes.textContent !== txt) t.eyes.textContent = txt;
      // 眼睛看向插头：插头在右边就往右看、在下面就往下看；拖着的时候看得更认真
      const pl = cur(); let lx = 0, ly = 0;
      if (pl && isOn(pl) && f !== 'dim') {
        const fr = t.face.getBoundingClientRect(), b0 = B(), fx = fr.left - b0.left + fr.width / 2, fy = fr.top - b0.top + fr.height / 2;
        const hx = pl.x, hy = pl.mode === 'plugged' && pl.target === t.c.id ? fy + 200 : pl.y + PL * .4;
        const gain = dp ? 1 : .6, cl = v => Math.max(-1, Math.min(1, v));
        lx = cl((hx - fx) / 110) * gain; ly = cl((hy - fy) / 200) * gain;
      }
      t.lx = (t.lx || 0) + (lx - (t.lx || 0)) * .25; t.ly = (t.ly || 0) + (ly - (t.ly || 0)) * .25;
      t.eyes.style.transform = `translate(${(t.lx * 7).toFixed(1)}px, ${(t.ly * 3).toFixed(1)}px)`;
      // 问号：看向右边时冒在左边，看向左边时冒在右边（离得近才换边，免得来回跳）
      const showQ = f === 'need' || wonder || now < (t.huhUntil || 0);
      if (t.lx > .2) t.qSide = -1; else if (t.lx < -.2) t.qSide = 1;
      t.qm.classList.toggle('is-on', showQ); t.qm.classList.toggle('is-left', t.qSide < 0);
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
    ocean.paused = !p.el.isConnected || (nav.top() && nav.top().el !== p.el);   // 被音色库、接口详情盖住时，海和线都不画，省得别的页面卡
    if (ocean.paused) { last = now; return; }
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
    }
    faces(now);
    // 线全部画在最上面一层（之前藏在玻璃板后面会看起来断掉）；经过别的格子时变淡，不挡字。
    // 省电：东西没在动的时候，只在字符闪一下的节拍上重画（一秒六次左右），不是每帧都画。
    const tickNow = reduce ? 0 : Math.floor(now / 170);
    const moving = plugs.some(pl => isOn(pl) && pl.vis < 1 || pl.mode === 'drag' || pl.mode === 'snap' || pl.shake > 0 || Math.abs(pl.vx) + Math.abs(pl.vy) > 1.5 || Math.abs(pl.swayV) > .5)
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

  /** 把一层画成字符：cable(pl) 要不要画这根线，head(pl) 要不要画这个插头 */
  function drawLayer(ctx, now, cable, head) {
    dens.fill(0); own.fill(0); typ.fill(0);
    // 「其他」线：先画一根主干从底下直直伸到分叉点，各股再从那里出发
    const br = plugs.find(q => isOn(q) && q.tag != null);
    if (br && cable(br)) {
      const A = { x: W() / 2 + 34, y: H() + 50 }, F = forkAt(), n = Math.max(2, Math.ceil((A.y - F.y) / 3));
      for (let i = 0; i <= n; i++) { const y = A.y + (F.y - A.y) * i / n; for (const [o, a] of [[0, .82], [-4, .5], [4, .42], [-7, .14]]) stamp(A.x + o, y, a, br.i + 1, 0); }
    }
    const order = [...plugs].sort((a, b) => (a.mode === 'drag') - (b.mode === 'drag'));
    for (const pl of order) {
      if (!isOn(pl)) continue;
      const doCable = cable(pl), doHead = head(pl);
      if (!doCable && !doHead) continue;
      const A = anchorOf(pl), c = Math.cos(pl.tilt), s = Math.sin(pl.tilt);
      const Bp = { x: pl.x - s * PL, y: pl.y + c * PL };
      const dist = Math.hypot(Bp.x - A.x, Bp.y - A.y), k = Math.min(220, dist * .42 + 30);
      const P1 = { x: A.x, y: A.y - k * .8 }, P2 = { x: Bp.x - s * k + pl.sway, y: Bp.y + c * k };
      const n = Math.min(500, Math.max(24, Math.ceil(dist / 3)));
      const flow = flowing && flowing.pl === pl && now < flowing.until;
      let px = A.x, py = A.y, swAt = pl.use === 'tts', swY = swAt && tabs.getBoundingClientRect().top - B().top - 22;
      if (doCable) for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const x = u * u * u * A.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * Bp.x, y = u * u * u * A.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * Bp.y;
        const ang = Math.atan2(y - py, x - px); px = x; py = y;
        if (swAt && (y <= swY || i === n)) { swAt = false; modeSw.style.left = x + 'px'; modeSw.style.top = y + 'px'; }   // 拨片挂在线上、刚好高过底下的分类栏，不压着「语音」
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
      if (pl.tagEl) { pl.tagEl.style.left = (X0 + 20) + 'px'; pl.tagEl.style.top = (Y0 + PL * .4) + 'px'; pl.tagEl.style.opacity = pl.vis; }   // 分叉的每股挂着自己的标签
      // 插头正面印着这根线的记号（@ % # S）
      const mx = Math.floor((X0 - s * PL * .5) / CW), my = Math.floor((Y0 + c * PL * .5) / CH);
      if (mx >= 0 && my >= 0 && mx < cols && my < rows) { const kk = my * cols + mx; dens[kk] = 1; own[kk] = pl.i + 1; typ[kk] = 3; }
    }
    const night = shell.phone && shell.phone.dataset.mode === 'night';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W(), H());
    ctx.globalAlpha = 1;
    ctx.font = `700 ${CH}px ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tick = reduce ? 0 : Math.floor(now / 170);
    const bb = B(), pr = panel.getBoundingClientRect(), pt = pr.top - bb.top, pbm = pr.bottom - bb.bottom + H(), pl0 = pr.left - bb.left, pr0 = pr.right - bb.left;
    for (let k = 0; k < dens.length; k++) {
      const d = dens[k]; if (d < .05) continue;
      const cd = plugs[own[k] - 1]; if (!cd) continue;
      const x = (k % cols) * CW + CW / 2, y = ((k / cols) | 0) * CH + CH / 2;
      const base = cd.use === 'tts' && V().mode === 'each' ? rainbow(x + y, now, night) : night ? cd.glow : cd.ink;
      if (d > .5 && !(y > pt && y < pbm - 8 && x > pl0 && x < pr0 && Math.hypot(x - cd.x, y - cd.y) > 34)) { ctx.fillStyle = `rgba(${base},${night ? .14 + (d - .5) * .4 : .12 + (d - .5) * .3})`; ctx.fillRect(x - CW / 2 + .5, y - CH / 2 + .5, CW - 1, CH - 1); }
      let ch, col = base, a = .35 + .65 * d;
      if (typ[k] === 3) { ch = cd.sym; col = night ? [255, 255, 255] : [255, 255, 255]; ctx.fillStyle = `rgba(${base},.95)`; ctx.fillRect(x - CW / 2 - 1, y - CH / 2 - 1, CW + 2, CH + 2); a = 1; }
      else if (typ[k] === 2) { ch = hash(k, tick) < .5 ? '0' : '1'; col = night ? [230, 255, 255] : [20, 60, 120]; a = 1; }
      else {
        const jit = hash(k, tick + ((hash(k, 7) * 9) | 0)) < .1 ? (hash(k, tick) < .5 ? -1 : 1) : 0;
        ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(d * (RAMP.length - 1)) + jit))];
        if (typ[k] === 1) col = night ? [235, 245, 255] : [120, 132, 156];
      }
      // 线在玻璃板里面、离插头远的地方淡一点，免得盖住格子上的字
      if (y > pt && y < pbm - 8 && x > pl0 && x < pr0 && typ[k] !== 3) {
        const pq = plugs[own[k] - 1], headLen = pq.mode === 'plugged' ? PL * .3 : PL + 6;   // 插好的插头只留尖尖清楚，身子淡下去，别挡住下面格子的脸
        if (Math.hypot(x - pq.x, y - pq.y) > 30 && !(y > pq.y - 4 && y < pq.y + headLen && Math.abs(x - pq.x) < 22)) a *= pq.mode === 'plugged' ? .3 : .42;
      }
      a *= cd.vis;
      ctx.fillStyle = `rgba(${col},${a})`; ctx.fillText(ch, x, y + .5);
    }
  }

  /* ================= 接口详情 ================= */
  const hooks = () => ({ status, tileOf, refresh, togglePin, paintVoices });
  const detail = (c, k, isNew) => openDetail(c, k, isNew, hooks());
  const addNew = (kind, tag) => newConn(kind || cur().kind, hooks(), tag);
  /* ================= 右上角菜单 ================= */
  const menu = () => connMenu({ mode: 'board', kind: cur().kind, schemes, add: () => addNew(), switchMode: list });
  const voicePage = (conn, tab) => openVoicePage({ conn, tab, onChange: () => { paintVoices(); paintMode(); forceDraw = true; }, openConn: c => detail(c, 'tts') });
  const schemes = () => schemesSheet({ onChange: syncUses, onApply: () => {
    // 线一根根换过去：先拔下来，再飞到新接口
    plugs.forEach((pl, i) => { setTimeout(() => { const id = C().defaults[pl.use]; if (id && tileOf(id)) snapTo(pl, id, true); else { pl.mode = 'rest'; pl.target = null; } layoutLabels(); syncUses(); }, i * 140); });
  } });

  /* ----- 刷新（加 / 删 / 改了接口之后） ----- */
  function refresh() { if (syncTavernProfiles()) commit('connections'); updateTiles(); paintMode(); requestAnimationFrame(() => { placePlugs(false); layoutLabels(); forceDraw = true; }); }
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

/** 右上角「…」：插线板模式和列表模式共用，只有最后一项（换成另一个模式）不一样 */
export async function connMenu({ mode, kind, schemes, add, switchMode }) {
  const v = await actionSheet('连接', [
    { value: 'scheme', label: '接线方案（整套接法存起来、一键换）' },
    ...(kind === 'embed' ? [] : [{ value: 'retry', label: '断线了怎么办' }]),   // 「其他」线（向量）还没有要重试、换接口的地方
    { value: 'add', label: '添加接口' },
    { value: 'mode', label: mode === 'board' ? '列表模式' : '插线板模式' }]);
  if (v === 'scheme') schemes();
  if (v === 'retry') retrySheet(kind);
  if (v === 'add') add();
  if (v === 'mode') switchMode();
}
function retrySheet(kind = 'text') {
  // 每根线各管各的：失败了重试几次；断了改用副 API（默认关，打开时先选好同一类里的哪个接口，选了才显示）
  const F = failCfg(kind), save = () => commit('connections');
  const bkOf = () => C()[kind].find(c => c.id === F.id);
  const bkName = h('span', (bkOf() || {}).name || '');
  const bkRow = h('div.as-pbd__row', { hidden: !(F.on && bkOf()) }, h('span.as-pbd__label', '副 API'), h('button.as-pbd__select', { onclick: () => pickBk() }, bkName, icon('chevron', 14, 2)));
  const sw = switchEl(!!(F.on && bkOf()), async v => {
    if (v && !(await pickBk())) { sw.click(); return; }   // 没选副 API：拨回关
    F.on = v; save(); bkRow.hidden = !v;
  }, '断线改用副 API');
  const pickBk = async () => {
    const opts = C()[kind].filter(c => c.id !== C().defaults[kind]).map(c => ({ value: c.id, label: c.name, active: c.id === F.id }));
    if (!opts.length) { toast(`先添加一个别的${{ text: '文字', image: '生图', tts: '语音' }[kind]}接口`); return false; }
    const v = await actionSheet('副 API', opts); if (!v) return false;
    F.id = v; save(); bkName.textContent = bkOf().name;
    return true;
  };
  const label = { text: '聊天', image: '生图', tts: '语音' }[kind];
  const maxRow = h('div.as-pbd__row', { hidden: F.retry === false }, h('span.as-pbd__label', '最多重试'), h('div.as-pbd__ctrl', segmented([['1', '1 次（建议）'], ['2', '2 次'], ['3', '3 次']], String(F.max || 1), v => { F.max = +v; save(); })));
  const box = h('div.as-pbd__wrap',
    h('div.as-pbd__row.is-inline', h('span.as-pbd__label', `${label}失败了自动重试`), switchEl(F.retry !== false, v => { F.retry = v; save(); maxRow.hidden = !v; }, '失败自动重试')),
    maxRow,
    h('p.as-pbd__hint', '付费接口按次数或字数算钱，重试也算。只在网络出错、服务器忙的时候重试，密钥不对不会白白重试。'),
    h('div.as-pbd__row.is-inline', h('span.as-pbd__label', `${label}线断了，改用副 API`), sw), bkRow);
  sheet({ title: '断线了怎么办', cls: 'as-pbd', content: box });
}
const isWire = k => ['text', 'image', 'tts'].includes(k) || k.startsWith('aux:');   // defaults 里哪些是线（每股一个）
/** 接线方案：onApply = 换了方案之后（插线板要把线一根根挪过去），onChange = 方案增删之后 */
export function schemesSheet({ onApply = () => {}, onChange = () => {} } = {}) {
  const list = C().schemes;
  const draw = () => {
    box.innerHTML = '';
    if (!list.length) box.appendChild(h('p.as-pbd__hint', '还没有方案。把现在每根线插在哪存成一个方案，以后点一下就整套换过去。'));
    list.forEach(sc => box.appendChild(h('div.as-pbd__scheme' + (C().scheme === sc.id ? '.is-on' : ''),
      h('button.as-pbd__scheme-main', { onclick: () => applyScheme(sc) }, h('b', sc.name), h('span', Object.entries(sc.map).map(([k, id]) => {
        const tag = k === 'aux' ? '向量' : k.startsWith('aux:') ? k.slice(4) : null, cd = CORDS.find(x => x.use === (tag == null ? k : 'aux')), c = cd && (C()[cd.kind] || []).find(x => x.id === id);
        return c ? `${tag || cd.label}→${c.name}` : null;
      }).filter(Boolean).join('　') || '全部没插')),
      h('button.as-pbd__ibtn', { 'aria-label': '删掉这个方案', onclick: async () => { if (!(await dialog({ title: `删掉方案「${sc.name}」？`, confirm: '删除', danger: true }))) return; list.splice(list.indexOf(sc), 1); if (C().scheme === sc.id) C().scheme = ''; commit('connections'); draw(); onChange(); } }, icon('trash', 16, 1.8)))));
    box.appendChild(h('button.as-pbd__dash', { onclick: async () => {
      const name = await dialog({ title: '存成方案', input: { placeholder: '方案名字' } });
      if (!name) return;
      const sc = { id: uid('sch'), name: String(name).slice(0, 16), map: Object.fromEntries(Object.entries(C().defaults).filter(([k, v]) => v && isWire(k))) };
      list.push(sc); C().scheme = sc.id; commit('connections'); draw(); onChange(); toast('存好了');
    } }, icon('plus', 15, 2), '把现在的接法存成方案'));
  };
  const box = h('div.as-pbd__wrap');
  const s = sheet({ title: '接线方案', cls: 'as-pbd', content: box });
  function applyScheme(sc) {
    for (const k of Object.keys(C().defaults)) if (isWire(k)) C().defaults[k] = '';
    for (const [k, v] of Object.entries(sc.map)) if (k !== 'aux' || v) C().defaults[k === 'aux' ? auxKey('向量') : k] = v;   // 旧方案的「其他」只有一个插头，算「向量」那股
    C().scheme = sc.id; commit('connections'); s.close();
    onApply(sc);
    toast(`换成「${sc.name}」`);
  }
  draw();
}

/* ================= 接口详情 ================= */
const isTv = c => c.type === 'tavern' || c.type === 'tavern-profile';
const needSetup = (c, kind) => { if (!c || isTv(c)) return false; const ch = (CHANNELS[kind] || []).find(x => x.v === c.type) || {}; return !ch.noKey && !keysOf(c).length; };
const kindLabel = (c, kind) => c.type === 'tavern' ? '酒馆 · 当前' : c.type === 'tavern-profile' ? '酒馆' : kind === 'embed' ? tagOf(c) : KIND_NAME[kind];
const subOf = c => c.type === 'tavern' ? (c.cur ? `现在是「${c.cur}」` : c.curApi ? `现在是 ${c.curApi}` : '跟着酒馆走')
  : c.type === 'tavern-profile' ? (c.gone ? '酒馆里没有了' : c.model || c.api || '')
  : (!keysOf(c).length && !((CHANNELS.image.find(x => x.v === c.type) || CHANNELS.tts.find(x => x.v === c.type) || {}).noKey) && c.type !== 'tavern' ? '还没填密钥' : c.model || '');

async function doTest(c, kind) {
  const chs = CHANNELS[kind] || [], ch = chs.find(x => x.v === c.type) || {};
  if (kind !== 'text' && !ch.noKey && !keysOf(c).length) throw new Error('还没填密钥');
  if (kind === 'text') { await testConn(c); return {}; }
  if (c.type === 'gemini-live') { await testLive(c); return { note: '能开实时对话' }; }
  if (c.type === 'openai-realtime' || c.type === 'other-compat') { const w = await testCompat(c); return w ? { note: w } : {}; }
  if (kind === 'embed') { const n = await testEmbed(c); return { note: `返回了 ${n} 维向量` }; }
  if (kind === 'tts') { await testVoice(c); return {}; }
  if (!ch.noKey && !(await dialog({ title: '真画一张试试？', text: '会画一张很小的图，付费渠道会扣一张图的钱。', confirm: '画' }))) return { cancel: true };
  return { img: await testImage(c) };
}
function togglePinData(id) {
  const pin = C().pinned || (C().pinned = []), i = pin.indexOf(id);
  if (i >= 0) pin.splice(i, 1); else pin.push(id);
  commit('connections');
  return i < 0;
}
/** 新建一个接口：先按这一类的第一个渠道填好，打开详情 */
export function newConn(kind, hooks, tag) {
  // 拎着「其他」线的某一股插到「添加」上：先挑带这个标签的渠道，没有就用自定义，标签填好
  const ch = (tag && (CHANNELS[kind].find(x => x.tag === tag) || CHANNELS[kind].find(x => x.v === 'other-compat'))) || CHANNELS[kind][0];
  openDetail({ id: uid('conn'), name: '', type: ch.v, base: ch.base, key: '', keys: [], model: ch.model || '', ...(tag && ch.tag !== tag ? { tag } : {}) }, kind, true, hooks);
}
/** 接口详情（插线板和列表模式共用）。hooks：插线板传进来的那几样（测试状态、格子、刷新…），列表模式不传就用空的 */
export function openDetail(orig, kind, isNew, { status = {}, tileOf = () => null, refresh = () => {}, togglePin = togglePinData, paintVoices = () => {}, setDefault = false } = {}) {
  // 列表模式没有线可插：用「设为默认」代替「置顶」
  const use = kind === 'embed' ? auxKey(tagOf(orig)) : kind;
  const defBtn = () => { const b = h('button', { onclick: () => { C().defaults[use] = orig.id; commit('connections'); b.textContent = '已是默认'; toast('设为默认了'); refresh(); } }, C().defaults[use] === orig.id ? '已是默认' : '设为默认'); return b; };
  const d = JSON.parse(JSON.stringify(orig));
  d.keys = d.keys || []; d.params = Object.assign({ temperature: .9, thinking: 'off' }, d.params); d.adv = Object.assign({ cache: false }, d.adv);
  d.img = Object.assign({ size: '1024x1024', tags: '', neg: '' }, d.img); d.tts = Object.assign({ voice: '', speed: 1, volume: 1 }, d.tts);
  const tavern = isTv(d);
  let dirty = !!isNew;
  // 置顶 · 复制一份 · 删除 放在同一排
  const pinBtn = () => { const pinned = () => (C().pinned || []).includes(orig.id), b = h('button.as-pbd__pinbtn', { onclick: () => { const on = togglePin(orig.id); b.textContent = on ? '取消置顶' : '置顶'; toast(on ? '置顶了' : '取消置顶了'); } }, pinned() ? '取消置顶' : '置顶'); return b; };
  const touch = () => { dirty = true; paintSt(); };
  const st = () => { const s = status[orig.id] || ''; return s === 'bad' || s === 'test' ? s : needSetup(d, kind) ? 'need' : s; };
  const faceEl = h('span.as-pb__face.as-pbd__face', h('b', FACE.idle));
  const stText = h('span.as-pbd__st');
  const paintSt = () => {
    const s = st(); stText.className = 'as-pbd__st is-' + (s || 'none');
    stText.textContent = s === 'ok' ? '已连接' : s === 'bad' ? '连不上' : s === 'test' ? '正在测…' : s === 'need' ? '还没配置' : '还没测过';
    faceEl.firstChild.textContent = faceText(s || 'idle', orig.id) + (s === 'need' ? '?' : '');
    faceEl.dataset.face = s || 'idle';
  };
  paintSt();
  const nameEl = h('b.as-pbd__name', d.type === 'tavern' ? '酒馆当前连接' : d.name || (isNew ? '新接口' : ''));
  const subEl = h('span.as-pbd__subline');
  const paintSub = () => { subEl.textContent = tavern ? `酒馆 · ${subOf(d) || '跟着酒馆走'}` : `${kind === 'embed' ? tagOf(d) : KIND_NAME[kind]} · ${d.model || '还没选模型'}`; };
  paintSub();
  // 测试用的是现在填的内容（不用先保存）；测好了觉得行再保存
  const testBtn = h('button.as-pbd__test', { onclick: async () => {
    testBtn.disabled = true; status[orig.id] = 'test'; paintSt();
    let r = {}, err = '', logId;
    try { r = await doTest(d, kind); } catch (e) { err = e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : e.message || '连不上'; logId = e.logId; }
    testBtn.disabled = false;
    if (r.cancel) { delete status[orig.id]; paintSt(); return; }
    status[orig.id] = err ? 'bad' : 'ok';
    if (!isNew) { orig.ok = !err; orig.okAt = Date.now(); if (!dirty) commit('connections'); }
    paintSt();
    const t = tileOf(orig.id); if (t && !err) { t.joyUntil = performance.now() + 1100; t.mood = (t.mood || 0) + 1; }
    if (err) toast(/^连不上/.test(err) ? err : `连不上：${err}`, { label: '查看日志', fn: () => shell.openApp('log', { id: logId }) });
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
    if (setDefault) groups.push(h('div.as-pbd__danger', defBtn()));
  } else {
    groups.push(fold('连接', 'link', () => `${(CHANNELS[kind].find(x => x.v === d.type) || {}).label || d.type} · ${keysOf(d).length} 把密钥`, (b, re, rebuild) => {
      const nameIn = input({ value: d.name, placeholder: '随便起，方便自己认', onInput: v => { d.name = v; nameEl.textContent = v || '新接口'; touch(); } });
      const typeBtn = h('button.as-pbd__select', { onclick: async () => {
        const v = await actionSheet('类型', CHANNELS[kind].map(x => ({ value: x.v, label: x.label, active: x.v === d.type })));
        if (!v || v === d.type) return; const ch = CHANNELS[kind].find(x => x.v === v);
        // 换了渠道就按那家直连的来：地址换成它的（第三方留空自己填），密钥清空，模型换成它的默认
        d.base = ch.base || ''; d.key = ''; d.keys = []; d.model = ch.model || ''; d.models = d.model ? [d.model] : []; paintSub();
        if (kind === 'tts' && (!d.tts.voice || CHANNELS.tts.some(x => x.voice === d.tts.voice))) d.tts.voice = ch.voice || '';
        // 名字还是原来渠道的名字（没自己改过）就跟着换
        if (!d.name || CHANNELS[kind].some(x => x.label === d.name)) { d.name = ch.label; nameEl.textContent = ch.label; }
        d.type = v; paintSub(); touch(); rebuild();
      } }, h('span', (CHANNELS[kind].find(x => x.v === d.type) || {}).label || d.type), icon('chevron', 14, 2));
      // 「其他」线：标签自己写（格子上显示它，App 设置里按它挑），空着就用这一类默认的
      const tagIn = kind === 'embed' && input({ value: d.tag || '', placeholder: (CHANNELS.embed.find(x => x.v === d.type) || {}).tag || '标签', onInput: v => { d.tag = v.trim().slice(0, 8); paintSub(); touch(); } });
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
            h('button.as-pbd__ibtn', { 'aria-label': '显示密钥', onclick: e => { inp.type = inp.type === 'password' ? 'text' : 'password'; e.currentTarget.replaceChildren(icon(inp.type === 'password' ? 'eye' : 'eyeOff', 17, 1.8)); } }, icon('eye', 17, 1.8)),
            i ? h('button.as-pbd__ibtn', { 'aria-label': '删掉这把密钥', onclick: () => { d.keys.splice(i - 1, 1); touch(); drawKeys(); re(); } }, icon('close', 16, 2)) : null));
        });
        keyBox.appendChild(h('button.as-pbd__dash', { onclick: () => { d.keys.push(''); touch(); drawKeys(); } }, icon('plus', 15, 2), '再加一把密钥'));
      };
      drawKeys();
      const modelIn = input({ value: d.model, placeholder: '模型 ID', onInput: v => { d.model = v; paintSub(); touch(); paintModels(); } });
      d.models = d.models || (d.model ? [d.model] : []);
      const modelBox = h('div.as-chips.as-pbd__models');
      const paintModels = () => modelBox.replaceChildren(...d.models.map(m => h('span.as-chip' + (m === d.model ? '.is-active' : ''), { onclick: () => useModel(m) }, m,
        h('button.as-pbd__chipx', { 'aria-label': '删掉这个模型', onclick: e => { e.stopPropagation(); d.models = d.models.filter(x => x !== m); touch(); paintModels(); } }, icon('close', 11, 2.4)))));
      const useModel = m => { d.model = m; modelIn.value = m; if (!d.models.includes(m)) d.models.push(m); paintSub(); touch(); paintModels(); };
      paintModels();
      const pull = h('button.as-pbd__mini', { onclick: () => busy(pull, async () => {
        toast('正在拉取模型…');
        try {
          const models = await listModels(d);
          if (!models.length) { toast('没有拉到模型，可以手动填'); return; }
          toast(`拉到 ${models.length} 个模型`);
          const s = sheet({ title: `选择模型（${models.length}）`, content: h('div.as-settings-models', models.map(m => h('button.as-actions__item' + (m === d.model ? '.is-active' : ''), { onclick: () => { useModel(m); s.close(); } }, h('span', m)))) });
        } catch (e) { toast('拉取失败：' + e.message); }
      }) }, icon('link', 13, 2), '拉取');
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
      // 豆包分 V3（2.0 音色，要资源 ID）和 V1（1.0 音色）；第三方语音可以选中转站转发的是哪家的格式
      if (d.type === 'doubao-tts') {
        const res = row('资源 ID', input({ value: d.resId || '', placeholder: 'seed-tts-2.0', onInput: v => { d.resId = v.trim(); touch(); } }));
        res.style.display = d.ver === 'v1' ? 'none' : '';
        extraRows.push(row('接口版本', segmented([['v3', 'V3（2.0 音色）'], ['v1', 'V1（1.0 音色）']], d.ver || 'v3', v => { d.ver = v; res.style.display = v === 'v1' ? 'none' : ''; touch(); })), res);
      }
      if (d.type === 'custom-tts') {
        const FMT = [['', 'OpenAI 格式'], ['minimax-cn', 'MiniMax 格式'], ['fish', 'Fish 格式'], ['elevenlabs', 'ElevenLabs 格式']];
        const fb = h('button.as-pbd__select', { onclick: async () => {
          const v = await actionSheet('接口格式', FMT.map(([k, l]) => ({ value: k || '-', label: l, active: (d.fmt || '') === k })));
          if (v == null) return; d.fmt = v === '-' ? '' : v; fb.firstChild.textContent = FMT.find(x => x[0] === d.fmt)[1]; touch(); rebuild();
        } }, h('span', (FMT.find(x => x[0] === (d.fmt || '')) || FMT[0])[1]), icon('chevron', 14, 2));
        extraRows.push(row('接口格式', fb));
      }
      b.append(row('名字', nameIn), row('类型', typeBtn), ...(tagIn ? [row('标签', tagIn)] : []), siteBox, ...extraRows, row('地址', baseIn), row('密钥', keyBox, (CHANNELS[kind].find(x => x.v === d.type) || {}).noKey ? '这个渠道可以不填密钥。' : '只存在这台设备上；导出数据时默认不带。有好几把的话，被拒或限流会自动换下一把。'),
        row('模型', h('div', h('div.as-pbd__line', modelIn, pull), modelBox)));
    }, true));
    if (kind === 'text') {
      const T = [['off', '关'], ['low', '低'], ['medium', '中'], ['high', '高']];
      groups.push(fold('生成参数', 'gear', () => `${(+d.params.temperature).toFixed(2)} · 推理${(T.find(x => x[0] === d.params.thinking) || T[0])[1]}${d.stream === false ? ' · 不流式' : ''}`, (b, re) => {
        const out = h('output.as-pbd__val', (+d.params.temperature).toFixed(2));
        const sl = slider({ min: 0, max: 2, step: .05, value: d.params.temperature, onInput: v => { d.params.temperature = v; out.textContent = v.toFixed(2); chips(); touch(); re(); } });
        const chipBox = h('div.as-pbd__chips');
        const chips = () => { chipBox.innerHTML = ''; [0, .3, .7, 1, 1.3].forEach(v => chipBox.appendChild(h('button' + (Math.abs(d.params.temperature - v) < .001 ? '.is-on' : ''), { onclick: () => { d.params.temperature = v; sl.value = v; out.textContent = v.toFixed(2); chips(); touch(); re(); } }, v.toFixed(1)))); };
        chips();
        b.append(row('温度', h('div.as-pbd__line', sl, out), '越低越稳，越高越放飞。单个聊天里还能另外设。'), chipBox,
          row('推理深度', segmented(T, d.params.thinking, v => { d.params.thinking = v; touch(); re(); }), '开了会先想一想再回，更聪明但更慢、更贵。模型不支持的话会报错，关掉就好。'),
          h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '流式输出'), switchEl(d.stream !== false, v => { d.stream = v; touch(); re(); }, '流式输出')));
      }, true));
      if (d.type === 'claude') groups.push(fold('高级', 'list', () => d.adv.cache ? '缓存开' : '缓存关', (b, re) => {
        b.append(h('div.as-pbd__row.is-inline', h('span.as-pbd__label', '提示词缓存'), switchEl(d.adv.cache, v => { d.adv.cache = v; touch(); re(); }, '提示词缓存')),
          h('p.as-pbd__hint', '每次都一样的人设、设定会走缓存，按便宜很多的缓存价算，回得也更快。'));
      }));
    }
    if (kind === 'image') groups.push(fold('画风', 'image', () => `${(d.imgSets || []).find(x => x.id === (d.imgSet || ''))?.name || '默认方案'} · ${d.img.size}`, (b, re, rebuild) => {
      const t = d.type, I = d.img, oai = t === 'openai-image' || t === 'image-compat';
      // 生图方案：一整套参数存起来，点一下换（换之前把现在这套存回它自己那格）
      const sets = d.imgSets || (d.imgSets = [{ id: '', name: '默认方案' }]), cur = d.imgSet || '';
      const stash = () => { sets.find(x => x.id === cur).img = JSON.parse(JSON.stringify(d.img)); };
      const go = id => { stash(); d.img = Object.assign({ size: '1024x1024', tags: '', neg: '' }, JSON.parse(JSON.stringify(sets.find(x => x.id === id).img || {}))); d.imgSet = id; touch(); rebuild(); };
      const chips = h('div.as-chips', sets.map(x => h('button.as-chip' + (x.id === cur ? '.is-active' : ''), { onclick: () => x.id !== cur && go(x.id) }, x.name)));
      const acts = h('div.as-pbd__danger',
        h('button', { onclick: async () => { const n = await dialog({ title: '新建方案', input: { value: `方案 ${sets.length + 1}` } }); if (!n || !n.trim()) return; stash(); const id = uid('is'); sets.push({ id, name: n.trim().slice(0, 12), img: JSON.parse(JSON.stringify(d.img)) }); d.imgSet = id; touch(); rebuild(); } }, '新建方案'),
        ...(cur ? [h('button', { onclick: async () => { const x = sets.find(y => y.id === cur), n = await dialog({ title: '改名', input: { value: x.name } }); if (n && n.trim()) { x.name = n.trim().slice(0, 12); touch(); rebuild(); } } }, '改名'),
          h('button.is-danger', { onclick: async () => { if (!(await dialog({ title: '删掉这个方案？', confirm: '删除', danger: true }))) return; d.imgSets = sets.filter(x => x.id !== cur); d.imgSet = ''; d.img = Object.assign({ size: '1024x1024', tags: '', neg: '' }, sets[0].img || {}); touch(); rebuild(); } }, '删除')] : []));
      // 尺寸：随便填，下面几个常用的点一下就填好（每家常用的不一样）
      const SIZES = oai ? ['1024x1024', '1024x1536', '1536x1024'] : t === 'novelai' ? ['832x1216', '1216x832', '1024x1024'] : t === 'siliconflow' ? ['1024x1024', '768x1024', '1024x768'] : ['512x768', '768x512', '1024x1024'];
      const sizeIn = input({ value: I.size, placeholder: '宽x高', onInput: v => { I.size = v.replace(/[×*X ]/g, 'x'); touch(); re(); paintSz(); } });
      const szBox = h('div.as-pbd__chips'), paintSz = () => szBox.replaceChildren(...SIZES.map(v => h('button' + (I.size === v ? '.is-on' : ''), { onclick: () => { I.size = sizeIn.value = v; touch(); re(); paintSz(); } }, v.replace('x', '×'))));
      paintSz();
      const num = (k, ph) => input({ value: I[k] ?? '', type: 'number', placeholder: ph, onInput: v => { I[k] = v === '' ? undefined : +v; touch(); } });
      const txt = (k, ph, rows = 2) => textarea({ value: I[k] ?? '', rows, placeholder: ph, onInput: v => { I[k] = v; touch(); re(); } });
      const STEPS = { novelai: '28', 'sd-webui': '20', comfyui: '20', siliconflow: '20' }, CFG = { novelai: '5', 'sd-webui': '7', comfyui: '7', siliconflow: '7.5' };
      // 采样器：从这家支持的里面挑，不用手打（本地 SD / ComfyUI 先问它装了哪些）
      const sampLbl = h('span', I.sampler || (SAMPLERS[t] || [])[0] || '');
      const sampBtn = h('button.as-pbd__select', { onclick: async () => {
        const list = await busy(sampBtn, () => listSamplers(d)); if (!list) return;
        const v = await actionSheet('采样器', list.map(x => ({ value: x, label: x, active: x === sampLbl.textContent })));
        if (v) { I.sampler = v; sampLbl.textContent = v; touch(); }
      } }, sampLbl, icon('chevron', 14, 2));
      b.append(row('方案', h('div', chips)), acts,
        ...(oai ? [row(withInfo('请求方式', '生图接口：gpt-image、dall-e 这类画图模型用。聊天接口：图片夹在聊天回复里，Gemini 画图这类边聊边出图的模型用；有的中转站只开了这一条。'), segmented([['images', '生图接口'], ['chat', '聊天接口']], I.mode || 'images', v => { I.mode = v; touch(); }))] : []),
        row('尺寸（宽×高）', h('div', sizeIn, szBox)),
        ...(STEPS[t] ? [row('步数 / CFG', h('div.as-pbd__line', num('steps', STEPS[t]), num('scale', CFG[t])))] : []),
        ...(SAMPLERS[t] ? [row('采样器', sampBtn)] : []),
        ...(t !== 'siliconflow' ? [row('画师串', txt('tags', '画师串')), row('正面质量词', txt('quality', t === 'novelai' ? 'masterpiece, best quality, very aesthetic' : '自动加在每次提示词前面'))] : []),
        row('负面提示词', txt('neg', '负面提示词')),
        ...(t === 'comfyui' ? [row('自定义工作流（可空）', txt('workflow', 'ComfyUI「导出 (API)」的 JSON。占位符：%prompt% %negative_prompt% %seed% %width% %height% %steps% %scale% %sampler% %model%', 5))] : []));
    }));
    if (kind === 'tts') groups.push(fold('声音', 'mic', () => `${d.tts.voice || '默认音色'} · ${d.tts.speed}x`, (b, re) => {
      const sp = h('output.as-pbd__val', d.tts.speed + 'x'), vo = h('output.as-pbd__val', Math.round(d.tts.volume * 100) + '%');
      const chv = CHANNELS.tts.find(x => x.v === d.type) || {}, T = d.tts;
      const set = k => v => { T[k] = v; touch(); re(); };
      b.append(row('当前音色', voiceInput(() => d, T.voice, set('voice'), chv.voice ? '默认 ' + chv.voice : '音色 ID'), chv.note || ''),
        row('男声默认', voiceInput(() => d, T.male, set('male'))), row('女声默认', voiceInput(() => d, T.female, set('female'))),
        row('语速', h('div.as-pbd__line', slider({ min: .5, max: 2, step: .05, value: T.speed, onInput: v => { T.speed = +v.toFixed(2); sp.textContent = T.speed + 'x'; touch(); re(); } }), sp)),
        row('音量', h('div.as-pbd__line', slider({ min: .2, max: 1, step: .05, value: T.volume, onInput: v => { T.volume = v; vo.textContent = Math.round(v * 100) + '%'; touch(); } }), vo)),
        ...(isNew ? [] : [h('button.as-pbd__dash', { onclick: () => { s.close(); openVoicePage({ conn: orig, onChange: paintVoices }); } }, icon('mic', 15, 2), '音色库')]));
    }));
    if (!isNew) groups.push(h('div.as-pbd__danger', setDefault ? defBtn() : pinBtn(),
      h('button', { onclick: () => { const cp = { ...JSON.parse(JSON.stringify(d)), id: uid('conn'), name: (d.name || orig.name) + ' 副本', ok: undefined }; C()[kind].push(cp); commit('connections'); s.close(); toast('复制好了'); } }, '复制一份'),
      h('button.is-danger', { onclick: async () => {
        if (!(await dialog({ title: `删掉「${orig.name}」？`, text: '插在它上面的线会被拔下来。', confirm: '删除', danger: true }))) return;
        const list = C()[kind]; list.splice(list.indexOf(orig), 1);
        for (const k of Object.keys(C().defaults)) if (C().defaults[k] === orig.id) C().defaults[k] = '';
        commit('connections'); s.close(); refresh();
      } }, '删除')));
  }
  const save = h('button.as-pbd__save', { onclick: () => {
    if (tavern) { s.close(); return; }
    d.name = (d.name || '').trim() || `${(CHANNELS[kind].find(x => x.v === d.type) || {}).label} ${d.model || ''}`.trim();
    d.keys = d.keys.filter(k => String(k).trim());
    if (d.model && d.models && !d.models.includes(d.model)) d.models.push(d.model);
    if (isNew) { C()[kind].push(d); const k0 = kind === 'embed' ? auxKey(tagOf(d)) : kind; if (!C().defaults[k0]) C().defaults[k0] = d.id; }   // 这一类（这个标签）还没插：新的直接插上
    else { Object.assign(orig, d); if (status[orig.id] === 'ok' || status[orig.id] === 'bad') orig.ok = status[orig.id] === 'ok'; }
    commit('connections'); dirty = false;
    toast('保存好了'); s.close(); refresh();
  } }, tavern ? '好的' : '保存');
  const s = sheet({ title: '接口详情', cls: 'as-pbd', content: h('div.as-pbd__wrap', card, ...groups, h('div.as-pbd__bar', h('button.as-pbd__cancel', { onclick: () => { dirty = false; s.close(); } }, '取消'), save)), onClose: () => { if (dirty && !isNew) toast('改动没保存'); } });
}

