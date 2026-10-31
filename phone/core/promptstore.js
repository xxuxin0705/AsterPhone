// 提示词的读写：通用（全局 + 暗号）存在 state.prompts，聊天 App 的存在 state.apps.chat.prompts。
// 没改过就用默认值；「恢复默认」= 删掉改过的那份。
import { state, commit } from './store.js';
import { DEFAULT_PROMPTS, fill } from './prompts.js';
import { userName as tavernUser, userPersona as tavernPersona } from './bridge.js';

const bag = key => (DEFAULT_PROMPTS[key] && DEFAULT_PROMPTS[key].group === 'chat') ? state.apps.chat.prompts : state.prompts;
export function getPrompt(key) {
  const d = DEFAULT_PROMPTS[key]; if (!d) return null;
  const o = bag(key)[key] || {};
  return { key, ...d, text: o.text ?? d.text, on: o.on ?? d.on, changed: o.text != null && o.text !== d.text };
}
export function setPrompt(key, patch) { const b = bag(key); b[key] = { ...(b[key] || {}), ...patch }; commit('prompts'); }
export function resetPrompt(key) { const b = bag(key); if (b[key]) { delete b[key].text; } commit('prompts'); }
export const promptsIn = group => Object.keys(DEFAULT_PROMPTS).filter(k => DEFAULT_PROMPTS[k].group === group).map(getPrompt);

/** 每次请求都带的「全局」部分 */
export function globalSystem() { return promptsIn('global').filter(p => p.on).map(p => p.text).join('\n'); }

/** 我在手机里的名字和人设：没改过就跟随酒馆 */
export const myName = () => state.me.realName || tavernUser() || '我';
export const myNick = () => state.me.nick || myName();
export const myPersona = () => (state.me.persona == null ? tavernPersona() : state.me.persona) || '';

export function render(key, vars) {
  const p = getPrompt(key);
  return fill(p.text, { user: myName(), tag: state.timeTagName || 'astertime', ...vars });
}
export { fill };
