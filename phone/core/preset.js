// 预设：拿酒馆里的（或导入的）对话补全预设，挑条目、改内容存成方案（改的只存在方案里，不动酒馆的预设）；全局用一个方案，每个应用也能用别的或不用。
// 发请求时（api.js 的 generate）：预设里「聊天记录」那条之前的放在我们的系统提示前面，之后的放在我们的要求前面，我们自己的格式、条数总在最后。
import { state, commit, kvGet, kvSet, kvDel } from './store.js';
import { uid } from './util.js';
import { ctx } from './bridge.js';

/** 设置页里列出来的应用，和它们发请求时报的名字 */
export const PRESET_APPS = [['聊天', ['聊天', '群聊', '主动消息', '动态', '通话', '好友验证']], ['论坛', ['论坛']], ['查手机', ['查手机']], ['音乐', ['乐评', '角色歌单']], ['电台', ['电台']], ['幕间', ['幕间']], ['日记', ['日记']]];
export const P = () => state.presets;
const mgr = () => { try { return ctx()?.getPresetManager?.('openai') || null; } catch (e) { return null; } };   // Tauri 那边可能没有：没有就只能用导入的

/** 酒馆里的对话补全预设名字；读不到是空的 */
export function tavernNames() {
  try { return (mgr()?.getAllPresets?.() || []).filter(n => typeof n === 'string' && n.trim() && !n.startsWith('--')); } catch (e) { return []; }
}
export const srcName = src => src?.startsWith('f:') ? (P().files.find(f => 'f:' + f.id === src) || {}).name || '（导入的已删除）' : (src || '').slice(2);

/* 预设文件 → 条目：照它自己的排序（有角色专用的先用角色的），在酒馆里关着的条目默认也关着；
   世界书、角色描述这些「占位条」我们自己会发，不要；只留「聊天记录」那条当分界 */
function extract(data) {
  if (!Array.isArray(data?.prompts)) return [];
  const groups = Array.isArray(data.prompt_order) ? data.prompt_order : [], cid = ctx()?.characterId;
  const g = groups.find(x => cid != null && String(x.character_id) === String(cid)) || groups.find(x => x.character_id === 100001) || groups.find(x => x.character_id === 100000) || groups[0];
  const order = Array.isArray(g?.order) ? g.order : null, at = new Map(order?.map((e, i) => [e.identifier, i])), on = new Map(order?.map(e => [e.identifier, e.enabled === true]));
  return data.prompts.filter(e => !e.forbid).map((e, i) => ({ id: e.identifier || 'p' + i, name: e.name || e.identifier || '条目 ' + (i + 1), content: String(e.content || ''), marker: !!e.marker,
    on: order ? on.get(e.identifier) === true : e.enabled !== false, i: at.has(e.identifier) ? at.get(e.identifier) : 10000 + i }))
    .filter(e => e.id === 'chatHistory' || (!e.marker && e.content.trim())).sort((a, b) => a.i - b.i).map(({ i, marker, ...e }) => e);
}
export async function entriesOf(src) {
  if (!src) return [];
  if (src.startsWith('f:')) return (await kvGet('preset:' + src.slice(2))) || [];
  try { return extract(mgr()?.getCompletionPresetByName?.(src.slice(2))); } catch (e) { return []; }
}
/** 方案里实际的条目：预设的 + 自己加的，照自己拖过的顺序（没拖过就照预设的） */
export async function listOf(plan) {
  const L = [...await entriesOf(plan.src), ...(plan.extra || []).map(x => ({ ...x, on: true, mine: true }))], O = plan.order;
  return O ? L.map((e, k) => [O.includes(e.id) ? O.indexOf(e.id) : 1e4 + k, e]).sort((a, b) => a[0] - b[0]).map(x => x[1]) : L;
}
/** 导入一个预设文件（.json），存在小手机里，两边酒馆都能用 */
export async function importFile(file) {
  let data; try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('这不是预设文件'); }
  const list = extract(data);
  if (!list.length) throw new Error('这个文件里没有预设条目');
  const f = { id: uid('pf_'), name: file.name.replace(/\.(json|settings)$/i, '') };
  await kvSet('preset:' + f.id, list); P().files.push(f); commit('presets');
  return f;
}
export async function removeFile(id) { await kvDel('preset:' + id); P().files = P().files.filter(f => f.id !== id); commit('presets'); }

/** 这个应用现在用哪个方案（应用自己选的 > 全局；选了「不用」就没有） */
export function planFor(app) {
  const g = PRESET_APPS.find(x => x[1].includes(app)), v = g && P().apps[g[0]];
  return !g || v === 'none' ? null : P().plans.find(x => x.id === (v || P().all)) || null;
}
// 只认这几个宏：{{user}} {{char}} {{random::a::b}} {{// 注释}} {{trim}}；别的照原样留着，不碰酒馆的变量
const mac = s => { const c = ctx() || {}; return s.replace(/\{\{\/\/[\s\S]*?\}\}|\{\{trim\}\}/gi, '').replace(/\{\{random::([^{}]*)\}\}/gi, (m, a) => { const o = a.split('::'); return o[Math.floor(Math.random() * o.length)]; })
  .replace(/\{\{(user|char)\}\}/gi, (m, k) => (k.toLowerCase() === 'user' ? c.name1 : c.name2) || m); };
/** 给一次请求带上预设：没方案就原样返回 */
export async function withPreset(opts) {
  const plan = P().plans.length && planFor(opts.app || '聊天');
  if (!plan) return opts;
  const list = (await listOf(plan)).filter(e => e.id === 'chatHistory' || (plan.on[e.id] ?? e.on));
  const cut = list.findIndex(e => e.id === 'chatHistory'), text = L => L.map(e => mac(plan.text?.[e.id] ?? e.content).trim()).filter(Boolean).join('\n\n');
  const pre = text(cut < 0 ? list : list.slice(0, cut)), post = cut < 0 ? '' : text(list.slice(cut + 1));
  return { ...opts, system: [pre, opts.system].filter(Boolean).join('\n\n'), prompt: [post, opts.prompt].filter(Boolean).join('\n\n'), keep: opts.keep && post ? opts.keep + post.length + 2 : opts.keep };
}
