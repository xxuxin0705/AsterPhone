// 聊天的「发动机」：发消息、让 TA 回复、重新生成、收到剧情里的消息。
// 页面只管显示，真正改数据的都在这里；改完会通知页面刷新。
import { uid, sleep } from '../../core/util.js';
import { state, commit, kvSet, contact, chatOf, chatForContact, getMsgs, saveMsgs, isFriend, friends, befriend, nickOf } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { characters, stripTags } from '../../core/bridge.js';
import { C as ctxCfg, storyText, worldText } from '../../core/context.js';
import { memoryFor, fromChat, dropChat, lineNames, bigNames } from '../../core/memory.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { compose, myName, myPersona, chatScheme, myAvatar, blocksIn } from '../../core/promptstore.js';
import { previewOf, forAI, parseLine, specialsGuide, voiceNote, money } from './msgtypes.js';
import { translate, langName, langFor, zhOf, fillZh, myLang, myOut } from '../../core/translate.js';
import { colorFor } from '../../core/ui.js';
import { photoBook, urlOf, keyOf } from '../../core/photos.js';

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
  if (!chat.cfg.autoTr || !canTr(m) || m.tr) return;
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
function voiceLimit(rc, p, n) { return p.type === 'voice' && n > rc.voice[1] ? { type: 'text', text: p.text, tr: p.tr } : p; }
/* 说外语的 TA：私聊设置里「TA 说的语言」（没选就跟着聊天 App 的、再跟着设置里总的）是外语，AI 先写中文、后面紧跟 [原文:外文]（中文写在前面才不会漏；以前的「外文 [翻译:中文]」也认），
   拿下来放进 m.tr（显示在气泡下面），不用再另翻一遍。群聊、动态、评论按每个人自己私聊里设的语言 */
export const speakOf = id => { const ch = state.chats.find(x => !isGroup(x) && x.contactId === id), l = langFor('chat', ch && ch.cfg.speak); return l !== 'zh-CN' ? l : ''; };
// 外语那句话怎么写（各处提示词共用这一句）
export const trHow = lang => `写成「中文意思[原文：${lang}原文]」：先写中文，后面紧跟原文，两样都要有`;   // lang：「日语」这样的名字
export const takeTr = l => { l = parenTr(l);
  const o = /\s*[\[【]\s*原文\s*[:：]([^\]】]*)[\]】]\s*$/.exec(l);   // 「[语音] 中文[原文：外文]」→ 正文是「[语音] 外文」，中文是翻译
  if (o) { const zh = l.slice(0, o.index), tag = /^\s*((?:[\[【][^\]】]*[\]】]\s*)*)/.exec(zh)[1]; return [tag + o[1].trim(), zh.slice(tag.length).trim()]; }
  const t = /\s*[\[【]\s*翻译\s*[:：]([^\]】]*)[\]】]\s*$/.exec(l); return t ? [l.slice(0, t.index).trim(), t[1].trim()] : [l, '']; };
// AI 有时不照格式，把翻译写成末尾的「（中文）」：前面是外文（有假名 / 谚文，或者全是字母没有汉字）、括号里是两个字以上的中文（没有假名）才算，换成 [翻译：…]
export const parenTr = s => typeof s !== 'string' || /[[［【]翻译[:：]/.test(s) ? s : s.split(/(?<!:)\/\//).map(p => {
  const m = /^([\s\S]+?)\s*[（(]([^（）()]+)[）)]\s*$/.exec(p);
  const foreign = a => /[\u3040-\u30ff\uac00-\ud7af]/.test(a) || (!/[\u4e00-\u9fff]/.test(a) && /[A-Za-z]{2}/.test(a));
  return m && foreign(m[1]) && /[\u4e00-\u9fff].*[\u4e00-\u9fff]/.test(m[2]) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(m[2]) ? `${m[1]}[翻译：${m[2]}]` : p; }).join('//');
/** 说外语的人写的这几行里，AI 漏了中文的（普通的话、[语音]）并成一次免费机翻补上（zhOf），不找 AI。head(l)：这行前面「名字：」那一截，不用查的行给 null */
async function fillLines(lines, head = () => '') {
  const L = lines.flatMap((l, i) => { const hd = head(l); if (hd == null) return []; const [t, tr] = takeTr(l.slice(hd.length)), p = parseLine(t); return !tr && ['text', 'voice'].includes(p.type) && /\p{L}/u.test(p.text) ? [[i, p.text]] : []; });
  if (L.length) (await zhOf(L.map(x => x[1]))).forEach((z, k) => { if (z) lines[L[k][0]] += ` [翻译:${z}]`; });
}
const langRule = (ids, what) => { const fo = ids.map(id => [id, speakOf(id)]).filter(x => x[1]); return fo.length ? `\n${fo.map(([id, l]) => `${nameOf(contact(id))}（${langName(l)}）`).join('、')}${what}都${trHow('自己语言的')}；表情包、图片这些方括号标签照原样写，不用翻。${fo.length < ids.length ? '其他人照常写中文。' : ''}` : ''; };
/** 提示词最末尾再提一句条数（离结尾越近小模型越听） */
const roundNote = rc => `\n\n【这一轮】${rc.group ? '大家加起来' : ''}回复 ${rc.lines[0]}–${rc.lines[1]} 条独立消息，每条单独一行；${rc.voice[1] ? `语音 ${rc.voice[0]}–${rc.voice[1]} 条` : '不发语音'}。`;
/** 条数不够下限：把长的话按句子拆成几条（括号、引号里的不拆，太短的并回去），拆到够数或拆不动为止；不多调一次 AI。head：每条前面要留着的（群聊的「名字：」），给 null 的那行不拆 */
function toMin(lines, [min, max], head = () => '') {
  for (const short of [6, 2]) {
    if (lines.length >= min) break;
    let room = max - lines.length;
    lines = lines.flatMap(l => {
      const hd = head(l);
      if (room <= 0 || hd == null || /^\s*\[/.test(l.slice(hd.length)) || /[\[【]\s*(翻译|原文)/.test(l)) return [l];
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
/* 角色给消息贴表情：AI 写 [表情回应:😂] 或 [表情回应:😂|那句话里的几个字]；
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
export const nameOf = c => (c && (c.remark || nickOf(c, 'chat') || c.name)) || '联系人';
export function personaOf(c) {
  if (!c) return '';
  if (c.loreText) return `${c.loreText}\n（这个设定里可能写了好几个人，你只扮演其中的「${c.name}」。）${c.persona ? '\n' + c.persona : ''}`;
  if (c.persona) return c.persona;
  if (c.charKey) { const ch = characters().find(k => k.key === c.charKey); if (ch) return ch.persona; }
  return '';
}
export function avatarOf(c, chat) { return (chat && chat.cfg.theirAvatar) || (c && c.avatar) || ''; }
// 印象色：共用的备忘录里谁写的就涂谁的颜色。映像里挑过就用挑的；没挑过用 TA 回共用备忘录时自己定的（inkAI）；还没定就先从头像里取最显眼的颜色（取一次记着，换了头像再取），没头像按名字分；你自己默认黄色
const inkKey = c => { const u = avatarOf(c); return u && u.length + u.slice(-48); };
export const inkOf = c => (c === state.me ? state.me.ink || '#ffd60a' : c.ink || c.inkAI || (c.inkAuto?.[0] === inkKey(c) && c.inkAuto[1]) || colorFor(nameOf(c)));
const hsv = hex => { const n = parseInt(String(hex).slice(1, 7), 16), r = n >> 16, g = n >> 8 & 255, b = n & 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  return [!d ? 0 : (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60, mx ? d / mx : 0, mx]; };
/** 头像里最显眼的颜色：缩成 24×24，太灰、太暗的点不算，按色相分 12 堆，最重的那堆取平均；返回换没换 */
export async function autoInk(c) {
  const k = inkKey(c); if (!k || c.ink || c.inkAI || c.inkAuto?.[0] === k) return false;
  const im = new Image(); im.crossOrigin = 'anonymous'; im.src = avatarOf(c); await im.decode();
  const x = Object.assign(document.createElement('canvas'), { width: 24, height: 24 }).getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data, B = Array.from({ length: 12 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < d.length; i += 4) { const [hh, sa, v] = hsv('#' + [d[i], d[i + 1], d[i + 2]].map(y => y.toString(16).padStart(2, '0')).join(''));
    if (sa < .25 || v < 60 || d[i + 3] < 200) continue; const w = sa * v, q = B[Math.floor(hh / 30) % 12]; q[0] += d[i] * w; q[1] += d[i + 1] * w; q[2] += d[i + 2] * w; q[3] += w; }
  const top = B.reduce((a, b) => (b[3] > a[3] ? b : a));
  c.inkAuto = [k, top[3] ? '#' + top.slice(0, 3).map(y => Math.round(y / top[3]).toString(16).padStart(2, '0')).join('') : colorFor(nameOf(c))]; commit('contacts'); return true;
}
/** 共用的几个人各自的颜色：[你, 第一个人, 第二个人…]。和前面谁太像（色相差不到 40 度，或者都是灰的）就把这个人的转开一截，一眼分得清 */
let nx = null;
const toHex = c => { nx ||= document.createElement('canvas').getContext('2d'); nx.fillStyle = '#000'; nx.fillStyle = c; return nx.fillStyle; };
const near = (a, b) => { const [h1, s1] = hsv(a), [h2, s2] = hsv(b), gap = Math.abs(h1 - h2) % 360; return s1 < .2 === s2 < .2 && (s1 < .2 || Math.min(gap, 360 - gap) < 40); };
export function inksFor(cs) {
  const out = [inkOf(state.me)];
  for (const c of cs) { const k0 = inkOf(c), [h, sa, v] = hsv(k0); let k = k0;
    for (let t = 1; t < 6 && out.some(o => near(o, k)); t++) k = toHex(`hsl(${(h + 180 + (t - 1) * 60) % 360} ${sa < .2 ? 60 : Math.round(sa * 80)}% ${Math.round(Math.min(.6, v / 255) * 100)}%)`);
    out.push(k); }
  return out;
}
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
/** 我的话发成什么语言：这个聊天开了「翻成 TA 的语言」就照 TA 的，不然照映像里我说的语言；'' 是不翻 */
export const sendLang = chat => (chat.cfg.sendTr ? (isGroup(chat) ? chat.cfg.theirLang : speakOf(chat.contactId)) : myLang());
export async function send(chat, text, extra = {}) {
  const msgs = await getMsgs(chat.id), [t, o] = await myOut(text, sendLang(chat));
  if (o) { extra = { ...extra, orig: o }; text = t; }
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
export function historyText(msgs, c, n = 24) {
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
export async function worldBlock(scan, people = [], cat, sid, noBook, app = 'chat') {
  const w = noBook ? '' : await worldText(scan, people, app).catch(() => ''), [m, r] = await memoryFor(people.filter(Boolean), scan).catch(e => { log('warn', '岁岁砂', '读不到记忆：' + e.message); return ['', '']; });
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
// 你和 TA 共用的备忘录（apps/memo，一行 = [共用, 标题, 日期, TA 的名字, 正文, TA 的 id]）：私聊时 TA 看得到；
// TA 回复里单独一行「[备忘录] 标题｜内容」就是往里添了一行，没有这个标题就新开一张。搭在本来的回复上，不另外找 AI
// 印象色：TA 第一次在共用的备忘录里回你时顺便定的（不另外找 AI），定了就一直用；映像里能改（改了的优先）
const INK = /^[ \t]*[\[【]\s*印象色\s*[\]】][ \t]*(#[0-9a-fA-F]{6})[ \t]*$/m;
const MEMO = /^[ \t]*[\[【]\s*备忘录\s*[\]】][ \t]*([^｜|\n]+)[｜|]([^\n]+)$/gm, sharedNotes = c => state.notes.filter(r => r[0] === '共用' && sharedWith(r).includes(c.id)).map(fixInk);
// 共用的备忘录：第六格是和谁共用（几个人用逗号隔开的 id），第十二格是谁建的（me 或 TA 的 id），第十格是哪几个人看过那张画
export const sharedWith = r => String(r[5] || '').split(',').filter(Boolean);
// 画是正文里单独的一行「✎memo-draw:编号」（共用的前面照样是「谁：」），和字一样按先后排；第十格记谁看过哪张。
// 以前的画存在第九格、没在正文里：用到时挪进正文（共用的放在你写的最后一行后面）
export const INKLINE = /✎(memo-draw:\S+)$/, drawn = r => (r[4] || '').split('//').map(x => INKLINE.exec(x)?.[1]).filter(Boolean);
const seen = r => String(r[9] || '').split(',').filter(x => x.startsWith('+'));   // 「+TA 的 id>编号」：真发出去了才记（以前没加 + 的不算，那会儿没发出去也记成看过了）
export function fixInk(r) {
  if (!r[8]) return r;
  const L = r[4] ? r[4].split('//') : [], me = r[0] === '共用' ? myName() + '：' : '', key = r[8];
  if (!L.some(x => x.endsWith('✎' + key))) { let i = me ? 0 : L.length; if (me) L.forEach((x, k) => { if (x.startsWith(me)) i = k + 1; }); L.splice(i, 0, me + '✎' + key); r[4] = L.join('//'); }
  r[9] = r[9] ? (r[9] === 1 ? sharedWith(r) : String(r[9]).split(',').filter(x => x && !x.includes('>'))).map(id => id + '>' + key).join(',') : '';
  r[8] = ''; return r;
}
/** 共用的备忘录里 TA 还没看过的画：[[备忘录, 那一行, 编号]…]；inkImages 拿去给 AI 看，sawInks 在 AI 回完之后记下看过了（私聊、查手机都用） */
export const newInks = c => sharedNotes(c).flatMap(r => r[4].split('//').map(x => [r, x, INKLINE.exec(x)?.[1]]).filter(([q, , k]) => k && !seen(q).includes(`+${c.id}>${k}`)));
export async function inkImages(L) {
  if (!L.length) return [];
  const { inkPic, inkGrid } = await import('../memo/draw.js');
  return (await Promise.all(L.map(async ([r, x, k]) => ({ text: `（${(/^([^：:]{1,12})[：:]/.exec(x) || [, myName()])[1]} 在你们共用的备忘录《${takeTr(r[1] || '')[0]}》里${k.startsWith('memo-draw:pic') ? '放的照片，看看是什么，想回应就照照片里真有的来说' : '画的，看看画的什么，想回应就照画里真画了什么来说'}）`,
    url: await inkPic(k).catch(e => (log('warn', '聊天', '共用备忘录里的画读不出来：' + e.message), '')), alt: k.startsWith('memo-draw:pic') ? '' : await inkGrid(k).catch(() => '') })))).filter(i => i.url);
}
// images：发给 generate 的那份，图没发出去（走酒馆的连接、模型不认图）时 generate 会把它清空，那就不算看过
export function sawInks(c, L, images) { if (!L.length || !(images.length || images.asText)) return; L.forEach(([r, , k]) => { r[9] = [...seen(r), `+${c.id}>${k}`].join(','); }); commit('notes'); }
export const inkText = x => x.replace(/✎memo-draw:(pic)?\S+$/, (_, p) => (p ? '（放了一张照片）' : '（画了一幅画）'));   // 给 AI 看的字里，画写成一句话
// 第七格 1 = TA 添了你还没看过：那一条前面、桌面备忘录图标上挂红点，点开就消掉（apps/memo）
// TA 指的是哪一张：写的是编号（提示词里每张前面标了，最稳），或者标题（外语的写中文那半、TA 自己翻过的标题也认）
export const noteOf = (c, t) => { const L = sharedNotes(c), k = String(t).replace(/[《》#.、\s]/g, ''), tt = takeTr(String(t).trim()).filter(Boolean);
  return /^\d+$/.test(k) && L[k - 1] || L.find(r => takeTr(r[1]).some(y => y && tt.includes(y))); };
// TA 画给你的画：AI 在那句话后面写一张 svg。下面是教它怎么画得好看（共用备忘录的私聊、查手机都带这一段）
export const drawTip = me => `\n想画给 ${me} 看的时候（回 ${me} 的画，或者自己想画点什么；不用每次都画），在那句话后面接着写一张 <svg viewBox="0 0 400 300">…</svg>，整张写在同一行，一句最多一张。要画得像在手机备忘录里用手指随手画的，和 ${me} 的画是一套：黑色钢笔勾线（fill="none" stroke="#000" stroke-width="3"，stroke-linecap 和 stroke-linejoin 都写 round）；想上颜色，就像荧光笔那样涂一块（只写 fill 颜色、不描边，手机会自动调淡）；眼睛、小点用黑色实心的小圆。画好看的办法：先想好画什么、摆在哪，主体占画面六七成，四周留白；线条用 path 的弧线（C、Q）一笔画顺，别用一截截直线拼；先画大轮廓，再画五官和小装饰；颜色两三种就够；不写字，不用渐变、滤镜和图片，二三十笔就够。`;
// AI 写的 svg 只留画图用的形状和颜色（脚本、链接、外面的图、滤镜都丢掉），再罩一层轻轻的抖动，线条像手指画的；svg 写成好几行的先并成一行（备忘录一句只认一行）
const SVGTAG = /^(g|path|circle|ellipse|rect|line|polyline|polygon)$/, SVGATT = /^(d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|opacity|fill-opacity|stroke-opacity|fill-rule|transform)$/;
export const oneLineSvg = t => String(t).replace(/<svg[\s\S]*?<\/svg>/gi, m => m.replace(/\s*\n\s*/g, ' '));
function cleanSvg(src) {
  const root = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement, NS = 'http://www.w3.org/2000/svg';
  if (root.nodeName !== 'svg') return '';
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number), [, , w, hh] = vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0 ? vb : [0, 0, 400, 300];
  const out = document.createElementNS(NS, 'svg'), g = document.createElementNS(NS, 'g'); let n = 0;
  out.setAttribute('viewBox', vb.length === 4 && vb.every(isFinite) ? vb.join(' ') : '0 0 400 300'); out.setAttribute('width', w); out.setAttribute('height', hh);
  out.innerHTML = '<filter id="wob"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter>';
  const ok = (k, v) => SVGATT.test(k) && !/url|javascript|[<>&]/i.test(v);
  const copy = (from, to) => { for (const k of from.children) { if (!SVGTAG.test(k.nodeName) || ++n > 400) continue; const e = document.createElementNS(NS, k.nodeName);
    for (const a of k.attributes) if (ok(a.name, a.value)) e.setAttribute(a.name, a.value);
    for (const d of (k.getAttribute('style') || '').split(';')) { const [a, v] = d.split(':').map(y => y && y.trim()); if (a && v && ok(a, v)) e.setAttribute(a, v); }
    pen(e); to.append(e); copy(k, e); } };
  // 和你画的是一套：描边都换成黑色钢笔那么粗；深色的填色（眼睛、小点）是实心黑，别的颜色当荧光笔，调淡
  const lum = c => { const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(c || ''); if (!m) return /^black$/i.test(c) ? 0 : 1; const x = m[1].length === 3 ? [...m[1]].map(y => y + y) : m[1].match(/../g); return x.reduce((a, y, i) => a + parseInt(y, 16) / 255 * [.3, .59, .11][i], 0); };
  const pen = e => { const st = e.getAttribute('stroke'), fi = e.getAttribute('fill');
    if (st && st !== 'none') { e.setAttribute('stroke', '#000'); e.setAttribute('stroke-width', 3); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); e.removeAttribute('stroke-opacity'); }
    if (fi && fi !== 'none') { if (lum(fi) < .3) { e.setAttribute('fill', '#000'); e.removeAttribute('fill-opacity'); } else e.setAttribute('fill-opacity', .35); } };
  copy(root, g); g.setAttribute('filter', 'url(#wob)'); out.append(g);
  return n ? new XMLSerializer().serializeToString(out) : '';
}
export async function memoAdd(c, t, x, batch) {   // batch：私聊里那一批回复（重新生成那条回复时，它添的这句跟着去掉）   // TA 说外语的：这一行也要带中文（AI 没写就机翻补上），备忘录里点「译」才换得过来
  const self = new RegExp(`^\\s*(${[c.name, c.nick, c.remark, nameOf(c)].filter(Boolean).map(escRe).join('|')})\\s*[:：]\\s*`);   // AI 自己在前面又写了一遍名字：去掉，不然成了「名字：名字：」
  const svg = cleanSvg((/<svg[\s\S]*?<\/svg>/i.exec(x) || [''])[0] || '<x/>');   // TA 画的画：抽出来，在这句话下面单独成一行（一句最多一张）
  let [o, z] = takeTr(x.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').trim()).map(y => y && y.trim().replace(self, '')); if (o && !z && speakOf(c.id)) z = (await zhOf([o]))[0];
  const k = svg && 'memo-draw:svg' + uid('d'), drew = svg && await kvSet(k, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)).then(() => true, e => log('warn', '备忘录', `${nameOf(c)} 画的画没存上：${e.message}`));
  if (!o && !drew) return;
  const now = time.stampText(time.stamp()), r = noteOf(c, t), n = r || Object.assign(['共用', t.trim(), now, nameOf(c), '', c.id], { 11: c.id });
  const add = line => { n[4] += (n[4] ? '//' : '') + line; if (batch) (n[12] ||= []).push([batch, line]); };   // 第十三格：哪一句是私聊里哪一批回复添的
  if (o) add(`${nameOf(c)}：${z ? `${o}[翻译：${z}]` : o}`);
  if (drew) { add(`${nameOf(c)}：✎${k}`); n[9] = [...seen(n), `+${c.id}>${k}`].join(','); }   // TA 自己画的不用再拿给 TA 看
  n[2] = now; n[6] = 1;
  if (!r) state.notes.push(n);
  commit('notes'); shell.refreshBadges();
}
const memoNote = (c, msgs) => { const L = c ? sharedNotes(c) : [];
  return c && (L.length || /记一下|记下|帮我记|备忘/.test(lastMine(msgs))) ? `\n\n【你和 ${myName()} 共用的备忘录】（你们俩都看得到、都能写）\n${L.map((r, i) => { const also = r[3].split('、').filter(n => n !== nameOf(c)); return `${i + 1}.《${r[1]}》${also.length ? `（还和 ${also.join('、')} 一起记）` : ''}\n${r[4].split('//').map(inkText).join('\n')}`; }).join('\n') || '（还没有）'}\n想往里添一行，或者 ${myName()} 让你帮忙记点什么，就在回复里另外单独写一行：[备忘录] 编号｜要记的那句话${speakOf(c.id) ? `（那句话也${trHow(langName(speakOf(c.id)))}）` : ''}。添进上面已有的那张，就写它前面的编号（同一件事都记在同一张里，别另开）；真要新开一张，才把编号换成新标题。没什么要记的就不写这一行。${drawTip(myName())}${L.length && !c.ink && !c.inkAI ? `\n另外给自己定一个代表色（印象色，照你的人设和样子，比如发色、瞳色、给人的感觉），在回复最后单独写一行：[印象色] #六位十六进制颜色。只要这一次。` : ''}` : ''; };
/** lite（通话用，带得少 AI 开口才快）：'story' 正文只带最后一段；'min' 再连世界书也不带；不写就是全带 */
export async function buildReplyPrompt(chat, msgs, lite) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const rc = replyCfg(chat), [min, max] = rc.lines;
  const all = storyNow(), cut = all.slice(-1500), story = lite && all.length > 1500 ? '…' + cut.slice(cut.indexOf('\n') + 1) : all;
  const history = historyText(c ? [...msgs, ...state.calls.filter(x => x.cid === c.id)].sort((a, b) => a.at - b.at) : msgs, c, cfg.hist ?? 30), t = time.forPrompt(), sid = chatScheme('dm', cfg.prompt), wb = await worldBlock(story + '\n' + history, [c], 'dm', sid, lite === 'min');
  const prompt = compose('dm', {
    char: c ? (c.name || nameOf(c)) : 'TA', persona: charPersona(c), user_persona: userPersonaText(),
    story, ...wb, time: t, history, min, max, voice: voiceNote(rc), last: lastMine(msgs), lang: c && speakOf(c.id) ? `\n- 每条文字和语音都${trHow(langName(speakOf(c.id)))}（语音是「[语音] 中文意思[原文：…]」）；表情包、图片这些方括号标签照原样写，不用翻。` : '',
  }, sid);
  // 通话用的（lite）不带照片：要的是快
  const book = c && !lite ? await photoBook([c], 10) : null, pics = book && book.line(c.id) ? `\n\n【你手机里的照片】${book.line(c.id)}\n（要发图时，先想好要发什么，有正好对得上的就写「[图片]#编号」发那张；没有就算了，确实新拍了才写新的画面，别为了发照片硬找话题）` : '';
  return { system: specialsGuide(rc), prompt: prompt + memoNote(c, msgs) + pics, keep: cacheAt(prompt, history, wb.memory, t), book };
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
    // 共用的备忘录里新画的（第十格里还没记 TA 看过）：图跟着这次回复一起给 TA 看，看过就不再带（模型得认图片）
    const pics = c ? newInks(c) : [], images = await inkImages(pics);
    const raw = await generate({ conn, system, prompt, keep: built.keep, temperature: chat.cfg.temperature ?? undefined, app: opts.extra ? '主动消息' : '聊天', stop: ac.signal, images });
    sawInks(c, pics, images);
    const fresh = !opts.extra && msgs.length && msgs[msgs.length - 1].from === 'me';   // 你刚说了话（主动找你的那种不贴）
    let reacted = 0;
    const memos = [], [said0, mem] = takeMem(oneLineSvg(raw)), said = said0.replace(RX, (_, e, f) => { if (fresh && !reacted && c && reactTo(msgs, c.id, e, f)) reacted++; return ''; }).replace(MEMO, (_, t, x) => { memos.push([t, x]); return ''; }).replace(INK, (_, k) => { if (c && !c.inkAI) { c.inkAI = k.toLowerCase(); commit('contacts'); } return ''; })
      .replace(/<svg[\s\S]*?<\/svg>/gi, m => { if (memos.length) memos.at(-1)[1] += m; return ''; });   // 画单独写在了下一行：算进上面那句备忘录，别发到聊天里
    const { lines: got, inner } = parseReply(said, c), lines = toMin(got, replyCfg(chat).lines);
    if (fresh && !reacted && c) reactTo(msgs, c.id, toneEmoji(msgs[msgs.length - 1].text || '', lines.join(' ')));
    if (!lines.length) throw new Error('AI 没有返回能用的消息');
    msgs.forEach(m => { if (m.from === 'me') m.read = true; });
    saveMsgs(chat.id); emit('read', chat.id);
    const batch = uid('b'), rc = replyCfg(chat);
    keepMem(chat, batch, mem, [c].filter(Boolean));
    if (c && speakOf(c.id)) await fillLines(lines);
    if (c) for (const [t, x] of memos) await memoAdd(c, t, x, batch);
    if (pics.length && (images.length || images.asText)) inkSent.set(chat.id, [batch, pics.map(([r, , k]) => [r, `+${c.id}>${k}`])]);   // 重新生成这批回复时，这次给看的画算没看过
    let shown = 0, first = true, nv = 0;
    for (const line of lines) {
      if (shown >= rc.lines[1] || ac.signal.aborted) break;
      const [ln, tr] = takeTr(line);
      let p = parseLine(ln); if (tr) p.tr = tr;
      if (p.type === 'image' && /^#/.test(p.text)) { const x = built.book && built.book.pick(p.text); if (!x) continue; p = { type: 'image', text: x.what, ...(x.en && { en: x.en }), ...(x.key && { pk: x.key }) }; const u = await urlOf(x); if (u) p.src = u; }   // 发的是照片库里的旧照片
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
      time: t, history, max: chat.cfg.maxSpeakers || 3, voice: `这一轮大家加起来一共发 ${rc.lines[0]}–${rc.lines[1]} 条，${voiceNote(rc)}`, lang: langRule(chat.members, '说话') }, sid) + (await import('../../core/music.js')).togetherNote(chat) + memNote(chat) + roundNote(rc);
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
    const rows = toMin(clean.split('\n').map(l => l.trim()).filter(Boolean), rc.lines, l => /^私聊\s*[|｜]/.test(l) ? null : (/^[^:：]{1,16}[:：]\s*/.exec(l) || [null])[0]);
    await fillLines(rows, l => { const m = /^([^:：|｜]{1,16})[:：]\s*/.exec(l), p = m && find(m[1]); return p && speakOf(p.id) ? m[0] : null; });
    for (const raw of rows) {
      if (ac.signal.aborted) break;
      const dm = /^私聊\s*[|｜]\s*([^:：]+)[:：]\s*(.+)$/.exec(raw);
      if (dm) { const p = find(dm[1]); if (p) await deliverDM(p, dm[2]); continue; }
      const mm = /^([^:：]{1,16})[:：]\s*(.+)$/.exec(raw); if (!mm) continue;
      const p = find(mm[1]); if (!p) continue;
      const [ln, tr] = takeTr(mm[2].trim());
      let parsed = parseLine(ln); if (tr) parsed.tr = tr;
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
// 重新生成一批回复：它往共用备忘录里添的句子去掉，这次给 TA 看过的画算没看过（新回复会重新看）
const inkSent = new Map();
function unsayBatch(chat, batch) {
  let hit = 0;
  for (const r of state.notes) { const drop = (r[12] || []).filter(x => x[0] === batch).map(x => x[1]); if (!drop.length) continue;
    const L = r[4].split('//'); drop.forEach(l => { const i = L.lastIndexOf(l); if (i >= 0) L.splice(i, 1); }); r[4] = L.join('//'); r[12] = r[12].filter(x => x[0] !== batch); hit++; }
  for (let i = state.notes.length; i--;) if (state.notes[i][0] === '共用' && !state.notes[i][4]) state.notes.splice(i, 1);   // 这批回复新建的那张，句子去掉就空了：整张不要
  const s = inkSent.get(chat.id); if (s && s[0] === batch) { s[1].forEach(([r, m]) => { r[9] = String(r[9] || '').split(',').filter(x => x && x !== m).join(','); }); inkSent.delete(chat.id); hit++; }
  if (hit) commit('notes');
}
/** 重新生成：删掉这条和同一批里它后面的 TA 消息，再要一次 */
export async function regenerate(chat, msgId) {
  const msgs = await getMsgs(chat.id);
  const i = msgs.findIndex(m => m.id === msgId); if (i < 0) return;
  const batch = msgs[i].batch;
  if (batch) { dropChat(chat.id, batch).catch(e => log('warn', '岁岁砂', '收不回这批记下的：' + e.message)); unsayBatch(chat, batch); }
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
 * 没有 type：内容一行一条，写法和手机里一样（[语音] [图片] [转账] [红包] [名片] [拍一拍] [收下] [退还]），另加 [撤回]、[电话] / [语音通话] / [视频通话]（后面可跟没接时的留言）。
 * type：动态 / 点赞 / 评论（你最新那条动态）/ 加好友 / 拉群。 */
export async function fromStory({ from, body = '', group = '', type = '' }) {
  if (type === '短信') return (await import('../sms/sms.js')).receive(from, body);
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
  } else if (!isFriend(c)) { befriend(c); commit('contacts'); log('info', '聊天', `正文里出现了映像里的「${n}」，已加进联系人`); }
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
    const call = /^[\[【]\s*(语音通话|视频通话|电话)\s*[\]】]\s*(.*)$/.exec(line);
    if (call) { const dm = chatForContact(c.id, true), vm = call[2] && takeTr(call[2]); if (vm && !vm[1] && speakOf(c.id)) vm[1] = (await zhOf([vm[0]]))[0]; import('./specials.js').then(S => S.ringIn(dm, c, { 视频通话: 'video', 电话: 'phone' }[call[1]] || 'voice', vm)); continue; }
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
  const pool = only ? must.map(contact).filter(Boolean) : [...must.map(contact).filter(Boolean), ...friends().filter(c => !must.includes(c.id)).sort(() => Math.random() - .5)].slice(0, Math.max(15, must.length));
  const story = storyText(Math.min(4, ctxCfg().count)) || '（暂无）', book = await photoBook(pool);
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '动态', stop,
    prompt: compose('moment', { count, posters: pool.map(c => `- ${c.name || nameOf(c)}：${charPersona(c).slice(0, 300).replace(/\n/g, ' ')}${book.line(c.id) ? `\n  TA 的照片：${book.line(c.id)}` : ''}`).join('\n'), story, lang: langRule(pool.map(c => c.id), '的动态正文'), world: (await worldBlock(story, pool)).world, time: time.forPrompt(),
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
  for (const mo of out) if (/^#/.test(mo.imageDesc)) { const p = book.pick(mo.imageDesc); mo.imageDesc = p && p.cid === mo.author ? p.what : ''; if (mo.imageDesc) mo.pk = await keyOf(p); if (!mo.pk) delete mo.pk; }
  out.forEach(mo => { const [t, tr] = takeTr(mo.text); mo.text = t; if (tr) mo.tr = tr; });
  await fillZh(out.filter(mo => speakOf(mo.author)));
  state.moments.unshift(...out.slice(0, count)); commit('moments');
  return Math.min(out.length, count);
}
export async function genComments(mo, stop) {
  const author = mo.author === 'me' ? myName() : nameOf(contact(mo.author));
  const people = friends().filter(p => p.id !== mo.author && canSee(mo, p.id)).slice(0, 12);
  if (!people.length) throw new Error('还没有其他联系人可以来评论');
  const post = [`${author}：${mo.text}${mo.imageDesc ? `（配图：${mo.imageDesc}）` : ''}`,
    ...mo.comments.map(cm => `${who(cm.who)}${cm.to ? ' 回复 ' + who(cm.to) : ''}：${cm.text}`),
    mo.likes.length ? `已点赞：${mo.likes.map(who).join('、')}` : ''].filter(Boolean).join('\n');
  const peopleText = people.map(p => `- ${p.name || nameOf(p)}${personaOf(p) ? '：' + personaOf(p).slice(0, 80).replace(/\n/g, ' ') : ''}`).join('\n');
  const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '动态', stop, prompt: compose('comment', { post, people: peopleText, time: time.forPrompt(), lang: langRule(people.map(p => p.id), '评论和回复') }) });
  const find = n => { n = String(n || '').trim(); if (n === myName() || n === '我') return 'me'; const p = state.contacts.find(x => [x.name, x.nick, x.remark].includes(n)); return p ? p.id : null; };
  let added = 0; const n0 = mo.comments.length;
  String(raw).split('\n').map(l => l.trim()).forEach(l => {
    const parts = l.split(/[|｜]/).map(s => s.trim());
    if (parts[0] === '赞') { const id = find(parts[1]); if (id && id !== 'me' && !mo.likes.includes(id)) { mo.likes.push(id); added++; } }
    else if (parts[0] === '评论' && parts.length >= 3) { const id = find(parts[1]), [text, tr] = takeTr(parts.slice(2).join('|')); if (id && id !== 'me') { mo.comments.push({ id: uid('cm'), who: id, text, ...(tr ? { tr } : {}), at: Date.now() }); added++; } }
    else if (parts[0] === '回复' && parts.length >= 4) { const id = find(parts[1]), to = find(parts[2]), [text, tr] = takeTr(parts.slice(3).join('|')); if (id && id !== 'me') { mo.comments.push({ id: uid('cm'), who: id, to: to || null, text, ...(tr ? { tr } : {}), at: Date.now() }); added++; } }
  });
  await fillZh(mo.comments.slice(n0).filter(cm => speakOf(cm.who)));
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
