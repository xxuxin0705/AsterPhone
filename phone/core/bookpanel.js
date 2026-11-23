// 世界书面板：设置 → 上下文与世界书、映像 → 世界书、岁岁砂「从世界书整理」都用这一个。
// 顶上一行算总数；每本一张卡，左边勾整本，点书名展开 / 收起；条目前面蓝点是常驻、绿点是看关键词（和酒馆一样），勾上就能用，点标题展开看内容、能直接改
import { h } from './util.js';
import { icon } from './ui.js';
import { loadBook } from './context.js';

// 大概多少 token：中文一个字算一个，其余四个字母算一个
const CJK = /[　-鿿＀-￯]/g, tok = s => (s.match(CJK) || []).length + Math.round(s.replace(CJK, '').length / 4);
const opened = new Set();   // 展开着的书，重画也还展开着
/** o = { books: 书名[], tag?: n => 书名旁的小字, bookOn?/setBook?: 整本用不用（没有就不出整本的勾）, on/set: 这条勾没勾,
 *        load?: n => 条目（不给就从酒馆读）, open?: 一开始就展开,
 *        text?: 现在的内容（改过的）, edit?: (n, e, 改的字，null 是恢复原样)（没有就只能看）, sends?: 这会儿会不会发（没有就是勾了就算）, after?: n => 卡片底下多放的 }
 *  返回面板，面板._paint() 重新认一遍整本的勾和数字（外面改了「跟随酒馆」这类） */
export function bookPanel(o) {
  const lists = new Map(), cards = [], read = o.load || loadBook, sum = h('div.as-wb__sum'), use = n => !o.bookOn || o.bookOn(n);
  const total = () => { let on = 0, go = 0, t = 0, nb = 0;
    for (const n of o.books) { if (!use(n)) continue; nb++; for (const e of lists.get(n) || []) if (o.on(n, e)) { on++; if (!o.sends || o.sends(n, e)) { go++; t += tok(o.text ? o.text(n, e) : e.content); } } }
    const k = t >= 1000 ? (t / 1000).toFixed(1) + 'k' : t;
    sum.textContent = `用 ${nb} 本 · 勾了 ${on} 条` + (o.sends ? ` · 这会儿会发 ${go} 条` : '') + ` ≈ ${k} token`; };
  const entry = (n, e, changed) => {
    const edited = () => !!o.text && o.text(n, e) !== e.content, mark = h('em', { hidden: !edited() }, '改过'), more = h('div.as-wb__more'), box = h('div.as-wb__entry');
    const tick = h('button.as-wb__tick' + (o.on(n, e) ? '.is-on' : ''), { 'aria-label': e.title, onclick: () => { const v = !o.on(n, e); o.set(n, e, v); tick.classList.toggle('is-on', v); changed(); } });
    const content = () => { const keys = !e.constant && e.keys?.length ? h('small', '关键词：' + e.keys.join('、')) : '';
      if (!o.edit) return [keys, h('pre', e.content)];
      const ta = Object.assign(h('textarea.as-textarea', { rows: 6, spellcheck: false }), { value: o.text(n, e) }), back = h('button.as-wb__back', { hidden: !edited(), onclick: () => { ta.value = e.content; put(); } }, '恢复原样');
      const put = () => { o.edit(n, e, ta.value === e.content ? null : ta.value); mark.hidden = back.hidden = !edited(); changed(); };
      ta.addEventListener('change', put);
      return [keys, ta, back]; };
    box.append(tick, h('button.as-wb__t', { onclick: () => { if (!more.firstChild) more.append(...content()); box.classList.toggle('is-open'); } },
      h('i.as-wb__dot' + (e.constant ? '.is-const' : ''), { title: e.constant ? '常驻' : '关键词' }), h('span', e.title), mark), more);
    return box;
  };
  const card = n => {
    if (o.open) opened.add(n);
    const cnt = h('small'), body = h('div.as-wb__list'), el = h('div.as-wb__book' + (opened.has(n) ? '.is-open' : '') + (use(n) ? '' : '.is-off'));
    const count = () => { const L = lists.get(n); cnt.textContent = L ? `${L.filter(e => o.on(n, e)).length}/${L.length}` : use(n) ? '读不到' : ''; };
    const fill = () => lists.get(n) && body.replaceChildren(...lists.get(n).map(e => entry(n, e, () => { count(); total(); })));
    const load = () => lists.has(n) ? Promise.resolve() : read(n).then(L => { lists.set(n, L); count(); total(); if (opened.has(n)) fill(); }, count);
    const tick = o.setBook && h('button.as-wb__tick' + (use(n) ? '.is-on' : ''), { 'aria-label': `整本「${n}」`, onclick: () => { o.setBook(n, !use(n)); paint(); total(); if (use(n)) load(); } });
    const paint = () => { tick && tick.classList.toggle('is-on', use(n)); el.classList.toggle('is-off', !use(n)); count(); };
    el.append(h('div.as-wb__head', tick || '', h('button.as-wb__name', { onclick: () => { const on = !opened.has(n); on ? opened.add(n) : opened.delete(n); el.classList.toggle('is-open', on); if (on) load().then(() => body.firstChild || fill()); } },
      h('b', n), o.tag && o.tag(n) ? h('em', o.tag(n)) : '', cnt, icon('chevron', 14, 2.6))), body, o.after ? o.after(n) : '');
    if (use(n) || opened.has(n)) load();
    cards.push(() => { paint(); if (use(n)) load(); });
    return el;
  };
  const el = h('div.as-wb', sum, ...o.books.map(card));
  el._paint = () => { cards.forEach(f => f()); total(); };
  total();
  return el;
}
