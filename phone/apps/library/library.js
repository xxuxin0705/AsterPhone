// 资源库：换主题（一套颜色）、管理皮肤（自己写 / 导入的 CSS）、字体库、皮肤说明书。
import { h, uid, pickFile } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, segmented, input, textarea, field, btn, icon, actionSheet, dialog, toast, empty, navBtn, navText, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { THEMES, SCOPES, lib, applySkins, setTheme, tryOn, endTrial } from '../../core/skin.js';
import { userFonts, importClockFont, removeClockFont } from '../../core/fonts.js';
import { shell } from '../../core/shell.js';

const EXAMPLES = [
  { name: '朋友圈改名', scope: 'all', css: `/* 把「动态」改叫「朋友圈」，「我」改叫「我的」 */
/* @texts {"chat.tab.moments":"朋友圈","chat.tab.me":"我的"} */` },
  { name: '方形气泡', scope: 'chat', css: `.as-chat-bubble { border-radius: 10px !important; }` },
  { name: '我的气泡换成奶油黄', scope: 'chat', css: `.as-chat-msg.is-me .as-chat-bubble {
  background: linear-gradient(180deg, rgba(255,240,200,.85), rgba(255,226,160,.7)) !important;
  color: #5a3a10 !important;
}` },
  { name: '玻璃更透一点', scope: 'all', css: `.as-phone { --as-blur: 30px; --as-color-surface: rgba(255,255,255,.3); }
.as-phone[data-mode="night"] { --as-color-surface: rgba(255,255,255,.06); }` },
  { name: '大一号的锁屏时钟', scope: 'lock', css: `.as-lock-clock { font-size: 118px !important; }` },
];
const VARS = [
  ['--as-color-bg-grad', '页面背景（渐变或图片）'], ['--as-color-surface', '玻璃面板的颜色'], ['--as-color-glass-line', '玻璃描边'], ['--as-color-gloss', '面板顶部高光'],
  ['--as-color-text', '主文字'], ['--as-color-text-2', '次要文字'], ['--as-color-accent', '强调色'], ['--as-color-accent-2', '强调色的亮端'],
  ['--as-blur', '毛玻璃模糊度'], ['--as-radius-l', '卡片圆角'], ['--as-font-scale', '字号倍数'],
];
const CLASSES = [
  ['.as-phone', '整部手机（[data-mode="night"] 是夜间）'], ['.as-statusbar', '状态栏'], ['.as-navbar', '顶栏'], ['.as-list-group__body', '列表卡片'],
  ['.as-btn--primary', '主按钮'], ['.as-switch', '开关'], ['.as-lock-clock', '锁屏大时间'], ['.as-home-app__icon', '桌面图标'],
  ['.as-chat-bubble', '聊天气泡'], ['.as-chat-msg.is-me', '我发的消息'], ['.as-chat-msg.is-them', 'TA 发的消息'], ['.as-chat-inputwrap', '输入框'],
  ['.as-chat-tabbar', '聊天底部标签栏'], ['.as-chat-moment', '一条动态'],
  ['[data-as-app="chat"]', '只选聊天 App 的页面'], ['[data-as-page="chat-room"]', '只选私聊界面'],
];

let tab = 'theme';
export function open() {
  const p = page({ app: 'library', id: 'library-main', title: '资源库', large: true, back: true });
  const tabs = h('div.as-chat-set-tabs', [['theme', '主题'], ['skins', '皮肤'], ['fonts', '字体'], ['guide', '怎么写']].map(([k, l]) => h('button', { dataset: { k }, onclick: () => { tab = k; show(); } }, l)));
  // 每个标签页画一次就留着，切页只换显示；数据变了才在旁边重画好再一次换上去（不闪）
  const DRAW = { theme: drawThemes, skins: drawSkins, fonts: drawFonts, guide: drawGuide };
  const sig = { theme: () => '', guide: () => '', skins: () => JSON.stringify(lib().skins),
    fonts: () => JSON.stringify([userFonts().map(x => x.id), state.settings.clock.font, state.settings.uiFont]) };
  const panes = {}, drawn = {};
  for (const k in DRAW) panes[k] = h('div', { hidden: true });
  p.body.append(tabs, ...Object.values(panes));
  function paint(k) { const nb = h('div'); DRAW[k](nb, () => paint(k), show); panes[k].replaceChildren(...nb.childNodes); drawn[k] = sig[k](); }
  function show() {
    [...tabs.children].forEach(b => b.classList.toggle('is-active', b.dataset.k === tab));
    for (const k in panes) panes[k].hidden = k !== tab;
    if (drawn[tab] !== sig[tab]()) paint(tab);
  }
  show(); p.el._onShow = show;
  return p.el;
}

/** 字体库：在这里导入的、在「外观」里导入的都在这；锁屏时间和整个手机的字都从这里挑 */
function drawFonts(box, redraw) {
  const S = state.settings, used = id => [S.clock.font === 'u:' + id ? '锁屏时间' : '', S.uiFont === 'u:' + id ? '整个手机' : ''].filter(Boolean).join('、');
  box.append(h('div.as-lib-actions.is-one', btn('导入', 'secondary', async () => {
    const f = await pickFile('.otf,.ttf,.woff,.woff2,font/*'); if (!f) return;
    try { const x = await importClockFont(f); toast(`导入了「${x.name}」，去「设置 → 外观」里选用`); redraw(); } catch (e) { toast(e.message); }
  })));
  box.appendChild(userFonts().length ? group(withInfo('我的字体', '点一个可以删除。导入的字体只存在这台设备上，换手机要再导入一次。'), userFonts().map(x => item({ title: x.name, sub: used(x.id) ? '正在用：' + used(x.id) : '', onClick: async () => {
    if (!(await dialog({ title: `删掉「${x.name}」？`, text: used(x.id) ? '正在用它的地方会换回默认字体。' : '', confirm: '删除', danger: true }))) return;
    await removeClockFont(x.id); commit('look'); shell.applyLook(); redraw();
  } }))) : empty('还没有字体'));
}

function drawThemes(box, redraw) {
  const cur = lib().theme;
  box.append(
    h('div.as-lib-themes', Object.entries(THEMES).map(([k, t]) => h('button.as-lib-theme' + (k === cur ? '.is-active' : ''), { onclick: e => { setTheme(k); Object.assign(state.settings.walls, { lock: t.wall, home: t.wall, lockRandom: false, homeRandom: false }); commit('look'); shell.applyLook(); toast(`已换成「${t.name}」`);
        const b = e.currentTarget, on = b.parentNode.querySelector('.is-active'); if (on === b) return;   // 只换勾，不整页重画
        on?.classList.remove('is-active'); b.classList.add('is-active'); b.append(on?.querySelector('.as-lib-theme__on') || h('span.as-lib-theme__on', icon('check', 14, 2.6))); } },
      h('span.as-lib-theme__pv', { style: { backgroundImage: `url(assets/wallpapers/${t.wall}-day.jpg)` } },
        h('i'), h('i.is-me', { style: { background: t.swatch[2] } }), h('i', { style: { width: '40%' } })),
      h('b', t.name), k === cur ? h('span.as-lib-theme__on', icon('check', 14, 2.6)) : null))));
}

function drawSkins(box, redraw) {
  const L = lib();
  box.append(h('div.as-lib-actions',
    btn('导入', 'secondary', () => importSkin(redraw)), btn('新建', 'secondary', () => editSkin(null, redraw)),
    btn('全部关掉', 'secondary', () => { L.skins.forEach(s => { s.on = false; }); commit('library'); applySkins(); toast('皮肤都关了，回到默认样子'); redraw(); })));
  if (!L.skins.length) { box.appendChild(empty('还没有皮肤')); return; }
  box.appendChild(group(withInfo('我的皮肤', '可以同时开好几个。点一个可以编辑、试用、分享、删除。'), L.skins.map(s => {
    const sw = h('button.as-switch' + (s.on ? '.is-active' : ''), { role: 'switch', 'aria-label': s.name });
    sw.addEventListener('click', e => { e.stopPropagation(); s.on = !s.on; sw.classList.toggle('is-active', s.on); commit('library'); applySkins(); });
    return item({ icon: 'palette', color: 'purple', title: s.name, sub: `${(SCOPES.find(x => x[0] === s.scope) || SCOPES[0])[1]} · ${s.css.length} 字`, right: sw, onClick: () => skinMenu(s, redraw) });
  })));
}
async function skinMenu(s, redraw) {
  const L = lib();
  const v = await actionSheet(s.name, [
    { value: 'edit', label: '编辑', icon: 'edit' }, { value: 'try', label: '试用 15 秒', icon: 'sparkle' },
    { value: 'copy', label: '复制 CSS（分享给别人）', icon: 'note' }, { value: 'file', label: '导出成 .css 文件', icon: 'box' },
    { value: 'del', label: '删除', icon: 'trash', danger: true },
  ]);
  if (v === 'edit') editSkin(s, redraw);
  if (v === 'try') trial({ ...s, on: true });
  if (v === 'copy') navigator.clipboard?.writeText(packCss(s)).then(() => toast('已复制，发给别人让 TA 在资源库里导入'), () => toast('复制失败'));
  if (v === 'file') { const a = h('a', { href: URL.createObjectURL(new Blob([packCss(s)], { type: 'text/css' })), download: `AsterPhone-${s.name}.css` }); document.body.appendChild(a); a.click(); a.remove(); }
  if (v === 'del' && await dialog({ title: `删除「${s.name}」？`, confirm: '删除', danger: true })) { L.skins.splice(L.skins.indexOf(s), 1); commit('library'); applySkins(); redraw(); }
}
/** 导出时把名字和范围写进文件头，别人导入时能认出来 */
const packCss = s => `/* AsterPhone 皮肤：${s.name} | 范围：${s.scope || 'all'} */\n${s.css}`;
function unpack(text, fallbackName) {
  const m = /AsterPhone 皮肤：(.+?)\s*\|\s*范围：(\w+)\s*\*\//.exec(text);
  return { name: m ? m[1].trim() : fallbackName, scope: m ? m[2] : 'all', css: m ? text.replace(m[0], '').trim() : text.trim() };
}
async function importSkin(redraw) {
  const v = await actionSheet('导入皮肤', [{ value: 'paste', label: '粘贴 CSS 文字', icon: 'note' }, { value: 'file', label: '选 .css 文件', icon: 'box' }]);
  let text = null, name = '导入的皮肤';
  if (v === 'paste') {
    const p = page({ app: 'library', id: 'library-import', title: '粘贴皮肤', back: true });
    const ta = textarea({ rows: 12, placeholder: '把别人分享的 CSS 粘贴到这里' }); ta.classList.add('as-settings-prompt-text');
    p.body.append(group('', [h('div.as-field', ta)]), btn('导入', 'primary', () => { if (!ta.value.trim()) return; add(unpack(ta.value, name)); nav.pop(); }, { style: { width: '100%' } }));
    nav.push(p.el); return;
  }
  if (v === 'file') { const f = await pickFile('.css,text/css,text/plain'); if (!f) return; text = await f.text(); name = f.name.replace(/\.[^.]+$/, ''); add(unpack(text, name)); }
  function add(sk) { lib().skins.push({ id: uid('sk'), on: false, ...sk }); commit('library'); toast(`导入了「${sk.name}」，先试用看看`); trial({ ...sk, on: true }); redraw(); }
}
let trialT = 0;
function trial(sk) {
  clearTimeout(trialT); tryOn(sk);
  toast(`试用「${sk.name}」中，15 秒后自动恢复`, { label: '保留', fn: () => { clearTimeout(trialT); endTrial(); const s = lib().skins.find(x => x.id === sk.id); if (s) s.on = true; else lib().skins.push({ ...sk, id: sk.id || uid('sk'), on: true }); commit('library'); applySkins(); toast('已保留'); } });
  trialT = setTimeout(() => { endTrial(); toast('试用结束，已恢复'); }, 15000);
}
function editSkin(sk, redraw) {
  const d = sk ? { ...sk } : { id: uid('sk'), name: '我的皮肤', scope: 'all', css: '/* 在这里写 CSS，「怎么写」里有门牌号和例子 */\n', on: true };
  const ta = textarea({ value: d.css, rows: 16, onInput: v => { d.css = v; } }); ta.classList.add('as-settings-prompt-text');
  const p = page({ app: 'library', id: 'library-edit', title: sk ? '编辑皮肤' : '新建皮肤', back: true, right: navText('保存', () => {
    const L = lib();
    if (sk) Object.assign(sk, d); else L.skins.push(d);
    commit('library'); endTrial(); applySkins(); toast('已保存'); nav.pop(); redraw();
  }, true) });
  p.body.append(
    group('', [field('名字', input({ value: d.name, onInput: v => { d.name = v.trim() || '我的皮肤'; } })),
      h('div.as-field', h('span.as-field__label', '在哪儿生效'), h('div.as-chips', SCOPES.map(([k, l]) => { const c = h('button.as-chip' + (d.scope === k ? '.is-active' : ''), { onclick: () => { d.scope = k; c.parentNode.querySelectorAll('.as-chip').forEach(x => x.classList.toggle('is-active', x === c)); } }, l); return c; })))]),
    group('CSS', [h('div.as-field', ta)]),
    btn('先试用 15 秒', 'secondary', () => trial({ ...d, on: true }), { style: { width: '100%' } }));
  p.el._onLeave = () => endTrial();
  nav.push(p.el);
}

function drawGuide(box, redraw, show) {
  box.append(
    group(withInfo('例子', '皮肤就是一段 CSS。每个东西都有固定的「门牌号」（类名），永远不改名，所以写好的皮肤以后也能用。点一个例子就加到「我的皮肤」。'), EXAMPLES.map(e => item({ title: e.name, sub: e.css.split('\n')[0].slice(0, 40), chevron: true, onClick: () => {
      lib().skins.push({ id: uid('sk'), on: true, ...e }); commit('library'); applySkins(); toast(`已加上「${e.name}」`); tab = 'skins'; show();
    } }))),
    group(withInfo('颜色和尺寸变量', '写在 .as-phone { } 里。点一行就复制。'), VARS.map(([k, d]) => item({ title: k, sub: d, onClick: () => navigator.clipboard?.writeText(k).then(() => toast('已复制')) }))),
    group(withInfo('常用门牌号', '点一行就复制。'), CLASSES.map(([k, d]) => item({ title: k, sub: d, onClick: () => navigator.clipboard?.writeText(k).then(() => toast('已复制')) }))),
    group(withInfo('改界面上的字', '把这行注释放进皮肤里就能改字。目前能改：chat.tab.messages、chat.tab.contacts、chat.tab.moments、chat.tab.me'), [h('div.as-field', h('code.as-lib-code', '/* @texts {"chat.tab.moments":"朋友圈"} */'))]));
}
