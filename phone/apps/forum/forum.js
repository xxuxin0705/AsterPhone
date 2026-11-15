// 论坛的页面：全是积木。底部几个标签、首页几个信息流、发现 / 小组页放哪些积木，都由正在用的样子（looks.js）决定；
// 每条帖子、每层楼把零件全备齐（头像、V、名字、来自、小组、+关注、标题、正文、话题、配图、热门回复、回应数、转评赞…），显示哪些、怎么排交给样子的 CSS。
// 列表只在第一次显示时画一遍，之后新帖子插到最上面；点赞、关注、翻译只改那一个元素
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, navBtn, icon, avatar, empty, badge, toast, waiting, aiCount, group, item, field, toggleItem, segmented, actionSheet, dialog, btn, sheet, input, textarea, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { applyTexts } from '../../core/skin.js';
import { addFrame } from '../../core/deco.js';
import { LANGS, langName } from '../../core/translate.js';
import { generateImage, resolveConn } from '../../core/api.js';
import { myName } from '../../core/promptstore.js';
import * as time from '../../core/time.js';
import { nameOf } from '../chat/engine.js';
import { look, word, defWord, applyLook } from './looks.js';
import { dressOf, dressed, dressMenu, openDress, hooks } from './dress.js';
import * as E from './engine.js';

const phone = () => document.querySelector('#phone');
const W = (k, tag = 'span') => h(tag, { dataset: { asText: k } }, defWord(k));   // 跟着样子、皮肤换字的一小段
const keyOf = by => by.k === 'me' ? 'me:' + by.id : by.k === 'n' ? 'n:' + by.name : (by.k === 'bot' ? 'b:' : 'c:') + by.id;
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const pad = n => String(n).padStart(2, '0');
/** 今天的说「几分钟前」，昨天的「昨天 21:04」，今年的「10-28」 */
function when(ts) {
  const d = new Date(ts), n = new Date(), md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.toDateString() === n.toDateString()) return time.ago(ts);
  if (d.toDateString() === new Date(n - 864e5).toDateString()) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === n.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}
const ICONS = { repost: 'send', comment: 'comment', like: 'heart' }, icOf = k => (look().layout.icons || {})[k] || ICONS[k];

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
  return framed ? addFrame(a, dressOf(keyOf(by)).frame) : a;
}
/** 正文里的 #话题#、@网名 标成蓝色：点话题搜这个话题，点 @ 进这个人的主页 */
const AT = /@([^\s@#：:，,。！？!?、（）()]{1,20})/g;
function byAt(n) { const a = E.F().accounts.find(x => E.accName(x) === n); return a ? { k: 'me', id: a.id } : E.byName(n, 'global'); }
function rich(text) {
  return String(text).split(/(#[^#\n]{1,30}#|@[^\s@#：:，,。！？!?、（）()]{1,20})/).map(s => /^#.+#$/.test(s) ? h('span.as-fo-topic', { onclick: e => { e.stopPropagation(); openSearch(s.slice(1, -1)); } }, s)
    : /^@/.test(s) ? h('span.as-fo-topic', { onclick: e => { e.stopPropagation(); openUser(byAt(s.slice(1))); } }, s) : s);
}
/** 「@」按钮：从熟人、营销号、关注的人里点一个，插到光标那里 */
function atBtn(t) {
  return btn('@', 'secondary', async () => {
    const ns = [...new Set([...E.onForum().map(E.netName), ...E.F().bots.map(b => b.name), ...(state.forum.follows || []).filter(k => k.startsWith('n:')).map(k => k.slice(2))])];
    if (!ns.length) { toast('还没有可以 @ 的人'); return; }
    const n = await actionSheet('@ 谁', ns.map(x => ({ value: x, label: x }))); if (!n) return;
    t.setRangeText('@' + n + ' ', t.selectionStart, t.selectionEnd, 'end'); t.focus();
  });
}
/** 我 @ 了谁：出评论时让 TA 来 */
const atNote = text => { const ns = [...new Set([...text.matchAll(AT)].map(m => m[1]))]; return ns.length ? `里面 @ 了 ${ns.join('、')}，被 @ 的人看到了会来回（用 TA 的网名）。` : ''; };
/** 正文 + 翻译：上下对照时翻译常显示；「点了才显示」时显示按钮，点一下这一条在原文 / 中文之间换 */
function tx(o, cls) {
  const t = h('div.' + cls, rich(o.text));
  if (!o.tr) return [t];
  let zh = false;
  return [t, h('div.as-fo-post__tr', o.tr), h('button.as-fo-trbtn', { onclick: function (e) { e.stopPropagation(); zh = !zh; t.replaceChildren(...rich(zh ? o.tr : o.text)); this.textContent = zh ? '查看原文' : '查看翻译'; } }, '查看翻译')];
}
function likeBtn(o) {
  const n = h('span.as-fo-act__n', E.fmt(o.likes));
  const b = h('button.as-fo-act.is-like' + (o.liked ? '.is-on' : ''), { 'aria-label': '赞', dataset: { n: o.likes || 0 }, onclick: e => {
    e.stopPropagation(); o.liked = !o.liked; o.likes = Math.max(0, (o.likes || 0) + (o.liked ? 1 : -1));
    b.classList.toggle('is-on', o.liked); n.textContent = E.fmt(o.likes); b.dataset.n = o.likes; E.save();
    const fx = o.liked && dressOf('me:' + E.F().cur).like;
    if (fx) { const im = h('img.as-fo-likefx', { src: fx, alt: '' }); b.append(im); setTimeout(() => im.remove(), 900); }
  } }, icon(icOf('like'), 16, 1.8), n, W('forum.act.like', 'span.as-fo-act__w'));
  return b;
}
const act = (k, n, onclick) => h('button.as-fo-act.is-' + k, { dataset: { n: n || 0 }, onclick }, icon(icOf(k), 16, 1.8), h('span.as-fo-act__n', E.fmt(n)), W('forum.act.' + k, 'span.as-fo-act__w'));
/** +关注：点了只换这个人身上所有关注按钮的字 */
const following = k => (state.forum.follows || []).includes(k);
const paintFollow = b => { const on = following(b.dataset.key); b.classList.toggle('is-on', on); b.replaceChildren(W(on ? 'forum.followed' : 'forum.follow')); };
function toggleFollow(k) {
  const f = state.forum.follows; if (following(k)) f.splice(f.indexOf(k), 1); else f.push(k); commit('forum');
  document.querySelectorAll(`.as-fo-follow[data-key="${CSS.escape(k)}"]`).forEach(paintFollow); applyTexts();
}
function followBtn(by) {
  if (by.anon || by.k === 'me') return null;
  const b = h('button.as-fo-follow', { dataset: { key: keyOf(by) }, onclick: e => { e.stopPropagation(); toggleFollow(b.dataset.key); } });
  paintFollow(b); return b;
}
/** 帖子右上角的小箭头（微博那样）：现在能关注 / 取消关注 */
function postMenu(by) {
  if (by.anon || by.k === 'me') return null;
  return h('button.as-fo-post__menu', { 'aria-label': '更多', onclick: async e => {
    e.stopPropagation(); const k = keyOf(by);
    if (await actionSheet(E.who(by).name, [{ value: 'f', label: following(k) ? '取消关注' : '关注', icon: 'user' }])) toggleFollow(k);
  } }, icon('down', 16, 1.6));
}
function card(p, full) {
  const w = E.who(p.by), g = E.groupOf(p.board), toUser = e => { if (p.by.anon) return; e.stopPropagation(); openUser(p.by); }, dr = p.by.anon ? {} : dressOf(keyOf(p.by));
  const top = !full && (p.floors || []).filter(f => f.by.k !== 'me').sort((a, b) => b.likes - a.likes)[0];
  return h('article.as-fo-post' + (full ? '.is-full' : '') + (p.title ? '.has-title' : '') + (p.pic || p.img ? '.has-media' : '') + (dr.card ? '.has-cardimg' : ''),
    { dataset: { id: p.id, board: p.board }, style: dr.card ? { '--fo-cardimg': `url("${dr.card}")` } : null, onclick: full ? null : () => openPost(p) },
    dr.sticker ? h('img.as-fo-post__sticker', { src: dr.sticker, alt: '' }) : null,
    g ? h('div.as-fo-post__group' + (g.base ? '.is-base' : ''), { onclick: e => { e.stopPropagation(); openBoard(g.id); } }, h('span.as-fo-post__gicon', g.name.slice(0, 1)), h('span.as-fo-post__gname', g.name)) : null,
    h('span.as-fo-post__ava', { onclick: toUser }, ava(p.by, 42, true), w.v ? h('i.as-fo-post__badge') : null),
    h('div.as-fo-post__head', h('span.as-fo-post__name', { onclick: toUser }, w.name), w.v ? vMark() : null, dr.badge ? h('img.as-fo-dbadge', { src: dr.badge, alt: '' }) : null,
      h('span.as-fo-post__meta', h('span.as-fo-post__time', when(p.at)), p.dev ? h('span.as-fo-post__from', '来自 ', h('b', p.dev)) : null, g ? h('span.as-fo-post__in', g.name) : null)),
    followBtn(p.by), postMenu(p.by),
    p.title ? h('div.as-fo-post__title', p.title) : null,
    ...tx(p, 'as-fo-post__text'),
    picEl(p),
    top ? h('div.as-fo-post__hotcmt', h('b', E.floorWho(p, top) + '：'), top.text) : null,
    h('span.as-fo-post__count', E.fmt(p.cmts)),
    h('div.as-fo-post__acts', act('repost', p.reposts), act('comment', p.cmts, full ? null : e => { e.stopPropagation(); openPost(p); }), likeBtn(p)));
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
    h('div.as-fo-compose__row', accChip(), atBtn(body), btn('配图', 'secondary', async () => { const f = await pickFile('image/*'); if (!f) return; pic = await fileToDataURL(f, 1080); pv.src = pic; pv.hidden = false; })),
    h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('发布', 'primary', async () => {
      const text = body.value.trim(); if (!text) { toast('写点什么'); return; }
      s.close();
      const p = await E.post({ board, title: title.value.trim(), text, pic });
      landed([p]); runThread(p, { count: '4～8', focus: atNote(text) }); openPost(p);
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
        hot.length ? h('div.as-fo-hot__list', hot.slice(0, 11).map(hotItem), h('button.as-fo-hot__more', { onclick: openHot }, W('forum.hot.more'))) : h('div.as-fo-hot__empty', jobBtn('feed:global', () => ['刷新'], () => feedTo('global'), 'button.as-btn.as-btn--secondary')));
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
    row.append(h('button', { dataset: { b: 'all' }, onclick: () => show('all') }, W('forum.chips.all')), ...E.boards().filter(g => g.id !== 'anon').map(g => h('button', { dataset: { b: g.id }, onclick: () => show(g.id) }, g.name)));
    show('all');
    return h('div.as-fo-chips', head('forum.discuss'), row, body);
  },
};

/* ---------- 主页面：底部标签（样子定几个、是什么） ---------- */
let R = null;   // 开着的主页面
const feedOf = f => p => f === 'all' ? p.board !== 'anon' : f === 'follow' ? !p.by.anon && p.by.k !== 'me' && (state.forum.follows || []).includes(keyOf(p.by)) : p.board === f;
function homePane(feeds, isHome) {
  const made = {};
  let cur = feeds[0].feed;
  const sw = h('div.as-fo-switch', feeds.map(f => h('button', { dataset: { f: f.feed }, onclick: () => show(f.feed) }, f.text)));
  const box = h('div.as-fo-feeds');
  const refresh = h('span.as-fo-refresh', feeds.map(f => jobBtn('feed:' + f.feed, () => [icon('repeat', 20, 1.9)], () => {
    if (f.feed === 'follow' && !(state.forum.follows || []).length) { toast('还没有关注的人'); return; }
    feedTo(f.feed);
  })));
  function show(f) {
    R.feed = cur = f;
    sw.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b.dataset.f === f));
    refresh.querySelectorAll('[data-job]').forEach(b => { b.hidden = b.dataset.job !== 'feed:' + f; });
    if (!made[f]) {
      made[f] = h('div'); box.append(made[f]);
      E.load().then(d => {
        made[f].append(liveList(feedOf(f), d.posts.filter(feedOf(f))));
        made[f].querySelector('.as-empty')?.append(h('div.as-fo-emptybtn', jobBtn('feed:' + f, () => ['刷新'], () => refresh.querySelector(`[data-job="feed:${f}"]`).click(), 'button.as-btn.as-btn--secondary')));
        applyTexts();
      });
    }
    for (const [k, el] of Object.entries(made)) el.hidden = k !== f;
  }
  return { el: box, title: sw, left: isHome ? [h('button.as-fo-navgroups', { onclick: openGroups }, W('forum.group'))] : [],
    right: [navBtn('search', '搜索', () => openSearch('')), refresh, h('span.as-fo-navpost', navBtn('edit', word('forum.post.new'), () => compose(R.feed)))].filter(Boolean),
    first: () => show(cur), feed: () => cur };
}
/* ---------- 消息：动态（关注的人新发的）/ 提醒（评论、赞）/ 私信；样子定有哪几栏 ---------- */
const mine = by => by.k === 'me';
const floorBy = (p, f) => (f.by.op ? p.by : f.by);
/** 别人回我的：我帖子底下的直接评论、回我那一层的 */
function received(d) {
  const out = [];
  for (const p of d.posts) for (const f of p.floors || []) {
    if (mine(floorBy(p, f))) continue;
    const up = f.to && f.to !== 'op' && p.floors.find(x => x.id === f.to);
    if (up ? mine(floorBy(p, up)) : mine(p.by)) out.push({ p, f, up });
  }
  return out.sort((a, b) => b.f.at - a.f.at);
}
const sigOf = d => d.posts.length + ':' + d.posts.reduce((n, p) => n + (p.floors || []).length + (p.likes || 0), 0);
const snip = (p, o) => (o.pic ? h('img.as-fo-cmt__pic', { src: o.pic, alt: '' }) : h('div.as-fo-cmt__snip', o.title || o.text));
/** 消息里的一条：谁、做了什么、什么时候，下面是内容，右边是原帖 */
function noteRow(p, o, by, k, body, right = snip(p, p)) {
  return h('div.as-fo-cmt', { onclick: () => openPost(p) },
    h('span.as-fo-cmt__ava', { onclick: e => { e.stopPropagation(); if (!by.anon) openUser(by); } }, ava(by, 48, true)),
    h('div.as-fo-cmt__main', h('div.as-fo-cmt__name', E.who(by).name), h('div.as-fo-cmt__sub', W(k), ' ', when(o.at)), ...body), right);
}
const replyBtns = (p, f) => h('div.as-fo-cmt__btns', h('button.as-fo-cmt__btn', { onclick: e => { e.stopPropagation(); replySheet(p, f.id, h('div')); } }, icon('comment', 14, 1.8), '回复'), likeBtn(f));
/** 消息里三栏的东西（新的在前）：{ at 时间, el() 画这一条 }；还没点开看过的算未读 */
const NOTES = {
  at: d => {   // 别人的帖子、评论里 @ 了我的网名
    const me = E.myNames(), hit = t => me.some(n => String(t).includes('@' + n)), got = [];
    for (const p of d.posts) {
      if (!mine(p.by) && !p.by.anon && hit(p.text)) got.push({ at: p.at, el: () => noteRow(p, p, p.by, 'forum.at.post', tx(p, 'as-fo-cmt__text'), p.pic ? snip(p, p) : null) });
      for (const f of p.floors || []) if (!mine(floorBy(p, f)) && hit(f.text)) got.push({ at: f.at, el: () => noteRow(p, f, floorBy(p, f), 'forum.at.cmt', [...tx(f, 'as-fo-cmt__text'), replyBtns(p, f)]) });
    }
    return got;
  },
  cmts: d => received(d).map(({ p, f, up }) => ({ at: f.at, el: () => noteRow(p, f, floorBy(p, f), up ? 'forum.cmt.reply' : 'forum.cmt.post',
    [...tx(f, 'as-fo-cmt__text'), up ? h('div.as-fo-cmt__quote', `@${E.floorWho(p, up)}：${up.text}`) : null, replyBtns(p, f)]) })),
  likes: d => {   // 谁赞了我的帖子、我的评论；没留名字的路人合成一条「还有 N 人」
    const got = [];
    for (const p of d.posts) for (const o of [p, ...(p.floors || [])]) {
      if (!(o === p ? mine(p.by) : mine(floorBy(p, o))) || !o.likes) continue;
      const k = o === p ? 'forum.like.post' : 'forum.like.cmt', L = o.likers || [];
      L.forEach(x => got.push({ at: x.at, el: () => noteRow(p, x, x.by, k, [], snip(p, o)) }));
      if (o.likes > L.length) got.push({ at: o.at, el: () => h('div.as-fo-cmt.is-like', { onclick: () => openPost(p) }, h('span.as-fo-cmt__ava.as-fo-likeava', icon('thumb', 24, 1.8)),
        h('div.as-fo-cmt__main', h('div.as-fo-cmt__name', `${L.length ? '还有 ' : ''}${E.fmt(o.likes - L.length)} 人`), h('div.as-fo-cmt__sub', W(k), ' ', when(o.at))), snip(p, o)) });
    }
    return got;
  },
};
const seen = () => (state.forum.seen = state.forum.seen || {});
/** 红色数字：消息里每一行、底部「消息」标签上（只改这几个数字） */
function markBadges() {
  E.load().then(d => {
    let all = 0;
    for (const k of Object.keys(NOTES)) {
      const n = NOTES[k](d).filter(x => x.at > (seen()[k] || 0)).length; all += n;
      document.querySelectorAll(`.as-fo-nrow[data-k="${k}"] .as-fo-nrow__end`).forEach(e => e.replaceChildren(n ? badge(n) : icon('chevron', 16, 2)));
    }
    document.querySelectorAll('.as-fo-tab[data-tab="inbox"]').forEach(t => { t.querySelector('.as-badge')?.remove(); if (all) t.append(badge(all)); });
  });
}
function openNotes(k) {
  const pg = page({ app: 'forum', id: 'forum-' + k, title: word('forum.inbox.' + k), back: true }), list = h('div.as-fo-cmts');
  E.load().then(d => {
    const r = NOTES[k](d).sort((a, b) => b.at - a.at);
    list.replaceChildren(...(r.length ? r.map(x => x.el()) : [empty('还没有消息')])); applyTexts();
    seen()[k] = Date.now(); commit('forum'); markBadges();
  });
  pg.body.append(list); nav.push(pg.el); applyTexts();
}
function dynRows(d) {
  const ps = d.posts.filter(p => !p.by.anon && following(keyOf(p.by))).sort((a, b) => b.at - a.at).slice(0, 60);
  return ps.length ? ps.map(p => {
    const g = E.groupOf(p.board);
    return h('div.as-fo-dyn', { onclick: () => openPost(p) }, h('span.as-fo-dyn__ava', { onclick: e => { e.stopPropagation(); openUser(p.by); } }, ava(p.by, 44, true)),
      h('div.as-fo-dyn__main', h('div.as-fo-dyn__who', h('b', E.who(p.by).name), ' ', g && !g.base ? word('forum.dyn.in').replace('{g}', g.name) : word('forum.dyn.post')),
        h('div.as-fo-dyn__text', p.text), p.pic ? h('img.as-fo-dyn__pic', { src: p.pic, alt: '' }) : null, h('div.as-fo-dyn__time', when(p.at))));
  }) : [empty('还没有动态')];
}
function inboxPane() {
  const kinds = look().layout.inbox?.length ? look().layout.inbox : ['notice', 'dm'];
  const dyn = h('div.as-fo-dyns'), rows = (ic, k) => h('button.as-fo-nrow', { dataset: { k }, onclick: () => openNotes(k) }, h('span.as-fo-nrow__ic', icon(ic, 26, 1.8)), W('forum.inbox.' + k, 'span.as-fo-nrow__t'), h('span.as-fo-nrow__end', icon('chevron', 16, 2)));
  const dms = () => h('div.as-fo-dms', kinds.includes('dm') ? empty('还没有私信') : null);   // 私信下一步做
  const make = { activity: () => dyn, notice: () => h('div.as-fo-notice', rows('at', 'at'), rows('chatdots', 'cmts'), rows('thumb', 'likes'), kinds.includes('dm') ? null : dms()), dm: dms };
  const panes = kinds.map(k => make[k]());
  const sw = h('div.as-fo-switch', kinds.map((k, i) => h('button', { dataset: { k }, onclick: () => pick(i) }, W('forum.inbox.' + k))));
  function pick(i) { sw.querySelectorAll('button').forEach((b, j) => b.classList.toggle('is-on', j === i)); panes.forEach((x, j) => { x.hidden = j !== i; }); }
  pick(Math.max(0, kinds.indexOf('notice')));
  let sig = '';
  const onShow = () => { markBadges(); E.load().then(d => { if (sigOf(d) === sig) return; sig = sigOf(d); dyn.replaceChildren(...dynRows(d)); applyTexts(); }); };   // 有新东西才重画
  return { el: h('div.as-fo-inbox', ...panes), title: sw, onShow, right: [navBtn('gear', '设置', openSettings)] };
}
/** 我：就是我自己的主页（照真微博），右上搜索、设置；我的号、营销号、熟人在设置里 */
function mePane(p) {
  const v = userView({ k: 'me', id: E.curAcc().id }, p.el);
  R.mePaint = v.paint; hooks.worn = k => { if (k === 'me:' + E.F().cur) v.paint(); };
  return { el: h('div.as-fo-me', ...v.els), title: E.who({ k: 'me', id: E.curAcc().id }).name, right: [navBtn('search', '搜索', () => openSearch('')), navBtn('palette', '装扮', openDress), navBtn('gear', '设置', openSettings)] };
}
/** 发现 / 小组页：样子放哪些积木；发现页第一块是搜索框时放到顶栏 */
function blocksPane(kind, title) {
  const bl = look().layout[kind] || [], top = kind === 'discover' && bl[0] === 'search';
  const right = kind === 'discover' ? [jobBtn('feed:global', () => [icon('repeat', 20, 1.9)], () => feedTo('global'))] : [];
  return { el: h('div.as-fo-blocks', (top ? bl.slice(1) : bl).map(b => BLOCK[b]())), title: top ? BLOCK.search() : title, right };
}
/** 微博首页左上角「超话」：小组页单独打开 */
function openGroups() {
  const pg = page({ app: 'forum', id: 'forum-groups', title: word('forum.boards'), back: true });
  pg.body.append(h('div.as-fo-blocks', (look().layout.groups || []).map(b => BLOCK[b]())));
  nav.push(pg.el); applyTexts();
}
export function open() {
  applyLook();
  // 样子都是照 393 宽的真手机量的：手机窄就整体缩一点，宽就放一点，看着和真 App 一样大（打开时算一次）
  phone().style.setProperty('--fo-zoom', (phone().clientWidth / 393).toFixed(3));
  phone().dataset.forumTr = E.A().tr || 'both';
  const p = page({ app: 'forum', id: 'forum-home', title: '论坛', large: true, back: true, cls: 'as-fo-root' });
  const titleEl = p.nav.querySelector('.as-navbar__title'), right = p.nav.querySelector('.as-navbar__right'), left = h('span.as-fo-navleft');
  titleEl.before(left);
  const tabs = look().layout.tabs, panes = [];
  const make = { home: () => homePane(look().layout.home, true), feed: t => homePane([{ feed: t.feed, text: t.text }]), discover: () => blocksPane('discover', '发现'),
    groups: () => blocksPane('groups', word('forum.boards')), inbox: inboxPane, me: () => mePane(p) };
  const bar = h('nav.as-fo-tabbar', { role: 'tablist' }, tabs.map((t, i) => h('button.as-fo-tab', { role: 'tab', dataset: { tab: t.page, i }, onclick: () => show(i) },
    /^img:/.test(t.icon) ? h('i.as-fo-tab__img', { style: { backgroundImage: `var(--fo-img-${t.icon.slice(4)})` } }) : icon(t.icon || 'grid', 24, 1.7), h('span', t.text))));
  let cur = -1;
  function show(i) {
    if (i === cur) return;
    cur = i;
    bar.querySelectorAll('button').forEach((b, j) => b.classList.toggle('is-on', j === i));
    if (!panes[i]) { panes[i] = make[tabs[i].page](tabs[i]); panes[i].el.classList.add('as-fo-pane'); p.body.append(panes[i].el); panes[i].first?.(); }
    panes.forEach((x, j) => { if (x) x.el.hidden = j !== i; });
    const x = panes[i];
    if (x.feed) R.feed = x.feed();
    x.onShow?.();
    titleEl.replaceChildren(x.title || '');
    left.replaceChildren(...(x.left || []));
    right.replaceChildren(...(x.right || []));
    p.el.dataset.tab = tabs[i].page; p.body.scrollTop = 0; applyTexts();
  }
  p.el.append(h('button.as-fo-fab', { 'aria-label': word('forum.post.new'), onclick: () => compose(R.feed) }, icon('edit', 22, 2)), bar);
  p.body.addEventListener('scroll', () => p.el.classList.toggle('is-up', p.body.scrollTop > 200), { passive: true });   // 「我」：背景图翻上去了，顶栏变白
  R = { el: p.el, feed: 'global' };
  show(0); markBadges();
  return p.el;
}

/* ---------- 帖子 ---------- */
const views = new Map();   // 帖子 id → 开着的帖子页（出完评论填进去）
function floorEl(p, f, i) {
  const w = f.by.op ? E.who(p.by) : E.who(f.by), up = f.to && f.to !== 'op' && p.floors.find(x => x.id === f.to);
  const to = f.to === 'op' ? word('forum.op') : up ? E.floorWho(p, up) : '', no = word('forum.floor');
  const bub = !f.by.anon && dressOf(keyOf(f.by.op ? p.by : f.by)).bubble;
  return h('div.as-fo-floor' + (up ? '.is-sub' : '') + (f.by.op ? '.is-op' : '') + (f.by.k === 'me' ? '.is-me' : '') + (bub ? '.has-bubble' : ''), { dataset: { id: f.id }, style: bub ? { '--fo-bubble': `url("${bub}")` } : null },
    h('span.as-fo-floor__ava', { onclick: e => { e.stopPropagation(); if (!f.by.op && !f.by.anon) openUser(f.by); } }, ava(f.by.op ? p.by : f.by, 32, true)),
    h('div.as-fo-floor__main',
      h('div.as-fo-floor__who', h('span.as-fo-floor__name', w.name), w.v ? vMark() : null, f.by.op ? W('forum.op', 'span.as-fo-floor__op') : null, to ? h('span.as-fo-floor__to', '回复 ' + to) : null),
      up ? h('div.as-fo-floor__quote', h('b', E.floorWho(p, up) + '：'), up.text) : null,
      ...tx(f, 'as-fo-floor__text'),
      h('div.as-fo-floor__meta', no ? h('span.as-fo-floor__no', no.replace('{n}', i + 1)) : null, h('span.as-fo-floor__time', when(f.at)), likeBtn(f))));
}
const runThread = (p, opts) => jobs['thread:' + p.id] ? null : go('thread:' + p.id, '正在出评论…', s => E.thread(p, s, opts)).then(add => {
  if (!add) return;
  const v = views.get(p.id); if (v && v.el.isConnected) v.add(add);
  document.querySelectorAll(`[data-id="${p.id}"] .as-fo-post__count, [data-id="${p.id}"] .is-comment .as-fo-act__n, [data-post="${p.id}"] .is-comment .as-fo-act__n`).forEach(n => { n.textContent = E.fmt(p.cmts); n.closest('.as-fo-act')?.setAttribute('data-n', p.cmts); });
  toast(`新增 ${add.length} 条${word('forum.act.comment')}`);
});
/** 回帖：点底下那条、或者点某一层弹出来；to = 回哪一楼（'' 回帖子） */
function replySheet(p, to, floors) {
  const t = textarea({ placeholder: to ? '回复 ' + E.floorWho(p, p.floors.find(x => x.id === to)) : word('forum.reply.ph'), rows: 4 });
  const s = sheet({ title: word('forum.act.comment'), content: h('div.as-fo-compose', t, h('div.as-fo-compose__row', accChip(), atBtn(t), btn('发送', 'primary', async () => {
    const text = t.value.trim(); if (!text) return;
    s.close();
    const f = await E.reply(p, text, to);
    floors.append(floorEl(p, f, p.floors.length - 1));
    const tn = to ? E.floorWho(p, p.floors.find(x => x.id === to)) : '';
    runThread(p, { focus: `${myName()}（${E.who(f.by).name}）刚在 ${p.floors.length} 楼${tn ? '回复了' + tn : '说'}：「${text}」。${tn ? '被回复的人要回 TA，' : ''}别人想回就回。${atNote(text)}`, count: '2～5' });
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
    act('repost', p.reposts), act('comment', p.cmts, () => replySheet(p, '', floors)), likeBtn(p)));
  views.set(p.id, { el: pg.el, add: list => { const n = p.floors.length - list.length; floors.append(...list.map((f, i) => floorEl(p, f, n + i))); } });
  nav.push(pg.el); applyTexts();
  if (!(p.floors || []).length && E.A().autoOpen !== false && !jobs['thread:' + p.id]) runThread(p);
}

/* ---------- 主页：右上角「…」装扮（穿套装、单独换一样）；穿了套装主页换成装扮的样子（.is-dressed） ---------- */
const same = (a, b) => !a.anon && a.k === b.k && (a.id ? a.id === b.id : a.name === b.name);
function openUser(by) {
  const pg = page({ app: 'forum', id: 'forum-user', title: E.who(by).name, back: true, right: [navBtn('more', '装扮', () => v.decorate())] });
  const v = userView(by, pg.el);
  pg.body.append(...v.els); pg.el.append(v.ubar);
  pg.body.addEventListener('scroll', () => pg.el.classList.toggle('is-up', pg.body.scrollTop > 200), { passive: true });   // 背景图翻上去了：顶栏变白、显示名字
  nav.push(pg.el); applyTexts();
}
/** 一个人的主页：host 是放它的那一页（穿了套装加 .is-dressed、大图铺在上面） */
function userView(by, host) {
  const w = E.who(by), key = keyOf(by), b = by.k === 'bot' && E.botOf(by.id), mine = by.k === 'me';
  const decorate = () => dressMenu(key, paint);
  // 点背景图：整张大图铺满看
  const cover = h('div.as-fo-user__cover', { onclick: () => { const u = dressOf(key).cover; if (u) { const v = h('div.as-fo-viewer', { onclick: () => v.remove() }, h('img', { src: u, alt: '' })); host.append(v); } } });
  const avaBox = h('span.as-fo-user__ava'), badge = h('img.as-fo-dbadge', { alt: '' }), tab = h('span.is-on', h('img.as-fo-user__tabimg', { alt: '' }), W('forum.user.tab'));
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
  // 只改图和几个开关，不重画整页
  function paint() {
    const dr = dressOf(key), img = (el, u) => { el.hidden = !u; if (u) el.src = u; };
    host.classList.toggle('is-dressed', dressed(key));
    cover.style.backgroundImage = dr.cover ? `url("${dr.cover}")` : ''; cover.classList.toggle('has-img', !!dr.cover);
    avaBox.replaceChildren(ava(by, 80, true), w.v ? h('i.as-fo-post__badge') : null);
    img(badge, dr.badge); img(tab.firstChild, dr.tab);
    tabs.style.setProperty('--fo-tabline', dr.tabline ? `url("${dr.tabline}")` : ''); tabs.classList.toggle('has-line', !!dr.tabline);
    ubar.style.backgroundImage = dr.bar ? `url("${dr.bar}")` : ''; ubar.classList.toggle('has-img', !!dr.bar);
    ubar.querySelectorAll('.as-fo-ubar__item').forEach(x => x.classList.toggle('has-pic', !!dr.btn)); ubar.style.setProperty('--fo-btnimg', dr.btn ? `url("${dr.btn}")` : '');
    ubar.style.setProperty('--fo-followimg', dr.follow ? `url("${dr.follow}")` : ''); ubar.classList.toggle('has-follow', !!dr.follow);
  }
  const tabs = h('div.as-fo-user__tabs', tab), acc = mine && E.accOf(by.id);
  const nameEl = h('span', w.name), bio = h('div.as-fo-user__bio', b ? b.bio : acc ? acc.bio || '' : '');
  // 我自己：「编辑个人资料」改网名、简介、头像，改完只换这几处
  const edit = acc && h('button.as-fo-user__edit', { onclick: () => editAcc(acc, () => { nameEl.textContent = E.who(by).name; bio.textContent = acc.bio || ''; paint(); }) }, icon('edit', 15, 1.8), '编辑个人资料');
  const els = [h('div.as-fo-user', cover,
    h('div.as-fo-user__main', avaBox, h('div.as-fo-user__name', nameEl, w.v ? vMark() : null, badge),
      b || w.v ? h('div.as-fo-user__cert', icon('shield', 15, 1.7), b ? b.topic : '已认证') : null, bio,
      h('div.as-fo-user__nums', n(fans, 'forum.fans'), n(mine ? (state.forum.follows || []).length : 20 + seed % 400, 'forum.follows'), n(b ? b.fans * 7 : 100 + seed % 90000, 'forum.likes')), edit)),
    tabs, more, list].filter(Boolean);
  paint();
  E.load().then(d => { list.append(...d.posts.filter(p => same(p.by, by)).map(p => card(p))); applyTexts(); });
  lists.add({ el: list, match: p => same(p.by, by) });
  return { els, ubar, paint, decorate };
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
  pg.body.append(list);
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
  pg.body.append(h('div.as-fo-set', group('', [item({ icon: 'user', title: '我的号', chevron: true, onClick: openAccounts }), item({ icon: 'star', color: 'orange', title: '营销号', chevron: true, onClick: openBots }),
    item({ icon: 'users', color: 'green', title: '熟人', chevron: true, onClick: openPeople }), item({ icon: 'palette', color: 'pink', title: '我的主页装扮', chevron: true, onClick: () => dressMenu('me:' + F.cur, () => R?.mePaint?.()) })]),
    group('', [region]),
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
