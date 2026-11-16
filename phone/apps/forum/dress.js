// 论坛的主页装扮套装：一套 = 主页背景、头像框、名字旁的徽章、标签小图、底栏……全是图片。
// 图片大，套装和每个人单独换的图都存在 kv「forumSets」，不放进每次都整份保存的 state；state.forum.decos[人] 只记穿哪套（set）、单独换的那份（own）
import { h, uid, pickFile } from '../../core/util.js';
import { state, commit, kvGet, kvSet } from '../../core/store.js';
import { log } from '../../core/log.js';
import { page, group, item, input, field, btn, toast, actionSheet, dialog, icon, empty, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { loadImg, cutout, flood } from '../../core/deco.js';

// [编号, 叫法, 宽÷高, 长边像素, 留透明]
export const PIECES = [['cover', '主页背景', 1, 1200], ['tab', '标签小图', 1, 160, 1], ['tabline', '标签下的花边', 4, 320, 1],
  ['bar', '底栏背景', 0, 1200], ['btn', '底栏按钮小图', 0, 160, 1], ['like', '点赞特效', 1, 300, 1]];
// 底栏按钮一次传三张，按勾的顺序从左到右
// 主页背景最多九张，左右滑、自己轮播
const BTNS = ['btn', 'btn2', 'btn3'], COVERS = ['cover', ...'2345678'.split('').map(i => 'cover' + i), 'cover9'], KEYS = [...PIECES.map(p => p[0]), ...BTNS.slice(1), ...COVERS.slice(1)];
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
/** 换一样：返回 { 部件: 图 }（'' 是去掉），null 是没选。底栏背景、按钮小图不裁剪，按钮小图一次多选 */
async function upload(k, has) {
  const [, t, ratio, size, png] = PIECES.find(x => x[0] === k);
  if (k === 'cover') {
    const a = has ? await actionSheet(t, [{ value: 'pick', label: '换图' }, { value: 'del', label: '去掉', danger: true }]) : 'pick'; if (!a) return null;
    if (a === 'del') return Object.fromEntries(COVERS.map(c => [c, '']));
    const fs = (await pickMany()).slice(0, 9); if (!fs.length) return null;
    const out = Object.fromEntries(COVERS.map(c => [c, '']));
    for (const [i, f] of fs.entries()) out[COVERS[i]] = await shrink(f, size).catch(() => '');
    return out;
  }
  if (k === 'btn') {
    const fs = (await pickMany()).slice(0, 3); if (!fs.length) return null;
    const out = Object.fromEntries(BTNS.map(b => [b, '']));
    for (const [i, f] of fs.entries()) out[BTNS[i]] = await cutout(await shrink(f, size).catch(() => ''));
    return out;
  }
  let u;
  if (!ratio) { const f = await pickFile('image/*'); if (!f) return null; u = await shrink(f, size).catch(() => null); if (u == null) { toast('这张图打不开'); return null; } }
  else { u = await pickImage(t, { ratio, size, png: !!png, has }); if (u == null) return null; }
  if (u && png) u = await cutout(u);
  return { [k]: u };
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
  if (v === 'fade') { state.forum.decos[key] = { ...D(key), fade: !fade(key) }; commit('forum'); repaint(); }
  if (v === 'one') { const k = await actionSheet('换哪一样', PIECES.map(([k, t]) => ({ value: k, label: t }))); if (k) await dressOne(key, k, repaint); }
  if (v === 'save') saveSet(key);
}
/** 把身上这一身存成套装（存好在套装里能导出） */
export async function saveSet(key) {
  const imgs = Object.fromEntries(Object.entries(dressOf(key)).filter(([, x]) => /^data:image\//.test(x)));
  if (!Object.keys(imgs).length) { toast('还没有装扮'); return; }
  const name = ((await dialog({ title: '套装的名字', input: { placeholder: '名字' } })) || '').trim(); if (!name) return;
  SETS.push({ id: uid('fd'), name: name.slice(0, 20), imgs }); await saveSets(); toast('存好了');
}

/** 只换一样（背景、标签小图、底栏…），换在我单独的那份上，不动套装 */
export async function dressOne(key, k, repaint) {
  const got = await upload(k, !!dressOf(key)[k]); if (!got) return;
  const d = D(key); let own = setOf(d.own); if (!own) { own = { id: uid('fd'), own: true, name: '', imgs: {} }; SETS.push(own); state.forum.decos[key] = { ...d, own: own.id }; }
  for (const [x, u] of Object.entries(got)) if (u) own.imgs[x] = u; else { delete own.imgs[x]; delete state.forum.decos[key][x]; }
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
    const imgs = d && d.asterphone === 'forumDeco' && d.imgs ? Object.fromEntries(KEYS.map(k => [k, d.imgs[k]]).filter(([, x]) => typeof x === 'string' && /^data:image\//.test(x))) : {};
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
      const got = await upload(k, !!imgs[k]); if (!got) return;
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
  ['tabline', '标签下的花边', .41, 1.008, .085, .024, 'top'], ['btn', '底栏按钮小图', .075, .215, .1, .085, 'bottom'], ['bar', '底栏', 0, .09, 1, .09, 'bottom']];
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
