// 锁屏时钟字体：内置三种（苹果粗体 / 纤细 / 优雅衬线）之外，可以导入好几个字体文件，
// 存在这台设备的浏览器里（IndexedDB 键 fonts:clock），选哪个用哪个。选中的记在 settings.clock.font = 'u:<id>'。
import { kvGet, kvSet, kvDel, state } from './store.js';

let list = [];                 // [{ id, name }]
const faces = new Map();
const family = id => 'AsterUser-' + id;
export const userFonts = () => list;
/** 给 CSS 用的字体名：导入的都叫 custom，真正的字体由 --font-clock-user 决定 */
export const fontKey = f => (f || 'sf').startsWith('u:') ? 'custom' : f || 'sf';

async function install(id, blob) {
  const f = new FontFace(family(id), await blob.arrayBuffer(), { weight: '100 900', style: 'normal' });
  await f.load();
  document.fonts.add(f); faces.set(id, f);
}
/** 把选中的导入字体接到 --font-clock-user 上；选中的已经被删了就换回苹果粗体 */
export function applyClockFont() {
  const c = state.settings.clock, f = c.font || 'sf';
  if (f.startsWith('u:') && !list.some(x => x.id === f.slice(2))) c.font = 'sf';
  document.documentElement.style.setProperty('--font-clock-user', c.font.startsWith('u:') ? `"${family(c.font.slice(2))}"` : '"AsterClockBuiltin"');
}
/** 启动时调用：装上所有导入过的字体（旧版只存一个，顺手搬过来，并且继续用它） */
export async function loadClockFonts() {
  const recs = (await kvGet('fonts:clock').catch(() => null)) || [];
  const old = await kvGet('font:clock').catch(() => null);
  if (old && old.blob) {
    const id = Date.now().toString(36);
    recs.push({ id, name: old.name || '自定义字体', blob: old.blob });
    await kvSet('fonts:clock', recs); await kvDel('font:clock');
    if ((state.settings.clock.font || 'sf') === 'sf') state.settings.clock.font = 'u:' + id;
  }
  list = [];
  for (const r of recs) {
    try { await install(r.id, r.blob); list.push({ id: r.id, name: r.name }); } catch (e) { console.warn('[AsterPhone] 时钟字体读取失败', r.name, e); }
  }
  applyClockFont();
  return list.length;
}
/** 导入字体文件（.otf / .ttf / .woff / .woff2），返回 { id, name } */
export async function importClockFont(file) {
  if (!/\.(otf|ttf|woff2?)$/i.test(file.name || '') && !/font/.test(file.type || '')) throw new Error('这不是字体文件（要 .otf / .ttf / .woff）');
  const id = Date.now().toString(36), name = (file.name || '字体').replace(/\.[^.]+$/, '');
  try { await install(id, file); } catch (e) { throw new Error('这个字体文件读不了'); }
  const recs = (await kvGet('fonts:clock').catch(() => null)) || [];
  recs.push({ id, name, blob: file });
  await kvSet('fonts:clock', recs);
  list.push({ id, name });
  return { id, name };
}
export async function removeClockFont(id) {
  const f = faces.get(id); if (f) document.fonts.delete(f);
  faces.delete(id); list = list.filter(x => x.id !== id);
  const recs = (await kvGet('fonts:clock').catch(() => null)) || [];
  await kvSet('fonts:clock', recs.filter(r => r.id !== id));
  applyClockFont();
}
