// 电台：兔子洞里的书店，角色给你讲故事（需求见 docs/pages-music.md 八·五）。
// 每一期是一本书：{ id, who, title, lang, src: 'ai' | 'lib' | 'mine', lib, segs: [{ t, tr }], after: [{ t, tr }] | null, pos, at }
// 书跟着酒馆聊天窗口走，存在 kv 的 radio:窗口；每段合成好的声音存在 radio:a:书:段，重听不再花钱。不进记忆、不发给酒馆。
// 声音都走一个 AudioContext：故事一段接一段、白噪音垫在底下，切到后台也能接着放下一段（新开 <audio> 在后台会被拦）。
import { h, uid, clamp, pickFile, onLongPress, debounce } from '../../core/util.js';
import { state, win, commit, contact, kvGet, kvSet, kvDel, kvKeys, chatForContact, getMsgs } from '../../core/store.js';
import { page, navBtn, actionSheet, dialog, toast, sheet, avatar, segmented, slider, switchEl, group, item, icon, input, textarea, btn, toggleItem } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName } from '../../core/promptstore.js';
import { speakAs } from '../../core/voice.js';
import { storyText, worldText } from '../../core/context.js';
import { memoryFor } from '../../core/memory.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { isNight } from './rain.js';
import { styleChoir } from './tglook.js';
import { langName } from '../../core/translate.js';
import LIB from './radiolib.js';

const S = () => state.music.radio || (state.music.radio = { voice: 'role', tts: 'ahead', say: true, len: 'mid', vol: {} });
// 语言用聊天设置里的写法（core/translate.js 的 LANGS：zh-CN、ja、en…）
const isZh = l => /^zh/.test(l), same = (a, b) => a === b || isZh(a) && isZh(b), lname = l => langName(isZh(l) ? 'zh-CN' : l);
const LEN = { short: '三四百字左右（按中文算）', mid: '七八百字左右（按中文算）', long: '一千五百字左右（按中文算）' };
const real = c => c.name || c.nick || c.remark;
const subs = new Set(), tell = () => subs.forEach(f => f());

/* ---------- 这个窗口的书 ---------- */
let D = null, Dkey = null;
async function load() {
  if (D && Dkey === win.key) return D;
  const k = win.key, d = await kvGet('radio:' + k).catch(() => null);
  if (k !== win.key) return load();
  D = Object.assign({ books: [], who: '' }, d); Dkey = k;
  return D;
}
const save = () => kvSet('radio:' + Dkey, D).catch(e => toast('没存上：' + e.message));
const cur = () => D.who === 'all' ? null : contact(D.who) || state.contacts[0] || null;
const textLang = t => /[぀-ヿ]/.test(t) ? 'ja' : /[가-힯]/.test(t) ? 'ko' : (t.match(/[a-z]/gi) || []).length > (t.match(/[一-鿿]/g) || []).length ? 'en' : 'zh-CN';
/** 角色讲故事用的语言：跟着和 TA 聊天的设置里「TA 的语言」，没设就是中文 */
const langOf = c => (chatForContact(c.id, false) || { cfg: {} }).cfg.theirLang || 'zh-CN';
const lines = b => [...b.segs, ...(b.after || [])];
const end = b => S().say ? lines(b).length : b.segs.length;

/* ---------- 文字：分段、读 AI 回的 ---------- */
const sents = t => t.match(/[^。！？!?….]+[。！？!?….」』”"'）)]*\s*|[^。！？!?….]+$/g) || [t];
/** 一段太长就按句子切成一百字以内的几段（念一段、翻一页） */
const paras = text => String(text).split(/\n+/).map(s => s.trim()).filter(Boolean)
  .flatMap(p => sents(p).reduce((a, s) => { if (a.length && (a[a.length - 1] + s).length <= 100) a[a.length - 1] += s; else a.push(s); return a; }, []).map(s => s.trim()).filter(Boolean));
const clean = raw => String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
/** 一行一段，下面 >> 开头的是它的中文翻译 */
const segsOf = text => clean(text).split('\n').map(l => l.trim()).filter(Boolean).reduce((a, l) => {
  if (l.startsWith('>>')) { if (a.length) a[a.length - 1].tr = l.replace(/^>>\s*/, ''); } else a.push({ t: l.replace(/^\[\d+\]\s*/, ''), tr: '' });
  return a;
}, []);
const zhLine = lang => isZh(lang) ? '' : '每段下面另起一行，用 >> 开头写这一段的中文翻译。';
const ask = (c, prompt, maxTokens, stop) => generate({ conn: resolveConn('text', 'chat'), system: '', app: '电台', maxTokens, stop, prompt }).then(clean);

/** 让角色讲一个：故事 + 中文翻译 + 感想，一次 API */
async function compose1(c, what, recall, stop) {
  const lang = langOf(c);
  let about = '';
  if (recall) {
    const story = storyText(), chat = chatForContact(c.id, false), msgs = chat ? (await getMsgs(chat.id)).filter(m => !m.recalled && m.text).slice(-30) : [];
    const scan = story + '\n' + msgs.map(m => m.text).join('\n');
    about = [`【最近的剧情】\n${story || '（暂无）'}`, msgs.length && `【手机里最近的聊天】\n${msgs.map(m => `${m.from === 'me' ? myName() : real(c)}：${m.text}`).join('\n')}`,
      await worldText(scan).catch(() => ''), await memoryFor([c], scan).catch(() => '')].filter(Boolean).join('\n\n');
  }
  const raw = await ask(c, compose('radioStory', { char: real(c), persona: personaOf(c) || '（没有更多资料）', recall: about, ask: what, lang: lname(lang), len: LEN[S().len], zh: zhLine(lang) }), 8000, stop);
  const title = ((raw.match(/^\s*标题[:：]\s*(.+)$/m) || [])[1] || '').replace(/^[《「『【]|[》」』】]$/g, '').trim();
  const [head, rest] = raw.split(/^\s*故事[:：]\s*/m), [story, after = ''] = (rest ?? head.replace(/^\s*标题[:：].*$/m, '')).split(/^\s*感想[:：]\s*/m);
  const segs = segsOf(story);
  if (!segs.length) throw new Error('AI 回的格式不对');
  return { id: uid('rb'), who: c.id, title: title || segs[0].t.slice(0, 10), lang, src: 'ai', segs, after: segsOf(after), pos: 0, at: Date.now() };
}
/** 书店的老故事、导入的文字：翻成 lang（原文就是 lang 的话只配中文翻译） */
async function trans(c, ps, from, lang, stop) {
  const onlyZh = same(from, lang), raw = await ask(c, compose('radioTrans', { char: real(c), lang: lname(onlyZh ? 'zh-CN' : lang),
    zh: onlyZh || isZh(lang) || isZh(from) ? '' : zhLine(lang), tale: ps.map((p, i) => `[${i + 1}] ${p}`).join('\n') }), 8000, stop);
  const out = segsOf(raw);
  if (!out.length) throw new Error('AI 回了空的');
  if (onlyZh) return ps.map((t, i) => ({ t, tr: (out[i] || {}).t || '' }));
  return isZh(from) ? out.map((s, i) => ({ t: s.t, tr: ps[i] || '' })) : out;
}
async function thoughts(b, stop) {
  const c = contact(b.who);
  if (!c) throw new Error('这个角色已经不在联系人里了');
  const out = segsOf(await ask(c, compose('radioAfter', { char: real(c), persona: personaOf(c) || '（没有更多资料）', title: b.title,
    tale: b.segs.map(s => s.t).join('\n').slice(0, 8000), lang: lname(b.lang), zh: zhLine(b.lang) }), 2400, stop));
  if (!out.length) throw new Error('AI 回了空的');
  b.after = out; await save();
}

// 正在写的故事 / 翻译 / 感想：同一时间只有一个；退出再进来点，提示条还能取消
let job = null;
async function task(msg, fn) {
  if (job) return void toast(job.msg, { label: '取消', fn: () => job.ac.abort(), wait: true });
  const ac = new AbortController(); job = { ac, msg };
  toast(msg, { label: '取消', fn: () => ac.abort(), wait: true });
  try { return await fn(ac.signal); }
  catch (e) { if (ac.signal.aborted) toast('已取消'); else { if (!e.logId) log('error', '电台', e.message); toast('没写成：' + e.message); } }
  finally { job = null; }
}
async function made(b, msg) {
  D.books.push(b); await save(); toast(msg);
  tell(); if (scene && scene.isConnected && nav.top()?.el.contains(scene)) openBook(b);
}

/* ---------- 声音：一个 AudioContext，故事和白噪音都接在 master 上（定时关闭时一起慢慢变小） ---------- */
let ac = null, master = null;
function actx() {
  if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.connect(ac.destination); }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
const E = { book: null, i: 0, on: false, wait: false, src: null, buf: null, t0: 0, off: 0, run: 0, stop: null, warned: false };
const pend = new Map();
/** 第 i 段的声音：存过就拿存的；没有就用角色的声音合成一次存下来。用手机自带的声音、或者合成失败，返回空 */
async function voice(b, i) {
  if (S().voice !== 'role') return null;
  const k = `radio:a:${b.id}:${i}`, got = await kvGet(k).catch(() => null);
  if (got) return got;
  if (!pend.has(k)) pend.set(k, speakAs(b.who, lines(b)[i].t, { silent: true, cache: k, stop: (E.stop || (E.stop = new AbortController())).signal })
    .then(() => kvGet(k).catch(() => null)).finally(() => pend.delete(k)));
  return pend.get(k);
}
/** 按设置提前合成后面几段（一段一段来，停了就不再合成） */
async function ahead(b, i) {
  const n = Math.min(end(b), S().tts === 'all' ? Infinity : S().tts === 'ahead' ? i + 3 : i + 1);
  for (let j = i + 1; j < n && E.book === b && E.on; j++) await voice(b, j);
}
function halt() {
  if (E.src) { E.src.onended = null; E.src.stop(); E.src = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
async function playAt(i) {
  const b = E.book, run = ++E.run;
  actx(); halt(); E.buf = null; E.off = 0;
  if (i >= end(b)) return finish();
  E.i = b.pos = i; E.on = E.wait = true; tell();
  if (P.playing()) P.toggle();
  let buf = null;
  const blob = await voice(b, i);
  if (blob) try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); } catch (e) { log('warn', '电台', '这段声音放不了：' + e.message); }
  if (run !== E.run) return;
  E.wait = false;
  if (buf) { E.buf = buf; start(run); }
  else {
    if (S().voice === 'role' && !E.warned) { E.warned = true; toast('没合成出角色的声音，先用手机自带的声音念'); }
    say(run, lines(b)[i].t, b.lang);
  }
  tell(); save(); ahead(b, i);
}
function start(run) {
  const s = E.src = ac.createBufferSource();
  s.buffer = E.buf; s.connect(master); s.onended = () => { if (run === E.run && E.src === s) playAt(E.i + 1); };
  E.t0 = ac.currentTime - E.off; s.start(0, E.off);
}
function say(run, text, lang) {
  if (!('speechSynthesis' in window)) { toast('这个浏览器不能朗读'); return stopStory(); }
  const u = new SpeechSynthesisUtterance(text), L = isZh(lang) ? 'zh-CN' : lang, v = speechSynthesis.getVoices().find(x => x.lang.replace('_', '-').startsWith(L.slice(0, 2)));
  u.lang = L; if (v) u.voice = v;
  u.onend = () => { if (run === E.run && E.on) playAt(E.i + 1); };
  speechSynthesis.speak(u);
}
function pause() {
  if (E.src) { E.off = ac.currentTime - E.t0; E.src.onended = null; E.src.stop(); E.src = null; }
  else if (!E.buf) { E.run++; halt(); }
  E.on = E.wait = false; tell();
}
function resume() { if (E.buf) { actx(); E.on = true; start(E.run); if (P.playing()) P.toggle(); tell(); } else playAt(E.i); }
function finish() { halt(); E.on = E.wait = false; E.buf = null; E.i = E.book.pos = 0; tell(); save(); }
function stopStory() { E.run++; halt(); E.on = E.wait = false; E.buf = null; E.warned = false; if (E.stop) { E.stop.abort(); E.stop = null; } tell(); }

/* ---------- 白噪音：程序算出来的，不用下载录音 ---------- */
const NOISE = [['rain', '雨'], ['fire', '篝火'], ['wave', '海浪'], ['wind', '风'], ['bug', '虫鸣'], ['white', '白噪音'], ['pink', '粉噪音'], ['brown', '棕噪音']];
const live = {};
const vol = k => S().vol[k] ?? .5;
const rnd = () => Math.random() * 2 - 1;
function buf(sec, f) { const sr = 22050, b = ac.createBuffer(1, sec * sr, sr); f(b.getChannelData(0), sr); return b; }
const fill = { white: d => { for (let i = 0; i < d.length; i++) d[i] = rnd() * .35; },
  pink: d => { let a = 0, b = 0, c = 0; for (let i = 0; i < d.length; i++) { const w = rnd(); a = .99765 * a + w * .099046; b = .963 * b + w * .2965164; c = .57 * c + w * 1.0526913; d[i] = (a + b + c + w * .1848) * .18; } },
  brown: d => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + .02 * rnd()) / 1.02; d[i] = l * 3.2; } } };
/** 在 d 里随机撒 n 个很短的「啪」：雨点、柴火的噼啪 */
const pops = (d, sr, n, ms, amp) => { for (let k = 0; k < n; k++) { const at = Math.random() * d.length | 0, len = sr * ms[0] / 1e3 + Math.random() * sr * (ms[1] - ms[0]) / 1e3 | 0, a = amp * (.3 + Math.random() * .7);
  for (let i = 0; i < len && at + i < d.length; i++) d[at + i] += rnd() * a * Math.exp(-5 * i / len); } };
function noiseOn(k) {
  const c = actx(), g = c.createGain(), s = c.createBufferSource(), stop = [s];
  let out = s;
  const filt = (type, f, q = .7) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; out.connect(x); out = x; return x; };
  if (k === 'rain') { s.buffer = buf(6, (d, sr) => { fill.pink(d); pops(d, sr, 6 * 70, [2, 6], .5); }); filt('highpass', 500); }
  else if (k === 'fire') s.buffer = buf(8, (d, sr) => { fill.brown(d); for (let i = 0; i < d.length; i++) d[i] *= .6; pops(d, sr, 8 * 7, [2, 14], .9); });
  else if (k === 'wave') { s.buffer = buf(16, (d, sr) => { fill.brown(d); for (let i = 0; i < d.length; i++) d[i] *= .15 + .85 * Math.sin(Math.PI * i / sr / 8) ** 2; }); filt('lowpass', 900); }
  else if (k === 'wind') {
    s.buffer = buf(8, fill.pink); const bp = filt('bandpass', 600, .8), lfo = c.createOscillator(), dep = c.createGain();
    lfo.frequency.value = .08; dep.gain.value = 350; lfo.connect(dep); dep.connect(bp.frequency); lfo.start(); stop.push(lfo);
  }
  else if (k === 'bug') s.buffer = buf(6, (d, sr) => {   // 两只蟋蟀：一声三下「唧」，隔半秒多再叫
    for (const [f, a] of [[4300, .22], [4900, .12]]) for (let t = Math.random() * .5; t < 5.6; t += .55 + Math.random() * .5)
      for (let p = 0; p < 3; p++) { const at = (t + p * .05) * sr | 0, n = .028 * sr | 0; for (let i = 0; i < n && at + i < d.length; i++) d[at + i] += Math.sin(2 * Math.PI * f * i / sr) * Math.sin(Math.PI * i / n) * a; }
  });
  else s.buffer = buf(6, fill[k]);
  s.loop = true; g.gain.value = vol(k); out.connect(g); g.connect(master); s.start();
  live[k] = { g, stop };
}
function noise(k, on) {
  if (on && !live[k]) noiseOn(k);
  if (!on && live[k]) { live[k].stop.forEach(x => x.stop()); live[k].g.disconnect(); delete live[k]; }
  tell();
}
const saveVol = debounce(() => commit('music'), 600);
function noiseSheet() {
  sheet({ title: '白噪音', content: h('div.as-rd-noise', NOISE.map(([k, name], i) => h('div.as-rd-nrow', h('img', { src: `assets/radio/bottle${i + 1}.webp`, alt: '' }), h('span', name),
    slider({ value: vol(k), onInput: v => { S().vol[k] = v; if (live[k]) live[k].g.gain.value = v; saveVol(); } }), switchEl(!!live[k], on => noise(k, on), name)))) });
}

/* ---------- 定时关闭：到点慢慢变小声再停 ---------- */
let timer = null;
function setTimer(min) {
  if (timer) clearTimeout(timer.t);
  timer = min ? { end: Date.now() + min * 6e4, t: setTimeout(fade, min * 6e4) } : null; tell();
}
function fade() {
  timer = null; if (!ac) return tell();
  master.gain.setTargetAtTime(0, ac.currentTime, 2.5);
  setTimeout(() => { if (E.book) pause(); NOISE.forEach(([k]) => noise(k, false)); master.gain.cancelScheduledValues(ac.currentTime); master.gain.value = 1; }, 9000);
}
async function pickTimer() {
  const v = await actionSheet('定时关闭', [...[15, 30, 60].map(m => ({ value: m, label: `${m} 分钟` })), timer && { value: 0, label: '不定时' }].filter(Boolean));
  if (v != null) { setTimer(v); toast(v ? `${v} 分钟后慢慢停下` : '不定时了'); }
}

/* ---------- 书店：背景、飘着的小东西、书架（一本书一个书脊）、柜台上的怀表和瓶子 ---------- */
let scene = null, draws = 0;
const FALL = [[1, 33, 9, 0, 26], [4, 64, 3.6, 7, 21], [2, 27, 5, 13, 24], [7, 60, 6.5, 4, 30], [5, 47, 3.4, 18, 23], [3, 40, 4.6, 10, 28]];   // 第几个小东西、横着在哪、多宽、错开几秒、落一次几秒
const SPINES = [1, 2, 3, 4, 5, 6, 8];
const hash = s => [...s].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7) >>> 0;

export async function renderRadio(ctx) {
  const my = ++draws;
  await load();
  if (my !== draws || ctx.el.dataset.tab !== 'radio') return;
  const face = h('span.as-rd__face'), shelf = h('div.as-rd__shelf');
  const watch = h('button.as-rd__watch', { 'aria-label': '换人', onclick: pickWho }, h('img', { src: 'assets/radio/watch.webp', alt: '' }), face);
  const bottles = NOISE.map(([k, name], i) => {
    const b = h('button.as-rd__bottle', { 'aria-label': name, onclick: () => { noise(k, !live[k]); toast(live[k] ? name : `关掉${name}`); } }, h('img', { src: `assets/radio/bottle${i + 1}.webp`, alt: '' }));
    onLongPress(b, noiseSheet); return b;
  });
  const room = h('div.as-rd__room', { style: { backgroundImage: `url(assets/radio/bg-${isNight() ? 'night' : 'day'}.webp)` } },
    FALL.map(([n, x, w, t, s]) => h('img.as-rd__fall', { src: `assets/radio/prop${n}.webp`, alt: '', style: { left: x + '%', width: w + '%', animationDelay: -t + 's', animationDuration: s + 's' } })),
    watch, h('div.as-rd__bottles', bottles));
  scene = h('section.as-rd', room, shelf);
  ctx.body.append(scene); ctx.right.append(navBtn('more', '设置', settings));

  const paintWho = () => { const c = cur(); face.replaceChildren(c ? avatar(c.avatar, nameOf(c), 64) : icon('users', 30, 1.8)); ctx.title.textContent = c ? nameOf(c) : '所有人'; };
  function paintShelf() {
    const c = cur(), list = D.books.filter(b => !c || b.who === c.id).sort((a, b) => b.at - a.at);
    shelf.replaceChildren(h('button.as-rd__spine.is-add', { onclick: add }, h('img', { src: 'assets/radio/spine7.webp', alt: '' }), h('span', '＋ 讲一个')),
      ...list.map(b => { const n = hash(b.id), el = h('button.as-rd__spine', { dataset: { id: b.id }, style: { '--r': (n % 7 - 3) + 'deg', animationDelay: -(n % 50) / 10 + 's' }, onclick: () => openBook(b) },
        h('img', { src: `assets/radio/spine${SPINES[n % SPINES.length]}.webp`, alt: '' }), h('span', b.title));
      onLongPress(el, () => bookMenu(b)); return el; }));
    mark();
  }
  // 正在讲的那本亮着、开着的瓶子亮着：只换这几个的样子
  const mark = () => { [...shelf.children].forEach(el => el.classList.toggle('is-on', !!E.book && el.dataset.id === E.book.id && (E.on || E.wait)));
    bottles.forEach((b, i) => b.classList.toggle('is-on', !!live[NOISE[i][0]])); };
  let n = D.books.length, who = D.who;
  const f = () => { if (!scene.isConnected || scene.dataset.my !== String(my)) return subs.delete(f); if (D.books.length !== n || D.who !== who) { n = D.books.length; who = D.who; paintWho(); paintShelf(); } else mark(); };
  scene.dataset.my = my; subs.add(f);
  paintWho(); paintShelf();

  async function pickWho() {
    const v = await actionSheet('谁来讲', [...state.contacts.map(c => ({ value: c.id, label: nameOf(c), active: cur() === c })), { value: 'all', label: '所有人讲过的', active: D.who === 'all' }]);
    if (!v) return;
    D.who = v; save(); watch.classList.remove('is-tick'); void watch.offsetWidth; watch.classList.add('is-tick'); tell();
  }
}
const pickRole = async () => { const v = await actionSheet('谁来讲', state.contacts.map(c => ({ value: c.id, label: nameOf(c) }))); return v && contact(v); };
async function add() {
  const c = cur() || await pickRole();
  if (!c) return state.contacts.length || toast('先在聊天里加个联系人');
  const v = await actionSheet(`${nameOf(c)} 讲什么`, [{ value: 'rand', label: '随便讲一个' }, { value: 'ask', label: '想听什么' }, { value: 'lib', label: '书店里的老故事' }, { value: 'mine', label: '粘贴或导入' }]);
  if (v === 'rand') return tellNew(c, '随便讲一个：可以是你自己编的，也可以是各地的民间故事、寓言、童话。');
  if (v === 'lib') return libSheet(c);
  if (v === 'mine') return importSheet(c);
  if (v !== 'ask') return;
  const k = await actionSheet('想听什么', [['fairy', '童话'], ['day', '日常小事'], ['recall', '回忆你们之间的事'], ['sheep', '陪你数羊'], ['own', '自己写…']].map(([value, label]) => ({ value, label })));
  const me = myName(), own = k === 'own' && ((await dialog({ title: '想听什么', input: { placeholder: '想听什么' } })) || '').trim();
  const what = { fairy: '讲一个童话。', day: '讲一件你自己的日常小事，像睡前聊天一样。', recall: `回忆一件你和 ${me} 之间真实发生过的事，从你的角度讲，只讲真发生过的，不编造。`,
    sheep: `陪 ${me} 数羊、哄 TA 睡觉：声音轻、节奏慢，一只一只地数，中间夹几句轻轻的话。`, own: `讲一个故事：${own}` }[k];
  if (what && (k !== 'own' || own)) tellNew(c, what, k === 'recall');
}
const tellNew = (c, what, recall) => task(`${nameOf(c)} 在想故事…`, async stop => made(await compose1(c, what, recall, stop), '讲好了'));
function libSheet(c) {
  const L = langOf(c), order = [...new Set(LIB.map(x => x.lang))].sort((a, b) => same(b, L) - same(a, L));
  const s = sheet({ title: '书店里的老故事', content: order.map(l => group(lname(l), LIB.filter(x => x.lang === l).map(x => item({ title: x.title, sub: x.from, chevron: true, onClick: () => { s.close(); fromLib(c, x); } })))) });
}
async function fromLib(c, x) {
  const L = langOf(c), had = D.books.find(b => b.who === c.id && b.lib === x.id && same(b.lang, L));
  if (had) return openBook(had);
  const ps = paras(x.text), key = `radio:lib:${x.id}:${L}`;   // 翻好的存一份，别的角色、别的窗口再挑同一本不再花钱
  const make = segs => made({ id: uid('rb'), who: c.id, title: x.title, lang: L, src: 'lib', lib: x.id, segs, after: null, pos: 0, at: Date.now() }, `《${x.title}》放上书架了`);
  if (isZh(L) && isZh(x.lang)) return make(ps.map(t => ({ t, tr: '' })));
  const got = await kvGet(key).catch(() => null);
  if (got) return make(got);
  task(`${nameOf(c)} 在翻《${x.title}》…`, async stop => { const segs = await trans(c, ps, x.lang, L, stop); await kvSet(key, segs).catch(() => {}); await make(segs); });
}
function importSheet(c) {
  const t = input({ placeholder: '书名' }), body = textarea({ placeholder: '故事', rows: 8 });
  const s = sheet({ title: '粘贴或导入', content: h('div.as-rd-imp', t, body, h('div.as-rd-imp__row',
    btn('导入文件', 'secondary', async () => { const f = await pickFile('.txt,.md,text/plain,text/markdown'); if (!f) return; body.value = await f.text(); body.dispatchEvent(new Event('input')); if (!t.value) t.value = f.name.replace(/\.\w+$/, ''); }),
    btn('好了', 'primary', () => { const ps = paras(body.value); if (!ps.length) return toast('还没有字'); s.close(); fromText(c, t.value.trim() || ps[0].slice(0, 12), ps); }))) });
}
async function fromText(c, title, ps) {
  const from = textLang(ps.join('')), L = langOf(c);
  const make = (segs, lang) => made({ id: uid('rb'), who: c.id, title, lang, src: 'mine', segs, after: null, pos: 0, at: Date.now() }, `《${title}》放上书架了`);
  const v = same(from, L) ? isZh(L) ? 'raw' : await actionSheet('要中文翻译吗', [{ value: 'to', label: '配中文翻译（用一次 API）' }, { value: 'raw', label: '不用翻译' }])
    : await actionSheet(`原文是${lname(from)}`, [{ value: 'to', label: `让 TA 翻成${lname(L)}讲（用一次 API）` }, { value: 'raw', label: '照原文念' }]);
  if (v === 'raw') return make(ps.map(t => ({ t, tr: '' })), from);
  if (v === 'to') task(`${nameOf(c)} 在翻《${title}》…`, async stop => make(await trans(c, ps, from, L, stop), L));
}
async function bookMenu(b) {
  if (await actionSheet(b.title, [{ value: 'del', label: '删除', danger: true }]) === 'del') delBook(b);
}
async function delBook(b) {
  if (!(await dialog({ title: `删除《${b.title}》？`, text: '合成好的声音也一起删掉', confirm: '删除', danger: true }))) return false;
  if (E.book === b) { stopStory(); E.book = null; }
  D.books = D.books.filter(x => x !== b); await save(); tell();
  for (const k of await kvKeys().catch(() => [])) if (String(k).startsWith(`radio:a:${b.id}:`)) await kvDel(k).catch(() => {});
  return true;
}
function settings() {
  const set = (k, v) => { S()[k] = v; commit('music'); };
  sheet({ title: '电台设置', content: h('div.as-rd-set',
    group('用谁的声音', [segmented([['role', '角色的声音'], ['phone', '手机自带的']], S().voice, v => set('voice', v))]),
    group('', [toggleItem({ title: '念感想' }, S().say, v => set('say', v))]),
    group('随便讲的长短', [segmented([['short', '短'], ['mid', '中'], ['long', '长']], S().len, v => set('len', v))])) });
}

/* ---------- 读书：书摊开（左页这一段、右页下一段，都只放中文）；书下面像一起听，TA 的头像 + 气泡里是正在念的原文和翻译；按钮都在最底下 ---------- */
const TTS = [['lazy', '点到才合成'], ['ahead', '提前合成两段'], ['all', '一次合成完']];
function openBook(b) {
  if (E.book !== b) { stopStory(); E.book = b; E.i = Math.min(b.pos || 0, lines(b).length - 1); }
  const c = contact(b.who) || {};
  const more = async () => { const v = await actionSheet(b.title, [{ value: 'set', label: '设置' }, { value: 'del', label: '删除', danger: true }]); if (v === 'set') settings(); if (v === 'del' && await delBook(b)) nav.back(); };
  const p = page({ app: 'music', id: 'radio-read', title: b.title, cls: 'as-rd-read.is-dark', right: navBtn('more', '更多', more) });
  const L = h('div.as-rd-pg'), R = h('div.as-rd-pg.is-r'), count = h('div.as-rd-count'), playB = h('button.as-rd-play', { 'aria-label': '播放 / 暂停', onclick: toggle });
  const sayT = h('span'), sayTr = h('span'), sayP = h('p', sayT, h('small', sayTr)), row = h('div.as-ch.is-said.is-cur', avatar(c.avatar, nameOf(c), 34), sayP);
  const afterB = h('button', { onclick: () => task(`${nameOf(c)} 在想感想…`, async stop => { await thoughts(b, stop); toast('想好了'); tell(); }) }, '说说感想');
  const timerB = h('button', { onclick: pickTimer }), ttsB = h('button', { onclick: async () => {
    const v = await actionSheet('什么时候合成', TTS.map(([value, label]) => ({ value, label, active: S().tts === value })));
    if (v) { S().tts = v; commit('music'); ttsB.textContent = TTS.find(x => x[0] === v)[1]; if (E.on) ahead(b, E.i); }
  } }, TTS.find(x => x[0] === S().tts)[1]);
  p.el.style.backgroundImage = `linear-gradient(rgba(12,10,24,.6), rgba(12,10,24,.78)), url(assets/radio/bg-${isNight() ? 'night' : 'day'}.webp)`;
  const book = h('div.as-rd-book', { 'data-no-swipe': '' }, h('img', { src: 'assets/radio/book.webp', alt: '' }), L, R);
  p.body.append(book, h('div.as-rd-say', row),
    h('div.as-rd-bottom', count, h('div.as-rd-tools', timerB, h('button', { onclick: noiseSheet }, '白噪音'), ttsB, afterB),
      h('div.as-rd-ctl', h('button', { 'aria-label': '上一段', onclick: () => go(E.i - 1) }, icon('prev', 24, 2)), playB, h('button', { 'aria-label': '下一段', onclick: () => go(E.i + 1) }, icon('next', 24, 2)))));
  styleChoir(row, b.who, false);
  function toggle() { if (E.on || E.wait) pause(); else resume(); }
  function go(i) { i = clamp(i, 0, lines(b).length - 1); if (E.on || E.wait) playAt(i); else { E.run++; halt(); E.i = b.pos = i; E.buf = null; E.off = 0; tell(); } }
  const zh = s => s ? s.tr || s.t : '';
  const left = i => [i >= b.segs.length && i < lines(b).length ? h('small', '感想') : '', h('p', zh(lines(b)[i]))], right = i => [h('p.is-next', zh(lines(b)[i]))];
  const pages = i => { L.replaceChildren(...left(i)); R.replaceChildren(...right(i + 1)); };
  // 翻页：dir 1 是右页绕书脊翻到左边（下一段），-1 是左页翻回右边（上一段）；i 是翻之前那一段。底下露出来的那页先换好
  let leaf = null, drag = null;
  function lift(dir, i) {
    const f = (side, kids) => h('div.is-' + side, h('div.as-rd-pg', kids));
    leaf = dir > 0 ? h('div.as-rd-leaf', f('r', right(i + 1)), f('l', left(i + 1))) : h('div.as-rd-leaf.is-back', f('l', left(i)), f('r', right(i)));
    leaf.dir = dir; leaf.deg = 0; leaf.style.transition = 'none';
    if (dir > 0) R.replaceChildren(...right(i + 2)); else L.replaceChildren(...left(i - 1));
    book.append(leaf);
  }
  const bend = deg => { leaf.deg = deg; leaf.style.transform = `rotateY(${leaf.dir > 0 ? -deg : deg}deg)`; };
  function settle(deg) {
    const el = leaf; el.busy = true; el.style.transition = ''; void el.offsetWidth; bend(deg);
    setTimeout(() => { el.remove(); if (leaf === el) leaf = null; pages(E.i); }, 460);
  }
  // 手指拖着翻：往左拖翻下一页、往右拖翻上一页，松手时翻过 60° 就翻过去，不然落回去
  book.onpointerdown = e => { if (!leaf) drag = { x: e.clientX, w: book.clientWidth / 2 }; };
  book.onpointermove = e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.dir) {
      if (Math.abs(dx) < 8) return;
      const dir = dx < 0 ? 1 : -1;
      if (dir > 0 ? E.i + 1 >= lines(b).length : E.i <= 0) { drag = null; return; }
      drag.dir = dir; book.setPointerCapture(e.pointerId); lift(dir, E.i);
    }
    bend(clamp(-dx * drag.dir / drag.w * 180, 0, 180));
  };
  book.onpointerup = book.onpointercancel = () => {
    const d = drag; drag = null;
    if (d && d.dir) { if (leaf.deg > 60) go(E.i + d.dir); else settle(0); }
  };
  let shown = -1, nlines = -1;
  function paint() {
    if (!p.el.isConnected) return subs.delete(paint);
    const all = lines(b);
    if (E.book !== b) return;
    if (shown !== E.i || nlines !== all.length) {
      const s = all[E.i], d = E.i - shown, last = shown;
      if (leaf && !leaf.busy && leaf.dir === d) settle(180);   // 手指翻过去了
      else if (!leaf && last !== -1 && Math.abs(d) === 1) { lift(d, last); settle(180); }   // 念到下一段、点上一段 / 下一段：自己翻
      else { if (leaf) { leaf.remove(); leaf = null; } pages(E.i); }
      shown = E.i; nlines = all.length;
      sayT.textContent = s.t; sayTr.textContent = s.tr; sayTr.parentNode.hidden = !s.tr;
      if (last !== -1) { row.classList.remove('is-turn'); void row.offsetWidth; row.classList.add('is-turn'); }
    }
    count.textContent = `${E.i + 1} / ${all.length}`;
    playB.replaceChildren(E.wait ? h('span.as-spin') : icon(E.on ? 'pause' : 'play', 26, 2.4));
    afterB.hidden = !!b.after;
  }
  // 气泡里的字跟着声音一点点变色（像一起听的歌词）；手机自带的声音不知道多长，念着就整段亮
  const tick = () => {
    if (!p.el.isConnected) return clearInterval(iv);
    const tl = timer ? `${Math.ceil((timer.end - Date.now()) / 6e4)} 分钟后停` : '定时';
    if (timerB.textContent !== tl) timerB.textContent = tl;
    const mine = E.book === b, k = mine && E.buf ? ((E.src ? ac.currentTime - E.t0 : E.off) / E.buf.duration) : mine && E.on && !E.wait ? 1 : 0;
    row.style.setProperty('--p', Math.min(100, k * 100).toFixed(1) + '%');
  };
  const iv = setInterval(tick, 200);
  nav.push(p.el); subs.add(paint); paint(); tick();
}
