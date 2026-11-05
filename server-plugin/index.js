// AsterPhone 的酒馆服务器插件（可选）：替手机去连网易云。
// 只有本地酒馆装得上；Tauri Tavern 没有它，手机就照旧用公共音源。
// 连网易云用开源库 NeteaseCloudMusicApi（裸接口扫码会被网易云拦）。
// 登录后的凭证只存在这个文件夹的 .netease_cred 里，只发给网易云。
const fs = require('fs');
const path = require('path');
const ncm = require('NeteaseCloudMusicApi');

const CRED = path.join(__dirname, '.netease_cred');
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
  whoami().catch(() => {});
  router.get('/status', wrap(() => ({ ok: true, me, borrow: !me && !!other() })));
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
  // 分享出来的短链接（163cn.tv）：问出它跳到哪个网易云地址（只跟着网易云自己的地址走）
  router.get('/resolve', wrap(async req => {
    let u = String(req.query.url || '');
    if (!/^https?:\/\/163cn\.tv\//.test(u)) throw new Error('不是网易云的分享链接');
    for (let i = 0; i < 3 && /^https?:\/\/(163cn\.tv|([\w-]+\.)?music\.163\.com)\//.test(u); i++) {
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
  router.get('/comments', wrap(async req => api('comment_hot', { id: req.query.id, type: 0, limit: 20 })));
  router.post('/like', wrap(async req => { const b = await body(req); return { code: (await api('like', { id: b.id, like: String(!!b.like) })).code }; }));

  // 歌曲本身：网易云给的地址在别的域名，前端读不了内容；这里转一手，和酒馆同一个地址就能边下边续
  router.get('/audio', async (req, res) => {
    try {
      const u = (((await api('song_url_v1', { id: req.query.id, level: 'exhigh' })).data || [])[0] || {}).url;
      if (!u) return res.status(404).json({ error: me ? '这首歌放不了（下架或要单曲付费）' : '要会员，先登录网易云' });
      const r = await fetch(https(u), { headers: { 'User-Agent': UA, ...(req.headers.range ? { Range: req.headers.range } : {}) } });
      res.status(r.status);
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(h)) res.setHeader(h, r.headers.get(h));
      const reader = r.body.getReader();
      req.on('close', () => reader.cancel().catch(() => {}));
      for (let x; !(x = await reader.read()).done;) if (!res.write(x.value)) await new Promise(ok => res.once('drain', ok));
      res.end();
    } catch (e) { if (!res.headersSent) res.status(502).json({ error: e.message }); else res.end(); }
  });
}

module.exports = { init, exit: async () => {}, info: { id: 'asterphone', name: 'AsterPhone', description: 'AsterPhone 小手机的网易云登录和音源' } };
