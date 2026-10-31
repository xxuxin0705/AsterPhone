// 锁屏时钟字体：默认用内置的 SF Pro Display Bold（base.css 里的 AsterClockBuiltin）；
// 用户也可以导入别的字体文件，存在这台设备的浏览器里（IndexedDB 键 font:clock），优先用导入的。
import { kvGet, kvSet, kvDel } from './store.js';

export const FAMILY = 'AsterClock';
let face = null, name = '';
export const clockFontName = () => name;

async function use(blob, n) {
  if (face) { try { document.fonts.delete(face); } catch (e) { /* 忽略 */ } face = null; }
  const f = new FontFace(FAMILY, await blob.arrayBuffer(), { weight: '100 900', style: 'normal' });
  await f.load();
  document.fonts.add(f); face = f; name = n;
  document.documentElement.classList.add('has-clock-font');
}
/** 启动时调用：有导入过的字体就装上 */
export async function loadClockFont() {
  try { const rec = await kvGet('font:clock'); if (rec && rec.blob) await use(rec.blob, rec.name || '自定义字体'); } catch (e) { console.warn('[AsterPhone] 时钟字体读取失败', e); }
  return name;
}
/** 导入字体文件（.otf / .ttf / .woff / .woff2） */
export async function importClockFont(file) {
  if (!file) return '';
  if (!/\.(otf|ttf|woff2?)$/i.test(file.name || '') && !/font/.test(file.type || '')) throw new Error('这不是字体文件（要 .otf / .ttf / .woff）');
  const n = (file.name || '字体').replace(/\.[^.]+$/, '');
  try { await use(file, n); } catch (e) { throw new Error('这个字体文件读不了'); }
  await kvSet('font:clock', { blob: file, name: n });
  return n;
}
export async function removeClockFont() {
  if (face) { try { document.fonts.delete(face); } catch (e) { /* 忽略 */ } face = null; }
  name = ''; document.documentElement.classList.remove('has-clock-font');
  await kvDel('font:clock').catch(() => {});
}
