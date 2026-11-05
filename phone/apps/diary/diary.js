// 日记：书桌上摆着每个角色的本子，点开左右翻，一页一篇（方案见 docs/pages-diary.md）。
// 一页：年月日、天气贴纸、拍立得里的配图（没图时写着画面和生图提示词，点一下生图 / 上传）、手写体正文，再随手贴一条胶带、一样干花；同一篇每次贴得一样。
// 写日记、配图在 core/diary.js 里跑，退出这页也接着跑；同一个人同一时间只写一篇，回来按钮还是「取消」。
import { h } from '../../core/util.js';
import { state, contact, commit, subscribe } from '../../core/store.js';
import { page, navBtn, sheet, actionSheet, dialog, toast, btn, segmented, textarea, input, field, group, toggleItem, icon, empty, pickImage, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as Dy from '../../core/diary.js';
import * as M from '../../core/memory.js';
import { nameOf } from '../chat/engine.js';
import { useFont } from '../../core/floatlyric.js';

const BASE = 'assets/diary/';
const COVERS = ['navy', 'sky', 'linen', 'frost-blue', 'frost-pink', 'lace-blue', 'lace-pink', 'traveler'];
const TAPES = [...Array(8)].flatMap((_, i) => ['tape' + i, 'tape-pink' + i]), DECO = ['flower0', 'flower1', 'flower2', 'flower3', 'flower4', 'flower5', 'paper14', 'paper16'];
const WEATHER = [[/台风/, 'typhoon'], [/雷/, 'thunder'], [/雪/, 'snow'], [/雾|霾/, 'fog'], [/太阳雨/, 'sun-rain'], [/夜.*雨/, 'night-rain'], [/小雨|毛毛|阵雨/, 'drizzle'], [/雨/, 'rain'],
  [/彩虹/, 'rainbow'], [/风/, 'wind'], [/夜.*[云阴]/, 'night-cloud'], [/夜|月|星/, 'moon'], [/晴.*云|云.*晴/, 'sunny-cloud'], [/云|阴/, 'cloudy'], [/晴|阳/, 'sun']];
const PAPERS = [['lined', '横线'], ['dots', '点点'], ['plain', '白纸']];
// 三种排版（参考手帐的「贴 + 便」）：0 拍立得在上、字在下；1 邮票贴在右边、字绕着走；2 小拍立得在左上、字写在一块便签上
const MODES = [['every', '每次都写'], ['maybe', '值得写才写'], ['hand', '只手动写']];
const WEEK = '日一二三四五六';
const cover = k => BASE + 'cover-' + k + '.webp';
const books = () => state.diary.books;
const free = () => state.contacts.filter(c => !Dy.bookOf(c.id));
const hash = s => [...String(s)].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;
const ymd = at => at ? at.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '';
const jobs = new Map(), drawing = new Map();   // 正在写的（按人）、正在配图的（按篇）：退出再进来还能取消
// 图都解码好了再换上去，不闪
const swap = (old, n) => Promise.all([...n.querySelectorAll('img')].map(i => i.decode().catch(() => {}))).then(() => old.replaceWith(n));

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
  const x = b ? { ...b } : { who, cover: COVERS[books().length % COVERS.length], mode: 'maybe' };
  const covers = h('div.as-dy-covers', COVERS.map(k => h('button.as-dy-cover' + (k === x.cover ? '.is-on' : ''), { 'aria-label': '封面', onclick: e => {
    covers.querySelector('.is-on').classList.remove('is-on'); e.currentTarget.classList.add('is-on'); x.cover = k; } }, h('img', { src: cover(k), alt: '' }))));
  const s = sheet({ title: `${nameOf(contact(x.who))}的日记`, content: [covers,
    h('div.as-field', h('span.as-field__label', '纸'), segmented(PAPERS, x.paper || 'lined', v => { x.paper = v; })),
    h('div.as-field', h('span.as-field__label', '什么时候写'), segmented(MODES, x.mode, v => { x.mode = v; })),
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
    if (how === 'gone') nav.pop(); else flip.className = 'as-dy-flip is-' + (how.paper || 'lined');   // 换纸只换这一个 class
  }))] });
  const flip = h('div.as-dy-flip.is-' + (Dy.bookOf(c.id).paper || 'lined')), night = desk(p.el), els = new Map(), blank = h('article.as-dy-leaf.is-blank', h('p', '还没写过'), btn('写一篇', 'secondary', () => writeSheet(c)));
  useFont(document, 'LXGW WenKai');
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
      h('img.as-dy-photo__frame', { src: BASE + (lay === 1 ? 'stamp' + (r >>> 3) % 4 : 'paper1') + '.webp', alt: '' }));
    ph._k = key(x);
    return h('article.as-dy-leaf.is-l' + lay,
      h('img.as-dy-tape', { src: BASE + TAPES[r % TAPES.length] + '.webp', alt: '', style: `--r:${r % 9 - 4}deg` }),
      h('header.as-dy-leaf__head', h('b', ymd(x.at)), h('span', `星期${WEEK[d.getDay()] || ''} ${x.hm}`),
        wx ? h('img.as-dy-leaf__wx', { src: BASE + 'weather-' + wx + '.webp', alt: x.weather }) : null,
        h('button.as-dy-leaf__more', { 'aria-label': '更多', onclick: () => leafMenu(x) }, icon('more', 18, 3.2))),
      ph, h('div.as-dy-leaf__text', lay === 2 ? h('img.as-dy-tape', { src: BASE + TAPES[(r >>> 6) % TAPES.length] + '.webp', alt: '' }) : null, x.text),
      h('img.as-dy-deco', { src: BASE + DECO[(r >>> 4) % DECO.length] + '.webp', alt: '', style: `--r:${(r >>> 8) % 41 - 20}deg` }));
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
    const v = await actionSheet(ymd(x.at), [{ value: 'edit', label: '改' }, { value: 'lay', label: '换排版' }, { value: 'del', label: '删除', danger: true }]);
    if (v === 'lay') { x.lay = ((x.lay ?? hash(x.id) % 3) + 1) % 3; await Dy.save(); redo(x); return; }
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
        Object.assign(x, y); await Dy.save(); s.close(); redo(x);
      })),
    ] });
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
async function writeSheet(c) {
  if (jobs.has(c.id)) { jobs.get(c.id).abort(); return; }
  await M.load();
  const evs = M.evOf(c).filter(e => !e.off).slice(-40).reverse(), pick = new Set();
  const s = sheet({ title: '写一篇', content: [
    evs.length ? group(withInfo('从念念铃里挑', '挑了就写这几件事；不挑就按最近的正文和手机聊天写。'),
      evs.map(e => toggleItem({ title: e.title, sub: ymd(e.at) }, false, on => { on ? pick.add(e) : pick.delete(e); }))) : null,
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('写', 'primary', () => { s.close(); run(c, [...pick]); })),
  ].filter(Boolean) });
}
async function run(c, evs) {
  const ac = new AbortController(), stop = { label: '取消', fn: () => ac.abort(), wait: true };
  jobs.set(c.id, ac); ping(c.id);
  try {
    toast(`${nameOf(c)} 在写日记…`, stop);
    const x = await Dy.write(c, evs, ac.signal);
    toast('写好了，在配图…', stop);
    drawing.set(x.id, ac); commit('diary');
    try { await Dy.draw(x, ac.signal); toast('写好了'); } catch (e) { if (!ac.signal.aborted) toast('写好了，配图没生成：' + e.message); }
    drawing.delete(x.id); commit('diary');
  } catch (e) { if (!ac.signal.aborted) toast(e.message); }
  if (ac.signal.aborted) toast('已取消');
  jobs.delete(c.id); ping(c.id);
}
