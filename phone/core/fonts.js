// 字体库（资源库 → 字体）：导入的字体文件存在这台设备的浏览器里（IndexedDB 键 fonts:clock）。
// 锁屏时间（settings.clock.font = 'u:<id>'）和整个手机的字（settings.uiFont = 'u:<id>'）都从这里挑。
import { kvGet, kvSet, kvDel, state } from './store.js';

let list = [];                 // [{ id, name }]
const faces = new Map();
const family = id => 'AsterUser-' + id;
export const userFonts = () => list;
/** 有中文的那些：没中文的（比如苹果的 SF）只给锁屏时间用，写字的地方（整个手机、歌词、日记）不列出来。
 *  看法：用它画一个「永」，跟找不到字时退回去的字体画的一模一样，就是没有中文（结果记下来，只算一次） */
const han = new Map();
export const hanFonts = () => list.filter(x => {
  if (!han.has(x.id)) {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const draw = f => { c.clearRect(0, 0, 48, 48); c.font = `40px ${f}`; c.fillText('永', 4, 40); return c.getImageData(0, 0, 48, 48).data.join(); };
    han.set(x.id, draw(`"${family(x.id)}", serif`) !== draw('serif'));
  }
  return han.get(x.id);
});
/** 给 CSS 用的字体名：导入的都叫 custom，真正的字体由 --font-clock-user 决定 */
export const fontKey = f => (f || 'sf').startsWith('u:') ? 'custom' : f || 'sf';

async function install(id, blob) {
  const f = new FontFace(family(id), await blob.arrayBuffer(), { weight: '100 900', style: 'normal' });
  await f.load();
  document.fonts.add(f); faces.set(id, f);
}
const has = f => (f || '').startsWith('u:') && list.some(x => x.id === f.slice(2));
let baseUi = '';
/** 把选中的字体接到 CSS 变量上；选中的已经被删了就换回默认 */
export function applyFonts() {
  const s = state.settings, c = s.clock, root = document.documentElement.style;
  if ((c.font || '').startsWith('u:') && !has(c.font)) c.font = 'sf';
  if (s.uiFont && !has(s.uiFont)) s.uiFont = '';
  root.setProperty('--font-clock-user', c.font.startsWith('u:') ? `"${family(c.font.slice(2))}"` : '"AsterClockBuiltin"');
  if (!baseUi) baseUi = getComputedStyle(document.documentElement).getPropertyValue('--font-ui');
  if (s.uiFont) root.setProperty('--font-ui', `"${family(s.uiFont.slice(2))}", ${baseUi}`); else root.removeProperty('--font-ui');
}
export const fontName = f => has(f) ? list.find(x => x.id === f.slice(2)).name : '';
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
  applyFonts();
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
  applyFonts();
}
