// 提示词：每一类（私聊、群聊、发动态…）有一套内置的「默认方案」，只能看；
// 复制方案 = 把整套复制成自己的，里面每一条都能改、删、新建、开关、排顺序；用哪套就发哪套。
// 存在 state.promptSchemes：{ [分类]: { cur: 方案 id（'' = 默认方案）, list: [{ id, name, blocks: [{ id, name, text, on }] }] } }
import { state, commit } from './store.js';
import { DEFAULT_PROMPTS, PROMPT_CATS, fill } from './prompts.js';
import { uid } from './util.js';
import { userName as tavernUser, userPersona as tavernPersona } from './bridge.js';

export { PROMPT_CATS, fill };
export const catInfo = id => PROMPT_CATS.flatMap(a => a.items).find(c => c.id === id);
const builtin = cat => Object.keys(DEFAULT_PROMPTS).filter(k => DEFAULT_PROMPTS[k].cats.includes(cat))
  .sort((a, b) => (DEFAULT_PROMPTS[b].main ? 1 : 0) - (DEFAULT_PROMPTS[a].main ? 1 : 0))
  .map(id => ({ id, name: DEFAULT_PROMPTS[id].name, text: DEFAULT_PROMPTS[id].text, on: true }));
const all = () => state.promptSchemes || (state.promptSchemes = {});
export const schemesOf = cat => all()[cat] || (all()[cat] = { cur: '', list: [] });
export const schemeOf = (cat, sid) => schemesOf(cat).list.find(s => s.id === sid) || null;
export const schemeName = (cat, sid = schemesOf(cat).cur) => sid ? schemeOf(cat, sid).name : '默认方案';

/** 这套方案的所有条，按顺序；默认方案给内置的 */
export const blocksIn = (cat, sid = schemesOf(cat).cur) => sid ? schemeOf(cat, sid).blocks : builtin(cat);

export function useScheme(cat, sid) { schemesOf(cat).cur = sid; commit('prompts'); }
/** 复制一套方案（默认的也行），复制出来的马上用上 */
export function copyScheme(cat, sid) {
  const S = schemesOf(cat), n = S.list.length + 1;
  const sc = { id: uid('ps_'), name: `我的方案 ${n}`, blocks: blocksIn(cat, sid).map(b => ({ id: uid('p_'), name: b.name, text: b.text, on: b.on })) };
  S.list.push(sc); S.cur = sc.id; commit('prompts');
  return sc.id;
}
export function renameScheme(cat, sid, name) { schemeOf(cat, sid).name = name; commit('prompts'); }
export function removeScheme(cat, sid) { const S = schemesOf(cat); S.list = S.list.filter(s => s.id !== sid); if (S.cur === sid) S.cur = ''; commit('prompts'); }

const bl = (cat, sid) => schemeOf(cat, sid).blocks;
export function setOn(cat, sid, id, on) { bl(cat, sid).find(b => b.id === id).on = on; commit('prompts'); }
export function moveBlock(cat, sid, id, to) { const l = bl(cat, sid), i = l.findIndex(b => b.id === id); l.splice(to, 0, ...l.splice(i, 1)); commit('prompts'); }
export function newBlock(cat, sid) { const b = { id: uid('p_'), name: '新提示词', text: '', on: true }; bl(cat, sid).push(b); commit('prompts'); return b.id; }
export function saveBlock(cat, sid, id, patch) { Object.assign(bl(cat, sid).find(b => b.id === id), patch); commit('prompts'); }
export function removeBlock(cat, sid, id) { schemeOf(cat, sid).blocks = bl(cat, sid).filter(b => b.id !== id); commit('prompts'); }

const baseVars = () => ({ user: myName(), tag: state.timeTagName || 'astertime' });
/** 把正在用的方案里打开的条拼起来 */
export function compose(cat, vars = {}) {
  return blocksIn(cat).filter(b => b.on).map(b => fill(b.text, { ...baseVars(), ...vars }).trim()).filter(Boolean).join('\n\n');
}

/** 旧版（改过的内置条、自己新建的条、关掉的、排过的顺序）：和默认不一样的分类，变成「我的方案 1」并用上 */
export function migratePrompts() {
  if (state.promptsV === 3) return;
  const sets = state.promptSets || {}, customs = state.customPrompts || [];
  const old = state.promptsV === 2 ? {} : { ...(state.prompts || {}), ...((state.apps && state.apps.chat && state.apps.chat.prompts) || {}) };
  for (const { id: cat } of PROMPT_CATS.flatMap(a => a.items)) {
    const base = builtin(cat), s = sets[cat] || { order: [], off: {} };
    const have = [...base, ...customs.filter(c => c.cat === cat)];
    const order = [...s.order.filter(id => have.some(b => b.id === id)), ...have.map(b => b.id).filter(id => !s.order.includes(id))];
    const blocks = order.map(id => { const b = have.find(x => x.id === id), o = old[id] || {}; return { id: uid('p_'), name: b.name, text: o.text != null ? o.text : b.text, on: !s.off[id] && o.on !== false }; });
    if (blocks.length === base.length && blocks.every((b, i) => b.name === base[i].name && b.text === base[i].text && b.on)) continue;
    const id = uid('ps_'); schemesOf(cat).list.push({ id, name: '我的方案 1', blocks }); schemesOf(cat).cur = id;
  }
  state.promptsV = 3; commit('prompts');
}

/** 我在手机里的名字和人设：没改过就跟随酒馆 */
export const myName = () => state.me.realName || tavernUser() || '我';
export const myNick = () => state.me.nick || myName();
export const myPersona = () => (state.me.persona == null ? tavernPersona() : state.me.persona) || '';
