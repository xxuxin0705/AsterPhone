// 消息页：会话列表（置顶在上、按最近排序）、搜索、筛选、长按菜单、右上角「+」。
import { h, onLongPress } from '../../core/util.js';
import { state, commit, contact, chatForContact, clearMsgs, subscribe } from '../../core/store.js';
import { avatar, icon, badge, segmented, navBtn, actionSheet, dialog, toast, empty, btn } from '../../core/ui.js';
import * as time from '../../core/time.js';
import { nameOf, avatarOf } from './engine.js';
import { openRoom } from './room.js';
import { pickContact, openContactForm, importFromTavern } from './people.js';

let filter = 'all', query = '';
export function renderMessages(ctx) {
  ctx.setRight(navBtn('plus', '新建', plusMenu));
  const search = h('input', { placeholder: '搜索聊天', value: query, oninput: e => { query = e.target.value.trim(); draw(); } });
  const listBox = h('div');
  ctx.body.append(h('div.as-chat-search', icon('search', 17, 2), search),
    h('div.as-chat-filter', segmented([['all', '全部'], ['dm', '单聊'], ['group', '群聊']], filter, v => { filter = v; draw(); })), listBox);

  async function plusMenu() {
    const v = await actionSheet('', [
      { value: 'dm', label: '发起单聊', icon: 'chat' }, { value: 'group', label: '发起群聊', icon: 'users' },
      { value: 'add', label: '添加好友', icon: 'user' }, { value: 'card', label: '从酒馆角色卡添加', icon: 'box' },
    ]);
    if (v === 'dm') { const c = await pickContact('发起单聊'); if (c) openRoom(chatForContact(c.id, true)); }
    if (v === 'group') toast('群聊下一轮做');
    if (v === 'add') openContactForm();
    if (v === 'card') { await importFromTavern(); draw(); }
  }
  function draw() {
    listBox.innerHTML = '';
    if (filter === 'group') { listBox.appendChild(empty('群聊下一轮就来')); return; }
    const list = state.chats.filter(c => c.type === 'dm' && contact(c.contactId))
      .filter(c => !query || nameOf(contact(c.contactId)).includes(query) || (c.lastText || '').includes(query))
      .sort((a, b) => (b.pinned - a.pinned) || (b.lastAt - a.lastAt));
    if (!list.length) {
      listBox.appendChild(query ? empty('没有找到相关的聊天') : empty('还没有聊天', h('div', { style: { display: 'grid', gap: '10px' } },
        btn('去添加联系人', 'primary', () => ctx.switchTab('contacts')),
        btn('从酒馆角色卡添加', 'secondary', async () => { if (await importFromTavern()) ctx.switchTab('contacts'); }),
        btn('AI 智能加载', 'text', () => toast('AI 智能加载下一轮做')))));
      return;
    }
    listBox.appendChild(h('div.as-chat-convs', list.map(row)));
  }
  function row(chat) {
    const c = contact(chat.contactId), name = nameOf(c);
    const ava = h('span.as-chat-conv__ava', avatar(avatarOf(c, chat), name, 48, chat.cfg.avatarShape === 'square' ? 'square' : 'round'),
      chat.muted ? (chat.unread ? h('span.as-chat-dot') : null) : badge(chat.unread || 0));
    const icons = h('span.as-chat-conv__icons',
      chat.cfg.streak && chat.streak && chat.streak.days >= 2 ? h('span.is-flame', icon('flame', 13, 2), chat.streak.days) : null,
      chat.muted ? icon('bell', 13, 2) : null);
    const lastText = chat.unread > 1 && chat.muted ? `[${chat.unread}条] ${chat.lastText}` : chat.lastText;
    const el = h('div.as-chat-conv' + (chat.pinned ? '.is-pinned' : ''), { role: 'button', tabindex: 0, onclick: () => openRoom(chat) }, ava,
      h('div.as-chat-conv__main',
        h('div.as-chat-conv__top', h('span.as-chat-conv__name', name), h('span.as-chat-conv__time', time.shortLabel({ at: chat.lastAt, st: chat.lastSt }))),
        h('div.as-chat-conv__bottom', chat.draft ? h('span.as-chat-draft', '[草稿]') : null, h('span.as-chat-conv__text', chat.draft || lastText || ' '), icons)));
    onLongPress(el, () => menu(chat));
    return el;
  }
  async function menu(chat) {
    const v = await actionSheet(nameOf(contact(chat.contactId)), [
      { value: 'pin', label: chat.pinned ? '取消置顶' : '置顶', icon: 'bookmark' },
      { value: 'unread', label: chat.unread ? '标为已读' : '标为未读', icon: 'chat' },
      { value: 'mute', label: chat.muted ? '取消免打扰' : '消息免打扰', icon: 'bell' },
      { value: 'del', label: '删除聊天', icon: 'trash', danger: true },
    ]);
    if (v === 'pin') chat.pinned = !chat.pinned;
    if (v === 'unread') chat.unread = chat.unread ? 0 : 1;
    if (v === 'mute') chat.muted = !chat.muted;
    if (v === 'del') {
      if (!(await dialog({ title: '删除这个聊天？', text: '聊天记录会一起删掉，联系人还在。', confirm: '删除', danger: true }))) return;
      await clearMsgs(chat.id); state.chats.splice(state.chats.indexOf(chat), 1);
    }
    if (v) { commit('chats'); draw(); }
  }
  draw();
  const unsub = subscribe(what => { if (what === 'chats' || what === 'all' || what === 'time') draw(); });
  return unsub;
}
