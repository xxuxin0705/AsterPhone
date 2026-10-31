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
import { previewOf, forAI, parseLine, specialsGuide, money } from './msgtypes.js';
import { translate } from '../../core/translate.js';

/* ---------- 小广播：页面订阅 ---------- */
const subs = new Map();
export function on(evt, fn) { if (!subs.has(evt)) subs.set(evt, new Set()); subs.get(evt).add(fn); return () => subs.get(evt).delete(fn); }
function emit(evt, ...a) { (subs.get(evt) || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); }

export const busy = new Set();
/* ---------- 自动行为：主动消息、离开期间补发、正文触发 ---------- */
const FREQ = { low: 6 * 60, normal: 2 * 60, high: 40 };   // 安静多少分钟后 TA 可能来找你
const today = () => new Date().toDateString();
function autoLeft() {
  const s = state.settings;
  if (!s.autoUsed || s.autoUsed.date !== today()) s.autoUsed = { date: today(), count: 0 };
  return (s.autoLimit ?? 30) - s.autoUsed.count;
}
function chatLeft(chat) { const d = chat.autoDay; return (chat.cfg.proactiveLimit || 5) - (d && d.date === today() ? d.n : 0); }
function useAuto(chat) {
  autoLeft(); state.settings.autoUsed.count++;
  chat.autoDay = chat.autoDay && chat.autoDay.date === today() ? { date: today(), n: chat.autoDay.n + 1 } : { date: today(), n: 1 };
  commit('settings');
}
const canGo = chat => chat.type === 'dm' && chat.cfg.proactive && !busy.has(chat.id) && autoLeft() > 0 && chatLeft(chat) > 0 && !(shell.inDnd && shell.inDnd());
export function startEngine() {
  const last = state.lastSeen || 0;
  state.lastSeen = Date.now();
  setInterval(() => { state.lastSeen = Date.now(); commit('seen'); }, 60000);
  if (last && Date.now() - last > 60 * 60000) setTimeout(() => catchUp(Date.now() - last), 5000);
  setInterval(tick, 60000);
}
async function tick() {
  const hr = new Date().getHours(), t = today();
  for (const chat of state.chats) {
    if (!canGo(chat)) continue;
    const c = contact(chat.contactId); if (!c) continue;
    const quiet = (Date.now() - (chat.lastAt || 0)) / 60000;
    let extra = null;
    if (hr >= 7 && hr < 10 && chat.greet !== t + 'am' && quiet > 120) { chat.greet = t + 'am'; extra = `（早上了。${nameOf(c)} 起床后想到 ${myName()}，主动发消息说早安，可以聊聊今天的安排。）`; }
    else if (hr >= 22 && chat.greet !== t + 'pm' && quiet > 90) { chat.greet = t + 'pm'; extra = `（夜深了。${nameOf(c)} 睡前想跟 ${myName()} 说晚安。）`; }
    else if (quiet > FREQ[chat.cfg.proactiveFreq || 'normal'] && Math.random() < .2) extra = render('proactive', { char: c.name || nameOf(c) });
    if (!extra) continue;
    useAuto(chat);
    log('info', '主动消息', `${nameOf(c)} 主动来找你了`);
    await requestReply(chat, { extra });
    break;   // 一分钟最多一个人来找
  }
}
async function catchUp(gapMs) {
  const h = Math.round(gapMs / 3600000), gap = h >= 24 ? `${Math.round(h / 24)} 天` : `${h} 小时`;
  const list = state.chats.filter(canGo).sort(() => Math.random() - .5).slice(0, 3);
  for (const chat of list) {
    const c = contact(chat.contactId); if (!c) continue;
    useAuto(chat);
    log('info', '离开期间补发', `${nameOf(c)} 在你离开的 ${gap} 里发来了消息`);
    await requestReply(chat, { extra: render('catchup', { char: c.name || nameOf(c), gap }) });
  }
}
/** 正文里刚发生了事：跟随正文、开了主动消息的角色，有时会来手机上说两句 */
export function storyNudge(storyText) {
  const cur = String(storyText || '');
  const cands = state.chats.filter(ch => canGo(ch) && ch.cfg.linkMode === 'follow' && (() => { const c = contact(ch.contactId); return c && (cur.includes(c.name) || (c.charKey && characters().some(k => k.key === c.charKey && cur.includes(k.name)))); })());
  if (!cands.length || Math.random() > .25) return;
  const chat = cands[Math.floor(Math.random() * cands.length)], c = contact(chat.contactId);
  setTimeout(() => {
    if (!canGo(chat)) return;
    useAuto(chat);
    requestReply(chat, { extra: `（正文里刚发生的事让 ${nameOf(c)} 想到了 ${myName()}，于是拿起手机主动发了消息。）` });
  }, 30000 + Math.random() * 60000);
}

/* ---------- 翻译 ---------- */
const canTr = m => (m.type === 'text' || m.type === 'voice' || !m.type) && m.text;
export async function translateMsg(chat, m, to) {
  if (!canTr(m)) return;
  const t = await translate(m.text, to || chat.cfg.myLang || 'zh-CN');
  if (!t || t.trim() === String(m.text).trim()) return false;   // 本来就是这个语言，不用翻
  m.tr = t; saveMsgs(chat.id); emit('reload', chat.id);
  return true;
}
async function autoTranslate(chat, m) {
  if (!chat.cfg.autoTr || !canTr(m)) return;
  try { await translateMsg(chat, m); } catch (e) { /* 日志里有 */ }
}

/* ---------- 名字 / 头像 / 人设 ---------- */
export const nameOf = c => (c && (c.remark || c.nick || c.name)) || '联系人';
export function personaOf(c) {
  if (!c) return '';
  if (c.loreText) return `${c.loreText}\n（这个设定里可能写了好几个人，你只扮演其中的「${c.name}」。）${c.persona ? '\n' + c.persona : ''}`;
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
  return previewOf(m);
}
function touch(chat, m) {
  chat.lastAt = m.at; chat.lastSt = m.st; chat.lastText = preview(m); chat.lastFrom = m.from;
}

/* ---------- 发消息（不会自动回复） ---------- */
export async function send(chat, text, extra = {}) {
  const msgs = await getMsgs(chat.id);
  if (chat.cfg.sendTr && chat.cfg.theirLang) {
    try { const t = await translate(text, chat.cfg.theirLang); if (t && t !== text) { extra = { ...extra, orig: text }; text = t; } }
    catch (e) { /* 翻译失败就发原文 */ }
  }
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
/** 发一条特殊消息（语音、图片、转账……） */
export async function sendSpecial(chat, fields) {
  const msgs = await getMsgs(chat.id);
  const m = { id: uid('m'), from: 'me', ...fields, ...time.stamp() };
  if ((m.type === 'transfer' || m.type === 'packet') && !m.status) m.status = 'pending';
  if (m.type === 'transfer' || m.type === 'packet') ledger(-m.amount, `给 ${isGroup(chat) ? chat.name : nameOf(contact(chat.contactId))} 的${m.type === 'packet' ? '红包' : '转账'}`);
  msgs.push(m); touch(chat, m);
  saveMsgs(chat.id); commit('chats'); emit('msg', chat.id, m);
  return m;
}
/** 钱包记一笔：正数是进账，负数是花出去 */
export function ledger(amount, note) {
  const me = state.me; me.balance = Math.round(((me.balance ?? 0) + Number(amount)) * 100) / 100;
  (me.ledger = me.ledger || []).unshift({ at: Date.now(), amount: Number(amount), note });
  me.ledger.splice(200); commit('me');
}
/** 我点开 TA 的转账 / 红包：收下或退还 */
export async function settle(chat, m, accept) {
  const who = nameOf(contact(m.who || chat.contactId));
  m.status = accept ? 'accepted' : 'returned';
  if (accept) ledger(m.amount, `收到 ${who} 的${m.type === 'packet' ? '红包' : '转账'}`);
  saveMsgs(chat.id);
  await addSystem(chat, `你${accept ? '收下了' : '退还了'}「${who}」的${m.type === 'packet' ? '红包' : '转账'} ${money(m.amount)}`);
  emit('reload', chat.id);
}
export { emit };

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
    return `${who(m)}：${q}${forAI(m)}`;
  }).join('\n') || '（还没有聊过）';
}
export function buildReplyPrompt(chat, msgs) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const min = Math.max(1, cfg.minLines || 1), max = Math.max(min, cfg.maxLines || 4);
  return {
    system: [globalSystem(), specialsGuide()].filter(Boolean).join('\n\n'),
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
export async function requestReply(chat, opts = {}) {
  if (isGroup(chat)) return requestGroupReply(chat);
  if (busy.has(chat.id)) return;
  const c = contact(chat.contactId);
  const conn = resolveConn('text', 'chat', chat.cfg.conn);
  busy.add(chat.id); emit('typing', chat.id, true);
  try {
    const msgs = await getMsgs(chat.id);
    if (c && c.lore) await (await import('./aiload.js')).refreshLore(c);
    const built = buildReplyPrompt(chat, msgs);
    const prompt = built.prompt + (opts.extra ? '\n\n' + opts.extra : ''), system = built.system;
    const raw = await generate({ conn, system, prompt, temperature: chat.cfg.temperature ?? undefined, maxTokens: 900, app: opts.extra ? '主动消息' : '聊天' });
    const { lines, inner } = parseReply(raw, c);
    if (!lines.length) throw new Error('AI 没有返回能用的消息');
    msgs.forEach(m => { if (m.from === 'me') m.read = true; });
    saveMsgs(chat.id); emit('read', chat.id);
    const batch = uid('b'), cap = Math.max(chat.cfg.maxLines || 4, 1) + 2;
    let shown = 0, first = true;
    for (const line of lines) {
      if (shown >= cap) break;
      const p = parseLine(line);
      // 收下 / 退还我刚发的转账、红包
      if (p.type === 'accept' || p.type === 'return') {
        const t = [...msgs].reverse().find(x => x.from === 'me' && (x.type === 'transfer' || x.type === 'packet') && x.status === 'pending');
        if (t) {
          t.status = p.type === 'accept' ? 'accepted' : 'returned';
          if (t.status === 'returned') ledger(t.amount, `${nameOf(c)} 退还了${t.type === 'packet' ? '红包' : '转账'}`);
          await addSystem(chat, `${nameOf(c)} ${t.status === 'accepted' ? '收下了' : '退还了'}你的${t.type === 'packet' ? '红包' : '转账'} ${money(t.amount)}`);
          emit('reload', chat.id);
        }
        continue;
      }
      if (p.type === 'poke-them') { await addSystem(chat, `「${nameOf(c)}」拍了拍你${state.me.pokeSuffix || ''}`, { pokeMe: true }); continue; }
      if (!first) { emit('typing', chat.id, true); await sleep(Math.min(2400, 420 + String(p.text || '').length * 70)); }
      const m = { id: uid('m'), from: 'them', ...p, batch, ...time.stamp() };
      if (first && inner) m.inner = inner;
      first = false; shown++;
      msgs.push(m); touch(chat, m);
      if (shell.activeChat !== chat.id || !shell.visible) chat.unread = (chat.unread || 0) + 1;
      bumpStreak(chat);
      saveMsgs(chat.id); commit('chats');
      emit('msg', chat.id, m);
      shell.notify({ chatId: chat.id, title: nameOf(c), text: preview(m), avatarUrl: avatarOf(c, chat) });
      autoTranslate(chat, m);
    }
    if (!shown) saveMsgs(chat.id);
  } catch (e) {
    emit('error', chat.id, e.message || String(e));
  } finally {
    busy.delete(chat.id); emit('typing', chat.id, false);
  }
}
/* ---------- 群聊 ---------- */
export const isGroup = chat => chat && chat.type === 'group';
export const memberName = id => id === 'me' ? (state.me.nick || myName()) : nameOf(contact(id));
export function groupTitle(chat) { return `${chat.name || '群聊'}(${(chat.members || []).length + 1})`; }
export function createGroup(memberIds, name) {
  const d = state.apps.chat.defaults;
  const g = { id: uid('g_'), type: 'group', name: name || memberIds.slice(0, 3).map(id => nameOf(contact(id))).join('、'), avatar: '', members: memberIds.slice(), owner: 'me', admins: [], titles: {}, intro: '', notice: '',
    pinned: false, muted: false, unread: 0, lastAt: Date.now(), lastText: '',
    cfg: { linkMode: d.linkMode, injectCount: state.apps.chat.injectCount, showRead: false, showThink: false, conn: 'follow', temperature: null, maxSpeakers: 3, minLines: 1, maxLines: 3,
      bg: '', myAvatar: '', avatarWho: 'both', streak: false, myNick: '', myTitle: '', dmMode: d.groupDm || 'inline' } };
  state.chats.push(g); commit('chats');
  return g;
}
function groupHistory(msgs, n = 30) {
  return msgs.filter(m => !m.recalled).slice(-n).map(m => {
    if (m.from === 'sys') return `（${m.text}）`;
    const who = m.from === 'me' ? myName() : memberName(m.who);
    const q = m.quote ? `（引用「${m.quote.text}」）` : '';
    return `${who}：${q}${forAI(m)}`;
  }).join('\n') || '（群里还没人说话）';
}
export async function requestGroupReply(chat) {
  if (busy.has(chat.id)) return;
  busy.add(chat.id); emit('typing', chat.id, true);
  try {
    const msgs = await getMsgs(chat.id);
    const members = chat.members.map(contact).filter(Boolean);
    if (!members.length) throw new Error('群里没有其他人');
    const lastMine = [...msgs].reverse().find(m => m.from === 'me');
    const at = lastMine ? members.filter(p => (lastMine.text || '').includes('@' + nameOf(p))).map(nameOf) : [];
    const memText = members.map(p => `- ${p.name || nameOf(p)}${chat.titles[p.id] ? `（群头衔：${chat.titles[p.id]}）` : ''}${chat.owner === p.id ? '（群主）' : ''}：${(personaOf(p) || '（没有更多资料）').slice(0, 160).replace(/\n/g, ' ')}`).join('\n');
    const prompt = render('group', { group: chat.name, members: memText, intro: chat.intro || '（无）', story: chat.cfg.linkMode === 'follow' ? (recentStory(6) || '（暂无）') : '（这个群只在手机上，和正文无关）',
      time: time.forPrompt(), history: groupHistory(msgs) + (at.length ? `\n（${myName()} 刚才 @ 了：${at.join('、')}）` : ''), max: chat.cfg.maxSpeakers || 3 });
    const raw = await generate({ conn: resolveConn('text', 'chat', chat.cfg.conn), system: [globalSystem(), specialsGuide()].join('\n\n'), prompt, temperature: chat.cfg.temperature ?? undefined, maxTokens: 1200, app: '群聊' });
    const clean = stripTags(String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, ''));
    msgs.forEach(m => { if (m.from === 'me') m.read = true; });
    const find = n => { n = String(n || '').trim(); return members.find(p => [p.name, p.nick, p.remark].filter(Boolean).includes(n)); };
    const batch = uid('b'); let shown = 0;
    for (const raw of clean.split('\n').map(l => l.trim()).filter(Boolean)) {
      const dm = /^私聊\s*[|｜]\s*([^:：]+)[:：]\s*(.+)$/.exec(raw);
      if (dm) { const p = find(dm[1]); if (p) await deliverDM(p, dm[2]); continue; }
      const mm = /^([^:：]{1,16})[:：]\s*(.+)$/.exec(raw); if (!mm) continue;
      const p = find(mm[1]); if (!p) continue;
      const parsed = parseLine(mm[2].trim());
      if (['accept', 'return', 'poke-them'].includes(parsed.type)) {
        if (parsed.type === 'poke-them') await addSystem(chat, `「${nameOf(p)}」拍了拍你${state.me.pokeSuffix || ''}`);
        continue;
      }
      if (shown) { emit('typing', chat.id, true); await sleep(Math.min(2200, 380 + String(parsed.text || '').length * 60)); }
      const m = { id: uid('m'), from: 'them', who: p.id, ...parsed, batch, ...time.stamp() };
      msgs.push(m); touch(chat, m); chat.lastText = `${nameOf(p)}：${preview(m)}`; shown++;
      if (shell.activeChat !== chat.id || !shell.visible) chat.unread = (chat.unread || 0) + 1;
      saveMsgs(chat.id); commit('chats'); emit('msg', chat.id, m);
      shell.notify({ chatId: chat.id, title: chat.name, text: `${nameOf(p)}：${preview(m)}`, avatarUrl: chat.avatar || p.avatar });
      autoTranslate(chat, m);
      if (shown >= (chat.cfg.maxSpeakers || 3) * 3) break;
    }
    if (!shown) await addSystem(chat, '大家好像都在忙，没人回');
  } catch (e) { emit('error', chat.id, e.message || String(e)); }
  finally { busy.delete(chat.id); emit('typing', chat.id, false); }
}
/** 群里有人转去私聊你 */
async function deliverDM(p, text) {
  const dmc = chatForContact(p.id, true), msgs = await getMsgs(dmc.id);
  const m = { id: uid('m'), from: 'them', ...parseLine(text.trim()), fromGroup: true, ...time.stamp() };
  if (['accept', 'return', 'poke-them'].includes(m.type)) return;
  msgs.push(m); touch(dmc, m);
  if (shell.activeChat !== dmc.id || !shell.visible) dmc.unread = (dmc.unread || 0) + 1;
  saveMsgs(dmc.id); commit('chats'); emit('msg', dmc.id, m);
  shell.notify({ chatId: dmc.id, title: nameOf(p), text: preview(m), avatarUrl: avatarOf(p, dmc) });
}

/** 通话中：TA 接着说几句（不写进聊天记录，挂断时整段变成一条通话记录） */
export async function callReply(chat, lines, mode) {
  const c = contact(chat.contactId), msgs = await getMsgs(chat.id);
  const { prompt } = buildReplyPrompt(chat, msgs);
  const talk = lines.map(l => `${l.who === 'me' ? myName() : nameOf(c)}：${l.text}`).join('\n') || '（刚接通）';
  const p2 = `${prompt}\n\n【你们现在正在${mode === 'video' ? '视频' : '语音'}通话，上面是通话前的聊天】\n通话内容：\n${talk}\n\n请以 ${nameOf(c)} 的身份接着说：用说话的口吻，1~3 句，每句一行；可以用（）写一点语气或动作；不要发特殊消息。`;
  const raw = await generate({ conn: resolveConn('text', 'chat', chat.cfg.conn), system: globalSystem(), prompt: p2, temperature: chat.cfg.temperature ?? undefined, maxTokens: 400, app: '通话' });
  return parseReply(raw, c).lines.filter(l => !/^\[/.test(l)).slice(0, 3);
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
  let hiddenFromMe = false;
  text = text.replace(/\[屏蔽[^\]]*\]/g, () => { hiddenFromMe = true; return ''; }).trim();
  const mo = { id: uid('mo'), author: c.id, text, imageDesc: desc, images: [], ...time.stamp(), likes: [], comments: [], vis: 'public', hiddenFromMe };
  state.moments.unshift(mo); commit('moments');
  return mo;
}
export async function genComments(mo) {
  const author = mo.author === 'me' ? myName() : nameOf(contact(mo.author));
  const people = state.contacts.filter(p => p.id !== mo.author && canSee(mo, p.id)).slice(0, 12);
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
/** 这条动态 TA 看不看得到（我设的可见范围管住 AI：看不到的人不会来评论） */
export function canSee(mo, id) {
  if (mo.author === id) return true;
  switch (mo.vis) {
    case 'private': return false;
    case 'include': return (mo.visIds || []).includes(id);
    case 'exclude': return !(mo.visIds || []).includes(id);
    case 'group': { const p = contact(id); return !!p && p.group === mo.visGroup; }
    default: return true;
  }
}
export function who(id) { return id === 'me' ? (state.me.nick || myName()) : nameOf(contact(id)); }
export { getPrompt, chatOf };
