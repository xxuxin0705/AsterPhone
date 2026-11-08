// 照相馆：给联系人做立绘。先照头像 / 相册里的图（或者只按描述）画一张标准立绘，满意了再挑要哪些表情，一个个补上去
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, contact } from '../../core/store.js';
import { myName, myAvatar } from '../../core/promptstore.js';
import { page, group, item, avatar, btn, textarea, actionSheet, dialog, toast, icon, segmented, sheet } from '../../core/ui.js';
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
// 你自己也能做：id 是 me
const who = id => id === 'me' ? { id, name: myName(), avatar: myAvatar() } : contact(id);
// 立绘是竖的：不管这根线平时设的多大，都按各家支持的竖图尺寸画
const TALL = { 'openai-image': '1024x1536', 'image-compat': '1024x1536', siliconflow: '768x1024' };
const conn = size => { const c = resolveConn('image', 'studio'); return c && { ...c, img: { ...c.img, size: size || TALL[c.type] || '832x1216' } }; };
const isNai = () => resolveConn('image', 'studio')?.type === 'novelai';
// 能照着图改的 OpenAI 类生图线：一次画一张 12 格表情宫格（作者的主意），切开用
const gridLine = () => ['openai-image', 'image-compat'].includes(resolveConn('image', 'studio')?.type);
// NAI 局部重绘：按立绘的长宽比挑一个 64 的倍数、不超过 1024×1024 面积的尺寸（送去的图拉伸铺满，回来缩回原大小正好对上）
const naiSize = (w, h) => { const H = Math.round(Math.sqrt(1048576 * h / w) / 64) * 64; return `${Math.min(1024, Math.round(H * w / h / 64) * 64)}x${Math.min(H, 1536)}`; };
const sub = c => { const p = P.loaded(c.id); return p ? `有立绘${Object.keys(p.parts).length ? ` · ${Object.keys(p.parts).length} 个表情` : ''}` : '只有头像'; };

export async function openStudio() {
  const p = page({ app: 'street', id: 'studio', title: APP, large: true, back: true, cls: 'as-studio' });
  const all = [who('me'), ...state.contacts];
  await P.preload(all.map(c => c.id));
  const list = all.map(c => { const s = h('span', sub(c)); return item({ icon: avatar(c.avatar, nameOf(c), 30), color: 'transparent', title: nameOf(c), sub: s, chevron: true, onClick: () => person(c.id, () => { s.textContent = sub(c); }) }); });
  p.body.append(group('', list));
  nav.push(p.el);
}

function person(cid, changed) {
  const c = who(cid), f = form.get(cid) || form.set(cid, { desc: '', ref: c.avatar ? 'avatar' : '', pick: new Set(['mouthOpen', 'eyesClosed']), how: 'local' }).get(cid);
  const p = page({ app: 'street', id: 'studio-one', title: nameOf(c), large: true, back: true, cls: 'as-studio' });
  const stage = h('div.as-studio__stage'), ctl = h('div.as-studio__ctl');
  p.body.append(stage, ctl);
  let fig = null;
  // 立绘区：结构变了才换，先等图片解码好再一次换上去
  const paintStage = async () => {
    const pt = P.loaded(cid), d = draft.get(cid);
    // 还没画：选了参考图就先把那张整张摆出来
    const show = d ? d.base : f.ref === 'avatar' ? c.avatar : f.ref;
    const node = pt ? (fig = P.figure(cid)) : show ? h('img.as-studio__draft', { src: show, alt: '' }) : avatar(c.avatar, nameOf(c), 120);
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
        const v = await actionSheet('参考图', [c.avatar && { value: 'avatar', label: '用头像' }, { value: 'pick', label: '从相册选' }, { value: '', label: '不用，只按描述画' }].filter(Boolean));
        if (v == null) return;
        if (v === 'pick') { const file = await pickFile(); if (!file) return; f.ref = await fileToDataURL(file, 1024); } else f.ref = v;
        refRow.querySelector('.as-list-item__value').textContent = f.ref === 'avatar' ? '头像' : f.ref ? '相册里的图' : '不用';
        paintStage();
      } });
      // 参考图本来就是干净的正面立绘：直接拿来用，不找 AI
      const asIs = async () => { try { await P.save(cid, await P.clearBg(await P.toBase(f.ref === 'avatar' ? c.avatar : f.ref))); paint(); } catch (e) { toast(e.message); } };
      return ctl.replaceChildren(group('', [refRow, h('div.as-field', textarea({ rows: 3, value: f.desc, placeholder: '描述', onInput: v => { f.desc = v; } }))]),
        stop || (f.ref ? h('div.as-studio__row', btn('直接用这张', 'secondary', asIs), btn('AI 画立绘', 'primary', makeBase)) : btn('AI 画立绘', 'primary', makeBase, { style: { width: '100%' } })));
    }
    // 画法：手机里画（免费，眉毛画不了）/ AI 画。切换只藏起眉毛那两行、换按钮上的字
    const rows = P.PARTS.map(([k, name, use]) => {
      const ck = h('span.as-chat-check' + (f.pick.has(k) ? '.is-active' : ''), icon('check', 14, 2.6));
      const row = item({ title: name, sub: pt.parts[k] ? '已有' : use !== name && use, right: ck, onClick: () => { f.pick.has(k) ? f.pick.delete(k) : f.pick.add(k); ck.classList.toggle('is-active', f.pick.has(k)); if (pt.parts[k]) fig?.pt.peek(k); } });
      row.dataset.k = k; row.hidden = f.how === 'local' && !P.LOCAL.includes(k); return row;
    });
    if (pt.boxes) rows.push(item({ title: '眼睛和嘴的位置', value: '重新框', chevron: true, onClick: async () => { if (taken()) return; const b = await frameAll(); if (b) { Object.assign(pt.boxes, b); await P.save(cid, pt); toast('框好了'); } } }));
    // 戴眼镜的：框一下两边镜片，手机里画闭眼时贴在镜片后面
    if (pt.boxes) { const gl = item({ title: '眼镜', value: pt.boxes.lensL ? '框好了' : '没戴', chevron: true, onClick: async () => {
      const v = await actionSheet('眼镜', [{ value: 'set', label: pt.boxes.lensL ? '重新框镜片' : '框镜片' }, pt.boxes.lensL && { value: 'off', label: '没戴眼镜', danger: true }].filter(Boolean));
      if (v === 'off') { delete pt.boxes.lensL; delete pt.boxes.lensR; }
      if (v === 'set') { if (taken()) return; const b = await frameAll([['lensL', '框住左边镜片'], ['lensR', '框住右边镜片']]); if (!b) return; Object.assign(pt.boxes, b); }
      if (v) { await P.save(cid, pt); gl.querySelector('.as-list-item__value').textContent = pt.boxes.lensL ? '框好了' : '没戴'; toast(pt.boxes.lensL ? '框好了，再画一次闭眼就会贴在镜片后面' : '好'); }
    } }); gl.dataset.local = ''; gl.hidden = f.how !== 'local'; rows.push(gl); }
    // 用自己的 GPT 画：存脸部图 + 复制提示词，画好的宫格传回来切
    const own = item({ title: '用自己的 GPT 画', chevron: true, onClick: ownGpt }); own.dataset.ai = ''; own.hidden = f.how === 'local'; rows.push(own);
    const go = btn(f.how === 'local' ? '免费画勾选的表情' : 'AI 画勾选的表情', 'primary', makeParts, { style: { width: '100%' } });
    const how = segmented([['local', '手机里画 · 免费'], ['ai', 'AI 画']], f.how, v => { f.how = v; rows.forEach(r => { if (r.dataset.k) r.hidden = v === 'local' && !P.LOCAL.includes(r.dataset.k); if ('ai' in r.dataset) r.hidden = v === 'local'; if ('local' in r.dataset) r.hidden = v !== 'local'; }); go.textContent = v === 'local' ? '免费画勾选的表情' : 'AI 画勾选的表情'; });
    ctl.replaceChildren(how, group('表情', rows), stop || go,
      h('div.as-studio__row', btn('重做立绘', 'secondary', async () => { if (await dialog({ title: '重做立绘？', text: '做好的表情也会一起清掉。', confirm: '重做', danger: true })) { await P.drop(cid); paint(); } }),
        btn('删除', 'danger', async () => { if (await dialog({ title: '删除立绘？', text: '删掉后这个人回到只用头像。', confirm: '删除', danger: true })) { await P.drop(cid); paint(); } })));
  }

  // 要等的活：同一时间只跑一个；取消了不算失败
  const taken = () => job && (toast(job.cid === cid ? '正在做，点取消可以停下' : `正在给「${nameOf(who(job.cid))}」做，等那边好了再来`), true);
  const work = async (msg, fn) => {
    if (taken()) return;
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
        const desc = f.desc.trim() || (ref ? '' : nameOf(c));
        const src = await generateImage(isNai() ? P.naiBase(desc) : P.basePrompt(desc, !!ref), APP, conn(), stop, ref);
        if (stop.aborted) return;
        draft.set(cid, await P.clearBg(await P.toBase(src))); toast('画好了，看看满不满意');
      } catch (e) { if (stop.aborted) return; if (!e.logId) log('warn', APP, `「${nameOf(c)}」的立绘没画成：${e.message}`, e); toast('没画成：' + e.message); }
    });
  }
  async function makeParts() {
    const pt = P.loaded(cid), local = f.how === 'local', todo = P.PARTS.filter(([k]) => f.pick.has(k) && (!local || P.LOCAL.includes(k)));
    if (!todo.length) { toast('先勾要哪些表情'); return; }
    if (!local && !conn()) { toast('还没有生图连接：设置 → 连接 → 生图 里插一根线'); return; }
    // 手机里画、NAI 只重画框里那一块、宫格对位置：都要先在立绘上框出两只眼睛和嘴（框一次就记住）
    const nai = !local && isNai(), grid = !local && gridLine();
    if ((local || nai || grid) && !P.hasBoxes(pt)) { if (taken()) return; const b = await frameAll(); if (!b) return; pt.boxes = b; await P.save(cid, pt); }
    if (grid) return work('正在画表情宫格（一次画完）…', async stop => {
      try {
        const src = await generateImage(P.gridPrompt, APP, conn('1536x1024'), stop, await P.faceCrop(pt));
        if (stop.aborted) return;
        await useGrid(src, todo.map(t => t[0]));
      } catch (e) { if (stop.aborted) return; if (!e.logId) log('warn', APP, `「${nameOf(c)}」的表情宫格没画成：${e.message}`, e); toast('没画成：' + e.message); }
    });
    if (local) {
      if (taken()) return;
      for (const [k] of todo) { pt.parts[k] = await P.drawPart(pt, k); f.pick.delete(k); }
      await P.save(cid, pt); toast('画好了，点一下表情可以看看'); paint(); return;
    }
    await work(`正在画表情 0 / ${todo.length}`, async (stop, say) => {
      const bad = [];
      for (const [i, [k, name, , change, tags, region]] of todo.entries()) {
        say(`正在画「${name}」 ${i + 1} / ${todo.length}`);
        try {
          const area = nai && P.areaOf(pt, region);
          const src = nai ? await generateImage('solo, ' + tags, APP, conn(naiSize(pt.w, pt.h)), stop, { image: pt.base, mask: P.maskOf(pt, area) }) : await generateImage(P.partPrompt(change), APP, conn(), stop, pt.base);
          if (stop.aborted) return;
          pt.parts[k] = await P.cut(pt, src, area || undefined); await P.save(cid, pt); f.pick.delete(k);
        } catch (e) { if (stop.aborted) return; bad.push(name); if (!e.logId) log('warn', APP, `「${nameOf(c)}」的「${name}」没做成：${e.message}`, e); }
      }
      toast(bad.length ? `${bad.join('、')} 没做成，可以再试一次` : '表情做好了');
    });
  }

  // 宫格切开、对齐、抠；只留勾了的
  async function useGrid(src, want) {
    const pt = P.loaded(cid), { parts, bad, why } = await P.cutGrid(pt, src, want);
    for (const k in parts) { pt.parts[k] = parts[k]; f.pick.delete(k); }
    await P.save(cid, pt); if (bad.length) log('warn', APP, `「${nameOf(c)}」宫格里这几格没对上`, why.join('\n'));
    toast(bad.length ? `${bad.join('、')} 没对上，可以再试一次` : '表情做好了，点一下可以看看'); paint();
  }
  async function ownGpt() {
    const pt = P.loaded(cid);
    if (!P.hasBoxes(pt)) { if (taken()) return; const b = await frameAll(); if (!b) return; pt.boxes = b; await P.save(cid, pt); }
    const s = sheet({ title: '用自己的 GPT 画', content: h('div.as-studio__own',
      h('img', { src: await P.faceCrop(pt), alt: '' }),
      h('div.as-studio__row', btn('复制提示词', 'secondary', () => navigator.clipboard?.writeText(P.gridPrompt).then(() => toast('已复制，和上面这张图一起发给 GPT'), () => toast('复制失败'))),
        btn('上传画好的', 'primary', async () => { const file = await pickFile(); if (!file) return; s.close(); toast('正在切宫格…', true);
          try { const all = P.GRID.filter(Boolean), want = all.filter(k => f.pick.has(k)); await useGrid(await fileToDataURL(file, 2048), want.length ? want : all); } catch (e) { toast('切不开：' + e.message); } }))) });
  }

  // 在立绘上依次拖几个框（默认左眼、右眼、嘴），框过的留在上面；交出 { eyeL, eyeR, mouth }（立绘上的 [x, y, w, h]），点提示条上的取消交出 null
  const frameAll = (steps = [['eyeL', '框住左边那只眼睛'], ['eyeR', '框住右边那只眼睛'], ['mouth', '框住嘴']]) => new Promise(done => {
    const got = {}, lay = h('div.as-studio__frame', { 'data-no-swipe': '' });   // 往右拖框别被当成「滑动返回」
    let s = null, box = null;
    const end = v => { lay.remove(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); done(v); };
    const ask = () => { const [k, label] = steps[Object.keys(got).length]; box = h('i.as-studio__box'); lay.append(box); toast(label, { label: '取消', fn: () => { end(null); toast('已取消'); }, wait: true }); };
    const move = e => { if (!s) return; Object.assign(box.style, { left: Math.min(s.x, e.clientX) - s.L.left + 'px', top: Math.min(s.y, e.clientY) - s.L.top + 'px', width: Math.abs(e.clientX - s.x) + 'px', height: Math.abs(e.clientY - s.y) + 'px', display: 'block' }); };
    const up = e => {
      if (!s) return;
      const r = fig.getBoundingClientRect(); const k = P.loaded(cid).w / r.width, w = Math.abs(e.clientX - s.x) * k, hh = Math.abs(e.clientY - s.y) * k, { x: x0, y: y0 } = s;
      s = null;
      if (w < 8 || hh < 4) { box.style.display = ''; return; }
      got[steps[Object.keys(got).length][0]] = [(Math.min(x0, e.clientX) - r.left) * k, (Math.min(y0, e.clientY) - r.top) * k, w, hh].map(Math.round);
      Object.keys(got).length === steps.length ? end(got) : ask();
    };
    lay.onpointerdown = e => { e.preventDefault(); s = { x: e.clientX, y: e.clientY, L: lay.getBoundingClientRect() }; };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    stage.append(lay); stage.scrollIntoView({ behavior: 'smooth', block: 'start' }); ask();
  });

  paintCtl(); paintStage();
  nav.push(p.el);
}
