// 音乐 App 外壳：底部四个标签（首页 / 搜索 / 电台 / 我的）+ 浮着的迷你播放条；歌单页；播放页（唱片皮肤）。
// 不跟手机主题走（颜色字体都在 music.css 里定死）。播放本体在 core/music.js，关掉这个 App 也接着放。
// 整个 App 只有一处会找 AI：角色歌单右上角的「AI 挑歌」，手动点的。
import { h, onLongPress, pickFile, uid } from '../../core/util.js';
import { state, commit, contact, kvGet, kvSet, kvDel } from '../../core/store.js';
import { page, group, item, field, input, btn, icon, navBtn, navText, actionSheet, dialog, toast, empty, sheet, pickImage, avatar, segmented, slider, toggleItem, colorWheel } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { log } from '../../core/log.js';
import { myNick, myAvatar } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import { rain, isNight } from './rain.js';
import { lyricFx } from './lyricfx.js';
import { look, styleChoir, styleTop } from './tglook.js';
import { burst } from './island.js';
import { clockCfg } from '../../core/time.js';

const M = () => state.music;
const fmt = s => isFinite(s) && s > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '00:00';
const bgUrl = pic => pic ? `url("${pic}")` : '';
// 播放页背景：用过的图都留着。图本身存在 kv 的 mubg:id（太大，不放进每几秒就存一次的音乐数据里），M().bgs 只记 id、模糊、亮度；skin.bgId 是正在用的
const bgCache = new Map();
const bgs = () => M().bgs || (M().bgs = []);
async function bgLoad(id) { if (!bgCache.has(id)) bgCache.set(id, (await kvGet('mubg:' + id).catch(() => null)) || ''); return bgCache.get(id); }
async function bgAdd(src) { const id = uid('bg'); await kvSet('mubg:' + id, src); bgCache.set(id, src); bgs().unshift({ id, blur: 0, bright: 1 }); return id; }
/** 一行放不下的字：两份首尾相接慢慢往左走（长歌名） */
function marquee(el, text) {
  el.classList.remove('is-scroll'); el.replaceChildren(text);
  requestAnimationFrame(() => {
    if (el.scrollWidth <= el.clientWidth) return;
    el.replaceChildren(h('span', `${text}\u3000\u3000\u3000${text}\u3000\u3000\u3000`)); el.classList.add('is-scroll');
    el.style.setProperty('--t', el.firstChild.scrollWidth / 60 + 's');   // 一秒走 30px
  });
}
const firstPic = L => ((L || []).find(s => s.pic) || {}).pic || '';
const play = (list, i, from) => { P.playList(list, i, from); openPlayer(); };
P.onMusic(w => { if (w === 'blocked') toast('点一下播放键开始放'); if (w === 'error') toast(`《${(P.current() || {}).name || ''}》放不出来，跳下一首`); });

/* ================= 外壳：四个标签 ================= */
const TABS = [['home', '首页', renderHome], ['search', '搜索', renderSearch], ['radio', '电台', renderRadio], ['me', '我的', renderMe]];
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
const CATS = [['华语', 'Mandarin', '#c2876e'], ['欧美', 'Western', '#6f8fb0'], ['日语', 'J-Pop', '#d39aa0'], ['韩语', 'K-Pop', '#a08cc2'], ['粤语', 'Cantonese', '#b5584f'],
  ['二次元', 'ACG', '#77a2c6'], ['古风', 'Gufeng', '#86977a'], ['说唱', 'Hip-Hop', '#4b4f58'], ['电子', 'Electronic', '#5b68b8'], ['轻音乐', 'Light Music', '#bfa97e']];
const STYLES = ['日语', '韩语', '英语', '粤语', '二次元', '古风', '说唱', '小甜歌'];
function renderHome(ctx) {
  ctx.title.append(h('button.as-mu-search', { onclick: () => { ctx.go('search'); ctx.title.querySelector('input')?.focus(); } }, icon('search', 16, 2), h('span', '搜索歌曲、歌手、语种')));
  // 一行 4 个、最多两行，多的点「全部」看
  const recent = h('div'), chars = h('div');
  const paintRecent = keep(recent, () => M().recent.slice(0, 8).map(s => s.id).join(), () => M().recent.length ? [
    h('div.as-mu-h', '最近播放', h('button.as-mu-h__more', { onclick: () => openList('最近播放', M().recent) }, '全部')),
    h('div.as-mu-grid', M().recent.slice(0, 8).map((s, i) => songCard(s, () => play(M().recent, i, '最近播放'))))] : []);
  const paintChars = keep(chars, () => JSON.stringify(charList().map(c => [c.id, nameOf(c), P.charSongs(c).length, P.charLists(c).length, c.avatar, storyOn(c)])), () => state.contacts.length ? [
    h('div.as-mu-h', '角色的歌单', h('button.as-mu-h__more', { onclick: openAllChars }, '全部')),
    h('div.as-mu-grid', charList().slice(0, 8).map(charCard))] : []);
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
// 右上角红色小音符 = TA 随剧情加歌开着；选人时左上角出勾选圈
const storyOn = c => !!M().storySongs && (!M().storyWho || M().storyWho.includes(c.id));
const charCard = c => { const n = P.charSongs(c).length; return songCard({ name: `${nameOf(c)}的歌单`, sub: n ? `${P.charLists(c).length} 个歌单 · ${n} 首` : '还没有歌' }, () => openCharList(c), [avatar(c.avatar, nameOf(c), 80, 'square'), h('i.as-mu-badge', { hidden: !storyOn(c) }, icon('music', 11, 2.4))]); };
/** 角色歌单的顺序：拖过的按拖好的排（存在联系人身上 songOrder），没拖过的接在后面 */
const charList = () => state.contacts.map((c, i) => [c, c.songOrder ?? 1e6 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
function openAllChars() {
  const p = page({ app: 'music', id: 'music-chars', title: '角色的歌单', back: true });
  const grid = h('div.as-mu-grid', charList().map(c => { const el = charCard(c); el.dataset.id = c.id; sortable(el); return el; }));
  // 随剧情加歌：上面一行写着现在是谁、多久加一首；点「选择」→ 卡片左上角出勾，底下「全选 · 随剧情加歌 · 取消」，勾上的人就是会加歌的人
  const label = h('span'), freq = h('button.as-mu-chip', { onclick: async () => {
    const v = await actionSheet('多久加一首', [{ value: 'every', label: '每楼都加', active: M().songFreq !== 'maybe' }, { value: 'maybe', label: '想到才加', active: M().songFreq === 'maybe' }]);
    if (v) { M().songFreq = v; commit('music'); commit('inject'); paintBar(); }
  } });
  const paintBar = () => {
    label.textContent = '随剧情加歌 · ' + (!M().storySongs ? '关着' : !M().storyWho ? '所有人' : `${state.contacts.filter(storyOn).length} 人`);
    freq.hidden = !M().storySongs; freq.replaceChildren(M().songFreq === 'maybe' ? '想到才加' : '每楼都加', icon('chevron', 12, 2));
    grid.querySelectorAll('.as-mu-sq').forEach(el => { el.querySelector('.as-mu-badge').hidden = !storyOn(contact(el.dataset.id)); });
  };
  let picked = null;
  const cards = () => grid.querySelectorAll('.as-mu-sq');
  const mark = () => cards().forEach(el => el.classList.toggle('is-picked', picked.has(el.dataset.id)));
  const bar = h('div.as-mu-pickbar',
    h('button', { onclick: () => { picked = new Set(picked.size < state.contacts.length ? state.contacts.map(c => c.id) : []); mark(); } }, '全选'),
    h('button.is-main', { onclick: () => {
      const ids = [...picked];
      M().storySongs = ids.length > 0; M().storyWho = ids.length === state.contacts.length ? null : ids; commit('music'); commit('inject');
      toast(ids.length ? `${ids.length} 人会随剧情加歌` : '关掉了随剧情加歌'); pick(false); paintBar();
    } }, '随剧情加歌'),
    h('button', { onclick: () => pick(false) }, '取消'));
  function pick(on) {
    picked = on ? new Set(state.contacts.filter(storyOn).map(c => c.id)) : null;
    grid.classList.toggle('is-picking', on); if (on) { mark(); p.el.append(bar); } else bar.remove();
  }
  grid.addEventListener('click', e => { const el = picked && e.target.closest('.as-mu-sq'); if (!el) return; e.stopPropagation(); picked.has(el.dataset.id) ? picked.delete(el.dataset.id) : picked.add(el.dataset.id); mark(); }, true);
  p.body.append(h('div.as-mu-story', label, h('span.as-mu-story__r', freq, h('button.as-mu-chip', { onclick: () => pick(!picked) }, '选择'))), grid);
  paintBar();
  nav.push(p.el);
  // 长按拿起来（轻轻放大、带影子），跟着手指走；经过别的格子就让位，别的格子滑过去；松手落回空位，存顺序
  function sortable(el) {
    onLongPress(el, e0 => {
      let x0 = e0.clientX, y0 = e0.clientY, px = x0, py = y0;
      const place = () => { el.style.transform = `translate(${px - x0}px, ${py - y0}px) scale(1.08)`; };
      el.classList.add('is-dragging'); el.style.transition = 'transform 150ms ease, box-shadow 150ms'; place();
      setTimeout(() => { if (el.classList.contains('is-dragging')) el.style.transition = 'box-shadow 150ms'; }, 150);
      navigator.vibrate && navigator.vibrate(10);
      const move = e => {
        e.stopPropagation();   // 别让「右滑返回」也收到
        px = e.clientX; py = e.clientY; place();
        const over = [...grid.children].find(x => { if (x === el) return false; const r = x.getBoundingClientRect(); return px > r.left && px < r.right && py > r.top && py < r.bottom; });
        if (!over) return;
        const r = over.getBoundingClientRect(), ref = px > r.left + r.width / 2 ? over.nextSibling : over;
        if (ref === el || ref === el.nextSibling) return;   // 本来就在那儿
        // 先记下每格的位置，挪完再让它们从旧位置滑到新位置
        const kids = [...grid.children], was = new Map(kids.map(k => [k, k.getBoundingClientRect()]));
        grid.insertBefore(el, ref);
        kids.forEach(k => {
          if (k === el) return;
          const a = was.get(k), b = k.getBoundingClientRect(); if (a.left === b.left && a.top === b.top) return;
          k.style.transition = 'none'; k.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
          requestAnimationFrame(() => { k.style.transition = 'transform 220ms ease'; k.style.transform = ''; });
        });
        // 自己换了格子：起点跟着挪，还是在手指底下
        const a = was.get(el), b = el.getBoundingClientRect(); x0 += b.left - a.left; y0 += b.top - a.top; place();
      };
      const noScroll = e => e.preventDefault();
      const up = () => {
        removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); removeEventListener('touchmove', noScroll);
        el.style.transition = 'transform 200ms ease, box-shadow 200ms'; el.style.transform = ''; el.classList.remove('is-dragging');
        setTimeout(() => { el.style.transition = ''; }, 220);
        [...grid.children].forEach((x, i) => { state.contacts.find(c => c.id === x.dataset.id).songOrder = i; });
        commit('contacts');
      };
      addEventListener('pointermove', move, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true); addEventListener('touchmove', noScroll, { passive: false });
    });
  }
}
async function heartMode() {
  toast('正在开启心动模式…', true);
  try { const songs = await P.heartPick(); toast(`心动模式 · ${songs.length} 首`); play(songs, 0, '心动模式'); }
  catch (e) { log('error', '心动模式', e.message); toast(e.message); }
}
// 一个角色的歌单们（按心情、风格分）；长按删掉一个。「AI 挑歌」同一个人同时只挑一次，退出再进来按钮还是「取消」
const picking = {}, charViews = {};   // charViews：每个人现在开着的那页（挑完了改它的按钮、重画它）
function openCharList(c) {
  const ai = navText(picking[c.id] ? '取消' : 'AI 挑歌', async () => {
    if (picking[c.id]) { picking[c.id].abort(); return; }
    const ac = picking[c.id] = new AbortController(); ai.textContent = '取消'; toast(`${nameOf(c)}正在挑歌…`, true);
    try { const got = await P.charPick(c, (n, all) => toast(`正在找歌 ${n} / ${all}`, true), ac.signal); toast(got.length ? `加了 ${got.length} 首` : '挑的歌都已经在歌单里了'); }
    catch (err) { log('error', '角色歌单', err.message, err); toast(ac.signal.aborted ? '取消了' : err.message); }
    finally { delete picking[c.id]; const v = charViews[c.id]; v.ai.textContent = 'AI 挑歌'; v.paint(); }
  });
  const p = page({ app: 'music', id: 'music-charlists', title: `${nameOf(c)}的歌单`, back: true, right: ai });
  const box = h('div.as-mu-sheet');
  const row = l => { const el = h('div.as-mu-li', { role: 'button', onclick: () => openList(l.name, l.songs, { info: l, onRemove: s => { l.songs = l.songs.filter(x => x.id !== s.id); commit('contacts'); } }) },
    h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(firstPic(l.songs)) } }), h('div', h('b', l.name), h('span', `${l.songs.length} 首${l.intro ? ' · ' + l.intro : ''}`)));
    onLongPress(el, async () => {
      if (!(await dialog({ title: `删除「${l.name}」？`, text: `里面的 ${l.songs.length} 首歌会一起从${nameOf(c)}的歌单里拿掉。`, confirm: '删除', danger: true }))) return;
      P.charLists(c).splice(P.charLists(c).indexOf(l), 1); commit('contacts'); paint();
    });
    return el; };
  const paint = keep(box, () => JSON.stringify(P.charLists(c).map(l => [l.id, l.name, l.intro, l.songs.length, firstPic(l.songs)])), () => P.charLists(c).length ? P.charLists(c).map(row) : [empty('还没有歌单', h('button.as-mu-morel', { onclick: () => ai.click() }, '让 TA 挑几首（用一次 API）'))]);
  paint(); p.body.append(box); p.el._onShow = paint; charViews[c.id] = { ai, paint };
  nav.push(p.el);
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
  const words = [...STYLES, '治愈', '伤感', ...Object.keys(count).sort((a, b) => count[b] - count[a]), '民谣', '摇滚'].filter(w => !CATS.some(c => c[0] === w)).slice(0, 12);   // 下面分类卡片里有的不重复
  ctx.body.append(hist, h('div.as-mu-h', '试试这些'), h('ol.as-mu-try', words.map((w, i) => h('li', { onclick: () => find(w) }, h('em', String(i + 1)), w))),
    h('div.as-mu-h', '分类'), h('div.as-mu-cats', CATS.map(([w, en, c]) => h('button', { style: { background: c }, onclick: () => find(w) }, h('b', w), h('span', en), h('i', w[0])))), h('div.as-mu-gap'));
  ctx.find = find;
  async function find(word) {
    if (!word) return;
    input.value = word; input.blur();
    M().history = [word, ...M().history.filter(x => x !== word)].slice(0, 10); commit('music'); paintHist();
    toast('正在搜…', true);
    try {
      // 一批搜 3 页（同时发），和前面重复的不要；打开结果页后自己接着往下搜
      let page = 0, all = [];
      const batch = async () => { const got = (await Promise.all([1, 2, 3].map(k => P.search(word, page + k).catch(() => [])))).flat(); page += 3; const fresh = got.filter(s => !all.some(x => x.id === s.id) && (all.push(s), true)); return fresh; };
      const [songs, lists] = await Promise.all([batch(), P.searchLists(word)]);
      toast(songs.length || lists.length ? `找到${lists.length ? ` ${lists.length} 个歌单、` : ' '}${songs.length} 首` : '没搜到');
      if (songs.length || lists.length) openList(`搜「${word}」`, songs, { top: lists.length ? listRows(word, lists) : null, more: batch, tools: true });
    }
    catch (e) { log('error', '音乐', `搜「${word}」失败：${e.message}`); toast('搜索失败：' + e.message); }
  }
}

/* ================= 电台（以后放哄睡故事） ================= */
function renderRadio(ctx) { ctx.body.append(empty('电台还在做')); }

/* ================= 我的 ================= */
function renderMe(ctx) {
  const box = h('div');
  ctx.right.append(navBtn('search', '搜索', () => ctx.go('search')), navBtn('edit', '编辑资料', () => editMe(paint)), navBtn('more', '更多', async () => { const v = await actionSheet('更多', [{ value: 'float', label: '歌词悬浮窗', icon: 'list' }, { value: 'pairs', label: '一起听的悄悄话', icon: 'headphones' }]); if (v === 'float') openFloat(); if (v === 'pairs') openPairs(); }));
  const hearEl = h('span');   // 听歌时长一直在涨，单独改字，不跟着整块重画
  const en = () => clockCfg().lang === 'en';   // 关注、粉丝、听歌时长跟着锁屏时间的语言
  const paintHeard = () => hearEl.replaceChildren(h('b', heard(en())), en() ? ' listened' : ' 听歌');
  const paintAll = keep(box, () => JSON.stringify([en(), M().likedInfo, me(), follows().length, M().liked.length, firstPic(M().liked), M().lists.map(l => [l.id, l.name, (l.songs || []).length, l.pic]), Object.keys(M().plays).length, P.ne && [P.ne.me?.name, (neL || []).length]]), () => {
    const plays = M().liked.reduce((n, s) => n + ((M().plays[s.id] || {}).n || 0), 0);   // 只算喜欢的这些歌放了几次
    const cover = (pic, heart) => h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(pic) } }, heart ? icon('heart', 26, 0) : null);
    const u = me();
    ctx.meBg.style.backgroundImage = bgUrl(u.bg); ctx.meBg.classList.toggle('has-img', !!u.bg);
    return [
      h('div.as-mu-me', avatar(u.avatar, u.nick, 78), h('b', u.nick), u.sign ? h('div.as-mu-me__sign', u.sign) : null,
        h('div.as-mu-me__stat', h('button', { onclick: openFollows }, h('b', String(follows().length)), en() ? ' Following' : ' 关注'), h('span', h('b', big(u.fans)), en() ? (+u.fans === 1 ? ' Follower' : ' Followers') : ' 粉丝'), h('b', 'Lv.' + u.lv), hearEl)),
      h('div.as-mu-pills', [['最近', 'moments', () => openList('最近播放', M().recent)], ['本地', 'box', openLocal], ['排行', 'flame', openRank], ['导入', 'plus', importList]]
        .map(([t, ic, fn]) => h('button', { onclick: fn }, icon(ic, 16, 2), t))),
      h('div.as-mu-sheet',
        h('div.as-mu-sheet__h', '歌单', h('span', String(M().lists.length + 1))),
        h('div.as-mu-li', { role: 'button', onclick: openLiked }, cover(likedInfo().pic || firstPic(M().liked), !likedInfo().pic),
          h('div', h('b', '我喜欢的音乐'), h('span', `${M().liked.length} 首 · ${plays} 次播放`)),
          h('button.as-mu-chip', { onclick: e => { e.stopPropagation(); heartMode(); } }, icon('heart', 13, 2), '心动模式')),
        // 装了酒馆插件才有：没登录给个登录入口；登录了是每日推荐和网易云里自己的歌单
        ...(!P.ne ? [] : !P.ne.me ? [h('div.as-mu-li', { role: 'button', onclick: () => neLogin(loadNe) }, h('span.as-mu-lcover.is-red', icon('link', 22, 2)), h('div', h('b', '登录网易云'), h('span', '会员歌也能放')))] : [
          h('div.as-mu-li', { role: 'button', onclick: openDaily }, h('span.as-mu-lcover.is-red', icon('sparkle', 22, 1.8)), h('div', h('b', '每日推荐'), h('span', '网易云 · ' + P.ne.me.name)),
            h('button.as-mu-more', { 'aria-label': '更多', onclick: e => { e.stopPropagation(); neMenu(); } }, icon('more', 18, 3))),
          ...(neL || []).map(l => h('div.as-mu-li', { role: 'button', onclick: () => openRemote(l.name, l.id, null, l.pic) }, cover(l.pic), h('div', h('b', l.name), h('span', `网易云 · ${l.n} 首`))))]),
        ...M().lists.map(l => { const el = h('div.as-mu-li', { role: 'button', onclick: () => openRemote(l.name, l.id, l) }, cover(listPic(l)),
          h('div', h('b', l.name), h('span', `歌单 · ${(l.songs || []).length} 首`)),
          h('button.as-mu-more', { 'aria-label': '更多', onclick: e => { e.stopPropagation(); delList(l); } }, icon('more', 18, 3)));
          onLongPress(el, () => delList(l)); return el; }),
        h('div.as-mu-gap')),
    ];
  });
  const paint = () => { paintAll(); paintHeard(); };
  paint();
  ctx.body.append(box);
  ctx.el._onShow = paint;
  const loadNe = () => P.neReady.then(async () => {
    if (P.ne?.me && !neL) neL = await P.neLists().catch(e => { log('warn', '音乐', '读网易云歌单失败：' + e.message); return []; });
    paint();
  });
  loadNe();
  async function neMenu() {
    if ((await actionSheet('网易云 · ' + P.ne.me.name, [{ value: 'out', label: '退出登录', icon: 'close', danger: true }])) !== 'out') return;
    try { await P.neLogout(); neL = null; paint(); toast('退出了'); } catch (e) { log('error', '音乐', '退出网易云失败：' + e.message); toast('退出失败：' + e.message); }
  }

  async function delList(l) {
    const v = await actionSheet(l.name, [{ value: 'edit', label: '编辑歌单信息', icon: 'edit' }, { value: 'out', label: '导出', icon: 'send' }, { value: 'rm', label: '删除', icon: 'trash', danger: true }]);
    if (v === 'edit') { editList(l, paint); return; }
    if (v === 'out') { exportList(l); return; }
    if (v !== 'rm') return;
    if (!(await dialog({ title: `删除「${l.name}」？`, text: '只是从这里拿掉，网易云里的歌单不受影响。', confirm: '删除', danger: true }))) return;
    M().lists.splice(M().lists.indexOf(l), 1); commit('music'); paint();
  }
  async function importList() {
    const how = await actionSheet('导入歌单', [{ value: 'ne', label: '网易云歌单链接', icon: 'link' }, { value: 'file', label: '小手机导出的歌单文件', icon: 'box' }]);
    if (how === 'file') { await importFile(); paint(); return; }
    if (how !== 'ne') return;
    const link = await dialog({ title: '导入网易云歌单', text: '歌单要设成公开；「我喜欢的音乐」也可以。', input: { placeholder: '歌单链接' } });
    if (!link) return;
    let id;
    const short = /163cn\.tv/.test(link);   // 短链接要去问，慢
    if (short) toast('正在认链接…', true);
    try { id = await P.playlistIdOf(link); } catch (e) { log('error', '音乐', '认歌单链接失败：' + e.message); toast(e.message); return; }
    if (!id) { toast('没认出歌单，换成分享出来的链接试试'); return; }
    if (short) toast('认出来了');
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
let neL = null;   // 网易云里自己的歌单（登录后读一次）
/* ---------- 登录网易云（酒馆插件替手机记着，哪台设备登一次都行） ---------- */
async function neLogin(after) {
  toast('正在拿二维码…', true);
  let q; try { q = await P.neQr(); toast('二维码好了'); } catch (e) { log('error', '音乐', '拿登录二维码失败：' + e.message); toast('拿不到二维码：' + e.message); return; }
  let t = 0;
  const st = h('div.as-mu-login__st', '用网易云 App 扫一扫'), qr = h('img.as-mu-login__qr', { src: q.img, alt: '登录二维码' });
  const s = sheet({ title: '登录网易云', onClose: () => clearInterval(t), content: h('div.as-mu-login', qr, st,
    h('div.as-mu-login__btns', P.ne.borrow ? btn('用别的插件已有的登录', 'secondary', borrow) : null, btn('手机号登录', 'secondary', byPhone)),
    h('button.as-mu-login__more', { onclick: paste }, '粘贴登录凭证')) });
  const done = name => { clearInterval(t); s.close(); toast('登录了：' + name); after(); };
  t = setInterval(async () => {
    // 问不到、或者网易云回了别的（比如要验证）都写在二维码下面，不吞掉
    const j = await P.neQrCheck(q.key).catch(e => { log('error', '音乐', '扫码登录出错：' + e.message); st.textContent = '出错了：' + e.message; return null; }); if (!j) return;
    if (j.code === 801) return;
    if (j.code === 802) st.textContent = '扫好了，在手机上点确认';
    else if (j.code === 800) { clearInterval(t); st.textContent = '二维码过期了，关掉再开一次'; }
    else if (j.code === 803) done(j.me ? j.me.name : '');
    else { clearInterval(t); st.textContent = `网易云回：${j.message || j.code}`; log('error', '音乐', `扫码登录：网易云回 ${j.code} ${j.message}`); }
  }, 2000);
  async function paste() {
    const c = (await dialog({ title: '粘贴登录凭证', input: { placeholder: 'MUSIC_U' } }) || '').trim(); if (!c) return;
    toast('正在登录…', true);
    try { await P.neCookie(c); done(P.ne.me.name); } catch (e) { log('error', '音乐', '凭证登录失败：' + e.message); toast('登录失败：' + e.message); }
  }
  async function borrow() {
    toast('正在登录…', true);
    try { await P.neBorrow(); done(P.ne.me.name); } catch (e) { log('error', '音乐', '借登录失败：' + e.message); toast('登录失败：' + e.message); }
  }
  async function byPhone() {
    const phone = (await dialog({ title: '手机号登录', input: { placeholder: '手机号' }, confirm: '发验证码' }) || '').trim(); if (!phone) return;
    toast('正在发验证码…', true);
    try { await P.neSms(phone); toast('验证码发了'); } catch (e) { log('error', '音乐', '发验证码失败：' + e.message); toast('发不了验证码：' + e.message); return; }
    const code = (await dialog({ title: '短信验证码', input: { placeholder: '验证码' }, confirm: '登录' }) || '').trim(); if (!code) return;
    toast('正在登录…', true);
    try { await P.nePhone(phone, code); done(P.ne.me.name); } catch (e) { log('error', '音乐', '手机号登录失败：' + e.message); toast('登录失败：' + e.message); }
  }
}
async function openDaily() {
  toast('正在读每日推荐…', true);
  try { const L = await P.neDaily(); toast(`${L.length} 首`); openList('每日推荐', L, { sub: '网易云' }); }
  catch (e) { log('error', '音乐', '读每日推荐失败：' + e.message); toast('读不到：' + e.message); }
}
/* ---------- 歌词悬浮窗的设置（显示在哪、字体、颜色、大小、固定） ---------- */
async function openFloat() {
  const F = await import('../../core/floatlyric.js'), fonts = await import('../../core/fonts.js'), c = F.cfg();
  const save = () => { commit('music'); F.applyFloat(); };
  const fontName = () => (F.FONTS.find(x => x[0] === c.font) || [0, fonts.fontName(c.font) || '默认'])[1];
  const fontVal = h('span', fontName()), sizeOut = h('output', c.size + '');
  const more = group('', [
    item({ title: '字体', right: fontVal, chevron: true, onClick: async () => {
      const v = await actionSheet('字体', [...F.FONTS.map(([k, n]) => ({ value: k || 'def', label: n, active: c.font === k })), ...fonts.userFonts().map(u => ({ value: 'u:' + u.id, label: u.name, active: c.font === 'u:' + u.id }))]);
      if (v == null) return; c.font = v === 'def' ? '' : v; fontVal.textContent = fontName(); save();
    } }),
    h('div.as-field', h('span.as-field__label', '颜色'), colorWheel(c.color, v => { c.color = v; save(); })),
    h('div.as-settings-slider-row', h('span', '大小'), slider({ min: 12, max: 48, step: 1, value: c.size, onInput: v => { c.size = v; sizeOut.textContent = v; save(); } }), sizeOut),
    toggleItem({ title: '锁定' }, c.lock, v => { c.lock = v; save(); }),
  ]);
  more.style.display = c.where === 'off' ? 'none' : '';
  const p = page({ app: 'music', id: 'music-float', title: '歌词悬浮窗', back: true });
  p.body.append(group('显示在', [h('div.as-field', segmented([['off', '关'], ['phone', '小手机里'], ['tavern', '酒馆页面']], c.where, v => { c.where = v; save(); more.style.display = v === 'off' ? 'none' : ''; }))]), more);
  nav.push(p.el);
}
/* ---------- 一首歌加到歌单：先是自己的歌单（新建 / 我喜欢的 / 自己的），最下面才是加到角色的歌单；onLike：加进我喜欢之后（播放页点亮红心） ---------- */
function collectTo(s, onLike) {
  const row = (cov, name, sub, fn) => h('div.as-mu-li', { role: 'button', onclick: () => { sh.close(); fn(); } }, cov, h('div', h('b', name), h('span', sub)));
  const cov = pic => h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(pic) } });
  const sh = sheet({ title: '加到歌单', content: h('div.as-mu-collect',
    row(h('span.as-mu-lcover.is-plus', icon('plus', 22, 2)), '新建歌单', '', async () => {
      const name = ((await dialog({ title: '新建歌单', input: { placeholder: '歌单名字' }, confirm: '新建' })) || '').trim(); if (!name) return;
      M().lists.unshift({ id: uid('my'), name, songs: [s], own: true }); commit('music'); toast(`加到「${name}」了`);
    }),
    row(h('span.as-mu-lcover', icon('heart', 26, 0)), '我喜欢的音乐', `${M().liked.length} 首`, () => {
      if (P.liked(s)) { toast('已经在我喜欢的音乐里了'); return; }
      P.like(s); onLike && onLike(); toast('加到我喜欢的音乐了');
    }),
    ...M().lists.map(l => row(cov(listPic(l)), l.name, `${(l.songs || []).length} 首`, () => {
      if ((l.songs || []).some(x => x.id === s.id)) { toast(`「${l.name}」里已经有了`); return; }
      (l.songs = l.songs || []).unshift(s); commit('music'); toast(`加到「${l.name}」了`);
    })),
    h('button.as-mu-morel', { onclick: () => { sh.close(); toChar(s); } }, '加到角色的歌单')) });
}
async function toChar(s) {
  if (!state.contacts.length) { toast('还没有联系人'); return; }
  const c = await actionSheet('加到谁的歌单', state.contacts.map(c => ({ value: c.id, label: nameOf(c), active: P.charSongs(c).some(x => x.id === s.id) })));
  const who = c && state.contacts.find(x => x.id === c); if (!who) return;
  if (P.charSongs(who).some(x => x.id === s.id)) { toast(`${nameOf(who)}的歌单里已经有了`); return; }
  let name = await actionSheet(`加到${nameOf(who)}的哪个歌单`, [...P.charLists(who).map(l => ({ value: l.name, label: l.name })), { value: '+', label: '新建歌单', icon: 'plus' }]);
  if (name === '+') name = ((await dialog({ title: '新建歌单', input: { placeholder: '歌单名字' }, confirm: '新建' })) || '').trim();
  if (!name) return;
  P.addToChar(who, s, name); toast(`加到${nameOf(who)}的「${name}」了`);
}
/** 选一个聊天：先分私聊 / 群聊，再选是谁 */
async function pickChat(title, skip) {
  const g = await actionSheet(title, [{ value: 'p', label: '私聊', icon: 'user' }, { value: 'g', label: '群聊', icon: 'users' }]); if (!g) return null;
  const all = (g === 'g' ? state.chats.filter(x => x.type === 'group') : state.contacts).filter(x => x !== skip);
  if (!all.length) { toast(g === 'g' ? '还没有群聊' : '还没有联系人'); return null; }
  const id = await actionSheet(g === 'g' ? '选一个群' : '选一个人', all.map(x => ({ value: x.id, label: nameOf(x) })));
  return all.find(x => x.id === id) || null;
}
/** 把歌分享到私聊或群聊（一张歌的卡片） */
async function share(s) {
  if (s.local) { toast('本地的歌分享不了'); return; }
  (await import('../chat/specials.js')).shareSong(s);
}
/* ---------- 一起听的悄悄话：一组两句，点一下用这组，⋯ 编辑 / 删除 ---------- */
function openPairs() {
  const p = page({ app: 'music', id: 'music-pairs', title: '一起听的悄悄话', back: true, right: navBtn('plus', '新增', () => editPair()) });
  const box = h('div.as-mu-sheet');
  const row = (id, a, b, more) => h('div.as-mu-li.as-mu-pair', { role: 'button', dataset: { id }, onclick: () => { M().pair = id; commit('music'); mark(); } },
    h('div', h('b', a), b && h('span', b)), h('span.as-mu-pair__on', icon('check', 18, 2.4)), more && h('button.as-mu-more', { 'aria-label': '更多', onclick: e => { e.stopPropagation(); more(); } }, icon('more', 18, 3)));
  const mark = () => box.querySelectorAll('.as-mu-pair').forEach(r => r.classList.toggle('is-on', r.dataset.id === (M().pair || '')));
  const paint = () => { box.replaceChildren(row('', '每首歌换一组'), ...P.pairs().map(x => row(x.id, x.a, x.b, async () => {
    const v = await actionSheet(x.a, [{ value: 'edit', label: '编辑', icon: 'edit' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
    if (v === 'edit') editPair(x);
    if (v === 'del') { P.pairs().splice(P.pairs().indexOf(x), 1); if (M().pair === x.id) M().pair = ''; commit('music'); paint(); }
  }))); mark(); };
  function editPair(x) {
    const d = { a: x ? x.a : '', b: x ? x.b : '' };
    const sh = sheet({ title: x ? '编辑' : '新增', content: h('div.as-mu-pairedit',
      field('我说', input({ value: d.a, onInput: v => { d.a = v.trim(); } })), field('TA 说', input({ value: d.b, onInput: v => { d.b = v.trim(); } })),
      h('div.as-prompt-bar', btn('取消', 'secondary', () => sh.close()), btn('保存', 'primary', () => {
        if (!d.a && !d.b) { toast('两句至少写一句'); return; }
        if (x) Object.assign(x, d); else P.pairs().push({ id: uid('pr'), ...d });
        commit('music'); sh.close(); paint();
      }))) });
  }
  paint(); p.body.append(box);
  nav.push(p.el);
}
/** 一张图的平均颜色 [r, g, b]；读不了（别的网站的图不让读）就是 null */
function avgColor(src) {
  return new Promise(ok => {
    if (!src) { ok(null); return; }
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { try { const x = h('canvas', { width: 8, height: 8 }).getContext('2d'); x.drawImage(im, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data, s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k]; ok(s.map(v => Math.round(v / 64))); } catch { ok(null); } };
    im.onerror = () => ok(null); im.src = src;
  });
}
const lum = c => (c[0] * .299 + c[1] * .587 + c[2] * .114) / 255;
/* ---------- 编辑歌单信息：封面、名字、一句话介绍、标签 ---------- */
const listPic = l => l.pic || firstPic(l.songs);
// 「我喜欢的音乐」的封面、背景、介绍、标签（M().likedInfo，名字不能改）
const likedInfo = () => M().likedInfo || (M().likedInfo = { name: '我喜欢的音乐' });
function openLiked() {
  const v = openList('我喜欢的音乐', M().liked, { info: likedInfo(), onRemove: s => P.like(s),
    actions: h('div.as-mu-lp__acts', h('button', { onclick: () => editList(likedInfo(), () => v.head(), M().liked) }, icon('edit', 17, 2), '编辑')) });
}
function editList(l, after, songs = l.songs) {
  const d = { pic: l.pic || '', bg: l.bg || '', name: l.name, intro: l.intro || '', tags: (l.tags || []).slice() };
  const p = page({ app: 'music', id: 'music-listedit', title: '编辑歌单信息', back: true });
  const thumb = h('span.as-mu-lcover.is-thumb', { style: { backgroundImage: bgUrl(d.pic || firstPic(songs)) } }), bgThumb = h('span.as-mu-lcover.is-thumb', { style: { backgroundImage: bgUrl(d.bg) } });
  const tags = h('div.as-mu-tags'), tagIn = input({ placeholder: '标签' });
  const addTag = () => { const t = tagIn.value.trim(); tagIn.value = ''; if (t && !d.tags.includes(t)) { d.tags.push(t); paintTags(); } };
  const paintTags = () => tags.replaceChildren(...d.tags.map(t => h('button.as-mu-tag', { 'aria-label': '删掉标签 ' + t, onclick: () => { d.tags = d.tags.filter(x => x !== t); paintTags(); } }, t, icon('close', 11, 2.4))));
  tagIn.addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
  paintTags();
  p.body.append(
    group('', [item({ title: '封面', right: thumb, chevron: true, onClick: async () => { const v = await pickImage('歌单封面', { ratio: 1, size: 600, has: !!d.pic }); if (v != null) { d.pic = v; thumb.style.backgroundImage = bgUrl(v || firstPic(songs)); } } }),
      item({ title: '背景', right: bgThumb, chevron: true, onClick: async () => { const v = await pickImage('歌单背景', { ratio: 1, size: 900, has: !!d.bg }); if (v != null) { d.bg = v; bgThumb.style.backgroundImage = bgUrl(v); } } })]),
    group('', [l === M().likedInfo ? null : field('名字', input({ value: d.name, onInput: v => { d.name = v.trim(); } })), field('一句话介绍', input({ value: d.intro, placeholder: '一句话介绍', onInput: v => { d.intro = v.trim(); } }))]),
    group('标签', [h('div.as-field', tags, h('div.as-mu-tagadd', tagIn, btn('添加', 'secondary', addTag)))]),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', () => {
      addTag(); Object.assign(l, { ...d, name: d.name || l.name }); commit('music'); nav.pop(); after && after();
    })));
  nav.push(p.el);
}
/* ---------- 歌单导出 / 导入（小手机自己的文件） ---------- */
function exportList(l) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ app: 'AsterPhone', kind: 'musicList', list: { name: l.name, songs: l.songs || [] } })], { type: 'application/json' })), download: `AsterPhone-歌单-${l.name}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  toast(`导出了「${l.name}」`);
}
async function importFile() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  let d; try { d = JSON.parse(await f.text()); } catch (e) { toast('这个文件读不出来'); return; }
  const l = d && d.app === 'AsterPhone' && d.kind === 'musicList' && d.list;
  if (!l || !Array.isArray(l.songs)) { toast('这不是小手机导出的歌单'); return; }
  M().lists.unshift({ id: uid('my'), name: l.name || '导入的歌单', songs: l.songs, own: true }); commit('music');
  toast(`导入了「${l.name}」，${l.songs.length} 首`);
}
/** 「我的」资料：昵称、头像没改过就跟着「我」 */
const me = () => { const u = M().profile || {}; return { nick: u.nick || myNick(), avatar: u.avatar || myAvatar(), sign: u.sign || '', bg: u.bg || '', fans: u.fans || 0, lv: u.lv || 1 }; };
/** 990000 → 990k */
const big = n => n < 1000 ? String(n) : n < 1e6 ? +(n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k' : n < 1e9 ? +(n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'M' : +(n / 1e9).toFixed(n < 1e10 ? 1 : 0) + 'B';
/** 听歌时长：按分钟算，几小时几分钟（是 0 的那节不写） */
const heard = en => { const m = Math.floor((M().heard || 0) / 60), x = Math.floor(m / 60), y = m % 60;
  return en ? [x && x + 'h', (y || !x) && y + 'm'].filter(Boolean).join(' ') : [x && x + '小时', (y || !x) && y + '分钟'].filter(Boolean).join(''); };
const follows = () => M().follows || (M().follows = []);
/** 一起听了多久：几小时几分钟几秒，是 0 的那一节不写 */
const span = sec => { const s = Math.floor(sec), p = [[Math.floor(s / 3600), '小时'], [Math.floor(s % 3600 / 60), '分钟'], [s % 60, '秒']].filter(x => x[0]); return p.length ? p.map(x => x.join(' ')).join(' ') : '0 秒'; };
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
/** 听歌排行：最近一周 / 所有时间 */
function openRank() {
  let week = true;
  const n = s => week ? (M().plays[s.id].t || []).filter(t => Date.now() - t < P.WEEK).length : M().plays[s.id].n;
  const list = () => Object.values(M().plays).map(x => x.s).filter(s => n(s)).sort((a, b) => n(b) - n(a));
  const v = openList('听歌排行', list(), { count: s => `${n(s)} 次`, top: h('div.as-mu-seg', segmented([['week', '最近一周'], ['all', '所有时间']], 'week', k => { week = k === 'week'; v.fill(list()); })) });
}
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
// 每行往左滑（或点 ⋯）出「下一首 / 喜欢 / 分享 / 移除」；tools：搜索结果——「移除」叫「去掉」（只从这次搜到的里拿掉），上面多一个「多选」勾几首直接建歌单
function openList(title, list, { right, onRemove, count, sub, top, info, actions, more, tools } = {}) {
  const p = page({ app: 'music', id: 'music-list', back: true, right, cls: 'as-mu-lp.is-dark' });
  const bg = h('div.as-mu-lp__bg'), cov = h('span.as-mu-lcover.is-big'), n = h('span'), rows = h('div');
  p.el.prepend(bg);
  // 搜索结果：先放第一批，后面自己接着一批批往下搜，搜不到新的（或到 500 首）就停；搜到的接在后面（只加新的那几行，不重画）；离开这页就不搜了
  const moreBtn = h('div.as-mu-morel');
  const keepGoing = async () => {
    while (p.el.isConnected && list.length < 500) {
      moreBtn.textContent = `还在往下搜…已经 ${list.length} 首`;
      let L; try { L = await more(); } catch (e) { log('warn', '音乐', '往下搜失败：' + e.message); break; }
      if (!L.length) break;
      list.push(...L); rows.append(...L.map(row)); n.textContent = `${list.length} 首`;
    }
    moreBtn.textContent = `一共 ${list.length} 首`;
  };
  // 歌单自己的封面、标签、一句话介绍（编辑歌单信息里改）
  const nameEl = h('b'), subEl = h('span');
  const head = () => {
    nameEl.replaceChildren((info && info.name) || title, ...((info && info.tags) || []).map(t => h('i.as-mu-tag', t)));
    subEl.textContent = (info && info.intro) || sub || ''; subEl.hidden = !subEl.textContent;
    if (info) { cov.style.backgroundImage = bgUrl(info.pic || firstPic(list)); bg.style.backgroundImage = bgUrl(info.bg || info.pic || firstPic(list)); }   // 背景没单独设就用封面
    if (nameEl.isConnected) fit();
  };
  // 名字折成两行、第二行没几个字：字缩小一点（最小 15px）挤成一行；实在挤不下就用原来的大小，两行排匀（第二行不会只剩一两个字）
  const fit = () => {
    nameEl.style.fontSize = ''; nameEl.classList.remove('is-even');
    const one = () => nameEl.offsetHeight < parseFloat(getComputedStyle(nameEl).lineHeight) * 1.5;
    for (let f = 18; !one() && f > 15;) nameEl.style.fontSize = --f + 'px';
    if (!one()) { nameEl.style.fontSize = ''; nameEl.classList.add('is-even'); }
  };
  p.body.append(h('div.as-mu-lp__head', cov, h('div', nameEl, subEl)),
    actions || null,
    h('div.as-mu-sheet', top, h('div.as-mu-all', { role: 'button', onclick: () => list.length && play(list, 0, title) }, h('i', icon('play', 15, 0)), h('div', h('b', '播放全部'), n),
      tools ? h('button.as-mu-chip', { onclick: e => { e.stopPropagation(); pickMode(true); } }, icon('check', 13, 2.4), '多选') : null), rows, more ? moreBtn : null, h('div.as-mu-gap')));
  // 多选：勾上的歌；滑开的那一行（同时只开一行）
  const picked = new Set(); let picking = false, opened = null;
  const close = () => { if (opened) { opened.style.transform = ''; opened = null; } };
  const row = s => {
    const ck = tools ? h('span.as-chat-check', icon('check', 14, 2.6)) : null;
    const el = h('div.as-mu-li.is-song', { role: 'button', onclick: () => {
      if (picking) { picked.has(s) ? picked.delete(s) : picked.add(s); ck.classList.toggle('is-active', picked.has(s)); paintPick(); return; }
      if (opened) { close(); return; }
      play(list, list.indexOf(s), title);
    } }, ck, h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(s.pic) } }, s.local ? icon('music', 18, 1.8) : null),
      h('div', h('b', s.name), h('span', s.artist)),
      count ? h('em', count(s)) : h('button.as-mu-more', { 'aria-label': '更多', onclick: e => {
        e.stopPropagation();
        const was = opened === el; close(); if (!was) { el.style.transform = `translateX(${-acts.offsetWidth}px)`; opened = el; }
      } }, icon('more', 18, 3)));
    if (count) return el;
    const act = (t, cls, fn) => h('button.is-' + cls, { onclick: e => { close(); fn(e); } }, t);
    const acts = h('div.as-mu-swacts', act('下一首', 'next', () => { P.queueNext(s); toast('下一首放它'); }), act(P.liked(s) ? '已喜欢' : '喜欢', 'fav', e => { const on = P.like(s); e.target.textContent = on ? '已喜欢' : '喜欢'; toast(on ? '加到我喜欢了' : '从我喜欢里拿掉了'); }), act('分享', 'share', () => share(s)),
      tools || onRemove ? act(tools ? '去掉' : '移除', 'rm', () => { onRemove && onRemove(s); list.splice(list.indexOf(s), 1); picked.delete(s); wrap.remove(); n.textContent = `${list.length} 首`; }) : null);
    const wrap = h('div.as-mu-sw', acts, el);
    slide(el, () => acts.offsetWidth);
    return wrap;
  };
  // 往左滑：跟着手指拉开，过一半就停在打开，不然收回；横着拉的时候不让「右滑返回」也收到
  function slide(el, W) {
    let x0 = 0, y0 = 0, base = 0, dx = 0, on = false, drag = false;
    el.addEventListener('pointerdown', e => { if (picking) return; on = true; drag = false; x0 = e.clientX; y0 = e.clientY; base = opened === el ? -W() : 0; });
    el.addEventListener('pointermove', e => {
      if (!on) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag) {
        if (Math.abs(my) > 10) { on = false; return; }
        if (Math.abs(mx) < 8 || (mx > 0 && !base)) return;   // 关着的时候往右滑是返回，不管
        drag = true; el.setPointerCapture(e.pointerId); el.style.transition = 'none'; if (opened && opened !== el) close();
      }
      e.stopPropagation(); dx = Math.min(0, Math.max(-W() - 24, base + mx)); el.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (!on) return; on = false; if (!drag) return;
      el.style.transition = ''; if (dx < -W() / 2) { el.style.transform = `translateX(${-W()}px)`; opened = el; } else { el.style.transform = ''; if (opened === el) opened = null; }
      el.addEventListener('click', e => e.stopImmediatePropagation(), { capture: true, once: true });   // 拉完松手那一下不算点
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  // 多选：底下一条「全选 · 新建歌单（N）· 取消」
  const nPick = h('span'), pickBar = h('div.as-mu-pickbar',
    h('button', { onclick: () => { const all = picked.size < list.length; rows.querySelectorAll('.as-mu-sw').forEach((w, i) => { const s = list[i]; all ? picked.add(s) : picked.delete(s); w.querySelector('.as-chat-check').classList.toggle('is-active', all); }); paintPick(); } }, '全选'),
    h('button.is-main', { onclick: async () => {
      if (!picked.size) { toast('先勾几首'); return; }
      const name = ((await dialog({ title: '新建歌单', input: { placeholder: '歌单名字' }, confirm: '新建' })) || '').trim(); if (!name) return;
      M().lists.unshift({ id: uid('my'), name, songs: list.filter(x => picked.has(x)), own: true }); commit('music'); toast(`建好了「${name}」，${picked.size} 首`); pickMode(false);
    } }, '新建歌单', nPick),
    h('button', { onclick: () => pickMode(false) }, '取消'));
  const paintPick = () => { nPick.textContent = picked.size ? `（${picked.size}）` : ''; };
  function pickMode(on) {
    picking = on; close(); p.el.classList.toggle('is-picking', on);
    if (on) p.el.append(pickBar); else { pickBar.remove(); picked.clear(); rows.querySelectorAll('.as-chat-check').forEach(c => c.classList.remove('is-active')); }
    paintPick();
  }
  const fill = L => {
    list = L.slice(); const pic = (info && info.pic) || firstPic(L);
    cov.style.backgroundImage = bgUrl(pic); bg.style.backgroundImage = bgUrl((info && info.bg) || pic); n.textContent = `${L.length} 首`;
    rows.replaceChildren(...(L.length ? L.map(row) : [empty('这里还没有歌')]));
  };
  fill(list); head();
  nav.push(p.el); fit();
  if (more) keepGoing();
  return { fill, head };
}
/** 搜出来的歌单：先列 5 个，多的点「查看更多」；下面接单曲 */
const listRow = l => h('div.as-mu-li', { role: 'button', onclick: () => openRemote(l.name, l.id, null, l.pic) }, h('span.as-mu-lcover', { style: { backgroundImage: bgUrl(l.pic) } }),
  h('div', h('b', l.name), h('span', `${l.n} 首 · ${big(l.plays)} 次播放${l.by ? ' · ' + l.by : ''}`)));
function listRows(word, lists) {
  const more = () => { const p = page({ app: 'music', id: 'music-lists', title: `「${word}」的歌单`, back: true }); p.body.append(h('div.as-mu-sheet', lists.map(listRow), h('div.as-mu-gap'))); nav.push(p.el); };
  return h('div', h('div.as-mu-sub', '歌单'), ...lists.slice(0, 5).map(listRow), lists.length > 5 ? h('button.as-mu-morel', { onclick: more }, '查看更多歌单') : null, h('div.as-mu-sub', '单曲'));
}
/** 榜单 / 导入的歌单：有存过的先马上显示，后台去读新的，读到了再换 */
async function openRemote(name, id, l, pic) {
  // 上面两个按钮：不是我的歌单是「收藏」（加到我的歌单里），我的是「编辑」；都能「导出」
  let songs = (l && l.songs) || [];
  const pill = (ic, t, fn) => h('button', { onclick: fn }, icon(ic, 17, 2), t);
  let view = null;
  // 收藏 ↔ 已收藏：再点一下是取消收藏
  const had = () => M().lists.some(x => x.id === id);
  const fav = () => pill(had() ? 'check' : 'plus', had() ? '已收藏' : '收藏', e => {
    if (had()) { M().lists.splice(M().lists.findIndex(x => x.id === id), 1); commit('music'); toast(`取消收藏「${name}」`); }
    else if (!songs.length) { toast('歌单还没读出来'); return; }
    else { M().lists.push({ id, name, songs, pic: pic || '' }); commit('music'); toast(`收藏了「${name}」`); }
    e.currentTarget.replaceWith(fav());
  });
  const actions = h('div.as-mu-lp__acts', l ? pill('edit', '编辑', () => editList(l, () => view.head())) : fav(), pill('send', '导出', () => exportList({ name, songs })));
  const opts = { actions, info: l };
  if (l && l.own) { view = openList(name, l.songs, { ...opts, onRemove: s => { l.songs = l.songs.filter(x => x !== s); commit('music'); } }); return; }   // 自己建的歌单不用去网上读
  const old = (l && l.songs) || await P.cachedList(id);
  if (old) songs = old;
  view = old ? openList(name, old, opts) : null;
  if (!old) toast('正在读歌单…', true);
  try {
    const got = await P.playlist(id);
    if (got.length) songs = got;
    if (l) { l.songs = got; commit('music'); }
    if (!view) { toast(`${got.length} 首`); view = openList(name, got, opts); return; }
    if (got.length && (got.length !== old.length || got.some((s, i) => s.id !== old[i].id))) view.fill(got);
  } catch (e) {
    log('error', '音乐', `读「${name}」失败：${e.message}`);
    if (!view) toast('读不到：' + e.message);
  }
}

/* ================= 播放页 ================= */
// 唱臂：转轴在唱片正上方、离唱片有一段距离，长臂先直着往下、再往右弯，小方块唱头落在唱片右上那一圈。
// 图的坐标以唱片直径为 100：这张图左边在唱片的 40、上边在 -36，转轴在图里的 (10, 8)
const ARM = '<svg viewBox="0 0 50 66" aria-hidden="true"><circle cx="10" cy="8" r="4.4" fill="rgba(255,255,255,.28)"/><circle cx="10" cy="8" r="2.9" fill="#fff"/><circle cx="10" cy="8" r="1.1" fill="#cfcfcf"/>'
  + '<path d="M10 11V22C10 34 18 44 32 51.5" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>'
  + '<g transform="rotate(-52 36.5 55.5)"><rect x="34.2" y="51" width="4.6" height="9" rx="1" fill="#fff"/><path d="M35.8 56.5v2M37.3 56.5v2" stroke="#c8c8c8" stroke-width=".45" stroke-linecap="round"/></g></svg>';
export function openPlayer() {
  if (!P.current()) { toast('还没有在放的歌'); return; }
  const S = M().skin;
  const p = page({ app: 'music', id: 'music-player', back: true, cls: 'as-mp.is-dark' });
  const top = h('div.as-mp__top'), topName = h('b'), topArtist = h('span');
  p.nav.querySelector('.as-navbar__title').append(top);
  const bg = h('div.as-mp__bg'), cov = h('div.as-mp__cover'), disc = h('div.as-mp__disc' + (S.disc === 'vinyl' ? '.is-vinyl' : ''), cov);
  const arm = h('div.as-mp__arm'); arm.innerHTML = ARM;
  // 点唱片 ⇄ 全部歌词
  const lrc = h('div.as-mp__lrc'), stage = h('div.as-mp__stage', disc, arm);
  // 一起听：上面一小块是两个人的头像（外侧各塞一只耳机），头像上方的气泡是一组悄悄话（点一下去改）；群里只写一起听了多久。下面是歌词
  // 两个气泡排成一行、整行居中（一长一短也不会偏到一边）
  const tgAv = [h('div.as-tg__av'), h('div.as-tg__av')], tgBub = [h('div.as-tg__bub.is-l', h('span')), h('div.as-tg__bub.is-r', h('span'))], tgTime = h('div.as-tg__time', { role: 'button', onclick: async e => { e.stopPropagation(); (await import('./report.js')).openReport(P.together()); } });   // 点一起听了多久：缘分报告
  // 耳机换颜色：同一张图当遮罩，上面叠一层颜色「正片叠底」，明暗还在
  const half = (side, i) => h('div.as-tg__half.is-' + side, h('div.as-tg__who', tgAv[i]), h('img', { src: `assets/music/together-${side}.webp`, alt: '' }),
    h('i.as-tg__tint', { style: { webkitMaskImage: `url(assets/music/together-${side}.webp)`, maskImage: `url(assets/music/together-${side}.webp)` } }));
  const tgBubs = h('div.as-tg__bubs', ...tgBub);
  const tgEl = h('div.as-tg', h('div.as-tg__pair', { onclick: e => { e.stopPropagation(); openPairs(); } }, tgBubs, half('l', 0), half('r', 1)), tgTime);
  const fx = h('div.as-mp__fx');
  const main = h('div.as-mp__main', { onclick: () => { if (P.together()) return; p.el.classList.toggle('is-lrc'); paintSkin(); } }, stage, fx, tgEl, lrc);
  const cv = h('canvas.as-mp__rain'), R = rain(cv, p.el);
  let touched = 0; lrc.addEventListener('pointerdown', () => { touched = Date.now(); });
  const name = h('div.as-mp__name'), artistName = h('span'), followBtn = h('button.as-mp__follow', { onclick: async e => {
    e.stopPropagation();
    const list = P.current().artist.split(/[/、,，&]/).map(x => x.trim()).filter(Boolean);
    const a = list.length > 1 ? await actionSheet('关注哪位', list.map(x => ({ value: x, label: x, active: follows().includes(x) }))) : list[0];
    if (a) { follow(a); paintFollow(); }
  } }), artist = h('div.as-mp__artist', artistName, followBtn);
  const paintFollow = () => { const on = P.current().artist.split(/[/、,，&]/).some(x => follows().includes(x.trim())); followBtn.textContent = on ? '已关注' : '关注'; followBtn.classList.toggle('is-on', on); };
  const heart = h('button.as-mp__heart', { 'aria-label': '喜欢', onclick: () => { const on = P.like(); heart.classList.toggle('is-on', on); if (on) burst(heart); toast(on ? '加到我喜欢了' : '从我喜欢里拿掉了'); } }, icon('heart', 26, 1.8));
  // 进度条：细线 + 小圆点，按住拖
  const fillEl = h('i'), dot = h('b'), track = h('div.as-mp__track', fillEl, dot), t0 = h('span'), t1 = h('span');
  let dragging = false;
  const setBar = r => { fillEl.style.width = dot.style.left = r * 100 + '%'; };
  const at = e => { const b = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)); };
  track.addEventListener('pointerdown', e => { dragging = true; track.setPointerCapture(e.pointerId); setBar(at(e)); t0.textContent = fmt(at(e) * P.dur()); });
  track.addEventListener('pointermove', e => { if (dragging) { setBar(at(e)); t0.textContent = fmt(at(e) * P.dur()); } });
  track.addEventListener('pointerup', e => { if (dragging) { dragging = false; P.seek(at(e) * P.dur()); } });
  const playBtn = h('button.as-mp__play', { 'aria-label': '播放 / 暂停', onclick: () => P.toggle() });
  const mode = () => P.MODES.find(m => m[0] === M().mode) || P.MODES[0];
  const modeBtn = h('button', { 'aria-label': '播放顺序', onclick: () => { const m = P.cycleMode(); modeBtn.replaceChildren(icon(m[2], 24, 1.8)); toast(m[1]); } }, icon(mode()[2], 24, 1.8));
  const tool = (ic, label, fn) => h('button', { 'aria-label': label, onclick: fn }, icon(ic, 21, 1.6));
  p.el.prepend(bg, cv);
  p.body.append(main,
    h('div.as-mp__info', h('div', name, artist), heart, h('button.as-mp__heart', { 'aria-label': '热评', onclick: hot }, icon('comment', 24, 1.8))),
    h('div.as-mp__prog', { dataset: { noSwipe: '' } }, track, h('div.as-mp__times', t0, t1)),
    h('div.as-mp__ctrl', modeBtn, h('button', { 'aria-label': '上一首', onclick: () => P.prev() }, icon('prev', 26, 1.8)), playBtn,
      h('button', { 'aria-label': '下一首', onclick: () => P.next() }, icon('next', 26, 1.8)), h('button', { 'aria-label': '播放列表', onclick: openQueue }, icon('list', 24, 1.8))),
    h('div.as-mp__tools', tool('palette', '换样式', skin), tool('image', '换背景', background), tool('plus', '加到歌单', () => collectTo(P.current(), () => heart.classList.add('is-on'))), tool('send', '分享', () => share(P.current())), tool('headphones', '一起听', withWho)));

  // 下雨天：背景是雨景图（白天 / 夜里两张，跟着时间换），白天那张浅，字和按钮换成深蓝
  // 自己的背景图不压暗，字照旧是白的；气泡颜色跟着背景的平均色
  // 自己的图默认就是原图；模糊、亮度能自己调。有图时字加一层淡阴影，亮的图上也看得清
  let tone = null, toneOf = '';
  const blurSvg = h('div', { hidden: true }); blurSvg.innerHTML = '<svg width="0" height="0"><filter id="as-mp-blur" x="0" y="0" width="100%" height="100%"><feGaussianBlur stdDeviation="0" edgeMode="duplicate"/></filter></svg>';
  const blurF = blurSvg.querySelector('feGaussianBlur'); p.el.append(blurSvg);
  // 以前只存一张（skin.bg 里直接是图）：挪进背景库
  if (S.bg) bgAdd(S.bg).then(id => { S.bgId = id; delete S.bg; commit('music'); paintBg(); });
  const paintBg = () => {
    const cur = bgs().find(b => b.id === S.bgId), mine = cur ? bgCache.get(cur.id) : S.bg;
    if (cur && mine === undefined) bgLoad(cur.id).then(paintBg);   // 第一次打开：图从存储里读出来再放
    const has = !!(cur || S.bg), wet = S.name === 'rain', src = has ? mine || '' : wet ? `assets/music/rain-${!isNight() ? 'day' : 'night'}.webp` : (P.current() || {}).pic;
    const day = wet && !has && !isNight();
    bg.style.backgroundImage = bgUrl(src);
    // 模糊用 SVG 的（边上照原图延伸），CSS 的 blur 边上会透出来，只能把图放大盖住
    blurF.setAttribute('stdDeviation', cur ? cur.blur : 0); bg.style.filter = cur ? `${cur.blur ? 'url(#as-mp-blur) ' : ''}brightness(${cur.bright})` : '';
    bg.classList.toggle('is-custom', has || wet); bg.classList.toggle('is-scene', wet && !has);
    p.el.classList.toggle('has-bg', has); p.el.classList.toggle('is-day', day); p.el.classList.toggle('is-dark', !day);
    if (!src) return;
    if (src === toneOf) return;
    toneOf = src; tone = null; paintBub();
    avgColor(src).then(c => {
      if (src !== toneOf || !c) return;
      tone = c; paintBub();
    });
  };
  // 气泡：自己选了颜色就用；不然跟着背景（亮的背景配浅色气泡深色字，暗的反过来）；背景读不到颜色时按白天 / 夜里
  const paintBub = () => {
    const G = look().pair, m = tone && (lum(tone) > .5 ? 255 : 0), c = tone && tone.map(v => Math.round(v * .45 + m * .55));   // 背景色往白 / 黑靠一半
    const [bgc, ink] = c ? [`rgb(${c})`, lum(c) > .55 ? '#222' : '#f4f4f4'] : isNight() ? ['#1c1c1e', '#f2f2f2'] : ['#fff', '#222'];
    tgEl.style.setProperty('--bub-bg', G.bg || bgc); tgEl.style.setProperty('--bub-ink', G.ink || ink);
  };
  // 碎语：唱片那块换成散开的字
  let F = null;
  const paintSkin = () => {
    ['rain', 'cad'].forEach(k => p.el.classList.toggle('is-' + k, S.name === k));
    S.name === 'rain' && !p.el.classList.contains('is-lrc') && !P.together() ? R.start() : R.stop();
    if ((S.name === 'cad') !== !!F) { F = S.name === 'cad' ? lyricFx(fx) : null; if (F) { li = -2; tick(); } }
  };
  // 歌词颜色：没选过就是每个样式自己的颜色（碎语、群唱默认蓝，唱片是白字，下雨天白天夜里不一样）
  const paintColor = () => { S.color ? p.el.style.setProperty('--ly', S.color) : p.el.style.removeProperty('--ly'); R.color(S.color); };
  // 群唱：一起听时歌词一人一句，像聊天一样一条条冒出来（我的在右边）
  const choir = () => !!P.together() && S.tg !== 'plain';
  const singers = c => c.type === 'group' ? c.members.map(contact).filter(Boolean).map(x => [x.avatar, nameOf(x), x.id]) : [[c.avatar, nameOf(c), c.id]];
  // 对话式歌词每行照「歌词颜色」里这个人的设置上色
  const restyle = () => lines.forEach(r => r._ch && styleChoir(r, ...r._ch));
  let tgWho = '';
  const paintTgTime = c => { tgTime.textContent = '一起听了 ' + span(P.sessionSec(c)); };
  const paintTg = () => {
    const c = P.together(); p.el.classList.toggle('is-tg', !!c); if (c) p.el.classList.remove('is-lrc'); paintSkin(); if (!c) return;
    // 头像只在换人时换（图片重新解码会闪）；气泡只改字
    const grp = c.type === 'group';
    tgEl.classList.toggle('is-group', grp);
    const home = grp ? top : tgEl; if (tgTime.parentNode !== home) home.append(tgTime);   // 群里「一起听了多久」放到顶栏，和返回键同一行
    if (!grp && tgWho !== c.id) { tgWho = c.id; tgAv[0].replaceChildren(avatar(me().avatar, me().nick, 84)); tgAv[1].replaceChildren(avatar(c.avatar, nameOf(c), 84)); }
    const x = grp ? null : P.pairNow();
    [x && x.a, x && x.b].forEach((t, i) => { tgBub[i].hidden = !t; tgBub[i].firstChild.textContent = t || ''; });
    paintTgTime(c); styleTop(tgEl, tgTime, tgBubs);
  };
  let lines = [];
  const paintSong = () => {
    const s = P.current(); if (!s) return;
    topName.textContent = s.name; marquee(name, s.name); artistName.textContent = topArtist.textContent = s.artist; paintFollow(); cov.style.backgroundImage = bgUrl(s.pic);
    top.replaceChildren(topName, topArtist);
    heart.classList.toggle('is-on', P.liked(s)); paintBg();
    const L = P.lyricsNow();
    const tc = choir() && P.together(), who = tc && singers(tc), my = [me().avatar, me().nick];
    lines = L.map((x, k) => {
      const ly = h('p', h('span', x.text), x.tr ? h('small', h('span', x.tr)) : null);
      if (!tc) return ly;
      const mine = k % (who.length + 1) === who.length, [a, n, id] = mine ? my : who[k % (who.length + 1)];
      const row = h('div.as-ch' + (mine ? '.is-me' : ''), avatar(a, n, 32), ly);
      row._ch = [id, mine]; return row;
    });
    lrc.classList.toggle('is-choir', !!tc); restyle();
    lrc.replaceChildren(...(L.length ? lines : [h('p.is-none', s.local ? '本地的歌没有歌词' : '纯音乐，或者没找到歌词')]));
    li = -2; tick();
  };
  const paintState = () => { const on = P.playing(); playBtn.replaceChildren(icon(on ? 'pause' : 'play', 34, 2.6)); disc.classList.toggle('is-playing', on); arm.classList.toggle('is-up', !on); loop(); };
  // 歌词：唱到哪一句、这一句唱了几成（有逐字时间以前，按这句的长短估一个，从左往右亮起来）
  let li = -2, raf = 0;
  function tick() {
    const t = P.now(), d = P.dur(), L = P.lyricsNow();
    if (!dragging) { setBar(d ? t / d : 0); t0.textContent = fmt(t); }
    t1.textContent = fmt(d);
    let i = -1; while (i + 1 < L.length && L[i + 1].t <= t) i++;
    if (i !== li) {
      lines[li]?.classList.remove('is-cur'); li = i;
      if (lrc.classList.contains('is-choir')) lines.forEach((r, k) => r.classList.toggle('is-said', k <= i));
      F && F.line(L, i);
      const el = lines[i] || lines[0];
      if (lines[i]) lines[i].classList.add('is-cur');
      if (el && Date.now() - touched > 3000) lrc.scrollTo({ top: el.offsetTop - lrc.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
    }
    if (L[i]) { const q = P.sung(L, i, t); lines[i].style.setProperty('--p', q * 100 + '%'); F && F.prog(q); }
  }
  function loop() {
    cancelAnimationFrame(raf);
    const go = () => { tick(); if (P.playing() && !p.el.classList.contains('is-behind')) raf = requestAnimationFrame(go); };
    go();
  }
  async function skin() {
    const tc = P.together(), rec = !/^(rain|cad)$/.test(S.name), color = { value: 'color', label: '歌词颜色', icon: 'palette' };
    // 一起听时只换歌词是群唱还是普通的；平时换整个播放页
    const v = await actionSheet(tc ? '一起听的歌词' : '样式', tc ? [{ value: 'choir', label: '对话式', active: S.tg !== 'plain' }, { value: 'plain', label: '普通歌词', active: S.tg === 'plain' }, color, { value: 'look', label: '一起听的样子', icon: 'edit' }]
      : [{ value: 'glass', label: '玻璃唱片', active: rec && S.disc !== 'vinyl' }, { value: 'vinyl', label: '黑胶唱片', active: rec && S.disc === 'vinyl' }, { value: 'rain', label: '下雨天', active: S.name === 'rain' },
        { value: 'cad', label: '碎语', active: S.name === 'cad' }, color]);
    if (!v) return;
    if (v === 'look') { (await import('./tglook.js')).openTgLook({ bgImage: bg.style.backgroundImage, bgFilter: getComputedStyle(bg).filter.replace(/url\([^)]*\)/, ''), c: tc, me: me() }); return; }
    // 对话式才是每人一套；一起听选了普通歌词，就跟平时一样只有一个歌词颜色
    if (v === 'color' && tc && S.tg !== 'plain') { (await import('./tglook.js')).openChoirLook({ bgImage: bg.style.backgroundImage, bgFilter: getComputedStyle(bg).filter.replace(/url\([^)]*\)/, ''), c: tc, me: me() }); return; }
    if (v === 'color') {
      // 上面一条预览：垫着播放页的背景，正在唱的这句唱到一半（唱过的是选的颜色）
      const pv = h('div.as-mu-lypv', { style: { '--ly': S.color || '#7cc4ff' } }, h('i', { style: { backgroundImage: bg.style.backgroundImage, filter: getComputedStyle(bg).filter.replace(/url\([^)]*\)/, '') } }), h('span', (P.lyricsNow()[li] || {}).text || P.current()?.name || '歌词'));
      const sh = sheet({ title: '歌词颜色', content: h('div.as-mu-color', pv, colorWheel(S.color || '#7cc4ff', c => { S.color = c; pv.style.setProperty('--ly', c); commit('music'); paintColor(); }),
        btn('恢复默认', 'secondary', () => { S.color = ''; commit('music'); paintColor(); sh.close(); })) });
      return;
    }
    if (tc) { if (S.tg !== v) { S.tg = v; commit('music'); paintSong(); } return; }
    if (v === 'glass' || v === 'vinyl') { S.name = 'record'; S.disc = v; disc.classList.toggle('is-vinyl', v === 'vinyl'); } else S.name = v;
    commit('music'); paintBg(); paintSkin();
  }
  // 换背景：一格一格的小图（第一格是不用图），点一下就换、播放页马上变；右上角 × 删掉；选了图下面出模糊、亮度
  function background() {
    const grid = h('div.as-mp-bgs'), adj = h('div');
    const tile = b => {
      const el = h('button.as-mp-bgs__i', { dataset: { id: b ? b.id : '' }, onclick: () => use(b ? b.id : '') },
        b ? h('i', { role: 'button', 'aria-label': '删除', onclick: e => { e.stopPropagation(); del(b, el); } }, icon('close', 11, 2.6)) : h('span', S.name === 'rain' ? '雨景' : '封面色'));
      if (b) bgLoad(b.id).then(s => { el.style.backgroundImage = bgUrl(s); });
      return el;
    };
    const add = h('button.as-mp-bgs__i.is-add', { 'aria-label': '加一张', onclick: async () => {
      const img = await pickImage('播放页背景', { ratio: 'screen', size: 1100 }); if (!img) return;
      const id = await bgAdd(img); grid.children[0].after(tile(bgs()[0])); use(id);
    } }, icon('plus', 22, 2));
    grid.append(tile(null), ...bgs().map(tile), add);
    const mark = () => {
      [...grid.children].forEach(x => x.classList.toggle('is-on', x.dataset.id === (S.bgId || '')));
      const cur = bgs().find(b => b.id === S.bgId);
      const row = (label, k, o) => { const out = h('output', o.fmt(cur[k])); return h('div.as-settings-slider-row', h('span', label), slider({ ...o, value: cur[k], onInput: v => { cur[k] = v; out.textContent = o.fmt(v); paintBg(); commit('music'); } }), out); };
      adj.replaceChildren(...(cur ? [
        row('模糊', 'blur', { min: 0, max: 20, step: 1, fmt: v => v ? v + '' : '不模糊' }),
        row('亮度', 'bright', { min: .3, max: 1.5, step: .05, fmt: v => Math.round(v * 100) + '%' }),
        btn('恢复原图', 'secondary', () => { cur.blur = 0; cur.bright = 1; commit('music'); paintBg(); mark(); }),
      ] : []));
    };
    const use = id => { if (S.bgId !== id) { S.bgId = id; commit('music'); paintBg(); } mark(); };
    async function del(b, el) {
      if (!(await dialog({ title: '删除这张背景？', confirm: '删除', danger: true }))) return;
      bgs().splice(bgs().indexOf(b), 1); bgCache.delete(b.id); kvDel('mubg:' + b.id).catch(e => log('warn', '音乐', '删背景图失败：' + e.message));
      el.remove(); if (S.bgId === b.id) use(''); else commit('music');
    }
    mark();
    sheet({ title: '背景', content: h('div.as-mp-bgsheet', grid, adj) });
  }
  async function withWho() {
    const c = P.together();
    if (c) {
      const v = await actionSheet(`在和${nameOf(c)}一起听`, [{ value: 'swap', label: '换个人', icon: 'users' }, { value: 'end', label: '结束一起听', icon: 'close', danger: true }]);
      if (v === 'end') { P.listenWith(null); toast('不一起听了'); }
      if (v !== 'swap') return;
    }
    const who = await pickChat('和谁一起听', c); if (!who) return;
    P.listenWith(who); toast(`在和${nameOf(who)}一起听`);   // 播放页里发起一起听不涉及聊天，不发卡片（聊天「+」里发起的才发）
  }
  async function hot() { (await import('./comments.js')).openComments(P.current(), me()); }
  paintColor(); paintSong(); paintState(); paintTg();
  const off = P.onMusic(w => {
    if (w === 'song' || w === 'lyrics') { paintSong(); paintTg(); }
    if (w === 'together') { paintSong(); paintTg(); }
    if (w === 'state') paintState();
    if (w === 'time') { if (!P.playing()) tick(); const c = P.together(); if (c) paintTgTime(c); }
  });
  p.el._onShow = () => { loop(); paintTg(); paintBub(); restyle(); };   // 从悄悄话页、一起听的样子回来：马上变
  p.el._onLeave = () => { off(); cancelAnimationFrame(raf); R.stop(); };
  nav.push(p.el);
}
function openQueue() {
  const Q = M().queue, box = h('div.as-mu-queue');
  const title = () => { s.el.querySelector('.as-sheet__title').textContent = `播放列表（${M().queue.length}）`; };
  // ⋯：置顶（放到正在放的后面）/ 删除；只动这一行，不整个重画
  const row = x => {
    const el = h('div.as-mu-queue__row' + (x === P.current() ? '.is-cur' : ''), { role: 'button', onclick: () => { P.jump(M().queue.indexOf(x)); s.close(); } }, h('b', x.name), h('span', x.artist),
      h('button.as-mu-more', { 'aria-label': '更多', onclick: async e => {
        e.stopPropagation();
        const v = await actionSheet(P.label(x), [{ value: 'top', label: '置顶', icon: 'next' }, { value: 'rm', label: '删除', icon: 'trash', danger: true }]);
        if (v === 'top') { if (x === P.current()) { toast('正在放的就是它'); return; } P.queueNext(x); box.querySelector('.is-cur').after(el); toast('下一首放它'); }
        if (v === 'rm') {
          if (M().queue.length < 2) { toast('只剩这一首了'); return; }
          const cur = x === P.current(); P.queueDel(x); el.remove(); title();
          if (cur) box.children[M().idx]?.classList.add('is-cur');
        }
      } }, icon('more', 18, 3)));
    return el;
  };
  box.append(...Q.map(row));
  const s = sheet({ title: `播放列表（${Q.length}）`, content: box });
  setTimeout(() => s.el.querySelector('.is-cur')?.scrollIntoView({ block: 'center' }), 50);
}
