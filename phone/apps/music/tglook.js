// 一起听的样子（播放页「换样式」→「一起听的样子」）：
// 全局：耳机颜色、「一起听了多久」的颜色和字体、头像上那两句悄悄话的气泡颜色 / 字颜色 / 字体；
// 群唱：每个角色各一套（TA 的气泡、我的气泡、字的颜色、唱到的颜色、字体），没单独调过的用「默认」。
// 空着的项 = 用原来的样子。上面一块是预览，调什么马上看到。
import { h } from '../../core/util.js';
import { state, commit, contact } from '../../core/store.js';
import { page, group, item, icon, avatar, actionSheet, dialog, sheet, colorWheel, btn, toast } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { FONTS, useFont } from '../../core/floatlyric.js';
import { userFonts } from '../../core/fonts.js';
import { nameOf } from '../chat/engine.js';

const M = () => state.music;
export function look() {
  if (!M().tgLook) {   // 以前在悄悄话页自己选过气泡颜色的，搬过来
    const B = M().bub || {};
    M().tgLook = { ear: '', time: {}, pair: B.custom ? { bg: B.bg, ink: B.ink } : {}, chars: {} };
  }
  return M().tgLook;
}
export const charLook = id => ({ ...look().chars.def, ...(id && look().chars[id]) });
const fontLabel = f => !f ? '默认' : (FONTS.find(x => x[0] === f) || [0, (userFonts().find(u => 'u:' + u.id === f) || {}).name || '默认'])[1];
/** 给元素设字体（字体要先装上，装好才换，不会先闪一下别的字） */
export async function setFont(el, f) { el.style.fontFamily = f ? `${await useFont(document, f)}, var(--font-ui)` : ''; }
/** 群唱的一行：TA 的气泡 / 我的气泡、字色、唱到的颜色、字体（c 是这行歌词对应的角色 id，mine 是我唱的那行） */
export function styleChoir(row, id, mine) {
  const L = charLook(id), p = row.querySelector('p');
  p.style.setProperty('--ch-bg', (mine ? L.me : L.ta) || ''); p.style.setProperty('--ch-ink', L.ink || '');
  row.style.setProperty('--ly', L.ly || ''); if (!L.ly) row.style.removeProperty('--ly');
  setFont(p, L.font);
}
/** 头像上两句悄悄话、一起听了多久、耳机：全局那几项 */
export function styleTop(tgEl, time, bubs) {
  const G = look();
  tgEl.style.setProperty('--ear', G.ear || ''); tgEl.classList.toggle('has-ear', !!G.ear);
  time.style.color = (G.time && G.time.color) || ''; setFont(time, G.time && G.time.font);
  setFont(bubs, G.pair.font);
}

/** 打开设置页。bg：播放页背景（拿来垫在预览下面）；c：现在一起听的人（预览里的 TA，也是默认先调的角色） */
export function openTgLook({ bgImage, bgFilter, c, me, onChange }) {
  const G = look(), p = page({ app: 'music', id: 'music-tglook', title: '一起听的样子', back: true });
  const one = c && c.type !== 'group' ? c : contact((c && c.members || [])[0]) || state.contacts[0];
  let who = one ? one.id : 'def';
  const save = () => { commit('music'); paintPv(); onChange && onChange(); };

  // 预览：两句悄悄话 + 两个头像带耳机 + 一起听了多久 + 两行群唱
  const bubs = h('div.as-tg__bubs', h('div.as-tg__bub.is-l', h('span', '好想现在见你')), h('div.as-tg__bub.is-r', h('span', '闭上眼，我就在旁边')));
  const half = side => h('div.as-tg__half.is-' + side, h('div.as-tg__who'), h('img', { src: `assets/music/together-${side}.webp`, alt: '' }),
    h('i.as-tg__tint', { style: { webkitMaskImage: `url(assets/music/together-${side}.webp)`, maskImage: `url(assets/music/together-${side}.webp)` } }));
  const pair = h('div.as-tg__pair', bubs, half('l'), half('r')), time = h('div.as-tg__time', '一起听了 1 小时 8 分钟');
  const tgEl = h('div.as-tg.as-tgl__tg', pair, time);
  const chTa = h('div.as-ch.is-said'), chMe = h('div.as-ch.is-said.is-me.is-cur', { style: { '--p': '55%' } });
  const pv = h('div.as-tgl__pv', h('div.as-tgl__bg', { style: { backgroundImage: bgImage, filter: bgFilter } }), tgEl, h('div.as-tgl__ch', chTa, chMe));
  const line = (a, t, tr) => [a, h('p', h('span', t), h('small', h('span', tr)))];
  let shown = null;
  function paintPv() {
    const ta = contact(who) || one, [w0, w1] = pair.querySelectorAll('.as-tg__who');
    if (shown !== who) {   // 头像只在换人时换（图片重新解码会闪）
      shown = who;
      w0.replaceChildren(avatar(me.avatar, me.nick, 84)); w1.replaceChildren(avatar(ta ? ta.avatar : '', ta ? nameOf(ta) : 'TA', 84));
      chTa.replaceChildren(...line(avatar(ta ? ta.avatar : '', ta ? nameOf(ta) : 'TA', 32), '在某个平行世界', '在某个平行世界'));
      chMe.replaceChildren(...line(avatar(me.avatar, me.nick, 32), '如果可以 回到那天', '如果可以 回到那天'));
    }
    const P = G.pair;
    tgEl.style.setProperty('--bub-bg', P.bg || '#fff'); tgEl.style.setProperty('--bub-ink', P.ink || '#222');
    styleTop(tgEl, time, bubs);
    styleChoir(chTa, who === 'def' ? '' : who, false); styleChoir(chMe, who === 'def' ? '' : who, true);
  }

  // 一项颜色：右边一个小圆点（没设是「默认」），点开是色轮 + 恢复默认
  const dot = v => v ? h('span.as-tgl__dot', { style: { background: v } }) : h('span', '默认');
  const color = (title, get, set) => {
    const right = h('span', dot(get()));
    return item({ title, right, chevron: true, onClick: () => {
      const sh = sheet({ title, content: h('div.as-mu-color', colorWheel(get() || '#ffffff', v => { set(v); right.replaceChildren(dot(v)); save(); }),
        btn('恢复默认', 'secondary', () => { set(''); right.replaceChildren(dot('')); save(); sh.close(); })) });
    } });
  };
  const font = (get, set) => {
    const right = h('span', fontLabel(get()));
    return item({ title: '字体', right, chevron: true, onClick: async () => {
      const v = await actionSheet('字体', [...FONTS.map(([k, n]) => ({ value: k || 'def', label: n, active: (get() || '') === k })), ...userFonts().map(u => ({ value: 'u:' + u.id, label: u.name, active: get() === 'u:' + u.id }))]);
      if (v == null) return; set(v === 'def' ? '' : v); right.textContent = fontLabel(get()); save();
    } });
  };

  // 角色那一组：上面选给谁调，换人时只重画这一组
  const charBox = h('div');
  const C = () => G.chars[who] || (G.chars[who] = {}), field = k => [() => C()[k] || '', v => { if (v) C()[k] = v; else delete C()[k]; }];
  function paintChar() {
    const ta = contact(who);
    charBox.replaceChildren(group('群唱', [
      item({ title: '给谁调', right: h('span', who === 'def' ? '默认（没单独调过的都用这个）' : nameOf(ta)), chevron: true, onClick: async () => {
        const v = await actionSheet('给谁调', [{ value: 'def', label: '默认', active: who === 'def' }, ...state.contacts.map(x => ({ value: x.id, label: nameOf(x), active: who === x.id }))]);
        if (v) { who = v; paintChar(); paintPv(); }
      } }),
      color(who === 'def' ? 'TA 的气泡' : `${nameOf(ta)}的气泡`, ...field('ta')), color('我的气泡', ...field('me')), color('字的颜色', ...field('ink')), color('唱到的颜色', ...field('ly')), font(...field('font')),
    ]));
  }
  const sub = (o, k) => [() => o[k] || '', v => { if (v) o[k] = v; else delete o[k]; }];
  G.time = G.time || {};
  p.body.append(pv,
    group('耳机', [color('耳机颜色', () => G.ear, v => { G.ear = v; })]),
    group('一起听了多久', [color('颜色', ...sub(G.time, 'color')), font(...sub(G.time, 'font'))]),
    group('头像上的两句话', [color('气泡颜色', ...sub(G.pair, 'bg')), color('字的颜色', ...sub(G.pair, 'ink')), font(...sub(G.pair, 'font'))]),
    charBox,
    h('button.as-mu-morel', { onclick: async () => {
      if (!(await dialog({ title: '全部恢复默认？', text: '耳机、时间、两句话、每个角色的群唱都回到原来的样子。', confirm: '恢复默认', danger: true }))) return;
      M().tgLook = { ear: '', time: {}, pair: {}, chars: {} }; delete M().bub; commit('music'); nav.pop(); onChange && onChange(); toast('都恢复默认了');
    } }, '全部恢复默认'));
  paintChar(); paintPv();
  nav.push(p.el);
}
