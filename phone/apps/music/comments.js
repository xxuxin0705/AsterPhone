// 乐评页（照网易云评论区）：最热 / 最新，点赞，展开回复，回复。
// 能拿到网易云真热评就先放真的；让 AI 写过的话，联系人和剧情里的人的乐评排最前。
// 你写的评论、回复先攒着，点「让大家看到」用一次 API：被你回的人一定回你，别人想回就回，也可能多几条路人评论。
// 每首歌一份，存在 kv 的 aicmt:歌 id（网易云的真热评不存，你点过赞、回过的那条才存进来）。
import { h, uid } from '../../core/util.js';
import { state, contact, kvGet, kvSet } from '../../core/store.js';
import { page, icon, avatar, toast, dialog, empty, navText, segmented } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose } from '../../core/promptstore.js';
import { storyText } from '../../core/context.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { burst } from './island.js';

const netName = c => c.nick || c.name || nameOf(c);   // 评论区里用联系人的网名
const people = () => state.contacts.map(c => `- ${c.name || nameOf(c)}（网名：${netName(c)}）：${(personaOf(c) || '').slice(0, 160).replace(/\n/g, ' ')}`).join('\n') || '（没有）';
const findWho = (who, name) => (state.contacts.find(c => who && (c.name === who || nameOf(c) === who)) || state.contacts.find(c => name && netName(c) === name) || {}).id || '';
const json = raw => { try { return JSON.parse((String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').match(/\{[\s\S]*\}/) || [])[0]); } catch { return null; } };
const rep = (r, at) => ({ id: uid('r'), who: findWho(r.who, r.name), name: r.name || '网友', to: r.to || '', text: r.text, likes: +r.likes || 0, at });

// 正在跑的请求（写乐评 / 让大家看到）：每首歌每种同时只有一个。退出再进来按钮还是「取消」，写好了填到现在开着的这页
const busy = {}, live = {};

async function load(s) {
  const d = await kvGet('aicmt:' + s.id).catch(() => null);
  if (d && d.list) return d;
  if (d) return { ai: true, list: [   // v0.8.17 存的老样子：角色感受 + 网友乐评
    ...(d.chars || []).map(x => ({ id: uid('c'), who: x.id, name: x.name, text: x.text, likes: 3000 + Math.floor(Math.random() * 9000), kind: '联系人', replies: [] })),
    ...(d.hot || []).map(x => ({ id: uid('c'), name: x.name, text: x.text, likes: x.likes, replies: [] }))] };
  return { list: [] };
}

/** s：这首歌；me：{ nick, avatar } */
export async function openComments(s, me) {
  const d = (live[s.id] && (busy['w' + s.id] || busy['a' + s.id]) && live[s.id].d) || await load(s);
  let real = [], why = s.local ? '本地的歌没有热评。' : '';
  if (!s.local) {
    toast('正在拿热评…', true);
    try { real = (await P.hotComments(s.id)).map(x => ({ ...x, id: 'n' + uid(''), real: true, replies: [] })); toast(`${real.length} 条热评`); }
    catch (e) { log('warn', '音乐', '拿热评失败：' + e.message); why = e.message + '。'; toast('拿不到网易云的热评'); }
    if (busy['w' + s.id]) toast('AI 正在写乐评…', true);
  }
  const save = () => kvSet('aicmt:' + s.id, d).catch(e => toast('没存上：' + e.message));
  const all = () => [...d.list, ...real.filter(x => !d.list.some(y => y.real && y.name === x.name && y.text === x.text))];
  // 真热评被点赞、被回复时才存进来
  const keep = x => { if (x.real && !d.list.includes(x)) d.list.push(x); };
  let sort = 'hot', replyTo = null;

  const p = page({ app: 'music', id: 'music-comments', title: '评论', back: true, cls: 'as-cm', right: navText(busy['w' + s.id] ? '取消' : 'AI 乐评', () => busy['w' + s.id] ? busy['w' + s.id].abort() : write()) });
  live[s.id] = { d, paint: () => paint(), tell: () => paintTell(), btn: p.nav.querySelector('.as-navbar__right button') };
  const count = h('b'), list = h('div.as-cm__list');
  const input = h('input.as-cm__input', { placeholder: '听了这么多，可能你有话想说', onkeydown: e => { if (e.key === 'Enter') send(); } });
  const toWho = h('div.as-cm__to', { hidden: true });
  const tell = h('button.as-cm__tell', { hidden: true, onclick: () => busy['a' + s.id] ? busy['a' + s.id].abort() : answer() });
  p.body.append(
    h('div.as-cm__song', h('span.as-mu-lcover', { style: { backgroundImage: s.pic ? `url("${s.pic}")` : '' } }), h('div', h('b', s.name), h('span', s.artist))),
    h('div.as-cm__head', count, segmented([['hot', '最热'], ['new', '最新']], sort, v => { sort = v; paint(); })),
    list);
  p.el.append(h('div.as-cm__bar', toWho, tell, h('div.as-cm__row', input, h('button', { onclick: send }, '发送'))));

  const meName = () => me.nick, whoName = x => { const c = x.who && contact(x.who); return x.mine ? meName() : c ? netName(c) : x.name; };
  const face = (x, size) => { const c = x.who && contact(x.who); return avatar(x.mine ? me.avatar : c ? c.avatar : x.avatar || '', whoName(x), size); };
  const when = x => x.at ? new Date(x.at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-') : x.time || '';
  const like = (x, el) => h('button.as-cm__like' + (x.liked ? '.is-on' : ''), { 'aria-label': '点赞', onclick: e => {
    e.stopPropagation(); keep(x); x.liked = !x.liked; x.likes = (x.likes || 0) + (x.liked ? 1 : -1); save();
    const b = like(x, el); e.currentTarget.replaceWith(b); if (x.liked) burst(b);
  } }, x.likes ? String(x.likes) : '', icon('heart', 15, x.liked ? 0 : 1.8));
  const reply = (x, r) => { replyTo = { x, name: r ? whoName(r) : whoName(x) }; toWho.hidden = false; toWho.replaceChildren(`回复 @${replyTo.name}`, h('button', { 'aria-label': '不回复了', onclick: () => { replyTo = null; toWho.hidden = true; } }, icon('close', 13, 2.4))); input.focus(); };

  // 一条乐评：只在它自己身上改（点赞、展开、加回复），不整页重画
  function row(x) {
    const reps = h('div.as-cm__reps'); let open = x.replies.some(r => r.fresh || r.new);
    const more = h('button.as-cm__more', { onclick: () => { open = !open; paintReps(); } });
    const paintReps = () => {
      more.hidden = !x.replies.length; more.textContent = open ? '收起回复' : `展开 ${x.replies.length} 条回复`;
      reps.replaceChildren(...(open ? x.replies.map(r => h('div.as-cm__rep' + (r.new ? '.is-new' : ''), { onclick: () => reply(x, r) }, face(r, 26),
        h('div', h('div.as-cm__name', whoName(r), h('small', when(r) || '')), h('div.as-cm__text', r.to ? h('span', `回复 @${r.to}：`) : null, r.text)), like(r))) : []));
    };
    const el = h('div.as-cm__item', face(x, 40), h('div',
      h('div.as-cm__top', h('div', h('div.as-cm__name', whoName(x)), h('small', [when(x), x.place].filter(Boolean).join(' '))), like(x)),
      h('div.as-cm__text', { onclick: () => reply(x) }, x.text), reps, more));
    el._x = x; el._paint = () => { open = true; paintReps(); };
    paintReps();
    return el;
  }
  const rank = x => (x.who || x.kind === '剧情' || x.kind === '联系人' ? 1 : 0);
  function paint() {
    const L = all().slice().sort(sort === 'hot' ? (a, b) => rank(b) - rank(a) || b.likes - a.likes : (a, b) => (b.at || 0) - (a.at || 0) || String(b.time || '').localeCompare(String(a.time || '')));
    count.textContent = `评论(${L.length})`;
    list.replaceChildren(...(L.length ? L.map(row) : [empty(s.local ? '本地的歌没有热评' : '还没有评论', h('button.as-mu-morel', { onclick: () => write() }, '让 AI 写乐评（用一次 API）'))]));
    paintTell();
  }
  const fresh = () => d.list.filter(x => x.fresh || x.replies.some(r => r.fresh));
  const paintTell = () => { const n = fresh().length; tell.hidden = !n && !busy['a' + s.id]; tell.textContent = busy['a' + s.id] ? '取消' : `让大家看到（${n}）`; };
  // 开始 / 结束一个请求：按钮换成「取消」/ 换回来；写好的东西填到现在开着的那页（可能是退出后重新进来的）
  const run = async (k, msg, fn) => {
    const ac = busy[k + s.id] = new AbortController(), view = () => live[s.id];
    if (k === 'w') view().btn.textContent = '取消'; else paintTell();
    toast(msg, true);
    try { await fn(ac.signal); }
    catch (e) { log('error', '音乐', `${k === 'w' ? 'AI 写乐评' : '让大家回复'}失败：` + e.message, e); toast(ac.signal.aborted ? '取消了' : (k === 'w' ? '没写成：' : '没回成：') + e.message); }
    finally { delete busy[k + s.id]; if (k === 'w') view().btn.textContent = 'AI 乐评'; else view().tell(); }
  };

  function send() {
    const t = input.value.trim(); if (!t) return;
    input.value = '';
    if (replyTo) {
      const { x, name } = replyTo; keep(x);
      x.replies.push({ id: uid('r'), mine: true, to: name, text: t, likes: 0, at: Date.now(), fresh: true });
      replyTo = null; toWho.hidden = true; save();
      [...list.children].find(e => e._x === x)?._paint();
    } else { d.list.unshift({ id: uid('c'), mine: true, text: t, likes: 0, at: Date.now(), fresh: true, replies: [] }); save(); paint(); }
    paintTell();
  }

  // 让 AI 写：联系人每人至少一条、剧情里没加的人各一条、再加一些路人；写过的再点就是重新写（你自己写的评论留着）
  async function write() {
    if (busy['w' + s.id]) return;   // 已经在写了（点取消才能重来）
    const again = d.ai;
    if (!(await dialog({ title: again ? '重新写一批？' : '让 AI 写乐评？', text: again ? '会再用一次 API，写好后换掉 AI 写的这些（你写的评论留着）。' : (why ? why + '\n' : '') + '会用一次 API：联系人每人一条，剧情里的人各一条，再加一些路人。', confirm: again ? '重新写' : '生成' }))) return;
    await run('w', 'AI 正在写乐评…', async stop => {
      const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '乐评', maxTokens: 6000, stop,
        prompt: compose('songTalk', { song: s.name, artist: s.artist, lyrics: P.lyricsNow().slice(0, 12).map(x => x.text).join('\n') || '（没有歌词）', contacts: people(), story: storyText(8) || '（暂无）' }) });
      const j = json(raw);
      if (!j || !Array.isArray(j.comments)) throw new Error('AI 回的不是乐评：' + String(raw).slice(0, 60));
      d.list = [...d.list.filter(x => x.mine || x.real), ...j.comments.filter(x => x && x.text).map(x => ({ id: uid('c'), who: findWho(x.who, x.name), kind: x.kind || '', name: x.name || '网友', text: x.text,
        likes: +x.likes || 0, time: x.time || '', place: x.place || '', replies: (x.replies || []).filter(r => r && r.text).map(r => rep(r)) }))];
      d.ai = true; await save(); live[s.id].paint(); toast(`写好了，${j.comments.length} 条`);
    });
  }
  // 让大家看到：被你回的人一定回你；别人想回就回，也可能顺便多几条路人评论
  async function answer() {
    const F = fresh(), floors = d.list;
    const must = [...new Set(F.flatMap(x => x.replies.filter(r => r.fresh && r.to && r.to !== meName()).map(r => r.to)))];
    const threads = F.map(x => [`#${floors.indexOf(x) + 1} ${whoName(x)}：${x.text}${x.fresh ? '（新）' : ''}`,
      ...x.replies.map(r => `  ${whoName(r)}${r.to ? ' 回复 ' + r.to : ''}：${r.text}${r.fresh ? '（新）' : ''}`)].join('\n')).join('\n\n');
    await run('a', '大家正在看…', async stop => {
      const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '乐评', maxTokens: 3000, stop,
        prompt: compose('songReply', { song: s.name, artist: s.artist, contacts: people(), threads, must: must.length ? must.join('、') : '被回复到的人' }) });
      const j = json(raw);
      if (!j || !Array.isArray(j.replies)) throw new Error('AI 回的不对：' + String(raw).slice(0, 60));
      let n = 0;
      j.replies.forEach(r => { const x = floors[(+r.floor || 0) - 1]; if (x && r.text) { x.replies.push({ ...rep(r, Date.now()), new: true }); n++; } });
      (j.comments || []).filter(x => x && x.text).forEach(x => { d.list.push({ ...rep(x), place: x.place || '', time: x.time || '', replies: [] }); n++; });
      F.forEach(x => { delete x.fresh; x.replies.forEach(r => { delete r.fresh; }); });
      await save(); live[s.id].paint(); toast(n ? `有 ${n} 条新回复` : '大家都没理你');
      d.list.forEach(x => x.replies.forEach(r => { delete r.new; }));   // 这次展开着、标着新，下次打开就是普通的
      save();
    });
  }

  paint();
  nav.push(p.el);
  if (!real.length && !d.list.length) write();
}
