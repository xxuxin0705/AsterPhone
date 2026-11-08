// 桌面：上面一张时间小组件（顺便显示最新一条未读），下面一排 App 图标。
import { h, $ } from '../../core/util.js';
import { state, contact } from '../../core/store.js';
import { icon, badge } from '../../core/ui.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';

export const APPS = [
  { id: 'chat', name: '聊天', icon: 'chat' },
  { id: 'settings', name: '设置', icon: 'gear' },
  { id: 'library', name: '资源库', icon: 'box' },
  { id: 'music', name: '音乐', icon: 'music' },
  { id: 'memory', name: '念念铃', icon: 'bell' },
  { id: 'diary', name: '日记', icon: 'note' },
  { id: 'interlude', name: '幕间', img: 'assets/interlude/icon.webp' },
  { id: 'street', name: '商业街', img: 'assets/street/icon.svg' },
  { id: 'log', name: '日志', icon: 'list' },
];

let homeEl, wTime, wDate, wSub, wMsg;
export function initHome() {
  homeEl = $('#home');
  wTime = h('div.as-home-widget__time'); wDate = h('div.as-home-widget__date'); wSub = h('div.as-home-widget__sub');
  wMsg = h('div.as-home-widget__msg', { role: 'button', tabindex: 0, hidden: true });
  const widget = h('div.as-home-widget', wTime, wDate, wSub, wMsg);
  const appBtn = a => h('button.as-home-app', { dataset: { asApp: a.id }, 'aria-label': a.name, onclick: e => shell.openApp(a.id, { from: e.currentTarget.querySelector('.as-home-app__icon') }) },
    h('span.as-home-app__icon', a.img ? h('img', { src: a.img, alt: '' }) : icon(a.icon, 28, 1.7)), h('span.as-home-app__name', a.name));
  homeEl.append(widget, h('div.as-home-grid', APPS.map(appBtn)));
  setInterval(renderWidget, 1000);
  renderWidget(); renderBadges();
}
let wKey = '';
export function renderWidget() {
  if (!wTime) return;
  const n = time.now(), k = n.hm + n.ap + n.date + n.sub; if (k === wKey) return; wKey = k;   // 每秒都来一次：没变就什么都不碰
  wTime.textContent = n.hm; if (n.ap) wTime.appendChild(h('small', n.ap)); wDate.textContent = n.date; wSub.textContent = n.sub;
}
export function renderBadges() {
  if (!homeEl) return;
  const total = state.chats.reduce((s, c) => s + (c.muted ? 0 : c.unread || 0), 0);
  homeEl.querySelectorAll('.as-home-app[data-as-app="chat"] .as-badge').forEach(b => b.remove());
  if (state.settings.notify.badge && total) homeEl.querySelector('.as-home-app[data-as-app="chat"]').appendChild(badge(total));
  const latest = state.chats.filter(c => c.unread > 0 && !c.muted).sort((a, b) => b.lastAt - a.lastAt)[0];
  wMsg.hidden = !latest; wMsg.innerHTML = '';
  if (latest) {
    const p = latest.type === 'group' ? { name: latest.name } : (contact(latest.contactId) || {});
    wMsg.append(icon('chat', 16, 1.8), h('span', h('b', (p.remark || p.nick || p.name || '联系人') + '：'), latest.lastText));
    wMsg.onclick = () => shell.openApp('chat', { from: wMsg, chat: latest.id });
  }
}
export function showHome(on) { homeEl.classList.toggle('is-open', on); homeEl.setAttribute('aria-hidden', on ? 'false' : 'true'); }
