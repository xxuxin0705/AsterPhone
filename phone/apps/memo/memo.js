// 备忘录：你自己的。样子和查手机里 TA 的「备忘录」是同一套（peek/apps.js 的 VIEWS.备忘录），这里多了能写、能勾、能删、能选和谁共用。
// 一条存成一行（和 AI 写的 TA 的备忘录同一个样子）：[便签 / 清单 / 共用, 标题, 年/月/日 时:分, 文件夹（共用的是那个人的名字）, 正文（// 分行）, 共用的人的 id]
import { h, uid, fileToDataURL } from '../../core/util.js';
import { state, commit, contact, friends, kvSet, kvDel } from '../../core/store.js';
import { icon, dialog, actionSheet, pickSheet, toast } from '../../core/ui.js';
import { myName } from '../../core/promptstore.js';
import { translate, myOut, myLang, langName } from '../../core/translate.js';
import * as time from '../../core/time.js';
import * as nav from '../../core/nav.js';
import { shell } from '../../core/shell.js';
import { nameOf, sharedWith, fixInk, drawn } from '../chat/engine.js';
import { VIEWS, iosPage, gone, ink, inkImg, inks } from '../peek/apps.js';
import { startDraw } from './draw.js';

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
  // 删除：先进「最近删除」（30 天内能恢复，open 时把过了 30 天的清掉）；在「最近删除」里再删才是真没了
  del: async (r, w) => { const bin = r[0] === '已删';
    if (!await dialog(bin ? { title: '永久删除这条备忘录？', text: '删了就找不回来了。', confirm: '删除', danger: true } : { title: '删除这条备忘录？', text: r[0] === '共用' ? `${r[3]} 也会看不到，30 天内能在「最近删除」里恢复。` : '30 天内能在「最近删除」里恢复。', confirm: '删除', danger: true })) return;
    bin ? forget(r) : toBin(r); save(); w && gone(w); fresh(layers.slice(0, -1)); },
  restore: r => { r[0] = r[13] || kind(r[4]); r[2] = r[14] || r[2]; r[13] = r[14] = undefined; save(); fresh(layers.slice(0, -1)); },
  // 清单键：进去改这一条，最后接一行 ○；回形针：从相册挑一张照片，接在最后（和画一样单独一行，编号带 pic）。返回新加的那一行
  todo: r => edit(r, true),
  clip: async r => { const f = await new Promise(ok => { const i = h('input', { type: 'file', accept: 'image/*' }); i.onchange = () => ok(i.files[0]); i.click(); }); if (!f) return '';
    const url = await fileToDataURL(f, 786).catch(() => ''); if (!url) { toast('这张照片读不出来'); return ''; }
    const k = 'memo-draw:pic' + uid('d'); if (!await kvSet(k, url).then(() => true, e => toast('照片没存上：' + e.message))) return '';
    const x = (r[0] === '共用' ? myName() + '：' : '') + '✎' + k; inks.set(k, url); r[4] = [...(r[4] ? r[4].split('//') : []), x].join('//'); r[2] = time.stampText(time.stamp()); save(); fresh(layers.slice(0, -1)); return x; },
  // 共用的：删掉别人写的第 i 句；again 是删掉让 TA 重新回——这句前面你画的画也算 TA 没看过，下次私聊或查手机 TA 对这段重新回
  unsay: (r, i, again) => { const L = r[4].split('//').map(x => x.trim()).filter(Boolean), by = (/^([^：:]{1,12})[：:]/.exec(L[i] || '') || [])[1], gone1 = L.splice(i, 1)[0];
    if (again) { const c = sharedWith(r).map(contact).find(x => x && nameOf(x) === by), ks = L.slice(0, i).map(x => /✎(memo-draw:\S+)$/.exec(x)?.[1]).filter(Boolean);
      if (c) r[9] = String(r[9] || '').split(',').filter(x => x && !ks.some(k => x === `+${c.id}>${k}`)).join(','); }
    r[4] = L.join('//'); r[12] = (r[12] || []).filter(x => x[1] !== gone1); save(); fresh(); if (again) toast(`下次和 ${by} 私聊或查手机时，TA 会重新回`); },
  // 选了几条一起删、一起挪（照 iPhone 的「选择备忘录」）
  drop: async rs => { const bin = rs.every(r => r[0] === '已删');
    if (!await dialog({ title: `${bin ? '永久' : ''}删除 ${rs.length} 条备忘录？`, text: bin ? '删了就找不回来了。' : '30 天内能在「最近删除」里恢复。', confirm: '删除', danger: true })) return false;
    rs.forEach(r => (r[0] === '已删' ? forget(r) : toBin(r))); save(); fresh(); },
  // 就在这一条里画：box 是正文那一块（新画的接在最后），img 是长按的那张（接着改它），wire 给画好的那张接上点 / 长按。画完新的就在正文最后加一行「✎编号」；
  // 改了旧的，第十格里记的「谁看过这张」去掉，好再给大家看
  draw: (r, box, key, img, wire) => startDraw({ host: img || box.appendChild(h('div')), key, tip: r[0] === '共用' && tipOf(r), onSave: (k, im) => { wire && wire(im);
    if (!key) r[4] = [...(r[4] ? r[4].split('//') : []), (r[0] === '共用' ? myName() + '：' : '') + '✎' + k].join('//');
    else r[9] = String(r[9] || '').split(',').filter(x => x && !x.endsWith('>' + k)).join(',');
    r[2] = time.stampText(time.stamp()); save(); fresh(layers.slice(0, -1)); } }),
  // 挪到哪个文件夹：「新建文件夹」起个名字就挪进去；共用的不在文件夹里，不挪
  move: async rs => { const fs = [...new Set(N().filter(r => r[0] !== '共用' && r[3]).map(r => r[3]))];
    let v = await actionSheet('选择文件夹', [{ value: '+', label: '新建文件夹' }, { value: '·', label: '备忘录' }, ...fs.map(f => ({ value: f, label: f }))]); if (!v) return false;
    if (v === '+') { v = (await dialog({ title: '新建文件夹', input: { placeholder: '名称' }, confirm: '好' }) || '').trim(); if (!v) return false; }
    rs.filter(r => r[0] !== '共用').forEach(r => { r[3] = v === '·' ? '' : v; }); save(); fresh(); },
  // 和谁共用：能选好几个人，选了这条就成了一起记的（每行前面记着谁写的，看的时候按人上色）；一个都不选就变回自己的
  share: async r => { const S = await pickSheet('和谁共用', friends().map(c => ({ value: c.id, label: nameOf(c), active: sharedWith(r).includes(c.id) }))); if (!S) return;
    const me = myName() + '：', L = r[4].split('//').filter(Boolean), cs = S.map(contact).filter(Boolean);
    if (cs.length) { if (r[0] !== '共用') { r[4] = L.map(x => named(r, x) ? x : me + x).join('//'); r[11] ||= 'me'; } r[0] = '共用'; r[3] = cs.map(nameOf).join('、'); r[5] = cs.map(c => c.id).join(','); }
    else if (r[0] === '共用') { r[4] = L.map(x => x.replace(/^[^：:]{1,12}[：:]\s*/, '')).join('//'); r[0] = kind(r[4]); r[3] = ''; r[5] = ''; r[6] = 0; }
    save(); fresh(); },
};
const kind = body => /(^|\/\/)\s*[○√]/.test(body) ? '清单' : '便签';
// 进「最近删除」：第十四、十五格记着原来是哪种、原来的时间（恢复用），第三格换成删的时间；共用的进去了 TA 就看不到
const toBin = r => { r[13] = r[0]; r[14] = r[2]; r[0] = '已删'; r[2] = time.stampText(time.stamp()); r[6] = r[7] = 0; };
const forget = r => { N().splice(N().indexOf(r), 1); drawn(r).forEach(k => { kvDel(k); kvDel(k + ':s'); }); };
const folk = r => [myName(), ...String(r[3] || '').split('、')].filter(Boolean);   // 共用的几个人的名字（第四格几个人用「、」隔开）
const named = (r, x) => folk(r).some(n => x.startsWith(n + '：'));
// 外语的行存成「外文[翻译：中文]」（「译」能换）：改的时候摆中文，没动过的行原样留着，改了、新写的按映像里我说的语言重翻
// 一行前面不翻的那截：共用的「谁：」、清单的 ○ √、「划掉：」（只认我们自己加的，外文里本来有的冒号不算）
const TR = /\s*\[翻译：([^\]]*)\]/;
const pre = (x, r) => { const n = r[0] === '共用' && folk(r).find(n => x.startsWith(n + '：')), a = n ? n.length + 1 : 0; return x.slice(0, a + /^([○√]\s*)?(划掉[:：]\s*)?/.exec(x.slice(a))[0].length); };
const cn = (x, r) => { const m = TR.exec(x); return m ? pre(x, r) + m[1] : x; };
// 改的时候看到的：共用的不带「谁：」（谁写的看颜色），存的时候没动过的照原样、新写的算你的
const vis = (x, r) => { let y = cn(x, r), n; while (r[0] === '共用' && (n = folk(r).find(n => y.startsWith(n + '：')))) y = y.slice(n.length + 1); return y; };   // 以前存的翻译那半有时也带着名字
const tipOf = r => `下次和 ${r[3]} 私聊时，新画的会一起给 TA 看（每张看过就不再带，改了再给 TA 看）。聊天的模型要能识图，比如 Gemini、Claude、GPT-4o；走「酒馆」连接的带不了图。`;
// 写一条：标题一行，下面一行一块（每块一个框，画是单独的一块）。勾着「译成某语」时，每行下面紧跟着这一行的译文；存的时候只留译文（点「译」能看回中文）
function edit(r, tick) {
  const { el, body } = iosPage('memo', 'memo-edit', '.pk-nt.is-doc'), off = el._onLeave, shared = r[0] === '共用', me = shared ? myName() + '：' : '';
  const was = new Map([[cn(r[1], r), r[1]], ...r[4].split('//').map(x => [vis(x, r), x])]);
  const t = h('input.pk-nt__t', { value: cn(r[1], r), placeholder: '标题', 'aria-label': '标题' }), list = h('div.pk-nt__blocks');
  // 这一条要不要翻成我说的语言（映像里「我说的语言」不是中文才有这个勾）：第十一格 0 是不翻，没勾过的照翻；改了勾，存的时候我写的行（连标题）跟着翻过去或换回中文
  let want = r[10] !== 0, last = null;
  const foreign = o => (TR.test(o) ? o.slice(pre(o, r).length).replace(TR, '') : '');   // 存着的那行的外文那半
  const block = (v = '') => {
    const ta = h('textarea.pk-nt__ta', { rows: 1, 'aria-label': '正文', spellcheck: false }), tr = h('div.pk-nt__trl'), b = h('div.pk-nt__b', ta, tr);
    const o = was.get(v), theirs = o != null && shared && !o.startsWith(me);   // 别人写的：外文照存着的摆，不跟着勾走
    let tm = 0, seq = 0;
    const show = () => { clearTimeout(tm); const x = ta.value.trim(), keep = was.get(ta.value);
      if (keep != null && (theirs || TR.test(keep) === !!(want && myLang()))) { tr.textContent = foreign(keep); return; }
      tr.textContent = ''; if (!x || !want || !myLang() || theirs) return;
      const n = ++seq; tm = setTimeout(() => translate(x, myLang()).then(z => n === seq && (tr.textContent = z), () => {}), 600); };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.value = v; b._show = show; b._grow = grow;
    ta.addEventListener('focus', () => { last = ta; });
    // 回车（手机键盘上多半只有 input 能看出来）就在这里断开，后半截成新的一块；贴进来好几行的也一样拆开
    ta.addEventListener('input', () => { if (ta.value.includes('\n')) { const [a, ...rest] = ta.value.split('\n'); ta.value = a; let at = b;
      rest.forEach(x => { const nb = block(x); at.after(nb); at = nb; nb._grow(); }); at.querySelector('textarea').focus(); at.querySelector('textarea').setSelectionRange(0, 0); }
      grow(); show(); });
    // 在一块的最前面再退格：并到上一块后面
    const merge = e => { const p = b.previousElementSibling, pt = p?.querySelector('textarea'); if (!pt || ta.selectionStart || ta.selectionEnd) return;
      e.preventDefault(); const at = pt.value.length; pt.value += ta.value; b.remove(); pt.focus(); pt.setSelectionRange(at, at); p._grow(); p._show(); };
    ta.addEventListener('keydown', e => e.key === 'Backspace' && merge(e));
    ta.addEventListener('beforeinput', e => e.inputType === 'deleteContentBackward' && merge(e));
    requestAnimationFrame(() => { grow(); show(); });
    return b;
  };
  const pic = key => h('div.pk-nt__b.is-ink', { dataset: { key } }, inkImg(key), h('button.pk-nt__x', { 'aria-label': '删掉这张画', onclick: e => e.currentTarget.parentNode.remove() }, icon('close', 16, 2.4)));
  r[4].split('//').filter(Boolean).forEach(x => { const v = vis(x, r), k = /^✎(memo-draw:\S+)$/.exec(v)?.[1]; list.append(k ? pic(k) : block(v)); });
  if (!list.querySelector('textarea')) list.append(block());
  if (tick) list.append(block('○ '));
  list.querySelector('textarea').placeholder = '写点什么';
  const trb = myLang() && h('button.pk-glass.pk-nt__tr' + (want ? '.is-on' : ''), { onclick: () => { want = !want; trb.classList.toggle('is-on', want); list.querySelectorAll('.pk-nt__b').forEach(b => b._show && b._show()); } }, `译成${langName(myLang())}`);
  // 清单键：在正在写的那一块前面加一个 ○，已经有就拿掉
  const todo = () => { const ta = last || list.querySelector('textarea'), m = /^[○√] ?/.exec(ta.value); ta.value = m ? ta.value.slice(m[0].length) : '○ ' + ta.value; ta.focus(); ta.dispatchEvent(new Event('input')); };
  // 画：在最后接一块画布，画完就是一张图（存的时候和字一起按先后排）
  const pen = () => { const host = h('div.pk-nt__b'); list.append(host); startDraw({ host, tip: shared && tipOf(r), onSave: k => { const g = list.querySelector(`[data-key="${k}"]`); g && g.replaceWith(pic(k)); } }); };
  el._onLeave = async () => { off();
    const items = [...list.children].map(b => (b.dataset.key ? ['ink', b.dataset.key] : b.querySelector('textarea') ? ['txt', b.querySelector('textarea').value.trim()] : ['', ''])).filter(x => x[1] && x[1] !== '○'), old = r[1] + '|' + r[4];   // 只有一个 ○ 没写字的不留
    const go = want && myLang(), mine = o => !shared || o.startsWith(me);
    const tr1 = async x => { const p = pre(x, r), [o, z] = await myOut(x.slice(p.length)); return z ? `${p}${o}[翻译：${z}]` : x; };
    // 没动过的行原样留着（别人写的永远不动）；我写的、翻没翻和勾的对不上的，换过去；新写的照勾的来
    const out = async (x, add, own) => { const o = was.get(x); if (o != null && (!myLang() || !own && !mine(o) || TR.test(o) === !!go)) return o;
      const zh = o != null ? cn(o, r) : add + x; return go ? tr1(zh) : zh; };
    const title = t.value.trim();   // 标题框空着就是没有标题（列表里拿第一行当标题，和 iPhone 一样）
    r[10] = want ? 1 : 0; r[1] = title && await out(title, '', true);
    r[4] = (await Promise.all(items.map(([k, v]) => (k === 'ink' ? was.get('✎' + v) ?? me + '✎' + v : out(v, me))))).join('//');
    if (!shared) r[0] = kind(r[4]);
    if (!r[1] && !r[4]) N().splice(N().indexOf(r), 1); else if (old !== r[1] + '|' + r[4]) r[2] = time.stampText(time.stamp());
    save(); fresh(); };
  body.append(h('div.pk-top2', h('button.pk-glass.is-round', { 'aria-label': '返回', onclick: () => nav.back() }, icon('back', 24, 2.4)), h('button.pk-glass', { onclick: () => nav.back() }, '完成')), t, list,
    h('div.pk-float', h('button.pk-glass', { onclick: todo }, '○ 清单'), trb || '', h('i'), h('button.pk-glass.is-round', { 'aria-label': '画画', onclick: pen }, ink('pen', 22, 1.9))));
  nav.push(el); const at = tick ? [...list.querySelectorAll('textarea')].at(-1) : r[1] ? list.querySelector('textarea') : t; at.focus({ preventScroll: true }); if (tick) { at.setSelectionRange(9, 9); at.scrollIntoView({ block: 'center' }); }
}
export function open() {
  layers.length = 0; N().forEach(fixInk);   // 以前存在第九格的画挪进正文
  const now = time.isStory() ? time.story().date : new Date(), old = N().filter(r => { const m = r[0] === '已删' && /(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(r[2] || ''); return m && now - new Date(m[1], m[2] - 1, m[3]) > 30 * 864e5; });
  if (old.length) { old.forEach(forget); save(); }   // 「最近删除」里过了 30 天的真删掉
  return push('备忘录', () => VIEWS.备忘录(N(), push, D, () => nav.back()));
}
