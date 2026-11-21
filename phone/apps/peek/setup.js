// TA 手机里的「设置」：查手机怎么生成（整部手机一份，不分人），和 TA 的屏幕使用时间。
import { h } from '../../core/util.js';
import { commit } from '../../core/store.js';
import { pickWheels, icon } from '../../core/ui.js';
import { chatMsgs } from '../../core/memory.js';
import { S } from './gen.js';

const EVERY = [0, 3, 5, 8, 10, 15, 20, 30, 50], every = n => n ? `每 ${n} 楼` : '手动';
// 一行：左边名字，右边现在的值，点了用滚轮改；只换那个值
function pick(title, list, get, set, show = String) {
  const v = h('span', show(get()));
  return h('button.pk-row', { onclick: async () => { const r = await pickWheels(title, [[list.map(x => [x, show(x)]), get()]]); if (!r) return; set(r[0]); commit('apps'); v.textContent = show(get()); } }, h('b', title), v, icon('chevron', 16, 2.2));
}

export function setup(open) {
  const P = S();
  const times = pick('最多续几次', [1, 2, 3, 4, 5, 6, 8, 10], () => P.fillMax || 3, n => { P.fillMax = n; }, n => n + ' 次'); times.hidden = !P.fill;
  const sw = h('i.pk-sw' + (P.fill ? '.is-on' : ''));
  return [
    h('div.pk-list',
      pick('自动生成', EVERY, () => P.every || 0, n => { P.every = n; P.at = chatMsgs().length; }, every),
      pick('每个应用几条', [3, 4, 5, 6, 8, 10, 12, 15, 20], () => P.count || 6, n => { P.count = n; }, n => n + ' 条'),
      h('button.pk-row', { role: 'switch', onclick: () => { P.fill = !P.fill; commit('apps'); sw.classList.toggle('is-on', P.fill); times.hidden = !P.fill; } }, h('b', '断了自动续写'), sw),
      times),
    h('div.pk-list.pk-gap', h('button.pk-row', { onclick: () => open('屏幕使用时间') }, h('b', '屏幕使用时间'), icon('chevron', 16, 2.2))),
  ];
}
