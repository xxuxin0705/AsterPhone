// 音乐的播放器本体：关掉音乐 App、收起手机都接着放。
// 音源（照旧插件）：vkeys 搜歌（网易云、QQ 两边一起搜，合在一起）；网易云的播放链接、歌词、歌单走 Meting，QQ 的全走 vkeys。地址在 state.music.src 里能改。
// 每首歌记着自己是哪边的（src: 'qq' 是 QQ 的，没写就是网易云的）；这边放不了就去另一边找同一首放。
// 播放链接直接塞给 <audio>（放别人家的音乐文件不会被跨域拦）；只有搜歌、歌词、歌单要读内容，走 xf（被拦时借酒馆代理）。
// 角色的歌单存在联系人身上（c.lists，每人好几个，跟着聊天窗口走）；笔记在 state.musicNotes（也跟窗口走）。
import { state, commit, kvGet, kvSet, kvDel, contact } from './store.js';
import { xf, generate, resolveConn } from './api.js';
import { log } from './log.js';
import { compose } from './promptstore.js';
import { uid } from './util.js';
import { ctx } from './bridge.js';
import { stamp } from './time.js';

export const DEF_SRC = { vkeys: 'https://api.vkeys.cn/v2/music/netease', meting: 'https://api.qijieya.cn/meting/', qq: 'https://api.vkeys.cn/v2/music/tencent' };
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
export const WEEK = 7 * 864e5;
export const label = s => `${s.name} - ${s.artist}`;
/* ---------- QQ 音乐（vkeys）：回的是 { code, message, data }，不是 200 就把它的话当错误 ---------- */
const qq = (p, o) => get(q(src('qq') + p, o), 'json').then(j => { if (j.code !== 200) throw new Error(j.message || `QQ 音源回 ${j.code}`); return j.data; });
const qsong = x => ({ id: String(x.mid || ''), src: 'qq', name: x.song || x.name || '', artist: x.singer || '未知歌手', pic: https(x.cover || x.pic), ...(x.vid ? { vid: x.vid } : {}) });
export const isQ = s => !!s && s.src === 'qq';
// 同一首歌两边都有：歌名 + 第一个歌手对得上就算同一首
const key = s => (s.name + '|' + s.artist.split(/[/、,，&]/)[0]).toLowerCase().replace(/\s+/g, '');
const loose = s => key(s).replace(/[(（][^)）]*[)）]/g, '');   // QQ 联想里歌手写成「RESCENE (리센느)」：括号里的不比

/* ---------- 酒馆插件（只有本地酒馆能装）：装了就让它替手机连网易云 / QQ 音乐，登录后会员歌也能放 ----------
 * 没装、或者在 Tauri Tavern 里，问一次就知道（回的不是它的 JSON），之后全走上面的公共音源。 */
const BE = '/api/plugins/asterphone';
export let ne = null;   // null = 没有插件；{ me, qq } = 有插件（me = 网易云的我，qq = QQ 的我；空 = 没登录）
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
export const neSms = phone => be('/sms', { phone });
export const neCookie = cookie => be('/cookie', { cookie }).then(j => { ne.me = j.me; tell('ne'); });
export const neBorrow = () => be('/borrow', {}).then(j => { ne.me = j.me; tell('ne'); });
export const nePhone = (phone, captcha) => be('/phone', { phone, captcha }).then(j => { ne.me = j.me; tell('ne'); });
export const neLogout = () => be('/logout', {}).then(j => { ne.me = null; ne.borrow = j.borrow; tell('ne'); });
export const neDaily = () => be('/daily');
export const neLists = () => be('/playlists');
export const qqQr = () => be('/qq/qr');
export const qqQrCheck = key => be('/qq/qr/check?key=' + encodeURIComponent(key)).then(j => { if (j.qq) { ne.qq = j.qq; tell('ne'); } return j; });
export const qqLogout = () => be('/qq/logout', {}).then(() => { ne.qq = null; tell('ne'); });
export const qqLists = () => be('/qq/playlists');

/* ---------- 找歌：两边一起搜，混在一起（一首网易云一首 QQ 轮着来，同一首只留先来的）；登录了网易云就网易云的全排前面 ---------- */
async function neSearch(word, page) {
  if (ne) try { return await be(`/search?word=${encodeURIComponent(word)}&page=${page}`); } catch (e) { log('warn', '音乐', '插件搜歌失败，改用公共音源：' + e.message); }
  const j = await get(q(src('vkeys'), { word, page, num: 30 }), 'json');
  return (j.data || []).map(x => ({ id: String(x.id || ''), name: x.song || x.name || '', artist: x.singer || x.artist || '未知歌手', pic: https(x.cover || x.pic) })).filter(s => s.id && s.name);
}
// QQ 的搜歌接口词里带中文 / 空格就报错：报错了改用联想（什么词都认，但只有编号、歌名、歌手，封面和 MV 要再按编号查一次；只有第一页）
const qqSearch = (word, page) => qq('/search/song', { word, page, num: 30 }).then(d => (d || []).map(qsong).filter(s => s.id && s.name),
  e => page > 1 ? [] : qq('/search/smartbox', { word }).then(d => (((d || {}).song || {}).itemlist || []).map(x => ({ id: String(x.mid || ''), src: 'qq', name: x.name || '', artist: x.singer || '未知歌手', pic: '' })).filter(s => s.id && s.name), () => { throw e; }));
const qqFill = s => qq('', { mid: s.id }).then(d => { s.pic = https(d.cover); if (d.vid) s.vid = d.vid; }, () => {});
function merge(a, b, aFirst) {
  const out = [], seen = new Set(), add = s => { const k = loose(s); if (!seen.has(k)) { seen.add(k); out.push(s); } };
  if (aFirst) { a.forEach(add); b.forEach(add); }
  else for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) add(a[i]); if (b[i]) add(b[i]); }
  return out;
}
export async function search(word, page = 1) {
  const why = [];
  const [a, b] = await Promise.all([neSearch(word, page).catch(e => { why.push('网易云：' + e.message); return []; }), qqSearch(word, page).catch(e => { why.push('QQ：' + e.message); return []; })]);
  if (why.length === 2) throw new Error(why.join('；'));
  if (why.length) log('warn', '音乐', `搜「${word}」有一边没搜成（${why[0]}）`);
  const out = merge(a, b, !!(ne && ne.me));
  await Promise.all(out.filter(s => isQ(s) && !s.pic).map(qqFill));   // 联想来的没封面：留下来的那些按编号补上
  return out;
}
/** 这首在另一边的同一首：这边放不了时换那边放 */
const twinOf = s => (isQ(s) ? neSearch : qqSearch)(`${s.name} ${s.artist.split(/[/、,，&]/)[0]}`, 1).then(L => L.find(x => loose(x) === loose(s)) || null, () => null);
/** 网易云的歌在 QQ 的编号：用联想接口找（搜歌接口词里带中文 / 空格就报错，联想什么词都认），歌名 + 歌手对得上才算 */
const qqTwinMid = s => isQ(s) ? Promise.resolve(s.id) : qq('/search/smartbox', { word: s.name }).then(d => ((((d || {}).song || {}).itemlist || []).find(x => loose({ name: x.name || '', artist: x.singer || '' }) === loose(s)) || {}).mid || '');
/** 搜歌手（QQ 的）：[{ name, mid, pic, n }]；歌手的歌一页页拿 */
export const singers = word => qq('/search/singer', { word, num: 20 }).then(d => (d || []).map(x => ({ name: x.singerName, mid: x.singerMID, pic: https(x.singerPic), n: x.songNum })));
export const singerSongs = (mid, page) => qq('/singer/songlist', { mid, page, num: 30 }).then(d => (d || []).map(qsong).filter(s => s.id && s.name));
/** 这首歌有没有 MV：先找 QQ 的（找到它在 QQ 的编号，按编号查详情里的 vid）；没有的话本地酒馆再找网易云的（'ne:编号'），再没有就去 B 站搜（'bili:搜的词'，点了才搜）。问过的记住，不重复问 */
const mvs = new Map();
export const mvOf = s => s.vid ? Promise.resolve(s.vid) : mvs.get(s.id) || mvs.set(s.id, findMv(s)).get(s.id);
async function findMv(s) {
  try { const mid = await qqTwinMid(s), vid = mid ? String((await qq('', { mid })).vid || '') : ''; if (vid) return vid; }
  catch (e) { log('warn', '音乐', `找《${s.name}》的 MV 失败：${e.message}`); }
  if (!ne) return '';
  const j = await be('/mv?' + new URLSearchParams({ id: isQ(s) ? '' : s.id, name: s.name, artist: s.artist })).catch(e => { log('warn', '音乐', `找《${s.name}》网易云的 MV 失败：${e.message}`); return {}; });
  return j.mv ? 'ne:' + j.mv : `bili:${s.name} ${s.artist.split(/[/、,，&]/)[0]} MV`;
}
/** MV 的地址们：中间那档清晰度排第一，放不出来就换下一个（有的地址不支持 https、有的域名放不了）；页面本身是 http 就不改成 https */
export const mvUrls = vid => vid.startsWith('ne:') ? be('/mv/url?id=' + vid.slice(3)).then(j => [j.url].filter(Boolean)) : vid.startsWith('bili:') ? Promise.resolve([`${BE}/bili/mv?word=${encodeURIComponent(vid.slice(5))}`]) : qq('/mv', { vid, type: 'mp4' }).then(d => {
  const u = [...new Set((d.urls || []).map(x => location.protocol === 'https:' ? https(x.url) : String(x.url || '')).filter(Boolean))];
  return u.length ? [...u.splice(Math.floor(u.length / 2), 1), ...u] : [];
});
/** 搜歌单：只有装了酒馆插件才搜得到，没装就是空的 */
export const searchLists = word => ne ? be('/search/lists?word=' + encodeURIComponent(word)).catch(e => { log('warn', '音乐', '插件搜歌单失败：' + e.message); return []; }) : Promise.resolve([]);
/** 打字时的联想：{ top: 最对得上的歌手（{ artist, pic, mid }）或歌（{ song }），words: 联想词 }。装了插件用网易云自己的联想；没装用 QQ 的联想；都不行就搜一次歌，从搜到的里挑 */
export async function suggest(word) {
  if (ne) try { return await be('/suggest?word=' + encodeURIComponent(word)); } catch (e) { log('warn', '音乐', '插件联想失败，改成搜歌：' + e.message); }
  const w = word.toLowerCase();
  try {
    const d = await qq('/search/smartbox', { word }), sg = (d.singer || {}).itemlist || [], a = sg.find(x => x.name.toLowerCase().includes(w)) || sg[0];
    return { top: a ? { artist: a.name, pic: https(a.pic), mid: a.mid } : null, words: [...new Set([...((d.song || {}).itemlist || []).map(x => x.name), ...sg.map(x => x.name)])].slice(0, 8) };
  } catch (e) { log('warn', '音乐', 'QQ 联想没拿到，改成搜歌：' + e.message); }
  const L = await search(word);
  const s = L.find(x => x.artist.toLowerCase().includes(w)), a = s && s.artist.split(/\s*[/、,，&]\s*/).find(x => x.toLowerCase().includes(w));
  return { top: a ? { artist: a, pic: s.pic } : L[0] ? { song: L[0] } : null, words: [...new Set(L.map(x => x.name))].slice(0, 8) };
}
/** 按「歌名 - 歌手」找一首（AI 挑的歌、正文里提到的歌都走这）；找不到就是 null */
export async function findSong(text) {
  const [name, artist = ''] = String(text).split(/\s[-–—]\s|[-–—]/).map(s => s.trim());
  if (!name) return null;
  const list = await search(artist ? `${name} ${artist}` : name).catch(() => []);
  return list.find(s => s.name.toLowerCase() === name.toLowerCase()) || list[0] || null;
}
/** 歌单 / 榜单：读过的存在这台设备上，下次先给存的（马上出来），再去读新的。QQ 的歌单编号前面带 q，一页页读完（最多 500 首），歌单名挂在 .title 上 */
export async function playlist(id) {
  let out;
  if (id[0] === 'q') {
    const j = ne ? await be('/qq/playlist?id=' + id).catch(() => null) : null;   // 登录了 QQ 的话，自己没公开的歌单也读得到
    out = j && j.songs.length ? Object.assign(j.songs, { title: j.title, pic: j.pic }) : null;
    if (!out) {
      out = []; let info;
      for (let page = 1, got = 60; got === 60 && out.length < 500; page++) { const d = await qq('/dissinfo', { id: id.slice(1), page, num: 60 }); info = d.info || info; got = (d.list || []).length; out.push(...d.list.map(qsong).filter(s => s.id && s.name)); }
      Object.assign(out, { title: (info || {}).title || '', pic: https((info || {}).picurl) });
    }
  } else {
    const j = ne ? await be('/playlist?id=' + id).catch(() => null) : null;
    out = j && j.length ? j : (await get(meting('playlist', id), 'json').then(j => Array.isArray(j) ? j : [])).map(x => ({ id: String(x.id || (String(x.url).match(/id=(\d+)/) || [])[1] || ''), name: x.name || x.title || '', artist: x.artist || x.author || '未知歌手', pic: https(x.pic) })).filter(s => s.id && s.name);
  }
  if (out.length) kvSet('mulist:' + id, out).catch(() => {});
  return out;
}
export const cachedList = id => kvGet('mulist:' + id).catch(() => null);
/** 分享出来的短链接（网易云 163cn.tv、QQ c6.y.qq.com）要先问出它跳到哪：网页自己问不了（跨域）。装了酒馆插件让插件问；
 *  没装（Tauri）就挨个借公共的跨域转发去打开它，从跳到的地址或网页内容里找歌单编号（都是别人家的服务，可能慢、可能挂） */
const RELAYS = [
  ['allorigins', u => `https://api.allorigins.win/get?url=${u}`, async r => { const j = await r.json(); return ((j.status || {}).url || '') + ' ' + (j.contents || ''); }],
  ['corsproxy', u => `https://corsproxy.io/?url=${u}`, r => r.text()],
  ['codetabs', u => `https://api.codetabs.com/v1/proxy/?quest=${u}`, r => r.text()],
];
export const SHORT = /https?:\/\/(?:163cn\.tv\/\w+|c6\.y\.qq\.com\/base\/fcgi-bin\/u\?__=\w+)/;
export async function playlistIdOf(text) {
  const id = playlistId(text), short = (String(text).match(SHORT) || [])[0];
  if (id || !short) return id;
  if (ne) return playlistId((await be('/resolve?url=' + encodeURIComponent(short))).url);
  const why = [];
  for (const [name, url, read] of RELAYS) {
    try {
      const r = await fetch(url(encodeURIComponent(short)), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`${r.status}`);
      const got = playlistId(String(await read(r)));
      if (got) return got;
      why.push(`${name} 回来的内容里没有歌单`);
    } catch (e) { why.push(`${name} ${e.name === 'TimeoutError' ? '超时' : e.message}`); }
  }
  log('error', '音乐', '解析短链接失败：' + why.join('；'));
  throw new Error(`短链接没解析出来（${why.join('；')}），先在浏览器里打开它，把地址栏的链接复制过来`);
}
/** 从分享链接 / 一串数字里找出歌单编号：QQ 的（y.qq.com 的链接里 playlist/、disstid=、id= 后面的数）带 q，网易云的就是数字 */
export const playlistId = t => { const s = String(t), qq = (s.match(/y\.qq\.com\/\S*?(?:playlist\/|disstid=|[?&]id=)(\d{5,})/i) || [])[1];
  return qq ? 'q' + qq : ((s.match(/playlist[^0-9]*?(?:id=)?(\d{5,})/i) || s.match(/[?&]id=(\d{5,})/) || s.trim().match(/^(\d{5,})$/)) || [])[1] || ''; };
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, '').trim(); if (!t) continue;   // 有的歌词时间写成 [01:02:30]（冒号）
    // 外语歌音源把翻译接在后面括号里：「原文 (中文)」→ 拆成原文和翻译两行；翻译里还能再套一层括号：「原文 ((男方)中文)」
    const m = t.match(/^(.*?)\s*[(（]((?:[^()（）]|[(（][^()（）]*[)）])*)[)）]$/), tr = m && /[\u3040-\u30ffA-Za-z\uac00-\ud7af]/.test(m[1]) && /[\u4e00-\u9fff]/.test(m[2]) && !/[\u3040-\u30ff]/.test(m[2]);
    for (const x of line.matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) out.push({ t: +x[1] * 60 + +x[2] + +('0.' + (x[3] || 0)), text: tr ? m[1] : t, tr: tr ? m[2] : '' });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** 社区逐字歌词库（AMLL TTML DB，CC0）：按网易云歌曲编号放的 .ttml，没有这首就是 404 */
const TTML = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/ncm-lyrics/';
/** TTML 逐字歌词：<p> 是一句，里面带 begin 的 <span> 是一个字 / 词（词和词之间的空格接到前一个词后面），翻译是 role="x-translation" 的 span；和声（x-bg）不要 */
export function parseTtml(text) {
  const sec = v => String(v).split(':').reduce((a, b) => a * 60 + +b, 0);
  return [...new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('p')].map(p => {
    const w = []; let tr = '';
    for (const n of p.childNodes) {
      if (n.nodeType === 3) { if (w.length) w[w.length - 1].text += n.textContent; continue; }
      const role = n.getAttribute('ttm:role');
      if (role === 'x-translation') tr = n.textContent.trim();
      else if (!role && n.getAttribute('begin')) w.push({ t: sec(n.getAttribute('begin')), d: sec(n.getAttribute('end')) - sec(n.getAttribute('begin')), text: n.textContent });
    }
    return w.length && { t: w[0].t, text: w.map(x => x.text).join('').trim(), tr, w: w.filter(x => x.text.trim()) };
  }).filter(Boolean);
}
/** 逐字歌词，单位毫秒。网易云：[句开始,句时长](字开始,字时长,0)字(…)字…；QQ（qrc）：[句开始,句时长]字(字开始,字时长)字(…)… */
export function parseYrc(text, qrc) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\[(\d+),\d+\](.*)/); if (!m) continue;
    const w = [...m[2].matchAll(qrc ? /(.*?)\((\d+),(\d+)\)/g : /\((\d+),(\d+),\d+\)([^(]*)/g)].map(x => qrc ? { t: x[2] / 1000, d: x[3] / 1000, text: x[1] } : { t: x[1] / 1000, d: x[2] / 1000, text: x[3] }).filter(x => x.text.trim());
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
  const j = ne ? await be('/comments?id=' + id) : await get(`https://music.163.com/api/v1/resource/comments/R_SO_4_${id}?limit=20`, 'json');
  return (j.hotComments || j.comments || []).map(c => ({ name: (c.user || {}).nickname || '网友', avatar: ((c.user || {}).avatarUrl || '').replace(/^http:/, 'https:'), text: c.content, likes: c.likedCount || 0,
    time: c.timeStr || (c.time ? new Date(c.time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-') : ''), place: (c.ipLocation || {}).location || '' }));
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
// 还在问链接时按 0 算：不然进度条按占位那 0.1 秒画，一下子跑到底
export const now = () => loading() ? 0 : Math.max(0, (audio.currentTime || 0) - (seg()?.start || 0));
export const dur = () => { if (loading()) return 0; const g = seg(); return g ? (g.end || audio.duration || 0) - (g.start || 0) : audio.duration || 0; };   // 还在下的那首，先按已经下到的算

/** 放一组歌，从第 i 首开始；from 是从哪个歌单放的（播放页顶上显示） */
export function playList(list, i = 0, from = '') { M().queue = list.slice(); M().idx = i; M().from = from; fails = 0; load(true); }
/** 换到一首歌（不管声音怎么来）：记最近、次数，系统的正在播放，拿歌词 */
function enter(s) {
  lyrics = []; tell('song');
  M().recent = [s, ...M().recent.filter(x => x.id !== s.id)].slice(0, 50);
  const pl = M().plays[s.id] || (M().plays[s.id] = { n: 0, s }); pl.n++;
  tgSong(s);
  pl.t = [...(pl.t || []).filter(t => Date.now() - t < WEEK), Date.now()]; commit('music');   // 最近一周每次放的时间，听歌排行用
  sysInfo(s);
  if (s.local) return;
  // 普通歌词先出来；逐字的（每个字几点唱）到了再换上，翻译从普通歌词里按时间配过去
  // 最准的是社区逐字歌词库（AMLL，人工对过每个字的时间，带翻译），有就用它；其次网易云自己的逐字；再其次去 QQ 拿同一首的逐字（QQ 几乎每首都有）；都没有就是普通歌词
  let base = [], yrc = [], ttml = [], qrc = [];
  const done = () => { if (current() !== s) return; const w = ttml.length ? ttml : yrc.length ? yrc : qrc; lyrics = w.length ? w.map(x => ({ ...x, tr: x.tr || (base.find(b => Math.abs(b.t - x.t) < 1) || {}).tr || '' })) : base; tell('lyrics'); };
  const withTr = (lrc, trText) => { const tr = parseLrc(trText).filter(y => y.text !== '//'); return parseLrc(lrc).map(x => ({ ...x, tr: x.tr || (tr.find(y => Math.abs(y.t - x.t) < .3) || {}).text || '' })); };   // 翻译是另一份歌词，按时间配过去（QQ 没翻译的句子写 //）
  if (isQ(s)) { qq('/lyric', { mid: s.id }).then(d => { base = withTr(d.lrc, d.trans); yrc = parseYrc(d.yrc, true); done(); }).catch(e => log('warn', '音乐', `《${s.name}》的歌词没拿到：${e.message}`)); return; }
  fetch(TTML + s.id + '.ttml').then(r => r.ok ? r.text() : '').then(t => { if (t) { ttml = parseTtml(t); done(); } }).catch(e => log('warn', '音乐', `《${s.name}》的逐字歌词库没连上：${e.message}`));
  if (ne) be('/lyric?id=' + s.id).then(j => { base = withTr(j.lrc, j.tr); yrc = parseYrc(j.yrc); done(); }).catch(e => log('warn', '音乐', `《${s.name}》的歌词没拿到：${e.message}`));
  else get(meting('lrc', s.id), 'text').then(t => { const L = parseLrc(t); if (L.length >= base.length) base = L; done(); })
    .catch(e => log('warn', '音乐', `《${s.name}》的歌词没拿到：${e.message}`));
  qqTwinMid(s).then(mid => mid && qq('/lyric', { mid })).then(d => { if (d) { qrc = parseYrc(d.yrc, true); if (qrc.length) done(); } }).catch(e => log('warn', '音乐', `《${s.name}》QQ 的逐字歌词没拿到：${e.message}`));
  if (!ne) get(q(src('vkeys') + '/lyric', { id: s.id }), 'json').then(j => {
    const d = j.data || {}, y = (d.yrc && d.yrc.lyric) || d.yrc, l = (d.lrc && d.lrc.lyric) || d.lrc;
    yrc = typeof y === 'string' ? parseYrc(y) : [];
    // 有的歌 Meting 给的歌词只有作词作曲那几行：vkeys 这份更全就用它
    const alt = typeof l === 'string' ? parseLrc(l) : [];
    if (alt.length > base.length) base = alt;
    if (yrc.length || base === alt) done();
  }).catch(e => log('warn', '音乐', `《${s.name}》的逐字歌词没拿到：${e.message}`));
}
// 一点就先放一段没声音的：手机浏览器只认「点完马上放」，问音源要等几秒，等到了再放就被拦（要再点一下播放键）。先放过一次，之后换真的就不拦了
const HUSH = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
const whenLoaded = f => audio.addEventListener('loadedmetadata', function go() { if (audio.src === HUSH) return; audio.removeEventListener('loadedmetadata', go); f(); });
/** 还在问链接（播放键转圈）：占位的那段还挂在上面就是 */
export const loading = () => audio.src === HUSH;
let gen = 0;   // 每次 load 加一：加载中点了取消、换了歌，之前还在问的那条线就不往下走了
// 清掉声音上挂着的东西（取消加载、全放不出来时），不触发 onerror
const unload = () => { audio.onerror = null; audio.removeAttribute('src'); audio.load(); };
// hush：先放那段占位。只在人点了歌 / 上一首下一首时用；上一首自己放完接下一首不用（后台时那一下会把浏览器「允许接着放」的资格弄没，真歌到了反而不让放）
async function load(autoplay, hush = true) {
  const s = current(); if (!s) return;
  const g = ++gen;
  if (autoplay && hush && !s.local) { audio.onerror = null; audio.src = HUSH; audio.play().catch(() => {}); tell('state'); }
  restored = true; enter(s);
  if (chain) { chain.ac.abort(); chain = null; }
  const f = s.local ? await kvGet('mufile:' + s.id).catch(() => null) : await cached(s);
  if (s.local && !f) { log('error', '音乐', `本地的《${s.name}》找不到文件了`); tell('error'); return; }
  if (current() !== s || g !== gen) return;
  // 读得到内容的都续接（存在手机里的、本地酒馆插件转的、Tauri 里 JOOX 的）：后台才能一首接一首。读不到的（Tauri 里 QQ / 酷我）才直接把地址给播放器
  if (CHAIN && (!f || f.type === 'audio/mpeg') && await startChain(s, f, autoplay)) return;
  plain(s, f, autoplay);
}
/* ---------- 听过的歌存在手机里（IndexedDB）：下次直接从本地放，不问接口不下载，几天后也一样快。
 * 存得了的是网页读得到内容的：酒馆插件转的、JOOX 的；QQ / 酷我直连的网页读不了，本地酒馆让插件转一手（/pipe）再存，Tauri 存不了。
 * 存几首在音乐「更多 → 自动存歌」里选（M().keep，0 = 一直存，-1 = 不存），满了删最久没听的 ---------- */
const CK = 'musong:';
const ck = s => CK + (s.src || 'ne') + s.id;
let cidx = null;   // [{ k, size, at }]，at = 上次听的时间
const cacheIdx = async () => cidx || (cidx = (await kvGet(CK + 'idx').catch(() => null)) || []);
async function cached(s) {
  const i = (await cacheIdx()).find(x => x.k === ck(s)); if (!i) return null;
  const f = await kvGet(i.k).catch(() => null);
  if (f) { i.at = Date.now(); kvSet(CK + 'idx', cidx).catch(() => {}); }
  return f;
}
/** 存一首：u 是地址（自己去下），或者已经拿到的文件内容（续接时顺手留的一份，不用再下一遍） */
async function stash(s, u) {
  if (M().keep === -1) return;   // 选了「不存」
  const k = ck(s); if ((await cacheIdx()).some(x => x.k === k)) return;
  let b;
  try { b = u instanceof Blob ? u : await fetch(ne && !u.startsWith(BE) ? `${BE}/pipe?url=${encodeURIComponent(u)}` : u).then(r => r.ok && /audio|mpeg|mp4|flac|ogg/.test(r.headers.get('content-type') || '') ? r.blob() : null); }
  catch { return; }   // 读不了内容（跨域）就算了
  if (!b || cidx.some(x => x.k === k)) return;
  const keep = M().keep ?? 50;
  while (keep && cidx.length >= keep) await kvDel(cidx.sort((a, c) => a.at - c.at).shift().k).catch(() => {});
  await kvSet(k, b); cidx.push({ k, size: b.size, at: Date.now() }); await kvSet(CK + 'idx', cidx);
}
const forget = async s => { const k = ck(s); cidx = (await cacheIdx()).filter(x => x.k !== k); await kvDel(k).catch(() => {}); await kvSet(CK + 'idx', cidx); };
/** 存了几首、多大；全清掉 */
export const cacheInfo = async () => { const L = await cacheIdx(); return { n: L.length, size: L.reduce((a, x) => a + x.size, 0) }; };
export async function clearCache() { for (const x of await cacheIdx()) await kvDel(x.k).catch(() => {}); cidx = []; await kvSet(CK + 'idx', []); }
/** QQ 的播放链接：先要默认音质，不给（高音质要会员）就退到标准音质；拿到的记几分钟（续接和普通放法会接连要两次） */
const qurls = new Map();
async function qqUrl(s) {
  const c = qurls.get(s.id); if (c && Date.now() - c.at < 5 * 60e3) return c.url;
  let url = '', trial = '';
  // 会员歌没登录时 QQ 只给 1 分钟的试听片段（地址是 RS02 开头、写着「试听」）：先不用它，好让后面换网易云的整首；哪边都没有整首才放它
  for (const quality of ['', 4]) { const d = await qq('/geturl', { mid: s.id, ...(quality ? { quality } : {}) }).catch(() => null); if (!d || !d.url) continue; if (/\/RS02/i.test(d.url) || /试听/.test(d.quality || '')) { trial = trial || https(d.url); continue; } url = https(d.url); break; }
  qurls.set(s.id, { url, trial, at: Date.now() });
  return url;
}
/* ---------- 整首的公共音源（照 musicsquare 的做法，网页能直接连，两三秒出结果）：QQ 按编号要；酷我、JOOX 按歌名搜，歌名 + 歌手对得上才要。问过的记几分钟（续接和普通放法会接连要两次） ---------- */
const PUB = { qq: 'https://tang.api.s01s.cn/music_open_api.php', kuwo: 'https://oiapi.net/api/Kuwo', joox: 'https://apicx.asia/api/joox_music' }, JOOX = { token: 'f84ao9lMF_q7husBWRfgUw', br: 4 };
const full = new Map();
const remember = (k, who, s, fn) => {
  const c = full.get(k); if (c && Date.now() - c.at < 30 * 60e3) return c.p;
  const p = fn().catch(e => { log('warn', '音乐', `${who}没给《${s.name}》：${e.message}`); return ''; });
  full.set(k, { p, at: Date.now() });
  return p;
};
const qqFull = s => remember('q' + s.id, 'QQ 公共音源', s, async () => {
  const mid = await qqTwinMid(s); if (!mid) return '';
  const j = await get(q(PUB.qq, { msg: `${s.name} ${s.artist}`, type: 'json', mid }), 'json'), d = j.data || j;
  const u = https(d.song_play_url_hq || d.song_play_url || d.song_play_url_standard || '');
  if (/\/RS02/i.test(u)) { log('warn', '音乐', `QQ 公共音源只给了《${s.name}》的试听（开着 VPN 时 QQ 常这样）`); return ''; }
  return u;
});
// 繁体 → 简体，只收常见的姓、名、歌名用字（一对一对写）
const FJ = '陳陈張张劉刘楊杨黃黄趙赵吳吴孫孙馬马鄭郑謝谢羅罗鄧邓馮冯葉叶盧卢蕭萧龍龙鍾钟嚴严華华錢钱衛卫蘇苏韓韩賴赖蔣蒋譚谭傑杰麗丽綺绮貞贞綠绿鳳凤傳传偉伟國国強强靜静雲云蘭兰鈞钧東东寧宁軒轩儀仪藝艺戀恋夢梦詩诗語语樂乐亞亚興兴瑋玮莊庄歐欧陽阳爾尔單单齊齐關关區区義义愛爱說说説说風风捲卷寫写從从運运蘋苹燈灯時时間间會会這这個个們们來来對对沒没開开還还點点無无為为與与過过後后見见聽听話话認认識识頭头發发髮发雙双邊边遠远裡里變变讓让長长離离萬万倫伦騰腾鈺钰瑩莹鋒锋澤泽慶庆誠诚淵渊瑤瑶凱凯鴻鸿鳴鸣誼谊權权剛刚聰聪穎颖瓊琼鈴铃擱搁淺浅';
const simp = t => [...t].map(c => { const i = FJ.indexOf(c); return i >= 0 && !(i % 2) ? FJ[i + 1] : c; }).join('');
const word = s => `${s.name} ${s.artist.split(/[/、,，&]/)[0]}`;
// 酷我：先搜出它排第几，再按序号要。br 0 是默认音质，有的歌给的 ogg 浏览器放不了，放不了再要低一档（2）
const kuwoAt = s => remember('ki' + s.src + s.id, '酷我', s, async () => ((await get(q(PUB.kuwo, { msg: word(s), page: 1, limit: 10 }), 'json')).data || []).findIndex(x => loose({ name: x.song || '', artist: x.singer || '' }) === loose(s)) + 1);
const kuwoFull = (s, br) => remember('k' + br + s.src + s.id, '酷我', s, async () => {
  const n = await kuwoAt(s); if (!n) return '';
  return https((((await get(q(PUB.kuwo, { msg: word(s), n, br }), 'json')).data || {}).url) || '');
});
// JOOX（腾讯海外版，服务器在香港，开着 VPN 也给整首；只有中文歌多）。搜词只放歌名（带上歌手它就搜不到；简体能搜到繁体）；歌名搜不到（英文歌常重名）再带歌手试一次。没搜到它回 500
const jooxFull = s => remember('j' + s.src + s.id, 'JOOX', s, async () => {
  const qs = { token: JOOX.token, br: JOOX.br }, [n0, a0] = loose(s).split('|');
  // 它的歌名、歌手写的是繁体（擱淺 / 周杰倫）：常见的字先换成简体；歌手一样长、有字对得上，歌名一样长（歌手完全一样时歌名有字对不上也行）就算同一首
  const like = (a, b) => a.length === b.length && [...a].some((c, i) => c === b[i]);
  const same = x => { const [n, a] = simp(loose({ name: x['歌曲名称'] || '', artist: x['歌手'] || '' })).split('|'); return like(a, a0) && n.length === n0.length && (a === a0 || like(n, n0)); };
  let msg, n = 0;
  const name = s.name.replace(/[(（][^)）]*[)）]/g, '').trim();   // 「说好不哭 (with 五月天阿信)」带着括号搜不到
  for (msg of [name, `${name} ${s.artist.split(/[/、,，&]/)[0]}`]) {
    const j = await get(q(PUB.joox, { ...qs, msg }), 'json').catch(e => { if (/^500/.test(e.message)) return {}; throw e; });
    if ((n = ((j.data || {}).songs || []).findIndex(same) + 1)) break;
  }
  if (!n) return '';
  const L = (((await get(q(PUB.joox, { ...qs, msg, n }), 'json')).data || {})['播放链接']) || {};
  return https(L['MP3 320'] || L['MP3 128'] || L['AAC 192'] || '');
});
// 几个一起问，谁先给出链接用谁；都没有才是空
const first = ps => new Promise(ok => { let n = ps.length; ps.forEach(p => p.then(u => { if (u) ok(u); else if (!--n) ok(''); })); });
/** 一首歌的地址，按先后挨个试：登录了的号 → Tauri 里网易云的歌先走 Meting（网页读得到，半秒出声，能续接；会员歌它给的是网页，跳过）→ 整首的公共音源（JOOX；QQ、酷我一起问；不行再酷我低一档）→ 没登录的插件、Meting。要现问的放成函数，轮到才问 */
const urlsOf = s => {
  const lz = (f, ...keys) => Object.assign(f, { bad: () => keys.forEach(k => full.delete(k)) });   // 记住的链接放不出来就作废，下回重新问
  const qk = lz(() => first([qqFull(s), kuwoFull(s, 0)]), 'q' + s.id, 'k0' + s.src + s.id), k2 = lz(() => kuwoFull(s, 2), 'k2' + s.src + s.id), jx = lz(() => jooxFull(s), 'j' + s.src + s.id);
  jx.readable = true;   // JOOX 的文件网页读得到内容：能续接、能存
  const pub = ne ? [qk, k2, jx] : [jx, qk, k2], mt = () => meting('url', s.id);   // Tauri 里 JOOX 排第一：只有它能续接、存得下来（开着 VPN 也快）
  mt.readable = true;
  return isQ(s) ? [ne && ne.qq && `${BE}/qq/audio?mid=${s.id}`, ...pub, () => qqUrl(s)].filter(Boolean)
    : [ne && ne.me && `${BE}/audio?id=${s.id}`, !ne && mt, ...pub, ne && !ne.me && `${BE}/audio?id=${s.id}`, ne && mt, `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`].filter(Boolean);
};
/** 普通放法：这首自己那边的链接挨个试；都放不出来就去另一边找同一首（twin）再试；再不行，本地酒馆去 B 站找同名的放；还不行就跳下一首（会员歌、下架的歌常这样） */
async function plain(s, f, autoplay, twin) {
  const urls = f ? [URL.createObjectURL(f)] : twin === undefined ? urlsOf(s) : [...(twin ? urlsOf(twin) : []), ...(ne ? [`${BE}/bili/audio?word=${encodeURIComponent(`${s.name} ${s.artist.split(/[/、,，&]/)[0]}`)}`] : [])];
  if (current() !== s) return;
  const g = gen;
  const fail = () => {
    const tr = !f && isQ(s) && (qurls.get(s.id) || {}).trial;
    if (tr && audio.src !== tr) { log('warn', '音乐', `《${s.name}》是会员歌，两边都只拿到 1 分钟试听`); audio.onerror = () => { audio.onerror = null; fail(); }; audio.src = tr; if (autoplay) audio.play().catch(blocked); return; }
    unload();
    log('error', '音乐', `《${s.name}》放不出来（可能是会员歌曲，或者音源挂了）`); tell('error'); if (++fails < Math.min(5, M().queue.length)) next(1, true); else fails = 0;
  };
  const tryUrl = async i => {
    if (i >= urls.length && f && !s.local) { forget(s); return plain(s, null, autoplay); }   // 存的文件放不出来：删了，重新问
    if (i >= urls.length) return (!f && twin === undefined) ? twinOf(s).then(t => { if (current() !== s || g !== gen) return; if (t) log('warn', '音乐', `《${s.name}》这边放不了，换${isQ(t) ? ' QQ' : '网易云'}的放`); plain(s, f, autoplay, t); }) : fail();
    const x = urls[i], u = typeof x === 'function' ? await x() : x;
    if (current() !== s || g !== gen) return;
    if (!u) return tryUrl(i + 1);
    audio.onerror = () => { x.bad && x.bad(); tryUrl(i + 1); };
    audio.src = u;
    if (autoplay) audio.play().catch(blocked);
    warmNext();
    if (!f) setTimeout(() => { if (current() === s && g === gen) stash(s, u); }, 5000);   // 放起来 5 秒后再存，别跟播放抢网
  };
  tryUrl(0);
}
/** 这首放起来了就提前把下一首的链接问好，按「下一首」秒开（随机播放不知道下一首是谁，不问） */
let warmT = 0;
function warmNext() {
  clearTimeout(warmT);
  if (M().mode === 'shuffle') return;
  const nx = M().queue[pick(M().idx, true)]; if (!nx || nx === current() || nx.local) return;
  warmT = setTimeout(async () => { for (const x of urlsOf(nx)) if (typeof x === 'function' ? await x() : x) return; }, 3000);
}
/** 续接：开一条新声音，把这首边下边续进去。头一段到了就开始放；读不到文件返回 false */
async function startChain(s, f, autoplay) {
  const ms = new MediaSource(), ac = new AbortController(), g = gen;
  const c = { ms, ac, segs: [], ops: [], nexting: false };
  let why = '';
  const body = await songBody(s, f, ac.signal).catch(e => { why = e.message; return null; });
  if (current() !== s || g !== gen) return true;   // 取消了 / 换歌了：普通放法也别再跑
  if (!body) { log('warn', '音乐', `《${s.name}》续接不了（${why}），直接播：这首放完在后台接不上下一首`); return false; }
  chain = c; audio.onerror = null; warmNext();
  audio.src = URL.createObjectURL(ms);
  await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }));
  try { c.sb = ms.addSourceBuffer('audio/mpeg'); c.sb.mode = 'sequence'; }
  catch (e) { log('warn', '音乐', '这个浏览器续接不了：' + e.message); chain = null; ac.abort(); return false; }
  c.sb.addEventListener('updateend', () => run(c));
  feed(c, M().idx, s, body, () => { if (autoplay) audio.play().catch(blocked); });
  return true;
}
/** 歌曲文件的内容（边下边读）；不是 mp3 就不要 */
/** 歌曲文件的内容（边下边读）。只读第一条能放的地址：酒馆插件转的直接读；本地酒馆别的地址让插件 /pipe 转一手；Tauri 只有 JOOX 的读得到（别的跨域，试一下就是白等一趟服务器）。
 *  读到的顺手留一份存起来（不用再下一遍）；不是 mp3 不要 */
async function songBody(s, f, signal) {
  if (f) return f.stream();
  for (const x of urlsOf(s)) {
    if (!ne && !x.readable) continue;   // Tauri 里只有 Meting、JOOX 的读得到，别的问了也白问
    const u = typeof x === 'function' ? await x() : x; if (!u) continue;
    const r = await fetch(u.startsWith(BE) || !ne ? u : `${BE}/pipe?url=${encodeURIComponent(u)}`, { signal });
    if (!r.ok || !/mpeg|mp3/.test(r.headers.get('content-type') || '')) { log('info', '音乐', `《${s.name}》这个地址给的不是歌（${r.status} ${r.headers.get('content-type')}），换下一个`); continue; }   // Meting 碰到会员歌给的是网页
    const [a, b] = r.body.tee();
    new Response(b).blob().then(blob => stash(s, blob), () => {});
    return a;
  }
  throw new Error('没有链接');
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
      if (c !== chain || g.dead) return reader.cancel();
      if (done) break;
      await put(c, g, value);
      if (first) { const f0 = first; first = null; op(c, () => { f0(); run(c); }); }
    }
    op(c, () => { if (!g.dead) { g.end = c.sb.timestampOffset; tell('time'); } run(c); });
  } catch (e) {
    if (c !== chain || g.dead) return;
    log('warn', '音乐', `《${s.name}》读到一半断了：${e.message}`);
    op(c, () => { g.end = c.sb.timestampOffset; run(c); });
  }
}
/** 续一段进去（上一段续完才续下一段，不会一口气全塞进去）。
 *  缓冲满了（浏览器给一条声音的地方有限，长歌、高音质，或者正好在续下一首时会满）：把 30 秒以前已经放过的清掉再续；还没放到能清的地方就等一会儿再试 */
function put(c, g, value) {
  return new Promise((ok, no) => {
    c.ac.signal.addEventListener('abort', ok, { once: true });   // 换歌了：别等了
    const go = () => {
      if (g.dead) return ok();
      try { if (g.start == null) g.start = c.sb.timestampOffset; c.sb.appendBuffer(value); ok(); }
      catch (e) {
        if (e.name !== 'QuotaExceededError') return no(e);
        const b = c.sb.buffered, t = audio.currentTime - 30;
        if (b.length && b.start(0) < t - 1) { c.ops.unshift(go); c.sb.remove(b.start(0), t); }   // 清完 updateend 会接着跑 go
        else setTimeout(() => op(c, go), 1500);
      }
    };
    op(c, go);
  });
}
/** 这首下完了：把下一首续在后面。下一首读不到（存的不是 mp3、地址网页读不了）就封口，放完走普通放法；不跳过它去续再下一首，播放列表的顺序不能乱 */
async function chainNext(c) {
  const i = pick(M().idx, true), s = c.nexting = M().queue[i], f = s.local ? await kvGet('mufile:' + s.id).catch(() => null) : await cached(s);
  const body = (s.local && !f) || (f && f.type !== 'audio/mpeg') ? null : await songBody(s, f, c.ac.signal).catch(e => { log('warn', '音乐', `《${s.name}》接不上（${e.message}）：上一首放完要重新起步，在后台会停`); return null; });
  if (c !== chain || c.nexting !== s) return body && body.cancel();   // 换歌了 / 等的时候播放列表改了，这首不是下一首了
  if (body) return feed(c, i, s, body);
  op(c, () => { if (c.ms.readyState === 'open') c.ms.endOfStream(); });
}
/** 播放列表、播放模式变了：接在后面的那首不是下一首了就拆掉（已经续进去的删掉，还在下的不要了），让真正的下一首接上 */
function unchain() {
  const c = chain, g = seg(); if (!c || !g || M().mode === 'shuffle') return;
  const nx = c.segs[c.segs.indexOf(g) + 1], have = nx ? nx.s : c.nexting;
  if (!have || have === M().queue[pick(M().idx, true)]) return;
  if (nx) {
    nx.dead = true; c.segs.splice(c.segs.indexOf(nx));
    if (nx.start != null) { op(c, () => c.sb.remove(nx.start, Infinity)); op(c, () => { c.sb.timestampOffset = nx.start; run(c); }); }   // 删掉后接着从这首的结尾续
  }
  c.nexting = false;
}
/** 下一首是第几首；auto = 放完自动换（单曲循环就还是这首） */
function pick(i, auto) {
  const n = M().queue.length;
  if (auto && M().mode === 'one') return i;
  return M().mode === 'shuffle' && n > 1 ? (i + 1 + Math.floor(Math.random() * (n - 1))) % n : (i + 1) % n;
}

export function toggle() {
  if (!current()) return;
  if (loading()) { gen++; unload(); tell('state'); return; }   // 还在问链接：再点一下就不等了
  if (!restored) { const pos = M().pos || 0; load(true); whenLoaded(() => seek(pos)); return; }   // 刚打开手机：接着上次的地方
  if (!audio.src) return load(true);   // 刚才取消了：再点重新问
  audio.paused ? audio.play().catch(() => tell('blocked')) : halt();
}
export function next(step = 1, auto = false) {
  const n = M().queue.length; if (!n) return;
  M().idx = step === 1 ? pick(M().idx, false) : (M().idx + step + n) % n;
  load(true, !auto);
}
export const prev = () => next(-1);
export function seek(t) {
  if (!restored) return;
  const at = (seg()?.start || 0) + t, b = chain?.sb?.buffered;
  // 往回拖到已经清掉的地方（缓冲满时清了 30 秒以前的）：这首重新读，读好了跳过去
  if (b && b.length && at < b.start(0) - .5) { load(true); whenLoaded(() => seek(t)); return; }
  audio.currentTime = at;
}
export function jump(i) { M().idx = i; load(true); }
/** 播放列表改顺序：正在放的不动，已经续上的那几首重新对一下是第几首 */
function requeue(Q) { const c = current(); M().queue = Q; M().idx = Q.indexOf(c); if (chain) { chain.segs.forEach(g => { g.i = Q.indexOf(g.s); }); unchain(); } commit('music'); }
/** 置顶：放到正在放的这首后面，下一首就是它 */
export function queueNext(s) {
  const c = current(); if (!c) { playList([s]); return; }
  if (s.id === c.id) return;
  const Q = M().queue.filter(x => x.id !== s.id); Q.splice(Q.indexOf(c) + 1, 0, s); requeue(Q);   // 不在播放列表里的歌（搜出来的）也能插进来
}
/** 从播放列表里删掉；删的是正在放的就先切到下一首 */
export const queueSet = requeue;   // 播放列表里拖着排好的顺序
export function queueDel(s) { if (s === current()) next(); requeue(M().queue.filter(x => x !== s)); }
export const MODES = [['list', '列表循环', 'repeat'], ['one', '单曲循环', 'repeatOne'], ['shuffle', '随机播放', 'shuffle']];
export function cycleMode() { const i = MODES.findIndex(m => m[0] === M().mode); M().mode = MODES[(i + 1) % MODES.length][0]; commit('music'); unchain(); return MODES[(i + 1) % MODES.length]; }
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
  if (audio.src === HUSH) return;
  const t = Date.now(); if (t - lastT < 2000) heard += t - lastT; lastT = t;
  if (t - saveT > 5000) {
    saveT = t; M().pos = now(); M().heard = (M().heard || 0) + heard / 1000;
    const tc = together(); if (tc) { tgTimes()[tc.id] = (tgTimes()[tc.id] || 0) + heard / 1000; const r = tgRec(tc.id); r.sess = (r.sess || 0) + heard / 1000; r.best = Math.max(r.best || 0, r.sess); }
    heard = 0; commit('music');
  }
  const c = chain, g = seg();
  if (c && g) {
    // 这首下完了就去把下一首续上（只提前一首）：不等「还剩 40 秒」，拖到结尾也来得及，声音不会断
    if (!c.nexting && g.end) chainNext(c);
    // 放进了下一首：换歌名、歌词，把前一首的内容从这条声音里清掉（省内存）
    const nx = c.segs[c.segs.indexOf(g) + 1];
    if (nx && nx.start != null && audio.currentTime >= nx.start) {
      if (nx.i < 0) { next(1, true); tell('time'); return; }   // 已经续上的那首后来从播放列表里删了：跳过它
      M().idx = nx.i; c.nexting = false; fails = 0; c.segs.splice(0, c.segs.indexOf(nx)); enter(nx.s);
      op(c, () => { if (nx.start > 2) c.sb.remove(0, nx.start - 1); else run(c); });
    }
  }
  tell('time');
});
['play', 'pause'].forEach(ev => audio.addEventListener(ev, () => { fails = 0; if (ev === 'pause') { stuck = !asked && !audio.ended && document.hidden; asked = false; } else stuck = false; tell('state'); if (navigator.mediaSession) navigator.mediaSession.playbackState = ev === 'play' ? 'playing' : 'paused'; }));
audio.addEventListener('ended', () => { if (audio.src !== HUSH) next(1, true); });
// 后台时停了却不是自己叫的（续接时下一首的内容没及时到、或者浏览器不让开始放）：回到 App、碰屏幕时补放
let stuck = false, asked = false;
const halt = () => { asked = true; audio.pause(); };   // 自己叫的停
// 浏览器不让开始放（后台接下一首时 Tauri 常这样）：记下它的理由，回到 App、下一次碰屏幕时补一次
function blocked(e) {
  tell('blocked'); stuck = true;
  log('warn', '音乐', `浏览器没让《${(current() || {}).name}》开始放（${document.hidden ? '在后台' : '在前台'}）`, `${e && e.name}: ${e && e.message}`);
}
const again = () => { if (!stuck || !audio.src) return; stuck = false; audio.play().catch(blocked); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) again(); });
addEventListener('focus', again);
document.addEventListener('pointerdown', again, true);

/* ---------- 系统的「正在播放」（锁屏、控制中心、灵动岛） ---------- */
function sysInfo(s) {
  const ms = navigator.mediaSession; if (!ms) return;
  ms.metadata = new MediaMetadata({ title: s.name, artist: s.artist, artwork: s.pic ? [{ src: s.pic, sizes: '512x512' }] : [] });
}
if (navigator.mediaSession) {
  const ms = navigator.mediaSession, set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* 这个浏览器不支持这一项 */ } };
  set('play', () => toggle()); set('pause', halt);
  set('previoustrack', () => prev()); set('nexttrack', () => next());
  set('seekto', d => seek(d.seekTime));
}

/* ---------- 有人要说话时让一让 ----------
 * 手机自己的语音、酒馆里的正文朗读插件，开始念时在酒馆页面上发 asterphone-voice（detail 'start'），念完发 'end'。
 * 音乐先停、记住位置，念完接着放。 */
let ducked = false;
function duck(e) {
  if (e.detail === 'start' && !audio.paused) { ducked = true; halt(); }
  else if (e.detail === 'end' && ducked) { ducked = false; audio.play().catch(blocked); }
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

/* ---------- 角色的歌单：AI 想 TA 有哪些歌单、每个里放什么歌（「歌名 - 歌手」）和 TA 的感想，手机再一首首去搜；onStep(搜了几首, 一共几首) 给界面报进度 ---------- */
// 正文暗号一行「歌名 - 歌手｜歌单名｜感想｜简介」：歌单名没写就放进「喜欢的音乐」，简介只有新开的歌单才写
const parts = t => { const [song, name, thought, intro] = String(t).split(/[|｜]/).map(x => x.trim()); return { song, name: bare(name) || '喜欢的音乐', thought: thought || '', intro: intro || '' }; };
// 歌单名前后被【】「」《》[] 包着的去掉（AI 有时会自己加）
const bare = n => { const x = String(n || '').trim().replace(/^[【「『《\[]([^【】「」『』《》\[\]]+)[】」』》\]]$/, '$1').trim(); return x.startsWith('喜欢的音乐') ? '喜欢的音乐' : x; };
export async function charPick(c, onStep, stop) {
  const { personaOf, nameOf } = await import('../apps/chat/engine.js');
  const { storyText } = await import('./context.js');
  // 已有的歌单写成一行一个（不写成和要它回的一样的格式，不然 AI 会把已有的整个抄一遍）
  const existing = charLists(c).map(l => `「${l.name}」已有 ${l.songs.length} 首：${l.songs.slice(-15).map(label).join('；')}`).join('\n');
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '角色歌单', maxTokens: 6000, stop,
    prompt: compose('charSongs', { char: c.name || nameOf(c), persona: personaOf(c) || '（没有更多资料）', story: storyText(6) || '（暂无）',
      existing: (existing || '（还没有歌单）') + (charLists(c).some(l => l.name === '喜欢的音乐') ? '' : '\n（还没有「喜欢的音乐」：这次一定要开，第一个写它）') }) });   // AI 常把「喜欢的音乐」忘了，没有的时候单独再提醒一遍
  // 一行一首（不用 JSON：AI 在感想里写个引号 JSON 就坏了；回到一半断了，前面的歌也能用）；「备选：」开头的是这个歌单的备选
  let cur = { name: '喜欢的音乐', intro: '' }; const todo = [];
  for (const t of String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').split('\n').map(x => x.trim())) {
    const m = t.match(/^(歌单|路人|备选)[:：]\s*(.+)$/), [a, b = ''] = (m ? m[2] : t).split(/[|｜]/).map(x => x.trim());
    if (m && m[1] === '歌单') cur = { name: bare(a) || '喜欢的音乐', intro: b };
    else if (m && m[1] === '路人') { if (todo.length && b) (todo.at(-1).others = todo.at(-1).others || []).push({ name: a, text: b }); }
    else if (/\s[-–—]\s/.test(a)) todo.push({ song: a.replace(/^(\d+[.、)）]|[-*•])\s*/, ''), thought: b, spare: !!m, ...cur });
  }
  if (!todo.length) throw new Error('AI 回的不是歌单：' + String(raw).slice(0, 60));
  const find = async q => (await findSong(q)) || (await new Promise(r => setTimeout(r, 800)), await findSong(q));   // 没搜到的歇一下再搜一次（音源一下子收到好几个请求时会漏回）
  // AI 抄了已有的：歌单里已经有同名的歌就不去搜了
  const has = x => (charLists(c).find(l => l.name === x.name)?.songs || []).some(s => s.name.toLowerCase() === x.song.split(/\s[-–—]\s/)[0].trim().toLowerCase());
  const main = todo.filter(x => !x.spare), spare = todo.filter(x => x.spare), miss = [], got = [], need = {};
  let dup = 0, used = 0, n = 0;
  const lack = x => { need[x.name] = (need[x.name] || 0) + 1; };
  const put = async (x, s) => { if (!addToChar(c, s, x.name, x.intro)) return false; got.push(s); await songThought(c, s, x.thought, x.others); return true; };
  // 先搜正选：四首一起搜（一首一首搜太慢），搜完按 AI 给的顺序放进歌单；没搜到的、重复的记下这个歌单还差几首
  const go = main.filter(x => has(x) ? (dup++, lack(x), false) : true), found = []; let k = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (k < go.length) { const i = k++; found[i] = await find(go[i].song); onStep && onStep(++n, go.length); } }));
  for (const [i, x] of go.entries()) { if (!found[i]) { miss.push(x.song); lack(x); } else if (!(await put(x, found[i]))) { dup++; lack(x); } }
  // 再用备选补：哪个歌单差几首，就按顺序拿它的备选去搜，补够为止
  for (const x of spare) {
    if (!need[x.name] || has(x)) continue;
    onStep && onStep(n, go.length, true);
    const s = await find(x.song);
    if (s && await put(x, s)) { need[x.name]--; used++; }
  }
  if (miss.length) log('warn', '角色歌单', `${miss.length} 首在音源里没搜到：${miss.join('、')}`);
  if (!got.length && !dup) throw new Error('AI 挑的歌一首都没搜到');
  return { got, miss: miss.length, dup, used, short: Object.values(need).reduce((a, b) => a + b, 0) };
}
/** TA 对歌单里这首歌的感想（还有路人评论）放进这首歌的评论区；写乐评重来时这些留着（fromList） */
async function songThought(c, s, text, others) {
  const L = [...(text ? [{ who: c.id, kind: '联系人', name: c.nick || c.name, text, likes: 1000 + Math.floor(Math.random() * 9000) }] : []),
    ...(Array.isArray(others) ? others : []).filter(o => o && o.text).map(o => ({ name: o.name || '网友', text: o.text, likes: +o.likes || 0 }))];
  if (!L.length) return;
  const { load } = await import('../apps/music/comments.js'), d = await load(s);
  d.list.push(...L.map(x => ({ id: uid('c'), ...x, at: Date.now(), fromList: true, replies: [] })));
  await kvSet('aicmt:' + s.id, d).catch(e => log('warn', '音乐', `《${s.name}》的感想没存上：${e.message}`));
}
/** TA 的歌单：「喜欢的音乐」排第一，其他按心情、风格分：[{ id, name, intro, songs }]。以前每人只有一个 c.songs，第一次读时搬进「喜欢的音乐」 */
export function charLists(c) {
  if (c.songs) { if (c.songs.length) (c.lists = c.lists || []).unshift({ id: uid('cl'), name: '喜欢的音乐', intro: '', songs: c.songs }); delete c.songs; }
  const L = c.lists || (c.lists = []);
  L.forEach(l => { l.name = bare(l.name); });   // v0.8.37 生成的带括号的名字
  // 「喜欢的音乐」永远排第一；AI 起成「喜欢的音乐(つдC)」也算它，有两个就并成一个
  const fav = L.filter(l => l.name === '喜欢的音乐');
  if (fav.length && (L[0] !== fav[0] || fav.length > 1)) {
    fav.slice(1).forEach(x => x.songs.forEach(s => { if (!fav[0].songs.some(y => y.id === s.id)) fav[0].songs.push(s); }));
    c.lists = [fav[0], ...L.filter(l => !fav.includes(l))];
  }
  return c.lists;
}
export const charSongs = c => charLists(c).flatMap(l => l.songs);
/** 加一首进 TA 叫 name 的歌单，没有这个歌单就新开一个；这个歌单里已经有了就不加 */
export function addToChar(c, s, name = '喜欢的音乐', intro = '') {
  const L = charLists(c); let l = L.find(x => x.name === name);
  if (l && l.songs.some(x => x.id === s.id)) return false;   // 同一首歌能在 TA 好几个歌单里（真人也这样），同一个歌单里不重复
  if (!l) L[name === '喜欢的音乐' ? 'unshift' : 'push'](l = { id: uid('cl'), name, intro, songs: [] });
  l.songs.push(s); commit('contacts'); return true;
}
/** 正文暗号 type="加歌"：TA 把某首歌加进了自己的歌单 */
/* ---------- 一起听：和私聊里的一个人，或者一个群。M().together 是 TA 的联系人 id / 群聊 id；一起听了多少秒记在 M().tg[id] ---------- */
export const together = () => contact(M().together) || state.chats.find(x => x.id === M().together && x.type === 'group') || null;
const tgTimes = () => M().tg || (M().tg = {});
export const togetherSec = c => (tgTimes()[c.id] || 0) + (M().together === c.id ? heard / 1000 : 0);   // 一共一起听了多久（缘分报告）；还没存进去的那几秒也算上，一秒一秒涨
export const sessionSec = c => (tgRec(c.id).sess || 0) + (M().together === c.id ? heard / 1000 : 0);   // 这一次一起听了多久（播放页上写的，断了再听从头算）
export function listenWith(c) {
  if ((c ? c.id : '') !== M().together && c) { const r = tgRec(c.id); r.sess = 0; if (!r.first) r.first = stamp(); }   // 新开一次一起听：这次多久从 0 算；第一次一起听记下现实和剧情两个时间
  M().together = c ? c.id : ''; commit('music'); tell('together');
  if (c) tgSong(current());
}
/** 缘分报告要的：第一次一起听（现实 + 剧情）、一起听过的歌和次数、单次最长。M().tgr[id]，id 是联系人或群 */
export const tgRec = id => (M().tgr || (M().tgr = {}))[id] || (M().tgr[id] = { first: null, songs: {}, best: 0, sess: 0 });
function tgSong(s) {
  const c = together(); if (!c || !s) return;
  const x = tgRec(c.id).songs; (x[s.id] = x[s.id] || { n: 0, name: s.name, artist: s.artist }).n++;
}
/** 一起听时两个头像上的气泡：一组两句（左边我、右边 TA）。第一次用时把内置的抄一份，之后随便改；M().pair 是选中的那组，空 = 每首歌换一组 */
const PAIRS = [
  ['这首歌好像在说我们', '那就多听几遍'], ['耳机分你一半', '心也分你一半'], ['你那边听得清吗', '清楚，像你在耳边'], ['循环第几遍了', '没数，不想停'],
  ['别切歌', '等你听完这句'], ['天有点冷', '那靠近一点听'], ['下一首你来选', '选你喜欢的就好'], ['今天累不累', '听完这首就不累了'],
  ['好想现在见你', '闭上眼，我就在旁边'], ['你在跟着哼吗', '被你发现了'], ['这首能听一整晚', '那我陪你一整晚'], ['你那边下雨了吗', '这边晴天，分你一点'],
  ['这句写得真好', '像你会说的话'], ['晚安前最后一首', '那就放慢一点'], ['同一秒听到同一句', '好像就在一起'], ['隔着屏幕也算吗', '算，心在一起就算'],
  ['这首让我想起你', '那我以后常出现'], ['你笑什么', '想到你了'], ['一听前奏就知道是你', '懂我'], ['明天也一起听吗', '每天都一起听'],
  ['睡着了吗', '还没，在等这首放完'], ['有点想哭', '我在呢'], ['走在路上听的吗', '嗯，像你陪我散步'], ['你喜欢哪一句', '你偷偷哼的那句'],
  ['风好大', '让歌替我抱你一下'], ['副歌要来了', '准备好了'], ['想把这一刻存起来', '我已经存好了'], ['听歌时在想什么', '在想你在想什么'],
];
export const pairs = () => M().pairs || (M().pairs = PAIRS.map(([a, b]) => ({ id: uid('pr'), a, b })));
export function pairNow() {
  const L = pairs(), s = current(); if (!L.length) return null;
  return L.find(x => x.id === M().pair) || L[[...String(s && s.id)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % L.length];   // 按歌挑，同一首歌一直是同一组
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
  if (M().storyWho && !M().storyWho.includes(c.id)) return;   // 没勾上的人不加
  const x = parts(text), s = await findSong(x.song);
  if (!s) { log('warn', '音乐', `正文里「${c.name}」加了歌《${x.song}》，但没搜到`); return; }
  if (addToChar(c, s, x.name, x.intro)) { log('info', '音乐', `正文里「${c.name}」把《${s.name}》加进了歌单「${x.name}」`); await songThought(c, s, x.thought); }
}

import('./floatlyric.js');   // 歌词悬浮窗跟着播放器一起起来
import('../apps/music/island.js');   // 灵动岛、锁屏播放卡片
