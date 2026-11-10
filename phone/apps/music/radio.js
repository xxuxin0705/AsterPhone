// 电台：兔子洞里的书店，角色给你讲故事（需求见 docs/pages-music.md 八·五）。
// 每一期是一本书：{ id, who, title, lang, src: 'ai' | 'lib' | 'mine', lib, segs: [{ t, tr }], after: [{ t, tr }] | null, vers: { 语言: { segs, after } }, pos, at }
// 书跟着酒馆聊天窗口走，存在 kv 的 radio:窗口；每段合成好的声音存在 radio:a:书:语言:段，重听不再花钱。不进记忆、不发给酒馆。
// 声音都走一个 AudioContext：故事一段接一段、白噪音垫在底下，切到后台也能接着放下一段（新开 <audio> 在后台会被拦）。
import { h, uid, clamp, pickFile, onLongPress, debounce } from '../../core/util.js';
import { state, win, commit, contact, kvGet, kvSet, kvDel, kvKeys, chatForContact, getMsgs } from '../../core/store.js';
import { page, navBtn, actionSheet, dialog, toast, sheet, avatar, segmented, slider, switchEl, group, item, icon, input, textarea, btn, toggleItem, busy, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as P from '../../core/music.js';
import { generate, generateMore, resolveConn, synthesize } from '../../core/api.js';
import { compose, myName } from '../../core/promptstore.js';
import { speakAs, connFor, voiceOf, readAloud } from '../../core/voice.js';
import { storyText, worldText } from '../../core/context.js';
import { memoryFor } from '../../core/memory.js';
import { log } from '../../core/log.js';
import { nameOf, personaOf } from '../chat/engine.js';
import { isNight } from './rain.js';
import { noiseNode } from '../../core/noise.js';
import { color, font, setFont } from './tglook.js';
import { glass } from '../../core/glass.js';
import * as PT from '../../core/portrait.js';
import { plain, PRESETS, groupsFor, kindOf, hintFor, fitTags, profileOf, adapt, TENSIONS, PACES, PACE_SPEED, MM_EMOS } from '../../core/act.js';
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
// done：写完了没有（故事要写到「感想」、翻译要每段都有）；没写完、电台设置里开了自动补写，就接着写
const ask = (c, prompt, stop, done = () => true) => generateMore({ conn: resolveConn('text', 'chat'), system: '', app: '电台', stop, prompt }, done, S().fill ? S().fillMax || 3 : 0)
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
  const raw = await ask(c, compose('radioStory', { char: real(c), persona: personaOf(c) || '（没有更多资料）', recall: about, ask: what, lang: lname(lang), len: LEN[S().len], zh: zhLine(lang), act: hint(c) }), stop, t => /^\s*感想[:：]/m.test(t));
  const title = ((raw.match(/^\s*标题[:：]\s*(.+)$/m) || [])[1] || '').replace(/^[《「『【]|[》」』】]$/g, '').trim();
  const [head, rest] = raw.split(/^\s*故事[:：]\s*/m), [story, after = ''] = (rest ?? head.replace(/^\s*标题[:：].*$/m, '')).split(/^\s*感想[:：]\s*/m);
  const segs = segsOf(story);
  if (!segs.length) throw new Error('AI 回的格式不对');
  return { id: uid('rb'), who: c.id, title: title || segs[0].t.slice(0, 10), lang, src: 'ai', segs, after: segsOf(after), pos: 0, at: Date.now() };
}
/** 书店的老故事、导入的文字：翻成 lang（原文就是 lang 的话只配中文翻译） */
async function trans(c, ps, from, lang, stop) {
  const onlyZh = same(from, lang), raw = await ask(c, compose('radioTrans', { char: real(c), lang: lname(onlyZh ? 'zh-CN' : lang),
    zh: onlyZh || isZh(lang) || isZh(from) ? '' : zhLine(lang), act: onlyZh ? '' : hint(c), tale: ps.map((p, i) => `[${i + 1}] ${p}`).join('\n') }), stop, t => segsOf(t).length >= ps.length);
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
    tale: b.segs.map(s => s.t).join('\n').slice(0, 8000), lang: lname(b.lang), zh: zhLine(b.lang), act: hint(c) }), stop));
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

/* ---------- 声音：一个 AudioContext，故事和白噪音都接在 master 上 ---------- */
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
  if (!pend.has(k)) pend.set(k, speakAs(b.who, lines(b)[i].s || lines(b)[i].t, { silent: true, acted: true, t: lines(b)[i].ten, cache: k, stop: (E.stop || (E.stop = new AbortController())).signal })
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
  if (buf) { E.raw = buf; setBuf(); start(run); }
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
// 实际放的：倍速 × 这一段自己调的语速；顺便量好「第几秒念到哪个字」
function setBuf() { const seg = lines(E.book)[E.i]; E.buf = stretch(E.raw, rate() * (PACE_SPEED[seg.pace] || 1)); E.map = syncMap(E.buf, seg.t); }
function setRate(r) {
  S().rate = r; commit('music');
  if (!E.raw || !E.buf) return;
  const k = (E.src ? ac.currentTime - E.t0 : E.off) / E.buf.duration, playing = !!E.src;
  if (playing) { E.src.onended = null; E.src.stop(); E.src = null; }
  setBuf(); E.off = k * E.buf.duration;
  if (playing) start(E.run);
}
// 念到哪个字：照声音里的停顿对。声音里静下来 0.12 秒以上的地方，对到字里最近的标点上（按字的读音长短估它大概在第几秒）；
// 两个停顿之间按读音长短平分。汉字算长一点、假名 / 韩文一个音、字母很短，标点不占时间
const W = ch => /[\u4e00-\u9fff]/.test(ch) ? 1.8 : /[\u3040-\u30ff\uac00-\ud7af]/.test(ch) ? 1 : /[a-z0-9]/i.test(ch) ? .35 : 0;
const wlen = t => [...t].reduce((a, ch) => a + W(ch), 0);
function syncMap(buf, text) {
  const tot = wlen(text) || 1, bounds = [];
  let acc = 0;
  for (const ch of text) { acc += W(ch); if (/[、。，,！!？?…；;：:.]/.test(ch) && acc > 0 && acc < tot) bounds.push(acc / tot); }
  const d = buf.getChannelData(0), sr = buf.sampleRate, hop = Math.round(sr * .02), n = Math.floor(d.length / hop), e = new Float32Array(n);
  for (let f = 0; f < n; f++) { let q = 0; for (let i = f * hop; i < (f + 1) * hop; i += 4) q += d[i] * d[i]; e[f] = Math.sqrt(q * 4 / hop); }
  const th = e.reduce((a, x) => Math.max(a, x), 0) * .06, T = f => f * hop / sr;
  let a = 0, z = n - 1;
  while (a < n && e[a] < th) a++;
  while (z > a && e[z] < th) z--;
  const gaps = [];
  for (let f = a, st = -1; f <= z; f++) if (e[f] < th) { if (st < 0) st = f; } else { if (st >= 0 && f - st >= 6) gaps.push(T((st + f) / 2)); st = -1; }
  const t0 = T(a), t1 = T(z + 1), pts = [[t0, 0]];
  let used = -1;
  for (const k of bounds) {
    const guess = t0 + k * (t1 - t0);
    let best = -1, bd = (t1 - t0) * .15;
    gaps.forEach((g, i) => { if (i > used && Math.abs(g - guess) < bd) { bd = Math.abs(g - guess); best = i; } });
    if (best >= 0) { pts.push([gaps[best], k]); used = best; }
  }
  pts.push([t1, 1]);
  return t => { if (t <= t0) return 0; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [ta, ka] = pts[i - 1], [tb, kb] = pts[i]; return ka + (kb - ka) * (t - ta) / (tb - ta || 1); } return 1; };
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
const noiseOn = k => { live[k] = noiseNode(actx(), k, master, vol(k)); };
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


/* ---------- 书店：背景、飘着的小东西、书架（一本书一个书脊）、柜台上的怀表和瓶子 ---------- */
let scene = null, draws = 0, watching = false;
const bgOf = () => `assets/radio/bg-${isNight() ? 'night' : 'day'}.webp`;
// 手机换了白天 / 夜间：书店、读书页换图（先解码好再换，不闪）
function watchMode() {
  if (watching) return; watching = true;
  new MutationObserver(() => { const src = bgOf(), im = new Image(), go = () => document.querySelectorAll('.is-rd-bg').forEach(el => el._bg(src)); im.src = src; im.decode().then(go, go); })
    .observe(document.querySelector('.as-phone'), { attributes: true, attributeFilter: ['data-mode'] });
}
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
  watchMode();
  const room = h('div.as-rd__room.is-rd-bg', { style: { backgroundImage: `url(${bgOf()})` } },
    FALL.map(([n, x, w, t, s]) => h('img.as-rd__fall', { src: `assets/radio/prop${n}.webp`, alt: '', style: { left: x + '%', width: w + '%', animationDelay: -t + 's', animationDuration: s + 's' } })),
    watch, h('div.as-rd__bottles', bottles));
  room._bg = src => { room.style.backgroundImage = `url(${src})`; };
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
  // 最多补写几次：和幕间设置里那行一样，1～10
  const fillN = h('output', (S().fillMax || 3) + ' 次'), fillR = h('div.as-settings-slider-row', { hidden: !S().fill }, h('span', '最多补写'),
    slider({ min: 1, max: 10, step: 1, value: S().fillMax || 3, onInput: v => { S().fillMax = v; fillN.textContent = v + ' 次'; commit('music'); } }), fillN);
  sheet({ title: '电台设置', content: h('div.as-rd-set', who,
    group('什么时候合成', [segmented(TTS, S().tts, v => set('tts', v))]),
    group('', [toggleItem({ title: '故事讲完接着念感想' }, S().say, v => set('say', v))]),
    group('随便讲的长短', [segmented([['short', '短'], ['mid', '中'], ['long', '长']], S().len, v => set('len', v))]),
    group('', [toggleItem({ title: withInfo('写到一半断了自动补写', 'AI 写到一半被字数上限截断时，把写出来的给它，让它接着写完。每补一次多找一次 AI。') }, !!S().fill, v => { set('fill', v); fillR.hidden = !v; }), fillR]),
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

/* ---------- 调这一段的语气：照正文朗读的「🎭 这句的演法」——一键演法 / 按类分页的标签（上面一排大标签切换）、张力、语速、
   会发给语音接口的样子；「生成一版试听」可以反复生成、来回对比，保存时只留选中的那版（以后就放它，不再合成） ---------- */
function actEditor(b, i, onSaved) {
  const seg = lines(b)[i], conn = connFor(b.who), prof = profileOf(conn), k = prof.k, key = `radio:a:${b.id}:${b.lang}:${i}`;
  const ta = h('textarea.as-ra-script', { rows: 3, spellcheck: false });
  ta.value = seg.s || seg.t;
  let t = seg.ten || 2, pace = seg.pace || 'normal', base = null, sel = null, chosen = null, dirty = false, takes = [], src = null;
  const keepSel = () => { sel = [ta.selectionStart, ta.selectionEnd]; };
  ['select', 'keyup', 'click', 'input', 'blur'].forEach(ev => ta.addEventListener(ev, keepSel));
  ta.addEventListener('input', () => { base = null; dirty = true; prev(); });
  const segRow = (label, list, get, set) => {
    const box = h('div.as-ra-seg', list.map(([v, l]) => h('button', { dataset: { v }, onclick: () => { set(v); paintSeg(box, v); dirty = true; prev(); } }, l)));
    paintSeg(box, get()); return h('div.as-ra-set', h('span', label), box);
  };
  const paintSeg = (box, v) => [...box.children].forEach(x => x.classList.toggle('is-on', x.dataset.v === String(v)));
  const tRow = segRow('张力', TENSIONS, () => t, v => { t = +v; }), pRow = segRow('语速', PACES, () => pace, v => { pace = v; });
  const pv = h('div.as-ra-prev');
  const prev = () => { const a = adapt(conn || {}, readAloud(ta.value.trim() || seg.t), t); pv.replaceChildren(h('b', `会发给 ${conn ? conn.name : '（还没设语音接口）'}：`), a.text, Object.keys(a.act).length ? ` · 参数 ${JSON.stringify(a.act)}` : ''); };
  // 正文开始的位置（跳过开头的标签）；在光标处插（没点过就插在开头）
  const leadEnd = v => (v.match(/^\s*(?:\[[^\]\n]{1,40}\]\s*)*/) || [''])[0].length;
  const isWord = c => /[\p{L}\p{N}]/u.test(c), SMALL = 'っッぁぃぅぇぉゃゅょゎァィゥェォャュョヮー';
  const firstWord = v => { for (let j = leadEnd(v); j < v.length; j++) if (isWord(v[j]) && !SMALL.includes(v[j])) return j; return -1; };
  function insert(v) {
    const s0 = ta.value;
    let [x, y] = sel || [null, null];
    if (x == null) x = y = /^\[/.test(v) ? 0 : leadEnd(s0);
    const add = /^\[/.test(v) && x > 0 && !/\s|\]/.test(s0[x - 1]) ? ` ${v} ` : /^\[/.test(v) ? `${v} ` : v;
    ta.value = s0.slice(0, x) + add + s0.slice(y); sel = [x + add.length, x + add.length]; ta.focus(); ta.setSelectionRange(...sel);
  }
  function transform(kind) {
    let v = ta.value;
    const j = firstWord(v);
    if (kind === 'stutter-first' && j >= 0) v = v.slice(0, j) + v[j] + '、' + v.slice(j);
    if (kind === 'stutter-cursor') { let c = (sel || [v.length])[0] - 1; while (c >= 0 && !isWord(v[c])) c--; if (c >= 0) v = v.slice(0, c + 1) + '、' + v[c] + v.slice(c + 1); }
    if (kind === 'drag-first' && j >= 0) v = v.slice(0, j + 1) + '……' + v.slice(j + 1);
    if (kind === 'drag-tail') v = v.replace(/[。．.！!？?~～…]*\s*$/, '') + '~……';
    if (kind === 'shatter') { const l = v.slice(0, leadEnd(v)); v = l + v.slice(l.length).replace(/[，,、]\s*/g, '……').replace(/(……){2,}/g, '……'); }
    ta.value = v; sel = null;
  }
  // 整段生效的接口：情绪放开头；MiniMax 只认一个情绪，换掉原来的
  function leadTag(v, group) {
    let body = ta.value;
    if (k !== 'sentence') body = body.replace(/\[([^\]\n]{1,40})\]\s*/g, (all, w) => MM_EMOS.has(w.trim().toLowerCase()) ? '' : all);
    const lead = (body.match(/^\s*(?:\[[^\]\n]{1,40}\]\s*)*/) || [''])[0], tags = (lead.match(/\[[^\]]+\]/g) || []).filter(x => x !== v);
    ta.value = `${[...(k === 'sentence' ? tags.slice(-1) : tags), v].join('')} ${body.slice(lead.length).trim()}`; sel = null;
  }
  function preset(p, btnEl) {
    if (!base) base = ta.value.replace(/^\s*(?:\[[^\]\n]{1,40}\]\s*)*/, '').trim() || seg.t;   // 连着点几个一键演法都套在同一个底稿上
    const tags = fitTags(p.tags, k).map(x => `[${x}]`).join('');
    ta.value = `${tags}${tags ? ' ' : ''}${base}`;
    if (p.stutter) { const j = firstWord(ta.value); if (j >= 0) ta.value = ta.value.slice(0, j) + ta.value[j] + '、' + ta.value.slice(j); }
    if (p.tail) ta.value = ta.value.replace(/[。．.！!~～]*\s*$/, '') + p.tail;
    if (p.pre) { const v = ta.value, at = leadEnd(v); ta.value = v.slice(0, at) + p.pre[/[぀-ヿ]/.test(seg.t) ? 1 : 0] + v.slice(at); }
    t = p.t; pace = p.p; paintSeg(tRow.lastChild, t); paintSeg(pRow.lastChild, pace); sel = null;
    btnEl.parentNode.querySelectorAll('.is-sel').forEach(x => x.classList.remove('is-sel')); btnEl.classList.add('is-sel');
  }
  // 上面一排大标签切换，下面只露出这一类
  const groups = groupsFor(k, seg.t), panes = [['preset', '一键演法', PRESETS.map(p => h('button.is-preset', { onclick: e => { preset(p, e.currentTarget); dirty = true; prev(); } }, p.label))],
    ...groups.map(g => [g.key, g.label, g.items.map(([l, v]) => h('button', { onclick: () => {
      if (v.startsWith('@')) transform(v.slice(1)); else if (/^\[.*\]$/.test(v) && (k === 'mm' || k === 'mm28' || k === 'sentence') && (g.key === 'emo' || (k === 'sentence' && g.key === 'voice'))) leadTag(v); else insert(v);
      dirty = true; prev();
    } }, l))])].map(([id, label, items]) => ({ id, label, el: h('div.as-ra-chips', { hidden: id !== 'preset' }, items) }));
  const tabs = h('div.as-ra-tabs', panes.map(x => h('button', { class: x.id === 'preset' ? 'is-on' : '', onclick: e => { [...tabs.children].forEach(y => y.classList.toggle('is-on', y === e.currentTarget)); panes.forEach(y => { y.el.hidden = y !== x; }); } }, x.label)));
  // 试听对比：每生成一版记一版，能来回放、选一版
  const stopPlay = () => { if (src) { src.onended = null; src.stop(); src = null; } };
  async function playUrl(url, p) {
    stopPlay(); pause(); actx();
    const buf = stretch(await ac.decodeAudioData(await (await fetch(url)).arrayBuffer()), rate() * (PACE_SPEED[p] || 1));
    src = ac.createBufferSource(); src.buffer = buf; src.connect(master); src.start();
  }
  const takesBox = h('div.as-ra-takes', { hidden: true });
  function paintTakes() {
    takesBox.hidden = !takes.some(Boolean);
    const row = (key, label) => h('div.as-ra-take' + (chosen === key ? '.is-sel' : ''), h('button', { onclick: async () => {
      if (key === 'orig') { const got = await kvGet(key0).catch(() => null); if (!got) return toast('原来那版还没合成过'); return playUrl(URL.createObjectURL(got), seg.pace); }
      playUrl(takes[key].url, takes[key].pace);
    } }, '▶'), h('span', label), h('button.is-use', { onclick: () => {
      chosen = key; const x = key === 'orig' ? { script: seg.s || seg.t, t: seg.ten || 2, pace: seg.pace || 'normal' } : takes[key];
      ta.value = x.script; t = x.t; pace = x.pace; paintSeg(tRow.lastChild, t); paintSeg(pRow.lastChild, pace); prev(); paintTakes();
    } }, chosen === key ? '✓ 选中' : '用这版'), key === 'orig' ? null : h('button.is-del', { onclick: () => { URL.revokeObjectURL(takes[key].url); takes[key] = null; if (chosen === key) chosen = null; paintTakes(); } }, '✕'));
    takesBox.replaceChildren(row('orig', h('span', h('b', '原来的'), '改之前的')), ...takes.map((x, j) => x && row(j, h('span', h('b', `#${j + 1}`), `张力 ${x.t} · ${(PACES.find(p => p[0] === x.pace) || [])[1]} · ${x.script}`))));
  }
  const key0 = key;
  const gen = h('button.as-ra-play', { onclick: () => busy(gen, async stop => {
    if (!conn) throw new Error('还没设语音接口');
    const script = ta.value.trim() || seg.t;
    const url = await synthesize(conn, readAloud(script), { voice: voiceOf(b.who, conn).voice, acted: true, t, stop });
    if (stop.aborted) return;
    takes.push({ script, t, pace, url }); chosen = takes.length - 1; dirty = true; paintTakes();
    playUrl(url, pace);
  }).then(() => { gen.textContent = takes.some(Boolean) ? '▶ 再生成一版' : '▶ 生成一版试听'; }, e => toast('没生成出来：' + e.message)) }, '▶ 生成一版试听');
  const reset = h('button', { onclick: () => { ta.value = plain(ta.value) || seg.t; base = null; dirty = true; prev(); } }, '去掉标签');
  let saved = false;
  async function doSave() {
    saved = true; stopPlay();
    const v = ta.value.trim(), text = plain(v);
    if (!text) return toast('还没有字');
    const same0 = v === (seg.s || seg.t) && t === (seg.ten || 2);
    Object.assign(seg, { t: text, s: v === text ? undefined : v, ten: t === 2 ? undefined : t, pace: pace === 'normal' ? undefined : pace });
    const tk = typeof chosen === 'number' && takes[chosen];
    if (tk && tk.script === v && tk.t === t) await kvSet(key, await (await fetch(tk.url)).blob()).catch(() => {});   // 选中的那版就是以后放的，不再合成
    else if (!same0) await kvDel(key).catch(() => {});
    if (E.book === b && E.i === i && !E.on) { E.raw = E.buf = null; E.off = 0; }
    takes.forEach(x => x && URL.revokeObjectURL(x.url));
    await save(); onSaved(); sh.close(); toast('存好了');
  }
  const sh = sheet({ title: '调这一段的语气', cls: 'as-ra', onClose: async () => {
    stopPlay();
    if (saved || !(dirty || takes.some(Boolean))) return takes.forEach(x => x && URL.revokeObjectURL(x.url));
    if (await dialog({ title: '这次改的还没保存', text: '试听只留选中的那版', confirm: '保存', cancel: '不保存' })) return doSave();
    takes.forEach(x => x && URL.revokeObjectURL(x.url));
  }, content: h('div.as-ra-body',
    h('div.as-ra-ch' + (k === 'plain' ? '.is-plain' : ''), h('b', '🔈 ' + prof.name), h('span', prof.note)),
    h('div.as-ra-orig', '原文：' + seg.t), ta, tRow, pRow, pv, tabs, panes.map(x => x.el),
    h('div.as-ra-acts', gen, reset), takesBox,
    h('div.as-rd-imp__row', btn('取消', 'secondary', () => sh.close()), btn('保存', 'primary', doSave))) });
  prev();
}

/* ---------- 读书：书摊开（左页这一段、右页下一段，都只放中文）；书下面像一起听，TA 的头像 + 气泡里是正在念的原文和翻译；按钮都在最底下 ---------- */
function openBook(b) {
  if (E.book !== b) { stopStory(); E.book = b; E.i = Math.min(b.pos || 0, lines(b).length - 1); }
  const c = contact(b.who) || {};
  let gls = null;   // 气泡的液态玻璃
  const more = async () => {
    const v = await actionSheet(b.title, [{ value: 'set', label: '设置' },
      b.after && { value: 'again', label: '重新说感想' }, { value: 'del', label: '删除', danger: true }].filter(Boolean));
    if (v === 'set') settings(contact(b.who));
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
  const shade = ['rgba(12,10,24,.6)', 'rgba(12,10,24,.78)'];
  p.el.classList.add('is-rd-bg');
  p.el._bg = src => { p.el.style.backgroundImage = `linear-gradient(${shade.join(', ')}), url(${src})`; if (gls) { gls.dispose(); row.lastChild.querySelector('.as-glass-cv')?.remove(); gls = glass(row.lastChild, p.el, src, shade); } };
  p.el._bg(bgOf());
  const book = h('div.as-rd-book', { 'data-no-swipe': '' }, h('img', { src: 'assets/radio/book.webp', alt: '' }), L, R);
  // 照相馆做过立绘的：讲的时候站在左边，出声时动嘴
  const stand = h('div.as-rd-stand'); let fig = null, talking = false;
  PT.load(b.who).then(() => { fig = PT.figure(b.who); if (fig) { stand.append(fig); paint(); } });
  p.el.append(stand);
  const say = h('div.as-rd-say', row);
  p.body.append(book, say,
    h('div.as-rd-bottom', h('div.as-rd-count', count, langB, h('button.as-rd-lang', { onclick: () => actSheet(E.i) }, '调语气')), h('div.as-rd-tools', rateB, h('button', { onclick: noiseSheet }, '白噪音'), ttsB, afterB),
      h('div.as-rd-ctl', h('button', { 'aria-label': '上一段', onclick: () => go(E.i - 1) }, icon('prev', 24, 2)), playB, h('button', { 'aria-label': '下一段', onclick: () => go(E.i + 1) }, icon('next', 24, 2)))));
  // 气泡要一眼看全：放不下就把字一点点调小（最小 10px），不让它滚动
  row._fit = () => { const q = row.lastChild, room = say.clientHeight - parseFloat(getComputedStyle(say).paddingTop) - parseFloat(getComputedStyle(say).paddingBottom); let f = 15; q.style.fontSize = ''; while (row.offsetHeight > room && f > 10) q.style.fontSize = (f -= .5) + 'px'; gls && gls.refresh(); };
  styleBub(row);
  row.addEventListener('animationend', () => gls && gls.refresh());
  new ResizeObserver(() => row._fit()).observe(say);   // 页面刚排好、屏幕大小变了时再量一次
  function toggle() { if (E.on || E.wait) pause(); else resume(); }
  const actSheet = i => actEditor(b, i, () => { shown = -1; tell(); });
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
    stand.classList.toggle('is-on', !!fig && (E.on || E.wait));
    count.textContent = `${E.i + 1} / ${all.length}`;
    playB.replaceChildren(E.wait ? h('span.as-spin') : icon(E.on ? 'pause' : 'play', 26, 2.4));
    afterB.textContent = b.after ? '看感想' : '说说感想'; langB.textContent = lname(b.lang); ttsB.textContent = TTS.find(x => x[0] === S().tts)[1];
  }
  // 气泡只放正在念的这一两句（像歌词）：原文按句子分成几小块（一块最多 60 字），翻译按长短比例分到同样几块，跟着念的进度换块
  let chunks = [], ci = -1;
  function cut(s) {
    const o = sents(s.t).reduce((a, x) => { if (a.length && (a[a.length - 1] + x).length <= 60) a[a.length - 1] += x; else a.push(x); return a; }, []).map(x => x.trim());
    const n = o.length, len = wlen(o.join('')) || 1, tr = o.map(() => '');
    let at = 0;
    chunks = o.map((t, i) => { const a = at / len; at += wlen(t); return { t, a, b: i === n - 1 ? 1 : at / len }; });
    // 翻译切到逗号这么细（中文常一逗到底），每一小截按它在整段里的位置分给对应的块
    const ts = s.tr && (s.tr.match(/[^，,、；;。！？!?…]+[，,、；;。！？!?…」』”"]*\s*/g) || [s.tr]);
    if (s.tr) { let q = 0; const tl = s.tr.length; for (const x of ts) { const mid = (q + x.length / 2) / tl; q += x.length; tr[Math.max(0, chunks.findIndex(c => mid <= c.b))] += x; } }
    chunks.forEach((c, i) => { c.tr = tr[i].trim(); });
  }
  // 念到这一段的哪儿了（0~1）；还在合成是 0，没在念就是 null
  const where = () => {
    if (E.book !== b) return null;
    if (E.buf) return E.map(E.src ? ac.currentTime - E.t0 : E.off);
    if (E.spk) return E.spk.ci != null ? E.spk.ci / E.spk.n : (performance.now() - E.spk.at) / (E.spk.n * E.spk.per);
    return E.wait ? 0 : null;
  };
  const tick = () => {
    if (!p.el.isConnected) { gls && gls.dispose(); return clearInterval(iv); }
    const k = where(), j = k == null ? 0 : Math.max(0, chunks.findIndex(c => k < c.b)), c = chunks[j], t = !!fig && E.book === b && E.on && !E.wait;
    if (t !== talking) { talking = t; fig.pt.talk(t); }
    if (!c) return;
    if (j !== ci) {
      ci = j; sayT.textContent = c.tr || c.t; sayTr.textContent = c.tr ? c.t : ''; sayTr.parentNode.hidden = !c.tr;   // 有中文翻译时中文当大字、原文小字（和幕间一样） row._fit();
      if (k != null && j) { row.classList.remove('is-turn'); void row.offsetWidth; row.classList.add('is-turn'); }
    }
    row.style.setProperty('--p', (k == null ? 100 : Math.min(100, Math.max(0, (k - c.a) / (c.b - c.a)) * 100)).toFixed(1) + '%');
  };
  const iv = setInterval(tick, 200);
  nav.push(p.el); gls = glass(row.lastChild, p.el, bgOf(), shade); subs.add(paint); paint(); tick();
}
