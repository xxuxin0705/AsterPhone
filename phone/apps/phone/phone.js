// 电话：最近通话（普通电话 + 聊天里打的语音、视频，照 iPhone 一起列）和通讯录。打、接都用聊天那个通话界面；
// 普通电话记在 state.calls，聊天里打的还记在聊天里，这里只是读出来一起排。没接的电话有打来时一起写好的留言，点开看、点播放用 TA 的声音念（念过的存着，再听不再合成）。
import { h, sortZh } from '../../core/util.js';
import { state, commit, contact, friends, getMsgs, chatForContact, subscribe } from '../../core/store.js';
import { page, empty, toast, sheet, avatar, icon, actionSheet, busy } from '../../core/ui.js';
import { speakAs } from '../../core/voice.js';
import { stopSpeak } from '../../core/api.js';
import * as time from '../../core/time.js';
import { renderBadges } from '../home/home.js';
import { nameOf } from '../chat/engine.js';
import { callName, fmtDur } from '../chat/msgtypes.js';

const FILTERS = ['全部', '未接来电', '语音留言'];
// 听筒、三条线：和查手机里的电话用同一个样子（公共图标里没有）
const svg = d => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" ${d}</svg>`; return t.content.firstChild; };
const handset = () => svg('fill="currentColor" aria-hidden="true"><path d="M6.3 3.2c.9-.4 1.9 0 2.3.9l1.3 2.9c.4.8.1 1.8-.6 2.3l-1.4 1c1 2.2 2.8 4 5 5l1-1.4c.5-.7 1.5-1 2.3-.6l2.9 1.3c.9.4 1.3 1.4.9 2.3l-.6 1.4c-.6 1.3-2 2.1-3.4 1.8C9.4 18.9 5.1 14.6 3.8 8.3c-.3-1.4.5-2.8 1.8-3.4z"/>');
const kind = x => x.mode === 'phone' ? '手机' : callName(x);
const dial = (c, mode = 'phone') => import('../chat/specials.js').then(S => S.openCall(chatForContact(c.id, true), c, mode));
async function all() {
  const dms = state.chats.filter(ch => ch.type !== 'group' && ch.contactId);
  const inChat = (await Promise.all(dms.map(async ch => (await getMsgs(ch.id)).filter(m => m.type === 'call').map(m => ({ ...m, cid: ch.contactId }))))).flat();
  return [...state.calls, ...inChat].filter(x => contact(x.cid)).sort((a, b) => b.at - a.at);
}
function voicemail(x, c) {
  let zh = false;
  const p = h('p.as-ph-vm__text', x.vm);
  const play = h('button.as-ph-vm__play', { onclick: () => busy(play, s => speakAs(c.id, x.vm, { cache: `tts:${chatForContact(c.id, true).id}:vm:${x.id}`, stop: s }).catch(e => { if (!s.aborted) toast('念不出来：' + e.message); })) }, icon('play', 18, 2), '播放');
  const tr = x.vmTr && h('button.as-ph-vm__tr', { onclick: () => { zh = !zh; p.textContent = zh ? x.vmTr : x.vm; tr.textContent = zh ? '原' : '译'; } }, '译');
  sheet({ title: `${nameOf(c)} 的语音留言`, content: h('div.as-ph-vm', h('small', time.shortLabel(x)), p, h('div.as-ph-vm__acts', play, tr)), onClose: stopSpeak });
}

export function open() {
  let f = '全部', tab = '通话', sig = '';
  const box = h('div.as-ph-list');
  const filterB = h('button.as-navbar__btn', { 'aria-label': '筛选', onclick: async () => { const v = await actionSheet('筛选', FILTERS.map(label => ({ value: label, label, active: label === f }))); if (v && v !== f) { f = v; sig = ''; paint(); } } }, svg('fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/>'));
  const p = page({ app: 'phone', id: 'phone-main', title: '通话', large: true, back: true, right: [filterB] });
  const row = x => { const c = contact(x.cid), miss = x.missed && x.from === 'them';
    return h('div.as-ph-row' + (miss ? '.is-miss' : ''), avatar(c.avatar || '', nameOf(c), 40),
      h('button.as-ph-row__main', { onclick: () => x.vm ? voicemail(x, c) : x.text ? sheet({ title: `${kind(x)} ${fmtDur(x.dur || 0)}`, content: h('p.as-ph-vm__text', x.text) }) : null },
        h('b', nameOf(c)), h('span', h('em', '主号'), kind(x) + (x.vm ? ' · 语音留言' : ''))),
      h('time', time.shortLabel(x)), h('button.as-ph-dial', { 'aria-label': '回拨', onclick: () => dial(c, x.mode) }, handset())); };
  const book = () => friends().map(c => [nameOf(c), c]).sort((a, b) => sortZh(a[0], b[0])).map(([n, c]) =>
    h('div.as-ph-row', avatar(c.avatar || '', n, 40), h('button.as-ph-row__main', { onclick: () => dial(c) }, h('b', n)), h('button.as-ph-dial', { 'aria-label': '打电话', onclick: () => dial(c) }, handset())));
  async function paint() {
    if (tab === '通讯录') { box.replaceChildren(...(friends().length ? book() : [empty('还没有联系人')])); return; }
    const L = (await all()).filter(x => f === '全部' || (f === '未接来电' ? x.missed && x.from === 'them' : x.vm)), s = L.map(x => x.id).join() + f;
    if (s === sig) return; sig = s;
    box.replaceChildren(...(L.length ? L.map(row) : [empty(f === '全部' ? '还没有通话' : '没有' + f)]));
  }
  const tabs = h('div.as-ph-tabs', ['通话', '通讯录'].map(n => h('button' + (n === tab ? '.is-on' : ''), { onclick: e => {
    tab = n; sig = ''; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === e.currentTarget)); filterB.hidden = n !== '通话'; p.setTitle(n); paint(); } }, n)));
  state.calls.forEach(x => { if (x.missed) x.seen = true; }); commit('calls'); renderBadges();
  const off = subscribe(k => (k === 'calls' || k === 'chats') && paint());
  p.el._onLeave = off;
  p.body.append(box); p.el.append(tabs); p.el.classList.add('as-ph');
  paint();
  return p.el;
}
