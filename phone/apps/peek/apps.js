// TA 手机里的各个应用，照苹果自带应用的样子排。每个：rows（AI 写的一行行）→ 页面里的内容；push(标题, 内容, 类名) 再盖一层详情。
import { h, sortZh, onLongPress } from '../../core/util.js';
import { icon, actionSheet, dialog, busy, toast } from '../../core/ui.js';
import { kvGet, kvSet, contact, state, commit } from '../../core/store.js';
import { generateImage, resolveConn } from '../../core/api.js';
import * as time from '../../core/time.js';
import { saveRead } from './gen.js';
import { nameOf, inksFor, autoInk, sharedWith, drawn, INKLINE } from '../chat/engine.js';
import { myName } from '../../core/promptstore.js';

const yuan = v => (parseFloat(String(v).replace(/[^\d.+-]/g, '')) || 0).toFixed(2);
const list = kids => h('div.pk-list', kids);
const face = (name, url) => h('i.pk-face', url ? { style: { backgroundImage: `url("${url}")` } } : name.slice(0, 1));
// 这几个图标公共那套里没有（听筒、钟、九宫格、三条线、小云朵）：自己描的线条，借 icon() 的壳换一条路径
const G = { call: 'M7.2 5.2C5.5 10 14 18.5 18.8 16.8', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2', lines: 'M4 7h16M7 12h10M10 17h4',
  pad: 'M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01',
  cloud: 'M7.5 15.5h9a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 7.4 8a3.75 3.75 0 0 0 .1 7.5zM6 19.2h.01M3.8 21.4h.01',
  // 备忘录里的：文件夹、分享、三个点、清单、回形针、圈里一支笔
  folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z', share: 'M12 15V3.5M8 7l4-3.5L16 7M7 11H5.5v9.5h13V11H17', more: 'M5 12h.01M12 12h.01M19 12h.01',
  todo: 'M5.5 8.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 17.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 6.3h9.5M11 15.3h6', clip: 'M19 11.5 12.5 18a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-6.9 6.9a1.3 1.3 0 0 1-1.9-1.9l6-6', pen: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.6 16 12 7.5l3.4 8.5M9.9 13.2h4.2' };
// 实心的：听筒、钟、小人、九个点（标签栏、拨打键用）、播放键（Safari 里的视频）。.cut 是挖空的那几笔，颜色跟着页面底色
const F = { call: '<path d="M6.3 3.2c.9-.4 1.9 0 2.3.9l1.3 2.9c.4.8.1 1.8-.6 2.3l-1.4 1c1 2.2 2.8 4 5 5l1-1.4c.5-.7 1.5-1 2.3-.6l2.9 1.3c.9.4 1.3 1.4.9 2.3l-.6 1.4c-.6 1.3-2 2.1-3.4 1.8C9.4 18.9 5.1 14.6 3.8 8.3c-.3-1.4.5-2.8 1.8-3.4z"/>',
  clock: '<circle cx="12" cy="12" r="10.5"/><path class="cut" d="M12 6.6V12H7.4" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10.3-6.8a1 1 0 0 0 0-1.6L9.6 4.4c-.7-.5-1.6 0-1.6.8z"/>',
  person: '<circle cx="12" cy="12" r="10.5"/><circle class="cut" cx="12" cy="9.6" r="3.7"/><path class="cut" d="M5.4 18.4c1.4-2.3 3.9-3.6 6.6-3.6s5.2 1.3 6.6 3.6A9.9 9.9 0 0 1 12 21.9a9.9 9.9 0 0 1-6.6-3.5z"/>',
  dots: [5, 12, 19].map(y => [5, 12, 19].map(x => `<circle cx="${x}" cy="${y}" r="2.7"/>`).join('')).join('') };
const fill = (k, size) => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${F[k]}</svg>`; return t.content.firstChild; };
// 名字的拼音首字母（通讯录分组）：拿每个字母开头的第一个字比，不用带拼音表
const PY = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥仨他屲夕丫帀', PYK = 'ABCDEFGHJKLMNOPQRSTWXYZ';
const initial = s => { const c = String(s).trim()[0] || '#'; if (/[a-z]/i.test(c)) return c.toUpperCase(); if (!/[\u4e00-\u9fff]/.test(c)) return '#';
  let k = '#'; for (let i = 0; i < PY.length && c.localeCompare(PY[i], 'zh-CN-u-co-pinyin') >= 0; i++) k = PYK[i]; return k; };
// 时间照 iPhone 写：列表里今天写几点，昨天、这一周写星期几，再早写年/月/日；对话里写日子 + 几点（AI 有时写成完整日期）
const DT = /(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?(?:\s*(\d{1,2}):(\d{2}))?/, ts = t => { const m = DT.exec(t || ''); return m ? +new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : 0; };
export const when = (t, full) => {
  const m = DT.exec(t || ''); if (!m) return t || '';
  const d = new Date(+m[1], m[2] - 1, +m[3]), now = time.isStory() ? time.story().date : new Date(), days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 864e5);
  const hm = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '', wk = '日一二三四五六'[d.getDay()];
  if (full) return [days === 0 ? '今天' : days === 1 ? '昨天' : days > 1 && days < 7 ? '星期' + wk : `${+m[2]}月${+m[3]}日 周${wk}`, hm].filter(Boolean).join(' ');   // 对话里的时间：日子 + 几点
  return days === 0 && hm ? hm : days === 1 ? '昨天' : days > 1 && days < 7 ? '星期' + wk : `${m[1]}/${+m[2]}/${+m[3]}`;
};
// 通讯录的头像：名字第一个字（自己那张是粉紫的）；有头像就放头像
const face2 = (name, url, me = '') => h('i.pk-face2' + me, url ? { style: { backgroundImage: `url("${url}")` } } : null, url ? '' : String(name || '?').trim().slice(0, 1));
// 不是中文的：AI 在后面附了「[翻译：…]」，显示时去掉，原文和中文都记在那几个字上
const TR = /\s*[[［【]翻译[:：]\s*((?:[^[\]［］【】]|[[［【][^\]］】]*[\]］】])*)[\]］】]/;   // 翻译里可以再套一层括号（[图：…]）
// 心声的几个情绪：AI 有时整串只在最后附一个翻译（「a、b、c[翻译：甲、乙、丙]」），个数对得上就拆成一个词一个翻译；括号里的顿号不拆
const SEP = /[、,，](?![^[\]［］【】]*[\]］】])/;
const moods = s => { const [a, z] = untr(s), A = a.split(SEP), Z = z.split(SEP);
  return (z && (s.match(/翻译[:：]/g) || []).length === 1 && A.length > 1 && A.length === Z.length ? A.map((x, i) => `${x.trim()}[翻译：${Z[i].trim()}]`) : s.split(SEP)).map(x => x.trim()).filter(Boolean); };
const untr = s => { const m = TR.exec(s || ''); return m ? [s.slice(0, m.index) + s.slice(m.index + m[0].length), m[1]] : [s || '', '']; };
let view = (a, zh) => [a, zh];   // 显示哪一版：peek.js 按 TA 现在说的语言换（setView）
export const setView = f => { view = f; };
// 整个 TA 的手机共用一个「译」：点一下所有页面都换中文，再点一下全换回原文；新打开的页面跟着现在这个
let zh = false;
const trOn = () => zh;
export function trs(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hit = [];
  while (w.nextNode()) if (TR.test(w.currentNode.data)) hit.push(w.currentNode);
  for (const n of hit) { const p = n.data.split(TR); n.replaceWith(...p.flatMap((x, i) => i % 2 ? [] : i + 1 < p.length ? (([a, z]) => z ? [x.match(/^\s*/)[0], Object.assign(h('bdi.pk-trs', zh ? z : a), { _a: a, _z: z })] : [x])(view(x.trim(), p[i + 1])) : x ? [x] : [])); }
}
function flipAll(root) {
  zh = !zh;
  root.querySelectorAll('.pk-trs').forEach(s => { s.textContent = zh ? s._z : s._a; });
  root.querySelectorAll('.pk-trx').forEach(x => x._put(zh));
  root.querySelectorAll('.pk-tl').forEach(b => { b.textContent = zh ? '原' : '译'; b.classList.toggle('is-on', zh); });
}
// 这一页有能翻译的字，就在顶栏右边放「译」（顶栏右边已经有按钮的，放在它左边）
// 照 iPhone：滚到头了还能再拖一段，松手弹回（--pull，只跟手指，不碰滚动本身）；拖上去的内容一样从顶栏的毛玻璃底下过
export function pull(body) {
  let last = null, off = 0;
  const set = () => body.style.setProperty('--pull', (Math.sign(off) * Math.min(140, Math.abs(off) * .4)).toFixed(1) + 'px');
  body.addEventListener('touchstart', e => { last = e.target.closest('[data-no-swipe]') ? null : e.touches[0].clientY; off = 0; body.classList.remove('is-back'); }, { passive: true });   // 在画布这类地方按下的不拖（画画时整页跟着抖）
  body.addEventListener('touchmove', e => {
    if (last == null) return;
    const y = e.touches[0].clientY, dy = y - last; last = y;
    const top = body.scrollTop <= 0, end = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
    if (!off && !(dy > 0 && top) && !(dy < 0 && end)) return;
    const was = off; off += dy; if (was && Math.sign(off) !== Math.sign(was)) off = 0; set();
  }, { passive: true });
  body.addEventListener('touchend', () => { if (!off) return; off = 0; body.classList.add('is-back'); set(); }, { passive: true });
}
// 你自己手机里照 iPhone 画的页（电话、短信）：和查手机同一套样子；照 393 宽量的整体缩放，日间 / 夜间跟着手机，外语右上一个「译」
export function iosPage(app, id, cls = '') {
  const body = h('div.pk-app__body'), L = h('div.pk-app.is-raw' + cls, body), el = h('section.as-page.as-ios', { dataset: { asApp: app, asPage: id } }, L);
  const phone = document.querySelector('.as-phone');
  pull(body);   // 「译」是整部手机一起换的：别的页上的「译 / 原」也要跟着变
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.isConnected) { trs(n.nodeType === 1 ? n : n.parentNode); trBtn(L, phone || el); } }))).observe(body, { childList: true, subtree: true });
  const dark = () => el.classList.toggle('is-dark', phone?.dataset.mode === 'night'), mo = phone && new MutationObserver(dark);
  mo?.observe(phone, { attributes: true, attributeFilter: ['data-mode'] }); dark();
  requestAnimationFrame(() => { body.style.zoom = (el.clientWidth / 393).toFixed(3); });
  el._onLeave = () => mo?.disconnect();
  return { el, body };
}
// 照 iPhone 的左滑 / 右滑：这一行跟着手指走、露出后面的圆按钮，过了一半就停在打开的样子；点按钮做事，点这一行或别的地方收回。
// left：左滑露出的（在右边），right：右滑露出的（在左边），每个 [图标, 颜色, 点了做什么]。贴着左边缘起手的留给「右滑返回」
let opened = null;
export const gone = w => w.animate([{ height: w.offsetHeight + 'px', opacity: 1 }, { height: 0, opacity: 0 }], { duration: 260, easing: 'ease-in' }).finished.then(() => w.remove());   // 删掉的那一行收起来
export function swipe(row, left = [], right = []) {
  const btn = ([ic, bg, fn, label]) => h('button.pk-swipe__b' + (label ? '.has-l' : ''), { style: { '--bg': bg }, onclick: e => { e.stopPropagation(); shut(); fn(wrap); } }, label ? [h('i', icon(ic, 20, 2)), h('small', label)] : icon(ic, 22, 2));   // label：圆下面写一行字（备忘录照 iPhone）
  const wrap = h('div.pk-swipe', right.length ? h('div.pk-swipe__l', right.map(btn)) : null, left.length ? h('div.pk-swipe__r', left.map(btn)) : null, row);
  const wL = left.length * 58 + 6, wR = right.length * 58 + 6;
  let s = null, x = 0, dragged = false;   // dragged：刚拖完，紧跟着的那下 click 不算点
  const go = v => { x = v; row.style.transform = v ? `translateX(${v}px)` : ''; wrap.classList.toggle('is-open', !!v); };
  const shut = () => { go(0); if (opened === shut) opened = null; };
  row.addEventListener('pointerdown', e => { dragged = false; if (e.clientX - wrap.getBoundingClientRect().left < 24) return; e.stopPropagation(); s = { x0: e.clientX - x, y0: e.clientY, on: false, id: e.pointerId }; });
  row.addEventListener('pointermove', e => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0, dy = Math.abs(e.clientY - s.y0);
    if (!s.on) { if (Math.abs(dx - x) > 8 && Math.abs(dx - x) > dy * 1.3) { s.on = true; row.setPointerCapture(e.pointerId); wrap.classList.add('is-drag'); if (opened && opened !== shut) opened(); } else { if (dy > 10) s = null; return; } }
    const v = Math.max(left.length ? -wL - 40 : 0, Math.min(right.length ? wR + 40 : 0, dx));
    row.style.transform = `translateX(${v}px)`; wrap.classList.add('is-open');
  });
  const end = e => { if (!s) return; const on = s.on, v = e.clientX - s.x0; s = null; wrap.classList.remove('is-drag'); if (!on) return;
    dragged = true;
    go(v < -wL / 2 && left.length ? -wL : v > wR / 2 && right.length ? wR : 0); if (x) opened = shut; };
  row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
  row.addEventListener('click', e => { if (dragged || x) { e.stopPropagation(); e.preventDefault(); if (!dragged) shut(); dragged = false; } }, { capture: true });
  return wrap;
}
export function trBtn(layer, root) {
  const slot = layer.querySelector('.pk-top2, .pk-app__bar');
  if (!slot || layer.querySelector('.pk-tl') || !layer.querySelector('.pk-trs, .pk-trx')) return;
  const btn = h('button.pk-glass.is-round.pk-tl' + (zh ? '.is-on' : ''), { 'aria-label': '翻译', onclick: () => flipAll(root) }, zh ? '原' : '译');
  const last = slot.lastElementChild;
  if ((slot.children.length > 2 && last.matches('button')) || last.matches('.pk-nt__pill, .pk-nt__r')) last.before(btn); else slot.append(btn);
}
export const ink = (k, size, w) => { const s = icon('info', size, w); s.firstChild.setAttribute('d', G[k]); return s; };
// 备忘录里画的图单独存在 kv 里（apps/memo/draw.js）；读过的记着，重画这一页时直接用，不空一下
export const inks = new Map();
// 夜里：画里的黑色（和很深的灰）看成白色，不然黑底上看不见；别的颜色照你选的原样（浅粉就是浅粉，白就是白）
export const blackish = c => { const m = /^#([\da-f]{6})$/i.exec(c || ''), v = m && m[1].match(/../g).map(x => parseInt(x, 16)); return !!v && Math.max(...v) < 90 && Math.max(...v) - Math.min(...v) < 30; };
export const flipBlack = a => { for (let i = 0; i < a.length; i += 4) { const mx = Math.max(a[i], a[i + 1], a[i + 2]); if (a[i + 3] && mx < 90 && mx - Math.min(a[i], a[i + 1], a[i + 2]) < 30) { a[i] = 255 - a[i]; a[i + 1] = 255 - a[i + 1]; a[i + 2] = 255 - a[i + 2]; } } };
// 每张画另备一张夜里看的（同一张图只算一次），挂在 --night 上，夜里由样式换上去（页面切白天黑夜不用重画）
const nights = new Map();
const nightOf = url => { if (nights.has(url)) return nights.get(url); let p;
  if (url.startsWith('data:image/svg')) { const t = decodeURIComponent(url.slice(url.indexOf(',') + 1)).replace(/(stroke|fill)="#000"/g, '$1="#fff"'); p = Promise.resolve('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t)); }
  else p = (async () => { const im = new Image(); im.src = url; await im.decode(); const c = h('canvas', { width: im.width, height: im.height }), x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height); flipBlack(d.data); x.putImageData(d, 0, 0); return URL.createObjectURL(await new Promise(ok => c.toBlob(ok))); })().catch(() => '');
  nights.set(url, p); return p; };
const pic = (key, cls) => { const im = h('img.' + cls, { alt: '', src: inks.get(key) }), set = s => { im.src = s; nightOf(s).then(u => u && im.style.setProperty('--night', `url("${u}")`)); };
  if (inks.has(key)) set(inks.get(key)); else kvGet(key).then(s => { if (s) { inks.set(key, s); set(s); } }, () => {}); return im; };
export const inkImg = key => { const im = pic(key, 'pk-nt__ink'); im.dataset.key = key; return im; };
// 回放：TA 画的（AI 写的 svg，编号带 svg）一个形状一个形状描出来，第一次滑到眼前时自己放；你画的照存下来的每一笔放（编号后面加 :s 的那份，以前画的没存就放不了）。
// 都是在图上面盖一张，放完拿掉
const play = async img => { if (img._busy) return; img._busy = 1; const key = img.dataset.key, done = () => { img.style.visibility = ''; img._busy = 0; };
  const url = String(inks.get(key) || await kvGet(key).catch(() => '') || ''), svg = url.startsWith('data:image/svg'), log = !svg && await kvGet(key + ':s').catch(() => null);
  if (!svg && !log?.length) return done();
  await img.decode().catch(() => {});
  let top; if (log) top = h('canvas', { width: img.naturalWidth, height: img.naturalHeight }); else { const box = h('div'); box.innerHTML = decodeURIComponent(url.slice(url.indexOf(',') + 1)); top = box.firstElementChild; }
  top.classList.add('pk-nt__ink', 'is-play'); Object.assign(top.style, { left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px' });
  img.after(top); img.style.visibility = 'hidden';
  if (log) await (await import('../memo/draw.js')).replay(top, log, !!img.closest('.is-dark'));
  else { const L = [...top.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon')], per = Math.min(500, 4500 / L.length); let t = 0;
    // 有描边的：顺着线描出来，描到七成再把颜色填上；只有颜色的：淡入
    await Promise.all(L.map(e => { const cs = getComputedStyle(e), len = cs.stroke !== 'none' ? e.getTotalLength() : 0, d = per * (len ? .6 + Math.min(1, len / 800) : .5);
      const a = e.animate(len ? [{ strokeDasharray: len, strokeDashoffset: len, fillOpacity: 0 }, { strokeDasharray: len, strokeDashoffset: 0, fillOpacity: 0, offset: .7 }, { strokeDasharray: len, strokeDashoffset: 0, fillOpacity: cs.fillOpacity }]
        : [{ opacity: 0 }, { opacity: cs.opacity }], { duration: d, delay: t, fill: 'backwards', easing: 'ease-in-out' }); t += d * .8; return a.finished; })).catch(() => {}); }
  top.remove(); done(); };
// 画的右下角一个 ▶，点了再放一遍（你画的存过每一笔才有）
const again = (fig, im) => { const add = () => fig.append(h('button.pk-nt__replay', { 'aria-label': '再看一遍', onclick: e => { e.stopPropagation(); play(im); } }, icon('play', 12, 2.4)));
  if (im.dataset.key.startsWith('memo-draw:svg')) add(); else kvGet(im.dataset.key + ':s').then(l => l?.length && add(), () => {}); return fig; };
const firstLook = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; firstLook.unobserve(e.target);
  state.settings.inkPlayed = [...(state.settings.inkPlayed || []), e.target.dataset.key].slice(-300); commit('settings'); play(e.target); }), { threshold: .5 });
const taInk = key => { const im = Object.assign(inkImg(key), { onclick: e => play(e.currentTarget) });
  if (!(state.settings.inkPlayed || []).includes(key)) { im.style.visibility = 'hidden'; firstLook.observe(im); } return im; };
// 没头像的人：苹果那种蓝灰底的小人（纯样式画的）；有头像就放头像
export const ava = (name, url) => h('i.pk-ava', url ? { style: { backgroundImage: `url("${url}")` } } : null);
const ABC = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ', '', '+', ''];
/** 整页自己画的应用（不要公共的标题栏） */
export const RAW = ['短信', '消息', '电话', '搜索', '相册', '备忘录'];
const of = (R, k) => R.filter(r => r[0] === k);
// 一排分段按钮：点了只换下面那一块
function tabs(names, show) {
  const el = h('div.pk-tabs', names.map((n, i) => h('button' + (i ? '' : '.is-on'), { onclick: e => { [...el.children].forEach(b => b.classList.toggle('is-on', b === e.currentTarget)); show(n); } }, n)));
  show(names[0]); return el;
}
const groupBy = (R, k) => { const m = new Map(); R.forEach(r => (m.get(r[k]) || m.set(r[k], []).get(r[k])).push(r)); return [...m]; };

// 消息：你手机里真有的（和你的私聊、TA 在的群）排前面，后面是 AI 写的 TA 和别人的聊天；都从 TA 那边看，TA 说的在右边
function chats(R, D) {
  const note = (R.find(r => r[0] === '备注') || [])[2], drafts = R.filter(r => r[0] === '草稿'), by = groupBy(R.filter(r => r[0] !== '备注' && r[0] !== '草稿'), 0);
  return [...D.real.map(x => ({ ...x, title: x.you && note || x.title })), ...D.pairs,
    ...by.map(([who, L]) => ({ title: who.replace(/^群[：:]/, ''), group: /^群[：:]/.test(who), msgs: L.map(r => ({ me: /自己/.test(r[2]), who: r[2], t: r[1], text: r[3] })) }))]
    .map(x => ({ ...x, draft: (drafts.find(r => r[1] === x.title) || [])[2] }));
}

// 大标题往上滑、一半钻进顶栏时，顶栏中间换成小标题（和 iPhone 一样）
export function bigTitle(head, big) {
  requestAnimationFrame(() => { const b = big.parentElement; b && b.addEventListener('scroll', () => { const r = big.getBoundingClientRect(); head.classList.toggle('is-up', r.bottom - r.height / 2 < head.getBoundingClientRect().bottom); }, { passive: true }); });
}
/** 短信、消息都照 iPhone 的「信息」排：列表（蓝点 = 最后一条是对方发的、还没点开过，点开过的记在 D.read）和对话页。
 *  一个对话：同一个人连着发的只有最后一条带小尾巴，换人、隔了时间就隔开一点；群里别人说的第一条上面写名字 */
// 两条之间隔了一小时以上（或者不是同一天）才在中间写时间，和 iPhone 一样
export const far = (a, b) => { const day = t => String(t || '').replace(/\s*\d{1,2}:\d{2}.*$/, ''), min = t => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? m[1] * 60 + +m[2] : null; };
  return day(a) !== day(b) || min(a) == null || min(b) == null || Math.abs(min(b) - min(a)) >= 60; };
function messenger(threads, push, D, pop, o) {
  // 左滑删除、右滑标成已读 / 未读（照作者录的 iPhone 视频）：都只记在这部手机自己的数据里（D.hide / D.unread），你那边真的聊天不动
  const seen = D.read ||= [], hid = D.hide ||= [], marked = D.unread ||= [], k = x => o.key + x.title;
  const isNew = x => marked.includes(k(x)) || (!x.msgs[x.msgs.length - 1].me && !seen.includes(k(x)));
  const setNew = (x, on) => { marked.splice(0, marked.length, ...marked.filter(y => y !== k(x))); if (on) marked.push(k(x)); else if (!seen.includes(k(x))) seen.push(k(x)); saveRead(D); };
  threads = threads.filter(x => !hid.includes(k(x)));
  let unread = threads.filter(isNew).length;
  const open = (x, row) => { const L = x.msgs; if (isNew(x)) { setNew(x, false); unread--; row.classList.remove('is-new'); } push(x.title, [
    h('div.pk-top2.is-chat', h('button.pk-glass.pk-backpill', { 'aria-label': '返回', onclick: pop }, icon('back', 24, 2.4), unread ? h('em', unread) : null),
      h('div.pk-peer', ava(x.title, x.avatar), h('b.pk-glass', h('span', x.title), icon('chevron', 12, 2.6)))),
    h('small.pk-meta', '信息 · ' + o.kind, h('br'), when(L[0].t, true)),
    L.map((m, i) => { const p = L[i - 1], n = L[i + 1], gap = p && far(p.t, m.t);
      return [gap ? h('small.pk-meta.is-gap', when(m.t, true)) : null, x.group && !m.me && (!p || gap || p.me || p.who !== m.who) ? h('small.pk-by', m.who) : null,
        h('div.pk-bub' + (m.me ? '.is-me' : '') + (!n || n.me !== m.me || n.t !== m.t || far(m.t, n.t) || (x.group && n.who !== m.who) ? '.is-tail' : ''), m.text)]; }),
    o.spam && o.spam(x) ? h('div.pk-spam', h('span', '不认识此商家？'), h('button', '报告垃圾信息')) : null,
    h('div.pk-float', h('button.pk-glass.is-round', { 'aria-label': '更多' }, icon('plus', 22, 2.2)), h('div.pk-glass.pk-find', h('span', '信息 · ' + o.kind), icon('mic', 20, 2)))], 'is-raw.pk-sms'); };
  const head = h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', o.title), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 22, 2.2))), big = h('h1', o.title);
  bigTitle(head, big);
  return [head, big,
    h('div.pk-msgs', threads.map(x => { const last = x.msgs[x.msgs.length - 1], row = h('button.pk-msg' + (isNew(x) ? '.is-new' : ''), { onclick: () => open(x, row) },
      ava(x.title, x.avatar), h('div', h('b', h('span', x.title), h('time', when(last.t)), icon('chevron', 14, 2.6)),
        h('span', x.draft ? [h('em.is-draft', '草稿'), x.draft] : (x.group && !last.me ? last.who + '：' : '') + last.text)));
      return swipe(row, [['trash', '#ff3b30', async w => { if (!await dialog({ title: '删除这段对话？', confirm: '删除', danger: true })) return; hid.push(k(x)); saveRead(D); gone(w); }]],
        [['chatdots', '#007aff', () => { const on = !isNew(x); setNew(x, on); row.classList.toggle('is-new', on); unread += on ? 1 : -1; }]]); })),
    h('div.pk-float', h('div.pk-glass.pk-find', icon('search', 22, 2.4), h('span', '搜索'), icon('mic', 20, 2)), h('button.pk-glass.is-round', { 'aria-label': '写信息' }, icon('edit', 22, 2)))];
}

// TA 存的备注：电话里「联系人｜真名｜备注｜这是谁」；通话记录、短信里写的是真名，显示成备注（以前存的只有备注那一格，就照旧）
const nicks = D => new Map(of((D.apps.电话 || {}).rows || [], '联系人').filter(r => r.length > 3 && r[2]).map(r => [r[1], r[2]]));
const PICS = new Map();   // 相册里画好的图：这次打开期间记着，不用每次再从存储里读
export const VIEWS = {
  // 相册：照 iPhone「照片」。照片是 AI 写的一句画面，格子是按画面配色的渐变 + 小图标；点开大图左右滑换张，底下一条缩略图；
  // ⓘ 看信息（编号、尺寸这些按画面在手机这边编，不找 AI）；「画出来」点一次用生图画一张，画过的存着，格子里也换成真图；删除进「最近删除」
  相册: (R, push, D, pop) => {
    const hid = D.hide ||= [], fav = D.fav ||= [], key = p => '相册:' + p.what, hue = t => [...t].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
    const toP = r => ({ k: r[0], what: r[1] || '', t: r[2] || '', place: r[0] === '删除' ? '' : r[3] || '', why: r[0] === '删除' ? r[3] || '' : '', src: r[4] || '' });
    const byT = (a, b) => ts(a.t) - ts(b.t);
    const lib = () => of(R, '图库').map(toP).filter(p => !hid.includes(key(p))).sort(byT);
    const binned = () => [...of(R, '删除').map(toP), ...of(R, '图库').map(toP).filter(p => hid.includes(key(p)))].filter(p => !hid.includes('相册删:' + p.what)).sort(byT);
    const kind = p => /截屏|截图/.test(p.src) ? 'shot' : p.src && !/相机/.test(p.src) ? 'app' : 'cam';
    const glyph = p => /自拍|合照|人像/.test(p.what) ? 'user' : { shot: 'grid', app: 'download', cam: 'camera' }[kind(p)];
    const n = p => [...p.what].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const picKey = p => `peekpic:${D.id}:${n(p)}`;
    const art = (p, cls = '') => { const el = h('div.pk-ph__art' + cls, { style: { '--h': hue(p.what) } }, icon(glyph(p), 22, 1.6));
      const show = u => { el.style.backgroundImage = `url("${u}")`; el.classList.add('is-drawn'); };
      if (PICS.has(picKey(p))) show(PICS.get(picKey(p))); else kvGet(picKey(p)).then(u => { if (u) { PICS.set(picKey(p), u); show(u); } }, () => {});
      el._show = show; return el; };
    // 大图：左右滑换张（滚动对齐），顶上日期药丸、底下缩略图和一排按钮跟着这张变
    const md = p => { const t = ts(p.t), d = new Date(t); return t ? `${d.getMonth() + 1}月${d.getDate()}日` : p.t; };
    const viewer = (L, i0, bin, again) => {
      let i = i0, info = false;
      const pill = h('div.pk-glass.pk-ph__pill'), pager = h('div.pk-ph__pager'), strip = h('div.pk-ph__strip'), card = h('div.pk-ph__info');
      const slides = L.map(p => h('div.pk-ph__slide', art(p, '.is-big'), h('p', p.what)));
      pager.append(...slides); strip.append(...L.map((p, j) => h('button', { onclick: () => go(j) }, art(p))));
      const meta = p => { const k = kind(p), x = n(p), mb = k === 'cam' ? (1.6 + x % 30 / 10).toFixed(1) + ' MB' : 300 + x % 600 + ' KB';
        const t = ts(p.t), d = new Date(t);
        return [h('b', t ? `${ymd(p)} 星期${'日一二三四五六'[d.getDay()]} ${(/(\d{1,2}:\d{2})/.exec(p.t) || [''])[0]}` : p.t), h('small', 'IMG_' + (1000 + x % 9000)),
          h('div.pk-ph__cam', h('b', k === 'cam' ? '后置摄像头' : '无相机信息'), h('small', k === 'cam' ? '主摄 — 24 mm ƒ1.78' : '无镜头信息'), h('small', (k === 'cam' ? '12 MP · 3024 × 4032 · ' : k === 'shot' ? '截屏 · 1179 × 2556 · ' : '2 MP · 1080 × 1920 · ') + mb)),
          p.place ? h('div.pk-ph__row', icon('globe', 16, 2), p.place) : null, k === 'app' ? h('div.pk-ph__row', icon('download', 16, 2), `从「${p.src.replace(/保存|下载|的/g, '').trim()}」保存`) : null,
          p.why ? h('div.pk-ph__row', icon('trash', 16, 2), p.why) : null]; };
      const paint = () => { const p = L[i]; if (!p) return;
        pill.replaceChildren(h('b', md(p)), h('small', (/(\d{1,2}:\d{2})/.exec(p.t) || [''])[0]));
        [...strip.children].forEach((b, j) => b.classList.toggle('is-on', j === i)); strip.children[i]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        heart.classList.toggle('is-on', fav.includes(key(p))); card.replaceChildren(...meta(p)); };
      const go = j => { pager.scrollTo({ left: j * pager.clientWidth, behavior: 'smooth' }); };
      pager.addEventListener('scroll', () => { const j = Math.round(pager.scrollLeft / pager.clientWidth); if (j !== i) { i = j; paint(); } }, { passive: true });
      const heart = h('button', { 'aria-label': '喜欢', onclick: () => { const k = key(L[i]), on = !fav.includes(k); fav.splice(0, fav.length, ...fav.filter(y => y !== k)); if (on) fav.push(k); heart.classList.toggle('is-on', on); saveRead(D); } }, icon('heart', 22, 2));
      const draw = h('button', { 'aria-label': '画出来', onclick: () => busy(draw, async s => {
        const p = L[i], u = await generateImage(`${p.what}，手机随手拍的照片`, '查手机', resolveConn('image', 'peek'), s);
        if (!u) return; await kvSet(picKey(p), u); PICS.set(picKey(p), u); slides[i].firstChild._show(u); strip.children[i].firstChild._show(u); toast('画好了');
      }).catch(e => toast(e.message)) }, icon('sparkle', 22, 2));
      // 删除：照 iPhone 从垃圾桶那里冒出一小块说明 + 红字「删除照片」，点别处收起
      const ask = h('div.pk-ph__pop', { hidden: true }, h('p', bin ? '这张照片会被彻底删除，不能恢复。' : '这张照片会移到「最近删除」，30 天后彻底删除。'), h('button', { onclick: () => {
        ask.hidden = true; const p = L[i]; hid.push(bin ? '相册删:' + p.what : key(p)); saveRead(D);
        L.splice(i, 1); slides.splice(i, 1)[0].remove(); strip.children[i].remove(); again();
        if (!L.length) return pop(); i = Math.min(i, L.length - 1); pager.scrollLeft = i * pager.clientWidth; paint(); } }, '删除照片'));
      const trash = h('button', { 'aria-label': '删除', onclick: e => { e.stopPropagation(); ask.hidden = !ask.hidden; } }, icon('trash', 22, 2));
      const tip = h('button', { 'aria-label': '信息', onclick: () => { info = !info; wrap.classList.toggle('is-info', info); } }, icon('info', 22, 2));
      const wrap = h('div.pk-ph__view', { onclick: e => { if (!ask.contains(e.target)) ask.hidden = true; } }, pager, card);
      push('', () => [h('div.pk-top2.pk-ph__vtop', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 22, 2.4)), pill), wrap,
        h('div.pk-ph__foot', strip, h('div.pk-glass.pk-ph__bar', heart, tip, draw, trash), ask)], 'is-raw.pk-ph-full');
      requestAnimationFrame(() => { pager.scrollLeft = i * pager.clientWidth; paint(); });
    };
    // 一页格子（图库 / 隐藏 / 最近删除）：四列，最新的在最下面，一打开就在最底下；大图里删了一张，格子跟着重排（again）
    const grid = (L, bin, again) => h('div.pk-ph__grid', L.map((p, j) => h('button', { onclick: () => viewer(L, j, bin, again) }, art(p))));
    const sub = (t, get, bin) => { const sb = h('div.pk-ph__sub'), again = () => { sb.replaceChildren(grid(get(), bin, again)); paintMain(); }; again(); push(t, () => [sb]); };
    const ymd = p => { const d = new Date(ts(p.t)); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
    const range = L => L.length && ts(L[0].t) ? [...new Set([L[0], L[L.length - 1]].map(ymd))].join(' 至 ') : '';
    const box = h('div.pk-ph__main'), title = h('div.pk-ph__title'), seg = h('div.pk-glass.pk-ph__seg');
    let mode = '全部';
    const paintMain = () => { const L = lib(); title.replaceChildren(h('b', '图库'), h('small', range(L)));
      if (mode === '全部') box.replaceChildren(grid(L, false, paintMain), h('div.pk-ph__more', [['隐藏', 'lock', () => of(R, '隐藏').map(toP).sort(byT)], ['最近删除', 'trash', binned, true]].map(([t, ic, get, bin]) =>
        h('button.pk-row', { onclick: () => sub(t, get, bin) }, icon(ic, 20, 2), h('b', t), h('span', get().length + ' 张'), icon('chevron', 14, 2.6)))));
      else { const by = groupBy(L.map(p => { const t = ts(p.t), d = new Date(t); return [!t ? '更早' : mode === '年' ? d.getFullYear() + '年' : `${d.getFullYear()}年${d.getMonth() + 1}月`, p]; }), 0);
        box.replaceChildren(h('div.pk-ph__cards', by.map(([k, ps]) => h('button.pk-ph__card', { onclick: () => { mode = '全部'; seg.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.textContent === '全部')); paintMain(); } }, art(ps[ps.length - 1][1], '.is-big'), h('b', k), h('small', ps.length + ' 张'))))); } };
    seg.append(...['年', '月', '全部'].map(m => h('button' + (m === mode ? '.is-on' : ''), { onclick: e => { mode = m; seg.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === e.currentTarget)); paintMain(); } }, m)));
    paintMain();
    requestAnimationFrame(() => { const b = box.closest('.pk-app__body'); if (b) b.scrollTop = b.scrollHeight; });
    return [h('div.pk-top2.pk-ph__top', title), box, h('div.pk-float.pk-ph__float', seg)];
  },
  AI: (R, push) => {
    const box = list(), names = [...new Set(R.map(r => r[0]))];
    return [tabs(names, k => box.replaceChildren(...groupBy(R.filter(r => r[0] === k), 1).map(([title, L]) => h('button.pk-row.is-col', { onclick: () => push(k, L.map(r => h('div.pk-bub' + (/自己/.test(r[2]) ? '.is-me' : ''), r[3])), 'pk-sms.pk-im') }, h('b', title), h('span', L[L.length - 1][3]))))), box];
  },
  屏幕使用时间: R => { const max = Math.max(...R.map(r => +r[1] || 0), 1), all = R.reduce((a, r) => a + (+r[1] || 0), 0), hm = m => (m >= 60 ? Math.floor(m / 60) + ' 小时 ' : '') + (m % 60) + ' 分钟';
    return [h('div.pk-day', '今天'), h('div.pk-card', h('b.pk-big', hm(all))), list(R.map(([n, m]) => h('div.pk-row', h('div', h('b', n), h('i.pk-bar', { style: { width: (+m || 0) / max * 100 + '%' } })), h('time', hm(+m || 0)))))]; },
  // 备忘录：照 iPhone 的「备忘录」（作者录的视频）：文件夹 → 这个文件夹里的便签（按多久以前分段）→ 一条便签。
  // 一行：便签｜标题｜日期｜文件夹｜正文；清单的正文是一样一样的（√ 办了、○ 没办）；草稿第四格是写给谁；共用第四格是和谁共用，正文每行开头「名字：」是谁写的；
  // 已删｜标题｜哪天删的｜正文 是 TA 自己删掉、还在「最近删除」里的；心声｜情绪｜话 是上了锁的那条。哪一行前面写了「划掉：」就划掉。以前存的便签没有文件夹那一格，涂鸦不显示了
  // 你自己的备忘录 App（apps/memo）也用这一套：D.write / D.tick / D.del / D.share 给了就能写、能勾、能删、能选和谁共用；每一页都是现算的，改完能原地重画
  备忘录: (R, push, D, pop) => {
    const now = time.isStory() ? time.story().date : new Date(), TICK = /^([√✓✔☑○◯□☐]|\[[ xX]\])\s*/, CUT = /^划掉[:：]\s*/, BY = /^([^：:]{1,12})[：:]\s*/, HUE = ['#ffd60a', '#ff6482', '#64d2ff', '#bf5af2'];
    const day = t => { const m = DT.exec(t || '') || /()(\d{1,2})[-/.月](\d{1,2})/.exec(t || ''); return m ? new Date(+m[1] || now.getFullYear(), m[2] - 1, +m[3]) : null; };
    const calc = () => { const heart = R.find(r => r[0] === '心声');
      const all = [...(heart ? [{ r: heart, k: '心声', t: '私密', d: '', f: '', moods: heart[1] || '', body: heart[2] || '' }] : []),
        ...R.filter(r => r[0] !== '心声' && r[0] !== '涂鸦').map(r0 => { const k = ['便签', '清单', '草稿', '共用', '已删'].includes(r0[0]) ? r0[0] : '', r = k ? r0.slice(1) : r0;
          return r.length < 4 ? { r: r0, k: k === '已删' ? k : '便签', t: r[0], d: r[1], f: '', body: r[2] || '' } : { r: r0, k: k || '便签', t: r[0], d: r[1], f: k === '草稿' || k === '共用' ? '' : r[2] || '', to: r[2], body: r[3] || '' }; }).sort((a, b) => (day(b.d) || 0) - (day(a.d) || 0))];
      return { notes: all.filter(n => n.k !== '已删'), bin: all.filter(n => n.k === '已删') }; };
    const lines = n => n.body.split('//').map(x => x.trim()).filter(Boolean), fo = n => untr(n.f)[0].trim();
    const sec = n => { const d = day(n.d); if (n.r?.[7]) return '置顶'; if (n.k === '心声') return ''; if (!d) return '更早'; const ago = (now - d) / 864e5;
      return ago < 7 ? '过去 7 天' : ago < 30 ? '过去 30 天' : d.getFullYear() === now.getFullYear() ? d.toLocaleDateString('zh-CN', { month: 'long' }) : d.getFullYear() + ' 年'; };
    const back = () => h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 24, 2.4));
    // TA 手机里的清单也能勾：改的是查手机存的那份（重新生成才换掉）
    const keep = () => (D.keep ? D.keep() : kvGet('peek:' + D.id).then(d => { d.apps.备忘录 = D.apps.备忘录; return kvSet('peek:' + D.id, d); }).catch(e => toast('没存上：' + e.message)));
    const tick = (r, i, dot) => { const L = r[4].split('//').map(x => x.trim()).filter(Boolean), on = !dot.classList.contains('is-done');
      L[i] = L[i].replace(/[√✓✔☑○◯□☐]/, on ? '√' : '○'); r[4] = L.join('//'); dot.classList.toggle('is-done', on); keep(); };
    // TA 的手机上点这些（写、分享、更多、清单…）：不让动，只说一句（你自己的备忘录照常用）
    const no = el => (D.del ? el : Object.assign(el, { onclick: () => toast(`这是${D.name}的手机，不可以乱动哦 (>﹏<)`) }));
    const write = x => no(h('button.pk-glass.is-round', { 'aria-label': '写备忘录', onclick: D.write && (() => D.write(x)) }, icon('edit', 22, 2)));
    // 共用的：你涂你的颜色（默认黄），TA 涂 TA 的印象色（映像里挑，没挑过从头像取；两个太像就把 TA 的换开），别的人按顺序分
    const folks = n => { const L = sharedWith(n.r || []).map(contact).filter(Boolean); return L.length ? L : [contact(D.id)].filter(Boolean); };
    const inkBy = (n, by, who) => { const cs = folks(n), ks = inksFor(cs), k = cs.findIndex(c => [c.name, c.nick, c.remark, nameOf(c)].includes(by));
      return by === myName() ? ks[0] : k >= 0 ? ks[k + 1] : HUE[(who.indexOf(by) + 1) % 4]; };
    // 谁建的：第十二格记着；以前的没记，看第一行是谁写的
    const maker = n => { const k = n.r?.[11], c = k && k !== 'me' && contact(k), first = BY.exec(n.body.split('//')[0] || '');
      const who = k === 'me' ? myName() : c ? nameOf(c) : first ? first[1] : ''; return D.del && who === myName() ? '我' : who; };
    // 一行：共用的先认是谁写的（每个人一个颜色），再认打没打勾、是不是划掉的；网址标成链接
    // 前面的「谁：」、勾、「划掉：」中文翻译那半也带着一份：一起去掉，不然点「译」后圈后面又冒出一个 √
    const both = (x, re) => x.replace(re, '').replace(new RegExp('([[［【]翻译[:：]\\s*)' + re.source.slice(1)), '$1');
    const para = (x, n, who, i) => { let by = '', done = null, m;
      if (n.k === '共用' && (m = BY.exec(x))) { by = m[1]; x = both(x, BY); if (!who.includes(by)) who.push(by); }
      if ((m = TICK.exec(x) || TICK.exec(TR.exec(x)?.[1] || ''))) { done = /[√✓✔☑xX]/.test(m[1]); x = both(x, TICK); }   // 勾只写在了中文那半里的也认
      const k = INKLINE.exec(x)?.[1];   // 画：和字一样占一行，点了接着画（你自己的）
      if (k) { const im = k.startsWith('memo-draw:svg') ? taInk(k) : Object.assign(inkImg(k), { onclick: e => (D.draw ? D.draw(n.r, null, k, e.currentTarget) : play(e.currentTarget)) });
        return again(h('figure.pk-nt__fig', by ? { dataset: { by }, style: { '--c': inkBy(n, by, who) } } : null, by && h('small', by), im), im); }
      const cut = CUT.test(x); x = both(x, CUT);
      const p = h('p' + (done != null ? '.is-todo' : '') + (cut ? '.is-cut' : ''), by ? { dataset: { by }, style: { '--c': inkBy(n, by, who) } } : null, done != null && h('i' + (done ? '.is-done' : ''), { role: 'button', onclick: e => (D.tick || tick)(n.r, i, e.currentTarget) }), by && h('small', by),
        h('span', x.split(/(https?:\/\/[^\s[\]]+)/).map((v, i) => i % 2 ? h('u', v) : v)));
      // 共用的：长按别人写的那一句，删掉，或者删掉让 TA 重新回（你自己的备忘录）
      if (D.unsay && by && by !== myName()) onLongPress(p, () => actionSheet('', [{ value: 'again', label: `让 ${by} 重新回` }, { value: 'del', label: '删除这句', danger: true }]).then(v => v && D.unsay(n.r, i, v === 'again')));
      return p; };
    const open = n0 => push(n0.t, () => { const S = calc(), n = [...S.notes, ...S.bin].find(x => x.r === n0.r) || n0, m = DT.exec(n.d || ''), who = [];
      const body = h('div.pk-nt__lines', lines(n).map((x, i) => para(x, n, who, i)));   // 名字默认不写，点顶上的小人才出来
      // 共用的：一排小圆点写着谁是什么颜色（好几个人一起记时光看颜色分不清）
      const key = () => { const cs = folks(n), ks = inksFor(cs); return h('div.pk-nt__key', [[D.del ? '我' : myName(), ks[0]], ...cs.map((c, i) => [nameOf(c), ks[i + 1]])].map(([nm, c]) => h('span', { style: { '--c': c } }, nm))); };
      let legend = n.k === '共用' ? key() : null;
      if (legend) folks(n).forEach(c => autoInk(c).then(ch => { if (!ch) return; body.querySelectorAll('[data-by]').forEach(p => p.style.setProperty('--c', inkBy(n, p.dataset.by, who))); const L = key(); legend.replaceWith(L); legend = L; }, () => {}));   // 头像第一次取色：取好只换颜色
      return [h('div.pk-top2', back(), h('div.pk-glass.pk-nt__pill', n.k === '共用' && h('button', { 'aria-label': '谁写的', onclick: () => body.classList.toggle('is-who') }, icon('users', 22, 1.9)),
          D.share ? h('button.is-ink', { 'aria-label': '和谁共用', onclick: () => D.share(n.r) }, ink('share', 22, 1.9)) : no(ink('share', 22, 1.9)), no(ink('more', 22, 2.8)))),
        h('time.pk-nt__date', (m ? `${m[1]}年${+m[2]}月${+m[3]}日${m[4] ? ` ${m[4].padStart(2, '0')}:${m[5]}` : ''}` : n.d) + (n.k === '共用' ? ' — 共享' : '')), n.t ? h('h1', n.t) : null,
        n.k === '心声' ? [h('small.pk-unlock', icon('lock', 14, 2.2), '已用面容解锁'), h('div.pk-moods', moods(n.moods).map(x => h('span', x)))] : null,
        n.k === '共用' ? h('small.pk-nt__to', (m => { const to = (n.to || '别人').split('、').filter(x => x !== m); return (m ? `${m}创建 · ` : '') + (to.length ? `与 ${to.join('、')} 共用` : '共用'); })(maker(n))) : null, legend, body,
        h('div.pk-float', no(h('div.pk-glass.pk-nt__pill', ink('todo', 22, 1.9), ink('clip', 22, 1.9), D.draw ? h('button.is-ink', { 'aria-label': '画画', onclick: () => D.draw(n.r, body) }, ink('pen', 22, 1.9)) : ink('pen', 22, 1.9))), h('i'), write(n.r))]; }, 'is-raw.pk-nt.is-doc');
    // 这是 TA 的手机：左滑能看到删除，点了不让删（你自己的备忘录才真的删）
    const nope = () => toast(`这是${D.name}的手机，不可以乱动哦 (>﹏<)`);
    // TA 手机里翻到不想要的能删（删的是查手机存的那份，重新生成时只加新的、不会再写回来）；和你共用的那几张在你自己的备忘录里删
    const drop = D.drop || (async rs => { const src = D.apps?.备忘录?.rows || [], mine = rs.filter(r => src.includes(r));
      if (!mine.length) { toast('共用的去你自己的备忘录里删'); return false; }
      if (!await dialog({ title: mine.length > 1 ? `删除 ${mine.length} 条备忘录？` : '删除这条备忘录？', confirm: '删除', danger: true })) return false;
      mine.forEach(r => { src.splice(src.indexOf(r), 1); R.splice(R.indexOf(r), 1); }); keep(); });
    const del = D.del || ((r, w) => drop([r]).then(ok => { if (ok !== false && w) gone(w); }));
    const pin = (r, w) => { r[7] = r[7] ? 0 : 1; keep(); w.closest('.pk-nt__cards')?._paint(); };
    // 长按一条：后面变暗，这一条放大给你看，底下一组菜单（照 iPhone）；TA 的手机上只有置顶、复制能用
    const menu = (n, w) => { const L = w.closest('.pk-app'), close = () => ov.remove();
      const act = (ic, label, fn, red) => h('button' + (red ? '.is-red' : ''), { onclick: () => { close(); fn(); } }, icon(ic, 20, 2), h('small', label));
      const line = (ic, label, fn) => h('button.pk-ctx__li', { onclick: () => { close(); fn(); } }, icon(ic, 18, 2), label);
      const ov = h('div.pk-ctx', { onclick: e => { if (e.target === ov) close(); } },
        h('div.pk-ctx__card', n.t ? h('b', n.t) : null, lines(n).slice(0, 14).map(x => h('p', bare(n, x)))),
        h('div.pk-ctx__menu', h('div.pk-ctx__acts', act('share', '共享', D.share ? () => D.share(n.r) : nope), act('folder', '移动', D.move ? () => D.move([n.r]) : nope), act('trash', '删除', () => del(n.r, w), true)),
          n.k !== '已删' && n.r ? line('pin', n.r[7] ? '取消置顶备忘录' : '置顶备忘录', () => pin(n.r, w)) : null,
          line('note', '复制备忘录', () => navigator.clipboard.writeText([n.t, ...lines(n).map(x => bare(n, x))].filter(Boolean).join('\n')).then(() => toast('已复制'), () => toast('复制不了')))));
      L.append(ov); trs(ov); };
    // 列表里那一行：前面的名字、勾、「划掉：」都不要（翻译那半里的也去掉）
    const bare = (n, x) => both(both(n.k === '共用' ? both(x, BY) : x, TICK), CUT).replace(/✎memo-draw:\S+$/, '［画］');
    const row = (n, all) => Object.assign(swipe(h('button.pk-nt__row' + (n.r && n.r[6] ? '.is-new' : ''), { onclick: e => { const c = e.currentTarget.closest('.pk-nt__cards'); if (c?._pick) return c._pick(n, e.currentTarget);
      if (D.seen && n.r[6]) { e.currentTarget.classList.remove('is-new'); D.seen(n.r); } open(n); } }, h('b', n.t || bare(n, lines(n)[0] || '新建备忘录')),
      h('span', n.d && h('time', n.k === '已删' && day(n.d) ? `还剩 ${Math.max(1, 30 - Math.floor((now - day(n.d)) / 864e5))} 天` : when(n.d)), n.k === '心声' ? [icon('lock', 13, 2.2), '已锁定'] : bare(n, lines(n)[n.t ? 0 : 1] || '无更多文本')),
      n.k === '共用' ? h('small', icon('users', 14, 1.8), `与 ${n.to || '别人'} 共用`) : all && h('small', ink('folder', 14, 1.8), n.f || '备忘录'), n.r && drawn(n.r)[0] && pic(drawn(n.r)[0], 'pk-nt__thumb')),
      [['share', '#0a84ff', () => (D.share ? D.share(n.r) : nope()), '共享'], ['folder', '#5e5ce6', () => (D.move ? D.move([n.r]) : nope()), '移动'], ['trash', 'var(--tint)', w => del(n.r, w), '删除']],
      n.r && n.k !== '已删' ? [['pin', '#ff9f0a', w => pin(n.r, w), n.r[7] ? '取消置顶' : '置顶']] : []), { _q: (n.t + n.body + n.f).toLowerCase(), _n: n });
    let fold = false;   // 「置顶」那一段收起来没有（点段标题收起 / 展开）
    // 一个文件夹（sel 从现在的全部里挑出这一页的）：按多久以前分段，每段一张卡片；底下的搜索是真的（只在这一页里找）
    const folder = (name, sel, all, focus) => { let find;
      push(name, () => { const tb = h('b', name), big = h('h1', name), cards = h('div.pk-nt__cards');   // 置顶 / 取消置顶后只重排这一页的卡片
        // 点「⋯」就是选择备忘录：每条前面一个圈，点了勾上；顶上写选了几条，底下换成移动 / 删除（一条没选时是全部）
        const picked = new Set(), more = h('button.pk-glass.is-round', { 'aria-label': '选择备忘录', onclick: () => pickMode(true) }, ink('more', 22, 2.8));
        const done = h('button.pk-glass.is-round', { 'aria-label': '完成', onclick: () => pickMode(false) }, icon('check', 22, 2.4));
        const mv = h('button.pk-glass', { hidden: !D.move, onclick: () => D.move(chosen()).then(ok => ok !== false && pickMode(false)) }), dl = h('button.pk-glass.is-del', { onclick: () => drop(chosen()).then(ok => { if (ok !== false) { pickMode(false); paint(); } }) });
        const chosen = () => (picked.size ? [...picked] : sel(calc()).filter(n => n.r).map(n => n.r));
        // 选的时候左上角的返回换成「全选」，全选上了就变「取消全选」
        const every = () => { const L = sel(calc()).filter(n => n.r); return L.length && L.every(n => picked.has(n.r)); };
        const allBtn = h('button.pk-glass', { onclick: () => { if (every()) picked.clear(); else sel(calc()).forEach(n => n.r && picked.add(n.r));
          cards.querySelectorAll('.pk-swipe').forEach(w => w.lastChild.classList.toggle('is-sel', picked.has(w._n.r))); count(); } }, '全选'), bk = back();
        const bar = h('div.pk-float.pk-nt__pick', mv, h('i'), dl);
        const count = () => { const k = picked.size; allBtn.textContent = every() ? '取消全选' : '全选'; tb.textContent = big.textContent = k ? `已选定 ${k} 项` : name; mv.textContent = k ? '移动' : '移动全部'; dl.textContent = k ? '删除' : '全部删除'; };
        const pickMode = on => { picked.clear(); cards.classList.toggle('is-pick', on); cards._pick = on && ((n, el) => { picked.has(n.r) ? picked.delete(n.r) : picked.add(n.r); el.classList.toggle('is-sel', picked.has(n.r)); count(); });
          head.lastChild.replaceWith(on ? done : more); head.firstChild.replaceWith(on ? allBtn : bk); float.hidden = on; bar.hidden = !on; count(); cards.querySelectorAll('.is-sel').forEach(x => x.classList.remove('is-sel')); };
        const head = h('div.pk-top2', bk, tb, more); bigTitle(head, big);
        const paint = cards._paint = () => { const L = sel(calc()).sort((a, b) => !!b.r?.[7] - !!a.r?.[7]), up = L.some(n => n.r?.[7]);   // 有置顶的：心声并进置顶那一组，不单独一张卡片
          cards.replaceChildren(...groupBy(L.map(n => [n.k === '心声' && up ? '置顶' : sec(n), n]), 0).flatMap(([t, G]) => {
          const card = h('div.pk-nt__card', { hidden: t === '置顶' && fold }, G.map(([, n]) => { const w = row(n, all); onLongPress(w.lastChild, () => !cards._pick && menu(n, w)); if (picked.has(n.r)) w.lastChild.classList.add('is-sel'); return w; }));
          return [t === '置顶' ? h('h3.pk-nt__fold' + (fold ? '.is-shut' : ''), { onclick: e => { fold = !fold; card.hidden = fold; e.currentTarget.classList.toggle('is-shut', fold); } }, t, icon('chevron', 15, 2.8)) : h('h3', t), card]; })); };
        paint();
        find = h('input', { type: 'search', placeholder: '搜索', 'aria-label': '搜索', oninput: e => { const q = e.target.value.trim().toLowerCase();
          cards.querySelectorAll('.pk-swipe').forEach(w => { w.hidden = !!q && !w._q.includes(q); });
          cards.querySelectorAll('.pk-nt__card').forEach(c => { c.hidden = c.previousElementSibling.hidden = ![...c.children].some(w => !w.hidden); }); } });
        const float = h('div.pk-float', h('label.pk-glass.pk-find', icon('search', 22, 2.4), find, icon('mic', 20, 2)), write(all || /^(共享|最近删除|备忘录)$/.test(name) ? '' : name));
        bar.hidden = true;
        return [head, big, cards, float, bar]; }, 'is-raw.pk-nt');
      if (focus) find.focus({ preventScroll: true });
    };
    const S = calc(), ALL = x => x.notes, SH = x => x.notes.filter(n => n.k === '共用');
    const head = h('div.pk-top2', h('i'), h('b', '文件夹'), h('div.pk-nt__r', no(h('button.pk-glass.is-round', { 'aria-label': '新建文件夹', onclick: D.folder }, ink('folder', 22, 1.9))), no(h('button.pk-glass', '编辑')))), big = h('h1', '文件夹'); bigTitle(head, big);
    const frow = (name, sel, all, ic = ink('folder', 24, 1.7)) => h('button.pk-row', { onclick: () => folder(name, sel, all) }, ic, h('b', name), h('span', '' + sel(S).length), icon('chevron', 16, 2.2));
    return [head, big, SH(S).length ? h('div.pk-nt__card', frow('共享', SH, false, icon('users', 24, 1.7))) : null, h('h3.pk-nt__f', 'iCloud', icon('chevron', 15, 2.8)),
      h('div.pk-nt__card', frow('全部备忘录', ALL, true), [...new Set(['', ...S.notes.map(fo)])].map(f => frow(f ? S.notes.find(n => fo(n) === f).f : '备忘录', x => x.notes.filter(n => fo(n) === f))),
        S.bin.length ? frow('最近删除', x => x.bin, false, icon('trash', 24, 1.7)) : null),
      h('div.pk-float', h('button.pk-glass.pk-find', { onclick: () => folder('全部备忘录', ALL, true, true) }, icon('search', 22, 2.4), h('span', '搜索'), icon('mic', 20, 2)), write(''))];
  },
  // 搜索：谷歌那样，彩色的字、圆的搜索框、常去的网站，下面分 搜索 / 历史记录 / 收藏夹 / 无痕。
  // 点一条搜索、一个网页，进去就是那一页（文章或视频）；内容都是生成时一起写好的，点开不找 AI
  搜索: (R, push, D, pop) => {
    const host = u => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
    const hue = s => `hsl(${Math.abs([...String(s)].reduce((n, c) => n * 31 + c.charCodeAt(0) | 0, 7)) % 360} 55% 52%)`;
    // 一页：看过｜收藏｜无痕 + 类型｜标题｜网址｜时间｜看完想的｜正文｜视频的时长和播放量；v0.8.591 以前存的格式也认
    const pg = r => /^(文章|视频)$/.test(r[1]) ? { type: r[1], title: r[2], u: r[3], t: r[4], thought: r[5], body: r[6], meta: r[7] }
      : r[0] === '收藏' ? { type: '文章', title: r[1], u: r[2], body: r[3] } : r[0] === '看过' ? { type: '文章', title: r[1], u: r[2], thought: r[3], t: r[4], body: r[5] } : { type: '文章', title: r[3], u: r[4], t: r[2], body: r[5] };
    const of = k => R.filter(r => r[0] === k).map(pg), seen = of('看过'), favs = of('收藏'), priv = of('无痕');
    // 收藏、搜索只写了标题的，正文和看完想的用同标题那页的
    const full = p => { const o = { ...[...seen, ...priv].find(y => y.title === p.title) }; for (const k in p) if (p[k]) o[k] = p[k]; return o; };
    const tap = go => go && { role: 'button', onclick: go };
    const open = (p, dark) => (p = full(p)).body && (() => page(p, dark));
    const ofFind = r => ({ title: r[3], u: r[4], body: /::|：：/.test(r[5] || '') ? '' : r[5] });
    const back = () => h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 22, 2.4));
    const kind = p => p.type === '视频' ? icon('play', 17, 2) : icon('note', 17, 1.9);
    // 正文：// 分段；「■小标题：」一节、「> 」引用、「[图：…]」配图的位置，**词** 标蓝
    const rich = v => v.split(/\*\*(.+?)\*\*/).map((x, i) => i % 2 ? h('b', x) : x);
    const block = (v, i) => { let m;
      if ((m = /^[[［【][图図][:：]\s*([\s\S]*?)[\]］】]$/.exec(v))) return h('figure.pk-saf__pic', h('div', { style: { '--c': hue('图' + i) } }, icon('image', 30, 1.5)), h('figcaption', m[1]));
      if ((m = /^[>＞》]\s*([\s\S]*)$/.exec(v))) return h('blockquote', ...rich(m[1]));
      if ((m = /^[■●•]\s*([^：:]{1,16})[：:]\s*([\s\S]*)$/.exec(v))) return h('p.is-sec', h('strong', ...rich(m[1])), h('br'), ...rich(m[2]));
      return h('p', ...rich(v)); };
    const blocks = v => v.split(/(?<!:)\/\//).map(x => x.trim()).filter(Boolean).map(block);   // 配图的颜色按第几段定：原文、中文切换时不变色
    // 原文和要显示的那版：AI 有时每段后面各附一个翻译，有时整篇末尾附一个（里面也用 // 分段）
    const both = s => {
      const one = (s.match(/[[［【]翻译[:：]/g) || []).length === 1 && /^([\s\S]*?)\s*[[［【]翻译[:：]\s*([\s\S]*)[\]］】]\s*$/.exec(s);
      if (one) return view(one[1], one[2]);
      const V = s.split(/(?<!:)\/\//).map(untr).map(([a, z]) => z ? view(a, z) : [a, '']);
      return [V.map(v => v[0]).join('//'), V.some(v => v[1]) ? V.map(v => v[1] || v[0]).join('//') : ''];
    };
    // 一个网页：顶上返回、网址、小云朵（点开是 TA 看完想的）；文章是网站、标题、正文，视频是播放器、标题、简介
    const page = (p, dark) => {
      const T = [p.title, p.body, p.thought || ''].map(both), h2 = h('h2.pk-saf__h'), art = h('div.pk-saf__art'), think = h('p');
      const put = z => { const [a, b, c] = T.map(([x, y]) => z && y || x); h2.textContent = a; art.replaceChildren(...blocks(b)); think.replaceChildren(...rich(c)); };
      if (T.some(x => x[1])) Object.assign(art, { _put: put }).classList.add('pk-trx');
      put(trOn());
      const cloud = p.thought && h('div.pk-saf__think', { hidden: true }, h('small', '看完'), think);
      const dur = (/\d{1,2}:\d{2}(?::\d{2})?/.exec(p.meta || '') || [''])[0], views = (p.meta || '').replace(dur, '').replace(/^[\s·,，、|｜]+|[\s·,，、|｜]+$/g, '');
      const meta = h('div.pk-saf__meta', h('i', { style: { background: hue(host(p.u)) } }, (host(p.u) || '?').slice(0, 1).toUpperCase()), h('b', host(p.u)), views && h('span', views), p.t && h('span', when(p.t)));
      push('', () => [h('div.pk-top2.pk-saf__top', back(), h('div.pk-saf__url', icon(p.type === '视频' ? 'play' : 'globe', 14, 2), h('span', (p.u || '').replace(/^https?:\/\//, ''))),
        cloud && h('button.pk-glass.is-round', { 'aria-label': '看完想的', onclick: () => { cloud.hidden = !cloud.hidden; } }, ink('cloud', 22, 1.9))), cloud,
        h('div.pk-saf.is-page' + (dark ? '.is-dark' : ''), p.type === '视频' ? [h('div.pk-saf__player', fill('play', 30), dur && h('time', dur)), h2, meta, art] : [meta, h2, art])], 'is-raw');
    };
    const site = (p, right, dark) => h('div.pk-web__row', tap(open(p, dark)), h('i', (host(p.u) || p.title || '?').slice(0, 1).toUpperCase()), h('div', h('b', p.title), h('small', host(p.u))), right);
    const query = r => h('div.pk-web__q', tap(open(ofFind(r))), icon('search', 18, 2.2), h('b', r[1]), r[2] && h('time', when(r[2])));
    const list = (title, n, kids, dark) => [h('div.pk-web__head', h('b', title), n != null && h('small', `${n} 条`)), h('div.pk-web__card.is-list' + (dark ? '.is-dark' : ''), kids)];
    const finds = R.filter(r => r[0] === '搜索');
    const panes = {
      搜索: () => finds.length ? list('最近搜索', null, finds.map(query)) : null,
      历史记录: () => list('最近访问', null, R.filter(r => r[0] === '搜索' || r[0] === '看过').map(r => r[0] === '搜索' ? query(r) : (p => site(p, h('time', when(p.t))))(pg(r)))),
      收藏夹: () => list('网页收藏', favs.length, favs.map(p => site(p, icon('bookmark', 17, 2)))),
      无痕: () => list('无痕浏览', priv.length, priv.map(p => site(p, p.type === '视频' ? icon('play', 17, 2) : icon('eyeOff', 17, 2), true)), true),
    };
    const box = h('div.pk-web__pane'), go = k => { [...tabsEl.children].forEach(b => b.setAttribute('aria-pressed', b.textContent === k)); box.replaceChildren(...[panes[k]()].flat(4).filter(Boolean)); };
    const tabsEl = h('nav.pk-web__tabs', Object.keys(panes).map(k => h('button', { onclick: () => go(k) }, k)));
    // 常去的：看过的网页里出现最多的几个网站
    const top = [...seen.reduce((m, p) => m.set(host(p.u), (m.get(host(p.u)) || 0) + 1), new Map())].filter(x => x[0]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    go('搜索');
    return [h('div.pk-top2.pk-web__top'), h('div.pk-web',
      h('div.pk-web__logo', [...'Google'].map(c => h('span', c))),
      h('div.pk-web__field', icon('search', 18, 2.2), h('span', '搜索或输入网址'), icon('mic', 18, 2)),
      top.length ? h('div.pk-web__sites', top.map(([u]) => h('div', h('i', u.slice(0, 1).toUpperCase()), h('small', u)))) : null,
      tabsEl, box),
      h('div.pk-web__bar', h('div', icon('globe', 15, 2), h('span', seen[0] ? host(seen[0].u) : 'google.com')), icon('back', 20, 2.2), icon('chevron', 20, 2.2), h('button', { 'aria-label': '收藏夹', onclick: () => go('收藏夹') }, icon('bookmark', 20, 2)))];
  },
  // 信息、电话照 iPhone 自带的排：整页自己画（顶上的玻璃按钮、底下浮着的搜索条 / 标签栏），不用公共的标题栏
  // 短信里和你的那段照你手机「短信」里真有的放，AI 写的和你的不要（以前生成的也藏起来）
  短信: (R, push, D, pop) => { const known = new Set(of((D.apps.电话 || {}).rows || [], '联系人').flatMap(r => r.slice(1, 3))), nick = nicks(D);
    return messenger([...(D.sms ? [{ ...D.sms, title: nick.get(myName()) || myName() }] : []), ...groupBy(R.filter(r => r[0] !== myName() && r[0] !== nick.get(myName())), 0).map(([who, L]) => ({ title: nick.get(who) || who, msgs: L.map(r => ({ me: /自己/.test(r[2]), t: r[1], text: r[3] })) }))], push, D, pop,
      { title: '信息', kind: '短信', key: '', spam: x => /^[\d\s()+-]{5,}$/.test(x.title) && !known.has(x.title) && !x.msgs.some(m => m.me) }); },
  消息: (R, push, D, pop) => messenger(chats(R, D), push, D, pop, { title: '消息', kind: 'iMessage', key: '消息:' }),
  // 照 iPhone 的「电话」：底下浮着三个标签 + 搜索；点搜索换成「通话 / 语音留言」那一页，底下换成键盘 · 搜索条 · 关
  电话: (R, push, D, pop) => {
    const box = h('div.pk-pane'), nick = nicks(D), me = [myName(), nick.get(myName())], calls = [...D.calls, ...R.filter(r => r[0] !== '联系人' && r[0] !== '留言' && !me.includes(r[0]))].sort((a, b) => ts(b[2]) - ts(a[2])), notes = of(R, '留言').filter(r => !me.includes(r[1])), num = h('div.pk-pad__num'), nm = who => nick.get(who) || who;
    const miss = k => /未接/.test(k), place = (s, who) => !s || /\d\s*[分秒:：]|^\d+$/.test(s) ? (/\d{3}/.test(who) ? '未知' : '手机') : s;   // 以前存的这一格是通话时长，不是归属地
    // D.dial / D.note：你自己的「电话」App 也用这一页，那边按了真打、点留言能听；查手机里没有，就只是样子
    const callBtn = (who, loc) => h('i.pk-dial', D.dial ? { onclick: e => { e.stopPropagation(); D.dial(who, loc); } } : null, fill('call', 22));
    const call = r => { const [who, kind = '', t, loc] = r, el = h('div.pk-call' + (miss(kind) ? '.is-miss' : ''), ava(nm(who), D.face?.(who)), h('div', h('b', nm(who)), h('span', h('em', '主号'), place(loc, who))), h('time', when(t)), callBtn(who, loc));
      return D.del ? swipe(el, [['trash', '#ff3b30', w => D.del(r, w)]]) : el; };
    const note = r => { const [, who, t, len, text] = r; return h('div.pk-call.is-note', D.note ? { onclick: () => D.note(r) } : null, ava(nm(who), D.face?.(who)), h('div', h('b', nm(who)), h('span', h('em', '主号'), len || '00:00'), h('p', `“${text || ''}”`)), h('time', when(t)), callBtn(who)); };
    const head = (t, go) => h('div.pk-sec', h('b', t), h('button', { onclick: go }, '查看全部'));
    const panes = {
      通话: () => { let f = '全部'; const L = h('div.pk-calls', calls.map(call));
        const pick = async () => { const v = await actionSheet('筛选', ['全部', '未接来电', '语音留言'].map(label => ({ value: label, label, active: label === f }))); if (!v || v === f) return;
          f = v; L.replaceChildren(...(v === '语音留言' ? notes.map(note) : calls.filter(r => v === '全部' || miss(r[1])).map(call))); };
        const top = h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', '通话'), h('button.pk-glass.is-round', { 'aria-label': '筛选', onclick: pick }, ink('lines', 20, 2.2))), big = h('h1', '通话'); bigTitle(top, big); return [top, big, L]; },
      通讯录: () => {
        const by = new Map(); of(R, '联系人').map(r => r.length > 3 ? r[2] || r[1] : r[1]).sort(sortZh).forEach(n => { const k = initial(n); (by.get(k) || by.set(k, []).get(k)).push(n); });
        const secs = [...by].sort((a, b) => (a[0] === '#') - (b[0] === '#') || a[0].localeCompare(b[0]));
        const list = h('div.pk-book', h('div.pk-book__me', face2(D.name, D.avatar, '.is-me'), h('div', h('b', D.name), h('span', '我的名片'))),
          secs.map(([k, L]) => [h('div.pk-book__k', { dataset: { k } }, k), L.map(who => h('div.pk-book__row', D.dial ? { onclick: () => D.dial(who) } : null, face2(who, D.face?.(who)), h('div', h('b', who))))]));
        const jump = k => { const el = list.querySelector(`[data-k="${k}"]`); el && el.scrollIntoView({ block: 'start' }); };
        return [h('div.pk-top2', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 22, 2.4)), h('b', '联系人'), h('button.pk-glass.is-round', { 'aria-label': '新建' }, icon('plus', 22, 2.2))),
          list, h('div.pk-index', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'].map(k => h('button', { onclick: () => jump(k) }, k)))];
      },
      // 按了数字，拨打键右边出来一个删除键；拨打 = 清空
      拨号键盘: () => { const del = h('button.pk-pad__del', { 'aria-label': '删除', hidden: true, onclick: () => { num.textContent = num.textContent.slice(0, -1); del.hidden = !num.textContent; } }, icon('close', 18, 2.6));
        return [num, h('div.pk-pad', [...'123456789*0#'].map((d, i) => h('button', { onclick: () => { num.textContent += d; del.hidden = false; } }, h('b', d), h('small', ABC[i])))),
          h('div.pk-pad__row', h('i'), h('button.pk-pad__call', { 'aria-label': '拨打', onclick: () => { D.dial?.(num.textContent); num.textContent = ''; del.hidden = true; } }, fill('call', 36)), del)]; },
    };
    // 底下的标签：灰色的那块像一滴水滑到新的那格（中途鼓一下），新那格的图标也跟着鼓一下
    const tab = n => { const bs = [...bar.querySelectorAll('button')], i = bs.findIndex(b => b.dataset.n === n), old = bs.find(b => b.classList.contains('is-on'));
      if (old && old !== bs[i]) { pill.animate([{ scale: '1 1' }, { scale: '1.14 1.06', offset: .35 }, { scale: '1 1' }], { duration: 460, easing: 'ease-out' }); bs[i].firstChild.animate([{ scale: 1 }, { scale: 1.28, offset: .4 }, { scale: 1 }], { duration: 420, easing: 'ease-out' }); }
      pill.style.transform = `translateX(${i * 100}%)`; bs.forEach(b => b.classList.toggle('is-on', b === bs[i])); box.dataset.pane = { 通话: 'calls', 通讯录: 'book', 拨号键盘: 'pad' }[n]; box.replaceChildren(...panes[n]()); float.replaceChildren(bar, findB); };
    const pill = h('i.pk-tabpill');
    const bar = h('div.pk-glass.pk-tabbar', pill, [['通话', 'clock'], ['通讯录', 'person'], ['拨号键盘', 'dots']].map(([n, ic]) => h('button', { dataset: { n }, onclick: () => tab(n) },
      h('i', fill(ic, 26), n === '通话' && calls.some(r => miss(r[1])) ? h('sup', calls.filter(r => miss(r[1])).length) : null), h('span', n))));
    // 搜索：上面是通话和语音留言各几条，底下是 键盘 · 搜索条 · 关
    const find = () => { box.dataset.pane = 'find'; box.replaceChildren(head('通话', () => tab('通话')), h('div.pk-calls', calls.slice(0, 5).map(call)), ...(notes.length ? [head('语音留言', () => tab('通话')), h('div.pk-calls', notes.map(note))] : []));
      float.replaceChildren(h('button.pk-glass.is-round', { 'aria-label': '拨号键盘', onclick: () => tab('拨号键盘') }, fill('dots', 26)), h('div.pk-glass.pk-find', icon('search', 20, 2.4), h('span', '搜索'), icon('mic', 20, 2)),
        h('button.pk-glass.is-round', { 'aria-label': '关', onclick: () => tab('通话') }, icon('close', 22, 2.2))); };
    const findB = h('button.pk-glass.is-round', { 'aria-label': '搜索', onclick: find }, icon('search', 22, 2.6)), float = h('div.pk-float');
    tab('通话');
    return [box, float];
  },
  购物车: R => [...R.map(([name, price, n, shop, why]) => h('div.pk-card', h('small', shop), h('b', name), h('div.pk-card__foot', h('strong', '¥' + yuan(price)), h('span', '×' + (parseInt(n) || 1))), why && h('q', why))),
    h('div.pk-sum', '合计 ', h('strong', '¥' + R.reduce((a, r) => a + yuan(r[1]) * (parseInt(r[2]) || 1), 0).toFixed(2)))],
  饿了吗: R => R.map(([shop, what, price, t, note]) => h('div.pk-card', h('div.pk-card__head', h('b', shop), h('span', '已送达')), h('p', what), h('div.pk-card__foot', h('time', t), h('strong', '¥' + yuan(price))), note && h('q', '备注：' + note))),
  // 日历：上面一张天气，下面五天一排（能往前往后翻），点哪天看哪天的事
  日历: R => {
    const w = R.find(r => r[0] === '天气'), L = R.filter(r => r !== w), now = time.isStory() ? time.story().date : new Date();
    const key = s => { const m = /(?:(\d{4})[/.\-年])?(\d{1,2})[/.\-月](\d{1,2})/.exec(s || ''); return m ? `${+m[2]}-${+m[3]}` : s; }, kd = d => `${d.getMonth() + 1}-${d.getDate()}`;
    let start = 0, pick = kd(now);
    const strip = h('div.pk-days'), box = list();
    const paint = () => {
      strip.replaceChildren(h('button', { 'aria-label': '前五天', onclick: () => { start -= 5; paint(); } }, icon('back', 16, 2.4)), ...[0, 1, 2, 3, 4].map(i => { const d = new Date(now); d.setDate(d.getDate() + start + i); const k = kd(d);
        return h('button.pk-days__d' + (k === pick ? '.is-on' : '') + (L.some(r => key(r[0]) === k) ? '.has' : ''), { onclick: () => { pick = k; paint(); } }, h('small', '日一二三四五六'[d.getDay()]), h('b', d.getDate())); }),
        h('button', { 'aria-label': '后五天', onclick: () => { start += 5; paint(); } }, icon('chevron', 16, 2.4)));
      const day = L.filter(r => key(r[0]) === pick);
      box.replaceChildren(...(day.length ? day.map(([, t, what, where]) => h('div.pk-row.is-plan', h('time', t || '全天'), h('div', h('b', what), where && h('span', where)))) : [h('div.pk-row', h('span', '这天没有安排'))]));
    };
    paint();
    return [w ? h('div.pk-weather', h('div', h('b', `${parseInt(w[2]) || 0}°`), h('span', w[1])), h('small', `最高 ${parseInt(w[3]) || 0}° · 最低 ${parseInt(w[4]) || 0}°`)) : null, strip, box];
  },
  // 钱包：余额点眼睛能藏起来；花掉的按分类画一条彩色的条，下面是每类多少钱，再下面是交易
  钱包: R => {
    const bal = R.find(r => r[0] === '余额'), L = R.filter(r => r !== bal), out = L.filter(r => !/^\s*\+/.test(r[2])), total = out.reduce((a, r) => a + +yuan(r[2].replace(/[+-]/g, '')), 0);
    const cats = [...out.reduce((m, r) => m.set(r[3] || '其他', (m.get(r[3] || '其他') || 0) + +yuan(r[2].replace(/[+-]/g, ''))), new Map())].sort((a, b) => b[1] - a[1]);
    const COL = ['#ff9f0a', '#ff375f', '#30b0c7', '#5e5ce6', '#34c759', '#8e8e93'];
    const money = h('b', '¥' + yuan(bal ? bal[1] : 0)), eye = h('button', { 'aria-label': '隐藏余额', onclick: () => { const hide = eye.classList.toggle('is-off'); money.textContent = hide ? '¥ ****' : '¥' + yuan(bal ? bal[1] : 0); eye.replaceChildren(icon(hide ? 'eyeOff' : 'eye', 18, 2)); } }, icon('eye', 18, 2));
    return [h('div.pk-wallet', h('div', h('span', '余额'), eye), money),
      total ? [h('div.pk-day', '这段时间花了 ¥' + total.toFixed(2)), h('div.pk-card', h('div.pk-spend', cats.map(([, v], i) => h('i', { style: { flex: v, background: COL[i % COL.length] } }))),
        h('div.pk-spend__list', cats.map(([k, v], i) => h('div', h('i', { style: { background: COL[i % COL.length] } }), h('span', k), h('small', Math.round(v / total * 100) + '%'), h('b', '¥' + v.toFixed(2))))))] : null,
      h('div.pk-day', '最近的交易'),
      list(L.map(([t, what, v, cat]) => h('div.pk-row', h('div', h('b', what), h('span', [t, cat].filter(Boolean).join(' · '))), h('strong' + (/^\s*\+/.test(v) ? '.is-in' : ''), (/^\s*\+/.test(v) ? '+' : '-') + yuan(String(v).replace(/[+-]/g, ''))))))];
  },
};
