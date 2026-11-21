// TA 手机里的各个应用，照苹果自带应用的样子排。每个：rows（AI 写的一行行）→ 页面里的内容；push(标题, 内容, 类名) 再盖一层详情。
import { h } from '../../core/util.js';
import { icon } from '../../core/ui.js';

const yuan = v => (parseFloat(String(v).replace(/[^\d.+-]/g, '')) || 0).toFixed(2);
const list = kids => h('div.pk-list', kids);
const face = (name, url) => h('i.pk-face', url ? { style: { backgroundImage: `url("${url}")` } } : name.slice(0, 1));
const of = (R, k) => R.filter(r => r[0] === k);
// 一排分段按钮：点了只换下面那一块
function tabs(names, show) {
  const el = h('div.pk-tabs', names.map((n, i) => h('button' + (i ? '' : '.is-on'), { onclick: e => { [...el.children].forEach(b => b.classList.toggle('is-on', b === e.currentTarget)); show(n); } }, n)));
  show(names[0]); return el;
}
const cover = s => h('i.pk-cover', { style: { backgroundImage: s && s.pic ? `url("${s.pic}")` : '' } });
const song = s => h('div.pk-row', cover(s), h('div', h('b', s.name), h('span', s.artist)));
const groupBy = (R, k) => { const m = new Map(); R.forEach(r => (m.get(r[k]) || m.set(r[k], []).get(r[k])).push(r)); return [...m]; };

// 消息：你手机里真有的（和你的私聊、TA 在的群）排前面，后面是 AI 写的 TA 和别人的聊天；都从 TA 那边看，TA 说的在右边
function chats(R, D) {
  const note = (R.find(r => r[0] === '备注') || [])[2], drafts = R.filter(r => r[0] === '草稿'), by = groupBy(R.filter(r => r[0] !== '备注' && r[0] !== '草稿'), 0);
  return [...D.real.map(x => ({ ...x, title: x.you && note || x.title })), ...D.pairs,
    ...by.map(([who, L]) => ({ title: who.replace(/^群[：:]/, ''), group: /^群[：:]/.test(who), msgs: L.map(r => ({ me: /自己/.test(r[2]), who: r[2], t: r[1], text: r[3] })) }))]
    .map(x => ({ ...x, draft: (drafts.find(r => r[1] === x.title) || [])[2] }));
}

export const VIEWS = {
  音乐: (R, push, D) => [D.mname && h('div.pk-day', D.mname),
    D.lists.length && [h('div.pk-day', '歌单'), list(D.lists.map(l => h('button.pk-row', { onclick: () => push(l.name, [l.intro && h('p.pk-intro', l.intro), list(l.songs.map(song))]) }, cover(l.songs[0]), h('div', h('b', l.name), h('span', `${l.songs.length} 首`)), icon('chevron', 16, 2.2))))],
    of(R, '常听').length && [h('div.pk-day', '这周常听'), list(of(R, '常听').map(([, s, n]) => h('div.pk-row', h('b', s), h('time', (parseInt(n) || 1) + ' 遍'))))],
    of(R, '搜过').length && [h('div.pk-day', '搜过'), list(of(R, '搜过').map(([, q, t]) => h('div.pk-row', icon('search', 17, 2), h('b', q), h('time', t))))]],
  论坛: (R, push, D) => {
    const box = list(), line = (a, b, t) => h('div.pk-row', h('div', h('b', a), b && h('span', b)), t && h('time', t));
    const all = { 发过的: () => D.posts.map(x => line(x.title, x.text, x.t)), 浏览: () => of(R, '浏览').map(r => line(r[1], r[2], r[3])), 收藏: () => of(R, '收藏').map(r => line(r[1], r[2])), 草稿: () => of(R, '草稿').map(r => line(r[1])) };
    return [D.fname && h('div.pk-day', D.fname), tabs(Object.keys(all), k => box.replaceChildren(...all[k]())), box];
  },
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
  短信: (R, push) => list(groupBy(R, 0).map(([who, L]) => { const last = L[L.length - 1]; return h('button.pk-row', { onclick: () => push(who, L.map(r => h('div.pk-bub' + (/自己/.test(r[2]) ? '.is-me' : ''), r[3])), 'pk-sms') },
    face(who), h('div', h('b', who, h('time', last[1])), h('span', last[3]))); })),
  电话: R => {
    const box = list(), calls = R.filter(r => r[0] !== '联系人');
    return [tabs(['最近通话', '未接', '通讯录'], k => box.replaceChildren(...(k === '通讯录' ? of(R, '联系人').map(([, who, what]) => h('div.pk-row', face(who), h('div', h('b', who), what && h('span', what))))
      : calls.filter(r => k !== '未接' || /未接/.test(r[1])).map(([who, kind = '', t, long]) => h('div.pk-row' + (/未接/.test(kind) ? '.is-miss' : ''),
        face(who), h('div', h('b', who), h('span', [kind, /未接/.test(kind) ? '' : long].filter(Boolean).join(' · '))), h('time', t)))))), box];
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
