// TA 手机里的各个应用，照苹果自带应用的样子排。每个：rows（AI 写的一行行）→ 页面里的内容；push(标题, 内容, 类名) 再盖一层详情。
import { h, sortZh } from '../../core/util.js';
import { icon } from '../../core/ui.js';

const yuan = v => (parseFloat(String(v).replace(/[^\d.+-]/g, '')) || 0).toFixed(2);
const list = kids => h('div.pk-list', kids);
const face = (name, url) => h('i.pk-face', url ? { style: { backgroundImage: `url("${url}")` } } : name.slice(0, 1));
// 这几个图标公共那套里没有（听筒、钟、九宫格、三条线）：自己描的线条，借 icon() 的壳换一条路径
const G = { call: 'M7.2 5.2C5.5 10 14 18.5 18.8 16.8', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2', lines: 'M4 7h16M7 12h10M10 17h4',
  pad: 'M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01' };
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
  短信: (R, push, D, pop) => [
    h('div.pk-top2', h('button.pk-glass', '编辑'), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 20, 2.2))),
    h('h1', '信息'),
    h('div.pk-msgs', groupBy(R, 0).map(([who, L]) => { const last = L[L.length - 1]; return h('button.pk-msg' + (/自己/.test(last[2]) ? '' : '.is-new'), { onclick: () => push(who, [
      h('div.pk-top2.is-chat', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: pop }, icon('back', 20, 2.4)), h('div.pk-peer', ava(who), h('b.pk-glass', who))),
      h('small.pk-meta', '信息 · 短信', h('br'), L[0][1]),
      L.map(r => h('div.pk-bub' + (/自己/.test(r[2]) ? '.is-me' : ''), r[3])),
      h('div.pk-float', h('button.pk-glass.is-round', { 'aria-label': '更多' }, icon('plus', 20, 2.2)), h('div.pk-glass.pk-find', h('span', '信息 · 短信'), icon('mic', 18, 2)))], 'is-raw.pk-sms') },
      ava(who), h('div', h('b', h('span', who), h('time', last[1]), icon('chevron', 13, 2.6)), h('span', last[3]))); })),
    h('div.pk-float', h('div.pk-glass.pk-find', icon('search', 18, 2.2), h('span', '搜索'), icon('mic', 18, 2)), h('button.pk-glass.is-round', { 'aria-label': '写信息' }, icon('edit', 20, 2))),
  ],
  电话: (R, push, D) => {
    const box = h('div.pk-pane'), miss = k => /未接/.test(k), num = h('div.pk-pad__num');
    const panes = {
      通话: () => [h('div.pk-top2', h('button.pk-glass', '编辑'), h('b', '通话'), h('button.pk-glass.is-round', { 'aria-label': '筛选' }, ink('lines', 20, 2.2))),
        h('div.pk-msgs', R.filter(r => r[0] !== '联系人').map(([who, kind = '', t, long]) => h('div.pk-msg.is-call' + (miss(kind) ? '.is-miss' : ''), ava(who),
          h('div', h('b', who), h('span', (/呼出/.test(kind) ? '↗ ' : '↙ ') + (miss(kind) ? '未接来电' : long || kind))), h('time', t), h('i.pk-dial', ink('call', 19, 4.4)))))],
      通讯录: () => [h('div.pk-top2', h('i'), h('b', '联系人'), h('button.pk-glass.is-round', { 'aria-label': '新建' }, icon('plus', 20, 2.2))),
        h('div.pk-msgs', h('div.pk-msg.is-card', ava(D.name, D.avatar), h('div', h('b', D.name), h('span', '我的名片'))),
          of(R, '联系人').sort((a, b) => sortZh(a[1], b[1])).map(([, who, what]) => h('div.pk-msg.is-name', ava(who), h('div', h('b', who), what && h('span', what)))))],
      拨号键盘: () => [num, h('div.pk-pad', [...'123456789*0#'].map((d, i) => h('button', { onclick: () => { num.textContent += d; } }, h('b', d), h('small', ABC[i]))),
        h('button.pk-pad__call', { 'aria-label': '拨打', onclick: () => { num.textContent = ''; } }, ink('call', 32, 4.6)))],
    };
    const bar = h('div.pk-glass.pk-tabbar', [['通话', ink('clock', 22, 2)], ['通讯录', icon('user', 22, 2)], ['拨号键盘', ink('pad', 22, 3.6)]].map(([n, ic], i) => h('button' + (i ? '' : '.is-on'),
      { onclick: e => { [...bar.children].forEach(b => b.classList.toggle('is-on', b === e.currentTarget)); box.replaceChildren(...panes[n]()); } }, ic, h('span', n))));
    box.replaceChildren(...panes.通话());
    return [box, h('div.pk-float', bar, h('button.pk-glass.is-round', { 'aria-label': '搜索' }, icon('search', 20, 2.2)))];
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
