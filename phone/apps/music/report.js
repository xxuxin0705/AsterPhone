// 缘分报告（和一个人或一个群一起听歌）：陪伴彼此多久、一起听过几首、共同红心几首、第一次一起听、到现在第几天、听得最多的歌、单次最长。
// 时间照「设置 → 时间」用的是现实还是剧情：两套都记着（time.stamp()），换了设置这里跟着换。
// 入口：一起听那块点「一起听了多久」；聊天里 TA 的资料页 / 群设置。
import { h } from '../../core/util.js';
import { state, contact } from '../../core/store.js';
import { page, avatar, empty } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import * as T from '../../core/time.js';
import { myNick, myAvatar } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import { groupAvatar } from '../chat/group.js';

const pad = n => String(n).padStart(2, '0');
const hm = (h_, m) => `${pad(h_)}:${pad(m)}`;
const ymd = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
const dur = sec => { const s = Math.floor(sec), x = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return x ? `${x}小时${m}分钟` : m ? `${m}分钟` : `${s}秒`; };

/** who：联系人或群聊 */
export function openReport(who) {
  const grp = who.type === 'group', r = P.tgRec(who.id), me = state.music.profile || {};
  const p = page({ app: 'music', id: 'music-report', title: `和${grp ? '这个群' : ' TA '}的缘分报告`, back: true, cls: 'as-rp' });
  const mine = avatar(me.avatar || myAvatar(), me.nick || myNick(), 64), theirs = grp ? groupAvatar(who, 64) : avatar(who.avatar, nameOf(who), 64);
  theirs.style.borderRadius = '50%';
  // 共同红心：我喜欢的 ∩ TA 歌单里的（群就是群里所有人的歌单）
  const theirSongs = new Set((grp ? who.members.map(contact).filter(Boolean) : [who]).flatMap(c => P.charSongs(c).map(s => s.id)));
  const both = state.music.liked.filter(s => theirSongs.has(s.id)).length;
  const songs = Object.values(r.songs), top = songs.sort((a, b) => b.n - a.n)[0];
  const stat = (k, v, unit) => h('div', h('span', k), h('b', v, h('small', unit)));
  // 第一次一起听、到现在第几天：现实 / 剧情两套
  const story = T.isStory(), f = r.first;
  let first = '', days = '';
  if (f) {
    if (story) { const d = T.dayToDate(f.st.d); first = `${ymd(d)} ${hm(Math.floor(f.st.m / 60), f.st.m % 60)}`; days = T.story().day - f.st.d + 1; }
    else { const d = new Date(f.at); first = `${ymd(d)} ${hm(d.getHours(), d.getMinutes())}`; days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(f.at).setHours(0, 0, 0, 0)) / 864e5) + 1; }
  }
  const line = (k, v) => h('div.as-rp__line', h('span', k), h('b', v));
  p.body.append(h('div.as-rp__card',
    h('div.as-rp__date', story ? '剧情时间' : '现实时间', h('span', ymd(story ? T.story().date : new Date()))),
    h('div.as-rp__pair', mine, theirs),
    h('div.as-rp__names', me.nick || myNick(), h('i', '&'), grp ? who.name : nameOf(who)),
    h('div.as-rp__stats', stat('陪伴彼此', dur(P.togetherSec(who)), ''), stat('一起听过', String(songs.length), ' 首歌'), stat('共同红心', String(both), ' 首歌')),
    f ? h('div.as-rp__lines',
      line('你们第一次一起听歌是在', first),
      line('到现在是', `第${days}天`),
      top ? line('你们听过次数最多的歌', top.name) : null,
      line('单次一起听最长纪录', dur(r.best || 0)))
      : empty('还没有一起听过')));
  nav.push(p.el);
}
