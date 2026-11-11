// 歌词悬浮窗：一句歌词（下面一行翻译）浮着，放在小手机里或者酒馆聊天页面上；
// 没锁定时一根手指拖着挪、两根手指捏着改大小，点一下出小面板改颜色、大小、字体、锁定；锁定了点一下问要不要解锁。
// 网页没法浮在别的 App 上面，所以没有「全局」。
import { state, commit, kvGet } from './store.js';
import * as P from './music.js';

// 内置字体都是能免费商用的（OFL / MIT），从 jsDelivr 按需下载，只在选中时才下
const CDN = 'https://cdn.jsdelivr.net/npm/';
export const FONTS = [
  ['', '默认'],
  ['Noto Sans SC', '思源黑体', '@fontsource/noto-sans-sc@5.3.1/400.css'],
  ['Noto Serif SC', '思源宋体', '@fontsource/noto-serif-sc@5.3.1/400.css'],
  ['LXGW WenKai', '霞鹜文楷', '@chinese-fonts/lxgwwenkai@3.0.0/dist/LXGWWenKai-Regular/result.css'],
  ['Smiley Sans Oblique', '得意黑', '@chinese-fonts/dyh@3.0.0/dist/SmileySans-Oblique/result.css'],
  ['Huiwen-mincho', '汇文明朝体', '@chinese-fonts/hwmct@3.0.0/dist/%E6%B1%87%E6%96%87%E6%98%8E%E6%9C%9D%E4%BD%93/result.css'],
  ['Zhuque Fangsong (technical preview)', '朱雀仿宋', '@chinese-fonts/zqfs@3.0.0/dist/ZhuqueFangsong-Regular/result.css'],
  ['ZCOOL KuaiLe', '站酷快乐体', '@fontsource/zcool-kuaile@5.3.0/400.css'],
  ['ZCOOL XiaoWei', '站酷小薇', '@fontsource/zcool-xiaowei@5.3.0/400.css'],
  ['ZCOOL QingKe HuangYou', '站酷庆科黄油体', '@fontsource/zcool-qingke-huangyou@5.3.0/400.css'],
  ['Ma Shan Zheng', '马善政楷书', '@fontsource/ma-shan-zheng@5.3.1/400.css'],
  ['Long Cang', '龙藏体', '@fontsource/long-cang@5.3.0/400.css'],
  ['Zhi Mang Xing', '志莽行书', '@fontsource/zhi-mang-xing@5.3.0/400.css'],
];
export const cfg = () => state.music.float || (state.music.float = { where: 'off', color: '#ffffff', size: 18, font: '', lock: false, x: .5, y: .78 });
let el = null, li = -2;
const host = () => ({ phone: document, tavern: parent.document })[cfg().where] || null;

/** 字体装进悬浮窗所在的那一页：内置的挂一个 CSS；字体库里的从存着的文件装（酒馆页面那边没装过） */
export async function useFont(doc, f) {
  const b = FONTS.find(x => x[0] === f);
  if (b) {
    if (b[2] && !doc.querySelector(`link[data-aster-font="${b[2]}"]`)) { const l = Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: CDN + b[2] }); l.dataset.asterFont = b[2]; doc.head.append(l); }
    return f ? `"${f}"` : '';
  }
  const id = f.slice(2), fam = 'AsterUser-' + id;
  if (doc !== document && ![...doc.fonts].some(x => x.family === fam)) {
    const r = ((await kvGet('fonts:clock').catch(() => null)) || []).find(x => x.id === id); if (!r) return '';
    const face = new doc.defaultView.FontFace(fam, await r.blob.arrayBuffer()); await face.load(); doc.fonts.add(face);
  }
  return `"${fam}"`;
}

/** 按设置摆好（换位置、改颜色字体都走这里）；选「关」就拿掉 */
export async function applyFloat() {
  const doc = host();
  if (el && el.ownerDocument !== doc) { el.remove(); panel && panel.remove(); el = panel = null; }
  if (!doc) return;
  if (!el) {
    el = doc.createElement('div');
    // width:max-content：挪到边上时不会被挤着换行（以前一挪大小就变）
    el.style.cssText = 'position:fixed;z-index:2147483000;transform:translate(-50%,-50%);width:max-content;max-width:90vw;text-align:center;line-height:1.35;text-shadow:0 1px 4px rgba(0,0,0,.55);touch-action:none;user-select:none;cursor:grab';
    line = doc.createElement('div'); tr = doc.createElement('div'); tr.style.cssText = 'font-size:.72em;opacity:.85;margin-top:2px';
    el.append(line, tr);
    el.addEventListener('pointerdown', down);
    doc.addEventListener('pointerdown', e => { if (panel && !panel.contains(e.target) && !el.contains(e.target)) close(); });
    doc.body.append(el); li = -2; paint();
  }
  const c = cfg();
  Object.assign(el.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', color: c.color, fontSize: c.size + 'px', cursor: c.lock ? 'pointer' : 'grab' });
  el.style.fontFamily = c.font ? `${await useFont(doc, c.font)}, sans-serif` : '';
}
/* ---------- 手势（作者定的）：一根手指拖着挪（锁定时不动）；两根手指捏着改大小；点一下：
   没锁定 → 旁边出一个小面板（颜色、大小、字体、锁定）；锁定了 → 只问要不要解锁 ---------- */
let line = null, tr = null, panel = null;
const pts = new Map();
let pinch = null, moved = false, start = null;
function down(e) {
  e.preventDefault(); el.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pts.size === 1) { moved = false; start = [e.clientX, e.clientY]; }
  if (pts.size === 2 && !cfg().lock) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: cfg().size }; moved = true; }
  el.onpointermove = move; el.onpointerup = el.onpointercancel = up;
}
function move(ev) {
  if (!pts.has(ev.pointerId)) return;
  pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
  const c = cfg();
  if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; c.size = Math.round(Math.min(48, Math.max(12, pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d))); el.style.fontSize = c.size + 'px'; place(); return; }
  if (pinch || c.lock) return;
  if (!moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 6) return;
  moved = true; close();
  const w = el.ownerDocument.defaultView;
  const hw = el.offsetWidth / 2 / w.innerWidth, hh = el.offsetHeight / 2 / w.innerHeight;   // 整句都留在屏幕里
  c.x = Math.min(1 - hw, Math.max(hw, ev.clientX / w.innerWidth)); c.y = Math.min(1 - hh, Math.max(hh, ev.clientY / w.innerHeight)); el.style.left = c.x * 100 + '%'; el.style.top = c.y * 100 + '%';
}
function up(ev) {
  pts.delete(ev.pointerId); if (pts.size) return;
  el.onpointermove = el.onpointerup = el.onpointercancel = null;
  if (moved) { pinch = null; commit('music'); return; }
  panel ? close() : open();
}
const close = () => { if (panel) { panel.remove(); panel = null; } el.style.outline = ''; };
const COLORS = ['#ffffff', '#000000', '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'];
function open() {
  const doc = el.ownerDocument, c = cfg(), mk = (tag, css, text) => { const x = doc.createElement(tag); x.style.cssText = css; if (text != null) x.textContent = text; return x; };
  const btn = (text, fn) => { const b = mk('button', 'flex:1;border:0;border-radius:14px;padding:7px 12px;background:rgba(255,255,255,.14);color:#fff;font:500 13px/1 sans-serif;cursor:pointer', text); b.onclick = e => { e.stopPropagation(); fn(b); }; return b; };
  const save = () => { commit('music'); applyFloat(); };
  panel = mk('div', 'position:fixed;z-index:2147483001;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:16px;background:rgba(28,28,32,.88);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 8px 24px rgba(0,0,0,.35);color:#fff;font:13px/1.2 sans-serif');
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  // 最下面一排：锁定 / 解锁 · 关闭悬浮窗（关了要回音乐 App 的「歌词悬浮窗」里再打开）
  const off = btn('关闭悬浮窗', () => { c.where = 'off'; close(); save(); }), last = mk('div', 'display:flex;gap:8px');
  if (c.lock) { last.append(btn('解锁', () => { c.lock = false; close(); save(); }), off); panel.append(last); }
  else {
    el.style.outline = '1.5px dashed rgba(255,255,255,.85)'; el.style.outlineOffset = '8px';
    const dots = mk('div', 'display:flex;gap:7px;flex-wrap:wrap;max-width:236px');
    const paintDots = () => [...dots.children].forEach(d => { d.style.boxShadow = d.dataset.c === c.color ? '0 0 0 2px #fff' : 'inset 0 0 0 1px rgba(255,255,255,.35)'; });
    for (const col of COLORS) { const d = mk('button', `width:20px;height:20px;border:0;border-radius:50%;padding:0;cursor:pointer;background:${col}`); d.dataset.c = col; d.onclick = () => { c.color = col; paintDots(); save(); }; dots.append(d); }
    paintDots();
    const n = mk('span', 'min-width:2em;text-align:center', c.size);
    const step = k => () => { c.size = Math.min(48, Math.max(12, c.size + k)); n.textContent = c.size; save(); place(); };
    const font = mk('select', 'flex:1;min-width:0;border:0;border-radius:10px;padding:6px 8px;background:rgba(255,255,255,.14);color:#fff;font:13px sans-serif');
    for (const [v, name] of FONTS) { const o = mk('option', 'color:#000', name); o.value = v; o.selected = v === (c.font || ''); font.append(o); }
    if (c.font && !FONTS.some(f => f[0] === c.font)) { const o = mk('option', 'color:#000', '字体库里的'); o.value = c.font; o.selected = true; font.append(o); }
    font.onchange = () => { c.font = font.value; save(); };
    const row = mk('div', 'display:flex;align-items:center;gap:8px'); row.append(mk('span', '', '大小'), btn('A−', step(-2)), n, btn('A+', step(2)), font);
    last.append(btn('锁定', () => { c.lock = true; close(); save(); }), off);
    panel.append(dots, row, last);
  }
  doc.body.append(panel); place();
}
/** 面板放在歌词下面（下面放不下就放上面），左右不出屏 */
function place() {
  if (!panel) return;
  const w = el.ownerDocument.defaultView, r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
  const top = r.bottom + 14 + p.height < w.innerHeight ? r.bottom + 14 : Math.max(8, r.top - 14 - p.height);
  Object.assign(panel.style, { top: top + 'px', left: Math.min(w.innerWidth - p.width - 8, Math.max(8, r.left + r.width / 2 - p.width / 2)) + 'px' });
}
/** 换到下一句才改字（一秒好几次的进度更新里，大多数时候什么都不动） */
function paint() {
  if (!el) return;
  const L = P.lyricsNow(), t = P.now(), s = P.current();
  let i = -1; while (i + 1 < L.length && L[i + 1].t <= t) i++;
  if (i === li && L.length) return;
  li = i;
  const x = L[i] || {};
  line.textContent = L.length ? x.text || '' : s ? `${s.name} - ${s.artist}` : '';
  tr.textContent = x.tr || '';
  el.hidden = !s;
}
P.onMusic(w => { if (w === 'lyrics' || w === 'song') li = -2; if (w === 'time' || w === 'lyrics' || w === 'song') paint(); });
applyFloat();
