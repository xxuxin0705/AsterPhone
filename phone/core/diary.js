// 日记：角色用自己的口吻写的日记（方案见 docs/pages-diary.md）。
// 谁有本子、封面、什么时候写在 state.diary.books（跟着窗口走）；一篇篇日记带着图，存在 kv 的 diary:窗口 里。
// 日记从两处来：① 正文里的 <asterdiary> 暗号（core/sync.js 读到交给 fromStory，不另外花钱）；② 手动「写一篇」（write）。
import { state, win, kvGet, kvSet, commit, contact, chatForContact, getMsgs } from './store.js';
import { uid, pad } from './util.js';
import { generate, generateImage, resolveConn } from './api.js';
import { compose, myName } from './promptstore.js';
import { personaOf } from '../apps/chat/engine.js';
import { C as ctxCfg, storyText, worldText } from './context.js';
import { memoryFor, floorsText, chatMsgs } from './memory.js';
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
// 色卡：作者挑的（小红书上的配色分享，见 docs/credits.md）。AI 写日记时按剧情挑一个，胶带、蕾丝、邮票框、便签都换成这几个颜色
export const PALETTES = {
  菠萝金桔苏: ['#dae8f2', '#ffcfca', '#ffbd9c', '#ffe3a4'], 香椿煎蛋饼: ['#ffe1a6', '#e4bb9b', '#cce3ed', '#dd997f'], 白蘑奶油汤: ['#a5876b', '#ffe8b0', '#cceae6', '#dfefed'],
  樱花水信玄: ['#ffd2dc', '#d6f2de', '#ffffff', '#d0bcd8'], 青梅酒酿冰: ['#ffeabb', '#e2ef95', '#f2f9cd', '#ccc696'], 豌豆茉莉冻: ['#c9b6d9', '#fff8d4', '#d1e0cc', '#b19bac'],
  杏花糯米糍: ['#ffdce4', '#f0e9de', '#f2bfad', '#f4e3ca'], 莓果马卡龙: ['#fff2b3', '#ffcdcc', '#ffb3c7', '#cc9f92'], 蒲公英拿铁: ['#d7e7f4', '#f7c9d6', '#b0d8bc', '#ffe7b0'],
  蓝莓冰酪: ['#f7f3ff', '#ede4ff', '#d8c8ff', '#b89aff'], 烟芋松露: ['#e4dde2', '#c9bcc8', '#d8ced6', '#a894a6'], 蜜桃乳酸: ['#fff0e8', '#ffe2d5', '#ffd1b8', '#ffb88a'],
  雾杏松糕: ['#e8e2d9', '#d4c8bb', '#e2d8cf', '#b8a99a'], 蒙布朗卷: ['#fbf5ef', '#f2e6d8', '#e6cfb8', '#d4b38a'], 椰奶清补: ['#fffdf7', '#f6f0e8', '#e8dfd5', '#d9cfbe'],
  苔痕奶霜: ['#e2e8e3', '#c4cfc6', '#d4ddd6', '#98a89b'], 雾樱晨露: ['#cfedef', '#dcebcf', '#f5cdd6', '#f6eae3'], 柚芽晴空: ['#d7edbe', '#fff8da', '#d4e7f2', '#f5f1b6'],
  桂雾抹茶: ['#e8e8bf', '#f6f1de', '#c6d7b2', '#96b88b'], 莓霞薄荷: ['#c98b92', '#f7c9d4', '#d6f0ef', '#a2dccf'],
  琉璃淡翠: ['#f0c800', '#c6dfc8', '#f4786e'], 碧青石青: ['#5cb5ce', '#7bcfa6', '#f4acac'], 谷鞘青莲: ['#f4786e', '#6e328e', '#f2506e'],
};
export const paletteNames = () => Object.keys(PALETTES).join('、');
export const bookOf = id => state.diary.books.find(b => b.who === id);
export const pagesOf = id => D.pages.filter(p => p.who === id).sort((a, b) => (a.at + a.hm).localeCompare(b.at + b.hm) || a.ts - b.ts);

/** 一段日记 → 天气、正文、配图的画面、生图提示词 */
export function parse(body) {
  const o = { weather: '', desc: '', prompt: '', pal: '' };
  const take = (re, k) => s => s.replace(re, (_, v) => { o[k] = v.trim(); return ''; });
  const text = [take(/^\s*天气[:：]\s*(.+)$/m, 'weather'), take(/^\s*\[图片(?:\]|[:：])\s*(.+?)\]?\s*$/m, 'desc'), take(/^\s*\[生图(?:\]|[:：])\s*(.+?)\]?\s*$/m, 'prompt'), take(/^\s*配色[:：]\s*(.+)$/m, 'pal')]
    .reduce((s, f) => f(s), String(body)).trim();
  if (!PALETTES[o.pal]) o.pal = Object.keys(PALETTES).find(k => o.pal.includes(k)) || '';
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

/** 手动写一篇：挑了念念铃里的事就写那几件；挑了楼层就写那几层正文；都没挑就按最近的正文和手机聊天写。photos：自己放的照片（放了就不生图） */
export async function write(c, { events = [], floors = null, photos = [] }, stop) {
  const name = c.name || c.nick || c.remark, story = storyText() || '（暂无）';
  let about;
  if (floors) about = '【这篇写这几层正文里的事】\n' + floorsText(chatMsgs(), { from: floors[0], to: floors[1] }).join('\n\n').slice(-12000);
  else if (events.length) about = '【这篇写这几件事】\n' + events.map(e => `${e.at || ''} ${e.part || ''} ${e.place || ''}：${e.title}。${e.text}${e.quote ? `（原话：${e.quote}）` : ''}`).join('\n');
  else {
    const chat = chatForContact(c.id, false), msgs = chat ? (await getMsgs(chat.id)).filter(m => !m.recalled && m.text).slice(-20) : [];
    about = `【最近的事】\n${story}` + (msgs.length ? `\n\n【手机里最近的聊天】\n${msgs.map(m => `${m.from === 'me' ? myName() : m.from === 'them' ? name : ''}：${m.text}`).join('\n')}` : '');
  }
  const scan = floors || events.length ? about : story;
  const w = await worldText(scan).catch(() => ''), mem = await memoryFor([c], scan).catch(() => '');
  const raw = await generate({ conn: resolveConn('text', 'diary'), system: '', app: '日记', maxTokens: 900, stop,
    prompt: compose('diaryWrite', { palettes: paletteNames(), char: name, persona: (ctxCfg().charPersona && personaOf(c)) || '（没有更多资料）', world: (w ? `\n【世界书】\n${w}\n` : '') + mem, about, time: time.forPrompt() }) });
  const body = String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
  if (!body) throw new Error('AI 回了空的');
  const d = await load(), p = Object.assign(page(c.id, 'hand', body), photos.length ? { pic: photos[0], more: photos.slice(1) } : {});
  d.pages.push(p); await save();
  return p;
}

/** 给一篇配图：用它的生图提示词（没有就用画面描述） */
export async function draw(p, stop) {
  const src = await generateImage(p.prompt || p.desc || p.text.slice(0, 80), '日记', resolveConn('image', 'diary'), stop);
  p.pic = src; await save();
}
