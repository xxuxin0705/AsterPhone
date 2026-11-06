// 页面导航：打开 App（从图标位置长出来）、进入子页面（从右边滑进来）、返回（左右边缘滑动跟手）。
// 返回层级：子页面 → 上一页 → App 首页 → 桌面 → 再返回一次 = 关闭手机

const stack = [];        // [{ el, app, onShow }]
let host = null, homeBack = null, iconRect = null, onChange = null;

export function initNav(stackEl, { onHomeBack, onStackChange }) {
  host = stackEl; homeBack = onHomeBack; onChange = onStackChange;
  // 外层也不许被浏览器「顺手」滚动（输入框获得焦点、弹出通知时会发生）
  for (const el of [host, host.parentElement]) el.addEventListener('scroll', () => { if (el.scrollTop) el.scrollTop = 0; if (el.scrollLeft) el.scrollLeft = 0; });
  enableSwipe();
}
export const depth = () => stack.length;
export const top = () => stack[stack.length - 1];
const notify = () => onChange && onChange(stack.length);

function prepare(el) {
  el.classList.add('as-stack__page'); host.appendChild(el);
  // 输入框获得焦点时，浏览器会把整页往上推，顶栏就被推出去了；整页本身永远不许滚
  el.addEventListener('scroll', () => { if (el.scrollTop) el.scrollTop = 0; if (el.scrollLeft) el.scrollLeft = 0; });
}

/** 打开 App：从图标的位置长出来 */
export function openApp(el, rect, app) {
  closeAll(true);
  prepare(el);
  iconRect = rect || null;
  stack.push({ el, app });
  const pr = host.getBoundingClientRect();
  if (rect) {
    const sx = rect.width / pr.width, sy = rect.height / pr.height;
    const tx = rect.left - pr.left, ty = rect.top - pr.top;
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
    el.style.borderRadius = '40px'; el.style.opacity = '0';
    el.getBoundingClientRect();
    el.classList.add('is-zooming');
    requestAnimationFrame(() => { el.style.transform = ''; el.style.borderRadius = ''; el.style.opacity = ''; });
    setTimeout(() => el.classList.remove('is-zooming'), 480);
  } else {
    el.classList.add('is-fading'); requestAnimationFrame(() => el.classList.remove('is-fading'));
  }
  host.classList.add('has-app'); notify();
}

/** 进入子页面 */
export function push(el, { onShow } = {}) {
  const prev = top();
  prepare(el);
  el.classList.add('is-entering');
  stack.push({ el, app: prev && prev.app, onShow });
  el.getBoundingClientRect();
  requestAnimationFrame(() => { el.classList.remove('is-entering'); prev && prev.el.classList.add('is-behind'); });
  notify();
}

/** 返回一层 */
export function back() {
  if (stack.length > 1) return pop();
  if (stack.length === 1) return closeApp();
  homeBack && homeBack();
}
export function pop() {
  if (stack.length <= 1) return closeApp();
  const cur = stack.pop(), prev = top();
  leave(cur.el);
  cur.el.classList.add('is-leaving');
  prev.el.classList.remove('is-behind');
  setTimeout(() => cur.el.remove(), 380);
  prev.onShow && prev.onShow();
  if (prev.el._onShow) prev.el._onShow();
  notify();
}
/** 关闭 App：缩回图标 */
export function closeApp(slide) {
  const cur = stack[0]; if (!cur) return;
  const pr = host.getBoundingClientRect(), rect = iconRect;
  stack.slice(1).forEach(s => { leave(s.el); s.el.remove(); });
  leave(cur.el);
  stack.length = 0;
  const el = cur.el;
  el.classList.add('is-zooming');
  if (slide) { el.style.transform = 'translateX(100%)'; }
  else if (rect) {
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${rect.left - pr.left}px, ${rect.top - pr.top}px) scale(${rect.width / pr.width}, ${rect.height / pr.height})`;
    el.style.borderRadius = '40px'; el.style.opacity = '0';
  } else el.style.opacity = '0';
  setTimeout(() => el.remove(), 420);
  host.classList.remove('has-app'); notify();
}
function leave(el) { try { el._onLeave && el._onLeave(); } catch (e) { console.error(e); } }
export function closeAll(instant) {
  stack.forEach(s => { leave(s.el); s.el.remove(); }); stack.length = 0; host && host.classList.remove('has-app');
  if (!instant) notify();
}

/* ---------- 边缘滑动返回（跟手） ---------- */
function enableSwipe() {
  let s = null;
  host.addEventListener('pointerdown', e => {
    if (!stack.length || e.button > 0) return;
    const r = host.getBoundingClientRect(), x = e.clientX - r.left;
    if (e.target.closest('input, textarea, .as-slider, .as-sheet, .as-dialog-mask, .as-chat-menu, .as-chat-indexbar, [data-no-swipe]')) return;
    // 贴着左右边缘（44px 内）起手最灵敏；在页面中间起手也行，但要滑得更明显、更水平
    const edge = x < 44 ? 1 : x > r.width - 44 ? -1 : 0;
    s = { x0: e.clientX, y0: e.clientY, dir: edge || 1, edge: !!edge, t0: performance.now(), active: false, id: e.pointerId };
  });
  host.addEventListener('pointermove', e => {
    if (!s || e.pointerId !== s.id) return;
    const dx = (e.clientX - s.x0) * s.dir, dy = Math.abs(e.clientY - s.y0);
    if (!s.active) {
      const ok = s.edge ? (dx > 10 && dx > dy * 1.4) : (dx > 26 && dx > dy * 2.2);
      if (ok) { s.active = true; try { host.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ } start(); }
      else if (dy > 14 || (!s.edge && dx < -20)) { s = null; return; } else return;
    }
    move(Math.max(0, dx));
  });
  const end = e => {
    if (!s) return; const st = s; s = null;
    if (!st.active) return;
    const dx = Math.max(0, (e.clientX - st.x0) * st.dir), v = dx / Math.max(1, performance.now() - st.t0);
    finish(dx > host.clientWidth / 3 || v > .6);
  };
  host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);

  let cur = null, prev = null, single = false;
  function start() {
    cur = top(); prev = stack[stack.length - 2]; single = stack.length === 1;
    cur.el.style.transition = 'none'; if (prev) prev.el.style.transition = 'none';
  }
  function move(dx) {
    const w = host.clientWidth;
    cur.el.style.transform = `translateX(${dx}px)`;
  }
  function finish(go) {
    cur.el.style.transition = ''; if (prev) prev.el.style.transition = '';
    if (go && single) { if (cur.el._onBack && cur.el._onBack()) { cur.el.style.transform = ''; cur.el.style.borderRadius = ''; return; } closeApp(true); return; }
    if (go) { cur.el.style.transform = ''; cur.el.style.borderRadius = ''; if (prev) prev.el.style.transform = ''; back(); }
    else { cur.el.style.transform = ''; cur.el.style.borderRadius = ''; if (prev) prev.el.style.transform = ''; }
  }
}
