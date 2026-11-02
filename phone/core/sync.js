// 和酒馆正文联动：
// 1. 往正文里放「暗号」指令（让 AI 输出剧情时间、正文里发给你的手机消息）
// 2. 读正文里的暗号：更新剧情时间、把 <asterphone> 消息收进手机，并把标签从正文显示里藏起来
// 3. 把手机里的聊天注入正文（跟随正文的聊天自动注入最近 N 条；手动钉住的始终注入）
import { state, subscribe, getMsgs, contact, commit, enterWindow } from './store.js';
import { syncTavernProfiles } from './api.js';
import { debounce } from './util.js';
import { inTavern, onTavern, setInjection, hideTagsIn, chatMessage, ctx, chatWindow } from './bridge.js';
import { log } from './log.js';
import * as time from './time.js';
import { compose, myName } from './promptstore.js';
import { forAI } from '../apps/chat/msgtypes.js';

const KEY_TAGS = 'asterphone_tags', KEY_CHAT = 'asterphone_chat';
const seen = new Set();

export function startSync() {
  if (!inTavern()) return;
  const onMsg = id => { try { readMessage(Number(id)); } catch (e) { log('warn', '酒馆联动', '读取正文暗号失败', e); } };
  onTavern('MESSAGE_RECEIVED', onMsg);
  onTavern('MESSAGE_SWIPED', onMsg);
  onTavern('MESSAGE_UPDATED', id => { onMsg(id); hideTagsIn(id, tag()); });
  ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED'].forEach(ev => onTavern(ev, id => hideTagsIn(id, tag())));
  onTavern('CHAT_CHANGED', async () => {
    // 换了聊天窗口：手机换成这个窗口的那份数据；开着的页面是上个窗口的，关掉回桌面
    if (await enterWindow(chatWindow())) { (await import('./nav.js')).closeAll(); commit('all'); }
    setTimeout(hideAll, 300); refresh();
  });
  onTavern('GENERATION_STARTED', () => { applyTags(); });
  subscribe(what => { if (what === 'prompts' || what === 'all' || what === 'inject') { applyTags(); refresh(); } else if (String(what).startsWith('msgs:') || what === 'chats') refresh(); });
  // 酒馆的连接配置：一开始同步一次，之后酒馆里加 / 删 / 改 / 切换配置时再同步
  const syncProfiles = () => { try { if (syncTavernProfiles()) commit('connections'); } catch (e) { log('warn', '酒馆联动', '读取连接配置失败', e); } };
  ['CONNECTION_PROFILE_LOADED', 'CONNECTION_PROFILE_CREATED', 'CONNECTION_PROFILE_DELETED', 'CONNECTION_PROFILE_UPDATED', 'SETTINGS_UPDATED'].forEach(ev => onTavern(ev, () => setTimeout(syncProfiles, 50)));
  syncProfiles();
  applyTags(); refresh(); setTimeout(hideAll, 800);
  log('info', '酒馆联动', '已接上酒馆：暗号和注入正文已开启');
}
const tag = () => (state.timeTagName || 'astertime').replace(/[^\w-]/g, '') || 'astertime';
function hideAll() {
  const c = ctx(); if (!c || !Array.isArray(c.chat)) return;
  for (let i = Math.max(0, c.chat.length - 60); i < c.chat.length; i++) hideTagsIn(i, tag());
}

/* ---------- 1. 暗号指令 ---------- */
export function tagInstruction() {
  const text = compose('tag');
  if (!text) return '';
  // 告诉正文 AI 手机里有哪些群（谁在里面），剧情里只说「发群里了」时它能按前后文挑对群
  const who = id => { const c = contact(id); return c ? c.remark || c.nick || c.name : ''; };
  const groups = state.chats.filter(c => c.type === 'group').map(g => `${g.name}（${g.members.map(who).filter(Boolean).join('、')}${g.intro ? '；' + g.intro : ''}）`);
  return `[AsterPhone 格式说明]\n${text}` + (state.music.storySongs ? '\n每一楼都要有一位角色把一首歌加进自己歌单（这一楼里听到、想起、想推荐给别人的歌，贴合情节和 TA 的性格；别重复加同一首）：type="加歌"，内容写 歌名 - 歌手。' : '') + (groups.length ? `\n手机里现在的群：${groups.join('；')}。发在群里的，group 照这里的群名写；正文没说是哪个群，就按前后文和谁在群里挑最合适的：熟人之间的小事发小群，正式的事和通知才发大群，有长辈、老师在的群说话会拘谨。` : '');
}
function applyTags() { setInjection(KEY_TAGS, tagInstruction(), { position: 1, depth: 0 }); }

/* ---------- 2. 读正文暗号 ---------- */
async function readMessage(id) {
  const m = chatMessage(id); if (!m || m.is_user || m.is_system) return;
  const text = String(m.mes || '');
  const t = time.parseTimeTag(text);
  if (t) { const cur = time.story(), cd = cur.date ? `${cur.date.getFullYear()}-${String(cur.date.getMonth() + 1).padStart(2, '0')}-${String(cur.date.getDate()).padStart(2, '0')}` : null;
    if (cur.day !== t.day || cur.hh !== t.hh || cur.mm !== t.mm || (t.date && t.date !== cd) || (t.place && t.place !== cur.place)) time.setStory(t.day, t.hh, t.mm, 'story', t.date, t.place || undefined); }
  const re = /<asterphone\b([^>]*)>([\s\S]*?)<\/asterphone>/gi;
  let r; const found = [];
  while ((r = re.exec(text))) {
    const attr = /from\s*=\s*["“']?([^"”'>]+)["”']?/.exec(r[1]), grp = /group\s*=\s*["“']?([^"”'>]+)["”']?/.exec(r[1]), ty = /type\s*=\s*["“']?([^"”'>\s]+)/.exec(r[1]);
    let from = attr ? attr[1].trim() : '', body = r[2].trim();
    if (!from) { const mm = /^([^:：\n]{1,20})[:：]\s*([\s\S]+)$/.exec(body); if (mm) { from = mm[1].trim(); body = mm[2].trim(); } }
    if (from && (body || ty)) found.push([from, body, grp ? grp[1].trim() : '', ty ? ty[1] : '']);
  }
  if (!found.length) return;
  const { fromStory } = await import('../apps/chat/engine.js');
  for (const [from, body, group, type] of found) {
    const k = `${id}|${m.swipe_id ?? 0}|${from}|${group}|${type}|${body}`;
    if (seen.has(k)) continue; seen.add(k);
    await fromStory({ from, body, group, type });
  }
  hideTagsIn(id, tag());
}

/* ---------- 3. 注入正文 ---------- */
const TYPE_OF = m => m.recalled ? 'recall' : m.type === 'poke' ? 'poke' : m.quote ? 'quote' : m.type === 'packet' ? 'transfer' : (m.type || 'text');
export async function collectInjection() {
  const table = state.apps.chat.injectTable, auto = [], pinned = [];
  for (const chat of state.chats) {
    const msgs = await getMsgs(chat.id);
    msgs.forEach(m => { if (m.pinned && !m.recalled) pinned.push({ chat, m }); });
    if (chat.cfg.linkMode !== 'follow') continue;
    const n = chat.cfg.injectCount ?? state.apps.chat.injectCount ?? 12;
    msgs.filter(m => !m.pinned && !m.noInject && table[TYPE_OF(m)] !== false && !(m.from === 'sys' && !table.poke)).slice(n > 0 ? -n : msgs.length).forEach(m => auto.push({ chat, m }));
  }
  return { auto, pinned };
}
export function lineOf({ chat, m }) {
  const c = contact(chat.contactId), other = c ? (c.name || c.nick || c.remark) : 'TA', me = myName();
  const when = time.isStory() && m.st ? `${time.fmtDate(time.dayToDate(m.st.d), 'zh')} ${String(Math.floor(m.st.m / 60)).padStart(2, '0')}:${String(m.st.m % 60).padStart(2, '0')}` : new Date(m.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (m.from === 'sys') return `（${when}）${m.text}`;
  if (chat.type === 'group') {
    const w = m.from === 'me' ? me : (() => { const p = contact(m.who); return p ? (p.name || p.nick || p.remark) : '某人'; })();
    return `（${when}）[群聊「${chat.name}」] ${w}：${m.quote ? `（引用「${m.quote.text}」）` : ''}${forAI(m)}`;
  }
  const q = m.quote ? `（引用「${m.quote.text}」）` : '';
  const body = forAI(m);
  return m.from === 'me' ? `（${when}）${me} 发给 ${other}：${q}${body}` : `（${when}）${other} 发给 ${me}：${q}${body}`;
}
export async function injectionText() {
  const { auto, pinned } = await collectInjection();
  const all = [...auto, ...pinned].sort((a, b) => a.m.at - b.m.at);
  if (!all.length) return '';
  return `[${myName()} 的手机 · 最近的聊天记录（剧情参考，不必逐句复述）]\n${all.map(lineOf).join('\n')}`;
}
const refresh = debounce(async () => {
  if (!inTavern()) return;
  try {
    const text = await injectionText();
    const pos = state.apps.chat.injectPos === 'prompt' ? { position: 0, depth: 0 } : { position: 1, depth: state.apps.chat.injectDepth ?? 3 };
    setInjection(KEY_CHAT, text, pos);
  } catch (e) { log('warn', '酒馆联动', '更新注入失败', e); }
}, 400);
export { refresh as refreshInjection };
