// 聊天的导出 / 导入：聊天列表多选导出、单聊群聊设置里导出一个、「所有窗口的数据」里导出别的窗口，都是同一种文件；
// 导入时按真实姓名认人（这个窗口没有的就加上），和已有的聊天撞了，弹窗比一比让人选留哪个。
import { h, uid, pickFile } from '../../core/util.js';
import { state, commit, contact, getMsgs, clearMsgs, kvSet } from '../../core/store.js';
import { dialog, toast } from '../../core/ui.js';
import { nameOf, preview } from './engine.js';
import * as time from '../../core/time.js';
import { log } from '../../core/log.js';

/** people：这些聊天里的人从哪找（默认当前窗口；导出别的窗口时传那个窗口的联系人） */
export async function exportChats(chats, people = state.contacts) {
  const who = id => people.find(c => c.id === id);
  const items = [];
  for (const chat of chats) items.push({ chat, contacts: (chat.type === 'group' ? chat.members : [chat.contactId]).map(who).filter(Boolean), msgs: await getMsgs(chat.id) });
  const one = chats.length === 1 && (chats[0].type === 'group' ? chats[0].name : nameOf(items[0].contacts[0] || {}));
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ app: 'AsterPhone', kind: 'chats', items })], { type: 'application/json' })),
    download: one ? `AsterPhone-${one}-聊天记录.json` : `AsterPhone-聊天记录-${chats.length}个-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  toast(`导出了 ${chats.length} 个聊天`);
}

export async function importChats(after) {
  const f = await pickFile('.json,application/json'); if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch (e) { toast('这个文件读不出来'); return; }
  // 以前单个导出的文件（kind: chat / group）也认
  const items = d && d.app === 'AsterPhone' && (d.kind === 'chats' ? d.items : (d.kind === 'chat' || d.kind === 'group') && d.chat ? [{ chat: d.chat, contacts: d.contact ? [d.contact] : [], msgs: d.msgs }] : null);
  if (!Array.isArray(items) || !items.length) { toast('这不是导出的聊天记录'); return; }
  let added = 0, kept = 0;
  try {
    for (const it of items) {
      // 人按真实姓名认；文件里的编号全换成这个窗口里的（聊天、消息里都有）
      const ids = {};
      for (const c of it.contacts || []) {
        let mine = state.contacts.find(x => x.name && x.name === c.name);
        if (!mine) { mine = { ...c, id: uid('p') }; state.contacts.push(mine); }
        ids[c.id] = mine.id;
      }
      let s = JSON.stringify(it);
      for (const [a, b] of Object.entries(ids)) s = s.split(JSON.stringify(a)).join(JSON.stringify(b));
      const { chat, msgs = [] } = JSON.parse(s), isG = chat.type === 'group';
      if (isG) chat.members = (chat.members || []).filter(contact);
      else if (!contact(chat.contactId)) continue;
      const old = state.chats.find(x => x.type === chat.type && (isG ? x.name === chat.name : x.contactId === chat.contactId));
      if (old) {
        const mine = await getMsgs(old.id);
        if (mine.length) {
          const line = (L, label) => { const m = L[L.length - 1]; return `${label}：${L.length} 条${m ? `，最后一条「${preview(m).slice(0, 24)}」（${time.shortLabel(m)}）` : ''}`; };
          const useNew = await dialog({ title: `和「${isG ? chat.name : nameOf(contact(chat.contactId))}」的聊天已经有了`, text: `${line(mine, '这个窗口里的')}\n${line(msgs, '文件里的')}\n\n留哪个？`, confirm: '用文件里的', cancel: '留原来的' });
          if (!useNew) { kept++; continue; }
        }
        await clearMsgs(old.id); state.chats.splice(state.chats.indexOf(old), 1);
      }
      chat.id = uid(isG ? 'g_' : 'c_');
      await kvSet('msgs:' + chat.id, msgs);
      state.chats.push(chat); added++;
    }
  } catch (e) { log('error', '导入聊天', e.message); toast('导入失败：' + e.message); }
  commit('contacts'); commit('chats');
  toast(added ? `导入了 ${added} 个聊天${kept ? `，${kept} 个留了原来的` : ''}` : '没有导入新的聊天');
  after && after();
}
