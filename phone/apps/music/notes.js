// 音乐笔记：播放页长按歌词收进来，写感悟；让角色（和路人）来写乐评。
import { h, uid } from '../../core/util.js';
import { state, commit } from '../../core/store.js';
import { page, group, item, icon, textarea, avatar, btn, empty, sheet, dialog, toast, navBtn } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName, myAvatar } from '../../core/promptstore.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { log } from '../../core/log.js';
import * as time from '../../core/time.js';

const N = () => state.musicNotes;
const cover = (s, size) => h('span.as-mu-cover', { style: { width: size + 'px', height: size + 'px', backgroundImage: s.pic ? `url("${s.pic}")` : '' } });
const who = r => r.who ? state.contacts.find(c => c.id === r.who) : null;

export function addNote(song, lines) {
  const n = { id: uid('n'), song: { id: song.id, name: song.name, artist: song.artist, pic: song.pic, local: !!song.local }, lines, text: '', reviews: [], at: Date.now() };
  N().unshift(n); commit('musicNotes');
  return n;
}

/* ---------- 笔记一栏 ---------- */
export function renderNotes(ctx) {
  const box = h('div');
  const draw = () => box.replaceChildren(N().length ? group('', N().map(n => item({ icon: cover(n.song, 42), color: 'transparent', cls: 'as-mu-row', title: n.lines[0] || '（没有歌词）',
    sub: `${n.song.name} · ${n.song.artist}${n.reviews.length ? ` · ${n.reviews.length} 条乐评` : ''}`, chevron: true, onClick: () => openNote(n) }))) : empty('还没有笔记', h('div.as-muted', '播放页长按歌词，收进笔记')));
  draw(); ctx.body.append(box);
  ctx.el._onShow = draw;
}

/* ---------- 一条笔记 ---------- */
export function openNote(n) {
  const p = page({ app: 'music', id: 'music-note', title: '笔记', back: true, right: [navBtn('trash', '删除', async () => {
    if (!(await dialog({ title: '删除这条笔记？', confirm: '删除', danger: true }))) return;
    N().splice(N().indexOf(n), 1); commit('musicNotes'); nav.pop();
  })] });
  const list = h('div.as-mu-reviews'), head = h('span', '乐评');
  const paintReviews = () => { head.textContent = n.reviews.length ? `乐评（${n.reviews.length}）` : '乐评'; list.replaceChildren(...n.reviews.map(r => {
    const c = who(r), me = r.who === 'me';
    return h('div.as-mu-review', avatar(me ? myAvatar() : c ? c.avatar : '', me ? myName() : c ? nameOf(c) : r.name, 34),
      h('div', h('div.as-mu-review__name', me ? myName() : c ? nameOf(c) : r.name, c || me ? null : h('em', '路人'), h('span', time.shortLabel({ at: r.at }))), h('div.as-mu-review__text', r.text)));
  })); };
  paintReviews();
  p.body.append(
    item({ icon: cover(n.song, 44), color: 'transparent', cls: 'as-mu-row', title: n.song.name, sub: n.song.artist, right: h('span.as-mu-playone', icon('play', 18, 2)), onClick: () => P.playList([n.song], 0) }),
    h('blockquote.as-mu-quote', n.lines.map(l => h('p', l))),
    group('我的感悟', [h('div.as-field', textarea({ value: n.text, placeholder: '听到这里想到了什么', rows: 4, onInput: v => { n.text = v; commit('musicNotes'); } }))]),
    group(head, [list, h('div.as-mu-review__btns', btn('生成乐评', 'primary', () => reviewSheet(n, paintReviews)))]));
  nav.push(p.el);
}

/* ---------- 生成乐评：几条、必定出现的人、只让选中的人写；条数比人多的部分是路人 ---------- */
function reviewSheet(n, after) {
  const o = { count: 3, must: new Set(), only: false };
  const people = state.contacts;
  const chips = [1, 2, 3, 4, 5, 6, 8, 10].map(k => h('button.as-mu-chip' + (k === o.count ? '.is-on' : ''), { onclick: e => { o.count = k; [...e.currentTarget.parentNode.children].forEach(b => b.classList.toggle('is-on', b === e.currentTarget)); paintSum(); } }, String(k)));
  const faces = people.map(c => h('button.as-mu-face', { onclick: e => { o.must.has(c.id) ? o.must.delete(c.id) : o.must.add(c.id); e.currentTarget.classList.toggle('is-on', o.must.has(c.id)); paintSum(); } }, avatar(c.avatar, nameOf(c), 44), h('span', nameOf(c))));
  const onlyCk = h('span.as-chat-check', icon('check', 14, 2.6)), sum = h('div.as-mu-sum');
  const paintSum = () => {
    const pool = o.only ? o.must.size : people.length, strangers = Math.max(0, o.count - pool);
    sum.textContent = `${o.count} 条，${o.must.size ? `${[...o.must].map(id => nameOf(state.contacts.find(c => c.id === id))).join('、')}一定写` : '随机挑人写'}${strangers ? `，其中 ${strangers} 条是路人` : ''}`;
  };
  paintSum();
  const s = sheet({ title: '生成乐评', content: h('div.as-mu-rsheet',
    h('div.as-mu-rsheet__h', '生成条数'), h('div.as-mu-chips', chips),
    h('div.as-mu-rsheet__h', '必定出现的人', h('span', '不选 = 随机')), faces.length ? h('div.as-mu-faces', faces) : h('div.as-muted', '还没有联系人，都会是路人'),
    h('label.as-mu-only', { onclick: () => { o.only = !o.only; onlyCk.classList.toggle('is-active', o.only); paintSum(); } }, onlyCk, '只让选中的人写'), sum,
    h('div.as-mu-review__btns', btn('取消', 'secondary', () => s.close()), btn('生成', 'primary', () => { s.close(); run(); }))) });

  async function run() {
    const must = people.filter(c => o.must.has(c.id)), others = o.only ? [] : people.filter(c => !o.must.has(c.id));
    const strangers = Math.max(0, o.count - must.length - others.length);
    const line = c => `- ${c.name || nameOf(c)}${personaOf(c) ? '：' + personaOf(c).slice(0, 100).replace(/\n/g, ' ') : ''}`;
    toast('大家正在听…', true);
    try {
      const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', app: '乐评', maxTokens: 900, prompt: compose('review', {
        song: P.label(n.song), lyrics: n.lines.join('\n'), note: n.text.trim() || '（还没写）',
        reviews: n.reviews.map(r => `${r.who === 'me' ? myName() : who(r) ? nameOf(who(r)) : r.name + '（路人）'}：${r.text}`).join('\n') || '（无）',
        people: [...must, ...others].map(line).join('\n') || '（没有联系人）', count: o.count,
        must: must.length ? `这几个人一定要写：${must.map(nameOf).join('、')}。` : '', strangers: strangers ? `另外 ${strangers} 条由路人写。` : '',
      }) });
      const find = name => { name = name.trim(); return people.find(c => [c.name, c.nick, c.remark].includes(name)); };
      let added = 0;
      for (const l of String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').split('\n')) {
        const parts = l.split(/[|｜]/).map(s => s.trim()).filter(Boolean); if (parts.length < 2) continue;
        if (parts[0] === '路人' && parts.length >= 3) n.reviews.push({ id: uid('r'), who: '', name: parts[1], text: parts.slice(2).join('|'), at: Date.now() });
        else { const c = find(parts[0]); n.reviews.push({ id: uid('r'), who: c ? c.id : '', name: c ? '' : parts[0], text: parts.slice(1).join('|'), at: Date.now() }); }
        added++;
      }
      if (!added) throw new Error('AI 没有按格式返回');
      commit('musicNotes'); after(); toast(`来了 ${added} 条乐评`);
    } catch (e) { log('error', '乐评', e.message); toast('生成失败：' + e.message); }
  }
}
