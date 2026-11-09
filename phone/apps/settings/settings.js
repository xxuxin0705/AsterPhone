// 设置 App。铁律：一样东西只有一个家；别处显示「跟随全局」时，点一下跳到它真正的家。
import { h, pickFile } from '../../core/util.js';
import { state, commit, CHAT_MSG_TYPES, exportAll, importAll, wipeAll, usage, clearMsgs, win, windowList, deleteWindow, kvGet } from '../../core/store.js';
import { page, group, item, toggleItem, switchEl, segmented, slider, input, textarea, field, btn, navBtn, actionSheet, dialog, toast, sheet, empty, icon, withInfo, rangeRow, colorWheel, busy } from '../../core/ui.js';
import * as nav from '../../core/nav.js';
import { CHANNELS, resolveConn, tagOf, auxKey } from '../../core/api.js';
import { PROMPT_CATS, catInfo, VAR_INFO, blocksIn, schemesOf, schemeOf, schemeName, useScheme, copyScheme, renameScheme, removeScheme, setOn, moveBlock, newBlock, saveBlock, removeBlock } from '../../core/promptstore.js';
import * as time from '../../core/time.js';
import { shell } from '../../core/shell.js';
import { inTavern, postToParent } from '../../core/bridge.js';
import * as walls from '../../core/walls.js';
import { importClockFont, removeClockFont, userFonts, hanFonts, fontKey, fontName } from '../../core/fonts.js';
import { THEMES, lib } from '../../core/skin.js';

export const VERSION = '0.8.248';
export const FABS = [['forest', '森林小芽'], ['candy', '糖果'], ['ocean', '海洋'], ['sunflower', '向日葵'], ['neon', '霓虹'], ['iphone', 'iPhone'],
  ['ancient', '古风'], ['xianxia', '仙侠'], ['magic', '魔法'], ['steampunk', '蒸汽朋克'], ['retro', '复古游戏机'], ['autumn', '秋日']];
const MODE_LABEL = { day: '日间', night: '夜间', auto: '跟随系统' };
const LOCK_LABEL = { none: '无（上滑解锁）', finger: '指纹', pin: '数字密码', pattern: '手势密码' };
const KIND_LABEL = { text: '文字', image: '生图', tts: '语音', embed: '其他' };
const S = () => state.settings;
const sliderRow = (label, { min, max, step, value, onInput, fmt = v => v }) => {
  const out = h('output', fmt(value));
  return h('div.as-settings-slider-row', h('span', label), slider({ min, max, step, value, onInput: v => { out.textContent = fmt(v); onInput(v); } }), out);
};
/** 子页面：draw() 每次回到这页都会重画 */
// 设置页上显示的东西都来自这几块；从下一层返回时，没变就不重画（重画会让整页闪一下）
const sig = () => JSON.stringify([state.settings, state.connections, state.apps, state.promptSchemes, state.timeTagName, state.library]);
function decodeImages(root) {
  const urls = [...root.querySelectorAll('img')].map(i => i.src)
    .concat([...root.querySelectorAll('[style*="background-image"]')].map(e => (/url\(["']?(.*?)["']?\)/.exec(e.style.backgroundImage) || [])[1]));
  return Promise.all([...new Set(urls.filter(Boolean))].map(u => { const i = new Image(); i.src = u; return i.decode().catch(() => {}); }));
}
function sub(id, title, draw, opts = {}) {
  const p = page({ app: 'settings', id: 'settings-' + id, title, back: true, ...opts });
  let drawn = '', first = true, tok = 0;
  // 先在旁边画好，再一次换上去，不会出现空白的一帧
  const re = () => {
    const y = p.body.scrollTop, box = document.createElement('div'), r = draw(box, re, p), my = ++tok;
    const swap = () => { if (my !== tok) return; p.body.replaceChildren(...box.childNodes); p.body.scrollTop = y; drawn = sig(); };
    // 新内容里的图片（壁纸缩略图、悬浮按钮图）先解码好再换上去，不然换的那一下图片是空的，整页像闪了一下
    const ready = () => Promise.race([decodeImages(box), new Promise(res => setTimeout(res, 400))]).then(swap);
    if (r && r.then) r.then(first ? swap : ready); else if (first) swap(); else ready();   // 第一次打开直接放上去（页面是滑进来的）
    first = false;
  };
  re(); p.el._onShow = () => { if (sig() !== drawn) re(); };
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
        item({ icon: 'link', color: 'blue', title: '连接', chevron: true, onClick: openConnections }),
        item({ icon: 'grid', color: 'purple', title: '应用管理', chevron: true, onClick: openApps }),
        item({ icon: 'note', color: 'teal', title: '提示词', chevron: true, onClick: openPrompts }),
      ]),
      group('', [
        item({ icon: 'palette', color: 'orange', title: '显示', value: MODE_LABEL[S().mode], chevron: true, onClick: openLook }),
        item({ icon: 'image', color: 'teal', title: '壁纸', value: wallLabel(), chevron: true, onClick: () => openWalls() }),
        item({ icon: 'lock', color: 'gray', title: '锁屏与密码', value: S().lock.enabled ? LOCK_LABEL[S().lock.method] : '关闭', chevron: true, onClick: openLock }),
        item({ icon: 'bell', color: 'red', title: '通知', chevron: true, onClick: openNotify }),
      ]),
      group('', [
        item({ icon: 'link', color: 'green', title: '联动方式与时间', value: (state.apps.chat.defaults.linkMode === 'online' ? '仅线上' : '跟随正文') + ' · ' + (S().timeSrc === 'story' ? '剧情时间' : '现实时间'), chevron: true, onClick: openLinkTime }),
        item({ icon: 'list', color: 'purple', title: '上下文与世界书', chevron: true, onClick: () => import('./context.js').then(m => m.openContext({ sub, sliderRow, withInfo })) }),
        item({ icon: 'db', color: 'gold', title: '数据', chevron: true, onClick: openData }),
        item({ icon: 'info', color: 'pink', title: '关于', value: 'v' + VERSION, chevron: true, onClick: openAbout }),
      ]));
  };
  let drawn = '';
  draw(); drawn = sig(); p.el._onShow = () => { if (sig() !== drawn) { draw(); drawn = sig(); } };
  return p.el;
}

/* ================= 连接 ================= */
let connKind = 'text';
/** 连接首页：插线板模式（拎线插接口）或列表模式，选过哪个以后进来就是哪个 */
async function openConnections() {
  if (S().connView === 'list') return openConnList();
  const { openBoard } = await import('./board.js');
  openBoard({ list: () => { S().connView = 'list'; commit('settings'); nav.pop(); openConnList(); } });
}
function openConnList() {
  // 点进去和插线板是同一个「接口详情」；列表没有线可插，所以多一个「设为默认」
  const hooks = () => ({ refresh: () => p.el._onShow(), setDefault: true });
  const add = () => import('./board.js').then(m => m.newConn(connKind, hooks()));
  // 音色库只在「语音」那一栏出现
  const mic = navBtn('mic', '音色库', async () => {
    const [v, m] = await Promise.all([import('./voices.js'), import('./board.js')]);
    v.openVoicePage({ onChange: () => p.el._onShow(), openConn: c => m.openDetail(c, 'tts', false, hooks()) });
  });
  const p = sub('connections', '连接 · 列表', (body, re) => {
    const list = state.connections[connKind];
    mic.hidden = connKind !== 'tts';
    body.append(h('div', { style: { marginBottom: '16px' } }, segmented([['text', '文字'], ['image', '生图'], ['tts', '语音'], ['embed', '其他']], connKind, v => { connKind = v; re(); })));
    if (!list.length) { body.appendChild(empty(`还没有${KIND_LABEL[connKind]}连接`, btn('新建连接', 'primary', () => add()))); return; }
    const isDef = c => state.connections.defaults[connKind === 'embed' ? auxKey(tagOf(c)) : connKind] === c.id;   // 「其他」每个标签各有一个默认
    body.appendChild(group(connKind === 'text' ? '「酒馆当前连接」= 你在酒馆里正在用的 API' : '', list.map(c => {
      const el = item({ icon: h('span', (CHANNELS[connKind].find(x => x.v === c.type) || { label: '酒' }).label.slice(0, 1)), color: c.type === 'tavern' ? 'orange' : 'blue', cls: 'as-settings-conn-card',
        title: c.name, sub: c.type === 'tavern' ? '跟着酒馆走，不用填密钥' : `${connKind === 'embed' ? tagOf(c) : (CHANNELS[connKind].find(x => x.v === c.type) || {}).label || c.type} · ${c.model || '未选模型'}`,
        right: isDef(c) ? h('span.as-check', { title: '默认' }, icon('check', 20, 2.4)) : null, chevron: true, onClick: () => import('./board.js').then(m => m.openDetail(c, connKind, false, hooks())) });
      return el;
    }), '打勾的是默认，App、聊天里还能单独换'));
    body.appendChild(btn('新建连接', 'secondary', () => add(), { style: { width: '100%' } }));
  }, { right: [mic, navBtn('more', '更多', async () => {
    const m = await import('./board.js');
    m.connMenu({ mode: 'list', kind: connKind, schemes: () => m.schemesSheet({ onApply: () => p.el._onShow() }), add,
      switchMode: () => { S().connView = ''; commit('settings'); nav.pop(); openConnections(); } });
  })] });
}

/* ================= 应用管理 ================= */
function openApps() {
  sub('apps', '应用管理', body => {
    const follow = k => { const v = state.apps.chat.conn[k]; return v === 'follow' ? '跟随全局' : (state.connections[k].find(x => x.id === v) || {}).name || '跟随全局'; };
    body.append(
      group('应用', [
        item({ icon: 'chat', color: 'orange', title: '聊天', sub: '文字：' + follow('text'), chevron: true, onClick: openChatApp }),
        item({ icon: 'sparkle', color: 'gold', title: '幕间', sub: '文字：' + (state.apps.interlude.conn.text === 'follow' ? '跟随全局' : (state.connections.text.find(x => x.id === state.apps.interlude.conn.text) || {}).name || '跟随全局'), chevron: true, onClick: openInterludeApp }),
        item({ icon: 'box', color: 'purple', title: '资源库', chevron: true, onClick: () => shell.openApp('library') }),
        item({ icon: 'list', color: 'teal', title: '日志', chevron: true, onClick: () => shell.openApp('log') }),
      ]));
  });
}
function openInterludeApp() {
  const a = state.apps.interlude;
  sub('app-interlude', '幕间', (body, re) => {
    const own = a.conn.text !== 'follow' && state.connections.text.find(x => x.id === a.conn.text);
    body.append(group('使用的连接', [item({ title: '文字', value: own ? own.name : '跟随全局 →', chevron: true, onClick: async () => {
      const r = await actionSheet('幕间用的文字连接', [{ value: 'follow', label: '跟随全局', active: !own }, ...state.connections.text.map(x => ({ value: x.id, label: x.name, active: own && own.id === x.id })), { value: '__go', label: '去管理连接…', icon: 'link' }]);
      if (r === '__go') { connKind = 'text'; openConnections(); return; }
      if (r) { a.conn.text = r; commit('apps'); re(); }
    } })]), group('', [
      toggleItem({ title: '打开时放开屏' }, a.splash, v => { a.splash = v; commit('apps'); re(); }),
      a.splash ? item({ title: '开屏字体', value: a.font && a.font !== 'random' ? { xdks: '玄冬楷书', qtbf: '千图笔锋手写体' }[a.font] || '每次随机' : '每次随机', chevron: true, onClick: async () => {
        const { SPLASH_FONTS } = await import('../interlude/interlude.js');
        const r = await actionSheet('开屏字体', [{ value: 'random', label: '每次随机', active: !a.font || a.font === 'random' }, ...SPLASH_FONTS.map(([k, n]) => ({ value: k, label: n, active: a.font === k }))]);
        if (r) { a.font = r; commit('apps'); re(); }
      } }) : null,
      a.splash ? item({ title: '开屏语', value: '轮着用', chevron: true, onClick: async () => {
        const { SPLASH_LINES } = await import('../interlude/interlude.js'), off = a.lineOff || (a.lineOff = []);
        sheet({ title: '开屏语（轮着用）', content: group('', SPLASH_LINES.map((t, i) => toggleItem({ title: t }, !off.includes(i), on => { on ? off.splice(off.indexOf(i), 1) : off.push(i); commit('apps'); }))) });
      } }) : null,
      field('语音（默认）', segmented([['tap', '点了才合成'], ['next', '提前合成下两句'], ['all', '全部合成']], { auto: 'next' }[a.voice] || a.voice || 'tap', v => { a.voice = v; commit('apps'); })),
      item({ title: '大成功 / 大失败', value: a.crit === 'book' ? '规则书' : a.crit === '3' ? '1～3 / 98～100' : '1～5 / 96～100', chevron: true, onClick: async () => {
        const { CRITS } = await import('../interlude/rules.js');
        const r = await actionSheet('大成功 / 大失败', CRITS.map(([v, l]) => ({ value: v, label: l, active: a.crit === v })));
        if (r) { a.crit = r; commit('apps'); re(); }
      } }),
    ].filter(Boolean)));
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
      group('聊天默认设置（每个聊天还能单独改）', [
        toggleItem({ title: withInfo('角色配图真的生图', '角色发图片、发动态配图时：打开就真的用生图接口画出来；关着只显示一张写着画面的描述卡，点「生图」才画（省钱）。') }, a.defaults.imageGen, v => { a.defaults.imageGen = v; commit('apps'); }),
        rangeRow('私聊回复条数', { min: 1, max: 10, value: a.defaults.lines, onInput: v => { a.defaults.lines = v; commit('apps'); } }),
        rangeRow('群聊回复条数', { min: 1, max: 20, value: a.defaults.gLines, onInput: v => { a.defaults.gLines = v; commit('apps'); } }),
        rangeRow('语音条数', { min: 0, max: 10, value: a.defaults.voice, onInput: v => { a.defaults.voice = v; commit('apps'); } }),
        toggleItem({ title: withInfo('收到语音就合成', '打开：语音一到就合成好存着，点开直接放；关着：点了才合成。合成过的都会存着，再听不用再合成。') }, a.defaults.autoVoice, v => { a.defaults.autoVoice = v; commit('apps'); }),
        toggleItem({ title: '允许拍一拍我' }, a.defaults.poke, v => { a.defaults.poke = v; commit('apps'); }),
      ].filter(Boolean)),
      group('注入正文', [
        item({ title: withInfo('注入默认表', '跟随正文的聊天里，打开的这几种消息会整理成「【手机】谁给谁发了什么」写进正文，让正文里的角色也知道。每个聊天还能单独改。'), chevron: true, onClick: openInjectTable }),
        field('注入位置', segmented([['chat', '聊天记录里'], ['prompt', '人设卡和世界书附近']], a.injectPos, v => { a.injectPos = v; commit('inject'); re(); })),
        a.injectPos === 'chat' ? sliderRow('离最新消息几层', { min: 0, max: 10, step: 1, value: a.injectDepth, onInput: v => { a.injectDepth = v; commit('inject'); } }) : null,
        sliderRow('新聊天默认注入条数', { min: 0, max: 40, step: 1, value: a.injectCount, onInput: v => { a.injectCount = v; commit('apps'); } }),
      ].filter(Boolean)),
      // 每个酒馆聊天窗口一份手机数据
      group('这个窗口的数据', [
        item({ title: '当前窗口', value: win.label }),
        item({ title: '所有窗口的数据', chevron: true, onClick: openWindows }),
      ]),
      group('', [item({ title: '清空这个窗口的聊天数据', danger: true, onClick: async () => {
        if (!(await dialog({ title: '清空这个窗口的聊天数据？', text: '这个窗口的联系人、聊天记录、动态、收藏都会删掉，别的窗口不受影响。\n此操作无法撤销。', typed: '确认', confirm: '清空', danger: true }))) return;
        for (const c of state.chats) await clearMsgs(c.id);
        state.chats.splice(0); state.contacts.splice(0); state.moments.splice(0); state.favorites.splice(0);
        commit('all'); toast('聊天数据已清空'); re();
      } })]));
  });
}
/** 别的窗口存着的手机数据：看看有多少，不要的删掉 */
function openWindows() {
  sub('windows', '所有窗口的数据', async body => {
    const list = await windowList();
    body.append(list.length ? group('', list.map(w => {
      const row = item({ title: w.label, sub: `${w.people} 个联系人 · ${w.chats} 个聊天`, right: h('span', { style: { display: 'flex', gap: '6px' } },
        btn('导出', 'secondary', async () => { const d = await kvGet('win:' + w.key); (await import('../chat/transfer.js')).exportChats(d.chats || [], d.contacts || []); }, { style: { padding: '6px 10px' } }),
        btn('删除', 'danger', async () => {
          if (!(await dialog({ title: `删除「${w.label}」的手机数据？`, text: '联系人、聊天记录、动态都会删掉，不能恢复。', confirm: '删除', danger: true }))) return;
          await deleteWindow(w.key); row.remove(); toast('删掉了');
        }, { style: { padding: '6px 10px' } })) });
      return row;
    })) : empty('别的窗口还没有手机数据'));
  });
}
function openInjectTable() {
  sub('inject-table', '注入默认表', body => {
    const t = state.apps.chat.injectTable;
    body.appendChild(group('', CHAT_MSG_TYPES.map(([k, label]) =>
      toggleItem({ title: label }, t[k] !== false, v => { t[k] = v; commit('inject'); }))));
  });
}
/* ================= 提示词 ================= */
// 外面只放应用，点进去是私聊、群聊…，再点进去是方案和一条条提示词。默认方案只能看，复制成自己的方案才能改。
function openPrompts() {
  sub('prompts', '提示词', body => {
    body.append(group('', PROMPT_CATS.map(a => item({ title: a.app, value: `${a.items.length} 项`, chevron: true, onClick: () => openPromptApp(a) }))));
  });
}
function openPromptApp(a) {
  sub('prompt-app', a.app, body => {
    body.append(group('', a.items.map(c => item({ title: c.name, value: schemeName(c.id), chevron: true, onClick: () => openCat(c.id) }))));
  });
}
const tagName = () => state.timeTagName || 'astertime';
function openCat(cat) {
  sub('prompt-cat', catInfo(cat).name, body => {
    const S = schemesOf(cat);
    // 每套方案那一块（按钮、条目、新建）只画一次，切换方案只是显示 / 藏起来，不重画（重画会闪）
    const views = new Map(), chipBox = h('div.as-chips'), box = h('div');
    const chipOf = x => h('button.as-chip', { dataset: { id: x.id }, onclick: () => show(x.id) }, x.name);
    const show = id => {
      if (S.cur !== id) useScheme(cat, id);
      chipBox.querySelectorAll('.as-chip').forEach(c => c.classList.toggle('is-active', c.dataset.id === id));
      if (!views.has(id)) { const v = view(id); views.set(id, v); box.append(v); }
      views.forEach((v, k) => { v.hidden = k !== id; });
    };
    const view = sid => {
      const acts = h('div.as-lib-actions', btn('复制方案', 'secondary', () => { const nid = copyScheme(cat, sid); chipBox.append(chipOf(schemeOf(cat, nid))); show(nid); }), ...(sid ? [
        btn('改名', 'secondary', async () => { const n = await dialog({ title: '改名', input: { value: schemeName(cat, sid) } }); if (n && n.trim()) { renameScheme(cat, sid, n.trim()); chipBox.querySelector(`[data-id="${sid}"]`).textContent = n.trim(); } }),
        btn('删除', 'secondary', async () => {
          if (!(await dialog({ title: `删除「${schemeName(cat, sid)}」？`, confirm: '删除', danger: true }))) return;
          removeScheme(cat, sid); chipBox.querySelector(`[data-id="${sid}"]`).remove(); views.get(sid).remove(); views.delete(sid); show('');
        }),
      ] : []));
      const rows = blocksIn(cat, sid).map(b => {
        if (!sid) return item({ title: b.name, chevron: true, onClick: () => openBlock(cat, '', b.id) });
        const row = item({ title: b.name, right: switchEl(b.on, v => setOn(cat, sid, b.id, v), b.name), chevron: true, onClick: () => openBlock(cat, sid, b.id) });
        row.dataset.id = b.id; bindDrag(row, sid);
        return row;
      });
      return h('div', acts, group('', rows), sid ? h('div.as-lib-actions', btn('新建提示词', 'secondary', () => openBlock(cat, sid, newBlock(cat, sid)))) : null);
    };
    // 长按一行，再上下拖动排顺序
    function bindDrag(row, sid) {
      let dragging = false;
      row.addEventListener('touchmove', e => { if (dragging) e.preventDefault(); }, { passive: false });   // 拖的时候别让页面跟着滚
      longPress(row, () => {
        dragging = true; row.classList.add('is-dragging');
        const move = ev => {
          const box = row.parentNode, sibs = [...box.children].filter(x => x !== row);
          const after = sibs.find(x => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
          if (after !== row.nextSibling) box.insertBefore(row, after || null);
        };
        // 挪动行会让手指「捕获」失效，所以在整个窗口上听
        const up = () => {
          dragging = false; removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); row.classList.remove('is-dragging');
          moveBlock(cat, sid, row.dataset.id, [...row.parentNode.children].indexOf(row));
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      });
    }
    if (cat === 'tag') {
      const sample = n => `正文里会写成 <${n}>2026年11月1日 · 东京 · 21:20</${n}>`, hint = h('span.as-field__hint', sample(tagName()));
      body.append(group('', [h('div.as-field', h('span.as-field__label', '时间标签名称'),
        input({ value: tagName(), placeholder: 'astertime', onInput: v => { state.timeTagName = v.replace(/[^\w-]/g, '') || 'astertime'; hint.textContent = sample(tagName()); commit('prompts'); } }), hint)]));
    }
    chipBox.append(...[{ id: '', name: '默认方案' }, ...S.list].map(chipOf));
    body.append(group('方案', [h('div.as-field', chipBox)]), box);
    show(S.cur);
  });
}
function openBlock(cat, sid, id) {
  const b = blocksIn(cat, sid).find(x => x.id === id);
  const shown = t => t.replace(/\{\{tag\}\}/g, tagName());
  // 从内置那几条复制来的（文风、消息语气…）名字不能改，只改内容；自己新建的才能起名字
  const fixed = !!sid && blocksIn(cat, '').some(x => x.name === b.name);
  // 标题旁边的小 i：这一类能用的变量各是什么
  const vars = catInfo(cat).vars, title = sid && !fixed ? '编辑提示词' : b.name;
  sub('prompt-block', vars.length ? withInfo(title, vars.map(v => `{{${v}}}　${VAR_INFO[v] || ''}`).join('\n')) : title, body => {
    if (!sid) { body.append(group('', [h('div.as-field', h('pre.as-prompt-view', shown(b.text)))])); return; }
    let name = b.name, text = b.text;
    const ta = textarea({ value: text, rows: 12, onInput: v => { text = v; } });
    ta.classList.add('as-settings-prompt-text');
    const insert = v => { const s0 = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s0; ta.setRangeText(`{{${v}}}`, s0, e, 'end'); text = ta.value; ta.focus(); };
    // 搭配：别的方案（含默认）里有同名的这一条，就能把内容换成那边的；点保存才算数
    const others = [{ id: '', name: '默认方案' }, ...schemesOf(cat).list.filter(x => x.id !== sid)]
      .map(x => ({ name: x.name, blk: blocksIn(cat, x.id).find(y => y.name === b.name) })).filter(o => o.blk);
    body.append(
      ...(fixed ? [] : [group('', [field('名字', input({ value: name, onInput: v => { name = v; } }))])]),
      h('div.as-lib-actions.is-two', ...(others.length ? [btn('换成其他方案的', 'secondary', async () => {
        const i = await actionSheet(`换成哪个方案里的「${b.name}」`, others.map((o, k) => ({ value: String(k), label: o.name })));
        if (i == null) return;
        ta.value = text = others[+i].blk.text; toast(`换成「${others[+i].name}」的了，保存后生效`);
      })] : []), btn('删除', 'secondary', async () => {
        if (!(await dialog({ title: `删掉「${name}」？`, confirm: '删除', danger: true }))) return;
        removeBlock(cat, sid, id); nav.pop();
      })),
      group('', [h('div.as-field', ta, h('div.as-chips', catInfo(cat).vars.map(v => h('button.as-chip', { onclick: () => insert(v) }, `{{${v}}}`))))]),
      h('div.as-prompt-bar', btn('取消', 'secondary', () => nav.pop()), btn('保存', 'primary', () => { saveBlock(cat, sid, id, { name: name.trim() || '我的提示词', text }); toast('已保存'); nav.pop(); })));
  });
}

/* ================= 外观 ================= */
let clockBox = null;
const thumbSeen = new Map();
const bgOf = (el, id, night) => {
  const k = id + (night ? ':n' : ':d') + ((walls.info(id) || {}).crop || ''), set = u => { if (u) { thumbSeen.set(k, u); el.style.backgroundImage = `url("${u}")`; } };
  if (thumbSeen.has(k)) set(thumbSeen.get(k)); else walls.thumb(id, night).then(set);
  return el;
};
/** 12 小时制把「AM / PM」「上午 / 下午」小字放在时间旁边 */
const withAp = n => !n.ap ? h('b', n.hm) : S().clock.lang === 'en' ? h('b', n.hm, h('small', n.ap)) : h('b', h('small', n.ap), n.hm);
function clockPreview(night) {
  clockBox = bgOf(h('div.as-settings-clockpv'), walls.current('lock'), night);
  paintClock(); return clockBox;
}
function paintClock() {
  if (!clockBox) return;
  const n = time.now();
  clockBox.dataset.font = fontKey((S().clock || {}).font);
  clockBox.replaceChildren(h('span', n.date), withAp(n));
  const night = shell.phone.dataset.mode === 'night', c = S().clockColor;
  const col = c === 'light' ? '#f6f3ee' : c === 'dark' ? '#1b2540' : c === 'custom' ? S().clockHex || '#8fb4ff' : c === 'accent' ? getComputedStyle(shell.phone).getPropertyValue('--as-color-accent') : (night ? '#f6f3ee' : '#1b2540');
  clockBox.style.color = col;
}
function openLook() {
  sub('appearance', '显示', (body, re) => {
    const d = S().device;
    // 选字体、选颜色：只换勾和预览，不重画整页（重画会闪）
    const wheel = colorWheel(S().clockHex || '#8fb4ff', hex => { S().clockHex = hex; shell.phone.style.setProperty('--clock-hex', hex); paintClock(); commit('look'); });
    wheel.hidden = S().clockColor !== 'custom';
    const mkSeg = () => segField('锁屏字体', segmented([['sf', '苹果粗体'], ['thin', '纤细'], ['serif', '优雅衬线']], S().clock.font, v => pickFont(v)));
    let fontSeg = mkSeg();
    const pickFont = f => {
      S().clock.font = f; commit('look'); shell.applyLook(); paintClock();
      mineVal.textContent = mineName();
      const nseg = mkSeg(); fontSeg.replaceWith(nseg); fontSeg = nseg;   // 选了导入的字体，上面三个都不亮
    };
    // 导入的字体收在一格里：下拉换用哪个、导入新的、删掉正在用的
    const mineName = () => (userFonts().find(x => 'u:' + x.id === S().clock.font) || {}).name || '没用';
    const mine = item({ title: '自己的字体', value: mineName(), chevron: true, onClick: async () => {
      const cur = userFonts().find(x => 'u:' + x.id === S().clock.font);
      const v = await actionSheet('锁屏用自己的字体', [...userFonts().map(x => ({ label: x.name, value: 'u:' + x.id, active: x === cur })), { label: '导入字体文件', value: '__add' },
        ...(cur ? [{ label: `删除「${cur.name}」`, value: '__del', danger: true }] : [])]);
      if (v == null) return;
      if (v === '__add') {
        const f = await pickFile('.otf,.ttf,.woff,.woff2,font/*'); if (!f) return;
        try { const x = await importClockFont(f); pickFont('u:' + x.id); toast('已导入「' + x.name + '」'); } catch (e) { toast(e.message); }
      } else if (v === '__del') {
        if (!(await dialog({ title: `删掉「${cur.name}」？`, confirm: '删除', danger: true }))) return;
        await removeClockFont(cur.id); pickFont('sf');
      } else pickFont(v);
    } });
    const mineVal = mine.querySelector('.as-list-item__value');
    const prev = h('div.as-settings-preview', '今晚的月亮很圆。你那边能看到吗？');
    const night = shell.phone.dataset.mode === 'night';
    body.append(
      group('悬浮按钮', [
        h('div.as-settings-fab-grid', FABS.map(([k, name]) => h('button.as-settings-fab' + (d.fab === k ? '.is-active' : ''), { onclick: e => { d.fab = k; commit('settings'); shell.applyLook(); e.currentTarget.parentNode.querySelectorAll('.as-settings-fab').forEach(b => b.classList.toggle('is-active', b === e.currentTarget)); } },
          h('img', { src: `assets/fab/${k}.webp`, alt: '' }), name))),
        sliderRow('大小', { min: 36, max: 84, step: 2, value: d.fabSize, fmt: v => v + 'px', onInput: v => { d.fabSize = v; commit('settings'); shell.applyLook(); } }),
      ]),
      group('', [toggleItem({ title: '连点三下开关手机' }, d.tripleTap, v => { d.tripleTap = v; commit('settings'); shell.applyLook(); })]),
      group('窗口大小（电脑上生效，手机上总是铺满）', [
        h('div.as-field', segmented([['auto', '自动'], ['manual', '手动']], d.winScale ? 'manual' : 'auto', v => { d.winScale = v === 'auto' ? 0 : 1; commit('settings'); shell.applyLook(); re(); })),
        d.winScale ? sliderRow('大小', { min: .7, max: 1.4, step: .05, value: d.winScale, fmt: v => Math.round(v * 100) + '%', onInput: v => { d.winScale = v; commit('settings'); shell.applyLook(); } }) : null,
      ].filter(Boolean)),
      group('', [item({ title: '顶部时间栏', value: S().statusbar.global ? '显示' : '隐藏', chevron: true, onClick: openStatusbar }),
        // 整个手机的字：从资源库的字体库里挑，也可以当场导入（导入的会放进资源库）
        item({ title: '字体', value: fontName(S().uiFont) || '系统默认', chevron: true, onClick: async e => {
          const valEl = e.currentTarget.querySelector('.as-list-item__value');
          const v = await actionSheet('整个手机用的字体', [{ label: '系统默认', value: '', active: !S().uiFont }, ...hanFonts().map(x => ({ label: x.name, value: 'u:' + x.id, active: S().uiFont === 'u:' + x.id })), { label: '导入字体文件', value: '__add' }]);
          if (v == null) return;
          if (v === '__add') {
            const f = await pickFile('.otf,.ttf,.woff,.woff2,font/*'); if (!f) return;
            try { const x = await importClockFont(f); S().uiFont = 'u:' + x.id; toast('已导入「' + x.name + '」'); } catch (e) { toast(e.message); return; }
          } else S().uiFont = v;
          commit('look'); shell.applyLook(); valEl.textContent = fontName(S().uiFont) || '系统默认';
        } }),
        prev, sliderRow('字号', { min: .85, max: 1.3, step: .05, value: S().fontScale, fmt: v => Math.round(v * 100) + '%', onInput: v => { S().fontScale = v; commit('look'); shell.phone.style.setProperty('--as-font-scale', v); } })]),
      group('主题', [item({ title: '主题和皮肤', value: (THEMES[lib().theme] || THEMES.aero).name, chevron: true, onClick: () => shell.openApp('library') })]),
      group('模式', [h('div.as-field', segmented([['day', '日间'], ['night', '夜间'], ['auto', '跟随系统']], S().mode, (v, b) => { S().mode = v; commit('look'); shell.setNight(shell.wantNight(), b); }))]),
      group('时间', [clockPreview(night),
        fontSeg,
        mine,
        segField('颜色（只改锁屏上那个大时间）', segmented([['auto', '自动'], ['light', '浅色'], ['dark', '深色'], ['custom', '自选']], S().clockColor, v => { S().clockColor = v; commit('look'); shell.applyLook(); paintClock(); wheel.hidden = v !== 'custom'; })),
        wheel,
        segField('语言', segmented([['zh', '中文'], ['en', 'English']], S().clock.lang, v => { S().clock.lang = v; commit('look'); shell.applyLook(); paintClock(); })),
        segField('小时制', segmented([['24', '24 小时'], ['12', '12 小时']], S().clock.h12 ? '12' : '24', v => { S().clock.h12 = v === '12'; commit('look'); shell.applyLook(); paintClock(); })),
      ].filter(Boolean)));
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
/** 长按：按住 0.5 秒不动就触发，触发后这次的点击不算 */
function longPress(el, fn) {
  let t = 0, x0 = 0, y0 = 0, fired = false;
  el.addEventListener('pointerdown', e => { fired = false; x0 = e.clientX; y0 = e.clientY; t = setTimeout(() => { fired = true; navigator.vibrate && navigator.vibrate(10); fn(); }, 500); });
  el.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 8) clearTimeout(t); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => el.addEventListener(k, () => clearTimeout(t)));
  el.addEventListener('click', e => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
/** 调整图片：框是手机屏幕的比例，拖动上下左右挪，滑条缩放。存成「用图里哪一块」，可以超出图片（空出来的地方是黑的） */
async function cropWall(id) {
  const src = await walls.source(id); if (!src || !src.img && !src.video) return false;
  const media = src.img || src.video, iw = media.naturalWidth || media.videoWidth, ih = media.naturalHeight || media.videoHeight;
  const ph = shell.phone.getBoundingClientRect(), FW = 200, FH = Math.round(FW * ph.height / ph.width);
  const old = (walls.info(id) || {}).crop;   // 没调过的：和平时壁纸一样，铺满、居中
  const base = Math.max(FW / iw, FH / ih), zMin = Math.min(.5, Math.min(FW / iw, FH / ih) / base);
  let z = old ? Math.max(zMin, Math.min(4, (FW / (iw * base)) / old[2])) : 1, ox = old ? -old[0] * iw * base * z : (FW - iw * base) / 2, oy = old ? -old[1] * ih * base * z : (FH - ih * base) / 2;
  const pic = h('img.as-crop__img', { src: src.img ? src.img.src : '', alt: '' });
  if (!src.img) { const c = document.createElement('canvas'); c.width = iw; c.height = ih; c.getContext('2d').drawImage(src.video, 0, 0); pic.src = c.toDataURL('image/jpeg', .85); }
  const frame = h('div.as-crop__frame', { style: { width: FW + 'px', height: FH + 'px' } }, pic);
  const place = () => {
    const k = base * z, W = iw * k, H = ih * k;
    ox = Math.min(FW - 40, Math.max(40 - W, ox)); oy = Math.min(FH - 40, Math.max(40 - H, oy));   // 至少留一点在框里，免得拖丢了
    Object.assign(pic.style, { width: W + 'px', height: H + 'px', transform: `translate(${ox}px, ${oy}px)` });
  };
  let drag = null;
  frame.addEventListener('pointerdown', e => { e.preventDefault(); frame.setPointerCapture(e.pointerId); drag = { x: e.clientX - ox, y: e.clientY - oy }; });
  frame.addEventListener('pointermove', e => { if (!drag) return; ox = e.clientX - drag.x; oy = e.clientY - drag.y; place(); });
  ['pointerup', 'pointercancel'].forEach(k => frame.addEventListener(k, () => { drag = null; }));
  const zoomTo = nz => { const cx = FW / 2 - ox, cy = FH / 2 - oy, r = nz / z; z = nz; ox = FW / 2 - cx * r; oy = FH / 2 - cy * r; place(); };
  frame.addEventListener('wheel', e => { e.preventDefault(); zoomTo(Math.max(zMin, Math.min(4, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))); }, { passive: false });
  place();
  return new Promise(res => {
    let ok = false;
    const s = sheet({ title: '调整图片', content: h('div.as-crop', frame,
      sliderRow('缩放', { min: zMin, max: 4, step: .01, value: z, fmt: v => Math.round(v * 100) + '%', onInput: v => zoomTo(v) }),
      h('div.as-prompt-bar', btn('取消', 'secondary', () => s.close()), btn('保存', 'primary', () => {
        const k = base * z; walls.setCrop(id, [-ox / (iw * k), -oy / (ih * k), FW / (iw * k), FH / (ih * k)]); ok = true; s.close();
      }))), onClose: () => res(ok) });
  });
}
function openWalls() {
  sub('walls', '壁纸', (body, re) => {
    const w = S().walls, night = shell.phone.dataset.mode === 'night';
    const apply = () => { commit('walls'); shell.applyLook(); };
    // 最上面：锁屏 / 桌面两个小手机预览
    const pv = which => {
      const n = time.now();
      const card = bgOf(h('div.as-walls-pv__screen' + (which === 'home' ? '.is-home' : '')), walls.current(which), night);
      if (which === 'lock') card.append(h('div.as-walls-pv__clock', { dataset: { font: fontKey(S().clock.font) } }, h('span', n.date), withAp(n)));
      else card.append(h('div.as-walls-pv__apps', [0, 1, 2, 3].map(() => h('i'))));
      const tag = h('span.as-walls-pv__tag', { hidden: !w[which + 'Random'] }, icon('sparkle', 12, 2), '随机');
      card.append(tag); refs[which].card = card; refs[which].tag = tag;
      return h('div.as-walls-pv__item', card, which === 'lock' ? '锁屏' : '桌面');
    };
    // 选壁纸、开关随机：只改动到的那几处（勾选框、预览图、开关），不重画整页，不然会闪
    const refs = { lock: { tiles: new Map() }, home: { tiles: new Map() } };
    const paint = which => {
      const r = refs[which], rnd = w[which + 'Random'];
      r.tiles.forEach((t, id) => { const on = !rnd && w[which] === id; t.classList.toggle('is-active', on); t.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      bgOf(r.card, walls.current(which), night); r.tag.hidden = !rnd;
      if (r.sw) { r.sw.classList.toggle('is-active', !!rnd); r.sw.setAttribute('aria-checked', String(!!rnd)); }
    };
    const tile = (which, id) => {
      const x = walls.info(id), on = !w[which + 'Random'] && w[which] === id;
      const t = bgOf(h('button.as-walls-tile' + (on ? '.is-active' : ''), { 'aria-label': x.name, 'aria-pressed': on ? 'true' : 'false', onclick: () => {
        if (sel.size) { if (!walls.isBuiltin(id)) { sel.has(id) ? sel.delete(id) : sel.add(id); paintSel(); } return; }
        w[which] = id; w[which + 'Random'] = false; apply(); paint(which);
      } },
        x.type === 'live' ? h('span.as-walls-tile__live', 'LIVE') : null, h('span.as-walls-tile__pick', icon('check', 12, 3)), h('span.as-walls-tile__name', x.name)), id, night);
      refs[which].tiles.set(id, t);
      if (!walls.isBuiltin(id)) longPress(t, () => { sel.add(id); paintSel(); });
      return t;
    };
    // 长按进入多选：可以一起删；调整图片、改名一次只能一张。也是只改勾选，不重画
    const sel = new Set();
    const one = [btn('调整图片', 'secondary', () => crop([...sel][0])), btn('改名', 'secondary', () => rename([...sel][0]))];
    const delBtn = btn('删除', 'secondary', () => removeSel()); delBtn.classList.add('as-walls-selbar__del');
    const selBar = h('div.as-prompt-bar.as-walls-selbar', { hidden: true }, btn('取消', 'secondary', () => { sel.clear(); paintSel(); }), ...one, delBtn);
    const paintSel = () => {
      for (const k of ['lock', 'home']) refs[k].tiles.forEach((t, id) => { t.classList.toggle('is-picking', sel.size > 0); t.classList.toggle('is-picked', sel.has(id)); t.classList.toggle('is-off', sel.size > 0 && walls.isBuiltin(id)); });
      selBar.hidden = !sel.size; one.forEach(b => { b.disabled = sel.size !== 1; }); delBtn.textContent = sel.size > 1 ? `删除 ${sel.size} 张` : '删除';
    };
    // 每一排最后一个「+」：加进来的直接用在这一排（锁屏或桌面）
    const row = which => h('div.as-walls-row', walls.ids(which).map(id => tile(which, id)), h('button.as-walls-tile.as-walls-tile--add', { 'aria-label': '添加图片或 Live 图', onclick: () => add(which) }, icon('plus', 26, 2), h('span.as-walls-tile__name', '添加')));
    const add = async which => {
      const files = await pickMany('image/*,video/*,.mov,.heic');
      if (!files.length) return;
      try {
        const ids = await walls.addFiles(files, which);
        if (!ids.length) { toast('没认出能用的图片或视频'); return; }
        w[which] = ids[ids.length - 1]; w[which + 'Random'] = false;
        if (ids.length === 1) await cropWall(ids[0]);   // 加一张的时候马上让你调位置
        apply();
        toast(ids.length > 1 ? `加好了 ${ids.length} 张` : (walls.info(ids[0]).type === 'live' ? '加好了一张 Live 图' : '加好了'));
        re();
      } catch (e) { toast(e.message || '添加失败'); }
    };
    const randomRow = (which, title) => {
      const it = toggleItem({ title }, w[which + 'Random'], v => { w[which + 'Random'] = v; if (v) walls.reroll(which); apply(); paint(which); });
      refs[which].sw = it.querySelector('.as-switch'); return it;
    };
    const crop = async id => { if (await cropWall(id)) { apply(); paint('lock'); paint('home'); refs.lock.tiles.get(id) && bgOf(refs.lock.tiles.get(id), id, night); refs.home.tiles.get(id) && bgOf(refs.home.tiles.get(id), id, night); } sel.clear(); paintSel(); };
    const rename = async id => { const name = await dialog({ title: '改名', input: { value: walls.info(id).name } }); if (name) { walls.rename(id, name); for (const k of ['lock', 'home']) { const t = refs[k].tiles.get(id); t && (t.querySelector('.as-walls-tile__name').textContent = walls.info(id).name); } } sel.clear(); paintSel(); };
    const removeSel = async () => {
      if (!(await dialog({ title: sel.size > 1 ? `删除这 ${sel.size} 张壁纸？` : '删除这张壁纸？', confirm: '删除', danger: true }))) return;
      for (const id of sel) await walls.remove(id);
      apply(); re();
    };
    body.append(
      h('div.as-walls-pv', pv('lock'), pv('home')),
      group('锁屏', [row('lock'), randomRow('lock', '随机锁屏')]),
      group('桌面', [row('home'), randomRow('home', '随机桌面')]),
      group('Live 图怎么动', [
        h('div.as-field', segmented([['press', '按住播放'], ['loop', '一直循环']], w.live, v => { w.live = v; apply(); re(); })),
        w.live === 'press' ? toggleItem({ title: '亮屏时播放一次' }, w.liveWake, v => { w.liveWake = v; commit('walls'); }) : null,
      ].filter(Boolean)),
      selBar,
    );
  });
}
function openStatusbar() {
  sub('statusbar', '顶部时间栏', (body, re) => {
    const sb = S().statusbar;
    const apps = [['lock', '锁屏'], ['home', '桌面'], ['settings', '设置'], ['chat', '聊天'], ['library', '资源库'], ['log', '日志']];
    body.append(group('', [toggleItem({ title: '显示顶部时间栏' }, sb.global, v => { sb.global = v; commit('look'); shell.applyLook(); re(); })]),
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
    // 点数字密码 / 手势密码：打开跟锁屏一模一样的全屏界面设置（已经选着的再点一次就是修改）
    const choose = async m => {
      if (m === 'pin' || m === 'pattern') {
        const { setupSecret } = await import('../lock/lock.js');
        if (!(await setupSecret(m))) return;
      } else if (L.method === m) return;
      L.method = m; commit('lock'); shell.applyLook(); re();
    };
    body.append(group('', [toggleItem({ title: '锁屏' }, L.enabled, v => { L.enabled = v; commit('lock'); shell.applyLook(); re(); })]));
    if (!L.enabled) return;
    const has = m => m === 'pin' ? /^\d{4,6}$/.test(L.pin || '') : m === 'pattern' ? /^\d{4,9}$/.test(L.pattern || '') : true;
    body.append(group('解锁方式', ['none', 'finger', 'pin', 'pattern'].map(m => item({
      title: LOCK_LABEL[m],
      value: m === 'pin' && has('pin') ? `${(L.pin || '').length} 位` : '',
      right: L.method === m ? h('span.as-tag-accent', icon('check', 20, 2.4)) : null, onClick: () => choose(m) }))));
  });
}

/* ================= 通知 ================= */
const TONE_LABEL = { ding: '叮', dong: '咚', pop: '啵', twin: '叮咚' };
function openNotify() {
  sub('notify', '通知', (body, re) => {
    const n = S().notify;
    body.append(
      group('', [toggleItem({ title: '新消息横幅' }, n.banner, v => { n.banner = v; commit('settings'); })]),
      group('提示音', [toggleItem({ title: '提示音' }, n.sound, v => { n.sound = v; commit('settings'); re(); }),
        n.sound ? sliderRow('音量', { min: 0, max: 1, step: .05, value: n.volume, fmt: v => Math.round(v * 100) + '%', onInput: v => { n.volume = v; commit('settings'); } }) : null,
        n.sound ? item({ title: '选择音效', value: TONE_LABEL[n.tone] || '叮咚', chevron: true, onClick: async e => {
          const valEl = e.currentTarget.querySelector('.as-list-item__value');
          const v = await actionSheet('选择音效', Object.entries(TONE_LABEL).map(([k, l]) => ({ value: k, label: l, active: k === (n.tone || 'twin') })));
          if (!v) return;
          n.tone = v; commit('settings'); valEl.textContent = TONE_LABEL[v]; shell.ding(v);
        } }) : null].filter(Boolean)),
      group('免打扰', dndItems()),
      group('', [toggleItem({ title: '桌面图标未读红点' }, n.badge, v => { n.badge = v; commit('chats'); })]));
  });
}

/** 免打扰：通知页和「仅线上聊天」里各放一份，改的是同一个设置；开关只显示 / 藏起时间，不重画 */
function dndItems() {
  // 时间选择器里点了「清除」：回到默认的 23:00 / 08:00，不留空
  const DEF = { dndFrom: '23:00', dndTo: '08:00' }, n = S().notify;
  const t = (v, k) => { if (!v) n[k] = v = DEF[k]; const el = input({ value: v, type: 'time', onInput: x => { n[k] = x || DEF[k]; if (!x) el.value = DEF[k]; commit('settings'); } }); return el; };
  const times = h('div.as-settings-time', field('开始', t(n.dndFrom, 'dndFrom')), field('结束', t(n.dndTo, 'dndTo')));
  times.style.display = n.dnd ? '' : 'none';
  return [toggleItem({ title: withInfo('免打扰时段', '这段时间里不弹横幅、不响提示音；就算开了线上聊天、设了每几小时来找你，角色也不会主动发消息。') }, n.dnd, v => { n.dnd = v; commit('settings'); times.style.display = v ? '' : 'none'; }), times];
}
/* ================= 联动方式与时间 ================= */
/** 标题旁边的小 i：点一下看简短说明 */
function openLinkTime() {
  sub('linktime', '联动方式与时间', body => {
    const st = time.story(), a = state.apps.chat, p2 = n => String(n).padStart(2, '0');
    const hm = input({ value: `${p2(st.hh)}:${p2(st.mm)}`, type: 'time' });
    const dateIn = input({ value: `${st.date.getFullYear()}-${p2(st.date.getMonth() + 1)}-${p2(st.date.getDate())}`, type: 'date' });
    const nowText = () => { if (S().timeSrc === 'story') { const s1 = time.story(); return `${time.fmtDate(s1.date)} ${p2(s1.hh)}:${p2(s1.mm)}`; } const d = new Date(); return `${time.fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const nowItem = item({ title: '现在', value: nowText(), cls: 'as-settings-now' });
    // 切换「跟随剧情 / 现实时间」只显示 / 藏起手动设定那一块，不重画整页
    const manual = h('div.as-field', { hidden: S().timeSrc !== 'story' }, h('span.as-field__label', '读不到剧情时间时：手动设定'),
      h('div.as-settings-time', { style: { padding: 0 } }, dateIn, hm),
      h('div.as-settings-time', { style: { padding: 0, marginTop: '10px' } },
        btn('读最新楼', 'secondary', async () => {
          const t = (await import('../../core/sync.js')).readLatestTime();
          if (!t) return toast('正文里没找到时间');
          const s1 = time.story(); hm.value = `${p2(s1.hh)}:${p2(s1.mm)}`; dateIn.value = `${s1.date.getFullYear()}-${p2(s1.date.getMonth() + 1)}-${p2(s1.date.getDate())}`;
          nowItem.querySelector('.as-list-item__value').textContent = nowText(); toast(`已对上第 ${t.floor} 楼`);
        }),
        btn('设定', 'secondary', () => { const [hh, mm] = hm.value.split(':').map(Number); time.setStoryDate(dateIn.value, hh || 0, mm || 0); nowItem.querySelector('.as-list-item__value').textContent = nowText(); toast('剧情时间已更新'); })));
    // 仅线上聊天才有「定时来找你」；切换只显示 / 藏起这一块
    // 「TA 主动来找我」改了，所有聊天一起跟着改（每个聊天里还能单独再改）；关着就藏起「多久来找你一次」
    const every = sliderRow('TA 多久来找你一次', { min: 1, max: 24, step: 1, value: a.defaults.proactiveEvery || 3, fmt: v => `${v} 小时`, onInput: v => { a.defaults.proactiveEvery = v; commit('apps'); } });
    // 免打扰只管「TA 主动来找我」，所以放在它下面，关着就一起藏起来
    const [quiet, quietTimes] = dndItems();
    const showMore = on => { every.style.display = quiet.style.display = on ? '' : 'none'; quietTimes.style.display = on && S().notify.dnd ? '' : 'none'; };
    showMore(a.defaults.proactive !== false);
    const online = group(withInfo('线上聊天', 'TA 会每隔这么久主动来找你一次（每个私聊、群聊里还能单独改），免打扰时段里不会来。'), [
      toggleItem({ title: 'TA 主动来找我' }, a.defaults.proactive !== false, v => { a.defaults.proactive = v; state.chats.forEach(c => { c.cfg.proactive = v; }); commit('apps'); commit('chats'); showMore(v); }),
      every, quiet, quietTimes,
      item({ title: '让 TA 现在来找我', chevron: true, onClick: async () => {
        const name = (await import('../chat/engine.js')).pokeNow();
        toast(name ? `叫 ${name} 来找你了，等一下看聊天` : '还没有「仅线上聊天」的私聊');
      } })]);
    online.hidden = a.defaults.linkMode !== 'online';   // 定时来找你、免打扰都只有仅线上才有
    body.append(
      group(withInfo('联动方式', '跟随正文：手机里的角色会读最近的正文，手机聊天也会写回正文。\n仅线上聊天：手机聊天和正文互不影响，角色可以按时间主动来找你。'),
        [h('div.as-field', segmented([['follow', '跟随正文'], ['online', '仅线上聊天']], a.defaults.linkMode, v => { a.defaults.linkMode = v; state.chats.forEach(c => { c.cfg.linkMode = v; }); commit('apps'); commit('chats'); commit('inject'); online.hidden = v !== 'online'; }))]),
      online,
      group('时间', [
        h('div.as-field', segmented([['story', '跟随剧情'], ['real', '现实时间']], S().timeSrc, v => { S().timeSrc = v; commit('time'); commit('settings'); manual.hidden = v !== 'story'; nowItem.querySelector('.as-list-item__value').textContent = nowText(); })),
        nowItem, manual]));
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
      group('单独清理', [item({ title: '音乐', value: '存的歌', chevron: true, onClick: async () => {
        const P = await import('../../core/music.js'), { n, size } = await P.cacheInfo();
        if (!n) return toast('没有存的歌');
        if (!(await dialog({ title: '清掉存的歌？', text: `${n} 首，${(size / 1048576).toFixed(1)} MB。歌单、喜欢、本地导入的都不动。`, confirm: '清掉', danger: true }))) return;
        await P.clearCache(); toast('已清掉'); re();
      } })]),
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
        // 在酒馆里：让外面那层去查，有新版本就能直接点「现在更新」；单独预览时只能自己查
        item({ title: '检查更新', right: st, chevron: true, onClick: async () => {
          const r = await busy(st, () => inTavern() ? new Promise(res => {   // 转圈时再点一下就取消
            const on = e => { if (e.data && e.data.aster === 'update-result') { removeEventListener('message', on); res(e.data); } };
            addEventListener('message', on); postToParent({ aster: 'update-check' }); setTimeout(() => res({ error: true }), 15000);
          }) : fetch('https://raw.githubusercontent.com/xxuxin0705/AsterPhone/main/manifest.json', { cache: 'no-cache' }).then(x => x.json()).then(m => ({ remote: m.version, newer: cmp(m.version, VERSION) > 0 })).catch(() => ({ error: true })));
          if (!r) return;
          if (r.error) { st.textContent = '检查失败'; return; }
          if (!r.newer) { st.textContent = '已是最新版本'; return; }
          const v = r.remote ? ` v${r.remote}` : '';
          st.textContent = `有新版本${v}`;
          if (inTavern() && await dialog({ title: `发现新版本${v}`, confirm: '现在更新', cancel: '知道了' })) { toast('正在更新…'); postToParent({ aster: 'update-now' }); }
        } }),
        item({ title: '打开日志', chevron: true, onClick: () => shell.openApp('log') }),
        item({ title: '运行环境', value: inTavern() ? '酒馆内' : '单独预览' }),
      ]));
  });
}
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
