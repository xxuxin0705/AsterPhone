// 音乐 App 外壳：底部四个标签（广场 / 搜索 / 笔记 / 我的）+ 浮着的迷你播放条；歌曲列表；播放页（唱片皮肤）。
// 播放本体在 core/music.js，关掉这个 App 也接着放。
import { h, onLongPress, pickFile } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, icon, navBtn, actionSheet, dialog, toast, empty, sheet, pickImage, avatar, toggleItem } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { log } from '../../core/log.js';
import { myName, myNick, myAvatar } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import { renderNotes, addNote, openNote } from './notes.js';
import { pickMany } from '../chat/people.js';

const M = () => state.music;
const fmt = s => isFinite(s) && s > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '00:00';
const cover = (s, size) => h('span.as-mu-cover', { style: { width: size + 'px', height: size + 'px', backgroundImage: s && s.pic ? `url("${s.pic}")` : '' } }, s && s.local ? icon('music', 18, 1.8) : null);
/** 歌曲行：点了放这一组；onRemove 有的话长按能移除 */
function songRows(list, onRemove) {
  return list.map((s, i) => {
    const el = item({ icon: cover(s, 42), color: 'transparent', cls: 'as-mu-row', title: s.name, sub: s.artist, onClick: () => { P.playList(list, i); openPlayer(); } });
    if (onRemove) onLongPress(el, async () => { const v = await actionSheet(P.label(s), [{ value: 'rm', label: '移除', icon: 'trash', danger: true }]); if (v === 'rm') { onRemove(s); el.remove(); } });
    return el;
  });
}
P.onMusic(w => { if (w === 'blocked') toast('点一下播放键开始放'); if (w === 'error') toast(`《${(P.current() || {}).name || ''}》放不出来，跳下一首`); });

/* ================= 外壳：四个标签 ================= */
const TABS = [
  { id: 'square', label: '广场', icon: 'sparkle', render: renderSquare },
  { id: 'search', label: '搜索', icon: 'search', render: renderSearch },
  { id: 'notes', label: '笔记', icon: 'note', render: renderNotes },
  { id: 'me', label: '我的', icon: 'user', render: renderMe },
];
let cur = null;
export function open() {
  const p = page({ app: 'music', id: 'music-square', title: '广场', large: true, back: true, cls: 'as-mu-root' });
  const bar = h('nav.as-chat-tabbar', { role: 'tablist' }, TABS.map(t => h('button.as-chat-tab', { role: 'tab', dataset: { tab: t.id }, onclick: () => switchTab(t.id) }, icon(t.icon, 23, 1.7), h('span', t.label))));
  const mini = miniBar();
  p.el.append(mini.el, bar);
  const off = P.onMusic(() => mini.paint());
  p.el._onLeave = off;
  cur = null; switchTab('square');
  return p.el;

  function switchTab(id) {
    if (cur === id) { p.body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    cur = id;
    const t = TABS.find(x => x.id === id);
    [...bar.children].forEach(b => b.classList.toggle('is-active', b.dataset.tab === id));
    p.el.dataset.asPage = 'music-' + id; p.setTitle(t.label);
    p.body.innerHTML = ''; p.el._onShow = null;
    t.render({ body: p.body, el: p.el });
    mini.paint();
  }
}
function miniBar() {
  const c = h('span.as-mu-mini__cover'), t = h('span.as-mu-mini__title'), btn = h('button.as-mu-mini__btn', { 'aria-label': '播放 / 暂停', onclick: e => { e.stopPropagation(); P.toggle(); } });
  const el = h('div.as-mu-mini', { role: 'button', onclick: openPlayer }, c, t, btn);
  const paint = () => {
    const s = P.current(); el.hidden = !s; if (!s) return;
    c.style.backgroundImage = s.pic ? `url("${s.pic}")` : ''; c.classList.toggle('is-playing', P.playing());
    t.textContent = `${s.name} · ${s.artist}`; btn.replaceChildren(icon(P.playing() ? 'pause' : 'play', 22, 2));
  };
  paint();
  return { el, paint };
}

/* ================= 广场 ================= */
function renderSquare(ctx) {
  const charRow = h('div');
  const paintChars = () => charRow.replaceChildren(group('角色的歌单', [
    toggleItem({ title: '随剧情加歌' }, M().storySongs, v => { M().storySongs = v; commit('music'); commit('inject'); }),
    ...state.contacts.map(c => item({ icon: avatar(c.avatar, nameOf(c), 36), color: 'transparent', cls: 'as-chat-person', title: nameOf(c), value: c.songs && c.songs.length ? `${c.songs.length} 首` : '', chevron: true, onClick: () => openCharList(c) })),
  ], state.contacts.length ? null : '聊天里加了联系人，这里就能看 TA 的歌单'));
  paintChars();
  ctx.body.append(
    group('', [item({ icon: 'heart', color: 'pink', title: '心动模式', sub: '按你喜欢的歌，找风格像的一直放', chevron: true, onClick: heartMode })]),
    charRow,
    group('榜单', P.TOPLISTS.map(([id, name]) => item({ icon: 'flame', color: 'orange', title: name, chevron: true, onClick: () => openRemote(name, id) }))),
    h('div.as-mu-gap'));
  ctx.el._onShow = paintChars;
}
async function heartMode() {
  toast('AI 正在按你的口味挑歌…', true);
  try {
    const songs = await P.heartPick((n, all) => toast(`正在找歌 ${n} / ${all}`, true));
    toast(`挑了 ${songs.length} 首`); P.playList(songs, 0); openPlayer();
  } catch (e) { log('error', '心动模式', e.message); toast(e.message); }
}
function openCharList(c) {
  const p = page({ app: 'music', id: 'music-char', title: `${nameOf(c)}的歌单`, back: true, right: [navBtn('sparkle', 'AI 生成', async e => {
    const b = e.currentTarget; b.disabled = true; toast(`${nameOf(c)}正在挑歌…`, true);
    try { const songs = await P.charPick(c, (n, all) => toast(`正在找歌 ${n} / ${all}`, true)); toast(`加了 ${songs.length} 首`); draw(); }
    catch (err) { log('error', '角色歌单', err.message); toast(err.message); }
    finally { b.disabled = false; }
  })] });
  const box = h('div');
  const draw = () => { const L = c.songs || []; box.replaceChildren(L.length ? h('div', h('button.as-mu-playall', { onclick: () => { P.playList(L, 0); openPlayer(); } }, icon('play', 16, 2), `播放全部（${L.length}）`),
    group('', songRows(L, s => { c.songs = c.songs.filter(x => x.id !== s.id); commit('contacts'); }), '长按一首可以移除')) : empty(`${nameOf(c)}的歌单还是空的`, h('div.as-muted', '右上角让 AI 挑，或者在播放页「加到谁的歌单」'))); };
  draw(); p.body.append(box);
  nav.push(p.el);
}

/* ================= 搜索 ================= */
function renderSearch(ctx) {
  const input = h('input', { placeholder: '搜歌、歌手', enterkeyhint: 'search', onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) go(input.value.trim()); } });
  const hist = h('div');
  const paintHist = () => hist.replaceChildren(...(M().history.length ? [group('搜过的', [h('div.as-mu-chips.as-mu-hist', M().history.map(w => h('button.as-mu-chip', { onclick: () => go(w) }, w)),
    h('button.as-mu-chip.is-x', { 'aria-label': '清空搜索记录', onclick: () => { M().history = []; commit('music'); paintHist(); } }, icon('close', 13, 2.2)))])] : []));
  paintHist();
  ctx.body.append(h('div.as-chat-search', icon('search', 17, 2), input), hist, h('div.as-mu-gap'));
  setTimeout(() => input.focus({ preventScroll: true }), 420);
  async function go(word) {
    input.value = word;
    M().history = [word, ...M().history.filter(x => x !== word)].slice(0, 10); commit('music'); paintHist();
    toast('正在搜…', true);
    try { const songs = await P.search(word); toast(songs.length ? `找到 ${songs.length} 首` : '没搜到'); if (songs.length) openList(`「${word}」`, songs); }
    catch (e) { log('error', '音乐', `搜「${word}」失败：${e.message}`); toast('搜索失败：' + e.message); }
  }
}

/* ================= 我的 ================= */
function renderMe(ctx) {
  const listsBox = h('div');
  const plays = () => Object.values(M().plays).sort((a, b) => b.n - a.n).map(x => x.s);
  const paint = () => listsBox.replaceChildren(group('', [
    item({ icon: 'heart', color: 'pink', title: '我喜欢', value: String(M().liked.length), chevron: true, onClick: () => openList('我喜欢', M().liked, { onRemove: s => P.like(s) }) }),
    ...M().lists.map(l => item({ icon: 'music', color: 'purple', title: l.name, value: l.songs ? String(l.songs.length) : '', chevron: true, onClick: () => openRemote(l.name, l.id, l) })),
    item({ icon: 'plus', color: 'blue', title: '导入网易云歌单', onClick: importList }),
    item({ icon: 'box', color: 'teal', title: '本地', value: String(M().local.length), chevron: true, onClick: openLocal }),
    item({ icon: 'flame', color: 'orange', title: '听歌排行', chevron: true, onClick: () => openList('听歌排行', plays(), { count: s => `${M().plays[s.id].n} 次` }) }),
  ]));
  paint();
  ctx.body.append(h('div.as-mu-me', avatar(myAvatar(), myNick(), 64, 'square'), h('div', h('b', myNick()), h('span', myName()))), listsBox, h('div.as-mu-gap'));
  ctx.el._onShow = paint;

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
function openLocal() {
  const p = page({ app: 'music', id: 'music-local', title: '本地', back: true, right: [navBtn('plus', '上传', async () => {
    const f = await pickFile('audio/*'); if (!f) return;
    try { const s = await P.addLocal(f); toast(`加了《${s.name}》`); draw(); } catch (e) { log('error', '音乐', '上传失败：' + e.message); toast('上传失败：' + e.message); }
  })] });
  const box = h('div');
  const draw = () => { const L = M().local; box.replaceChildren(L.length ? h('div', h('button.as-mu-playall', { onclick: () => { P.playList(L, 0); openPlayer(); } }, icon('play', 16, 2), `播放全部（${L.length}）`),
    group('', songRows(L, s => P.removeLocal(s)), '存在这台设备上，换设备要重新上传；长按一首可以删掉')) : empty('还没有本地的歌', h('div.as-muted', '右上角「+」上传 MP3'))); };
  draw(); p.body.append(box);
  nav.push(p.el);
}

/* ================= 歌曲列表 ================= */
function openList(title, list, { right, onRemove, count } = {}) {
  const p = page({ app: 'music', id: 'music-list', title, back: true, right });
  const rows = count ? list.map((s, i) => item({ icon: cover(s, 42), color: 'transparent', cls: 'as-mu-row', title: s.name, sub: s.artist, value: count(s), onClick: () => { P.playList(list, i); openPlayer(); } })) : songRows(list, onRemove);
  const body = h('div', list.length ? [h('button.as-mu-playall', { onclick: () => { P.playList(list, 0); openPlayer(); } }, icon('play', 16, 2), `播放全部（${list.length}）`), group('', rows, onRemove ? '长按一首可以移除' : null)] : empty('这里还没有歌'));
  p.body.append(body);
  nav.push(p.el);
  return { p, body };
}
/** 榜单 / 导入的歌单：有存过的先马上显示，后台去读新的，读到了再换 */
async function openRemote(name, id, l) {
  const old = (l && l.songs) || await P.cachedList(id);
  const view = old ? openList(name, old, { right: l && delBtn(l) }) : null;
  if (!old) toast('正在读歌单…', true);
  try {
    const songs = await P.playlist(id);
    if (l) { l.songs = songs; commit('music'); }
    if (!view) { toast(`${songs.length} 首`); openList(name, songs, { right: l && delBtn(l) }); return; }
    if (songs.length && (songs.length !== old.length || songs.some((s, i) => s.id !== old[i].id))) {
      const fresh = h('div', h('button.as-mu-playall', { onclick: () => { P.playList(songs, 0); openPlayer(); } }, icon('play', 16, 2), `播放全部（${songs.length}）`), group('', songRows(songs)));
      view.body.replaceWith(fresh); view.body = fresh;
    }
  } catch (e) {
    log('error', '音乐', `读「${name}」失败：${e.message}`);
    if (!view) toast('读不到：' + e.message);
  }
  function delBtn(list) {
    return [navBtn('trash', '删除歌单', async () => {
      if (!(await dialog({ title: `删除「${list.name}」？`, text: '只是从这里拿掉，网易云里的歌单不受影响。', confirm: '删除', danger: true }))) return;
      M().lists.splice(M().lists.indexOf(list), 1); commit('music'); nav.pop();
    })];
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
  const p = page({ app: 'music', id: 'music-player', title: '', back: true, cls: 'as-mp', right: [navBtn('more', '更多', menu)] });
  const bg = h('div.as-mp__bg'), cov = h('div.as-mp__cover'), disc = h('div.as-mp__disc' + (S.disc === 'vinyl' ? '.is-vinyl' : ''), cov);
  const arm = h('div.as-mp__arm'); arm.innerHTML = ARM;
  const name = h('div.as-mp__name'), artist = h('div.as-mp__artist');
  const heart = h('button.as-mp__heart', { 'aria-label': '喜欢', onclick: () => { const on = P.like(); heart.classList.toggle('is-on', on); toast(on ? '加到我喜欢了' : '从我喜欢里拿掉了'); } }, icon('heart', 26, 1.8));
  const l1 = h('div.as-mp__l1'), l2 = h('div.as-mp__l2'), lyr = h('div.as-mp__lyric', l1, l2);
  onLongPress(lyr, collectLyrics);
  const bar = h('input.as-mp__bar', { type: 'range', min: 0, max: 1000, value: 0 }), t0 = h('span'), t1 = h('span');
  let dragging = false;
  bar.addEventListener('input', () => { dragging = true; t0.textContent = fmt(bar.value / 1000 * P.audio.duration); });
  bar.addEventListener('change', () => { dragging = false; P.seek(bar.value / 1000 * P.audio.duration); });
  const playBtn = h('button.as-mp__play', { 'aria-label': '播放 / 暂停', onclick: () => P.toggle() });
  const mode = () => P.MODES.find(m => m[0] === M().mode) || P.MODES[0];
  const modeBtn = h('button', { 'aria-label': '播放顺序', onclick: () => { const m = P.cycleMode(); modeBtn.replaceChildren(icon(m[2], 24, 1.8)); toast(m[1]); } }, icon(mode()[2], 24, 1.8));
  p.el.prepend(bg);
  p.body.append(h('div.as-mp__stage', disc, arm), lyr,
    h('div.as-mp__info', h('div', name, artist), heart),
    h('div.as-mp__prog', bar, h('div.as-mp__times', t0, t1)),
    h('div.as-mp__ctrl', modeBtn, h('button', { 'aria-label': '上一首', onclick: () => P.prev() }, icon('prev', 26, 1.8)), playBtn,
      h('button', { 'aria-label': '下一首', onclick: () => P.next() }, icon('next', 26, 1.8)), h('button', { 'aria-label': '播放列表', onclick: openQueue }, icon('list', 24, 1.8))));

  const paintBg = () => { bg.style.backgroundImage = `url("${S.bg || (P.current() || {}).pic || ''}")`; bg.classList.toggle('is-custom', !!S.bg); };
  const paintSong = () => {
    const s = P.current(); if (!s) return;
    name.textContent = s.name; artist.textContent = s.artist; cov.style.backgroundImage = s.pic ? `url("${s.pic}")` : '';
    heart.classList.toggle('is-on', P.liked(s)); paintBg(); li = -2; tick();
  };
  const paintState = () => { const on = P.playing(); playBtn.replaceChildren(icon(on ? 'pause' : 'play', 30, 2.2)); disc.classList.toggle('is-playing', on); arm.classList.toggle('is-up', !on); loop(); };
  // 歌词：唱到哪一句、这一句唱了几成（有逐字时间以前，按这句的长短估一个，从左往右亮起来）
  let li = -2, raf = 0;
  function tick() {
    const a = P.audio, t = a.currentTime || 0, d = a.duration || 0, L = P.lyricsNow();
    if (!dragging) { bar.value = d ? t / d * 1000 : 0; t0.textContent = fmt(t); }
    t1.textContent = fmt(d);
    let i = -1; while (i + 1 < L.length && L[i + 1].t <= t) i++;
    if (i !== li) { li = i; l1.textContent = L.length ? (i >= 0 ? L[i].text : '') : (P.current().local ? '本地的歌没有歌词' : '纯音乐，或者没找到歌词'); l2.textContent = L[i + 1] ? L[i + 1].text : ''; }
    const cur = L[i]; if (cur) { const len = Math.min((L[i + 1] ? L[i + 1].t : cur.t + 5) - cur.t, cur.text.length * .45 + .6); l1.style.setProperty('--p', Math.min(100, (t - cur.t) / len * 100) + '%'); }
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
  async function menu() {
    const s = P.current();
    const v = await actionSheet('', [
      { value: 'glass', label: '玻璃唱片', active: S.disc !== 'vinyl' }, { value: 'vinyl', label: '黑胶唱片', active: S.disc === 'vinyl' },
      { value: 'bg', label: '换背景图', icon: 'image' }, ...(S.bg ? [{ value: 'nobg', label: '背景跟着封面变色', icon: 'palette' }] : []),
      { value: 'char', label: '加到谁的歌单', icon: 'users' }, { value: 'note', label: '收进笔记', icon: 'note' }, ...(s.local ? [] : [{ value: 'hot', label: '看热评', icon: 'comment' }]),
    ]);
    if (v === 'glass' || v === 'vinyl') { S.disc = v; disc.classList.toggle('is-vinyl', v === 'vinyl'); commit('music'); }
    if (v === 'bg') { const img = await pickImage('播放页背景', { ratio: 'screen', size: 1100, has: !!S.bg }); if (img != null) { S.bg = img; commit('music'); paintBg(); } }
    if (v === 'nobg') { S.bg = ''; commit('music'); paintBg(); }
    if (v === 'note') collectLyrics();
    if (v === 'char') {
      if (!state.contacts.length) { toast('还没有联系人'); return; }
      const c = await actionSheet('加到谁的歌单', state.contacts.map(c => ({ value: c.id, label: nameOf(c), active: (c.songs || []).some(x => x.id === s.id) })));
      const who = c && state.contacts.find(x => x.id === c); if (!who) return;
      toast(P.addToChar(who, s) ? `加到${nameOf(who)}的歌单了` : `${nameOf(who)}的歌单里已经有了`);
    }
    if (v === 'hot') {
      toast('正在拿热评…', true);
      try { const list = await P.hotComments(s.id); if (!list.length) throw new Error('没有热评'); toast(`${list.length} 条热评`);
        sheet({ title: '热评', content: h('div.as-mu-reviews.as-mu-hot', list.map(c => h('div.as-mu-review', avatar('', c.name, 34), h('div', h('div.as-mu-review__name', c.name, h('span', `♡ ${c.likes}`)), h('div.as-mu-review__text', c.text))))) }); }
      catch (e) { log('warn', '音乐', '拿热评失败：' + e.message); toast('拿不到热评：' + e.message); }
    }
  }
  paintSong(); paintState();
  const off = P.onMusic(w => { if (w === 'song' || w === 'lyrics') paintSong(); if (w === 'state') paintState(); if (w === 'time' && !P.playing()) tick(); });
  p.el._onShow = loop;
  p.el._onLeave = () => { off(); cancelAnimationFrame(raf); };
  nav.push(p.el);
}
function openQueue() {
  const Q = M().queue;
  const s = sheet({ title: `播放列表（${Q.length}）`, content: h('div.as-mu-queue', Q.map((x, i) => h('button.as-mu-queue__row' + (i === M().idx ? '.is-cur' : ''), { onclick: () => { P.jump(i); s.close(); } },
    h('b', x.name), h('span', x.artist)))) });
  setTimeout(() => s.el.querySelector('.is-cur')?.scrollIntoView({ block: 'center' }), 50);
}
