// 资源库：主题（整部手机的一套样子，能存、导出、导入）、应用（各 App 的皮肤）、个性装扮（字体、表情包…到处都能用的）、教程。
import { h, uid, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, input, textarea, field, btn, icon, actionSheet, dialog, sheet, toast, empty, navText, withInfo, avatar, slider, colorWheel } from '../../core/ui.js';
import { deco, addFrame, paintBubble, pack, unpack } from '../../core/deco.js';
import * as nav from '../../core/nav.js';
import { THEMES, SKIN_APPS, scopeName, lib, userThemes, applySkins, setTheme, tryOn, endTrial } from '../../core/skin.js';
import * as time from '../../core/time.js';
import * as walls from '../../core/walls.js';
import { userFonts, importClockFont, removeClockFont } from '../../core/fonts.js';
import { shell } from '../../core/shell.js';

// 教程：每个能美化的地方（整部手机 / 某个 App / 某一页）一份：常用门牌号（类名）+ 例子
const GUIDE = {
  all: { cls: [['.as-phone', '整部手机（[data-mode="night"] 是夜间）'], ['.as-statusbar', '顶部时间栏'], ['.as-navbar', '每页最上面那一栏'], ['.as-list-group__body', '列表卡片'],
      ['.as-btn--primary', '主按钮'], ['.as-switch', '开关'], ['.as-sheet', '从下面弹出来的面板'], ['.as-toast', '提示条']],
    vars: [['--as-color-bg-grad', '页面背景（渐变或图片）'], ['--as-color-surface', '玻璃面板的颜色'], ['--as-color-glass-line', '玻璃描边'], ['--as-color-text', '主文字'], ['--as-color-text-2', '次要文字'],
      ['--as-color-accent', '强调色'], ['--as-blur', '毛玻璃模糊度'], ['--as-radius-l', '卡片圆角'], ['--as-font-scale', '字号倍数']],
    ex: [{ name: '玻璃更透一点', css: `.as-phone { --as-blur: 30px; --as-color-surface: rgba(255,255,255,.3); }\n.as-phone[data-mode="night"] { --as-color-surface: rgba(255,255,255,.06); }` }] },
  chat: { cls: [['.as-chat-tabbar', '底部标签栏'], ['.as-chat-tab', '标签栏里的一个按钮']],
    ex: [{ name: '朋友圈改名', css: `/* 把「动态」改叫「朋友圈」，「我」改叫「我的」 */\n/* @texts {"chat.tab.moments":"朋友圈","chat.tab.me":"我的"} */` }],
    texts: 'chat.tab.messages、chat.tab.contacts、chat.tab.moments、chat.tab.me' },
  'chat-messages': { cls: [['.as-chat-search', '搜索框'], ['.as-chat-filter', '全部 / 单聊 / 群聊'], ['.as-chat-conv', '一个聊天'], ['.as-chat-conv__ava', '头像'], ['.as-chat-conv__name', '名字'], ['.as-chat-conv__text', '最后一句话'], ['.as-chat-conv__time', '时间']] },
  'chat-contacts': { cls: [['.as-chat-person', '一个联系人'], ['.as-chat-sec__head', '分组标题'], ['.as-chat-index-head', '字母标题'], ['.as-chat-indexbar', '右边的字母条']] },
  'chat-room': { cls: [['.as-chat-room__name', '顶上的名字'], ['.as-chat-msg.is-me', '我发的消息'], ['.as-chat-msg.is-them', 'TA 发的消息'], ['.as-chat-bubble', '气泡'], ['.as-chat-msg__avatar', '消息旁的头像'],
      ['.as-chat-time', '时间'], ['.as-chat-inputwrap', '输入框那一块'], ['.as-chat-sendbtn', '发送按钮']],
    ex: [{ name: '方形气泡', css: `.as-chat-bubble { border-radius: 10px !important; }` },
      { name: '我的气泡换成奶油黄', css: `.as-chat-msg.is-me .as-chat-bubble {\n  background: linear-gradient(180deg, rgba(255,240,200,.85), rgba(255,226,160,.7)) !important;\n  color: #5a3a10 !important;\n}` }] },
  'chat-moments': { cls: [['.as-chat-moments-cover', '顶上的封面'], ['.as-chat-moment', '一条动态'], ['.as-chat-moment__name', '名字'], ['.as-chat-moment__text', '正文'], ['.as-chat-moment__imgs', '配图'], ['.as-chat-moment__comments', '评论']] },
  'chat-me': { cls: [['.as-chat-me-head', '头像和名字那一块'], ['.as-chat-me-head__name', '名字'], ['.as-chat-me-head__sign', '签名'], ['.as-chat-me-stats', '下面的几个数字']] },
  music: { cls: [['[class*="as-mu-"]', '音乐的东西都以 .as-mu- 开头'], ['.as-mp', '播放页'], ['.as-mp__lrc', '播放页的歌词']] },
  interlude: { cls: [['[class*="as-int-"]', '幕间的东西都以 .as-int- 开头'], ['.as-int-splash', '片头']] },
  memory: { cls: [['[class*="as-mem-"]', '念念铃的东西都以 .as-mem- 开头'], ['.as-mem-card', '一张记忆卡片'], ['.as-mem-bell', '铃铛']] },
  diary: { cls: [['[class*="as-dy-"]', '日记的东西都以 .as-dy- 开头']] },
  street: { cls: [['.as-street', '商业街'], ['.as-studio', '照相馆']] },
  settings: { cls: [['[class*="as-settings-"]', '设置的东西都以 .as-settings- 开头'], ['.as-list-item__icon', '每行前面的小图标']] },
  library: { cls: [['.as-lib-theme', '一张主题卡片']] },
  log: { cls: [['[class*="as-log-"]', '日志的东西都以 .as-log- 开头']] },
  home: { cls: [['.as-home-widget', '时间小组件'], ['.as-home-grid', '图标那几排'], ['.as-home-app__icon', '一个图标'], ['.as-home-app__name', '图标下面的名字']] },
  lock: { cls: [['.as-lock-clock', '大时间'], ['.as-lock-date', '日期'], ['.as-lock-notice', '通知'], ['.as-lock-keypad', '密码键盘']],
    ex: [{ name: '大一号的锁屏时钟', css: `.as-lock-clock { font-size: 118px !important; }` }] },
};

let tab = 'theme';
export function open() {
  const p = page({ app: 'library', id: 'library-main', title: '资源库', large: true, back: true });
  const tabs = h('div.as-chat-set-tabs', [['theme', '主题'], ['apps', '应用'], ['deco', '个性装扮'], ['guide', '教程']].map(([k, l]) => h('button', { dataset: { k }, onclick: () => { tab = k; show(); } }, l)));
  // 每个标签页画一次就留着，切页只换显示；数据变了才在旁边重画好再一次换上去（不闪）
  const DRAW = { theme: drawThemes, apps: drawSkins, deco: drawDeco, guide: drawGuide };
  const sig = { theme: () => JSON.stringify(userThemes().map(t => t.id + t.name)), guide: () => '', apps: () => JSON.stringify(lib().skins),
    deco: () => JSON.stringify([userFonts().map(x => x.id), state.settings.clock.font, state.settings.uiFont, state.stickers.length, deco().frames.map(x => x.id + x.name), deco().bubbles]) };
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
  // 以前的皮肤（v0.8.324 前）都在「应用」里：只提示一次
  if (lib().skins.length && !lib().tipApps) { lib().tipApps = 1; commit('library'); toast('以前的皮肤都在「应用」里，要改去那里', { label: '去看看', fn: () => { tab = 'apps'; show(); } }); }
  return p.el;
}

/** 个性装扮：头像框、气泡（每个人可以戴不一样的，在聊天的「头像与备注」里选）、字体、表情包 */
function drawDeco(box, redraw) {
  const tile = (pv, name, onclick) => h('button.as-lib-deco__item', { onclick }, pv, h('span', name));
  const add = onclick => h('button.as-lib-deco__item.is-add', { onclick }, h('span.as-lib-deco__pv', icon('plus', 22, 1.8)), h('span', '添加'));
  box.append(
    group(withInfo('头像框', '用透明背景的 PNG：中间留空，四周是框。给 TA 和自己选：聊天右上 ⋯ → 头像与备注。'), [h('div.as-lib-deco',
      ...deco().frames.map(f => tile(h('span.as-lib-deco__pv', addFrame(avatar('', '我', 44), f.id)), f.name, () => decoMenu('frames', f, redraw))),
      add(() => addDeco('frames', redraw)))]),
    group(withInfo('气泡', '颜色、圆角、描边自己调；也可以用一张图，四个角不会被拉变形。给 TA 和自己选：聊天右上 ⋯ → 头像与备注。'), [h('div.as-lib-deco',
      ...deco().bubbles.map(b => tile(h('span.as-lib-deco__pv', paintBubble(h('span.as-chat-bubble', '你好'), b.id)), b.name, () => decoMenu('bubbles', b, redraw))),
      add(() => addDeco('bubbles', redraw)))]));

  const S = state.settings, used = id => [S.clock.font === 'u:' + id ? '锁屏时间' : '', S.uiFont === 'u:' + id ? '整个手机' : ''].filter(Boolean).join('、');
  box.append(group(withInfo('字体', '点一个可以删除。导入的字体只存在这台设备上，换手机要再导入一次。'), [...userFonts().map(x => item({ title: x.name, sub: used(x.id) ? '正在用：' + used(x.id) : '', onClick: async () => {
    if (!(await dialog({ title: `删掉「${x.name}」？`, text: used(x.id) ? '正在用它的地方会换回默认字体。' : '', confirm: '删除', danger: true }))) return;
    await removeClockFont(x.id); commit('look'); shell.applyLook(); redraw();
  } })), item({ icon: 'plus', title: '导入字体', onClick: async () => {
    const f = await pickFile('.otf,.ttf,.woff,.woff2,font/*'); if (!f) return;
    try { const x = await importClockFont(f); toast(`导入了「${x.name}」，去「设置 → 显示」里选用`); redraw(); } catch (e) { toast(e.message); }
  } })]),
  group('表情包', [item({ title: '管理表情包', value: `${state.stickers.length} 个`, chevron: true, onClick: async () => (await import('../chat/specials.js')).openStickerManager() })]));
}

const KIND = { frames: '头像框', bubbles: '气泡' };
async function addDeco(k, redraw) {
  const v = await actionSheet('添加' + KIND[k], [k === 'frames' ? { value: 'img', label: '选图片', icon: 'image' } : { value: 'new', label: '新建', icon: 'edit' }, { value: 'file', label: '导入别人分享的文件', icon: 'box' }]);
  if (v === 'new') editBubble(null, redraw);
  if (v === 'img') {
    const f = await pickFile('image/*'); if (!f) return;
    deco().frames.push({ id: uid('f'), name: f.name.replace(/\.[^.]+$/, '').slice(0, 20) || '头像框', src: await fileToDataURL(f, 320, 'image/png') }); commit('deco'); redraw();
  }
  if (v === 'file') {
    const f = await pickFile('*/*'); if (!f) return;
    let d = null; try { d = JSON.parse(await f.text()); } catch (e) { /* 下面统一说 */ }
    const n = unpack(k, d); toast(n ? `导入了 ${n} 个${KIND[k]}` : `这不是 AsterPhone 的${KIND[k]}文件`); if (n) redraw();
  }
}
async function decoMenu(k, x, redraw) {
  const v = await actionSheet(x.name, [...(k === 'bubbles' ? [{ value: 'edit', label: '编辑', icon: 'edit' }] : [{ value: 'name', label: '改名', icon: 'edit' }]),
    { value: 'out', label: '导出', icon: 'box' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
  if (v === 'edit') editBubble(x, redraw);
  if (v === 'name') { const n = await dialog({ title: '改名', input: { value: x.name } }); if (n && n.trim()) { x.name = n.trim().slice(0, 20); commit('deco'); redraw(); } }
  if (v === 'out') {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(pack(k, [x]))], { type: 'application/json' })), download: `AsterPhone-${KIND[k]}-${x.name}.json` });
    document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
  }
  if (v === 'del' && await dialog({ title: `删除「${x.name}」？`, text: '戴着它的人会换回没有的样子。', confirm: '删除', danger: true })) { deco()[k].splice(deco()[k].indexOf(x), 1); commit('deco'); redraw(); }
}
/** 气泡编辑：上面是预览，下面调颜色、圆角、描边，或者换成一张图 */
function editBubble(b, redraw) {
  const d = b ? { ...b } : { id: uid('b'), name: '我的气泡', bg: '#ffffff', ink: '#1f3646', line: '#ffffff00', radius: 18 };
  const pv = h('span.as-chat-bubble', '今晚的月亮很圆');
  const paint = () => { pv.className = 'as-chat-bubble'; pv.removeAttribute('style'); paintBubble(pv, d); };
  const color = (label, key) => { const dot = h('span.as-lib-dot', { style: { background: d[key] } });
    return item({ title: label, right: dot, onClick: () => sheet({ title: label, content: h('div.as-mu-color', colorWheel(d[key], v => { d[key] = v; dot.style.background = v; paint(); }, true)) }) }); };
  const imgRow = item({ title: '用一张图', value: d.img ? '已选' : '', chevron: true, onClick: async () => {
    const v = await actionSheet('气泡图', [{ value: 'pick', label: '选图片', icon: 'image' }, ...(d.img ? [{ value: 'clear', label: '不用图', icon: 'trash', danger: true }] : [])]);
    if (v === 'pick') { const f = await pickFile('image/*'); if (f) d.img = await fileToDataURL(f, 240, 'image/png'); }
    if (v === 'clear') delete d.img;
    imgRow.querySelector('.as-list-item__value').textContent = d.img ? '已选' : ''; paint();
  } });
  const rOut = h('output', d.radius + 'px');
  const p = page({ app: 'library', id: 'library-bubble', title: b ? '编辑气泡' : '新建气泡', back: true, right: navText('保存', () => {
    if (b) Object.assign(b, d); else deco().bubbles.push(d);
    commit('deco'); toast('已保存'); nav.pop(); redraw();
  }, true) });
  p.body.append(h('div.as-lib-bubble-pv', pv),
    group('', [field('名字', input({ value: d.name, onInput: v => { d.name = v.trim() || '我的气泡'; } }))]),
    group('样子', [color('底色', 'bg'), color('字的颜色', 'ink'), color('描边', 'line'),
      h('div.as-settings-slider-row', h('span', '圆角'), slider({ min: 0, max: 26, step: 1, value: d.radius, onInput: v => { d.radius = v; rOut.textContent = v + 'px'; paint(); } }), rOut), imgRow]));
  paint(); nav.push(p.el);
}

/* ---------- 主题：自带的两套 + 自己存的；点一下整套换上（颜色、锁屏和桌面壁纸、主题里的 CSS） ---------- */
function useTheme(k, t) {
  setTheme(k);
  const w = t.walls || { lock: t.wall, home: t.wall };
  Object.assign(state.settings.walls, { lock: w.lock, home: w.home, lockRandom: false, homeRandom: false }); commit('look'); shell.applyLook();
  toast(`已换成「${t.name}」`);
}
function drawThemes(box, redraw) {
  const cur = lib().theme;
  const card = (k, t, mine) => {
    const base = THEMES[mine ? t.base : k] || THEMES.aero;
    const pv = h('span.as-lib-theme__pv', h('i'), h('i.is-me', { style: { background: base.swatch[2] } }), h('i', { style: { width: '40%' } }));
    if (mine) walls.thumb(t.walls.home).then(u => { if (u) pv.style.backgroundImage = `url(${u})`; });
    else pv.style.backgroundImage = `url(assets/wallpapers/${t.wall}-day.jpg)`;
    return h('button.as-lib-theme' + (k === cur ? '.is-active' : ''), { onclick: e => {
      useTheme(k, t);
      const b = e.currentTarget, on = b.parentNode.querySelector('.is-active'); if (on === b) return;   // 只换勾，不整页重画
      on?.classList.remove('is-active'); b.classList.add('is-active'); b.append(on?.querySelector('.as-lib-theme__on') || h('span.as-lib-theme__on', icon('check', 14, 2.6)));
    } }, pv, h('b', t.name),
      mine ? h('span.as-lib-theme__more', { role: 'button', 'aria-label': t.name + '更多', onclick: e => { e.stopPropagation(); themeMenu(t, redraw); } }, icon('more', 18, 2)) : null,
      k === cur ? h('span.as-lib-theme__on', icon('check', 14, 2.6)) : null);
  };
  box.append(h('div.as-lib-actions.is-two', btn('导入', 'secondary', () => importTheme(redraw)), btn('存成主题', 'secondary', () => saveTheme(redraw))),
    h('div.as-lib-themes', ...Object.entries(THEMES).map(([k, t]) => card(k, t, false)), ...userThemes().map(t => card(t.id, t, true))));
}
/** 把现在的样子（颜色、锁屏和桌面壁纸、作用在全部的皮肤）存成一个主题 */
async function saveTheme(redraw) {
  const name = await dialog({ title: '存成主题', input: { value: '我的主题' } }); if (!name || !name.trim()) return;
  const L = lib(), u = userThemes().find(x => x.id === L.theme);
  const css = [u && u.css, ...L.skins.filter(x => x.on && x.scope === 'all').map(x => x.css)].filter(Boolean).join('\n');
  const t = { id: uid('th'), name: name.trim().slice(0, 20), base: u ? u.base : THEMES[L.theme] ? L.theme : 'aero', walls: { lock: walls.current('lock'), home: walls.current('home') }, css };
  userThemes().push(t); setTheme(t.id); toast(`存好了「${t.name}」`); redraw();
}
async function themeMenu(t, redraw) {
  const v = await actionSheet(t.name, [{ value: 'out', label: '导出', icon: 'box' }, { value: 'name', label: '改名', icon: 'edit' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
  if (v === 'out') {
    toast('正在打包…', true);
    try {
      const data = { asterphone: 'theme', v: 1, name: t.name, base: t.base, css: t.css, walls: { lock: await walls.pack(t.walls.lock), home: await walls.pack(t.walls.home) } };
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: `AsterPhone-主题-${t.name}.json` });
      document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
    } catch (e) { toast('打包失败：' + e.message); }
  }
  if (v === 'name') { const n = await dialog({ title: '改名', input: { value: t.name } }); if (n && n.trim()) { t.name = n.trim().slice(0, 20); commit('library'); redraw(); } }
  const del = v === 'del' && await actionSheet(`删除「${t.name}」？`, [{ value: 'all', label: '连它的壁纸一起删', icon: 'trash', danger: true }, { value: 'keep', label: '只删主题，壁纸留着', icon: 'trash', danger: true }]);
  if (del) {
    userThemes().splice(userThemes().indexOf(t), 1);
    // 壁纸只在没有别的主题用着的时候才删
    if (del === 'all') for (const id of new Set([t.walls.lock, t.walls.home])) if (!userThemes().some(x => x.walls.lock === id || x.walls.home === id)) await walls.remove(id);
    if (lib().theme === t.id) useTheme('aero', THEMES.aero); else { commit('library'); shell.applyLook(); }
    redraw();
  }
}
async function importTheme(redraw) {
  const f = await pickFile('*/*'); if (!f) return;   // 不限类型：有的手机存下来的文件名会丢掉 .json
  let d = null; try { d = JSON.parse(await f.text()); } catch (e) { /* 下面统一说 */ }
  if (!d || d.asterphone !== 'theme') { toast('这不是 AsterPhone 的主题文件'); return; }
  toast('正在导入…', true);
  try {
    const t = { id: uid('th'), name: String(d.name || '导入的主题').slice(0, 20), base: THEMES[d.base] ? d.base : 'aero', css: String(d.css || ''),
      walls: { lock: await walls.unpack(d.walls?.lock ?? 'water', 'lock'), home: await walls.unpack(d.walls?.home ?? 'water', 'home') } };
    userThemes().push(t); useTheme(t.id, t); redraw();
  } catch (e) { toast('导入失败：' + e.message); }
}

/* ---------- 应用：整部手机，或者先选 App、再选整个 App / 其中一页；每处的皮肤能开关、新建、导入、导出 ---------- */
const skinsAt = sc => lib().skins.filter(x => (x.scope || 'all') === sc);
const skinsOf = a => lib().skins.filter(x => x.scope === a.id || (a.pages || []).some(pg => pg[0] === x.scope));
const count = list => list.length ? `${list.length} 个` : '';
/** 子页面：返回时数据没变就不动，变了才在旁边画好再换上去 */
function subPage(id, title, sig, fill) {
  const p = page({ app: 'library', id, title, back: true });
  let last;
  const draw = () => { const nb = h('div'); fill(nb, draw); p.body.replaceChildren(...nb.childNodes); last = sig(); };
  draw(); p.el._onShow = () => { if (sig() !== last) draw(); };
  nav.push(p.el);
}
function drawSkins(box, redraw) {
  box.append(group('', [item({ icon: 'phone', title: '整部手机', value: count(skinsAt('all')), chevron: true, onClick: () => openScope('all') })]),
    group('应用', SKIN_APPS.map(a => item({ icon: a.icon, title: a.name, value: count(skinsOf(a)), chevron: true, onClick: () => STYLE[a.id] || a.pages ? openAppSkins(a) : openScope(a.id) }))));
  if (lib().skins.some(x => x.on)) box.append(btn('关掉所有皮肤', 'secondary', () => { lib().skins.forEach(x => { x.on = false; }); commit('library'); applySkins(); toast('皮肤都关了，回到默认样子'); redraw(); }, { style: { width: '100%' } }));
}
// 每个 App 自己的样式选项（不找 AI、只管长什么样的放这里；连接、补写这些还在「设置 → 应用管理」）
const STYLE = {
  music: () => { const m = state.music;
    return group('样式', [field('主页文字', segmented([['zh', '中文'], ['en', 'English']], m.lang || time.clockCfg().lang || 'zh', v => { m.lang = v; commit('music'); }))]); },
  interlude: () => group('样式', [toggleItem({ title: '打开时放片头' }, state.apps.interlude.splash, v => { state.apps.interlude.splash = v; commit('apps'); })]),
};
function openAppSkins(a) {
  subPage('library-app', a.name, () => JSON.stringify(skinsOf(a).map(x => x.id)), (nb, draw) => {
    if (STYLE[a.id]) nb.append(STYLE[a.id]());
    nb.append(group('皮肤', [[a.id, '整个' + a.name], ...(a.pages || [])].map(([sc, n]) => item({ title: n, value: count(skinsAt(sc)), chevron: true, onClick: () => openScope(sc) }))),
      h('div.as-lib-actions.is-two', btn('导入', 'secondary', () => importSkins(a.id, draw)), btn('导出整个' + a.name, 'secondary', () => skinsOf(a).length ? exportSkins(skinsOf(a), a.name) : toast(`${a.name}还没有皮肤`))));
  });
}
function openScope(sc) {
  subPage('library-skins', scopeName(sc), () => JSON.stringify(skinsAt(sc)), (nb, draw) => {
    const list = skinsAt(sc);
    nb.append(h('div.as-lib-actions' + (list.length ? '' : '.is-two'), btn('新建', 'secondary', () => editSkin(null, sc, draw)), btn('导入', 'secondary', () => importSkins(sc, draw)),
      list.length ? btn('导出', 'secondary', () => exportSkins(list, scopeName(sc))) : null));
    nb.append(list.length ? group(withInfo('皮肤', '可以同时开好几个。点一个可以编辑、试用、删除。'), list.map(x => {
      const sw = h('button.as-switch' + (x.on ? '.is-active' : ''), { role: 'switch', 'aria-label': x.name });
      sw.addEventListener('click', e => { e.stopPropagation(); x.on = !x.on; sw.classList.toggle('is-active', x.on); commit('library'); applySkins(); });
      return item({ title: x.name, sub: `${x.css.length} 字`, right: sw, onClick: () => skinMenu(x, draw) });
    })) : empty('还没有皮肤'));
  });
}
async function skinMenu(x, redraw) {
  const v = await actionSheet(x.name, [{ value: 'edit', label: '编辑', icon: 'edit' }, { value: 'try', label: '试用 15 秒', icon: 'sparkle' },
    { value: 'out', label: '导出', icon: 'box' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
  if (v === 'edit') editSkin(x, x.scope, redraw);
  if (v === 'try') trial({ ...x, on: true });
  if (v === 'out') exportSkins([x], x.name);
  if (v === 'del' && await dialog({ title: `删除「${x.name}」？`, confirm: '删除', danger: true })) { lib().skins.splice(lib().skins.indexOf(x), 1); commit('library'); applySkins(); redraw(); }
}
/** 导出：一个 .json，里面每个皮肤带着自己的范围（整个 App 导出时各页的皮肤导回去还在各页） */
function exportSkins(list, name) {
  const data = { asterphone: 'skins', v: 1, name, skins: list.map(x => ({ name: x.name, scope: x.scope || 'all', css: x.css })) };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: `AsterPhone-皮肤-${name}.json` });
  document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
}
/** 读别人的皮肤：新的 .json，或者以前导出的 .css（文件头写着名字和范围）；文件里没写范围的放在 sc */
function readSkins(text, sc, fallbackName) {
  let d = null; try { d = JSON.parse(text); } catch (e) { /* 不是 JSON 就当 CSS */ }
  const ok = s => s === 'all' || scopeName(s) !== s;
  if (d && d.asterphone === 'skins' && Array.isArray(d.skins)) return d.skins.map(x => ({ name: String(x.name || fallbackName).slice(0, 20), scope: ok(x.scope) ? x.scope : sc, css: String(x.css || '') }));
  if (d) return [];
  const m = /AsterPhone 皮肤：(.+?)\s*\|\s*范围：([\w-]+)\s*\*\//.exec(text);
  return text.trim() ? [{ name: m ? m[1].trim() : fallbackName, scope: m && ok(m[2]) ? m[2] : sc, css: m ? text.replace(m[0], '').trim() : text.trim() }] : [];
}
async function importSkins(sc, redraw) {
  const v = await actionSheet('导入皮肤', [{ value: 'file', label: '选文件', icon: 'box' }, { value: 'paste', label: '粘贴文字', icon: 'note' }]);
  const add = list => {
    if (!list.length) { toast('这里面没有能用的皮肤'); return; }
    const added = list.map(x => ({ id: uid('sk'), on: true, ...x })); lib().skins.push(...added); commit('library'); applySkins(); redraw();
    toast(`导入了 ${added.length} 个，已经用上`, { label: '撤销', fn: () => { lib().skins = lib().skins.filter(x => !added.includes(x)); commit('library'); applySkins(); redraw(); } });
  };
  if (v === 'file') { const f = await pickFile('*/*'); if (f) add(readSkins(await f.text(), sc, f.name.replace(/\.[^.]+$/, '').slice(0, 20))); }
  if (v === 'paste') {
    const p = page({ app: 'library', id: 'library-import', title: '粘贴皮肤', back: true });
    const ta = textarea({ rows: 12, placeholder: '皮肤文字' }); ta.classList.add('as-settings-prompt-text');
    p.body.append(group('', [h('div.as-field', ta)]), btn('导入', 'primary', () => { if (!ta.value.trim()) return; add(readSkins(ta.value, sc, '导入的皮肤')); nav.pop(); }, { style: { width: '100%' } }));
    nav.push(p.el);
  }
}
let trialT = 0;
function trial(sk) {
  clearTimeout(trialT); tryOn(sk);
  toast(`试用「${sk.name}」中，15 秒后自动恢复`, { label: '保留', fn: () => { clearTimeout(trialT); endTrial(); const x = lib().skins.find(y => y.id === sk.id); if (x) x.on = true; else lib().skins.push({ ...sk, id: sk.id || uid('sk'), on: true }); commit('library'); applySkins(); toast('已保留'); } });
  trialT = setTimeout(() => { endTrial(); toast('试用结束，已恢复'); }, 15000);
}
function editSkin(sk, scope, redraw, tpl) {
  const d = sk ? { ...sk } : { id: uid('sk'), name: '我的皮肤', scope, css: tpl || '/* 在这里写 CSS，「教程」里有门牌号和例子 */\n', on: true };
  const ta = textarea({ value: d.css, rows: 16, onInput: v => { d.css = v; } }); ta.classList.add('as-settings-prompt-text');
  const p = page({ app: 'library', id: 'library-edit', title: sk ? '编辑皮肤' : '新建皮肤', back: true, right: navText('保存', () => {
    if (sk) Object.assign(sk, d); else lib().skins.push(d);
    commit('library'); endTrial(); applySkins(); toast('已保存'); nav.pop(); redraw();
  }, true) });
  p.body.append(group(scopeName(scope), [field('名字', input({ value: d.name, onInput: v => { d.name = v.trim() || '我的皮肤'; } }))]),
    group('CSS', [h('div.as-field', ta)]),
    btn('先试用 15 秒', 'secondary', () => trial({ ...d, on: true }), { style: { width: '100%' } }));
  p.el._onLeave = () => endTrial();
  nav.push(p.el);
}

/* ---------- 教程：和「应用」一样先选地方，每处一页：门牌号（点了复制）、例子（点了加上）、用模板新建 ---------- */
function drawGuide(box) {
  const go = (sc, title) => () => openGuide(sc, title);
  box.append(group('', [item({ icon: 'palette', title: '主题', chevron: true, onClick: () => openSteps('主题', THEME_STEPS) }),
      item({ icon: 'star', title: '个性装扮', chevron: true, onClick: () => openSteps('个性装扮', DECO_STEPS) }),
      item({ icon: 'phone', title: '整部手机', chevron: true, onClick: go('all') })]),
    group('应用', SKIN_APPS.map(a => item({ icon: a.icon, title: a.name, chevron: true, onClick: a.pages
      ? () => subPage('library-guide-app', a.name + '教程', () => '', nb => nb.append(group('', [[a.id, '整个' + a.name], ...a.pages].map(([sc, n]) => item({ title: n, chevron: true, onClick: go(sc) })))))
      : go(a.id) }))));
}
const THEME_STEPS = ['换上一套主题，在设置里换好壁纸，在「应用 → 整部手机」里加皮肤，调成你想要的样子。', '回到「主题」点「存成主题」，起个名字。', '点主题右下角的 ⋯ → 导出，得到一个 .json 文件，发给别人。', '别人在「主题」点「导入」选这个文件，就整套换上了（你自己加的壁纸也在里面）。'];
const DECO_STEPS = ['头像框：在「个性装扮」点「添加 → 选图片」，用透明背景的 PNG，中间留空、四周是框。', '气泡：点「添加 → 新建」，调底色、字的颜色、描边、圆角；也可以用一张图（四个角不会被拉变形）。', '给 TA 和自己戴上：聊天右上 ⋯ → 头像与备注 →「装扮」；群里的人在 TA 的资料页里选。头像框、气泡跟着人走，TA 在所有聊天里都戴着。', '点一个头像框或气泡 → 导出，就能发给别人；别人点「添加 → 导入别人分享的文件」。', '字体：在「个性装扮」点「导入字体」，选 .otf / .ttf 文件。', '导入的字体去「设置 → 显示」里选，锁屏时间和整个手机的字都能用。', '导入的字体只存在这台设备上，换手机要再导入一次。', '表情包还是在聊天里管理，这里只是多一个入口。'];
function openSteps(title, steps) {
  subPage('library-guide-steps', title + '教程', () => '', nb => nb.append(h('ol.as-lib-steps', steps.map(t => h('li', t)))));
}
function openGuide(sc) {
  const G = GUIDE[sc] || { cls: [] }, copy = k => navigator.clipboard?.writeText(k).then(() => toast('已复制'), () => toast('复制失败'));
  const where = sc === 'all' ? '「应用 → 整部手机」' : `「应用 → ${scopeName(sc).replace(' · ', ' → ')}」`;
  subPage('library-guide', scopeName(sc) + '教程', () => '', nb => {
    nb.append(h('ol.as-lib-steps', h('li', `在${where}点「新建」，或者点下面的「用模板新建」。`), h('li', '照下面的门牌号写 CSS，先「试用 15 秒」看看，满意就保存。'), h('li', '在同一个地方点「导出」，就能发给别人。')),
      group(withInfo('门牌号', '点一行就复制。门牌号（类名）永远不改名，写好的皮肤以后也能用。'), G.cls.map(([k, d]) => item({ title: k, sub: d, onClick: () => copy(k) }))));
    if (G.vars) nb.append(group(withInfo('颜色和尺寸变量', '写在 .as-phone { } 里。点一行就复制。'), G.vars.map(([k, d]) => item({ title: k, sub: d, onClick: () => copy(k) }))));
    if (G.texts) nb.append(group(withInfo('改界面上的字', '把这行注释放进皮肤里就能改字。能改：' + G.texts), [h('div.as-field', h('code.as-lib-code', '/* @texts {"chat.tab.moments":"朋友圈"} */'))]));
    if (G.ex) nb.append(group(withInfo('例子', '点一个就加到这里的皮肤里。'), G.ex.map(e => item({ title: e.name, sub: e.css.split('\n')[0].slice(0, 40), chevron: true, onClick: () => {
      if (lib().skins.some(x => x.name === e.name && (x.scope || 'all') === sc)) { toast(`已经有「${e.name}」了`); return; }
      lib().skins.push({ id: uid('sk'), on: true, scope: sc, ...e }); commit('library'); applySkins(); toast(`已加上「${e.name}」`);
    } }))));
    nb.append(btn('用模板新建', 'primary', () => editSkin(null, sc, () => {}, `/* ${scopeName(sc)} */\n` + G.cls.map(([k, d]) => `\n/* ${d} */\n${k} {\n  \n}\n`).join('')), { style: { width: '100%' } }));
  });
}
