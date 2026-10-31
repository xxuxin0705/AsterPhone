// 日志 App：报错标红、警告标黄；点一条展开详情；可复制、清空。
import { h } from '../core/util.js';
import { logs, onLog, clearLogs } from '../core/log.js';
import { page, segmented, navBtn, empty, toast, dialog } from '../core/ui.js';

const LV = { error: '报错', warn: '警告', info: '信息' };
let filter = 'all';
export function open() {
  const p = page({ app: 'log', id: 'log-main', title: '日志', large: true, back: true, right: [
    navBtn('note', '复制全部', () => {
      const text = logs.map(l => `[${new Date(l.at).toLocaleString()}] ${LV[l.level]} · ${l.app} · ${l.msg}${l.detail ? '\n' + l.detail : ''}`).join('\n');
      navigator.clipboard?.writeText(text).then(() => toast('已复制，可以直接发给作者'), () => toast('复制失败'));
    }),
    navBtn('trash', '清空', async () => { if (await dialog({ title: '清空日志？', confirm: '清空', danger: true })) clearLogs(); }),
  ] });
  const list = h('div.as-log-list');
  p.body.append(h('div.as-log-filter', segmented([['all', '全部'], ['error', '报错'], ['warn', '警告'], ['info', '信息']], filter, v => { filter = v; draw(); })), list);
  function draw() {
    list.innerHTML = '';
    const items = logs.filter(l => filter === 'all' || l.level === filter).slice().reverse();
    if (!items.length) { list.appendChild(empty(filter === 'error' ? '没有报错，一切正常' : '还没有日志')); return; }
    items.slice(0, 200).forEach(l => list.appendChild(h('div.as-log-item', { dataset: { level: l.level }, onclick: e => e.currentTarget.classList.toggle('is-open') },
      h('div.as-log-item__head', h('span', LV[l.level] || l.level), h('span', l.app), h('span', { style: { marginLeft: 'auto' } }, new Date(l.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }))),
      h('div.as-log-item__msg', l.msg), l.detail ? h('pre.as-log-item__detail', l.detail) : null)));
  }
  draw();
  const off = onLog(() => draw());
  p.el._onLeave = off;
  return p.el;
}
