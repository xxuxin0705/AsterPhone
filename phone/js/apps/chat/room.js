// 私聊界面：气泡、时间线、正在输入、发送 /「让 TA 回复」变形按钮、长按菜单、多选、拍一拍、聊天设置、注入记录。
import { h, onLongPress, fileToDataURL, pickFile } from '../../core/util.js';
import { state, commit, contact, getMsgs, saveMsgs, clearMsgs } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, slider, avatar, icon, navBtn, actionSheet, dialog, toast, sheet, btn, field } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { log } from '../../core/log.js';
import { connLabel } from '../../core/api.js';
import * as E from './engine.js';
import { openProfile } from './people.js';

const EMOJI = ['❤️', '😂', '😮', '😢', '👍', '🙏'];
const PAGE_SIZE = 80;

export async function openRoom(chat) {
  const c = contact(chat.contactId);
  if (!c) { toast('这个联系人不在了'); return; }
  const msgs = await getMsgs(chat.id);
  let shown = Math.min(msgs.length, PAGE_SIZE), quote = null, selecting = false;
  const selected = new Set();

  /* ---------- 骨架 ---------- */
  const nameEl = h('div.as-chat-room__name', E.nameOf(c)), statusEl = h('div.as-chat-room__status');
  const p = page({ app: 'chat', id: 'chat-room', back: true, cls: 'as-chat-room', right: navBtn('more', '聊天设置', () => openSettings(chat, redraw)) });
  p.nav.querySelector('.as-navbar__title').replaceChildren(nameEl, statusEl);
  const list = h('div.as-chat-msgs', { role: 'log', 'aria-live': 'polite' });
  p.body.replaceWith(list);
  const inputEl = h('textarea.as-chat-input', { rows: 1, placeholder: '发消息…', 'aria-label': '输入消息' });
  inputEl.value = chat.draft || '';
  const sendBtn = h('button.as-chat-sendbtn', { 'aria-label': '发送' });
  const plusBtn = h('button.as-chat-iconbtn', { 'aria-label': '更多', onclick: () => { plus.hidden = !plus.hidden; plusBtn.classList.toggle('is-active', !plus.hidden); } }, icon('plus', 24, 1.8));
  const quoteBar = h('div.as-chat-quotebar', { hidden: true });
  const plus = h('div.as-chat-plus', { hidden: true }, [
    ['poke', '拍一拍', 'sparkle'], ['photo', '相册', 'image'], ['call', '语音通话', 'phone'], ['transfer', '转账', 'wallet'],
    ['packet', '红包', 'box'], ['loc', '位置', 'moments'], ['music', '一起听', 'mic'], ['card', '名片', 'user'],
  ].map(([k, label, ic]) => h('button' + (k === 'poke' ? '' : '.is-soon'), { onclick: () => plusAction(k) }, h('span', icon(ic, 24, 1.7)), h('span', label))));
  const inputWrap = h('div.as-chat-inputwrap', quoteBar, h('div.as-chat-inputbar', plusBtn, inputEl, h('button.as-chat-iconbtn', { 'aria-label': '表情', onclick: () => toast('表情包面板下一轮做') }, icon('smile', 24, 1.7)), sendBtn), plus);
  const selectBar = h('div.as-chat-selectbar', { hidden: true },
    h('button.is-danger', { onclick: () => bulk('del') }, icon('trash', 22, 1.7), '删除'),
    h('button', { onclick: () => bulk('pin') }, icon('link', 22, 1.7), '注入正文'),
    h('button', { onclick: () => bulk('fav') }, icon('bookmark', 22, 1.7), '收藏'),
    h('button', { onclick: () => setSelecting(false) }, icon('close', 22, 1.7), '取消'));
  p.el.append(inputWrap, selectBar);
  applyBg();

  /* ---------- 画消息 ---------- */
  const lastMine = () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].from === 'me' && !msgs[i].recalled) return msgs[i]; return null; };
  function msgNode(m, prev, anim) {
    const frag = [];
    const sep = time.sepLabel(m, prev); if (sep) frag.push(h('div.as-chat-time', sep));
    if (m.from === 'sys' || m.recalled) {
      const mine = m.from === 'me';
      frag.push(h('div.as-chat-sys', { dataset: { id: m.id } }, m.recalled ? (mine ? '你撤回了一条消息' : `「${E.nameOf(c)}」撤回了一条消息`) : m.text,
        m.recalled && mine && m.text ? h('button', { onclick: () => { inputEl.value = m.text; syncBtn(); inputEl.focus(); } }, '重新编辑') : null));
      return frag;
    }
    const me = m.from === 'me';
    const cont = prev && !sep && prev.from === m.from && !prev.recalled && prev.from !== 'sys';
    const shape = chat.cfg.avatarShape === 'square' ? 'square' : 'round';
    const ava = chat.cfg.showAvatar !== false ? avatar(me ? E.myAvatarIn(chat) : E.avatarOf(c, chat), me ? (state.me.nick || '我') : E.nameOf(c), 38, shape) : null;
    if (ava) { ava.classList.add('as-chat-msg__avatar'); bindAvatar(ava, me); }
    const bubble = h('div.as-chat-bubble', m.quote ? h('span.as-chat-quote', `${m.quote.who}：${m.quote.text}`) : null, m.text);
    onLongPress(bubble, () => { if (!selecting) openMenu(m, bubble); });
    bubble.addEventListener('pointerdown', () => bubble.classList.add('is-pressed'));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => bubble.addEventListener(ev, () => bubble.classList.remove('is-pressed')));
    const rx = Object.values(m.reactions || {}).filter(Boolean);
    const meta = [];
    if (m.fromStory) meta.push(h('span.as-chat-story-tag', icon('note', 10, 2.2), '来自剧情'));
    if (m.pinned) meta.push(h('span.as-chat-pin-tag', { title: '已钉住注入正文' }, icon('link', 12, 2)));
    if (m.edited) meta.push(h('span', '已编辑'));
    if (me && m === lastMine() && chat.cfg.showRead !== false) meta.push(h('span', m.read ? '已读' : '送达'));
    const col = h('div.as-chat-msg__col',
      !me && m.inner && chat.cfg.showThink ? h('button.as-chat-inner', { onclick: e => e.currentTarget.classList.toggle('is-open') }, '💭', h('span', `${E.nameOf(c)} 心里在想：${m.inner}`)) : null,
      bubble, rx.length ? h('div.as-chat-reactions', rx.map(r => h('span', r))) : null, meta.length ? h('div.as-chat-msg__meta', meta) : null);
    const check = h('span.as-chat-check.as-chat-msg__check' + (selected.has(m.id) ? '.is-active' : ''), icon('check', 14, 2.6));
    const row = h('div.as-chat-msg' + (me ? '.is-me' : '.is-them') + (cont ? '.is-cont' : '') + (anim ? '' : '.no-anim'), { dataset: { id: m.id } }, check, ava, col);
    row.addEventListener('click', () => { if (!selecting) return; selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id); check.classList.toggle('is-active', selected.has(m.id)); syncSelectBar(); });
    frag.push(row);
    return frag;
  }
  function redraw(keepScroll) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const oldH = list.scrollHeight, oldTop = list.scrollTop;
    list.innerHTML = '';
    list.classList.toggle('has-bg', !!chat.cfg.bg);
    const start = Math.max(0, msgs.length - shown);
    if (start > 0) list.appendChild(h('button.as-chat-more', { onclick: () => { shown += PAGE_SIZE; redraw(true); } }, '查看更早的消息'));
    else if (!msgs.length) list.appendChild(h('div.as-chat-sys', `和 ${E.nameOf(c)} 的聊天。发几句话，再点「让 TA 回复」`));
    for (let i = start; i < msgs.length; i++) list.append(...msgNode(msgs[i], msgs[i - 1], false));
    if (E.busy.has(chat.id)) list.appendChild(typingNode());
    if (keepScroll && !atBottom) list.scrollTop = oldTop + (list.scrollHeight - oldH) * (keepScroll === true ? 1 : 0);
    else list.scrollTop = list.scrollHeight;
  }
  function append(m) {
    shown++;
    list.querySelector('.as-chat-typing-row')?.remove();
    const i = msgs.indexOf(m);
    // 「已读 / 送达」只挂在最后一条我的消息上，所以我新发一条时要刷新上一条
    if (m.from === 'me') list.querySelectorAll('.as-chat-msg.is-me .as-chat-msg__meta').forEach(el => [...el.children].forEach(x => { if (/^(已读|送达)$/.test(x.textContent)) x.remove(); }));
    list.append(...msgNode(m, msgs[i - 1], true));
    if (E.busy.has(chat.id)) list.appendChild(typingNode());
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }
  const typingNode = () => h('div.as-chat-msg.is-them.as-chat-typing-row', chat.cfg.showAvatar !== false ? avatar(E.avatarOf(c, chat), E.nameOf(c), 38, chat.cfg.avatarShape === 'square' ? 'square' : 'round') : null, h('div.as-chat-typing', h('i'), h('i'), h('i')));
  function applyBg() { list.style.backgroundImage = chat.cfg.bg ? `url(${chat.cfg.bg})` : ''; }

  /* ---------- 头像：单击看资料，双击拍一拍 ---------- */
  function bindAvatar(el, me) {
    let t = null;
    el.addEventListener('click', e => {
      e.stopPropagation(); if (selecting) return;
      if (t) { clearTimeout(t); t = null; poke(el, me); return; }
      t = setTimeout(() => { t = null; me ? toast('你的资料在「我」里改') : openProfile(c.id, { onMessage: () => nav.pop() }); }, 280);
    });
  }
  async function poke(el, me) {
    el.classList.remove('is-poked'); void el.offsetWidth; el.classList.add('is-poked');
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* 忽略 */ }
    const text = me ? `你拍了拍自己${state.me.pokeSuffix || ''}` : `你拍了拍「${E.nameOf(c)}」${c.pokeSuffix || ''}`;
    await E.addSystem(chat, text);
  }

  /* ---------- 输入栏 ---------- */
  function syncBtn() {
    const has = inputEl.value.trim().length > 0, busy = E.busy.has(chat.id), pend = E.pending(msgs);
    sendBtn.className = 'as-chat-sendbtn' + (busy ? '.is-loading' : has ? '' : pend ? '.is-reply' : '.is-idle').replace('.', ' ');
    sendBtn.replaceChildren(busy ? h('i.as-spin') : icon(has ? 'send' : 'sparkle', 18, 2), h('span', `让 ${E.nameOf(c).slice(0, 4)} 回复`));
    sendBtn.setAttribute('aria-label', busy ? '正在回复' : has ? '发送' : '让 TA 回复');
    inputEl.style.height = 'auto'; inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
  }
  async function doSend() {
    const text = inputEl.value.trim();
    if (!text) {
      if (E.busy.has(chat.id)) return;
      if (!E.pending(msgs)) toast(`${E.nameOf(c)} 会接着说`);
      E.requestReply(chat); return;
    }
    inputEl.value = ''; chat.draft = '';
    const extra = quote ? { quote: { id: quote.id, text: quote.text.slice(0, 60), who: quote.from === 'me' ? '我' : E.nameOf(c) } } : {};
    setQuote(null);
    await E.send(chat, text, extra);
    syncBtn();
  }
  sendBtn.addEventListener('click', doSend);
  inputEl.addEventListener('input', () => { chat.draft = inputEl.value; syncBtn(); });
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } });
  inputEl.addEventListener('focus', () => { plus.hidden = true; plusBtn.classList.remove('is-active'); setTimeout(() => list.scrollTo({ top: list.scrollHeight }), 300); });
  function setQuote(m) {
    quote = m; quoteBar.hidden = !m;
    if (m) quoteBar.replaceChildren(h('span', `引用 ${m.from === 'me' ? '我' : E.nameOf(c)}：${m.text}`), h('button', { 'aria-label': '取消引用', onclick: () => setQuote(null) }, icon('close', 16, 2)));
  }
  function plusAction(k) {
    if (k === 'poke') { plus.hidden = true; plusBtn.classList.remove('is-active'); const all = list.querySelectorAll('.as-chat-msg.is-them .as-chat-msg__avatar'); const a = all[all.length - 1] || h('span'); poke(a, false); return; }
    toast('转账、红包、语音、图片这些特殊消息下一轮做');
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
    E.on('msg', (id, m) => { if (id !== chat.id) return; append(m); if (m.from !== 'me' && shell.visible) chat.unread = 0; syncBtn(); }),
    E.on('typing', (id, on) => {
      if (id !== chat.id) return;
      statusEl.textContent = on ? '对方正在输入…' : ''; statusEl.classList.toggle('is-typing', on);
      list.querySelector('.as-chat-typing-row')?.remove();
      if (on) { list.appendChild(typingNode()); list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); }
      syncBtn();
    }),
    E.on('read', id => { if (id === chat.id) redraw(true); }),
    E.on('reload', id => { if (id === chat.id) redraw(true); }),
    E.on('error', (id, msg) => {
      if (id !== chat.id) return;
      list.appendChild(h('div.as-chat-sys.is-error', `回复失败：${msg}`, h('button', { onclick: e => { e.currentTarget.parentNode.remove(); E.requestReply(chat); } }, '重试'),
        h('button', { onclick: () => shell.openApp('log') }, '查看日志')));
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      log('warn', '聊天', `${E.nameOf(c)} 回复失败`);
    }),
  ];
  shell.activeChat = chat.id;
  const markRead = () => { if (chat.unread) { chat.unread = 0; commit('chats'); } };
  markRead();
  const prevOnShow = shell.onShow;
  shell.onShow = () => { if (shell.activeChat === chat.id) markRead(); };
  p.el._onShow = () => { shell.activeChat = chat.id; markRead(); nameEl.textContent = E.nameOf(c); applyBg(); redraw(true); };
  p.el._onLeave = () => { offs.forEach(f => f()); if (shell.activeChat === chat.id) shell.activeChat = null; shell.onShow = prevOnShow; commit('chats'); };

  redraw(); syncBtn();
  if (E.busy.has(chat.id)) { statusEl.textContent = '对方正在输入…'; statusEl.classList.add('is-typing'); }
  nav.push(p.el);
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

/* ================= 聊天设置 ================= */
function openSettings(chat, redrawRoom) {
  const c = contact(chat.contactId), cfg = chat.cfg;
  const p = page({ app: 'chat', id: 'chat-room-settings', title: '聊天设置', back: true });
  const save = () => { commit('chats'); };
  const imgItem = (title, key, max = 320) => item({ title, right: cfg[key] ? avatar(cfg[key], '', 30, 'square') : h('span.as-muted', '默认'), chevron: true, onClick: async () => {
    const v = await actionSheet(title, [{ value: 'pick', label: '从相册选择', icon: 'image' }, cfg[key] && { value: 'clear', label: '恢复默认', icon: 'close' }].filter(Boolean));
    if (v === 'pick') { const f = await pickFile(); if (f) { cfg[key] = await fileToDataURL(f, max); save(); draw(); } }
    if (v === 'clear') { cfg[key] = ''; save(); draw(); }
  } });
  const sliderRow = (label, min, max, step, val, fn, fmt = v => v) => {
    const out = h('output', fmt(val));
    return h('div.as-settings-slider-row', h('span', label), slider({ min, max, step, value: val, onInput: v => { out.textContent = fmt(v); fn(v); } }), out);
  };
  function draw() {
    p.body.innerHTML = '';
    const conns = state.connections.text;
    p.body.append(
      group('', [item({ icon: avatar(E.avatarOf(c, chat), E.nameOf(c), 30), color: 'transparent', title: E.nameOf(c), sub: '查看资料', chevron: true, onClick: () => openProfile(c.id, { onMessage: () => { nav.pop(); nav.pop(); } }), cls: 'as-chat-person' })]),
      group('本聊天的头像（情侣头像在这里换）', [imgItem('我在这里的头像', 'myAvatar'), imgItem('TA 在这里的头像', 'theirAvatar')]),
      group('基础', [
        toggleItem({ title: '置顶聊天' }, chat.pinned, v => { chat.pinned = v; save(); }),
        toggleItem({ title: '消息免打扰' }, chat.muted, v => { chat.muted = v; save(); }),
        toggleItem({ title: '显示已读' }, cfg.showRead !== false, v => { cfg.showRead = v; save(); }),
        toggleItem({ title: '续火花', sub: '两边当天都说过话就 +1 天，跟随时间来源' }, cfg.streak !== false, v => { cfg.streak = v; save(); }),
      ]),
      group('剧情关联', [
        h('div.as-field', h('span.as-field__label', '联动方式'), segmented([['follow', '跟随正文'], ['online', '仅线上聊天']], cfg.linkMode, v => { cfg.linkMode = v; save(); commit('inject'); }),
          h('span.as-field__hint', '跟随正文：TA 回复时会参考正文，最近的聊天会注入正文。仅线上：不读正文、不自动注入（手动钉住的仍会注入）。')),
        sliderRow('注入条数', 0, 40, 1, cfg.injectCount ?? 12, v => { cfg.injectCount = v; save(); commit('inject'); }),
        item({ title: '注入记录', sub: '看看正文 AI 实际读到了什么', chevron: true, onClick: () => openInjectLog(chat) }),
      ]),
      group('AI', [
        item({ title: '使用的连接', value: cfg.conn && cfg.conn !== 'follow' ? connLabel(conns.find(x => x.id === cfg.conn)) : '跟随应用设置', chevron: true, onClick: async () => {
          const v = await actionSheet('这个聊天用哪个连接', [{ value: 'follow', label: '跟随应用设置', active: !cfg.conn || cfg.conn === 'follow' }, ...conns.map(x => ({ value: x.id, label: x.name, active: cfg.conn === x.id }))]);
          if (v) { cfg.conn = v; save(); draw(); }
        } }),
        toggleItem({ title: '专属温度', sub: cfg.temperature == null ? '关着时跟随连接的设置' : null }, cfg.temperature != null, v => { cfg.temperature = v ? .9 : null; save(); draw(); }),
        cfg.temperature != null ? sliderRow('温度', 0, 1.5, .05, cfg.temperature, v => { cfg.temperature = v; save(); }, v => Number(v).toFixed(2)) : null,
        toggleItem({ title: '显示 TA 的心里话', sub: 'TA 回复时想了但没说出口的话' }, !!cfg.showThink, v => { cfg.showThink = v; save(); }),
      ].filter(Boolean)),
      group('输出设定', [
        sliderRow('最少几句', 1, 8, 1, cfg.minLines || 1, v => { cfg.minLines = v; if (cfg.maxLines < v) cfg.maxLines = v; save(); }),
        sliderRow('最多几句', 1, 10, 1, cfg.maxLines || 4, v => { cfg.maxLines = v; if (cfg.minLines > v) cfg.minLines = v; save(); }),
      ], '语音条数、主动消息、翻译：下一轮做'),
      group('外观', [
        imgItem('聊天背景', 'bg', 1100),
        field('头像形状', segmented([['round', '圆形'], ['square', '方形']], cfg.avatarShape || 'round', v => { cfg.avatarShape = v; save(); })),
        toggleItem({ title: '显示头像' }, cfg.showAvatar !== false, v => { cfg.showAvatar = v; save(); }),
      ]),
      group('记录', [
        item({ title: '导出聊天记录', chevron: true, onClick: async () => {
          const data = { app: 'AsterPhone', kind: 'chat', contact: c, chat, msgs: await getMsgs(chat.id) };
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `AsterPhone-${E.nameOf(c)}-聊天记录.json` });
          document.body.appendChild(a); a.click(); a.remove(); toast('已导出');
        } }),
        item({ title: '清空聊天记录', danger: true, onClick: async () => {
          if (!(await dialog({ title: '清空和 TA 的聊天记录？', text: '此操作无法撤销。', confirm: '清空', danger: true }))) return;
          await clearMsgs(chat.id); chat.lastText = ''; chat.unread = 0; chat.streak = null; save(); toast('已清空'); nav.pop();
        } }),
      ]));
  }
  draw();
  p.el._onLeave = () => { redrawRoom && setTimeout(() => redrawRoom(true), 0); };
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
