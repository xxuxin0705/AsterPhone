// 照相馆：给联系人做立绘。三样：立绘（上传 / 照图让 AI 画 / 按描述让 AI 画），表情、动作（可选，都是把立绘发给 AI 一次画一张宫格，手机里切开）
import { h, pickFile, fileToDataURL } from '../../core/util.js';
import { state, contact } from '../../core/store.js';
import { myName, myAvatar } from '../../core/promptstore.js';
import { page, group, item, avatar, btn, textarea, actionSheet, dialog, toast } from '../../core/ui.js';
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
const line = () => resolveConn('image', 'studio');
const conn = size => { const c = line(); return c && { ...c, img: { ...c.img, size: size || TALL[c.type] || '832x1216' } }; };
const isNai = () => line()?.type === 'novelai';
const isGpt = () => ['openai-image', 'image-compat'].includes(line()?.type);
const sub = c => { const p = P.loaded(c.id); if (!p) return '只有头像'; const e = Object.keys(p.parts).length, m = Object.keys(p.poses || {}).length; return ['有立绘', e && `${e} 个表情`, m && `${m} 个动作`].filter(Boolean).join(' · '); };

export async function openStudio() {
  const p = page({ app: 'street', id: 'studio', title: APP, large: true, back: true, cls: 'as-studio' });
  const all = [who('me'), ...state.contacts];
  await P.preload(all.map(c => c.id));
  const list = all.map(c => { const s = h('span', sub(c)); return item({ icon: avatar(c.avatar, nameOf(c), 30), color: 'transparent', title: nameOf(c), sub: s, chevron: true, onClick: () => person(c.id, () => { s.textContent = sub(c); }) }); });
  p.body.append(group('', list));
  nav.push(p.el);
}

function person(cid, changed) {
  const c = who(cid), f = form.get(cid) || form.set(cid, { desc: '', ref: c.avatar ? 'avatar' : '' }).get(cid);
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
    // 做好的表情、动作各排一排：点一个立绘就换上，再点一下换回来
    const chips = (label, list, on) => { const row = h('div.as-studio__chips', h('span', label), list.map(([k, name]) => h('button', { onclick: e => {
      const b = e.currentTarget, sel = !b.classList.contains('is-on'); row.querySelectorAll('.is-on').forEach(x => x.classList.remove('is-on')); b.classList.toggle('is-on', sel); on(sel ? k : '');
    } }, name))); return list.length ? [row] : []; };
    const faces = P.PARTS.filter(([k]) => pt.parts[k]), poses = P.POSES.filter(([k]) => pt.poses?.[k]);
    const own = (title, prompt, use) => [
      item({ title: `复制${title}提示词`, chevron: true, onClick: () => copyText(prompt, `${title}提示词，和立绘一起发给 GPT`) }),
      item({ title: `上传画好的${title}宫格`, chevron: true, onClick: async () => { const file = await pickFile(); if (!file) return; if (!await ready()) return; toast(`正在切${title}宫格…`, true); try { await use(await fileToDataURL(file, 2048)); } catch (e) { log('warn', APP, `「${nameOf(c)}」上传的${title}宫格切不开：${e.message}`, e); toast('切不开：' + e.message); } } })];
    const tip = !line() ? '还没有生图线：表情会先用手机画个简单版，动作画不了' : isGpt() ? '' : `现在的生图线不是 GPT，最推荐用 GPT 的线：一次画完、贴得最准${isNai() ? '；NAI 画不了动作' : ''}`;
    ctl.replaceChildren(...chips('表情', faces, k => fig?.pt.hold(k)), ...chips('动作', poses, k => fig?.pt.pose(k)),
      group('表情', [item({ title: '生成表情', value: `${faces.length} / ${P.PARTS.length}`, chevron: true, onClick: makeFaces }), ...own('表情', P.gridPrompt, useGrid)], tip),
      group('动作', [item({ title: '生成动作', value: `${poses.length} / ${P.POSES.length}`, chevron: true, onClick: makePoses }), ...own('动作', P.posePrompt, usePoses)]),
      group('', [item({ title: '立绘图片', value: '下载 · 复制', chevron: true, onClick: async () => { const v = await actionSheet('立绘图片', [{ value: 'dl', label: '下载' }, { value: 'cp', label: '复制图片' }]); const src = await P.onWhite(pt); if (v === 'dl') download(src, `portrait-${cid}.png`); if (v === 'cp') copyImg(src); } }),
        pt.boxes && item({ title: '眼睛和嘴的位置', value: '重新框', chevron: true, onClick: async () => { if (taken()) return; const b = await frameAll(); if (b) { Object.assign(pt.boxes, b); await P.save(cid, pt); toast('框好了'); } } }),
        // 戴眼镜的：框一下两边镜片；只有没生图线、手机自己画闭眼时用得上
        pt.boxes && !line() && item({ title: '眼镜', value: pt.boxes.lensL ? '框好了' : '没戴', chevron: true, onClick: glasses })].filter(Boolean)),
      stop || h('div.as-studio__row', btn('重做立绘', 'secondary', async () => { if (await dialog({ title: '重做立绘？', text: '做好的表情和动作也会一起清掉。', confirm: '重做', danger: true })) { await P.drop(cid); paint(); } }),
        btn('删除', 'danger', async () => { if (await dialog({ title: '删除立绘？', text: '删掉后这个人回到只用头像。', confirm: '删除', danger: true })) { await P.drop(cid); paint(); } })));
  }
  async function glasses(e) {
    const pt = P.loaded(cid), row = e.currentTarget, v = await actionSheet('眼镜', [{ value: 'set', label: pt.boxes.lensL ? '重新框镜片' : '框镜片' }, pt.boxes.lensL && { value: 'off', label: '没戴眼镜', danger: true }].filter(Boolean));
    if (v === 'off') { delete pt.boxes.lensL; delete pt.boxes.lensR; }
    if (v === 'set') { if (taken()) return; const b = await frameAll([['lensL', '框住左边镜片'], ['lensR', '框住右边镜片']]); if (!b) return; Object.assign(pt.boxes, b); }
    if (v) { await P.save(cid, pt); row.querySelector('.as-list-item__value').textContent = pt.boxes.lensL ? '框好了' : '没戴'; }
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
  // 表情要知道眼睛和嘴在哪（切开后按这几块换）：第一次先框一下，框一次就记住
  const ready = async () => { const pt = P.loaded(cid); if (P.hasBoxes(pt)) return true; if (taken()) return false; const b = await frameAll(); if (!b) return false; pt.boxes = b; await P.save(cid, pt); return true; };
  async function makeFaces() {
    const pt = P.loaded(cid);
    if (!await ready()) return;
    if (!line()) { if (taken()) return; for (const k of P.LOCAL) pt.parts[k] = await P.drawPart(pt, k); await P.save(cid, pt); toast('先用手机画了简单版，接上生图线再生成会好很多'); paint(); return; }
    if (isNai()) return work('NAI 正在画表情…', async (stop, say) => {
      const bad = [], tiles = await P.naiTiles(pt);
      for (const [i, keys] of P.NAI_GRID.entries()) {
        say(`NAI 正在画表情 ${i + 1} / ${P.NAI_GRID.length}`);
        try {
          const src = await generateImage(P.naiGridPrompt, APP, conn('1216x832'), stop, { image: tiles, chars: P.naiChars(keys), strength: .55 });
          if (stop.aborted) return;
          const r = await P.cutGrid(pt, src, keys, keys, true);
          Object.assign(pt.parts, r.parts); bad.push(...r.bad); if (r.bad.length) log('warn', APP, `「${nameOf(c)}」NAI 表情这几格没对上`, r.why.join('\n'));
        } catch (e) { if (stop.aborted) return; bad.push(...keys.filter(Boolean).map(k => P.PARTS.find(x => x[0] === k)[1])); if (!e.logId) log('warn', APP, `「${nameOf(c)}」NAI 表情没画成：${e.message}`, e); }
      }
      await P.save(cid, pt); toast(bad.length ? `${bad.join('、')} 没成，可以再生成一次` : '表情做好了，点上面的按钮看看'); paint();
    });
    return work('正在画表情（一次画完）…', async stop => {
      try {
        const src = await generateImage(P.gridPrompt, APP, conn('1536x1024'), stop, await P.onWhite(pt));
        if (stop.aborted) return;
        await useGrid(src);
      } catch (e) { if (stop.aborted) return; if (!e.logId) log('warn', APP, `「${nameOf(c)}」的表情没画成：${e.message}`, e); toast('没画成：' + e.message); }
    });
  }
  async function makePoses() {
    if (!line()) { toast('还没有生图线：设置 → 连接 → 生图 里插一根线'); return; }
    if (isNai()) { toast('NAI 画不了一张里 8 个姿势，换 GPT 的线，或者复制动作提示词用自己的 GPT 画'); return; }
    if (!await ready()) return;
    return work('正在画动作（一次画完）…', async stop => {
      try {
        const src = await generateImage(P.posePrompt, APP, conn('1536x1024'), stop, await P.onWhite(P.loaded(cid)));
        if (stop.aborted) return;
        await usePoses(src);
      } catch (e) { if (stop.aborted) return; if (!e.logId) log('warn', APP, `「${nameOf(c)}」的动作没画成：${e.message}`, e); toast('没画成：' + e.message); }
    });
  }

  // 表情宫格切开、对齐、抠
  async function useGrid(src) {
    const pt = P.loaded(cid), { parts, bad, why } = await P.cutGrid(pt, src, P.GRID.filter(Boolean));
    Object.assign(pt.parts, parts); await P.save(cid, pt); if (bad.length) log('warn', APP, `「${nameOf(c)}」表情宫格里这几格没对上`, why.join('\n'));
    toast(bad.length ? `${bad.join('、')} 没对上，可以再生成一次` : '表情做好了，点上面的按钮看看'); paint();
  }
  // 动作宫格切开，每格按脸对齐成和立绘一样大的整张图
  async function usePoses(src) {
    const pt = P.loaded(cid), { poses, bad } = await P.cutPoses(pt, src);
    pt.poses = { ...pt.poses, ...poses }; await P.save(cid, pt);
    toast(bad.length ? `${bad.join('、')} 没切成` : '动作做好了，点上面的按钮看看'); paint();
  }
  // 图片：下载（存成文件）或复制（贴到 GPT 对话框里）
  const download = async (src, name) => { const u = URL.createObjectURL(await (await fetch(src)).blob()); const a = Object.assign(document.createElement('a'), { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3e4); };
  const copyImg = async src => { try { const b = await (await fetch(src)).blob(); await navigator.clipboard.write([new ClipboardItem({ [b.type]: b })]); toast('已复制图片'); } catch (e) { toast('这里复制不了图片，点下载'); } };
  const copyText = (t, what) => navigator.clipboard?.writeText(t).then(() => toast(`已复制${what}`), () => toast('复制失败'));

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
