// 提示词：内置的只能看、能复制；自己新建 / 复制出来的才能改。
// 每个分类（私聊、群聊、发动态…）是一串「积木」，可以开关、排顺序；打开的从上到下拼起来发出去。
// 存在 state.promptSets：{ [分类]: { order: [块 id], off: { id: true } } }；自己的块在 state.customPrompts。
import { state, commit } from './store.js';
import { DEFAULT_PROMPTS, PROMPT_CATS, fill } from './prompts.js';
import { uid } from './util.js';
import { userName as tavernUser, userPersona as tavernPersona } from './bridge.js';

export { PROMPT_CATS, fill };
export const catInfo = id => PROMPT_CATS.flatMap(a => a.items).find(c => c.id === id);
const sets = () => state.promptSets || (state.promptSets = {});
const customs = () => state.customPrompts || (state.customPrompts = []);
const builtinIds = cat => Object.keys(DEFAULT_PROMPTS).filter(k => DEFAULT_PROMPTS[k].cats.includes(cat))
  .sort((a, b) => (DEFAULT_PROMPTS[b].main ? 1 : 0) - (DEFAULT_PROMPTS[a].main ? 1 : 0));
function setOf(cat) {
  const s = sets()[cat] || (sets()[cat] = { order: [], off: {} });
  const all = [...builtinIds(cat), ...customs().filter(c => c.cat === cat).map(c => c.id)];
  s.order = [...s.order.filter(id => all.includes(id)), ...all.filter(id => !s.order.includes(id))];
  return s;
}

/** 这一类的所有块，按顺序：{ id, name, text, on, builtin } */
export function blocksIn(cat) {
  const s = setOf(cat);
  return s.order.map(id => {
    const d = DEFAULT_PROMPTS[id], c = !d && customs().find(x => x.id === id);
    return { id, name: d ? d.name : c.name, text: d ? d.text : c.text, builtin: !!d, on: !s.off[id] };
  });
}
export const blockOn = (cat, id) => !setOf(cat).off[id];
export function setOn(cat, id, on) { const s = setOf(cat); if (on) delete s.off[id]; else s.off[id] = true; commit('prompts'); }
export function moveBlock(cat, id, to) { const s = setOf(cat); s.order.splice(s.order.indexOf(id), 1); s.order.splice(to, 0, id); commit('prompts'); }

/** 复制一块：新块放在原块下面并打开，原来那块关掉（等于用自己的版本替换它） */
export function copyBlock(cat, id) {
  const src = blocksIn(cat).find(b => b.id === id), nb = { id: uid('p_'), cat, name: src.name + ' 副本', text: src.text };
  customs().push(nb);
  const s = setOf(cat); s.order.splice(s.order.indexOf(nb.id), 1); s.order.splice(s.order.indexOf(id) + 1, 0, nb.id);
  s.off[id] = true; commit('prompts');
  return nb.id;
}
export function newBlock(cat) { const nb = { id: uid('p_'), cat, name: '新提示词', text: '' }; customs().push(nb); setOf(cat); commit('prompts'); return nb.id; }
export function saveBlock(id, patch) { Object.assign(customs().find(c => c.id === id), patch); commit('prompts'); }
export function removeBlock(id) { state.customPrompts = customs().filter(c => c.id !== id); commit('prompts'); }

const baseVars = () => ({ user: myName(), tag: state.timeTagName || 'astertime' });
/** 把这一类打开的块拼起来 */
export function compose(cat, vars = {}) {
  return blocksIn(cat).filter(b => b.on).map(b => fill(b.text, { ...baseVars(), ...vars }).trim()).filter(Boolean).join('\n\n');
}
/** 单独一块（填好变量），给界面预览用 */
export const fillBlock = (text, vars = {}) => fill(text, { ...baseVars(), ...vars });

/** 旧版：改过的内置提示词变成自己的副本，关掉的照旧关着 */
export function migratePrompts() {
  if (state.promptsV === 2) return;
  const old = { ...(state.prompts || {}), ...((state.apps && state.apps.chat && state.apps.chat.prompts) || {}) };
  for (const [key, o] of Object.entries(old)) {
    const d = DEFAULT_PROMPTS[key]; if (!d || !o) continue;
    for (const cat of d.cats) {
      if (o.text != null && o.text !== d.text) { const id = copyBlock(cat, key); saveBlock(id, { name: d.name + '（我改过的）', text: o.text }); if (o.on === false) setOn(cat, id, false); }
      else if (o.on === false) setOn(cat, key, false);
    }
  }
  state.promptsV = 2; commit('prompts');
}

/** 我在手机里的名字和人设：没改过就跟随酒馆 */
export const myName = () => state.me.realName || tavernUser() || '我';
export const myNick = () => state.me.nick || myName();
export const myPersona = () => (state.me.persona == null ? tavernPersona() : state.me.persona) || '';
