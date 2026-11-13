// 商业街：横着滑的一条像素小街。天空、地面是作者让 GPT 画的白天 / 黄昏 / 夜里三套（云、栏杆位置都一样，换时间只是淡入淡出）；
// 整页就是这条街（不放卡片按钮），点店才进去；店一家一家换成像素图，现在只有大头贴机；照相馆（做立绘）还没画，先从右上角进
import { h } from '../../core/util.js';
import { page, navBtn, toast } from '../../core/ui.js';

const BASE = 'assets/street/', W = 2172, H = 1021, TOP = 724;   // 整条街的像素尺寸；TOP = 墙顶那条线（天空图的底）
/* ---------- 整条街 ---------- */
const MODES = ['day', 'dusk', 'night'];
const nowMode = () => { const h = new Date().getHours(); return h >= 6 && h < 17 ? 'day' : h >= 17 && h < 19 ? 'dusk' : 'night'; };
const pc = (v, all) => v / all * 100 + '%';
const BOOTH = { x: 700, w: 277, h: 400 };   // 大头贴机：站在墙顶上
const layer = (k, top, h) => MODES.map(m => `<img class="st-${k} is-${m}" src="${BASE}${k}-${m}.webp" alt="" draggable="false" style="top:${pc(top, H)};height:${pc(h, H)}">`).join('');
const scene = () => `<div class="st-px">${layer('sky', 0, TOP)}
<img class="st-booth" data-a="stshop" data-x="photo" src="${BASE}booth.webp" alt="大头贴" draggable="false" style="left:${pc(BOOTH.x, W)};top:${pc(TOP - BOOTH.h, H)};width:${pc(BOOTH.w, W)}">
${layer('ground', TOP - 3, 300)}</div>`;

/* ---------- 页面：整页就是这条街，点店才进去 ---------- */
const SHOPS = { photo: '大头贴' };
export function open() {
  const studio = navBtn('camera', '照相馆', () => import('./studio.js').then(m => m.openStudio()));   // 照相馆还没画进街里，先放右上角
  const p = page({ app: 'street', id: 'street-main', title: '商业街', large: true, back: true, cls: 'as-street', right: [studio] });
  p.el.dataset.mode = nowMode();
  const stage = h('div.st-stage', { dataset: { noSwipe: '' }, html: `<div class="st-scroll">${scene()}</div>` }); p.el.prepend(stage);
  const sc = stage.firstChild, street = sc.firstChild;
  // 手机上原生横滑；电脑上用鼠标拖着滑
  let x0 = 0, s0 = 0, drag = 0;
  sc.addEventListener('pointerdown', e => { if (e.pointerType != 'mouse') return; x0 = e.clientX; s0 = sc.scrollLeft; drag = 1; sc.classList.add('drag'); });
  sc.addEventListener('pointermove', e => { if (drag) sc.scrollLeft = s0 - (e.clientX - x0); });
  sc.addEventListener('pointerup', e => { if (!drag) return; drag = 0; sc.classList.remove('drag'); if (Math.abs(e.clientX - x0) > 6) sc._moved = Date.now(); });
  requestAnimationFrame(() => { sc.scrollLeft = (BOOTH.x + BOOTH.w / 2) * street.clientWidth / W - sc.clientWidth / 2; });   // 一进来大头贴机在正中
  sc.addEventListener('click', e => {
    const t = e.target.closest('[data-a]');
    if (!t) { if (e.target === street && !(sc._moved && Date.now() - sc._moved < 300)) p.el.dataset.mode = MODES[(MODES.indexOf(p.el.dataset.mode) + 1) % 3]; return; }   // 点天空：白天 → 黄昏 → 夜里轮着看
    if (sc._moved && Date.now() - sc._moved < 300) return;
    toast(`${SHOPS[t.dataset.x]} · 准备中`);
  });
  return p.el;
}
