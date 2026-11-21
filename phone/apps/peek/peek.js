// 查手机：TA 桌上的一角（作者让 GPT 画的一整张画，白天 / 夜里各一张，东西的位置一样）。
// 桌上的耳机、水杯、本子、笔、照片点了只有一点反应；只有点手机会凑近，上滑解锁后是 TA 的满屏手机。
// 手机里的各个应用还没做，点了先提示。
import { h } from '../../core/util.js';
import { page, icon, toast } from '../../core/ui.js';
import * as time from '../../core/time.js';

const BASE = 'assets/peek/', W = 852, H = 1846;
const pc = (v, all) => v / all * 100 + '%';
// 桌上能点的东西：[名字, 左, 上, 宽, 高（画上的像素）, 点了说的一句]
const THINGS = [
  ['耳机', 285, 285, 200, 150, '耳机线还缠着，像是刚摘下来。'],
  ['水杯', 510, 260, 285, 385, '水还剩大半杯。'],
  ['本子', 105, 830, 745, 790, '本子摊开着，这一页还没写字。'],
  ['照片', 180, 990, 275, 285, '本子里夹着一张海边的照片。'],
  ['笔', 555, 1015, 260, 360, '笔帽没盖。'],
];
const PHONE = { x: 20, y: 400, w: 440, h: 495, cx: 238, cy: 645, turn: 23 };   // 手机在画上的位置、屏幕正中、斜了多少度
const DOCK = [['电话', 'phone'], ['搜索', 'search'], ['消息', 'chat'], ['音乐', 'music']];
const APPS = [['备忘录', 'note'], ['相册', 'image'], ['日历', 'bookmark'], ['钱包', 'wallet'], ['购物车', 'shop'], ['饿了吗', 'flame'], ['论坛', 'comment'], ['短信', 'mail'], ['AI', 'sparkle'], ['设置', 'gear']];

const night = () => { const hh = time.isStory() ? time.story().hh : new Date().getHours(); return hh < 6 || hh >= 19; };
const clock = () => { const s = time.isStory() ? time.story() : { hh: new Date().getHours(), mm: new Date().getMinutes(), date: new Date() }; return [`${s.hh}:${String(s.mm).padStart(2, '0')}`, s.date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })]; };

export function open() {
  let back = () => false;   // 返回键、右滑返回：在手机里先退回桌上，在桌上才退出
  const p = page({ app: 'peek', id: 'peek-main', title: '', back: true, cls: 'as-peek', onBack: () => back() || p.el.dispatchEvent(new CustomEvent('as-back', { bubbles: true })) });
  const mode = night() ? 'night' : 'day';
  p.el.dataset.mode = mode;
  const say = h('div.pk-say', { role: 'status' });
  let sayT = 0;
  const tell = t => { say.textContent = t; say.classList.add('on'); clearTimeout(sayT); sayT = setTimeout(() => say.classList.remove('on'), 2200); };
  const spot = ([name, x, y, w, hh, line]) => h('button.pk-spot', { 'aria-label': name, style: { left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(hh, H) },
    onclick: e => { const b = e.currentTarget; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); tell(line); } });
  const art = h('div.pk-art', h('img', { src: `${BASE}desk-${mode}.webp`, alt: '', draggable: false }), THINGS.map(spot),
    h('button.pk-spot.pk-phone', { 'aria-label': '手机', style: { left: pc(PHONE.x, W), top: pc(PHONE.y, H), width: pc(PHONE.w, W), height: pc(PHONE.h, H) }, onclick: () => near(true) }));
  const [t, d] = clock();
  const lock = h('div.pk-lock', { dataset: { noSwipe: '' } }, h('b', t), h('span', d), h('em', '上滑解锁'));
  const home = h('div.pk-home', h('div.pk-pill', { role: 'button', onclick: () => leave() }, 'TA 的手机'),
    h('div.pk-grid', APPS.map(app)), h('div.pk-dock', DOCK.map(app)));
  const stage = h('div.pk-stage', { dataset: { noSwipe: '' } }, art, say, lock, home);
  p.el.prepend(stage);

  // 凑近：整张画朝手机推过去、转正；到了再亮起锁屏
  function near(on) {
    const k = 2.3;
    art.style.transform = on ? `rotate(${PHONE.turn}deg) scale(${k}) translate(${50 - PHONE.cx / W * 100}%, ${50 - PHONE.cy / H * 100}%)` : '';
    stage.classList.toggle('is-near', on);
    if (!on) stage.classList.remove('is-open');
  }
  const leave = () => { near(false); lock.style.transform = ''; };
  // 上滑解锁：锁屏跟着手指往上走，过了五分之一就滑走，露出 TA 的桌面
  let y0 = null;
  lock.addEventListener('pointerdown', e => { y0 = e.clientY; lock.setPointerCapture(e.pointerId); lock.style.transition = 'none'; });
  lock.addEventListener('pointermove', e => { if (y0 != null) lock.style.transform = `translateY(${Math.min(0, e.clientY - y0)}px)`; });
  const up = e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null; lock.style.transition = '';
    if (dy < -lock.offsetHeight / 5) { lock.style.transform = 'translateY(-105%)'; stage.classList.add('is-open'); } else lock.style.transform = '';
  };
  lock.addEventListener('pointerup', up); lock.addEventListener('pointercancel', up);
  back = p.el._onBack = () => { if (!stage.classList.contains('is-near')) return false; leave(); return true; };
  return p.el;
}

function app([name, ic]) {
  return h('button.as-home-app', { onclick: () => toast(`「${name}」还没做`) }, h('span.as-home-app__icon', icon(ic, 28, 1.7)), h('span.as-home-app__name', name));
}
