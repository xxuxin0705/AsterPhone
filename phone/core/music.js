// 音乐的播放器本体：关掉音乐 App、收起手机都接着放。
// 音源（照旧插件）：vkeys 搜歌；Meting 取播放链接、歌词、歌单。地址在 state.music.src 里能改。
// 播放链接直接塞给 <audio>（放别人家的音乐文件不会被跨域拦）；只有搜歌、歌词、歌单要读内容，走 xf（被拦时借酒馆代理）。
import { state, commit } from './store.js';
import { xf } from './api.js';
import { log } from './log.js';

export const DEF_SRC = { vkeys: 'https://api.vkeys.cn/v2/music/netease', meting: 'https://api.qijieya.cn/meting/' };
export const TOPLISTS = [['19723756', '飙升榜'], ['3779629', '新歌榜'], ['3778678', '热歌榜'], ['2884035', '原创榜']];
const M = () => state.music;
const src = k => (M().src && M().src[k]) || DEF_SRC[k];
const q = (base, p) => base + (base.includes('?') ? '&' : '?') + new URLSearchParams(p);
const https = u => String(u || '').replace(/^http:\/\//i, 'https://');
const meting = (type, id) => q(src('meting'), { server: 'netease', type, id });
async function get(url, as = 'json') {
  const r = await xf(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return as === 'json' ? r.json() : r.text();
}

/* ---------- 找歌 ---------- */
export async function search(word) {
  const j = await get(q(src('vkeys'), { word, page: 1, num: 30 }));
  return (j.data || []).map(x => ({ id: String(x.id || ''), name: x.song || x.name || '', artist: x.singer || x.artist || '未知歌手', pic: https(x.cover || x.pic) })).filter(s => s.id && s.name);
}
export async function playlist(id) {
  const j = await get(meting('playlist', id));
  return (Array.isArray(j) ? j : []).map(x => ({ id: String(x.id || (String(x.url).match(/id=(\d+)/) || [])[1] || ''), name: x.name || x.title || '', artist: x.artist || x.author || '未知歌手', pic: https(x.pic) })).filter(s => s.id && s.name);
}
/** 从网易云分享链接 / 一串数字里找出歌单编号 */
export const playlistId = t => ((String(t).match(/playlist[^0-9]*?(?:id=)?(\d{5,})/i) || String(t).match(/[?&]id=(\d{5,})/) || String(t).trim().match(/^(\d{5,})$/)) || [])[1] || '';
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim(); if (!t) continue;
    for (const m of line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) out.push({ t: +m[1] * 60 + +m[2], text: t });
  }
  return out.sort((a, b) => a.t - b.t);
}

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

/** 放一组歌，从第 i 首开始 */
export function playList(list, i = 0) { M().queue = list.slice(); M().idx = i; fails = 0; load(true); }
function load(autoplay) {
  const s = current(); if (!s) return;
  restored = true; lyrics = []; tell('song');
  M().recent = [s, ...M().recent.filter(x => x.id !== s.id)].slice(0, 50); commit('music');
  // 先试 Meting 的链接，不行再试网易云外链；都放不出来就跳下一首（会员歌、下架的歌常这样）
  const urls = [meting('url', s.id), `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`];
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
  sysInfo(s);
  get(meting('lrc', s.id), 'text').then(t => { if (current() === s) { lyrics = parseLrc(t); tell('lyrics'); } })
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

let saveT = 0;
audio.addEventListener('timeupdate', () => { if (Date.now() - saveT > 5000) { saveT = Date.now(); M().pos = audio.currentTime; commit('music'); } tell('time'); });
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
