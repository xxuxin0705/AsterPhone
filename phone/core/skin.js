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
// 资源库「应用」里能美化的 App 和页面。皮肤的 scope：'all'（整部手机）、App 编号（data-as-app）或页面编号（data-as-page，带「-」的）
export const SKIN_APPS = [
  { id: 'chat', name: '聊天', icon: 'chat', pages: [['chat-messages', '聊天列表'], ['chat-contacts', '联系人'], ['chat-room', '聊天界面'], ['chat-moments', '动态'], ['chat-me', '我的主页']] },
  { id: 'music', name: '音乐', icon: 'music' }, { id: 'interlude', name: '幕间', icon: 'search' }, { id: 'memory', name: '岁岁砂', icon: 'hourglass' },
  { id: 'diary', name: '日记', icon: 'note' }, { id: 'street', name: '商业街', icon: 'shop' },
  { id: 'forum', name: '论坛', icon: 'comment', pages: [['forum-home', '首页'], ['forum-post', '帖子'], ['forum-user', '主页']] }, { id: 'mirror', name: '映像', icon: 'users' }, { id: 'settings', name: '设置', icon: 'gear' },
  { id: 'library', name: '资源库', icon: 'box' }, { id: 'log', name: '日志', icon: 'list' }, { id: 'home', name: '桌面', icon: 'grid' }, { id: 'lock', name: '锁屏', icon: 'lock' },
];
export function scopeName(sc) {
  if (!sc || sc === 'all') return '整部手机';
  for (const a of SKIN_APPS) { if (a.id === sc) return a.name; const pg = (a.pages || []).find(x => x[0] === sc); if (pg) return `${a.name} · ${pg[1]}`; }
  return sc;
}
export const appOfScope = sc => SKIN_APPS.find(a => a.id === sc || (a.pages || []).some(x => x[0] === sc));

export const lib = () => (state.library = state.library || { theme: 'aero', skins: [] });
/** 自己存的主题：{ id, name, base（用哪套自带的颜色）, walls: { lock, home }, css } */
export const userThemes = () => (lib().themes = lib().themes || []);
const userTheme = () => userThemes().find(x => x.id === lib().theme);
export const themeName = () => (userTheme() || THEMES[lib().theme] || THEMES.aero).name;
let trial = null;   // 正在试用的皮肤（还没保存）

function styleEl(id) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('style'); el.id = id; document.body.appendChild(el); }   // 放在最后，才能盖过自带样式
  return el;
}
/* 口子（变量）：皮肤里写了哪个，才生成它管的那一条，盖在所有样式上面（默认、微信 / QQ / LINE、日夜都一样）；没写的不生成，原样不动。
   每行：哪一页、变量名、说明、管哪些零件、改哪几项（空格隔开）。:not(#as-v) 只是为了压过原来的写法；单独戴了气泡装扮的人不受影响 */
const BUB = '.as-chat-bubble:not(.as-chat-pic, .as-chat-sticker, .as-chat-money, .as-chat-card, .as-chat-tg, .as-chat-loc, .as-chat-imgcard, .has-deco, .has-deco-img)';
export const VARS = [
  ['chat', 'chat-tabbar-bg', '底部标签栏底色', '.as-chat-tabbar', 'background'],
  ['chat-messages', 'chat-list-bg', '聊天列表的背景', '.as-page[data-as-page="chat-messages"]', 'background'],
  ['chat-messages', 'chat-item-bg', '聊天列表那张卡片的底', '.as-chat-convs', 'background'],
  ['chat-messages', 'chat-name-color', '名字的颜色', '.as-chat-conv__name', 'color'],
  ['chat-messages', 'chat-preview-color', '最后一句话和时间的颜色', '.as-chat-conv__text, .as-chat-conv__time', 'color'],
  ['chat-messages', 'chat-unread-bg', '未读数字的底色', '.as-chat-conv .as-badge, .as-chat-tab .as-badge', 'background'],
  ['chat-room', 'chat-bg', '聊天背景（颜色、渐变或图片）', '.as-chat-msgs:not(.has-bg)', 'background'],
  ['chat-room', 'chat-head-bg', '顶栏底色', '.as-chat-room > .as-navbar', 'background'],
  ['chat-room', 'chat-head-color', '顶栏的字和图标', '.as-chat-room > .as-navbar, .as-chat-room > .as-navbar :is(.as-navbar__back, .as-navbar__btn, .as-chat-room__name)', 'color'],
  ['chat-room', 'chat-me-bg', '我的气泡底色', '.as-chat-msg.is-me ' + BUB, 'background --k-out'],   // --k-out：微信 / LINE 气泡的小尖角
  ['chat-room', 'chat-me-color', '我的气泡字色', '.as-chat-msg.is-me ' + BUB, 'color'],
  ['chat-room', 'chat-them-bg', 'TA 的气泡底色', '.as-chat-msg.is-them ' + BUB, 'background --k-in'],
  ['chat-room', 'chat-them-color', 'TA 的气泡字色', '.as-chat-msg.is-them ' + BUB, 'color'],
  ['chat-room', 'chat-bubble-radius', '气泡圆角', '.as-chat-msg ' + BUB, 'border-radius'],
  ['chat-room', 'chat-bubble-border', '气泡描边', '.as-chat-msg ' + BUB, 'border'],
  ['chat-room', 'chat-bubble-shadow', '气泡阴影', '.as-chat-msg ' + BUB, 'box-shadow'],
  ['chat-room', 'chat-font-size', '聊天字号', '.as-chat-msg ' + BUB, 'font-size'],
  ['chat-room', 'chat-avatar-radius', '头像圆角（50% 是圆，4px 是方）', '.as-chat-msg__avatar, .as-chat-msg__avatar img', 'border-radius'],
  ['chat-room', 'chat-time-color', '时间和系统提示的字', '.as-chat-time, .as-chat-sys', 'color'],
  ['chat-room', 'chat-bar-bg', '输入栏底色', '.as-chat-inputwrap', 'background'],
  ['chat-room', 'chat-input-bg', '输入框底色', '.as-chat-input', 'background'],
  ['chat-room', 'chat-input-color', '输入框字色', '.as-chat-input', 'color'],
  ['chat-room', 'chat-send-bg', '发送按钮底色', '.as-chat-sendbtn:not(.is-idle, .is-loading)', 'background'],
];
const varRules = css => { css = css.replace(/\/\*[\s\S]*?\*\//g, ''); return VARS.filter(v => new RegExp(`--as-${v[1]}\\s*:`).test(css)).map(([, k, , sel, p]) => `:is(${sel}):not(#as-v) { ${p.split(' ').map(q => `${q}: var(--as-${k}) !important;`).join(' ')} }`).join('\n'); };   // 注释里的不算
// :root 换成皮肤管的那一块（整部手机就是 .as-phone）；夜间写 :root[data-mode="night"]
const rooted = (css, scoped) => css.replace(/:root(\[data-mode="?(?:night|day)"?\])?/g, (m, a = '') => scoped ? (a ? `.as-phone${a} :scope` : ':scope') : '.as-phone' + a);
const wrap = (sk) => {
  const scoped = sk.scope && sk.scope !== 'all', css = rooted(sk.css, scoped) + '\n' + varRules(sk.css);
  return scoped ? `@scope ([data-as-${sk.scope.includes('-') ? 'page' : 'app'}="${sk.scope}"]) {\n${css}\n}` : css;
};

export function applySkins() {
  const L = lib(), u = userTheme(), t = THEMES[u ? u.base : L.theme] || THEMES.aero;
  styleEl('as-theme').textContent = `.as-phone{${V(t.day)}}.as-phone[data-mode="night"]{${V(t.night)}}` + (u && u.css ? '\n' + rooted(u.css) + '\n' + varRules(u.css) : '') + (u && u.skins ? '\n' + u.skins.map(wrap).join('\n') : '');
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
