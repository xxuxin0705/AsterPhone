// 公共积木：页面、顶栏、列表组、开关、分段选择、滑块、抽屉、弹窗、轻提示……
// 类名都按设计规范的门牌号来（as-xxx），皮肤靠这些名字改样子。
import { h, $ } from './util.js';

let root = null;
export function mountUI(phoneEl) { root = phoneEl; }

/* ---------- 图标（细线条） ---------- */
const P = {
  back: 'M15 5l-7 7 7 7', chevron: 'M9 6l6 6-6 6', plus: 'M12 5v14M5 12h14', more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4', close: 'M6 6l12 12M18 6 6 18', check: 'M5 12.5l4.5 4.5L19 7',
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
  send: 'M4 12l16-8-6 16-3-7z', play: 'M8 5v14l11-7z', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01', mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  wallet: 'M4 7h15v12H4zM4 7l11-3v3M16 13h.01', bookmark: 'M7 4h10v17l-5-4-5 4z', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
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
export function field(label, control, hint) { return h('label.as-field', h('span.as-field__label', label), control, hint && h('span.as-field__hint', hint)); }
export function btn(label, variant = 'primary', onclick, attrs = {}) { return h('button.as-btn.as-btn--' + variant, { onclick, ...attrs }, label); }
export function avatar(url, name = '', size = 40, shape = 'round') {
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
    setTimeout(() => { mask.remove(); el.remove(); }, 420); onClose && onClose();
  };
  mask.addEventListener('click', close);
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
    function done(v) { mask.classList.remove('is-open'); setTimeout(() => mask.remove(), 260); res(v === true ? true : v == null ? (typed || inp ? null : false) : v); }
  });
}

/* ---------- 轻提示 ---------- */
let toastEl = null, toastT = 0;
export function toast(msg, action) {
  if (!toastEl) { toastEl = h('div.as-toast', { role: 'status' }); root.appendChild(toastEl); }
  toastEl.innerHTML = '';
  toastEl.append(h('span', msg));
  if (action) toastEl.append(h('button.as-toast__action', { onclick: () => { toastEl.classList.remove('is-open'); action.fn(); } }, action.label));
  toastEl.classList.toggle('has-action', !!action);
  requestAnimationFrame(() => toastEl.classList.add('is-open'));
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('is-open'), action ? 3600 : 1900);
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
