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
  ['eyesCry', '哭', '伤心', 'BOTH EYES closed and crying: each eye a downward-curving closed lash line with a small teardrop at the inner lower corner and one falling drop', 'closed eyes, crying, tears', 'eyes'],
  ['eyesWail', '大哭', '大哭', 'BOTH EYES squeezed shut in comical wailing: each eye a thick > < shaped stroke with streams of tears running down the cheeks', '> <, crying, streaming tears, comedic', 'face'],
  ['eyesSqueeze', '> <', '笑到眯眼', 'BOTH EYES squeezed shut as > and < shaped strokes (left eye >, right eye <), comic style', '> <, closed eyes', 'eyes'],
  ['sweat', '汗', '慌张', 'small blue sweat drops beside the head, near both temples, outside the face', 'sweatdrop, nervous', 'face'],
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

/** 不找 AI、在手机里画：眼睛、脸红、汗滴用现成的贴纸（作者用 GPT 画好、抠出来的，assets/portrait/），眼睛先抹平再贴；
 *  贴纸里的睫毛换成这个人自己的睫毛色。笑眼 = 闭眼贴纸中间往上拱成弧。
 *  贴纸放在「脸的方向」上：跟着两只眼睛的连线转，往下挪也是沿着脸往下（头歪也左右对称）。嘴用原画自己的嘴线往下拉开（见 lips）。交出 { src, box } */
// [贴纸, 宽是眼睛框的几倍, 贴纸上眼睛那条线在多高（0 顶 1 底）, 往脸下方挪几个框高, 要不要先抹掉眼睛]
const STICK = { eyesClosed: ['closed', 1.05, .5, .15, 1], eyesSmile: ['closed', 1.05, .5, 0, 1], eyesCry: ['cry', 1.25, .4, .1, 1], eyesWail: ['wail', 1.6, .2, 0, 1],
  eyesSqueeze: ['squeeze', .8, .5, .05, 1], blush: ['blush', 1.4, .5, 0, 0], sweat: ['sweat', .55, .5, 0, 0] };
export const LOCAL = ['mouthOpen', 'eyesClosed', 'mouthO', 'eyesSmile', 'blush', 'eyesCry', 'eyesWail', 'eyesSqueeze', 'sweat'];
export async function drawPart(p, k) {
  const c = canvas(p.w, p.h), x = c.getContext('2d', { willReadFrequently: true }), { eyeL, eyeR, mouth } = p.boxes;
  x.drawImage(await img(p.base), 0, 0, p.w, p.h);
  if (STICK[k]) {
    const [name, size, line, drop, erase] = STICK[k], mid = b => [b[0] + b[2] / 2, b[1] + b[3] / 2], [lx, ly] = mid(eyeL), [rx, ry] = mid(eyeR), [mx, my] = mid(mouth);
    const tilt = Math.atan2(ry - ly, rx - lx), dn = [-Math.sin(tilt), Math.cos(tilt)], down = (mx - (lx + rx) / 2) * dn[0] + (my - (ly + ry) / 2) * dn[1];
    const [L, R] = await Promise.all(['l', 'r'].map(s => img(`assets/portrait/${name}-${s}.webp`)));
    for (const [st, b, side] of [[L, eyeL, -1], [R, eyeR, 1]]) {
      const [, , bw, bh] = b, [ex, ey] = mid(b), w = bw * size, h = st.naturalHeight * w / st.naturalWidth, lash = erase && lashOf(x, b);
      if (erase) smooth(x, b);
      // 脸红往下挪到眼睛和嘴中间；汗滴放在眼睛外上方；别的按表里挪
      const off = k === 'blush' ? down * .5 : k === 'sweat' ? -bh * .9 : bh * drop, out = k === 'sweat' ? side * bw * .85 : 0;
      const t = canvas(Math.ceil(w), Math.ceil(h)), tx = t.getContext('2d', { willReadFrequently: true }); tx.drawImage(st, 0, 0, w, h);
      if (lash) tint(tx, t.width, t.height, lash);
      x.save(); x.translate(ex + dn[0] * off - dn[1] * out, ey + dn[1] * off + dn[0] * out); x.rotate(tilt);
      if (k === 'eyesSmile') for (let i = 0; i < t.width; i++) x.drawImage(t, i, 0, 1, t.height, i - w / 2, -h * line - Math.sin(i / (t.width - 1) * Math.PI) * bh * .35, 1, t.height);
      else x.drawImage(t, -w / 2, -h * line);
      x.restore();
    }
  }
  else lips(x, mouth, k === 'mouthO');
  const a = areaOf(p, k === 'blush' || k === 'sweat' || k === 'eyesWail' ? 'face' : k.startsWith('eyes') ? 'eyes' : 'mouth'), o = canvas(a[2], a[3]);
  o.getContext('2d').drawImage(c, a[0], a[1], a[2], a[3], 0, 0, a[2], a[3]);
  return { src: o.toDataURL('image/png'), box: a };
}
const luma = (a, i) => a[i] * .3 + a[i + 1] * .59 + a[i + 2] * .11;
/** 这个人的睫毛色：眼睛框里最深的那一小撮像素的平均 */
function lashOf(x, [bx, by, bw, bh]) {
  const d = x.getImageData(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh)).data, px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push(i);
  px.sort((m, n) => luma(d, m) - luma(d, n));
  const top = px.slice(0, Math.max(1, px.length * .06 | 0)), c = [0, 1, 2].map(k => top.reduce((s, i) => s + d[i + k], 0) / top.length);
  return c;
}
/** 贴纸换色：深的地方（睫毛）往睫毛色上靠，浅的和偏蓝的（眼泪、高光）不动；保留贴纸自己的明暗 */
function tint(tx, w, h, [r, g, b]) {
  const d = tx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) { if (!a[i + 3] || a[i + 2] > a[i] + 15) continue; const l = luma(a, i), t = Math.max(0, Math.min(1, (150 - l) / 90)), k = .6 + l / 255;
    a[i] += (r * k - a[i]) * t; a[i + 1] += (g * k - a[i + 1]) * t; a[i + 2] += (b * k - a[i + 2]) * t; }
  tx.putImageData(d, 0, 0);
}
/** 框里的「线」：比四周深的像素单独拿出来（越深越不透明），颜色就是原画的线色。交出 { c: 只有线的小画布, X, Y, W, H, a: 原像素, on: 哪些是线 } */
function inkOf(x, [bx, by, bw, bh], cut = .4) {
  const X = Math.max(0, Math.round(bx)), Y = Math.max(0, Math.round(by)), W = Math.round(bw), H = Math.round(bh), d = x.getImageData(X, Y, W, H), a = d.data, on = new Float32Array(W * H);
  let lo = 255, hi = 0;
  for (let i = 0; i < a.length; i += 4) { const l = luma(a, i); lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const th = lo + (hi - lo) * cut;
  for (let i = 0, j = 0; i < a.length; i += 4, j++) { on[j] = Math.max(0, Math.min(1, (th - luma(a, i)) / Math.max(8, (th - lo) * .5))); }
  const ink = new ImageData(new Uint8ClampedArray(a), W, H); for (let j = 0; j < on.length; j++) ink.data[j * 4 + 3] = a[j * 4 + 3] * on[j];
  const c = canvas(W, H); c.getContext('2d').putImageData(ink, 0, 0);
  return { c, X, Y, W, H, a, on };
}
/** 张嘴 / O 型嘴（照 Mesh Avatar Studio：嘴靠网格往下拉开）：原来那条嘴线留着当上嘴唇，
 *  从它往下拉开一个嘴（里面用线色调深红，底下一点舌头），下嘴唇用同色细线勾一下 */
function lips(x, b, round) {
  const { c, X, Y, W, H, a } = inkOf(x, b, .6), ys = [], line = [0, 0, 0];
  // 每一列最深的那个点连起来 = 嘴线（再顺一顺），颜色取它们的平均
  for (let i = 0; i < W; i++) { let best = 0, v = 999; for (let y = 0; y < H; y++) { const l = luma(a, (y * W + i) * 4); if (l < v) { v = l; best = y; } } ys.push(best); const q = (best * W + i) * 4; for (let k = 0; k < 3; k++) line[k] += a[q + k] / W; }
  const at = i => { let s = 0, n = 0; for (let j = Math.max(0, i - 3); j <= Math.min(W - 1, i + 3); j++) { s += ys[j]; n++; } return Y + s / n; };
  smooth(x, b);
  const m0 = W * (round ? .32 : .17), m1 = W * (round ? .68 : .83), depth = W * (round ? .36 : .32), edge = [];
  for (let i = Math.round(m0); i <= m1; i++) { const u = (i - m0) / (m1 - m0); edge.push([X + i, at(i), round ? Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) : Math.sin(u * Math.PI) ** .7]); }
  const mix = (t, o) => `rgb(${line.map((v, i) => Math.round(v * (1 - t) + o[i] * t)).join(',')})`;
  x.beginPath(); edge.forEach(([ex, ey]) => x.lineTo(ex, ey)); for (let i = edge.length - 1; i >= 0; i--) x.lineTo(edge[i][0], edge[i][1] + depth * edge[i][2]); x.closePath();
  x.fillStyle = mix(.5, [140, 34, 48]); x.fill();
  x.save(); x.clip(); x.fillStyle = mix(.85, [235, 125, 135]); x.beginPath(); x.ellipse(X + (m0 + m1) / 2, at(Math.round((m0 + m1) / 2)) + depth * .95, (m1 - m0) * .32, depth * .35, 0, 0, 7); x.fill(); x.restore();
  x.strokeStyle = `rgba(${line.map(Math.round).join(',')},.55)`; x.lineWidth = Math.max(1, W * .02); x.beginPath(); edge.forEach(([ex, ey, k]) => x.lineTo(ex, ey + depth * k)); x.stroke();
  // 上嘴唇：原来的嘴线放回去（O 型嘴只留中间那段）
  x.save(); x.beginPath(); round ? x.rect(X + m0 - 2, Y, m1 - m0 + 4, H) : x.rect(X, Y, W, H); x.clip(); x.drawImage(c, X, Y); x.restore();
}
/** 抹平：框外接的椭圆里，用四周的皮肤色往里补（先按行、按列从两边的皮肤色渐变过去，再反复取上下左右的平均磨匀），像把原来的五官擦掉。
 *  四周偏深的（头发、眉毛）不当皮肤色用，免得渗进来一片灰 */
function smooth(x, [bx, by, bw, bh]) {
  const X = Math.max(0, Math.floor(bx - bw * .3)), Y = Math.max(0, Math.floor(by - bh * .3)), W = Math.ceil(bw * 1.6), H = Math.ceil(bh * 1.6);
  const d = x.getImageData(X, Y, W, H), a = d.data, cx = bx + bw / 2 - X, cy = by + bh / 2 - Y, rx = bw * .62, ry = bh * .52, hole = new Uint8Array(W * H), ring = [];
  for (let y = 0; y < H; y++) for (let x0 = 0; x0 < W; x0++) { const q = ((x0 - cx) / rx) ** 2 + ((y - cy) / ry) ** 2, j = y * W + x0;
    const inBox = x0 + X >= bx - bw * .04 && x0 + X <= bx + bw * 1.04;   // 左右不出框：框外可能就是头发
    if (q < 1 && inBox) hole[j] = 1; else if (q < 1.35 || !inBox && q < 1) ring.push(j); }
  const ls = ring.map(j => luma(a, j * 4)).sort((m, n) => m - n), skin = ls[ls.length >> 1] - 30;
  // 往外找最近的皮肤色（跳过头发、睫毛这些深色的，它们留着不动）
  const edge = (j, step, n) => { for (let k = 1; k <= n; k++) { const t = j + step * k; if (t < 0 || t >= W * H || (step === 1 || step === -1) && Math.floor(t / W) !== Math.floor(j / W)) return null; if (!hole[t] && luma(a, t * 4) >= skin) return [t, k]; } return null; };
  const inn = []; for (let j = 0; j < W * H; j++) if (hole[j] && j % W > 0 && j % W < W - 1 && j >= W && j < W * (H - 1)) inn.push(j);
  for (const j of inn) { const got = [edge(j, -1, W), edge(j, 1, W), edge(j, -W, H), edge(j, W, H)].filter(Boolean); if (!got.length) continue;
    let ws = 0; const sum = [0, 0, 0, 0]; for (const [t, k] of got) { ws += 1 / k; for (let c = 0; c < 4; c++) sum[c] += a[t * 4 + c] / k; }
    for (let c = 0; c < 4; c++) a[j * 4 + c] = sum[c] / ws; }
  for (let it = 0; it < 40; it++) for (const j of inn) for (let c = 0, i = j * 4; c < 4; c++) a[i + c] = (a[i + c - 4] + a[i + c + 4] + a[i + c - W * 4] + a[i + c + W * 4]) / 4;
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

/** 一个会动的立绘（没有立绘返回 null）。返回的元素上有 .pt：talk(true / false) 说话、face('smile' / 'angry' / 'troubled' / 'shy' / 'cry' / 'wail' / 'laugh' / 'nervous' / '') 换表情、peek(名字) 亮一下某个表情 */
const FACE = { smile: ['eyesSmile'], angry: ['browsAngry'], troubled: ['browsTroubled'], shy: ['blush'], cry: ['eyesCry'], wail: ['eyesWail'], laugh: ['eyesSqueeze'], nervous: ['sweat', 'browsTroubled'] };
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
  const blink = () => { if (!el.isConnected && el._born) return; el._born = 1; if (parts.eyesClosed && !(FACE[face] || []).some(k => k.startsWith('eyes') && parts[k])) { show('eyesClosed', true); setTimeout(() => show('eyesClosed', false), 130); } setTimeout(blink, 2500 + Math.random() * 3500); };
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
