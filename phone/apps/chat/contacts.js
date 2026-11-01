// 联系人页：固定入口（新的朋友 / 群聊 / 分组）、星标朋友、A–Z 列表 + 右侧字母索引。
import { h, initial } from '../../core/util.js';
import { state, commit, subscribe } from '../../core/store.js';
import { page, group, item, avatar, icon, navBtn, actionSheet, dialog, toast, empty, btn } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { nameOf } from './engine.js';
import { openProfile, openContactForm, sorted } from './people.js';

let query = '';
export function renderContacts(ctx) {
  ctx.setRight(navBtn('plus', '添加', async () => {
    const v = await actionSheet('添加联系人', [
      { value: 'add', label: '手动添加好友', icon: 'user' },
      { value: 'ai', label: 'AI 智能加载', icon: 'sparkle' }, { value: 'lore', label: '从世界书添加', icon: 'note' },
    ]);
    if (v === 'add') openContactForm();
    if (v === 'ai') (await import('./aiload.js')).openAiLoad(draw);
    if (v === 'lore') (await import('./aiload.js')).openLoreAdd(draw);
  }));
  const search = h('input', { placeholder: '搜索名字、备注', value: query, oninput: e => { query = e.target.value.trim(); draw(); } });
  const listBox = h('div');
  const indexBar = h('div.as-chat-indexbar');
  ctx.body.append(h('div.as-chat-search', icon('search', 17, 2), search), listBox);
  ctx.el.appendChild(indexBar);

  function draw() {
    listBox.innerHTML = ''; indexBar.innerHTML = '';
    const all = sorted().filter(c => !query || [c.name, c.nick, c.remark].some(x => x && x.includes(query)));
    if (!query) listBox.appendChild(group('', [
      item({ icon: 'user', color: 'orange', title: '新的朋友', right: state.friendRequests.some(r => r.status === 'pending') ? h('span.as-badge', String(state.friendRequests.filter(r => r.status === 'pending').length)) : null, chevron: true, onClick: () => import('./aiload.js').then(m => m.openNewFriends()) }),
      item({ icon: 'users', color: 'green', title: '群聊', value: String(state.chats.filter(c => c.type === 'group').length), chevron: true, onClick: () => Promise.all([import('./group.js'), import('./room.js')]).then(([G, R]) => G.openGroupList(R.openRoom)) }),
      item({ icon: 'list', color: 'blue', title: '分组', value: String(state.groups.length), chevron: true, onClick: openGroups }),
    ]));
    if (!state.contacts.length) {
      listBox.appendChild(empty('还没有联系人', h('div', { style: { display: 'grid', gap: '10px' } },
        btn('AI 智能加载', 'primary', () => import('./aiload.js').then(m => m.openAiLoad(draw))), btn('手动添加', 'text', () => openContactForm()))));
      return;
    }
    const stars = all.filter(c => c.star);
    if (stars.length && !query) listBox.appendChild(h('div', h('div.as-chat-index-head', '★ 星标朋友'), group('', stars.map(row))));
    const sections = new Map();
    all.forEach(c => { const k = initial(nameOf(c)); if (!sections.has(k)) sections.set(k, []); sections.get(k).push(c); });
    const keys = [...sections.keys()].sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));
    keys.forEach(k => {
      listBox.appendChild(h('div', { dataset: { idx: k } }, h('div.as-chat-index-head', k), group('', sections.get(k).map(row))));
      indexBar.appendChild(h('button', { onclick: () => jump(k) }, k));
    });
    if (!query) listBox.appendChild(h('p', { style: { textAlign: 'center', color: 'var(--as-color-text-2)', font: '400 12px/1 var(--font-ui)', margin: '6px 0 0' } }, `${state.contacts.length} 位联系人`));
  }
  function row(c) {
    return item({ icon: avatar(c.avatar, nameOf(c), 36), color: 'transparent', title: nameOf(c), sub: c.sign || null, onClick: () => openProfile(c.id), cls: 'as-chat-person' });
  }
  function jump(k) { const t = listBox.querySelector(`[data-idx="${k}"]`); if (t) ctx.body.scrollTo({ top: t.offsetTop - 6, behavior: 'smooth' }); }
  // 手指在字母条上滑动也能跳
  indexBar.addEventListener('pointermove', e => { if (e.buttons !== 1 && e.pointerType === 'mouse') return; const b = document.elementFromPoint(e.clientX, e.clientY); if (b && b.parentNode === indexBar) jump(b.textContent); });

  draw();
  const unsub = subscribe(what => { if (what === 'contacts' || what === 'all') draw(); });
  return () => { unsub(); indexBar.remove(); };
}

function simplePage(id, title, text) {
  const p = page({ app: 'chat', id, title, back: true });
  p.body.appendChild(empty(text)); nav.push(p.el);
}
function openGroups() {
  const p = page({ app: 'chat', id: 'chat-contacts-groups', title: '分组', back: true, right: navBtn('plus', '新建分组', async () => {
    const name = await dialog({ title: '新建分组', input: { placeholder: '分组名' }, confirm: '创建' });
    if (name && name.trim()) { state.groups.push(name.trim()); commit('contacts'); draw(); }
  }) });
  function draw() {
    p.body.innerHTML = '';
    p.body.appendChild(group('分组会用在动态的「谁可以看」里', state.groups.map((g, i) => item({
      title: g, value: `${state.contacts.filter(c => c.group === g).length} 人`, chevron: true, onClick: async () => {
        const v = await actionSheet(g, [{ value: 'members', label: '管理成员', icon: 'users' }, { value: 'rename', label: '改名', icon: 'edit' }, { value: 'del', label: '删除分组', icon: 'trash', danger: true }]);
        if (v === 'rename') { const n = await dialog({ title: '改名', input: { value: g } }); if (n && n.trim()) { state.contacts.forEach(c => { if (c.group === g) c.group = n.trim(); }); state.groups[i] = n.trim(); } }
        if (v === 'del') { state.contacts.forEach(c => { if (c.group === g) c.group = ''; }); state.groups.splice(i, 1); }
        if (v === 'members') {
          const { pickMany } = await import('./people.js');
          const sel = await pickMany(`「${g}」的成员`, sorted().map(c => ({ key: c.id, name: nameOf(c), avatar: c.avatar, note: c.group && c.group !== g ? c.group : '' })), { preselect: state.contacts.filter(c => c.group === g).map(c => c.id) });
          if (sel) state.contacts.forEach(c => { if (sel.includes(c.id)) c.group = g; else if (c.group === g) c.group = ''; });
        }
        if (v) { commit('contacts'); draw(); }
      },
    }))));
  }
  draw(); nav.push(p.el);
}
