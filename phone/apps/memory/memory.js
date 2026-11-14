// 岁岁砂：TA 们记得的事（方案见 docs/pages-memory.md）。
// 首页是一张画、三页：时间（沙漏，往下漏的那道沙是时间轴）/ 关系（轨道，谁都能当中心）/ 地点（迷雾地图，大地方里套小地点）。
// 关系那页顶上有一排名字：点谁（或把星拖到正中），谁就是中心。时间和地点对谁都一样，不分人看（作者定的）。
// 右上角设置：人物、记录、整理、回想、标签、清空。整理在核心 core/memory.js 里跑，退出这页也接着跑；同一时间只跑一个。
import { h, pickFile, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, toggleItem, switchEl, segmented, input, textarea, field, btn, icon, actionSheet, dialog, toast, empty, navBtn, sheet, withInfo, waiting, sortable, pickImage, colorFor } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { worldNames, ctx } from '../../core/bridge.js';
import { loadBook, C as ctxCfg } from '../../core/context.js';
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
  const bar = h('div.as-ss-who.off', { dataset: { noSwipe: '' } }), stage = h('div.as-ss-stage.up'), axis = h('div.as-ss-axis'), paper = h('aside.as-ss-paper', { 'aria-live': 'polite' });
  const tabs = h('nav.as-ss-tabs', ['时间', '关系', '地点'].map((t, i) => h('button' + (i ? '' : '.on'), { onclick: () => go(i) }, t)));
  p.body.append(bar, stage, axis); p.el.append(tabs, paper);
  let d = null, names = [], link = [], ctr = 0, tab = 0, seen = '', opened = null, loose = [];
  const more = h('button.as-ss-back.as-ss-loose', { hidden: true, onclick: () => show('没归类的地点', '', '只出现过一次、也不属于哪个大地方', '', loose.map(n => li('', n, '', '', () => openPlace(n))), '') });
  stage.append(more);
  const shut = () => { if (!paper.classList.contains('on')) return false; paper.classList.remove('on'); A.mark(); return true; };
  const A = art(stage, { blank: shut, rel: openRel, self: openSelf, center: i => setCtr(i), place: openPlace });
  const sig = () => M.ver + ':' + state.contacts.length;
  // 一页装得下就不让拉动（作者：没有别的内容，拉得动很怪）；事多了、点开一件变长了才能滑
  // 关系、地点下面没有东西；时间那页还没记下事时也一样：都定住（小屏上画加页签会比屏幕高一点，也不让拉）
  const fit = () => { p.body.style.overflowY = tab || !d || !d.ev.length || p.body.scrollHeight <= p.body.clientHeight + 1 ? 'hidden' : ''; if (p.body.style.overflowY) p.body.scrollTop = 0; };

  // 底下那张纸：地点和人共用
  const show = (title, small, lead, intro, rows, none, acts) => {
    paper.replaceChildren(h('button.x', { onclick: shut }, '收起'), ...(title instanceof Node ? [title] : [h('h4', title, small && h('small', small)), lead && h('p.lead', lead), intro && h('p', intro)]),
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
    const A = new Date(t0 + 'T00:00'), B = time.isStory() && time.story().date || new Date(); if (B < A) return [0, 0, 0, 0, t0];
    let y = B.getFullYear() - A.getFullYear(), m = B.getMonth() - A.getMonth(), dd = B.getDate() - A.getDate();
    if (dd < 0) { m--; dd += new Date(B.getFullYear(), B.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return [y, m, dd, Math.round((new Date(B.getFullYear(), B.getMonth(), B.getDate()) - A) / 864e5), t0];
  };
  /* 上面那幅画（作者给的参考：平面构成，点、线、面）：几圈同心的弧和一圈圆点（和星盘呼应），前后叠着四层平涂的云，云上贴一小块网点、一小块细条纹，几颗四角星。
     最亮的那朵云里写那句话；左边的圆是头像，三个小点从头像飘向那朵云。颜色只用钴蓝的深浅和一点奶黄 */
  const PIC = (() => {
    const cloud = (cs, r) => cs.map(c => `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}"/>`).join('') + `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="9"/>`;
    const C = [cloud([[40, 142, 24], [72, 118, 34], [112, 98, 40], [150, 114, 30]], [18, 132, 164, 44]), cloud([[182, 100, 30], [220, 68, 44], [266, 88, 40], [304, 116, 28]], [162, 108, 150, 68]),
      cloud([[122, 150, 22], [156, 130, 34], [198, 108, 44], [248, 120, 38], [288, 140, 26]], [102, 142, 212, 40]), cloud([[30, 184, 13], [50, 176, 17], [74, 185, 12]], [18, 184, 68, 12]), cloud([[262, 182, 13], [284, 174, 18], [310, 184, 12]], [250, 182, 72, 12])];
    const star = (x, y, r, c) => `<path class="tw" fill="${c}" d="M${x} ${y - r}Q${x + r * .16} ${y - r * .16} ${x + r} ${y}Q${x + r * .16} ${y + r * .16} ${x} ${y + r}Q${x - r * .16} ${y + r * .16} ${x - r} ${y}Q${x - r * .16} ${y - r * .16} ${x} ${y - r}Z"/>`;
    const put = (i, fill, tex) => `<use href="#as-ss-c${i}" class="o"/><use href="#as-ss-c${i}" fill="${fill}"/>` + (tex ? `<rect clip-path="url(#as-ss-k${i})" ${tex}/>` : '');
    return '<svg viewBox="0 0 342 200" aria-hidden="true"><defs>'
      + '<pattern id="as-ss-dot" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1"/></pattern><pattern id="as-ss-dot2" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" class="b"/></pattern><pattern id="as-ss-bar" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.3"/></pattern>'
      + C.map((c, i) => `<g id="as-ss-c${i}">${c}</g><clipPath id="as-ss-k${i}">${c}</clipPath>`).join('') + '</defs>'
      + '<g fill="none"><circle cx="118" cy="112" r="98" stroke="var(--soft)" stroke-width=".7"/><circle cx="118" cy="112" r="86" stroke="var(--b2)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="0 13.5"/>'
      + '<circle cx="118" cy="112" r="72" stroke="var(--blue)" stroke-width="2.2"/><circle cx="118" cy="112" r="62" stroke="var(--cream)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0 5"/><circle cx="118" cy="112" r="54" stroke="var(--soft)" stroke-width=".6"/>'
      + '<path d="M196 22H318M210 30H300" stroke="var(--soft)" stroke-width=".6"/><ellipse cx="262" cy="58" rx="78" ry="20" transform="rotate(-16 262 58)" stroke="var(--blue)" stroke-width=".8" stroke-dasharray="1.5 4"/></g>'
      + put(0, 'var(--blue)', 'x="84" y="62" width="74" height="52" fill="url(#as-ss-dot)" class="t1"') + put(1, 'var(--b2)', 'x="244" y="60" width="70" height="46" fill="url(#as-ss-bar)" class="t2"')
      + put(2, 'var(--b4)', 'x="252" y="136" width="64" height="46" fill="url(#as-ss-dot2)" class="t3"') + put(3, 'var(--b3)') + put(4, 'var(--b3)', 'x="250" y="170" width="40" height="24" fill="url(#as-ss-bar)" class="t2"')
      + '<circle cx="62" cy="128" r="35" class="o"/><ellipse cx="62" cy="128" rx="50" ry="15" transform="rotate(-24 62 128)" fill="none" stroke="var(--cream)" stroke-width="1.1"/><circle cx="17" cy="148" r="3.2" fill="var(--cream)"/>'
      + '<g fill="var(--b4)" stroke="var(--card)" stroke-width="1.5"><circle cx="103" cy="110" r="3.6"/><circle cx="116" cy="101" r="5.2"/><circle cx="133" cy="97" r="7"/></g>'
      + '<g fill="var(--blue)"><rect x="322" y="38" width="5" height="5"/><rect x="330" y="46" width="3" height="3"/><rect x="8" y="80" width="4" height="4"/></g>'
      + star(238, 40, 13, 'var(--cream)') + star(304, 62, 6, 'var(--b4)') + star(170, 30, 6, 'var(--blue)') + star(28, 104, 5, 'var(--cream)') + star(322, 150, 7, 'var(--cream)') + star(204, 186, 5, 'var(--blue)') + '</svg>';
  })();
  function openRel(i) {
    const lk = link[ctr][i], me = names[ctr], who = names[i], cs = ctr ? new Set([me]) : new Set([names[0], '我']), r = lk.r;
    const facts = d.facts.filter(f => (i ? f.about === who : M.isMe(f.about)) && M.knownOf(f, cs) != null);
    const path = [...r.hist.map(x => x.kind), r.kind].filter((k, j, l) => k !== '其他' && k !== l[j - 1]), t = since(me, who, r);
    // 认识了多久：点一下在「几年几个月几天」和「一共多少天」之间换（记在设置里），只换这几个字
    const long = h('button.long', { disabled: !t, onclick: () => { S().days = !S().days; commit('apps'); fillLong(); } });
    const num = (n, u) => h('span', String(n), h('i', u));
    const fillLong = () => long.replaceChildren(h('small', '认识了'), h('b', !t ? '—' : S().days ? num(t[3], '天') : [t[0] && num(t[0], '年'), (t[0] || t[1]) && num(t[1], '个月'), num(t[2], '天')].filter(Boolean)), t && h('em', dot(t[4]) + ' 起'));
    fillLong();
    const pic = h('div.pic', { html: PIC }); pic.append(face(me), h('p', h('small', `${me} 对 ${who}`), lk.say ? `「${lk.say}」` : h('em', '……')));
    show(h('div.as-ss-rel', pic,
      h('div.cells',
        h('div.kin', h('div', h('small', '现在'), h('b', path[path.length - 1] || '—')), path.length > 1 && h('span', path.join(' → '))),
        long,
        h('div.view', h('small', '看法'), h('p', lk.q[0] || h('em', '还没写')), h('i'), h('i'), h('i'), h('i'))),
      r.now && h('p.now', r.now)), '', '', '',
      facts.map(f => li('了解', M.knownOf(f, cs), '', f.know.join('、') + '知道', () => editFact(f))), '',
      [btn('改', 'secondary', () => editRel(r)), btn('加一条了解', 'secondary', () => editFact(null, who))]);
  }
  // 点正中这个人自己：TA 是怎么一步步变成现在这样的（成长），按先后
  function openSelf() {
    const who = names[ctr], l = d.grow.filter(g => ctr ? g.who === who : M.isMe(g.who)).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
    show(who, '人物簿', '', '', l.map(g => li(dot(g.at), g.text, g.why && '因为：' + g.why, '', () => editGrow(g))), '还没有记下 TA 的变化', [btn('加一条', 'secondary', () => editGrow(null, who))]);
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
    const b = row((e.pin ? '.pin' : '') + (e.mark === 'hi' || e.big.includes('重要') ? '.hi' : '') + (e.mark === 'no' ? '.noise' : ''), t, e.title, [e.part, e.place].filter(Boolean).join(' · '), () => toggle(b, e),
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
      for (const g of [...M.bigs(), '']) {
        const l = cards.filter(c => c[2] === g || (!g && !M.bigs().includes(c[2]))); if (!l.length) continue;
        rows.push(h('div.as-ss-cat', h('em', g || '没分类'), h('div', l.map(([t, es]) => h('button', { onclick: () =>
          show(t, `${es.length} 件`, '', '', es.map(e => li(dot(e.at), e.title, e.text, [e.part, e.place].filter(Boolean).join(' · '), () => editEvent(e))), '') }, t, h('small', String(es.length)))))));
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
    tab = i; shut(); A.tab(i); [...tabs.children].forEach((b, k) => b.classList.toggle('on', k === i)); axis.classList.toggle('off', i > 0); bar.classList.toggle('off', i !== 1); stage.classList.toggle('up', !i); more.classList.toggle('on', i === 2); p.body.scrollTo({ top: 0, behavior: 'smooth' });
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
      const st = [{ ...r, title: [r.kind !== '其他' && r.kind, r.now].filter(Boolean).join('，') }, ...[...r.hist].reverse().map(x => ({ ...x, title: x.kind }))];
      const mk = v => ({ kind: r.kind, r, say: r['s' + v[1]] || '', st: st.map(x => [x.since || '', x.title, 5 - M.lvOf(x)]), q: st.map(x => x[v] || '') });
      link[i][j] = mk('va'); link[j][i] = mk('vb');
    }
    // 地图：外面一层只放主要的（作者：次要的不要放首页）= 大地方，和发生过两件事以上的单独地点；只出过一次、又没归属的零散地点不上图，收在右上角「没归类」里。
    // 没写归属、但名字里带着某个大地方全名的，算那个大地方的。每个大地方里最多摆 14 个小地点（事多的在前），其余的点大地方的名字在纸上看。没拖过的按向日葵那样一圈圈摆开
    const junk = a => !a || /^[（(].*[)）]$|^(空|无|不知道|未知)$/.test(a) ? '' : a;   // AI 有时把「（空）」写进归属
    const pl = new Map(d.places.map(q => [q.name, q])), cnt = new Map();
    for (const e of d.ev) if (e.place) { cnt.set(e.place, (cnt.get(e.place) || 0) + 1); if (!pl.has(e.place)) pl.set(e.place, { name: e.place }); }
    const big = [...new Set([...pl.values()].map(q => junk(q.area)).filter(Boolean))];
    const areaOf = q => junk(q.area) || big.find(a => a !== q.name && q.name.includes(a)) || '';
    loose = [...pl.values()].filter(q => !areaOf(q) && !big.includes(q.name) && pl.size > 12 && (cnt.get(q.name) || 0) < 2).map(q => q.name);
    more.textContent = `没归类 ${loose.length}`; more.hidden = !loose.length;
    const spots = [...big, ...[...pl.values()].filter(q => !areaOf(q) && !big.includes(q.name) && !loose.includes(q.name)).map(q => q.name)];
    const at = n => { const k = spots.indexOf(n), a = k * 2.4, r = 165 * Math.sqrt((k + .5) / spots.length); return { x: Math.round(200 + Math.cos(a) * r), y: Math.round(250 + Math.sin(a) * r * 1.15) }; };
    const last = [...d.ev].reverse().find(e => e.place);
    A.set({ names, link, here: (time.isStory() && time.story().place) || (last ? last.place : ''),
      areas: big.map(n => { const all = [...pl.values()].filter(q => areaOf(q) === n).map(q => q.name).sort((a, b) => (cnt.get(b) || 0) - (cnt.get(a) || 0)); return { name: n, ...at(n), all, list: all.slice(0, 14) }; }),
      lone: spots.slice(big.length).map(n => ({ name: n, ...at(n) })) });
    bar.replaceChildren(...names.map((n, i) => h('button', { onclick: () => setCtr(i) }, n)), h('button.more', { onclick: openPeople }, '更多'));
    fillAxis(); setCtr(Math.max(0, names.indexOf(was)), false);
  }
  refresh = draw;
  draw().then(vecCheck); p.el._onShow = draw;
  return p.el;
}

/* ---------- 抽屉：改关系、日子、了解、地点 ---------- */
async function editRel(r) {
  const d = await M.load(), x = { kind: r.kind, since: r.since, now: r.now, lv: M.lvOf(r), va: r.va || '', vb: r.vb || '', sa: r.sa || '', sb: r.sb || '' };
  const s = sheet({ title: `${r.a} 和 ${r.b}`, content: [
    segmented(M.KINDS.map(k => [k, k]), x.kind, v => { x.kind = v; }),
    field('从什么时候起', input({ value: x.since, onInput: v => { x.since = v.trim(); } })),
    field('现在怎样', input({ value: x.now, onInput: v => { x.now = v.trim(); } })),
    field(withInfo('亲近度', '5 最亲。关系页上越亲的离得越近。'), segmented([0, 1, 2, 3, 4, 5].map(n => [n, String(n)]), x.lv, v => { x.lv = v; })),
    field(`${r.a}眼里的${r.b}`, textarea({ value: x.va, rows: 2, onInput: v => { x.va = v.trim(); } })),
    field(`${r.a}对${r.b}说的一句话`, input({ value: x.sa, onInput: v => { x.sa = v.trim(); } })),
    field(`${r.b}眼里的${r.a}`, textarea({ value: x.vb, rows: 2, onInput: v => { x.vb = v.trim(); } })),
    field(`${r.b}对${r.a}说的一句话`, input({ value: x.sb, onInput: v => { x.sb = v.trim(); } })),
    h('div.as-mem-acts', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这段关系？', confirm: '删除', danger: true }))) return; d.rel.splice(d.rel.indexOf(r), 1); await M.save(); s.close(); refresh(); })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
      if (x.kind !== r.kind) r.hist.push({ kind: r.kind, since: r.since, lv: r.lv, va: r.va, vb: r.vb });
      Object.assign(r, x); await M.save(); s.close(); refresh();
    })),
  ] });
}
async function editGrow(o, who = '') {
  const d = await M.load(), x = o ? { at: o.at, text: o.text, why: o.why } : { at: '', text: '', why: '' };
  const s = sheet({ title: o ? o.who : who, content: [
    field('哪天', input({ value: x.at, placeholder: '年-月-日', onInput: v => { x.at = v.trim(); } })),
    field(withInfo('变了什么', '写成「以前怎样 → 现在怎样」。TA 以后说话做事会照现在的样子来，和人设不一样的以这里为准。'), textarea({ value: x.text, rows: 2, onInput: v => { x.text = v.trim(); } })),
    field('因为哪件事', input({ value: x.why, onInput: v => { x.why = v.trim(); } })),
    o ? h('div.as-mem-acts', btn('删除', 'danger', async () => { if (!(await dialog({ title: '删除这一条？', confirm: '删除', danger: true }))) return; d.grow.splice(d.grow.indexOf(o), 1); await M.save(); s.close(); refresh(); })) : null,
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', async () => {
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
  const bigs = [...new Set(d.places.map(q => q.area).filter(a => a && a !== n))];
  const area = input({ value: x.area, onInput: v => pick(v.trim(), true) });
  const pick = (a, typed) => { x.area = a; if (!typed) area.value = a; chips.forEach(c => c.classList.toggle('is-active', c.textContent === a)); };
  const chips = bigs.map(a => h('button.as-chip' + (a === x.area ? '.is-active' : ''), { onclick: () => pick(a === x.area ? '' : a) }, a));
  const s = sheet({ title: n, content: [
    field(withInfo('归哪个大地方', '选了就收进那个大地方里：地图上先看到大地方，点进去才看到它。不属于哪里就都不选；要新的大地方就自己写。'), area),
    h('div.as-mem-imp', h('div.as-chips', chips)),
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
  const count = () => { const ps = src === 'known' ? [] : parts(), n = ps.reduce((a, s) => a + s.length, 0); sum.textContent = n ? `约 ${n} 字 · 分 ${M.batches(ps).length} 批` : ''; fresh(); paintRun(); };
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
      if (src !== 'known') return go(src === 'book' ? book.name : src === 'file' ? file.name : '当前聊天', M.batches(ps), 0, 0, { want: w, redo });
      try { const n = await waiting(redo ? '正在重新生成…' : '正在补充…', (sig, got) => M.refill(w, sig, redo, got)); if (n) { toast(w.map(k => `${M.PARTS[k]} ${n[k]} 条`).join(' · ')); refresh(); } }
      catch (e) { toast((redo ? '重新生成' : '补充') + '失败：' + e.message); }
    })));
  }
  function go(label, list, done, at, opt) {
    M.startJob(label, list, done, at, opt).catch(e => toast(e.message));
  }
  // 整理哪几样、怎么整理：补充（只添没有的、填空着的）/ 重新生成（旧的换成新的；勾了「时间」就是全部重来，四样一起勾上）
  const want = new Set(Object.keys(M.PARTS)); let redo = false;
  const paintWant = () => { if (redo && want.has('time')) Object.keys(M.PARTS).forEach(k => want.add(k)); chips.forEach((c, i) => c.classList.toggle('is-active', want.has(Object.keys(M.PARTS)[i]))); };
  const chips = Object.entries(M.PARTS).map(([k, t]) => h('button.as-chip.is-active', { onclick: () => { want.has(k) ? want.delete(k) : want.add(k); paintWant(); } }, t));
  const what = group(withInfo('整理哪些', '时间：发生过的事、纪念日、待办。关系：谁和谁什么关系、怎么看对方、知道对方什么。地点：去过哪、归哪个大地方。人物簿：一个人后来变成什么样了。补充：只添没有的、填空着的，已经有的不动。重新生成：勾上的这几样旧的不要了，换成新写的；勾了时间就是全部重来。「记下的事」不读原文，只看已经记下的事来写，很省，但写不了时间。'), [
    h('div.as-mem-imp', h('div.as-chips', chips)), h('div.as-mem-imp', segmented([['add', '补充'], ['redo', '重新生成']], 'add', v => { redo = v === 'redo'; paintWant(); }))]);
  const off = M.onJob(() => paintRun());
  p.el._onLeave = off;
  p.body.append(group('', [h('div.as-mem-src', segmented([['book', '世界书'], ['file', '文件'], ['chat', '当前聊天'], ['known', '记下的事']], src, v => { src = v; paintPick(); }))]), pick, what, sum, act);
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
  const paint = () => { how.hidden = mode() !== 'turn'; every.hidden = mode() !== 'n'; };
  const label = () => { const v = m.conn.text; return v === 'follow' ? `跟随聊天线（${connLabel(resolveConn('text', 'memory'))}）` : connLabel(resolveConn('text', 'memory')); };
  const connItem = item({ title: '整理用的接口', value: label(), chevron: true, onClick: async () => {
    const v = await actionSheet('整理用的接口', [{ value: 'follow', label: '跟随聊天线', active: m.conn.text === 'follow' }, ...state.connections.text.map(c => ({ value: c.id, label: c.name, active: m.conn.text === c.id }))]);
    if (!v) return; m.conn.text = v; commit('apps'); val(connItem, label());
  } });
  // 写到一半断了自动补写：和「设置 → 应用管理 → 岁岁砂」是同一个开关
  const fillMax = pick('最多补写', 'fillMax', 3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [n]), ' 次'); fillMax.hidden = !m.fill;
  const fillOn = toggleItem({ title: withInfo('写到一半断了自动补写', '整理的回复写到一半断了，写出来的先记下，再从断的地方接着整理。每补一次多找一次 AI。没开的话写出来的也会记下，点「接着整理」接着。') }, !!m.fill, on => { m.fill = on; commit('apps'); fillMax.hidden = !on; });
  const rec = group(withInfo('记录', '每轮：正文生成时顺手记下，不另外花钱。每隔几轮：攒够几轮，另外找一次 AI 把这几轮整理一遍，这次没成的下次一起补。只手动：自己去「整理」。'), [
    h('div.as-mem-imp', segmented([['turn', '每轮'], ['n', '每隔几轮'], ['off', '只手动']], mode(), v => { m.story = v === 'turn' ? turn : v; save(); paint(); })), how, every,
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
    group('', [item({ title: '人物', chevron: true, onClick: openPeople }), item({ title: '标签', chevron: true, onClick: openTags }), item({ title: '整理', chevron: true, onClick: openSort })]),
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
      group(withInfo('大标签', '一件事属于哪一大类，AI 记事时从这里挑。「重要」「纪念日」「秘密」容易被想起，「日常」很像才想起，别的居中。'), [...M.bigs().map(t => item({ title: t, sub: `${d.ev.filter(e => e.big.includes(t)).length} 件`, chevron: true, onClick: edit(t, M.rebig, true) })),
        item({ icon: icon('plus', 18, 2), title: '加一个', onClick: async () => { const to = await ask('加一个大标签', ''); if (!to || M.bigs().includes(to)) return; await M.rebig('', to); draw(); } })]),
      small.length ? group(withInfo('小标签', '具体的一类事（拍大头贴、喝酒、告白）。同一个小标签的事，想起一件会连着想起另外几件。改成已有的名字，两个就并成一个。'), small.map(([t, k]) => item({ title: t, sub: `${k} 件`, chevron: true, onClick: edit(t, M.retag) }))) : null);
  }
  p.body.append(box); draw();
  nav.push(p.el);
}
