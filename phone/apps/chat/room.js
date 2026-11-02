// 私聊界面：气泡、时间线、正在输入、发送 /「让 TA 回复」变形按钮、长按菜单、多选、拍一拍、聊天设置、注入记录。
import { h, onLongPress } from '../../core/util.js';
import { state, commit, contact, getMsgs, saveMsgs, clearMsgs } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, slider, avatar, icon, navBtn, actionSheet, dialog, toast, sheet, btn, field, input, pickImage, rangeRow, withInfo } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { connLabel } from '../../core/api.js';
import * as E from './engine.js';
import * as P from '../../core/promptstore.js';
import { openProfile } from './people.js';
import { buildBubble, PLUS, plusAction as doPlus, stickerPanel } from './specials.js';
import { groupAvatar, openGroupSettings } from './group.js';
import { LANGS, langName } from '../../core/translate.js';
import * as Mu from '../../core/music.js';

const EMOJI = ['❤️', '😂', '😮', '😢', '👍', '🙏'];

/** 头像怎么显示：谁显示、多大、多圆。旧数据里的 showAvatar / avatarShape 也认 */
export function avatarCfg(cfg) {
  const who = cfg.avatarWho || (cfg.showAvatar === false ? 'none' : 'both');
  const size = cfg.avatarSize || 38;
  const radius = cfg.avatarRadius ?? (cfg.avatarShape === 'square' ? 24 : 50);
  return { who, size, radius, me: who === 'both' || who === 'me', them: who === 'both' || who === 'them' };
}
export function chatAvatar(url, name, cfg) {
  const a = avatarCfg(cfg), el = avatar(url, name, a.size);
  el.style.borderRadius = a.radius + '%';
  return el;
}
const hm = m => time.isStory() && m.st ? `${String(Math.floor(m.st.m / 60)).padStart(2, '0')}:${String(m.st.m % 60).padStart(2, '0')}` : new Date(m.at).toTimeString().slice(0, 5);
/** 两条消息之间要不要放一条时间线：隔了一小时以上、或者换了一天才放 */
function sepFor(m, prev) {
  if (!prev) return time.sepLabel(m, null);
  const sameDay = time.isStory() && m.st && prev.st ? m.st.d === prev.st.d : new Date(m.at).toDateString() === new Date(prev.at).toDateString();
  const gap = time.isStory() && m.st && prev.st ? (m.st.d - prev.st.d) * 1440 + m.st.m - prev.st.m : (m.at - prev.at) / 60000;
  return sameDay && gap < 60 && gap > -1 ? '' : time.sepLabel(m, null);
}
const solo = m => m.from === 'sys' || m.recalled;
const PAGE_SIZE = 80;

export async function openRoom(chat) {
  const g = E.isGroup(chat);
  const c = g ? { id: null, name: chat.name, nick: '', remark: '', avatar: chat.avatar, sign: chat.intro, pokeSuffix: '' } : contact(chat.contactId);
  if (!c) { toast('这个联系人不在了'); return; }
  const title = () => g ? E.groupTitle(chat) : E.nameOf(c);
  const sender = m => g ? (contact(m.who) || { name: '已退群的人' }) : c;   // 这条 TA 的消息是谁发的
  const headAvatar = () => g ? groupAvatar(chat, 32) : chatAvatar(E.avatarOf(c, chat), E.nameOf(c), { ...chat.cfg, avatarSize: 32 });
  const msgs = await getMsgs(chat.id);
  let shown = Math.min(msgs.length, PAGE_SIZE), quote = null, selecting = false;
  const selected = new Set();

  /* ---------- 骨架 ---------- */
  const nameEl = h('div.as-chat-room__name', title()), statusEl = h('div.as-chat-room__status');
  const p = page({ app: 'chat', id: 'chat-room', back: true, cls: 'as-chat-room', right: navBtn('more', '聊天设置', () => g ? openGroupSettings(chat, redraw) : openSettings(chat, redraw)) });
  const headAva = h('span.as-chat-room__ava', headAvatar());
  headAva.addEventListener('click', () => g ? openGroupSettings(chat, redraw) : openProfile(c.id, { onMessage: () => nav.pop() }));
  p.nav.querySelector('.as-navbar__title').replaceChildren(headAva, h('div.as-chat-room__names', nameEl, statusEl));
  p.nav.classList.add('is-inline');
  const list = h('div.as-chat-msgs', { role: 'log', 'aria-live': 'polite' });
  p.body.replaceWith(list);
  // 正在和 TA 一起听：顶上挂一条，点一下去播放页，× 结束
  const tgName = h('span'), tgBar = h('div.as-chat-tgbar', { hidden: true, role: 'button', onclick: async () => (await import('../music/music.js')).openPlayer() },
    icon('headphones', 16, 2), tgName, h('button', { 'aria-label': '结束一起听', onclick: e => { e.stopPropagation(); Mu.listenWith(null); } }, icon('close', 16, 2)));
  const paintTg = () => { const on = !g && Mu.together() === c && !!Mu.current(); tgBar.hidden = !on; if (on) tgName.textContent = `正在一起听：${Mu.current().name}`; };
  list.before(tgBar); paintTg();
  const inputEl = h('textarea.as-chat-input', { rows: 1, placeholder: '发消息…', 'aria-label': '输入消息' });
  inputEl.value = chat.draft || '';
  const sendBtn = h('button.as-chat-sendbtn', { 'aria-label': '发送' });
  const plusBtn = h('button.as-chat-iconbtn', { 'aria-label': '更多', onclick: () => { const open = plus.hidden; closePanels(); plus.hidden = !open; plusBtn.classList.toggle('is-active', open); } }, icon('plus', 22, 1.8));
  const quoteBar = h('div.as-chat-quotebar', { hidden: true });
  const closePanels = () => { plus.hidden = true; stick.el.hidden = true; plusBtn.classList.remove('is-active'); };
  const plus = h('div.as-chat-plus', { hidden: true }, PLUS.map(([k, label, ic]) => h('button', { onclick: () => { closePanels(); plusAction(k); } }, h('span', icon(ic, 24, 1.7)), h('span', label))));
  const stick = stickerPanel(chat, () => {}); stick.el.hidden = true;
  const tool = (ic, label, fn) => h('button.as-chat-iconbtn', { 'aria-label': label, onclick: fn }, icon(ic, 21, 1.7));
  const inputWrap = h('div.as-chat-inputwrap', quoteBar, inputEl,
    h('div.as-chat-toolbar', plusBtn,
      tool('smile', '表情包', () => { const open = stick.el.hidden; closePanels(); stick.el.hidden = !open; if (open) stick.draw(); }),
      tool('image', '图片', () => { closePanels(); plusAction('photo'); }),
      tool('mic', '语音', () => { closePanels(); plusAction('voice'); }),
      h('span.as-spacer'), sendBtn),
    stick.el, plus);
  const selectBar = h('div.as-chat-selectbar', { hidden: true },
    h('button.is-danger', { onclick: () => bulk('del') }, icon('trash', 22, 1.7), '删除'),
    h('button', { onclick: () => bulk('pin') }, icon('link', 22, 1.7), '注入正文'),
    h('button', { onclick: () => bulk('fav') }, icon('bookmark', 22, 1.7), '收藏'),
    h('button', { onclick: () => setSelecting(false) }, icon('close', 22, 1.7), '取消'));
  p.el.append(inputWrap, selectBar);
  applyBg();

  /* ---------- 画消息 ---------- */
  function msgNode(m, prev, next, anim) {
    const frag = [];
    const sep = sepFor(m, prev); if (sep) frag.push(h('div.as-chat-time', sep));
    if (solo(m)) {
      const mine = m.from === 'me';
      frag.push(h('div.as-chat-sys', { dataset: { id: m.id } }, m.recalled ? (mine ? '你撤回了一条消息' : `「${E.nameOf(c)}」撤回了一条消息`) : m.text,
        m.recalled && mine && m.text ? h('button', { onclick: () => { inputEl.value = m.text; syncBtn(); inputEl.focus(); } }, '重新编辑') : null,
        m.verify && E.cutOf(chat) === 'deleted' ? h('button', { onclick: async () => {
          const t = await dialog({ title: '发送朋友验证', input: { value: `我是${state.me.nick || '我'}` }, confirm: '发送' }); if (t == null) return;
          try { await E.sendVerify(chat, t.trim() || `我是${state.me.nick || '我'}`); } catch (e) { toast('发送失败：' + e.message); }
        } }, '发送朋友验证') : null));
      return frag;
    }
    const me = m.from === 'me', A = avatarCfg(chat.cfg);
    const same = (a, b) => a.from === b.from && (a.who || '') === (b.who || '');
    const cont = prev && !sep && same(prev, m) && !solo(prev);
    const lastOfRun = !next || !same(next, m) || solo(next) || !!sepFor(next, m);
    const who = me ? null : sender(m);
    const showAva = me ? A.me : A.them;
    let ava = null;
    if (showAva) {
      ava = chatAvatar(me ? E.myAvatarIn(chat) : (g ? who.avatar : E.avatarOf(c, chat)), me ? (state.me.nick || '我') : E.nameOf(who), chat.cfg);
      ava.classList.add('as-chat-msg__avatar'); bindAvatar(ava, me, who);
    }
    const bubble = buildBubble(m, { chat, c: me ? c : who, redraw });
    const nameTag = g && !me && !cont ? h('div.as-chat-msg__name', E.nameOf(who),
      chat.owner === m.who ? h('em.is-owner', '群主') : (chat.admins || []).includes(m.who) ? h('em', '管理员') : chat.titles[m.who] ? h('em', chat.titles[m.who]) : null) : null;
    onLongPress(bubble, () => { if (!selecting) openMenu(m, bubble); });
    bubble.addEventListener('pointerdown', () => bubble.classList.add('is-pressed'));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => bubble.addEventListener(ev, () => bubble.classList.remove('is-pressed')));
    const rx = Object.values(m.reactions || {}).filter(Boolean);
    const tags = [];
    if (m.fromStory) tags.push(h('span.as-chat-story-tag', icon('note', 10, 2.2), '来自剧情'));
    if (m.pinned) tags.push(h('span.as-chat-pin-tag', { title: '已钉住注入正文' }, icon('link', 12, 2)));
    if (m.edited) tags.push(h('span', '已编辑'));
    const meta = [];
    if (lastOfRun) {
      const bits = [];
      if (chat.cfg.showTime !== false) bits.push(hm(m));
      if (me && !m.bounced && chat.cfg.showRead !== false) bits.unshift(m.read ? '已读' : '送达');
      if (bits.length) meta.push(h('span', bits.join(' · ')));
    }
    const col = h('div.as-chat-msg__col', nameTag,
      !me && m.inner && chat.cfg.showThink ? h('button.as-chat-inner', { onclick: e => e.currentTarget.classList.toggle('is-open') }, '💭', h('span', `${E.nameOf(c)} 心里在想：${m.inner}`)) : null,
      m.bounced ? h('div.as-chat-bounced', h('span.as-chat-bounce', { 'aria-label': '没发出去' }, '!'), bubble) : bubble,
      m.tr ? h('div.as-chat-tr', h('span', '译'), m.tr) : null,
      m.orig ? h('div.as-chat-tr.is-orig', h('span', '原文'), m.orig) : null,
      rx.length ? h('div.as-chat-reactions', rx.map(r => h('span', r))) : null,
      tags.length ? h('div.as-chat-msg__tags', tags) : null,
      meta.length ? h('div.as-chat-msg__meta', meta) : null);
    const check = h('span.as-chat-check.as-chat-msg__check' + (selected.has(m.id) ? '.is-active' : ''), icon('check', 14, 2.6));
    const row = h('div.as-chat-msg' + (me ? '.is-me' : '.is-them') + (cont ? '.is-cont' : '') + (lastOfRun ? '.is-last' : '') + (anim ? '' : '.no-anim'),
      { dataset: { id: m.id }, style: { '--ava': (showAva ? A.size : 0) + 'px' } }, check, ava, col);
    if (ava && cont) ava.style.visibility = 'hidden';
    row.addEventListener('click', () => { if (!selecting) return; selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id); check.classList.toggle('is-active', selected.has(m.id)); syncSelectBar(); });
    frag.push(row);
    return frag;
  }
  function redraw(keepScroll, animId) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const oldH = list.scrollHeight, oldTop = list.scrollTop;
    list.innerHTML = '';
    list.classList.toggle('has-bg', !!chat.cfg.bg);
    list.classList.toggle('is-compact', chat.cfg.density === 'compact');
    const start = Math.max(0, msgs.length - shown);
    if (start > 0) list.appendChild(h('button.as-chat-more', { onclick: () => { shown += PAGE_SIZE; redraw(true); } }, '查看更早的消息'));
    else if (!msgs.length) list.appendChild(h('div.as-chat-sys', g ? '群里还很安静。说几句话，再点「让大家回复」' : `和 ${E.nameOf(c)} 的聊天。发几句话，再点「让 TA 回复」`));
    for (let i = start; i < msgs.length; i++) list.append(...msgNode(msgs[i], msgs[i - 1], msgs[i + 1], msgs[i].id === animId));
    if (E.busy.has(chat.id)) list.appendChild(typingNode());
    if (animId || !keepScroll || atBottom) list.scrollTo({ top: list.scrollHeight, behavior: animId ? 'smooth' : 'auto' });
    else list.scrollTop = oldTop + (list.scrollHeight - oldH);
  }
  function append(m) { shown++; redraw(false, m.id); }
  const typingNode = () => h('div.as-chat-msg.is-them.as-chat-typing-row', avatarCfg(chat.cfg).them && !g ? chatAvatar(E.avatarOf(c, chat), E.nameOf(c), chat.cfg) : null, h('div.as-chat-typing', h('i'), h('i'), h('i')));
  function applyBg() { list.style.backgroundImage = chat.cfg.bg ? `url(${chat.cfg.bg})` : ''; }

  /* ---------- 头像：单击看资料，双击拍一拍 ---------- */
  function bindAvatar(el, me, who) {
    let t = null;
    el.addEventListener('click', e => {
      e.stopPropagation(); if (selecting) return;
      if (t) { clearTimeout(t); t = null; poke(el, me, who); return; }
      t = setTimeout(() => { t = null; me ? toast('你的资料在「我」里改') : (who && who.id ? openProfile(who.id, { onMessage: () => nav.pop() }) : null); }, 280);
    });
    if (g && !me && who) onLongPress(el, () => { inputEl.value += `@${E.nameOf(who)} `; syncBtn(); inputEl.focus(); });
  }
  async function poke(el, me, who) {
    el.classList.remove('is-poked'); void el.offsetWidth; el.classList.add('is-poked');
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* 忽略 */ }
    const p = who || c;
    const text = me ? `你拍了拍自己${state.me.pokeSuffix || ''}` : `你拍了拍「${E.nameOf(p)}」${p.pokeSuffix || ''}`;
    await E.addSystem(chat, text);
  }

  /* ---------- 输入栏 ---------- */
  function syncBtn() {
    const has = inputEl.value.trim().length > 0, busy = E.busy.has(chat.id), pend = E.pending(msgs);
    sendBtn.className = 'as-chat-sendbtn' + (busy ? '.is-loading' : has ? '' : pend ? '.is-reply' : '.is-idle').replace('.', ' ');
    sendBtn.replaceChildren(busy ? h('i.as-spin') : icon(has ? 'send' : 'sparkle', 18, 2), h('span', g ? '让大家回复' : `让 ${E.nameOf(c).slice(0, 4)} 回复`));
    sendBtn.setAttribute('aria-label', busy ? '正在回复' : has ? '发送' : '让 TA 回复');
    inputEl.style.height = 'auto'; inputEl.style.height = Math.min(130, Math.max(40, inputEl.scrollHeight)) + 'px';
  }
  async function doSend() {
    const text = inputEl.value.trim();
    if (!text) {
      if (E.busy.has(chat.id)) return;
      if (!E.pending(msgs)) toast(g ? '大家会接着聊' : `${E.nameOf(c)} 会接着说`);
      E.requestReply(chat); return;
    }
    inputEl.value = ''; chat.draft = '';
    const extra = quote ? { quote: { id: quote.id, text: (quote.text || E.preview(quote)).slice(0, 60), who: quote.from === 'me' ? '我' : E.nameOf(sender(quote)) } } : {};
    setQuote(null);
    await E.send(chat, text, extra);
    syncBtn();
  }
  sendBtn.addEventListener('click', doSend);
  inputEl.addEventListener('input', () => { chat.draft = inputEl.value; syncBtn(); });
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } });
  inputEl.addEventListener('focus', () => { closePanels(); setTimeout(() => list.scrollTo({ top: list.scrollHeight }), 300); });
  function setQuote(m) {
    quote = m; quoteBar.hidden = !m;
    if (m) quoteBar.replaceChildren(h('span', `引用 ${m.from === 'me' ? '我' : E.nameOf(sender(m))}：${m.text || E.preview(m)}`), h('button', { 'aria-label': '取消引用', onclick: () => setQuote(null) }, icon('close', 16, 2)));
  }
  function plusAction(k) {
    return doPlus(k, chat, c, { poke: () => { const all = list.querySelectorAll('.as-chat-msg.is-them .as-chat-msg__avatar'); poke(all[all.length - 1] || h('span'), false); } });
  }

  /* ---------- 长按菜单 ---------- */
  function openMenu(m, bubble) {
    const host = p.el, hr = host.getBoundingClientRect(), br = bubble.getBoundingClientRect();
    const me = m.from === 'me';
    const mask = h('div.as-chat-menu-mask');
    const close = () => { mask.remove(); menu.remove(); };
    mask.addEventListener('pointerdown', close);
    const act = (label, ic, fn, danger) => h('button' + (danger ? '.is-danger' : ''), { onclick: () => { close(); fn(); } }, icon(ic, 21, 1.7), label);
    const mine = (m.reactions || {}).me;
    const menu = h('div.as-chat-menu', { role: 'menu' },
      h('div.as-chat-menu__emoji', EMOJI.map(e => h('button' + (mine === e ? '.is-active' : ''), { 'aria-label': '贴 ' + e, onclick: () => { close(); react(m, e); } }, e))),
      h('div.as-chat-menu__grid',
        act('复制', 'note', () => { navigator.clipboard?.writeText(m.text).then(() => toast('已复制'), () => toast('复制失败')); }),
        act('引用', 'comment', () => { setQuote(m); inputEl.focus(); }),
        me ? act('撤回', 'back', () => recall(m)) : act('重新生成', 'sparkle', () => regen(m)),
        act('编辑', 'edit', () => edit(m)),
        act(m.tr ? '收起翻译' : '翻译', 'note', async () => {
          if (m.tr) { delete m.tr; saveMsgs(chat.id); redraw(true); return; }
          if (!m.text) { toast('这条没有文字可以翻译'); return; }
          toast('正在翻译…', true); try { toast(await E.translateMsg(chat, m) ? '翻译好了' : '本来就是这个语言'); } catch (e) { toast(e.message); }
        }),
        act('收藏', 'bookmark', () => fav([m])),
        act(m.pinned ? '取消注入' : '注入正文', 'link', () => { m.pinned = !m.pinned; saveMsgs(chat.id); commit('inject'); redraw(true); toast(m.pinned ? '已钉住，会一直注入正文' : '已取消注入'); }),
        act('多选', 'list', () => { selected.clear(); selected.add(m.id); setSelecting(true); }),
        act('删除', 'trash', () => del([m]), true)));
    host.append(mask, menu);
    const mh = menu.offsetHeight, mw = menu.offsetWidth;
    let top = br.top - hr.top - mh - 8; if (top < 90) top = Math.min(br.bottom - hr.top + 8, hr.height - mh - 12);
    let left = me ? br.right - hr.left - mw : br.left - hr.left; left = Math.max(10, Math.min(left, hr.width - mw - 10));
    Object.assign(menu.style, { top: top + 'px', left: left + 'px', transformOrigin: me ? 'right bottom' : 'left bottom' });
  }
  function react(m, e) { m.reactions = m.reactions || {}; m.reactions.me = m.reactions.me === e ? null : e; saveMsgs(chat.id); redraw(true); }
  async function recall(m) {
    if (Date.now() - m.at > 2 * 60 * 60000 && !(await dialog({ title: '撤回这条消息？', text: '已经发出去很久了，TA 可能已经看到。', confirm: '撤回' }))) return;
    m.recalled = true; m.pinned = false; saveMsgs(chat.id); const last = msgs[msgs.length - 1]; if (last === m) { chat.lastText = E.preview(m); commit('chats'); } redraw(true);
  }
  async function edit(m) {
    const v = await dialog({ title: '编辑消息', input: { value: m.text }, confirm: '保存' });
    if (v == null || !v.trim() || v === m.text) return;
    m.text = v.trim(); m.edited = true; saveMsgs(chat.id); redraw(true);
  }
  async function regen(m) {
    if (E.busy.has(chat.id)) { toast('TA 还在回复中'); return; }
    await E.regenerate(chat, m.id);
  }
  function fav(list2) {
    list2.forEach(m => { if (!state.favorites.some(f => f.id === m.id)) state.favorites.push({ id: m.id, text: m.text, from: m.from, contactId: c.id, name: E.nameOf(c), at: m.at, st: m.st }); });
    commit('me'); toast(list2.length > 1 ? `已收藏 ${list2.length} 条` : '已收藏');
  }
  async function del(list2) {
    if (!(await dialog({ title: list2.length > 1 ? `删除 ${list2.length} 条消息？` : '删除这条消息？', text: '只删手机里的记录。', confirm: '删除', danger: true }))) return false;
    list2.forEach(m => { const i = msgs.indexOf(m); if (i >= 0) msgs.splice(i, 1); });
    const last = msgs[msgs.length - 1]; chat.lastText = E.preview(last); if (last) chat.lastAt = last.at;
    saveMsgs(chat.id); commit('chats'); redraw(true); return true;
  }

  /* ---------- 多选 ---------- */
  function setSelecting(on) {
    selecting = on; p.el.classList.toggle('is-selecting', on);
    inputWrap.hidden = on; selectBar.hidden = !on;
    if (!on) selected.clear();
    redraw(true); syncSelectBar();
  }
  function syncSelectBar() { selectBar.querySelectorAll('button:not(:last-child)').forEach(b => { b.disabled = !selected.size; }); }
  async function bulk(kind) {
    const list2 = msgs.filter(m => selected.has(m.id));
    if (kind === 'del') { if (await del(list2)) setSelecting(false); return; }
    if (kind === 'fav') { fav(list2); setSelecting(false); return; }
    if (kind === 'pin') {
      const allPinned = list2.every(m => m.pinned);
      list2.forEach(m => { m.pinned = !allPinned; }); saveMsgs(chat.id); commit('inject');
      toast(allPinned ? '已取消注入' : `已钉住 ${list2.length} 条，会一直注入正文`); setSelecting(false);
    }
  }

  /* ---------- 和发动机连线 ---------- */
  const offs = [
    Mu.onMusic(w => { if (w === 'together' || w === 'song') paintTg(); }),
    E.on('msg', (id, m) => { if (id !== chat.id) return; append(m); if (m.from !== 'me' && shell.visible) chat.unread = 0; syncBtn(); }),
    E.on('typing', (id, on) => {
      if (id !== chat.id) return;
      statusEl.textContent = on ? (g ? '有人正在输入…' : '对方正在输入…') : ''; statusEl.classList.toggle('is-typing', on);
      list.querySelector('.as-chat-typing-row')?.remove();
      if (on) { list.appendChild(typingNode()); list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); }
      syncBtn();
    }),
    E.on('read', id => { if (id === chat.id) redraw(true); }),
    E.on('reload', id => { if (id === chat.id) redraw(true); }),
    E.on('error', (id, msg, logId) => {
      if (id !== chat.id) return;
      list.appendChild(h('div.as-chat-sys.is-error', `回复失败：${msg}`, h('button', { onclick: e => { e.currentTarget.parentNode.remove(); E.requestReply(chat); } }, '重试'),
        h('button', { onclick: () => shell.openApp('log', { id: logId }) }, '查看日志')));
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }),
  ];
  shell.activeChat = chat.id;
  const markRead = () => { if (chat.unread) { chat.unread = 0; commit('chats'); } };
  markRead();
  const prevOnShow = shell.onShow;
  shell.onShow = () => { if (shell.activeChat === chat.id) markRead(); };
  p.el._onShow = () => { shell.activeChat = chat.id; markRead(); nameEl.textContent = title(); headAva.replaceChildren(headAvatar()); applyBg(); redraw(true); };
  p.el._onLeave = () => { offs.forEach(f => f()); if (shell.activeChat === chat.id) shell.activeChat = null; shell.onShow = prevOnShow; commit('chats'); };

  redraw(); syncBtn();
  if (E.busy.has(chat.id)) { statusEl.textContent = '对方正在输入…'; statusEl.classList.add('is-typing'); }
  nav.push(p.el);
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

/* ================= 聊天设置 ================= */
let lastTab = 'look';
function openSettings(chat, redrawRoom) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const p = page({ app: 'chat', id: 'chat-room-settings', title: '聊天设置', back: true });
  const save = () => { commit('chats'); };
  const sliderRow = (label, min, max, step, val, fn, fmt = v => v) => {
    const out = h('output', fmt(val));
    return h('div.as-settings-slider-row', h('span', label), slider({ min, max, step, value: val, onInput: v => { out.textContent = fmt(v); fn(v); } }), out);
  };
  const TABS = [['look', '外观'], ['act', '行为'], ['mem', '记忆'], ['data', '数据']];
  const tabsEl = h('div.as-chat-set-tabs', { role: 'tablist' }, TABS.map(([k, label]) => h('button', { role: 'tab', dataset: { k }, onclick: () => { lastTab = k; draw(); } }, label)));
  const head = h('div.as-chat-set-head');
  const box = h('div');
  p.body.append(head, tabsEl, box);

  function drawHead() {
    head.style.backgroundImage = cfg.bg ? `url(${cfg.bg})` : '';
    head.replaceChildren(h('div.as-chat-set-head__ava', chatAvatar(E.avatarOf(c, chat), E.nameOf(c), { ...cfg, avatarSize: 76 })),
      h('div.as-chat-set-head__name', E.nameOf(c)), h('div.as-chat-set-head__sign', c.sign || '查看资料 ›'));
    head.onclick = () => openProfile(c.id, { onMessage: () => { nav.pop(); nav.pop(); } });
  }
  function draw() {
    drawHead();
    [...tabsEl.children].forEach(b => b.classList.toggle('is-active', b.dataset.k === lastTab));
    box.innerHTML = '';
    const conns = state.connections.text;
    if (lastTab === 'look') box.append(
      group('资料', [
        item({ icon: 'user', color: 'blue', title: '头像与备注', sub: '显示谁的头像、大小、圆角、备注名', chevron: true, onClick: () => openAvatarPage(chat, draw) }),
        item({ icon: 'image', color: 'teal', title: '聊天背景', sub: cfg.bg ? '当前使用自定义图片' : '默认（跟随主题）', chevron: true, onClick: () => openBgPage(chat, draw) }),
      ]),
      group('显示', [
        toggleItem({ title: '时间戳', sub: '一组消息下面显示时间' }, cfg.showTime !== false, v => { cfg.showTime = v; save(); }),
        toggleItem({ title: '已读', sub: '我的消息下面显示「已读 / 送达」' }, cfg.showRead !== false, v => { cfg.showRead = v; save(); }),
        toggleItem({ title: '显示 TA 的心里话', sub: 'TA 回复时想了但没说出口的话' }, !!cfg.showThink, v => { cfg.showThink = v; save(); }),
        h('div.as-field', h('span.as-field__label', '排版密度'), segmented([['comfy', '舒适'], ['compact', '紧凑']], cfg.density || 'comfy', v => { cfg.density = v; save(); })),
      ]));
    if (lastTab === 'act') box.append(
      group('基础', [
        toggleItem({ title: '置顶聊天' }, chat.pinned, v => { chat.pinned = v; save(); }),
        toggleItem({ title: '消息免打扰' }, chat.muted, v => { chat.muted = v; save(); }),
        toggleItem({ title: '续火花', sub: '两边当天都说过话就 +1 天，跟随时间来源' }, cfg.streak !== false, v => { cfg.streak = v; save(); }),
      ]),
      group('AI', [
        item({ title: '提示词方案', value: P.schemeLabel('dm', cfg.prompt), chevron: true, onClick: async e => {
          const valEl = e.currentTarget.querySelector('.as-list-item__value');
          const v = await actionSheet('这个聊天用哪套提示词', P.schemeOptions('dm', cfg.prompt)); if (v == null) return;
          cfg.prompt = v; save(); valEl.textContent = P.schemeLabel('dm', v);
        } }),
        item({ title: '使用的连接', value: cfg.conn && cfg.conn !== 'follow' ? connLabel(conns.find(x => x.id === cfg.conn)) : '跟随应用设置', chevron: true, onClick: async () => {
          const v = await actionSheet('这个聊天用哪个连接', [{ value: 'follow', label: '跟随应用设置', active: !cfg.conn || cfg.conn === 'follow' }, ...conns.map(x => ({ value: x.id, label: x.name, active: cfg.conn === x.id }))]);
          if (v) { cfg.conn = v; save(); draw(); }
        } }),
        toggleItem({ title: '专属温度', sub: cfg.temperature == null ? '关着时跟随连接的设置' : null }, cfg.temperature != null, v => { cfg.temperature = v ? .9 : null; save(); draw(); }),
        cfg.temperature != null ? sliderRow('温度', 0, 1.5, .05, cfg.temperature, v => { cfg.temperature = v; save(); }, v => Number(v).toFixed(2)) : null,
      ].filter(Boolean)),
      replyGroup(chat, save),
      // 定时来找你只有仅线上才有；正文里提到 TA 就会来，不用设
      ...(cfg.linkMode === 'online' ? [group('主动消息', [sliderRow('多久来找你一次', 1, 24, 1, cfg.proactiveEvery || ({ low: 6, normal: 2, high: 1 })[cfg.proactiveFreq] || state.apps.chat.defaults.proactiveEvery || 3, v => { cfg.proactiveEvery = v; save(); }, v => v + ' 小时')])] : []),
      trGroup(cfg, save, draw));
    if (lastTab === 'mem') box.append(
      group('剧情关联', [
        h('div.as-field', h('span.as-field__label', '联动方式'), segmented([['follow', '跟随正文'], ['online', '仅线上聊天']], cfg.linkMode, v => { cfg.linkMode = v; save(); commit('inject'); }),
          h('span.as-field__hint', '跟随正文：TA 回复时会参考正文，最近的聊天会注入正文。仅线上：不读正文、不自动注入（手动钉住的仍会注入）。')),
        sliderRow('注入条数', 0, 40, 1, cfg.injectCount ?? 12, v => { cfg.injectCount = v; save(); commit('inject'); }),
        item({ title: '注入记录', sub: '看看正文 AI 实际读到了什么', chevron: true, onClick: () => openInjectLog(chat) }),
      ]),
      group('', [item({ title: 'TA 的记忆', value: '下一轮', sub: '记忆宫殿做好后，在这里查看和编辑' })]));
    if (lastTab === 'data') box.append(
      group('记录', [
        item({ title: '导出聊天记录', chevron: true, onClick: () => import('./transfer.js').then(m => m.exportChats([chat])) }),
        item({ title: '清空聊天记录', danger: true, onClick: async () => {
          if (!(await dialog({ title: '清空和 TA 的聊天记录？', text: '此操作无法撤销。', confirm: '清空', danger: true }))) return;
          await clearMsgs(chat.id); chat.lastText = ''; chat.unread = 0; chat.streak = null; save(); toast('已清空'); nav.pop();
        } }),
      ]));
  }
  draw();
  p.el._onShow = draw;
  p.el._onLeave = () => { redrawRoom && setTimeout(() => redrawRoom(true), 0); };
  nav.push(p.el);
}

/** 回复设置（私聊、群聊共用）：回几条、其中几条语音、收到语音先合成、能不能拍我 */
export function replyGroup(chat, save) {
  const rc = E.replyCfg(chat), cfg = chat.cfg, g = rc.group;
  return group('回复设置', [
    rangeRow('回复条数', { min: 1, max: g ? 20 : 10, value: rc.lines, onInput: v => { cfg.lines = v; save(); } }),
    rangeRow('语音条数', { min: 0, max: 10, value: rc.voice, onInput: v => { cfg.voice = v; save(); } }),
    toggleItem({ title: withInfo('收到语音就合成', '打开：语音一到就合成好存着，点开直接放；关着：点了才合成。合成过的都会存着，再听不用再合成。') }, rc.autoVoice, v => { cfg.autoVoice = v; save(); }),
    toggleItem({ title: g ? '允许群成员拍一拍我' : '允许 TA 拍一拍我' }, rc.poke, v => { cfg.poke = v; save(); }),
  ]);
}

/** 翻译设置（私聊、群聊共用） */
export function trGroup(cfg, save, draw) {
  const langs = LANGS.map(([v, l]) => [v, l]);
  const pickLang = async (key, title) => { const v = await actionSheet(title, langs.map(([v, l]) => ({ value: v, label: l, active: cfg[key] === v }))); if (v) { cfg[key] = v; save(); draw(); } };
  return group('翻译（免费，不花你的 API）', [
    toggleItem({ title: '自动翻译 TA 的消息', sub: `翻成 ${langName(cfg.myLang || 'zh-CN')}，显示在气泡下面` }, !!cfg.autoTr, v => { cfg.autoTr = v; save(); draw(); }),
    item({ title: '我看的语言', value: langName(cfg.myLang || 'zh-CN'), chevron: true, onClick: () => pickLang('myLang', '翻成什么语言给我看') }),
    toggleItem({ title: '发送前把我的话翻成 TA 的语言', sub: '原文显示在我的气泡下面' }, !!cfg.sendTr, v => { cfg.sendTr = v; save(); draw(); }),
    cfg.sendTr ? item({ title: 'TA 的语言', value: langName(cfg.theirLang || 'en'), chevron: true, onClick: () => pickLang('theirLang', 'TA 说什么语言') }) : null,
  ].filter(Boolean), '也可以长按任意一条消息 → 翻译。');
}

/** 头像与备注 */
function openAvatarPage(chat, after) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const p = page({ app: 'chat', id: 'chat-room-avatar', title: '头像与备注', back: true });
  const pick = async (key, label) => {
    const v = await pickImage(label, { has: !!cfg[key] }); if (v == null) return;
    cfg[key] = v; commit('chats'); draw();
  };
  const preview = h('div.as-chat-ava-preview');
  function draw() {
    const A = avatarCfg(cfg);
    p.body.innerHTML = '';
    preview.replaceChildren(
      h('button', { onclick: () => pick('theirAvatar', 'TA 在这个聊天的头像') }, chatAvatar(E.avatarOf(c, chat), E.nameOf(c), { ...cfg, avatarSize: 72 }), h('span', 'TA')),
      h('button', { onclick: () => pick('myAvatar', '我在这个聊天的头像') }, chatAvatar(E.myAvatarIn(chat), state.me.nick || '我', { ...cfg, avatarSize: 72 }), h('span', '我')));
    const out = (v, u) => h('output', v + u);
    const sizeOut = out(A.size, 'px'), radOut = out(A.radius, '%');
    p.body.append(
      group('显示谁的头像', [h('div.as-field', h('div.as-chips', [['both', '双方'], ['them', '仅对方'], ['me', '仅我'], ['none', '都不']].map(([k, label]) =>
        h('button.as-chip' + (A.who === k ? '.is-active' : ''), { onclick: () => { cfg.avatarWho = k; cfg.showAvatar = k !== 'none'; commit('chats'); draw(); } }, label))))]),
      group('头像（点一下更换，只在这个聊天里生效，情侣头像在这换）', [preview]),
      group('大小和圆角', [
        h('div.as-settings-slider-row', h('span', '大小'), slider({ min: 26, max: 56, step: 1, value: A.size, onInput: v => { cfg.avatarSize = v; sizeOut.textContent = v + 'px'; commit('chats'); repaint(); } }), sizeOut),
        h('div.as-settings-slider-row', h('span', '圆角'), slider({ min: 0, max: 50, step: 1, value: A.radius, onInput: v => { cfg.avatarRadius = v; radOut.textContent = v + '%'; commit('chats'); repaint(); } }), radOut),
      ]),
      group('备注', [field('备注名（只有你看得到，聊天顶部和列表里显示这个）', input({ value: c.remark || '', placeholder: c.nick || c.name, onInput: v => { c.remark = v.trim(); commit('contacts'); } }))]));
  }
  function repaint() { preview.querySelectorAll('.as-avatar').forEach(a => { a.style.borderRadius = avatarCfg(cfg).radius + '%'; }); }
  draw();
  p.el._onLeave = () => after && after();
  nav.push(p.el);
}

/** 聊天背景 */
function openBgPage(chat, after) {
  const cfg = chat.cfg;
  const p = page({ app: 'chat', id: 'chat-room-bg', title: '聊天背景', back: true });
  function draw() {
    p.body.innerHTML = '';
    p.body.append(group('聊天背景', [
      h('div.as-chat-bg-preview', { style: cfg.bg ? { backgroundImage: `url(${cfg.bg})` } : {} }, cfg.bg ? null : h('span', '默认：跟随主题的蓝色渐变')),
      h('div.as-chat-bg-btns',
        btn('导入背景', 'secondary', async () => { const v = await pickImage('聊天背景', { ratio: 'screen', size: 1100 }); if (v) { cfg.bg = v; commit('chats'); draw(); } }),
        btn('恢复默认', 'secondary', () => { cfg.bg = ''; commit('chats'); draw(); })),
    ], '语音通话的背景，等通话功能上线后也放在这里。'));
  }
  draw();
  p.el._onLeave = () => after && after();
  nav.push(p.el);
}

/* ================= 注入记录 ================= */
async function openInjectLog(chat) {
  const p = page({ app: 'chat', id: 'chat-room-inject', title: '注入记录', back: true });
  const S = await import('../../core/sync.js');
  async function draw() {
    p.body.innerHTML = '';
    const { auto, pinned } = await S.collectInjection();
    const mine = x => x.chat.id === chat.id;
    const row = (x, kind) => item({ title: x.m.text || E.preview(x.m), sub: S.lineOf(x).replace(/：.*$/, ''), cls: 'as-chat-inject-item', right: h('button.as-inline-btn', { onclick: async e => {
      e.stopPropagation();
      if (kind === 'pin') x.m.pinned = false; else x.m.noInject = true;
      saveMsgs(chat.id); commit('inject'); draw();
    } }, kind === 'pin' ? '取消钉住' : '不注入') });
    const a = auto.filter(mine), b = pinned.filter(mine);
    p.body.append(
      h('p.as-muted', { style: { margin: '0 6px 14px' } }, chat.cfg.linkMode === 'follow' ? `这个聊天「跟随正文」：最近 ${chat.cfg.injectCount ?? 12} 条会自动写进正文。` : '这个聊天是「仅线上」：不会自动注入，只有手动钉住的会写进正文。'),
      group(`自动注入（${a.length}）`, a.length ? a.map(x => row(x, 'auto')) : [item({ title: '没有', sub: null })]),
      group(`手动钉住（${b.length}）`, b.length ? b.map(x => row(x, 'pin')) : [item({ title: '没有', sub: '长按消息 → 注入正文，或多选后一起钉住' })]),
      btn('预览正文 AI 看到的内容', 'secondary', async () => {
        const text = await S.injectionText();
        sheet({ title: `预览 · ${text.length} 字`, content: h('div.as-stack-gap', h('div.as-chat-preview', text || '（现在没有任何内容会注入正文）'),
          h('p.as-muted', `位置：${state.apps.chat.injectPos === 'prompt' ? '人设卡和世界书附近' : `聊天记录里，离最新消息 ${state.apps.chat.injectDepth} 层`}。包含所有聊天，不只是这一个。`)) });
      }, { style: { width: '100%' } }));
    const restored = (await getMsgs(chat.id)).filter(m => m.noInject);
    if (restored.length) p.body.appendChild(h('div', { style: { textAlign: 'center', marginTop: '10px' } }, btn(`恢复 ${restored.length} 条被排除的消息`, 'text', () => { restored.forEach(m => { delete m.noInject; }); saveMsgs(chat.id); commit('inject'); draw(); })));
  }
  await draw();
  nav.push(p.el);
}
