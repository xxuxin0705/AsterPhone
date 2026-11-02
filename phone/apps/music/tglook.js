// 一起听的样子（播放页一起听时「换样式」→「一起听的样子」）：耳机颜色、「一起听了多久」的颜色和字体、头像上那两句话的气泡颜色 / 字颜色 / 字体。
// 对话式歌词的颜色（「换样式」→「歌词颜色」）：每个人一套（气泡、唱到的字、没唱的字、字体）。给「所有人」调哪项，就把每个人那一项都换成这个（以最新的为准）。
// 空着的项 = 用原来的样子。两页上面都是预览，调什么马上看到。
import { h } from '../../core/util.js';
import { state, commit, contact } from '../../core/store.js';
import { page, group, item, avatar, actionSheet, dialog, sheet, colorWheel, btn, toast } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { FONTS, useFont } from '../../core/floatlyric.js';
import { userFonts } from '../../core/fonts.js';
import { lyricsNow } from '../../core/music.js';
import { myName } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';

const M = () => state.music;
export function look() {
  const L = M().tgLook || (M().tgLook = { ear: '', time: {}, pair: M().bub && M().bub.custom ? { bg: M().bub.bg, ink: M().bub.ink } : {}, chars: {} });   // 以前在悄悄话页选过气泡颜色的搬过来
  if (L.v !== 2) {   // v0.8.22 是每个角色里记「TA 的气泡 / 我的气泡」：改成每个人记自己的气泡，「我」单独一份
    Object.entries(L.chars).forEach(([k, x]) => { if (x.me && !(L.chars.me && L.chars.me.bg)) L.chars.me = { ...L.chars.me, bg: x.me }; if (x.ta) x.bg = x.ta; delete x.ta; if (k !== 'me') delete x.me; });
    L.v = 2;
  }
  return L;
}
const fontLabel = f => !f ? '默认' : (FONTS.find(x => x[0] === f) || [0, (userFonts().find(u => 'u:' + u.id === f) || {}).name || '默认'])[1];
/** 给元素设字体（字体要先装上，装好才换，不会先闪一下别的字） */
export async function setFont(el, f) { el.style.fontFamily = f ? `${await useFont(document, f)}, var(--font-ui)` : ''; }
/** 对话式歌词的一行：照这个人的设置上色（id 是这行的角色，mine 是我唱的那行） */
export function styleChoir(row, id, mine) {
  const C = look().chars, L = { ...C.def, ...C[mine ? 'me' : id] }, p = row.querySelector('p');
  p.style.setProperty('--ch-bg', L.bg || ''); p.style.setProperty('--ch-ink', L.ink || '');
  if (L.ly) row.style.setProperty('--ly', L.ly); else row.style.removeProperty('--ly');
  setFont(p, L.font);
}
/** 头像上两句话、一起听了多久、耳机：全局那几项 */
export function styleTop(tgEl, time, bubs) {
  const G = look();
  tgEl.style.setProperty('--ear', G.ear || ''); tgEl.classList.toggle('has-ear', !!G.ear);
  time.style.color = (G.time && G.time.color) || ''; setFont(time, G.time && G.time.font);
  setFont(bubs, G.pair.font);
}
// 一项颜色：右边一个小圆点（没设是「默认」），点开是色轮 + 恢复默认
const dot = v => v ? h('span.as-tgl__dot', { style: { background: v } }) : h('span', '默认');
function color(title, get, set, save, alpha) {
  const right = h('span', dot(get()));
  return item({ title, right, chevron: true, onClick: () => {
    const sh = sheet({ title, content: h('div.as-mu-color', colorWheel(get() || (alpha ? '#ffffff24' : '#ffffff'), v => { set(v); right.replaceChildren(dot(v)); save(); }, alpha),
      btn('恢复默认', 'secondary', () => { set(''); right.replaceChildren(dot('')); save(); sh.close(); })) });
  } });
}
function font(get, set, save) {
  const right = h('span', fontLabel(get()));
  return item({ title: '字体', right, chevron: true, onClick: async () => {
    const v = await actionSheet('字体', [...FONTS.map(([k, n]) => ({ value: k || 'def', label: n, active: (get() || '') === k })), ...userFonts().map(u => ({ value: 'u:' + u.id, label: u.name, active: get() === 'u:' + u.id }))]);
    if (v == null) return; set(v === 'def' ? '' : v); right.textContent = fontLabel(get()); save();
  } });
}
const field = (o, k) => [() => o[k] || '', v => { if (v) o[k] = v; else delete o[k]; }];
const pvBox = (bgImage, bgFilter, ...kids) => h('div.as-tgl__pv', h('div.as-tgl__bg', { style: { backgroundImage: bgImage, filter: bgFilter } }), ...kids);

/** 一起听的样子。bgImage / bgFilter：播放页的背景（垫在预览下面）；c：现在一起听的人 */
export function openTgLook({ bgImage, bgFilter, c, me }) {
  const G = look(), p = page({ app: 'music', id: 'music-tglook', title: '一起听的样子', back: true });
  const ta = c && c.type !== 'group' ? c : contact((c && c.members || [])[0]);
  const save = () => { commit('music'); paintPv(); };
  // 预览：两句话 + 两个头像带耳机 + 一起听了多久
  const bubs = h('div.as-tg__bubs', h('div.as-tg__bub.is-l', h('span', '好想现在见你')), h('div.as-tg__bub.is-r', h('span', '闭上眼，我就在旁边')));
  const half = (side, who) => h('div.as-tg__half.is-' + side, h('div.as-tg__who', who), h('img', { src: `assets/music/together-${side}.webp`, alt: '' }),
    h('i.as-tg__tint', { style: { webkitMaskImage: `url(assets/music/together-${side}.webp)`, maskImage: `url(assets/music/together-${side}.webp)` } }));
  const time = h('div.as-tg__time', '一起听了 1 小时 8 分钟');
  const tgEl = h('div.as-tg', h('div.as-tg__pair', bubs, half('l', avatar(me.avatar, me.nick, 84)), half('r', avatar(ta ? ta.avatar : '', ta ? nameOf(ta) : 'TA', 84))), time);
  const paintPv = () => { tgEl.style.setProperty('--bub-bg', G.pair.bg || '#fff'); tgEl.style.setProperty('--bub-ink', G.pair.ink || '#222'); styleTop(tgEl, time, bubs); };
  G.time = G.time || {};
  p.body.append(pvBox(bgImage, bgFilter, tgEl),
    group('耳机', [color('耳机颜色', () => G.ear, v => { G.ear = v; }, save)]),
    group('一起听了多久', [color('颜色', ...field(G.time, 'color'), save), font(...field(G.time, 'font'), save)]),
    group('头像上的两句话', [color('气泡颜色', ...field(G.pair, 'bg'), save, true), color('字的颜色', ...field(G.pair, 'ink'), save), font(...field(G.pair, 'font'), save)]),
    h('button.as-mu-morel', { onclick: async () => {
      if (!(await dialog({ title: '恢复默认？', text: '耳机、一起听了多久、头像上的两句话都回到原来的样子。', confirm: '恢复默认', danger: true }))) return;
      Object.assign(G, { ear: '', time: {}, pair: {} }); delete M().bub; commit('music'); nav.pop(); toast('恢复默认了');
    } }, '全部恢复默认'));
  paintPv();
  nav.push(p.el);
}

/** 对话式歌词的颜色：上面是每人一行的预览（人多就上下滑），点哪行或「给谁调」就调谁 */
export function openChoirLook({ bgImage, bgFilter, c, me }) {
  const C = look().chars, p = page({ app: 'music', id: 'music-choirlook', title: '歌词颜色', back: true });
  // 名字写真实姓名（备注、网名会重名，也不好认）
  const people = [...(c.type === 'group' ? c.members.map(contact).filter(Boolean) : [c]).map(x => ({ id: x.id, name: x.name || nameOf(x), avatar: x.avatar })), { id: 'me', name: myName(), avatar: me.avatar, mine: true }];
  const L = lyricsNow().filter(x => x.text.trim());
  let who = people[0].id;
  const rows = people.map((x, k) => {
    const l = L[k] || { text: '在某个平行世界', tr: '' };
    const r = h('div.as-ch.is-said.is-cur' + (x.mine ? '.is-me' : ''), { role: 'button', style: { '--p': '55%' }, onclick: () => pick(x.id) }, avatar(x.avatar, x.name, 32), h('p', h('span', l.text), l.tr ? h('small', h('span', l.tr)) : null));
    r._who = x; return r;
  });
  const restyle = () => rows.forEach(r => styleChoir(r, r._who.id, r._who.mine));
  const box = h('div');
  const save = () => { commit('music'); restyle(); };
  function pick(id) {
    who = id;
    rows.forEach(r => r.classList.toggle('is-sel', r._who.id === who || who === 'def'));   // 选中只在整行后面垫一层，气泡和头像照原样（头像以后要加头像框）
    const x = people.find(y => y.id === who), o = C[who] || (C[who] = {});
    // 给「所有人」调的那一项，盖掉之前单独给某个人调的（以最新的为准）
    const set = k => { const [get, put] = field(o, k); return [get, v => { put(v); if (who === 'def' && v) Object.keys(C).forEach(id => { if (id !== 'def') delete C[id][k]; }); }]; };
    box.replaceChildren(group('', [
      item({ title: '给谁调', right: h('span', who === 'def' ? '所有人' : x.name), chevron: true, onClick: async () => {
        const v = await actionSheet('给谁调', [{ value: 'def', label: '所有人', active: who === 'def' }, ...people.map(y => ({ value: y.id, label: y.name, active: who === y.id }))]);
        if (v) pick(v);
      } }),
      color('气泡颜色', ...set('bg'), save, true), color('唱到的字', ...set('ly'), save), color('没唱的字', ...set('ink'), save), font(...set('font'), save),
    ]));
  }
  p.body.append(pvBox(bgImage, bgFilter, h('div.as-tgl__list', { style: M().skin.color ? { '--ly': M().skin.color } : {} }, rows)), box,
    h('button.as-mu-morel', { onclick: async () => {
      if (!(await dialog({ title: '恢复默认？', text: '每个人的气泡、歌词颜色、字都回到原来的样子。', confirm: '恢复默认', danger: true }))) return;
      Object.keys(C).forEach(k => delete C[k]); save(); pick(who); toast('恢复默认了');
    } }, '全部恢复默认'));
  restyle(); pick(who);
  nav.push(p.el);
}
