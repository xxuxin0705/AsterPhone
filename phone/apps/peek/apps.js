// TA 手机里的各个应用，照苹果自带应用的样子排。每个：rows（AI 写的一行行）→ 页面里的内容；push(标题, 内容, 类名) 再盖一层详情。
import { h, sortZh } from '../../core/util.js';
import { icon } from '../../core/ui.js';
import * as time from '../../core/time.js';

const yuan = v => (parseFloat(String(v).replace(/[^\d.+-]/g, '')) || 0).toFixed(2);
const list = kids => h('div.pk-list', kids);
const face = (name, url) => h('i.pk-face', url ? { style: { backgroundImage: `url("${url}")` } } : name.slice(0, 1));
// 这几个图标公共那套里没有（听筒、钟、九宫格、三条线）：自己描的线条，借 icon() 的壳换一条路径
const G = { call: 'M7.2 5.2C5.5 10 14 18.5 18.8 16.8', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2', lines: 'M4 7h16M7 12h10M10 17h4',
  pad: 'M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01' };
// 实心的：听筒、钟、小人、九个点（标签栏、拨打键用）。.cut 是挖空的那几笔，颜色跟着页面底色
const F = { call: '<path d="M6.3 3.2c.9-.4 1.9 0 2.3.9l1.3 2.9c.4.8.1 1.8-.6 2.3l-1.4 1c1 2.2 2.8 4 5 5l1-1.4c.5-.7 1.5-1 2.3-.6l2.9 1.3c.9.4 1.3 1.4.9 2.3l-.6 1.4c-.6 1.3-2 2.1-3.4 1.8C9.4 18.9 5.1 14.6 3.8 8.3c-.3-1.4.5-2.8 1.8-3.4z"/>',
  clock: '<circle cx="12" cy="12" r="10.5"/><path class="cut" d="M12 6.6V12H7.4" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
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
const ink = (k, size, w) => { const s = icon('info', size, w); s.firstChild.setAttribute('d', G[k]); return s; };
// 没头像的人：苹果那种蓝灰底的小人（纯样式画的）；有头像就放头像
const ava = (name, url) => h('i.pk-ava', url ? { style: { backgroundImage: `url("${url}")` } } : null);
const ABC = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ', '', '+', ''];
/** 整页自己画的应用（不要公共的标题栏） */
export const RAW = ['短信', '电话'];
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
  消息: (R, push, D) => list(chats(R, D).map(x => { const last = x.msgs[x.msgs.length - 1]; return h('button.pk-row', { onclick: () => push(x.title, x.msgs.map((m, i) => [x.group && !m.me && (!i || x.msgs[i - 1].who !== m.who) && h('small.pk-by', m.who), h('div.pk-bub' + (m.me ? '.is-me' : ''), m.text)]), 'pk-sms.pk-im') },
    face(x.title, x.avatar), h('div', h('b', x.title, h('time', last.t)), h('span', x.draft ? [h('em', '[草稿] '), x.draft] : (x.group && !last.me ? last.who + '：' : '') + last.text))); })),
  屏幕使用时间: R => { const max = Math.max(...R.map(r => +r[1] || 0), 1), all = R.reduce((a, r) => a + (+r[1] || 0), 0), hm = m => (m >= 60 ? Math.floor(m / 60) + ' 小时 ' : '') + (m % 60) + ' 分钟';
    return [h('div.pk-day', '今天'), h('div.pk-card', h('b.pk-big', hm(all))), list(R.map(([n, m]) => h('div.pk-row', h('div', h('b', n), h('i.pk-bar', { style: { width: (+m || 0) / max * 100 + '%' } })), h('time', hm(+m || 0)))))]; },
  备忘录: (R, push) => list(R.map(([t, d, body = '']) => h('button.pk-row.is-col', { onclick: () => push(t, [h('time', d), ...body.split('//').map(x => h('p', x.trim()))], 'pk-note') },
    h('b', t), h('span', h('time', d), body.replace(/\s*\/\/\s*/g, ' '))))),
  搜索: R => {
    const kind = r => /收藏/.test(r[2]) ? '收藏' : /无痕|私密/.test(r[2]) ? '无痕' : '历史', box = list();
    return [tabs(['历史', '收藏', '无痕'], k => box.replaceChildren(...R.filter(r => kind(r) === k).map(([q, t]) => h('div.pk-row', icon(k === '收藏' ? 'bookmark' : 'search', 17, 2), h('b', q), h('time', t))))), box];
  },
  // 信息、电话照 iPhone 自带的排：整页自己画（顶上的玻璃按钮、底下浮着的搜索条 / 标签栏），不用公共的标题栏
  短信: (R, push, D, pop) => {
    const threads = groupBy(R, 0), unread = threads.filter(([, L]) => !/自己/.test(L[L.length - 1][2])).length;
    const known = new Set(of((D.apps.电话 || {}).rows || [], '联系人').map(r => r[1]));
    const me = r => /自己/.test(r[2]);
    // 一个对话：同一个人连着发的几条只有最后一条带小尾巴；时间变了就在中间写一行时间
    const open = (who, L) => push(who, [
      h('div.pk-top2.is-chat', h('button.pk-glass.pk-backpill', { 'aria-label': '返回', onclick: pop }, icon('back', 24, 2.4), unread ? h('em', unread) : null),
        h('div.pk-peer', ava(who), h('b.pk-glass', h('span', who), icon('chevron', 12, 2.6)))),
      h('small.pk-meta', '信息 · 短信', h('br'), when(L[0][1], true)),
      L.map((r, i) => [i && r[1] !== L[i - 1][1] ? h('small.pk-meta.is-gap', when(r[1], true)) : null,
        h('div.pk-bub' + (me(r) ? '.is-me' : '') + (!L[i + 1] || me(L[i + 1]) !== me(r) || L[i + 1][1] !== r[1] ? '.is-tail' : ''), r[3])]),
      !known.has(who) && !L.some(me) ? h('div.pk-spam', h('span', '不认识此商家？'), h('button', '报告垃圾信息')) : null,
      h('div.pk-float', h('button.pk-glass.is-round', { 'aria-label': '更多' }, icon('plus', 22, 2.2)), h('div.pk-glass.pk-find', h('span', '信息 · RCS'), icon('mic', 20, 2)))], 'is-raw.pk-sms');
    const head = h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', '信息'), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 22, 2.2))), big = h('h1', '信息');
    // 大标题滚到顶栏底下时，顶栏中间出现小标题（和 iPhone 一样）
    new IntersectionObserver(([e]) => head.classList.toggle('is-up', !e.isIntersecting), { rootMargin: '-100px 0px 0px 0px' }).observe(big);
    return [head, big,
      h('div.pk-msgs', threads.map(([who, L]) => { const last = L[L.length - 1]; return h('button.pk-msg' + (me(last) ? '' : '.is-new'), { onclick: () => open(who, L) },
        ava(who), h('div', h('b', h('span', who), h('time', when(last[1])), icon('chevron', 14, 2.6)), h('span', h('em', '数据'), last[3]))); })),
      h('div.pk-float', h('div.pk-glass.pk-find', icon('search', 22, 2.4), h('span', '搜索'), icon('mic', 20, 2)), h('button.pk-glass.is-round', { 'aria-label': '写信息' }, icon('edit', 22, 2)))];
  },
  // 照 iPhone 的「电话」：底下浮着三个标签 + 搜索；点搜索换成「通话 / 语音留言」那一页，底下换成键盘 · 搜索条 · 关
  电话: (R, push, D, pop) => {
    const box = h('div.pk-pane'), calls = R.filter(r => r[0] !== '联系人' && r[0] !== '留言'), notes = of(R, '留言'), num = h('div.pk-pad__num');
    const miss = k => /未接/.test(k), place = (s, who) => !s || /\d\s*[分秒:：]|^\d+$/.test(s) ? (/\d{3}/.test(who) ? '未知' : '手机') : s;   // 以前存的这一格是通话时长，不是归属地
    const callBtn = () => h('i.pk-dial', fill('call', 22));
    const call = ([who, kind = '', t, loc]) => h('div.pk-call' + (miss(kind) ? '.is-miss' : ''), ava(who), h('div', h('b', who), h('span', h('em', '主号'), place(loc, who))), h('time', when(t)), callBtn());
    const note = ([, who, t, len, text]) => h('div.pk-call.is-note', ava(who), h('div', h('b', who), h('span', h('em', '主号'), len || '00:00'), h('p', `“${text || ''}”`)), h('time', when(t)), callBtn());
    const head = (t, go) => h('div.pk-sec', h('b', t), h('button', { onclick: go }, '查看全部'));
    const panes = {
      通话: () => [h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', '通话'), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 20, 2.2))), h('div.pk-calls', calls.map(call))],
      通讯录: () => {
        const by = new Map(); of(R, '联系人').sort((a, b) => sortZh(a[1], b[1])).forEach(r => { const k = initial(r[1]); (by.get(k) || by.set(k, []).get(k)).push(r); });
        const secs = [...by].sort((a, b) => (a[0] === '#') - (b[0] === '#') || a[0].localeCompare(b[0]));
        const list = h('div.pk-book', h('div.pk-book__me', face2(D.name, D.avatar, '.is-me'), h('div', h('b', D.name), h('span', '我的名片'))),
          secs.map(([k, L]) => [h('div.pk-book__k', { dataset: { k } }, k), L.map(([, who]) => h('div.pk-book__row', face2(who), h('div', h('b', who))))]));
        const jump = k => { const el = list.querySelector(`[data-k="${k}"]`); el && el.scrollIntoView({ block: 'start' }); };
        return [h('div.pk-top2', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 22, 2.4)), h('b', '联系人'), h('button.pk-glass.is-round', { 'aria-label': '新建' }, icon('plus', 22, 2.2))),
          list, h('div.pk-index', [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'].map(k => h('button', { onclick: () => jump(k) }, k)))];
      },
      拨号键盘: () => [num, h('div.pk-pad', [...'123456789*0#'].map((d, i) => h('button', { onclick: () => { num.textContent += d; } }, h('b', d), h('small', ABC[i]))))],
    };
    const tab = n => { [...bar.children].forEach(b => b.classList.toggle('is-on', b.dataset.n === n)); box.dataset.pane = { 通话: 'calls', 通讯录: 'book', 拨号键盘: 'pad' }[n]; box.replaceChildren(...panes[n]()); float.replaceChildren(bar, findB); };
    const bar = h('div.pk-glass.pk-tabbar', [['通话', 'clock'], ['通讯录', 'person'], ['拨号键盘', 'dots']].map(([n, ic]) => h('button', { dataset: { n }, onclick: () => tab(n) },
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
  日历: R => groupBy(R, 0).map(([day, L]) => [h('div.pk-day', day), list(L.map(([, t, what, where]) => h('div.pk-row.is-plan', h('time', t || '全天'), h('div', h('b', what), where && h('span', where)))))]),
  钱包: R => {
    const bal = R.find(r => r[0] === '余额'), L = R.filter(r => r !== bal);
    return [h('div.pk-wallet', h('span', '余额'), h('b', '¥' + yuan(bal ? bal[1] : 0))), h('div.pk-day', '最近的交易'),
      list(L.map(([t, what, v]) => h('div.pk-row', h('div', h('b', what), h('span', t)), h('strong' + (/^\s*\+/.test(v) ? '.is-in' : ''), (/^\s*\+/.test(v) ? '+' : '-') + yuan(String(v).replace(/[+-]/g, ''))))))];
  },
};
