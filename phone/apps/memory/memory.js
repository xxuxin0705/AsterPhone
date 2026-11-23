// 岁岁砂：TA 们记得的事（方案见 docs/pages-memory.md）。
// 首页是一张画、三页：时间（沙漏，往下漏的那道沙是时间轴）/ 关系（轨道，谁都能当中心）/ 地点（迷雾地图，大地方里套小地点）。
// 关系那页顶上有一排名字：点谁（或把星拖到正中），谁就是中心。时间和地点对谁都一样，不分人看（作者定的）。
// 右上角设置：人物、记录、整理、回想、标签、清空。整理在核心 core/memory.js 里跑，退出这页也接着跑；同一时间只跑一个。
import { h, pickFile, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, input, textarea, field, btn, icon, actionSheet, dialog, dateField, toast, empty, navBtn, sheet, withInfo, waiting, sortable, pickImage, pickWheels, colorFor, badge } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { worldNames, ctx } from '../../core/bridge.js';
import { loadBook, C as ctxCfg } from '../../core/context.js';
import { bookPanel } from '../../core/bookpanel.js';
import { tagRows } from '../settings/context.js';
import { connLabel, resolveConn } from '../../core/api.js';
import { myName, myAvatar } from '../../core/promptstore.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';
import * as M from '../../core/memory.js';
import { art } from './art.js';

const S = () => state.apps.memory;
const ymd = at => at ? at.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '不知道哪天';
const dot = at => (at || '').split('-').map(Number).join('·');   // 2026-05-03 → 2026·5·3（画下面那几页用，窄）
const split = s => String(s).split(/[、,，]/).map(t => t.trim()).filter(Boolean);
// 选人（作者：能选就别让人打字）：你和记下的所有人排成一片，点一下选上 / 去掉；one = 只能选一个。交回去的还是「、」隔开的一串
const whoPick = (d, val, set, one) => {
  const me = n => M.isMe(n) ? myName() : n; let v = split(val).map(me);
  const all = [...new Set([myName(), ...M.cast(d).map(c => c[0]), ...v])];
  const cs = all.map(n => h('button.as-chip' + (v.includes(n) ? '.is-active' : ''), { onclick: () => {
    v = one ? (v.includes(n) ? [] : [n]) : v.includes(n) ? v.filter(q => q !== n) : [...v, n];
    cs.forEach((c, i) => c.classList.toggle('is-active', v.includes(all[i]))); set(v.join('、'));
  } }, n));
  return h('div.as-chips', cs);
};
let refresh = () => {};   // 抽屉里改了东西：让首页照新的重画

// 整理完了不管在哪一页都说一声（每隔几轮自动整理的只进日志，不打扰）
// 整理的时候一直挂着一条提示（作者要的）：第几批、这一批等了多久、收到多少字、已经记下几件，带「取消」；每秒换一次字
let tick = 0;
const busyTip = () => { const j = M.running(); if (!j) return; const s = Math.round((Date.now() - (j.t0 || Date.now())) / 1000);
  toast(`${j.phase ? '正在' + j.phase : `正在整理 ${j.done + 1}/${j.list.length} 批`} · ${s} 秒${j.added ? ` · 已记下 ${j.added} 件` : ''}`, { label: '取消', fn: () => M.cancelJob(), wait: true }); };
M.onJob((how, j) => {
  if (j.label === '自动整理') { if (how === 'done' && j.added) log('info', '岁岁砂', `自动整理了一次，新记下 ${j.added} 件事`); if (how === 'fail') log('warn', '岁岁砂', '这次没自动整理成，下次一起补：' + j.error); return; }
  if (how === 'start') { clearInterval(tick); tick = setInterval(busyTip, 1000); busyTip(); }
  if (how === 'done' || how === 'fail') clearInterval(tick);
  if (how === 'done') toast(`整理完了：新记下事 ${j.added} 件 · 现在有关系 ${j.rel} 条（${j.said} 条有一句话）· 地点 ${j.places} 处 · 成长 ${j.grow} 条${j.miss ? ` · 还有 ${j.miss} 对没写全，点补充接着写` : ''}`);   // 每样记了多少都说（作者：显示成功了其实没整理出关系）
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
  // 有没落下的沙：右上角挂个带数字的沙漏，点进去挑
  const sand = navBtn('hourglass', '未落的沙', openWait), paintSand = n => { sand.hidden = !n; sand.querySelectorAll('.as-badge').forEach(b => b.remove()); if (n) sand.append(badge(n)); };
  const p = page({ app: 'memory', id: 'memory-main', title: '岁岁砂', back: true, cls: 'as-ss', right: [sand, navBtn('gear', '设置', openSet)] });
  const bar = h('div.as-ss-who.off', { dataset: { noSwipe: '' } }), stage = h('div.as-ss-stage.up'), axis = h('div.as-ss-axis'), paper = h('aside.as-ss-paper', { 'aria-live': 'polite' });
  const tabs = h('nav.as-ss-tabs', ['时间', '关系', '地点'].map((t, i) => h('button' + (i ? '' : '.on'), { onclick: () => go(i) }, t)));
  p.body.append(bar, stage, axis); p.el.append(tabs, paper);
  let d = null, names = [], link = [], ctr = 0, tab = 0, seen = '', opened = null, loose = [];
  const more = h('button.as-ss-back.as-ss-loose', { hidden: true, onclick: () => show('没归类的地点', '', '只出现过一次、也不属于哪个大地方', '', loose.map(n => li('', n, '', '', () => openPlace(n))), '') });
  // 关系页右上角「观星」：以正中这个人为中心，重新生成 TA 和所有人的关系
  const gen = h('button.as-ss-back.as-ss-loose', { onclick: () => regenRel(names[ctr]) }, '观星');
  stage.append(more, gen);
  const shut = () => { if (!paper.classList.contains('on')) return false; paper.classList.remove('on'); A.mark(); return true; };
  const A = art(stage, { blank: shut, rel: openRel, self: () => openSelf(), center: i => setCtr(i), place: openPlace,
    dive: (n, parent) => { root = parent; A.zoomTo(n); setMap(); }, up: () => { root = upOf(root); setMap(); } });
  const sig = () => M.ver + ':' + state.contacts.length;
  // 一页装得下就不让拉动（作者：没有别的内容，拉得动很怪）；事多了、点开一件变长了才能滑
  // 关系、地点下面没有东西；时间那页还没记下事时也一样：都定住（小屏上画加页签会比屏幕高一点，也不让拉）
  const fit = () => { p.body.style.overflowY = tab || !d || !d.ev.length || p.body.scrollHeight <= p.body.clientHeight + 1 ? 'hidden' : ''; if (p.body.style.overflowY) p.body.scrollTop = 0; };

  // 底下那张纸：地点和人共用
  const show = (title, small, lead, intro, rows, none, acts, edit) => {
    // 顶上一条（名字、收起，关系卡的翻面 / 编辑 / 问缘）钉在纸的顶上，滑到下面也能直接收起（作者要的）；title 给 [顶上那条, 下面的内容] 也行
    const str = !(title instanceof Node) && !Array.isArray(title), [bar, body] = Array.isArray(title) ? title : str ? [h('h4', title, small && h('small', small), edit && h('small.go', { onclick: edit }, '编辑')), null] : title.tagName === 'H4' ? [title, null] : [null, title];
    paper.replaceChildren(h('div.hd', h('button.x', { onclick: shut }, '收起'), bar), body || '', ...(str ? [lead && h('p.lead', lead), intro && h('p', intro)] : []),
      (rows.length || none) && h('ol', rows.length ? rows : h('li.none', none)), h('div.as-ss-acts', acts));
    paper.scrollTop = 0; paper.classList.add('on');
  };
  const li = (t, title, quote, small, onclick) => h('li' + (onclick ? '.tap' : ''), { onclick }, h('time', t), h('span', h('b', title, small && h('small', small)), quote && h('q', quote)));
  // 人（作者画的草稿）：正中这个人的头像，脑子里浮出一朵云，云里是 TA 对点的这个人说的一句话；下面三格：现在的关系、认识了多久、对 TA 的看法。
  // 只写正中这个人 → 点的这个人，反过来的要把 TA 放到正中才看。再下面是正中这个人知道的关于 TA 的事。事件不放这里。
  // 头像：你的头像 / 手机联系人的头像，别的人点一下自己换
  const picOf = n => M.isMe(n) ? myAvatar() : (d.ppl.find(q => q.name === n) || {}).pic || (state.contacts.find(c => M.namesOf(c).has(n)) || {}).avatar || '';
  const face = n => {
    const pic = () => picOf(n) ? h('img', { src: picOf(n), alt: '' }) : h('i', { style: { background: colorFor(n) } }, n.slice(-1));
    const f = h('button.face', { 'aria-label': M.isMe(n) ? n : `换${n}的头像`, onclick: M.isMe(n) ? null : async () => {
      let o = d.ppl.find(q => q.name === n); const v = await pickImage(n, { has: !!(o && o.pic) }); if (v == null) return;
      if (!o) d.ppl.push(o = { name: n, alias: [], who: '' }); o.pic = v; await M.save(); seen = sig(); f.firstChild.replaceWith(pic());
    } }, pic());
    return f;
  };
  // 认识了多久：从两个人第一次一起出现的那件事（或关系最早的日期）算到故事里的今天。返回 [几年, 几个月, 几天, 一共几天, 从哪天起]
  const since = (a, b, r) => {
    const has = (e, n) => e.who.some(w => w === n || (M.isMe(n) && M.isMe(w)));
    const t0 = [...d.ev.filter(e => e.at && has(e, a) && has(e, b)).map(e => e.at), r.since, ...r.hist.map(x => x.since)].filter(x => /^\d{4}-\d\d-\d\d$/.test(x || '')).sort()[0];
    if (!t0) return null;
    // 有一个已经不在了：停在走的那天，不再往上涨
    const end = [a, b].map(n => (d.ppl.find(q => q.name === n) || {}).died).filter(Boolean).sort()[0], now = time.isStory() && time.story().date || new Date();
    const A = new Date(t0 + 'T00:00'), B = end && new Date(end + 'T00:00') < now ? new Date(end + 'T00:00') : now; if (B < A) return [0, 0, 0, 0, t0];
    let y = B.getFullYear() - A.getFullYear(), m = B.getMonth() - A.getMonth(), dd = B.getDate() - A.getDate();
    if (dd < 0) { m--; dd += new Date(B.getFullYear(), B.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return [y, m, dd, Math.round((new Date(B.getFullYear(), B.getMonth(), B.getDate()) - A) / 864e5), t0];
  };
  function openRel(i) {
    const out = !S().relIn, [x, y] = out ? [ctr, i] : [i, ctr], lk = link[x][y], me = names[x], who = names[y], cs = x ? new Set([me]) : new Set([names[0], '我']), r = lk.r;
    const facts = d.facts.filter(f => (y ? f.about === who : M.isMe(f.about)) && M.knownOf(f, cs) != null);
    const path = [...r.hist.map(x => x.kind), r.kind].filter((k, j, l) => k !== '其他' && k !== l[j - 1]), t = since(me, who, r);
    // 版式两套（作者从六套里挑的）：「引号」只靠字，那句话当大标题；「头像」是两个人一左一右，虚线弧从说话的人指向对方，关系挂在弧顶。
    // 用哪套在资源库 → 应用 → 岁岁砂里定；没定就按这两个人的名字抽，同一对人每次都一样、翻面也不换
    const duo = S().relLook ? S().relLook === 'b' : [...me + who].reduce((n, c) => n + c.charCodeAt(0), 0) % 2, kind = path[path.length - 1];
    // 认识了多久：点一下在「一共多少天」和「几年几个月几天」之间换（记在设置里），只换这几个字
    const long = h('button', { disabled: !t, onclick: () => { S().days = !S().days; commit('apps'); fillLong(); } });
    const fillLong = () => long.replaceChildren(h('small', '认识了'), h('b', !t ? '—' : S().days ? `${t[3]} 天` : [t[0] && `${t[0]} 年`, (t[0] || t[1]) && `${t[1]} 个月`, `${t[2]} 天`].filter(Boolean).join(' ')));
    fillLong();
    // 顶上一排：翻面、编辑（作者：改放最下面要翻到底才发现）、问缘（单独重新生成这一对）
    show([h('div.tools', h('button', { onclick: () => { S().relIn = out; commit('apps'); openRel(i); } }, '⇄ 翻面'), h('button', { onclick: () => editRel(r) }, '编辑'),
      h('button', { onclick: () => regenRel(names[ctr], names[i]) }, '问缘')), h('div.as-ss-rel',
      duo ? h('div.duo', { html: '<svg viewBox="0 0 342 112" aria-hidden="true"><path d="M50 60C106 -8 236 -8 292 60" fill="none" stroke="var(--blue)" stroke-width="1.4" stroke-dasharray="2 5"/><path transform="translate(262 34) rotate(32)" d="M7 0L-6-5L-6 5Z" fill="var(--blue)"/></svg>' },
        h('div', face(me), h('b', me)), h('div', face(who), h('b', who)), kind && h('span', kind)) : h('div.who', face(me), h('b', me), h('u'), kind && h('i', kind), kind && h('u'), h('b', who)),
      !duo && h('div.q', '“'), h('h3' + (duo && lk.say ? '.b' : ''), lk.say || h('em', '还没写对 TA 的一句话')),
      h('div.f', long, t && h('div', h('small', '起'), h('b', dot(t[4])))),
      h('div.v', h('small', '看法'), h('p', lk.q[0] || h('em', '还没写'))),
      (path.length > 1 || r.now) && h('p.now', [path.length > 1 && path.join(' → '), r.now].filter(Boolean).join(' · ')))], '', '', '',
      facts.map(f => li('了解', M.knownOf(f, cs), '', f.know.join('、') + '知道', () => editFact(f))), '',
      [btn('加一条了解', 'secondary', () => editFact(null, who))]);
  }
  // 成长线：这个人是怎么一步步变成现在这样的，按先后。点正中这个人自己进来
  function openSelf(i = ctr) {
    const who = names[i], l = d.grow.filter(g => i ? g.who === who : M.isMe(g.who)).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    const died = i && (d.ppl.find(q => q.name === who) || {}).died;
    show(h('h4', who, h('small.go', '成长线'), i ? h('small.go', { onclick: () => editGone(who) }, died ? '已故 · ' + dot(died) : '标记已故') : ''), '', '', '', l.map(g => li(dot(g.at), g.text, g.why && '因为：' + g.why, '', () => editGrow(g))), '还没有记下 TA 的变化', [btn('加一条', 'secondary', () => editGrow(null, who))]);
  }
  // 地点：一句介绍、在这里发生过的事（大地方连里面小地点的一起）
  function openPlace(n, subs = []) {
    const rec = d.places.find(q => q.name === n), l = d.ev.filter(e => !e.off && (e.place === n || subs.includes(e.place))).reverse();
    show(n, l.length ? l.length + ' 件' : '', rec && rec.area ? '在' + rec.area : '', rec && rec.intro, l.map(e => li(dot(e.at), e.title, '', [e.part, e.place !== n && e.place].filter(Boolean).join(' · '), () => editEvent(e))), '还没有记下在这里的事',
      [], () => editPlace(n));   // 编辑放在名字旁边（作者：放最下面要翻到底才发现）
  }

  /* 时间那页：最上面是日子（快到的在前）和没完的事，下面按年排所有事，新的在上（刚漏下来的沙）。点一件展开；同一个小标签的另外几件一起亮，用一根蓝线串起来 */
  const kin = e => e.tags.filter(t => t !== '手机');
  function arcs() {
    axis.querySelectorAll('.arc').forEach(a => a.remove());
    const l = opened ? [...axis.querySelectorAll('.ev.open, .ev.kin')].filter(b => !b.hidden) : [];
    if (l.length > 1) axis.append(h('div.arc', { style: { top: l[0].offsetTop + 22 + 'px', height: l[l.length - 1].offsetTop - l[0].offsetTop + 'px' } }));
  }
  function toggle(b, e) {
    axis.querySelectorAll('.ev.open, .ev.kin').forEach(x => x.classList.remove('open', 'kin'));
    opened = opened === e ? null : e;
    if (opened) { b.classList.add('open'); const t = kin(e); axis.querySelectorAll('.ev').forEach(x => { if (x !== b && x._e && kin(x._e).some(k => t.includes(k))) x.classList.add('kin'); }); }
    arcs(); fit();
  }
  const row = (cls, t, title, small, onclick, more) => h('div.ev' + cls, { role: 'button', tabindex: 0, onclick }, h('time', t), h('i'), h('b', title), h('small', small), more);
  // 时间那页分四块看，不挤在一起（作者定的）：时间轴（能换从新到旧 / 从旧到新）、分类（按大标签，点开才列）、日子、没完的事
  let view = 'line';
  const modes = h('div.as-ss-modes', [['line', '时间轴'], ['tag', '分类'], ['day', '纪念日'], ['todo', '待办']].map(([k, t]) => h('button' + (k === view ? '.on' : ''), { onclick: e => {
    if (k === view) return; view = k; [...modes.children].forEach(x => x.classList.toggle('on', x === e.currentTarget)); fillAxis(); } }, t)));
  const evRow = (e, t) => {
    const b = row((e.pin ? '.pin' : '') + (e.mark === 'hi' || e.big.includes('重要') ? '.hi' : '') + (e.mark === 'no' ? '.noise' : ''), t, [e.title, e.tags.includes('手机') && h('em.phone', '手机')], [e.part, e.place].filter(Boolean).join(' · '), () => toggle(b, e),
      h('p', e.text, e.quote && h('q', '「' + e.quote + '」'), h('span.meta', ['参与的人：' + e.who.join('、'), (e.know || []).length && '后来听说：' + e.know.join('、')].filter(Boolean).join(' · ')), (e.big.length || kin(e).length) && h('span.meta', '标签：' + [...new Set([...e.big, ...kin(e)])].join(' · ')), h('button', { onclick: ev => { ev.stopPropagation(); editEvent(e); } }, '改')));
    b.style.setProperty('--r', 3 + e.imp * 1.4 + 'px'); b._e = e;
    return b;
  };
  function fillAxis() {
    const rows = [], ev = d.ev.filter(e => !e.off), none = t => rows.push(h('div.none', t));
    if (view === 'day') {
      const now = time.isStory() ? time.story().date : new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const left = x => { const [mm, dd] = x.md.split('-').map(Number); let t = new Date(t0.getFullYear(), mm - 1, dd); if (t < t0) t = new Date(t0.getFullYear() + 1, mm - 1, dd); return Math.round((t - t0) / 864e5); };
      rows.push(h('div.yr.zh', h('em', '快到的在前'), h('button', { 'aria-label': '加一个日子', onclick: () => editDay(null) }, icon('plus', 14, 2))),
        ...d.days.map(x => [x, left(x)]).sort((a, b) => a[1] - b[1]).map(([x, n]) => row('.day', n ? `${n} 天后` : '今天', x.what, `${x.kind || '其他'} · ${x.date ? ymd(x.date) : x.md.replace(/^0?(\d+)-0?(\d+)$/, '每年$1月$2日')}`, () => editDay(x))));
    } else if (view === 'todo') {
      const todo = d.todo.filter(t => !t.done);
      rows.push(...todo.map(t => row('.todo', '', t.text, t.who, async () => {
        const v = await actionSheet(t.text, [{ value: 'done', label: '做完了' }, { value: 'del', label: '删除', danger: true }]);
        if (v === 'done') t.done = true; else if (v === 'del') d.todo.splice(d.todo.indexOf(t), 1); else return;
        await M.save(); draw();
      })));
      if (!todo.length) none('没有待办');
    } else if (view === 'tag') {
      // 不用时间轴：一个大标签一栏，下面是小标签的卡片（名字 + 几件）；点一张，底下那张纸按先后列出这一类所有的事。
      // 一个小标签只出现一次（所有人过生日的事在一张卡里），放在它的事最常挂的那个大标签下面
      const by = new Map(); for (const e of ev) for (const t of kin(e).length ? kin(e) : ['没细分']) by.set(t, [...(by.get(t) || []), e]);
      const home = es => { const n = new Map(); for (const e of es) for (const g of e.big) n.set(g, (n.get(g) || 0) + 1); return ([...n].sort((a, b) => b[1] - a[1])[0] || [''])[0]; };
      const cards = [...by].map(([t, es]) => [t, es, home(es)]).sort((a, b) => b[1].length - a[1].length);
      const card = ([t, es]) => h('button', { onclick: () =>
        show(t, `${es.length} 件`, '', '', es.map(e => li(dot(e.at), e.title, e.text, [e.part, e.place].filter(Boolean).join(' · '), () => editEvent(e))), '') }, t, h('small', String(es.length)));
      // 手机里记下的单独一栏放最上面（作者要的：显眼）
      const phone = ev.filter(e => e.tags.includes('手机'));
      if (phone.length) rows.push(h('div.as-ss-cat', h('em', '手机'), h('div', card(['手机', phone]))));
      for (const g of [...M.bigs(), '']) {
        const l = cards.filter(c => c[2] === g || (!g && !M.bigs().includes(c[2]))); if (!l.length) continue;
        rows.push(h('div.as-ss-cat', h('em', g || '没分类'), h('div', l.map(card))));
      }
      if (!ev.length) none('还没有记下的事');
    } else {
      const asc = !!S().asc; let yr = null;
      if (ev.length) rows.push(h('div.yr.zh', h('button.sort', { 'aria-label': asc ? '现在从旧到新，点一下换成从新到旧' : '现在从新到旧，点一下换成从旧到新', onclick: () => { S().asc = !asc; commit('apps'); fillAxis(); toast(asc ? '从新到旧' : '从旧到新'); } }, icon('sort', 14, 2))));
      for (const e of asc ? ev : [...ev].reverse()) {
        const y = e.at ? e.at.slice(0, 4) : '不知道哪年'; if (y !== yr) rows.push(h('div.yr' + (e.at ? '' : '.zh'), h('em', yr = y)));
        rows.push(evRow(e, e.at ? dot(e.at.slice(5)) : ''));
      }
      if (!ev.length) rows.push(h('div.none', '还没有记下的事', btn('去整理', 'secondary', openSort)));
    }
    opened = null; axis.classList.toggle('cards', view === 'tag'); axis.replaceChildren(modes, ...rows); fit();
  }
  function setCtr(i, fx = true) {
    ctr = i; shut(); A.center(i);
    [...bar.children].forEach((b, k) => { b.classList.toggle('on', k === i); if (k === i && fx) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  }
  function go(i) {
    if (i === tab) return;
    tab = i; shut(); A.tab(i); [...tabs.children].forEach((b, k) => b.classList.toggle('on', k === i)); axis.classList.toggle('off', i > 0); bar.classList.toggle('off', i !== 1); stage.classList.toggle('up', !i); more.classList.toggle('on', i === 2); gen.classList.toggle('on', i === 1); p.body.scrollTo({ top: 0, behavior: 'smooth' });
    if (!i) arcs();
    setTimeout(fit, 1400);   // 画换成别的高度要 1.3 秒
  }

  /* 地图。地点是一棵树（作者定的：能一层套一层，海城 → 星川学园 → 医务室），root 是现在看的是哪一层（'' = 最外面）。
     一层里：下面还有地方的是大地方（点一下钻进去看它直接管的那几个；里面的再点还能往下钻），没有的是单独的地点。
     谁归谁：先看自己写的归属；没写的，名字里带着某个大地方的全名、或者用它的简称开头（大地方名字的后半截，至少两个字：「学园男生宿舍」→「星川学园」）就算它的。
     大地方 = 被写成归属的那些，加上程序看出来的：三个以上没归属的地点用同两个字开头（学园医务室、学园食堂…）就是一片，
     名字用正好以这两个字结尾的那个地方（星川学园），没有就用这两个字。
     最外面那层只放主要的（作者：次要的不要放首页）：只出过一次、又没归属的零散地点收在右上角「没归类」里。没拖过的按向日葵那样一圈圈摆开 */
  let root = '', rooted = false, upOf = () => '';
  below = () => [];
  function setMap() {
    const junk0 = a => !a || /^[（(].*[)）]$|^(空|无|不知道|未知)$/.test(a) ? '' : a.replace(/\s*[（(][^（()）]*[)）]$/, '');   // AI 有时把「（空）」写进归属；「星川学园（地下）」和「星川学园」是同一个大地方
    const pl = new Map(d.places.map(q => [q.name, q])), cnt = new Map();
    for (const e of d.ev) if (e.place) { cnt.set(e.place, (cnt.get(e.place) || 0) + 1); if (!pl.has(e.place)) pl.set(e.place, { name: e.place }); }
    // 归属写成简称的认成全名：「学园」→「星川学园」（只有唯一一个地方的名字以它结尾时才认）
    const full = a => { const l = [...new Set([...pl.keys(), ...d.places.map(q => q.area)])].filter(n => n && n !== a && n.endsWith(a)); return l.length === 1 ? l[0] : a; };
    const junk = a => { const v = junk0(a); return v && full(v); };
    const head = new Map(); for (const q of pl.values()) if (!junk(q.area) && !q.lone && q.name.length > 2) head.set(q.name.slice(0, 2), (head.get(q.name.slice(0, 2)) || 0) + 1);
    const set = [...pl.values()].map(q => junk(q.area)).filter(Boolean);
    const big = [...new Set([...set, ...[...head].filter(x => x[1] > 2).map(([h2]) => [...set, ...pl.keys()].find(n => n.length > 2 && n.endsWith(h2)) || h2)])];
    const short = (a, n) => { for (let k = a.length - 1; k >= 2; k--) if (n.startsWith(a.slice(-k))) return true; return false; };
    const nodes = [...new Set([...pl.keys(), ...big])];
    const P = new Map(nodes.map(n => [n, junk((pl.get(n) || {}).area) || (!(pl.get(n) || {}).lone && big.find(a => a !== n && (n.includes(a) || short(a, n)))) || '']));   // 大地方也一样（星川学园 → 海城）
    for (const n of nodes) { let q = P.get(n), k = 0; while (q && q !== n && k++ < 20) q = P.get(q) || ''; if (q === n) P.set(n, ''); }   // 甲归乙、乙又归甲：绕圈了，当它没有上级
    // 最多三层（作者定的：城市 → 大地方 → 具体地点）：再往下的并到第三层，挂在它的上上级下面
    const depth = n => { let k = 1; for (let q = P.get(n); q && k < 9; q = P.get(q)) k++; return k; };
    for (const n of nodes) while (depth(n) > 3) P.set(n, P.get(P.get(n)));
    const sum = n => (cnt.get(n) || 0) + kids(n).reduce((a, k) => a + sum(k), 0), kids = n => nodes.filter(x => P.get(x) === n), desc = n => kids(n).flatMap(k => [k, ...desc(k)]);
    if (root && !nodes.includes(root)) root = '';
    // 第一次进来默认看第二层（作者定的）：有城市（下面套了两层的）就先钻进现在所在的那个城市，没有在哪个城市就进事最多的那个；左上角能退回去看所有城市
    if (!rooted) { rooted = true; const here = (time.isStory() && time.story().place) || '', city = kids('').filter(n => kids(n).some(k => kids(k).length)).sort((a, b) => sum(b) - sum(a)); root = city.find(n => n === here || desc(n).includes(here)) || city[0] || ''; }
    upOf = n => P.get(n) || ''; below = desc; upAt = upOf; areasAll = () => nodes.filter(n => kids(n).length);
    const level = kids(root).sort((a, b) => sum(b) - sum(a));
    loose = root ? [] : level.filter(n => !kids(n).length && pl.size > 12 && (cnt.get(n) || 0) < 2);
    more.textContent = `没归类 ${loose.length}`; more.hidden = !loose.length;
    const areas = level.filter(n => kids(n).length), spots = [...areas, ...level.filter(n => !kids(n).length && !loose.includes(n))];
    const at = n => { const k = spots.indexOf(n), a = k * 2.4, r = 165 * Math.sqrt((k + .5) / spots.length); return { x: Math.round(200 + Math.cos(a) * r), y: Math.round(A.mid() * (1 + Math.sin(a) * r * 1.15 / 250)) }; };   // 上下跟着画的高度摊开、居中
    const last = [...d.ev].reverse().find(e => e.place);
    A.set({ names, link, gone: new Set(names.map((n, i) => (d.ppl.find(q => q.name === n) || {}).died ? i : -1)), here: (time.isStory() && time.story().place) || (last ? last.place : ''), root, up: upOf(root), deep: new Set(nodes.filter(n => kids(n).length)),
      areas: areas.map(n => ({ name: n, ...at(n), all: desc(n), list: kids(n).sort((a, b) => sum(b) - sum(a)).slice(0, 14) })),
      lone: spots.slice(areas.length).map(n => ({ name: n, ...at(n) })) });
  }
  async function draw() {
    A.resume();
    d = await M.load(); paintSand(d.wait.length); if (sig() === seen) return;   // 返回这页时数据没变就一点都不动
    seen = sig(); shut();
    const was = names[ctr]; names = [myName(), ...M.cast(d).filter(x => x[1]).map(x => x[0])];
    const idx = n => M.isMe(n) ? 0 : names.indexOf(n);
    // 关系网：link[a][b] = a 这边看 b。st 第 0 条是现在，后面是以前的；第三格是离多远（5 - 亲近度）
    link = names.map(() => ({}));
    for (const r of d.rel) {
      const i = idx(r.a), j = idx(r.b); if (i < 0 || j < 0 || i === j) continue;
      if (r.lv === 0) { link[i][j] = link[j][i] = null; continue; }   // 亲近度 0 = 不认识：不摆上去，下面也不当「一起经历过」补进来
      const st = [{ ...r, title: [r.kind !== '其他' && r.kind, r.now].filter(Boolean).join('，') }, ...[...r.hist].reverse().map(x => ({ ...x, title: x.kind }))];
      const mk = v => ({ kind: r.kind, r, say: r['s' + v[1]] || '', st: st.map(x => [x.since || '', x.title, 5 - M.lvOf(x)]), q: st.map(x => x[v] || '') });
      link[i][j] = mk('va'); link[j][i] = mk('vb');
    }
    // 没记下关系、但一起经历过两件事以上的人也算认识（作者：谁放正中都该是 TA 的整张关系网，不是只有和我的）：先摆在外圈，点开能把关系补上（保存了才真的记下）
    const co = new Map();
    for (const e of d.ev) { const l = [...new Set(e.who.map(idx).filter(k => k >= 0))]; for (const a of l) for (const b of l) if (a < b) co.set(a + ',' + b, (co.get(a + ',' + b) || 0) + 1); }
    for (const [k, n] of co) {
      const [i, j] = k.split(',').map(Number); if (n < 2 || link[i][j] !== undefined) continue;
      const r = { id: uid('r'), a: names[i], b: names[j], kind: '其他', since: '', now: '', lv: 1, hist: [] }, mk = () => ({ kind: '其他', r, say: '', st: [['', '', 4]], q: [''] });
      link[i][j] = mk(); link[j][i] = mk();
    }
    setMap();
    bar.replaceChildren(...names.map((n, i) => h('button', { onclick: () => setCtr(i) }, n)), h('button.more', { onclick: openPeople }, '更多'));
    fillAxis(); setCtr(Math.max(0, names.indexOf(was)), false);
  }
  refresh = draw;
  draw().then(vecCheck); p.el._onShow = draw;
  return p.el;
}

// 已故：哪天走的。关系页上留在原位、淡下去；认识多久停在那天；自动记一个祭日（作者要的）
async function editGone(who) {
  const d = await M.load(), p = d.ppl.find(q => q.name === who); let at = (p && p.died) || '';
  const set = async v => { M.setGone(who, v); await M.save(); s.close(); refresh(); };
  const s = sheet({ title: who, content: [field('哪天走的', dateField(at, v => { at = v; })),
    h('div.as-prompt-bar', p && p.died && btn('撤销', 'danger', () => set('')), btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => at ? set(at) : toast('选一下日期')))] });
}

/* ---------- 单独生成关系：生成完不直接存，一行行挑用原来的还是新的 ---------- */
let regenAc = null;   // 同一时间只跑一个：放在模块里，退出再进来、再点一下星星都是取消
async function regenRel(a, b) {
  if (regenAc) { regenAc.abort(); return; }
  // 先说清楚要做什么（作者：别人看不懂观星、问缘是什么），确认了才找 AI
  if (!(await dialog({ title: b ? '问缘' : '观星', text: `${b ? `重新写${a}和${b}之间` : `重新写${a}和大家`}的关系、看法和一句话。写好后先给你看，一行行挑用原来的还是新的，不会直接盖掉。`, confirm: '生成' }))) return;
  regenAc = new AbortController();
  try {
    const l = await waiting(`正在生成${b ? `${a}和${b}` : `${a}和大家`}的关系…`, sig => M.regen(a, b, sig), regenAc);
    if (!l) return;
    if (!l.length) { toast('没写出能用的关系，再点一次试试'); return; }
    toast('写好了，挑一下用哪版'); pickRel(l);
  } catch (e) { toast('没生成出来：' + e.message); }
  finally { regenAc = null; }
}
function pickRel(l) {
  const p = page({ app: 'memory', id: 'memory-pick', title: '挑一版', back: true }), all = [];
  const F = r => [['kind', '关系'], ['since', '从什么时候起'], ['now', '现在怎样'], ['lv', '亲近度'], ['va', `${r.a}眼里的${r.b}`], ['sa', `${r.a}对${r.b}的一句话`], ['vb', `${r.b}眼里的${r.a}`], ['sb', `${r.b}对${r.a}的一句话`]];
  const picks = l.map(r => {
    const o = r.old || {};
    const pick = {}, rows = [];
    for (const [k, t] of F(r)) {
      const nv = r[k] == null ? '' : String(r[k]), ov = k === 'lv' ? (r.old ? String(M.lvOf(o)) : '') : k === 'kind' && o.kind === '其他' ? '' : String(o[k] ?? '');
      if (!nv) continue; pick[k] = true;
      if (!ov || ov === nv) { rows.push(h('div.as-mem-pick', h('small', t), h('p', nv))); continue; }
      // 两版都摆出来，点哪版用哪版（默认新的）
      const old = h('button', h('i', '原来的'), ov), neu = h('button.on', h('i', '新的'), nv);
      const set = v => { pick[k] = v; neu.classList.toggle('on', v); old.classList.toggle('on', !v); };
      old.onclick = () => set(false); neu.onclick = () => set(true); all.push(set);
      rows.push(h('div.as-mem-pick', h('small', t), old, neu));
    }
    p.body.append(group(`${r.a} 和 ${r.b}`, rows));
    return pick;
  });
  if (all.length) p.body.prepend(h('div.as-mem-acts.as-mem-all', btn('全用原来的', 'secondary', () => all.forEach(f => f(false))), btn('全用新的', 'secondary', () => all.forEach(f => f(true)))));
  p.body.append(h('div.as-prompt-bar', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', async () => {
    for (const [i, r] of l.entries()) await M.useRel(r, picks[i]);
    await M.save(); nav.pop(); refresh(); toast(`存好了 ${l.length} 对`);
  })));
  nav.push(p.el);
}

/* ---------- 抽屉：改关系、日子、了解、地点 ---------- */
let below = () => [], upAt = () => '', areasAll = () => [];   // 一个地点下面所有层的地方（首页算地图时给的）：改归属时不让它反过来归到自己下面的地方
async function editRel(r) {
  const d = await M.load(), x = { kind: r.kind, since: r.since, now: r.now, lv: M.lvOf(r), va: r.va || '', vb: r.vb || '', sa: r.sa || '', sb: r.sb || '' };
  if (x.kind === '其他') x.kind = '';
  const kind = input({ value: x.kind, onInput: v => pick(v.trim(), true) }); kind.maxLength = 4;   // 上面的词不合适就自己写，四个字以内（作者定的）
  const pick = (k, typed) => { x.kind = k; if (!typed) kind.value = k; chips.forEach(c => c.classList.toggle('is-active', c.textContent === k)); };
  const chips = [...new Set([...M.KINDS, ...d.rel.map(q => q.kind)])].filter(k => k !== '其他').map(k => h('button.as-chip' + (k === x.kind ? '.is-active' : ''), { onclick: () => pick(k === x.kind ? '' : k) }, k));
  const s = sheet({ title: `${r.a} 和 ${r.b}`, content: [
    field('关系', kind), h('div.as-mem-imp', h('div.as-chips', chips)),
    field('从什么时候起', dateField(M.day(x.since)[0], v => { x.since = v; })),
    field('现在怎样', input({ value: x.now, onInput: v => { x.now = v.trim(); } })),
    field(withInfo('亲近度', '5 最亲，关系页上越亲的离得越近。0 是不认识，关系页上不显示。'), segmented([0, 1, 2, 3, 4, 5].map(n => [n, String(n)]), x.lv, v => { x.lv = v; })),
    field(`${r.a}眼里的${r.b}`, textarea({ value: x.va, rows: 2, onInput: v => { x.va = v.trim(); } })),
    field(`${r.a}对${r.b}的一句话`, input({ value: x.sa, onInput: v => { x.sa = v.trim(); } })),
    field(`${r.b}眼里的${r.a}`, textarea({ value: x.vb, rows: 2, onInput: v => { x.vb = v.trim(); } })),
    field(`${r.b}对${r.a}的一句话`, input({ value: x.sb, onInput: v => { x.sb = v.trim(); } })),
    // 删除（作者：删不掉）：以前是拿掉这一条，可两个人一起经历过事，关系页又按「认识」摆回来。现在记成不认识（亲近度 0）：关系页不显示，整理也不再催
    h('div.as-prompt-bar', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这段关系？', confirm: '删除', danger: true }))) return;
      Object.assign(r, { kind: '不认识', lv: 0, since: '', now: '', va: '', vb: '', sa: '', sb: '', hist: [] }); if (!d.rel.includes(r)) d.rel.push(r); await M.save(); s.close(); refresh(); }), btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      x.kind = x.kind || '其他'; if (!d.rel.includes(r)) d.rel.push(r); else if (x.kind !== r.kind) r.hist.push({ kind: r.kind, since: r.since, lv: r.lv, va: r.va, vb: r.vb });
      Object.assign(r, x); await M.save(); s.close(); refresh();
    })),
  ] });
}
async function editGrow(o, who = '') {
  const d = await M.load(), x = o ? { at: o.at, text: o.text, why: o.why } : { at: '', text: '', why: '' };
  const s = sheet({ title: o ? o.who : who, content: [
    field('哪天', dateField(M.day(x.at)[0], v => { x.at = v; })),
    field(withInfo('变了什么', '写成「以前怎样 → 现在怎样」。TA 以后说话做事会照现在的样子来，和人设不一样的以这里为准。'), textarea({ value: x.text, rows: 2, onInput: v => { x.text = v.trim(); } })),
    field('因为哪件事', input({ value: x.why, onInput: v => { x.why = v.trim(); } })),
    h('div.as-prompt-bar', o && btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这一条？', confirm: '删除', danger: true }))) return; d.grow.splice(d.grow.indexOf(o), 1); await M.save(); s.close(); refresh(); }), btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      if (!x.text) { toast('写上变了什么'); return; }
      if (o) Object.assign(o, x); else d.grow.push({ id: uid('g'), who, ...x, src: '手动' });
      await M.save(); s.close(); refresh();
    })),
  ].filter(Boolean) });
}
// 日子：类型、日期（年-月-日，不知道年份就写月-日）、是什么日子、和谁有关；照「日子」那一行的格式读，和 AI 记的一样
async function editDay(o) {
  const d = await M.load(), x = o ? { kind: o.kind || '其他', at: o.date || o.md, what: o.what, who: o.who.join('、') } : { kind: '生日', at: '', what: '', who: '' };
  const s = sheet({ title: o ? o.what : '加一个日子', content: [
    segmented(M.DAY_KINDS.map(k => [k, k]), x.kind, v => { x.kind = v; }),
    field('是什么日子', input({ value: x.what, onInput: v => { x.what = v.trim(); } })),
    // 只知道哪天、不知道哪年（比如生日）：年份那列最上面选「不知道哪年」，只存月-日
    field('日期', dateField(x.at, v => { x.at = v; }, true)),
    field('和谁有关', whoPick(d, x.who, v => { x.who = v; })),
    h('div.as-prompt-bar', o && btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这个日子？', confirm: '删除', danger: true }))) return; d.days.splice(d.days.indexOf(o), 1); await M.save(); s.close(); refresh(); }), btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      const y = M.parse(`日子：${x.kind}｜${x.at}｜${x.what}｜${x.who}`).days[0];
      if (!y) { toast(x.what ? '选一下日期' : '写上是什么日子'); return; }
      if (o) Object.assign(o, y); else d.days.push(y);
      await M.save(); s.close(); refresh();
    })),
  ].filter(Boolean) });
}
// 了解：关于谁、是什么、谁知道（每个人知道的不一样）
async function editFact(o, about = '') {
  const d = await M.load(), x = o ? { about: o.about, text: o.text, know: o.know.join('、') } : { about, text: '', know: '' };
  const s = sheet({ title: o ? '这一条' : '加一条', content: [
    field('关于谁', whoPick(d, x.about, v => { x.about = v; }, true)),
    field('是什么', textarea({ value: x.text, rows: 2, onInput: v => { x.text = v.trim(); } })),
    field('谁知道', whoPick(d, x.know, v => { x.know = v; })),
    h('div.as-prompt-bar', o && btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这一条？', confirm: '删除', danger: true }))) return; d.facts.splice(d.facts.indexOf(o), 1); await M.save(); s.close(); refresh(); }), btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      if (!x.about || !x.text) { toast(x.about ? '写上是什么' : '写上关于谁'); return; }
      if (o) Object.assign(o, { about: x.about, text: x.text, know: split(x.know) }); else d.facts.push({ id: uid('f'), about: x.about, text: x.text, know: split(x.know), hist: [] });
      await M.save(); s.close(); refresh();
    })),
  ].filter(Boolean) });
}
async function editPlace(n) {
  const d = await M.load(), o = d.places.find(q => q.name === n), x = { name: n, area: (o && o.area) || upAt(n), intro: (o && o.intro) || '' };
  // 底下挂着地方的是大地方（地图按名字自动凑的组也算）。作者定的：只有小地方才选归哪个大地方，所以只列大地方；
  // 大地方可以变成小地方，这时问底下的地方是跟着它一起挂过去（和它同级），还是放到外面单独放
  const under = below(n), kids = under.filter(k => upAt(k) === n), big = kids.length > 0;
  const cands = areasAll().filter(a => a !== n && !under.includes(a));
  let small = !big, kidsOut = false;
  const area = btn(x.area || '单独放', 'secondary', async () => {
    let v = await actionSheet('归哪个大地方', [{ value: '\u0000', label: '单独放', active: !x.area }, ...cands.map(a => ({ value: a, label: a, active: a === x.area })), { value: '\u0001', label: '写一个新的' }]);
    if (v === '\u0001') v = ((await dialog({ title: '新的大地方', input: { placeholder: '名字' } })) || '').trim() || null;
    if (v == null) return; x.area = v === '\u0000' ? '' : v; area.textContent = x.area || '单独放';
  });
  const kidsRow = big && field(`底下的 ${kids.length} 个地方`, segmented([[false, '和它同级'], [true, '放到外面']], false, v => { kidsOut = v; }));
  if (kidsRow) kidsRow.hidden = true;
  const s = sheet({ title: n, content: [
    field('名字', input({ value: x.name, onInput: v => { x.name = v.trim(); } })),
    big && field('它是', segmented([[false, '大地方'], [true, '小地方']], false, v => { small = v; kidsRow.hidden = !v; })),
    field(withInfo('归哪个大地方', '选了就收进那个大地方里：地图上先看到大地方，点进去才看到它。能一层套一层（教室归学校，学校归城市）。'), area),
    kidsRow,
    field('介绍', textarea({ value: x.intro, rows: 3, onInput: v => { x.intro = v.trim(); } })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      const to = x.name || n; if (x.area === n || x.area === to) x.area = '';
      if (under.includes(x.area) || M.loops(n, x.area)) { toast(`${x.area}已经在${n}下面了，不能反过来归`); return; }
      const rec = q => d.places.find(p => p.name === q) || d.places[d.places.push({ name: q, area: '', intro: '' }) - 1];
      // 底下的地方把归属写死：自动凑的组改了名、变成小地方后，不会又按名字凑回去（作者：改了名没起作用）
      for (const k of kids) { const r = rec(k); r.area = !small ? to : kidsOut ? '' : x.area; r.lone = !r.area; }
      if (to !== n) { for (const e of d.ev) if (e.place === n) e.place = to; for (const q of d.places) if (q.area === n) q.area = to; }
      const me = rec(to); if (o && o !== me) d.places.splice(d.places.indexOf(o), 1);   // 改成已有的名字：合成一个
      Object.assign(me, { area: x.area, intro: x.intro || me.intro, lone: !x.area });
      // 自动凑出来的组变成小地方、里面又没有事：它本来就不是真地方，不留
      if (big && small && !d.ev.some(e => e.place === to) && !d.places.some(q => q.area === to)) d.places.splice(d.places.indexOf(me), 1);
      await M.save(); s.close(); refresh();
    })),
  ].filter(Boolean) });
}

/* ---------- 改一件事 ---------- */
async function editEvent(e) {
  const d = await M.load(), x = { ...e, who: e.who.join('、'), tags: e.tags.join('、'), know: (e.know || []).join('、'), big: [...e.big] };
  const p = page({ app: 'memory', id: 'memory-edit', title: '这件事', back: true });
  const flag = (k, on, off) => { const b = btn(x[k] ? on : off, 'secondary', () => { x[k] = !x[k]; b.textContent = x[k] ? on : off; }); return b; };
  p.body.append(
    group('', [field('标题', input({ value: x.title, onInput: v => { x.title = v.trim(); } })),
      field('日期', dateField(x.at, v => { x.at = v; x.guess = false; })),
      field('时间', input({ value: x.part, onInput: v => { x.part = v.trim(); } })),
      field('地点', input({ value: x.place, onInput: v => { x.place = v.trim(); } })),
      field('经过', textarea({ value: x.text, rows: 3, onInput: v => { x.text = v.trim(); } })),
      field('在场的人', whoPick(d, x.who, v => { x.who = v; })),
      field('后来听说的人', whoPick(d, x.know, v => { x.know = v; })),
      field('影响', input({ value: x.after || '', onInput: v => { x.after = v.trim(); } })),
      field('原话', textarea({ value: x.quote || '', rows: 2, onInput: v => { x.quote = v.trim(); } })),
      field('原文', textarea({ value: x.orig || '', rows: 4, onInput: v => { x.orig = v.trim(); } }))]),
    group(withInfo('标签', '大标签点一下选上或去掉，「重要」的事更容易被想起。小标签是这件事属于哪一类具体的事（拍照、喝酒），用、隔开；同一个小标签的事，想起一件会连着想起另外几件。'), [
      h('div.as-mem-imp', h('div.as-chips', M.bigs().map(t => { const c = h('button.as-chip' + (x.big.includes(t) ? '.is-active' : ''), { onclick: () => { x.big = x.big.includes(t) ? x.big.filter(q => q !== t) : [...x.big, t]; c.classList.toggle('is-active'); } }, t); return c; }))),
      field('小标签', input({ value: x.tags, onInput: v => { x.tags = v; } }))]),
    group(withInfo('想起', '高光：聊到沾边的事时更容易想起来。噪声：留着，但不会自己想起来，只记得有过这件事。拿不准：TA 提起时会留余地，不说死。噪声和拿不准整理时 AI 会自己标，可以改。'), [h('div.as-mem-imp', segmented([['', '一般'], ['hi', '高光'], ['no', '噪声'], ['doubt', '拿不准']], x.mark || '', v => { x.mark = v; }))]),
    group(withInfo('钉住和撤回', '钉住：每次聊天都带上这件事，聊什么 TA 都不会忘。撤回：这件事留着，但 TA 先不记得，点「恢复」就又记得了。'), [h('div.as-mem-imp', h('div.as-mem-acts', flag('pin', '取消钉住', '钉住'), flag('off', '恢复', '撤回'),
      btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这件事？', confirm: '删除', danger: true }))) return; d.ev.splice(d.ev.indexOf(e), 1); await M.save(); nav.pop(); })))]),
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

/* ---------- 未落的沙：自动记下的先放这里，点「落下」TA 才会记得 ---------- */
async function openWait() {
  const p = page({ app: 'memory', id: 'memory-wait', title: '未落的沙', back: true }), d = await M.load(), none = empty('都看完了');
  const from = s => s.startsWith('story:') ? `正文第 ${s.slice(6)} 层` : s.startsWith('chat:') ? '手机聊天' : s;
  const what = x => [...x.ev.map(e => [e.title, `${ymd(e.at)} · ${e.text}`]), ...(x.places || []).map(q => [q.name, q.intro || '新去的地方']), ...x.rel.map(r => [`${r.a}和${r.b}：${r.kind}`, r.now]), ...x.facts.map(f => [`${f.about}：${f.text}`, '了解']),
    ...x.days.map(y => [y.what, y.kind]), ...x.todo.map(t => [t.text, '没完的事']), ...x.done.map(t => [t.text, '做完了']), ...x.ppl.map(q => [q.name, q.who || '新出场的人'])];
  none.hidden = d.wait.length > 0;
  p.body.append(...d.wait.map(w => {
    const el = h('div.as-mem-wait', group(from(w.src), what(w.x).map(([title, sub]) => item({ title, sub }))), h('div.as-mem-acts', btn('不要', 'secondary', () => done(false)), btn('落下', 'primary', () => done(true))));
    const done = async ok => { await M.settle(w, ok); el.remove(); none.hidden = d.wait.length > 0; };
    return el;
  }), none);
  nav.push(p.el);
}

/* ---------- 整理 ---------- */
let src = 'chat';
function openSort() {
  // 上次在这里挑的都记着（作者：每次进来都要重新点）：来源、哪本世界书、关掉的条目、整理哪些、补充还是重新生成、带不带你发的
  const last = S().sort || (S().sort = {}), remember = () => { Object.assign(last, { src, book: book.name, off: book.entries.filter((e, i) => book.off.has(i)).map(e => e.title), want: [...want], redo, withUser: chat.withUser }); commit('apps'); };
  if (last.src) src = last.src;
  const p = page({ app: 'memory', id: 'memory-sort', title: '整理记忆', back: true });
  const pick = h('div'), sum = h('div.as-mem-sum'), act = h('div.as-mem-run');
  // 每种来源各自的选择；parts() 给出要整理的一段段文字
  const book = { name: last.book || (ctx() && ctx().chatMetadata && ctx().chatMetadata.world_info) || '', entries: [], off: new Set() };
  const file = { name: '', got: null, off: new Set() };
  // 要 / 不要哪些标签：记住上次在这里挑的；没挑过就照「上下文与世界书」
  const chat = { withUser: last.withUser ?? true, from: 0, to: Infinity, keep: (S().keep || ctxCfg().keep).slice(), drop: (S().drop || ctxCfg().drop || []).slice(), keepOff: (S().keepOff || ctxCfg().keepOff || []).slice() };
  // 要整理哪些条目：公共的世界书面板（core/bookpanel.js），勾上的拿去整理，点标题展开看内容
  const entryRows = (name, list, off) => bookPanel({ books: [name], load: () => Promise.resolve(list), open: true, on: (n, e) => !off.has(list.indexOf(e)), set: (n, e, v) => { const i = list.indexOf(e); v ? off.delete(i) : off.add(i); count(); remember(); } });
  const parts = () => {
    if (src === 'book') return M.byDate(book.entries.filter((e, i) => !book.off.has(i)).map(e => e.content));
    if (src === 'chat') return M.floorsText(M.chatMsgs(), chat);
    const g = file.got; if (!g) return [];
    return g.msgs ? M.floorsText(g.msgs, chat) : g.entries ? M.byDate(g.entries.filter((e, i) => !file.off.has(i)).map(e => e.content)) : g.text.split(/\n{2,}/);
  };
  let fresh = () => {};   // 楼层、标签一改，下面的预览和层数跟着换
  const count = () => { const ps = src === 'known' ? [] : parts(), n = ps.reduce((a, s) => a + s.length, 0); sum.textContent = n ? `约 ${n} 字` + (want.has('time') ? ` · 分 ${M.batches(ps).length} 批` : '') : ''; fresh(); paintRun(); };
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
    const top = () => Math.min(chat.to, msgs.length - 1), rl = () => `第 ${chat.from} 层 到 第 ${top()} 层`;
    const range = h('button.as-input.as-date', { type: 'button', onclick: async () => {
      const l = msgs.map((_, i) => [i, `第 ${i} 层`]), v = await pickWheels('从第几层到第几层', [[l, chat.from], [l, top()]]); if (!v) return;
      [chat.from, chat.to] = v[0] <= v[1] ? v : [v[1], v[0]]; range.textContent = rl(); count();
    } }, rl());
    return [group('楼层', [toggleItem({ title: '包含你发的楼层' }, chat.withUser, on => { chat.withUser = on; count(); remember(); }),
      field(`从第几层到第几层（一共 ${msgs.length} 层，从 0 数）`, range, n)]),
      group(withInfo('正文筛选', '正文里有的段落用 <标签> 包着。「要」里的标签，里面的字拿去整理（点一下能暂时关掉）；里面不想要的，放进「不要」。两边都没放的标签，在「要」的标签外面就整段去掉。没被标签包着的正文照常整理。'), [keep, drop]),
      group('预览', [h('div.as-field', pre, h('div.as-mem-pvbar', btn('上一层', 'secondary', step(-1)), at, btn('下一层', 'secondary', step(1))))])];
  };

  async function paintPick() {
    const nb = []; fresh = () => {};
    if (src === 'book') {
      nb.push(group('', [item({ title: '世界书', value: book.name || '选一本', chevron: true, onClick: async () => {
        const v = await actionSheet('从哪本世界书整理', worldNames().map(n => ({ value: n, label: n, active: n === book.name })));
        if (v) { book.name = v; book.entries = []; book.off.clear(); remember(); paintPick(); }
      } })]));
      if (book.name && !book.entries.length) {
        try { book.entries = (await loadBook(book.name, true)).filter(e => e.content.trim()); book.entries.forEach((e, i) => (last.book === book.name && (last.off || []).includes(e.title)) && book.off.add(i)); } catch (e) { toast('读不到这本世界书'); }
      }
      if (book.entries.length) nb.push(group('要整理的条目', [h('div.as-field', entryRows(book.name, book.entries, book.off))]));
    } else if (src === 'file') {
      nb.push(group('', [item({ title: withInfo('文件', '能导入三种：酒馆导出的聊天记录（.jsonl）、酒馆导出的世界书（.json）、纯文字（.txt）。'), value: file.name || '选一个', chevron: true, onClick: async () => {
        const f = await pickFile('.json,.jsonl,.txt,text/plain,application/json'); if (!f) return;
        try { file.got = await M.readFile(f); file.name = f.name; file.off.clear(); paintPick(); } catch (e) { toast('这个文件读不出来'); }
      } })]));
      const g = file.got;
      if (g && g.msgs) nb.push(...floors(g.msgs));
      if (g && g.entries) nb.push(group('要整理的条目', [h('div.as-field', entryRows(file.name, g.entries, file.off))]));
    } else if (src === 'known') { /* 不读原文，没什么要挑的 */ }
    else if (M.chatMsgs().length) nb.push(...floors(M.chatMsgs())); else nb.push(empty('现在没有打开酒馆的聊天'));
    pick.replaceChildren(...nb.filter(Boolean)); chips[0].hidden = src === 'known'; count();
  }
  // 下面那一块：开始 / 正在整理第几批（取消）/ 上次没跑完（接着整理、放弃）
  async function paintRun() {
    const j = M.running(), left = j ? null : await M.leftover();
    if (j) act.replaceChildren(h('div.as-mem-sum', `正在整理「${j.label}」第 ${j.done + 1}/${j.list.length} 批…`), h('div.as-prompt-bar', btn('取消', 'secondary', () => M.cancelJob())));
    else if (left) act.replaceChildren(h('div.as-mem-sum', `「${left.label}」还剩 ${left.list.length - left.done} 批没整理${left.at ? '（这一批写到一半）' : ''}`),
      h('div.as-prompt-bar', btn('放弃', 'secondary', async () => { await M.dropJob(); paintRun(); }), btn('接着整理', 'primary', () => go(left.label, left.list, left.done, left.at, left.opt))));
    else act.replaceChildren(h('div.as-prompt-bar', btn('开始整理', 'primary', async () => {
      const w = Object.keys(M.PARTS).filter(k => want.has(k) && !(src === 'known' && k === 'time')), names = w.map(k => M.PARTS[k]).join('、');
      if (!w.length) { toast('先勾上要整理哪几样'); return; }
      const ps = src === 'known' ? [] : parts(); if (src !== 'known' && !ps.length) { toast('没有要整理的内容'); return; }
      if (redo && !(await dialog({ title: `重新生成${names}？`, text: w.includes('time') ? '现在记着的全部去掉，照这次的内容重新记' : '现在记着的会换成新写的', confirm: '重新生成', danger: true }))) return;
      // 没勾时间：不重新记事，就照已经记下的事把勾上的整套写全（每一对人的关系和印象、每件事在哪、地点归哪），一次发完；选了原文就一起给 AI 参考
      if (w.includes('time')) return go(src === 'book' ? book.name : src === 'file' ? file.name : '当前聊天', M.batches(ps), 0, 0, { want: w, redo });
      try { const n = await waiting(redo ? '正在重新生成…' : '正在补充…', sig => M.refill(w, sig, redo, ps.join('\n\n'))); if (n) { toast([w.includes('rel') && (n.rel ? `关系 ${n.rel} 条（${n.said} 条有一句话）· 了解 ${n.facts} 条 · 成长 ${n.grow} 条` : 'AI 一条关系都没写出来'), w.includes('places') && `地点 ${n.places} 处`, n.cut ? '写到一半断了，再补充一次接着填' : n.miss && `还有 ${n.miss} 对没写全，再补充一次接着填`].filter(Boolean).join(' · ')); refresh(); } }
      catch (e) { toast((redo ? '重新生成' : '补充') + '失败：' + e.message); }
    })));
  }
  function go(label, list, done, at, opt) {
    M.startJob(label, list, done, at, opt).catch(e => toast(e.message));
  }
  // 整理哪几样、怎么整理：补充（只添没有的、填空着的）/ 重新生成（旧的换成新的；勾了「时间」就是全部重来，四样一起勾上）
  const want = new Set(last.want || Object.keys(M.PARTS)); let redo = !!last.redo;
  const paintWant = () => { if (redo && want.has('time')) Object.keys(M.PARTS).forEach(k => want.add(k)); chips.forEach((c, i) => { const k = Object.keys(M.PARTS)[i]; c.classList.toggle('is-active', want.has(k)); c.textContent = (want.has(k) ? '✓ ' : '') + M.PARTS[k]; }); };   // 勾上的前面写 ✓（作者：光看颜色分不出勾没勾）
  const chips = Object.entries(M.PARTS).map(([k, t]) => h('button.as-chip.is-active', { onclick: () => { want.has(k) ? want.delete(k) : want.add(k); paintWant(); count(); remember(); } }, '✓ ' + t));
  paintWant();
  const what = group(withInfo('整理哪些', '时间：发生过的事、纪念日、待办。关系：谁和谁什么关系、怎么看对方、对对方的一句话、知道对方什么，还有每个人的成长线（后来变成什么样了）。地点：去过哪、归哪个大地方。补充：只添没有的、填空着的，已经有的不动。重新生成：勾上的这几样旧的不要了，换成新写的；勾了时间就是全部重来。「记下的事」不读原文，只看已经记下的事来写，很省，但写不了时间。'), [
    h('div.as-mem-imp', h('div.as-chips', chips)), h('div.as-mem-imp', segmented([['add', '补充'], ['redo', '重新生成']], redo ? 'redo' : 'add', v => { redo = v === 'redo'; paintWant(); remember(); }))]);
  const off = M.onJob(() => paintRun());
  p.el._onLeave = off;
  p.body.append(group(withInfo('根据什么', '记下的事：不读原文，让 AI 把已经记下的事回头再理一遍，重新写关系、看法、了解、成长和地点。找一次 AI。'), [h('div.as-mem-src', segmented([['book', '世界书'], ['file', '文件'], ['chat', '当前聊天'], ['known', '记下的事']], src, v => { src = v; remember(); paintPick(); }))]), pick, what, sum, act);
  paintPick();
  nav.push(p.el);
}

/* ---------- 设置：查看、人物和标签、记录、整理、回想、清空 ---------- */
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
  const how = h('div.as-field', h('span.as-field__label', withInfo('记哪些', '有值得记的才记：一个月后要是完全不记得会觉得奇怪或失落的事。比如第一次（约会、吵架）、关系变了、约定、送了或收到什么、新知道的关于某人的事、说出口的秘密、新出场的人、生日节日；吃饭走路这种日常不记。每楼都记：每一楼都记一条。')), segmented([['maybe', '有值得记的才记'], ['every', '每楼都记']], turn, v => { m.story = turn = v; save(); }));
  const every = pick('隔几轮', 'n', 10, [[3], [5], [10], [15], [20], [30]], ' 轮');
  // 默认接在上次整理到的那一楼，能往前挪：以前漏掉的那段下次一起整理（作者要的）
  const atLab = () => `第 ${d.autoAt == null ? M.chatMsgs().length : d.autoAt + 1} 层`;
  const from = item({ title: '从第几层接着', value: atLab(), chevron: true, onClick: async () => {
    const n = M.chatMsgs().length, l = Array.from({ length: n + 1 }, (_, i) => [i, `第 ${i} 层`]);
    const v = await pickWheels('从第几层接着', [[l, d.autoAt == null ? n : Math.min(d.autoAt + 1, n)]]); if (!v) return;
    d.autoAt = v[0] - 1; await M.save(); val(from, atLab());
  } });
  const paint = () => { how.hidden = mode() !== 'turn'; every.hidden = from.hidden = mode() !== 'n'; };
  const label = () => { const v = m.conn.text; return v === 'follow' ? `跟随聊天线（${connLabel(resolveConn('text', 'memory'))}）` : connLabel(resolveConn('text', 'memory')); };
  const connItem = item({ title: '整理用的接口', value: label(), chevron: true, onClick: async () => {
    const v = await actionSheet('整理用的接口', [{ value: 'follow', label: '跟随聊天线', active: m.conn.text === 'follow' }, ...state.connections.text.map(c => ({ value: c.id, label: c.name, active: m.conn.text === c.id }))]);
    if (!v) return; m.conn.text = v; commit('apps'); val(connItem, label());
  } });
  // 单独生成关系用的接口（作者要的：另外一根线，默认跟着聊天）；和「设置 → 应用管理 → 岁岁砂」是同一个
  const relLabel = () => m.conn.rel && m.conn.rel !== 'follow' ? connLabel(M.relConn()) : `跟随聊天（${connLabel(M.relConn())}）`;
  const relItem = item({ title: '单独生成关系用的接口', value: relLabel(), chevron: true, onClick: async () => {
    const v = await actionSheet('单独生成关系用的接口', [{ value: 'follow', label: '跟随聊天', active: !m.conn.rel || m.conn.rel === 'follow' }, ...state.connections.text.map(c => ({ value: c.id, label: c.name, active: m.conn.rel === c.id }))]);
    if (!v) return; m.conn.rel = v; commit('apps'); val(relItem, relLabel());
  } });
  // 写到一半断了自动补写：和「设置 → 应用管理 → 岁岁砂」是同一个开关
  const fillMax = pick('最多补写', 'fillMax', 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [n]), ' 次'); fillMax.hidden = !m.fill;
  const fillOn = toggleItem({ title: withInfo('写到一半断了自动补写', '整理的回复写到一半断了，写出来的先记下，再从断的地方接着整理。每补一次多找一次 AI。没开的话写出来的也会记下，点「接着整理」接着。') }, !!m.fill, on => { m.fill = on; commit('apps'); fillMax.hidden = !on; });
  const rec = group(withInfo('记录', '每轮：正文生成时顺手记下，不另外花钱。每隔几轮：攒够几轮，另外找一次 AI 把这几轮整理一遍，这次没成的下次一起补。只手动：自己去「整理」。'), [
    h('div.as-mem-imp', segmented([['turn', '每轮'], ['n', '每隔几轮'], ['off', '只手动']], mode(), v => { m.story = v === 'turn' ? turn : v; save(); paint(); })), how, every, from,
    fillOn, fillMax,
    toggleItem({ title: withInfo('未落的沙', '自动记下的先停在这里，你点「落下」它才落进沙漏，TA 才记得。') }, !!m.wait, on => { m.wait = on; commit('apps'); }), connItem, relItem]);
  // 回想：按意思找（向量）、再排一遍（重排）、最多想起几件、每件带多少原文、来时路
  const vecTxt = v => !v.conn ? '还没接好' : v.stale ? '要重新算' : `已算 ${v.done} / ${v.total}`;
  const vecRow = item({ title: '向量', value: '', chevron: true, onClick: async () => {
    if (!(await M.vecState()).conn) { toast('先到 设置 → 连接 → 其他，给向量填上密钥'); return; }
    await vecRun((a, b) => val(vecRow, `已算 ${a} / ${b}`)); M.vecState().then(v => val(vecRow, vecTxt(v)));
  } });
  M.vecState().then(v => val(vecRow, vecTxt(v)));
  const rr = toggleItem({ title: withInfo('再排一遍', '向量先找出最像的 20 件，重排模型再从里面挑出最准的。用的是 设置 → 连接 → 其他 里的「重排」。') }, m.rerank !== false, on => { m.rerank = on; commit('apps'); });
  // 正文也按意思找（作者要的，默认开）：只在按意思找开着、正文互通时出现；关了正文就按字面找，手机照旧
  const story = toggleItem({ title: '正文也按意思找' }, m.vecStory !== false, on => { m.vecStory = on; commit('apps'); });
  const vecOn = on => { rr.hidden = vecRow.hidden = !on; story.hidden = !on || state.apps.chat.defaults.linkMode !== 'follow'; };
  vecOn(m.vec !== false);
  const back = group('回想', [
    toggleItem({ title: '聊天时带上记忆' }, m.on, on => { m.on = on; save(); }),
    toggleItem({ title: withInfo('按意思找', '把每件事和你刚说的话各算成一串数字（向量），比哪几件意思最像：说「感觉自己醉了」，也能想起喝酒那次。用的是 设置 → 连接 → 其他 里的「向量」。换了向量模型，以前算好的要重新算一遍；记下的事、关系、地点都不会丢，算好之前先按词找。关掉就只按词找。') }, m.vec !== false, on => { m.vec = on; commit('apps'); vecOn(on); }),
    story, rr, vecRow,
    pick('最多想起几件', 'slots', 3, [[1], [2], [3], [5], [8], [99, '不限']], ' 件'),
    pick('每件带多少原文', 'origMax', 500, [[200], [500], [1000], [2000], [0, '不限']], ' 字'),
    toggleItem({ title: withInfo('来时路', '每轮都带一份经历过的事的目录（日期、地点、标题，最多 60 件），TA 一直知道自己经历过什么；每轮的字数会多一些。') }, !!m.road, on => { m.road = on; commit('apps'); })]);
  p.body.append(
    group('', [d.wait.length ? item({ title: '未落的沙', value: String(d.wait.length), chevron: true, onClick: openWait }) : null, item({ title: '刚才想起了什么', chevron: true, onClick: openPeek })].filter(Boolean)),
    group('', [item({ title: '人物', chevron: true, onClick: openPeople }), item({ title: '标签', chevron: true, onClick: openTags }), item({ title: '整理', chevron: true, onClick: openSort })]),
    rec, back,
    group('', [item({ title: '清空', danger: true, onClick: () => {
      // 挑清空哪几样（作者：不要只能全清）；四样都勾就是整个清空，连向量一起
      const want = new Set();
      const chips = Object.entries(M.PARTS).map(([k, t]) => h('button.as-chip', { onclick: () => { want.has(k) ? want.delete(k) : want.add(k); paint(); } }, t));
      const all = h('button.as-chip', { onclick: () => { const on = want.size < chips.length; Object.keys(M.PARTS).forEach(k => on ? want.add(k) : want.delete(k)); paint(); } }, '全选');
      const paint = () => { chips.forEach((c, i) => { const k = Object.keys(M.PARTS)[i]; c.classList.toggle('is-active', want.has(k)); c.textContent = (want.has(k) ? '✓ ' : '') + M.PARTS[k]; }); all.classList.toggle('is-active', want.size === chips.length); };
      const s = sheet({ title: '清空哪些', content: [h('div.as-mem-imp', h('div.as-chips', all, chips)),
        h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('清空', 'danger', async () => {
          if (!want.size) { toast('先勾上要清空哪几样'); return; }
          const names = Object.keys(M.PARTS).filter(k => want.has(k)).map(k => M.PARTS[k]).join('、');
          if (!(await dialog({ title: `清空${names}？`, text: '删掉就找不回来。设置和标签留着。', confirm: '清空', danger: true }))) return;
          s.close(); await M.clearSome([...want]); toast('已清空'); val(vecRow, vecTxt(await M.vecState())); refresh();
        }))] });
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
      group(withInfo('大标签', '一件事属于哪一大类，AI 记事时从这里挑。「重要」「纪念日」「秘密」容易被想起，「日常」很像才想起，别的居中。'), [...M.bigs().map(t => item({ title: t, sub: `${d.ev.filter(e => e.big.includes(t)).length} 件`, chevron: true, onClick: edit(t, M.rebig, true) })),
        item({ icon: icon('plus', 18, 2), title: '加一个', onClick: async () => { const to = await ask('加一个大标签', ''); if (!to || M.bigs().includes(to)) return; await M.rebig('', to); draw(); } })]),
      small.length ? group(withInfo('小标签', '具体的一类事（拍大头贴、喝酒、告白）。同一个小标签的事，想起一件会连着想起另外几件。改成已有的名字，两个就并成一个。'), small.map(([t, k]) => item({ title: t, sub: `${k} 件`, chevron: true, onClick: edit(t, M.retag) }))) : null);
  }
  p.body.append(box); draw();
  nav.push(p.el);
}
