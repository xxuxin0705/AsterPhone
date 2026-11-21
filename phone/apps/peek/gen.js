// 查手机里的内容：每个联系人一份，存在 kv 的 peek:联系人 id（{ apps: { 应用: { at, rows } } }）。
// 只在你点「生成」时找 AI，勾了几个应用也只找一次；AI 一行一条地回，写到哪个应用算哪个，没写到的留着旧的。
import { h, shortTime } from '../../core/util.js';
import { state, commit, kvGet, kvSet, friends, contact, getMsgs, chatForContact, win } from '../../core/store.js';
import { sheet, toast, waiting } from '../../core/ui.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName, myPersona, myAvatar } from '../../core/promptstore.js';
import { storyText, worldText } from '../../core/context.js';
import * as time from '../../core/time.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { previewOf } from '../chat/msgtypes.js';
import { chatMsgs } from '../../core/memory.js';

export const S = () => state.apps.peek ||= { every: 0, count: 6, fill: false, fillMax: 3 };
/** 换 TA 手机的壁纸（w = cropImage 给的 { img, src, box, fx }，空的就是恢复默认） */
export async function setWall(c, w) { const d = (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} }; if (w) d.wall = w; else delete d.wall; await kvSet('peek:' + c.id, d); }

/** 能生成的应用：名字 → 给 AI 看的一行怎么写 */
export const FORMS = {
  备忘录: '便签｜标题｜日期｜正文\n心声｜此刻的几个情绪（两三个词，用顿号隔开）｜{{char}} 心里没说出口的话（一小段，第一人称，只写给自己看的）\n涂鸦｜标题｜用字符随手画的小涂鸦（每行用 // 隔开，最多 8 行，每行不超过 14 个字）｜涂鸦解析（画的是什么、为什么画）\n（便签照常写；心声、涂鸦各写一条）',
  搜索: '搜索｜搜的话｜时间\n看过｜网页标题｜网址（编一个像样的）｜看到了什么、TA 心里怎么想（一两句）｜时间\n收藏｜网页标题｜网址\n无痕｜偷偷搜的话｜时间（不想被人看到的，有才写）\n（搜索、看过各写几条，收藏 2～4 条）',
  短信: '对方（名字或号码）｜时间｜对方 / 自己（这条谁发的）｜内容\n（同一个人的几条挨着写，按先后）',
  电话: '对方｜呼入 / 呼出 / 未接（三选一）｜时间｜归属地（省 市，存了名字的熟人可以空着）\n留言｜对方｜时间｜留言多长（分:秒）｜留言里说的话（语音留言 0～3 条，没有就不写）\n联系人｜{{char}} 存的名字（会起备注就写备注）｜这是谁（几个字）\n（通话记录之外，再写 6～10 行联系人）',
  购物车: '商品｜价格（只写数字）｜数量｜店铺｜为什么想买（{{char}} 心里的一句话）',
  饿了吗: '店名｜点了什么｜花了多少（只写数字）｜时间｜给商家的备注',
  日历: '天气｜今天的天气（一两个字）｜现在几度｜最高几度｜最低几度（只写这一行，度数只写数字）\n日期（几月几日）｜几点｜什么事｜地点',
  钱包: '余额｜数字（只写这一行）\n时间｜和谁 / 干什么｜金额（花掉的前面写 -，收到的写 +）｜分类（餐饮、购物、交通、娱乐、人情、其他 里选一个）',
  消息: `和谁聊（人名；群聊写「群：群名」）｜时间｜这句谁说的｜内容
备注｜{{user}}｜{{char}} 给 {{user}} 存的备注名（只写这一行）
草稿｜对谁｜打了没发出去的话（有才写，最多两行）
（写 3～5 个对话，每个 6～12 句，同一个对话的挨着写、按先后；{{char}} 自己说的那句「这句谁说的」写「自己」；不要写和 {{user}} 的聊天，那个手机里已经有了；可以有 {{user}} 不在的群）`,
  论坛: '树洞｜{{char}} 在论坛树洞里匿名发的心事（一两句到一小段，不点名）\n（写 2～4 条）',
  音乐: '资料｜粉丝数（只写数字）｜等级（1～10）｜一共听了多少小时（只写数字）\n关注｜关注的歌手（用顿号隔开）\n（这两行各写一行就够）',
  屏幕使用时间: '应用名｜今天用了多少分钟（只写数字）\n（写 6～8 个，从多到少）',
  相册: `图库｜这张照片拍的是什么（一句话写清画面）｜时间｜地点
隐藏｜画面｜时间｜地点（不想被人看到的，有才写）
删除｜画面｜时间｜为什么删（最近删掉的，有才写）`,
  AI: `哪个 AI｜这次对话的标题｜这句谁说的（自己 / AI）｜内容
（「哪个 AI」只能是 Claude、GPT、Gemini、豆包、DeepSeek；{{char}} 会用的才写，每个用到的写 1～2 次对话、每次 4～8 句，同一次对话的挨着写；问的是 {{char}} 真会拿去问 AI 的事，可以和最近发生的事有关；AI 回答完 {{char}} 可以有反应。
五个 AI 说话不一样：Claude 客气谨慎、爱先说清楚前提；GPT 喜欢分点列条、末尾问要不要继续；Gemini 嘴甜爱夸人；豆包也爱夸人，热情但常常答不到点上；DeepSeek 先想一大段再答，偶尔想太多。）`,
};
const form = (n, c) => FORMS[n].replace(/\{\{char\}\}/g, c.name || nameOf(c)).replace(/\{\{user\}\}/g, myName());
const pairKey = (a, b) => 'peek:pair:' + [a, b].sort().join('|');
const said = (m, who, me) => ({ who, me, t: shortTime(m.at), text: m.type === 'text' ? m.text : previewOf(m) });
/** c 的手机里有什么：AI 写的各应用（apps）、和别的联系人的聊天（pairs：两个人共用一份，谁的手机里看都一样）、你手机里真有的聊天（real：和你的私聊、TA 在的群） */
export async function load(c) {
  const d = (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} };
  d.id = c.id; d.name = nameOf(c); d.avatar = c.avatar;
  d.pairs = (await Promise.all(friends().filter(x => x.id !== c.id).map(async x => [x, await kvGet(pairKey(c.id, x.id)).catch(() => null)]))).filter(x => x[1])
    .map(([x, L]) => ({ title: nameOf(x), avatar: x.avatar, msgs: L.map(m => ({ ...m, me: m.from === c.id, who: nameOf(contact(m.from)) })) }));
  const mine = chatForContact(c.id, false), groups = state.chats.filter(ch => ch.type === 'group' && (ch.members || []).includes(c.id));
  d.real = (await Promise.all([mine, ...groups].filter(Boolean).map(async ch => ({ title: ch.type === 'group' ? ch.name : myName(), group: ch.type === 'group', you: ch.type !== 'group', avatar: ch.type === 'group' ? ch.avatar : myAvatar(),
    msgs: (await getMsgs(ch.id)).filter(m => m.from !== 'sys' && !m.recalled).slice(-60).map(m => m.from === 'me' ? said(m, myName(), false) : said(m, nameOf(contact(m.who) || c), !m.who || m.who === c.id)) })))).filter(x => x.msgs.length);
  return d;
}

/** 记下 TA 手机里哪些信息点开看过了（只存这一项，别的照旧） */
export async function saveRead(D) { const d = (await kvGet('peek:' + D.id).catch(() => null)) || { apps: {} }; d.read = D.read; await kvSet('peek:' + D.id, d).catch(() => {}); }

// 正在生成的那一次（放在模块里：退出再进来还是「取消」，不会又发一个）
let job = null;
export const running = () => job;

function parse(raw) {
  const out = {}; let cur = null;
  for (const l of String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').split('\n').map(x => x.trim()).filter(Boolean)) {
    const m = !/[｜|]/.test(l) && l.match(/【(.+?)】/);   // AI 有时在【应用名】前后多写几个符号
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
      const raw = await generate({ conn: resolveConn('text', 'peek'), system: '', app: '查手机', stop, resume: S().fill ? S().fillMax || 3 : 0,
        prompt: compose('peek', { char: c.name || nameOf(c), user: myName(), persona: personaOf(c) || '（没有写）', user_persona: myPersona() || '（没有写）',
          world: await worldText(story, [c], 'peek').catch(() => ''), story, people: [myName(), ...friends().filter(x => x.id !== c.id).map(x => x.name || nameOf(x))].map(n => '- ' + n).join('\n'),
          time: now ? `${now.date.toLocaleDateString('zh-CN')} ${now.hh}:${String(now.mm).padStart(2, '0')}` : new Date().toLocaleString('zh-CN'),
          count: S().count || 6, apps: names.map(n => `【${n}】\n${form(n, c)}`).join('\n') }) });
      const got = parse(raw);
      if (!Object.values(got).some(r => r.length)) throw new Error('AI 回的不是手机内容：' + String(raw).slice(0, 60));
      return got;
    }, ac);
    if (!got) return;
    const d = (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} }, ok = names.filter(n => got[n] && got[n].length);
    // 和手机里别的联系人的私聊另存一份两个人共用的，剩下的（群、不认识的人、备注、草稿）留在 TA 自己这份里
    if (got.消息) {
      const who = n => friends().find(x => x.id !== c.id && (x.name === n || nameOf(x) === n)), by = new Map();
      got.消息 = got.消息.filter(r => { const x = who(r[0]); if (x) (by.get(x) || by.set(x, []).get(x)).push({ from: /自己/.test(r[2]) || r[2] === c.name ? c.id : x.id, t: r[1], text: r[3] }); return !x; });
      await Promise.all([...by].map(([x, L]) => kvSet(pairKey(c.id, x.id), L)));
    }
    ok.forEach(n => { d.apps[n] = { at: Date.now(), rows: got[n] }; });
    await kvSet('peek:' + c.id, d);
    const miss = names.filter(n => !ok.includes(n));
    if (miss.length) log('warn', '查手机', `这几个应用 AI 没写：${miss.join('、')}`);
    toast(miss.length ? `写好 ${ok.length} 个，${miss.join('、')}没写出来` : `写好了，${ok.length} 个应用`);
    done({ ...await load(c), who: c.id });
  } catch (e) { log('error', '查手机', '生成失败：' + e.message, e); toast('没写成：' + e.message); }
  finally { job = null; }
}

/** 勾选要生成哪些应用（默认全勾） */
export function pickApps(c, d, start) {
  const on = new Set((S().last || Object.keys(FORMS)).filter(n => FORMS[n]));
  const rows = Object.keys(FORMS).map(n => { const b = h('button.pk-tick.is-on', { onclick: () => { on.has(n) ? on.delete(n) : on.add(n); mark(); } }, h('i'), h('span', n), h('small', d.apps[n] ? '有了，会换成新的' : '')); b._n = n; return b; });
  const all = h('button.pk-sheet__all', { onclick: () => { const full = on.size === rows.length; rows.forEach(b => full ? on.delete(b._n) : on.add(b._n)); mark(); } });
  const go = h('button.as-btn.as-btn--primary', { onclick: () => { s.close(); S().last = [...on]; commit('apps'); start([...on]); } });
  const mark = () => { rows.forEach(b => b.classList.toggle('is-on', on.has(b._n))); all.textContent = on.size === rows.length ? '全不选' : '全选'; go.disabled = !on.size; go.textContent = on.size ? `生成 ${on.size} 个（用一次 API）` : '生成'; };
  const s = sheet({ title: `${nameOf(c)}的手机`, content: [all, h('div.pk-ticks', rows), go] });
  mark();
}

/** 每隔几楼自动生成（TA 手机的设置里选了才会）：给上次看的那个人，写上次勾的那几个应用 */
export async function auto() {
  const P = S(), n = chatMsgs().length;
  if (!P.every || job) return;
  if (P.at == null || n < P.at) { P.at = n; commit('apps'); return; }
  if (n - P.at < P.every) return;
  const c = contact(await kvGet('peek:who:' + win.key).catch(() => ''));
  if (!c) return;
  P.at = n; commit('apps');
  await make(c, P.last || Object.keys(FORMS), () => {});
}
