// 个性装扮：头像框、气泡。存在资源库「个性装扮」里，每个人各选一个：联系人存在 c.frame / c.bubble，我存在 state.me.frame / bubble
import { state, commit } from './store.js';
import { uid, h } from './util.js';

export const deco = () => (state.deco = state.deco || { frames: [], bubbles: [] });
const find = (k, id) => id && deco()[k].find(x => x.id === id);

/** 头像套上框：框图放在头像外面一圈（::after），没选或框被删了就什么都不加。id 也可以直接是一张图（论坛装扮套装里的框） */
export function addFrame(ava, id) {
  const f = /^data:image\//.test(id || '') ? { src: id } : find('frames', id), st = ava.style;
  if (!f) { if (ava.dataset.frame) { ava.classList.remove('has-frame'); delete ava.dataset.frame; } return ava; }
  ava.classList.add('has-frame'); if (f.id) ava.dataset.frame = f.id;
  st.setProperty('--frame', `url("${f.view || f.src}")`);
  if (f.inset != null) st.setProperty('--frame-in', f.inset + '%'); else st.removeProperty('--frame-in');
  if (f.dx || f.dy) st.setProperty('--frame-at', `${f.dx || 0}% ${f.dy || 0}%`); else st.removeProperty('--frame-at');
  return ava;
}
/** 资源库里改了 / 删了一个框：已经画出来戴着它的头像马上换（只改那几个头像的样式） */
export const refreshFrame = id => document.querySelectorAll(`[data-frame="${id}"]`).forEach(el => addFrame(el, id));
/** 气泡：颜色、圆角、描边写进这一个气泡；有图就用九宫格拉伸（四个角不变形）。b 是编号，编辑时预览也可以直接传气泡本身 */
export function paintBubble(el, b) {
  if (typeof b === 'string') b = find('bubbles', b); if (!b) return el;
  el.classList.add('has-deco');
  const set = (k, v) => v != null && v !== '' && el.style.setProperty(k, v);
  set('--deco-bg', b.bg); set('--deco-ink', b.ink); set('--deco-line', b.line); set('--deco-r', b.radius != null ? b.radius + 'px' : null);
  if (b.img) { el.classList.add('has-deco-img'); el.style.setProperty('--deco-img', `url("${b.img}")`); }
  return el;
}

/** 导出 / 导入：一个 .json，里面是图片和颜色，发给别人直接导 */
export function pack(kind, list) { return { asterphone: kind, v: 1, items: list.map(({ id, ...x }) => x) }; }
export function unpack(kind, d) {
  if (!d || d.asterphone !== kind || !Array.isArray(d.items)) return 0;
  const key = kind === 'frames' ? 'frames' : 'bubbles';
  const ok = d.items.filter(x => x && typeof x.name === 'string' && (key === 'frames' ? /^data:image\//.test(x.src || '') : true))
    .map(x => ({ ...x, name: x.name.slice(0, 20), id: uid(key[0]) }));
  deco()[key].push(...ok); commit('deco');
  return ok.length;
}

/** 给一个人选头像框 / 气泡：返回编号，'none' 是不戴，null 是没选（取消） */
export async function pickDeco(k, cur, face) {
  const ui = await import('./ui.js'), { actionSheet, toast } = ui;
  const name = k === 'frames' ? '头像框' : '气泡', list = deco()[k];
  if (!list.length) { toast(`还没有${name}，去「资源库 → 个性装扮」添加`); return null; }
  // 头像框：一格一格戴在这个人头像上给你看，点哪个选哪个
  if (k === 'frames') return new Promise(res => {
    const { sheet, avatar } = ui; let v = null;
    const tile = (id, label) => h('button.as-deco-pick' + ((cur || 'none') === id ? '.is-on' : ''), { onclick: () => { v = id; s.close(); } }, addFrame(avatar(face?.src || '', face?.name || '我', 52), id === 'none' ? '' : id), h('span', label));
    const s = sheet({ title: name, content: h('div.as-deco-picks', tile('none', '不戴'), ...list.map(x => tile(x.id, x.name))), onClose: () => res(v) });
  });
  return actionSheet(name, [{ value: 'none', label: '不戴', active: !cur }, ...list.map(x => ({ value: x.id, label: x.name, active: x.id === cur }))]);
}
export const decoName = (k, id) => find(k, id)?.name || '';

/* ---------- 抠图：要透明的部件（头像框、小图标…）传的图没有透明，就把和四周连着、颜色差不多的底色抠掉（纯色、渐变底好用，花底抠不干净） ---------- */
export const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
/** 抠底色：从图的四边、还有已经透明的地方往里走，和走过来的那一格颜色接近（t，渐变也跟得上）、离出发那一格的颜色也不太远（g）就当底色去掉 */
function flood(x, w, H, t, g = 999) {
  const d = x.getImageData(0, 0, w, H), a = d.data, at = (i, j) => (j * w + i) * 4, seen = new Uint8Array(w * H), q = [];
  const far = (p, f) => Math.abs(a[p] - a[f]) + Math.abs(a[p + 1] - a[f + 1]) + Math.abs(a[p + 2] - a[f + 2]);
  for (let j = 0; j < H; j++) for (let i = 0; i < w; i++) {
    const p = at(i, j);
    if (a[p + 3] === 0) { for (const [u, v] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (u >= 0 && v >= 0 && u < w && v < H) q.push([u, v, at(u, v), at(u, v)]); }
    else if (!i || !j || i === w - 1 || j === H - 1) q.push([i, j, p, p]);
  }
  while (q.length) {
    const [i, j, from, s0] = q.pop(); if (i < 0 || j < 0 || i >= w || j >= H || seen[j * w + i]) continue;
    const p = at(i, j); if (!a[p + 3] || far(p, from) >= t || far(p, s0) >= g) continue;
    seen[j * w + i] = 1; a[p + 3] = 0;
    q.push([i + 1, j, p, s0], [i - 1, j, p, s0], [i, j + 1, p, s0], [i, j - 1, p, s0]);
  }
  x.putImageData(d, 0, 0);
}
const opaque = (x, w, H) => { const top = x.getImageData(0, 0, w, 1).data, bot = x.getImageData(0, H - 1, w, 1).data; for (let i = 3; i < top.length; i += 4) if (top[i] < 250 || bot[i] < 250) return false; return true; };
export async function cutout(url) {
  if (!/^data:image\//.test(url)) return url;
  const im = await loadImg(url), c = document.createElement('canvas'), w = c.width = im.naturalWidth, H = c.height = im.naturalHeight, x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  if (!opaque(x, w, H)) return url;   // 本来就有透明，不动
  flood(x, w, H, 60);
  return c.toDataURL('image/png');
}

/** 头像框：没透明就抠掉外面和中间的底色；再找到中间的洞，挪到正中间、按洞的大小记下框要比头像大多少（inset，头像的百分之几），这样头像正好填满洞 */
export async function fitFrame(url) {
  const im = await loadImg(url), c = document.createElement('canvas'), w = c.width = im.naturalWidth, H = c.height = im.naturalHeight, x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  let d = x.getImageData(0, 0, w, H), a = d.data;
  const cx0 = w >> 1, cy0 = H >> 1;
  if (opaque(x, w, H)) {
    // 底色取四条边的平均：深色底（发光的框常见）按亮度变透明，光晕也能留成半透明；浅色底照旧从四周和中间抠
    const E = [[], [], []];
    for (let i = 0; i < w; i += 4) for (const j of [0, H - 1]) for (let k = 0; k < 3; k++) E[k].push(a[(j * w + i) * 4 + k]);
    for (let j = 0; j < H; j += 4) for (const i of [0, w - 1]) for (let k = 0; k < 3; k++) E[k].push(a[(j * w + i) * 4 + k]);
    const B = E.map(v => v.sort((m, n) => m - n)[Math.floor(v.length * .9)]);   // 底色常常上下深浅不一：取偏亮的那头，底上的暗处都算透明
    if (B[0] * .299 + B[1] * .587 + B[2] * .114 < 80) {
      for (let p = 0; p < a.length; p += 4) {
        let al = 0; for (let k = 0; k < 3; k++) al = Math.max(al, (a[p + k] - B[k]) / (255 - B[k]));
        al = Math.max(0, (al - .08) / .92);
        if (al) for (let k = 0; k < 3; k++) a[p + k] = Math.max(0, B[k] + (a[p + k] - B[k]) / al);
        a[p + 3] = al * 255;
      }
      x.putImageData(d, 0, 0);
    } else { a[(cy0 * w + cx0) * 4 + 3] = 0; x.putImageData(d, 0, 0); flood(x, w, H, 60, 70); }
    d = x.getImageData(0, 0, w, H); a = d.data;
    // 水印（小红书这类）在右下角：整块都落在右下那一小条里的零碎就去掉，框本身伸进来的大块不动
    const seen = new Uint8Array(w * H);
    for (let j = Math.floor(H * .88); j < H; j++) for (let i = Math.floor(w * .5); i < w; i++) {
      const s0 = j * w + i; if (seen[s0] || a[s0 * 4 + 3] < 30) continue;
      const q = [s0], blob = []; seen[s0] = 1; let inside = true;
      while (q.length) {
        const p = q.pop(), u = p % w, v = (p - u) / w; blob.push(p); if (u < w * .5 || v < H * .88) inside = false;
        for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) { const uu = u + du, vv = v + dv, nn = vv * w + uu; if (uu >= 0 && vv >= 0 && uu < w && vv < H && !seen[nn] && a[nn * 4 + 3] >= 30) { seen[nn] = 1; q.push(nn); } }
      }
      if (inside) for (const p of blob) a[p * 4 + 3] = 0;
    }
    x.putImageData(d, 0, 0);
  }
  if (a[(cy0 * w + cx0) * 4 + 3] > 127) return { src: c.toDataURL('image/png') };   // 中间不是空的：找不到洞，照原样
  // 从中间往四周 72 个方向走，碰到框就停：碰到的点的平均是洞的中心，距离取中间值是洞的半径（挂进洞里的小坠子不算）
  let cx = cx0, cy = cy0, rad = 0;
  for (let n = 0; n < 3; n++) {
    const hit = [];
    for (let k = 0; k < 72; k++) {
      const dx = Math.cos(k * Math.PI / 36), dy = Math.sin(k * Math.PI / 36);
      for (let s = 1; ; s++) { const i = Math.round(cx + dx * s), j = Math.round(cy + dy * s); if (i < 0 || j < 0 || i >= w || j >= H) break; if (a[(j * w + i) * 4 + 3] > 90) { hit.push([i, j, s]); break; } }
    }
    if (hit.length < 54) return { src: c.toDataURL('image/png') };   // 框缺口太多（细细的光圈常有缝）：大半方向都碰得到才算
    cx = hit.reduce((m, p) => m + p[0], 0) / hit.length; cy = hit.reduce((m, p) => m + p[1], 0) / hit.length; rad = hit.map(p => p[2]).sort((x, y) => x - y)[hit.length >> 1] * 1.03;
  }
  let E = rad;
  for (let j = 0; j < H; j++) for (let i = 0; i < w; i++) if (a[(j * w + i) * 4 + 3] > 20) E = Math.max(E, Math.abs(i - cx) + 1, Math.abs(j - cy) + 1);
  const k = Math.min(1, 200 / E), o = document.createElement('canvas'); o.width = o.height = Math.round(E * 2 * k);
  o.getContext('2d').drawImage(c, (E - cx) * k, (E - cy) * k, w * k, H * k);
  return { src: o.toDataURL('image/png'), inset: +(-(E - rad) / (2 * rad) * 100).toFixed(1) };
}
/** 头像框染色：light 轻染（照原来的明暗上色，白的还是白的），heavy 重染（白的也染满，黑的还是黑的）。出一张新图，原图留着能还原 */
export async function tintFrame(src, color, mode) {
  const im = await loadImg(src), c = document.createElement('canvas'), w = c.width = im.naturalWidth, H = c.height = im.naturalHeight, x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, w, H), a = d.data, n = parseInt(color.slice(1, 7), 16), T = [n >> 16 & 255, n >> 8 & 255, n & 255];
  for (let i = 0; i < a.length; i += 4) {
    const L = (a[i] * .299 + a[i + 1] * .587 + a[i + 2] * .114) / 255;
    for (let k = 0; k < 3; k++) a[i + k] = mode === 'heavy' ? T[k] * L : L < .5 ? T[k] * 2 * L : T[k] + (255 - T[k]) * (2 * L - 1);
  }
  x.putImageData(d, 0, 0); return c.toDataURL('image/png');
}
