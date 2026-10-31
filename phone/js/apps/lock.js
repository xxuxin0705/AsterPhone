// 锁屏：大时钟、通知卡片堆、假指纹（按住就开）、数字密码（含备用密码）。
// 手势密码下一轮做；现在选了手势会先按指纹处理。
import { h, $ } from '../core/util.js';
import { state, commit, contact } from '../core/store.js';
import { avatar, toast } from '../core/ui.js';
import * as time from '../core/time.js';
import { shell } from '../core/shell.js';

let lockEl, pinEl, finger, ring, clockEl, dateEl, subEl, noticeBox, pinBtn, swipeEl;
let locked = true, onUnlockCb = null, pendingOpen = null;
const CIRC = 213.6;

const FINGER_SVG = `<svg class="as-lock-finger__ring" viewBox="0 0 78 78" aria-hidden="true"><circle class="as-lock-finger__track" cx="39" cy="39" r="34"/><circle class="as-lock-finger__progress" cx="39" cy="39" r="34"/></svg>
<svg class="as-lock-finger__icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
<path d="M13 10.5C16.2 8.3 20 7 24 7s7.8 1.3 11 3.5"/><path d="M9.5 25c.8-8 7-14 14.5-14s13.7 6 14.5 14"/>
<path d="M14 33c-1-2-1.5-4-1.5-6.5C12.5 20 17.6 15 24 15s11.5 5 11.5 12c0 3-.5 5.5-1.5 7.5"/>
<path d="M18.5 35.5c-1.2-2.4-1.8-5-1.8-8 0-4.2 3.3-7.5 7.3-7.5s7.3 3.3 7.3 7.5c0 2.8-.6 5.4-1.6 7.8"/>
<path d="M23.8 39c-1.8-3.4-2.6-7.4-2.6-11.4 0-1.6 1.2-2.8 2.8-2.8s2.8 1.2 2.8 2.8c0 3.8-.8 7.3-2.3 10.5"/></svg>
<svg class="as-lock-finger__check" viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15.5l5.2 5.2L23 9.8"/></svg>
<span class="as-lock-finger__hint">按住指纹解锁</span>`;

export const isLocked = () => locked;
const lockOn = () => !!state.settings.lock.enabled;
const usePin = () => state.settings.lock.method === 'pin' && /^\d{4,6}$/.test(state.settings.lock.pin || '');

export function initLock({ onUnlock }) {
  onUnlockCb = onUnlock;
  lockEl = $('#lock'); pinEl = $('#pin');
  clockEl = h('div.as-lock-clock', { 'aria-live': 'polite' });
  dateEl = h('div.as-lock-date'); subEl = h('div.as-lock-sub');
  noticeBox = h('div.as-lock-notice.is-stacked');
  finger = h('button.as-lock-finger', { 'aria-label': '按住指纹解锁', html: FINGER_SVG });
  ring = finger.querySelector('.as-lock-finger__progress');
  pinBtn = h('button.as-textbtn', { onclick: openPin }, '使用密码');
  swipeEl = h('button.as-lock-swipe', { 'aria-label': '上滑解锁', onclick: () => { if (state.settings.lock.method === 'none') unlock(swipeEl); } },
    h('span', { html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>' }), '上滑解锁');
  lockEl.append(h('div.as-lock__head', clockEl, dateEl, subEl), noticeBox,
    h('div.as-lock__foot', h('span'), finger, pinBtn), swipeEl);
  bindFinger(); bindSwipe(); buildPin();
  noticeBox.addEventListener('click', e => {
    const it = e.target.closest('.as-lock-notice__item'); if (!it) return;
    e.stopPropagation();
    if (noticeBox.classList.contains('is-stacked') && noticeBox.children.length > 2) { noticeBox.classList.remove('is-stacked'); return; }
    pendingOpen = it.dataset.chat;
    toast(usePin() ? '输入密码后查看消息' : '按住指纹，解锁后直接打开');
  });
  lockEl.addEventListener('click', e => { if (!e.target.closest('.as-lock-notice')) noticeBox.classList.add('is-stacked'); });
  setInterval(() => renderClock(false), 1000);
  renderClock(true);
  if (!lockOn()) { locked = false; lockEl.classList.add('is-hidden'); }
  syncFoot();
}

export function syncFoot() {
  const m = state.settings.lock.method;
  const swipe = m === 'none' || (m === 'pin' && !usePin()) || m === 'pattern';
  pinBtn.hidden = !usePin();
  finger.hidden = swipe; swipeEl.hidden = !swipe;
  finger.querySelector('.as-lock-finger__hint').textContent = usePin() ? '点一下输入密码' : '按住指纹解锁';
  finger.setAttribute('aria-label', usePin() ? '输入密码' : '按住指纹解锁');
}

/* ---------- 上滑解锁（没设密码时） ---------- */
function bindSwipe() {
  let y0 = null, id = null;
  lockEl.addEventListener('pointerdown', e => {
    if (!locked || e.button > 0 || e.target.closest('.as-lock-notice, .as-lock-finger, .as-textbtn')) return;
    y0 = e.clientY; id = e.pointerId; lockEl.classList.add('is-dragging');
  });
  lockEl.addEventListener('pointermove', e => {
    if (y0 == null || e.pointerId !== id) return;
    const dy = Math.min(0, e.clientY - y0);
    lockEl.style.transform = `translateY(${dy * .35}px)`; lockEl.style.opacity = String(Math.max(.35, 1 + dy / 420));
  });
  const end = e => {
    if (y0 == null || e.pointerId !== id) return;
    const dy = y0 - e.clientY; y0 = null; id = null;
    lockEl.classList.remove('is-dragging'); lockEl.style.transform = ''; lockEl.style.opacity = '';
    const canSwipe = state.settings.lock.method === 'none' || (state.settings.lock.method === 'pin' && !usePin()) || state.settings.lock.method === 'pattern';
    if (dy > 90 && canSwipe) unlock(null);
    else if (dy > 90 && usePin()) openPin();
  };
  lockEl.addEventListener('pointerup', end); lockEl.addEventListener('pointercancel', end);
}

/* ---------- 时钟 ---------- */
let shown = '';
export function renderClock(force) {
  const n = time.now();
  const sb = $('#sbTime'); if (sb) sb.textContent = n.hm;
  dateEl.textContent = n.date; subEl.textContent = n.sub;
  if (n.hm === shown && !force) return;
  if (force || clockEl.children.length !== 5 || shown.length !== 5) {
    clockEl.innerHTML = '';
    [...n.hm].forEach(ch => clockEl.appendChild(ch === ':' ? h('span.as-lock-clock__colon', ':') : h('span.as-lock-clock__digit', h('span', ch))));
  } else {
    [...n.hm].forEach((ch, i) => {
      if (ch === ':' || ch === shown[i]) return;
      const box = clockEl.children[i], old = box.lastElementChild, nu = h('span', { style: { transform: 'translateY(100%)', opacity: '0' } }, ch);
      box.appendChild(nu);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        old.style.transform = 'translateY(-100%)'; old.style.opacity = '0'; nu.style.transform = 'translateY(0)'; nu.style.opacity = '1';
        setTimeout(() => old.remove(), 560);
      }));
    });
  }
  clockEl.setAttribute('aria-label', n.hm); shown = n.hm;
}

/* ---------- 通知卡片：每个有未读的聊天一张，最多 3 张 ---------- */
export function renderNotices() {
  if (!noticeBox) return;
  const list = state.chats.filter(c => c.unread > 0 && !c.muted).sort((a, b) => b.lastAt - a.lastAt);
  noticeBox.innerHTML = '';
  list.slice(0, 3).forEach(c => {
    const p = contact(c.contactId) || {};
    const name = p.remark || p.nick || p.name || '联系人';
    const text = c.unread > 1 ? `[${c.unread}条] ${c.lastText}` : c.lastText;
    noticeBox.appendChild(h('div.as-lock-notice__item', { role: 'button', tabindex: 0, dataset: { chat: c.id } },
      avatar(p.avatar, name, 38), h('span.as-lock-notice__name', name), h('span.as-lock-notice__time', time.ago(c.lastAt)), h('span.as-lock-notice__text', text)));
  });
  if (list.length > 1) noticeBox.appendChild(h('span.as-lock-notice__more', { 'aria-hidden': 'true' }, list.length > 3 ? `还有 ${list.length - 1} 条 · 点开` : '点开查看全部'));
}

/* ---------- 指纹 ---------- */
let pressT = null, raf = 0;
const ringTo = p => { ring.style.strokeDashoffset = CIRC * (1 - p); };
function bindFinger() {
  const start = e => {
    if (!locked) return; e.preventDefault();
    if (usePin()) { openPin(); return; }
    finger.classList.add('is-pressed'); const t = performance.now(); pressT = t; cancelAnimationFrame(raf);
    const step = () => { if (pressT === null) return; const p = Math.min(1, (performance.now() - t) / 600); ringTo(p); if (p >= 1) { pressT = null; unlock(finger); } else raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  };
  const end = () => {
    if (pressT === null) return; pressT = null; finger.classList.remove('is-pressed'); cancelAnimationFrame(raf);
    const cur = 1 - parseFloat(ring.style.strokeDashoffset || CIRC) / CIRC, t = performance.now();
    const back = () => { const p = Math.max(0, cur - (performance.now() - t) / 300); ringTo(p); if (p > 0) raf = requestAnimationFrame(back); };
    back();
  };
  finger.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => finger.addEventListener(ev, end));
  finger.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && pressT === null && !e.repeat) start(e); });
  finger.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') end(); });
  finger.addEventListener('contextmenu', e => e.preventDefault());
}

function unlock(fromEl) {
  if (!locked) return;
  locked = false;
  finger.classList.remove('is-pressed'); finger.classList.add('is-success');
  const p = shell.phone.getBoundingClientRect();
  if (fromEl) { const r = fromEl.getBoundingClientRect(); shell.wallpaper.burst(r.left - p.left + r.width / 2, r.top - p.top + r.height / 2); }
  else shell.wallpaper.burst(p.width / 2, p.height * .2);
  setTimeout(() => {
    lockEl.classList.add('is-hidden'); closePin();
    const go = pendingOpen; pendingOpen = null;
    onUnlockCb && onUnlockCb(go);
  }, fromEl ? 360 : 60);
}

/** 锁上（手机收起时调用）。没开锁屏就什么都不做 */
export function lock() {
  if (!lockOn()) { locked = false; lockEl.classList.add('is-hidden'); return false; }
  locked = true; pendingOpen = null;
  lockEl.classList.remove('is-hidden'); finger.classList.remove('is-success'); ringTo(0);
  noticeBox.classList.add('is-stacked'); closePin(); renderNotices(); renderClock(true); syncFoot();
  return true;
}

/* ---------- 数字密码 ---------- */
let entry = '', backupMode = false, pinTitle, pinHint, dots;
const digits = () => (state.settings.lock.pin || '').length || state.settings.lock.digits || 6;
const backupCode = () => '0'.repeat(digits());
function buildPin() {
  pinTitle = h('div.as-pin__title', '输入密码'); pinHint = h('div.as-pin__hint');
  dots = h('div.as-lock-pin-dots');
  const keypad = h('div.as-lock-keypad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '取消', '0', '删除'].forEach(k =>
    keypad.appendChild(h('button.as-key' + (k.length > 1 ? '.as-key--text' : ''), { 'aria-label': k, onclick: () => key(k) }, k)));
  pinEl.append(pinTitle, pinHint, dots, keypad, h('button.as-textbtn.as-pin__forgot', { onclick: forgot }, '忘记密码？'));
  addEventListener('keydown', e => {
    if (!pinEl.classList.contains('is-open')) return;
    if (/^\d$/.test(e.key)) key(e.key); else if (e.key === 'Backspace') key('删除'); else if (e.key === 'Escape') { e.stopPropagation(); key('取消'); }
  });
}
function renderDots() {
  const n = digits();
  if (dots.children.length !== n) { dots.innerHTML = ''; for (let i = 0; i < n; i++) dots.appendChild(h('i')); }
  [...dots.children].forEach((d, i) => d.classList.toggle('is-active', i < entry.length));
}
function key(k) {
  if (k === '取消') return closePin();
  if (k === '删除') { entry = entry.slice(0, -1); return renderDots(); }
  if (entry.length >= digits()) return;
  entry += k; renderDots();
  if (entry.length === digits()) setTimeout(check, 140);
}
function check() {
  if (entry === state.settings.lock.pin || entry === backupCode()) { entry = ''; renderDots(); unlock(null); return; }
  dots.classList.add('is-error'); pinHint.textContent = '密码错误'; pinHint.classList.add('is-error');
  setTimeout(() => { dots.classList.remove('is-error'); entry = ''; renderDots(); pinHint.classList.remove('is-error'); pinHint.textContent = hintText(); }, 700);
}
const hintText = () => backupMode ? `备用密码是 ${digits()} 个 0` : '';
function openPin() {
  backupMode = false; pinTitle.textContent = '输入密码'; pinHint.textContent = hintText(); entry = ''; renderDots();
  pinEl.classList.add('is-open'); pinEl.setAttribute('aria-hidden', 'false'); lockEl.classList.add('is-hidden');
}
function closePin() {
  pinEl.classList.remove('is-open'); pinEl.setAttribute('aria-hidden', 'true');
  if (locked) lockEl.classList.remove('is-hidden');
}
function forgot() { backupMode = true; entry = ''; renderDots(); pinTitle.textContent = '输入备用密码'; pinHint.textContent = hintText(); }

/** 酒馆扩展面板里的「重置锁屏」 */
export function resetLock() {
  state.settings.lock = { enabled: false, method: 'none', pin: '', digits: 6 }; commit('lock');
  syncFoot(); if (locked) unlock(null);
}
