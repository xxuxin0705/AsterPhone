// 日记：书桌上摆着每个角色的本子，点开左右翻，一页一篇（方案见 docs/pages-diary.md）。
// 一页：年月日、天气贴纸、蕾丝、拍立得里的配图（没图时写着画面和生图提示词，点一下生图 / 上传）、手写体正文；胶带、蕾丝小物、季节贴纸、多放的照片是能拖的贴纸。
// 胶带、蕾丝、邮票框、便签按这一篇的主题色换成淡色（AI 写的时候按剧情挑，自己能改）。
// 写日记、配图在 core/diary.js 里跑，退出这页也接着跑；同一个人同一时间只写一篇，回来按钮还是「取消」。
import { h, fileToDataURL, debounce } from '../../core/util.js';
import { state, contact, commit, subscribe } from '../../core/store.js';
import { page, navBtn, sheet, actionSheet, dialog, toast, btn, segmented, textarea, input, field, group, item, toggleItem, icon, empty, pickImage, colorWheel } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as Dy from '../../core/diary.js';
import * as M from '../../core/memory.js';
import { nameOf } from '../chat/engine.js';
import { userFonts } from '../../core/fonts.js';

const BASE = 'assets/diary/';
const COVERS = ['navy', 'sky', 'linen', 'frost-blue', 'frost-pink', 'lace-blue', 'lace-pink', 'traveler'];
const n_ = (k, n, skip = []) => [...Array(n).keys()].filter(i => !skip.includes(i)).map(i => k + i);
const TAPES = [...n_('tape', 8), ...n_('tape-pink', 8)], LACES = [...n_('lace', 12), ...n_('wlace', 8)], STICKERS = n_('wl', 31, [25]);
const PAPERS_ST = n_('paper', 17, [1, 9, 10, 14]);   // 纸片小物（拍立得框、回形针、干花不当贴纸）
const WEATHER = [[/台风/, 'typhoon'], [/雷/, 'thunder'], [/雪/, 'snow'], [/雾|霾/, 'fog'], [/太阳雨/, 'sun-rain'], [/夜.*雨/, 'night-rain'], [/小雨|毛毛|阵雨/, 'drizzle'], [/雨/, 'rain'],
  [/彩虹/, 'rainbow'], [/风/, 'wind'], [/夜.*[云阴]/, 'night-cloud'], [/夜|月|星/, 'moon'], [/晴.*云|云.*晴/, 'sunny-cloud'], [/云|阴/, 'cloudy'], [/晴|阳/, 'sun']];
const PAPERS = [['lined', '横线'], ['dots', '点点'], ['plain', '白纸']];
// 三种排版（参考手帐的「贴 + 便」）：0 拍立得在上、字在下；1 邮票贴在右边、字绕着走；2 小拍立得在左上、字写在一块便签上
const MODES = [['every', '跟着剧情'], ['hand', '只手动写']];
// 内置手写字体（中文网字计划，jsDelivr 按需下载，只在选中时才下）；字体库里导入的也能选（'u:id'）
const CDN = 'https://cdn.jsdelivr.net/npm/';
const FONTS = [['xiaolai', '小赖', '@chinese-fonts/xiaolai@3.0.0/dist/Xiaolai/result.css', 'Xiaolai SC'],
  ['yozai', '悠哉', '@chinese-fonts/yozai@3.0.0/dist/Yozai-Medium/result.css', 'Yozai Medium'],
  ['mkzyt', '猫啃珠圆', '@chinese-fonts/mkzyt@3.0.0/dist/%E7%8C%AB%E5%95%83%E7%8F%A0%E5%9C%86%E4%BD%93/result.css', 'MaokenZhuyuanTi'],
  ['qtbf', '千图笔锋手写', '@chinese-fonts/qtbfsxt@3.0.0/dist/%E5%8D%83%E5%9B%BE%E7%AC%94%E9%94%8B%E6%89%8B%E5%86%99%E4%BD%93/result.css', 'qiantubifengshouxieti'],
  ['wenkai', '霞鹜文楷', '@chinese-fonts/lxgwwenkai@3.0.0/dist/LXGWWenKai-Regular/result.css', 'LXGW WenKai']];
function fontOf(k = 'xiaolai') {
  const u = k.startsWith('u:') && userFonts().find(f => f.id === k.slice(2));
  if (u) return [u.name, `"AsterUser-${u.id}"`];
  const f = FONTS.find(x => x[0] === k) || FONTS[0];
  if (!document.querySelector(`link[data-aster-font="${f[2]}"]`)) document.head.append(h('link', { rel: 'stylesheet', href: CDN + f[2], dataset: { asterFont: f[2] } }));
  return [f[1], `"${f[3]}"`];
}
const useFont = (el, k) => { el.style.fontFamily = fontOf(k)[1] + ', "Kaiti SC", STKaiti, serif'; };
const WEEK = '日一二三四五六';
const cover = k => BASE + 'cover-' + k + '.webp';
const books = () => state.diary.books;
const free = () => state.contacts.filter(c => !Dy.bookOf(c.id));
const hash = s => [...String(s)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;
const ymd = at => at ? at.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '';
const jobs = new Map(), drawing = new Map();   // 正在写的（按人）、正在配图的（按篇）：退出再进来还能取消
// 能换色的（胶带、蕾丝、邮票框）：图先变灰，再按自己的形状叠一层主题色的淡色（--c0～--c2 由这一页的 --t 算出来，换主题色只改 --t）
// 遮罩的地址写成完整的：写在 style 里的相对地址会按 diary.css 所在的文件夹去找
const tint = (src, cls, slot, style = '') => h('span.as-dy-tint' + cls, { style: `--m:url(${new URL(src, location.href).href});--c:var(--c${slot});${style}` }, h('img', { src, alt: '' }));
const pickPhotos = () => new Promise(res => { const i = h('input', { type: 'file', accept: 'image/*', multiple: true }); i.onchange = () => res([...i.files].slice(0, 4)); i.click(); })
  .then(fs => Promise.all(fs.map(f => fileToDataURL(f, 1024)))).catch(() => { toast('有照片读不出来'); return []; });
// 图都解码好了再换上去，不闪
const swap = (old, n) => Promise.all([...n.querySelectorAll('img')].map(i => i.decode().catch(() => {}))).then(() => old.replaceWith(n));

/* ---------- 贴纸：能拖、两根手指缩放旋转（电脑上滚轮缩放，按住 Shift 滚轮旋转） ----------
   一张贴纸 { k 图, a 锚点('t' 从这一页顶上算 / 'e' 从正文后面那块空地算), x 横着的百分比, y 离锚点几 px, w 宽, r 转几度, s 放大几倍, t 换色用哪个颜色, src 照片 }
   没动过的一页按这一篇算出默认的几张（不存）；一动就整页存下来 */
function defaults(x, r) {
  const m = +x.at.slice(5, 7), season = /雪/.test(x.weather) || [12, 1, 2].includes(m) ? 'snow' : [3, 4, 5].includes(m) ? 'petal' : [9, 10, 11].includes(m) ? 'leaf' : '';
  return [
    { k: TAPES[r % TAPES.length], a: 't', x: 50, y: 8, w: 120, r: r % 9 - 4, s: 1, t: 0 },
    { k: STICKERS[(r >>> 4) % STICKERS.length], a: 'e', x: 76, y: 70, w: 104, r: (r >>> 8) % 31 - 15, s: 1, t: 1 },
    ...(season ? [0, 1].map(i => ({ k: season + (r + i) % 4, a: 'e', x: 16 + i * 20, y: 40 + i * 60, w: 56 - i * 14, r: (r >>> (i * 3)) % 61 - 30, s: 1 })) : []),
    ...(x.more || []).map((src, i) => ({ k: 'photo', src, a: 'e', x: 34 + i * 20, y: 120 + (i % 2) * 24, w: 96, r: (r >>> i) % 11 - 5, s: 1 })),
  ];
}
const paint = el => { const o = el._o; el.style.cssText = `left:${o.x}%;top:${o.y}px;width:${o.w}px;transform:translate(-50%,-50%) rotate(${o.r}deg) scale(${o.s})`; };
function stick(o, done, tap) {
  const el = h('div.as-dy-st' + (o.k === 'photo' ? '.is-photo' : ''), ...(o.k === 'photo'
    ? [tint(BASE + 'stamp' + hash(o.src.slice(-60)) % 4 + '.webp', '', 0), h('img.as-dy-st__pic', { src: o.src, alt: '照片' })]
    : [o.t != null ? tint(BASE + o.k + '.webp', '', o.t) : h('img', { src: BASE + o.k + '.webp', alt: '' })]));
  el._o = o; paint(el);
  const pts = new Map(); let g = null, moved = false;
  const pt = () => [...pts.values()], mid = p => ({ x: (p[0].x + (p[1] || p[0]).x) / 2, y: (p[0].y + (p[1] || p[0]).y) / 2 });
  const span = p => p[1] ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : 1, ang = p => p[1] ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) * 180 / Math.PI : 0;
  const begin = () => { const p = pt(); g = { o: { ...o }, c: mid(p), d: span(p), a: ang(p), W: el.offsetParent.clientWidth }; };
  el.addEventListener('pointerdown', e => { e.stopPropagation(); el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); begin(); });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pt(), c = mid(p);
    if (!moved && p.length < 2 && Math.hypot(c.x - g.c.x, c.y - g.c.y) < 5) return;
    moved = true;
    o.x = Math.min(100, Math.max(0, g.o.x + (c.x - g.c.x) / g.W * 100)); o.y = g.o.y + c.y - g.c.y;   // 横着不出这一页
    if (p.length > 1) { o.s = Math.min(3, Math.max(.3, g.o.s * span(p) / g.d)); o.r = g.o.r + ang(p) - g.a; }
    paint(el);
  });
  const up = e => { if (!pts.delete(e.pointerId)) return; if (pts.size) { begin(); return; } if (moved) done(); else tap(el); moved = false; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  const later = debounce(done, 400);
  el.addEventListener('wheel', e => { e.preventDefault(); if (e.shiftKey) o.r += e.deltaY > 0 ? 6 : -6; else o.s = Math.min(3, Math.max(.3, o.s * (e.deltaY > 0 ? .92 : 1.08))); paint(el); later(); }, { passive: false });
  return el;
}

function desk(el) {
  const bg = h('div.as-dy-bg', h('img', { src: BASE + 'desk-day.webp', alt: '' }), h('img.is-night', { src: BASE + 'desk-night.webp', alt: '' }));
  el.prepend(bg);
  return () => bg.classList.toggle('is-night', (el.closest('.as-phone') || document.body).dataset.mode === 'night');
}

export function open() {
  const p = page({ app: 'diary', id: 'diary-desk', title: '日记', large: true, back: true, cls: 'as-dy-desk', right: [navBtn('plus', '加一本', () => add())] });
  const shelf = h('div.as-dy-shelf'), night = desk(p.el), els = new Map();
  const add = () => { const list = free(); if (!list.length) { toast('每个人都有一本了'); return; }
    actionSheet('给谁一本日记', list.map(c => ({ value: c.id, label: nameOf(c) }))).then(id => id && bookSheet(null, id, draw)); };
  const bookEl = b => { const c = contact(b.who), k = b.who + b.cover + nameOf(c);
    return els.get(k) || els.set(k, h('button.as-dy-book', { style: `--r:${hash(b.who) % 7 - 3}deg`, onclick: () => openBook(c) },
      h('img', { src: cover(b.cover), alt: '' }), h('span.as-dy-book__name', nameOf(c)))).get(k); };
  let seen = '';
  function draw() {
    night();
    const list = books().filter(b => contact(b.who)), sig = JSON.stringify(list) + state.contacts.map(nameOf);
    if (sig === seen) return;   // 返回这页时没变就一点都不动
    seen = sig;
    shelf.replaceChildren(...list.map(bookEl), ...(free().length ? [h('button.as-dy-add', { onclick: add }, icon('plus', 26, 1.6), h('span', '加一本'))] : list.length ? [] : [empty('还没有联系人')]));
  }
  p.body.append(shelf);
  draw(); p.el._onShow = draw;
  return p.el;
}

/** 新的一本 / 改一本：封面、什么时候写；改的时候能删 */
function bookSheet(b, who, done) {
  const x = b ? { ...b, mode: b.mode === 'hand' ? 'hand' : 'every' } : { who, cover: COVERS[books().length % COVERS.length], mode: 'every', n: 3 };
  const every = field('每几楼写一篇', input({ type: 'number', value: String(x.n || 1), onInput: v => { x.n = Math.max(1, parseInt(v, 10) || 1); } }));
  every.hidden = x.mode === 'hand';
  const fontRow = item({ title: '字体', value: fontOf(x.font)[0], chevron: true, onClick: async () => {
    const v = await actionSheet('字体', [...FONTS.map(f => ({ value: f[0], label: f[1], active: (x.font || 'xiaolai') === f[0] })),
      ...userFonts().map(f => ({ value: 'u:' + f.id, label: f.name, active: x.font === 'u:' + f.id }))]);
    if (v) { x.font = v; fontRow.querySelector('.as-list-item__value').textContent = fontOf(v)[0]; }
  } });
  const covers = h('div.as-dy-covers', COVERS.map(k => h('button.as-dy-cover' + (k === x.cover ? '.is-on' : ''), { 'aria-label': '封面', onclick: e => {
    covers.querySelector('.is-on').classList.remove('is-on'); e.currentTarget.classList.add('is-on'); x.cover = k; } }, h('img', { src: cover(k), alt: '' }))));
  const s = sheet({ title: `${nameOf(contact(x.who))}的日记`, content: [covers,
    h('div.as-field', h('span.as-field__label', '纸'), segmented(PAPERS, x.paper || 'lined', v => { x.paper = v; })), fontRow,
    h('div.as-field', h('span.as-field__label', '什么时候写'), segmented(MODES, x.mode, v => { x.mode = v; every.hidden = v === 'hand'; })), every,
    b ? h('div.as-dy-acts', btn('删除', 'danger', async () => {
      const d = await Dy.load(), n = Dy.pagesOf(b.who).length;
      if (!(await dialog({ title: '删除这本日记？', text: n ? `里面的 ${n} 篇也会删掉` : '', confirm: '删除', danger: true }))) return;
      books().splice(books().indexOf(b), 1); d.pages = d.pages.filter(p => p.who !== b.who); await Dy.save(); s.close(); done('gone');
    })) : null,
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => {
      if (b) Object.assign(b, x); else books().push(x);
      commit('diary'); s.close(); done(x);
    })),
  ].filter(Boolean) });
}

/* ---------- 翻开一本 ---------- */
function openBook(c) {
  const wr = navBtn('edit', '写一篇', () => writeSheet(c));
  wr.dataset.dyWrite = c.id; wr._idle = [...wr.childNodes];
  const p = page({ app: 'diary', id: 'diary-book', title: nameOf(c), back: true, cls: 'as-dy-desk', right: [wr, navBtn('gear', '设置', () => bookSheet(Dy.bookOf(c.id), c.id, how => {
    if (how === 'gone') { nav.pop(); return; }
    flip.className = 'as-dy-flip is-' + (how.paper || 'lined'); useFont(flip, how.font);   // 换纸、换字体只改这两样
  }))] });
  const flip = h('div.as-dy-flip.is-' + (Dy.bookOf(c.id).paper || 'lined')), night = desk(p.el), els = new Map(), blank = h('article.as-dy-leaf.is-blank', h('p', '还没写过'), btn('写一篇', 'secondary', () => writeSheet(c)));
  useFont(flip, Dy.bookOf(c.id).font);
  let seen = -1, n = 0;
  async function draw() {
    night(); ping(c.id);
    await Dy.load(); if (Dy.ver === seen) return;
    const first = seen === -1; seen = Dy.ver;
    const list = Dy.pagesOf(c.id), want = list.length ? list.map(x => els.get(x) || els.set(x, leaf(x)).get(x)) : [blank];
    list.forEach(x => { const ph = els.get(x).querySelector('.as-dy-photo'); if (ph._k !== key(x)) fill(x, ph); });   // 配好图、在配图：只换拍立得里面
    [...flip.children].forEach(el => { if (!want.includes(el)) el.remove(); });
    want.forEach((el, i) => { if (flip.children[i] !== el) flip.insertBefore(el, flip.children[i] || null); });
    if (first) flip.scrollLeft = flip.scrollWidth;   // 打开翻到最新一篇
    else if (list.length > n) flip.scrollTo({ left: flip.scrollWidth, behavior: 'smooth' });
    n = list.length;
  }
  // 一篇：改了就把这一页换掉
  const redo = x => { const o = els.get(x), nw = leaf(x); els.set(x, nw); if (o) swap(o, nw); };
  function leaf(x) {
    const r = hash(x.id), lay = x.lay ?? r % 3, wx = (WEATHER.find(([re]) => re.test(x.weather)) || [])[1], d = new Date(x.at.replace(/-/g, '/'));
    const ph = h('div.as-dy-photo' + (lay === 1 ? '.is-stamp' : ''), { style: `--r:${r % 9 - 4}deg`, onclick: () => picMenu(x, ph) }, photo(x),
      lay === 1 ? tint(BASE + 'stamp' + (r >>> 3) % 4 + '.webp', '.as-dy-photo__frame', 0) : h('img.as-dy-photo__frame', { src: BASE + 'paper1.webp', alt: '' }));
    ph._k = key(x);
    const zone = h('div.as-dy-zone'), el = h('article.as-dy-leaf.is-l' + lay, { style: `--t:${Dy.themeOf(x)}` },
      h('header.as-dy-leaf__head', h('b', ymd(x.at)), h('span', `星期${WEEK[d.getDay()] || ''} ${x.hm}`),
        wx ? h('img.as-dy-leaf__wx', { src: BASE + 'weather-' + wx + '.webp', alt: x.weather }) : null,
        h('button.as-dy-leaf__more', { 'aria-label': '更多', onclick: () => leafMenu(x) }, icon('more', 18, 3.2))),
      tint(BASE + LACES[(r >>> 10) % LACES.length] + '.webp', '.as-dy-lace', 1),
      ph, h('div.as-dy-leaf__text', lay === 2 ? tint(BASE + TAPES[(r >>> 6) % TAPES.length] + '.webp', '.as-dy-tape', 2) : null, x.text), zone);
    el._st = x.st || defaults(x, r);
    el._st.forEach(o => (o.a === 'e' ? zone : el).append(stickOf(x, el, o)));
    return el;
  }
  const keep = (x, el) => { x.st = el._st; Dy.save(); };
  const stickOf = (x, el, o) => stick(o, () => keep(x, el), async s => {
    const v = await actionSheet('贴纸', [o.k === 'photo' ? { value: 'up', label: '换一张' } : null, { value: 'del', label: '删除', danger: true }].filter(Boolean));
    if (v === 'del') { el._st.splice(el._st.indexOf(o), 1); s.remove(); keep(x, el); }
    if (v === 'up') { const [src] = await pickPhotos(); if (!src) return; o.src = src; s.querySelector('.as-dy-st__pic').src = src; keep(x, el); }
  });
  // 加贴纸 / 照片：放在这一页现在看得到的正中间
  const put = (x, list) => { const el = els.get(x), y = el.scrollTop + el.clientHeight / 2;
    list.forEach((o, i) => { Object.assign(o, { a: 't', x: 50 + i * 8, y: y + i * 16, r: 0, s: 1 }); el._st.push(o); el.append(stickOf(x, el, o)); }); keep(x, el); };
  function addSheet(x) {
    const opt = (k, t) => h('button.as-dy-add-st', { onclick: () => { s.close(); put(x, [{ k, w: k.startsWith('tape') ? 120 : 90, t }]); } }, t != null ? tint(BASE + k + '.webp', '', t) : h('img', { src: BASE + k + '.webp', alt: '' }));
    const s = sheet({ title: '加贴纸', content: h('div.as-dy-addgrid', ...STICKERS.map(k => opt(k, 1)), ...TAPES.map(k => opt(k, 0)), ...['snow', 'leaf', 'petal'].flatMap(k => n_(k, 4)).map(k => opt(k)), ...PAPERS_ST.map(k => opt(k))) });
    s.el.style.setProperty('--t', Dy.themeOf(x));
  }
  // 拍立得里面：有图放图；在生图放转圈（点一下取消）；没图写画面和提示词
  const photo = x => drawing.has(x.id) ? h('div.as-dy-photo__none', h('span.as-spin'), h('small', '在生图，点一下取消'))
    : x.pic ? h('img.as-dy-photo__img', { src: x.pic, alt: x.desc || '配图' })
      : h('div.as-dy-photo__none', h('p', x.desc || '还没有配图'), x.prompt ? h('small', x.prompt) : null);
  const key = x => (drawing.has(x.id) ? '~' : '') + x.pic;
  const fill = (x, ph) => { ph._k = key(x); const nw = photo(x), im = nw.tagName === 'IMG' ? nw : null; (im ? im.decode().catch(() => {}) : Promise.resolve()).then(() => ph.firstChild.replaceWith(nw)); };
  async function picMenu(x, ph) {
    if (drawing.has(x.id)) { drawing.get(x.id).abort(); return; }
    const v = await actionSheet('配图', [{ value: 'gen', label: x.pic ? '重新生图' : '生图' }, { value: 'up', label: x.pic ? '换一张' : '上传' },
      x.prompt ? { value: 'copy', label: '复制提示词' } : null, x.pic ? { value: 'del', label: '删除图片', danger: true } : null].filter(Boolean));
    if (v === 'copy') navigator.clipboard?.writeText(x.prompt).then(() => toast('已复制'), () => toast('复制失败'));
    if (v === 'del') { x.pic = ''; await Dy.save(); fill(x, ph); }
    if (v === 'up') { const src = await pickImage('配图', { ratio: 1, size: 900, has: !!x.pic }); if (src == null) return; x.pic = src; await Dy.save(); fill(x, ph); }
    if (v !== 'gen') return;
    const ac = new AbortController(); drawing.set(x.id, ac); fill(x, ph);
    try { await Dy.draw(x, ac.signal); toast('配好图了'); } catch (e) { toast(ac.signal.aborted ? '已取消' : '生图失败：' + e.message); }
    drawing.delete(x.id); fill(x, ph);
  }
  async function leafMenu(x) {
    const v = await actionSheet(ymd(x.at), [{ value: 'edit', label: '改' }, { value: 'lay', label: '换排版' }, { value: 'pal', label: '换主题色' },
      { value: 'st', label: '加贴纸' }, { value: 'add', label: '多贴几张照片' }, { value: 'del', label: '删除', danger: true }]);
    if (v === 'lay') { x.lay = ((x.lay ?? hash(x.id) % 3) + 1) % 3; x.st = els.get(x)._st; await Dy.save(); redo(x); return; }
    if (v === 'pal') { themeSheet(x); return; }
    if (v === 'st') { addSheet(x); return; }
    if (v === 'add') { const got = await pickPhotos(); if (got.length) put(x, got.map(src => ({ k: 'photo', src, w: 96 }))); return; }
    if (v === 'del' && await dialog({ title: '删除这一篇？', confirm: '删除', danger: true })) { const d = await Dy.load(); d.pages.splice(d.pages.indexOf(x), 1); await Dy.save(); }
    if (v !== 'edit') return;
    const y = { weather: x.weather, text: x.text, desc: x.desc, prompt: x.prompt };
    const s = sheet({ title: '改这一篇', content: [
      field('天气', input({ value: y.weather, onInput: v => { y.weather = v.trim(); } })),
      field('正文', textarea({ value: y.text, rows: 8, onInput: v => { y.text = v.trim(); } })),
      field('画面', textarea({ value: y.desc, rows: 2, onInput: v => { y.desc = v.trim(); } })),
      field('生图提示词', textarea({ value: y.prompt, rows: 2, onInput: v => { y.prompt = v.trim(); } })),
      h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
        if (!y.text) { toast('正文不能空着'); return; }
        Object.assign(x, y); x.st = els.get(x)._st; await Dy.save(); s.close(); redo(x);
      })),
    ] });
  }
  // 换主题色：点一个颜色（或者自己调），这一页的胶带、蕾丝、邮票、便签跟着换成它的淡色（只改这一页的 --t，不重画）
  function themeSheet(x) {
    const el = els.get(x), later = debounce(() => Dy.save(), 400);
    const set = v => { x.pal = v; el.style.setProperty('--t', Dy.themeOf(x)); later(); };
    const grid = h('div.as-dy-pals', Object.entries(Dy.THEMES).map(([k, c]) => h('button.as-dy-pal' + (Dy.themeOf(x) === c ? '.is-on' : ''), { onclick: e => {
      grid.querySelector('.is-on')?.classList.remove('is-on'); e.currentTarget.classList.add('is-on'); set(k);
    } }, h('i', { style: `background:${c}` }), h('span', k))));
    sheet({ title: '换主题色', content: [grid, field('自己调', colorWheel(Dy.themeOf(x), v => { grid.querySelector('.is-on')?.classList.remove('is-on'); set(v.slice(0, 7)); }))] });
  }
  const off = subscribe(w => { if (w === 'diary') draw(); });
  p.body.append(flip);
  draw(); p.el._onShow = draw; p.el._onLeave = off;
  nav.push(p.el);
}

/* ---------- 写一篇：从念念铃里挑几件事（不挑就按最近的正文和手机聊天写），写完接着配图 ---------- */
function ping(id) {
  document.querySelectorAll(`[data-dy-write="${id}"]`).forEach(b => b.replaceChildren(...(jobs.has(id) ? [h('span.as-spin')] : b._idle)));
}
// 写什么：最近的（正文 + 手机聊天）/ 从念念铃挑几件事 / 挑几层正文；可以先放几张自己的照片（放了就不生图，照片贴进这一页）
let src = 'recent';
async function writeSheet(c) {
  if (jobs.has(c.id)) { jobs.get(c.id).abort(); return; }
  await M.load();
  const evs = M.evOf(c).filter(e => !e.off).slice(-40).reverse(), pick = new Set(), total = M.chatMsgs().length, fl = [Math.max(0, total - 5), Math.max(0, total - 1)];
  let photos = [];
  const box = {
    mem: evs.length ? group('', evs.map(e => toggleItem({ title: e.title, sub: ymd(e.at) }, false, on => { on ? pick.add(e) : pick.delete(e); }))) : empty('念念铃里还没有 TA 的事'),
    floor: total ? field(`从第几层到第几层（一共 ${total} 层，从 0 数）`, h('div.as-mem-range', input({ type: 'number', value: String(fl[0]), onInput: v => { fl[0] = Math.max(0, parseInt(v, 10) || 0); } }),
      h('span', '到'), input({ type: 'number', value: String(fl[1]), onInput: v => { fl[1] = parseInt(v, 10) || 0; } }))) : empty('现在没有打开酒馆的聊天'),
  };
  const show = () => Object.entries(box).forEach(([k, el]) => { el.hidden = k !== src; });
  const ph = btn('放几张照片', 'secondary', async () => { const got = await pickPhotos(); if (!got.length) return; photos = got; ph.textContent = `放了 ${got.length} 张照片`; });
  const s = sheet({ title: '写一篇', content: [
    h('div.as-dy-src', segmented([['recent', '最近的事'], ['mem', '念念铃'], ['floor', '选楼层']], src, v => { src = v; show(); })), box.mem, box.floor,
    h('div.as-dy-acts', ph),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('写', 'primary', () => {
      if (src === 'floor' && (!total || fl[1] < fl[0])) { toast('楼层没选对'); return; }
      s.close(); run(c, { events: src === 'mem' ? [...pick] : [], floors: src === 'floor' ? fl : null, photos });
    })),
  ] });
  show();
}
async function run(c, opts) {
  const ac = new AbortController(), stop = { label: '取消', fn: () => ac.abort(), wait: true };
  jobs.set(c.id, ac); ping(c.id);
  try {
    toast(`${nameOf(c)} 在写日记…`, stop);
    const x = await Dy.write(c, opts, ac.signal);
    if (opts.photos.length) { toast('写好了'); return; }
    toast('写好了，在配图…', stop);
    drawing.set(x.id, ac); commit('diary');
    try { await Dy.draw(x, ac.signal); toast('写好了'); } catch (e) { if (!ac.signal.aborted) toast('写好了，配图没生成：' + e.message); }
    drawing.delete(x.id); commit('diary');
  } catch (e) { if (!ac.signal.aborted) toast(e.message); }
  finally {
    if (ac.signal.aborted) toast('已取消');
    jobs.delete(c.id); ping(c.id);
  }
}
