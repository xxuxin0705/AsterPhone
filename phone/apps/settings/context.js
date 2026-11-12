// 设置 → 上下文与世界书：手机里的 AI 能看到哪些正文、哪些标签、人设、世界书，最后能预览。
import { h } from '../../core/util.js';
import { commit } from '../../core/store.js';
import { group, item, toggleItem, segmented, input, empty, icon, actionSheet, dialog } from '../../core/ui.js';
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
        toggleItem({ title: '你的人设' }, s.userPersona, v => { s.userPersona = v; save(); }),
      ]),
      bookGroup(s, sub),
      tagGroup(s, withInfo),
      previewGroup());
  });
}

/** 正文筛选：两排标签。「给手机看」的点一下能暂时关掉；「加标签」列出正文里扫到、还没分类的，也能自己打字加 */
function tagGroup(s, withInfo) {
  s.keepOff = s.keepOff || []; s.drop = (s.drop || []).filter(t => !s.keep.includes(t));   // 以前只有「要」：已经在「要」里的不再放进「不要」
  const lists = { keep: s.keep, drop: s.drop };
  const boxes = {}, paint = k => boxes[k].replaceChildren(...lists[k].map(t => {
    const off = k === 'keep' && s.keepOff.includes(t);
    return h('span.as-chip' + (k === 'keep' && !off ? '.is-active' : '') + (off ? '.is-off' : ''), { onclick: k === 'keep' ? () => {
      s.keepOff = off ? s.keepOff.filter(x => x !== t) : [...s.keepOff, t]; save(); paint(k);
    } : null }, label(t),
      h('button.as-pbd__chipx', { 'aria-label': `删掉「${label(t)}」`, onclick: e => {
        e.stopPropagation(); lists[k].splice(lists[k].indexOf(t), 1); s.keepOff = s.keepOff.filter(x => x !== t); save(); paint(k);
      } }, icon('close', 11, 2.4)));
  }), h('button.as-chip.as-ctx-add', { onclick: () => add(k) }, icon('plus', 12, 2.4), '加标签'));
  const add = async k => {
    const found = detectTags(), fresh = Object.keys(found).filter(t => !s.keep.includes(t) && !s.drop.includes(t));
    let t = fresh.length ? await actionSheet('加标签', [...fresh.map(x => ({ value: x, label: `${label(x)} · 出现 ${found[x]} 次` })), { value: '__type', label: '自己输入…' }]) : '__type';
    if (t === '__type') t = await dialog({ title: '加标签', input: { placeholder: '标签名' } });
    t = String(t || '').trim().replace(/^<\/?|>$/g, '').toLowerCase(); if (!t) return;
    const other = k === 'keep' ? 'drop' : 'keep';
    if (lists[other].includes(t)) { lists[other].splice(lists[other].indexOf(t), 1); paint(other); }   // 一个标签只在一边
    if (!lists[k].includes(t)) lists[k].push(t);
    save(); paint(k);
  };
  const row = (k, title) => { boxes[k] = h('div.as-chips'); paint(k); return h('div.as-field', h('span.as-field__label', title), boxes[k]); };
  return group(withInfo('正文筛选', '正文里有的段落用 <标签> 包着，比如 <thinking> 是 AI 的思考过程。手机只看得到「给手机看」里的标签内容（点一下能暂时关掉）；「不给手机看」的和没分类的标签，整段都去掉。没被标签包着的正文照常给手机看。'),
    [row('keep', '给手机看'), row('drop', '不给手机看')]);
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
