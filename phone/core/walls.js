// 壁纸库：自带「水中月」+ 自己加的图片和 Live 图。
// 锁屏和桌面各有各的一排（row），加、删、调整都只管自己那排；也可以「随机」：每次锁屏 / 每次打开手机换一张。
// 图片和视频本体存在 IndexedDB（键 wall:<blob 或 id>），state 里只记名字和类型。
import { state, commit, kvGet, kvSet, kvDel } from './store.js';
import { uid } from './util.js';
import { WALLPAPERS } from './wallpaper.js';

export const BUILTIN = Object.keys(WALLPAPERS);
export const W = () => state.settings.walls;
export const isBuiltin = id => BUILTIN.includes(id);
export const ids = which => [...BUILTIN, ...W().list.filter(x => x.row === which).map(x => x.id)];
export const info = id => isBuiltin(id) ? { id, name: WALLPAPERS[id].name, type: 'builtin' } : W().list.find(x => x.id === id);
const exists = id => !!info(id);

/* ---------- 现在锁屏 / 桌面用的是哪张 ---------- */
// 随机模式下「这一次抽到的」只记在内存里；没开随机就用设置里选的
const drawn = { lock: null, home: null };
export function current(which) {
  const w = W();
  if (w[which + 'Random']) { if (!drawn[which] || !exists(drawn[which])) reroll(which); return drawn[which]; }
  return exists(w[which]) ? w[which] : 'water';
}
/** 随机换一张（尽量别和上一张一样） */
export function reroll(which) {
  const all = ids(which), prev = drawn[which];
  const pool = all.length > 1 ? all.filter(i => i !== prev) : all;
  drawn[which] = pool[Math.floor(Math.random() * pool.length)] || 'water';
  return drawn[which];
}

/* ---------- 读图 ---------- */
const urls = new Map();     // 存储键 → { img, video }（object URL，读一次就缓存）
const blobKey = id => (info(id) || {}).blob || id;   // 以前锁屏、桌面共用一张图，拆开后两条指向同一份文件
async function blobs(id) {
  const k = blobKey(id);
  if (urls.has(k)) return urls.get(k);
  const rec = await kvGet('wall:' + k).catch(() => null);
  if (!rec) return null;
  const u = { img: rec.img ? URL.createObjectURL(rec.img) : '', video: rec.video ? URL.createObjectURL(rec.video) : '' };
  urls.set(k, u); return u;
}
/** 缩略图地址（自带的跟着日夜换） */
export async function thumb(id, night) {
  if (isBuiltin(id)) return 'assets/wallpapers/' + (night ? WALLPAPERS[id].night : WALLPAPERS[id].day);
  const b = await blobs(id); if (!b) return '';
  const c = (info(id) || {}).crop; if (!c || !b.img) return b.img;
  // 调过的图：缩略图直接切出框住的那块（框超出图片的地方是黑的）
  const img = await loadImg(b.img), cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.width = 240; cv.height = Math.round(240 * c[3] * img.naturalHeight / (c[2] * img.naturalWidth));
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, -c[0] / c[2] * cv.width, -c[1] / c[3] * cv.height, cv.width / c[2], cv.height / c[3]);
  return new Promise(r => cv.toBlob(x => r(x ? URL.createObjectURL(x) : b.img), 'image/jpeg', .85));
}
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
function loadVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, preload: 'auto', loop: false, crossOrigin: 'anonymous' });
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.onloadeddata = () => res(v); v.onerror = () => rej(new Error('视频读不了'));
    v.src = src; v.load();
  });
}
/** 给壁纸层用的：自带的直接给名字；自己的给 { img, video, aspect } */
export async function source(id) {
  if (isBuiltin(id)) return id;
  const b = await blobs(id); if (!b) return 'water';
  const img = await loadImg(b.img).catch(() => null);
  const video = b.video ? await loadVideo(b.video).catch(() => null) : null;
  if (!img && !video) return 'water';
  const w = img ? img.naturalWidth : video.videoWidth, h = img ? img.naturalHeight : video.videoHeight;
  const crop = (info(id) || {}).crop || [0, 0, 1, 1];   // 自己调过位置：只显示框住的那一块
  return { id, img, video, crop, aspect: w && h ? (w * crop[2]) / (h * crop[3]) : 9 / 19.5 };
}

/* ---------- 添加 / 删除 ---------- */
/** 从视频里截一帧当封面 */
function posterOf(file) {
  return new Promise(async res => {
    try {
      const v = await loadVideo(URL.createObjectURL(file));
      const go = () => {
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0); c.toBlob(b => { URL.revokeObjectURL(v.src); res(b); }, 'image/jpeg', .9);
      };
      if (v.duration > .2) { v.currentTime = Math.min(.1, v.duration / 2); v.onseeked = go; } else go();
    } catch (e) { res(null); }
  });
}
/**
 * 加一批文件：图片 → 普通壁纸；视频 → Live 图（自动截第一帧当封面）。
 * 同一次选了「一张图 + 一个视频」→ 合成一张 Live 图，图片当封面（苹果 Live 图导出来就是这样一对）。
 */
/** 小米 / 谷歌的「动态照片」是一张 jpg 后面接着一段 mp4：找到 mp4 开头（ftyp）就切出来当 Live 图 */
async function motionVideo(file) {
  if (!/jpe?g/i.test(file.type || file.name)) return null;
  const buf = new Uint8Array(await file.arrayBuffer());
  for (let i = 1024; i < buf.length - 12; i++) {
    if (buf[i] === 0x66 && buf[i + 1] === 0x74 && buf[i + 2] === 0x79 && buf[i + 3] === 0x70) {
      const size = (buf[i - 4] << 24) | (buf[i - 3] << 16) | (buf[i - 2] << 8) | buf[i - 1];
      if (size >= 8 && size <= 64) return new Blob([buf.subarray(i - 4)], { type: 'video/mp4' });
    }
  }
  return null;
}
export async function addFiles(files, which) {
  files = [...files].filter(f => /^(image|video)\//.test(f.type) || /\.(mov|mp4|webm|m4v|heic|jpe?g|png|webp|gif)$/i.test(f.name));
  const imgs = files.filter(f => !/^video\//.test(f.type) && !/\.(mov|mp4|webm|m4v)$/i.test(f.name));
  const vids = files.filter(f => !imgs.includes(f));
  const pairs = [];
  if (imgs.length === 1 && vids.length === 1) pairs.push({ img: imgs[0], video: vids[0] });
  else {
    for (const f of imgs) pairs.push({ img: f, video: await motionVideo(f).catch(() => null) });
    vids.forEach(f => pairs.push({ video: f }));
  }
  const added = [];
  for (const p of pairs) {
    if (p.video && p.video.size > 80 * 1024 * 1024) throw new Error(`「${p.video.name}」太大了（超过 80MB），剪短一点再试`);
    const img = p.img || await posterOf(p.video);
    if (!img && !p.video) continue;
    const id = uid('w_'), name = ((p.img || p.video).name || '').replace(/\.[^.]+$/, '').slice(0, 20) || (p.video ? 'Live 图' : '图片');
    await kvSet('wall:' + id, { img, video: p.video || null });
    W().list.push({ id, name, type: p.video ? 'live' : 'image', at: Date.now(), row: which });
    added.push(id);
  }
  if (added.length) commit('walls');
  return added;
}
export async function remove(id) {
  if (isBuiltin(id)) return;
  const w = W(), k = blobKey(id);
  w.list = w.list.filter(x => x.id !== id);
  if (w.lock === id) w.lock = 'water';
  if (w.home === id) w.home = 'water';
  for (const r of ['lock', 'home']) if (drawn[r] === id) drawn[r] = null;
  // 另一排还在用同一份文件就留着
  if (!w.list.some(x => blobKey(x.id) === k)) {
    const u = urls.get(k); if (u) { u.img && URL.revokeObjectURL(u.img); u.video && URL.revokeObjectURL(u.video); urls.delete(k); }
    await kvDel('wall:' + k).catch(() => {});
  }
  commit('walls');
}
/** 旧版锁屏、桌面共用一个列表：每张拆成锁屏一条、桌面一条（共用文件），以后各管各的 */
export function splitRows() {
  const w = W(); if (w.list.every(x => x.row)) return;
  for (const x of w.list.filter(x => !x.row)) {
    const copy = { ...x, id: uid('w_'), blob: x.id, row: 'home' };
    x.row = 'lock'; w.list.push(copy);
    if (w.home === x.id) w.home = copy.id;
  }
  commit('walls');
}
export function setCrop(id, crop) { const x = info(id); if (x && !isBuiltin(id)) { x.crop = crop; commit('walls'); } }
export function rename(id, name) { const x = info(id); if (x && !isBuiltin(id)) { x.name = String(name).slice(0, 20); commit('walls'); } }
