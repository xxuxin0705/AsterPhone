// 银河纪：一片夜里的海，记忆是漂在里面的光，点水面把它打捞上来（方案见 docs/pages-memory.md）。
// 场景还没做进来，先用列表：首页列出放进银河的 TA（自己勾的）→ 点进去是这个 TA 的「现在」和按年月排的事 → 点一件事能改。
// 整理（世界书 / 文件 / 当前聊天 → AI 分批整理）在核心 core/memory.js 里跑，退出这页也接着跑；同一时间只跑一个。
import { h, pickFile } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, input, textarea, field, btn, icon, avatar, actionSheet, dialog, toast, empty, navBtn, sheet, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { worldNames, ctx } from '../../core/bridge.js';
import { loadBook, keepNow, detectTags, C as ctxCfg } from '../../core/context.js';
import { connLabel, resolveConn } from '../../core/api.js';
import * as M from '../../core/memory.js';
import { nameOf } from '../chat/engine.js';

const S = () => state.apps.memory;
const ymd = at => at ? at.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '不知道哪天';
const ym = at => at ? at.replace(/^(\d+)-0?(\d+).*$/, '$1年$2月') : '不知道哪天';
const people = d => state.contacts.map(c => ({ c, tree: d.trees.includes(c.id) }));

// 整理完了不管在哪一页都说一声
M.onJob((how, j) => {
  if (how === 'done') toast(`整理完了，新记下 ${j.added} 件事`);
  if (how === 'fail') toast(j.error === '已中止' ? '已停下，可以接着整理' : '整理失败：' + j.error);
});

export function open() {
  const p = page({ app: 'memory', id: 'memory-main', title: '银河纪', large: true, back: true,
    right: [navBtn('plus', '整理', openSort), navBtn('gear', '设置', openSet)] });
  const box = h('div');
  let seen = -1;
  async function draw() {
    const d = await M.load(), sig = M.ver + ':' + state.contacts.length;
    if (sig === seen) return;   // 返回这页时数据没变就一点都不动
    seen = sig;
    const all = people(d);
    const row = ({ c, tree }) => item({ icon: avatar(c.avatar, nameOf(c), 30), title: nameOf(c), cls: 'as-mem-who',
      sub: tree ? `${M.evOf(c, d).length} 件事` : '', value: tree ? '' : '放进来', chevron: tree,
      onClick: async () => {
        if (!tree) { if (!(await dialog({ title: `把 ${nameOf(c)} 放进银河？`, confirm: '放进来' }))) return; d.trees.push(c.id); await M.save(); draw(); return; }
        openTree(c);
      } });
    box.replaceChildren(...(all.length ? [
      all.some(x => x.tree) ? group('在银河里的', all.filter(x => x.tree).map(row)) : null,
      all.some(x => !x.tree) ? group('还没放进来', all.filter(x => !x.tree).map(row)) : null,
    ].filter(Boolean) : [empty('还没有联系人')]));
  }
  p.body.append(box);
  draw(); p.el._onShow = draw;
  return p.el;
}

/* ---------- 一个 TA 的记忆（先是列表） ---------- */
function openTree(c) {
  const p = page({ app: 'memory', id: 'memory-tree', title: nameOf(c), back: true, right: navBtn('more', '更多', async () => {
    if (await actionSheet(nameOf(c), [{ value: 'cut', label: '移出银河', danger: true }]) !== 'cut') return;
    if (!(await dialog({ title: `把 ${nameOf(c)} 移出银河？`, text: '记忆不会删，只是不在这里显示', confirm: '移出', danger: true }))) return;
    const d = await M.load(); d.trees = d.trees.filter(x => x !== c.id); await M.save(); nav.pop();
  }) });
  const box = h('div');
  let seen = -1;
  async function draw() {
    const d = await M.load(); if (M.ver === seen) return; seen = M.ver;
    const all = M.evOf(c, d), ev = [...all.filter(e => e.at).reverse(), ...all.filter(e => !e.at)], rel = M.relOf(c, d), ns = M.namesOf(c), todo = d.todo.filter(t => ns.has(t.who) && !t.done);
    const nb = [];
    if (rel.length || todo.length) nb.push(group('现在', [
      ...rel.map(r => item({ title: `${ns.has(r.a) ? r.b : r.a}：${r.kind}`, sub: [r.since && r.since + '起', r.now].filter(Boolean).join(' · '), chevron: true, onClick: () => editRel(r) })),
      ...todo.map(t => item({ title: t.text, sub: '没完的事', onClick: async () => {
        const v = await actionSheet(t.text, [{ value: 'done', label: '做完了' }, { value: 'del', label: '删除', danger: true }]);
        if (v === 'done') t.done = true; else if (v === 'del') d.todo.splice(d.todo.indexOf(t), 1); else return;
        await M.save(); draw();
      } })),
    ]));
    // 按年月分组，最近的在上面
    const months = new Map();
    for (const e of ev) { const k = ym(e.at); if (!months.has(k)) months.set(k, []); months.get(k).push(e); }
    for (const [k, list] of months) nb.push(group(k, list.map(e => item({ cls: 'as-mem-ev' + (e.off ? '.is-off' : ''),
      title: h('span', e.pin ? h('span.as-mem-pin', icon('bookmark', 14, 2)) : null, e.title),
      sub: [ymd(e.at) + (e.guess ? '（推测）' : ''), e.part, e.place].filter(Boolean).join(' · '),
      value: e.off ? '已撤回' : '★'.repeat(e.imp), chevron: true, onClick: () => editEvent(e) }))));
    if (!ev.length) nb.push(empty('还没有记忆', btn('去整理', 'secondary', openSort)));
    box.replaceChildren(...nb);
  }
  async function editRel(r) {
    const d = await M.load(), x = { kind: r.kind, since: r.since, now: r.now };
    const s = sheet({ title: `${r.a} 和 ${r.b}`, content: [
      segmented(M.KINDS.map(k => [k, k]), x.kind, v => { x.kind = v; }),
      field('从什么时候起', input({ value: x.since, onInput: v => { x.since = v.trim(); } })),
      field('现在怎样', input({ value: x.now, onInput: v => { x.now = v.trim(); } })),
      h('div.as-mem-acts', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这段关系？', confirm: '删除', danger: true }))) return; d.rel.splice(d.rel.indexOf(r), 1); await M.save(); s.close(); draw(); })),
      h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
        if (x.kind !== r.kind) r.hist.push({ kind: r.kind, since: r.since });
        Object.assign(r, x); await M.save(); s.close(); draw();
      })),
    ] });
  }
  p.body.append(box);
  draw(); p.el._onShow = draw;
  nav.push(p.el);
}

/* ---------- 改一件事 ---------- */
async function editEvent(e) {
  const d = await M.load(), x = { ...e, who: e.who.join('、'), tags: e.tags.join('、') };
  const p = page({ app: 'memory', id: 'memory-edit', title: '这件事', back: true });
  const flag = (k, on, off) => { const b = btn(x[k] ? on : off, 'secondary', () => { x[k] = !x[k]; b.textContent = x[k] ? on : off; }); return b; };
  p.body.append(
    group('', [field('标题', input({ value: x.title, onInput: v => { x.title = v.trim(); } })),
      field('日期', input({ type: 'date', value: x.at, onInput: v => { x.at = v; x.guess = false; } })),
      field('时段', input({ value: x.part, onInput: v => { x.part = v.trim(); } })),
      field('地点', input({ value: x.place, onInput: v => { x.place = v.trim(); } })),
      field('经过', textarea({ value: x.text, rows: 3, onInput: v => { x.text = v.trim(); } })),
      field('人物', input({ value: x.who, onInput: v => { x.who = v; } })),
      field('标签', input({ value: x.tags, onInput: v => { x.tags = v; } })),
      field('现在的状态', input({ value: x.now, onInput: v => { x.now = v.trim(); } }))]),
    group('重要度', [h('div.as-mem-imp', segmented([1, 2, 3, 4, 5].map(n => [n, '★'.repeat(n)]), x.imp, v => { x.imp = v; }))]),
    h('div.as-mem-acts', flag('pin', '取消钉住', '钉住'), flag('off', '恢复', '撤回'),
      btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这件事？', confirm: '删除', danger: true }))) return; d.ev.splice(d.ev.indexOf(e), 1); await M.save(); nav.pop(); })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', async () => {
      if (!x.title) { toast('标题不能空着'); return; }
      const split = s => String(s).split(/[、,，]/).map(t => t.trim()).filter(Boolean);
      Object.assign(e, { ...x, who: split(x.who), tags: split(x.tags) });
      d.ev.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
      await M.save(); nav.pop();
    })));
  nav.push(p.el);
}

/* ---------- 整理 ---------- */
let src = 'book';
function openSort() {
  const p = page({ app: 'memory', id: 'memory-sort', title: '整理记忆', back: true });
  const pick = h('div'), sum = h('div.as-mem-sum'), act = h('div.as-mem-run');
  // 每种来源各自的选择；parts() 给出要整理的一段段文字
  const book = { name: (ctx() && ctx().chatMetadata && ctx().chatMetadata.world_info) || '', entries: [], off: new Set() };
  const file = { name: '', got: null, off: new Set() };
  // 要 / 不要哪些标签：记住上次在这里挑的；没挑过就照「上下文与世界书」
  const chat = { withUser: true, from: 0, to: Infinity, keep: (S().keep || keepNow()).slice(), drop: (S().drop || ctxCfg().drop || []).slice() };
  const entryRows = (list, off) => list.map((e, i) => toggleItem({ title: e.title, sub: `${e.content.length} 字` }, !off.has(i), on => { on ? off.delete(i) : off.add(i); count(); }));
  const parts = () => {
    if (src === 'book') return book.entries.filter((e, i) => !book.off.has(i)).map(e => e.content);
    if (src === 'chat') return M.floorsText(M.chatMsgs(), chat);
    const g = file.got; if (!g) return [];
    return g.msgs ? M.floorsText(g.msgs, chat) : g.entries ? g.entries.filter((e, i) => !file.off.has(i)).map(e => e.content) : g.text.split(/\n{2,}/);
  };
  const count = () => { const ps = parts(), n = ps.reduce((a, s) => a + s.length, 0); sum.textContent = n ? `约 ${n} 字 · 分 ${M.batches(ps).length} 批` : ''; paintRun(); };
  // 正文楼层：读哪几层、包不包含你发的、哪些标签要（和「设置 → 上下文与世界书」一样：亮着的标签里的字拿去整理，灭着的整段去掉，没被标签包着的照常整理）
  const floors = msgs => [group('楼层', [toggleItem({ title: '包含你发的楼层' }, chat.withUser, on => { chat.withUser = on; count(); }),
    field(`从第几层到第几层（一共 ${msgs.length} 层，从 0 数）`, h('div.as-mem-range', input({ type: 'number', value: String(chat.from), onInput: v => { chat.from = Math.max(0, parseInt(v, 10) || 0); count(); } }),
      h('span', '到'), input({ type: 'number', value: String(Math.min(chat.to, msgs.length - 1)), onInput: v => { chat.to = v === '' ? Infinity : parseInt(v, 10); count(); } })))]),
  tagGroup(msgs)];
  // 正文筛选：和「设置 → 上下文与世界书」一个规矩，「要」的标签里的字拿去整理，「不要」的整段去掉，没被标签包着的照常整理。
  // 扫出来的标签都列出来（不在「要」里的先放「不要」），点一下换到另一排；也能自己加。下面能一层层预览筛完的样子
  const tagGroup = msgs => {
    const found = detectTags(msgs.map(m => ({ text: m.mes || '' })));
    for (const tg of Object.keys(found)) if (!chat.keep.includes(tg) && !chat.drop.includes(tg)) chat.drop.push(tg);
    const rows = { keep: h('div.as-chips'), drop: h('div.as-chips') }, other = k => k === 'keep' ? 'drop' : 'keep';
    const keepSave = () => { S().keep = chat.keep; S().drop = chat.drop; commit('apps'); count(); paint(); };
    const paint = () => ['keep', 'drop'].forEach(k => rows[k].replaceChildren(...chat[k].map(tg => h('span.as-chip' + (k === 'keep' ? '.is-active' : ''), {
      onclick: () => { chat[k] = chat[k].filter(x => x !== tg); chat[other(k)].push(tg); keepSave(); } }, (tg === '!--' ? '<!-- -->' : tg) + (found[tg] ? ` · ${found[tg]}` : ''))),
      h('button.as-chip.as-ctx-add', { onclick: async () => {
        const tg = String(await dialog({ title: '加标签', input: { placeholder: '标签名' } }) || '').trim().replace(/^<\/?|>$/g, '').toLowerCase(); if (!tg) return;
        chat.keep = chat.keep.filter(x => x !== tg); chat.drop = chat.drop.filter(x => x !== tg); chat[k].push(tg); keepSave();
      } }, icon('plus', 12, 2.4), '加标签')));
    paint();
    return group(withInfo('正文筛选', '正文里有的段落用 <标签> 包着。「要」里的标签，里面的字拿去整理；「不要」里的整段去掉；没被标签包着的正文照常整理。点一下标签换到另一排。'),
      [h('div.as-field', h('span.as-field__label', '要'), rows.keep), h('div.as-field', h('span.as-field__label', '不要'), rows.drop), item({ title: '预览', chevron: true, onClick: () => preview(msgs) })]);
  };
  // 一层层看筛完、要拿去整理的样子
  const preview = msgs => {
    const list = msgs.map((m, i) => i).filter(i => i >= chat.from && i <= chat.to && msgs[i].mes && (chat.withUser || !msgs[i].is_user));
    if (!list.length) { toast('这几层没有内容'); return; }
    let k = 0;
    const pre = h('pre.as-mem-pv'), at = h('span.as-mem-sum');
    const show = () => { const i = list[k]; pre.textContent = M.floorsText(msgs, { ...chat, from: i, to: i })[0] || `【第 ${i} 层】\n（筛完是空的）`; at.textContent = `${k + 1} / ${list.length}`; pre.scrollTop = 0; };
    sheet({ title: '预览', content: [pre, h('div.as-mem-pvbar', btn('上一层', 'secondary', () => { if (k > 0) { k--; show(); } }), at, btn('下一层', 'secondary', () => { if (k < list.length - 1) { k++; show(); } }))] });
    show();
  };

  async function paintPick() {
    const nb = [];
    if (src === 'book') {
      nb.push(group('', [item({ title: '世界书', value: book.name || '选一本', chevron: true, onClick: async () => {
        const v = await actionSheet('从哪本世界书整理', worldNames().map(n => ({ value: n, label: n, active: n === book.name })));
        if (v) { book.name = v; book.entries = []; book.off.clear(); paintPick(); }
      } })]));
      if (book.name && !book.entries.length) {
        try { book.entries = (await loadBook(book.name, true)).filter(e => e.content.trim()); } catch (e) { toast('读不到这本世界书'); }
      }
      if (book.entries.length) nb.push(group('要整理的条目', entryRows(book.entries, book.off)));
    } else if (src === 'file') {
      nb.push(group('', [item({ title: withInfo('文件', '能导入三种：酒馆导出的聊天记录（.jsonl）、酒馆导出的世界书（.json）、纯文字（.txt）。'), value: file.name || '选一个', chevron: true, onClick: async () => {
        const f = await pickFile('.json,.jsonl,.txt,text/plain,application/json'); if (!f) return;
        try { file.got = await M.readFile(f); file.name = f.name; file.off.clear(); paintPick(); } catch (e) { toast('这个文件读不出来'); }
      } })]));
      const g = file.got;
      if (g && g.msgs) nb.push(...floors(g.msgs));
      if (g && g.entries) nb.push(group('要整理的条目', entryRows(g.entries, file.off)));
    } else if (M.chatMsgs().length) nb.push(...floors(M.chatMsgs())); else nb.push(empty('现在没有打开酒馆的聊天'));
    pick.replaceChildren(...nb.filter(Boolean)); count();
  }
  // 下面那一块：开始 / 正在整理第几批（取消）/ 上次没跑完（接着整理、放弃）
  async function paintRun() {
    const j = M.running(), left = j ? null : await M.leftover();
    if (j) act.replaceChildren(h('div.as-mem-sum', `正在整理「${j.label}」第 ${j.done + 1}/${j.list.length} 批…`), h('div.as-prompt-bar', btn('取消', 'secondary', () => M.cancelJob())));
    else if (left) act.replaceChildren(h('div.as-mem-sum', `「${left.label}」还剩 ${left.list.length - left.done} 批没整理`),
      h('div.as-prompt-bar', btn('放弃', 'secondary', async () => { await M.dropJob(); paintRun(); }), btn('接着整理', 'primary', () => go(left.label, left.list, left.done))));
    else act.replaceChildren(h('div.as-prompt-bar', btn('开始整理', 'primary', () => {
      const ps = parts(); if (!ps.length) { toast('没有要整理的内容'); return; }
      go(src === 'book' ? book.name : src === 'file' ? file.name : '当前聊天', M.batches(ps));
    })));
  }
  function go(label, list, done) {
    toast(`开始整理，一共 ${list.length} 批`);
    M.startJob(label, list, done).catch(e => toast(e.message));
  }
  const off = M.onJob(() => paintRun());
  p.el._onLeave = off;
  p.body.append(group('', [h('div.as-mem-src', segmented([['book', '世界书'], ['file', '文件'], ['chat', '当前聊天']], src, v => { src = v; paintPick(); }))]), pick, sum, act);
  paintPick();
  nav.push(p.el);
}

/* ---------- 设置 ---------- */
function openSet() {
  const p = page({ app: 'memory', id: 'memory-set', title: '设置', back: true });
  const label = () => { const v = S().conn.text; return v === 'follow' ? `跟随聊天线（${connLabel(resolveConn('text', 'memory'))}）` : connLabel(resolveConn('text', 'memory')); };
  const connItem = item({ title: '整理用的接口', value: label(), chevron: true, onClick: async () => {
    const v = await actionSheet('整理用的接口', [{ value: 'follow', label: '跟随聊天线', active: S().conn.text === 'follow' },
      ...state.connections.text.map(c => ({ value: c.id, label: c.name, active: S().conn.text === c.id }))]);
    if (!v) return; S().conn.text = v; commit('apps'); connItem.querySelector('.as-list-item__value').textContent = label();
  } });
  p.body.append(group('', [connItem, toggleItem({ title: '聊天时带上记忆' }, S().on, on => { S().on = on; commit('apps'); })]));
  nav.push(p.el);
}
