// 放歌时：小手机顶上的灵动岛（小封面 + 跳动的音波，音波是歌词颜色），点一下展开成小播放器（点封面进播放页，点别处收回去）；
// 锁屏上的播放卡片（封面、歌名、进度、红心 / 上一首 / 暂停 / 下一首）：在放歌才有，往左划能划掉（歌照放）。
import { h } from '../../core/util.js';
import { state } from '../../core/store.js';
import { icon } from '../../core/ui.js';
import * as P from '../../core/music.js';

const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const wave = () => h('span.as-isl__wave', [0, 1, 2, 3].map(() => h('i')));
const btn = (ic, label, fn, size = 22) => h('button', { 'aria-label': label, onclick: e => { e.stopPropagation(); fn(); } }, icon(ic, size, 2));
let isl = null, card = null;

function build() {
  const sb = document.querySelector('#statusbar'), lock = document.querySelector('#lock');
  if (!sb || !lock || !lock.querySelector('.as-lock__head')) return false;
  // 灵动岛
  const cov = h('span.as-isl__cov'), bigCov = h('span.as-isl__bigcov', { role: 'button', onclick: async e => { e.stopPropagation(); close(); (await import('./music.js')).openPlayer(); } });
  const name = h('b'), artist = h('span'), bar = h('i'), play = h('span');
  const el = h('div.as-isl', { role: 'button', 'aria-label': '正在播放', onclick: () => { if (!el.classList.contains('is-open')) { el.classList.add('is-open'); paint(); } } },
    h('div.as-isl__mini', cov, wave()),
    h('div.as-isl__big', h('div.as-isl__row', bigCov, h('div.as-isl__info', name, artist), wave()), h('div.as-isl__bar', bar),
      h('div.as-isl__ctrl', btn('prev', '上一首', () => P.prev(), 24), h('button', { 'aria-label': '播放 / 暂停', onclick: e => { e.stopPropagation(); P.toggle(); } }, play), btn('next', '下一首', () => P.next(), 24))));
  const close = () => { el.classList.remove('is-open'); paint(); };
  document.addEventListener('pointerdown', e => { if (el.classList.contains('is-open') && !el.contains(e.target)) close(); }, true);
  sb.append(el);
  isl = { el, cov, bigCov, name, artist, bar, play };
  // 锁屏卡片
  const lc = h('span.as-lmc__cov'), ln = h('b'), la = h('span'), lb = h('i'), t0 = h('span'), t1 = h('span'), lp = h('span');
  const heart = h('button.as-lmc__heart', { 'aria-label': '喜欢', onclick: e => {
    e.stopPropagation(); const on = P.like(); heart.classList.toggle('is-on', on);
    if (on) burst(heart);
  } }, icon('heart', 30, 1.8));
  const c = h('div.as-lmc', { onclick: e => e.stopPropagation() },
    h('div.as-lmc__row', lc, h('div.as-lmc__info', ln, la), wave()),
    h('div.as-lmc__prog', t0, h('div.as-lmc__bar', lb), t1),
    h('div.as-lmc__ctrl', heart, btn('prev', '上一首', () => P.prev(), 30), h('button', { 'aria-label': '播放 / 暂停', onclick: e => { e.stopPropagation(); P.toggle(); } }, lp), btn('next', '下一首', () => P.next(), 30), h('span')));
  lock.querySelector('.as-lock__head').after(c);
  // 往左划：划到一半露出「移除」，点了才收起卡片（歌照放，换歌或者暂停后再放时回来）；划回去、点卡片就合上
  const W = 86, rm = h('button.as-lmc__rm', { onclick: e => { e.stopPropagation(); c.style.transition = 'transform 220ms, opacity 220ms'; c.style.transform = 'translateX(-110%)'; c.style.opacity = '0';
    setTimeout(() => { gone = true; shut(); c.style.opacity = ''; paint(); }, 220); } }, '移除');
  c.append(rm);
  let x0 = null, base = 0, dx = 0;
  const shut = () => { c.style.transition = 'transform 220ms'; c.style.transform = ''; c.classList.remove('is-swipe'); base = 0; };
  c.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === rm) return; x0 = e.clientX; dx = base; c.style.transition = ''; });   // 不让锁屏当成上滑解锁
  addEventListener('pointermove', e => { if (x0 == null) return; dx = Math.max(-W * 2, Math.min(0, base + e.clientX - x0)); c.style.transform = `translateX(${dx}px)`; c.classList.toggle('is-swipe', dx < 0); });
  addEventListener('pointerup', () => {
    if (x0 == null) return; x0 = null;
    if (Math.abs(dx - base) > 8) c.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true });   // 划完松手那一下不算点按钮
    else if (base) { shut(); c.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true }); return; }   // 开着时点一下卡片：合上
    if (dx < -W / 2) { base = -W; c.style.transition = 'transform 220ms'; c.style.transform = `translateX(${-W}px)`; } else shut();
  });
  new MutationObserver(paint).observe(sb.closest('.as-phone'), { attributes: true, attributeFilter: ['class'] });   // 锁上 / 解锁时看卡片该不该在
  card = { el: c, lock, cov: lc, name: ln, artist: la, bar: lb, t0, t1, play: lp, heart };
  return true;
}
// 点亮红心（照作者发的苹果点赞动效第二种）：空心先没了 → 中间一个红点长成一圈圈橙红的圆再缩回去 → 实心红心弹出来，四周迸出几粒橙色小点。
// 圈和小点跟着心的大小走，中心对着心（乐评的赞前面还有数字）
export function burst(btn) {
  const svg = btn.querySelector('svg'), z = svg.width.baseVal.value, a = svg.getBoundingClientRect(), b = btn.getBoundingClientRect();
  btn.style.setProperty('--cx', (a.left - b.left + a.width / 2) / b.width * 100 + '%'); btn.style.setProperty('--hs', z * 1.6 + 'px');
  btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop');
  const bits = [h('span.as-hb'), ...Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + Math.random() * .4, r = z * (.8 + Math.random() * .35); return h('span.as-hd', { style: { '--dx': Math.cos(a) * r + 'px', '--dy': Math.sin(a) * r + 'px' } }); })];
  btn.append(...bits);
  setTimeout(() => bits.forEach(b => b.remove()), 1100);
}
let songId = '', gone = false, stay = false, wasOn = false;
function paint() {
  if (!isl && !build()) return;
  const s = P.current(), on = P.playing(), ly = (state.music.skin || {}).color || '', locked = card.lock.closest('.as-phone').classList.contains('is-locked');
  isl.el.hidden = !s || (!on && !isl.el.classList.contains('is-open'));
  // 卡片：在放歌才有。锁着时在卡片上点了暂停，先留着（不然按钮一点就没了），解锁后就收起来；划掉的换歌或重新放起来时回来
  if ((on && !wasOn) || (s && songId !== s.id + s.pic)) gone = false;
  wasOn = on; stay = locked && (on || stay);
  const show = !!s && !gone && (on || stay);
  card.el.hidden = !show; card.lock.classList.toggle('has-music', show);
  if (!s) return;
  isl.el.style.setProperty('--isl', ly); card.el.style.setProperty('--isl', ly);
  isl.el.classList.toggle('is-playing', on); card.el.classList.toggle('is-playing', on);
  if (songId !== s.id + s.pic) {   // 换歌才换封面和字（图片重新解码会闪）
    songId = s.id + s.pic;
    [isl.cov, isl.bigCov, card.cov].forEach(e => { e.style.backgroundImage = s.pic ? `url("${s.pic}")` : ''; });
    isl.name.textContent = card.name.textContent = s.name; isl.artist.textContent = card.artist.textContent = s.artist;
  }
  card.heart.classList.toggle('is-on', P.liked(s));
  if (card.play.dataset.on !== String(on)) { card.play.dataset.on = on; isl.play.replaceChildren(icon(on ? 'pause' : 'play', 24, 2.4)); card.play.replaceChildren(icon(on ? 'pause' : 'play', 30, 2.4)); }
  time();
}
// 进度：只在看得见的时候改（锁着看卡片、灵动岛展开着）
function time() {
  if (!isl) return;
  const t = P.now(), d = P.dur() || 0, r = d ? Math.min(1, t / d) * 100 + '%' : '0%', ly = (state.music.skin || {}).color || '';
  isl.el.style.setProperty('--isl', ly); card.el.style.setProperty('--isl', ly);   // 播放页改了歌词颜色，这里跟着变
  if (isl.el.classList.contains('is-open')) isl.bar.style.width = r;
  if (document.querySelector('.as-phone.is-locked')) { card.bar.style.width = r; card.t0.textContent = fmt(t); card.t1.textContent = '-' + fmt(Math.max(0, d - t)); }
}
P.onMusic(w => { if (w === 'time') time(); else paint(); });
paint();
