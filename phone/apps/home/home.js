// 桌面：4 列 × 6 行，左右滑翻页，底下一排常用（Dock）。长按图标 / 组件出菜单；「编辑主屏幕」后图标会抖，按住拖动换位置、拖进拖出 Dock、拖到左右边上翻页。
// 布局、换过的图标、组件都存在 library.desk；存主题时一起存进主题，导出、导入整套带走。
import { h, $, uid, clamp, debounce, pickFile, fileToDataURL, onLongPress } from '../../core/util.js';
import { state, contact, commit, subscribe } from '../../core/store.js';
import { icon, badge, actionSheet, dialog, sheet, toast, pickImage, input, textarea, field, btn, group, item, segmented, slider, toggleItem, colorWheel } from '../../core/ui.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { load as loadMem } from '../../core/memory.js';
import { log } from '../../core/log.js';

export const APPS = [
  { id: 'chat', name: '聊天', icon: 'chat' },
  { id: 'settings', name: '设置', icon: 'gear' },
  { id: 'library', name: '资源库', icon: 'box' },
  { id: 'music', name: '音乐', icon: 'music' },
  { id: 'memory', name: '岁岁砂', icon: 'hourglass' },
  { id: 'diary', name: '日记', icon: 'note' },
  { id: 'interlude', name: '幕间', icon: 'search' },
  { id: 'street', name: '商业街', icon: 'shop' },
  { id: 'log', name: '日志', icon: 'list' },
];
const COLS = 4, ROWS = 6, DOCK = 4, ICON = 58, PAD = 20;
const SHAPES = [['round', '圆角'], ['circle', '圆形'], ['square', '方形'], ['raw', '原图']];
const KINDS = { clock: '时钟', photo: '图片', text: '文字', html: '自定义' };
const SIZES = { clock: ['4x2', '2x2'], photo: ['1x1', '2x1', '2x2', '4x1', '4x2', '2x4', '4x4'], text: ['2x1', '2x2', '4x1', '4x2'], html: ['1x1', '2x1', '2x2', '4x1', '4x2', '2x4', '4x3', '4x4'] };
const wh = s => s.split('x').map(Number);
const sizeOf = it => (it.a ? [1, 1] : wh(it.s));
const appOf = id => APPS.find(a => a.id === id);
const area = (el, p, it) => { const [w, hh] = sizeOf(it); el.style.gridArea = `${p.y + 1} / ${p.x + 1} / span ${hh} / span ${w}`; };

/* ---------- 数据 ---------- */
function fresh() {
  return { pages: [[{ id: uid('w'), w: 'clock', s: '4x2', x: 0, y: 0 }, ...APPS.map((a, i) => ({ id: 'a-' + a.id, a: a.id, x: i % COLS, y: 2 + (i / COLS | 0) }))]], dock: [], hidden: [], icons: {} };
}
export const desk = () => state.library.desk || (state.library.desk = fresh());
const fits = (items, x, y, w, hh, skip) => x >= 0 && y >= 0 && x + w <= COLS && y + hh <= ROWS
  && items.every(it => { if (it.id === skip) return true; const [iw, ih] = sizeOf(it); return x + w <= it.x || it.x + iw <= x || y + hh <= it.y || it.y + ih <= y; });
/** 从第 p0 页起找第一个放得下的空位，都满了就加一页 */
function spot(d, w, hh, skip, p0 = 0) {
  for (let p = p0; ; p++) {
    if (!d.pages[p]) d.pages.push([]);
    for (let y = 0; y <= ROWS - hh; y++) for (let x = 0; x <= COLS - w; x++) if (fits(d.pages[p], x, y, w, hh, skip)) return { p, x, y };
  }
}
/** 以后新加的 App 自动摆上桌面；认不出的 App 去掉 */
function tidy(d) {
  const has = new Set([...d.dock, ...d.hidden]);
  d.pages = d.pages.map(p => p.filter(it => !it.a || (appOf(it.a) && !has.has(it.a) && has.add(it.a))));
  APPS.forEach(a => { if (!has.has(a.id)) { const s = spot(d, 1, 1); d.pages[s.p].push({ id: 'a-' + a.id, a: a.id, x: s.x, y: s.y }); } });
}
/** 导入的主题里带的桌面：只收认得的字段 */
export function cleanDesk(x) {
  if (!x || !Array.isArray(x.pages)) return null;
  const str = v => (typeof v === 'string' ? v : ''), img = v => (/^(data:image\/|https?:)/.test(str(v)) ? v : '');
  const pages = x.pages.slice(0, 12).map(p => (Array.isArray(p) ? p : []).map(it => {
    if (!it || typeof it !== 'object') return null;
    if (appOf(it.a)) return { id: 'a-' + it.a, a: it.a, x: clamp(+it.x || 0, 0, COLS - 1), y: clamp(+it.y || 0, 0, ROWS - 1) };
    if (!SIZES[it.w]) return null;
    const s = SIZES[it.w].includes(it.s) ? it.s : SIZES[it.w][0], [w, hh] = wh(s);
    const o = { id: uid('w'), w: it.w, s, x: clamp(+it.x || 0, 0, COLS - w), y: clamp(+it.y || 0, 0, ROWS - hh) };
    if (it.w === 'photo') o.img = img(it.img);
    if (it.w === 'text') o.text = str(it.text).slice(0, 200);
    if (it.w === 'html') Object.assign(o, { name: str(it.name).slice(0, 20), html: str(it.html), css: str(it.css), imgs: Object.fromEntries(Object.entries(it.imgs || {}).map(([k, v]) => [k, img(v)])) });
    return o;
  }).filter(Boolean));
  const ids = v => (Array.isArray(v) ? v.filter(appOf) : []), L = x.look || {};
  const hex = v => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) ? v : undefined), num = (v, a, b) => (typeof v === 'number' ? clamp(v, a, b) : undefined);
  return { pages: pages.length ? pages : [[]], dock: ids(x.dock).slice(0, DOCK), hidden: ids(x.hidden), icons: Object.fromEntries(Object.entries(x.icons || {}).filter(([k, v]) => appOf(k) && img(v))),
    look: { shape: SHAPES.some(([v]) => v === L.shape) ? L.shape : undefined, r: num(L.r, 0, 29), k: num(L.k, 70, 120), fit: L.fit === 'contain' ? 'contain' : undefined,
      names: L.names === false ? false : undefined, label: hex(L.label), plate: hex(L.plate), dock: hex(L.dock), blur: num(L.blur, 0, 40) } };
}
/** 换主题时整个换上：桌面这时被资源库盖着，在下面重新摆好，回到桌面时图片已经解码完 */
export function setDesk(d) {
  state.library.desk = d; tidy(d); commit('library');
  for (const el of els.values()) el.remove();
  els.clear(); paint(); dress(); renderWidget(true); renderBadges();
}

/* ---------- 画：每个图标 / 组件一个元素，按 id 认；挪位置只改这一个，不整页重画 ---------- */
let homeEl, deskEl, dockEl, dotsEl, editing = false;
const els = new Map();
export function initHome() {
  homeEl = $('#home');
  deskEl = h('div.as-desk', { onscroll: dots, onclick: e => { if (editing && Date.now() - dropAt > 300 && !e.target.closest('.as-desk-item')) edit(false); } });   // 点空白处退出编辑；刚松手那一下不算
  dockEl = h('div.as-home-dock');
  dotsEl = h('div.as-desk-dots');
  homeEl.append(deskEl, h('div.as-desk-bar', h('button.as-desk-bar__add', { 'aria-label': '添加组件', onclick: addPanel }, icon('plus', 20, 2.2)),
    h('button.as-desk-bar__look', { 'aria-label': '图标样式', onclick: lookPanel }, icon('palette', 18, 2)), dotsEl,
    h('button.as-desk-bar__done', { onclick: () => edit(false) }, '完成')), dockEl);
  for (const box of [deskEl, dockEl]) box.addEventListener('pointerdown', grab);
  tidy(desk()); paint(); dress();
  subscribe(w => { if (w === 'all') setDesk(desk()); });   // 导入了整份备份：桌面跟着换
  setInterval(renderWidget, 1000);
  renderWidget(); renderBadges();
}
function paint() {
  const d = desk(), keep = new Set();
  d.pages.forEach((items, i) => {
    const pg = deskEl.children[i] || deskEl.appendChild(h('div.as-desk-page'));
    for (const it of items) {
      const el = elOf(it); keep.add(it.id); area(el, it, it);
      if (el.parentNode !== pg) pg.appendChild(el);
    }
  });
  while (deskEl.children.length > d.pages.length) deskEl.lastChild.remove();
  d.dock.forEach((id, i) => {
    const el = elOf({ id: 'a-' + id, a: id }); keep.add(el.dataset.id); el.style.gridArea = '';
    if (dockEl.children[i] !== el) dockEl.insertBefore(el, dockEl.children[i] || null);
  });
  for (const [id, el] of els) if (!keep.has(id)) { el.remove(); els.delete(id); }
  dockEl.classList.toggle('is-empty', !d.dock.length);
  dots();
}
function elOf(it) {
  let el = els.get(it.id); if (el) return el;
  const x = h('span.as-desk-x', { role: 'button', 'aria-label': '移除', onclick: e => { e.stopPropagation(); drop1(it.id); } }, icon('close', 11, 3.2));
  if (it.a) {
    const a = appOf(it.a);
    el = h('button.as-home-app.as-desk-item', { dataset: { asApp: a.id }, 'aria-label': a.name, onpointerdown: () => { if (!editing) shell.preload(a.id); },
      onclick: e => { if (!editing) shell.openApp(a.id, { from: e.currentTarget.querySelector('.as-home-app__icon') }); } },
    h('span.as-home-app__icon'), h('span.as-home-app__name', a.name), x);
    paintIcon(el, a);
  } else { el = h('div.as-desk-w.as-desk-item', { dataset: { w: it.w } }, h('div.as-desk-w__body'), x); fill(el, it); }
  el.dataset.id = it.id; els.set(it.id, el);
  onLongPress(el, () => { if (!editing && !drag) menu(el.dataset.id); });
  return el;
}
function paintIcon(el, a) {
  const u = desk().icons[a.id], box = el.querySelector('.as-home-app__icon');
  box.classList.toggle('has-img', !!u);
  box.replaceChildren(u ? h('img', { src: u, alt: '', draggable: false }) : icon(a.icon, 28, 1.7));
}
function fill(el, it) {
  el.dataset.s = it.s;
  const body = el.firstChild;
  if (it.w === 'clock') body.replaceChildren(h('div.as-home-widget', h('div.as-home-widget__time'), h('div.as-home-widget__date'), h('div.as-home-widget__sub'), h('div.as-home-widget__msg', { role: 'button', tabindex: 0, hidden: true })));
  if (it.w === 'photo') body.replaceChildren(it.img ? h('img', { src: it.img, alt: '', draggable: false }) : h('span.as-desk-w__empty', icon('image', 26)));
  if (it.w === 'text') body.replaceChildren(h('p', it.text));
  if (it.w === 'html') body.replaceChildren(frame(it));
}
// 自定义组件只要样子：放进不能跑脚本的小框里，碰不到手机里存的密钥；{{名字}} 换成选好的图
const slotKeys = it => [...new Set([...(it.html + ' ' + it.css).matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map(m => m[1]))];
const srcdoc = it => {
  const put = s => s.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (m, k) => String((it.imgs || {})[k] || '').replace(/["'<>()\s]/g, ''));
  return `<!DOCTYPE html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}${put(it.css).replace(/<\/style/gi, '')}</style>${put(it.html)}`;
};
const frame = it => h('iframe', { sandbox: '', srcdoc: srcdoc(it), tabindex: -1, 'aria-hidden': 'true' });

const cur = () => Math.round(deskEl.scrollLeft / (deskEl.clientWidth || 1));
const toPage = (p, smooth = true) => deskEl.scrollTo({ left: p * deskEl.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
function dots() {
  const n = deskEl.children.length, c = cur();
  if (dotsEl.children.length !== n) dotsEl.replaceChildren(...Array.from({ length: n }, () => h('i')));
  [...dotsEl.children].forEach((d, i) => d.classList.toggle('is-on', i === c));
  dotsEl.style.visibility = n > 1 ? '' : 'hidden';
}
function edit(on) {
  editing = on; homeEl.classList.toggle('is-editing', on);
  if (!on) { const d = desk(); d.pages = d.pages.filter((p, i) => p.length || !i); commit('library'); }
  paint();
}

/* ---------- 长按菜单 ---------- */
function find(id) {
  const d = desk();
  for (const p of d.pages) { const it = p.find(x => x.id === id); if (it) return { it, p }; }
  const a = id.slice(2); return d.dock.includes(a) ? { it: { id, a } } : {};
}
async function menu(id) {
  const { it } = find(id); if (!it) return;
  const w = it.w, opts = it.a ? [{ value: 'icon', label: '换图标', icon: 'image' }]
    : [w !== 'clock' && { value: 'edit', label: { photo: '换图片', text: '改文字', html: '编辑' }[w], icon: 'edit' }, SIZES[w].length > 1 && { value: 'size', label: '改大小', icon: 'expand' }, w === 'html' && { value: 'out', label: '导出', icon: 'box' }];
  const v = await actionSheet(it.a ? appOf(it.a).name : it.name || KINDS[w], [...opts.filter(Boolean), { value: 'desk', label: '编辑主屏幕', icon: 'grid' }, { value: 'del', label: it.a ? '从桌面移除' : '删除', icon: 'trash', danger: true }]);
  if (v === 'desk') edit(true);
  if (v === 'del') drop1(id);
  if (v === 'icon') changeIcon(it.a);
  if (v === 'size') resize(it);
  if (v === 'out') {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ asterphone: 'widget', v: 1, name: it.name, s: it.s, html: it.html, css: it.css, imgs: it.imgs })], { type: 'application/json' })), download: `AsterPhone-组件-${it.name || '自定义'}.json` });
    document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
  }
  if (v === 'edit') {
    if (w === 'photo') { const [cw, ch] = cell(), [x, y] = wh(it.s), u = await pickImage('换图片', { ratio: ((x - 1) * cw + ICON) / (y * ch), size: 720 }); if (!u) return; it.img = u; }
    if (w === 'text') { const t = await dialog({ title: '改文字', input: { value: it.text } }); if (!t || !t.trim()) return; it.text = t.trim().slice(0, 200); }
    if (w === 'html' && !(await editHtml(it))) return;
    commit('library'); fill(els.get(id), it);
  }
}
async function drop1(id) {
  const d = desk(), { it, p } = find(id); if (!it) return;
  if (!it.a && !(await dialog({ title: '删除这个组件？', confirm: '删除', danger: true }))) return;
  if (p) p.splice(p.indexOf(it), 1); else d.dock.splice(d.dock.indexOf(it.a), 1);
  if (it.a) d.hidden.push(it.a);
  commit('library'); paint();
  if (it.a) toast(`「${appOf(it.a).name}」放到了「＋」里`);
}
async function changeIcon(id) {
  const has = !!desk().icons[id];
  const v = await actionSheet('换图标', [{ value: 'file', label: '从相册选择', icon: 'image' }, has && { value: 'clear', label: '恢复默认', icon: 'undo' }].filter(Boolean));
  if (v === 'file') { const f = await pickFile('image/*'); if (!f) return; desk().icons[id] = await fileToDataURL(f, 160, 'image/png'); }   // 透明底的图标要留着透明
  else if (v === 'clear') delete desk().icons[id];
  else return;
  commit('library'); paintIcon(els.get('a-' + id), appOf(id));
}
async function resize(it) {
  const s = await actionSheet('改大小', SIZES[it.w].map(v => ({ value: v, label: v.replace('x', ' × '), active: v === it.s }))); if (!s || s === it.s) return;
  const d = desk(), { p } = find(it.id), [w, hh] = wh(s);
  it.s = s;
  if (!fits(p, it.x, it.y, w, hh, it.id)) { const n = spot(d, w, hh, it.id, d.pages.indexOf(p)); p.splice(p.indexOf(it), 1); Object.assign(it, { x: n.x, y: n.y }); d.pages[n.p].push(it); }
  commit('library'); els.get(it.id).dataset.s = s; paint();
}

/* ---------- 图标样式：形状、大小、名字、底板、底栏。改了只换桌面上的几个 CSS 变量，不重画 ---------- */
function dress() {
  const L = desk().look || {}, set = (k, v) => (v ? homeEl.style.setProperty(k, v) : homeEl.style.removeProperty(k));
  set('--desk-r', { circle: '50%', square: '0px', raw: '0px' }[L.shape] || (L.r != null ? L.r + 'px' : ''));
  set('--desk-k', L.k && L.k / 100); set('--desk-fit', L.fit); set('--desk-label', L.label); set('--desk-plate', L.plate);
  set('--dock-bg', L.dock); set('--dock-blur', L.blur != null && L.blur + 'px');
  homeEl.classList.toggle('is-raw', L.shape === 'raw'); homeEl.classList.toggle('no-names', L.names === false);
}
function lookPanel() {
  const d = desk(), L = (d.look = d.look || {}), ch = () => { dress(); commit('library'); };
  const color = (title, key, alpha) => {
    const dot = h('span.as-lib-dot', { style: { background: L[key] || 'transparent' } });
    return item({ title, right: dot, onClick: () => sheet({ title, content: h('div.as-mu-color', colorWheel(L[key] || '#ffffff', v => { L[key] = v; dot.style.background = v; ch(); }, alpha)) }) });
  };
  const row = (label, opt, fmt, key, def) => { const out = h('output', fmt(L[key] ?? def));
    return h('div.as-settings-slider-row', h('span', label), slider({ ...opt, value: L[key] ?? def, onInput: v => { L[key] = v; out.textContent = fmt(v); ch(); } }), out); };
  const rRow = row('圆角', { min: 0, max: 29, step: 1 }, v => v + 'px', 'r', 18);
  rRow.hidden = !!L.shape && L.shape !== 'round';
  const s = sheet({ title: '图标样式', content: h('div.as-desk-look',
    group('图标', [h('div.as-settings-slider-row', h('span', '形状'), segmented(SHAPES, L.shape || 'round', v => { L.shape = v; rRow.hidden = v !== 'round'; ch(); })), rRow,
      row('大小', { min: 70, max: 120, step: 5 }, v => v + '%', 'k', 100),
      h('div.as-settings-slider-row', h('span', '换的图片'), segmented([['cover', '铺满'], ['contain', '完整']], L.fit || 'cover', v => { L.fit = v; ch(); })),
      color('底板', 'plate', true)]),
    group('名字', [toggleItem({ title: '显示名字' }, L.names !== false, v => { L.names = v; ch(); }), color('颜色', 'label')]),
    group('底栏', [color('颜色', 'dock', true), row('模糊', { min: 0, max: 40, step: 1 }, v => v + 'px', 'blur', 20)]),
    btn('恢复默认', 'secondary', () => { d.look = {}; ch(); s.close(); })) });
}

/* ---------- 添加组件 / 找回藏起来的 App ---------- */
function addPanel() {
  const hid = desk().hidden;
  const s = sheet({ title: '添加', content: h('div.as-desk-add',
    h('div.as-desk-add__kinds', ...Object.entries(KINDS).map(([k, n]) => btn(n, 'secondary', () => { s.close(); addWidget(k); })), btn('导入组件', 'secondary', () => { s.close(); importWidget(); })),
    hid.length ? group('桌面上没有的 App', hid.map(id => item({ icon: appOf(id).icon, title: appOf(id).name, right: icon('plus', 18, 2), onClick: () => { s.close(); hid.splice(hid.indexOf(id), 1); put({ id: 'a-' + id, a: id }); } }))) : null) });
}
async function addWidget(k) {
  const s = SIZES[k].length > 1 ? await actionSheet('多大', SIZES[k].map(v => ({ value: v, label: v.replace('x', ' × ') }))) : SIZES[k][0]; if (!s) return;
  const it = { id: uid('w'), w: k, s };
  if (k === 'photo') { const [cw, ch] = cell(), [x, y] = wh(s), u = await pickImage('选图片', { ratio: ((x - 1) * cw + ICON) / (y * ch), size: 720 }); if (!u) return; it.img = u; }
  if (k === 'text') { const t = await dialog({ title: '写点什么', input: { value: '' } }); if (!t || !t.trim()) return; it.text = t.trim().slice(0, 200); }
  if (k === 'html') { Object.assign(it, { name: '', html: '', css: '', imgs: {} }); if (!(await editHtml(it))) return; }
  put(it);
}
function put(it) {
  const d = desk(), [w, hh] = sizeOf(it), n = spot(d, w, hh, it.id, cur());
  Object.assign(it, { x: n.x, y: n.y }); d.pages[n.p].push(it);
  commit('library'); paint(); toPage(n.p);
  if (it.w === 'clock') { renderWidget(true); paintMsg(); }
}
async function importWidget() {
  const f = await pickFile('*/*'); if (!f) return;
  let d = null; try { d = JSON.parse(await f.text()); } catch (e) { /* 下面统一说 */ }
  const it = d && d.asterphone === 'widget' && cleanDesk({ pages: [[{ ...d, w: 'html' }]] }).pages[0][0];
  if (!it) { toast('这不是 AsterPhone 的组件文件'); return; }
  put(it); toast(`导入了「${it.name || '自定义组件'}」`);
}
/** 自定义组件：上面预览，下面写 HTML、CSS；写了 {{名字}} 的地方能选一张图换上 */
function editHtml(it) {
  return new Promise(res => {
    const d = { name: it.name, html: it.html, css: it.css, imgs: { ...it.imgs } }, [x, y] = wh(it.s), [cw, ch] = cell();
    const pv = frame(d), box = h('div.as-desk-pv', { style: { aspectRatio: `${(x - 1) * cw + ICON} / ${y * ch}`, width: x > 2 ? '100%' : '50%' } }, pv), slots = h('div');
    let keys = '';
    const drawSlots = () => {
      const ks = slotKeys(d); if (ks.join() === keys) return; keys = ks.join();
      slots.replaceChildren(ks.length ? group('图片', ks.map(k => { const row = item({ title: k, value: d.imgs[k] ? '已选' : '', chevron: true, onClick: async () => {
        const f = await pickFile('image/*'); if (!f) return;
        d.imgs[k] = await fileToDataURL(f, 720, 'image/webp'); row.querySelector('.as-list-item__value').textContent = '已选'; pv.srcdoc = srcdoc(d);
      } }); return row; })) : null);
    };
    const redo = debounce(() => { pv.srcdoc = srcdoc(d); drawSlots(); }, 300);
    let ok = false;
    const s = sheet({ title: '自定义组件', onClose: () => res(ok), content: h('div.as-desk-edit', box,
      field('名字', input({ value: d.name, onInput: v => { d.name = v.trim().slice(0, 20); } })),
      field('HTML', textarea({ value: d.html, rows: 5, onInput: v => { d.html = v; redo(); } })),
      field('CSS', textarea({ value: d.css, rows: 5, onInput: v => { d.css = v; redo(); } })), slots,
      h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => {
        const ks = slotKeys(d); d.imgs = Object.fromEntries(ks.filter(k => d.imgs[k]).map(k => [k, d.imgs[k]]));
        Object.assign(it, d); ok = true; s.close();
      }))) });
    drawSlots();
  });
}

/* ---------- 拖动：编辑主屏幕时按住挪；压到的东西往后挤开（跟着手指实时让位）；拖到左右边上停一下翻页 ---------- */
let drag = null, slot = null, flipT = 0, dropAt = 0;
/** 当前这页的格子：第一列图标左边在哪、每列隔多远、每行多高（都是屏幕上的像素） */
function cell(pg = deskEl.children[cur()]) {
  const r = pg.getBoundingClientRect(), k = r.width / (pg.offsetWidth || 1), left = r.left + PAD * k, cw = (r.width - 2 * PAD * k - ICON * k) / (COLS - 1);
  return [cw / k, r.height / ROWS / k, { left, top: r.top, cw, ch: r.height / ROWS, k }];
}
function grab(e) {
  if (!editing || e.button > 0 || e.target.closest('.as-desk-x')) return;
  const el = e.target.closest('.as-desk-item'); if (!el) return;
  drag = { el, id: el.dataset.id, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, t: null };
}
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.on) { if (Math.hypot(dx, dy) < 6) return; lift(); }
  drag.ghost.style.transform = `translate(${dx / drag.k}px, ${dy / drag.k}px) scale(1.06)`;
  aim(e);
});
addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pid) land(); });
addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pid) { drag.t = null; land(); } });
function lift() {
  const { el } = drag, r = el.getBoundingClientRect(), hr = homeEl.getBoundingClientRect(), k = hr.width / homeEl.offsetWidth;
  drag.ghost = el.cloneNode(true); drag.ghost.classList.add('as-desk-ghost'); drag.k = k; drag.r = r;
  Object.assign(drag.ghost.style, { left: (r.left - hr.left) / k + 'px', top: (r.top - hr.top) / k + 'px', width: r.width / k + 'px', height: r.height / k + 'px', gridArea: '' });
  homeEl.appendChild(drag.ghost); el.classList.add('is-lifted'); drag.on = true;
  slot = slot || h('div.as-desk-slot');
}
/** 把 it 放到 (x, y)，其余的按原来的先后排：原位空着就不动；被占了就往后挪一格，后面的 App 跟着一个个往后让，
 *  让到空格子（比如拖走的那个留下的坑）为止；组件不跟着让，绕过去（到底了从头找）；这页实在放不下的挤到下一页 */
function squeeze(items, it, x, y) {
  const placed = [{ ...it, x, y }], pos = new Map(), out = [], n = COLS * ROWS;
  const rest = items.filter(o => o.id !== it.id).sort((a, b) => a.y - b.y || a.x - b.x);
  rest.forEach((o, j) => {
    const [w, hh] = sizeOf(o), find = obs => { for (let i = 0; i < n; i++) { const c = (o.y * COLS + o.x + i) % n; if (fits(obs, c % COLS, c / COLS | 0, w, hh)) return { x: c % COLS, y: c / COLS | 0 }; } };
    const at = find(placed.concat(rest.slice(j + 1).filter(r => !r.a))) || find(placed);
    if (at) { pos.set(o.id, at); placed.push({ ...o, ...at }); } else out.push(o);
  });
  return { pos, out };
}
/** 拖的时候这页的东西挪到预演的位置（pos 为空就回原位），从原来的地方滑过去；要挤到下一页的变淡 */
function lay(pi, pos) {
  const list = (desk().pages[pi] || []).filter(o => o.id !== drag.id).map(o => [o, els.get(o.id)]);
  const was = list.map(([, el]) => el.getBoundingClientRect());
  list.forEach(([o, el]) => { area(el, (pos && pos.get(o.id)) || o, o); el.classList.toggle('is-out', !!pos && !pos.has(o.id)); });
  list.forEach(([, el], i) => {
    const r = el.getBoundingClientRect(), dx = (was[i].left - r.left) / drag.k, dy = (was[i].top - r.top) / drag.k; if (!dx && !dy) return;
    el.style.transition = 'none'; el.style.translate = `${dx}px ${dy}px`; el.getBoundingClientRect();
    el.style.transition = 'translate 240ms var(--as-ease-standard)'; el.style.translate = '';
  });
}
const unlay = () => { if (drag.pi != null) lay(drag.pi, null); drag.pi = null; drag.key = ''; };
function aim(e) {
  const d = desk(), { it, p: from } = find(drag.id); drag.t = null; slot.remove(); dockEl.classList.remove('is-over');
  const dr = dockEl.getBoundingClientRect(), kr = deskEl.getBoundingClientRect();
  // 拖到左右边上停一会儿翻页；往右翻到最后一页还有东西，就新开一页
  const edge = e.clientX < kr.left + 24 ? -1 : e.clientX > kr.right - 24 ? 1 : 0;
  if (!edge) { clearTimeout(flipT); flipT = 0; }
  else if (!flipT) flipT = setTimeout(() => {
    flipT = 0; const c = cur() + edge; if (c < 0) return;
    if (c >= d.pages.length) { if (!d.pages[c - 1].some(x => x.id !== drag.id)) return; d.pages.push([]); paint(); }
    toPage(c); setTimeout(() => drag && aim(e), 360);
  }, 520);
  if (it.a && e.clientY > dr.top - 10) {
    const kids = [...dockEl.children].filter(x => x !== drag.el), i = kids.filter(x => x.getBoundingClientRect().left + x.offsetWidth / 2 < e.clientX).length;
    unlay();
    if (!from || d.dock.length < DOCK) { drag.t = { dock: i }; dockEl.classList.add('is-over'); }
    return;
  }
  const pi = cur(), pg = deskEl.children[pi], [, , g] = cell(pg), [w, hh] = sizeOf(it);
  const gr = drag.ghost.getBoundingClientRect();
  const x = it.a ? Math.round((e.clientX - g.left - ICON * g.k / 2) / g.cw) : Math.round((gr.left + (gr.width - drag.r.width) / 2 - g.left) / g.cw);
  const y = it.a ? Math.floor((e.clientY - g.top) / g.ch) : Math.round((gr.top + (gr.height - drag.r.height) / 2 - g.top) / g.ch);
  const cx = clamp(x, 0, COLS - w), cy = clamp(y, 0, ROWS - hh), key = [pi, cx, cy].join();
  if (drag.key !== key) { if (drag.pi !== pi) unlay(); drag.s = squeeze(d.pages[pi], it, cx, cy); drag.pi = pi; drag.key = key; lay(pi, drag.s.pos); }   // 换了格子才重新排，手指在同一格里晃不动
  drag.t = { p: pi, x: cx, y: cy };
  area(slot, drag.t, it); pg.appendChild(slot);
}
function land() {
  const { el, id, t, ghost, s } = drag; clearTimeout(flipT); flipT = 0;
  if (ghost && (!t || t.dock != null)) unlay();
  drag = null; if (!ghost) return;
  dropAt = Date.now(); ghost.remove(); el.classList.remove('is-lifted'); slot.remove(); dockEl.classList.remove('is-over');
  homeEl.querySelectorAll('.is-out').forEach(x => x.classList.remove('is-out'));
  if (!t) return;
  const d = desk(), { it, p: from } = find(id);
  if (from) from.splice(from.indexOf(it), 1); else d.dock.splice(d.dock.indexOf(it.a), 1);
  if (t.dock != null) d.dock.splice(t.dock, 0, it.a);
  else {
    const to = d.pages[t.p];
    for (const o of s.out) { to.splice(to.indexOf(o), 1); const [w, hh] = sizeOf(o), n = spot(d, w, hh, o.id, t.p + 1); d.pages[n.p].push(Object.assign(o, { x: n.x, y: n.y })); }
    to.forEach(o => Object.assign(o, s.pos.get(o.id)));
    to.push(Object.assign(it, { x: t.x, y: t.y }));
  }
  commit('library'); paint();
}

/* ---------- 时钟组件：时间、日期，顺便显示最新一条未读 ---------- */
let wKey = '';
export function renderWidget(force) {
  if (!homeEl) return;
  const n = time.now(), k = n.hm + n.ap + n.date + n.sub; if (k === wKey && force !== true) return; wKey = k;   // 每秒都来一次：没变就什么都不碰
  homeEl.querySelectorAll('.as-desk-w[data-w="clock"] .as-home-widget').forEach(w => {
    const [t, d, s] = w.children;
    t.textContent = n.hm; if (n.ap) t.appendChild(h('small', n.ap)); d.textContent = n.date; s.textContent = n.sub;
  });
}
export function renderBadges() {
  if (!homeEl) return;
  const total = state.chats.reduce((s, c) => s + (c.muted ? 0 : c.unread || 0), 0), chat = els.get('a-chat');
  chat?.querySelectorAll('.as-badge').forEach(b => b.remove());
  if (chat && state.settings.notify.badge && total) chat.appendChild(badge(total));
  // 岁岁砂：有没落下的沙就挂红点
  loadMem().then(d => { const a = els.get('a-memory'), b = state.settings.notify.badge && badge(d.wait.length); if (!a) return; a.querySelectorAll('.as-badge').forEach(x => x.remove()); if (b) a.appendChild(b); })
    .catch(e => log('warn', '岁岁砂', '读不到未落的沙：' + e.message));
  paintMsg();
}
function paintMsg() {
  const latest = state.chats.filter(c => c.unread > 0 && !c.muted).sort((a, b) => b.lastAt - a.lastAt)[0];
  const p = latest && (latest.type === 'group' ? { name: latest.name } : (contact(latest.contactId) || {}));
  homeEl.querySelectorAll('.as-desk-item .as-home-widget__msg').forEach(m => {
    m.hidden = !latest; m.replaceChildren();
    if (latest) {
      m.append(icon('chat', 16, 1.8), h('span', h('b', (p.remark || p.nick || p.name || '联系人') + '：'), latest.lastText));
      m.onclick = () => { if (!editing) shell.openApp('chat', { from: m, chat: latest.id }); };
    }
  });
}
export function showHome(on) { homeEl.classList.toggle('is-open', on); homeEl.setAttribute('aria-hidden', on ? 'false' : 'true'); }
