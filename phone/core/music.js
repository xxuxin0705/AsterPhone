// 音乐的播放器本体：关掉音乐 App、收起手机都接着放。
// 音源（照旧插件）：vkeys 搜歌；Meting 取播放链接、歌词、歌单。地址在 state.music.src 里能改。
// 播放链接直接塞给 <audio>（放别人家的音乐文件不会被跨域拦）；只有搜歌、歌词、歌单要读内容，走 xf（被拦时借酒馆代理）。
// 角色的歌单存在联系人身上（c.songs，跟着聊天窗口走）；笔记在 state.musicNotes（也跟窗口走）。
import { state, commit, kvGet, kvSet, kvDel } from './store.js';
import { xf, generate, resolveConn } from './api.js';
import { log } from './log.js';
import { compose } from './promptstore.js';
import { uid } from './util.js';

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

/* ---------- 找歌 ---------- */
export async function search(word) {
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
  const j = await get(meting('playlist', id), 'json', '读歌单');
  const out = (Array.isArray(j) ? j : []).map(x => ({ id: String(x.id || (String(x.url).match(/id=(\d+)/) || [])[1] || ''), name: x.name || x.title || '', artist: x.artist || x.author || '未知歌手', pic: https(x.pic) })).filter(s => s.id && s.name);
  if (out.length) kvSet('mulist:' + id, out).catch(() => {});
  return out;
}
export const cachedList = id => kvGet('mulist:' + id).catch(() => null);
/** 从网易云分享链接 / 一串数字里找出歌单编号 */
export const playlistId = t => ((String(t).match(/playlist[^0-9]*?(?:id=)?(\d{5,})/i) || String(t).match(/[?&]id=(\d{5,})/) || String(t).trim().match(/^(\d{5,})$/)) || [])[1] || '';
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim(); if (!t) continue;
    // 外语歌音源把翻译接在后面括号里：「原文 (中文)」→ 拆成原文和翻译两行
    const m = t.match(/^(.*?)\s*[(（]([^()（）]*)[)）]$/), tr = m && /[\u3040-\u30ffA-Za-z\uac00-\ud7af]/.test(m[1]) && /[\u4e00-\u9fff]/.test(m[2]) && !/[\u3040-\u30ff]/.test(m[2]);
    for (const x of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) out.push({ t: +x[1] * 60 + +x[2], text: tr ? m[1] : t, tr: tr ? m[2] : '' });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** 网易云的热评：网页直连多半会被拦，能不能拿到要在真机上试 */
export async function hotComments(id) {
  const j = await get(`https://music.163.com/api/v1/resource/comments/R_SO_4_${id}?limit=20`, 'json', '拿热评');
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

/* ---------- 放 ---------- */
export const audio = new Audio();
audio.preload = 'auto';
let lyrics = [], fails = 0, restored = false;
const subs = new Set();
export const onMusic = f => { subs.add(f); return () => subs.delete(f); };
const tell = what => subs.forEach(f => { try { f(what); } catch (e) { console.error(e); } });
export const current = () => M().queue[M().idx] || null;
export const lyricsNow = () => lyrics;
export const playing = () => !audio.paused;

/** 放一组歌，从第 i 首开始；from 是从哪个歌单放的（播放页顶上显示） */
export function playList(list, i = 0, from = '') { M().queue = list.slice(); M().idx = i; M().from = from; fails = 0; load(true); }
async function load(autoplay) {
  const s = current(); if (!s) return;
  restored = true; lyrics = []; tell('song');
  M().recent = [s, ...M().recent.filter(x => x.id !== s.id)].slice(0, 50);
  const pl = M().plays[s.id] || (M().plays[s.id] = { n: 0, s }); pl.n++; commit('music');
  const t0 = Date.now(); audio.addEventListener('playing', () => slow(`《${s.name}》从点下去到出声`, t0), { once: true });
  sysInfo(s);
  const go = urls => {
    // 先试 Meting 的链接，不行再试网易云外链；都放不出来就跳下一首（会员歌、下架的歌常这样）
    const tryUrl = i => {
      audio.onerror = () => {
        if (i + 1 < urls.length) return tryUrl(i + 1);
        log('error', '音乐', `《${s.name}》放不出来（可能是会员歌曲，或者音源挂了）`); tell('error');
        if (++fails < Math.min(5, M().queue.length)) next(); else fails = 0;
      };
      audio.src = urls[i];
      if (autoplay) audio.play().catch(() => tell('blocked'));
    };
    tryUrl(0);
  };
  if (s.local) {
    const f = await kvGet('mufile:' + s.id).catch(() => null);
    if (!f) { log('error', '音乐', `本地的《${s.name}》找不到文件了`); tell('error'); return; }
    if (current() === s) go([URL.createObjectURL(f)]);
    return;
  }
  go([meting('url', s.id), `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`]);
  get(meting('lrc', s.id), 'text', '拿歌词').then(t => { if (current() === s) { lyrics = parseLrc(t); tell('lyrics'); } })
    .catch(e => log('warn', '音乐', `《${s.name}》的歌词没拿到：${e.message}`));
}
export function toggle() {
  if (!current()) return;
  if (!restored) { const pos = M().pos || 0; load(true); audio.addEventListener('loadedmetadata', () => { audio.currentTime = pos; }, { once: true }); return; }   // 刚打开手机：接着上次的地方
  audio.paused ? audio.play().catch(() => tell('blocked')) : audio.pause();
}
export function next(step = 1) {
  const n = M().queue.length; if (!n) return;
  M().idx = M().mode === 'shuffle' && n > 1 ? (M().idx + 1 + Math.floor(Math.random() * (n - 1))) % n : (M().idx + step + n) % n;
  load(true);
}
export const prev = () => audio.currentTime > 4 ? (audio.currentTime = 0) : next(-1);
export function seek(t) { if (restored) audio.currentTime = t; }
export function jump(i) { M().idx = i; load(true); }
export const MODES = [['list', '列表循环', 'repeat'], ['one', '单曲循环', 'repeatOne'], ['shuffle', '随机播放', 'shuffle']];
export function cycleMode() { const i = MODES.findIndex(m => m[0] === M().mode); M().mode = MODES[(i + 1) % MODES.length][0]; commit('music'); return MODES[(i + 1) % MODES.length]; }
export function like(s = current()) {
  if (!s) return false;
  const L = M().liked, i = L.findIndex(x => x.id === s.id);
  i < 0 ? L.unshift(s) : L.splice(i, 1); commit('music');
  return i < 0;
}
export const liked = s => !!s && M().liked.some(x => x.id === s.id);

// 听歌时长（「我的」里的小时数）：两次 timeupdate 之间真的在放才算
let saveT = 0, lastT = 0, heard = 0;
audio.addEventListener('timeupdate', () => {
  const now = Date.now(); if (now - lastT < 2000) heard += now - lastT; lastT = now;
  if (now - saveT > 5000) { saveT = now; M().pos = audio.currentTime; M().heard = (M().heard || 0) + heard / 1000; heard = 0; commit('music'); }
  tell('time');
});
['play', 'pause'].forEach(ev => audio.addEventListener(ev, () => { fails = 0; tell('state'); if (navigator.mediaSession) navigator.mediaSession.playbackState = ev === 'play' ? 'playing' : 'paused'; }));
audio.addEventListener('ended', () => M().mode === 'one' ? (audio.currentTime = 0, audio.play()) : next());

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
export async function storyAddSong(c, text) {
  const s = await findSong(text);
  if (!s) { log('warn', '音乐', `正文里「${c.name}」加了歌《${text}》，但没搜到`); return; }
  if (addToChar(c, s)) log('info', '音乐', `正文里「${c.name}」把《${s.name}》加进了歌单`);
}
