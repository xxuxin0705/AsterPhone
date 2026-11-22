// 短信：正文里有人发来短信（暗号 type="短信"）就收进来，顶上弹横幅、图标挂红点；样子和查手机里的「信息」是同一套（apps.js 的 iosPage），外语右上「译」一下全换。
// 你发了不会自动回，点「让 TA 回」才找 AI，点一下调一次；同一个对话同一时间只有一个在跑（AbortController 放在模块里，退出再进来还是「取消」）。
import { h, uid } from '../../core/util.js';
import { state, commit, chatForContact } from '../../core/store.js';
import { icon, toast, dialog, waiting, aiCount } from '../../core/ui.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName } from '../../core/promptstore.js';
import { storyText, C } from '../../core/context.js';
import { langName, langFor } from '../../core/translate.js';
import * as time from '../../core/time.js';
import * as nav from '../../core/nav.js';
import { shell } from '../../core/shell.js';
import { renderBadges } from '../home/home.js';
import { nameOf, personaOf, worldBlock, takeTr, parseReply } from '../chat/engine.js';
import { iosPage, swipe, ava, when, far, bigTitle } from '../peek/apps.js';

const jobs = {}, views = new Map();
const person = n => state.contacts.find(p => [p.name, p.nick, p.remark].includes(n));
const title = t => { const c = person(t.who); return c ? nameOf(c) : t.who; };
const mk = m => m.tr ? `${m.text}[翻译：${m.tr}]` : m.text, face = t => person(t.who)?.avatar || '', at = m => time.stampText(m);
const save = () => { commit('sms'); renderBadges(); };
const put = (t, me, line) => { const [text, tr] = me ? [line, ''] : takeTr(line); t.list.push({ id: uid('s'), me, text, tr, ...time.stamp() }); };
const toTop = t => { state.sms.splice(state.sms.indexOf(t), 1); state.sms.unshift(t); };

export function receive(from, body) {
  const lines = String(body).split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  let t = state.sms.find(x => x.who === from);
  if (!t) state.sms.unshift(t = { id: uid('sm'), who: from, unread: 0, list: [] }); else toTop(t);
  lines.forEach(l => put(t, false, l));
  if (shell.activeChat !== t.id || !shell.visible) t.unread += lines.length;
  save(); views.get(t.id)?.();
  const m = t.list.at(-1);
  shell.notify({ chatId: t.id, app: 'sms', title: title(t), text: m.text, avatarUrl: face(t) });
}

async function reply(t, stop) {
  const c = person(t.who), st = storyText(Math.min(4, C().count)) || '（暂无）';
  const l = langFor('chat', c && chatForContact(c.id, false)?.cfg.speak), zhL = !l || /^zh/.test(l);
  const raw = await generate({ conn: resolveConn('text', state.apps.sms.conn.text === 'follow' ? 'chat' : 'sms'), system: '', app: '短信', stop,
    prompt: compose('smsReply', { who: c ? `${nameOf(c)}${personaOf(c) ? '\n' + personaOf(c).slice(0, 800) : ''}` : `${t.who}（不在通讯录里的号码或机构）`,
      story: st, time: time.forPrompt(), world: (await worldBlock(st, c ? [c] : [], '', '', false, 'sms')).world,
      history: t.list.slice(-30).map(m => `${m.me ? myName() : t.who}：${m.text}`).join('\n'),
      lang: zhL ? '' : `\n- 用${langName(l)}写，每条末尾附 [翻译：简体中文意思]。` }) });
  const got = parseReply(raw, c).lines.filter(x => !/^[（(]?不回[）)]?$/.test(x)).slice(0, 6);
  got.forEach(x => put(t, false, x));
  if (got.length) { toTop(t); save(); }
  return got.length;
}

export function open(opts = {}) {
  const { el, body } = iosPage('sms', 'sms-main');
  const head = h('div.pk-top2', h('b', '信息')), big = h('h1', '信息'), box = h('div.pk-msgs');
  bigTitle(head, big);
  // 左滑删除、右滑标成已读 / 未读（照作者录的 iPhone 视频）
  const del = async (t, w) => {
    if (!await dialog({ title: '删除这段对话？', confirm: '删除', danger: true })) return;
    jobs[t.id]?.abort(); state.sms.splice(state.sms.indexOf(t), 1); save(); sig = key();
    w.animate([{ height: w.offsetHeight + 'px', opacity: 1 }, { height: 0, opacity: 0 }], { duration: 260, easing: 'ease-in' }).finished.then(() => w.remove()); };
  const row = t => { const m = t.list.at(-1), r = h('button.pk-msg' + (t.unread ? '.is-new' : ''), { onclick: () => thread(t) }, ava(title(t), face(t)),
      h('div', h('b', h('span', title(t)), h('time', when(at(m))), icon('chevron', 14, 2.6)), h('span', mk(m))));
    return swipe(r, [['trash', '#ff3b30', w => del(t, w)]], [['chatdots', '#007aff', () => { t.unread = t.unread ? 0 : 1; r.classList.toggle('is-new', !!t.unread); save(); sig = key(); }]]); };
  const key = () => state.sms.map(t => t.id + t.list.length + !!t.unread).join();
  let sig = null;
  const paint = () => { const s = key(); if (s === sig) return; sig = s; box.replaceChildren(...(state.sms.length ? state.sms.map(row) : [h('small.pk-meta', '还没有短信')])); };
  paint(); el._onShow = paint; body.append(head, big, box);
  if (opts.chat) { const t = state.sms.find(x => x.id === opts.chat); if (t) setTimeout(() => thread(t)); }
  return el;
}
export function reveal(opts = {}) { const t = state.sms.find(x => x.id === opts.chat); if (t && shell.activeChat !== t.id) thread(t); }

function thread(t) {
  const { el, body } = iosPage('sms', 'sms-thread', '.pk-sms');
  const top = h('div.pk-top2.is-chat', h('button.pk-glass.pk-backpill', { 'aria-label': '返回', onclick: () => nav.back() }, icon('back', 24, 2.4)),
    h('div.pk-peer', ava(title(t), face(t)), h('b.pk-glass', h('span', title(t)), icon('chevron', 12, 2.6))));
  const bub = (m, i) => { const p = t.list[i - 1], n = t.list[i + 1], a = at(m), gap = p && far(at(p), a);
    return [gap ? h('small.pk-meta.is-gap', when(a, true)) : null, h('div.pk-bub' + (m.me ? '.is-me' : '') + (!n || n.me !== m.me || at(n) !== a ? '.is-tail' : ''), mk(m))]; };
  let shown = 0;
  const add = () => { const L = t.list, last = body.querySelector('.pk-bub:last-of-type');
    if (last && L[shown] && L[shown].me === L[shown - 1]?.me && at(L[shown]) === at(L[shown - 1])) last.classList.remove('is-tail');
    float.before(...L.slice(shown).flatMap((m, k) => bub(m, shown + k)).filter(Boolean)); shown = L.length;
    t.unread = 0; save(); body.scrollTop = body.scrollHeight; };
  const input = h('textarea.pk-find__in', { rows: 1, placeholder: '信息 · 短信', oninput: () => paint() });
  const send = () => { put(t, true, input.value.trim()); toTop(t); input.value = ''; save(); add(); paint(); };
  const ask = () => {
    if (jobs[t.id]) { jobs[t.id].abort(); return; }
    const ac = jobs[t.id] = new AbortController(); paint();
    waiting(`等 ${title(t)} 回…`, s => reply(t, s), ac).then(n => { views.get(t.id)?.(); n != null && toast(n ? 'TA 回你了' : 'TA 没回你'); }, e => toast(e.message)).finally(() => { delete jobs[t.id]; paint(); });
  };
  // 右下那个键：打了字是发送；没打字是「让 TA 回」（点一次找一次 AI），在等的时候是取消
  const act = h('button.pk-glass.is-round.pk-ask', { onclick: () => (input.value.trim() && !jobs[t.id] ? send() : ask()) });
  const float = h('div.pk-float', h('div.pk-glass.pk-find', input), act);
  function paint() { const busy = !!jobs[t.id], typed = !!input.value.trim() && !busy;
    act.classList.toggle('is-busy', busy); act.setAttribute('aria-label', busy ? '取消' : typed ? '发送' : '让 TA 回');
    act.replaceChildren(...(busy ? [h('span.as-spin'), aiCount()] : [icon(typed ? 'send' : 'sparkle', 22, 2)])); }
  body.append(top, h('small.pk-meta', '信息 · 短信', h('br'), when(at(t.list[0]), true)), float);
  views.set(t.id, add); shell.activeChat = t.id;
  const leave = el._onLeave; el._onLeave = () => { leave(); views.delete(t.id); if (shell.activeChat === t.id) shell.activeChat = null; };
  nav.push(el); add(); paint();
}
