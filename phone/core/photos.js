// 一个人的照片库：TA 手机相册里的，和 TA 在聊天、动态、论坛、日记里发过的图，放在一起。
// 写动态、论坛、聊天时把清单给 AI 看：先定好发什么，正好有对得上的就用那张（画过的直接拿来，不用再花钱画），没有就照常
import { kvGet, kvSet, kvKeys, state, chatForContact, getMsgs } from './store.js';

const hash = s => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
/** 查手机相册里一张照片的图存在哪（按画面那句话认） */
export const picKey = (id, what) => `peekpic:${id}:${hash(what)}`;

/** c 的照片：{ what 画面, en 英文提示词, url 画好的图, key 图存在 kv 的哪（相册里的、动态里的） }；画过的排前面 */
export async function photosOf(c) {
  const L = [], add = (what, url, en, key = '') => { what = String(what || '').trim(); if (!what || /^#\d/.test(what)) return;
    const o = L.find(x => x.what === what); if (o) { o.url ||= url || ''; o.en ||= en || ''; o.key ||= key; } else L.push({ what, url: url || '', en: en || '', key }); };
  const ch = chatForContact(c.id, false), get = p => Promise.resolve(p).catch(() => null);
  // 论坛、日记用它们自己读好放在内存里的那份（整份帖子很大，别每次都从 kv 再读一遍）
  const [pk, fo, dy, ms, keys] = await Promise.all([get(kvGet('peek:' + c.id)), get(import('../apps/forum/engine.js').then(E => E.load())), get(import('./diary.js').then(D => D.load())), get(ch && getMsgs(ch.id)), get(kvKeys())]);
  const have = new Set(keys || []), gone = new Set(pk?.hide || []);
  for (const r of pk?.apps?.相册?.rows || []) if (r[0] === '图库' && !gone.has('相册:' + r[1]) && !gone.has('相册删:' + r[1])) { const k = picKey(c.id, r[1]); add(r[1], '', /[㐀-鿿]/.test(r[5] || '') ? '' : r[5], k); }
  (ms || []).filter(m => m.type === 'image' && m.from === 'them').forEach(m => add(m.text, m.src, m.en, m.pk));
  state.moments.filter(m => m.author === c.id).forEach(m => add(m.imageDesc, (m.images || [])[0], '', m.pk));
  (fo?.posts || []).filter(p => p.by && p.by.k === 'c' && p.by.id === c.id).forEach(p => add(p.img, p.pic, p.imgEn, p.pk));
  (dy?.pages || []).filter(p => p.who === c.id).forEach(p => add(p.desc, p.pic, p.prompt));
  const drawn = p => !!(p.url || have.has(p.key));
  return L.sort((a, b) => drawn(b) - drawn(a));
}

/** 给 AI 看的清单（每人最多 n 张，编号连着排）：line(id) 是这个人那一段；AI 回「#编号」用 pick 找回那张 */
export async function photoBook(cs, n = 8) {
  const all = [], lines = new Map();
  for (const c of cs.filter(Boolean)) { const L = (await photosOf(c)).slice(0, n); if (L.length) lines.set(c.id, L.map(p => `#${all.push({ ...p, cid: c.id })} ${p.what}`).join('；')); }
  return { line: id => lines.get(id) || '', pick: s => { const m = /^#\s*(\d+)/.exec(String(s || '').trim()); return m ? all[m[1] - 1] || null : null; } };
}
/** 用上的那张：画好的图在哪（相册里的去 kv 拿） */
export const urlOf = async p => p.url || (p.key && await kvGet(p.key).catch(() => '')) || '';
/** 动态只记一把钥匙，图本身存在 kv（不塞进 state，不然每次保存都要写一遍大图）。相册里还没画的也给钥匙：以后在相册里画了，动态跟着有图 */
export async function keyOf(p) {
  if (p.key || !p.url) return p.key || '';
  const k = 'photo:' + p.cid + ':' + hash(p.what); await kvSet(k, p.url); return k;
}
