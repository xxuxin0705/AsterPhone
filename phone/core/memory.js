// 念念树：手机里的 TA 记得的事（方案见 docs/pages-memory.md）。
// 每个酒馆聊天窗口一份，存在 kv 的 mem:窗口 里：
//   ev 事件 / rel 关系（两人一条，只记一次）/ ppl 人物 / days 特殊日子 / todo 没完的事 / trees 有树的 TA（联系人 id）
// 记忆从三处来：① 整理（世界书、导入的文件、当前聊天切成一批批交给 AI，同一时间只跑一个，断了能接着跑，kv 的 memjob:窗口）；
// ② 跟着剧情自动记（正文里的 <astermem> 暗号，core/sync.js 读到交给 fromStory）；③ 手机聊天自动记（TA 回消息时顺手写的 <astermem>，交给 fromChat）。
// 三处写的都是同一种行（见 parse），同一件事只记一次。
import { state, win, kvGet, kvSet, kvDel } from './store.js';
import { uid } from './util.js';
import { generate, resolveConn } from './api.js';
import { compose, myName } from './promptstore.js';
import { cleanText } from './context.js';
import { log } from './log.js';
import { ctx } from './bridge.js';
import * as time from './time.js';

export const KINDS = ['恋人', '暧昧', '家人', '朋友', '对手', '其他'];
const BATCH = 30000;   // 一批多少字

/* ---------- 存 ---------- */
let D = null, Dkey = null;
export let ver = 0;   // 改过一次加一：页面返回时看它变没变，没变就不重画
const blank = () => ({ ev: [], rel: [], ppl: [], days: [], todo: [], trees: [] });
export async function load() {
  if (D && Dkey === win.key) return D;
  const k = win.key, d = await kvGet('mem:' + k);
  if (k !== win.key) return load();   // 读的时候换了窗口
  D = Object.assign(blank(), d); Dkey = k; ver++;
  return D;
}
export const save = () => { ver++; return kvSet('mem:' + Dkey, D); };

/* ---------- 名字 ---------- */
const norm = s => String(s || '').trim();
/** 这个人的所有叫法：联系人的真名、网名、备注，加上人物表里记的别名 */
export function namesOf(c) {
  const out = new Set([c.name, c.nick, c.remark].map(norm).filter(Boolean));
  for (const p of (D && D.ppl) || []) if ([p.name, ...p.alias].some(n => out.has(n))) [p.name, ...p.alias].forEach(n => out.add(n));
  return out;
}
const isMe = n => n === myName() || n === '我' || n === '{{user}}';
export const evOf = (c, d = D) => { const ns = namesOf(c); return d.ev.filter(e => e.who.some(n => ns.has(n))); };
export const relOf = (c, d = D) => { const ns = namesOf(c); return d.rel.filter(r => ns.has(r.a) || ns.has(r.b)); };

/* ---------- 读 AI 写回来的行 ---------- */
// 事件：日期｜时段｜地点｜标题｜经过｜人物｜标签｜重要度｜影响｜关键词
// 影响（after）= 这件事过去后留下了什么（伤、心结、还留着的东西），没有就空着；以前存的 now 是事情刚结束时的样子，只在 TA 最近那件事上当「现在」用
// 关系：甲｜乙｜关系｜从何时起｜现在   人物：名字｜别名｜是谁   日子：月-日｜什么日子｜和谁有关   没完：谁｜什么事   完成：谁｜什么事
const list = s => norm(s).split(/[、,，/]/).map(norm).filter(Boolean);
/** 「2005年4月6日」「2005/4/6」「2005-04-06?」→ ['2005-04-06', 是不是推测] */
export function day(s) {
  s = norm(s); const guess = /[?？]|推测|约|大概/.test(s);
  const m = /(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/.exec(s);
  return m ? [`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, guess] : ['', false];
}
export function parse(raw) {
  const out = { ev: [], rel: [], ppl: [], days: [], todo: [], done: [] };
  const text = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]?\s*(事件|关系|人物|日子|没完|完成)\s*[:：]\s*(.+)$/.exec(line); if (!m) continue;
    const f = m[2].split(/[｜|]/).map(norm);
    if (m[1] === '事件' && f[3]) {
      const [at, guess] = day(f[0]);
      out.ev.push({ at, guess, part: f[1] === '不知道' ? '' : f[1] || '', place: f[2] === '不知道' ? '' : f[2] || '', title: f[3], text: f[4] || '', who: list(f[5]), tags: list(f[6]), imp: Math.min(5, Math.max(1, parseInt(f[7], 10) || 2)), after: f[8] || '', keys: list(f[9]) });
    } else if (m[1] === '关系' && f[1]) out.rel.push({ a: f[0], b: f[1], kind: KINDS.includes(f[2]) ? f[2] : '其他', since: f[3] || '', now: f[4] || '' });
    else if (m[1] === '人物' && f[0]) out.ppl.push({ name: f[0], alias: list(f[1]), who: f[2] || '' });
    else if (m[1] === '日子') { const md = /(\d{1,2})\D+(\d{1,2})/.exec(f[0]); if (md && f[1]) out.days.push({ md: `${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`, what: f[1], who: list(f[2]) }); }
    else if (m[1] === '没完' && f[1]) out.todo.push({ who: f[0], text: f[1] });
    else if (m[1] === '完成' && f[1]) out.done.push({ who: f[0], text: f[1] });
  }
  return out;
}

/* ---------- 合并（同一件事只记一次） ---------- */
const grams = s => { const t = norm(s).replace(/\s+/g, ''), g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const alike = (a, b) => { const x = grams(a), y = grams(b); return overlap(x, y) / Math.max(1, Math.min(x.size, y.size)); };
/** 人物表里的别名 → 正名 */
const canon = n => { const p = D.ppl.find(p => p.name === n || p.alias.includes(n)); return p ? p.name : n; };
/** 合并进来，返回新加了几条事件 */
export function merge(x, src = '') {
  for (const p of x.ppl) {
    const o = D.ppl.find(q => q.name === p.name || q.alias.includes(p.name) || p.alias.includes(q.name));
    if (!o) D.ppl.push({ ...p, src });
    else { o.alias = [...new Set([...o.alias, ...p.alias, p.name].filter(n => n !== o.name))]; if (!o.who) o.who = p.who; }
  }
  let added = 0;
  for (const e of x.ev) {
    e.who = [...new Set(e.who.map(canon))];
    const dup = D.ev.find(o => o.at === e.at && (o.title === e.title || alike(o.title + o.text, e.title + e.text) > .6));
    if (dup) { dup.imp = Math.max(dup.imp, e.imp); continue; }
    D.ev.push({ id: uid('m'), ...e, pin: false, off: false, src }); added++;
  }
  for (const r of x.rel) {
    const a = canon(r.a), b = canon(r.b), o = D.rel.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a));
    if (!o) { D.rel.push({ id: uid('r'), a, b, kind: r.kind, since: r.since, now: r.now, hist: [], src }); continue; }
    // 关系变了：旧的留进 hist（以后能看出关系是怎么变过来的）
    if (o.kind !== r.kind) { o.hist.push({ kind: o.kind, since: o.since, src }); o.kind = r.kind; o.since = r.since || o.since; }
    if (r.now) o.now = r.now;
  }
  for (const d of x.days) if (!D.days.some(o => o.md === d.md && alike(o.what, d.what) > .5)) D.days.push({ ...d, who: d.who.map(canon), src });
  for (const t of x.todo) if (!D.todo.some(o => !o.done && alike(o.text, t.text) > .6)) D.todo.push({ id: uid('t'), who: canon(t.who), text: t.text, done: false, src });
  for (const t of x.done) { const o = D.todo.find(o => !o.done && alike(o.text, t.text) > .45); if (o) { o.done = true; o.doneBy = src; } }
  D.ev.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
  return added;
}

/** 收回某一处记下的（正文那一楼换了 / 重新生成了、手机里那批消息重新生成了）：那一处新加的删掉，关系改回去、没完的事改回没完 */
function forget(src) {
  for (const k of ['ev', 'ppl', 'days', 'todo']) D[k] = D[k].filter(x => x.src !== src);
  D.rel = D.rel.filter(r => r.src !== src);
  for (const r of D.rel) { const i = r.hist.findIndex(h => h.src === src); if (i >= 0) { Object.assign(r, { kind: r.hist[i].kind, since: r.hist[i].since }); r.hist.splice(i); } }
  for (const t of D.todo) if (t.doneBy === src) { t.done = false; delete t.doneBy; }
}
const storyDay = () => { const d = time.isStory() ? time.story().date : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowPart = () => time.partOfDay(time.isStory() ? time.story().hh : new Date().getHours());
/** 收一段 <astermem> 暗号：src 是这一处的名字，同一处内容变了就先收回旧的再记；fix 用来改每条事件（补日期、限定谁知道） */
async function take(src, body, fix) {
  const d = await load(), sig = String(body).trim(), S = d.sigs || (d.sigs = {});
  if (S[src] === sig || (!sig && !(src in S))) return 0;
  forget(src);
  if (!sig) { delete S[src]; await save(); return 0; }   // 这一楼换了个没写暗号的版本：之前记的收回就好
  S[src] = sig;
  const x = parse(sig); x.ev.forEach(fix);
  const n = merge(x, src); await save();
  if (n) log('info', '念念树', `记下 ${n} 件事：${x.ev.map(e => e.title).join('、')}`);
  return n;
}
/** 正文第 id 层里的 <astermem>（换了 swipe、改了内容就按新的重记）：没写日期就用现在的剧情日期 */
export function fromStory(id, body) {
  const at = storyDay(), part = nowPart();
  return take(`story:${id}`, body, e => { if (!e.at) { e.at = at; if (!e.part) e.part = part; } });
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
  });
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
export function floorsText(msgs, { withUser = true, from = 0, to = Infinity, keep } = {}) {
  const out = [];
  msgs.forEach((m, i) => {
    // 隐藏起来的楼层（is_system，总结插件常这么做）也要：那正是早先的剧情
    if (i < from || i > to || !m.mes || (m.is_user && !withUser)) return;
    const d = DATE_RE.exec(m.mes), t = cleanText(m.mes, keep);
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
/** 已经知道的人、关系和最近的事，告诉 AI 别重复、名字照这个写 */
function known() {
  const ppl = D.ppl.map(p => `${p.name}${p.alias.length ? `（${p.alias.join('、')}）` : ''}`).join('、');
  const rel = D.rel.map(r => `${r.a}—${r.b}：${r.kind}`).join('；');
  const ev = D.ev.slice(-40).map(e => `${e.at || '不知道'} ${e.title}`).join('\n');
  return [ppl && '人物：' + ppl, rel && '关系：' + rel, ev && '已经记下的事：\n' + ev].filter(Boolean).join('\n') || '（还没有）';
}
/** list：一批批文字。从 done 那批接着跑 */
export async function startJob(label, list, done = 0) {
  if (running()) throw new Error('已经在整理了');
  await load();
  const key = win.key;
  job = { label, list, done, ac: new AbortController(), error: '', added: 0 };
  tell('start', job);
  try {
    while (job.done < job.list.length) {
      await kvSet('memjob:' + key, { label, list, done: job.done });
      const raw = await generate({ conn: resolveConn('text', 'memory'), app: '念念树',
        prompt: compose('memSort', { source: list[job.done], existing: known() }), temperature: .3, maxTokens: 4000, stop: job.ac.signal });
      if (key !== win.key) throw new Error('换了聊天窗口，先停下');
      job.added += merge(parse(raw), label); await save();
      job.done++; tell('step', job);
    }
    await kvDel('memjob:' + key);
  } catch (e) {
    job = { ...job, ac: null, error: e.message }; tell('fail', job); return;
  }
  const j = job; job = null; tell('done', j);
}

/* ---------- 聊天时带进去 ---------- */
const today = () => { const d = time.isStory() ? time.story().date : new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cut = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
/** 最近的一件（按日期） */
export const newest = list => list.reduce((a, e) => !a || (e.at || '') >= (a.at || '') ? e : a, null);
/** 一件事后面带的：留下的影响；以前存的「现在」只在最近那件上算数 */
export const tail = (e, list) => e.after ? `（后来：${e.after}）` : e.now && e === newest(list) ? `（现在：${e.now}）` : '';
/** 给 people（这次聊天里的 TA 们）带上的记忆。scan = 最近的聊天和正文，拿来对名字、对字面 */
export async function memoryFor(people, scan = '') {
  if (!state.apps.memory.on || !people.length) return '';
  const d = await load();
  if (!d.ev.length && !d.rel.length) return '';
  const ns = new Set(people.flatMap(c => [...namesOf(c)])), hit = n => n && scan.includes(n), lines = [];
  // 每次都带：现在的关系、没完的事、钉住的
  // TA 和我的、TA 们之间的、TA 和这会儿聊到的人的
  const other = r => ns.has(r.a) ? r.b : ns.has(r.b) ? r.a : null;
  const rel = d.rel.filter(r => { const o = other(r); return o != null && (isMe(o) || ns.has(o) || hit(o)); });
  if (rel.length) lines.push('关系：' + rel.map(r => `${r.a}和${r.b}是${r.kind}${r.since ? `（${r.since}起）` : ''}${r.now ? `，现在${r.now}` : ''}`).join('；'));
  const todo = d.todo.filter(t => !t.done && ns.has(t.who));
  if (todo.length) lines.push('没完的事：' + todo.map(t => `${t.who}：${t.text}`).join('；'));
  // 对上才带：今天是什么日子、聊到的人
  const days = d.days.filter(x => x.md === today());
  if (days.length) lines.push('今天：' + days.map(x => x.what).join('；'));
  const ppl = d.ppl.filter(p => !ns.has(p.name) && !isMe(p.name) && [p.name, ...p.alias].some(hit));
  if (ppl.length) lines.push('聊到的人：' + ppl.map(p => `${p.name}：${p.who}`).join('；'));
  // 想起的事：钉住的 + 联想到的最多 3 件（见 recall）
  const pool = d.ev.filter(e => !e.off && e.who.some(n => ns.has(n)));
  const pick = [...pool.filter(e => e.pin), ...recall(pool.filter(e => !e.pin), scan, new Set([...ns, myName(), '我']))];
  if (pick.length) lines.push('想起的事（这些是真发生过的。自然地提起就好，不用每件都说；同一类的事有好几次时，像真人一样分清是哪一次：可以先反问、逗一逗，或者都说起。提到过去时只用这里、正文和世界书里写了的，没写到的事和细节不要编）：\n' + pick.map(e => `- ${[e.at, e.part, e.place].filter(Boolean).join(' ')}：${cut(e.title + '。' + e.text, 160)}${tail(e, pool)}`).join('\n'));
  return lines.length ? `\n【TA 记得的事】\n${lines.join('\n')}\n` : '';
}

/* ---------- 想起哪几件（学自「星络」：扩散激活 + ACT-R 的激活打分，见 docs/pages-memory.md） ----------
 * 人、地点、标签、关键词当成「星」，一件事挂在它提到的几颗星上；一起出现过的两颗星之间就有一条线。
 * 1. 点星：最近说的话里字面出现的星亮起来（最后几句最亮，再往前的暗一半）。
 * 2. 漫开：亮光顺着线往旁边走两步，每走一步打对折；一颗星连着的事越多，分给每条线的越少（谁都连着的星不算数）。
 * 3. 挑事：一件事的分 = 它挂的星亮多少（越常见的星分越少）+ 字面像不像 + 重要度 + 以前被想起过几次；
 *    字面按「越少见的词越算数」比（BM25）；刚想起过的（十分钟内）先压下去，免得每句都提同一件（又直接说到它的不算）；不按时间变淡。最多 3 件，分不够的不带。 */
function recall(pool, scan, self) {
  if (!pool.length || !scan) return [];
  const stars = e => [...new Set([...e.who, e.place, ...e.tags, ...(e.keys || [])].filter(n => n && n.length > 1 && !self.has(n)))];
  const deg = new Map(), link = new Map();
  for (const e of pool) { const s = stars(e); for (const a of s) { deg.set(a, (deg.get(a) || 0) + 1); const l = link.get(a) || link.set(a, new Map()).get(a); for (const b of s) if (b !== a) l.set(b, (l.get(b) || 0) + 1); } }
  const recent = scan.slice(-400), alias = n => [n, ...((D.ppl.find(p => p.name === n) || {}).alias || [])];
  const act = new Map(), hot = new Set();   // hot：刚才那几句里直接说到的星
  for (const n of deg.keys()) { const w = alias(n).some(a => recent.includes(a)) ? 1 : alias(n).some(a => scan.includes(a)) ? .5 : 0; if (w) act.set(n, w); if (w === 1) hot.add(n); }
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
  const q = [...toks(strip(recent))].filter(b => !/[的了吗呢吧啊呀哦嗯我你他她它们是在有这那么个一不也就都还和跟想说要会去来看好]/.test(b));
  const idf = new Map(q.map(b => { const df = pool.filter(e => docs.get(e).has(b)).length; return [b, df ? Math.log(1 + N / df) : 0]; }));
  const now = Date.now();
  const score = e => {
    const hit = q.filter(b => docs.get(e).has(b)), lit = hit.length < 2 ? 0 : hit.reduce((t, b) => t + idf.get(b) * (b.length > 1 ? 1 : .5), 0) * .25;   // 只对上一个字 / 词的不算，免得碰巧
    const s = stars(e).reduce((t, n) => t + (act.get(n) || 0) / Math.sqrt(deg.get(n)), 0) + Math.min(2, lit);
    if (s < .3) return 0;   // 和现在说的一点都不沾：重要度、想起过几次都不算
    const again = e.last && now - e.last < 600000 && !stars(e).some(n => hot.has(n)) && lit < .8;   // 刚想起过、这会儿又没直接说到它：先压下去
    return (s + e.imp * .08 + Math.log1p(e.used || 0) * .1) * (again ? .25 : 1);
  };
  const pick = pool.map(e => [e, score(e)]).filter(([, s]) => s >= .8).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e);
  // 被想起一次记一次（不改 ver：页面不用跟着重画）
  if (pick.length) log('info', '念念树', '想起：' + pick.map(e => e.title).join('、'));
  if (pick.length) { pick.forEach(e => { e.used = (e.used || 0) + 1; e.last = now; }); kvSet('mem:' + Dkey, D).catch(e => log('warn', '念念树', '没存上想起的次数：' + e.message)); }
  return pick;
}
