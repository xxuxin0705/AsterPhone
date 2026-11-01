// AI 智能加载联系人、从世界书添加、预览勾选页、新的朋友。
import { h, uid } from '../../core/util.js';
import { state, commit, contact, chatForContact, windowList, inheritWindow } from '../../core/store.js';
import { groupAvatar } from './group.js';
import { page, group, item, toggleItem, slider, textarea, input, avatar, withInfo, icon, actionSheet, dialog, toast, btn, empty, navText, pickImage } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { generate, resolveConn } from '../../core/api.js';
import { characters, currentCharacter, inTavern, worldNames, worldEntries } from '../../core/bridge.js';
import { storyText } from '../../core/context.js';
import { compose, myPersona, myName, myAvatar } from '../../core/promptstore.js';
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
let goBtn = null, bar = null, loading = null;   // 正在生成就是它的 AbortController：退出再进来按钮还是「取消生成」、进度接着走
const prog = { t0: 0, np: 0, ng: 0, fix: 0 };
const spin = () => { goBtn.classList.replace('as-btn--primary', 'as-btn--secondary'); goBtn.textContent = '取消生成'; };
// 波浪条：想到的那段亮起来，最前面凹下去一个浪头，没到的轻轻起伏；颜色跟主题。
// 没规定人数时不知道总数：每想到一个人往前推一截、越往后推得越少，生成完才算满
const BARS = 32;
function paintBar() {
  if (!bar) return;
  bar.hidden = !loading; if (!loading) return;
  const s = (Date.now() - prog.t0) / 1000;
  const head = BARS * (prog.fix ? Math.min(.96, prog.np / prog.fix) : .88 * (1 - .72 ** prog.np) + Math.min(.06, s / 100));
  [...bar.firstChild.children].forEach((b, i) => { b.classList.toggle('is-on', i < head); b.style.setProperty('--k', (1 - .55 * Math.exp(-((i - head) ** 2) / 6)).toFixed(2)); });
  bar.lastChild.firstChild.textContent = `AI 正在想… 已等 ${Math.round(s)} 秒`;
  bar.lastChild.lastChild.textContent = prog.fix ? `${prog.np} / ${prog.fix} 人` : `已想到 ${prog.np} 人${prog.ng ? ` · ${prog.ng} 个群` : ''}`;
}
export function openAiLoad(after) {
  const o = { want: '', fixCount: false, count: 6, groups: true, gWant: '', fixG: false, groupCount: 1 };
  const p = page({ app: 'chat', id: 'chat-contacts-ai', title: withInfo('AI 智能加载', '读当前角色卡、你的人设和最近的剧情，想出你手机里会有哪些人和群。生成完先给你看，勾选、改好了再加进来。'), back: true });
  const cOut = h('output', o.count + ' 人'), gOut = h('output', o.groupCount + ' 个');
  const countRow = h('div.as-settings-slider-row', h('span', '人数'), slider({ min: 1, max: 12, step: 1, value: o.count, onInput: v => { o.count = v; cOut.textContent = v + ' 人'; } }), cOut);
  const gRow = h('div.as-settings-slider-row', h('span', '群的数量'), slider({ min: 1, max: 4, step: 1, value: o.groupCount, onInput: v => { o.groupCount = v; gOut.textContent = v + ' 个'; } }), gOut);
  const gWant = h('div.as-field', textarea({ rows: 2, placeholder: '想要什么群（可以不填）', onInput: v => { o.gWant = v; } }));
  const gFix = toggleItem({ title: '规定群数' }, o.fixG, v => { o.fixG = v; sync(); });
  const sync = () => { countRow.hidden = !o.fixCount; gWant.hidden = gFix.hidden = !o.groups; gRow.hidden = !o.groups || !o.fixG; };
  const mine = goBtn = btn('开始生成', 'primary', () => loading ? loading.abort() : run(), { style: { width: '100%' } });
  const myBar = bar = h('div.as-wave', h('div.as-wave__bars', [...Array(BARS)].map((_, i) => h('i', { style: { '--i': i } }))), h('div.as-wave__st', h('span'), h('b')));
  if (loading) spin();
  paintBar();
  p.el._onLeave = () => { if (goBtn === mine) goBtn = null; if (bar === myBar) bar = null; };
  p.body.append(
    group('联系人', [h('div.as-field', textarea({ rows: 3, placeholder: '想要谁（可以不填）', onInput: v => { o.want = v; } })), toggleItem({ title: '规定人数' }, o.fixCount, v => { o.fixCount = v; sync(); }), countRow]),
    group('群聊', [toggleItem({ title: '顺便生成群聊' }, o.groups, v => { o.groups = v; sync(); }), gWant, gFix, gRow]),
    goBtn, myBar);
  sync();
  nav.push(p.el);

  async function run() {
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
    loading = new AbortController(); spin();
    Object.assign(prog, { t0: Date.now(), np: 0, ng: 0, fix: o.fixCount ? o.count : 0 }); paintBar();
    const tick = setInterval(paintBar, 1000);
    try {
      const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', prompt, maxTokens: 2400, app: 'AI 智能加载', stop: loading.signal,
        onPart: t => { const [a, b = ''] = t.split('"groups"'); prog.np = (a.match(/"name"\s*:/g) || []).length; prog.ng = (b.match(/"name"\s*:/g) || []).length; paintBar(); } });
      const data = pickJSON(raw);
      if (!keep) { state.contacts.splice(0); commit('contacts'); }
      openPreview(data, { after, under: !!goBtn });
    } catch (e) { if (e.message === '已中止') toast('取消了'); else { log('error', 'AI 智能加载', e.message); toast('生成失败：' + e.message); } }
    finally { clearInterval(tick); loading = null; paintBar(); if (goBtn) { goBtn.classList.replace('as-btn--secondary', 'as-btn--primary'); goBtn.textContent = '开始生成'; } }
  }
}

/* ================= 预览勾选页 ================= */
export function openPreview(data, { after, lore, under } = {}) {
  const ME = {}, me = myName();   // 群成员 / 群主 / 头衔都直接指着人（预览里的人、已有联系人、我），改了名字也跟着
  const byName = n => state.contacts.find(c => [c.name, c.nick, c.remark].includes(String(n || '').trim()));
  const people = (data.people || []).filter(x => x && x.name).map(x => ({ ...x, _on: !state.contacts.some(c => c.name === x.name) }));
  const ref = n => { n = String(n || '').trim(); return n === me || n === '我' ? ME : people.find(x => x.name === n) || byName(n); };
  const nm = m => m === ME ? me : people.includes(m) ? m.name : E.nameOf(m);
  const hasGroup = n => state.chats.some(c => c.type === 'group' && c.name === n);
  const groups = (data.groups || []).filter(x => x && x.name).map(x => {
    const members = [...new Set((x.members || []).map(ref))].filter(m => m && m !== ME), owner = ref(x.owner) || ME;
    if (owner !== ME && !members.includes(owner)) members.push(owner);
    return { ...x, members, owner, titles: new Map(Object.entries(x.titles || {}).map(([n, t]) => [ref(n), String(t || '').trim()]).filter(([m, t]) => m && t)), _on: !hasGroup(x.name) };
  });
  const labels = [];   // 群成员格子里的名字：预览里改了真实姓名，这里跟着改
  const p = page({ app: 'chat', id: 'chat-contacts-preview', title: '看看 AI 想的', back: true, right: navText('加入', add, true) });
  const card = (x, kind) => {
    const ck = h('span.as-chat-check' + (x._on ? '.is-active' : ''), icon('check', 14, 2.6));
    const toggle = () => { x._on = !x._on; ck.classList.toggle('is-active', x._on); el.classList.toggle('is-off', !x._on); };
    const ava = () => kind === 'p' ? avatar(x.avatar || '', x.name, 36) : groupAvatar(x, 36);
    const avaBox = h('span', { onclick: async ev => { ev.stopPropagation(); const v = await pickImage(kind === 'g' ? '群头像' : '头像', { has: !!x.avatar }); if (v != null) { x.avatar = v; avaBox.replaceChildren(ava()); } } }, ava());
    const title = h('b', x.name);
    const rename = v => { x.name = v; title.textContent = v; if (!x.avatar) avaBox.replaceChildren(ava()); labels.forEach(([m, s]) => { if (m === x) s.textContent = v; }); };
    const f = (label, key, multi) => h('label.as-chat-pv__f', h('span', label), (multi ? textarea : input)({ value: x[key] || '', rows: 2, onInput: v => { key === 'name' ? rename(v) : x[key] = v; } }));
    const el = h('div.as-chat-pv' + (x._on ? '' : '.is-off'),
      h('div.as-chat-pv__head', { onclick: toggle }, ck, avaBox, title, x.gender ? h('em', x.gender) : null, (kind === 'p' ? state.contacts.some(c => c.name === x.name) : hasGroup(x.name)) ? h('em', '已有') : null),
      kind === 'p' ? [f('真实姓名', 'name'), f('网名', 'nick'), f('备注', 'remark'), f('个性签名', 'sign'), f('拍一拍后缀', 'pokeSuffix'), f('人设', 'persona', true), x.entry ? h('div.as-muted', '来自条目：' + x.entry) : null]
        : [f('群名', 'name'), f('群介绍', 'intro', true), f('群公告', 'notice'), members(x)]);
    return el;
  };
  // 群成员：和群资料页一样的格子；点人设头衔 / 设群主 / 移出，最后一格邀请
  function members(x) {
    const grid = h('div.as-chat-members');
    const paint = () => grid.replaceChildren(...[ME, ...x.members].map(m => {
      const s = h('span', nm(m)); labels.push([m, s]);
      return h('button', { onclick: () => menu(m) }, avatar(m === ME ? myAvatar() : m.avatar || '', nm(m), 48), s, h('em', x.owner === m ? '群主' : x.titles.get(m) || ''));
    }), h('button', { onclick: invite }, h('span.as-chat-members__plus', icon('plus', 22, 1.8)), h('span', '邀请')));
    async function menu(m) {
      const v = await actionSheet(nm(m), [{ value: 'title', label: '设置群头衔', icon: 'star' }, x.owner !== m && { value: 'owner', label: '设为群主', icon: 'users' }, m !== ME && { value: 'kick', label: '移出群聊', icon: 'trash', danger: true }].filter(Boolean));
      if (v === 'title') { const t = await dialog({ title: '群头衔', input: { value: x.titles.get(m) || '' } }); if (t !== null) x.titles.set(m, t.trim()); }
      if (v === 'owner') x.owner = m;
      if (v === 'kick') { x.members = x.members.filter(y => y !== m); if (x.owner === m) x.owner = ME; }
      if (v) paint();
    }
    async function invite() {
      const all = [...people, ...state.contacts.filter(c => !people.some(y => y.name === c.name))].filter(m => !x.members.includes(m));
      if (!all.length) { toast('没有可以邀请的人了'); return; }
      const picked = await pickMany('邀请进群', all.map((m, i) => ({ key: String(i), name: nm(m), avatar: m.avatar })));
      if (picked && picked.length) { x.members.push(...picked.map(i => all[+i])); paint(); }
    }
    paint();
    return grid;
  }
  p.body.append(
    people.length ? group(`联系人（${people.length}）`, [h('div.as-chat-pvs', people.map(x => card(x, 'p')))], '点勾取消，点头像换头像，内容都能改。') : empty('AI 没想出新的人'),
    groups.length ? group(`群聊（${groups.length}）`, [h('div.as-chat-pvs', groups.map(x => card(x, 'g')))]) : null);
  nav.push(p.el);

  async function add() {
    let np = 0, ng = 0;
    for (const x of people) {
      const old = byName(x.name);
      if (old) { x._c = old; continue; }
      if (!x._on) continue;
      const c = { ...blankContact(), name: x.name.trim(), nick: (x.nick || '').trim(), remark: (x.remark || '').trim(), gender: x.gender || '', sign: x.sign || '', pokeSuffix: x.pokeSuffix || '', persona: x.persona || '', avatar: x.avatar || '', source: lore ? 'lore' : 'ai' };
      if (lore && x.entry) { const e = lore.entries.find(en => en.title === x.entry) || lore.entries[0]; if (e) c.lore = { world: lore.world, uid: e.uid, title: e.title }; }
      state.contacts.push(c); x._c = c; np++;
      chatForContact(c.id, true).lastAt = Date.now();   // 没聊过也在消息列表里
    }
    const idOf = m => m === ME ? 'me' : people.includes(m) ? m._c && m._c.id : m.id;
    for (const g of groups.filter(x => x._on)) {
      if (hasGroup(g.name.trim())) continue;
      const ids = [...new Set(g.members.map(idOf).filter(Boolean))];
      if (ids.length < 2) continue;
      const chat = E.createGroup(ids, g.name.trim());
      chat.intro = g.intro || ''; chat.notice = g.notice || ''; chat.avatar = g.avatar || '';
      chat.owner = ids.includes(idOf(g.owner)) ? idOf(g.owner) : 'me';
      g.titles.forEach((t, m) => { if (m === ME) chat.cfg.myTitle = t; else if (ids.includes(idOf(m))) chat.titles[idOf(m)] = t; });
      ng++;
    }
    commit('contacts'); commit('chats');
    toast(`新增 ${np} 个联系人${ng ? `、${ng} 个群聊` : ''}`);
    nav.pop(); if (under) nav.pop();   // 生成页还在下面就一起退
    after && after();
  }
}

/* ================= 从别的窗口继承 ================= */
export async function openInherit(after) {
  const list = await windowList();
  if (!list.length) { toast('别的窗口还没有手机数据'); return; }
  const key = await actionSheet('从哪个窗口继承', list.map(w => ({ value: w.key, label: `${w.label}（${w.people} 人 · ${w.chats} 个聊天）` })));
  if (key == null) return;
  const what = await actionSheet('要继承什么', [{ value: 'people', label: '只要联系人和群', icon: 'users' }, { value: 'all', label: '全部', icon: 'chat' }]);
  if (!what) return;
  if ((state.contacts.length || state.chats.length) && !(await dialog({ title: '换掉这个窗口的手机数据？', text: '这个窗口现在的联系人、聊天记录、动态这些，会全部换成继承来的。', confirm: '换掉', danger: true }))) return;
  toast('正在继承…', true);
  try { await inheritWindow(key, what === 'all'); toast('继承好了'); after && after(); }
  catch (e) { log('error', '继承', e.message); toast('继承失败：' + e.message); }
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
  toast('AI 正在拆人…', true);
  try {
    const raw = await generate({ conn: resolveConn('text', 'chat'), system: '', maxTokens: 2400, app: '世界书拆人',
      prompt: compose('lore', { existing: state.contacts.map(E.nameOf).join('、') || '（无）', entries: chosen.map(e => `【${e.title}】\n${e.content.slice(0, 2500)}`).join('\n\n') }) });
    const data = pickJSON(raw); toast(`拆出 ${(data.people || []).length} 个人`);
    openPreview(data, { after, lore: { world, entries: chosen } });
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
    const c = { ...blankContact(), name: r.name, persona: r.persona || '', source: 'card' };
    state.contacts.push(c); chatForContact(c.id, true).lastAt = Date.now();
    commit('contacts'); toast(`已添加 ${r.name}`); draw();
  }
  draw(); p.el._onShow = draw; nav.push(p.el);
}
export const pendingFriends = () => state.friendRequests.filter(r => r.status === 'pending').length;
void contact;
