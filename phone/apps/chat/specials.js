// 特殊消息的样子和操作：气泡长什么样、「+」面板里每个按钮做什么、表情包面板、语音 / 视频通话界面、表情包管理。
import { h, uid, fileToDataURL, pickFile } from '../../core/util.js';
import { state, commit, contact, saveMsgs, chatForContact } from '../../core/store.js';
import { page, group, item, icon, avatar, actionSheet, dialog, toast, btn, empty, navBtn } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { generateImage, stopSpeak } from '../../core/api.js';
import { speakAs } from '../../core/voice.js';
import * as E from './engine.js';
import { shell } from '../../core/shell.js';
import { money, fmtDur, voiceDur, statusText } from './msgtypes.js';

/* ================= 气泡 ================= */
/** 按消息类型做出气泡。ctx = { chat, c, redraw } */
/** 图打不开（链接失效、编出来的链接）：换成一行小字 */
const broken = e => e.target.replaceWith(h('span.as-muted', '图片打不开'));
const drawing = new Map();   // 正在画的图：消息 id → AbortController（重画、退出再进来，卡片上还是「取消」）
export function buildBubble(m, ctx) {
  const quote = m.quote ? h('span.as-chat-quote', h('b', `回复 ${m.quote.who}`), h('span', m.quote.text)) : null;
  const mine = m.from === 'me';
  switch (m.type) {
    case 'voice': {
      const dur = m.dur || voiceDur(m.text);
      const bars = h('span.as-chat-voice__wave', Array.from({ length: Math.min(18, 4 + Math.round(dur / 2)) }, (_, i) => h('i', { style: { height: (5 + ((i * 7 + dur) % 11)) + 'px' } })));
      const el = h('div.as-chat-bubble.as-chat-voice', h('span.as-chat-voice__play', icon('mic', 15, 2)), bars, h('span.as-chat-voice__dur', `${dur}″`),
        m.showText ? h('div.as-chat-voice__text', m.text) : null);
      el.addEventListener('click', async e => {
        e.stopPropagation();
        if (!m.showText) { m.showText = true; saveMsgs(ctx.chat.id); ctx.redraw(true); }
        el.classList.add('is-playing');
        try { await speakAs(mine ? 'me' : m.who || (ctx.c && ctx.c.id), m.text, { cache: E.voiceKey(ctx.chat, m) }); } catch (err) { toast(err.message); }
        el.classList.remove('is-playing');
      });
      return el;
    }
    case 'image': {
      if (m.src) return h('div.as-chat-bubble.as-chat-pic', quote, h('img', { src: m.src, alt: m.text || '图片', loading: 'lazy', onclick: () => viewImage(m.src, m.text), onerror: broken }));
      const idle = () => gen.replaceChildren(icon('sparkle', 14, 2), '生图');
      const gen = h('button.as-chat-imgcard__gen', { onclick: async e => {
        e.stopPropagation();
        if (drawing.has(m.id)) { drawing.get(m.id).abort(); return; }
        const ac = new AbortController(); drawing.set(m.id, ac); gen.replaceChildren(h('i.as-spin'), ' 取消');
        try { m.src = await generateImage(m.text || '一张生活照', '聊天', undefined, ac.signal); saveMsgs(ctx.chat.id); ctx.redraw(true); }
        catch (err) { toast(ac.signal.aborted ? '已取消' : err.message); idle(); }
        drawing.delete(m.id);
      } });
      if (drawing.has(m.id)) gen.replaceChildren(h('i.as-spin'), ' 取消'); else idle();
      return h('div.as-chat-bubble.as-chat-imgcard', quote, h('div.as-chat-imgcard__art', icon('image', 26, 1.5)), h('div.as-chat-imgcard__desc', m.text || '一张图片'), gen);
    }
    case 'sticker':
      return h('div.as-chat-bubble.as-chat-sticker', h('img', { src: m.src || (state.stickers.find(s => s.id === m.sid) || {}).src || '', alt: m.name || '表情', onerror: broken }));
    case 'transfer': case 'packet': {
      const pk = m.type === 'packet';
      const el = h('div.as-chat-bubble.as-chat-money' + (pk ? '.is-packet' : '') + (m.status !== 'pending' ? '.is-done' : ''),
        h('div.as-chat-money__top', h('span.as-chat-money__icon', icon(pk ? 'box' : 'wallet', 22, 1.8)),
          h('div', h('b', pk ? (m.note || '恭喜发财，大吉大利') : money(m.amount)), h('span', pk ? (m.status === 'pending' ? (mine ? '等待对方领取' : '领取红包') : statusText(m)) : (m.note || (mine ? '转账给对方' : '转账给你'))))),
        h('div.as-chat-money__foot', `${pk ? '红包' : '转账'}${m.status !== 'pending' ? ' · ' + statusText(m) : ''}${pk && m.status === 'accepted' ? ' ' + money(m.amount) : ''}`));
      el.addEventListener('click', async e => {
        e.stopPropagation();
        if (mine || m.status !== 'pending') { toast(`${pk ? '红包' : '转账'} ${money(m.amount)} · ${statusText(m)}`); return; }
        const v = await actionSheet(`${E.nameOf(ctx.c)} 的${pk ? '红包' : '转账'} ${money(m.amount)}`, [{ value: 'yes', label: pk ? '领取' : '收下', icon: 'check' }, { value: 'no', label: '退还', icon: 'back' }]);
        if (v) await E.settle(ctx.chat, m, v === 'yes');
      });
      return el;
    }
    case 'location':
      return h('div.as-chat-bubble.as-chat-loc', h('div.as-chat-loc__map', h('span', icon('moments', 22, 2))), h('div.as-chat-loc__name', m.text));
    case 'call':
      return h('div.as-chat-bubble.as-chat-callrec', { onclick: e => { e.stopPropagation(); if (m.text) dialog({ title: `${m.mode === 'video' ? '视频' : '语音'}通话 ${fmtDur(m.dur || 0)}`, text: m.text, cancel: null, confirm: '关闭' }); } },
        icon('phone', 16, 2), m.missed ? (m.from === 'them' ? '未接来电' : '对方未接') : `${m.mode === 'video' ? '视频' : '语音'}通话 ${fmtDur(m.dur || 0)}`);
    case 'card': {
      const known = state.contacts.find(p => [p.name, p.nick, p.remark].includes(m.name));
      const el = h('div.as-chat-bubble.as-chat-card', h('div.as-chat-card__top', avatar(known && known.avatar, m.name, 40), h('div', h('b', m.name), h('span', known ? (known.sign || '已是好友') : '点一下加好友'))), h('div.as-chat-card__foot', '个人名片'));
      el.addEventListener('click', async e => {
        e.stopPropagation();
        const k2 = state.contacts.find(p => [p.name, p.nick, p.remark].includes(m.name));   // 刚加过的也算
        if (k2) { (await import('./people.js')).openProfile(k2.id); return; }
        if (!(await dialog({ title: `加「${m.name}」为好友？`, text: mine ? '' : `${E.nameOf(ctx.c)} 推荐的名片`, confirm: '添加' }))) return;
        const { blankContact } = await import('./people.js');
        const nc = { ...blankContact(), name: m.name, persona: m.persona || '', source: 'card' };
        state.contacts.push(nc); chatForContact(nc.id, true).lastAt = Date.now(); commit('contacts');
        toast(`已添加「${m.name}」`); el.querySelector('.as-chat-card__top > div > span').textContent = '已是好友';
      });
      return el;
    }
    case 'music': case 'song': {
      // 一起听的卡片：点一下放这首、和 TA 一起听，打开播放页；分享的歌：点一下放这首
      const tg = m.type === 'music';
      const el = h('div.as-chat-bubble.as-chat-tg', h('span.as-chat-tg__cover', { style: { backgroundImage: m.pic ? `url("${m.pic}")` : '' } }, icon(tg ? 'headphones' : 'music', 20, 2)),
        h('div', h('b', m.name), h('span', `${tg ? '一起听' : '分享的歌'} · ${m.artist}`)));
      el.addEventListener('click', async e => {
        e.stopPropagation();
        const Mu = await import('../../core/music.js');
        if ((Mu.current() || {}).id !== m.id) Mu.playList([{ id: m.id, name: m.name, artist: m.artist, pic: m.pic }], 0, tg ? '一起听' : '');
        if (tg) Mu.listenWith(E.isGroup(ctx.chat) ? ctx.chat : ctx.c);
        (await import('../music/music.js')).openPlayer();
      });
      return el;
    }
    default:
      return h('div.as-chat-bubble', quote, m.text);
  }
}
function viewImage(src, alt) {
  const mask = h('div.as-chat-viewer', { onclick: () => mask.remove() }, h('img', { src, alt: alt || '' }), alt ? h('p', alt) : null);
  document.querySelector('#phone').appendChild(mask);
}

/* ================= 「+」面板的按钮 ================= */
export const PLUS = [
  ['photo', '相册', 'image'], ['camera', '拍摄描述', 'camera'], ['voicecall', '语音通话', 'phone'], ['videocall', '视频通话', 'camera'],
  ['transfer', '转账', 'wallet'], ['packet', '红包', 'box'], ['location', '位置', 'moments'], ['card', '名片', 'user'],
  ['voice', '语音', 'mic'], ['poke', '拍一拍', 'sparkle'], ['music', '一起听', 'heart'],
];
export async function plusAction(k, chat, c, { poke }) {
  const send = f => E.sendSpecial(chat, f);
  switch (k) {
    case 'photo': {
      const f = await pickFile(); if (!f) return;
      const src = await fileToDataURL(f, 900);
      const desc = await dialog({ title: '给这张图配一句描述', text: 'AI 看不到图片本身，靠这句话知道你发了什么。可以不填。', input: { placeholder: '例如：路边的小猫在晒太阳' }, confirm: '发送' });
      if (desc === null) return;
      return send({ type: 'image', src, text: (desc || '').trim() });
    }
    case 'camera': {
      const desc = await dialog({ title: '拍了一张什么？', text: '不用真的拍，写下画面就行，会变成一张图片卡片。', input: { placeholder: '例如：窗外的晚霞' }, confirm: '发送' });
      if (desc && desc.trim()) return send({ type: 'image', text: desc.trim() });
      return;
    }
    case 'voice': {
      const t = await dialog({ title: '发语音', text: '打字代替说话，会变成一条语音条。', input: { placeholder: '想说的话' }, confirm: '发送' });
      if (t && t.trim()) return send({ type: 'voice', text: t.trim(), dur: voiceDur(t) });
      return;
    }
    case 'transfer': case 'packet': {
      const pk = k === 'packet';
      const a = await dialog({ title: pk ? '发红包' : '转账', text: `余额 ${money(state.me.balance)}`, input: { placeholder: '金额' }, confirm: '下一步' });
      const amount = Math.round(parseFloat(a) * 100) / 100;
      if (!(amount > 0)) { if (a != null) toast('金额不对'); return; }
      if (amount > (state.me.balance ?? 0)) { toast('余额不够啦'); return; }
      const note = await dialog({ title: pk ? '祝福语' : '备注', input: { placeholder: pk ? '恭喜发财，大吉大利' : '可以不填' }, confirm: pk ? '塞进红包' : '转账' });
      if (note === null) return;
      return send({ type: k, amount, note: (note || '').trim() || (pk ? '恭喜发财，大吉大利' : '') });
    }
    case 'location': {
      const t = await dialog({ title: '发送位置', input: { placeholder: '例如：雾港海边的咖啡店' }, confirm: '发送' });
      if (t && t.trim()) return send({ type: 'location', text: t.trim() });
      return;
    }
    case 'card': {
      const { pickContact } = await import('./people.js');
      const p = await pickContact('把谁的名片发出去');
      if (p) return send({ type: 'card', name: p.name || E.nameOf(p), persona: p.persona || '' });
      return;
    }
    case 'voicecall': case 'videocall': return openCall(chat, c, k === 'videocall' ? 'video' : 'voice');
    case 'poke': return poke();
    case 'music': {
      const Mu = await import('../../core/music.js');
      if (!Mu.current()) { toast('先去音乐里放一首歌'); return; }
      return inviteListen(E.isGroup(chat) ? chat : c);
    }
  }
}

/** 聊天「+」里发起一起听：在你们的聊天里发一张卡片（播放页里发起的不发卡片） */
export async function inviteListen(c) {
  const Mu = await import('../../core/music.js'), s = Mu.current();
  Mu.listenWith(c);
  await E.sendSpecial(E.isGroup(c) ? c : chatForContact(c.id, true), { type: 'music', id: s.id, name: s.name, artist: s.artist, pic: s.pic || '' });
  toast(`在和${E.nameOf(c)}一起听`);
}

/** 分享一首歌（照音乐软件分享到微信）：跳到「选择一个聊天」，最近聊过的在前、能搜；点谁先确认，发完问留在聊天还是返回 */
export async function shareSong(s) {
  const { groupAvatar } = await import('./group.js');
  const p = page({ app: 'chat', id: 'chat-pick', title: '选择一个聊天', back: true });
  const title = c => E.isGroup(c) ? c.name : E.nameOf(contact(c.contactId));
  const rows = state.chats.filter(c => E.isGroup(c) || contact(c.contactId)).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).map(c => {
    const el = h('div.as-chat-conv', { role: 'button', onclick: () => send(c) },
      h('span.as-chat-conv__ava', E.isGroup(c) ? groupAvatar(c, 44) : avatar(E.avatarOf(contact(c.contactId), c), title(c), 44)),
      h('div.as-chat-conv__main', h('div.as-chat-conv__top', h('span.as-chat-conv__name', E.isGroup(c) ? E.groupTitle(c) : title(c)))));
    el._t = title(c); return el;
  });
  const q = h('input', { placeholder: '搜索', oninput: () => rows.forEach(el => { el.hidden = !el._t.includes(q.value.trim()); }) });   // 只藏起来，不重画（头像不重新解码）
  async function send(c) {
    if (!(await dialog({ title: `发送给 ${title(c)}`, text: `《${s.name}》- ${s.artist}`, confirm: '发送' }))) return;
    await E.sendSpecial(c, { type: 'song', id: s.id, name: s.name, artist: s.artist, pic: s.pic || '' });
    if (await dialog({ title: '已发送', confirm: '留在聊天', cancel: '返回音乐' })) shell.openApp('chat', { chat: c.id }); else nav.pop();
  }
  p.body.append(h('div.as-chat-search', icon('search', 17, 2), q), rows.length ? h('div.as-chat-convs', rows) : empty('还没有聊天'));
  nav.push(p.el);
}

/* ================= 表情包面板 ================= */
export function stickerPanel(chat, onSent) {
  const box = h('div.as-chat-stickers');
  const draw = () => {
    box.replaceChildren(
      h('button.as-chat-stickers__add', { 'aria-label': '导入表情包', onclick: async () => { await importStickers(); draw(); } }, icon('plus', 22, 1.8)),
      ...state.stickers.map(s => h('button', { title: s.name, onclick: async () => { await E.sendSpecial(chat, { type: 'sticker', name: s.name, src: s.src, sid: s.id }); onSent && onSent(); } }, h('img', { src: s.src, alt: s.name }))),
      state.stickers.length ? null : h('span.as-chat-stickers__tip', '还没有表情包，点 + 导入几张图片。图片的名字就是 AI 认识它的方式。'));
  };
  draw();
  return { el: box, draw };
}
export function importStickers() {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = true;
    i.onchange = async () => {
      let n = 0;
      for (const f of i.files) {
        const src = await fileToDataURL(f, 240);
        state.stickers.push({ id: uid('s'), name: f.name.replace(/\.[^.]+$/, '').slice(0, 20) || '表情', src }); n++;
      }
      commit('stickers'); if (n) toast(`导入了 ${n} 个表情包。去「我 → 表情包」可以改名字`); res(n);
    };
    i.click();
  });
}
export function openStickerManager() {
  const p = page({ app: 'chat', id: 'chat-stickers', title: '表情包', back: true, right: navBtn('plus', '导入', async () => { await importStickers(); draw(); }) });
  function draw() {
    p.body.innerHTML = '';
    if (!state.stickers.length) { p.body.appendChild(empty('还没有表情包。点右上角导入图片，图片名就是它的名字。', btn('导入', 'primary', async () => { await importStickers(); draw(); }))); return; }
    p.body.append(h('p.as-muted', { style: { margin: '0 6px 12px' } }, 'AI 靠名字认表情包（不花钱），所以名字起得越像它的意思越好，比如「摸摸头」「哭哭」。点一个可以改名或删除。'),
      h('div.as-chat-stickers.is-manage', state.stickers.map(s => h('button', { onclick: async () => {
        const v = await actionSheet(s.name, [{ value: 'rename', label: '改名字', icon: 'edit' }, { value: 'del', label: '删除', icon: 'trash', danger: true }]);
        if (v === 'rename') { const n = await dialog({ title: '改名字', input: { value: s.name } }); if (n && n.trim()) { s.name = n.trim().slice(0, 20); commit('stickers'); draw(); } }
        if (v === 'del') { state.stickers.splice(state.stickers.indexOf(s), 1); commit('stickers'); draw(); }
      } }, h('img', { src: s.src, alt: s.name }), h('span', s.name)))));
  }
  draw(); nav.push(p.el);
}

/* ================= 语音 / 视频通话 ================= */
/** 正文里写到 TA 打电话过来：响铃，接 / 挂由你决定；没接就记一条「未接来电」 */
export function ringIn(chat, c, mode) {
  shell.notify({ chatId: chat.id, title: E.nameOf(c), text: `邀请你${mode === 'video' ? '视频' : '语音'}通话`, avatarUrl: E.avatarOf(c, chat) });
  openCall(chat, c, mode, true);
}
export function openCall(chat, c, mode = 'voice', incoming = false) {
  const host = document.querySelector('#phone');
  const lines = [];
  let sec = 0, busy = null, ended = false, picked = !incoming;   // busy：TA 正在想说什么（AbortController），这时再点发送 / 让 TA 说 就取消
  const timer = h('div.as-chat-call__time', incoming ? `邀请你${mode === 'video' ? '视频' : '语音'}通话…` : '正在呼叫…');
  const log = h('div.as-chat-call__log');
  const input = h('input.as-chat-call__input', { placeholder: '说点什么…', enterkeyhint: 'send' });
  const say = h('button.as-chat-call__say', { 'aria-label': '发送', onclick: () => talk() }, icon('send', 18, 2));
  const bgUrl = chat.cfg.callBg || chat.cfg.bg || E.avatarOf(c, chat);
  let bar, ring, btns;
  const el = h('div.as-chat-call' + (mode === 'video' ? '.is-video' : ''),
    h('div.as-chat-call__bg', bgUrl ? { style: { backgroundImage: `url("${bgUrl}")` } } : null),
    h('div.as-chat-call__head', avatar(E.avatarOf(c, chat), E.nameOf(c), 96), h('b', E.nameOf(c)), timer),
    log,
    bar = h('div.as-chat-call__bar', { hidden: incoming }, input, say),
    ring = h('div.as-chat-call__btns', { hidden: !incoming },
      h('button.is-hang', { 'aria-label': '拒绝', onclick: hang }, icon('phone', 24, 2)),
      h('button.is-pick', { 'aria-label': '接听', onclick: pick }, icon('phone', 24, 2))),
    btns = h('div.as-chat-call__btns', { hidden: incoming },
      h('button', { 'aria-label': '静音', onclick: e => { e.currentTarget.classList.toggle('is-on'); stopSpeak(); } }, icon('mic', 22, 1.8)),
      h('button.is-hang', { 'aria-label': '挂断', onclick: hang }, icon('phone', 24, 2)),
      h('button', { 'aria-label': '让 TA 说', onclick: () => talk(true) }, icon('sparkle', 22, 1.8))));
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) talk(); });
  const tick = setInterval(() => { if (sec >= 0 && lines.length + sec > 0) { sec++; timer.textContent = `${mode === 'video' ? '视频' : '语音'}通话中 ${fmtDur(sec)}`; } }, 1000);
  if (incoming) setTimeout(() => { if (!picked && !ended) hang(); }, 45000);   // 45 秒没接：未接来电
  else setTimeout(() => { if (!ended) { sec = 0; timer.textContent = '已接通'; talk(true); } }, 1400);
  function pick() { picked = true; ring.hidden = true; bar.hidden = btns.hidden = false; sec = 0; timer.textContent = '已接通'; talk(true); }

  function add(who, text) { lines.push({ who, text }); log.appendChild(h('div.as-chat-call__line' + (who === 'me' ? '.is-me' : ''), text)); log.scrollTop = log.scrollHeight; }
  async function talk(themOnly) {
    if (ended) return;
    const t = input.value.trim();
    if (busy) { if (themOnly || !t) { busy.abort(); stopSpeak(); toast('已取消'); } return; }
    if (!themOnly && !t) return;
    if (t) { add('me', t); input.value = ''; }
    const ac = busy = new AbortController(); say.replaceChildren(h('i.as-spin')); say.setAttribute('aria-label', '取消');
    try {
      const out = await E.callReply(chat, lines, mode, ac.signal);
      for (const l of out) { if (ended || ac.signal.aborted) break; add('them', l); await speakAs(c.id, l.replace(/[（(][^）)]*[）)]/g, '')).catch(() => {}); }
    } catch (e) { if (!ac.signal.aborted) { add('them', '（信号不太好……）'); toast('回复失败：' + e.message); } }
    busy = null; say.replaceChildren(icon('send', 18, 2)); say.setAttribute('aria-label', '发送');
  }
  async function hang() {
    ended = true; clearInterval(tick); stopSpeak(); if (busy) busy.abort();
    el.classList.remove('is-open'); setTimeout(() => el.remove(), 360);
    const text = lines.map(l => `${l.who === 'me' ? '我' : E.nameOf(c)}：${l.text}`).join('\n');
    await E.sendSpecial(chat, picked ? { type: 'call', mode, dur: Math.max(sec, 1), text, ...(incoming ? { from: 'them' } : {}) } : { type: 'call', mode, dur: 0, missed: true, from: 'them' });
  }
}

/* ================= 钱包明细 ================= */
export function ledgerList() {
  const L = state.me.ledger || [];
  if (!L.length) return [item({ title: '还没有记录', sub: '转账、红包的收支会记在这里' })];
  return L.slice(0, 80).map(x => item({ title: x.note, sub: new Date(x.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    right: h('b', { style: { color: x.amount >= 0 ? 'var(--as-color-success)' : 'var(--as-color-text)' } }, (x.amount >= 0 ? '+' : '') + money(x.amount)) }));
}
export { group };
