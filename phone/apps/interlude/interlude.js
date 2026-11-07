// 幕间：和联系人一起开一局跑团（方案见 docs/pages-interlude.md）。整局不进正文、不进记忆。
// 打开是一张俯视的书桌：骰子盘（跑团）、火漆信（剧本杀，还没开放）、地图（DND，还没开放）、档案袋（选本）、椅子（谁上桌）、托盘里的小物件（拿一件去车卡）、火漆印章（开局）。
// 车卡是一张牛皮纸档案表；玩的时候是老照片场景 + 人物牌 + 对话框，一回合一次 API。
import { h, uid } from '../../core/util.js';
import { state, contact, commit } from '../../core/store.js';
import { page, navBtn, sheet, actionSheet, dialog, toast, btn, segmented, input, textarea, field, group, item, icon, avatar } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { myName, myAvatar } from '../../core/promptstore.js';
import { nameOf } from '../chat/engine.js';
import { log } from '../../core/log.js';
import * as G from './game.js';
import * as R from './rules.js';
import { diceBox } from './dice.js';

const BASE = 'assets/interlude/';
const img = (k, cls = '') => h('img' + cls, { src: BASE + k + '.webp', alt: '', draggable: false });
const serif = s => h('span.as-int-serif', s);
// 桌上选好的东西：退出车卡页回来还在
const pick = { scenario: 'random', ask: '', mood: 'serious', token: '', party: [] };
const SEATS = 4;
let inflight = null;   // 正在等的那一回合（退出页面再进来还能接上）

export function open() {
  const more = navBtn('more', '更多', async () => {
    const g = G.current();
    const v = await actionSheet('幕间', [g ? { value: 'quit', label: `放弃《${g.title}》`, danger: true } : null, { value: 'rule', label: '规则小抄' }].filter(Boolean));
    if (v === 'quit' && await dialog({ title: '放弃这一局？', text: '放弃后回到桌上，可以开新的一局。', confirm: '放弃', danger: true })) { await G.quit(g); syncSeal(); }
    if (v === 'rule') dialog({ title: '规则小抄', text: '掷 1D100，小于等于技能值就成功；困难要小于等于一半，极难要小于等于五分之一。看到可怕的东西要掷理智，一次掉 5 点以上会临时发疯。血归零倒地，理智归零退场。', confirm: '知道了', cancel: '' });
  });
  const p = page({ app: 'interlude', id: 'int-desk', title: '幕间', large: true, back: true, cls: 'as-int-desk', right: [more] });
  p.el.prepend(h('div.as-int-bg', img('desk-day'), img('desk-night', '.is-night')));
  const table = h('div.as-int-table', { 'data-no-swipe': '' });
  p.body.append(table);
  // 骰子盘：平时两颗骰子躺着，点一下抛着玩
  const tray = h('button.as-int-prop.is-dice', { 'aria-label': '骰子盘', style: 'left:21%;top:21%;width:34%' }, img('tray-dice'), h('div.as-int-dicehost'));
  const box = diceBox(tray.lastChild, { view: 10 }); let rolling = false;
  box.rest(3, 7);
  tray.onclick = async () => { if (rolling) return; rolling = true; const r = R.d100(); await box.roll(r.t, r.u); rolling = false; };
  p.el._onLeave = () => box.dispose();
  const letter = h('button.as-int-prop', { 'aria-label': '剧本杀', style: 'left:59%;top:24%;width:31%;--r:-7deg', onclick: () => toast('剧本杀还没开放') }, img('letter'));
  const map = h('button.as-int-prop', { 'aria-label': 'DND', style: 'left:56%;top:40%;width:37%;--r:17deg', onclick: () => toast('DND 还没开放') }, img('map'));
  const tag = h('span.as-int-tag');
  const files = h('button.as-int-prop', { 'aria-label': '选本', style: 'left:21%;top:41%;width:28%;--r:4deg', onclick: () => scenarioSheet(syncTag) }, img('files'), tag);
  const syncTag = () => { const sc = R.SCENARIOS.find(s => s.id === pick.scenario); tag.textContent = sc ? sc.title : pick.ask ? pick.ask.slice(0, 8) : '随机生成'; };
  syncTag();
  // 椅子：点空椅子请人坐，点坐着的人让他起身
  const chairs = Array.from({ length: SEATS }, (_, i) => {
    const seat = h('span.as-int-seat');
    const ch = h('button.as-int-prop.is-chair', { 'aria-label': '座位', style: `left:1%;top:${22 + i * 10}%;width:13%` , onclick: async () => {
      const who = pick.party[i];
      if (who) { if (await actionSheet(nameOf(contact(who)), [{ value: 'up', label: '起身' }]) === 'up') { pick.party[i] = null; paintSeats(); } return; }
      const free = state.contacts.filter(c => !pick.party.includes(c.id));
      if (!free.length) { toast('联系人都上桌了'); return; }
      const v = await actionSheet('谁坐这把椅子', free.map(c => ({ value: c.id, label: nameOf(c) })));
      if (v) { pick.party[i] = v; paintSeats(); }
    } }, img('chair'), seat);
    return { el: ch, seat };
  });
  const paintSeats = () => chairs.forEach(({ seat }, i) => { const c = contact(pick.party[i]); seat.replaceChildren(c ? avatar(c.avatar, nameOf(c), 30) : ''); seat.classList.toggle('is-on', !!c); });
  pick.party = pick.party.map(id => contact(id) ? id : null); paintSeats();
  // 托盘里的小物件：拿起哪件，就按它车卡
  const tokens = R.TOKENS.map(([k, name]) => h('button.as-int-token' + (pick.token === k ? '.is-on' : ''), { 'aria-label': name, onclick: e => {
    pick.token = pick.token === k ? '' : k; [...e.currentTarget.parentNode.children].forEach(x => x.classList.toggle('is-on', x === e.currentTarget)); } }, img('tk-' + k)));
  const trayEl = h('div.as-int-prop.is-tray', { style: 'left:14%;top:59%;width:76%' }, img('tray'), h('div.as-int-tokens', tokens));
  // 火漆印章：开局 / 继续
  const sealT = h('span'), seal = h('button.as-int-prop.is-seal', { 'aria-label': '开局', style: 'left:41%;top:85%;width:18%', onclick: () => {
    const g = G.current();
    if (g) { playPage(g); return; }
    if (!pick.token) { toast('先从托盘里拿一件东西'); return; }
    cardPage({ ...pick, party: pick.party.filter(Boolean) }, syncSeal);
  } }, img('seal'), sealT);
  const syncSeal = () => { sealT.textContent = G.current() ? '继续' : '开局'; };
  table.append(...chairs.map(c => c.el), tray, letter, map, files, trayEl, seal);
  G.load().then(syncSeal);
  p.el._onShow = syncSeal;
  if (state.apps.interlude.splash) splash(p.el);
  return p.el;
}

/* ---------- 开屏：打字机 → 火漆「啪」盖下来 → 淡出到桌子 ---------- */
function splash(host) {
  const lines = [`案件编号　No. ${1000 + Math.floor(Math.random() * 9000)}`, '正文暂停。', '以下发生的一切，不计入记忆。'];
  const ps = lines.map(() => h('p')), sealEl = h('div.as-int-splash__seal', img('seal'), serif('幕间'));
  const el = h('div.as-int-splash', h('button.as-int-splash__skip', { onclick: () => done() }, '跳过'), h('div.as-int-splash__paper', ...ps, sealEl));
  host.append(el);
  let t = 0, dead = false; const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  lines.forEach((s, i) => { t += 500; for (const ch of s) { const my = t; at(my, () => { ps[i].textContent += ch; }); t += 48; } t += 350; });
  at(t + 150, () => { sealEl.classList.add('is-down'); tick(); });
  at(t + 1900, () => { el.classList.add('is-out'); });
  at(t + 2500, done);
  function done() { if (dead) return; dead = true; timers.forEach(clearTimeout); el.remove(); }
}
let actx = null;
function tick() {
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

/* ---------- 车卡：一张牛皮纸档案表 ---------- */
function cardPage(setup, back) {
  const p = page({ app: 'interlude', id: 'int-card', title: '调查员', large: true, back: true, cls: 'as-int-card' });
  p.el.prepend(h('div.as-int-bg', img('sheet')));
  const tk = R.TOKENS.find(t => t[0] === setup.token);
  let attrs = null, manual = false, g = null;
  const nameI = input({ placeholder: '名字', onInput: v => { setup.name = v.trim(); } }), jobI = input({ placeholder: '职业', onInput: v => { setup.job = v.trim(); } });
  const top = h('div.as-int-card__top', field('名字', nameI), field('职业', jobI), h('div.as-int-card__tk', img('tk-' + setup.token), tk[1]));
  const cells = Object.fromEntries(R.ATTRS.map(([k, n]) => [k, h('div.as-int-attr', h('small', n), h('b', '—'))]));
  const derivedEl = h('div.as-int-card__derived');
  const paintAttrs = () => { R.ATTRS.forEach(([k]) => { cells[k].lastChild.textContent = attrs ? attrs[k] : '—'; }); const d = attrs && R.derived(attrs); derivedEl.textContent = d ? `血 ${d.hp} · 理智 ${d.san} · 魔法 ${d.mp} · 闪避 ${Math.floor(attrs.DEX / 2)}` : ''; };
  const rollB = btn('掷骰子', 'primary', async () => {
    const r = R.d100(); await rollOverlay(p.el, r.t, r.u, '掷属性');
    attrs = R.rollAttrs(); manual = false; paintAttrs(); grid.classList.remove('is-manual'); startB.disabled = false;
  });
  const handB = btn('自己填', 'secondary', () => {
    manual = true; attrs = attrs || Object.fromEntries(R.ATTRS.map(([k]) => [k, 50])); paintAttrs(); grid.classList.add('is-manual'); startB.disabled = false;
    R.ATTRS.forEach(([k]) => { const b = cells[k].lastChild; b.contentEditable = 'true'; b.inputMode = 'numeric'; b.onblur = () => { attrs[k] = Math.max(1, Math.min(99, parseInt(b.textContent, 10) || 50)); paintAttrs(); }; });
  });
  const grid = h('div.as-int-attrs', ...R.ATTRS.map(([k]) => cells[k]));
  const skillsEl = h('div.as-int-card__skills', '开局后由 KP 分配'), bgEl = h('div.as-int-card__bg');
  const who = h('div.as-int-card__who', avatar(myAvatar(), myName(), 28), ...setup.party.map(id => { const c = contact(id); return avatar(c.avatar, nameOf(c), 28); }));
  const startB = btn('开局', 'primary', async () => {
    if (g) { castRoll(p.el, g).then(() => { nav.pop(); playPage(g); }); return; }
    if (G.running()) { G.cancel(); return; }
    const old = startB.textContent; startB.replaceChildren(h('span.as-spin')); toast('KP 在写这一局…', { label: '取消', fn: G.cancel, wait: true });
    try {
      g = await G.start({ ...setup, attrs });
      nameI.value = g.pc.name; jobI.value = g.pc.job; nameI.disabled = jobI.disabled = true;
      skillsEl.replaceChildren(...Object.entries(g.pc.skills).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => h('span', `${k} ${v}`)));
      bgEl.textContent = g.pc.bg; rollB.disabled = handB.disabled = true; grid.classList.remove('is-manual');
      startB.textContent = '入戏'; toast(`《${g.title}》写好了`); back();
    } catch (e) {
      startB.textContent = old;
      if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', '开局失败：' + e.message, e); toast('没开成：' + e.message); }
    }
  });
  startB.disabled = true;
  p.body.append(h('div.as-int-card__photo', avatar(myAvatar(), myName(), 96, 'square')), top,
    h('div.as-int-card__attrs', grid, derivedEl), h('div.as-int-card__roll', rollB, handB), skillsEl, h('div.as-int-card__foot', who, bgEl),
    h('div.as-int-card__bar', startB));
  nav.push(p.el);
}

/** 抛骰子的大画面：盖在页面上，抛完停一下 */
function rollOverlay(host, t, u, caption, result) {
  return new Promise(res => {
    const cap = h('p.as-int-roll__cap', caption || ''), el = h('div.as-int-roll', { 'data-no-swipe': '' }, h('div.as-int-roll__host'), cap);
    host.append(el);
    const box = diceBox(el.firstChild, { view: 9 });
    const done = () => { box.dispose(); el.classList.add('is-out'); setTimeout(() => { el.remove(); res(); }, 260); };
    (box.ok ? box.roll(t, u) : Promise.resolve()).then(() => { if (result) cap.textContent = result; el.classList.add('is-done'); el.onclick = done; setTimeout(done, result ? 2200 : 700); });
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
  let shown = g.place;
  const scene = k => { if (k === shown) return; shown = k; const n = new Image(); n.src = sceneSrc(k); n.decode().catch(() => {}).then(() => { n.classList.add('is-in'); bg.append(n); setTimeout(() => { bg.firstChild !== n && bg.firstChild.remove(); }, 900); }); };
  // 顶上的状态：第几幕、第几回合、血、理智
  const hud = h('div.as-int-hud'), hudAct = h('span'), hudHp = h('span'), hudSan = h('span'), hudMad = h('span.is-mad');
  const push = btn('推进', 'secondary', () => send('（推进剧情）'));
  hud.append(hudAct, hudHp, hudSan, hudMad, push);
  const paintHud = () => { hudAct.textContent = `第 ${g.act + 1}/${g.sk.acts.length} 幕 · 第 ${g.round} 回合`; hudHp.textContent = `♥ ${g.pc.hp}/${g.pc.hpMax}`; hudSan.textContent = `◈ ${g.pc.san}/${g.pc.sanMax}`; hudMad.textContent = g.pc.mad ? g.pc.mad.name : ''; };
  // 人物牌 + 对话框
  const face = h('div.as-int-who__face'), nameT = h('span.as-int-who__name'), who = h('div.as-int-who', face, nameT);
  const text = h('p'), more = h('span.as-int-box__more', '▸'), box = h('div.as-int-box', { onclick: () => next() }, text, more);
  const act = h('div.as-int-act'), stage = h('div.as-int-stage', { 'data-no-swipe': '' }, who, box, act);
  p.body.append(hud, stage);
  let queue = [], pending = '';   // 还没念到的台词；掷完骰子等着一起发给 KP 的结果
  const faceOf = n => { if (n === 'KP') return img('kp'); if (n === myName()) return avatar(myAvatar(), myName(), 110, 'square'); const m = g.party.find(x => x.name === n), c = m && contact(m.id); return c ? avatar(c.avatar, nameOf(c), 110, 'square') : h('span.as-int-who__none', n.slice(0, 1)); };
  const say = l => { if (nameT.textContent !== l.who) { nameT.textContent = l.who; face.replaceChildren(faceOf(l.who)); } text.textContent = l.text; };
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
        await rollOverlay(p.el, r.r.t, r.r.u, label, r.text);
        pending = r.text; g.req = { type: 'free' }; say({ who: 'KP', text: r.text }); prompt();
      })));
      return;
    }
    if (q.type === 'choose' && Array.isArray(q.options)) act.append(h('div.as-int-opts', q.options.slice(0, 4).map(o => btn(String(o), 'secondary', () => send(String(o))))));
    const ta = textarea({ rows: 1, placeholder: pending ? '再说点什么（可不填）' : '你做什么、说什么' });
    const dice = h('button.as-int-dicebtn', { 'aria-label': '主动掷骰', onclick: async () => {
      const sk = await actionSheet('掷什么', Object.entries(g.pc.skills).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ value: k, label: `${k} ${v}` })));
      if (!sk) return;
      const r = G.resolve(g, { type: 'check', skill: sk, level: '普通' }); await rollOverlay(p.el, r.r.t, r.r.u, sk, r.text);
      pending = [pending, r.text].filter(Boolean).join('；'); ta.placeholder = '再说点什么（可不填）';
    } }, '🎲');
    act.append(h('div.as-int-input', dice, ta, btn('发送', 'primary', () => send(ta.value.trim()))));
  }
  async function send(what) {
    if (G.running()) { G.cancel(); return; }
    const inp = [pending, what].filter(Boolean).join('；') || '（什么都没做，让 KP 继续）'; pending = '';
    act.replaceChildren(h('div.as-int-wait', h('span.as-spin'), '　KP 在想…', btn('取消', 'secondary', G.cancel)));
    try {
      const lines = await (inflight = G.play(g, inp));
      scene(g.place); paintHud(); show(lines);
    } catch (e) {
      if (e.message === '已中止') toast('已取消'); else { if (!e.logId) log('error', '幕间', '这回合失败：' + e.message, e); toast('这回合没写成：' + e.message); }
      prompt();
    }
  }
  const ending = () => h('div.as-int-end', h('b', g.done.kind === 'good' ? '——终' : '——完'), h('p', g.done.text), btn('回到桌上', 'primary', () => nav.pop()));
  paintHud();
  if (G.running(g)) {   // 上次退出时 KP 还在想：接着等那一次
    act.hidden = false; act.append(h('div.as-int-wait', h('span.as-spin'), '　KP 在想…', btn('取消', 'secondary', G.cancel))); say({ who: 'KP', text: '…' });
    inflight.then(lines => { scene(g.place); paintHud(); show(lines); }, () => prompt());
  } else show(g.log.filter(l => l.r === g.round && !l.me));
  nav.push(p.el);
}
