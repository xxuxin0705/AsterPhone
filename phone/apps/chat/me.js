// 我：主页（头像、数字格、签名、关于我）、编辑资料、钱包、收藏。
import { h } from '../../core/util.js';
import { state, commit, subscribe, getMsgs, contact } from '../../core/store.js';
import { page, group, item, field, input, textarea, segmented, avatar, icon, navText, toast, empty, dialog, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as time from '../../core/time.js';
import { userPersona, userName, inTavern } from '../../core/bridge.js';
import { myName, myNick, myPersona, myAvatar } from '../../core/promptstore.js';
import { nameOf } from './engine.js';
import { feedInto } from './moments.js';

const STAT_LABEL = { moments: '动态', friends: '好友', messages: '消息', balance: '余额' };
export function renderMe(ctx) {
  ctx.setRight(navText('编辑', openEdit, true));
  const box = h('div');
  ctx.body.appendChild(box);
  async function draw() {
    let msgCount = 0;
    for (const c of state.chats) msgCount += (await getMsgs(c.id)).filter(m => m.from === 'me').length;
    const val = { moments: state.moments.filter(m => m.author === 'me').length, friends: state.contacts.length, messages: msgCount, balance: '¥' + (state.me.balance ?? 0) };
    const me = state.me;
    const about = myPersona();
    box.innerHTML = '';
    box.append(
      h('div.as-chat-me-head', h('button', { style: { border: 0, background: 'none', padding: 0, cursor: 'pointer' }, 'aria-label': '换头像', onclick: changeAvatar }, avatar(myAvatar(), myNick(), 72, 'square')),
        h('div.as-chat-me-head__main', h('div.as-chat-me-head__name', myNick()), h('div.as-chat-me-head__id', '真名：' + myName()), h('div.as-chat-me-head__sign', me.sign || '还没有个性签名'))),
      h('div.as-chat-me-stats', (me.stats || []).slice(0, 4).map(k => h('div.as-chat-me-stat', h('b', String(val[k] ?? '-')), h('span', STAT_LABEL[k] || k)))),
      (me.birthday || me.region || (me.tags || []).length) ? h('div.as-chips', { style: { margin: '0 4px 16px' } },
        me.birthday && h('span.as-chip', '🎂 ' + me.birthday), me.region && h('span.as-chip', '📍 ' + me.region), (me.tags || []).map(t => h('span.as-chip', '# ' + t))) : null,
      group('关于我' + (me.persona == null ? '（跟随酒馆）' : '（已独立）'), [h('div.as-chat-me-about', { onclick: e => e.currentTarget.classList.toggle('is-open') }, about || '还没有人设。点右上「编辑」写一写，或者在酒馆里设置用户人设。')], about ? '点一下展开 / 收起' : null),
      group('', [
        item({ icon: 'wallet', color: 'gold', title: '钱包', value: '¥' + (me.balance ?? 0), chevron: true, onClick: openWallet }),
        item({ icon: 'bookmark', color: 'orange', title: '收藏', value: String(state.favorites.length), chevron: true, onClick: openFavorites }),
        item({ icon: 'smile', color: 'pink', title: '表情包', value: String(state.stickers.length), chevron: true, onClick: () => import('./specials.js').then(m => m.openStickerManager()) }),
        item({ icon: 'image', color: 'teal', title: '聊天背景', chevron: true, onClick: () => toast('在每个聊天的「···」→ 外观 里换') }),
      ]),
      group('我的动态', [h('div', { style: { paddingBottom: '4px' } }, (() => { const f = h('div'); feedInto(f, state.moments.filter(m => m.author === 'me'), draw); return f; })())]));
  }
  async function changeAvatar() { const v = await pickImage('头像', { has: !!state.me.avatar }); if (v == null) return; state.me.avatar = v; commit('me'); draw(); }
  draw();
  ctx.el._onShowMe = draw;
  const unsub = subscribe(w => { if (w === 'me' || w === 'all' || w === 'moments') draw(); });
  return unsub;
}

function openEdit() {
  const me = state.me, d = { ...me, tags: (me.tags || []).join('，'), persona: me.persona };
  const f = (label, key, ph, hint) => field(label, input({ value: d[key] || '', placeholder: ph, onInput: v => { d[key] = v; } }), hint);
  const following = () => d.persona == null;
  const personaBox = textarea({ value: myPersona(), rows: 6, placeholder: '你是谁、性格、和大家的关系……', onInput: v => { d.persona = v; mark.textContent = '已独立'; resetBtn.hidden = false; } });
  const mark = h('span.as-tag-accent', following() ? '跟随酒馆' : '已独立');
  const resetBtn = h('button.as-inline-btn', { hidden: following(), onclick: () => { d.persona = null; personaBox.value = userPersona(); mark.textContent = '跟随酒馆'; resetBtn.hidden = true; } }, '重新跟随酒馆');
  const p = page({ app: 'chat', id: 'chat-me-edit', title: '编辑资料', back: true, right: navText('保存', () => {
    Object.assign(me, { realName: d.realName.trim(), nick: d.nick.trim(), sign: d.sign, gender: d.gender, birthday: d.birthday, region: d.region,
      tags: String(d.tags || '').split(/[,，、\s]+/).filter(Boolean).slice(0, 8), persona: d.persona == null ? null : d.persona });
    commit('me'); toast('已保存'); nav.pop();
  }, true) });
  p.body.append(
    group('名字', [f('真名（AI 记忆按这个认你）', 'realName', inTavern() ? `不填就用酒馆里的「${userName()}」` : '例如：林小满'), f('网名（只改显示）', 'nick', '')]),
    group('资料', [f('个性签名', 'sign', ''), field('性别', segmented([['', '不写'], ['男', '男'], ['女', '女'], ['其他', '其他']], d.gender || '', v => { d.gender = v; })),
      f('生日', 'birthday', '例如：3月14日'), f('所在地', 'region', '例如：雾港'), f('兴趣标签', 'tags', '用逗号隔开，例如：摄影，猫')]),
    group('人设（只在手机里用，不写回酒馆、不注入正文）', [h('div.as-field', h('div.as-row', h('span.as-field__label', { style: { flex: 1 } }, '当前：', mark), resetBtn), personaBox)],
      '没改过就跟随酒馆里的用户人设；改过就独立保存。'),
    group('', [item({ title: '用户连结、绑定世界书、生图外观、我的声音', value: '下一轮', onClick: () => toast('这些下一轮做') })]));
  nav.push(p.el);
}

function openWallet() {
  const p = page({ app: 'chat', id: 'chat-wallet', title: '钱包', back: true });
  p.body.append(h('div.as-chat-wallet', h('span.as-muted', '余额'), h('b', '¥' + (state.me.balance ?? 0))),
    group('', [item({ title: '修改余额', chevron: true, onClick: async () => {
      const v = await dialog({ title: '修改余额', input: { value: String(state.me.balance ?? 0) } });
      if (v != null && !isNaN(parseFloat(v))) { state.me.balance = Math.round(parseFloat(v) * 100) / 100; commit('me'); nav.pop(); toast('已修改'); }
    } })]),
    group('收支明细', []));
  import('./specials.js').then(m => { p.body.lastElementChild.querySelector('.as-list-group__body').append(...m.ledgerList()); });
  nav.push(p.el);
}
export function openFavorites() {
  const p = page({ app: 'chat', id: 'chat-favorites', title: '收藏', back: true });
  const draw = () => {
    p.body.innerHTML = '';
    if (!state.favorites.length) { p.body.appendChild(empty('长按聊天里的消息 → 收藏，就会出现在这里')); return; }
    p.body.appendChild(group('', state.favorites.slice().reverse().map(f => item({ title: f.text, sub: `${f.from === 'me' ? myNick() : nameOf(contact(f.contactId)) || f.name} · ${time.shortLabel(f)}`,
      onClick: async () => { if (await dialog({ title: '取消收藏？', text: f.text, confirm: '取消收藏', danger: true })) { state.favorites.splice(state.favorites.indexOf(f), 1); commit('me'); draw(); } } }))));
  };
  draw(); nav.push(p.el);
}
void icon;
