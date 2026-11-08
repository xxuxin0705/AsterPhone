// 立绘：一张标准立绘 + 几块「只改了一处」的小图（张嘴、闭眼、笑眼、生气眉…），叠在立绘上换着显示，就会眨眼、说话、换表情。
// 做法：把立绘发给生图线，一次画一张表情宫格；手机里切开、每格对齐到立绘上，比对哪里不一样，把那一小块抠出来（存成小图 + 位置）。
// 动作（换姿势）也是一次画一张宫格，切开后按脸对齐成和立绘一样大的整张图，表情照样叠在上面。
// 存在 kv 的 pt:联系人 id 里：{ base, w, h, parts: { 名字: { src, box: [x, y, w, h] } }, poses: { 名字: 整张图 }, boxes: 框好的眼睛和嘴 }
import { kvGet, kvSet, kvDel } from './store.js';

/** 能生成的表情：[名字, 叫什么, 用来干嘛, NAI 用的标签, 换哪一块（眼睛 / 嘴 / 整张脸）, 宫格提示词里怎么写, 分类]。
 *  「说话眨眼」三个是必须的（眨眼、说话动嘴靠它们），别的自己挑 */
export const PARTS = [
  ['eyesClosed', '闭眼', '眨眼', 'closed eyes', 'eyes', '轻轻闭眼（嘴不变）', '说话眨眼'],
  ['mouthOpen', '张嘴', '说话', 'open mouth', 'mouth', '张嘴说「啊」（眼睛不变）', '说话眨眼'],
  ['mouthO', 'O 型嘴', '说话', ':o, small open mouth', 'mouth', '嘴巴小小圆圆说「哦」（眼睛不变）', '说话眨眼'],
  ['eyesSmile', '笑眼', '笑', '^_^, closed eyes, happy', 'eyes', '眯眼笑：弯弯的笑眼（嘴不变）', '开心'],
  ['eyesSqueeze', '> <', '笑到眯眼', '> <, closed eyes', 'eyes', '用力闭眼成 > <', '开心'],
  ['blush', '脸红', '害羞', 'blush', 'face', '脸红害羞：两颊明显泛红', '开心'],
  ['eyesCry', '哭', '伤心', 'closed eyes, crying, tears', 'eyes', '哭：闭眼流泪', '难过'],
  ['eyesWail', '大哭', '大哭', '> <, crying, streaming tears, comedic', 'face', '大哭：眼睛闭成 > <，两道眼泪往下流', '难过'],
  ['browsTroubled', '为难', '为难', 'worried, raised inner eyebrows', 'eyes', '为难：眉头往上抬、眉尾下垂', '难过'],
  ['browsAngry', '生气', '生气', 'angry, v-shaped eyebrows', 'eyes', '生气：眉头压低皱起', '其他'],
  ['sweat', '汗', '慌张', 'sweatdrop, nervous', 'face', '慌张：额头边一滴汗', '其他'],
];
export const MUST = ['eyesClosed', 'mouthOpen', 'mouthO'];const LOOK = 'Clean cel shading with crisp thin linework, flat even frontal lighting, NO cast shadows, no paper grain, no glow.', BG = 'Plain pure white background. No text, no watermark, no border.';
/** 第一步：照参考图（或者照描述）画一张方便拆的标准立绘 */
export const basePrompt = (desc, withRef) => `${withRef ? 'The attached image is a reference for this character\'s identity and drawing style. Redraw THIS character (same face, hair, eye colour and clothing), leaving out any props, scenery and text.\nMatch the reference\'s art style as exactly as possible, as if the same artist drew it: same line weight and line colour, same colouring and shading method, same palette and saturation, same way of drawing the eyes, same face shape and body proportions. Do not restyle, simplify or clean up the drawing.' : `Character: ${desc}`}
${withRef && desc ? `Notes: ${desc}\n` : ''}Framing: straight-on half-body view, head and body facing the viewer squarely, from just above the head down to the waist, centred, shoulders level, a clear empty white margin around the character. Tall portrait canvas.
The neck is clearly visible between chin and collar. Both eyebrows are fully visible, no hair crossing the eyes or eyebrows. Both arms hang relaxed at the sides; the character holds nothing.
Neutral expression: eyes open looking straight at the viewer, relaxed closed mouth with a faint smile, eyebrows level.
${withRef ? BG : `${LOOK} ${BG}`}`;
/** NAI 认标签不认长句：照参考图画（角色参考）或者只按描述画 */
export const naiBase = (desc, withRef) => [desc, 'solo, upper body, front view, facing viewer, looking at viewer, standing straight, arms at sides, centered, white background, simple background, no text, neutral expression, closed mouth, light smile', !withRef && 'flat lighting'].filter(Boolean).join(', ');
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
  return region === 'eyes' ? around(p, [eyeL, eyeR], .3, .25, 1) : region === 'mouth' ? around(p, [mouth], .5, .6) : around(p, [eyeL, eyeR, mouth], .3, .5);
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
    // 戴眼镜：先把镜片那块原样存下，贴完再盖回去（镜片后面隐约透出闭眼）
    const lens = k !== 'sweat' && p.boxes.lensL ? [p.boxes.lensL, p.boxes.lensR].map(b => [b, x.getImageData(...b)]) : [];
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
    for (const [[gx, gy, gw, gh], G] of lens) {
      // 镜片的颜色：取镜片下半圈（那里没有眼睛）的平均；新画的眼睛上盖一层这个颜色。镜框（边上一圈）照原样
      const now = x.getImageData(gx, gy, gw, gh), a = now.data, g = G.data, tone = [0, 0, 0]; let n = 0;
      for (let y = gh >> 1; y < gh; y++) for (let x0 = 0; x0 < gw; x0++) if (((x0 / gw - .5) * 2) ** 2 + ((y / gh - .5) * 2) ** 2 < .5) { const i = (y * gw + x0) * 4; for (let c = 0; c < 3; c++) tone[c] += g[i + c]; n++; }
      tone.forEach((v, c) => tone[c] = v / n);
      const cover = (tone[0] * .3 + tone[1] * .59 + tone[2] * .11) < 110 ? .7 : .2;   // 墨镜只隐约透出，透明镜片基本看得清
      for (let y = 0; y < gh; y++) for (let x0 = 0; x0 < gw; x0++) { const q = ((x0 / gw - .5) * 2) ** 2 + ((y / gh - .5) * 2) ** 2, i = (y * gw + x0) * 4; if (q >= 1) continue;
        if (q > .72) for (let c = 0; c < 4; c++) a[i + c] = g[i + c]; else for (let c = 0; c < 3; c++) a[i + c] = a[i + c] * (1 - cover) + tone[c] * cover; }
      x.putImageData(now, gx, gy);
    }
  }
  else lips(x, mouth, k === 'mouthO');
  let a = areaOf(p, k === 'blush' || k === 'sweat' || k === 'eyesWail' ? 'face' : k.startsWith('eyes') ? 'eyes' : 'mouth');
  if (k.startsWith('eyes') && p.boxes.lensL) a = around(p, [a, p.boxes.lensL, p.boxes.lensR], 0, 0);
  const o = canvas(a[2], a[3]);
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
// 存的样子：{ use: 在用第几张, vers: [ 一张立绘 ], sel: { face: [...], pose: [...] } 上次挑的表情 / 动作 }
// 一张立绘：{ base, w, h, boxes, alt: { 名字: [候选…] }, on: { 名字: 在用第几个 } }；表情的候选是 { src, box }，动作的候选是整张图
// 内存里每张立绘多两个现算的：parts（在用的表情）、poses（在用的动作），叠立绘、换动作都看它们
const cache = new Map();
const isPose = k => POSES.some(x => x[0] === k);
function derive(v) {
  v.alt ||= {}; v.on ||= {};
  // 旧存档：parts / poses 直接放的就是在用的那个
  for (const [k, x] of Object.entries(v.parts || {})) if (!v.alt[k]) { v.alt[k] = [x]; v.on[k] = 0; }
  for (const [k, x] of Object.entries(v.poses || {})) if (!v.alt[k]) { v.alt[k] = [x]; v.on[k] = 0; }
  v.parts = {}; v.poses = {};
  for (const [k, list] of Object.entries(v.alt)) { const x = list[Math.min(v.on[k] ?? 0, list.length - 1)]; if (x) (isPose(k) ? v.poses : v.parts)[k] = x; }
  return v;
}
const pack = r => ({ use: r.use, sel: r.sel, vers: r.vers.map(({ base, w, h, boxes, alt, on }) => ({ base, w, h, boxes, alt, on })) });
const put = (id, r) => { cache.set(id, r); return kvSet('pt:' + id, pack(r)); };
export async function load(id) {
  if (!cache.has(id)) {
    let r = await kvGet('pt:' + id).catch(() => null); if (r && r.base) r = { use: 0, vers: [r] }; if (r) r.vers.forEach(derive); cache.set(id, r || null);
    // 以前存下的没抠干净（比如黑底）：读的时候补抠一次存回去
    if (r) { let dirty = 0; for (const v of r.vers) { const b = (await clearBg(v).catch(() => v)).base; if (b !== v.base) { v.base = b; dirty = 1; } } if (dirty) await put(id, r); }
  }
  return loaded(id);
}
const rec = id => cache.get(id) || null;
/** 在用的那张立绘 */
export const loaded = id => { const r = rec(id); return r ? r.vers[r.use] : null; };
export const versions = id => rec(id)?.vers || [];
export const using = id => rec(id)?.use ?? -1;
/** 改了在用的那张（表情、动作、框）之后存 */
export async function save(id, v) { const r = rec(id); r.vers[r.use] = derive(v); await put(id, r); }
/** 新画好一张立绘：加一张，换成在用 */
export async function addVersion(id, v) { const r = rec(id) || { use: 0, vers: [] }; r.vers.push(derive(v)); r.use = r.vers.length - 1; await put(id, r); }
export async function useVersion(id, i) { const r = rec(id); r.use = i; await put(id, r); }
export async function dropVersion(id, i) { const r = rec(id); r.vers.splice(i, 1); if (!r.vers.length) return drop(id); r.use = Math.min(r.use > i ? r.use - 1 : r.use, r.vers.length - 1); await put(id, r); }
export async function drop(id) { cache.set(id, null); await kvDel('pt:' + id); }
/** 候选：新画的加进去并换成在用；挑一个；删一个 */
export function addAlt(v, k, x) { v.alt ||= {}; v.on ||= {}; (v.alt[k] ||= []).push(x); v.on[k] = v.alt[k].length - 1; derive(v); }
export function pickAlt(v, k, i) { v.on[k] = i; derive(v); }
export function dropAlt(v, k, i) { v.alt[k].splice(i, 1); if (!v.alt[k].length) { delete v.alt[k]; delete v.on[k]; } else if (v.on[k] >= i) v.on[k] = Math.max(0, v.on[k] - 1); derive(v); }
/** 上次挑的表情、动作（复制提示词和上传宫格要对得上） */
export const selOf = id => ({ face: rec(id)?.sel?.face || PARTS.map(x => x[0]), pose: rec(id)?.sel?.pose || POSES.filter(x => x[3]).map(x => x[0]) });
export async function setSel(id, sel) { const r = rec(id); r.sel = sel; await put(id, r); }
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
export function clearBg(p, type = 'image/png') {
  const c = canvas(p.w, p.h), x = c.getContext('2d', { willReadFrequently: true }), i = new Image();
  return new Promise((ok, no) => { i.onload = ok; i.onerror = no; i.src = p.base; }).then(() => {
    x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, p.w, p.h), a = d.data, W = p.w, H = p.h, seen = new Uint8Array(W * H), st = [];
    // 底色看四个角（角上已经透明就是抠过了）：纯色底连它一起去掉。深色底不从下边往里找：衣服常常是深色、一直连到下边
    const corners = [0, W - 1, (H - 1) * W, H * W - 1]; if (corners.some(k => a[k * 4 + 3] < 255)) return p;
    const bg = corners.reduce((s, k) => s.map((v, i) => v + a[k * 4 + i] / 4), [0, 0, 0]), light = Math.min(...bg) > 170, dark = Math.max(...bg) < 60;
    const white = k => a[k * 4] > 235 && a[k * 4 + 1] > 235 && a[k * 4 + 2] > 235 || (light || dark) && bg.every((v, i) => Math.abs(a[k * 4 + i] - v) < 16);
    for (let x0 = 0; x0 < W; x0++) st.push(x0, ...(dark ? [] : [(H - 1) * W + x0])); for (let y0 = 0; y0 < H; y0++) st.push(y0 * W, y0 * W + W - 1);
    let n = 0;
    while (st.length) { const k = st.pop(); if (seen[k] || !white(k)) continue; seen[k] = 1; a[k * 4 + 3] = 0; n++; const px = k % W;
      if (px > 0) st.push(k - 1); if (px < W - 1) st.push(k + 1); if (k >= W) st.push(k - W); if (k < W * (H - 1)) st.push(k + W); }
    if (!n) return p;
    x.putImageData(d, 0, 0); return { ...p, base: c.toDataURL(type, .92) };
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
  const pad = area ? 8 : 3, x0 = Math.max(0, (Math.min(...keep.map(k => k.x0)) - pad) * S), y0 = Math.max(0, (Math.min(...keep.map(k => k.y0)) - pad) * S);
  const x1 = Math.min(W, (Math.max(...keep.map(k => k.x1)) + pad + 1) * S), y1 = Math.min(H, (Math.max(...keep.map(k => k.y1)) + pad + 1) * S), w = x1 - x0, h = y1 - y0;
  if (w * h > W * H * .18) throw new Error('这张没对齐（整张图都变了），重画一次');
  // 抠：变了的地方不透明，往外一圈慢慢变淡
  const m = canvas(w, h), mx = m.getContext('2d'), md = mx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * W + x + x0) * 4, o = (y * w + x) * 4, d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    md.data[o + 3] = d > 40 ? 255 : 0; }
  mx.putImageData(md, 0, 0);
  // 糊开再把透明度放大四倍 = 往外扩一圈再羽化（不扩的话，原来的眼睛边会从羽化的地方透出来一圈影子）
  const f = canvas(w, h), fx = f.getContext('2d', { willReadFrequently: true }); fx.filter = 'blur(4px)'; fx.drawImage(m, 0, 0);
  // 靠近 area 边上、抠出来这块的边上都慢慢变透明，不然整块换上去时看得出一个方框
  const fd = fx.getImageData(0, 0, w, h), fw = area ? Math.max(4, Math.min(area[2], area[3]) * .15) : 0, fb = 3 * S;
  for (let i = 3, j = 0; i < fd.data.length; i += 4, j++) { let a = Math.min(255, fd.data[i] * 4); const x = j % w, y = j / w | 0;
    a *= Math.min(1, Math.min(x, w - 1 - x, y, h - 1 - y) / fb);
    if (fw) { const X = x0 + x, Y = y0 + y; a *= Math.max(0, Math.min(1, Math.min(X - area[0], area[0] + area[2] - X, Y - area[1], area[1] + area[3] - Y) / fw)); }
    fd.data[i] = a; }
  fx.putImageData(fd, 0, 0);
  const out = canvas(w, h), ox = out.getContext('2d'); ox.drawImage(f, 0, 0); ox.globalCompositeOperation = 'source-in'; ox.drawImage(v, x0 * v.naturalWidth / W, y0 * v.naturalHeight / H, w * v.naturalWidth / W, h * v.naturalHeight / H, 0, 0, w, h);
  return { src: out.toDataURL('image/png'), box: [x0, y0, w, h] };
}

/** 一个会动的立绘（没有立绘返回 null）。返回的元素上有 .pt：talk(true / false) 说话、face('smile' / 'angry' / 'troubled' / 'shy' / 'cry' / 'wail' / 'laugh' / 'nervous' / '') 换表情、hold(名字) 一直亮着某个表情、peek(名字) 亮一下某个表情 */
/** 一张宫格出全部表情（作者的主意）：把立绘发给 GPT，让它画表情宫格，一次出完；手机里切开、每格对齐到立绘上，再按区域抠。
 *  第一格永远是平常脸：不用，但切的时候拿它在立绘上找位置 */
// 宫格怎么排：[列, 行, 画多大]。表情格子要方（头肩特写），动作格子要竖（半身）
export const faceLayout = n => n <= 4 ? [2, 2, '1024x1024'] : n <= 6 ? [3, 2, '1536x1024'] : n <= 9 ? [3, 3, '1024x1024'] : [4, 3, '1536x1024'];
export const poseLayout = n => n <= 2 ? [n, 1, '1536x1024'] : n === 3 ? [3, 1, '1536x1024'] : n === 4 ? [2, 2, '1024x1536'] : n <= 6 ? [3, 2, '1536x1024'] : n <= 8 ? [4, 2, '1536x1024'] : [3, 4, '1024x1536'];
const listOf = items => items.map((t, i) => `${i + 1} ${t}`).join('\n');
export const facePrompt = keys => { const n = keys.length + 1, [c, r] = faceLayout(n); return `附件是一个角色的立绘。请画一张 ${c} 列 × ${r} 行的表情宫格图，共 ${n} 格${c * r > n ? '（多出来的格子留白）' : ''}，格子之间用白色细线隔开。
每一格都是这个角色的头和肩膀特写，正面；每格的取景完全一样：脸的大小、位置、头的角度都相同。长相、发型、配饰（比如眼镜）和画风和附件一模一样，只改表情，不改的地方保持原样。
从左到右、从上到下依次是：
${listOf(['平常（和附件一模一样）', ...keys.map(k => PARTS.find(x => x[0] === k)[5])])}
不要文字、编号、边框装饰。`; };
/** 动作（换姿势）：[名字, 叫什么, 宫格提示词里怎么写, 默认要不要, 分类]。脸都保持平常、不挡脸，表情才能叠上去 */
export const POSES = [
  ['hips', '叉腰', '双手叉腰', 1, '日常'], ['wave', '挥手', '举起一只手挥手打招呼', 1, '日常'], ['cross', '抱臂', '双手抱在胸前', 1, '日常'], ['think', '托腮', '一只手托着下巴思考（手别挡住嘴）', 1, '日常'],
  ['fist', '加油', '双手握拳在胸前给自己加油', 1, '情绪'], ['scratch', '挠头', '一只手挠后脑勺，不好意思', 1, '情绪'], ['shrug', '摊手', '双手摊开、耸肩，很无奈', 0, '情绪'], ['please', '拜托', '双手合十在胸前拜托', 1, '情绪'],
  ['point', '指前方', '一只手指向前方（看的人）', 1, '互动'], ['heart', '比心', '双手在胸前比一个心', 0, '互动'], ['reach', '伸手', '一只手向前伸出，像要拉住对方', 0, '互动'], ['peace', '比耶', '一只手在胸前比 V', 0, '互动'],
];
export const posePrompt = keys => { const n = keys.length, [c, r] = poseLayout(n); return `附件是一个角色的立绘。请画一张 ${c} 列 × ${r} 行的姿势宫格图，共 ${n} 格${c * r > n ? '（多出来的格子留白）' : ''}，格子之间用白色细线隔开。
每一格都是同一个角色：长相、发型、服装、配色和画风都和附件一模一样；和附件同样的半身取景、同样的大小、头在同样的位置，正面朝向观众，纯白背景。
只改动作和手的姿势；脸保持附件里的平常表情，不要改表情，手和东西都不要挡住脸。
从左到右、从上到下依次是：
${listOf(keys.map(k => POSES.find(x => x[0] === k)[2]))}
不要文字、编号、边框装饰。`; };
/** 立绘垫白底（发给 GPT 用） */
export async function onWhite(p) { const c = canvas(p.w, p.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, p.w, p.h); x.drawImage(await img(p.base), 0, 0); return c.toDataURL('image/png'); }
/** 切动作宫格：按挑的个数均分；每格在格子里找立绘那张脸的位置和大小，照着把整格缩放挪到和立绘一样（脸对上脸），去白底。交出 { poses: {名字: 图}, bad } */
export async function cutPoses(p, src, keys) {
  const g = await img(src), base = await img(p.base), R = gridRect(p), poses = {}, bad = [], [C, Rw] = poseLayout(keys.length);
  const flat = canvas(p.w, p.h), fx = flat.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, p.w, p.h); fx.drawImage(base, 0, 0);
  for (const [i, k] of keys.entries()) {
    const name = POSES.find(x => x[0] === k)[1], w = g.naturalWidth / C, h = g.naturalHeight / Rw, ins = Math.min(w, h) * .02, cell = canvas(Math.round(w - 2 * ins), Math.round(h - 2 * ins));
    cell.getContext('2d').drawImage(g, (i % C) * w + ins, Math.floor(i / C) * h + ins, cell.width, cell.height, 0, 0, cell.width, cell.height);
    const [fx0, fy0, fw] = find(cell, { c: flat, r: R }), m = R[2] / fw, out = canvas(p.w, p.h), ox = out.getContext('2d');
    ox.fillStyle = '#fff'; ox.fillRect(0, 0, p.w, p.h); ox.drawImage(cell, R[0] - fx0 * m, R[1] - fy0 * m, cell.width * m, cell.height * m);
    try { poses[k] = (await clearBg({ base: out.toDataURL('image/png'), w: p.w, h: p.h }, 'image/webp')).base; } catch (e) { bad.push(name); }
  }
  return { poses, bad };
}
/** 发给 GPT 的脸部特写：以两只眼睛和嘴的中间为中心，正方形，边长约是两眼外侧距离的 1.3 倍（刘海到下巴）；白底 */
export function gridRect(p) {
  const [x, y, w, h] = around(p, [p.boxes.eyeL, p.boxes.eyeR, p.boxes.mouth], 0, 0), s = Math.round(Math.min(Math.max(w * 1.3, h * 2), p.w, p.h));
  return [Math.round(Math.max(0, Math.min(p.w - s, x + w / 2 - s / 2))), Math.round(Math.max(0, Math.min(p.h - s, y + h / 2 - s / 2))), s, s];
}
export async function faceCrop(p) {
  const [x, y, s] = gridRect(p), c = canvas(512, 512), cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 512, 512);
  cx.drawImage(await img(p.base), x, y, s, s, 0, 0, 512, 512); return c.toDataURL('image/png');
}
/** NAI 宫格（试验）：NAI 只认标签、一张图一组标签，画不了 GPT 那种按格子排的宫格。
 *  试法：手机里先把脸部特写复制排成 3 列 × 2 行（1216×832），拿去图生图保住格子；再用 NAI 4 的「分角色提示词」按位置告诉它每格画什么表情。一次 6 格，11 个表情最多两次 */
export const naiBatches = keys => { const b = []; for (let i = 0; i < keys.length; i += 6) b.push([...keys.slice(i, i + 6), '', '', '', '', ''].slice(0, 6)); return b; };
const NW = 1216, NH = 832, naiCells = () => [0, 1].flatMap(r => [0, 1, 2].map(c => { const w = NW / 3, h = NH / 2, s = Math.min(w, h); return [c * w + (w - s) / 2, r * h + (h - s) / 2, s, s]; }));
export async function naiTiles(p) {
  const f = await img(await faceCrop(p)), c = canvas(NW, NH), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, NW, NH);
  for (const r of naiCells()) x.drawImage(f, ...r);
  return c.toDataURL('image/png');
}
export const naiChars = keys => keys.map((k, i) => ({ tags: k ? `portrait, face focus, ${PARTS.find(x => x[0] === k)[3]}` : 'portrait, face focus, neutral expression', x: +((i % 3 * 2 + 1) / 6).toFixed(2), y: i < 3 ? .25 : .75 }));
export const naiGridPrompt = 'expression chart, six panels, same girl in every panel, same framing, identical hair and face, face focus, white background, white borders';

/** 切宫格：按列 × 行均分，每格往里缩一点躲开分隔线（GPT 画的格子基本是均分的；白底时分隔线和背景分不开，不去找线） */
const cells = (W, H, C, R) => Array.from({ length: C * R }, (_, j) => { const w = W / C, h = H / R, i = Math.min(w, h) * .02; return [(j % C) * w + i, Math.floor(j / C) * h + i, w - 2 * i, h - 2 * i]; });
/** 把一格对到立绘上：先当它就是发出去的那块脸，再在小图上试一点点缩放和挪动，挑最像的（比灰度，先各自减掉平均） */
function align(base, cell, R) {
  const N = 96, k = N / R[2], gray = (c, sx, sy, sw, sh, w, h) => { const t = canvas(w, h), x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, sx, sy, sw, sh, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h); let m = 0; for (let i = 0; i < g.length; i++) { g[i] = luma(d, i * 4); m += g[i]; } m /= g.length; for (let i = 0; i < g.length; i++) g[i] -= m; return g; };
  const M = 12, B = gray(base, R[0] - M / k, R[1] - M / k, R[2] + 2 * M / k, R[2] + 2 * M / k, N + 2 * M, N + 2 * M);
  let best = [Infinity, 1, 0, 0, 1];
  for (let s = .9; s <= 1.101; s += .025) {
    // 格子不一定是正方形：宽按 N*s，高按格子自己的长宽比
    const n = Math.round(N * s), m = Math.round(n * cell.r[3] / cell.r[2]), C = gray(cell.c, ...cell.r, n, m), S = N + 2 * M;
    for (let dy = -M; dy <= M; dy++) for (let dx = -M; dx <= M; dx++) {
      const ox = Math.round((N - n) / 2) + M + dx, oy = Math.round((N - m) / 2) + M + dy;
      const x0 = Math.max(0, -ox), y0 = Math.max(0, -oy), x1 = Math.min(n, S - ox), y1 = Math.min(m, S - oy); if ((x1 - x0) * (y1 - y0) < n * m * .7) continue;
      let e = 0, c = 0; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = C[y * n + x] - B[(y + oy) * S + x + ox]; e += v * v; c++; }
      e /= c; if (e < best[0]) best = [e, s, ox, oy, m / n]; }
  }
  const [, s, ox, oy, as] = best;   // 小图上这一格放在 (ox, oy)、宽 N*s → 换回立绘上的位置
  return [R[0] + (ox - M) / k, R[1] + (oy - M) / k, R[2] * s, R[2] * s * as];
}
/** 宫格不是照我们发的脸部特写画的（比如拿整张立绘去画、或者 GPT 自己换了取景）：拿一格在整张立绘上大范围找——
 *  从小到大试各种大小、每个位置都比一下（都缩到很小的图上比，先各自减掉平均再算相关），挑最像的。交出这一格在立绘上的 [x, y, w, w] */
function find(base, cell) {
  const q = 128 / base.width, BW = 128, BH = Math.round(base.height * q), P = 48, S = BW + 2 * P, T = BH + 2 * P;
  const t = canvas(S, T), tx = t.getContext('2d', { willReadFrequently: true }); tx.fillStyle = '#fff'; tx.fillRect(0, 0, S, T); tx.drawImage(base, P, P, BW, BH);
  const bd = tx.getImageData(0, 0, S, T).data, B = new Float32Array(S * T); for (let i = 0; i < B.length; i++) B[i] = luma(bd, i * 4);
  let best = [-2, 0, 0, 0];
  for (let tw = 30; tw <= BW + 40; tw = Math.round(tw * 1.06) + 1) {   // 至少是被找那张图宽的四分之一（一张脸那么大）
    const th = Math.round(tw * cell.r[3] / cell.r[2]), c = canvas(tw, th), cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(cell.c, ...cell.r, 0, 0, tw, th);
    // 模板只取隔一个点的那些（和下面比的时候一样），减掉它们自己的平均
    const cd = cx.getImageData(0, 0, tw, th).data, pts = [], C = []; for (let y = 0; y < th; y += 2) for (let x = 0; x < tw; x += 2) { pts.push(y * S + x); C.push(luma(cd, (y * tw + x) * 4)); }
    const n = C.length, m = C.reduce((a, b) => a + b, 0) / n; let cv = 0; for (let i = 0; i < n; i++) { C[i] -= m; cv += C[i] * C[i]; }
    for (let oy = 0; oy + th <= T; oy += 2) for (let ox = 0; ox + tw <= S; ox += 2) {
      let sb = 0, sbb = 0, sbc = 0; const o = oy * S + ox;
      for (let i = 0; i < n; i++) { const b = B[o + pts[i]]; sb += b; sbb += b * b; sbc += b * C[i]; }
      const vb = sbb - sb * sb / n; if (vb < n * 25) continue;   // 一片白的地方不比
      const r = sbc / Math.sqrt(vb * cv); if (r > best[0]) best = [r, ox, oy, tw];
    }
  }
  const [, ox, oy, tw] = best; return [(ox - P) / q, (oy - P) / q, tw / q, tw / q];
}

/** 宫格图 → 各个表情。want：要哪些（不在宫格里的跳过）；order：每格是什么（第一格 '' 是平常脸）；nai：是 NAI 宫格（格子位置已知）。
 *  交出 { parts: {名字: {src, box}}, bad: [没成的叫什么], why: [为什么] } */
export async function cutGrid(p, src, want, order, nai) {
  const g = await img(src), gc = canvas(g.naturalWidth, g.naturalHeight), gx = gc.getContext('2d', { willReadFrequently: true }); gx.drawImage(g, 0, 0);
  const k0 = gc.width / NW, cs = nai ? naiCells().map(r => r.map(v => v * k0)) : cells(gc.width, gc.height, ...faceLayout(order.length));
  const base = await img(p.base), parts = {}, bad = [], why = [];
  const flat = canvas(p.w, p.h), fx = flat.getContext('2d', { willReadFrequently: true }); fx.fillStyle = '#fff'; fx.fillRect(0, 0, p.w, p.h); fx.drawImage(base, 0, 0, p.w, p.h);
  // 先拿第一格（平常脸）在整张立绘上找到大概的位置和大小；NAI 宫格是我们自己排的，直接用脸部特写的位置
  const R = nai ? gridRect(p) : find(flat, { c: gc, r: cs[0] });
  for (const [i, k] of order.entries()) {
    if (!k || !want.includes(k)) continue;
    const name = PARTS.find(x => x[0] === k)[1];
    try {
      const r = cs[i], at = align(flat, { c: gc, r }, R), v = canvas(p.w, p.h), vx = v.getContext('2d', { willReadFrequently: true });
      vx.drawImage(flat, 0, 0); vx.drawImage(gc, ...r, ...at);
      // 颜色校一下：GPT 重画会整体偏一点色，拿要换的那块四周一圈比平均色差，整块减掉
      const A = areaOf(p, PARTS.find(x => x[0] === k)[4]), mg = Math.round(Math.min(A[2], A[3]) * .3), O = [Math.max(0, A[0] - mg), Math.max(0, A[1] - mg)];
      O.push(Math.min(p.w, A[0] + A[2] + mg) - O[0], Math.min(p.h, A[1] + A[3] + mg) - O[1]);
      const d0 = fx.getImageData(...O).data, im = vx.getImageData(...O), d1 = im.data, off = [0, 0, 0]; let n = 0;
      for (let y = 0; y < O[3]; y += 2) for (let x = 0; x < O[2]; x += 2) { const X = x + O[0], Y = y + O[1]; if (X >= A[0] && X < A[0] + A[2] && Y >= A[1] && Y < A[1] + A[3]) continue; const j = (y * O[2] + x) * 4; for (let c = 0; c < 3; c++) off[c] += d1[j + c] - d0[j + c]; n++; }
      if (n) { for (let j = 0; j < d1.length; j += 4) for (let c = 0; c < 3; c++) d1[j + c] -= off[c] / n; vx.putImageData(im, O[0], O[1]); }
      parts[k] = await cut(p, v.toDataURL('image/png'), A);
    } catch (e) { bad.push(name); why.push(`${name}：${e.message}`) }
  }
  return { parts, bad, why };
}

const FACE = { smile: ['eyesSmile'], angry: ['browsAngry'], troubled: ['browsTroubled'], shy: ['blush'], cry: ['eyesCry'], wail: ['eyesWail'], laugh: ['eyesSqueeze'], nervous: ['sweat', 'browsTroubled'] };
export function figure(id) {
  const p = loaded(id); if (!p) return null;
  const el = document.createElement('div'); el.className = 'as-pt'; el.style.aspectRatio = `${p.w} / ${p.h}`;
  const lay = src => { const i = new Image(); i.src = src; i.alt = ''; i.draggable = false; el.append(i); return i; };
  const base = lay(p.base);
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
    // 一直亮着某个表情（照相馆里看效果用）；传空就收起
    hold(k) { if (el._held) show(el._held, false); el._held = k; if (k) show(k, true); },
    // 换了某个表情的候选：那一块换图、换位置
    set(k) { const x = p.parts[k], i = parts[k]; if (!x || !i) return; i.src = x.src; Object.assign(i.style, { left: x.box[0] / p.w * 100 + '%', top: x.box[1] / p.h * 100 + '%', width: x.box[2] / p.w * 100 + '%', height: x.box[3] / p.h * 100 + '%' }); },
    // 换动作：底图换成那个姿势（和立绘一样大、脸在同一个地方，表情照样叠）；没有这个姿势就回到立绘
    pose(k) { const s = p.poses?.[k] || p.base; if (base.src === s) return; const i = new Image(); i.src = s; i.decode().catch(() => {}).then(() => { base.src = s; }); },   // 先解码好再换，不闪
  };
  return el;
}
