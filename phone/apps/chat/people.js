// 联系人相关的页面和抽屉：资料页（直接改）、手动添加、选人。
import { h, uid, sortZh } from '../../core/util.js';
import { state, commit, contact, chatForContact, clearMsgs } from '../../core/store.js';
import { page, group, item, input, textarea, field, segmented, btn, avatar, icon, navText, sheet, dialog, toast, toggleItem, pickImage, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { nameOf, relinkMoments } from './engine.js';

export const blankContact = () => ({ id: uid('p'), name: '', nick: '', remark: '', gender: '', region: '', sign: '', pokeSuffix: '', avatar: '', charKey: '', persona: '', source: 'manual', star: false, group: '', createdAt: Date.now() });
export const sorted = () => [...state.contacts].sort((a, b) => sortZh(nameOf(a), nameOf(b)));

/* ---------- 选一个人（发起单聊等） ---------- */
export function pickContact(title = '选择联系人') {
  return new Promise(res => {
    let done = false;
    const list = sorted();
    const s = sheet({ title, onClose: () => { if (!done) res(null); }, content: list.length
      ? h('div.as-chat-pick', list.map(c => h('div.as-chat-pick__row', { role: 'button', onclick: () => { done = true; s.close(); res(c); } }, avatar(c.avatar, nameOf(c), 36), h('span', nameOf(c)))))
      : h('div.as-empty', h('div.as-empty__text', '还没有联系人，先去「联系人」里添加吧')) });
  });
}
/** 选多个人 */
export function pickMany(title, list, { preselect = [], disabled = [] } = {}) {
  return new Promise(res => {
    const sel = new Set(preselect); let done = false;
    const rows = list.map(x => {
      const ck = h('span.as-chat-check' + (sel.has(x.key) ? '.is-active' : '') + (disabled.includes(x.key) ? '.is-disabled' : ''), icon('check', 14, 2.6));
      return h('div.as-chat-pick__row', { role: 'button', onclick: () => { if (disabled.includes(x.key)) return; sel.has(x.key) ? sel.delete(x.key) : sel.add(x.key); ck.classList.toggle('is-active', sel.has(x.key)); } },
        ck, h('span', x.name), x.note && h('span.as-muted', x.note), x.avatar !== false && avatar(x.avatar, x.name, 34));
    });
    const s = sheet({ title, onClose: () => { if (!done) res(null); }, content: h('div.as-stack-gap', h('div.as-chat-pick', rows),
      btn('确定', 'primary', () => { done = true; s.close(); res([...sel]); })) });
  });
}

/* ---------- 手动添加；资料页直接改也用这几组输入框 ---------- */
function contactFields(c, changed = () => {}) {
  const f = (label, key, ph, hint) => field(label, input({ value: c[key] || '', placeholder: ph, onInput: v => { c[key] = v; changed(key); } }), hint);
  return [
    group('名字', [f(withInfo('真实姓名', 'AI 按这个认人。'), 'name', ''), f('网名', 'nick', ''), f(withInfo('备注', '只有你看得到。'), 'remark', '')]),
    group('资料', [
      field('性别', segmented([['', '不写'], ['男', '男'], ['女', '女'], ['其他', '其他']], c.gender || '', v => { c.gender = v; changed('gender'); })),
      f('地区', 'region', ''), f('个性签名', 'sign', ''), f(withInfo('拍一拍后缀', '你拍 TA 时显示「你拍了拍 TA」加上这里写的字。'), 'pokeSuffix', ''),
    ]),
    group('人设', [field(c.charKey ? '补充 / 覆盖人设' : '人设', textarea({ value: c.persona || '', placeholder: c.charKey ? '留空就用角色卡里的人设' : '性格、经历、和你的关系……', rows: 5, onInput: v => { c.persona = v; changed('persona'); } }))]),
  ];
}
export function openContactForm() {
  const c = blankContact();
  const ava = h('div', { style: { display: 'grid', placeItems: 'center', padding: '6px 0 18px' } });
  const drawAva = () => { ava.innerHTML = ''; ava.appendChild(h('button', { style: { border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'grid', justifyItems: 'center', gap: '8px', color: 'var(--as-color-accent)', font: '500 13px/1 var(--font-ui)' },
    onclick: async () => { const v = await pickImage('头像', { has: !!c.avatar }); if (v != null) { c.avatar = v; drawAva(); } } }, avatar(c.avatar, c.name || c.nick || '新', 76), '更换头像')); };
  drawAva();
  const p = page({ app: 'chat', id: 'chat-contacts-add', title: '添加好友', back: true,
    right: navText('保存', () => {
      if (!c.name.trim() && !c.nick.trim()) { toast('至少填一个名字'); return; }
      c.name = c.name.trim() || c.nick.trim();
      state.contacts.push(c); chatForContact(c.id, true).lastAt = Date.now();
      commit('contacts'); toast('已添加'); nav.pop();
    }, true) });
  p.body.append(ava, ...contactFields(c));
  nav.push(p.el);
}

/* ---------- 资料页：内容直接改，改了就存 ---------- */
export function openProfile(cid, { onMessage } = {}) {
  const c = contact(cid); if (!c) { toast('这个联系人不在了'); return; }
  const p = page({ app: 'chat', id: 'chat-profile', title: '', back: true });
  const ava = h('button.as-chat-profile__ava', { 'aria-label': '换头像', onclick: async () => { const v = await pickImage('头像', { has: !!c.avatar }); if (v != null) { c.avatar = v; commit('contacts'); paintAva(); } } });
  const paintAva = () => ava.replaceChildren(avatar(c.avatar, nameOf(c), 72, 'square'));
  const nameEl = h('div.as-chat-profile__name'), lines = h('div');
  const paintHead = () => {
    const line = (k, v) => v ? h('div.as-chat-profile__line', `${k}：${v}`) : null;
    nameEl.replaceChildren(nameOf(c), c.star ? h('span.as-chat-star', icon('star', 16, 2)) : '', c.gender === '男' ? h('span.as-muted', '♂') : c.gender === '女' ? h('span.as-muted', '♀') : '');
    lines.replaceChildren(...[c.remark && line('昵称', c.nick || c.name), line('真实姓名', c.name !== nameOf(c) ? c.name : ''), line('地区', c.region)].filter(Boolean));
  };
  const thumbs = h('div.as-chat-thumbs');
  const paintMoments = () => { relinkMoments(); const ms = state.moments.filter(m => m.author === c.id).slice(0, 4);
    thumbs.replaceChildren(...ms.map(m => m.images && m.images[0] ? h('span', { style: { backgroundImage: `url(${m.images[0]})` } }) : h('span', (m.text || '').slice(0, 8)))); };   // 没有动态就空着
  const keep = { ...c };   // 名字清空时不存空的
  const changed = k => {
    if ((k === 'name' || k === 'nick') && !c.name.trim() && !c.nick.trim()) { c.name = keep.name; return; }
    keep.name = c.name; commit('contacts');
    if (['name', 'nick', 'remark', 'gender', 'region'].includes(k)) { paintHead(); if (!c.avatar) paintAva(); }
  };
  const starBtn = btn(c.star ? '取消星标' : '设为星标朋友', 'secondary', () => { c.star = !c.star; commit('contacts'); starBtn.textContent = c.star ? '取消星标' : '设为星标朋友'; paintHead(); toast(c.star ? '已设为星标' : '已取消星标'); });
  paintAva(); paintHead(); paintMoments();
  p.body.append(
    h('div.as-chat-profile', ava, h('div.as-chat-profile__main', nameEl, lines)),
    h('div.as-chat-profile__btns',
      btn('发消息', 'primary', () => { const chat = chatForContact(c.id, true); onMessage ? onMessage(chat) : import('./room.js').then(m => m.openRoom(chat)); }),
      btn('打电话', 'secondary', () => import('./specials.js').then(m => m.openCall(chatForContact(c.id, true), c, 'voice')))),
    group('', [
      item({ title: '动态', right: thumbs, chevron: true, onClick: () => import('./moments.js').then(m => m.openUserMoments(c.id)) }),
      // 声音：和设置 → 连接 → 音色库里的是同一份
      item({ title: '声音', chevron: true, onClick: () => import('../settings/voices.js').then(m => m.openPerson(c.id)) }),
      item({ title: '和 TA 的缘分报告', chevron: true, onClick: () => import('../music/report.js').then(m => m.openReport(c)) }),
    ]),
    ...contactFields(c, changed),
    h('div.as-chat-profile__btns', starBtn, btn('删除联系人', 'danger', async () => {
      if (!(await dialog({ title: `删除「${nameOf(c)}」？`, text: '和 TA 的聊天记录也会一起删掉。', confirm: '删除', danger: true }))) return;
      const ch = state.chats.find(x => x.contactId === c.id);
      if (ch) { await clearMsgs(ch.id); state.chats.splice(state.chats.indexOf(ch), 1); }
      state.contacts.splice(state.contacts.indexOf(c), 1); commit('contacts'); commit('chats'); nav.pop();
    })));
  p.el._onShow = paintMoments;   // 从动态页回来：只刷新那几张小图
  nav.push(p.el);
}
export { toggleItem };
