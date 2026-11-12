// 个性装扮：头像框、气泡。存在资源库「个性装扮」里，每个人各选一个：联系人存在 c.frame / c.bubble，我存在 state.me.frame / bubble
import { state, commit } from './store.js';
import { uid } from './util.js';

export const deco = () => (state.deco = state.deco || { frames: [], bubbles: [] });
const find = (k, id) => id && deco()[k].find(x => x.id === id);

/** 头像套上框：框图放在头像外面一圈（::after），没选或框被删了就什么都不加 */
export function addFrame(ava, id) {
  const f = find('frames', id); if (!f) return ava;
  ava.classList.add('has-frame'); ava.style.setProperty('--frame', `url("${f.src}")`);
  return ava;
}
/** 气泡：颜色、圆角、描边写进这一个气泡；有图就用九宫格拉伸（四个角不变形）。b 是编号，编辑时预览也可以直接传气泡本身 */
export function paintBubble(el, b) {
  if (typeof b === 'string') b = find('bubbles', b); if (!b) return el;
  el.classList.add('has-deco');
  const set = (k, v) => v != null && v !== '' && el.style.setProperty(k, v);
  set('--deco-bg', b.bg); set('--deco-ink', b.ink); set('--deco-line', b.line); set('--deco-r', b.radius != null ? b.radius + 'px' : null);
  if (b.img) { el.classList.add('has-deco-img'); el.style.setProperty('--deco-img', `url("${b.img}")`); }
  return el;
}

/** 导出 / 导入：一个 .json，里面是图片和颜色，发给别人直接导 */
export function pack(kind, list) { return { asterphone: kind, v: 1, items: list.map(({ id, ...x }) => x) }; }
export function unpack(kind, d) {
  if (!d || d.asterphone !== kind || !Array.isArray(d.items)) return 0;
  const key = kind === 'frames' ? 'frames' : 'bubbles';
  const ok = d.items.filter(x => x && typeof x.name === 'string' && (key === 'frames' ? /^data:image\//.test(x.src || '') : true))
    .map(x => ({ ...x, name: x.name.slice(0, 20), id: uid(key[0]) }));
  deco()[key].push(...ok); commit('deco');
  return ok.length;
}

/** 给一个人选头像框 / 气泡：返回编号，'none' 是不戴，null 是没选（取消） */
export async function pickDeco(k, cur) {
  const { actionSheet, toast } = await import('./ui.js');
  const name = k === 'frames' ? '头像框' : '气泡', list = deco()[k];
  if (!list.length) { toast(`还没有${name}，去「资源库 → 个性装扮」添加`); return null; }
  return actionSheet(name, [{ value: 'none', label: '不戴', active: !cur }, ...list.map(x => ({ value: x.id, label: x.name, active: x.id === cur }))]);
}
export const decoName = (k, id) => find(k, id)?.name || '';
