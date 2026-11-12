// 主题和皮肤：
// 主题 = 一套颜色（改 CSS 变量），一次只用一个；
// 皮肤 = 用户自己写 / 导入的 CSS，可以同时开好几个，可以只对某个 App 生效；
// 皮肤里还能用 /* @texts {"chat.tab.moments":"朋友圈"} */ 改界面上的字。
import { state, commit } from './store.js';

const V = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join('');
// 两套：水中月（base.css 的默认值）和苹果（照 iPhone 设置：浅灰底白卡片 / 夜间清透黑）；换主题时锁屏和桌面壁纸一起换成 wall
export const THEMES = {
  aero: { name: '水中月', wall: 'water', swatch: ['#f4f9fc', '#bcd8e6', '#3a7aa3'], day: {}, night: {} },
  apple: { name: '苹果', wall: 'apple', swatch: ['#ffffff', '#F2F2F7', '#007AFF'],
    day: { 'as-color-bg': '#F2F2F7', 'as-color-bg-grad': 'none', 'as-color-surface': '#fff', 'as-color-surface-2': 'rgba(118,118,128,.12)', 'as-color-surface-solid': '#fff', 'as-color-glass-line': 'transparent',
      'as-color-text': '#000', 'as-color-text-2': 'rgba(60,60,67,.6)', 'as-color-border': 'rgba(60,60,67,.18)', 'as-color-accent': '#007AFF', 'as-shadow': 'none' },
    night: { 'as-color-bg': '#0b0b0d', 'as-color-bg-grad': 'none', 'as-color-surface': 'rgba(44,44,48,.62)', 'as-color-surface-2': 'rgba(118,118,128,.24)', 'as-color-surface-solid': '#1c1c1e', 'as-color-glass-line': 'rgba(255,255,255,.08)',
      'as-color-text': '#fff', 'as-color-text-2': 'rgba(235,235,245,.6)', 'as-color-border': 'rgba(84,84,88,.45)', 'as-color-accent': '#0A84FF', 'as-color-on-accent': '#fff' } },
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
