// 备忘录里画画（照 iPhone）：就在这一条里画，不另开一页。点笔，字下面接着出一块画布（点已经画好的那张就是接着改那张），
// 底下换成一排笔（钢笔、细笔、荧光笔、橡皮）、颜色、撤销、完成；越往下画画布越长。一根手指画，两根手指上下滑。
// 画好的存成一张透明底的 png，单独放在 kv 的 memo-draw:编号 里（图大，不跟备忘录的字一起存）；正文里是单独一行「✎编号」，和字一样按先后排
import { h, uid } from '../../core/util.js';
import { kvGet, kvSet } from '../../core/store.js';
import { icon, sheet, colorWheel, toast, dialog } from '../../core/ui.js';
import { inks, inkImg } from '../peek/apps.js';

const TOOLS = { pen: ['钢笔', 3, 1], fine: ['细笔', 1.5, 1], mark: ['荧光笔', 18, .35], erase: ['橡皮', 22, 1] }, W = 786, STEP = 900;
// 每支笔记着自己的颜色（荧光笔默认黄的），橡皮没有颜色
let tool = 'pen'; const INK = { pen: '#000000', fine: '#000000', mark: '#ffcc00' }, ink = () => INK[tool] || INK.pen;
const line = (c, [k, col, pts]) => { c.lineCap = c.lineJoin = 'round'; c.lineWidth = TOOLS[k][1] * 2; c.strokeStyle = col; c.beginPath(); c.moveTo(...pts[0]); pts.forEach(p => c.lineTo(...p)); c.stroke(); };

/** 在 host 那里画（host 是已经画好的那张图，或者新放的一个空位）；key 是改哪张（新画的空着）；
 *  tip 是共用时点 ⓘ 看的那句；onSave(编号) 在画完时同步调用（还没画一笔就点完成的不调） */
export async function startDraw({ host, key = '', tip = '', onSave }) {
  const page = host.closest('.as-page'), body = host.closest('.pk-app__body'), float = body.querySelector(':scope > .pk-float');
  const cvs = h('canvas'), cur = h('canvas'), ctx = cvs.getContext('2d'), cx = cur.getContext('2d'), pad = h('div.pk-draw__pad', { 'data-no-swipe': '' }, cvs, cur);
  let base = null, s = null, H = STEP; const strokes = [];
  const src = key && (inks.get(key) || await kvGet(key).catch(() => ''));
  if (src) { base = new Image(); base.src = src; await base.decode().catch(() => {}); H = Math.max(STEP, base.height + 300); }
  const size = () => { cvs.width = cur.width = W; cvs.height = cur.height = H; pad.style.aspectRatio = `${W} / ${H}`; };
  size(); base && ctx.drawImage(base, 0, 0);
  // 画到靠近底下就再接长一截（先把画好的抄下来，改了大小再贴回去）
  const grow = () => { const k = h('canvas', { width: W, height: H }); k.getContext('2d').drawImage(cvs, 0, 0); H += STEP; size(); ctx.drawImage(k, 0, 0); };
  const put = st => { ctx.globalAlpha = TOOLS[st[0]][2]; ctx.globalCompositeOperation = st[0] === 'erase' ? 'destination-out' : st[0] === 'mark' ? 'multiply' : 'source-over'; line(ctx, st); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; };
  const undo = h('button.pk-draw__undo', { 'aria-label': '撤销', disabled: true, onclick: () => { strokes.pop(); ctx.clearRect(0, 0, W, H); base && ctx.drawImage(base, 0, 0); strokes.forEach(put); undo.disabled = !strokes.length; } }, icon('undo', 22, 2.2));
  const at = e => { const b = pad.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
  // 正在画的这一笔先画在上面一层（整笔重画，荧光笔交叉的地方才不会一节一节变深），松手再落到画布上；橡皮直接擦
  const move = p => { s[2].push(p); if (p[1] > H - 260) grow(); if (s[0] === 'erase') return put([s[0], '', s[2].slice(-2)]); cx.clearRect(0, 0, W, H); line(cx, s); };
  let fingers = 0, y0 = 0;
  pad.addEventListener('pointerdown', e => { if (fingers > 1 || s) return; e.preventDefault(); pad.setPointerCapture(e.pointerId); s = [tool, ink(), []]; cur.style.opacity = TOOLS[tool][2]; move(at(e)); });
  pad.addEventListener('pointermove', e => s && fingers < 2 && move(at(e)));
  const up = () => { if (!s) return; cx.clearRect(0, 0, W, H); if (s[0] !== 'erase') put(s); strokes.push(s); s = null; undo.disabled = false; };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  // 两根手指：不画（第一根手指刚起的那一笔不算），整页跟着上下滑
  const mid = e => [...e.touches].reduce((a, t) => a + t.clientY, 0) / e.touches.length;
  pad.addEventListener('touchstart', e => { fingers = e.touches.length; if (fingers > 1) { if (s && s[0] !== 'erase') { s = null; cx.clearRect(0, 0, W, H); } y0 = mid(e); } }, { passive: true });
  pad.addEventListener('touchmove', e => { if (e.touches.length < 2) return; const y = mid(e); body.scrollTop -= y - y0; y0 = y; }, { passive: true });
  pad.addEventListener('touchend', e => { fingers = e.touches.length; }, { passive: true });
  // 底下一排：撤销、每支笔一根小笔杆（笔尖是现在的颜色，点中的往上冒一点）、颜色、完成
  const tools = Object.entries(TOOLS).map(([k, [label]]) => h('button.pk-draw__tool.is-' + k + (k === tool ? '.is-on' : ''), { 'aria-label': label, style: { '--ink': INK[k] }, onclick: () => { tool = k; tools.forEach(b => b.classList.toggle('is-on', b.classList.contains('is-' + k))); dot.style.setProperty('--ink', ink()); } }, h('i')));
  const dot = h('button.pk-draw__dot', { 'aria-label': '颜色', style: { '--ink': ink() }, onclick: () => { const k = INK[tool] ? tool : 'pen';
    sheet({ title: '颜色', content: h('div.as-mu-color', colorWheel(INK[k], c => { INK[k] = c; dot.style.setProperty('--ink', c); tools.find(b => b.classList.contains('is-' + k)).style.setProperty('--ink', c); })) }); } });
  const bar = h('div.pk-float.pk-draw__float', h('div.pk-glass.pk-draw__bar', undo, ...tools, dot, h('button.pk-draw__ok', { 'aria-label': '完成', onclick: () => finish() }, icon('check', 22, 2.6))),
    tip && h('button.pk-glass.is-round', { 'aria-label': '说明', onclick: () => dialog({ title: '画给 TA 看', text: tip, confirm: '知道了', cancel: '' }) }, icon('info', 22, 2)));
  // 画完：去掉底下空着的那截，换回成一张图（同一个地方），底下那排换回来；存进 kv 是后台的事，页面不等它
  const leave = page._onLeave;
  const finish = () => {
    page._onLeave = leave; bar.remove(); if (float) float.hidden = false;
    if (!strokes.length) { pad.replaceWith(key ? inkImg(key) : ''); return; }
    const d = ctx.getImageData(0, 0, W, H).data; let y = H - 1;
    while (y > 0 && !d.subarray(y * W * 4, (y + 1) * W * 4).some((v, i) => i % 4 === 3 && v)) y--;
    const out = h('canvas', { width: W, height: Math.min(H, y + 40) }); out.getContext('2d').drawImage(cvs, 0, 0);
    const k = key || 'memo-draw:' + uid('d'), url = out.toDataURL('image/png');
    inks.set(k, url); pad.replaceWith(inkImg(k)); onSave(k);
    kvSet(k, url).catch(e => toast('画没存上：' + e.message));
  };
  page._onLeave = () => { finish(); leave && leave(); };   // 画着画着点了返回：照样存好
  host.replaceWith(pad); if (float) float.hidden = true; body.append(bar);
  pad.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (tip) toast('画的会给共用的人看，聊天的模型要能识图才看得懂');
}
/** 给 AI 看的：透明底垫成白底（不然有的接口当成黑底，黑笔就看不见了），淡的笔画叠三遍描深一点（荧光笔太淡怕看不清），存成 jpg 小一点 */
export async function inkPic(key) {
  const im = new Image(); im.src = inks.get(key) || await kvGet(key); await im.decode();
  const c = h('canvas', { width: im.width, height: im.height }), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); for (let i = 0; i < 3; i++) x.drawImage(im, 0, 0); return c.toDataURL('image/jpeg', .85);
}
