// 免费翻译：不花你的 API。
// 1. 在酒馆里：借酒馆自带翻译插件用的接口（/api/translate/google，由酒馆服务器去问谷歌）
// 2. 不行就直接问谷歌翻译的免费接口
// 3. 再不行就用 MyMemory 免费接口
import { ctx, inTavern } from './bridge.js';
import { log } from './log.js';
import { state, commit, nickIn, setNick, chatForContact } from './store.js';
import { waiting, toast } from './ui.js';

export const LANGS = [
  ['zh-CN', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'],
  ['es', '西班牙语'], ['ru', '俄语'], ['it', '意大利语'], ['pt', '葡萄牙语'], ['th', '泰语'], ['vi', '越南语'], ['zh-TW', '繁体中文'],
];
export const langName = code => (LANGS.find(l => l[0] === code) || [code, code])[1];
/** 说什么语言：某个人自己选的（own）> 这个 App 选的 > 设置里总的 */
export const langFor = (app, own) => own || state.settings.lang.apps[app] || state.settings.lang.all;
const cache = new Map();
// Tauri Tavern 的翻译接口一出错就弹「后端错误」挡在屏幕上：那边先走直连的两条，它放最后
const TAURI = (() => { try { return !!(top.__TAURI__ || top.__TAURI_INTERNALS__); } catch (e) { return false; } })();

export async function translate(text, to = 'zh-CN') {
  text = String(text || '').trim();
  if (!text) return '';
  const key = to + '|' + text;
  if (cache.has(key)) return cache.get(key);
  const tries = TAURI ? [viaGoogle, viaMyMemory, viaTavern] : [viaTavern, viaGoogle, viaMyMemory];
  let lastErr = null;
  for (const fn of tries) {
    try { const out = await fn(text, to); if (out && out.trim()) { cache.set(key, out.trim()); return out.trim(); } }
    catch (e) { lastErr = e; }
  }
  log('warn', '翻译', '翻译失败：' + (lastErr ? lastErr.message : '没有返回'), { to });
  throw new Error('翻译失败，详情见日志');
}

// 酒馆的翻译接口一出错（谷歌嫌请求太多会回一张错误页），酒馆就弹一个「后端错误」：失败一次就 10 分钟内先不走它，直接走后面两条
let tavernOff = 0;
async function viaTavern(text, to) {
  if (!inTavern() || Date.now() < tavernOff) throw new Error('不在酒馆里');
  const c = ctx(), headers = (c && c.getRequestHeaders) ? c.getRequestHeaders() : { 'Content-Type': 'application/json' };
  const res = await window.parent.fetch('/api/translate/google', { method: 'POST', headers, body: JSON.stringify({ text, lang: to }) });
  if (!res.ok) { tavernOff = Date.now() + 6e5; throw new Error('酒馆翻译接口 ' + res.status); }
  return await res.text();
}
async function viaGoogle(text, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('谷歌 ' + res.status);
  const j = await res.json();
  return (j[0] || []).map(x => x[0]).join('');
}
async function viaMyMemory(text, to) {
  const from = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : /[\u3040-\u30ff]/.test(text) ? 'ja' : /[\uac00-\ud7af]/.test(text) ? 'ko' : 'en';
  if (from === to) return text;
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${from}|${encodeURIComponent(to)}`);
  if (!res.ok) throw new Error('MyMemory ' + res.status);
  const j = await res.json();
  return j.responseData && j.responseData.translatedText;
}

/* 网名：中文那版按人设起，一直不变（c.nickCn，没记过就把现在显示的翻成中文当它）；外语那版只是氛围，从中文机翻。
   lang 是中文就显示中文那版。勾着「网名跟着语言」的 App 换语言时都走这里，不找 AI */
export const NICK_APPS = ['chat', 'forum', 'music'];
export async function nickShow(c, app, lang, sig) {
  const cn = c.nickCn?.[app] || await translate(nickIn(c, app), 'zh-CN');
  if (!cn) return '';
  (c.nickCn ||= {})[app] = cn;
  const v = /^zh/.test(lang) ? cn : await translate(cn, lang);
  if (sig?.aborted) return '';   // 点了取消就不改
  setNick(c, app, v); commit('contacts'); return v;
}
/** 换了说的语言：勾着的 App 网名一起换 */
export function relang(...cs) {   // 映像、聊天设置里改语言都走这里；设置里改总的语言，跟着总的那些人一起换
  const jobs = cs.flatMap(c => { const lang = langFor('chat', chatForContact(c.id, false)?.cfg.speak); return NICK_APPS.filter(k => !(c.zhNick || []).includes(k) && nickIn(c, k)).map(k => [c, k, lang]); });
  if (jobs.length) waiting('网名换语言…', sig => Promise.all(jobs.map(([c, k, l]) => nickShow(c, k, l, sig)))).then(v => v && toast('网名换好了'), err => toast('网名' + err.message));
}
