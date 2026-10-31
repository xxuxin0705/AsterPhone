// 日志：报错标红、警告标黄。只留最近 300 条。
import { kvGet, kvSet } from './store.js';
import { debounce } from './util.js';

export const logs = [];
const subs = new Set();
const save = debounce(() => kvSet('logs', logs.slice(-300)).catch(() => {}), 800);

export async function loadLogs() {
  try { const l = await kvGet('logs'); if (Array.isArray(l)) logs.splice(0, logs.length, ...l); } catch (e) { /* 忽略 */ }
}
export function log(level, app, msg, detail) {
  const entry = { id: Date.now() + Math.random(), at: Date.now(), level, app, msg: String(msg), detail: detail == null ? '' : (typeof detail === 'string' ? detail : safe(detail)) };
  logs.push(entry); if (logs.length > 300) logs.shift();
  save(); subs.forEach(f => f(entry));
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[AsterPhone]', app, msg, detail ?? '');
  return entry;
}
function safe(o) { try { return o instanceof Error ? (o.stack || o.message) : JSON.stringify(o, null, 2); } catch (e) { return String(o); } }
export const onLog = f => { subs.add(f); return () => subs.delete(f); };
export function clearLogs() { logs.splice(0); save(); subs.forEach(f => f(null)); }
