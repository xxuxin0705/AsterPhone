// AsterPhone 的酒馆服务器插件（可选）：替手机去连网易云。
// 只有本地酒馆装得上；Tauri Tavern 没有它，手机就照旧用公共音源。
// 登录后的 MUSIC_U 只存在这个文件夹的 .netease_cred 里，只发给网易云。
const fs = require('fs');
const path = require('path');
const qrcode = require('./qrcode.js');

const CRED = path.join(__dirname, '.netease_cred');
const NE = 'https://music.163.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
let cookie = '', me = null;   // me：登录的人（昵称、头像、uid），null = 没登录或过期
try { cookie = fs.readFileSync(CRED, 'utf8').trim(); } catch { /* 还没登录过 */ }

const headers = (withCookie = true) => ({ Referer: NE, 'User-Agent': UA, ...(withCookie && cookie ? { Cookie: `MUSIC_U=${cookie}; os=pc; appver=2.10.13` } : {}) });
async function ne(p, form, withCookie = true) {
  const r = await fetch(NE + p, form
    ? { method: 'POST', headers: { ...headers(withCookie), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) }
    : { headers: headers(withCookie) });
  return { j: await r.json(), r };
}
const https = u => String(u || '').replace(/^http:\/\//i, 'https://');
const song = x => ({ id: String(x.id), name: x.name, artist: (x.ar || x.artists || []).map(a => a.name).join(' / ') || '未知歌手', pic: https((x.al || x.album || {}).picUrl) });

async function whoami() {
  me = null;
  if (!cookie) return;
  const { j } = await ne('/api/nuser/account/get');
  if (j.profile) me = { uid: j.profile.userId, name: j.profile.nickname, avatar: https(j.profile.avatarUrl), vip: !!(j.account && j.account.vipType) };
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

async function init(router) {
  whoami().catch(() => {});
  router.get('/status', wrap(() => ({ ok: true, me })));

  // 扫码登录：拿一个 key 画成二维码 → 前端每两秒问一次 → 803 就从响应头里取 MUSIC_U
  router.get('/qr', wrap(async () => {
    const { j } = await ne('/api/login/qrcode/unikey', { type: 3 }, false);
    const link = `${NE}/login?codekey=${j.unikey}`, q = qrcode(0, 'M');
    q.addData(link); q.make();
    return { key: j.unikey, link, svg: q.createSvgTag({ cellSize: 4, margin: 8, scalable: true }) };
  }));
  router.get('/qr/check', wrap(async req => {
    const { j, r } = await ne('/api/login/qrcode/client/login', { key: req.query.key, type: 3 }, false);
    if (j.code === 803) {
      const m = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie') || '']).join(';').match(/MUSIC_U=([^;]+)/);
      if (!m) throw new Error('登录成功了，但网易云没给登录凭证');
      await save(m[1]);
    }
    return { code: j.code, me };
  }));
  router.post('/cookie', wrap(async req => {
    const c = String((await body(req)).cookie || '').trim().replace(/^.*MUSIC_U=/, '').replace(/;.*$/, '');
    await save(c);
    if (!me) { await save(''); throw new Error('这个 MUSIC_U 登录不上（可能过期了）'); }
    return { me };
  }));
  router.post('/logout', wrap(async () => { await save(''); return { me }; }));

  router.get('/search', wrap(async req => {
    const { j } = await ne('/api/search/get', { s: req.query.word, type: 1, limit: 30, offset: 0 });
    const ids = ((j.result || {}).songs || []).map(s => s.id);
    if (!ids.length) return [];
    const d = await ne(`/api/song/detail?ids=[${ids}]`);   // 搜索结果里没有封面，再补一次
    return (d.j.songs || []).map(song);
  }));
  router.get('/playlist', wrap(async req => (((await ne(`/api/v6/playlist/detail?id=${+req.query.id}&n=1000&s=0`)).j.playlist || {}).tracks || []).map(song)));
  router.get('/daily', wrap(async () => (((await ne('/api/v3/discovery/recommend/songs')).j.data || {}).dailySongs || []).map(song)));
  router.get('/playlists', wrap(async () => {
    if (!me) return [];
    const { j } = await ne(`/api/user/playlist?uid=${me.uid}&limit=50&offset=0`);
    return (j.playlist || []).map(p => ({ id: String(p.id), name: p.name, pic: https(p.coverImgUrl), n: p.trackCount }));
  }));
  router.get('/lyric', wrap(async req => {
    const { j } = await ne(`/api/song/lyric?id=${+req.query.id}&lv=1&tv=-1&yv=1`);
    return { lrc: (j.lrc || {}).lyric || '', tr: (j.tlyric || {}).lyric || '', yrc: (j.yrc || {}).lyric || '' };
  }));
  router.get('/comments', wrap(async req => (await ne(`/api/v1/resource/comments/R_SO_4_${+req.query.id}?limit=20`)).j));
  router.post('/like', wrap(async req => {
    const b = await body(req);
    const { j } = await ne('/api/song/like', { trackId: +b.id, like: !!b.like, time: 3, alg: 'itembased' });
    return { code: j.code };
  }));

  // 歌曲本身：网易云给的地址在别的域名，前端读不了内容；这里转一手，和酒馆同一个地址就能边下边续
  router.get('/audio', async (req, res) => {
    try {
      const { j } = await ne(`/api/song/enhance/player/url?ids=[${+req.query.id}]&br=320000`);
      const u = ((j.data || [])[0] || {}).url;
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
