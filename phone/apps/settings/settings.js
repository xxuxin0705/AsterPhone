// 设置 App。铁律：一样东西只有一个家；别处显示「跟随全局」时，点一下跳到它真正的家。
import { h, uid, pickFile } from '../../core/util.js';
import { state, commit, CHAT_MSG_TYPES, exportAll, importAll, wipeAll, usage, clearMsgs } from '../../core/store.js';
import { page, group, item, toggleItem, segmented, slider, input, textarea, field, btn, navText, navBtn, actionSheet, dialog, toast, sheet, empty, icon } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { CHANNELS, resolveConn, listModels, testConn } from '../../core/api.js';
import { getPrompt, setPrompt, resetPrompt, promptsIn } from '../../core/promptstore.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { inTavern } from '../../core/bridge.js';
import * as walls from '../../core/walls.js';
import { importClockFont, removeClockFont, clockFontName } from '../../core/fonts.js';
import { THEMES, lib } from '../../core/skin.js';

export const VERSION = '0.6.5';
export const FABS = [['forest', '森林小芽'], ['candy', '糖果'], ['ocean', '海洋'], ['sunflower', '向日葵'], ['neon', '霓虹'], ['iphone', 'iPhone'],
  ['ancient', '古风'], ['xianxia', '仙侠'], ['magic', '魔法'], ['steampunk', '蒸汽朋克'], ['retro', '复古游戏机'], ['autumn', '秋日']];
const MODE_LABEL = { day: '日间', night: '夜间', auto: '跟随系统' };
const LOCK_LABEL = { none: '无（上滑解锁）', finger: '指纹', pin: '数字密码', pattern: '手势密码' };
const KIND_LABEL = { text: '文字', image: '生图', tts: '语音', embed: '向量' };
const S = () => state.settings;
const sliderRow = (label, { min, max, step, value, onInput, fmt = v => v }) => {
  const out = h('output', fmt(value));
  return h('div.as-settings-slider-row', h('span', label), slider({ min, max, step, value, onInput: v => { out.textContent = fmt(v); onInput(v); } }), out);
};
/** 子页面：draw() 每次回到这页都会重画 */
function sub(id, title, draw, opts = {}) {
  const p = page({ app: 'settings', id: 'settings-' + id, title, back: true, ...opts });
  const re = () => { const y = p.body.scrollTop; p.body.innerHTML = ''; draw(p.body, re, p); p.body.scrollTop = y; };
  re(); p.el._onShow = re;
  nav.push(p.el);
  return p;
}

/* ================= 首页 ================= */
export function open() {
  const p = page({ app: 'settings', id: 'settings-home', title: '设置', large: true, back: true });
  const draw = () => {
    p.body.querySelectorAll('.as-list-group').forEach(x => x.remove());
    const dc = resolveConn('text', 'chat');
    p.body.append(
      group('', [
        item({ icon: 'link', color: 'blue', title: '连接', value: dc ? dc.name : '未设置', chevron: true, onClick: openConnections }),
        item({ icon: 'grid', color: 'purple', title: '应用管理', chevron: true, onClick: openApps }),
        item({ icon: 'note', color: 'teal', title: '通用提示词', chevron: true, onClick: openPrompts }),
      ]),
      group('', [
        item({ icon: 'palette', color: 'orange', title: '外观', value: MODE_LABEL[S().mode], chevron: true, onClick: openLook }),
        item({ icon: 'lock', color: 'gray', title: '锁屏与密码', value: S().lock.enabled ? LOCK_LABEL[S().lock.method] : '关闭', chevron: true, onClick: openLock }),
        item({ icon: 'bell', color: 'red', title: '通知', chevron: true, onClick: openNotify }),
      ]),
      group('', [
        item({ icon: 'phone', color: 'green', title: '手机本体', value: S().timeSrc === 'story' ? '剧情时间' : '现实时间', chevron: true, onClick: openDevice }),
        item({ icon: 'db', color: 'gold', title: '数据', chevron: true, onClick: openData }),
        item({ icon: 'info', color: 'pink', title: '关于', value: 'v' + VERSION, chevron: true, onClick: openAbout }),
      ]));
  };
  draw(); p.el._onShow = draw;
  return p.el;
}

/* ================= 连接 ================= */
let connKind = 'text';
/** 连接首页：插线板（拎线插接口）；右上角菜单里可以切到老的列表模式 */
async function openConnections() {
  const { openBoard } = await import('./board.js');
  openBoard({ list: openConnList });
}
function openConnList() {
  sub('connections', '连接 · 列表', (body, re) => {
    const list = state.connections[connKind];
    body.append(h('div', { style: { marginBottom: '16px' } }, segmented([['text', '文字'], ['image', '生图'], ['tts', '语音'], ['embed', '向量']], connKind, v => { connKind = v; re(); })));
    if (!list.length) { body.appendChild(empty(`还没有${KIND_LABEL[connKind]}连接`, btn('新建连接', 'primary', () => editConn(null)))); return; }
    const def = state.connections.defaults[connKind];
    body.appendChild(group(connKind === 'text' ? '「酒馆当前连接」= 你在酒馆里正在用的 API' : '', list.map(c => {
      const el = item({ icon: h('span', (CHANNELS[connKind].find(x => x.v === c.type) || { label: '酒' }).label.slice(0, 1)), color: c.type === 'tavern' ? 'orange' : 'blue', cls: 'as-settings-conn-card',
        title: c.name, sub: c.type === 'tavern' ? '跟着酒馆走，不用填密钥' : `${(CHANNELS[connKind].find(x => x.v === c.type) || {}).label || c.type} · ${c.model || '未选模型'}`,
        right: c.id === def ? h('span.as-check', { title: '默认' }, icon('check', 20, 2.4)) : null, chevron: true, onClick: () => editConn(c) });
      return el;
    }), '打勾的是全局默认。各个 App、各个聊天还能单独指定。'));
    body.appendChild(btn('新建连接', 'secondary', () => editConn(null), { style: { width: '100%' } }));
  }, { right: navBtn('plus', '新建连接', () => editConn(null)) });
}
function editConn(existing) {
  const kind = connKind;
  if (existing && existing.type === 'tavern') {
    sub('connection-edit', existing.name, body => {
      body.append(group('', [item({ title: '渠道', value: '酒馆当前连接' }), item({ title: '说明', sub: '用酒馆此刻选中的 API 和模型生成；切换酒馆的连接，这里就跟着变。不能删除。' })]),
        group('', [item({ title: state.connections.defaults.text === 'tavern' ? '已是默认连接' : '设为默认', onClick: () => { state.connections.defaults.text = 'tavern'; commit('connections'); nav.pop(); toast('已设为默认'); } })]),
        testBlock(existing));
    });
    return;
  }
  const c = existing ? { ...existing } : { id: uid('conn'), name: '', type: CHANNELS[kind][0].v, base: CHANNELS[kind][0].base, key: '', model: '' };
  const p = page({ app: 'settings', id: 'settings-connection-edit', title: existing ? existing.name : '新建连接', back: true, right: navText('保存', () => {
    if (!c.name.trim()) c.name = (CHANNELS[kind].find(x => x.v === c.type) || {}).label + ' ' + (c.model || '');
    c.name = c.name.trim();
    const list = state.connections[kind];
    if (existing) Object.assign(existing, c); else list.push(c);
    if (!state.connections.defaults[kind]) state.connections.defaults[kind] = c.id;
    commit('connections'); toast('已保存'); nav.pop();
  }, true) });
  const keyIn = input({ value: c.key, placeholder: 'sk-…', type: 'password', onInput: v => { c.key = v; } });
  const modelIn = input({ value: c.model, placeholder: '例如 gpt-4o-mini', onInput: v => { c.model = v; } });
  const baseIn = input({ value: c.base, placeholder: 'https://…', onInput: v => { c.base = v; } });
  const chItem = item({ title: '渠道类型', value: (CHANNELS[kind].find(x => x.v === c.type) || {}).label, chevron: true, onClick: async () => {
    const v = await actionSheet('渠道类型', CHANNELS[kind].map(x => ({ value: x.v, label: x.label, active: x.v === c.type })));
    if (!v) return;
    const ch = CHANNELS[kind].find(x => x.v === v); c.type = v;
    if (!c.base || CHANNELS[kind].some(x => x.base === c.base)) { c.base = ch.base; baseIn.value = ch.base; }
    chItem.querySelector('.as-list-item__value').textContent = ch.label;
  } });
  const pull = h('button.as-inline-btn', { onclick: async () => {
    pull.replaceChildren(h('i.as-spin'));
    try {
      const models = await listModels(c);
      if (!models.length) { toast('没有拉到模型'); return; }
      const s = sheet({ title: `选择模型（${models.length}）`, content: h('div.as-settings-models', models.map(m => h('button.as-actions__item' + (m === c.model ? '.is-active' : ''), { onclick: () => { c.model = m; modelIn.value = m; s.close(); } }, h('span', m)))) });
    } catch (e) { toast('拉取失败：' + e.message); } finally { pull.textContent = '拉取列表'; }
  } }, '拉取列表');
  p.body.append(
    group('', [field('名称', input({ value: c.name, placeholder: '随便起，方便自己认', onInput: v => { c.name = v; } })), chItem]),
    group('', [field('地址', baseIn), field('密钥', h('div.as-row', keyIn, h('button.as-eye', { 'aria-label': '显示密钥', onclick: () => { keyIn.type = keyIn.type === 'password' ? 'text' : 'password'; } }, icon('info', 18, 1.8)))),
      field('模型', h('div.as-row', modelIn, pull))], '密钥只保存在本机，导出数据时默认不包含密钥。'),
    kind === 'text' ? testBlock(c) : group('', [item({ title: '测试', sub: '生图和语音的测试下一轮做' })]),
    existing ? group('', [
      item({ title: state.connections.defaults[kind] === existing.id ? '已是默认连接' : '设为默认', onClick: () => { state.connections.defaults[kind] = existing.id; commit('connections'); toast('已设为默认'); nav.pop(); } }),
      item({ title: '复制此连接', onClick: () => { state.connections[kind].push({ ...existing, ...c, id: uid('conn'), name: (c.name || existing.name) + ' 副本' }); commit('connections'); toast('已复制'); nav.pop(); } }),
      item({ title: '删除连接', danger: true, onClick: async () => {
        if (!(await dialog({ title: `删除「${existing.name}」？`, confirm: '删除', danger: true }))) return;
        const list = state.connections[kind]; list.splice(list.indexOf(existing), 1);
        if (state.connections.defaults[kind] === existing.id) state.connections.defaults[kind] = list[0] ? list[0].id : '';
        commit('connections'); nav.pop();
      } }),
    ]) : null);
  nav.push(p.el);
}
function testBlock(c) {
  const res = h('div.as-settings-test', h('span.as-muted', '发一句很短的话试试'));
  const b = btn('测试连接', 'primary', async () => {
    b.disabled = true; b.classList.add('is-loading'); b.replaceChildren(h('i.as-spin'), ' 测试中');
    res.className = 'as-settings-test'; res.replaceChildren(h('span.as-muted', '等待回复…'));
    try { const out = await testConn(c); res.className = 'as-settings-test is-success'; res.replaceChildren(icon('check', 18, 2.4), `连接正常：「${out.slice(0, 20)}」`); }
    catch (e) { res.className = 'as-settings-test is-error'; res.replaceChildren(icon('close', 18, 2.4), h('span', { style: { flex: 1 } }, '连接失败：' + e.message), btn('查看日志', 'text', () => shell.openApp('log'))); }
    finally { b.disabled = false; b.classList.remove('is-loading'); b.textContent = '测试连接'; }
  }, { style: { width: '100%' } });
  return group('', [h('div', { style: { padding: '12px 14px 0' } }, b), res]);
}

/* ================= 应用管理 ================= */
function openApps() {
  sub('apps', '应用管理', body => {
    const used = S().autoUsed.date === new Date().toDateString() ? S().autoUsed.count : 0;
    const follow = k => { const v = state.apps.chat.conn[k]; return v === 'follow' ? '跟随全局' : (state.connections[k].find(x => x.id === v) || {}).name || '跟随全局'; };
    body.append(
      group('自动行为', [sliderRow('每日自动请求上限', { min: 0, max: 100, step: 1, value: S().autoLimit, onInput: v => { S().autoLimit = v; commit('settings'); } }),
        item({ title: '今天已用', value: `${used} 次` })], '主动消息、离开期间补发、正文触发的消息共用这一个总闸，用完今天就不会再自动发了。'),
      group('应用', [
        item({ icon: 'chat', color: 'orange', title: '聊天', sub: '文字：' + follow('text'), chevron: true, onClick: openChatApp }),
        item({ icon: 'box', color: 'purple', title: '资源库', sub: '主题、皮肤', chevron: true, onClick: () => shell.openApp('library') }),
        item({ icon: 'list', color: 'teal', title: '日志', sub: '报错标红、警告标黄', chevron: true, onClick: () => shell.openApp('log') }),
      ]));
  });
}
function openChatApp() {
  const a = state.apps.chat;
  sub('app-detail', '聊天', (body, re) => {
    const connRow = k => {
      const v = a.conn[k], own = v !== 'follow' && state.connections[k].find(x => x.id === v);
      return item({ title: KIND_LABEL[k], value: own ? own.name : '跟随全局 →', chevron: true, onClick: async () => {
        const opts = [{ value: 'follow', label: '跟随全局', active: !own }, ...state.connections[k].map(x => ({ value: x.id, label: x.name, active: own && own.id === x.id })), { value: '__go', label: '去管理连接…', icon: 'link' }];
        const r = await actionSheet(`聊天用的${KIND_LABEL[k]}连接`, opts);
        if (r === '__go') { connKind = k; openConnections(); return; }
        if (r) { a.conn[k] = r; commit('apps'); re(); }
      } });
    };
    body.append(
      group('使用的连接', ['text', 'image', 'tts'].map(connRow)),
      group('功能提示词', promptsIn('chat').map(pr => promptRow(pr, re)), '群聊、AI 智能加载联系人、世界书拆人的提示词随功能一起上线。'),
      group('聊天默认设置（每个聊天还能单独改）', [
        field('新聊天默认联动方式', segmented([['follow', '跟随正文'], ['online', '仅线上聊天']], a.defaults.linkMode, v => { a.defaults.linkMode = v; commit('apps'); })),
        toggleItem({ title: '先加好友才能聊', sub: '下一轮配合「新的朋友」一起生效' }, a.defaults.friendFirst, v => { a.defaults.friendFirst = v; commit('apps'); }),
        toggleItem({ title: '角色配图真的生图', sub: '关着时显示图片描述卡' }, a.defaults.imageGen, v => { a.defaults.imageGen = v; commit('apps'); }),
        toggleItem({ title: '新聊天默认允许 TA 主动发消息', sub: '每个聊天还能在「聊天设置 → 行为」里单独开关' }, !!a.defaults.proactive, v => { a.defaults.proactive = v; commit('apps'); re(); }),
        a.defaults.proactive ? field('默认频率', segmented([['low', '少'], ['normal', '正常'], ['high', '多']], a.defaults.proactiveFreq || 'normal', v => { a.defaults.proactiveFreq = v; commit('apps'); })) : null,
      ]),
      group('注入正文', [
        item({ title: '注入默认表', sub: '哪些消息会写进正文', chevron: true, onClick: openInjectTable }),
        field('注入位置', segmented([['chat', '聊天记录里'], ['prompt', '人设卡和世界书附近']], a.injectPos, v => { a.injectPos = v; commit('inject'); re(); })),
        a.injectPos === 'chat' ? sliderRow('离最新消息几层', { min: 0, max: 10, step: 1, value: a.injectDepth, onInput: v => { a.injectDepth = v; commit('inject'); } }) : null,
        sliderRow('新聊天默认注入条数', { min: 0, max: 40, step: 1, value: a.injectCount, onInput: v => { a.injectCount = v; commit('apps'); } }),
      ].filter(Boolean)),
      group('', [item({ title: '清空聊天的全部数据', danger: true, onClick: async () => {
        if (!(await dialog({ title: '清空聊天的全部数据？', text: '联系人、聊天记录、动态、收藏都会删掉。\n此操作无法撤销。', typed: '确认', confirm: '清空', danger: true }))) return;
        for (const c of state.chats) await clearMsgs(c.id);
        state.chats.splice(0); state.contacts.splice(0); state.moments.splice(0); state.favorites.splice(0);
        commit('all'); toast('聊天数据已清空'); re();
      } })]));
  });
}
function openInjectTable() {
  sub('inject-table', '注入默认表', body => {
    const t = state.apps.chat.injectTable;
    body.appendChild(group('打开的类型会写进正文（整理成「【手机】谁给谁发了什么」）', CHAT_MSG_TYPES.map(([k, label]) =>
      toggleItem({ title: label }, t[k] !== false, v => { t[k] = v; commit('inject'); }))), '转账、名片、通话等类型下一轮上线，开关先放在这里。');
  });
}
function promptRow(pr, re) {
  return item({ title: pr.name, sub: pr.changed ? '已修改' : null, right: h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
    (() => { const s = h('button.as-switch' + (pr.on ? '.is-active' : ''), { role: 'switch', 'aria-checked': String(pr.on), 'aria-label': pr.name }); s.addEventListener('click', e => { e.stopPropagation(); setPrompt(pr.key, { on: !getPrompt(pr.key).on }); s.classList.toggle('is-active'); }); return s; })(),
    h('span.as-list-item__chevron', icon('chevron', 16, 2))), onClick: () => editPrompt(pr.key, re) });
}
const VARS = { global: ['char', 'user'], tag: ['tag', 'user'], chat: ['char', 'user', 'persona', 'user_persona', 'story', 'time', 'history', 'min', 'max'] };
function editPrompt(key, after) {
  const pr = getPrompt(key);
  let text = pr.text, on = pr.on;
  const ta = textarea({ value: text, rows: 12, onInput: v => { text = v; } });
  ta.classList.add('as-settings-prompt-text');
  const vars = key === 'comment' ? ['post', 'people', 'time', 'user'] : key === 'catchup' ? ['char', 'user', 'gap'] : VARS[pr.group] || VARS.chat;
  const insert = v => { const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s; ta.setRangeText(`{{${v}}}`, s, e, 'end'); text = ta.value; ta.focus(); ta.dispatchEvent(new Event('input')); };
  const p = page({ app: 'settings', id: 'settings-prompt-edit', title: pr.name, back: true, right: navText('保存', () => { setPrompt(key, { text, on }); toast('已保存'); nav.pop(); after && after(); }, true) });
  p.body.append(
    group('', [toggleItem({ title: '启用' }, on, v => { on = v; })]),
    group('', [h('div.as-field', ta, h('span.as-field__label', '可用变量（点一下插入）'), h('div.as-chips', vars.map(v => h('button.as-chip', { onclick: () => insert(v) }, `{{${v}}}`))))]),
    h('div', { style: { textAlign: 'center' } }, btn('恢复默认', 'text', async () => {
      if (!(await dialog({ title: '恢复成默认提示词？', confirm: '恢复' }))) return;
      resetPrompt(key); ta.value = getPrompt(key).text; text = ta.value; ta.dispatchEvent(new Event('input')); toast('已恢复默认');
    })));
  nav.push(p.el);
}

/* ================= 通用提示词 ================= */
function openPrompts() {
  sub('prompts', '通用提示词', (body, re) => {
    body.append(
      group('全局（每次请求都会带上）', promptsIn('global').map(pr => promptRow(pr, re))),
      group('暗号', [
        promptRow(getPrompt('timeTag'), re),
        field('时间标签名称', input({ value: state.timeTagName, placeholder: 'astertime', onInput: v => { state.timeTagName = v.replace(/[^\w-]/g, '') || 'astertime'; commit('prompts'); } }),
          '正文里写成 <astertime>第3天 21:20</astertime>。如果角色卡已经有自己的时间标签，可以改成那个名字。'),
        promptRow(getPrompt('msgTag'), re),
      ], '时间标签：让 AI 在正文里输出剧情时间，手机读到就更新。如果你的预设已经在输出时间，可以关掉。\n正文消息标签：正文里 TA 给你发了手机消息，就会同步进手机，并带「来自剧情」标记。'));
  });
}

/* ================= 外观 ================= */
let clockBox = null;
const bgOf = (el, id, night) => { walls.thumb(id, night).then(u => { if (u) el.style.backgroundImage = `url("${u}")`; }); return el; };
function clockPreview(night) {
  clockBox = bgOf(h('div.as-settings-clockpv'), walls.current('lock'), night);
  paintClock(); return clockBox;
}
function paintClock() {
  if (!clockBox) return;
  const n = time.now();
  clockBox.dataset.font = (S().clock || {}).font || 'sf';
  clockBox.replaceChildren(h('span', n.date), h('b', n.hm));
  const night = shell.phone.dataset.mode === 'night', c = S().clockColor;
  const col = c === 'light' ? '#f6f3ee' : c === 'dark' ? '#1b2540' : c === 'accent' ? getComputedStyle(shell.phone).getPropertyValue('--as-color-accent') : (night ? '#f6f3ee' : '#1b2540');
  clockBox.style.color = col;
}
function openLook() {
  sub('appearance', '外观', (body, re) => {
    const prev = h('div.as-settings-preview', '今晚的月亮很圆。你那边能看到吗？');
    const night = shell.phone.dataset.mode === 'night';
    body.append(
      group('主题', [item({ title: '主题和皮肤', sub: '换一整套颜色，或者用自己写的 CSS 皮肤', value: (THEMES[lib().theme] || THEMES.aero).name, chevron: true, onClick: () => shell.openApp('library') })]),
      group('模式', [h('div.as-field', segmented([['day', '日间'], ['night', '夜间'], ['auto', '跟随系统']], S().mode, (v, b) => { S().mode = v; commit('look'); shell.setNight(shell.wantNight(), b); }))],
        '切换时整个手机会从你点的地方扩散着变色。'),
      group('时间', [clockPreview(night),
        segField('锁屏字体', segmented([['sf', '苹果粗体'], ['thin', '纤细'], ['serif', '优雅衬线']], S().clock.font, v => { S().clock.font = v; commit('look'); shell.applyLook(); paintClock(); re(); })),
        item({ title: '字体文件', sub: '默认内置苹果粗体（SF Pro Display Bold）；想换别的字体可以导入 .otf / .ttf', value: clockFontName() || '内置苹果粗体', chevron: true, onClick: async () => {
          const v = await actionSheet('锁屏字体文件', [{ label: clockFontName() ? '换一个字体文件' : '导入字体文件', value: 'add' }, ...(clockFontName() ? [{ label: '删掉，换回内置苹果粗体', value: 'del', danger: true }] : [])]);
          if (v === 'add') { const f = await pickFile('.otf,.ttf,.woff,.woff2,font/*'); if (!f) return; try { const n = await importClockFont(f); S().clock.font = 'sf'; commit('look'); shell.applyLook(); toast('已换成「' + n + '」'); re(); } catch (e) { toast(e.message); } }
          if (v === 'del') { await removeClockFont(); shell.applyLook(); toast('已删掉'); re(); }
        } }),
        segField('颜色（只改锁屏上那个大时间）', segmented([['auto', '自动'], ['light', '浅色'], ['dark', '深色'], ['accent', '强调色']], S().clockColor, v => { S().clockColor = v; commit('look'); shell.applyLook(); paintClock(); })),
        segField('语言', segmented([['zh', '中文'], ['en', 'English']], S().clock.lang, v => { S().clock.lang = v; commit('look'); shell.applyLook(); paintClock(); })),
        segField('小时制', segmented([['24', '24 小时'], ['12', '12 小时']], S().clock.h12 ? '12' : '24', v => { S().clock.h12 = v === '12'; commit('look'); shell.applyLook(); paintClock(); })),
      ], '日期只显示年月日（比如 2026年10月31日）。用剧情时间时，正文里写了日期就显示剧情日期，没写就显示今天的日期。锁屏、桌面和状态栏一起改。\n自己导入的字体只存在这台设备上，换手机要再导入一次。'),
      group('字号', [prev, sliderRow('大小', { min: .85, max: 1.3, step: .05, value: S().fontScale, fmt: v => Math.round(v * 100) + '%', onInput: v => { S().fontScale = v; commit('look'); shell.phone.style.setProperty('--as-font-scale', v); } })]),
      group('', [item({ icon: 'image', color: 'teal', title: '壁纸', sub: '锁屏和桌面分开选，可以用自己的图片和 Live 图，也可以随机', value: wallLabel(), chevron: true, onClick: () => openWalls() })]),
      group('', [item({ title: '状态栏', value: S().statusbar.global ? '显示' : '隐藏', chevron: true, onClick: openStatusbar }), item({ title: '字体', value: '系统默认', sub: '换字体放在资源库（下一轮）' })]));
  });
}
const segField = (label, seg) => h('div.as-field', h('span.as-field__label', label), seg);

/* ---------- 壁纸 ---------- */
function wallLabel() {
  const w = S().walls, name = k => w[k + 'Random'] ? '随机' : ((walls.info(w[k]) || {}).name || '月夜城堡');
  return w.lock === w.home && !w.lockRandom && !w.homeRandom ? name('lock') : `${name('lock')} / ${name('home')}`;
}
/** 选文件（可以一次选多个：一张图 + 一个视频 = 一张 Live 图） */
function pickMany(accept) {
  return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = true; i.onchange = () => res([...i.files]); i.click(); });
}
function openWalls() {
  sub('walls', '壁纸', (body, re) => {
    const w = S().walls, night = shell.phone.dataset.mode === 'night';
    const apply = () => { commit('walls'); shell.applyLook(); };
    // 最上面：锁屏 / 桌面两个小手机预览
    const pv = which => {
      const n = time.now();
      const card = bgOf(h('div.as-walls-pv__screen' + (which === 'home' ? '.is-home' : '')), walls.current(which), night);
      if (which === 'lock') card.append(h('div.as-walls-pv__clock', { dataset: { font: S().clock.font } }, h('span', n.date), h('b', n.hm)));
      else card.append(h('div.as-walls-pv__apps', [0, 1, 2, 3].map(() => h('i'))));
      if (w[which + 'Random']) card.append(h('span.as-walls-pv__tag', icon('sparkle', 12, 2), '随机'));
      return h('div.as-walls-pv__item', card, which === 'lock' ? '锁屏' : '桌面');
    };
    const tile = (which, id) => {
      const x = walls.info(id), on = !w[which + 'Random'] && w[which] === id;
      const t = bgOf(h('button.as-walls-tile' + (on ? '.is-active' : ''), { 'aria-label': x.name, 'aria-pressed': on ? 'true' : 'false', onclick: () => { w[which] = id; w[which + 'Random'] = false; apply(); re(); } },
        x.type === 'live' ? h('span.as-walls-tile__live', 'LIVE') : null, h('span.as-walls-tile__name', x.name)), id, night);
      return t;
    };
    const row = which => h('div.as-walls-row', walls.allIds().map(id => tile(which, id)));
    const add = async () => {
      const files = await pickMany('image/*,video/*,.mov,.heic');
      if (!files.length) return;
      try {
        const ids = await walls.addFiles(files);
        if (!ids.length) { toast('没认出能用的图片或视频'); return; }
        toast(ids.length > 1 ? `加好了 ${ids.length} 张` : (walls.info(ids[0]).type === 'live' ? '加好了一张 Live 图' : '加好了'));
        re();
      } catch (e) { toast(e.message || '添加失败'); }
    };
    const mine = w.list.map(x => item({
      icon: bgOf(h('span.as-walls-mine__thumb'), x.id, night), color: 'transparent', title: x.name, sub: x.type === 'live' ? 'Live 图 · 按住壁纸播放' : '图片',
      onClick: async () => {
        const v = await actionSheet(x.name, [{ label: '设为锁屏', value: 'lock' }, { label: '设为桌面', value: 'home' }, { label: '两个都用', value: 'both' }, { label: '改名', value: 'rename' }, { label: '删除', value: 'del', danger: true }]);
        if (v === 'lock' || v === 'both') { w.lock = x.id; w.lockRandom = false; }
        if (v === 'home' || v === 'both') { w.home = x.id; w.homeRandom = false; }
        if (v === 'rename') { const name = await dialog({ title: '改名', input: { value: x.name } }); if (name) walls.rename(x.id, name); }
        if (v === 'del') { if (!(await dialog({ title: '删除这张壁纸？', text: '删了就找不回来了。', confirm: '删除', danger: true }))) return; await walls.remove(x.id); }
        if (v) { apply(); re(); }
      } }));
    body.append(
      h('div.as-walls-pv', pv('lock'), pv('home')),
      group('锁屏', [row('lock'), toggleItem({ title: '随机锁屏', sub: '每次锁屏换一张' }, w.lockRandom, v => { w.lockRandom = v; if (v) walls.reroll('lock'); apply(); re(); })]),
      group('桌面', [row('home'), toggleItem({ title: '随机桌面', sub: '每次打开手机换一张' }, w.homeRandom, v => { w.homeRandom = v; if (v) walls.reroll('home'); apply(); re(); })], '桌面上是虚化的样子，图标更清楚。'),
      group('我的壁纸', [item({ icon: 'plus', color: 'blue', title: '添加图片或 Live 图', sub: '可以一次选好几张', onClick: add }), ...mine],
        'Live 图：选一个视频（mp4 / mov）就行；也可以同时选「一张图 + 一个视频」，图当封面。苹果相册里的实况照片，先在相册里点「存储为视频」再选。\n图片和视频只存在这台设备的浏览器里，导出备份时不会带上。'),
      group('Live 图怎么动', [
        h('div.as-field', segmented([['press', '按住播放'], ['loop', '一直循环']], w.live, v => { w.live = v; apply(); re(); })),
        w.live === 'press' ? toggleItem({ title: '亮屏时播放一次', sub: '打开手机看到锁屏时，自己动一下' }, w.liveWake, v => { w.liveWake = v; commit('walls'); }) : null,
      ].filter(Boolean), w.live === 'press' ? '在锁屏或桌面空白处按住不动，Live 图就会播放，松手停下。' : '一直循环会更费电。'),
    );
  });
}
function openStatusbar() {
  sub('statusbar', '状态栏', (body, re) => {
    const sb = S().statusbar;
    const apps = [['lock', '锁屏'], ['home', '桌面'], ['settings', '设置'], ['chat', '聊天'], ['library', '资源库'], ['log', '日志']];
    body.append(group('', [toggleItem({ title: '显示状态栏' }, sb.global, v => { sb.global = v; commit('look'); shell.applyLook(); re(); })], '状态栏右边的 ⓧ 是关闭手机的按钮。隐藏状态栏后，可以在桌面再返回一次关闭，或开启「连点三下」。'),
      group('按应用', apps.map(([k, label]) => h('div.as-field', h('span.as-field__label', label),
        segmented([['follow', '跟随全局'], ['show', '显示'], ['hide', '隐藏']], sb.apps[k] == null ? 'follow' : sb.apps[k] ? 'show' : 'hide', v => {
          if (v === 'follow') delete sb.apps[k]; else sb.apps[k] = v === 'show'; commit('look'); shell.applyLook();
        })))));
  });
}

/* ================= 锁屏与密码 ================= */
function openLock() {
  sub('lock', '锁屏与密码', (body, re) => {
    const L = S().lock;
    const choose = async m => {
      if (m === 'pattern' && !/^\d{4,9}$/.test(L.pattern || '')) { if (!(await setPattern())) return; }
      if (m === 'pin' && !/^\d{4,6}$/.test(L.pin || '')) { if (!(await setPin(L.digits || 6))) return; }
      L.method = m; commit('lock'); shell.applyLook(); re();
    };
    body.append(group('', [toggleItem({ title: '锁屏', sub: '关着时打开手机直接进桌面；开了也可以不设密码' }, L.enabled, v => { L.enabled = v; commit('lock'); shell.applyLook(); re(); })]));
    if (!L.enabled) return;
    body.append(group('解锁方式', ['none', 'finger', 'pin', 'pattern'].map(m => item({ title: LOCK_LABEL[m], sub: m === 'none' ? '不要密码，往上一滑就开' : m === 'finger' ? '按住就能开（假指纹）' : m === 'pattern' ? '画一个图案；备用图案是 Z 字形' : null,
      right: L.method === m ? h('span.as-tag-accent', icon('check', 20, 2.4)) : null, onClick: () => choose(m) }))));
    if (L.method === 'pin') body.append(group('数字密码', [
      field('位数', segmented([['4', '4 位'], ['6', '6 位']], String((L.pin || '').length || L.digits), async v => { if (await setPin(+v)) re(); else re(); })),
      item({ title: '修改密码', chevron: true, onClick: async () => { if (await setPin((L.pin || '').length || 6)) re(); } }),
    ]));
    if (L.method === 'pattern') body.append(group('手势密码', [item({ title: '修改图案', chevron: true, onClick: async () => { if (await setPattern()) re(); } })]));
    if (L.method === 'pattern') body.append(h('p.as-muted', { style: { margin: '0 14px' } }, '忘记图案时，在解锁界面点「忘记密码？」画 Z 字形（左上 → 右上 → 中心 → 左下 → 右下）。酒馆扩展面板里还有「重置锁屏」兜底。'));
    if (L.method === 'pin') body.append(h('p.as-muted', { style: { margin: '0 14px' } }, '忘记密码时，可以在解锁界面点「忘记密码？」用备用密码：4 位是 0000，6 位是 000000。酒馆扩展面板里还有「重置锁屏」兜底。'));
  });
}
/** 设置手势密码：画两次一样的 */
function setPattern() {
  return new Promise(async res => {
    const { patternPad, BACKUP_Z } = await import('../lock/pattern.js');
    let first = null, done = false;
    const tip = h('div.as-muted', { style: { textAlign: 'center', margin: '0 0 6px' } }, '画一个图案，至少连 4 个点');
    const box = h('div', { style: { display: 'grid', justifyItems: 'center', color: 'var(--as-color-text)', '--accent': 'var(--as-color-accent)' } });
    const pad = patternPad({ onDone: seq => {
      if (seq.length < 4) { tip.textContent = '至少连 4 个点，再画一次'; return false; }
      if (seq === BACKUP_Z) { tip.textContent = 'Z 字形是备用图案，换一个吧'; return false; }
      if (!first) { first = seq; tip.textContent = '再画一次确认'; return true; }
      if (seq !== first) { first = null; tip.textContent = '两次不一样，从头再画'; return false; }
      Object.assign(S().lock, { pattern: seq, method: 'pattern' }); commit('lock'); shell.applyLook();
      done = true; setTimeout(() => s.close(), 300); toast('手势密码已设置'); return true;
    } });
    box.appendChild(pad.el);
    const s = sheet({ title: '设置手势密码', content: h('div', tip, box), onClose: () => res(done) });
  });
}
async function setPin(digits) {
  const a = await dialog({ title: `设置 ${digits} 位密码`, input: { placeholder: `输入 ${digits} 位数字` }, confirm: '下一步' });
  if (a == null) return false;
  if (!new RegExp(`^\\d{${digits}}$`).test(a)) { toast(`要正好 ${digits} 位数字`); return false; }
  if (a === '0'.repeat(digits)) { toast('这个是备用密码，换一个吧'); return false; }
  const b = await dialog({ title: '再输一次', input: { placeholder: '确认密码' }, confirm: '完成' });
  if (b !== a) { toast('两次不一样，没有保存'); return false; }
  Object.assign(S().lock, { pin: a, digits, method: 'pin' }); commit('lock'); shell.applyLook(); toast('密码已设置');
  return true;
}

/* ================= 通知 ================= */
function openNotify() {
  sub('notify', '通知', (body, re) => {
    const n = S().notify;
    const t = (v, k) => input({ value: v, type: 'time', onInput: x => { n[k] = x; commit('settings'); } });
    body.append(
      group('', [toggleItem({ title: '新消息横幅', sub: '手机开着、不在那个聊天里时，从顶部滑下来' }, n.banner, v => { n.banner = v; commit('settings'); })]),
      group('提示音', [toggleItem({ title: '提示音' }, n.sound, v => { n.sound = v; commit('settings'); re(); }),
        n.sound ? sliderRow('音量', { min: 0, max: 1, step: .05, value: n.volume, fmt: v => Math.round(v * 100) + '%', onInput: v => { n.volume = v; commit('settings'); } }) : null,
        n.sound ? item({ title: '选择音效', value: '叮', sub: '更多音效放在资源库（下一轮）' }) : null].filter(Boolean)),
      group('免打扰', [toggleItem({ title: '免打扰时段', sub: '按现实时间，期间不弹横幅、不响' }, n.dnd, v => { n.dnd = v; commit('settings'); re(); }),
        n.dnd ? h('div.as-settings-time', field('开始', t(n.dndFrom, 'dndFrom')), field('结束', t(n.dndTo, 'dndTo'))) : null].filter(Boolean)),
      group('', [toggleItem({ title: '桌面图标未读红点' }, n.badge, v => { n.badge = v; commit('chats'); })]));
  });
}

/* ================= 手机本体 ================= */
function openDevice() {
  sub('device', '手机本体', (body, re) => {
    const d = S().device, st = time.story();
    const day = input({ value: String(st.day), type: 'number' }), hm = input({ value: `${String(st.hh).padStart(2, '0')}:${String(st.mm).padStart(2, '0')}`, type: 'time' });
    const p2 = n => String(n).padStart(2, '0');
    const dateIn = input({ value: st.date ? `${st.date.getFullYear()}-${p2(st.date.getMonth() + 1)}-${p2(st.date.getDate())}` : '', type: 'date' });
    body.append(
      group('时间', [
        h('div.as-field', h('span.as-field__label', '时间来源'), segmented([['real', '现实时间'], ['story', '剧情时间']], S().timeSrc, v => { S().timeSrc = v; commit('time'); commit('settings'); re(); })),
        S().timeSrc === 'story' ? item({ title: '现在', value: `${st.date ? time.fmtDate(st.date) + ' · ' : ''}第 ${st.day} 天 ${hm.value}`, sub: S().storyTime.src === 'story' ? '刚从正文里读到' : '手动设定，跟着现实时间往前走' }) : null,
        S().timeSrc === 'story' ? h('div.as-field', h('span.as-field__label', '读不到剧情时间时：手动设定'), h('div.as-settings-time', { style: { padding: 0 } }, day, hm),
          h('div.as-settings-time', { style: { padding: '8px 0 0' } }, dateIn),
          h('span.as-field__hint', '日期可以不填；填了锁屏就显示剧情里的年月日，不填就显示今天的日期。'),
          btn('设定', 'secondary', () => { const [hh, mm] = hm.value.split(':').map(Number); time.setStory(+day.value || 1, hh || 0, mm || 0, 'manual', dateIn.value || null); toast('剧情时间已更新'); re(); })) : null,
      ].filter(Boolean), '剧情时间靠正文里的时间标签更新（设置 → 通用提示词 → 暗号）。'),
      group('悬浮按钮（酒馆页面上）', [
        h('div.as-settings-fab-grid', FABS.map(([k, name]) => h('button.as-settings-fab' + (d.fab === k ? '.is-active' : ''), { onclick: () => { d.fab = k; commit('settings'); shell.applyLook(); re(); } },
          h('img', { src: `assets/fab/${k}.png`, alt: '' }), name))),
        sliderRow('大小', { min: 36, max: 84, step: 2, value: d.fabSize, fmt: v => v + 'px', onInput: v => { d.fabSize = v; commit('settings'); shell.applyLook(); } }),
      ], '悬浮按钮可以直接拖动换位置。不想要它的话，到酒馆的「扩展」面板里关掉「显示悬浮按钮」，用魔法棒菜单打开手机。'),
      group('', [toggleItem({ title: '连点三下开关手机', sub: '在酒馆页面空白处连点三下打开，在手机空白处连点三下关闭' }, d.tripleTap, v => { d.tripleTap = v; commit('settings'); shell.applyLook(); })]),
      group('窗口大小（电脑上生效，手机上总是铺满）', [
        h('div.as-field', segmented([['auto', '自动'], ['manual', '手动']], d.winScale ? 'manual' : 'auto', v => { d.winScale = v === 'auto' ? 0 : 1; commit('settings'); shell.applyLook(); re(); })),
        d.winScale ? sliderRow('大小', { min: .7, max: 1.4, step: .05, value: d.winScale, fmt: v => Math.round(v * 100) + '%', onInput: v => { d.winScale = v; commit('settings'); shell.applyLook(); } }) : null,
      ].filter(Boolean)));
  });
}

/* ================= 数据 ================= */
function openData() {
  sub('data', '数据', async (body, re) => {
    const box = h('div.as-settings-usage', h('span.as-muted', '正在计算…'));
    body.append(group('存储占用', [box]),
      group('', [
        item({ title: '导出数据', chevron: true, onClick: exportSheet }),
        item({ title: '导入数据', chevron: true, onClick: async () => {
          const f = await pickFile('application/json,.json'); if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (!(await dialog({ title: '导入这个备份？', text: `导出时间：${data.exportedAt || '未知'}\n会覆盖现在手机里的数据（本机的密钥会保留）。`, confirm: '导入' }))) return;
            await importAll(data); shell.applyLook(); toast('导入完成'); re();
          } catch (e) { toast('导入失败：' + e.message); }
        } }),
      ]),
      group('', [item({ title: '清空全部数据', danger: true, onClick: async () => {
        if (!(await dialog({ title: '清空全部数据？', text: '此操作无法撤销。', typed: '确认', confirm: '清空', danger: true }))) return;
        await wipeAll(); shell.applyLook(); toast('已清空'); nav.closeAll();
      } })]));
    const u = await usage(), total = Object.values(u).reduce((a, b) => a + b, 0) || 1;
    const cols = { 聊天: '#f0a067', 动态: '#9b87d8', 设置: '#6d8fd8' };
    const fmt = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(1) + ' KB';
    box.replaceChildren(h('div.as-settings-usage__total', fmt(total)),
      h('div.as-settings-usage__bar', Object.entries(u).map(([k, v]) => h('i', { style: { width: (v / total * 100) + '%', background: cols[k] } }))),
      h('div.as-settings-usage__legend', Object.entries(u).map(([k, v]) => h('span', { style: { '--c': cols[k] } }, `${k} ${fmt(v)}`))));
    box.querySelectorAll('.as-settings-usage__legend span').forEach((s, i) => s.style.setProperty('--c', Object.values(cols)[i]));
  });
}
function exportSheet() {
  let withKeys = false;
  const s = sheet({ title: '导出数据', content: h('div.as-stack-gap',
    group('', [toggleItem({ title: '包含密钥', sub: '默认不包含。要发给别人时千万别打开' }, false, v => { withKeys = v; })]),
    btn('导出全部', 'primary', async () => {
      const data = await exportAll({ withKeys });
      const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: `AsterPhone-备份-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); a.remove(); s.close(); toast('已导出');
    }), h('p.as-muted', { style: { margin: 0 } }, '按应用分别导出：下一轮做')) });
}

/* ================= 关于 ================= */
function openAbout() {
  sub('about', '关于', body => {
    const st = h('span.as-muted', '');
    body.append(h('div.as-settings-about', h('div.as-settings-about__logo', '✦'), h('div.as-settings-about__name', 'AsterPhone'), h('div.as-settings-about__ver', `版本 ${VERSION}`)),
      group('', [
        item({ title: '检查更新', right: st, chevron: true, onClick: async () => {
          st.replaceChildren(h('i.as-spin'));
          try {
            const r = await fetch('https://raw.githubusercontent.com/xxuxin0705/AsterPhone/main/manifest.json', { cache: 'no-cache' });
            const v = (await r.json()).version;
            if (cmp(v, VERSION) > 0) { st.textContent = `发现新版本 v${v}`; dialog({ title: `发现新版本 v${v}`, text: '在酒馆的「扩展」→「管理扩展」里点 AsterPhone 的更新按钮，然后刷新页面。', cancel: null, confirm: '知道了' }); }
            else st.textContent = '已是最新版本';
          } catch (e) { st.textContent = '检查失败'; }
        } }),
        item({ title: '打开日志', chevron: true, onClick: () => shell.openApp('log') }),
        item({ title: '运行环境', value: inTavern() ? '酒馆内' : '单独预览' }),
        item({ title: '项目主页', value: 'GitHub', chevron: true, onClick: () => window.open('https://github.com/xxuxin0705/AsterPhone', '_blank') }),
      ]));
  });
}
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
