// 电话：和查手机里 TA 的「电话」是同一页（照 iPhone），这里填的是你手机里真的通话：普通电话 + 聊天里打的语音、视频。
// 打、接都用聊天那个通话界面；普通电话记在 state.calls，聊天里打的还记在聊天里，这里只是读出来一起排。
// 没接的电话有打来时一起写好的留言，点开看、点播放用 TA 的声音念（念过的存着，再听不再合成）。拨号键盘按的是映像里填的号码。
import { h } from '../../core/util.js';
import { state, commit, contact, friends, getMsgs, chatForContact, subscribe } from '../../core/store.js';
import { toast, sheet, icon, busy } from '../../core/ui.js';
import { speakAs } from '../../core/voice.js';
import { stopSpeak } from '../../core/api.js';
import { myName, myAvatar } from '../../core/promptstore.js';
import * as time from '../../core/time.js';
import * as nav from '../../core/nav.js';
import { renderBadges } from '../home/home.js';
import { nameOf } from '../chat/engine.js';
import { callName, fmtDur, voiceDur } from '../chat/msgtypes.js';
import { VIEWS, trs, trBtn } from '../peek/apps.js';

async function all() {
  const dms = state.chats.filter(ch => ch.type !== 'group' && ch.contactId);
  const inChat = (await Promise.all(dms.map(async ch => (await getMsgs(ch.id)).filter(m => m.type === 'call').map(m => ({ ...m, cid: ch.contactId }))))).flat();
  return [...state.calls, ...inChat].filter(x => contact(x.cid)).sort((a, b) => b.at - a.at);
}
// 查手机那一页认的时间是「年/月/日 时:分」
const at = x => { const s = time.isStory() && x.st, D = s ? time.dayToDate(s.d) : new Date(x.at), mm = s ? s.m : D.getHours() * 60 + D.getMinutes();
  return `${D.getFullYear()}/${D.getMonth() + 1}/${D.getDate()} ${String(mm / 60 | 0).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
function voicemail(x, c) {
  let zh = false;
  const p = h('p.as-ph-vm__text', x.vm);
  const play = h('button', { onclick: () => busy(play, s => speakAs(c.id, x.vm, { cache: `tts:${chatForContact(c.id, true).id}:vm:${x.id}`, stop: s }).catch(e => { if (!s.aborted) toast('念不出来：' + e.message); })) }, icon('play', 18, 2), '播放');
  const tr = x.vmTr && h('button', { onclick: () => { zh = !zh; p.textContent = zh ? x.vmTr : x.vm; tr.textContent = zh ? '原' : '译'; } }, '译');
  sheet({ title: `${nameOf(c)} 的语音留言`, content: h('div.as-ph-vm', h('small', time.shortLabel(x)), p, h('div.as-ph-vm__acts', play, tr)), onClose: stopSpeak });
}

export function open() {
  const body = h('div.pk-app__body'), app = h('div.pk-app.is-raw', body), el = h('section.as-page.as-ph', { dataset: { asApp: 'phone', asPage: 'phone-main' } }, app);
  let L = [], sig = '';
  const byName = n => friends().find(c => nameOf(c) === n);
  const D = { apps: {}, calls: [], name: myName(), avatar: myAvatar(),
    dial: (who, loc) => { const c = byName(who) || friends().find(c => c.phone && c.phone.replace(/\D/g, '') === String(who).replace(/\D/g, ''));
      if (!c) return toast(/^[\d*#+\s-]+$/.test(who) ? '您拨打的号码是空号' : '找不到这个人');
      import('../chat/specials.js').then(S => S.openCall(chatForContact(c.id, true), c, { 视频通话: 'video', 语音通话: 'voice' }[loc] || 'phone')); },
    note: r => voicemail(r.x, contact(r.x.cid)) };
  const rows = () => [...L.map(x => [nameOf(contact(x.cid)), x.missed && x.from === 'them' ? '未接' : x.from === 'them' ? '呼入' : '呼出', at(x), x.mode === 'phone' ? '手机' : callName(x)]),
    ...L.filter(x => x.vm).map(x => Object.assign(['留言', nameOf(contact(x.cid)), at(x), fmtDur(voiceDur(x.vm)), x.vmTr ? `${x.vm}[翻译：${x.vmTr}]` : x.vm], { x })),
    ...friends().map(c => ['联系人', nameOf(c), nameOf(c), ''])];
  const paint = async () => { L = await all(); const s = L.map(x => x.id).join() + friends().length; if (s === sig) return; sig = s;
    body.replaceChildren(...[VIEWS.电话(rows(), () => {}, D, () => nav.back())].flat(3).filter(Boolean)); };
  // 不是中文的留言：和查手机一样，右上一个「译」整页一起换
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (!n.isConnected) return; trs(n.nodeType === 1 ? n : n.parentNode); trBtn(app, el); }))).observe(body, { childList: true, subtree: true });
  // 照 393 宽的 iPhone 量的：手机宽窄不一样就整体缩放；日间 / 夜间跟着手机
  const phone = document.querySelector('.as-phone'), dark = () => el.classList.toggle('is-dark', phone?.dataset.mode === 'night');
  const mo = phone && new MutationObserver(dark); mo?.observe(phone, { attributes: true, attributeFilter: ['data-mode'] }); dark();
  requestAnimationFrame(() => { body.style.zoom = (el.clientWidth / 393).toFixed(3); });
  state.calls.forEach(x => { if (x.missed) x.seen = true; }); commit('calls'); renderBadges();
  const off = subscribe(k => (k === 'calls' || k === 'chats') && paint());
  el._onLeave = () => { off(); mo?.disconnect(); };
  paint();
  return el;
}
