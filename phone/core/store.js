// 数据存储：所有东西存在浏览器的 IndexedDB 里（库名 asterphone）
// state = 设置、连接、联系人、聊天列表、动态……；每个聊天的消息单独存一份，免得一次读太多。

import { debounce, uid } from './util.js';
import { DEFAULT_PROMPTS } from './prompts.js';

const DB = 'asterphone', STORE = 'kv';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode), st = tx.objectStore(STORE);
    const req = fn(st);
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
export const kvGet = k => idb('readonly', s => s.get(k));
export const kvSet = (k, v) => idb('readwrite', s => s.put(v, k));
export const kvDel = k => idb('readwrite', s => s.delete(k));
export const kvKeys = () => idb('readonly', s => s.getAllKeys());

/* ---------- 默认值 ---------- */
export const CHAT_MSG_TYPES = [
  ['text', '文字'], ['voice', '语音（写文字内容）'], ['image', '图片（写图片描述）'], ['transfer', '转账 / 红包'], ['sticker', '表情包'], ['location', '位置'],
  ['card', '名片'], ['call', '通话（写摘要）'], ['quote', '引用回复（带被引用的那句）'],
  ['poke', '拍一拍'], ['reaction', 'emoji 反应'], ['recall', '撤回提示'], ['read', '已读'], ['streak', '续火花'], ['music', '一起听切歌'],
];
export function defaults() {
  return {
    v: 2, winV: 1,
    settings: {
      mode: 'auto', fontScale: 1, timeSrc: 'story', clockColor: 'auto',
      // 壁纸：锁屏、桌面各选各的；random = 每次锁屏 / 打开手机随机换；live = Live 图怎么动（press 按住播放 / loop 一直循环）
      walls: { lock: 'castle', home: 'castle', lockRandom: false, homeRandom: false, live: 'press', liveWake: true, list: [] },
      clock: { lang: 'zh', h12: false, font: 'sf' },   // 时间显示：中文 / 英文、12 / 24 小时制、锁屏字体
      statusbar: { global: true, apps: {} },
      lock: { enabled: false, method: 'none', pin: '', digits: 4 },   // 默认不锁屏；开了也默认不设密码（上滑解锁）
      notify: { banner: true, sound: false, volume: .6, tone: 'twin', dnd: false, dndFrom: '23:00', dndTo: '08:00', badge: true },
      device: { fab: 'iphone', fabSize: 52, tripleTap: false },
      // 发给手机 AI 的上下文：读几条正文、带不带你的发言、标签要 / 不要、人设、世界书（见 core/context.js）
      ctx: { count: 6, withUser: true, keep: ['content'], drop: ['thinking'], keepOff: [], userPersona: true, charPersona: true, followTavern: true, books: {}, entries: {} },
      storyTime: { day: 3, minutes: 21 * 60 + 20, at: Date.now() },
    },
    connections: {
      text: [{ id: 'tavern', name: '酒馆当前连接', type: 'tavern', fixed: true }],
      image: [], tts: [], embed: [],
      // 每根线（用途）插在哪个接口：聊天、杂活（副 API：动态、评论这类小活）、生图、语音
      defaults: { text: 'tavern', aux: '', image: '', tts: '' },
      retry: { on: true, max: 1, fallback: false, backup: '' },     // 断线了怎么办：重试几次；聊天线断了改用副 API（backup = 哪个接口）
      schemes: [], scheme: '',                          // 接线方案：整套「哪根线插哪」存起来一键换
      order: [], pinned: [],                            // 插线板上格子的顺序（拖动排序）和置顶
    },
    apps: {
      chat: {
        conn: { text: 'follow', image: 'follow', tts: 'follow' },
        prompts: {},                      // 改过的提示词存这里；没改过就用默认
        defaults: { linkMode: 'follow', proactiveEvery: 3, groupDm: 'inline', imageGen: false, lines: [1, 4], gLines: [1, 6], voice: [0, 1], autoVoice: false, poke: true },
        injectTable: { text: true, voice: true, image: true, transfer: true, sticker: false, location: true, card: false, call: true, quote: true, poke: false, reaction: false, recall: false, read: false, streak: false, music: false },
        injectPos: 'chat', injectDepth: 3, injectCount: 12,
      },
      // 念念铃：整理用哪个接口（默认跟聊天那根线）、聊天时带不带记忆、跟着剧情自动记（off / maybe 有值得记的才记 / every 每楼都记）、手机聊天时顺手记
      memory: { conn: { text: 'follow' }, on: true, story: 'maybe', chat: true },
    },
    prompts: {},                          // 通用提示词的修改（全局 + 暗号）
    timeTagName: 'astertime',
    me: { nick: '', realName: '', sign: '', gender: '', birthday: '', region: '', tags: [], persona: null, avatar: '', link: 'none', stats: ['moments', 'friends', 'messages', 'balance'], balance: 520, ledger: [], pokeSuffix: '' },
    stickers: [], friendRequests: [], library: { theme: 'aero', skins: [] },
    contacts: [], chats: [], moments: [], favorites: [], groups: ['家人', '朋友'],
    // 音乐（整部手机一份）：播放队列、放到哪、喜欢、最近、导入的歌单、皮肤、音源地址
    music: { queue: [], idx: 0, mode: 'list', pos: 0, liked: [], recent: [], lists: [], local: [], plays: {}, history: [], storySongs: false, skin: { name: 'record', disc: 'glass', bg: '' }, src: {} },
    musicNotes: [],   // 音乐笔记（歌词 + 感悟 + 乐评），跟着聊天窗口走
    diary: { books: [] },   // 日记本：谁有一本、封面、什么时候写（日记本身存在 kv 的 diary:窗口 里）
  };
}

/* ---------- 状态 ---------- */
export const state = defaults();
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/* ---------- 每个酒馆聊天窗口一份手机数据 ---------- */
// 联系人、群、聊天、动态、收藏、新的朋友、分组、我的资料（含钱包）按窗口存在 'win:窗口' 里；其余（设置、接口、提示词、表情包、皮肤…）整部手机共用。
// 音色和读音跟着角色卡：当前卡的放在 state.voice 里，别的卡的放在 state.voiceCards 里，换卡时对调
const SCOPED = ['contacts', 'chats', 'moments', 'favorites', 'friendRequests', 'groups', 'me', 'musicNotes', 'diary'];
export let win = { key: '', card: '', label: '' };
let entered = false;
async function saveNow() {
  const s = JSON.parse(JSON.stringify(state)), w = { label: win.label };
  SCOPED.forEach(k => { w[k] = s[k]; delete s[k]; });
  await Promise.all([kvSet('state', s), entered && kvSet('win:' + win.key, w)]);   // 还没认出是哪个窗口前不写，免得空数据盖掉
}
const persist = debounce(() => saveNow().catch(e => console.error('[AsterPhone] 保存失败', e)), 300);
/** 换到另一个窗口（w = bridge 的 chatWindow()，没开聊天是 null）。真的换了返回 true */
export async function enterWindow(w) {
  w = w || { key: '', card: '', label: '没有打开聊天' };
  if (entered && w.key === win.key) return false;
  if (entered) await saveNow();
  const d = (await kvGet('win:' + w.key).catch(() => null)) || {}, def = defaults();
  SCOPED.forEach(k => { state[k] = merge(def[k], d[k]); });
  const V = state.voice || (state.voice = { mode: 'one', useDefault: true, people: {}, readings: [] }), C = state.voiceCards || (state.voiceCards = {});
  if (V.card !== w.card) {
    if (V.card != null) C[V.card] = { people: V.people, readings: V.readings };
    const n = C[w.card] || JSON.parse(JSON.stringify(C.__legacy || { people: {}, readings: [] }));   // 新卡先拿一份更新前的（按名字认人，名字对不上的用不到）
    delete C[w.card]; Object.assign(V, { card: w.card, people: n.people, readings: n.readings });
  }
  win = w; entered = true;
  return true;
}
/** 别的窗口里存着的手机数据（不含当前窗口） */
export async function windowList() {
  const out = [];
  for (const k of await kvKeys()) {
    if (!String(k).startsWith('win:') || k === 'win:' + win.key) continue;
    const d = await kvGet(k);
    if (d && ((d.contacts || []).length || (d.chats || []).length)) out.push({ key: k.slice(4), label: d.label || '（没打开聊天时）', people: d.contacts.length, chats: (d.chats || []).length });
  }
  return out;
}
export async function deleteWindow(key) {
  const d = (await kvGet('win:' + key)) || {};
  for (const c of d.chats || []) { await kvDel('msgs:' + c.id); msgCache.delete(c.id); }
  for (const k of await kvKeys()) if ((d.chats || []).some(c => String(k).startsWith(`tts:${c.id}:`))) await kvDel(k);
  await kvDel('win:' + key);
}
export function commit(what) { persist(); listeners.forEach(f => { try { f(what); } catch (e) { console.error(e); } }); }

function merge(base, saved) {
  if (saved == null) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return saved;
  const out = { ...base };
  for (const k of Object.keys(saved)) out[k] = (k in base) ? merge(base[k], saved[k]) : saved[k];
  return out;
}
export async function load() {
  try {
    const saved = await kvGet('state');
    if (saved) {
      // v1 → v2：以前默认是「指纹锁屏」，现在默认不锁屏。只有没动过锁屏设置的人才会被改过来
      const L = saved.settings && saved.settings.lock;
      if ((saved.v || 1) < 2 && L && L.enabled === true && L.method === 'finger' && !L.pin) { L.enabled = false; L.method = 'none'; }
      saved.v = 2;
      // 以前只有一个 wallpaper（锁屏桌面共用）→ 现在拆成两个
      const S = saved.settings;
      if (S && S.wallpaper && !S.walls) S.walls = { lock: S.wallpaper, home: S.wallpaper };
      // 以前聊天数据全手机一份 → 现在一个窗口一份：原来的先整个备份，再存成「更新前的数据」（设置 → 所有窗口的数据里能导出聊天，再到聊天列表导入）
      if (!saved.winV) {
        await kvSet('backup:before-windows', saved);
        const old = { label: '更新前的数据' };
        SCOPED.forEach(k => { if (k in saved) { old[k] = saved[k]; delete saved[k]; } });
        await kvSet('win:__legacy', old);
        const v = saved.voice, nameOf = id => id === 'me' ? 'me' : ((old.contacts || []).find(c => c.id === id) || {}).name || id;
        if (v) { saved.voiceCards = { __legacy: { people: Object.fromEntries(Object.entries(v.people || {}).map(([id, x]) => [nameOf(id), x])), readings: v.readings || [] } }; v.people = {}; v.readings = []; delete v.card; }
        saved.winV = 1;
      }
      Object.assign(state, merge(defaults(), saved));
    }
  } catch (e) { console.warn('[AsterPhone] 读取数据失败，使用默认值', e); }
  return state;
}

/* ---------- 每个聊天的消息 ---------- */
const msgCache = new Map();
export async function getMsgs(chatId) {
  if (msgCache.has(chatId)) return msgCache.get(chatId);
  let list = [];
  try { list = (await kvGet('msgs:' + chatId)) || []; } catch (e) { /* 空 */ }
  msgCache.set(chatId, list);
  return list;
}
const savers = new Map();
export function saveMsgs(chatId) {
  if (!savers.has(chatId)) savers.set(chatId, debounce(() => kvSet('msgs:' + chatId, msgCache.get(chatId) || []), 250));
  savers.get(chatId)();
  listeners.forEach(f => { try { f('msgs:' + chatId); } catch (e) { console.error(e); } });
}
export async function clearMsgs(chatId) {
  msgCache.set(chatId, []); await kvDel('msgs:' + chatId); saveMsgs(chatId);
  (await import('./memory.js')).dropChatAll(chatId).catch(e => console.warn('[AsterPhone] 念念铃没收回这个聊天记下的', e));   // 聊天删了，念念铃里从这个聊天记下的也删
  for (const k of await kvKeys()) if (String(k).startsWith(`tts:${chatId}:`)) await kvDel(k);   // 合成好存着的语音
}

/* ---------- 便捷查找 ---------- */
export const contact = id => state.contacts.find(c => c.id === id);
export const chatOf = id => state.chats.find(c => c.id === id);
export function chatForContact(cid, create = true) {
  let c = state.chats.find(x => x.type === 'dm' && x.contactId === cid);
  if (!c && create) {
    const d = state.apps.chat.defaults;
    c = { id: uid('c_'), type: 'dm', contactId: cid, pinned: false, muted: false, unread: 0, lastAt: 0, lastText: '',
      cfg: { linkMode: d.linkMode, injectCount: state.apps.chat.injectCount, showRead: true, showThink: false, conn: 'follow', temperature: null,
        autoTr: false, sendTr: false, myLang: 'zh-CN', theirLang: 'en',
        avatarShape: 'round', showAvatar: true, bg: '', myAvatar: '', theirAvatar: '', streak: true } };
    state.chats.push(c); commit('chats');
  }
  return c;
}

/* ---------- 导出 / 导入 / 清空 ---------- */
export async function exportAll({ withKeys = false, apps = null } = {}) {
  const s = JSON.parse(JSON.stringify(state));
  if (!withKeys) for (const kind of ['text', 'image', 'tts']) s.connections[kind].forEach(c => { if (c.key) c.key = ''; });
  const msgs = {};
  for (const c of state.chats) msgs[c.id] = await getMsgs(c.id);
  return { app: 'AsterPhone', version: 1, exportedAt: new Date().toISOString(), apps: apps || 'all', state: s, msgs };
}
export async function importAll(data) {
  if (!data || data.app !== 'AsterPhone') throw new Error('这不是 AsterPhone 的备份文件');
  const keep = state.connections;
  Object.assign(state, merge(defaults(), data.state));
  // 备份里没带密钥的连接，保留本机原来的密钥
  for (const kind of ['text', 'image', 'tts']) state.connections[kind].forEach(c => {
    if (!c.key) { const old = keep[kind].find(o => o.id === c.id); if (old && old.key) c.key = old.key; }
  });
  for (const [id, list] of Object.entries(data.msgs || {})) { msgCache.set(id, list); await kvSet('msgs:' + id, list); }
  commit('all');
}
export async function wipeAll() {
  for (const k of await kvKeys()) await kvDel(k);
  msgCache.clear();
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, defaults());
  commit('all');
}
export async function usage() {
  const parts = { 聊天: 0, 语音: 0, 音乐: 0, 动态: 0, 壁纸: 0, 设置: 0 };
  for (const k of await kvKeys()) {
    const v = await kvGet(k);
    if (String(k).startsWith('tts:')) { parts.语音 += (v && v.size) || 0; continue; }
    if (String(k).startsWith('mufile:')) { parts.音乐 += (v && v.size) || 0; continue; }
    if (String(k).startsWith('wall:')) { parts.壁纸 += ((v && v.img && v.img.size) || 0) + ((v && v.video && v.video.size) || 0); continue; }
    const n = JSON.stringify(v || '').length * 2;
    if (String(k).startsWith('msgs:')) parts.聊天 += n; else parts.设置 += n;
  }
  const m = JSON.stringify(state.moments).length * 2; parts.动态 += m; parts.设置 = Math.max(0, parts.设置 - m);
  return parts;
}

export { DEFAULT_PROMPTS };
