// 备忘录里画画（照 iPhone）：上面是这条的字，下面一块画布；底下一排笔（钢笔、细笔、荧光笔、橡皮）和颜色，顶上撤销、完成。
// 画好的存成一张透明底的 png，单独放在 kv 的 memo-draw:编号 里（图大，不跟备忘录的字一起存，免得每次保存都写一遍）；这条备忘录第九格记编号
import { h, uid } from '../../core/util.js';
import { kvGet, kvSet } from '../../core/store.js';
import { icon, sheet, colorWheel, toast, dialog } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { iosPage, inks } from '../peek/apps.js';

const TOOLS = { pen: ['钢笔', 3, 1], fine: ['细笔', 1.5, 1], mark: ['荧光笔', 18, .35], erase: ['橡皮', 22, 1] }, W = 786, H = 1040;
// 每支笔记着自己的颜色（荧光笔默认黄的），橡皮没有颜色
let tool = 'pen'; const INK = { pen: '#000000', fine: '#000000', mark: '#ffcc00' }, ink = () => INK[tool] || INK.pen;
const line = (c, [k, col, pts]) => { c.lineCap = c.lineJoin = 'round'; c.lineWidth = TOOLS[k][1] * 2; c.strokeStyle = col; c.beginPath(); c.moveTo(...pts[0]); pts.forEach(p => c.lineTo(...p)); c.stroke(); };

/** 画 r 这一条；lines 是摆在上面的字，done() 是存好以后要做的（改日期、重画开着的页） */
export async function draw(r, lines, done) {
  const { el, body } = iosPage('memo', 'memo-draw', '.pk-nt.is-doc.pk-draw'), off = el._onLeave, shared = r[0] === '共用';
  // 共用的备忘录：画的下次和 TA 私聊时跟着给 TA 看（engine.js 的 requestReply）
  const tip = `下次和 ${r[3]} 私聊时，这张画会一起给 TA 看（看过就不再带，改了再给 TA 看）。聊天的模型要能识图，比如 Gemini、Claude、GPT-4o；走「酒馆」连接的带不了图。`;
  const cvs = h('canvas'), cur = h('canvas'), ctx = cvs.getContext('2d'), cx = cur.getContext('2d'), pad = h('div.pk-draw__pad', { 'data-no-swipe': '' }, cvs, cur);
  cvs.width = cur.width = W; cvs.height = cur.height = H;
  // 以前画的当底图；这次画的每一笔记成 [笔, 颜色, 点…]，撤销就去掉最后一笔、从底图起重画
  let base = null, s = null; const strokes = [];
  const src = r[8] && (inks.get(r[8]) || await kvGet(r[8]).catch(() => ''));
  if (src) { base = new Image(); base.src = src; await base.decode().catch(() => {}); ctx.drawImage(base, 0, 0, W, H); }
  const put = st => { ctx.globalAlpha = TOOLS[st[0]][2]; ctx.globalCompositeOperation = st[0] === 'erase' ? 'destination-out' : st[0] === 'mark' ? 'multiply' : 'source-over'; line(ctx, st); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; };
  const undoBtn = h('button.pk-glass.is-round', { 'aria-label': '撤销', disabled: true, onclick: () => { strokes.pop(); ctx.clearRect(0, 0, W, H); base && ctx.drawImage(base, 0, 0, W, H); strokes.forEach(put); undoBtn.disabled = !strokes.length; } }, icon('undo', 22, 2.2));
  const at = e => { const b = pad.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
  // 正在画的这一笔先画在上面一层（整笔重画，荧光笔交叉的地方才不会一节一节变深），松手再落到画布上；橡皮直接擦
  const move = p => { s[2].push(p); if (s[0] === 'erase') return put([s[0], '', s[2].slice(-2)]); cx.clearRect(0, 0, W, H); line(cx, s); };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); s = [tool, ink(), []]; cur.style.opacity = TOOLS[tool][2]; move(at(e)); });
  pad.addEventListener('pointermove', e => s && move(at(e)));
  const up = () => { if (!s) return; cx.clearRect(0, 0, W, H); s[0] !== 'erase' && put(s); strokes.push(s); s = null; undoBtn.disabled = false; };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  // 底下一排：每支笔一根小笔杆，笔尖是现在的颜色；点中的那支往上冒一点
  const tools = Object.entries(TOOLS).map(([k, [label]]) => h('button.pk-draw__tool.is-' + k + (k === tool ? '.is-on' : ''), { 'aria-label': label, style: { '--ink': INK[k] }, onclick: () => { tool = k; tools.forEach(b => b.classList.toggle('is-on', b.classList.contains('is-' + k))); dot.style.setProperty('--ink', ink()); } }, h('i')));
  const dot = h('button.pk-draw__dot', { 'aria-label': '颜色', style: { '--ink': ink() }, onclick: () => { const k = INK[tool] ? tool : 'pen';
    sheet({ title: '颜色', content: h('div.as-mu-color', colorWheel(INK[k], c => { INK[k] = c; dot.style.setProperty('--ink', c); tools.find(b => b.classList.contains('is-' + k)).style.setProperty('--ink', c); })) }); } });
  el._onLeave = async () => { off(); if (!strokes.length) return;
    const key = r[8] || 'memo-draw:' + uid('d'), url = cvs.toDataURL('image/png');
    try { await kvSet(key, url); } catch (e) { return toast('画没存上：' + e.message); }
    inks.set(key, url); r[8] = key; const im = new Image(); im.src = url; await im.decode().catch(() => {}); done(); };   // 先解好码再重画下面那页，不空一下
  body.append(h('div.pk-top2', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: () => nav.back() }, icon('back', 24, 2.4)), h('div.pk-nt__r', undoBtn, h('button.pk-glass.is-round', { 'aria-label': '完成', onclick: () => nav.back() }, icon('check', 22, 2.6)))),
    r[1] ? h('h1', r[1]) : null, h('div.pk-nt__lines', lines.map(x => h('p', x))), pad,
    h('div.pk-float', h('div.pk-glass.pk-draw__bar', ...tools, dot), shared && h('button.pk-glass.is-round', { 'aria-label': '说明', onclick: () => dialog({ title: '画给 TA 看', text: tip, confirm: '知道了', cancel: '' }) }, icon('info', 22, 2))));
  nav.push(el);
  if (shared) toast(`画的会给 ${r[3]} 看，聊天的模型要能识图才看得懂`);
}
/** 给 AI 看的：透明底垫成白底（不然有的接口当成黑底，黑笔就看不见了），存成 jpg 小一点 */
export async function inkPic(key) {
  const im = new Image(); im.src = inks.get(key) || await kvGet(key); await im.decode();
  const c = h('canvas', { width: im.width, height: im.height }), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); return c.toDataURL('image/jpeg', .85);
}
