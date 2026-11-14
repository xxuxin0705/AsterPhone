// 岁岁砂：手机里的 TA 记得的事（方案见 docs/pages-memory.md）。
// 每个酒馆聊天窗口一份，存在 kv 的 mem:窗口 里：
//   ev 事件 / rel 关系（两人一条，只记一次）/ ppl 人物 / days 特殊日子 / todo 没完的事 / trees 有树的 TA（联系人 id）
//   facts 了解（关于某人长期不太变的事：喜好、怕什么、酒量…，带「谁知道」：每个人知道的不一样）
//   wait 等你看（自动记下、你还没点「留下」的，一处一批）/ places 地点（一句介绍、归哪个大地方、在地图上拖到了哪）
//   show、order 名字行上显示谁、怎么排（你在设置里定的）/ autoAt 每隔几轮自动整理到了第几楼
// 每件事的向量（按意思找用）另外存在 memvec:窗口 里：{ model, v: { 事件 id: 向量 } }，换了向量模型要重算。
// 记忆从三处来：① 整理（世界书、导入的文件、当前聊天切成一批批交给 AI，同一时间只跑一个，断了能接着跑，kv 的 memjob:窗口）；
// ② 跟着剧情自动记（正文里的 <astermem> 暗号，core/sync.js 读到交给 fromStory）；③ 手机聊天自动记（TA 回消息时顺手写的 <astermem>，交给 fromChat）。
// 三处写的都是同一种行（见 parse），同一件事只记一次。
import { state, commit, win, kvGet, kvSet, kvDel } from './store.js';
import { uid } from './util.js';
import { generate, resolveConn, connOfTag, keysOf, embed, rerank } from './api.js';
import { compose, myName } from './promptstore.js';
import { cleanText, C as ctxCfg } from './context.js';
import { log, apiLog } from './log.js';
import { ctx } from './bridge.js';
import * as time from './time.js';

export const KINDS = ['恋人', '暧昧', '家人', '朋友', '对手', '其他'];
export const DAY_KINDS = ['生日', '纪念日', '祭日', '节日', '其他'];
const BATCH = 100000;   // 一批最多多少字（作者：好模型一次能吃十几万 token，不用切得太碎；回复写不完由下面的「接着整理」接上）
const END = '【整理完了】';   // 整理的提示词让 AI 写完最后写这一行：没有就是写到一半断了
// 大标签：出厂这 9 个，能自己加、改名、删（存在设置里）。前三个容易被想起，「日常」很像才想起，其余居中
export const BIG = ['重要', '纪念日', '秘密', '亲密', '吵架', '战斗', '出游', '低谷', '日常'];
export const bigs = () => state.apps.memory.big || BIG;
export const bigNames = () => bigs().join('、');
const EASY = new Set(['重要', '纪念日', '秘密']);
// 没写亲近度的关系，按是什么关系算（0～5，轨道上离多近）
const LV = { 恋人: 5, 暧昧: 4, 家人: 4, 朋友: 3, 对手: 1, 其他: 2 };
export const lvOf = r => r.lv ?? LV[r.kind] ?? 2;
const AUTO = '自动整理', HERE = new Set([AUTO, '现在整理', '当前聊天']);   // 这几种整理的是现在这个聊天：记下每件事出自第几楼

/* ---------- 存 ---------- */
let D = null, Dkey = null;
export let ver = 0;   // 改过一次加一：页面返回时看它变没变，没变就不重画
const blank = () => ({ ev: [], rel: [], ppl: [], days: [], todo: [], trees: [], facts: [], wait: [], places: [], grow: [] });
export async function load() {
  if (D && Dkey === win.key) return D;
  const k = win.key, d = await kvGet('mem:' + k);
  if (k !== win.key) return load();   // 读的时候换了窗口
  D = Object.assign(blank(), d); Dkey = k; ver++;
  D.ev.forEach(upgrade);
  if ((state.apps.memory.big || []).includes('特殊日')) state.apps.memory.big = [...new Set(state.apps.memory.big.map(t => t === '特殊日' ? '纪念日' : t))];
  // 收拾上面说的那个错：别名里的「（空）」去掉，被它带进「后来听说的人」里的那个人也拿掉
  for (const q of D.ppl) if (q.alias.some(a => NONE.test(a))) {
    q.alias = q.alias.filter(a => !NONE.test(a));
    for (const e of D.ev) { if (e.know) e.know = e.know.filter(n => n !== q.name); if (NONE.test(e.quote || '')) e.quote = ''; }
  }
  // 以前记下的带括号注解的人名收拾掉：事里的并回本人，人物表里重复的合成一个
  for (const e of [...D.ev, ...D.wait.flatMap(w => w.ev || [])]) { e.who = [...new Set(e.who.map(bare))]; if (e.know) e.know = [...new Set(e.know.map(bare))]; }
  for (const q of [...D.ppl]) { const n = bare(q.name); if (n === q.name) continue; const o = D.ppl.find(p => p.name === n); if (o) { if (!o.who) o.who = q.who; D.ppl.splice(D.ppl.indexOf(q), 1); } else q.name = n; }
  for (const r of [...D.rel, ...D.rel.flatMap(r => r.hist)]) for (const k of ['va', 'vb', 'now']) if (NONE.test(r[k] || '')) r[k] = '';   // 关系里的「（空）」也一样
  return D;
}
export const save = () => { ver++; return kvSet('mem:' + Dkey, D); };
/** 以前记的事（存着的、还在「等你看」里的）没有大标签：重要度 4 以上的算「重要」；以前的「故事线」并进小标签 */
const upgrade = e => { if (e.big && e.big.includes('特殊日')) e.big = [...new Set(e.big.map(t => t === '特殊日' ? '纪念日' : t))];   // v0.8.368 前这个大标签叫「特殊日」
  if (!e.big) { e.big = e.imp >= 4 ? ['重要'] : []; if (e.line && !e.tags.includes(e.line)) e.tags.push(e.line); } };

/* ---------- 名字 ---------- */
const norm = s => String(s || '').trim();
/** 这个人的所有叫法：联系人的真名、网名、备注，加上人物表里记的别名 */
export function namesOf(c) {
  const out = new Set([c.name, c.nick, c.remark].map(norm).filter(Boolean));
  for (const p of (D && D.ppl) || []) if ([p.name, ...p.alias].some(n => out.has(n))) [p.name, ...p.alias].forEach(n => out.add(n));
  return out;
}
function isMe(n) { return n === myName() || n === '我' || n === '{{user}}'; }
/** 知道这件事的人：在场的，加上后来听说的 */
export const knows = e => [...new Set([...e.who, ...(e.know || [])])];
export const evOf = (c, d = D) => { const ns = namesOf(c); return d.ev.filter(e => knows(e).some(n => ns.has(n))); };
export const daysOf = (c, d = D) => { const ns = namesOf(c); return d.days.filter(x => !x.who.length || x.who.some(n => ns.has(n) || isMe(n))); };
/** 一条「了解」里 ns 这个人知道的那个版本：知道现在的就是现在的（也知道以前的才带上以前），只知道以前的就是以前的，都不知道是 null */
export function knownOf(f, ns) {
  const has = l => (l || []).some(n => ns.has(n)), last = f.hist[f.hist.length - 1];
  if (has(f.know)) return f.text + (last && has(last.know) ? `（以前：${last.text}）` : '');
  const h = [...f.hist].reverse().find(h => has(h.know));
  return h ? h.text : null;
}
/** 这个 TA 知道的关于人的事 */
export const factsOf = (c, d = D) => { const ns = namesOf(c); return d.facts.filter(f => knownOf(f, ns) != null); };
export const relOf = (c, d = D) => { const ns = namesOf(c); return d.rel.filter(r => ns.has(r.a) || ns.has(r.b)); };

/* ---------- 读 AI 写回来的行 ---------- */
// 事件：日期｜时间｜地点｜标题｜经过｜人物｜小标签｜重要度｜影响｜关键词｜原话｜大标签｜谁知道｜原文从｜原文到
// 时间（part）= 知道几点几分就是 21:20，不知道就是上午 / 下午这样的时段
// 小标签（tags）= 这件事是哪一类具体的事（拍大头贴、喝酒、一次冷战），同一个小标签的事想起一件时把另外几件一起带上；以前的「故事线」就是它
// 大标签（big）= bigs() 里的一到两个；第 12 格以前写的是故事线，不是大标签的就当小标签
// 谁知道（know）= 不在场、后来听说的人；原文从 / 到 = 这件事在原文里从哪句到哪句（各抄开头几个字），照着从原文里剪下来存成 orig
// 影响（after）= 这件事过去后留下了什么（伤、心结、还留着的东西），没有就空着；以前存的 now 是事情刚结束时的样子，只在 TA 最近那件事上当「现在」用
// 关系：甲｜乙｜关系｜从何时起｜现在｜亲近度｜甲眼里的乙｜乙眼里的甲｜甲对乙说的一句话｜乙对甲说的一句话   人物：名字｜别名｜是谁   日子：月-日｜什么日子｜和谁有关   没完：谁｜什么事   完成：谁｜什么事
// 地点：名字｜归哪个大地方｜一句介绍
const list = s => norm(s).split(/[、,，/]/).map(norm).filter(Boolean);
// 人名后面 AI 顺手加的括号注解去掉（「天内理子（昏迷）」「孔时雨（新人物）」），不然一个人会变成好几个人
const bare = n => norm(n).replace(/\s*[（(][^（()）]*[)）]$/, '');
const folk = s => [...new Set(list(s).map(bare).filter(Boolean))];
// AI 没东西可写时爱填「（空）」「无」：都当空着。以前没当空，「（空）」被记成了某个人的别名，那个人就成了每件事「后来听说的人」
const NONE = /^[（(]?(空|无|没有|暂无|未知)[)）]?$/;
/** 「2005年4月6日」「2005/4/6」「2005-04-06?」→ ['2005-04-06', 是不是推测] */
export function day(s) {
  s = norm(s); const guess = /[?？]|推测|约|大概/.test(s);
  const m = /(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/.exec(s);
  return m ? [`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, guess] : ['', false];
}
export function parse(raw) {
  const out = { ev: [], rel: [], ppl: [], days: [], todo: [], done: [], facts: [], places: [], grow: [] };
  const text = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]?\s*(事件|关系|人物|日子|没完|完成|了解|地点|成长)\s*[:：]\s*(.+)$/.exec(line); if (!m) continue;
    const f = m[2].split(/[｜|]/).map(norm).map(x => NONE.test(x) ? '' : x);
    if (m[1] === '事件' && f[3]) {
      const [at, guess] = day(f[0]), imp = Math.min(5, Math.max(1, parseInt(f[7], 10) || 2)), l = list(f[11]), big = l.filter(t => bigs().includes(t));
      out.ev.push({ at, guess, part: f[1] === '不知道' ? '' : f[1] || '', place: f[2] === '不知道' ? '' : f[2] || '', title: f[3], text: f[4] || '', who: folk(f[5]), tags: [...new Set([...list(f[6]), ...l.filter(t => !big.includes(t))])], imp,
        after: f[8] || '', keys: list(f[9]), quote: f[10] || '', big: big.length ? big : imp >= 4 ? ['重要'] : [], know: folk(f[12]), from: f[13] || '', to: f[14] || '' });
    } else if (m[1] === '关系' && f[1]) out.rel.push({ a: bare(f[0]), b: bare(f[1]), kind: KINDS.includes(f[2]) ? f[2] : '其他', since: f[3] || '', now: f[4] || '', lv: /^[0-5]/.test(f[5] || '') ? +f[5][0] : undefined, va: f[6] || '', vb: f[7] || '', sa: f[8] || '', sb: f[9] || '' });
    else if (m[1] === '地点' && f[0]) out.places.push({ name: f[0], area: f[1] === f[0] || /^[（(].*[)）]$|^(空|无|不知道)$/.test(f[1] || '') ? '' : f[1] || '', intro: f[2] || '' });
    else if (m[1] === '人物' && f[0]) out.ppl.push({ name: bare(f[0]), alias: list(f[1]), who: f[2] || '' });
    else if (m[1] === '日子') {   // 类型｜年-月-日（不知道年就只有月-日）｜什么日子｜和谁有关；以前的没有类型，当「其他」
      const [kind, at, what, who] = DAY_KINDS.includes(f[0]) ? f : ['其他', ...f], d = /(?:(\d{4})\D+)?(\d{1,2})\D+(\d{1,2})/.exec(at || ''), p = x => x.padStart(2, '0');
      if (d && what) out.days.push({ kind, date: d[1] ? `${d[1]}-${p(d[2])}-${p(d[3])}` : '', md: `${p(d[2])}-${p(d[3])}`, what, who: list(who) });
    }
    else if (m[1] === '没完' && f[1]) out.todo.push({ who: f[0], text: f[1] });
    else if (m[1] === '完成' && f[1]) out.done.push({ who: f[0], text: f[1] });
    else if (m[1] === '成长' && f[2]) out.grow.push({ who: bare(f[0]), at: day(f[1])[0], text: f[2], why: f[3] || '' });   // 谁｜哪天｜变了什么（以前 → 现在）｜因为哪件事
    else if (m[1] === '了解' && f[1]) out.facts.push({ about: bare(f[0]), text: f[1], know: folk(f[2]), old: f[3] || '' });   // 谁｜是什么｜谁知道｜以前（变了才有）
  }
  return out;
}

/* ---------- 合并（同一件事只记一次） ---------- */
const grams = s => { const t = norm(s).replace(/\s+/g, ''), g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const alike = (a, b) => { const x = grams(a), y = grams(b); return overlap(x, y) / Math.max(1, Math.min(x.size, y.size)); };
/** 人物表里的别名 → 正名 */
const canon = n => { const p = D.ppl.find(p => p.name === n || p.alias.includes(n)); return p ? p.name : n; };
/** 原文节选：AI 只标「从哪句到哪句」（各抄开头十来个字），这里从原文里原样剪下来。回 [剪下来的, 开头位置, 结尾位置]，找不到是 [''] */
function excerpt(text, from, to) {
  // 抄来的开头在原文的哪儿：回 [位置, 对上了几个字]（先对 12 个字，对不上就少对几个）
  const find = (q, i0) => { const k = norm(q).replace(/^[「『“"'（(]+/, ''); if (k.length >= 4) for (const n of [k.length, 12, 8, 5]) { const i = text.indexOf(k.slice(0, n), i0); if (i >= 0) return [i, Math.min(n, k.length)]; } return [-1, 0]; };
  const [a] = find(from, 0); if (a < 0) return [''];
  const [b, n] = find(to, a), b1 = b < 0 ? a : b + n - 1, end = /[。！？!?…\n][」』”"]*/.exec(text.slice(b1)), z = Math.min(end ? b1 + end.index + end[0].length : b1 + 80, a + 4000);   // 剪到「到」那一句的句尾
  return [text.slice(a, z).trim(), a, z];
}
/** 这段原文在第几楼到第几楼（整理现在这个聊天时，每层前面标着「【第 n 层」） */
const floorsAt = (text, a, z) => { const ids = [...text.slice(0, z).matchAll(/【第 (\d+) 层/g)].filter((m, i, l) => m.index >= a || i === l.length - 1 || l[i + 1].index > a).map(m => +m[1]); return ids.length ? [ids[0], ids[ids.length - 1]] : undefined; };
const cutOrig = (e, text, here) => {
  if (e.from && text) { const [o, a, z] = excerpt(text, e.from, e.to); if (o) { e.orig = o; if (here) e.fl = floorsAt(text, a, z); } }
  delete e.from; delete e.to;
};
/** 合并进来，返回新加了几条事件。text：这批记的是哪段原文（拿来剪原文节选）；here：这段原文是现在这个聊天的楼层 */
export function merge(x, src = '', text = '', here = false) {
  for (const p of x.ppl) {
    const o = D.ppl.find(q => q.name === p.name || q.alias.includes(p.name) || p.alias.includes(q.name));
    if (!o) D.ppl.push({ ...p, src });
    else { o.alias = [...new Set([...o.alias, ...p.alias, p.name].filter(n => n !== o.name))]; if (!o.who) o.who = p.who; }
  }
  let added = 0;
  for (const e of x.ev) {
    upgrade(e); cutOrig(e, text, here);
    e.who = [...new Set(e.who.map(canon))]; e.know = (e.know || []).map(canon);
    const dup = D.ev.find(o => o.at === e.at && (o.title === e.title || alike(o.title + o.text, e.title + e.text) > .6));
    if (dup) {   // 重新整理：老记忆缺的格子补上，小标签并在一起
      dup.imp = Math.max(dup.imp, e.imp); dup.tags = [...new Set([...dup.tags, ...e.tags])];
      for (const k of ['quote', 'after', 'keys', 'big', 'know', 'orig', 'fl', 'part']) if (!(dup[k] && dup[k].length) && e[k] && e[k].length) dup[k] = e[k];
      continue;
    }
    D.ev.push({ id: uid('m'), ...e, pin: false, off: false, src }); added++;
  }
  for (const r of x.rel) {
    const a = canon(r.a), b = canon(r.b), o = D.rel.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a));
    const v = o && o.a !== a ? { va: r.vb, vb: r.va, sa: r.sb, sb: r.sa } : { va: r.va, vb: r.vb, sa: r.sa, sb: r.sb };   // 存着的那条甲乙是反过来的：两边的看法也对调
    if (!o) { D.rel.push({ id: uid('r'), a, b, kind: r.kind, since: r.since, now: r.now, lv: r.lv, ...v, hist: [], src }); continue; }
    // 关系变了：旧的（连同那时的亲近度和看法）留进 hist，以后能看出关系是怎么变过来的
    if (o.kind !== r.kind) { o.hist.push({ kind: o.kind, since: o.since, lv: o.lv, va: o.va, vb: o.vb, src }); o.kind = r.kind; o.since = r.since || o.since; o.lv = undefined; }
    if (r.now) o.now = r.now;
    if (r.lv != null) o.lv = r.lv;
    if (v.va) o.va = v.va;
    if (v.vb) o.vb = v.vb;
    if (v.sa) o.sa = v.sa;
    if (v.sb) o.sb = v.sb;
  }
  for (const p of x.places || []) {   // 「等你看」里以前存下的没有这一项
    const o = D.places.find(o => o.name === p.name);
    if (!o) D.places.push({ ...p, src }); else { if (!o.area) o.area = p.area; if (!o.intro) o.intro = p.intro; }
  }
  for (const d of x.days) {
    const o = D.days.find(o => o.md === d.md && alike(o.what, d.what) > .5);
    if (!o) D.days.push({ ...d, who: d.who.map(canon), src });
    else { if (!o.kind || o.kind === '其他') o.kind = d.kind; if (!o.date) o.date = d.date; }   // 老的没有类型、年份：重新整理时补上
  }
  for (const t of x.todo) if (!D.todo.some(o => !o.done && alike(o.text, t.text) > .6)) D.todo.push({ id: uid('t'), who: canon(t.who), text: t.text, done: false, src });
  // 了解：同一个人、差不多的一条只记一次，后来知道的人加进去；写了「以前」的是变了，旧的留痕（「你以前爱喝可乐」）
  for (const f of x.facts) {
    const about = canon(f.about), know = f.know.map(canon), same = D.facts.filter(o => o.about === about);
    const o = same.find(o => f.old && alike(o.text, f.old) > .5) || same.find(o => alike(o.text, f.text) > .6);
    if (!o) { D.facts.push({ id: uid('f'), about, text: f.text, know, hist: [], src }); continue; }
    if (alike(o.text, f.text) <= .6) { o.hist.push({ text: o.text, know: o.know, src }); o.text = f.text; o.know = know; continue; }   // 变了：只有这次知道的人知道新的，其他人还以为是旧的
    o.know = [...new Set([...o.know, ...know])];
  }
  // 成长：这个人自己变成什么样了。同一个人差不多的一条只记一次
  for (const g of x.grow || []) { const who = canon(g.who); if (!D.grow.some(o => o.who === who && alike(o.text, g.text) > .6)) D.grow.push({ id: uid('g'), ...g, who, src }); }
  for (const t of x.done) { const o = D.todo.find(o => !o.done && alike(o.text, t.text) > .45); if (o) { o.done = true; o.doneBy = src; } }
  D.ev.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
  return added;
}

/** 收回某一处记下的（正文那一楼换了 / 重新生成了、手机里那批消息重新生成了）：那一处新加的删掉，关系改回去、没完的事改回没完 */
function forget(src) {
  for (const k of ['ev', 'ppl', 'days', 'todo', 'wait', 'places', 'grow']) D[k] = D[k].filter(x => x.src !== src);
  D.rel = D.rel.filter(r => r.src !== src);
  for (const r of D.rel) { const i = r.hist.findIndex(h => h.src === src); if (i >= 0) { const { kind, since, lv, va, vb } = r.hist[i]; Object.assign(r, { kind, since, lv, va, vb }); r.hist.splice(i); } }
  for (const t of D.todo) if (t.doneBy === src) { t.done = false; delete t.doneBy; }
  D.facts = D.facts.filter(f => f.src !== src);
  for (const f of D.facts) { const i = f.hist.findIndex(h => h.src === src); if (i >= 0) { Object.assign(f, { text: f.hist[i].text, know: f.hist[i].know || f.know }); f.hist.splice(i); } }
}
const storyDay = () => { const d = time.isStory() ? time.story().date : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowPart = () => { const s = time.isStory() ? time.story() : { hh: new Date().getHours(), mm: new Date().getMinutes() }; return `${String(s.hh).padStart(2, '0')}:${String(s.mm).padStart(2, '0')}`; };
/** 收一段 <astermem> 暗号：src 是这一处的名字，同一处内容变了就先收回旧的再记；fix 用来改每条事件（补日期、限定谁知道）；text 是这一处的原文 */
async function take(src, body, fix, fixFact, text) {
  const d = await load(), sig = String(body).trim(), S = d.sigs || (d.sigs = {});
  if (S[src] === sig || (!sig && !(src in S))) return 0;
  forget(src);
  if (!sig) { delete S[src]; await save(); return 0; }   // 这一楼换了个没写暗号的版本：之前记的收回就好
  S[src] = sig;
  const x = parse(sig); x.ev.forEach(e => { fix(e); cutOrig(e, text); }); if (fixFact) x.facts.forEach(fixFact);
  if (state.apps.memory.wait) {   // 先等你看：点了「留下」才合并进来
    if (Object.values(x).some(a => a.length)) { d.wait.push({ src, x, at: Date.now() }); log('info', '岁岁砂', `记下 ${x.ev.length} 件事，等你看`); }
    await save(); return 0;
  }
  const n = merge(x, src); await save(); vecLater();
  if (n) log('info', '岁岁砂', `记下 ${n} 件事：${x.ev.map(e => e.title).join('、')}`);
  return n;
}
/** 正文第 id 层里的 <astermem>（换了 swipe、改了内容就按新的重记）：没写日期就用现在的剧情日期；原文是这一楼和前面你发的那一楼 */
export function fromStory(id, body) {
  const at = storyDay(), part = nowPart(), ms = chatMsgs();
  return take(`story:${id}`, body, e => { e.fl = [id, id]; if (!e.at) { e.at = at; if (!e.part) e.part = part; } }, null,
    body && [ms[id - 1], ms[id]].filter(m => m && m.mes).map(m => cleanText(m.mes)).join('\n'));
}
/** 手机聊天里 TA 回消息时写的 <astermem>：事就发生在现在；私聊只有 TA 和我知道，群聊只有群里的人知道 */
export function fromChat(chatId, batch, body, people) {
  const at = storyDay(), part = nowPart(), me = myName(), names = people.map(c => c.name).filter(Boolean);
  const known = new Set([me, '我', ...people.flatMap(c => [c.name, c.nick, c.remark])].filter(Boolean));
  return take(`chat:${chatId}:${batch}`, body, e => {
    e.at = at; e.guess = false; e.part = e.part || part;
    const as = n => n === '我' ? me : (people.find(c => [c.name, c.nick, c.remark].includes(n)) || {}).name || n;
    e.who = [...new Set([...e.who.filter(n => known.has(n)).map(as), me, ...(people.length === 1 ? names : [])])];
    if (people.length > 1 && e.who.length < 2) e.who.push(...names);
    e.tags = [...new Set([...e.tags, '手机'])];
  }, f => { f.know = names; });   // 手机里说的，只有这个聊天里的 TA 们知道
}
/** 等你看的一批：ok = 留下（合并进来），否则不要 */
export async function settle(w, ok) { D.wait = D.wait.filter(x => x !== w); if (ok) merge(w.x, w.src); await save(); vecLater(); }
/** 用着的小标签和各有几件，多的在前（「手机」是手机聊天自动加的记号，不算） */
export function smallTags(d = D) { const n = new Map(); for (const e of d.ev) for (const t of e.tags) if (t !== '手机') n.set(t, (n.get(t) || 0) + 1); return [...n].sort((a, b) => b[1] - a[1]); }
const lineSet = () => smallTags().slice(0, 60).map(x => x[0]).join('、');
/** 已经有的小标签：告诉 AI 同一类的事照这个名字写（还没读进来就先读，这次说没有） */
export function lineNames() {
  if (D && Dkey === win.key) return lineSet() || '（还没有）';
  load().catch(e => log('warn', '岁岁砂', '读不到记忆：' + e.message));
  return '（还没有）';
}
/** 手机里的聊天整个清空 / 删掉了：这个聊天里记下的全收回 */
export async function dropChatAll(chatId) {
  const d = await load(), pre = `chat:${chatId}:`, srcs = Object.keys(d.sigs || {}).filter(s => s.startsWith(pre));
  if (!srcs.length) return;
  srcs.forEach(s => { forget(s); delete d.sigs[s]; }); await save();
}
/** 手机里那批消息重新生成了 / 删掉了：那批记下的收回 */
export async function dropChat(chatId, batch) { const d = await load(), src = `chat:${chatId}:${batch}`; if (!d.sigs || !(src in d.sigs)) return; forget(src); delete d.sigs[src]; await save(); }

/* ---------- 来源 → 一批批文字 ---------- */
const DATE_RE = /(\d{4})\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})/;
/** 正文的一层层 → 每层前面标上第几层、谁、日期（正文里写了日期就读出来，不用 AI 猜） */
export function floorsText(msgs, { withUser = true, from = 0, to = Infinity, keep, drop, keepOff = [] } = {}) {
  const out = []; if (keep) keep = keep.filter(t => !keepOff.includes(t));   // 「要」里点灭了的暂时不要
  msgs.forEach((m, i) => {
    // 隐藏起来的楼层（is_system，总结插件常这么做）也要：那正是早先的剧情
    if (i < from || i > to || !m.mes || (m.is_user && !withUser)) return;
    const d = DATE_RE.exec(m.mes), t = cleanText(m.mes, keep, drop);
    if (t) out.push(`【第 ${i} 层 · ${m.name || ''}${d ? ` · ${d[1]}年${+d[2]}月${+d[3]}日` : ''}】\n${t}`);
  });
  return out;
}
/** 一段段文字攒成一批批，每批不超过 BATCH 字（一段太长就自己成一批） */
export function batches(parts) {
  const out = []; let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > BATCH) { out.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) out.push(cur);
  return out;
}
export const chatMsgs = () => { const c = ctx(); return (c && Array.isArray(c.chat)) ? c.chat : []; };
/** 导入的文件：酒馆聊天记录（.jsonl）→ { msgs }；世界书（.json）→ { entries }；别的当纯文字 → { text } */
export async function readFile(f) {
  const raw = await f.text();
  if (/\.jsonl$/i.test(f.name) || /^\s*\{[^\n]*\}\s*\n\s*\{/.test(raw)) {
    const msgs = raw.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m && 'mes' in m);
    if (msgs.length) return { msgs };
  }
  if (/\.json$/i.test(f.name)) {
    let j = null; try { j = JSON.parse(raw); } catch { /* 当纯文字 */ }
    if (j && j.entries) return { entries: Object.values(j.entries).map(e => ({ title: e.comment || (e.key || []).join('、') || '条目', content: e.content || '' })).filter(e => e.content.trim()) };
    if (Array.isArray(j) && j.some(m => m && 'mes' in m)) return { msgs: j };
  }
  return { text: raw };
}

/* ---------- 整理：同一时间只跑一个 ---------- */
let job = null;   // { label, list, done, ac, error }
const subs = new Set();
export const onJob = f => { subs.add(f); return () => subs.delete(f); };
const tell = (how, x) => subs.forEach(f => f(how, x));
export const running = () => job && job.ac ? job : null;
/** 上次没跑完的（停下了、失败了） */
export async function leftover() { return running() || (await kvGet('memjob:' + win.key)) || null; }
export const dropJob = () => kvDel('memjob:' + win.key);
export function cancelJob() { job && job.ac && job.ac.abort(); }
/** 补充 / 重新生成（作者要的）：不重读原文，只看已经记下的事，把勾选的那几样再写一遍。
 *  redo = false 补充：只添没有的、只填空着的格子，已经有的不动；redo = true 重新生成：这一样旧的不要了，换成新写的（AI 一条都没写出来就不动；自己手写的成长留着） */
/** 整理哪几样（作者定的四样，顺序和首页一致）：时间 = 事、纪念日、待办；关系 = 关系和了解；地点；人物簿 = 成长。人物表每次都记 */
export const PARTS = { time: '时间', rel: '关系', places: '地点', grow: '人物簿' };
const LINES = { time: ['ev', 'days', 'todo', 'done'], rel: ['rel', 'facts'], places: ['places'], grow: ['grow'] }, NAMES = { time: '事件、日子、没完、完成', rel: '关系、了解', places: '地点', grow: '成长' };
const only = (x, want) => { if (want) for (const k in LINES) if (!want.includes(k)) for (const f of LINES[k]) x[f] = []; return x; };
/** 重新生成：勾上的这几样旧的不要了。勾了「时间」就是全部重来（作者定的：导入来的事也一起去掉）；自己手写的成长留着 */
function clearParts(want) {
  if (want.includes('time')) { D.ev = []; D.days = []; D.todo = []; D.wait = []; }
  if (want.includes('rel')) { D.rel = []; D.facts = []; }
  if (want.includes('places')) D.places = [];
  if (want.includes('grow')) D.grow = D.grow.filter(g => g.src === '手动');
}
let refilling = false;
export async function refill(want, signal, redo) {
  if (refilling) throw new Error('已经在重新填了');
  refilling = true;
  try {
    await load(); const key = win.key;
    const spots = [...new Set([...D.places.map(q => q.name), ...D.ev.map(e => e.place)].filter(Boolean))];
    // 一起经历过两件事以上的每一对人：明着列给 AI，不然它只爱写「谁和你」
    const co = new Map();
    for (const e of D.ev) { const l = [...new Set(e.who.map(n => isMe(n) ? myName() : n))].sort(); for (const a of l) for (const b of l) if (a < b) co.set(a + '—' + b, (co.get(a + '—' + b) || 0) + 1); }
    const x = parse(await generate({ conn: resolveConn('text', 'memory'), app: '岁岁砂', temperature: .3, stop: signal, prompt: compose('memFill', { pairs: [...co].filter(c => c[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 60).map(c => c[0]).join('、') || '（没有）', want: want.map(k => k === 'grow' ? '成长' : PARTS[k]).join('、'),
      people: D.ppl.map(p => `${p.name}${p.who ? `（${p.who}）` : ''}`).join('、') || '（没有）', places: spots.join('、') || '（没有）',
      events: D.ev.filter(e => !e.off).map(e => `${e.at || '不知道'}｜${e.place}｜${e.title}：${e.text}｜${e.who.join('、')}${e.quote ? '｜' + e.quote : ''}`).join('\n') || '（没有）' }) }));
    if (key !== win.key) throw new Error('换了聊天窗口，先停下');
    const n = { rel: 0, places: 0, grow: x.grow.length };
    if (want.includes('grow') && n.grow) {
      if (redo) D.grow = D.grow.filter(g => g.src === '手动');
      for (const g of x.grow) { const who = canon(g.who); if (!D.grow.some(o => o.who === who && alike(o.text, g.text) > .6)) D.grow.push({ id: uid('g'), ...g, who, src: '重新填' }); }
    }
    if (want.includes('rel') && x.rel.length) {
      if (redo) D.rel = [];
      for (const r of x.rel) {
        const a = canon(r.a), b = canon(r.b); if (a === b) continue;
        let o = D.rel.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a));
        if (!o) D.rel.push(o = { id: uid('r'), a, b, kind: r.kind, hist: [], src: '重新填' });
        const v = o.a === a ? r : { ...r, va: r.vb, vb: r.va, sa: r.sb, sb: r.sa };
        for (const k of ['since', 'now', 'lv', 'va', 'vb', 'sa', 'sb']) if (v[k] != null && v[k] !== '' && (o[k] == null || o[k] === '')) o[k] = v[k];
        n.rel++;
      }
    }
    if (want.includes('places')) for (const q of x.places) {
      if (!spots.includes(q.name)) continue;   // 只归类已有的，不让它添新地点
      let o = D.places.find(o => o.name === q.name); if (!o) D.places.push(o = { name: q.name, area: '', intro: '' });
      if (redo || !o.area) o.area = q.area; if (q.intro && (redo || !o.intro)) o.intro = q.intro; n.places++;
    }
    await save(); return n;
  } finally { refilling = false; }
}
/** 已经知道的人、关系和最近的事，告诉 AI 别重复、名字照这个写 */
function known() {
  const ppl = D.ppl.map(p => `${p.name}${p.alias.length ? `（${p.alias.join('、')}）` : ''}`).join('、');
  const rel = D.rel.map(r => `${r.a}—${r.b}：${r.kind}`).join('；');
  const ev = D.ev.slice(-40).map(e => `${e.at || '不知道'} ${e.title}`).join('\n');
  const spots = [...new Set([...D.places.flatMap(q => [q.area, q.name]), ...D.ev.map(e => e.place)].filter(Boolean))].slice(-80).join('、');
  const facts = D.facts.slice(-60).map(f => `${f.about}：${f.text}（${f.know.join('、')}知道）`).join('；'), lines = lineSet();
  return [ppl && '人物：' + ppl, rel && '关系：' + rel, facts && '已经了解的：' + facts, lines && '已有的小标签：' + lines, spots && '已有的地点：' + spots, ev && '已经记下的事：\n' + ev].filter(Boolean).join('\n') || '（还没有）';
}
/** list：一批批文字。从第 done 批的第 at 个字接着跑。
 *  回复写到一半断了（没写结束那行）：已经写出来的先记下，看最后一件事剪到了原文的哪儿，从那儿接着；
 *  开了「自动补写」就自己接着找 AI（最多 fillMax 次），没开就停下，等你点「接着整理」 */
/** 设置里的「清空」：挑哪几样清哪几样；四样都勾就是整个清空（连向量、没跑完的整理一起） */
export async function clearSome(want) { await load(); if (want.length > 3) return wipe(); clearParts(want); await save(); }
export async function startJob(label, list, done = 0, at = 0, opt = null) {
  if (running()) throw new Error('已经在整理了');
  await load();
  const key = win.key, m = state.apps.memory;
  job = { label, list, done, at, opt, ac: new AbortController(), error: '', added: 0 };
  if (opt && opt.redo && !done && !at) { clearParts(opt.want); await save(); }   // 接着跑上次没跑完的就不再清了
  tell('start', job);
  try {
    let more = m.fill ? m.fillMax || 3 : 0;
    while (job.done < job.list.length) {
      await kvSet('memjob:' + key, { label, list, done: job.done, at: job.at, opt });
      const full = list[job.done], from = job.at ? Math.max(0, full.lastIndexOf('\n【第 ', job.at) + 1) || job.at : 0, src = full.slice(from);   // 接着整理时从那一层开头接（楼层号才对得上）
      let raw;
      job.t0 = Date.now();
      try { raw = await generate({ conn: resolveConn('text', 'memory'), app: '岁岁砂', prompt: compose('memSort', { source: src, existing: known(), bigs: bigNames(), only: opt && opt.want.length < 4 ? `这次只写这几种行：${opt.want.map(k => NAMES[k]).join('、')}、人物，别的行不要写。` : '' }), temperature: .3, stop: job.ac.signal }); }
      catch (e) { if (!e.part) throw e; raw = e.part; log('warn', '岁岁砂', '整理的回复写到一半断了：' + e.message); }
      if (key !== win.key) throw new Error('换了聊天窗口，先停下');
      const x = only(parse(raw), opt && opt.want); job.added += merge(x, label, src, HERE.has(label)); await save();
      // 断了：最后一件剪下来的原文在哪儿结束，下次从那儿接（离结尾不到 300 字也当写完了：自己改过的提示词可能没让 AI 写结束那行）
      const end = Math.max(0, ...x.ev.map(e => e.orig ? src.indexOf(e.orig) + e.orig.length : 0));
      if (raw.includes(END) || (end && src.length - end < 300)) { job.done++; job.at = 0; tell('step', job); continue; }
      if (!end && opt && !opt.want.includes('time')) throw new Error('回复写到一半断了，写出来的已经记下');
      if (!end) throw new Error(x.ev.length ? '回复写到一半断了，看不出写到了原文哪儿' : '回复写到一半断了，一件事都没记下');
      job.at = from + end; tell('step', job);
      if (more-- > 0) { log('info', '岁岁砂', `回复写到一半断了，记下了这部分，接着整理（还能补 ${more} 次）`); continue; }
      await kvSet('memjob:' + key, { label, list, done: job.done, at: job.at, opt });
      throw new Error('回复写到一半断了，写出来的已经记下，点「接着整理」从断的地方接着');
    }
    await kvDel('memjob:' + key);
  } catch (e) {
    job = { ...job, ac: null, error: e.message }; tell('fail', job); return;
  }
  const j = job; job = null; tell('done', j); vecLater();
}
/** 每隔几轮自动整理（now = 点了「现在整理」，不等凑够轮数）：从上次整理到的那一楼接着，这次没成的下次一起补。回这次有没有东西可整理 */
let autoBusy = false;
export async function autoSort(now) {
  const m = state.apps.memory;
  if (autoBusy || running() || (!now && (!m.on || m.story !== 'n'))) return false;
  autoBusy = true;
  try { return await autoRun(now, m); } finally { autoBusy = false; }
}
async function autoRun(now, m) {
  const d = await load(), ms = chatMsgs(), last = ms.length - 1, turn = x => !x.is_user && !x.is_system;
  if (d.autoAt == null) {   // 第一次：以前的楼层不动（要整理以前的去「整理」），只从现在往后算；点「现在整理」就整理最近那几轮
    let i = ms.length, n = now ? m.n || 10 : 0; while (i > 0 && n > 0) if (turn(ms[--i])) n--;
    d.autoAt = now ? i - 1 : last; await save();
  }
  const from = d.autoAt + 1;
  if (ms.slice(from).filter(turn).length < (now ? 1 : m.n || 10)) return false;
  await startJob(now ? '现在整理' : AUTO, batches(floorsText(ms, { from, to: last, keep: m.keep, drop: m.drop, keepOff: m.keepOff })));
  if (job) { if (!now) { job = null; await dropJob(); } return true; }   // 没成：自动的不留「接着整理」，下次从同一楼重来
  D.autoAt = last; await save();
  return true;
}

/* ---------- 聊天时带进去 ---------- */
/* 特殊日子：当天说出来；快到了（7 天内）先记在心里。
 * 生日、祭日、节日、其他：每年那天（祭日知道年份就说第几年）；纪念日（知道年份的）：满一个月、100 天、半年，满一年后每年一次。
 * 关系里「从什么时候起」写的是日期的恋人，也当成交往纪念日。返回 [今天的, 快到的, 碰上的日子（拿来找相关的往事）, 今天有没有祭日] */
const AHEAD = 7, CATALOG = 60, DRIFT = .35;   // 快到的日子提前几天；目录最多几件；没被问到时，大概几次里有一次忽然想起一件
function specialDays(d, ns) {
  const n = time.isStory() ? time.story().date : new Date(), t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m && new Date(+m[1], m[2] - 1, +m[3]); };
  const shift = (x, mo, dd = 0) => new Date(x.getFullYear(), x.getMonth() + mo, x.getDate() + dd);
  const list = [...d.days.filter(x => !x.who.length || x.who.some(n => ns.has(n) || isMe(n))), ...d.rel.filter(r => r.kind === '恋人' && (ns.has(r.a) || ns.has(r.b)) && ymd(r.since) && !d.days.some(x => x.kind === '纪念日' && x.date === r.since.slice(0, 10))).map(r => ({ kind: '纪念日', date: r.since, md: r.since.slice(5), what: `${r.a}和${r.b}交往` }))];
  const now = [], soon = [], hits = [];
  let sad = false;   // 今天有祭日：语气要不一样
  for (const x of list) {
    const s = ymd(x.date), [mm, dd] = x.md.split('-').map(Number), marks = [];
    for (const y of [t0.getFullYear(), t0.getFullYear() + 1]) {   // 每年那天（年底时下一年的也看看）
      const k = s ? y - s.getFullYear() : 0;
      if (s && k < 1) continue;
      marks.push([new Date(y, mm - 1, dd), x.kind === '纪念日' && s ? `${x.what} ${k} 周年` : x.kind === '祭日' && s ? `${x.what}（第 ${k} 年）` : x.what]);
    }
    if (x.kind === '纪念日' && s) marks.push([shift(s, 1), `${x.what}满一个月`], [shift(s, 0, 100), `${x.what}满 100 天`], [shift(s, 6), `${x.what}满半年`]);
    for (const [t, label] of marks) {
      const left = Math.round((t - t0) / 864e5);
      if (left === 0) { now.push(label); sad = sad || x.kind === '祭日'; } else if (left > 0 && left <= AHEAD) soon.push(`再过 ${left} 天：${label}`); else continue;
      hits.push(x);
    }
  }
  return [now, soon, hits, sad];
}
const cut = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
/** 最近的一件（按日期） */
export const newest = list => list.reduce((a, e) => !a || (e.at || '') >= (a.at || '') ? e : a, null);
/** 一件事后面带的：留下的影响；以前存的「现在」只在最近那件上算数 */
export const tail = (e, list) => e.after ? `（后来：${e.after}）` : e.now && e === newest(list) ? `（现在：${e.now}）` : '';
const NOTE = '这些是真发生过的。自然地提起就好，不用每件都说；同一类的事有好几次时，像真人一样分清是哪一次：可以先反问、逗一逗，或者都说起。提到过去时只用这里、正文和世界书里写了的，没写到的事和细节不要编';
export const peeks = [];   // 最近几次想起了哪几件、为什么（「刚才想起了什么」那页看；不存，刷新就没了）
/** 给 people（这次聊天里的 TA 们）带上的记忆。scan = 最近的聊天和正文，拿来对名字、对字面。
 *  返回 [一直记着的, 这会儿想起的]：前一块不常变，放在提示词前面能走缓存；后一块每次不一样，放在后面 */
/* 成长（作者：角色是会变的，不能演回人设卡的出厂设置）：每次都带上涉及到的人最新的 4 条，不靠碰巧想起 */
const GROW = '这些人后来变了（和人设写的不一样的地方，以这里为准）';
const growLines = (d, ok) => [...new Set(d.grow.map(g => g.who))].filter(ok).flatMap(w => d.grow.filter(g => g.who === w).sort((a, b) => (a.at || '').localeCompare(b.at || '')).slice(-4)
  .map(g => `- ${g.who}${g.at ? `（${g.at}）` : ''}：${g.text}${g.why ? `（因为：${g.why}）` : ''}`)).join('\n');
/** 送进正文的那一小段：只有「跟随正文」时才有（作者定的：跟随正文也影响正文，仅线上只影响手机）；只带最近几楼里出现的人 */
export async function growForStory() {
  if (!state.apps.memory.on || state.apps.chat.defaults.linkMode !== 'follow') return '';
  const d = await load(); if (!d.grow.length) return '';
  const scan = ((ctx() || {}).chat || []).slice(-6).map(m => m.mes || '').join('\n');
  const t = growLines(d, n => isMe(n) || [n, ...((d.ppl.find(p => p.name === n) || {}).alias || [])].some(x => scan.includes(x)));
  return t && `[${GROW}]\n${t}`;
}
export async function memoryFor(people, scan = '') {
  const m = state.apps.memory;
  if (!m.on || !people.length) return ['', ''];
  const d = await load();
  if (!d.ev.length && !d.rel.length && !d.facts.length && !d.days.length) return ['', ''];
  const ns = new Set(people.flatMap(c => [...namesOf(c)])), hit = n => n && scan.includes(n), lines = [];
  // 每次都带：这次涉及到的人互相的关系和看法、TA 们知道的关于人的事、没完的事、钉住的
  // 涉及到的人 = 这次说话的 TA 们、我、这会儿聊到的人
  const other = r => ns.has(r.a) ? r.b : ns.has(r.b) ? r.a : null;
  const view = v => `「${v.replace(/^[「“"]|[」”"。.]+$/g, '')}」`;
  const rel = d.rel.filter(r => { const o = other(r); return o != null && (isMe(o) || ns.has(o) || hit(o)); });
  if (rel.length) lines.push('关系和看法：\n' + rel.map(r => `- ${r.a}和${r.b}是${r.kind}${r.since ? `（${r.since}起）` : ''}${r.now ? `，现在${r.now}` : ''}${r.va ? `；${r.a}眼里的${r.b}：${view(r.va)}` : ''}${r.vb ? `；${r.b}眼里的${r.a}：${view(r.vb)}` : ''}`).join('\n'));
  const grown = growLines(d, n => ns.has(n) || isMe(n) || hit(n)); if (grown) lines.push(GROW + '：\n' + grown);
  // 知道的关于人的事：只带这次说话的 TA 们知道的；群里不是人人都知道的，写明谁知道（别说漏）
  const by = new Map();
  for (const f of d.facts) {
    const v = new Map();   // 每个人知道的版本 → 谁
    for (const c of people) { const t = knownOf(f, namesOf(c)); if (t != null) v.set(t, [...(v.get(t) || []), c.name || c.nick]); }
    for (const [t, knows] of v) by.set(f.about, [...(by.get(f.about) || []), t + (people.length > 1 && knows.length < people.length ? `（只有${knows.join('、')}知道）` : '')]);
  }
  if (by.size) lines.push('知道的关于人的事（别人不知道的事别说漏）：\n' + [...by].map(([a, l]) => `- ${a}：${l.join('；')}`).join('\n'));
  const todo = d.todo.filter(t => !t.done && ns.has(t.who));
  if (todo.length) lines.push('没完的事：' + todo.map(t => `${t.who}：${t.text}`).join('；'));
  // 特殊日子
  const [now, soon, hits, sad] = specialDays(d, ns);
  if (now.length) lines.push(`今天是特别的日子：${now.join('；')}（可以主动提起${sad ? '；祭日要克制、温柔，别说成喜事' : '、好好过'}）`);
  if (soon.length) lines.push(`快到的日子：${soon.join('；')}（先记在心里，可以悄悄准备，不用急着说）`);
  // 钉住的、到了 / 快到特殊日子翻出的以前同一类日子的事（标签是这个类型的，或写到了这个日子，最近的 3 件）一直带着；
  // 这会儿想起的最多 m.slots 件（见 recollect）。噪声：留着，不会自己想起来。这次说话的 TA 们都不知道的事不带
  const pool = d.ev.filter(e => !e.off && knows(e).some(n => ns.has(n))), live = pool.filter(e => e.mark !== 'no');
  const onDay = hits.length ? live.filter(e => !e.pin && hits.some(x => (x.kind !== '其他' && e.tags.includes(x.kind)) || [e.title, ...e.tags, ...(e.keys || [])].some(t => t && (t.includes(x.what) || x.what.includes(t) && t.length > 1)))).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 3) : [];
  // 现在在哪：先看时间标签里的地点，对不上记过的地方就看最近说到的地名
  const spots = [...new Set([...d.places.map(p => p.name), ...d.ev.map(e => e.place)].filter(Boolean))], tagAt = time.isStory() ? time.story().place : '';
  const here = spots.includes(tagAt) ? tagAt : (spots.map(n => [n, scan.lastIndexOf(n)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1])[0] || [''])[0];
  // 还在这轮上下文里的事（出自给手机看的那几楼正文）不用再想起：上下文调长调短，这里自动跟着变
  const from = ctxFrom(), keep = [...pool.filter(e => e.pin), ...onDay];
  const [got, drift, why, how] = await recollect(live.filter(e => !e.pin && !onDay.includes(e) && floorOf(e) < from), scan, new Set([...ns, myName(), '我']), here);
  const cap = m.origMax ?? 500, byAt = (a, b) => (a.at || '9999').localeCompare(b.at || '9999');
  const brief = e => `- ${[e.at, e.part, e.place].filter(Boolean).join(' ')}：${cut(e.title + '。' + e.text, 160)}${e.quote ? `（原话：${e.quote}）` : ''}${tail(e, pool)}`;
  // 同一个小标签的事：想起一件，另外几件（最近的 5 件）各一句、按先后带上；一个小标签只带一次
  const shown = new Set(), kin = e => {
    const t = e.tags.find(t => t !== '手机' && !shown.has(t) && pool.some(x => x !== e && x.tags.includes(t))); if (!t) return '';
    shown.add(t);
    return `\n  同一类的事（${t}，按先后）：\n` + [...pool.filter(x => x !== e && x.tags.includes(t)).slice(-5), e].sort(byAt).map(x => `  · ${x.at || '不知道哪天'} ${x.title}${x === e ? '（就是上面这件）' : '：' + cut(x.text, 60)}`).join('\n');
  };
  const full = e => `${brief(e)}（知道的人：${knows(e).join('、')}）${e.orig ? `\n  当时的原文：${cap ? cut(e.orig, cap) : e.orig}` : ''}${kin(e)}`;
  if (keep.length) lines.push(`一直记着的事（${NOTE}）：\n` + keep.map(brief).join('\n'));
  // 来时路（设置里开了才带）：经历过的事只列日期、地点、标题，让 TA 知道自己经历过什么；太多时留重要的、近的
  const rest = m.road ? pool.filter(e => !keep.includes(e)) : [], cat = new Set(rest.map((e, i) => [e, e.imp * 2 + i / Math.max(1, rest.length) * 3]).sort((a, b) => b[1] - a[1]).slice(0, CATALOG).map(([e]) => e));
  if (cat.size) lines.push('经历过的事（只记得个大概；聊到了可以说起，细节记不清就说记不清，不要编）：\n' + rest.filter(e => cat.has(e)).map(e => `- ${e.at || '不知道哪天'}${e.place ? ' ' + e.place : ''}：${e.title}`).join('\n'));
  const fresh = [], ppl = d.ppl.filter(p => !ns.has(p.name) && !isMe(p.name) && [p.name, ...p.alias].some(hit)), pl = d.places.find(p => p.name === here);
  if (pl && (pl.intro || pl.area)) fresh.push(`现在在：${here}${pl.area ? `（${pl.area}）` : ''}${pl.intro ? '，' + pl.intro : ''}`);
  if (ppl.length) fresh.push('聊到的人：' + ppl.map(p => `${p.name}：${p.who}`).join('；'));
  if (got.length) fresh.push(`想起的事（${NOTE}；不知道这件事的人不会提起）：\n` + got.map(full).join('\n'));
  if (drift) fresh.push('忽然想起的（和现在有点关系，合适就顺口提一句，不合适就不提）：\n' + brief(drift));
  const out = [lines.length ? `\n【TA 记得的事】\n${lines.join('\n')}\n` : '', fresh.length ? `\n【TA 这会儿想起的】\n${fresh.join('\n')}\n` : ''];
  peeks.unshift({ at: Date.now(), who: people.map(c => c.name || c.nick).filter(Boolean), said: scan.slice(scan.lastIndexOf('\n') + 1), how, size: [out[0].length, out[1].length],
    items: [...keep.map(e => [e, e.pin ? '钉住的' : '日子到了']), ...got.map(e => [e, ...why.get(e)]), ...(drift ? [[drift, '忽然想起 · ' + why.get(drift)[0], why.get(drift)[1]]] : [])] });
  peeks.length = Math.min(peeks.length, 20);
  return out;
}

/* ---------- 向量：每件事算一串数字存着，聊天时把刚说的话也算一串，比哪几件最像（按意思找） ---------- */
let V = null, Vkey = null, filling = null;
const vecConn = () => { const c = state.apps.memory.vec !== false && connOfTag('向量'); return c && keysOf(c).length ? c : null; };
async function vecs() {
  await load();
  if (!V || Vkey !== Dkey) { V = (await kvGet('memvec:' + Dkey)) || { model: '', v: {} }; Vkey = Dkey; }
  return V;
}
/** 换了向量模型：以前算的和新模型对不上，要重新算过才能按意思找（记下的事不受影响） */
const stale = (v, conn) => !!v.model && v.model !== conn.model && Object.keys(v.v).length > 0;
const vecText = e => [e.title, e.text, e.place, ...e.tags, ...(e.keys || [])].filter(Boolean).join(' ');
/** 设置页看的：接没接向量、要不要重算、算了几件 */
export async function vecState() { const v = await vecs(), conn = vecConn(); return { conn, stale: !!conn && stale(v, conn), done: D.ev.filter(e => v.v[e.id]).length, total: D.ev.length }; }
/** 这件事改了内容：它的向量下次重算 */
export function vecDrop(e) { if (V && V.v[e.id]) { delete V.v[e.id]; kvSet('memvec:' + Vkey, V); } }
/** 给还没有向量的事补上（16 件一批，算一批存一批，断了下次接着），能取消；换过模型的在这里整个重算。同一时间只跑一个 */
export function vecFill(signal, step) {
  return filling || (filling = (async () => {
    const conn = vecConn(); if (!conn) throw new Error('「其他」线的向量还没接好');
    let v = await vecs(); const key = Dkey;
    if (v.model !== conn.model) v = V = { model: conn.model, v: {} };
    for (const id of Object.keys(v.v)) if (!D.ev.some(e => e.id === id)) delete v.v[id];
    const todo = D.ev.filter(e => !v.v[e.id]);
    for (let i = 0; i < todo.length; i += 16) {
      const part = todo.slice(i, i + 16), out = await embed(conn, part.map(vecText), signal);
      if (key !== Dkey) throw new Error('换了聊天窗口，先停下');
      part.forEach((e, k) => { v.v[e.id] = new Float32Array(out[k]); });
      await kvSet('memvec:' + key, v); step && step(Math.min(todo.length, i + 16), todo.length);
    }
    return todo.length;
  })().finally(() => { filling = null; }));
}
/** 新记了事：后台把向量补上（不挡聊天，失败只记一条警告；模型换过的不自动重算，等你在设置里点） */
function vecLater() {
  const conn = vecConn(); if (!conn || filling) return;
  vecs().then(v => stale(v, conn) || !D.ev.some(e => !v.v[e.id]) ? 0 : vecFill()).catch(e => log('warn', '岁岁砂', '没补上向量：' + e.message));
}
/** 清空这个聊天窗口记下的全部（设置和标签不动） */
export async function wipe() { await load(); D = blank(); V = { model: '', v: {} }; Vkey = Dkey; await kvDel('memvec:' + Dkey); await kvDel('memjob:' + Dkey); await save(); }
/** 小标签改名（改成已有的名字就是合并，to 空着就是删掉） */
export async function retag(from, to) { for (const e of D.ev) if (e.tags.includes(from)) e.tags = [...new Set(e.tags.map(t => t === from ? to : t).filter(Boolean))]; await save(); }
/** 大标签改名 / 删掉（to 空着）/ 加一个（from 空着） */
export async function rebig(from, to) {
  state.apps.memory.big = [...new Set(from ? bigs().map(t => t === from ? to : t).filter(Boolean) : [...bigs(), to])]; commit('apps');
  if (from) { for (const e of D.ev) if (e.big.includes(from)) e.big = [...new Set(e.big.map(t => t === from ? to : t).filter(Boolean))]; await save(); }
}
/** 所有出场过的人（不算我）和要不要显示在名字行上：[名字, 显示]…，按你排的顺序，没排过的按出场多少。
 *  自动显示：手机里的联系人、出现在 3 件以上事里的、和我的关系变过的；你在设置里定过的以你为准 */
export function cast(d = D) {
  const n = new Map(); for (const e of d.ev) for (const w of e.who) n.set(w, (n.get(w) || 0) + 1);
  const mine = new Set(state.contacts.flatMap(c => [...namesOf(c)]));
  const all = [...new Set([...state.contacts.map(c => canon(c.name || c.nick)), ...d.ppl.map(p => p.name), ...d.rel.flatMap(r => [r.a, r.b]), ...n.keys()])].filter(x => x && !isMe(x));
  const auto = x => mine.has(x) || (n.get(x) || 0) >= 3 || d.rel.some(r => r.hist.length && [r.a, r.b].includes(x) && [r.a, r.b].some(isMe));
  const show = d.show || {}, ord = d.order || [], rank = x => { const i = ord.indexOf(x); return i < 0 ? 1e6 - (n.get(x) || 0) : i; };
  return all.sort((a, b) => rank(a) - rank(b)).map(x => [x, show[x] ?? auto(x)]);
}
export { isMe };

/* ---------- 想起哪几件：按意思找（向量找出最像的 20 件，重排再挑最准的），不行就退回按词找（下面的 recall） ---------- */
const TH = [[.2, .5], [.35, .56], [.6, .64]];   // 多像才算想起，[有重排时看重排的分, 只有向量时看相似度]：容易想起的 / 一般的 / 日常
const tier = e => e.mark === 'hi' || e.big.some(b => EASY.has(b)) ? 0 : e.big.length && e.big.every(b => b === '日常') ? 2 : 1;
const dot = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; };
/** 这件事出自第几楼（不是现在这个聊天的楼层记下的是 -1） */
const floorOf = e => e.fl ? e.fl[1] : /^story:\d+$/.test(e.src || '') ? +e.src.slice(6) : -1;
/** 这轮给手机看的正文从第几楼开始 */
function ctxFrom() { const ms = chatMsgs(), c = ctxCfg(); let n = c.count, i = ms.length; while (i > 0 && n > 0) { const x = ms[--i]; if (!x.is_system && x.mes && (c.withUser || !x.is_user)) n--; } return i; }
/** 想起了：记进日志，被想起一次记一次（不改 ver：页面不用跟着重画） */
function noted(pick, drift) {
  if (pick.length || drift) apiLog('info', '岁岁砂', [pick.length && '想起：' + pick.map(e => e.title).join('、'), drift && '忽然想起：' + drift.title].filter(Boolean).join('；'));
  if (pick.length) { pick.forEach(e => { e.used = (e.used || 0) + 1; }); kvSet('mem:' + Dkey, D).catch(e => log('warn', '岁岁砂', '没存上想起的次数：' + e.message)); }
}
let vecErr = '';
/** 回 [想起的, 忽然想起的一件, 每件为什么, 这次是怎么找的] */
async function recollect(pool, scan, self, here) {
  const m = state.apps.memory, conn = vecConn(), said = scan.slice(-240).trim(), words = () => [...recall(pool, scan, self), '按词找'];
  if (!conn || !pool.length || !said) return words();
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 9000);
  try {
    const v = await vecs(); if (stale(v, conn)) throw new Error('向量模型换了，要到设置里重新算一遍');
    vecLater();
    const have = pool.filter(e => v.v[e.id]); if (!have.length) return words();
    const q = (await embed(conn, [said], ac.signal))[0], qn = Math.sqrt(dot(q, q));
    // 最像的 20 件（就在现在这个地方发生的加一点）
    let c = have.map(e => { const x = v.v[e.id]; return [e, dot(q, x) / (qn * Math.sqrt(dot(x, x))) + (e.place && e.place === here ? .04 : 0)]; }).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const rr = m.rerank !== false && connOfTag('重排'), k = rr && keysOf(rr).length ? 0 : 1;
    if (!k) { const sc = new Map(await rerank(rr, said, c.map(([e]) => vecText(e)), ac.signal)); c = c.map(([e], i) => [e, sc.get(i) || 0]).sort((a, b) => b[1] - a[1]); }
    // 够像的才算想起；同一个小标签的只占一个名额（另外几件会跟着它一起带上）
    const why = new Map(), pick = [], near = [], used = new Set(), max = m.slots ?? 3;
    for (const [e, sim] of c) {
      const th = TH[tier(e)][k], tags = e.tags.filter(t => t !== '手机');
      if (sim < th) { if (sim >= th * .75) near.push(e); why.set(e, [`有点像 · ${sim.toFixed(2)}`, []]); continue; }
      if ((max && pick.length >= max) || tags.some(t => used.has(t))) continue;
      tags.forEach(t => used.add(t)); pick.push(e); why.set(e, [`意思相近 · ${sim.toFixed(2)}`, []]);
    }
    const drift = near.length && Math.random() < DRIFT ? near[0] : null;
    noted(pick, drift); vecErr = '';
    return [pick, drift, why, k ? '按意思找' : '按意思找 + 重排'];
  } catch (e) {
    const msg = ac.signal.aborted ? '等了 9 秒没回应' : e.message;
    if (msg !== vecErr) log('warn', '岁岁砂', `这次没能按意思找，改成按词找：${vecErr = msg}`);
    return words();
  } finally { clearTimeout(timer); }
}

/* ---------- 按词找（向量用不了时的退路；学自「星络」：扩散激活 + ACT-R 的激活打分，见 docs/pages-memory.md） ----------
 * 人、地点、标签、关键词当成「星」，一件事挂在它提到的几颗星上；一起出现过的两颗星之间就有一条线。
 * 1. 点星：最近说的话里字面出现的星亮起来（最后几句最亮，再往前的暗一半）。
 * 2. 漫开：亮光顺着线往旁边走两步，每走一步打对折；一颗星连着的事越多，分给每条线的越少（谁都连着的星不算数）。
 * 3. 挑事：一件事的分 = 它挂的星亮多少（越常见的星分越少）+ 字面像不像 + 重要度 + 以前被想起过几次；
 *    字面按「越少见的词越算数」比（BM25）；不按时间变淡。最多 3 件，分不够的不带。 */
function recall(pool, scan, self) {
  const why = new Map();   // 想起的每一件：[为什么（给人看）, 是哪几个词（点「不该想起」时记进错题本）]
  if (!pool.length || !scan) return [[], null, why];
  const stars = e => [...new Set([...e.who, e.place, ...e.tags, ...(e.keys || [])].filter(n => n && n.length > 1 && !self.has(n)))];
  const deg = new Map(), link = new Map();
  for (const e of pool) { const s = stars(e); for (const a of s) { deg.set(a, (deg.get(a) || 0) + 1); const l = link.get(a) || link.set(a, new Map()).get(a); for (const b of s) if (b !== a) l.set(b, (l.get(b) || 0) + 1); } }
  const recent = scan.slice(-400), alias = n => [n, ...((D.ppl.find(p => p.name === n) || {}).alias || [])];
  const act = new Map();
  for (const n of deg.keys()) { const w = alias(n).some(a => recent.includes(a)) ? 1 : alias(n).some(a => scan.includes(a)) ? .5 : 0; if (w) act.set(n, w); }
  let front = new Map(act);
  for (const k of [.5, .25]) {
    const next = new Map();
    for (const [a, v] of front) for (const [b, c] of link.get(a) || []) if (!act.has(b) || next.has(b)) next.set(b, (next.get(b) || 0) + v * k * c / deg.get(a));
    for (const [b, v] of next) act.set(b, (act.get(b) || 0) + v);
    front = next;
  }
  // 字面：刚才那几句里的两字词，在越少的事里出现越算数（idf；「我们」「还记」这种到处都有的几乎不算），带虚字的不算。
  // 没有关键词的老记忆（v0.8.71 前整理的）主要靠这个想起来
  // 单个字也算（分量减半）：「喝酒」和「喝了一口梅酒」两字词对不上，但「酒」「喝」对得上
  const toks = s => { const g = grams(s); for (const ch of norm(s).match(/[\u4e00-\u9fff]/g) || []) g.add(ch); return g; };
  // 字面只比内容：说话人的名字（每行开头的「桃霁：」）、TA 们和我的名字都去掉，不然谁的事都对得上
  const strip = s => [...self].filter(n => n.length > 1).reduce((x, n) => x.split(n).join(' '), s);
  const docs = new Map(pool.map(e => [e, toks(strip([e.title, e.text, e.place, ...e.tags, ...(e.keys || [])].join(' ')))])), N = pool.length;
  // 单个字只看最后一句（刚说的话），不然几百字的正文里随便几个字都能对上
  // 单个字再多去掉几个到处都有的（过、时、日、天…）；「生日」这种两字词照样算
  const said = toks(strip(scan.slice(scan.lastIndexOf('\n') + 1)));
  const q = [...new Set([...grams(strip(recent)), ...said])].filter(b => !/[的了吗呢吧啊呀哦嗯我你他她它们是在有这那么个一不也就都还和跟想说要会去来看好]/.test(b) && (b.length > 1 || !/[过着什时候日天年月点今明昨上下前后里次]/.test(b)));
  const idf = new Map(q.map(b => { const df = pool.filter(e => docs.get(e).has(b)).length; return [b, df ? Math.log(1 + N / df) : 0]; }));
  // 亮着的星、对上的字；错题本里的词（点过「不该想起」的）不再让这件事想起来
  const words = e => { const no = new Set(e.no || []), hit = q.filter(b => docs.get(e).has(b) && !no.has(b)); return [stars(e).filter(n => act.get(n) && !no.has(n)), hit.length < 2 ? [] : hit]; };   // 只对上一个字 / 词的不算，免得碰巧
  const score = e => {
    const [st, hit] = words(e), lit = hit.reduce((t, b) => t + idf.get(b) * (b.length > 1 ? 1 : .5), 0) * .25 + (hit.filter(b => said.has(b)).length >= 2 ? .3 : 0);   // 刚说的那句话里对上两处的再加一点
    const s = st.reduce((t, n) => t + act.get(n) / Math.sqrt(deg.get(n)), 0) + Math.min(2, lit);
    if (s < .3) return 0;   // 和现在说的一点都不沾：重要度、想起过几次、高光都不算
    return s + e.imp * .08 + Math.log1p(e.used || 0) * .1 + (e.mark === 'hi' ? .3 : 0);   // 高光：沾边就更容易想起
  };
  const scored = pool.map(e => [e, score(e)]), pick = scored.filter(([, s]) => s >= .8).sort((a, b) => b[1] - a[1]).slice(0, state.apps.memory.slots ?? 3).map(([e]) => e);
  // 忽然想起：和现在有点关系（沾边但不够格）的里面，偶尔按分数抽一件（学自玄参的「自然浮现」：纯随机像失忆，只取最高分又会一直是那几件）
  const near = scored.filter(([e, s]) => s > 0 && s < .8 && !pick.includes(e)), total = near.reduce((t, [, s]) => t + s, 0);
  let drift = null;
  if (near.length && Math.random() < DRIFT) { let r = Math.random() * total; drift = (near.find(([, s]) => (r -= s) <= 0) || near[0])[0]; }
  noted(pick, drift);
  for (const e of [...pick, drift].filter(Boolean)) { const [st, hit] = words(e), w = [...new Set([...st, ...hit])]; why.set(e, ['对上：' + (w.filter(x => x.length > 1).join('、') || w.join('、')), w]); }
  return [pick, drift, why];
}
