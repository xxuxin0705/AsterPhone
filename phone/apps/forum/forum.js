// 论坛：首页（关注 / 本地 / 全球 / 匿名区）、消息、我。点帖子进帖子页，点头像、名字进主页。
// 列表只在第一次显示时画一遍，之后新刷出来的帖子插到最上面；点赞、翻译只改那一个元素
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, navBtn, icon, avatar, empty, toast, waiting, aiCount, group, item, field, toggleItem, segmented, actionSheet, dialog, btn, sheet, input, textarea, pickImage } from '../../core/ui.js';
import { generateImage, resolveConn } from '../../core/api.js';
import { myName } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import * as nav from '../../core/nav.js';
import { applyTexts } from '../../core/skin.js';
import { LANGS, langName } from '../../core/translate.js';
import * as time from '../../core/time.js';
import * as E from './engine.js';

const TABS = [['home', '首页', 'comment'], ['inbox', '消息', 'bell'], ['me', '我', 'user']];
const phone = () => document.querySelector('#phone');

/* ---------- 要等的事：同一件事同时只跑一个。按钮转圈带字数，再点就取消；退出再进来还是转圈 ---------- */
const jobs = {}, jbs = new Set();
function jobBtn(key, idle, start, tag = 'button.as-navbar__btn.as-fo-job') {
  const b = h(tag, { onclick: e => { e.stopPropagation(); if (jobs[key]) jobs[key].abort(); else start(); } });
  b.dataset.job = key; b._idle = idle; jbs.add(b); paintJob(b);
  return b;
}
function paintJob(b) { const on = !!jobs[b.dataset.job]; b.classList.toggle('is-busy', on); b.replaceChildren(...(on ? [h('span.as-spin'), aiCount()] : b._idle())); }
function go(key, msg, fn) {
  const ac = jobs[key] = new AbortController(), repaint = () => { for (const b of jbs) if (b.dataset.job === key) { if (b.isConnected) paintJob(b); else jbs.delete(b); } };
  repaint();
  return waiting(msg, fn, ac).catch(e => { toast(e.message); }).finally(() => { delete jobs[key]; repaint(); });
}

/* ---------- 零件 ---------- */
const vMark = () => h('span.as-fo-post__v', { 'aria-label': '认证' }, icon('check', 9, 3.4));
function ava(by, size) {
  if (by.anon) return h('span.as-avatar.as-fo-anon', { style: { width: size + 'px', height: size + 'px' } }, icon('user', Math.round(size * .5), 1.8));
  const w = E.who(by); return avatar(w.avatar, w.name, size);
}
/** 正文 + 翻译：上下对照时翻译常显示；「点了才显示」时显示按钮，点一下这一条在原文 / 中文之间换（只改这一条的字） */
function tx(o, cls) {
  const t = h('div.' + cls, o.text);
  if (!o.tr) return [t];
  let zh = false;
  return [t, h('div.as-fo-post__tr', o.tr), h('button.as-fo-trbtn', { onclick: function (e) { e.stopPropagation(); zh = !zh; t.textContent = zh ? o.tr : o.text; this.textContent = zh ? '查看原文' : '查看翻译'; } }, '查看翻译')];
}
function likeBtn(o) {
  const n = h('span.as-fo-act__n', E.fmt(o.likes));
  const b = h('button.as-fo-act.as-fo-like' + (o.liked ? '.is-on' : ''), { 'aria-label': '赞', onclick: e => {
    e.stopPropagation(); o.liked = !o.liked; o.likes = Math.max(0, (o.likes || 0) + (o.liked ? 1 : -1));
    b.classList.toggle('is-on', o.liked); n.textContent = E.fmt(o.likes); E.save();
  } }, icon('heart', 16, 1.8), n, h('span.as-fo-act__w', { dataset: { asText: 'forum.act.like' } }, E.defWord('forum.act.like')));
  return b;
}
const act = (k, ic, n, onclick) => h('button.as-fo-act', { onclick }, icon(ic, 16, 1.8), h('span.as-fo-act__n', E.fmt(n)), h('span.as-fo-act__w', { dataset: { asText: k } }, E.defWord(k)));
function card(p, full) {
  const w = E.who(p.by), toUser = e => { if (p.by.anon) return; e.stopPropagation(); openUser(p.by); };
  return h('article.as-fo-post' + (full ? '.is-full' : ''), { dataset: { id: p.id, board: p.board }, onclick: full ? null : () => openPost(p) },
    h('span.as-fo-post__ava', { onclick: toUser }, ava(p.by, 42)),
    h('div.as-fo-post__head', h('span.as-fo-post__name', { onclick: toUser }, w.name), w.v ? vMark() : null, h('span.as-fo-post__time', time.ago(p.at))),
    p.title ? h('div.as-fo-post__title', p.title) : null,
    ...tx(p, 'as-fo-post__text'),
    picEl(p),
    h('div.as-fo-post__acts', act('forum.act.repost', 'send', p.reposts), act('forum.act.comment', 'comment', p.cmts, full ? null : e => { e.stopPropagation(); openPost(p); }), likeBtn(p)));
}

/* ---------- 配图：有图就整张显示（不裁）；只有描述时是一张卡片，点了生图（再点取消） ---------- */
function picEl(p) {
  if (p.pic) return h('img.as-fo-post__pic', { src: p.pic, alt: p.img || '配图', onclick: e => e.stopPropagation() });
  if (!p.img) return null;
  return jobBtn('pic:' + p.id, () => [icon('image', 16, 1.8), h('span', p.img)], () => {
    const conn = resolveConn('image', 'forum'); if (!conn) { toast('还没配生图接口'); return; }
    go('pic:' + p.id, '正在生图…', s => generateImage(p.img, '论坛', conn, s)).then(async u => {
      if (!u) return;
      p.pic = u; await E.save();
      document.querySelectorAll(`[data-job="pic:${p.id}"]`).forEach(x => x.replaceWith(picEl(p)));
    });
  }, 'button.as-fo-post__img');
}

/* ---------- 我的号：一个小按钮显示现在用哪个号，点了换 ---------- */
function accChip() {
  const paint = b => { const a = E.curAcc(); b.replaceChildren(avatar(E.who({ k: 'me', id: a.id }).avatar, E.accName(a), 22), h('span', E.accName(a))); };
  const b = h('button.as-fo-acc', { 'aria-label': '换号', onclick: async e => {
    e.stopPropagation();
    const v = await actionSheet('用哪个号', E.F().accounts.map(a => ({ value: a.id, label: E.accName(a), active: a.id === E.F().cur }))); if (!v) return;
    E.F().cur = v; commit('forum'); document.querySelectorAll('.as-fo-acc').forEach(paint);
  } });
  paint(b); return b;
}
/** 发帖：选版块、标题（可以不写）、正文、配图；发出去马上显示，再找 AI 出别人的回复 */
function compose(b0) {
  let board = b0 === 'follow' ? 'local' : b0, pic = '';
  const title = input({ placeholder: '标题' }), body = textarea({ placeholder: '正文', rows: 5 });
  const pv = h('img.as-fo-compose__pic', { hidden: true, alt: '配图', onclick: () => { pic = ''; pv.hidden = true; } });
  const s = sheet({ title: E.word('forum.post.new'), content: h('div.as-fo-compose',
    segmented([['local', E.word('forum.tab.local')], ['global', E.word('forum.tab.global')], ['anon', E.word('forum.tab.anon')]], board, v => { board = v; }),
    title, body, pv,
    h('div.as-fo-compose__row', accChip(), btn('配图', 'secondary', async () => { const f = await pickFile('image/*'); if (!f) return; pic = await fileToDataURL(f, 1080); pv.src = pic; pv.hidden = false; })),
    h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('发布', 'primary', async () => {
      const text = body.value.trim(); if (!text) { toast('写点什么'); return; }
      s.close();
      const p = await E.post({ board, title: title.value.trim(), text, pic });
      if (V && V.el.isConnected) showBoard(board);
      landed([p]); runThread(p, { count: '4～8' });
    }))) });
}

/* ---------- 首页 ---------- */
let V = null;   // 开着的首页：{ el, lists, board, right }
const listOf = (d, b) => d.posts.filter(p => b === 'follow' ? (state.forum.follows || []).some(k => k === (p.by.k === 'bot' ? 'b:' : 'c:') + p.by.id) && !p.by.anon : p.board === b);
const refresher = b => b !== 'follow' && jobBtn('feed:' + b, () => [icon('repeat', 20, 1.9)], () => refresh(b));
function refresh(b) {
  return go('feed:' + b, '正在刷新…', s => E.feed(b, {}, s)).then(got => { if (got) { landed(got); toast(`刷到 ${got.length} 条`); } });
}
/** 新帖子到了：插到开着的列表、主页最上面，热榜换掉，空状态去掉 */
function landed(got) {
  if (V && V.el.isConnected) {
    for (const [b, l] of Object.entries(V.lists)) {
      if (!l._drawn) continue;
      const mine = got.filter(p => b !== 'follow' && p.board === b);
      if (!mine.length) continue;
      l.querySelector('.as-empty')?.remove();
      l.querySelector('.as-fo-hot') ? l.querySelector('.as-fo-hot').after(...mine.map(p => card(p))) : l.prepend(...mine.map(p => card(p)));
    }
    V.lists.global.querySelector('.as-fo-hot')?.replaceWith(hotStrip());
  }
  for (const u of uviews) if (u.el.isConnected) u.add(got.filter(p => same(p.by, u.by)));
  applyTexts();
}
function hotStrip() {
  const hot = state.forum.hot || [];
  return h('div.as-fo-hot', { hidden: !hot.length }, h('div.as-fo-hot__t', { dataset: { asText: 'forum.hot' } }, E.defWord('forum.hot')),
    h('div.as-fo-hot__list', hot.map((x, i) => h('button.as-fo-hot__item', { onclick: () => go('feed:global', '正在刷新…', s => E.feed('global', { pick: `都围绕这个话题：${x.topic}` }, s)).then(got => { if (got) { landed(got); toast(`刷到 ${got.length} 条`); } }) },
      h('b', i + 1), h('span', x.topic), h('small', E.fmt(x.heat))))));
}
async function drawList(b) {
  const l = V.lists[b]; if (l._drawn) return; l._drawn = true;
  const d = await E.load(), posts = listOf(d, b);
  l.replaceChildren(b === 'global' ? hotStrip() : null, ...posts.map(p => card(p)),
    posts.length ? null : empty(b === 'follow' ? '还没有关注的人' : '还没有帖子', b === 'follow' ? null : btn('刷新', 'secondary', () => refresh(b))));
  applyTexts();
}
function showBoard(b) {
  V.board = b;
  V.tabs.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x.dataset.b === b));
  for (const [k, l] of Object.entries(V.lists)) l.hidden = k !== b;
  V.right.querySelectorAll('[data-job^="feed:"]').forEach(x => { x.hidden = x.dataset.job !== 'feed:' + b; });
  drawList(b);
}
function mePane() {
  const F = E.F(), A = E.A();
  const where = () => F.region ? `${F.region} · ${langName(F.lang || 'zh-CN')}` : '按正文定';
  const region = item({ title: '地区', value: where(), chevron: true, onClick: async () => {
    const n = await dialog({ title: '地区', input: { value: F.region, placeholder: '地名' } }); if (n == null) return;
    const l = n.trim() ? await actionSheet('那里说什么语言', LANGS.map(([v, t]) => ({ value: v, label: t, active: v === F.lang }))) : '';
    if (l == null) return;
    F.region = n.trim().slice(0, 20); F.lang = l; commit('forum');
    region.querySelector('.as-list-item__value').textContent = where();
  } });
  const accs = h('div');
  const drawAccs = () => accs.replaceChildren(group('我的号', [...F.accounts.map(a => item({ title: E.accName(a) + (a.id === 'main' ? '（大号）' : ''), right: a.id === F.cur ? icon('check', 18, 2.2) : null,
    onClick: async () => {
      const v = await actionSheet(E.accName(a), [{ value: 'use', label: '用这个号', icon: 'check' }, { value: 'edit', label: '编辑', icon: 'edit' }, a.id !== 'main' && { value: 'del', label: '删除', icon: 'trash', danger: true }].filter(Boolean));
      if (v === 'use') { F.cur = a.id; commit('forum'); drawAccs(); document.querySelectorAll('.as-fo-acc').forEach(b => b.replaceWith(accChip())); }
      if (v === 'edit') editAcc(a, drawAccs);
      if (v === 'del' && await dialog({ title: `删除「${E.accName(a)}」？`, confirm: '删除', danger: true })) { F.accounts.splice(F.accounts.indexOf(a), 1); if (F.cur === a.id) F.cur = 'main'; commit('forum'); drawAccs(); }
    } })), item({ icon: 'plus', title: '新建小号', onClick: () => editAcc(null, drawAccs) })]));
  drawAccs();
  return h('div.as-fo-me', accs,
    group('', [region, item({ title: '营销号', value: String(F.bots.length), chevron: true, onClick: openBots }), item({ title: '熟人', chevron: true, onClick: openPeople })]),
    group('显示', [field('外语', segmented([['both', '上下对照'], ['tap', '点了才显示']], A.tr, v => { A.tr = v; commit('apps'); phone().dataset.forumTr = v; }))]),
    group('刷新', [field('一次刷几条', segmented([4, 6, 8, 10].map(n => [n, String(n)]), A.count || 6, v => { A.count = v; commit('apps'); })),
      toggleItem({ title: '点开帖子就出评论' }, A.autoOpen !== false, v => { A.autoOpen = v; commit('apps'); })]));
}
export function open() {
  phone().dataset.forumTr = E.A().tr || 'both';
  const p = page({ app: 'forum', id: 'forum-home', title: '论坛', large: true, back: true, cls: 'as-fo-root' });
  const right = p.nav.querySelector('.as-navbar__right');
  const tabs = h('div.as-fo-tabs', E.BOARDS.map(b => h('button', { dataset: { b, asText: 'forum.tab.' + b }, onclick: () => showBoard(b) }, E.defWord('forum.tab.' + b))));
  const lists = Object.fromEntries(E.BOARDS.map(b => [b, h('div.as-fo-list')]));
  const panes = { home: h('div.as-fo-pane', tabs, ...Object.values(lists)), inbox: h('div.as-fo-pane', { hidden: true }, empty('还没有消息')), me: h('div.as-fo-pane', { hidden: true }) };
  E.BOARDS.forEach(b => { const r = refresher(b); if (r) { r.setAttribute('aria-label', '刷新'); right.append(r); } });
  right.append(navBtn('edit', '发帖', () => compose(V.board)));
  const bar = h('nav.as-chat-tabbar.as-fo-bar', { role: 'tablist' }, TABS.map(([id, label, ic]) => h('button.as-chat-tab' + (id === 'home' ? '.is-active' : ''), { role: 'tab', dataset: { tab: id }, onclick: () => {
    bar.querySelectorAll('button').forEach(x => x.classList.toggle('is-active', x.dataset.tab === id));
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== id;
    if (id === 'me' && !panes.me.firstChild) panes.me.append(mePane());
    right.hidden = id !== 'home'; p.setTitle(id === 'home' ? '论坛' : label); p.body.scrollTop = 0;
  } }, icon(ic, 23, 1.7), h('span', label))));
  p.body.append(...Object.values(panes)); p.el.append(bar);
  V = { el: p.el, lists, tabs, right, board: 'local' };
  showBoard('local');
  applyTexts();
  return p.el;
}

/* ---------- 帖子 ---------- */
const views = new Map();   // 帖子 id → 开着的帖子页（出完评论填进去）
function floorEl(p, f, i) {
  const w = f.by.op ? E.who(p.by) : E.who(f.by), up = f.to && f.to !== 'op' && p.floors.find(x => x.id === f.to);
  const to = f.to === 'op' ? '楼主' : up ? E.floorWho(p, up) : '';
  return h('div.as-fo-floor' + (up ? '.is-sub' : ''), h('span.as-fo-floor__ava', { onclick: () => !f.by.op && !f.by.anon && openUser(f.by) }, ava(f.by.op ? p.by : f.by, 32)),
    h('div.as-fo-floor__main',
      h('div.as-fo-floor__who', h('span.as-fo-floor__name', w.name), w.v ? vMark() : null, f.by.op ? h('span.as-fo-floor__op', '楼主') : null, to ? h('span.as-fo-floor__to', '回复 ' + to) : null),
      ...tx(f, 'as-fo-floor__text'),
      h('div.as-fo-floor__meta', h('span', `${i + 1} 楼 · ${time.ago(f.at)}`), likeBtn(f))));
}
const runThread = (p, opts) => jobs['thread:' + p.id] ? null : go('thread:' + p.id, '正在出评论…', s => E.thread(p, s, opts)).then(add => {
  if (!add) return;
  const v = views.get(p.id); if (v && v.el.isConnected) v.add(add);
  document.querySelectorAll(`.as-fo-post[data-id="${p.id}"] .as-fo-act:nth-child(2) .as-fo-act__n`).forEach(n => { n.textContent = E.fmt(p.cmts); });
  toast(`新增 ${add.length} 条${E.word('forum.act.comment')}`);
});
function openPost(p) {
  const pg = page({ app: 'forum', id: 'forum-post', title: E.word('forum.act.comment'), back: true });
  const floors = h('div.as-fo-floors', (p.floors || []).map((f, i) => floorEl(p, f, i)));
  const more = jobBtn('thread:' + p.id, () => [(p.floors || []).length ? '再来一些' : '看' + E.word('forum.act.comment')], () => runThread(p), 'button.as-btn.as-btn--secondary.as-fo-morebtn');
  // 底下输入栏：点一层就是回那一层，点上面的帖子就是回楼主
  let to = '';
  const inp = input({ placeholder: '说点什么' });
  const aim = (id, name) => { to = id; inp.placeholder = name ? '回复 ' + name : '说点什么'; if (id) inp.focus(); };
  const send = async () => {
    const text = inp.value.trim(); if (!text) return;
    inp.value = ''; const t = to; aim('', '');
    const f = await E.reply(p, text, t);
    floors.append(floorEl(p, f, p.floors.length - 1));
    const tn = t === 'op' ? '楼主' : t ? E.floorWho(p, p.floors.find(x => x.id === t)) : '';
    runThread(p, { focus: `${myName()}（${E.who(f.by).name}）刚在 ${p.floors.length} 楼${tn ? '回复了' + tn : '说'}：「${text}」。${tn ? '被回复的人要回 TA，' : ''}别人想回就回。`, count: '2～5' });
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) send(); });
  floors.addEventListener('click', e => { const el = e.target.closest('.as-fo-floor'); if (!el || e.target.closest('button, .as-fo-floor__ava')) return; const f = p.floors[[...floors.children].indexOf(el)]; if (f) aim(f.id, E.floorWho(p, f)); });
  const top = card(p, true); top.addEventListener('click', e => { if (!e.target.closest('button, img, .as-fo-post__ava, .as-fo-post__name')) aim('op', '楼主'); });
  pg.body.append(top, floors, more);
  pg.el.append(h('div.as-fo-input', accChip(), inp, h('button.as-fo-send', { 'aria-label': '发送', onclick: send }, icon('send', 20, 1.9))));
  views.set(p.id, { el: pg.el, add: list => { const n = p.floors.length - list.length; floors.append(...list.map((f, i) => floorEl(p, f, n + i))); } });
  nav.push(pg.el); applyTexts();
  if (!(p.floors || []).length && E.A().autoOpen !== false && !jobs['thread:' + p.id]) runThread(p);
}

/* ---------- 主页 ---------- */
const uviews = new Set();
const same = (a, b) => !a.anon && a.k === b.k && (a.id ? a.id === b.id : a.name === b.name);
function openUser(by) {
  const w = E.who(by), key = 'more:' + (by.id || by.name), b = by.k === 'bot' && E.botOf(by.id);
  const pg = page({ app: 'forum', id: 'forum-user', title: w.name, back: true });
  const list = h('div.as-fo-list');
  const more = jobBtn(key, () => ['看看 TA 还发了什么'], () => go(key, '正在刷新…', s => E.feed(b ? 'global' : 'local', {
    count: 3, only: by.k === 'bot' ? ['b:' + by.id] : by.k === 'c' ? ['c:' + by.id] : [], pick: `只由「${w.name}」发，${by.k === 'n' ? '这是一个普通网友，' : ''}写 TA 最近会发的` }, s)).then(got => { if (got) { landed(got); toast('刷到了'); } }),
  'button.as-btn.as-btn--secondary.as-fo-morebtn');
  const sub = b && btn('投稿', 'primary', () => {
    const t = textarea({ placeholder: '投稿内容', rows: 5 });
    const s = sheet({ title: '投稿给「' + b.name + '」', content: h('div.as-fo-compose', t, h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('投稿', 'primary', async () => {
      const text = t.value.trim(); if (!text) { toast('写点什么'); return; }
      s.close(); const p = await E.submit(b, text); landed([p]);
      runThread(p, { focus: `这条是 ${myName()} 匿名投的稿，营销号替 TA 发出来；网友不知道是谁投的。`, count: '6～10' });
      openPost(p);
    }))) });
  });
  pg.body.append(h('div.as-fo-user', ava(by, 72), h('div.as-fo-user__name', w.name, w.v ? vMark() : null),
    b ? h('div.as-fo-user__bio', `${b.topic} · ${E.fmt(b.fans)} 粉丝`) : null, b && b.bio ? h('div.as-fo-user__bio', b.bio) : null),
    by.k === 'me' ? null : h('div.as-fo-user__acts', sub, more), list);
  E.load().then(d => { list.append(...d.posts.filter(p => same(p.by, by)).map(p => card(p))); applyTexts(); });
  const u = { el: pg.el, by, add: ps => { list.prepend(...ps.map(p => card(p))); } }; uviews.add(u);
  for (const x of uviews) if (!x.el.isConnected && x !== u) uviews.delete(x);
  nav.push(pg.el); applyTexts();
}

/* ---------- 编辑：我的号、营销号、熟人（底下固定「取消 | 保存」） ---------- */
function editSheet(title, rows, save, extra) {
  const s = sheet({ title, content: h('div.as-fo-compose', ...rows, extra, h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => { if (save() !== false) s.close(); }))) });
  return s;
}
function avaPick(get, set, name) {
  const b = h('button.as-fo-avapick', { 'aria-label': '换头像', onclick: async () => { const u = await pickImage('头像', { ratio: 1, size: 320, has: !!get() }); if (u == null) return; set(u); b.replaceChildren(avatar(u, name, 64)); } }, avatar(get(), name, 64));
  return b;
}
function editAcc(a, done) {
  const d = a ? { ...a } : { id: 'a' + Date.now().toString(36), name: '', bio: '', avatar: '' };
  const name = input({ value: d.name, placeholder: '网名' }), bio = input({ value: d.bio, placeholder: '简介' });
  editSheet(a ? '编辑' : '新建小号', [avaPick(() => d.avatar, u => { d.avatar = u; }, d.name || '号'), field('网名', name), field('简介', bio)], () => {
    d.name = name.value.trim().slice(0, 20); d.bio = bio.value.trim().slice(0, 60);
    if (!a && !d.name) { toast('起个网名'); return false; }
    if (a) Object.assign(a, d); else E.F().accounts.push(d);
    commit('forum'); done(); document.querySelectorAll('.as-fo-acc').forEach(b => b.replaceWith(accChip()));
  });
}
function openBots() {
  const pg = page({ app: 'forum', id: 'forum-bots', title: '营销号', back: true });
  const list = h('div');
  const draw = () => list.replaceChildren(group('', [...E.F().bots.map(b => item({ icon: avatar(b.avatar, b.name, 28), color: 'transparent', title: b.name, sub: b.topic, chevron: true, onClick: () => editBot(b, draw) })),
    item({ icon: 'plus', title: '新建营销号', onClick: () => editBot(null, draw) })]));
  draw(); pg.body.append(h('div.as-fo-me', list)); nav.push(pg.el);
}
function editBot(b, done) {
  const d = b ? { ...b } : { id: 'fb' + Date.now().toString(36), name: '', topic: '', bio: '', avatar: '', fans: 1000 + Math.floor(Math.random() * 300000) };
  const name = input({ value: d.name, placeholder: '名字' }), topic = input({ value: d.topic, placeholder: '主题' }), bio = input({ value: d.bio, placeholder: '简介' });
  const s = editSheet(b ? '编辑营销号' : '新建营销号', [avaPick(() => d.avatar, u => { d.avatar = u; }, d.name || '号'), field('名字', name), field('主题', topic), field('简介', bio)], () => {
    d.name = name.value.trim().slice(0, 20); d.topic = topic.value.trim().slice(0, 12); d.bio = bio.value.trim().slice(0, 40);
    if (!d.name) { toast('起个名字'); return false; }
    if (b) Object.assign(b, d); else E.F().bots.push(d);
    commit('forum'); done();
  }, b && item({ title: '删除', danger: true, onClick: async () => {
    if (!(await dialog({ title: `删除「${b.name}」？`, text: '它发过的帖子还在。', confirm: '删除', danger: true }))) return;
    E.F().bots.splice(E.F().bots.indexOf(b), 1); commit('forum'); s.close(); done();
  } }));
}
function openPeople() {
  const pg = page({ app: 'forum', id: 'forum-people', title: '熟人', back: true });
  const F = E.F(), P = id => (F.people[id] = F.people[id] || {});
  const label = c => P(c.id).off ? '不上论坛' : P(c.id).v ? '有认证' : '';
  pg.body.append(h('div.as-fo-me', state.contacts.length ? group('', state.contacts.map(c => {
    const row = item({ icon: avatar(c.avatar, nameOf(c), 28), color: 'transparent', title: nameOf(c), value: label(c), chevron: true, onClick: () => {
      const d = { ...P(c.id) }, nick = input({ value: d.name || '', placeholder: '网名' });
      editSheet(nameOf(c), [toggleItem({ title: '上论坛' }, !d.off, v => { d.off = !v; }), toggleItem({ title: '有认证' }, !!d.v, v => { d.v = v; }), field('网名', nick)], () => {
        d.name = nick.value.trim().slice(0, 20); Object.assign(P(c.id), d); commit('forum'); row.querySelector('.as-list-item__value').textContent = label(c);
      });
    } });
    return row;
  })) : empty('还没有联系人')));
  nav.push(pg.el);
}
