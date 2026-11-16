// 个性装扮：头像框、气泡。存在资源库「个性装扮」里，每个人各选一个：联系人存在 c.frame / c.bubble，我存在 state.me.frame / bubble
import { state, commit } from './store.js';
import { uid, h } from './util.js';

export const deco = () => (state.deco = state.deco || { frames: [], bubbles: [] });
const find = (k, id) => id && deco()[k].find(x => x.id === id);

/** 头像套上框：框图放在头像外面一圈（::after），没选或框被删了就什么都不加。id 也可以直接是一张图（论坛装扮套装里的框） */
export function addFrame(ava, id) {
  if (/^data:image\//.test(id || '')) { ava.classList.add('has-frame'); ava.style.setProperty('--frame', `url("${id}")`); return ava; }
  const f = find('frames', id);
  if (!f) { if (ava.dataset.frame) { ava.classList.remove('has-frame'); delete ava.dataset.frame; } return ava; }
  frameRule(f); ava.classList.add('has-frame'); ava.dataset.frame = f.id;
  return ava;
}
// 一个框一条样式：框图（几百 KB）只写一次，不往每个头像身上各抄一份（帖子一多就卡）
const rules = new Map(); let sheet = null;
function frameRule(f) {
  const css = `.as-avatar[data-frame="${f.id}"]{--frame:url("${f.view || f.src}");${f.inset != null ? `--frame-in:${f.inset}%;` : ''}${f.dx || f.dy ? `--frame-at:${f.dx || 0}% ${f.dy || 0}%;` : ''}}`;
  if (rules.get(f.id) === css) return;
  rules.set(f.id, css); sheet ??= document.head.appendChild(document.createElement('style'));
  sheet.textContent = [...rules.values()].join('\n');
}
/** 资源库里改了 / 删了一个框：改那一条样式，戴着它的头像就都换了；删了的把框摘掉 */
export function refreshFrame(id) {
  const f = find('frames', id);
  if (f) return frameRule(f);
  rules.delete(id); if (sheet) sheet.textContent = [...rules.values()].join('\n');
  document.querySelectorAll(`[data-frame="${id}"]`).forEach(el => addFrame(el, id));
}
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
  // 头像框：上面一个大头像戴着选中的框给你看，下面一格一格选；选中了还能就地调色（改的是这个框本身，戴它的人都跟着变），点「确定」才算
  if (k === 'frames') return new Promise(res => {
    const { sheet, avatar, btn, segmented, colorWheel } = ui; let pick = cur || 'none', ok = false;
    const tones = {}; let job = 0;   // 这次调过色的框：id → { tint, dark, light, view }
    const pv = h('div.as-deco-pv'), toneBox = h('div.as-deco-tone'), grid = h('div.as-deco-picks');
    const paint = () => {
      const f = find('frames', pick), t = tones[pick], a = addFrame(avatar(face?.src || '', face?.name || '我', 96), f ? pick : '');
      if (t) a.style.setProperty('--frame', `url("${t.view || f.src}")`);
      pv.replaceChildren(a);
      grid.querySelectorAll('.as-deco-pick').forEach(b => b.classList.toggle('is-on', b.dataset.id === pick));
      toneBox.replaceChildren(); if (!f) return;
      const t0 = t || { tint: f.tint ? 'on' : '', dark: f.dark || '#2f5fa8', light: f.light || '#ffffff', view: f.view || '' };
      const redo = async () => { const n = ++job, v = t0.tint ? await tintFrame(f.src, t0.dark, t0.light) : ''; if (n !== job) return; t0.view = v; tones[f.id] = t0; paint(); };   // 拖色盘时只用最后一次
      const dot = (k2, label) => h('button.as-deco-dot', { 'aria-label': label, style: { background: t0[k2] }, onclick: () => sheet({ title: label, content: h('div.as-mu-color', colorWheel(t0[k2], c => { t0[k2] = c; redo(); })) }) });
      toneBox.append(segmented([['', '不染'], ['on', '染色']], t0.tint, x => { t0.tint = x; redo(); }), ...(t0.tint ? [dot('dark', '深处的颜色'), dot('light', '浅处的颜色')] : []));
    };
    const tile = (id, label) => h('button.as-deco-pick', { dataset: { id }, onclick: () => { pick = id; paint(); } }, addFrame(avatar(face?.src || '', face?.name || '我', 52), id === 'none' ? '' : id), h('span', label));
    grid.append(tile('none', '不戴'), ...list.map(x => tile(x.id, x.name)));
    const s = sheet({ title: name, content: h('div.as-deco-pickbox', pv, toneBox, grid, h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('确定', 'primary', () => {
      for (const [id, t] of Object.entries(tones)) { const f = find('frames', id); if (f) { Object.assign(f, { tint: t.tint, dark: t.dark, light: t.light, view: t.view }); refreshFrame(id); } }
      if (Object.keys(tones).length) commit('deco');
      ok = true; s.close();
    }))), onClose: () => res(ok ? pick : null) });
    paint();
  });
  return actionSheet(name, [{ value: 'none', label: '不戴', active: !cur }, ...list.map(x => ({ value: x.id, label: x.name, active: x.id === cur }))]);
}
export const decoName = (k, id) => find(k, id)?.name || '';

/* ---------- 抠图：要透明的部件（头像框、小图标…）传的图没有透明，就把和四周连着、颜色差不多的底色抠掉（纯色、渐变底好用，花底抠不干净） ---------- */
export const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
/** 抠底色：从图的四边、还有已经透明的地方往里走，和走过来的那一格颜色接近（t，渐变也跟得上）、离出发那一格的颜色也不太远（g）就当底色去掉 */
export function flood(x, w, H, t, g = 999) {
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
export async function cutout(url, g) {
  if (!/^data:image\//.test(url)) return url;
  const im = await loadImg(url), c = document.createElement('canvas'), w = c.width = im.naturalWidth, H = c.height = im.naturalHeight, x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  if (!opaque(x, w, H)) return url;   // 本来就有透明，不动
  flood(x, w, H, 60, g);
  return c.toDataURL('image/png');
}

/** 修抠图：手不用很准。「擦掉」随手涂一块：涂到三成以上的那一小块（水印、零星的点）整块去掉，别的只擦涂到的地方；
 *  「圈出要的」圈一圈：圈外的去掉，大半在圈里的那块整块留下（圈歪了也不会切掉边）。能撤销、重来。返回新图，取消返回 null */
export async function touchUp(url, title = '修图') {
  const { sheet, btn, segmented } = await import('./ui.js'), im = await loadImg(url), W = im.naturalWidth, H = im.naturalHeight;
  const c = h('canvas.as-touch__img', { width: W, height: H }), ink = h('canvas.as-touch__ink', { width: W, height: H }), x = c.getContext('2d'), g = ink.getContext('2d');
  x.drawImage(im, 0, 0);
  const first = x.getImageData(0, 0, W, H), hist = [];
  let mode = 'erase', pts = null, k = 1;
  const at = e => { const r = c.getBoundingClientRect(); k = W / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };
  const trace = (ctx, close) => { ctx.beginPath(); pts.forEach(([u, v], i) => (i ? ctx.lineTo(u, v) : ctx.moveTo(u, v))); if (close) ctx.closePath(); };
  const draw = () => { g.clearRect(0, 0, W, H); g.lineCap = g.lineJoin = 'round'; g.strokeStyle = mode === 'erase' ? 'rgba(255,70,90,.45)' : 'rgba(40,140,255,.9)'; g.lineWidth = mode === 'erase' ? 28 * k : 3 * k; if (mode === 'keep') g.setLineDash([8 * k, 6 * k]); else g.setLineDash([]); trace(g); g.stroke(); };
  function apply() {
    const m = document.createElement('canvas'); m.width = W; m.height = H; const mx = m.getContext('2d');
    mx.lineCap = mx.lineJoin = 'round';
    if (mode === 'erase') { mx.lineWidth = 28 * k; trace(mx); mx.stroke(); if (pts.length === 1) { mx.arc(pts[0][0], pts[0][1], 14 * k, 0, 7); mx.fill(); } }
    else { if (pts.length < 3) return; trace(mx, true); mx.fill(); }
    const d = x.getImageData(0, 0, W, H), a = d.data, md = mx.getImageData(0, 0, W, H).data, lab = new Int32Array(W * H), tot = [0], hit = [0];
    // 一块一块找出来（不透明、连在一起的算一块），数每块有多少被涂到 / 圈到
    for (let p = 0, n = 0; p < W * H; p++) if (!lab[p] && a[p * 4 + 3] > 40) {
      n++; tot[n] = hit[n] = 0; const q = [p]; lab[p] = n;
      while (q.length) {
        const v = q.pop(), i = v % W, j = (v - i) / W; tot[n]++; if (md[v * 4 + 3]) hit[n]++;
        for (const u of [v - 1, v + 1, v - W, v + W]) if (u >= 0 && u < W * H && !lab[u] && Math.abs((u % W) - i) <= 1 && a[u * 4 + 3] > 40) { lab[u] = n; q.push(u); }
      }
    }
    hist.push(d.data.slice());
    for (let p = 0; p < W * H; p++) {
      if (!a[p * 4 + 3]) continue;
      const l = lab[p], f = l ? hit[l] / tot[l] : 0, on = md[p * 4 + 3] > 0;
      if (mode === 'erase' ? f >= .3 || on : !(on || f >= .6)) a[p * 4 + 3] = 0;
    }
    x.putImageData(d, 0, 0);
  }
  c.onpointerdown = e => { c.setPointerCapture(e.pointerId); pts = [at(e)]; draw(); };
  c.onpointermove = e => { if (!pts) return; pts.push(at(e)); draw(); };
  c.onpointerup = c.onpointercancel = () => { if (!pts) return; apply(); pts = null; g.clearRect(0, 0, W, H); };
  const back = () => { const u = hist.pop(); if (u) x.putImageData(new ImageData(u, W, H), 0, 0); };
  return new Promise(done => {
    let out = null;
    const s = sheet({ title, content: h('div.as-touch__box', h('div.as-touch', c, ink),
      h('div.as-touch__bar', segmented([['erase', '擦掉'], ['keep', '圈出要的']], mode, v => { mode = v; }), btn('撤销', 'secondary', back), btn('重来', 'secondary', () => { hist.push(x.getImageData(0, 0, W, H).data.slice()); x.putImageData(first, 0, 0); })),
      h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('确定', 'primary', () => { out = c.toDataURL('image/png'); s.close(); }))),
      onClose: () => done(out) });
  });
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
/** 头像框染色：按原来的深浅，最深的地方是 dark、最浅的是 light，中间照比例过渡（蓝白、粉金都行）。出一张新图，原图留着能还原 */
export async function tintFrame(src, dark, light) {
  const im = await loadImg(src), c = document.createElement('canvas'), w = c.width = im.naturalWidth, H = c.height = im.naturalHeight, x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const rgb = s => { const n = parseInt(s.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }, D = rgb(dark), Lc = rgb(light);
  const d = x.getImageData(0, 0, w, H), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const L = (a[i] * .299 + a[i + 1] * .587 + a[i + 2] * .114) / 255;
    for (let k = 0; k < 3; k++) a[i + k] = D[k] + (Lc[k] - D[k]) * L;
  }
  x.putImageData(d, 0, 0); return c.toDataURL('image/png');
}
