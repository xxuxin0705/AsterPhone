// AI 调用：按「连接」的渠道类型拼请求。
// 渠道：tavern（酒馆当前连接）/ openai（OpenAI 兼容）/ claude / gemini
import { state, kvGet, kvSet } from './store.js';
import { generateTavern, inTavern, tavernProfiles, generateWithProfile, tavernMainApi, ctx } from './bridge.js';
import { apiLog as log, log as note, startCall, orAbort, abortCall } from './log.js';

/** 直连被跨域拦住时，改走酒馆自带的 CORS 代理 /proxy/（酒馆 config.yaml 里 enableCorsProxy: true）。
 *  其他插件能连上、手机连不上，多半就是差在这一步。代理没开 / Tauri 酒馆没有代理时照常报错 */
export async function xf(url, o = {}) {
  try { return await fetch(url, o); }
  catch (e) {
    if ((o.signal && o.signal.aborted) || !/^https?:/i.test(url) || !inTavern()) throw e;
    // OpenAI 格式的聊天 / 拉模型：借酒馆自己「自定义（兼容 OpenAI）」那条路转一手。本地酒馆和 Tauri Tavern 都有，不用开代理
    const m = /^(.*)\/(chat\/completions|models)$/.exec(url), auth = o.headers && o.headers.Authorization;
    if (m && auth) return viaTavern(m[1], m[2] === 'models', o, auth);
    let r = null;
    try { const c = ctx(); r = await fetch('/proxy/' + url, { ...o, headers: { ...(c && c.getRequestHeaders ? c.getRequestHeaders() : {}), ...o.headers } }); } catch (e2) { /* 代理也连不上 */ }
    // 本地酒馆没开代理回 404；Tauri Tavern 根本没有 /proxy/，回 200 + 酒馆首页。两种都算「没有代理」
    if (r && (r.status === 404 || /text\/html/i.test(r.headers.get('content-type') || ''))) { const t = await r.clone().text(); if (/proxy is disabled|Cannot (GET|POST)/i.test(t) || t.trim().startsWith('<')) r = null; }
    if (!r) {   // 提示只说连不上哪儿；为什么、怎么办写进日志的警告
      const host = new URL(url).host;
      note('warn', '连接', `连不上 ${host}`, top.__TAURI__ || top.__TAURI_INTERNALS__ ? '多半是这家不让网页直接连，Tauri Tavern 又没有转发代理' : '网络不通或被跨域拦截。可以在酒馆 config.yaml 里设 enableCorsProxy: true，重启酒馆后再试');
      throw new Error(`连不上 ${host}`);
    }
    return r;
  }
}

async function viaTavern(base, models, o, auth) {
  const body = { ...(models ? {} : JSON.parse(o.body)), chat_completion_source: 'custom', custom_url: base, custom_include_headers: `Authorization: ${JSON.stringify(auth)}` };
  const r = await fetch(`/api/backends/chat-completions/${models ? 'status' : 'generate'}`, { method: 'POST', signal: o.signal, headers: { ...(ctx()?.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!models) return r;
  const j = await r.clone().json().catch(() => null);   // 拉模型失败时酒馆也回 200，只是带着 error
  return j && !j.error ? r : new Response(JSON.stringify({ error: { message: (j && j.message) || '酒馆那边也没拉到模型' } }), { status: 502 });
}

export const CHANNELS = {
  text: [
    { v: 'openai', label: 'OpenAI 官方', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', site: 'https://platform.openai.com/api-keys' },
    { v: 'claude', label: 'Claude 官方', base: 'https://api.anthropic.com', site: 'https://console.anthropic.com/settings/keys' },
    { v: 'gemini', label: 'Gemini 官方', base: 'https://generativelanguage.googleapis.com', site: 'https://aistudio.google.com/apikey' },
    { v: 'deepseek', label: 'DeepSeek 官方', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', site: 'https://platform.deepseek.com/api_keys' },
    { v: 'openai-compat', label: '第三方（OpenAI 兼容）', base: '' },
  ],
  // 生图渠道：地址、默认模型、官网都先填好，用的人只要填密钥；全部都能改
  image: [
    { v: 'novelai', label: 'NovelAI / NAI', base: 'https://image.novelai.net', model: 'nai-diffusion-4-5-full', site: 'https://novelai.net', note: '二次元最好用。尺寸不超过 1024×1024、步数不超过 28，订阅用户不额外扣点。密钥在官网 账户设置 → Get Persistent API Token。' },
    { v: 'openai-image', label: 'OpenAI 官方', base: 'https://api.openai.com/v1', model: 'gpt-image-1', site: 'https://platform.openai.com/api-keys' },
    { v: 'sd-webui', label: '本地 SD', base: 'http://127.0.0.1:7860', model: '', site: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui', noKey: true, note: '自己电脑上的 Stable Diffusion WebUI / Forge。启动时要加 --api --cors-allow-origins=*。' },
    { v: 'comfyui', label: 'ComfyUI', base: 'http://127.0.0.1:8188', model: '', site: 'https://github.com/comfyanonymous/ComfyUI', noKey: true, note: '自己电脑上的 ComfyUI。在「画风」里粘贴 API 格式的工作流，把提示词的位置写成 %prompt%。启动时加 --enable-cors-header。' },
    { v: 'siliconflow', label: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors', site: 'https://cloud.siliconflow.cn/account/ak', note: '国内直连。模型可选 Kwai-Kolors/Kolors、Qwen/Qwen-Image。' },
    { v: 'image-compat', label: '第三方（OpenAI 兼容）', base: '', model: '', custom: true },
  ],
  // 「其他」线：向量记忆用的 Embedding 接口（以后找旧聊天用）
  embed: [
    // 「其他」线：标签（tag）是给自己认的，格子上显示它；App 设置里按它挑。内置两个向量、两个实时通话，也可以自定义
    { v: 'siliconflow-embed', label: '硅基流动', tag: '向量', base: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', site: 'https://cloud.siliconflow.cn/account/ak', note: '免费的 BAAI/bge-m3 就够用，国内直连。' },
    { v: 'zhipu-embed', label: '智谱', tag: '向量', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3', site: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', note: '智谱 BigModel 的 embedding-3。' },
    { v: 'openai-embed', label: '第三方向量（OpenAI 兼容）', tag: '向量', base: '', model: 'text-embedding-3-small', site: '', custom: true },
    { v: 'openai-realtime', label: 'OpenAI 实时语音', tag: '通话', base: 'https://api.openai.com/v1', model: 'gpt-realtime-2.1', site: 'https://platform.openai.com/api-keys' },
    { v: 'gemini-live', label: 'Gemini Live', tag: '通话', base: 'https://generativelanguage.googleapis.com', model: 'gemini-3.8-live', site: 'https://aistudio.google.com/apikey' },
    { v: 'other-compat', label: '自定义（OpenAI 兼容）', tag: '', base: '', model: '', site: '', custom: true },
  ],
  // 语音渠道：同样先填好地址、默认模型、默认音色、官网。fields = 这个渠道额外要填的东西
  tts: [
    { v: 'minimax-cn', label: 'MiniMax 国内', base: 'https://api.minimaxi.com', model: 'speech-2.8-hd', voice: 'female-shaonv', site: 'https://platform.minimaxi.com', fields: [['groupId', 'Group ID（可不填）']], note: '国内版。音色 ID 在官网「音色库」里看，比如 female-shaonv、male-qn-qingse，也可以填自己克隆的音色。' },
    { v: 'minimax-intl', label: 'MiniMax 国际', base: 'https://api.minimax.io', model: 'speech-2.8-hd', voice: 'female-shaonv', site: 'https://www.minimax.io/platform', fields: [['groupId', 'Group ID（可不填）']], note: '国际版，密钥和国内版不通用。' },
    { v: 'openai-tts', label: 'OpenAI 官方', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', site: 'https://platform.openai.com/api-keys', note: '音色：alloy、nova、shimmer、echo、onyx、fable 等。' },
    { v: 'fish', label: 'Fish Audio', base: 'https://api.fish.audio', model: 's2.1-pro', voice: '', site: 'https://fish.audio/app/api-keys', note: '音色填声音模型的 ID（在 Fish Audio 网站上点开一个声音，地址里那串）。免费开发者额度用模型 s2.1-pro-free。' },
    { v: 'elevenlabs', label: 'ElevenLabs', base: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', voice: 'JBFqnCBsd6RMkjVDRZzb', site: 'https://elevenlabs.io/app/settings/api-keys', note: '音色填 Voice ID（在 ElevenLabs 的 Voices 里复制）。' },
    { v: 'indextts', label: 'IndexTTS 本地', base: 'http://127.0.0.1:8000/v1', model: 'indextts', voice: '', site: 'https://github.com/index-tts/index-tts', noKey: true, note: '自己电脑上跑的 IndexTTS，要开 OpenAI 格式的接口（/v1/audio/speech），地址填到 /v1。音色填你在服务里起的名字。' },
    { v: 'mimo', label: '小米 MiMo', base: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-tts', voice: 'mimo_default', site: 'https://mimo.mi.com', note: '内置音色：冰糖、茉莉、苏打、白桦、Mia、Chloe、Milo、Dean，不填就是默认。' },
    { v: 'doubao-tts', label: '豆包 / 火山引擎', base: 'https://openspeech.bytedance.com/api/v1', model: 'volcano_tts', voice: 'zh_female_xiaohe_uranus_bigtts', site: 'https://console.volcengine.com/speech/app', fields: [['appId', 'App ID']], note: '在火山引擎「语音技术」里建应用，拿到 App ID 和 Access Token（填在密钥里）。' },
    { v: 'custom-tts', label: '第三方（OpenAI 兼容）', base: '', model: 'tts-1', voice: 'alloy', site: '', custom: true },
  ],
};

/** 找出这次该用哪个连接：聊天自己的 → 应用的 → 全局默认。kind = text / image / tts / embed（「其他」线：向量记忆） */
export function resolveConn(kind = 'text', app = 'chat', override = 'follow') {
  if (kind === 'embed') return connOfTag('向量');
  const list = state.connections[kind] || [];
  const pick = id => list.find(c => c.id === id);
  if (override && override !== 'follow' && pick(override)) return pick(override);
  const appSel = state.apps[app] && state.apps[app].conn && state.apps[app].conn[kind];
  if (appSel && appSel !== 'follow' && pick(appSel)) return pick(appSel);
  return pick(state.connections.defaults[kind]) || list[0] || null;
}
/** 每根线「断线了怎么办」：{ retry 失败了自动重试, max 最多几次, on 改用副 API, id 副 API 是哪个 }，存在 retry.fb[kind]。
 *  聊天的以前直接存在 retry 上（on / max / fallback / backup），第一次读时搬过来 */
export function failCfg(kind) {
  const R = state.connections.retry, F = R.fb || (R.fb = {});
  return F[kind] || (F[kind] = kind === 'text' ? { retry: R.on !== false, max: R.max || 1, on: !!R.fallback, id: R.backup || '' } : { retry: true, max: 1, on: false, id: '' });
}
/** 这根线断了改用的副 API（开了、也选了才有） */
export function backupOf(kind) {
  const b = failCfg(kind);
  return b.on ? (state.connections[kind] || []).find(c => c.id === b.id) || null : null;
}
/** 「其他」线上的接口：自己写的标签，没写就用这一类默认的 */
export const tagOf = c => c.tag || (CHANNELS.embed.find(x => x.v === c.type) || {}).tag || '其他';
/** 「其他」线分叉，每个标签一股；defaults['aux:标签'] = 这股插在哪个接口上 */
export const auxKey = tag => 'aux:' + tag;
export const connOfTag = tag => (state.connections.embed || []).find(c => c.id === state.connections.defaults[auxKey(tag)] && tagOf(c) === tag) || null;
export function connLabel(c) { return c ? c.name : '未设置'; }

const trim = s => String(s || '').replace(/\/+$/, '');
// OpenAI 兼容的地址只填了域名（https://xxx.com/）：接口都在 /v1 下面，自动补上
const oaiBase = s => (s = trim(s), /^https?:\/\/[^/]+$/i.test(s) ? s + '/v1' : s);
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

/** 按这根线的设置，网络出错、服务器忙时再试几次（密钥不对不白试） */
async function withRetry(kind, app, fn) {
  const F = failCfg(kind), tries = 1 + (F.retry !== false ? Math.max(0, F.max | 0 || 1) : 0);
  for (let t = 0; ; t++) {
    try { return await fn(); }
    catch (e) { if (!isRetryErr(e.message) || t >= tries - 1) throw e; log('warn', app, `第 ${t + 1} 次失败，再试一次：${e.message}`); await sleep(800 * (t + 1)); }
  }
}
/**
 * 生成文字。返回字符串。
 * 会自动：多把密钥轮着用（某把被拒就换下一把）、失败按设置重试、聊天线断了改用选好的副 API。
 */
export async function generate(opts) {
  const { conn, app = '聊天' } = opts;
  if (!conn) throw new Error('还没有设置可用的连接');
  let last = null;
  try { return await withRetry('text', app, () => generateOnce(opts)); } catch (e) { last = e; }
  if (last.message === '已中止') throw last;   // 自己点了中止：不换副 API
  // 聊天线断了 → 改用选好的副 API（只换一次，不来回换）
  const bk = backupOf('text');
  if (bk && !opts.noFallback && bk.id !== conn.id && (bk.type !== 'tavern' || inTavern())) {
    log('warn', app, `「${conn.name}」连不上，改用副 API「${bk.name}」`);
    return generateOnce({ ...opts, conn: bk, noFallback: true });
  }
  throw last;
}
async function generateOnce({ conn, system = '', prompt = '', temperature, maxTokens = 700, app = '聊天', stop, onPart }) {
  const P = conn.params || {};
  const temp = temperature ?? P.temperature ?? conn.temperature ?? 0.9;
  const think = THINK[P.thinking] || 0;
  const stream = conn.stream !== false;   // 默认流式：边生成边收，长回复不容易超时
  const keys = keysOf(conn);
  let ki = Math.min(conn.keyIdx || 0, Math.max(0, keys.length - 1));
  // 日志里记一条调用：发出去的、流式收到的、结果；点中止就断开
  const call = startCall({ app, src: conn.type === 'tavern' ? '酒馆当前连接' : conn.name, model: conn.model || '', req: (system ? `【系统】\n${system}\n\n` : '') + prompt });
  const signal = call.signal, part = onPart ? t => { call.part(t); onPart(t); } : call.part;
  stop && stop.addEventListener('abort', () => abortCall(call.id), { once: true });   // 页面上的「取消」：和日志里点中止一样
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
      else out = await orAbort(generateTavern({ system, prompt, maxTokens }), signal);
    } else if (conn.type === 'tavern-profile') {
      const pf = tavernProfiles().list.find(x => x.id === conn.profileId);
      if (!pf) throw new Error(`酒馆里找不到「${conn.name}」这个连接配置了`);
      out = await orAbort(generateWithProfile(pf, { system, prompt, maxTokens }), signal);
    } else if (OAI(conn.type)) {
      out = await withKey(async key => {
        const body = { model: conn.model, temperature: temp, max_tokens: maxTokens, stream, messages: [system && { role: 'system', content: system }, { role: 'user', content: prompt }].filter(Boolean) };
        if (think) { body.reasoning_effort = P.thinking; delete body.temperature; body.max_completion_tokens = maxTokens + think; delete body.max_tokens; }
        const res = await xf(oaiBase(conn.base) + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await readErr(res));
        return readOut(res, j => j.choices?.[0]?.delta?.content, j => j.choices?.[0]?.message?.content, part);
      });
    } else if (conn.type === 'claude') {
      out = await withKey(async key => {
        // 提示词缓存：人设 / 设定这类每次都一样的东西走缓存，便宜又快
        const sys = !system ? undefined : (conn.adv && conn.adv.cache) ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
        const body = { model: conn.model, max_tokens: maxTokens + think, system: sys, stream, messages: [{ role: 'user', content: prompt }] };
        if (think) body.thinking = { type: 'enabled', budget_tokens: think }; else body.temperature = Math.min(1, temp);
        const res = await xf(trim(conn.base || 'https://api.anthropic.com') + '/v1/messages', {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await readErr(res));
        return readOut(res, j => j.type === 'content_block_delta' && j.delta?.type === 'text_delta' ? j.delta.text : '', j => (j.content || []).filter(p => p.type === 'text').map(p => p.text).join(''), part);
      });
    } else if (conn.type === 'gemini') {
      out = await withKey(async key => {
        const gc = { temperature: temp, maxOutputTokens: maxTokens + think };
        if (think) gc.thinkingConfig = { thinkingBudget: think };
        const url = `${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models/${encodeURIComponent(conn.model)}:${stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${encodeURIComponent(key)}`;
        const res = await xf(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc }) });
        if (!res.ok) throw new Error(await readErr(res));
        const parts = j => (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        return readOut(res, parts, parts, part);
      });
    } else throw new Error('这个渠道还不能用来生成文字：' + conn.type);
    call.done(String(out || '').trim());
    return String(out || '').trim();
  } catch (e) {
    const msg = e && e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : (e && e.message) || String(e);
    call.fail(msg);
    throw Object.assign(new Error(msg), { logId: call.id });   // 报错里的「查看日志」直接跳到这一条
  }
}

/** OpenAI 格式的几家：官方、DeepSeek、第三方中转 */
const OAI = t => t === 'openai' || t === 'deepseek' || t === 'openai-compat';
/** 读回复：流式就一段段拼起来（data: {...}），服务器没按流式回就当普通 JSON 读 */
async function readOut(res, pickDelta, pickWhole, onPart = () => {}) {
  if (!res.body || /application\/json/.test(res.headers.get('content-type') || '')) return pickWhole(await res.json()) ?? '';
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '', raw = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; raw += piece;
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      const m = /^data:\s*(.*)$/.exec(l.trim()); if (!m || m[1] === '[DONE]') continue;
      try { out += pickDelta(JSON.parse(m[1])) || ''; } catch (e) { /* 半截的行，等下一段 */ }
    }
    onPart(out);
  }
  if (!out && /^\s*\{/.test(raw)) { try { return pickWhole(JSON.parse(raw)) ?? ''; } catch (e) { /* 不是 JSON */ } }
  return out;
}

/** 拉取模型列表 */
// 生图、语音、向量里也是 OpenAI 格式的：模型列表一样从 /models 拉
const OAI_LIST = new Set(['openai-image', 'image-compat', 'siliconflow', 'openai-tts', 'custom-tts', 'indextts', 'siliconflow-embed', 'openai-embed', 'openai-realtime', 'other-compat']);
/** 拉模型列表：能从网上拉的就拉，没有列表接口的给出这家固定的那几个。失败了记进日志 */
export async function listModels(conn) {
  try { return await pullModels(conn); }
  catch (e) {
    const msg = e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : e.message;
    log('error', '连接', `拉取模型失败（${conn.name || conn.type}）：${msg}`);
    throw new Error(msg);
  }
}
async function pullModels(conn) {
  if (OAI(conn.type) || OAI_LIST.has(conn.type)) {
    const res = await xf(oaiBase(conn.base) + '/models', { headers: { Authorization: 'Bearer ' + (conn.key || '') } });
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(), ids = (j.data || []).map(m => m.id).sort();
    return conn.type === 'openai-realtime' ? ids.filter(m => /realtime|live/i.test(m)) : ids;
  }
  if (conn.type === 'claude') {
    const res = await xf(trim(conn.base || 'https://api.anthropic.com') + '/v1/models', { headers: { 'x-api-key': conn.key || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(); return (j.data || []).map(m => m.id);
  }
  if (conn.type === 'gemini' || conn.type === 'gemini-live') {   // Live 只列能实时对话（bidiGenerateContent）的
    const res = await xf(`${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models?key=${encodeURIComponent(conn.key || '')}`);
    if (!res.ok) throw new Error(await readErr(res));
    const how = conn.type === 'gemini-live' ? 'bidiGenerateContent' : 'generateContent';
    const j = await res.json(); return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes(how)).map(m => m.name.replace(/^models\//, ''));
  }
  // 本地 SD / ComfyUI：拉的是装好的底模
  if (conn.type === 'sd-webui') { const res = await xf(trim(conn.base) + '/sdapi/v1/sd-models'); if (!res.ok) throw new Error(await readErr(res)); return (await res.json()).map(m => m.title || m.model_name); }
  if (conn.type === 'comfyui') { const res = await xf(trim(conn.base) + '/object_info/CheckpointLoaderSimple'); if (!res.ok) throw new Error(await readErr(res)); const j = await res.json(); return (((j.CheckpointLoaderSimple || {}).input || {}).required || {}).ckpt_name?.[0] || []; }
  // Fish、ElevenLabs 有自己的模型列表接口（照旧版小手机的拉法）
  const tt = conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type;
  if (tt === 'fish') { const res = await xf(trim(conn.base || 'https://api.fish.audio').replace(/\/v1$/, '') + '/compat/v1/models'); if (!res.ok) throw new Error(await readErr(res)); return ((await res.json()).data || []).map(m => String(m.id).replace(/^fish-audio\//, '')); }
  if (tt === 'elevenlabs') {
    const res = await xf(trim(conn.base || 'https://api.elevenlabs.io') + '/v1/models', { headers: { 'xi-api-key': keysOf(conn)[0] || '' } }); if (!res.ok) throw new Error(await readErr(res));
    return (await res.json()).filter(m => m.can_do_text_to_speech !== false).map(m => m.model_id);
  }
  // 没有「模型列表」接口的（NovelAI、MiniMax、豆包…）：模型就那几个，直接列出来
  return KNOWN_MODELS[tt] || [];
}
const KNOWN_MODELS = {
  novelai: ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-3', 'nai-diffusion-furry-3'],
  'doubao-tts': ['volcano_tts'], 'zhipu-embed': ['embedding-3', 'embedding-2'],
  'minimax-cn': ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo', 'speech-01-hd', 'speech-01-turbo'], mimo: ['mimo-v2.5-tts'],
};
KNOWN_MODELS['minimax-intl'] = KNOWN_MODELS['minimax-cn'];

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

/* ---------- 生图：每个渠道的请求格式不一样，这里一个个对上 ---------- */
const sizeOf = c => (c.img && c.img.size) || c.size || '1024x1024';
const ratioOf = size => { const [w, h] = size.split('x').map(Number); return w === h ? '1:1' : w > h ? '3:2' : '2:3'; };
const b64png = b => 'data:image/png;base64,' + b;
const blobUrl = async res => URL.createObjectURL(await res.blob());
/** NovelAI 返回的是一个 zip，里面一张 png：手动拆开 */
async function firstFileInZip(buf) {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x04034b50) throw new Error('NovelAI 返回的不是图片压缩包');
  const method = v.getUint16(8, true), csize = v.getUint32(18, true), nlen = v.getUint16(26, true), xlen = v.getUint16(28, true);
  const start = 30 + nlen + xlen, data = new Uint8Array(buf, start, csize || buf.byteLength - start);
  if (method === 0) return new Blob([data], { type: 'image/png' });
  const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Blob([await new Response(ds).arrayBuffer()], { type: 'image/png' });
}
/** ComfyUI 没粘工作流时用的最简单的文生图流程（底模 → 正负提示词 → 采样 → 存图） */
function comfyDefault({ model, full, neg, W, H, steps, scale, sampler }) {
  if (!model) throw new Error('ComfyUI 要先在「模型」里选一个底模（点拉取）');
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: W, height: H, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: full, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: neg, clip: ['4', 1] } },
    3: { class_type: 'KSampler', inputs: { seed: Math.floor(Math.random() * 1e9), steps, cfg: scale, sampler_name: sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'asterphone', images: ['8', 0] } },
  };
}
/** 把图片存成能长期留着的格式：临时链接（硅基 1 小时过期）、本页才有效的 blob 地址都转成 data 地址；网站不让读就原样用 */
async function keep(url) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const b = await (await xf(url)).blob();
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  } catch (e) { return url; }
}
/** 聊天接口生图：回复里找图片（markdown 图片、图片链接、data 地址，或者 images 字段） */
function imageInReply(j) {
  const m = (j.choices || [])[0]?.message || {};
  const img = (m.images || [])[0]; if (img) return img.image_url?.url || img.url || '';
  const text = Array.isArray(m.content) ? m.content.map(x => x.text || x.image_url?.url || '').join('\n') : String(m.content || '');
  const hit = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(text) || /(data:image\/[\w+]+;base64,[\w+/=]+)/.exec(text) || /(https?:\/\/\S+?\.(?:png|jpe?g|webp|gif)(?:\?\S*)?)(?=[\s)"']|$)/i.exec(text);
  return hit ? hit[1] : '';
}
export async function generateImage(prompt, app = '聊天', connIn, stop) {
  const conn = connIn || resolveConn('image', 'chat');
  if (!conn) throw new Error('还没有生图连接：设置 → 连接 → 生图 里插一根线');
  try { return await withRetry('image', app, () => imageOnce(prompt, app, conn, stop)); }
  catch (e) {   // 生图线断了 → 改用选好的副 API（只换一次）；自己点了中止不换
    const bk = backupOf('image'); if (!bk || bk.id === conn.id || e.message === '已中止') throw e;
    log('warn', app, `「${conn.name}」生图失败，改用副 API「${bk.name}」`);
    return imageOnce(prompt, app, bk, stop);
  }
}
/** 真正发出去的正面 / 负面提示词：画师串 + 质量词 + 这次的画面 */
function imgPrompt(conn, prompt) {
  const I = conn.img || {}, quality = I.quality ?? (conn.type === 'novelai' ? 'masterpiece, best quality, very aesthetic' : '');
  return { full: [I.tags, quality, prompt].filter(Boolean).join(', '), neg: I.neg || '' };
}
/** 一次生图记成日志里的一条调用 */
async function imageOnce(prompt, app, conn, stop) {
  const { full, neg } = imgPrompt(conn, prompt);
  const call = startCall({ app, what: '生图', src: conn.name, model: conn.model || '', req: full + (neg ? `\n\n【负面】\n${neg}` : '') });
  stop && stop.addEventListener('abort', () => abortCall(call.id), { once: true });
  try { const u = await orAbort(imageRaw(prompt, conn), call.signal); call.done('[一张图片]'); return u; }
  catch (e) { call.fail(e.message); throw Object.assign(e, { logId: call.id }); }
}
async function imageRaw(prompt, conn) {
  const I = conn.img || {}, size = sizeOf(conn), [W, H] = size.split('x').map(n => Math.round((+n || 1024) / 64) * 64);
  const { full, neg } = imgPrompt(conn, prompt);
  const key = keysOf(conn)[0] || '', base = trim(conn.base);
  const fail = async res => { throw new Error(await readErr(res)); };
  try {
    switch (conn.type) {
      case 'novelai': {
        const res = await xf(base + '/ai/generate-image', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ input: full, model: conn.model || 'nai-diffusion-4-5-full', action: 'generate', parameters: {
            params_version: 3, width: W, height: H, scale: +I.scale || 5, sampler: I.sampler || 'k_euler_ancestral', steps: Math.min(+I.steps || 28, 50), n_samples: 1, ucPreset: 0, qualityToggle: !I.quality, negative_prompt: neg,
            v4_prompt: { caption: { base_caption: full, char_captions: [] }, use_coords: false, use_order: true },
            v4_negative_prompt: { caption: { base_caption: neg, char_captions: [] }, legacy_uc: false } } }) });
        if (!res.ok) await fail(res);
        return keep(URL.createObjectURL(await firstFileInZip(await res.arrayBuffer())));
      }
      case 'siliconflow': {
        const res = await xf(base + '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: conn.model, prompt: full, negative_prompt: neg || undefined, image_size: `${W}x${H}`, batch_size: 1, num_inference_steps: +I.steps || 20, guidance_scale: +I.scale || 7.5 }) });
        if (!res.ok) await fail(res);
        const j = await res.json(); const u = j.images?.[0]?.url || j.data?.[0]?.url; if (!u) throw new Error('硅基流动没有返回图片'); return keep(u);
      }
      case 'sd-webui': {
        const res = await xf(base + '/sdapi/v1/txt2img', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: full, negative_prompt: neg, width: W, height: H, steps: +I.steps || 20, sampler_name: I.sampler || 'Euler a', cfg_scale: +I.scale || 7,
            ...(conn.model ? { override_settings: { sd_model_checkpoint: conn.model } } : {}) }) });
        if (!res.ok) await fail(res);
        const j = await res.json(); if (!j.images?.[0]) throw new Error('SD 没有返回图片'); return b64png(j.images[0]);
      }
      case 'comfyui': {
        const p = { model: conn.model, full, neg, W, H, steps: +I.steps || 20, scale: +I.scale || 7, sampler: I.sampler || 'euler_ancestral' };
        // 自己的工作流：占位符换成这次的值（数字的连引号一起换，免得变成字符串）
        const fill = s => [['prompt', JSON.stringify(full).slice(1, -1)], ['negative_prompt', JSON.stringify(neg).slice(1, -1)], ['negative', JSON.stringify(neg).slice(1, -1)], ['model', p.model || ''], ['sampler', p.sampler]]
          .reduce((t, [k, v]) => t.replaceAll(`%${k}%`, v), [['seed', Math.floor(Math.random() * 1e9)], ['width', W], ['height', H], ['steps', p.steps], ['scale', p.scale]]
            .reduce((t, [k, v]) => t.replaceAll(`"%${k}%"`, String(v)).replaceAll(`%${k}%`, String(v)), s));
        const wf = I.workflow && I.workflow.trim() ? JSON.parse(fill(I.workflow)) : comfyDefault(p);
        const r1 = await xf(base + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf }) });
        if (!r1.ok) await fail(r1);
        const id = (await r1.json()).prompt_id;
        for (let i = 0; i < 180; i++) {
          await sleep(1000);
          const hj = await (await xf(`${base}/history/${id}`)).json(), outs = hj[id] && hj[id].outputs;
          const img = outs && Object.values(outs).flatMap(o => o.images || [])[0];
          if (img) return keep(`${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}`);
        }
        throw new Error('ComfyUI 等了 3 分钟还没出图');
      }
      default: {     // OpenAI 官方 / 第三方：默认走 /images/generations；有的中转站只能走聊天接口出图
        if (I.mode === 'chat') {
          const res = await xf(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify({ model: conn.model || undefined, stream: false, messages: [{ role: 'user', content: full + (neg ? `\n\nAvoid: ${neg}` : '') + `\n\n(size ${W}x${H})` }] }) });
          if (!res.ok) await fail(res);
          const u = imageInReply(await res.json()); if (!u) throw new Error('聊天接口的回复里没有图片'); return keep(u);
        }
        const body = { model: conn.model || undefined, prompt: full + (neg ? `\n\nAvoid: ${neg}` : ''), n: 1, size: `${W}x${H}` };
        const res = await xf(base + '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
        if (!res.ok) await fail(res);
        const j = await res.json(), d = (j.data || [])[0] || {};
        if (d.b64_json) return b64png(d.b64_json);
        if (d.url) return keep(d.url);
        throw new Error('生图接口没有返回图片');
      }
    }
  } catch (e) {
    throw new Error(e && e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : (e && e.message) || String(e));
  }
}
/** 测生图接口：真画一张小图（Pollinations、本地的不花钱；付费的会花一张图的钱，所以先问） */
export async function testImage(conn) { return generateImage('a small cute star, simple icon', '设置', conn); }

/* ---------- 朗读：有语音连接就用它，没有就用浏览器自带的（免费） ---------- */
let playing = null;
const hexToBytes = hex => { const h0 = String(hex).replace(/^0x/, '').replace(/\s/g, ''); const out = new Uint8Array(h0.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(h0.substr(i * 2, 2), 16); return out; };
const b64ToBlob = (b64, type = 'audio/mpeg') => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
// 有的接口（或中转站、酒馆代理）出错时也回 200，内容是一段字；这种当成错误，把那段字说出来
const audioOf = async res => {
  const b = await res.blob();
  if (!b.size) throw new Error('返回的声音是空的');
  if (b.type && !/^audio\/|octet-stream|mpeg/.test(b.type)) throw new Error(`返回的不是声音（${b.type}）：${(await b.text()).slice(0, 160)}`);
  return URL.createObjectURL(b);
};
/** 用某个语音接口把一段文字变成声音，返回可以播放的地址 */
/** 一次合成语音记成日志里的一条调用 */
export async function synthesize(conn, text, opts = {}) {
  const call = startCall({ app: '语音', what: '合成语音', src: conn.name, model: conn.model || '', req: text + (opts.voice || (conn.tts || {}).voice ? `\n\n（音色：${opts.voice || conn.tts.voice}）` : '') });
  opts.stop && opts.stop.addEventListener('abort', () => abortCall(call.id), { once: true });
  try { const u = await orAbort(synthRaw(conn, text, opts), call.signal); call.done('[一段声音]'); return u; }
  catch (e) { call.fail(e.message); throw Object.assign(e, { logId: call.id }); }
}
async function synthRaw(conn, text, { voice } = {}) {
  const T = conn.tts || {}, v = voice || T.voice || conn.voice || (CHANNELS.tts.find(x => x.v === conn.type) || {}).voice || '';
  const key = keysOf(conn)[0] || '', base = trim(conn.base), speed = T.speed || 1;
  const bad = async res => { throw new Error(await readErr(res)); };
  // 第三方可以选「接口格式」：中转站转发的是 MiniMax / Fish / ElevenLabs 的格式时，照那家的发
  switch (conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type) {
    case 'minimax-cn': case 'minimax-intl': {
      const res = await xf(`${base}/v1/t2a_v2${conn.groupId ? '?GroupId=' + encodeURIComponent(conn.groupId) : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: conn.model || 'speech-2.8-hd', text, stream: false, voice_setting: { voice_id: v || 'female-shaonv', speed, vol: Math.max(.1, (T.volume ?? 1) * 1), pitch: T.pitch || 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 } }) });
      if (!res.ok) await bad(res);
      const j = await res.json(); if (j.base_resp && j.base_resp.status_code) throw new Error(`${j.base_resp.status_code} ${j.base_resp.status_msg}`);
      if (!j.data || !j.data.audio) throw new Error('MiniMax 没有返回声音');
      return URL.createObjectURL(new Blob([hexToBytes(j.data.audio)], { type: 'audio/mpeg' }));
    }
    case 'fish': {   // 走 Fish 的 OpenAI 兼容地址：网页能直接连（/v1/tts 会被跨域拦，Tauri Tavern 又没有代理），旧小手机也是这样
      const res = await xf(base.replace(/\/v1$/, '') + '/compat/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'fish-audio/' + String(conn.model || 's2.1-pro').replace(/^fish-audio\//, ''), input: text, voice: v || '', response_format: 'mp3', ...(speed !== 1 && { speed }) }) });
      if (!res.ok) await bad(res); return audioOf(res);
    }
    case 'elevenlabs': {
      const res = await xf(`${base}/v1/text-to-speech/${encodeURIComponent(v || 'JBFqnCBsd6RMkjVDRZzb')}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text, model_id: conn.model || 'eleven_multilingual_v2', voice_settings: { speed } }) });
      if (!res.ok) await bad(res); return audioOf(res);
    }
    case 'mimo': {
      const res = await xf(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: conn.model || 'mimo-v2.5-tts', messages: [{ role: 'assistant', content: text }], audio: { format: 'mp3', voice: v || 'mimo_default' } }) });
      if (!res.ok) await bad(res);
      const j = await res.json(), d = j.choices?.[0]?.message?.audio?.data; if (!d) throw new Error('MiMo 没有返回声音');
      return URL.createObjectURL(b64ToBlob(d));
    }
    case 'doubao-tts': {
      if (!conn.appId) throw new Error('豆包要填 App ID');
      if (conn.ver !== 'v1') {   // V3 单向流式（2.0 音色）：一行一个 JSON，声音分段放在 data 里
        const res = await xf(base.replace(/\/api\/v\d\/?$/, '') + '/api/v3/tts/unidirectional', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-App-Id': conn.appId, 'X-Api-Access-Key': key, 'X-Api-Resource-Id': conn.resId || 'seed-tts-2.0' },
          body: JSON.stringify({ user: { uid: 'asterphone' }, req_params: { text, speaker: v || 'zh_female_xiaohe_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((speed - 1) * 100) } } }) });
        if (!res.ok) await bad(res);
        const parts = (await res.text()).match(/\{[^{}]*\}/g) || [], bytes = [];
        for (const t of parts) { const j = JSON.parse(t); if (j.data) bytes.push(b64ToBlob(j.data)); else if (j.code && j.code !== 20000000) throw new Error(`${j.code} ${j.message || ''}`); }
        if (!bytes.length) throw new Error('豆包没有返回声音');
        return URL.createObjectURL(new Blob(bytes, { type: 'audio/mpeg' }));
      }
      const res = await xf(base + '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer;' + key },
        body: JSON.stringify({ app: { appid: conn.appId, token: key, cluster: conn.model || 'volcano_tts' }, user: { uid: 'asterphone' },
          audio: { voice_type: v || 'BV001_streaming', encoding: 'mp3', speed_ratio: speed }, request: { reqid: Math.random().toString(36).slice(2) + Date.now(), text, operation: 'query' } }) });
      if (!res.ok) await bad(res);
      const j = await res.json(); if (j.code !== 3000 || !j.data) throw new Error(`${j.code} ${j.message || '豆包没有返回声音'}`);
      return URL.createObjectURL(b64ToBlob(j.data));
    }
    default: {   // OpenAI、IndexTTS 本地、第三方：/audio/speech
      const res = await xf(base + '/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({ model: conn.model || 'tts-1', input: text, voice: v || 'alloy', speed }) });
      if (!res.ok) await bad(res); return audioOf(res);
    }
  }
}
/* ---------- 采样器：NovelAI 是固定几个；本地 SD / ComfyUI 问它自己装了哪些 ---------- */
export const SAMPLERS = {
  novelai: ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m', 'k_dpmpp_2m_sde', 'k_dpmpp_sde'],
  'sd-webui': ['Euler a', 'Euler', 'DPM++ 2M', 'DPM++ SDE', 'DPM++ 2M SDE', 'DDIM', 'UniPC'],
  comfyui: ['euler_ancestral', 'euler', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'ddim', 'uni_pc'],
};
export async function listSamplers(conn) {
  const base = trim(conn.base);
  try {
    if (conn.type === 'sd-webui') { const res = await xf(base + '/sdapi/v1/samplers'); if (!res.ok) throw new Error(await readErr(res)); return (await res.json()).map(x => x.name); }
    if (conn.type === 'comfyui') { const res = await xf(base + '/object_info/KSampler'); if (!res.ok) throw new Error(await readErr(res)); return (await res.json()).KSampler.input.required.sampler_name[0]; }
  } catch (e) { log('warn', '连接', `问不到「${conn.name || conn.type}」的采样器，先列常用的：${e.message}`); }
  return SAMPLERS[conn.type] || [];
}
/* ---------- 音色：每家常用的列成表（快选）；能从网上拉的就拉（拉取） ---------- */
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map(v => [v, v]);
const MINIMAX_VOICES = [['female-shaonv', '少女'], ['female-yujie', '御姐'], ['female-chengshu', '成熟女性'], ['female-tianmei', '甜美女性'], ['male-qn-qingse', '青涩青年'], ['male-qn-jingying', '精英青年'],
  ['male-qn-badao', '霸道青年'], ['male-qn-daxuesheng', '青年大学生'], ['presenter_male', '男性主持人'], ['presenter_female', '女性主持人'], ['audiobook_male_1', '男性有声书'], ['audiobook_female_1', '女性有声书']];
export const VOICES = {
  'openai-tts': OPENAI_VOICES, 'custom-tts': OPENAI_VOICES, 'minimax-cn': MINIMAX_VOICES, 'minimax-intl': MINIMAX_VOICES,
  elevenlabs: [['EXAVITQu4vr4xnSDxMaL', 'Sarah · 女'], ['FGY2WhTYpPnrIDTdsKH5', 'Laura · 女'], ['XB0fDUnXU5powFXDhCwa', 'Charlotte · 女'], ['Xb7hH8MSUJpSbSDYk0k2', 'Alice · 女'], ['XrExE9yKIg1WjnnlVkGX', 'Matilda · 女'], ['cgSgspJ2msm6clMCkdW9', 'Jessica · 女'], ['pFZP5JQG7iQjIQuC4Bku', 'Lily · 女'],
    ['JBFqnCBsd6RMkjVDRZzb', 'George · 男'], ['IKne3meq5aSn9XLyUdCD', 'Charlie · 男'], ['N2lVS1w4EtoT3dr4eOWO', 'Callum · 男'], ['TX3LPaxmHKxFdv7VOQHJ', 'Liam · 男'], ['bIHbv24MWmeRgasZH58o', 'Will · 男'], ['cjVigY5qzO86Huf0OWal', 'Eric · 男'], ['iP95p4xoKVk53GoZ742B', 'Chris · 男'], ['nPczCjzI2devNBz1zQrb', 'Brian · 男'], ['onwK4e9ZLuTAKqWW03F9', 'Daniel · 男']],
  'doubao-tts': [['zh_female_xiaohe_uranus_bigtts', '小何（2.0）'], ['BV001_streaming', '通用女声（1.0）'], ['BV002_streaming', '通用男声（1.0）']],
  mimo: [['冰糖', '冰糖 · 中文女声'], ['茉莉', '茉莉 · 中文女声'], ['苏打', '苏打 · 中文男声'], ['白桦', '白桦 · 中文男声'], ['Mia', 'Mia · 英文女声'], ['Chloe', 'Chloe · 英文女声'], ['Milo', 'Milo · 英文男声'], ['Dean', 'Dean · 英文男声'], ['mimo_default', '默认音色']],
};
/** 从网上拉音色列表：[{ id, name }]；这家拉不了返回 null */
export async function listVoices(conn) {
  const key = keysOf(conn)[0] || '', base = trim(conn.base), type = conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type;
  const get = async (url, opts) => { const res = await xf(url, opts); if (!res.ok) throw new Error(await readErr(res)); return res.json(); };
  try {
    if (type === 'minimax-cn' || type === 'minimax-intl') {
      const j = await get(base.replace(/\/v1(\/t2a_v2)?$/, '') + '/v1/get_voice', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ voice_type: 'all' }) });
      if (j.base_resp && j.base_resp.status_code) throw new Error(`MiniMax ${j.base_resp.status_code}：${j.base_resp.status_msg}`);
      return [...(j.voice_cloning || []).map(x => ({ id: x.voice_id, name: x.voice_id + ' · 复刻' })), ...(j.voice_generation || []).map(x => ({ id: x.voice_id, name: x.voice_id + ' · 设计' })),
        ...(j.system_voice || []).map(x => ({ id: x.voice_id, name: x.voice_name || x.voice_id }))];
    }
    if (type === 'fish') {   // 有密钥先列「我的音色」，没有就列热门的
      const fb = base.replace(/\/v1$/, ''), list = async q => (await get(fb + '/model?' + q, { headers: key ? { Authorization: 'Bearer ' + key } : {} })).items || [];
      let L = key ? await list('self=true&page_size=50') : []; const mine = L.length;
      if (!L.length) L = await list('page_size=40&sort_by=task_count');
      return L.map(x => ({ id: x._id, name: (x.title || x._id) + (mine ? '' : ' · 热门') }));
    }
    if (type === 'elevenlabs') {
      const j = await get(base + '/v2/voices?page_size=100', { headers: { 'xi-api-key': key } });
      return (j.voices || []).map(x => ({ id: x.voice_id, name: x.name + (x.labels && x.labels.gender ? ' · ' + ({ female: '女', male: '男' }[x.labels.gender] || x.labels.gender) : '') + (x.category === 'premade' ? '' : ' · 我的') }));
    }
  } catch (e) {
    const msg = e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : e.message;
    log('error', '连接', `拉取音色失败（${conn.name || conn.type}）：${msg}`);
    throw new Error(msg);
  }
  return null;
}
/** 试听：用这个接口、这个音色念一句 */
export async function tryVoice(conn, voice, text = '你好呀，能听到我说话吗？', stop) {
  try {
    const url = await Promise.race([synthesize(conn, text, { voice, stop }), new Promise((_, no) => setTimeout(() => no(new Error('等了 40 秒还没合成好')), 40000))]);
    if (stop && stop.aborted) return;
    stopSpeak(); const a = new Audio(url); a.volume = Math.min(1, (conn.tts && conn.tts.volume) ?? 1); playing = a;
    await a.play().catch(e => { throw new Error(e.name === 'NotAllowedError' ? '浏览器没让出声，再点一次' : `合成好了但播不出来（${e.name}：${e.message}）`); });
  } catch (e) { if (!e.logId) log('warn', '语音', `「${conn.name}」试听失败：${e.message}`); throw e; }   // 合成那一步失败的，调用记录里已经有了
}
/** 测语音接口：说一句「你好呀」并播出来 */
export async function testVoice(conn) {
  const url = await synthesize(conn, '你好呀，能听到我说话吗？');
  stopSpeak(); const a = new Audio(url); a.volume = Math.min(1, (conn.tts && conn.tts.volume) ?? 1); playing = a; await a.play().catch(() => {});
  return url;
}
/** 朗读：有语音连接就用它，失败或没有就用浏览器自带的（免费）。
 *  cache：聊天里的语音消息传一个钥匙，合成好的声音存在这台设备上，以后再放不用再合成（不再花钱）；silent：只合成存起来，不放 */
export async function speak(text, opts = {}) {
  if (opts.silent) return speakRaw(text, opts);
  // 开口前告诉别人（音乐会先停一下），说完再告诉一声
  const say = d => { try { (window.parent || window).dispatchEvent(new CustomEvent('asterphone-voice', { detail: d })); } catch (e) { /* 拿不到酒馆页面就算了 */ } };
  say('start');
  try { return await speakRaw(text, opts); } finally { say('end'); }
}
async function speakRaw(text, { voice, conn = resolveConn('tts', 'chat'), cache, silent, stop } = {}) {
  if (!silent) stopSpeak();
  const play = async (url, c) => {
    if (cache) await kvSet(cache, await (await fetch(url)).blob()).catch(e => log('warn', '语音', '合成好的声音没存上：' + e.message));
    if (silent || (stop && stop.aborted)) return;
    const a = new Audio(url); a.volume = Math.min(1, (c && c.tts && c.tts.volume) ?? 1); playing = a; await a.play();
    return new Promise(r => { a.onended = r; a.onerror = r; a.onpause = r; });   // 被停掉（stopSpeak）也算念完，不然等它的地方会一直卡着
  };
  const saved = cache && await kvGet(cache).catch(() => null);
  if (saved) { cache = null; return play(URL.createObjectURL(saved), conn); }
  if (conn) {
    try { return await play(await withRetry('tts', '语音', () => synthesize(conn, text, { voice, stop })), conn); }
    catch (e) {
      if (stop && stop.aborted) return;   // 自己点了停：不换副 API、不用浏览器念
      log('warn', '语音', `「${conn.name}」朗读失败：` + (e.message === 'Failed to fetch' ? '连不上（可能是跨域限制）' : e.message));
      const bk = backupOf('tts');   // 语音线断了 → 先换副 API（用它自己的音色），再不行才用浏览器朗读
      if (bk && bk.id !== conn.id) try {
        const r = await play(await synthesize(bk, text), bk);
        log('warn', '语音', `改用副 API「${bk.name}」`);
        return r;
      } catch (e2) { log('warn', '语音', `副 API「${bk.name}」也失败了：${e2.message}`); }
      if (silent) return;   // 只是先合成好：浏览器朗读存不下来，等点播放再说
      log('warn', '语音', '改用浏览器朗读');
    }
  }
  if (silent) return;
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

/**
 * 把常用的生图、语音渠道都先建好（没密钥的写着「还没填密钥」，填了就能用）。
 * 每个渠道只加一次，删了就不会再加回来；以前版本多建的（现在不在名单里、也没填密钥的）顺手拿掉。
 */
export function seedChannels() {
  const C = state.connections; let changed = false;
  C.seeded = C.seeded || {};
  // 以前「GPT / OpenAI 兼容」一个类型包了官方和中转站：地址不是 OpenAI 官方的，改成「第三方」
  for (const c of C.text) if (c.type === 'openai' && c.base && !/api\.openai\.com/.test(c.base)) { c.type = 'openai-compat'; changed = true; }
  // 豆包以前只有 V1：已经填好密钥的老接口继续用 V1，新的默认 V3（2.0 音色）
  for (const c of C.tts) if (c.type === 'doubao-tts' && !c.ver && keysOf(c).length) { c.ver = 'v1'; changed = true; }
  // 生图、语音也一样拆成「OpenAI 官方」和「第三方」；以前自动建的那个改用新名字
  for (const [kind, from, to, old] of [['image', 'openai-image', 'image-compat', 'GPT / OpenAI 兼容'], ['tts', 'openai-tts', 'custom-tts', 'OpenAI']]) for (const c of C[kind]) {
    if (c.type !== from) continue;
    if (c.base && !/api\.openai\.com/.test(c.base)) { c.type = to; changed = true; }
    if (c.preset && c.name === old) { c.name = 'OpenAI 官方'; changed = true; }
  }
  C.embed = C.embed || [];
  for (const kind of ['image', 'tts', 'embed']) {
    const pre = kind === 'image' ? 'img_' : kind === 'tts' ? 'tts_' : 'emb_';
    for (let i = C[kind].length - 1; i >= 0; i--) {
      const c = C[kind][i];
      if (c.preset && !CHANNELS[kind].some(ch => ch.v === c.type) && !keysOf(c).length) {
        C[kind].splice(i, 1); for (const k of Object.keys(C.defaults)) if (C.defaults[k] === c.id) C.defaults[k] = ''; changed = true;
      }
    }
    for (const ch of CHANNELS[kind]) {
      if (ch.custom || C.seeded[pre + ch.v] || C[kind].some(c => c.type === ch.v)) { C.seeded[pre + ch.v] = true; continue; }
      C[kind].push({ id: pre + ch.v, name: ch.label, type: ch.v, base: ch.base, key: '', keys: [], model: ch.model || '', preset: true, ...(kind === 'tts' ? { tts: { voice: ch.voice || '', speed: 1, volume: 1 } } : {}) });
      C.seeded[pre + ch.v] = true; changed = true;
    }
  }
  // 「其他」线以前只有一个插头（defaults.aux，插的是向量）：搬到「向量」那一股；第一次默认插在硅基流动上
  const d = C.defaults;
  if (d.aux) { if (C.embed.some(c => c.id === d.aux) && !d[auxKey('向量')]) d[auxKey('向量')] = d.aux; d.aux = ''; changed = true; }
  if (!d[auxKey('向量')] && !C.seeded.embPlug && C.embed.some(c => c.id === 'emb_siliconflow-embed')) { d[auxKey('向量')] = 'emb_siliconflow-embed'; changed = true; }
  C.seeded.embPlug = true;
  return changed;
}
export const seedImageChannels = seedChannels;
/** 测 Gemini Live：开一条实时连接，发个开场，等它回「准备好了」就断开（不说话、不花钱） */
export function testLive(conn) {
  const url = trim(conn.base || 'https://generativelanguage.googleapis.com').replace(/^http/, 'ws') + '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(keysOf(conn)[0] || '');
  return new Promise((ok, no) => {
    const ws = new WebSocket(url), t = setTimeout(() => { ws.close(); no(new Error('等了 15 秒没回应')); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + conn.model } }));
    ws.onmessage = async e => {
      clearTimeout(t); const txt = typeof e.data === 'string' ? e.data : await e.data.text(); ws.close();
      if (/setupComplete/.test(txt)) ok(); else no(new Error(txt.slice(0, 160)));
    };
    ws.onclose = e => { clearTimeout(t); no(new Error(`连不上（${e.code}${e.reason ? ' ' + e.reason : ''}）`)); };   // 已经 ok 过再 no 不起作用
  });
}
/** 测 OpenAI 兼容的接口：拉一下模型列表，看密钥对不对、填的模型在不在 */
export async function testCompat(conn) {
  const models = await pullModels(conn);
  return conn.model && models.length && !models.includes(conn.model) ? `没找到模型「${conn.model}」` : '';
}
/** 测向量接口：把「你好」变成一串数字 */
export async function testEmbed(conn) {
  const key = keysOf(conn)[0] || '';
  const res = await xf(trim(conn.base) + '/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify({ model: conn.model, input: '你好' }) });
  if (!res.ok) throw new Error(await readErr(res));
  const j = await res.json(), v = j.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error('接口没有返回向量');
  return v.length;
}
