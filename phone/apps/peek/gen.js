// 查手机里的内容：每个联系人一份，存在 kv 的 peek:联系人 id（{ apps: { 应用: { at, rows } } }）。
// 只在你点「生成」时找 AI，勾了几个应用也只找一次；AI 一行一条地回，写到哪个应用算哪个，没写到的留着旧的。
import { h, shortTime } from '../../core/util.js';
import { state, commit, kvGet, kvSet, friends, contact, getMsgs, chatForContact, win } from '../../core/store.js';
import { sheet, toast, waiting } from '../../core/ui.js';
import { langFor, langName, translate, zhOf } from '../../core/translate.js';
import { generate, resolveConn, withModel } from '../../core/api.js';
import { compose, myName, myPersona, myAvatar } from '../../core/promptstore.js';
import { storyText, worldText } from '../../core/context.js';
import * as time from '../../core/time.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf, parenTr } from '../chat/engine.js';
import { previewOf, callName } from '../chat/msgtypes.js';
import { chatMsgs } from '../../core/memory.js';

export const S = () => state.apps.peek ||= { every: 0, count: 6, fill: false, fillMax: 3 };
/** 查手机找 AI 用哪个接口、哪个模型：没另选接口就跟聊天；模型能在用着的接口里另挑一个（按接口各记各的，换了接口不会串） */
export const connOf = () => { const P = S().conn || {}, c = resolveConn('text', 'chat', P.text); return withModel(c, c && (P.models || {})[c.id]); };
/** 换 TA 手机的壁纸（w = cropImage 给的 { img, src, box, fx }，空的就是恢复默认） */
export async function setWall(c, w) { const d = (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} }; if (w) d.wall = w; else delete d.wall; await kvSet('peek:' + c.id, d); }

/** 能生成的应用：名字 → 给 AI 看的一行怎么写 */
// 每行第一格前面的「＃」= 这一格是行名（照抄），「※」= 这一格是 TA 写的、说的、看的字：TA 说外语时要写成「中文[原文：外文]」。
// 这两个记号只给手机看（哪几格该有翻译，不用猜），发给 AI 前去掉（form）
export const FORMS = {
  备忘录: '＃便签｜※标题｜日期（年/月/日）｜※放在哪个文件夹｜※正文\n＃清单｜※标题｜日期｜※文件夹｜※一样一样列，每样前面写 √（办了）或 ○（还没办），用 // 隔开\n＃草稿｜※标题｜日期｜写给谁（名字）｜※想发给这个人、打了字最后没发出去的话\n＃心声｜※此刻的几个情绪（两三个词，用顿号隔开）｜※{{char}} 心里没说出口的话（一小段，第一人称，只写给自己看的）\n（备忘录是 {{char}} 随手记给自己的，不是写文章。这几种混着来：便签最多，每条的样子都不一样，有的只有一行，有的是怕忘的数字、地址、型号，有的是写到一半没写完的话，有的是抄下来的一句，也有长一点的碎碎念；清单一两条，有的勾了有的没勾；草稿最多一条，照 TA 和那个人真实的关系写，不一定是好话；心声写一条。不要每条都是两三段完整的话，不要每条都有头有尾有总结。标题就是 TA 顺手打的第一行。文件夹是 TA 自己分的、自己起的名字，两三个就够，懒得分的那条就空着）',
  搜索: '＃搜索｜※搜的话｜时间｜※搜完点开的那页的标题（照抄下面看过那页的标题）\n＃看过｜类型（文章或视频）｜※网页标题｜网址（编一个像样的，不写 https://）｜时间｜※看完心里怎么想（一两句）｜※正文｜视频的时长和播放量（文章空着）\n＃收藏｜类型｜※网页标题｜网址｜收藏的时候｜｜※正文｜视频的时长和播放量\n＃无痕｜类型｜※网页标题｜网址｜时间｜※看完心里怎么想｜※正文｜视频的时长和播放量\n（搜索 4～6 条；看过的就是这些搜索点开的那几页，再加一两页从别处点进来的。收藏一定要写 3～5 条：大多是正常的（攻略、店、想买的、教程），混一两条有私心的。无痕是见不得人、心虚的，有才写。\n时间要扎堆：几分钟里连着查几条，再隔几个小时；要有一条深夜查的、一条很琐碎的日常（天气、路线、换算之类）。\n正文要像真的网页、详略有别：文章先一段开头，再分几段，可以用「■小标题：内容」「> 引用的一句话」「[图：这张图是什么]」，要紧的词用 **两边星号**（小标题里不用），段和段之间用 // 隔开，别每段都一个样子；视频的正文是简介，两三句。正文分了段的，标了的写法每一段各写一次，配图、引用那段也一样。）',
  短信: '对方（名字或号码）｜时间｜对方 / 自己（这条谁发的）｜※内容\n（同一个人的几条挨着写，按先后。短信多是验证码、快递、银行和消费提醒、运营商通知、广告、垃圾短信，也可以有熟人，要有发短信的理由（没网、急事、工作通知、长辈不用聊天软件）；日常聊天在聊天软件里，不写进短信；不要写和 {{user}} 的短信）',
  电话: '对方｜呼入 / 呼出 / 未接（三选一）｜时间｜归属地（省 市，存了名字的熟人可以空着；用聊天软件打的写「语音通话」或「视频通话」）\n＃留言｜对方｜时间｜留言多长（分:秒）｜※留言里说的话（语音留言 0～3 条，没有就不写）\n＃联系人｜真名｜{{char}} 手机里存的备注｜这是谁（几个字）\n（通话记录里熟人（朋友、同事、家人）多一些，不要写和 {{user}} 的通话和留言；通话记录之外，再写 6～10 行联系人；通话记录、留言、短信里的「对方」都写真名，手机上会显示成备注。备注照 {{char}} 现在跟这个人的关系和熟悉程度存：熟人就是平时怎么叫就怎么存（名字、昵称、爱称），不熟的存全名或「姓 + 身份」；不要写成背地里给人起的外号，也不要停在刚认识时的印象）',
  购物车: '※商品｜价格（只写数字）｜数量｜店铺｜※为什么想买（{{char}} 心里的一句话）',
  饿了吗: '店名｜※点了什么｜花了多少（只写数字）｜时间｜※给商家的备注',
  日历: '＃天气｜今天的天气（一两个字）｜现在几度｜最高几度｜最低几度（只写这一行，度数只写数字）\n日期（几月几日）｜几点｜※什么事｜地点',
  钱包: '＃余额｜数字（只写这一行）\n时间｜※和谁 / 干什么｜金额（花掉的前面写 -，收到的写 +）｜分类（餐饮、购物、交通、娱乐、人情、其他 里选一个）',
  消息: `和谁聊（人名；群聊写「群：群名」）｜时间｜这句谁说的｜※内容
＃备注｜{{user}}｜{{char}} 给 {{user}} 存的备注名（只写这一行）
＃草稿｜对谁｜※打了没发出去的话（有才写，最多两行）
（写 3～5 个对话，每个 6～12 句，同一个对话的挨着写、按先后；{{char}} 自己说的那句「这句谁说的」写「自己」；不要写和 {{user}} 的聊天，那个手机里已经有了；可以有 {{user}} 不在的群）`,
  论坛: '＃树洞｜※{{char}} 在论坛树洞里匿名发的心事（一两句到一小段，不点名）\n（写 2～4 条）',
  音乐: '＃资料｜粉丝数（只写数字）｜等级（1～10）｜一共听了多少小时（只写数字）\n＃关注｜关注的歌手（用顿号隔开）\n（这两行各写一行就够）',
  屏幕使用时间: '应用名｜今天用了多少分钟（只写数字）\n（写 6～8 个，从多到少）',
  相册: `＃图库｜这张照片拍的是什么（一句话写清画面）｜时间｜地点｜从哪来（相机拍的写「相机」，截屏写「截屏」，别的 App 里存下来的写那个 App 的名字）
＃隐藏｜画面｜时间｜地点（不想被人看到的，有才写）
＃删除｜画面｜时间｜为什么删（最近删掉的，有才写）`,
  AI: `哪个 AI｜※这次对话的标题｜这句谁说的（自己 / AI）｜※内容
（「哪个 AI」只能是 Claude、GPT、Gemini、豆包、DeepSeek；{{char}} 会用的才写，每个用到的写 1～2 次对话、每次 4～8 句，同一次对话的挨着写；问的是 {{char}} 真会拿去问 AI 的事，可以和最近发生的事有关；AI 回答完 {{char}} 可以有反应。
五个 AI 说话不一样：Claude 客气谨慎、爱先说清楚前提；GPT 喜欢分点列条、末尾问要不要继续；Gemini 嘴甜爱夸人；豆包也爱夸人，热情但常常答不到点上；DeepSeek 先想一大段再答，偶尔想太多。）`,
};
const form = (n, c, l) => FORMS[n].replace(/＃/g, '').replace(/※([^｜\n]*)/g, (_, x) => /^zh/.test(l) ? x : `${x}〔写成：中文意思[原文：${langName(l)}原文]〕`).replace(/\{\{char\}\}/g, c.name || nameOf(c)).replace(/\{\{user\}\}/g, myName());
const TRC = Object.fromEntries(Object.entries(FORMS).map(([n, t]) => [n, t.split('\n').filter(L => L.includes('｜') && L[0] !== '（').map(L => { const C = L.split('｜'); return [C[0][0] === '＃' ? C[0].slice(1) : '', C.flatMap((x, i) => x[0] === '※' ? [i] : [])]; })]));
const trCols = (n, r) => ((TRC[n] || []).find(L => L[0] === r[0]) || (TRC[n] || []).find(L => !L[0]) || ['', []])[1];
const pairKey = (a, b) => 'peek:pair:' + [a, b].sort().join('|');
const said = (m, who, me) => ({ who, me, t: shortTime(m.at), text: m.type === 'text' ? m.text : previewOf(m) });
/** c 的手机里有什么：AI 写的各应用（apps）、和别的联系人的聊天（pairs：两个人共用一份，谁的手机里看都一样）、你手机里真有的聊天（real：和你的私聊、TA 在的群） */
export async function load(c) {
  const d = (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} };
  d.id = c.id; d.name = nameOf(c); d.avatar = c.avatar;
  if (!d.lang) d.lang = guess(d.apps);   // 以前生成的没记是什么语言
  for (const a of Object.values(d.apps)) a.rows = a.rows.map(r => r.map(c => perLine(parenTr(c))));
  d.pairs = (await Promise.all(friends().filter(x => x.id !== c.id).map(async x => [x, await kvGet(pairKey(c.id, x.id)).catch(() => null)]))).filter(x => x[1])
    .map(([x, L]) => ({ title: nameOf(x), avatar: x.avatar, msgs: L.map(m => ({ ...m, me: m.from === c.id, who: nameOf(contact(m.from)) })) }));
  const mine = chatForContact(c.id, false), groups = state.chats.filter(ch => ch.type === 'group' && (ch.members || []).includes(c.id));
  d.real = (await Promise.all([mine, ...groups].filter(Boolean).map(async ch => ({ title: ch.type === 'group' ? ch.name : myName(), group: ch.type === 'group', you: ch.type !== 'group', avatar: ch.type === 'group' ? ch.avatar : myAvatar(),
    msgs: (await getMsgs(ch.id)).filter(m => m.from !== 'sys' && !m.recalled).slice(-60).map(m => m.from === 'me' ? said(m, myName(), false) : said(m, nameOf(contact(m.who) || c), !m.who || m.who === c.id)) })))).filter(x => x.msgs.length);
  const sm = state.sms.find(t => [c.name, c.nick, c.remark].includes(t.who));   // 你手机「短信」里和 TA 的，TA 那边也有
  // 你和 TA 真打过的电话（电话 App 里的普通电话 + 聊天里的语音、视频）：TA 手机里方向反过来，时间写成和 AI 写的一样的样子好一起排
  d.calls = [...state.calls.filter(x => x.cid === c.id), ...(mine ? (await getMsgs(mine.id)).filter(m => m.type === 'call') : [])].map(x => [myName(), x.from === 'them' ? '呼出' : '呼入', time.stampText(x), x.mode === 'phone' ? '手机' : callName(x)]);
  d.sms = sm && { title: myName(), avatar: myAvatar(), msgs: sm.list.slice(-60).map(m => ({ me: !m.me, t: shortTime(m.at), text: m.tr ? `${m.text}[翻译：${m.tr}]` : m.text })) };
  return d;
}

/** 记下 TA 手机里哪些信息看过、左滑删了、标成未读，相册里删了、点了喜欢的（只存这几项，别的照旧） */
export async function saveRead(D) { const d = (await kvGet('peek:' + D.id).catch(() => null)) || { apps: {} }; Object.assign(d, { read: D.read, hide: D.hide, unread: D.unread, fav: D.fav }); await kvSet('peek:' + D.id, d).catch(() => {}); }

// 分了好几行（//）的一格，AI 有时只在最后附一整段翻译：行数对得上就拆成每行各带一个，备忘录、正文才能一行一行换
const perLine = s => {
  const m = typeof s === 'string' && (s.match(/[[［【]翻译[:：]/g) || []).length === 1 && /^([\s\S]*?)\s*[[［【]翻译[:：]\s*([\s\S]*)[\]］】]\s*$/.exec(s);
  if (!m) return s;
  const A = m[1].split(/(?<!:)\/\//), Z = m[2].split(/(?<!:)\/\//);
  return A.length > 1 && A.length === Z.length ? A.map((a, i) => `${a}[翻译：${Z[i]}]`).join('//') : s;
};
// 原文是什么语言：看附了翻译的原文猜（假名是日语、谚文是韩语…）；没有外文就是空的
const guess = apps => { const t = JSON.stringify(apps); return !/翻译[:：]/.test(t) ? '' : /[\u3040-\u30ff]/.test(t) ? 'ja' : /[\uac00-\ud7af]/.test(t) ? 'ko' : /[а-яё]/i.test(t) ? 'ru' : 'en'; };
/** TA 现在说的语言（映像里选的，没选跟着设置） */
export const speakIn = c => langFor('chat', chatForContact(c.id, false)?.cfg.speak);
/* 换了 TA 说的语言：中文那版一直不变；外文那版要是和生成时不一样，从中文机翻（不花 API），记在 d.mt[语言]，再切回来就不用再翻 */
const TRG = /[[［【]翻译[:：]\s*((?:[^[\]［］【】]|[[［【][^\]］】]*[\]］】])*)[\]］】]/g;
export async function relangPeek(c, D) {
  const l = speakIn(c); if (/^zh/.test(l) || l === (D.lang || l)) return false;
  const all = [...Object.values(D.apps).flatMap(a => a.rows.flat()), ...D.pairs.flatMap(x => x.msgs.map(m => m.text))];
  const mt = ((D.mt ||= {})[l] ||= {}), todo = [...new Set(all.flatMap(t => [...String(t || '').matchAll(TRG)].map(m => m[1])))].filter(z => z.trim() && !mt[z]);
  if (!todo.length) return false;
  const ok = await waiting(`换成${langName(l)}…`, async sig => { for (let i = 0; i < todo.length && !sig.aborted; i += 3) await Promise.all(todo.slice(i, i + 3).map(async z => { mt[z] = await translate(z, l); })); return true; });
  const d = (await kvGet('peek:' + c.id).catch(() => null)) || { apps: {} }; d.mt = D.mt; await kvSet('peek:' + c.id, d);   // 取消了也把翻好的那些记下
  if (ok) toast(`换成${langName(l)}了`);
  return !!ok;
}

// TA 说外语时 AI 是先写中文、再附 [原文：…]（中文写在前面就不会漏）：换回手机里一直用的「原文[翻译：中文]」。
// 哪几格该有翻译照 FORMS 里的 ※，不猜：标了的格子里只写了一种的，用 zhOf（core/translate.js）免费机翻核对——
// 本来就是中文的留着，只写了外文的补上中文。什么语言都是这一条，不再找 AI
const ORIG = /\s*[[［【]原文[:：]\s*((?:[^[\]［］【】]|[[［【][^\]］】]*[\]］】])*)[\]］】]/;
const seg = p => { const m = ORIG.exec(p), fig = /^\s*[[［【][图図][:：]\s*([\s\S]*)[\]］】]\s*$/.exec(p);
  if (fig && ORIG.test(fig[1])) { const [a, cn] = seg(fig[1]).split('[翻译：'); return `[図：${a}][翻译：[图：${cn.slice(0, -1)}]]`; }   // 配图写成「[图：中文[原文：外文]]」
  if (!m) return p;
  const a = m[1].trim(), q = (/^\s*([>＞》]\s*)/.exec(p) || ['', ''])[1];   // 引用那段，原文那版也要带「>」
  return `${q && !/^[>＞》]/.test(a) ? q : ''}${a}[翻译：${(p.slice(0, m.index) + p.slice(m.index + m[0].length)).trim()}]`; };
async function toOrig(got, say) {
  const lone = [];
  for (const [n, rows] of Object.entries(got)) for (const r of rows) { const tc = trCols(n, r);
    r.forEach((v, i) => { if (typeof v !== 'string' || !v) return; const S = r[i] = v.split(/(?<!:)\/\//).map(seg);
      if (tc.includes(i)) S.forEach((p, k) => { if (/\p{L}/u.test(p) && !/[[［【]翻译[:：]/.test(p)) lone.push([S, k]); }); }); }
  if (lone.length) { say(lone.length); (await zhOf(lone.map(([S, k]) => S[k]))).forEach((z, i) => { if (z) lone[i][0][lone[i][1]] += `[翻译：${z}]`; }); }
  for (const rows of Object.values(got)) for (const r of rows) r.forEach((v, i) => { if (Array.isArray(v)) r[i] = v.join('//'); });
}

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
    let step = `正在写${nameOf(c)}的手机…`;   // AI 写完后还要用机翻补漏掉的外文：提示条换成「补外文 几 / 几」，不然只剩个圈在转
    const got = await waiting(() => step, async stop => {
      const story = storyText(S().floors || 30) || '（暂无）', now = time.isStory() ? time.story() : null;   // 正文只发最近几楼（TA 的设置里选）：发得越多越慢，也越容易被接口的审核拦下
      const raw = await generate({ conn: connOf(), system: '', app: '查手机', stop, resume: S().fill ? S().fillMax || 3 : 0,
        prompt: compose('peek', { char: c.name || nameOf(c), user: myName(), persona: personaOf(c) || '（没有写）', user_persona: myPersona() || '（没有写）',
          world: await worldText(story, [c], 'peek').catch(() => ''), story, people: [myName(), ...friends().filter(x => x.id !== c.id).map(x => x.name || nameOf(x))].map(n => '- ' + n).join('\n'),
          time: now ? `${now.date.toLocaleDateString('zh-CN')} ${now.hh}:${String(now.mm).padStart(2, '0')}` : new Date().toLocaleString('zh-CN'),
          count: S().count || 6, apps: names.map(n => `【${n}】\n${form(n, c, speakIn(c))}`).join('\n'), lang: /^zh/.test(speakIn(c)) ? '' : `\n- ${c.name || nameOf(c)} 平时用${langName(speakIn(c))}。上面格式里标了〔写成：…〕的格子不用上一条的写法：先写中文意思（照 TA 的人设和语气），后面紧跟 [原文：${langName(speakIn(c))}原文]，两样都要有，一格都不能漏；分了 // 段的每段各写一次。没标的格子照常写。` }) });
      const got = parse(raw);
      if (!/^zh/.test(speakIn(c))) await toOrig(got, n => { step = `AI 写好了，有 ${n} 处没写全，机翻核对…`; });
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
    const l = /^zh/.test(speakIn(c)) ? guess(d.apps) : speakIn(c); if (d.lang !== l) { d.lang = l; delete d.mt; }   // 原文是什么语言；变了旧的机翻作废
    await kvSet('peek:' + c.id, d);
    const miss = names.filter(n => !ok.includes(n));
    if (miss.length) log('warn', '查手机', `这几个应用 AI 没写：${miss.join('、')}`);
    toast(miss.length ? `写好 ${ok.length} 个，${miss.join('、')}没写出来` : `写好了，${ok.length} 个应用`);
    done({ ...await load(c), who: c.id });
  } catch (e) { log('error', '查手机', '生成失败：' + e.message, e); toast('没写成：' + e.message); }
  finally { job = null; }
}

/** 勾选要生成哪些应用（默认全勾） */
export function pickApps(c, start) {
  const on = new Set((S().last || Object.keys(FORMS)).filter(n => FORMS[n]));
  const rows = Object.keys(FORMS).map(n => { const b = h('button.pk-tick.is-on', { onclick: () => { on.has(n) ? on.delete(n) : on.add(n); mark(); } }, h('i'), h('span', n)); b._n = n; return b; });
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
