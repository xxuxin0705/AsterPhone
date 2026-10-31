// AsterPhone 启动入口：读数据 → 铺壁纸 → 锁屏 / 桌面 → 页面导航 → 和酒馆接上线。
import { $, h } from './core/util.js';
import { state, load, subscribe, commit } from './core/store.js';
import { loadLogs, log } from './core/log.js';
import { mountUI, toast, banner, avatar } from './core/ui.js';
import * as nav from './core/nav.js';
import { Wallpaper } from './core/wallpaper.js';
import { shell } from './core/shell.js';
import { postToParent, inTavern } from './core/bridge.js';
import { initLock, lock, isLocked, renderNotices, renderClock, resetLock, syncFoot } from './apps/lock.js';
import { initHome, showHome, renderBadges, renderWidget } from './apps/home.js';

const phone = $('#phone');
// 装在酒馆里 = 外层页面有 SillyTavern；别的地方（单独打开、预览页）都按「单独预览」处理
const embedded = inTavern() || document.documentElement.classList.contains('as-embedded');
const APP_LOADERS = {
  chat: () => import('./apps/chat/index.js'),
  settings: () => import('./apps/settings.js'),
  log: () => import('./apps/log.js'),
};
let wallpaper, currentApp = 'lock', booted = false, pendingVis = null;

/* ---------- 外观 ---------- */
const sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const wantNight = () => state.settings.mode === 'night' || (state.settings.mode === 'auto' && sysDark());
function setNight(night, originEl, instant) {
  let origin = null;
  if (originEl) {
    const r = originEl.getBoundingClientRect(), p = phone.getBoundingClientRect();
    origin = [(r.left + r.width / 2 - p.left) / p.width, (r.top + r.height / 2 - p.top) / p.height];
  }
  if ((phone.dataset.mode === 'night') !== night || instant) wallpaper.setNight(night, origin || [.5, .12], instant);
  phone.dataset.mode = night ? 'night' : 'day';
}
function applyLook() {
  const s = state.settings;
  phone.style.setProperty('--as-font-scale', s.fontScale || 1);
  phone.dataset.clock = s.clockColor || 'auto';
  wallpaper && wallpaper.setKind(s.wallpaper);
  syncStatusbar();
  syncFoot();
  renderClock(true); renderWidget();
  sendCfg();
}
function syncStatusbar() {
  const sb = state.settings.statusbar, own = sb.apps[currentApp];
  const show = own == null ? sb.global : own;
  $('#statusbar').classList.toggle('is-hidden', !show);
  phone.classList.toggle('no-statusbar', !show);
}
function setCurrent(app) { currentApp = app; phone.dataset.asApp = app; syncStatusbar(); }

/* ---------- 打开 / 关闭 App ---------- */
async function openApp(id, opts = {}) {
  if (!APP_LOADERS[id]) { toast(id === 'library' ? '资源库下一轮做，先去设置里换换外观吧' : '这个 App 还没做好'); return; }
  try {
    const mod = await APP_LOADERS[id]();
    const top = nav.top();
    if (top && top.app === id && mod.reveal) { mod.reveal(opts); return; }
    const el = mod.open(opts);
    const r = opts.from ? opts.from.getBoundingClientRect() : null;
    nav.openApp(el, r, id);
    setCurrent(id);
    mod.afterOpen && mod.afterOpen(opts);
  } catch (e) { log('error', '桌面', `打开 ${id} 失败：${e.message}`, e); toast('打开失败，详情见日志'); }
}
let pauseT = 0;
function onStackChange(depth) {
  phone.classList.toggle('has-app', depth > 0);
  clearTimeout(pauseT);
  if (depth > 0) pauseT = setTimeout(() => { if (nav.depth() > 0 && !isLocked()) wallpaper.pause(); }, 520);
  else { if (shell.visible) wallpaper.resume(); setCurrent(isLocked() ? 'lock' : 'home'); shell.activeChat = null; }
}

/* ---------- 收起手机 ---------- */
let fakeFab = null;
function closePhone() {
  if (embedded) { postToParent({ aster: 'close' }); return; }
  // 单独打开预览时：模拟「收起成悬浮按钮」
  onVisible(false);
  phone.style.transition = 'transform 420ms cubic-bezier(.2,.8,.2,1), opacity 300ms';
  phone.style.transform = 'scale(.08)'; phone.style.opacity = '0'; phone.style.pointerEvents = 'none';
  if (!fakeFab) {
    fakeFab = h('button', { 'aria-label': '打开手机', style: { position: 'fixed', right: '24px', bottom: '24px', border: '0', background: 'none', cursor: 'pointer', padding: '0', zIndex: 5 },
      onclick: () => { fakeFab.hidden = true; phone.style.transform = ''; phone.style.opacity = ''; phone.style.pointerEvents = ''; onVisible(true); } });
    document.body.appendChild(fakeFab);
  }
  fakeFab.innerHTML = '';
  fakeFab.appendChild(h('img', { src: `assets/fab/${state.settings.device.fab || 'iphone'}.png`, alt: '', style: { height: (state.settings.device.fabSize || 52) + 'px', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,.3))' } }));
  setTimeout(() => { fakeFab.hidden = false; }, 300);
}
function onVisible(v) {
  shell.visible = v;
  if (!v) {
    wallpaper.pause();
    if (lock()) { setCurrent('lock'); showHome(false); phone.classList.add('is-locked'); }
  } else {
    if (isLocked() || nav.depth() === 0) wallpaper.resume();
    shell.onShow && shell.onShow();
  }
}
function onUnlock(chatId) {
  phone.classList.remove('is-locked');
  if (nav.depth() > 0) { setCurrent(nav.top().app); pauseT = setTimeout(() => wallpaper.pause(), 520); }
  else { setCurrent('home'); }
  showHome(true);
  if (chatId) openApp('chat', { chat: chatId });
  shell.onShow && shell.onShow();
}

/* ---------- 新消息提醒 ---------- */
let audioCtx = null;
function ding() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime, vol = state.settings.notify.volume ?? .6;
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + .09);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18 * vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .35);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + .4);
  } catch (e) { /* 浏览器不让响就算了 */ }
}
function inDnd() {
  const n = state.settings.notify; if (!n.dnd) return false;
  const d = new Date(), cur = d.getHours() * 60 + d.getMinutes();
  const toMin = s => { const [a, b] = String(s || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
  const f = toMin(n.dndFrom), t = toMin(n.dndTo);
  return f <= t ? cur >= f && cur < t : cur >= f || cur < t;
}
function notify({ chatId, title, text, avatarUrl }) {
  renderNotices(); renderBadges(); sendUnread();
  if (!shell.visible || shell.activeChat === chatId) return;
  if (inDnd()) return;
  if (state.settings.notify.sound) ding();
  if (isLocked() || !state.settings.notify.banner) return;
  banner({ avatarEl: avatar(avatarUrl, title, 38), title, text, onClick: () => openApp('chat', { chat: chatId }) });
}

/* ---------- 和酒馆页面互通 ---------- */
function sendCfg() {
  const d = state.settings.device;
  postToParent({ aster: 'cfg', fab: d.fab, fabSize: d.fabSize, tripleTap: !!d.tripleTap });
}
function sendUnread() { postToParent({ aster: 'unread', n: state.chats.reduce((s, c) => s + (c.muted ? 0 : c.unread || 0), 0) }); }
addEventListener('message', e => {
  const d = e.data; if (!d || typeof d !== 'object') return;
  if (d.aster === 'visible') { if (!booted) pendingVis = !!d.v; else onVisible(!!d.v); }
  if (d.aster === 'reset' && d.what === 'lock') { resetLock(); toast('锁屏已关闭，密码已清除'); }
  if (d.aster === 'reset' && d.what === 'look') { Object.assign(state.settings, { mode: 'auto', fontScale: 1, clockColor: 'auto', statusbar: { global: true, apps: {} } }); commit('look'); applyLook(); setNight(wantNight(), null, false); }
});

/* ---------- 连点三下收起（手机空白处） ---------- */
function bindTripleTap() {
  let n = 0, t0 = 0, x0 = 0, y0 = 0;
  phone.addEventListener('pointerup', e => {
    if (!state.settings.device.tripleTap) return;
    if (e.target.closest('button, input, textarea, a, [role="button"], .as-list-item, .as-chat-msg, .as-chat-conv, .as-sheet, .as-dialog, .as-lock-finger')) { n = 0; return; }
    const now = performance.now();
    if (now - t0 > 450 || Math.hypot(e.clientX - x0, e.clientY - y0) > 40) n = 0;
    n++; t0 = now; x0 = e.clientX; y0 = e.clientY;
    if (n >= 3) { n = 0; closePhone(); }
  });
}

/* ---------- 启动 ---------- */
async function boot() {
  await Promise.all([load(), loadLogs()]);
  mountUI(phone);
  wallpaper = new Wallpaper({ gl: $('#gl'), fx: $('#fx'), host: phone, base: 'assets/wallpapers/' });
  Object.assign(shell, {
    phone, wallpaper, openApp, close: closePhone, applyLook, setNight: (n, el) => setNight(n, el), notify,
    lockNow: () => onVisible(false), refreshBadges: () => { renderNotices(); renderBadges(); sendUnread(); }, sendToParent: postToParent,
    wantNight, activeChat: null,
  });
  phone.dataset.mode = wantNight() ? 'night' : 'day';
  nav.initNav($('#stack'), { onHomeBack: closePhone, onStackChange });
  initHome();
  initLock({ onUnlock });
  applyLook();
  if (isLocked()) { phone.classList.add('is-locked'); setCurrent('lock'); }
  else { showHome(true); setCurrent('home'); }
  await wallpaper.init(state.settings.wallpaper);
  wallpaper.setNight(wantNight(), null, true);
  renderNotices(); renderBadges(); sendUnread();

  phone.addEventListener('as-back', () => nav.back());
  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || $('.as-dialog-mask, .as-sheet.is-open, .as-chat-menu') || $('#pin').classList.contains('is-open')) return;
    if (nav.depth() > 0) nav.back();
  });
  $('#closeBtn').addEventListener('click', closePhone);
  phone.addEventListener('pointerdown', e => {
    if (nav.depth() > 0 && !isLocked()) return;
    if (e.target.closest('button, .as-lock-notice, .as-pin, .as-home-widget, .as-home-app, .as-sheet, .as-dialog-mask')) return;
    const p = phone.getBoundingClientRect(); wallpaper.tap(e.clientX - p.left, e.clientY - p.top);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.settings.mode === 'auto') setNight(wantNight()); });
  if (navigator.getBattery) navigator.getBattery().then(b => { const f = () => $('#sbBattery').setAttribute('width', Math.max(2, 16 * b.level)); f(); b.addEventListener('levelchange', f); }).catch(() => {});
  bindTripleTap();
  subscribe(what => {
    if (what === 'chats' || String(what).startsWith('msgs:') || what === 'all') { renderNotices(); renderBadges(); sendUnread(); }
    if (what === 'time') { renderClock(true); renderWidget(); }
  });
  try { (await import('./core/sync.js')).startSync(); } catch (e) { log('error', '酒馆联动', '启动失败：' + e.message, e); }
  try { (await import('./apps/chat/engine.js')).startEngine(); } catch (e) { log('error', '聊天', '启动失败：' + e.message, e); }
  log('info', '系统', 'AsterPhone 已启动' + (embedded ? '（酒馆内）' : '（单独预览）'));
  booted = true;
  if (embedded && !pendingVis) onVisible(false);
  postToParent({ aster: 'ready' });
}
boot().catch(e => { console.error('[AsterPhone] 启动失败', e); document.body.appendChild(h('pre', { style: { color: '#e55', padding: '20px', whiteSpace: 'pre-wrap' } }, 'AsterPhone 启动失败：\n' + (e.stack || e.message))); });
