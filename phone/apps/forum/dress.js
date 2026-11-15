// 论坛的主页装扮套装：一套 = 主页背景、头像框、名字旁的徽章、标签小图、底栏……全是图片。
// 图片大，套装和每个人单独换的图都存在 kv「forumSets」，不放进每次都整份保存的 state；state.forum.decos[人] 只记穿哪套（set）、单独换的那份（own）
import { h, uid, pickFile } from '../../core/util.js';
import { state, commit, kvGet, kvSet } from '../../core/store.js';
import { log } from '../../core/log.js';
import { deco, pickDeco } from '../../core/deco.js';
import { page, group, item, input, field, btn, toast, actionSheet, dialog, icon, empty, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';

// [编号, 叫法, 宽÷高, 长边像素, 留透明]
export const PIECES = [['cover', '主页背景', 1, 1200], ['frame', '头像框', 1, 400, 1], ['badge', '名字旁的徽章', 3, 300, 1], ['tab', '标签小图', 1, 160, 1], ['tabline', '标签下的花边', 4, 320, 1],
  ['bar', '底栏', 5.6, 1200], ['btn', '底栏按钮小图', 1, 160, 1], ['follow', '关注按钮', 3.7, 600, 1], ['card', '卡片背景', 2, 1000], ['sticker', '卡片贴纸', 1, 240, 1],
  ['bubble', '评论气泡', 3, 600, 1], ['like', '点赞特效', 1, 300, 1]];
let SETS = null;
export const loadSets = async () => SETS ??= (await kvGet('forumSets').catch(e => { log('warn', '论坛', '读不到装扮：' + e.message); return null; })) || [];
const saveSets = () => kvSet('forumSets', SETS).catch(e => { toast('装扮没存上'); log('error', '论坛', '装扮没存上：' + e.message); });
export const sets = () => (SETS || []).filter(s => !s.own);
const setOf = id => id && (SETS || []).find(s => s.id === id);
const D = key => (state.forum.decos = state.forum.decos || {})[key] || {};
/** 这个人身上的装扮：以前单独换的背景、底栏、头像框 ← 穿的套装 ← 后来单独换的 */
export function dressOf(key) {
  const d = D(key), old = Object.fromEntries(['cover', 'bar', 'frame'].filter(k => d[k]).map(k => [k, d[k]]));
  return { ...old, ...setOf(d.set)?.imgs, ...setOf(d.own)?.imgs };
}
export const dressed = key => !!setOf(D(key).set);
const meKey = () => 'me:' + state.forum.cur;
function wear(key, id) { state.forum.decos[key] = { ...D(key), set: id || '' }; commit('forum'); }

/** 主页右上「…」→ 装扮：穿套装 / 脱下 / 单独换一样 / 存成套装 */
export async function dressMenu(key, repaint) {
  const d = D(key), v = await actionSheet('装扮', [{ value: 'set', label: '穿上套装', icon: 'palette' }, d.set && { value: 'off', label: '脱下套装', icon: 'close' },
    { value: 'one', label: '单独换一样', icon: 'image' }, { value: 'save', label: '存成套装', icon: 'box' }].filter(Boolean));
  if (v === 'set') {
    if (!sets().length) { toast('还没有套装，先去「装扮」里新建或导入'); return; }
    const id = await actionSheet('穿哪套', sets().map(s => ({ value: s.id, label: s.name, active: s.id === d.set }))); if (!id) return;
    wear(key, id); repaint();
  }
  if (v === 'off') { wear(key, ''); repaint(); }
  if (v === 'one') {
    const k = await actionSheet('换哪一样', PIECES.map(([k, t]) => ({ value: k, label: t }))); if (!k) return;
    const [, t, ratio, size, png] = PIECES.find(x => x[0] === k), cur = dressOf(key)[k];
    // 头像框也能用资源库里的
    const how = k === 'frame' && deco().frames.length ? await actionSheet(t, [{ value: 'lib', label: '从资源库选', icon: 'palette' }, { value: 'up', label: '传一张图', icon: 'image' }]) : 'up';
    if (!how) return;
    let u;
    if (how === 'lib') { const r = await pickDeco('frames', cur); if (r == null) return; u = r === 'none' ? '' : r; }
    else u = await pickImage(t, { ratio, size, png: !!png, has: !!cur });
    if (u == null) return;
    let own = setOf(d.own); if (!own) { own = { id: uid('fd'), own: true, name: '', imgs: {} }; SETS.push(own); state.forum.decos[key] = { ...D(key), own: own.id }; }
    if (u) own.imgs[k] = u; else { delete own.imgs[k]; delete state.forum.decos[key][k]; }
    await saveSets(); commit('forum'); repaint();
  }
  if (v === 'save') {
    const name = ((await dialog({ title: '套装的名字', input: { placeholder: '名字' } })) || '').trim(); if (!name) return;
    const imgs = Object.fromEntries(Object.entries(dressOf(key)).filter(([, x]) => /^data:image\//.test(x)));
    if (!Object.keys(imgs).length) { toast('还没有装扮'); return; }
    SETS.push({ id: uid('fd'), name: name.slice(0, 20), imgs }); await saveSets(); toast('存好了');
  }
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
      h('div.as-lib-actions.is-two', btn('导入', 'secondary', importSet), btn('新建', 'primary', () => { const s = { id: uid('fd'), name: '我的套装', imgs: {} }; editSet(s, true, draw); })));
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
    const imgs = d && d.asterphone === 'forumDeco' && d.imgs ? Object.fromEntries(PIECES.map(([k]) => [k, d.imgs[k]]).filter(([, x]) => typeof x === 'string' && /^data:image\//.test(x))) : {};
    if (!Object.keys(imgs).length) { toast('这不是 AsterPhone 的论坛装扮'); return; }
    SETS.push({ id: uid('fd'), name: String(d.name || '套装').slice(0, 20), imgs }); await saveSets(); draw(); toast(`导入了「${String(d.name || '套装').slice(0, 20)}」`);
  }
  loadSets().then(draw);
  return box;
}
/** 编辑一套：名字 + 每一样点了换图 / 删除；底下「取消 | 保存」 */
function editSet(s, isNew, done) {
  const p = page({ app: 'library', id: 'library-forum-set', title: s.name, back: true }), imgs = { ...s.imgs }, name = input({ value: s.name, placeholder: '名字' });
  const rows = PIECES.map(([k, t, ratio, size, png]) => {
    const prev = h('img.as-fo-lookimg', { alt: '', hidden: !imgs[k] }); if (imgs[k]) prev.src = imgs[k];
    return item({ title: t, right: prev, chevron: true, onClick: async () => {
      const u = await pickImage(t, { ratio, size, png: !!png, has: !!imgs[k] }); if (u == null) return;
      if (u) { imgs[k] = u; prev.src = u; prev.hidden = false; } else { delete imgs[k]; prev.hidden = true; }
    } });
  });
  p.body.append(group('', [field('名字', name)]), group('', rows), h('div.as-lib-actions.is-two', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', async () => {
    s.name = name.value.trim().slice(0, 20) || '我的套装'; s.imgs = imgs; if (isNew) SETS.push(s);
    await saveSets(); toast('已保存'); nav.pop(); done();
  })));
  nav.push(p.el);
}
/** 论坛首页右上「装扮」 */
export function openDress() {
  const p = page({ app: 'forum', id: 'forum-dress', title: '装扮', back: true });
  p.body.append(h('div.as-fo-set', setTiles()));
  nav.push(p.el);
}
