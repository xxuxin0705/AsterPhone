// 立绘：一张标准立绘 + 几块「只改了一处」的小图（张嘴、闭眼、笑眼、生气眉…），叠在立绘上换着显示，就会眨眼、说话、换表情。
// 做法：让生图线照着立绘出变体，再在手机里比对两张图哪里不一样，把不一样的那一小块抠出来（存成小图 + 位置）。
// 存在 kv 的 pt:联系人 id 里：{ base, w, h, parts: { 名字: { src, box: [x, y, w, h] } } }
import { kvGet, kvSet, kvDel } from './store.js';

/** 能生成的表情：[名字, 叫什么, 用来干嘛, 提示词里要改的那一处, NAI 用的标签, NAI 重画哪一块（眼睛 / 嘴 / 整张脸）] */
export const PARTS = [
  ['mouthOpen', '张嘴', '说话', 'the MOUTH, open as if saying "ah": an open rounded mouth showing the dark inside and a little tongue, about one and a half times as wide as the base mouth, centred on the same point', 'open mouth', 'mouth'],
  ['eyesClosed', '闭眼', '眨眼', 'BOTH EYES, closed in a relaxed blink: each eye becomes a single soft downward-curving lash line in the same place and width as the open eye; no iris, no eye white', 'closed eyes', 'eyes'],
  ['mouthO', 'O 型嘴', '说话', 'the MOUTH, a small round "o" shape, centred on the same point as the base mouth', ':o, small open mouth', 'mouth'],
  ['eyesSmile', '笑眼', '笑', 'BOTH EYES become happy closed smiling eyes: each an upward-curving arc spanning the same width as the open eye, centred on the same point; no iris, no eye white', '^_^, closed eyes, happy', 'eyes'],
  ['browsAngry', '生气', '生气', 'BOTH EYEBROWS become angry: the inner end of each brow moves down toward the nose, the outer end stays, same thickness and colour', 'angry, v-shaped eyebrows', 'eyes'],
  ['browsTroubled', '为难', '为难', 'BOTH EYEBROWS become troubled: the inner end of each brow moves up, the outer end stays, same thickness and colour', 'worried, raised inner eyebrows', 'eyes'],
  ['blush', '脸红', '害羞', 'the CHEEKS: a clearly deeper pink blush inside both cheeks, soft edges, staying inside the face outline', 'blush', 'face'],
];
const STYLE = 'Clean cel shading with crisp thin linework, flat even frontal lighting, NO cast shadows, no paper grain, no glow. Plain pure white background. No text, no watermark, no border.';
/** 第一步：照参考图（或者照描述）画一张方便拆的标准立绘 */
export const basePrompt = (desc, withRef) => `${withRef ? 'The attached image is a reference for this character\'s identity and drawing style. Redraw THIS character (same face, hair, eye colour, clothing, palette and art style), leaving out any props, scenery and text.' : `Character: ${desc}`}
${withRef && desc ? `Notes: ${desc}\n` : ''}Framing: straight-on half-body view, head and body facing the viewer squarely, from just above the head down to the waist, centred, shoulders level, a clear empty white margin around the character. Tall portrait canvas.
The neck is clearly visible between chin and collar. Both eyebrows are fully visible, no hair crossing the eyes or eyebrows. Both arms hang relaxed at the sides; the character holds nothing.
Neutral expression: eyes open looking straight at the viewer, relaxed closed mouth with a faint smile, eyebrows level.
${STYLE}`;
/** NAI 认标签不认长句：照参考图画（角色参考）或者只按描述画 */
export const naiBase = desc => [desc, 'solo, upper body, front view, facing viewer, looking at viewer, standing straight, arms at sides, centered, white background, simple background, no text, neutral expression, closed mouth, light smile, flat lighting'].filter(Boolean).join(', ');
/** 几个框连成一个大框，再往外放大（px：按宽、py：按高；up：往上多放，眼睛框往上带上眉毛） */
const around = (p, bs, px, py, up = 0) => {
  const x = Math.min(...bs.map(b => b[0])), y = Math.min(...bs.map(b => b[1])), w = Math.max(...bs.map(b => b[0] + b[2])) - x, h = Math.max(...bs.map(b => b[1] + b[3])) - y;
  const x0 = Math.max(0, x - w * px), y0 = Math.max(0, y - h * (py + up));
  return [x0, y0, Math.min(p.w, x + w + w * px) - x0, Math.min(p.h, y + h + h * py) - y0].map(Math.round);
};
/** 立绘上框好的地方（p.boxes：左眼、右眼、嘴）。眼睛那块往上带上眉毛；整张脸 = 眼睛到嘴 */
export const hasBoxes = p => !!(p.boxes && p.boxes.eyeL);
export function areaOf(p, region) {
  const { eyeL, eyeR, mouth } = p.boxes;
  return region === 'eyes' ? around(p, [eyeL, eyeR], .15, .2, 1) : region === 'mouth' ? around(p, [mouth], .5, .6) : around(p, [eyeL, eyeR, mouth], .3, .5);
}

/** 不找 AI、在手机里画（照 RuiC-2D 的本地绘制）：先用四周的颜色把眼睛 / 嘴抹平，再画闭眼线、笑眼弧、嘴；脸红画两团粉。交出 { src, box } */
export const LOCAL = ['mouthOpen', 'eyesClosed', 'mouthO', 'eyesSmile', 'blush'];
export async function drawPart(p, k) {
  const c = canvas(p.w, p.h), x = c.getContext('2d', { willReadFrequently: true }), { eyeL, eyeR, mouth } = p.boxes;
  x.drawImage(await img(p.base), 0, 0, p.w, p.h);
  if (k === 'blush') for (const [ex, ey, ew, eh] of [eyeL, eyeR]) {
    const cx = ex + ew / 2, cy = ey + eh + (mouth[1] - ey - eh) * .55, r = ew * .5, g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,105,125,.5)'); g.addColorStop(1, 'rgba(255,105,125,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, r, r * .6, 0, 0, 7); x.fill();
  } else if (k.startsWith('eyes')) for (const b of [eyeL, eyeR]) {
    const ink = darkest(x, b), [bx, by, bw, bh] = b; smooth(x, b);
    x.strokeStyle = ink; x.lineWidth = Math.max(2, bw * .07); x.lineCap = 'round'; x.beginPath();
    for (let i = 0; i <= 30; i++) { const u = i / 30, s = Math.sin(u * Math.PI); x.lineTo(bx + bw * u, k === 'eyesSmile' ? by + bh * .65 - s * bh * .35 : by + bh * .55 + s * bh * .12); }
    x.stroke();
  } else {
    const [mx, my, mw, mh] = mouth, cx = mx + mw / 2, cy = my + mh / 2, R = mw * .34, rx = k === 'mouthO' ? R * .62 : R, ry = (k === 'mouthO' ? .51 : .48) * R;
    smooth(x, mouth);
    x.fillStyle = 'rgb(104,42,49)'; x.strokeStyle = 'rgb(155,70,76)'; x.lineWidth = 1; x.beginPath(); x.ellipse(cx, cy + ry * .55, rx, ry, 0, 0, 7); x.fill(); x.stroke();
    x.fillStyle = 'rgb(224,121,134)'; x.beginPath(); x.ellipse(cx, cy + ry * 1.05, rx * .65, ry * .4, 0, 0, 7); x.fill();
  }
  const a = areaOf(p, k === 'blush' ? 'face' : k.startsWith('eyes') ? 'eyes' : 'mouth'), o = canvas(a[2], a[3]);
  o.getContext('2d').drawImage(c, a[0], a[1], a[2], a[3], 0, 0, a[2], a[3]);
  return { src: o.toDataURL('image/png'), box: a };
}
/** 框里最深的颜色（睫毛的颜色） */
function darkest(x, [bx, by, bw, bh]) {
  const d = x.getImageData(bx, by, bw, bh).data; let m = 999, o = 0;
  for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; if (d[i + 3] > 200 && v < m) { m = v; o = i; } }
  return `rgb(${d[o]},${d[o + 1]},${d[o + 2]})`;
}
/** 抹平：框外接的椭圆里，用四周的颜色一圈圈往里渗（反复取上下左右的平均），像把原来的五官擦掉 */
function smooth(x, [bx, by, bw, bh]) {
  const X = Math.max(0, Math.floor(bx - bw * .3)), Y = Math.max(0, Math.floor(by - bh * .3)), W = Math.ceil(bw * 1.6), H = Math.ceil(bh * 1.6);
  const d = x.getImageData(X, Y, W, H), a = d.data, cx = bx + bw / 2 - X, cy = by + bh / 2 - Y, rx = bw * .62, ry = bh * .62, inn = [], sum = [0, 0, 0, 0];
  let n = 0;
  for (let y = 1; y < H - 1; y++) for (let x0 = 1; x0 < W - 1; x0++) { const q = ((x0 - cx) / rx) ** 2 + ((y - cy) / ry) ** 2, i = (y * W + x0) * 4;
    if (q < 1) inn.push(i); else if (q < 1.3) { for (let c = 0; c < 4; c++) sum[c] += a[i + c]; n++; } }
  for (const i of inn) for (let c = 0; c < 4; c++) a[i + c] = sum[c] / n;
  for (let it = 0; it < 80; it++) for (const i of inn) for (let c = 0; c < 4; c++) a[i + c] = (a[i + c - 4] + a[i + c + 4] + a[i + c - W * 4] + a[i + c + W * 4]) / 4;
  x.putImageData(d, X, Y);
}
/** 要重画的地方白、别处黑 */
export function maskOf(p, a) { const c = canvas(p.w, p.h), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, p.w, p.h); x.fillStyle = '#fff'; x.fillRect(...a); return c.toDataURL('image/png'); }
/** 第二步：以立绘为底，只改一处 */
export const partPrompt = change => `This is a LAYER VARIANT of the attached base image, not a new illustration. Identical camera, identical crop, identical character scale, identical pixel position: the head, hair, shoulders and torso must land on exactly the same pixels as the base. Do not re-frame, zoom, recentre, change the pose or redraw anything that is not part of the change.
Change exactly ONE thing: ${change}.
Everything else is identical to the base.
Match the base exactly: same shading, same linework, same colours. ${STYLE}`;

const cache = new Map();
export async function load(id) { if (!cache.has(id)) cache.set(id, (await kvGet('pt:' + id).catch(() => null)) || null); return cache.get(id); }
export const loaded = id => cache.get(id) || null;
export async function save(id, p) { cache.set(id, p); await kvSet('pt:' + id, p); }
export async function drop(id) { cache.set(id, null); await kvDel('pt:' + id); }
export const preload = ids => Promise.all(ids.map(load));

const img = src => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => no(new Error('图片读不出来')); i.src = src; });
const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
/** 立绘存成 PNG（最长边 1024）；生图回来的链接读不出来（对方不让网页读）就报错 */
export async function toBase(src) {
  const i = await img(src), k = Math.min(1, 1024 / Math.max(i.naturalWidth, i.naturalHeight)), c = canvas(Math.round(i.naturalWidth * k), Math.round(i.naturalHeight * k));
  c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
  try { return { base: c.toDataURL('image/png'), w: c.width, h: c.height, parts: {} }; } catch (e) { throw new Error('这家生图回来的图手机读不了，换一家试试'); }
}

/** 去掉白底：从四边往里找连着的白色，变成透明（颜色留着，比对时垫回白底） */
export function clearBg(p) {
  const c = canvas(p.w, p.h), x = c.getContext('2d', { willReadFrequently: true }), i = new Image();
  return new Promise((ok, no) => { i.onload = ok; i.onerror = no; i.src = p.base; }).then(() => {
    x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, p.w, p.h), a = d.data, W = p.w, H = p.h, seen = new Uint8Array(W * H), st = [];
    const white = k => a[k * 4] > 235 && a[k * 4 + 1] > 235 && a[k * 4 + 2] > 235;
    for (let x0 = 0; x0 < W; x0++) st.push(x0, (H - 1) * W + x0); for (let y0 = 0; y0 < H; y0++) st.push(y0 * W, y0 * W + W - 1);
    while (st.length) { const k = st.pop(); if (seen[k] || !white(k)) continue; seen[k] = 1; a[k * 4 + 3] = 0; const px = k % W;
      if (px > 0) st.push(k - 1); if (px < W - 1) st.push(k + 1); if (k >= W) st.push(k - W); if (k < W * (H - 1)) st.push(k + W); }
    x.putImageData(d, 0, 0); return { ...p, base: c.toDataURL('image/png') };
  });
}

/** 比对立绘和变体：找出变了的那几块（两只眼睛是两块），取最大的和差不多大的，抠出来，边缘羽化。变得太多（整张图挪了位置）就算失败。
 *  area：只看这一块（NAI 局部重绘时，框外就算有一点点差别也不算） */
export async function cut(p, src, area) {
  const [b, v] = await Promise.all([img(p.base), img(src)]), W = p.w, H = p.h;
  const read = i => { const c = canvas(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(i, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
  let A, B; try { A = read(b); B = read(v); } catch (e) { throw new Error('这家生图回来的图手机读不了，换一家试试'); }
  // 粗格子（4px 一格）里数变了的像素
  const S = 4, gw = Math.ceil(W / S), gh = Math.ceil(H / S), g = new Uint8Array(gw * gh);
  const [ax, ay, aw, ah] = area || [0, 0, W, H];
  for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) { const i = (y * W + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 90) g[(y / S | 0) * gw + (x / S | 0)]++; }
  const on = new Uint8Array(gw * gh); for (let i = 0; i < on.length; i++) on[i] = g[i] >= 4 ? 1 : 0;
  // 连成片
  const seen = new Int32Array(gw * gh).fill(-1), blobs = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i] >= 0) continue;
    const st = [i], bl = { n: 0, x0: gw, y0: gh, x1: 0, y1: 0 }; seen[i] = blobs.length;
    while (st.length) { const j = st.pop(), x = j % gw, y = j / gw | 0; bl.n++; bl.x0 = Math.min(bl.x0, x); bl.y0 = Math.min(bl.y0, y); bl.x1 = Math.max(bl.x1, x); bl.y1 = Math.max(bl.y1, y);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy, k = ny * gw + nx; if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && on[k] && seen[k] < 0) { seen[k] = blobs.length; st.push(k); } } }
    blobs.push(bl);
  }
  if (!blobs.length) throw new Error('这张和立绘看不出差别');
  const big = Math.max(...blobs.map(x => x.n)), keep = blobs.filter(x => x.n >= big * .3 && x.n >= 6);
  const pad = 3, x0 = Math.max(0, (Math.min(...keep.map(k => k.x0)) - pad) * S), y0 = Math.max(0, (Math.min(...keep.map(k => k.y0)) - pad) * S);
  const x1 = Math.min(W, (Math.max(...keep.map(k => k.x1)) + pad + 1) * S), y1 = Math.min(H, (Math.max(...keep.map(k => k.y1)) + pad + 1) * S), w = x1 - x0, h = y1 - y0;
  if (w * h > W * H * .18) throw new Error('这张没对齐（整张图都变了），重画一次');
  // 抠：变了的地方不透明，往外一圈慢慢变淡
  const m = canvas(w, h), mx = m.getContext('2d'), md = mx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * W + x + x0) * 4, o = (y * w + x) * 4, d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    md.data[o + 3] = d > 40 ? 255 : 0; }
  mx.putImageData(md, 0, 0);
  // 糊开再把透明度放大四倍 = 往外扩一圈再羽化（不扩的话，原来的眼睛边会从羽化的地方透出来一圈影子）
  const f = canvas(w, h), fx = f.getContext('2d', { willReadFrequently: true }); fx.filter = 'blur(4px)'; fx.drawImage(m, 0, 0);
  const fd = fx.getImageData(0, 0, w, h); for (let i = 3; i < fd.data.length; i += 4) fd.data[i] = Math.min(255, fd.data[i] * 4); fx.putImageData(fd, 0, 0);
  const out = canvas(w, h), ox = out.getContext('2d'); ox.drawImage(f, 0, 0); ox.globalCompositeOperation = 'source-in'; ox.drawImage(v, x0 * v.naturalWidth / W, y0 * v.naturalHeight / H, w * v.naturalWidth / W, h * v.naturalHeight / H, 0, 0, w, h);
  return { src: out.toDataURL('image/png'), box: [x0, y0, w, h] };
}

/** 一个会动的立绘（没有立绘返回 null）。返回的元素上有 .pt：talk(true / false) 说话、face('smile' / 'angry' / 'troubled' / 'shy' / '') 换表情、peek(名字) 亮一下某个表情 */
const FACE = { smile: ['eyesSmile'], angry: ['browsAngry'], troubled: ['browsTroubled'], shy: ['blush'] };
export function figure(id) {
  const p = loaded(id); if (!p) return null;
  const el = document.createElement('div'); el.className = 'as-pt'; el.style.aspectRatio = `${p.w} / ${p.h}`;
  const lay = src => { const i = new Image(); i.src = src; i.alt = ''; i.draggable = false; el.append(i); return i; };
  lay(p.base);
  const parts = {};
  for (const [k, x] of Object.entries(p.parts)) { const i = lay(x.src); i.className = 'as-pt__part'; Object.assign(i.style, { left: x.box[0] / p.w * 100 + '%', top: x.box[1] / p.h * 100 + '%', width: x.box[2] / p.w * 100 + '%', height: x.box[3] / p.h * 100 + '%' }); parts[k] = i; }
  const show = (k, on) => parts[k] && parts[k].classList.toggle('is-on', on);
  let face = '', talking = 0, mouth = 0;
  // 眨眼：每 2.5～6 秒一下；笑眼的时候不眨
  const blink = () => { if (!el.isConnected && el._born) return; el._born = 1; if (parts.eyesClosed && !FACE[face]?.includes('eyesSmile')) { show('eyesClosed', true); setTimeout(() => show('eyesClosed', false), 130); } setTimeout(blink, 2500 + Math.random() * 3500); };
  setTimeout(blink, 1200);
  el.pt = {
    face(f) { (FACE[face] || []).forEach(k => show(k, false)); face = FACE[f] ? f : ''; (FACE[face] || []).forEach(k => show(k, true)); },
    // 说话：嘴在张嘴 / O 嘴 / 闭着之间换（没做嘴型就不动）
    talk(on) { clearInterval(talking); show('mouthOpen', false); show('mouthO', false); if (!on || !(parts.mouthOpen || parts.mouthO)) return;
      talking = setInterval(() => { if (!el.isConnected) { clearInterval(talking); return; } mouth = (mouth + 1 + (Math.random() < .3)) % 3; show('mouthOpen', mouth === 1 || (mouth === 2 && !parts.mouthO)); show('mouthO', mouth === 2 && !!parts.mouthO); }, 120); },
    has: k => !!parts[k],
    peek(k) { show(k, true); setTimeout(() => show(k, false), 1200); },
  };
  return el;
}
