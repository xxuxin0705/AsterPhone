// 聊天的「发动机」：发消息、让 TA 回复、重新生成、收到剧情里的消息。
// 页面只管显示，真正改数据的都在这里；改完会通知页面刷新。
import { uid, sleep } from '../../core/util.js';
import { state, commit, contact, chatOf, chatForContact, getMsgs, saveMsgs } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { characters, recentStory, stripTags } from '../../core/bridge.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { render, globalSystem, myName, myPersona, getPrompt } from '../../core/promptstore.js';

/* ---------- 小广播：页面订阅 ---------- */
const subs = new Map();
export function on(evt, fn) { if (!subs.has(evt)) subs.set(evt, new Set()); subs.get(evt).add(fn); return () => subs.get(evt).delete(fn); }
function emit(evt, ...a) { (subs.get(evt) || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); }

export const busy = new Set();
export function startEngine() { /* 主动消息、离开期间补发：下一轮接在这里 */ }

/* ---------- 名字 / 头像 / 人设 ---------- */
export const nameOf = c => (c && (c.remark || c.nick || c.name)) || '联系人';
export function personaOf(c) {
  if (!c) return '';
  if (c.persona) return c.persona;
  if (c.charKey) { const ch = characters().find(k => k.key === c.charKey); if (ch) return ch.persona; }
  return '';
}
export function avatarOf(c, chat) { return (chat && chat.cfg.theirAvatar) || (c && c.avatar) || ''; }
export function myAvatarIn(chat) { return (chat && chat.cfg.myAvatar) || state.me.avatar || ''; }

/** 一条消息在列表、通知里显示成什么 */
export function preview(m) {
  if (!m) return '';
  if (m.recalled) return m.from === 'me' ? '你撤回了一条消息' : '对方撤回了一条消息';
  if (m.type === 'poke') return m.text;
  if (m.type === 'image') return '[图片]';
  return m.text || '';
}
function touch(chat, m) {
  chat.lastAt = m.at; chat.lastSt = m.st; chat.lastText = preview(m); chat.lastFrom = m.from;
}

/* ---------- 发消息（不会自动回复） ---------- */
export async function send(chat, text, extra = {}) {
  const msgs = await getMsgs(chat.id);
  const m = { id: uid('m'), from: 'me', type: 'text', text, ...time.stamp(), ...extra };
  msgs.push(m); touch(chat, m);
  saveMsgs(chat.id); commit('chats');
  emit('msg', chat.id, m);
  return m;
}
export async function addSystem(chat, text, extra = {}) {
  const msgs = await getMsgs(chat.id);
  const m = { id: uid('m'), from: 'sys', type: 'poke', text, ...time.stamp(), ...extra };
  msgs.push(m); touch(chat, m); saveMsgs(chat.id); commit('chats'); emit('msg', chat.id, m);
  return m;
}
/** 还没被回复的我的消息条数 */
export function pending(msgs) {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.from === 'them') break; if (m.from === 'me' && !m.recalled) n++; }
  return n;
}

/* ---------- 让 TA 回复 ---------- */
function historyText(msgs, c, n = 24) {
  const who = m => m.from === 'me' ? myName() : m.from === 'them' ? nameOf(c) : '';
  return msgs.filter(m => !m.recalled).slice(-n).map(m => {
    if (m.from === 'sys') return `（${m.text}）`;
    const q = m.quote ? `（引用「${m.quote.text}」）` : '';
    return `${who(m)}：${q}${m.type === 'image' ? '[图片]' : m.text}`;
  }).join('\n') || '（还没有聊过）';
}
export function buildReplyPrompt(chat, msgs) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const min = Math.max(1, cfg.minLines || 1), max = Math.max(min, cfg.maxLines || 4);
  return {
    system: globalSystem(),
    prompt: render('reply', {
      char: c ? (c.name || nameOf(c)) : 'TA', persona: personaOf(c) || '（没有更多资料）', user_persona: myPersona() || '（没有更多资料）',
      story: cfg.linkMode === 'follow' ? (recentStory(6) || '（暂无）') : '（这是一段只在手机上的聊天，和正文无关）',
      time: time.forPrompt(), history: historyText(msgs, c), min, max,
    }),
  };
}
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function parseReply(raw, c) {
  let text = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  let inner = '';
  text = text.replace(/<inner>([\s\S]*?)<\/inner>/gi, (_, t) => { inner += (inner ? ' ' : '') + t.trim(); return '\n'; });
  text = stripTags(text.replace(/<inner>[\s\S]*$/i, ''));
  const names = [c && c.name, c && c.nick, c && c.remark].filter(Boolean).map(escRe).join('|');
  const lines = text.split(/\n+/).map(l => l.trim()
    .replace(/^(\d+[.、)）]|[-*•])\s*/, '')
    .replace(names ? new RegExp(`^(${names})\\s*[:：]\\s*`) : /^$/, '')
    .replace(/^["“「](.*)["”」]$/, '$1').trim()).filter(Boolean);
  return { lines, inner };
}
export async function requestReply(chat) {
  if (busy.has(chat.id)) return;
  const c = contact(chat.contactId);
  const conn = resolveConn('text', 'chat', chat.cfg.conn);
  busy.add(chat.id); emit('typing', chat.id, true);
  try {
    const msgs = await getMsgs(chat.id);
    const { system, prompt } = buildReplyPrompt(chat, msgs);
    const raw = await generate({ conn, system, prompt, temperature: chat.cfg.temperature ?? undefined, maxTokens: 900, app: '聊天' });
    const { lines, inner } = parseReply(raw, c);
    if (!lines.length) throw new Error('AI 没有返回能用的消息');
    msgs.forEach(m => { if (m.from === 'me') m.read = true; });
    saveMsgs(chat.id); emit('read', chat.id);
    const batch = uid('b'), cap = Math.max(chat.cfg.maxLines || 4, 1) + 2;
    for (let i = 0; i < Math.min(lines.length, cap); i++) {
      const line = lines[i];
      if (i > 0) { emit('typing', chat.id, true); await sleep(Math.min(2400, 420 + line.length * 70)); }
      const m = { id: uid('m'), from: 'them', type: 'text', text: line, batch, ...time.stamp() };
      if (i === 0 && inner) m.inner = inner;
      msgs.push(m); touch(chat, m);
      if (shell.activeChat !== chat.id || !shell.visible) chat.unread = (chat.unread || 0) + 1;
      bumpStreak(chat);
      saveMsgs(chat.id); commit('chats');
      emit('msg', chat.id, m);
      shell.notify({ chatId: chat.id, title: nameOf(c), text: line, avatarUrl: avatarOf(c, chat) });
    }
  } catch (e) {
    emit('error', chat.id, e.message || String(e));
  } finally {
    busy.delete(chat.id); emit('typing', chat.id, false);
  }
}
/** 重新生成：删掉这条和同一批里它后面的 TA 消息，再要一次 */
export async function regenerate(chat, msgId) {
  const msgs = await getMsgs(chat.id);
  const i = msgs.findIndex(m => m.id === msgId); if (i < 0) return;
  const batch = msgs[i].batch;
  for (let j = msgs.length - 1; j >= i; j--) if (msgs[j].from === 'them' && (!batch || msgs[j].batch === batch || j === i)) msgs.splice(j, 1);
  const last = msgs[msgs.length - 1]; if (last) touch(chat, last); else chat.lastText = '';
  saveMsgs(chat.id); commit('chats'); emit('reload', chat.id);
  return requestReply(chat);
}

/* ---------- 续火花：两边当天都说过话就 +1 ---------- */
function bumpStreak(chat) {
  const day = time.isStory() ? time.story().day : Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const s = chat.streak || { days: 0, last: null };
  if (s.last === day) return;
  s.days = s.last === day - 1 ? s.days + 1 : 1; s.last = day; chat.streak = s;
}

/* ---------- 剧情里 TA 发来的消息（暗号 <asterphone>） ---------- */
export async function deliverFromStory(name, text) {
  const n = String(name || '').trim(); if (!n || !text) return;
  let c = state.contacts.find(p => [p.name, p.nick, p.remark].includes(n));
  if (!c) {
    const ch = characters().find(k => k.name === n);
    c = { id: uid('p'), name: n, nick: '', remark: '', gender: '', region: '', sign: '', pokeSuffix: '', avatar: ch ? ch.avatar : '', charKey: ch ? ch.key : '', persona: '', source: ch ? 'card' : 'story', star: false, group: '', createdAt: Date.now() };
    state.contacts.push(c); commit('contacts');
    log('info', '聊天', `正文里出现了新联系人「${n}」，已自动加入`);
  }
  const chat = chatForContact(c.id, true);
  const msgs = await getMsgs(chat.id);
  const m = { id: uid('m'), from: 'them', type: 'text', text: String(text).trim(), fromStory: true, ...time.stamp() };
  msgs.push(m); touch(chat, m);
  if (shell.activeChat !== chat.id || !shell.visible) chat.unread = (chat.unread || 0) + 1;
  saveMsgs(chat.id); commit('chats'); emit('msg', chat.id, m);
  shell.notify({ chatId: chat.id, title: nameOf(c), text: m.text, avatarUrl: avatarOf(c, chat) });
}

/* ---------- 动态 ---------- */
export async function genMoment(c) {
  const conn = resolveConn('text', 'chat');
  const raw = await generate({ conn, system: globalSystem(), app: '动态', maxTokens: 400,
    prompt: render('moment', { char: c.name || nameOf(c), persona: personaOf(c) || '（没有更多资料）', story: recentStory(4) || '（暂无）', time: time.forPrompt() }) });
  let text = stripTags(String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')).trim(), desc = '';
  text = text.replace(/\[图片[:：]\s*([^\]]+)\]/g, (_, d) => { desc = d.trim(); return ''; }).trim();
  const mo = { id: uid('mo'), author: c.id, text, imageDesc: desc, images: [], ...time.stamp(), likes: [], comments: [], vis: 'public' };
  state.moments.unshift(mo); commit('moments');
  return mo;
}
export async function genComments(mo) {
  const author = mo.author === 'me' ? myName() : nameOf(contact(mo.author));
  const people = state.contacts.filter(p => p.id !== mo.author).slice(0, 12);
  if (!people.length) throw new Error('还没有其他联系人可以来评论');
  const post = [`${author}：${mo.text}${mo.imageDesc ? `（配图：${mo.imageDesc}）` : ''}`,
    ...mo.comments.map(cm => `${who(cm.who)}${cm.to ? ' 回复 ' + who(cm.to) : ''}：${cm.text}`),
    mo.likes.length ? `已点赞：${mo.likes.map(who).join('、')}` : ''].filter(Boolean).join('\n');
  const peopleText = people.map(p => `- ${p.name || nameOf(p)}${personaOf(p) ? '：' + personaOf(p).slice(0, 80).replace(/\n/g, ' ') : ''}`).join('\n');
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: globalSystem(), app: '动态', maxTokens: 600, prompt: render('comment', { post, people: peopleText, time: time.forPrompt() }) });
  const find = n => { n = String(n || '').trim(); if (n === myName() || n === '我') return 'me'; const p = state.contacts.find(x => [x.name, x.nick, x.remark].includes(n)); return p ? p.id : null; };
  let added = 0;
  String(raw).split('\n').map(l => l.trim()).forEach(l => {
    const parts = l.split(/[|｜]/).map(s => s.trim());
    if (parts[0] === '赞') { const id = find(parts[1]); if (id && id !== 'me' && !mo.likes.includes(id)) { mo.likes.push(id); added++; } }
    else if (parts[0] === '评论' && parts.length >= 3) { const id = find(parts[1]); if (id && id !== 'me') { mo.comments.push({ id: uid('cm'), who: id, text: parts.slice(2).join('|'), at: Date.now() }); added++; } }
    else if (parts[0] === '回复' && parts.length >= 4) { const id = find(parts[1]), to = find(parts[2]); if (id && id !== 'me') { mo.comments.push({ id: uid('cm'), who: id, to: to || null, text: parts.slice(3).join('|'), at: Date.now() }); added++; } }
  });
  commit('moments');
  return added;
}
export function who(id) { return id === 'me' ? (state.me.nick || myName()) : nameOf(contact(id)); }
export { getPrompt, chatOf };
