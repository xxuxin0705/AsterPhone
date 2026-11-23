// 酒馆的正则（扩展 → 正则）：设置 → 正则 里挑几条，手机里 AI 写的字和机翻一拿到就照着换，存下来的就是换过的。
// 只列管「AI 输出」的那几条；查找里的宏不展开。正则本身存在酒馆里，那边改了这边跟着变
import { state } from './store.js';
import { ctx } from './bridge.js';

/** 酒馆里管「AI 输出」的正则：全局的 + 当前角色卡带的（预设带的读不到） */
export function tavernRegex() {
  const c = ctx(); if (!c) return [];
  const card = c.characters?.[c.characterId]?.data?.extensions?.regex_scripts || [];
  return [...(c.extensionSettings?.regex || []).map(s => ({ ...s, from: '全局' })), ...card.map(s => ({ ...s, from: '角色卡' }))]
    .filter(s => s.id && s.findRegex && (s.placement || []).includes(2));
}
// 「/老子/g」这种带斜杠的照正则认，不带的当普通字找
const toRe = s => { const m = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(s); try { return m ? new RegExp(m[1], m[2]) : new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); } catch (e) { return null; } };
/** 一条正则换一段字：替换里的 {{match}}、$1、$<名字> 换成找到的那截，再去掉「修剪掉」里写的字 */
export function runOne(s, text) {
  const re = toRe(s.findRegex); if (!re) return text;
  const trim = x => (s.trimStrings || []).reduce((a, t) => (t ? a.split(t).join('') : a), x);
  return text.replace(re, (...a) => { const g = typeof a.at(-1) === 'object' ? a.at(-1) : null;
    return (s.replaceString || '').replace(/{{match}}/gi, '$0').replace(/\$(\d+)|\$<([^>]+)>/g, (_, n, k) => trim((n ? a[+n] : g?.[k]) || '')); });
}
/** 设置里勾了的那几条，按酒馆里的顺序一条条过 */
export function regexed(text) {
  const on = state.settings.regex;
  if (!on?.length || typeof text !== 'string' || !text) return text;
  return tavernRegex().filter(s => on.includes(s.id)).reduce((t, s) => runOne(s, t), text);
}
