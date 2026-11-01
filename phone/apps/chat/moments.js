// 动态页：封面 + 动态流；发动态；生成角色动态；点赞 / 评论 / 生成评论；某个人的动态空间。
import { h, uid, onLongPress, fileToDataURL, pickFile, $ } from '../../core/util.js';
import { state, commit, contact, subscribe } from '../../core/store.js';
import { page, group, item, field, textarea, input, segmented, avatar, icon, navBtn, navText, actionSheet, dialog, toast, empty, btn, slider, sheet, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as time from '../../core/time.js';
import { nameOf, who, genMoment, genComments, relinkMoments } from './engine.js';
import { myNick } from '../../core/promptstore.js';
import { openProfile, pickMany, sorted } from './people.js';

const authorAvatar = id => id === 'me' ? state.me.avatar : (contact(id) || {}).avatar;
const authorName = id => id === 'me' ? myNick() : nameOf(contact(id));

export function renderMoments(ctx) {
  const cam = navBtn('camera', '发动态', () => openPost());
  onLongPress(cam, () => moreMenu());
  ctx.setRight(navBtn('sparkle', '生成角色动态', () => openGenerate()), cam);
  const feed = h('div');
  ctx.body.append(cover(), feed);
  function draw() { relinkMoments(); feed.innerHTML = ''; feedInto(feed, state.moments.filter(m => m.author), draw); }   // 还不是好友的人的动态先不显示
  async function moreMenu() {
    const v = await actionSheet('动态', [{ value: 'gen', label: '生成角色动态', icon: 'sparkle' }, { value: 'clear', label: '清空所有动态', icon: 'trash', danger: true }]);
    if (v === 'gen') openGenerate();
    if (v === 'clear' && await dialog({ title: '清空所有动态？', text: '包括你自己发的。', confirm: '清空', danger: true })) { state.moments.splice(0); commit('moments'); }
  }
  draw();
  const unsub = subscribe(what => { if (what === 'moments' || what === 'all') draw(); });
  return unsub;
}
function cover(personId = 'me') {
  const p = personId === 'me' ? null : contact(personId);
  const bg = personId === 'me' ? state.me.cover : p && p.cover;
  const el = h('div.as-chat-moments-cover', { style: bg ? { backgroundImage: `url(${bg})` } : {}, title: personId === 'me' ? '点一下换封面' : '' },
    h('div.as-chat-moments-cover__me', h('div.as-chat-moments-cover__name', authorName(personId)), avatar(authorAvatar(personId), authorName(personId), 68, 'square')));
  if (personId === 'me') el.addEventListener('click', async () => {
    const v = await pickImage('封面', { ratio: el.clientWidth / el.clientHeight, size: 900, has: !!state.me.cover }); if (v == null) return;
    state.me.cover = v; commit('me'); el.style.backgroundImage = v ? `url(${v})` : '';
  });
  return el;
}

/** 把一组动态画进 box */
export function feedInto(box, list, redraw) {
  const visible = list.filter(m => !m.hiddenFromMe);
  if (!visible.length) { box.appendChild(empty('还没有动态。点右上角相机发一条，或者点 ✦ 让角色们发。')); return; }
  visible.forEach(m => box.appendChild(card(m, redraw)));
}
function card(m, redraw) {
  const imgs = (m.images || []).length ? h('div.as-chat-moment__imgs' + (m.images.length === 1 ? '.is-one' : ''), m.images.map(src => h('img', { src, alt: '', loading: 'lazy' }))) : null;
  const desc = m.imageDesc ? h('div.as-chat-imgdesc', icon('image', 16, 1.8), h('span', m.imageDesc)) : null;
  const ops = h('button.as-chat-moment__ops', { 'aria-label': '操作', onclick: e => { e.stopPropagation(); opbar(ops, m, redraw); } }, '··');
  const box = (m.likes.length || m.comments.length) ? h('div.as-chat-moment__box',
    m.likes.length ? h('div.as-chat-moment__likes', icon('heart', 14, 2), h('span', m.likes.map(who).join('，'))) : null,
    m.comments.length ? h('div.as-chat-moment__comments', m.comments.map(cm => h('div.as-chat-moment__comment', { onclick: () => commentOn(m, cm.who === 'me' ? null : cm.who, redraw) },
      h('span.as-chat-moment__who', who(cm.who)), cm.to ? [' 回复 ', h('span.as-chat-moment__who', who(cm.to))] : null, '：', cm.text))) : null) : null;
  return h('article.as-chat-moment', avatar(authorAvatar(m.author), authorName(m.author), 42, 'square'),
    h('div', h('div.as-chat-moment__name', { onclick: () => m.author === 'me' ? null : openProfile(m.author) }, authorName(m.author)),
      m.text && h('div.as-chat-moment__text', m.text), imgs, desc,
      h('div.as-chat-moment__meta', h('span', time.shortLabel(m)), m.location && h('span', '· ' + m.location), m.author === 'me' && m.vis && m.vis !== 'public' ? h('span.as-chat-moment__vis', { title: '不是所有人都能看' }, icon(m.vis === 'private' ? 'lock' : 'users', 12, 2)) : null, h('span.as-spacer'), ops),
      box));
}
function opbar(anchor, m, redraw) {
  document.querySelectorAll('.as-chat-opbar').forEach(x => x.remove());
  const host = anchor.closest('.as-stack__page'), hr = host.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  const liked = m.likes.includes('me');
  const close = () => { bar.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!bar.contains(e.target)) close(); };
  const act = (label, ic, fn) => h('button', { onclick: () => { close(); fn(); } }, icon(ic, 15, 2), label);
  const bar = h('div.as-chat-opbar', { style: { right: (hr.right - r.left + 6) + 'px', top: (r.top - hr.top + r.height / 2 - 19) + 'px' } },
    act(liked ? '取消' : '赞', 'heart', () => { liked ? m.likes.splice(m.likes.indexOf('me'), 1) : m.likes.push('me'); commit('moments'); }),
    act('评论', 'comment', () => commentOn(m, null, redraw)),
    act('生成评论', 'sparkle', async () => { toast('大家正在看…', true); try { const n = await genComments(m); toast(n ? `来了 ${n} 条互动` : '大家都没理'); } catch (e) { toast('生成失败：' + e.message); } }),
    m.author === 'me' ? act('删除', 'trash', async () => { if (await dialog({ title: '删除这条动态？', confirm: '删除', danger: true })) { state.moments.splice(state.moments.indexOf(m), 1); commit('moments'); } }) : null);
  host.appendChild(bar);
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}
async function commentOn(m, to, redraw) {
  const text = await dialog({ title: to ? `回复 ${who(to)}` : '评论', input: { placeholder: '说点什么…' }, confirm: '发送' });
  if (!text || !text.trim()) return;
  m.comments.push({ id: uid('cm'), who: 'me', to: to || null, text: text.trim(), at: Date.now() });
  commit('moments'); toast('想让大家回应，点「··」→ 生成评论');
}

/* ---------- 发动态 ---------- */
function openPost() {
  const d = { text: '', images: [], location: '', vis: 'public', visIds: [], visGroup: '' };
  const photos = h('div.as-chat-photos');
  const drawPhotos = () => {
    photos.innerHTML = '';
    d.images.forEach((src, i) => photos.appendChild(h('div', { style: { backgroundImage: `url(${src})` } }, h('span.as-x', { role: 'button', onclick: () => { d.images.splice(i, 1); drawPhotos(); } }, icon('close', 12, 2.4)))));
    if (d.images.length < 9) photos.appendChild(h('button', { 'aria-label': '加照片', onclick: async () => { const f = await pickFile(); if (f) { d.images.push(await fileToDataURL(f, 900)); drawPhotos(); } } }, icon('plus', 26, 1.6)));
  };
  drawPhotos();
  const VIS = { public: '公开', private: '仅自己', include: '部分可见', exclude: '不给谁看', group: '分组可见' };
  const visItem = item({ title: '谁可以看', value: '公开', chevron: true, onClick: async () => {
    const v = await actionSheet('谁可以看', Object.entries(VIS).map(([k, l]) => ({ value: k, label: l, active: d.vis === k })));
    if (!v) return;
    if (v === 'include' || v === 'exclude') {
      const ids = await pickMany(v === 'include' ? '只给谁看' : '不给谁看', sorted().map(c => ({ key: c.id, name: nameOf(c), avatar: c.avatar })), { preselect: d.visIds });
      if (!ids || !ids.length) return; d.visIds = ids;
    }
    if (v === 'group') {
      if (!state.groups.length) { toast('先在「联系人 → 分组」建个分组'); return; }
      const g = await actionSheet('给哪个分组看', state.groups.map(x => ({ value: x, label: x }))); if (!g) return; d.visGroup = g;
    }
    d.vis = v;
    visItem.querySelector('.as-list-item__value').textContent = VIS[v] + (v === 'include' || v === 'exclude' ? `（${d.visIds.length} 人）` : v === 'group' ? `（${d.visGroup}）` : '');
  } });
  const p = page({ app: 'chat', id: 'chat-moments-post', title: '发动态', back: true, right: navText('发表', () => {
    if (!d.text.trim() && !d.images.length) { toast('写点什么或者配张图'); return; }
    state.moments.unshift({ id: uid('mo'), author: 'me', text: d.text.trim(), images: d.images, imageDesc: '', location: d.location.trim(), vis: d.vis, visIds: d.visIds, visGroup: d.visGroup, ...time.stamp(), likes: [], comments: [] });
    commit('moments'); nav.pop(); toast('已发表');
  }, true) });
  p.body.append(
    group('', [h('div.as-field', textarea({ placeholder: '这一刻的想法…', rows: 5, onInput: v => { d.text = v; } })), photos]),
    group('', [field('所在位置', input({ placeholder: '不填就不显示', onInput: v => { d.location = v; } })),
      visItem]));
  nav.push(p.el);
}

/* ---------- 生成角色动态 ---------- */
function openGenerate() {
  if (!state.contacts.length) { toast('先添加几个联系人'); return; }
  let mode = 'random', count = 1, picked = [];
  const who2 = h('div.as-muted', { style: { padding: '0 4px' } });
  const pickBtn = btn('选择角色', 'secondary', async () => {
    const sel = await pickMany('谁来发', sorted().map(c => ({ key: c.id, name: nameOf(c), avatar: c.avatar })), { preselect: picked });
    if (sel) { picked = sel; who2.textContent = sel.map(id => nameOf(contact(id))).join('、') || '还没选'; }
  });
  pickBtn.hidden = true;
  const cnt = h('output', '1');
  const go = btn('开始生成', 'primary', async () => {
    const pool = mode === 'random' ? [...state.contacts].sort(() => Math.random() - .5) : picked.map(contact).filter(Boolean);
    if (!pool.length) { toast('先选角色'); return; }
    s.close();
    let ok = 0;
    for (let i = 0; i < count; i++) {
      const c = pool[i % pool.length];
      toast(`${nameOf(c)} 正在发动态…（${i + 1}/${count}）`);
      try { await genMoment(c); ok++; } catch (e) { toast('生成失败：' + e.message); break; }
    }
    if (ok) toast(`新增 ${ok} 条动态`);
  });
  const s = sheet({ title: '生成角色动态', content: h('div.as-stack-gap',
    segmented([['random', '随机角色'], ['pick', '指定角色']], mode, v => { mode = v; pickBtn.hidden = v !== 'pick'; who2.hidden = v !== 'pick'; }),
    pickBtn, who2,
    h('div.as-settings-slider-row', { style: { padding: '4px' } }, h('span', '数量'), slider({ min: 1, max: 5, step: 1, value: 1, onInput: v => { count = v; cnt.textContent = v; } }), cnt),
    h('div.as-muted', { style: { padding: '0 4px' } }, '用我发的照片、转载聊天记录：下一轮做'), go) });
  who2.hidden = true;
}

/* ---------- 某个人的动态空间 ---------- */
export function openUserMoments(cid) {
  const c = contact(cid); if (!c) return;
  const p = page({ app: 'chat', id: 'chat-moments-user', title: nameOf(c), back: true, cls: 'as-chat-moments' });
  const feed = h('div');
  const draw = () => { relinkMoments(); feed.innerHTML = ''; feedInto(feed, state.moments.filter(m => m.author === cid), draw); };
  p.body.append(cover(cid), c.sign ? h('p.as-muted', { style: { padding: '0 16px 10px', textAlign: 'right' } }, c.sign) : null, feed);
  draw(); p.el._onShow = draw;
  nav.push(p.el);
}
void $;
