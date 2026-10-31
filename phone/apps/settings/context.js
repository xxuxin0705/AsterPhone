// 设置 → 上下文与世界书：手机里的 AI 能看到哪些正文、哪些标签、人设、世界书，最后能预览。
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
      tagGroup(s),
      group('人设', [
        toggleItem({ title: '角色人设' }, s.charPersona, v => { s.charPersona = v; save(); }),
        toggleItem({ title: '你的人设（User 人设卡）' }, s.userPersona, v => { s.userPersona = v; save(); }),
      ]),
      bookGroup(s, sub),
      previewGroup());
  });
}

/** 正文里出现的标签：点亮 = 里面的内容给手机看；没点亮的连内容一起不给。只换这一颗的样子，不重画整页 */
function tagGroup(s) {
  const found = detectTags(), names = [...new Set([...Object.keys(found), ...s.keep])];
  const chip = t => {
    const b = h('button.as-chip.as-ctx-tag' + (s.keep.includes(t) ? '.is-keep' : ''), { onclick: () => {
      const on = !s.keep.includes(t); s.keep = on ? [...s.keep, t] : s.keep.filter(x => x !== t); save(); b.classList.toggle('is-keep', on);
    } }, h('span.as-ctx-tag__mark', icon('check', 12, 3)), label(t), found[t] ? h('small', ' ' + found[t]) : null);
    return b;
  };
  return group('正文里的标签', [h('div.as-field', names.length ? h('div.as-chips', names.map(chip)) : h('span.as-muted', '最近的正文里没有标签'))],
    '点亮的给手机看，没点亮的不给');
}

/** 世界书：圈圈管整本开关，点名字进去管单条 */
function bookGroup(s, sub) {
  const on = tavernBooks(), names = [...new Set([...on, ...worldNames()])], painters = [];
  const rows = names.map(n => {
    const cnt = h('span.as-muted', '');
    const mark = h('button.as-ctx-book', { 'aria-label': '整本开关', onclick: e => { e.stopPropagation(); s.books[n] = bookOn(n) ? 'off' : 'on'; save(); paint(); } }, icon('check', 14, 3));
    const paint = () => {
      mark.classList.toggle('is-on', bookOn(n));
      if (bookOn(n)) loadBook(n).then(list => { const scan = storyText(); cnt.textContent = `${list.filter(e => entryOn(n, e, scan)).length}/${list.length}`; }).catch(() => { cnt.textContent = '读不到'; });
      else cnt.textContent = '不用';
    };
    paint(); painters.push(paint);
    const row = item({ title: n, sub: on.includes(n) ? '酒馆里开着' : '', right: cnt, chevron: true, onClick: () => openBook(n, sub) });
    row.prepend(mark);
    return row;
  });
  return group('世界书', [
    toggleItem({ title: '跟随酒馆已开启的世界书' }, s.followTavern, v => { s.followTavern = v; save(); painters.forEach(f => f()); }),
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
      (() => {
        const head = () => `条目（${list.filter(e => entryOn(name, e, scan)).length}/${list.length} 会用）`;
        const g = group(head(), list.map(e => {
          const lab = h('span.as-field__label'), v = own[e.uid] == null ? '' : own[e.uid] ? 'on' : 'off';
          const paint = () => { lab.textContent = `${e.title}${e.constant ? ' · 常驻' : ''}${e.disable ? ' · 酒馆里关着' : ''}${own[e.uid] == null ? (entryOn(name, e, scan) ? ' · 现在会用' : ' · 现在不用') : ''}`; };
          paint();
          return h('div.as-field', lab, segmented([['', '跟随'], ['on', '开'], ['off', '关']], v, nv => {
            if (nv) own[e.uid] = nv === 'on'; else delete own[e.uid]; save(); paint(); g.querySelector('.as-list-group__header').textContent = head();
          }));
        }));
        return g;
      })());
  });
}

/** 预览：正文 / 世界书，各多少字 */
function previewGroup() {
  const out = h('pre.as-ctx-preview'), stat = h('div.as-muted.as-ctx-stat');
  const show = async k => {
    if (k === 'story') { const t = storyText(); out.textContent = t || '（没有正文）'; stat.textContent = `正文 ${rawStory().length} 条 · ${t.length} 字`; return; }
    out.textContent = '正在读世界书…';
    const t = await worldText(storyText()).catch(() => '');
    out.textContent = t || '（没有用到的世界书条目）'; stat.textContent = `世界书 ${t.length} 字`;
  };
  show('story');
  return group('预览手机看到的内容', [h('div.as-field', segmented([['story', '正文'], ['world', '世界书']], 'story', show), stat, out)]);
}
