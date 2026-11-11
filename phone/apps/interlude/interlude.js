// 幕间：和联系人一起开一局跑团（方案见 docs/pages-interlude.md）。整局不进正文、不进记忆。
// 打开是一张斜着看下去的 2.5D 书桌（GPT 画的一张图，一屏放下，不拖）；点桌上的东西镜头推过去、浮出玻璃标签：
// 主位（谁当 KP）、椅子（谁上桌）、档案袋（卷宗：进行中和打完的局）、调查员卡（车卡）、骰子盘（掷着玩）、台灯（点了直接开关灯）、旧地图（DND）、火漆信（剧本杀）。
// 车卡：先选好谁上桌，AI 一次给几个人一起车卡，再一张张微调；卡跟着人存。玩的时候是老照片场景 + 人物牌 + 对话框。
import { h, debounce, onLongPress } from '../../core/util.js';
import { state, contact, commit } from '../../core/store.js';
import { page, navBtn, navText, sheet, actionSheet, dialog, toast, btn, segmented, input, textarea, field, group, item, icon, avatar, switchEl, withInfo, empty } from '../../core/ui.js';
import { LANGS, langName } from '../../core/translate.js';
import * as nav from '../../core/nav.js';
import { myName, myAvatar } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import { pickMany } from '../chat/people.js';
import { log } from '../../core/log.js';
import * as G from './game.js';
import * as R from './rules.js';
import { restDice, throwDice } from './dice.js';
import { glass } from '../../core/glass.js';
import { speakAs } from '../../core/voice.js';
import { stopSpeak } from '../../core/api.js';
import { plain } from '../../core/act.js';
import * as P from '../../core/portrait.js';
import * as M from '../../core/music.js';
import { burn } from '../../core/burn.js';
import { noiseNode } from '../../core/noise.js';

const BASE = 'assets/interlude/';
const img = (k, cls = '') => h('img' + cls, { src: BASE + k + '.webp', alt: '', draggable: false });
const serif = s => h('span.as-int-serif', s);
// 桌上选好的东西：退出再进来还在
let seated = false;   // 上次坐了谁（主位、椅子）存着，退出、刷新回来还在
const pick = { scenario: 'random', ask: '', mood: 'serious', run: 'script', kp: 'sys', lang: {}, voice: null, party: [], mode: 'self', meet: true, use: 'new', note: '', speak: false };
const MAX_SEATS = 8;
const langs = () => Object.fromEntries([pick.kp, ...pick.party].filter(id => id !== 'sys').map(id => [id, pick.lang[id] || G.langOf(id)]));
// 这一桌的设置：车卡会 / 团公告照它认（换了人、本、车卡方式就作废）；pick 跟着存进去，退出、刷新后回来能接上
const table = () => ({ kp: pick.kp, party: pick.party, scenario: pick.scenario, ask: pick.ask, mood: pick.mood, run: pick.run, mode: pick.mode, use: pick.use, note: pick.note,
  meet: !!pick.meet, speak: pick.speak, lang: langs(), pick: JSON.parse(JSON.stringify(pick)) });
let restored = false;
const kpOk = () => pick.kp === 'sys' || !!contact(pick.kp);
let inflight = null;
let ac = null;   // 白噪音用的（和电台一样是程序算出来的）   // 正在等的那一回合（退出页面再进来还能接上）
const failed = (e, what) => { if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', what + '：' + e.message, e); toast(what + '：' + e.message); } };

/* ---------- 书桌 ---------- */
// 图上的位置（原图 1024×1536 的像素）：[左, 上, 右, 下]；椅子多两个数是头像坐的位置。第一把（远端正对着你的主位）是 KP 的
const IW = 1024, IH = 1536;
const SPOTS = [['files', [110, 900, 450, 1185], '卷宗', '所有的局'], ['cards', [545, 925, 840, 1095], '调查员卡', '车卡'], ['tray', [410, 755, 688, 905], '骰子盘', '掷骰子'],
  ['lamp', [605, 440, 790, 715], '台灯', '开关'], ['map', [240, 640, 485, 780], '旧地图', 'DND'], ['letter', [528, 1125, 805, 1285], '火漆信', '名录']];
const CHAIRS = [[430, 380, 605, 565, 517, 515], [45, 480, 230, 830, 150, 700], [805, 500, 1015, 900, 885, 715], [0, 650, 150, 1230, 75, 965], [890, 670, 1024, 1260, 960, 965]];
const pct = (v, all) => v / all * 100 + '%';
const keepSeats = () => { state.apps.interlude.seat = { kp: pick.kp, party: pick.party }; commit('apps'); };

export function open() {
  const more = navBtn('more', '更多', async () => {
    const g = G.current();
    const v = await actionSheet('幕间', [g ? { value: 'quit', label: `放弃《${g.title}》`, danger: true } : null, !g && G.meeting(table()) ? { value: 'setup', label: '改开局设置' } : null, { value: 'rule', label: '规则小抄' }].filter(Boolean));
    if (v === 'setup') setupSheet(() => cardPage(syncBar), chooseKp, choose);
    if (v === 'quit' && await dialog({ title: '放弃这一局？', text: '放弃后回到桌上，可以开新的一局。', confirm: '放弃', danger: true })) { await G.quit(g); syncBar(); }
    if (v === 'rule') dialog({ title: '规则小抄', text: '掷 1D100，小于等于技能值就成功；困难要小于等于一半，极难要小于等于五分之一。看到可怕的东西要掷理智，一次掉 5 点以上会临时发疯。血归零倒地，理智归零退场。', confirm: '知道了', cancel: '' });
  });
  const p = page({ app: 'interlude', id: 'int-desk', title: '幕间', large: true, back: true, cls: 'as-int-desk', right: [more] });
  const world = h('div.as-int-world', img('desk-day'), img('desk-night', '.is-night'));
  const scene = h('div.as-int-scene', world);
  p.el.prepend(scene);
  // 台灯：默认跟着手机的深色模式，点了自己开关
  let lamp = null;
  const lampOn = () => lamp ?? (document.querySelector('.as-phone')?.dataset.mode === 'night');
  const paintLamp = () => scene.classList.toggle('is-lit', lampOn());
  paintLamp();
  const mo = new MutationObserver(() => { if (!scene.isConnected) mo.disconnect(); else if (lamp === null) paintLamp(); });
  mo.observe(document.querySelector('.as-phone'), { attributes: true, attributeFilter: ['data-mode'] });
  // 标签：钉在东西上的小玻璃牌
  const tag = (x, y, text, cls = '') => h('span.as-int-pin' + cls, { style: `left:${pct(x, IW)};top:${pct(y, IH)}` }, h('i'), h('b', text));
  const hot = (box, key) => h('button.as-int-hot', { 'aria-label': key, dataset: { k: key }, style: `left:${pct(box[0], IW)};top:${pct(box[1], IH)};width:${pct(box[2] - box[0], IW)};height:${pct(box[3] - box[1], IH)}` });
  SPOTS.forEach(([k, b, name, sub]) => world.append(hot(b, k), tag((b[0] + b[2]) / 2, b[1] + 6, sub ? `${name} · ${sub}` : name)));
  CHAIRS.forEach((c, i) => world.append(hot(c, i ? 'chair' : 'kp')));
  world.append(tag(517, 390, '主位 · KP'));
  // 左边远处那把椅子也钉一个小牌（和主位一样一直在），不然不知道点椅子能叫人上桌；椅子靠边，牌子往里伸，不出屏幕
  world.append(tag(175, 500, '座位 · 选人上桌', '.is-l'));
  // 椅子上坐的人：主位是 KP（中立的就放剪影），其余四把坐玩家；超过四个人，最后一把叠着显示「+几」
  const seats = CHAIRS.map(c => { const el = h('span.as-int-sit', { style: `left:${pct(c[4], IW)};top:${pct(c[5], IH)}` }); world.append(el); return el; });
  const paintSeats = () => {
    const kc = pick.kp !== 'sys' && contact(pick.kp);
    seats[0].replaceChildren(kc ? avatar(kc.avatar, nameOf(kc), 40) : h('span.as-int-sit__kp', img('kp')), h('small', kc ? nameOf(kc) : '中立 KP')); seats[0].hidden = false;
    seats.slice(1).forEach((el, i) => { const c = contact(pick.party[i]), more = i === 3 && pick.party.length > 4 ? pick.party.length - 3 : 0;
      el.replaceChildren(...(c ? [avatar(c.avatar, nameOf(c), 40), more ? h('b.as-int-sit__more', '+' + (more - 1)) : null, h('small', more ? `还有 ${more - 1} 人` : nameOf(c))].filter(Boolean) : [])); el.hidden = !c; });
  };
  if (!seated) { seated = true; Object.assign(pick, state.apps.interlude.seat); }
  pick.party = pick.party.filter(id => contact(id) && id !== pick.kp); if (!kpOk()) pick.kp = 'sys'; paintSeats();
  const dice = h('div.as-int-traydice', { style: `left:${pct(470, IW)};top:${pct(770, IH)};width:${pct(160, IW)};height:${pct(110, IH)}` }); world.append(dice); restDice(dice);
  // 拖着看、推镜头
  // 一屏放下整张桌子（作者不要左右拖）：比铺满再小一点好让两边的椅子露出来；图贴着顶，空出的一小截落在底下「上桌」那条后面（贴底的话顶上会空一大块）；靠边那两把椅子上的头像往里挪到看得见的地方
  let W = 0, H = 0, ww = 0, wh = 0, ox = 0, oy = 0, zoom = null;
  const apply = (anim = true) => {
    world.style.transition = anim ? '' : 'none';
    if (!zoom) { world.style.transform = 'translate(0, 0) scale(1)'; return; }
    const s = 1.75, cx = zoom[0] * ww / IW, cy = zoom[1] * wh / IH;
    const tx = Math.min(-ox, Math.max(W - ox - ww * s, W / 2 - ox - cx * s)), ty = Math.min(-oy, Math.max(H - oy - wh * s, H * .4 - oy - cy * s));
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  const fit = () => {
    W = scene.clientWidth; H = scene.clientHeight; const k = Math.max(W / IW, H / IH * .92); ww = IW * k; wh = IH * k; ox = (W - ww) / 2; oy = 0;
    Object.assign(world.style, { width: ww + 'px', height: wh + 'px', left: ox + 'px', top: oy + 'px' });
    const cut = -ox / k + 40; seats.forEach((el, i) => { el.style.left = pct(Math.min(IW - cut, Math.max(cut, CHAIRS[i][4])), IW); });   // 靠边的往里挪
    apply(false);
  };
  new ResizeObserver(fit).observe(scene);
  scene.addEventListener('click', e => {
    if (e.target.closest('.as-int-label')) return;
    const hit = e.target.closest('.as-int-hot');
    if (!hit) { if (zoom) unzoom(); return; }
    if (hit.dataset.k === 'lamp') { lamp = !lampOn(); paintLamp(); return; }   // 台灯只管开关灯
    focus(hit.dataset.k, hit);
  });
  // 推过去以后下面浮出的玻璃标签
  const label = h('div.as-int-label'); p.el.append(label);
  const unzoom = () => { zoom = null; apply(); label.classList.remove('is-open'); scene.classList.remove('is-zoomed'); };
  function focus(k, el) {
    const r = el.getBoundingClientRect(), w = world.getBoundingClientRect();
    zoom = [((r.left + r.right) / 2 - w.left) / w.width * IW, ((r.top + r.bottom) / 2 - w.top) / w.height * IH]; apply(); scene.classList.add('is-zoomed');
    const n = pick.party.length, kc = pick.kp !== 'sys' && contact(pick.kp), done = G.all().filter(g => g.done).length, going = G.all().filter(g => !g.done).length + !!G.meetNow();
    const L = {
      kp: ['主位 · KP', kc ? `${nameOf(kc)} 来主持` : '中立的守秘人，不下场', [['换 KP', () => chooseKp(() => focus(k, el))]]],
      chair: ['座位', n ? `上桌：${pick.party.map(id => nameOf(contact(id))).join('、')}` : '还没有人上桌', [['选谁上桌', () => choose()]]],
      files: ['卷宗', [going && `进行中 ${going} 局`, done && `打完了 ${done} 局`].filter(Boolean).join(' · ') || '还没有局', [['翻卷宗', () => { unzoom(); archivePage(syncBar, resume); }]]],
      cards: ['调查员卡', '你和上桌的人各一张', [['看卡 · 车卡', () => { unzoom(); cardPage(syncBar); }]]],
      tray: ['骰子盘', '1D100', [['掷一下', async () => { const r = R.d100(); await rollOverlay(p.el, r.t, r.u, '1D100', '掷出 ' + r.v); }]]],
      map: ['旧地图 · DND', '还没开放', []],
      letter: ['火漆信 · 调查员名录', `${G.allCards().length} 张卡`, [['翻开', () => { unzoom(); rosterPage(); }]]],
    }[k];
    label.replaceChildren(h('b', L[0]), L[1] ? h('small', L[1]) : null, h('div', ...L[2].map(([t, fn]) => btn(t, 'primary', fn)), btn('退回', 'secondary', unzoom)));
    label.classList.add('is-open');
  }
  async function choose(then) {
    const got = await pickMany(`谁上桌（最多 ${MAX_SEATS} 个）`, state.contacts.filter(c => c.id !== pick.kp).map(c => ({ key: c.id, name: nameOf(c), avatar: c.avatar })), { preselect: pick.party });
    if (!got) return;
    if (got.length > MAX_SEATS) toast(`最多 ${MAX_SEATS} 个，先坐前 ${MAX_SEATS} 个`);
    pick.party = got.slice(0, MAX_SEATS); keepSeats(); paintSeats(); unzoom(); syncBar(); then && then();
  }
  async function chooseKp(then) {
    const v = await actionSheet('谁当 KP', [{ value: 'sys', label: '中立 KP（系统）', active: pick.kp === 'sys' }, ...state.contacts.map(c => ({ value: c.id, label: nameOf(c), active: pick.kp === c.id }))]);
    if (!v) return;
    pick.kp = v; pick.party = pick.party.filter(id => id !== v); keepSeats(); paintSeats(); syncBar(); then && then();
  }
  // 底下一条：谁上桌 + 开局 / 继续
  const who = h('span'), go = btn('开局', 'primary', () => { const g = G.current(); if (g) playPage(g); else if (G.meeting(table())) cardPage(syncBar, true); else setupSheet(() => cardPage(syncBar), chooseKp, choose); });
  const newB = btn('新开一局', 'secondary', () => setupSheet(() => cardPage(syncBar), chooseKp, choose));
  const bar = h('div.as-int-bar', who, newB, go); p.body.append(bar);
  function syncBar() { const g = G.current(); who.hidden = !!g; newB.hidden = !g; bar.classList.toggle('is-going', !!g); who.textContent = `上桌：${['你', ...pick.party.map(id => nameOf(contact(id)))].join('、')}`; go.textContent = g ? `继续《${g.title}》` : G.meeting(table()) ? '继续车卡' : '开局'; }
  const resume = () => { const saved = G.savedPick(); if (saved) { Object.assign(pick, saved); pick.party = pick.party.filter(id => contact(id) && id !== pick.kp); paintSeats(); } syncBar(); };
  G.load().then(() => { if (!restored) resume(); restored = true; syncBar(); });
  p.el._onShow = syncBar;
  if (state.apps.interlude.splash) splash(p.el);
  return p.el;
}

/* ---------- 开屏：羊皮卷展开 → 羽毛笔写下深蓝鎏金的楷书 → 火漆盖章 → 整张纸烧起来、灰随风散掉 ---------- */
// 开屏语轮着用（作者挑的七句）；字体两款轮着随机。都在设置 → 应用管理 → 幕间里能改
export const SPLASH_FONTS = [['xdks', '玄冬楷书'], ['qtbf', '千图笔锋手写体']];
export const SPLASH_LINES = ['这一夜不会被记住。所以，放心去做。', '愿你今夜运气很好，好到不必知道真相。', '门后面的东西也在等你。它比你有耐心。', '别在纸上找自己的名字。找到了，也别念出声。',
  '龙在睡觉。别在这时候数你的金币。', '灯灭之后，请各位保持原来的表情。', '读到这里，还来得及合上。——算了，你已经坐下了。'];
const loadImg = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
async function splash(host) {
  const A = state.apps.interlude, pickF = A.font || 'random', f = SPLASH_FONTS.find(x => x[0] === pickF) || SPLASH_FONTS[Math.floor(Math.random() * SPLASH_FONTS.length)];
  const pool = SPLASH_LINES.filter((_, i) => !(A.lineOff || []).includes(i)); if (!pool.length) pool.push(SPLASH_LINES[0]);
  const line = pool[(A.turn || 0) % pool.length]; A.turn = ((A.turn || 0) + 1) % 10000; commit('apps');
  const cv = h('canvas'), fx = h('canvas'), el = h('div.as-int-splash', img('splash-bg'), cv, fx, h('button.as-int-splash__skip', { onclick: () => done() }, '跳过'));
  host.append(el);
  let dead = false, raf = 0;
  function done() { if (dead) return; dead = true; cancelAnimationFrame(raf); el.classList.add('is-out'); setTimeout(() => el.remove(), 500); }
  const face = new FontFace('AsterSplash', `url(${BASE}fonts/${f[0]}.woff2)`);
  const [paper, quill, seal] = await Promise.all([loadImg(BASE + 'scroll.webp'), loadImg(BASE + 'quill.webp'), loadImg(BASE + 'seal.webp'), face.load().then(x => document.fonts.add(x)).catch(() => {})]);
  if (dead || !paper) { done(); return; }
  const dpr = Math.min(2, devicePixelRatio || 1), W = el.clientWidth, H = el.clientHeight, pw = Math.min(W * .84, H * .6 * paper.width / paper.height), ph = pw * paper.height / paper.width;
  const px = (W - pw) / 2, py = (H - ph) / 2;
  for (const c of [cv, fx]) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
  const x = cv.getContext('2d'), y = fx.getContext('2d'); x.scale(dpr, dpr); y.scale(dpr, dpr);
  const FONT = '"AsterSplash", "Noto Serif SC", serif', size = pw * .092;
  // 句子按纸的宽度折行，每行居中；落款靠右
  x.font = `${size}px ${FONT}`;
  const rows = []; let cur = '';
  for (const ch of line) { if (x.measureText(cur + ch).width > pw * .74 && cur && !'。，、；：？！—」'.includes(ch)) { rows.push(cur); cur = ''; } cur += ch; }   // 标点不开头
  if (cur) rows.push(cur);
  const top = .5 - (rows.length - 1) * .08;
  const lines = rows.map((t, i) => [t, size, top + i * .16, 0]);
  const gold = (y0, y1) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#f6e3a1'); g.addColorStop(.5, '#c9973c'); g.addColorStop(1, '#8a6224'); return g; };
  const xOf = (t, sz, right) => right ? px + pw * .86 - x.measureText(t).width : W / 2 - x.measureText(t).width / 2;   // 左边
  // 深蓝的字、鎏金的边：先描一圈金，再把字填上
  const text = (t, sz, ry, right) => { x.font = `${sz}px ${FONT}`; x.textAlign = 'left'; x.textBaseline = 'middle';
    const cy = py + ph * ry, lx = xOf(t, sz, right); x.lineJoin = 'round'; x.lineWidth = Math.max(1.6, sz * .075); x.strokeStyle = gold(cy - sz / 2, cy + sz / 2); x.strokeText(t, lx, cy); x.fillStyle = '#16244a'; x.fillText(t, lx, cy); };
  // 一步步：展开 0.8s → 每行按长短写 → 盖章 → 烧
  const T0 = performance.now(), unroll = 800, perChar = 110, gap = 260;
  const plan = []; let t = unroll + 200; for (const l of lines) { const d = Math.max(500, l[0].length * perChar); plan.push([t, d]); t += d + gap; }
  const stampAt = t + 100, burnAt = stampAt + 1100, burnLen = 2200, end = burnAt + burnLen + 300;
  let snap = null, noise = null, ash = [], stamped = false;
  // 纸烧起来：先把写好字、盖好章的这张纸拍成一张图，再按「噪声 + 离左下角多远」算每个点什么时候烧到
  const prep = () => {
    const w = Math.round(W * dpr), hh = Math.round(H * dpr); snap = x.getImageData(0, 0, w, hh);
    // 两层噪声（粗的定大轮廓、细的让火边碎一点）
    const layer = c => { const gw = Math.ceil(w / c) + 2, gh = Math.ceil(hh / c) + 2, g = Float32Array.from({ length: gw * gh }, Math.random);
      return (i, j) => { const gx = i / c, gy = j / c, x0 = gx | 0, y0 = gy | 0, a = gx - x0, b = gy - y0, sx = a * a * (3 - 2 * a), sy = b * b * (3 - 2 * b);
        return g[y0 * gw + x0] * (1 - sx) * (1 - sy) + g[y0 * gw + x0 + 1] * sx * (1 - sy) + g[(y0 + 1) * gw + x0] * (1 - sx) * sy + g[(y0 + 1) * gw + x0 + 1] * sx * sy; }; };
    const big = layer(40 * dpr), fine = layer(7 * dpr);
    noise = new Float32Array(w * hh);
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) {
      const dist = Math.hypot(i / dpr - px, j / dpr - (py + ph)) / Math.hypot(pw, ph);
      noise[j * w + i] = dist * .82 + big(i, j) * .13 + fine(i, j) * .05;
    }
  };
  const burn = k => {
    const w = snap.width, out = x.createImageData(w, snap.height), s = snap.data, o = out.data, T = k * 1.1;
    for (let p = 0, i = 0; p < noise.length; p++, i += 4) {
      const a = s[i + 3]; if (!a) continue;
      const d = noise[p] - T;
      if (d < -.012) continue;                                   // 烧没了
      if (d < 0) { const e = 1 + d / .012; o[i] = 255; o[i + 1] = 110 + 120 * e; o[i + 2] = 20 + 40 * e; o[i + 3] = a * e; if (Math.random() < .002) ash.push(p); continue; }   // 火边
      const c = d < .025 ? d / .025 : 1;                          // 火边往里窄窄一圈烤焦
      o[i] = s[i] * c + 40 * (1 - c); o[i + 1] = s[i + 1] * c + 18 * (1 - c); o[i + 2] = s[i + 2] * c + 6 * (1 - c); o[i + 3] = a;
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.putImageData(out, 0, 0); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const flakes = [];
  const step = now => {
    if (dead) return;
    const ms = now - T0;
    if (ms < burnAt) {
      x.clearRect(0, 0, W, H);
      const u = Math.min(1, ms / unroll), e = 1 - Math.pow(1 - u, 3);
      x.save(); x.beginPath(); x.rect(px - 20, py, pw + 40, ph * e); x.clip();
      x.drawImage(paper, px, py, pw, ph);
      let pen = null;
      lines.forEach((l, i) => {
        const [t0, d] = plan[i]; if (ms < t0) return;
        const k = Math.min(1, (ms - t0) / d);
        x.font = `${l[1]}px ${FONT}`; const m = x.measureText(l[0]).width, left = xOf(l[0], l[1], l[3]) - 6, right = left + (m + 12) * k;
        x.save(); x.beginPath(); x.rect(left, py + ph * l[2] - l[1], right - left, l[1] * 2); x.clip(); text(...l); x.restore();
        if (k < 1) pen = [right, py + ph * l[2]];
      });
      if (ms > stampAt && seal) {
        if (!stamped) { stamped = true; thud(); }
        const k = Math.min(1, (ms - stampAt) / 180), sz = pw * .26 * (1 + (1 - k) * 1.4), sxp = px + pw * .24, syp = py + ph * .8;
        x.globalAlpha = k; x.save(); x.translate(sxp, syp); x.rotate(-.2); x.drawImage(seal, -sz / 2, -sz / 2, sz, sz * seal.height / seal.width);
        x.font = `${sz * .2}px ${FONT}`; x.fillStyle = '#f3dcc7'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('幕间', 0, 0); x.restore(); x.globalAlpha = 1;
      }
      x.restore();
      y.clearRect(0, 0, W, H);
      if (pen && quill) { const qh = pw * .34, qw = qh * quill.width / quill.height; y.save(); y.translate(pen[0], pen[1]); y.rotate(.5 + Math.sin(ms / 60) * .06); y.drawImage(quill, -qw * .15, -qh, qw, qh); y.restore(); }
    } else {
      if (!snap) { prep(); y.clearRect(0, 0, W, H); }
      const k = Math.min(1, (ms - burnAt) / burnLen); ash.length = 0; burn(k);
      // 火边落下的灰：往右上飘，越飘越淡
      for (const pi of ash.slice(0, 18)) { const w = snap.width; flakes.push({ x: (pi % w) / dpr, y: (pi / w | 0) / dpr, vx: 20 + Math.random() * 50, vy: -20 - Math.random() * 40, life: 1, s: 1 + Math.random() * 2.5, hot: Math.random() < .3 }); }
      y.clearRect(0, 0, W, H);
      for (const f of flakes) { f.x += f.vx / 60; f.y += f.vy / 60; f.vy -= .3; f.vx += Math.sin(f.y / 30); f.life -= .012;
        if (f.life > 0) { y.globalAlpha = f.life; y.fillStyle = f.hot ? '#ffb347' : '#3b332c'; y.fillRect(f.x, f.y, f.s, f.s * .7); } }
      y.globalAlpha = 1;
      if (ms > end) { done(); return; }
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
let actx = null;
function thud() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + .12);
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .18); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .2);
  } catch (e) { /* 不让响就算了 */ }
}

/* ---------- 开局设置：本、气氛、KP、每个人说什么语言、语音怎么合成 → 下一步车卡 ---------- */
export const VOICE_MODES = [['tap', '点了才合成'], ['next', '提前合成下两句'], ['all', '全部合成']];
const voiceDefault = () => ({ auto: 'next' }[state.apps.interlude.voice] || state.apps.interlude.voice || 'tap');
let setupOk = false;   // 这一局的开局设置定过没有：从书桌「调查员卡」直接进来点开局时要先定
function setupSheet(next, chooseKp, choose) {   // 没给 chooseKp：车卡页开局前补定，只问这一局怎么玩
  pick.voice = pick.voice || voiceDefault();
  const ask = textarea({ value: pick.ask, rows: 2, placeholder: '想玩什么', onInput: v => { pick.ask = v.trim(); } });
  const rows = [...R.SCENARIOS.map(s => ({ value: s.id, label: s.title, sub: s.blurb })), { value: 'random', label: '随机生成', sub: '让 KP 现编一个' }].map(o =>
    item({ title: o.label, sub: o.sub, right: h('span.as-check', icon('check', 18, 2.4)), cls: pick.scenario === o.value ? 'is-on' : '', onClick: e => {
      pick.scenario = o.value; [...e.currentTarget.parentNode.children].forEach(x => x.classList.toggle('is-on', x === e.currentTarget)); askF.hidden = o.value !== 'random'; } }));
  const askF = field('要求', ask); askF.hidden = pick.scenario !== 'random';
  // 车卡会、车卡方式：开车卡会先定大家统一用新卡、旧卡还是随机；用旧卡就不用选车卡方式
  const useF = field('用新卡还是旧卡', segmented(G.USES, pick.use, v => { pick.use = v; paintMeet(); })), modeF = field('车卡方式', segmented(G.MODES, pick.mode, v => { pick.mode = v; }));
  const paintMeet = () => { useF.hidden = !pick.meet; modeF.hidden = pick.meet && pick.use === 'old'; };
  const modeBox = h('div', group('', [item({ title: withInfo('车卡会', '开局前大家边车卡边聊，KP 定下规矩；你的卡自己交给 KP 审。'), right: switchEl(pick.meet, v => { pick.meet = v; paintMeet(); }, '车卡会') })]), useF, modeF);
  paintMeet();
  const noteF = field('车卡补充', textarea({ value: pick.note, rows: 2, placeholder: '想怎么车卡', onInput: v => { pick.note = v.trim(); } }));
  const mood = segmented(R.MOODS, pick.mood, v => { pick.mood = v; });
  const run = segmented([['script', '剧本'], ['free', '自由']], pick.run, v => { pick.run = v; });
  const kpName = () => pick.kp === 'sys' ? '中立 KP（系统）' : nameOf(contact(pick.kp));
  const kpRow = item({ title: 'KP', value: kpName(), chevron: true, onClick: () => chooseKp(() => { kpRow.querySelector('.as-list-item__value').textContent = kpName(); paintLang(); }) });
  // 没在椅子那里选人，这里也能选谁上桌
  const partyName = () => pick.party.map(id => nameOf(contact(id))).join('、') || '只有你';
  const partyRow = item({ title: '谁上桌', value: partyName(), chevron: true, onClick: () => choose(() => { partyRow.querySelector('.as-list-item__value').textContent = partyName(); paintLang(); }) });
  // 每个人说什么语言：默认照聊天设置，在这里改只管这一局
  const langBox = h('div');
  const langOf = id => pick.lang[id] || G.langOf(id);
  const paintLang = () => langBox.replaceChildren(group('说什么语言', [...(pick.kp !== 'sys' ? [pick.kp] : []), ...pick.party].map(id => { const c = contact(id);
    const row = item({ icon: avatar(c.avatar, nameOf(c), 28), color: 'transparent', title: nameOf(c) + (id === pick.kp ? '（KP）' : ''), value: langName(langOf(id)), chevron: true, onClick: async () => {
      const v = await actionSheet(`${nameOf(c)}说什么语言`, LANGS.map(([k, n]) => ({ value: k, label: n, active: langOf(id) === k })));
      if (v) { pick.lang[id] = v; row.querySelector('.as-list-item__value').textContent = langName(v); }
    } }); return row; }), '旁白都用中文；台词不是中文的，下面跟一行中文翻译'));
  paintLang();
  const s = sheet({ title: '开局', cls: 'as-int-sheet', content: [group('玩哪个本', rows), askF, field('气氛', mood), field(withInfo('跑法', '剧本：开局时 KP 就把整局写好，掷完骰直接放，你打字时才找 AI。自由：每回合都找 AI 现编。'), run),
    group('', [...chooseKp ? [kpRow, partyRow] : [],
      item({ title: withInfo('抢话', '开着：车卡会和跑团里，AI 会把你大概会做的事、会说的话也演出来。关着：只写别人，你的话自己说。'), right: switchEl(pick.speak, v => { pick.speak = v; }, '抢话') })]),
    ...chooseKp ? [modeBox, noteF] : [], langBox, field('语音', segmented(VOICE_MODES, pick.voice, v => { pick.voice = v; })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn(chooseKp ? '下一步：车卡' : '开局', 'primary', () => { s.close(); setupOk = true; next(); }))] });
}

/* ---------- 调查员卡：上面一排头像切换，下面是这个人的卡（羊皮纸）；没卡的人一起让 AI 车 ---------- */
const ownerName = o => o === 'me' ? myName() : nameOf(contact(o));
// 团公告的羊皮纸（车卡会墙上那张、卡片页点开的都是它）：先写你的档位和规矩，虚线下面是背景；底下小箭头朝下能展开、朝上收起。
// 日夜两张纸先解码好再放上去，不然有一帧只有字
const postEl = m => h('div.as-int-post', img('seal'), h('b', '团公告'), h('div.as-int-post__text', h('p', G.meetRules(m)), h('p', m.hint)), h('i.as-int-post__more', icon('chevron', 16, 2)));
// 念台词的小喇叭：点了先转圈（在合成），出声了变成暂停键（和电台一样）；转圈时再点是取消，出声时再点是停
const voiceBtn = fn => { const vol = icon('volume', 18, 1.8), stop = icon('pause', 18, 1.8), b = h('button.as-int-box__voice', { 'aria-label': '念这一句', onclick: e => { e.stopPropagation(); fn(); } }, vol);
  b.set = st => { b.st = st; b.replaceChildren(st === 'load' ? h('span.as-spin') : st === 'on' ? stop : vol); b.classList.toggle('is-on', st === 'on'); }; return b; };
const paper = () => Promise.all(['scroll', 'scroll-night'].map(n => { const i = new Image(); i.src = BASE + n + '.webp'; return i.decode().catch(() => {}); }));
const SEXES = [['男', '男'], ['女', '女']];   // 能点就不打字
const CR = '信用评级';
const shownName = o => o === 'me' ? '你' : ownerName(o);   // 给人看的：你自己写「你」
// 属性填得太低时的提醒（自己填卡时实时显示）
const LOW = { STR: '搬东西、打架都吃亏', CON: '血少、容易病倒', SIZ: '血少、一推就倒', DEX: '跑得慢、躲不开', APP: '第一印象差，社交难', INT: '难想通线索，兴趣点也少', POW: '理智低、容易发疯', EDU: '本职点少' };
const ownerFace = (o, size) => o === 'me' ? avatar(myAvatar(), myName(), size, size > 60 ? 'square' : 'round') : avatar(contact(o).avatar, nameOf(contact(o)), size, size > 60 ? 'square' : 'round');

/* ---------- 成卡：三页（卡面 / 背景 / 关系），上面一排头像换人；车完自动弹出，车卡页、车卡会、游戏里随时点开 ----------
   ps [{ o 'me' | 联系人 id, c 卡（局里的带着现在的血、理智、东西） }]；rel、npcs 关系图（局里的，或者照卡上的认识谁）；now 这回合变的标「新」 */
// 照相馆画过立绘的用立绘，没有用头像
const shot = (o, size) => { const p = P.loaded(o); return p ? h('img', { src: p.base, alt: '' }) : avatar(o === 'me' ? myAvatar() : contact(o).avatar, o === 'me' ? myName() : nameOf(contact(o)), size, 'square'); };
const radar = a => { const n = R.ATTRS.length, pt = (r, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / n; return [50 + r * Math.cos(t), 50 + r * Math.sin(t)].map(v => v.toFixed(1)); };
  const ring = f => R.ATTRS.map(([k], i) => pt(38 * f(k), i).join(',')).join(' ');
  return h('div.as-int-radar', { html: `<svg viewBox="-14 -4 128 108">${[.25, .5, .75, 1].map(f => `<polygon class="is-grid" points="${ring(() => f)}"/>`).join('')}`
    + R.ATTRS.map((_, i) => `<line x1="50" y1="50" x2="${pt(38, i)[0]}" y2="${pt(38, i)[1]}"/>`).join('') + `<polygon class="is-val" points="${ring(k => Math.min(99, a[k]) / 100)}"/>`
    + R.ATTRS.map(([k, nm], i) => { const [x, y] = pt(47, i); return `<text x="${x}" y="${y}">${nm} ${a[k]}</text>`; }).join('') + '</svg>' }); };
async function cardView(ps, start, rel = [], npcs = [], now = -1) {
  await P.preload(ps.map(x => x.o));
  let at = Math.max(0, ps.findIndex(x => x.o === start)), on = null;
  const one = h('div.as-int-cv__page'), two = h('div.as-int-cv__page'), three = h('div.as-int-cv__page'), pages = h('div.as-int-cv__pages', one, two, three);
  const tabs = h('div.as-int-cv__nav', ['卡面', '背景', '关系'].map((t, i) => h('button', { onclick: () => pages.scrollTo({ left: i * pages.clientWidth, behavior: 'smooth' }) }, t)));
  const mark = () => { const i = Math.round(pages.scrollLeft / pages.clientWidth); [...tabs.children].forEach((b, k) => b.classList.toggle('is-on', k === i)); };
  pages.addEventListener('scroll', mark, { passive: true });
  const who = h('div.as-int-tabs', ps.map((x, i) => h('button', { onclick: () => { at = i; paint(); } }, ownerFace(x.o, 40), h('small', x.c.name))));
  const list = L => L.length ? h('ul.as-int-cv__list', L.map(t => h('li', t))) : h('p.as-int-cv__none', '暂无');
  // 关系图：调查员是钉在纸上的拍立得，NPC 是一张写着名字的小纸条；线上写关系，点人只亮跟 TA 有关的线，点线下面写两边各自怎么看
  const nodes = [...ps.map(x => ({ name: x.c.name, o: x.o })), ...npcs.map(p => ({ name: p.name, gone: p.gone }))], node = n => nodes.find(x => x.name === n);
  nodes.forEach((n, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / nodes.length; Object.assign(n, nodes.length === 1 ? { x: 50, y: 50 } : { x: 50 + 34 * Math.cos(t), y: 50 + 33 * Math.sin(t) }); });   // 围成一圈
  const L = rel.filter(y => node(y.a) && node(y.b)), said = h('p.as-int-board__said');
  const lines = h('div', { html: `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${L.map(y => `<line x1="${node(y.a).x}" y1="${node(y.a).y}" x2="${node(y.b).x}" y2="${node(y.b).y}"/>`).join('')}</svg>` }).firstChild;
  const tags = L.map(y => h('button.as-int-board__tag', { style: { left: (node(y.a).x + node(y.b).x) / 2 + '%', top: (node(y.a).y + node(y.b).y) / 2 + '%' },
    onclick: () => { said.replaceChildren(h('span', `${y.a} 眼里的 ${y.b}：${y.ab || '没说'}`), h('span', `${y.b} 眼里的 ${y.a}：${y.ba || '没说'}`)); } }, y.r === now ? h('i', '新') : null, y.ab || y.ba));
  const els = nodes.map((n, i) => h('button.as-int-board__n', { style: { left: n.x + '%', top: n.y + '%' }, onclick: () => focus(n.name) },
    n.o ? h('div.as-int-pol', { style: { '--r': (i % 2 ? 3 : -3) + 'deg' } }, h('i.as-int-pin'), shot(n.o, 56), h('b', n.name), h('small', G.realName(n.o)))
      : h('div.as-int-slip' + (n.gone ? '.is-gone' : ''), h('i.as-int-pin'), n.name)));
  three.append(h('div.as-int-board', lines, ...els, ...tags), said, L.length ? null : h('p.as-int-cv__none', '大家互不认识'));
  function focus(n) {
    on = on === n ? null : n; said.replaceChildren();
    L.forEach((y, i) => { const off = on && y.a !== on && y.b !== on; lines.children[i].classList.toggle('is-dim', !!off); tags[i].classList.toggle('is-dim', !!off); });
    nodes.forEach((x, i) => els[i].classList.toggle('is-dim', !!on && x.name !== on && !L.some(y => (y.a === on && y.b === x.name) || (y.b === on && y.a === x.name))));
  }
  function paint() {
    const { o, c } = ps[at], d = R.derived(c.attrs), base = R.baseSkills(c.attrs);
    [...who.children].forEach((b, k) => b.classList.toggle('is-on', k === at));
    one.replaceChildren(
      h('div.as-int-cv__top', h('div.as-int-pol.is-big', h('i.as-int-pin'), shot(o, 110)), h('div',
        h('b.as-int-cv__name', c.name), h('small', `（${G.realName(o)}）`), h('p', [c.job, c.age && `${c.age} 岁`, c.sex, c.home].filter(Boolean).join(' · ')),
        h('div.as-int-cv__stats', [['血', c.hp ?? d.hp, c.hpMax], ['理智', c.san ?? d.san, c.sanMax], (c.abilities || []).length && ['魔法', c.mp ?? d.mp, c.mpMax]].filter(Boolean)
          .map(([k, v, m]) => h('span', h('small', k), `${v}${m ? '/' + m : ''}`))))),
      radar(c.attrs),
      h('h3', '技能'), h('div.as-int-cv__skills', Object.keys(base).filter(k => c.skills[k] > base[k]).sort((x, y) => c.skills[y] - c.skills[x]).map(k => h('span', k, h('b', c.skills[k])))),
      h('h3', '随身'), list((c.items || []).map(G.itemText)),
      (c.abilities || []).length ? [h('h3', '特殊能力'), list(c.abilities.map(G.powerText))] : null);
    two.replaceChildren(h('h3', '背景故事'), h('p.as-int-cv__story', c.bg.story || '暂无'),
      h('div.as-int-cv__info', G.BG.filter(([k]) => k !== 'story').map(([k, n]) => h('div', h('b', n), h('p', c.bg[k] || '暂无')))));
    one.scrollTop = two.scrollTop = 0; if (on !== c.name) focus(c.name);
  }
  paint();
  const body = h('div', who, tabs, pages);
  await Promise.all([...body.querySelectorAll('img')].map(i => i.decode().catch(() => {})));   // 图解码好再弹，不闪
  sheet({ title: '调查员', cls: 'as-int-cv', content: body });
  mark();
}
function cardPage(back, resume) {
  const owners = ['me', ...pick.party], cur = Object.fromEntries(owners.map(o => [o, G.lastCard(o)]));
  const ms = table(), meetOn = ms.meet;
  let sel = 'me', m = G.meeting(ms);   // 这桌的团公告：开车卡会时是那场会，不开时是车卡时 KP 一起写的
  const fresh = () => { if (m && m.fresh && cur.me && cur.me.at < m.at) cur.me = null; };   // 这局统一用新卡：会前的旧卡不算，你要新车一张
  fresh();
  const meetB = navText(meetOn ? '车卡会' : '团公告', () => meetOn ? meetPage(true) : notice()); meetB.hidden = !m;
  const p = page({ app: 'interlude', id: 'int-card', title: '调查员', large: true, back: true, cls: 'as-int-card', right: meetB });
  const tabs = h('div.as-int-tabs', owners.map(o => h('button', { dataset: { o }, onclick: () => { sel = o; paintTabs(); paint(); } }, ownerFace(o, 40), h('small', shownName(o)))));
  const paintTabs = () => [...tabs.children].forEach(b => { b.classList.toggle('is-on', b.dataset.o === sel); b.classList.toggle('is-none', !cur[b.dataset.o]); });
  const photo = h('div.as-int-card__photo'), head = h('div.as-int-card__head'), sheetEl = h('div.as-int-sheet-paper'), scroller = h('div.as-int-card__scroll', photo, head, sheetEl);
  const saveLater = debounce(() => G.save(), 400);
  const makeB = btn('AI 车卡', 'primary', () => meetOn && !m ? holdMeet() : G.running() || owners.some(o => !cur[o]) ? make(owners.filter(o => !cur[o])) : redo());
  const swapB = btn('换卡', 'secondary', () => swapCard());
  const startB = btn('开局', 'primary', () => meetOn && !G.running() ? meetPage(true, true) : setupOk || G.running() ? begin() : setupSheet(() => begin()));
  p.body.append(tabs, scroller, h('div.as-int-card__bar', swapB, makeB, startB));
  const paintBar = () => { const miss = owners.filter(o => !cur[o]).length; makeB.textContent = meetOn && !m ? '开车卡会' : miss ? `AI 车卡（${miss} 人）` : '重车';
    startB.textContent = meetOn ? '交卡' : '开局'; startB.hidden = meetOn ? !m || !cur.me : !!miss; swapB.hidden = !cur[sel]; meetB.hidden = !m; };
  async function make(list) {
    if (G.running()) { G.cancel(); return; }
    makeB.replaceChildren(h('span.as-spin')); toast(`KP 在给 ${list.length} 个人车卡…`, { label: '取消', fn: G.cancel, wait: true });
    try { (await G.makeCards(list, owners, ms)).forEach(c => { cur[c.owner] = c; }); toast('车好了，可以一张张改'); if (!m && (m = G.meeting(ms))) notice(() => showCards(list[0])); else showCards(list[0]); }   // 第一次车卡时 KP 一起写了团公告：先给你看
    catch (e) { failed(e, '没车成'); }
    paintTabs(); paint(); paintBar();
  }
  // 重车：勾谁车谁（旧卡留着，换卡里能换回来）
  async function redo() {
    const got = await pickMany('谁重车', owners.map(o => ({ key: o, name: ownerName(o), avatar: o === 'me' ? myAvatar() : contact(o).avatar })), { preselect: [sel] });
    if (got && got.length) make(got);
  }
  async function blank(o) { cur[o] = await G.blankCard(o, ms); paintTabs(); paint(); paintBar(); }
  // 预览：照团公告（没有就照一般规矩）大概能不能过，再给个评级；都在手机里算
  const showCards = o => cardView(owners.filter(x => cur[x]).map(x => ({ o: x, c: cur[x] })), o, G.relsFrom(owners.map(x => cur[x]).filter(Boolean)));
  const preview = c => { const bad = G.checkCard(c, m), r = G.rate(c, m);
    sheet({ title: '预览', content: h('div.as-int-notice', h('b', bad.length ? '大概率过不了' : '大概率能过'), ...bad.map(t => h('small', t)),
      h('b', `评级 ${r.grade} · ${r.role}`), h('div.as-int-stars', Object.entries(r.stars).map(([k, n]) => h('span', `${k} ${'★'.repeat(n)}${'☆'.repeat(5 - n)}`))), r.rec ? h('small', r.rec) : null) }); };
  async function swapCard() {
    const mine = G.cardsOf(sel), c = cur[sel];
    const v = await actionSheet(`${ownerName(sel)}的卡`, [...mine.map(x => ({ value: x.id, label: `${x.name} · ${x.job}`, active: x === c })), { value: 'new', label: 'AI 车一张' }, { value: 'blank', label: '自己填一张' }, c && { value: 'del', label: '删除这张', danger: true }].filter(Boolean));
    if (v === 'new') { await make([sel]); return; }
    if (v === 'blank') { await blank(sel); return; }
    if (v === 'del') { if (!(await dialog({ title: '删除这张卡？', confirm: '删除', danger: true }))) return; await G.dropCard(c); cur[sel] = G.lastCard(sel); }
    else if (v) { cur[sel] = mine.find(x => x.id === v); await G.useCard(cur[sel]); }
    else return;
    paintTabs(); paint(); paintBar();
  }
  // 开局：在哪按的就在哪等（车卡会上按的就留在书桌前），写好了放片头再进游戏；等的时候退回去了就直接进游戏
  async function begin(b = startB, host = p.el) {
    if (G.running()) { G.cancel(); return; }
    const old = b.textContent; b.replaceChildren(h('span.as-spin')); toast('KP 在写这一局…', { label: '取消', fn: G.cancel, wait: true });
    try {
      await Promise.all(owners.map(o => G.useCard(cur[o])));
      const g = await G.start({ mood: pick.mood, run: pick.run, kp: pick.kp, voice: pick.voice || voiceDefault(), lang: langs(), scenario: pick.scenario, ask: pick.ask, me: cur.me, party: pick.party.map(o => cur[o]), meet: m, note: pick.note, speak: pick.speak });
      setupOk = false; toast(`《${g.title}》写好了`); back();
      const at = host.isConnected ? host : p.el;
      if (at.isConnected) { await castRoll(at, g); if (at !== p.el) nav.pop(); nav.pop(); }
      playPage(g);
    } catch (e) { failed(e, '没开成'); }
    b.textContent = old; paintBar();
  }
  // 团公告（不开车卡会时）：背景 + 规矩
  // 卡片页点开团公告：就是墙上那张纸取下来，摆在正中间，点哪都收起
  const notice = after => paper().then(() => {   // after：关上以后（车好了先看团公告，再弹成卡）
    const mask = h('div.as-dialog-mask', { onclick: () => { mask.classList.remove('is-open'); setTimeout(() => mask.remove(), 200); after && after(); } }, postEl(m));
    mask.firstChild.classList.add('is-big'); document.querySelector('.as-phone').append(mask); requestAnimationFrame(() => mask.classList.add('is-open'));
  });
  // 车卡会：一次 API 写完整场，其他人的卡也在会上车好
  async function holdMeet() {
    if (G.running()) { G.cancel(); return; }
    makeB.replaceChildren(h('span.as-spin')); toast('大家在开车卡会…', { label: '取消', fn: G.cancel, wait: true });
    try { m = await G.meet(ms); for (const o in m.cards) cur[o] = G.cardById(m.cards[o]); fresh(); toast('车卡会开完了'); meetPage(false); }
    catch (e) { failed(e, '车卡会没开成'); }
    paintTabs(); paint(); paintBar();
  }
  // 车卡会：和玩的时候一样一句一句演，背景是书桌。演完列出规矩，你去改卡或者交卡：没过念打回的话、说哪里不对；过了念过审的话，一张张亮卡、念大家的评语，再开局
  // again：看过了（点「车卡会」、交卡进来）就直接停在最后一句，能往回翻；submit：进来就交卡
  function meetPage(again, submit) {
    const q = page({ app: 'interlude', id: 'int-meet', title: '车卡会', large: true, back: true, cls: 'as-int-play.as-int-meet' });
    q.el.prepend(h('div.as-int-bg', img('desk-day'), img('desk-night', '.is-night'))); q.el.style.backgroundPosition = 'center top';
    const kpc = pick.kp !== 'sys' && contact(pick.kp), vmode = pick.voice || voiceDefault();
    const idOf = n => n === 'KP' ? (kpc ? kpc.id : 'kp') : n === myName() || n === '你' ? 'me' : kpc && n === nameOf(kpc) ? kpc.id : owners.find(o => o !== 'me' && (ownerName(o) === n || contact(o).name === n || (cur[o] || {}).name === n)) || 'kp';
    const faceOf = id => id === 'kp' ? img('kp') : P.figure(id) || ownerFace(id, 110);
    const cardOf = o => ({ ...cur[o], ...(m.adjust || {})[o] });
    const showAll = o => cardView(owners.map(x => ({ o: x, c: cardOf(x) })).filter(x => x.c.name), o, G.relsFrom(owners.map(cardOf)));
    const face = h('div.as-int-who__face'), nameT = h('span.as-int-who__name'), shelf = h('div.as-int-meet__card');
    const actT = h('p.as-int-box__act'), sayT = h('p.as-int-box__say'), zhT = h('small.as-int-box__zh'), more = h('span.as-int-box__more', '▸');
    const voiceB = voiceBtn(() => voice());
    const backB = h('button.as-int-box__back', { 'aria-label': '上一句', onclick: e => { e.stopPropagation(); back(); } }, '◂');
    const box = h('div.as-int-box', { onclick: () => next() }, actT, sayT, zhT, voiceB, backB, more), act = h('div.as-int-act');
    // 团公告钉在墙上（舞台上面空着的那块）：字多就在纸里滑，点一下取下来展开（有多少字展开多少），再点挂回去
    const paperOk = paper(), pin = postEl(m); pin.hidden = true; pin.onclick = () => pin.classList.toggle('is-big');
    shelf.onclick = () => shelf.dataset.o && showAll(shelf.dataset.o);
    q.body.append(pin, h('div.as-int-stage', shelf, h('div.as-int-who', { onclick: () => owners.includes(lastId) && cardOf(lastId).name && showAll(lastId) }, face, nameT), box, act));
    let now = null, vac = null, lastId = '', queue = [], seen = [], passed = false, tries = 0, shown = false;
    const hush = () => { if (vac) { vac.abort(); vac = null; stopSpeak(); voiceB.set(); } };
    async function voice() {
      if (!now || !now.say) return;
      if (vac) { if (voiceB.st === 'load') toast('已取消'); hush(); return; }
      const ac = vac = new AbortController(), pt = face.firstChild.pt; voiceB.set('load');
      try { await speakAs(idOf(now.who), now.say, { stop: ac.signal, acted: true, cache: `int:m:${m.at}:${[...now.say].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 0)}`, onStart: () => { voiceB.set('on'); pt?.talk(true); } }); }
      catch (e) { if (!ac.signal.aborted) { log('warn', '幕间', '念不出来：' + e.message); toast('念不出来：' + e.message); } }
      pt?.talk(false);
      if (vac === ac) { vac = null; voiceB.set(); }
    }
    // 亮卡那几句带着 o：卡片一直摆在上面，换人才换
    const say = l => { hush(); now = l; const id = idOf(l.who);
      if (id !== lastId) { lastId = id; face.replaceChildren(faceOf(id)); }
      nameT.textContent = l.who === 'KP' && kpc ? `${nameOf(kpc)} · KP` : id === 'me' ? '你' : l.who;
      if ((shelf.dataset.o || '') !== (l.o || '')) { shelf.dataset.o = l.o || ''; const c = l.o && cardOf(l.o);
        shelf.replaceChildren(...c ? [h('div.as-int-reveal', ownerFace(l.o, 40), h('div', h('b', `${c.name} · ${c.job}`),
          h('small', [c.tier, R.ATTRS.filter(([k]) => k !== 'LUCK').map(([k, n]) => n + c.attrs[k]).join(' ')].filter(Boolean).join(' · ')), (c.abilities || []).length ? h('small', c.abilities.map(x => x.name).join('、')) : null))] : []); }
      // 台词不是中文的：中文当大字，原文小字放下面（作者读中文；念的还是原文）
      actT.textContent = plain(l.act); sayT.textContent = plain(l.zh || l.say); zhT.textContent = l.zh ? plain(l.say) : '';
      actT.hidden = !l.act; sayT.hidden = !l.say; zhT.hidden = !l.zh; voiceB.hidden = !l.say; backB.hidden = seen.length < 2; more.hidden = !queue.length;
      if (l.say && vmode !== 'tap') voice(); };
    function next() { if (!queue.length) return; seen.push(queue.shift()); say(seen.at(-1)); if (!queue.length) end(); }
    function back() { if (seen.length < 2) return; queue.unshift(seen.pop()); say(seen.at(-1)); act.hidden = true; }
    const play = lines => { queue.push(...lines); act.hidden = true; next(); };
    // 演完：没过审的时候是改卡 / 交卡，过了就是开局
    const bad = h('p.as-int-meet__bad');
    const editB = btn(cur.me ? '改我的卡' : '车我的卡', 'secondary', () => { nav.pop(); if (sel !== 'me') { sel = 'me'; paintTabs(); paint(); paintBar(); } });
    const give = btn('交卡', 'primary', () => {
      const list = G.checkCard(cur.me, m);
      if (list.length) { bad.textContent = '没过：' + list.join('；'); bad.hidden = false; if (tries++ || !m.fail.length) end(); else play(m.fail); return; }
      const t = R.tierOf(m.rules.tiers[myName()]); if (m.mode !== 'random' && t) { cur.me.tier = t; G.save(); }   // 过了：你的档位照会上定的
      pin.hidden = passed = true; play([...m.pass, ...owners.flatMap(o => { const c = cardOf(o), rv = m.reviews[ownerName(o)] || m.reviews[c.name];
        return [{ who: ownerName(o), act: `亮卡：${c.name} · ${c.job}`, o }, ...(Array.isArray(rv) ? rv : []).map(l => ({ ...l, o }))]; })]);
    });
    give.hidden = !cur.me; bad.hidden = true;
    // 演完：团公告钉在墙上；回顾（到现在为止的整场对话）点开是单子，和改卡 / 交卡排一行；过了就是回顾 / 开局
    const log = () => sheet({ title: '回顾', content: h('div.as-int-log', seen.map(l => h('div', h('b', l.who === 'KP' && kpc ? `${nameOf(kpc)} · KP` : idOf(l.who) === 'me' ? '你' : l.who),
      l.act ? h('small', plain(l.act)) : null, l.say ? h('p', plain(l.say)) : null, l.zh ? h('small', plain(l.zh)) : null))) });
    const rules = h('div.as-int-end.is-bare', bad, h('div.as-int-row', btn('回顾', 'secondary', log), editB, give));
    const end = () => { act.hidden = false; paperOk.then(() => { pin.hidden = passed; });
      act.replaceChildren(passed ? h('div.as-int-end.is-bare', h('div.as-int-row', btn('回顾', 'secondary', log), btn('看卡', 'secondary', () => showAll('me')), btn('开局', 'primary', e => begin(e.currentTarget, q.el)))) : rules);
      if (passed && !shown) { shown = true; showAll('me'); } };
    const gls = glass(box, q.el, BASE + (document.querySelector('.as-phone')?.dataset.mode === 'night' ? 'desk-night' : 'desk-day') + '.webp', ['rgba(10,14,24,.2)', 'rgba(10,14,24,.65)']);
    q.el._onLeave = () => { hush(); gls.dispose(); };
    if (again) { seen = m.lines.slice(); say(seen.at(-1)); end(); } else play(m.lines);
    nav.push(q.el);
    if (submit && cur.me) give.click();
  }
  // 一张卡：改哪一格就只改那一格
  function paint() {
    const c = cur[sel];
    photo.replaceChildren(ownerFace(sel, 96));
    if (!c) { head.replaceChildren(); sheetEl.replaceChildren(h('p.as-int-sheet-empty', `${shownName(sel)}还没有卡`), h('div.as-int-row', btn('自己填一张', 'secondary', () => blank(sel)))); return; }
    const set = (k, v) => { c[k] = v; saveLater(); };
    const line = (label, key, opts = {}) => field(label, input({ value: String(c[key] ?? ''), type: opts.type || 'text', onInput: v => set(key, opts.type ? +v : v) }));
    const jobB = h('button.as-int-job', { onclick: async () => {
      const v = await actionSheet('职业', [...R.JOBS.map(([j]) => ({ value: j, label: j, active: c.job === j })), { value: '__own', label: '自己写' }]);
      if (!v) return;
      const j = v === '__own' ? ((await dialog({ title: '职业', input: { value: c.job } })) || '').trim() : v;
      if (!j) return;
      set('job', j); jobB.textContent = j;
      if (!R.JOBS.some(x => x[0] === j)) {   // 自己写的职业：自己挑本职技能（最多 8 个；信用评级总算本职，克苏鲁神话不能当本职）
        const got = await pickMany('本职技能（最多 8 个）', Object.keys(R.baseSkills(c.attrs)).filter(k => k !== CR && k !== '克苏鲁神话').map(k => ({ key: k, name: k, avatar: false })), { preselect: R.jobsOf(c).filter(k => k !== CR) });
        if (got) { if (got.length > 8) toast('最多 8 个，先要前 8 个'); c.jobSkills = got.slice(0, 8); saveLater(); paintSkills(); }
        return;
      }
      c.jobSkills = R.jobsOf({ job: j }); c.skills[CR] = R.crFit(c.skills[CR], j); saveLater(); paintSkills(); paintWealth();   // 换成表里的职业：本职技能、信用评级的范围跟着换
      if (await dialog({ title: '按这个职业重新分技能？', text: '本职技能按职业重新加点，兴趣点要自己再加。', confirm: '重新分' })) { c.skills = R.jobSkills(c.attrs, j); saveLater(); paintSkills(); paintWealth(); }
    } }, c.job || '选职业');
    // 属性：点数字改；重掷、五选一
    const attrBox = h('div.as-int-attrs'), derivedEl = h('div.as-int-derived');
    // 档位和属性点：点档位能换
    const tierB = h('button.as-int-tier', { onclick: async () => { const v = await actionSheet('档位', R.TIERS.map(([t]) => ({ value: t, label: `${t} · ${R.budgetOf(t, c.base)} 点`, active: c.tier === t }))); if (v) { set('tier', v); paintAttrs(); } } });
    const apts = h('div.as-int-pts', tierB, h('span')), hint = h('p.as-int-hint');
    const pendB = btn('', 'secondary', () => spendSheet(c, () => { paintAttrs(); pendB.hidden = !c.pend; pendB.textContent = `还有 ${c.pend} 成长点没分`; }));
    const paintAttrs = () => {
      // 档位：卡上的，没有就照团公告给你的，再没有就是普通人（和交卡时审的一样）；车卡会定了「随机」的不卡总点数
      const tier = c.tier || (m && R.tierOf(m.rules.tiers[ownerName(c.owner)])) || R.TIERS[0][0], free = m && m.mode === 'random';
      tierB.textContent = tier; const sum = R.attrSum(c.attrs), all = R.budgetOf(tier, c.base), up = c.grown || 0;   // 活着打完几局长的点是挣来的，不算超
      apts.lastChild.textContent = free ? `属性点 ${sum}` : `属性点 ${sum} / ${all}${up ? ` + 成长 ${up}` : ''}`; apts.classList.toggle('is-over', !free && sum > all + up);
      pendB.hidden = !c.pend; pendB.textContent = `还有 ${c.pend} 成长点没分`;
      attrBox.replaceChildren(...R.ATTRS.map(([k, n]) => h('button.as-int-attr', { onclick: async () => {
        if (k === 'LUCK') return toast('幸运只能掷，不能改');
        // 总点数不能超过档位，到顶了就加不上去（底下那行会写还剩 0 点）；本来就超了的旧卡按 + − 不会被一下压下去
        stepSheet(n, () => c.attrs[k], v => Math.max(1, Math.min(free ? 90 : Math.min(90, Math.max(c.attrs[k], c.attrs[k] + all + up - R.attrSum(c.attrs))), v)), v => newAttrs({ ...c.attrs, [k]: v }), () => [!free && `还剩 ${all + up - R.attrSum(c.attrs)} 点`, c.attrs[k] >= 90 && '最高 90'].filter(Boolean).join(' · '));
      } }, h('small', n), h('b', c.attrs[k]), h('i', `${Math.floor(c.attrs[k] / 2)} / ${Math.floor(c.attrs[k] / 5)}`))));
      const d = R.derived(c.attrs); derivedEl.textContent = `血 ${d.hp} · 理智 ${d.san} · 魔法 ${d.mp} · 移动 ${d.mov}`;
      const left = all + up - sum, hi = m && c.at >= m.at ? m.rules.attrMax : 90;
      hint.textContent = [!free && (left >= 0 ? `还剩 ${left} 点` : `超了 ${-left} 点`), ...R.ATTRS.filter(([k]) => k !== 'LUCK').map(([k, n]) => c.attrs[k] < R.minOf(k) ? `${n}至少 ${R.minOf(k)}`
        : c.attrs[k] < 30 ? `${n} ${c.attrs[k]} 太低了，${LOW[k]}` : c.attrs[k] > hi ? `${n}超过这局上限 ${hi}` : '')].filter(Boolean).join('；');
      hint.hidden = !hint.textContent;
    };
    const newAttrs = a => { if (c.skills.母语 === c.attrs.EDU) c.skills.母语 = a.EDU; c.attrs = a; c.skills = R.fixSkills(a, c.skills); saveLater(); paintAttrs(); paintSkills(); };   // 掷出来的也照档位算总点数，超了标红；母语没改过就跟着教育变
    const reroll = btn('重掷', 'secondary', async () => { const r = R.d100(); await rollOverlay(p.el, r.t, r.u, '3D6×5'); newAttrs(R.rollAttrs()); });
    const five = btn('天命五选一', 'secondary', () => {
      const sets = R.fiveSets();
      const s = sheet({ title: '挑一套', content: h('div.as-actions', sets.map(a => h('button.as-actions__item', { onclick: () => { s.close(); newAttrs(a); } },
        h('span', R.ATTRS.map(([k, n]) => `${n.slice(0, 1)}${a[k]}`).join(' ') + `　共 ${R.ATTRS.reduce((t, [k]) => t + (k === 'LUCK' ? 0 : a[k]), 0)}`)))) });
    });
    // 技能：加过点的排前面，点数字用 −5 −1 +1 +5 调；本职技能名字标色，点名字能改是不是本职；点数超了标红
    const pts = h('div.as-int-pts'), skillBox = h('div.as-int-skills'), restBox = h('div.as-int-skills.is-rest');
    const restB = h('button.as-int-more', { onclick: () => { restBox.hidden = !restBox.hidden; restB.textContent = restBox.hidden ? '其余技能 ▾' : '收起 ▴'; } }, '其余技能 ▾');
    restBox.hidden = true;
    function paintSkills() {
      const base = R.baseSkills(c.attrs), up = c.skillUp || 0;
      // 两份点还剩多少（兴趣点含打完几局长的）；点不够了就加不上去
      const left = (sk = c.skills) => { const u = R.usage(c.attrs, sk, R.jobsOf(c)); return [u.jobAll - u.job, u.hobbyAll + up - u.hobby]; };
      const count = () => { const [j, o] = left(); pts.textContent = `本职${j < 0 ? `超了 ${-j}` : `还剩 ${j}`} 点 · 兴趣${o < 0 ? `超了 ${-o}` : `还剩 ${o}`} 点`; pts.classList.toggle('is-over', j < 0 || o < 0); };
      // 每项最高：这局新车的卡照团公告（本职 skillMax、其他 hobbyMax），没有团公告照常见的本职 80、兴趣 60；母语和跑过局长过的卡到 90；信用评级照职业
      const r = c.skillUp ? null : m && c.at >= m.at ? m.rules : { skillMax: 80, hobbyMax: 60 }, lo = k => k === '母语' ? 10 : base[k], hiOf = k => k === CR ? R.crOf(c.job)[1] : !r || k === '母语' ? R.MAX_SKILL : R.jobsOf(c).includes(k) ? r.skillMax : r.hobbyMax;
      count();
      // 点数字：和属性一样弹 −5 −1 +1 +5，不用打字
      const row = k => { const v = h('button', { onclick: () => stepSheet(k, () => c.skills[k], fit, bump,
          () => [pts.textContent, k === CR ? `${c.job || '这个职业'}的信用评级在 ${R.crOf(c.job).join('～')}` : c.skills[k] >= hiOf(k) ? `最高 ${hiOf(k)}` : c.skills[k] <= lo(k) && `最低 ${lo(k)}`].filter(Boolean).join(' · ')) }, c.skills[k]);
        const fit = n => { n = k === CR ? R.crFit(n, c.job) : Math.max(lo(k), Math.min(Math.max(hiOf(k), c.skills[k]), n));   // 本来就比上限高的（旧卡）按 + 不会被压下去
          const i = R.jobsOf(c).includes(k) ? 0 : 1, o = Math.min(0, left()[i]); while (n > c.skills[k] && left({ ...c.skills, [k]: n })[i] < o) n--; return n; };   // 点不够：退到刚好够的地方（本职技能看本职点，其他看兴趣点）
        const bump = n => { c.skills[k] = n; v.textContent = n; count(); saveLater(); if (k === CR) paintWealth(); };
        const el = h('div.as-int-skill' + (R.jobsOf(c).includes(k) ? '.is-job' : ''), h('span', { role: 'button', tabindex: 0, onclick: () => {
          const L = R.jobsOf(c); c.jobSkills = L.includes(k) ? L.filter(x => x !== k) : [...L, k]; el.classList.toggle('is-job'); count(); saveLater(); } }, k), h('small', String(base[k])), v); return el; };
      const keys = Object.keys(base).sort((a, b) => (c.skills[b] - base[b]) - (c.skills[a] - base[a]) || c.skills[b] - c.skills[a]);
      skillBox.replaceChildren(...keys.filter(k => c.skills[k] > base[k]).map(row)); restBox.replaceChildren(...keys.filter(k => c.skills[k] <= base[k]).map(row));
    }
    // 消费水平、现金、资产：照信用评级算（规则书那张表），钱换成团公告定的当地的钱；不用填
    const wealthEl = h('p.as-int-derived'), money = (m && m.rules.money) || { unit: '美元', rate: 1 };
    const paintWealth = () => { const [lv, cash, own] = R.wealth(c.skills[CR] || 0); wealthEl.textContent = `${lv} · 现金 ${R.moneyText(cash, money)} · 资产 ${own ? R.moneyText(own, money) + (own >= 1e8 ? '以上' : '') : '没有'}`; };
    paintWealth();
    const bg = (label, k) => field(label, textarea({ value: c.bg[k] || '', rows: 2, placeholder: '暂无', onInput: v => { c.bg[k] = v; saveLater(); } }));
    // 关系：一行一个认识的同桌，人从同桌里点选，后面写这张卡眼里的 TA
    const relBox = h('div.as-int-abs'), rels = c.rels || (c.rels = []);
    const pickRel = async x => { const v = await actionSheet('认识谁', owners.filter(o => o !== c.owner && (o === x.o || !rels.some(y => y.o === o))).map(o => ({ value: o, label: shownName(o), active: o === x.o }))); if (v) { x.o = v; if (rels.includes(x)) { saveLater(); paintRel(); } } return v; };
    const addB = btn('加一个认识的人', 'secondary', async () => { const x = { o: '', text: '' }; if (!(await pickRel(x))) return; rels.push(x); saveLater(); paintRel(); relBox.lastChild.children[1].focus(); });
    const paintRel = () => { addB.hidden = !owners.some(o => o !== c.owner && !rels.some(y => y.o === o)); relBox.replaceChildren(...rels.length ? rels.map(x => h('div.as-int-wpn.is-rel', h('button', { onclick: () => pickRel(x) }, shownName(x.o)),
      input({ value: x.text, placeholder: '关系', onInput: v => { x.text = v.trim(); saveLater(); } }),
      h('button', { 'aria-label': '删除', onclick: () => { rels.splice(rels.indexOf(x), 1); saveLater(); paintRel(); } }, icon('close', 14, 2)))) : [h('p.as-int-sheet-empty', '和大家都是陌生人')]); };
    paintRel();
    // 特殊能力：一条一条列出来，能删
    const abBox = h('div.as-int-abs');
    const paintAbs = () => abBox.replaceChildren(...(c.abilities || []).length ? c.abilities.map((x, i) => h('div.as-int-ab', h('b', x.name),
      h('small', [R.POWERS[x.kind], x.dmg, x.cost && `耗 ${x.cost} 魔法`].filter(Boolean).join(' · ')), x.desc ? h('p', x.desc) : null,
      h('button', { 'aria-label': '删除', onclick: () => { c.abilities.splice(i, 1); saveLater(); paintAbs(); } }, icon('close', 14, 2)))) : [h('p.as-int-sheet-empty', '暂无')]);
    paintAbs();
    // 武器：名字随便写，伤害照档位挑、技能点选（不准带枪的局里没有枪）；其他随身物品一行一样
    const ws = (c.items || []).filter(x => x.dmg), os = (c.items || []).filter(x => !x.dmg), wBox = h('div.as-int-abs'), oBox = h('div.as-int-abs');
    const saveItems = () => set('items', [...ws, ...os].filter(x => x.name));
    const nText = n => n ? `×${n}` : '∞';
    const pickW = async (b, w, title, list, k, text) => { const v = await actionSheet(title, list.map(([value, label]) => ({ value, label, active: value === w[k] }))); if (v) { w[k] = v; b.textContent = text(v); saveItems(); } };
    const paintW = () => wBox.replaceChildren(...ws.length ? ws.map(w => h('div.as-int-wpn', input({ value: w.name, placeholder: '名字', onInput: v => { w.name = v.trim(); saveItems(); } }),
      h('button', { onclick: e => pickW(e.currentTarget, w, '伤害', R.DMG.map(([d, n, eg]) => [d, `${n} · ${R.dmgRange(d)} 点（${eg}）`]), 'dmg', R.dmgRange) }, R.dmgRange(w.dmg)),
      h('button', { onclick: e => pickW(e.currentTarget, w, '用哪个技能', ['斗殴', '手枪', '步枪', '投掷'].filter(k => !m || m.rules.guns || !/枪/.test(k)).map(k => [k, k]), 'skill', v => v) }, w.skill),
      h('button', { 'aria-label': '删除', onclick: () => { ws.splice(ws.indexOf(w), 1); saveItems(); paintW(); } }, icon('close', 14, 2)))) : [h('p.as-int-sheet-empty', '暂无')]);
    // 其他随身物品：次数点选，1～10 次或 ∞ 一直能用
    const paintO = () => oBox.replaceChildren(...os.length ? os.map(o => h('div.as-int-wpn.is-thing', input({ value: o.name, placeholder: '名字', onInput: v => { o.name = v.trim(); saveItems(); } }),
      h('button', { onclick: async e => { const b = e.currentTarget, v = await actionSheet('能用几次', [...Array.from({ length: 10 }, (_, i) => String(i + 1)), '∞'].map(k => ({ value: k, label: k === '∞' ? '∞ 一直能用' : k + ' 次', active: k === String(o.n || '∞') })));
        if (v) { if (v === '∞') delete o.n; else o.n = +v; b.textContent = nText(o.n); saveItems(); } } }, nText(o.n)),
      h('button', { 'aria-label': '删除', onclick: () => { os.splice(os.indexOf(o), 1); saveItems(); paintO(); } }, icon('close', 14, 2)))) : [h('p.as-int-sheet-empty', '暂无')]);
    paintW(); paintO();
    head.replaceChildren(input({ value: c.name, placeholder: '名字', onInput: v => set('name', v) }), jobB);
    sheetEl.replaceChildren(
      h('div.as-int-grid2', line('年龄', 'age', { type: 'number' }), field('性别', segmented(SEXES, G.sexOf(c.sex), v => set('sex', v))), line('住地', 'home')),
      h('h3', '属性'), apts, attrBox, hint, derivedEl, h('div.as-int-row', reroll, five), pendB,
      h('h3', withInfo('技能', '名字标色的是本职技能，点名字能切换。本职点只加在本职技能上，兴趣点只加在其他技能上。')), pts, skillBox, restB, restBox, h('div.as-int-row', btn('预览', 'secondary', () => preview(c)), btn('成卡', 'secondary', () => showCards(sel))),
      h('h3', '背景'), ...G.BG.map(([k, n]) => bg(n, k)),
      h('h3', withInfo('关系', '写了谁就是一开局就认识 TA，一边写了就算互相认识；没写的人开局时是陌生人，要在戏里认识。')), relBox,
      h('div.as-int-row', addB),
      h('h3', '特殊能力'), abBox,
      h('h3', withInfo('资产', '跟着「信用评级」这项技能算：0 身无分文，1～9 穷，10～49 普通，50～89 有钱，90～98 很有钱，99 超级富豪。钱照故事发生的地方换成当地的钱，是个大概。')), wealthEl,
      field('都有些什么', textarea({ value: c.assets || '', rows: 2, placeholder: '暂无', onInput: v => set('assets', v) })),
      h('h3', '随身'),
      field(withInfo('武器', '名字随便写，伤害照档位挑，最重到步枪那档。'), wBox), h('div.as-int-row', btn('加一件武器', 'secondary', () => { ws.push({ name: '', dmg: '1D6', skill: '斗殴' }); paintW(); wBox.lastChild.firstChild.focus(); })),
      field(withInfo('其他随身物品', '用得完的（绷带、药）选次数，用一次少一次；一直能用的（手机、手电）选 ∞。'), oBox), h('div.as-int-row', btn('加一样东西', 'secondary', () => { os.push({ name: '', n: 1 }); paintO(); oBox.lastChild.firstChild.focus(); })));
    paintAttrs(); paintSkills();
    sheetEl.scrollTop = 0;
  }
  paintTabs(); paint(); paintBar();
  nav.push(p.el);
  if (meetOn) { if (!m) holdMeet(); else if (resume) meetPage(true); }   // 开着车卡会：进来就开会（其他人的卡在会上车）；「继续车卡」进来直接回到会上
  else if (owners.some(o => !cur[o])) make(owners.filter(o => !cur[o]));   // 进来就把没卡的一起车了
}

// 分成长点（活着打完一局给的）：点 + 就掷 1D100，大于现在的值才加 1，没过这点也用掉了（越高越难长，作者定的）；掷了就算，没有退回
/** 调一个数（属性、技能）：−5 −1 +1 +5，点了马上改，不用打字；note 是底下那行（还剩几点） */
function stepSheet(title, get, fit, set, note) {   // fit：按下去会变成多少；变不了的按钮变灰
  const v = h('b'), tip = h('p.as-int-spend__left'), bs = [-5, -1, 1, 5].map(d => Object.assign(h('button', { onclick: () => { set(fit(get() + d)); paint(); } }, (d < 0 ? '−' : '+') + Math.abs(d)), { d }));
  const paint = () => { v.textContent = get(); tip.textContent = note(); for (const b of bs) b.disabled = fit(get() + b.d) === get(); };
  paint();
  const s = sheet({ title, content: h('div.as-int-step', v, tip, h('div.as-int-step__row', ...bs),
    h('div.as-prompt-bar', btn('完成', 'primary', () => s.close()))) });
}
function spendSheet(c, done) {
  const left = h('p.as-int-spend__left', `还剩 ${c.pend} 点`), said = h('p.as-int-spend__left');
  const rows = R.ATTRS.filter(([k]) => k !== 'LUCK').map(([k, n]) => {
    const v = h('b', c.attrs[k]);
    return h('div.as-int-spend__row', h('span', n), v, h('button', { 'aria-label': '加', onclick: async () => {
      const r = await G.raise(c, k); if (!r) return;
      v.textContent = c.attrs[k]; left.textContent = `还剩 ${c.pend} 点`; said.textContent = `${n}：掷出 ${r.r}，${r.ok ? '长了 1 点' : `没大过 ${r.was}，没长`}`;
    } }, '+'));
  });
  const s = sheet({ title: '分成长点', onClose: done, content: h('div.as-int-spend', left, said, ...rows, h('div.as-prompt-bar', btn('完成', 'primary', () => s.close()))) });
}

/** 抛骰子的大画面：盖在页面上，抛完亮出结果 */
// 成没成：盖一个章。大成功金色、成功青色、失败灰、大失败暗红
const VERDICT = v => /大成功/.test(v) ? 'is-crit' : /大失败/.test(v) ? 'is-fumble' : /成功|赢/.test(v) ? 'is-ok' : 'is-fail';
function rollOverlay(host, t, u, caption, result, verdict) {
  return new Promise(res => {
    const big = h('b.as-int-roll__num'), stamp = h('span.as-int-roll__stamp'), cap = h('p.as-int-roll__cap', caption || ''), stage = h('div.as-int-roll__host');
    const el = h('div.as-int-roll', { 'data-no-swipe': '' }, stage, h('div.as-int-roll__foot', big, stamp, cap));
    host.append(el);
    const done = () => { el.classList.add('is-out'); setTimeout(() => { el.remove(); res(); }, 260); };
    throwDice(stage, t, u).then(() => {
      big.textContent = t === 0 && u === 0 ? '100' : String(t * 10 + u).padStart(2, '0');
      if (result) cap.textContent = result;
      if (verdict) { stamp.textContent = verdict; stamp.className = 'as-int-roll__stamp ' + VERDICT(verdict); }
      el.classList.add('is-done'); el.onclick = done; setTimeout(done, result ? 2400 : 1100);
    });
  });
}

/* ---------- 卷宗：打完的每一局一份，点开从头看一遍（只看，不念） ---------- */
function archivePage(sync, resume) {
  const p = page({ app: 'interlude', id: 'int-archive', title: '卷宗', large: true, back: true, cls: 'as-int-archive' });
  const ymd = t => { const d = new Date(t); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
  const names = ids => ['你', ...ids.map(id => nameOf(contact(id)))].filter(Boolean).join('、');
  // 进行中的放最上面：还没打完的局（点了接着玩）；还没开局的车卡会 / 团公告（点了把开局设置接上，回到车卡，开着车卡会就回到会上）
  // 点了从卷宗进去，返回时回到卷宗
  const going = (title, sub, fn) => h('button.as-int-file', { onclick: fn }, h('b', title), h('small', sub), h('span.is-going', '进行中'));
  // 长按：删掉（没打完的局、还没开局的车卡会也能删），从按的地方烧掉
  const del = (el, title, drop) => { onLongPress(el, async e => { if (await dialog({ title: `删除${title}？`, text: '删了就找不回来了。', confirm: '删除', danger: true })) { await drop(); await burn(el, e.clientX, e.clientY); paint(); sync(); } }); return el; };
  const sig = () => JSON.stringify([G.all().map(g => [g.id, !!g.done, G.wrapping(g)]), !!G.meetNow()]);
  let was = '';
  function paint() {
    was = sig();
    const mt = G.savedPick() ? G.meetNow() : null;
    const ing = [...G.all().filter(g => !g.done || G.wrapping(g)).sort((a, b) => (b.seen || b.at) - (a.seen || a.at)).map(g => del(going(`《${g.title}》`, `${ymd(g.at)} · ${names(g.party.map(m => m.id))}`, () => playPage(g)), `《${g.title}》`, () => G.dropGame(g))),
      mt && del(going(mt.lines ? '车卡会' : '车卡', `${ymd(mt.at)} · ${names(G.savedPick().party)}`, () => { resume(); cardPage(sync, true); }), mt.lines ? '这次车卡会' : '这次车卡', G.dropMeet)].filter(Boolean);
    const list = G.all().filter(g => g.done && !G.wrapping(g)).slice().reverse();
    p.body.replaceChildren(ing.length || list.length ? h('div.as-int-files', ...ing, ...list.map(g => del(h('button.as-int-file', { onclick: () => readPage(g) },
      h('b', `《${g.title}》`), h('small', `${ymd(g.at)} · ${['你', ...g.party.map(m => nameOf(contact(m.id)) || m.name)].join('、')}`), h('span.is-' + g.done.kind, G.ENDS[g.done.kind] || '')), `《${g.title}》`, () => G.dropGame(g)))) : empty('还没有打完的局'));
  }
  paint(); p.el._onShow = () => { if (sig() !== was) paint(); };   // 回来时局有变（打完了、删了）才重排
  nav.push(p.el);
}
function readPage(g) {
  const p = page({ app: 'interlude', id: 'int-read', title: g.title, large: true, back: true, cls: 'as-int-archive', right: navText('片头', () => castRoll(p.el, g)) });
  p.body.append(h('div.as-int-read', g.log.map(l => h('div.as-int-read__l' + (l.me ? '.is-me' : '') + (l.ooc ? '.is-ooc' : ''),
    h('b', l.me || l.who === '你' || l.who === myName() || l.who === g.pc.name ? '你' : l.who), l.text || l.act ? h('p.is-act', plain(l.text || l.act)) : null, l.say ? h('p', plain(l.say)) : null, l.zh ? h('small', plain(l.zh)) : null)),
    g.done && g.done.text ? h('div.as-int-read__end', g.done.text) : null, g.review && g.review.done && g.review.box ? h('div.as-int-read__end', h('b', '【黑匣子】'), h('p', g.review.box)) : null));
  nav.push(p.el);
}

/* ---------- 调查员名录（桌上的火漆信）：按人列出所有的卡，盖着状态章；点开一张看 TA 打过的局，每局读那封后日谈的信 ---------- */
const stamp = c => { const f = G.fateOf(c); return h('span.as-int-fate.is-' + f, G.FATES[f][0]); };
function rosterPage() {
  const p = page({ app: 'interlude', id: 'int-roster', title: '调查员名录', large: true, back: true, cls: 'as-int-archive' });
  const owners = [...new Set(G.allCards().map(c => c.owner))].filter(o => o === 'me' || contact(o));
  p.body.append(...owners.length ? owners.map(o => h('div.as-int-roster', h('div.as-int-roster__who', ownerFace(o, 32), h('b', shownName(o))),
    ...G.allCards().filter(c => c.owner === o).map(c => h('button.as-int-file', { onclick: () => lifePage(c) }, h('b', c.name), h('small', [c.job, `打过 ${G.gamesOf(c).length} 局`].filter(Boolean).join(' · ')), stamp(c)))))
    : [empty('还没有车过卡')]);
  nav.push(p.el);
}
function lifePage(c) {
  const p = page({ app: 'interlude', id: 'int-life', title: c.name, large: true, back: true, cls: 'as-int-archive', right: navText('看卡', () => cardView([{ o: c.owner, c }], c.owner)) });
  const f = G.fateOf(c);
  // 一局：复盘会上放过的个人结局 + 后日谈的信
  const after = (g, n) => { const e = g.review && (g.review.seen || []).includes(n) && g.review.ends[n], t = (g.done.letters || {})[n];
    const s = sheet({ title: `《${g.title}》之后`, cls: 'as-int-cv', content: h('div.as-int-letter', e ? [h('b', `【${n} end：${e.title}】`), h('p', e.text)] : null,
      t ? [img('seal'), h('p', t)] : null, h('div.as-int-row', btn('看卷宗', 'secondary', () => { s.close(); readPage(g); }))) }); };
  p.body.append(h('div.as-int-life', stamp(c), h('p', G.FATES[f][1])), h('div.as-int-files',
    ...G.gamesOf(c).map(g => { const n = [g.pc, ...g.party].find(x => x.card === c.id).name, has = (g.done.letters || {})[n] || (g.review && (g.review.seen || []).includes(n));
      return h('button.as-int-file', { onclick: () => has ? after(g, n) : readPage(g) }, h('b', `《${g.title}》`), h('small', `${new Date(g.at).toLocaleDateString('zh-CN')} · ${G.ENDS[g.done.kind]}`), has ? h('span.is-going', '结局') : null); })),
    G.gamesOf(c).length ? null : empty('还没打过局'));
  nav.push(p.el);
}

/* ---------- 演员表：开局前的片头 ---------- */
function castRoll(host, g) {
  return new Promise(res => {
    const cards = [['主演', myName()], ...(g.party.length ? [['特别出演', g.party.map(m => m.name).join('　')]] : []), ['友情出演', 'KP'], ['', g.title]];
    const el = h('div.as-int-cast', { onclick: () => done() }), timers = [];
    host.append(el);
    cards.forEach(([k, v], i) => timers.push(setTimeout(() => { el.replaceChildren(h('div.as-int-cast__card' + (k ? '' : '.is-title'), k && h('small', k), serif(v))); }, i * 1500)));
    timers.push(setTimeout(done, cards.length * 1500 + 600));
    let dead = false;
    function done() { if (dead) return; dead = true; timers.forEach(clearTimeout); el.classList.add('is-out'); setTimeout(() => { el.remove(); res(); }, 400); }
  });
}

/* ---------- 玩：老照片场景 + 人物牌 + 对话框，一回合一次 API ---------- */
const sceneSrc = k => k === 'desk' ? BASE + (document.querySelector('.as-phone')?.dataset.mode === 'night' ? 'desk-night' : 'desk-day') + '.webp' : BASE + 'scene-' + R.placeOf(k) + '.webp';   // desk：复盘会回到书桌
function playPage(g) {
  g.seen = Date.now(); G.save();   // 继续的是最近玩过的那局
  // 背景音乐、白噪音：KP 按场景给关键词，去音乐 App 的音源里搜来循环放；两个开关各管各的，角色说话时调小
  const S = state.apps.interlude, beds = { bgm: new Audio() }, VOL = { bgm: .45, amb: .35 };
  // 白噪音：KP 写的那种，没写就照场景；和电台用同一套声音
  let amb = null, left = false;
  const ambOf = () => g.amb === 'none' ? '' : (R.AMBS.find(([k, n]) => g.amb === k || (g.amb || '').includes(n)) || [])[0] || R.AMB_AT[R.placeOf(g.place)] || '';
  function ambient() {
    const k = S.ambOff || left ? '' : ambOf(); if ((amb && amb.k) === k) return;
    if (amb) { amb.stop.forEach(x => x.stop()); amb.g.disconnect(); }
    if (!k) { amb = null; return; }
    ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
    amb = { k, ...noiseNode(ac, k, ac.destination, VOL.amb) };
  }
  const ambBtn = () => { const b = navBtn('rain', '白噪音', () => { S.ambOff = !S.ambOff; commit('apps'); b.classList.toggle('is-off', S.ambOff); ambient(); if (!S.ambOff && !amb) toast('这里没有白噪音'); }); b.classList.toggle('is-off', !!S.ambOff); return b; };
  // 开着却没在放（手机不让自己出声，只认手指点的那一下）：点一下就放，不是关掉
  const bedBtn = (k, ic, label) => { const b = navBtn(ic, label, () => { if (!S[k + 'Off'] && beds[k].src && beds[k].paused) { beds[k].play().catch(e => toast(`${label}放不出来：${e.message}`)); return; } S[k + 'Off'] = !S[k + 'Off']; commit('apps'); b.classList.toggle('is-off', !!S[k + 'Off']); if (S[k + 'Off']) beds[k].pause(); else if (beds[k].src) beds[k].play().catch(e => toast(`${label}放不出来：${e.message}`)); else bed(k, true); }); b.classList.toggle('is-off', !!S[k + 'Off']); return b; };
  const p = page({ app: 'interlude', id: 'int-play', title: g.title, large: true, back: true, cls: 'as-int-play', right: [bedBtn('bgm', 'music', '背景音乐'), ambBtn()] });
  Object.assign(p.nav.querySelector('.as-navbar__title'), { role: 'button', onclick: () => castRoll(p.el, g) });   // 点标题重看片头
  // 这个地址能不能放：等它能开始放（或者出错、10 秒没动静）
  const can = (a, url) => new Promise(ok => { const done = v => { clearTimeout(t); a.oncanplay = a.onerror = null; ok(v); }, t = setTimeout(() => done(false), 10000); a.oncanplay = () => done(true); a.onerror = () => done(false); a.src = url; a.load(); });
  // KP 还没给关键词：先按场景搜（「雨夜街道 氛围 纯音乐」）。loud：点了开关才来找的，找的过程和结果都提示
  async function bed(k, loud) {
    const a = beds[k], what = '背景音乐', w = g[k] || `${R.PLACES[R.placeOf(g.place)].split('（')[0]} 氛围 纯音乐`;
    if (w === a._w) { if (loud) toast(`还在找${what}…`); return; }
    a._w = w; a.pause(); if (loud) toast(`正在找${what}…`, true);
    let r = null;
    try { for await (const x of M.urlsFor(w)) { if (a._w !== w) return; if (await can(a, x.url)) { r = x; break; } } } catch (e) { log('warn', '幕间', `${what}「${w}」没搜成：${e.message}`); }
    if (a._w !== w) return;
    if (!r) { a._w = ''; a.removeAttribute('src'); log('warn', '幕间', `${what}「${w}」没找到能放的`); if (loud) toast(`没找到${what}`); return; }
    Object.assign(a, { loop: true, volume: VOL[k] });
    if (!S[k + 'Off'] && p.el.isConnected) a.play().then(() => { if (loud) toast(`在放：${r.name}`); }, e => { log('warn', '幕间', `${what}《${r.name}》放不出来：${e.message}`); if (loud) toast(`${what}放不出来`); });
  }
  const bedAll = () => { bed('bgm'); ambient(); };
  const duck = e => { const d = e.detail === 'start' ? .3 : 1; beds.bgm.volume = VOL.bgm * d; if (amb) amb.g.gain.value = VOL.amb * d; };
  const host = window.parent || window; host.addEventListener('asterphone-voice', duck);
  if (M.playing()) M.toggle();   // 音乐 App 正在放歌：进来先停
  const bg = h('div.as-int-bg', h('img', { src: sceneSrc(g.place), alt: '' })); p.el.prepend(bg);
  p.el.style.backgroundPosition = 'center top';   // 给液态玻璃量背景用（和场景照片的铺法一样）
  const SHADE = ['rgba(10,14,24,.2)', 'rgba(10,14,24,.65)'];
  let shown = g.place, gls = null;
  const scene = k => { if (k === shown) return; shown = k; const n = new Image(); n.src = sceneSrc(k); n.decode().catch(() => {}).then(() => { n.classList.add('is-in'); bg.append(n); setTimeout(() => { bg.firstChild !== n && bg.firstChild.remove(); }, 900);
    gls.dispose(); box.querySelector('.as-glass-cv')?.remove(); gls = glass(box, p.el, n.src, SHADE); }); };
  // 顶上的状态：第几幕、第几回合、血、理智
  const hud = h('div.as-int-hud'), hudAct = h('span'), hudHp = h('span'), hudSan = h('span'), hudMp = h('span'), hudMad = h('span.is-mad');
  const push = btn('推进', 'secondary', () => send('（推进剧情）'));
  // 看卡：局里的卡（现在的血、理智、东西）和关系图
  const cards = o => cardView([g.pc, ...g.party].map(x => ({ o: x.id, c: { ...G.cardById(x.card), ...x } })), o, g.rel, g.npcs, g.round);
  // 第一次到一个地方：顶上这一行换成地名，几秒后换回来（放在这一行，不挡立绘，作者定的）
  const where = h('div.as-int-where');
  hud.append(hudAct, hudHp, hudSan, hudMp, hudMad, where, btn('卡', 'secondary', () => cards('me')), push);
  const paintHud = () => { hudAct.textContent = `第 ${g.act + 1}/${g.sk.acts.length} 幕 · 第 ${g.round} 回合`; hudHp.textContent = `♥ ${g.pc.hp}/${g.pc.hpMax}`; hudSan.textContent = `◈ ${g.pc.san}/${g.pc.sanMax}`; hudMp.hidden = !(g.pc.abilities || []).length; hudMp.textContent = `✦ ${g.pc.mp}/${g.pc.mpMax}`; hudMad.textContent = g.pc.mad ? g.pc.mad.name : ''; push.hidden = !!g.done || g.run === 'script'; };
  // 人物牌 + 对话框：上面一小行淡淡的旁白（中文），中间是台词，台词不是中文的下面跟一行中文翻译
  const face = h('div.as-int-who__face'), nameT = h('span.as-int-who__name'), who = h('div.as-int-who', { onclick: () => { const m = mine(lastWho) ? g.pc : G.who(g, lastWho); if (m) cards(m.id); } }, face);
  const actT = h('p.as-int-box__act'), sayT = h('p.as-int-box__say'), zhT = h('small.as-int-box__zh'), more = h('span.as-int-box__more', '▸');
  // 喇叭：只念台词（旁白不念）
  const voiceB = voiceBtn(() => voice(cur));
  const backB = h('button.as-int-box__back', { 'aria-label': '上一句', hidden: true, onclick: e => { e.stopPropagation(); back(); } }, '◂');
  const box = h('div.as-int-box', { onclick: () => next() }, nameT, actT, sayT, zhT, voiceB, backB, more);
  // 场外的话：不进对话框，在上面飘一条灰色小气泡
  const ooc = h('div.as-int-ooc');
  let cur = null, vac = null;
  const mode = g.voice || voiceDefault(), kpc = g.kp && g.kp !== 'sys' && contact(g.kp);
  const hush = () => { if (vac) { vac.abort(); vac = null; stopSpeak(); voiceB.set(); } };
  const mine = n => n === '你' || n === myName() || n === g.pc.name;
  const vid = n => n === 'KP' ? (kpc ? g.kp : 'kp') : mine(n) ? 'me' : (G.who(g, n) || {}).id || 'kp';
  // 钥匙带上台词本身：台词拆过、改过，就不会念出以前存的那段（以前连旁白一起合成的）
  const key = l => `int:a:${g.id}:${g.log.indexOf(l)}:${[...l.say].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 0)}`;
  async function voice(l) {
    if (!l || !l.say) return;
    if (vac) { if (voiceB.st === 'load') toast('已取消'); hush(); return; }
    const ac = vac = new AbortController(), pt = face.firstChild.pt; voiceB.set('load');
    try { await made.get(l); await speakAs(vid(l.who), l.say, { stop: ac.signal, acted: true, cache: key(l), onStart: () => { voiceB.set('on'); pt?.talk(true); } }); }
    catch (e) { if (!ac.signal.aborted) { log('warn', '幕间', '念不出来：' + e.message); toast('念不出来：' + e.message); } }
    pt?.talk(false);
    if (vac === ac) { vac = null; voiceB.set(); }
  }
  // 提前合成：一句一句排着来，合成好的存着，念的时候直接放
  // 先拆出台词（旧存档里旁白和台词还连着）；念的时候这句正在提前合成就等它，别合成两遍
  const made = new Map(), pre = new AbortController(); let chain = Promise.resolve();
  const ahead = l => { if (!l || l.ooc || made.has(l)) return; G.splitSay(l); if (!l.say) return;
    made.set(l, chain = chain.then(() => pre.signal.aborted ? null : speakAs(vid(l.who), l.say, { silent: true, acted: true, cache: key(l), stop: pre.signal })).catch(e => log('warn', '幕间', '提前合成没成：' + e.message))); };
  const act = h('div.as-int-act'), shelf = h('div.as-int-meet__card'), stage = h('div.as-int-stage', ooc, shelf, who, box, act);
  p.body.append(hud, stage);
  let queue = [], seen = [], pending = '';   // 还没念到的台词；掷完骰子等着一起发给 KP 的结果
  // 照相馆做过立绘的人（包括你）站着出来（会眨眼、说话时动嘴），没做的用头像
  const ofC = c => P.figure(c.id) || avatar(c.avatar, nameOf(c), 110, 'square');
  const faceOf = n => { if (n === 'KP') return kpc ? ofC(kpc) : img('kp'); if (mine(n)) return P.figure('me') || avatar(myAvatar(), myName(), 110, 'square'); const m = G.who(g, n), c = m && contact(m.id); return c ? ofC(c) : h('span.as-int-who__none', n.slice(0, 1)); };
  let lastWho = '';
  P.preload(['me', kpc && kpc.id, ...g.party.map(m => m.id)].filter(Boolean)).then(() => { if (lastWho && face.firstChild && !face.firstChild.pt) face.replaceChildren(faceOf(lastWho)); });
  const nameOfLine = n => n === 'KP' && kpc ? `${nameOf(kpc)} · KP` : mine(n) ? '你' : n;
  const plate = n => { const m = !mine(n) && n !== 'KP' && G.who(g, n); return m && m.name === n ? [n, h('small', `（${G.realName(m.id)}）`)] : [nameOfLine(n)]; };
  const bubble = l => { const el = h('div.as-int-ooc__b', h('i', '场外'), h('b', nameOfLine(l.who) + '：'), `（${l.act ? plain(l.act) + ' ' : ''}${plain(l.say || l.text || '')}${l.zh ? ` / ${plain(l.zh)}` : ''}）`);
    ooc.append(el); while (ooc.children.length > 3) ooc.firstChild.remove(); setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 400); }, 7000); };
  const say = l => { hush(); G.splitSay(l); cur = g.log.includes(l) || (g.review && g.review.lines.includes(l)) ? l : null;
    if (lastWho !== l.who) { lastWho = l.who; nameT.replaceChildren(...plate(l.who)); face.replaceChildren(faceOf(l.who)); }
    face.firstChild.pt?.face(l.face); face.firstChild.pt?.pose(l.pose);
    if (l.where) { const a = g.sk.acts[g.act]; where.replaceChildren(h('b', l.where.filter(Boolean).join(' · ')), h('small', `《${g.title}》 · 第 ${g.act + 1} 幕 ${a.title}`)); hud.classList.add('is-where'); clearTimeout(where._t); where._t = setTimeout(() => hud.classList.remove('is-where'), 5000); }
    // 复盘会里放个人结局、黑匣子：上面摆一张标题卡（带名录的状态章），对话框里是那段小剧场
    const e = l.end && g.review.ends[l.end], k = l.end || (l.box ? '黑匣子' : '');
    if (shelf.dataset.k !== k) { shelf.dataset.k = k; const c = e && G.cardById(([g.pc, ...g.party].find(x => x.name === l.end) || {}).card);
      shelf.replaceChildren(...k ? [h('div.as-int-reveal.is-end', h('b', e ? `【${l.end} end：${e.title}】` : '【黑匣子】'), c ? stamp(c) : null)] : []); }
    if (e && !(g.review.seen ||= []).includes(l.end)) { g.review.seen.push(l.end); G.save(); }   // 放过的结局收到卡上，名录里能看
    actT.textContent = plain(e ? e.text : l.text || l.act); sayT.textContent = plain(l.zh || l.say); zhT.textContent = l.zh ? plain(l.say) : '';
    actT.hidden = !actT.textContent; sayT.hidden = !l.say; zhT.hidden = !l.zh; voiceB.hidden = !(cur && l.say);
    if (mode === 'next') queue.filter(x => !x.ooc).slice(0, 2).forEach(ahead);
    if (cur && l.say && mode !== 'tap') voice(cur); };
  function next() {
    if (G.running(g)) return;
    const had = queue.length;
    while (queue.length && queue[0].ooc) bubble(queue.shift());
    if (queue.length) { seen.push(queue[0]); say(queue.shift()); backB.hidden = seen.length < 2; more.hidden = !queue.length; act.hidden = !!queue.length; if (!queue.length) prompt(); return; }
    if (had) prompt();   // 最后剩的都是场外话
  }
  // 上一句：这次打开以来说过的都能往回翻，翻回去再点对话框接着往下
  function back() { if (seen.length < 2) return; queue.unshift(seen.pop()); say(seen.at(-1)); backB.hidden = seen.length < 2; more.hidden = false; act.hidden = true; }
  const show = lines => { queue = lines.slice(); if (mode === 'all') lines.forEach(ahead); act.hidden = true; next(); };
  // 剧本模式：掷完直接放写好的那段，不找 AI
  const onward = ([w, v]) => { g.req = { type: 'free' }; const lines = G.step(g, v, w); G.save(); scene(g.place); paintHud(); show(lines); bedAll(); };
  // 这回合要你做什么
  function prompt() {
    act.hidden = false; act.replaceChildren();
    if (g.done) { act.append(ending()); return; }
    const q = g.fight ? { type: 'free' } : g.req;
    if (g.fight) act.append(fightBox());
    // 检定：你自己点了才掷；只有心理学是 KP 的暗骰（作者定的）：手机替 KP 暗着掷，结果只交给 KP，你只听 KP 讲你看出了什么
    const ws = [].concat(q.who || '你');
    if (q.type === 'check' && q.hidden && q.skill === '心理学') { if (g.run === 'script') { toast('KP 暗暗掷了一次骰'); onward(G.best(ws.map(w => [w, G.resolve(g, { ...q, who: w }).v]))); return; } pending = [pending, ...ws.map(w => '（暗骰）' + G.resolve(g, { ...q, who: w }).text)].filter(Boolean).join('；'); g.req = { type: 'free' }; toast('KP 暗暗掷了一次骰'); send(''); return; }
    // 同一个场景要掷的人一起：画面上掷你（没你就是第一个人），其他人手机跟着掷
    if (q.type === 'check' || q.type === 'san' || q.type === 'opposed') {
      const mine = ws.some(w => w === '你' || w === g.pc.name), rest = ws.filter(w => w !== '你' && w !== g.pc.name && G.who(g, w));
      const lead = mine ? '你' : rest.shift() || '你', name = lead === '你' ? '' : `替${lead}${rest.length ? '等人' : ''}`;
      const label = q.type === 'san' ? `理智检定（${q.loss || '0/1D4'}）` : q.type === 'opposed' ? `${q.skill} 对抗（对方 ${q.vs}）` : `${q.skill} · ${q.level || '普通'}${+q.bonus > 0 ? ' · 奖励骰' : +q.bonus < 0 ? ' · 惩罚骰' : ''}`;
      act.append(h('div.as-int-ask', q.reason ? h('small', q.reason) : null, h('b', label), btn(`${name}掷骰`, 'primary', async () => {
        const r = G.resolve(g, { ...q, who: lead }), more = rest.map(w => [w, G.resolve(g, { ...q, who: w })]), text = [r.text, ...more.map(x => x[1].text)].join('；');
        const rolls = [[lead, r.v], ...more.map(([w, x]) => [w, x.v])];
        if (lead === '你' && G.canPush(q, r)) g.req = { type: 'push', req: { ...q, who: lead }, text, label, rest: rolls.slice(1) };   // 失败了先问要不要孤注一掷（先存着，退出再进来还是这一步）
        await G.save(); paintHud();
        await rollOverlay(p.el, r.r.t, r.r.u, label, r.text, r.v);
        if (more.length) toast(more.map(([w, x]) => `${w} ${x.v}`).join(' · '));
        if (g.req.type === 'push') { prompt(); return; }
        if (g.run === 'script') { onward(G.best(rolls)); return; }
        pending = text; g.req = { type: 'free' }; send('');   // 掷完直接交给 KP，接着讲每个人成功 / 失败之后怎样
      })));
      if (g.run !== 'script') return;   // 剧本：也能不掷先打字，找 AI 接住这一下
    }
    // 孤注一掷：换个做法再掷一次，难度不变，再失败算大失败
    if (q.type === 'push') {
      act.append(h('div.as-int-ask', h('b', withInfo(`${q.req.skill} · 失败`, '可以换个做法孤注一掷：难度不变，再失败就算大失败。')), h('div.as-int-row', btn('孤注一掷', 'secondary', async () => {
        const how = ((await dialog({ title: '孤注一掷', text: '再失败就算大失败', input: { placeholder: '换个做法' } })) || '').trim(); if (!how) return;
        const r = G.push(g, q.req, how); await G.save(); paintHud();
        await rollOverlay(p.el, r.r.t, r.r.u, q.label + ' · 孤注一掷', r.text, r.v);
        if (g.run === 'script') { onward(G.best([['你', r.v], ...q.rest || []])); return; }
        pending = q.text + '；' + r.text; g.req = { type: 'free' }; send('');
      }), btn('就此罢手', 'primary', () => { if (g.run === 'script') { onward(G.best([['你', '失败'], ...q.rest || []])); return; } pending = q.text; g.req = { type: 'free' }; send(''); }))));
      return;
    }
    if (g.run === 'script' && q.type === 'free' && !g.fight) act.append(h('div.as-int-row', btn('继续', 'primary', () => onward(['你', '普通成功']))));   // 剧本这段没写检定
    if (q.type === 'choose' && Array.isArray(q.options)) act.append(h('div.as-int-opts', q.options.slice(0, 4).map(o => btn(String(o), 'secondary', () => send(String(o))))));
    const ta = textarea({ rows: 1, placeholder: pending ? '再说点什么（可不填）' : '你做什么、说什么' });
    const dice = h('button.as-int-dicebtn', { 'aria-label': '主动掷骰', onclick: async () => {
      const sk = await actionSheet('掷什么', Object.entries(g.pc.skills).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ value: k, label: `${k} ${v}` })));
      if (!sk) return;
      const r = G.resolve(g, { type: 'check', skill: sk, level: '普通' }); await rollOverlay(p.el, r.r.t, r.r.u, sk, r.text, r.v);
      pending = [pending, r.text].filter(Boolean).join('；'); ta.placeholder = '再说点什么（可不填）';
    } }, '🎲');
    const bagB = h('button.as-int-dicebtn', { 'aria-label': '随身物品', onclick: async () => {
      const L = g.pc.items || []; if (!L.length) { toast('身上没带东西'); return; }
      const v = await actionSheet('随身物品', L.map((x, i) => ({ value: String(i), label: G.itemText(x) })));
      if (v != null) { ta.value = `用${L[+v].name}`; ta.focus(); }
    } }, '🎒');
    act.append(h('div.as-int-input', dice, bagB, ta, btn('发送', 'primary', () => send(ta.value.trim()))));
  }
  // 战斗这一轮：点敌人选对谁，有武器的挑用哪件，防守选闪避 / 反击（被近战打时用），再选攻击 / 战技 / 找掩护（有敌人拿枪才有）/ 逃跑；一点就收起，免得点两次
  function fightBox() {
    const F = g.fight, me = g.pc, alive = F.foes.filter(f => f.hp > 0), ws = G.weapons(me), dg = me.skills.闪避 ?? 20, bw = me.skills.斗殴 ?? 25;
    let foe = alive[0].name, wpn = ws[ws.length - 1].name, def = dg >= bw ? 'dodge' : 'back';
    const tag = f => [f.held && '被按住', f.down && '倒地', f.wpn === '徒手' && '没武器'].filter(Boolean).join(' · ');
    const chips = h('div.as-int-foes', alive.map((f, i) => h('button' + (i ? '' : '.is-on'), { onclick: e => { foe = f.name; [...chips.children].forEach(x => x.classList.toggle('is-on', x === e.currentTarget)); } }, `${f.name} ♥${f.hp}/${f.hpMax}${tag(f) ? ' · ' + tag(f) : ''}`)));
    // 每一轮在手机里掷完、在对话框里一下下放给你看，不找 AI；打完（或者你中途说话）才把攒下的几轮一起交给 KP 讲，一场战斗只找一两次 AI
    const go = async (kind, x) => {
      act.replaceChildren();
      const r = G.fightRound(g, { kind, foe, wpn, def, move: x, skill: x }); await G.save(); paintHud();
      if (r.mine) await rollOverlay(p.el, r.mine.t, r.mine.u, r.cap, '', r.mine.grade);
      pending = [pending, r.text].filter(Boolean).join('\n');
      if (r.over) { send(''); return; }
      show(r.lines.map(t => ({ who: '战斗', act: t })));
    };
    const moveB = btn('战技', 'secondary', async () => { const v = await actionSheet('战技', G.MOVES.map(([k, n]) => ({ value: k, label: n }))); if (v) go('move', v); });
    const pw = (me.abilities || []).map((x, i) => [x, i]).filter(([x]) => x.kind !== 'other');
    const powB = pw.length ? btn('能力', 'secondary', async () => { const v = await actionSheet(`能力 · 魔法 ${me.mp}/${me.mpMax}`, pw.map(([x, i]) => ({ value: String(i), label: `${x.name}（${R.POWERS[x.kind]}${x.cost ? ` · 耗 ${x.cost}` : ''}）` }))); if (v != null) go('power', +v); }) : null;
    return h('div.as-int-ask.as-int-fight', h('b', `战斗 · 第 ${F.round + 1} 轮`), chips,
      ws.length > 1 ? h('div.as-int-def', h('span', '武器'), segmented(ws.map(w => [w.name, w.name]), wpn, v => { wpn = v; })) : null,
      h('div.as-int-def', h('span', '防守'), segmented([['dodge', `闪避 ${dg}`], ['back', `反击 ${bw}`]], def, v => { def = v; })),
      h('div.as-int-row', btn('攻击', 'primary', () => go('atk')), moveB, powB, alive.some(f => /枪/.test(f.wpn)) ? btn('找掩护', 'secondary', () => go('cover')) : null, btn('逃跑', 'secondary', () => go('flee'))));
  }
  async function send(what) {
    if (G.running()) { G.cancel(); return; }
    if (g.req.type === 'push') { pending = [pending, g.req.text].filter(Boolean).join('；'); g.req = { type: 'free' }; }
    const inp = [pending, what].filter(Boolean).join('；') || '（什么都没做，让 KP 继续）';
    act.replaceChildren(h('div.as-int-wait', h('span.as-spin'), '　KP 在想…', btn('取消', 'secondary', G.cancel)));
    try {
      const lines = await (inflight = G.play(g, inp)); pending = '';   // 没写成时骰子结果留着，下次发送一起带上
      scene(g.place); paintHud(); show(lines); bedAll();
    } catch (e) {
      if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', '这回合失败：' + e.message, e); toast('这回合没写成：' + e.message); }
      prompt();
    }
  }
  // 落幕 → 复盘会（每局都开，作者定的）：找一次 AI 写好，大家回到书桌边聊边看每个人的结局，最后是黑匣子；看完才是成长和回桌
  const backTo = () => nav.depth() > 2 ? '回到卷宗' : '回到桌上';   // 从卷宗点进来的回卷宗
  let reviewing = false;
  const playReview = () => { reviewing = true; scene('desk'); show(g.review.lines); };
  async function holdReview(card) {
    const row = h('div.as-int-wait', h('span.as-spin'), '　大家回到桌边…', btn('取消', 'secondary', G.cancel)); card.append(row);
    try { await (inflight = G.review(g)); row.replaceWith(h('div.as-int-row', btn('开复盘会', 'primary', playReview))); }
    catch (e) { if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', '复盘会没开成：' + e.message, e); toast('复盘会没开成：' + e.message); }
      row.replaceWith(h('div.as-int-row', btn('开复盘会', 'primary', () => { card.lastChild.remove(); holdReview(card); }), btn(backTo(), 'secondary', () => nav.pop()))); }
  }
  // 看完复盘会：活着的人过一遍成长（只算一次），你的属性点在这里分，也能回车卡页再分
  const ending = () => {
    const card = h('div.as-int-end', h('b', `${G.ENDS[g.done.kind]}${g.done.name ? ` ·《${g.done.name}》` : ''}`), h('p', g.done.text));
    if (reviewing) { reviewing = false; g.review.done = true; G.save(); }
    if (!g.review) { if (!G.running(g)) holdReview(card); return card; }
    if (!g.review.done) { card.append(h('div.as-int-row', btn('开复盘会', 'primary', playReview))); return card; }
    const box = h('div.as-int-grow');
    const paint = list => box.replaceChildren(...(list || []).map(x => h('p', `${x.name}：${x.up.length ? x.up.join('、') : '技能没长'}${x.pts ? ` · 成长点 +${x.pts}` : ''}`)),
      ...(list || []).filter(x => x.me && (G.cardById(x.card) || {}).pend).map(x => btn(`分 ${G.cardById(x.card).pend} 成长点`, 'secondary', () => spendSheet(G.cardById(x.card), () => paint(g.grown)))));
    G.grow(g).then(() => paint(g.grown));
    card.append(box, h('div.as-int-row', btn('再看复盘会', 'secondary', playReview), btn(backTo(), 'primary', () => nav.pop())));
    return card;
  };
  paintHud();
  gls = glass(box, p.el, sceneSrc(g.place), SHADE);
  p.el._onLeave = () => { hush(); pre.abort(); gls.dispose(); beds.bgm.pause(); left = true; ambient(); host.removeEventListener('asterphone-voice', duck); };
  if (G.running(g)) {   // 上次退出时 KP 还在想：接着等那一次
    act.hidden = false; act.append(h('div.as-int-wait', h('span.as-spin'), '　KP 在想…', btn('取消', 'secondary', G.cancel))); say({ who: 'KP', act: '…' });
    inflight.then(lines => { if (G.wrapping(g)) return prompt(); scene(g.place); paintHud(); show(lines); bedAll(); }, () => prompt());
  } else show(g.log.filter(l => l.r === g.round && !l.me));
  nav.push(p.el); bedAll();
}
