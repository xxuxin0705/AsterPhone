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
    v: 2,
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
      ctx: { count: 6, withUser: true, keep: ['content'], userPersona: true, charPersona: true, followTavern: true, books: {}, entries: {} },
      autoLimit: 30, autoUsed: { date: '', count: 0 },
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
        defaults: { linkMode: 'follow', proactive: false, proactiveFreq: 'normal', proactiveEvery: 3, proactiveLimit: 5, friendFirst: false, groupDm: 'inline', imageGen: false },
        injectTable: { text: true, voice: true, image: true, transfer: true, sticker: false, location: true, card: false, call: true, quote: true, poke: false, reaction: false, recall: false, read: false, streak: false, music: false },
        injectPos: 'chat', injectDepth: 3, injectCount: 12,
      },
    },
    prompts: {},                          // 通用提示词的修改（全局 + 暗号）
    timeTagName: 'astertime',
    me: { nick: '', realName: '', sign: '', gender: '', birthday: '', region: '', tags: [], persona: null, avatar: '', link: 'none', stats: ['moments', 'friends', 'messages', 'balance'], balance: 520, ledger: [], pokeSuffix: '' },
    stickers: [], friendRequests: [], library: { theme: 'aero', skins: [] },
    contacts: [], chats: [], moments: [], favorites: [], groups: ['家人', '朋友'],
  };
}

/* ---------- 状态 ---------- */
export const state = defaults();
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const persist = debounce(() => kvSet('state', JSON.parse(JSON.stringify(state))).catch(e => console.error('[AsterPhone] 保存失败', e)), 300);
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
export async function clearMsgs(chatId) { msgCache.set(chatId, []); await kvDel('msgs:' + chatId); saveMsgs(chatId); }

/* ---------- 便捷查找 ---------- */
export const contact = id => state.contacts.find(c => c.id === id);
export const chatOf = id => state.chats.find(c => c.id === id);
export function chatForContact(cid, create = true) {
  let c = state.chats.find(x => x.type === 'dm' && x.contactId === cid);
  if (!c && create) {
    const d = state.apps.chat.defaults;
    c = { id: uid('c_'), type: 'dm', contactId: cid, pinned: false, muted: false, unread: 0, lastAt: 0, lastText: '',
      cfg: { linkMode: d.linkMode, injectCount: state.apps.chat.injectCount, showRead: true, showThink: false, conn: 'follow', temperature: null,
        proactive: !!d.proactive, proactiveFreq: d.proactiveFreq || 'normal', proactiveEvery: d.proactiveEvery || 3, proactiveLimit: d.proactiveLimit || 5, autoTr: false, sendTr: false, myLang: 'zh-CN', theirLang: 'en',
        minLines: 1, maxLines: 4, avatarShape: 'round', showAvatar: true, bg: '', myAvatar: '', theirAvatar: '', streak: true } };
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
  const parts = { 聊天: 0, 动态: 0, 壁纸: 0, 设置: 0 };
  for (const k of await kvKeys()) {
    const v = await kvGet(k);
    if (String(k).startsWith('wall:')) { parts.壁纸 += ((v && v.img && v.img.size) || 0) + ((v && v.video && v.video.size) || 0); continue; }
    const n = JSON.stringify(v || '').length * 2;
    if (String(k).startsWith('msgs:')) parts.聊天 += n; else parts.设置 += n;
  }
  const m = JSON.stringify(state.moments).length * 2; parts.动态 += m; parts.设置 = Math.max(0, parts.设置 - m);
  return parts;
}

export { DEFAULT_PROMPTS };
