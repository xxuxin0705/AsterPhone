// 幕间 · 一局的数据和流程：车卡一次 API（几个人一起），开局一次 API 生成骨架，之后每回合一次；骰子由手机掷（rules.js），AI 只收结果。
// 整局不进正文、不进记忆。局存在 kv 的 int:窗口 里；正在等 AI 的那一步放在模块里，退出页面再进来还是「取消」。
import { state, win, contact, kvGet, kvSet, chatForContact } from '../../core/store.js';
import { generateMore, resolveConn } from '../../core/api.js';
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
  // 旧卡：技能改过名、补上后来加的技能、超过 90 的压回 90、武器伤害换成档位；没打完的局里的技能也改名
  for (const c of D.cards || []) { c.skills = R.fixSkills(c.attrs, R.renamed(c.skills)); c.items = (c.items || []).map(toItem).filter(Boolean); if (c.tier) c.tier = R.tierOf(c.tier) || c.tier;
    // 旧卡的背景（身份、关系、关键经历、目标、秘密）：关系挪到调查员同伴，其余并进背景故事
    if (c.bg && !('story' in c.bg)) { const b = c.bg; c.bg = { rel: b.rel || '', story: [b.who, b.past, b.goal && '目标：' + b.goal, b.secret && '秘密：' + b.secret].filter(Boolean).join(' ') }; } }
  if (D.meet) D.meet.rules = toRules(D.meet.rules);
  for (const g of D.games.filter(g => !g.done)) { for (const p of [g.pc, ...g.party]) p.skills = R.renamed(p.skills); g.rel = g.rel || []; g.npcs = g.npcs || []; }   // 关系图是后来加的
  return D; }
export const save = () => kvSet('int:' + Dkey, D);
export const current = () => D.games.filter(g => !g.done).sort((a, b) => (b.seen || b.at) - (a.seen || a.at))[0] || null;   // 好几局没打完时：最近玩过的那局
export async function dropGame(g) { D.games = D.games.filter(x => x !== g); await save(); }
export const all = () => (D ? D.games : []);
export const wrapping = g => !!(g.done && g.done.wrap && !(g.review && g.review.done));   // 落幕了、复盘会还没看完（旧局没有复盘会）
export let job = null;   // { g, ac }：正在等 AI 的那一步
export const running = g => job && (!g || job.g === g);
export function cancel() { if (job) job.ac.abort(); }

const strip = t => String(t).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/g, '');
function parse(t) {
  const s = strip(t), i = s.indexOf('{'), j = s.lastIndexOf('}');
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { throw new Error(open(t) ? 'AI 回到一半断了（字数到了上限）' : 'AI 回的格式不对'); }
}
/** 括号还没合上：回到一半断了（字数到了上限） */
function open(t) {
  const s = strip(t), i = s.indexOf('{'); if (i < 0) return false;
  let d = 0, q = false, e = false;
  for (const ch of s.slice(i)) { if (e) e = false; else if (ch === '\\') e = q; else if (ch === '"') q = !q; else if (!q) d += '{['.includes(ch) ? 1 : '}]'.includes(ch) ? -1 : 0; }
  return d > 0 || q;
}
async function ask(cat, vars, g) {
  const ac = new AbortController(), conn = resolveConn('text', 'interlude'), prompt = compose(cat, vars); job = { g, ac };
  try {
    // 回到一半断了（括号没合上）就自动补写：设置里开了才补（默认关），最多补几次也在设置里定
    const A = state.apps.interlude;
    return parse(await generateMore({ conn, app: '幕间', stop: ac.signal, prompt }, t => !open(t), A.fill ? A.fillMax || 3 : 0));
  } finally { job = null; }
}
const placesText = () => Object.entries(R.PLACES).map(([k, v]) => `${k} = ${v}`).join('；');
/** 性别只分男女（作者定的，卡上是两个选项）：AI 写「女性」「男生」之类也认 */
export const sexOf = s => /女/.test(s) ? '女' : /男/.test(s) ? '男' : '';
const attrsText = a => R.ATTRS.map(([k, n]) => `${n} ${a[k]}`).join('、');
const topSkills = s => Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join('、');
// 随身物品 { name, dmg, skill }：武器才有伤害和用的技能
export const itemText = x => x.name + (x.dmg ? `（伤害 ${x.dmg}，用${x.skill || '斗殴'}）` : x.n ? `（还能用 ${x.n} 次）` : '');
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
// 玩家本人：旁白用第二人称「你」，只有别人在台词里叫到才叫名字（作者定的，提升代入感）；AI 替不替你说话、行动照开局设置
const youText = g => `写到 ${myName()}（玩家本人）的旁白一律用第二人称「你」（比如「你被他蹭得有点痒」），不写名字；只有别人在台词里叫到 TA 时才叫名字。${g.speak
  ? '可以抢话：照 TA 的人设和刚才的情形，把 TA 大概会做的事、会说的话也演出来（台词的 who 写「你」），别替 TA 做改变走向的大决定。' : '不要替 TA 说话、做决定、写 TA 的动作，TA 说什么、做什么由 TA 自己来。'}\n`;
const kpText = g => youText(g) + (() => { const c = g.kp !== 'sys' && contact(g.kp);
  return c ? `你是 ${nameOf(c)}，这一局由你来当《克苏鲁的呼唤》的守秘人（KP）：用你自己的性格和口吻主持（叙述还是用中文旁白），你知道真相，但不当玩家。你的人设：${(personaOf(c) || '').slice(0, 400) || '（没有更多资料）'}；你自己说话时${speakLine(g, c.id)}\n场外有人跟你搭话、开玩笑、套近乎时，照你的性格接：可以顺着说两句，也可以端起 KP 的架子拒绝（比如「我是 KP，现在别跟我套近乎」），再把大家拉回戏里。\n`
    : `你是这局《克苏鲁的呼唤》的守秘人（KP），中立、不下场，KP 说话时${speakLine(g, 'sys')}\n`; })();
// 认识谁：照【关系】（开局时是各自卡上写的认识谁，戏里认识了、关系变了 AI 会报）；分头行动时不知道对方那边的事
const REL = '调查员之间的关系照【关系】：写到了的互相认识，没写到的互不认识，要在戏里先认识一下；分头行动时，不在一起的人不知道对方那边发生了什么，汇合后要在戏里交换情报。';
// 大家都知道在跑团（作者定的：没有「当真」，认真玩也是玩）
const knowText = () => '大家都知道这是在跑团：角色们是坐在桌边、扮演调查员的玩家。可以偶尔（不是每回合）插一两句场外话（ooc: true）：吐槽流程、开玩笑、闲聊；KP 也可以出来维持秩序。但戏里要守规矩：' + REL + '（场外可以吐槽「就当我们叽里呱啦交换完了」，戏里还是要走一遍）';
/** 一句台词给人看 / 给 KP 看的样子 */
export const lineText = l => l.text ? plain(l.text) : `${l.ooc ? '（场外）' : ''}${plain(l.act)}${l.say ? `「${plain(l.say)}」` : ''}`;

/* ---------- 调查员卡：跟着人存（一个人可以有好几张），下次上桌默认用上次那张 ----------
   卡 { id, owner: 'me' | 联系人 id, name, age, sex, job, home, bg: { 背景的格子，见 BG }, rels: [{ o 认识的同桌（'me' | 联系人 id）, text 这张卡眼里的 TA }], living 消费水平, cash 现金, assets 资产, items, attrs, skills, jobSkills 本职技能, at } */
// 背景：照调查员卡背面的格子（作者给的默认卡）。车卡时就写好，每打完一局 KP 把这局留下的（伤疤、恐惧症、神话典籍、第三类接触…）续上
export const BG = [['look', '形象描述'], ['trait', '特质'], ['belief', '思想与信念'], ['people', '重要之人'], ['place', '意义非凡之地'], ['treasure', '宝贵之物'], ['story', '背景故事'],
  ['scars', '伤口和疤痕'], ['phobia', '恐惧症和狂躁症'], ['tomes', '神话典籍、法术和魔法物品'], ['encounter', '第三类接触']];
/* 调查员名录：卡打过的局、现在的状态（照最后一局打完时：下落不明 > 血 0 长眠 > 理智 0 窥见者，作者定的），不另外存。
   长眠、窥见者、终焉之地的卡不能再上桌，只在名录里看 */
export const FATES = { alive: ['尚在此岸', '我们终将踏破迷雾再次重逢。'], dead: ['长眠', '睡吧，这一次不会再有噩梦来敲门。'], mad: ['窥见者', '蚂蚁仰起头，天空正在低头看它。'], lost: ['终焉之地', '我们没有找到他，也许是他找到了什么。'] };
export const gamesOf = c => D.games.filter(g => g.done && [g.pc, ...g.party].some(p => p.card === c.id)).sort((a, b) => a.at - b.at);
export const fateOf = c => { const g = gamesOf(c).filter(g => g.done.kind !== 'quit').at(-1), p = g && [g.pc, ...g.party].find(p => p.card === c.id);
  return !p ? 'alive' : (g.done.lost || []).includes(p.name) ? 'lost' : p.hp <= 0 ? 'dead' : p.san <= 0 ? 'mad' : 'alive'; };
export const allCards = () => D.cards || [];
export const cardsOf = owner => allCards().filter(c => c.owner === owner && fateOf(c) === 'alive');
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
export const realName = o => o === 'me' ? myName() : contact(o).name || ownerName(o);
const rosterLine = (o, rolled) => `${ownerName(o)}${o === 'me' ? '（玩家本人）' : realName(o) !== ownerName(o) ? `（本名 ${realName(o)}）` : ''}：人设：${(ownerPersona(o) || '').slice(0, 500) || '（没有更多资料）'}${rolled ? `；掷好的属性：${attrsText(rolled)}` : ''}`;
const skillsText = () => Object.entries(R.SKILLS).map(([k, v]) => `${k} ${v}`).join('、') + '、闪避（敏捷÷2）、母语（教育）';
// AI 写的一张卡 → 存的卡；rolled：随机车卡时掷好的属性（不算档位）；r：团公告的规矩（购点 base 记在卡上）
// 认识谁：AI 写的名字认回是谁（名单上的名字、本名、卡上的名字都认）
const isOwner = (o, w) => !!w && ([ownerName(o), realName(o), (lastCard(o) || {}).name].includes(w) || o === 'me' && w === '你');
const relsOf = (L, o, all) => (Array.isArray(L) ? L : []).map(y => ({ o: all.find(p => p !== o && isOwner(p, str(y.who))), text: str(y.text) })).filter((y, i, a) => y.o && y.text && a.findIndex(z => z.o === y.o) === i);
function toCard(o, x, rolled, r, all = []) {
  const tier = rolled ? undefined : R.tierOf(x.tier) || R.TIERS[0][0], a = rolled || R.fixAttrs(x.attrs, R.budgetOf(tier, r && r.base), r), base = R.baseSkills(a);
  const given = (Array.isArray(x.jobSkills) ? x.jobSkills : []).map(String).filter(k => k in base).slice(0, 8), jobs = given.length ? given : R.jobsOf({ job: x.job });
  const sk = R.fixSkills(a, x.skills, r && r.skillMax, r && r.hobbyMax, jobs); sk.信用评级 = R.crFit(sk.信用评级, x.job);
  return { id: uid('ic'), owner: o, at: Date.now(), name: String(x.name || ownerName(o)), age: +x.age || 25, sex: sexOf(x.sex), job: String(x.job || ''), home: String(x.home || ''),
    bg: Object.fromEntries(BG.map(([k]) => [k, String((x.bg || {})[k] || '')])), rels: relsOf(x.rels, o, all), living: String(x.living || ''), cash: String(x.cash || ''), assets: String(x.assets || ''), items: (Array.isArray(x.items) ? x.items : []).map(toItem).filter(Boolean), tier, base: r && r.base, attrs: a, skills: sk, jobSkills: jobs,
    abilities: (Array.isArray(x.abilities) ? x.abilities : []).map(toPower).filter(Boolean).slice(0, 3) };
}
/** 团公告的规矩（真实跑团车卡前 KP 发的）：base 购点（普通人的属性总点数，能力者、最强者另外多给）、attrMin / attrMax 每项属性上下限、
 *  skillMax 本职技能上限、hobbyMax 其他技能上限、skills 推荐技能、weapons 最多几件武器、guns 能不能带枪、abilities 最多几个特殊能力、banned 不准带的、tiers 车卡会上每人的档位、text 一句话 */
const num = v => v == null || v === '' || isNaN(+v) ? null : Math.max(0, Math.round(+v)), strs = L => (Array.isArray(L) ? L : []).map(String).filter(Boolean);
function toRules(r = {}) {
  const lo = Math.max(15, Math.min(60, num(r.attrMin) ?? 15));
  return { base: Math.max(400, Math.min(560, num(r.base) ?? 460)), attrMin: lo, attrMax: Math.max(lo + 20, Math.min(90, num(r.attrMax) ?? 90)), skillMax: Math.max(50, Math.min(90, num(r.skillMax) ?? 80)), hobbyMax: Math.max(30, Math.min(num(r.skillMax) ?? 80, 90, num(r.hobbyMax) ?? 60)),   // 没写就照常见的：本职 80、兴趣 60
    skills: strs(r.skills), weapons: num(r.weapons), guns: r.guns !== false, abilities: num(r.abilities), banned: strs(r.banned), text: String(r.text || ''),
    tiers: Object.fromEntries(Object.entries(r.tiers || {}).map(([k, v]) => [k, R.tierOf(v) || R.TIERS[0][0]])),
    money: r.money && r.money.unit ? { unit: String(r.money.unit).slice(0, 8), rate: +r.money.rate > 0 ? +r.money.rate : 1 } : { unit: '美元', rate: 1 } };   // 当地的钱：KP 按故事的年代、地方定
}
const rulesLine = r => [`购点 ${r.base}`, `属性 ${r.attrMin}～${r.attrMax}`, `本职技能最高 ${r.skillMax}`, r.hobbyMax < r.skillMax && `兴趣技能最高 ${r.hobbyMax}`, r.weapons != null && `武器最多 ${r.weapons} 件`, !r.guns && '不能带枪',
  r.abilities != null && `特殊能力最多 ${r.abilities} 个`, r.banned.length && `不准带：${r.banned.join('、')}`, r.skills.length && `推荐技能：${r.skills.join('、')}`].filter(Boolean).join(' · ');
const noticeText = m => `背景：${m.hint}\n规矩：${m.rules.text}（${rulesLine(m.rules)}）`;
async function keep(made) { (D.cards || (D.cards = [])).push(...made); made.forEach(c => { (D.last || (D.last = {}))[c.owner] = c.id; }); await save(); return made; }
// all：同桌的所有人（重车时只车其中几个，关系也要写到没重车的人）
// s：这一桌的设置（本、车卡方式、车卡补充…，见 meet）。这桌已经有团公告（或开过车卡会）就照着车；没有就让 KP 先写一张团公告，和卡一起回来（不多找一次 AI）
const noteText = note => note ? `\n【玩家车卡前补充的话（照着来）】${note}` : '';
export async function makeCards(owners, all = owners, s = {}) {
  const m = meeting(s), story = storyText(), memory = await memoryText(all, story), rolled = rollFor(owners, s.mode);
  const others = all.filter(o => !owners.includes(o)).map(o => { const c = lastCard(o); return ownerName(o) + (c ? `（这局扮演 ${c.name}，${c.job}）` : ''); });
  const out = await ask('intCards', {
    story: story || '（正文里还没发生什么）', memory: memory && `\n【记着的事】（世界书、念念铃）\n${memory}\n`, jobs: R.JOBS.map(j => j[0]).join('、'), skills: skillsText(), mode: (MODE_TEXT[s.mode] || '') + noteText(s.note),
    scenario: scText(s), notice: m ? `【这局的团公告（已经定好，照着车；JSON 里不要再写 hint 和 rules，只写 cards）】\n${noticeText(m)}` : '（这局还没有团公告：先替 KP 写一张，写在 hint 和 rules 里）',
    roster: (others.length ? `同桌的还有：${others.join('、')}（他们的卡已经车好了，不要写他们的卡；只在背景里写到和他们的关系）\n下面这 ${owners.length} 个人要车卡，cards 里正好 ${owners.length} 张：\n` : '') + owners.map(o => rosterLine(o, rolled[o])).join('\n'),
  });
  const list = Array.isArray(out.cards) ? out.cards : [];
  if (!list.length) throw new Error('AI 回的格式不对');
  if (!m && !s.meet) D.meet = { key: meetKey(s), at: Date.now(), mode: s.mode, pick: s.pick, hint: String(out.hint || ''), rules: toRules(out.rules) };
  const r = (meeting(s) || {}).rules;
  // 认卡：who 照名字认（写成「你」、名字多了少了几个字也认）；AI 多写了别人的卡、又认不出是谁的，就不乱拿别人的那张
  const whose = (o, c) => { const w = String(c.who || ''); return !!w && ([ownerName(o), realName(o)].some(n => w === n || n.includes(w) || w.includes(n)) || o === 'me' && w === '你'); };
  return keep(owners.map((o, i) => { const x = list.find(c => whose(o, c)) || list.length === owners.length && list[i];
    if (!x) throw new Error(`AI 没写${ownerName(o)}的卡`); return toCard(o, x, rolled[o], r, all); }));
}

/** 车卡会（知道在跑团时可选）：一次 API 写完整场——KP 先发团公告、其他人交卡被打回再改、定下规矩、其他人过审的卡、
 *  你交卡时过审 / 被打回说的话、亮卡时的评语。你的卡你自己交，手机照规矩审（checkCard）。
 *  开会前定好大家统一用新卡、旧卡还是随机（每人各抛一次；没有旧卡的只能车新卡）。用旧卡的不重车，会上为了合规矩改的随身物品、特殊能力只管这一局（adjust）。
 *  存在 D.meet；上桌的人、本、气氛、车卡方式、新旧卡变了就作废，开局后用掉。s = { kp, party, scenario, ask, mood, mode, use, note, meet 开不开车卡会, speak 抢话（AI 演你会做的事、会说的话）, lang } */
export const USES = [['new', '新卡'], ['old', '旧卡'], ['mix', '随机']];
const meetKey = s => [s.kp, s.scenario, s.ask, s.mood, s.mode, s.use, s.note, !!s.meet, ...(s.party || [])].join('|');
/** 这一桌的团公告（不开车卡会时和车卡一起写的，或者车卡会） */
export const meeting = s => D.meet && D.meet.key === meetKey(s) ? D.meet : null;
/** 开团公告 / 车卡会时的开局设置（退出、刷新后回来接上）；v0.8.242 以前开的没存，从它的钥匙里拆出来（拆出来对不上就不认） */
export const meetNow = () => D.meet || null;
export function savedPick() {
  const m = D.meet; if (!m) return null; if (m.pick) return m.pick;
  const [kp, scenario, ask, mood, mode, use, note, meet, ...party] = m.key.split('|'), s = { kp, scenario, ask, mood, mode, use, note, meet: meet === 'true', party };
  return meetKey(s) === m.key ? s : null;
}
export async function meet(s) {
  const fresh = Object.fromEntries(['me', ...s.party].map(o => [o, !lastCard(o) || s.use === 'new' || (s.use === 'mix' && Math.random() < .5)])), news = s.party.filter(o => fresh[o]);
  const g = { kp: s.kp, lang: s.lang, speak: s.speak }, story = storyText(), mem = await memoryText([s.kp, ...s.party], story), rolled = rollFor(news, s.mode);
  const old = o => fresh[o] ? '' : `；用旧卡：${cardText(lastCard(o))}`;
  const out = await ask('intMeet', {
    kp: kpText(g), mood: R.MOOD_TEXT[s.mood], story: story || '（正文里还没发生什么）', memory: mem && `\n【记着的事】（世界书、念念铃）\n${mem}\n`, scenario: scText(s),
    roster: [`${myName()}（玩家本人）：人设：${(myPersona() || '').slice(0, 300) || '（没有更多资料）'}${fresh.me ? '；这局车新卡' : old('me')}`, ...s.party.map(o => rosterLine(o, rolled[o]) + old(o) + `；${speakLine(g, o)}`)].join('\n'),
    mode: (MODE_TEXT[s.mode] || '') + noteText(s.note), jobs: R.JOBS.map(j => j[0]).join('、'), skills: skillsText(),
  });
  const r = out.rules, all = Array.isArray(out.cards) ? out.cards : [], list = all.filter(c => !c.old);
  if (!Array.isArray(out.lines) || !r || list.length < news.length) throw new Error('AI 回的格式不对');
  const talk = L => (Array.isArray(L) ? L : []).filter(l => l && (l.say || l.act)), rules = toRules(r);
  const cards = await keep(news.map((o, i) => toCard(o, list.find(c => [ownerName(o), realName(o)].includes(c.who)) || list[i] || {}, rolled[o], rules, ['me', ...s.party]))), adjust = {};
  for (const o of s.party.filter(o => !fresh[o])) { const x = all.find(c => c.old && [ownerName(o), realName(o)].includes(c.who)); if (!x) continue;
    adjust[o] = { ...(Array.isArray(x.items) ? { items: x.items.map(toItem).filter(Boolean) } : {}), ...(Array.isArray(x.abilities) ? { abilities: x.abilities.map(toPower).filter(Boolean) } : {}) }; }
  D.meet = { key: meetKey(s), at: Date.now(), mode: s.mode, pick: s.pick, hint: String(out.hint || ''), lines: talk(out.lines), pass: talk(out.pass), fail: talk(out.fail), reviews: out.reviews || {},
    cards: Object.fromEntries(cards.map(c => [c.owner, c.id])), fresh: fresh.me, adjust, rules };
  await save(); return D.meet;
}
/** 自己填的空白卡（作者要的，不找 AI）：档位照团公告（没有就普通人），属性先都放 40，技能是基础值，剩下的自己填 */
export async function blankCard(owner, s) {
  const r = (meeting(s) || {}).rules, a = { ...Object.fromEntries(R.ATTRS.map(([k]) => [k, 40])), LUCK: R.roll(3, 6) * 5 };
  return (await keep([{ id: uid('ic'), owner, at: Date.now(), name: ownerName(owner), age: 20, sex: '', job: '', home: '', bg: Object.fromEntries(BG.map(([k]) => [k, ''])), rels: [], living: '', cash: '', assets: '',
    items: [], tier: (r && R.tierOf(r.tiers[ownerName(owner)])) || R.TIERS[0][0], base: r && r.base, attrs: a, skills: R.baseSkills(a), jobSkills: [], abilities: [] }]))[0];
}
/** 卡大概什么水平（只在手机里算，作者要的）：战斗 / 调查 / 社交 / 生存各 1～5 星，总评 S～D，偏哪一面；有团公告就看推荐技能点了几个 */
export function rate(c, m) {
  const a = c.attrs, k = c.skills, best = (...ks) => Math.max(...ks.map(x => k[x] || 0));
  const v = { 战斗: (a.STR + a.CON + a.DEX) / 3 * .4 + best('斗殴', '手枪', '步枪') * .3 + (k.闪避 || 0) * .3, 调查: (best('侦查') + best('聆听') + best('图书馆使用')) / 3 * .7 + a.INT * .3,
    社交: best('话术', '说服', '魅惑', '恐吓') * .6 + (a.APP + a.POW) / 2 * .4, 生存: Math.min(90, R.derived(a).hp * 5) * .4 + a.POW * .3 + best('急救', '医学') * .3 };
  const avg = Object.values(v).reduce((x, y) => x + y) / 4, top = Object.keys(v).sort((x, y) => v[y] - v[x]), base = R.baseSkills(a), rec = m ? m.rules.skills.filter(x => x in base) : [];
  return { stars: Object.fromEntries(Object.entries(v).map(([x, n]) => [x, Math.max(1, Math.min(5, Math.round(n / 15)))])), grade: avg >= 62 ? 'S' : avg >= 52 ? 'A' : avg >= 42 ? 'B' : avg >= 32 ? 'C' : 'D',
    role: v[top[0]] - v[top[3]] < 10 ? '均衡' : `偏${top[0]}`, rec: rec.length ? `推荐技能点了 ${rec.filter(x => k[x] > base[x]).length} / ${rec.length}` : '' };
}
/** 照团公告的规矩审你的卡：回不合规矩的地方（空的就是过了）。活着打完几局长的属性（grown）、技能（skillUp）是挣来的，不算超；
 *  属性上下限、技能上限只管这次新车的卡（旧卡是以前车的），掷骰车的不管属性上下限（规则书：天命不受属性限制） */
export function checkCard(c, m) {   // m 是这桌的团公告；没有就照一般的规矩看（自己填卡时预览用）
  const r = m ? m.rules : toRules(), bad = [], tier = R.tierOf(r.tiers[ownerName(c.owner)]) || c.tier || R.TIERS[0][0], fresh = !m || c.at >= m.at;
  const all = R.budgetOf(tier, r.base) + (c.grown || 0), jobs = R.jobsOf(c), u = R.usage(c.attrs, c.skills, jobs);
  if ((!m || m.mode !== 'random') && R.attrSum(c.attrs) > all) bad.push(`属性点 ${R.attrSum(c.attrs)}，${tier}${c.grown ? `加成长 ${c.grown} 点` : ''}最多 ${all}`);
  if (m && m.fresh && !fresh) bad.push('这局要用新卡');
  const [clo, chi] = R.crOf(c.job), cr = c.skills.信用评级 || 0; if (fresh && (cr < clo || cr > chi)) bad.push(`信用评级要在 ${clo}～${chi}（${c.job}）`);
  const out = fresh && c.tier ? R.ATTRS.filter(([k]) => k !== 'LUCK' && (c.attrs[k] < r.attrMin || c.attrs[k] > r.attrMax)) : [];
  if (out.length) bad.push(`属性要在 ${r.attrMin}～${r.attrMax}：${out.map(([k, n]) => n + c.attrs[k]).join('、')}`);
  const base = R.baseSkills(c.attrs), hi = fresh && !c.skillUp ? Object.entries(c.skills).filter(([k, v]) => k !== '母语' && v > (base[k] ?? 0) && v > (jobs.includes(k) ? r.skillMax : r.hobbyMax)) : [];
  if (hi.length) bad.push(`技能超了上限（本职 ${r.skillMax}${r.hobbyMax < r.skillMax ? `、其他 ${r.hobbyMax}` : ''}）：${hi.map(([k, v]) => k + ' ' + v).join('、')}`);
  const w = (c.items || []).filter(x => x.dmg), n = (c.abilities || []).length, things = [...(c.items || []), ...(c.abilities || [])].map(x => x.name).join('、') + (c.assets || '');
  if (r.weapons != null && w.length > r.weapons) bad.push(`武器带了 ${w.length} 件，最多 ${r.weapons} 件`);
  if (!r.guns && w.some(isGun)) bad.push(`不能带枪：${w.filter(isGun).map(x => x.name).join('、')}`);
  if (r.abilities != null && n > r.abilities) bad.push(`特殊能力 ${n} 个，最多 ${r.abilities} 个`);
  const ban = r.banned.filter(b => things.includes(b)); if (ban.length) bad.push(`不准带：${ban.join('、')}`);
  if (u.job > u.jobAll || u.hobby > u.hobbyAll + (c.skillUp || 0)) bad.push(`技能点超了：本职 ${u.job}/${u.jobAll}，兴趣 ${u.hobby}/${u.hobbyAll}${c.skillUp ? ` + 成长 ${c.skillUp}` : ''}`);
  return bad;
}
export const meetRules = m => { const t = m.mode !== 'random' && R.tierOf(m.rules.tiers[myName()]);
  return [t && `你是${t}（${R.budgetOf(t, m.rules.base)} 点）`, rulesLine(m.rules)].filter(Boolean).join(' · '); };
// 特殊能力 { name, kind, dmg, cost 耗几点魔法, desc }
const toPower = x => x && x.name ? { name: String(x.name), kind: x.kind in R.POWERS ? x.kind : 'other', dmg: String(x.dmg || ''), cost: Math.max(0, Math.min(20, Math.round(+x.cost) || 0)), desc: String(x.desc || '') } : null;
export const powerText = x => `${x.name}（${R.POWERS[x.kind]}${x.dmg ? ' ' + x.dmg : ''}${x.cost ? `，耗 ${x.cost} 魔法` : ''}${x.desc ? '：' + x.desc : ''}）`;
const powers = p => (p.abilities || []).length ? `；特殊能力：${p.abilities.map(powerText).join('、')}；魔法 ${p.mp ?? R.derived(p.attrs).mp}${p.mpMax ? '/' + p.mpMax : ''}` : '';
export const toItem = x => typeof x === 'string' ? (x.trim() && { name: x.trim() }) : x && x.name ? { name: String(x.name), ...(x.dmg ? { dmg: R.fitDmg(String(x.dmg)), skill: String(x.skill || '斗殴') } : +x.n > 0 ? { n: Math.round(+x.n) } : {}) } : null;
const cardText = c => `${c.name}（${c.age} 岁，${c.sex}，${c.job}，住在${c.home || '—'}）：${attrsText(c.attrs)}；技能：${topSkills(c.skills)}；背景：${BG.filter(([k]) => c.bg[k]).map(([k, n]) => `${n}：${c.bg[k]}`).join('；') || '—'}；消费水平 ${c.living || '—'}，现金 ${c.cash || '—'}，资产 ${c.assets || '—'}${bag(c)}${powers(c)}`;
const fromCard = c => { const d = R.derived(c.attrs); return { id: c.owner, card: c.id, name: c.name, job: c.job, attrs: c.attrs, skills: { ...c.skills }, hp: d.hp, hpMax: d.hp, san: d.san, sanMax: d.san, bg: c.bg, items: (c.items || []).map(x => ({ ...x })), abilities: (c.abilities || []).map(x => ({ ...x })), mp: d.mp, mpMax: d.mp }; };

const scText = s => { const sc = R.SCENARIOS.find(x => x.id === s.scenario);
  return sc ? `《${sc.title}》\n${sc.blurb}\n各幕：${sc.acts.map((a, i) => `${i + 1}. ${a.title}：${a.goal}（${a.place}）→ ${a.exit}`).join('；')}\n真相：${sc.secret}\n好结局：${sc.endings.good}\n坏结局：${sc.endings.bad}\n（骨架照这个写，可以润色）` : `随机生成一个本${s.ask ? `，要求：${s.ask}` : ''}`; };
/** 开局。setup = { mood, kp 'sys' | 联系人 id, lang { 谁: 语言 }, voice 语音怎么合成, scenario 内置本 id | 'random', ask 自己写的要求, me 你的卡, party 上桌角色的卡[], meet 这桌的团公告（或车卡会）, note 车卡前补充的话 } */
export async function start(setup) {
  const sc = R.SCENARIOS.find(s => s.id === setup.scenario), party = setup.party.map(c => ({ ...c, ...((setup.meet || {}).adjust || {})[c.owner] }));   // 车卡会上为了合规矩改的，只管这一局
  const g = { id: uid('ig'), at: Date.now(), mood: setup.mood, run: setup.run === 'free' ? 'free' : 'script', kp: setup.kp || 'sys', lang: setup.lang || {}, voice: setup.voice || 'tap', speak: !!setup.speak, crit: state.apps.interlude.crit,
    act: 0, round: 0, roundIn: 0, log: [], req: { type: 'free' }, pc: fromCard(setup.me), party: party.map(fromCard), rel: relsFrom([setup.me, ...party]), npcs: [] };
  const story = storyText(), mem = await memoryText([g.kp, ...party.map(c => c.owner)], story);
  const out = await ask('intStart', {
    kp: kpText(g), know: knowText(), mood: R.MOOD_TEXT[g.mood], story: story || '（正文里还没发生什么）', memory: mem && `\n【记着的事】（世界书、念念铃）\n${mem}\n`,
    pc: '你：' + cardText(setup.me), cast: party.map(c => `${ownerName(c.owner)} 扮演 ${cardText(c)}；${speakLine(g, c.owner)}`).join('\n') + (setup.note ? `\n（车卡前玩家补充过：${setup.note}）` : ''),
    scenario: scText(setup), places: placesText(), rels: relsText(g), run: g.run === 'script' ? RUN : '',
    meet: setup.meet ? `【团公告】开局前 KP 发过团公告${setup.meet.lines ? '，大家还一起开了车卡会' : ''}：\n${noticeText(setup.meet)}\n（这局要和公告对得上）\n` : '',
  }, g);
  const segs = Array.isArray(out.segs) ? out.segs.filter(x => x && x.request && x.out) : [];
  if (!Array.isArray(out.acts) || !out.acts.length || g.run === 'script' && !segs.length) throw new Error('AI 回的格式不对');
  g.title = String(out.title || (sc ? sc.title : '无题')).trim(); g.intro = String(out.intro || '').trim();
  g.sk = { acts: out.acts.slice(0, 5).map(a => ({ title: a.title || '', goal: a.goal || '', place: R.placeOf(a.place), exit: a.exit || '', checks: Array.isArray(a.checks) ? a.checks.slice(0, 3) : [], foes: Array.isArray(a.foes) ? a.foes.slice(0, 6) : [] })), secret: out.secret || '', endings: out.endings || {}, segs };
  g.place = g.sk.acts[0].place; g.seg = 0;
  // 开场白后面接着演第一回合，演到第一次要掷骰（和骨架一起写，开局只找一次 AI）；没写就只有开场白，进去点「推进」
  const o = segs[0] || out, open = linesOf(g, o); g.log.push({ r: 0, who: 'KP', act: g.intro }, ...open); if (open.length) g.round = g.roundIn = 1;
  apply(g, o, open); setReq(g, o.request);
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
export const who = (g, n) => (n === '你' || n === g.pc.name ? g.pc : g.party.find(m => m.name === n || nameOf(contact(m.id)) === n || (contact(m.id) || {}).name === n)) || null;
/* ---------- 关系图：g.rel [{ a, b, ab a 眼里的 b, ba, r 哪回合变的 }]（名字是卡上的名字和 NPC 的名字），g.npcs [{ name, seen 最近哪回合出场, gone 死了 / 走了 }]
   开局时照各自卡上的认识谁（一边写了就算认识）；之后 AI 每回合报变化，只留现在的。重要 NPC 最多 6 个，满了拿下最久没出场的 ---------- */
const NPC_MAX = 6;
export const relsFrom = cards => { const L = [];
  for (const c of cards) for (const x of c.rels || []) { const d = cards.find(y => y.owner === x.o); if (!d) continue;
    const y = L.find(y => y.a === d.name && y.b === c.name); if (y) y.ba = x.text || '认识'; else L.push({ a: c.name, b: d.name, ab: x.text || '认识', ba: '' }); }
  return L; };
const relsText = g => [...g.rel.map(y => `${y.a} 和 ${y.b}：${y.a} 眼里的 ${y.b} 是「${y.ab || '没说'}」，${y.b} 眼里的 ${y.a} 是「${y.ba || '没说'}」`),
  ...g.npcs.filter(p => p.gone).map(p => `${p.name}：已经不在了`),
  ...[g.pc, ...g.party].filter(p => p.bg && p.bg.rel && !g.rel.some(y => y.a === p.name || y.b === p.name)).map(p => `${p.name} 卡上写的同伴：${p.bg.rel}`)].join('\n') || '（大家互不认识）';   // 旧卡写的是一段话
function applyRel(g, out, lines) {
  const L = g.rel, N = g.npcs, pcs = [g.pc, ...g.party].map(p => p.name), nm = n => (n = str(n)) === '你' ? g.pc.name : n;
  const npc = n => pcs.includes(n) ? null : N.find(x => x.name === n) || N[N.push({ name: n }) - 1];
  for (const x of Array.isArray(out.rel) ? out.rel : []) {
    let a = nm(x.a), b = nm(x.b), ab = str(x.ab), ba = str(x.ba); if (!a || !b || a === b) continue;
    let y = L.find(y => y.a === a && y.b === b || y.a === b && y.b === a);
    if (y && y.a !== a) [a, b, ab, ba] = [b, a, ba, ab];
    if (!ab && !ba) { if (y) L.splice(L.indexOf(y), 1); continue; }
    for (const n of [a, b]) { const p = npc(n); if (p) p.seen = g.round; }
    if (!y) L.push(y = { a, b, ab: '', ba: '' });
    Object.assign(y, { ab: ab || y.ab, ba: ba || y.ba, r: g.round });
  }
  for (const n of Array.isArray(out.gone) ? out.gone : []) { const p = N.find(x => x.name === str(n)); if (p) p.gone = true; }
  for (const l of lines) { const p = N.find(x => x.name === l.who); if (p) p.seen = g.round; }
  while (N.length > NPC_MAX) { const p = N.reduce((x, y) => y.seen < x.seen ? y : x); N.splice(N.indexOf(p), 1);
    for (let i = L.length; i--;) if (L[i].a === p.name || L[i].b === p.name) L.splice(i, 1); }
}
/** 一回合：input 是你做的事（已经带上骰子结果）。回来的 lines 记进 log，request 存到 g.req */
const str = v => String(v || '').trim();
// AI 写的一回合的台词（开局时开场白后面接着演的那回合也一样）
const linesOf = (g, out) => { const L = (out.lines || []).filter(l => l && (l.act || l.say || l.text)).map(l => ({ r: g.round + 1, who: str(l.who) || 'KP', act: str(l.act || (!l.say && l.text)), say: str(l.say), zh: str(l.zh), face: str(l.face), pose: str(l.pose), ...(l.ooc ? { ooc: true } : {}) })); L.forEach(splitSay); return L; };
export async function play(g, input) {
  const A = g.sk.acts, i = g.act, last = i >= A.length - 1, over = g.roundIn >= CAP - 1, sc = g.run === 'script', fought = g.fight;
  const out = await ask('intRound', {
    kp: kpText(g), know: knowText(), mood: R.MOOD_TEXT[g.mood], title: g.title, secret: g.sk.secret, acts: A.map((a, k) => `${k + 1}. ${a.title}：${a.goal} → ${a.exit}`).join('\n'),
    actNo: i + 1, act: A[i].title, goal: A[i].goal, exit: A[i].exit, left: Math.max(0, CAP - g.roundIn),
    checks: (A[i].checks || []).map(c => `- ${c.when}（${c.skill}）：${GRADES.map(k => `${k}：${c[k] || '—'}`).join('；')}`).join('\n') || '（这幕没有，照上面的分寸）',
    foes: (A[i].foes || []).map(f => `- ${JSON.stringify(f)}`).join('\n') || '（这幕没定，真要打起来照上面的分寸现定）',
    fight: g.fight ? `\n【正在战斗】第 ${g.fight.round} 轮打完了；敌人：${g.fight.foes.map(f => `${f.name} 血 ${f.hp}/${f.hpMax}`).join('、')}。战斗由手机一轮轮替所有人掷，玩家中途说话时才把这几轮的结果交给你：照结果把这几轮讲成一段（不要改伤害和血），再接玩家说的；战斗还会接着由手机打，不用再提 fight；敌人投降、逃走或者剧情要停下时写 fightEnd: true。\n` : '',
    must: sc ? `。${ASIDE}${g.req.reason ? `（大家眼下要做的：${g.req.reason}）` : ''}` : over ? (last ? '。这是最后一回合：必须在这回合收尾，给出结局（end）' : '。这是本幕最后一回合：必须在这回合达成出口，actDone 写 true') : '',
    pc: pcText(g), cast: castText(g), rels: relsText(g), places: Object.keys(R.PLACES).join(' / '),
    log: g.log.slice(-16).map(l => `${l.who}：${lineText(l)}`).join('\n') || '（刚开始）', input,
  }, g);
  const lines = linesOf(g, out);
  if (!lines.length) throw new Error('AI 回的格式不对');
  g.round++; g.roundIn++; g.log.push({ r: g.round, who: myName(), text: input, me: true }, ...lines);
  if (sc) { const keep = g.req; delete out.end; apply(g, out, lines);
    if (fought && out.fightEnd) { g.fight = null; g.fought = '普通成功'; }   // 打到一半对方投降、逃了
    if (g.fought) { lines.push(...step(g, g.fought, '你')); delete g.fought; } else g.req = keep;
    await save(); return lines; }
  apply(g, out, lines);
  if (out.actDone && !last) nextAct(g);
  g.req = out.request && out.request.type ? out.request : { type: 'free' };
  if (g.req.type === 'fight') { joinFight(g, g.req.foes); g.req = { type: 'free' }; }
  if (out.fightEnd || g.fight && !g.fight.foes.some(f => f.hp > 0)) g.fight = null;
  await save();
  return lines;
}
/** 一回合（或剧本里的一段）对局面的影响：关系、换地方、受伤、东西、结局 */
function apply(g, out, lines) {
  applyRel(g, out, lines);
  if (out.place && out.place in R.PLACES) g.place = out.place;
  if (out.bgm) g.bgm = str(out.bgm); if (out.amb) g.amb = str(out.amb);
  for (const h of out.hurt || []) { const p = who(g, h.who); if (!p) continue; if (Number.isFinite(+h.hp)) p.hp = Math.max(0, Math.min(p.hpMax, p.hp + Math.round(+h.hp)));
    if (+h.san > 0) p.san = Math.min(p.sanMax, p.san + Math.min(3, Math.round(+h.san))); }   // 精神分析治好回 1～3 理智（规则书 1D3）
  for (const p of [g.pc, ...g.party]) if (p.mad && --p.mad.left <= 0) p.mad = null;
  for (const x of Array.isArray(out.items) ? out.items : []) { const p = who(g, x.who) || g.pc, L = p.items || (p.items = []);
    const find = s => L.findIndex(y => y.name.includes(String(s)) || String(s).includes(y.name));
    if (x.drop) { const k = find(x.drop); if (k >= 0) L.splice(k, 1); }
    if (x.use) { const k = find(x.use); if (k >= 0 && L[k].n && !--L[k].n) L.splice(k, 1); }   // 有次数的用一次少一次，用完就没了；没写次数的一直能用
    const n = toItem(typeof x.add === 'string' ? { name: x.add.trim(), n: x.n } : x.add); if (n) L.push(n); }
  if (out.end && out.end.text) { g.done = { kind: out.end.kind === 'good' ? 'good' : 'bad', text: String(out.end.text), grow: out.end.grow, bg: out.end.bg, lost: (Array.isArray(out.end.lost) ? out.end.lost : []).map(nm => nm === '你' ? g.pc.name : str(nm)), wrap: true, at: Date.now() }; g.req = { type: 'free' }; }
}
const nextAct = g => { g.act++; g.roundIn = 0; g.place = g.sk.acts[g.act].place; for (const p of [g.pc, ...g.party]) if (p.mpMax) p.mp = Math.min(p.mpMax, p.mp + Math.ceil(p.mpMax / 2)); };   // 每过一幕回一半魔法（作者定的）
const setReq = (g, q) => { g.req = q && q.type ? q : { type: 'free' }; if (g.req.type === 'fight') { joinFight(g, g.req.foes); g.req = { type: 'free' }; } };
/* ---------- 剧本模式（作者定的）：开局那次就把整局一段段写好，每段演到要掷骰，六种结果各接一段；掷完手机直接放写好的，不找 AI。
   失败也往下走；一起掷的有人成功就用成功那档（{谁} 换成掷成功的人）；自己打字才找一次 AI，接住你这一下再回到剧本 ---------- */
const RUN = `【剧本模式】这局不是每回合现编：你现在就把整局的戏一段一段写好（segs），玩家掷骰后手机直接照结果放你写好的那段。
- segs 按顺序，整局 6～10 段，每幕 1～3 段；act 写这段在第几幕（从 1 起）；place 换地方才写（地点代号）。开场白之后的第一段就是 segs[0]，最外层的 lines、request 和 acts 里的 checks 都不用写。
- 每段：lines 演到要掷骰的地方（KP 叙述 + 上桌角色说的话或做的事，每段一两句，不超过 6 段，写法同上）；request 写这次检定（check / san / opposed / fight，格式同上）；out 写六种结果各自接下来的戏：大成功、极难成功、困难成功、普通成功、失败、大失败，每种 lines 写 1～4 段（掷骰的人怎样、同伴什么反应），有人受伤写 hurt，捡到、用掉东西写 items，关系变了写 rel。理智检定、对抗、打斗只写「普通成功」和「失败」（打斗的普通成功是打赢了，失败是逃了或打输了）。
- 不管成功失败，戏都往下一段走：失败是代价更大、拿到的更少（受伤、掉理智、晚一步、被人发现），关键线索换条更难的路还在；大失败要当场出事。
- 好几个人一起掷（who 写了好几个）：有人成功就用成功那档，写成对掷成功的那个人说，用 {谁} 代替他的名字；都失败才用失败那档。
- 最后一段的每种结果都写 end：{"kind":"good / bad","text":"结局","lost":["下落不明的调查员名字"]}，成功的往好结局走、失败的往坏结局走；中间真把人弄没了也可以提前写 end。
- 在上面的 JSON 里加上："segs":[{"act":1,"place":"","lines":[{"who":"KP","act":"","say":""}],"request":{"type":"check","who":["你"],"skill":"侦查","level":"普通","reason":""},"out":{"大成功":{"lines":[],"hurt":[],"items":[],"rel":[]},"极难成功":{"lines":[]},"困难成功":{"lines":[]},"普通成功":{"lines":[]},"失败":{"lines":[]},"大失败":{"lines":[]}}}]
`;
const ASIDE = '这局是剧本模式，后面的戏已经写好了：这回合只接住玩家这一下（回应、对话、小动作），不要推进到下一个检定、不要揭开后面的线索；request 写 free，不写 actDone 和 end';
const BEST = ['大成功', '极难成功', '困难成功', '普通成功', '成功', '赢了', '失败', '输了', '大失败'];
const OUTS = { 大成功: ['大成功', '极难成功', '困难成功', '普通成功'], 极难成功: ['极难成功', '困难成功', '普通成功', '大成功'], 困难成功: ['困难成功', '普通成功', '极难成功'], 普通成功: ['普通成功', '困难成功', '极难成功'], 失败: ['失败', '大失败'], 大失败: ['大失败', '失败'] };
/** 这次掷骰（rolls [[谁, 掷出的档]]）里最好的那个：剧本照它往下放 */
export const best = rolls => rolls.reduce((a, b) => BEST.indexOf(b[1]) < BEST.indexOf(a[1]) ? b : a);
/** 剧本往下走一段：放这一段 v 那档写好的，再接下一段演到要掷骰；没有下一段又没写结局就照骨架的好 / 坏结局收尾 */
export function step(g, v, name) {
  const s = g.sk.segs[g.seg], k = { 成功: '普通成功', 赢了: '普通成功', 输了: '失败' }[v] || v, o = (OUTS[k] || OUTS.失败).map(x => s.out[x]).find(Boolean) || {};
  const sub = t => str(t).replaceAll('{谁}', name || '你');
  const L = linesOf(g, { lines: (o.lines || []).map(l => l && { ...l, act: sub(l.act), say: sub(l.say), zh: sub(l.zh) }) });
  apply(g, o, L);
  const nx = !g.done && g.sk.segs[++g.seg];
  if (nx) { const N = linesOf(g, nx); while (+nx.act - 1 > g.act && g.act < g.sk.acts.length - 1) nextAct(g); apply(g, nx, N); L.push(...N); setReq(g, nx.request); }
  else if (!g.done) { const kd = BEST.indexOf(k) < 6 ? 'good' : 'bad'; apply(g, { end: { kind: kd, text: (g.sk.endings || {})[kd] || '——' } }, L); }
  g.round++; g.roundIn++; g.log.push(...L);
  return L;
}
/** 复盘会（作者定的：每局落幕后都开，所有模式都有）：一次 API 写完——大家回到桌边聊结局、KP 揭底、聊着聊着放每个人的个人结局（lines 里 { end: 卡上的名字 }）、
 *  后日谈的信、黑匣子（最后一句）。存在 g.review = { lines, ends: { 名字: { title, text } }, box, done 看完了没有 } */
export async function review(g) {
  const ps = [g.pc, ...g.party], names = ps.map(p => p.name);
  const out = await ask('intReview', { kp: kpText(g), mood: R.MOOD_TEXT[g.mood], title: g.title, ending: `${g.done.kind === 'good' ? '好结局' : '坏结局'}：${g.done.text}`, secret: g.sk.secret,
    acts: g.sk.acts.map((a, k) => `${k + 1}. ${a.title}：${a.goal} → ${a.exit}${(a.checks || []).length ? `（关键检定：${a.checks.map(c => `${c.when}掷${c.skill}`).join('；')}）` : ''}`).join('\n'),
    players: ps.map(p => `${p === g.pc ? '你' : realName(p.id)}（扮演 ${p.name}）${p === g.pc ? '' : '；' + speakLine(g, p.id)}`).join('\n'),
    pc: pcText(g), cast: castText(g), rels: relsText(g), log: g.log.map(l => `${l.who}：${lineText(l)}`).join('\n') }, g);
  const ends = {};
  for (const [k, v] of Object.entries(out.ends || {})) { const n = names.find(x => x === k) || (k === '你' && g.pc.name); if (n && v && v.text) ends[n] = { title: str(v.title), text: str(v.text) }; }
  const L = (Array.isArray(out.lines) ? out.lines : []).map(l => l && l.end ? (n => ends[n] && { who: 'KP', end: n })(str(l.end) === '你' ? g.pc.name : str(l.end))
    : l && (l.act || l.say) && { who: str(l.who) || 'KP', act: str(l.act), say: str(l.say), zh: str(l.zh), face: str(l.face), pose: str(l.pose) }).filter(Boolean);
  if (!L.length) throw new Error('AI 回的格式不对');
  const played = L.filter(l => l.end).map(l => l.end).filter((n, i, a) => a.indexOf(n) === i);
  const lines = L.filter((l, i) => !l.end || L.findIndex(x => x.end === l.end) === i).concat(Object.keys(ends).filter(n => !played.includes(n)).map(n => ({ who: 'KP', end: n })));   // 没放到的补在最后
  if (str(out.box)) lines.push({ who: 'KP', box: true, act: str(out.box) });
  g.review = { lines, ends, box: str(out.box) }; g.done.letters = out.letters || {};
  await save(); return g.review;
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
    const add = (g.done.bg || {})[p.name] || {};   // 这局在背景上留下的：接在原来的后面
    for (const [k] of BG) if (add[k]) c.bg[k] = [c.bg[k], String(add[k])].filter(Boolean).join('；');
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
/** 孤注一掷（照规则书）：普通检定失败了，换个做法（how）再掷一次，难度和奖惩骰照旧；再失败就算大失败（国内跑团的做法，作者定的）。
 *  战斗、理智、对抗不能孤注一掷；大失败也不能（已经出事了） */
export const canPush = (req, res) => req.type === 'check' && res.v === '失败';
export function push(g, req, how) {
  const res = resolve(g, req);
  if (!res.r.ok) res.v = '大失败';
  res.text = `孤注一掷（${how}）：${res.text}${res.r.ok ? '' : '，孤注一掷失败，算大失败'}`;
  return res;
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
  if (over) { g.fight = null; if (g.run === 'script') g.fought = F.foes.some(up) ? '失败' : '普通成功'; }   // 剧本：打完照输赢往下放
  return { lines: over ? [...out, over] : out, ev: over ? [...ev, null] : ev, text: `【战斗第 ${F.round} 轮】${out.join('；')}。${over || '还在打'}`, over, mine, cap };
}
