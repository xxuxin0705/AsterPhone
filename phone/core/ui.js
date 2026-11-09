// 公共积木：页面、顶栏、列表组、开关、分段选择、滑块、抽屉、弹窗、轻提示……
// 类名都按设计规范的门牌号来（as-xxx），皮肤靠这些名字改样子。
import { h, $, pickFile } from './util.js';
import { state } from './store.js';

let root = null;
export function mountUI(phoneEl) { root = phoneEl; }

/* ---------- 图标（细线条） ---------- */
const P = {
  back: 'M15 5l-7 7 7 7', chevron: 'M9 6l6 6-6 6', plus: 'M12 5v14M5 12h14', more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4', close: 'M6 6l12 12M18 6 6 18', check: 'M5 12.5l4.5 4.5L19 7', undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', note: 'M7 4h10l3 3v13H7zM10 10h7M10 14h7M10 18h4',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.3-1.1-1.4-1.1-2.6 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2', db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', eyeOff: 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2', chat: 'M4 5h16v11H9l-5 4z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-5-6.7',
  moments: 'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 3v9l6 4', camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z', comment: 'M4 5h16v11H9l-5 4z',
  sparkle: 'M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  send: 'M4 12l16-8-6 16-3-7z', play: 'M8 5v14l11-7z', pause: 'M8 5v14M16 5v14', prev: 'M18 6v12L9 12zM6 6v12', next: 'M6 6v12l9-6zM18 6v12',
  shuffle: 'M4 7h3c3 0 4.5 1.5 6 5s3 5 6 5h1M4 17h3c1.6 0 2.7-.5 3.6-1.3M14.4 8.3C15.3 7.5 16.4 7 18 7h2M17 4l3 3-3 3M17 14l3 3-3 3', repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h16M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4', repeatOne: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h16M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4M11 10l1.5-1v6', music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', down: 'M6 9l6 6 6-6', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01', mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  wallet: 'M4 7h15v12H4zM4 7l11-3v3M16 13h.01', bookmark: 'M7 4h10v17l-5-4-5 4z', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  tree: 'M12 21v-7M12 14l-3-3M12 15l3-3M12 3a6 6 0 0 0-5.6 8.2A4 4 0 0 0 8 19h8a4 4 0 0 0 1.6-7.8A6 6 0 0 0 12 3z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  headphones: 'M4 16v-4a8 8 0 0 1 16 0v4M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12', rain: 'M7 14a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 5.5a4 4 0 0 1 .5 8.5zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  flame: 'M12 21c-3.9 0-7-2.7-7-6.5 0-3.3 2.4-5.2 3.6-8.5.4 1.9 1.6 3 2.6 3.4C11.4 6.6 13 4.4 15 3c-.3 3 3 5.4 3.9 8.3.3 1 .1 2.2.1 3.2 0 3.8-3.1 6.5-7 6.5z',
};
export function icon(name, size = 22, stroke = 1.7) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', stroke);
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.info); s.appendChild(p);
  return s;
}

/* ---------- 页面 ---------- */
export function page({ app, id, title = '', large = false, back = true, right = null, onBack = null, cls = '' }) {
  const backBtn = back ? h('button.as-navbar__back', { 'aria-label': '返回', onclick: () => (onBack ? onBack() : root.dispatchEvent(new CustomEvent('as-back'))) }, icon('back', 24, 2)) : h('span.as-navbar__spacer');
  const titleEl = h('div.as-navbar__title', title);
  const nav = h('header.as-navbar', backBtn, titleEl, h('div.as-navbar__right', right));
  const body = h('div.as-page__body');
  if (large) nav.classList.add('is-inline');   // 标题直接放在返回键旁边
  const el = h('section.as-page' + (cls ? '.' + cls : ''), { dataset: { asApp: app, asPage: id } }, nav, body);
  body.addEventListener('scroll', () => nav.classList.toggle('is-scrolled', body.scrollTop > 8), { passive: true });
  return { el, body, nav, setTitle: t => { titleEl.textContent = t; } };
}
export const navBtn = (iconName, label, onclick) => h('button.as-navbar__btn', { 'aria-label': label, onclick }, icon(iconName, 22, iconName === 'more' ? 3.2 : 1.8));
export const navText = (label, onclick, primary = false) => h('button.as-navbar__text' + (primary ? '.is-primary' : ''), { onclick }, label);

/* ---------- 列表 ---------- */
export function group(header, items, footer) {
  return h('div.as-list-group', header && h('div.as-list-group__header', header), h('div.as-list-group__body', items), footer && h('div.as-list-group__footer', footer));
}
const ICON_COLORS = { blue: '#6d8fd8', orange: '#f0a067', green: '#6dbb93', purple: '#9b87d8', pink: '#e48ba6', gray: '#9aa0ab', teal: '#5fb2b8', red: '#e5787a', gold: '#d9b25f' };
export function item({ icon: ic, color = 'blue', title, sub, value, chevron = false, onClick, right, danger = false, cls = '' }) {
  const el = h('div.as-list-item' + (cls ? '.' + cls : '') + (danger ? '.as-list-item--danger' : '') + (onClick ? '.is-tappable' : ''),
    { role: onClick ? 'button' : null, tabindex: onClick ? 0 : null, onclick: onClick, onkeydown: onClick ? e => { if (e.key === 'Enter') onClick(e); } : null },
    ic && h('span.as-list-item__icon', { style: { background: ICON_COLORS[color] || color } }, typeof ic === 'string' ? icon(ic, 17, 2) : ic),
    h('div.as-list-item__main', h('div.as-list-item__title', title), sub && h('div.as-list-item__sub', sub)),
    value != null && h('div.as-list-item__value', value),
    right, chevron && h('span.as-list-item__chevron', icon('chevron', 16, 2)));
  return el;
}
export function switchEl(on, onChange, label) {
  const b = h('button.as-switch', { role: 'switch', 'aria-checked': String(!!on), 'aria-label': label || '开关' });
  b.classList.toggle('is-active', !!on);
  b.addEventListener('click', e => { e.stopPropagation(); on = !on; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', String(on)); onChange && onChange(on); });
  return b;
}
export function toggleItem(opts, on, onChange) { return item({ ...opts, right: switchEl(on, onChange, typeof opts.title === 'string' ? opts.title : opts.title.textContent) }); }
export function segmented(options, value, onChange, idBase) {
  const wrap = h('div.as-segmented', { role: 'tablist' });
  options.forEach(([v, label]) => {
    const b = h('button', { id: idBase ? `${idBase}-${v}` : null, role: 'tab', onclick: e => {
      e.stopPropagation(); if (value === v) return; value = v;
      [...wrap.children].forEach(x => x.classList.toggle('is-active', x === b)); onChange(v, b);
    } }, label);
    if (v === value) b.classList.add('is-active');
    wrap.appendChild(b);
  });
  return wrap;
}
export function slider({ min = 0, max = 1, step = .01, value = 0, onInput, id }) {
  const s = h('input.as-slider', { type: 'range', min, max, step, value, id });
  s.addEventListener('input', () => onInput(parseFloat(s.value)));
  return s;
}
/** 圆形色轮：手指按到哪就是哪个颜色（越往外越鲜艳），下面一条调亮暗。onChange 收到 #rrggbb。所有选颜色的地方都用它 */
/** alpha：多一根「透明度」（气泡用），出来的是 #rrggbbaa */
export function colorWheel(hex, onChange, alpha) {
  const toHsv = x => { const n = parseInt(x.slice(1, 7), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    const hh = !d ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx]; };
  const toHex = (hh, s, v) => { const f = k => { const m = (k + hh / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(m, 4 - m, 1)))); }; return '#' + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, '0')).join(''); };
  let [hu, sa, va] = toHsv(hex), al = hex.length > 7 ? parseInt(hex.slice(7), 16) / 255 : 1;
  const out2 = () => toHex(hu, sa, va) + (alpha ? Math.round(al * 255).toString(16).padStart(2, '0') : '');
  const R = 90, cvs = h('canvas.as-wheel__disc', { width: R * 4, height: R * 4 }), knob = h('span.as-wheel__knob'), ctx = cvs.getContext('2d'), img = ctx.createImageData(R * 4, R * 4);
  for (let y = 0; y < R * 4; y++) for (let x = 0; x < R * 4; x++) {
    const dx = x - R * 2, dy = y - R * 2, r = Math.hypot(dx, dy) / (R * 2); if (r > 1) continue;
    const c = toHex((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r, 1), i = (y * R * 4 + x) * 4, n = parseInt(c.slice(1), 16);
    img.data[i] = n >> 16 & 255; img.data[i + 1] = n >> 8 & 255; img.data[i + 2] = n & 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const place = () => { const a = hu * Math.PI / 180; knob.style.left = 50 + Math.cos(a) * sa * 50 + '%'; knob.style.top = 50 + Math.sin(a) * sa * 50 + '%'; knob.style.background = toHex(hu, sa, va); cvs.style.filter = `brightness(${.25 + va * .75})`; };
  const pick = e => { const r = cvs.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
    hu = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; sa = Math.min(1, Math.hypot(dx, dy) / (r.width / 2)); place(); onChange(out2()); };
  const wrap = h('div.as-wheel__wrap', { 'data-no-swipe': '' }, cvs, knob);
  wrap.addEventListener('pointerdown', e => { e.preventDefault(); wrap.setPointerCapture(e.pointerId); pick(e); });
  wrap.addEventListener('pointermove', e => { if (wrap.hasPointerCapture(e.pointerId)) pick(e); });
  const out = h('output', Math.round(va * 100) + '%'), sl = slider({ min: 0, max: 1, step: .01, value: va, onInput: v => { va = v; out.textContent = Math.round(v * 100) + '%'; place(); onChange(out2()); } });
  place();
  // 常用色一排小圆点：纯白、纯黑在盘上很难点准（白要正好圆心，黑要亮度拉到 0），点一下直接选中，盘和亮度跟着跳过去
  const swatches = h('div.as-wheel__swatches', ...['#ffffff', '#000000', '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'].map(c =>
    h('button.as-wheel__swatch', { type: 'button', 'aria-label': c, style: { background: c }, onclick: () => { [hu, sa, va] = toHsv(c); sl.value = va; out.textContent = Math.round(va * 100) + '%'; place(); onChange(out2()); } })));
  const aOut = h('output', Math.round((1 - al) * 100) + '%');
  return h('div.as-wheel', swatches, wrap, h('div.as-settings-slider-row', h('span', '亮度'), sl, out),
    alpha ? h('div.as-settings-slider-row', h('span', '透明度'), slider({ min: 0, max: 1, step: .01, value: 1 - al, onInput: v => { al = 1 - v; aOut.textContent = Math.round(v * 100) + '%'; onChange(out2()); } }), aOut) : null);
}
/** 一根滑条两个圆点，拖出一个范围（回复 1–5 条）。是两根叠在一起的滑条，只有圆点能按 */
export function rangeRow(label, { min, max, value: [lo, hi], unit = '条', onInput }) {
  const out = h('output'), box = h('div.as-range');
  const a = h('input.as-slider', { type: 'range', min, max, step: 1, value: lo }), b = h('input.as-slider', { type: 'range', min, max, step: 1, value: hi });
  const pct = v => (v - min) / (max - min) * 100 + '%';
  const paint = () => { out.textContent = `${lo}–${hi} ${unit}`; box.style.setProperty('--lo', pct(lo)); box.style.setProperty('--hi', pct(hi)); a.style.zIndex = lo === max ? 2 : ''; };
  a.addEventListener('input', () => { lo = Math.min(+a.value, hi); a.value = lo; paint(); onInput([lo, hi]); });
  b.addEventListener('input', () => { hi = Math.max(+b.value, lo); b.value = hi; paint(); onInput([lo, hi]); });
  box.append(a, b); paint();
  return h('div.as-settings-slider-row', h('span', label), box, out);
}
export function input({ value = '', placeholder = '', type = 'text', onInput, id, cls = '' }) {
  const i = h('input.as-input' + (cls ? '.' + cls : ''), { value, placeholder, type, id, autocomplete: 'off', spellcheck: false });
  if (onInput) i.addEventListener('input', () => onInput(i.value));
  return i;
}
export function textarea({ value = '', placeholder = '', rows = 4, onInput, id }) {
  const t = h('textarea.as-textarea', { placeholder, rows, id, spellcheck: false });
  t.value = value;
  const grow = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 640) + 'px'; };
  t.addEventListener('input', () => { grow(); onInput && onInput(t.value); });
  requestAnimationFrame(grow);
  return t;
}
/** 标题旁边的小 i：点开看一两句说明 */
export const withInfo = (title, text) => h('span.as-info-head', title, h('button.as-info-btn', { 'aria-label': title + '说明', onclick: e => { e.stopPropagation(); dialog({ title, text, confirm: '知道了', cancel: '' }); } }, icon('info', 15, 2)));
export function field(label, control, hint) { return h('label.as-field', h('span.as-field__label', label), control, hint && h('span.as-field__hint', hint)); }
export function btn(label, variant = 'primary', onclick, attrs = {}) { return h('button.as-btn.as-btn--' + variant, { onclick, ...attrs }, label); }
// 默认头像上的字用真实姓名的最后一个字：传进来的多半是备注 / 网名（「大狗狗！！」只剩个「！」），按它找回是谁
const realOf = n => (n && state.contacts.find(c => c.remark === n || c.nick === n) || {}).name || (n && n === state.me.nick && state.me.realName) || n;
export function avatar(url, name = '', size = 40, shape = 'round') {
  name = realOf(name);
  const el = h('span.as-avatar' + (shape === 'square' ? '.as-avatar--square' : ''), { style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .42) + 'px' } });
  if (url) el.appendChild(h('img', { src: url, alt: '', loading: 'lazy', onerror: () => { el.innerHTML = ''; el.textContent = (name || '?').slice(-1); el.style.background = colorFor(name); } }));
  else { el.textContent = (name || '?').slice(-1); el.style.background = colorFor(name); }
  return el;
}
export function colorFor(s) {
  const pal = ['#7d8fb3', '#b88b74', '#8aa58f', '#a387b8', '#c49a6c', '#6f9db3', '#b37d8f', '#8c8fb0'];
  let n = 0; for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return pal[n % pal.length];
}
export function empty(text, action) { return h('div.as-empty', h('div.as-empty__art', icon('sparkle', 34, 1.4)), h('div.as-empty__text', text), action); }
export function badge(n) { return n > 0 ? h('span.as-badge', n > 99 ? '99+' : String(n)) : null; }

/* ---------- 抽屉 ---------- */
export function sheet({ title, content, onClose, cls = '' }) {
  const mask = h('div.as-sheet-mask');
  const grab = h('div.as-sheet__grab');
  const el = h('div.as-sheet' + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-label': title || '' }, grab, title && h('div.as-sheet__title', title), h('div.as-sheet__body', content));
  root.append(mask, el);
  requestAnimationFrame(() => { mask.classList.add('is-open'); el.classList.add('is-open'); });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    mask.classList.remove('is-open'); el.classList.remove('is-open'); el.style.transform = '';
    setTimeout(() => { mask.remove(); el.remove(); }, 280); onClose && onClose();
  };
  // 长按弹出来的抽屉：手指抬起时那一下 click 会落在遮罩上，别当成「点外面关掉」
  const t0 = Date.now(); mask.addEventListener('click', () => { if (Date.now() - t0 > 500) close(); });
  // 往下拖关闭，拉过头会回弹
  let y0 = null;
  el.addEventListener('pointerdown', e => { if (e.target.closest('button, input, textarea, .as-sheet__body')) return; y0 = e.clientY; el.style.transition = 'none'; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => { if (y0 == null) return; const dy = e.clientY - y0; el.style.transform = `translateY(${dy < 0 ? dy * .25 : dy}px)`; });
  el.addEventListener('pointerup', e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; el.style.transition = ''; if (dy > 80) close(); else el.style.transform = ''; });
  return { el, close };
}
/** 选项抽屉：返回所选的 value，取消返回 null */
export function actionSheet(title, options) {
  return new Promise(res => {
    let done = false;
    const s = sheet({ title, content: h('div.as-actions', options.map(o => h('button.as-actions__item' + (o.danger ? '.is-danger' : '') + (o.active ? '.is-active' : ''), {
      onclick: () => { done = true; s.close(); res(o.value); } }, o.icon && icon(o.icon, 20), h('span', o.label), o.active && icon('check', 18, 2))),
    h('button.as-actions__cancel', { onclick: () => s.close() }, '取消')), onClose: () => { if (!done) res(null); } });
  });
}

/** 设图片（头像、背景、封面）：从相册选（选完拖一拖、捏一捏框出要的那块）/ 填图片链接 / 恢复默认。
 *  ratio = 宽 ÷ 高（'screen' 就是手机屏幕的比例），size = 存下来的长边像素。返回图片（dataURL 或链接）；'' 是恢复默认；null 是没改 */
export async function pickImage(title, { ratio = 1, size = 320, has = false } = {}) {
  const v = await actionSheet(title, [{ value: 'file', label: '从相册选择', icon: 'image' }, { value: 'url', label: '图片链接', icon: 'link' }, has && { value: '', label: '恢复默认', icon: 'close' }].filter(Boolean));
  if (v === '') return '';
  if (v === 'url') {
    const u = ((await dialog({ title: '图片链接', input: { placeholder: '图片链接' } })) || '').trim();
    if (!u) return null;
    if (!(await new Promise(ok => { const i = new Image(); i.onload = () => ok(true); i.onerror = () => ok(false); i.src = u; }))) { toast('这个链接打不开图片'); return null; }
    return u;
  }
  if (v !== 'file') return null;
  const f = await pickFile();
  return f ? cropImage(f, ratio === 'screen' ? root.clientWidth / root.clientHeight : ratio, size) : null;
}
function cropImage(file, ratio, size) {
  return new Promise(res => {
    // 相册原图动辄四千像素，直接拖着缩放手机会卡：先缩到最长边 2048（存下来最多 1100，够用）画在画布上，拖的是这张小的
    const url = URL.createObjectURL(file), pic = new Image(), img = h('canvas.as-crop__img');
    const fw = Math.min(root.clientWidth - 48, (root.clientHeight - 200) * ratio), fh = fw / ratio;
    const frame = h('div.as-crop__frame', { style: { width: fw + 'px', height: fh + 'px' } }, img);
    let s = 1, min = 1, x = 0, y = 0, gap = 0;   // 图片缩放倍数、左上角在框里的位置
    const fit = () => { s = Math.max(s, min); x = Math.min(0, Math.max(fw - img.width * s, x)); y = Math.min(0, Math.max(fh - img.height * s, y)); img.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };
    pic.onload = () => {
      const k = Math.min(1, 2048 / Math.max(pic.naturalWidth, pic.naturalHeight));
      img.width = Math.round(pic.naturalWidth * k); img.height = Math.round(pic.naturalHeight * k); img.getContext('2d').drawImage(pic, 0, 0, img.width, img.height);
      min = s = Math.max(fw / img.width, fh / img.height); x = (fw - img.width * s) / 2; y = (fh - img.height * s) / 2; fit();
    };
    pic.onerror = () => { toast('这张图打不开'); done(null); };
    // 一根手指拖，两根手指捏着缩放（围着框的中间缩）
    const pts = new Map();
    frame.onpointerdown = e => { frame.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); gap = 0; };
    frame.onpointermove = e => {
      const old = pts.get(e.pointerId); if (!old) return; pts.set(e.pointerId, e);
      if (pts.size === 1) { x += e.clientX - old.clientX; y += e.clientY - old.clientY; }
      else { const [a, b] = [...pts.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (gap) { const ns = Math.max(min, s * d / gap), r = ns / s; x = fw / 2 - (fw / 2 - x) * r; y = fh / 2 - (fh / 2 - y) * r; s = ns; } gap = d; }
      fit();
    };
    frame.onpointerup = frame.onpointercancel = e => { pts.delete(e.pointerId); gap = 0; };
    frame.onwheel = e => { e.preventDefault(); const ns = Math.max(min, s * (e.deltaY < 0 ? 1.1 : .9)), r = ns / s; x = fw / 2 - (fw / 2 - x) * r; y = fh / 2 - (fh / 2 - y) * r; s = ns; fit(); };
    const box = h('div.as-crop', frame, h('div.as-crop__bar', btn('取消', 'secondary', () => done(null)), btn('确定', 'primary', () => {
      const k = size / Math.max(fw, fh), c = document.createElement('canvas');
      c.width = Math.round(fw * k); c.height = Math.round(fh * k);
      c.getContext('2d').drawImage(img, -x / s, -y / s, fw / s, fh / s, 0, 0, c.width, c.height);
      done(c.toDataURL('image/jpeg', .86));
    })));
    function done(v) { URL.revokeObjectURL(url); box.remove(); root.classList.remove('is-cropping'); res(v); }
    root.classList.add('is-cropping'); root.append(box); pic.src = url;   // is-cropping：底下的动画（下雨天的雨和字）先停，不然拖图会卡
  });
}

/* ---------- 弹窗 ---------- */
// 点输入框弹出键盘时，浏览器会把它「滚进视野」，连本来不该滚的外框（overflow: hidden 的手机外壳、页面）也滚歪，那一下看着像闪。这种外框滚了就拨回去
document.addEventListener('focusin', e => {
  const keep = [];
  for (let el = e.target.parentElement; el; el = el.parentElement) if (el === document.scrollingElement || /hidden|clip/.test(getComputedStyle(el).overflowY)) keep.push([el, el.scrollTop, el.scrollLeft]);
  const back = () => keep.forEach(([el, t, l]) => { if (el.scrollTop !== t) el.scrollTop = t; if (el.scrollLeft !== l) el.scrollLeft = l; });
  addEventListener('scroll', back, true); setTimeout(() => removeEventListener('scroll', back, true), 800);
});
/** 聚焦输入框但不让界面跟着跳：手机弹键盘时浏览器会把输入框「滚进视野」，连本来不该滚的手机外框也滚歪，那一下看着像闪。滚了就拨回去 */
function focusStill(el) {
  const keep = [];
  for (let e = el.parentElement; e; e = e.parentElement) keep.push([e, e.scrollTop, e.scrollLeft]);
  const back = () => keep.forEach(([e, t, l]) => { if (e.scrollTop !== t) e.scrollTop = t; if (e.scrollLeft !== l) e.scrollLeft = l; });
  el.focus({ preventScroll: true });
  addEventListener('scroll', back, true); setTimeout(() => removeEventListener('scroll', back, true), 800);
}
export function dialog({ title, text, confirm = '确定', cancel = '取消', danger = false, typed = null, input: inp = null }) {
  return new Promise(res => {
    const mask = h('div.as-dialog-mask');
    let field1 = null;
    const ok = h('button.as-dialog__btn' + (danger ? '.is-danger' : '.is-primary'), { onclick: () => done(field1 ? field1.value : true) }, confirm);
    if (typed) {
      field1 = h('input.as-input', { placeholder: `请输入 ${typed}` });
      ok.disabled = true; field1.addEventListener('input', () => { ok.disabled = field1.value.trim() !== typed; ok.classList.toggle('is-ready', !ok.disabled); });
    } else if (inp) {
      field1 = h('input.as-input', { placeholder: inp.placeholder || '', value: inp.value || '' });
      field1.addEventListener('keydown', e => { if (e.key === 'Enter') done(field1.value); });
    }
    const box = h('div.as-dialog', { role: 'alertdialog' }, h('div.as-dialog__title', title), text && h('div.as-dialog__text', text), field1,
      h('div.as-dialog__actions', cancel && h('button.as-dialog__btn', { onclick: () => done(null) }, cancel), ok));
    mask.appendChild(box); root.appendChild(mask);
    requestAnimationFrame(() => { mask.classList.add('is-open'); field1 && focusStill(field1); });
    function done(v) { mask.classList.remove('is-open'); setTimeout(() => mask.remove(), 200); res(v === true ? true : v == null ? (typed || inp ? null : false) : v); }
  });
}

/* ---------- 轻提示 ---------- */
let toastEl = null, toastT = 0;
/* 要等的事都要能取消（作者定的规矩，以后新加的也一样）。点了取消就不等了：提示「已取消」，返回 undefined；
 * fn 拿到 signal，能断的断掉（找 AI 的传给 generate 的 stop）。只把「要等的那一步」放进 fn，拿到结果后再动页面，取消了就不会再动 */
const run = (ac, fn) => new Promise((ok, no) => {
  ac.signal.addEventListener('abort', () => { toast('已取消'); ok(); }, { once: true });
  Promise.resolve().then(() => fn(ac.signal)).then(v => ac.signal.aborted || ok(v), e => ac.signal.aborted || no(e));
});
/** 提示条转圈 +「取消」 */
export function waiting(msg, fn) { const ac = new AbortController(); toast(msg, { label: '取消', fn: () => ac.abort(), wait: true }); return run(ac, fn); }
/** 按钮干活时（拉取、试听…）转圈、大小不变，再点一下就取消；给了 msg 就同时挂一条带「取消」的提示 */
export async function busy(btn, fn, msg) {
  if (btn._ac) { btn._ac.abort(); return; }
  const ac = btn._ac = new AbortController(), old = [...btn.childNodes]; btn.style.minWidth = btn.offsetWidth + 'px'; btn.replaceChildren(h('span.as-spin'));
  if (msg) toast(msg, { label: '取消', fn: () => ac.abort(), wait: true });
  try { return await run(ac, fn); } finally { btn._ac = null; btn.replaceChildren(...old); btn.style.minWidth = ''; }
}
/** action = true：要等的操作，带等待动画一直挂着，直到下一条 toast 把它换掉（所以结束时一定要再 toast 一句结果） */
export function toast(msg, action) {
  if (!toastEl) { toastEl = h('div.as-toast', { role: 'status' }); root.appendChild(toastEl); }
  const wait = action === true || !!(action && action.wait); if (action === true) action = null;   // { label, fn, wait: true }：转圈 + 按钮（比如「取消」），一直挂着
  toastEl.innerHTML = '';
  toastEl.append(...(wait ? [h('i.as-spin')] : []), h('span', msg));
  if (action) toastEl.append(h('button.as-toast__action', { onclick: () => { toastEl.classList.remove('is-open'); action.fn(); } }, action.label));
  toastEl.classList.toggle('has-action', !!action);
  // 收起的计时放进同一帧：页面切到后台时这一帧会等到回来才跑，计时放外面会先收起、回来又被这一帧打开，就再也不收了
  clearTimeout(toastT);
  requestAnimationFrame(() => { toastEl.classList.add('is-open'); clearTimeout(toastT); if (!wait) toastT = setTimeout(() => toastEl.classList.remove('is-open'), action ? 3600 : 1900); });
}

/* ---------- 横幅通知 ---------- */
export function banner({ avatarEl, title, text, onClick }) {
  const b = h('div.as-banner', { role: 'status', onclick: () => { hide(); onClick && onClick(); } }, avatarEl, h('div.as-banner__main', h('b', title), h('span', text)));
  root.appendChild(b);
  requestAnimationFrame(() => b.classList.add('is-open'));
  let y0 = null;
  b.addEventListener('pointerdown', e => { y0 = e.clientY; });
  b.addEventListener('pointerup', e => { if (y0 != null && e.clientY - y0 < -20) hide(); y0 = null; });
  const t = setTimeout(hide, 4200);
  function hide() { clearTimeout(t); b.classList.remove('is-open'); setTimeout(() => b.remove(), 400); }
}
export { $ };
