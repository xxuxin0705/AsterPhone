// 设置 → 上下文与世界书：发给手机 AI 的正文怎么取、标签要不要、人设带不带、世界书开哪些，最后能预览。
import { h } from '../../core/util.js';
import { commit } from '../../core/store.js';
import { group, item, toggleItem, segmented, input, empty, icon } from '../../core/ui.js';
import { worldNames } from '../../core/bridge.js';
import { C, rawStory, detectTags, storyText, tavernBooks, bookOn, loadBook, entryOn, worldText } from '../../core/context.js';

const label = t => t === '!--' ? '<!-- -->' : t;
const save = () => commit('settings');

export function openContext({ sub, sliderRow }) {
  sub('context', '上下文与世界书', (body, re) => {
    const s = C();
    body.append(
      group('上下文', [
        sliderRow('读取正文条数', { min: 0, max: 30, step: 1, value: s.count, onInput: v => { s.count = v; save(); } }),
        toggleItem({ title: '包含你发的消息' }, s.withUser, v => { s.withUser = v; save(); }),
      ]),
      tagGroup(s, re),
      innerGroup(s, re),
      group('人设', [
        toggleItem({ title: '角色人设' }, s.charPersona, v => { s.charPersona = v; save(); }),
        toggleItem({ title: '你的人设（User 人设卡）' }, s.userPersona, v => { s.userPersona = v; save(); }),
      ]),
      bookGroup(s, re, sub),
      previewGroup());
  });
}

/** 正文里出现的标签：点一下在「要 → 不要 → 不管」之间换 */
function tagGroup(s, re) {
  const found = detectTags(), names = [...new Set([...Object.keys(found), ...s.keep, ...s.drop])].filter(t => !s.inner.includes(t) || s.keep.includes(t) || s.drop.includes(t));
  const state = t => s.keep.includes(t) ? 'keep' : s.drop.includes(t) ? 'drop' : '';
  const cycle = t => {
    const st = state(t);
    s.keep = s.keep.filter(x => x !== t); s.drop = s.drop.filter(x => x !== t);
    if (!st) s.keep.push(t); else if (st === 'keep') s.drop.push(t);
    save(); re();
  };
  return group('标签', [h('div.as-field', names.length ? h('div.as-chips', names.map(t => h('button.as-chip.as-ctx-tag' + (state(t) ? '.is-' + state(t) : ''), { onclick: () => cycle(t) },
    state(t) === 'keep' ? '要 ' : state(t) === 'drop' ? '不要 ' : '', label(t), found[t] ? h('small', ' ' + found[t]) : null))) : h('span.as-muted', '最近的正文里没有标签'))],
  '点一下切换：要 → 不要 → 不管');
}
/** 「要」的标签里面，还想去掉的（比如草稿 <!-- -->） */
function innerGroup(s, re) {
  const add = v => { v = v.trim().replace(/^<|>$/g, '').toLowerCase(); if (v === '!-- --' || v === '!----') v = '!--'; if (v && !s.inner.includes(v)) { s.inner.push(v); save(); re(); } };
  const inp = input({ placeholder: '输入标签名，回车添加' });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { add(inp.value); inp.value = ''; } });
  return group('「要」的标签里，不要', [h('div.as-field', h('div.as-chips',
    s.inner.map(t => h('button.as-chip.as-ctx-tag.is-drop', { onclick: () => { s.inner = s.inner.filter(x => x !== t); save(); re(); } }, label(t), ' ', icon('close', 12, 2.4)))), inp)]);
}

/** 世界书：圈圈管整本开关，点名字进去管单条 */
function bookGroup(s, re, sub) {
  const on = tavernBooks(), names = [...new Set([...on, ...worldNames()])];
  const rows = names.map(n => {
    const cnt = h('span.as-muted', '');
    const mark = h('button.as-ctx-book' + (bookOn(n) ? '.is-on' : ''), { 'aria-label': '整本开关', onclick: e => { e.stopPropagation(); s.books[n] = bookOn(n) ? 'off' : 'on'; save(); re(); } }, icon('check', 14, 3));
    if (bookOn(n)) loadBook(n).then(list => { const scan = storyText(); cnt.textContent = `${list.filter(e => entryOn(n, e, scan)).length}/${list.length}`; }).catch(() => { cnt.textContent = '读不到'; });
    else cnt.textContent = '不发';
    const row = item({ title: n, sub: on.includes(n) ? '酒馆里开着' : '', right: cnt, chevron: true, onClick: () => openBook(n, sub) });
    row.prepend(mark);
    return row;
  });
  return group('世界书', [
    toggleItem({ title: '跟随酒馆已开启的世界书' }, s.followTavern, v => { s.followTavern = v; save(); re(); }),
    ...(rows.length ? rows : [h('div.as-field', h('span.as-muted', '没有读到世界书（要在酒馆里打开手机）'))]),
  ]);
}
function openBook(name, sub) {
  sub('book', name, async (body, re) => {
    const s = C(), own = s.entries[name] || (s.entries[name] = {});
    const list = await loadBook(name).catch(() => null);
    if (!list) { body.append(empty('读不到这本世界书')); return; }
    const scan = storyText();
    const setAll = v => { list.forEach(e => { if (v == null) delete own[e.uid]; else own[e.uid] = v; }); save(); re(); };
    body.append(
      group('', [h('div.as-field', segmented([['', '跟随酒馆'], ['on', '整本开启'], ['off', '整本不要']], s.books[name] || '', v => { if (v) s.books[name] = v; else delete s.books[name]; save(); }))]),
      h('div.as-lib-actions', h('button.as-btn.as-btn--secondary', { onclick: () => setAll(true) }, '全部条目打开'), h('button.as-btn.as-btn--secondary', { onclick: () => setAll(false) }, '全部条目关掉'), h('button.as-btn.as-btn--secondary', { onclick: () => setAll(null) }, '恢复跟随')),
      group(`条目（${list.filter(e => entryOn(name, e, scan)).length}/${list.length} 会发）`, list.map(e => {
        const v = own[e.uid] == null ? '' : own[e.uid] ? 'on' : 'off';
        return h('div.as-field', h('span.as-field__label', `${e.title}${e.constant ? ' · 常驻' : ''}${e.disable ? ' · 酒馆里关着' : ''}${v === '' ? (entryOn(name, e, scan) ? ' · 现在会发' : ' · 现在不发') : ''}`),
          segmented([['', '跟随'], ['on', '开'], ['off', '关']], v, nv => { if (nv) own[e.uid] = nv === 'on'; else delete own[e.uid]; save(); re(); }));
      })));
  });
}

/** 预览：正文 / 世界书，各多少字 */
function previewGroup() {
  const out = h('pre.as-ctx-preview'), stat = h('div.as-muted.as-ctx-stat');
  const show = async k => {
    if (k === 'story') { const t = storyText(); out.textContent = t || '（没有正文）'; stat.textContent = `正文 ${rawStory().length} 条 · ${t.length} 字`; return; }
    out.textContent = '正在读世界书…';
    const t = await worldText(storyText()).catch(() => '');
    out.textContent = t || '（没有要发的世界书条目）'; stat.textContent = `世界书 ${t.length} 字`;
  };
  show('story');
  return group('预览发出去的内容', [h('div.as-field', segmented([['story', '发出去的正文'], ['world', '发出去的世界书']], 'story', show), stat, out)]);
}
