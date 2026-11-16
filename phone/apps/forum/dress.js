// 论坛的主页装扮套装：一套 = 主页背景、头像框、名字旁的徽章、标签小图、底栏……全是图片。
// 图片大，套装和每个人单独换的图都存在 kv「forumSets」，不放进每次都整份保存的 state；state.forum.decos[人] 只记穿哪套（set）、单独换的那份（own）
import { h, uid, pickFile } from '../../core/util.js';
import { state, commit, kvGet, kvSet } from '../../core/store.js';
import { log } from '../../core/log.js';
import { page, group, item, input, field, btn, toast, actionSheet, dialog, icon, empty, pickImage, cropImage, sheet, slider, colorWheel, fxRow, segmented } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { loadImg, cutout, flood, touchUp } from '../../core/deco.js';

// [编号, 叫法, 宽÷高, 长边像素, 留透明]
export const PIECES = [['cover', '主页背景', 1, 1200], ['tab', '标签小图', 1, 160, 1],
  ['bar', '底栏背景', 6.5, 1200], ['btn', '底栏按钮小图', 0, 160, 1], ['like', '点赞特效', 1, 300, 1],
  ['pinicon', '置顶图标', 1, 120, 1], ['pinbg', '置顶背景', 10.9, 900]];
// 底栏按钮一次传四张，按选的顺序从左到右（别人主页底下只有三个按钮，用前三张）
// 主页背景最多九张，左右滑、自己轮播
export const BTNS = ['btn', 'btn2', 'btn3', 'btn4'], COVERS = ['cover', ...'2345678'.split('').map(i => 'cover' + i), 'cover9'], KEYS = [...PIECES.map(p => p[0]), ...BTNS.slice(1), ...COVERS.slice(1), 'btnsize', 'btncolor', 'pincolor', 'barfill', 'pinbgfill', 'barcut', 'pinbgcut', 'tabsize', 'tabx', 'taby', ...BTNS.map(b => b + 'size'), 'tabmark', 'tabmarkcolor',
  ...[...COVERS, 'bar', 'pinbg'].flatMap(k => [k + 'src', k + 'box', k + 'fx'])];   // 背景图：框之前的原图（回来重新框）、框的地方、透明度亮度
// 能存进套装的：图，和底栏按钮的大小（btnsize，像素）
// 背景图的透明度、亮度（*fx）存成「不透明度,亮度」；底栏、置顶不用图时的纯色 / 渐变（*fill）存成「#颜色」或「#左,#右」
export const keep = (k, x) => typeof x === 'string' && (/size$/.test(k) ? /^\d+$/ : k === 'tabx' || k === 'taby' ? /^-?\d+$/ : k === 'tabmark' ? /^(bar|dots|none)$/ : /color$/.test(k) ? /^#[\da-f]{6}$/i : /fx$/.test(k) ? /^[\d.]+,[\d.]+$/ : /fill$/.test(k) ? /^#[\da-f]{6}(,#[\da-f]{6})?$/i : /box$/.test(k) ? /^\d+,\d+,\d+$/ : /cut$/.test(k) ? /^1$/ : /^data:image\//).test(x);
export const covers = dr => COVERS.map(k => dr[k]).filter(Boolean);
let SETS = null;
export const loadSets = async () => SETS ??= (await kvGet('forumSets').catch(e => { log('warn', '论坛', '读不到装扮：' + e.message); return null; })) || [];
const saveSets = () => kvSet('forumSets', SETS).catch(e => { toast('装扮没存上'); log('error', '论坛', '装扮没存上：' + e.message); });
export const sets = () => (SETS || []).filter(s => !s.own);
const setOf = id => id && (SETS || []).find(s => s.id === id);
const D = key => (state.forum.decos = state.forum.decos || {})[key] || {};
/** 这个人身上的装扮：以前单独换的背景、底栏、头像框 ← 穿的套装 ← 后来单独换的 */
export function dressOf(key) {
  const d = D(key), old = Object.fromEntries(['cover', 'bar', 'frame'].filter(k => d[k]).map(k => [k, d[k]]));
  const own = setOf(d.own)?.imgs || {}, base = { ...old, ...setOf(d.set)?.imgs };
  if (own.cover) COVERS.forEach(k => delete base[k]);   // 单独换了背景：套装里的那几张不再混进来
  return { ...base, ...own };
}
export const dressed = key => !!setOf(D(key).set);
/** 主页背景下沿往页面底色淡过去：默认开，有的装扮自带过渡就关掉 */
export const fade = key => D(key).fade !== false;
export const setFade = key => { state.forum.decos[key] = { ...D(key), fade: !fade(key) }; commit('forum'); };
const meKey = () => 'me:' + state.forum.cur;
export const hooks = {};   // 论坛开着时：穿上 / 脱下以后让「我」那页换图
/** 导入主页时：把带来的装扮存成一套新的，直接穿上 */
export async function wearNew(key, name, imgs) { await loadSets(); const s = { id: uid('fd'), name, imgs }; SETS.push(s); await saveSets(); state.forum.decos[key] = { set: s.id }; commit('forum'); hooks.worn?.(key); }
function wear(key, id) { state.forum.decos[key] = { ...D(key), set: id || '' }; commit('forum'); hooks.worn?.(key); }

const pickMany = () => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = true; i.onchange = () => res([...i.files]); i.click(); });
/** 不裁剪：按原比例缩到长边不超过 max */
async function shrink(f, max) {
  const u = URL.createObjectURL(f), im = await loadImg(u).finally(() => URL.revokeObjectURL(u)), k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/png');
}
/** 换一样：返回 { 部件: 图 }（'' 是去掉），null 是没选。has 是现在的图。底栏背景、按钮小图不裁剪，按钮小图一次多选；要抠底色的抠完先给你修一下 */
async function upload(k, has, all = {}) {
  const [, t, ratio, size, png] = PIECES.find(x => x[0] === k);
  if (FILLS.includes(k)) {
    const how = await actionSheet(t, [{ value: 'img', label: has ? '换一张图' : '用图片', icon: 'image' }, has && { value: 'edit', label: '调整这张图', icon: 'edit' }, { value: 'fill', label: '纯色 / 渐变', icon: 'palette' }].filter(Boolean)); if (!how) return null;
    // 抠过的图（蕾丝边这种）透明的地方露出底下的纯色 / 渐变，两样一起留着；整张照片就只用一样
    if (how === 'fill') { const f = await pickFill(t); return f && { [k + 'fill']: f, ...(!all[k + 'cut'] && { [k]: '' }) }; }
    const cut = how === 'edit' ? all[k + 'cut'] : await actionSheet('这张图', [{ value: '', label: '整张照片', icon: 'image' }, { value: '1', label: '抠掉底色（蕾丝边这种）', icon: 'edit' }]); if (cut == null) return null;
    const r = await bgCrop(k, how === 'edit' && all, ratio, size, cut); return r && { ...r, [k + 'cut']: cut, ...(!cut && { [k + 'fill']: '' }) };
  }
  if (png && has && k !== 'btn') {
    const a = await actionSheet(t, [{ value: 'pick', label: '换图', icon: 'image' }, { value: 'fix', label: '修图', icon: 'edit' }, { value: 'del', label: '去掉', icon: 'trash', danger: true }]); if (!a) return null;
    if (a === 'del') return { [k]: '' };
    if (a === 'fix') { const u = await touchUp(has, t); return u && { [k]: u }; }
    has = false;
  }
  if (['tab', 'pinicon', 'like'].includes(k)) { const how = await actionSheet(t, [{ value: 'one', label: '传一张', icon: 'image' }, { value: 'sheet', label: '从一张图里抠', icon: 'grid' }]); if (!how) return null; if (how === 'sheet') return pickFrom(k, size); }
  if (k === 'cover') return pickCovers(all, size);
  if (k === 'btn') {
    const how = await actionSheet(t, [{ value: 'one', label: '一张一张传', icon: 'image' }, { value: 'sheet', label: '从一张图里抠', icon: 'grid' }]); if (!how) return null;
    if (how === 'sheet') return pickFrom(k, size);
    const fs = (await pickMany()).slice(0, 4); if (!fs.length) return null;
    const out = Object.fromEntries(BTNS.map(b => [b, '']));
    for (const [i, f] of fs.entries()) { const u = await cutout(await shrink(f, size).catch(() => '')); out[BTNS[i]] = u && (await touchUp(u, `第 ${i + 1} 个按钮`) || u); }
    return out;
  }
  let u;
  if (!ratio) { const f = await pickFile('image/*'); if (!f) return null; u = await shrink(f, size).catch(() => null); if (u == null) { toast('这张图打不开'); return null; } }
  else { u = await pickImage(t, { ratio, size, png: !!png, has: !!has }); if (u == null) return null; }
  if (u && png) { u = await touchUp(await cutout(u), t); if (u == null) return null; }
  return { [k]: u };
}

// 底栏、置顶的横条：不用图也能用纯色、渐变（从左到右）
const FILLS = ['bar', 'pinbg'];
export const fillCss = v => v ? `linear-gradient(90deg, ${v.includes(',') ? v : v + ',' + v})` : '';
/** 挑纯色 / 渐变：上面一条预览，选「渐变」多出右边那个颜色；点圆点开色盘（带吸管） */
const pickFill = title => new Promise(done => {
  const c = ['#cfe6f5', '#f3f9fc']; let grad = false, v = null;
  const pv = h('div.as-fo-fillpv'), paint = () => { pv.style.background = fillCss(grad ? c.join() : c[0]); dots[1].hidden = !grad; dots.forEach((d, i) => { d.style.background = c[i]; }); };
  const dots = c.map((_, i) => h('button.as-deco-dot', { 'aria-label': i ? '右边的颜色' : grad ? '左边的颜色' : '颜色', onclick: () => sheet({ title: i ? '右边' : grad ? '左边' : '颜色', content: h('div.as-mu-color', colorWheel(c[i], x => { c[i] = x; paint(); })) }) }));
  const s = sheet({ title, content: h('div.as-fo-compose', pv, h('div.as-deco-tone', segmented([['', '纯色'], ['g', '渐变']], '', x => { grad = !!x; paint(); }), ...dots),
    h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('确定', 'primary', () => { v = grad ? c.join() : c[0]; s.close(); }))), onClose: () => done(v) });
  paint();
});
/** 字的颜色（底栏按钮、置顶）：色盘挑；左边那个按钮是不挑，用默认（底栏按钮跟着底栏图的颜色） */
// pv = { el 上面一条照着页面上那块复制的预览, live(颜色) 拖色盘时让预览马上变 }：抽屉会挡住页面上那块，不放预览就不知道挑的是什么样
const pickInk = (k, title, none, cur, pv) => new Promise(done => {
  let c = cur || '#ff8200', v = null;
  pv?.live(c);
  const s = sheet({ title, content: h('div', pv?.el, h('div.as-mu-color', colorWheel(c, x => { c = x; pv?.live(x); })),
    h('div.as-lib-actions.is-two', btn(none, 'secondary', () => { v = ''; s.close(); }), btn('确定', 'primary', () => { v = c; s.close(); }))), onClose: () => done(v == null ? null : { [k]: v }) });
});
/** 背景图（底栏、置顶、主页背景）：框选区域 + 透明度、亮度。from 给了就是调整已有的那张：从原图重新框（老图没存原图就拿框好的那张） */
async function bgCrop(k, from, ratio, size, cut) {
  const get = x => from && from[k + x], f = from ? get('src') || get('') : await pickFile('image/*'); if (!f) return null;
  const r = await cropImage(f, ratio, size, !!cut, { fx: (get('fx') || '1,1').split(',').map(Number), box: get('src') && get('box') && get('box').split(',').map(Number) });
  const img = r && cut ? await touchUp(await cutout(r.img), '抠图') : r?.img; if (!img) return null;   // 抠：框好以后抠掉底色，再给你修一下
  return { [k]: img, [k + 'src']: r.src, [k + 'box']: r.box.join(), [k + 'fx']: r.fx.join() };
}
/** 主页背景：最多九张，一格一格排着，「+」加（一次能多选，一张一张框选区域），右上 × 去掉；左右滑的顺序就是这里的顺序 */
const pickCovers = (all, size) => new Promise(done => {
  const list = COVERS.filter(c => all[c]).map(c => Object.fromEntries(['', 'src', 'box', 'fx'].map(x => [x, all[c + x] || '']))); let ok = false;
  const grid = h('div.as-fo-btnpick.is-covers'), draw = () => grid.replaceChildren(...list.map((e, i) => h('button', { 'aria-label': '第 ' + (i + 1) + ' 张', onclick: async ev => {
      if (ev.target.closest('.as-fo-btnpick__del')) return;
      const r = await bgCrop('', e, 1.83, size); if (r) { list[i] = r; draw(); }   // 点一张：回去重新框、调透明度亮度
    } }, h('img', { src: e[''], alt: '' }),
    h('i.as-fo-btnpick__del', { role: 'button', 'aria-label': '去掉', onclick: () => { list.splice(i, 1); draw(); } }, '×'))),
    list.length < 9 ? h('button.is-add', { 'aria-label': '加图', onclick: async () => {
      const fs = (await pickMany()).slice(0, 9 - list.length);
      for (const f of fs) { const r = await cropImage(f, 1.83, size, false, { fx: [1, 1] }); if (r) list.push({ '': r.img, src: r.src, box: r.box.join(), fx: r.fx.join() }); }   // 背景那一截照真微博是 393 × 212 左右
      draw();
    } }, icon('plus', 22, 2)) : null);
  const s = sheet({ title: '主页背景（最多 9 张）', content: h('div.as-fo-compose', grid, h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('确定', 'primary', () => { ok = true; s.close(); }))),
    onClose: () => done(ok ? Object.fromEntries(COVERS.flatMap((c, i) => ['', 'src', 'box', 'fx'].map(x => [c + x, list[i]?.[x] || '']))) : null) });
  draw();
});
/** 一张图里排着好几个小图：抠掉底色，按一块一块找出来（挨得近的并成一个），裁成小图 */
async function chop(url, size) {
  const im = await loadImg(url), W = im.naturalWidth, H = im.naturalHeight, k = Math.min(1, 240 / Math.max(W, H)), w = Math.round(W * k) || 1, hh = Math.round(H * k) || 1;
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, hh);
  const a = x.getImageData(0, 0, w, hh).data, seen = new Uint8Array(w * hh), solid = n => a[n * 4 + 3] > 40;
  let boxes = [];
  for (let p = 0; p < w * hh; p++) if (!seen[p] && solid(p)) {
    const q = [p], b = [w, hh, 0, 0]; seen[p] = 1;
    while (q.length) {
      const v = q.pop(), i = v % w, j = (v - i) / w; b[0] = Math.min(b[0], i); b[1] = Math.min(b[1], j); b[2] = Math.max(b[2], i); b[3] = Math.max(b[3], j);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj, n = jj * w + ii; if (ii >= 0 && jj >= 0 && ii < w && jj < hh && !seen[n] && solid(n)) { seen[n] = 1; q.push(n); } }
    }
    boxes.push(b);
  }
  // 翅膀的左右两半、爱心旁边的小星星：隔得近就算一个
  const g = Math.round(Math.max(w, hh) * .025), near = (A, B) => A[0] - g <= B[2] && B[0] - g <= A[2] && A[1] - g <= B[3] && B[1] - g <= A[3];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (near(boxes[i], boxes[j])) {
    const A = boxes[i], B = boxes.splice(j, 1)[0]; boxes[i] = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])]; i = -1; break;
  }
  // 太小、太细的（水印、分隔线、零星的点）不要；按从上到下、从左到右排
  const min = Math.max(w, hh) * .04, row = b => Math.floor((b[1] + b[3]) / 2 / (hh * .2));
  boxes = boxes.filter(b => b[2] - b[0] >= min && b[3] - b[1] >= min).sort((A, B) => row(A) - row(B) || A[0] - B[0]);
  return boxes.map(b => {
    const sx = Math.max(0, b[0] / k - 2), sy = Math.max(0, b[1] / k - 2), sw = Math.min(W - sx, (b[2] + 1) / k + 4 - sx), sh = Math.min(H - sy, (b[3] + 1) / k + 4 - sy), z = Math.min(1, size / Math.max(sw, sh));
    const o = document.createElement('canvas'); o.width = Math.round(sw * z) || 1; o.height = Math.round(sh * z) || 1;
    o.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, o.width, o.height); return o.toDataURL('image/png');
  });
}
/** 传一张排着好几个小图的图，抠出来让你挑：底栏按钮点几个（按点的顺序从左到右，最多四个）还能调大小；标签小图挑一个 */
async function pickFrom(k, size) {
  const f = await pickFile('image/*'); if (!f) return null;
  const all = await chop(await cutout(await shrink(f, 1200), 36), size).catch(e => { log('warn', '论坛', '抠按钮小图失败：' + e.message); return []; });
  if (!all.length) { toast('这张图里没抠出东西'); return null; }
  const many = k === 'btn';
  return new Promise(done => {
    const on = [];
    let z = 26, ok = false;   // 和原来的图标差不多大
    const bar = h('div.as-fo-btnpv'), set = () => bar.style.setProperty('--fo-btnz', z + 'px');
    const paint = () => {
      grid.querySelectorAll('button').forEach((b, i) => { const n = on.indexOf(i); b.classList.toggle('is-on', n >= 0); b.dataset.n = n >= 0 ? n + 1 : ''; });
      bar.replaceChildren(...[0, 1, 2, 3].map(i => h('i', { style: { backgroundImage: on[i] == null ? '' : `url("${all[on[i]]}")` } })));
    };
    const grid = h('div.as-fo-btnpick', all.map((u, i) => { const img = h('img', { src: u, alt: '' }); return h('button', { 'aria-label': '第 ' + (i + 1) + ' 个', onclick: e => {
      if (e.target.closest('.as-fo-btnpick__fix')) return;
      const n = on.indexOf(i); if (n >= 0) on.splice(n, 1); else if (!many) on.splice(0, 1, i); else if (on.length < 4) on.push(i); else { toast('最多四个'); return; }
      paint();
    } }, img, h('i.as-fo-btnpick__fix', { role: 'button', 'aria-label': '修图', onclick: async () => { const v = await touchUp(all[i], '修这个'); if (v) { all[i] = img.src = v; paint(); } } }, '修')); }));
    const s = sheet({ title: many ? '选底栏按钮' : '选一个', content: h('div.as-fo-compose', grid, many && bar, many && field('大小', slider({ min: 18, max: 44, step: 1, value: z, onInput: v => { z = v; set(); } })),
      h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => s.close()), btn('确定', 'primary', () => { if (!on.length) { toast('点一个'); return; } ok = true; s.close(); }))),
      onClose: () => done(!ok ? null : many ? { ...Object.fromEntries(BTNS.map((b, i) => [b, on[i] == null ? '' : all[on[i]]])), btnsize: String(z) } : { [k]: all[on[0]] }) });
    set(); paint();
  });
}

/** 主页右上「…」→ 装扮：穿套装 / 脱下 / 单独换一样 / 存成套装 */
export async function dressMenu(key, repaint) {
  const d = D(key), v = await actionSheet('装扮', [{ value: 'set', label: '穿上套装', icon: 'palette' }, d.set && { value: 'off', label: '脱下套装', icon: 'close' },
    dressOf(key).cover && { value: 'fade', label: fade(key) ? '背景不要渐变' : '背景加渐变', icon: 'image' },
    { value: 'one', label: '单独换一样', icon: 'image' }, { value: 'save', label: '存成套装', icon: 'box' }].filter(Boolean));
  if (v === 'set') {
    if (!sets().length) { toast('还没有套装，先去「装扮」里新建或导入'); return; }
    const id = await actionSheet('穿哪套', sets().map(s => ({ value: s.id, label: s.name, active: s.id === d.set }))); if (!id) return;
    wear(key, id); repaint();
  }
  if (v === 'off') { wear(key, ''); repaint(); }
  if (v === 'fade') { setFade(key); repaint(); }
  if (v === 'one') { const k = await actionSheet('换哪一样', PIECES.map(([k, t]) => ({ value: k, label: t }))); if (k) await dressOne(key, k, repaint); }
  if (v === 'save') saveSet(key);
}
/** 把身上这一身存成套装（存好在套装里能导出） */
export async function saveSet(key) {
  const imgs = Object.fromEntries(Object.entries(dressOf(key)).filter(([k, x]) => keep(k, x)));
  if (!Object.keys(imgs).length) { toast('还没有装扮'); return; }
  const name = ((await dialog({ title: '套装的名字', input: { placeholder: '名字' } })) || '').trim(); if (!name) return;
  SETS.push({ id: uid('fd'), name: name.slice(0, 20), imgs }); await saveSets(); toast('存好了');
}

/** 单独换的那份（不动穿着的套装）：没有就新建一份 */
function ownOf(key) {
  const d = D(key); let own = setOf(d.own); if (!own) { own = { id: uid('fd'), own: true, name: '', imgs: {} }; SETS.push(own); state.forum.decos[key] = { ...d, own: own.id }; }
  return own;
}
/** 直接改几样设置（大小、距离、线的样子…），记在我单独的那份上 */
export async function setOwn(key, o) { Object.assign(ownOf(key).imgs, o); await saveSets(); commit('forum'); }
/** 只换一样（背景、标签小图、底栏…），换在我单独的那份上，不动套装 */
export async function dressOne(key, k, repaint, pv) {
  const got = k === 'btncolor' ? await pickInk(k, '底栏按钮的字', '跟着底栏', dressOf(key)[k], pv) : k === 'pincolor' ? await pickInk(k, '「置顶」两个字', '用默认', dressOf(key)[k], pv) : await upload(k, dressOf(key)[k], dressOf(key)); if (!got) return;
  const own = ownOf(key);
  // 去掉的那样：穿着的套装里也有，就记成空的盖住它（不然换成纯色了，套装里的图还露出来）
  const base = { ...setOf(D(key).set)?.imgs, ...state.forum.decos[key] };
  for (const [x, u] of Object.entries(got)) if (u) own.imgs[x] = u; else if (base[x]) own.imgs[x] = ''; else delete own.imgs[x];
  await saveSets(); commit('forum'); repaint();
}

/* ---------- 套装卡片：资源库 → 应用 → 论坛、论坛首页右上「装扮」两个地方都是这个。点一下穿到我身上（只换勾），「…」编辑 / 导出 / 删除 ---------- */
export function setTiles() {
  const box = h('div');
  const draw = () => {
    const tile = s => h('button' + (s.id === D(meKey()).set ? '.is-on' : ''), { dataset: { k: s.id }, 'aria-label': s.name, onclick: () => {
      const on = D(meKey()).set === s.id; wear(meKey(), on ? '' : s.id); toast(on ? '脱下了' : '穿上了');
      box.querySelectorAll('.as-lib-chatskins > button').forEach(b => b.classList.toggle('is-on', !on && b.dataset.k === s.id));
    } }, h('span.as-lib-chatskins__mock.as-fo-settile', { style: { backgroundImage: s.imgs.cover ? `url("${s.imgs.cover}")` : '' } }),
    h('em', s.name), h('span.as-fo-looktile__more', { role: 'button', 'aria-label': s.name + '更多', onclick: e => { e.stopPropagation(); menu(s); } }, icon('more', 16, 2.4)));
    box.replaceChildren(group('装扮套装', [sets().length ? h('div.as-lib-chatskins', sets().map(tile)) : empty('还没有套装')]),
      h('div.as-lib-actions', btn('导入套装文件', 'secondary', importSet), btn('从截图拆', 'secondary', () => split(draw)), btn('新建', 'primary', () => { const s = { id: uid('fd'), name: '我的套装', imgs: {} }; editSet(s, true, draw); })));
  };
  async function menu(s) {
    const v = await actionSheet(s.name, [{ value: 'edit', label: '编辑', icon: 'edit' }, { value: 'out', label: '导出', icon: 'box' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
    if (v === 'edit') editSet(s, false, draw);
    if (v === 'out') {
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ asterphone: 'forumDeco', v: 1, name: s.name, imgs: s.imgs })], { type: 'application/json' })), download: `AsterPhone-论坛装扮-${s.name}.json` });
      document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
    }
    if (v === 'del' && await dialog({ title: `删除「${s.name}」？`, confirm: '删除', danger: true })) { SETS.splice(SETS.indexOf(s), 1); await saveSets(); draw(); }
  }
  async function importSet() {
    const f = await pickFile('*/*'); if (!f) return;
    let d = null; try { d = JSON.parse(await f.text()); } catch (e) { /* 下面统一说 */ }
    const imgs = d && d.asterphone === 'forumDeco' && d.imgs ? Object.fromEntries(KEYS.map(k => [k, d.imgs[k]]).filter(([k, x]) => keep(k, x))) : {};
    if (!Object.keys(imgs).length) { toast('这不是 AsterPhone 的论坛装扮'); return; }
    SETS.push({ id: uid('fd'), name: String(d.name || '套装').slice(0, 20), imgs }); await saveSets(); draw(); toast(`导入了「${String(d.name || '套装').slice(0, 20)}」`);
  }
  loadSets().then(draw);
  return box;
}
/** 编辑一套：名字 + 每一样点了换图 / 删除；底下「取消 | 保存」 */
function editSet(s, isNew, done) {
  const p = page({ app: 'library', id: 'library-forum-set', title: s.name, back: true }), imgs = { ...s.imgs }, name = input({ value: s.name, placeholder: '名字' });
  const rows = PIECES.map(([k, t]) => {
    const prev = h('img.as-fo-lookimg', { alt: '', hidden: !imgs[k] }); if (imgs[k]) prev.src = imgs[k];
    return item({ title: t, right: prev, chevron: true, onClick: async () => {
      const got = await upload(k, imgs[k], imgs); if (!got) return;
      for (const [x, u] of Object.entries(got)) if (u) imgs[x] = u; else delete imgs[x];
      prev.hidden = !imgs[k]; if (imgs[k]) prev.src = imgs[k];
    } });
  });
  p.body.append(group('', [field('名字', name)]), group('', rows), h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', async () => {
    s.name = name.value.trim().slice(0, 20) || '我的套装'; s.imgs = imgs; if (isNew) SETS.push(s);
    await saveSets(); toast('已保存'); nav.pop(); done();
  })));
  nav.push(p.el);
}
/* ---------- 从截图拆：整张截图铺开，按微博主页常见的位置先摆好几个框，拖一拖、拉一拉大小，点「完成」一次切好变成一个新套装 ---------- */
// 框：[部件, 叫法, 左, 上, 宽, 高]，都是截图宽度的几分之几；top 从内容最上面量、bottom 从最下面量
const BOXES = [['cover', '背景', 0, .25, 1, .22, 'top'], ['tab', '标签小图', .36, .95, .07, .065, 'top'],
  ['btn', '底栏按钮小图', .075, .215, .1, .085, 'bottom'], ['bar', '底栏', 0, .09, 1, .09, 'bottom']];
async function split(done) {
  const f = await pickFile('image/*'); if (!f) return;
  const url = URL.createObjectURL(f), im = await loadImg(url).catch(() => null);
  if (!im) { toast('这张图打不开'); return; }
  // 去掉相册看大图时上下的黑边
  const c = document.createElement('canvas'), W = c.width = im.naturalWidth, H = c.height = im.naturalHeight, x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const dark = j => { const r = x.getImageData(0, j, W, 1).data; let n = 0; for (let i = 0; i < r.length; i += 16) n += r[i] + r[i + 1] + r[i + 2] < 150; return n > W / 4 * .6; };   // 黑边上有时间、「3/4」这些小字，六成是黑的就算
  let y0 = 0, y1 = H - 1; while (y0 < H / 2 && dark(y0)) y0++; while (y1 > H / 2 && dark(y1)) y1--;
  const p = page({ app: 'library', id: 'library-forum-split', title: '从截图拆', back: true });
  const stage = h('div.as-fo-split', h('img', { src: url, alt: '', style: { marginTop: -y0 / W * 100 + '%' } }));
  stage.style.aspectRatio = `${W} / ${y1 - y0 + 1}`;
  const boxes = BOXES.map(([k, t, l, tp, bw, bh, from]) => {
    const top = from === 'top' ? tp : (y1 - y0) / W - tp;
    const b = h('div.as-fo-split__box', { dataset: { k } }, h('span', t), h('i.as-fo-split__x', { role: 'button', 'aria-label': '不要这块', onclick: e => { e.stopPropagation(); b.remove(); } }, '×'), h('i.as-fo-split__size'));
    Object.assign(b.style, { left: l * 100 + '%', top: top * W / (y1 - y0) * 100 + '%', width: bw * 100 + '%', height: bh * W / (y1 - y0) * 100 + '%' });
    drag(b, false); return b;
  });
  stage.append(...boxes);
  function drag(b, square) {
    let s = null;
    b.onpointerdown = e => { if (e.target.closest('.as-fo-split__x')) return; b.setPointerCapture(e.pointerId); const r = stage.getBoundingClientRect(); s = { x: e.clientX, y: e.clientY, r, l: b.offsetLeft, t: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight, size: !!e.target.closest('.as-fo-split__size') }; };
    b.onpointermove = e => {
      if (!s) return; const dx = e.clientX - s.x, dy = e.clientY - s.y, R = s.r;
      if (s.size) { const w = Math.max(16, s.w + dx), hh = square ? w : Math.max(10, s.h + dy); b.style.width = w / R.width * 100 + '%'; b.style.height = hh / R.height * 100 + '%'; }
      else { b.style.left = Math.min(R.width - s.w, Math.max(0, s.l + dx)) / R.width * 100 + '%'; b.style.top = Math.min(R.height - s.h, Math.max(0, s.t + dy)) / R.height * 100 + '%'; }
    };
    b.onpointerup = b.onpointercancel = () => { s = null; };
  }
  p.body.append(stage, h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => nav.pop()), btn('完成', 'primary', async () => {
    const imgs = {};
    for (const b of stage.querySelectorAll('.as-fo-split__box')) {
      const k = b.dataset.k, [, , , size] = PIECES.find(z => z[0] === k), r = stage.getBoundingClientRect(), k2 = W / r.width;
      const sx = b.offsetLeft * k2, sy = y0 + b.offsetTop * k2, sw = b.offsetWidth * k2, sh = b.offsetHeight * k2, z = Math.min(1, size / Math.max(sw, sh));
      // 背景：框上面到截图顶那一截（印着时间、按钮，不能要）用框的第一行颜色补上，这样图还在原来的高度
      const up = k === 'cover' ? Math.round((sy - y0) * z) : 0;
      const o = document.createElement('canvas'); o.width = Math.round(sw * z); o.height = Math.round(sh * z) + up;
      const g = o.getContext('2d'); g.drawImage(im, sx, sy, sw, sh, 0, up, o.width, o.height - up);
      if (up) { const row = document.createElement('canvas'); row.width = 6; row.height = 1; row.getContext('2d').drawImage(im, sx, sy, sw, 8, 0, 0, 6, 1); g.drawImage(row, 0, 0, 6, 1, 0, 0, o.width, up); }   // 缩成 6 个点再拉开：只留颜色，不把星星拉成竖条
      // 头像框：圈外不要，从外往里把底色抠掉，再把中间头像那一圈挖空。小图标也抠底色
      const png = PIECES.find(z2 => z2[0] === k)[4];
      if (png) {
        flood(g, o.width, o.height, 25, 60);   // 截图里的底是花的，抠得保守一点
        // 抠完只剩零星几个点（那一块其实没装扮）：不要，不然标签下面会多出几粒小黑点
        const a = g.getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 3; i < a.length; i += 4) if (a[i] > 128) n++;
        if (n < a.length / 4 * .04) continue;
      }
      imgs[k] = png ? o.toDataURL('image/png') : o.toDataURL('image/jpeg', .9);
    }
    if (!Object.keys(imgs).length) { toast('没有框'); return; }
    const set = { id: uid('fd'), name: '截图拆的', imgs };
    SETS.push(set); await saveSets(); URL.revokeObjectURL(url); nav.pop(); done(); toast('拆好了，缺的自己传');
    editSet(set, false, done);
  })));
  nav.push(p.el);
}
