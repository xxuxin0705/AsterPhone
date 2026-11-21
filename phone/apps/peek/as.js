// 用 TA 的身份打开你手机里的论坛、音乐：把数据临时换成「TA 是我、你是别人」的一份给那两个应用看，退出就换回来。
// 换的那份只在内存里：存盘存的一直是真的（store.shadow），借出去的帖子也不存（论坛 engine 的 lend），所以在里面点赞、关注都不会留下，也不找 AI。
import { state, shadow, commit, nickOf } from '../../core/store.js';
import * as nav from '../../core/nav.js';
import { myAvatar } from '../../core/promptstore.js';
import { charLists } from '../../core/music.js';
import { nameOf } from '../chat/engine.js';

// 打开借了数据的应用；它的首页退掉时把真的换回来
function show(el, back) { const old = el._onLeave; el._onLeave = () => { old && old(); back(); }; nav.push(el); }

/** 论坛：TA 的号是「我」，你的每个号变成一个普通网友（名字、头像、装扮照旧），你们互相关注；你发给 TA 的私信在 TA 的消息里 */
export async function forumAs(c) {
  if (shadow.forum) return;
  const E = await import('../forum/engine.js'), { open } = await import('../forum/forum.js');
  const real = state.forum, D = await E.load(), w = E.who({ k: 'c', id: c.id });
  const mine = Object.fromEntries(real.accounts.map(a => [a.id, E.accName(a)])), you = id => ({ k: 'n', name: mine[id] || mine.main });
  const swap = by => by && by.k === 'c' && by.id === c.id ? { ...by, k: 'me', id: 'ta' } : by && by.k === 'me' ? { ...by, id: undefined, ...you(by.id) } : by;
  const fix = o => ({ ...o, by: swap(o.by), ...(o.likers ? { likers: o.likers.map(swap) } : {}) });
  const dms = {};
  for (const [k, d] of Object.entries(D.dms || {})) { const [acc, who] = k.split('>'); if (who === 'c:' + c.id && d.list.length) dms['ta>n:' + mine[acc]] = { by: you(acc), list: d.list.map(m => ({ ...m, me: !m.me })), sub: d.list.length }; }
  const over = { ...real.over }, decos = { ...real.decos, 'me:ta': real.decos['c:' + c.id] };
  real.accounts.forEach(a => { const k = 'n:' + mine[a.id]; over[k] = { avatar: a.avatar || (a.id === 'main' ? myAvatar() : ''), v: a.v, vip: a.vip, ip: a.ip }; decos[k] = real.decos['me:' + a.id]; });
  shadow.forum = real;
  state.forum = { ...real, accounts: [{ ...real.people[c.id], ...(real.over || {})['c:' + c.id], id: 'ta', as: 'c:' + c.id, name: w.name, avatar: w.avatar || '', v: w.v, vip: w.vip, ip: w.ip }], cur: 'ta', over, decos, seen: {},
    follows: [...real.accounts.map(a => 'n:' + mine[a.id]), ...E.onForum().filter(x => x.id !== c.id).map(x => 'c:' + x.id)] };
  E.lend({ posts: D.posts.map(p => ({ ...fix(p), floors: (p.floors || []).map(fix) })), dms });
  show(open(), () => { state.forum = shadow.forum; delete shadow.forum; E.lend(null); commit('forum'); });
}

/** 音乐：「我的」是 TA 的资料和歌单，喜欢的歌是 TA 的「喜欢的音乐」；正在放的歌、播放器、皮肤还是你手机那一份（没有电台，角色歌单里不列 TA 自己：asId） */
export async function musicAs(c) {
  if (shadow.music) return;
  const { open } = await import('../music/music.js');
  const real = state.music, L = charLists(c), fav = L.find(l => l.name === '喜欢的音乐');
  const own = { profile: { nick: nickOf(c, 'music') || c.name || nameOf(c), avatar: c.avatar || '', sign: '', bg: '' }, liked: fav ? [...fav.songs] : [], lists: L.filter(l => l !== fav).map(l => ({ ...l, songs: [...l.songs] })),
    asId: c.id, likedInfo: null, recent: [], history: [], local: [], plays: {}, follows: [], heard: 0, storySongs: false };
  shadow.music = real;
  state.music = new Proxy(real, { get: (t, k) => k in own ? own[k] : t[k], set: (t, k, v) => { (k in own ? own : t)[k] = v; return true; }, has: (t, k) => k in own || k in t });
  show(open(), () => { state.music = shadow.music; delete shadow.music; commit('music'); });
}
