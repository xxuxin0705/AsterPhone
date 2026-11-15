// 论坛的样子：自带三套（微博 / 豆瓣 / 推特）+ 自己导入、复制改出来的。
// 一套样子 = 布局（底部几个标签、首页几个信息流、发现 / 小组页放哪些积木）+ 叫法 + CSS + 图片；不能写脚本。
// 自带的也是这样一套（CSS 在 looks/名字.css），和用户的走同一条路。只有正在用的那套 CSS 放进页面，所以 CSS 不用按样子名区分
import { h, uid, pickFile, fileToDataURL } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { textOf } from '../../core/skin.js';
import { log } from '../../core/log.js';
import { page, group, item, input, textarea, field, btn, toast, actionSheet, dialog, icon, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';

export const PAGES = ['home', 'feed', 'discover', 'groups', 'inbox', 'me'], FEEDS = ['global', 'follow', 'local', 'anon', 'all'], BLOCKS = ['search', 'hot', 'boards', 'chips'], INBOX = ['activity', 'notice', 'dm'];
// 没写的叫法都用这些
const WORDS = {
  'forum.tab.follow': '关注', 'forum.tab.local': '本地', 'forum.tab.global': '全球', 'forum.tab.anon': '匿名区', 'forum.group': '小组',
  'forum.hot': '热榜', 'forum.hot.title': '热榜', 'forum.hot.more': '更多', 'forum.boards': '小组', 'forum.discuss': '正在讨论', 'forum.search.ph': '搜索',
  'forum.act.repost': '转发', 'forum.act.comment': '评论', 'forum.act.like': '赞', 'forum.act.fav': '收藏', 'forum.reply.ph': '写评论',
  'forum.post.new': '发帖', 'forum.follow': '关注', 'forum.followed': '已关注', 'forum.join': '加入', 'forum.joined': '已加入', 'forum.op': '楼主',
  'forum.floor': '{n} 楼', 'forum.only.op': '只看楼主', 'forum.all.reply': '全部', 'forum.inbox.notice': '提醒', 'forum.inbox.dm': '私信', 'forum.inbox.activity': '动态', 'forum.chips.all': '全部',
  'forum.inbox.cmts': '评论', 'forum.inbox.likes': '赞', 'forum.dyn.post': '发帖了', 'forum.dyn.in': '在 {g} 发帖了', 'forum.cmt.post': '评论了你的帖子', 'forum.cmt.reply': '回复了你的评论',
  'forum.like.post': '赞了你的帖子', 'forum.like.cmt': '赞了你的评论', 'forum.bio': '简介：',
  'forum.fans': '粉丝', 'forum.follows': '关注', 'forum.likes': '获赞', 'forum.members': '成员', 'forum.user.tab': '帖子', 'forum.dm': '私信', 'forum.platform': '论坛', 'forum.title.need': '',
};
export const BUILTIN = {
  weibo: { name: '微博', swatch: ['#f2f2f2', '#ff8200'],
    layout: { tabs: [{ page: 'home', text: '首页', icon: 'home' }, { page: 'feed', feed: 'anon', text: '树洞', icon: 'tree' }, { page: 'discover', text: '发现', icon: 'search' }, { page: 'inbox', text: '消息', icon: 'mail' }, { page: 'me', text: '我', icon: 'user' }],
      home: [{ feed: 'global', text: '推荐' }, { feed: 'follow', text: '关注' }], discover: ['search', 'hot', 'chips'], groups: ['boards', 'chips'],
      inbox: ['activity', 'notice'], icons: { repost: 'share', comment: 'comment', like: 'thumb' } },
    texts: { 'forum.tab.local': '同城', 'forum.tab.global': '热门', 'forum.tab.anon': '树洞', 'forum.group': '超话', 'forum.hot': '微博热搜', 'forum.hot.title': '微博热搜', 'forum.hot.more': '更多热搜',
      'forum.boards': '超话社区', 'forum.search.ph': '大家都在搜', 'forum.reply.ph': '写评论…', 'forum.post.new': '发微博', 'forum.floor': '第{n}楼', 'forum.inbox.notice': '消息', 'forum.chips.all': '热点', 'forum.dyn.post': '发微博了', 'forum.cmt.post': '评论了你的微博', 'forum.like.post': '赞了你的微博',
      'forum.likes': '转评赞', 'forum.user.tab': '微博', 'forum.platform': '微博', 'forum.title.need': 'no', 'forum.dm': '留言', 'forum.join': '加入', 'forum.joined': '已加入' } },
  douban: { name: '豆瓣', swatch: ['#ffffff', '#2c9a4b'],
    layout: { tabs: [{ page: 'home', text: '首页', icon: 'home' }, { page: 'groups', text: '小组', icon: 'users' }, { page: 'inbox', text: '消息', icon: 'chat' }, { page: 'me', text: '我', icon: 'user' }],
      home: [{ feed: 'follow', text: '动态' }, { feed: 'all', text: '推荐' }], discover: ['search', 'hot', 'boards'], groups: ['boards', 'chips'] },
    texts: { 'forum.tab.local': '本地小组', 'forum.tab.global': '广场', 'forum.tab.anon': '匿名小组', 'forum.group': '小组', 'forum.hot': '热门话题', 'forum.hot.title': '热门话题',
      'forum.boards': '我的小组', 'forum.search.ph': '搜索小组 话题 用户', 'forum.act.comment': '回复', 'forum.reply.ph': '写回复', 'forum.floor': '{n}楼', 'forum.fans': '被关注',
      'forum.inbox.notice': '提醒', 'forum.members': '位成员', 'forum.user.tab': '发布的', 'forum.platform': '豆瓣小组', 'forum.title.need': 'yes', 'forum.join': '+ 加入', 'forum.joined': '已加入', 'forum.followed': '已关注' } },
  twitter: { name: '推特', swatch: ['#ffffff', '#1d9bf0'],
    layout: { tabs: [{ page: 'home', text: '首页', icon: 'home' }, { page: 'discover', text: '探索', icon: 'search' }, { page: 'inbox', text: '通知', icon: 'bell' }, { page: 'me', text: '我', icon: 'user' }],
      home: [{ feed: 'global', text: '为你推荐' }, { feed: 'follow', text: '正在关注' }], discover: ['search', 'hot', 'boards'], groups: ['boards', 'chips'],
      icons: { repost: 'repeat', comment: 'comment', like: 'heart' } },
    texts: { 'forum.tab.follow': '正在关注', 'forum.tab.local': '附近', 'forum.tab.global': '为你推荐', 'forum.tab.anon': '匿名投稿', 'forum.group': '社群', 'forum.hot': '趋势', 'forum.hot.title': '趋势',
      'forum.hot.more': '显示更多', 'forum.boards': '社群', 'forum.search.ph': '搜索', 'forum.act.repost': '转帖', 'forum.act.comment': '回复', 'forum.act.like': '喜欢', 'forum.act.fav': '书签',
      'forum.reply.ph': '发布你的回复', 'forum.post.new': '发帖', 'forum.followed': '正在关注', 'forum.floor': '', 'forum.fans': '关注者', 'forum.follows': '正在关注', 'forum.likes': '喜欢',
      'forum.user.tab': '帖子', 'forum.platform': '推特', 'forum.title.need': 'no', 'forum.inbox.notice': '全部', 'forum.join': '加入', 'forum.joined': '已加入' } },
};
const A = () => state.apps.forum;
export const looks = () => A().looks;
export const lookOf = id => (BUILTIN[id] ? { id, builtin: true, ...BUILTIN[id] } : looks().find(x => x.id === id));
export const look = () => lookOf(A().skin) || lookOf('weibo');
export const defWord = k => (look().texts || {})[k] ?? WORDS[k] ?? '';
export const word = k => textOf(k, defWord(k));

/* ---------- 放进页面：只放正在用的那套 ---------- */
const cssCache = {};
const cssOf = async L => L.builtin ? (cssCache[L.id] ??= await fetch(`apps/forum/looks/${L.id}.css`).then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
  .catch(e => { log('warn', '论坛', `读不到样子「${L.name}」：${e.message}`); return ''; })) : L.css || '';
export async function applyLook() {
  const L = look(), el = document.getElementById('as-forum-look') || document.body.appendChild(h('style', { id: 'as-forum-look' }));
  const css = await cssOf(L), imgs = Object.entries(L.imgs || {}).map(([k, v]) => `--fo-img-${k}:url("${v}");`).join('');
  el.textContent = (imgs ? `[data-as-app="forum"]{${imgs}}\n` : '') + css;
  document.querySelector('#phone').dataset.forumSkin = L.id;
}

/* ---------- 导入的样子：只收认得的 ---------- */
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export function cleanLook(d, keepId) {
  if (!d || d.asterphone !== 'forumLook' || !d.layout) return null;
  const L = d.layout, tabs = (Array.isArray(L.tabs) ? L.tabs : []).filter(t => t && PAGES.includes(t.page) && (t.page !== 'feed' || FEEDS.includes(t.feed))).slice(0, 5)
    .map(t => ({ page: t.page, ...(t.page === 'feed' ? { feed: t.feed } : {}), text: str(t.text, 6), icon: str(t.icon, 30) }));
  for (const [pg, text, ic] of [['home', '首页', 'home'], ['me', '我', 'user']]) if (!tabs.some(t => t.page === pg)) tabs[pg === 'home' ? 'unshift' : 'push']({ page: pg, text, icon: ic });
  const home = (Array.isArray(L.home) ? L.home : []).filter(x => x && FEEDS.includes(x.feed)).slice(0, 4).map(x => ({ feed: x.feed, text: str(x.text, 8) }));
  const blocks = v => (Array.isArray(v) ? v.filter(b => BLOCKS.includes(b)) : []);
  return { id: keepId || uid('fl'), name: str(d.name, 20) || '我的样子', swatch: (Array.isArray(d.swatch) ? d.swatch : []).slice(0, 2).map(x => str(x, 30)),
    layout: { tabs, home: home.length ? home : [{ feed: 'global', text: '推荐' }], discover: blocks(L.discover), groups: blocks(L.groups),
      inbox: (Array.isArray(L.inbox) ? L.inbox : []).filter(k => INBOX.includes(k)), icons: Object.fromEntries(['repost', 'comment', 'like'].filter(k => L.icons?.[k]).map(k => [k, str(L.icons[k], 30)])) },
    texts: Object.fromEntries(Object.entries(d.texts || {}).filter(([k, v]) => /^forum\./.test(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 40)])),
    css: str(d.css, 400000), imgs: Object.fromEntries(Object.entries(d.imgs || {}).filter(([k, v]) => /^[\w-]{1,30}$/.test(k) && /^data:image\//.test(str(v, 3e6))).map(([k, v]) => [k, v])) };
}
const packOf = async L => ({ asterphone: 'forumLook', v: 1, name: L.name, swatch: L.swatch, layout: L.layout, texts: L.texts, css: await cssOf(L), imgs: L.imgs || {} });
function download(data, name) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: `AsterPhone-论坛样子-${name}.json` });
  document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
}
function use(id) { A().skin = id; commit('apps'); applyLook(); }

/* ---------- 资源库 → 应用 → 论坛：样子卡片，点一下换（只换勾）；导入；「…」复制 / 编辑 / 导出 / 删除 ---------- */
export function lookTiles() {
  const box = h('div');
  const draw = () => {
    const tile = L => h('button' + (L.id === look().id ? '.is-on' : ''), { dataset: { k: L.id }, 'aria-label': L.name, onclick: () => {
      use(L.id); box.querySelectorAll('.as-lib-chatskins > button').forEach(b => b.classList.toggle('is-on', b.dataset.k === L.id));
    } }, h('span.as-lib-chatskins__mock.as-fo-looktile', { style: { background: (L.swatch || [])[0] || '#fff' } }, h('i', { style: { background: (L.swatch || [])[1] || '#999' } }), h('i'), h('i')),
    h('em', L.name), h('span.as-fo-looktile__more', { role: 'button', 'aria-label': L.name + '更多', onclick: e => { e.stopPropagation(); menu(L); } }, icon('more', 16, 2.4)));
    box.replaceChildren(group('论坛样子', [h('div.as-lib-chatskins', ...Object.keys(BUILTIN).map(lookOf).map(tile), ...looks().map(tile))]),
      h('div.as-lib-actions', btn('导入样子', 'secondary', importLook)));
  };
  async function menu(L) {
    const v = await actionSheet(L.name, [{ value: 'copy', label: '复制一份来改', icon: 'note' }, !L.builtin && { value: 'edit', label: '编辑', icon: 'edit' },
      { value: 'out', label: '导出', icon: 'box' }, !L.builtin && { value: 'del', label: '删除', icon: 'trash', danger: true }].filter(Boolean));
    if (v === 'copy') { const n = cleanLook(await packOf(L)); n.name = (L.name + ' 副本').slice(0, 20); looks().push(n); commit('apps'); draw(); editLook(n, draw); }
    if (v === 'edit') editLook(L, draw);
    if (v === 'out') download(await packOf(L), L.name);
    if (v === 'del' && await dialog({ title: `删除「${L.name}」？`, confirm: '删除', danger: true })) {
      looks().splice(looks().indexOf(L), 1); if (A().skin === L.id) use('weibo'); else commit('apps'); draw();
    }
  }
  async function importLook() {
    const f = await pickFile('*/*'); if (!f) return;
    let d = null; try { d = JSON.parse(await f.text()); } catch (e) { /* 下面统一说 */ }
    const L = cleanLook(d); if (!L) { toast('这不是 AsterPhone 的论坛样子'); return; }
    looks().push(L); use(L.id); draw(); toast(`导入了「${L.name}」，已经用上`);
  }
  draw();
  return box;
}
/** 编辑样子：名字、CSS、布局、叫法、图片。保存时照导入的规矩再检查一遍 */
function editLook(L, done) {
  const p = page({ app: 'library', id: 'library-forum-look', title: L.name, back: true });
  const name = input({ value: L.name, placeholder: '名字' }), css = textarea({ value: L.css, rows: 14, placeholder: 'CSS' });
  const lay = textarea({ value: JSON.stringify(L.layout, null, 1), rows: 10, placeholder: '布局' }), tx = textarea({ value: JSON.stringify(L.texts, null, 1), rows: 8, placeholder: '叫法' });
  [css, lay, tx].forEach(t => t.classList.add('as-settings-prompt-text'));
  const imgs = { ...(L.imgs || {}) }, imgBox = h('div');
  const drawImgs = () => imgBox.replaceChildren(group(withInfo('图片', 'CSS 里写 var(--fo-img-名字) 就是这张图；底部标签的图标写 img:名字。'), [...Object.keys(imgs).map(k => item({ title: k, right: h('img.as-fo-lookimg', { src: imgs[k], alt: '' }), onClick: async () => {
    const v = await actionSheet(k, [{ value: 'pick', label: '换一张', icon: 'image' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
    if (v === 'pick') { const f = await pickFile('image/*'); if (f) { imgs[k] = await fileToDataURL(f, 1600, 'image/png'); drawImgs(); } }
    if (v === 'del') { delete imgs[k]; drawImgs(); }
  } })), item({ icon: 'plus', title: '加一张', onClick: async () => {
    const k = ((await dialog({ title: '图片的名字', input: { placeholder: '字母或数字' } })) || '').trim(); if (!/^[\w-]{1,30}$/.test(k)) { if (k) toast('名字只能用字母、数字、- 和 _'); return; }
    const f = await pickFile('image/*'); if (f) { imgs[k] = await fileToDataURL(f, 1600, 'image/png'); drawImgs(); }
  } })]));
  drawImgs();
  p.body.append(group('', [field('名字', name)]), group('CSS', [css]), group(withInfo('布局', 'tabs：底部标签（page 从 home / feed / discover / groups / inbox / me 里挑，选 feed 要再写 feed）；home：首页顶上的几个信息流（feed 从 global / follow / local / anon / all 里挑）；discover、groups：这一页放哪些积木（search / hot / boards / chips）；inbox：消息页分几栏（activity / notice / dm）；icons：转发、评论、赞用哪个图标。'), [lay]),
    group(withInfo('叫法', '每个地方叫什么，编号都以 forum. 开头；forum.platform 会告诉 AI 像哪个平台说话。'), [tx]), imgBox,
    h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', () => {
      let layout, texts; try { layout = JSON.parse(lay.value); texts = JSON.parse(tx.value); } catch (e) { toast('布局或叫法写错了：' + e.message); return; }
      const n = cleanLook({ asterphone: 'forumLook', name: name.value.trim(), swatch: L.swatch, layout, texts, css: css.value, imgs }, L.id);
      Object.assign(L, n); commit('apps'); if (A().skin === L.id) applyLook(); toast('已保存'); nav.pop(); done();
    })));
  nav.push(p.el);
}
