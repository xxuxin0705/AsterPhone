// 映像：每个人一面碎镜子，5 片各管一类（资料、声音与语言、生图、立绘、世界书）。
// 碎片里映着这个人的图，每片默认对着图的不同地方（眼睛、嘴、脸、身子、角落）；光藏在碎片后面，朝光那头发白。
// 点一片：它浮到前面、描边发亮，整面镜子挪到左边，右边一栏列出这一类的几项；点一项它按下去，上面出来能改的。
// 碎片里的图：默认都用「主图」（没设就用头像），每片也能单独换一张；点开那片后在它上面拖动挪位置、两指捏放大缩小。
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit, contact, chatForContact } from '../../core/store.js';
import { page, navBtn, input, textarea, segmented, btn, toast, empty, pickImage, dateField, nudger } from '../../core/ui.js';
import { worldNames } from '../../core/bridge.js';
import * as PT from '../../core/portrait.js';
import { LANGS, langName, langFor } from '../../core/translate.js';
import { nameOf } from '../chat/engine.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, a = {}) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
// 碎片在 393×852 的画布上：形状、离你多远（z）、往哪斜、图对着哪（fx fy 是图上的比例位置，k 放大）、字放在哪个角
const SH = [
  { n: '资料', p: [[-1, 159], [154, 138], [127, 217], [170, 252], [85, 360], [-1, 307]], z: 10, rx: 6, ry: -12, fx: .5, fy: .3, k: 2.2, t: [18, 300] },
  { n: '声音与语言', p: [[176, 193], [290, 149], [389, 168], [376, 304], [397, 381], [259, 358], [220, 275]], z: -40, rx: -8, ry: 14, fx: .5, fy: .56, k: 2, t: [300, 330] },
  { n: '生图', p: [[139, 326], [231, 303], [254, 341], [303, 385], [280, 540], [208, 595], [111, 509], [129, 429], [76, 394]], z: 70, rx: -4, ry: 6, fx: .5, fy: .45, k: 1.1, t: [132, 490] },
  { n: '立绘', p: [[-5, 458], [63, 440], [130, 497], [113, 599], [147, 730], [-5, 676]], z: -60, rx: 10, ry: -10, fx: .5, fy: .68, k: 1.6, t: [16, 650] },
  { n: '世界书', p: [[190, 592], [321, 520], [396, 584], [382, 674], [400, 766], [265, 794], [236, 691]], z: 20, rx: -9, ry: 10, fx: .3, fy: .66, k: 1.7, t: [292, 738] },
];
const LT = [200, 480];   // 光藏在这一带的碎片后面（不画出来）
// 每片往自己中心收一点、大小拉开（3 最大，2、4 最小），片和片之间留出黑缝；字放在离光最远的那个角上
SH.forEach((s, i) => { const k = [.84, .78, .96, .76, .82][i], m = s.p.reduce((a, q) => [a[0] + q[0] / s.p.length, a[1] + q[1] / s.p.length], [0, 0]);
  s.p = s.p.map(([x, y]) => [m[0] + (x - m[0]) * k, m[1] + (y - m[1]) * k + 40]);
  const far = s.p.reduce((b, q) => (Math.hypot(q[0] - LT[0], q[1] - LT[1]) > Math.hypot(b[0] - LT[0], b[1] - LT[1]) ? q : b));
  s.t = [far[0] + (m[0] - far[0]) * .3, far[1] + (m[1] - far[1]) * .3]; });

// 毛边：每条边切成小段往两边抖一点，偶尔崩一个小口；种子定死，每次打开都一样
function jag(pts) {
  let s = 7; const r = () => (s = s * 16807 % 2147483647) / 2147483647, o = [];
  pts.forEach((p, k) => { const q = pts[(k + 1) % pts.length], n = Math.max(3, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 11)), nx = -(q[1] - p[1]), ny = q[0] - p[0], L = Math.hypot(nx, ny);
    for (let j = 0; j < n; j++) { const t = j / n, d = j ? (r() - .5) * 1.4 + (r() < .1 ? -2 : 0) : 0; o.push(`${(p[0] + (q[0] - p[0]) * t + nx / L * d).toFixed(1)},${(p[1] + (q[1] - p[1]) * t + ny / L * d).toFixed(1)}`); } });
  return o.join(' ');
}
const mid = p => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);

function shard(s, i, onTap) {
  const P = jag(s.p), c = mid(s.p), u = 'mz' + i, a = Math.atan2(LT[1] - c[1], LT[0] - c[0]), lx = Math.cos(a), ly = Math.sin(a);
  const grad = (id, o) => { const g = svg('linearGradient', { id: id + u, gradientUnits: 'userSpaceOnUse', x1: c[0] + lx * 130, y1: c[1] + ly * 130, x2: c[0] - lx * 120, y2: c[1] - ly * 120 }); o.forEach(([off, col, op]) => g.append(svg('stop', { offset: off, 'stop-color': col, 'stop-opacity': op }))); return g; };
  const blur = (id, d) => { const f = svg('filter', { id: id + u, x: '-30%', y: '-30%', width: '160%', height: '160%' }); f.append(svg('feGaussianBlur', { stdDeviation: d })); return f; };
  const clip = svg('clipPath', { id: 'c' + u }); clip.append(svg('polygon', { points: P }));
  const defs = svg('defs'); defs.append(clip, blur('b', 3), blur('d', 6 + Math.max(0, s.z) / 12),
    grad('w', [[0, '#fff', .5], [.18, '#f4f1ff', .16], [.4, '#fff', 0], [.82, '#060414', .28], [1, '#060414', .62]]),
    grad('r', [[0, '#fff', 1], [.5, '#eeeaff', .8], [1, '#b9b3e0', .35]]));
  const img = svg('image', { preserveAspectRatio: 'xMidYMid slice' });
  // 图上 (fx, fy) 那一点对准这片的中间，k 是放大
  const place = (src, fx, fy, k) => { const W = 300 * k; if (src) img.setAttribute('href', src); else img.removeAttribute('href');
    Object.entries({ x: c[0] - fx * W, y: c[1] - fy * W, width: W, height: W }).forEach(([key, v]) => img.setAttribute(key, v)); };
  const body = svg('g', { 'clip-path': `url(#c${u})` });
  body.append(svg('rect', { width: 393, height: 852, fill: '#1c1a2e' }), img, svg('rect', { width: 393, height: 852, fill: `url(#w${u})` }),
    svg('polygon', { points: P, fill: 'none', stroke: '#fff', 'stroke-opacity': .35, 'stroke-width': 7, filter: `url(#b${u})` }));
  const el = svg('svg', { viewBox: '0 0 393 852', class: 'mz-shard' });
  el.append(defs, svg('polygon', { points: P, fill: '#000', opacity: .7, transform: `translate(${8 + s.z / 8} ${14 + s.z / 5})`, filter: `url(#d${u})` }),
    svg('polygon', { points: P, class: 'mz-glow', fill: 'none', stroke: '#dcd7ff', 'stroke-width': 6, filter: `url(#b${u})` }), body,
    svg('polygon', { points: P, fill: 'none', stroke: '#fff', 'stroke-opacity': .22, transform: 'translate(1.6 2.2)' }),   // 玻璃的厚度：错开一点的第二道边
    svg('polygon', { points: P, class: 'mz-rim', fill: 'none', stroke: `url(#r${u})`, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    Object.assign(svg('polygon', { points: P, fill: 'transparent' }), { onclick: e => { e.stopPropagation(); onTap(i); } }));
  el.style.cssText = `transform-origin:${c[0] / 3.93}% ${c[1] / 8.52}%;--z:${s.z}px;--rx:${s.rx}deg;--ry:${s.ry}deg`;
  return { el, c, place };
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

/* 每一类有哪几项：value 是卡片上显示的，edit 是按下去后上面出来的（改了就存，只换这张卡片上的字）。
   x：{ pic 重摆碎片的图, roster 重画头像排 } */
const BOOK_APPS = [['', '所有应用'], ['chat', '聊天'], ['forum', '论坛'], ['diary', '日记'], ['radio', '电台'], ['interlude', '幕间']];
let bookApp = '', picScope = 'one';
const mirrorOf = c => (c.mirror ||= { main: '', shards: {} });
const thumb = src => h('img.mz-thumb', { src, alt: '' });
const pickPic = async size => { const f = await pickFile('image/*'); return f && fileToDataURL(f, size); };
function rowsOf(i, c, x) {
  const ch = () => chatForContact(c.id, true).cfg, M = mirrorOf(c), save = k => { commit('contacts'); if (k) x[k](); };
  const text = (k, ph) => ({ value: () => c[k] || '', edit: set => input({ value: c[k] || '', placeholder: ph, onInput: v => { c[k] = v; save(); set(); } }) });
  const choose = (opts, cur, on) => h('div.mz-chips', opts.map(([v, l]) => { const b = h('button' + (cur === v ? '.is-on' : ''), { onclick: async () => {
    if (await on(v) === false) return; b.parentNode.querySelectorAll('button').forEach(y => y.classList.toggle('is-on', y === b)); } }, l); return b; }));
  // 图片：改「整张」（主图，所有没单独换过的碎片都映着它）或「这一片」；能换图、上下左右微调、放大缩小、还原。也能直接在点开的碎片上拖、两指捏
  const own = ['图片', { value: () => (M.shards[i]?.src ? '这片单独一张' : M.main ? '整张：另传的' : '整张：头像'), edit: set => {
    const whole = picScope === 'all', o = () => (whole ? (M.pos ||= {}) : (M.shards[i] ||= {}));
    const step = (dx, dy, dk) => { const p = o(), d = whole ? { fx: 0, fy: 0, k: 1 } : { fx: SH[i].fx, fy: SH[i].fy, k: SH[i].k };
      if (dk) p.k = Math.max(.3, Math.min(6, (p.k ?? d.k) * dk)); else { p.fx = (p.fx ?? d.fx) + dx * .01; p.fy = (p.fy ?? d.fy) + dy * .01; } save('pic'); };
    const reset = () => { if (whole) delete M.pos; else if (M.shards[i]?.src) M.shards[i] = { src: M.shards[i].src }; else delete M.shards[i]; save('pic'); };
    const up = whole ? choose([['avatar', '用头像'], ['pt', '用立绘'], ['pick', '传一张']], M.main ? '' : 'avatar', async v => {
      if (v === 'pt') { const p = PT.loaded(c.id); if (!p) { toast('还没有立绘，先去照相馆'); return false; } M.main = p.base; }
      else if (v === 'pick') { const p = await pickPic(1280); if (!p) return false; M.main = p; } else M.main = '';
      save('pic'); set(); x.reopen(); })
      : h('div.mz-chips', h('button', { onclick: async () => { const v = await pickPic(1080); if (!v) return; M.shards[i] = { src: v }; save('pic'); x.reopen(); } }, M.shards[i]?.src ? '换一张' : '这片单独传一张'),
        M.shards[i]?.src ? h('button', { onclick: () => { delete M.shards[i]; save('pic'); x.reopen(); } }, '用回整张') : '');
    return h('div.mz-col', x.whole ? '' : choose([['all', '整张'], ['one', '这一片']], picScope, v => { picScope = v; x.reopen(); }),
      (whole ? M.main : M.shards[i]?.src) ? thumb(whole ? M.main : M.shards[i].src) : '', up,
      h('div.mz-fine', nudger((dx, dy) => step(-dx, -dy), reset),
        h('div.mz-zoom', ...[['放大', 1.04], ['缩小', 1 / 1.04]].map(([l, k]) => h('button', { type: 'button', onclick: () => step(0, 0, k) }, l)))));
  } }];
  if (i === 0) return [
    ['头像', { value: () => (c.avatar ? '换一张' : '没有'), edit: set => btn('换头像', 'secondary', async () => { const v = await pickImage('头像', { has: !!c.avatar }); if (v == null) return; c.avatar = v; save('pic'); x.roster(); set(); }) }],
    ['真名', text('name', '真名')], ['网名', text('nick', '网名')], ['备注', text('remark', '备注')],
    ['性别', { value: () => c.gender || '不写', edit: set => segmented([['', '不写'], ['男', '男'], ['女', '女'], ['其他', '其他']], c.gender || '', v => { c.gender = v; save(); set(); }) }],
    ['生日', { value: () => c.birthday || '没填', edit: set => dateField(c.birthday || '', v => { c.birthday = v; save(); set(); }, true) }],
    ['人设', { value: () => (c.persona ? c.persona.slice(0, 12) + '…' : c.charKey ? '用角色卡的' : '没写'), edit: set => textarea({ value: c.persona || '', rows: 8, placeholder: c.charKey ? '留空就用角色卡里的人设' : '人设', onInput: v => { c.persona = v; save(); set(); } }) }],
    own,
  ];
  if (i === 1) return [
    ['说的语言', { value: () => (ch().speak ? '' : '跟着总的 · ') + langName(langFor('chat', ch().speak)), edit: set => choose([['', '跟着总的'], ...LANGS], ch().speak || '', v => { ch().speak = v; commit('chats'); set(); }) }],
    ['声音', { value: () => '渠道、音色、读音', edit: () => btn('打开声音设置', 'secondary', () => import('../settings/voices.js').then(m => m.openPerson(c.id))) }],
    own,
  ];
  // 生图：画到 TA 的时候（聊天发的照片、日记配图）前面加上外貌；能照图画的渠道还会带上参考图
  if (i === 2) return [
    ['外貌', { value: () => c.look || '没写', edit: set => textarea({ value: c.look || '', rows: 6, placeholder: '外貌', onInput: v => { c.look = v.trim(); save(); set(); } }) }],
    ['参考图', { value: () => (c.lookRef ? '有' : '不用'), edit: set => h('div.mz-col', c.lookRef ? thumb(c.lookRef) : '', choose([['avatar', '用头像'], ['pick', '传一张'], ['', '不用']], '', async v => {
      if (v === 'avatar') { if (!c.avatar) { toast('还没有头像'); return false; } c.lookRef = c.avatar; }
      else if (v === 'pick') { const p = await pickPic(1024); if (!p) return false; c.lookRef = p; } else delete c.lookRef;
      save(); set(); x.reopen(); })) }],
    // 种子：同一个种子 + 同样的外貌，画出来的脸更像同一个人。NAI / SD / ComfyUI / 硅基流动认，OpenAI 这类没有种子
    ['种子', { value: () => (c.seed === undefined ? '每次随机' : String(c.seed)), edit: set => {
      const box = input({ type: 'number', value: c.seed ?? '', placeholder: '种子', onInput: v => { if (v === '') delete c.seed; else c.seed = Math.max(0, Math.floor(+v) || 0); save(); set(); } });
      return h('div.mz-col', box, h('div.mz-chips', h('button', { onclick: () => { c.seed = Math.floor(Math.random() * 4294967295); box.value = c.seed; save(); set(); } }, '随机定一个'),
        h('button', { onclick: () => { delete c.seed; box.value = ''; save(); set(); } }, '每次随机'))); } }],
    own,
  ];
  // 立绘：照相馆里做的；主图（碎片里映着的那张）可以用头像、立绘或者另传一张
  if (i === 3) return [
    ['立绘', { value: () => (PT.loaded(c.id) ? `${PT.versions(c.id).length} 张` : '还没有'), edit: () => h('div.mz-col',
      PT.versions(c.id).length ? h('div.mz-strip', PT.versions(c.id).map((v, k) => h('button' + (k === PT.using(c.id) ? '.is-on' : ''), { onclick: e => PT.useVersion(c.id, k).then(() => e.currentTarget.parentNode.querySelectorAll('button').forEach((b, j) => b.classList.toggle('is-on', j === k))) }, thumb(v.base)))) : '',
      btn('去照相馆', 'secondary', () => import('../street/studio.js').then(m => m.person(c.id)))) }],
    own,
  ];
  // 世界书：每本书给 TA 定「带 / 不带」，写到 TA 的时候照这个。先选管哪里：「所有应用」是总的，选了某个 App 就是在总的上再加减
  const books = [...new Set([...worldNames(), ...Object.keys(c.books || {}), ...Object.values(c.appBooks || {}).flatMap(Object.keys)])];
  const tab = () => (bookApp ? ((c.appBooks ||= {})[bookApp] ||= {}) : (c.books ||= {}));
  const MODE = { '': bookApp ? '跟着所有应用' : '跟着酒馆', on: '带', off: '不带' };
  return [['用在哪', { value: () => (BOOK_APPS.find(a => a[0] === bookApp) || BOOK_APPS[0])[1], edit: () => choose(BOOK_APPS, bookApp, v => { bookApp = v; x.reopen(); }) }],
    ...books.map(n => [n, { value: () => MODE[tab()[n] || ''], edit: set => choose(Object.entries(MODE), tab()[n] || '', v => { if (v) tab()[n] = v; else delete tab()[n]; save(); set(); }) }]), own];
}

export function open() {
  const people = () => state.contacts;
  let cur = people()[0], focus = -1;
  const p = page({ app: 'mirror', id: 'mirror-home', title: '', back: true, cls: 'as-mz' });
  const cv = h('canvas.mz-sky'), stage = h('div.mz-stage'), side = h('aside.mz-side'), roster = h('div.mz-roster');
  const nm = h('b'), real = h('small'), head = h('div.mz-head', nm, real);
  p.nav.querySelector('.as-navbar__title').replaceWith(head);
  // 右上角的图片键：直接改整张图（换图、挪位置、大小），镜子缩到左边，5 片都看得见
  p.nav.querySelector('.as-navbar__right').append(navBtn('image', '整张图', () => (focus === 'all' ? at(-1) : whole())), roster);
  const tags = [], parts = SH.map((s, i) => {
    const sh = shard(s, i, at); stage.append(sh.el);
    const t = h('div.mz-tag', { style: { left: s.t[0] / 3.93 + '%', top: s.t[1] / 8.52 + '%', textAlign: s.t[0] > 196 ? 'right' : 'left', translate: s.t[0] > 196 ? '-100% -50%' : '0 -50%' }, onclick: e => { e.stopPropagation(); at(i); } }, h('em', i + 1), h('b', s.n));
    tags.push(t); stage.append(t); return sh;
  });
  const meteors = [h('i.mz-meteor'), h('i.mz-meteor.is-b')];
  p.el.prepend(cv, ...meteors);
  stage.onclick = () => at(-1);
  // 每片的图：单独换过的用自己的，没换的用主图（没设主图就用头像）；位置没挪过就照默认对着的地方
  const posOf = i => { const M = cur.mirror || {}, o = (M.shards || {})[i] || {}, a = (!o.src && M.pos) || {}, s = SH[i];
    return [o.src || M.main || cur.avatar || '', o.fx ?? s.fx + (a.fx || 0), o.fy ?? s.fy + (a.fy || 0), o.k ?? s.k * (a.k || 1)]; };
  const pics = () => parts.forEach((sh, i) => sh.place(...posOf(i)));
  // 点开一片后在它上面拖：挪图；两只手指：放大缩小。松手才存
  const pts = new Map(); let grab = null;
  stage.addEventListener('pointerdown', e => {
    if (focus < 0 || !e.target.closest('.mz-shard.is-on')) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]); e.target.setPointerCapture?.(e.pointerId);
    const [, fx, fy, k] = posOf(focus); grab = { fx, fy, k, at: [...pts.values()].map(p => [...p]), moved: false };
  });
  stage.addEventListener('pointermove', e => {
    if (!grab || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const now = [...pts.values()], u = 393 / stage.clientWidth / 1.12, sh = parts[focus], o = mirrorOf(cur).shards[focus] ||= {};
    if (now.length > 1 && grab.at.length > 1) { const d = (a, b) => Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || b; o.k = Math.max(.3, Math.min(6, grab.k * d(now, 1) / d(grab.at, 1))); }
    else { const dx = (now[0][0] - grab.at[0][0]) * u, dy = (now[0][1] - grab.at[0][1]) * u, W = 300 * (o.k ?? grab.k); o.fx = grab.fx - dx / W; o.fy = grab.fy - dy / W; }
    grab.moved = true; sh.place(...posOf(focus));
  });
  const drop = e => { pts.delete(e.pointerId); if (!grab) return; if (grab.moved) commit('contacts'); if (pts.size) { const [, fx, fy, k] = posOf(focus); grab = { fx, fy, k, at: [...pts.values()].map(p => [...p]), moved: grab.moved }; } else grab = null; };
  stage.addEventListener('pointerup', drop); stage.addEventListener('pointercancel', drop);
  // 换人：只换图、名字和头像排里的亮的那个，碎片不重画
  function show(c) {
    cur = c; at(-1);
    pics();
    nm.textContent = nameOf(c); real.textContent = c.name && c.name !== nameOf(c) ? '真名 ' + c.name : '';
    roster.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.id === c.id));
  }
  const paintRoster = () => roster.replaceChildren(...people().map(c => h('button' + (c === cur ? '.is-on' : ''), { dataset: { id: c.id }, 'aria-label': nameOf(c), onclick: () => show(c) },
    c.avatar ? h('img', { src: c.avatar, alt: '' }) : h('span', nameOf(c).slice(0, 1)))));
  // 点一片：它浮上来，整面镜子挪到左边，右边一栏是这一类的几项
  function at(i) {
    if (i === focus) return;   // 点开着的那片：是在挪图，不收回去
    focus = i;
    p.el.classList.toggle('is-focus', i >= 0);
    p.el.classList.remove('is-pic');
    parts.forEach((sh, k) => sh.el.classList.toggle('is-on', k === i));
    tags.forEach((t, k) => t.classList.toggle('is-on', k === i));
    stage.style.transform = i < 0 ? '' : `translate(${(110 - parts[i].c[0]) / 3.93}%, ${(430 - parts[i].c[1]) / 8.52}%)`;
    if (i < 0) { side.replaceChildren(); return; }
    const rows = rowsOf(i, cur, { pic: pics, roster: paintRoster, reopen: () => { const k = [...side.querySelectorAll('.mz-card')].findIndex(b => b.classList.contains('is-down')); focus = -1; at(i); side.querySelectorAll('.mz-card')[k]?.click(); } }), box = h('div.mz-edit');
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
  function whole() {
    if (!cur) return;
    at(-1); focus = 'all'; picScope = 'all';
    p.el.classList.add('is-focus', 'is-pic');
    stage.style.transform = 'translate(-17%, 6%) scale(.66)';
    const [, r] = rowsOf(0, cur, { pic: pics, roster: paintRoster, whole: true, reopen: whole }).at(-1);
    side.replaceChildren(h('h3', '整张图'), h('div.mz-edit', r.edit(() => {})));
  }
  const show2 = () => { nm.textContent = nameOf(cur); real.textContent = cur.name && cur.name !== nameOf(cur) ? '真名 ' + cur.name : ''; };
  p.body.append(stage, side);
  if (!cur) p.body.append(empty('还没有人，先去聊天里加个联系人'));
  requestAnimationFrame(() => sky(cv));
  PT.preload(people().map(c => c.id));
  paintRoster(); if (cur) show(cur);
  p.el._onShow = () => { if (focus === 3) { const k = focus; focus = -1; at(k); } if (!people().includes(cur)) { cur = people()[0]; paintRoster(); if (cur) show(cur); } };
  return p.el;
}
