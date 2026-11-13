// 商业街：横着滑的一条像素小街。天空、地面是作者让 GPT 画的白天 / 黄昏 / 夜里三套（云、栏杆位置都一样，换时间只是淡入淡出）；
// 店一家一家换成像素图，现在只有大头贴机；照相馆（做立绘）从下面的按钮进
import { h } from '../../core/util.js';
import { page, toast } from '../../core/ui.js';

/* ---------- 配色 ---------- */
const INK = '#6b4235', LIL = '#f4bdb6', PNK = '#f8d6d0', PNK2 = '#f39aa0', MNT = '#9fd0c1', BUT = '#fbe3a0', BUT2 = '#f4cf63'; // 奶油米白 + 草莓红 + 柔黄 + 薄荷绿（上一版的配色）
const BASE = 'assets/street/', W = 2172, H = 1021, TOP = 724;   // 整条街的像素尺寸；TOP = 墙顶那条线（天空图的底）

const SW = 1.8;
const r = (x, y, w, h, f, rx = 0, s = INK, sw = SW) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${s ? `stroke="${s}" stroke-width="${sw}"` : ''}/>`;
const spark = (x, y, s = 1, c = '#fff') => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -7C.8 -2 2 -.8 7 0 2 .8.8 2 0 7-.8 2-2 .8-7 0-2-.8-.8-2 0-7z" fill="${c}"/>`;
const heart = (x, y, s = 1, c = PNK2) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 4c-3-3-8-3-8 1.5S0 13 0 13s8-3 8-7.5S3 1 0 4z" fill="${c}"/>`;
/* ---------- 整条街 ---------- */
const MODES = ['day', 'dusk', 'night'];
const nowMode = () => { const h = new Date().getHours(); return h >= 6 && h < 17 ? 'day' : h >= 17 && h < 19 ? 'dusk' : 'night'; };
const pc = (v, all) => v / all * 100 + '%';
const BOOTH = { x: 700, w: 277, h: 400 };   // 大头贴机：站在墙顶上
const layer = (k, top, h) => MODES.map(m => `<img class="st-${k} is-${m}" src="${BASE}${k}-${m}.webp" alt="" draggable="false" style="top:${pc(top, H)};height:${pc(h, H)}">`).join('');
const scene = () => `<div class="st-px is-${nowMode()}">${layer('sky', 0, TOP)}
<img class="st-booth" data-a="stshop" data-x="photo" src="${BASE}booth.webp" alt="大头贴" draggable="false" style="left:${pc(BOOTH.x, W)};top:${pc(TOP - BOOTH.h, H)};width:${pc(BOOTH.w, W)}">
${layer('ground', TOP - 3, 300)}</div>`;

/* ---------- 页面 ---------- */
const SHOPS = [['photo', '大头贴', '拍拍屋'], ['ichiban', '一番赏', '抽抽乐'], ['sweet', '烘焙店', '刚出炉'], ['claw', '娃娃机', '抓一只'], ['studio', '照相馆', '做立绘']];
const POS = { photo: BOOTH.x + BOOTH.w / 2 };
const coin = `<svg viewBox="0 0 20 20" width="15" height="15"><circle cx="10" cy="10" r="8.5" fill="${BUT}" stroke="${INK}" stroke-width="1.4"/>${spark(10, 10, .75, '#fff')}</svg>`;
const body = () => `<div class="street">
<div class="st-top"><div class="st-title"><b class="st-hand">商业街</b><small>SHOPPING STREET · 慢慢逛</small></div><div class="st-chips"><span>${coin}1,250</span><span><i>♥</i>12</span></div></div>
<p class="st-slogan st-hand">美好的事，在这条街上悄悄发生</p>
<div class="st-stage" data-no-swipe><div class="st-scroll">${scene()}</div><i class="st-heart h1">♥</i><i class="st-heart h2">✦</i><i class="st-heart h3">♥</i><i class="st-heart h4">✦</i></div>
<section class="st-cards"><div class="st-new" data-a="stgo" data-x="photo"><div><small>今日上新</small><b class="st-hand">情侣头像 · 剧情合照</b><em>去拍一张 →</em></div><svg viewBox="0 0 120 80" width="112" height="76"><g transform="rotate(-8 40 40)">${r(14, 10, 44, 54, '#fff', 4)}${r(19, 15, 34, 34, PNK, 2, null)}<circle cx="36" cy="30" r="8" fill="#fff" stroke="${INK}" stroke-width="1.3"/></g><g transform="rotate(9 84 40)">${r(62, 12, 44, 54, '#fff', 4)}${r(67, 17, 34, 34, LIL, 2, null)}<circle cx="84" cy="32" r="8" fill="#fff" stroke="${INK}" stroke-width="1.3"/></g>${heart(60, 0, 1.2, PNK2)}${spark(108, 62, .9, BUT2)}</svg></div>
<div class="st-prize"><h6><span class="st-hand">一番赏 · 本期</span><small>A–D 赏</small></h6><div>${[['A', '大玩偶', PNK], ['B', '亚克力立牌', MNT], ['C', '吧唧', BUT], ['D', '明信片', LIL]].map(([k, n, c]) => `<b data-a="stgo" data-x="ichiban" style="--c:${c}"><i class="st-hand">${k}</i><span>${n}</span></b>`).join('')}</div></div></section>
<nav class="st-nav">${SHOPS.map(([k, n, s]) => `<b data-a="stgo" data-x="${k}"><span class="st-hand">${n}</span><small>${s}</small></b>`).join('')}</nav>
<footer class="st-foot"><span class="st-hand">逛一逛，今天也会有好事发生。</span></footer></div>`;

// 街名用的两款手写体（Google Fonts）：进来才加载
const fonts = () => document.querySelector('link[data-street]') || document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=ZCOOL+KuaiLe&display=swap', dataset: { street: '' } }));
export function open() {
  fonts();
  const p = page({ app: 'street', id: 'street-main', title: '', back: true, cls: 'as-street' });
  p.body.innerHTML = body();
  const el = p.body, sc = el.querySelector('.st-scroll');
  // 手机上原生横滑；电脑上用鼠标拖着滑
  let x0 = 0, s0 = 0, drag = 0;
  sc.addEventListener('pointerdown', e => { if (e.pointerType != 'mouse') return; x0 = e.clientX; s0 = sc.scrollLeft; drag = 1; sc.classList.add('drag'); });
  sc.addEventListener('pointermove', e => { if (drag) sc.scrollLeft = s0 - (e.clientX - x0); });
  sc.addEventListener('pointerup', e => { if (!drag) return; drag = 0; sc.classList.remove('drag'); if (Math.abs(e.clientX - x0) > 6) sc._moved = Date.now(); });
  requestAnimationFrame(() => { sc.scrollLeft = 40; });
  const px = sc.querySelector('.st-px');
  const go = k => { if (!POS[k]) { toast(`${SHOPS.find(s => s[0] == k)[1]} · 準備中`); return; } sc.scrollTo({ left: POS[k] * px.clientWidth / W - sc.clientWidth / 2, behavior: 'smooth' }); };
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-a]');
    if (!t) { if (e.target === px && !(sc._moved && Date.now() - sc._moved < 300)) { const m = MODES[(MODES.indexOf(px.className.split('is-')[1]) + 1) % 3]; px.className = 'st-px is-' + m; } return; }   // 点天空：白天 → 黄昏 → 夜里轮着看
    const k = t.dataset.x;
    if (t.dataset.a === 'stgo') { k === 'studio' ? import('./studio.js').then(m => m.openStudio()) : go(k); return; }
    if (sc._moved && Date.now() - sc._moved < 300) return;
    if (k === 'studio') { import('./studio.js').then(m => m.openStudio()); return; }
    toast(`${SHOPS.find(s => s[0] == k)[1]} · 準備中`);
  });
  return p.el;
}
