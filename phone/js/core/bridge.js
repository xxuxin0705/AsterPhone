// 和酒馆打交道：读角色卡、读正文、往正文里注入、用酒馆当前的 API 生成。
// 手机是装在酒馆页面里的一个 iframe（同源），所以可以直接拿到 parent 的 SillyTavern。
// 不在酒馆里（单独打开预览）时，这些函数都会安全地返回空值。

import { log } from './log.js';

const P = (() => { try { return window.parent !== window ? window.parent : null; } catch (e) { return null; } })();
export function ctx() {
  try { return P && P.SillyTavern && P.SillyTavern.getContext ? P.SillyTavern.getContext() : null; } catch (e) { return null; }
}
export const inTavern = () => !!ctx();

export function userName() { const c = ctx(); return (c && c.name1) || ''; }
export function userPersona() {
  const c = ctx();
  try { return (c && (c.powerUserSettings?.persona_description || P.power_user?.persona_description)) || ''; } catch (e) { return ''; }
}
export function userAvatar() {
  try {
    const img = P.document.querySelector('#user_avatar_block .avatar-container.selected img, #user_avatar_block .avatar.selected img');
    return img ? img.src : '';
  } catch (e) { return ''; }
}

export function avatarUrl(file) {
  const c = ctx(); if (!file) return '';
  try { if (c && c.getThumbnailUrl) return c.getThumbnailUrl('avatar', file); } catch (e) { /* 用下面的 */ }
  return '/thumbnail?type=avatar&file=' + encodeURIComponent(file);
}
export function characters() {
  const c = ctx(); if (!c || !Array.isArray(c.characters)) return [];
  return c.characters.map(ch => ({
    key: ch.avatar, name: ch.name, avatar: avatarUrl(ch.avatar),
    persona: [ch.description, ch.personality && ('性格：' + ch.personality), ch.scenario && ('场景：' + ch.scenario)].filter(Boolean).join('\n'),
  }));
}
export function currentCharacter() {
  const c = ctx(); if (!c || c.characterId == null || !c.characters) return null;
  const ch = c.characters[c.characterId]; return ch ? { key: ch.avatar, name: ch.name } : null;
}

/** 正文最近 n 条，去掉标签 */
export function recentStory(n = 6, maxEach = 240) {
  const c = ctx(); if (!c || !Array.isArray(c.chat)) return '';
  return c.chat.filter(m => !m.is_system && m.mes).slice(-n)
    .map(m => `${m.name}：${stripTags(m.mes).slice(0, maxEach)}`).join('\n');
}
export function stripTags(s) { return String(s || '').replace(/<(astertime|asterphone)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '').trim(); }

/** 用酒馆当前连接生成一段文字 */
export async function generateTavern({ system, prompt, maxTokens = 600 }) {
  const c = ctx();
  if (!c || typeof c.generateRaw !== 'function') throw new Error('没有连上酒馆，用不了「酒馆当前连接」');
  const fn = c.generateRaw;
  const objectStyle = /^\s*(async\s*)?(function\s*\w*\s*)?\(\s*\{/.test(fn.toString());
  let out;
  if (objectStyle) out = await fn({ prompt, systemPrompt: system, responseLength: maxTokens, quietToLoud: false });
  else out = await fn(prompt, '', false, false, system, maxTokens);
  if (typeof out !== 'string') throw new Error('酒馆没有返回文字');
  return out;
}

/** 往正文里注入：position 1 = 聊天记录里（按深度），0 = 人设卡和世界书附近 */
export function setInjection(key, text, { position = 1, depth = 3 } = {}) {
  const c = ctx(); if (!c || typeof c.setExtensionPrompt !== 'function') return false;
  try { c.setExtensionPrompt(key, text || '', position, depth, false, 0); return true; }
  catch (e) { log('warn', '聊天', '注入正文失败', e); return false; }
}

/** 监听酒馆事件 */
export function onTavern(name, fn) {
  const c = ctx(); if (!c || !c.eventSource) return () => {};
  const types = c.eventTypes || c.event_types || {};
  const ev = types[name]; if (!ev) return () => {};
  c.eventSource.on(ev, fn);
  return () => { try { c.eventSource.removeListener(ev, fn); } catch (e) { /* 旧版没有 */ } };
}

/** 把正文里的暗号标签藏起来（只改显示，不改聊天记录） */
export function hideTagsIn(mesId, tagName) {
  try {
    const el = P.document.querySelector(`#chat .mes[mesid="${mesId}"] .mes_text`);
    if (!el) return;
    const re = new RegExp(`(&lt;|<)(${tagName}|asterphone)[\\s\\S]*?(&lt;|<)\\/(${tagName}|asterphone)(&gt;|>)`, 'gi');
    if (re.test(el.innerHTML)) el.innerHTML = el.innerHTML.replace(re, '');
  } catch (e) { /* 忽略 */ }
}
export function chatMessage(mesId) { const c = ctx(); return c && c.chat ? c.chat[mesId] : null; }
export function postToParent(msg) { try { P && P.postMessage(Object.assign({ aster: true }, msg), '*'); } catch (e) { /* 忽略 */ } }
