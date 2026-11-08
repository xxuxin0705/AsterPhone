// 幕间 · 一局的数据和流程：车卡一次 API（几个人一起），开局一次 API 生成骨架，之后每回合一次；骰子由手机掷（rules.js），AI 只收结果。
// 整局不进正文、不进记忆。局存在 kv 的 int:窗口 里；正在等 AI 的那一步放在模块里，退出页面再进来还是「取消」。
import { state, win, contact, kvGet, kvSet, chatForContact } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName, myPersona } from '../../core/promptstore.js';
import { storyText, worldText } from '../../core/context.js';
import { memoryFor } from '../../core/memory.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { uid } from '../../core/util.js';
import * as R from './rules.js';
import { connFor } from '../../core/voice.js';
import { kindOf, hintFor, plain } from '../../core/act.js';
import { langName } from '../../core/translate.js';

export const CAP = 8;
const GRADES = ['大成功', '极难成功', '困难成功', '普通成功', '失败', '大失败'];   // 每幕最多几回合，到了 KP 必须推到出口
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
// 随身物品 { name, dmg, skill }：武器才有伤害和用的技能
export const itemText = x => x.name + (x.dmg ? `（伤害 ${x.dmg}，用${x.skill || '斗殴'}）` : '');
const bag = p => (p.items || []).length ? `；随身：${p.items.map(itemText).join('、')}` : '；身上没带东西';
export const pcText = g => `${g.pc.name}（${g.pc.job}）：血 ${g.pc.hp}/${g.pc.hpMax}，理智 ${g.pc.san}/${g.pc.sanMax}${g.pc.mad ? `，临时疯狂·${g.pc.mad.name}（还剩 ${g.pc.mad.left} 回合）` : ''}；${attrsText(g.pc.attrs)}；技能：${topSkills(g.pc.skills)}${bag(g.pc)}`;
export const isZh = l => !l || /^zh/.test(l);
/** 这个人说什么语言：开局设置里改过的 → 聊天设置里让 TA 说的 → 中文 */
export const langOf = id => { if (id === 'me' || id === 'sys') return 'zh-CN'; const cfg = (chatForContact(id, false) || { cfg: {} }).cfg; return (cfg.sendTr && cfg.theirLang) || 'zh-CN'; };
// 台词开头怎么标语气：照这个人现在用的语音接口（和电台、正文朗读一样的那套标签）
const toneOf = id => hintFor(kindOf(connFor(id))).replace(/每段/g, '台词').replace(/>> 开头的翻译行不写标签。/, 'zh 翻译不写标签。');
// 旧存档没有 lang（开局时还没有「说什么语言」）：按开局时会给的默认语言
const speakLine = (g, id) => { const l = g.lang ? g.lang[id] : langOf(id); return `说话用${langName(isZh(l) ? 'zh-CN' : l)}；台词语气：${toneOf(id)}`; };
export const castText = g => g.party.map(m => `${m.name}（${m.job}）：血 ${m.hp}/${m.hpMax}，理智 ${m.san}/${m.sanMax}${m.mad ? `，临时疯狂·${m.mad.name}` : ''}；技能：${topSkills(m.skills)}${bag(m)}；人设：${(personaOf(contact(m.id)) || '').slice(0, 300) || '（没有更多资料）'}；${speakLine(g, m.id)}`).join('\n') || '（没有别人，只有 KP 和你）';
const kpText = g => { const c = g.kp !== 'sys' && contact(g.kp);
  return c ? `你是 ${nameOf(c)}，这一局由你来当《克苏鲁的呼唤》的守秘人（KP）：用你自己的性格和口吻主持（叙述还是用中文旁白），你知道真相，但不当玩家。你的人设：${(personaOf(c) || '').slice(0, 400) || '（没有更多资料）'}；你自己说话时${speakLine(g, c.id)}\n${g.know ? '场外有人跟你搭话、开玩笑、套近乎时，照你的性格接：可以顺着说两句，也可以端起 KP 的架子拒绝（比如「我是 KP，现在别跟我套近乎」），再把大家拉回戏里。\n' : ''}`
    : `你是这局《克苏鲁的呼唤》的守秘人（KP），中立、不下场，KP 说话时${speakLine(g, 'sys')}\n`; };
const knowText = g => g.know
  ? '大家都知道这是在跑团：角色们是坐在桌边、扮演调查员的玩家。可以偶尔（不是每回合）插一两句场外话（ooc: true）：吐槽流程、开玩笑、闲聊；KP 也可以出来维持秩序。但戏里要守规矩：调查员之间还没在戏里认识、没交换过情报时，戏里就不能知道对方那边发生的事，要在戏里走一遍认识、交换情报的过程（场外可以吐槽「就当我们叽里呱啦交换完了」）。'
  : '所有人都当真，这就是他们的经历，不出戏，不要场外话。';
/** 一句台词给人看 / 给 KP 看的样子 */
export const lineText = l => l.text || `${l.ooc ? '（场外）' : ''}${l.act || ''}${l.say ? `「${plain(l.say)}」` : ''}`;

/* ---------- 调查员卡：跟着人存（一个人可以有好几张），下次上桌默认用上次那张 ----------
   卡 { id, owner: 'me' | 联系人 id, name, age, sex, job, home, bg: { who, rel, past, goal, secret }, assets, items, attrs, skills, at } */
export const cardsOf = owner => (D.cards || []).filter(c => c.owner === owner);
export const lastCard = owner => cardsOf(owner).find(c => c.id === (D.last || {})[owner]) || cardsOf(owner).slice(-1)[0] || null;
export function useCard(c) { (D.last || (D.last = {}))[c.owner] = c.id; return save(); }
export async function dropCard(c) { D.cards = D.cards.filter(x => x !== c); if ((D.last || {})[c.owner] === c.id) delete D.last[c.owner]; await save(); }
const ownerName = o => o === 'me' ? myName() : nameOf(contact(o));
const ownerPersona = o => o === 'me' ? myPersona() : personaOf(contact(o));
/** 一次给好几个人车卡（owners：'me' / 联系人 id）。属性由手机先掷好，AI 照正文和人设写身份、背景、技能 */
// 世界书、念念铃（没有就空）：人设是一开始写的，年级、关系这些要照后来的（作者的卡曾被车成「15 岁一年级」，正文里早就二年级了）
const memoryText = async (ids, story) => [await worldText(story).catch(() => ''), await memoryFor(ids.map(contact).filter(Boolean), story).catch(() => '')].filter(Boolean).join('\n\n');
// all：同桌的所有人（重车时只车其中几个，关系也要写到没重车的人）
export async function makeCards(owners, all = owners) {
  const rolled = owners.map(o => ({ o, a: R.rollAttrs() })), story = storyText(), memory = await memoryText(all, story);
  const others = all.filter(o => !owners.includes(o)).map(o => { const c = lastCard(o); return ownerName(o) + (c ? `（这局扮演 ${c.name}，${c.job}）` : ''); });
  const out = await ask('intCards', {
    story: story || '（正文里还没发生什么）', memory: memory && `\n【记着的事】（世界书、念念铃）\n${memory}\n`, jobs: R.JOBS.map(j => j[0]).join('、'),
    skills: Object.entries(R.SKILLS).map(([k, v]) => `${k} ${v}`).join('、') + '、闪避（敏捷÷2）、母语（教育）',
    roster: (others.length ? `同桌的还有：${others.join('、')}（关系也要写到他们）\n` : '') + rolled.map(({ o, a }) => `${ownerName(o)}${o === 'me' ? '（玩家本人）' : ''}：${attrsText(a)}；技能点上限 ${R.points(a)}；人设：${(ownerPersona(o) || '').slice(0, 500) || '（没有更多资料）'}`).join('\n'),
  }, 1200 + 700 * owners.length);
  const list = Array.isArray(out.cards) ? out.cards : [];
  if (!list.length) throw new Error('AI 回的格式不对');
  const made = rolled.map(({ o, a }, i) => {
    const x = list.find(c => c.who === ownerName(o)) || list[i] || {};
    return { id: uid('ic'), owner: o, at: Date.now(), name: String(x.name || ownerName(o)), age: +x.age || 25, sex: String(x.sex || ''), job: String(x.job || ''), home: String(x.home || ''),
      bg: { who: '', rel: '', past: '', goal: '', secret: '', ...(x.bg || {}) }, assets: String(x.assets || ''), items: (Array.isArray(x.items) ? x.items : []).map(toItem).filter(Boolean), attrs: a, skills: R.fixSkills(a, x.skills) };
  });
  (D.cards || (D.cards = [])).push(...made); made.forEach(c => { (D.last || (D.last = {}))[c.owner] = c.id; });
  await save();
  return made;
}
export const toItem = x => typeof x === 'string' ? (x.trim() && { name: x.trim() }) : x && x.name ? { name: String(x.name), ...(x.dmg ? { dmg: String(x.dmg), skill: String(x.skill || '斗殴') } : {}) } : null;
const cardText = c => `${c.name}（${c.age} 岁，${c.sex}，${c.job}，住在${c.home || '—'}）：${attrsText(c.attrs)}；技能：${topSkills(c.skills)}；背景：${c.bg.who} ${c.bg.past} 和大家的关系：${c.bg.rel || '—'} 目标：${c.bg.goal} 秘密：${c.bg.secret}；资产：${c.assets || '—'}${bag(c)}`;
const fromCard = c => { const d = R.derived(c.attrs); return { id: c.owner, card: c.id, name: c.name, job: c.job, attrs: c.attrs, skills: { ...c.skills }, hp: d.hp, hpMax: d.hp, san: d.san, sanMax: d.san, bg: c.bg, items: (c.items || []).map(x => ({ ...x })) }; };

/** 开局。setup = { mood, know 知不知道在跑团, kp 'sys' | 联系人 id, lang { 谁: 语言 }, voice 语音怎么合成, scenario 内置本 id | 'random', ask 自己写的要求, me 你的卡, party 上桌角色的卡[] } */
export async function start(setup) {
  const sc = R.SCENARIOS.find(s => s.id === setup.scenario);
  const g = { id: uid('ig'), at: Date.now(), mood: setup.mood, know: !!setup.know, kp: setup.kp || 'sys', lang: setup.lang || {}, voice: setup.voice || 'tap', crit: state.apps.interlude.crit,
    act: 0, round: 0, roundIn: 0, log: [], req: { type: 'free' }, pc: fromCard(setup.me), party: setup.party.map(fromCard) };
  const story = storyText(), mem = await memoryText([g.kp, ...setup.party.map(c => c.owner)], story);
  const out = await ask('intStart', {
    kp: kpText(g), know: knowText(g), mood: R.MOOD_TEXT[g.mood], story: story || '（正文里还没发生什么）', memory: mem && `\n【记着的事】（世界书、念念铃）\n${mem}\n`,
    pc: '你：' + cardText(setup.me), cast: setup.party.map(c => `${ownerName(c.owner)} 扮演 ` + cardText(c)).join('\n'),
    scenario: sc ? `《${sc.title}》\n${sc.blurb}\n各幕：${sc.acts.map((a, i) => `${i + 1}. ${a.title}：${a.goal}（${a.place}）→ ${a.exit}`).join('；')}\n真相：${sc.secret}\n好结局：${sc.endings.good}\n坏结局：${sc.endings.bad}\n（骨架照这个写，可以润色）` : `随机生成一个本${setup.ask ? `，要求：${setup.ask}` : ''}`,
    places: placesText(),
  }, 5000, g);
  if (!Array.isArray(out.acts) || !out.acts.length) throw new Error('AI 回的格式不对');
  g.title = String(out.title || (sc ? sc.title : '无题')).trim(); g.intro = String(out.intro || '').trim();
  g.sk = { acts: out.acts.slice(0, 5).map(a => ({ title: a.title || '', goal: a.goal || '', place: R.placeOf(a.place), exit: a.exit || '', checks: Array.isArray(a.checks) ? a.checks.slice(0, 3) : [], foes: Array.isArray(a.foes) ? a.foes.slice(0, 6) : [] })), secret: out.secret || '', endings: out.endings || {} };
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
    checks: (A[i].checks || []).map(c => `- ${c.when}（${c.skill}）：${GRADES.map(k => `${k}：${c[k] || '—'}`).join('；')}`).join('\n') || '（这幕没有，照上面的分寸）',
    foes: (A[i].foes || []).map(f => `- ${JSON.stringify(f)}`).join('\n') || '（这幕没定，真要打起来照上面的分寸现定）',
    fight: g.fight ? `\n【正在战斗】第 ${g.fight.round} 轮打完了；敌人：${g.fight.foes.map(f => `${f.name} 血 ${f.hp}/${f.hpMax}`).join('、')}。战斗由手机一轮轮替所有人掷，你只讲这一轮发生了什么（照收到的结果，不要改伤害和血），下一轮照旧提 fight；敌人投降、逃走或者剧情要停下时写 fightEnd: true。\n` : '',
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
  if (g.req.type === 'fight') { joinFight(g, g.req.foes); g.req = { type: 'free' }; }
  if (out.fightEnd || g.fight && !g.fight.foes.some(f => f.hp > 0)) g.fight = null;
  for (const x of Array.isArray(out.items) ? out.items : []) { const p = who(g, x.who) || g.pc, L = p.items || (p.items = []);
    if (x.drop) { const k = L.findIndex(y => y.name.includes(String(x.drop)) || String(x.drop).includes(y.name)); if (k >= 0) L.splice(k, 1); }
    const n = toItem(x.add); if (n) L.push(n); }
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
  const val = p.skills[sk] ?? R.SKILLS[sk] ?? 20, b = Math.max(-2, Math.min(2, Math.round(+req.bonus) || 0)), r = R.check(val, req.level, g.crit, b);
  return { r, v: r.grade, text: `${name}的${sk}检定（${req.level || '普通'}${b ? `，${b > 0 ? '奖励' : '惩罚'}骰 ${Math.abs(b)} 个` : ''}）：掷出 ${r.v}，技能 ${val}，${r.grade}` };
}

/* ---------- 战斗：一轮一轮，手机按敏捷先后替每个人掷（你自己选这一轮做什么），结果交给 KP 讲 ----------
   敌人 { name, wpn, hp, hpMax, atk 攻击技能, dmg 伤害（已经算上它的力气）, dodge 闪避, dex 敏捷 }：开局时按人数和数值定好，KP 提出战斗时带上 */
const FIST = { name: '徒手', dmg: '1D3', skill: '斗殴' };
export const weapons = p => [FIST, ...(p.items || []).filter(x => x.dmg)];
export function joinFight(g, foes) {
  const F = g.fight || (g.fight = { round: 0, foes: [] });
  for (const f of Array.isArray(foes) ? foes : []) {
    if (!f || !f.name || F.foes.some(x => x.name === f.name)) continue;
    const hp = Math.max(1, Math.round(+f.hp) || 10);
    F.foes.push({ name: String(f.name), wpn: String(f.wpn || ''), hp, hpMax: hp, atk: +f.atk || 40, dmg: String(f.dmg || '1D6'), dodge: +f.dodge || 20, dex: +f.dex || 50 });
  }
}
/** 这一轮：act = { kind: 'atk' | 'dodge' | 'flee', foe 打谁, wpn 用什么 }。返回 { text 给 KP 的结果, mine 你自己那一下的骰子, cap } */
export function fightRound(g, act) {
  const F = g.fight, me = g.pc, up = x => x.hp > 0, out = [], nm = p => p === me ? '你' : p.name;
  const isFoe = p => F.foes.includes(p), dodgeOf = p => isFoe(p) ? p.dodge : p.skills.闪避 ?? 20, dexOf = p => isFoe(p) ? p.dex : p.attrs.DEX;
  const skillOf = (p, w) => p.skills[w.skill] ?? R.SKILLS[w.skill] ?? 25;
  const pick = l => l[Math.floor(Math.random() * l.length)];
  let mine = null, cap = '', fled = false;
  F.round++;
  // 一下攻击：攻方检定对守方闪避，闪避平手算躲开；打中了掷伤害（近战加力气），极难成功打满
  const hit = (a, d, skill, w) => {
    const r = R.check(skill, '普通', g.crit), dg = R.check(dodgeOf(d), '普通', g.crit, d === me && act.kind === 'dodge' ? 1 : 0);
    let t = `${nm(a)}${w.name ? '用' + w.name : ''}攻击${nm(d)}：掷出 ${r.v}（${r.grade}）`;
    if (r.ok && R.rank(r) > R.rank(dg)) {
      const n = Math.max(0, R.dice(w.dmg, R.rank(r) >= 3) + (!isFoe(a) && !/枪/.test(w.skill) ? R.db(a.attrs) : 0));
      d.hp = Math.max(0, d.hp - n);
      t += `，${nm(d)}闪避 ${dg.v}（${dg.grade}），打中了，伤害 ${n}（剩 ${d.hp}/${d.hpMax}）${!d.hp ? '，倒下了' : n * 2 >= d.hpMax ? '，重伤' : ''}`;
    } else t += r.ok ? `，被${nm(d)}闪开了（闪避 ${dg.v}，${dg.grade}）` : '，没打中';
    out.push(t); return r;
  };
  for (const p of [me, ...g.party, ...F.foes].filter(up).sort((x, y) => dexOf(y) - dexOf(x))) {
    if (!up(p)) continue;
    const foes = F.foes.filter(up), ours = [me, ...g.party].filter(x => up(x) && !(x === me && fled));
    if (isFoe(p)) { if (ours.length) hit(p, pick(ours), p.atk, { name: p.wpn, dmg: p.dmg }); continue; }
    if (!foes.length) break;
    if (p !== me) { const w = weapons(p).reduce((a, b) => skillOf(p, b) >= skillOf(p, a) ? b : a); hit(p, pick(foes), skillOf(p, w), w); continue; }
    if (act.kind === 'dodge') { out.push('你这一轮专心闪避'); continue; }
    if (act.kind === 'flee') { mine = R.check(me.attrs.DEX, '普通', g.crit); fled = mine.ok; cap = '逃跑（敏捷）'; out.push(`你想逃：掷出 ${mine.v}（${mine.grade}），${fled ? '逃出去了' : '没逃掉'}`); continue; }
    const w = weapons(me).find(x => x.name === act.wpn) || FIST, d = foes.find(f => f.name === act.foe) || foes[0];
    cap = `${w.name}攻击${d.name}`; mine = hit(me, d, skillOf(me, w), w);
  }
  const over = !F.foes.some(up) ? '敌人都倒下了，战斗结束' : fled ? '你逃出了战斗' : !up(me) ? '你倒下了' : '';
  if (over) g.fight = null;
  return { text: `【战斗第 ${F.round} 轮】${out.join('；')}。${over || '还在打'}`, mine, cap };
}
