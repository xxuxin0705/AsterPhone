// 电台：兔子洞里的书店，角色给你讲故事（需求见 docs/pages-music.md 八·五）。
// 每一期是一本书：{ id, who, title, lang, src: 'ai' | 'lib' | 'mine', lib, segs: [{ t, tr }], after: [{ t, tr }] | null, vers: { 语言: { segs, after } }, pos, at }
// 书跟着酒馆聊天窗口走，存在 kv 的 radio:窗口；每段合成好的声音存在 radio:a:书:语言:段，重听不再花钱。不进记忆、不发给酒馆。
// 声音都走一个 AudioContext：故事一段接一段、白噪音垫在底下，切到后台也能接着放下一段（新开 <audio> 在后台会被拦）。
import { h, uid, clamp, pickFile, onLongPress, debounce } from '../../core/util.js';
import { state, win, commit, contact, kvGet, kvSet, kvDel, kvKeys, chatForContact, getMsgs } from '../../core/store.js';
import { page, navBtn, actionSheet, dialog, toast, sheet, avatar, segmented, slider, switchEl, group, item, icon, input, textarea, btn, toggleItem, busy } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName } from '../../core/promptstore.js';
import { speakAs, connFor, voiceOf } from '../../core/voice.js';
import { storyText, worldText } from '../../core/context.js';
import { memoryFor } from '../../core/memory.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { isNight } from './rain.js';
import { color, font, setFont } from './tglook.js';
import { glass } from '../../core/glass.js';
import { plain, PRESETS, groupsFor, kindOf, hintFor } from '../../core/act.js';
import { translate } from '../../core/translate.js';
import { LANGS as ALL_LANGS, langName } from '../../core/translate.js';
import LIB from './radiolib.js';

const S = () => state.music.radio || (state.music.radio = { tts: 'ahead', say: true, len: 'mid', vol: {} });
// 语言用聊天设置里的写法（core/translate.js 的 LANGS：zh-CN、ja、en…）
const isZh = l => /^zh/.test(l), same = (a, b) => a === b || isZh(a) && isZh(b), lname = l => langName(isZh(l) ? 'zh-CN' : l);
const TTS = [['lazy', '点到才合成'], ['ahead', '提前合成两段'], ['all', '一次合成完']];
const LEN = { short: '三四百字左右（按中文算）', mid: '七八百字左右（按中文算）', long: '一千五百字左右（按中文算）' };
const real = c => c.name || c.nick || c.remark;
const subs = new Set(), tell = () => subs.forEach(f => f());

/* ---------- 这个窗口的书 ---------- */
let D = null, Dkey = null;
async function load() {
  if (D && Dkey === win.key) return D;
  const k = win.key, d = await kvGet('radio:' + k).catch(() => null);
  if (k !== win.key) return load();
  D = Object.assign({ books: [], who: '', lang: {} }, d); Dkey = k;
  return D;
}
const save = () => kvSet('radio:' + Dkey, D).catch(e => toast('没存上：' + e.message));
const cur = () => D.who === 'all' ? null : contact(D.who) || state.contacts[0] || null;
const textLang = t => /[぀-ヿ]/.test(t) ? 'ja' : /[가-힯]/.test(t) ? 'ko' : (t.match(/[a-z]/gi) || []).length > (t.match(/[一-鿿]/g) || []).length ? 'en' : 'zh-CN';
/** 角色讲故事用的语言：在「讲什么」里换过就用换的；没换过跟着和 TA 聊天的设置里「TA 的语言」（只有打开了「发送前翻成 TA 的语言」才算数，
 *  不然那一格是新建聊天时默认填的英语，不是谁选的）；都没有就是中文 */
const langOf = c => { const cfg = (chatForContact(c.id, false) || { cfg: {} }).cfg; return D.lang[c.id] || (cfg.sendTr && cfg.theirLang) || 'zh-CN'; };
const lines = b => [...b.segs, ...(b.after || [])];
const end = b => S().say ? lines(b).length : b.segs.length;

/* ---------- 文字：分段、读 AI 回的 ---------- */
const sents = t => t.match(/[^。！？!?….]+[。！？!?….」』”"'）)]*\s*|[^。！？!?….]+$/g) || [t];
/** 一段太长就按句子切成一百字以内的几段（念一段、翻一页） */
const paras = text => String(text).split(/\n+/).map(s => s.trim()).filter(Boolean)
  .flatMap(p => sents(p).reduce((a, s) => { if (a.length && (a[a.length - 1] + s).length <= 100) a[a.length - 1] += s; else a.push(s); return a; }, []).map(s => s.trim()).filter(Boolean));
const clean = raw => String(raw).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
/** 一行一段，下面 >> 开头的是它的中文翻译；段里带 [语气] 标签的原样留在 s（念的时候用），t 是去掉标签给人看的 */
const segsOf = text => clean(text).split('\n').map(l => l.trim()).filter(Boolean).reduce((a, l) => {
  if (l.startsWith('>>')) { if (a.length) a[a.length - 1].tr = plain(l.replace(/^>>\s*/, '')); }
  else { const s = l.replace(/\[\d+\]\s*/g, ''), t = plain(s); a.push(t === s ? { t, tr: '' } : { t, s, tr: '' }); }
  return a;
}, []);
const hint = c => hintFor(kindOf(connFor(c.id)));   // 每段怎么标语气：照这个角色现在用的语音接口
const zhLine = lang => isZh(lang) ? '' : '每段下面另起一行，用 >> 开头写这一段的中文翻译。';
// 连接中途断了时，有的接口会把一句「响应读取中断…请检查网络连接…」当成正文接在半截回复后面（作者那本的感想就混进了这句）：当失败，不存
const ask = (c, prompt, maxTokens, stop) => generate({ conn: resolveConn('text', 'chat'), system: '', app: '电台', maxTokens, stop, prompt })
  .then(t => { if (/响应读取中断|请检查网络连接/.test(t)) { log('warn', '电台', '回复里混进了接口的断线提示，没存：' + t.slice(-120)); throw new Error('连接中途断了，回来的不完整，再试一次'); } return clean(t); });

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
  const raw = await ask(c, compose('radioStory', { char: real(c), persona: personaOf(c) || '（没有更多资料）', recall: about, ask: what, lang: lname(lang), len: LEN[S().len], zh: zhLine(lang), act: hint(c) }), 8000, stop);
  const title = ((raw.match(/^\s*标题[:：]\s*(.+)$/m) || [])[1] || '').replace(/^[《「『【]|[》」』】]$/g, '').trim();
  const [head, rest] = raw.split(/^\s*故事[:：]\s*/m), [story, after = ''] = (rest ?? head.replace(/^\s*标题[:：].*$/m, '')).split(/^\s*感想[:：]\s*/m);
  const segs = segsOf(story);
  if (!segs.length) throw new Error('AI 回的格式不对');
  return { id: uid('rb'), who: c.id, title: title || segs[0].t.slice(0, 10), lang, src: 'ai', segs, after: segsOf(after), pos: 0, at: Date.now() };
}
/** 书店的老故事、导入的文字：翻成 lang（原文就是 lang 的话只配中文翻译） */
async function trans(c, ps, from, lang, stop) {
  const onlyZh = same(from, lang), raw = await ask(c, compose('radioTrans', { char: real(c), lang: lname(onlyZh ? 'zh-CN' : lang),
    zh: onlyZh || isZh(lang) || isZh(from) ? '' : zhLine(lang), act: onlyZh ? '' : hint(c), tale: ps.map((p, i) => `[${i + 1}] ${p}`).join('\n') }), 8000, stop);
  const out = segsOf(raw);
  if (!out.length) throw new Error('AI 回了空的');
  if (onlyZh) return ps.map((t, i) => ({ t, tr: (out[i] || {}).t || '' }));
  return isZh(from) ? out.map((s, i) => ({ t: s.t, tr: ps[i] || '' })) : out;
}
/** 免费机翻（不花 API，没有口吻和语气）：整段一起翻，行数对不上就一段段翻 */
async function mt(ps, to) {
  const code = isZh(to) ? 'zh-CN' : to, all = (await translate(ps.join('\n'), code)).split('\n').map(x => x.trim()).filter(Boolean);
  return all.length === ps.length ? all : Promise.all(ps.map(p => translate(p, code)));
}
async function transMt(ps, from, lang, stop, trs) {   // trs：原来就配好的中文翻译，有就接着用
  const t = same(from, lang) ? ps : await mt(ps, lang), tr = isZh(lang) ? [] : isZh(from) ? ps : trs && trs.every(Boolean) ? trs : await mt(ps, 'zh-CN');
  if (stop.aborted) throw new Error('已取消');
  return t.map((x, i) => ({ t: x, tr: tr[i] || '' }));
}
const howTrans = () => actionSheet('怎么翻', [{ value: 'mt', label: '免费机翻（不花 API）' }, { value: 'ai', label: 'AI 翻（用一次 API，带 TA 的口吻和语气）' }]);
const transBy = (how, c, ps, from, lang, stop, trs) => how === 'mt' ? transMt(ps, from, lang, stop, trs) : trans(c, ps, from, lang, stop);
async function thoughts(b, stop) {
  const c = contact(b.who);
  if (!c) throw new Error('这个角色已经不在联系人里了');
  const out = segsOf(await ask(c, compose('radioAfter', { char: real(c), persona: personaOf(c) || '（没有更多资料）', title: b.title,
    tale: b.segs.map(s => s.t).join('\n').slice(0, 8000), lang: lname(b.lang), zh: zhLine(b.lang), act: hint(c) }), 2400, stop));
  if (!out.length) throw new Error('AI 回了空的');
  b.after = out; await save();
}
/** 这本换一种语言讲：翻过的语言存在 vers 里，换回去不再花钱 */
async function relang(b, to, how, stop) {
  const c = contact(b.who);
  if (!c) throw new Error('这个角色已经不在联系人里了');
  (b.vers || (b.vers = {}))[b.lang] = { segs: b.segs, after: b.after };
  let v = b.vers[Object.keys(b.vers).find(k => same(k, to))];
  const zh = L => isZh(to) && L.every(s => s.tr) ? L.map(s => ({ t: s.tr, tr: '' })) : null;   // 换成中文、每段本来就配了中文翻译：直接用，不花钱
  if (!v && zh(lines(b))) v = { segs: zh(b.segs), after: b.after && zh(b.after) };
  if (!v) { const out = await transBy(how, c, lines(b).map(s => s.t), b.lang, to, stop, lines(b).map(s => s.tr)); v = { segs: out.slice(0, b.segs.length), after: b.after ? out.slice(b.segs.length) : null }; }
  else if (b.after && !v.after) v.after = zh(b.after) || await transBy(how, c, b.after.map(s => s.t), b.lang, to, stop, b.after.map(s => s.tr));   // 感想是换语言以后才写的：只翻感想
  if (E.book === b) { stopStory(); E.i = Math.min(E.i, v.segs.length + (v.after || []).length - 1); }
  Object.assign(b, { lang: to, segs: v.segs, after: v.after }); await save(); tell();
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
/** 第 i 段的声音：存过就拿存的；没有就用角色的声音合成一次存下来。合成失败返回空（那段先用手机自带的声音念） */
async function voice(b, i) {
  const k = `radio:a:${b.id}:${b.lang}:${i}`, got = await kvGet(k).catch(() => null);
  if (got) return got;
  if (!pend.has(k)) pend.set(k, speakAs(b.who, lines(b)[i].s || lines(b)[i].t, { silent: true, acted: true, cache: k, stop: (E.stop || (E.stop = new AbortController())).signal })
    .then(() => kvGet(k).catch(() => null)).finally(() => pend.delete(k)));
  return pend.get(k);
}
/** 按设置提前合成后面几段（一段一段来，停了就不再合成） */
async function ahead(b, i) {
  const n = Math.min(end(b), S().tts === 'all' ? Infinity : S().tts === 'ahead' ? i + 3 : i + 1);
  for (let j = i + 1; j < n && E.book === b && E.on; j++) await voice(b, j);
}
function halt() {
  E.raw = E.spk = null;
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
  if (buf) { E.raw = buf; E.buf = stretch(buf, rate()); start(run); }
  else {
    if (!E.warned) { E.warned = true; toast('没合成出角色的声音，先用手机自带的声音念'); }
    say(run, lines(b)[i].t, b.lang);
  }
  tell(); save(); ahead(b, i);
}
const rate = () => S().rate || 1;
/** 倍速不变调（WSOLA）：一小块一小块往后挪着拼，每块在附近找和上一块接得最顺的位置，再交叠加起来 */
function stretch(buf, r) {
  if (r === 1) return buf;
  const x = buf.getChannelData(0), sr = buf.sampleRate, N = Math.round(sr * .04) & ~1, Hs = N / 2, tol = Math.round(sr * .01);
  const out = new Float32Array(Math.ceil(x.length / r) + N), win = Float32Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / N));
  for (let k = 0, o = 0, prev = 0; ; k++, o += Hs) {
    const nom = Math.round(k * Hs * r);
    if (nom + N + tol >= x.length) break;
    let best = nom;
    if (k) for (let d = -tol, bc = -Infinity; d <= tol; d += 2) { const at = nom + d; if (at < 0) continue; let c = 0; for (let i = 0; i < Hs; i += 4) c += x[prev + Hs + i] * x[at + i]; if (c > bc) { bc = c; best = at; } }
    for (let i = 0; i < N; i++) out[o + i] += x[best + i] * win[i];
    prev = best;
  }
  const b = ac.createBuffer(1, out.length, sr); b.copyToChannel(out, 0);
  return b;
}
function setRate(r) {
  S().rate = r; commit('music');
  if (!E.raw || !E.buf) return;
  const k = (E.src ? ac.currentTime - E.t0 : E.off) / E.buf.duration, playing = !!E.src;
  if (playing) { E.src.onended = null; E.src.stop(); E.src = null; }
  E.buf = stretch(E.raw, r); E.off = k * E.buf.duration;
  if (playing) start(E.run);
}
function start(run) {
  const s = E.src = ac.createBufferSource();
  s.buffer = E.buf; s.connect(master); s.onended = () => { if (run === E.run && E.src === s) playAt(E.i + 1); };
  E.t0 = ac.currentTime - E.off; s.start(0, E.off);
}
function say(run, text, lang) {
  if (!('speechSynthesis' in window)) { toast('这个浏览器不能朗读'); return stopStory(); }
  const u = new SpeechSynthesisUtterance(text), L = isZh(lang) ? 'zh-CN' : lang, v = speechSynthesis.getVoices().find(x => x.lang.replace('_', '-').startsWith(L.slice(0, 2)));
  u.lang = L; u.rate = rate(); if (v) u.voice = v;
  u.onend = () => { if (run === E.run && E.on) playAt(E.i + 1); };
  // 手机自带的声音不知道多长：念到哪个字有通知就按通知算，没有就按每个字大概多久估
  const spk = E.spk = { at: performance.now(), n: text.length || 1, per: (isZh(lang) || lang === 'ja' || lang === 'ko' ? 230 : 65) / rate() };
  u.onboundary = e => { spk.ci = e.charIndex; };
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
  ctx.body.append(scene); ctx.right.append(navBtn('more', '设置', () => settings()));

  const paintWho = () => { const c = cur(); face.replaceChildren(c ? avatar(c.avatar, nameOf(c), 64) : icon('users', 30, 1.8)); ctx.title.textContent = c ? nameOf(c) : '所有人'; };
  function paintShelf() {
    const c = cur(), list = D.books.filter(b => !c || b.who === c.id).sort((a, b) => b.at - a.at);
    shelf.replaceChildren(h('button.as-rd__spine.is-add', { onclick: add }, h('img', { src: 'assets/radio/spine7.webp', alt: '' }), h('span', '＋ 讲一个')),
      ...list.map(b => { const n = hash(b.id), el = h('button.as-rd__spine', { dataset: { id: b.id }, style: { '--r': (n % 7 - 3) + 'deg', animationDelay: -(n % 50) / 10 + 's' },
        onclick: () => { if (!sel) return openBook(b); sel.has(b) ? sel.delete(b) : sel.add(b); mark(); } },
        h('img', { src: `assets/radio/spine${SPINES[n % SPINES.length]}.webp`, alt: '' }), h('span', b.title));
      onLongPress(el, () => sel || bookMenu(b)); return el; }));
    mark();
  }
  const shown = () => D.books.filter(b => !cur() || b.who === cur().id);
  // 长按一本：改名 / 多选 / 删除。多选时每本书脊上出个圈，底下「全选 · 删除（几本）· 取消」（和音乐里歌单的多选一样）
  let sel = null;
  const cnt = h('span'), allB = h('button', { onclick: () => { sel = new Set(sel.size < shown().length ? shown() : []); mark(); } }, '全选');
  const bar = h('div.as-mu-pickbar', allB, h('button.is-main', { onclick: async () => { if (!sel.size) return toast('先勾几本'); if (await delBooks([...sel])) pick(false); } }, '删除', cnt), h('button', { onclick: () => pick(false) }, '取消'));
  function pick(on, first) { sel = on ? new Set([first]) : null; scene.classList.toggle('is-picking', on); if (on) scene.append(bar); else bar.remove(); mark(); }
  async function bookMenu(b) {
    const v = await actionSheet(b.title, [{ value: 'name', label: '改名' }, { value: 'pick', label: '多选' }, { value: 'del', label: '删除', danger: true }]);
    if (v === 'pick') pick(true, b);
    if (v === 'del') delBooks([b]);
    if (v === 'name') { const t = ((await dialog({ title: '改名', input: { value: b.title, placeholder: '书名' } })) || '').trim(); if (t && t !== b.title) { b.title = t; await save(); tell(); } }
  }
  // 正在讲的那本亮着、开着的瓶子亮着：只换这几个的样子
  const mark = () => { [...shelf.children].forEach(el => { el.classList.toggle('is-on', !!E.book && el.dataset.id === E.book.id && (E.on || E.wait)); el.classList.toggle('is-picked', !!sel && [...sel].some(b => b.id === el.dataset.id)); });
    if (sel) { cnt.textContent = sel.size ? `（${sel.size}）` : ''; allB.textContent = sel.size && sel.size === shown().length ? '全不选' : '全选'; }
    bottles.forEach((b, i) => b.classList.toggle('is-on', !!live[NOISE[i][0]])); };
  const sig = () => D.who + D.books.map(b => b.id + b.title).join();
  let last = sig();
  const f = () => { if (!scene.isConnected || scene.dataset.my !== String(my)) return subs.delete(f); if (sig() !== last) { last = sig(); paintWho(); paintShelf(); } else mark(); };
  scene.dataset.my = my; subs.add(f);
  paintWho(); paintShelf();

  async function pickWho() {
    const v = await actionSheet('谁来讲', [...state.contacts.map(c => ({ value: c.id, label: nameOf(c), active: cur() === c })), { value: 'all', label: '所有人讲过的', active: D.who === 'all' }]);
    if (!v) return;
    D.who = v; save(); watch.classList.remove('is-tick'); void watch.offsetWidth; watch.classList.add('is-tick'); tell();
  }
}
const voiceLabel = c => { const conn = connFor(c.id); if (!conn) return '还没设语音接口'; const v = voiceOf(c.id, conn); return v.from === 'own' ? v.name || v.voice : '默认音色'; };
const pickTts = () => actionSheet('什么时候合成', TTS.map(([value, label]) => ({ value, label, active: S().tts === value })));
const pickRole = async () => { const v = await actionSheet('谁来讲', state.contacts.map(c => ({ value: c.id, label: nameOf(c) }))); return v && contact(v); };
async function add() {
  const c = cur() || await pickRole();
  if (!c) return state.contacts.length || toast('先在聊天里加个联系人');
  return what(c);
}
async function what(c) {
  const v = await actionSheet(`${nameOf(c)} 讲什么`, [{ value: 'rand', label: '随便讲一个' }, { value: 'ask', label: '想听什么' }, { value: 'lib', label: '书店里的老故事' }, { value: 'mine', label: '粘贴或导入' }]);
  if (v === 'rand') return tellNew(c, '随便讲一个：可以是你自己编的，也可以是各地的民间故事、寓言、童话。');
  if (v === 'lib') return libSheet(c);
  if (v === 'mine') return importSheet(c);
  if (v !== 'ask') return;
  const k = await actionSheet('想听什么', [['fairy', '童话'], ['day', '日常小事'], ['recall', '回忆你们之间的事'], ['sheep', '陪你数羊'], ['own', '自己写…']].map(([value, label]) => ({ value, label })));
  const me = myName(), own = k === 'own' && ((await dialog({ title: '想听什么', input: { placeholder: '想听什么' } })) || '').trim();
  const topic = { fairy: '讲一个童话。', day: '讲一件你自己的日常小事，像睡前聊天一样。', recall: `回忆一件你和 ${me} 之间真实发生过的事，从你的角度讲，只讲真发生过的，不编造。`,
    sheep: `陪 ${me} 数羊、哄 TA 睡觉：声音轻、节奏慢，一只一只地数，中间夹几句轻轻的话。`, own: `讲一个故事：${own}` }[k];
  if (topic && (k !== 'own' || own)) tellNew(c, topic, k === 'recall');
}
const tellNew = (c, what, recall) => task(`${nameOf(c)} 在想故事…`, async stop => made(await compose1(c, what, recall, stop), '讲好了'));
function libSheet(c) {
  const L = langOf(c), order = [...new Set(LIB.map(x => x.lang))].sort((a, b) => same(b, L) - same(a, L));
  const s = sheet({ title: '书店里的老故事', content: order.map(l => group(lname(l), LIB.filter(x => x.lang === l).map(x => item({ title: x.title, sub: x.from, chevron: true, onClick: () => { s.close(); fromLib(c, x); } })))) });
}
async function fromLib(c, x) {
  const L = langOf(c), had = D.books.find(b => b.who === c.id && b.lib === x.id && same(b.lang, L));
  if (had) return openBook(had);
  const ps = paras(x.text);
  const make = segs => made({ id: uid('rb'), who: c.id, title: x.title, lang: L, src: 'lib', lib: x.id, segs, after: null, pos: 0, at: Date.now() }, `《${x.title}》放上书架了`);
  if (isZh(L) && isZh(x.lang)) return make(ps.map(t => ({ t, tr: '' })));
  // 翻好的存一份，别的角色、别的窗口再挑同一本不再翻（AI 翻的优先）
  const keys = ['ai', 'mt'].map(k => `radio:lib:${x.id}:${L}${k === 'ai' ? '' : ':mt'}`);
  for (const k of keys) { const got = await kvGet(k).catch(() => null); if (got) return make(got); }
  const how = await howTrans();
  if (how) task(`${nameOf(c)} 在翻《${x.title}》…`, async stop => { const segs = await transBy(how, c, ps, x.lang, L, stop); await kvSet(keys[how === 'ai' ? 0 : 1], segs).catch(() => {}); await make(segs); });
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
  const v = same(from, L) ? isZh(L) ? 'raw' : await actionSheet('要中文翻译吗', [{ value: 'to', label: '配中文翻译' }, { value: 'raw', label: '不用翻译' }])
    : await actionSheet(`原文是${lname(from)}`, [{ value: 'to', label: `让 TA 翻成${lname(L)}讲` }, { value: 'raw', label: '照原文念' }]);
  if (v === 'raw') return make(ps.map(t => ({ t, tr: '' })), from);
  const how = v === 'to' && await howTrans();
  if (how) task(`${nameOf(c)} 在翻《${title}》…`, async stop => make(await transBy(how, c, ps, from, L, stop), L));
}
async function delBooks(list) {
  if (!(await dialog({ title: list.length > 1 ? `删除这 ${list.length} 本？` : `删除《${list[0].title}》？`, text: '合成好的声音也一起删掉', confirm: '删除', danger: true }))) return false;
  if (list.includes(E.book)) { stopStory(); E.book = null; }
  D.books = D.books.filter(x => !list.includes(x)); await save(); tell();
  const ids = list.map(b => `radio:a:${b.id}:`);
  for (const k of await kvKeys().catch(() => [])) if (ids.some(x => String(k).startsWith(x))) await kvDel(k).catch(() => {});
  return true;
}
/** 电台设置（右上角 ⋯）：c 是正在看的这个角色（书架上选的人、或者正开着的这本书的人） */
function settings(c = cur()) {
  const set = (k, v) => { S()[k] = v; commit('music'); tell(); };
  // 这个角色用什么语言讲、用哪个声音：点了换，只改右边那几个字
  const langV = c && h('span', lname(langOf(c))), voiceV = c && h('span', voiceLabel(c));
  const who = c && group(nameOf(c), [
    item({ title: '讲故事用的语言', right: langV, chevron: true, onClick: async () => {
      const l = await actionSheet('讲故事用的语言', ALL_LANGS.map(([value, label]) => ({ value, label, active: same(value, langOf(c)) })));
      if (l) { D.lang[c.id] = l; save(); langV.textContent = lname(l); }
    } }),
    item({ title: '声音', right: voiceV, chevron: true, onClick: async () => (await import('../settings/voices.js')).openPerson(c.id, () => { voiceV.textContent = voiceLabel(c); }) })]);
  sheet({ title: '电台设置', content: h('div.as-rd-set', who,
    group('什么时候合成', [segmented(TTS, S().tts, v => set('tts', v))]),
    group('', [toggleItem({ title: '故事讲完接着念感想' }, S().say, v => set('say', v))]),
    group('随便讲的长短', [segmented([['short', '短'], ['mid', '中'], ['long', '长']], S().len, v => set('len', v))]),
    group('字幕气泡', [color('气泡颜色', () => B().bg, v => B().bg = v, saveBub), color('字的颜色', () => B().ink, v => B().ink = v, saveBub),
      font(() => B().font, v => B().font = v, saveBub), toggleItem({ title: '描边' }, !!B().line, v => { B().line = v; saveBub(); })])) });
}
// 读书页字幕气泡的样子：没改过就是透明玻璃、白字；自己挑了气泡颜色就换成实心的；描边的颜色跟字的颜色反着来
const B = () => S().bub || (S().bub = {});
let bubEl = null;
function saveBub() { commit('music'); if (bubEl && bubEl.isConnected) styleBub(bubEl); }
function styleBub(el) {
  const o = B(), dark = o.ink && parseInt(o.ink.slice(1, 3), 16) * .3 + parseInt(o.ink.slice(3, 5), 16) * .59 + parseInt(o.ink.slice(5, 7), 16) * .11 < 128;
  el.style.setProperty('--rb-bg', o.bg || ''); el.style.setProperty('--rb-ink', o.ink || ''); el.style.setProperty('--rb-line', o.ink ? dark ? '#fff' : '#000' : '');
  el.classList.toggle('is-line', !!o.line); el.classList.toggle('has-bg', !!o.bg); setFont(el, o.font).then(() => el._fit && el._fit());
}

/* ---------- 读书：书摊开（左页这一段、右页下一段，都只放中文）；书下面像一起听，TA 的头像 + 气泡里是正在念的原文和翻译；按钮都在最底下 ---------- */
function openBook(b) {
  if (E.book !== b) { stopStory(); E.book = b; E.i = Math.min(b.pos || 0, lines(b).length - 1); }
  const c = contact(b.who) || {};
  const more = async () => {
    const v = await actionSheet(b.title, [{ value: 'set', label: '设置' }, { value: 'timer', label: timer ? `定时关闭（还剩 ${Math.ceil((timer.end - Date.now()) / 6e4)} 分钟）` : '定时关闭' },
      b.after && { value: 'again', label: '重新说感想' }, { value: 'del', label: '删除', danger: true }].filter(Boolean));
    if (v === 'set') settings(contact(b.who));
    if (v === 'timer') pickTimer();
    if (v === 'again') task(`${nameOf(c)} 在想感想…`, async stop => { const old = b.after; b.after = null; try { await thoughts(b, stop); } catch (e) { b.after = old; throw e; } toast('想好了，翻到感想了'); tell(); go(b.segs.length); });
    if (v === 'del' && await delBooks([b])) nav.back();
  };
  const p = page({ app: 'music', id: 'radio-read', title: b.title, cls: 'as-rd-read.is-dark', right: navBtn('more', '更多', more) });
  const L = h('div.as-rd-pg'), R = h('div.as-rd-pg.is-r'), count = h('span'), playB = h('button.as-rd-play', { 'aria-label': '播放 / 暂停', onclick: toggle });
  const sayT = h('span'), sayTr = h('span'), row = bubEl = h('div.as-rd-bub', avatar(c.avatar, nameOf(c), 34), h('p', sayT, h('small', sayTr)));
  // 还没有感想：让 TA 说说（想好了直接翻到感想）；有了：翻到感想那页
  const afterB = h('button', { onclick: () => b.after ? go(b.segs.length) : task(`${nameOf(c)} 在想感想…`, async stop => { await thoughts(b, stop); toast('想好了，翻到感想了'); tell(); go(b.segs.length); }) });
  const langB = h('button.as-rd-lang', { onclick: async () => {
    const v = await actionSheet('讲故事用的语言', ALL_LANGS.map(([value, label]) => ({ value, label, active: same(value, b.lang) })));
    if (!v || same(v, b.lang)) return;
    const done = Object.keys(b.vers || {}).some(k => same(k, v)) || isZh(v) && lines(b).every(s => s.tr), how = done ? 'ai' : await howTrans();   // 翻过、或者换成中文直接用翻译的，不用问
    if (how) task(`${nameOf(c)} 在换成${lname(v)}…`, async stop => { await relang(b, v, how, stop); toast(`换成${lname(v)}了`); });
  } });
  const RATES = [.75, 1, 1.25, 1.5, 2], rateL = r => r === 1 ? '倍速' : r + 'x';
  const rateB = h('button', { onclick: async () => {
    const v = await actionSheet('倍速', RATES.map(r => ({ value: r, label: r + 'x', active: rate() === r })));
    if (v) { setRate(v); rateB.textContent = rateL(v); }
  } }, rateL(rate())), ttsB = h('button', { onclick: async () => {
    const v = await pickTts();
    if (v) { S().tts = v; commit('music'); ttsB.textContent = TTS.find(x => x[0] === v)[1]; if (E.on) ahead(b, E.i); }
  } }, TTS.find(x => x[0] === S().tts)[1]);
  const bg = `assets/radio/bg-${isNight() ? 'night' : 'day'}.webp`, shade = ['rgba(12,10,24,.6)', 'rgba(12,10,24,.78)'];
  p.el.style.backgroundImage = `linear-gradient(${shade.join(', ')}), url(${bg})`;
  const book = h('div.as-rd-book', { 'data-no-swipe': '' }, h('img', { src: 'assets/radio/book.webp', alt: '' }), L, R);
  const say = h('div.as-rd-say', row);
  p.body.append(book, say,
    h('div.as-rd-bottom', h('div.as-rd-count', count, langB, h('button.as-rd-lang', { onclick: () => actSheet(E.i) }, '调语气')), h('div.as-rd-tools', rateB, h('button', { onclick: noiseSheet }, '白噪音'), ttsB, afterB),
      h('div.as-rd-ctl', h('button', { 'aria-label': '上一段', onclick: () => go(E.i - 1) }, icon('prev', 24, 2)), playB, h('button', { 'aria-label': '下一段', onclick: () => go(E.i + 1) }, icon('next', 24, 2)))));
  // 气泡要一眼看全：放不下就把字一点点调小（最小 10px），不让它滚动
  row._fit = () => { const q = row.lastChild, room = say.clientHeight - parseFloat(getComputedStyle(say).paddingTop) - parseFloat(getComputedStyle(say).paddingBottom); let f = 15; q.style.fontSize = ''; while (row.offsetHeight > room && f > 10) q.style.fontSize = (f -= .5) + 'px'; gls && gls.refresh(); };
  let gls = null;
  styleBub(row);
  row.addEventListener('animationend', () => gls && gls.refresh());
  new ResizeObserver(() => row._fit()).observe(say);   // 页面刚排好、屏幕大小变了时再量一次
  function toggle() { if (E.on || E.wait) pause(); else resume(); }
  // 调这一段的语气（照正文朗读的 🎭）：一键套一组、或者在光标处插标签，也能改字；试听只合成不存，保存后这段下次重新合成
  function actSheet(i) {
    const seg = lines(b)[i], ta = textarea({ value: seg.s || seg.t, rows: 5 }), k = kindOf(connFor(b.who));   // 只给这个接口认的标签
    const lead = v => v.replace(/^\s*(?:\[[^\]]+\]\s*)+/, '');
    const put = v => { const at = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, at) + v + ta.value.slice(at); ta.focus(); };
    const chips = (list, fn) => h('div.as-rd-chips', list.map(([label, v]) => h('button', { onclick: () => fn(v) }, label)));
    const tryB = btn('试听', 'secondary', () => { pause(); busy(tryB, stop => speakAs(b.who, ta.value, { acted: true, stop })); });
    const sh = sheet({ title: '调这一段的语气', content: h('div.as-rd-act', ta,
      k === 'plain' ? null : [h('small', '一键'), chips(PRESETS, tags => { ta.value = tags.map(x => `[${x}]`).join('') + (tags.length ? ' ' : '') + lead(ta.value); })],
      groupsFor(k).map(([name, list]) => [h('small', name), chips(list, x => put(`[${x}]`))]), tryB,
      h('div.as-rd-imp__row', btn('取消', 'secondary', () => sh.close()), btn('保存', 'primary', async () => {
        const v = ta.value.trim(), t = plain(v);
        if (!t) return toast('还没有字');
        if (v !== (seg.s || seg.t)) {
          Object.assign(seg, { t, s: v === t ? undefined : v });
          await kvDel(`radio:a:${b.id}:${b.lang}:${i}`).catch(() => {});
          if (E.book === b && E.i === i && !E.on) { E.raw = E.buf = null; E.off = 0; }
          await save(); shown = -1; tell();
        }
        sh.close(); toast('存好了');
      }))) });
  }
  function go(i) { i = clamp(i, 0, lines(b).length - 1); if (E.on || E.wait) playAt(i); else { E.run++; halt(); E.i = b.pos = i; E.buf = null; E.off = 0; tell(); } }
  const zh = s => s ? s.tr || s.t : '';
  const left = i => [i >= b.segs.length && i < lines(b).length ? h('small', '感想') : '', h('p', zh(lines(b)[i]))], right = i => [h('p.is-next', zh(lines(b)[i]))];
  // 一页放不下就把字调小一点（最小 10px）
  const fitPg = x => { let f = 13; x.style.fontSize = ''; while (x.scrollHeight > x.clientHeight && f > 10) x.style.fontSize = (f -= .5) + 'px'; };
  const pages = i => { L.replaceChildren(...left(i)); R.replaceChildren(...right(i + 1)); fitPg(L); fitPg(R); };
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
  book.onpointerup = book.onpointercancel = e => {
    const d = drag; drag = null;
    if (d && d.dir) { if (leaf.deg > 60) go(E.i + d.dir); else settle(0); }
    else if (d && e.type === 'pointerup') { const r = book.getBoundingClientRect(); go(E.i + (e.clientX < r.left + r.width / 2 ? -1 : 1)); }   // 点左页上一段、点右页下一段
  };
  let shown = -1, nlines = -1, nlang = b.lang;
  function paint() {
    if (!p.el.isConnected) return subs.delete(paint);
    const all = lines(b);
    if (E.book !== b) return;
    if (shown !== E.i || nlines !== all.length || nlang !== b.lang) {
      const s = all[E.i], d = nlang === b.lang ? E.i - shown : 0, last = shown;
      if (leaf && !leaf.busy && leaf.dir === d) settle(180);   // 手指翻过去了
      else if (!leaf && last !== -1 && Math.abs(d) === 1) { lift(d, last); settle(180); }   // 念到下一段、点上一段 / 下一段：自己翻
      else { if (leaf) { leaf.remove(); leaf = null; } pages(E.i); }
      shown = E.i; nlines = all.length; nlang = b.lang;
      cut(s); ci = -1; tick();
      if (last !== -1) { row.classList.remove('is-turn'); void row.offsetWidth; row.classList.add('is-turn'); }
    }
    count.textContent = `${E.i + 1} / ${all.length}`;
    playB.replaceChildren(E.wait ? h('span.as-spin') : icon(E.on ? 'pause' : 'play', 26, 2.4));
    afterB.textContent = b.after ? '看感想' : '说说感想'; langB.textContent = lname(b.lang); ttsB.textContent = TTS.find(x => x[0] === S().tts)[1];
  }
  // 气泡只放正在念的这一两句（像歌词）：原文按句子分成几小块（一块最多 60 字），翻译按长短比例分到同样几块，跟着念的进度换块
  let chunks = [], ci = -1;
  function cut(s) {
    const o = sents(s.t).reduce((a, x) => { if (a.length && (a[a.length - 1] + x).length <= 60) a[a.length - 1] += x; else a.push(x); return a; }, []).map(x => x.trim());
    const n = o.length, len = o.join('').length || 1, tr = o.map(() => '');
    let at = 0;
    chunks = o.map((t, i) => { const a = at / len; at += t.length; return { t, a, b: i === n - 1 ? 1 : at / len }; });
    // 翻译切到逗号这么细（中文常一逗到底），每一小截按它在整段里的位置分给对应的块
    const ts = s.tr && (s.tr.match(/[^，,、；;。！？!?…]+[，,、；;。！？!?…」』”"]*\s*/g) || [s.tr]);
    if (s.tr) { let q = 0; const tl = s.tr.length; for (const x of ts) { const mid = (q + x.length / 2) / tl; q += x.length; tr[Math.max(0, chunks.findIndex(c => mid <= c.b))] += x; } }
    chunks.forEach((c, i) => { c.tr = tr[i].trim(); });
  }
  // 念到这一段的哪儿了（0~1）；还在合成是 0，没在念就是 null
  const where = () => {
    if (E.book !== b) return null;
    if (E.buf) return (E.src ? ac.currentTime - E.t0 : E.off) / E.buf.duration;
    if (E.spk) return E.spk.ci != null ? E.spk.ci / E.spk.n : (performance.now() - E.spk.at) / (E.spk.n * E.spk.per);
    return E.wait ? 0 : null;
  };
  const tick = () => {
    if (!p.el.isConnected) { gls && gls.dispose(); return clearInterval(iv); }
    const k = where(), j = k == null ? 0 : Math.max(0, chunks.findIndex(c => k < c.b)), c = chunks[j];
    if (!c) return;
    if (j !== ci) {
      ci = j; sayT.textContent = c.t; sayTr.textContent = c.tr; sayTr.parentNode.hidden = !c.tr; row._fit();
      if (k != null && j) { row.classList.remove('is-turn'); void row.offsetWidth; row.classList.add('is-turn'); }
    }
    row.style.setProperty('--p', (k == null ? 100 : Math.min(100, Math.max(0, (k - c.a) / (c.b - c.a)) * 100)).toFixed(1) + '%');
  };
  const iv = setInterval(tick, 200);
  nav.push(p.el); gls = glass(row.lastChild, p.el, bg, shade); subs.add(paint); paint(); tick();
}
