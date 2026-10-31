// 时间：现实时间 / 剧情时间。
// 剧情时间 = 最后一次读到（或手动设定）的那一刻 + 之后现实里过去的分钟数，所以会自己往前走。
import { state, commit } from './store.js';
import { pad } from './util.js';

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
export const partOfDay = hh => hh < 5 ? '深夜' : hh < 9 ? '清晨' : hh < 12 ? '上午' : hh < 14 ? '中午' : hh < 18 ? '下午' : hh < 20 ? '傍晚' : '夜晚';

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

/** 剧情时间现在是第几天、几点；正文里给过日期的话，还会算出今天是几年几月几日 */
export function story() {
  const st = state.settings.storyTime;
  const total = st.minutes + Math.floor((Date.now() - st.at) / 60000);
  const day = st.day + Math.floor(total / 1440), min = ((total % 1440) + 1440) % 1440;
  const base = parseYmd(st.date);
  const date = base ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + (day - st.day)) : null;
  return { day, min, hh: Math.floor(min / 60), mm: min % 60, date };
}
/** date：'2026-10-31' 这样的字符串，可以不给（只知道第几天） */
export function setStory(day, hh, mm, src = 'manual', date) {
  const old = state.settings.storyTime || {};
  const d = Math.max(1, day | 0);
  // 没给日期就沿用以前的：把旧的「基准日期」平移到新的第几天上
  let keep = date || null;
  if (!keep && old.date) { const b = parseYmd(old.date); if (b) keep = ymd(new Date(b.getFullYear(), b.getMonth(), b.getDate() + (d - old.day))); }
  state.settings.storyTime = { day: d, minutes: (hh | 0) * 60 + (mm | 0), at: Date.now(), src, date: keep };
  commit('time');
}
export const isStory = () => state.settings.timeSrc === 'story';

/** 时间显示设置：中文 / 英文，24 / 12 小时制 */
export const clockCfg = () => Object.assign({ lang: 'zh', h12: false }, state.settings.clock);
/** 「2026年10月31日」/「October 31, 2026」 */
export function fmtDate(d, lang = clockCfg().lang) {
  return lang === 'en' ? `${MONTH_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
/** 时:分。12 小时制像苹果一样不补 0、不带上午下午（ap 单独给） */
export function fmtHM(hh, mm, c = clockCfg()) {
  if (!c.h12) return { hm: `${pad(hh)}:${pad(mm)}`, ap: '' };
  const ap = c.lang === 'en' ? (hh < 12 ? 'AM' : 'PM') : (hh < 12 ? '上午' : '下午');
  return { hm: `${hh % 12 || 12}:${pad(mm)}`, ap };
}
/** 当前显示用的时间：只显示年月日，不显示星期和农历 */
export function now() {
  const c = clockCfg(), en = c.lang === 'en';
  if (isStory()) {
    const s = story(), t = fmtHM(s.hh, s.mm, c);
    const date = s.date ? fmtDate(s.date, c.lang) : (en ? `Day ${s.day}` : `第 ${s.day} 天`);
    return { ...t, date, sub: en ? 'Story time' : '剧情时间', hour: s.hh };
  }
  const d = new Date(), t = fmtHM(d.getHours(), d.getMinutes(), c);
  return { ...t, date: fmtDate(d, c.lang), sub: en ? 'Local time' : '本地时间', hour: d.getHours() };
}
/** 给 AI 看的时间描述 */
export function forPrompt() {
  const s = story(), d = new Date();
  return isStory() ? `剧情第 ${s.day} 天${s.date ? `（${fmtDate(s.date, 'zh')} ${WEEK[s.date.getDay()]}）` : ''} ${pad(s.hh)}:${pad(s.mm)}（${partOfDay(s.hh)}）`
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
  // 日期：2026年10月31日 / 2026-10-31 / 2026/10/31 / 2026.10.31
  const ym = /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/.exec(body);
  const tm = /(\d{1,2})\s*[:：]\s*(\d{2})(?!\d)/.exec(ym ? body.replace(ym[0], ' ') : body);
  if (!tm) return null;
  const cur = story();
  const date = ym ? `${ym[1]}-${pad(+ym[2])}-${pad(+ym[3])}` : null;
  let day = dm ? parseInt(dm[1] || dm[2], 10) : cur.day;
  // 只给了日期没给「第几天」：按和上一次日期差了几天往前推
  if (!dm && date && cur.date) day = Math.max(1, cur.day + dayDiff(cur.date, parseYmd(date)));
  return { day, hh: Math.min(23, parseInt(tm[1], 10)), mm: Math.min(59, parseInt(tm[2], 10)), date, raw: body.trim() };
}
