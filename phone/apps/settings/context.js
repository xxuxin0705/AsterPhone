// 设置 → 上下文与世界书：手机里的 AI 能看到哪些正文、哪些标签、人设、世界书，最后能预览。
import { h } from '../../core/util.js';
import { commit } from '../../core/store.js';
import { group, item, toggleItem, segmented, input, empty, icon, dialog } from '../../core/ui.js';
import { worldNames, currentCharacter, characters } from '../../core/bridge.js';
import { myPersona } from '../../core/promptstore.js';
import { C, rawStory, detectTags, tagsInside, tagsOutside, storyText, tavernBooks, bookOn, loadBook, entryOn, worldText } from '../../core/context.js';

const label = t => t === '!--' ? '<!-- -->' : t;
const save = () => commit('settings');

export function openContext({ sub, sliderRow, withInfo }) {
  sub('context', '上下文与世界书', (body, re) => {
    const s = C();
    body.append(
      group('上下文', [
        sliderRow('读取正文条数', { min: 0, max: 30, step: 1, value: s.count, onInput: v => { s.count = v; save(); } }),
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

/** 正文筛选：两排标签，每排下面是正文里扫到、还没分类的标签（点一下就进这一排）。「给手机看」的点一下能暂时关掉。
 *  「不给手机看」下面只列套在「给手机看」的标签里面的，「给手机看」下面只列在它们外面的；先收成两行，「更多」展开；能按次数 / 字母排；扫不到的用「自己输入」 */
function tagGroup(s, withInfo) {
  s.keepOff = s.keepOff || []; s.drop = (s.drop || []).filter(t => !s.keep.includes(t));   // 以前只有「要」：已经在「要」里的不再放进「不要」
  const lists = { keep: s.keep, drop: s.drop }, boxes = {}, pools = {}, open = {};
  let az = false;
  const put = (k, t) => {
    t = String(t || '').trim().replace(/^<\/?|>$/g, '').toLowerCase(); if (!t) return;
    const other = k === 'keep' ? 'drop' : 'keep';
    if (lists[other].includes(t)) lists[other].splice(lists[other].indexOf(t), 1);   // 一个标签只在一边
    if (!lists[k].includes(t)) lists[k].push(t);
    save(); paint();
  };
  const paintList = k => { const inside = k === 'drop' ? tagsInside() : null; boxes[k].replaceChildren(...lists[k].map(t => {
    const off = k === 'keep' && s.keepOff.includes(t), idle = inside && !inside[t];   // idle：不在「给手机看」的标签里面，本来就看不到，放不放都一样（变灰，不自动删）
    return h('span.as-chip' + (k === 'keep' && !off ? '.is-active' : '') + (off ? '.is-off' : '') + (idle ? '.is-idle' : ''), { onclick: k === 'keep' ? () => {
      s.keepOff = off ? s.keepOff.filter(x => x !== t) : [...s.keepOff, t]; save(); paint();
    } : null }, label(t),
      h('button.as-pbd__chipx', { 'aria-label': `删掉「${label(t)}」`, onclick: e => {
        e.stopPropagation(); lists[k].splice(lists[k].indexOf(t), 1); s.keepOff = s.keepOff.filter(x => x !== t); save(); paint();
      } }, icon('close', 11, 2.4)));
  })); };
  const paintPool = k => {
    const found = !s.keep.length ? detectTags() : k === 'drop' ? tagsInside() : tagsOutside();
    const fresh = Object.keys(found).filter(t => !s.keep.includes(t) && !s.drop.includes(t)).sort((a, b) => az ? a.localeCompare(b) : found[b] - found[a] || a.localeCompare(b));
    const chips = h('div.as-chips.as-ctx-pool' + (open[k] ? '.is-open' : ''), ...fresh.map(t => h('button.as-chip', { onclick: () => put(k, t) }, label(t), h('small', String(found[t])))),
      h('button.as-chip.as-ctx-add', { onclick: async () => put(k, await dialog({ title: '加标签', input: { placeholder: '标签名' } })) }, icon('plus', 12, 2.4), '自己输入'));
    const more = h('button.as-ctx-more', { hidden: true, onclick: () => { open[k] = !open[k]; chips.classList.toggle('is-open', open[k]); more.textContent = open[k] ? '收起' : '更多'; } }, open[k] ? '收起' : '更多');
    pools[k].replaceChildren(h('div.as-ctx-poolhead', h('span', '正文里的标签'), more, h('button.as-ctx-more', { onclick: () => { az = !az; paint(); } }, az ? 'A–Z' : '按次数')), chips);
    requestAnimationFrame(() => { more.hidden = !open[k] && chips.scrollHeight <= chips.clientHeight + 2; });   // 两行放得下就不出「更多」
  };
  const paint = () => ['keep', 'drop'].forEach(k => { paintList(k); paintPool(k); });   // 只换这几排标签，不重画整页
  const row = (k, title) => { boxes[k] = h('div.as-chips'); pools[k] = h('div'); return h('div.as-field', h('span.as-field__label', title), boxes[k], pools[k]); };
  const g = group(withInfo('正文筛选', '正文里有的段落用 <标签> 包着，比如 <thinking> 是 AI 的思考过程。「给手机看」的标签，里面的内容都给手机（点一下能暂时关掉）；里面不想给的，放进「不给手机看」。两边都没放的标签，在「给手机看」的标签外面就整段去掉。没被标签包着的正文照常给手机看。'),
    [row('keep', '给手机看'), row('drop', '不给手机看'), toggleItem({ title: '包含你发的消息' }, s.withUser, v => { s.withUser = v; save(); })]);
  paint();
  return g;
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

/** 预览：照发给 AI 的顺序一段段排下来，每段写多少字，点开看全文（聊天记录、念念铃想起的事、时间要进了聊天才有） */
function previewGroup() {
  const box = h('div.as-field', h('div.as-muted', '正在读…'));
  (async () => {
    const s = C(), story = storyText(), cur = currentCharacter(), ch = cur && characters().find(x => x.key === cur.key), world = await worldText(story).catch(() => '');
    const parts = [[ch ? `${ch.name} 的人设` : '角色人设', s.charPersona && ch && ch.persona], ['你的人设', s.userPersona && myPersona()], ['世界书', world], [`正文（${rawStory().length} 条）`, story]].map(([t, v]) => [t, v || '']);
    box.replaceChildren(h('div.as-muted.as-ctx-stat', `一共 ${parts.reduce((n, p) => n + p[1].length, 0)} 字`),
      ...parts.map(([t, v]) => h('details.as-ctx-part', h('summary', h('span', t), h('small', v ? `${v.length} 字` : '没有')), h('pre.as-ctx-preview', v || '（没有）'))),
      h('div.as-muted.as-ctx-stat', '聊天记录、念念铃、时间：进聊天后接在后面'));
  })();
  return group('预览手机看到的内容', [box]);
}
