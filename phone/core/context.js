// 发给手机 AI 的「正文上下文」和「世界书」：读几条正文、带不带你发的话、哪些标签要 / 不要、世界书怎么触发。
// 设置在 state.settings.ctx，界面在「设置 → 上下文与世界书」。
import { state } from './store.js';
import { ctx, worldEntries } from './bridge.js';

export const C = () => state.settings.ctx;

/** 最近 n 条正文的原文（标签都还在），给标签识别和预览用 */
export function rawStory(n = C().count) {
  const c = ctx(); if (!c || !Array.isArray(c.chat)) return [];
  return c.chat.filter(m => !m.is_system && m.mes && (C().withUser || !m.is_user)).slice(-n).map(m => ({ name: m.name, text: String(m.mes) }));
}

/** 这几条正文里出现过的标签和次数（<!-- --> 记作「!--」） */
export function detectTags(list = rawStory()) {
  const count = {};
  for (const m of list) {
    for (const [, t] of m.text.matchAll(/<([a-zA-Z][\w:-]*)[\s>]/g)) { const k = t.toLowerCase(); count[k] = (count[k] || 0) + 1; }
    const nc = (m.text.match(/<!--/g) || []).length; if (nc) count['!--'] = (count['!--'] || 0) + nc;
  }
  delete count.astertime; delete count.asterphone;
  return count;
}

const block = t => t === '!--' ? /<!--[\s\S]*?-->/g : new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}>`, 'gi');
/** 按设置清洗一条正文：去掉「不要」的标签；有「要」的标签就只留它们里面的内容，再去掉里面「不要」的 */
export function cleanText(text) {
  const s = C();
  let t = String(text).replace(/<(astertime|asterphone)[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const tag of s.drop) t = t.replace(block(tag), '');
  const kept = s.keep.flatMap(tag => [...t.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map(m => m[1]));
  if (kept.length) t = kept.join('\n');
  for (const tag of s.inner) t = t.replace(block(tag), '');
  return t.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 发给模型的正文：每条「名字：内容」 */
export function storyText(n = C().count) {
  return rawStory(n).map(m => `${m.name}：${cleanText(m.text)}`).filter(l => !/：$/.test(l)).join('\n');
}

/* ---------- 世界书 ---------- */
/** 酒馆现在开着的世界书：全局选中的 + 当前角色绑定的 + 当前聊天绑定的 */
export function tavernBooks() {
  const c = ctx(), out = new Set();
  try { window.parent.document.querySelectorAll('#world_info option:checked').forEach(o => o.textContent.trim() && out.add(o.textContent.trim())); } catch (e) { /* 不在酒馆里 */ }
  const ch = c && c.characters && c.characters[c.characterId];
  if (ch && ch.data && ch.data.extensions && ch.data.extensions.world) out.add(ch.data.extensions.world);
  if (c && c.chatMetadata && c.chatMetadata.world_info) out.add(c.chatMetadata.world_info);
  return [...out];
}
/** 这本书发不发：自己勾过就按勾的，没勾过就看酒馆有没有开 */
export function bookOn(name) {
  const b = C().books[name];
  return b ? b === 'on' : C().followTavern && tavernBooks().includes(name);
}
const cache = new Map();   // 书名 → { at, entries }
export async function loadBook(name, force) {
  const hit = cache.get(name);
  if (hit && !force && Date.now() - hit.at < 60000) return hit.entries;
  const entries = await worldEntries(name);
  cache.set(name, { at: Date.now(), entries });
  return entries;
}
/** 条目发不发：自己勾过就按勾的；没勾过就和酒馆一样——常驻的一直发，其余的在扫描文字里出现关键词才发 */
export function entryOn(book, e, scan) {
  const own = (C().entries[book] || {})[e.uid];
  if (own != null) return own;
  if (e.disable) return false;
  if (e.constant) return true;
  const low = scan.toLowerCase();
  return e.keys.some(k => k && low.includes(String(k).toLowerCase()));
}
/** 要发的世界书条目，拼成一段文字。scan = 用来找关键词的文字（正文 + 手机聊天） */
export async function worldText(scan = '') {
  const names = [...new Set([...tavernBooks(), ...Object.keys(C().books)])].filter(bookOn);
  const parts = [];
  for (const n of names) {
    let list = [];
    try { list = await loadBook(n); } catch (e) { continue; }
    list.filter(e => entryOn(n, e, scan)).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(e => parts.push(e.content.trim()));
  }
  return parts.filter(Boolean).join('\n\n');
}
