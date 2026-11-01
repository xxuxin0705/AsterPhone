// 小工具：建元素、防抖、编号、时间格式、拼音首字母

// 让 el.append(...) / replaceChildren(...) 自动跳过 null 和 false，写条件内容时不会冒出「null」字样。
// 手机在自己的 iframe 里，改的是自己这份 Element，不影响酒馆页面。
for (const k of ['append', 'prepend', 'replaceChildren']) {
  const raw = Element.prototype[k];
  Element.prototype[k] = function (...n) { return raw.apply(this, n.filter(x => x != null && x !== false)); };
}

/** h('div.as-card#id', {onclick}, child1, child2...) */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const pad = n => String(n).padStart(2, '0');
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/** 聊天列表里的时间：今天 21:20 / 昨天 / 10月30日 */
export function shortTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 中文按拼音排序、取首字母（借浏览器自带的拼音排序规则） */
const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' });
const BOUNDS = '阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥扨它穵夕丫帀'.split('');
const LETTERS = 'ABCDEFGHJKLMNOPQRSTWXYZ'.split('');
export function initial(s) {
  const c = String(s || '').trim()[0];
  if (!c) return '#';
  if (/[a-z]/i.test(c)) return c.toUpperCase();
  if (!/[一-鿿]/.test(c)) return '#';
  let i = BOUNDS.length - 1;
  while (i >= 0 && collator.compare(c, BOUNDS[i]) < 0) i--;
  return i < 0 ? '#' : LETTERS[i];
}
export const sortZh = (a, b) => collator.compare(a, b);

/** 文件 → dataURL（发图片、表情用），顺手压缩到 maxSize 以内。
 *  不先把整张原图读成一长串文字（手机拍的照片有十几兆，那样很卡、还会把页面撑崩），直接让浏览器打开文件 */
export function fileToDataURL(file, maxSize = 512) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', .86));
    };
    img.onerror = e => { URL.revokeObjectURL(url); rej(e); }; img.src = url;
  });
}
export function pickFile(accept = 'image/*') {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => res(i.files[0] || null); i.click();
  });
}

/** 长按：手指按住 ms 毫秒触发，移动太多就取消 */
export function onLongPress(el, fn, ms = 480) {
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', e => {
    fired = false; sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => { fired = true; fn(e); }, ms);
  });
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel(); });
  el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (!fired) { cancel(); fn(e); } });
  el.addEventListener('click', e => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
}
