// 日志 App：只有找 API 的调用（进行中蓝、成功绿、失败红）和调用旁边的事件（报错红、警告黄、信息绿）。
// 上面一排按状态筛、下面一排按应用筛（聊天、音乐、设置；细分的写成标签）；每条能复制、删除，进行中的能中止；发出去的内容默认折起来。
// 来一条新的只插一张卡、状态变了只改那一张、筛选只是藏起 / 显示：不重画整页（不闪）。
import { h } from '../../core/util.js';
import { logs, onLog, clearLogs, removeLog, abortCall } from '../../core/log.js';
import { page, segmented, navBtn, empty, toast, dialog } from '../../core/ui.js';

const LV = { error: '报错', warn: '警告', info: '成功' };
const when = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const secs = ms => ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
const tagOf = e => e.kind !== 'call' ? LV[e.level] : e.run ? '进行中' : e.level === 'error' ? '失败' : e.level === 'warn' ? '警告' : '成功';
const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => toast(`已复制${what}`), () => toast('复制失败'));
let want = 'all', appSel = '';

export function open(opts = {}) {
  const p = page({ app: 'log', id: 'log-main', title: '日志', large: true, back: true,
    right: [navBtn('trash', '清空', async () => { if (await dialog({ title: '清空日志？', confirm: '清空', danger: true })) clearLogs(); })] });
  const list = h('div.as-log-list'), none = empty('还没有日志'), apps = h('div.as-chips.as-log-apps');
  const cards = new Map(), opened = new Map();   // 自己点开 / 收起过的折叠：id + 哪一块 → 开没开
  const shown = e => (want === 'all' || (want === 'run' ? e.run : !e.run && e.level === want)) && (!appSel || e.app === appSel);
  const filter = () => { let n = 0; for (const e of logs) { const c = cards.get(e.id); if (c) n += !(c.hidden = !shown(e)); } none.hidden = n > 0; };
  const paintApps = () => apps.replaceChildren(...['', ...new Set(logs.map(e => e.app).reverse())].map(a =>
    h('button.as-chip' + (a === appSel ? '.is-active' : ''), { onclick: () => { appSel = a; paintApps(); filter(); } }, a || '全部应用')));

  const fold = (e, k, title, text, open0) => {
    const key = e.id + k, on = opened.has(key) ? opened.get(key) : open0;
    return h('div.as-log-fold' + (on ? '.is-open' : ''),
      h('div.as-log-fold__head', { onclick: ev => opened.set(key, ev.currentTarget.parentNode.classList.toggle('is-open')) },
        h('span', `${title} · ${text.length} 字`), h('button.as-log-btn', { onclick: ev => { ev.stopPropagation(); copy(text, title); } }, '复制')),
      h('pre', text));
  };
  function fill(c, e) {
    c.dataset.tone = e.run ? 'run' : e.level;
    c.replaceChildren(
      h('div.as-log-item__head', h('b', tagOf(e)), h('span', e.app), e.tag ? h('span.as-log-item__tag', e.tag) : null, e.src ? h('span', e.src + (e.model ? ` · ${e.model}` : '')) : null,
        h('span.as-log-item__time', e.run ? `已等 ${secs(Date.now() - e.at)}` : when(e.at) + (e.ms != null ? ` · ${secs(e.ms)}` : ''))),
      h('div.as-log-item__msg', e.msg),
      e.res ? fold(e, 'res', '收回来的', e.res, e.run) : null,
      e.req ? fold(e, 'req', '发出去的', e.req, false) : null,
      e.detail ? fold(e, 'det', '细节', e.detail, false) : null,
      h('div.as-log-item__acts',
        e.run ? h('button.as-log-btn', { onclick: () => abortCall(e.id) }, '中止') : null,
        h('button.as-log-btn', { onclick: () => copy([`${when(e.at)} ${tagOf(e)} · ${e.app}${e.tag ? ' · ' + e.tag : ''}${e.src ? ' · ' + e.src + (e.model ? ' · ' + e.model : '') : ''}`, e.msg, e.detail,
          e.req && '【发出去的】\n' + e.req, e.res && '【收回来的】\n' + e.res].filter(Boolean).join('\n\n'), '这一条') }, '复制'),
        h('button.as-log-btn.is-danger', { onclick: () => removeLog(e.id) }, '删除')));
  }
  const add = (e, top) => { const c = h('div.as-log-item'); fill(c, e); cards.set(e.id, c); top ? list.prepend(c) : list.append(c); c.hidden = !shown(e); };
  [...logs].reverse().forEach(e => add(e));

  const off = onLog((e, how) => {
    if (how === 'clear') { list.replaceChildren(); cards.clear(); }
    else if (how === 'add') { add(e, true); if (![...apps.children].some(b => b.textContent === e.app)) paintApps(); }
    else if (how === 'remove') { cards.get(e.id)?.remove(); cards.delete(e.id); }
    else if (cards.has(e.id)) fill(cards.get(e.id), e);
    none.hidden = [...cards.values()].some(c => !c.hidden);
  });
  // 进行中的那条：时间那里每秒走一下
  const tick = setInterval(() => { for (const e of logs) if (e.run) { const t = cards.get(e.id)?.querySelector('.as-log-item__time'); if (t) t.textContent = `已等 ${secs(Date.now() - e.at)}`; } }, 1000);
  p.el._onLeave = () => { off(); clearInterval(tick); };

  p.body.append(h('div.as-log-filter', segmented([['all', '全部'], ['run', '进行中'], ['info', '成功'], ['error', '报错'], ['warn', '警告']], want, v => { want = v; filter(); }), apps), none, list);
  paintApps(); filter();
  p.el._focus = focus;
  if (opts.id) setTimeout(() => focus(opts.id), 400);
  return p.el;

  /** 从报错的「查看日志」跳过来：清掉筛选，滚到那一条，展开发出去 / 收回来的 */
  function focus(id) {
    const c = cards.get(id); if (!c) return;
    if (!shown(logs.find(e => e.id === id))) { want = 'all'; appSel = ''; p.body.querySelectorAll('.as-log-filter .as-segmented button').forEach((b, i) => b.classList.toggle('is-active', !i)); paintApps(); filter(); }
    c.querySelectorAll('.as-log-fold').forEach(f => f.classList.add('is-open'));
    c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.add('is-hit'); setTimeout(() => c.classList.remove('is-hit'), 1600);
  }
}
export function reveal(opts = {}) { if (opts.id) document.querySelector('[data-as-page="log-main"]')?._focus?.(opts.id); }
