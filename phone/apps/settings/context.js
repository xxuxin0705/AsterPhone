// 设置 → 上下文与世界书：手机里的 AI 能看到哪些正文、哪些标签、人设、世界书，最后能预览。
import { h } from '../../core/util.js';
import { commit } from '../../core/store.js';
import { group, item, toggleItem, segmented, input, empty, icon } from '../../core/ui.js';
import { worldNames, currentCharacter, characters } from '../../core/bridge.js';
import { myPersona } from '../../core/promptstore.js';
import { C, rawStory, detectTags, storyText, tavernBooks, bookOn, loadBook, entryOn, worldText } from '../../core/context.js';

const label = t => t === '!--' ? '<!-- -->' : t;
const save = () => commit('settings');

export function openContext({ sub, sliderRow, withInfo }) {
  sub('context', '上下文与世界书', (body, re) => {
    const s = C();
    body.append(
      group('上下文', [
        sliderRow('读取正文条数', { min: 0, max: 30, step: 1, value: s.count, onInput: v => { s.count = v; save(); } }),
        toggleItem({ title: '包含你发的消息' }, s.withUser, v => { s.withUser = v; save(); }),
      ]),
      group('人设', [
        toggleItem({ title: '角色人设' }, s.charPersona, v => { s.charPersona = v; save(); }),
        toggleItem({ title: '你的人设（User 人设卡）' }, s.userPersona, v => { s.userPersona = v; save(); }),
      ]),
      bookGroup(s, sub),
      tagGroup(s, withInfo),
      previewGroup());
  });
}

/** 正文里用标签包起来的段落：每个标签选「要 / 不要」。thinking、content 一直列着（默认不要 / 要），其余是从最近正文里扫出来的 */
function tagGroup(s, withInfo) {
  const found = detectTags(), names = [...new Set(['content', 'thinking', ...Object.keys(found), ...s.keep])];
  const row = t => h('div.as-field', h('span.as-field__label', label(t), found[t] ? h('small.as-muted', ` · 出现 ${found[t]} 次`) : null),
    segmented([['keep', '要'], ['drop', '不要']], s.keep.includes(t) ? 'keep' : 'drop', v => { s.keep = v === 'keep' ? [...s.keep, t] : s.keep.filter(x => x !== t); save(); }));
  return group(withInfo('正文筛选', '正文里有的段落用 <标签> 包着，比如 <thinking> 是 AI 的思考过程。选「要」的段落手机能看到，选「不要」的整段去掉；没被标签包着的正文照常给手机看。'), names.map(row));
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

/** 预览：只看正文 / 全部（人设 + 世界书 + 正文，手机里的 AI 能看到的都在这），各多少字 */
function previewGroup() {
  const out = h('pre.as-ctx-preview'), stat = h('div.as-muted.as-ctx-stat');
  const show = async k => {
    const story = storyText();
    if (k === 'story') { out.textContent = story || '（没有正文）'; stat.textContent = `正文 ${rawStory().length} 条 · ${story.length} 字`; return; }
    out.textContent = '正在读世界书…';
    const s = C(), cur = currentCharacter(), ch = cur && characters().find(x => x.key === cur.key), world = await worldText(story).catch(() => '');
    const t = [s.charPersona && ch && ch.persona && `【${ch.name} 的人设】\n${ch.persona}`, s.userPersona && myPersona() && `【你的人设】\n${myPersona()}`,
      world && `【世界书】\n${world}`, story && `【正文】\n${story}`].filter(Boolean).join('\n\n');
    out.textContent = t || '（什么都没有）'; stat.textContent = `全部 ${t.length} 字`;
  };
  show('story');
  return group('预览手机看到的内容', [h('div.as-field', segmented([['story', '正文'], ['all', '全部']], 'story', show), stat, out)]);
}
