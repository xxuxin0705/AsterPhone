// 短信：正文里有人发来短信（暗号 type="短信"）就收进来，顶上弹横幅、图标挂红点；不是中文的带 TA 口吻的翻译，右上「译」一下全换。
// 你发了不会自动回，点「让 TA 回」才找 AI，点一下调一次；同一个对话同一时间只有一个在跑（AbortController 放在模块里，退出再进来还是「取消」）。
import { h, uid } from '../../core/util.js';
import { state, commit, chatForContact } from '../../core/store.js';
import { page, navBtn, navText, empty, toast, dialog, waiting, aiCount, avatar } from '../../core/ui.js';
import { generate, resolveConn } from '../../core/api.js';
import { compose, myName } from '../../core/promptstore.js';
import { storyText, C } from '../../core/context.js';
import { langName, langFor } from '../../core/translate.js';
import * as time from '../../core/time.js';
import * as nav from '../../core/nav.js';
import { shell } from '../../core/shell.js';
import { renderBadges } from '../home/home.js';
import { nameOf, personaOf, worldBlock, takeTr, parseReply } from '../chat/engine.js';

const jobs = {}, views = new Map();
let zh = false;
const person = n => state.contacts.find(p => [p.name, p.nick, p.remark].includes(n));
const title = t => { const c = person(t.who); return c ? nameOf(c) : t.who; };
const txt = m => (zh && m.tr) || m.text;
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
  shell.notify({ chatId: t.id, app: 'sms', title: title(t), text: txt(m), avatarUrl: person(from)?.avatar || '' });
}

async function reply(t, stop) {
  const c = person(t.who), st = storyText(Math.min(4, C().count)) || '（暂无）';
  const l = langFor('chat', c && chatForContact(c.id, false)?.cfg.speak), zhL = !l || /^zh/.test(l);
  const raw = await generate({ conn: resolveConn('text', 'sms'), system: '', app: '短信', stop,
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
  const p = page({ app: 'sms', id: 'sms-main', title: '短信', large: true, back: true });
  const box = h('div.as-sms-list');
  const row = t => { const m = t.list.at(-1);
    return h('button.as-sms-row', { onclick: () => thread(t) }, h('i.as-sms-row__dot' + (t.unread ? '.is-on' : '')), avatar(person(t.who)?.avatar || '', title(t), 46),
      h('span.as-sms-row__main', h('b', title(t)), h('small', m ? txt(m) : '')), h('time', m ? time.shortLabel(m) : '')); };
  let sig = null;
  const paint = () => { const s = state.sms.map(t => t.id + t.list.length + t.unread).join() + zh; if (s === sig) return; sig = s;
    box.replaceChildren(...(state.sms.length ? state.sms.map(row) : [empty('还没有短信')])); };
  paint(); p.el._onShow = paint; p.body.append(box);
  if (opts.chat) { const t = state.sms.find(x => x.id === opts.chat); if (t) setTimeout(() => thread(t)); }
  return p.el;
}
export function reveal(opts = {}) { const t = state.sms.find(x => x.id === opts.chat); if (t && shell.activeChat !== t.id) thread(t); }

function thread(t) {
  const trB = navText('译', () => { zh = !zh; trB.textContent = zh ? '原' : '译'; list.querySelectorAll('[data-i]').forEach(b => { b.textContent = txt(t.list[b.dataset.i]); }); });
  const del = navBtn('trash', '删除', async () => {
    if (!await dialog({ title: '删除和 TA 的短信？', confirm: '删除', danger: true })) return;
    jobs[t.id]?.abort(); state.sms.splice(state.sms.indexOf(t), 1); save(); nav.back(); });
  const pg = page({ app: 'sms', id: 'sms-thread', title: title(t), back: true, right: [trB, del] });
  const list = h('div.as-sms-thread');
  const bubble = (m, i) => [time.sepLabel(m, t.list[i - 1]) && h('div.as-sms-sep', time.sepLabel(m, t.list[i - 1])), h('div.as-sms-b' + (m.me ? '.is-me' : ''), { dataset: { i } }, txt(m))];
  const add = () => { list.append(...t.list.slice(list.querySelectorAll('[data-i]').length).flatMap((m, k, a) => bubble(m, t.list.length - a.length + k)).filter(Boolean));
    trB.textContent = zh ? '原' : '译'; trB.hidden = !t.list.some(m => m.tr); t.unread = 0; save(); pg.body.scrollTop = pg.body.scrollHeight; };
  const input = h('textarea.as-sms-in', { rows: 1, placeholder: '短信', oninput: () => paint() });
  const sendB = h('button.as-sms-send', { 'aria-label': '发送', onclick: () => { put(t, true, input.value.trim()); toTop(t); input.value = ''; save(); add(); paint(); } }, '发送');
  const ask = h('button.as-sms-send', { onclick: () => {
    if (jobs[t.id]) { jobs[t.id].abort(); return; }
    const ac = jobs[t.id] = new AbortController(); paint();
    waiting(`等 ${title(t)} 回…`, s => reply(t, s), ac).then(n => { views.get(t.id)?.(); n != null && toast(n ? 'TA 回你了' : 'TA 没回你'); }, e => toast(e.message)).finally(() => { delete jobs[t.id]; paint(); });
  } });
  function paint() { const typed = !!input.value.trim(); sendB.hidden = !typed; ask.hidden = typed;
    ask.replaceChildren(...(jobs[t.id] ? [h('span.as-spin'), aiCount(), '取消'] : ['让 TA 回'])); }
  views.set(t.id, add); shell.activeChat = t.id;
  pg.el._onLeave = () => { views.delete(t.id); if (shell.activeChat === t.id) shell.activeChat = null; };
  pg.el.classList.add('as-sms');
  pg.body.append(list); pg.el.append(h('div.as-sms-bar', input, sendB, ask));
  nav.push(pg.el); add(); paint();
}
