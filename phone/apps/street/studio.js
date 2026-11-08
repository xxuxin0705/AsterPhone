// 照相馆：给联系人做立绘。先照头像 / 相册里的图（或者只按描述）画一张标准立绘，满意了再挑要哪些表情，一个个补上去
import { h } from '../../core/util.js';
import { state, contact } from '../../core/store.js';
import { page, group, item, avatar, btn, textarea, actionSheet, dialog, toast, icon, pickImage, empty } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { generateImage, resolveConn } from '../../core/api.js';
import { log } from '../../core/log.js';
import { nameOf } from '../chat/engine.js';
import * as P from '../../core/portrait.js';

const APP = '照相馆';
// 同一时间只做一件事：退出再进来还能看到进度、点取消；做完填到现在开着的那页
let job = null;                       // { cid, ac, msg }
const draft = new Map(), form = new Map();   // 还没确认的立绘；每个人填的描述和参考图
let view = null;                      // 现在开着的那个人的页面：{ cid, paint }
const conn = () => resolveConn('image', 'studio');
const sub = c => { const p = P.loaded(c.id); return p ? `有立绘${Object.keys(p.parts).length ? ` · ${Object.keys(p.parts).length} 个表情` : ''}` : '只有头像'; };

export async function openStudio() {
  const p = page({ app: 'street', id: 'studio', title: APP, large: true, back: true, cls: 'as-studio' });
  await P.preload(state.contacts.map(c => c.id));
  const subs = new Map();
  const list = state.contacts.map(c => { const s = h('span', sub(c)); subs.set(c.id, s); return item({ icon: avatar(c.avatar, nameOf(c), 30), color: 'transparent', title: nameOf(c), sub: s, chevron: true, onClick: () => person(c.id, () => { s.textContent = sub(c); }) }); });
  p.body.append(list.length ? group('', list) : empty('还没有联系人'));
  nav.push(p.el);
}

function person(cid, changed) {
  const c = contact(cid), f = form.get(cid) || form.set(cid, { desc: '', ref: c.avatar ? 'avatar' : '', pick: new Set(['mouthOpen', 'eyesClosed']) }).get(cid);
  const p = page({ app: 'street', id: 'studio-one', title: nameOf(c), large: true, back: true, cls: 'as-studio' });
  const stage = h('div.as-studio__stage'), ctl = h('div.as-studio__ctl');
  p.body.append(stage, ctl);
  let fig = null;
  // 立绘区：结构变了才换，先等图片解码好再一次换上去
  const paintStage = async () => {
    const pt = P.loaded(cid), d = draft.get(cid);
    const node = pt ? (fig = P.figure(cid)) : d ? h('img.as-studio__draft', { src: d.base, alt: '' }) : avatar(c.avatar, nameOf(c), 120);
    if (!pt) fig = null;
    await Promise.all([...(node.tagName === 'IMG' ? [node] : node.querySelectorAll('img'))].map(i => i.decode().catch(() => {})));
    stage.replaceChildren(node); stage.classList.toggle('is-empty', !pt && !d);
  };
  const paint = () => { paintCtl(); paintStage(); changed(); };
  view = { cid, paint };
  p.el._onLeave = () => { if (view?.cid === cid) view = null; };

  function paintCtl() {
    const pt = P.loaded(cid), d = draft.get(cid), mine = job?.cid === cid;
    const stop = mine && h('div.as-studio__busy', h('i.as-spin'), h('span', job.msg), btn('取消', 'secondary', () => job.ac.abort()));
    if (d) return ctl.replaceChildren(stop || h('div.as-studio__row', btn('重画', 'secondary', makeBase), btn('用这张', 'primary', async () => { draft.delete(cid); await P.save(cid, d); paint(); })));
    if (!pt) {
      const refRow = item({ title: '参考图', value: f.ref === 'avatar' ? '头像' : f.ref ? '相册里的图' : '不用', chevron: true, onClick: async () => {
        const v = await actionSheet('参考图', [c.avatar && { value: 'avatar', label: '用头像' }, { value: 'pick', label: '换一张' }, { value: '', label: '不用，只按描述画' }].filter(Boolean));
        if (v == null) return;
        if (v === 'pick') { const u = await pickImage('参考图', { ratio: 1, size: 1024 }); if (!u) return; f.ref = u; } else f.ref = v;
        refRow.querySelector('.as-list-item__value').textContent = f.ref === 'avatar' ? '头像' : f.ref ? '相册里的图' : '不用';
      } });
      return ctl.replaceChildren(group('', [refRow, h('div.as-field', textarea({ rows: 3, value: f.desc, placeholder: '描述', onInput: v => { f.desc = v; } }))]), stop || btn('生成立绘', 'primary', makeBase, { style: { width: '100%' } }));
    }
    const rows = P.PARTS.map(([k, name, use]) => {
      const ck = h('span.as-chat-check' + (f.pick.has(k) ? '.is-active' : ''), icon('check', 14, 2.6));
      return item({ title: name, sub: pt.parts[k] ? '已有' : use !== name && use, right: ck, onClick: () => { f.pick.has(k) ? f.pick.delete(k) : f.pick.add(k); ck.classList.toggle('is-active', f.pick.has(k)); if (pt.parts[k]) fig?.pt.peek(k); } });
    });
    ctl.replaceChildren(group('表情', rows), stop || btn('生成勾选的表情', 'primary', makeParts, { style: { width: '100%' } }),
      h('div.as-studio__row', btn('重做立绘', 'secondary', async () => { if (await dialog({ title: '重做立绘？', text: '做好的表情也会一起清掉。', confirm: '重做', danger: true })) { await P.drop(cid); paint(); } }),
        btn('删除', 'danger', async () => { if (await dialog({ title: '删除立绘？', text: '删掉后这个人回到只用头像。', confirm: '删除', danger: true })) { await P.drop(cid); paint(); } })));
  }

  // 要等的活：同一时间只跑一个；取消了不算失败
  const work = async (msg, fn) => {
    if (job) { toast(job.cid === cid ? '正在做，点取消可以停下' : `正在给「${nameOf(contact(job.cid))}」做，等那边好了再来`); return; }
    const ac = new AbortController(); job = { cid, ac, msg };
    const repaint = () => view?.cid === cid && view.paint();
    ac.signal.addEventListener('abort', () => { toast('已取消'); job = null; repaint(); }, { once: true });
    const say = m => { job.msg = m; toast(m, { label: '取消', fn: () => ac.abort(), wait: true }); const t = view?.cid === cid && ctl.querySelector('.as-studio__busy span'); if (t) t.textContent = m; };
    repaint(); say(msg);
    try { await fn(ac.signal, say); }
    finally { if (!ac.signal.aborted) { job = null; repaint(); } }
  };
  async function makeBase() {
    if (!conn()) { toast('还没有生图连接：设置 → 连接 → 生图 里插一根线'); return; }
    await work('正在画立绘…', async stop => {
      try {
        const ref = f.ref === 'avatar' ? (await P.toBase(c.avatar).catch(() => { throw new Error('头像读不出来，换一张参考图'); })).base : f.ref || undefined;
        const src = await generateImage(P.basePrompt(f.desc.trim() || (ref ? '' : nameOf(c)), !!ref), APP, conn(), stop, ref);
        if (stop.aborted) return;
        draft.set(cid, await P.clearBg(await P.toBase(src))); toast('画好了，看看满不满意');
      } catch (e) { if (stop.aborted) return; if (!e.logId) log('warn', APP, `「${nameOf(c)}」的立绘没画成：${e.message}`, e); toast('没画成：' + e.message); }
    });
  }
  async function makeParts() {
    const pt = P.loaded(cid), todo = P.PARTS.filter(([k]) => f.pick.has(k));
    if (!todo.length) { toast('先勾要哪些表情'); return; }
    if (!conn()) { toast('还没有生图连接：设置 → 连接 → 生图 里插一根线'); return; }
    await work(`正在画表情 0 / ${todo.length}`, async (stop, say) => {
      const bad = [];
      for (const [i, [k, name, , change]] of todo.entries()) {
        say(`正在画「${name}」 ${i + 1} / ${todo.length}`);
        try {
          const src = await generateImage(P.partPrompt(change), APP, conn(), stop, pt.base);
          if (stop.aborted) return;
          pt.parts[k] = await P.cut(pt, src); await P.save(cid, pt); f.pick.delete(k);
        } catch (e) { if (stop.aborted) return; bad.push(name); if (!e.logId) log('warn', APP, `「${nameOf(c)}」的「${name}」没做成：${e.message}`, e); }
      }
      toast(bad.length ? `${bad.join('、')} 没做成，可以再试一次` : '表情做好了');
    });
  }

  paintCtl(); paintStage();
  nav.push(p.el);
}
