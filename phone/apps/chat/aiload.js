// AI 智能加载联系人、从世界书添加、预览勾选页、新的朋友。
import { h, uid } from '../../core/util.js';
import { state, commit, contact } from '../../core/store.js';
import { page, group, item, toggleItem, slider, textarea, input, avatar, withInfo, icon, actionSheet, dialog, toast, btn, empty, navText } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { generate, resolveConn } from '../../core/api.js';
import { characters, currentCharacter, inTavern, worldNames, worldEntries } from '../../core/bridge.js';
import { storyText } from '../../core/context.js';
import { compose, myPersona, myName } from '../../core/promptstore.js';
import { log } from '../../core/log.js';
import { blankContact, pickMany } from './people.js';
import * as E from './engine.js';

/** 从 AI 的回答里抠出 JSON */
function pickJSON(raw) {
  const s = String(raw || '').replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('AI 没有按格式返回');
  return JSON.parse(s.slice(a, b + 1));
}

/* ================= AI 智能加载 ================= */
let goBtn = null, loading = false;   // 退出再进来还在生成：按钮接着转圈，不能再点
const spin = () => { goBtn.disabled = true; goBtn.replaceChildren(h('i.as-spin'), ' AI 正在想…'); };
export function openAiLoad(after) {
  const o = { want: '', fixCount: false, count: 6, groups: true, gWant: '', fixG: false, groupCount: 1 };
  const p = page({ app: 'chat', id: 'chat-contacts-ai', title: withInfo('AI 智能加载', '读当前角色卡、你的人设和最近的剧情，想出你手机里会有哪些人和群。生成完先给你看，勾选、改好了再加进来。'), back: true });
  const cOut = h('output', o.count + ' 人'), gOut = h('output', o.groupCount + ' 个');
  const countRow = h('div.as-settings-slider-row', h('span', '人数'), slider({ min: 1, max: 12, step: 1, value: o.count, onInput: v => { o.count = v; cOut.textContent = v + ' 人'; } }), cOut);
  const gRow = h('div.as-settings-slider-row', h('span', '群的数量'), slider({ min: 1, max: 4, step: 1, value: o.groupCount, onInput: v => { o.groupCount = v; gOut.textContent = v + ' 个'; } }), gOut);
  const gWant = h('div.as-field', textarea({ rows: 2, placeholder: '想要什么群（可以不填）', onInput: v => { o.gWant = v; } }));
  const gFix = toggleItem({ title: '规定群数' }, o.fixG, v => { o.fixG = v; sync(); });
  const sync = () => { countRow.hidden = !o.fixCount; gWant.hidden = gFix.hidden = !o.groups; gRow.hidden = !o.groups || !o.fixG; };
  const mine = goBtn = btn('开始生成', 'primary', run, { style: { width: '100%' } });
  if (loading) spin();
  p.el._onLeave = () => { if (goBtn === mine) goBtn = null; };
  p.body.append(
    group('联系人', [h('div.as-field', textarea({ rows: 3, placeholder: '想要谁（可以不填）', onInput: v => { o.want = v; } })), toggleItem({ title: '规定人数' }, o.fixCount, v => { o.fixCount = v; sync(); }), countRow]),
    group('群聊', [toggleItem({ title: '顺便生成群聊' }, o.groups, v => { o.groups = v; sync(); }), gWant, gFix, gRow]),
    goBtn);
  sync();
  nav.push(p.el);

  async function run() {
    if (loading) return;
    let keep = true;
    if (state.contacts.length) {
      const v = await actionSheet('已经有联系人了', [{ value: 'keep', label: '保留现有，只补缺的', icon: 'plus' }, { value: 'reset', label: '清空重来', icon: 'trash', danger: true }]);
      if (!v) return; keep = v === 'keep';
    }
    const chars = characters(), cur = currentCharacter();
    const cards = (cur ? chars.filter(x => x.key === cur.key) : chars.slice(0, 3)).map(x => `${x.name}：${(x.persona || '').slice(0, 1200)}`).join('\n\n') || '（没有读到角色卡，请根据常识自由发挥一个都市日常的人际圈）';
    const me = myName(), groupNames = state.chats.filter(c => c.type === 'group').map(c => c.name);
    const require = (o.want.trim() ? `${me} 说：${o.want.trim()}\n这里点到的人一定要有；除非说了只要这些，还可以按剧情再补别的人。\n` : '')
      + (o.fixCount ? `新的人一共正好 ${o.count} 个。` : '新的人有几个按剧情自己定，要有亲疏远近，包括角色卡里提到的人。')
      + (o.groups ? `\n群聊：${o.fixG ? `正好 ${o.groupCount} 个` : '要几个按剧情自己定'}${o.gWant.trim() ? `，${me} 说：${o.gWant.trim()}` : ''}。成员从联系人里选，${me} 默认在每个群里，不用写。${keep && groupNames.length ? `\n已经有的群（不要重复）：${groupNames.join('、')}` : ''}` : '\n不要生成群聊，groups 留空数组。');
    const prompt = compose('aiLoad', { cards, user_persona: myPersona() || '（无）', story: storyText(12) || '（暂无）', existing: keep ? (state.contacts.map(E.nameOf).join('、') || '（无）') : '（无）', require, withGroups: o.groups ? '和群聊' : '' });
    loading = true; spin();
    try {
      const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', prompt, maxTokens: 2400, app: 'AI 智能加载' });
      const data = pickJSON(raw);
      if (!keep) { state.contacts.splice(0); commit('contacts'); }
      openPreview(data, { after, under: !!goBtn });
    } catch (e) { log('error', 'AI 智能加载', e.message); toast('生成失败：' + e.message); }
    finally { loading = false; if (goBtn) { goBtn.disabled = false; goBtn.textContent = '开始生成'; } }
  }
}

/* ================= 预览勾选页 ================= */
export function openPreview(data, { after, lore, under } = {}) {
  const people = (data.people || []).filter(x => x && x.name).map(x => ({ ...x, _on: !state.contacts.some(c => c.name === x.name) }));
  const hasGroup = n => state.chats.some(c => c.type === 'group' && c.name === n);
  const groups = (data.groups || []).filter(x => x && x.name).map(x => ({ ...x, members: x.members || [], _on: !hasGroup(x.name) }));
  const p = page({ app: 'chat', id: 'chat-contacts-preview', title: '看看 AI 想的', back: true, right: navText('加入', add, true) });
  const card = (x, kind) => {
    const ck = h('span.as-chat-check' + (x._on ? '.is-active' : ''), icon('check', 14, 2.6));
    const toggle = () => { x._on = !x._on; ck.classList.toggle('is-active', x._on); el.classList.toggle('is-off', !x._on); };
    const f = (label, key, multi) => h('label.as-chat-pv__f', h('span', label), multi ? textarea({ value: x[key] || '', rows: 2, onInput: v => { x[key] = v; } }) : input({ value: x[key] || '', onInput: v => { x[key] = v; } }));
    const el = h('div.as-chat-pv' + (x._on ? '' : '.is-off'),
      h('div.as-chat-pv__head', { onclick: toggle }, ck, kind === 'g' ? h('span.as-chat-gava', { style: { width: '36px', height: '36px' } }) : avatar('', x.name, 36), h('b', x.name), x.gender ? h('em', x.gender) : null, (kind === 'p' ? state.contacts.some(c => c.name === x.name) : hasGroup(x.name)) ? h('em', '已有') : null),
      kind === 'p' ? [f('真实姓名', 'name'), f('网名', 'nick'), f('备注', 'remark'), f('个性签名', 'sign'), f('拍一拍后缀', 'pokeSuffix'), f('人设', 'persona', true), x.entry ? h('div.as-muted', '来自条目：' + x.entry) : null]
        : [f('群名', 'name'), f('群介绍', 'intro', true), f('群公告', 'notice'), h('div.as-muted', `群主：${x.owner || '我'} · 成员：${x.members.join('、') || '（无）'}`)]);
    return el;
  };
  p.body.append(
    people.length ? group(`联系人（${people.length}）`, [h('div.as-chat-pvs', people.map(x => card(x, 'p')))], '点名字那一行可以取消勾选；下面的内容可以直接改。') : empty('AI 没想出新的人'),
    groups.length ? group(`群聊（${groups.length}）`, [h('div.as-chat-pvs', groups.map(x => card(x, 'g')))]) : null,
    btn('确认加入', 'primary', add, { style: { width: '100%' } }));
  nav.push(p.el);

  async function add() {
    const byName = n => state.contacts.find(c => [c.name, c.nick, c.remark].includes(String(n || '').trim()));
    let np = 0, ng = 0;
    for (const x of people.filter(x => x._on)) {
      if (byName(x.name)) continue;
      const c = { ...blankContact(), name: x.name.trim(), nick: (x.nick || '').trim(), remark: (x.remark || '').trim(), gender: x.gender || '', sign: x.sign || '', pokeSuffix: x.pokeSuffix || '', persona: x.persona || '', source: lore ? 'lore' : 'ai' };
      if (lore && x.entry) { const e = lore.entries.find(en => en.title === x.entry) || lore.entries[0]; if (e) c.lore = { world: lore.world, uid: e.uid, title: e.title }; }
      state.contacts.push(c); np++;
    }
    for (const g of groups.filter(x => x._on)) {
      if (hasGroup(g.name.trim())) continue;
      const ids = g.members.map(byName).filter(Boolean).map(c => c.id);
      if (ids.length < 2) continue;
      const chat = E.createGroup([...new Set(ids)], g.name.trim());
      chat.intro = g.intro || ''; chat.notice = g.notice || '';
      const owner = byName(g.owner); if (owner) chat.owner = owner.id;
      ng++;
    }
    commit('contacts'); commit('chats');
    toast(`新增 ${np} 个联系人${ng ? `、${ng} 个群聊` : ''}`);
    nav.pop(); if (under) nav.pop();   // 生成页还在下面就一起退
    after && after();
  }
}

/* ================= 从世界书添加 ================= */
export async function openLoreAdd(after) {
  if (!inTavern()) { toast('单独预览时读不到酒馆的世界书'); return; }
  const names = worldNames();
  if (!names.length) { toast('没有找到世界书'); return; }
  const world = await actionSheet('选一本世界书', names.map(n => ({ value: n, label: n, icon: 'note' })));
  if (!world) return;
  let entries;
  try { entries = await worldEntries(world); } catch (e) { toast(e.message); return; }
  if (!entries.length) { toast('这本世界书是空的'); return; }
  const picked = await pickMany('选写了人物的条目', entries.map(e => ({ key: String(e.uid), name: e.title, note: e.keys.slice(0, 2).join('、') })));
  if (!picked || !picked.length) return;
  const chosen = entries.filter(e => picked.includes(String(e.uid)));
  toast('AI 正在拆人…');
  try {
    const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', maxTokens: 2400, app: '世界书拆人',
      prompt: compose('lore', { existing: state.contacts.map(E.nameOf).join('、') || '（无）', entries: chosen.map(e => `【${e.title}】\n${e.content.slice(0, 2500)}`).join('\n\n') }) });
    openPreview(pickJSON(raw), { after, lore: { world, entries: chosen } });
  } catch (e) { log('error', '世界书拆人', e.message); toast('拆人失败：' + e.message); }
}

/** 聊天前把连到世界书的人设刷新一下（世界书改了，手机跟着变） */
export async function refreshLore(c) {
  if (!c || !c.lore || !inTavern()) return;
  try {
    const e = (await worldEntries(c.lore.world)).find(x => String(x.uid) === String(c.lore.uid));
    if (e) c.loreText = e.content;
  } catch (err) { /* 读不到就用上次的 */ }
}

/* ================= 新的朋友 ================= */
export function addFriendRequest(name, { from, persona } = {}) {
  if (state.contacts.some(c => c.name === name) || state.friendRequests.some(r => r.name === name && r.status === 'pending')) return false;
  state.friendRequests.unshift({ id: uid('fr'), name, from: from || '', persona: persona || '', at: Date.now(), status: 'pending' });
  commit('contacts'); return true;
}
export function openNewFriends() {
  const p = page({ app: 'chat', id: 'chat-contacts-new', title: '新的朋友', back: true });
  const draw = () => {
    p.body.innerHTML = '';
    const list = state.friendRequests;
    if (!list.length) { p.body.appendChild(empty('还没有好友申请。聊天里有人发名片给你，点一下名片就会出现在这里。')); return; }
    p.body.appendChild(group('', list.map(r => item({ icon: avatar('', r.name, 36), color: 'transparent', cls: 'as-chat-person', title: r.name, sub: r.from ? `${r.from} 推荐的名片` : '名片',
      right: r.status === 'pending' ? h('span.as-row', btn('接受', 'primary', () => accept(r), { style: { padding: '8px 12px' } }), btn('忽略', 'secondary', () => { list.splice(list.indexOf(r), 1); commit('contacts'); draw(); }, { style: { padding: '8px 12px' } }))
        : h('span.as-muted', r.status === 'accepted' ? '已添加' : '已忽略') }))));
  };
  function accept(r) {
    r.status = 'accepted';
    state.contacts.push({ ...blankContact(), name: r.name, persona: r.persona || '', source: 'card' });
    commit('contacts'); toast(`已添加 ${r.name}`); draw();
  }
  draw(); p.el._onShow = draw; nav.push(p.el);
}
export const pendingFriends = () => state.friendRequests.filter(r => r.status === 'pending').length;
void contact;
