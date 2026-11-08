// 幕间 · 一局的数据和流程：车卡一次 API（几个人一起），开局一次 API 生成骨架，之后每回合一次；骰子由手机掷（rules.js），AI 只收结果。
// 整局不进正文、不进记忆。局存在 kv 的 int:窗口 里；正在等 AI 的那一步放在模块里，退出页面再进来还是「取消」。
import { state, win, contact, kvGet, kvSet, chatForContact } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName, myPersona } from '../../core/promptstore.js';
import { storyText } from '../../core/context.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { uid } from '../../core/util.js';
import * as R from './rules.js';
import { connFor } from '../../core/voice.js';
import { kindOf, hintFor, plain } from '../../core/act.js';
import { langName } from '../../core/translate.js';

export const CAP = 8;   // 每幕最多几回合，到了 KP 必须推到出口
let D = null, Dkey = '';
export async function load() { if (D && Dkey === win.key) return D; Dkey = win.key; D = (await kvGet('int:' + win.key).catch(() => null)) || { games: [] }; return D; }
export const save = () => kvSet('int:' + Dkey, D);
export const current = () => D.games.find(g => !g.done) || null;
export const all = () => (D ? D.games : []);
export let job = null;   // { g, ac }：正在等 AI 的那一步
export const running = g => job && (!g || job.g === g);
export function cancel() { if (job) job.ac.abort(); }

const strip = t => String(t).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/g, '');
function parse(t) {
  const s = strip(t), i = s.indexOf('{'), j = s.lastIndexOf('}');
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { throw new Error('AI 回的格式不对'); }
}
async function ask(cat, vars, maxTokens, g) {
  const ac = new AbortController(); job = { g, ac };
  try { return parse(await generate({ conn: resolveConn('text', 'interlude'), app: '幕间', maxTokens, stop: ac.signal, prompt: compose(cat, vars) })); }
  finally { job = null; }
}
const placesText = () => Object.entries(R.PLACES).map(([k, v]) => `${k} = ${v}`).join('；');
const attrsText = a => R.ATTRS.map(([k, n]) => `${n} ${a[k]}`).join('、');
const topSkills = s => Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join('、');
export const pcText = g => `${g.pc.name}（${g.pc.job}）：血 ${g.pc.hp}/${g.pc.hpMax}，理智 ${g.pc.san}/${g.pc.sanMax}${g.pc.mad ? `，临时疯狂·${g.pc.mad.name}（还剩 ${g.pc.mad.left} 回合）` : ''}；${attrsText(g.pc.attrs)}；技能：${topSkills(g.pc.skills)}`;
export const isZh = l => !l || /^zh/.test(l);
/** 这个人说什么语言：开局设置里改过的 → 聊天设置里让 TA 说的 → 中文 */
export const langOf = id => { if (id === 'me' || id === 'sys') return 'zh-CN'; const cfg = (chatForContact(id, false) || { cfg: {} }).cfg; return (cfg.sendTr && cfg.theirLang) || 'zh-CN'; };
// 台词开头怎么标语气：照这个人现在用的语音接口（和电台、正文朗读一样的那套标签）
const toneOf = id => hintFor(kindOf(connFor(id))).replace(/每段/g, '台词').replace(/>> 开头的翻译行不写标签。/, 'zh 翻译不写标签。');
const speakLine = (g, id) => `说话用${langName(isZh(g.lang[id]) ? 'zh-CN' : g.lang[id])}；台词语气：${toneOf(id)}`;
export const castText = g => g.party.map(m => `${m.name}（${m.job}）：血 ${m.hp}/${m.hpMax}，理智 ${m.san}/${m.sanMax}${m.mad ? `，临时疯狂·${m.mad.name}` : ''}；技能：${topSkills(m.skills)}；人设：${(personaOf(contact(m.id)) || '').slice(0, 300) || '（没有更多资料）'}；${speakLine(g, m.id)}`).join('\n') || '（没有别人，只有 KP 和你）';
const kpText = g => { const c = g.kp !== 'sys' && contact(g.kp);
  return c ? `你是 ${nameOf(c)}，这一局由你来当《克苏鲁的呼唤》的守秘人（KP）：用你自己的性格和口吻主持（叙述还是用中文旁白），你知道真相，但不当玩家。你的人设：${(personaOf(c) || '').slice(0, 400) || '（没有更多资料）'}；你自己说话时${speakLine(g, c.id)}\n`
    : `你是这局《克苏鲁的呼唤》的守秘人（KP），中立、不下场，KP 说话时${speakLine(g, 'sys')}\n`; };
const knowText = g => g.know
  ? '大家都知道这是在跑团：角色们是坐在桌边、扮演调查员的玩家。可以偶尔（不是每回合）插一两句场外话（ooc: true）：吐槽流程、开玩笑、闲聊；KP 也可以出来维持秩序。但戏里要守规矩：调查员之间还没在戏里认识、没交换过情报时，戏里就不能知道对方那边发生的事，要在戏里走一遍认识、交换情报的过程（场外可以吐槽「就当我们叽里呱啦交换完了」）。'
  : '所有人都当真，这就是他们的经历，不出戏，不要场外话。';
/** 一句台词给人看 / 给 KP 看的样子 */
export const lineText = l => l.text || `${l.ooc ? '（场外）' : ''}${l.act || ''}${l.say ? `「${plain(l.say)}」` : ''}`;

/* ---------- 调查员卡：跟着人存（一个人可以有好几张），下次上桌默认用上次那张 ----------
   卡 { id, owner: 'me' | 联系人 id, name, age, sex, job, home, bg: { who, past, goal, secret }, attrs, skills, at } */
export const cardsOf = owner => (D.cards || []).filter(c => c.owner === owner);
export const lastCard = owner => cardsOf(owner).find(c => c.id === (D.last || {})[owner]) || cardsOf(owner).slice(-1)[0] || null;
export function useCard(c) { (D.last || (D.last = {}))[c.owner] = c.id; return save(); }
export async function dropCard(c) { D.cards = D.cards.filter(x => x !== c); if ((D.last || {})[c.owner] === c.id) delete D.last[c.owner]; await save(); }
const ownerName = o => o === 'me' ? myName() : nameOf(contact(o));
const ownerPersona = o => o === 'me' ? myPersona() : personaOf(contact(o));
/** 一次给好几个人车卡（owners：'me' / 联系人 id）。属性由手机先掷好，AI 照正文和人设写身份、背景、技能 */
export async function makeCards(owners) {
  const rolled = owners.map(o => ({ o, a: R.rollAttrs() }));
  const out = await ask('intCards', {
    story: storyText() || '（正文里还没发生什么）', jobs: R.JOBS.map(j => j[0]).join('、'),
    skills: Object.entries(R.SKILLS).map(([k, v]) => `${k} ${v}`).join('、') + '、闪避（敏捷÷2）、母语（教育）',
    roster: rolled.map(({ o, a }) => `${ownerName(o)}${o === 'me' ? '（玩家本人）' : ''}：${attrsText(a)}；技能点上限 ${R.points(a)}；人设：${(ownerPersona(o) || '').slice(0, 500) || '（没有更多资料）'}`).join('\n'),
  }, 1200 + 700 * owners.length);
  const list = Array.isArray(out.cards) ? out.cards : [];
  if (!list.length) throw new Error('AI 回的格式不对');
  const made = rolled.map(({ o, a }, i) => {
    const x = list.find(c => c.who === ownerName(o)) || list[i] || {};
    return { id: uid('ic'), owner: o, at: Date.now(), name: String(x.name || ownerName(o)), age: +x.age || 25, sex: String(x.sex || ''), job: String(x.job || ''), home: String(x.home || ''),
      bg: { who: '', past: '', goal: '', secret: '', ...(x.bg || {}) }, attrs: a, skills: R.fixSkills(a, x.skills) };
  });
  (D.cards || (D.cards = [])).push(...made); made.forEach(c => { (D.last || (D.last = {}))[c.owner] = c.id; });
  await save();
  return made;
}
const cardText = c => `${c.name}（${c.age} 岁，${c.sex}，${c.job}，住在${c.home || '—'}）：${attrsText(c.attrs)}；技能：${topSkills(c.skills)}；背景：${c.bg.who} ${c.bg.past} 目标：${c.bg.goal} 秘密：${c.bg.secret}`;
const fromCard = c => { const d = R.derived(c.attrs); return { id: c.owner, card: c.id, name: c.name, job: c.job, attrs: c.attrs, skills: { ...c.skills }, hp: d.hp, hpMax: d.hp, san: d.san, sanMax: d.san, bg: c.bg }; };

/** 开局。setup = { mood, know 知不知道在跑团, kp 'sys' | 联系人 id, lang { 谁: 语言 }, voice 语音怎么合成, scenario 内置本 id | 'random', ask 自己写的要求, me 你的卡, party 上桌角色的卡[] } */
export async function start(setup) {
  const sc = R.SCENARIOS.find(s => s.id === setup.scenario);
  const g = { id: uid('ig'), at: Date.now(), mood: setup.mood, know: !!setup.know, kp: setup.kp || 'sys', lang: setup.lang || {}, voice: setup.voice || 'tap', crit: state.apps.interlude.crit,
    act: 0, round: 0, roundIn: 0, log: [], req: { type: 'free' }, pc: fromCard(setup.me), party: setup.party.map(fromCard) };
  const out = await ask('intStart', {
    kp: kpText(g), know: knowText(g), mood: R.MOOD_TEXT[g.mood], story: storyText() || '（正文里还没发生什么）',
    pc: '你：' + cardText(setup.me), cast: setup.party.map(c => `${ownerName(c.owner)} 扮演 ` + cardText(c)).join('\n'),
    scenario: sc ? `《${sc.title}》\n${sc.blurb}\n各幕：${sc.acts.map((a, i) => `${i + 1}. ${a.title}：${a.goal}（${a.place}）→ ${a.exit}`).join('；')}\n真相：${sc.secret}\n好结局：${sc.endings.good}\n坏结局：${sc.endings.bad}\n（骨架照这个写，可以润色）` : `随机生成一个本${setup.ask ? `，要求：${setup.ask}` : ''}`,
    places: placesText(),
  }, 3000, g);
  if (!Array.isArray(out.acts) || !out.acts.length) throw new Error('AI 回的格式不对');
  g.title = String(out.title || (sc ? sc.title : '无题')).trim(); g.intro = String(out.intro || '').trim();
  g.sk = { acts: out.acts.slice(0, 5).map(a => ({ title: a.title || '', goal: a.goal || '', place: R.placeOf(a.place), exit: a.exit || '' })), secret: out.secret || '', endings: out.endings || {} };
  g.place = g.sk.acts[0].place; g.log.push({ r: 0, who: 'KP', act: g.intro });
  D.games.push(g); await save();
  return g;
}

// AI 偶尔把台词连引号塞进旁白：拆出来放回台词，喇叭才有得念（以前存下的句子显示时也拆）
export function splitSay(l) {
  if (l.who === 'KP') return;
  const re = /[“「]([^”」]+)[”」]/g, k = /[“「]/.test(l.say) ? 'say' : l.say ? '' : l.act ? 'act' : l.text ? 'text' : ''; if (!k) return;
  const q = [...l[k].matchAll(re)].map(m => m[1]); if (!q.length) return;
  const rest = l[k].replace(re, '').replace(/^[，。、：:\s]+/, '').replace(/[：:，\s]+$/, '').trim();
  l.say = q.join(' '); if (k === 'say') l.act = [l.act, rest].filter(Boolean).join(' '); else l[k] = rest;
}
export const who = (g, n) => (n === '你' || n === g.pc.name ? g.pc : g.party.find(m => m.name === n || nameOf(contact(m.id)) === n)) || null;
/** 一回合：input 是你做的事（已经带上骰子结果）。回来的 lines 记进 log，request 存到 g.req */
export async function play(g, input) {
  const A = g.sk.acts, i = g.act, last = i >= A.length - 1, over = g.roundIn >= CAP - 1;
  const out = await ask('intRound', {
    kp: kpText(g), know: knowText(g), mood: R.MOOD_TEXT[g.mood], title: g.title, secret: g.sk.secret, acts: A.map((a, k) => `${k + 1}. ${a.title}：${a.goal} → ${a.exit}`).join('\n'),
    actNo: i + 1, act: A[i].title, goal: A[i].goal, exit: A[i].exit, left: Math.max(0, CAP - g.roundIn),
    must: over ? (last ? '。这是最后一回合：必须在这回合收尾，给出结局（end）' : '。这是本幕最后一回合：必须在这回合达成出口，actDone 写 true') : '',
    pc: pcText(g), cast: castText(g), places: Object.keys(R.PLACES).join(' / '),
    log: g.log.slice(-16).map(l => `${l.who}：${lineText(l)}`).join('\n') || '（刚开始）', input,
  }, 2400, g);
  const str = v => String(v || '').trim();
  const lines = (out.lines || []).filter(l => l && (l.act || l.say || l.text)).map(l => ({ r: g.round + 1, who: str(l.who) || 'KP', act: str(l.act || (!l.say && l.text)), say: str(l.say), zh: str(l.zh), face: str(l.face), pose: str(l.pose), ...(l.ooc && g.know ? { ooc: true } : {}) }));
  lines.forEach(splitSay);
  if (!lines.length) throw new Error('AI 回的格式不对');
  g.round++; g.roundIn++; g.log.push({ r: g.round, who: myName(), text: input, me: true }, ...lines);
  if (out.place && out.place in R.PLACES) g.place = out.place;
  if (out.bgm) g.bgm = str(out.bgm); if (out.amb) g.amb = str(out.amb);
  for (const h of out.hurt || []) { const p = who(g, h.who); if (p && Number.isFinite(+h.hp)) p.hp = Math.max(0, Math.min(p.hpMax, p.hp + Math.round(+h.hp))); }
  for (const p of [g.pc, ...g.party]) if (p.mad && --p.mad.left <= 0) p.mad = null;
  if (out.actDone && !last) { g.act++; g.roundIn = 0; g.place = A[g.act].place; }
  g.req = out.request && out.request.type ? out.request : { type: 'free' };
  if (out.end && out.end.text) { g.done = { kind: out.end.kind === 'good' ? 'good' : 'bad', text: String(out.end.text), at: Date.now() }; g.req = { type: 'free' }; }
  await save();
  return lines;
}
/** 不玩了：标成放弃 */
export async function quit(g) { g.done = { kind: 'quit', text: '', at: Date.now() }; await save(); }

/** 检定的结果写成一句话给 KP（也给人看）；v 是盖在掷骰画面上的那两个字（大成功 / 困难成功 / 失败…） */
export function resolve(g, req, { skill } = {}) {
  const p = who(g, req.who) || g.pc, name = p === g.pc ? '你' : p.name, sk = skill || req.skill || '侦查';
  if (req.type === 'san') {
    const r = R.sanCheck(p.san, req.loss, g.crit); p.san = Math.max(0, p.san - r.lost);
    if (r.lost >= 5 && !p.mad) p.mad = R.madness();
    return { r, v: r.grade === '大成功' || r.grade === '大失败' ? r.grade : r.ok ? '成功' : '失败', text: `${name}的理智检定：掷出 ${r.v}（理智 ${r.need}），${r.ok ? '成功' : '失败'}，掉了 ${r.lost} 点${r.lost >= 5 ? `，临时疯狂：${p.mad.name}` : ''}${p.san <= 0 ? '，理智归零' : ''}`, lost: r.lost };
  }
  if (req.type === 'opposed') {
    const r = R.opposed(p.skills[sk] ?? R.SKILLS[sk] ?? 20, +req.vs || 50, g.crit);
    return { r: r.a, v: r.win ? '赢了' : '输了', text: `${name}的${sk}对抗：掷出 ${r.a.v}（${r.a.grade}），对方掷出 ${r.b.v}（${r.b.grade}），${r.win ? '赢了' : '输了'}` };
  }
  const val = p.skills[sk] ?? R.SKILLS[sk] ?? 20, r = R.check(val, req.level, g.crit);
  return { r, v: r.grade, text: `${name}的${sk}检定（${req.level || '普通'}）：掷出 ${r.v}，技能 ${val}，${r.grade}` };
}
