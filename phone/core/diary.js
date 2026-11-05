// 日记：角色用自己的口吻写的日记（方案见 docs/pages-diary.md）。
// 谁有本子、封面、什么时候写在 state.diary.books（跟着窗口走）；一篇篇日记带着图，存在 kv 的 diary:窗口 里。
// 日记从两处来：① 正文里的 <asterdiary> 暗号（core/sync.js 读到交给 fromStory，不另外花钱）；② 手动「写一篇」（write）。
import { state, win, kvGet, kvSet, commit, contact, chatForContact, getMsgs } from './store.js';
import { uid, pad } from './util.js';
import { generate, generateImage, resolveConn } from './api.js';
import { compose, myName } from './promptstore.js';
import { personaOf } from '../apps/chat/engine.js';
import { C as ctxCfg, storyText, worldText } from './context.js';
import { memoryFor } from './memory.js';
import * as time from './time.js';

let D = null, Dkey = null;
export let ver = 0;   // 改过一次加一：页面返回时看它变没变，没变就不重画
export async function load() {
  if (D && Dkey === win.key) return D;
  const k = win.key, d = await kvGet('diary:' + k);
  if (k !== win.key) return load();
  D = Object.assign({ pages: [] }, d); Dkey = k; ver++;
  return D;
}
export const save = async () => { ver++; await kvSet('diary:' + Dkey, D); commit('diary'); };
export const bookOf = id => state.diary.books.find(b => b.who === id);
export const pagesOf = id => D.pages.filter(p => p.who === id).sort((a, b) => (a.at + a.hm).localeCompare(b.at + b.hm) || a.ts - b.ts);

/** 一段日记 → 天气、正文、配图的画面、生图提示词 */
export function parse(body) {
  const o = { weather: '', desc: '', prompt: '' };
  const take = (re, k) => s => s.replace(re, (_, v) => { o[k] = v.trim(); return ''; });
  const text = [take(/^\s*天气[:：]\s*(.+)$/m, 'weather'), take(/^\s*\[图片(?:\]|[:：])\s*(.+?)\]?\s*$/m, 'desc'), take(/^\s*\[生图(?:\]|[:：])\s*(.+?)\]?\s*$/m, 'prompt')]
    .reduce((s, f) => f(s), String(body)).trim();
  return { ...o, text };
}
const nowAt = () => { const s = time.isStory() ? time.story() : null, d = s ? s.date : new Date();
  return { at: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hm: s ? `${pad(s.hh)}:${pad(s.mm)}` : `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const page = (who, src, raw) => ({ id: uid('dy'), who, src, raw, ...parse(raw), ...nowAt(), pic: '', ts: Date.now() });

/** 正文第 floor 层里的 <asterdiary>：[[名字, 内容]…]。没变就不动；换了 swipe、改了内容就换成新的（没变的那篇连图一起留着） */
export async function fromStory(floor, found) {
  const d = await load(), src = 'story:' + floor, old = d.pages.filter(p => p.src === src);
  const byName = n => state.contacts.find(c => [c.name, c.nick, c.remark].includes(n));
  const next = found.map(([n, raw]) => { const c = byName(n); if (!c || !bookOf(c.id)) return null;
    return old.find(p => p.who === c.id && p.raw === raw) || page(c.id, src, raw); }).filter(Boolean);
  if (old.length === next.length && old.every(p => next.includes(p))) return;
  d.pages = d.pages.filter(p => p.src !== src).concat(next);
  await save();
}

/** 手动写一篇：挑了念念铃里的事就写那几件，没挑就按最近的正文和手机聊天写 */
export async function write(c, events, stop) {
  const name = c.name || c.nick || c.remark, story = storyText() || '（暂无）';
  let about;
  if (events.length) about = '【这篇写这几件事】\n' + events.map(e => `${e.at || ''} ${e.part || ''} ${e.place || ''}：${e.title}。${e.text}${e.quote ? `（原话：${e.quote}）` : ''}`).join('\n');
  else {
    const chat = chatForContact(c.id, false), msgs = chat ? (await getMsgs(chat.id)).filter(m => !m.recalled && m.text).slice(-20) : [];
    about = `【最近的事】\n${story}` + (msgs.length ? `\n\n【手机里最近的聊天】\n${msgs.map(m => `${m.from === 'me' ? myName() : m.from === 'them' ? name : ''}：${m.text}`).join('\n')}` : '');
  }
  const scan = events.length ? about : story;
  const w = await worldText(scan).catch(() => ''), mem = await memoryFor([c], scan).catch(() => '');
  const raw = await generate({ conn: resolveConn('text', 'diary'), system: '', app: '日记', maxTokens: 900, stop,
    prompt: compose('diaryWrite', { char: name, persona: (ctxCfg().charPersona && personaOf(c)) || '（没有更多资料）', world: (w ? `\n【世界书】\n${w}\n` : '') + mem, about, time: time.forPrompt() }) });
  const body = String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  if (!body) throw new Error('AI 回了空的');
  const d = await load(), p = page(c.id, 'hand', body);
  d.pages.push(p); await save();
  return p;
}

/** 给一篇配图：用它的生图提示词（没有就用画面描述） */
export async function draw(p, stop) {
  const src = await generateImage(p.prompt || p.desc || p.text.slice(0, 80), '日记', resolveConn('image', 'diary'), stop);
  p.pic = src; await save();
}
