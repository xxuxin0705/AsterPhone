// AsterPhone 的酒馆服务器插件（可选）：替手机去连网易云和 QQ 音乐。
// 只有本地酒馆装得上；Tauri Tavern 没有它，手机就照旧用公共音源。
// 连网易云用开源库 NeteaseCloudMusicApi（裸接口扫码会被网易云拦），连 QQ 音乐用 @sansenjian/qq-music-api（照「你自己的音乐源」插件的做法，见 docs/credits.md）。
// 登录后的凭证只存在这个文件夹的 .netease_cred / .qq_cred 里，只发给网易云 / QQ。
const fs = require('fs');
const path = require('path');
const ncm = require('NeteaseCloudMusicApi');
const qqSdk = require('@sansenjian/qq-music-api/sdk');
const qqSvc = require('@sansenjian/qq-music-api/services');

const CRED = path.join(__dirname, '.netease_cred'), QCRED = path.join(__dirname, '.qq_cred');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
let cookie = '', me = null;   // me：登录的人（昵称、头像、uid），null = 没登录或过期
try { cookie = fs.readFileSync(CRED, 'utf8').trim(); } catch { /* 还没登录过 */ }
if (cookie && !cookie.includes('=')) cookie = 'MUSIC_U=' + cookie;   // 旧版只存了 MUSIC_U 那一串

/** 调一个接口，回网易云给的内容；网易云说不行时把它的话当错误抛出来 */
async function api(name, q = {}) {
  try { return (await ncm[name]({ ...q, cookie, timestamp: Date.now() })).body; }
  catch (e) { const b = (e && e.body) || {}; throw new Error(b.message || b.msg || (b.code ? `网易云回 ${b.code}` : String(e.message || e))); }
}
const https = u => String(u || '').replace(/^http:\/\//i, 'https://');
const song = x => ({ id: String(x.id), name: x.name, artist: (x.ar || x.artists || []).map(a => a.name).join(' / ') || '未知歌手', pic: https((x.al || x.album || {}).picUrl) });

async function whoami() {
  me = null;
  if (!cookie) return;
  const d = (await api('login_status')).data || {};
  if (d.profile) me = { uid: d.profile.userId, name: d.profile.nickname, avatar: https(d.profile.avatarUrl), vip: !!(d.account && d.account.vipType) };
}
function save(c) {
  cookie = c;
  if (c) fs.writeFileSync(CRED, c, { mode: 0o600 }); else fs.rmSync(CRED, { force: true });
  return whoami();
}
// 酒馆不一定替插件把请求内容解析好，自己读一下
async function body(req) {
  if (req.body && Object.keys(req.body).length) return req.body;
  let s = ''; for await (const c of req) s += c;
  try { return JSON.parse(s); } catch { return {}; }
}
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { if (!res.headersSent) res.status(502).json({ error: e.message }); }
};
/** 把歌曲文件转一手给前端（网易云、QQ 给的地址在别的域名，前端读不了内容；和酒馆同一个地址就能边下边续） */
async function pipe(res, req, u, ref = 'https://y.qq.com/') {
  const r = await fetch(https(u), { headers: { 'User-Agent': UA, Referer: ref, ...(req.headers.range ? { Range: req.headers.range } : {}) } });
  res.status(r.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) res.setHeader(h, r.headers.get(h));
  const reader = r.body.getReader();
  req.on('close', () => reader.cancel().catch(() => {}));
  for (let x; !(x = await reader.read()).done;) if (!res.write(x.value)) await new Promise(ok => res.once('drain', ok));
  res.end();
}

/* ---------- QQ 音乐：扫码登录、你的歌单、会员音质。搜歌、歌词、联想手机自己走公共音源，这里不管 ---------- */
let qcookie = '', qme = null;   // qme：{ uin, name, avatar }，null = 没登录
try { qcookie = fs.readFileSync(QCRED, 'utf8').trim(); } catch { /* 还没登录过 */ }
const quin = () => ((qcookie.match(/(?:^|;\s*)(?:uin|wxuin)=o?(\d+)/i) || [])[1] || '').replace(/^0+/, '');   // QQ 的 uin 前面会补 0
const qbody = r => { const b = (r && r.body) || {}; if (b.error) throw new Error(typeof b.error === 'string' ? b.error : b.message || 'QQ 音乐回了错误'); return b; };
const qsong = x => ({ id: String(x.mid || x.songmid || ''), src: 'qq', name: x.name || x.songname || x.title || '', artist: (x.singer || []).map(a => a.name).filter(Boolean).join(' / ') || '未知歌手',
  pic: (x.album || {}).mid || x.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${(x.album || {}).mid || x.albummid}.jpg` : '', ...(x.vid || (x.mv || {}).vid ? { vid: x.vid || x.mv.vid } : {}) });
const qlist = p => ({ id: 'q' + p.dissid, name: p.title || p.dissname || '', pic: https(p.picurl || p.logo), n: +(p.songnum || 0) });
async function qwhoami() {
  qme = null; const uin = quin();
  if (!qcookie || !uin) return;
  qme = { uin, name: 'QQ ' + uin, avatar: '' };
  try { const d = (qbody(await qqSvc.getUserDetail({ uin, cookie: qcookie })).response || {}).data || {}, c = d.creator || {}; if (c.nick) qme.name = c.nick; if (c.headpic) qme.avatar = https(c.headpic); } catch { /* 读不到名字就显示 QQ 号 */ }
}
function qsave(c) {
  qcookie = c;
  if (c) fs.writeFileSync(QCRED, c, { mode: 0o600 }); else fs.rmSync(QCRED, { force: true });
  return qwhoami();
}
/** QQ 的播放链接（带登录凭证，会员的歌、高音质要登录才给）：先要 320k，不给退到 128k */
async function qurl(mid) {
  for (const quality of ['320', '128']) {
    const b = qbody(await qqSdk.getPlayUrl({ songmid: mid, quality, cookie: qcookie }));
    const u = (((b.data || {}).playUrl || {})[mid] || {}).url; if (u) return u;
  }
  return '';
}

/* ---------- B 站：网易云 / QQ 都放不了的歌、找不到 MV 的歌，去 B 站搜同名视频（匿名就行；搜索要带 buvid3，不然回 -412）。
 * B 站的文件要带 Referer 才给，所以都由这里转一手 ---------- */
let buvid = '';
async function bili(p, ref = 'https://www.bilibili.com/') {
  if (!buvid) buvid = ((await (await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': UA } })).json()).data || {}).b_3 || '';
  const j = await (await fetch('https://api.bilibili.com/x' + p, { headers: { 'User-Agent': UA, Referer: ref, Cookie: 'buvid3=' + buvid } })).json();
  if (j.code !== 0) throw new Error(j.message || `B 站回 ${j.code}`);
  return j.data;
}
const found = new Map();   // 搜过的词 → 视频；拖进度条时播放器会接连要好几次，别每次都去搜
async function biliFind(word) {
  const c = found.get(word); if (c && Date.now() - c.at < 3600e3) return c;
  const v = ((await bili('/web-interface/search/type?' + new URLSearchParams({ search_type: 'video', keyword: word, page: 1 }), 'https://search.bilibili.com/')).result || [])[0];
  if (!v) throw new Error('B 站没搜到');
  const r = { bvid: v.bvid, cid: (await bili('/web-interface/view?bvid=' + v.bvid)).cid, at: Date.now() };
  found.set(word, r);
  return r;
}
/** 搜到的视频转给前端：audio = 只要声音（m4a），否则要能直接放的 mp4 */
const biliPipe = audio => async (req, res) => {
  try {
    const v = await biliFind(String(req.query.word || '')), ref = 'https://www.bilibili.com/video/' + v.bvid;
    const d = await bili('/player/playurl?' + new URLSearchParams({ bvid: v.bvid, cid: v.cid, ...(audio ? { fnval: 16, platform: 'pc' } : { fnval: 1, qn: 64, platform: 'html5' }) }), ref);
    const u = audio ? ((((d.dash || {}).audio || []).sort((a, b) => b.bandwidth - a.bandwidth)[0]) || {}).baseUrl : ((d.durl || [])[0] || {}).url;
    if (!u) return res.status(404).json({ error: 'B 站没给能放的地址' });
    await pipe(res, req, u, ref);
  } catch (e) { if (!res.headersSent) res.status(502).json({ error: e.message }); else res.end(); }
};

// 网易云最近常拦新的登录，但已经登录过的凭证还能用：酒馆里别的音乐插件登录过的话，借它存的那份
const other = () => {
  const dir = path.join(__dirname, '..');
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'backend', 'data', 'cookie.txt');
    if (d !== path.basename(__dirname) && fs.existsSync(f)) return f;
  }
  return '';
};

async function init(router) {
  whoami().catch(() => {}); qwhoami().catch(() => {});
  router.get('/status', wrap(() => ({ ok: true, me, qq: qme, borrow: !me && !!other() })));
  // QQ 扫码登录：要一张二维码 → 前端每两秒问一次 → 扫完把 QQ 给的登录凭证存下
  router.get('/qq/qr', wrap(async () => { const b = qbody(await qqSdk.getQQLoginQr()); if (!b.img) throw new Error('QQ 没给二维码'); return { key: Buffer.from(JSON.stringify({ ptqrtoken: b.ptqrtoken, qrsig: b.qrsig })).toString('base64url'), img: b.img }; }));
  router.get('/qq/qr/check', wrap(async req => {
    const b = qbody(await qqSdk.checkQQLoginQr(JSON.parse(Buffer.from(String(req.query.key || ''), 'base64url').toString('utf8'))));
    if (b.isOk && b.session && b.session.cookie) { await qsave(b.session.cookie); if (!qme) { await qsave(''); throw new Error('登录了，但凭证里没有 QQ 号'); } }
    return { code: b.isOk ? 803 : b.refresh ? 800 : 801, qq: qme };   // 和网易云一样的码：803 登录了、800 二维码过期、801 等着扫
  }));
  router.post('/qq/logout', wrap(async () => { await qsave(''); return { qq: qme }; }));
  router.get('/qq/playlists', wrap(async () => {
    if (!qme) return [];
    // 自己建的 + 收藏的；两个都失败才算失败
    const [a, b] = await Promise.allSettled([qqSvc.getUserPlaylists({ uin: qme.uin, limit: 200, cookie: qcookie }).then(r => (qbody(r).response.data || {}).playlists || []), qqSvc.getUserCollectedSongLists({ uin: qme.uin, limit: 200, cookie: qcookie }).then(r => ((qbody(r).response || {}).data || {}).cdlist || [])]);
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    return [...(a.value || []), ...(b.value || [])].filter(p => p.dissid).map(qlist);
  }));
  router.get('/qq/playlist', wrap(async req => {
    const pl = ((qbody(await qqSvc.songListDetail({ method: 'get', params: { disstid: String(req.query.id).replace(/^q/, '') }, option: qcookie ? { headers: { Cookie: qcookie } } : {} })).response || {}).cdlist || [])[0];
    if (!pl || !Array.isArray(pl.songlist)) throw new Error('QQ 没回歌单（可能不是公开的）');
    return { title: pl.dissname || '', pic: https(pl.logo), songs: pl.songlist.map(qsong).filter(s => s.id && s.name) };
  }));
  router.get('/qq/audio', async (req, res) => {
    try {
      const u = await qurl(String(req.query.mid || ''));
      if (!u) return res.status(404).json({ error: qme ? '这首歌放不了（下架或要单曲付费）' : '要会员，先登录 QQ 音乐' });
      await pipe(res, req, u);
    } catch (e) { if (!res.headersSent) res.status(502).json({ error: e.message }); else res.end(); }
  });
  router.post('/borrow', wrap(async () => {
    const f = other(); if (!f) throw new Error('没找到别的插件存的登录');
    await save(fs.readFileSync(f, 'utf8').trim());
    if (!me) { await save(''); throw new Error('那份登录已经过期了'); }
    return { me };
  }));

  // 扫码登录：要一个 key 生成二维码图 → 前端每两秒问一次 → 803 就把网易云给的登录凭证存下
  router.get('/qr', wrap(async () => {
    const key = (await api('login_qr_key')).data.unikey;
    const d = (await api('login_qr_create', { key, qrimg: true, platform: 'web' })).data;
    return { key, img: d.qrimg };
  }));
  router.get('/qr/check', wrap(async req => {
    const b = await api('login_qr_check', { key: req.query.key });
    if (b.code !== 801) console.log('[AsterPhone] 扫码登录：', b.code, b.message || '');   // 801 是还在等扫，太多不打
    if (b.code === 803) await save(b.cookie);
    return { code: b.code, message: b.message || '', me };
  }));
  // 手机号 + 短信验证码登录（扫码被拦时用）
  router.post('/sms', wrap(async req => { await api('captcha_sent', { phone: String((await body(req)).phone || '') }); return { ok: true }; }));
  router.post('/phone', wrap(async req => {
    const b = await body(req), r = await api('login_cellphone', { phone: String(b.phone || ''), captcha: String(b.captcha || '') });
    if (!r.cookie) throw new Error(r.message || '没登录上');
    await save(r.cookie);
    if (!me) throw new Error('登录了，但读不到账号信息');
    return { me };
  }));
  // 兜底：自己从网页版网易云复制登录凭证（整段 Cookie 或只有 MUSIC_U 那一串都行）
  router.post('/cookie', wrap(async req => {
    const c = String((await body(req)).cookie || '').trim();
    await save(c.includes('=') ? c : 'MUSIC_U=' + c);
    if (!me) { await save(''); throw new Error('这个凭证登录不上（可能过期了）'); }
    return { me };
  }));
  router.post('/logout', wrap(async () => { await api('logout').catch(() => {}); await save(''); return { me, borrow: !!other() }; }));   // 网易云那边退不掉也没关系，本地凭证删了就算退了

  router.get('/search', wrap(async req => (((await api('cloudsearch', { keywords: req.query.word, limit: 30, offset: ((+req.query.page || 1) - 1) * 30 })).result || {}).songs || []).map(song)));   // page：第几页，一页 30 首
  router.get('/search/lists', wrap(async req => (((await api('cloudsearch', { keywords: req.query.word, type: 1000, limit: 20 })).result || {}).playlists || [])
    .map(p => ({ id: String(p.id), name: p.name, pic: https(p.coverImgUrl), n: p.trackCount, plays: p.playCount, by: (p.creator || {}).nickname || '' }))));
  // 打字时的联想：网页版联想里挑最对得上的歌手 / 歌（order 是网易云排的先后），手机版联想给一串词
  router.get('/suggest', wrap(async req => {
    const [web, mob] = await Promise.all([api('search_suggest', { keywords: req.query.word }), api('search_suggest', { keywords: req.query.word, type: 'mobile' })]);
    const r = web.result || {}, a = (r.artists || [])[0], s = (r.songs || [])[0], artist = a && { artist: a.name, pic: https(a.img1v1Url || a.picUrl) };
    return { top: ((r.order || [])[0] === 'artists' && artist) || (s && { song: song(s) }) || artist || null, words: ((mob.result || {}).allMatch || []).map(x => x.keyword) };
  }));
  // 分享出来的短链接（网易云 163cn.tv、QQ c6.y.qq.com）：问出它跳到哪（只跟着网易云 / QQ 自己的地址走）
  router.get('/resolve', wrap(async req => {
    let u = String(req.query.url || '');
    if (!/^https?:\/\/(163cn\.tv|c6\.y\.qq\.com)\//.test(u)) throw new Error('不是网易云 / QQ 音乐的分享链接');
    for (let i = 0; i < 3 && /^https?:\/\/(163cn\.tv|([\w-]+\.)?music\.163\.com|([\w-]+\.)?y\.qq\.com)\//.test(u); i++) {
      const loc = (await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA } })).headers.get('location');
      if (!loc) break;
      u = new URL(loc, u).href;
    }
    return { url: u };
  }));
  router.get('/playlist', wrap(async req => ((await api('playlist_track_all', { id: req.query.id, limit: 1000 })).songs || []).map(song)));
  router.get('/daily', wrap(async () => (((await api('recommend_songs')).data || {}).dailySongs || []).map(song)));
  router.get('/playlists', wrap(async () => {
    if (!me) return [];
    return ((await api('user_playlist', { uid: me.uid, limit: 50 })).playlist || []).map(p => ({ id: String(p.id), name: p.name, pic: https(p.coverImgUrl), n: p.trackCount }));
  }));
  router.get('/lyric', wrap(async req => {
    const j = await api('lyric_new', { id: req.query.id });
    return { lrc: (j.lrc || {}).lyric || '', tr: (j.tlyric || {}).lyric || '', yrc: (j.yrc || {}).lyric || '' };
  }));
  // MV：网易云的歌按编号查；QQ 的歌按歌名 + 歌手在网易云搜，歌名对得上、带 MV 的才算
  router.get('/mv', wrap(async req => {
    const { id, name, artist } = req.query;
    const L = id ? (await api('song_detail', { ids: id })).songs || [] : ((await api('cloudsearch', { keywords: `${name} ${artist}`, limit: 10 })).result || {}).songs || [];
    return { mv: ((id ? L[0] : L.find(x => x.name === name && x.mv)) || {}).mv || 0 };
  }));
  router.get('/mv/url', wrap(async req => ({ url: https(((await api('mv_url', { id: req.query.id })).data || {}).url) })));
  router.get('/bili/audio', biliPipe(true));
  router.get('/bili/mv', biliPipe(false));
  // 替洛雪音源脚本连网（网页自己连常被跨域拦，请求头也带不全）
  router.post('/fetch', wrap(async req => {
    const b = await body(req), url = String(b.url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('只连 http(s)');
    const r = await fetch(url, { method: b.method || 'GET', headers: { 'User-Agent': UA, ...(b.headers || {}) }, body: b.body || undefined, signal: AbortSignal.timeout(15000) });
    return { statusCode: r.status, statusMessage: r.statusText, headers: Object.fromEntries(r.headers), body: await r.text() };
  }));
  router.get('/comments', wrap(async req => api('comment_hot', { id: req.query.id, type: 0, limit: 20 })));
  router.post('/like', wrap(async req => { const b = await body(req); return { code: (await api('like', { id: b.id, like: String(!!b.like) })).code }; }));

  // 歌曲本身：网易云给的地址在别的域名，前端读不了内容；这里转一手，和酒馆同一个地址就能边下边续
  router.get('/audio', async (req, res) => {
    try {
      const u = (((await api('song_url_v1', { id: req.query.id, level: 'exhigh' })).data || [])[0] || {}).url;
      if (!u) return res.status(404).json({ error: me ? '这首歌放不了（下架或要单曲付费）' : '要会员，先登录网易云' });
      await pipe(res, req, u);
    } catch (e) { if (!res.headersSent) res.status(502).json({ error: e.message }); else res.end(); }
  });
}

module.exports = { init, exit: async () => {}, info: { id: 'asterphone', name: 'AsterPhone', description: 'AsterPhone 小手机的网易云 / QQ 音乐登录和音源' } };
