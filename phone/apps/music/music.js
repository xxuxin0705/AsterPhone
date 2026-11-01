// 音乐 App：首页（搜索、我的歌单、榜单、最近播放、迷你播放条）、歌曲列表、播放页（唱片皮肤）、播放列表。
// 播放本体在 core/music.js，关掉这个 App 也接着放。
import { h } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, icon, navBtn, actionSheet, dialog, toast, empty, sheet, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { log } from '../../core/log.js';

const M = () => state.music;
const fmt = s => isFinite(s) && s > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '00:00';
const cover = (s, size) => h('span.as-mu-cover', { style: { width: size + 'px', height: size + 'px', backgroundImage: s && s.pic ? `url("${s.pic}")` : '' } });
const songRows = list => list.map((s, i) => item({ icon: cover(s, 42), color: 'transparent', cls: 'as-mu-row', title: s.name, sub: s.artist, onClick: () => { P.playList(list, i); openPlayer(); } }));
P.onMusic(w => { if (w === 'blocked') toast('点一下播放键开始放'); if (w === 'error') toast(`《${(P.current() || {}).name || ''}》放不出来，跳下一首`); });

/* ---------- 首页 ---------- */
export function open() {
  const p = page({ app: 'music', id: 'music-home', title: '音乐', large: true, back: true });
  const input = h('input', { placeholder: '搜歌、歌手', enterkeyhint: 'search', onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) openSearch(input.value.trim()); } });
  const listsBox = h('div'), recentBox = h('div');
  const paintLists = () => listsBox.replaceChildren(group('我的歌单', [
    item({ icon: 'heart', color: 'pink', title: '我喜欢', value: String(M().liked.length), chevron: true, onClick: () => openList('我喜欢', M().liked) }),
    ...M().lists.map(l => item({ icon: 'music', color: 'purple', title: l.name, value: l.songs ? String(l.songs.length) : '', chevron: true, onClick: () => openRemote(l.name, l.id, l) })),
    item({ icon: 'plus', color: 'blue', title: '导入网易云歌单', onClick: importList }),
  ]));
  const paintRecent = () => recentBox.replaceChildren(...(M().recent.length ? [group('最近播放', songRows(M().recent.slice(0, 10)))] : []));
  paintLists(); paintRecent();
  p.body.append(h('div.as-chat-search', icon('search', 17, 2), input), listsBox,
    group('榜单', P.TOPLISTS.map(([id, name]) => item({ icon: 'flame', color: 'orange', title: name, chevron: true, onClick: () => openRemote(name, id) }))),
    recentBox, h('div.as-mu-gap'));
  const mini = miniBar(); p.el.append(mini.el);
  const off = P.onMusic(w => { if (w === 'song') paintRecent(); mini.paint(); });
  p.el._onShow = () => { paintLists(); mini.paint(); };
  p.el._onLeave = off;
  return p.el;

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
      M().lists.push({ id, name: name.trim() || '网易云歌单', songs }); commit('music'); paintLists(); toast(`导入了 ${songs.length} 首`);
    } catch (e) { log('error', '音乐', '导入歌单失败：' + e.message); toast('导入失败：' + e.message); }
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

/* ---------- 歌曲列表 ---------- */
function openList(title, list, right) {
  const p = page({ app: 'music', id: 'music-list', title, back: true, right });
  p.body.append(list.length ? h('div', h('button.as-mu-playall', { onclick: () => { P.playList(list, 0); openPlayer(); } }, icon('play', 16, 2), `播放全部（${list.length}）`), group('', songRows(list))) : empty('这里还没有歌'));
  nav.push(p.el);
}
async function openRemote(name, id, l) {
  toast('正在读歌单…', true);
  let songs;
  try { songs = await P.playlist(id); toast(`${songs.length} 首`); if (l) { l.songs = songs; commit('music'); } }
  catch (e) {
    log('error', '音乐', `读「${name}」失败：${e.message}`);
    if (!l || !l.songs) { toast('读不到：' + e.message); return; }
    songs = l.songs; toast('读不到最新的，先显示上次存的');
  }
  openList(name, songs, l ? [navBtn('trash', '删除歌单', async () => {
    if (!(await dialog({ title: `删除「${l.name}」？`, text: '只是从这里拿掉，网易云里的歌单不受影响。', confirm: '删除', danger: true }))) return;
    M().lists.splice(M().lists.indexOf(l), 1); commit('music'); nav.pop();
  })] : null);
}
async function openSearch(word) {
  toast('正在搜…', true);
  try { const songs = await P.search(word); toast(songs.length ? `找到 ${songs.length} 首` : '没搜到'); openList(`「${word}」`, songs); }
  catch (e) { log('error', '音乐', `搜「${word}」失败：${e.message}`); toast('搜索失败：' + e.message); }
}

/* ---------- 播放页 ---------- */
// 唱臂：照网易云那支画的（顶上小圆轴，细臂往右下弯，末端小方块唱头）
const ARM = '<svg viewBox="0 0 130 130" aria-hidden="true"><circle cx="30" cy="20" r="17" fill="rgba(0,0,0,.12)"/><circle cx="30" cy="20" r="11" fill="#fff"/><circle cx="30" cy="20" r="4" fill="#d9d9d9"/>'
  + '<path d="M30 30C30 62 55 86 100 98" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>'
  + '<g transform="rotate(-58 106 104)"><rect x="96" y="90" width="20" height="30" rx="4" fill="#fff"/><path d="M102 108v7M110 108v7" stroke="#c9c9c9" stroke-width="2" stroke-linecap="round"/></g></svg>';
export function openPlayer() {
  if (!P.current()) { toast('还没有在放的歌'); return; }
  const S = M().skin;
  const p = page({ app: 'music', id: 'music-player', title: '', back: true, cls: 'as-mp', right: [navBtn('more', '样式', skinMenu)] });
  const bg = h('div.as-mp__bg'), cov = h('div.as-mp__cover'), disc = h('div.as-mp__disc' + (S.disc === 'vinyl' ? '.is-vinyl' : ''), cov);
  const arm = h('div.as-mp__arm'); arm.innerHTML = ARM;
  const name = h('div.as-mp__name'), artist = h('div.as-mp__artist');
  const heart = h('button.as-mp__heart', { 'aria-label': '喜欢', onclick: () => { const on = P.like(); heart.classList.toggle('is-on', on); toast(on ? '加到我喜欢了' : '从我喜欢里拿掉了'); } }, icon('heart', 26, 1.8));
  const l1 = h('div.as-mp__l1'), l2 = h('div.as-mp__l2');
  const bar = h('input.as-mp__bar', { type: 'range', min: 0, max: 1000, value: 0 }), t0 = h('span'), t1 = h('span');
  let dragging = false;
  bar.addEventListener('input', () => { dragging = true; t0.textContent = fmt(bar.value / 1000 * P.audio.duration); });
  bar.addEventListener('change', () => { dragging = false; P.seek(bar.value / 1000 * P.audio.duration); });
  const playBtn = h('button.as-mp__play', { 'aria-label': '播放 / 暂停', onclick: () => P.toggle() });
  const mode = () => P.MODES.find(m => m[0] === M().mode) || P.MODES[0];
  const modeBtn = h('button', { 'aria-label': '播放顺序', onclick: () => { const m = P.cycleMode(); modeBtn.replaceChildren(icon(m[2], 24, 1.8)); toast(m[1]); } }, icon(mode()[2], 24, 1.8));
  p.el.prepend(bg);
  p.body.append(h('div.as-mp__stage', disc, arm), h('div.as-mp__lyric', l1, l2),
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
    if (i !== li) { li = i; l1.textContent = L.length ? (i >= 0 ? L[i].text : '') : '纯音乐，或者没找到歌词'; l2.textContent = L[i + 1] ? L[i + 1].text : ''; }
    const cur = L[i]; if (cur) { const len = Math.min((L[i + 1] ? L[i + 1].t : cur.t + 5) - cur.t, cur.text.length * .45 + .6); l1.style.setProperty('--p', Math.min(100, (t - cur.t) / len * 100) + '%'); }
  }
  function loop() {
    cancelAnimationFrame(raf);
    const go = () => { tick(); if (P.playing() && !p.el.classList.contains('is-behind')) raf = requestAnimationFrame(go); };
    go();
  }
  async function skinMenu() {
    const v = await actionSheet('播放页样式', [
      { value: 'glass', label: '玻璃唱片', active: S.disc !== 'vinyl' }, { value: 'vinyl', label: '黑胶唱片', active: S.disc === 'vinyl' },
      { value: 'bg', label: '换背景图', icon: 'image' }, ...(S.bg ? [{ value: 'nobg', label: '背景跟着封面变色', icon: 'palette' }] : []),
    ]);
    if (v === 'glass' || v === 'vinyl') { S.disc = v; disc.classList.toggle('is-vinyl', v === 'vinyl'); commit('music'); }
    if (v === 'bg') { const img = await pickImage('播放页背景', { ratio: 'screen', size: 1100, has: !!S.bg }); if (img != null) { S.bg = img; commit('music'); paintBg(); } }
    if (v === 'nobg') { S.bg = ''; commit('music'); paintBg(); }
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
