// 查手机：TA 桌上的一角（作者让 GPT 画的一整张画，白天 / 夜里各一张，东西的位置一样）。
// 水杯、照片、笔、耳机、手机是从画里抠出来单独放的，点一下各自动一动；只有点手机会把它拿起来，上滑解锁后是 TA 的满屏手机。
// 看谁的手机：桌上右上角点名字换人（记在 kv 的 peek:who:窗口）。手机里的内容只在点「生成」时找 AI（gen.js），各应用的样子在 apps.js。
import { h } from '../../core/util.js';
import { kvGet, kvSet, contact, friends, win } from '../../core/store.js';
import { page, toast, navText, sheet, avatar, icon } from '../../core/ui.js';
import * as time from '../../core/time.js';
import { nameOf } from '../chat/engine.js';
import { FORMS, load, make, pickApps, running } from './gen.js';
import { VIEWS } from './apps.js';
import { setup } from './setup.js';

const BASE = 'assets/peek/', W = 852, H = 1846;
const pc = (v, all) => v / all * 100 + '%';
// 桌上能动的东西：[名字, 图, 左, 上, 宽, 高（画上的像素）]
const THINGS = [['水杯', 'water', 505, 300, 240, 345], ['照片', 'photo', 171, 980, 295, 305], ['笔', 'pen', 535, 1006, 302, 380], ['耳机', 'buds', 277, 285, 213, 168]];
const PHONE = ['手机', 'phone', 10, 392, 456, 516];
// 把斜放的手机屏摆正：屏幕四个角 → 一个 1×1 方块的四个角（事先算好的透视矩阵，三行）
const FACE = [[1.9219, -0.9494, 0.0676], [0.3933, 1.4361, -0.2326], [0.0261, 0.2559, 1]];
const APPS = ['备忘录', '相册', '日历', '钱包', '购物车', '饿了吗', '论坛', '短信', 'AI', '设置', '资源库'];
const DOCK = ['电话', '搜索', '消息', '音乐'];

const night = () => { const hh = time.isStory() ? time.story().hh : new Date().getHours(); return hh < 6 || hh >= 19; };
const clock = () => { const s = time.isStory() ? time.story() : { hh: new Date().getHours(), mm: new Date().getMinutes(), date: new Date() }; return [`${s.hh}:${String(s.mm).padStart(2, '0')}`, s.date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })]; };

export function open() {
  let back = () => false;   // 返回键、右滑返回：在手机里先退回桌上，在桌上才退出
  const whoB = navText('', () => choose());
  const p = page({ app: 'peek', id: 'peek-main', title: '', back: true, cls: 'as-peek', right: whoB, onBack: () => back() || p.el.dispatchEvent(new CustomEvent('as-back', { bubbles: true })) });
  const mode = night() ? 'night' : 'day';
  p.el.dataset.mode = mode;
  const thing = ([name, k, x, y, w, hh], onclick) => h('button.pk-thing', { 'aria-label': name, dataset: { k }, style: { left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(hh, H) }, onclick },
    h('img', { src: `${BASE}${k}-${mode}.webp`, alt: '', draggable: false }));
  const move = e => { const b = e.currentTarget; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); };
  const phone = thing(PHONE, () => near(true));
  const art = h('div.pk-art', h('img', { src: `${BASE}desk-${mode}.webp`, alt: '', draggable: false }), THINGS.map(t => thing(t, move)), h('div.pk-dim'), phone);
  const [t, d] = clock();
  const lock = h('div.pk-lock', { dataset: { noSwipe: '' } }, h('b', t), h('span', d), h('em', '上滑解锁'));
  const pill = h('div.pk-pill', { role: 'button', onclick: () => leave() }), genB = h('div.pk-pill', { role: 'button', onclick: () => running() ? running().ac.abort() : pickApps(c, D, start) });
  const home = h('div.pk-home', h('div.pk-top', pill, genB),
    h('div.pk-grid', APPS.map((n, i) => app(n, i, openApp))), h('div.pk-dock', DOCK.map((n, i) => app(n, 12 + i, openApp))));
  const stage = h('div.pk-stage', { dataset: { noSwipe: '' } }, art, lock, home);
  p.el.prepend(stage);

  // 看的是谁、TA 手机里现在有什么
  let c = null, D = { apps: {} };
  const paintGen = () => { genB.textContent = running() ? '取消' : '生成'; };
  async function setWho(x) {
    while (layers.length) layers.pop().remove();
    c = x; D = await load(c);
    whoB.textContent = nameOf(c); pill.textContent = `${nameOf(c)}的手机`;
    kvSet('peek:who:' + win.key, c.id).catch(() => {});
  }
  function choose() {
    if (!friends().length) { toast('聊天里还没有联系人'); return; }
    const s = sheet({ title: '看谁的手机', content: h('div.pk-who', friends().map(x => h('button' + (x === c ? '.is-on' : ''), { onclick: () => { s.close(); setWho(x); } }, avatar(x.avatar, nameOf(x), 54), h('span', nameOf(x))))) });
  }
  kvGet('peek:who:' + win.key).catch(() => '').then(id => { const x = contact(id); x ? setWho(x) : choose(); });
  paintGen();
  const start = names => { const run = make(c, names, got => { if (got.who !== c.id) return; D = got; layers.forEach(l => l._fill && l._fill()); }); paintGen(); run.finally(paintGen); };

  // 手机里一层层盖上去的页面：应用是从小放大，点进去的详情从右边滑进来
  const layers = [];
  function show(title, fill, cls, sub) {
    const body = h('div.pk-app__body');
    const el = h('div.pk-app' + (cls ? '.' + cls : ''), h('div.pk-app__bar', sub && h('button', { onclick: () => pop() }, icon('back', 20, 2.4), sub)), h(sub ? 'h2' : 'h1', title), body,
      h('button.pk-app__home', { 'aria-label': '回到桌面', onclick: () => { while (layers.length > 1) layers.pop().remove(); pop(); } }));
    el._fill = () => body.replaceChildren(...[fill()].flat(3).filter(Boolean)); el._fill();
    stage.append(el); layers.push(el);
    el._a = el.animate(sub ? [{ transform: 'translateX(100%)' }, { transform: 'none' }] : [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.3, .7, .2, 1)' });
  }
  function pop() { const el = layers.pop(); el._a.reverse(); el._a.finished.then(() => el.remove()); }
  function openApp(name) {
    if (!c) { choose(); return; }
    if (name !== '设置' && !VIEWS[name]) { toast(`「${name}」还没做`); return; }
    const sub = n => (t, kids, cls) => show(t, typeof kids === 'function' ? kids : () => kids, cls, n);
    const none = n => h('div.pk-none', '还没有内容', h('button', { onclick: () => running() ? toast('正在生成，等它写完') : start([n]) }, '生成（用一次 API）'));
    // 一个应用的内容：有 AI 写的就排出来；消息里你手机上真有的聊天不用生成也能看
    const body = n => () => D.apps[n] || (n === '消息' && D.real.length) ? VIEWS[n]((D.apps[n] || {}).rows || [], sub(n), D) : none(n);
    show(name, name === '设置' ? () => setup(t => show(t, body(t), '', '设置')) : body(name), 'is-' + (Object.keys(FORMS).indexOf(name) + 1));
  }

  // 拿起手机：手机从桌上飞起来、摆正，屏幕正好铺满；到了再亮起锁屏。
  // 斜着到正着之间切成十几小步（让浏览器自己从头补到尾，中间会乱飞）
  let fly;
  function near(on) {
    if (on) {
      const sw = stage.clientWidth, sh = stage.clientHeight, tx = -art.offsetLeft - phone.offsetLeft, ty = -art.offsetTop - phone.offsetTop;
      const g = [FACE[0].map((v, i) => sw * v + tx * FACE[2][i]), FACE[1].map((v, i) => sh * v + ty * FACE[2][i]), FACE[2]].map(r => [r[0] / phone.offsetWidth, r[1] / phone.offsetHeight, r[2]]);
      const at = t => { const a = g.map((r, i) => r.map((v, j) => (i === j ? 1 - t : 0) + t * v)); return { transform: `matrix3d(${a[0][0]},${a[1][0]},0,${a[2][0]},${a[0][1]},${a[1][1]},0,${a[2][1]},0,0,1,0,${a[0][2]},${a[1][2]},0,${a[2][2]})` }; };
      fly = phone.animate(Array.from({ length: 13 }, (_, i) => at(i / 12)), { duration: 700, easing: 'cubic-bezier(.3, .7, .2, 1)', fill: 'both' });
    } else fly?.reverse();
    stage.classList.toggle('is-near', on); p.el.classList.toggle('is-in', on);
    if (on && c) load(c).then(x => { D = x; });   // 你手机里的聊天可能有新的
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
  back = p.el._onBack = () => { if (layers.length) { pop(); return true; } if (!stage.classList.contains('is-near')) return false; leave(); return true; };
  return p.el;
}

function app(name, i, open) {
  return h('button.as-home-app', { onclick: () => open(name) }, h('span.as-home-app__icon', { style: { backgroundPosition: `${i % 4 / 3 * 100}% ${(i >> 2) / 3 * 100}%` } }), h('span.as-home-app__name', name));
}
