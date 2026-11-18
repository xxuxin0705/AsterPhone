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

// 排版用的 HTML 标签（加粗、换行…）不算「标签」：永远只去掉记号、留下里面的字
const FORMAT = new Set('b i u s em strong br p span div small big font del ins sub sup code pre blockquote a img hr ul ol li h1 h2 h3 h4 h5 h6 center q mark ruby rt table thead tbody tfoot tr td th caption col colgroup title marquee button label details summary section article header footer nav aside main figure figcaption'.split(' '));
const tagsIn = text => [...String(text).matchAll(/<([\p{L}_][\p{L}\p{N}_:-]*)[\s>]/gu)].map(m => m[1].toLowerCase()).filter(t => !FORMAT.has(t));   // 中文标签（<草稿>）也算
/** 最近正文里出现过的标签和次数（<!-- --> 记作「!--」）。多扫一些，免得漏掉 */
export function detectTags(list = rawStory(30)) {
  const count = {};
  for (const m of list) {
    for (const k of tagsIn(m.text.replace(block('!--'), ''))) count[k] = (count[k] || 0) + 1;   // 注释里写到的 <xxx> 不算标签
    const nc = (m.text.match(/<!--/g) || []).length; if (nc) count['!--'] = (count['!--'] || 0) + nc;
  }
  delete count[(state.timeTagName || 'astertime').toLowerCase()]; delete count.astertime; delete count.asterphone;
  return count;
}

const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const block = t => t === '!--' ? /<!--[\s\S]*?-->/g : new RegExp(`<${esc(t)}(?=[\\s>])[^>]*>[\\s\\S]*?<\\/${esc(t)}>`, 'giu');
/** 「给手机看」的标签里面还套着哪些标签、各几次（「不给手机看」只用从这些里挑） */
export function tagsInside(keep = keepNow(), list = rawStory(30)) {
  const count = {};
  for (const m of list) for (const k of keep) for (const b of (k === '!--' ? [] : m.text.match(block(k)) || [])) {
    for (const t of tagsIn(b.replace(block('!--'), '').slice(1))) if (t !== k) count[t] = (count[t] || 0) + 1;
    const nc = (b.match(/<!--/g) || []).length; if (nc && !keep.includes('!--')) count['!--'] = (count['!--'] || 0) + nc;
  }
  return count;
}

/** 在「给手机看」的标签外面的标签、各几次（「给手机看」下面只列这些：里面的已经给了） */
export const tagsOutside = (keep = keepNow(), list = rawStory(30)) => detectTags(list.map(m => ({ text: keep.reduce((t, k) => t.replace(block(k), ''), m.text) })));

/** 现在真正给手机看的标签：「给手机看」里没被暂时关掉的 */
export const keepNow = () => C().keep.filter(t => !(C().keepOff || []).includes(t));
/** 按设置清洗一条正文（注释 <!-- --> 当成一个叫「!--」的标签，规矩一样）：「给手机看」的标签整段留着（去掉记号留下字，里面套着的别的标签也留着），「不给手机看」的在哪都连内容去掉；
 *  不在「给手机看」里面的没分类标签也连内容去掉；没被标签包着的字照常留着。
 *  keep：要留哪些标签，不给就按「给手机看」（岁岁砂整理时自己挑） */
export function cleanText(text, keep = keepNow(), drop = C().drop || []) {
  const tt = (state.timeTagName || 'astertime').replace(/[^\w-]/g, '');
  let t = String(text).replace(new RegExp(`<(astertime|asterphone|astermem|asterdiary|${tt})[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi'), '');
  for (const tag of drop) if (!keep.includes(tag)) t = t.replace(block(tag), '');
  // 「给手机看」的整段原样留着；它们之间、外面的那几截各自去掉没分类的标签。
  // 分开洗：外面有个标签没合上、到后面才合上时，不会把中间「给手机看」的那段一起带走
  const out = s => { s = s.replace(block('!--'), ''); for (const tag of new Set(tagsIn(s))) s = s.replace(block(tag), ''); return s; };   // 注释（<!-- -->）和别的标签一个规矩
  const ks = keep.filter(k => k !== '!--').map(esc);
  if (keep.length) { let r = '', at = 0; for (const m of t.matchAll(new RegExp(`<(${ks.join('|') || '\\0'})(?=[\\s>])[^>]*>[\\s\\S]*?<\\/\\1>${keep.includes('!--') ? '|<!--[\\s\\S]*?-->' : ''}`, 'giu'))) { r += out(t.slice(at, m.index)) + m[0]; at = m.index + m[0].length; } t = r + out(t.slice(at)); }
  else t = out(t);
  return t.replace(/<!--|-->/g, '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
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
/** 每个人自己的世界书：wb.all 是所有应用用的一套，wb.apps[app] 是某个 App 单独用的一套（有就只用它）。
 *  一套 = { tavern 带上酒馆开着的书, books: { 书名: { off 整本不用, e: { uid: { off 这条用不用, text 改过的内容 } } } } }
 *  改条目只改这里，酒馆里的书不动。旧存档的 books / appBooks（'on' / 'off'）第一次读到时换过来 */
export function wbOf(c) {
  if (!c.wb && (c.books || c.appBooks)) {
    const conv = m => Object.fromEntries(Object.entries(m || {}).map(([n, v]) => [n, v === 'off' ? { off: true } : {}]));
    const all = { tavern: true, books: conv(c.books) };
    c.wb = { all, apps: Object.fromEntries(Object.entries(c.appBooks || {}).filter(([, m]) => Object.keys(m).length).map(([a, m]) => [a, { tavern: true, books: { ...all.books, ...conv(m) } }])) };
    delete c.books; delete c.appBooks;
  }
  return c.wb;
}
export const wbSet = (c, app) => { const W = c && wbOf(c); return W && ((app && W.apps && W.apps[app]) || W.all) || null; };
/** 这个人的这本书里，这条用不用：自己拨过就照拨的，没拨过就照酒馆（关着的不用）；用的话常驻的一直发，其余的看关键词 */
export function ownEntryOn(b, e, scan) {
  const o = b.e && b.e[e.uid];
  if (o ? o.off : e.disable) return false;
  return e.constant || e.keys.some(k => k && scan.toLowerCase().includes(String(k).toLowerCase()));
}
/** people：这次写到的人，TA 在映像里有自己的一套就照 TA 的（整本关了的不发，改过的条目发改过的）；app：在哪个 App 里 */
export async function worldText(scan = '', people = [], app = '') {
  const sets = people.map(p => wbSet(p, app)).filter(Boolean), open = tavernBooks();
  const mine = n => sets.map(s => s.books[n] || (s.tavern && open.includes(n) ? {} : null)).filter(Boolean);
  const names = new Set([...open, ...Object.keys(C().books)].filter(bookOn));
  sets.forEach(s => { Object.keys(s.books).forEach(n => names.add(n)); if (s.tavern) open.forEach(n => names.add(n)); });
  const parts = [];
  for (const n of names) {
    let list = [];
    try { list = await loadBook(n); } catch (e) { continue; }
    const own = mine(n), b = own.find(x => !x.off);
    if (own.length && !b) continue;
    list.filter(e => (b ? ownEntryOn(b, e, scan) : entryOn(n, e, scan))).sort((a, x) => (a.order || 0) - (x.order || 0))
      .forEach(e => parts.push(String((b && b.e && b.e[e.uid] && b.e[e.uid].text) ?? e.content).trim()));
  }
  return parts.filter(Boolean).join('\n\n');
}
