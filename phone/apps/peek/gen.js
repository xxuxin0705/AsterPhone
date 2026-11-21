// 查手机里的内容：每个联系人一份，存在 kv 的 peek:联系人 id（{ apps: { 应用: { at, rows } } }）。
// 只在你点「生成」时找 AI，勾了几个应用也只找一次；AI 一行一条地回，写到哪个应用算哪个，没写到的留着旧的。
import { h } from '../../core/util.js';
import { kvGet, kvSet, friends } from '../../core/store.js';
import { sheet, toast, waiting } from '../../core/ui.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName, myPersona } from '../../core/promptstore.js';
import { storyText, worldText } from '../../core/context.js';
import * as time from '../../core/time.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf } from '../chat/engine.js';

/** 能生成的应用：名字 → 给 AI 看的一行怎么写 */
export const FORMS = {
  备忘录: '标题｜日期｜正文',
  搜索: '搜的话｜时间｜历史 / 收藏 / 无痕（三选一）',
  短信: '对方（名字或号码）｜时间｜对方 / 自己（这条谁发的）｜内容\n（同一个人的几条挨着写，按先后）',
  电话: '对方｜呼入 / 呼出 / 未接（三选一）｜时间｜通话多久',
  购物车: '商品｜价格（只写数字）｜数量｜店铺｜为什么想买（{{char}} 心里的一句话）',
  饿了吗: '店名｜点了什么｜花了多少（只写数字）｜时间｜给商家的备注',
  日历: '日期｜几点｜什么事｜地点',
  钱包: '余额｜数字（只写这一行）\n时间｜和谁 / 干什么｜金额（花掉的前面写 -，收到的写 +）',
};

export const load = async c => (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} };

// 正在生成的那一次（放在模块里：退出再进来还是「取消」，不会又发一个）
let job = null;
export const running = () => job;

function parse(raw) {
  const out = {}; let cur = null;
  for (const l of String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').split('\n').map(x => x.trim()).filter(Boolean)) {
    const m = l.match(/^【(.+?)】$/);
    if (m) cur = FORMS[m[1]] ? out[m[1]] = [] : null;
    else if (cur && /[｜|]/.test(l)) cur.push(l.split(/[｜|]/).map(x => x.trim()));
  }
  return out;
}

/** 给 c 生成 names 这几个应用；done(d) 是写好后要做的（重画开着的页面） */
export async function make(c, names, done) {
  if (job) return;
  const ac = new AbortController(); job = { ac, who: c.id };
  try {
    const got = await waiting(`正在写${nameOf(c)}的手机…`, async stop => {
      const story = storyText() || '（暂无）', now = time.isStory() ? time.story() : null;
      const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '查手机', stop,
        prompt: compose('peek', { char: c.name || nameOf(c), user: myName(), persona: personaOf(c) || '（没有写）', user_persona: myPersona() || '（没有写）',
          world: await worldText(story, [c], 'peek').catch(() => ''), story, people: [myName(), ...friends().filter(x => x.id !== c.id).map(x => x.name || nameOf(x))].map(n => '- ' + n).join('\n'),
          time: now ? `${now.date.toLocaleDateString('zh-CN')} ${now.hh}:${String(now.mm).padStart(2, '0')}` : new Date().toLocaleString('zh-CN'),
          apps: names.map(n => `【${n}】\n${FORMS[n].replace('{{char}}', c.name || nameOf(c))}`).join('\n') }) });
      const got = parse(raw);
      if (!Object.values(got).some(r => r.length)) throw new Error('AI 回的不是手机内容：' + String(raw).slice(0, 60));
      return got;
    }, ac);
    if (!got) return;
    const d = await load(c), ok = names.filter(n => got[n] && got[n].length);
    ok.forEach(n => { d.apps[n] = { at: Date.now(), rows: got[n] }; });
    await kvSet('peek:' + c.id, d);
    const miss = names.filter(n => !ok.includes(n));
    if (miss.length) log('warn', '查手机', `这几个应用 AI 没写：${miss.join('、')}`);
    toast(miss.length ? `写好 ${ok.length} 个，${miss.join('、')}没写出来` : `写好了，${ok.length} 个应用`);
    done({ ...d, who: c.id });
  } catch (e) { log('error', '查手机', '生成失败：' + e.message, e); toast('没写成：' + e.message); }
  finally { job = null; }
}

/** 勾选要生成哪些应用（默认全勾） */
export function pickApps(c, d, start) {
  const on = new Set(Object.keys(FORMS));
  const rows = Object.keys(FORMS).map(n => { const b = h('button.pk-tick.is-on', { onclick: () => { on.has(n) ? on.delete(n) : on.add(n); mark(); } }, h('i'), h('span', n), h('small', d.apps[n] ? '有了，会换成新的' : '')); b._n = n; return b; });
  const all = h('button.pk-sheet__all', { onclick: () => { const full = on.size === rows.length; rows.forEach(b => full ? on.delete(b._n) : on.add(b._n)); mark(); } });
  const go = h('button.as-btn.as-btn--primary', { onclick: () => { s.close(); start([...on]); } });
  const mark = () => { rows.forEach(b => b.classList.toggle('is-on', on.has(b._n))); all.textContent = on.size === rows.length ? '全不选' : '全选'; go.disabled = !on.size; go.textContent = on.size ? `生成 ${on.size} 个（用一次 API）` : '生成'; };
  const s = sheet({ title: `${nameOf(c)}的手机`, content: [all, h('div.pk-ticks', rows), go] });
  mark();
}
