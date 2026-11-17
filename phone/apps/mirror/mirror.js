// 映像：每个人一面碎镜子，5 片各管一类（资料、声音与语言、生图、立绘、世界书）。
// 碎片里映着这个人的图，每片默认对着图的不同地方（眼睛、嘴、脸、身子、角落）；光藏在碎片后面，朝光那头发白。
// 点一片：它浮到前面、描边发亮，整面镜子挪到左边，右边一栏列出这一类的几项；点一项它按下去，上面出来能改的。
import { h } from '../../core/util.js';
import { state, commit, contact, chatForContact } from '../../core/store.js';
import { page, input, textarea, segmented, btn, toast, empty, pickImage, dateField } from '../../core/ui.js';
import { LANGS, langName, langFor } from '../../core/translate.js';
import { nameOf } from '../chat/engine.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, a = {}) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
// 碎片在 393×852 的画布上：形状、离你多远（z）、往哪斜、图对着哪（fx fy 是图上的比例位置，k 放大）、字放在哪个角
const SH = [
  { n: '资料', p: [[-1, 159], [154, 138], [127, 217], [170, 252], [85, 360], [-1, 307]], z: 10, rx: 6, ry: -12, fx: .5, fy: .3, k: 2.2, t: [18, 300] },
  { n: '声音与语言', p: [[176, 193], [290, 149], [389, 168], [376, 304], [397, 381], [259, 358], [220, 275]], z: -40, rx: -8, ry: 14, fx: .5, fy: .56, k: 2, t: [300, 330] },
  { n: '生图', p: [[139, 326], [231, 303], [254, 341], [303, 385], [280, 540], [208, 595], [111, 509], [129, 429], [76, 394]], z: 70, rx: -4, ry: 6, fx: .5, fy: .45, k: 1.1, t: [132, 490] },
  { n: '立绘', p: [[-5, 458], [63, 440], [130, 497], [113, 599], [147, 730], [-5, 676]], z: -60, rx: 10, ry: -10, fx: .5, fy: .8, k: 1.3, t: [16, 650] },
  { n: '世界书', p: [[190, 592], [321, 520], [396, 584], [382, 674], [400, 766], [265, 794], [236, 691]], z: 20, rx: -9, ry: 10, fx: .25, fy: .75, k: 1.5, t: [292, 738] },
];
const LT = [200, 440];   // 光藏在这一带的碎片后面（不画出来）

// 毛边：每条边切成小段往两边抖一点，偶尔崩一个小口；种子定死，每次打开都一样
function jag(pts) {
  let s = 7; const r = () => (s = s * 16807 % 2147483647) / 2147483647, o = [];
  pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length], n = Math.max(3, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 11)), nx = -(q[1] - p[1]), ny = q[0] - p[0], L = Math.hypot(nx, ny);
    for (let j = 0; j < n; j++) { const t = j / n, d = j ? (r() - .5) * 1.4 + (r() < .1 ? -2 : 0) : 0; o.push(`${(p[0] + (q[0] - p[0]) * t + nx / L * d).toFixed(1)},${(p[1] + (q[1] - p[1]) * t + ny / L * d).toFixed(1)}`); } });
  return o.join(' ');
}
const mid = p => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);

function shard(s, i, src, onTap) {
  const P = jag(s.p), c = mid(s.p), u = 'mz' + i, W = 300 * s.k, a = Math.atan2(LT[1] - c[1], LT[0] - c[0]), lx = Math.cos(a), ly = Math.sin(a);
  const grad = (id, o) => { const g = svg('linearGradient', { id: id + u, gradientUnits: 'userSpaceOnUse', x1: c[0] + lx * 130, y1: c[1] + ly * 130, x2: c[0] - lx * 120, y2: c[1] - ly * 120 }); o.forEach(([off, col, op]) => g.append(svg('stop', { offset: off, 'stop-color': col, 'stop-opacity': op }))); return g; };
  const blur = (id, d) => { const f = svg('filter', { id: id + u, x: '-30%', y: '-30%', width: '160%', height: '160%' }); f.append(svg('feGaussianBlur', { stdDeviation: d })); return f; };
  const clip = svg('clipPath', { id: 'c' + u }); clip.append(svg('polygon', { points: P }));
  const defs = svg('defs'); defs.append(clip, blur('b', 3), blur('d', 6 + Math.max(0, s.z) / 12),
    grad('w', [[0, '#fff', .7], [.22, '#f4f1ff', .32], [.45, '#fff', 0], [.8, '#060414', .2], [1, '#060414', .55]]),
    grad('r', [[0, '#fff', 1], [.5, '#eeeaff', .8], [1, '#b9b3e0', .35]]));
  const img = svg('image', { x: c[0] - s.fx * W, y: c[1] - s.fy * W, width: W, height: W, preserveAspectRatio: 'xMidYMid slice' });
  if (src) img.setAttribute('href', src);
  const body = svg('g', { 'clip-path': `url(#c${u})` });
  body.append(svg('rect', { width: 393, height: 852, fill: '#1c1a2e' }), img, svg('rect', { width: 393, height: 852, fill: `url(#w${u})` }),
    svg('polygon', { points: P, fill: 'none', stroke: '#fff', 'stroke-opacity': .55, 'stroke-width': 8, filter: `url(#b${u})` }));
  const el = svg('svg', { viewBox: '0 0 393 852', class: 'mz-shard' });
  el.append(defs, svg('polygon', { points: P, fill: '#000', opacity: .7, transform: `translate(${8 + s.z / 8} ${14 + s.z / 5})`, filter: `url(#d${u})` }),
    svg('polygon', { points: P, class: 'mz-glow', fill: 'none', stroke: '#dcd7ff', 'stroke-width': 6, filter: `url(#b${u})` }), body,
    svg('polygon', { points: P, class: 'mz-rim', fill: 'none', stroke: `url(#r${u})`, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    Object.assign(svg('polygon', { points: P, fill: 'transparent' }), { onclick: e => { e.stopPropagation(); onTap(i); } }));
  el.style.cssText = `transform-origin:${c[0] / 3.93}% ${c[1] / 8.52}%;--z:${s.z}px;--rx:${s.rx}deg;--ry:${s.ry}deg`;
  return { el, img, c };
}

// 背景：满屏的星，一条银河斜着穿过去（不集中在中间），画一次
function sky(cv) {
  const d = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth || 393, H = cv.clientHeight || 852;
  cv.width = W * d; cv.height = H * d; const g = cv.getContext('2d'); g.scale(d, d);
  let s = 31; const r = () => (s = s * 16807 % 2147483647) / 2147483647, gs = () => (r() + r() + r() + r() - 2) / 2;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#060a1c'); bg.addColorStop(.5, '#05061a'); bg.addColorStop(1, '#030309'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const band = t => [-.15 * W + t * 1.3 * W, H * 1.05 - t * 1.15 * H], nx = .88, ny = .47;
  const dot = (x, y, rad, a, col) => { g.fillStyle = `rgba(${col},${a})`; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); };
  const COL = ['255,255,255', '210,225,255', '255,236,215', '190,205,255', '255,215,230'];
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 46; k++) { const [x, y] = band(r()), o = gs() * 50, cx = x + nx * o, cy = y + ny * o, rad = 50 + r() * 90, col = [[110, 120, 220], [170, 110, 200], [90, 150, 210], [210, 150, 190], [120, 100, 190]][k % 5];
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad); rg.addColorStop(0, `rgba(${col},${.07 + r() * .06})`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
  for (let k = 0; k < 5200; k++) { const [x, y] = band(r()), o = gs() * 70; dot(x + nx * o + gs() * 8, y + ny * o + gs() * 8, r() < .96 ? .32 + r() * .3 : .7, .25 + r() * .6, COL[k % 5]); }
  for (let k = 0; k < 1300; k++) dot(r() * W, r() * H, r() < .93 ? .3 + r() * .35 : .7 + r() * .5, .2 + r() * .7, COL[k % 5]);
  g.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 30; k++) { const [x, y] = band(r()), o = gs() * 14, cx = x + nx * o, cy = y + ny * o, rad = 18 + r() * 30; const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad); rg.addColorStop(0, 'rgba(3,4,12,.35)'); rg.addColorStop(1, 'rgba(3,4,12,0)'); g.fillStyle = rg; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 14; k++) { const x = r() * W, y = r() * H, a = .5 + r() * .5, L = 4 + r() * 9, rg = g.createRadialGradient(x, y, 0, x, y, L);
    rg.addColorStop(0, `rgba(255,255,255,${a})`); rg.addColorStop(.25, `rgba(200,215,255,${a * .25})`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(x - L, y - L, L * 2, L * 2);
    g.strokeStyle = `rgba(230,236,255,${a * .55})`; g.lineWidth = .5; g.beginPath(); g.moveTo(x - L * 1.3, y); g.lineTo(x + L * 1.3, y); g.moveTo(x, y - L * 1.3); g.lineTo(x, y + L * 1.3); g.stroke(); }
}

/* 每一类有哪几项：value 是卡片上显示的，edit 是按下去后上面出来的（改了就存，只换这张卡片上的字） */
function rowsOf(i, c, done) {
  const ch = () => chatForContact(c.id, true).cfg;
  const text = (k, ph) => ({ value: () => c[k] || '', edit: set => input({ value: c[k] || '', placeholder: ph, onInput: v => { c[k] = v; commit('contacts'); set(); } }) });
  if (i === 0) return [
    ['头像', { value: () => (c.avatar ? '换一张' : '没有'), edit: set => btn('换头像', 'secondary', async () => { const v = await pickImage('头像', { has: !!c.avatar }); if (v == null) return; c.avatar = v; commit('contacts'); set(); done(); }) }],
    ['真名', text('name', '真名')], ['网名', text('nick', '网名')], ['备注', text('remark', '备注')],
    ['性别', { value: () => c.gender || '不写', edit: set => segmented([['', '不写'], ['男', '男'], ['女', '女'], ['其他', '其他']], c.gender || '', v => { c.gender = v; commit('contacts'); set(); }) }],
    ['生日', { value: () => c.birthday || '没填', edit: set => dateField(c.birthday || '', v => { c.birthday = v; commit('contacts'); set(); }, true) }],
    ['人设', { value: () => (c.persona ? c.persona.slice(0, 12) + '…' : c.charKey ? '用角色卡的' : '没写'), edit: set => textarea({ value: c.persona || '', rows: 8, placeholder: c.charKey ? '留空就用角色卡里的人设' : '人设', onInput: v => { c.persona = v; commit('contacts'); set(); } }) }],
  ];
  if (i === 1) return [
    ['说的语言', { value: () => (ch().speak ? '' : '跟着总的 · ') + langName(langFor('chat', ch().speak)), edit: set => h('div.mz-chips', [['', '跟着总的'], ...LANGS].map(([v, l]) => {
      const b = h('button' + ((ch().speak || '') === v ? '.is-on' : ''), { onclick: () => { ch().speak = v; commit('chats'); b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b)); set(); } }, l);
      return b; })) }],
    ['声音', { value: () => '渠道、音色、读音', edit: () => btn('打开声音设置', 'secondary', () => import('../settings/voices.js').then(m => m.openPerson(c.id))) }],
  ];
  return [];
}

export function open() {
  const people = () => state.contacts;
  let cur = people()[0], focus = -1;
  const p = page({ app: 'mirror', id: 'mirror-home', title: '', back: true, cls: 'as-mz' });
  const cv = h('canvas.mz-sky'), stage = h('div.mz-stage'), side = h('aside.mz-side'), roster = h('div.mz-roster');
  const nm = h('b'), real = h('small'), head = h('div.mz-head', nm, real);
  p.nav.querySelector('.as-navbar__title').replaceWith(head);
  p.nav.querySelector('.as-navbar__right').append(roster);
  const tags = [], parts = SH.map((s, i) => {
    const sh = shard(s, i, '', at); stage.append(sh.el);
    const t = h('div.mz-tag', { style: { left: s.t[0] / 3.93 + '%', top: s.t[1] / 8.52 + '%' }, onclick: e => { e.stopPropagation(); at(i); } }, h('em', i + 1), h('b', s.n));
    tags.push(t); stage.append(t); return sh;
  });
  const meteors = [h('i.mz-meteor'), h('i.mz-meteor.is-b')];
  p.el.prepend(cv, ...meteors);
  stage.onclick = () => at(-1);
  // 换人：只换图、名字和头像排里的亮的那个，碎片不重画
  function show(c) {
    cur = c; at(-1);
    parts.forEach(sh => (c.avatar ? sh.img.setAttribute('href', c.avatar) : sh.img.removeAttribute('href')));
    nm.textContent = nameOf(c); real.textContent = c.name && c.name !== nameOf(c) ? '真名 ' + c.name : '';
    roster.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.id === c.id));
  }
  const paintRoster = () => roster.replaceChildren(...people().map(c => h('button' + (c === cur ? '.is-on' : ''), { dataset: { id: c.id }, 'aria-label': nameOf(c), onclick: () => show(c) },
    c.avatar ? h('img', { src: c.avatar, alt: '' }) : h('span', nameOf(c).slice(0, 1)))));
  // 点一片：它浮上来，整面镜子挪到左边，右边一栏是这一类的几项
  function at(i) {
    if (i === focus) i = -1;
    focus = i;
    p.el.classList.toggle('is-focus', i >= 0);
    parts.forEach((sh, k) => sh.el.classList.toggle('is-on', k === i));
    tags.forEach((t, k) => t.classList.toggle('is-on', k === i));
    stage.style.transform = i < 0 ? '' : `translate(${(110 - parts[i].c[0]) / 3.93}%, ${(430 - parts[i].c[1]) / 8.52}%)`;
    if (i < 0) { side.replaceChildren(); return; }
    const rows = rowsOf(i, cur, () => { parts.forEach(sh => sh.img.setAttribute('href', cur.avatar)); paintRoster(); }), box = h('div.mz-edit');
    const cards = rows.map(([label, r]) => {
      const v = h('span', r.value()), card = h('button.mz-card', { onclick: () => {
        cards.forEach(x => x.classList.toggle('is-down', x === card));
        box.replaceChildren(h('small', label), r.edit(() => { v.textContent = r.value(); if (label !== '人设') show2(); }));
      } }, h('small', label), v);
      return card;
    });
    side.replaceChildren(h('h3', h('em', i + 1), SH[i].n), rows.length ? box : h('p.mz-soon', '下一步做'), h('div.mz-cards', cards));
    if (cards[0]) cards[0].click();
  }
  const show2 = () => { nm.textContent = nameOf(cur); real.textContent = cur.name && cur.name !== nameOf(cur) ? '真名 ' + cur.name : ''; };
  p.body.append(stage, side);
  if (!cur) p.body.append(empty('还没有人，先去聊天里加个联系人'));
  requestAnimationFrame(() => sky(cv));
  paintRoster(); if (cur) show(cur);
  p.el._onShow = () => { if (!people().includes(cur)) { cur = people()[0]; paintRoster(); if (cur) show(cur); } };
  return p.el;
}
