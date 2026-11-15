// 论坛的页面：全是积木。底部几个标签、首页几个信息流、发现 / 小组页放哪些积木，都由正在用的样子（looks.js）决定；
// 每条帖子、每层楼把零件全备齐（头像、V、名字、来自、小组、+关注、标题、正文、话题、配图、热门回复、回应数、转评赞…），显示哪些、怎么排交给样子的 CSS。
// 列表只在第一次显示时画一遍，之后新帖子插到最上面；点赞、关注、翻译只改那一个元素
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, navBtn, icon, avatar, empty, toast, waiting, aiCount, group, item, field, toggleItem, segmented, actionSheet, dialog, btn, sheet, input, textarea, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { applyTexts } from '../../core/skin.js';
import { addFrame, pickDeco } from '../../core/deco.js';
import { LANGS, langName } from '../../core/translate.js';
import { generateImage, resolveConn } from '../../core/api.js';
import { myName } from '../../core/promptstore.js';
import * as time from '../../core/time.js';
import { nameOf } from '../chat/engine.js';
import { look, word, defWord, applyLook } from './looks.js';
import * as E from './engine.js';

const phone = () => document.querySelector('#phone');
const W = (k, tag = 'span') => h(tag, { dataset: { asText: k } }, defWord(k));   // 跟着样子、皮肤换字的一小段
const keyOf = by => by.k === 'me' ? 'me:' + by.id : by.k === 'n' ? 'n:' + by.name : (by.k === 'bot' ? 'b:' : 'c:') + by.id;
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

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

/* ---------- 新帖子到了：插到所有开着、对得上的列表最上面；热榜重画 ---------- */
const lists = new Set();   // { el, match(p) }
function liveList(match, posts) {
  const el = h('div.as-fo-list', posts.map(p => card(p)));
  lists.add({ el, match });
  if (!posts.length) el.append(empty('还没有帖子'));
  return el;
}
const hots = new Set();
function landed(got) {
  for (const l of lists) {
    if (!l.el.isConnected) { lists.delete(l); continue; }
    const mine = got.filter(l.match); if (!mine.length) continue;
    l.el.querySelector(':scope > .as-empty')?.remove(); l.el.prepend(...mine.map(p => card(p)));
  }
  for (const f of hots) if (f.el.isConnected) f.draw(); else hots.delete(f);
  applyTexts();
}
const feedTo = (b, opts = {}) => go('feed:' + b, '正在刷新…', s => E.feed(b, opts, s)).then(got => { if (got) { landed(got); toast(`刷到 ${got.length} 条`); } return got; });

/* ---------- 零件 ---------- */
const vMark = () => h('span.as-fo-post__v', { 'aria-label': '认证' }, icon('check', 9, 3.4));
function ava(by, size, framed) {
  if (by.anon) return h('span.as-avatar.as-fo-anon', { style: { width: size + 'px', height: size + 'px' } }, icon('user', Math.round(size * .5), 1.8));
  const w = E.who(by), a = avatar(w.avatar, w.name, size);
  return framed ? addFrame(a, E.decoOf(keyOf(by)).frame) : a;
}
/** 正文里的 #话题# 标成蓝色，点了搜这个话题 */
function rich(text) {
  return String(text).split(/(#[^#\n]{1,30}#)/).map(s => /^#.+#$/.test(s) ? h('span.as-fo-topic', { onclick: e => { e.stopPropagation(); openSearch(s.slice(1, -1)); } }, s) : s);
}
/** 正文 + 翻译：上下对照时翻译常显示；「点了才显示」时显示按钮，点一下这一条在原文 / 中文之间换 */
function tx(o, cls) {
  const t = h('div.' + cls, rich(o.text));
  if (!o.tr) return [t];
  let zh = false;
  return [t, h('div.as-fo-post__tr', o.tr), h('button.as-fo-trbtn', { onclick: function (e) { e.stopPropagation(); zh = !zh; t.replaceChildren(...rich(zh ? o.tr : o.text)); this.textContent = zh ? '查看原文' : '查看翻译'; } }, '查看翻译')];
}
function likeBtn(o) {
  const n = h('span.as-fo-act__n', E.fmt(o.likes));
  const b = h('button.as-fo-act.is-like' + (o.liked ? '.is-on' : ''), { 'aria-label': '赞', onclick: e => {
    e.stopPropagation(); o.liked = !o.liked; o.likes = Math.max(0, (o.likes || 0) + (o.liked ? 1 : -1));
    b.classList.toggle('is-on', o.liked); n.textContent = E.fmt(o.likes); E.save();
  } }, icon('heart', 16, 1.8), n, W('forum.act.like', 'span.as-fo-act__w'));
  return b;
}
const act = (k, ic, n, onclick) => h('button.as-fo-act.is-' + k.split('.').pop(), { onclick }, icon(ic, 16, 1.8), h('span.as-fo-act__n', E.fmt(n)), W(k, 'span.as-fo-act__w'));
/** +关注：点了只换这个人身上所有关注按钮的字 */
function followBtn(by) {
  if (by.anon || by.k === 'me') return null;
  const k = keyOf(by), on = () => (state.forum.follows || []).includes(k);
  const paint = b => { b.classList.toggle('is-on', on()); b.replaceChildren(W(on() ? 'forum.followed' : 'forum.follow')); };
  const b = h('button.as-fo-follow', { dataset: { key: k }, onclick: e => {
    e.stopPropagation(); const f = state.forum.follows; if (on()) f.splice(f.indexOf(k), 1); else f.push(k); commit('forum');
    document.querySelectorAll(`.as-fo-follow[data-key="${CSS.escape(k)}"]`).forEach(paint); applyTexts();
  } });
  paint(b); return b;
}
function card(p, full) {
  const w = E.who(p.by), g = E.groupOf(p.board), toUser = e => { if (p.by.anon) return; e.stopPropagation(); openUser(p.by); };
  const top = !full && (p.floors || []).filter(f => f.by.k !== 'me').sort((a, b) => b.likes - a.likes)[0];
  return h('article.as-fo-post' + (full ? '.is-full' : '') + (p.title ? '.has-title' : '') + (p.pic || p.img ? '.has-media' : ''), { dataset: { id: p.id, board: p.board }, onclick: full ? null : () => openPost(p) },
    g ? h('div.as-fo-post__group', { onclick: e => { e.stopPropagation(); openBoard(g.id); } }, h('span.as-fo-post__gicon', g.name.slice(0, 1)), h('span.as-fo-post__gname', g.name)) : null,
    h('span.as-fo-post__ava', { onclick: toUser }, ava(p.by, 42, true), w.v ? h('i.as-fo-post__badge') : null),
    h('div.as-fo-post__head', h('span.as-fo-post__name', { onclick: toUser }, w.name), w.v ? vMark() : null,
      h('span.as-fo-post__meta', h('span.as-fo-post__time', time.ago(p.at)), p.dev ? h('span.as-fo-post__from', '来自 ' + p.dev) : null, g ? h('span.as-fo-post__in', g.name) : null)),
    followBtn(p.by),
    p.title ? h('div.as-fo-post__title', p.title) : null,
    ...tx(p, 'as-fo-post__text'),
    picEl(p),
    top ? h('div.as-fo-post__hotcmt', h('b', E.floorWho(p, top) + '：'), top.text) : null,
    h('span.as-fo-post__count', E.fmt(p.cmts)),
    h('div.as-fo-post__acts', act('forum.act.repost', 'send', p.reposts), act('forum.act.comment', 'comment', p.cmts, full ? null : e => { e.stopPropagation(); openPost(p); }), likeBtn(p)));
}
/* 配图：有图就整张显示（不裁）；只有描述时是一张卡片，点了生图（再点取消） */
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
/** 发帖：选版块 / 小组、标题（可以不写）、正文、配图；发出去马上显示，再找 AI 出别人的回复 */
function compose(b0) {
  let board = ['follow', 'all'].includes(b0) || !E.groupOf(b0) ? 'global' : b0, pic = '';
  const title = input({ placeholder: '标题' }), body = textarea({ placeholder: '正文', rows: 5 });
  const pv = h('img.as-fo-compose__pic', { hidden: true, alt: '配图', onclick: () => { pic = ''; pv.hidden = true; } });
  const where = h('div.as-fo-pick', E.boards().map(g => h('button' + (g.id === board ? '.is-on' : ''), { dataset: { b: g.id }, onclick: () => {
    board = g.id; where.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x.dataset.b === board));
  } }, g.base ? W('forum.tab.' + g.id) : g.name)));
  const s = sheet({ title: word('forum.post.new'), content: h('div.as-fo-compose', where, title, body, pv,
    h('div.as-fo-compose__row', accChip(), btn('配图', 'secondary', async () => { const f = await pickFile('image/*'); if (!f) return; pic = await fileToDataURL(f, 1080); pv.src = pic; pv.hidden = false; })),
    h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('发布', 'primary', async () => {
      const text = body.value.trim(); if (!text) { toast('写点什么'); return; }
      s.close();
      const p = await E.post({ board, title: title.value.trim(), text, pic });
      landed([p]); runThread(p, { count: '4～8' }); openPost(p);
    }))) });
  applyTexts();
}

/* ---------- 积木 ---------- */
const head = (k, more) => h('div.as-fo-blockhead', W(k, 'b'), more);
const hotTag = i => (i === 0 ? '沸' : i < 3 ? '热' : i % 4 === 1 ? '新' : '');
const hotItem = (x, i) => h('button.as-fo-hot__item', { onclick: () => openSearch(x.topic) }, h('b.as-fo-hot__no', String(i + 1)), h('span.as-fo-hot__topic', x.topic), h('small.as-fo-hot__heat', E.fmt(x.heat)),
  hotTag(i) ? h('i.as-fo-hot__tag', { dataset: { t: hotTag(i) } }, hotTag(i)) : null);
const BLOCK = {
  search: () => h('button.as-fo-search', { onclick: () => openSearch('') }, icon('search', 16, 2), W('forum.search.ph')),
  hot: () => {
    const box = h('div.as-fo-hot');
    const draw = () => {
      const hot = state.forum.hot || [];
      box.replaceChildren(head('forum.hot', h('button.as-fo-blockhead__more', { onclick: openHot }, W('forum.hot.more'))),
        hot.length ? h('div.as-fo-hot__list', hot.slice(0, 10).map(hotItem)) : h('div.as-fo-hot__empty', jobBtn('feed:global', () => ['刷新'], () => feedTo('global'), 'button.as-btn.as-btn--secondary')));
    };
    hots.add({ el: box, draw }); draw();
    return box;
  },
  boards: () => {
    const box = h('div.as-fo-boards');
    const draw = () => box.replaceChildren(head('forum.boards'), h('div.as-fo-boards__list', E.boards().map(g => h('button.as-fo-board', { dataset: { b: g.id }, onclick: () => openBoard(g.id) },
      h('span.as-fo-board__icon', g.name.slice(0, 1)), h('span.as-fo-board__name', g.name), g.base ? W('forum.tab.' + g.id, 'span.as-fo-board__tag') : W('forum.group', 'span.as-fo-board__tag'),
      h('span.as-fo-board__count', g.members ? E.fmt(g.members) : '')))));
    hots.add({ el: box, draw }); draw();   // AI 起了新小组也跟着刷新
    return box;
  },
  chips: () => {
    const body = h('div.as-fo-chips__body'), made = {}, row = h('div.as-fo-chips__row');
    const show = id => {
      row.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.b === id));
      if (!made[id]) {
        const m = p => (id === 'all' ? p.board !== 'anon' : p.board === id);
        made[id] = h('div'); body.append(made[id]);
        E.load().then(d => { made[id].append(liveList(m, d.posts.filter(m))); applyTexts(); });
      }
      for (const [k, el] of Object.entries(made)) el.hidden = k !== id;
    };
    row.append(h('button', { dataset: { b: 'all' }, onclick: () => show('all') }, '全部'), ...E.boards().filter(g => g.id !== 'anon').map(g => h('button', { dataset: { b: g.id }, onclick: () => show(g.id) }, g.name)));
    show('all');
    return h('div.as-fo-chips', head('forum.discuss'), row, body);
  },
};

/* ---------- 主页面：底部标签（样子定几个、是什么） ---------- */
let R = null;   // 开着的主页面
const feedOf = f => p => f === 'all' ? p.board !== 'anon' : f === 'follow' ? !p.by.anon && p.by.k !== 'me' && (state.forum.follows || []).includes(keyOf(p.by)) : p.board === f;
function homePane() {
  const feeds = look().layout.home, made = {};
  const sw = h('div.as-fo-switch', feeds.map(f => h('button', { dataset: { f: f.feed }, onclick: () => show(f.feed) }, f.text)));
  const box = h('div.as-fo-feeds');
  const refresh = h('span.as-fo-refresh', feeds.map(f => jobBtn('feed:' + f.feed, () => [icon('repeat', 20, 1.9)], () => {
    if (f.feed === 'follow' && !(state.forum.follows || []).length) { toast('还没有关注的人'); return; }
    feedTo(f.feed);
  })));
  function show(f) {
    R.feed = f;
    sw.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.f === f));
    refresh.querySelectorAll('[data-job]').forEach(b => { b.hidden = b.dataset.job !== 'feed:' + f; });
    if (!made[f]) { made[f] = h('div'); box.append(made[f]); E.load().then(d => { made[f].append(liveList(feedOf(f), d.posts.filter(feedOf(f)))); applyTexts(); }); }
    for (const [k, el] of Object.entries(made)) el.hidden = k !== f;
  }
  return { el: box, title: sw, right: [navBtn('search', '搜索', () => openSearch('')), refresh, h('span.as-fo-navpost', navBtn('edit', word('forum.post.new'), () => compose(R.feed)))], first: () => show(feeds[0].feed) };
}
function inboxPane() {
  const panes = { notice: empty('还没有提醒'), dm: empty('还没有私信') };
  const sw = h('div.as-fo-switch', ['notice', 'dm'].map(k => h('button' + (k === 'notice' ? '.is-on' : ''), { dataset: { k }, onclick: () => {
    sw.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.k === k)); panes.notice.hidden = k !== 'notice'; panes.dm.hidden = k !== 'dm';
  } }, W('forum.inbox.' + k))));
  panes.dm.hidden = true;
  return { el: h('div.as-fo-inbox', panes.notice, panes.dm), title: sw };
}
function mePane() {
  const a = E.curAcc(), me = { k: 'me', id: a.id }, w = E.who(me);
  const tile = (ic, label, fn) => h('button.as-fo-megrid__item', { onclick: fn }, icon(ic, 22, 1.7), h('span', label));
  return { el: h('div.as-fo-me',
    h('button.as-fo-mehead', { onclick: () => openUser(me) }, ava(me, 56, true), h('span.as-fo-mehead__name', w.name), h('span.as-fo-mehead__sub', '我的主页'), icon('chevron', 16, 2)),
    h('div.as-fo-megrid', tile('user', '我的号', openAccounts), tile('star', '营销号', openBots), tile('users', '熟人', openPeople), tile('gear', '设置', openSettings))), title: '我' };
}
const blocksPane = (kind, title) => ({ el: h('div.as-fo-blocks', (look().layout[kind] || []).map(b => BLOCK[b]())), title,
  right: kind === 'discover' ? [jobBtn('feed:global', () => [icon('repeat', 20, 1.9)], () => feedTo('global'))] : [] });
export function open() {
  applyLook();
  phone().dataset.forumTr = E.A().tr || 'both';
  const p = page({ app: 'forum', id: 'forum-home', title: '论坛', large: true, back: true, cls: 'as-fo-root' });
  const titleEl = p.nav.querySelector('.as-navbar__title'), right = p.nav.querySelector('.as-navbar__right');
  const tabs = look().layout.tabs, panes = {};
  const make = { home: homePane, discover: () => blocksPane('discover', '发现'), groups: () => blocksPane('groups', word('forum.boards')), inbox: inboxPane, me: mePane };
  const bar = h('nav.as-fo-tabbar', { role: 'tablist' }, tabs.map(t => h('button.as-fo-tab', { role: 'tab', dataset: { tab: t.page }, onclick: () => show(t.page) },
    /^img:/.test(t.icon) ? h('i.as-fo-tab__img', { style: { backgroundImage: `var(--fo-img-${t.icon.slice(4)})` } }) : icon(t.icon || 'grid', 24, 1.7), h('span', t.text))));
  function show(pg) {
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.tab === pg));
    if (!panes[pg]) { panes[pg] = make[pg](); panes[pg].el.classList.add('as-fo-pane'); p.body.append(panes[pg].el); panes[pg].first?.(); }
    for (const [k, x] of Object.entries(panes)) x.el.hidden = k !== pg;
    const x = panes[pg];
    titleEl.replaceChildren(x.title || '');
    right.replaceChildren(...(x.right || []));
    p.el.dataset.tab = pg; p.body.scrollTop = 0; applyTexts();
  }
  p.el.append(h('button.as-fo-fab', { 'aria-label': word('forum.post.new'), onclick: () => compose(R.feed) }, icon('edit', 22, 2)), bar);
  R = { el: p.el, feed: 'global' };
  show(tabs[0].page);
  return p.el;
}

/* ---------- 帖子 ---------- */
const views = new Map();   // 帖子 id → 开着的帖子页（出完评论填进去）
function floorEl(p, f, i) {
  const w = f.by.op ? E.who(p.by) : E.who(f.by), up = f.to && f.to !== 'op' && p.floors.find(x => x.id === f.to);
  const to = f.to === 'op' ? word('forum.op') : up ? E.floorWho(p, up) : '', no = word('forum.floor');
  return h('div.as-fo-floor' + (up ? '.is-sub' : '') + (f.by.op ? '.is-op' : '') + (f.by.k === 'me' ? '.is-me' : ''), { dataset: { id: f.id } },
    h('span.as-fo-floor__ava', { onclick: e => { e.stopPropagation(); if (!f.by.op && !f.by.anon) openUser(f.by); } }, ava(f.by.op ? p.by : f.by, 32, true)),
    h('div.as-fo-floor__main',
      h('div.as-fo-floor__who', h('span.as-fo-floor__name', w.name), w.v ? vMark() : null, f.by.op ? W('forum.op', 'span.as-fo-floor__op') : null, to ? h('span.as-fo-floor__to', '回复 ' + to) : null),
      up ? h('div.as-fo-floor__quote', h('b', E.floorWho(p, up) + '：'), up.text) : null,
      ...tx(f, 'as-fo-floor__text'),
      h('div.as-fo-floor__meta', no ? h('span.as-fo-floor__no', no.replace('{n}', i + 1)) : null, h('span.as-fo-floor__time', time.ago(f.at)), likeBtn(f))));
}
const runThread = (p, opts) => jobs['thread:' + p.id] ? null : go('thread:' + p.id, '正在出评论…', s => E.thread(p, s, opts)).then(add => {
  if (!add) return;
  const v = views.get(p.id); if (v && v.el.isConnected) v.add(add);
  document.querySelectorAll(`[data-id="${p.id}"] .as-fo-post__count, [data-id="${p.id}"] .is-comment .as-fo-act__n, [data-post="${p.id}"] .is-comment .as-fo-act__n`).forEach(n => { n.textContent = E.fmt(p.cmts); });
  toast(`新增 ${add.length} 条${word('forum.act.comment')}`);
});
/** 回帖：点底下那条、或者点某一层弹出来；to = 回哪一楼（'' 回帖子） */
function replySheet(p, to, floors) {
  const t = textarea({ placeholder: to ? '回复 ' + E.floorWho(p, p.floors.find(x => x.id === to)) : word('forum.reply.ph'), rows: 4 });
  const s = sheet({ title: word('forum.act.comment'), content: h('div.as-fo-compose', t, h('div.as-fo-compose__row', accChip(), btn('发送', 'primary', async () => {
    const text = t.value.trim(); if (!text) return;
    s.close();
    const f = await E.reply(p, text, to);
    floors.append(floorEl(p, f, p.floors.length - 1));
    const tn = to ? E.floorWho(p, p.floors.find(x => x.id === to)) : '';
    runThread(p, { focus: `${myName()}（${E.who(f.by).name}）刚在 ${p.floors.length} 楼${tn ? '回复了' + tn : '说'}：「${text}」。${tn ? '被回复的人要回 TA，' : ''}别人想回就回。`, count: '2～5' });
  }))) });
  setTimeout(() => t.focus(), 300);
}
function openPost(p) {
  const pg = page({ app: 'forum', id: 'forum-post', title: E.groupName(p.board) || word('forum.act.comment'), back: true });
  pg.el.dataset.post = p.id;
  const floors = h('div.as-fo-floors', (p.floors || []).map((f, i) => floorEl(p, f, i)));
  const more = jobBtn('thread:' + p.id, () => [(p.floors || []).length ? '再来一些' : '看' + word('forum.act.comment')], () => runThread(p), 'button.as-btn.as-btn--secondary.as-fo-morebtn');
  const stat = (k, n, on) => h('button.as-fo-stat__item' + (on ? '.is-on' : ''), W(k), h('span', E.fmt(n)));
  const onlyOp = h('button.as-fo-sort__op', { onclick: () => { floors.classList.toggle('is-op-only'); onlyOp.classList.toggle('is-on'); } }, W('forum.only.op'));
  floors.addEventListener('click', e => { const el = e.target.closest('.as-fo-floor'); if (!el || e.target.closest('button, .as-fo-floor__ava')) return; replySheet(p, el.dataset.id, floors); });
  pg.body.append(card(p, true), h('div.as-fo-stat', stat('forum.act.repost', p.reposts), stat('forum.act.comment', p.cmts, true), stat('forum.act.like', p.likes), stat('forum.act.fav', 0)),
    h('div.as-fo-sort', W('forum.all.reply', 'span.as-fo-sort__all'), onlyOp), floors, more);
  pg.el.append(h('div.as-fo-dock', accChip(), h('button.as-fo-dock__pill', { onclick: () => replySheet(p, '', floors) }, W('forum.reply.ph')),
    act('forum.act.repost', 'send', p.reposts), act('forum.act.comment', 'comment', p.cmts, () => replySheet(p, '', floors)), likeBtn(p)));
  views.set(p.id, { el: pg.el, add: list => { const n = p.floors.length - list.length; floors.append(...list.map((f, i) => floorEl(p, f, n + i))); } });
  nav.push(pg.el); applyTexts();
  if (!(p.floors || []).length && E.A().autoOpen !== false && !jobs['thread:' + p.id]) runThread(p);
}

/* ---------- 主页：背景图、头像框、底栏图都能装扮（右上角「…」） ---------- */
const same = (a, b) => !a.anon && a.k === b.k && (a.id ? a.id === b.id : a.name === b.name);
function openUser(by) {
  const w = E.who(by), key = keyOf(by), b = by.k === 'bot' && E.botOf(by.id), mine = by.k === 'me';
  const dec = () => E.decoOf(key);
  const pg = page({ app: 'forum', id: 'forum-user', title: w.name, back: true, right: [navBtn('more', '装扮', () => decorate())] });
  const cover = h('div.as-fo-user__cover'), avaBox = h('span.as-fo-user__ava');
  async function decorate() {
    const v = await actionSheet('装扮', [{ value: 'cover', label: '背景图', icon: 'image' }, { value: 'frame', label: '头像框', icon: 'user' }, { value: 'bar', label: '底栏图', icon: 'image' }]);
    if (!v) return;
    const d = state.forum.decos[key] = state.forum.decos[key] || {};
    if (v === 'frame') { const r = await pickDeco('frames', d.frame); if (r == null) return; d.frame = r === 'none' ? '' : r; }
    else { const u = await pickImage(v === 'cover' ? '背景图' : '底栏图', { ratio: v === 'cover' ? 1.4 : 4, size: 1200, has: !!d[v] }); if (u == null) return; d[v] = u; }
    commit('forum'); paint();
  }
  const n = (v, k) => h('span.as-fo-user__num', h('b', E.fmt(v)), W(k));
  const seed = hash(key), fans = b ? b.fans : mine ? 0 : 50 + seed % 5000;
  const list = h('div.as-fo-list');
  const more = mine ? null : jobBtn('more:' + key, () => ['看看 TA 还发了什么'], () => go('more:' + key, '正在刷新…', s => E.feed(b ? 'global' : 'local', {
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
  const ubar = h('div.as-fo-ubar', mine ? h('button.as-fo-ubar__item', { onclick: decorate }, icon('palette', 20, 1.8), h('span', '装扮')) : h('button.as-fo-ubar__item', { onclick: () => toast('私信下一步做') }, icon('chat', 20, 1.8), W('forum.dm')),
    sub, mine ? null : followBtn(by));
  function paint() {
    cover.style.backgroundImage = dec().cover ? `url("${dec().cover}")` : ''; cover.classList.toggle('has-img', !!dec().cover);
    avaBox.replaceChildren(ava(by, 76, true), w.v ? h('i.as-fo-post__badge') : null);
    ubar.style.backgroundImage = dec().bar ? `url("${dec().bar}")` : ''; ubar.classList.toggle('has-img', !!dec().bar);
  }
  pg.body.append(h('div.as-fo-user', cover,
    h('div.as-fo-user__main', avaBox, h('div.as-fo-user__name', w.name, w.v ? vMark() : null),
      h('div.as-fo-user__bio', b ? `${b.topic}${b.bio ? ' · ' + b.bio : ''}` : mine ? E.curAcc().bio || '' : ''),
      h('div.as-fo-user__nums', n(fans, 'forum.fans'), n(mine ? (state.forum.follows || []).length : 20 + seed % 400, 'forum.follows'), n(b ? b.fans * 7 : 100 + seed % 90000, 'forum.likes'))),
    h('div.as-fo-user__tabs', W('forum.user.tab', 'span.is-on'))), more, list);
  pg.el.append(ubar);
  paint();
  E.load().then(d => { list.append(...d.posts.filter(p => same(p.by, by)).map(p => card(p))); applyTexts(); });
  lists.add({ el: list, match: p => same(p.by, by) });
  nav.push(pg.el); applyTexts();
}

/* ---------- 小组页（豆瓣的小组 / 微博的超话、同城、树洞 / 推特的社群） ---------- */
function openBoard(id) {
  const g = E.groupOf(id); if (!g) return;
  const pg = page({ app: 'forum', id: 'forum-board', title: g.name, back: true, right: [jobBtn('feed:' + id, () => [icon('repeat', 20, 1.9)], () => feedTo(id)), navBtn('edit', word('forum.post.new'), () => compose(id))] });
  const join = !g.base && h('button.as-fo-join' + (g.joined ? '.is-on' : ''), { onclick: () => { g.joined = !g.joined; commit('forum'); join.classList.toggle('is-on', g.joined); join.replaceChildren(W(g.joined ? 'forum.joined' : 'forum.join')); applyTexts(); } }, W(g.joined ? 'forum.joined' : 'forum.join'));
  const list = h('div');
  pg.body.append(h('div.as-fo-boardhead', h('span.as-fo-board__icon', g.name.slice(0, 1)), h('div.as-fo-boardhead__main', h('b.as-fo-boardhead__name', g.name),
    h('span.as-fo-boardhead__count', g.members ? E.fmt(g.members) + ' ' : '', W('forum.members')), g.intro ? h('span.as-fo-boardhead__intro', g.intro) : null), join || null), list);
  E.load().then(d => { list.append(liveList(p => p.board === id, d.posts.filter(p => p.board === id))); applyTexts(); });
  nav.push(pg.el); applyTexts();
}
/* ---------- 热搜（热榜）整页 ---------- */
function openHot() {
  const pg = page({ app: 'forum', id: 'forum-hot', title: word('forum.hot.title'), back: true, right: [jobBtn('feed:global', () => [icon('repeat', 20, 1.9)], () => feedTo('global'))] });
  const list = h('div.as-fo-hotlist');
  const draw = () => list.replaceChildren(...(state.forum.hot || []).map(hotItem), (state.forum.hot || []).length ? null : empty('还没有热榜，刷新一下'));
  hots.add({ el: list, draw }); draw();
  pg.body.append(h('div.as-fo-banner', W('forum.hot.title', 'b')), list);
  nav.push(pg.el); applyTexts();
}
/* ---------- 搜索：先在存着的帖子里找；「全网搜」按这个词刷一批（一次调用） ---------- */
function openSearch(q0) {
  const pg = page({ app: 'forum', id: 'forum-search', title: '搜索', back: true });
  const q = input({ value: q0, placeholder: '搜索' }), res = h('div.as-fo-list');
  const find = async () => {
    const k = q.value.trim(), d = await E.load();
    const hit = k ? d.posts.filter(p => [p.title, p.text, p.tr, E.who(p.by).name].some(x => x && x.includes(k))) : [];
    res.replaceChildren(...hit.map(p => card(p)), k ? jobBtn('feed:global', () => [`全网搜「${k}」`], () => feedTo('global', { pick: `都围绕这个话题：${k}` }).then(got => { if (got) find(); }), 'button.as-btn.as-btn--secondary.as-fo-morebtn') : null);
    applyTexts();
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) find(); });
  pg.body.append(h('div.as-fo-searchbar', q, h('button.as-fo-searchbar__go', { 'aria-label': '搜索', onclick: find }, icon('search', 18, 2))), res);
  nav.push(pg.el); if (q0) find(); else setTimeout(() => q.focus(), 300);
}

/* ---------- 我：设置、我的号 ---------- */
function openSettings() {
  const F = E.F(), A = E.A();
  const pg = page({ app: 'forum', id: 'forum-settings', title: '设置', back: true });
  const where = () => F.region ? `${F.region} · ${langName(F.lang || 'zh-CN')}` : '按正文定';
  const region = item({ title: '地区', value: where(), chevron: true, onClick: async () => {
    const n = await dialog({ title: '地区', input: { value: F.region, placeholder: '地名' } }); if (n == null) return;
    const l = n.trim() ? await actionSheet('那里说什么语言', LANGS.map(([v, t]) => ({ value: v, label: t, active: v === F.lang }))) : '';
    if (l == null) return;
    F.region = n.trim().slice(0, 20); F.lang = l; commit('forum');
    region.querySelector('.as-list-item__value').textContent = where();
  } });
  pg.body.append(h('div.as-fo-set', group('', [region]),
    group('显示', [field('外语', segmented([['both', '上下对照'], ['tap', '点了才显示']], A.tr, v => { A.tr = v; commit('apps'); phone().dataset.forumTr = v; }))]),
    group('刷新', [field('一次刷几条', segmented([4, 6, 8, 10].map(n => [n, String(n)]), A.count || 6, v => { A.count = v; commit('apps'); })),
      toggleItem({ title: '点开帖子就出评论' }, A.autoOpen !== false, v => { A.autoOpen = v; commit('apps'); })])));
  nav.push(pg.el);
}
function openAccounts() {
  const F = E.F(), pg = page({ app: 'forum', id: 'forum-accounts', title: '我的号', back: true }), box = h('div.as-fo-set');
  const draw = () => box.replaceChildren(group('', [...F.accounts.map(a => item({ title: E.accName(a) + (a.id === 'main' ? '（大号）' : ''), right: a.id === F.cur ? icon('check', 18, 2.2) : null,
    onClick: async () => {
      const v = await actionSheet(E.accName(a), [{ value: 'use', label: '用这个号', icon: 'check' }, { value: 'edit', label: '编辑', icon: 'edit' }, a.id !== 'main' && { value: 'del', label: '删除', icon: 'trash', danger: true }].filter(Boolean));
      if (v === 'use') { F.cur = a.id; commit('forum'); draw(); document.querySelectorAll('.as-fo-acc').forEach(b => b.replaceWith(accChip())); }
      if (v === 'edit') editAcc(a, draw);
      if (v === 'del' && await dialog({ title: `删除「${E.accName(a)}」？`, confirm: '删除', danger: true })) { F.accounts.splice(F.accounts.indexOf(a), 1); if (F.cur === a.id) F.cur = 'main'; commit('forum'); draw(); }
    } })), item({ icon: 'plus', title: '新建小号', onClick: () => editAcc(null, draw) })]));
  draw(); pg.body.append(box); nav.push(pg.el);
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
  draw(); pg.body.append(h('div.as-fo-set', list)); nav.push(pg.el);
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
  pg.body.append(h('div.as-fo-set', state.contacts.length ? group('', state.contacts.map(c => {
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
