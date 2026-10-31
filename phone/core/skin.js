// 主题和皮肤：
// 主题 = 一套颜色（改 CSS 变量），一次只用一个；
// 皮肤 = 用户自己写 / 导入的 CSS，可以同时开好几个，可以只对某个 App 生效；
// 皮肤里还能用 /* @texts {"chat.tab.moments":"朋友圈"} */ 改界面上的字。
import { state, commit } from './store.js';

const V = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join('');
export const THEMES = {
  aero: { name: '晴空玻璃', swatch: ['#d9f1ff', '#62b4e3', '#1289d6'], day: {}, night: {} },
  sakura: { name: '樱粉玻璃', swatch: ['#ffeef4', '#f7b6cd', '#e0608f'],
    day: { 'as-color-bg': '#f7d5e2', 'as-color-bg-grad': 'linear-gradient(175deg,#fff3f7 0%,#fbdbe7 40%,#f4bfd3 75%,#eaa3c0 100%)', 'as-color-surface-solid': '#fff6f9',
      'as-color-text': '#5a2440', 'as-color-text-2': 'rgba(90,36,64,.6)', 'as-color-border': 'rgba(90,36,64,.09)', 'as-color-accent': '#e0608f', 'as-color-accent-2': '#ffa8c8', 'as-color-aurora': 'rgba(255,214,140,.3)' },
    night: { 'as-color-bg': '#3a1830', 'as-color-bg-grad': 'linear-gradient(175deg,#5a2848 0%,#40203a 45%,#2c1428 100%)', 'as-color-surface-solid': '#4a2240',
      'as-color-text': '#ffeef5', 'as-color-text-2': 'rgba(255,238,245,.62)', 'as-color-accent': '#ff9cc2', 'as-color-accent-2': '#ffc6dc', 'as-color-on-accent': '#3a1830', 'as-color-aurora': 'rgba(255,180,120,.14)' } },
  mint: { name: '薄荷汽水', swatch: ['#e6fbf3', '#9fe2c8', '#1fa67a'],
    day: { 'as-color-bg': '#c8f0e2', 'as-color-bg-grad': 'linear-gradient(175deg,#effdf7 0%,#cdf3e4 40%,#a5e5cf 75%,#7fd3b9 100%)', 'as-color-surface-solid': '#f2fdf8',
      'as-color-text': '#0f4234', 'as-color-text-2': 'rgba(15,66,52,.6)', 'as-color-border': 'rgba(15,66,52,.09)', 'as-color-accent': '#1fa67a', 'as-color-accent-2': '#6fe0b7', 'as-color-aurora': 'rgba(120,200,255,.3)' },
    night: { 'as-color-bg': '#0f3a30', 'as-color-bg-grad': 'linear-gradient(175deg,#1a5245 0%,#123f35 45%,#0b2a24 100%)', 'as-color-surface-solid': '#164a3e',
      'as-color-text': '#e8fff6', 'as-color-text-2': 'rgba(232,255,246,.62)', 'as-color-accent': '#6fe0b7', 'as-color-accent-2': '#aef0d6', 'as-color-on-accent': '#0b2a24' } },
  dusk: { name: '暮色紫', swatch: ['#f1ecff', '#c3b4f2', '#7b61d6'],
    day: { 'as-color-bg': '#ddd3fa', 'as-color-bg-grad': 'linear-gradient(175deg,#f6f2ff 0%,#e1d8fb 40%,#c9b9f3 75%,#ae9ae9 100%)', 'as-color-surface-solid': '#f8f5ff',
      'as-color-text': '#2e2257', 'as-color-text-2': 'rgba(46,34,87,.6)', 'as-color-border': 'rgba(46,34,87,.09)', 'as-color-accent': '#7b61d6', 'as-color-accent-2': '#b8a6ff', 'as-color-aurora': 'rgba(255,180,220,.3)' },
    night: { 'as-color-bg': '#231a45', 'as-color-bg-grad': 'linear-gradient(175deg,#352863 0%,#261d4c 45%,#171133 100%)', 'as-color-surface-solid': '#2e2358',
      'as-color-text': '#f1ecff', 'as-color-text-2': 'rgba(241,236,255,.62)', 'as-color-accent': '#b8a6ff', 'as-color-accent-2': '#d8ccff', 'as-color-on-accent': '#171133' } },
  milk: { name: '奶白（初版）', swatch: ['#f6f3ee', '#efe6da', '#f2884b'],
    day: { 'as-color-bg': '#F6F3EE', 'as-color-bg-grad': 'linear-gradient(#F6F3EE,#F6F3EE)', 'as-color-surface': 'rgba(255,255,255,.92)', 'as-color-surface-2': '#EFEAE3', 'as-color-surface-solid': '#ffffff',
      'as-color-glass-line': 'rgba(30,28,26,.05)', 'as-color-gloss': 'rgba(255,255,255,0)', 'as-color-text': '#1E1C1A', 'as-color-text-2': '#7D776F', 'as-color-border': 'rgba(30,28,26,.08)',
      'as-color-accent': '#F2884B', 'as-color-accent-2': '#ffb27e', 'as-color-aurora': 'rgba(0,0,0,0)' },
    night: { 'as-color-bg': '#0F1013', 'as-color-bg-grad': 'linear-gradient(#0F1013,#0F1013)', 'as-color-surface': '#1A1B20', 'as-color-surface-2': '#25262C', 'as-color-surface-solid': '#1A1B20',
      'as-color-glass-line': 'rgba(255,255,255,.06)', 'as-color-gloss': 'rgba(255,255,255,0)', 'as-color-text': '#F3F3F5', 'as-color-text-2': '#9B9DA6',
      'as-color-accent': '#FF9A55', 'as-color-accent-2': '#ffb985', 'as-color-on-accent': '#1A0F08', 'as-color-aurora': 'rgba(0,0,0,0)' } },
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
