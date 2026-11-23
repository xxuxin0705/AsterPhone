// 备忘录里画画（照 iPhone）：就在这一条里画，不另开一页。点笔，字下面接着出一块画布（点已经画好的那张就是接着改那张），
// 底下换成一排笔（钢笔、细笔、荧光笔、橡皮）、颜色、撤销、完成；越往下画画布越长。一根手指画，两根手指上下滑。
// 画好的存成一张透明底的 png，单独放在 kv 的 memo-draw:编号 里（图大，不跟备忘录的字一起存）；正文里是单独一行「✎编号」，和字一样按先后排
import { h, uid } from '../../core/util.js';
import { kvGet, kvSet, state, commit } from '../../core/store.js';
import { icon, sheet, colorWheel, toast, dialog } from '../../core/ui.js';
import { inks, inkImg, flipBlack, blackish } from '../peek/apps.js';

const TOOLS = { pen: ['钢笔', 3, 1], fine: ['细笔', 1.5, 1], mark: ['荧光笔', 18, .35], erase: ['橡皮', 22, 1], lasso: ['套索', 1, 1] }, W = 786, STEP = 900;
// 每支笔记着自己的颜色（荧光笔默认黄的），橡皮没有颜色
let tool = 'pen'; const INK = { pen: '#000000', fine: '#000000', mark: '#ffcc00' }, ink = () => INK[tool] || INK.pen;
// 一笔（或套索的删掉 / 复制）落到 c 上；col 换颜色用（夜里回放时黑色画成白色）
const clip = pts => { const p = new Path2D(); p.moveTo(...pts[0]); pts.forEach(q => p.lineTo(...q)); p.closePath(); return p; };
const paint = (c, st, col = v => v) => { const w = c.canvas.width, hh = c.canvas.height;
  if (st[0] === 'cut') { c.save(); c.clip(clip(st[1])); c.clearRect(0, 0, w, hh); c.restore(); return; }
  if (st[0] === 'copy') { const k = h('canvas', { width: w, height: hh }), x = k.getContext('2d'); x.clip(clip(st[1])); x.drawImage(c.canvas, 0, 0); c.drawImage(k, st[2], st[3]); return; }
  c.globalAlpha = TOOLS[st[0]][2]; c.globalCompositeOperation = st[0] === 'erase' ? 'destination-out' : st[0] === 'mark' ? 'multiply' : 'source-over'; line(c, [st[0], col(st[1]), st[2]]); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; };
const line = (c, [k, col, pts]) => { c.lineCap = c.lineJoin = 'round'; c.lineWidth = TOOLS[k][1] * 2; c.strokeStyle = col; c.beginPath(); c.moveTo(...pts[0]); pts.forEach(p => c.lineTo(...p)); c.stroke(); };

/** 在 host 那里画（host 是已经画好的那张图，或者新放的一个空位）；key 是改哪张（新画的空着）；
 *  tip 是共用时点 ⓘ 看的那句；onSave(编号) 在画完时同步调用（还没画一笔就点完成的不调） */
export async function startDraw({ host, key = '', tip = '', onSave }) {
  const page = host.closest('.as-page'), body = host.closest('.pk-app__body'), float = body.querySelector(':scope > .pk-float');
  // cvs 是真正存下来的那张（不放进页面）；view 是给你看的：夜里把黑色看成白色，别的颜色照原样
  const cvs = h('canvas'), view = h('canvas'), cur = h('canvas'), ctx = cvs.getContext('2d', { willReadFrequently: true }), vx = view.getContext('2d'), cx = cur.getContext('2d'), pad = h('div.pk-draw__pad', { 'data-no-swipe': '' }, view, cur);
  const night = () => !!pad.closest('.is-dark'), see = c => (night() && blackish(c) ? '#ffffff' : c);
  const show = (x = 0, y = 0, w = W, hh = H) => { x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y)); w = Math.min(W - x, Math.ceil(w)); hh = Math.min(H - y, Math.ceil(hh)); if (w < 1 || hh < 1) return;
    const d = ctx.getImageData(x, y, w, hh); if (night()) flipBlack(d.data); vx.putImageData(d, x, y); };
  let base = null, s = null, H = STEP; const strokes = [];
  const src = key && (inks.get(key) || await kvGet(key).catch(() => ''));
  // 每一笔另存一份（编号后面加 :s），点画角上的 ▶ 能照着一笔一笔放出来；以前画的没存过的就不存了（放不出前面那些）
  const prev = key ? await kvGet(key + ':s').catch(() => null) : [];
  if (src) { base = new Image(); base.src = src; await base.decode().catch(() => {}); H = Math.max(STEP, base.height + 300); }
  const size = () => { cvs.width = view.width = cur.width = W; cvs.height = view.height = cur.height = H; pad.style.aspectRatio = `${W} / ${H}`; };
  size(); base && ctx.drawImage(base, 0, 0);
  // 画到靠近底下就再接长一截（先把画好的抄下来，改了大小再贴回去）
  const grow = () => { const k = h('canvas', { width: W, height: H }); k.getContext('2d').drawImage(cvs, 0, 0); H += STEP; size(); ctx.drawImage(k, 0, 0); show(); };
  // 套索圈出的那块：clip 是圈的形状，piece 把画布上圈里的抄成一张（复制用）；删除、复制都当一笔记进 strokes，撤销照样一步步退
  const piece = (pts, from = cvs) => { const k = h('canvas', { width: W, height: H }), x = k.getContext('2d'); x.clip(clip(pts)); x.drawImage(from, 0, 0); return k; };
  const put = st => { paint(ctx, st); if (st[0] === 'cut' || st[0] === 'copy') return show();
    const xs = st[2].map(p => p[0]), ys = st[2].map(p => p[1]), r = TOOLS[st[0]][1] + 2; show(Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) - Math.min(...xs) + 2 * r, Math.max(...ys) - Math.min(...ys) + 2 * r); };
  const undo = h('button.pk-draw__undo', { 'aria-label': '撤销', disabled: true, onclick: () => { sel = null; menu.hidden = true; ants(); strokes.pop(); ctx.clearRect(0, 0, W, H); base && ctx.drawImage(base, 0, 0); strokes.forEach(put); show(); undo.disabled = !strokes.length; } }, icon('undo', 22, 2.2));
  const at = e => { const b = pad.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H]; };
  // 正在画的这一笔先画在上面一层（整笔重画，荧光笔交叉的地方才不会一节一节变深），松手再落到画布上；橡皮直接擦
  const move = p => { s[2].push(p); if (p[1] > H - 260) grow(); if (s[0] === 'erase') return put([s[0], '', s[2].slice(-2)]); cx.clearRect(0, 0, W, H); line(cx, [s[0], see(s[1]), s[2]]); };
  // 套索：圈的时候上面一层画蓝色虚线；松手出「复制 | 删除」；复制出来的那块挪开一点，按住拖到想放的地方，点别处（或换笔、完成）才落下
  let sel = null, drag = null;
  const ants = () => { cx.clearRect(0, 0, W, H); if (!sel) return; if (sel.img) cx.drawImage(sel.see, sel.dx, sel.dy);
    cx.save(); cx.translate(sel.dx, sel.dy); cx.setLineDash([10, 8]); cx.lineWidth = 3; cx.strokeStyle = '#0a84ff'; cx.stroke(clip(sel.pts)); cx.restore(); };
  const act = (label, fn) => h('button', { onclick: e => { e.stopPropagation(); fn(); } }, label);
  const add = st => { put(st); strokes.push(st); undo.disabled = false; };
  const drop = () => { if (sel?.img) add(['copy', sel.pts, sel.dx, sel.dy]); sel = null; menu.hidden = true; ants(); };
  const menu = h('div.pk-draw__sel', { hidden: true }, act('复制', () => { sel.img = piece(sel.pts); sel.see = piece(sel.pts, view); sel.dx = sel.dy = 30; menu.hidden = true; ants(); }), act('删除', () => { add(['cut', sel.pts]); sel = null; menu.hidden = true; ants(); }));
  const lassoUp = () => { const P = s[2], xs = P.map(p => p[0]), ys = P.map(p => p[1]); s = null;
    if (P.length < 5 || Math.max(...xs) - Math.min(...xs) < 12 || Math.max(...ys) - Math.min(...ys) < 12) return ants();
    sel = { pts: P, dx: 0, dy: 0 }; ants(); const low = Math.min(...ys) < 90;   // 圈在最上面：菜单放到圈的下面，不盖住上面的字
    Object.assign(menu.style, { left: (Math.min(...xs) + Math.max(...xs)) / 2 / W * 100 + '%', top: (low ? Math.max(...ys) + 12 : Math.min(...ys) - 12) / H * 100 + '%' }); menu.classList.toggle('is-low', low); menu.hidden = false; };
  let fingers = 0, y0 = 0;
  pad.addEventListener('pointerdown', e => { if (fingers > 1 || s || menu.contains(e.target)) return; e.preventDefault(); pad.setPointerCapture(e.pointerId); const p = at(e);
    if (tool === 'lasso') { if (sel?.img && cx.isPointInPath(clip(sel.pts), p[0] - sel.dx, p[1] - sel.dy)) { drag = p; return; } drop(); s = ['lasso', '', [p]]; cur.style.opacity = 1; return; }
    drop(); s = [tool, ink(), []]; cur.style.opacity = TOOLS[tool][2]; move(p); });
  pad.addEventListener('pointermove', e => { if (fingers > 1) return; const p = at(e);
    if (drag) { sel.dx += p[0] - drag[0]; sel.dy += p[1] - drag[1]; drag = p; return ants(); }
    if (s?.[0] === 'lasso') { s[2].push(p); cx.clearRect(0, 0, W, H); cx.setLineDash([10, 8]); cx.lineWidth = 3; cx.strokeStyle = '#0a84ff'; cx.stroke(clip(s[2])); cx.setLineDash([]); return; }
    s && move(p); });
  const up = () => { drag = null; if (!s) return; if (s[0] === 'lasso') return lassoUp(); cx.clearRect(0, 0, W, H); if (s[0] !== 'erase') put(s); strokes.push(s); s = null; undo.disabled = false; };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  // 两根手指：不画（第一根手指刚起的那一笔不算），整页跟着上下滑
  const mid = e => [...e.touches].reduce((a, t) => a + t.clientY, 0) / e.touches.length;
  pad.addEventListener('touchstart', e => { fingers = e.touches.length; if (fingers > 1) { drag = null; if (s && s[0] !== 'erase') { s = null; ants(); } y0 = mid(e); } }, { passive: true });
  pad.addEventListener('touchmove', e => { if (e.touches.length < 2) return; const y = mid(e); body.scrollTop -= y - y0; y0 = y; }, { passive: true });
  pad.addEventListener('touchend', e => { fingers = e.touches.length; }, { passive: true });
  // 底下一排：撤销、每支笔一根小笔杆（笔尖是现在的颜色，点中的往上冒一点）、颜色、完成
  const tools = Object.entries(TOOLS).map(([k, [label]]) => h('button.pk-draw__tool.is-' + k + (k === tool ? '.is-on' : ''), { 'aria-label': label, style: { '--ink': INK[k] }, onclick: () => { drop(); tool = k; tools.forEach(b => b.classList.toggle('is-on', b.classList.contains('is-' + k))); dot.style.setProperty('--ink', ink()); } }, h('i')));
  const dot = h('button.pk-draw__dot', { 'aria-label': '颜色', style: { '--ink': ink() }, onclick: () => { const k = INK[tool] ? tool : 'pen';
    sheet({ title: '颜色', content: h('div.as-mu-color', colorWheel(INK[k], c => { INK[k] = c; dot.style.setProperty('--ink', c); tools.find(b => b.classList.contains('is-' + k)).style.setProperty('--ink', c); })) }); } });
  const bar = h('div.pk-float.pk-draw__float', h('div.pk-glass.pk-draw__bar', undo, ...tools, dot, h('button.pk-draw__ok', { 'aria-label': '完成', onclick: () => finish() }, icon('check', 22, 2.6))),
    tip && h('button.pk-glass.is-round', { 'aria-label': '说明', onclick: () => dialog({ title: '画给 TA 看', text: tip, confirm: '知道了', cancel: '' }) }, icon('info', 22, 2)));
  // 画完：去掉底下空着的那截，换回成一张图（同一个地方），底下那排换回来；存进 kv 是后台的事，页面不等它
  const leave = page._onLeave;
  const finish = () => { drop();
    page._onLeave = leave; bar.remove(); if (float) float.hidden = false;
    if (!strokes.length) { pad.replaceWith(key ? inkImg(key) : ''); return; }
    const d = ctx.getImageData(0, 0, W, H).data; let y = H - 1;
    while (y > 0 && !d.subarray(y * W * 4, (y + 1) * W * 4).some((v, i) => i % 4 === 3 && v)) y--;
    const out = h('canvas', { width: W, height: Math.min(H, y + 40) }); out.getContext('2d').drawImage(cvs, 0, 0);
    const k = key || 'memo-draw:' + uid('d'), url = out.toDataURL('image/png');
    inks.set(k, url); pad.replaceWith(inkImg(k)); onSave(k);
    kvSet(k, url).catch(e => toast('画没存上：' + e.message));
    const n = v => Math.round(v), P = L => L.map(p => p.map(n));
    if (prev) kvSet(k + ':s', [...prev, ...strokes.map(st => (st[0] === 'cut' ? [st[0], P(st[1])] : st[0] === 'copy' ? [st[0], P(st[1]), n(st[2]), n(st[3])] : [st[0], st[1], P(st[2])]))]).catch(() => {});
  };
  page._onLeave = () => { finish(); leave && leave(); };   // 画着画着点了返回：照样存好
  host.replaceWith(pad); show(); if (float) float.hidden = true; body.append(bar);
  pad.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  pad.append(menu);
  const vision = () => tip && toast('画的会给共用的人看，聊天的模型要能识图才看得懂');
  if (!state.settings.drawTip) { state.settings.drawTip = 1; commit('settings'); toast('一根手指画，两根手指上下滑'); setTimeout(vision, 2600); } else vision();
}
/** 给 AI 看的：透明底垫成白底（不然有的接口当成黑底，黑笔就看不见了），淡的笔画叠三遍描深一点（荧光笔太淡怕看不清），存成 jpg 小一点 */
export async function inkPic(key) {
  const im = new Image(); im.src = inks.get(key) || await kvGet(key); await im.decode();
  const c = h('canvas', { width: im.width, height: im.height }), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); for (let i = 0; i < 3; i++) x.drawImage(im, 0, 0); return c.toDataURL('image/jpeg', .85);
}
/** 给看不了图的模型：先裁掉四周空白，再压成一格一格的字（# 是有线的地方，. 是空白），最宽 48 格，太长的格子放大，最多 64 行 */
export async function inkGrid(key) {
  const im = new Image(); im.src = inks.get(key) || await kvGet(key); await im.decode();
  const w = im.width, c = h('canvas', { width: w, height: im.height }), x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, w, im.height).data, on = (X, Y) => d[(Y * w + X) * 4 + 3] > 40; let l = w, t = im.height, r = -1, b = -1;
  for (let Y = 0; Y < im.height; Y++) for (let X = 0; X < w; X++) if (on(X, Y)) { l = Math.min(l, X); r = Math.max(r, X); t = Math.min(t, Y); b = Math.max(b, Y); }
  if (r < 0) return '';
  const cell = Math.max((r - l + 1) / 48, (b - t + 1) / 64), cols = Math.ceil((r - l + 1) / cell), rows = Math.ceil((b - t + 1) / cell), out = [];
  for (let i = 0; i < rows; i++) { let s = ''; for (let j = 0; j < cols; j++) { let hit = false;
      for (let Y = Math.floor(t + i * cell); !hit && Y < Math.min(b + 1, t + (i + 1) * cell); Y++) for (let X = Math.floor(l + j * cell); !hit && X < Math.min(r + 1, l + (j + 1) * cell); X++) hit = on(X, Y);
      s += hit ? '#' : '.'; } out.push(s); }
  return `（这个模型看不了图，画压成了 ${cols} 列 × ${rows} 行的格子：# 是有线的地方，. 是空白。照整体的形状去认，别只看单个点）\n${out.join('\n')}`;
}
/** 回放你画的：和 TA 的画一样快（笔画越多每一笔越快，一张画四五秒画完）。c 是盖在图上的那张画布 */
export function replay(c, log, night) {
  const x = c.getContext('2d'), col = v => (night && blackish(v) ? '#ffffff' : v), per = Math.min(500, 4500 / log.length); let t = 0;
  const plan = log.map(st => { const P = st[0] === 'cut' || st[0] === 'copy' ? null : st[2], len = P ? P.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0), 0) * 400 / W : 0;
    const d = per * (P ? .6 + Math.min(1, len / 800) : .5), at = t; t += d * .8; return [st, at, d]; }), end = Math.max(...plan.map(([, at, d]) => at + d));
  return new Promise(ok => { const t0 = performance.now(), frame = now => { const T = now - t0; x.clearRect(0, 0, c.width, c.height);
    for (const [st, at, d] of plan) { if (T < at) break; const f = Math.min(1, (T - at) / d);
      if (st.length === 3) paint(x, [st[0], st[1], st[2].slice(0, Math.max(2, Math.ceil(st[2].length * f)))], col); else if (f === 1) paint(x, st, col); }
    if (T < end) requestAnimationFrame(frame); else ok(); }; requestAnimationFrame(frame); });
}

