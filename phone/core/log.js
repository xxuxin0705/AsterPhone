// 日志：两种条目。
// - 事件：一句话（报错红、警告黄、信息绿），比如「正文里出现了新联系人」。
// - 调用：每次找 AI（文字、生图、语音）一条。开始就出现（进行中、实时计时、流式收到的字边收边显示、能中止），
//   结束后原地变成功 / 失败；记着用的哪个接口和模型、发出去的内容、收回来的内容。
// 只留最近 300 条；发出去 / 收回来的内容只有最近 30 次调用留着（每条最多 2 万字），再早的只剩一句话，免得占内存。
import { kvGet, kvSet } from './store.js';
import { debounce } from './util.js';

export const logs = [];
const subs = new Set();
const running = new Map();   // 进行中的调用 id → AbortController
const CAP = 20000, cut = s => { s = String(s ?? ''); return s.length > CAP ? s.slice(0, CAP) + `\n…（后面还有 ${s.length - CAP} 字没存）` : s; };
const save = debounce(() => kvSet('logs', logs.slice(-300)).catch(() => {}), 800);
const tell = (e, how) => subs.forEach(f => f(e, how));

export async function loadLogs() {
  try {
    const l = await kvGet('logs');
    if (Array.isArray(l)) logs.splice(0, logs.length, ...l.map(e => e.run ? { ...e, run: false, level: 'warn', msg: e.msg + '（页面关掉了，没等到结果）' } : e));
  } catch (e) { /* 忽略 */ }
}
function push(entry) {
  logs.push(entry); if (logs.length > 300) tell(logs.shift(), 'remove');
  if (entry.kind === 'call') { let n = 0; for (let i = logs.length - 1; i >= 0; i--) if (logs[i].kind === 'call' && ++n > 30 && logs[i].req) { logs[i].req = logs[i].res = ''; tell(logs[i], 'update'); } }
  save(); tell(entry, 'add');
  return entry;
}
export function log(level, app, msg, detail) {
  const entry = push({ id: Date.now() + Math.random(), at: Date.now(), level, app, msg: String(msg), detail: detail == null ? '' : (typeof detail === 'string' ? detail : safe(detail)) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[AsterPhone]', app, msg, detail ?? '');
  return entry;
}
function safe(o) { try { return o instanceof Error ? (o.stack || o.message) : JSON.stringify(o, null, 2); } catch (e) { return String(o); } }

/** 开始一次调用。返回 { id, signal, part(收到的字), done(结果说明, 收到的字), fail(原因) }；signal 给 fetch 用，点「中止」就断掉 */
export function startCall({ app, what = '生成', src = '', model = '', req = '' }) {
  const ac = new AbortController();
  const e = push({ id: Date.now() + Math.random(), at: Date.now(), kind: 'call', run: true, level: 'info', app, what, src, model, req: cut(req), res: '', msg: `${what}中…` });
  running.set(e.id, ac);
  let pend = 0;
  const end = () => { running.delete(e.id); e.run = false; e.ms = Date.now() - e.at; save(); tell(e, 'update'); };
  return {
    id: e.id, signal: ac.signal,
    // 流式：收到一段就更新，最多每 0.2 秒刷一次界面
    part(text) { e.res = cut(text); if (!pend) pend = setTimeout(() => { pend = 0; if (e.run) tell(e, 'update'); }, 200); },
    done(res) { clearTimeout(pend); e.res = cut(res); const one = String(res).replace(/\s+/g, ' ').trim(); e.msg = `${what}完成：${one.length > 40 ? one.slice(0, 40) + '…' : one}`; end(); },   // 一眼看到回了什么
    fail(msg) { clearTimeout(pend); e.level = 'error'; e.msg = `${what}失败：${msg}`; end(); console.error('[AsterPhone]', app, e.msg); },
  };
}
/** 等着的东西没法真的断开（比如酒馆那边在生成）时，用它和 signal 赛跑：点了中止就不等了 */
export const orAbort = (p, signal) => !signal ? p : Promise.race([p, new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('已中止')), { once: true }))]);
export function abortCall(id) { const ac = running.get(id); if (ac) ac.abort(new Error('已中止')); }
export function removeLog(id) { const i = logs.findIndex(e => e.id === id); if (i < 0) return; abortCall(id); tell(logs.splice(i, 1)[0], 'remove'); save(); }
export const onLog = f => { subs.add(f); return () => subs.delete(f); };
export function clearLogs() { running.forEach(ac => ac.abort(new Error('已中止'))); logs.splice(0); save(); tell(null, 'clear'); }
