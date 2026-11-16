// 论坛的页面：全是积木。底部几个标签、首页几个信息流、发现 / 小组页放哪些积木，都由正在用的样子（looks.js）决定；
// 每条帖子、每层楼把零件全备齐（头像、V、名字、来自、小组、+关注、标题、正文、话题、配图、热门回复、回应数、转评赞…），显示哪些、怎么排交给样子的 CSS。
// 列表只在第一次显示时画一遍，之后新帖子插到最上面；点赞、关注、翻译只改那一个元素
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit, contact } from '../../core/store.js';
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
import { dressOf, dressed, fade, dressMenu, setTiles, hooks } from './dress.js';
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
  return framed ? addFrame(a, by.k === 'c' ? contact(by.id)?.frame : by.k === 'me' ? state.me?.frame : '') : a;   // 头像框用资源库「个性装扮」里给这个人选的
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
  const w = E.who(p.by), g = E.groupOf(p.board), toUser = e => { if (p.by.anon) return; e.stopPropagation(); openUser(p.by); };
  const top = !full && (p.floors || []).filter(f => f.by.k !== 'me').sort((a, b) => b.likes - a.likes)[0];
  return h('article.as-fo-post' + (full ? '.is-full' : '') + (p.title ? '.has-title' : '') + (p.pic || p.img ? '.has-media' : ''),
    { dataset: { id: p.id, board: p.board }, onclick: full ? null : () => openPost(p) },
    g ? h('div.as-fo-post__group' + (g.base ? '.is-base' : ''), { onclick: e => { e.stopPropagation(); openBoard(g.id); } }, h('span.as-fo-post__gicon', g.name.slice(0, 1)), h('span.as-fo-post__gname', g.name)) : null,
    h('span.as-fo-post__ava', { onclick: toUser }, ava(p.by, 42, true), w.v ? h('i.as-fo-post__badge.is-' + w.v) : null),
    h('div.as-fo-post__head', h('span.as-fo-post__name', { onclick: toUser }, w.name), w.v ? vMark() : null,
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
      landed([p]); openPost(p);
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
  const box = h('div.as-fo-me');
  // 换了号：「我」整个换成那个号的主页（先画好再一次换上）
  const build = () => {
    const v = userView({ k: 'me', id: E.curAcc().id }, p.el);
    R.mePaint = v.paint; R.meRefresh = v.refresh; hooks.worn = k => { if (k === 'me:' + E.F().cur) v.paint(); };
    box.replaceChildren(...v.els); applyTexts();
  };
  build(); R.meSwitch = build;
  return { el: box, title: E.who({ k: 'me', id: E.curAcc().id }).name, right: [navBtn('search', '搜索', () => openSearch('')), navBtn('edit', '编辑主页', openEditMe), navBtn('gear', '设置', openSettings)] };
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
  return h('div.as-fo-floor' + (up ? '.is-sub' : '') + (f.by.op ? '.is-op' : '') + (f.by.k === 'me' ? '.is-me' : ''), { dataset: { id: f.id } },
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
    // 不自动出：点评论键时，楼里我还没人回的那几层会让被我回的人来回（看 ask）
  }))) });
  setTimeout(() => t.focus(), 300);
}
function openPost(p) {
  const pg = page({ app: 'forum', id: 'forum-post', title: E.groupName(p.board) || word('forum.act.comment'), back: true, right: [jobBtn('thread:' + p.id, () => [icon('chatdots', 22, 1.8)], () => ask())] });
  pg.el.dataset.post = p.id;
  const floors = h('div.as-fo-floors', (p.floors || []).map((f, i) => floorEl(p, f, i)));
  // 出评论只在点了才出（右上的评论键、底下「再来一些」）：自己发的帖、投的稿也一样
  // 楼里我说过、还没人接的那几层：直接从楼层里找，不另外记
  const ask = () => {
    const fl = p.floors || [], wait = fl.map((f, i) => [f, i]).filter(([f, i]) => mine(floorBy(p, f)) && !fl.slice(i + 1).some(x => !mine(floorBy(p, x)) && (x.to === f.id || !f.to)));   // 我说的那层后面还没有别人回它（没指名回谁的，后面有人说话就算接了）
    const q = wait.map(([f, i]) => { const up = f.to && f.to !== 'op' && fl.find(x => x.id === f.to); return `${myName()}（${E.who(f.by).name}）在 ${i + 1} 楼${up ? '回复了' + E.floorWho(p, up) : '说'}：「${f.text}」。${up ? '被回复的人要回 TA。' : ''}${atNote(f.text)}`; }).join('\n');
    return runThread(p, q ? { focus: q + '\n别人想回就回。', count: '3～6' } : fl.length ? {} : { count: '10～15', focus: [p.sub ? `这条是 ${myName()} 匿名投的稿，营销号替 TA 发出来；网友不知道是谁投的。` : '', atNote(p.text)].filter(Boolean).join('') });
  };
  const more = jobBtn('thread:' + p.id, () => [(p.floors || []).length ? '再来一些' : '出' + word('forum.act.comment')], ask, 'button.as-btn.as-btn--secondary.as-fo-morebtn');
  const stat = (k, n, on) => h('button.as-fo-stat__item' + (on ? '.is-on' : ''), W(k), h('span', E.fmt(n)));
  const onlyOp = h('button.as-fo-sort__op', { onclick: () => { floors.classList.toggle('is-op-only'); onlyOp.classList.toggle('is-on'); } }, W('forum.only.op'));
  floors.addEventListener('click', e => { const el = e.target.closest('.as-fo-floor'); if (!el || e.target.closest('button, .as-fo-floor__ava')) return; replySheet(p, el.dataset.id, floors); });
  pg.body.append(card(p, true), h('div.as-fo-stat', stat('forum.act.repost', p.reposts), stat('forum.act.comment', p.cmts, true), stat('forum.act.like', p.likes), stat('forum.act.fav', 0)),
    h('div.as-fo-sort', W('forum.all.reply', 'span.as-fo-sort__all'), onlyOp), floors, more);
  pg.el.append(h('div.as-fo-dock', accChip(), h('button.as-fo-dock__pill', { onclick: () => replySheet(p, '', floors) }, W('forum.reply.ph')),
    act('repost', p.reposts), act('comment', p.cmts, () => replySheet(p, '', floors)), likeBtn(p)));
  views.set(p.id, { el: pg.el, add: list => { const n = p.floors.length - list.length; floors.append(...list.map((f, i) => floorEl(p, f, n + i))); } });
  nav.push(pg.el); applyTexts();
}

/* ---------- 主页：右上角「…」装扮（穿套装、单独换一样）；穿了套装主页换成装扮的样子（.is-dressed） ---------- */
// 背景图看得见的那块的下沿是什么颜色（调浅一点）：图下面那层渐变就用它，像真微博那样接上
const tints = new Map();
const tintOf = u => tints.get(u) || tints.set(u, new Promise(ok => {
  const i = new Image();
  i.onload = () => {
    const vh = Math.min(i.height, i.width / 1.83), y1 = (i.height + vh) / 2, c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = c.height = 1; g.drawImage(i, 0, y1 - vh * .2, i.width, vh * .2, 0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data, k = v => Math.round(v + (255 - v) * .45);
    ok(`rgb(${k(r)}, ${k(gg)}, ${k(b)})`);
  };
  i.onerror = () => ok(''); i.src = u;
})).get(u);
const same = (a, b) => !a.anon && a.k === b.k && (a.id ? a.id === b.id : a.name === b.name);
function openUser(by) {
  const pg = page({ app: 'forum', id: 'forum-user', title: E.who(by).name, back: true, right: [navBtn('more', '装扮', () => v.decorate())] });
  const v = userView(by, pg.el);
  pg.body.append(...v.els); pg.el.append(v.ubar);
  pg.body.addEventListener('scroll', () => pg.el.classList.toggle('is-up', pg.body.scrollTop > 200), { passive: true });   // 背景图翻上去了：顶栏变白、显示名字
  nav.push(pg.el); applyTexts();
}
/** 主页底栏「推荐」：论坛里出现过的别的人，横着一排，可以直接关注；不找 AI */
async function recommend(by) {
  const k0 = keyOf(by), seen = new Set([k0]), out = [];
  const add = b => { const k = keyOf(b); if (seen.has(k) || b.anon || b.k === 'me') return; seen.add(k); out.push(b); };
  E.F().bots.forEach(x => add({ k: 'bot', id: x.id })); E.onForum().forEach(c => add({ k: 'c', id: c.id }));
  (await E.load()).posts.forEach(p => add(p.by));
  const pick = out.sort((a, b) => hash(k0 + keyOf(a)) - hash(k0 + keyOf(b))).slice(0, 8);
  if (!pick.length) { toast('还没有别人'); return; }
  const s = sheet({ title: `关注 ${E.who(by).name} 的人也关注了`, content: h('div.as-fo-recs', pick.map(x => h('div.as-fo-rec', { onclick: () => { s.close(); openUser(x); } },
    ava(x, 56, true), h('b.as-fo-rec__name', E.who(x).name), followBtn(x)))) });
  applyTexts();
}
/** 一个人的主页：host 是放它的那一页（穿了套装加 .is-dressed、大图铺在上面） */
function userView(by, host) {
  const w = E.who(by), key = keyOf(by), b = by.k === 'bot' && E.botOf(by.id), mine = by.k === 'me';
  const decorate = () => dressMenu(key, paint);
  // 点背景图：整张大图铺满看
  const cover = h('div.as-fo-user__cover', { onclick: () => { const u = dressOf(key).cover; if (u) { const v = h('div.as-fo-viewer', { onclick: () => v.remove() }, h('img', { src: u, alt: '' })); host.append(v); } } }, h('img.as-fo-user__coverimg', { alt: '', hidden: true }));
  const avaBox = h('span.as-fo-user__ava'), sticker = h('img.as-fo-user__tabimg', { alt: '' });
  // 微博 / 相册：点哪个，标签小图就跳到哪个；相册只是把没配图的帖子藏起来，不重画
  const tabOf = (txt, pics) => h('span', { onclick: e => { const t = e.currentTarget; if (t.classList.contains('is-on')) return;
    tabs.querySelector('.is-on')?.classList.remove('is-on'); t.classList.add('is-on'); t.prepend(sticker); sticker.classList.remove('is-hop'); void sticker.offsetWidth; sticker.classList.add('is-hop');
    list.classList.toggle('is-pics', pics); } }, txt);
  const tab = tabOf(W('forum.user.tab'), false); tab.classList.add('is-on'); tab.prepend(sticker);
  // 主页的数照真微博多留一位小数（32.3万、1.04亿）
  const n = (v, k) => h('span.as-fo-user__num', h('b', v >= 1e8 ? +(v / 1e8).toFixed(2) + '亿' : v >= 1e4 ? +(v / 1e4).toFixed(1) + '万' : String(v)), W(k));
  // 橙色小字（真微博数字下面那一两条）：我自己写的；别人的随手编一两条，同一个人每次一样
  const tagsOf = () => {
    const r = i => (seed >> i) % 9 + 1;
    const all = [`昨日发博${r(2)}，阅读数${['1万+', '5万+', '10万+', '100万+'][seed % 4]}，互动数${r(3) * 137 + seed % 97}`, `视频累计播放量${r(4)}.${r(5)}万`, `${b ? b.topic : '生活'}领域 互动数飙升`];
    const t = acc ? [acc.tag1, acc.tag2].filter(Boolean) : [...new Set([all[seed % 3], all[(seed >> 4) % 3]])];
    return t.length ? h('div.as-fo-user__tags', t.slice(0, 2).map(x => h('span', x)), icon('down', 16, 1.6)) : null;
  };
  const seed = hash(key), fans = b ? b.fans : mine ? 0 : 50 + seed % 5000;
  const list = h('div.as-fo-list');
  const more = mine ? null : jobBtn('more:' + key, () => ['看看 TA 还发了什么'], () => go('more:' + key, '正在刷新…', s => E.feed(b ? 'global' : 'local', {
    count: 3, only: by.k === 'bot' ? ['b:' + by.id] : by.k === 'c' ? ['c:' + by.id] : [], pick: `只由「${w.name}」发，${by.k === 'n' ? '这是一个普通网友，' : ''}写 TA 最近会发的` }, s)).then(got => { if (got) { landed(got); toast('刷到了'); } }),
  'button.as-btn.as-btn--secondary.as-fo-morebtn');
  const sub = b && h('button', { onclick: () => {
    const t = textarea({ placeholder: '投稿内容', rows: 5 });
    const s = sheet({ title: '投稿给「' + b.name + '」', content: h('div.as-fo-compose', t, h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('投稿', 'primary', async () => {
      const text = t.value.trim(); if (!text) { toast('写点什么'); return; }
      s.close(); const p = await E.submit(b, text); landed([p]);
      openPost(p);
    }))) });
  } });
  const bi = (ic, label, onclick) => h('button.as-fo-ubar__item', { onclick }, icon(ic, 20, 1.8), label);
  // 关注了再点：问一下再取消
  const fol = !mine && bi('user', W(following(key) ? 'forum.followed' : 'forum.follow'), async () => {
    if (following(key) && !await actionSheet(w.name, [{ value: 'off', label: '取消关注', icon: 'close' }])) return;
    toggleFollow(key); fol.lastChild.replaceWith(W(following(key) ? 'forum.followed' : 'forum.follow')); applyTexts();
  });
  const ubar = h('div.as-fo-ubar', mine ? bi('palette', h('span', '装扮'), decorate)
    : [sub ? bi('edit', h('span', '投稿'), () => sub.click()) : bi('chat', W('forum.dm'), () => toast('私信下一步做')), bi('users', h('span', '推荐'), () => recommend(by)), fol]);
  // 只改图和几个开关，不重画整页
  function paint() {
    const dr = dressOf(key), img = (el, u) => { el.hidden = !u; if (u) el.src = u; };
    host.classList.toggle('is-dressed', dressed(key));
    cover.style.backgroundImage = dr.cover ? `url("${dr.cover}")` : ''; cover.classList.toggle('has-img', !!dr.cover); img(cover.firstChild, dr.cover);
    host.classList.toggle('no-fade', !fade(key));
    if (dr.cover) tintOf(dr.cover).then(t => host.style.setProperty('--fo-tint', t)); else host.style.removeProperty('--fo-tint');
    const wv = E.who(by).v; avaBox.replaceChildren(ava(by, 80, true), wv ? h('i.as-fo-post__badge.is-' + wv) : null);
    img(sticker, dr.tab);
    tabs.style.setProperty('--fo-tabline', dr.tabline ? `url("${dr.tabline}")` : ''); tabs.classList.toggle('has-line', !!dr.tabline);
    ubar.style.backgroundImage = dr.bar ? `url("${dr.bar}")` : ''; ubar.classList.toggle('has-img', !!dr.bar);
    ubar.querySelectorAll('.as-fo-ubar__item').forEach((x, i) => { const u = dr[['btn', 'btn2', 'btn3'][i]]; x.classList.toggle('has-pic', !!u); x.style.setProperty('--fo-btnimg', u ? `url("${u}")` : ''); });
  }
  const tabs = h('div.as-fo-user__tabs', tab, tabOf('相册', true)), acc = mine && E.accOf(by.id);
  // 上面这块（头像、名字、V、认证、简介、橙色小字、数字）：改了资料只把这一块换掉
  const mainOf = () => { const w = E.who(by); return h('div.as-fo-user__main', avaBox, h('div.as-fo-user__name', h('span', w.name), w.v ? vMark() : null),
    w.v ? h('div.as-fo-user__cert', icon('shield', 16, 1.7), b ? b.topic : acc ? acc.cert || '已认证' : ['生活', '美食', '情感', '摄影', '旅行', '游戏', '穿搭', '读书'][seed % 8] + '博主') : null,
    h('div.as-fo-user__bio', b ? b.bio : acc ? acc.bio || '' : ''), tagsOf(),
    h('div.as-fo-user__nums', n(acc?.fans ?? fans, 'forum.fans'), n(acc?.follows ?? (mine ? (state.forum.follows || []).length : 20 + seed % 400), 'forum.follows'), n(acc?.likes ?? (b ? b.fans * 7 : 100 + seed % 90000), 'forum.likes'))); };
  let main = mainOf();
  const refresh = () => { const m = mainOf(); main.replaceWith(m); main = m; paint(); applyTexts(); };
  const els = [h('div.as-fo-user', cover, main),
    tabs, more, list].filter(Boolean);
  paint();
  E.load().then(d => { list.append(...d.posts.filter(p => same(p.by, by)).map(p => card(p))); applyTexts(); });
  lists.add({ el: list, match: p => same(p.by, by) });
  return { els, ubar, paint, decorate, refresh };
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
const CC = { cn: 'zh-CN', tw: 'zh-TW', hk: 'zh-TW', mo: 'zh-TW', jp: 'ja', kr: 'ko', fr: 'fr', be: 'fr', de: 'de', at: 'de', es: 'es', mx: 'es', ar: 'es', co: 'es', ru: 'ru', it: 'it', pt: 'pt', br: 'pt',
  th: 'th', vn: 'vi', us: 'en', gb: 'en', au: 'en', ca: 'en', nz: 'en', ie: 'en', sg: 'en' };   // 国家 → 那里平时说的话
function openSettings() {
  const F = E.F(), A = E.A();
  const pg = page({ app: 'forum', id: 'forum-settings', title: '设置', back: true });
  const where = () => F.region ? `${F.region} · ${langName(F.lang || 'zh-CN')}` : '按正文定';
  // 地区在地图上选（搜地名地图就移过去）；语言按那个国家平时说的话，不在列表里的再问
  const region = item({ title: '地区', value: where(), chevron: true, onClick: async () => {
    const r = await (await import('../../core/mappick.js')).pickPlace('地区'); if (!r) return;
    const l = !r.name ? '' : CC[r.cc] || await actionSheet('那里说什么语言', LANGS.map(([v, t]) => ({ value: v, label: t, active: v === F.lang })));
    if (l == null) return;
    F.region = r.name; F.lang = l; commit('forum');
    region.querySelector('.as-list-item__value').textContent = where();
  } });
  pg.body.append(h('div.as-fo-set', group('', [item({ icon: 'user', title: '我的号', chevron: true, onClick: openAccounts }), item({ icon: 'star', color: 'orange', title: '营销号', chevron: true, onClick: openBots }),
    item({ icon: 'users', color: 'green', title: '熟人', chevron: true, onClick: openPeople })]),
    group('', [region]),
    group('显示', [field('外语', segmented([['both', '上下对照'], ['tap', '点了才显示']], A.tr, v => { A.tr = v; commit('apps'); phone().dataset.forumTr = v; }))]),
    group('刷新', [field('一次刷几条', segmented([4, 6, 8, 10].map(n => [n, String(n)]), A.count || 6, v => { A.count = v; commit('apps'); }))])));
  nav.push(pg.el);
}
function openAccounts() {
  const F = E.F(), pg = page({ app: 'forum', id: 'forum-accounts', title: '我的号', back: true }), box = h('div.as-fo-set');
  const draw = () => box.replaceChildren(group('', [...F.accounts.map(a => item({ title: E.accName(a) + (a.id === 'main' ? '（大号）' : ''), right: a.id === F.cur ? icon('check', 18, 2.2) : null,
    onClick: async () => {
      const v = await actionSheet(E.accName(a), [{ value: 'use', label: '用这个号', icon: 'check' }, { value: 'edit', label: '编辑', icon: 'edit' }, a.id !== 'main' && { value: 'del', label: '删除', icon: 'trash', danger: true }].filter(Boolean));
      if (v === 'use') { F.cur = a.id; commit('forum'); draw(); document.querySelectorAll('.as-fo-acc').forEach(b => b.replaceWith(accChip())); R?.meSwitch?.(); }
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
function accFields(d) {
  const name = input({ value: d.name, placeholder: '网名' }), bio = input({ value: d.bio, placeholder: '简介' });
  // 粉丝 / 关注 / 转评赞：能写「3.3万」「1.04亿」，空着就照原来的算
  const num = (k, ph) => input({ value: d[k] == null ? '' : d[k] >= 1e8 ? d[k] / 1e8 + '亿' : d[k] >= 1e4 ? d[k] / 1e4 + '万' : String(d[k]), placeholder: ph, inputmode: 'decimal' }), nums = [['fans', '粉丝'], ['follows', '关注'], ['likes', '转评赞']].map(([k, ph]) => [k, num(k, ph)]);
  const cert = input({ value: d.cert || '', placeholder: '认证' }), t1 = input({ value: d.tag1 || '', placeholder: '第一条' }), t2 = input({ value: d.tag2 || '', placeholder: '第二条' });
  return { rows: [avaPick(() => d.avatar, u => { d.avatar = u; }, d.name || '号'), field('网名', name), field('简介', bio),
    field('加 V', segmented([['', '不加'], ['y', '黄 V'], ['b', '蓝 V（官方）'], ['r', '橙 V']], d.v || '', v => { d.v = v; })), field('认证', cert), field('粉丝 · 关注 · 转评赞', h('div.as-fo-tagin.is-3', ...nums.map(x => x[1]))), field('主页橙色小字', h('div.as-fo-tagin', t1, t2))],
  read: () => { d.name = name.value.trim().slice(0, 20); d.bio = bio.value.trim().slice(0, 60); d.cert = cert.value.trim().slice(0, 30); d.tag1 = t1.value.trim().slice(0, 24); d.tag2 = t2.value.trim().slice(0, 24);
    for (const [k, el] of nums) { const m = /^([\d.]+)\s*(万|亿|w|W)?$/.exec(el.value.trim()); if (m) d[k] = Math.round(m[1] * ({ 万: 1e4, w: 1e4, W: 1e4, 亿: 1e8 }[m[2]] || 1)); else delete d[k]; } } };
}
const accSaved = () => { commit('forum'); document.querySelectorAll('.as-fo-acc').forEach(b => b.replaceWith(accChip())); R?.meRefresh?.(); };
function editAcc(a, done) {
  const d = a ? { ...a } : { id: 'a' + Date.now().toString(36), name: '', bio: '', avatar: '' }, f = accFields(d);
  editSheet(a ? '编辑' : '新建小号', f.rows, () => {
    f.read();
    if (!a && !d.name) { toast('起个网名'); return false; }
    if (a) Object.assign(a, d); else E.F().accounts.push(d);
    accSaved(); done();
  });
}
/** 「我」右上的编辑主页：资料和装扮放一页；资料点保存才算，装扮点了就换上 */
function openEditMe() {
  const a = E.curAcc(), d = { ...a }, f = accFields(d);
  const pg = page({ app: 'forum', id: 'forum-editme', title: '编辑主页', back: true });
  pg.body.append(h('div.as-fo-set', group('资料', [h('div.as-fo-compose', ...f.rows)]), setTiles(),
    group('', [item({ icon: 'image', title: '单独换一样', chevron: true, onClick: () => dressMenu('me:' + a.id, () => R?.mePaint?.()) })]),
    h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', () => { f.read(); Object.assign(a, d); accSaved(); nav.pop(); toast('已保存'); }))));
  nav.push(pg.el);
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
  const VS = [['', '不加'], ['y', '黄 V'], ['b', '蓝 V'], ['r', '橙 V']], label = c => P(c.id).off ? '不上论坛' : (VS.find(x => x[0] === E.isV(c)) || VS[0])[1].replace('不加', '');
  pg.body.append(h('div.as-fo-set', state.contacts.length ? group('', state.contacts.map(c => {
    const row = item({ icon: avatar(c.avatar, nameOf(c), 28), color: 'transparent', title: nameOf(c), value: label(c), chevron: true, onClick: () => {
      const d = { ...P(c.id) }, nick = input({ value: d.name || '', placeholder: '网名' });
      editSheet(nameOf(c), [toggleItem({ title: '上论坛' }, !d.off, v => { d.off = !v; }), field('加 V', segmented(VS, E.isV(c), v => { d.v = v; })), field('网名', nick)], () => {
        d.name = nick.value.trim().slice(0, 20); Object.assign(P(c.id), d); commit('forum'); row.querySelector('.as-list-item__value').textContent = label(c);
      });
    } });
    return row;
  })) : empty('还没有联系人')));
  nav.push(pg.el);
}
