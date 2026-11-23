// 备忘录：你自己的。样子和查手机里 TA 的「备忘录」是同一套（peek/apps.js 的 VIEWS.备忘录），这里多了能写、能勾、能删、能选和谁共用。
// 一条存成一行（和 AI 写的 TA 的备忘录同一个样子）：[便签 / 清单 / 共用, 标题, 年/月/日 时:分, 文件夹（共用的是那个人的名字）, 正文（// 分行）, 共用的人的 id]
import { h } from '../../core/util.js';
import { state, commit, contact, friends } from '../../core/store.js';
import { icon, dialog, actionSheet } from '../../core/ui.js';
import { myName } from '../../core/promptstore.js';
import { liveTr, myOut, myLang } from '../../core/translate.js';
import * as time from '../../core/time.js';
import * as nav from '../../core/nav.js';
import { shell } from '../../core/shell.js';
import { nameOf } from '../chat/engine.js';
import { VIEWS, iosPage, gone } from '../peek/apps.js';

const N = () => state.notes, save = () => { commit('notes'); shell.refreshBadges(); }, flat = x => [x].flat(3).filter(Boolean);
// 开着的每一页和它怎么画：改了东西，被盖在下面的那几页趁看不见先换好，露出来就是新的
const layers = [], fresh = (L = layers) => L.forEach(l => l.body.replaceChildren(...flat(l.fill())));
function push(t, fill, cls = '') {
  const { el, body } = iosPage('memo', 'memo-' + layers.length, cls.replace(/^is-raw/, '')), l = { body, fill: typeof fill === 'function' ? fill : () => fill }, off = el._onLeave;
  el._onLeave = () => { off(); layers.splice(layers.indexOf(l), 1); };
  layers.push(l); body.append(...flat(l.fill())); layers.length > 1 && nav.push(el); return el;
}
const D = {
  // 右下角的写字键：在一条里是改这一条，在列表里是新写一条（放进现在这个文件夹）
  write: x => { if (Array.isArray(x)) return edit(x); const r = ['便签', '', time.stampText(time.stamp()), x || '', '']; N().push(r); edit(r); },
  // 新建文件夹：起个名字，接着在里面写第一条（一条都没有的文件夹不留）
  folder: async () => { const n = await dialog({ title: '新建文件夹', input: { placeholder: '名称' }, confirm: '好' }); if (n && n.trim()) D.write(n.trim()); },
  seen: r => { r[6] = 0; save(); },
  keep: () => { save(); fresh(layers.slice(0, -1)); },
  tick: (r, i, dot) => { const L = r[4].split('//').map(x => x.trim()).filter(Boolean), on = !dot.classList.contains('is-done');
    L[i] = L[i].replace(/[√✓✔☑○◯□☐]/, on ? '√' : '○'); r[4] = L.join('//'); save(); dot.classList.toggle('is-done', on); fresh(layers.slice(0, -1)); },
  del: async (r, w) => { if (!await dialog({ title: '删除这条备忘录？', confirm: '删除', danger: true })) return; N().splice(N().indexOf(r), 1); save(); gone(w); fresh(layers.slice(0, -1)); },
  // 和谁共用：选了人，这条就成了你俩一起记的（每行前面标着谁写的）；不共用就变回自己的
  share: async r => { const who = await actionSheet('和谁共用', [{ value: 'off', label: '不共用', active: r[0] !== '共用' }, ...friends().map(c => ({ value: c.id, label: nameOf(c), active: r[5] === c.id }))]); if (!who) return;
    const me = myName() + '：', L = r[4].split('//').filter(Boolean), c = contact(who);
    if (c) { r[4] = L.map(x => named(r, x) ? x : me + x).join('//'); r[0] = '共用'; r[3] = nameOf(c); r[5] = c.id; }
    else if (r[0] === '共用') { r[4] = L.map(x => x.replace(/^[^：:]{1,12}[：:]\s*/, '')).join('//'); r[0] = kind(r[4]); r[3] = ''; r[5] = ''; r[6] = 0; }
    save(); fresh(); },
};
const kind = body => /(^|\/\/)\s*[○√]/.test(body) ? '清单' : '便签';
const named = (r, x) => [myName(), r[3]].some(n => n && x.startsWith(n + '：'));
// 外语的行存成「外文[翻译：中文]」（「译」能换）：改的时候摆中文，没动过的行原样留着，改了、新写的按映像里我说的语言重翻
// 一行前面不翻的那截：共用的「谁：」、清单的 ○ √、「划掉：」（只认我们自己加的，外文里本来有的冒号不算）
const TR = /\s*\[翻译：([^\]]*)\]/;
const pre = (x, r) => { const n = r[0] === '共用' && [myName(), r[3]].find(n => n && x.startsWith(n + '：')), a = n ? n.length + 1 : 0; return x.slice(0, a + /^([○√]\s*)?(划掉[:：]\s*)?/.exec(x.slice(a))[0].length); };
const cn = (x, r) => { const m = TR.exec(x); return m ? pre(x, r) + m[1] : x; };
// 写一条：标题一行，正文一格（一行就是一行）；返回就存好，两格都空着的不留
function edit(r) {
  const { el, body } = iosPage('memo', 'memo-edit', '.pk-nt.is-doc'), off = el._onLeave;
  const was = new Map([[cn(r[1], r), r[1]], ...r[4].split('//').map(x => [cn(x, r), x])]);
  const t = h('input.pk-nt__t', { value: cn(r[1], r), placeholder: '标题', 'aria-label': '标题' }), ta = h('textarea.pk-nt__ta', { placeholder: '写点什么', 'aria-label': '正文', rows: 6 });
  ta.value = r[4].split('//').map(x => cn(x, r)).join('\n');
  const tr = liveTr(ta);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  // 清单键：光标在的那一行前面加一个 ○，已经有就拿掉
  const todo = () => { const i = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1, m = /^[○√] ?/.exec(ta.value.slice(i)); ta.setRangeText(m ? '' : '○ ', i, i + (m ? m[0].length : 0), 'end'); grow(); ta.focus(); };
  ta.addEventListener('input', grow);
  el._onLeave = async () => { off();
    const L = ta.value.split('\n').map(x => x.trim()).filter(Boolean), old = r[1] + '|' + r[4];
    const out = async x => { if (was.has(x)) return was.get(x); if (!myLang()) return x; const p = pre(x, r), [o, z] = await myOut(x.slice(p.length)); return z ? `${p}${o}[翻译：${z}]` : x; };
    const title = t.value.trim();   // 标题框空着就是没有标题（列表里拿第一行当标题，和 iPhone 一样）
    r[1] = title && await out(title); r[4] = (await Promise.all(L.map(x => out(r[0] === '共用' && !named(r, x) ? myName() + '：' + x : x)))).join('//');
    if (r[0] !== '共用') r[0] = kind(r[4]);
    if (!r[1] && !r[4]) N().splice(N().indexOf(r), 1); else if (old !== r[1] + '|' + r[4]) r[2] = time.stampText(time.stamp());
    save(); fresh(); };
  body.append(h('div.pk-top2', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: () => nav.back() }, icon('back', 24, 2.4)), h('button.pk-glass', { onclick: () => nav.back() }, '完成')), t, ta, tr.box,
    h('div.pk-float', h('button.pk-glass', { onclick: todo }, '○ 清单'), h('i')));
  nav.push(el); requestAnimationFrame(grow); (r[1] ? ta : t).focus({ preventScroll: true });
}
export function open() {
  layers.length = 0;
  return push('备忘录', () => VIEWS.备忘录(N(), push, D, () => nav.back()));
}
