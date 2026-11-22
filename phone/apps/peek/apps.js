// TA 手机里的各个应用，照苹果自带应用的样子排。每个：rows（AI 写的一行行）→ 页面里的内容；push(标题, 内容, 类名) 再盖一层详情。
import { h, sortZh } from '../../core/util.js';
import { icon } from '../../core/ui.js';
import * as time from '../../core/time.js';
import { saveRead } from './gen.js';
import { myName } from '../../core/promptstore.js';

const yuan = v => (parseFloat(String(v).replace(/[^\d.+-]/g, '')) || 0).toFixed(2);
const list = kids => h('div.pk-list', kids);
const face = (name, url) => h('i.pk-face', url ? { style: { backgroundImage: `url("${url}")` } } : name.slice(0, 1));
// 这几个图标公共那套里没有（听筒、钟、九宫格、三条线、小云朵）：自己描的线条，借 icon() 的壳换一条路径
const G = { call: 'M7.2 5.2C5.5 10 14 18.5 18.8 16.8', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2', lines: 'M4 7h16M7 12h10M10 17h4',
  pad: 'M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01',
  cloud: 'M7.5 15.5h9a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 7.4 8a3.75 3.75 0 0 0 .1 7.5zM6 19.2h.01M3.8 21.4h.01' };
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
const when = (t, full) => {
  const m = /(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?(?:\s*(\d{1,2}):(\d{2}))?/.exec(t || ''); if (!m) return t || '';
  const d = new Date(+m[1], m[2] - 1, +m[3]), now = time.isStory() ? time.story().date : new Date(), days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 864e5);
  const hm = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '', wk = '日一二三四五六'[d.getDay()];
  if (full) return [days === 0 ? '今天' : days === 1 ? '昨天' : days > 1 && days < 7 ? '星期' + wk : `${+m[2]}月${+m[3]}日 周${wk}`, hm].filter(Boolean).join(' ');   // 对话里的时间：日子 + 几点
  return days === 0 && hm ? hm : days === 1 ? '昨天' : days > 1 && days < 7 ? '星期' + wk : `${m[1]}/${+m[2]}/${+m[3]}`;
};
// 通讯录的头像：名字第一个字（自己那张是粉紫的）；有头像就放头像
const face2 = (name, url, me = '') => h('i.pk-face2' + me, url ? { style: { backgroundImage: `url("${url}")` } } : null, url ? '' : String(name || '?').trim().slice(0, 1));
// 不是中文的：AI 在后面附了「[翻译：…]」，显示时去掉，原文和中文都记在那几个字上
const TR = /\s*[[［【]翻译[:：]\s*((?:[^[\]［］【】]|[[［【][^\]］】]*[\]］】])*)[\]］】]/;   // 翻译里可以再套一层括号（[图：…]）
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
export function trBtn(layer, root) {
  const slot = layer.querySelector('.pk-top2, .pk-app__bar');
  if (!slot || layer.querySelector('.pk-tl') || !layer.querySelector('.pk-trs, .pk-trx')) return;
  const btn = h('button.pk-glass.is-round.pk-tl' + (zh ? '.is-on' : ''), { 'aria-label': '翻译', onclick: () => flipAll(root) }, zh ? '原' : '译');
  const last = slot.lastElementChild;
  if (slot.children.length > 2 && last.matches('button')) last.before(btn); else slot.append(btn);
}
const ink = (k, size, w) => { const s = icon('info', size, w); s.firstChild.setAttribute('d', G[k]); return s; };
// 没头像的人：苹果那种蓝灰底的小人（纯样式画的）；有头像就放头像
const ava = (name, url) => h('i.pk-ava', url ? { style: { backgroundImage: `url("${url}")` } } : null);
const ABC = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ', '', '+', ''];
/** 整页自己画的应用（不要公共的标题栏） */
export const RAW = ['短信', '消息', '电话', '搜索'];
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

// 大标题往上滑、碰到顶栏时，顶栏中间换成小标题（和 iPhone 一样）
function bigTitle(head, big) {
  requestAnimationFrame(() => { const b = big.parentElement; b && b.addEventListener('scroll', () => { const r = big.getBoundingClientRect(); head.classList.toggle('is-up', r.bottom - 4 < head.getBoundingClientRect().bottom); }, { passive: true }); });
}
/** 短信、消息都照 iPhone 的「信息」排：列表（蓝点 = 最后一条是对方发的、还没点开过，点开过的记在 D.read）和对话页。
 *  一个对话：同一个人连着发的只有最后一条带小尾巴，换人、隔了时间就隔开一点；群里别人说的第一条上面写名字 */
// 两条之间隔了一小时以上（或者不是同一天）才在中间写时间，和 iPhone 一样
const far = (a, b) => { const day = t => String(t || '').replace(/\s*\d{1,2}:\d{2}.*$/, ''), min = t => { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? m[1] * 60 + +m[2] : null; };
  return day(a) !== day(b) || min(a) == null || min(b) == null || Math.abs(min(b) - min(a)) >= 60; };
function messenger(threads, push, D, pop, o) {
  const seen = D.read ||= [], isNew = x => !x.msgs[x.msgs.length - 1].me && !seen.includes(o.key + x.title);
  let unread = threads.filter(isNew).length;
  const open = (x, row) => { const L = x.msgs; if (isNew(x)) { seen.push(o.key + x.title); unread--; row.classList.remove('is-new'); saveRead(D); } push(x.title, [
    h('div.pk-top2.is-chat', h('button.pk-glass.pk-backpill', { 'aria-label': '返回', onclick: pop }, icon('back', 24, 2.4), unread ? h('em', unread) : null),
      h('div.pk-peer', ava(x.title, x.avatar), h('b.pk-glass', h('span', x.title), icon('chevron', 12, 2.6)))),
    h('small.pk-meta', '信息 · ' + o.kind, h('br'), when(L[0].t, true)),
    L.map((m, i) => { const p = L[i - 1], n = L[i + 1], gap = p && far(p.t, m.t);
      return [gap ? h('small.pk-meta.is-gap', when(m.t, true)) : null, x.group && !m.me && (!p || gap || p.me || p.who !== m.who) ? h('small.pk-by', m.who) : null,
        h('div.pk-bub' + (m.me ? '.is-me' : '') + (!n || n.me !== m.me || n.t !== m.t || (x.group && n.who !== m.who) ? '.is-tail' : ''), m.text)]; }),
    o.spam && o.spam(x) ? h('div.pk-spam', h('span', '不认识此商家？'), h('button', '报告垃圾信息')) : null,
    h('div.pk-float', h('button.pk-glass.is-round', { 'aria-label': '更多' }, icon('plus', 22, 2.2)), h('div.pk-glass.pk-find', h('span', '信息 · ' + o.kind), icon('mic', 20, 2)))], 'is-raw.pk-sms'); };
  const head = h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', o.title), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 22, 2.2))), big = h('h1', o.title);
  bigTitle(head, big);
  return [head, big,
    h('div.pk-msgs', threads.map(x => { const last = x.msgs[x.msgs.length - 1], row = h('button.pk-msg' + (isNew(x) ? '.is-new' : ''), { onclick: () => open(x, row) },
      ava(x.title, x.avatar), h('div', h('b', h('span', x.title), h('time', when(last.t)), icon('chevron', 14, 2.6)),
        h('span', o.tag ? h('em', o.tag) : null, x.draft ? [h('em.is-draft', '草稿'), x.draft] : (x.group && !last.me ? last.who + '：' : '') + last.text))); return row; })),
    h('div.pk-float', h('div.pk-glass.pk-find', icon('search', 22, 2.4), h('span', '搜索'), icon('mic', 20, 2)), h('button.pk-glass.is-round', { 'aria-label': '写信息' }, icon('edit', 22, 2)))];
}

// TA 存的备注：电话里「联系人｜真名｜备注｜这是谁」；通话记录、短信里写的是真名，显示成备注（以前存的只有备注那一格，就照旧）
const nicks = D => new Map(of((D.apps.电话 || {}).rows || [], '联系人').filter(r => r.length > 3 && r[2]).map(r => [r[1], r[2]]));
export const VIEWS = {
  相册: (R, push) => {
    const box = h('div.pk-photos'), hue = t => [...t].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
    const shot = ([k, what, t, more]) => h('button', { style: { '--h': hue(what) }, onclick: () => push(t || k, [h('div.pk-photo', { style: { '--h': hue(what) } }, what), h('div.pk-list', h('div.pk-row', h('b', k === '删除' ? '为什么删' : '地点'), h('span', more || '没写')))]) }, what);
    return [tabs(['图库', '隐藏', '最近删除'], k => box.replaceChildren(...of(R, k.slice(-2)).map(shot))), box];
  },
  AI: (R, push) => {
    const box = list(), names = [...new Set(R.map(r => r[0]))];
    return [tabs(names, k => box.replaceChildren(...groupBy(R.filter(r => r[0] === k), 1).map(([title, L]) => h('button.pk-row.is-col', { onclick: () => push(k, L.map(r => h('div.pk-bub' + (/自己/.test(r[2]) ? '.is-me' : ''), r[3])), 'pk-sms.pk-im') }, h('b', title), h('span', L[L.length - 1][3]))))), box];
  },
  屏幕使用时间: R => { const max = Math.max(...R.map(r => +r[1] || 0), 1), all = R.reduce((a, r) => a + (+r[1] || 0), 0), hm = m => (m >= 60 ? Math.floor(m / 60) + ' 小时 ' : '') + (m % 60) + ' 分钟';
    return [h('div.pk-day', '今天'), h('div.pk-card', h('b.pk-big', hm(all))), list(R.map(([n, m]) => h('div.pk-row', h('div', h('b', n), h('i.pk-bar', { style: { width: (+m || 0) / max * 100 + '%' } })), h('time', hm(+m || 0)))))]; },
  // 备忘录：最上面一张上了锁的「只给自己看」（心声和情绪），下面是便签；涂鸦点开是一张能左右拖的字符画，下面写着解析
  备忘录: (R, push) => {
    const kind = r => ['便签', '心声', '涂鸦'].includes(r[0]) ? r[0] : '便签', notes = R.filter(r => kind(r) === '便签').map(r => r[0] === '便签' ? r.slice(1) : r);
    const heart = R.find(r => kind(r) === '心声'), doodles = R.filter(r => kind(r) === '涂鸦');
    const note = ([t, d, body = '']) => h('button.pk-row.is-col', { onclick: () => push(t, [h('time', d), ...body.split('//').map(x => h('p', x.trim()))], 'pk-note') }, h('b', t), h('span', h('time', d), body.replace(/\s*\/\/\s*/g, ' ')));
    return [heart ? list(h('button.pk-row.pk-locked', { onclick: () => push('只给自己看', [h('small.pk-unlock', icon('lock', 14, 2.2), '已用面容解锁'),
      h('div.pk-moods', (heart[1] || '').split(/[、,，]/).map(x => x.trim()).filter(Boolean).map(x => h('span', x))), ...(heart[2] || '').split('//').map(x => h('p', x.trim()))], 'pk-note') },
      icon('lock', 18, 2.2), h('b', '只给自己看'), h('span', '已锁定'))) : null,
      notes.length ? [h('div.pk-day', '便签'), list(notes.map(note))] : null,
      doodles.length ? [h('div.pk-day', '涂鸦'), list(doodles.map(([, t, art = '', why]) => h('button.pk-row.is-col', { onclick: () => push(t || '随手涂鸦', [
        h('pre.pk-doodle', art.split('//').map(x => x.replace(/\s+$/, '')).join('\n')), why && h('div.pk-card', h('small', '涂鸦解析'), h('p', why))], 'pk-note') },
        h('b', t || '随手涂鸦'), h('span', why || ''))))] : null];
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
      if ((m = /^[■●•]\s*([^：:]{1,16})[：:]\s*([\s\S]*)$/.exec(v))) return h('p.is-sec', h('strong', m[1]), h('br'), ...rich(m[2]));
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
  // 短信里不出现和你的：你的手机没有短信，AI 写了就是替你说话（以前生成的也藏起来）
  短信: (R, push, D, pop) => { const known = new Set(of((D.apps.电话 || {}).rows || [], '联系人').flatMap(r => r.slice(1, 3))), nick = nicks(D);
    return messenger(groupBy(R.filter(r => r[0] !== myName() && r[0] !== nick.get(myName())), 0).map(([who, L]) => ({ title: nick.get(who) || who, msgs: L.map(r => ({ me: /自己/.test(r[2]), t: r[1], text: r[3] })) })), push, D, pop,
      { title: '信息', kind: '短信', key: '', tag: '数据', spam: x => /^[\d\s()+-]{5,}$/.test(x.title) && !known.has(x.title) && !x.msgs.some(m => m.me) }); },
  消息: (R, push, D, pop) => messenger(chats(R, D), push, D, pop, { title: '消息', kind: 'iMessage', key: '消息:' }),
  // 照 iPhone 的「电话」：底下浮着三个标签 + 搜索；点搜索换成「通话 / 语音留言」那一页，底下换成键盘 · 搜索条 · 关
  电话: (R, push, D, pop) => {
    const box = h('div.pk-pane'), calls = R.filter(r => r[0] !== '联系人' && r[0] !== '留言'), notes = of(R, '留言'), num = h('div.pk-pad__num'), nick = nicks(D), nm = who => nick.get(who) || who;
    const miss = k => /未接/.test(k), place = (s, who) => !s || /\d\s*[分秒:：]|^\d+$/.test(s) ? (/\d{3}/.test(who) ? '未知' : '手机') : s;   // 以前存的这一格是通话时长，不是归属地
    const callBtn = () => h('i.pk-dial', fill('call', 22));
    const call = ([who, kind = '', t, loc]) => h('div.pk-call' + (miss(kind) ? '.is-miss' : ''), ava(nm(who)), h('div', h('b', nm(who)), h('span', h('em', '主号'), place(loc, who))), h('time', when(t)), callBtn());
    const note = ([, who, t, len, text]) => h('div.pk-call.is-note', ava(nm(who)), h('div', h('b', nm(who)), h('span', h('em', '主号'), len || '00:00'), h('p', `“${text || ''}”`)), h('time', when(t)), callBtn());
    const head = (t, go) => h('div.pk-sec', h('b', t), h('button', { onclick: go }, '查看全部'));
    const panes = {
      通话: () => { const top = h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', '通话'), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 20, 2.2))), big = h('h1', '通话'); bigTitle(top, big); return [top, big, h('div.pk-calls', calls.map(call))]; },
      通讯录: () => {
        const by = new Map(); of(R, '联系人').map(r => r.length > 3 ? r[2] || r[1] : r[1]).sort(sortZh).forEach(n => { const k = initial(n); (by.get(k) || by.set(k, []).get(k)).push(n); });
        const secs = [...by].sort((a, b) => (a[0] === '#') - (b[0] === '#') || a[0].localeCompare(b[0]));
        const list = h('div.pk-book', h('div.pk-book__me', face2(D.name, D.avatar, '.is-me'), h('div', h('b', D.name), h('span', '我的名片'))),
          secs.map(([k, L]) => [h('div.pk-book__k', { dataset: { k } }, k), L.map(who => h('div.pk-book__row', face2(who), h('div', h('b', who))))]));
        const jump = k => { const el = list.querySelector(`[data-k="${k}"]`); el && el.scrollIntoView({ block: 'start' }); };
        return [h('div.pk-top2', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 22, 2.4)), h('b', '联系人'), h('button.pk-glass.is-round', { 'aria-label': '新建' }, icon('plus', 22, 2.2))),
          list, h('div.pk-index', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'].map(k => h('button', { onclick: () => jump(k) }, k)))];
      },
      // 按了数字，拨打键右边出来一个删除键；拨打 = 清空
      拨号键盘: () => { const del = h('button.pk-pad__del', { 'aria-label': '删除', hidden: true, onclick: () => { num.textContent = num.textContent.slice(0, -1); del.hidden = !num.textContent; } }, icon('close', 18, 2.6));
        return [num, h('div.pk-pad', [...'123456789*0#'].map((d, i) => h('button', { onclick: () => { num.textContent += d; del.hidden = false; } }, h('b', d), h('small', ABC[i])))),
          h('div.pk-pad__row', h('i'), h('button.pk-pad__call', { 'aria-label': '拨打', onclick: () => { num.textContent = ''; del.hidden = true; } }, fill('call', 36)), del)]; },
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
