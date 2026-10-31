// 聊天 App 外壳：底部 4 个标签（消息 / 联系人 / 动态 / 我），名字和图标以后可以被皮肤替换。
import { h } from '../../core/util.js';
import { state, subscribe, chatOf } from '../../core/store.js';
import { page, icon, badge } from '../../core/ui.js';
import { renderMessages } from './messages.js';
import { renderContacts } from './contacts.js';
import { renderMoments } from './moments.js';
import { renderMe } from './me.js';
import { openRoom } from './room.js';
import { textOf, applyTexts } from '../../core/skin.js';

const TABS = [
  { id: 'messages', label: '消息', icon: 'chat', text: 'chat.tab.messages', render: renderMessages },
  { id: 'contacts', label: '联系人', icon: 'users', text: 'chat.tab.contacts', render: renderContacts },
  { id: 'moments', label: '动态', icon: 'moments', text: 'chat.tab.moments', render: renderMoments },
  { id: 'me', label: '我', icon: 'user', text: 'chat.tab.me', render: renderMe },
];
let P = null, bar = null, cur = null, cleanup = null, unsub = null;

export function open(opts = {}) {
  P = page({ app: 'chat', id: 'chat-messages', title: '消息', back: true, cls: 'as-chat-root' });
  bar = h('nav.as-chat-tabbar', { role: 'tablist' }, TABS.map(t => h('button.as-chat-tab', { role: 'tab', dataset: { tab: t.id, asText: t.text }, onclick: () => switchTab(t.id) },
    icon(t.icon, 23, 1.7), h('span', { dataset: { asLabel: '' } }, t.label))));
  applyTexts();
  P.el.appendChild(bar);
  switchTab(opts.tab || 'messages');
  unsub && unsub();
  unsub = subscribe(what => { if (what === 'chats' || what === 'all') renderTabBadge(); });
  renderTabBadge();
  P.el._onShow = () => { cur && TABS.find(t => t.id === cur).refresh?.(); rerender(); };
  return P.el;
}
export function afterOpen(opts = {}) { if (opts.chat) { const c = chatOf(opts.chat); if (c) setTimeout(() => openRoom(c), 120); } }
export function reveal(opts = {}) { if (opts.chat) { const c = chatOf(opts.chat); if (c) openRoom(c); } }

function rerender() { if (cur) switchTab(cur, true); }
export function switchTab(id, force) {
  if (cur === id && !force) { P.body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  cleanup && cleanup(); cleanup = null;
  const keepScroll = force ? P.body.scrollTop : 0;
  cur = id;
  const t = TABS.find(x => x.id === id);
  [...bar.children].forEach(b => b.classList.toggle('is-active', b.dataset.tab === id));
  P.el.dataset.asPage = 'chat-' + id;
  P.el.classList.toggle('as-chat-moments', id === 'moments');
  P.body.innerHTML = '';
  const right = P.nav.querySelector('.as-navbar__right'); right.innerHTML = '';
  P.setTitle(textOf(t.text, t.label));
  cleanup = t.render({ body: P.body, el: P.el, setTitle: P.setTitle, setRight: (...n) => { right.innerHTML = ''; right.append(...n.filter(Boolean)); }, switchTab });
  if (keepScroll) P.body.scrollTop = keepScroll;
}
function renderTabBadge() {
  if (!bar) return;
  const n = state.chats.reduce((s, c) => s + (c.muted ? 0 : c.unread || 0), 0);
  const b = bar.querySelector('[data-tab="messages"]');
  b.querySelector('.as-badge')?.remove();
  const el = badge(n); if (el) b.appendChild(el);
}
