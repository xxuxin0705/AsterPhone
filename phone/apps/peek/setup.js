// TA 手机里的「设置」：查手机怎么生成（整部手机一份，不分人），和 TA 的屏幕使用时间。
import { h } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { pickWheels, icon, avatar } from '../../core/ui.js';
import { nameOf } from '../chat/engine.js';
import { resolveConn } from '../../core/api.js';
import { chatMsgs } from '../../core/memory.js';
import { S } from './gen.js';

const EVERY = [0, 3, 5, 8, 10, 15, 20, 30, 50], every = n => n ? `每 ${n} 楼` : '手动';
const tile = (ic, bg) => h('i.pk-tile', { style: { background: bg } }, icon(ic, 17, 2));
// 一行：左边图标和名字，右边现在的值，点了用滚轮改；只换那个值
function pick(t, title, list, get, set, show = String) {
  const v = h('span', show(get()));
  return h('button.pk-row', { onclick: async () => { const r = await pickWheels(title, [[list.map(x => [x, show(x)]), get()]]); if (!r) return; set(r[0]); commit('apps'); v.textContent = show(get()); } }, t, h('b', title), v, icon('chevron', 16, 2.2));
}

export function setup(c, open, mode) {
  const P = S();
  const times = pick(tile('sort', '#8e8e93'), '最多续几次', [1, 2, 3, 4, 5, 6, 8, 10], () => P.fillMax || 3, n => { P.fillMax = n; }, n => n + ' 次'); times.hidden = !P.fill;
  const sw = h('i.pk-sw' + (P.fill ? '.is-on' : '')), dsw = h('i.pk-sw' + (P.desk !== false ? '.is-on' : ''));
  return [
    h('div.pk-list', h('div.pk-row.pk-me', avatar(c.avatar, nameOf(c), 58), h('div', h('b', nameOf(c)), h('span', 'Apple 账户、iCloud 等')), icon('chevron', 16, 2.2))),
    h('div.pk-list.pk-gap', pick(tile('eye', '#007aff'), '显示与亮度', ['follow', 'day', 'night'], () => P.mode || 'follow', v => { P.mode = v; mode(); }, v => ({ follow: '跟随', day: '日间', night: '夜间' })[v]),
      h('button.pk-row', { role: 'switch', onclick: () => { P.desk = P.desk === false; commit('apps'); dsw.classList.toggle('is-on', P.desk); } }, tile('image', '#ff9500'), h('b', '开场的桌面'), dsw),
      h('button.pk-row', { onclick: () => open('屏幕使用时间') }, tile('hourglass', '#5856d6'), h('b', '屏幕使用时间'), icon('chevron', 16, 2.2))),
    h('div.pk-list.pk-gap', pick(tile('link', '#34c759'), '生成用的 API', ['follow', ...state.connections.text.map(x => x.id)], () => (P.conn ||= { text: 'follow' }).text, v => { P.conn.text = v; },
      v => v === 'follow' ? `跟聊天（${(resolveConn('text', 'chat') || {}).name || '没设置'}）` : (state.connections.text.find(x => x.id === v) || {}).name || '没设置'),
      pick(tile('repeat', '#ff9500'), '自动生成', EVERY, () => P.every || 0, n => { P.every = n; P.at = chatMsgs().length; }, every),
      pick(tile('list', '#ff3b30'), '每个应用几条', [3, 4, 5, 6, 8, 10, 12, 15, 20], () => P.count || 6, n => { P.count = n; }, n => n + ' 条'),
      pick(tile('note', '#8e8e93'), '发多少正文', [10, 20, 30, 50, 80, 120], () => P.floors || 30, n => { P.floors = n; }, n => `最近 ${n} 楼`),
      h('button.pk-row', { role: 'switch', onclick: () => { P.fill = !P.fill; commit('apps'); sw.classList.toggle('is-on', P.fill); times.hidden = !P.fill; } }, tile('undo', '#007aff'), h('b', '断了自动续写'), sw),
      times),
  ];
}
