// AI 调用：按「连接」的渠道类型拼请求。
// 渠道：tavern（酒馆当前连接）/ openai（OpenAI 兼容）/ claude / gemini
import { state, commit, kvGet, kvSet } from './store.js';
import { withPreset } from './preset.js';
import { generateTavern, inTavern, tavernProfiles, generateWithProfile, tavernMainApi, ctx } from './bridge.js';
import { apiLog as log, log as note, startCall, orAbort, abortCall } from './log.js';
import { adapt, plain } from './act.js';
import { regexed } from './regex.js';

/** 直连被跨域拦住时，改走酒馆自带的 CORS 代理 /proxy/（酒馆 config.yaml 里 enableCorsProxy: true）。
 *  其他插件能连上、手机连不上，多半就是差在这一步。代理没开 / Tauri 酒馆没有代理时照常报错 */
export async function xf(url, o = {}) {
  try { return await fetch(url, o); }
  catch (e) {
    if ((o.signal && o.signal.aborted) || !/^https?:/i.test(url) || !inTavern()) throw e;
    // OpenAI 格式的聊天 / 拉模型：借酒馆自己「自定义（兼容 OpenAI）」那条路转一手。本地酒馆和 Tauri Tavern 都有，不用开代理
    const m = /^(.*)\/(chat\/completions|models)$/.exec(url), auth = o.headers && o.headers.Authorization;
    if (m && auth) return Object.assign(await viaTavern(m[1], m[2] === 'models', o, auth), { via: '酒馆转发' });
    let r = null;
    try { const c = ctx(); r = await fetch('/proxy/' + url, { ...o, headers: { ...(c && c.getRequestHeaders ? c.getRequestHeaders() : {}), ...o.headers } }); } catch (e2) { /* 代理也连不上 */ }
    // 本地酒馆没开代理回 404；Tauri Tavern 根本没有 /proxy/，回 200 + 酒馆首页。两种都算「没有代理」
    if (r && (r.status === 404 || /text\/html/i.test(r.headers.get('content-type') || ''))) { const t = await r.clone().text(); if (/proxy is disabled|Cannot (GET|POST)/i.test(t) || t.trim().startsWith('<')) r = null; }
    if (!r) {   // 提示只说连不上哪儿；为什么、怎么办写进日志的警告
      const host = new URL(url).host;
      note('warn', '连接', `连不上 ${host}`, top.__TAURI__ || top.__TAURI_INTERNALS__ ? '多半是这家不让网页直接连，Tauri Tavern 又没有转发代理' : '网络不通或被跨域拦截。可以在酒馆 config.yaml 里设 enableCorsProxy: true，重启酒馆后再试');
      throw new Error(`连不上 ${host}`);
    }
    r.via = '酒馆代理'; return r;
  }
}

async function viaTavern(base, models, o, auth) {
  // 推理深度那几个参数酒馆不认，自己不转：塞进「额外请求体」（custom_include_body，JSON 也算 YAML）它才原样带过去
  const b = models ? {} : JSON.parse(o.body), extra = Object.fromEntries(['reasoning_effort', 'enable_thinking', 'thinking'].filter(k => k in b).map(k => [k, b[k]]));
  const body = { ...b, chat_completion_source: 'custom', custom_url: base, custom_include_headers: `Authorization: ${JSON.stringify(auth)}`, ...(Object.keys(extra).length && { custom_include_body: JSON.stringify(extra) }) };
  const r = await fetch(`/api/backends/chat-completions/${models ? 'status' : 'generate'}`, { method: 'POST', signal: o.signal, headers: { ...(ctx()?.getRequestHeaders?.() || {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // 失败时酒馆也回 200，只是带着 error（流式的回复不读，读了就不流了）
  const j = /json/i.test(r.headers.get('content-type') || '') ? await r.clone().json().catch(() => null) : null;
  if (models ? j && !j.error : !j?.error) return r;
  return new Response(JSON.stringify({ error: { message: j?.error?.message || j?.message || (models ? '酒馆那边也没拉到模型' : '酒馆转发也没连上') } }), { status: 502 });
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
    // 「其他」线：标签（tag）是给自己认的，格子上显示它；App 设置里按它挑。内置两个向量、一个重排、两个听写、两个实时通话，也可以自定义
    { v: 'siliconflow-embed', label: '硅基流动', tag: '向量', base: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', site: 'https://cloud.siliconflow.cn/account/ak', note: '免费的 BAAI/bge-m3 就够用，国内直连。' },
    { v: 'zhipu-embed', label: '智谱', tag: '向量', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'embedding-3', site: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', note: '智谱 BigModel 的 embedding-3。' },
    { v: 'openai-embed', label: '第三方向量（OpenAI 兼容）', tag: '向量', base: '', model: 'text-embedding-3-small', site: '', custom: true },
    { v: 'siliconflow-rerank', label: '硅基流动', tag: '重排', base: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-reranker-v2-m3', site: 'https://cloud.siliconflow.cn/account/ak', note: '向量找到以后再排一遍，挑最对得上的。' },
    { v: 'siliconflow-stt', label: '硅基流动', tag: '听写', base: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', site: 'https://cloud.siliconflow.cn/account/ak', note: '通话时把你说的话转成字。' },
    { v: 'tencent-asr', label: '腾讯云（边说边出字）', tag: '听写', base: 'wss://asr.cloud.tencent.com/asr/v2', model: '16k_zh', site: 'https://console.cloud.tencent.com/asr', fields: [['appId', 'AppID'], ['secretId', 'SecretId']], note: '在腾讯云「语音识别」控制台开通，密钥填 SecretKey。「后付费」别开：每月 5 小时用完会自动停，不扣钱。' },
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
/** 同一个接口换个模型用（某个 App 自己另选了模型）：别的都还是原来那条，轮到第几把密钥也记回原来那条 */
export const withModel = (c, m) => !c || !m || m === c.model ? c : Object.create(c, { model: { value: m }, keyIdx: { get: () => c.keyIdx, set: v => { c.keyIdx = v; } } });

const trim = s => String(s || '').replace(/\/+$/, '');
// OpenAI 兼容的地址只填了域名（https://xxx.com/）：接口都在 /v1 下面，自动补上
const oaiBase = s => (s = trim(s), /^https?:\/\/[^/]+$/i.test(s) ? s + '/v1' : s);
async function readErr(res) {
  let t = ''; try { t = await res.text(); } catch (e) { /* 空 */ }
  try { const j = JSON.parse(t); t = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) { /* 不是 JSON */ }
  // 中转站、网关出错时回的是一整个网页：不把网页代码摊给人看，只留它的标题
  if (/^\s*<(!doctype|html)/i.test(t)) { const ti = (t.match(/<title[^>]*>([^<]*)/i) || [])[1]; t = (res.status >= 500 ? '中转站 / 服务器那边出错了，过会儿再试' : '回的是网页，不是接口数据') + (ti && ti.trim() ? `（${ti.trim()}）` : ''); }
  return `${res.status} ${String(t).slice(0, 160)}`;
}

/** 生成文字。返回字符串。 */
/** 这个接口的所有密钥（第一把 + 后来加的） */
export const keysOf = c => [c.key, ...(c.keys || [])].map(k => String(k || '').trim()).filter(Boolean);
const THINK = { low: 1024, medium: 4096, high: 12000 };
// 推理深度：'off' 是「默认」（以前存的就是它）——什么都不发，模型照自己的习惯想不想；'none' 是「关」——明着叫它别想。
// OpenAI 格式的「关」，按模型名认是哪家：Gemini 认 reasoning_effort（Pro 关不掉最少 low，Flash 到 minimal，2.5 Flash 能 none）；
// Claude 不叫它想就不想，什么都不发；Grok 关不掉，最少 low；OpenAI 自家推理模型 o 系列最少 low、GPT-5 系列 minimal；
// 别家（DeepSeek、Kimi、智谱、豆包、混元认 thinking: disabled，通义、硅基流动认 enable_thinking）两种写法一起发
const gemOff = m => (/2\.5.*flash/i.test(m) ? 'none' : /flash/i.test(m) ? 'minimal' : 'low');
const quiet = m => (/gemini/i.test(m) ? { reasoning_effort: gemOff(m) } : /claude/i.test(m) ? {} : /grok|(^|\/)o\d/i.test(m) ? { reasoning_effort: 'low' } : /gpt-5/i.test(m) ? { reasoning_effort: 'minimal' } : /gpt|chatgpt/i.test(m) ? {} : { enable_thinking: false, thinking: { type: 'disabled' } });
// 不认这些参数的模型（报 400）：这一次不带它们再发一遍，记下这根线的这个模型，以后直接照「默认」发，不再白花一次
const deaf = (c, m) => (state.settings.noThink ||= {})[c.id + '|' + m];
// Gemini 官方接口：3 代以后按档位（thinkingLevel，Pro 只有 low / high），2.5 按字数（Flash 能 0，Pro 最少 128）
const gemThink = (m, lv) => {
  if (!lv || lv === 'off') return null;
  if (/gemini-(?:[3-9]|\d\d)/i.test(m)) return { thinkingLevel: lv === 'none' ? (/flash/i.test(m) ? 'minimal' : 'low') : /pro/i.test(m) && lv === 'medium' ? 'low' : lv };
  return { thinkingBudget: lv === 'none' ? (/pro/i.test(m) ? 128 : 0) : THINK[lv] };
};
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
// 写明白接着写的是「这条回复」，不是上面的正文：以前只说「接着往下写」，AI 把正文的剧情接着写下去了
const MORE = part => `\n\n【补写】你对上面这条要求的回复写到一半断了（字数到了上限）。两条横线中间是你已经回的部分。接着写的是这条回复，不是上面的正文或故事；不要重新回一遍，不要加解释，从最后一个字直接接下去，只输出剩下的部分。\n————\n${part}\n————`;
const bare = t => t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
/** 自动补写（作者要的）：done(写出来的) 说还没写完，就把写出来的给它，让它从断的地方接着写，最多 most 次；接上时去掉它重复的那几个字 */
export async function generateMore(opts, done, most) {
  let out = await generate(opts);
  for (let n = 0; n < most && !done(out); n++) {
    out = join(bare(out), bare(await generate({ ...opts, prompt: opts.prompt + MORE(bare(out)) })));
  }
  return out;
}
let hum = null, humN = 0;
function awake() {
  try {
    if (!humN++) { const C = window.AudioContext || window.webkitAudioContext, ac = new C(), o = ac.createOscillator(), g = ac.createGain(); g.gain.value = .0001; o.connect(g).connect(ac.destination); o.start(); hum = ac; }
    if (hum.state === 'suspended') hum.resume().catch(() => {});
  } catch (e) { /* 没有 WebAudio 就算了 */ }
  return () => { if (!--humN && hum) { hum.close().catch(() => {}); hum = null; } };
}
// 接上：补写的开头常会重复前面最后几个字，去掉重复的再拼
const join = (part, more) => { let k = Math.min(200, more.length); while (k && !part.endsWith(more.slice(0, k))) k--; return part + more.slice(k); };
/** 写到一半线断了（最常见：手机切到后台，系统把网络掐了）：收到的不扔，等手机回到前台，让 AI 从断的地方接着写。
 *  只有那个 App 的设置里开了「写到一半断了自动补写」才接（opts.resume = 最多几次；作者定的，默认不接） */
async function resumable(opts) {
  let part = '';
  for (let n = 0; ; n++) {
    try { const more = await generateOnce(part ? { ...opts, prompt: opts.prompt + MORE(part), onPart: opts.onPart && (t => opts.onPart(part + t)) } : opts); return part ? join(part, bare(more)) : more; }
    catch (e) {
      if (!e.part || n >= (opts.resume || 0)) throw e;
      part = join(part, bare(e.part)); log('warn', opts.app || '聊天', `写到一半断了（${e.message}），已经收到 ${part.length} 字，接着写`);
      if (document.hidden) await new Promise(ok => document.addEventListener('visibilitychange', function f() { if (!document.hidden) { document.removeEventListener('visibilitychange', f); ok(); } }));
      if (opts.stop && opts.stop.aborted) throw new Error('已中止');
    }
  }
}
/**
 * 生成文字。返回字符串。
 * 会自动：多把密钥轮着用（某把被拒就换下一把）、失败按设置重试、聊天线断了改用选好的副 API。
 */
export async function generate(opts) { return regexed(await gen(opts)); }   // 设置 → 正则 里勾了的，回复一拿到就换
async function gen(opts) {
  opts = await withPreset(opts);   // 设置 → 预设：这个应用选了方案就把预设条目带上
  const { conn, app = '聊天' } = opts;
  if (!conn) throw new Error('还没有设置可用的连接');
  let last = null;
  try { return await withRetry('text', app, () => resumable(opts)); } catch (e) { last = e; }
  if (last.message === '已中止') throw last;   // 自己点了中止：不换副 API
  // 聊天线断了 → 改用选好的副 API（只换一次，不来回换）
  const bk = backupOf('text');
  if (bk && !opts.noFallback && bk.id !== conn.id && (bk.type !== 'tavern' || inTavern())) {
    log('warn', app, `「${conn.name}」连不上，改用副 API「${bk.name}」`);
    return generateOnce({ ...opts, conn: bk, noFallback: true });
  }
  throw last;
}
// 不限字数（作者定的）：思考也算在上限里，回到一半被截断就白花了。OpenAI 格式、Gemini 不传上限，Claude 必须填就给 64000（官方建议的大小），走酒馆的照酒馆预设
async function generateOnce({ conn, system = '', prompt = '', keep = 0, temperature, app = '聊天', stop, onPart, resume = 0 }) {
  const P = conn.params || {};
  const temp = temperature ?? P.temperature ?? conn.temperature ?? 0.9;
  const think = THINK[P.thinking] || 0;
  const stream = conn.stream !== false;   // 默认流式：边生成边收，长回复不容易超时
  const keys = keysOf(conn);
  let ki = Math.min(conn.keyIdx || 0, Math.max(0, keys.length - 1));
  // 日志里记一条调用：发出去的、流式收到的、结果；点中止就断开
  const call = startCall({ app, src: conn.type === 'tavern' ? '酒馆' : conn.name, model: conn.model || '', req: (system ? `【系统】\n${system}\n\n` : '') + prompt });
  let got = '', why = '';   // 流式收到的（线断了时带在报错上，接着写用）；AI 为什么停（字数到上限就不算写完）
  const halt = r => { if (r) why = r; };
  // 收到多少字了告诉界面（core/ui.js 的 aiCount：等待的提示条、转圈的按钮、聊天里的「正在输入」后面都跟着写；结束报 null）
  const tell = n => document.dispatchEvent(new CustomEvent('as-ai', { detail: n }));
  const signal = call.signal, part = t => { got = t; call.part(t); tell(t.length); onPart && onPart(t); };
  // 等 AI 的时候尽量不让系统把后台的页面停掉（作者要的保活，尽力而为）：占一把锁 + 放一段听不见的声音（浏览器一般不停正在出声的页面；用 WebAudio，不抢别的 App 的声音）
  const sleep = awake();
  let free; const held = new Promise(ok => { free = ok; }); navigator.locks && navigator.locks.request('as-ai', { mode: 'shared' }, () => held).catch(() => {});
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
      else { const pf = conn.pf && tavernProfiles().list.find(x => x.id === conn.pf); out = await orAbort(pf ? generateWithProfile(pf, { system, prompt }) : generateTavern({ system, prompt }), signal); }
    } else if (conn.type === 'tavern-profile') {
      const pf = tavernProfiles().list.find(x => x.id === conn.profileId);
      if (!pf) throw new Error(`酒馆里找不到「${conn.name}」这个连接配置了`);
      out = await orAbort(generateWithProfile(pf, { system, prompt }), signal);
    } else if (OAI(conn.type)) {
      out = await withKey(async key => {
        // 接口不肯流式（400 / 422 还提到 stream）就一次性要；流式回来一个字没有（又没说为什么），一次性再问一遍——有的中转只认一次性的
        const send = async st => {
          const body = { model: conn.model, temperature: temp, stream: st, messages: [system && { role: 'system', content: system }, { role: 'user', content: prompt }].filter(Boolean) };
          const tk = deaf(conn, conn.model) ? {} : P.thinking === 'none' ? quiet(conn.model) : think ? { reasoning_effort: P.thinking } : {};
          Object.assign(body, tk); if (tk.reasoning_effort && P.thinking !== 'none') delete body.temperature;
          const res = await xf(oaiBase(conn.base) + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
          if (!res.ok) { const m = await readErr(res);
            if (st && /^(400|422)\b/.test(m) && /stream/i.test(m)) { log('warn', app, '接口不肯流式，改成一次性要'); return send(false); }
            if (Object.keys(tk).length && /^400\b/.test(m)) { state.settings.noThink[conn.id + '|' + conn.model] = 1; commit('settings'); log('warn', app, `「${conn.model}」不认推理深度的设置（${m}），以后照默认发`); return send(st); }
            throw new Error(m); }
          return readOut(res, j => j.choices?.[0]?.delta?.content, j => j.choices?.[0]?.message?.content, part, halt);
        };
        try { return await send(stream); }
        catch (e) { if (!stream || e.message !== 'AI 回了空的' || signal.aborted) throw e; log('warn', app, '流式回来是空的，改成一次性再问一遍'); return send(false); }
      });
    } else if (conn.type === 'claude') {
      out = await withKey(async key => {
        // 提示词缓存：人设 / 设定这类每次都一样的东西走缓存，便宜又快。keep：提示词前面这么多字每次都一样（聊天时人设、世界书、一直记着的、正文），也走缓存
        const cache = conn.adv && conn.adv.cache, mark = { cache_control: { type: 'ephemeral' } };
        const sys = !system ? undefined : cache ? [{ type: 'text', text: system, ...mark }] : system;
        const content = cache && keep > 0 && keep < prompt.length ? [{ type: 'text', text: prompt.slice(0, keep), ...mark }, { type: 'text', text: prompt.slice(keep) }] : prompt;
        const body = { model: conn.model, max_tokens: 64000, system: sys, stream, messages: [{ role: 'user', content }] };
        if (think) body.thinking = { type: 'enabled', budget_tokens: think }; else body.temperature = Math.min(1, temp);
        const res = await xf(trim(conn.base || 'https://api.anthropic.com') + '/v1/messages', {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await readErr(res));
        return readOut(res, j => j.type === 'content_block_delta' && j.delta?.type === 'text_delta' ? j.delta.text : '', j => (j.content || []).filter(p => p.type === 'text').map(p => p.text).join(''), part, halt);
      });
    } else if (conn.type === 'gemini') {
      out = await withKey(async key => {
        const gc = { temperature: temp };
        const tc = gemThink(conn.model, P.thinking); if (tc) gc.thinkingConfig = tc;
        const url = `${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models/${encodeURIComponent(conn.model)}:${stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${encodeURIComponent(key)}`;
        const res = await xf(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc }) });
        if (!res.ok) throw new Error(await readErr(res));
        const parts = j => (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        return readOut(res, parts, parts, part, halt);
      });
    } else throw new Error('这个渠道还不能用来生成文字：' + conn.type);
    // 走酒馆的：接口出错时酒馆不报错，而是把「[API 错误] … failed with status 502: <html>…」当回复交回来，要当失败（5xx 会照设置重试）
    const bad = /^\s*\[API (?:错误|Error)\]/i.test(String(out || '')) && String(out);
    if (bad) throw Object.assign(new Error(`${(/status (\d{3})/.exec(bad) || [])[1] || ''} 接口出错了${(/<title>([^<]*)<\/title>/i.exec(bad) || [])[1] ? `（${/<title>([^<]*)<\/title>/i.exec(bad)[1].trim()}）` : ''}`.trim()), { raw: bad });   // raw：这段是报错不是正文，别当成「写到一半」拿去续写
    // 回了字、连接也好好结束了，其实是字数到上限被掐断的（作者：只写了关系就停了，还标着成功）：开了自动补写就当断了、接着写；没开就照样给，日志记成警告
    if (/^(length|max_tokens|MAX_TOKENS)$/.test(why)) {
      if (resume > 0) throw Object.assign(new Error('字数到上限了'), { cut: String(out) });
      call.done(String(out || '').trim(), '字数到上限了'); return String(out || '').trim();
    }
    // 边收边显示的回复，正常写完最后都会说为什么停；一个字没说线就结束了，多半是中转站中途掐了（作者：收到 3937 字卡了一分钟，结束了还标成功）
    if (stream && !why && conn.type !== 'tavern' && conn.type !== 'tavern-profile') { call.done(String(out || '').trim(), '线中途结束了，可能没写完'); return String(out || '').trim(); }
    call.done(String(out || '').trim());
    return String(out || '').trim();
  } catch (e) {
    const msg = e && e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : (e && e.message) || String(e);
    if (e && e.raw) call.part(e.raw);
    call.fail(msg);
    throw Object.assign(new Error(msg), { logId: call.id, part: e.cut || (msg !== '已中止' && !e.raw ? got : '') });   // 报错里的「查看日志」直接跳到这一条
  } finally { free(); sleep(); tell(null); }
}

/** OpenAI 格式的几家：官方、DeepSeek、第三方中转 */
const OAI = t => t === 'openai' || t === 'deepseek' || t === 'openai-compat';
/** 读回复：流式就一段段拼起来（data: {...}），服务器没按流式回就当普通 JSON 读 */
const whyStop = j => j.choices?.[0]?.finish_reason || j.candidates?.[0]?.finishReason || j.delta?.stop_reason || j.stop_reason;
async function readOut(res, pickDelta, pickWhole, onPart = () => {}, onStop = () => {}) {
  if (!res.body || /application\/json/.test(res.headers.get('content-type') || '')) { const j = await res.json(), o = pickWhole(j) ?? ''; onStop(whyStop(j)); if (!String(o).trim()) throw empty(JSON.stringify(j)); return o; }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', out = '', raw = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; raw += piece;
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      const m = /^data:\s*(.*)$/.exec(l.trim()); if (!m || m[1] === '[DONE]') continue;
      try { const j = JSON.parse(m[1]); out += pickDelta(j) || ''; onStop(whyStop(j)); } catch (e) { /* 半截的行，等下一段 */ }
    }
    onPart(out);
  }
  if (!out && /^\s*\{/.test(raw)) { try { out = pickWhole(JSON.parse(raw)) ?? ''; } catch (e) { /* 不是 JSON */ } }
  if (!String(out).trim()) throw empty(raw);
  return out;
}
// 回了 200 却一个字没有（中转站把报错、拦截藏在回复里）：找出它说的原因，原样记进日志「收回来的」
const WHY = { content_filter: '被安全审查拦了', SAFETY: '被安全审查拦了', PROHIBITED_CONTENT: '被安全审查拦了', BLOCKLIST: '被安全审查拦了', RECITATION: '被拦了', length: '字数到上限了', MAX_TOKENS: '字数到上限了', stop: '', STOP: '' };
function empty(raw) {
  let why = '';
  for (const l of raw.split('\n')) { try { const j = JSON.parse(l.replace(/^\s*data:\s*/, '')), r = j.error?.message || j.choices?.[0]?.finish_reason || j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason; if (r) why = WHY[r] ?? r; } catch (e) { /* 不是 JSON 的行 */ } }
  return Object.assign(new Error(`AI 回了空的${why ? '（' + why + '）' : ''}`), { raw });
}

/** 拉取模型列表 */
// 生图、语音、向量里也是 OpenAI 格式的：模型列表一样从 /models 拉
const OAI_LIST = new Set(['openai-image', 'image-compat', 'siliconflow', 'openai-tts', 'custom-tts', 'indextts', 'siliconflow-embed', 'siliconflow-rerank', 'openai-embed', 'openai-realtime', 'other-compat']);
/** 拉模型列表：能从网上拉的就拉，没有列表接口的给出这家固定的那几个。成功失败都记进日志，带上花了几秒、走的哪条路（作者：拉取一直转圈，要看出卡在哪）；点了取消就是中止，不记 */
export async function listModels(conn, signal) {
  const t0 = Date.now(), how = { via: '' }, tail = () => ` · ${((Date.now() - t0) / 1000).toFixed(1)} 秒 · ${how.via || '没有列表接口，列的固定几个'}`;
  try { const ids = await pullModels(conn, signal, how); log('info', '连接', `拉取模型（${conn.name || conn.type}）：${ids.length} 个${tail()}`); return ids; }
  catch (e) {
    if (signal && signal.aborted) throw e;
    const msg = e.message === 'Failed to fetch' ? '连不上这个地址（可能是网络或跨域限制）' : e.message;
    log('error', '连接', `拉取模型失败（${conn.name || conn.type}）：${msg}${tail()}`);
    throw new Error(msg);
  }
}
async function pullModels(conn, signal, how) {
  const get = async (url, o) => { const r = await xf(url, { ...o, signal }); how.via = r.via || '直连'; return r; };
  if (OAI(conn.type) || OAI_LIST.has(conn.type)) {
    const res = await get(oaiBase(conn.base) + '/models', { headers: { Authorization: 'Bearer ' + (conn.key || '') } });
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(), ids = (j.data || []).map(m => m.id).sort();
    return conn.type === 'openai-realtime' ? ids.filter(m => /realtime|live/i.test(m)) : ids;
  }
  if (conn.type === 'claude') {
    const res = await get(trim(conn.base || 'https://api.anthropic.com') + '/v1/models', { headers: { 'x-api-key': conn.key || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    if (!res.ok) throw new Error(await readErr(res));
    const j = await res.json(); return (j.data || []).map(m => m.id);
  }
  if (conn.type === 'gemini' || conn.type === 'gemini-live') {   // Live 只列能实时对话（bidiGenerateContent）的
    const res = await get(`${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models?key=${encodeURIComponent(conn.key || '')}`);
    if (!res.ok) throw new Error(await readErr(res));
    const how = conn.type === 'gemini-live' ? 'bidiGenerateContent' : 'generateContent';
    const j = await res.json(); return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes(how)).map(m => m.name.replace(/^models\//, ''));
  }
  // 本地 SD / ComfyUI：拉的是装好的底模
  if (conn.type === 'sd-webui') { const res = await get(trim(conn.base) + '/sdapi/v1/sd-models'); if (!res.ok) throw new Error(await readErr(res)); return (await res.json()).map(m => m.title || m.model_name); }
  if (conn.type === 'comfyui') { const res = await get(trim(conn.base) + '/object_info/CheckpointLoaderSimple'); if (!res.ok) throw new Error(await readErr(res)); const j = await res.json(); return (((j.CheckpointLoaderSimple || {}).input || {}).required || {}).ckpt_name?.[0] || []; }
  // Fish、ElevenLabs 有自己的模型列表接口（照旧版小手机的拉法）
  const tt = conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type;
  if (tt === 'fish') { const res = await get(trim(conn.base || 'https://api.fish.audio').replace(/\/v1$/, '') + '/compat/v1/models'); if (!res.ok) throw new Error(await readErr(res)); return ((await res.json()).data || []).map(m => String(m.id).replace(/^fish-audio\//, '')); }
  if (tt === 'elevenlabs') {
    const res = await get(trim(conn.base || 'https://api.elevenlabs.io') + '/v1/models', { headers: { 'xi-api-key': keysOf(conn)[0] || '' } }); if (!res.ok) throw new Error(await readErr(res));
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
  const out = await generateOnce({ conn, system: '', prompt: '只回复两个字：在的', app: '设置' });
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
// 有的中转站直接回 PNG；压缩包按末尾的目录找图片的大小和位置（NAI 那种边写边压的包，开头记的大小是 0，不能信）
async function firstFileInZip(buf) {
  const u8 = new Uint8Array(buf), v = new DataView(buf);
  if (u8[0] === 0x89 && u8[1] === 0x50) return new Blob([u8], { type: 'image/png' });
  if (u8[0] !== 0x50 || u8[1] !== 0x4b) throw new Error('NovelAI 回的不是图片：' + new TextDecoder().decode(u8.slice(0, 200)));
  let e = u8.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('NovelAI 回的压缩包坏了');
  const cd = v.getUint32(e + 16, true), method = v.getUint16(cd + 10, true), size = v.getUint32(cd + 20, true), lo = v.getUint32(cd + 42, true);
  const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), data = u8.subarray(start, start + size);
  if (method === 0) return new Blob([data], { type: 'image/png' });
  const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Blob([await new Response(ds).arrayBuffer()], { type: 'image/png' });
}
/** ComfyUI 没粘工作流时用的最简单的文生图流程（底模 → 正负提示词 → 采样 → 存图） */
function comfyDefault({ model, full, neg, W, H, steps, scale, sampler, seed }) {
  if (!model) throw new Error('ComfyUI 要先在「模型」里选一个底模（点拉取）');
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: W, height: H, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: full, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: neg, clip: ['4', 1] } },
    3: { class_type: 'KSampler', inputs: { seed, steps, cfg: scale, sampler_name: sampler, scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
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
/** ref：照着这张图改（dataURL），不传就是用文字生图 */
/** 画的是某个人：前面加上映像里写的外貌；渠道能照图画（OpenAI / 第三方 / NAI 4.5）就带上 TA 的参考图；
 *  定了种子就用 TA 的种子（NAI / SD / ComfyUI / 硅基流动认，OpenAI 这类没有种子） */
export function lookOf(c, prompt, conn = resolveConn('image', 'chat')) {
  const can = c && c.lookRef && conn && (['openai-image', 'image-compat'].includes(conn.type) || (conn.type === 'novelai' && /4-5/.test(conn.model || 'nai-diffusion-4-5-full')));
  const img = { ...(c && c.seed !== undefined && { seed: c.seed }), ...(can && c.lookK != null && { refK: c.lookK }) };   // 种子、锁脸强度都是每个人自己的
  return [c && c.look ? `${c.look}. ${prompt}` : prompt, can ? c.lookRef : undefined, conn && Object.keys(img).length ? { ...conn, img: { ...conn.img, ...img } } : conn];
}
export async function generateImage(prompt, app = '聊天', connIn, stop, ref) {
  const conn = connIn || resolveConn('image', 'chat');
  if (!conn) throw new Error('还没有生图连接：设置 → 连接 → 生图 里插一根线');
  try { return await withRetry('image', app, () => imageOnce(prompt, app, conn, stop, ref)); }
  catch (e) {   // 生图线断了 → 改用选好的副 API（只换一次）；自己点了中止不换
    const bk = backupOf('image'); if (!bk || bk.id === conn.id || e.message === '已中止') throw e;
    log('warn', app, `「${conn.name}」生图失败，改用副 API「${bk.name}」`);
    return imageOnce(prompt, app, bk, stop, ref);
  }
}
/** 真正发出去的正面 / 负面提示词：画师串 + 质量词 + 这次的画面 */
function imgPrompt(conn, prompt) {
  const I = conn.img || {}, quality = I.quality ?? (conn.type === 'novelai' ? 'masterpiece, best quality, very aesthetic' : '');
  return { full: [I.tags, quality, prompt].filter(Boolean).join(', '), neg: I.neg || '' };
}
/** 一次生图记成日志里的一条调用 */
async function imageOnce(prompt, app, conn, stop, ref) {
  const { full, neg } = imgPrompt(conn, prompt);
  const call = startCall({ app, what: '生图', src: conn.name, model: conn.model || '', req: full + (neg ? `\n\n【负面】\n${neg}` : '') });
  stop && stop.addEventListener('abort', () => abortCall(call.id), { once: true });
  try { const u = await orAbort(imageRaw(prompt, conn, ref), call.signal); call.done('[一张图片]'); return u; }
  catch (e) { call.fail(e.message); throw Object.assign(e, { logId: call.id }); }
}
/** 把图放进 w×h（NAI 要求送去的图和要画的一样大）：contain 不变形、空处填底色；不然拉伸铺满（局部重绘回来再缩回原大小正好对上）。交出不带前缀的 base64 */
const fitB64 = (src, w, h, bg, contain) => new Promise((ok, no) => { const i = new Image(); i.onload = () => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d'), k = contain ? Math.min(w / i.naturalWidth, h / i.naturalHeight) : 0;
  x.fillStyle = bg; x.fillRect(0, 0, w, h); contain ? x.drawImage(i, (w - i.naturalWidth * k) / 2, (h - i.naturalHeight * k) / 2, i.naturalWidth * k, i.naturalHeight * k) : x.drawImage(i, 0, 0, w, h);
  ok(c.toDataURL('image/png').split(',')[1]); }; i.onerror = () => no(new Error('参考图读不出来')); i.src = src; });
/** ref：照着这张图改（dataURL）。只有能「照图改图」的渠道认：OpenAI / 第三方（edits 接口或聊天接口带图）、硅基流动的改图模型；
 *  NAI：ref 是图就当「角色参考」（只有 4.5 的模型有），是 { image, chars, strength } 就图生图 + 分角色提示词 */
async function imageRaw(prompt, conn, ref) {
  const I = conn.img || {}, size = sizeOf(conn), [W, H] = size.split('x').map(n => Math.round((+n || 1024) / 64) * 64);
  const { full, neg } = imgPrompt(conn, prompt);
  const key = keysOf(conn)[0] || '', base = trim(conn.base), sd = I.seed === '' || I.seed == null || +I.seed < 0 ? null : Math.floor(+I.seed);   // 种子：映像里给这个人定的，没定就每次随机
  const fail = async res => { throw new Error(await readErr(res)); };
  try {
    if (ref && ref.chars && conn.type !== 'novelai') throw new Error('只有 NAI 能按位置分别写提示词');
    if (ref && !['siliconflow', 'openai-image', 'image-compat', 'novelai'].includes(conn.type)) throw new Error('这个生图渠道不能照着图改，换 OpenAI / 第三方 / 硅基流动的改图模型或 NAI');
    switch (conn.type) {
      case 'novelai': {
        // ref.chars：图生图 + 分角色提示词（每个位置画什么），照相馆的「NAI 宫格（试验）」用
        const model = conn.model || 'nai-diffusion-4-5-full', chars = ref && ref.chars, seed = sd ?? Math.floor(Math.random() * 4294967295);
        if (ref && !chars && !/4-5/.test(model)) throw new Error('NAI 照着图画要用 4.5 的模型');
        const cc = chars ? chars.map(c => ({ char_caption: c.tags, centers: [{ x: c.x, y: c.y }] })) : [];
        const more = !ref ? {} : chars ? { image: await fitB64(ref.image, W, H, '#fff'), strength: ref.strength, noise: 0, extra_noise_seed: seed,
            characterPrompts: chars.map(c => ({ prompt: c.tags, uc: '', center: { x: c.x, y: c.y }, enabled: true })) }
          : { director_reference_images: [await fitB64(ref, 1024, 1536, '#000', true)], director_reference_descriptions: [{ caption: { base_caption: 'character&style', char_captions: [] }, legacy_uc: false }],
            director_reference_information_extracted: [1], director_reference_strength_values: [I.refK ?? 1], director_reference_secondary_strength_values: [0] };
        const res = await xf(base + '/ai/generate-image', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ input: full, model, action: chars ? 'img2img' : 'generate', parameters: {
            params_version: 3, width: W, height: H, scale: +I.scale || 5, sampler: I.sampler || 'k_euler_ancestral', steps: Math.min(+I.steps || 28, 50), n_samples: 1, ucPreset: 0, qualityToggle: !I.quality, negative_prompt: neg,
            v4_prompt: { caption: { base_caption: full, char_captions: cc }, use_coords: !!chars, use_order: true },
            v4_negative_prompt: { caption: { base_caption: neg, char_captions: cc.map(c => ({ ...c, char_caption: '' })) }, legacy_uc: false }, ...(ref || sd != null ? { seed } : {}), ...more } }) });
        if (!res.ok) await fail(res);
        return keep(URL.createObjectURL(await firstFileInZip(await res.arrayBuffer())));
      }
      case 'siliconflow': {
        const res = await xf(oaiBase(base) + '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: conn.model, prompt: full, negative_prompt: neg || undefined, image_size: `${W}x${H}`, batch_size: 1, num_inference_steps: +I.steps || 20, guidance_scale: +I.scale || 7.5, ...(sd != null ? { seed: sd } : {}), ...(ref ? { image: ref } : {}) }) });
        if (!res.ok) await fail(res);
        const j = await res.json(); const u = j.images?.[0]?.url || j.data?.[0]?.url; if (!u) throw new Error('硅基流动没有返回图片'); return keep(u);
      }
      case 'sd-webui': {
        const res = await xf(base + '/sdapi/v1/txt2img', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: full, negative_prompt: neg, width: W, height: H, steps: +I.steps || 20, sampler_name: I.sampler || 'Euler a', cfg_scale: +I.scale || 7, seed: sd ?? -1,
            ...(conn.model ? { override_settings: { sd_model_checkpoint: conn.model } } : {}) }) });
        if (!res.ok) await fail(res);
        const j = await res.json(); if (!j.images?.[0]) throw new Error('SD 没有返回图片'); return b64png(j.images[0]);
      }
      case 'comfyui': {
        const p = { model: conn.model, full, neg, W, H, steps: +I.steps || 20, scale: +I.scale || 7, sampler: I.sampler || 'euler_ancestral', seed: sd ?? Math.floor(Math.random() * 1e9) };
        // 自己的工作流：占位符换成这次的值（数字的连引号一起换，免得变成字符串）
        const fill = s => [['prompt', JSON.stringify(full).slice(1, -1)], ['negative_prompt', JSON.stringify(neg).slice(1, -1)], ['negative', JSON.stringify(neg).slice(1, -1)], ['model', p.model || ''], ['sampler', p.sampler]]
          .reduce((t, [k, v]) => t.replaceAll(`%${k}%`, v), [['seed', p.seed], ['width', W], ['height', H], ['steps', p.steps], ['scale', p.scale]]
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
        const base = oaiBase(conn.base);
        const chat = async () => {
          const res = await xf(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
            body: JSON.stringify({ model: conn.model || undefined, stream: false, messages: [{ role: 'user', content: ((t) => ref ? [{ type: 'text', text: t }, { type: 'image_url', image_url: { url: ref } }] : t)(full + (neg ? `\n\nAvoid: ${neg}` : '') + `\n\n(size ${W}x${H})`) }] }) });
          if (!res.ok) await fail(res);
          const u = imageInReply(await res.json()); if (!u) throw new Error('聊天接口的回复里没有图片'); return keep(u);
        };
        if (I.mode === 'chat') return chat();
        const body = { model: conn.model || undefined, prompt: full + (neg ? `\n\nAvoid: ${neg}` : ''), n: 1, size: `${W}x${H}` };
        let res;
        if (ref) {   // 照图改：/images/edits，图片按文件传
          const fd = new FormData(); Object.entries(body).forEach(([k, v]) => v != null && fd.append(k, String(v))); fd.append('image', await (await fetch(ref)).blob(), 'image.png');
          res = await xf(base + '/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
          // 回一个不是 JSON 的 404：这家根本没有照图改图的接口（只开了聊天接口那条路），改走聊天接口；回 JSON 的 404 是别的错（比如模型不存在），照常报
          if (res.status === 404 && !/json/i.test(res.headers.get('content-type') || '')) { note('warn', '连接', `「${conn.name}」没有照图改图的接口，改走聊天接口`, `${base}/images/edits 回了 404`); return chat(); }
        } else res = await xf(base + '/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
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
  if (opts.acted) ({ text, act: opts.act } = adapt(conn, text, opts.t));   // 带 [语气] 标签的（电台）：换成这个接口认的写法，见 core/act.js
  const call = startCall({ app: '语音', what: '合成语音', src: conn.name, model: conn.model || '', req: text + (opts.voice || (conn.tts || {}).voice ? `\n\n（音色：${opts.voice || conn.tts.voice}）` : '') });
  opts.stop && opts.stop.addEventListener('abort', () => abortCall(call.id), { once: true });
  try { const u = await orAbort(synthRaw(conn, text, opts), call.signal); call.done('[一段声音]'); return u; }
  catch (e) { call.fail(e.message); throw Object.assign(e, { logId: call.id }); }
}
// 边合成边播（通话用，opts.stream）：接口能一小块一小块给 mp3 的，回一条字节流（ReadableStream）让播放器边收边播；不能的照旧回整段声音的地址
const mp3Of = res => /mpeg|mp3/i.test(res.headers.get('content-type') || '') && res.body ? res.body : audioOf(res);
/** 一行一个 JSON（或 SSE 的 data: 行）的回复：每行交给 pick 变成一小块声音 */
function lineStream(res, pick) {
  const rd = res.body.getReader(), td = new TextDecoder(); let buf = '', end = false;
  return new ReadableStream({ async pull(c) {
    for (;;) {
      const i = buf.indexOf('\n');
      if (i < 0 && !end) { const { done, value } = await rd.read(); if (done) end = true; else buf += td.decode(value, { stream: true }); continue; }
      const l = (i < 0 ? buf : buf.slice(0, i)).replace(/^data:\s*/, '').trim(); buf = i < 0 ? '' : buf.slice(i + 1);
      const b = l[0] === '{' && pick(JSON.parse(l));
      if (b) return c.enqueue(b);
      if (i < 0) return c.close();
    }
  }, cancel() { rd.cancel(); } });
}
async function synthRaw(conn, text, { voice, act = {}, stream: S } = {}) {
  const T = conn.tts || {}, v = voice || T.voice || conn.voice || (CHANNELS.tts.find(x => x.v === conn.type) || {}).voice || '';
  const key = keysOf(conn)[0] || '', base = trim(conn.base), speed = T.speed || 1;
  const bad = async res => { throw new Error(await readErr(res)); };
  // 第三方可以选「接口格式」：中转站转发的是 MiniMax / Fish / ElevenLabs 的格式时，照那家的发
  switch (conn.type === 'custom-tts' && conn.fmt ? conn.fmt : conn.type) {
    case 'minimax-cn': case 'minimax-intl': {
      const res = await xf(`${base}/v1/t2a_v2${conn.groupId ? '?GroupId=' + encodeURIComponent(conn.groupId) : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: conn.model || 'speech-2.8-hd', text, stream: !!S, ...(S && { stream_options: { exclude_aggregated_audio: true } }), voice_setting: { voice_id: v || 'female-shaonv', speed, vol: Math.max(.1, (T.volume ?? 1) * 1), pitch: T.pitch || 0, ...(act.emotion && { emotion: act.emotion }) }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 } }) });
      if (!res.ok) await bad(res);
      // 流式：status 1 是一小块，最后 status 2 那行是整段（不要，不然会念两遍）
      if (S && !/json/i.test(res.headers.get('content-type') || '')) return lineStream(res, j => { if (j.base_resp && j.base_resp.status_code) throw new Error(`${j.base_resp.status_code} ${j.base_resp.status_msg}`); return j.data && j.data.status === 1 && j.data.audio && hexToBytes(j.data.audio); });
      const j = await res.json(); if (j.base_resp && j.base_resp.status_code) throw new Error(`${j.base_resp.status_code} ${j.base_resp.status_msg}`);
      if (!j.data || !j.data.audio) throw new Error('MiniMax 没有返回声音');
      return URL.createObjectURL(new Blob([hexToBytes(j.data.audio)], { type: 'audio/mpeg' }));
    }
    case 'fish': {   // 走 Fish 的 OpenAI 兼容地址：网页能直接连（/v1/tts 会被跨域拦，Tauri Tavern 又没有代理），旧小手机也是这样
      const send = temp => xf(base.replace(/\/v1$/, '') + '/compat/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'fish-audio/' + String(conn.model || 's2.1-pro').replace(/^fish-audio\//, ''), input: text, voice: v || '', response_format: 'mp3', ...(speed !== 1 && { speed }), ...(temp && { temperature: temp }) }) });
      let res = await send(act.temperature);
      if (!res.ok && act.temperature) res = await send();   // 张力换成的温度这个地址不认：去掉再来一次
      if (!res.ok) await bad(res); return S ? mp3Of(res) : audioOf(res);
    }
    case 'elevenlabs': {
      const res = await xf(`${base}/v1/text-to-speech/${encodeURIComponent(v || 'JBFqnCBsd6RMkjVDRZzb')}${S ? '/stream' : ''}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text, model_id: conn.model || 'eleven_multilingual_v2', voice_settings: { speed } }) });
      if (!res.ok) await bad(res); return S ? mp3Of(res) : audioOf(res);
    }
    case 'mimo': {
      const res = await xf(oaiBase(base) + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
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
          body: JSON.stringify({ user: { uid: 'asterphone' }, req_params: { text, speaker: v || 'zh_female_xiaohe_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((speed - 1) * 100) }, ...(act.context && { additions: JSON.stringify({ context_texts: [act.context] }) }) } }) });
        if (!res.ok) await bad(res);
        if (S) return lineStream(res, j => { if (j.code && j.code !== 20000000) throw new Error(`${j.code} ${j.message || ''}`); return j.data && new Uint8Array([...atob(j.data)].map(ch => ch.charCodeAt(0))); });
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
      const res = await xf(oaiBase(base) + '/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        body: JSON.stringify({ model: conn.model || 'tts-1', input: text, voice: v || 'alloy', speed, ...(act.instructions && { instructions: act.instructions }), ...(act.emoText && { emo_text: act.emoText, use_emo_text: true }) }) });
      if (!res.ok) await bad(res); return S ? mp3Of(res) : audioOf(res);
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
// 开口前告诉别人（音乐会先停一下），说完再告诉一声
const sayEv = d => { try { (window.parent || window).dispatchEvent(new CustomEvent('asterphone-voice', { detail: d })); } catch (e) { /* 拿不到酒馆页面就算了 */ } };
export async function speak(text, opts = {}) {
  if (opts.silent) return speakRaw(text, opts);
  sayEv('start');
  try { return await speakRaw(text, opts); } finally { sayEv('end'); }
}
/** 一条字节流边收边播：收到一小块就塞给播放器，第一块进去就开口 */
async function playStream(stream, a, onStart) {
  const ms = new MediaSource(), rd = stream.getReader(); a.src = URL.createObjectURL(ms);
  await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }));
  const sb = ms.addSourceBuffer('audio/mpeg'), idle = () => sb.updating && new Promise(r => sb.addEventListener('updateend', r, { once: true }));
  for (let on = false; ;) {
    const { done, value } = await rd.read();
    if (playing !== a) { rd.cancel(); return; }   // 被停掉了
    if (done) break;
    sb.appendBuffer(value); await idle();
    if (!on) { on = true; a.play().catch(() => {}); onStart && onStart(); }
  }
  await idle(); if (ms.readyState === 'open') ms.endOfStream();
}
/** 通话用：现在就开始合成，返回的函数轮到这句时再调（= 开播）。能边收边播的接口第一小块到了就出声，不能的整句好了再播；
 *  合成没成的照老办法念（重试、副 API、浏览器朗读都在 speak 里） */
export function speakSoon(text, { conn = resolveConn('tts', 'chat'), voice, stop } = {}) {
  const S = !!window.MediaSource && MediaSource.isTypeSupported('audio/mpeg');
  const pre = conn ? synthesize(conn, text, { voice, stop, stream: S }).catch(e => { log('warn', '语音', `「${conn.name}」合成失败：${e.message}`); return null; }) : Promise.resolve(null);
  return async onStart => {
    const got = await pre; if (stop && stop.aborted) return;
    if (!got) return speak(text, { conn, voice, stop, onStart });
    stopSpeak(); sayEv('start');
    const a = new Audio(); a.volume = Math.min(1, (conn.tts && conn.tts.volume) ?? 1); playing = a;
    const over = new Promise(r => { a.onended = r; a.onerror = r; a.onpause = r; });
    try {
      if (got instanceof ReadableStream) await playStream(got, a, onStart); else { a.src = got; await a.play(); onStart && onStart(); }
      if (playing === a) await over;
    } finally { sayEv('end'); }
  };
}
async function speakRaw(text, { voice, conn = resolveConn('tts', 'chat'), cache, silent, stop, acted, t, onStart } = {}) {   // onStart：真的出声那一刻（立绘动嘴）
  if (!silent) stopSpeak();
  const play = async (url, c) => {
    if (cache) await kvSet(cache, await (await fetch(url)).blob()).catch(e => log('warn', '语音', '合成好的声音没存上：' + e.message));
    if (silent || (stop && stop.aborted)) return;
    const a = new Audio(url); a.volume = Math.min(1, (c && c.tts && c.tts.volume) ?? 1); playing = a; await a.play(); onStart?.();
    return new Promise(r => { a.onended = r; a.onerror = r; a.onpause = r; });   // 被停掉（stopSpeak）也算念完，不然等它的地方会一直卡着
  };
  const saved = cache && await kvGet(cache).catch(() => null);
  if (saved) { cache = null; return play(URL.createObjectURL(saved), conn); }
  if (conn) {
    try { return await play(await withRetry('tts', '语音', () => synthesize(conn, text, { voice, stop, acted, t })), conn); }
    catch (e) {
      if (stop && stop.aborted) return;   // 自己点了停：不换副 API、不用浏览器念
      log('warn', '语音', `「${conn.name}」朗读失败：` + (e.message === 'Failed to fetch' ? '连不上（可能是跨域限制）' : e.message));
      const bk = backupOf('tts');   // 语音线断了 → 先换副 API（用它自己的音色），再不行才用浏览器朗读
      if (bk && bk.id !== conn.id) try {
        const r = await play(await synthesize(bk, text, { acted, t }), bk);
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
    const u = new SpeechSynthesisUtterance(acted ? plain(text) : text); u.lang = 'zh-CN'; u.rate = 1.02;
    const v = speechSynthesis.getVoices().find(x => /zh|Chinese/i.test(x.lang + x.name)); if (v) u.voice = v;
    u.onend = r; u.onerror = r; u.onstart = onStart; playing = u; speechSynthesis.speak(u);
  });
}
export function stopSpeak() {
  try { if (playing instanceof Audio) playing.pause(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  playing = null;
}

/** 酒馆的一个连接配置：格子上要显示的那些 */
export const profInfo = pf => ({ name: pf.name || '未命名配置', model: pf.model || '', api: pf.api || '', preset: pf.preset || '', url: pf['api-url'] || '', mode: pf.mode || '', gone: false });
/**
 * 插线板上酒馆只有一个格子（type tavern），在里面挑用酒馆的哪个配置（pf，空 = 跟着酒馆走）；
 * 要两根线各用一个配置的，自己「添加接口」加出来（type tavern-profile）。这里跟着酒馆更新它们：
 * 酒馆里删掉的配置：没线插着就去掉；有线插着先留着，标成「酒馆里没有了」。返回 true = 有变化
 */
export function syncTavernProfiles() {
  const { list, selected } = tavernProfiles(), C = state.connections, text = C.text;
  const used = id => JSON.stringify([C.defaults, C.retry, C.schemes]).includes(id);
  let changed = false;
  // v0.8.287 以前每个配置都自动成了一个格子：没插线的收进「酒馆」里，插着线的留下当自己加的（作者定的）
  if (!C.tvOne) {
    C.tvOne = changed = true;
    for (let i = text.length - 1; i >= 0; i--) if (text[i].type === 'tavern-profile' && !used(text[i].id)) text.splice(i, 1);
    const tv = text.find(x => x.type === 'tavern'); if (tv && tv.name === '酒馆当前连接') tv.name = '酒馆';
  }
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i]; if (c.type !== 'tavern-profile') continue;
    const pf = list.find(x => x.id === c.profileId);
    if (pf) { const info = profInfo(pf); if (Object.keys(info).some(k => c[k] !== info[k])) { Object.assign(c, info); changed = true; } continue; }
    if (!inTavern()) continue;                     // 不在酒馆里（单独预览）就别动
    if (used(c.id)) { if (!c.gone) { c.gone = true; changed = true; } } else { text.splice(i, 1); changed = true; }
  }
  // 「酒馆」格子记下现在用的是哪个配置、什么模型，给人看；挑的那个配置在酒馆里删了就改回跟着酒馆走
  const tv = text.find(x => x.type === 'tavern');
  if (tv) {
    if (tv.pf && inTavern() && !list.some(x => x.id === tv.pf)) { tv.pf = ''; changed = true; }
    const sel = list.find(x => x.id === (tv.pf || selected));
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
  // 重排：第一次默认插在硅基流动上；密钥没填就照抄向量那条的（同一家，不用填两遍）
  const rr = C.embed.find(c => c.id === 'emb_siliconflow-rerank'), em = C.embed.find(c => c.id === 'emb_siliconflow-embed');
  if (rr && !d[auxKey('重排')] && !C.seeded.rerankPlug) { d[auxKey('重排')] = rr.id; changed = true; }
  C.seeded.rerankPlug = true;
  if (rr && em && !keysOf(rr).length && keysOf(em).length) { rr.key = em.key; rr.keys = [...(em.keys || [])]; changed = true; }
  for (const c of C.embed) if (/^sk-/.test(c.tag || '')) { delete c.tag; changed = true; }   // 以前标签能打字，有人把密钥贴了进去：改回这一类默认的
  // 听写：和重排一样，第一次默认插在硅基流动上，密钥照抄向量那条的
  const st = C.embed.find(c => c.id === 'emb_siliconflow-stt');
  if (st && !d[auxKey('听写')] && !C.seeded.sttPlug) { d[auxKey('听写')] = st.id; changed = true; }
  C.seeded.sttPlug = true;
  if (st && em && !keysOf(st).length && keysOf(em).length) { st.key = em.key; st.keys = [...(em.keys || [])]; changed = true; }
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
/** 把几段话变成向量：回一组数组，顺序和 inputs 一样 */
export async function embed(conn, inputs, signal) {
  const l = (await aux(conn, '/embeddings', { model: conn.model, input: inputs }, signal)).data;
  if (!Array.isArray(l) || !Array.isArray(l[0]?.embedding)) throw new Error('接口没有返回向量');
  return l.sort((x, y) => x.index - y.index).map(x => x.embedding);
}
/** 「其他」线的一次请求（向量、重排）：网络出错、服务器忙时照这根线「断线了怎么办」里定的再试 */
const aux = (conn, path, body, signal) => withRetry('embed', '连接', async () => {
  const key = keysOf(conn)[0] || '';
  const res = await xf(oaiBase(conn.base) + path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await readErr(res));
  return res.json();
});
/** 听写：一段录音变成字（OpenAI 兼容的 /audio/transcriptions） */
export const transcribe = (conn, blob, signal) => withRetry('embed', '连接', async () => {
  const f = new FormData(); f.append('file', blob, 'say.' + (/mp4|m4a|aac/.test(blob.type) ? 'm4a' : /wav/.test(blob.type) ? 'wav' : 'webm')); f.append('model', conn.model);
  const res = await fetch(oaiBase(conn.base) + '/audio/transcriptions', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + (keysOf(conn)[0] || '') }, body: f });
  if (!res.ok) throw new Error(await readErr(res));
  const t = (await res.json()).text;
  if (typeof t !== 'string') throw new Error('接口没有返回文字');
  return t.replace(/<\|[^|]*\|>/g, '').trim();   // SenseVoice 有时带 <|zh|> 这类记号
});
// 腾讯云实时识别：钥匙算成签名放在地址里（网页能直连，不用后端）
async function txSocket(conn, engine) {
  const t = Math.floor(Date.now() / 1000), [, sch, host] = conn.base.match(/^(wss?:\/\/)(.*)$/), E = new TextEncoder();
  const q = { secretid: conn.secretId, timestamp: t, expired: t + 3600, nonce: t % 1e9, engine_model_type: engine, voice_id: crypto.randomUUID(), voice_format: 1, needvad: 1 };
  const path = `${host}/${conn.appId}?${Object.keys(q).sort().map(k => `${k}=${q[k]}`).join('&')}`;
  const key = await crypto.subtle.importKey('raw', E.encode(keysOf(conn)[0] || ''), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, E.encode(path)))));
  return new WebSocket(`${sch}${path}&signature=${encodeURIComponent(sig)}`);
}
/** 实时听写：麦克风的声音边录边传，字跟着出（onText）。stop() = 说完了；end 给整段字，出错（钥匙不对、这个月用完了）带着 code 拒绝 */
export async function listen(conn, stream, engine, onText) {
  const ws = await txSocket(conn, engine), done = [], wait = []; let cur = '', fin, fail;
  const end = new Promise((a, b) => { fin = a; fail = b; }), all = () => done.join('') + cur;
  const ctx = new AudioContext({ sampleRate: 16000 }), src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(1024, 1, 1);
  node.onaudioprocess = e => {
    const f = e.inputBuffer.getChannelData(0), b = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) b[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
    ws.readyState === 1 ? ws.send(b) : wait.push(b);   // 还没连上时说的先攒着，不然第一个字会丢
  };
  src.connect(node); node.connect(ctx.destination);
  const quiet = () => { if (!node.onaudioprocess) return; node.onaudioprocess = null; src.disconnect(); ctx.close(); };
  ws.onopen = () => wait.splice(0).forEach(b => ws.send(b));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.code) return fail(Object.assign(new Error(m.message || '腾讯云拒绝了'), { code: m.code }));
    if (m.result) { if (m.result.slice_type === 2) { done.push(m.result.voice_text_str); cur = ''; } else cur = m.result.voice_text_str; onText(all()); }
    if (m.final) fin(all());
  };
  ws.onerror = () => fail(new Error('连不上腾讯云'));
  ws.onclose = () => fin(all());
  end.catch(() => {}).finally(() => { quiet(); ws.close(); });
  return { end, stop() { quiet(); ws.readyState === 1 ? ws.send('{"type":"end"}') : ws.close(); setTimeout(() => fin(all()), 3000); } };   // 最后一句 3 秒还没定下来：就用已经出来的字
}
/** 测听写接口：发 0.3 秒没声音的录音，能回就算通（腾讯云：能握上手就算通） */
export async function testStt(conn) {
  if (conn.type === 'tencent-asr') {
    const ws = await txSocket(conn, conn.model);
    return new Promise((a, b) => { ws.onmessage = e => { const m = JSON.parse(e.data); ws.close(); m.code ? b(new Error(m.message)) : a(); }; ws.onerror = () => b(new Error('连不上腾讯云')); });
  }
  const n = 4800, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  await transcribe(conn, new Blob([b], { type: 'audio/wav' }));
}
/** 测向量接口：把「你好」变成一串数字 */
export const testEmbed = async conn => (await embed(conn, ['你好']))[0].length;
/** 重排：docs 里哪几条和 query 最对得上。回 [[第几条, 分数]…]，分高的在前 */
export async function rerank(conn, query, docs, signal) {
  const r = (await aux(conn, '/rerank', { model: conn.model, query, documents: docs }, signal)).results;
  if (!Array.isArray(r)) throw new Error('接口没有返回排序');
  return r.map(x => [x.index, x.relevance_score]);
}
