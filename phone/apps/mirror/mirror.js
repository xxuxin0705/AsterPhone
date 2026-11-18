// 映像：每个人一朵 5 片的玻璃花，5 片各管一类（资料、声音与语言、生图、立绘、世界书）。
// 碎片里清清楚楚映着这个人的图，光从花心来：靠花心亮、往外暗。
// 点一片：它亮起白边，整朵花挪到左边，右边一栏列出这一类的几项；点一项它按下去，上面出来能改的。
// 换图（右上角，或某一片的「图片」）都先进预览：拖动挪、两指捏放大缩小，点确定才换上。
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit, contact, chatForContact } from '../../core/store.js';
import { page, navBtn, input, textarea, segmented, btn, toast, pickImage, dateField, nudger, actionSheet, dialog, fxRow, withInfo, sheet, switchEl } from '../../core/ui.js';
import { worldNames } from '../../core/bridge.js';
import { wbOf, tavernBooks, loadBook } from '../../core/context.js';
import * as PT from '../../core/portrait.js';
import { LANGS, langName, langFor } from '../../core/translate.js';
import { nameOf } from '../chat/engine.js';
import { pickDeco, decoName } from '../../core/deco.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, a = {}) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
// 底图是一朵 5 片的玻璃花（842×1869），铺满 393×852 的画布；5 片的轮廓照着底图描，顺时针从上面那片起。l 是字放的地方（每片朝外、偏暗的那头）
const K = 393 / 842, OY = (852 - 1869 * K) / 2, map = ([x, y]) => [x * K, y * K + OY];
const SH = [
  { n: '资料', p: [[315, 348], [435, 430], [578, 582], [548, 700], [470, 808], [440, 893], [380, 850], [300, 760], [240, 585], [270, 500]], l: [262, 470] },
  { n: '声音与语言', p: [[497, 800], [842, 603], [842, 890], [640, 978], [605, 970], [560, 900]], l: [548, 818] },
  { n: '生图', p: [[505, 990], [640, 1040], [730, 1110], [830, 1255], [822, 1365], [705, 1408], [555, 1335], [462, 1205], [482, 1080]], l: [640, 1290] },
  { n: '立绘', p: [[395, 1022], [430, 1255], [375, 1338], [80, 1442], [68, 1420], [100, 1280], [160, 1160], [280, 1075]], l: [110, 1385] },
  { n: '世界书', p: [[0, 722], [160, 762], [300, 800], [380, 893], [362, 975], [255, 1012], [90, 1067], [0, 1032]], l: [40, 800] },
].map(s => ({ ...s, p: s.p.map(map), l: map(s.l) }));
const isZh = l => !l || /^zh/.test(l);
const BG = 'assets/mirror/night.webp';
const LT = map([430, 950]);   // 光：5 片中间那团亮光
const JIT = [[0, -4], [6, 3], [-5, 6], [4, -5], [-6, 2]];   // 每片映着的图各错一点，看得出是 5 面镜子
const mid = p => p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);

// 一片：图是清楚的；靠光那头亮、往外暗，朝光的边最亮（跟着光走，不是随便涂）
function shard(s, i, onTap) {
  const P = s.p.map(q => q.join(',')).join(' '), c = mid(s.p), u = 'mz' + i, [lx, ly] = LT;
  const rad = (id, r, o) => { const g = svg('radialGradient', { id: id + u, gradientUnits: 'userSpaceOnUse', cx: lx, cy: ly, r }); o.forEach(([off, col, op = 1]) => g.append(svg('stop', { offset: off, 'stop-color': col, 'stop-opacity': op }))); return g; };
  const blur = (id, d) => { const f = svg('filter', { id: id + u, x: '-30%', y: '-30%', width: '160%', height: '160%' }); f.append(svg('feGaussianBlur', { stdDeviation: d })); return f; };
  const clip = svg('clipPath', { id: 'c' + u }); clip.append(svg('polygon', { points: P }));
  const defs = svg('defs'); defs.append(clip, blur('b', 3), blur('d', 8),
    rad('m', 260, [[.12, '#fff'], [.45, '#cfc8ec'], [1, '#4a4278']]), rad('g', 150, [[0, '#fff0ff', .75], [.5, '#c8b4ff', .25], [1, '#c8b4ff', 0]]), rad('e', 240, [[.17, '#fffaff', .9], [1, '#fff', .08]]));
  const img = svg('image', { preserveAspectRatio: 'xMidYMid slice' });
  const place = (src, x, y, w, hh) => { body.style.display = src ? '' : 'none'; if (src) img.setAttribute('href', src); else img.removeAttribute('href'); Object.entries({ x, y, width: w, height: hh }).forEach(([k, v]) => img.setAttribute(k, v)); };
  const full = { width: 393, height: 852 }, body = svg('g', { 'clip-path': `url(#c${u})`, style: 'isolation:isolate' });
  body.append(svg('rect', { ...full, fill: '#15132a' }), img, svg('rect', { ...full, fill: `url(#m${u})`, style: 'mix-blend-mode:multiply' }),
    svg('rect', { ...full, fill: `url(#g${u})`, style: 'mix-blend-mode:screen' }), svg('polygon', { points: P, fill: 'none', stroke: `url(#e${u})`, 'stroke-width': 7, filter: `url(#b${u})` }));
  const el = svg('svg', { viewBox: '0 0 393 852', class: 'mz-shard' });
  el.append(defs, svg('polygon', { points: P, fill: '#000', opacity: .6, transform: 'translate(0 6)', filter: `url(#d${u})` }),
    svg('polygon', { points: P, class: 'mz-glow', fill: 'none', stroke: '#e8e2ff', 'stroke-width': 5, filter: `url(#b${u})` }),
    Object.assign(svg('image', { href: BG, x: 0, y: OY, width: 393, height: 1869 * K, 'clip-path': `url(#c${u})`, preserveAspectRatio: 'none' })), body,
    svg('polygon', { points: P, class: 'mz-rim', fill: 'none', stroke: '#fff', 'stroke-opacity': .85, 'stroke-width': 1, 'stroke-linejoin': 'round' }),
    Object.assign(svg('polygon', { points: P, fill: 'transparent' }), { onclick: e => { e.stopPropagation(); onTap(i); } }));
  const d = Math.hypot(c[0] - lx, c[1] - ly) || 1;   // 第一次打开时从哪个方向飞进来
  el.style.cssText = `--i:${i};--ix:${(c[0] - lx) / d * 70}px;--iy:${(c[1] - ly) / d * 70}px;--ox:${(Math.min(...s.p.map(q => q[0])) + Math.max(...s.p.map(q => q[0]))) / 7.86}%;--oy:${(Math.min(...s.p.map(q => q[1])) + Math.max(...s.p.map(q => q[1]))) / 17.04}%`;
  const xs = s.p.map(q => q[0]), ys = s.p.map(q => q[1]);
  const look = (op, br) => { body.style.opacity = op; img.style.filter = br === 1 ? '' : `brightness(${br})`; };   // 透明度连暗底一起淡，露出底图的玻璃
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  return { el, c, bw, bh, bc: [Math.min(...xs) + bw / 2, Math.min(...ys) + bh / 2], size: Math.max(bw, bh), place, look };
}

/* 每一类有哪几项：value 是卡片上显示的，edit 是按下去后上面出来的（改了就存，只换这张卡片上的字）。
   x：{ pic 重摆碎片的图, roster 重画头像排, reopen 重开这一类, pre 进预览 } */
const NICK_APPS = [['chat', '聊天'], ['forum', '论坛'], ['music', '音乐']], APPN = { chat: '聊天', forum: '论坛' };
const BOOK_APPS = [['', '所有应用'], ['chat', '聊天'], ['forum', '论坛'], ['diary', '日记'], ['radio', '电台'], ['interlude', '幕间']];
let bookApp = '';
const draftOf = c => { const M = JSON.parse(JSON.stringify(c.mirror || {})); M.shards ||= {}; return M; };
const thumb = src => h('img.mz-thumb', { src, alt: '' });
const pickPic = async size => { const f = await pickFile('image/*'); return f && fileToDataURL(f, size); };
function rowsOf(i, c, x) {
  const ch = () => chatForContact(c.id, true).cfg, save = k => { commit('contacts'); if (k) x[k](); };
  const text = (k, ph) => ({ value: () => c[k] || '', edit: set => input({ value: c[k] || '', placeholder: ph, onInput: v => { c[k] = v; save(); set(); } }) });
  const choose = (opts, cur, on) => h('div.mz-chips', opts.map(([v, l]) => { const b = h('button' + (cur === v ? '.is-on' : ''), { onclick: async () => {
    if (await on(v) === false) return; b.parentNode.querySelectorAll('button').forEach(y => y.classList.toggle('is-on', y === b)); } }, l); return b; }));
  if (i === 0) return [
    ['头像', { value: () => (c.avatar ? '换一张' : '没有'), edit: set => btn('换头像', 'secondary', async () => { const v = await pickImage('头像', { has: !!c.avatar }); if (v == null) return; c.avatar = v; save('pic'); x.roster(); set(); }) }],
    ['头像框', { value: () => (decoName('frames', c.frame) || '不戴') + (Object.keys(c.appFrame || {}).length ? ' · ' + Object.keys(c.appFrame).map(k => APPN[k]).join('、') + '单独选过' : ''),
      go: async () => { const v = await pickDeco('frames', c.frame, { src: c.avatar, name: nameOf(c) }); if (v == null) return; if (v === 'none') delete c.frame; else c.frame = v; save(); x.reopen(); } }],
    ['真名', text('name', '真名')],
    // 网名：默认一个；聊天、论坛、音乐能各起各的，空着就用默认。论坛那格就是论坛里「熟人的网名」
    ['网名', { value: () => c.nick || '没起', edit: set => {
      const fp = () => (state.forum.people[c.id] ||= {}), get = k => (k === 'forum' ? (state.forum.people[c.id] || {}).name : c.appNick?.[k]) || '';
      const put = (k, v) => { if (k === 'forum') { fp().name = v; commit('forum'); } else { if (v) (c.appNick ||= {})[k] = v; else if (c.appNick) delete c.appNick[k]; save(); } };
      return h('div.mz-col', input({ value: c.nick || '', placeholder: '默认网名', onInput: v => { c.nick = v; save(); set(); } }),
        isZh(langFor('chat', ch().speak)) ? '' : h('label.mz-nick', h('small', '中文'), input({ value: c.nickZh || '', placeholder: '中文网名', onInput: v => { if (v.trim()) c.nickZh = v.trim(); else delete c.nickZh; save(); } })),
        ...NICK_APPS.map(([k, l]) => h('label.mz-nick', h('small', l), input({ value: get(k), placeholder: '跟默认一样', onInput: v => put(k, v.trim()) })))); } }],
    ['备注', text('remark', '备注')],
    ['性别', { value: () => c.gender || '不写', edit: set => segmented([['', '不写'], ['男', '男'], ['女', '女'], ['其他', '其他']], c.gender || '', v => { c.gender = v; save(); set(); }) }],
    ['生日', { value: () => c.birthday || '没填', edit: set => dateField(c.birthday || '', v => { c.birthday = v; save(); set(); }, true) }],
    ['人设', { value: () => (c.persona ? c.persona.slice(0, 12) + '…' : c.charKey ? '用角色卡的' : '没写'), edit: set => textarea({ value: c.persona || '', rows: 8, placeholder: c.charKey ? '留空就用角色卡里的人设' : '人设', onInput: v => { c.persona = v; save(); set(); } }) }],
  ];
  if (i === 1) return [
    ['说的语言', { info: '选了哪种，TA 在聊天、论坛、电台、幕间这些地方都说这种语言。选「跟着总的」就照设置里的语言走。', value: () => (ch().speak ? '' : '跟着总的 · ') + langName(langFor('chat', ch().speak)), edit: set => choose([['', '跟着总的'], ...LANGS], ch().speak || '', v => { const was = isZh(langFor('chat', ch().speak)); ch().speak = v; commit('chats'); set(); if (was !== isZh(langFor('chat', v))) x.reopen(); }) }],
    // 勾上的 App 网名用 TA 说的语言（默认网名），没勾的用中文网名；AI 智能加载时也按这个起
    ...isZh(langFor('chat', ch().speak)) ? [] : [['网名跟着语言', { value: () => NICK_APPS.filter(([k]) => !(c.zhNick || []).includes(k)).map(a => a[1]).join('、') || '都不跟', edit: set => h('div.mz-chips', NICK_APPS.map(([k, l]) => h('button' + ((c.zhNick || []).includes(k) ? '' : '.is-on'), { onclick: e => {
      const z = c.zhNick || []; c.zhNick = z.includes(k) ? z.filter(y => y !== k) : [...z, k]; if (!c.zhNick.length) delete c.zhNick; e.currentTarget.classList.toggle('is-on'); save(); set(); } }, l))) }]],
    ['声音', { value: () => '渠道、音色、读音', go: () => import('../settings/voices.js').then(m => m.openPerson(c.id)) }],
  ];
  // 生图：画到 TA 的时候（聊天发的照片、日记配图）前面加上外貌；定妆图拿来锁脸（能照图画的渠道才认），锁脸强度、种子每个人各一个
  const pre = () => (state.settings.lookPresets ||= []);
  if (i === 2) return [
    ['外貌', { value: () => c.look || '没写', edit: set => {
      const ta = textarea({ value: c.look || '', rows: 6, placeholder: '外貌提示词', onInput: v => { c.look = v.trim(); save(); set(); paint(); } }), chips = h('div.mz-chips');
      const paint = () => chips.replaceChildren(...pre().map((x, k) => h('button.mz-preset' + (x.t === c.look ? '.is-on' : ''), { onclick: () => { c.look = x.t; ta.value = x.t; save(); set(); paint(); } }, x.n,
        h('i', { 'aria-label': '删除预设', onclick: async e => { e.stopPropagation(); if (await dialog({ title: `删除预设「${x.n}」？`, confirm: '删除', danger: true })) { pre().splice(k, 1); commit('settings'); paint(); } } }, '×'))),
        h('button', { onclick: async () => { const n = (await dialog({ title: '存为预设', input: { placeholder: '名字' } }) || '').trim(); if (!n || !c.look) return; pre().push({ n, t: c.look }); commit('settings'); paint(); } }, '+ 存为预设'));
      paint(); return h('div.mz-col', ta, chips); } }],
    ['定妆图', { value: () => (c.lookRef ? '有' : '不用'), edit: set => {
      const vers = PT.versions(c.id).filter(v => v.base);
      return h('div.mz-col', c.lookRef ? thumb(c.lookRef) : '',
        vers.length ? h('div.mz-strip', vers.map(v => h('button' + (v.base === c.lookRef ? '.is-on' : ''), { onclick: () => { c.lookRef = v.base; save(); set(); x.reopen(); } }, thumb(v.base)))) : '',
        choose([['pick', '自己传'], ['avatar', '用头像'], ['', '不用']], '', async v => {
          if (v === 'avatar') { if (!c.avatar) { toast('还没有头像'); return false; } c.lookRef = c.avatar; }
          else if (v === 'pick') { const p = await pickPic(1024); if (!p) return false; c.lookRef = p; } else delete c.lookRef;
          save(); set(); x.reopen(); })); } }],
    ['锁脸强度', { info: '越高越像定妆图，太高姿势和场景会被带跑。只有 NAI 认。', value: () => Math.round((c.lookK ?? 1) * 100) + '%', edit: set => fxRow('', c.lookK ?? 1, 1, { min: .1, max: 1, step: .05, fmt: v => Math.round(v * 100) + '%' }, v => { if (v === 1) delete c.lookK; else c.lookK = v; save(); set(); }) }],
    // 种子：同一个种子 + 同样的外貌，画出来的脸更像同一个人。NAI / SD / ComfyUI / 硅基流动认，OpenAI 这类没有种子
    ['种子', { value: () => (c.seed === undefined ? '每次随机' : String(c.seed)), edit: set => {
      const box = input({ type: 'number', value: c.seed ?? '', placeholder: '留空每次随机', onInput: v => { if (v === '') delete c.seed; else c.seed = Math.max(0, Math.floor(+v) || 0); save(); set(); } });
      return h('div.mz-col', box, h('div.mz-chips', h('button', { onclick: () => { c.seed = Math.floor(Math.random() * 4294967295); box.value = c.seed; save(); set(); } }, '随机'),
        h('button', { onclick: () => { delete c.seed; box.value = ''; save(); set(); } }, '每次随机'))); } }],
  ];
  // 立绘：照相馆里做的；主图（碎片里映着的那张）可以用头像、立绘或者另传一张
  if (i === 3) return [
    ['立绘', { value: () => (PT.loaded(c.id) ? `${PT.versions(c.id).length} 张` : '还没有'), edit: () => h('div.mz-col',
      PT.versions(c.id).length ? h('div.mz-strip', PT.versions(c.id).map((v, k) => h('button' + (k === PT.using(c.id) ? '.is-on' : ''), { onclick: e => PT.useVersion(c.id, k).then(() => e.currentTarget.parentNode.querySelectorAll('button').forEach((b, j) => b.classList.toggle('is-on', j === k))) }, thumb(v.base)))) : '',
      btn('去照相馆', 'secondary', () => import('../street/studio.js').then(m => m.person(c.id)))) }],
  ];
  return [];
}

/* 世界书：TA 自己的一套。上面选管哪里（所有应用 / 某个 App；单独设过的 App 带个点）；
   每本书能整本开关、展开看条目，每条能开关、能改（只改手机里的，酒馆的书不动）；「添加」从所有书里搜着挑 */
const openBooks = new Set();
function bookPanel(c, redo) {
  const W = wbOf(c) || {}, own = bookApp ? W.apps && W.apps[bookApp] : W.all, save = () => commit('contacts');
  const ensure = () => { const w = c.wb ||= {}; if (!bookApp) return w.all ||= { tavern: true, books: {} }; return (w.apps ||= {})[bookApp] ||= JSON.parse(JSON.stringify(w.all || { tavern: true, books: {} })); };
  const scopes = h('div.mz-chips', BOOK_APPS.map(([v, l]) => h('button' + (v === bookApp ? '.is-on' : '') + (v && W.apps && W.apps[v] ? '.is-own' : ''), { onclick: () => { bookApp = v; redo(); } }, l)));
  const top = h('div.mz-card', h('small', '用在哪'), scopes);
  if (bookApp && !own) return h('div.mz-cards', top, h('div.mz-card', h('span.mz-line', '跟着「所有应用」'), h('div.mz-chips', h('button', { onclick: () => { ensure(); save(); redo(); } }, '单独设一套'))));
  const S = own || { tavern: true, books: {} }, open = tavernBooks();
  const names = [...new Set([...(S.tavern ? open : []), ...Object.keys(S.books)])];
  const book = n => {
    const b = () => S.books[n] || {}, cnt = h('small'), body = h('div.mz-book__body');
    const count = list => { cnt.textContent = b().off ? '不用' : `${list.filter(e => !(b().e?.[e.uid]?.off ?? e.disable)).length}/${list.length}`; };
    const sw = switchEl(!b().off, v => { const x = ensure().books[n] ||= {}; if (v) delete x.off; else x.off = true; save(); loadBook(n).then(count, () => {}); });
    const fill = async () => {
      let list; try { list = await loadBook(n); } catch (e) { body.replaceChildren(h('span.mz-line', '读不到这本书')); return; }
      count(list);
      body.replaceChildren(...list.map(e => {
        const o = () => b().e?.[e.uid] || {}, t = h('span', e.title + (o().text != null ? ' · 改过' : ''));
        return h('div.mz-entry', t, h('button.mz-entry__edit', { onclick: () => editEntry(n, e, o(), v => { const x = ((ensure().books[n] ||= {}).e ||= {})[e.uid] ||= {}; if (v == null) delete x.text; else x.text = v; save(); t.textContent = e.title + (v != null ? ' · 改过' : ''); }) }, '编辑'),
          switchEl(!(o().off ?? e.disable), v => { ((ensure().books[n] ||= {}).e ||= {})[e.uid] = { ...o(), off: !v }; save(); count(list); }, e.title));
      }), S.books[n] && !open.includes(n) ? h('div.mz-chips', h('button', { onclick: () => { delete ensure().books[n]; save(); redo(); } }, '移除这本')) : '');
    };
    const el = h('div.mz-card.mz-book' + (openBooks.has(n) ? '.is-open' : ''), h('div.mz-book__head', h('button.mz-book__name', { onclick: () => { el.classList.toggle('is-open', openBooks.has(n) ? !openBooks.delete(n) : !!openBooks.add(n)); if (openBooks.has(n)) fill(); } },
      h('span', n), open.includes(n) ? h('em', '酒馆开着') : '', cnt), sw), body);
    if (openBooks.has(n)) fill(); else loadBook(n).then(count, () => { cnt.textContent = '读不到'; });
    return el;
  };
  return h('div.mz-cards', top,
    h('div.mz-card.mz-book', h('div.mz-book__head', h('span.mz-line', '带上酒馆开着的书'), switchEl(S.tavern, v => { ensure().tavern = v; save(); redo(); }))),
    ...names.map(book),
    h('div.mz-chips', h('button', { onclick: async () => { const pick = await pickBooks(names); if (!pick.length) return; const set = ensure(); pick.forEach(n => { set.books[n] ||= {}; }); save(); redo(); } }, '添加世界书'),
      bookApp ? h('button', { onclick: () => { delete c.wb.apps[bookApp]; save(); redo(); } }, '改回跟着所有应用') : ''));
}
// 从所有世界书里搜着挑几本
function pickBooks(have) {
  return new Promise(res => {
    const sel = new Set(), all = worldNames().filter(n => !have.includes(n)), list = h('div.mz-pick');
    const paint = q => list.replaceChildren(...all.filter(n => !q || n.toLowerCase().includes(q.toLowerCase())).map(n => h('button' + (sel.has(n) ? '.is-on' : ''), { onclick: e => { sel.has(n) ? sel.delete(n) : sel.add(n); e.currentTarget.classList.toggle('is-on'); } }, n)));
    paint('');
    let done = false;
    const s = sheet({ title: '添加世界书', onClose: () => { if (!done) res([]); }, content: h('div.as-stack-gap', input({ placeholder: '搜书名', onInput: paint }), all.length ? list : h('span.as-muted', '没有读到别的世界书'),
      h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('添加', 'primary', () => { done = true; s.close(); res([...sel]); }))) });
  });
}
// 改一条：只存在手机里；「恢复原样」就用回酒馆里的内容
function editEntry(book, e, o, onSave) {
  const ta = textarea({ value: o.text ?? e.content, rows: 10 });
  const s = sheet({ title: e.title, content: h('div.as-stack-gap', ta, btn('恢复原样', 'secondary', () => { onSave(null); s.close(); }),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => { onSave(ta.value === e.content ? null : ta.value); s.close(); }))) });
}

export function open() {
  const people = () => state.contacts.filter(c => !c.noMirror);   // 聊天里的人都在；映像里删掉的不列
  let cur = people()[0], focus = -1, draft = null;   // draft：预览中的图 { M, sel 选中哪片（-1 是整张）, swap 等着跟哪片互换 }
  const p = page({ app: 'mirror', id: 'mirror-home', title: '', back: true, cls: 'as-mz' });
  const stage = h('div.mz-stage'), tilt = h('div.mz-tilt'), side = h('aside.mz-side'), dock = h('div.mz-dock'), roster = h('div.mz-roster');
  const real = h('small'), head = h('div.mz-head', h('b', '映像'), real);
  p.nav.querySelector('.as-navbar__title').replaceWith(head);
  p.nav.querySelector('.as-navbar__right').append(navBtn('image', '换图', () => (cur ? picMenu() : addMenu())), roster);
  stage.append(h('img.mz-bg', { src: BG, alt: '', draggable: false, style: { top: OY / 8.52 + '%', height: 1869 * K / 8.52 + '%' } }));
  const tags = [], parts = SH.map((s, i) => {
    const sh = shard(s, i, tap); tilt.append(sh.el);
    const t = h('div.mz-tag', { style: { left: s.l[0] / 3.93 + '%', top: s.l[1] / 8.52 + '%' }, onclick: e => { e.stopPropagation(); tap(i); } }, h('em', i + 1), h('b', s.n));
    tags.push(t); tilt.append(t); return sh;
  });
  // 碎片挪走后空出来那块：用底图糊开、压暗一点盖上，像那里本来就只有星云，不留一块亮玻璃也不抠出黑洞
  const holes = svg('svg', { viewBox: '0 0 393 852', class: 'mz-holes' }), hd = svg('defs'), he = svg('filter', { id: 'mzhe', x: '-20%', y: '-20%', width: '140%', height: '140%' });
  he.append(svg('feGaussianBlur', { stdDeviation: 6 })); hd.append(he);
  holes.append(hd, ...SH.map((sh, k) => { const m = svg('mask', { id: 'mzhm' + k }); m.append(svg('polygon', { points: sh.p.map(q => q.join(',')).join(' '), fill: '#fff', filter: 'url(#mzhe)', transform: `translate(${mid(sh.p)[0] * -.22} ${mid(sh.p)[1] * -.22}) scale(1.22)` }));
    const g = svg('g', { mask: `url(#mzhm${k})` }); g.append(m, svg('image', { href: 'assets/mirror/stars.webp', x: 0, y: OY, width: 393, height: 1869 * K, preserveAspectRatio: 'none' })); return g; }));
  stage.append(holes, tilt);   // 底图在 tilt 外面：点、拖、预览都不动它；碎片挪走后空出来的那块由 holes 露出同构图的纯星空
  p.el.prepend(h('i.mz-meteor'), h('i.mz-meteor.is-b'));
  // 每片的图：单独换过的照这片的大小摆；没换的用整张（没设就用头像）铺满画布，各错一点。x y 是挪了多少，k 是放大（旧存档里 fx fy 那套不认）
  const kOf = o => ('fx' in o ? 1 : o.k || 1);
  const posOf = i => { const M = draft?.M || cur?.mirror || {}, o = (M.shards || {})[i] || {}, a = M.pos || {}, sh = parts[i];
    if (o.src) { const S = sh.size * 1.15 * kOf(o); return [o.src, sh.c[0] + (o.x || 0) - S / 2, sh.c[1] + (o.y || 0) - S / 2, S, S]; }
    const k = kOf(a) * kOf(o), W = 393 * k, H = 852 * k;
    return [M.main || cur?.avatar || '', (393 - W) / 2 + (a.x || 0) + (o.x || 0) + JIT[i][0], (852 - H) / 2 + (a.y || 0) + (o.y || 0) + JIT[i][1], W, H]; };
  const fxOf = i => ((draft?.M || cur?.mirror || {}).shards || {})[i] || {};
  const pics = () => parts.forEach((sh, i) => { sh.place(...posOf(i)); const o = fxOf(i); sh.look(o.op ?? 1, o.br ?? 1); });
  // 换上新图前先解码好，碎片里不会空一下
  const fresh = () => Promise.all([...new Set(parts.map((_, i) => posOf(i)[0]))].filter(Boolean).map(u => { const im = new Image(); im.src = u; return im.decode().catch(() => {}); })).then(pics);
  const mark = () => parts.forEach((sh, k) => sh.el.classList.toggle('is-on', k === (draft ? draft.sel : focus)));
  // 手指：预览里拖是挪图、两指捏是放大缩小；平时拖一拖，整朵花跟着斜一点
  const pts = new Map(); let grab = null, moved = false;
  const target = () => (draft.sel >= 0 ? (draft.M.shards[draft.sel] ||= {}) : (draft.M.pos ||= {}));
  stage.addEventListener('pointerdown', e => {
    moved = false; if (focus >= 0) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const t = draft && target(), at0 = [...pts.values()].map(q => [...q]);
    grab = draft ? { x: t.x || 0, y: t.y || 0, k: kOf(t), at: at0 } : { at: at0 };
  });
  stage.addEventListener('pointermove', e => {
    if (!grab || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const now = [...pts.values()], dx = now[0][0] - grab.at[0][0], dy = now[0][1] - grab.at[0][1];
    if (!moved && Math.hypot(dx, dy) < 6 && now.length < 2) return;
    if (!moved) e.target.setPointerCapture?.(e.pointerId);
    moved = true;
    if (!draft) { const c = v => Math.max(-9, Math.min(9, v / 16)); tilt.style.transform = `rotateY(${c(dx)}deg) rotateX(${c(-dy)}deg)`; return; }
    const t = target(), u = 393 / stage.getBoundingClientRect().width;
    if (now.length > 1 && grab.at.length > 1) { const d = q => Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]) || 1; t.k = Math.max(.3, Math.min(6, grab.k * d(now) / d(grab.at))); delete t.fx; }
    else { t.x = grab.x + dx * u; t.y = grab.y + dy * u; }
    pics();
  });
  const drop = e => { pts.delete(e.pointerId); if (!grab) return; if (pts.size && draft) { const t = target(); grab = { x: t.x || 0, y: t.y || 0, k: kOf(t), at: [...pts.values()].map(q => [...q]) }; } else if (!pts.size) { grab = null; tilt.style.transform = ''; } };
  stage.addEventListener('pointerup', drop); stage.addEventListener('pointercancel', drop);
  side.addEventListener('click', e => { if (e.target === side || e.target.classList.contains('mz-cards')) at(-1); });   // 点右边一栏的空处也收起
  stage.onclick = () => { if (moved) return; if (draft) { draft.sel = -1; draft.swap = -1; mark(); preSide(); } else at(-1); };
  function tap(i) {
    if (moved) return;
    if (!draft) return cur ? at(i) : addMenu();
    const S = draft.M.shards;
    if (draft.swap >= 0 && draft.swap !== i) { const a = S[draft.swap], b = S[i]; if (b) S[draft.swap] = b; else delete S[draft.swap]; if (a) S[i] = a; else delete S[i]; draft.swap = -1; pics(); }
    else draft.sel = draft.sel === i ? -1 : i;
    mark(); preSide();
  }
  // 预览：图先换在这里看，挪好、缩放好，点确定才存；取消就当没换过
  function pre(M, sel = -1, pool = null) {   // pool：「每片一张」选的那几张，点一片再点下面的图就换上
    const back = focus; at(-1); draft = { M, sel, swap: -1, back, pool };
    p.el.classList.add('is-pre');
    fresh(); mark(); preSide();
  }
  function preSide() {
    const step = (dx, dy, dk) => { const t = target(); if (dk) { t.k = Math.max(.3, Math.min(6, kOf(t) * dk)); delete t.fx; } else { t.x = (t.x || 0) + dx * 2; t.y = (t.y || 0) + dy * 2; } pics(); };
    const reset = () => { const t = target(); delete t.x; delete t.y; delete t.k; delete t.fx; delete t.fy; pics(); };
    const end = ok => { const back = draft.back; if (ok) { cur.mirror = draft.M; commit('contacts'); } draft = null; p.el.classList.remove('is-pre'); dock.replaceChildren(); pics(); mark(); if (back >= 0) at(back); };
    const sel = draft.sel, mine = sel >= 0 && draft.M.shards[sel]?.src;
    const pool = sel >= 0 && draft.pool ? h('div.mz-pool', draft.pool.map(u => h('button' + (draft.M.shards[sel]?.src === u ? '.is-on' : ''), { onclick: () => { const t = draft.M.shards[sel] || {}; draft.M.shards[sel] = { src: u, op: t.op, br: t.br }; fresh(); preSide(); } }, h('img', { src: u, alt: '' })))) : '';
    const fx = sel >= 0 ? h('div.mz-dock__fx', ...[['透明度', 'op', .1, 1], ['亮度', 'br', .3, 1.6]].map(([l, k, min, max]) => fxRow(l, draft.M.shards[sel]?.[k] ?? 1, 1, { min, max, step: .05, fmt: v => Math.round(v * 100) + '%' },
        v => { const t = target(); if (v === 1) delete t[k]; else t[k] = v; parts[sel].look(t.op ?? 1, t.br ?? 1); }))) : '';
    dock.classList.toggle('is-top', sel === 2 || sel === 3);   // 选的是下面两片：调整栏挪到上面，别挡住它
    dock.replaceChildren(h('div.mz-dock__row', h('h3', sel >= 0 ? [h('em', sel + 1), SH[sel].n] : '整张'), nudger(step, reset),
        h('div.mz-zoom', ...[['放大', 1.04], ['缩小', 1 / 1.04]].map(([l, k]) => h('button', { type: 'button', onclick: () => step(0, 0, k) }, l)))),
      pool, fx, h('div.mz-dock__row', h('div.mz-chips', h('button', { onclick: reset }, '重置'), mine ? h('button', { onclick: () => { delete draft.M.shards[sel]; pics(); preSide(); } }, '用回整张') : '', mine ? h('button' + (draft.swap === sel ? '.is-on' : ''), { onclick: () => { draft.swap = draft.swap === sel ? -1 : sel; preSide(); } }, draft.swap === sel ? '点另一片' : '互换') : ''),
        h('div.mz-bar', h('button', { onclick: () => end(false) }, '取消'), h('button.is-main', { onclick: () => end(true) }, '确定'))));
  }
  // 右上角换图：一张拆开（5 片都映着它）/ 每片一张（按选的顺序放进 1～5 片，没选到的保持原样）/ 用立绘 / 用头像 / 调位置
  async function picMenu() {
    const v = await actionSheet('换图', [['one', '一张拆开'], ['many', '每片一张'], ['pt', '用立绘'], ['avatar', '用头像'], ['adj', '调位置']].map(([value, label]) => ({ value, label })));
    if (!v) return;
    const D = draftOf(cur); let pool = null;
    if (v === 'one') { const s = await pickPic(1280); if (!s) return; D.main = s; delete D.pos; D.shards = {}; }
    else if (v === 'many') { const fs = await pickFile('image/*', true); if (!fs.length) return; if (fs.length > 5) toast('只用前 5 张');
      pool = []; for (const [k, f] of fs.slice(0, 5).entries()) { const src = await fileToDataURL(f, 1080); D.shards[k] = { src }; pool.push(src); } }
    else if (v === 'pt') { const t = PT.loaded(cur.id); if (!t) return toast('还没有立绘，先去照相馆'); D.main = t.base; }
    else if (v === 'avatar') D.main = '';
    pre(D, -1, pool);
  }
  // 换人：只换图、真名和头像排里亮的那个，碎片不重画
  function show(c) {
    if (draft) { draft = null; p.el.classList.remove('is-pre'); }
    cur = c; at(-1);
    fresh(); show2();
    roster.querySelectorAll('button[data-id]').forEach(b => b.classList.toggle('is-on', b.dataset.id === c.id));
    roster.querySelector('.is-on')?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }
  // 头像排：一次露 4 个，多了左右滑；超过 4 个最后有个「更多」，点开是全部名单
  const paintRoster = () => roster.replaceChildren(h('button.mz-add', { 'aria-label': '添加人物', onclick: addMenu }, '+'), ...people().map(c => h('button' + (c === cur ? '.is-on' : ''), { dataset: { id: c.id }, 'aria-label': nameOf(c), onclick: () => show(c) },
    c.avatar ? h('img', { src: c.avatar, alt: '' }) : h('span', nameOf(c).slice(0, 1)))),
    people().length > 4 ? h('button.mz-more', { 'aria-label': '全部', onclick: async () => { const id = await actionSheet('换人', people().map(c => ({ value: c.id, label: nameOf(c), active: c === cur }))); const c = id && people().find(x => x.id === id); if (c) show(c); } }, '···') : '');
  // 点一片：它浮上来，整朵花挪到左边，右边一栏是这一类的几项
  function at(i) {
    if (i === focus) return;
    focus = i;
    p.el.classList.toggle('is-focus', i >= 0);
    mark();
    tags.forEach((t, k) => t.classList.toggle('is-on', k === i));
    parts.forEach((sh, k) => { sh.el.style.translate = k === i ? `${(104 - sh.bc[0]) / 3.93}% ${(430 - sh.bc[1]) / 8.52}%` : ''; sh.el.style.setProperty('--fk', k === i ? Math.min(1.7, 180 / sh.bw, 370 / sh.bh) : 1); holes.children[k + 1].classList.toggle('is-on', k === i); });   // 挪到左边空处正中，放大到刚好
    if (i < 0) { side.replaceChildren(); return; }
    if (i === 4) { const redo = () => side.lastChild.replaceWith(bookPanel(cur, redo)); side.replaceChildren(h('h3', h('em', i + 1), SH[i].n), picOf(i), bookPanel(cur, redo)); return; }
    const rows = rowsOf(i, cur, { pic: pics, roster: paintRoster, reopen: () => { const k = [...side.querySelectorAll('.mz-card')].findIndex(b => b.classList.contains('is-open')); focus = -1; at(i); side.querySelectorAll('.mz-card__head')[k]?.click(); } });
    // 点哪一格就在这一格里改；go 是点了直接跳走的（比如声音）
    const cards = rows.map(([label, r]) => {
      const v = h('span', r.value()), body = h('div.mz-card__body'), card = h('div.mz-card', h('button.mz-card__head', { onclick: () => {
        if (r.go) return r.go();
        const open = !card.classList.contains('is-open');
        cards.forEach(x => { x.classList.remove('is-open'); x.lastChild.replaceChildren(); });
        if (open) { card.classList.add('is-open'); body.append(r.edit(() => { v.textContent = r.value(); if (label !== '人设') show2(); })); }
      } }, h('small', r.info ? withInfo(label, r.info) : label), v), body);
      return card;
    });
    const pic = picOf(i);
    side.replaceChildren(h('h3', h('em', i + 1), SH[i].n), pic, h('div.mz-cards', cards), i === 0 ? h('div.mz-chips.mz-drop', h('button', { onclick: delPerson }, '删除')) : '');
  }
  const picOf = i => h('div.mz-pic', h('small', '图片'), h('div.mz-chips', h('button', { onclick: () => pre(draftOf(cur), i) }, '调整位置'),
    h('button', { onclick: async () => { const v = await pickPic(1080); if (!v) return; const D = draftOf(cur); D.shards[i] = { src: v }; pre(D, i); } }, '换张图片')));
  const show2 = () => { real.textContent = cur ? cur.name || nameOf(cur) : ''; };
  // 添加：新建一个只在映像里的人（加不加进聊天以后在联系人里选）；或者把在映像里删掉过的联系人找回来
  async function addMenu() {
    const gone = state.contacts.filter(c => c.noMirror);
    const v = gone.length ? await actionSheet('添加人物', [{ value: 'new', label: '新建', icon: 'plus' }, { value: 'pick', label: '从联系人里选', icon: 'users' }]) : 'new';
    if (v === 'pick') { const id = await actionSheet('从联系人里选', gone.map(c => ({ value: c.id, label: nameOf(c) }))); const c = id && contact(id); if (!c) return; delete c.noMirror; commit('contacts'); paintRoster(); show(c); return; }
    if (v !== 'new') return;
    const n = (await dialog({ title: '新建人物', input: { placeholder: '名字' } }) || '').trim(); if (!n) return;
    const c = { ...(await import('../chat/people.js')).blankContact(), name: n, source: 'mirror', friend: false };
    state.contacts.push(c); commit('contacts'); paintRoster(); show(c); at(0);
  }
  // 删除：只从映像里拿掉。聊天里有 TA 就还在聊天里；只在映像里的人就整个删掉
  async function delPerson() {
    const c = cur, inChat = c.friend !== false;
    if (!(await dialog({ title: `从映像里删掉「${nameOf(c)}」？`, text: inChat ? '聊天里还在。' : '这个人的资料会一起删掉。', confirm: '删除', danger: true }))) return;
    if (inChat) c.noMirror = true; else state.contacts.splice(state.contacts.indexOf(c), 1);
    commit('contacts'); cur = people()[0]; paintRoster(); if (cur) show(cur); else { at(-1); show2(); pics(); }
  }
  p.el.prepend(stage);   // 花铺满整页（连顶上那条也算），不放在正文里，免得被裁掉一截
  p.body.append(side, dock);
  // 第一次打开：5 片从四周飞进来拼成花，只放这一次
  try { if (!localStorage.getItem('as-mz-intro')) { stage.classList.add('is-intro'); localStorage.setItem('as-mz-intro', '1'); setTimeout(() => stage.classList.remove('is-intro'), 1800); } } catch {}
  PT.preload(people().map(c => c.id));
  paintRoster(); if (cur) show(cur); else pics();
  p.el._onShow = () => { if (focus === 3) { const k = focus; focus = -1; at(k); } if (!people().includes(cur)) { cur = people()[0]; paintRoster(); if (cur) show(cur); } };
  return p.el;
}
