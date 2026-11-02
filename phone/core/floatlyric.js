// 歌词悬浮窗：一句歌词（下面一行翻译）浮着，放在小手机里或者酒馆聊天页面上；
// 没锁定时能拖着挪；点一下出一个框：拖右下角的点改大小，点右上角的锁锁住（锁住后点到它会穿过去点到下面，要回小手机里解锁）。
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
];
export const cfg = () => state.music.float || (state.music.float = { where: 'off', color: '#ffffff', size: 18, font: '', lock: false, x: .5, y: .78 });
let el = null, li = -2, grip = null, lockBtn = null;
const host = () => ({ phone: document, tavern: parent.document })[cfg().where] || null;

/** 字体装进悬浮窗所在的那一页：内置的挂一个 CSS；字体库里的从存着的文件装（酒馆页面那边没装过） */
export async function useFont(doc, f) {
  const b = FONTS.find(x => x[0] === f);
  if (b) { if (b[2] && !doc.querySelector(`link[data-aster-font="${b[2]}"]`)) doc.head.append(Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: CDN + b[2], dataset: { asterFont: b[2] } })); return f ? `"${f}"` : ''; }
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
  if (el && el.ownerDocument !== doc) { el.remove(); el = null; grip = null; }
  if (!doc) return;
  if (!el) {
    el = doc.createElement('div');
    el.style.cssText = 'position:fixed;z-index:2147483000;transform:translate(-50%,-50%);max-width:90vw;text-align:center;line-height:1.35;text-shadow:0 1px 4px rgba(0,0,0,.55);touch-action:none;user-select:none;cursor:grab';
    el.append(doc.createElement('div'), doc.createElement('div'));
    el.lastChild.style.cssText = 'font-size:.72em;opacity:.85;margin-top:2px';
    // 编辑框：虚线框 + 右下角拖大小的点 + 右上角的锁（框和点不带字的颜色，白底黑边，什么背景都看得见）
    const knob = (css, html) => { const k = doc.createElement('b'); k.style.cssText = 'position:absolute;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;color:#222;box-shadow:0 1px 4px rgba(0,0,0,.4);font:14px/1 sans-serif;text-shadow:none;' + css; k.innerHTML = html; return k; };
    grip = knob('right:-11px;bottom:-11px;cursor:nwse-resize', '');
    lockBtn = knob('right:-11px;top:-11px;cursor:pointer', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>');
    grip.addEventListener('pointerdown', resize);
    lockBtn.addEventListener('pointerdown', e => { e.stopPropagation(); cfg().lock = true; commit('music'); editing(false); applyFloat(); });
    el.addEventListener('pointerdown', drag);
    doc.addEventListener('pointerdown', e => { if (el && !el.contains(e.target)) editing(false); });
    doc.body.append(el); li = -2; paint();
  }
  const c = cfg();
  Object.assign(el.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', color: c.color, fontSize: c.size + 'px', pointerEvents: c.lock ? 'none' : 'auto' });
  if (c.lock) editing(false);
  el.style.fontFamily = c.font ? `${await useFont(doc, c.font)}, sans-serif` : '';
}
/** 编辑框开 / 关 */
function editing(on) { if (!grip) return; if (on) el.append(grip, lockBtn); else { grip.remove(); lockBtn.remove(); } el.style.outline = on ? '1.5px dashed rgba(255,255,255,.85)' : ''; el.style.outlineOffset = '8px'; }
/** 拖着挪；没挪动就算点了一下，开 / 关编辑框 */
function drag(e) {
  e.preventDefault(); el.setPointerCapture(e.pointerId);
  const w = el.ownerDocument.defaultView, x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  el.onpointermove = ev => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    moved = true;
    const c = cfg(); c.x = Math.min(.95, Math.max(.05, ev.clientX / w.innerWidth)); c.y = Math.min(.97, Math.max(.03, ev.clientY / w.innerHeight)); el.style.left = c.x * 100 + '%'; el.style.top = c.y * 100 + '%';
  };
  el.onpointerup = () => { el.onpointermove = el.onpointerup = null; if (moved) commit('music'); else editing(!grip.isConnected); };
}
/** 拖右下角的点：离中心越远字越大 */
function resize(e) {
  e.preventDefault(); e.stopPropagation(); grip.setPointerCapture(e.pointerId);
  const c = cfg(), r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d0 = Math.hypot(e.clientX - cx, e.clientY - cy), s0 = c.size;
  grip.onpointermove = ev => { c.size = Math.round(Math.min(48, Math.max(12, s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0))); el.style.fontSize = c.size + 'px'; };
  grip.onpointerup = () => { grip.onpointermove = grip.onpointerup = null; commit('music'); };
}
/** 换到下一句才改字（一秒好几次的进度更新里，大多数时候什么都不动） */
function paint() {
  if (!el) return;
  const L = P.lyricsNow(), t = P.now(), s = P.current();
  let i = -1; while (i + 1 < L.length && L[i + 1].t <= t) i++;
  if (i === li && L.length) return;
  li = i;
  const x = L[i] || {};
  el.firstChild.textContent = L.length ? x.text || '' : s ? `${s.name} - ${s.artist}` : '';
  el.lastChild.textContent = x.tr || '';
  el.hidden = !s;
}
P.onMusic(w => { if (w === 'lyrics' || w === 'song') li = -2; if (w === 'time' || w === 'lyrics' || w === 'song') paint(); });
applyFloat();
