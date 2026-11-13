// 商业街：横着滑的一条像素小街。天空、地面是作者让 GPT 画的白天 / 黄昏 / 夜里三套（云、栏杆位置都一样，换时间只是淡入淡出）；
// 店一家一家换成像素图，现在只有大头贴机；照相馆（做立绘）从下面的按钮进
import { page, toast } from '../../core/ui.js';

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

/* ---------- 页面 ---------- */
const SHOPS = [['photo', '大头贴', '拍拍屋'], ['ichiban', '一番赏', '抽抽乐'], ['sweet', '烘焙店', '刚出炉'], ['claw', '娃娃机', '抓一只'], ['studio', '照相馆', '做立绘']];
const POS = { photo: BOOTH.x + BOOTH.w / 2 };
// 像素小图标（一格一格的方块，和街的颗粒一样）
const px = (w, h, d, c) => `<svg viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}" shape-rendering="crispEdges" aria-hidden="true">${d.map((p, i) => `<path d="${p}" fill="${c[i]}"/>`).join('')}</svg>`;
const coin = px(7, 7, ['M2 0h3v1h1v1h1v3h-1v1h-1v1h-3v-1h-1v-1h-1v-3h1v-1h1z', 'M3 2h1v3h-1z'], ['#f2b94a', '#fff3c4']);
const heart = px(7, 6, ['M1 0h2v1h1v-1h2v1h1v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-2h1z', 'M1 1h1v1h-1z'], ['#e9607e', '#ffd0dc']);
const body = () => `<div class="street">
<div class="st-top"><div class="st-title"><b>商业街</b><small>SHOPPING STREET</small></div><div class="st-chips"><span>${coin}1,250</span><span>${heart}12</span></div></div>
<div class="st-stage" data-no-swipe><div class="st-scroll">${scene()}</div></div>
<p class="st-slogan">美好的事，在这条街上悄悄发生</p>
<section class="st-cards"><div class="st-new st-box" data-a="stgo" data-x="photo"><div><small>今日上新</small><b>情侣头像 · 剧情合照</b><em>去拍一张 ▸</em></div><img src="${BASE}booth.webp" alt="" draggable="false"></div>
<div class="st-prize st-box"><h6><span>一番赏 · 本期</span><small>A–D 赏</small></h6><div>${[['A', '大玩偶'], ['B', '亚克力立牌'], ['C', '吧唧'], ['D', '明信片']].map(([k, n]) => `<b data-a="stgo" data-x="ichiban"><i>${k}</i><span>${n}</span></b>`).join('')}</div></div></section>
<nav class="st-nav">${SHOPS.map(([k, n, s]) => `<b class="st-box" data-a="stgo" data-x="${k}"><span>${n}</span><small>${s}</small></b>`).join('')}</nav>
<footer class="st-foot">逛一逛，今天也会有好事发生。</footer></div>`;

// 整页用像素字（Fusion Pixel，开源 OFL）：进来才从 jsDelivr 下载，字没到之前先不显示，免得换字体跳一下
let pixel = null;
const fonts = () => pixel || (pixel = new FontFace('StPixel', 'url(https://cdn.jsdelivr.net/npm/@fontsource/fusion-pixel-12px-proportional-sc@5/files/fusion-pixel-12px-proportional-sc-latin-400-normal.woff2)', { display: 'block' }).load().then(f => document.fonts.add(f)).catch(() => {}));
export function open() {
  fonts();
  const p = page({ app: 'street', id: 'street-main', title: '', back: true, cls: 'as-street' });
  p.el.dataset.mode = nowMode(); p.body.innerHTML = body();
  const el = p.body, sc = el.querySelector('.st-scroll');
  // 手机上原生横滑；电脑上用鼠标拖着滑
  let x0 = 0, s0 = 0, drag = 0;
  sc.addEventListener('pointerdown', e => { if (e.pointerType != 'mouse') return; x0 = e.clientX; s0 = sc.scrollLeft; drag = 1; sc.classList.add('drag'); });
  sc.addEventListener('pointermove', e => { if (drag) sc.scrollLeft = s0 - (e.clientX - x0); });
  sc.addEventListener('pointerup', e => { if (!drag) return; drag = 0; sc.classList.remove('drag'); if (Math.abs(e.clientX - x0) > 6) sc._moved = Date.now(); });
  requestAnimationFrame(() => { sc.scrollLeft = 40; });
  const street = sc.querySelector('.st-px');
  const go = k => { if (!POS[k]) { toast(`${SHOPS.find(s => s[0] == k)[1]} · 準備中`); return; } sc.scrollTo({ left: POS[k] * street.clientWidth / W - sc.clientWidth / 2, behavior: 'smooth' }); };
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-a]');
    if (!t) { if (e.target === street && !(sc._moved && Date.now() - sc._moved < 300)) p.el.dataset.mode = MODES[(MODES.indexOf(p.el.dataset.mode) + 1) % 3]; return; }   // 点天空：白天 → 黄昏 → 夜里轮着看
    const k = t.dataset.x;
    if (t.dataset.a === 'stgo') { k === 'studio' ? import('./studio.js').then(m => m.openStudio()) : go(k); return; }
    if (sc._moved && Date.now() - sc._moved < 300) return;
    if (k === 'studio') { import('./studio.js').then(m => m.openStudio()); return; }
    toast(`${SHOPS.find(s => s[0] == k)[1]} · 準備中`);
  });
  return p.el;
}
