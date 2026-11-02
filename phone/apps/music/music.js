// 音乐 App 外壳：底部四个标签（首页 / 搜索 / 笔记 / 我的）+ 浮着的迷你播放条；歌单页；播放页（唱片皮肤）。
// 样子照网易云，不跟手机主题走（颜色字体都在 music.css 里定死）。播放本体在 core/music.js，关掉这个 App 也接着放。
// 整个 App 只有两处会找 AI：角色歌单右上角的「AI 挑歌」、笔记里的「生成乐评」，都是手动点的。
import { h, onLongPress, pickFile } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, field, input, btn, icon, navBtn, navText, actionSheet, dialog, toast, empty, sheet, pickImage, avatar, switchEl } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { log } from '../../core/log.js';
import { myNick, myAvatar } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import { renderNotes, addNote, openNote } from './notes.js';
import { pickMany } from '../chat/people.js';
import { rain, isNight } from './rain.js';

const M = () => state.music;
const fmt = s => isFinite(s) && s > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '00:00';
const bgUrl = pic => pic ? `url("${pic}")` : '';
const firstPic = L => ((L || []).find(s => s.pic) || {}).pic || '';
const play = (list, i, from) => { P.playList(list, i, from); openPlayer(); };
P.onMusic(w => { if (w === 'blocked') toast('点一下播放键开始放'); if (w === 'error') toast(`《${(P.current() || {}).name || ''}》放不出来，跳下一首`); });

/* ================= 外壳：四个标签 ================= */
const TABS = [['home', '首页', renderHome], ['search', '搜索', renderSearch], ['notes', '笔记', renderNotes], ['me', '我的', renderMe]];
let cur = null;
export function open() {
  const p = page({ app: 'music', id: 'music-home', back: true, cls: 'as-mu-root' });
  const titleEl = p.nav.querySelector('.as-navbar__title'), rightEl = p.nav.querySelector('.as-navbar__right');
  const tabs = h('nav.as-mu-tabs', { role: 'tablist' }, TABS.map(([id, label]) => h('button', { role: 'tab', dataset: { tab: id }, onclick: () => go(id) }, label)));
  const mini = miniBar(), meBg = h('div.as-mu-mebg');
  p.el.prepend(meBg);
  p.el.append(h('div.as-mu-dock', mini.el, tabs));
  p.el._onLeave = P.onMusic(() => mini.paint());
  const ctx = { body: p.body, el: p.el, title: titleEl, right: rightEl, meBg, go };
  cur = null; go('home');
  return p.el;

  function go(id) {
    if (cur === id) { p.body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    cur = id;
    [...tabs.children].forEach(b => b.classList.toggle('is-active', b.dataset.tab === id));
    p.el.dataset.asPage = 'music-' + id; p.el.dataset.tab = id; p.el.classList.toggle('is-dark', id === 'me');
    titleEl.replaceChildren(); rightEl.replaceChildren(); p.body.innerHTML = ''; p.body.scrollTop = 0; p.el._onShow = null;
    TABS.find(t => t[0] === id)[2](ctx);
  }
}
function miniBar() {
  const c = h('span.as-mu-mini__cover'), t = h('b'), a = h('span'), btn = h('button.as-mu-mini__btn', { 'aria-label': '播放 / 暂停', onclick: e => { e.stopPropagation(); P.toggle(); } });
  const el = h('div.as-mu-mini', { role: 'button', onclick: openPlayer }, c, h('div.as-mu-mini__title', t, a), btn,
    h('button.as-mu-mini__btn', { 'aria-label': '播放列表', onclick: e => { e.stopPropagation(); openQueue(); } }, icon('list', 24, 1.8)));
  const paint = () => {
    const s = P.current(); el.hidden = !s; if (!s) return;
    c.style.backgroundImage = bgUrl(s.pic); c.classList.toggle('is-playing', P.playing());
    t.textContent = s.name; a.textContent = ' - ' + s.artist; btn.replaceChildren(icon(P.playing() ? 'pause' : 'play', 13, 2.4));
  };
  paint();
  return { el, paint };
}
/** 横着滑的一排；数据没变就不重画（返回时不闪） */
function keep(box, sig, draw) { let last = ''; return () => { const k = sig(); if (k !== last) { last = k; box.replaceChildren(...draw()); } }; }

/* ================= 首页：顶上搜索框、排行榜四块、按语种和风格、最近播放、角色的歌单 ================= */
const RANK_COLORS = ['teal', 'blue', 'red', 'purple'];
const STYLES = ['日语', '韩语', '英语', '粤语', '二次元', '古风', '说唱', '小甜歌'];
function renderHome(ctx) {
  ctx.title.append(h('button.as-mu-search', { onclick: () => { ctx.go('search'); ctx.title.querySelector('input')?.focus(); } }, icon('search', 16, 2), h('span', '搜索歌曲、歌手、语种')));
  // 一行 4 个、最多两行，多的点「全部」看
  const recent = h('div'), chars = h('div');
  const paintRecent = keep(recent, () => M().recent.slice(0, 8).map(s => s.id).join(), () => M().recent.length ? [
    h('div.as-mu-h', '最近播放', h('button.as-mu-h__more', { onclick: () => openList('最近播放', M().recent) }, '全部')),
    h('div.as-mu-grid', M().recent.slice(0, 8).map((s, i) => songCard(s, () => play(M().recent, i, '最近播放'))))] : []);
  const paintChars = keep(chars, () => JSON.stringify(state.contacts.map(c => [c.id, nameOf(c), (c.songs || []).length, c.avatar])), () => state.contacts.length ? [
    h('div.as-mu-h', '角色的歌单', state.contacts.length > 8 ? h('button.as-mu-h__more', { onclick: openAllChars }, '全部') : null),
    h('div.as-mu-grid', state.contacts.slice(0, 8).map(charCard))] : []);
  paintRecent(); paintChars();
  ctx.body.append(
    h('div.as-mu-h', '排行榜'),
    h('div.as-mu-ranks', P.TOPLISTS.map(([id, name], i) => h('button.is-' + RANK_COLORS[i], { onclick: () => openRemote(name, id) }, h('b', name), h('span', '网易云音乐')))),
    h('div.as-mu-h', '按语种和风格'),
    h('div.as-mu-tags', STYLES.map(w => h('button', { onclick: () => { ctx.go('search'); ctx.find(w); } }, w))),
    recent, chars, h('div.as-mu-gap'));
  ctx.el._onShow = () => { paintRecent(); paintChars(); };
}
const songCard = (s, onclick, face) => h('button.as-mu-sq', { onclick }, h('span.as-mu-sq__cover', { style: { backgroundImage: bgUrl(s.pic) } }, face), h('b', s.name), h('span', s.sub || s.artist));
// 角色歌单的封面就是角色头像（没头像是名字的字）
const charCard = c => songCard({ name: `${nameOf(c)}的歌单`, sub: (c.songs || []).length ? `${c.songs.length} 首` : '还没有歌' }, () => openCharList(c), avatar(c.avatar, nameOf(c), 80, 'square'));
function openAllChars() {
  const p = page({ app: 'music', id: 'music-chars', title: '角色的歌单', back: true });
  p.body.append(h('div.as-mu-grid', state.contacts.map(charCard)));
  nav.push(p.el);
}
async function heartMode() {
  toast('正在开启心动模式…', true);
  try { const songs = await P.heartPick(); toast(`心动模式 · ${songs.length} 首`); play(songs, 0, '心动模式'); }
  catch (e) { log('error', '心动模式', e.message); toast(e.message); }
}
function openCharList(c) {
  const v = openList(`${nameOf(c)}的歌单`, c.songs || [], {
    right: [navBtn('sparkle', 'AI 挑歌', async e => {
      const b = e.currentTarget; b.disabled = true; toast(`${nameOf(c)}正在挑歌…`, true);
      try { const songs = await P.charPick(c, (n, all) => toast(`正在找歌 ${n} / ${all}`, true)); toast(`加了 ${songs.length} 首`); v.fill(c.songs); }
      catch (err) { log('error', '角色歌单', err.message); toast(err.message); }
      finally { b.disabled = false; }
    })],
    top: h('label.as-mu-opt', '随剧情加歌', switchEl(M().storySongs, on => { M().storySongs = on; commit('music'); commit('inject'); }, '随剧情加歌')),
    onRemove: s => { c.songs = c.songs.filter(x => x.id !== s.id); commit('contacts'); },
  });
}

/* ================= 搜索：搜索历史、试试这些（语种风格 + 常听的歌手） ================= */
function renderSearch(ctx) {
  const input = h('input', { placeholder: '搜索歌曲、歌手、语种', enterkeyhint: 'search', onkeydown: e => { if (e.key === 'Enter') find(input.value.trim()); } });
  ctx.title.append(h('label.as-mu-search', icon('search', 16, 2), input));
  const hist = h('div');
  const paintHist = () => hist.replaceChildren(...(M().history.length ? [
    h('div.as-mu-h', '搜索历史', h('button.as-mu-h__btn', { 'aria-label': '清空搜索历史', onclick: () => { M().history = []; commit('music'); paintHist(); } }, icon('trash', 18, 1.8))),
    h('div.as-mu-tags.is-gray', M().history.map(w => h('button', { onclick: () => find(w) }, w)))] : []));
  paintHist();
  // 喜欢的歌里出现最多的两位歌手接在后面，没有就补两个风格
  const count = {}; M().liked.forEach(s => { const a = s.artist.split(/[/、,，&]/)[0].trim(); if (a && !s.local) count[a] = (count[a] || 0) + 1; });
  const words = [...STYLES, '治愈', '伤感', ...Object.keys(count).sort((a, b) => count[b] - count[a]), '民谣', '摇滚'].slice(0, 12);
  ctx.body.append(hist, h('div.as-mu-h', '试试这些'), h('ol.as-mu-try', words.map((w, i) => h('li', { onclick: () => find(w) }, h('em', String(i + 1)), w))), h('div.as-mu-gap'));
  ctx.find = find;
  async function find(word) {
    if (!word) return;
    input.value = word; input.blur();
    M().history = [word, ...M().history.filter(x => x !== word)].slice(0, 10); commit('music'); paintHist();
    toast('正在搜…', true);
    try { const songs = await P.search(word); toast(songs.length ? `找到 ${songs.length} 首` : '没搜到'); if (songs.length) openList(`搜「${word}」`, songs); }
    catch (e) { log('error', '音乐', `搜「${word}」失败：${e.message}`); toast('搜索失败：' + e.message); }
  }
}

/* ================= 我的 ================= */
function renderMe(ctx) {
  const box = h('div');
  ctx.right.append(navBtn('search', '搜索', () => ctx.go('search')), navBtn('edit', '编辑资料', () => editMe(paint)));
  const hearEl = h('span');   // 听歌时长一直在涨，单独改字，不跟着整块重画
  const paintHeard = () => { const [n, u] = heard(); hearEl.replaceChildren(h('b', String(n)), ' ' + u); };
  const paintAll = keep(box, () => JSON.stringify([me(), follows().length, M().liked.length, firstPic(M().liked), M().lists.map(l => [l.id, l.name, (l.songs || []).length]), Object.keys(M().plays).length]), () => {
    const plays = Object.values(M().plays).reduce((n, x) => n + x.n, 0);
    const cover = (pic, heart) => h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(pic) } }, heart ? icon('heart', 26, 0) : null);
    const u = me();
    ctx.meBg.style.backgroundImage = bgUrl(u.bg); ctx.meBg.classList.toggle('has-img', !!u.bg);
    return [
      h('div.as-mu-me', avatar(u.avatar, u.nick, 78), h('b', u.nick), u.sign ? h('div.as-mu-me__sign', u.sign) : null,
        h('div.as-mu-me__stat', h('button', { onclick: openFollows }, h('b', String(follows().length)), ' 关注'), h('span', h('b', big(u.fans)), ' 粉丝'), h('b', 'Lv.' + u.lv), hearEl)),
      h('div.as-mu-pills', [['最近', 'moments', () => openList('最近播放', M().recent)], ['本地', 'box', openLocal], ['排行', 'flame', openRank], ['导入', 'plus', importList]]
        .map(([t, ic, fn]) => h('button', { onclick: fn }, icon(ic, 16, 2), t))),
      h('div.as-mu-sheet',
        h('div.as-mu-sheet__h', '歌单', h('span', String(M().lists.length + 1))),
        h('div.as-mu-li', { role: 'button', onclick: () => openList('我喜欢的音乐', M().liked, { onRemove: s => P.like(s) }) }, cover(firstPic(M().liked), true),
          h('div', h('b', '我喜欢的音乐'), h('span', `${M().liked.length} 首 · ${plays} 次播放`)),
          h('button.as-mu-chip', { onclick: e => { e.stopPropagation(); heartMode(); } }, icon('heart', 13, 2), '心动模式')),
        ...M().lists.map(l => h('div.as-mu-li', { role: 'button', onclick: () => openRemote(l.name, l.id, l) }, cover(firstPic(l.songs)),
          h('div', h('b', l.name), h('span', `歌单 · ${(l.songs || []).length} 首`)),
          h('button.as-mu-more', { 'aria-label': '更多', onclick: e => { e.stopPropagation(); delList(l); } }, icon('more', 18, 3)))),
        h('div.as-mu-gap')),
    ];
  });
  const paint = () => { paintAll(); paintHeard(); };
  paint();
  ctx.body.append(box);
  ctx.el._onShow = paint;

  async function delList(l) {
    if ((await actionSheet(l.name, [{ value: 'rm', label: '删除', icon: 'trash', danger: true }])) !== 'rm') return;
    if (!(await dialog({ title: `删除「${l.name}」？`, text: '只是从这里拿掉，网易云里的歌单不受影响。', confirm: '删除', danger: true }))) return;
    M().lists.splice(M().lists.indexOf(l), 1); commit('music'); paint();
  }
  async function importList() {
    const link = await dialog({ title: '导入网易云歌单', text: '歌单要设成公开；「我喜欢的音乐」也可以。', input: { placeholder: '歌单链接' } });
    if (!link) return;
    const id = P.playlistId(link); if (!id) { toast('没认出歌单，换成分享出来的链接试试'); return; }
    if (M().lists.some(l => l.id === id)) { toast('这个歌单已经导入过了'); return; }
    const name = await dialog({ title: '给歌单起个名字', input: { value: '网易云歌单' } }); if (name == null) return;
    toast('正在读歌单…', true);
    try {
      const songs = await P.playlist(id);
      if (!songs.length) throw new Error('歌单是空的，或者没设成公开');
      M().lists.push({ id, name: name.trim() || '网易云歌单', songs }); commit('music'); paint(); toast(`导入了 ${songs.length} 首`);
    } catch (e) { log('error', '音乐', '导入歌单失败：' + e.message); toast('导入失败：' + e.message); }
  }
}
/** 「我的」资料：昵称、头像没改过就跟着「我」 */
const me = () => { const u = M().profile || {}; return { nick: u.nick || myNick(), avatar: u.avatar || myAvatar(), sign: u.sign || '', bg: u.bg || '', fans: u.fans || 0, lv: u.lv || 1 }; };
/** 990000 → 990k */
const big = n => n < 1000 ? String(n) : n < 1e6 ? +(n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k' : +(n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M';
/** 听歌时长：不到一分钟写秒，不到一小时写分钟，再往上写小时 */
const heard = () => { const s = Math.floor(M().heard || 0); return s < 60 ? [s, '秒'] : s < 3600 ? [Math.floor(s / 60), '分钟'] : [Math.floor(s / 3600), '小时']; };
const follows = () => M().follows || (M().follows = []);
function editMe(after) {
  const d = { ...(M().profile || {}) };
  const p = page({ app: 'music', id: 'music-edit', title: '编辑资料', back: true });
  const av = h('span'), bgThumb = h('span.as-mu-lcover.is-thumb');
  const paintImgs = () => { av.replaceChildren(avatar(d.avatar || myAvatar(), d.nick || myNick(), 40)); bgThumb.style.backgroundImage = bgUrl(d.bg); };
  paintImgs();
  const img = (k, title, opt) => async () => { const v = await pickImage(title, { ...opt, has: !!d[k] }); if (v != null) { d[k] = v; paintImgs(); } };
  const num = (k, label, v) => field(label, input({ type: 'number', value: String(v), onInput: x => { d[k] = Math.max(0, parseInt(x, 10) || 0); } }));
  p.body.append(
    group('', [item({ title: '头像', right: av, chevron: true, onClick: img('avatar', '头像', { ratio: 1, size: 320 }) }), item({ title: '背景', right: bgThumb, chevron: true, onClick: img('bg', '背景', { ratio: 1, size: 900 }) })]),
    group('', [field('昵称', input({ value: d.nick || '', placeholder: myNick(), onInput: v => { d.nick = v.trim(); } })), field('个性签名', input({ value: d.sign || '', placeholder: '个性签名', onInput: v => { d.sign = v.trim(); } }))]),
    group('', [num('fans', '粉丝', d.fans || 0), num('lv', '等级', d.lv || 1)]),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', () => {
      M().profile = d;
      commit('music'); nav.pop(); after();
    })));
  nav.push(p.el);
}
/* ---------- 关注的歌手：点进去看 TA 的歌 ---------- */
function openFollows() {
  const p = page({ app: 'music', id: 'music-follows', title: '关注的歌手', back: true });
  const box = h('div.as-mu-sheet');
  const paint = () => box.replaceChildren(...(follows().length ? follows().map(a => h('div.as-mu-li', { role: 'button', onclick: () => openArtist(a) }, avatar('', a, 48), h('div', h('b', a)), icon('chevron', 16, 2)))
    : [empty('还没有关注的歌手', h('div.as-muted', '播放页歌手名字旁边点「关注」'))]));
  paint(); p.body.append(box); p.el._onShow = paint;
  nav.push(p.el);
}
async function openArtist(a) {
  toast(`正在找${a}的歌…`, true);
  try {
    const all = await P.search(a), mine = all.filter(s => s.artist.split(/[/、,，&]/).some(x => x.trim() === a));
    const songs = mine.length ? mine : all; toast(`${songs.length} 首`);
    const on = () => follows().includes(a);
    const b = navText(on() ? '已关注' : '关注', () => { follow(a); b.textContent = on() ? '已关注' : '关注'; });
    openList(a, songs, { right: [b], sub: '歌手' });
  } catch (e) { log('error', '音乐', `找${a}的歌失败：${e.message}`); toast('读不到：' + e.message); }
}
function follow(a) {
  const F = follows(), i = F.indexOf(a);
  i < 0 ? F.unshift(a) : F.splice(i, 1); commit('music');
  toast(i < 0 ? `关注了${a}` : `取消关注${a}`);
  return i < 0;
}
const openRank = () => openList('听歌排行', Object.values(M().plays).sort((a, b) => b.n - a.n).map(x => x.s), { count: s => `${M().plays[s.id].n} 次` });
function openLocal() {
  const v = openList('本地', M().local, {
    right: [navBtn('plus', '上传', async () => {
      const f = await pickFile('audio/*'); if (!f) return;
      try { const s = await P.addLocal(f); toast(`加了《${s.name}》`); v.fill(M().local); } catch (e) { log('error', '音乐', '上传失败：' + e.message); toast('上传失败：' + e.message); }
    })],
    sub: '存在这台设备上，换设备要重新上传',
    onRemove: s => P.removeLocal(s),
  });
}

/* ================= 歌单页：上面是封面和名字（背景是封面糊开），下面白底列表 ================= */
function openList(title, list, { right, onRemove, count, sub, top } = {}) {
  const p = page({ app: 'music', id: 'music-list', back: true, right, cls: 'as-mu-lp.is-dark' });
  const bg = h('div.as-mu-lp__bg'), cov = h('span.as-mu-lcover.is-big'), n = h('span'), rows = h('div');
  p.el.prepend(bg);
  p.body.append(h('div.as-mu-lp__head', cov, h('div', h('b', title), sub ? h('span', sub) : null)),
    h('div.as-mu-sheet', top, h('div.as-mu-all', { role: 'button', onclick: () => list.length && play(list, 0, title) }, h('i', icon('play', 15, 0)), h('div', h('b', '播放全部'), n)), rows, h('div.as-mu-gap')));
  const row = s => {
    const el = h('div.as-mu-li.is-song', { role: 'button', onclick: () => play(list, list.indexOf(s), title) }, h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(s.pic) } }, s.local ? icon('music', 18, 1.8) : null),
      h('div', h('b', s.name), h('span', s.artist)),
      count ? h('em', count(s)) : onRemove ? h('button.as-mu-more', { 'aria-label': '更多', onclick: async e => {
        e.stopPropagation();
        if ((await actionSheet(P.label(s), [{ value: 'rm', label: '移除', icon: 'trash', danger: true }])) !== 'rm') return;
        onRemove(s); list = list.filter(x => x !== s); el.remove(); n.textContent = `${list.length} 首`;
      } }, icon('more', 18, 3)) : null);
    return el;
  };
  const fill = L => {
    list = L.slice(); const pic = firstPic(L);
    bg.style.backgroundImage = cov.style.backgroundImage = bgUrl(pic); n.textContent = `${L.length} 首`;
    rows.replaceChildren(...(L.length ? L.map(row) : [empty('这里还没有歌')]));
  };
  fill(list);
  nav.push(p.el);
  return { fill };
}
/** 榜单 / 导入的歌单：有存过的先马上显示，后台去读新的，读到了再换 */
async function openRemote(name, id, l) {
  const old = (l && l.songs) || await P.cachedList(id);
  const view = old ? openList(name, old) : null;
  if (!old) toast('正在读歌单…', true);
  try {
    const songs = await P.playlist(id);
    if (l) { l.songs = songs; commit('music'); }
    if (!view) { toast(`${songs.length} 首`); openList(name, songs); return; }
    if (songs.length && (songs.length !== old.length || songs.some((s, i) => s.id !== old[i].id))) view.fill(songs);
  } catch (e) {
    log('error', '音乐', `读「${name}」失败：${e.message}`);
    if (!view) toast('读不到：' + e.message);
  }
}

/* ================= 播放页 ================= */
// 唱臂：照网易云那支——转轴在唱片正上方、离唱片有一段距离，长臂先直着往下、再往右弯，小方块唱头落在唱片右上那一圈。
// 图的坐标以唱片直径为 100：这张图左边在唱片的 40、上边在 -36，转轴在图里的 (10, 8)
const ARM = '<svg viewBox="0 0 50 66" aria-hidden="true"><circle cx="10" cy="8" r="4.4" fill="rgba(255,255,255,.28)"/><circle cx="10" cy="8" r="2.9" fill="#fff"/><circle cx="10" cy="8" r="1.1" fill="#cfcfcf"/>'
  + '<path d="M10 11V22C10 34 18 44 32 51.5" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>'
  + '<g transform="rotate(-52 36.5 55.5)"><rect x="34.2" y="51" width="4.6" height="9" rx="1" fill="#fff"/><path d="M35.8 56.5v2M37.3 56.5v2" stroke="#c8c8c8" stroke-width=".45" stroke-linecap="round"/></g></svg>';
export function openPlayer() {
  if (!P.current()) { toast('还没有在放的歌'); return; }
  const S = M().skin;
  const p = page({ app: 'music', id: 'music-player', back: true, cls: 'as-mp.is-dark' });
  p.nav.querySelector('.as-navbar__back').replaceChildren(icon('down', 26, 2));
  const top = h('div.as-mp__top'), topName = h('b'), topArtist = h('span');
  p.nav.querySelector('.as-navbar__title').append(top);
  const bg = h('div.as-mp__bg'), cov = h('div.as-mp__cover'), disc = h('div.as-mp__disc' + (S.disc === 'vinyl' ? '.is-vinyl' : ''), cov);
  const arm = h('div.as-mp__arm'); arm.innerHTML = ARM;
  // 点唱片 ⇄ 全部歌词
  const lrc = h('div.as-mp__lrc'), stage = h('div.as-mp__stage', disc, arm);
  const main = h('div.as-mp__main', { onclick: () => { p.el.classList.toggle('is-lrc'); paintSkin(); } }, stage, lrc);
  const cv = h('canvas.as-mp__rain'), R = rain(cv, p.el);
  onLongPress(lrc, collectLyrics);
  let touched = 0; lrc.addEventListener('pointerdown', () => { touched = Date.now(); });
  const name = h('div.as-mp__name'), artistName = h('span'), followBtn = h('button.as-mp__follow', { onclick: async e => {
    e.stopPropagation();
    const list = P.current().artist.split(/[/、,，&]/).map(x => x.trim()).filter(Boolean);
    const a = list.length > 1 ? await actionSheet('关注哪位', list.map(x => ({ value: x, label: x, active: follows().includes(x) }))) : list[0];
    if (a) { follow(a); paintFollow(); }
  } }), artist = h('div.as-mp__artist', artistName, followBtn);
  const paintFollow = () => { const on = P.current().artist.split(/[/、,，&]/).some(x => follows().includes(x.trim())); followBtn.textContent = on ? '已关注' : '关注'; followBtn.classList.toggle('is-on', on); };
  const heart = h('button.as-mp__heart', { 'aria-label': '喜欢', onclick: () => { const on = P.like(); heart.classList.toggle('is-on', on); toast(on ? '加到我喜欢了' : '从我喜欢里拿掉了'); } }, icon('heart', 26, 1.8));
  // 进度条：细线 + 小圆点，按住拖
  const fillEl = h('i'), dot = h('b'), track = h('div.as-mp__track', fillEl, dot), t0 = h('span'), t1 = h('span');
  let dragging = false;
  const setBar = r => { fillEl.style.width = dot.style.left = r * 100 + '%'; };
  const at = e => { const b = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)); };
  track.addEventListener('pointerdown', e => { dragging = true; track.setPointerCapture(e.pointerId); setBar(at(e)); t0.textContent = fmt(at(e) * P.audio.duration); });
  track.addEventListener('pointermove', e => { if (dragging) { setBar(at(e)); t0.textContent = fmt(at(e) * P.audio.duration); } });
  track.addEventListener('pointerup', e => { if (dragging) { dragging = false; P.seek(at(e) * P.audio.duration); } });
  const playBtn = h('button.as-mp__play', { 'aria-label': '播放 / 暂停', onclick: () => P.toggle() });
  const mode = () => P.MODES.find(m => m[0] === M().mode) || P.MODES[0];
  const modeBtn = h('button', { 'aria-label': '播放顺序', onclick: () => { const m = P.cycleMode(); modeBtn.replaceChildren(icon(m[2], 24, 1.8)); toast(m[1]); } }, icon(mode()[2], 24, 1.8));
  const tool = (ic, label, fn) => h('button', { 'aria-label': label, onclick: fn }, icon(ic, 21, 1.6));
  p.el.prepend(bg, cv);
  p.body.append(main,
    h('div.as-mp__info', h('div', name, artist), heart, h('button.as-mp__heart', { 'aria-label': '热评', onclick: hot }, icon('comment', 24, 1.8))),
    h('div.as-mp__prog', track, h('div.as-mp__times', t0, t1)),
    h('div.as-mp__ctrl', modeBtn, h('button', { 'aria-label': '上一首', onclick: () => P.prev() }, icon('prev', 26, 1.8)), playBtn,
      h('button', { 'aria-label': '下一首', onclick: () => P.next() }, icon('next', 26, 1.8)), h('button', { 'aria-label': '播放列表', onclick: openQueue }, icon('list', 24, 1.8))),
    h('div.as-mp__tools', tool('palette', '换样式', skin), tool('image', '换背景', background), tool('users', '加到谁的歌单', toChar), tool('note', '收进笔记', collectLyrics)));

  // 下雨天：背景是雨景图（白天 / 夜里两张，跟着时间换），白天那张浅，字和按钮换成深蓝
  const paintBg = () => {
    const wet = S.name === 'rain', day = wet && !S.bg && !isNight();
    bg.style.backgroundImage = bgUrl(S.bg || (wet ? `assets/music/rain-${day ? 'day' : 'night'}.webp` : (P.current() || {}).pic));
    bg.classList.toggle('is-custom', !!S.bg || wet); bg.classList.toggle('is-scene', wet && !S.bg);
    p.el.classList.toggle('is-day', day); p.el.classList.toggle('is-dark', !day);
  };
  const paintSkin = () => { p.el.classList.toggle('is-rain', S.name === 'rain'); S.name === 'rain' && !p.el.classList.contains('is-lrc') ? R.start() : R.stop(); };
  let lines = [];
  const paintSong = () => {
    const s = P.current(); if (!s) return;
    name.textContent = topName.textContent = s.name; artistName.textContent = topArtist.textContent = s.artist; paintFollow(); cov.style.backgroundImage = bgUrl(s.pic);
    top.replaceChildren(h('em', M().from || ''), topName, topArtist);
    heart.classList.toggle('is-on', P.liked(s)); paintBg();
    const L = P.lyricsNow();
    lines = L.map(x => h('p', h('span', x.text), x.tr ? h('small', x.tr) : null));
    lrc.replaceChildren(...(L.length ? lines : [h('p.is-none', s.local ? '本地的歌没有歌词' : '纯音乐，或者没找到歌词')]));
    li = -2; tick();
  };
  const paintState = () => { const on = P.playing(); playBtn.replaceChildren(icon(on ? 'pause' : 'play', 34, 2.6)); disc.classList.toggle('is-playing', on); arm.classList.toggle('is-up', !on); loop(); };
  // 歌词：唱到哪一句、这一句唱了几成（有逐字时间以前，按这句的长短估一个，从左往右亮起来）
  let li = -2, raf = 0;
  function tick() {
    const a = P.audio, t = a.currentTime || 0, d = a.duration || 0, L = P.lyricsNow();
    if (!dragging) { setBar(d ? t / d : 0); t0.textContent = fmt(t); }
    t1.textContent = fmt(d);
    let i = -1; while (i + 1 < L.length && L[i + 1].t <= t) i++;
    if (i !== li) {
      lines[li]?.classList.remove('is-cur'); li = i;
      const el = lines[i] || lines[0];
      if (lines[i]) lines[i].classList.add('is-cur');
      if (el && Date.now() - touched > 3000) lrc.scrollTo({ top: el.offsetTop - lrc.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
    }
    if (L[i]) lines[i].style.setProperty('--p', P.sung(L, i, t) * 100 + '%');
  }
  function loop() {
    cancelAnimationFrame(raf);
    const go = () => { tick(); if (P.playing() && !p.el.classList.contains('is-behind')) raf = requestAnimationFrame(go); };
    go();
  }
  // 长按歌词：挑几句收进笔记
  async function collectLyrics() {
    const L = P.lyricsNow(); if (!L.length) { toast('这首没有歌词'); return; }
    const picked = await pickMany('收进笔记', L.map((x, i) => ({ key: String(i), name: x.text })), { preselect: [String(Math.max(0, li))] });
    if (!picked) return;
    if (!picked.length) { toast('一句都没选'); return; }
    const n = addNote(P.current(), picked.map(Number).sort((a, b) => a - b).map(i => L[i].text));
    toast('收进笔记了', { label: '去看看', fn: () => openNote(n) });
  }
  async function skin() {
    const rec = S.name !== 'rain';
    const v = await actionSheet('样式', [{ value: 'glass', label: '玻璃唱片', active: rec && S.disc !== 'vinyl' }, { value: 'vinyl', label: '黑胶唱片', active: rec && S.disc === 'vinyl' }, { value: 'rain', label: '下雨天', active: !rec }]);
    if (!v) return;
    if (v === 'rain') S.name = 'rain'; else { S.name = 'record'; S.disc = v; disc.classList.toggle('is-vinyl', v === 'vinyl'); }
    commit('music'); paintBg(); paintSkin();
  }
  async function background() {
    const v = S.bg ? await actionSheet('背景', [{ value: 'pick', label: '换一张图', icon: 'image' }, { value: 'none', label: S.name === 'rain' ? '用雨景图' : '跟着封面变色', icon: 'palette' }]) : 'pick';
    if (v === 'pick') { const img = await pickImage('播放页背景', { ratio: 'screen', size: 1100, has: !!S.bg }); if (img != null) { S.bg = img; commit('music'); paintBg(); } }
    if (v === 'none') { S.bg = ''; commit('music'); paintBg(); }
  }
  async function toChar() {
    const s = P.current();
    if (!state.contacts.length) { toast('还没有联系人'); return; }
    const c = await actionSheet('加到谁的歌单', state.contacts.map(c => ({ value: c.id, label: nameOf(c), active: (c.songs || []).some(x => x.id === s.id) })));
    const who = c && state.contacts.find(x => x.id === c); if (!who) return;
    toast(P.addToChar(who, s) ? `加到${nameOf(who)}的歌单了` : `${nameOf(who)}的歌单里已经有了`);
  }
  async function hot() {
    const s = P.current(); if (s.local) { toast('本地的歌没有热评'); return; }
    toast('正在拿热评…', true);
    try {
      const list = await P.hotComments(s.id); if (!list.length) throw new Error('没有热评'); toast(`${list.length} 条热评`);
      sheet({ title: '热评', content: h('div.as-mu-reviews.as-mu-hot', list.map(c => h('div.as-mu-review', avatar('', c.name, 34), h('div', h('div.as-mu-review__name', c.name, h('span', `♡ ${c.likes}`)), h('div.as-mu-review__text', c.text))))) });
    } catch (e) { log('warn', '音乐', '拿热评失败：' + e.message); toast('拿不到热评：' + e.message); }
  }
  paintSong(); paintState(); paintSkin();
  const off = P.onMusic(w => { if (w === 'song' || w === 'lyrics') paintSong(); if (w === 'state') paintState(); if (w === 'time' && !P.playing()) tick(); });
  p.el._onShow = () => { loop(); paintSkin(); };
  p.el._onLeave = () => { off(); cancelAnimationFrame(raf); R.stop(); };
  nav.push(p.el);
}
function openQueue() {
  const Q = M().queue;
  const s = sheet({ title: `播放列表（${Q.length}）`, content: h('div.as-mu-queue', Q.map((x, i) => h('button.as-mu-queue__row' + (i === M().idx ? '.is-cur' : ''), { onclick: () => { P.jump(i); s.close(); } },
    h('b', x.name), h('span', x.artist)))) });
  setTimeout(() => s.el.querySelector('.is-cur')?.scrollIntoView({ block: 'center' }), 50);
}
