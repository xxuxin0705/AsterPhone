// 主题和皮肤：
// 主题 = 一套颜色（改 CSS 变量），一次只用一个；
// 皮肤 = 用户自己写 / 导入的 CSS，可以同时开好几个，可以只对某个 App 生效；
// 皮肤里还能用 /* @texts {"chat.tab.moments":"朋友圈"} */ 改界面上的字。
import { state, commit } from './store.js';

const V = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join('');
// 每套主题只给三个颜色（底色、字色、强调色），日夜各一组；别的颜色 base.css 里从这三个算。冰雾浅蓝就是 base.css 的默认值。
export const THEMES = {
  aero: { name: '冰雾浅蓝', swatch: ['#f7fbfd', '#EAF5FA', '#4c7d9a'], day: {}, night: {} },
  mint: { name: '清透薄荷', swatch: ['#effdfb', '#D7FAF4', '#408279'], day: { 'as-color-bg': '#D7FAF4', 'as-color-text': '#29423f', 'as-color-accent': '#408279' }, night: { 'as-color-bg': '#1d2b29', 'as-color-text': '#e5fcf8', 'as-color-accent': '#a8e1d9' } },
  sakura: { name: '柔雾粉', swatch: ['#fef6f9', '#FCE9EF', '#af5572'], day: { 'as-color-bg': '#FCE9EF', 'as-color-text': '#422931', 'as-color-accent': '#af5572' }, night: { 'as-color-bg': '#2b1d21', 'as-color-text': '#fdf1f5', 'as-color-accent': '#e1a8ba' } },
  dusk: { name: '浅雾紫', swatch: ['#f6f2fc', '#E9DFF8', '#7a5dac'], day: { 'as-color-bg': '#E9DFF8', 'as-color-text': '#322942', 'as-color-accent': '#7a5dac' }, night: { 'as-color-bg': '#221d2b', 'as-color-text': '#f1eafa', 'as-color-accent': '#bda8e1' } },
  milk: { name: '奶黄浅色', swatch: ['#fffdeb', '#FFF9CC', '#967440'], day: { 'as-color-bg': '#FFF9CC', 'as-color-text': '#423829', 'as-color-accent': '#967440' }, night: { 'as-color-bg': '#2b281d', 'as-color-text': '#fffbde', 'as-color-accent': '#e1d3a8' } },
  leaf: { name: '柔叶浅绿', swatch: ['#f1f9f3', '#DCF1E0', '#4c7b58'], day: { 'as-color-bg': '#DCF1E0', 'as-color-text': '#29422f', 'as-color-accent': '#4c7b58' }, night: { 'as-color-bg': '#1d2b20', 'as-color-text': '#e8f6eb', 'as-color-accent': '#a8e1b6' } },
};
export const SCOPES = [['all', '全部'], ['lock', '锁屏'], ['home', '桌面'], ['chat', '聊天'], ['settings', '设置'], ['library', '资源库'], ['log', '日志']];

export const lib = () => (state.library = state.library || { theme: 'aero', skins: [] });
let trial = null;   // 正在试用的皮肤（还没保存）

function styleEl(id) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('style'); el.id = id; document.body.appendChild(el); }   // 放在最后，才能盖过自带样式
  return el;
}
const wrap = (sk) => sk.scope && sk.scope !== 'all' ? `@scope ([data-as-app="${sk.scope}"]) {\n${sk.css}\n}` : sk.css;

export function applySkins() {
  const L = lib(), t = THEMES[L.theme] || THEMES.aero;
  styleEl('as-theme').textContent = `.as-phone{${V(t.day)}}.as-phone[data-mode="night"]{${V(t.night)}}`;
  const on = L.skins.filter(s => s.on);
  if (trial) on.push(trial);
  styleEl('as-skins').textContent = on.map(s => `/* 皮肤：${s.name} */\n${wrap(s)}`).join('\n\n');
  applyTexts();
}
export function setTheme(key) { lib().theme = key; commit('library'); applySkins(); }
export function tryOn(sk) { trial = sk; applySkins(); }
export function endTrial() { trial = null; applySkins(); }

/* ---------- 改字：皮肤里的 @texts ---------- */
export function texts() {
  const map = {};
  const on = lib().skins.filter(s => s.on); if (trial) on.push(trial);
  for (const s of on) {
    const m = /@texts\s*(\{[\s\S]*?\})\s*\*\//.exec(s.css || '');
    if (m) try { Object.assign(map, JSON.parse(m[1])); } catch (e) { /* 写错了就忽略 */ }
  }
  return map;
}
export const textOf = (key, def) => texts()[key] ?? def;
export function applyTexts() {
  const map = texts();
  document.querySelectorAll('[data-as-text]').forEach(el => {
    const k = el.dataset.asText, target = el.querySelector('[data-as-label]') || el;
    if (!el.dataset.asDefault) el.dataset.asDefault = target.textContent;
    target.textContent = map[k] ?? el.dataset.asDefault;
  });
}
