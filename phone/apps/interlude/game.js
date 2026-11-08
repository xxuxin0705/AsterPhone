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
export async function load() {
  if (D && Dkey === win.key) return D; Dkey = win.key; D = (await kvGet('int:' + win.key).catch(() => null)) || { games: [] };
  // 旧卡：技能改过名、补上后来加的技能、超过 90 的压回 90；没打完的局里的技能也改名
  for (const c of D.cards || []) c.skills = R.fixSkills(c.attrs, R.renamed(c.skills));
  for (const g of D.games.filter(g => !g.done)) for (const p of [g.pc, ...g.party]) p.skills = R.renamed(p.skills);
  return D; }
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
export const pcText = g => `${g.pc.name}（${g.pc.job}）：血 ${g.pc.hp}/${g.pc.hpMax}，理智 ${g.pc.san}/${g.pc.sanMax}${g.pc.mad ? `，临时疯狂·${g.pc.mad.name}（还剩 ${g.pc.mad.left} 回合）` : ''}；${attrsText(g.pc.attrs)}；技能：${topSkills(g.pc.skills)}${bag(g.pc)}${powers(g.pc)}`;
export const isZh = l => !l || /^zh/.test(l);
/** 这个人说什么语言：开局设置里改过的 → 聊天设置里让 TA 说的 → 中文 */
export const langOf = id => { if (id === 'me' || id === 'sys') return 'zh-CN'; const cfg = (chatForContact(id, false) || { cfg: {} }).cfg; return (cfg.sendTr && cfg.theirLang) || 'zh-CN'; };
// 台词开头怎么标语气：照这个人现在用的语音接口（和电台、正文朗读一样的那套标签）
const toneOf = id => hintFor(kindOf(connFor(id))).replace(/每段/g, '台词').replace(/>> 开头的翻译行不写标签。/, 'zh 翻译不写标签。');
// 旧存档没有 lang（开局时还没有「说什么语言」）：按开局时会给的默认语言
const speakLine = (g, id) => { const l = g.lang ? g.lang[id] : langOf(id); return `说话用${langName(isZh(l) ? 'zh-CN' : l)}；台词语气：${toneOf(id)}`; };
export const castText = g => g.party.map(m => `${m.name}（${m.job}）：血 ${m.hp}/${m.hpMax}，理智 ${m.san}/${m.sanMax}${m.mad ? `，临时疯狂·${m.mad.name}` : ''}；技能：${topSkills(m.skills)}${bag(m)}${powers(m)}；人设：${(personaOf(contact(m.id)) || '').slice(0, 300) || '（没有更多资料）'}；${speakLine(g, m.id)}`).join('\n') || '（没有别人，只有 KP 和你）';
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
/** 一次给好几个人车卡（owners：'me' / 联系人 id）。AI 照正文和人设定档位、分属性、写身份背景技能 */
// 世界书、念念铃（没有就空）：人设是一开始写的，年级、关系这些要照后来的（作者的卡曾被车成「15 岁一年级」，正文里早就二年级了）
const memoryText = async (ids, story) => [await worldText(story).catch(() => ''), await memoryFor(ids.map(contact).filter(Boolean), story).catch(() => '')].filter(Boolean).join('\n\n');
// 车卡方式（知道在跑团时才能选）：照自己 / 捏 OC / 随机（属性照规则书掷，身份随机）
export const MODES = [['self', '照自己'], ['oc', '捏 OC'], ['random', '随机']];
const MODE_TEXT = {
  self: '',
  oc: '【车卡方式：捏 OC】（这条比下面的要求优先）大家知道在跑团，每个人捏一张自己的原创角色，不是本人：名字、年龄、身份、背景都是新的，照本人的喜好和性格捏（喜欢的类型、反差萌都行）；关系写成戏里的关系（可以互不认识），不用照正文。',
  random: '【车卡方式：随机】（这条比下面的要求优先）属性手机已经照规则书掷好（写在每个人后面），照抄，不用分点，tier 写「普通人」；职业、身份、背景随机定一个和本人无关的新角色，名字也是新的，要和掷出来的属性配得上（力量低就别当打手）；关系写成戏里的关系（可以互不认识）。',
};
const rollFor = (owners, mode) => Object.fromEntries(owners.map(o => [o, mode === 'random' ? R.rollAttrs() : null]));
const rosterLine = (o, rolled) => `${ownerName(o)}${o === 'me' ? '（玩家本人）' : ''}：人设：${(ownerPersona(o) || '').slice(0, 500) || '（没有更多资料）'}${rolled ? `；掷好的属性：${attrsText(rolled)}` : ''}`;
const skillsText = () => Object.entries(R.SKILLS).map(([k, v]) => `${k} ${v}`).join('、') + '、闪避（敏捷÷2）、母语（教育）';
// AI 写的一张卡 → 存的卡；rolled：随机车卡时掷好的属性（不算档位）
function toCard(o, x, rolled) {
  const tier = rolled ? undefined : R.TIERS.some(t => t[0] === x.tier) ? x.tier : R.TIERS[0][0], a = rolled || R.fixAttrs(x.attrs, R.budgetOf(tier));
  return { id: uid('ic'), owner: o, at: Date.now(), name: String(x.name || ownerName(o)), age: +x.age || 25, sex: String(x.sex || ''), job: String(x.job || ''), home: String(x.home || ''),
    bg: { who: '', rel: '', past: '', goal: '', secret: '', ...(x.bg || {}) }, assets: String(x.assets || ''), items: (Array.isArray(x.items) ? x.items : []).map(toItem).filter(Boolean), tier, attrs: a, skills: R.fixSkills(a, x.skills),
    abilities: (Array.isArray(x.abilities) ? x.abilities : []).map(toPower).filter(Boolean).slice(0, 3) };
}
async function keep(made) { (D.cards || (D.cards = [])).push(...made); made.forEach(c => { (D.last || (D.last = {}))[c.owner] = c.id; }); await save(); return made; }
// all：同桌的所有人（重车时只车其中几个，关系也要写到没重车的人）
// rules：开着车卡会时，会上定的规矩（AI 帮你车的卡也要符合）
export async function makeCards(owners, all = owners, mode = 'self', rules = '') {
  const story = storyText(), memory = await memoryText(all, story), rolled = rollFor(owners, mode);
  const others = all.filter(o => !owners.includes(o)).map(o => { const c = lastCard(o); return ownerName(o) + (c ? `（这局扮演 ${c.name}，${c.job}）` : ''); });
  const out = await ask('intCards', {
    story: story || '（正文里还没发生什么）', memory: memory && `\n【记着的事】（世界书、念念铃）\n${memory}\n`, jobs: R.JOBS.map(j => j[0]).join('、'), skills: skillsText(), mode: (MODE_TEXT[mode] || '') + (rules && `\n【车卡会上定的规矩，要符合】${rules}`),
    roster: (others.length ? `同桌的还有：${others.join('、')}（关系也要写到他们）\n` : '') + owners.map(o => rosterLine(o, rolled[o])).join('\n'),
  }, 1200 + 700 * owners.length);
  const list = Array.isArray(out.cards) ? out.cards : [];
  if (!list.length) throw new Error('AI 回的格式不对');
  return keep(owners.map((o, i) => toCard(o, list.find(c => c.who === ownerName(o)) || list[i] || {}, rolled[o])));
}

/** 车卡会（知道在跑团时可选）：一次 API 写完整场——KP 透露一点、其他人交卡被打回再改、定下规矩、其他人过审的卡、
 *  你交卡时过审 / 被打回说的话、亮卡时的评语。你的卡你自己交，手机照规矩审（checkCard）。
 *  开会前定好大家统一用新卡、旧卡还是随机（每人各抛一次；没有旧卡的只能车新卡）。用旧卡的不重车，会上为了合规矩改的随身物品、特殊能力只管这一局（adjust）。
 *  存在 D.meet；上桌的人、本、气氛、车卡方式、新旧卡变了就作废，开局后用掉。s = { kp, party, scenario, ask, mood, mode, use, lang } */
export const USES = [['new', '新卡'], ['old', '旧卡'], ['mix', '随机']];
const meetKey = s => [s.kp, s.scenario, s.ask, s.mood, s.mode, s.use, ...s.party].join('|');
export const meeting = s => D.meet && D.meet.key === meetKey(s) ? D.meet : null;
export async function meet(s) {
  const fresh = Object.fromEntries(['me', ...s.party].map(o => [o, !lastCard(o) || s.use === 'new' || (s.use === 'mix' && Math.random() < .5)])), news = s.party.filter(o => fresh[o]);
  const g = { kp: s.kp, know: true, lang: s.lang }, story = storyText(), mem = await memoryText([s.kp, ...s.party], story), rolled = rollFor(news, s.mode);
  const old = o => fresh[o] ? '' : `；用旧卡：${cardText(lastCard(o))}`;
  const out = await ask('intMeet', {
    kp: kpText(g), mood: R.MOOD_TEXT[s.mood], story: story || '（正文里还没发生什么）', memory: mem && `\n【记着的事】（世界书、念念铃）\n${mem}\n`, scenario: scText(s),
    roster: [`${myName()}（玩家本人）：人设：${(myPersona() || '').slice(0, 300) || '（没有更多资料）'}${fresh.me ? '；这局车新卡' : old('me')}`, ...s.party.map(o => rosterLine(o, rolled[o]) + old(o) + `；${speakLine(g, o)}`)].join('\n'),
    mode: MODE_TEXT[s.mode] || '', jobs: R.JOBS.map(j => j[0]).join('、'), skills: skillsText(),
  }, 3000 + 900 * s.party.length);
  const r = out.rules, all = Array.isArray(out.cards) ? out.cards : [], list = all.filter(c => !c.old);
  if (!Array.isArray(out.lines) || !r || list.length < news.length) throw new Error('AI 回的格式不对');
  const num = v => v == null || v === '' || isNaN(+v) ? null : Math.max(0, Math.round(+v)), talk = L => (Array.isArray(L) ? L : []).filter(l => l && (l.say || l.act));
  const cards = await keep(news.map((o, i) => toCard(o, list.find(c => c.who === ownerName(o)) || list[i] || {}, rolled[o]))), adjust = {};
  for (const o of s.party.filter(o => !fresh[o])) { const x = all.find(c => c.old && c.who === ownerName(o)); if (!x) continue;
    adjust[o] = { ...(Array.isArray(x.items) ? { items: x.items.map(toItem).filter(Boolean) } : {}), ...(Array.isArray(x.abilities) ? { abilities: x.abilities.map(toPower).filter(Boolean) } : {}) }; }
  D.meet = { key: meetKey(s), at: Date.now(), mode: s.mode, hint: String(out.hint || ''), lines: talk(out.lines), pass: talk(out.pass), fail: talk(out.fail), reviews: out.reviews || {},
    cards: Object.fromEntries(cards.map(c => [c.owner, c.id])), fresh: fresh.me, adjust,
    rules: { tiers: r.tiers || {}, weapons: num(r.weapons), guns: r.guns !== false, abilities: num(r.abilities), banned: (Array.isArray(r.banned) ? r.banned : []).map(String).filter(Boolean), text: String(r.text || '') } };
  await save(); return D.meet;
}
/** 照车卡会的规矩审你的卡：回不合规矩的地方（空的就是过了）。活着打完几局长的属性（grown）、技能（skillUp）是挣来的，不算超 */
export function checkCard(c, m) {
  const r = m.rules, bad = [], tier = R.TIERS.some(t => t[0] === r.tiers[myName()]) ? r.tiers[myName()] : c.tier || R.TIERS[0][0];
  const all = R.budgetOf(tier) + (c.grown || 0), sk = R.points(c.attrs) + (c.skillUp || 0);
  if (m.mode !== 'random' && R.attrSum(c.attrs) > all) bad.push(`属性点 ${R.attrSum(c.attrs)}，${tier}${c.grown ? `加成长 ${c.grown} 点` : ''}最多 ${all}`);
  if (m.fresh && c.at < m.at) bad.push('这局要用新卡');
  const w = (c.items || []).filter(x => x.dmg), n = (c.abilities || []).length, things = [...(c.items || []), ...(c.abilities || [])].map(x => x.name).join('、') + (c.assets || '');
  if (r.weapons != null && w.length > r.weapons) bad.push(`武器带了 ${w.length} 件，最多 ${r.weapons} 件`);
  if (!r.guns && w.some(isGun)) bad.push(`不能带枪：${w.filter(isGun).map(x => x.name).join('、')}`);
  if (r.abilities != null && n > r.abilities) bad.push(`特殊能力 ${n} 个，最多 ${r.abilities} 个`);
  const ban = r.banned.filter(b => things.includes(b)); if (ban.length) bad.push(`不准带：${ban.join('、')}`);
  if (R.spent(c.attrs, c.skills) > sk) bad.push(`技能点 ${R.spent(c.attrs, c.skills)}，最多 ${sk}`);
  return bad;
}
export const meetRules = m => { const t = m.mode !== 'random' && R.TIERS.find(x => x[0] === m.rules.tiers[myName()]);
  return [t && `${myName()}是${t[0]}（${t[1]} 点）`, m.rules.weapons != null && `武器最多 ${m.rules.weapons} 件`, !m.rules.guns && '不能带枪',
  m.rules.abilities != null && `特殊能力最多 ${m.rules.abilities} 个`, m.rules.banned.length && `不准带：${m.rules.banned.join('、')}`].filter(Boolean).join(' · '); };
// 特殊能力 { name, kind, dmg, cost 耗几点魔法, desc }
const toPower = x => x && x.name ? { name: String(x.name), kind: x.kind in R.POWERS ? x.kind : 'other', dmg: String(x.dmg || ''), cost: Math.max(0, Math.min(20, Math.round(+x.cost) || 0)), desc: String(x.desc || '') } : null;
export const powerText = x => `${x.name}（${R.POWERS[x.kind]}${x.dmg ? ' ' + x.dmg : ''}${x.cost ? `，耗 ${x.cost} 魔法` : ''}${x.desc ? '：' + x.desc : ''}）`;
const powers = p => (p.abilities || []).length ? `；特殊能力：${p.abilities.map(powerText).join('、')}；魔法 ${p.mp ?? R.derived(p.attrs).mp}${p.mpMax ? '/' + p.mpMax : ''}` : '';
export const toItem = x => typeof x === 'string' ? (x.trim() && { name: x.trim() }) : x && x.name ? { name: String(x.name), ...(x.dmg ? { dmg: String(x.dmg), skill: String(x.skill || '斗殴') } : {}) } : null;
const cardText = c => `${c.name}（${c.age} 岁，${c.sex}，${c.job}，住在${c.home || '—'}）：${attrsText(c.attrs)}；技能：${topSkills(c.skills)}；背景：${c.bg.who} ${c.bg.past} 和大家的关系：${c.bg.rel || '—'} 目标：${c.bg.goal} 秘密：${c.bg.secret}；资产：${c.assets || '—'}${bag(c)}${powers(c)}`;
const fromCard = c => { const d = R.derived(c.attrs); return { id: c.owner, card: c.id, name: c.name, job: c.job, attrs: c.attrs, skills: { ...c.skills }, hp: d.hp, hpMax: d.hp, san: d.san, sanMax: d.san, bg: c.bg, items: (c.items || []).map(x => ({ ...x })), abilities: (c.abilities || []).map(x => ({ ...x })), mp: d.mp, mpMax: d.mp }; };

const scText = s => { const sc = R.SCENARIOS.find(x => x.id === s.scenario);
  return sc ? `《${sc.title}》\n${sc.blurb}\n各幕：${sc.acts.map((a, i) => `${i + 1}. ${a.title}：${a.goal}（${a.place}）→ ${a.exit}`).join('；')}\n真相：${sc.secret}\n好结局：${sc.endings.good}\n坏结局：${sc.endings.bad}\n（骨架照这个写，可以润色）` : `随机生成一个本${s.ask ? `，要求：${s.ask}` : ''}`; };
/** 开局。setup = { mood, know 知不知道在跑团, kp 'sys' | 联系人 id, lang { 谁: 语言 }, voice 语音怎么合成, scenario 内置本 id | 'random', ask 自己写的要求, me 你的卡, party 上桌角色的卡[], meet 开过的车卡会 } */
export async function start(setup) {
  const sc = R.SCENARIOS.find(s => s.id === setup.scenario), party = setup.party.map(c => ({ ...c, ...((setup.meet || {}).adjust || {})[c.owner] }));   // 车卡会上为了合规矩改的，只管这一局
  const g = { id: uid('ig'), at: Date.now(), mood: setup.mood, know: !!setup.know, kp: setup.kp || 'sys', lang: setup.lang || {}, voice: setup.voice || 'tap', crit: state.apps.interlude.crit,
    act: 0, round: 0, roundIn: 0, log: [], req: { type: 'free' }, pc: fromCard(setup.me), party: party.map(fromCard) };
  const story = storyText(), mem = await memoryText([g.kp, ...party.map(c => c.owner)], story);
  const out = await ask('intStart', {
    kp: kpText(g), know: knowText(g), mood: R.MOOD_TEXT[g.mood], story: story || '（正文里还没发生什么）', memory: mem && `\n【记着的事】（世界书、念念铃）\n${mem}\n`,
    pc: '你：' + cardText(setup.me), cast: party.map(c => `${ownerName(c.owner)} 扮演 ` + cardText(c)).join('\n'),
    scenario: scText(setup), places: placesText(),
    meet: setup.meet ? `【车卡会】开局前大家开过车卡会，KP 已经透露过：${setup.meet.hint}\n定下的车卡规矩：${setup.meet.rules.text}\n（这局要和透露过的对得上）\n` : '',
  }, 5000, g);
  if (!Array.isArray(out.acts) || !out.acts.length) throw new Error('AI 回的格式不对');
  g.title = String(out.title || (sc ? sc.title : '无题')).trim(); g.intro = String(out.intro || '').trim();
  g.sk = { acts: out.acts.slice(0, 5).map(a => ({ title: a.title || '', goal: a.goal || '', place: R.placeOf(a.place), exit: a.exit || '', checks: Array.isArray(a.checks) ? a.checks.slice(0, 3) : [], foes: Array.isArray(a.foes) ? a.foes.slice(0, 6) : [] })), secret: out.secret || '', endings: out.endings || {} };
  g.place = g.sk.acts[0].place; g.log.push({ r: 0, who: 'KP', act: g.intro });
  D.games.push(g); if (setup.meet) delete D.meet; await save();
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
    fight: g.fight ? `\n【正在战斗】第 ${g.fight.round} 轮打完了；敌人：${g.fight.foes.map(f => `${f.name} 血 ${f.hp}/${f.hpMax}`).join('、')}。战斗由手机一轮轮替所有人掷，玩家中途说话时才把这几轮的结果交给你：照结果把这几轮讲成一段（不要改伤害和血），再接玩家说的；战斗还会接着由手机打，不用再提 fight；敌人投降、逃走或者剧情要停下时写 fightEnd: true。\n` : '',
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
  if (out.end && out.end.text) { g.done = { kind: out.end.kind === 'good' ? 'good' : 'bad', text: String(out.end.text), grow: out.end.grow, at: Date.now() }; g.req = { type: 'free' }; }
  await save();
  return lines;
}
/** 一局打完（不算放弃）：活着的人照规则书过技能成长——这局用成功过的技能各掷一次 1D100，大于技能值（或大于 95）就加 1D10，最高 90；
 *  再给成长点：KP 在结局时按这局表现给每人 5～25 点（作者定的；没给就好结局 15、坏结局 10）。属性越高越难长：每点要掷 1D100 大于现在的值才加 1，没过这点就白用了，单项不超过 90。
 *  你的点留着自己分（raise），同伴的随机挑还没到 90 的属性掷。
 *  返回 [{ name, me, up: ['侦查 +4'], pts 这次加了几点, card 卡的 id }]，存在 g.grown 里，只算一次 */
export const cardById = id => (D.cards || []).find(c => c.id === id) || null;
export async function grow(g) {
  if (g.grown || !g.done || g.done.kind === 'quit') return null;
  const out = [];
  for (const p of [g.pc, ...g.party]) {
    const c = (D.cards || []).find(x => x.id === p.card); if (!c || p.hp <= 0) continue;
    const up = [];
    for (const k of Object.keys(p.ticks || {})) { const v = c.skills[k] ?? 0, r = R.d100().v; if (r > v || r > 95) { const n = Math.min(R.MAX_SKILL - v, R.d(10)); if (n <= 0) continue; c.skills[k] = v + n; c.skillUp = (c.skillUp || 0) + n; up.push(`${k} +${n}`); } }
    const pts = Math.max(5, Math.min(25, Math.round(+(g.done.grow || {})[p.name]) || (g.done.kind === 'good' ? 15 : 10)));
    c.grown = (c.grown || 0) + pts;
    if (p === g.pc) c.pend = (c.pend || 0) + pts;
    else { const got = {}; for (let i = 0; i < pts; i++) { const ks = Object.keys(c.attrs).filter(x => x !== 'LUCK' && c.attrs[x] < 90), k = ks[R.d(ks.length) - 1]; if (!k) break; if (R.d100().v > c.attrs[k]) { c.attrs[k]++; got[k] = (got[k] || 0) + 1; } }
      for (const [k, n] of Object.entries(got)) up.push(`${R.ATTRS.find(x => x[0] === k)[1]} +${n}`); }
    out.push({ name: c.name, me: p === g.pc, up, pts: p === g.pc ? pts : 0, card: c.id });
  }
  g.grown = out; await save(); return out;
}
/** 你分一点成长点到某项属性：掷 1D100，大于现在的值才加 1，没过这点也用掉了；掷了就算（马上存） */
export async function raise(c, k) {
  if (!c.pend || c.attrs[k] >= 90) return null;
  const was = c.attrs[k], r = R.d100().v; c.pend--; if (r > was) c.attrs[k]++;
  await save(); return { r, was, ok: r > was };
}
/** 不玩了：标成放弃 */
export async function quit(g) { g.done = { kind: 'quit', text: '', at: Date.now() }; await save(); }

// 这局用成功过的技能打个勾，打完一局过成长（属性不打勾）
const tick = (p, sk) => { if (sk in p.skills) (p.ticks || (p.ticks = {}))[sk] = 1; };
// 技能值；「力量」「敏捷」这类是属性，读卡上的属性（以前当成技能去找，找不到就按 20 算）
const valOf = (p, sk) => { const a = R.ATTRS.find(x => x[1] === sk); return a ? p.attrs[a[0]] : p.skills[sk] ?? R.SKILLS[sk] ?? 20; };
/** 检定的结果写成一句话给 KP（也给人看）；v 是盖在掷骰画面上的那两个字（大成功 / 困难成功 / 失败…） */
export function resolve(g, req, { skill } = {}) {
  const p = who(g, req.who) || g.pc, name = p === g.pc ? '你' : p.name, sk = skill || req.skill || '侦查';
  if (req.type === 'san') {
    const r = R.sanCheck(p.san, req.loss, g.crit); p.san = Math.max(0, p.san - r.lost);
    if (r.lost >= 5 && !p.mad) p.mad = R.madness();
    return { r, v: r.grade === '大成功' || r.grade === '大失败' ? r.grade : r.ok ? '成功' : '失败', text: `${name}的理智检定：掷出 ${r.v}（理智 ${r.need}），${r.ok ? '成功' : '失败'}，掉了 ${r.lost} 点${r.lost >= 5 ? `，临时疯狂：${p.mad.name}` : ''}${p.san <= 0 ? '，理智归零' : ''}`, lost: r.lost };
  }
  if (req.type === 'opposed') {
    const r = R.opposed(valOf(p, sk), +req.vs || 50, g.crit);
    return { r: r.a, v: r.win ? '赢了' : '输了', text: `${name}的${sk}对抗：掷出 ${r.a.v}（${r.a.grade}），对方掷出 ${r.b.v}（${r.b.grade}），${r.win ? '赢了' : '输了'}` };
  }
  const val = valOf(p, sk), b = Math.max(-2, Math.min(2, Math.round(+req.bonus) || 0)), r = R.check(val, req.level, g.crit, b);
  if (r.ok) tick(p, sk);
  return { r, v: r.grade, text: `${name}的${sk}检定（${req.level || '普通'}${b ? `，${b > 0 ? '奖励' : '惩罚'}骰 ${Math.abs(b)} 个` : ''}）：掷出 ${r.v}，技能 ${val}，${r.grade}` };
}

/* ---------- 战斗：一轮一轮，手机按敏捷先后替每个人掷（你自己选这一轮做什么），打完才把结果交给 KP 讲 ----------
   敌人 { name, wpn, hp, hpMax, atk 攻击, brawl 斗殴（反击用）, dodge 闪避, dex 敏捷, build 体格, armor 护甲, n 一轮打几下, dmg 伤害（已经算上它的力气） }：开局时按人数和数值定好，KP 提出战斗时带上
   照规则书第七版：近战可以闪避（平手算躲开）或反击（平手算攻方赢，赢了打回去）；枪闪不开也不能反击，只能扑倒找掩护 */
const FIST = { name: '徒手', dmg: '1D3', skill: '斗殴' };
export const weapons = p => [FIST, ...(p.items || []).filter(x => x.dmg)];
const isGun = w => /枪/.test(w.skill || w.name || '');
export function joinFight(g, foes) {
  const F = g.fight || (g.fight = { round: 0, foes: [] });
  for (const f of Array.isArray(foes) ? foes : []) {
    if (!f || !f.name || F.foes.some(x => x.name === f.name)) continue;
    const hp = Math.max(1, Math.round(+f.hp) || 10), atk = +f.atk || 40;
    F.foes.push({ name: String(f.name), wpn: String(f.wpn || ''), hp, hpMax: hp, atk, brawl: +f.brawl || atk, dodge: +f.dodge || 20, dex: +f.dex || 50,
      build: Math.round(+f.build) || 0, armor: Math.max(0, Math.round(+f.armor) || 0), n: Math.min(3, Math.max(1, Math.round(+f.n) || 1)), dmg: String(f.dmg || '1D6') });
  }
}
// 战技三种（只有你会用）：按住（挣脱前每轮动不了，打它多一个奖励骰）、缴械（武器掉了，只能徒手）、撞倒（下一轮爬起来，爬起来前打它多一个奖励骰）
export const MOVES = [['hold', '按住'], ['disarm', '缴械'], ['knock', '撞倒']];
/** 这一轮：act = { kind: 'atk' | 'move' | 'cover' | 'flee', foe 对谁, wpn 用什么, def 'dodge' | 'back' 你被近战打时怎么防, move 哪种战技 }。
    skill 用第几个特殊能力。
 *  返回 { lines 这一轮的每一下（给人看）, ev 每一下给像素擂台演的（和 lines 一一对上，没有动作的是 null）, text 给 KP 的结果, over 打完了没, mine 你自己那一下的骰子, cap } */
export function fightRound(g, act) {
  const F = g.fight, me = g.pc, up = x => x.hp > 0, out = [], ev = [], nm = p => p === me ? '你' : p.name;
  const say = (t, e = null) => { out.push(t); ev.push(e); };
  const isFoe = p => F.foes.includes(p), key = p => p === me ? 'me' : isFoe(p) ? 'f' + F.foes.indexOf(p) : p.id, dexOf = p => isFoe(p) ? p.dex : p.attrs.DEX, buildOf = p => isFoe(p) ? p.build : R.build(p.attrs);
  const dodgeOf = p => isFoe(p) ? p.dodge : p.skills.闪避 ?? 20, brawlOf = p => isFoe(p) ? p.brawl : p.skills.斗殴 ?? 25;
  const skillOf = (p, w) => p.skills[w.skill] ?? R.SKILLS[w.skill] ?? 25;
  const wpnOf = p => isFoe(p) ? (p.wpn === '徒手' ? FIST : { name: p.wpn, dmg: p.dmg, skill: /枪/.test(p.wpn) ? '手枪' : '斗殴' }) : p.wpn;
  const melee = p => { const w = wpnOf(p) || FIST; return isGun(w) ? (isFoe(p) ? FIST : weapons(p).filter(x => !isGun(x)).pop() || FIST) : w; };
  const pick = l => l[Math.floor(Math.random() * l.length)];
  // 怪和同伴：闪避、斗殴里挑高的，两成机会挑另一个；你：自己选的
  const defOf = d => d === me ? act.def : (dodgeOf(d) >= brawlOf(d)) === (Math.random() < .8) ? 'dodge' : 'back';
  const bonusOn = d => d.held || d.down ? 1 : 0;
  let mine = null, cap = '', fled = false, cover = false, cheer = false;   // cheer：有人用了鼓舞，这一轮我方打人多一个奖励骰
  F.round++;
  for (const p of [me, ...g.party]) p.guard = 0;
  for (const p of [me, ...g.party]) p.wpn = p === me ? weapons(me).find(x => x.name === act.wpn) || FIST : weapons(p).reduce((a, b) => skillOf(p, b) >= skillOf(p, a) ? b : a);
  const hurt = (a, d, w, top) => {
    const raw = R.dice(w.dmg, top) + (!isFoe(a) && !isGun(w) && !w.power ? R.db(a.attrs) : 0), cut = isFoe(d) ? d.armor : Math.min(d.guard || 0, raw), n = Math.max(0, raw - cut);
    d.hp = Math.max(0, d.hp - n);
    return [n, `伤害 ${n}${cut ? `（${isFoe(d) ? '护甲' : '护身'}挡了 ${cut}）` : ''}，${nm(d)}剩 ${d.hp}/${d.hpMax}${!d.hp ? '，倒下了' : n * 2 >= d.hpMax ? '，重伤' : ''}`];
  };
  // 一下攻击：枪不能防（你找了掩护就多一个惩罚骰）；近战看守方闪避还是反击
  const hit = (a, d, w) => {
    const gun = isGun(w), r = R.check(isFoe(a) ? a.atk : skillOf(a, w), '普通', g.crit, bonusOn(d) + (cheer && !isFoe(a) ? 1 : 0) - (gun && d === me && cover ? 1 : 0));
    if (r.ok && !isFoe(a)) tick(a, w.skill);
    const e = { kind: 'atk', a: key(a), d: key(d), gun, w: w.name || '', res: r.ok ? 'dodge' : 'miss' };
    const land = (x, y, ww, rr, res, word) => { const [n, s2] = hurt(x, y, ww, R.rank(rr) >= 3); Object.assign(e, { res, dmg: n, crit: R.rank(rr) >= 3 }); return `，${word}，${s2}`; };
    let t = `${nm(a)}${w.name && w.name !== '徒手' ? '用' + w.name : ''}攻击${nm(d)}：${r.v}（${r.grade}）`;
    if (gun) { t += r.ok ? land(a, d, w, r, 'hit', '打中了') : '，没打中'; say(t, e); return r; }
    const how = defOf(d), dr = R.check(how === 'dodge' ? dodgeOf(d) : brawlOf(d), '普通', g.crit);
    if (dr.ok && !isFoe(d)) tick(d, how === 'dodge' ? '闪避' : '斗殴');
    t += `，${nm(d)}${how === 'dodge' ? '闪避' : '反击'} ${dr.v}（${dr.grade}）`;
    if (how === 'back' && dr.ok && R.rank(dr) > R.rank(r)) t += land(d, a, melee(d), dr, 'back', '反打回去');
    else if (r.ok && (how === 'dodge' ? R.rank(r) > R.rank(dr) : R.rank(r) >= R.rank(dr))) t += land(a, d, w, r, 'hit', '打中了');
    else t += r.ok ? '，没打着' : '，没打中';
    say(t, e); return r;
  };
  // 特殊能力：先扣魔法；攻击、治疗掷意志，成了才算（攻击闪不开，护甲照挡）；护身、鼓舞不用掷
  const power = (p, ab, d) => {
    const tag = `${nm(p)}用「${ab.name}」`, e = { kind: 'power', a: key(p), d: d && key(d), power: ab.kind, res: 'fail' };
    if ((p.mp ?? 0) < ab.cost) { say(`${tag}，魔法不够了`, e); return null; }
    p.mp -= ab.cost;
    const cost = ab.cost ? `（耗 ${ab.cost} 魔法）` : '';
    if (ab.kind === 'guard') { p.guard = ab.dmg === '全部' ? 999 : +ab.dmg || 4; e.res = 'ok'; say(`${tag}${cost}，这一轮挨打少 ${p.guard >= 999 ? '全部' : p.guard + ' 点'}伤害`, e); return null; }
    if (ab.kind === 'buff') { cheer = true; e.res = 'ok'; say(`${tag}${cost}，这一轮大家打人都多一个奖励骰`, e); return null; }
    const r = R.check(p.attrs.POW, '普通', g.crit);
    if (!r.ok) { say(`${tag}${cost}：意志 ${r.v}（${r.grade}），没成`, e); return r; }
    if (ab.kind === 'heal') { const t = [me, ...g.party].filter(up).sort((x, y) => x.hp / x.hpMax - y.hp / y.hpMax)[0], n = R.dice(ab.dmg || '1D4'); t.hp = Math.min(t.hpMax, t.hp + n); Object.assign(e, { res: 'ok', d: key(t), dmg: n }); say(`${tag}${cost}：意志 ${r.v}（${r.grade}），给${nm(t)}回了 ${n} 血（${t.hp}/${t.hpMax}）`, e); return r; }
    const [n, s2] = hurt(p, d, { dmg: ab.dmg || '1D6', power: true }, R.rank(r) >= 3); Object.assign(e, { res: 'hit', dmg: n, crit: R.rank(r) >= 3 });
    say(`${tag}${cost}打${nm(d)}：意志 ${r.v}（${r.grade}），${s2}`, e); return r;
  };
  // 战技：斗殴对守方的闪避 / 反击；对方体格大一级多一个惩罚骰，大三级做不了
  const move = d => {
    const gap = buildOf(d) - buildOf(me), name = MOVES.find(x => x[0] === act.move)[1];
    if (gap >= 3) { say(`你想${name}${d.name}：它太大了，根本拽不动`, { kind: 'move', a: 'me', d: key(d), res: 'fail' }); return null; }
    const r = R.check(brawlOf(me), '普通', g.crit, bonusOn(d) - Math.max(0, gap)), how = defOf(d), dr = R.check(how === 'dodge' ? dodgeOf(d) : brawlOf(d), '普通', g.crit);
    const win = r.ok && (how === 'dodge' ? R.rank(r) > R.rank(dr) : R.rank(r) >= R.rank(dr));
    if (win) { if (act.move === 'hold') d.held = true; if (act.move === 'knock') d.down = true; if (act.move === 'disarm') d.wpn = '徒手'; }
    say(`你想${name}${d.name}${gap > 0 ? `（它比你大，惩罚骰 ${gap} 个）` : ''}：${r.v}（${r.grade}），${d.name}${how === 'dodge' ? '闪避' : '反击'} ${dr.v}（${dr.grade}），${win ? { hold: '按住了', disarm: '它的武器掉了', knock: '撞倒了' }[act.move] : '没成'}`, { kind: 'move', a: 'me', d: key(d), res: win ? act.move : 'fail' });
    return r;
  };
  for (const p of [me, ...g.party, ...F.foes].filter(up).sort((x, y) => dexOf(y) - dexOf(x))) {
    if (!up(p)) continue;
    const foes = F.foes.filter(up), ours = [me, ...g.party].filter(x => up(x) && !(x === me && fled));
    if (isFoe(p)) {
      if (p.down) { p.down = false; say(`${p.name}爬起来了`, { kind: 'up', a: key(p) }); continue; }
      if (p.held) { if (R.opposed(p.brawl, brawlOf(me), g.crit).win) { p.held = false; say(`${p.name}挣开了你`, { kind: 'free', a: key(p) }); } else say(`${p.name}被你按着，挣不开`); continue; }
      for (let i = 0; i < p.n && ours.some(up); i++) hit(p, pick(ours.filter(up)), wpnOf(p));
      continue;
    }
    if (!foes.length) break;
    if (p !== me) {   // 同伴：有人伤得重就先治，偶尔放攻击能力，其余照常打
      const ab = (p.abilities || []).find(x => x.kind === 'heal' && x.cost <= p.mp && ours.some(o => o.hp * 2 < o.hpMax)) || (Math.random() < .4 && (p.abilities || []).find(x => x.kind === 'atk' && x.cost <= p.mp));
      if (ab) power(p, ab, pick(foes)); else hit(p, pick(foes), p.wpn);
      continue;
    }
    if (act.kind === 'cover') { mine = R.check(dodgeOf(me), '普通', g.crit); cover = mine.ok; cap = '找掩护（闪避）'; say(`你扑倒找掩护：${mine.v}（${mine.grade}），${cover ? '躲好了，这一轮朝你开枪的更难打中' : '没找到地方'}`, { kind: 'cover', a: 'me', res: cover }); continue; }
    if (act.kind === 'flee') { mine = R.check(me.attrs.DEX, '普通', g.crit); fled = mine.ok; cap = '逃跑（敏捷）'; say(`你想逃：${mine.v}（${mine.grade}），${fled ? '逃出去了' : '没逃掉'}`, { kind: 'flee', a: 'me', res: fled }); continue; }
    const d = foes.find(f => f.name === act.foe) || foes[0];
    if (act.kind === 'move') { cap = `${MOVES.find(x => x[0] === act.move)[1]}${d.name}`; mine = move(d); continue; }
    if (act.kind === 'power') { const ab = me.abilities[act.skill]; cap = `${ab.name}（意志）`; mine = power(me, ab, d); continue; }
    cap = `${me.wpn.name}攻击${d.name}`; mine = hit(me, d, me.wpn);
  }
  for (const p of [me, ...g.party]) delete p.wpn;
  if (!up(me) || fled) for (const f of F.foes) f.held = false;
  const over = !F.foes.some(up) ? '敌人都倒下了，战斗结束' : fled ? '你逃出了战斗' : !up(me) ? '你倒下了' : '';
  if (over) g.fight = null;
  return { lines: over ? [...out, over] : out, ev: over ? [...ev, null] : ev, text: `【战斗第 ${F.round} 轮】${out.join('；')}。${over || '还在打'}`, over, mine, cap };
}
