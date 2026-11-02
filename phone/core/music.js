// 音乐的播放器本体：关掉音乐 App、收起手机都接着放。
// 音源（照旧插件）：vkeys 搜歌；Meting 取播放链接、歌词、歌单。地址在 state.music.src 里能改。
// 播放链接直接塞给 <audio>（放别人家的音乐文件不会被跨域拦）；只有搜歌、歌词、歌单要读内容，走 xf（被拦时借酒馆代理）。
// 角色的歌单存在联系人身上（c.songs，跟着聊天窗口走）；笔记在 state.musicNotes（也跟窗口走）。
import { state, commit, kvGet, kvSet, kvDel, contact } from './store.js';
import { xf, generate, resolveConn } from './api.js';
import { log } from './log.js';
import { compose } from './promptstore.js';
import { uid } from './util.js';
import { ctx } from './bridge.js';

export const DEF_SRC = { vkeys: 'https://api.vkeys.cn/v2/music/netease', meting: 'https://api.qijieya.cn/meting/' };
export const TOPLISTS = [['19723756', '飙升榜'], ['3779629', '新歌榜'], ['3778678', '热歌榜'], ['2884035', '原创榜']];
const M = () => state.music;
const src = k => (M().src && M().src[k]) || DEF_SRC[k];
const q = (base, p) => base + (base.includes('?') ? '&' : '?') + new URLSearchParams(p);
const https = u => String(u || '').replace(/^http:\/\//i, 'https://');
const meting = (type, id) => q(src('meting'), { server: 'netease', type, id });
// 慢的那一步记进日志（超过 1.5 秒），好知道到底卡在哪：搜歌、读歌单、拿歌词，还是开始出声
const slow = (what, t0) => { const s = (Date.now() - t0) / 1000; if (s > 1.5) log('warn', '音乐', `${what}用了 ${s.toFixed(1)} 秒`); };
async function get(url, as = 'json', what = '读音源') {
  const t0 = Date.now(), r = await xf(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const out = await (as === 'json' ? r.json() : r.text()); slow(what, t0);
  return out;
}
export const label = s => `${s.name} - ${s.artist}`;

/* ---------- 酒馆插件（只有本地酒馆能装）：装了就让它替手机连网易云，登录后会员歌也能放 ----------
 * 没装、或者在 Tauri Tavern 里，问一次就知道（回的不是它的 JSON），之后全走上面的公共音源。 */
const BE = '/api/plugins/asterphone';
export let ne = null;   // null = 没有插件；{ me } = 有插件（me 为空 = 没登录）
async function be(p, post) {
  const r = await fetch(BE + p, post ? { method: 'POST', headers: { ...(ctx()?.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' }, body: JSON.stringify(post) } : {});
  if (!/json/.test(r.headers.get('content-type') || '')) throw new Error('没装酒馆插件');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
export const neReady = be('/status').then(j => { ne = j; tell('ne'); }, () => {});
export const neQr = () => be('/qr');
export const neQrCheck = key => be('/qr/check?key=' + encodeURIComponent(key)).then(j => { if (j.me) { ne.me = j.me; tell('ne'); } return j; });
export const neCookie = cookie => be('/cookie', { cookie }).then(j => { ne.me = j.me; tell('ne'); });
export const neLogout = () => be('/logout', {}).then(() => { ne.me = null; tell('ne'); });
export const neDaily = () => be('/daily');
export const neLists = () => be('/playlists');

/* ---------- 找歌 ---------- */
export async function search(word) {
  if (ne) try { return await be('/search?word=' + encodeURIComponent(word)); } catch (e) { log('warn', '音乐', '插件搜歌失败，改用公共音源：' + e.message); }
  const j = await get(q(src('vkeys'), { word, page: 1, num: 30 }), 'json', `搜「${word}」`);
  return (j.data || []).map(x => ({ id: String(x.id || ''), name: x.song || x.name || '', artist: x.singer || x.artist || '未知歌手', pic: https(x.cover || x.pic) })).filter(s => s.id && s.name);
}
/** 按「歌名 - 歌手」找一首（AI 挑的歌、正文里提到的歌都走这）；找不到就是 null */
export async function findSong(text) {
  const [name, artist = ''] = String(text).split(/\s[-–—]\s|[-–—]/).map(s => s.trim());
  if (!name) return null;
  const list = await search(artist ? `${name} ${artist}` : name).catch(() => []);
  return list.find(s => s.name.toLowerCase() === name.toLowerCase()) || list[0] || null;
}
/** 歌单 / 榜单：读过的存在这台设备上，下次先给存的（马上出来），再去读新的 */
export async function playlist(id) {
  const j = ne ? await be('/playlist?id=' + id).catch(() => null) : null;
  const out = j && j.length ? j : (await get(meting('playlist', id), 'json', '读歌单').then(j => Array.isArray(j) ? j : [])).map(x => ({ id: String(x.id || (String(x.url).match(/id=(\d+)/) || [])[1] || ''), name: x.name || x.title || '', artist: x.artist || x.author || '未知歌手', pic: https(x.pic) })).filter(s => s.id && s.name);
  if (out.length) kvSet('mulist:' + id, out).catch(() => {});
  return out;
}
export const cachedList = id => kvGet('mulist:' + id).catch(() => null);
/** 从网易云分享链接 / 一串数字里找出歌单编号 */
/** 分享出来的短链接（163cn.tv）要先问出它跳到哪：网页自己问不了（跨域）。装了酒馆插件让插件问；
 *  没装（Tauri）就借公共的跨域转发 allorigins 问一下（别人家的服务，问不到就请作者手动复制长链接） */
export async function playlistIdOf(text) {
  const id = playlistId(text), short = (String(text).match(/https?:\/\/163cn\.tv\/\w+/) || [])[0];
  if (id || !short) return id;
  if (ne) return playlistId((await be('/resolve?url=' + encodeURIComponent(short))).url);
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(short));
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const j = await r.json(); slow('解析短链接', t0);
    const got = playlistId((j.status || {}).url) || playlistId(j.contents);
    if (got) return got;
    throw new Error('转发回来的内容里没有歌单');
  } catch (e) {
    log('error', '音乐', '解析短链接失败（allorigins）：' + e.message);
    throw new Error('短链接没解析出来，先在浏览器里打开它，把地址栏的链接复制过来');
  }
}
export const playlistId = t => ((String(t).match(/playlist[^0-9]*?(?:id=)?(\d{5,})/i) || String(t).match(/[?&]id=(\d{5,})/) || String(t).trim().match(/^(\d{5,})$/)) || [])[1] || '';
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, '').trim(); if (!t) continue;   // 有的歌词时间写成 [01:02:30]（冒号）
    // 外语歌音源把翻译接在后面括号里：「原文 (中文)」→ 拆成原文和翻译两行
    const m = t.match(/^(.*?)\s*[(（]([^()（）]*)[)）]$/), tr = m && /[\u3040-\u30ffA-Za-z\uac00-\ud7af]/.test(m[1]) && /[\u4e00-\u9fff]/.test(m[2]) && !/[\u3040-\u30ff]/.test(m[2]);
    for (const x of line.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) out.push({ t: +x[1] * 60 + +x[2] + +('0.' + (x[3] || 0)), text: tr ? m[1] : t, tr: tr ? m[2] : '' });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** 网易云逐字歌词：[句开始,句时长](字开始,字时长,0)字(…)字…，单位毫秒 */
export function parseYrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\[(\d+),\d+\](.*)/); if (!m) continue;
    const w = [...m[2].matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)].map(x => ({ t: x[1] / 1000, d: x[2] / 1000, text: x[3] })).filter(x => x.text.trim());
    if (w.length) out.push({ t: m[1] / 1000, text: w.map(x => x.text).join('').trim(), tr: '', w });
  }
  return out;
}
/** 第 i 句里每一块（字 / 词）几点落地：有逐字时间就用真的；没有就按最早那版的速度估（一块约 0.45 秒），
 * 再整体晚 LAG 秒——最早那版字是唱到才开始掉、0.75 秒后落地，作者觉得那个速度对，只是要再早零点几秒 */
export const LAG = .45;
export function wordTimes(L, i, parts) {
  const x = L[i]; if (x.w) return x.w.map(w => w.t);
  const step = est(L, i, parts) * .9 / parts;
  return Array.from({ length: parts }, (_, j) => x.t + LAG + j * step);
}
const est = (L, i, parts) => Math.min((L[i + 1] ? L[i + 1].t : L[i].t + 5) - L[i].t, parts * .45 + .6);
/** 第 i 句唱了几成（0～1），歌词从左往右亮用 */
export function sung(L, i, t) {
  const x = L[i];
  if (!x.w) return Math.min(1, (t - x.t) / est(L, i, x.text.replace(/\s/g, '').length || 1));
  let got = 0, all = 0;
  for (const w of x.w) { all += w.text.length; got += w.text.length * Math.min(1, Math.max(0, (t - w.t) / (w.d || .05))); }
  return got / all;
}
/** 网易云的热评：网页直连多半会被拦，能不能拿到要在真机上试 */
export async function hotComments(id) {
  const j = ne ? await be('/comments?id=' + id) : await get(`https://music.163.com/api/v1/resource/comments/R_SO_4_${id}?limit=20`, 'json', '拿热评');
  return (j.hotComments || j.comments || []).map(c => ({ name: (c.user || {}).nickname || '网友', text: c.content, likes: c.likedCount || 0 }));
}

/* ---------- 本地 MP3（存在这台设备上） ---------- */
export async function addLocal(file) {
  const [a, b] = file.name.replace(/\.[^.]+$/, '').split(/\s-\s|-/).map(s => s.trim());
  const s = { id: 'L' + uid(''), name: b || a || file.name, artist: b ? a : '本地', pic: '', local: true, size: file.size };
  await kvSet('mufile:' + s.id, file);
  M().local.unshift(s); commit('music');
  return s;
}
export async function removeLocal(s) { M().local = M().local.filter(x => x.id !== s.id); commit('music'); await kvDel('mufile:' + s.id); }

/* ---------- 放 ----------
 * 后台接着放：夸克 / UC / Via、Tauri Tavern 这些，切到别的应用后不让「新开始」的声音出声，放完一首就停了。
 * 所以把歌的内容边下边续进同一条声音（MediaSource）：这首快放完时把下一首接在后面，声音从头到尾没断过，整首都放完。
 * 读不到文件、浏览器不支持、或者不是 mp3，就退回普通放法（直接把地址给播放器）。 */
export const audio = new Audio();
audio.preload = 'auto';
const CHAIN = !!(window.MediaSource && MediaSource.isTypeSupported('audio/mpeg'));
let lyrics = [], fails = 0, restored = false;
let chain = null;   // { ms, sb, ops, segs: [{ i: 队列里第几首, s: 歌, start, end }], ac, nexting }
const subs = new Set();
export const onMusic = f => { subs.add(f); return () => subs.delete(f); };
const tell = what => subs.forEach(f => { try { f(what); } catch (e) { console.error(e); } });
export const current = () => M().queue[M().idx] || null;
export const lyricsNow = () => lyrics;
export const playing = () => !audio.paused;
// 续接时一条声音里有好几首：这首歌自己的时间 = 整条的时间 - 这首开始的地方
const seg = () => chain && chain.segs.find(g => g.i === M().idx && g.s === current());
export const now = () => Math.max(0, (audio.currentTime || 0) - (seg()?.start || 0));
export const dur = () => { const g = seg(); return g ? (g.end || audio.duration || 0) - (g.start || 0) : audio.duration || 0; };   // 还在下的那首，先按已经下到的算

/** 放一组歌，从第 i 首开始；from 是从哪个歌单放的（播放页顶上显示） */
export function playList(list, i = 0, from = '') { M().queue = list.slice(); M().idx = i; M().from = from; fails = 0; load(true); }
/** 换到一首歌（不管声音怎么来）：记最近、次数，系统的正在播放，拿歌词 */
function enter(s) {
  lyrics = []; tell('song');
  M().recent = [s, ...M().recent.filter(x => x.id !== s.id)].slice(0, 50);
  const pl = M().plays[s.id] || (M().plays[s.id] = { n: 0, s }); pl.n++; commit('music');
  sysInfo(s);
  if (s.local) return;
  // 普通歌词先出来；逐字的（每个字几点唱）到了再换上，翻译从普通歌词里按时间配过去
  let base = [], yrc = [];
  const done = () => { if (current() !== s) return; lyrics = yrc.length ? yrc.map(x => ({ ...x, tr: (base.find(b => Math.abs(b.t - x.t) < 1) || {}).tr || '' })) : base; tell('lyrics'); };
  if (ne) be('/lyric?id=' + s.id).then(j => {
    const tr = parseLrc(j.tr);
    base = parseLrc(j.lrc).map(x => ({ ...x, tr: x.tr || (tr.find(y => Math.abs(y.t - x.t) < .3) || {}).text || '' }));
    yrc = parseYrc(j.yrc); done();
  }).catch(e => log('warn', '音乐', `《${s.name}》的歌词没拿到：${e.message}`));
  else get(meting('lrc', s.id), 'text', '拿歌词').then(t => { const L = parseLrc(t); if (L.length >= base.length) base = L; done(); })
    .catch(e => log('warn', '音乐', `《${s.name}》的歌词没拿到：${e.message}`));
  if (!ne) get(q(src('vkeys') + '/lyric', { id: s.id }), 'json', '拿逐字歌词').then(j => {
    const d = j.data || {}, y = (d.yrc && d.yrc.lyric) || d.yrc, l = (d.lrc && d.lrc.lyric) || d.lrc;
    yrc = typeof y === 'string' ? parseYrc(y) : [];
    // 有的歌 Meting 给的歌词只有作词作曲那几行：vkeys 这份更全就用它
    const alt = typeof l === 'string' ? parseLrc(l) : [];
    if (alt.length > base.length) base = alt;
    if (yrc.length || base === alt) done();
  }).catch(e => log('warn', '音乐', `《${s.name}》的逐字歌词没拿到：${e.message}`));
}
async function load(autoplay) {
  const s = current(); if (!s) return;
  restored = true; enter(s);
  const t0 = Date.now(); audio.addEventListener('playing', () => slow(`《${s.name}》从点下去到出声`, t0), { once: true });
  if (chain) { chain.ac.abort(); chain = null; }
  const f = s.local ? await kvGet('mufile:' + s.id).catch(() => null) : null;
  if (s.local && !f) { log('error', '音乐', `本地的《${s.name}》找不到文件了`); tell('error'); return; }
  if (current() !== s) return;
  if (CHAIN && (!s.local || f.type === 'audio/mpeg') && await startChain(s, f, autoplay)) return;
  plain(s, f, autoplay);
}
/** 普通放法：先试 Meting 的链接，不行再试网易云外链；都放不出来就跳下一首（会员歌、下架的歌常这样） */
function plain(s, f, autoplay) {
  const urls = f ? [URL.createObjectURL(f)] : [...(ne ? [`${BE}/audio?id=${s.id}`] : []), meting('url', s.id), `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`];
  const tryUrl = i => {
    audio.onerror = () => {
      if (i + 1 < urls.length) return tryUrl(i + 1);
      log('error', '音乐', `《${s.name}》放不出来（可能是会员歌曲，或者音源挂了）`); tell('error');
      if (++fails < Math.min(5, M().queue.length)) next(); else fails = 0;
    };
    audio.src = urls[i];
    if (autoplay) audio.play().catch(blocked);
  };
  tryUrl(0);
}
/** 续接：开一条新声音，把这首边下边续进去。头一段到了就开始放；读不到文件返回 false */
async function startChain(s, f, autoplay) {
  const ms = new MediaSource(), ac = new AbortController();
  const c = { ms, ac, segs: [], ops: [], nexting: false };
  const body = await songBody(s, f, ac.signal).catch(() => null);
  if (!body || current() !== s) return false;
  chain = c; audio.onerror = null;
  audio.src = URL.createObjectURL(ms);
  await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }));
  try { c.sb = ms.addSourceBuffer('audio/mpeg'); c.sb.mode = 'sequence'; }
  catch (e) { log('warn', '音乐', '这个浏览器续接不了：' + e.message); chain = null; ac.abort(); return false; }
  c.sb.addEventListener('updateend', () => run(c));
  feed(c, M().idx, s, body, () => { if (autoplay) audio.play().catch(blocked); });
  return true;
}
/** 歌曲文件的内容（边下边读）；不是 mp3 就不要 */
async function songBody(s, f, signal) {
  if (f) return f.stream();
  let r = ne ? await fetch(`${BE}/audio?id=${s.id}`, { signal }).catch(() => null) : null;
  if (!r || !r.ok) r = await fetch(meting('url', s.id), { signal });
  if (!r.ok || !/mpeg|mp3/.test(r.headers.get('content-type') || '')) throw new Error('不是 mp3');
  return r.body;
}
// 往同一条声音里续东西要一件一件来（上一件没弄完不能动）
function op(c, fn) { c.ops.push(fn); run(c); }
function run(c) { if (c === chain && !c.sb.updating && c.ops.length) c.ops.shift()(); }
/** 把一首歌的内容一段段续进去；记下它在整条声音里从哪到哪 */
async function feed(c, i, s, body, first) {
  const g = { i, s, start: null, end: 0 };
  c.segs.push(g);
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (c !== chain) return reader.cancel();
      if (done) break;
      op(c, () => { if (g.start == null) g.start = c.sb.timestampOffset; c.sb.appendBuffer(value); });
      if (first) { const f0 = first; first = null; op(c, () => { f0(); run(c); }); }
    }
    op(c, () => { g.end = c.sb.timestampOffset; tell('time'); run(c); });
  } catch (e) {
    if (c !== chain) return;
    log('warn', '音乐', `《${s.name}》读到一半断了：${e.message}`);
    op(c, () => { g.end = c.sb.timestampOffset; run(c); });
  }
}
/** 这首快放完了：把下一首续在后面。下一首读不到就封口，放完走普通放法 */
async function chainNext(c) {
  c.nexting = true;
  let i = pick(M().idx, true);
  for (let k = 0; k < 3; k++, i = pick(i, true)) {
    const s = M().queue[i], f = s.local ? await kvGet('mufile:' + s.id).catch(() => null) : null;
    if (s.local && (!f || f.type !== 'audio/mpeg')) continue;
    const body = await songBody(s, f, c.ac.signal).catch(() => null);
    if (c !== chain) return;
    if (body) return feed(c, i, s, body);
  }
  op(c, () => { if (c.ms.readyState === 'open') c.ms.endOfStream(); });
}
/** 下一首是第几首；auto = 放完自动换（单曲循环就还是这首） */
function pick(i, auto) {
  const n = M().queue.length;
  if (auto && M().mode === 'one') return i;
  return M().mode === 'shuffle' && n > 1 ? (i + 1 + Math.floor(Math.random() * (n - 1))) % n : (i + 1) % n;
}

export function toggle() {
  if (!current()) return;
  if (!restored) { const pos = M().pos || 0; load(true); audio.addEventListener('loadedmetadata', () => seek(pos), { once: true }); return; }   // 刚打开手机：接着上次的地方
  audio.paused ? audio.play().catch(() => tell('blocked')) : audio.pause();
}
export function next(step = 1) {
  const n = M().queue.length; if (!n) return;
  M().idx = step === 1 ? pick(M().idx, false) : (M().idx + step + n) % n;
  load(true);
}
export const prev = () => now() > 4 ? seek(0) : next(-1);
export function seek(t) { if (restored) audio.currentTime = (seg()?.start || 0) + t; }
export function jump(i) { M().idx = i; load(true); }
export const MODES = [['list', '列表循环', 'repeat'], ['one', '单曲循环', 'repeatOne'], ['shuffle', '随机播放', 'shuffle']];
export function cycleMode() { const i = MODES.findIndex(m => m[0] === M().mode); M().mode = MODES[(i + 1) % MODES.length][0]; commit('music'); return MODES[(i + 1) % MODES.length]; }
export function like(s = current()) {
  if (!s) return false;
  const L = M().liked, i = L.findIndex(x => x.id === s.id);
  i < 0 ? L.unshift(s) : L.splice(i, 1); commit('music');
  // 登录了网易云：红心同步过去
  if (ne?.me && !s.local) be('/like', { id: s.id, like: i < 0 }).catch(e => log('warn', '音乐', `红心没同步到网易云：${e.message}`));
  return i < 0;
}
export const liked = s => !!s && M().liked.some(x => x.id === s.id);

// 听歌时长（「我的」里的小时数）：两次 timeupdate 之间真的在放才算
let saveT = 0, lastT = 0, heard = 0;
audio.addEventListener('timeupdate', () => {
  const t = Date.now(); if (t - lastT < 2000) heard += t - lastT; lastT = t;
  if (t - saveT > 5000) {
    saveT = t; M().pos = now(); M().heard = (M().heard || 0) + heard / 1000;
    const tc = together(); if (tc) tgTimes()[tc.id] = (tgTimes()[tc.id] || 0) + heard / 1000;
    heard = 0; commit('music');
  }
  const c = chain, g = seg();
  if (c && g) {
    // 还剩 40 秒：去把下一首续上（读文件要时间）
    if (!c.nexting && g.end && g.end - audio.currentTime < 40) chainNext(c);
    // 放进了下一首：换歌名、歌词，把前一首的内容从这条声音里清掉（省内存）
    const nx = c.segs[c.segs.indexOf(g) + 1];
    if (nx && nx.start != null && audio.currentTime >= nx.start) {
      M().idx = nx.i; c.nexting = false; fails = 0; c.segs.splice(0, c.segs.indexOf(nx)); enter(nx.s);
      op(c, () => { if (nx.start > 2) c.sb.remove(0, nx.start - 1); else run(c); });
    }
  }
  tell('time');
});
['play', 'pause'].forEach(ev => audio.addEventListener(ev, () => { fails = 0; tell('state'); if (navigator.mediaSession) navigator.mediaSession.playbackState = ev === 'play' ? 'playing' : 'paused'; }));
audio.addEventListener('ended', () => next());
// 还是被拦下了（普通放法在后台换歌时）：回到页面时接着放
let stuck = false;
function blocked() { tell('blocked'); if (document.hidden) stuck = true; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && stuck) { stuck = false; audio.play().catch(() => tell('blocked')); } });

/* ---------- 系统的「正在播放」（锁屏、控制中心、灵动岛） ---------- */
function sysInfo(s) {
  const ms = navigator.mediaSession; if (!ms) return;
  ms.metadata = new MediaMetadata({ title: s.name, artist: s.artist, artwork: s.pic ? [{ src: s.pic, sizes: '512x512' }] : [] });
}
if (navigator.mediaSession) {
  const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* 这个浏览器不支持这一项 */ } };
  set('play', () => toggle()); set('pause', () => audio.pause());
  set('previoustrack', () => prev()); set('nexttrack', () => next());
  set('seekto', d => seek(d.seekTime));
}

/* ---------- 有人要说话时让一让 ----------
 * 手机自己的语音、酒馆里的正文朗读插件，开始念时在酒馆页面上发 asterphone-voice（detail 'start'），念完发 'end'。
 * 音乐先停、记住位置，念完接着放。 */
let ducked = false;
function duck(e) {
  if (e.detail === 'start' && !audio.paused) { ducked = true; audio.pause(); }
  else if (e.detail === 'end' && ducked) { ducked = false; audio.play().catch(() => tell('blocked')); }
}
try { (window.parent || window).addEventListener('asterphone-voice', duck); } catch (e) { window.addEventListener('asterphone-voice', duck); }

/* ---------- 心动模式：红心歌曲和相似推荐，不找 AI ----------
 * 喜欢的歌里随机挑几位歌手，搜他们别的歌，和红心歌穿插着放 */
export async function heartPick() {
  const base = (M().liked.length ? M().liked : M().recent).filter(s => !s.local);
  if (!base.length) throw new Error('先点几首「喜欢」，心动模式才知道你的口味');
  const mix = a => a.sort(() => Math.random() - .5);
  const mine = mix([...base]), seen = new Set(base.map(s => s.id));
  const artists = [...new Set(mine.map(s => s.artist.split(/[/、,，&]/)[0].trim()))].slice(0, 5);
  const extra = [];
  for (const found of await Promise.all(artists.map(a => search(a).catch(() => []))))
    mix(found.filter(s => !seen.has(s.id))).slice(0, 4).forEach(s => { seen.add(s.id); extra.push(s); });
  const out = [];
  while (mine.length || extra.length) out.push(...mine.splice(0, 1), ...extra.splice(0, 2));
  return out;
}

/* ---------- 角色的歌单：AI 只给「歌名 - 歌手」，手机再一首首去搜；onStep(找到几首, 一共几首) 给界面报进度 ---------- */
const aiLines = raw => String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').split('\n').map(l => l.replace(/^\d+[.、)）]\s*/, '').replace(/^[-*•]\s*/, '').trim()).filter(l => l && l.includes('-'));
async function lookup(lines, onStep) {
  const out = [];
  for (const l of lines) { const s = await findSong(l); if (s && !out.some(x => x.id === s.id)) out.push(s); onStep && onStep(out.length, lines.length); }
  return out;
}
export async function charPick(c, onStep) {
  const { personaOf, nameOf } = await import('../apps/chat/engine.js');
  const { storyText } = await import('./context.js');
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '角色歌单', maxTokens: 500,
    prompt: compose('charSongs', { char: c.name || nameOf(c), persona: personaOf(c) || '（没有更多资料）', story: storyText(6) || '（暂无）', existing: (c.songs || []).map(label).join('\n') || '（无）', count: 8 }) });
  const songs = (await lookup(aiLines(raw), onStep)).filter(s => !(c.songs || []).some(x => x.id === s.id));
  if (!songs.length) throw new Error('AI 挑的歌一首都没搜到');
  c.songs = [...(c.songs || []), ...songs]; commit('contacts');
  return songs;
}
export function addToChar(c, s) {
  c.songs = c.songs || [];
  if (c.songs.some(x => x.id === s.id)) return false;
  c.songs.push(s); commit('contacts'); return true;
}
/** 正文暗号 type="加歌"：TA 把某首歌加进了自己的歌单 */
/* ---------- 一起听：只和私聊里的一个人。M().together 是 TA 的联系人 id；一起听了多少秒记在 M().tg[id] ---------- */
export const together = () => contact(M().together) || null;
const tgTimes = () => M().tg || (M().tg = {});
export const togetherSec = c => tgTimes()[c.id] || 0;
export function listenWith(c) { M().together = c ? c.id : ''; commit('music'); tell('together'); }
/** 一起听时气泡里的两句：这首歌里重复最多的两句（一般就是副歌），作词作曲那几行不算 */
export function hook() {
  const n = {}, L = lyrics.map(x => x.text.trim()).filter(t => t && !/[:：]/.test(t));
  L.forEach(t => { n[t] = (n[t] || 0) + 1; });
  return [...new Set(L)].sort((a, b) => n[b] - n[a]).slice(0, 2);
}
/** 和 TA 聊天时告诉 AI 你们在一起听什么 */
export function togetherNote(c) {
  const s = current();
  return c && M().together === c.id && s ? `\n\n【你们正在一起听歌：《${s.name}》- ${s.artist}${playing() ? '' : '（暂停着）'}】` : '';
}
/** 正文里 TA 说一起听：找到这首就放，和 TA 一起听 */
export async function storyTogether(c, text) {
  const s = await findSong(text);
  if (!s) { log('warn', '音乐', `正文里「${c.name}」要一起听《${text}》，但没搜到`); return null; }
  playList([s], 0, '一起听'); listenWith(c);
  return s;
}
export async function storyAddSong(c, text) {
  const s = await findSong(text);
  if (!s) { log('warn', '音乐', `正文里「${c.name}」加了歌《${text}》，但没搜到`); return; }
  if (addToChar(c, s)) log('info', '音乐', `正文里「${c.name}」把《${s.name}》加进了歌单`);
}
