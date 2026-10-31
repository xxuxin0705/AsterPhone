// 时间：现实时间 / 剧情时间。
// 剧情时间 = 最后一次读到（或手动设定）的那一刻 + 之后现实里过去的分钟数，所以会自己往前走。
import { state, commit } from './store.js';
import { pad } from './util.js';

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
export const partOfDay = hh => hh < 5 ? '深夜' : hh < 9 ? '清晨' : hh < 12 ? '上午' : hh < 14 ? '中午' : hh < 18 ? '下午' : hh < 20 ? '傍晚' : '夜晚';

/** 剧情时间现在是第几天、几点 */
export function story() {
  const st = state.settings.storyTime;
  const total = st.minutes + Math.floor((Date.now() - st.at) / 60000);
  const day = st.day + Math.floor(total / 1440), min = ((total % 1440) + 1440) % 1440;
  return { day, min, hh: Math.floor(min / 60), mm: min % 60 };
}
export function setStory(day, hh, mm, src = 'manual') {
  state.settings.storyTime = { day: Math.max(1, day | 0), minutes: (hh | 0) * 60 + (mm | 0), at: Date.now(), src };
  commit('time');
}
export const isStory = () => state.settings.timeSrc === 'story';

/** 当前显示用的时间 */
export function now() {
  if (isStory()) {
    const s = story();
    return { hm: `${pad(s.hh)}:${pad(s.mm)}`, date: `✦ 第 ${s.day} 天 · ${partOfDay(s.hh)}`, sub: `Story time · Day ${pad(s.day)}`, hour: s.hh };
  }
  const d = new Date();
  return { hm: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK[d.getDay()]}`, sub: 'AsterPhone · Local time', hour: d.getHours() };
}
/** 给 AI 看的时间描述 */
export function forPrompt() {
  const s = story(), d = new Date();
  return isStory() ? `剧情第 ${s.day} 天 ${pad(s.hh)}:${pad(s.mm)}（${partOfDay(s.hh)}）`
    : `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}（${partOfDay(d.getHours())}）`;
}
/** 存到每条消息上的时间戳：现实 + 剧情各一份 */
export function stamp() { const s = story(); return { at: Date.now(), st: { d: s.day, m: s.min } }; }

/** 消息之间的时间分隔线文字 */
export function sepLabel(msg, prev) {
  if (isStory() && msg.st) {
    const { d, m } = msg.st;
    if (prev && prev.st) {
      const gap = (d - prev.st.d) * 1440 + (m - prev.st.m);
      if (gap < 5 && gap >= 0) return '';
      if (!(gap >= 0) && Math.abs(msg.at - prev.at) < 5 * 60000) return '';
    }
    return `第 ${d} 天 ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }
  if (prev && msg.at - prev.at < 5 * 60000) return '';
  const t = new Date(msg.at), n = new Date();
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (t.toDateString() === n.toDateString()) return hm;
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return '昨天 ' + hm;
  return `${t.getMonth() + 1}月${t.getDate()}日 ${hm}`;
}
/** 列表里的短时间 */
export function shortLabel(msg) {
  if (!msg) return '';
  if (isStory() && msg.st) {
    const s = story();
    if (msg.st.d === s.day) return `${pad(Math.floor(msg.st.m / 60))}:${pad(msg.st.m % 60)}`;
    return s.day - msg.st.d === 1 ? '昨天' : `第${msg.st.d}天`;
  }
  const t = new Date(msg.at), n = new Date();
  if (t.toDateString() === n.toDateString()) return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  const y = new Date(n); y.setDate(n.getDate() - 1);
  return t.toDateString() === y.toDateString() ? '昨天' : `${t.getMonth() + 1}/${t.getDate()}`;
}
/** 「刚刚 / 5 分钟前」 */
export function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/** 从正文里读时间标签：<astertime>第3天 21:20</astertime>；也认 Day 3 / 只有时分 */
export function parseTimeTag(text) {
  const tag = (state.timeTagName || 'astertime').replace(/[^\w-]/g, '');
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(String(text || ''));
  if (!m) return null;
  const body = m[1];
  const dm = /第\s*(\d+)\s*天|day\s*(\d+)/i.exec(body);
  const tm = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(body);
  if (!tm) return null;
  const cur = story();
  const day = dm ? parseInt(dm[1] || dm[2], 10) : cur.day;
  return { day, hh: Math.min(23, parseInt(tm[1], 10)), mm: Math.min(59, parseInt(tm[2], 10)), raw: body.trim() };
}
