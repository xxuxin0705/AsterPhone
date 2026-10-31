// 免费翻译：不花你的 API。
// 1. 在酒馆里：借酒馆自带翻译插件用的接口（/api/translate/google，由酒馆服务器去问谷歌）
// 2. 不行就直接问谷歌翻译的免费接口
// 3. 再不行就用 MyMemory 免费接口
import { ctx, inTavern } from './bridge.js';
import { log } from './log.js';

export const LANGS = [
  ['zh-CN', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'],
  ['es', '西班牙语'], ['ru', '俄语'], ['it', '意大利语'], ['pt', '葡萄牙语'], ['th', '泰语'], ['vi', '越南语'], ['zh-TW', '繁体中文'],
];
export const langName = code => (LANGS.find(l => l[0] === code) || [code, code])[1];
const cache = new Map();

export async function translate(text, to = 'zh-CN') {
  text = String(text || '').trim();
  if (!text) return '';
  const key = to + '|' + text;
  if (cache.has(key)) return cache.get(key);
  const tries = [viaTavern, viaGoogle, viaMyMemory];
  let lastErr = null;
  for (const fn of tries) {
    try { const out = await fn(text, to); if (out && out.trim()) { cache.set(key, out.trim()); return out.trim(); } }
    catch (e) { lastErr = e; }
  }
  log('warn', '翻译', '翻译失败：' + (lastErr ? lastErr.message : '没有返回'), { to });
  throw new Error('翻译失败，详情见日志');
}

async function viaTavern(text, to) {
  if (!inTavern()) throw new Error('不在酒馆里');
  const c = ctx(), headers = (c && c.getRequestHeaders) ? c.getRequestHeaders() : { 'Content-Type': 'application/json' };
  const res = await window.parent.fetch('/api/translate/google', { method: 'POST', headers, body: JSON.stringify({ text, lang: to }) });
  if (!res.ok) throw new Error('酒馆翻译接口 ' + res.status);
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
