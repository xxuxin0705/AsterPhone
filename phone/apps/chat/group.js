// 群聊：建群、群头像（没设置时是群名第一个字）、群设置（资料 / 成员 / 行为 / 数据）。
import { h } from '../../core/util.js';
import { state, commit, contact, clearMsgs } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, slider, avatar, icon, actionSheet, dialog, toast, field, input, textarea, btn, empty, pickImage, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { connLabel } from '../../core/api.js';
import * as E from './engine.js';
import * as P from '../../core/promptstore.js';
import { trGroup, replyGroup } from './room.js';

/** 群头像：设置了就用；没设置就是群名第一个字 */
export function groupAvatar(chat, size = 44) {
  const a = avatar(chat.avatar, [...(chat.name || '群')][0], size); a.style.borderRadius = '26%'; return a;
}

/** 发起群聊：选人 → 起名 → 建好直接打开 */
export async function createGroupFlow() {
  const { pickMany, sorted } = await import('./people.js');
  if (state.contacts.length < 2) { toast('至少要有 2 个联系人才能建群'); return null; }
  const ids = await pickMany('选群成员（至少 2 个）', sorted().map(c => ({ key: c.id, name: E.nameOf(c), avatar: c.avatar })));
  if (!ids) return null;
  if (ids.length < 2) { toast('至少选 2 个人'); return null; }
  const name = await dialog({ title: '给群起个名字', input: { placeholder: ids.slice(0, 3).map(id => E.nameOf(contact(id))).join('、') }, confirm: '建群' });
  if (name === null) return null;
  const g = E.createGroup(ids, (name || '').trim());
  await E.addSystem(g, `你邀请 ${ids.map(id => E.nameOf(contact(id))).join('、')} 加入了群聊`);
  return g;
}

/* ================= 群设置 ================= */
let lastTab = 'info';
export function openGroupSettings(chat, redrawRoom) {
  const cfg = chat.cfg;
  const p = page({ app: 'chat', id: 'chat-group-settings', title: '群设置', back: true });
  const save = () => commit('chats');
  const sliderRow = (label, min, max, step, val, fn, fmt = v => v) => {
    const out = h('output', fmt(val));
    return h('div.as-settings-slider-row', h('span', label), slider({ min, max, step, value: val, onInput: v => { out.textContent = fmt(v); fn(v); } }), out);
  };
  const TABS = [['info', '资料'], ['members', '成员'], ['act', '行为'], ['data', '数据']];
  const head = h('div.as-chat-set-head'), tabsEl = h('div.as-chat-set-tabs', TABS.map(([k, l]) => h('button', { dataset: { k }, onclick: () => { lastTab = k; draw(); } }, l))), box = h('div');
  p.body.append(head, tabsEl, box);
  function draw() {
    head.style.backgroundImage = cfg.bg ? `url(${cfg.bg})` : '';
    head.replaceChildren(h('div.as-chat-set-head__ava', groupAvatar(chat, 76)), h('div.as-chat-set-head__name', E.groupTitle(chat)), h('div.as-chat-set-head__sign', chat.notice ? '公告：' + chat.notice.slice(0, 30) : '点资料页改群名、群公告'));
    [...tabsEl.children].forEach(b => b.classList.toggle('is-active', b.dataset.k === lastTab));
    box.innerHTML = '';
    if (lastTab === 'info') box.append(
      group('群资料', [
        item({ title: '群头像', right: groupAvatar(chat, 30), chevron: true, onClick: async () => {
          const v = await pickImage('群头像', { has: !!chat.avatar }); if (v == null) return;
          chat.avatar = v; save(); draw();
        } }),
        field('群名', input({ value: chat.name, onInput: v => { chat.name = v.trim() || chat.name; save(); } })),
        field('群介绍（只给 AI 看，帮它理解这是个什么群）', textarea({ value: chat.intro || '', rows: 3, placeholder: '例如：大学室友群，平时互损', onInput: v => { chat.intro = v; save(); } })),
        field('群公告', textarea({ value: chat.notice || '', rows: 2, placeholder: '可以不写', onInput: v => { chat.notice = v; save(); } })),
      ]),
      group('我在本群', [
        field('我的群昵称', input({ value: cfg.myNick || '', placeholder: state.me.nick || '不填就用我的网名', onInput: v => { cfg.myNick = v.trim(); save(); } })),
        field('我的头衔', input({ value: cfg.myTitle || '', placeholder: '例如：群宠', onInput: v => { cfg.myTitle = v.trim(); save(); } })),
        item({ title: '我在本群的头像', right: cfg.myAvatar ? avatar(cfg.myAvatar, '', 30) : h('span.as-muted', '默认'), chevron: true, onClick: async () => {
          const v = await pickImage('我在本群的头像', { has: !!cfg.myAvatar }); if (v != null) { cfg.myAvatar = v; save(); draw(); }
        } }),
        item({ title: '聊天背景', right: cfg.bg ? avatar(cfg.bg, '', 30, 'square') : h('span.as-muted', '默认'), chevron: true, onClick: async () => {
          const v = await pickImage('聊天背景', { ratio: 'screen', size: 1100, has: !!cfg.bg }); if (v == null) return;
          cfg.bg = v; save(); draw();
        } }),
      ]));
    if (lastTab === 'members') {
      const grid = h('div.as-chat-members',
        h('div.as-chat-members__me', avatar(cfg.myAvatar || P.myAvatar(), state.me.nick || '我', 48), h('span', cfg.myNick || state.me.nick || '我'), h('em', chat.owner === 'me' ? '群主' : (cfg.myTitle || ''))),
        ...chat.members.map(id => {
          const m = contact(id); if (!m) return null;
          return h('button', { onclick: () => memberMenu(id) }, avatar(m.avatar, E.nameOf(m), 48), h('span', E.nameOf(m)),
            h('em', chat.owner === id ? '群主' : (chat.admins || []).includes(id) ? '管理员' : (chat.titles[id] || '')));
        }),
        h('button.as-chat-members__add', { onclick: invite }, h('span.as-chat-members__plus', icon('plus', 22, 1.8)), h('span', '邀请')));
      box.append(group(`成员（${chat.members.length + 1}）`, [grid], '点成员可以看资料、设头衔、设管理员、移出群聊。'));
    }
    if (lastTab === 'act') box.append(
      group('基础', [
        toggleItem({ title: '置顶聊天' }, chat.pinned, v => { chat.pinned = v; save(); }),
        toggleItem({ title: '消息免打扰' }, chat.muted, v => { chat.muted = v; save(); }),
      ]),
      group(withInfo('谁来说话', '点「让大家回复」时，AI 一次决定谁说、说几条、谁转去私聊你、谁在忙不回。被 @ 的人优先。'), [
        sliderRow('每轮最多几个人说话', 1, 8, 1, cfg.maxSpeakers || 3, v => { cfg.maxSpeakers = v; save(); }),
        item({ title: '有人想私下找你时', value: '在群请求里顺便写好' }),
      ]),
      replyGroup(chat, save),
      group('AI', [
        item({ title: '提示词方案', value: P.schemeLabel('group', cfg.prompt), chevron: true, onClick: async e => {
          const valEl = e.currentTarget.querySelector('.as-list-item__value');
          const v = await actionSheet('这个聊天用哪套提示词', P.schemeOptions('group', cfg.prompt)); if (v == null) return;
          cfg.prompt = v; save(); valEl.textContent = P.schemeLabel('group', v);
        } }),
        item({ title: '使用的连接', value: cfg.conn && cfg.conn !== 'follow' ? connLabel(state.connections.text.find(x => x.id === cfg.conn)) : '跟随应用设置', chevron: true, onClick: async () => {
          const v = await actionSheet('这个群用哪个连接', [{ value: 'follow', label: '跟随应用设置', active: !cfg.conn || cfg.conn === 'follow' }, ...state.connections.text.map(x => ({ value: x.id, label: x.name, active: cfg.conn === x.id }))]);
          if (v) { cfg.conn = v; save(); draw(); }
        } }),
        toggleItem({ title: '专属温度' }, cfg.temperature != null, v => { cfg.temperature = v ? .9 : null; save(); draw(); }),
        cfg.temperature != null ? sliderRow('温度', 0, 1.5, .05, cfg.temperature, v => { cfg.temperature = v; save(); }, v => Number(v).toFixed(2)) : null,
      ].filter(Boolean)),
      ...(cfg.linkMode === 'online' ? (() => {
        const every = sliderRow('多久热闹一次', 1, 24, 1, cfg.proactiveEvery || state.apps.chat.defaults.proactiveEvery || 3, v => { cfg.proactiveEvery = v; save(); }, v => v + ' 小时');
        every.style.display = E.proactiveOn(cfg) ? '' : 'none';
        return [group('主动消息', [toggleItem({ title: '群里自己聊起来' }, E.proactiveOn(cfg), v => { cfg.proactive = v; save(); every.style.display = v ? '' : 'none'; }), every])];
      })() : []),
      group('剧情关联', [
        h('div.as-field', h('span.as-field__label', '联动方式'), segmented([['follow', '跟随正文'], ['online', '仅线上聊天']], cfg.linkMode, v => { cfg.linkMode = v; save(); commit('inject'); })),
        sliderRow('注入条数', 0, 40, 1, cfg.injectCount ?? 12, v => { cfg.injectCount = v; save(); commit('inject'); }),
      ]),
      trGroup(cfg, save, draw));
    if (lastTab === 'data') box.append(group('', [
      item({ title: '导出群聊记录', chevron: true, onClick: () => import('./transfer.js').then(m => m.exportChats([chat])) }),
      item({ title: '清空聊天记录', danger: true, onClick: async () => {
        if (!(await dialog({ title: '清空群聊记录？', text: '此操作无法撤销。', confirm: '清空', danger: true }))) return;
        await clearMsgs(chat.id); chat.lastText = ''; chat.unread = 0; save(); toast('已清空');
      } }),
      item({ title: '退出并删除群聊', danger: true, onClick: async () => {
        if (!(await dialog({ title: `退出「${chat.name}」？`, text: '群和聊天记录都会删掉。', confirm: '退出', danger: true }))) return;
        await clearMsgs(chat.id); state.chats.splice(state.chats.indexOf(chat), 1); commit('chats'); nav.pop(); nav.pop();
      } }),
    ]));
  }
  async function memberMenu(id) {
    const m = contact(id); if (!m) return;
    const isAdmin = (chat.admins || []).includes(id);
    const v = await actionSheet(E.nameOf(m), [
      { value: 'profile', label: '查看资料', icon: 'user' }, { value: 'title', label: '设置群头衔', icon: 'star' },
      { value: 'admin', label: isAdmin ? '取消管理员' : '设为管理员', icon: 'bookmark' }, { value: 'owner', label: '转让群主给 TA', icon: 'users' },
      { value: 'kick', label: '移出群聊', icon: 'trash', danger: true },
    ]);
    if (v === 'profile') (await import('./people.js')).openProfile(id);
    if (v === 'title') { const t = await dialog({ title: '群头衔', input: { value: chat.titles[id] || '', placeholder: '例如：话痨担当' } }); if (t !== null) { chat.titles[id] = t.trim(); commit('chats'); draw(); } }
    if (v === 'admin') { chat.admins = isAdmin ? chat.admins.filter(x => x !== id) : [...(chat.admins || []), id]; commit('chats'); draw(); }
    if (v === 'owner') { chat.owner = id; commit('chats'); await E.addSystem(chat, `你把群主转让给了「${E.nameOf(m)}」`); draw(); }
    if (v === 'kick') {
      if (chat.members.length <= 2) { toast('群里至少要留 2 个人'); return; }
      chat.members = chat.members.filter(x => x !== id); commit('chats'); await E.addSystem(chat, `你把「${E.nameOf(m)}」移出了群聊`); draw();
    }
  }
  async function invite() {
    const { pickMany, sorted } = await import('./people.js');
    const rest = sorted().filter(c => !chat.members.includes(c.id));
    if (!rest.length) { toast('联系人都已经在群里了'); return; }
    const ids = await pickMany('邀请谁进群', rest.map(c => ({ key: c.id, name: E.nameOf(c), avatar: c.avatar })));
    if (!ids || !ids.length) return;
    chat.members.push(...ids); commit('chats');
    await E.addSystem(chat, `你邀请 ${ids.map(id => E.nameOf(contact(id))).join('、')} 加入了群聊`); draw();
  }
  draw();
  p.el._onShow = draw;
  p.el._onLeave = () => { redrawRoom && setTimeout(() => redrawRoom(true), 0); };
  nav.push(p.el);
}

/** 联系人 → 群聊：所有群的列表 */
export function openGroupList(openRoom) {
  const p = page({ app: 'chat', id: 'chat-contacts-groups', title: '群聊', back: true });
  const draw = () => {
    p.body.innerHTML = '';
    const gs = state.chats.filter(c => c.type === 'group');
    p.body.append(
      gs.length ? group('', gs.map(g => item({ icon: groupAvatar(g, 36), color: 'transparent', title: E.groupTitle(g), sub: g.lastText || g.intro || null, chevron: true, cls: 'as-chat-person', onClick: () => openRoom(g) }))) : empty('还没有群聊'),
      btn('发起群聊', 'primary', async () => { const g = await createGroupFlow(); if (g) openRoom(g); }, { style: { width: '100%' } }));
  };
  draw(); p.el._onShow = draw; nav.push(p.el);
}
