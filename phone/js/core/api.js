// AI 调用：按「连接」的渠道类型拼请求。
// 渠道：tavern（酒馆当前连接）/ openai（OpenAI 兼容）/ claude / gemini
import { state } from './store.js';
import { generateTavern, inTavern } from './bridge.js';
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

/** 找出这次该用哪个连接：聊天自己的 → 应用的 → 全局默认 */
export function resolveConn(kind = 'text', app = 'chat', override = 'follow') {
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
export async function generate({ conn, system = '', prompt = '', temperature, maxTokens = 700, app = '聊天' }) {
  if (!conn) throw new Error('还没有设置可用的连接');
  const temp = temperature ?? conn.temperature ?? 0.9;
  const t0 = performance.now();
  try {
    let out;
    if (conn.type === 'tavern') {
      if (!inTavern()) { out = demoReply(prompt); log('info', app, '不在酒馆里，用了演示回复'); }
      else out = await generateTavern({ system, prompt, maxTokens });
    } else if (conn.type === 'openai') {
      const res = await fetch(trim(conn.base) + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (conn.key || '') },
        body: JSON.stringify({ model: conn.model, temperature: temp, max_tokens: maxTokens, messages: [system && { role: 'system', content: system }, { role: 'user', content: prompt }].filter(Boolean) }),
      });
      if (!res.ok) throw new Error(await readErr(res));
      const j = await res.json(); out = j.choices?.[0]?.message?.content ?? '';
    } else if (conn.type === 'claude') {
      const res = await fetch(trim(conn.base || 'https://api.anthropic.com') + '/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': conn.key || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: conn.model, max_tokens: maxTokens, temperature: Math.min(1, temp), system: system || undefined, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) throw new Error(await readErr(res));
      const j = await res.json(); out = (j.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
    } else if (conn.type === 'gemini') {
      const url = `${trim(conn.base || 'https://generativelanguage.googleapis.com')}/v1beta/models/${encodeURIComponent(conn.model)}:generateContent?key=${encodeURIComponent(conn.key || '')}`;
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: temp, maxOutputTokens: maxTokens } }),
      });
      if (!res.ok) throw new Error(await readErr(res));
      const j = await res.json(); out = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
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
  const out = await generate({ conn, system: '', prompt: '只回复两个字：在的', maxTokens: 12, app: '设置' });
  if (!out) throw new Error('连上了，但没有返回内容');
  return out;
}

/* ---------- 演示回复（单独打开预览、没有酒馆时用）---------- */
const DEMO = [
  ['在呢', '刚洗完澡 头发还湿着', '你今天怎么这么晚还不睡'],
  ['哈哈哈哈', '你这人', '行吧 听你的'],
  ['嗯…', '<inner>其实有点想她</inner>', '明天要不要一起吃早饭'],
  ['刚看到', '我在路上了', '十分钟到'],
  ['你又熬夜', '快去睡觉', '晚安 🌙'],
];
let demoIdx = 0;
function demoReply(prompt) {
  if (/谁点赞/.test(prompt)) { const names = [...prompt.matchAll(/^- ([^：\n]+)/gm)].map(m => m[1].trim()); const a = names[0] || '某人', b = names[1] || a; return `赞|${a}\n评论|${b}|拍得不错\n回复|${a}|${b}|你也在线啊`; }
  if (/发一条朋友圈动态/.test(prompt)) return ['今天的晚霞好看到不想回家', '路过的猫比我还会生活 🐈', '下雨天，适合发呆'][demoIdx++ % 3];
  if (/只回复两个字/.test(prompt)) return '在的';
  const lines = DEMO[demoIdx++ % DEMO.length];
  return lines.join('\n');
}
