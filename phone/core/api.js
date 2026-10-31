// AI 调用：按「连接」的渠道类型拼请求。
// 渠道：tavern（酒馆当前连接）/ openai（OpenAI 兼容）/ claude / gemini
import { state } from './store.js';
import { generateTavern, inTavern, tavernProfiles, generateWithProfile, tavernMainApi } from './bridge.js';
import { log } from './log.js';

export const CHANNELS = {
  text: [
    { v: 'openai', label: 'OpenAI 兼容', base: 'https://api.openai.com/v1' },
    { v: 'claude', label: 'Claude', base: 'https://api.anthropic.com' },
    { v: 'gemini', label: 'Gemini', base: 'https://generativelanguage.googleapis.com' },
  ],
  image: [{ v: 'openai-image', label: 'OpenAI 兼容（生图）', base: 'https://api.openai.com/v1' }],
  tts: [{ v: 'openai-tts', label: 'OpenAI 兼容（语音）', base: 'https://api.openai.com/v1' }],
};

/** 找出这次该用哪个连接：聊天自己的 → 应用的 → 全局默认。kind 可以是 text / aux（杂活，没插就跟聊天线走）/ image / tts */
export function resolveConn(kind = 'text', app = 'chat', override = 'follow') {
  if (kind === 'aux') {
    const a = (state.connections.text || []).find(c => c.id === state.connections.defaults.aux);
    return a || resolveConn('text', app);
  }
  const list = state.connections[kind] || [];
  const pick = id => list.find(c => c.id === id);
  if (override && override !== 'follow' && pick(override)) return pick(override);
  const appSel = state.apps[app] && state.apps[app].conn && state.apps[app].conn[kind];
  if (appSel && appSel !== 'follow' && pick(appSel)) return pick(appSel);
  return pick(state.connections.defaults[kind]) || list[0] || null;
}
export function connLabel(c) { return c ? c.name : '未设置'; }

const trim = s => String(s || '').replace(/\/+$/, '');
async function readErr(res) {
  let t = ''; try { t = await res.text(); } catch (e) { /* 空 */ }
  try { const j = JSON.parse(t); t = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) { /* 不是 JSON */ }
  return `${res.status} ${String(t).slice(0, 160)}`;
}

/** 生成文字。返回字符串。 */
/** 这个接口的所有密钥（第一把 + 后来加的） */
export const keysOf = c => [c.key, ...(c.keys || [])].map(k => String(k || '').trim()).filter(Boolean);
const THINK = { low: 1024, medium: 4096, high: 12000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** 能不能换一把密钥 / 再试一次：密钥不对、被限流 → 换密钥；网络或服务器出错 → 重试 */
const isKeyErr = m => /^(401|403|429)\b/.test(m);
const isRetryErr = m => /^(408|409|425|429|5\d\d)\b/.test(m) || /连不上|Failed to fetch|network|timeout/i.test(m);

/**
 * 生成文字。返回字符串。
 * 会自动：多把密钥轮着用（某把被拒就换下一把）、失败按设置重试、聊天线断了改用「杂活」接口。
 */
export async function generate(opts) {
  const { conn, app = '聊天' } = opts;
  if (!conn) throw new Error('还没有设置可用的连接');
  const R = state.connections.retry || {}, tries = 1 + (R.on ? Math.max(0, R.max | 0) : 0);
  let last = null;
  for (let t = 0; t < tries; t++) {
    try { return await generateOnce(opts); }
    catch (e) { last = e; if (!isRetryErr(e.message) || t === tries - 1) break; log('warn', app, `第 ${t + 1} 次失败，${t + 1 < tries ? '再试一次' : ''}：${e.message}`); await sleep(800 * (t + 1)); }
  }
  // 聊天线断了 → 改插杂活接口（只换一次，不来回换）
  const aux = (state.connections.text || []).find(c => c.id === state.connections.defaults.aux);
  if (R.fallback && !opts.noFallback && aux && aux.id !== conn.id && conn.id === state.connections.defaults.text) {
    log('warn', app, `「${conn.name}」连不上，改用杂活接口「${aux.name}」`);
    return generateOnce({ ...opts, conn: aux, noFallback: true });
  }
  throw last;
}
async function generateOnce({ conn, system = '', prompt = '', temperature, maxTokens = 700, app = '聊天' }) {
  const P = conn.params || {};
  const temp = temperature ?? P.temperature ?? conn.temperature ?? 0.9;
  const think = THINK[P.thinking] || 0;
  const keys = keysOf(conn);
  let ki = Math.min(conn.keyIdx || 0, Math.max(0, keys.length - 1));
  const t0 = performance.now();
  try {
    let out;
    // 换密钥：当前这把被拒了就换下一把，直到都试过
    const withKey = async fn => {
      for (let n = 0; n < Math.max(1, keys.length); n++) {
        const k = keys[(ki + n) % Math.max(1, keys.length)] || '';
        try { const r = await fn(k); if (n) { conn.keyIdx = (ki + n) % keys.length; } return r; }
        catch (e) { if (!isKeyErr(e.message) || n >= keys.length - 1) throw e; log('warn', app, `密钥 ${(ki + n) % keys.length + 1} 被拒（${e.message.slice(0, 3)}），换下一把`); }
      }
    };
    if (conn.type === 'tavern') {
      if (!inTavern()) { out = demoReply(prompt); log('info', app, '不在酒馆里，用了演示回复'); }
      else out = await generateTavern({ system, prompt, maxTokens });
    } else if (conn.type === 'tavern-profile') {
      const pf = tavernProfiles().list.find(x => x.id === conn.profileId);
      if (!pf) throw new Error(`酒馆里找不到「${conn.name}」这个连接配置了`);
      out = await generateWithProfile(pf, { system, prompt, maxTokens });
    } else if (conn.type === 'openai') {
      out = await withKey(async key => {
        const body = { model: conn.model, temperature: temp, max_tokens: maxTokens, messages: [system && { role: 'system', content: system }, { role: 'user', content: prompt }].filter(Boolean) };
        if (think) { body.reasoning_effort = P.thinking; delete body.temperature; body.max_completion_tokens = maxTokens + think; delete body.max_tokens; }
        const res = await fetch(trim(conn.base) + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await readErr(res));
        const j = await res.json(); return j.choices?.[0]?.message?.content ?? '';
      });
    } else if (conn.type === 'claude') {
      out = await withKey(async key => {
        // 提示词缓存：人设 / 设定这类每次都一样的东西走缓存，便宜又快
        const sys = !system ? undefined : (conn.adv && conn.adv.cache) ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
        const body = { model: conn.model, max_tokens: maxTokens + think, system: sys, messages: [{ role: 'user', content: prompt }] };
        if (think) body.thinking = { type: 'enabled', budget_tokens: think }; else body.temperature = Math.min(1, temp);
        const res = await fetch(trim(conn.base || 'https://api.anthropic.com') + '/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await readErr(res));
        const j = await res.json(); return (j.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
      });
    } else if (conn.type === 'gemini') {
      out = await withKey(async key => {
        const gc = { temperature: temp, maxOutputTokens: maxTokens + think };
        if (think) gc.thinkingConfig = { thinkingBudget: think };
        const url = `${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models/${encodeURIComponent(conn.model)}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc }) });
        if (!res.ok) throw new Error(await readErr(res));
        const j = await res.json(); return (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      });
    } else throw new Error('这个渠道还不能用来生成文字：' + conn.type);
    log('info', app, `生成完成（${conn.name}，${Math.round(performance.now() - t0)} 毫秒）`);
    return String(out || '').trim();
  } catch (e) {
    const msg = e && e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : (e && e.message) || String(e);
    log('error', app, `生成失败（${conn.name}）：${msg}`, { channel: conn.type, base: conn.base, model: conn.model });
    throw new Error(msg);
  }
}

/** 拉取模型列表 */
export async function listModels(conn) {
  if (conn.type === 'openai') {
    const res = await fetch(trim(conn.base) + '/models', { headers: { Authorization: 'Bearer ' + (conn.key || '') } });
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(); return (j.data || []).map(m => m.id).sort();
  }
  if (conn.type === 'claude') {
    const res = await fetch(trim(conn.base || 'https://api.anthropic.com') + '/v1/models', { headers: { 'x-api-key': conn.key || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(); return (j.data || []).map(m => m.id);
  }
  if (conn.type === 'gemini') {
    const res = await fetch(`${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models?key=${encodeURIComponent(conn.key || '')}`);
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(); return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
  }
  return [];
}

/** 测试连接：发一句很短的话 */
export async function testConn(conn) {
  // 测的就是这一个接口：不重试、不改插别的
  const out = await generateOnce({ conn, system: '', prompt: '只回复两个字：在的', maxTokens: 24, app: '设置' });
  if (!out) throw new Error('连上了，但没有返回内容');
  return out;
}

/* ---------- 演示回复（单独打开预览、没有酒馆时用）---------- */
const DEMO = [
  ['在呢', '[语音]刚洗完澡 头发还湿着', '你今天怎么这么晚还不睡'],
  ['[收下]', '哈哈哈哈 谢谢老板', '[红包]6.66|早点睡'],
  ['嗯…', '<inner>其实有点想她</inner>', '明天要不要一起吃早饭'],
  ['刚看到', '[位置]海边那家咖啡店', '十分钟到'],
  ['你又熬夜', '快去睡觉', '晚安 🌙'],
];
let demoIdx = 0;
function demoReply(prompt) {
  if (/谁点赞/.test(prompt)) { const names = [...prompt.matchAll(/^- ([^：\n]+)/gm)].map(m => m[1].trim()); const a = names[0] || '某人', b = names[1] || a; return `赞|${a}\n评论|${b}|拍得不错\n回复|${a}|${b}|你也在线啊`; }
  if (/发一条朋友圈动态/.test(prompt)) return ['今天的晚霞好看到不想回家', '路过的猫比我还会生活 🐈', '下雨天，适合发呆'][demoIdx++ % 3];
  if (/布置一部手机里的通讯录/.test(prompt)) return JSON.stringify({ people: [
    { name: '沈知夏', nick: '夏夏', remark: '学姐', gender: '女', sign: '在写论文，勿扰', pokeSuffix: '的发卡', persona: '研究生学姐，温柔但嘴毒，经常给你带早饭。' },
    { name: '陆铭', nick: '铭', remark: '室友', gender: '男', sign: '今天也要早睡（假的）', pokeSuffix: '的游戏机', persona: '大学室友，话痨，熬夜冠军。' },
    { name: '程老板', nick: '咖啡店程', remark: '楼下咖啡店', gender: '男', sign: '新品上了', pokeSuffix: '', persona: '楼下咖啡店老板，跟你很熟。' }],
    groups: [{ name: '宿舍夜话', intro: '你和室友、学姐的小群', notice: '周五聚餐', owner: '陆铭', members: ['陆铭', '沈知夏'] }] });
  if (/找出里面写到的人物/.test(prompt)) return JSON.stringify({ people: [{ name: '白鸦', nick: '', remark: '', gender: '', sign: '', pokeSuffix: '', persona: '情报贩子。', entry: '' }] });
  if (/手机群聊/.test(prompt)) {
    const ns = [...prompt.matchAll(/^- ([^（：\n]+)/gm)].map(m => m[1].trim());
    const [a = '某人', b = a, c2 = b] = ns;
    return `${b}：去啊 我早就想去了\n${b}：[表情包]开心\n${a}：几点集合\n私聊|${c2}：你俩去吧 我这周加班 别跟他们说我有点失落`;
  }
  if (/正在(语音|视频)通话/.test(prompt)) return ['喂？听得到吗', '（那边有点风声）我刚到楼下'][demoIdx++ % 2];
  if (/只回复两个字/.test(prompt)) return '在的';
  const lines = DEMO[demoIdx++ % DEMO.length];
  return lines.join('\n');
}

/* ---------- 生图（OpenAI 兼容 /images/generations） ---------- */
export async function generateImage(prompt, app = '聊天') {
  const conn = resolveConn('image', 'chat');
  if (!conn) throw new Error('还没有生图连接：设置 → 连接 → 生图 里加一个');
  const res = await fetch(trim(conn.base) + '/images/generations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (conn.key || '') },
    body: JSON.stringify({ model: conn.model || undefined, prompt: [conn.img && conn.img.tags, prompt].filter(Boolean).join(', ') + (conn.img && conn.img.neg ? `\n\nAvoid: ${conn.img.neg}` : ''), n: 1, size: (conn.img && conn.img.size) || conn.size || '1024x1024', response_format: 'b64_json' }),
  });
  if (!res.ok) { const msg = await readErr(res); log('error', app, '生图失败：' + msg); throw new Error(msg); }
  const j = await res.json(), d = (j.data || [])[0] || {};
  if (d.b64_json) return 'data:image/png;base64,' + d.b64_json;
  if (d.url) return d.url;
  throw new Error('生图接口没有返回图片');
}

/* ---------- 朗读：有语音连接就用它，没有就用浏览器自带的（免费） ---------- */
let playing = null;
export async function speak(text, { voice } = {}) {
  stopSpeak();
  const conn = resolveConn('tts', 'chat');
  if (conn && conn.type === 'openai-tts') {
    try {
      const res = await fetch(trim(conn.base) + '/audio/speech', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (conn.key || '') },
        body: JSON.stringify({ model: conn.model || 'tts-1', input: text, voice: voice || (conn.tts && conn.tts.voice) || conn.voice || 'alloy', speed: (conn.tts && conn.tts.speed) || 1 }),
      });
      if (!res.ok) throw new Error(await readErr(res));
      const a = new Audio(URL.createObjectURL(await res.blob())); a.volume = Math.min(1, (conn.tts && conn.tts.volume) ?? 1); playing = a; await a.play();
      return new Promise(r => { a.onended = r; a.onerror = r; });
    } catch (e) { log('warn', '语音', '语音连接朗读失败，改用浏览器朗读：' + e.message); }
  }
  if (!('speechSynthesis' in window)) throw new Error('这个浏览器不能朗读');
  return new Promise(r => {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 1.02;
    const v = speechSynthesis.getVoices().find(x => /zh|Chinese/i.test(x.lang + x.name)); if (v) u.voice = v;
    u.onend = r; u.onerror = r; playing = u; speechSynthesis.speak(u);
  });
}
export function stopSpeak() {
  try { if (playing instanceof Audio) playing.pause(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  playing = null;
}

/**
 * 把酒馆里的连接配置同步成一个个接口（类型 tavern-profile），这样它们也能插线、能排序。
 * 酒馆里删掉的配置：没线插着就去掉；有线插着先留着，标成「酒馆里没有了」。
 * 返回 true = 有变化
 */
export function syncTavernProfiles() {
  const { list, selected } = tavernProfiles(), text = state.connections.text;
  let changed = false;
  const seen = new Set();
  for (const pf of list) {
    const id = 'tvp_' + pf.id; seen.add(id);
    let c = text.find(x => x.id === id);
    const info = { name: pf.name || '未命名配置', model: pf.model || '', api: pf.api || '', preset: pf.preset || '', url: pf['api-url'] || '', mode: pf.mode || '', gone: false };
    if (!c) { c = { id, type: 'tavern-profile', profileId: pf.id, fixed: true, ...info }; text.push(c); changed = true; }
    else if (Object.keys(info).some(k => c[k] !== info[k])) { Object.assign(c, info); changed = true; }
  }
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i]; if (c.type !== 'tavern-profile' || seen.has(c.id)) continue;
    if (!inTavern()) continue;                     // 不在酒馆里（单独预览）就别动
    const used = Object.values(state.connections.defaults).includes(c.id);
    if (used) { if (!c.gone) { c.gone = true; changed = true; } } else { text.splice(i, 1); changed = true; }
  }
  // 「酒馆当前连接」顺便记下现在是哪个配置、什么模型，给人看
  const tv = text.find(x => x.type === 'tavern');
  if (tv) {
    const sel = list.find(x => x.id === selected);
    const cur = sel ? sel.name : '', model = sel ? sel.model || '' : '', api = sel ? '' : tavernMainApi();
    if (tv.cur !== cur || tv.model !== model || tv.curApi !== api) { tv.cur = cur; tv.model = model; tv.curApi = api; changed = true; }
  }
  return changed;
}
