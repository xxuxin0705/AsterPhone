// 联系人相关的页面和抽屉：资料页、手动添加 / 编辑、选人。
import { h, uid, sortZh, fileToDataURL, pickFile } from '../../core/util.js';
import { state, commit, contact, chatForContact, clearMsgs } from '../../core/store.js';
import { page, group, item, input, textarea, field, segmented, btn, avatar, icon, navText, navBtn, sheet, actionSheet, dialog, toast, toggleItem } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { nameOf, personaOf, genMoment, relinkMoments } from './engine.js';

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
        ck, h('span', x.name), x.note && h('span.as-muted', x.note), avatar(x.avatar, x.name, 34));
    });
    const s = sheet({ title, onClose: () => { if (!done) res(null); }, content: h('div.as-stack-gap', h('div.as-chat-pick', rows),
      btn('确定', 'primary', () => { done = true; s.close(); res([...sel]); })) });
  });
}

/* ---------- 手动添加 / 编辑 ---------- */
export function openContactForm(existing) {
  const c = existing ? { ...existing } : blankContact();
  const ava = h('div', { style: { display: 'grid', placeItems: 'center', padding: '6px 0 18px' } });
  const drawAva = () => { ava.innerHTML = ''; ava.appendChild(h('button', { style: { border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'grid', justifyItems: 'center', gap: '8px', color: 'var(--as-color-accent)', font: '500 13px/1 var(--font-ui)' },
    onclick: async () => { const f = await pickFile(); if (f) { c.avatar = await fileToDataURL(f, 320); drawAva(); } } }, avatar(c.avatar, c.name || c.nick || '新', 76), '更换头像')); };
  drawAva();
  const f = (label, key, ph, hint) => field(label, input({ value: c[key] || '', placeholder: ph, onInput: v => { c[key] = v; } }), hint);
  const p = page({ app: 'chat', id: 'chat-contacts-add', title: existing ? '编辑资料' : '添加好友', back: true,
    right: navText('保存', () => {
      if (!c.name.trim() && !c.nick.trim()) { toast('至少填一个名字'); return; }
      c.name = c.name.trim() || c.nick.trim();
      if (existing) Object.assign(existing, c); else state.contacts.push(c);
      commit('contacts'); toast(existing ? '已保存' : '已添加'); nav.pop();
    }, true) });
  const personaBox = textarea({ value: c.persona || '', placeholder: c.charKey ? '留空就用角色卡里的人设' : '性格、经历、和你的关系……', rows: 5, onInput: v => { c.persona = v; } });
  p.body.append(ava,
    group('名字', [f('真实姓名（AI 按这个认人）', 'name', '例如：周叙白'), f('网名', 'nick', '例如：白'), f('备注', 'remark', '只有你看得到')]),
    group('资料', [
      field('性别', segmented([['', '不写'], ['男', '男'], ['女', '女'], ['其他', '其他']], c.gender || '', v => { c.gender = v; })),
      f('地区', 'region', '例如：上海'), f('个性签名', 'sign', ''), f('拍一拍后缀', 'pokeSuffix', '例如：的小脑袋', '你拍 TA 时显示「你拍了拍 TA的小脑袋」'),
    ]),
    group('人设', [
      c.charKey ? item({ title: '人设来源', value: '角色卡' }) : null,
      field(c.charKey ? '补充 / 覆盖人设' : '人设', personaBox),
    ].filter(Boolean)));
  nav.push(p.el);
}

/* ---------- 资料页 ---------- */
export function openProfile(cid, { onMessage } = {}) {
  const c = contact(cid); if (!c) { toast('这个联系人不在了'); return; }
  const p = page({ app: 'chat', id: 'chat-profile', title: '', back: true, right: navBtn('more', '更多', async () => {
    const v = await actionSheet(nameOf(c), [
      { value: 'edit', label: '编辑资料', icon: 'edit' },
      { value: 'star', label: c.star ? '取消星标' : '设为星标朋友', icon: 'star' },
      { value: 'moment', label: '让 TA 发一条动态', icon: 'sparkle' },
      { value: 'del', label: '删除联系人', icon: 'trash', danger: true },
    ]);
    if (v === 'edit') openContactForm(c);
    if (v === 'star') { c.star = !c.star; commit('contacts'); draw(); toast(c.star ? '已设为星标' : '已取消星标'); }
    if (v === 'moment') { toast('正在生成…', true); try { await genMoment(c); toast('TA 发了一条新动态'); draw(); } catch (e) { toast('生成失败：' + e.message); } }
    if (v === 'del') {
      if (!(await dialog({ title: `删除「${nameOf(c)}」？`, text: '和 TA 的聊天记录也会一起删掉。', confirm: '删除', danger: true }))) return;
      const ch = state.chats.find(x => x.contactId === c.id);
      if (ch) { await clearMsgs(ch.id); state.chats.splice(state.chats.indexOf(ch), 1); }
      state.contacts.splice(state.contacts.indexOf(c), 1); commit('contacts'); commit('chats'); nav.pop();
    }
  }) });
  function draw() {
    p.body.innerHTML = '';
    const line = (k, v) => v ? h('div.as-chat-profile__line', `${k}：${v}`) : null;
    relinkMoments(); const moments = state.moments.filter(m => m.author === c.id).slice(0, 4);
    p.body.append(
      h('div.as-chat-profile', avatar(c.avatar, nameOf(c), 72, 'square'), h('div.as-chat-profile__main',
        h('div.as-chat-profile__name', nameOf(c), c.star && h('span.as-chat-star', icon('star', 16, 2)), c.gender === '男' ? h('span.as-muted', '♂') : c.gender === '女' ? h('span.as-muted', '♀') : null),
        c.remark && line('昵称', c.nick || c.name), line('真实姓名', c.name !== nameOf(c) ? c.name : ''), line('地区', c.region))),
      h('div.as-chat-profile__btns',
        btn('发消息', 'primary', () => { const chat = chatForContact(c.id, true); onMessage ? onMessage(chat) : import('./room.js').then(m => m.openRoom(chat)); }),
        btn('打电话', 'secondary', () => toast('语音通话下一轮做'))),
      group('', [
        item({ title: '个性签名', sub: c.sign || '这个人很懒，什么都没写' }),
        item({ title: '动态', right: h('div.as-chat-thumbs', moments.length ? moments.map(m => m.images && m.images[0] ? h('span', { style: { backgroundImage: `url(${m.images[0]})` } }) : h('span', (m.text || '').slice(0, 8))) : h('span.as-muted', '还没有')), chevron: true,
          onClick: () => import('./moments.js').then(m => m.openUserMoments(c.id)) }),
        item({ title: '人设来源', value: c.charKey ? '角色卡' : c.source === 'story' ? '正文里出现' : '手写' }),
        // 声音：和设置 → 连接 → 音色库里的是同一份
        item({ title: '声音', chevron: true, onClick: () => import('../settings/voices.js').then(m => m.openPerson(c.id)) }),
      ]),
      personaOf(c) ? group('人设', [h('div.as-chat-me-about', { onclick: e => e.currentTarget.classList.toggle('is-open') }, personaOf(c))], '点一下展开') : null);
  }
  draw();
  p.el._onShow = draw;
  nav.push(p.el);
}
export { toggleItem };
