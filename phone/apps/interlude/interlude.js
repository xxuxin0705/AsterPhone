// 幕间：和联系人一起开一局跑团（方案见 docs/pages-interlude.md）。整局不进正文、不进记忆。
// 打开是一张斜着看下去的 2.5D 书桌（GPT 画的一张图，一屏放下，不拖）；点桌上的东西镜头推过去、浮出玻璃标签：
// 椅子（谁上桌）、档案袋（选本）、调查员卡（车卡）、骰子盘（掷着玩）、台灯（开关灯）、旧地图（DND）、火漆信（剧本杀）。
// 车卡：先选好谁上桌，AI 一次给几个人一起车卡，再一张张微调；卡跟着人存。玩的时候是老照片场景 + 人物牌 + 对话框。
import { h, debounce } from '../../core/util.js';
import { state, contact, commit } from '../../core/store.js';
import { page, navBtn, sheet, actionSheet, dialog, toast, btn, segmented, input, textarea, field, group, item, icon, avatar } from '../../core/ui.js';
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

const BASE = 'assets/interlude/';
const img = (k, cls = '') => h('img' + cls, { src: BASE + k + '.webp', alt: '', draggable: false });
const serif = s => h('span.as-int-serif', s);
// 桌上选好的东西：退出再进来还在
const pick = { scenario: 'random', ask: '', mood: 'serious', party: [] };
const MAX_SEATS = 5;
let inflight = null;   // 正在等的那一回合（退出页面再进来还能接上）
const failed = (e, what) => { if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', what + '：' + e.message, e); toast(what + '：' + e.message); } };

/* ---------- 书桌 ---------- */
// 图上的位置（原图 1024×1536 的像素）：[左, 上, 右, 下]；椅子多两个数是头像坐的位置
const IW = 1024, IH = 1536;
const SPOTS = [['files', [110, 900, 450, 1185], '档案袋', '选本'], ['cards', [545, 925, 840, 1095], '调查员卡', '车卡'], ['tray', [410, 755, 688, 905], '骰子盘', '掷骰子'],
  ['lamp', [605, 440, 790, 715], '台灯', ''], ['map', [240, 640, 485, 780], '旧地图', 'DND'], ['letter', [528, 1125, 805, 1285], '火漆信', '剧本杀']];
const CHAIRS = [[430, 380, 605, 565, 517, 515], [45, 480, 230, 830, 150, 700], [805, 500, 1015, 900, 885, 715], [0, 650, 150, 1230, 75, 965], [890, 670, 1024, 1260, 960, 965]];
const pct = (v, all) => v / all * 100 + '%';

export function open() {
  const more = navBtn('more', '更多', async () => {
    const g = G.current();
    const v = await actionSheet('幕间', [g ? { value: 'quit', label: `放弃《${g.title}》`, danger: true } : null, { value: 'rule', label: '规则小抄' }].filter(Boolean));
    if (v === 'quit' && await dialog({ title: '放弃这一局？', text: '放弃后回到桌上，可以开新的一局。', confirm: '放弃', danger: true })) { await G.quit(g); syncBar(); }
    if (v === 'rule') dialog({ title: '规则小抄', text: '掷 1D100，小于等于技能值就成功；困难要小于等于一半，极难要小于等于五分之一。看到可怕的东西要掷理智，一次掉 5 点以上会临时发疯。血归零倒地，理智归零退场。', confirm: '知道了', cancel: '' });
  });
  const p = page({ app: 'interlude', id: 'int-desk', title: '幕间', large: true, back: true, cls: 'as-int-desk', right: [more] });
  const world = h('div.as-int-world', img('desk-day'), img('desk-night', '.is-night'));
  const scene = h('div.as-int-scene', { 'data-no-swipe': '' }, world);
  p.el.prepend(scene);
  // 台灯：默认跟着手机的深色模式，点了自己开关
  let lamp = null;
  const lampOn = () => lamp ?? (document.querySelector('.as-phone')?.dataset.mode === 'night');
  const paintLamp = () => scene.classList.toggle('is-lit', lampOn());
  paintLamp();
  // 标签：钉在东西上的小玻璃牌
  const tag = (x, y, text) => h('span.as-int-pin', { style: `left:${pct(x, IW)};top:${pct(y, IH)}` }, h('i'), h('b', text));
  const hot = (box, key) => h('button.as-int-hot', { 'aria-label': key, dataset: { k: key }, style: `left:${pct(box[0], IW)};top:${pct(box[1], IH)};width:${pct(box[2] - box[0], IW)};height:${pct(box[3] - box[1], IH)}` });
  SPOTS.forEach(([k, b, name, sub]) => world.append(hot(b, k), tag((b[0] + b[2]) / 2, b[1] + 6, sub ? `${name} · ${sub}` : name)));
  CHAIRS.forEach((c, i) => world.append(hot(c, 'chair')));
  world.append(tag(517, 390, '座位'));
  // 椅子上坐的人
  const seats = CHAIRS.map(c => { const el = h('span.as-int-sit', { style: `left:${pct(c[4], IW)};top:${pct(c[5], IH)}` }); world.append(el); return el; });
  const paintSeats = () => seats.forEach((el, i) => { const c = contact(pick.party[i]); el.replaceChildren(...(c ? [avatar(c.avatar, nameOf(c), 40), h('small', nameOf(c))] : [])); el.hidden = !c; });
  pick.party = pick.party.filter(id => contact(id)); paintSeats();
  const dice = h('div.as-int-traydice', { style: `left:${pct(470, IW)};top:${pct(770, IH)};width:${pct(160, IW)};height:${pct(110, IH)}` }); world.append(dice); restDice(dice);
  // 拖着看、推镜头
  // 一屏放下整张桌子（作者不要左右拖）：图铺满屏幕、贴着底，两边裁掉一点；靠边那两把椅子上的头像往里挪到看得见的地方
  let W = 0, H = 0, ww = 0, wh = 0, ox = 0, oy = 0, zoom = null;
  const apply = (anim = true) => {
    world.style.transition = anim ? '' : 'none';
    if (!zoom) { world.style.transform = 'translate(0, 0) scale(1)'; return; }
    const s = 1.75, cx = zoom[0] * ww / IW, cy = zoom[1] * wh / IH;
    const tx = Math.min(-ox, Math.max(W - ox - ww * s, W / 2 - ox - cx * s)), ty = Math.min(-oy, Math.max(H - oy - wh * s, H * .4 - oy - cy * s));
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  const fit = () => {
    W = scene.clientWidth; H = scene.clientHeight; const k = Math.max(W / IW, H / IH); ww = IW * k; wh = IH * k; ox = (W - ww) / 2; oy = Math.min(0, H - wh);
    Object.assign(world.style, { width: ww + 'px', height: wh + 'px', left: ox + 'px', top: oy + 'px' });
    const cut = -ox / k + 40; seats.forEach((el, i) => { el.style.left = pct(Math.min(IW - cut, Math.max(cut, CHAIRS[i][4])), IW); });
    apply(false);
  };
  new ResizeObserver(fit).observe(scene);
  scene.addEventListener('click', e => {
    if (e.target.closest('.as-int-label')) return;
    const hit = e.target.closest('.as-int-hot');
    if (!hit) { if (zoom) unzoom(); return; }
    focus(hit.dataset.k, hit);
  });
  // 推过去以后下面浮出的玻璃标签
  const label = h('div.as-int-label'); p.el.append(label);
  const unzoom = () => { zoom = null; apply(); label.classList.remove('is-open'); scene.classList.remove('is-zoomed'); };
  function focus(k, el) {
    const r = el.getBoundingClientRect(), w = world.getBoundingClientRect();
    zoom = [((r.left + r.right) / 2 - w.left) / w.width * IW, ((r.top + r.bottom) / 2 - w.top) / w.height * IH]; apply(); scene.classList.add('is-zoomed');
    const n = pick.party.length, sc0 = R.SCENARIOS.find(s => s.id === pick.scenario);
    const L = {
      chair: ['座位', n ? `上桌：${pick.party.map(id => nameOf(contact(id))).join('、')}` : '还没有人上桌', [['选谁上桌', choose]]],
      files: ['档案袋', `${sc0 ? sc0.title : pick.ask ? '随机：' + pick.ask : '随机生成'} · ${R.MOODS.find(m => m[0] === pick.mood)[1]}`, [['选本', () => scenarioSheet(() => focus(k, el))]]],
      cards: ['调查员卡', '你和上桌的人各一张', [['看卡 · 车卡', () => { unzoom(); cardPage(syncBar); }]]],
      tray: ['骰子盘', '1D100', [['掷一下', async () => { const r = R.d100(); await rollOverlay(p.el, r.t, r.u, '1D100', '掷出 ' + r.v); }]]],
      lamp: ['台灯', '', [[lampOn() ? '关灯' : '开灯', () => { lamp = !lampOn(); paintLamp(); focus(k, el); }]]],
      map: ['旧地图 · DND', '还没开放', []],
      letter: ['火漆信 · 剧本杀', '还没开放', []],
    }[k];
    label.replaceChildren(h('b', L[0]), L[1] ? h('small', L[1]) : null, h('div', ...L[2].map(([t, fn]) => btn(t, 'primary', fn)), btn('退回', 'secondary', unzoom)));
    label.classList.add('is-open');
  }
  async function choose() {
    const got = await pickMany('谁上桌（最多 5 个）', state.contacts.map(c => ({ key: c.id, name: nameOf(c), avatar: c.avatar })), { preselect: pick.party });
    if (!got) return;
    if (got.length > MAX_SEATS) toast(`只有 ${MAX_SEATS} 把椅子，先坐前 ${MAX_SEATS} 个`);
    pick.party = got.slice(0, MAX_SEATS); paintSeats(); unzoom(); syncBar();
  }
  // 底下一条：谁上桌 + 开局 / 继续
  const who = h('span'), go = btn('开局', 'primary', () => { const g = G.current(); if (g) playPage(g); else cardPage(syncBar); });
  const bar = h('div.as-int-bar', who, go); p.body.append(bar);
  function syncBar() { const g = G.current(); who.textContent = `上桌：${[myName(), ...pick.party.map(id => nameOf(contact(id)))].join('、')}`; go.textContent = g ? `继续《${g.title}》` : '开局'; }
  G.load().then(syncBar);
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
  const lines = [...rows.map((t, i) => [t, size, top + i * .16, 0]), ['——致调查员', size * .7, top + rows.length * .16 + .04, 1]];
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

/* ---------- 选本：内置的几个 / 随机 / 自己写一句；气氛 ---------- */
function scenarioSheet(done) {
  const ask = textarea({ value: pick.ask, rows: 2, placeholder: '想玩什么', onInput: v => { pick.ask = v.trim(); } });
  const rows = [...R.SCENARIOS.map(s => ({ value: s.id, label: s.title, sub: s.blurb })), { value: 'random', label: '随机生成', sub: '让 KP 现编一个' }].map(o =>
    item({ title: o.label, sub: o.sub, right: h('span.as-check', icon('check', 18, 2.4)), cls: pick.scenario === o.value ? 'is-on' : '', onClick: e => {
      pick.scenario = o.value; [...e.currentTarget.parentNode.children].forEach(x => x.classList.toggle('is-on', x === e.currentTarget)); askF.hidden = o.value !== 'random'; } }));
  const askF = field('要求', ask); askF.hidden = pick.scenario !== 'random';
  const s = sheet({ title: '玩哪个本', cls: 'as-int-sheet', content: [group('', rows), askF, field('气氛', segmented(R.MOODS, pick.mood, v => { pick.mood = v; })),
    h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => { s.close(); done(); }))] });
}

/* ---------- 调查员卡：上面一排头像切换，下面是这个人的卡（羊皮纸）；没卡的人一起让 AI 车 ---------- */
const ownerName = o => o === 'me' ? myName() : nameOf(contact(o));
const ownerFace = (o, size) => o === 'me' ? avatar(myAvatar(), myName(), size, size > 60 ? 'square' : 'round') : avatar(contact(o).avatar, nameOf(contact(o)), size, size > 60 ? 'square' : 'round');
function cardPage(back) {
  const owners = ['me', ...pick.party], cur = Object.fromEntries(owners.map(o => [o, G.lastCard(o)]));
  let sel = 'me';
  const p = page({ app: 'interlude', id: 'int-card', title: '调查员', large: true, back: true, cls: 'as-int-card' });
  const tabs = h('div.as-int-tabs', owners.map(o => h('button', { dataset: { o }, onclick: () => { sel = o; paintTabs(); paint(); } }, ownerFace(o, 40), h('small', ownerName(o)))));
  const paintTabs = () => [...tabs.children].forEach(b => { b.classList.toggle('is-on', b.dataset.o === sel); b.classList.toggle('is-none', !cur[b.dataset.o]); });
  const photo = h('div.as-int-card__photo'), head = h('div.as-int-card__head'), sheetEl = h('div.as-int-sheet-paper'), scroller = h('div.as-int-card__scroll', photo, head, sheetEl);
  const saveLater = debounce(() => G.save(), 400);
  const makeB = btn('AI 车卡', 'primary', () => make(owners.filter(o => !cur[o])));
  const swapB = btn('换卡', 'secondary', () => swapCard());
  const startB = btn('开局', 'primary', () => begin());
  p.body.append(tabs, scroller, h('div.as-int-card__bar', swapB, makeB, startB));
  const paintBar = () => { const miss = owners.filter(o => !cur[o]).length; makeB.hidden = !miss; makeB.textContent = `AI 车卡（${miss} 人）`; startB.hidden = !!miss; swapB.hidden = !cur[sel]; };
  async function make(list) {
    if (G.running()) { G.cancel(); return; }
    makeB.replaceChildren(h('span.as-spin')); toast(`KP 在给 ${list.length} 个人车卡…`, { label: '取消', fn: G.cancel, wait: true });
    try { (await G.makeCards(list)).forEach(c => { cur[c.owner] = c; }); toast('车好了，可以一张张改'); }
    catch (e) { failed(e, '没车成'); }
    paintTabs(); paint(); paintBar();
  }
  async function swapCard() {
    const mine = G.cardsOf(sel), c = cur[sel];
    const v = await actionSheet(`${ownerName(sel)}的卡`, [...mine.map(x => ({ value: x.id, label: `${x.name} · ${x.job}`, active: x === c })), { value: 'new', label: '新车一张' }, c && { value: 'del', label: '删除这张', danger: true }].filter(Boolean));
    if (v === 'new') { await make([sel]); return; }
    if (v === 'del') { if (!(await dialog({ title: '删除这张卡？', confirm: '删除', danger: true }))) return; await G.dropCard(c); cur[sel] = G.lastCard(sel); }
    else if (v) { cur[sel] = mine.find(x => x.id === v); await G.useCard(cur[sel]); }
    else return;
    paintTabs(); paint(); paintBar();
  }
  async function begin() {
    if (G.running()) { G.cancel(); return; }
    startB.replaceChildren(h('span.as-spin')); toast('KP 在写这一局…', { label: '取消', fn: G.cancel, wait: true });
    try {
      await Promise.all(owners.map(o => G.useCard(cur[o])));
      const g = await G.start({ mood: pick.mood, scenario: pick.scenario, ask: pick.ask, me: cur.me, party: pick.party.map(o => cur[o]) });
      toast(`《${g.title}》写好了`); back();
      await castRoll(p.el, g); nav.pop(); playPage(g);
    } catch (e) { failed(e, '没开成'); }
    startB.textContent = '开局';
  }
  // 一张卡：改哪一格就只改那一格
  function paint() {
    const c = cur[sel];
    photo.replaceChildren(ownerFace(sel, 96));
    if (!c) { head.replaceChildren(); sheetEl.replaceChildren(h('p.as-int-sheet-empty', `${ownerName(sel)}还没有卡`)); return; }
    const set = (k, v) => { c[k] = v; saveLater(); };
    const line = (label, key, opts = {}) => field(label, input({ value: String(c[key] ?? ''), type: opts.type || 'text', onInput: v => set(key, opts.type ? +v : v) }));
    const jobB = h('button.as-int-job', { onclick: async () => {
      const v = await actionSheet('职业', [...R.JOBS.map(([j]) => ({ value: j, label: j, active: c.job === j })), { value: '__own', label: '自己写' }]);
      if (!v) return;
      const j = v === '__own' ? ((await dialog({ title: '职业', input: { value: c.job } })) || '').trim() : v;
      if (!j) return;
      set('job', j); jobB.textContent = j;
      if (R.JOBS.some(x => x[0] === j) && await dialog({ title: '按这个职业重新分技能？', text: '本职技能按职业重新加点，兴趣点要自己再加。', confirm: '重新分' })) { c.skills = R.jobSkills(c.attrs, j); saveLater(); paintSkills(); }
    } }, c.job || '选职业');
    // 属性：点数字改；重掷、五选一
    const attrBox = h('div.as-int-attrs'), derivedEl = h('div.as-int-derived');
    const paintAttrs = () => {
      attrBox.replaceChildren(...R.ATTRS.map(([k, n]) => h('button.as-int-attr', { onclick: async () => {
        const v = parseInt(await dialog({ title: n, input: { value: String(c.attrs[k]) } }), 10); if (!v) return;
        c.attrs[k] = Math.max(1, Math.min(99, v)); c.skills = R.fixSkills(c.attrs, c.skills); saveLater(); paintAttrs(); paintSkills();
      } }, h('small', n), h('b', c.attrs[k]), h('i', `${Math.floor(c.attrs[k] / 2)} / ${Math.floor(c.attrs[k] / 5)}`))));
      const d = R.derived(c.attrs); derivedEl.textContent = `血 ${d.hp} · 理智 ${d.san} · 魔法 ${d.mp} · 移动 ${d.mov}`;
    };
    const newAttrs = a => { c.attrs = a; c.skills = R.fixSkills(a, c.skills); saveLater(); paintAttrs(); paintSkills(); };
    const reroll = btn('重掷', 'secondary', async () => { const r = R.d100(); await rollOverlay(p.el, r.t, r.u, '3D6×5'); newAttrs(R.rollAttrs()); });
    const five = btn('天命五选一', 'secondary', () => {
      const sets = R.fiveSets();
      const s = sheet({ title: '挑一套', content: h('div.as-actions', sets.map(a => h('button.as-actions__item', { onclick: () => { s.close(); newAttrs(a); } },
        h('span', R.ATTRS.map(([k, n]) => `${n.slice(0, 1)}${a[k]}`).join(' ') + `　共 ${R.ATTRS.reduce((t, [k]) => t + (k === 'LUCK' ? 0 : a[k]), 0)}`)))) });
    });
    // 技能：加过点的排前面，− / + 每次 5 点；点数超了标红
    const pts = h('div.as-int-pts'), skillBox = h('div.as-int-skills'), restBox = h('div.as-int-skills.is-rest');
    const restB = h('button.as-int-more', { onclick: () => { restBox.hidden = !restBox.hidden; restB.textContent = restBox.hidden ? '其余技能 ▾' : '收起 ▴'; } }, '其余技能 ▾');
    restBox.hidden = true;
    function paintSkills() {
      const base = R.baseSkills(c.attrs), used = R.spent(c.attrs, c.skills), all = R.points(c.attrs);
      pts.textContent = `技能点 ${used} / ${all}`; pts.classList.toggle('is-over', used > all);
      const row = k => { const v = h('b', c.skills[k]);
        const bump = d => { c.skills[k] = Math.max(base[k], Math.min(R.MAX_SKILL, c.skills[k] + d)); v.textContent = c.skills[k]; const u = R.spent(c.attrs, c.skills); pts.textContent = `技能点 ${u} / ${all}`; pts.classList.toggle('is-over', u > all); saveLater(); };
        return h('div.as-int-skill', h('span', k), h('small', base[k]), h('button', { 'aria-label': '减', onclick: () => bump(-5) }, '−'), v, h('button', { 'aria-label': '加', onclick: () => bump(5) }, '+')); };
      const keys = Object.keys(base).sort((a, b) => (c.skills[b] - base[b]) - (c.skills[a] - base[a]) || c.skills[b] - c.skills[a]);
      skillBox.replaceChildren(...keys.filter(k => c.skills[k] > base[k]).map(row)); restBox.replaceChildren(...keys.filter(k => c.skills[k] <= base[k]).map(row));
    }
    const bg = (label, k) => field(label, textarea({ value: c.bg[k] || '', rows: 2, onInput: v => { c.bg[k] = v; saveLater(); } }));
    head.replaceChildren(input({ value: c.name, placeholder: '名字', onInput: v => set('name', v) }), jobB);
    sheetEl.replaceChildren(
      h('div.as-int-grid2', line('年龄', 'age', { type: 'number' }), line('性别', 'sex'), line('住地', 'home')),
      h('h3', '属性'), attrBox, derivedEl, h('div.as-int-row', reroll, five),
      h('h3', '技能'), pts, skillBox, restB, restBox,
      h('h3', '背景'), bg('身份', 'who'), bg('关键经历', 'past'), bg('目标', 'goal'), bg('秘密', 'secret'));
    paintAttrs(); paintSkills();
    sheetEl.scrollTop = 0;
  }
  paintTabs(); paint(); paintBar();
  nav.push(p.el);
  if (owners.some(o => !cur[o])) make(owners.filter(o => !cur[o]));   // 进来就把没卡的一起车了
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
const sceneSrc = k => BASE + 'scene-' + R.placeOf(k) + '.webp';
function playPage(g) {
  const p = page({ app: 'interlude', id: 'int-play', title: g.title, large: true, back: true, cls: 'as-int-play' });
  const bg = h('div.as-int-bg', h('img', { src: sceneSrc(g.place), alt: '' })); p.el.prepend(bg);
  p.el.style.backgroundPosition = 'center top';   // 给液态玻璃量背景用（和场景照片的铺法一样）
  const SHADE = ['rgba(10,14,24,.2)', 'rgba(10,14,24,.65)'];
  let shown = g.place, gls = null;
  const scene = k => { if (k === shown) return; shown = k; const n = new Image(); n.src = sceneSrc(k); n.decode().catch(() => {}).then(() => { n.classList.add('is-in'); bg.append(n); setTimeout(() => { bg.firstChild !== n && bg.firstChild.remove(); }, 900);
    gls.dispose(); box.querySelector('.as-glass-cv')?.remove(); gls = glass(box, p.el, n.src, SHADE); }); };
  // 顶上的状态：第几幕、第几回合、血、理智
  const hud = h('div.as-int-hud'), hudAct = h('span'), hudHp = h('span'), hudSan = h('span'), hudMad = h('span.is-mad');
  const push = btn('推进', 'secondary', () => send('（推进剧情）'));
  hud.append(hudAct, hudHp, hudSan, hudMad, push);
  const paintHud = () => { hudAct.textContent = `第 ${g.act + 1}/${g.sk.acts.length} 幕 · 第 ${g.round} 回合`; hudHp.textContent = `♥ ${g.pc.hp}/${g.pc.hpMax}`; hudSan.textContent = `◈ ${g.pc.san}/${g.pc.sanMax}`; hudMad.textContent = g.pc.mad ? g.pc.mad.name : ''; };
  // 人物牌 + 对话框
  const face = h('div.as-int-who__face'), nameT = h('span.as-int-who__name'), who = h('div.as-int-who', face, nameT);
  const text = h('p'), more = h('span.as-int-box__more', '▸');
  // 念这一句：默认点喇叭才念，设置里能改成出来就念；再点一下停
  const voiceB = h('button.as-int-box__voice', { 'aria-label': '念这一句', onclick: e => { e.stopPropagation(); voice(cur); } }, icon('volume', 18, 1.8));
  const box = h('div.as-int-box', { onclick: () => next() }, text, voiceB, more);
  let cur = null, vac = null;
  const hush = () => { if (vac) { vac.abort(); vac = null; stopSpeak(); voiceB.classList.remove('is-on'); } };
  const vid = n => n === 'KP' ? 'kp' : n === myName() || n === g.pc.name ? 'me' : (g.party.find(x => x.name === n || nameOf(contact(x.id)) === n) || {}).id || 'kp';
  async function voice(l) {
    if (!l) return;
    if (vac) { hush(); return; }
    const ac = vac = new AbortController(); voiceB.classList.add('is-on');
    try { await speakAs(vid(l.who), l.text, { stop: ac.signal, cache: `int:a:${g.id}:${g.log.indexOf(l)}` }); }
    catch (e) { if (!ac.signal.aborted) { log('warn', '幕间', '念不出来：' + e.message); toast('念不出来：' + e.message); } }
    if (vac === ac) { vac = null; voiceB.classList.remove('is-on'); }
  }
  const act = h('div.as-int-act'), stage = h('div.as-int-stage', { 'data-no-swipe': '' }, who, box, act);
  p.body.append(hud, stage);
  let queue = [], pending = '';   // 还没念到的台词；掷完骰子等着一起发给 KP 的结果
  const faceOf = n => { if (n === 'KP') return img('kp'); if (n === myName() || n === g.pc.name) return avatar(myAvatar(), myName(), 110, 'square'); const m = g.party.find(x => x.name === n || nameOf(contact(x.id)) === n), c = m && contact(m.id); return c ? avatar(c.avatar, nameOf(c), 110, 'square') : h('span.as-int-who__none', n.slice(0, 1)); };
  const say = l => { hush(); cur = g.log.includes(l) ? l : null; voiceB.hidden = !cur;
    if (nameT.textContent !== l.who) { nameT.textContent = l.who; face.replaceChildren(faceOf(l.who)); } text.textContent = l.text;
    if (cur && state.apps.interlude.voice === 'auto') voice(cur); };
  function next() {
    if (G.running(g)) return;
    if (queue.length) { say(queue.shift()); more.hidden = !queue.length; act.hidden = !!queue.length; if (!queue.length) prompt(); return; }
  }
  const show = lines => { queue = lines.slice(); act.hidden = true; next(); };
  // 这回合要你做什么
  function prompt() {
    act.hidden = false; act.replaceChildren();
    if (g.done) { act.append(ending()); return; }
    const q = g.req;
    if (q.type === 'check' || q.type === 'san' || q.type === 'opposed') {
      const mine = !q.who || q.who === '你' || q.who === g.pc.name, name = mine ? '' : `替${q.who}`;
      const label = q.type === 'san' ? `理智检定（${q.loss || '0/1D4'}）` : q.type === 'opposed' ? `${q.skill} 对抗（对方 ${q.vs}）` : `${q.skill} · ${q.level || '普通'}`;
      act.append(h('div.as-int-ask', q.reason ? h('small', q.reason) : null, h('b', label), btn(`${name}掷骰`, 'primary', async () => {
        const r = G.resolve(g, q); await G.save(); paintHud();
        await rollOverlay(p.el, r.r.t, r.r.u, label, r.text, r.v);
        pending = r.text; g.req = { type: 'free' }; send('');   // 掷完直接交给 KP，接着讲成功 / 失败之后怎样
      })));
      return;
    }
    if (q.type === 'choose' && Array.isArray(q.options)) act.append(h('div.as-int-opts', q.options.slice(0, 4).map(o => btn(String(o), 'secondary', () => send(String(o))))));
    const ta = textarea({ rows: 1, placeholder: pending ? '再说点什么（可不填）' : '你做什么、说什么' });
    const dice = h('button.as-int-dicebtn', { 'aria-label': '主动掷骰', onclick: async () => {
      const sk = await actionSheet('掷什么', Object.entries(g.pc.skills).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ value: k, label: `${k} ${v}` })));
      if (!sk) return;
      const r = G.resolve(g, { type: 'check', skill: sk, level: '普通' }); await rollOverlay(p.el, r.r.t, r.r.u, sk, r.text, r.v);
      pending = [pending, r.text].filter(Boolean).join('；'); ta.placeholder = '再说点什么（可不填）';
    } }, '🎲');
    act.append(h('div.as-int-input', dice, ta, btn('发送', 'primary', () => send(ta.value.trim()))));
  }
  async function send(what) {
    if (G.running()) { G.cancel(); return; }
    const inp = [pending, what].filter(Boolean).join('；') || '（什么都没做，让 KP 继续）';
    act.replaceChildren(h('div.as-int-wait', h('span.as-spin'), '　KP 在想…', btn('取消', 'secondary', G.cancel)));
    try {
      const lines = await (inflight = G.play(g, inp)); pending = '';   // 没写成时骰子结果留着，下次发送一起带上
      scene(g.place); paintHud(); show(lines);
    } catch (e) {
      if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', '这回合失败：' + e.message, e); toast('这回合没写成：' + e.message); }
      prompt();
    }
  }
  const ending = () => h('div.as-int-end', h('b', g.done.kind === 'good' ? '——终' : '——完'), h('p', g.done.text), btn('回到桌上', 'primary', () => nav.pop()));
  paintHud();
  gls = glass(box, p.el, sceneSrc(g.place), SHADE);
  p.el._onLeave = () => { hush(); gls.dispose(); };
  if (G.running(g)) {   // 上次退出时 KP 还在想：接着等那一次
    act.hidden = false; act.append(h('div.as-int-wait', h('span.as-spin'), '　KP 在想…', btn('取消', 'secondary', G.cancel))); say({ who: 'KP', text: '…' });
    inflight.then(lines => { scene(g.place); paintHud(); show(lines); }, () => prompt());
  } else show(g.log.filter(l => l.r === g.round && !l.me));
  nav.push(p.el);
}
