// 洛雪音源：洛雪自己不带歌，放歌全靠网上别人写的「音源脚本」。这里假装成洛雪，把 pdone/lx-music-source 合集（每天检测、跟着作者更新）里的几个脚本跑起来，问它们要整首的播放链接。
// 脚本是陌生人写的、大多还加了混淆：关在沙盒框里跑（碰不到酒馆页面和存的密钥），它要连网时把请求递出来，这边替它连。
import { log } from './log.js';

// 挑的是网易云、QQ 都支持、又不用加密工具（aes / rsa）的；太大的（几百 KB）不要
const NAMES = ['huibq', 'huanyin', 'helloworld', 'hyw', 'changqing', 'flower', 'qdy', 'xinghai', 'lx', 'jiexiang', 'juhe'];
const CDN = n => `https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/${n}/latest.js`;

/* 沙盒框里跑的：给每个脚本一个假的 lx（洛雪给脚本的那套东西），脚本说自己能放哪些平台、给出链接、要连网，都递给外面 */
function runtime() {
  const up = m => parent.postMessage(m, '*'), wait = new Map(), hooks = new Map(), enc = new TextEncoder(), dec = new TextDecoder();
  let n = 0;
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const str = (b, f) => f === 'hex' ? hex(b) : f === 'base64' ? btoa(Array.from(b, c => String.fromCharCode(c)).join('')) : dec.decode(b);
  class Buf extends Uint8Array { toString(f) { return str(this, f); } }
  const from = (d, f) => Buf.from(typeof d !== 'string' ? d : f === 'hex' ? (d.match(/../g) || []).map(x => parseInt(x, 16)) : f === 'base64' ? Array.from(atob(d), c => c.charCodeAt(0)) : enc.encode(d));
  function md5(d) {
    const b = typeof d === 'string' ? enc.encode(d) : d, len = ((b.length + 8) >> 6) + 1, w = new Uint32Array(len * 16), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < b.length; i++) w[i >> 2] |= b[i] << (i % 4 * 8);
    w[b.length >> 2] |= 0x80 << (b.length % 4 * 8); w[len * 16 - 2] = b.length * 8;
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let j = 0; j < w.length; j += 16) {
      let [A, B, C, D] = h;
      for (let i = 0; i < 64; i++) {
        const r = i >> 4, F = r === 0 ? (B & C) | (~B & D) : r === 1 ? (D & B) | (~D & C) : r === 2 ? B ^ C ^ D : C ^ (B | ~D), g = [i, 5 * i + 1, 3 * i + 5, 7 * i][r] % 16;
        const x = (A + F + (Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0) + w[j + g]) | 0, s = S[r * 4 + i % 4];
        A = D; D = C; C = B; B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
      }
      h[0] = (h[0] + A) | 0; h[1] = (h[1] + B) | 0; h[2] = (h[2] + C) | 0; h[3] = (h[3] + D) | 0;
    }
    return hex(new Uint8Array(new Uint32Array(h).buffer));
  }
  const no = what => () => { throw new Error(`小手机没有 ${what}`); };
  const utils = { crypto: { md5, randomBytes: k => Buf.from(crypto.getRandomValues(new Uint8Array(k))), aesEncrypt: no('aes'), rsaEncrypt: no('rsa') }, buffer: { from, bufToString: str }, zlib: { inflate: no('zlib'), deflate: no('zlib') } };
  const request = (url, o, cb) => { const id = ++n; wait.set(id, cb); up({ t: 'req', id, url, o: JSON.parse(JSON.stringify(o || {})) }); return () => wait.delete(id); };
  addEventListener('message', async ({ data: m }) => {
    if (m.t === 'res') { const cb = wait.get(m.id); wait.delete(m.id); if (cb) m.err ? cb(new Error(m.err)) : cb(null, m.r, m.r.body); return; }
    if (m.t === 'load') {
      const head = {}; for (const [, k, v] of (m.code.match(/^\s*\/\*[\s\S]*?\*\//) || [''])[0].matchAll(/@(\w+)\s+(.*)/g)) head[k] = v.trim();
      globalThis.lx = { EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }, version: '2.0.0', env: 'desktop', request, utils,
        currentScriptInfo: { name: head.name || m.name, description: head.description || '', version: head.version || '', author: head.author || '', homepage: head.homepage || '', rawScript: m.code },
        on: (e, fn) => { if (e === 'request') hooks.set(m.name, fn); },
        send: (e, d) => { if (e === 'inited') up({ t: 'inited', name: m.name, src: Object.keys((d && d.sources) || {}) }); } };
      try { new Function(m.code)(); } catch (e) { up({ t: 'inited', name: m.name, src: [], err: e.message }); }
      return;
    }
    if (m.t === 'ask') {
      try {
        const fn = hooks.get(m.name); if (!fn) throw new Error('没注册');
        const u = await fn({ source: m.source, action: 'musicUrl', info: m.info });
        up({ t: 'url', id: m.id, url: typeof u === 'string' ? u : '' });
      } catch (e) { up({ t: 'url', id: m.id, err: String((e && e.message) || e) }); }
    }
  });
}

let box = null, ready = null, seq = 0, via = null, good = '';
const wait = new Map(), loaded = new Map(), got = new Map();
const down = m => box.contentWindow.postMessage(m, '*');
// 头一回要用时才开沙盒框
const boot = () => ready || (ready = new Promise(ok => {
  box = document.createElement('iframe');
  box.setAttribute('sandbox', 'allow-scripts');
  box.hidden = true;
  box.onload = ok;
  box.srcdoc = `<script>(${runtime})()<\/script>`;
  document.body.append(box);
  addEventListener('message', ({ source, data: m }) => {
    if (source !== box.contentWindow) return;
    if (m.t === 'req') relay(m.url, m.o).then(r => down({ t: 'res', id: m.id, r }), e => down({ t: 'res', id: m.id, err: e.message }));
    else { const w = wait.get(m.t === 'inited' ? 'i:' + m.name : m.id); if (w) w(m); }
  });
}));
const once = (k, ms) => new Promise((ok, no) => { const t = setTimeout(() => { wait.delete(k); no(new Error('超时')); }, ms); wait.set(k, m => { clearTimeout(t); wait.delete(k); ok(m); }); });

// Tauri Tavern 没有酒馆插件、也没有代理，这些音源的服务器又大多不让网页直接连：借公共的跨域转发（别人家的服务，可能慢、可能挂）
const RELAYS = [u => 'https://corsproxy.io/?url=' + encodeURIComponent(u), u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)];
/** 替脚本连网：装了酒馆插件让插件连（不受跨域限制，请求头也原样带上）；没装就网页自己连，被拦了换公共转发 */
async function relay(url, o) {
  if (!/^https?:\/\//i.test(url)) throw new Error('只连 http(s)');
  let body = o.body; const headers = { ...(o.headers || {}) };
  if (o.form) { body = new URLSearchParams(o.form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (body && typeof body === 'object') { body = JSON.stringify(body); headers['Content-Type'] = headers['Content-Type'] || 'application/json'; }
  const method = String(o.method || (body ? 'POST' : 'GET')).toUpperCase();
  let r;
  if (via) r = await via({ url, method, headers, body });
  else {
    for (const k of Object.keys(headers)) if (/^(user-agent|referer|cookie|origin|host)$/i.test(k)) delete headers[k];   // 网页不让设这些，留着反而多问一次跨域
    const why = [];
    for (const u of [url, ...RELAYS.map(f => f(url))]) {
      try { const x = await fetch(u, { method, headers, body, signal: AbortSignal.timeout(o.timeout || 15000) }); r = { statusCode: x.status, statusMessage: x.statusText, headers: Object.fromEntries(x.headers), body: await x.text() }; break; }
      catch (e) { why.push(`${new URL(u).host} ${e.name === 'TimeoutError' ? '超时' : '连不上'}`); }
    }
    if (!r) throw new Error(why.join('，'));
  }
  try { r.body = JSON.parse(r.body); } catch { /* 不是 JSON 就给原文 */ }
  return r;
}
/** 下载一个脚本放进沙盒跑，回它能放的平台（['wy', 'tx', …]）；只下一次 */
const load = name => loaded.get(name) || loaded.set(name, (async () => {
  await boot();
  const r = await fetch(CDN(name));
  if (!r.ok) throw new Error(`下载失败 ${r.status}`);
  const code = await r.text(), w = once('i:' + name, 15000);
  down({ t: 'load', name, code });
  const m = await w;
  if (m.err) throw new Error(m.err);
  return m.src;
})().catch(e => { loaded.delete(name); throw e; })).get(name);
async function ask(name, source, info) {
  if (!(await load(name)).includes(source)) throw new Error('不支持这个平台');
  const id = ++seq, w = once(id, 15000);
  down({ t: 'ask', id, name, source, info });
  const m = await w;
  if (m.err || !/^https?:\/\//.test(m.url)) throw new Error(m.err || '没给链接');
  return m.url;
}

/** 问洛雪音源要这首的整首链接：上次给过的那个先问；不行就四个一批一起问，谁先给用谁。问到的记几分钟。都没有回 '' */
export async function lxUrl(s, viaPlugin) {
  const source = s.src === 'qq' ? 'tx' : 'wy', k = source + s.id, c = got.get(k);
  if (c && Date.now() - c.at < 5 * 60e3) return c.url;
  via = viaPlugin || null;
  const info = { type: '320k', musicInfo: { songmid: s.id, strMediaMid: s.id, hash: s.id, name: s.name, singer: s.artist, albumName: '', img: s.pic || '', source, interval: '', types: [{ type: '128k' }, { type: '320k' }], _types: { '128k': {}, '320k': {} }, meta: { songId: s.id, strMediaMid: s.id, picUrl: s.pic || '', albumName: '' } } };
  const why = [], hit = name => ask(name, source, info).then(url => { good = name; got.set(k, { url, at: Date.now() }); return url; }, e => { why.push(`${name}：${e.message}`); throw e; });
  if (good) try { return await hit(good); } catch { /* 换别的 */ }
  const rest = NAMES.filter(n => n !== good);
  for (let i = 0; i < rest.length; i += 4) try { return await Promise.any(rest.slice(i, i + 4).map(hit)); } catch { /* 这批都不行，下一批 */ }
  log('warn', '音乐', `洛雪音源都没给《${s.name}》的链接`, why.join('\n'));
  return '';
}
