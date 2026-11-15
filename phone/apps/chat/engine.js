// 聊天的「发动机」：发消息、让 TA 回复、重新生成、收到剧情里的消息。
// 页面只管显示，真正改数据的都在这里；改完会通知页面刷新。
import { uid, sleep } from '../../core/util.js';
import { state, commit, contact, chatOf, chatForContact, getMsgs, saveMsgs } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { characters, stripTags } from '../../core/bridge.js';
import { C as ctxCfg, storyText, worldText } from '../../core/context.js';
import { memoryFor, fromChat, dropChat, lineNames, bigNames } from '../../core/memory.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { compose, myName, myPersona, chatScheme, myAvatar, blocksIn } from '../../core/promptstore.js';
import { previewOf, forAI, parseLine, specialsGuide, voiceNote, money } from './msgtypes.js';
import { translate } from '../../core/translate.js';

/* ---------- 小广播：页面订阅 ---------- */
const subs = new Map();
export function on(evt, fn) { if (!subs.has(evt)) subs.set(evt, new Set()); subs.get(evt).add(fn); return () => subs.get(evt).delete(fn); }
function emit(evt, ...a) { (subs.get(evt) || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); }

export const busy = new Set();
const stops = new Map();   // 正在回复的聊天 → AbortController（放模块里：退出聊天再进来，按钮还是「取消」）
export const cancelReply = id => { const ac = stops.get(id); if (ac) ac.abort(); };
/* ---------- 自动行为（私聊、群聊都会，不用开开关；免打扰时段里不来） ----------
 * 两种模式：正文里写到有人用手机发消息、转账、发红包 → 正文 AI 留暗号，手机照着收（deliverFromStory，见 core/sync.js）。
 * 只有仅线上聊天：还会每隔几小时来找你（加早安晚安），离开期间会补发；隔几小时在每个聊天里能单独改，默认跟「联动方式与时间」。
 *   跟随正文不定时来：手机里的事会写进正文，你没顾上看时自己发一堆会把正文带跑。 */
const OLD_FREQ = { low: 6, normal: 2, high: 1 };   // 以前的「少 / 正常 / 多」换算成小时
const everyH = chat => chat.cfg.proactiveEvery || OLD_FREQ[chat.cfg.proactiveFreq] || state.apps.chat.defaults.proactiveEvery || 3;
const today = () => new Date().toDateString();
const free = chat => (chat.type === 'dm' || chat.type === 'group') && !busy.has(chat.id) && !(shell.inDnd && shell.inDnd());
/** 仅线上聊天里「TA 主动来找我」开没开（没单独设过就跟总设置，默认开） */
export const proactiveOn = cfg => (cfg.proactive ?? state.apps.chat.defaults.proactive) !== false;
const canGo = chat => free(chat) && chat.cfg.linkMode === 'online' && proactiveOn(chat.cfg) && !cutOf(chat);
/** TA 把你删了（'deleted'）/ 拉黑了（'blocked'）：你发的消息带红色感叹号，TA 收不到也不会回 */
export const cutOf = chat => !isGroup(chat) && (contact(chat.contactId) || {}).cut || '';
async function bounce(chat, m) {
  if (m.from !== 'me' || !cutOf(chat)) return;
  m.bounced = true; m.noInject = true;
  const c = contact(chat.contactId);
  if (cutOf(chat) === 'deleted') await addSystem(chat, `「${nameOf(c)}」开启了朋友验证，你还不是 TA 的朋友。请先发送朋友验证请求，对方验证通过后，才能聊天。`, { verify: true });
  else await addSystem(chat, '消息已发出，但被对方拒收了。');
}
/** 被删了以后发朋友验证：AI 按人设和剧情决定通不通过 */
export async function sendVerify(chat, text) {
  const c = contact(chat.contactId);
  await addSystem(chat, `你发送了朋友验证：${text}`);
  const raw = await generate({ conn: resolveConn('text', 'chat', chat.cfg.conn), system: '', app: '好友验证',
    prompt: compose('verify', { char: c.name || nameOf(c), persona: charPersona(c), story: storyNow(), text }) });
  if (/不通过|拒绝/.test(raw) || !/通过/.test(raw)) { await addSystem(chat, `「${nameOf(c)}」暂时没有通过你的朋友验证`); return false; }
  c.cut = ''; commit('contacts');
  await addSystem(chat, `「${nameOf(c)}」通过了你的朋友验证，现在可以开始聊天了`);
  return true;
}
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
    const g = isGroup(chat), c = g ? null : contact(chat.contactId); if (!g && !c) continue;
    const quiet = (Date.now() - (chat.lastAt || 0)) / 60000, every = everyH(chat) * 60;
    if ((Date.now() - (chat.lastProactive || 0)) / 60000 < every) continue;   // 离上次主动找你还不到设定的小时数
    let extra = null;
    if (hr >= 7 && hr < 10 && chat.greet !== t + 'am' && quiet > 120) { chat.greet = t + 'am'; extra = g ? '（早上了，群里有人先冒头打招呼，大家聊几句今天的安排。）' : `（早上了。${nameOf(c)} 起床后想到 ${myName()}，主动发消息说早安，可以聊聊今天的安排。）`; }
    else if (hr >= 22 && chat.greet !== t + 'pm' && quiet > 90) { chat.greet = t + 'pm'; extra = g ? '（夜深了，群里有人说要睡了，大家互道晚安。）' : `（夜深了。${nameOf(c)} 睡前想跟 ${myName()} 说晚安。）`; }
    else if (quiet > every && Math.random() < .2) extra = g ? '（群里有一阵没人说话了，有人主动挑起话头，大家接着聊。）' : compose('proactive', { char: c.name || nameOf(c) });
    if (!extra) continue;
    chat.lastProactive = Date.now();
    log('info', '主动消息', g ? `群「${chat.name}」自己聊起来了` : `${nameOf(c)} 主动来找你了`);
    await requestReply(chat, { extra });
    break;   // 一分钟最多一个人来找
  }
}
async function catchUp(gapMs) {
  const h = Math.round(gapMs / 3600000), gap = h >= 24 ? `${Math.round(h / 24)} 天` : `${h} 小时`;
  const list = state.chats.filter(canGo).sort(() => Math.random() - .5).slice(0, 3);
  for (const chat of list) {
    const g = isGroup(chat), c = g ? null : contact(chat.contactId); if (!g && !c) continue;
    log('info', '离开期间补发', g ? `群「${chat.name}」在你离开的 ${gap} 里聊了几句` : `${nameOf(c)} 在你离开的 ${gap} 里发来了消息`);
    await requestReply(chat, { extra: g ? `（${myName()} 离开了 ${gap}，这段时间里群里大家聊了些什么。）` : compose('catchup', { char: c.name || nameOf(c), gap }) });
  }
}
/** 试一下：让最近聊过的「仅线上聊天」私聊对象马上主动来找你（免打扰时段也照样来）。返回名字，没有可用的聊天返回 '' */
export function pokeNow() {
  const chat = state.chats.filter(ch => ch.type === 'dm' && ch.cfg.linkMode === 'online' && !busy.has(ch.id)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))[0];
  const c = chat && contact(chat.contactId); if (!c) return '';
  log('info', '主动消息', `试一下：让 ${nameOf(c)} 现在来找你`);
  requestReply(chat, { extra: compose('proactive', { char: c.name || nameOf(c) }) });
  return nameOf(c);
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
/** 回复设置：这个聊天自己改过就用自己的，没改过跟「设置 → 应用 → 聊天」里的默认。
 *  以前的私聊有「最少 / 最多几句」照旧算；群以前没有这项（存着的 1/3 是建群时随手写的），只认新的 lines */
export function replyCfg(chat) {
  const d = state.apps.chat.defaults, c = chat.cfg, g = isGroup(chat);
  return { group: g, lines: c.lines || (!g && c.minLines ? [c.minLines, c.maxLines || 4] : g ? d.gLines : d.lines), voice: c.voice || d.voice, autoVoice: c.autoVoice ?? d.autoVoice, poke: c.poke ?? d.poke };
}
export const voiceKey = (chat, m) => `tts:${chat.id}:${m.id}`;
/** 语音超过上限的改成文字；收到语音就先合成存好（点开直接放） */
function voiceLimit(rc, p, n) { return p.type === 'voice' && n > rc.voice[1] ? { type: 'text', text: p.text } : p; }
/** 提示词最末尾再提一句条数（离结尾越近小模型越听） */
const roundNote = rc => `\n\n【这一轮】${rc.group ? '大家加起来' : ''}回复 ${rc.lines[0]}–${rc.lines[1]} 条独立消息，每条单独一行；${rc.voice[1] ? `语音 ${rc.voice[0]}–${rc.voice[1]} 条` : '不发语音'}。`;
/** 条数不够下限：把长的话按句子拆成几条（括号、引号里的不拆，太短的并回去），拆到够数或拆不动为止；不多调一次 AI。head：每条前面要留着的（群聊的「名字：」），给 null 的那行不拆 */
function toMin(lines, [min, max], head = () => '') {
  for (const short of [6, 2]) {
    if (lines.length >= min) break;
    let room = max - lines.length;
    lines = lines.flatMap(l => {
      const hd = head(l);
      if (room <= 0 || hd == null || /^\s*\[/.test(l.slice(hd.length))) return [l];
      const body = l.slice(hd.length);
      const ps = []; let buf = '', d = 0;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i]; buf += ch;
        if ('（(「『“【['.includes(ch)) d++; else if ('）)」』”】]'.includes(ch)) d = Math.max(0, d - 1);
        else if (!d && /[。！？!?…~～]/.test(ch) && !/[。！？!?…~～”」』）)]/.test(body[i + 1] || '')) { ps.push(buf.trim()); buf = ''; }
      }
      if (buf.trim()) ps.push(buf.trim());
      const parts = ps.reduce((a, x) => { if (a.length && [...a[a.length - 1]].length < short) a[a.length - 1] += x; else a.push(x); return a; }, []);
      if (parts.length > 1 && [...parts[parts.length - 1]].length < short) parts[parts.length - 2] += parts.pop();
      while (parts.length > room + 1) parts.splice(-2, 2, parts.at(-2) + parts.at(-1));
      room -= parts.length - 1;
      return parts.map(x => hd + x);
    });
  }
  return lines;
}
/* 角色给消息贴表情（照作者二改的 phonetest）：AI 写 [表情回应:😂] 或 [表情回应:😂|那句话里的几个字]；
   没写就按你说的话和 TA 这轮的语气补一个。贴在 m.reactions[谁]（你自己贴的是 m.reactions.me） */
const RX = /\[表情回应[:：]\s*([^\]|｜]+?)\s*(?:[|｜]\s*([^\]]+?))?\s*\]/g;
function reactTo(msgs, by, raw, frag) {
  const e = (/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u.exec(raw) || [])[0];
  const t = e && ((frag && [...msgs].reverse().find(m => m.from !== 'sys' && String(m.text || '').includes(frag.trim()))) || [...msgs].reverse().find(m => m.from === 'me' && m.text));
  if (!t) return false;
  (t.reactions = t.reactions || {})[by] = e; return true;
}
function toneEmoji(said, reply) {
  const pick = l => l[Math.floor(Math.random() * l.length)], own = reply.match(/\p{Extended_Pictographic}/gu);
  if (own && Math.random() < .6) return pick(own);
  const tone = /嘿嘿|嘻嘻|哈哈|笑死|乖|宝贝|宝宝|亲亲|么么|可爱|撒娇|吃醋|😝|😜|😘|😏|🤪/.test(reply) ? 'playful' : /哼|你才|闭嘴|别烦|走开|讨厌|生气|气死|烦死|不理你|😤|😠|💢|🙄/.test(reply) ? 'annoyed'
    : /呜|委屈|哭|难过|伤心|对不起|抱歉|😭|🥺|😢/.test(reply) ? 'hurt' : /害羞|脸红|才没有|不要说了|🫣|😳/.test(reply) ? 'shy' : /想你|爱你|喜欢你|抱抱|心疼|乖乖|🥰|❤️|😍/.test(reply) ? 'tender' : '';
  const byTone = { playful: ['😏', '😝', '🤭'], annoyed: ['🙄', '😑'], hurt: ['🥺'], shy: ['😳', '🫣'], tender: ['🥰', '❤️', '🤗'] };
  if (/猪|笨蛋|傻|蠢|白痴|有病|神经|滚|讨厌|烦死|闭嘴|垃圾|丑|呆子|憨/.test(said)) return pick({ playful: ['😘', '😝', '😜', '😏'], annoyed: ['😤', '🙄', '💢', '😑'], hurt: ['🥺', '😭'], shy: ['😳', '🫣'], tender: ['🥰', '🤗'] }[tone] || ['🙄', '😤', '😑']);
  const rules = [[/哈哈|笑死|hhh|233|绷不住|好好笑/i, ['😂', '🤣', '😆']], [/晚安|睡了|睡觉|困/, ['😴', '🌙', '🥱']], [/早安|早上好|早啊|起床/, ['☀️', '🥰']], [/谢谢|多谢|感谢|辛苦/, ['🥰', '🙏', '🤗']],
    [/爱你|喜欢你|想你|亲亲|抱抱|么么/, tone === 'shy' ? ['😳', '🫣'] : tone === 'annoyed' ? ['🙄', '😏'] : ['❤️', '🥰', '😘']], [/难过|伤心|哭|呜|委屈|不开心/, ['🥺', '🤗']], [/生气|气死|烦/, tone === 'playful' ? ['😝', '😘'] : ['😳', '🥺']],
    [/好耶|太棒|成功|过了|赢|恭喜|生日/, ['🎉', '👏', '🥳']], [/真的|天哪|居然|竟然|!{2,}|！{2,}/, ['😮', '😳', '🤯']], [/[?？]$|吗[?？]?$|什么|为什么|怎么/, tone === 'playful' ? ['😏', '🤭'] : ['🤔', '👀']], [/好的|行|可以|嗯|ok|收到/i, ['👌', '👍']]];
  for (const [re, l] of rules) if (re.test(said)) return pick(l);
  return pick(byTone[tone] || ['👀', '🤔', '👍', '😌']);
}
async function preVoice(chat, m, rc) {
  if (m.type !== 'voice' || !rc.autoVoice) return;
  const { speakAs } = await import('../../core/voice.js');
  speakAs(m.who || chat.contactId, m.text, { cache: voiceKey(chat, m), silent: true }).catch(e => log('warn', '语音', '先合成语音失败：' + e.message));
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
export function myAvatarIn(chat) { return (chat && chat.cfg.myAvatar) || myAvatar(); }

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
  emit('msg', chat.id, m); await bounce(chat, m);
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
  if ((m.type === 'transfer' || m.type === 'packet') && !(m.from === 'me' && cutOf(chat))) ledger(-m.amount, `给 ${isGroup(chat) ? chat.name : nameOf(contact(chat.contactId))} 的${m.type === 'packet' ? '红包' : '转账'}`);
  msgs.push(m); touch(chat, m);
  saveMsgs(chat.id); commit('chats'); emit('msg', chat.id, m); await bounce(chat, m);
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
/** 人设、世界书、正文：按「设置 → 上下文与世界书」里的开关来 */
const charPersona = c => (ctxCfg().charPersona && personaOf(c)) || '（没有更多资料）';
const userPersonaText = () => (ctxCfg().userPersona && myPersona()) || '（没有更多资料）';
const storyNow = n => storyText(n) || '（暂无）';   // 两种模式都读正文（区别只在手机里的事写不写进正文）
/** 世界书 + 岁岁砂里 TA 们记得的事（people：这次说话的 TA 们）：world = 世界书和一直记着的，memory = 这会儿想起的；
 *  提示词（cat 这一类正在用的方案）里没写 {{memory}} 的，想起的也放进 world */
async function worldBlock(scan, people = [], cat, sid, noBook) {
  const w = noBook ? '' : await worldText(scan).catch(() => ''), [m, r] = await memoryFor(people.filter(Boolean), scan).catch(e => { log('warn', '岁岁砂', '读不到记忆：' + e.message); return ['', '']; });
  const own = cat && blocksIn(cat, sid).some(b => b.on && b.text.includes('{{memory}}'));
  return { world: (w ? `\n【世界书】\n${w}\n` : '') + m + (own ? '' : r), memory: own ? r : '' };
}
/** 前面不常变的（人设、世界书、一直记着的、正文）走缓存：从第一处每次都会变的地方（聊天记录、这会儿想起的、时间）切开 */
const cacheAt = (p, ...vs) => Math.min(p.length, ...vs.filter(Boolean).map(v => p.indexOf(v)).filter(i => i >= 0));
/** 岁岁砂：让 TA 回消息时顺手把值得记的写进 <astermem>（不多调一次 AI） */
// 这个聊天记不记进岁岁砂：正文互通的一定记（正文都知道了，岁岁砂也该知道）；线上模式的各自开关，没设过照以前的总开关
export const memOn = chat => chat.cfg.linkMode === 'follow' || (chat.cfg.mem ?? state.apps.memory.chat !== false);
const memNote = chat => state.apps.memory.on && memOn(chat) ? '\n\n' + compose('memChat', { lines: lineNames(), bigs: bigNames() }) : '';
/** 把回复里的 <astermem> 拿出来（没写完被截断的也去掉），剩下的才是消息 */
const takeMem = raw => { let mem = ''; const text = String(raw || '').replace(/<astermem>([\s\S]*?)<\/astermem>/gi, (_, x) => { mem += x + '\n'; return ''; }).replace(/<astermem>[\s\S]*$/i, ''); return [text, mem.trim()]; };
const keepMem = (chat, batch, mem, people) => mem && fromChat(chat.id, batch, mem, people).catch(e => log('warn', '岁岁砂', '记不下这段聊天：' + e.message));
/** lite（通话用，带得少 AI 开口才快）：'story' 正文只带最后一段；'min' 再连世界书也不带；不写就是全带 */
export async function buildReplyPrompt(chat, msgs, lite) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const rc = replyCfg(chat), [min, max] = rc.lines;
  const all = storyNow(), cut = all.slice(-1500), story = lite && all.length > 1500 ? '…' + cut.slice(cut.indexOf('\n') + 1) : all;
  const history = historyText(msgs, c, cfg.hist ?? 30), t = time.forPrompt(), sid = chatScheme('dm', cfg.prompt), wb = await worldBlock(story + '\n' + history, [c], 'dm', sid, lite === 'min');
  const prompt = compose('dm', {
    char: c ? (c.name || nameOf(c)) : 'TA', persona: charPersona(c), user_persona: userPersonaText(),
    story, ...wb, time: t, history, min, max, voice: voiceNote(rc), last: lastMine(msgs),
  }, sid);
  return { system: specialsGuide(rc), prompt, keep: cacheAt(prompt, history, wb.memory, t) };
}
// 要回的那几条：放在要求里点出来（只写在聊天记录里，长提示词下小模型会去接正文最后的场面）
const lastMine = msgs => { const r = []; for (let i = msgs.length - 1; i >= 0 && msgs[i].from === 'me'; i--) if (!msgs[i].recalled) r.unshift(forAI(msgs[i])); return r.length ? `「${r.join(' / ')}」` : '消息'; };
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
  if (isGroup(chat)) return requestGroupReply(chat, opts);
  if (busy.has(chat.id)) return;
  if (cutOf(chat)) { emit('error', chat.id, cutOf(chat) === 'deleted' ? 'TA 把你删了，先发送朋友验证' : 'TA 把你拉黑了，收不到你的消息'); return; }
  const c = contact(chat.contactId);
  const conn = resolveConn('text', 'chat', chat.cfg.conn);
  busy.add(chat.id); emit('typing', chat.id, true);
  const ac = new AbortController(); stops.set(chat.id, ac);
  try {
    const msgs = await getMsgs(chat.id);
    if (c && c.lore) await (await import('./aiload.js')).refreshLore(c);
    const built = await buildReplyPrompt(chat, msgs);
    const prompt = built.prompt + (await import('../../core/music.js')).togetherNote(c) + memNote(chat) + (opts.extra ? '\n\n' + opts.extra : '') + roundNote(replyCfg(chat)), system = built.system;
    const raw = await generate({ conn, system, prompt, keep: built.keep, temperature: chat.cfg.temperature ?? undefined, app: opts.extra ? '主动消息' : '聊天', stop: ac.signal });
    const fresh = !opts.extra && msgs.length && msgs[msgs.length - 1].from === 'me';   // 你刚说了话（主动找你的那种不贴）
    let reacted = 0;
    const [said0, mem] = takeMem(raw), said = said0.replace(RX, (_, e, f) => { if (fresh && !reacted && c && reactTo(msgs, c.id, e, f)) reacted++; return ''; });
    const { lines: got, inner } = parseReply(said, c), lines = toMin(got, replyCfg(chat).lines);
    if (fresh && !reacted && c) reactTo(msgs, c.id, toneEmoji(msgs[msgs.length - 1].text || '', lines.join(' ')));
    if (!lines.length) throw new Error('AI 没有返回能用的消息');
    msgs.forEach(m => { if (m.from === 'me') m.read = true; });
    saveMsgs(chat.id); emit('read', chat.id);
    const batch = uid('b'), rc = replyCfg(chat);
    keepMem(chat, batch, mem, [c].filter(Boolean));
    let shown = 0, first = true, nv = 0;
    for (const line of lines) {
      if (shown >= rc.lines[1] || ac.signal.aborted) break;
      let p = parseLine(line);
      if (p.type === 'voice') p = voiceLimit(rc, p, ++nv);
      // 收下 / 退还我刚发的转账、红包
      if (p.type === 'accept' || p.type === 'return') { await settleMine(chat, msgs, c, p.type === 'accept'); continue; }
      if (p.type === 'poke-them') { if (rc.poke) await addSystem(chat, `「${nameOf(c)}」拍了拍你${state.me.pokeSuffix || ''}`, { pokeMe: true }); continue; }
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
      autoTranslate(chat, m); preVoice(chat, m, rc);
    }
    if (!shown) saveMsgs(chat.id);
  } catch (e) {
    if (!ac.signal.aborted) emit('error', chat.id, e.message || String(e), e.logId);
  } finally {
    busy.delete(chat.id); stops.delete(chat.id); emit('typing', chat.id, false);
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
    cfg: { linkMode: d.linkMode, injectCount: state.apps.chat.injectCount, showRead: false, showThink: false, conn: 'follow', temperature: null, maxSpeakers: 3,
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
export async function requestGroupReply(chat, opts = {}) {
  if (busy.has(chat.id)) return;
  busy.add(chat.id); emit('typing', chat.id, true);
  const ac = new AbortController(); stops.set(chat.id, ac);
  try {
    const msgs = await getMsgs(chat.id);
    const members = chat.members.map(contact).filter(Boolean);
    if (!members.length) throw new Error('群里没有其他人');
    const lastMine = [...msgs].reverse().find(m => m.from === 'me');
    const at = lastMine ? members.filter(p => (lastMine.text || '').includes('@' + nameOf(p))).map(nameOf) : [];
    const memText = members.map(p => `- ${p.name || nameOf(p)}${chat.titles[p.id] ? `（群头衔：${chat.titles[p.id]}）` : ''}${chat.owner === p.id ? '（群主）' : ''}：${charPersona(p).slice(0, 160).replace(/\n/g, ' ')}`).join('\n');
    const story = storyNow(), history = groupHistory(msgs, chat.cfg.hist ?? 30) + (at.length ? `\n（${myName()} 刚才 @ 了：${at.join('、')}）` : '') + (opts.extra ? '\n' + opts.extra : '');
    const t = time.forPrompt(), sid = chatScheme('group', chat.cfg.prompt), wb = await worldBlock(story + '\n' + history, members, 'group', sid);
    const rc = replyCfg(chat);
    const prompt = compose('group', { group: chat.name, members: memText, intro: chat.intro || '（无）', story, ...wb,
      time: t, history, max: chat.cfg.maxSpeakers || 3, voice: `这一轮大家加起来一共发 ${rc.lines[0]}–${rc.lines[1]} 条，${voiceNote(rc)}` }, sid) + (await import('../../core/music.js')).togetherNote(chat) + memNote(chat) + roundNote(rc);
    const raw = await generate({ conn: resolveConn('text', 'chat', chat.cfg.conn), system: specialsGuide(rc), prompt, keep: cacheAt(prompt, history, wb.memory, t), temperature: chat.cfg.temperature ?? undefined, app: opts.extra ? '主动消息' : '群聊', stop: ac.signal });
    const [said, mem] = takeMem(String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')), fresh = !opts.extra && msgs.length && msgs[msgs.length - 1].from === 'me';
    const find = n => { n = String(n || '').trim(); return members.find(p => [p.name, p.nick, p.remark].filter(Boolean).includes(n)); };
    // 贴表情：写在说话那人自己的那行里，一轮最多 3 个；一个都没贴就让第一个说话的人按语气补一个
    let reacted = 0;
    const clean = stripTags(said).split('\n').map(l => { const p = find((/^([^:：]{1,16})[:：]/.exec(l) || [])[1]); return l.replace(RX, (_, e, f) => { if (fresh && p && reacted < 3 && reactTo(msgs, p.id, e, f)) reacted++; return ''; }); }).filter(l => !/^[^:：]{1,16}[:：]\s*$/.test(l.trim())).join('\n');
    const first = find((/^([^:：|｜]{1,16})[:：]/m.exec(clean) || [])[1]);
    if (fresh && !reacted && first) reactTo(msgs, first.id, toneEmoji(msgs[msgs.length - 1].text || '', clean));
    msgs.forEach(m => { if (m.from === 'me') m.read = true; });
    if (reacted || fresh) emit('read', chat.id);
    const batch = uid('b'); let shown = 0, nv = 0;
    keepMem(chat, batch, mem, members);
    for (const raw of toMin(clean.split('\n').map(l => l.trim()).filter(Boolean), rc.lines, l => /^私聊\s*[|｜]/.test(l) ? null : (/^[^:：]{1,16}[:：]\s*/.exec(l) || [null])[0])) {
      if (ac.signal.aborted) break;
      const dm = /^私聊\s*[|｜]\s*([^:：]+)[:：]\s*(.+)$/.exec(raw);
      if (dm) { const p = find(dm[1]); if (p) await deliverDM(p, dm[2]); continue; }
      const mm = /^([^:：]{1,16})[:：]\s*(.+)$/.exec(raw); if (!mm) continue;
      const p = find(mm[1]); if (!p) continue;
      let parsed = parseLine(mm[2].trim());
      if (parsed.type === 'voice') parsed = voiceLimit(rc, parsed, ++nv);
      if (['accept', 'return', 'poke-them'].includes(parsed.type)) {
        if (parsed.type === 'poke-them' && rc.poke) await addSystem(chat, `「${nameOf(p)}」拍了拍你${state.me.pokeSuffix || ''}`);
        continue;
      }
      if (shown) { emit('typing', chat.id, true); await sleep(Math.min(2200, 380 + String(parsed.text || '').length * 60)); }
      const m = { id: uid('m'), from: 'them', who: p.id, ...parsed, batch, ...time.stamp() };
      msgs.push(m); touch(chat, m); chat.lastText = `${nameOf(p)}：${preview(m)}`; shown++;
      if (shell.activeChat !== chat.id || !shell.visible) chat.unread = (chat.unread || 0) + 1;
      saveMsgs(chat.id); commit('chats'); emit('msg', chat.id, m);
      shell.notify({ chatId: chat.id, title: chat.name, text: `${nameOf(p)}：${preview(m)}`, avatarUrl: chat.avatar || p.avatar });
      autoTranslate(chat, m); preVoice(chat, m, rc);
      if (shown >= rc.lines[1]) break;
    }
    if (!shown) await addSystem(chat, '大家好像都在忙，没人回');
  } catch (e) { if (!ac.signal.aborted) emit('error', chat.id, e.message || String(e), e.logId); }
  finally { busy.delete(chat.id); stops.delete(chat.id); emit('typing', chat.id, false); }
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
/** 通话里 TA 接着说：一句一个 { text 原话, zh 中文意思（说的不是中文才有）}，最多 3 句。
 *  边写边给（onUnit）：一句写定了就交出去念，不等整段写完。「译：」那行跟着上一句；一句后面还可能跟「译：」，所以要等到译文那行写完、或下一句开了头才算写定 */
export async function callReply(chat, lines, mode, stop, onUnit = () => {}) {
  const c = contact(chat.contactId), msgs = await getMsgs(chat.id);
  const { prompt } = await buildReplyPrompt(chat, msgs, { full: '', min: 'min' }[chat.cfg.callCtx] ?? 'story');
  const talk = lines.map(l => `${l.who === 'me' ? myName() : nameOf(c)}：${l.text}`).join('\n') || '（刚接通）';
  const p2 = `${prompt}\n\n【你们现在正在${mode === 'video' ? '视频' : '语音'}通话，上面是通话前的聊天】\n通话内容：\n${talk}\n\n请以 ${nameOf(c)} 的身份接着说：用说话的口吻，1~3 句，每句一行，句子短一点；${chat.cfg.callAct === false ? '只写说出口的话，不要写动作、神态，不要用括号' : '可以用（）写一点语气或动作（括号里的不会念出来）'}；不要发特殊消息。正文里 ${nameOf(c)} 的台词是什么语言，就用什么语言说；说的不是中文时，每句下面另起一行，以「译：」开头写这句的中文意思。`;
  const units = []; let sent = 0;
  const read = (raw, done) => {
    const t = String(raw || '').replace(/<(think(?:ing)?|inner|astermem)>[\s\S]*?(<\/\1>|$)/gi, ''), cut = done ? t.length : t.lastIndexOf('\n') + 1, tail = t.slice(cut).trim();
    units.length = 0; let pre = '';
    for (const l of t.slice(0, cut).split('\n').map(x => x.trim().replace(/^[-*•\d.、]+\s*/, '').replace(/^["“「]|["”」]$/g, '')).filter(x => x && !/^[[<]/.test(x))) {
      const zh = /^译\s*[:：]\s*(.*)$/.exec(l);
      if (zh) { if (units.length) units[units.length - 1].zh = zh[1]; }
      else if (/^[（(][^）)]*[）)]$/.test(l)) pre = l;   // 整行只有（动作）：不单算一句，挂到下一句前面
      else if (units.length < 3) { units.push({ text: pre + l, zh: '' }); pre = ''; } else break;
    }
    const ok = done ? units.length : units.length - (units.length && (units[units.length - 1].zh || (tail && !tail.startsWith('译'))) ? 0 : 1);
    while (sent < ok) onUnit(units[sent++]);
  };
  read(await generate({ conn: resolveConn('text', 'chat', chat.cfg.conn), system: '', prompt: p2, temperature: chat.cfg.temperature ?? undefined, app: '通话', stop, onPart: t => read(t, false) }), true);
  return units;
}
/** 重新生成：删掉这条和同一批里它后面的 TA 消息，再要一次 */
export async function regenerate(chat, msgId) {
  const msgs = await getMsgs(chat.id);
  const i = msgs.findIndex(m => m.id === msgId); if (i < 0) return;
  const batch = msgs[i].batch;
  if (batch) dropChat(chat.id, batch).catch(e => log('warn', '岁岁砂', '收不回这批记下的：' + e.message));
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
/* ---------- 正文 → 手机（暗号）：两种联动方式都一样 ----------
 * <asterphone from="谁" group="群名" type="…">内容</asterphone>，core/sync.js 读到后交给 fromStory。
 * 没有 type：内容一行一条，写法和手机里一样（[语音] [图片] [转账] [红包] [名片] [拍一拍] [收下] [退还]），另加 [撤回]、[语音通话] / [视频通话]。
 * type：动态 / 点赞 / 评论（你最新那条动态）/ 加好友 / 拉群。 */
export async function fromStory({ from, body = '', group = '', type = '' }) {
  const c = storyContact(from); if (!c) return;
  if (type === '动态') return momentFromStory(c.name, body);
  if (type === '加歌') return (await import('../../core/music.js')).storyAddSong(c, body);
  if (type === '一起听') { const s = await (await import('../../core/music.js')).storyTogether(c, body); if (s) await addSystem(chatForContact(c.id, true), `${nameOf(c)} 邀请你一起听《${s.name}》`); return; }
  if (type === '点赞' || type === '评论') return reactFromStory(c, type, body);
  if (type === '加好友') { c.cut = ''; commit('contacts'); const chat = chatForContact(c.id, true); await addSystem(chat, `你和「${nameOf(c)}」已经是好友了`); if (body.trim()) await deliverFromStory(c, body); return; }
  if (type === '删好友' || type === '拉黑') { c.cut = type === '删好友' ? 'deleted' : 'blocked'; commit('contacts'); log('info', '聊天', `正文里「${nameOf(c)}」${type === '删好友' ? '把你删了' : '把你拉黑了'}`); return; }   // 和真的一样不提醒，你发消息时才知道
  if (type === '取消拉黑') { if (c.cut === 'blocked') { c.cut = ''; commit('contacts'); } return; }
  if (type === '拉群') return groupFromStory(c, group, body);
  return deliverFromStory(c, body, group);
}
/** 暗号里的人：通讯录里有就用，没有就加进来（直接是好友） */
function storyContact(name) {
  const n = String(name || '').trim(); if (!n) return null;
  let c = state.contacts.find(p => [p.name, p.nick, p.remark].includes(n));
  if (!c) {
    const ch = characters().find(k => k.name === n);
    c = { id: uid('p'), name: n, nick: '', remark: '', gender: '', region: '', sign: '', pokeSuffix: '', avatar: ch ? ch.avatar : '', charKey: ch ? ch.key : '', persona: '', source: ch ? 'card' : 'story', star: false, group: '', createdAt: Date.now() };
    state.contacts.push(c); commit('contacts'); chatForContact(c.id, true).lastAt = Date.now();
    log('info', '聊天', `正文里出现了新联系人「${n}」，已自动加入`);
  }
  return c;
}
/** 正文里提到谁发了动态：放进动态。还不是好友的先只记名字，加了好友就挂到 TA 名下（relinkMoments），在 TA 的动态里看得到 */
export function momentFromStory(name, text) {
  const n = String(name || '').trim(); if (!n || !text) return;
  const c = state.contacts.find(p => [p.name, p.nick, p.remark].includes(n));
  let desc = '';
  const body = String(text).replace(/\[图片[:：]?\s*([^\]]*)\]/g, (_, d) => { desc = d.trim(); return ''; }).trim();
  state.moments.unshift({ id: uid('mo'), author: c ? c.id : '', authorName: n, text: body, imageDesc: desc, images: [], ...time.stamp(), likes: [], comments: [], vis: 'public', fromStory: true });
  commit('moments');
}
export function relinkMoments() {
  for (const mo of state.moments) if (!mo.author && mo.authorName) { const c = state.contacts.find(p => [p.name, p.nick, p.remark].includes(mo.authorName)); if (c) mo.author = c.id; }
}
/** 给你最新那条动态点赞 / 评论 */
function reactFromStory(c, type, text) {
  const mo = state.moments.find(m => m.author === 'me'); if (!mo) return;
  if (type === '点赞') { if (!mo.likes.includes(c.id)) mo.likes.push(c.id); }
  else if (text.trim()) mo.comments.push({ id: uid('cm'), who: c.id, to: null, text: text.trim(), at: Date.now() });
  commit('moments');
  shell.notify({ title: '动态', text: `${nameOf(c)}${type === '点赞' ? '赞了你的动态' : '评论了你的动态：' + text.trim()}`, avatarUrl: c.avatar });
}
/** 拉你进群：群不在就建一个（拉人的当群主），内容写群里还有谁 */
async function groupFromStory(c, name, others) {
  const ids = [c.id, ...String(others).split(/[、，,\s]+/).filter(Boolean).map(n => storyContact(n).id)];
  let g = name && state.chats.find(x => isGroup(x) && x.name === name.trim());
  if (!g) { g = createGroup([...new Set(ids)], name.trim() || undefined); g.owner = c.id; await addSystem(g, `「${nameOf(c)}」邀请你加入了群聊`); }
  else for (const id of new Set(ids)) if (!g.members.includes(id)) { g.members.push(id); await addSystem(g, `「${nameOf(contact(id))}」加入了群聊`); }
  commit('chats');
  shell.notify({ chatId: g.id, title: g.name, text: `「${nameOf(c)}」邀请你加入了群聊`, avatarUrl: c.avatar });
}
/** 暗号里的群名找哪个群：先找同名的，再找名字差不多的（「宿舍」→「宿舍群」），再找有这个人、最近最热闹的群 */
function storyGroup(name, c) {
  const gs = state.chats.filter(isGroup), n = String(name).trim(), core = s => String(s || '').replace(/[群聊\s]/g, '');
  return gs.find(g => g.name === n)
    || (core(n) && gs.find(g => core(g.name) && (core(g.name).includes(core(n)) || core(n).includes(core(g.name)))))
    || gs.filter(g => g.members.includes(c.id)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))[0] || null;
}
/** 我刚发的、还没收的转账 / 红包：对方收下或退还（手机里 TA 回复、正文暗号都走这里） */
async function settleMine(chat, msgs, c, accept) {
  const t = [...msgs].reverse().find(x => x.from === 'me' && (x.type === 'transfer' || x.type === 'packet') && x.status === 'pending');
  if (!t) return;
  t.status = accept ? 'accepted' : 'returned';
  if (!accept) ledger(t.amount, `${nameOf(c)} 退还了${t.type === 'packet' ? '红包' : '转账'}`);
  await addSystem(chat, `${nameOf(c)} ${accept ? '收下了' : '退还了'}你的${t.type === 'packet' ? '红包' : '转账'} ${money(t.amount)}`);
  emit('reload', chat.id);
}
/** 正文里写到有人在手机上给你发东西：一行一条；带 group 且找得到这个群就发在群里，否则发私聊 */
export async function deliverFromStory(c, text, groupName = '') {
  if (!c || !text) return;
  const g = groupName && storyGroup(groupName, c);
  if (g && !g.members.includes(c.id)) { g.members.push(c.id); await addSystem(g, `「${nameOf(c)}」加入了群聊`); }
  const chat = g || chatForContact(c.id, true), msgs = await getMsgs(chat.id);
  if (!g && c.cut) { c.cut = ''; commit('contacts'); }   // TA 又给你发消息了：说明加回来 / 解除拉黑了
  for (const line of String(text).split('\n').map(l => l.trim()).filter(Boolean)) {
    const call = /^[\[【]\s*(语音|视频)通话\s*[\]】]/.exec(line);
    if (call) { const dm = chatForContact(c.id, true); import('./specials.js').then(S => S.ringIn(dm, c, call[1] === '视频' ? 'video' : 'voice')); continue; }
    if (/^[\[【]\s*撤回\s*[\]】]/.test(line)) {
      const last = [...msgs].reverse().find(m => m.from === 'them' && !m.recalled && (!g || m.who === c.id));
      if (last) { last.recalled = true; if (msgs[msgs.length - 1] === last) chat.lastText = preview(last); emit('reload', chat.id); }
      continue;
    }
    const p = parseLine(line);
    if (p.type === 'accept' || p.type === 'return') { await settleMine(chat, msgs, c, p.type === 'accept'); continue; }
    if (p.type === 'poke-them') { await addSystem(chat, `「${nameOf(c)}」拍了拍你${state.me.pokeSuffix || ''}`, { pokeMe: true }); continue; }
    const m = { id: uid('m'), from: 'them', ...(g ? { who: c.id } : {}), ...p, fromStory: true, ...time.stamp() };
    msgs.push(m); touch(chat, m); if (g) chat.lastText = `${nameOf(c)}：${preview(m)}`;
    if (shell.activeChat !== chat.id || !shell.visible) chat.unread = (chat.unread || 0) + 1;
    emit('msg', chat.id, m);
    shell.notify({ chatId: chat.id, title: g ? g.name : nameOf(c), text: (g ? nameOf(c) + '：' : '') + preview(m), avatarUrl: g ? (g.avatar || c.avatar) : avatarOf(c, chat) });
    preVoice(chat, m, replyCfg(chat));
  }
  saveMsgs(chat.id); commit('chats');
}

/* ---------- 动态 ---------- */
/** 一次找 AI 发几条动态（作者定的：点一下只调一次）。must：一定要发的人；only：只让他们发 */
export async function genMoments({ count, must = [], only = false }, stop) {
  const pool = only ? must.map(contact).filter(Boolean) : [...must.map(contact).filter(Boolean), ...[...state.contacts].filter(c => !must.includes(c.id)).sort(() => Math.random() - .5)].slice(0, Math.max(15, must.length));
  const story = storyText(Math.min(4, ctxCfg().count)) || '（暂无）';
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '动态', stop,
    prompt: compose('moment', { count, posters: pool.map(c => `- ${c.name || nameOf(c)}：${charPersona(c).slice(0, 300).replace(/\n/g, ' ')}`).join('\n'), story, world: (await worldBlock(story, pool)).world, time: time.forPrompt(),
      pick: must.length ? `\n【这次】${only ? '只能由这些人发' : '这些人每人至少发一条'}：${must.map(id => nameOf(contact(id))).join('、')}` : '' }) });
  const find = n => pool.find(c => [c.name, c.nick, c.remark, nameOf(c)].filter(Boolean).includes(n.trim()));
  const out = []; let cur = null;
  for (const l of stripTags(String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')).split('\n').map(x => x.trim()).filter(Boolean)) {
    const pic = /^\[图片[:：]\s*([^\]]+)\]$/.exec(l), nm = /^([^:：[\]]{1,16})[:：]\s*(.+)$/.exec(l), c = nm && find(nm[1]);
    if (pic) { if (cur) cur.imageDesc = pic[1].trim(); }
    else if (/^\[屏蔽/.test(l)) { if (cur) cur.hiddenFromMe = true; }
    else if (c) out.push(cur = { id: uid('mo'), author: c.id, text: nm[2].trim(), imageDesc: '', images: [], ...time.stamp(), likes: [], comments: [], vis: 'public', hiddenFromMe: false });
    else if (nm) cur = null;   // 不在名单里的人（只让选中的人发时）：这条连同它的配图都不要
    else if (cur) cur.text += ' ' + l;
  }
  if (!out.length) throw new Error('AI 没有按格式写动态');
  state.moments.unshift(...out.slice(0, count)); commit('moments');
  return Math.min(out.length, count);
}
export async function genComments(mo, stop) {
  const author = mo.author === 'me' ? myName() : nameOf(contact(mo.author));
  const people = state.contacts.filter(p => p.id !== mo.author && canSee(mo, p.id)).slice(0, 12);
  if (!people.length) throw new Error('还没有其他联系人可以来评论');
  const post = [`${author}：${mo.text}${mo.imageDesc ? `（配图：${mo.imageDesc}）` : ''}`,
    ...mo.comments.map(cm => `${who(cm.who)}${cm.to ? ' 回复 ' + who(cm.to) : ''}：${cm.text}`),
    mo.likes.length ? `已点赞：${mo.likes.map(who).join('、')}` : ''].filter(Boolean).join('\n');
  const peopleText = people.map(p => `- ${p.name || nameOf(p)}${personaOf(p) ? '：' + personaOf(p).slice(0, 80).replace(/\n/g, ' ') : ''}`).join('\n');
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '动态', stop, prompt: compose('comment', { post, people: peopleText, time: time.forPrompt() }) });
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
export { chatOf };
