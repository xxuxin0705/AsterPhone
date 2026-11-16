// 论坛的数据和找 AI。号、bot、地区这些小的放 state.forum（跟着窗口走）；帖子大，放 kv 的 forum:窗口。
// 两种调用：刷一批帖（forumFeed）、出楼层（forumThread），点一下只调一次
import { uid } from '../../core/util.js';
import { state, win, kvGet, kvSet, commit, contact } from '../../core/store.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName, myNick, myAvatar } from '../../core/promptstore.js';
import { storyText, C } from '../../core/context.js';
import { LANGS, langName } from '../../core/translate.js';
import { word } from './looks.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';
import { nameOf, personaOf, worldBlock, takeTr } from '../chat/engine.js';
import { loadSets } from './dress.js';

export const F = () => state.forum;
export const A = () => state.apps.forum;
export const BOARDS = ['follow', 'local', 'global', 'anon'];

/* ---------- 帖子存在 kv ---------- */
let D = null, Dkey = null;
export async function load() {
  await loadSets();   // 列表画出来就要用到装扮（头像框、卡片背景）
  if (D && Dkey === win.key) return D;
  const k = win.key; let d = null;
  try { d = await kvGet('forum:' + k); } catch (e) { log('warn', '论坛', '读不到帖子：' + e.message); }
  Dkey = k; D = d || { posts: [], dms: {} };
  return D;
}
export async function save() { await kvSet('forum:' + Dkey, D); commit('forum'); }
export const postOf = id => D && D.posts.find(p => p.id === id);
export async function removePost(id) { D.posts = D.posts.filter(p => p.id !== id); await save(); }
// 最多留 300 条：超了删最旧的，收藏的不删
function prune() {
  const keep = new Set(F().favs || []);
  while (D.posts.length > 300) { const i = D.posts.findLastIndex(p => !keep.has(p.id)); if (i < 0) break; D.posts.splice(i, 1); }
}

const platform = () => `这是一个像「${word('forum.platform')}」的平台，照那里的人说话的方式写。` + ({ yes: '每条帖子都要有标题。', no: '不用写标题。' }[word('forum.title.need')] || '');

/* ---------- 小组：本地、全球、匿名区三个版块各有个按世界观起的名字；另外还有 AI 起的小组（微博叫超话、推特叫社群） ---------- */
const BASE = { local: '本地', global: '全球', anon: '匿名' };
export function groupOf(id) {
  const g = F().groups.find(x => x.id === id);
  return BASE[id] ? { id, name: word('forum.tab.' + id), intro: '', ...g, base: true } : g || null;
}
export const boards = () => [...['local', 'global', 'anon'].map(groupOf), ...F().groups.filter(g => !BASE[g.id])];
export const groupName = id => (groupOf(id) || {}).name || '';

/* ---------- 谁是谁 ---------- */
const P = id => F().people[id] || {};
export const onForum = () => state.contacts.filter(c => !P(c.id).off);
export const netName = c => P(c.id).name || c.nick || c.name || nameOf(c);
export const isV = c => P(c.id).v === true ? 'y' : P(c.id).v || '';
export const botOf = id => F().bots.find(b => b.id === id);
/* 我的号：main 是大号；name 空着就用手机里我的网名 */
export const accOf = id => F().accounts.find(a => a.id === id);
export const curAcc = () => accOf(F().cur) || F().accounts[0];
export const accName = a => (a && a.name) || (a && a.id === 'main' ? myNick() : '小号');
/** 我现在发东西用的 by；匿名区里发的是匿名 */
export const meBy = anon => ({ k: 'me', id: curAcc().id, ...(anon ? { anon: true, no: 0 } : {}) });
/** 帖子、楼层上的 by → 显示用的 { name, avatar, v } */
// 会员：自己选过的照选的；没选过的有认证的号多半是 VIP / SVIP（同一个号每次一样），没认证的没有
const club = (x, id, v) => x?.vip ?? (v ? ['vip', 'svip', 'vip'][[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % 3] : '');
export const keyOf = by => by.k === 'me' ? 'me:' + by.id : by.k === 'n' ? 'n:' + by.name : (by.k === 'bot' ? 'b:' : 'c:') + by.id;
/** 我在主页上给别人改过的资料（名字、头像、V、会员、简介、认证、小字、数字、IP 属地、头像框）；没改过是空的 */
export const over = by => (F().over ||= {})[keyOf(by)] || {};
export function who(by) {
  const w = who0(by), o = !by.anon && by.k !== 'me' ? over(by) : {};
  return { ...w, name: o.name || w.name, avatar: o.avatar || w.avatar, v: o.v ?? w.v, vip: o.vip ?? w.vip, ip: o.ip ?? w.ip };
}
function who0(by) {
  if (by.anon) return { name: by.no ? `匿名 ${by.no} 号` : '匿名', anon: true };
  if (by.k === 'bot') { const b = botOf(by.id); const v = b && (b.v ?? (b.fans >= 2e5 ? 'r' : 'y')); return b ? { name: b.name, avatar: b.avatar, v, vip: club(b, b.id, v), sub: b.topic } : { name: by.name || '已删除的号' }; }
  if (by.k === 'me') { const a = accOf(by.id); return a ? { name: accName(a), avatar: a.avatar || (a.id === 'main' ? myAvatar() : ''), me: true, v: a.v || '', vip: a.vip || '', ip: a.ip || '' } : { name: '已注销', me: true }; }
  if (by.k === 'c') { const c = contact(by.id); return c ? { name: netName(c), avatar: c.avatar, v: isV(c), vip: club(P(c.id), c.id, isV(c)) } : { name: by.name || '用户' }; }
  return { name: by.name || '网友' };
}
const strip = n => String(n || '').replace(/[（(][^）)]*[）)]/g, '').trim();
export function byName(raw, board) {
  const n = strip(raw);
  if (board === 'anon' || /^匿名/.test(n)) return { k: 'n', anon: true, no: +((/(\d+)/.exec(n) || [])[1]) || 0 };
  const b = F().bots.find(x => x.name === n); if (b) return { k: 'bot', id: b.id };
  const c = state.contacts.find(x => [x.name, x.nick, x.remark, netName(x), nameOf(x)].filter(Boolean).includes(n)); if (c) return { k: 'c', id: c.id };
  return { k: 'n', name: n.slice(0, 20) || '网友' };
}

/* ---------- 语言 ---------- */
const isZh = l => !l || l === 'zh-CN' || l === 'zh-TW';
const localLang = () => (F().lang ? langName(F().lang) : '当地的语言');
// tr：翻译附在哪（帖子另起一行，楼层同一行末尾）；what：一条里怎么用语言
function langRule(board, tr, what) {
  if (board === 'anon') return '';
  if (board !== 'global') return F().lang && isZh(F().lang) ? '' : `\n- 用${localLang()}写；不是中文的，${tr}。`;
  const l = F().lang;
  const mix = !l ? `大约三成中文、四成英文、三成${localLang()}` : isZh(l) ? '大约六成中文、四成英文' : l === 'en' ? '大约三成中文、七成英文' : `大约三成中文、四成英文、三成${langName(l)}`;
  return `\n- 语言混着来：${mix}，${what}；这个世界里没有的语言（比如古代、架空的世界没有英文）就不用，只用这个世界里有的。不是中文的，${tr}。`;
}

/* ---------- 刷帖 ---------- */
function boardText(id) {
  const g = groupOf(id), nm = g && g.intro ? `「${g.name}」（${g.intro}）` : '';
  if (id === 'local') return `${F().region || '故事发生的地方'}本地版${nm}：当地人用${localLang()}聊当地的事，剧情里的熟人也可能出现`;
  if (id === 'global') return `全球版${nm}：各地的人都在看的大事、热门话题`;
  if (id === 'anon') return `匿名区${nm}：没人知道谁是谁，爆料、吐槽、怪事、不敢实名说的话；作者一律写「匿名」`;
  if (id === 'follow') return '关注：只由下面「可以发的号」里的人发';
  if (id === 'all') return `各个小组里的帖子：每条都发在下面这些小组之一，用「小组：名字」写明\n${boards().filter(x => x.id !== 'anon').map(x => `- ${x.name}${x.intro ? '：' + x.intro : ''}`).join('\n')}`;
  return `「${g.name}」${word('forum.group')}${g.intro ? '：' + g.intro : ''}；发帖的是对这个感兴趣的人`;
}
const BOT_RULES = `
营销号的名字要这样起：
- 是一句话，不是一个词；像无意中听到的一句心里话，或者半句没说完的故事；多用「我」「你」「她」「他」，有个说话的人。
- 不直接说主题，绕着说，看了内容才明白为什么叫这个。
- 两种味道都要有：一种轻轻的、有点酸有点怅然；一种好笑的：嘴硬、委屈、认怂、撒娇。
- 6～14 个字，不带「bot」「君」「酱」「小助手」这种后缀；用这个世界里的东西写，不用现实里的品牌、名人、真实账号名。
- 主题跟着这个世界走（现代都市可以有恋爱、打工、美食；古风、奇幻世界换成那个世界里会有的）。`;
function setup(board) {
  const f = F(), out = [], rules = [];
  if (!f.region) out.push(`地区：地名｜语言（按正文判断故事发生在哪；语言是那个地方的人平时说的话，从这些里挑一个：${LANGS.map(l => l[1]).join('、')}）`);
  if (f.bots.length < 6 && board !== 'anon') { out.push(`号｜名字｜主题｜一句简介（再起 ${6 - f.bots.length} 个营销号，一行一个）`); rules.push(BOT_RULES); }
  if (board === 'global') out.push('热榜｜话题｜热度数字（最多 10 行，这个世界里现在大家在议论的事）');
  const need = ['local', 'global', 'anon'].filter(id => !f.groups.some(g => g.id === id)), more = f.groups.filter(g => !BASE[g.id]).length < 3;
  if (need.length || more) out.push(`小组｜${need.map(id => BASE[id]).concat(more ? ['新'] : []).join('/')}｜名字｜一句简介｜人数（${need.length ? `给${need.map(id => BASE[id] + '版').join('、')}各起一个这个世界里的名字` : ''}${need.length && more ? '；' : ''}${more ? '再按这个世界起 3～5 个大家会去的兴趣小组，写「小组｜新｜…」' : ''}）`);
  return out.length ? `\n\n先写下面这些行，写完单独一行 === 再写帖子：\n${out.join('\n')}${rules.join('')}` : '';
}
function posters(board, only) {
  if (board === 'anon') return '（匿名区：不写名字）';
  const fol = new Set(F().follows || []);
  const bots = F().bots.filter(b => !only || only.includes('b:' + b.id) || (board === 'follow' && fol.has('b:' + b.id)));
  const cs = onForum().filter(c => !only || only.includes('c:' + c.id) || (board === 'follow' && fol.has('c:' + c.id)));
  return [...bots.map(b => `- ${b.name}｜营销号（有认证），主题：${b.topic}`),
    ...cs.map(c => `- ${netName(c)}｜真名：${c.name || nameOf(c)}${isV(c) ? '｜有认证' : ''}${personaOf(c) ? '｜' + personaOf(c).slice(0, 200).replace(/\n/g, ' ') : ''}`)].join('\n') || '（没有）';
}
const num = s => { const m = /([\d.]+)\s*([万wWkK])?/.exec(s || ''); if (!m) return 0; const v = parseFloat(m[1]) * ({ 万: 1e4, w: 1e4, W: 1e4, k: 1e3, K: 1e3 }[m[2]] || 1); return Math.round(v); };
const rnd = n => Math.floor(Math.random() * n);
const clean = raw => String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
const story = () => storyText(Math.min(4, C().count)) || '（暂无）';
const crowd = () => onForum().slice(0, 15);
export const myNames = () => F().accounts.map(accName);
const myAcc = n => { const a = F().accounts.find(x => accName(x) === strip(n)); return a && { k: 'me', id: a.id }; };
/** 告诉 AI 我的网名、可以 @ 我（匿名区不 @） */
const atMe = board => board === 'anon' ? '' : `【${myName()} 在论坛的网名】${myNames().join('、')}（别人只认得网名）\n- ${A().mePost ? `${myName()} 也可以发帖，但只能用上面这几个网名，不另编号` : `${myName()} 本人不发帖，别替 TA 编号发帖`}。\n- 帖子、评论里可以 @ 人，写成「@网名」；剧情里和 ${myName()} 有关的人偶尔会 @ TA 的网名，一次最多一两处。\n`;

/** 刷一批帖。opts.pick：额外要求（话题、只让谁发）；opts.only：只能由这些号发（'b:id' / 'c:id'） */
export async function feed(board, { pick = '', only = null, count = A().count || 6 } = {}, stop) {
  await load();
  const st = story();
  const raw = await generate({ conn: resolveConn('text', 'forum'), system: '', app: '论坛', stop,
    prompt: compose('forumFeed', { board: boardText(board), platform: platform(), count, story: st, time: time.forPrompt(),
      world: (await worldBlock(st, board === 'anon' ? [] : crowd())).world, posters: posters(board, only), pick: pick ? `\n【这次】${pick}` : '', atme: atMe(board),
      lang: langRule(board, '另起一行附 [翻译：简体中文意思]', '一条帖只用一种语言'), setup: setup(board) }) });
  const f = F(), got = [], hot = [], mine = new Set(myNames()); let cur = null, inFloors = false;
  const end = () => { inFloors = false; if (cur && cur.text.trim() && (cur.by.k !== 'me' || A().mePost)) { const [t, tr] = cur.tr ? [cur.text, cur.tr] : takeTr(cur.text.trim()); cur.text = t.trim(); cur.tr = tr === cur.text ? '' : tr; got.push(cur); } cur = null; };
  for (const l of clean(raw).split('\n').map(x => x.trim())) {
    let m;
    if (/^={3,}$/.test(l)) { end(); continue; }
    if (!l) { if (cur) cur.text += '\n'; continue; }
    if ((m = /^地区[:：]\s*(.+?)\s*[|｜]\s*(.+)$/.exec(l))) {
      if (!f.region) { f.region = m[1].slice(0, 20); f.lang = (LANGS.find(x => x[1] === m[2].trim()) || LANGS.find(x => m[2].includes(x[1])) || LANGS[0])[0]; }
      continue;
    }
    if ((m = /^号\s*[|｜](.+)$/.exec(l))) {
      const [name, topic = '', bio = ''] = m[1].split(/[|｜]/).map(x => x.trim());
      if (name && f.bots.length < 12 && !f.bots.some(b => b.name === name)) f.bots.push({ id: uid('fb'), name: name.slice(0, 20), topic: topic.slice(0, 12), bio: bio.slice(0, 40), fans: 2000 + rnd(400000) });
      continue;
    }
    if ((m = /^小组\s*[|｜](.+)$/.exec(l))) {
      const [kind, name, intro = '', n = ''] = m[1].split(/[|｜]/).map(x => x.trim()), id = Object.keys(BASE).find(k => kind.includes(BASE[k]));
      if (name && (id ? !f.groups.some(g => g.id === id) : f.groups.filter(g => !BASE[g.id]).length < 8 && !f.groups.some(g => g.name === name)))
        f.groups.push({ id: id || uid('fg'), name: name.slice(0, 16), intro: intro.slice(0, 40), members: num(n) || 500 + rnd(200000) });
      continue;
    }
    if ((m = /^热榜\s*[|｜]\s*(.+?)(?:\s*[|｜]\s*(.+))?$/.exec(l))) { if (hot.length < 10) hot.push({ topic: m[1].slice(0, 30), heat: num(m[2]) || 1e4 + rnd(9e5) }); continue; }
    if ((m = /^作者[:：]\s*(.+)$/.exec(l))) {
      end();
      cur = { id: uid('fp'), board: board === 'follow' || board === 'all' ? 'global' : board, by: myAcc(m[1]) || byName(m[1], board), title: '', text: '', tr: '', img: '', likes: 0, cmts: 0, reposts: 0, floors: null, ...time.stamp() };
      if (cur.by.anon) cur.by.no = 0;
      continue;
    }
    if (!cur) continue;
    if (/^评论[:：]\s*$/.test(l)) { inFloors = true; cur.floors = []; continue; }
    if ((m = /^标题[:：]\s*(.*)$/.exec(l))) { cur.title = m[1].slice(0, 40); continue; }
    if ((m = /^小组[:：]\s*(.+)$/.exec(l))) { const g = boards().find(x => x.name === strip(m[1])); if (g && board === 'all') cur.board = g.id; continue; }
    if ((m = /^来自[:：]\s*(.+)$/.exec(l))) { cur.dev = m[1].slice(0, 16); continue; }
    if ((m = /^[[【]\s*图片[:：]\s*(.+?)[\]】]$/.exec(l))) { cur.img = m[1]; continue; }
    if ((m = /^[[【]\s*翻译[:：]\s*(.+?)[\]】]$/.exec(l))) { cur.tr = m[1]; continue; }
    if ((m = /^数据[:：](.*)$/.exec(l))) { cur.likes = num((/赞\s*([\d.]+\s*[万wWkK]?)/.exec(m[1]) || [])[1]); cur.cmts = num((/评\s*([\d.]+\s*[万wWkK]?)/.exec(m[1]) || [])[1]); cur.reposts = num((/转\s*([\d.]+\s*[万wWkK]?)/.exec(m[1]) || [])[1]); continue; }
    if (inFloors) { const fl = floorOf(l, cur, cur.floors, mine); if (fl) cur.floors.push(fl); continue; }
    cur.text += (cur.text && !cur.text.endsWith('\n') ? '\n' : '') + (cur.text ? l : l.replace(/^正文[:：]\s*/, ''));   // 格式里写着「正文」，AI 常照抄成「正文：」
  }
  end();
  if (!got.length) { log('error', '论坛', 'AI 没有按格式写帖子', raw); throw new Error('AI 没有按格式写帖子'); }
  got.forEach(p => { if (!p.likes) p.likes = rnd(300); p.cmts = Math.max(p.cmts || rnd(60), (p.floors || []).length); if (p.floors && !p.floors.length) p.floors = null; });
  if (hot.length) f.hot = hot;
  D.posts.unshift(...got.slice(0, count + 2)); prune();
  await save();
  return got.slice(0, count + 2);
}

/* ---------- 楼层 ---------- */
export const floorWho = (p, f) => (f.by.op ? '楼主' : who(f.by).name);
function threadText(p) {
  const op = p.by.anon ? '匿名' : who(p.by).name;
  return [`楼主（${op}）：${p.title ? p.title + '\n' : ''}${p.text}${p.img ? `\n（配图：${p.img}）` : ''}`,
    ...(p.floors || []).map((f, i) => `${i + 1} 楼 ${floorWho(p, f)}${f.to ? ` 回复 ${f.to === 'op' ? '楼主' : (p.floors.findIndex(x => x.id === f.to) + 1) + ' 楼'}` : ''}：${f.text}`)].join('\n');
}
/** 楼主或楼里有我的号时告诉 AI：那是 {{user}}，但别人只看得到网名 */
function mineNote(p) {
  const mine = [p.by, ...(p.floors || []).map(f => f.by)].filter(b => b.k === 'me');
  if (!mine.length) return '';
  const names = [...new Set(mine.map(b => b.anon ? '' : accName(accOf(b.id))).filter(Boolean))];
  return `【注意】${p.by.k === 'me' ? '楼主' : '有几层'}是 ${myName()} 发的${names.length ? `（用的网名：${names.join('、')}）` : '（匿名的）'}；别人只看得到网名，不知道是 TA，不能叫出 TA 的真名。不要替 TA 写${p.by.k === 'me' ? '，不要出现「楼主」的楼层' : ''}。`;
}
const isMine = (p, o) => o.by.k === 'me' || (o.by.op && p.by.k === 'me');
/** 我的帖子、我的楼层：让 AI 顺便写谁点了赞 */
function likesAsk(p) {
  const fl = (p.floors || []).map((f, i) => isMine(p, f) ? i + 1 : 0).filter(Boolean).slice(-5), out = [];
  if (p.by.k === 'me') out.push('赞：名字、名字（这次给楼主帖子点赞的人，0～5 个）');
  if (fl.length) out.push(`赞 楼号：名字、名字（${fl.join('、')} 楼是 ${myName()} 的，有人给这几层点赞就写，一层一行）`);
  return out.length ? `\n另外，${out.join('\n')}\n剧情里的熟人按人设和最近的事决定会不会点，路人也可以。` : '';
}
/** 一行「赞：…」：记下是谁点的，赞数跟着加 */
function addLikers(p, o, names) {
  const L = o.likers = o.likers || [], key = b => b.k + ':' + (b.id || b.name), mine = new Set(myNames());
  for (const n of names.split(/[、,，\s]+/).map(strip).filter(Boolean).slice(0, 8)) {
    const by = byName(n, p.board);
    if (by.anon || mine.has(n) || L.some(x => key(x.by) === key(by))) continue;
    L.push({ by, ...time.stamp() }); o.likes = (o.likes || 0) + 1;
  }
}
/** 一行楼层「名字：话」「名字 回复 3：话」→ 一层；all = 这条帖已经有的楼（算回的是哪一楼）。不替我写，认不出来就 null */
function floorOf(l, p, all, mine) {
  const m = /^(?:\d+\s*楼\s*)?(.+?)(?:\s*回复\s*(楼主|\d+)\s*楼?)?\s*[:：]\s*(.+)$/.exec(l); if (!m || m[1].length > 24) return null;
  const [text, t2] = takeTr(m[3]), tr = t2 === text ? '' : t2, op = strip(m[1]) === '楼主';
  if ((op && p.by.k === 'me') || mine.has(strip(m[1]))) return null;
  const by = op ? { ...p.by, op: true } : byName(m[1], p.board);
  const to = m[2] === '楼主' ? 'op' : m[2] ? (all[+m[2] - 1] || {}).id || 'op' : '';
  return { id: uid('ff'), by, to, text, tr, likes: rnd(40), ...time.stamp() };
}
/** 给这条帖出几层楼（自己发的帖、以前没带评论的帖第一次点开，或者「再来一些」） */
export async function thread(p, stop, { focus = '', count } = {}) {
  await load();
  const st = story(), anon = p.board === 'anon', first = !(p.floors || []).length;
  const raw = await generate({ conn: resolveConn('text', 'forum'), system: '', app: '论坛', stop,
    prompt: compose('forumThread', { thread: threadText(p), platform: platform(), story: st, time: time.forPrompt(), count: count || (first ? '10～15' : '5～8'),
      world: (await worldBlock(st, anon ? [] : crowd())).world, people: anon ? '（匿名区：名字都写「匿名 几号」，同一个人编号不变，楼主写「楼主」）' : posters('local'),
      lang: langRule(p.board, '在同一行末尾附 [翻译：简体中文意思]', '每个人用自己的语言'), focus: [mineNote(p), focus].filter(Boolean).join('\n'),
      atme: atMe(p.board), likes: anon ? '' : likesAsk(p) }) });
  const list = p.floors || [], add = [], mine = new Set(myNames()), likes = [];
  for (const l of clean(raw).split('\n').map(x => x.trim()).filter(Boolean)) {
    const lk = /^赞\s*(\d*)\s*楼?\s*[:：]\s*(.+)$/.exec(l);
    if (lk) { likes.push(lk); continue; }
    const f = floorOf(l, p, list.concat(add), mine); if (f) add.push(f);
  }
  if (!add.length) { log('error', '论坛', 'AI 没有按格式写评论', raw); throw new Error('AI 没有按格式写评论'); }
  p.floors = list.concat(add); p.cmts = Math.max(p.cmts, p.floors.length);
  for (const [, no, names] of likes) { const o = no ? p.floors[no - 1] : p; if (o && isMine(p, o)) addLikers(p, o, names); }
  if (p.by.k === 'me') p.likes += rnd(add.length * 5);   // 我的帖子有人来看，也有人点赞（消息 → 赞）
  await save();
  return add;
}
/** 我发帖：马上存好、返回这条（别人的回复由页面接着找 AI） */
export async function post({ board, title = '', text, tr = '', pic = '', rp = '', dev = '' }) {
  await load();
  const p = { id: uid('fp'), board, by: meBy(board === 'anon'), title: title.slice(0, 40), text, tr, img: '', pic, rp, dev, likes: 0, cmts: 0, reposts: 0, floors: [], ...time.stamp() };
  D.posts.unshift(p); prune(); await save();
  return p;
}
/** 我回一层：to = 回哪一楼（'op' 楼主）；在自己的帖里回就是楼主 */
export async function reply(p, text, to = '') {
  const by = p.by.k === 'me' && p.by.id === curAcc().id ? { ...p.by, op: true } : meBy(p.board === 'anon');
  if (by.anon && !by.op) by.no = p.myNo || (p.myNo = Math.max(0, ...(p.floors || []).map(f => f.by.no || 0)) + 1);
  const f = { id: uid('ff'), by, to, text, tr: '', likes: 0, ...time.stamp() };
  (p.floors = p.floors || []).push(f); p.cmts++;
  await save();
  return f;
}
/** 给营销号投稿：营销号马上发出来（不写是谁投的） */
export async function submit(bot, text) {
  await load();
  const p = { id: uid('fp'), board: 'global', by: { k: 'bot', id: bot.id }, sub: true, title: '', text: '【投稿】' + text, tr: '', img: '', likes: 0, cmts: 0, reposts: 0, floors: [], ...time.stamp() };
  D.posts.unshift(p); prune(); await save();
  return p;
}
export const fmt = n => (n >= 1e4 ? (n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '万' : String(n || 0));
