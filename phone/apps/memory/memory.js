// 岁岁砂：TA 们记得的事（方案见 docs/pages-memory.md）。
// 首页是一张画、三页：时间（沙漏，往下漏的那道沙是时间轴）/ 关系（轨道，谁都能当中心）/ 地点（迷雾地图，大地方里套小地点）。
// 关系那页顶上有一排名字：点谁（或把星拖到正中），谁就是中心。时间和地点对谁都一样，不分人看（作者定的）。
// 右上角设置：人物、记录、导入整理、回想、标签、清空。整理在核心 core/memory.js 里跑，退出这页也接着跑；同一时间只跑一个。
import { h, pickFile, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, toggleItem, switchEl, segmented, input, textarea, field, btn, icon, actionSheet, dialog, toast, empty, navBtn, sheet, withInfo, waiting, sortable } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { worldNames, ctx } from '../../core/bridge.js';
import { loadBook, C as ctxCfg } from '../../core/context.js';
import { tagRows } from '../settings/context.js';
import { connLabel, resolveConn } from '../../core/api.js';
import { myName } from '../../core/promptstore.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';
import * as M from '../../core/memory.js';
import { art } from './art.js';

const S = () => state.apps.memory;
const ymd = at => at ? at.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '不知道哪天';
const dot = at => (at || '').split('-').map(Number).join('·');   // 2026-05-03 → 2026·5·3（画下面那几页用，窄）
const split = s => String(s).split(/[、,，]/).map(t => t.trim()).filter(Boolean);
let refresh = () => {};   // 抽屉里改了东西：让首页照新的重画

// 整理完了不管在哪一页都说一声（每隔几轮自动整理的只进日志，不打扰）
// 整理的时候一直挂着一条提示（作者要的）：第几批、这一批等了多久、收到多少字、已经记下几件，带「取消」；每秒换一次字
let tick = 0;
const busyTip = () => { const j = M.running(); if (!j) return; const s = Math.round((Date.now() - (j.t0 || Date.now())) / 1000);
  toast(`正在整理 ${j.done + 1}/${j.list.length} 批 · ${s} 秒${j.got ? ` · 收到 ${j.got} 字` : ''}${j.added ? ` · 已记下 ${j.added} 件` : ''}`, { label: '取消', fn: () => M.cancelJob(), wait: true }); };
M.onJob((how, j) => {
  if (j.label === '自动整理') { if (how === 'done' && j.added) log('info', '岁岁砂', `自动整理了一次，新记下 ${j.added} 件事`); if (how === 'fail') log('warn', '岁岁砂', '这次没自动整理成，下次一起补：' + j.error); return; }
  if (how === 'start') { clearInterval(tick); tick = setInterval(busyTip, 1000); busyTip(); }
  if (how === 'done' || how === 'fail') clearInterval(tick);
  if (how === 'done') toast(`整理完了，新记下 ${j.added} 件事`);
  if (how === 'fail') toast(j.error === '已中止' ? '已停下，可以接着整理' : '整理失败：' + j.error);
  if (how !== 'step') refresh();
});

/** 向量模型换了：问一次要不要重新算（同一个模型只问一次） */
let asked = '';
async function vecCheck() {
  const v = await M.vecState();
  if (!v.stale || asked === v.conn.model) return;
  asked = v.conn.model;
  if (await dialog({ title: '向量模型换了', text: '以前算好的和新模型对不上，要重新算一遍才能按意思找，算好之前先按词找。记下的事不会丢。', confirm: '重新算', cancel: '先不算' })) vecRun();
}
async function vecRun(tell) {
  try { const n = await waiting('正在算向量…', sig => M.vecFill(sig, tell)); if (n != null) toast(n ? `算好了 ${n} 件` : '都算过了'); }
  catch (e) { log('error', '岁岁砂', '向量没算成：' + e.message); toast('没算成：' + e.message); }
}

export function open() {
  const p = page({ app: 'memory', id: 'memory-main', title: '岁岁砂', back: true, cls: 'as-ss', right: [navBtn('gear', '设置', openSet)] });
  const bar = h('div.as-ss-who.off', { dataset: { noSwipe: '' } }), stage = h('div.as-ss-stage'), axis = h('div.as-ss-axis'), paper = h('aside.as-ss-paper', { 'aria-live': 'polite' });
  const tabs = h('nav.as-ss-tabs', ['时间', '关系', '地点'].map((t, i) => h('button' + (i ? '' : '.on'), { onclick: () => go(i) }, t)));
  p.body.append(bar, stage, axis); p.el.append(tabs, paper);
  let d = null, names = [], link = [], ctr = 0, tab = 0, seen = '', opened = null;
  const shut = () => { if (!paper.classList.contains('on')) return false; paper.classList.remove('on'); A.mark(); return true; };
  const A = art(stage, { blank: shut, rel: openRel, center: i => setCtr(i), place: openPlace,
    move: async (n, x, y) => { let o = d.places.find(q => q.name === n); if (!o) d.places.push(o = { name: n, area: '', intro: '' }); o.x = x; o.y = y; await M.save(); seen = sig(); } });
  const sig = () => M.ver + ':' + state.contacts.length;
  // 一页装得下就不让拉动（作者：没有别的内容，拉得动很怪）；事多了、点开一件变长了才能滑
  // 关系、地点下面没有东西；时间那页还没记下事时也一样：都定住（小屏上画加页签会比屏幕高一点，也不让拉）
  const fit = () => { p.body.style.overflowY = tab || !d || !d.ev.length || p.body.scrollHeight <= p.body.clientHeight + 1 ? 'hidden' : ''; if (p.body.style.overflowY) p.body.scrollTop = 0; };

  // 底下那张纸：地点和人共用
  const show = (title, small, lead, intro, rows, none, acts) => {
    paper.replaceChildren(h('button.x', { onclick: shut }, '收起'), h('h4', title, small && h('small', small)), lead && h('p.lead', lead), intro && h('p', intro),
      h('ol', rows.length ? rows : h('li.none', none)), h('div.as-ss-acts', acts));
    paper.scrollTop = 0; paper.classList.add('on');
  };
  const li = (t, title, quote, small, onclick) => h('li' + (onclick ? '.tap' : ''), { onclick }, h('time', t), h('span', h('b', title, small && h('small', small)), quote && h('q', quote)));
  // 人：正中这个人和 TA 的关系是怎么变过来的、每一段怎么看 TA；下面是正中这个人知道的关于 TA 的事
  function openRel(i) {
    const lk = link[ctr][i], who = names[i], cs = ctr ? new Set([names[ctr]]) : new Set([names[0], '我']);
    const facts = d.facts.filter(f => (i ? f.about === who : M.isMe(f.about)) && M.knownOf(f, cs) != null);
    show(who, lk.kind, `${names[ctr]}眼里的${who}`, '', [...lk.st.map((s, k) => li(dot(s[0]), s[1], lk.q[k])), ...facts.map(f => li('了解', M.knownOf(f, cs), '', f.know.join('、') + '知道', () => editFact(f)))], '',
      [btn('改', 'secondary', () => editRel(lk.r)), btn('加一条了解', 'secondary', () => editFact(null, who))]);
  }
  // 地点：一句介绍、在这里发生过的事（大地方连里面小地点的一起）
  function openPlace(n, subs = []) {
    const rec = d.places.find(q => q.name === n), l = d.ev.filter(e => !e.off && (e.place === n || subs.includes(e.place))).reverse();
    show(n, l.length ? l.length + ' 件' : '', rec && rec.area ? '在' + rec.area : '', rec && rec.intro, l.map(e => li(dot(e.at), e.title, '', [e.part, e.place !== n && e.place].filter(Boolean).join(' · '), () => editEvent(e))), '还没有记下在这里的事',
      [btn('改', 'secondary', () => editPlace(n))]);
  }

  /* 时间那页：最上面是日子（快到的在前）和没完的事，下面按年排所有事，新的在上（刚漏下来的沙）。点一件展开；同一个小标签的另外几件一起亮，用一根蓝线串起来 */
  const kin = e => e.tags.filter(t => t !== '手机');
  function arcs() {
    axis.querySelectorAll('.arc').forEach(a => a.remove());
    const l = opened ? [...axis.querySelectorAll('.ev.open, .ev.kin')] : [];
    if (l.length > 1) axis.append(h('div.arc', { style: { top: l[0].offsetTop + 22 + 'px', height: l[l.length - 1].offsetTop - l[0].offsetTop + 'px' } }));
  }
  function toggle(b, e) {
    axis.querySelectorAll('.ev.open, .ev.kin').forEach(x => x.classList.remove('open', 'kin'));
    opened = opened === e ? null : e;
    if (opened) { b.classList.add('open'); const t = kin(e); axis.querySelectorAll('.ev').forEach(x => { if (x !== b && x._e && kin(x._e).some(k => t.includes(k))) x.classList.add('kin'); }); }
    arcs(); fit();
  }
  const row = (cls, t, title, small, onclick, more) => h('div.ev' + cls, { role: 'button', tabindex: 0, onclick }, h('time', t), h('i'), h('b', title), h('small', small), more);
  function fillAxis() {
    const now = time.isStory() ? time.story().date : new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), rows = [];
    const left = x => { const [mm, dd] = x.md.split('-').map(Number); let t = new Date(t0.getFullYear(), mm - 1, dd); if (t < t0) t = new Date(t0.getFullYear() + 1, mm - 1, dd); return Math.round((t - t0) / 864e5); };
    rows.push(h('div.yr.zh', h('em', '日子'), h('button', { 'aria-label': '加一个日子', onclick: () => editDay(null) }, icon('plus', 14, 2))),
      ...d.days.map(x => [x, left(x)]).sort((a, b) => a[1] - b[1]).map(([x, n]) => row('.day', n ? `${n} 天后` : '今天', x.what, `${x.kind || '其他'} · ${x.date ? ymd(x.date) : x.md.replace(/^0?(\d+)-0?(\d+)$/, '每年$1月$2日')}`, () => editDay(x))));
    const todo = d.todo.filter(t => !t.done);
    if (todo.length) rows.push(h('div.yr.zh', h('em', '没完的事')), ...todo.map(t => row('.todo', '', t.text, t.who, async () => {
      const v = await actionSheet(t.text, [{ value: 'done', label: '做完了' }, { value: 'del', label: '删除', danger: true }]);
      if (v === 'done') t.done = true; else if (v === 'del') d.todo.splice(d.todo.indexOf(t), 1); else return;
      await M.save(); draw();
    })));
    let yr = null;
    for (const e of [...d.ev].reverse()) {
      if (e.off) continue;
      const y = e.at ? e.at.slice(0, 4) : '不知道哪年'; if (y !== yr) rows.push(h('div.yr' + (e.at ? '' : '.zh'), h('em', yr = y)));
      const b = row((e.pin ? '.pin' : '') + (e.mark === 'hi' || e.big.includes('重要') ? '.hi' : '') + (e.mark === 'no' ? '.noise' : ''), e.at ? dot(e.at.slice(5)) : '', e.title, [e.part, e.place].filter(Boolean).join(' · '), () => toggle(b, e),
        h('p', e.text, e.quote && h('q', '「' + e.quote + '」'), h('span.meta', [M.knows(e).join('、') + '知道', ...e.big, ...kin(e)].join(' · ')), h('button', { onclick: ev => { ev.stopPropagation(); editEvent(e); } }, '改')));
      b.style.setProperty('--r', 3 + e.imp * 1.4 + 'px'); b._e = e;
      rows.push(b);
    }
    if (!d.ev.length) rows.push(h('div.none', '还没有记下的事', btn('去整理', 'secondary', openSort)));
    opened = null; axis.replaceChildren(...rows); fit();
  }
  function setCtr(i, fx = true) {
    ctr = i; shut(); A.center(i);
    [...bar.children].forEach((b, k) => { b.classList.toggle('on', k === i); if (k === i && fx) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  }
  function go(i) {
    if (i === tab) return;
    tab = i; shut(); A.tab(i); [...tabs.children].forEach((b, k) => b.classList.toggle('on', k === i)); axis.classList.toggle('off', i > 0); bar.classList.toggle('off', i !== 1); p.body.scrollTo({ top: 0, behavior: 'smooth' });
    if (!i) arcs();
    setTimeout(fit, 1400);   // 画换成别的高度要 1.3 秒
  }

  async function draw() {
    A.resume();
    d = await M.load(); if (sig() === seen) return;   // 返回这页时数据没变就一点都不动
    seen = sig(); shut();
    const was = names[ctr]; names = [myName(), ...M.cast(d).filter(x => x[1]).map(x => x[0])];
    const idx = n => M.isMe(n) ? 0 : names.indexOf(n);
    // 关系网：link[a][b] = a 这边看 b。st 第 0 条是现在，后面是以前的；第三格是离多远（5 - 亲近度）
    link = names.map(() => ({}));
    for (const r of d.rel) {
      const i = idx(r.a), j = idx(r.b); if (i < 0 || j < 0 || i === j) continue;
      const st = [{ ...r, title: r.kind + (r.now ? '，' + r.now : '') }, ...[...r.hist].reverse().map(x => ({ ...x, title: x.kind }))];
      const mk = v => ({ kind: r.kind, r, st: st.map(x => [x.since || '', x.title, 5 - M.lvOf(x)]), q: st.map(x => x[v] || '') });
      link[i][j] = mk('va'); link[j][i] = mk('vb');
    }
    // 地图：有「归哪」的小地点收在大地方里，别的单独放；没拖过的先按一圈圈摆开
    const pl = new Map(d.places.map(q => [q.name, q])); for (const e of d.ev) if (e.place && !pl.has(e.place)) pl.set(e.place, { name: e.place });
    const big = [...new Set([...pl.values()].map(q => q.area).filter(Boolean))], spots = [...big, ...[...pl.keys()].filter(n => !pl.get(n).area && !big.includes(n))];
    const at = n => { const q = pl.get(n) || {}, k = spots.indexOf(n), a = k * 2.4, r = Math.min(150, 60 + k * 18); return q.x ? { x: q.x, y: q.y } : { x: Math.round(200 + Math.cos(a) * r), y: Math.round(250 + Math.sin(a) * r * 1.15) }; };
    const last = [...d.ev].reverse().find(e => e.place);
    A.set({ names, link, here: (time.isStory() && time.story().place) || (last ? last.place : ''),
      areas: big.map(n => ({ name: n, ...at(n), list: [...pl.values()].filter(q => q.area === n).map(q => q.name) })), lone: spots.slice(big.length).map(n => ({ name: n, ...at(n) })) });
    bar.replaceChildren(...names.map((n, i) => h('button', { onclick: () => setCtr(i) }, n)), h('button.more', { onclick: openPeople }, '更多'));
    fillAxis(); setCtr(Math.max(0, names.indexOf(was)), false);
  }
  refresh = draw;
  draw().then(vecCheck); p.el._onShow = draw;
  return p.el;
}

/* ---------- 抽屉：改关系、日子、了解、地点 ---------- */
async function editRel(r) {
  const d = await M.load(), x = { kind: r.kind, since: r.since, now: r.now, lv: M.lvOf(r), va: r.va || '', vb: r.vb || '' };
  const s = sheet({ title: `${r.a} 和 ${r.b}`, content: [
    segmented(M.KINDS.map(k => [k, k]), x.kind, v => { x.kind = v; }),
    field('从什么时候起', input({ value: x.since, onInput: v => { x.since = v.trim(); } })),
    field('现在怎样', input({ value: x.now, onInput: v => { x.now = v.trim(); } })),
    field(withInfo('亲近度', '5 最亲。关系页上越亲的离得越近。'), segmented([0, 1, 2, 3, 4, 5].map(n => [n, String(n)]), x.lv, v => { x.lv = v; })),
    field(`${r.a}眼里的${r.b}`, textarea({ value: x.va, rows: 2, onInput: v => { x.va = v.trim(); } })),
    field(`${r.b}眼里的${r.a}`, textarea({ value: x.vb, rows: 2, onInput: v => { x.vb = v.trim(); } })),
    h('div.as-mem-acts', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这段关系？', confirm: '删除', danger: true }))) return; d.rel.splice(d.rel.indexOf(r), 1); await M.save(); s.close(); refresh(); })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      if (x.kind !== r.kind) r.hist.push({ kind: r.kind, since: r.since, lv: r.lv, va: r.va, vb: r.vb });
      Object.assign(r, x); await M.save(); s.close(); refresh();
    })),
  ] });
}
// 日子：类型、日期（年-月-日，不知道年份就写月-日）、是什么日子、和谁有关；照「日子」那一行的格式读，和 AI 记的一样
async function editDay(o) {
  const d = await M.load(), x = o ? { kind: o.kind || '其他', at: o.date || o.md, what: o.what, who: o.who.join('、') } : { kind: '生日', at: '', what: '', who: '' };
  const s = sheet({ title: o ? o.what : '加一个日子', content: [
    segmented(M.DAY_KINDS.map(k => [k, k]), x.kind, v => { x.kind = v; }),
    field('是什么日子', input({ value: x.what, onInput: v => { x.what = v.trim(); } })),
    field('日期', input({ value: x.at, placeholder: '年-月-日', onInput: v => { x.at = v.trim(); } })),
    field('和谁有关', input({ value: x.who, onInput: v => { x.who = v; } })),
    o ? h('div.as-mem-acts', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这个日子？', confirm: '删除', danger: true }))) return; d.days.splice(d.days.indexOf(o), 1); await M.save(); s.close(); refresh(); })) : null,
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      const y = M.parse(`日子：${x.kind}｜${x.at}｜${x.what}｜${x.who}`).days[0];
      if (!y) { toast(x.what ? '日期写成 年-月-日 或 月-日' : '写上是什么日子'); return; }
      if (o) Object.assign(o, y); else d.days.push(y);
      await M.save(); s.close(); refresh();
    })),
  ].filter(Boolean) });
}
// 了解：关于谁、是什么、谁知道（每个人知道的不一样）
async function editFact(o, about = '') {
  const d = await M.load(), x = o ? { about: o.about, text: o.text, know: o.know.join('、') } : { about, text: '', know: '' };
  const s = sheet({ title: o ? '这一条' : '加一条', content: [
    field('关于谁', input({ value: x.about, onInput: v => { x.about = v.trim(); } })),
    field('是什么', textarea({ value: x.text, rows: 2, onInput: v => { x.text = v.trim(); } })),
    field('谁知道', input({ value: x.know, onInput: v => { x.know = v; } })),
    o ? h('div.as-mem-acts', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这一条？', confirm: '删除', danger: true }))) return; d.facts.splice(d.facts.indexOf(o), 1); await M.save(); s.close(); refresh(); })) : null,
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      if (!x.about || !x.text) { toast(x.about ? '写上是什么' : '写上关于谁'); return; }
      if (o) Object.assign(o, { about: x.about, text: x.text, know: split(x.know) }); else d.facts.push({ id: uid('f'), about: x.about, text: x.text, know: split(x.know), hist: [] });
      await M.save(); s.close(); refresh();
    })),
  ].filter(Boolean) });
}
async function editPlace(n) {
  const d = await M.load(), o = d.places.find(q => q.name === n), x = { area: (o && o.area) || '', intro: (o && o.intro) || '' };
  const s = sheet({ title: n, content: [
    field(withInfo('归哪个大地方', '写了就收进那个大地方里：地图上先看到大地方，点进去才看到它。不属于哪里就空着。'), input({ value: x.area, onInput: v => { x.area = v.trim(); } })),
    field('介绍', textarea({ value: x.intro, rows: 2, onInput: v => { x.intro = v.trim(); } })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      if (x.area === n) x.area = '';
      if (o) Object.assign(o, x); else d.places.push({ name: n, ...x });
      await M.save(); s.close(); refresh();
    })),
  ] });
}

/* ---------- 改一件事 ---------- */
async function editEvent(e) {
  const d = await M.load(), x = { ...e, who: e.who.join('、'), tags: e.tags.join('、'), know: (e.know || []).join('、'), big: [...e.big] };
  const p = page({ app: 'memory', id: 'memory-edit', title: '这件事', back: true });
  const flag = (k, on, off) => { const b = btn(x[k] ? on : off, 'secondary', () => { x[k] = !x[k]; b.textContent = x[k] ? on : off; }); return b; };
  p.body.append(
    group('', [field('标题', input({ value: x.title, onInput: v => { x.title = v.trim(); } })),
      field('日期', input({ type: 'date', value: x.at, onInput: v => { x.at = v; x.guess = false; } })),
      field('时间', input({ value: x.part, onInput: v => { x.part = v.trim(); } })),
      field('地点', input({ value: x.place, onInput: v => { x.place = v.trim(); } })),
      field('经过', textarea({ value: x.text, rows: 3, onInput: v => { x.text = v.trim(); } })),
      field('在场的人', input({ value: x.who, onInput: v => { x.who = v; } })),
      field('后来听说的人', input({ value: x.know, onInput: v => { x.know = v; } })),
      field('影响', input({ value: x.after || '', onInput: v => { x.after = v.trim(); } })),
      field('原话', textarea({ value: x.quote || '', rows: 2, onInput: v => { x.quote = v.trim(); } })),
      field('原文', textarea({ value: x.orig || '', rows: 4, onInput: v => { x.orig = v.trim(); } }))]),
    group(withInfo('标签', '大标签点一下选上或去掉，「重要」的事更容易被想起。小标签是这件事属于哪一类具体的事（拍大头贴、喝酒），用、隔开；同一个小标签的事，想起一件会连着想起另外几件。'), [
      h('div.as-mem-imp', h('div.as-chips', M.bigs().map(t => { const c = h('button.as-chip' + (x.big.includes(t) ? '.is-active' : ''), { onclick: () => { x.big = x.big.includes(t) ? x.big.filter(q => q !== t) : [...x.big, t]; c.classList.toggle('is-active'); } }, t); return c; }))),
      field('小标签', input({ value: x.tags, onInput: v => { x.tags = v; } }))]),
    group(withInfo('想起', '高光：聊到沾边的事时更容易想起来。噪声：留着，但不会自己想起来，只记得有过这件事。'), [h('div.as-mem-imp', segmented([['', '一般'], ['hi', '高光'], ['no', '噪声']], x.mark || '', v => { x.mark = v; }))]),
    h('div.as-mem-acts', flag('pin', '取消钉住', '钉住'), flag('off', '恢复', '撤回'),
      btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这件事？', confirm: '删除', danger: true }))) return; d.ev.splice(d.ev.indexOf(e), 1); await M.save(); nav.pop(); })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', async () => {
      if (!x.title) { toast('标题不能空着'); return; }
      Object.assign(e, { ...x, who: split(x.who), tags: split(x.tags), know: split(x.know), imp: x.big.includes('重要') ? Math.max(4, x.imp) : Math.min(3, x.imp) });
      d.ev.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
      M.vecDrop(e); await M.save(); nav.pop();
    })));
  nav.push(p.el);
}

/* ---------- 刚才想起了什么：最近几次聊天时 TA 想起了哪几件、为什么；想错了点「不该想起」，那几个词以后不会再让 TA 想起这件 ---------- */
function openPeek() {
  const p = page({ app: 'memory', id: 'memory-peek', title: '刚才想起了什么', back: true }), noBox = h('div');
  const row = (prev, [e, why, words]) => item({ title: e.title, sub: [why, prev && prev.items.some(x => x[0] === e) && '上次也想起了'].filter(Boolean).join(' · '), chevron: true, onClick: async () => {
    const v = await actionSheet(e.title, [{ value: 'see', label: '看这件事' }, ...(words && words.length ? [{ value: 'no', label: '不该想起', danger: true }] : [])]);
    if (v === 'see') editEvent(e);
    if (v !== 'no') return;
    e.no = [...new Set([...(e.no || []), ...words])]; await M.save(); toast('这几个词以后不会再让 TA 想起这件事'); paintNo();
  } });
  async function paintNo() {
    const l = (await M.load()).ev.filter(e => e.no && e.no.length);
    noBox.replaceChildren(...(l.length ? [group(withInfo('不该想起的', '右边这几个词以后不会再让 TA 想起这件事。点一下能改回来。'), l.map(e => item({ title: e.title, sub: e.no.join('、'), onClick: async () => {
      if (await actionSheet(e.title, [{ value: 'undo', label: '改回来' }]) !== 'undo') return;
      delete e.no; await M.save(); paintNo();
    } })))] : []));
  }
  p.body.append(...(M.peeks.length ? M.peeks.map((r, i) => group(r.who.join('、'), [item({ title: r.said || '（还没聊）', sub: `聊到这句时 · ${r.how} · 每轮都带的 ${r.size[0]} 字，这会儿想起的 ${r.size[1]} 字` }),
    ...(r.items.length ? r.items.map(x => row(M.peeks[i + 1], x)) : [item({ title: '什么都没想起' })])])) : [empty('还没有想起什么')]), noBox);
  paintNo();
  nav.push(p.el);
}

/* ---------- 等你看：自动记下的先放这里，点「留下」TA 才会记得 ---------- */
async function openWait() {
  const p = page({ app: 'memory', id: 'memory-wait', title: '等你看', back: true }), d = await M.load(), none = empty('都看完了');
  const from = s => s.startsWith('story:') ? `正文第 ${s.slice(6)} 层` : '手机聊天';
  const what = x => [...x.ev.map(e => [e.title, `${ymd(e.at)} · ${e.text}`]), ...(x.places || []).map(q => [q.name, q.intro || '新去的地方']), ...x.rel.map(r => [`${r.a}和${r.b}：${r.kind}`, r.now]), ...x.facts.map(f => [`${f.about}：${f.text}`, '了解']),
    ...x.days.map(y => [y.what, y.kind]), ...x.todo.map(t => [t.text, '没完的事']), ...x.done.map(t => [t.text, '做完了']), ...x.ppl.map(q => [q.name, q.who || '新出场的人'])];
  none.hidden = d.wait.length > 0;
  p.body.append(...d.wait.map(w => {
    const el = h('div.as-mem-wait', group(from(w.src), what(w.x).map(([title, sub]) => item({ title, sub }))), h('div.as-mem-acts', btn('不要', 'secondary', () => done(false)), btn('留下', 'primary', () => done(true))));
    const done = async ok => { await M.settle(w, ok); el.remove(); none.hidden = d.wait.length > 0; };
    return el;
  }), none);
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
  const chat = { withUser: true, from: 0, to: Infinity, keep: (S().keep || ctxCfg().keep).slice(), drop: (S().drop || ctxCfg().drop || []).slice(), keepOff: (S().keepOff || ctxCfg().keepOff || []).slice() };
  // 每个条目点一下展开看内容（固定大小的框里上下滑），再点收起；右边的开关管整不整理它
  const entryRows = (list, off) => list.map((e, i) => h('details.as-ctx-part.as-mem-entry', h('summary', h('span', e.title, h('small', ` · ${e.content.length} 字`)), switchEl(!off.has(i), on => { on ? off.delete(i) : off.add(i); count(); }, e.title)),
    h('pre.as-ctx-preview', e.content)));
  const parts = () => {
    if (src === 'book') return book.entries.filter((e, i) => !book.off.has(i)).map(e => e.content);
    if (src === 'chat') return M.floorsText(M.chatMsgs(), chat);
    const g = file.got; if (!g) return [];
    return g.msgs ? M.floorsText(g.msgs, chat) : g.entries ? g.entries.filter((e, i) => !file.off.has(i)).map(e => e.content) : g.text.split(/\n{2,}/);
  };
  let fresh = () => {};   // 楼层、标签一改，下面的预览和层数跟着换
  const count = () => { const ps = parts(), n = ps.reduce((a, s) => a + s.length, 0); sum.textContent = n ? `约 ${n} 字 · 分 ${M.batches(ps).length} 批` : ''; fresh(); paintRun(); };
  // 正文楼层：读哪几层、包不包含你发的；正文筛选和「设置 → 上下文与世界书」是同一套（tagRows）；下面一块能一层层预览筛完的样子
  const floors = msgs => {
    const span = () => msgs.map((m, i) => i).filter(i => i >= chat.from && i <= chat.to && msgs[i].mes && (chat.withUser || !msgs[i].is_user));
    const n = h('span.as-field__hint');
    const [keep, drop] = tagRows(chat, () => msgs.map(m => ({ text: String(m.mes || '') })), () => { S().keep = chat.keep; S().drop = chat.drop; S().keepOff = chat.keepOff; commit('apps'); }, () => count(), ['要', '不要']);
    // 预览：固定大小的框，左右换一层，框里上下滑
    let k = 0;
    const pre = h('pre.as-ctx-preview.as-mem-pv'), at = h('span.as-mem-sum');
    const show = () => {
      const l = span(); n.textContent = `要整理的：${l.length} 层`;
      if (!l.length) { pre.textContent = '这几层没有内容'; at.textContent = ''; return; }
      k = Math.min(k, l.length - 1); const i = l[k];
      pre.textContent = M.floorsText(msgs, { ...chat, from: i, to: i })[0] || `【第 ${i} 层】\n（筛完是空的）`; at.textContent = `${k + 1} / ${l.length}`; pre.scrollTop = 0;
    };
    const step = d => () => { const l = span(); if (k + d >= 0 && k + d < l.length) { k += d; show(); } };
    fresh = show;
    return [group('楼层', [toggleItem({ title: '包含你发的楼层' }, chat.withUser, on => { chat.withUser = on; count(); }),
      field(`从第几层到第几层（一共 ${msgs.length} 层，从 0 数）`, h('div.as-mem-range', input({ type: 'number', value: String(chat.from), onInput: v => { chat.from = Math.max(0, parseInt(v, 10) || 0); count(); } }),
        h('span', '到'), input({ type: 'number', value: String(Math.min(chat.to, msgs.length - 1)), onInput: v => { chat.to = v === '' ? Infinity : parseInt(v, 10); count(); } })), n)]),
      group(withInfo('正文筛选', '正文里有的段落用 <标签> 包着。「要」里的标签，里面的字拿去整理（点一下能暂时关掉）；里面不想要的，放进「不要」。两边都没放的标签，在「要」的标签外面就整段去掉。没被标签包着的正文照常整理。'), [keep, drop]),
      group('预览', [h('div.as-field', pre, h('div.as-mem-pvbar', btn('上一层', 'secondary', step(-1)), at, btn('下一层', 'secondary', step(1))))])];
  };

  async function paintPick() {
    const nb = []; fresh = () => {};
    if (src === 'book') {
      nb.push(group('', [item({ title: '世界书', value: book.name || '选一本', chevron: true, onClick: async () => {
        const v = await actionSheet('从哪本世界书整理', worldNames().map(n => ({ value: n, label: n, active: n === book.name })));
        if (v) { book.name = v; book.entries = []; book.off.clear(); paintPick(); }
      } })]));
      if (book.name && !book.entries.length) {
        try { book.entries = (await loadBook(book.name, true)).filter(e => e.content.trim()); } catch (e) { toast('读不到这本世界书'); }
      }
      if (book.entries.length) nb.push(group('要整理的条目', [h('div.as-field', entryRows(book.entries, book.off))]));
    } else if (src === 'file') {
      nb.push(group('', [item({ title: withInfo('文件', '能导入三种：酒馆导出的聊天记录（.jsonl）、酒馆导出的世界书（.json）、纯文字（.txt）。'), value: file.name || '选一个', chevron: true, onClick: async () => {
        const f = await pickFile('.json,.jsonl,.txt,text/plain,application/json'); if (!f) return;
        try { file.got = await M.readFile(f); file.name = f.name; file.off.clear(); paintPick(); } catch (e) { toast('这个文件读不出来'); }
      } })]));
      const g = file.got;
      if (g && g.msgs) nb.push(...floors(g.msgs));
      if (g && g.entries) nb.push(group('要整理的条目', [h('div.as-field', entryRows(g.entries, file.off))]));
    } else if (M.chatMsgs().length) nb.push(...floors(M.chatMsgs())); else nb.push(empty('现在没有打开酒馆的聊天'));
    pick.replaceChildren(...nb.filter(Boolean)); count();
  }
  // 下面那一块：开始 / 正在整理第几批（取消）/ 上次没跑完（接着整理、放弃）
  async function paintRun() {
    const j = M.running(), left = j ? null : await M.leftover();
    if (j) act.replaceChildren(h('div.as-mem-sum', `正在整理「${j.label}」第 ${j.done + 1}/${j.list.length} 批…`), h('div.as-prompt-bar', btn('取消', 'secondary', () => M.cancelJob())));
    else if (left) act.replaceChildren(h('div.as-mem-sum', `「${left.label}」还剩 ${left.list.length - left.done} 批没整理${left.at ? '（这一批写到一半）' : ''}`),
      h('div.as-prompt-bar', btn('放弃', 'secondary', async () => { await M.dropJob(); paintRun(); }), btn('接着整理', 'primary', () => go(left.label, left.list, left.done, left.at))));
    else act.replaceChildren(h('div.as-prompt-bar', btn('开始整理', 'primary', () => {
      const ps = parts(); if (!ps.length) { toast('没有要整理的内容'); return; }
      go(src === 'book' ? book.name : src === 'file' ? file.name : '当前聊天', M.batches(ps));
    })));
  }
  function go(label, list, done, at) {
    M.startJob(label, list, done, at).catch(e => toast(e.message));
  }
  const off = M.onJob(() => paintRun());
  p.el._onLeave = off;
  p.body.append(group('', [h('div.as-mem-src', segmented([['book', '世界书'], ['file', '文件'], ['chat', '当前聊天']], src, v => { src = v; paintPick(); }))]), pick, sum, act);
  paintPick();
  nav.push(p.el);
}

/* ---------- 设置：查看、人物和标签、记录、导入整理、回想、清空 ---------- */
async function openSet() {
  const p = page({ app: 'memory', id: 'memory-set', title: '设置', back: true }), m = S(), d = await M.load();
  const save = () => { commit('apps'); commit('inject'); }, val = (el, t) => { el.querySelector('.as-list-item__value').textContent = t; };
  // 一行「点开挑一个数」：opts = [[数, 显示成什么（不写就是 数 + unit）]…]
  const pick = (title, key, def, opts, unit) => {
    const lab = v => (opts.find(o => o[0] === v) || [])[1] || v + unit;
    const el = item({ title, value: lab(m[key] ?? def), chevron: true, onClick: async () => {
      const v = await actionSheet(title, opts.map(([n]) => ({ value: String(n), label: lab(n), active: n === (m[key] ?? def) }))); if (v == null) return;
      m[key] = +v; save(); val(el, lab(+v));
    } });
    return el;
  };
  // 记录：每轮顺手记（正文生成时顺手写下，不另外花钱）/ 每隔几轮整理一次（另外找一次 AI）/ 只手动
  let turn = m.story === 'every' ? 'every' : 'maybe';
  const mode = () => m.story === 'n' ? 'n' : m.story === 'off' ? 'off' : 'turn';
  const how = h('div.as-mem-imp', segmented([['maybe', '有值得记的才记'], ['every', '每楼都记']], turn, v => { m.story = turn = v; save(); }));
  const every = pick('隔几轮', 'n', 10, [[3], [5], [10], [15], [20], [30]], ' 轮');
  const paint = () => { how.hidden = mode() !== 'turn'; every.hidden = mode() !== 'n'; };
  const label = () => { const v = m.conn.text; return v === 'follow' ? `跟随聊天线（${connLabel(resolveConn('text', 'memory'))}）` : connLabel(resolveConn('text', 'memory')); };
  const connItem = item({ title: '整理用的接口', value: label(), chevron: true, onClick: async () => {
    const v = await actionSheet('整理用的接口', [{ value: 'follow', label: '跟随聊天线', active: m.conn.text === 'follow' }, ...state.connections.text.map(c => ({ value: c.id, label: c.name, active: m.conn.text === c.id }))]);
    if (!v) return; m.conn.text = v; commit('apps'); val(connItem, label());
  } });
  // 写到一半断了自动补写：和「设置 → 应用管理 → 岁岁砂」是同一个开关
  const fillMax = pick('最多补写', 'fillMax', 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [n]), ' 次'); fillMax.hidden = !m.fill;
  const fillOn = toggleItem({ title: withInfo('写到一半断了自动补写', '整理的回复写到一半断了，写出来的先记下，再从断的地方接着整理。每补一次多找一次 AI。没开的话写出来的也会记下，点「接着整理」接着。') }, !!m.fill, on => { m.fill = on; commit('apps'); fillMax.hidden = !on; });
  const rec = group(withInfo('记录', '每轮：正文生成时顺手记下，不另外花钱。每隔几轮：攒够几轮，另外找一次 AI 把这几轮整理一遍，这次没成的下次一起补。只手动：自己点「现在整理」或去「导入整理」。'), [
    h('div.as-mem-imp', segmented([['turn', '每轮'], ['n', '每隔几轮'], ['off', '只手动']], mode(), v => { m.story = v === 'turn' ? turn : v; save(); paint(); })), how, every,
    item({ title: '现在整理', chevron: true, onClick: async () => {
      if (M.running()) { toast('已经在整理了'); return; }
      try { if (!(await M.autoSort(true))) toast('没有新的可整理'); } catch (e) { toast('整理失败：' + e.message); }
    } }),
    fillOn, fillMax,
    toggleItem({ title: '手机聊天时顺手记' }, m.chat !== false, on => { m.chat = on; commit('apps'); }),
    toggleItem({ title: withInfo('记下的先等你看', '自动记下的先放在「等你看」里，你点「留下」TA 才会记得。') }, !!m.wait, on => { m.wait = on; commit('apps'); }), connItem]);
  // 回想：按意思找（向量）、再排一遍（重排）、最多想起几件、每件带多少原文、来时路
  const vecTxt = v => !v.conn ? '还没接好' : v.stale ? '要重新算' : `已算 ${v.done} / ${v.total}`;
  const vecRow = item({ title: '向量', value: '', chevron: true, onClick: async () => {
    if (!(await M.vecState()).conn) { toast('先到 设置 → 连接 → 其他，给向量填上密钥'); return; }
    await vecRun((a, b) => val(vecRow, `已算 ${a} / ${b}`)); M.vecState().then(v => val(vecRow, vecTxt(v)));
  } });
  M.vecState().then(v => val(vecRow, vecTxt(v)));
  const rr = toggleItem({ title: withInfo('再排一遍', '向量先找出最像的 20 件，重排模型再从里面挑出最准的。用的是 设置 → 连接 → 其他 里的「重排」。') }, m.rerank !== false, on => { m.rerank = on; commit('apps'); });
  const vecOn = on => { rr.hidden = vecRow.hidden = !on; };
  vecOn(m.vec !== false);
  const back = group('回想', [
    toggleItem({ title: '聊天时带上记忆' }, m.on, on => { m.on = on; save(); }),
    toggleItem({ title: withInfo('按意思找', '把每件事和你刚说的话各算成一串数字（向量），比哪几件意思最像：说「感觉自己醉了」，也能想起喝酒那次。用的是 设置 → 连接 → 其他 里的「向量」。换了向量模型，以前算好的要重新算一遍；记下的事、关系、地点都不会丢，算好之前先按词找。关掉就只按词找。') }, m.vec !== false, on => { m.vec = on; commit('apps'); vecOn(on); }),
    rr, vecRow,
    pick('最多想起几件', 'slots', 3, [[1], [2], [3], [5], [8], [99, '不限']], ' 件'),
    pick('每件带多少原文', 'origMax', 500, [[200], [500], [1000], [2000], [0, '不限']], ' 字'),
    toggleItem({ title: withInfo('来时路', '每轮都带一份经历过的事的目录（日期、地点、标题，最多 60 件），TA 一直知道自己经历过什么；每轮的字数会多一些。') }, !!m.road, on => { m.road = on; commit('apps'); })]);
  p.body.append(
    group('', [d.wait.length ? item({ title: '等你看', value: String(d.wait.length), chevron: true, onClick: openWait }) : null, item({ title: '刚才想起了什么', chevron: true, onClick: openPeek })].filter(Boolean)),
    group('', [item({ title: '人物', chevron: true, onClick: openPeople }), item({ title: '标签', chevron: true, onClick: openTags }), item({ title: '导入整理', chevron: true, onClick: openSort })]),
    rec, back,
    group('', [item({ title: '清空', danger: true, onClick: async () => {
      if (!(await dialog({ title: '清空这个聊天记下的全部？', text: '事、关系、地点、了解、日子、没完的事都会删掉，找不回来。设置和标签留着。', confirm: '清空', danger: true }))) return;
      await M.wipe(); toast('已清空'); val(vecRow, vecTxt(await M.vecState()));
    } })]));
  paint();
  nav.push(p.el);
  vecCheck();
}

/* ---------- 人物：名字行上显示谁、怎么排（长按拖动） ---------- */
async function openPeople() {
  const p = page({ app: 'memory', id: 'memory-people', title: '人物', back: true }), d = await M.load();
  const n = name => d.ev.filter(e => e.who.includes(name)).length;
  const rows = M.cast(d).map(([name, on]) => {
    const el = toggleItem({ title: name, sub: `${n(name)} 件事` }, on, v => { (d.show || (d.show = {}))[name] = v; M.save(); });
    el._n = name; sortable(el, kids => { d.order = kids.map(k => k._n); M.save(); }, true);
    return el;
  });
  p.body.append(rows.length ? group(withInfo('显示在名字行上', '长按一行能拖着排顺序，排在前面的在名字行上也在前面。手机里的联系人、出现在 3 件以上事里的人、和你的关系变过的人会自动显示；在这里开过关过的，以你定的为准。'), rows) : empty('还没有记下的人'));
  nav.push(p.el);
}

/* ---------- 标签：大标签（一类事，决定多容易被想起）、小标签（具体的一类事，把同类的事串起来） ---------- */
async function openTags() {
  const p = page({ app: 'memory', id: 'memory-tags', title: '标签', back: true }), box = h('div');
  const ask = (title, value) => dialog({ title, input: { placeholder: '名字', value } }).then(v => String(v || '').trim());
  async function draw() {
    const d = await M.load(), small = M.smallTags(d);
    const edit = (t, re, isBig) => async () => {
      const v = await actionSheet(t, [{ value: 'name', label: '改名' }, { value: 'del', label: '删除', danger: true }]);
      if (v === 'name') { const to = await ask('改名', t); if (!to || to === t) return; await re(t, to); }
      else if (v === 'del') { if (!(await dialog({ title: `删除「${t}」？`, text: isBig ? '挂着它的事不会删，只是不再有这个标签。' : '挂着它的事不会删，只是不再串在一起。', confirm: '删除', danger: true }))) return; await re(t, ''); }
      else return;
      draw();
    };
    box.replaceChildren(
      group(withInfo('大标签', '一件事属于哪一大类，AI 记事时从这里挑。「重要」「特殊日」「秘密」容易被想起，「日常」很像才想起，别的居中。'), [...M.bigs().map(t => item({ title: t, sub: `${d.ev.filter(e => e.big.includes(t)).length} 件`, chevron: true, onClick: edit(t, M.rebig, true) })),
        item({ icon: icon('plus', 18, 2), title: '加一个', onClick: async () => { const to = await ask('加一个大标签', ''); if (!to || M.bigs().includes(to)) return; await M.rebig('', to); draw(); } })]),
      small.length ? group(withInfo('小标签', '具体的一类事（拍大头贴、喝酒、告白）。同一个小标签的事，想起一件会连着想起另外几件。改成已有的名字，两个就并成一个。'), small.map(([t, k]) => item({ title: t, sub: `${k} 件`, chevron: true, onClick: edit(t, M.retag) }))) : null);
  }
  p.body.append(box); draw();
  nav.push(p.el);
}
