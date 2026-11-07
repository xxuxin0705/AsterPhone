// 幕间 · 一局的数据和流程：开局一次 API 生成骨架和人物卡，之后每回合一次；骰子由手机掷（rules.js），AI 只收结果。
// 整局不进正文、不进记忆。局存在 kv 的 int:窗口 里；正在等 AI 的那一步放在模块里，退出页面再进来还是「取消」。
import { state, win, contact, kvGet, kvSet } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName } from '../../core/promptstore.js';
import { storyText } from '../../core/context.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { uid } from '../../core/util.js';
import * as R from './rules.js';

export const CAP = 8;   // 每幕最多几回合，到了 KP 必须推到出口
let D = null, Dkey = '';
export async function load() { if (D && Dkey === win.key) return D; Dkey = win.key; D = (await kvGet('int:' + win.key).catch(() => null)) || { games: [] }; return D; }
export const save = () => kvSet('int:' + Dkey, D);
export const current = () => D.games.find(g => !g.done) || null;
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
export const castText = g => g.party.map(m => `${m.name}（${m.job}）：血 ${m.hp}/${m.hpMax}，理智 ${m.san}/${m.sanMax}${m.mad ? `，临时疯狂·${m.mad.name}` : ''}；技能：${topSkills(m.skills)}；人设：${(personaOf(contact(m.id)) || '').slice(0, 300) || '（没有更多资料）'}`).join('\n') || '（没有别人，只有 KP 和你）';
const member = (c, a) => ({ id: c.id, name: nameOf(c), ...R.derived(a), hpMax: R.derived(a).hp, sanMax: a.POW, attrs: a });

/** 开局。setup = { token 意象, attrs 属性, name / job 自己填的（可空）, mood, scenario 内置本 id | 'random', ask 自己写的要求, party 联系人 id[] } */
export async function start(setup) {
  const sc = R.SCENARIOS.find(s => s.id === setup.scenario), tk = R.TOKENS.find(t => t[0] === setup.token);
  const party = setup.party.map(id => contact(id)).filter(Boolean).map(c => member(c, R.rollAttrs()));
  const g = { id: uid('ig'), at: Date.now(), mood: setup.mood, crit: state.apps.interlude.crit, token: setup.token, act: 0, round: 0, roundIn: 0, log: [], req: { type: 'free' }, party,
    pc: { name: setup.name || '', job: setup.job || '', attrs: setup.attrs, ...R.derived(setup.attrs), hpMax: R.derived(setup.attrs).hp, sanMax: setup.attrs.POW, skills: R.baseSkills(setup.attrs) } };
  const out = await ask('intStart', {
    mood: R.MOOD_TEXT[g.mood], story: storyText() || '（正文里还没发生什么）',
    cast: party.map(m => `${m.name}：${attrsText(m.attrs)}；人设：${(personaOf(contact(m.id)) || '').slice(0, 400) || '（没有更多资料）'}`).join('\n') || '（没有别人，只有你和 KP）',
    pc: `意象：${tk[1]}（偏向 ${tk[2]} 这类职业）；${attrsText(setup.attrs)}${setup.name ? `；名字已定：${setup.name}` : ''}${setup.job ? `；职业已定：${setup.job}` : ''}`,
    scenario: sc ? `《${sc.title}》\n${sc.blurb}\n各幕：${sc.acts.map((a, i) => `${i + 1}. ${a.title}：${a.goal}（${a.place}）→ ${a.exit}`).join('；')}\n真相：${sc.secret}\n好结局：${sc.endings.good}\n坏结局：${sc.endings.bad}\n（骨架照这个写，可以润色）` : `随机生成一个本${setup.ask ? `，要求：${setup.ask}` : ''}`,
    places: placesText(), skills: Object.entries(R.SKILLS).map(([k, v]) => `${k} ${v}`).join('、') + '、闪避（敏捷÷2）、母语（教育）',
  }, 4000, g);
  if (!Array.isArray(out.acts) || !out.acts.length || !out.pc) throw new Error('AI 回的格式不对');
  g.title = String(out.title || (sc ? sc.title : '无题')).trim(); g.intro = String(out.intro || '').trim();
  g.sk = { acts: out.acts.slice(0, 5).map(a => ({ title: a.title || '', goal: a.goal || '', place: R.placeOf(a.place), exit: a.exit || '' })), secret: out.secret || '', endings: out.endings || {} };
  Object.assign(g.pc, { name: setup.name || out.pc.name || '调查员', job: setup.job || out.pc.job || '', bg: out.pc.bg || '', skills: R.fixSkills(setup.attrs, out.pc.skills) });
  for (const m of party) { const x = (out.party || []).find(p => p.name === m.name) || {}; m.job = x.job || ''; m.skills = R.fixSkills(m.attrs, x.skills); }
  g.place = g.sk.acts[0].place; g.log.push({ r: 0, who: 'KP', text: g.intro });
  D.games.push(g); await save();
  return g;
}

const who = (g, n) => (n === '你' || n === g.pc.name ? g.pc : g.party.find(m => m.name === n)) || null;
/** 一回合：input 是你做的事（已经带上骰子结果）。回来的 lines 记进 log，request 存到 g.req */
export async function play(g, input) {
  const A = g.sk.acts, i = g.act, last = i >= A.length - 1, over = g.roundIn >= CAP - 1;
  const out = await ask('intRound', {
    mood: R.MOOD_TEXT[g.mood], title: g.title, secret: g.sk.secret, acts: A.map((a, k) => `${k + 1}. ${a.title}：${a.goal} → ${a.exit}`).join('\n'),
    actNo: i + 1, act: A[i].title, goal: A[i].goal, exit: A[i].exit, left: Math.max(0, CAP - g.roundIn),
    must: over ? (last ? '。这是最后一回合：必须在这回合收尾，给出结局（end）' : '。这是本幕最后一回合：必须在这回合达成出口，actDone 写 true') : '',
    pc: pcText(g), cast: castText(g), places: Object.keys(R.PLACES).join(' / '),
    log: g.log.slice(-16).map(l => `${l.who}：${l.text}`).join('\n') || '（刚开始）', input,
  }, 1800, g);
  const lines = (out.lines || []).filter(l => l && l.text).map(l => ({ r: g.round + 1, who: String(l.who || 'KP'), text: String(l.text) }));
  if (!lines.length) throw new Error('AI 回的格式不对');
  g.round++; g.roundIn++; g.log.push({ r: g.round, who: myName(), text: input, me: true }, ...lines);
  if (out.place && out.place in R.PLACES) g.place = out.place;
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

/** 检定的结果写成一句话给 KP（也给人看） */
export function resolve(g, req, { skill } = {}) {
  const p = who(g, req.who) || g.pc, name = p === g.pc ? '你' : p.name, sk = skill || req.skill || '侦查';
  if (req.type === 'san') {
    const r = R.sanCheck(p.san, req.loss, g.crit); p.san = Math.max(0, p.san - r.lost);
    if (r.lost >= 5 && !p.mad) p.mad = R.madness();
    return { r, text: `${name}的理智检定：掷出 ${r.v}（理智 ${r.need}），${r.ok ? '成功' : '失败'}，掉了 ${r.lost} 点${r.lost >= 5 ? `，临时疯狂：${p.mad.name}` : ''}${p.san <= 0 ? '，理智归零' : ''}`, lost: r.lost };
  }
  if (req.type === 'opposed') {
    const r = R.opposed(p.skills[sk] ?? R.SKILLS[sk] ?? 20, +req.vs || 50, g.crit);
    return { r: r.a, text: `${name}的${sk}对抗：掷出 ${r.a.v}（${r.a.grade}），对方掷出 ${r.b.v}（${r.b.grade}），${r.win ? '赢了' : '输了'}` };
  }
  const val = p.skills[sk] ?? R.SKILLS[sk] ?? 20, r = R.check(val, req.level, g.crit);
  return { r, text: `${name}的${sk}检定（${req.level || '普通'}）：掷出 ${r.v}，技能 ${val}，${r.grade}` };
}
